// =============================================================================
// TRIADE — `grupozap-lead`: os leads do ZAP Imóveis, Viva Real e OLX (05/11/2026)
//
// Só da Imova: é publicada só no projeto dela. Quando alguém procura um anúncio
// da Imova num dos portais (formulário, chat, clique no WhatsApp, ver telefone,
// pedir visita), o Grupo OLX faz um POST aqui — um lead por chamada, em JSON:
//
//   POST https://kkqadgxvmzulcamuakzk.supabase.co/functions/v1/grupozap-lead
//   Authorization: Basic base64("<usuario>:<SECRET_KEY>")
//   User-Agent: grupozap-notification-api            (espera até 30 s)
//
// É essa URL que vai no Canal Pro (integração de leads) e no validador oficial
// de endpoint. A função não olha o caminho: barra no fim ou um id depois do
// nome caem aqui do mesmo jeito, sem redirecionamento.
//
// A CHAVE
// -----------------------------------------------------------------------------
// A SECRET_KEY é uma por CRM e vem do Grupo OLX na homologação. Mora em
// GRUPOZAP_LEAD_SECRET (Secrets das Edge Functions) ou no Vault como
// `grupozap_lead_secret` — nunca em arquivo versionado. Na troca de chave, a
// velha fica em GRUPOZAP_LEAD_SECRET_ANTERIOR até o Grupo OLX passar a mandar a
// nova. GRUPOZAP_LEAD_USUARIO, se existir, passa a exigir também o usuário (a
// documentação mostra `vivareal`). Como confere: `autenticacao.ts`.
//
// GRUPOZAP_LEAD_SECRET_TESTE (opcional, 10/11/2026) é a chave PÚBLICA da
// página de segurança do Grupo OLX, com que o suporte deles testa o endpoint
// na homologação. Quem autentica com ela recebe 200 e NADA é gravado. Depois
// da homologação: a SECRET_KEY definitiva vai em GRUPOZAP_LEAD_SECRET e a de
// teste sai (`supabase secrets unset`). Nenhuma das duas mexe no código.
//
// AS RESPOSTAS — para o Grupo OLX só o status conta; o corpo é ignorado
// -----------------------------------------------------------------------------
//   200  recebido, inclusive repetido (idempotência pelo `originLeadId`)
//   200  teste, NÃO gravado: chave de teste, ou o lead de exemplo da
//        documentação (`originLeadId` 59ee0fc6…) com qualquer chave. O corpo
//        diz `teste: true` e o motivo (`lead.ts`, `motivoDeTeste`)
//   401  credencial ausente ou errada, com a mesma frase para todo motivo
//   422  lead de anúncio ("Grupo OLX") sem `clientListingId`: a regra deles
//        pede 4xx "para que o lead seja revisado e reprocessado". O lead é
//        GRAVADO antes da resposta, assim mesmo: a Imova não fica sem ele, e o
//        reenvio cai na idempotência
//   400  corpo que não é um objeto JSON
//   405  método que não é POST          413  corpo acima de 256 KB
//   500  o banco falhou: eles tentam de novo (até 3 vezes, e guardam o lead
//        por 14 dias), e a idempotência impede que o reenvio duplique
//   503  a chave não está configurada: recusa fechada, nunca aceita sem conferir
//
// NUNCA 404 E NUNCA 3xx. Há relato de que 404 desativa a integração de leads do
// anunciante, e 3xx conta como falha. Nenhum caminho daqui devolve um ou outro;
// o único 404 possível é o do gateway com a função ainda não publicada — por
// isso, publicar a função ANTES de colar a URL no Canal Pro.
//
// A ORDEM É A SEGURANÇA, a mesma de `komune-webhook`: corpo cru com teto →
// credencial → JSON → Postgres. Nada do corpo é lido antes da credencial.
//
// O QUE NÃO ACONTECE AQUI: achar o anúncio, achar ou abrir a ficha do cliente,
// avisar a equipe. É tudo de `public.grupozap_lead_receber`, numa transação.
// No log entram só o começo do `originLeadId`, o tipo de contato, se o anúncio
// foi achado e o status — nunca nome, telefone, e-mail ou mensagem.
// =============================================================================

import { erro, exigirMetodo, json, registrar } from '../_compartilhado/http.ts';
import { rpcServico } from '../_compartilhado/postgrest.ts';
import { SegredoAusente, segredo } from '../_compartilhado/segredos.ts';
import { conferirCredencial } from './autenticacao.ts';
import {
  chaveDeIdempotencia,
  decidirResposta,
  lerCorpo,
  motivoDeTeste,
  paraOBanco,
  resumoParaLog,
} from './lead.ts';

/** 256 KB. Um lead tem 1 a 2 KB; o de MCMV, com a simulação, um pouco mais. */
const TAMANHO_MAXIMO = 256 * 1024;

/** A frase única de recusa. Sondar a porta não pode render informação. */
const RECUSA = 'Chamada recusada: credencial ausente ou inválida.';

const FUNCAO = 'grupozap-lead';

/** O que `public.grupozap_lead_receber` devolve. `anuncio` não vem no repetido. */
type Recebido = {
  ok?: boolean;
  motivo?: string;
  duplicado?: boolean;
  lead_id?: string | null;
  anuncio?: 'encontrado' | 'nao_encontrado' | 'sem_codigo';
  ficha?: string;
};

// ---------------------------------------------------------------------------
// A chave anterior e o usuário são opcionais. `segredo()` não guarda a
// ausência, e sem esta memória cada chamada — inclusive as de quem sonda a
// porta — custaria duas idas ao Vault. Mesmo prazo do cache de `segredo()`.
// ---------------------------------------------------------------------------
const AUSENCIA_MS = 5 * 60 * 1000;
const ausentes = new Map<string, number>();

async function segredoOpcional(nome: string): Promise<string | null> {
  const ate = ausentes.get(nome);
  if (ate !== undefined && ate > Date.now()) return null;
  try {
    return await segredo(nome);
  } catch (e) {
    if (!(e instanceof SegredoAusente)) throw e;
    ausentes.set(nome, Date.now() + AUSENCIA_MS);
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  // 1. Só POST.
  const metodo = exigirMetodo(req, ['POST']);
  if (metodo) return metodo;

  // 2. O corpo cru, com teto. Ler antes da credencial é o que o Basic permite
  //    (o cabeçalho chega junto), mas o teto impede que isso vire um jeito de
  //    consumir memória sem credencial nenhuma.
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO) {
    return erro(
      413,
      'corpo_grande_demais',
      'O lead enviado é grande demais. Envie um lead por chamada.',
    );
  }
  let corpoCru: string;
  try {
    corpoCru = await req.text();
  } catch (e) {
    return erro(400, 'corpo_ilegivel', 'Não consegui ler o corpo da chamada. Reenvie o lead.', e);
  }
  if (corpoCru.length > TAMANHO_MAXIMO) {
    return erro(
      413,
      'corpo_grande_demais',
      'O lead enviado é grande demais. Envie um lead por chamada.',
    );
  }

  // 3. A chave. Sem ela, recusa fechada: aceitar sem conferir abriria a porta
  //    para qualquer um criar "cliente interessado" no CRM da Imova.
  let chave: string;
  let chaveAnterior: string | null;
  let chaveTeste: string | null;
  let usuario: string | null;
  try {
    chave = await segredo('grupozap_lead_secret');
    [chaveAnterior, chaveTeste, usuario] = await Promise.all([
      segredoOpcional('grupozap_lead_secret_anterior'),
      segredoOpcional('grupozap_lead_secret_teste'),
      segredoOpcional('grupozap_lead_usuario'),
    ]);
  } catch (e) {
    if (e instanceof SegredoAusente) {
      return erro(
        503,
        'integracao_nao_configurada',
        'O recebimento de leads do Grupo OLX ainda não está configurado. Grave GRUPOZAP_LEAD_SECRET antes de cadastrar esta URL no Canal Pro.',
        e,
        { funcao: FUNCAO, segredo_faltando: e.nome },
      );
    }
    return erro(
      500,
      'falha_ao_ler_segredo',
      'Não consegui conferir a chamada agora. Reenvie em alguns minutos.',
      e,
      { funcao: FUNCAO },
    );
  }

  // 4. A credencial, antes de qualquer leitura do corpo.
  const conferencia = await conferirCredencial({
    cabecalho: req.headers.get('authorization'),
    segredo: chave,
    segredoAnterior: chaveAnterior,
    segredoTeste: chaveTeste,
    usuarioExigido: usuario,
  });
  if (!conferencia.ok) {
    // Uma frase só para todos os motivos. O detalhe fica no log, que é nosso.
    registrar('erro', { funcao: FUNCAO, recusa: conferencia.motivo, status: 401 });
    return json({ ok: false, codigo: 'credencial_invalida', mensagem: RECUSA }, 401, {
      'WWW-Authenticate': 'Basic realm="grupozap-lead", charset="UTF-8"',
    });
  }
  if (conferencia.chave === 'anterior') {
    registrar('aviso', { funcao: FUNCAO, evento: 'chave_anterior_em_uso' });
  }

  // 5. Agora, e só agora, o JSON.
  const lido = lerCorpo(corpoCru);
  if (!lido.ok) {
    return erro(
      400,
      'json_invalido',
      'O corpo não é um objeto JSON válido. Envie um lead por chamada, no formato da documentação.',
      lido.motivo,
      { funcao: FUNCAO },
    );
  }
  const lead = lido.lead;

  // 6. A idempotência.
  const idem = await chaveDeIdempotencia(lead, corpoCru);
  const resumo = resumoParaLog(lead, idem);
  if (idem.de === 'corpo') {
    registrar('aviso', { funcao: FUNCAO, ...resumo, evento: idem.motivo });
  }

  // 6b. Teste não chega ao banco. Responde 200 mesmo quando o lead de verdade
  //     receberia 422: o validador quer saber se a porta abre, e nada foi
  //     guardado para ser revisado. O log diz o que o lead real receberia.
  const teste = motivoDeTeste(conferencia.chave, lead);
  if (teste !== null) {
    registrar('info', {
      funcao: FUNCAO,
      ...resumo,
      evento: 'teste_nao_gravado',
      motivo: teste,
      formato: conferencia.formato,
      status_se_fosse_real: decidirResposta(lead).status,
      status: 200,
    });
    return json({
      ok: true,
      teste: true,
      gravado: false,
      motivo: teste,
      formato: conferencia.formato,
    });
  }

  // 7. O Postgres grava. Também o lead que vai receber 422 (passo 8).
  let recebido: Recebido;
  try {
    recebido =
      (await rpcServico<Recebido>('grupozap_lead_receber', {
        p_chave: idem.chave,
        p_lead: paraOBanco(lead),
      })) ?? {};
  } catch (e) {
    // 500 é o certo: o Grupo OLX reenvia, e a idempotência garante que
    // reenviar não duplica nada. Devolver 200 aqui perderia o lead.
    return erro(
      500,
      'falha_ao_gravar',
      'Recebi o lead mas não consegui gravá-lo. Reenvie em alguns minutos.',
      e,
      { funcao: FUNCAO, ...resumo },
    );
  }
  if (recebido.ok !== true) {
    // O banco não gravou (chave ou lead que ele não aceita). Os passos 5 e 6
    // impedem isso; se acontecer, 2xx perderia o lead em silêncio, e o 500
    // deixa o lead guardado do lado deles enquanto o log diz por quê.
    return erro(
      500,
      'lead_nao_gravado',
      'Recebi o lead mas não consegui gravá-lo. Reenvie em alguns minutos.',
      recebido.motivo ?? 'resposta_sem_ok',
      { funcao: FUNCAO, ...resumo },
    );
  }

  // 8. A resposta que o Grupo OLX espera.
  const decisao = decidirResposta(lead);
  registrar(decisao.status === 200 ? 'info' : 'aviso', {
    funcao: FUNCAO,
    ...resumo,
    // encontrado | nao_encontrado | sem_codigo; no repetido o banco não diz.
    anuncio: recebido.duplicado === true ? undefined : recebido.anuncio,
    duplicado: recebido.duplicado === true,
    status: decisao.status,
  });
  if (decisao.status === 422) {
    return json(
      {
        ok: false,
        codigo: decisao.codigo,
        mensagem:
          'Lead de anúncio sem clientListingId: guardado no CRM, mas devolvido para revisão e reprocessamento.',
      },
      422,
    );
  }
  return json({ ok: true, duplicado: recebido.duplicado === true });
});

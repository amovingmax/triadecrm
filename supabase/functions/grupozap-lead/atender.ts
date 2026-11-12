// =============================================================================
// TRIADE — `grupozap-lead`: a resposta a cada chamada do Grupo OLX
//
// O que o `index.ts` serve. Separado dele (12/11/2026) para ser testado sem
// rede e sem banco: os segredos, as duas RPCs e o "depois da resposta" do
// runtime entram como dependências (`atender.test.ts`). As regras — a chave, as
// respostas, a ordem, o nunca 404 — estão no cabeçalho do `index.ts`.
//
// Cada chamada termina num resultado (`porta.ts`), anotado depois da resposta
// e sem poder mudá-la.
// =============================================================================

import { erro, exigirMetodo, json, registrar } from '../_compartilhado/http.ts';
import { conferirCredencial } from './autenticacao.ts';
import {
  chaveDeIdempotencia,
  decidirResposta,
  type Lead,
  lerCorpo,
  motivoDeTeste,
  paraOBanco,
  resumoParaLog,
} from './lead.ts';
import {
  type Adiar,
  type Anotar,
  anotarSemEsperar,
  ehDoGrupoOlx,
  type Resultado,
} from './porta.ts';

/** 256 KB. Um lead tem 1 a 2 KB; o de MCMV, com a simulação, um pouco mais. */
export const TAMANHO_MAXIMO = 256 * 1024;

/** A frase única de recusa. Sondar a porta não pode render informação. */
export const RECUSA = 'Chamada recusada: credencial ausente ou inválida.';

const FUNCAO = 'grupozap-lead';

/** O que `public.grupozap_lead_receber` devolve. `anuncio` não vem no repetido. */
export type Recebido = {
  ok?: boolean;
  motivo?: string;
  duplicado?: boolean;
  lead_id?: string | null;
  anuncio?: 'encontrado' | 'nao_encontrado' | 'sem_codigo';
  ficha?: string;
};

export type Dependencias = {
  /** O segredo, ou `null` se não está no ambiente nem no Vault. Lança se não deu para ler. */
  segredo: (nome: string) => Promise<string | null>;
  /** O mesmo, para os opcionais (anterior, teste, usuário). */
  segredoOpcional: (nome: string) => Promise<string | null>;
  /** `public.grupozap_lead_receber`, com a service_role. */
  receber: (chave: string, lead: Lead) => Promise<Recebido | null>;
  /** `public.grupozap_lead_anotar_chamada`, com a service_role: melhor esforço. */
  anotar: Anotar;
  /** `EdgeRuntime.waitUntil`: segura o worker para anotar, sem segurar a resposta. */
  adiar: Adiar;
  /** Só para teste: o prazo da anotação (`PRAZO_PARA_ANOTAR_MS`). */
  prazoParaAnotarMs?: number;
};

type Desfecho = { resposta: Response; resultado: Resultado };

/** O que vai para o `Deno.serve`: responde e, depois, anota a chamada. */
export function criarAtendente(d: Dependencias): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    let desfecho: Desfecho;
    try {
      desfecho = await responder(req, d);
    } catch (e) {
      // Nada abaixo deveria lançar; se lançar, 500 (o Grupo OLX reenvia e a
      // idempotência segura a duplicidade), nunca o que o runtime inventar.
      desfecho = {
        resultado: 'erro',
        resposta: erro(
          500,
          'falha_inesperada',
          'Não consegui receber o lead agora. Reenvie em alguns minutos.',
          e,
          { funcao: FUNCAO },
        ),
      };
    }
    anotarSemEsperar(
      {
        resultado: desfecho.resultado,
        status: desfecho.resposta.status,
        doGrupoOlx: ehDoGrupoOlx(req.headers.get('user-agent')),
      },
      d.anotar,
      d.adiar,
      d.prazoParaAnotarMs,
    );
    return desfecho.resposta;
  };
}

function falhou(resposta: Response): Desfecho {
  return { resposta, resultado: 'erro' };
}

async function responder(req: Request, d: Dependencias): Promise<Desfecho> {
  // 1. Só POST.
  const metodo = exigirMetodo(req, ['POST']);
  if (metodo) return falhou(metodo);

  // 2. O corpo cru, com teto. Ler antes da credencial é o que o Basic permite
  //    (o cabeçalho chega junto), mas o teto impede que isso vire um jeito de
  //    consumir memória sem credencial nenhuma.
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO) {
    return falhou(
      erro(
        413,
        'corpo_grande_demais',
        'O lead enviado é grande demais. Envie um lead por chamada.',
      ),
    );
  }
  let corpoCru: string;
  try {
    corpoCru = await req.text();
  } catch (e) {
    return falhou(
      erro(400, 'corpo_ilegivel', 'Não consegui ler o corpo da chamada. Reenvie o lead.', e),
    );
  }
  if (corpoCru.length > TAMANHO_MAXIMO) {
    return falhou(
      erro(
        413,
        'corpo_grande_demais',
        'O lead enviado é grande demais. Envie um lead por chamada.',
      ),
    );
  }

  // 3. A chave. Sem ela, recusa fechada: aceitar sem conferir abriria a porta
  //    para qualquer um criar "cliente interessado" no CRM da Imova.
  let chave: string | null;
  let chaveAnterior: string | null;
  let chaveTeste: string | null;
  let usuario: string | null;
  try {
    chave = await d.segredo('grupozap_lead_secret');
    if (chave === null) {
      return falhou(
        erro(
          503,
          'integracao_nao_configurada',
          'O recebimento de leads do Grupo OLX ainda não está configurado. Grave GRUPOZAP_LEAD_SECRET antes de cadastrar esta URL no Canal Pro.',
          'segredo_ausente',
          { funcao: FUNCAO, segredo_faltando: 'grupozap_lead_secret' },
        ),
      );
    }
    [chaveAnterior, chaveTeste, usuario] = await Promise.all([
      d.segredoOpcional('grupozap_lead_secret_anterior'),
      d.segredoOpcional('grupozap_lead_secret_teste'),
      d.segredoOpcional('grupozap_lead_usuario'),
    ]);
  } catch (e) {
    return falhou(
      erro(
        500,
        'falha_ao_ler_segredo',
        'Não consegui conferir a chamada agora. Reenvie em alguns minutos.',
        e,
        { funcao: FUNCAO },
      ),
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
    return {
      resultado: 'recusado_credencial',
      resposta: json({ ok: false, codigo: 'credencial_invalida', mensagem: RECUSA }, 401, {
        'WWW-Authenticate': 'Basic realm="grupozap-lead", charset="UTF-8"',
      }),
    };
  }
  if (conferencia.chave === 'anterior') {
    registrar('aviso', { funcao: FUNCAO, evento: 'chave_anterior_em_uso' });
  }

  // 5. Agora, e só agora, o JSON.
  const lido = lerCorpo(corpoCru);
  if (!lido.ok) {
    return falhou(
      erro(
        400,
        'json_invalido',
        'O corpo não é um objeto JSON válido. Envie um lead por chamada, no formato da documentação.',
        lido.motivo,
        { funcao: FUNCAO },
      ),
    );
  }
  const lead = lido.lead;

  // 6. A idempotência.
  const idem = await chaveDeIdempotencia(lead, corpoCru);
  const resumo = resumoParaLog(lead, idem);
  if (idem.de === 'corpo') {
    registrar('aviso', { funcao: FUNCAO, ...resumo, evento: idem.motivo });
  }
  const decisao = decidirResposta(lead);

  // 6b. Teste não chega ao banco: o validador quer saber se a porta abre. O log
  //     diz o aviso que o lead real teria.
  const teste = motivoDeTeste(conferencia.chave, lead);
  if (teste !== null) {
    registrar('info', {
      funcao: FUNCAO,
      ...resumo,
      evento: 'teste_nao_gravado',
      motivo: teste,
      formato: conferencia.formato,
      aviso: decisao.aviso ?? undefined,
      status: 200,
    });
    return {
      resultado: 'teste',
      resposta: json({
        ok: true,
        teste: true,
        gravado: false,
        motivo: teste,
        formato: conferencia.formato,
      }),
    };
  }

  // 7. O Postgres grava.
  let recebido: Recebido;
  try {
    recebido = (await d.receber(idem.chave, paraOBanco(lead))) ?? {};
  } catch (e) {
    // 500 é o certo: o Grupo OLX reenvia, e a idempotência garante que
    // reenviar não duplica nada. Devolver 200 aqui perderia o lead.
    return falhou(
      erro(
        500,
        'falha_ao_gravar',
        'Recebi o lead mas não consegui gravá-lo. Reenvie em alguns minutos.',
        e,
        { funcao: FUNCAO, ...resumo },
      ),
    );
  }
  if (recebido.ok !== true) {
    // O banco não gravou (chave ou lead que ele não aceita). Os passos 5 e 6
    // impedem isso; se acontecer, 2xx perderia o lead em silêncio, e o 500
    // deixa o lead guardado do lado deles enquanto o log diz por quê.
    return falhou(
      erro(
        500,
        'lead_nao_gravado',
        'Recebi o lead mas não consegui gravá-lo. Reenvie em alguns minutos.',
        recebido.motivo ?? 'resposta_sem_ok',
        { funcao: FUNCAO, ...resumo },
      ),
    );
  }

  // 8. Gravado é 200, sempre (12/11/2026). O lead de anúncio sem código fica
  //    com o aviso no log.
  const duplicado = recebido.duplicado === true;
  registrar(decisao.aviso ? 'aviso' : 'info', {
    funcao: FUNCAO,
    ...resumo,
    // encontrado | nao_encontrado | sem_codigo; no repetido o banco não diz.
    anuncio: duplicado ? undefined : recebido.anuncio,
    duplicado,
    aviso: decisao.aviso ?? undefined,
    status: decisao.status,
  });
  return {
    resultado: duplicado ? 'repetido' : 'recebido',
    resposta: json({ ok: true, duplicado }, decisao.status),
  };
}

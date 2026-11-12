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
// É essa URL que vai no Canal Pro (☰ → Configurações → Integrações → aba Leads
// → "Receber leads no CRM"; não é o campo do arquivo de anúncios) e no
// validador oficial de endpoint. A função não olha o caminho: barra no fim ou
// um id depois do nome caem aqui do mesmo jeito, sem redirecionamento.
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
//   200  lead GRAVADO é sempre 200, inclusive o de anúncio ("Grupo OLX") sem
//        `clientListingId` (12/11/2026; até ali, 422). A documentação pede 4xx
//        a esse lead "para que seja revisado e reprocessado", mas a Imova tem
//        anúncios criados direto no Canal Pro, sem código do arquivo (o
//        Edifício Simone tem 58 contatos); o Grupo OLX tenta de novo 3 vezes
//        cada não-2xx, e há relato de que falhas seguidas desligam a integração
//        do anunciante (olxbr/crm-lead-integration, issues 41 e 48). O log leva
//        o aviso `anuncio_sem_codigo`, para a gente saber
//   200  teste, NÃO gravado: chave de teste, ou o lead de exemplo da
//        documentação (`originLeadId` 59ee0fc6…) com qualquer chave. O corpo
//        diz `teste: true` e o motivo (`lead.ts`, `motivoDeTeste`)
//   401  credencial ausente ou errada, com a mesma frase para todo motivo
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
// A PORTA: CADA CHAMADA É ANOTADA (12/11/2026)
// -----------------------------------------------------------------------------
// Até 12/11 a única prova de que o Grupo OLX chamou era este log, que ninguém da
// Imova vê — e ele mostrou que, desde a homologação, o Grupo OLX nunca chamou:
// a homologação só cadastra o CRM; cada anunciante aponta a entrega no Canal
// Pro, em Integrações → aba Leads → "Receber leads no CRM", um campo separado
// da integração de anúncios. Agora, depois de responder, a função anota o
// resultado (`recebido`, `repetido`, `teste`, `recusado_credencial`, `erro`),
// o status e se o user-agent é o do Grupo OLX, numa linha por dia e resultado
// (`public.grupozap_lead_anotar_chamada`, migração 20261112181000). Nada da
// pessoa nem do corpo. É o que o passo "Os leads vêm para o CRM", no alto de
// Anúncios, lê. Melhor esforço (`porta.ts`): entregue a `EdgeRuntime.waitUntil`,
// com prazo de 3 s; se falhar, a resposta não muda nem atrasa.
//
// A ORDEM É A SEGURANÇA, a mesma de `komune-webhook`: corpo cru com teto →
// credencial → JSON → Postgres. Nada do corpo é lido antes da credencial.
//
// O QUE NÃO ACONTECE AQUI: achar o anúncio, achar ou abrir a ficha do cliente,
// avisar a equipe. É tudo de `public.grupozap_lead_receber`, numa transação.
// No log entram só o começo do `originLeadId`, o tipo de contato, se o anúncio
// foi achado e o status — nunca nome, telefone, e-mail ou mensagem.
//
// ONDE ESTÁ CADA COISA: este arquivo liga a função ao mundo (segredos, as duas
// RPCs com a service_role, o `EdgeRuntime.waitUntil`); a resposta a cada
// chamada mora em `atender.ts`, testada sem rede e sem banco; a credencial em
// `autenticacao.ts`; a leitura do lead em `lead.ts`; a anotação em `porta.ts`.
// =============================================================================

import { rpcServico } from '../_compartilhado/postgrest.ts';
import { SegredoAusente, segredo } from '../_compartilhado/segredos.ts';
import { criarAtendente, type Recebido } from './atender.ts';
import { adiarNoRuntime, type Chamada } from './porta.ts';

/** O segredo, ou `null` se ele não está no ambiente nem no Vault. */
async function segredoOuNulo(nome: string): Promise<string | null> {
  try {
    return await segredo(nome);
  } catch (e) {
    if (e instanceof SegredoAusente) return null;
    throw e;
  }
}

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
  const valor = await segredoOuNulo(nome);
  if (valor === null) ausentes.set(nome, Date.now() + AUSENCIA_MS);
  return valor;
}

Deno.serve(
  criarAtendente({
    segredo: segredoOuNulo,
    segredoOpcional,
    receber: (chave, lead) =>
      rpcServico<Recebido | null>('grupozap_lead_receber', { p_chave: chave, p_lead: lead }),
    anotar: (c: Chamada) =>
      rpcServico('grupozap_lead_anotar_chamada', {
        p_resultado: c.resultado,
        p_status: c.status,
        p_do_grupo_olx: c.doGrupoOlx,
      }),
    adiar: adiarNoRuntime,
  }),
);

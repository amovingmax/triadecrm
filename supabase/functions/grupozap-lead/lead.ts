// =============================================================================
// TRIADE — o lead do Grupo OLX: ler, identificar e decidir a resposta
//
// Puro: sem rede, sem banco, sem ambiente. O que é regra do Grupo OLX sobre o
// CORPO mora aqui; o que é do CRM (achar o anúncio, abrir a ficha, avisar a
// equipe) é do Postgres (`public.grupozap_lead_receber`).
//
// O que o Grupo OLX promete e o que a gente faz com isso
// -----------------------------------------------------------------------------
//   * um lead por requisição, em JSON; campos novos podem aparecer a qualquer
//     hora — nada aqui recusa campo que não conhece;
//   * `originLeadId` "sempre presente" e único: é a chave de idempotência. Se
//     um dia faltar, a chave vira o SHA-256 do corpo cru (o reenvio do mesmo
//     lead tem o mesmo corpo) e o `index.ts` registra um aviso;
//   * `clientListingId` é o `ListingID` do nosso feed. Lead de anúncio
//     (`leadOrigin = "Grupo OLX"`) sem ele deve receber 4xx "para que o lead
//     seja revisado e reprocessado"; lead de simulação Minha Casa Minha Vida
//     (`MCMV_OLX`) vem sem ele por natureza e recebe 200. Código que não existe
//     no CRM NÃO é motivo de recusa: o validador oficial manda `a40171`;
//   * `extraData.leadCerto` aparece como booleano na documentação e como texto
//     ("true"/"false") em leads reais — o banco recebe sempre booleano.
// =============================================================================

/** Lead de anúncio: sem `clientListingId`, devolve 4xx. */
export const ORIGEM_ANUNCIO = 'Grupo OLX';
/** Lead de simulação Minha Casa Minha Vida: sem `clientListingId` é normal. */
export const ORIGEM_MCMV = 'MCMV_OLX';
/** Teto da chave de idempotência vinda do `originLeadId`. */
export const TAMANHO_MAXIMO_DA_CHAVE = 200;

export type Lead = Record<string, unknown>;

export type CorpoLido =
  { ok: true; lead: Lead } | { ok: false; motivo: 'json_invalido' | 'nao_e_objeto' };

export type Chave = {
  chave: string;
  /** `corpo` quando o `originLeadId` faltou ou não serviu. */
  de: 'originLeadId' | 'corpo';
  motivo?: 'originLeadId_ausente' | 'originLeadId_longo_demais';
};

export type Decisao = { status: 200 } | { status: 422; codigo: 'anuncio_sem_codigo' };

const codificador = new TextEncoder();

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

/** Texto aparado de um campo que pode vir como texto ou número. */
function textoDe(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
}

async function sha256Hex(texto: string): Promise<string> {
  const bruto = await crypto.subtle.digest('SHA-256', codificador.encode(texto));
  return Array.from(new Uint8Array(bruto))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** O corpo tem de ser um objeto JSON; o resto do formato não é conferido aqui. */
export function lerCorpo(corpoCru: string): CorpoLido {
  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoCru);
  } catch {
    return { ok: false, motivo: 'json_invalido' };
  }
  if (!ehObjeto(corpo)) return { ok: false, motivo: 'nao_e_objeto' };
  return { ok: true, lead: corpo };
}

/** `originLeadId` aparado; na falta dele, `sha256:<hex do corpo cru>`. */
export async function chaveDeIdempotencia(lead: Lead, corpoCru: string): Promise<Chave> {
  const id = textoDe(lead.originLeadId);
  if (id.length > 0 && id.length <= TAMANHO_MAXIMO_DA_CHAVE) {
    return { chave: id, de: 'originLeadId' };
  }
  return {
    chave: `sha256:${await sha256Hex(corpoCru)}`,
    de: 'corpo',
    motivo: id.length === 0 ? 'originLeadId_ausente' : 'originLeadId_longo_demais',
  };
}

function ehDeAnuncio(lead: Lead): boolean {
  const origem = typeof lead.leadOrigin === 'string' ? lead.leadOrigin : '';
  return origem.trim().replace(/\s+/g, ' ').toLowerCase() === ORIGEM_ANUNCIO.toLowerCase();
}

/** O lead diz de qual anúncio do nosso feed veio? */
export function temCodigoDoAnuncio(lead: Lead): boolean {
  return textoDe(lead.clientListingId).length > 0;
}

/**
 * 200 ou 422. O lead é gravado nos dois casos (o `index.ts` grava antes de
 * responder): o 422 só diz ao Grupo OLX que aquele lead precisa de revisão do
 * lado deles. Origem desconhecida sem código recebe 200 — a regra do 4xx é
 * explícita para "Grupo OLX", e recusar o que não se conhece perderia lead.
 */
export function decidirResposta(lead: Lead): Decisao {
  if (ehDeAnuncio(lead) && !temCodigoDoAnuncio(lead)) {
    return { status: 422, codigo: 'anuncio_sem_codigo' };
  }
  return { status: 200 };
}

/** `true`/`false`, em booleano ou texto (e 1/0); qualquer outra coisa é `null`. */
export function normalizarLeadCerto(valor: unknown): boolean | null {
  if (typeof valor === 'boolean') return valor;
  if (valor === 1 || valor === 0) return valor === 1;
  if (typeof valor !== 'string') return null;
  const t = valor.trim().toLowerCase();
  // Os mesmos textos que `grupozap_lead_receber` lê, para os dois lados não divergirem.
  if (t === 'true' || t === '1' || t === 'sim') return true;
  if (t === 'false' || t === '0' || t === 'nao' || t === 'não') return false;
  return null;
}

/**
 * O lead como vai ao banco: igual ao recebido, campo a campo, exceto
 * `extraData.leadCerto`, que vira booleano (ou `null`, se veio algo que não se
 * entende — o banco grava `null` como `false`). O banco também aceita o texto,
 * mas um booleano só é um contrato a menos para manter igual dos dois lados, e
 * nenhum texto inesperado chega a um `::boolean`. Não mexe no objeto recebido.
 */
export function paraOBanco(lead: Lead): Lead {
  const extra = lead.extraData;
  if (!ehObjeto(extra) || !('leadCerto' in extra)) return lead;
  return { ...lead, extraData: { ...extra, leadCerto: normalizarLeadCerto(extra.leadCerto) } };
}

/**
 * O que pode ir para o log: o começo da chave e o tipo de contato. Nome,
 * telefone, e-mail e mensagem nunca. O tipo só sai se tiver a forma dos
 * valores documentados (CONTACT_FORM, CLICK_WHATSAPP…), para que um texto
 * qualquer nesse campo não leve dado pessoal ao log.
 */
export function resumoParaLog(lead: Lead, chave: Chave): { lead: string; tipo: string } {
  const extra = ehObjeto(lead.extraData) ? lead.extraData : {};
  const tipo =
    typeof extra.leadType === 'string' && /^[A-Z][A-Z_]{0,39}$/.test(extra.leadType)
      ? extra.leadType
      : extra.leadType === undefined
        ? 'sem_tipo'
        : 'outro';
  const corte = chave.de === 'corpo' ? 'sha256:'.length + 12 : 12;
  return { lead: chave.chave.slice(0, corte), tipo };
}

// =============================================================================
// TRIADE — a assinatura dos avisos do Calendly (10/11/2026)
//
// O Calendly assina cada POST com a chave que o CRM escolheu ao criar a
// assinatura do webhook (scripts/calendly-assinar.mjs):
//
//   Calendly-Webhook-Signature: t=1492774577,v1=5257a869e7ecebeda32a...
//
//   v1 = hex(HMAC_SHA256(chave, t + "." + corpo cru))
//
// (developer.calendly.com/api-docs/overview/webhooks/webhook-signatures)
//
// É o mesmo cuidado de `_compartilhado/assinatura.ts`, com a base do Calendly:
// o corpo é o TEXTO CRU, nunca o JSON reserializado; o carimbo tem janela nos
// dois sentidos (reenvio gravado e relógio adiantado); a comparação é em tempo
// constante e percorre todas as assinaturas e as duas chaves, sem sair no meio.
// =============================================================================

import { assinar, iguaisEmTempoConstante } from '../_compartilhado/assinatura.ts';

/**
 * Cinco minutos. O exemplo do Calendly usa três; a folga cobre relógio torto
 * sem abrir espaço para reenvio gravado. É a mesma janela das outras
 * integrações (`JANELA_REPLAY_PADRAO`).
 */
export const JANELA_SEGUNDOS = 300;

export type MotivoDeRecusa =
  'sem_cabecalho' | 'cabecalho_malformado' | 'carimbo_fora_da_janela' | 'assinatura_invalida';

export type Conferencia =
  | { ok: true; carimbo: number; chave: 'atual' | 'anterior' }
  | { ok: false; motivo: MotivoDeRecusa };

/**
 * Lê `t=<segundos>,v1=<hex>[,v1=<hex>...]`. Partes desconhecidas (um `v2` que
 * o Calendly venha a mandar) são ignoradas; sem `t` ou sem nenhum `v1` válido,
 * o cabeçalho é malformado.
 */
export function lerCabecalho(
  valor: string | null,
): { carimbo: number; assinaturas: string[] } | null {
  if (!valor) return null;
  let carimbo: number | null = null;
  const assinaturas: string[] = [];
  for (const parte of valor.split(',')) {
    const igual = parte.indexOf('=');
    if (igual <= 0) continue;
    const chave = parte.slice(0, igual).trim();
    const v = parte.slice(igual + 1).trim();
    if (chave === 't' && /^\d{1,12}$/.test(v)) carimbo = Number(v);
    else if (chave === 'v1' && /^[0-9a-f]{64}$/i.test(v)) assinaturas.push(v.toLowerCase());
  }
  if (carimbo === null || assinaturas.length === 0) return null;
  return { carimbo, assinaturas };
}

/** O hex que o Calendly teria mandado para este carimbo e este corpo. */
export async function assinaturaEsperada(
  chave: string,
  carimbo: number,
  corpoCru: string,
): Promise<string> {
  // `assinar` devolve "v1=<hex>": o prefixo é do esquema do Tríade, não do Calendly.
  return (await assinar(chave, `${carimbo}.${corpoCru}`)).slice(3);
}

export async function conferirAssinatura(opcoes: {
  cabecalho: string | null;
  corpoCru: string;
  chave: string;
  /** A chave velha, enquanto a troca não termina (CALENDLY_WEBHOOK_SIGNING_KEY_ANTERIOR). */
  chaveAnterior?: string | null;
  agoraSegundos?: number;
  janelaSegundos?: number;
}): Promise<Conferencia> {
  if (!opcoes.cabecalho) return { ok: false, motivo: 'sem_cabecalho' };
  const lido = lerCabecalho(opcoes.cabecalho);
  if (!lido) return { ok: false, motivo: 'cabecalho_malformado' };

  const agora = opcoes.agoraSegundos ?? Math.floor(Date.now() / 1000);
  if (Math.abs(agora - lido.carimbo) > (opcoes.janelaSegundos ?? JANELA_SEGUNDOS)) {
    return { ok: false, motivo: 'carimbo_fora_da_janela' };
  }

  const atual = await assinaturaEsperada(opcoes.chave, lido.carimbo, opcoes.corpoCru);
  const anterior = opcoes.chaveAnterior
    ? await assinaturaEsperada(opcoes.chaveAnterior, lido.carimbo, opcoes.corpoCru)
    : null;
  let bateAtual = false;
  let bateAnterior = false;
  for (const recebida of lido.assinaturas) {
    // Sem `break`: todas as comparações acontecem, bata ou não.
    if (iguaisEmTempoConstante(atual, recebida)) bateAtual = true;
    if (anterior !== null && iguaisEmTempoConstante(anterior, recebida)) bateAnterior = true;
  }
  if (bateAtual) return { ok: true, carimbo: lido.carimbo, chave: 'atual' };
  if (bateAnterior) return { ok: true, carimbo: lido.carimbo, chave: 'anterior' };
  return { ok: false, motivo: 'assinatura_invalida' };
}

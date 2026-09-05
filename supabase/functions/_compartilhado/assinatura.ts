// =============================================================================
// TRIADE — assinatura HMAC das integrações (PRD §7.6, RF-PRE-01)
//
// Um esquema só, nas duas direções, para não haver duas coisas para errar:
//
//   base = "v1:" + carimbo + ":" + corpo cru
//   assinatura = "v1=" + hex(HMAC_SHA256(segredo, base))
//
// O corpo é o TEXTO CRU recebido, nunca o objeto reserializado: `JSON.parse`
// seguido de `JSON.stringify` reordena chaves e normaliza números, e a
// assinatura deixa de bater por motivo nenhum.
//
// Três recusas, nesta ordem, antes de qualquer efeito:
//   1. cabeçalho ausente ou malformado  → 401
//   2. carimbo fora da janela (replay)  → 401
//   3. assinatura que não confere       → 401
// =============================================================================

const codificador = new TextEncoder();

/** Janela padrão de aceitação do carimbo, em segundos (RF-PRE-01). */
export const JANELA_REPLAY_PADRAO = 300;

export type ResultadoVerificacao =
  | { ok: true; carimbo: number }
  | {
      ok: false;
      codigo:
        | 'assinatura_ausente'
        | 'assinatura_malformada'
        | 'carimbo_ausente'
        | 'carimbo_invalido'
        | 'carimbo_fora_da_janela'
        | 'assinatura_invalida';
      detalhe: string;
    };

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function chave(segredo: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    codificador.encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** Assina `base` e devolve o valor pronto do cabeçalho: "v1=<hex>". */
export async function assinar(segredo: string, base: string): Promise<string> {
  const bruto = await crypto.subtle.sign('HMAC', await chave(segredo), codificador.encode(base));
  return `v1=${hex(bruto)}`;
}

/** Monta a base canônica. Uma função só, usada por quem assina e por quem confere. */
export function baseCanonica(carimbo: number | string, corpoCru: string): string {
  return `v1:${carimbo}:${corpoCru}`;
}

/**
 * Comparação em tempo constante.
 *
 * Percorre sempre o comprimento do maior dos dois e acumula as diferenças com
 * XOR — inclusive a diferença de comprimento. Não há `return` no meio, não há
 * `break`, e nenhum caminho é mais curto que outro: o tempo da função não conta
 * nada sobre quantos bytes do começo estavam certos.
 */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const ba = codificador.encode(a);
  const bb = codificador.encode(b);
  const n = Math.max(ba.length, bb.length);
  let diferenca = ba.length ^ bb.length;
  for (let i = 0; i < n; i += 1) {
    diferenca |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diferenca === 0;
}

/**
 * Confere assinatura e carimbo de uma requisição recebida.
 * `corpoCru` tem de ser exatamente o texto lido de `request.text()`.
 */
export async function verificar(opcoes: {
  segredo: string;
  corpoCru: string;
  assinaturaRecebida: string | null;
  carimboRecebido: string | null;
  janelaSegundos?: number;
  agoraSegundos?: number;
}): Promise<ResultadoVerificacao> {
  const janela = opcoes.janelaSegundos ?? JANELA_REPLAY_PADRAO;
  const agora = opcoes.agoraSegundos ?? Math.floor(Date.now() / 1000);

  if (!opcoes.assinaturaRecebida) {
    return { ok: false, codigo: 'assinatura_ausente', detalhe: 'sem cabeçalho de assinatura' };
  }
  if (!opcoes.carimboRecebido) {
    return { ok: false, codigo: 'carimbo_ausente', detalhe: 'sem cabeçalho de carimbo' };
  }
  if (!/^v1=[0-9a-f]{64}$/.test(opcoes.assinaturaRecebida)) {
    return { ok: false, codigo: 'assinatura_malformada', detalhe: 'formato esperado v1=<64 hex>' };
  }
  const carimbo = Number(opcoes.carimboRecebido);
  if (!Number.isFinite(carimbo) || !Number.isInteger(carimbo) || carimbo <= 0) {
    return { ok: false, codigo: 'carimbo_invalido', detalhe: 'carimbo não é inteiro de segundos' };
  }
  // Vale nos dois sentidos: carimbo velho é reenvio gravado; carimbo no futuro
  // é relógio errado ou tentativa de esticar a validade da assinatura.
  if (Math.abs(agora - carimbo) > janela) {
    return {
      ok: false,
      codigo: 'carimbo_fora_da_janela',
      detalhe: `diferença de ${Math.abs(agora - carimbo)}s, janela de ${janela}s`,
    };
  }

  const esperada = await assinar(opcoes.segredo, baseCanonica(carimbo, opcoes.corpoCru));
  if (!iguaisEmTempoConstante(esperada, opcoes.assinaturaRecebida)) {
    return { ok: false, codigo: 'assinatura_invalida', detalhe: 'HMAC não confere' };
  }
  return { ok: true, carimbo };
}

/** Cabeçalhos de uma requisição que o Triade envia assinada. */
export async function cabecalhosAssinados(opcoes: {
  segredo: string;
  corpoCru: string;
  chaveIdempotencia?: string;
  prefixo?: string;
  agoraSegundos?: number;
}): Promise<Record<string, string>> {
  const prefixo = opcoes.prefixo ?? 'X-Triade';
  const carimbo = opcoes.agoraSegundos ?? Math.floor(Date.now() / 1000);
  const assinatura = await assinar(opcoes.segredo, baseCanonica(carimbo, opcoes.corpoCru));
  const cabecalhos: Record<string, string> = {
    'Content-Type': 'application/json',
    [`${prefixo}-Timestamp`]: String(carimbo),
    [`${prefixo}-Signature`]: assinatura,
  };
  if (opcoes.chaveIdempotencia) {
    cabecalhos['Idempotency-Key'] = opcoes.chaveIdempotencia;
  }
  return cabecalhos;
}

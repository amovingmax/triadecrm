// =============================================================================
// TRIADE — a assinatura da Meta (`X-Hub-Signature-256`)
//
// É um esquema DIFERENTE do de `_compartilhado/assinatura.ts`, e por isso mora
// em arquivo próprio em vez de virar um `if` lá dentro:
//
//   Komune (nosso)  base = "v1:<carimbo>:<corpo>"   cabeçalho = "v1=<hex>"
//   Meta            base =           <corpo>        cabeçalho = "sha256=<hex>"
//
// A diferença que importa não é o prefixo: é que a Meta NÃO ASSINA CARIMBO
// NENHUM. Não existe `X-Hub-Timestamp`. Uma requisição capturada com a
// assinatura dela vale para sempre, do ponto de vista da assinatura.
//
// O CARIMBO, ENTÃO, VEM DE DENTRO DO CORPO
// -----------------------------------------------------------------------------
// O corpo da Meta carrega a hora dos próprios fatos: `entry[].time` e o
// `timestamp` de cada mensagem e de cada recibo, ambos em segundos de época.
// Como esses campos estão DENTRO do que foi assinado, mexer neles invalida a
// assinatura — e é isso que os torna um carimbo utilizável. Adiar a decisão
// para "o wamid é único, o replay não duplica nada" seria trocar uma trava por
// uma consequência: a idempotência protege o BANCO, não protege a porta.
//
// A JANELA É LARGA DE PROPÓSITO, E ISSO É UMA ESCOLHA, NÃO UM DESCUIDO
// -----------------------------------------------------------------------------
// A Meta reentrega o webhook que não recebeu 200, com espaçamento crescente, ao
// longo de horas. Uma janela de cinco minutos — a do nosso esquema com a
// Komune, onde nós controlamos os dois lados — aqui descartaria reentrega
// legítima, e reentrega descartada é mensagem de fornecedor perdida em
// silêncio. O padrão é 24 h (`WA_WEBHOOK_JANELA_SEGUNDOS` muda), e o limite no
// futuro continua apertado (5 min): relógio adiantado é erro nosso, e carimbo
// muito à frente é tentativa de esticar a validade.
//
// Recusas, nesta ordem, antes de qualquer efeito:
//   1. cabeçalho ausente ou malformado  → 401
//   2. HMAC que não confere             → 401
//   3. corpo sem carimbo algum          → 400
//   4. carimbo fora da janela           → 401
// =============================================================================

import { iguaisEmTempoConstante } from '../_compartilhado/assinatura.ts';

const codificador = new TextEncoder();

/** Janela padrão de aceitação do carimbo do corpo, em segundos. */
export const JANELA_PADRAO_SEGUNDOS = 86_400;

/** Folga para o futuro: relógio adiantado nosso, não reenvio. */
export const FOLGA_FUTURO_SEGUNDOS = 300;

export type RecusaDaMeta =
  | 'assinatura_ausente'
  | 'assinatura_malformada'
  | 'assinatura_invalida'
  | 'carimbo_ausente'
  | 'carimbo_fora_da_janela';

export type ResultadoDaMeta =
  { ok: true; carimbo: number } | { ok: false; codigo: RecusaDaMeta; detalhe: string };

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** `sha256=<hex>` sobre o corpo cru, que é o que a Meta manda. */
export async function assinarComoMeta(segredo: string, corpoCru: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bruto = await crypto.subtle.sign('HMAC', chave, codificador.encode(corpoCru));
  return `sha256=${hex(bruto)}`;
}

/**
 * O carimbo do corpo: o MAIOR dos segundos de época que o payload declara.
 *
 * O maior, e não o menor, porque uma entrega pode trazer vários fatos e o que
 * interessa é "quão velha é a coisa mais nova aqui dentro" — julgar a entrega
 * pelo fato mais antigo recusaria um lote legítimo por causa de um item que
 * demorou.
 *
 * Devolve `null` quando não há carimbo nenhum, e aí a requisição é recusada:
 * corpo sem carimbo é corpo sem defesa contra reenvio.
 */
export function carimboDoCorpo(payload: unknown): number | null {
  // Sentinela numérica em vez de `number | null`: a variável é capturada por
  // uma closure e reatribuída, e zero não é um instante de época possível.
  let maior = 0;

  const considerar = (valor: unknown): void => {
    // A Meta manda `entry[].time` como número e `timestamp` como string.
    const n = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor) : NaN;
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return;
    // Alguns campos vêm em milissegundos; qualquer coisa acima de 10^11 não é
    // um segundo de época plausível (seria o ano 5138).
    const segundos = n > 100_000_000_000 ? Math.floor(n / 1000) : n;
    if (segundos > maior) maior = segundos;
  };

  const objeto = (v: unknown): Record<string, unknown> | null =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;

  const raiz = objeto(payload);
  if (!raiz) return null;
  const entradas = Array.isArray(raiz.entry) ? raiz.entry : [];
  for (const entradaBruta of entradas) {
    const entrada = objeto(entradaBruta);
    if (!entrada) continue;
    considerar(entrada.time);
    const mudancas = Array.isArray(entrada.changes) ? entrada.changes : [];
    for (const mudancaBruta of mudancas) {
      const mudanca = objeto(mudancaBruta);
      const valor = mudanca && objeto(mudanca.value);
      if (!valor) continue;
      for (const campo of ['messages', 'statuses', 'message_echoes']) {
        const lista = Array.isArray(valor[campo]) ? (valor[campo] as unknown[]) : [];
        for (const itemBruto of lista) {
          const item = objeto(itemBruto);
          if (item) considerar(item.timestamp);
        }
      }
    }
  }
  return maior > 0 ? maior : null;
}

/**
 * Confere a assinatura da Meta e o carimbo que veio dentro do corpo assinado.
 * `corpoCru` tem de ser exatamente o texto lido de `request.text()`: reserializar
 * o JSON reordena chaves e o HMAC deixa de bater sem que nada esteja errado.
 */
export async function verificarDaMeta(opcoes: {
  segredo: string;
  corpoCru: string;
  assinaturaRecebida: string | null;
  payload?: unknown;
  janelaSegundos?: number;
  agoraSegundos?: number;
}): Promise<ResultadoDaMeta> {
  const janela = opcoes.janelaSegundos ?? JANELA_PADRAO_SEGUNDOS;
  const agora = opcoes.agoraSegundos ?? Math.floor(Date.now() / 1000);

  if (!opcoes.assinaturaRecebida) {
    return { ok: false, codigo: 'assinatura_ausente', detalhe: 'sem X-Hub-Signature-256' };
  }
  if (!/^sha256=[0-9a-f]{64}$/.test(opcoes.assinaturaRecebida)) {
    return {
      ok: false,
      codigo: 'assinatura_malformada',
      detalhe: 'formato esperado sha256=<64 hex>',
    };
  }

  const esperada = await assinarComoMeta(opcoes.segredo, opcoes.corpoCru);
  if (!iguaisEmTempoConstante(esperada, opcoes.assinaturaRecebida)) {
    return { ok: false, codigo: 'assinatura_invalida', detalhe: 'HMAC não confere' };
  }

  // O corpo só é lido como JSON DEPOIS de a assinatura conferir. Antes disso ele
  // é uma sequência de bytes de origem desconhecida.
  let payload = opcoes.payload;
  if (payload === undefined) {
    try {
      payload = JSON.parse(opcoes.corpoCru);
    } catch {
      payload = null;
    }
  }

  const carimbo = carimboDoCorpo(payload);
  if (carimbo === null) {
    return {
      ok: false,
      codigo: 'carimbo_ausente',
      detalhe: 'o corpo assinado não declara nenhum instante (entry[].time nem timestamp)',
    };
  }
  if (carimbo > agora + FOLGA_FUTURO_SEGUNDOS) {
    return {
      ok: false,
      codigo: 'carimbo_fora_da_janela',
      detalhe: `carimbo ${carimbo - agora}s no futuro`,
    };
  }
  if (agora - carimbo > janela) {
    return {
      ok: false,
      codigo: 'carimbo_fora_da_janela',
      detalhe: `carimbo ${agora - carimbo}s no passado, janela de ${janela}s`,
    };
  }
  return { ok: true, carimbo };
}

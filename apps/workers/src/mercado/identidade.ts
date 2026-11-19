/**
 * Como o robô se apresenta: de forma honesta e genérica (régua
 * `identificacao` de `mercado_regras` e auditoria de fontes de 18/11/2026).
 *
 *  - diz que é um coletor de dados públicos e qual versão;
 *  - nunca "Mozilla/5.0" (não finge ser navegador) e nunca o nome de outro robô;
 *  - nunca o nome da Imova (decisão do dono: nenhum uso do nome da empresa nas
 *    requisições). O contato, quando o dono definir, é um e-mail genérico, que
 *    entra por `COLETOR_CONTATO` e é recusado se citar a empresa.
 */

export const VERSAO_DO_COLETOR = 'mercado-worker@2026-11-18';
export const TOKEN_DO_ROBO = 'coletor-de-dados-publicos';

/** Palavras que não podem aparecer na identificação (o nome da empresa e os portais). */
const PROIBIDAS_NA_IDENTIFICACAO = /imova|triade|tr[ií]ade|komune|canal ?pro|zap|olx|viva ?real/i;

export function contatoValido(
  contato: string | undefined,
): { ok: true } | { ok: false; motivo: string } {
  if (contato === undefined || contato.trim() === '') return { ok: true };
  const c = contato.trim();
  if (!/^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(c)) {
    return {
      ok: false,
      motivo: 'COLETOR_CONTATO deve ser só um e-mail (ex.: dados.publicos@exemplo.com)',
    };
  }
  if (PROIBIDAS_NA_IDENTIFICACAO.test(c)) {
    return {
      ok: false,
      motivo: 'COLETOR_CONTATO não pode citar a empresa nem portal: use um e-mail genérico',
    };
  }
  return { ok: true };
}

/** O User-Agent de todo pedido do worker de mercado. */
export function userAgent(contato?: string): string {
  const c = contato?.trim();
  return `${TOKEN_DO_ROBO}/1.0${c ? ` (+contato: ${c})` : ' (dados abertos; uso interno)'}`;
}

/**
 * O recado entre a tela de ligar e a caixa de mandar WhatsApp.
 *
 * Quem acabou de marcar uma reunião ao telefone toca em "Mandar confirmação no
 * WhatsApp" no recibo, e a caixa da conversa abre com o modelo certo escolhido e o dia,
 * a hora e o formato já preenchidos. O recado não viaja na URL porque a tela Conversas
 * reescreve a query string (`urlDoEstado`) e apagaria os parâmetros antes de a caixa
 * montar; ele fica no `localStorage` (a conversa abre em outra aba, e o
 * `sessionStorage` não atravessa abas), preso à organização e com prazo curto.
 *
 * Nada aqui envia mensagem: a pessoa ainda revê o texto e toca em Enviar, e o banco
 * continua decidindo tudo no clique (supressão, horário, teto).
 */

const CHAVE = 'triade.conversas.pedido-de-modelo.v1';

/** Depois disso o recado vira lixo: ninguém quer um modelo escolhido há uma hora. */
export const PRAZO_DO_PEDIDO_MS = 15 * 60_000;

export type PedidoDeModelo = {
  organizacaoId: string;
  /** `message_templates.template_code`. */
  codigo: string;
  valores: Record<string, string>;
  /** `Date.now()` de quando o recibo guardou. */
  em: number;
};

export function guardarPedidoDeModelo(pedido: Omit<PedidoDeModelo, 'em'>, agora = Date.now()) {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify({ ...pedido, em: agora }));
  } catch {
    // Aba anônima ou armazenamento bloqueado: a caixa abre sem nada escolhido.
  }
}

/** O recado para esta organização, se ainda vale. */
export function lerPedidoDeModelo(
  organizacaoId: string,
  agora = Date.now(),
): PedidoDeModelo | null {
  try {
    return pedidoValido(window.localStorage.getItem(CHAVE), organizacaoId, agora);
  } catch {
    return null;
  }
}

export function esquecerPedidoDeModelo() {
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    // nada a esquecer
  }
}

/** A regra, sem `window`: o que foi guardado vale para esta organização, agora? */
export function pedidoValido(
  bruto: string | null,
  organizacaoId: string,
  agora: number,
): PedidoDeModelo | null {
  if (!bruto) return null;
  let lido: unknown;
  try {
    lido = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (typeof lido !== 'object' || lido === null) return null;
  const p = lido as Partial<PedidoDeModelo>;
  if (p.organizacaoId !== organizacaoId || typeof p.codigo !== 'string') return null;
  if (typeof p.em !== 'number' || agora - p.em > PRAZO_DO_PEDIDO_MS || p.em > agora + 60_000) {
    return null;
  }
  const valores: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(p.valores ?? {})) {
    if (typeof valor === 'string') valores[chave] = valor;
  }
  return { organizacaoId, codigo: p.codigo, valores, em: p.em };
}

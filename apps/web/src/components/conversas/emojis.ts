/**
 * Os emojis da caixa de escrever e das reações (27/10/2026), e o ritmo do
 * "digitando…".
 *
 * UMA GRADE ESCOLHIDA, SEM BIBLIOTECA. Um seletor completo traz 3.600 emojis,
 * busca por nome em inglês e 300 KB de dados para uma caixa que o time usa para
 * mandar "bom dia 🙏" a um buffet. Aqui ficam os que uma conversa de trabalho
 * usa, em cinco grupos — e, por serem texto, qualquer outro continua entrando
 * pelo teclado do celular.
 */

/** A fileira de um toque, a mesma do WhatsApp. */
export const REACOES_RAPIDAS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

// A grade em linhas de 12, como aparece na tela: mais fácil de conferir assim.
// prettier-ignore
export const GRUPOS_DE_EMOJIS: readonly { nome: string; emojis: readonly string[] }[] = [
  {
    nome: 'Rostos',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇',
      '🥰', '😍', '🤩', '😘', '😋', '😎', '🤗', '🤔', '🤨', '😐', '😶', '🙄',
      '😏', '😬', '😌', '😴', '🥳', '😮', '😲', '🥺', '😢', '😭', '😤', '😱',
    ],
  },
  {
    nome: 'Gestos',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤝', '👏', '🙌', '🙏', '💪', '👋', '🤙',
      '👉', '👆', '✋', '🫶', '❤️', '💚', '💙', '💛', '🧡', '💜', '🖤', '💯',
    ],
  },
  {
    nome: 'Festa',
    emojis: [
      '🎉', '🎊', '🥂', '🍾', '🎂', '🍰', '🎈', '🎁', '💐', '🌹', '🌸', '✨',
      '🎶', '🎤', '🎧', '📸', '🎬', '💃', '🕺', '👰', '🤵', '💍', '🍽️', '🍕',
    ],
  },
  {
    nome: 'Trabalho',
    emojis: [
      '✅', '☑️', '❌', '⚠️', '❗', '❓', '📌', '📍', '📅', '⏰', '⏳', '📞',
      '📱', '💬', '📧', '📝', '📄', '📎', '💰', '💳', '📈', '🚀', '🔥', '⭐',
    ],
  },
  {
    nome: 'Natal',
    emojis: ['☀️', '🌴', '🏖️', '🌊', '🚗', '🏠', '🏢', '🎪', '🍹', '🦀', '🍤', '🥥'],
  },
];

/**
 * O texto com o emoji no lugar do cursor (ou da seleção), e onde o cursor fica
 * depois dele. Fora dos limites, o cursor vai para o fim — o caso de quem
 * escolhe o emoji sem ter tocado na caixa antes.
 */
export function inserirNoCursor(
  texto: string,
  inicio: number | null | undefined,
  fim: number | null | undefined,
  trecho: string,
): { texto: string; cursor: number } {
  const de = inicio != null && inicio >= 0 && inicio <= texto.length ? inicio : texto.length;
  const ate = fim != null && fim >= de && fim <= texto.length ? fim : de;
  const novo = `${texto.slice(0, de)}${trecho}${texto.slice(ate)}`;
  return { texto: novo, cursor: de + trecho.length };
}

/**
 * De quanto em quanto tempo a tela avisa a Meta que alguém está digitando.
 *
 * A Meta mostra os três pontinhos por 25 s (ou até a resposta sair), e o banco
 * aceita um pedido a cada 20 s por conversa (`public.conversa_digitando`).
 * Quinze segundos mantêm os pontinhos acesos sem pedir à toa.
 */
export const INTERVALO_DO_DIGITANDO_MS = 15_000;

/**
 * Avisar agora? Só com texto na caixa (apagar tudo não é estar digitando), e
 * só passado o intervalo desde o último aviso desta conversa.
 */
export function deveAvisarDigitando({
  ultimoEm,
  agora,
  texto,
  intervaloMs = INTERVALO_DO_DIGITANDO_MS,
}: {
  ultimoEm: number | null;
  agora: number;
  texto: string;
  intervaloMs?: number;
}): boolean {
  if (texto.trim() === '') return false;
  return ultimoEm === null || agora - ultimoEm >= intervaloMs;
}

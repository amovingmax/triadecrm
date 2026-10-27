/**
 * Fixar e silenciar conversa (27/10/2026): são de CADA PESSOA, e não da
 * conversa — o que a Ana fixou não sobe na lista do Janio
 * (`public.conversa_preferencias`, que a RLS recorta por `auth.uid()`).
 *
 * Contas puras, para a lista, o cabeçalho e o número do menu dizerem a mesma
 * coisa.
 */

export type PreferenciaDaConversa = {
  fixadaEm: string | null;
  silenciadaAte: string | null;
};

/** Por id da conversa (`conversations.id`). */
export type Preferencias = ReadonlyMap<string, PreferenciaDaConversa>;

export const SEM_PREFERENCIAS: Preferencias = new Map();

/** Três, como no WhatsApp: fixar tudo é não fixar nada (`conversa_fixar`). */
export const TETO_DE_FIXADAS = 3;

/**
 * Silenciada agora? `infinity` é "para sempre" (o Postgres devolve a palavra,
 * que `Date.parse` não lê).
 */
export function ehSilenciada(ate: string | null | undefined, agora: number = Date.now()): boolean {
  if (!ate) return false;
  if (/^infinity$/i.test(ate.trim())) return true;
  const fim = Date.parse(ate);
  return Number.isFinite(fim) && fim > agora;
}

/** As fixadas no topo (a fixada por último primeiro); o resto na ordem que veio. */
export function fixadasPrimeiro<T>(
  linhas: readonly T[],
  idDaConversa: (linha: T) => string | null | undefined,
  preferencias: Preferencias,
): T[] {
  if (preferencias.size === 0) return [...linhas];
  const fixadas: { linha: T; em: string }[] = [];
  const resto: T[] = [];
  for (const linha of linhas) {
    const id = idDaConversa(linha);
    const em = id ? preferencias.get(id)?.fixadaEm : null;
    if (em) fixadas.push({ linha, em });
    else resto.push(linha);
  }
  fixadas.sort((a, b) => b.em.localeCompare(a.em));
  return [...fixadas.map((f) => f.linha), ...resto];
}

export type Silencio = '8h' | 'semana' | 'sempre';

export const SILENCIOS: readonly { id: Silencio; rotulo: string }[] = [
  { id: '8h', rotulo: '8 horas' },
  { id: 'semana', rotulo: '1 semana' },
  { id: 'sempre', rotulo: 'Sempre' },
];

/** Até quando, no formato que `conversa_silenciar` recebe. */
export function ateDoSilencio(silencio: Silencio, agora: number = Date.now()): string {
  switch (silencio) {
    case '8h':
      return new Date(agora + 8 * 3_600_000).toISOString();
    case 'semana':
      return new Date(agora + 7 * 86_400_000).toISOString();
    case 'sempre':
      return 'infinity';
  }
}

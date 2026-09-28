/**
 * As iniciais de um nome — "Heloísa Andrade" → "HA".
 *
 * Mora SOZINHA neste arquivo, e não em `lib/auth/session.ts`, por um motivo que
 * custou um build quebrado em 28/09/2026: `session.ts` importa
 * `lib/supabase/server`, que importa `next/headers`. Isso faz dele um módulo de
 * servidor. Quando os balões da conversa (que são componentes de cliente)
 * passaram a mostrar o retrato de quem falou, importar a função de lá arrastou
 * `next/headers` para o pacote do navegador e o `next build` recusou — depois de
 * lint, typecheck e 1.654 testes passarem, porque nenhum deles compila para o
 * navegador.
 *
 * Função pura, sem dependência: serve aos dois lados.
 */
export function iniciaisDe(nome: string): string {
  const partes = nome
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2);
  const letras = partes.map((p) => p.charAt(0).toUpperCase()).join('');
  return letras || '?';
}

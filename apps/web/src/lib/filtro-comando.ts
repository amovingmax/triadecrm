/**
 * Busca da paleta de comandos. Lógica pura, fora do componente, para poder ser
 * testada sem DOM (o Vitest do apps/web roda em `node`).
 */

/** Remove acento para comparar: quem digita rápido, na rua, digita "relatorios" e "funis". */
export function semAcento(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Filtro do cmdk: sem acento e sem exigir a ordem das palavras, de modo que
 * "novo parc" e "parceiro novo" achem a mesma ação. Devolve 1 (mostra) ou 0 (esconde);
 * a ordem da lista continua sendo a que o componente escreveu, que já é a ordem da
 * navegação e não uma pontuação inventada.
 */
export function filtrarComando(valor: string, busca: string, palavrasChave?: string[]): number {
  const alvo = semAcento([valor, ...(palavrasChave ?? [])].join(' '));
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return 1;
  return termos.every((termo) => alvo.includes(termo)) ? 1 : 0;
}

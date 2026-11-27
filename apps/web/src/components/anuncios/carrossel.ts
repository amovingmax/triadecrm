/**
 * As contas do carrossel de fotos do cartão do anúncio (09/11/2026; levado ao
 * cartão redesenhado em 27/11/2026): qual foto está à vista, quais arquivos já
 * podem ser pedidos e quais pontinhos aparecem. Sem React, para o Vitest conferir.
 */

/** Qual foto está à vista, pela rolagem do trilho (cada foto ocupa a largura toda). */
export function fotoAVista(rolagem: number, largura: number, total: number): number {
  if (largura <= 0 || total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, Math.round(rolagem / largura)));
}

/**
 * As fotos cujo arquivo já pode ser pedido quando `atual` está à vista: ela e as
 * duas vizinhas, para a próxima já estar pronta quando a pessoa passar.
 */
export function vizinhasDaFoto(atual: number, total: number): number[] {
  return [atual - 1, atual, atual + 1].filter((i) => i >= 0 && i < total);
}

/** Junta as vizinhas às fotos já pedidas; devolve o mesmo conjunto quando nada muda. */
export function juntarFotos(pedidas: ReadonlySet<number>, novas: number[]): ReadonlySet<number> {
  if (novas.every((i) => pedidas.has(i))) return pedidas;
  return new Set([...pedidas, ...novas]);
}

export type TamanhoDoPonto = 'cheio' | 'medio' | 'pequeno';
export type PontoDoCarrossel = { indice: number; tamanho: TamanhoDoPonto };

/**
 * Os pontinhos debaixo da foto, no máximo `maximo`, andando junto com a foto à
 * vista. Quando há mais fotos do que pontos, os da ponta diminuem para dizer
 * que a fila continua (como no Instagram). O da foto à vista nunca diminui.
 */
export function pontosDoCarrossel(total: number, atual: number, maximo = 5): PontoDoCarrossel[] {
  if (total <= 1 || maximo < 1) return [];
  const vista = Math.min(total - 1, Math.max(0, atual));
  if (total <= maximo) {
    return Array.from({ length: total }, (_, i) => ({ indice: i, tamanho: 'cheio' as const }));
  }
  const inicio = Math.min(Math.max(0, vista - Math.floor(maximo / 2)), total - maximo);
  const fim = inicio + maximo - 1;
  const temAntes = inicio > 0;
  const temDepois = fim < total - 1;
  return Array.from({ length: maximo }, (_, k) => {
    const indice = inicio + k;
    let tamanho: TamanhoDoPonto = 'cheio';
    if ((temAntes && k === 0) || (temDepois && k === maximo - 1)) tamanho = 'pequeno';
    else if ((temAntes && k === 1) || (temDepois && k === maximo - 2)) tamanho = 'medio';
    if (indice === vista) tamanho = 'cheio';
    return { indice, tamanho };
  });
}

/**
 * Separa os anúncios em grupos que cabem numa leitura só de `anuncio_fotos`: o
 * PostgREST devolve no máximo 1.000 linhas por pedido (`max_rows`) e um anúncio
 * pode ter até 60 fotos. Usa a contagem que a lista já traz.
 */
export function gruposDeLeitura(
  anuncios: { id: string; fotos: number }[],
  teto = 1000,
): string[][] {
  const grupos: string[][] = [];
  let grupo: string[] = [];
  let soma = 0;
  for (const a of anuncios) {
    if (grupo.length > 0 && soma + a.fotos > teto) {
      grupos.push(grupo);
      grupo = [];
      soma = 0;
    }
    grupo.push(a.id);
    soma += a.fotos;
  }
  if (grupo.length > 0) grupos.push(grupo);
  return grupos;
}

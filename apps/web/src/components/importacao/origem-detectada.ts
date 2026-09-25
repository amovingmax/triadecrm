/**
 * De onde veio este arquivo, lido no cabeçalho.
 *
 * POR QUÊ, e é medido: o seletor "De onde veio esta lista" nasce em *Planilha*,
 * e o CSV do Google Maps precisa de *Google Maps*. Com o seletor errado, o mapa
 * de categorias da fonte nem é consultado — em 25/09/2026 as 20 linhas dos
 * fotógrafos viraram 0 fichas e 19 cartões de fila, em silêncio. Nenhuma
 * palavra da tela ligava aquela escolha ao resultado.
 *
 * A regra: `cid` presente E (`plus_code` OU `data_id`). São identificadores
 * internos do Maps; planilha escrita por gente não tem isso. Duas colunas, e
 * não uma, para não confundir com uma planilha que alguém tenha copiado meia
 * coluna do Maps para dentro.
 *
 * O que a tela mostra é um FATO CONTESTÁVEL, não um menu: a linha diz o que o
 * CRM reconheceu e por quê, e o "não é?" abre o seletor de sempre. A escolha
 * manual vence a detecção e continua sendo o que fica gravado no lote.
 *
 * Módulo puro: sem React, sem banco.
 */
import { chave } from './mapeamento';
import type { OrigemDeArquivo } from './tipos';

/** Sem esta coluna não há detecção: `cid` é a identidade do lugar no Maps. */
const EXIGIDA = 'cid';

/**
 * Uma destas basta, junto do `cid`.
 *
 * Já normalizadas por `chave`: `chave('plus_code')` é `'plus code'` e
 * `chave('data_id')` é `'data id'`.
 */
const ACOMPANHANTES = ['plus code', 'data id'] as const;

export type OrigemDetectada = {
  /** A fonte do catálogo que a tela vai escolher. Nula só se não houver nenhuma. */
  origem: OrigemDeArquivo | null;
  /** O que ficou ESCOLHIDO — e não o que foi lido. Ver a nota no fim da função. */
  slug: 'google_maps_raspado' | 'planilha';
  /**
   * Os nomes das colunas que sustentam a afirmação, como estão escritos no
   * arquivo. Vazio quando não há afirmação a fazer: a tela então diz que não
   * encontrou coluna nenhuma do Maps, em vez de inventar um motivo.
   */
  porque: string[];
};

export function detectarOrigem(
  cabecalho: readonly string[],
  origens: readonly OrigemDeArquivo[],
): OrigemDetectada {
  // Do nome normalizado para o nome como está escrito no arquivo: é o segundo
  // que vai à tela, porque é o que a pessoa vê ao abrir o CSV.
  const porChave = new Map<string, string>();
  for (const titulo of cabecalho) {
    const k = chave(titulo);
    if (k && !porChave.has(k)) porChave.set(k, titulo.trim());
  }

  const acompanhantes = ACOMPANHANTES.filter((k) => porChave.has(k));
  const ehMaps = porChave.has(EXIGIDA) && acompanhantes.length > 0;

  const slugLido = ehMaps ? 'google_maps_raspado' : 'planilha';
  const origem =
    origens.find((o) => o.slug === slugLido) ??
    origens.find((o) => o.slug === 'planilha') ??
    origens[0] ??
    null;

  // O que a tela AFIRMA é o que ficou escolhido, não o que foi lido. Sem a
  // fonte do Maps no catálogo, a leitura não vale como fato: a linha diria
  // "Planilha — reconheci por cid, plus_code", que é o contrário do que fica
  // gravado no lote.
  const slug: OrigemDetectada['slug'] =
    origem?.slug === 'google_maps_raspado' ? 'google_maps_raspado' : 'planilha';
  const porque =
    slug === 'google_maps_raspado'
      ? [porChave.get(EXIGIDA)!, ...acompanhantes.map((k) => porChave.get(k)!)]
      : [];

  return { origem, slug, porque };
}

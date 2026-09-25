/**
 * A origem lida no cabeçalho. O que precisa ser verdade:
 *   · os dois CSV de verdade de `listas/` são reconhecidos como Google Maps;
 *   · uma exportação mais velha do Maps (29 colunas, com BOM, sem `data_id`)
 *     também é — a regra não pode estar grudada no formato de hoje;
 *   · a planilha-ponte continua sendo planilha, e sem motivo inventado;
 *   · sem a fonte do Maps no catálogo, a tela não afirma o que não escolheu.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { detectarOrigem } from './origem-detectada';
import { lerCsv } from './planilha';
import type { OrigemDeArquivo } from './tipos';

const ORIGENS: readonly OrigemDeArquivo[] = [
  { id: 1, slug: 'planilha', nome: 'Planilha (importação)' },
  { id: 13, slug: 'google_maps_raspado', nome: 'Google Maps (raspagem local)' },
];

function cabecalhoDe(nome: string): string[] {
  return lerCsv(
    readFileSync(fileURLToPath(new URL(`./fixtures/${nome}`, import.meta.url)), 'utf8'),
    nome,
  ).cabecalho;
}

describe('detectarOrigem', () => {
  it('reconhece o CSV de 36 colunas dos fotógrafos, e diz por quê', () => {
    const d = detectarOrigem(cabecalhoDe('maps-natal-fotografo.csv'), ORIGENS);
    expect(d.slug).toBe('google_maps_raspado');
    expect(d.origem?.id).toBe(13);
    expect(d.porque).toEqual(['cid', 'plus_code', 'data_id']);
  });

  it('reconhece também o CSV dos buffets', () => {
    const d = detectarOrigem(cabecalhoDe('maps-natal-buffet-36.csv'), ORIGENS);
    expect(d.slug).toBe('google_maps_raspado');
    expect(d.porque).toEqual(['cid', 'plus_code', 'data_id']);
  });

  it('reconhece a exportação mais velha, de 29 colunas, com BOM e sem data_id', () => {
    const d = detectarOrigem(cabecalhoDe('maps-natal-buffet.csv'), ORIGENS);
    expect(d.slug).toBe('google_maps_raspado');
    // Sem `data_id`: o `plus_code` sozinho já sustenta a afirmação.
    expect(d.porque).toEqual(['cid', 'plus_code']);
  });

  it('a planilha-ponte continua sendo planilha, e sem motivo inventado', () => {
    const d = detectarOrigem(cabecalhoDe('planilha-ponte-preenchida.csv'), ORIGENS);
    expect(d.slug).toBe('planilha');
    expect(d.origem?.id).toBe(1);
    expect(d.porque).toEqual([]);
  });

  it('cid sozinho não basta: meia coluna copiada do Maps não vira lote de raspagem', () => {
    const d = detectarOrigem(['nome', 'telefone', 'cid'], ORIGENS);
    expect(d.slug).toBe('planilha');
    expect(d.porque).toEqual([]);
  });

  it('plus_code sem cid também não basta', () => {
    const d = detectarOrigem(['nome', 'plus_code'], ORIGENS);
    expect(d.slug).toBe('planilha');
  });

  it('quando a fonte do Maps não está no catálogo, a tela não promete o que não escolheu', () => {
    const so = ORIGENS.slice(0, 1);
    const d = detectarOrigem(['cid', 'plus_code'], so);
    expect(d.origem?.id).toBe(1);
    // Sem esta regra, a linha diria "Planilha — reconheci por cid, plus_code",
    // que é o contrário do que está gravado no lote.
    expect(d.slug).toBe('planilha');
    expect(d.porque).toEqual([]);
  });

  it('sem fonte nenhuma no catálogo, devolve nulo em vez de inventar', () => {
    const d = detectarOrigem(['cid', 'plus_code'], []);
    expect(d.origem).toBeNull();
    expect(d.slug).toBe('planilha');
  });
});

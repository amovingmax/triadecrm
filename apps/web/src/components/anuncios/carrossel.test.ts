import { describe, expect, it } from 'vitest';

import {
  fotoAVista,
  gruposDeLeitura,
  juntarFotos,
  pontosDoCarrossel,
  vizinhasDaFoto,
} from './carrossel';

describe('fotoAVista', () => {
  it('arredonda pela largura da foto', () => {
    expect(fotoAVista(0, 300, 17)).toBe(0);
    expect(fotoAVista(149, 300, 17)).toBe(0);
    expect(fotoAVista(151, 300, 17)).toBe(1);
    expect(fotoAVista(600.4, 300, 17)).toBe(2);
  });

  it('não passa das pontas', () => {
    expect(fotoAVista(-40, 300, 5)).toBe(0);
    expect(fotoAVista(9000, 300, 5)).toBe(4);
  });

  it('sem largura ou sem foto, fica na primeira', () => {
    expect(fotoAVista(500, 0, 5)).toBe(0);
    expect(fotoAVista(500, 300, 0)).toBe(0);
  });
});

describe('vizinhasDaFoto', () => {
  it('pede a foto à vista e as duas do lado', () => {
    expect(vizinhasDaFoto(3, 17)).toEqual([2, 3, 4]);
  });

  it('nas pontas, só o que existe', () => {
    expect(vizinhasDaFoto(0, 17)).toEqual([0, 1]);
    expect(vizinhasDaFoto(16, 17)).toEqual([15, 16]);
    expect(vizinhasDaFoto(0, 1)).toEqual([0]);
  });
});

describe('juntarFotos', () => {
  it('devolve o mesmo conjunto quando nada é novo', () => {
    const pedidas = new Set([0, 1]);
    expect(juntarFotos(pedidas, [0, 1])).toBe(pedidas);
  });

  it('acrescenta sem tirar as que já foram pedidas', () => {
    expect([...juntarFotos(new Set([0, 1]), [1, 2])].sort()).toEqual([0, 1, 2]);
  });
});

describe('pontosDoCarrossel', () => {
  const tamanhos = (total: number, atual: number) =>
    pontosDoCarrossel(total, atual).map((p) => p.tamanho);
  const indices = (total: number, atual: number) =>
    pontosDoCarrossel(total, atual).map((p) => p.indice);

  it('uma foto só não tem pontos', () => {
    expect(pontosDoCarrossel(1, 0)).toEqual([]);
    expect(pontosDoCarrossel(0, 0)).toEqual([]);
  });

  it('até cinco fotos, um ponto cheio para cada', () => {
    expect(indices(4, 2)).toEqual([0, 1, 2, 3]);
    expect(tamanhos(4, 2)).toEqual(['cheio', 'cheio', 'cheio', 'cheio']);
  });

  it('com 17 fotos, no começo, os da direita diminuem', () => {
    expect(indices(17, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(tamanhos(17, 0)).toEqual(['cheio', 'cheio', 'cheio', 'medio', 'pequeno']);
  });

  it('no meio, a foto à vista fica no centro e as duas pontas diminuem', () => {
    expect(indices(17, 8)).toEqual([6, 7, 8, 9, 10]);
    expect(tamanhos(17, 8)).toEqual(['pequeno', 'medio', 'cheio', 'medio', 'pequeno']);
  });

  it('no fim, os da esquerda diminuem', () => {
    expect(indices(17, 16)).toEqual([12, 13, 14, 15, 16]);
    expect(tamanhos(17, 16)).toEqual(['pequeno', 'medio', 'cheio', 'cheio', 'cheio']);
  });

  it('o ponto da foto à vista nunca diminui', () => {
    for (let atual = 0; atual < 17; atual++) {
      const ponto = pontosDoCarrossel(17, atual).find((p) => p.indice === atual);
      expect(ponto?.tamanho).toBe('cheio');
    }
  });

  it('foto à vista fora da conta fica na ponta', () => {
    expect(indices(17, 40)).toEqual([12, 13, 14, 15, 16]);
  });
});

describe('gruposDeLeitura', () => {
  it('cabe tudo numa leitura quando a soma não passa do teto', () => {
    expect(
      gruposDeLeitura([
        { id: 'a', fotos: 17 },
        { id: 'b', fotos: 12 },
      ]),
    ).toEqual([['a', 'b']]);
  });

  it('abre outra leitura antes de passar das 1.000 linhas', () => {
    const anuncios = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, fotos: 60 }));
    const grupos = gruposDeLeitura(anuncios);
    expect(grupos.map((g) => g.length)).toEqual([16, 4]);
    expect(grupos.flat()).toHaveLength(20);
  });

  it('nenhum anúncio, nenhuma leitura', () => {
    expect(gruposDeLeitura([])).toEqual([]);
  });
});

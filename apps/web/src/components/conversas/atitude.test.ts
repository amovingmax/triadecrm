import { describe, expect, it } from 'vitest';

import {
  montarAtitudes,
  porInteresse,
  posicaoDeInteresse,
  textoDaAtitude,
  type AtitudeCrua,
} from './atitude-regra';

function crua(id: string, etiqueta: string | null, extra: Partial<AtitudeCrua> = {}): AtitudeCrua {
  return {
    conversation_id: id,
    etiqueta,
    antes_de_esfriar: null,
    motivo: `motivo de ${id}`,
    desde: '2026-10-29T12:00:00Z',
    marcada: null,
    ...extra,
  };
}

describe('montarAtitudes', () => {
  it('monta por conversa, com as objeções abertas de cada uma', () => {
    const mapa = montarAtitudes(
      [crua('a', 'interessado'), crua('b', 'muito_interessado', { marcada: 'muito_interessado' })],
      [
        { conversation_id: 'a', objecao_id: 1 },
        { conversation_id: 'a', objecao_id: 3 },
      ],
    );
    expect(mapa.get('a')?.objecoes).toEqual([1, 3]);
    expect(mapa.get('b')?.objecoes).toEqual([]);
    expect(mapa.get('b')?.marcada).toBe('muito_interessado');
  });

  it('deixa de fora a conversa sem etiqueta e o valor que o banco não conhece', () => {
    const mapa = montarAtitudes([crua('a', null), crua('b', 'vip'), crua('c', 'morno')], []);
    expect([...mapa.keys()]).toEqual(['c']);
  });

  it('só aceita como toque as quatro etiquetas que a pessoa pode dar', () => {
    const mapa = montarAtitudes([crua('a', 'esfriando', { marcada: 'esfriando' })], []);
    expect(mapa.get('a')?.marcada).toBeNull();
  });
});

describe('"Mais interessados"', () => {
  const mapa = montarAtitudes(
    [
      crua('frio', 'sem_interesse'),
      crua('quente', 'muito_interessado'),
      crua('esfriando', 'esfriando', { antes_de_esfriar: 'muito_interessado' }),
      crua('morno', 'morno'),
      crua('quer', 'interessado'),
      crua('parar', 'nao_contatar'),
      crua('calado', 'sem_resposta'),
    ],
    [],
  );

  it('vai do mais interessado ao não contatar, e quem não tem etiqueta fica no fim', () => {
    const linhas = ['sem-etiqueta', 'frio', 'parar', 'morno', 'calado', 'esfriando', 'quer', 'quente'];
    expect(porInteresse(linhas, (l) => l, mapa)).toEqual([
      'quente',
      'quer',
      'esfriando',
      'morno',
      'calado',
      'frio',
      'parar',
      'sem-etiqueta',
    ]);
  });

  it('dentro da mesma etiqueta mantém a ordem que a lista já tinha', () => {
    const dois = montarAtitudes([crua('x', 'interessado'), crua('y', 'interessado')], []);
    expect(porInteresse(['y', 'x'], (l) => l, dois)).toEqual(['y', 'x']);
    expect(porInteresse(['x', 'y'], (l) => l, dois)).toEqual(['x', 'y']);
  });

  it('a posição de quem não tem etiqueta é a última', () => {
    expect(posicaoDeInteresse(undefined)).toBeGreaterThan(posicaoDeInteresse(mapa.get('parar')));
  });
});

describe('textoDaAtitude', () => {
  it('Esfriando diz o que a pessoa era', () => {
    expect(textoDaAtitude({ etiqueta: 'esfriando', antesDeEsfriar: 'muito_interessado' })).toBe(
      'Esfriando · era muito interessado',
    );
    expect(textoDaAtitude({ etiqueta: 'interessado', antesDeEsfriar: null })).toBe('Interessado');
  });
});

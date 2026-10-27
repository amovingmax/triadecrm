import { describe, expect, it } from 'vitest';

import {
  deveAvisarDigitando,
  GRUPOS_DE_EMOJIS,
  inserirNoCursor,
  INTERVALO_DO_DIGITANDO_MS,
  REACOES_RAPIDAS,
} from './emojis';

describe('inserirNoCursor', () => {
  it('põe o emoji onde o cursor está e anda o cursor', () => {
    expect(inserirNoCursor('bom dia', 3, 3, '🙏')).toEqual({ texto: 'bom🙏 dia', cursor: 5 });
  });

  it('troca a seleção pelo emoji', () => {
    expect(inserirNoCursor('bom dia', 4, 7, '☀️')).toEqual({ texto: 'bom ☀️', cursor: 6 });
  });

  it('sem cursor (a caixa nunca foi tocada), vai para o fim', () => {
    expect(inserirNoCursor('oi', null, null, '👋')).toEqual({ texto: 'oi👋', cursor: 4 });
    expect(inserirNoCursor('oi', 99, 99, '👋')).toEqual({ texto: 'oi👋', cursor: 4 });
  });
});

describe('deveAvisarDigitando', () => {
  it('avisa na primeira tecla e depois só passado o intervalo', () => {
    expect(deveAvisarDigitando({ ultimoEm: null, agora: 1000, texto: 'o' })).toBe(true);
    expect(deveAvisarDigitando({ ultimoEm: 1000, agora: 1000 + 14_999, texto: 'oi' })).toBe(false);
    expect(
      deveAvisarDigitando({ ultimoEm: 1000, agora: 1000 + INTERVALO_DO_DIGITANDO_MS, texto: 'oi' }),
    ).toBe(true);
  });

  it('caixa vazia (ou só espaço) não é estar digitando', () => {
    expect(deveAvisarDigitando({ ultimoEm: null, agora: 1000, texto: '' })).toBe(false);
    expect(deveAvisarDigitando({ ultimoEm: null, agora: 1000, texto: '   ' })).toBe(false);
  });
});

describe('a grade', () => {
  it('as reações rápidas são as seis do WhatsApp', () => {
    expect(REACOES_RAPIDAS).toEqual(['👍', '❤️', '😂', '😮', '😢', '🙏']);
  });

  it('nenhum emoji se repete dentro de um grupo', () => {
    for (const grupo of GRUPOS_DE_EMOJIS) {
      expect(new Set(grupo.emojis).size).toBe(grupo.emojis.length);
    }
  });
});

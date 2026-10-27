import { describe, expect, it } from 'vitest';

import { ateDoSilencio, ehSilenciada, fixadasPrimeiro } from './preferencias';

const AGORA = Date.parse('2026-10-27T12:00:00Z');

describe('ehSilenciada', () => {
  it('até uma data futura, para sempre, e o silêncio que venceu', () => {
    expect(ehSilenciada('2026-10-27T20:00:00Z', AGORA)).toBe(true);
    expect(ehSilenciada('infinity', AGORA)).toBe(true);
    expect(ehSilenciada('2026-10-27T11:00:00Z', AGORA)).toBe(false);
    expect(ehSilenciada(null, AGORA)).toBe(false);
  });
});

describe('ateDoSilencio', () => {
  it('8 horas, 1 semana e sempre', () => {
    expect(ateDoSilencio('8h', AGORA)).toBe('2026-10-27T20:00:00.000Z');
    expect(ateDoSilencio('semana', AGORA)).toBe('2026-11-03T12:00:00.000Z');
    expect(ateDoSilencio('sempre', AGORA)).toBe('infinity');
  });
});

describe('fixadasPrimeiro', () => {
  it('as fixadas sobem, a fixada por último primeiro; o resto fica na ordem', () => {
    const prefs = new Map([
      ['c', { fixadaEm: '2026-10-27T09:00:00Z', silenciadaAte: null }],
      ['e', { fixadaEm: '2026-10-27T10:00:00Z', silenciadaAte: null }],
      ['b', { fixadaEm: null, silenciadaAte: 'infinity' }],
    ]);
    expect(fixadasPrimeiro(['a', 'b', 'c', 'd', 'e'], (x) => x, prefs)).toEqual([
      'e',
      'c',
      'a',
      'b',
      'd',
    ]);
  });

  it('linha sem conversa nunca é fixada', () => {
    const prefs = new Map([['x', { fixadaEm: '2026-10-27T09:00:00Z', silenciadaAte: null }]]);
    expect(fixadasPrimeiro(['a', 'x'], (l) => (l === 'x' ? null : l), prefs)).toEqual(['a', 'x']);
  });
});

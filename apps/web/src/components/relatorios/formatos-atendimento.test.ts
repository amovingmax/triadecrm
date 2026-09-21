import { describe, expect, it } from 'vitest';

import { formatarMinutos } from './formatos';

describe('o tempo de resposta em linguagem de gente', () => {
  it('minutos, horas e dias', () => {
    expect(formatarMinutos(8)).toBe('8 min');
    expect(formatarMinutos(60)).toBe('1 h');
    expect(formatarMinutos(80)).toBe('1 h 20 min');
    expect(formatarMinutos(60 * 24 * 2)).toBe('2 dias');
  });

  it('sem medida, um traço', () => {
    expect(formatarMinutos(null)).toBe('—');
  });
});

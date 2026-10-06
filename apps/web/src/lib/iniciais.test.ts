import { describe, expect, it } from 'vitest';

import { iniciaisDe } from './iniciais';

describe('iniciaisDe', () => {
  it('as duas primeiras iniciais do nome', () => {
    expect(iniciaisDe('Heloísa Andrade')).toBe('HA');
    expect(iniciaisDe('matheus.rondon')).toBe('MR');
    expect(iniciaisDe('Ênio')).toBe('Ê');
  });

  it('número não vira inicial', () => {
    expect(iniciaisDe('(84) 99999-8801')).toBe('?');
    expect(iniciaisDe('+55 84 99999-8801')).toBe('?');
    expect(iniciaisDe('3 Irmãos Buffet')).toBe('IB');
  });
});

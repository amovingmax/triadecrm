import { describe, expect, it } from 'vitest';

import { navegadorDoComputador } from './instalar-app';

/**
 * Qual passo a passo o item "Instalar o Tríade neste computador" mostra quando o
 * navegador não oferece a pergunta dele. As identificações são as de verdade: o
 * Edge e o Opera dizem "Chrome", o Chrome diz "Safari", e o iPad diz "Macintosh".
 */
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0';
const OPERA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 OPR/121.0.0.0';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0';

describe('navegadorDoComputador', () => {
  it('reconhece o Chrome no Mac e no Windows', () => {
    expect(navegadorDoComputador(CHROME_MAC)).toBe('chrome');
    expect(navegadorDoComputador(CHROME_WINDOWS)).toBe('chrome');
  });

  it('não confunde o Edge com o Chrome', () => {
    expect(navegadorDoComputador(EDGE)).toBe('edge');
  });

  it('reconhece o Safari do Mac, que não diz "Chrome"', () => {
    expect(navegadorDoComputador(SAFARI_MAC)).toBe('safari');
  });

  it('manda Firefox e Opera para o caminho de abrir em outro navegador', () => {
    expect(navegadorDoComputador(FIREFOX)).toBe('outro');
    expect(navegadorDoComputador(OPERA)).toBe('outro');
  });

  it('não oferece o Dock ao iPad, que se apresenta como Mac', () => {
    expect(navegadorDoComputador(SAFARI_MAC, 5)).toBeNull();
    expect(navegadorDoComputador(SAFARI_MAC, 0)).toBe('safari');
  });
});

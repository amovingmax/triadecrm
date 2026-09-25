import { describe, expect, it } from 'vitest';

import { REDIRECIONAMENTOS } from './redirecionamentos';

/**
 * Um redirect que some é pior do que um redirect que nunca existiu: quem tem
 * `/radar` no favorito, no recibo de uma importação antiga (`recibo.tsx`), num
 * link colado no WhatsApp ou numa nota do relatório cai em 404 sem entender por
 * quê — e a fila de revisão é justamente a tela para onde a importação manda a
 * pessoa depois de gravar.
 */
describe('REDIRECIONAMENTOS', () => {
  it('o Radar virou Revisão, e o endereço antigo é permanente (308)', () => {
    const radar = REDIRECIONAMENTOS.find((r) => r.source === '/radar');
    expect(radar).toEqual({ source: '/radar', destination: '/revisao', permanent: true });
  });

  it('nenhum redirect aponta para o próprio endereço, que seria um laço', () => {
    for (const r of REDIRECIONAMENTOS) expect(r.destination).not.toBe(r.source);
  });
});

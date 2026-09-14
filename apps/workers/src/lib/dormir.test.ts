import { describe, expect, it } from 'vitest';

import { dormir } from './dormir';

describe('dormir', () => {
  it('espera o tempo pedido quando ninguém pede parada', async () => {
    const inicio = Date.now();
    await dormir(30);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(25);
  });

  it('ACORDA NA HORA com a parada, mesmo no meio de um descanso longo', async () => {
    // A cadência dorme até 180 s; o SIGTERM na nuvem não espera isso.
    const parada = new AbortController();
    const inicio = Date.now();
    const espera = dormir(180_000, parada.signal);
    setTimeout(() => parada.abort(), 20);
    await espera;
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });

  it('com a parada já pedida, nem começa a dormir', async () => {
    const parada = new AbortController();
    parada.abort();
    const inicio = Date.now();
    await dormir(60_000, parada.signal);
    expect(Date.now() - inicio).toBeLessThan(100);
  });
});

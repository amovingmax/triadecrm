import { describe, expect, it } from 'vitest';

import { Acelerador, hostDaUrl } from './acelerador';

/** Relógio e sono de mentira: o teste é sobre a regra, não sobre esperar de verdade. */
function relogioFalso(inicio = 1_000_000) {
  let agora = inicio;
  const dormidas: number[] = [];
  const acelerador = new Acelerador({
    agora: () => agora,
    dormir: async (ms) => {
      dormidas.push(ms);
      agora += ms;
      await Promise.resolve();
    },
  });
  return { acelerador, dormidas, avancar: (ms: number) => (agora += ms) };
}

describe('Acelerador', () => {
  it('deixa a primeira requisição passar direto', async () => {
    const { acelerador, dormidas } = relogioFalso();
    expect(await acelerador.aguardarAVez('www.casamentos.com.br', 4)).toBe(0);
    expect(dormidas).toEqual([]);
  });

  it('segura a segunda até fechar o intervalo da fonte', async () => {
    const { acelerador, dormidas } = relogioFalso();
    await acelerador.aguardarAVez('www.casamentos.com.br', 4);
    const esperou = await acelerador.aguardarAVez('www.casamentos.com.br', 4);
    expect(esperou).toBe(4000);
    expect(dormidas).toEqual([4000]);
  });

  it('desconta o tempo que a própria coleta levou', async () => {
    const { acelerador, avancar } = relogioFalso();
    await acelerador.aguardarAVez('www.casamentos.com.br', 4);
    avancar(1500); // a página demorou 1,5 s para voltar
    expect(await acelerador.aguardarAVez('www.casamentos.com.br', 4)).toBe(2500);
  });

  it('não segura nada se já passou tempo suficiente', async () => {
    const { acelerador, avancar } = relogioFalso();
    await acelerador.aguardarAVez('www.casamentos.com.br', 4);
    avancar(9000);
    expect(await acelerador.aguardarAVez('www.casamentos.com.br', 4)).toBe(0);
  });

  it('conta o intervalo por host: uma fonte lenta não trava a outra', async () => {
    const { acelerador } = relogioFalso();
    await acelerador.aguardarAVez('www.casamentos.com.br', 10);
    expect(await acelerador.aguardarAVez('www.sympla.com.br', 10)).toBe(0);
    expect(await acelerador.aguardarAVez('www.casamentos.com.br', 10)).toBe(10000);
  });

  it('intervalo zero (planilha, base local) não espera', async () => {
    const { acelerador } = relogioFalso();
    await acelerador.aguardarAVez('local', 0);
    expect(await acelerador.aguardarAVez('local', 0)).toBe(0);
  });
});

describe('hostDaUrl', () => {
  it('usa o host, que é a mesma unidade do robots.txt', () => {
    expect(hostDaUrl('https://www.casamentos.com.br/cerimonialista/natal--2')).toBe(
      'www.casamentos.com.br',
    );
  });
});

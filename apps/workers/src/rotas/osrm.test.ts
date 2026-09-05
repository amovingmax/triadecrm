import { describe, expect, it } from 'vitest';

import { ErroDoOsrm, matrizDeTempos } from './osrm';

/**
 * O erro que este arquivo existe para pegar: **a ordem das coordenadas**.
 *
 * O OSRM recebe `lon,lat`, ao contrário de quase todo o resto do mundo. Trocar
 * as duas põe Natal no meio do Atlântico, e o OSRM responde educadamente com
 * `NoSegment` em vez de com um erro barulhento — a rota simplesmente não sai, e
 * ninguém sabe por quê. A conversão mora num lugar só, e é aqui que ela é
 * conferida.
 */

/** Resposta real do `/table` (Ponta Negra → Cidade Alta → Lagoa Nova). */
const RESPOSTA_OK = {
  code: 'Ok',
  durations: [
    [0, 973.9, 700.1],
    [980.2, 0, 320.4],
    [800.5, 318.9, 0],
  ],
  distances: [
    [0, 13517.6, 9910.2],
    [13593.8, 0, 4468.2],
    [11156.5, 4425, 0],
  ],
};

function duble(corpo: unknown, ok = true) {
  const urls: string[] = [];
  const impl = ((url: string) => {
    urls.push(String(url));
    return Promise.resolve({
      ok,
      status: ok ? 200 : 500,
      json: () => Promise.resolve(corpo),
    } as Response);
  }) as unknown as typeof fetch;
  return { impl, urls };
}

describe('matrizDeTempos', () => {
  it('manda lon,lat (e não lat,lon), com a origem na frente', async () => {
    const { impl, urls } = duble(RESPOSTA_OK);
    await matrizDeTempos({
      baseUrl: 'http://osrm:5000/',
      origem: { lat: -5.8811, lng: -35.1858 },
      paradas: [
        { lat: -5.7945, lng: -35.2094 },
        { lat: -5.8226, lng: -35.2126 },
      ],
      fetchImpl: impl,
    });

    expect(urls[0]).toBe(
      'http://osrm:5000/table/v1/driving/-35.1858,-5.8811;-35.2094,-5.7945;-35.2126,-5.8226' +
        '?annotations=duration,distance',
    );
  });

  it('devolve as duas matrizes, incluindo a origem no índice 0', async () => {
    const { impl } = duble(RESPOSTA_OK);
    const m = await matrizDeTempos({
      baseUrl: 'http://osrm:5000',
      origem: { lat: -5.8811, lng: -35.1858 },
      paradas: [
        { lat: -5.7945, lng: -35.2094 },
        { lat: -5.8226, lng: -35.2126 },
      ],
      fetchImpl: impl,
    });
    expect(m.duracoes[0]?.[1]).toBeCloseTo(973.9, 1);
    expect(m.distancias[2]?.[1]).toBeCloseTo(4425, 1);
  });

  it('"sem caminho" vira NaN, para a ordem recusar a matriz em vez de chutar', async () => {
    const { impl } = duble({
      code: 'Ok',
      durations: [
        [0, null],
        [null, 0],
      ],
      distances: [
        [0, null],
        [null, 0],
      ],
    });
    const m = await matrizDeTempos({
      baseUrl: 'http://osrm:5000',
      origem: { lat: -5.88, lng: -35.18 },
      paradas: [{ lat: -5.79, lng: -35.2 }],
      fetchImpl: impl,
    });
    expect(Number.isNaN(m.duracoes[0]?.[1])).toBe(true);
  });

  it('código diferente de Ok é erro com motivo, não matriz vazia', async () => {
    const { impl } = duble({ code: 'NoSegment', message: 'Could not find a matching segment' });
    await expect(
      matrizDeTempos({
        baseUrl: 'http://osrm:5000',
        origem: { lat: 0, lng: 0 },
        paradas: [{ lat: 0, lng: 0 }],
        fetchImpl: impl,
      }),
    ).rejects.toThrow(ErroDoOsrm);
  });

  it('matriz de tamanho errado é recusada (resposta truncada não vira rota)', async () => {
    const { impl } = duble({ code: 'Ok', durations: [[0]], distances: [[0]] });
    await expect(
      matrizDeTempos({
        baseUrl: 'http://osrm:5000',
        origem: { lat: 0, lng: 0 },
        paradas: [{ lat: 1, lng: 1 }],
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/fora do tamanho pedido/);
  });

  it('OSRM fora do ar vira erro "inalcancavel", com a URL na mensagem', async () => {
    const impl = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
    await expect(
      matrizDeTempos({
        baseUrl: 'http://osrm:5000',
        origem: { lat: 0, lng: 0 },
        paradas: [{ lat: 1, lng: 1 }],
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ motivo: 'inalcancavel' });
  });
});

import { describe, expect, it } from 'vitest';

import {
  criarClienteDoNominatim,
  ErroDoNominatim,
  INTERVALO_MINIMO_MS,
  lerResposta,
} from './nominatim';

/**
 * O que estes testes protegem, e por quê:
 *
 * · a política do Nominatim (1 req/s e User-Agent identificado) é uma promessa
 *   feita a quem doa os dados do OpenStreetMap. Testar "o cliente espera" e "o
 *   cliente se identifica" é o que impede alguém de apertar o acelerador numa
 *   refatoração distraída;
 * · o `addresstype` é o campo do qual sai a precisão no banco. Perdê-lo na
 *   leitura transformaria toda coordenada em `incerta` — ou, pior, se o padrão
 *   fosse otimista, transformaria uma praia em bairro.
 */

/** Uma resposta como o Nominatim devolve de verdade (Capim Macio, colhida). */
const CAPIM_MACIO = [
  {
    place_id: 14028396,
    licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    osm_type: 'relation',
    osm_id: 1230020,
    lat: '-5.8576398',
    lon: '-35.2014489',
    category: 'boundary',
    type: 'administrative',
    addresstype: 'suburb',
    name: 'Capim Macio',
    display_name: 'Capim Macio, Região Sul, Natal, Rio Grande do Norte, Região Nordeste, Brasil',
    boundingbox: ['-5.8740792', '-5.8388532', '-35.2110704', '-35.1845263'],
  },
];

describe('lerResposta', () => {
  it('lê a resposta real do Nominatim, com lat/lon em texto', () => {
    const r = lerResposta(CAPIM_MACIO);
    expect(r.encontrado).toBe(true);
    expect(r.lat).toBeCloseTo(-5.8576398, 6);
    expect(r.lng).toBeCloseTo(-35.2014489, 6);
    expect(r.addresstype).toBe('suburb');
    expect(r.osm_type).toBe('relation');
    expect(r.osm_id).toBe(1230020);
    expect(r.osm_class).toBe('boundary');
    expect(r.bbox).toEqual([-5.8740792, -5.8388532, -35.2110704, -35.1845263]);
    expect(r.licenca).toContain('ODbL');
  });

  it('lista vazia é resposta legítima, não erro', () => {
    expect(lerResposta([])).toEqual({ encontrado: false });
  });

  it('sem coordenada utilizável, não encontrado', () => {
    expect(lerResposta([{ lat: 'ali perto', lon: '-35.2' }])).toEqual({ encontrado: false });
  });

  it('caixa delimitadora malformada some, e o resto do lugar continua valendo', () => {
    const r = lerResposta([{ ...CAPIM_MACIO[0], boundingbox: ['-5.87', 'x'] }]);
    expect(r.encontrado).toBe(true);
    expect(r.bbox).toBeUndefined();
  });

  it('o que não é lista de lugares é erro de formato', () => {
    expect(() => lerResposta({ erro: 'nope' })).toThrow(ErroDoNominatim);
  });
});

describe('criarClienteDoNominatim', () => {
  function dubleFetch(corpo: unknown, ok = true) {
    const chamadas: { url: string; headers: Record<string, string> }[] = [];
    const impl = ((url: string, init?: RequestInit) => {
      chamadas.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return Promise.resolve({
        ok,
        status: ok ? 200 : 429,
        json: () => Promise.resolve(corpo),
      } as Response);
    }) as unknown as typeof fetch;
    return { impl, chamadas };
  }

  it('se identifica, como a política do Nominatim exige', async () => {
    const { impl, chamadas } = dubleFetch(CAPIM_MACIO);
    const cliente = criarClienteDoNominatim({
      userAgent: 'Triade-CRM/0.1 (KOMUNE; contato@exemplo)',
      fetchImpl: impl,
      dormir: () => Promise.resolve(),
    });
    await cliente.buscar('Capim Macio, Natal, RN, Brasil');

    expect(chamadas[0]?.headers['User-Agent']).toBe('Triade-CRM/0.1 (KOMUNE; contato@exemplo)');
    expect(chamadas[0]?.url).toContain('format=jsonv2');
    expect(chamadas[0]?.url).toContain('countrycodes=br');
    expect(chamadas[0]?.url).toContain(encodeURIComponent('Capim Macio, Natal, RN, Brasil'));
  });

  it('espera o intervalo da política entre uma pergunta e a seguinte', async () => {
    const { impl } = dubleFetch(CAPIM_MACIO);
    const esperas: number[] = [];
    const cliente = criarClienteDoNominatim({
      userAgent: 'teste',
      fetchImpl: impl,
      dormir: (ms) => {
        esperas.push(ms);
        return Promise.resolve();
      },
    });

    await cliente.buscar('um');
    await cliente.buscar('dois');
    await cliente.buscar('três');

    // A primeira sai na hora; as seguintes esperam. O valor pedido nunca passa
    // do intervalo, e nunca é zero ou negativo.
    expect(esperas.length).toBe(2);
    for (const espera of esperas) {
      expect(espera).toBeGreaterThan(0);
      expect(espera).toBeLessThanOrEqual(INTERVALO_MINIMO_MS);
    }
  });

  it('duas perguntas ao mesmo tempo entram em fila, não saem juntas', async () => {
    const { impl, chamadas } = dubleFetch(CAPIM_MACIO);
    let emVoo = 0;
    let simultaneasMax = 0;
    const contando = ((url: string, init?: RequestInit) => {
      emVoo += 1;
      simultaneasMax = Math.max(simultaneasMax, emVoo);
      return (impl as (u: string, i?: RequestInit) => Promise<Response>)(url, init).then((r) => {
        emVoo -= 1;
        return r;
      });
    }) as unknown as typeof fetch;

    const cliente = criarClienteDoNominatim({
      userAgent: 'teste',
      fetchImpl: contando,
      dormir: () => Promise.resolve(),
    });

    await Promise.all([cliente.buscar('a'), cliente.buscar('b'), cliente.buscar('c')]);
    expect(simultaneasMax).toBe(1);
    expect(chamadas).toHaveLength(3);
  });

  it('HTTP ruim vira erro com nome, e não trava a fila das perguntas seguintes', async () => {
    const { impl } = dubleFetch([], false);
    const cliente = criarClienteDoNominatim({
      userAgent: 'teste',
      fetchImpl: impl,
      dormir: () => Promise.resolve(),
    });
    await expect(cliente.buscar('um')).rejects.toThrow(ErroDoNominatim);
    await expect(cliente.buscar('dois')).rejects.toThrow(ErroDoNominatim);
  });
});

import { describe, expect, it } from 'vitest';

import {
  acumuladoDeCarro,
  agruparExclusoes,
  buscaDaParada,
  distanciaCurta,
  duracaoCurta,
  linkDaParada,
  linkDoTrajeto,
  linkDoWaze,
  paradasNoMesmoPonto,
  rotuloDaPrecisao,
  TETO_DE_WAYPOINTS,
  type AlvoDaRota,
  type ParadaDaRota,
} from './rota-tipos';

/**
 * O que estes testes protegem:
 *
 * · **o link nunca leva ninguém para o centroide**. É a regra mais importante
 *   desta tela: a coordenada que o CRM tem é o meio do polígono do bairro, e
 *   navegar até ela é chegar no lugar errado com cara de certeza. Se um dia
 *   alguém trocar a busca por nome por `lat,lng` "porque é mais preciso", estes
 *   testes ficam vermelhos;
 * · **o trajeto parte de onde a pessoa está** — `origin` fora do link, sempre;
 * · **duas paradas no mesmo ponto são declaradas**, porque o "0 min" entre elas
 *   é verdade para o OSRM e mentira para quem dirige.
 */

function parada(over: Partial<ParadaDaRota> = {}): ParadaDaRota {
  return {
    posicao: 1,
    task_id: 't1',
    organization_id: 'o1',
    organizacao: 'Anne Vieira Buffet e Eventos',
    bairro: 'Capim Macio',
    cidade: 'Natal',
    endereco: null,
    titulo: 'Visita',
    quando: '2026-09-05T18:00:00Z',
    lat: -5.85764,
    lng: -35.20145,
    precisao: 'bairro',
    raio_m: 2441,
    segundos_do_anterior: 540,
    metros_do_anterior: 7766,
    temperatura: 'frio',
    etapa: 'Prospectado',
    concluida: false,
    ainda_vale: true,
    ...over,
  };
}

describe('buscaDaParada', () => {
  it('sem endereço, busca pelo NOME do parceiro mais bairro e cidade', () => {
    expect(buscaDaParada(parada())).toBe('Anne Vieira Buffet e Eventos, Capim Macio, Natal, RN');
  });

  it('com endereço na ficha, usa o endereço', () => {
    expect(buscaDaParada(parada({ endereco: 'Av. Eng. Roberto Freire, 1000' }))).toBe(
      'Av. Eng. Roberto Freire, 1000, Capim Macio, Natal, RN',
    );
  });

  it('nunca manda coordenada: o centroide do bairro não é endereço de ninguém', () => {
    const url = linkDaParada(parada());
    expect(url).not.toContain('-5.85764');
    expect(url).not.toContain('-35.20145');
    expect(url).toContain('maps/search/?api=1&query=');
    expect(decodeURIComponent(url)).toContain('Anne Vieira Buffet e Eventos');
  });

  it('o link do Waze segue a mesma regra', () => {
    const url = linkDoWaze(parada());
    expect(url).not.toContain('-5.85764');
    expect(url).toContain('navigate=yes');
  });
});

describe('linkDoTrajeto', () => {
  it('não manda ponto de partida: o Maps usa a posição do aparelho', () => {
    const url = linkDoTrajeto([parada(), parada({ organizacao: 'Casei Marketing' })])?.url ?? '';
    expect(url).not.toContain('origin=');
    expect(url).toContain('travelmode=driving');
  });

  it('a última parada é o destino e as do meio viram waypoints', () => {
    const r = linkDoTrajeto([
      parada({ organizacao: 'Um' }),
      parada({ organizacao: 'Dois' }),
      parada({ organizacao: 'Três' }),
    ]);
    const url = decodeURIComponent(r?.url ?? '');
    expect(url).toContain('destination=Três,');
    expect(url).toContain('waypoints=Um,');
    expect(url).toContain('|Dois,');
  });

  it('com uma parada só, ela é o destino e não há waypoint', () => {
    const r = linkDoTrajeto([parada()]);
    expect(r?.url).toContain('destination=');
    expect(r?.url).not.toContain('waypoints=');
    expect(r?.incluidas).toBe(1);
  });

  it('respeita o teto de waypoints e diz quantas paradas entraram', () => {
    const muitas = Array.from({ length: 8 }, (_, i) => parada({ organizacao: `P${i}` }));
    const r = linkDoTrajeto(muitas);
    expect(r?.incluidas).toBe(TETO_DE_WAYPOINTS + 1);
    expect(decodeURIComponent(r?.url ?? '')).not.toContain('P5');
  });

  it('sem parada, não há trajeto', () => {
    expect(linkDoTrajeto([])).toBeNull();
  });
});

describe('paradasNoMesmoPonto', () => {
  it('acha as que dividem o mesmo centroide de bairro', () => {
    const iguais = paradasNoMesmoPonto([
      parada({ task_id: 'a' }),
      parada({ task_id: 'b' }),
      parada({ task_id: 'c', lat: -5.8, lng: -35.19 }),
    ]);
    expect([...iguais].sort()).toEqual(['a', 'b']);
  });

  it('parada sozinha no ponto não é marcada', () => {
    expect(paradasNoMesmoPonto([parada({ task_id: 'a' })]).size).toBe(0);
  });
});

describe('acumuladoDeCarro', () => {
  it('soma os trechos na ordem', () => {
    expect(
      acumuladoDeCarro([
        parada({ segundos_do_anterior: 100 }),
        parada({ segundos_do_anterior: 200 }),
        parada({ segundos_do_anterior: 50 }),
      ]),
    ).toEqual([100, 300, 350]);
  });
});

describe('formatos', () => {
  it('minutos até uma hora, depois horas', () => {
    expect(duracaoCurta(0)).toBe('0 min');
    expect(duracaoCurta(540)).toBe('9 min');
    expect(duracaoCurta(3_600)).toBe('1 h 00');
    expect(duracaoCurta(4_500)).toBe('1 h 15');
  });

  it('metros abaixo de 1 km, quilômetros acima', () => {
    expect(distanciaCurta(740)).toBe('740 m');
    expect(distanciaCurta(7_766)).toBe('7,8 km');
    expect(distanciaCurta(26_584)).toBe('26,6 km');
  });

  it('a precisão vem escrita junto do tamanho da incerteza', () => {
    expect(rotuloDaPrecisao('bairro', 2441)).toBe('centro do bairro · ~2,4 km de raio');
    expect(rotuloDaPrecisao('logradouro', null)).toBe('rua e número');
  });
});

describe('agruparExclusoes', () => {
  function alvo(over: Partial<AlvoDaRota>): AlvoDaRota {
    return {
      task_id: 't',
      organization_id: 'o',
      organizacao: 'Alguém',
      bairro: null,
      cidade: 'Natal',
      endereco: null,
      titulo: 'Visita',
      due_at: '2026-09-05T18:00:00Z',
      lat: null,
      lng: null,
      precisao: null,
      raio_m: null,
      temperatura: 'frio',
      categoria: null,
      deal_id: null,
      etapa: null,
      elegivel: false,
      motivo: 'sem_coordenada',
      ...over,
    };
  }

  it('põe a supressão na frente: é a exclusão que ninguém pode ignorar', () => {
    const grupos = agruparExclusoes([
      alvo({ task_id: '1', motivo: 'so_cidade' }),
      alvo({ task_id: '2', motivo: 'suprimido' }),
      alvo({ task_id: '3', motivo: 'apagada' }),
    ]);
    expect(grupos.map((g) => g.motivo)).toEqual(['suprimido', 'apagada', 'so_cidade']);
  });

  it('não lista quem entrou na rota', () => {
    expect(agruparExclusoes([alvo({ elegivel: true, motivo: null })])).toEqual([]);
  });
});

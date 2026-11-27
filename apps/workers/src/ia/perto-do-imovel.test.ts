import { describe, expect, it } from 'vitest';

import { CADERNO_DO_DONO, ARG_CADERNO } from '../mercado/motor/caderno';
import type { BuscaNoMapa, ImovelNoMapa, LugarNoMapa } from './mapa';
import {
  COMO_PROCURAR,
  caixaEmVolta,
  faixaDaDistancia,
  ferramentaBuscarPertoDoImovel,
  osMaisPerto,
} from './perto-do-imovel';

/**
 * A BUSCA PERTO DO IMÓVEL (27/11/2026). Pedido do dono: "A questão da escola e de outras
 * referências a IA deve verificar via maps." O que estes casos protegem: só o tipo pedido
 * (o supermercado de nome "Escola" não vira escola), os três mais perto, em faixas, sem
 * coordenada; pino aproximado sem distância; nada achado sem "não existe"; o teto por
 * resposta; e a Pipa liberada para a comparação do m².
 */

const CENTRO = { lat: -5.8622, lng: -35.2025 };
const lugar = (nome: string, categoria: string, dLat: number, dLng = 0): LugarNoMapa => ({
  nome,
  tipo: 'amenity',
  categoria,
  nivel: 'ponto',
  bairro: null,
  cidade: 'Natal',
  lat: CENTRO.lat + dLat,
  lng: CENTRO.lng + dLng,
});
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
const imovel = (pino: ImovelNoMapa['pino']): ImovelNoMapa => ({
  codigo: 'TE0001_IMOVA',
  tipo: 'terreno',
  bairro: 'Capim Macio',
  cidade: 'Natal',
  rua: null,
  cep: null,
  pino,
});

describe('as contas', () => {
  it('a caixa em volta e as faixas', () => {
    const [o, n, l, s] = caixaEmVolta(CENTRO, 3).split(',').map(Number) as [number, number, number, number];
    expect(o).toBeLessThan(CENTRO.lng);
    expect(l).toBeGreaterThan(CENTRO.lng);
    expect(n).toBeGreaterThan(CENTRO.lat);
    expect(s).toBeLessThan(CENTRO.lat);
    expect(faixaDaDistancia(0.3)).toBe('a menos de 500 metros');
    expect(faixaDaDistancia(0.8)).toBe('a menos de 1 km');
    expect(faixaDaDistancia(2.4)).toBe('a menos de 3 km');
  });

  it('só o tipo pedido, os mais perto primeiro, sem repetir e dentro do raio', () => {
    const achados = osMaisPerto(
      [
        lugar('Escola Longe', 'amenity:school', 0.025),
        lugar('Escola Perto', 'amenity:school', 0.003),
        lugar('Supermercado Escola', 'shop:supermarket', 0.001),
        lugar('Escola Perto', 'amenity:school', 0.0031),
        lugar('Escola Meio', 'amenity:school', 0.008),
        lugar('Escola Fora', 'amenity:school', 0.05),
      ],
      CENTRO,
      COMO_PROCURAR.escola,
    );
    expect(achados.map((a) => a.nome)).toEqual(['Escola Perto', 'Escola Meio', 'Escola Longe']);
  });
});

describe('a ferramenta', () => {
  const busca = (lugares: LugarNoMapa[]): BuscaNoMapa & { pedidos: string[] } => {
    const pedidos: string[] = [];
    return {
      pedidos,
      buscar: async () => ({ lugares: [], doCache: true }),
      buscarNaCaixa: async (termo) => {
        pedidos.push(termo);
        return { lugares, doCache: false };
      },
    };
  };
  const ferramenta = (b: BuscaNoMapa, pino: ImovelNoMapa['pino'], maxBuscas = 2) =>
    ferramentaBuscarPertoDoImovel({
      cliente: {} as never,
      busca: b,
      logger,
      maxBuscas,
      imoveis: async () => [imovel(pino)],
    });

  it('devolve o nome e a faixa, "pelo mapa", sem coordenada', async () => {
    const b = busca([lugar('Escola Estadual Lourdes Guilherme', 'amenity:school', 0.004)]);
    const r = await ferramenta(b, { ...CENTRO, aproximado: false })({ imovelCodigo: 'TE0001_IMOVA', oQue: 'escola' });
    expect(r.texto).toBe(
      'Perto de TE0001_IMOVA, pelo mapa, em linha reta a partir do lugar do imóvel, escola: Escola Estadual Lourdes Guilherme, a menos de 500 metros.',
    );
    expect(r.texto).not.toMatch(/-5\.|35\./);
    expect(b.pedidos).toEqual(['escola']);
  });

  it('pino aproximado: na região, sem distância', async () => {
    const r = await ferramenta(busca([lugar('Colégio Master', 'amenity:school', 0.01)]), {
      ...CENTRO,
      aproximado: true,
    })({ imovelCodigo: 'TE0001_IMOVA', oQue: 'escola' });
    expect(r.texto).toMatch(/diga só que fica na região, sem distância/);
    expect(r.texto).not.toMatch(/a menos de/);
  });

  it('nada achado: não diz que não existe; sem pino: não mede', async () => {
    const nada = await ferramenta(busca([]), { ...CENTRO, aproximado: false })({ imovelCodigo: 'TE0001_IMOVA', oQue: 'praia' });
    expect(nada.texto).toMatch(/não diga que não existe/);
    const semPino = await ferramenta(busca([]), null)({ imovelCodigo: 'TE0001_IMOVA', oQue: 'escola' });
    expect(semPino.texto).toMatch(/não tem lugar no mapa/);
  });

  it('pedido torto, imóvel fora da lista e o teto por resposta', async () => {
    const b = busca([]);
    const f = ferramenta(b, { ...CENTRO, aproximado: false }, 1);
    expect((await f({ imovelCodigo: 'TE0001_IMOVA', oQue: 'segurança' })).erro).toBe(true);
    expect((await f({ imovelCodigo: 'XX9999', oQue: 'escola' })).texto).toMatch(/não está na lista/);
    expect((await f({ imovelCodigo: 'TE0001_IMOVA', oQue: 'padaria' })).texto).toMatch(/Acabaram as buscas/);
  });
});

describe('Pipa pode ter o m² comparado (o dono, 27/11/2026)', () => {
  it('a rodada usa o caderno do dono, sem a trava de preço; o teste de ouro, o do protótipo', () => {
    expect(ARG_CADERNO.TE0005?.motor?.preco_bloqueado).toBeTruthy();
    expect(CADERNO_DO_DONO.TE0005?.motor?.preco_bloqueado).toBeUndefined();
    expect(CADERNO_DO_DONO.TE0005?.nao_diga).toContain('soma dos terrenos (FICHA 4)');
    expect(CADERNO_DO_DONO.TE0005?.nao_diga.join(' ')).not.toMatch(/m²|comparação de preço/);
  });
});

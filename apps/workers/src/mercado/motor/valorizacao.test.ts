import { describe, expect, it } from 'vitest';

import type { LinhaDeSerie } from './entrada';
import { ajustarModelos } from './modelo-preco';
import { pctDoLimiar, REGRAS_DO_DONO, REGRAS_DO_PROTOTIPO } from './regras-do-dono';
import type { AnuncioDaBase, BaseDoMotor } from './tipos';
import {
  bastam,
  fraseDaValorizacao,
  sinalDeCompraEVenda,
  sinalDeObras,
  sinalDePrecos,
  vantagemDeValorizacao,
} from './valorizacao';

/**
 * A VALORIZAÇÃO (V1) E AS REGRAS DO DONO (27/11/2026).
 *
 * O que estes casos protegem: a frase só sai com sinal nas fontes ("caso não tenha de
 * fato, a gente não cita nada"); sai sem número e sem "não há garantia"; o preço vira
 * vantagem a partir de 8% (o protótipo exigia 15%); o modelo de preço do worker volta a
 * dar a homogeneização que o motor precisa.
 */

const fipe = (anos: Array<[string, number]>): LinhaDeSerie[] =>
  anos.map(([mes, valor]) => ({ serie: 'fipezap-natal-venda', mes, valor, local: 'Natal' }));
const itbi = (cidade: string, valores: number[]): LinhaDeSerie[] =>
  valores.map((valor, i) => ({
    serie: 'itbi-anual-1',
    mes: `${2023 + i}-12-01`,
    valor,
    local: cidade,
  }));

const FIPE_SOBE = fipe([
  ['2022-10-01', 4762],
  ['2023-10-01', 5093],
  ['2024-10-01', 5594],
  ['2025-10-01', 6006],
  ['2026-10-01', 6467],
]);

describe('os sinais', () => {
  it('preços: só em Natal, só subindo todos os anos no mesmo mês', () => {
    expect(sinalDePrecos(FIPE_SOBE, 'Natal')?.trecho).toBe(
      'os preços dos imóveis em Natal subiram todos os anos desde 2022',
    );
    expect(sinalDePrecos(FIPE_SOBE, 'Parnamirim')).toBeNull();
    const caiu = fipe([
      ['2022-10-01', 4762],
      ['2023-10-01', 5093],
      ['2024-10-01', 5000],
      ['2025-10-01', 6006],
    ]);
    expect(sinalDePrecos(caiu, 'Natal')).toBeNull();
  });

  it('compra e venda: não cai em nenhum ano e cresce 20% ou mais', () => {
    expect(sinalDeCompraEVenda(itbi('Extremoz', [10, 15, 21]), 'Extremoz')?.crescimento).toBeCloseTo(1.1);
    expect(sinalDeCompraEVenda(itbi('Tibau do Sul', [45, 42, 51]), 'Tibau do Sul')).toBeNull();
    expect(sinalDeCompraEVenda(itbi('Parnamirim', [100, 105, 110]), 'Parnamirim')).toBeNull();
  });

  it('obras: só bairro de Natal entre os 10 com mais unidades aprovadas', () => {
    const construcao: BaseDoMotor['construcao'] = {
      'Capim Macio': { alvara_2021: { unidades: 500 }, alvara_2017: { unidades: 100 } },
      Potengi: { alvara_2021: { unidades: 0 } },
    };
    expect(sinalDeObras(construcao, 'Capim Macio', 'Natal')?.trecho).toBe(
      'Capim Macio está entre os bairros de Natal com mais obras novas aprovadas',
    );
    expect(sinalDeObras(construcao, 'Potengi', 'Natal')).toBeNull();
    expect(sinalDeObras(construcao, 'Capim Macio', 'Parnamirim')).toBeNull();
  });
});

describe('a vantagem V1', () => {
  const base = {
    reg: [
      { id: 'natal-capim-macio', nome: 'Capim Macio, Natal', cidade: 'Natal', vizinhos: [] },
      { id: 'tibau-do-sul-pipa', nome: 'Pipa, Tibau do Sul', cidade: 'Tibau do Sul', vizinhos: [] },
      { id: 'extremoz', nome: 'Extremoz', cidade: 'Extremoz', vizinhos: [] },
    ],
    construcao: { 'Capim Macio': { alvara_2021: { unidades: 500 } } },
    coleta: '2026-11-26',
  } as unknown as BaseDoMotor;

  it('dois sinais em Natal: a frase do dono, sem número, sem "garantia"', () => {
    const v = vantagemDeValorizacao('natal-capim-macio', base, { indices: FIPE_SOBE, ibge: [] });
    expect(v?.texto_base).toBe(
      'É uma área com forte possibilidade de valorização: os preços dos imóveis em Natal subiram todos os anos desde 2022, e Capim Macio está entre os bairros de Natal com mais obras novas aprovadas.',
    );
    expect(v?.texto_base).not.toMatch(/garant/i);
    expect(v?.texto_base.length).toBeLessThanOrEqual(200);
    expect(v?.gatilhos).toEqual(['investimento', 'regiao']);
    expect(v?.numeros_obrigatorios).toEqual([]);
    expect(v?.validade.valido_ate).toBe('2027-01-25');
  });

  it('sem sinal (Pipa, compra e venda que caiu): nada', () => {
    expect(
      vantagemDeValorizacao('tibau-do-sul-pipa', base, {
        indices: itbi('Tibau do Sul', [45, 42, 51]),
        ibge: [],
      }),
    ).toBeNull();
  });

  it('compra e venda 50% maior sozinha basta; mais de 3 vezes vai para conferir', () => {
    const v = vantagemDeValorizacao('extremoz', base, { indices: itbi('Extremoz', [10, 15, 21]), ibge: [] });
    expect(v?.status).toBe('usar');
    expect(v?.texto_base).toMatch(/compra e venda de imóveis em Extremoz/);
    const salto = vantagemDeValorizacao('extremoz', base, { indices: itbi('Extremoz', [1, 8, 16]), ibge: [] });
    expect(salto?.status).toBe('conferir');
  });

  it('um sinal fraco só não basta', () => {
    expect(bastam([{ id: 'obras', trecho: 'x', fonte: 'y', fonteId: 'z', dataDado: '2023-12-31', numeros: {} }])).toBe(false);
    expect(fraseDaValorizacao([{ id: 'precos', trecho: 'os preços subiram', fonte: '', fonteId: '', dataDado: '', numeros: {} }])).toBe(
      'É uma área com forte possibilidade de valorização: os preços subiram.',
    );
  });
});

describe('as regras do dono', () => {
  it('o preço vira vantagem a partir de 8% (o protótipo pedia 15%)', () => {
    expect(REGRAS_DO_DONO.limiarPreco).toBe(0.92);
    expect(pctDoLimiar(REGRAS_DO_DONO)).toBe('8%');
    expect(pctDoLimiar(REGRAS_DO_PROTOTIPO)).toBe('15%');
  });
});

describe('o modelo de preço do worker', () => {
  // Terrenos de duas regiões: o m² cai com a área e a região A é mais cara.
  const anuncios: AnuncioDaBase[] = [];
  for (let i = 0; i < 60; i++) {
    const area = 300 + i * 40;
    const regiao = i % 2 ? 'natal-a' : 'natal-b';
    const m2 = (regiao === 'natal-a' ? 1500 : 1000) * Math.pow(area / 1000, -0.2) * (1 + ((i % 5) - 2) * 0.02);
    anuncios.push({
      id: `x:${i}`,
      fonte: 'x',
      regiao,
      grupo: area <= 500 ? 'terreno_p' : area <= 2000 ? 'terreno_m' : 'terreno_g',
      area,
      preco: m2 * area,
      m2,
      bairro: regiao,
    });
  }
  const m = ajustarModelos(anuncios, () => 'natal-sul');

  it('com 40 anúncios ou mais sai o modelo de terreno; sem construído, nada', () => {
    expect(m.terreno).not.toBeNull();
    expect(m.construido).toBeNull();
    const area = m.terreno!.efeitos.find((e) => e.id === 'log_area')!;
    // +10% de área → o m² cai perto de 1,9% (−0,2 em log-log).
    expect(area.efeito).toBeLessThan(0);
    expect(area.efeito).toBeGreaterThan(-0.04);
    expect(area.confiavel).toBe(true);
  });

  it('a previsão separa as regiões', () => {
    const a = m.terreno!.prever({ regiao: 'natal-a', area: 1000 })!;
    const b = m.terreno!.prever({ regiao: 'natal-b', area: 1000 })!;
    expect(a.m2!).toBeGreaterThan(b.m2!);
    expect(a.lo!).toBeLessThan(a.m2!);
    expect(a.hi!).toBeGreaterThan(a.m2!);
  });
});

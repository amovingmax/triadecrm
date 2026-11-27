/**
 * O "NÃO É" DA EQUIPE VALE NO MOTOR (27/11/2026).
 *
 * O motor tem a regra própria do protótipo para "possível o mesmo imóvel anunciado por outro
 * preço", que trava a vantagem de preço. Quando a equipe decide o par como "não é"
 * (`mercado_par_decidir`), o anúncio chega com `nao_e_de` (migração 20261127160000) e deixa de
 * travar aquele imóvel — e só aquele. Caso real: o TE0008 e um anúncio de R$ 600 mil e
 * 2.000 m² no Chaves na Mão; o dono: "Não é o nosso terreno, mas mesmo assim levamos vantagem".
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { rodarMotor } from './motor';
import { REGRAS_DO_PROTOTIPO } from './regras-do-dono';
import type { BaseDoMotor } from './tipos';
import { montarVantagens } from './vantagens';

const BASE = JSON.parse(
  gunzipSync(readFileSync(new URL('./ouro/base.json.gz', import.meta.url))).toString(),
) as BaseDoMotor;
const rodar = (b: BaseDoMotor) =>
  montarVantagens(b, rodarMotor(b, { regras: REGRAS_DO_PROTOTIPO }), {
    regras: REGRAS_DO_PROTOTIPO,
  });
const marcados = (b: BaseDoMotor) =>
  rodar(b)
    .imoveis.filter((i) => (i as { possivel_mesmo_imovel?: boolean }).possivel_mesmo_imovel)
    .map((i) => i.ref)
    .sort();

describe('o "não é" da equipe', () => {
  const unidade = BASE.ims.find((u) => u.codigo === 'CA0003' || u.ficha === 'CA0003')!;

  it('sem decisão, o protótipo marca o CA0003 e o AP0001 como possível o mesmo imóvel', () => {
    expect(marcados(BASE)).toEqual(['AP0001', 'CA0003']);
  });

  it('com "não é" para o CA0003 em todos os anúncios, só o CA0003 sai da trava', () => {
    const comNaoE: BaseDoMotor = {
      ...BASE,
      anuncios: BASE.anuncios.map((a) => ({
        ...a,
        nao_e_de: [String(unidade.codigo_crm ?? unidade.codigo)],
      })),
    };
    expect(marcados(comNaoE)).toEqual(['AP0001']);
  });

  it('o "não é" de outro imóvel não muda nada', () => {
    const deOutro: BaseDoMotor = {
      ...BASE,
      anuncios: BASE.anuncios.map((a) => ({ ...a, nao_e_de: ['XX9999'] })),
    };
    expect(marcados(deOutro)).toEqual(['AP0001', 'CA0003']);
  });
});

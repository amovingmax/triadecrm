import { describe, expect, it } from 'vitest';

import { varrerMontagem, verificarSemPiiNaConversa } from '@komune/prompts';

import { bancoFalso } from './banco-de-teste';
import {
  MAX_IDAS_AO_MAPA_POR_BUSCA,
  type UsoDaBusca,
  dentroDaRegiao,
  esquecerImoveisDoMapa,
  ferramentaBuscarNoMapa,
  lugarComOTipoTrocado,
  lugarSemTipo,
  regioesDoCliente,
  textoDeLonge,
  variacoesDaBusca,
} from './busca-no-mapa';
import { type LugarNoMapa, criarBuscaNoMapa, nominatimDaIa } from './mapa';
import { RESPOSTAS_DE_24_11 } from './mapa-respostas-24-11';

import type { Logger } from '../lib/log';

/**
 * OS CONSERTOS DO MAPA (24/11/2026, item 3 da entrevista, aprovados pelo usuário):
 * repetir sem a cidade, trocar Rua e Avenida, nunca outra cidade.
 *
 * As falhas vieram da bateria da v8: a IA buscou "Rotatória do Golfinho, Natal" (o
 * cliente não disse Natal; a rotatória fica em Tabatinga, Nísia Floresta), não achou,
 * cortou para "Golfinho" e caiu num restaurante de Pipa; e "Rua Professor Etelvino Cunha"
 * não existe no mapa, que a tem como Avenida. O dublê do Nominatim devolve as respostas
 * REAIS de 24/11 (`mapa-respostas-24-11.ts`); o que não está lá volta vazio.
 */

const PINO_TE0004 = { lat: -6.06896, lng: -35.09864 };
/** O pino proposto ao dono para o TE0006 (esquina da Etelvino Cunha com a Nelson Queiroz). */
const PINO_TE0006 = { lat: -5.844228, lng: -35.2007899 };

function chave(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function loggerMudo(): Logger {
  const nada = () => undefined;
  return { debug: nada, info: nada, warn: nada, error: nada };
}

function montar(falasDoCliente?: readonly string[]) {
  esquecerImoveisDoMapa();
  const aoMapa: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const q = new URL(String(url)).searchParams.get('q') ?? '';
    aoMapa.push(q);
    return new Response(JSON.stringify(RESPOSTAS_DE_24_11[chave(q)] ?? []), { status: 200 });
  }) as typeof fetch;
  const nominatim = nominatimDaIa({
    userAgent: 'teste-do-mapa/1.0',
    fetchImpl,
    intervaloMs: 0,
    dormir: async () => {},
  });
  const banco = bancoFalso(
    {},
    {
      rpcs: {
        ia_lugar_no_mapa_ler: () => null,
        ia_lugar_no_mapa_gravar: () => ({ ok: true }),
        ia_imoveis_no_mapa: () => [
          {
            codigo: 'TE0004_IMOVA',
            tipo: 'terreno',
            bairro: 'Praia de Tabatinga',
            cidade: 'Nísia Floresta',
            endereco: null,
            cep: null,
            latitude: PINO_TE0004.lat,
            longitude: PINO_TE0004.lng,
          },
          {
            codigo: 'TE0006',
            tipo: 'terreno',
            bairro: 'Capim Macio',
            cidade: 'Natal',
            endereco: null,
            cep: null,
            latitude: PINO_TE0006.lat,
            longitude: PINO_TE0006.lng,
          },
          {
            codigo: 'TE0001_IMOVA',
            tipo: 'terreno',
            bairro: 'Capim Macio',
            cidade: 'Natal',
            endereco: null,
            cep: null,
            latitude: -5.8623832,
            longitude: -35.1979617,
          },
        ],
      },
    },
  );
  const busca = criarBuscaNoMapa({ cliente: banco.cliente, nominatim, logger: loggerMudo() });
  const uso: UsoDaBusca = { buscas: 0, consultas: [] };
  const ferramenta = ferramentaBuscarNoMapa({
    cliente: banco.cliente,
    busca,
    logger: loggerMudo(),
    maxBuscas: 3,
    uso,
    ...(falasDoCliente === undefined ? {} : { falasDoCliente }),
  });
  return { ferramenta, aoMapa, uso };
}

const NAO_DISSE_A_CIDADE =
  'Vi um terreno à venda perto da Rotatória do Golfinho. Ainda está disponível?';

describe('as variações da busca', () => {
  it('Rua e Avenida trocam (também "R." e "Av."); "só X" exige duas palavras', () => {
    expect(lugarComOTipoTrocado('Rua Professor Etelvino Cunha')).toBe(
      'Avenida Professor Etelvino Cunha',
    );
    expect(lugarComOTipoTrocado('R. Professor Etelvino Cunha')).toBe(
      'Avenida Professor Etelvino Cunha',
    );
    expect(lugarComOTipoTrocado('Av. Gustavo Neves')).toBe('Rua Gustavo Neves');
    expect(lugarComOTipoTrocado('Avenida Gustavo Neves')).toBe('Rua Gustavo Neves');
    expect(lugarComOTipoTrocado('Rotatória do Golfinho')).toBeNull();
    expect(lugarComOTipoTrocado('Ruazinha Azul')).toBeNull();
    expect(lugarSemTipo('Rua Professor Etelvino Cunha')).toBe('Professor Etelvino Cunha');
    expect(lugarSemTipo('Avenida Gustavo Neves')).toBe('Gustavo Neves');
    // "Golfinho" sozinho acha um restaurante de Pipa: nome de uma palavra não vai.
    expect(lugarSemTipo('Rua do Golfinho')).toBeNull();
    expect(lugarSemTipo('Praia de Camurupim')).toBeNull();
  });

  it('a ordem: a da IA, outro tipo, só o nome, sem a cidade, sem a cidade com outro tipo', () => {
    expect(variacoesDaBusca('Rua Professor Etelvino Cunha', 'Natal')).toEqual({
      variacoes: [
        { como: 'pedida', consulta: 'Rua Professor Etelvino Cunha, Natal, RN' },
        { como: 'outro tipo', consulta: 'Avenida Professor Etelvino Cunha, Natal, RN' },
        { como: 'sem o tipo', consulta: 'Professor Etelvino Cunha, Natal, RN' },
        { como: 'sem a cidade', consulta: 'Rua Professor Etelvino Cunha, RN' },
        { como: 'sem a cidade, outro tipo', consulta: 'Avenida Professor Etelvino Cunha, RN' },
      ],
      regioes: ['Natal'],
    });
  });

  it('a Rotatória do Golfinho: com a cidade e sem ela; sem cidade no pedido, só a da IA', () => {
    expect(
      variacoesDaBusca('Rotatória do Golfinho', 'Natal').variacoes.map((v) => v.consulta),
    ).toEqual(['Rotatória do Golfinho, Natal, RN', 'Rotatória do Golfinho, RN']);
    expect(variacoesDaBusca('Rotatória do Golfinho', undefined)).toEqual({
      variacoes: [{ como: 'pedida', consulta: 'Rotatória do Golfinho, RN' }],
      regioes: [],
    });
  });

  it('a região pode vir na referência, depois da vírgula; o estado não é região', () => {
    const { variacoes, regioes } = variacoesDaBusca(
      'Rotatória do Golfinho, Ponta Negra, RN',
      'Natal',
    );
    expect(regioes).toEqual(['Ponta Negra', 'Natal']);
    expect(variacoes.map((v) => v.consulta)).toEqual([
      'Rotatória do Golfinho, Ponta Negra, Natal, RN',
      'Rotatória do Golfinho, RN',
    ]);
  });

  it('telefone ou nada: nenhuma variação sai', () => {
    expect(variacoesDaBusca('liga 84 99988-0011 perto da praia', 'Natal')).toEqual({
      variacoes: [],
      regioes: [],
    });
    expect(variacoesDaBusca('', 'Natal')).toEqual({ variacoes: [], regioes: [] });
  });
});

describe('a região que o cliente disse', () => {
  it('só conta a que está nas falas dele, palavra inteira, sem acento', () => {
    expect(regioesDoCliente(['Natal'], [NAO_DISSE_A_CIDADE])).toEqual([]);
    expect(regioesDoCliente(['Natal'], ['é perto da rotatória, em natal'])).toEqual(['Natal']);
    expect(regioesDoCliente(['Natal'], ['falei com a Natália ontem'])).toEqual([]);
    expect(regioesDoCliente(['Ponta Negra', 'Natal'], ['Fica em Ponta Negra'])).toEqual([
      'Ponta Negra',
    ]);
    expect(regioesDoCliente(['Nísia Floresta'], ['nisia floresta'])).toEqual(['Nísia Floresta']);
  });

  it('cidade exige a mesma cidade; bairro, até 5 km; região que o mapa não acha não barra', () => {
    const rotatoria: LugarNoMapa = {
      nome: 'Rotatória do Golfinho Tabatinga',
      tipo: 'primary',
      nivel: 'ponto',
      bairro: 'Tabatinga',
      cidade: 'Nísia Floresta',
      lat: -6.0623325,
      lng: -35.101861,
    };
    const gustavo: LugarNoMapa = {
      nome: 'Avenida Gustavo Neves',
      tipo: 'residential',
      nivel: 'ponto',
      bairro: 'Zona Sul',
      cidade: 'Natal',
      lat: -5.84718,
      lng: -35.20199,
    };
    const natal: LugarNoMapa = {
      nome: 'Natal',
      tipo: 'city',
      nivel: 'cidade',
      bairro: null,
      cidade: 'Natal',
      lat: -5.8054,
      lng: -35.20809,
    };
    const capimMacio: LugarNoMapa = {
      nome: 'Capim Macio',
      tipo: 'suburb',
      nivel: 'ponto',
      bairro: 'Capim Macio',
      cidade: 'Natal',
      lat: -5.85764,
      lng: -35.20145,
    };
    const pontaNegra: LugarNoMapa = {
      nome: 'Praia de Ponta Negra',
      tipo: 'beach',
      nivel: 'ponto',
      bairro: 'Zona Sul',
      cidade: 'Natal',
      lat: -5.8736,
      lng: -35.17663,
    };
    expect(dentroDaRegiao(rotatoria, 'Nísia Floresta', null)).toBe(true);
    expect(dentroDaRegiao(rotatoria, 'Tabatinga', null)).toBe(true);
    expect(dentroDaRegiao(rotatoria, 'Natal', natal)).toBe(false);
    expect(dentroDaRegiao(rotatoria, 'Ponta Negra', pontaNegra)).toBe(false);
    expect(dentroDaRegiao(gustavo, 'Natal', natal)).toBe(true);
    expect(dentroDaRegiao(gustavo, 'Capim Macio', capimMacio)).toBe(true);
    expect(dentroDaRegiao(gustavo, 'Cidade Verde', null)).toBe(true);
    // Cidade inteira achada (a IA buscou "Natal") e o cliente disse um bairro de Natal.
    expect(dentroDaRegiao(natal, 'Ponta Negra', pontaNegra)).toBe(true);
  });
});

describe('a ferramenta com as respostas reais de 24/11', () => {
  it('conserto 1: a IA pôs "Natal" por conta própria; sem a cidade, a rotatória é de Tabatinga e o TE0004 fica bem perto', async () => {
    const { ferramenta, aoMapa, uso } = montar([NAO_DISSE_A_CIDADE]);
    const r = await ferramenta({ referencia: 'Rotatória do Golfinho', cidade: 'Natal' });
    expect(r).toEqual({
      texto:
        '"Rotatória do Golfinho, Natal": não achado em Natal; sem a cidade, achado no mapa: Rotatória do Golfinho Tabatinga (rua), em Tabatinga, Nísia Floresta. ' +
        'Imóveis nossos bem perto: TE0004_IMOVA (terreno, Praia de Tabatinga).',
    });
    expect(aoMapa).toEqual(['Rotatória do Golfinho, Natal, RN', 'Rotatória do Golfinho, RN']);
    // A variação não gasta busca da resposta.
    expect(uso).toEqual({ buscas: 1, consultas: ['Rotatória do Golfinho, Natal, RN'] });
  });

  it('conserto 3: o cliente escreveu "Natal"; a rotatória só existe em Nísia Floresta: "não use", sem imóvel', async () => {
    const { ferramenta, aoMapa } = montar([
      'Vi um terreno perto da Rotatória do Golfinho, em Natal. Está disponível?',
    ]);
    const r = await ferramenta({ referencia: 'Rotatória do Golfinho', cidade: 'Natal' });
    expect(r.texto).toBe(
      '"Rotatória do Golfinho, Natal": o mapa só achou esse lugar longe de Natal, que o cliente disse: não use. Pergunte o bairro, a rua e o CEP (nota 7 a).',
    );
    expect(r.texto).not.toMatch(/TE0004|Tabatinga|Nísia/);
    expect(aoMapa).toEqual([
      'Rotatória do Golfinho, Natal, RN',
      'Rotatória do Golfinho, RN',
      'Natal, RN',
    ]);
  });

  it('conserto 3: o cliente escreveu "Ponta Negra" (bairro): a rotatória fica a mais de 5 km, "não use"', async () => {
    const { ferramenta } = montar(['É um terreno perto da Rotatória do Golfinho, em Ponta Negra']);
    const r = await ferramenta({
      referencia: 'Rotatória do Golfinho, Ponta Negra',
      cidade: 'Natal',
    });
    expect(r.texto).toBe(
      '"Rotatória do Golfinho, Ponta Negra, Natal": o mapa só achou esse lugar longe de Ponta Negra, que o cliente disse: não use. Pergunte o bairro, a rua e o CEP (nota 7 a).',
    );
  });

  it('conserto 2: "Rua Professor Etelvino Cunha" é Avenida no mapa; o TE0006 fica bem perto', async () => {
    const { ferramenta, aoMapa } = montar([
      'Vi um terreno na Rua Professor Etelvino Cunha, em Natal',
    ]);
    const r = await ferramenta({ referencia: 'Rua Professor Etelvino Cunha', cidade: 'Natal' });
    expect(r.texto).toBe(
      '"Rua Professor Etelvino Cunha, Natal": achado no mapa com outro nome: Avenida Professor Etelvino Cunha (rua), em Zona Sul, Natal. ' +
        'Imóveis nossos bem perto: TE0006 (terreno, Capim Macio). Imóveis nossos na mesma região: TE0001_IMOVA (terreno, Capim Macio).',
    );
    expect(aoMapa).toEqual([
      'Rua Professor Etelvino Cunha, Natal, RN',
      'Avenida Professor Etelvino Cunha, Natal, RN',
    ]);
  });

  it('conserto 2 com a região do cliente: "Rua Gustavo Neves" em Capim Macio passa pela conferência do bairro', async () => {
    const { ferramenta, aoMapa } = montar(['terreno na rua gustavo neves, capim macio, natal']);
    const r = await ferramenta({ referencia: 'Rua Gustavo Neves', cidade: 'Natal' });
    expect(r.texto).toMatch(
      /^"Rua Gustavo Neves, Natal": achado no mapa com outro nome: Avenida Gustavo Neves \(rua\)/,
    );
    expect(r.texto).toContain('Imóveis nossos bem perto: TE0006');
    // Natal está no nome da cidade do lugar achado: não precisa ir ao mapa conferir.
    expect(aoMapa).toEqual(['Rua Gustavo Neves, Natal, RN', 'Avenida Gustavo Neves, Natal, RN']);
  });

  it('sem as falas do cliente, nenhuma região é conferida (como antes de 24/11)', async () => {
    const { ferramenta } = montar();
    const r = await ferramenta({ referencia: 'Rotatória do Golfinho', cidade: 'Natal' });
    expect(r.texto).toContain('Imóveis nossos bem perto: TE0004_IMOVA');
  });

  it('nada achado: as cinco variações, no teto, e o texto diz o que o sistema já tentou', async () => {
    const { ferramenta, aoMapa, uso } = montar(['é na rua das acácias']);
    const r = await ferramenta({ referencia: 'Rua das Acácias Floridas', cidade: 'Natal' });
    expect(aoMapa).toHaveLength(MAX_IDAS_AO_MAPA_POR_BUSCA);
    expect(r.texto).toBe(
      '"Rua das Acácias Floridas, Natal": não achado no mapa (o sistema já tentou trocando Rua e Avenida, só com o nome e sem a cidade). ' +
        'Tente a referência mais geral que o cliente deu (avenida, praia, bairro ou cidade), nunca um pedaço do nome que ele não disse sozinho.',
    );
    expect(uso.buscas).toBe(1);
  });

  it('a mesma busca de novo devolve o mesmo texto, sem ir ao mapa', async () => {
    const { ferramenta, aoMapa, uso } = montar([NAO_DISSE_A_CIDADE]);
    const a = await ferramenta({ referencia: 'Rotatória do Golfinho', cidade: 'Natal' });
    const b = await ferramenta({ referencia: 'rotatoria do golfinho', cidade: 'natal' });
    expect(b).toEqual(a);
    expect(aoMapa).toHaveLength(2);
    expect(uso.buscas).toBe(1);
  });

  it('nenhum texto novo tem o que a auditoria confunda com telefone', async () => {
    const textos = [
      textoDeLonge('Rotatória do Golfinho, Natal, RN', ['Natal']),
      textoDeLonge('Rua 2004 2004, RN', ['Bairro 59078-350']),
      (
        await montar([NAO_DISSE_A_CIDADE]).ferramenta({
          referencia: 'Rotatória do Golfinho',
          cidade: 'Natal',
        })
      ).texto,
      (
        await montar(['rua professor etelvino cunha']).ferramenta({
          referencia: 'Rua Professor Etelvino Cunha',
          cidade: 'Natal',
        })
      ).texto,
    ];
    for (const texto of textos) {
      expect(varrerMontagem(texto)).toEqual([]);
      expect(verificarSemPiiNaConversa(texto)).toEqual([]);
    }
  });
});

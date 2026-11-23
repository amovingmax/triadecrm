import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_BUSCAS_NO_MAPA,
  MAX_VOLTAS_DO_ATENDENTE,
  atendenteImovaV7,
  varrerMontagem,
  verificarSemPiiNaConversa,
} from '@komune/prompts';

import { bancoFalso } from './banco-de-teste';
import {
  consultaDoMapa,
  distanciaKm,
  esquecerImoveisDoMapa,
  faixaDaDistancia,
  ferramentaBuscarNoMapa,
  textoDoResultado,
} from './busca-no-mapa';
import type { ClienteDoModelo, PedidoComFerramentas, VoltaDoModelo } from './cliente';
import { type ContextoDaIa, type FerramentaDoLaco, TetoDoLacoError, executarComFerramentas } from './execucao';
import { type ImovelNoMapa, type LugarNoMapa, criarBuscaNoMapa, nominatimDaIa, ruaSemNumero } from './mapa';

import type { Logger } from '../lib/log';

/**
 * A BUSCA NO MAPA DA IA QUE ATENDE (atendente-imova@v7, 23/11/2026), SEM REDE.
 *
 * O caso que motivou tudo: a Alinne disse "perto do Condomínio Serv Club" (o
 * OpenStreetMap não conhece) e mandou "Avenida Praia de Camurupim, Nísia Floresta" (ele
 * conhece). O dublê do Nominatim devolve as respostas REAIS dessas consultas, tiradas
 * do serviço público em 23/11/2026 (lat/lng, addresstype, nome e nome exibido como
 * vieram; `address` não veio, porque a consulta foi feita sem `addressdetails`).
 *
 * O terreno é o TE0004_IMOVA. O pino que estava no anúncio (-6.0559925, -35.1708741)
 * caía no centro da cidade, a uns 8,6 km da avenida; o certo, que o usuário confirmou
 * (Rua Barra de Tabatinga, ponta da praia), é -6.06896, -35.09864.
 */

const PINO_ANTIGO = { lat: -6.0559925, lng: -35.1708741 };
const PINO_NOVO = { lat: -6.06896, lng: -35.09864 };
const AVENIDA = { lat: -6.0896711, lng: -35.1004922 };

const LICENCA = 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright';
/** O que o Nominatim respondeu em 23/11/2026, por consulta (sem acento, minúscula). */
const RESPOSTAS_REAIS: Record<string, unknown[]> = {
  'condominio serv club, nisia floresta, rn': [],
  'serv club, nisia floresta, rn': [],
  'avenida praia de camurupim, nisia floresta, rn': [
    {
      lat: '-6.0896711',
      lon: '-35.1004922',
      addresstype: 'secondary',
      type: 'secondary',
      name: 'Avenida Praia de Camurupim',
      display_name:
        'Avenida Praia de Camurupim, Camurupim, Nísia Floresta, Rio Grande do Norte, Região Nordeste, 59164-000, Brasil',
      licence: LICENCA,
    },
  ],
  'camurupim, nisia floresta, rn': [
    {
      lat: '-6.0839085',
      lon: '-35.1040435',
      addresstype: 'village',
      type: 'administrative',
      name: 'Camurupim',
      display_name: 'Camurupim, Nísia Floresta, Rio Grande do Norte, Região Nordeste, 59164-000, Brasil',
      licence: LICENCA,
    },
  ],
  '59164-000, nisia floresta, rn': [
    {
      lat: '-6.0763909',
      lon: '-35.1699153',
      addresstype: 'postcode',
      type: 'postcode',
      name: '59164-000',
      display_name: '59164-000, Nísia Floresta, Rio Grande do Norte, Região Nordeste, Brasil',
      licence: LICENCA,
    },
  ],
};

function chave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function loggerMudo(): Logger {
  const nada = () => undefined;
  return { debug: nada, info: nada, warn: nada, error: nada };
}

/** O Nominatim dublê: responde pelo `q`, guarda cada URL e os cabeçalhos. */
function nominatimDuble(opcoes: { falhar?: boolean } = {}) {
  const pedidos: { url: string; userAgent: string | null }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const endereco = String(url);
    const headers = new Headers(init?.headers);
    pedidos.push({ url: endereco, userAgent: headers.get('User-Agent') });
    if (opcoes.falhar === true) throw new Error('rede caiu');
    const q = new URL(endereco).searchParams.get('q') ?? '';
    return new Response(JSON.stringify(RESPOSTAS_REAIS[chave(q)] ?? []), { status: 200 });
  }) as typeof fetch;
  const cliente = nominatimDaIa({
    userAgent: 'teste-do-mapa/1.0',
    fetchImpl,
    intervaloMs: 0,
    dormir: async () => {},
  });
  return { cliente, pedidos };
}

/** O banco: cache vazio, gravação aceita, e os imóveis com o pino escolhido para o TE0004. */
function bancoDoMapa(pinoDoTe0004: { lat: number; lng: number }) {
  return bancoFalso(
    { ai_runs: [], tasks: [] },
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
            endereco: 'Av Barra de Tabatinga, 2004 2004',
            cep: '59164000',
            latitude: pinoDoTe0004.lat,
            longitude: pinoDoTe0004.lng,
          },
          {
            codigo: 'TE0001_IMOVA',
            tipo: 'terreno',
            bairro: 'Capim Macio',
            cidade: 'Natal',
            endereco: 'Rua Missionário Joel Carlson 659',
            cep: '59082130',
            latitude: -5.8623832,
            longitude: -35.1979617,
          },
          {
            codigo: 'PT0001_IMOVA',
            tipo: 'casa',
            bairro: 'Ponta Negra',
            cidade: 'Natal',
            endereco: 'Avenida Praia de Pirangi 2206',
            cep: '59092300',
            latitude: -5.8800579,
            longitude: -35.1790818,
          },
        ],
      },
    },
  );
}

/**
 * O modelo dublê, com a política da Alinne: busca o condomínio; se não achou, busca a
 * avenida; depois responde. Guarda cada pedido (para ver os resultados que voltaram).
 */
function modeloDaAlinne(): { modelo: ClienteDoModelo; pedidos: PedidoComFerramentas[] } {
  const pedidos: PedidoComFerramentas[] = [];
  const exemplo = atendenteImovaV7.exemplos[0]!;
  const uso = { entrada: 900, saida: 60, escritaDeCache: 0, leituraDeCache: 6000 };
  const pedirBusca = (id: string, referencia: string): VoltaDoModelo => ({
    tipo: 'ferramentas',
    chamadas: [{ id, nome: 'buscar_no_mapa', entrada: { referencia, cidade: 'Nísia Floresta' } }],
    conteudo: [{ type: 'tool_use', id, name: 'buscar_no_mapa', input: { referencia } }],
    uso,
    modelo: 'claude-haiku-5-5',
    paradaPor: 'tool_use',
  });
  return {
    pedidos,
    modelo: {
      conversar: () => Promise.reject(new Error('a v7 não usa conversar')),
      conversarComFerramentas: (pedido) => {
        pedidos.push(pedido);
        const resultados = pedido.turnos.flatMap((t) => (t.papel === 'resultados' ? t.resultados : []));
        if (resultados.length === 0) return Promise.resolve(pedirBusca('t1', 'Condomínio Serv Club'));
        if (resultados.length === 1 && resultados[0]!.texto.includes('não achado')) {
          return Promise.resolve(pedirBusca('t2', 'Avenida Praia de Camurupim'));
        }
        const ultimo = resultados.at(-1)!.texto;
        const achou = /(Bem perto|Na mesma região): [^.]*TE0004_IMOVA/.test(ultimo);
        return Promise.resolve({
          tipo: 'final',
          json: {
            ...exemplo.saida,
            mensagem: achou
              ? 'É o terreno de frente para o mar, em Nísia Floresta?'
              : 'Pode me dizer o bairro ou a praia onde fica o terreno?',
          },
          uso,
          modelo: 'claude-haiku-5-5',
          paradaPor: 'end_turn',
        });
      },
    },
  };
}

function contextoDe(banco: ReturnType<typeof bancoFalso>, modelo: ClienteDoModelo, mapa = undefined as never): ContextoDaIa {
  return { cliente: banco.cliente, modelo, logger: loggerMudo(), ...(mapa === undefined ? {} : { mapa }) };
}

const VINCULOS = { conversationId: '00000000-0000-4000-8000-0000000000c1' };
const CONTATO = { leadId: 'lead-a1b2c3', nome: 'Alinne Fernandes', empresa: null, telefones: ['+5584988776655'] };

async function rodarAlinne(pino: { lat: number; lng: number }) {
  esquecerImoveisDoMapa();
  const banco = bancoDoMapa(pino);
  const { cliente: nominatim, pedidos: aoMapa } = nominatimDuble();
  const busca = criarBuscaNoMapa({ cliente: banco.cliente, nominatim, logger: loggerMudo() });
  const { modelo, pedidos } = modeloDaAlinne();
  const contexto = contextoDe(banco, modelo);
  const ferramenta = ferramentaBuscarNoMapa({
    cliente: banco.cliente,
    busca,
    logger: loggerMudo(),
    maxBuscas: MAX_BUSCAS_NO_MAPA,
  });
  const executada = await executarComFerramentas(
    contexto,
    atendenteImovaV7,
    atendenteImovaV7.exemplos[0]!.entrada,
    CONTATO,
    VINCULOS,
    { buscar_no_mapa: ferramenta },
    { maxVoltas: MAX_VOLTAS_DO_ATENDENTE },
  );
  const resultados = pedidos.at(-1)!.turnos.flatMap((t) => (t.papel === 'resultados' ? t.resultados : []));
  return { executada, resultados, banco, aoMapa, pedidos };
}

afterEach(() => esquecerImoveisDoMapa());

describe('a distância é do código', () => {
  it('a avenida da Alinne fica na mesma região do pino novo do TE0004, e longe do antigo', () => {
    const novo = distanciaKm(AVENIDA, PINO_NOVO);
    const antigo = distanciaKm(AVENIDA, PINO_ANTIGO);
    expect(novo).toBeGreaterThan(1.5);
    expect(novo).toBeLessThan(5);
    expect(antigo).toBeGreaterThan(8);
    expect(antigo).toBeLessThan(9);
    expect(faixaDaDistancia(novo)).toBe('na mesma região');
    expect(faixaDaDistancia(antigo)).toBe('longe');
  });

  it('as faixas: até 1,5 km é bem perto, até 5 km a mesma região', () => {
    expect(faixaDaDistancia(0)).toBe('bem perto');
    expect(faixaDaDistancia(1.5)).toBe('bem perto');
    expect(faixaDaDistancia(1.51)).toBe('na mesma região');
    expect(faixaDaDistancia(5)).toBe('na mesma região');
    expect(faixaDaDistancia(5.01)).toBe('longe');
  });
});

describe('a consulta que vai ao mapa', () => {
  it('junta a cidade, tira marcador e número de casa, termina em RN', () => {
    expect(consultaDoMapa('Avenida Praia de Camurupim', 'Nísia Floresta')).toBe(
      'Avenida Praia de Camurupim, Nísia Floresta, RN',
    );
    expect(consultaDoMapa('Av Barra de Tabatinga, 2004', 'Nísia Floresta')).toBe(
      'Av Barra de Tabatinga, Nísia Floresta, RN',
    );
    expect(consultaDoMapa('Camurupim, Nísia Floresta', 'Nísia Floresta')).toBe('Camurupim, Nísia Floresta, RN');
    expect(consultaDoMapa('casa da [[NOME_1]] em Pipa', null)).toBe('casa da em Pipa, RN');
    expect(consultaDoMapa('Ponta Negra, Natal, RN', undefined)).toBe('Ponta Negra, Natal, RN');
  });

  it('telefone, e-mail, @ ou nada: não sai para o mapa', () => {
    expect(consultaDoMapa('liga 84 99988-0011 perto da praia', null)).toBeNull();
    expect(consultaDoMapa('ana@exemplo.com.br', null)).toBeNull();
    expect(consultaDoMapa('@imovel.pipa', null)).toBeNull();
    expect(consultaDoMapa('', 'Natal')).toBeNull();
    expect(consultaDoMapa(42, 'Natal')).toBeNull();
  });

  it('a rua do anúncio vai sem número', () => {
    expect(ruaSemNumero('Av Barra de Tabatinga, 2004 2004')).toBe('Av Barra de Tabatinga');
    expect(ruaSemNumero('Rua Missionário Joel Carlson 659')).toBe('Rua Missionário Joel Carlson');
    expect(ruaSemNumero('Rua do Cordeiro, SN')).toBe('Rua do Cordeiro');
    expect(ruaSemNumero('2004')).toBe('2004');
  });
});

describe('o texto que volta para a IA', () => {
  const imoveis: ImovelNoMapa[] = [
    { codigo: 'TE0004_IMOVA', tipo: 'terreno', bairro: 'Praia de Tabatinga', cidade: 'Nísia Floresta', rua: null, cep: null, pino: { ...PINO_NOVO, aproximado: false } },
    { codigo: 'TE0007', tipo: 'terreno', bairro: 'Pipa', cidade: 'Tibau do Sul', rua: null, cep: null, pino: null },
  ];
  const avenida: LugarNoMapa = { nome: 'Avenida Praia de Camurupim', tipo: 'secondary', nivel: 'ponto', bairro: 'Camurupim', cidade: 'Nísia Floresta', ...AVENIDA };
  const cep: LugarNoMapa = { nome: '59164-000', tipo: 'postcode', nivel: 'cidade', bairro: null, cidade: 'Nísia Floresta', lat: -6.0763909, lng: -35.1699153 };

  it('lugar achado: o nome, a escala, onde fica, as faixas e quem ficou fora da conta', () => {
    const texto = textoDoResultado('Avenida Praia de Camurupim, Nísia Floresta, RN', [avenida], imoveis);
    expect(texto).toBe(
      '"Avenida Praia de Camurupim, Nísia Floresta": achado no mapa: Avenida Praia de Camurupim (rua), em Camurupim, Nísia Floresta. ' +
        'Na mesma região: TE0004_IMOVA (terreno, Praia de Tabatinga). Sem lugar no mapa, fora da conta: TE0007.',
    );
  });

  it('CEP da cidade inteira: os imóveis nossos nesta cidade, sem repetir o CEP', () => {
    const texto = textoDoResultado('59164-000, Nísia Floresta, RN', [cep], imoveis);
    expect(texto).toBe(
      '"CEP, Nísia Floresta": achado no mapa como cidade inteira (Nísia Floresta). Imóveis nossos nesta cidade: TE0004_IMOVA (terreno, Praia de Tabatinga).',
    );
    expect(texto).not.toMatch(/\d{5}/);
  });

  it('não achado: pede referência mais geral', () => {
    expect(textoDoResultado('Condomínio Serv Club, Nísia Floresta, RN', [], imoveis)).toBe(
      '"Condomínio Serv Club, Nísia Floresta": não achado no mapa. Tente uma referência mais geral (o bairro, a praia ou a cidade).',
    );
  });

  it('nenhum texto tem o que a auditoria confunda com telefone', () => {
    for (const texto of [
      textoDoResultado('Avenida Praia de Camurupim, Nísia Floresta, RN', [avenida], imoveis),
      textoDoResultado('59164-000, Nísia Floresta, RN', [cep], imoveis),
      textoDoResultado('Rua 2004 2004 2004, RN', [], imoveis),
    ]) {
      expect(varrerMontagem(texto)).toEqual([]);
      expect(verificarSemPiiNaConversa(texto)).toEqual([]);
    }
  });
});

describe('o caso da Alinne, no laço da v7', () => {
  it('com o pino novo: o condomínio não é achado, a avenida é, e o TE0004 fica na mesma região', async () => {
    const { executada, resultados, banco, aoMapa, pedidos } = await rodarAlinne(PINO_NOVO);
    expect(resultados.map((r) => r.texto)).toEqual([
      '"Condomínio Serv Club, Nísia Floresta": não achado no mapa. Tente uma referência mais geral (o bairro, a praia ou a cidade).',
      '"Avenida Praia de Camurupim, Nísia Floresta": achado no mapa: Avenida Praia de Camurupim (rua), em Camurupim, Nísia Floresta. ' +
        'Na mesma região: TE0004_IMOVA (terreno, Praia de Tabatinga).',
    ]);
    expect(executada.saida.mensagem).toBe('É o terreno de frente para o mar, em Nísia Floresta?');
    expect(executada.voltas).toBe(3);
    expect(executada.aiRunIds).toHaveLength(3);
    expect(executada.aiRunId).toBe(executada.aiRunIds.at(-1));
    // Cada volta é uma linha em ai_runs, da v7, com tokens e custo.
    const linhas = banco.tabelas.ai_runs ?? [];
    expect(linhas).toHaveLength(3);
    expect(linhas.every((l) => l.prompt_version === 'atendente-imova@v7' && l.status === 'ok')).toBe(true);
    expect(linhas.every((l) => l.tokens_in === 900 && l.tokens_cache_read === 6000)).toBe(true);
    expect((linhas[0]?.output as { ferramentas: unknown[] }).ferramentas).toEqual([
      { nome: 'buscar_no_mapa', entrada: { referencia: 'Condomínio Serv Club', cidade: 'Nísia Floresta' } },
    ]);
    // O mapa: o User-Agent, até três resultados, só no RN, e a resposta no cache.
    expect(aoMapa).toHaveLength(2);
    expect(aoMapa.every((p) => p.userAgent === 'teste-do-mapa/1.0')).toBe(true);
    expect(aoMapa[0]!.url).toContain('limit=3');
    expect(aoMapa[0]!.url).toContain('bounded=1');
    expect(decodeURIComponent(aoMapa[0]!.url)).toContain('viewbox=-38.6,-4.8,-34.9,-7.0');
    expect(banco.chamadasDeRpc.filter((c) => c.nome === 'ia_lugar_no_mapa_gravar')).toHaveLength(2);
    // As ferramentas vão em toda volta; nenhuma volta foi a última forçada.
    expect(pedidos.every((p) => p.ferramentas.map((f) => f.nome).join() === 'buscar_no_mapa')).toBe(true);
    expect(pedidos.some((p) => p.semFerramentas === true)).toBe(false);
  });

  it('com o pino antigo: a mesma avenida dá "nenhum imóvel nosso perto"', async () => {
    const { executada, resultados } = await rodarAlinne(PINO_ANTIGO);
    expect(resultados.at(-1)!.texto).toBe(
      '"Avenida Praia de Camurupim, Nísia Floresta": achado no mapa: Avenida Praia de Camurupim (rua), em Camurupim, Nísia Floresta. ' +
        'Nenhum imóvel nosso perto.',
    );
    expect(executada.saida.mensagem).toBe('Pode me dizer o bairro ou a praia onde fica o terreno?');
  });

  it('o cache: a mesma pergunta, guardada, não volta ao OpenStreetMap', async () => {
    esquecerImoveisDoMapa();
    const banco = bancoFalso(
      {},
      {
        rpcs: {
          ia_lugar_no_mapa_ler: () => [
            { nome: 'Avenida Praia de Camurupim', tipo: 'secondary', nivel: 'ponto', bairro: 'Camurupim', cidade: 'Nísia Floresta', ...AVENIDA },
          ],
          ia_imoveis_no_mapa: () => [],
        },
      },
    );
    const { cliente: nominatim, pedidos } = nominatimDuble();
    const busca = criarBuscaNoMapa({ cliente: banco.cliente, nominatim, logger: loggerMudo() });
    const r = await busca.buscar('Avenida Praia de Camurupim, Nísia Floresta, RN');
    expect(r.doCache).toBe(true);
    expect(r.lugares[0]?.bairro).toBe('Camurupim');
    expect(pedidos).toHaveLength(0);
  });
});

describe('teto, falha e auditoria', () => {
  function ferramentaDe(banco: ReturnType<typeof bancoFalso>, opcoes: { falhar?: boolean } = {}) {
    const { cliente: nominatim, pedidos } = nominatimDuble(opcoes);
    const busca = criarBuscaNoMapa({ cliente: banco.cliente, nominatim, logger: loggerMudo() });
    return {
      ferramenta: ferramentaBuscarNoMapa({ cliente: banco.cliente, busca, logger: loggerMudo(), maxBuscas: MAX_BUSCAS_NO_MAPA }),
      pedidos,
    };
  }

  it('três buscas por resposta; a repetida não conta; a quarta diz que acabou', async () => {
    const banco = bancoDoMapa(PINO_NOVO);
    const { ferramenta, pedidos } = ferramentaDe(banco);
    const a = await ferramenta({ referencia: 'Condomínio Serv Club', cidade: 'Nísia Floresta' });
    const repetida = await ferramenta({ referencia: 'condominio serv club', cidade: 'Nisia Floresta' });
    expect(repetida.texto).toBe(a.texto);
    await ferramenta({ referencia: 'Serv Club', cidade: 'Nísia Floresta' });
    await ferramenta({ referencia: 'Camurupim', cidade: 'Nísia Floresta' });
    const quarta = await ferramenta({ referencia: 'Avenida Praia de Camurupim', cidade: 'Nísia Floresta' });
    expect(quarta).toEqual({ texto: 'Acabaram as buscas desta resposta: responda com o que já tem.', erro: true });
    expect(pedidos).toHaveLength(3);
  });

  it('o mapa caiu: "busca indisponível", sem lançar', async () => {
    const banco = bancoDoMapa(PINO_NOVO);
    const { ferramenta } = ferramentaDe(banco, { falhar: true });
    expect(await ferramenta({ referencia: 'Avenida Praia de Camurupim', cidade: 'Nísia Floresta' })).toEqual({
      texto: 'Busca indisponível agora: responda com o que já tem.',
      erro: true,
    });
  });

  it('consulta com telefone não sai para o mapa', async () => {
    const banco = bancoDoMapa(PINO_NOVO);
    const { ferramenta, pedidos } = ferramentaDe(banco);
    const r = await ferramenta({ referencia: 'me liga no 84 99988-0011', cidade: 'Natal' });
    expect(r.erro).toBe(true);
    expect(pedidos).toHaveLength(0);
  });

  /** Um modelo que só pede ferramenta, a não ser que a volta o proíba. */
  function modeloTeimoso(obedece: boolean) {
    const pedidos: PedidoComFerramentas[] = [];
    let n = 0;
    const exemplo = atendenteImovaV7.exemplos[0]!;
    const uso = { entrada: 100, saida: 10, escritaDeCache: 0, leituraDeCache: 0 };
    const modelo: ClienteDoModelo = {
      conversar: () => Promise.reject(new Error('não')),
      conversarComFerramentas: (pedido) => {
        pedidos.push(pedido);
        n += 1;
        if (obedece && pedido.semFerramentas === true) {
          return Promise.resolve({ tipo: 'final', json: exemplo.saida, uso, modelo: 'claude-haiku-5-5', paradaPor: 'end_turn' });
        }
        const id = `t${n}`;
        return Promise.resolve({
          tipo: 'ferramentas',
          chamadas: [{ id, nome: 'buscar_no_mapa', entrada: { referencia: `Praia número ${'x'.repeat(n)}` } }],
          conteudo: [{ type: 'tool_use', id, name: 'buscar_no_mapa', input: {} }],
          uso,
          modelo: 'claude-haiku-5-5',
          paradaPor: 'tool_use',
        });
      },
    };
    return { modelo, pedidos };
  }

  it('o laço tem teto: a última volta proíbe ferramenta e o modelo responde', async () => {
    const banco = bancoDoMapa(PINO_NOVO);
    const { ferramenta } = ferramentaDe(banco);
    const { modelo, pedidos } = modeloTeimoso(true);
    const executada = await executarComFerramentas(
      contextoDe(banco, modelo),
      atendenteImovaV7,
      atendenteImovaV7.exemplos[0]!.entrada,
      CONTATO,
      VINCULOS,
      { buscar_no_mapa: ferramenta },
      { maxVoltas: MAX_VOLTAS_DO_ATENDENTE },
    );
    expect(executada.voltas).toBe(MAX_VOLTAS_DO_ATENDENTE);
    expect(pedidos.map((p) => p.semFerramentas === true)).toEqual([false, false, false, false, true]);
    const ultimos = pedidos.at(-1)!.turnos.flatMap((t) => (t.papel === 'resultados' ? t.resultados : []));
    expect(ultimos.at(-1)!.texto).toBe('Acabaram as buscas desta resposta: responda com o que já tem.');
  });

  it('modelo que desobedece a última volta: TetoDoLacoError, e cada volta ficou em ai_runs', async () => {
    const banco = bancoDoMapa(PINO_NOVO);
    const { ferramenta } = ferramentaDe(banco);
    const { modelo } = modeloTeimoso(false);
    await expect(
      executarComFerramentas(
        contextoDe(banco, modelo),
        atendenteImovaV7,
        atendenteImovaV7.exemplos[0]!.entrada,
        CONTATO,
        VINCULOS,
        { buscar_no_mapa: ferramenta },
        { maxVoltas: 3 },
      ),
    ).rejects.toBeInstanceOf(TetoDoLacoError);
    expect(banco.tabelas.ai_runs).toHaveLength(3);
  });

  it('resultado de ferramenta com telefone não volta ao modelo: fica bloqueado e a resposta sai', async () => {
    const banco = bancoDoMapa(PINO_NOVO);
    const vazadora: FerramentaDoLaco = () => Promise.resolve({ texto: 'ligue 84 99988-0011' });
    const { modelo, pedidos } = modeloTeimoso(true);
    const executada = await executarComFerramentas(
      contextoDe(banco, modelo),
      atendenteImovaV7,
      atendenteImovaV7.exemplos[0]!.entrada,
      CONTATO,
      VINCULOS,
      { buscar_no_mapa: vazadora },
      { maxVoltas: 2 },
    );
    const voltou = pedidos.at(-1)!.turnos.flatMap((t) => (t.papel === 'resultados' ? t.resultados : []));
    expect(voltou).toEqual([{ id: 't1', texto: 'resultado indisponível agora; siga com o que já tem', erro: true }]);
    expect(JSON.stringify(pedidos)).not.toContain('99988');
    expect((banco.tabelas.ai_runs ?? []).map((l) => l.status)).toEqual(['ok', 'bloqueado', 'ok']);
    expect(executada.voltas).toBe(2);
  });

  it('sem conversarComFerramentas no cliente do modelo, o laço recusa com nome', async () => {
    const banco = bancoDoMapa(PINO_NOVO);
    const modelo: ClienteDoModelo = { conversar: () => Promise.reject(new Error('não')) };
    await expect(
      executarComFerramentas(contextoDe(banco, modelo), atendenteImovaV7, atendenteImovaV7.exemplos[0]!.entrada, CONTATO, VINCULOS, {}, { maxVoltas: 2 }),
    ).rejects.toThrow(/não conversa com ferramentas/);
  });
});

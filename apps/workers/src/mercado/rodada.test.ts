import { describe, expect, it } from 'vitest';

import { parseArgs } from '../cli';
import { loadEnv } from '../lib/env';
import { createLogger } from '../lib/log';
import { destinoDoPedido } from '../workers/mercado';
import {
  chaveDoPedido,
  diaEmFortaleza,
  gravadorDeEnsaio,
  motivoDoBancoErrado,
  type EstadoDoMercado,
} from './banco';
import { COLETORES } from './coletores';
import type { RegiaoDoBanco } from './regioes';
import { executarFonte, motivoParaNaoRodar, type DependenciasDaRodada } from './rodada';
import type { FonteDaLista, Gravador, ItemAnuncio } from './tipos';

const logger = createLogger({
  worker: 'teste',
  level: 'error',
  stdout: () => {},
  stderr: () => {},
});

const REGIOES: RegiaoDoBanco[] = [
  {
    id: 'tibau-do-sul-pipa',
    cidade: 'Tibau do Sul',
    chaves: ['pipa'],
    abrangencia: 'area',
    ativa: true,
  },
  {
    id: 'natal-ponta-negra',
    cidade: 'Natal',
    chaves: ['ponta negra'],
    abrangencia: 'bairro',
    ativa: true,
  },
];

const fonte = (x: Partial<FonteDaLista> = {}): FonteDaLista => ({
  id: 'zil-monteiro',
  nome: 'Zil Monteiro',
  grupo: 'anuncios',
  url: 'https://www.zilmonteiro.com.br/',
  veredito: 'CONDICIONAL',
  intervalo_min_seg: 5,
  max_por_rodada: 100,
  licenca: 'termos do site',
  frequencia: 'rodada',
  coletor: 'anuncios/imobibrasil',
  liberada: true,
  reconferir: false,
  pode_coletar: true,
  ...x,
});

/** O site de mentira da Zil Monteiro: robots, mapa do site e duas páginas de imóvel. */
function siteDaZil(opcoes: { robots?: string; imovel2?: number; mapaVazio?: boolean } = {}) {
  const pedidos: string[] = [];
  const pagina = (preco: string, bairro: string) =>
    `<script type="application/ld+json">{"@type":"Product","name":"Casa para Venda em bairro ${bairro}, Tibau do Sul / RN, 3 dormitórios","offers":{"price":"${preco}"}}</script>
     <div>Área Construída: 200 m² Área Total: 500 m²</div>`;
  const rotas: Record<string, () => Response> = {
    'https://www.zilmonteiro.com.br/robots.txt': () =>
      new Response(opcoes.robots ?? 'User-agent: *\nAllow: /'),
    'https://www.zilmonteiro.com.br/sitemap.xml': () =>
      opcoes.mapaVazio
        ? new Response(
            '<urlset><url><loc>https://www.zilmonteiro.com.br/contato</loc></url></urlset>',
          )
        : new Response(`<urlset>
      <url><loc>https://www.zilmonteiro.com.br/imovel/1/casa-venda-tibau-do-sul-rn-praia-da-pipa</loc></url>
      <url><loc>https://www.zilmonteiro.com.br/imovel/2/casa-venda-tibau-do-sul-rn-praia-da-pipa</loc></url>
      <url><loc>https://www.zilmonteiro.com.br/imovel/3/casa-venda-natal-rn-alecrim</loc></url>
      <url><loc>https://www.zilmonteiro.com.br/imovel/4/casa-temporada-tibau-do-sul-rn-praia-da-pipa</loc></url></urlset>`),
    'https://www.zilmonteiro.com.br/imovel/1/casa-venda-tibau-do-sul-rn-praia-da-pipa': () =>
      new Response(pagina('900000', 'Praia da Pipa')),
    'https://www.zilmonteiro.com.br/imovel/2/casa-venda-tibau-do-sul-rn-praia-da-pipa': () =>
      opcoes.imovel2
        ? new Response('x', { status: opcoes.imovel2 })
        : new Response(pagina('750000', 'Praia da Pipa')),
  };
  const fetchImpl = (async (entrada: string | URL | Request) => {
    const url = String(entrada);
    pedidos.push(url);
    const f = rotas[url];
    return f ? f() : new Response('não achei', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, pedidos };
}

function deps(
  over: Partial<DependenciasDaRodada> & {
    fonteDaLista?: FonteDaLista | null;
    estado?: Record<string, unknown>;
    banco?: EstadoDoMercado | null;
  } = {},
) {
  const registro = {
    abertas: 0,
    fechamentos: [] as Array<Record<string, unknown>>,
    anuncios: [] as ItemAnuncio[],
    vistos: [] as string[],
  };
  const gravador: Gravador = {
    anuncios: async (itens) => {
      registro.anuncios.push(...itens);
      return { novos: itens.length, atualizados: 0, ignorados: 0, recusados: 0, erros: [] };
    },
    vistos: async (ids) => {
      registro.vistos.push(...ids);
      return ids.length;
    },
    indices: async () => 0,
    obras: async () => 0,
    proximidades: async () => 0,
  };
  let t = 1_000_000;
  const d: DependenciasDaRodada = {
    lerFonte: async () => (over.fonteDaLista === undefined ? fonte() : over.fonteDaLista),
    lerRegioes: async () => REGIOES,
    lerRotulosBloqueados: async () => ['zapimoveis', 'olx'],
    lerEstadoAnterior: async () => over.estado ?? {},
    lerPontos: async () => [],
    lerEstado: async () =>
      over.banco === undefined
        ? { empresa: 'imova', ligado: true, fila: true, rodando: false }
        : over.banco,
    abrirColeta: async () => {
      registro.abertas += 1;
      return { ok: true, coleta_id: 77 };
    },
    gravador: () => gravador,
    fecharColeta: async (a) => {
      registro.fechamentos.push(a as unknown as Record<string, unknown>);
      return { ok: true, situacao: a.erro ? 'erro' : 'ok' };
    },
    agora: () => t,
    dormir: async (ms) => {
      t += ms;
    },
    ...over,
  };
  return { d, registro };
}

describe('quem pode rodar (decidido pela lista, na hora)', () => {
  it('recusa fonte proibida, não liberada, a reconferir, sem coletor ou com coletor trocado', () => {
    expect(motivoParaNaoRodar(null, null, COLETORES)).toBe('fonte fora da lista');
    expect(
      motivoParaNaoRodar(fonte({ veredito: 'PROIBIDA', pode_coletar: false }), null, COLETORES),
    ).toBe('fonte PROIBIDA');
    expect(
      motivoParaNaoRodar(fonte({ liberada: false, pode_coletar: false }), null, COLETORES),
    ).toBe('fonte não liberada pelo dono');
    expect(
      motivoParaNaoRodar(fonte({ reconferir: true, pode_coletar: false }), null, COLETORES),
    ).toBe('fonte esperando nova conferência');
    expect(motivoParaNaoRodar(fonte({ coletor: null }), null, COLETORES)).toMatch(
      /não tem coletor/,
    );
    expect(motivoParaNaoRodar(fonte(), 'anuncios/lopes', COLETORES)).toMatch(
      /o pedido era do coletor/,
    );
    expect(motivoParaNaoRodar(fonte({ coletor: 'temporada' }), null, COLETORES)).toMatch(
      /não tem o coletor/,
    );
    expect(motivoParaNaoRodar(fonte(), 'anuncios/imobibrasil', COLETORES)).toBeNull();
  });

  it('toda fonte com coletor na migração tem coletor no worker', () => {
    for (const c of [
      'anuncios/chavesnamao',
      'anuncios/lopes',
      'anuncios/catalogue',
      'anuncios/imobibrasil',
      'anuncios/ibeda',
      'anuncios/imobinova',
      'anuncios/abreu',
      'anuncios/feeds',
      'fipezap',
      'bcb',
      'siconfi',
      'corrida',
      'construcao',
      'obras/dom-natal',
      'obras/obrasgov',
      'proximidades',
    ]) {
      expect(COLETORES.has(c)).toBe(true);
    }
  });
});

describe('uma rodada de uma fonte', () => {
  it('não abre coleta para fonte que não pode ser coletada', async () => {
    const { d, registro } = deps({ fonteDaLista: fonte({ liberada: false, pode_coletar: false }) });
    const r = await executarFonte(d, {
      fonteId: 'zil-monteiro',
      coletorPedido: 'anuncios/imobibrasil',
      logger,
    });
    expect(r).toEqual({ tipo: 'nao_roda', motivo: 'fonte não liberada pelo dono' });
    expect(registro.abertas).toBe(0);
  });

  it('robots fecha: a coleta fecha com erro e nada é pedido além do robots', async () => {
    const site = siteDaZil({ robots: 'User-agent: *\nDisallow: /' });
    const { d, registro } = deps({ fetchImpl: site.fetchImpl });
    const r = await executarFonte(d, { fonteId: 'zil-monteiro', coletorPedido: null, logger });
    expect(r.tipo).toBe('parou');
    expect(site.pedidos).toEqual(['https://www.zilmonteiro.com.br/robots.txt']);
    expect(registro.fechamentos[0]).toMatchObject({
      erro: expect.stringMatching(/robots/),
      consultasCompletas: [],
    });
  });

  it('lê o mapa e as páginas no ritmo, grava, toca quem não foi relido e fecha com a consulta completa', async () => {
    const site = siteDaZil();
    // A página 1 foi lida ontem; a 2, nunca: a 2 vem primeiro e o teto (robots + mapa + 1 página) para antes da 1.
    const { d, registro } = deps({
      fetchImpl: site.fetchImpl,
      fonteDaLista: fonte({ max_por_rodada: 2 }),
      estado: { lidos: { 1: '2026-11-18' } },
    });
    const r = await executarFonte(d, {
      fonteId: 'zil-monteiro',
      coletorPedido: 'anuncios/imobibrasil',
      logger,
      contato: 'dados.publicos@exemplo.com',
    });
    expect(r.tipo).toBe('ok');
    expect(site.pedidos).toEqual([
      'https://www.zilmonteiro.com.br/robots.txt',
      'https://www.zilmonteiro.com.br/sitemap.xml',
      'https://www.zilmonteiro.com.br/imovel/2/casa-venda-tibau-do-sul-rn-praia-da-pipa',
    ]);
    expect(
      registro.anuncios.map((a) => `${a.id_externo}:${a.preco}:${a.regiao_id}:${a.area_util}`),
    ).toEqual(['2:750000:tibau-do-sul-pipa:200']);
    expect(registro.vistos).toEqual(['1']);
    const f = registro.fechamentos[0] ?? {};
    expect(f).toMatchObject({ coletaId: 77, erro: null, consultasCompletas: ['mapa-do-site'] });
    const det = f.detalhes as Record<string, unknown>;
    expect(det.identificacao).toBe(
      'coletor-de-dados-publicos/1.0 (+contato: dados.publicos@exemplo.com)',
    );
    expect((det.estado as { lidos: Record<string, string> }).lidos).toMatchObject({
      1: '2026-11-18',
      2: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it('o imóvel que saiu do site (404) não é tocado: ganha falta no banco', async () => {
    const site = siteDaZil({ imovel2: 404 });
    const { d, registro } = deps({ fetchImpl: site.fetchImpl });
    await executarFonte(d, { fonteId: 'zil-monteiro', coletorPedido: null, logger });
    expect(registro.anuncios.map((a) => a.id_externo)).toEqual(['1']);
    expect(registro.vistos).toEqual([]);
  });

  it('429 no meio: a coleta fecha com erro e sem consulta completa (ninguém ganha falta)', async () => {
    const site = siteDaZil({ imovel2: 429 });
    const { d, registro } = deps({ fetchImpl: site.fetchImpl });
    const r = await executarFonte(d, { fonteId: 'zil-monteiro', coletorPedido: null, logger });
    expect(r.tipo).toBe('parou');
    expect(registro.fechamentos[0]).toMatchObject({
      erro: expect.stringMatching(/pediu para parar/),
      consultasCompletas: [],
    });
    expect(destinoDoPedido(r)).toBe('concluir');
  });

  it('ensaio: lê de verdade mas não abre coleta nem grava', async () => {
    const site = siteDaZil();
    const ensaio = gravadorDeEnsaio();
    const { d, registro } = deps({ fetchImpl: site.fetchImpl });
    const r = await executarFonte(d, {
      fonteId: 'zil-monteiro',
      coletorPedido: null,
      logger,
      ensaio: { gravador: ensaio },
    });
    expect(r.tipo).toBe('ok');
    expect(registro.abertas).toBe(0);
    expect(registro.fechamentos).toEqual([]);
    expect(ensaio.contagem.anuncios).toBe(2);
  });

  it('ensaio com a chave desligada: não roda e nenhum pedido sai ao site', async () => {
    const site = siteDaZil();
    const ensaio = gravadorDeEnsaio();
    const { d } = deps({
      fetchImpl: site.fetchImpl,
      banco: { empresa: 'imova', ligado: false, fila: true, rodando: false },
    });
    const r = await executarFonte(d, {
      fonteId: 'zil-monteiro',
      coletorPedido: null,
      logger,
      ensaio: { gravador: ensaio },
    });
    expect(r).toEqual({ tipo: 'nao_roda', motivo: expect.stringMatching(/desligada/) });
    expect(site.pedidos).toEqual([]);
  });

  it('ensaio com a mesma fonte rodando, ou num banco sem a inteligência de mercado: não roda', async () => {
    for (const banco of [
      { empresa: 'imova', ligado: true, fila: true, rodando: true },
      { empresa: 'komune', ligado: false, fila: false, rodando: null },
      null,
    ]) {
      const site = siteDaZil();
      const { d } = deps({ fetchImpl: site.fetchImpl, banco });
      const r = await executarFonte(d, {
        fonteId: 'zil-monteiro',
        coletorPedido: null,
        logger,
        ensaio: { gravador: gravadorDeEnsaio() },
      });
      expect(r.tipo).toBe('nao_roda');
      expect(site.pedidos).toEqual([]);
    }
  });

  it('a mesma fonte já rodando (outra cópia do worker, ou --fonte à mão): o banco não abre e nada é pedido', async () => {
    const site = siteDaZil();
    const { d, registro } = deps({
      fetchImpl: site.fetchImpl,
      abrirColeta: async () => ({ ok: false, motivo: 'ja_rodando' }),
    });
    const r = await executarFonte(d, { fonteId: 'zil-monteiro', coletorPedido: null, logger });
    expect(r).toEqual({ tipo: 'nao_roda', motivo: 'o banco não abriu a coleta (ja_rodando)' });
    expect(site.pedidos).toEqual([]);
    expect(registro.fechamentos).toEqual([]);
    expect(destinoDoPedido(r)).toBe('concluir');
  });

  it('mapa do site sem nenhum imóvel reconhecido: a consulta NÃO é completa (ninguém ganha falta)', async () => {
    const site = siteDaZil({ mapaVazio: true });
    const { d, registro } = deps({ fetchImpl: site.fetchImpl });
    const r = await executarFonte(d, { fonteId: 'zil-monteiro', coletorPedido: null, logger });
    expect(r.tipo).toBe('ok');
    const f = registro.fechamentos[0] ?? {};
    expect(f).toMatchObject({ erro: null, consultasCompletas: [] });
    expect((f.detalhes as { erros: string[] }).erros.join(' ')).toMatch(/mudou de formato/);
  });

  it('erro do coletor fecha a coleta com o erro e devolve a mensagem para nova tentativa', async () => {
    const { d, registro } = deps({
      fetchImpl: (async () => {
        throw new Error('rede caiu');
      }) as typeof fetch,
    });
    const r = await executarFonte(d, { fonteId: 'zil-monteiro', coletorPedido: null, logger });
    expect(r.tipo).toBe('parou'); // robots ilegível = a fonte não roda (não é tentado de novo à toa)
    expect(registro.fechamentos[0]?.erro).toMatch(/robots/);
    expect(destinoDoPedido({ tipo: 'falhou', erro: 'x', coletaId: 1, fechamento: null })).toBe(
      'falhar',
    );
  });
});

describe('o banco certo', () => {
  it('o worker só sobe no banco da Imova com a fila', () => {
    expect(motivoDoBancoErrado(null)).toMatch(/não tem a inteligência de mercado/);
    expect(
      motivoDoBancoErrado({ empresa: 'komune', ligado: false, fila: false, rodando: null }),
    ).toMatch(/só da Imova/);
    expect(
      motivoDoBancoErrado({ empresa: 'imova', ligado: false, fila: false, rodando: null }),
    ).toMatch(/fila/);
    expect(
      motivoDoBancoErrado({ empresa: 'imova', ligado: false, fila: true, rodando: null }),
    ).toBeNull();
  });
});

describe('a fila', () => {
  it('a chave de idempotência leva o dia de Fortaleza da entrada na fila', () => {
    expect(diaEmFortaleza(new Date('2026-11-23T09:00:00Z'))).toBe('2026-11-23');
    expect(diaEmFortaleza(new Date('2026-11-24T02:30:00Z'))).toBe('2026-11-23');
    expect(chaveDoPedido({ fonte: 'bcb' }, '2026-11-23T09:00:00.123+00:00')).toBe(
      'mercado:bcb:2026-11-23',
    );
    expect(chaveDoPedido({ fonte: 'bcb', chave: 'outra' }, '2026-11-23T09:00:00Z')).toBe('outra');
  });
});

describe('o comando no CLI e o ambiente', () => {
  it('aceita mercado com --uma-vez, --fonte e --ensaio, e recusa opção errada', () => {
    expect(parseArgs(['mercado', '--uma-vez'])).toEqual({
      kind: 'run',
      command: 'mercado',
      opcoes: { 'uma-vez': true },
    });
    expect(parseArgs(['mercado', '--fonte=bcb', '--ensaio'])).toEqual({
      kind: 'run',
      command: 'mercado',
      opcoes: { fonte: 'bcb', ensaio: true },
    });
    expect(parseArgs(['mercado', '--fontes=bcb'])).toMatchObject({ kind: 'error' });
    expect(parseArgs([], { WORKER_COMANDO: 'mercado --uma-vez' })).toEqual({
      kind: 'run',
      command: 'mercado',
      opcoes: { 'uma-vez': true },
    });
  });

  it('o contato do robô é opcional, e recusado se citar a empresa', () => {
    const base = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'chave' };
    expect(loadEnv('mercado', base).ok).toBe(true);
    expect(loadEnv('mercado', { ...base, COLETOR_CONTATO: '' }).ok).toBe(true);
    expect(loadEnv('mercado', { ...base, COLETOR_CONTATO: 'dados.publicos@exemplo.com' }).ok).toBe(
      true,
    );
    const ruim = loadEnv('mercado', { ...base, COLETOR_CONTATO: 'coleta@imova.com.br' });
    expect(ruim.ok).toBe(false);
    if (!ruim.ok) expect(ruim.issues.join(' ')).toMatch(/genérico/);
  });
});

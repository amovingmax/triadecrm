/**
 * O caminho do worker até o PostgREST, com um fetch de mentira: o que sai no
 * corpo do upsert, qual função é chamada e o que acontece num banco sem a
 * inteligência de mercado (KOMUNE).
 */
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { abrirColeta, gravadorDoBanco, lerEstadoDoMercado, type ClienteDoBanco } from './banco';
import type { LinhaIndice, LinhaObra } from './tipos';

type Pedido = { metodo: string; url: string; corpo: unknown };

/** Um PostgREST de mentira: guarda cada pedido e responde o que a função `responder` mandar. */
function postgrest(
  responder: (p: Pedido) => Response = () =>
    new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } }),
) {
  const pedidos: Pedido[] = [];
  const fetchImpl = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    const bruto = init?.body;
    const p: Pedido = {
      metodo: init?.method ?? 'GET',
      url,
      corpo: typeof bruto === 'string' && bruto ? JSON.parse(bruto) : null,
    };
    pedidos.push(p);
    return responder(p);
  }) as typeof fetch;
  const cliente = createClient('http://127.0.0.1:54321', 'chave-de-teste', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchImpl },
  }) as unknown as ClienteDoBanco;
  return { cliente, pedidos };
}

const indice = (x: Partial<LinhaIndice>): LinhaIndice => ({
  serie: 'corrida-parnamirim-pirangi-casa-venda',
  mes: '2026-11-01',
  valor: 1,
  nome: 'n',
  unidade: 'R$/m²',
  metodo: 'csv',
  url: 'https://x',
  ...x,
});

describe('o gravador do banco', () => {
  it('índices: a mesma série e mês duas vezes no lote viram uma linha só (o upsert não quebra)', async () => {
    const { cliente, pedidos } = postgrest();
    const n = await gravadorDoBanco(cliente, 77, 'corrida-dos-bairros').indices([
      indice({ valor: 5000, amostra: 12 }),
      indice({ valor: 5200, amostra: 30 }),
      indice({ serie: 'geomapas-alvara-x', valor: 2 }),
    ]);
    expect(n).toBe(2);
    expect(pedidos).toHaveLength(1);
    const p = pedidos[0];
    expect(p?.metodo).toBe('POST');
    expect(p?.url).toMatch(/\/rest\/v1\/mercado_indices\?on_conflict=serie%2Cmes/);
    const corpo = p?.corpo as Array<Record<string, unknown>>;
    const chaves = corpo.map((l) => `${String(l.serie)}|${String(l.mes)}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(corpo[0]).toMatchObject({
      valor: 5200,
      amostra: 30,
      fonte: 'corrida-dos-bairros',
      coleta_id: 77,
      aproximado: false,
    });
    expect(typeof corpo[0]?.coletado_em).toBe('string');
  });

  it('obras: a mesma obra duas vezes no lote vai uma vez só, com a fonte e a coleta', async () => {
    const { cliente, pedidos } = postgrest();
    const obra: LinhaObra = {
      id_externo: 'dom-1:tirol',
      url: 'https://x',
      tipo: 'alvara',
      fase: 'prevista',
      objeto: 'obra',
      publicado_em: '2026-11-10',
    };
    expect(
      await gravadorDoBanco(cliente, 9, 'dom-natal').obras([
        obra,
        { ...obra, objeto: 'obra (de novo)' },
      ]),
    ).toBe(1);
    expect(pedidos[0]?.url).toMatch(/mercado_obras\?on_conflict=fonte%2Cid_externo/);
    expect(pedidos[0]?.corpo).toEqual([
      expect.objectContaining({
        id_externo: 'dom-1:tirol',
        objeto: 'obra (de novo)',
        fonte: 'dom-natal',
        coleta_id: 9,
      }),
    ]);
  });
});

describe('o estado e a abertura', () => {
  it('banco sem a função (KOMUNE): o estado é null, sem erro', async () => {
    const { cliente } = postgrest(
      () =>
        new Response(
          JSON.stringify({
            code: 'PGRST202',
            details: null,
            hint: null,
            message:
              'Could not find the function public.mercado_worker_estado(p_fonte) in the schema cache',
          }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        ),
    );
    expect(await lerEstadoDoMercado(cliente)).toBeNull();
  });

  it('banco da Imova: lê empresa, chave, fila e "já rodando"', async () => {
    const { cliente, pedidos } = postgrest(
      () =>
        new Response(
          JSON.stringify({ empresa: 'imova', ligado: false, fila: true, rodando: true }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    expect(await lerEstadoDoMercado(cliente, 'lopes')).toEqual({
      empresa: 'imova',
      ligado: false,
      fila: true,
      rodando: true,
    });
    expect(pedidos[0]?.url).toMatch(/\/rpc\/mercado_worker_estado$/);
    expect(pedidos[0]?.corpo).toEqual({ p_fonte: 'lopes' });
  });

  it('outro erro do banco sobe', async () => {
    const { cliente } = postgrest(
      () =>
        new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(lerEstadoDoMercado(cliente)).rejects.toThrow(/permission denied/);
  });

  it('a coleta automática abre pela função com a trava "uma por fonte"', async () => {
    const { cliente, pedidos } = postgrest(
      () =>
        new Response(JSON.stringify({ ok: false, motivo: 'ja_rodando', coleta_id: 5 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    expect(await abrirColeta(cliente, 'lopes', 'v1:anuncios/lopes', { a: 1 })).toMatchObject({
      ok: false,
      motivo: 'ja_rodando',
    });
    expect(pedidos[0]?.url).toMatch(/\/rpc\/mercado_coleta_abrir_worker$/);
    expect(pedidos[0]?.corpo).toEqual({
      p_fonte: 'lopes',
      p_coletor_versao: 'v1:anuncios/lopes',
      p_detalhes: { a: 1 },
    });
  });
});

// =============================================================================
// Testes da porta da API (`atender.ts` e `pedido.ts`), com o banco de mentira.
// Rodam sem rede e sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     deno test api/
//
// O que estes testes protegem:
//   1. que o banco nunca receba a chave, só o SHA-256 dela;
//   2. que chave ausente ou sem forma, método estranho, corpo grande ou que não
//      é objeto JSON sejam recusados ANTES do banco;
//   3. que o caminho chegue ao banco sem o nome da função, venha pela URL
//      pública ou pelo gateway;
//   4. que o status e o corpo sejam os do banco, sem `status` e `registros`;
//   5. que a função não ponha cabeçalho de CORS (o gateway do Supabase põe o
//      dele; a chave não vive em navegador — ver atender.ts);
//   6. que o banco fora do ar vire 503 com Retry-After, e o 429 leve Retry-After;
//   7. que o log não leve a chave inteira, o corpo nem o caminho.
// =============================================================================

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { criarAtendente, type Pedido, type RespostaDoBanco } from './atender.ts';
import { caminhoDaRota, lerChave, resumoDaChave } from './pedido.ts';

const CHAVE = 'trd_imova_' + 'ab12'.repeat(12);
const URL_BASE = 'https://kkqadgxvmzulcamuakzk.supabase.co/functions/v1/api';

type Montado = {
  atender: (req: Request) => Promise<Response>;
  pedidos: Pedido[];
  logs: Record<string, unknown>[];
};

function montar(resposta: RespostaDoBanco | Error = { status: 200, dados: { ok: 1 } }): Montado {
  const pedidos: Pedido[] = [];
  const logs: Record<string, unknown>[] = [];
  const atender = criarAtendente({
    atender: (p) => {
      pedidos.push(p);
      return resposta instanceof Error ? Promise.reject(resposta) : Promise.resolve(resposta);
    },
    registrar: (_nivel, dados) => logs.push(dados),
    novoId: () => 'req-1',
  });
  return { atender, pedidos, logs };
}

function pedir(caminho: string, init: RequestInit & { chave?: string | null } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.chave !== null) headers.set('Authorization', `Bearer ${init.chave ?? CHAVE}`);
  return new Request(URL_BASE + caminho, { ...init, headers });
}

Deno.test('o banco recebe o SHA-256 da chave, nunca a chave', async () => {
  const m = montar();
  await m.atender(pedir('/v1'));
  assertEquals(m.pedidos.length, 1);
  assertEquals(m.pedidos[0].p_resumo, await resumoDaChave(CHAVE));
  assertFalse(JSON.stringify(m.pedidos[0]).includes(CHAVE));
});

Deno.test('a chave também vale em X-Api-Key', async () => {
  const m = montar();
  const r = await m.atender(pedir('/v1', { chave: null, headers: { 'X-Api-Key': CHAVE } }));
  assertEquals(r.status, 200);
  assertEquals(m.pedidos[0].p_resumo, await resumoDaChave(CHAVE));
});

Deno.test('sem chave, ou chave sem forma: 401 sem ir ao banco', async () => {
  for (const [chave, codigo] of [
    [null, 'chave_ausente'],
    ['eyJhbGciOiJIUzI1NiJ9.e30.x', 'chave_invalida'],
    ['trd_imova_123', 'chave_invalida'],
  ] as const) {
    const m = montar();
    const r = await m.atender(pedir('/v1', { chave }));
    assertEquals(r.status, 401);
    assertEquals((await r.json()).erro.codigo, codigo);
    assertEquals(m.pedidos.length, 0);
  }
});

Deno.test('o OPTIONS que chega à função recebe 405, e a função não põe CORS', async () => {
  const m = montar();
  const pre = await m.atender(pedir('/v1/fichas', { method: 'OPTIONS', chave: null }));
  assertEquals(pre.status, 405);
  assertEquals(pre.headers.get('access-control-allow-origin'), null);
  const r = await m.atender(pedir('/v1'));
  assertEquals(r.headers.get('access-control-allow-origin'), null);
  assertEquals(r.headers.get('cache-control'), 'no-store');
});

Deno.test('o caminho chega sem o nome da função, pela URL pública ou pelo gateway', () => {
  assertEquals(caminhoDaRota('/functions/v1/api/v1/fichas/'), 'v1/fichas');
  assertEquals(caminhoDaRota('/api/v1/conversas/abc/mensagens'), 'v1/conversas/abc/mensagens');
  assertEquals(caminhoDaRota('/api//v1//funis'), 'v1/funis');
  assertEquals(caminhoDaRota('/api'), '');
});

Deno.test('consulta, corpo e Idempotency-Key chegam ao banco', async () => {
  const m = montar({ status: 201, dados: { situacao: 'criada' } });
  const r = await m.atender(
    pedir('/v1/leads?origem=site&limite=5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': ' form-77 ' },
      body: JSON.stringify({ nome: 'Maria', telefone: '84999998888' }),
    }),
  );
  assertEquals(r.status, 201);
  const p = m.pedidos[0];
  assertEquals(p.p_metodo, 'POST');
  assertEquals(p.p_caminho, 'v1/leads');
  assertEquals(p.p_consulta, { origem: 'site', limite: '5' });
  assertEquals(p.p_corpo, { nome: 'Maria', telefone: '84999998888' });
  assertEquals(p.p_idempotencia, 'form-77');
});

Deno.test('GET não manda corpo; POST vazio vai como null', async () => {
  const m = montar();
  await m.atender(pedir('/v1/webhooks/x/teste', { method: 'POST' }));
  assertEquals(m.pedidos[0].p_corpo, null);
  await m.atender(pedir('/v1/fichas'));
  assertEquals(m.pedidos[1].p_corpo, null);
});

Deno.test('corpo que não é objeto JSON, ou grande demais: recusado antes do banco', async () => {
  for (const [corpo, status] of [
    ['{nome: Maria}', 400],
    ['[1, 2]', 400],
    ['"texto"', 400],
    ['x'.repeat(256 * 1024 + 1), 413],
  ] as const) {
    const m = montar();
    const r = await m.atender(pedir('/v1/leads', { method: 'POST', body: corpo }));
    assertEquals(r.status, status);
    assertEquals(m.pedidos.length, 0);
  }
});

Deno.test('o status e o corpo são os do banco, sem status e registros', async () => {
  const m = montar({
    status: 422,
    erro: { codigo: 'telefone_invalido', mensagem: 'x' },
    registros: 0,
  });
  const r = await m.atender(pedir('/v1/leads', { method: 'POST', body: '{"nome":"a"}' }));
  assertEquals(r.status, 422);
  const corpo = await r.json();
  assertEquals(corpo, { erro: { codigo: 'telefone_invalido', mensagem: 'x' } });
  assertEquals(r.headers.get('x-requisicao'), 'req-1');

  const lista = montar({ status: 200, dados: [{ id: 1 }], proximo: 'c1', registros: 1 });
  const rl = await lista.atender(pedir('/v1/fichas'));
  assertEquals(await rl.json(), { dados: [{ id: 1 }], proximo: 'c1' });
});

Deno.test('429 leva Retry-After com a espera que o banco calculou', async () => {
  const m = montar({
    status: 429,
    erro: { codigo: 'limite_por_minuto', mensagem: 'x', espera_s: 17 },
  });
  const r = await m.atender(pedir('/v1'));
  assertEquals(r.status, 429);
  assertEquals(r.headers.get('retry-after'), '17');
});

Deno.test('banco fora do ar: 503 com Retry-After, e o pedido não conta como feito', async () => {
  const m = montar(new Error('RPC devolveu 502: bad gateway'));
  const r = await m.atender(pedir('/v1'));
  assertEquals(r.status, 503);
  assertEquals(r.headers.get('retry-after'), '30');
  assertEquals((await r.json()).erro.codigo, 'crm_indisponivel');
});

Deno.test(
  'o log leva o começo da chave e o status, nunca a chave, o corpo ou o caminho',
  async () => {
    const m = montar();
    await m.atender(
      pedir('/v1/fichas/0b5a0f6e-1111-4222-8333-444455556666?telefone=84999998888', {
        method: 'PATCH',
        body: '{"nome":"Maria"}',
      }),
    );
    const tudo = JSON.stringify(m.logs);
    assertFalse(tudo.includes(CHAVE));
    assertFalse(tudo.includes('Maria'));
    assertFalse(tudo.includes('84999998888'));
    assertFalse(tudo.includes('0b5a0f6e'));
    assert(tudo.includes('trd_imova_ab12ab'));
    assertEquals(m.logs.at(-1)?.status, 200);
  },
);

Deno.test('o começo da chave é o mesmo que a tela mostra', () => {
  const imova = lerChave(new Headers({ Authorization: `Bearer ${CHAVE}` }));
  assert(imova.ok);
  assertEquals(imova.ok && imova.prefixo, 'trd_imova_ab12ab');
  const komune = lerChave(new Headers({ Authorization: `Bearer trd_komune_${'c'.repeat(48)}` }));
  assertEquals(komune.ok && komune.prefixo, 'trd_komune_cccccc');
});

// =============================================================================
// Testes da resposta a cada chamada (`atender.ts`), com o banco e os segredos
// de mentira. Rodam sem rede e sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     deno test grupozap-lead/
//
// O que estes testes protegem, em ordem de importância:
//   1. que lead gravado receba 200, SEMPRE — inclusive o de anúncio sem
//      `clientListingId`, que até 12/11/2026 recebia 422 (e o aviso fica no log);
//   2. que cada chamada seja anotada com o resultado certo (recebido, repetido,
//      teste, recusado_credencial, erro), o status e o user-agent do Grupo OLX,
//      e com nada da pessoa;
//   3. que a anotação que falha, demora ou lança não mude o status nem segure a
//      resposta;
//   4. que nenhum caminho devolva 404 ou 3xx.
// =============================================================================

import { assertEquals } from 'jsr:@std/assert@1';
import { criarAtendente, type Dependencias, type Recebido } from './atender.ts';
import type { Lead } from './lead.ts';
import type { Chamada } from './porta.ts';

const CHAVE = 'chave-de-mentira-so-para-o-teste';
const TESTE = 'chave-publica-de-teste-da-documentacao';
const URL_DA_FUNCAO = 'http://localhost/functions/v1/grupozap-lead';
const DO_GRUPO_OLX = 'grupozap-notification-api';

function basic(credencial: string): string {
  return `Basic ${btoa(credencial)}`;
}

/** Um lead de anúncio de verdade, com outro `originLeadId` que o de exemplo. */
const LEAD = {
  leadOrigin: 'Grupo OLX',
  timestamp: '2026-11-12T15:00:00.000Z',
  originLeadId: '6731a0b2c3d4e5f6a7b8c9d0',
  originListingId: '2790000001',
  clientListingId: 'TE0002_IMOVA',
  name: 'Maria Interessada',
  email: 'maria@exemplo.com.br',
  ddd: '84',
  phone: '981234567',
  message: 'Tenho interesse no terreno.',
  extraData: { leadType: 'CONTACT_FORM', leadCerto: 'false' },
};
const { clientListingId: _sem, ...SEM_CODIGO } = LEAD;

type Mundo = {
  deps: Dependencias;
  gravados: { chave: string; lead: Lead }[];
  anotadas: Chamada[];
  tarefas: Promise<unknown>[];
};

/** O mundo da função: segredos, banco e runtime, com o que cada teste mudar. */
function mundo(muda: Partial<Dependencias> & { recebido?: Recebido } = {}): Mundo {
  const gravados: Mundo['gravados'] = [];
  const anotadas: Chamada[] = [];
  const tarefas: Promise<unknown>[] = [];
  const { recebido, ...resto } = muda;
  const deps: Dependencias = {
    segredo: (nome) => Promise.resolve(nome === 'grupozap_lead_secret' ? CHAVE : null),
    segredoOpcional: (nome) =>
      Promise.resolve(nome === 'grupozap_lead_secret_teste' ? TESTE : null),
    receber: (chave, lead) => {
      gravados.push({ chave, lead });
      return Promise.resolve(recebido ?? { ok: true, duplicado: false, anuncio: 'encontrado' });
    },
    anotar: (c) => {
      anotadas.push(c);
      return Promise.resolve({ ok: true });
    },
    adiar: (t) => tarefas.push(t),
    prazoParaAnotarMs: 50,
    ...resto,
  };
  return { deps, gravados, anotadas, tarefas };
}

function post(
  corpo: unknown,
  cabecalhos: Record<string, string> = {},
  url = URL_DA_FUNCAO,
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: basic(`vivareal:${CHAVE}`),
      'user-agent': DO_GRUPO_OLX,
      ...cabecalhos,
    },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

type Atendido = { status: number; corpo: Record<string, unknown>; linhas: string[] };

/** Atende, espera as tarefas do runtime e devolve o status, o corpo e o log. */
async function atender(m: Mundo, req: Request): Promise<Atendido> {
  const linhas: string[] = [];
  const { log, error } = console;
  console.log = (l: string) => linhas.push(l);
  console.error = (l: string) => linhas.push(l);
  try {
    const resposta = await criarAtendente(m.deps)(req);
    await Promise.all(m.tarefas);
    const corpo = JSON.parse(await resposta.text());
    return { status: resposta.status, corpo, linhas };
  } finally {
    console.log = log;
    console.error = error;
  }
}

// -----------------------------------------------------------------------------
// 1. Lead gravado é 200, sempre
// -----------------------------------------------------------------------------
Deno.test('lead de anúncio sem código: 200, gravado, e o aviso no log', async () => {
  const m = mundo({ recebido: { ok: true, duplicado: false, anuncio: 'sem_codigo' } });
  const r = await atender(m, post(SEM_CODIGO));
  assertEquals(r.status, 200);
  assertEquals(r.corpo, { ok: true, duplicado: false });
  assertEquals(m.gravados.length, 1);
  assertEquals(m.gravados[0].chave, LEAD.originLeadId);
  const aviso = r.linhas.map((l) => JSON.parse(l)).find((l) => l.aviso === 'anuncio_sem_codigo');
  assertEquals(aviso?.nivel, 'aviso');
  assertEquals(aviso?.status, 200);
  assertEquals(m.anotadas, [{ resultado: 'recebido', status: 200, doGrupoOlx: true }]);
});

Deno.test(
  'lead com código: 200, gravado como veio (leadCerto em booleano), sem aviso',
  async () => {
    const m = mundo();
    const r = await atender(m, post(LEAD));
    assertEquals(r.status, 200);
    assertEquals((m.gravados[0].lead.extraData as Record<string, unknown>).leadCerto, false);
    assertEquals(
      r.linhas.some((l) => JSON.parse(l).aviso !== undefined),
      false,
    );
    assertEquals(m.anotadas, [{ resultado: 'recebido', status: 200, doGrupoOlx: true }]);
  },
);

Deno.test('o mesmo lead de novo: 200 e anotado como repetido', async () => {
  const m = mundo({ recebido: { ok: true, duplicado: true } });
  const r = await atender(m, post(SEM_CODIGO));
  assertEquals(r.status, 200);
  assertEquals(r.corpo.duplicado, true);
  assertEquals(m.anotadas, [{ resultado: 'repetido', status: 200, doGrupoOlx: true }]);
});

// -----------------------------------------------------------------------------
// 2. Cada resultado é anotado, e nada da pessoa vai junto
// -----------------------------------------------------------------------------
Deno.test('o lead de exemplo da documentação: 200, não gravado, anotado como teste', async () => {
  const m = mundo();
  const r = await atender(m, post({ ...LEAD, originLeadId: '59ee0fc6e4b043e1b2a6d863' }));
  assertEquals(r.status, 200);
  assertEquals(r.corpo.teste, true);
  assertEquals(m.gravados, []);
  assertEquals(m.anotadas, [{ resultado: 'teste', status: 200, doGrupoOlx: true }]);
});

Deno.test('a chave de teste: 200, não gravado, anotado como teste (outro user-agent)', async () => {
  const m = mundo();
  const r = await atender(
    m,
    post(SEM_CODIGO, { authorization: basic(`vivareal:${TESTE}`), 'user-agent': 'PostmanRuntime' }),
  );
  assertEquals(r.status, 200);
  assertEquals(m.gravados, []);
  assertEquals(m.anotadas, [{ resultado: 'teste', status: 200, doGrupoOlx: false }]);
});

Deno.test('chave errada: 401, anotado como recusa, separando o user-agent', async () => {
  for (const [ua, doGrupoOlx] of [
    [DO_GRUPO_OLX, true],
    ['curl/8.7.1', false],
  ] as const) {
    const m = mundo();
    const r = await atender(
      m,
      post(LEAD, { authorization: basic('vivareal:outra-chave'), 'user-agent': ua }),
    );
    assertEquals(r.status, 401);
    assertEquals(m.gravados, []);
    assertEquals(m.anotadas, [{ resultado: 'recusado_credencial', status: 401, doGrupoOlx }]);
  }
  // Sem cabeçalho também.
  const m = mundo();
  const r = await atender(
    m,
    new Request(URL_DA_FUNCAO, { method: 'POST', body: JSON.stringify(LEAD) }),
  );
  assertEquals(r.status, 401);
  assertEquals(m.anotadas, [{ resultado: 'recusado_credencial', status: 401, doGrupoOlx: false }]);
});

Deno.test('os erros (405, 413, 400, 500, 503) são anotados como erro, com o status', async () => {
  const casos: [string, Mundo, Request, number][] = [
    ['GET', mundo(), new Request(URL_DA_FUNCAO, { method: 'GET' }), 405],
    ['corpo grande', mundo(), post('x'.repeat(256 * 1024 + 1)), 413],
    ['JSON quebrado', mundo(), post('{"leadOrigin":'), 400],
    [
      'banco fora',
      mundo({ receber: () => Promise.reject(new Error('RPC devolveu 503')) }),
      post(LEAD),
      500,
    ],
    ['banco recusa', mundo({ recebido: { ok: false, motivo: 'chave_invalida' } }), post(LEAD), 500],
    ['sem a chave', mundo({ segredo: () => Promise.resolve(null) }), post(LEAD), 503],
    [
      'Vault fora',
      mundo({ segredoOpcional: () => Promise.reject(new Error('Vault')) }),
      post(LEAD),
      500,
    ],
  ];
  for (const [nome, m, req, status] of casos) {
    const r = await atender(m, req);
    assertEquals(r.status, status, nome);
    assertEquals(m.anotadas, [{ resultado: 'erro', status, doGrupoOlx: nome !== 'GET' }], nome);
  }
});

Deno.test('o que é anotado não leva nada da pessoa nem do corpo', async () => {
  const m = mundo();
  await atender(m, post(LEAD));
  const anotado = JSON.stringify(m.anotadas);
  for (const pessoal of [LEAD.name, LEAD.email, LEAD.phone, LEAD.message, LEAD.originLeadId]) {
    assertEquals(anotado.includes(pessoal), false, pessoal);
  }
  assertEquals(Object.keys(m.anotadas[0]).sort(), ['doGrupoOlx', 'resultado', 'status']);
});

// -----------------------------------------------------------------------------
// 3. A anotação não muda a resposta nem a segura
// -----------------------------------------------------------------------------
Deno.test('anotação que rejeita, que lança ou que diz ok: false não muda o status', async () => {
  const anotacoes: Dependencias['anotar'][] = [
    () => Promise.reject(new Error('relation "grupozap_lead_chamadas" does not exist')),
    () => {
      throw new Error('sem rede');
    },
    () => Promise.resolve({ ok: false, motivo: 'resultado_invalido' }),
  ];
  for (const anotar of anotacoes) {
    for (const [req, status] of [
      [post(SEM_CODIGO), 200],
      [post(LEAD, { authorization: basic('vivareal:errada') }), 401],
    ] as const) {
      const m = mundo({ anotar });
      const r = await atender(m, req.clone());
      assertEquals(r.status, status);
      assertEquals(
        r.linhas.some((l) => JSON.parse(l).evento === 'chamada_nao_anotada'),
        true,
      );
    }
  }
});

Deno.test('adiar que lança não muda o status', async () => {
  const m = mundo({
    adiar: () => {
      throw new Error('waitUntil indisponível');
    },
  });
  const r = await atender(m, post(SEM_CODIGO));
  assertEquals(r.status, 200);
  assertEquals(m.gravados.length, 1);
  // A anotação seguiu sozinha; espera o prazo para não deixar relógio aberto.
  await new Promise((r) => setTimeout(r, 80));
});

Deno.test('a resposta sai sem esperar a anotação', async () => {
  let soltar: () => void = () => {};
  const m = mundo({
    anotar: () => new Promise<void>((r) => (soltar = r)),
    prazoParaAnotarMs: 5_000,
  });
  const resposta = await criarAtendente(m.deps)(post(LEAD));
  // A resposta já está pronta e a anotação ainda não terminou.
  assertEquals(resposta.status, 200);
  assertEquals(m.tarefas.length, 1);
  let terminou = false;
  void m.tarefas[0].then(() => (terminou = true));
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(terminou, false);
  soltar();
  await Promise.all(m.tarefas);
  assertEquals(terminou, true);
  await resposta.body?.cancel();
});

// -----------------------------------------------------------------------------
// 4. Nunca 404, nunca 3xx
// -----------------------------------------------------------------------------
Deno.test('caminho com barra ou id a mais: a mesma resposta, nunca 404 ou 3xx', async () => {
  for (const url of [`${URL_DA_FUNCAO}/`, `${URL_DA_FUNCAO}/qualquer/coisa?x=1`]) {
    const m = mundo();
    const r = await atender(m, post(SEM_CODIGO, {}, url));
    assertEquals(r.status, 200, url);
  }
  for (const metodo of ['PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
    const m = mundo();
    const resposta = await criarAtendente(m.deps)(new Request(URL_DA_FUNCAO, { method: metodo }));
    await Promise.all(m.tarefas);
    assertEquals(resposta.status, 405, metodo);
    await resposta.body?.cancel();
  }
});

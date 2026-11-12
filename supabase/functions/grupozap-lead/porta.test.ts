// =============================================================================
// Testes da anotação das chamadas (a porta dos leads). Rodam sem rede e sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     deno test grupozap-lead/
//
// O que estes testes protegem, em ordem de importância:
//   1. que anotar NUNCA chegue a quem chamou: anotação que lança, que rejeita,
//      que devolve `ok: false`, que não termina, e `adiar` que lança viram um
//      aviso no log, e a tarefa entregue ao runtime nunca rejeita;
//   2. que a tarefa termine no prazo, mesmo com o banco pendurado;
//   3. que o `EdgeRuntime.waitUntil` seja usado quando existe;
//   4. que o user-agent do Grupo OLX seja reconhecido, e só ele.
// =============================================================================

import { assertEquals } from 'jsr:@std/assert@1';
import {
  adiarNoRuntime,
  anotarSemEsperar,
  type Chamada,
  ehDoGrupoOlx,
  USER_AGENT_DO_GRUPO_OLX,
} from './porta.ts';

const CHAMADA: Chamada = { resultado: 'recebido', status: 200, doGrupoOlx: true };

/** Guarda o que o log recebeu, sem sujar a saída do teste. */
async function comLog<T>(f: () => Promise<T>): Promise<{ valor: T; linhas: string[] }> {
  const linhas: string[] = [];
  const { log, error } = console;
  console.log = (l: string) => linhas.push(l);
  console.error = (l: string) => linhas.push(l);
  try {
    return { valor: await f(), linhas };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** Anota com o `anotar` dado e devolve as tarefas que foram ao runtime. */
function anotarColhendo(
  anotar: (c: Chamada) => Promise<unknown>,
  prazoMs?: number,
): Promise<unknown>[] {
  const tarefas: Promise<unknown>[] = [];
  anotarSemEsperar(CHAMADA, anotar, (t) => tarefas.push(t), prazoMs);
  return tarefas;
}

Deno.test('o user-agent do Grupo OLX é reconhecido, com versão ou maiúsculas', () => {
  assertEquals(USER_AGENT_DO_GRUPO_OLX, 'grupozap-notification-api');
  assertEquals(ehDoGrupoOlx('grupozap-notification-api'), true);
  assertEquals(ehDoGrupoOlx('GrupoZap-Notification-API/1.2'), true);
  assertEquals(ehDoGrupoOlx('Mozilla/5.0 grupozap-notification-api'), true);
  assertEquals(ehDoGrupoOlx(null), false);
  assertEquals(ehDoGrupoOlx(''), false);
  assertEquals(ehDoGrupoOlx('curl/8.7.1'), false);
  assertEquals(ehDoGrupoOlx('Mozilla/5.0 (compatible; VivaRealBot/2.0)'), false);
  // Só o começo do cabeçalho é lido.
  assertEquals(ehDoGrupoOlx(`${'x'.repeat(400)}grupozap-notification-api`), false);
});

Deno.test('a anotação recebe a chamada como veio, e a tarefa vai ao runtime', async () => {
  const anotadas: Chamada[] = [];
  const tarefas = anotarColhendo((c) => {
    anotadas.push(c);
    return Promise.resolve({ ok: true });
  });
  assertEquals(tarefas.length, 1);
  const { linhas } = await comLog(() => Promise.all(tarefas));
  assertEquals(anotadas, [CHAMADA]);
  assertEquals(linhas, []);
});

Deno.test('anotação que rejeita vira aviso; a tarefa não rejeita', async () => {
  const tarefas = anotarColhendo(() => Promise.reject(new Error('RPC devolveu 404')));
  const { linhas } = await comLog(() => Promise.all(tarefas));
  assertEquals(linhas.length, 1);
  const linha = JSON.parse(linhas[0]);
  assertEquals(
    [linha.nivel, linha.evento, linha.interno],
    ['aviso', 'chamada_nao_anotada', 'RPC devolveu 404'],
  );
});

Deno.test('anotação que lança na hora vira aviso; nada lança para quem chamou', async () => {
  const tarefas = anotarColhendo(() => {
    throw new Error('sem rede');
  });
  const { linhas } = await comLog(() => Promise.all(tarefas));
  assertEquals(JSON.parse(linhas[0]).evento, 'chamada_nao_anotada');
});

Deno.test('o banco que diz ok: false vira aviso com o motivo', async () => {
  const tarefas = anotarColhendo(() =>
    Promise.resolve({ ok: false, motivo: 'resultado_invalido' }),
  );
  const { linhas } = await comLog(() => Promise.all(tarefas));
  assertEquals(JSON.parse(linhas[0]).motivo, 'resultado_invalido');
});

Deno.test('anotação que não termina é abandonada no prazo', async () => {
  const inicio = Date.now();
  const tarefas = anotarColhendo(() => new Promise(() => {}), 20);
  const { linhas } = await comLog(() => Promise.all(tarefas));
  assertEquals(Date.now() - inicio < 1000, true);
  assertEquals(JSON.parse(linhas[0]).motivo, 'prazo');
});

Deno.test('adiar que lança vira aviso, e nada lança para quem chamou', async () => {
  const { linhas } = await comLog(() => {
    anotarSemEsperar(
      CHAMADA,
      () => Promise.resolve({ ok: true }),
      () => {
        throw new Error('waitUntil indisponível');
      },
      20,
    );
    // A tarefa segue sozinha; espera o prazo para não deixar relógio aberto.
    return new Promise((r) => setTimeout(r, 40));
  });
  assertEquals(JSON.parse(linhas[0]).evento, 'chamada_nao_adiada');
});

Deno.test('com o runtime do Supabase, a tarefa vai para EdgeRuntime.waitUntil', async () => {
  const entregues: Promise<unknown>[] = [];
  const g = globalThis as { EdgeRuntime?: unknown };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => entregues.push(p) };
  try {
    const tarefa = Promise.resolve('feito');
    adiarNoRuntime(tarefa);
    assertEquals(entregues.length, 1);
    assertEquals(await entregues[0], 'feito');
  } finally {
    delete g.EdgeRuntime;
  }
  // Sem o runtime (o Deno puro do contêiner local), não faz nada e não lança.
  adiarNoRuntime(Promise.resolve());
});

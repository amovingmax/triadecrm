// =============================================================================
// Testes da credencial do Grupo OLX. Rodam sem rede e sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     deno test grupozap-lead/
//
// O que estes testes protegem, em ordem de importância:
//   1. que credencial ausente, malformada, de outra chave ou de outro usuário
//      NUNCA passe;
//   2. que a senha seja o que vem depois do PRIMEIRO `:` (a chave pode ter `:`
//      dentro) e que, sem `:`, a credencial inteira valha como senha;
//   3. que a troca de chave funcione: a anterior continua valendo enquanto
//      estiver configurada, e só ela;
//   4. que cabeçalho enorme seja recusado antes de qualquer decodificação.
// =============================================================================

import { assertEquals } from 'jsr:@std/assert@1';
import { conferirCredencial, lerBasic, TAMANHO_MAXIMO_DO_CABECALHO } from './autenticacao.ts';

const CHAVE = '594F803B-chave-de-teste-nao-usada-em-lugar-nenhum';
const ANTERIOR = 'chave-anterior-de-teste';

function basic(credencial: string): string {
  const bytes = new TextEncoder().encode(credencial);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

async function motivo(opcoes: Parameters<typeof conferirCredencial>[0]): Promise<string> {
  const r = await conferirCredencial(opcoes);
  return r.ok ? `ok:${r.chave}` : r.motivo;
}

Deno.test('Basic certo, com o usuário da documentação, passa', async () => {
  assertEquals(await motivo({ cabecalho: basic(`vivareal:${CHAVE}`), segredo: CHAVE }), 'ok:atual');
});

Deno.test('senha errada não passa', async () => {
  assertEquals(
    await motivo({ cabecalho: basic('vivareal:outra-chave'), segredo: CHAVE }),
    'credencial_invalida',
  );
  // Prefixo certo e um caractere a mais (ou a menos) também não.
  assertEquals(
    await motivo({ cabecalho: basic(`vivareal:${CHAVE}x`), segredo: CHAVE }),
    'credencial_invalida',
  );
  assertEquals(
    await motivo({ cabecalho: basic(`vivareal:${CHAVE.slice(0, -1)}`), segredo: CHAVE }),
    'credencial_invalida',
  );
});

Deno.test('cabeçalho ausente ou vazio não passa', async () => {
  assertEquals(await motivo({ cabecalho: null, segredo: CHAVE }), 'cabecalho_ausente');
  assertEquals(await motivo({ cabecalho: '', segredo: CHAVE }), 'cabecalho_ausente');
});

Deno.test('esquema que não é Basic não passa', async () => {
  for (const ruim of [
    `Bearer ${CHAVE}`,
    'Basic',
    'Basic ',
    `Basic  ${btoa(`vivareal:${CHAVE}`)}`,
    `${btoa(`vivareal:${CHAVE}`)}`,
    `Basic ${btoa(`vivareal:${CHAVE}`)} extra`,
    'Basic dml2YXJlYWw6!!!',
  ]) {
    assertEquals(await motivo({ cabecalho: ruim, segredo: CHAVE }), 'esquema_invalido', ruim);
  }
});

Deno.test('base64 inválido não passa', async () => {
  // Comprimento com resto 1 e `=` no meio: `atob` recusa os dois.
  for (const ruim of ['Basic abcde', 'Basic ab=cd', 'Basic a']) {
    assertEquals(await motivo({ cabecalho: ruim, segredo: CHAVE }), 'base64_invalido', ruim);
  }
});

Deno.test('o esquema não diferencia maiúsculas, e o base64 sem `=` no fim vale', async () => {
  const cru = btoa(`vivareal:${CHAVE}`);
  assertEquals(await motivo({ cabecalho: `basic ${cru}`, segredo: CHAVE }), 'ok:atual');
  assertEquals(await motivo({ cabecalho: `BASIC ${cru}`, segredo: CHAVE }), 'ok:atual');
  const semIgual = btoa('vivareal:a?>~');
  assertEquals(semIgual.endsWith('=='), true);
  assertEquals(
    await motivo({ cabecalho: `Basic ${semIgual.replace(/=+$/, '')}`, segredo: 'a?>~' }),
    'ok:atual',
  );
});

Deno.test('o base64 de URL (com - e _) decodifica igual ao comum', async () => {
  const chave = 'chave>>>?';
  const comum = btoa(`vivareal:${chave}`);
  assertEquals(/[+/]/.test(comum), true);
  const deUrl = comum.replaceAll('+', '-').replaceAll('/', '_');
  assertEquals(await motivo({ cabecalho: `Basic ${comum}`, segredo: chave }), 'ok:atual');
  assertEquals(await motivo({ cabecalho: `Basic ${deUrl}`, segredo: chave }), 'ok:atual');
});

Deno.test('sem `:` a credencial inteira é a senha', async () => {
  assertEquals(await motivo({ cabecalho: basic(CHAVE), segredo: CHAVE }), 'ok:atual');
  const lida = lerBasic(basic(CHAVE));
  assertEquals(lida.ok && lida.usuario, null);
  assertEquals(lida.ok && lida.senha, CHAVE);
});

Deno.test('a senha é o que vem depois do PRIMEIRO `:`', async () => {
  const comDoisPontos = 'parte1:parte2';
  assertEquals(
    await motivo({ cabecalho: basic(`vivareal:${comDoisPontos}`), segredo: comDoisPontos }),
    'ok:atual',
  );
  // `vivareal:parte1` como usuário e `parte2` como senha seria o erro.
  assertEquals(
    await motivo({ cabecalho: basic(`vivareal:${comDoisPontos}`), segredo: 'parte2' }),
    'credencial_invalida',
  );
  // Usuário vazio é usuário vazio, não "sem usuário".
  const lida = lerBasic(basic(`:${CHAVE}`));
  assertEquals(lida.ok && lida.usuario, '');
  assertEquals(lida.ok && lida.senha, CHAVE);
});

Deno.test('credencial com acento é lida como UTF-8', async () => {
  const chave = 'chave-ção-ÿ';
  assertEquals(await motivo({ cabecalho: basic(`vivareal:${chave}`), segredo: chave }), 'ok:atual');
});

Deno.test('cabeçalho enorme é recusado antes de decodificar', async () => {
  const enorme = `Basic ${'A'.repeat(TAMANHO_MAXIMO_DO_CABECALHO)}`;
  assertEquals(await motivo({ cabecalho: enorme, segredo: CHAVE }), 'cabecalho_grande_demais');
  // No limite exato ainda é lido (e aqui só falha por não conferir).
  const noLimite = `Basic ${'A'.repeat(TAMANHO_MAXIMO_DO_CABECALHO - 'Basic '.length)}`;
  assertEquals(noLimite.length, TAMANHO_MAXIMO_DO_CABECALHO);
  assertEquals(await motivo({ cabecalho: noLimite, segredo: CHAVE }), 'credencial_invalida');
});

Deno.test('usuário exigido: certo passa, errado ou ausente não', async () => {
  const opcoes = { segredo: CHAVE, usuarioExigido: 'vivareal' };
  assertEquals(await motivo({ ...opcoes, cabecalho: basic(`vivareal:${CHAVE}`) }), 'ok:atual');
  assertEquals(
    await motivo({ ...opcoes, cabecalho: basic(`zap:${CHAVE}`) }),
    'credencial_invalida',
  );
  assertEquals(
    await motivo({ ...opcoes, cabecalho: basic(`VIVAREAL:${CHAVE}`) }),
    'credencial_invalida',
  );
  // Sem `:` não há usuário, e o exigido falta.
  assertEquals(await motivo({ ...opcoes, cabecalho: basic(CHAVE) }), 'credencial_invalida');
  // Usuário certo com senha errada também não.
  assertEquals(
    await motivo({ ...opcoes, cabecalho: basic('vivareal:errada') }),
    'credencial_invalida',
  );
});

Deno.test('sem usuário exigido, qualquer usuário serve', async () => {
  for (const usuario of ['vivareal', 'zap', '', 'qualquer coisa']) {
    assertEquals(
      await motivo({ cabecalho: basic(`${usuario}:${CHAVE}`), segredo: CHAVE, usuarioExigido: '' }),
      'ok:atual',
      usuario,
    );
  }
});

Deno.test('troca de chave: a anterior vale enquanto configurada', async () => {
  const opcoes = { segredo: CHAVE, segredoAnterior: ANTERIOR };
  assertEquals(await motivo({ ...opcoes, cabecalho: basic(`vivareal:${CHAVE}`) }), 'ok:atual');
  assertEquals(
    await motivo({ ...opcoes, cabecalho: basic(`vivareal:${ANTERIOR}`) }),
    'ok:anterior',
  );
  assertEquals(
    await motivo({ ...opcoes, cabecalho: basic('vivareal:nenhuma-das-duas') }),
    'credencial_invalida',
  );
  // Tirada a anterior, ela deixa de valer.
  assertEquals(
    await motivo({
      segredo: CHAVE,
      segredoAnterior: null,
      cabecalho: basic(`vivareal:${ANTERIOR}`),
    }),
    'credencial_invalida',
  );
});

Deno.test('segredo vazio nunca confere com senha vazia', async () => {
  assertEquals(await motivo({ cabecalho: basic('vivareal:'), segredo: '' }), 'sem_segredo');
  assertEquals(
    await motivo({ cabecalho: basic('vivareal:'), segredo: '', segredoAnterior: '' }),
    'sem_segredo',
  );
  // Com a atual configurada e a anterior vazia, senha vazia continua errada.
  assertEquals(
    await motivo({ cabecalho: basic('vivareal:'), segredo: CHAVE, segredoAnterior: '' }),
    'credencial_invalida',
  );
});

// -----------------------------------------------------------------------------
// A chave de teste da homologação (10/11/2026). O cabeçalho abaixo é o EXEMPLO
// PÚBLICO da página de segurança do Grupo OLX (developers.grupozap.com/webhooks/
// security.html), copiado letra por letra; decodificado, é
// `vivareal:594F803B380A41396ED63DCA39503542`. Não é segredo de ninguém.
// -----------------------------------------------------------------------------
const CABECALHO_DA_DOCUMENTACAO = 'Basic dml2YXJlYWw6NTk0RjgwM0IzODBBNDEzOTZFRDYzRENBMzk1MDM1NDI=';
const CHAVE_DA_DOCUMENTACAO = '594F803B380A41396ED63DCA39503542';
const PROVISORIA = 'chave-provisoria-de-teste';

Deno.test(
  'o 401 da homologação: o cabeçalho da documentação contra só a chave provisória',
  async () => {
    assertEquals(
      await motivo({ cabecalho: CABECALHO_DA_DOCUMENTACAO, segredo: PROVISORIA }),
      'credencial_invalida',
    );
  },
);

Deno.test(
  'o cabeçalho da documentação passa como teste quando a chave de teste está configurada',
  async () => {
    const r = await conferirCredencial({
      cabecalho: CABECALHO_DA_DOCUMENTACAO,
      segredo: PROVISORIA,
      segredoTeste: CHAVE_DA_DOCUMENTACAO,
    });
    assertEquals(r, { ok: true, chave: 'teste', formato: 'usuario_e_senha' });
    // A chave de verdade continua valendo ao lado dela, e é `atual`, não teste.
    assertEquals(
      await motivo({
        cabecalho: basic(`vivareal:${PROVISORIA}`),
        segredo: PROVISORIA,
        segredoTeste: CHAVE_DA_DOCUMENTACAO,
      }),
      'ok:atual',
    );
  },
);

Deno.test('com a chave de teste configurada, chave errada continua recebendo recusa', async () => {
  const opcoes = { segredo: PROVISORIA, segredoTeste: CHAVE_DA_DOCUMENTACAO };
  for (const ruim of [
    basic('vivareal:outra-chave'),
    basic(`vivareal:${CHAVE_DA_DOCUMENTACAO.toLowerCase()}`),
    basic(`vivareal:${CHAVE_DA_DOCUMENTACAO}x`),
    basic('vivareal:'),
  ]) {
    assertEquals(await motivo({ ...opcoes, cabecalho: ruim }), 'credencial_invalida', ruim);
  }
  assertEquals(await motivo({ ...opcoes, cabecalho: null }), 'cabecalho_ausente');
  assertEquals(
    await motivo({ ...opcoes, cabecalho: `Bearer ${CHAVE_DA_DOCUMENTACAO}` }),
    'esquema_invalido',
  );
});

Deno.test(
  'trocar pela SECRET_KEY definitiva é só trocar o segredo; tirada a de teste, ela deixa de valer',
  async () => {
    const DEFINITIVA = 'secret-key-definitiva-de-teste';
    assertEquals(
      await motivo({ cabecalho: basic(`vivareal:${DEFINITIVA}`), segredo: DEFINITIVA }),
      'ok:atual',
    );
    assertEquals(
      await motivo({
        cabecalho: CABECALHO_DA_DOCUMENTACAO,
        segredo: DEFINITIVA,
        segredoTeste: null,
      }),
      'credencial_invalida',
    );
    // A provisória pode ficar como anterior enquanto o Grupo OLX não troca.
    assertEquals(
      await motivo({
        cabecalho: basic(`vivareal:${PROVISORIA}`),
        segredo: DEFINITIVA,
        segredoAnterior: PROVISORIA,
      }),
      'ok:anterior',
    );
  },
);

Deno.test(
  'se a chave de teste coincidir com a atual, vale teste (na dúvida, não grava)',
  async () => {
    assertEquals(
      await motivo({
        cabecalho: CABECALHO_DA_DOCUMENTACAO,
        segredo: CHAVE_DA_DOCUMENTACAO,
        segredoTeste: CHAVE_DA_DOCUMENTACAO,
      }),
      'ok:teste',
    );
  },
);

Deno.test('chave de teste vazia não confere com senha vazia', async () => {
  assertEquals(
    await motivo({ cabecalho: basic('vivareal:'), segredo: '', segredoTeste: '' }),
    'sem_segredo',
  );
  assertEquals(
    await motivo({ cabecalho: basic('vivareal:'), segredo: PROVISORIA, segredoTeste: '' }),
    'credencial_invalida',
  );
});

Deno.test('a chave de teste obedece ao usuário exigido como as outras', async () => {
  const opcoes = { segredo: PROVISORIA, segredoTeste: CHAVE_DA_DOCUMENTACAO };
  assertEquals(
    await motivo({ ...opcoes, usuarioExigido: 'vivareal', cabecalho: CABECALHO_DA_DOCUMENTACAO }),
    'ok:teste',
  );
  assertEquals(
    await motivo({ ...opcoes, usuarioExigido: 'zap', cabecalho: CABECALHO_DA_DOCUMENTACAO }),
    'credencial_invalida',
  );
});

Deno.test('o formato diz só se havia usuário, nunca qual', async () => {
  const sem = await conferirCredencial({ cabecalho: basic(CHAVE), segredo: CHAVE });
  assertEquals(sem, { ok: true, chave: 'atual', formato: 'so_senha' });
  const com = await conferirCredencial({ cabecalho: basic(`zap:${CHAVE}`), segredo: CHAVE });
  assertEquals(com, { ok: true, chave: 'atual', formato: 'usuario_e_senha' });
});

// -----------------------------------------------------------------------------
// O que o validador oficial manda conforme o que se digita em "Token" (medido
// em 10/11/2026): ele põe `Basic ` na frente do texto digitado, sem codificar.
// -----------------------------------------------------------------------------
Deno.test('validador com a chave crua digitada (`Basic 594F…`) passa como teste', async () => {
  const r = await conferirCredencial({
    cabecalho: `Basic ${CHAVE_DA_DOCUMENTACAO}`,
    segredo: PROVISORIA,
    segredoTeste: CHAVE_DA_DOCUMENTACAO,
  });
  assertEquals(r, { ok: true, chave: 'teste', formato: 'chave_crua' });
});

Deno.test(
  'validador com o cabeçalho inteiro digitado (`Basic Basic dml2…`) passa como teste',
  async () => {
    const r = await conferirCredencial({
      cabecalho: `Basic ${CABECALHO_DA_DOCUMENTACAO}`,
      segredo: PROVISORIA,
      segredoTeste: CHAVE_DA_DOCUMENTACAO,
    });
    assertEquals(r, { ok: true, chave: 'teste', formato: 'usuario_e_senha' });
  },
);

Deno.test('a chave crua vale também para a chave de verdade, e só para ela', async () => {
  assertEquals(await motivo({ cabecalho: `Basic ${PROVISORIA}`, segredo: PROVISORIA }), 'ok:atual');
  for (const ruim of [
    `Basic ${PROVISORIA}x`,
    `Basic ${PROVISORIA.slice(0, -1)}`,
    `Basic ${CHAVE_DA_DOCUMENTACAO}`,
    `Basic ${PROVISORIA.toUpperCase()}`,
  ]) {
    // Recusa sempre; o motivo do log (credencial ou base64) depende só de o
    // texto decodificar ou não, e não importa aqui.
    const r = await conferirCredencial({ cabecalho: ruim, segredo: PROVISORIA });
    assertEquals(r.ok, false, ruim);
  }
});

Deno.test('a chave crua não tem usuário: com usuário exigido, não passa', async () => {
  assertEquals(
    await motivo({
      cabecalho: `Basic ${CHAVE_DA_DOCUMENTACAO}`,
      segredo: PROVISORIA,
      segredoTeste: CHAVE_DA_DOCUMENTACAO,
      usuarioExigido: 'vivareal',
    }),
    'credencial_invalida',
  );
});

Deno.test(
  'só UM `Basic ` repetido é tolerado, e a chave sem esquema continua recusada',
  async () => {
    const opcoes = { segredo: PROVISORIA, segredoTeste: CHAVE_DA_DOCUMENTACAO };
    for (const ruim of [
      `Basic Basic ${CABECALHO_DA_DOCUMENTACAO}`,
      `Basic  ${CHAVE_DA_DOCUMENTACAO}`,
      CHAVE_DA_DOCUMENTACAO,
      `Bearer ${CHAVE_DA_DOCUMENTACAO}`,
      `Basic vivareal:${CHAVE_DA_DOCUMENTACAO}`,
    ]) {
      assertEquals(await motivo({ ...opcoes, cabecalho: ruim }), 'esquema_invalido', ruim);
    }
  },
);

Deno.test('chave crua que não é base64 nem confere continua com o motivo de base64', async () => {
  // `abcde` não decodifica (resto 1) e não é a chave: o log diz base64_invalido.
  assertEquals(
    await motivo({
      cabecalho: 'Basic abcde',
      segredo: PROVISORIA,
      segredoTeste: CHAVE_DA_DOCUMENTACAO,
    }),
    'base64_invalido',
  );
});

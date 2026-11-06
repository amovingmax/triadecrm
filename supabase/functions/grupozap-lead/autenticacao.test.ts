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

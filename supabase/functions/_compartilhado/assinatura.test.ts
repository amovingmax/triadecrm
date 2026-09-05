// =============================================================================
// Testes do módulo de assinatura. Rodam sem rede e sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     test --allow-none _compartilhado/assinatura.test.ts
//
// O que estes testes protegem, em ordem de importância:
//   1. que assinatura ausente, malformada, de outro segredo ou de corpo
//      alterado NUNCA passem;
//   2. que carimbo velho (reenvio gravado) e carimbo no futuro (relógio
//      esticado) sejam recusados pelos dois lados da janela;
//   3. que a comparação não tenha atalho — nem por comprimento diferente.
// =============================================================================

import { assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@1';
import {
  assinar,
  baseCanonica,
  cabecalhosAssinados,
  iguaisEmTempoConstante,
  verificar,
} from './assinatura.ts';

const SEGREDO = 'segredo-de-teste-nao-usado-em-lugar-nenhum';
const CORPO = '{"event":"supplier.claimed","dados":{"a":1}}';

Deno.test('assinar devolve v1= com 64 hex', async () => {
  const a = await assinar(SEGREDO, baseCanonica(1757030000, CORPO));
  assertMatch(a, /^v1=[0-9a-f]{64}$/);
});

Deno.test('a assinatura muda quando o corpo muda em um byte', async () => {
  const a = await assinar(SEGREDO, baseCanonica(1757030000, CORPO));
  const b = await assinar(SEGREDO, baseCanonica(1757030000, CORPO + ' '));
  assertNotEquals(a, b);
});

Deno.test('a assinatura muda quando o carimbo muda', async () => {
  const a = await assinar(SEGREDO, baseCanonica(1757030000, CORPO));
  const b = await assinar(SEGREDO, baseCanonica(1757030001, CORPO));
  assertNotEquals(a, b);
});

Deno.test('assinatura válida dentro da janela é aceita', async () => {
  const agora = 1757030000;
  const assinatura = await assinar(SEGREDO, baseCanonica(agora, CORPO));
  const r = await verificar({
    segredo: SEGREDO,
    corpoCru: CORPO,
    assinaturaRecebida: assinatura,
    carimboRecebido: String(agora),
    agoraSegundos: agora + 10,
  });
  assertEquals(r.ok, true);
});

Deno.test('assinatura ausente é recusada', async () => {
  const r = await verificar({
    segredo: SEGREDO,
    corpoCru: CORPO,
    assinaturaRecebida: null,
    carimboRecebido: '1757030000',
    agoraSegundos: 1757030000,
  });
  assertEquals(r.ok, false);
  assertEquals(r.ok === false && r.codigo, 'assinatura_ausente');
});

Deno.test('carimbo ausente é recusado', async () => {
  const r = await verificar({
    segredo: SEGREDO,
    corpoCru: CORPO,
    assinaturaRecebida: `v1=${'0'.repeat(64)}`,
    carimboRecebido: null,
    agoraSegundos: 1757030000,
  });
  assertEquals(r.ok === false && r.codigo, 'carimbo_ausente');
});

Deno.test('assinatura malformada é recusada antes de qualquer HMAC', async () => {
  for (const ruim of [
    'abc',
    'v1=xyz',
    'v2=' + '0'.repeat(64),
    '0'.repeat(64),
    `v1=${'0'.repeat(63)}`,
  ]) {
    const r = await verificar({
      segredo: SEGREDO,
      corpoCru: CORPO,
      assinaturaRecebida: ruim,
      carimboRecebido: '1757030000',
      agoraSegundos: 1757030000,
    });
    assertEquals(r.ok === false && r.codigo, 'assinatura_malformada', `passou: ${ruim}`);
  }
});

Deno.test('carimbo velho (replay gravado) é recusado', async () => {
  const carimbo = 1757030000;
  const assinatura = await assinar(SEGREDO, baseCanonica(carimbo, CORPO));
  const r = await verificar({
    segredo: SEGREDO,
    corpoCru: CORPO,
    assinaturaRecebida: assinatura,
    carimboRecebido: String(carimbo),
    agoraSegundos: carimbo + 301,
  });
  assertEquals(r.ok === false && r.codigo, 'carimbo_fora_da_janela');
});

Deno.test('carimbo no futuro também é recusado (relógio esticado)', async () => {
  const carimbo = 1757030000;
  const assinatura = await assinar(SEGREDO, baseCanonica(carimbo, CORPO));
  const r = await verificar({
    segredo: SEGREDO,
    corpoCru: CORPO,
    assinaturaRecebida: assinatura,
    carimboRecebido: String(carimbo),
    agoraSegundos: carimbo - 301,
  });
  assertEquals(r.ok === false && r.codigo, 'carimbo_fora_da_janela');
});

Deno.test('carimbo que não é inteiro de segundos é recusado', async () => {
  for (const ruim of ['agora', '17570.30', '-1', '0', 'NaN']) {
    const r = await verificar({
      segredo: SEGREDO,
      corpoCru: CORPO,
      assinaturaRecebida: `v1=${'0'.repeat(64)}`,
      carimboRecebido: ruim,
      agoraSegundos: 1757030000,
    });
    assertEquals(r.ok === false && r.codigo, 'carimbo_invalido', `passou: ${ruim}`);
  }
});

Deno.test('assinatura de OUTRO segredo é recusada', async () => {
  const carimbo = 1757030000;
  const assinatura = await assinar('outro-segredo', baseCanonica(carimbo, CORPO));
  const r = await verificar({
    segredo: SEGREDO,
    corpoCru: CORPO,
    assinaturaRecebida: assinatura,
    carimboRecebido: String(carimbo),
    agoraSegundos: carimbo,
  });
  assertEquals(r.ok === false && r.codigo, 'assinatura_invalida');
});

Deno.test('corpo alterado depois de assinado é recusado', async () => {
  const carimbo = 1757030000;
  const assinatura = await assinar(SEGREDO, baseCanonica(carimbo, CORPO));
  const r = await verificar({
    segredo: SEGREDO,
    corpoCru: CORPO.replace('"a":1', '"a":2'),
    assinaturaRecebida: assinatura,
    carimboRecebido: String(carimbo),
    agoraSegundos: carimbo,
  });
  assertEquals(r.ok === false && r.codigo, 'assinatura_invalida');
});

Deno.test(
  'a assinatura cobre o carimbo: reusar assinatura com outro carimbo não passa',
  async () => {
    const carimbo = 1757030000;
    const assinatura = await assinar(SEGREDO, baseCanonica(carimbo, CORPO));
    const r = await verificar({
      segredo: SEGREDO,
      corpoCru: CORPO,
      assinaturaRecebida: assinatura,
      carimboRecebido: String(carimbo + 60),
      agoraSegundos: carimbo + 60,
    });
    assertEquals(r.ok === false && r.codigo, 'assinatura_invalida');
  },
);

Deno.test('comparação em tempo constante: igual, diferente e comprimentos diferentes', () => {
  assertEquals(iguaisEmTempoConstante('abc', 'abc'), true);
  assertEquals(iguaisEmTempoConstante('abc', 'abd'), false);
  assertEquals(iguaisEmTempoConstante('abc', 'abcd'), false);
  assertEquals(iguaisEmTempoConstante('', ''), true);
  assertEquals(iguaisEmTempoConstante('', 'a'), false);
});

Deno.test('cabeçalhos assinados trazem carimbo, assinatura e chave de idempotência', async () => {
  const c = await cabecalhosAssinados({
    segredo: SEGREDO,
    corpoCru: CORPO,
    chaveIdempotencia: 'abc:123',
    agoraSegundos: 1757030000,
  });
  assertEquals(c['X-Triade-Timestamp'], '1757030000');
  assertMatch(c['X-Triade-Signature'], /^v1=[0-9a-f]{64}$/);
  assertEquals(c['Idempotency-Key'], 'abc:123');
  assertEquals(c['Content-Type'], 'application/json');
});

Deno.test('o que este módulo assina é exatamente o que o outro lado confere', async () => {
  // Assina como `komune-push` e confere como `komune-webhook`: se as duas
  // pontas divergirem, este teste quebra antes de a integração quebrar.
  const carimbo = 1757030000;
  const cabecalhos = await cabecalhosAssinados({
    segredo: SEGREDO,
    corpoCru: CORPO,
    agoraSegundos: carimbo,
  });
  const r = await verificar({
    segredo: SEGREDO,
    corpoCru: CORPO,
    assinaturaRecebida: cabecalhos['X-Triade-Signature'],
    carimboRecebido: cabecalhos['X-Triade-Timestamp'],
    agoraSegundos: carimbo,
  });
  assertEquals(r.ok, true);
});

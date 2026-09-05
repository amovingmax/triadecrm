// =============================================================================
// Testes da assinatura da Meta. Rodam sem rede e sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     test --allow-none wa-webhook/assinatura-meta.test.ts
//
// O que estes testes protegem, em ordem de importância:
//   1. que assinatura ausente, malformada, de outro segredo ou de corpo
//      alterado NUNCA passem;
//   2. que o carimbo — que na Meta vem de DENTRO do corpo, porque ela não
//      manda cabeçalho de carimbo — seja exigido e conferido nos dois lados;
//   3. que a extração do carimbo pegue o instante MAIS NOVO do lote, e não o
//      primeiro que encontrar.
// =============================================================================

import { assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@1';
import {
  assinarComoMeta,
  carimboDoCorpo,
  FOLGA_FUTURO_SEGUNDOS,
  verificarDaMeta,
} from './assinatura-meta.ts';

const SEGREDO = 'app-secret-de-teste-nao-usado-em-lugar-nenhum';
const AGORA = 1_757_030_000;

function corpoDaMeta(carimbo: number, texto = 'oi'): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        time: carimbo,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5584999880011', phone_number_id: '1234' },
              messages: [
                {
                  from: '5584988776655',
                  id: 'wamid.TESTE1',
                  timestamp: String(carimbo),
                  type: 'text',
                  text: { body: texto },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

Deno.test('assina no formato da Meta: sha256= com 64 hex', async () => {
  const a = await assinarComoMeta(SEGREDO, corpoDaMeta(AGORA));
  assertMatch(a, /^sha256=[0-9a-f]{64}$/);
});

Deno.test('a assinatura muda quando o corpo muda em um byte', async () => {
  const a = await assinarComoMeta(SEGREDO, corpoDaMeta(AGORA, 'oi'));
  const b = await assinarComoMeta(SEGREDO, corpoDaMeta(AGORA, 'oi '));
  assertNotEquals(a, b);
});

Deno.test('assinatura válida com carimbo dentro da janela é aceita', async () => {
  const corpo = corpoDaMeta(AGORA);
  const r = await verificarDaMeta({
    segredo: SEGREDO,
    corpoCru: corpo,
    assinaturaRecebida: await assinarComoMeta(SEGREDO, corpo),
    agoraSegundos: AGORA + 10,
  });
  assertEquals(r.ok, true);
  assertEquals(r.ok === true && r.carimbo, AGORA);
});

Deno.test('assinatura ausente é recusada', async () => {
  const corpo = corpoDaMeta(AGORA);
  const r = await verificarDaMeta({
    segredo: SEGREDO,
    corpoCru: corpo,
    assinaturaRecebida: null,
    agoraSegundos: AGORA,
  });
  assertEquals(r.ok === false && r.codigo, 'assinatura_ausente');
});

Deno.test('assinatura malformada é recusada antes de qualquer HMAC', async () => {
  const corpo = corpoDaMeta(AGORA);
  for (const ruim of [
    'abc',
    'sha256=xyz',
    'sha1=' + '0'.repeat(64),
    '0'.repeat(64),
    `sha256=${'0'.repeat(63)}`,
    `v1=${'0'.repeat(64)}`,
    `sha256=${'A'.repeat(64)}`, // hex maiúsculo: a Meta manda minúsculo
  ]) {
    const r = await verificarDaMeta({
      segredo: SEGREDO,
      corpoCru: corpo,
      assinaturaRecebida: ruim,
      agoraSegundos: AGORA,
    });
    assertEquals(r.ok === false && r.codigo, 'assinatura_malformada', `passou: ${ruim}`);
  }
});

Deno.test('assinatura de OUTRO segredo é recusada', async () => {
  const corpo = corpoDaMeta(AGORA);
  const r = await verificarDaMeta({
    segredo: SEGREDO,
    corpoCru: corpo,
    assinaturaRecebida: await assinarComoMeta('outro-app-secret', corpo),
    agoraSegundos: AGORA,
  });
  assertEquals(r.ok === false && r.codigo, 'assinatura_invalida');
});

Deno.test('corpo alterado depois de assinado é recusado', async () => {
  const corpo = corpoDaMeta(AGORA, 'oi');
  const assinatura = await assinarComoMeta(SEGREDO, corpo);
  const r = await verificarDaMeta({
    segredo: SEGREDO,
    corpoCru: corpo.replace('"oi"', '"parar"'),
    assinaturaRecebida: assinatura,
    agoraSegundos: AGORA,
  });
  assertEquals(r.ok === false && r.codigo, 'assinatura_invalida');
});

Deno.test('carimbo velho (reenvio gravado) é recusado', async () => {
  const corpo = corpoDaMeta(AGORA);
  const r = await verificarDaMeta({
    segredo: SEGREDO,
    corpoCru: corpo,
    assinaturaRecebida: await assinarComoMeta(SEGREDO, corpo),
    janelaSegundos: 3600,
    agoraSegundos: AGORA + 3601,
  });
  assertEquals(r.ok === false && r.codigo, 'carimbo_fora_da_janela');
});

Deno.test('carimbo no futuro além da folga também é recusado', async () => {
  const corpo = corpoDaMeta(AGORA);
  const r = await verificarDaMeta({
    segredo: SEGREDO,
    corpoCru: corpo,
    assinaturaRecebida: await assinarComoMeta(SEGREDO, corpo),
    agoraSegundos: AGORA - FOLGA_FUTURO_SEGUNDOS - 1,
  });
  assertEquals(r.ok === false && r.codigo, 'carimbo_fora_da_janela');
});

Deno.test('corpo assinado sem carimbo nenhum é recusado', async () => {
  const corpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1' }] });
  const r = await verificarDaMeta({
    segredo: SEGREDO,
    corpoCru: corpo,
    assinaturaRecebida: await assinarComoMeta(SEGREDO, corpo),
    agoraSegundos: AGORA,
  });
  assertEquals(r.ok === false && r.codigo, 'carimbo_ausente');
});

Deno.test('a assinatura é conferida ANTES do carimbo', async () => {
  // Corpo sem carimbo e com assinatura errada: a recusa tem de ser a da
  // assinatura. Se fosse a do carimbo, quem sonda a porta saberia que o
  // segredo dele passou.
  const corpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1' }] });
  const r = await verificarDaMeta({
    segredo: SEGREDO,
    corpoCru: corpo,
    assinaturaRecebida: `sha256=${'0'.repeat(64)}`,
    agoraSegundos: AGORA,
  });
  assertEquals(r.ok === false && r.codigo, 'assinatura_invalida');
});

Deno.test('o carimbo do corpo é o instante MAIS NOVO do lote', () => {
  const payload = {
    entry: [
      {
        time: 1000,
        changes: [
          {
            value: {
              messages: [{ timestamp: '2000' }],
              statuses: [{ timestamp: '5000' }, { timestamp: '3000' }],
            },
          },
        ],
      },
    ],
  };
  assertEquals(carimboDoCorpo(payload), 5000);
});

Deno.test('carimbo em milissegundos é reconhecido como tal', () => {
  assertEquals(carimboDoCorpo({ entry: [{ time: 1_757_030_000_000 }] }), 1_757_030_000);
});

Deno.test('carimbo inválido não vira carimbo', () => {
  for (const ruim of ['agora', '', '-1', '0', 1.5, null, {}]) {
    assertEquals(carimboDoCorpo({ entry: [{ time: ruim }] }), null, `passou: ${String(ruim)}`);
  }
});

Deno.test('corpo que não é objeto não tem carimbo', () => {
  assertEquals(carimboDoCorpo('oi'), null);
  assertEquals(carimboDoCorpo(null), null);
  assertEquals(carimboDoCorpo([1, 2]), null);
});

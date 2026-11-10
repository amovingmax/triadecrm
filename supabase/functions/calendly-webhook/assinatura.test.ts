// =============================================================================
// Testes da assinatura do Calendly. Rodam sem rede e sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     deno test calendly-webhook/
//
// Protegem: que a base seja `t.corpo cru` (o esquema do Calendly, não o do
// Tríade); que corpo mexido, chave errada e carimbo fora da janela sejam
// recusados; que a chave anterior valha durante a troca; e que cabeçalho torto
// não passe.
// =============================================================================

import { assertEquals } from 'jsr:@std/assert@1';
import { assinaturaEsperada, conferirAssinatura, lerCabecalho } from './assinatura.ts';

const CHAVE = 'chave-de-teste-do-calendly-0123456789abcdef';
const CORPO = '{"event":"invitee.created","payload":{"uri":"https://api.calendly.com/x"}}';
const AGORA = 1_794_488_400;

async function cabecalho(chave: string, carimbo: number, corpo = CORPO): Promise<string> {
  return `t=${carimbo},v1=${await assinaturaEsperada(chave, carimbo, corpo)}`;
}

Deno.test('a base é o carimbo, um ponto e o corpo cru (HMAC-SHA256 em hex)', async () => {
  // Calculado à parte, fora deste código:
  //   printf '1492774577.{"event":"invitee.created"}' | openssl dgst -sha256 -hmac 'segredo'
  assertEquals(
    await assinaturaEsperada('segredo', 1492774577, '{"event":"invitee.created"}'),
    '419754f02b323aa5aeb53a7cc5a796c3e2d483cdbf1fd8342137c5b948a13b77',
  );
});

Deno.test('assinatura certa, dentro da janela: aceita com a chave atual', async () => {
  const r = await conferirAssinatura({
    cabecalho: await cabecalho(CHAVE, AGORA - 30),
    corpoCru: CORPO,
    chave: CHAVE,
    agoraSegundos: AGORA,
  });
  assertEquals(r, { ok: true, carimbo: AGORA - 30, chave: 'atual' });
});

Deno.test('um caractere a mais no corpo: recusa', async () => {
  const r = await conferirAssinatura({
    cabecalho: await cabecalho(CHAVE, AGORA),
    corpoCru: CORPO + ' ',
    chave: CHAVE,
    agoraSegundos: AGORA,
  });
  assertEquals(r, { ok: false, motivo: 'assinatura_invalida' });
});

Deno.test('o JSON reserializado não confere: a base é o texto cru', async () => {
  const reserializado = JSON.stringify(JSON.parse('{ "a": 1,  "b": 2 }'));
  const r = await conferirAssinatura({
    cabecalho: await cabecalho(CHAVE, AGORA, '{ "a": 1,  "b": 2 }'),
    corpoCru: reserializado,
    chave: CHAVE,
    agoraSegundos: AGORA,
  });
  assertEquals(r.ok, false);
});

Deno.test('chave errada: recusa', async () => {
  const r = await conferirAssinatura({
    cabecalho: await cabecalho('outra-chave', AGORA),
    corpoCru: CORPO,
    chave: CHAVE,
    agoraSegundos: AGORA,
  });
  assertEquals(r, { ok: false, motivo: 'assinatura_invalida' });
});

Deno.test('carimbo velho ou adiantado além de 5 minutos: recusa', async () => {
  for (const carimbo of [AGORA - 301, AGORA + 301]) {
    const r = await conferirAssinatura({
      cabecalho: await cabecalho(CHAVE, carimbo),
      corpoCru: CORPO,
      chave: CHAVE,
      agoraSegundos: AGORA,
    });
    assertEquals(r, { ok: false, motivo: 'carimbo_fora_da_janela' });
  }
});

Deno.test('durante a troca, a chave anterior ainda vale e é dita', async () => {
  const r = await conferirAssinatura({
    cabecalho: await cabecalho('chave-velha', AGORA),
    corpoCru: CORPO,
    chave: CHAVE,
    chaveAnterior: 'chave-velha',
    agoraSegundos: AGORA,
  });
  assertEquals(r, { ok: true, carimbo: AGORA, chave: 'anterior' });
});

Deno.test('várias v1 no cabeçalho: basta uma bater', async () => {
  const certa = await assinaturaEsperada(CHAVE, AGORA, CORPO);
  const r = await conferirAssinatura({
    cabecalho: `t=${AGORA},v1=${'0'.repeat(64)},v1=${certa}`,
    corpoCru: CORPO,
    chave: CHAVE,
    agoraSegundos: AGORA,
  });
  assertEquals(r.ok, true);
});

Deno.test('cabeçalho ausente ou torto', async () => {
  assertEquals(await conferirAssinatura({ cabecalho: null, corpoCru: CORPO, chave: CHAVE }), {
    ok: false,
    motivo: 'sem_cabecalho',
  });
  for (const torto of [
    'v1=abc',
    `t=${AGORA}`,
    `t=agora,v1=${'a'.repeat(64)}`,
    `t=${AGORA},v1=xyz`,
    'lixo',
  ]) {
    assertEquals(
      await conferirAssinatura({
        cabecalho: torto,
        corpoCru: CORPO,
        chave: CHAVE,
        agoraSegundos: AGORA,
      }),
      { ok: false, motivo: 'cabecalho_malformado' },
      torto,
    );
  }
});

Deno.test('lerCabecalho ignora partes desconhecidas e espaços', () => {
  assertEquals(lerCabecalho(` t=10 , v1=${'A'.repeat(64)} , v2=zzz`), {
    carimbo: 10,
    assinaturas: ['a'.repeat(64)],
  });
});

// Sem rede, sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     test --allow-none _compartilhado/apns.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';

import { corpoDoAviso, derDaChave, enviarAvisoDeChamada, jwtDaApple, jwtEmUso, esquecerJwt, topicoDeVoz } from './apns.ts';

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function deBase64url(t: string): Uint8Array {
  const b = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** Um par de chaves de teste, com a privada no mesmo formato do .p8 da Apple. */
async function chaveDeTeste(): Promise<{ pem: string; publica: CryptoKey }> {
  const par = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey));
  const linhas = b64(der).match(/.{1,64}/g)!.join('\n');
  return { pem: `-----BEGIN PRIVATE KEY-----\n${linhas}\n-----END PRIVATE KEY-----\n`, publica: par.publicKey };
}

Deno.test('o tópico do aviso de voz é o id do app com .voip', () => {
  assertEquals(topicoDeVoz('app.triade.ios'), 'app.triade.ios.voip');
});

Deno.test('a chave lida do PEM e do PEM em base64 numa linha dá o mesmo', async () => {
  const { pem } = await chaveDeTeste();
  assertEquals(derDaChave(btoa(pem)), derDaChave(pem));
});

Deno.test('o JWT da Apple é ES256, com kid e iss, e a assinatura confere', async () => {
  const { pem, publica } = await chaveDeTeste();
  const jwt = await jwtDaApple({ p8: pem, chaveId: 'ABC123DEFG', equipeId: 'EQUIPE1234' }, 1_800_000_000);
  const [c, b, s] = jwt.split('.');
  assertEquals(JSON.parse(new TextDecoder().decode(deBase64url(c!))), { alg: 'ES256', kid: 'ABC123DEFG' });
  assertEquals(JSON.parse(new TextDecoder().decode(deBase64url(b!))), { iss: 'EQUIPE1234', iat: 1_800_000_000 });
  const assinatura = deBase64url(s!);
  assertEquals(assinatura.length, 64);
  assert(
    await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publica,
      assinatura,
      new TextEncoder().encode(`${c}.${b}`),
    ),
  );
});

Deno.test('o JWT é reaproveitado por 40 minutos e refeito depois', async () => {
  esquecerJwt();
  const { pem } = await chaveDeTeste();
  const chave = { p8: pem, chaveId: 'ABC123DEFG', equipeId: 'EQUIPE1234' };
  const a = await jwtEmUso(chave, 1_000);
  assertEquals(await jwtEmUso(chave, 1_000 + 39 * 60), a);
  assert((await jwtEmUso(chave, 1_000 + 41 * 60)) !== a);
});

Deno.test('o aviso "tocar" leva nome, convite e a função; nunca telefone', () => {
  const corpo = corpoDoAviso({
    evento: 'tocar',
    chamada: '11111111-1111-4111-8111-111111111111',
    quem: 'Maria Cliente',
    empresa: 'imova',
    empresaNome: 'Imova Imobiliária',
    caminho: '/conversas?cliente=x',
    convite: 'convite-de-teste',
    funcao: 'https://exemplo.supabase.co/functions/v1/wa-chamada-app',
  });
  assertEquals(corpo, {
    triade: {
      v: 1,
      evento: 'tocar',
      chamada: '11111111-1111-4111-8111-111111111111',
      quem: 'Maria Cliente',
      empresa: 'imova',
      empresa_nome: 'Imova Imobiliária',
      caminho: '/conversas?cliente=x',
      convite: 'convite-de-teste',
      funcao: 'https://exemplo.supabase.co/functions/v1/wa-chamada-app',
    },
  });
  assert(new TextEncoder().encode(JSON.stringify(corpo)).length < 5120, 'a Apple aceita até 5 KB no aviso de voz');
});

Deno.test('o aviso "parar" leva só a ligação e o motivo', () => {
  assertEquals(corpoDoAviso({ evento: 'parar', chamada: 'x', motivo: 'atendida' }), {
    triade: { v: 1, evento: 'parar', chamada: 'x', motivo: 'atendida' },
  });
});

Deno.test('o pedido à Apple vai com os cabeçalhos do aviso de voz, e a recusa traz o motivo', async () => {
  let visto: { url: string; cabecalhos: Headers; corpo: string } | null = null;
  const servidor = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    visto = { url: req.url, cabecalhos: req.headers, corpo: await req.text() };
    return new Response(JSON.stringify({ reason: 'BadDeviceToken' }), { status: 400 });
  });
  try {
    const r = await enviarAvisoDeChamada({
      token: 'ab'.repeat(32),
      sandbox: false,
      topico: 'app.triade.ios.voip',
      jwt: 'j.w.t',
      aviso: { evento: 'parar', chamada: 'x', motivo: null },
      agoraSeg: 1_000,
      servidor: `http://localhost:${servidor.addr.port}`,
    });
    assertEquals(r, { status: 400, motivo: 'BadDeviceToken' });
    const v = visto!;
    assert(v.url.endsWith(`/3/device/${'ab'.repeat(32)}`));
    assertEquals(v.cabecalhos.get('apns-push-type'), 'voip');
    assertEquals(v.cabecalhos.get('apns-topic'), 'app.triade.ios.voip');
    assertEquals(v.cabecalhos.get('apns-priority'), '10');
    assertEquals(v.cabecalhos.get('apns-expiration'), '1120');
    assertEquals(v.cabecalhos.get('authorization'), 'bearer j.w.t');
  } finally {
    await servidor.shutdown();
  }
});

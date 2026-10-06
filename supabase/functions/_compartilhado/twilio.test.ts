// =============================================================================
// Testes do que as funções de voz sabem do Twilio. Rodam sem rede e sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     test _compartilhado/twilio.test.ts
//
// O que protegem:
//   1. que a assinatura bata com o exemplo PUBLICADO pelo Twilio — se a nossa
//      conta divergir da deles, todo webhook de verdade seria recusado;
//   2. que assinatura ausente, de outro segredo, de outra URL ou de parâmetro
//      alterado NUNCA passe;
//   3. que a credencial do softphone só conceda SAÍDA, com a identidade pedida;
//   4. que número e URL entrem no TwiML como texto, nunca como marcação.
// =============================================================================

import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import {
  assinarComoTwilio,
  baseDoTwilio,
  credencialDeVoz,
  parametrosDoFormulario,
  twimlDesligar,
  twimlDiscar,
  verificarDoTwilio,
} from './twilio.ts';

// O exemplo da documentação do Twilio ("Validating Requests are coming from Twilio").
const TOKEN_DO_EXEMPLO = '12345';
const URL_DO_EXEMPLO = 'https://mycompany.com/myapp.php?foo=1&bar=2';
const PARAMETROS_DO_EXEMPLO = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+12349013030',
  Digits: '1234',
  From: '+12349013030',
  To: '+18005551212',
};
const ASSINATURA_DO_EXEMPLO = '0/KCTR6DLpKmkAf8muzZqo1nDgQ=';

Deno.test('a base canônica é a URL seguida de nome+valor em ordem de nome', () => {
  assertEquals(
    baseDoTwilio(URL_DO_EXEMPLO, PARAMETROS_DO_EXEMPLO),
    'https://mycompany.com/myapp.php?foo=1&bar=2CallSidCA1234567890ABCDECaller+12349013030Digits1234From+12349013030To+18005551212',
  );
});

Deno.test('a assinatura confere com o exemplo publicado pelo Twilio', async () => {
  assertEquals(
    await assinarComoTwilio(TOKEN_DO_EXEMPLO, URL_DO_EXEMPLO, PARAMETROS_DO_EXEMPLO),
    ASSINATURA_DO_EXEMPLO,
  );
});

Deno.test('assinatura certa passa', async () => {
  const r = await verificarDoTwilio({
    authToken: TOKEN_DO_EXEMPLO,
    url: URL_DO_EXEMPLO,
    parametros: PARAMETROS_DO_EXEMPLO,
    assinaturaRecebida: ASSINATURA_DO_EXEMPLO,
  });
  assertEquals(r, { ok: true });
});

Deno.test('assinatura ausente é recusada', async () => {
  const r = await verificarDoTwilio({
    authToken: TOKEN_DO_EXEMPLO,
    url: URL_DO_EXEMPLO,
    parametros: PARAMETROS_DO_EXEMPLO,
    assinaturaRecebida: null,
  });
  assertEquals(r, { ok: false, codigo: 'assinatura_ausente' });
});

Deno.test('outro segredo, outra URL ou parâmetro alterado não passam', async () => {
  const casos = [
    { authToken: 'outro', url: URL_DO_EXEMPLO, parametros: PARAMETROS_DO_EXEMPLO },
    {
      authToken: TOKEN_DO_EXEMPLO,
      url: URL_DO_EXEMPLO + '&x=1',
      parametros: PARAMETROS_DO_EXEMPLO,
    },
    {
      authToken: TOKEN_DO_EXEMPLO,
      url: URL_DO_EXEMPLO,
      parametros: { ...PARAMETROS_DO_EXEMPLO, To: '+5584999990000' },
    },
    {
      authToken: TOKEN_DO_EXEMPLO,
      url: URL_DO_EXEMPLO,
      parametros: { ...PARAMETROS_DO_EXEMPLO, ligacao: 'injetado' },
    },
  ];
  for (const caso of casos) {
    const r = await verificarDoTwilio({ ...caso, assinaturaRecebida: ASSINATURA_DO_EXEMPLO });
    assertEquals(r, { ok: false, codigo: 'assinatura_invalida' });
  }
});

Deno.test('o formulário vira objeto, com + e %xx decodificados', () => {
  assertEquals(parametrosDoFormulario('From=client%3Acrm_1&CallStatus=in-progress&a=b+c'), {
    From: 'client:crm_1',
    CallStatus: 'in-progress',
    a: 'b c',
  });
});

function ler(parte: string): Record<string, unknown> {
  const b64 = parte.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
}

Deno.test('a credencial concede só saída, para a identidade pedida, por uma hora', async () => {
  const token = await credencialDeVoz({
    accountSid: 'ACteste',
    apiKeySid: 'SKteste',
    apiKeySecret: 'segredo-de-teste',
    twimlAppSid: 'APteste',
    identidade: 'crm_abc',
    agoraSeg: 1_790_000_000,
  });
  const [cabecalho, corpo, assinatura] = token.split('.');
  assertEquals(ler(cabecalho), { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' });
  const c = ler(corpo) as {
    iss: string;
    sub: string;
    exp: number;
    grants: { identity: string; voice: Record<string, unknown> };
  };
  assertEquals(c.iss, 'SKteste');
  assertEquals(c.sub, 'ACteste');
  assertEquals(c.exp, 1_790_000_000 + 3600);
  assertEquals(c.grants.identity, 'crm_abc');
  assertEquals(c.grants.voice, { outgoing: { application_sid: 'APteste' } });
  assert(!('incoming' in c.grants.voice), 'sem concessão de entrada');
  assert(assinatura.length > 20);
  assert(!token.includes('segredo-de-teste'), 'o segredo não viaja na credencial');
});

Deno.test('credenciais de segredos diferentes têm assinaturas diferentes', async () => {
  const base = {
    accountSid: 'ACteste',
    apiKeySid: 'SKteste',
    twimlAppSid: 'APteste',
    identidade: 'crm_abc',
    agoraSeg: 1_790_000_000,
  };
  const a = await credencialDeVoz({ ...base, apiKeySecret: 'um' });
  const b = await credencialDeVoz({ ...base, apiKeySecret: 'dois' });
  assertNotEquals(a.split('.')[2], b.split('.')[2]);
});

Deno.test('o TwiML disca o número, com aviso de estado, sem gravação', () => {
  const t = twimlDiscar({
    para: '+5584999990000',
    de: '+558430000000',
    urlDeEstado: 'https://x.supabase.co/functions/v1/voz-status?ligacao=abc&v=1',
  });
  assert(t.includes('<Number'));
  assert(t.includes('>+5584999990000</Number>'));
  assert(t.includes('callerId="+558430000000"'));
  assert(
    t.includes(
      'statusCallback="https://x.supabase.co/functions/v1/voz-status?ligacao=abc&amp;v=1"',
    ),
  );
  assert(t.includes('statusCallbackEvent="initiated ringing answered completed"'));
  assert(!/record/i.test(t), 'nada de gravação');
});

Deno.test('texto com marcação entra escapado no TwiML', () => {
  const t = twimlDiscar({ para: '</Number><Sip>x', de: '"+55', urlDeEstado: 'https://a/b' });
  assert(!t.includes('<Sip>'));
  assert(t.includes('&lt;/Number&gt;&lt;Sip&gt;x'));
  assert(t.includes('callerId="&quot;+55"'));
});

Deno.test('recusar é desligar, sem discar para ninguém', () => {
  assertEquals(
    twimlDesligar(),
    '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
  );
});

// Sem rede, sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     test --allow-none wa-chamada/meta.test.ts
import { assertEquals } from 'jsr:@std/assert@1';

import { corpoDaMeta, fraseDoErro, idDaChamada, lerErroDaMeta } from './meta.ts';

Deno.test('atender leva a resposta SDP e, no aceite, o id nosso', () => {
  assertEquals(corpoDaMeta({ acao: 'pre_accept', callId: 'wacid.1', sdp: 'v=0' }), {
    messaging_product: 'whatsapp',
    call_id: 'wacid.1',
    action: 'pre_accept',
    session: { sdp_type: 'answer', sdp: 'v=0' },
  });
  assertEquals(
    corpoDaMeta({ acao: 'accept', callId: 'wacid.1', sdp: 'v=0', opaco: 'abc' }).biz_opaque_callback_data,
    'abc',
  );
});

Deno.test('ligar leva o número sem o mais, a oferta e o id nosso', () => {
  assertEquals(corpoDaMeta({ acao: 'connect', para: '+5584999990000', sdp: 'v=0', opaco: 'abc' }), {
    messaging_product: 'whatsapp',
    to: '5584999990000',
    action: 'connect',
    session: { sdp_type: 'offer', sdp: 'v=0' },
    biz_opaque_callback_data: 'abc',
  });
});

Deno.test('desligar não leva SDP', () => {
  assertEquals(corpoDaMeta({ acao: 'terminate', callId: 'wacid.1' }), {
    messaging_product: 'whatsapp',
    call_id: 'wacid.1',
    action: 'terminate',
  });
});

Deno.test('o erro da Meta vira frase, e o desconhecido não fica sem resposta', () => {
  assertEquals(lerErroDaMeta({ error: { code: 138006, message: 'x' } }), { codigo: 138006, mensagem: 'x' });
  assertEquals(lerErroDaMeta('não é json'), { codigo: null, mensagem: null });
  assertEquals(fraseDoErro(138006).includes('permissão'), true);
  assertEquals(fraseDoErro(999).length > 0, true);
  assertEquals(fraseDoErro(null).length > 0, true);
});

Deno.test('o id da chamada sai da resposta de connect', () => {
  assertEquals(idDaChamada({ calls: [{ id: 'wacid.9' }] }), 'wacid.9');
  assertEquals(idDaChamada({ calls: [] }), null);
  assertEquals(idDaChamada(null), null);
});

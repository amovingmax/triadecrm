// =============================================================================
// Testes do adaptador do formato da Meta. Sem rede, sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     test --allow-none wa-webhook/extrair.test.ts
//
// O que estes testes protegem:
//   1. que mensagem, eco e recibo saiam com a CHAVE DE IDEMPOTÊNCIA certa —
//      é ela que faz a reentrega da Meta não virar mensagem duplicada, e é
//      ela que faz `sent`, `delivered` e `read` do mesmo wamid serem três
//      fatos e não um;
//   2. que a legenda de mídia entre como corpo — a regra de opt-out precisa
//      ler "parar" venha ele em texto ou em legenda de foto;
//   3. que campo desconhecido da Meta seja NOMEADO como ignorado, nunca
//      sumido em silêncio.
// =============================================================================

import { assertEquals } from 'jsr:@std/assert@1';
import { extrairDaMeta, type ItemDaMeta } from './extrair.ts';

const METADADOS = { display_phone_number: '5584999880011', phone_number_id: '1234' };

function envelope(valor: Record<string, unknown>, campo = 'messages'): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'e1', time: 1757030000, changes: [{ field: campo, value: valor }] }],
  };
}

function so<T extends ItemDaMeta['tipo']>(
  itens: ItemDaMeta[],
  tipo: T,
): Extract<ItemDaMeta, { tipo: T }>[] {
  return itens.filter((i): i is Extract<ItemDaMeta, { tipo: T }> => i.tipo === tipo);
}

Deno.test('mensagem de texto vira item com chave = wamid', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      messages: [
        {
          from: '5584988776655',
          id: 'wamid.ABC',
          timestamp: '1757030000',
          type: 'text',
          text: { body: 'Oi, tudo bem?' },
        },
      ],
    }),
  );
  assertEquals(itens.length, 1);
  const m = so(itens, 'mensagem')[0];
  assertEquals(m.chave, 'wamid.ABC');
  assertEquals(m.wamid, 'wamid.ABC');
  assertEquals(m.de, '+5584988776655');
  assertEquals(m.numero_da_empresa, '+5584999880011');
  assertEquals(m.tipo_da_mensagem, 'text');
  assertEquals(m.texto, 'Oi, tudo bem?');
  assertEquals(m.ocorrido_em, new Date(1757030000 * 1000).toISOString());
});

Deno.test('áudio traz media_id e mime, e a legenda vira corpo', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      messages: [
        {
          from: '5584988776655',
          id: 'wamid.AUDIO',
          timestamp: '1757030001',
          type: 'audio',
          audio: { id: '9988', mime_type: 'audio/ogg; codecs=opus', voice: true },
        },
        {
          from: '5584988776655',
          id: 'wamid.FOTO',
          timestamp: '1757030002',
          type: 'image',
          image: { id: '7766', mime_type: 'image/jpeg', caption: 'pode parar de mandar' },
        },
      ],
    }),
  );
  const [audio, foto] = so(itens, 'mensagem');
  assertEquals(audio.tipo_da_mensagem, 'audio');
  assertEquals(audio.media_id, '9988');
  assertEquals(audio.media_mime, 'audio/ogg; codecs=opus');
  assertEquals(audio.texto, null);
  // A legenda é o que a pessoa escreveu: precisa chegar ao worker.
  assertEquals(foto.texto, 'pode parar de mandar');
  assertEquals(foto.media_id, '7766');
});

Deno.test('botão e lista interativa também viram corpo', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      messages: [
        {
          from: '5584988776655',
          id: 'wamid.BOTAO',
          timestamp: '1757030003',
          type: 'button',
          button: { text: 'Parar de receber', payload: 'STOP' },
        },
        {
          from: '5584988776655',
          id: 'wamid.LISTA',
          timestamp: '1757030004',
          type: 'interactive',
          interactive: { type: 'list_reply', list_reply: { id: 'x', title: 'Quero saber mais' } },
        },
      ],
    }),
  );
  assertEquals(so(itens, 'mensagem')[0].texto, 'Parar de receber');
  assertEquals(so(itens, 'mensagem')[1].texto, 'Quero saber mais');
});

Deno.test('recibo: a chave inclui o estado, porque sent/delivered/read são três fatos', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      statuses: [
        { id: 'wamid.X', status: 'sent', timestamp: '1757030000', recipient_id: '5584988776655' },
        { id: 'wamid.X', status: 'delivered', timestamp: '1757030005' },
        { id: 'wamid.X', status: 'read', timestamp: '1757030030' },
      ],
    }),
  );
  const chaves = so(itens, 'recibo').map((r) => r.chave);
  assertEquals(chaves, ['status:wamid.X:sent', 'status:wamid.X:delivered', 'status:wamid.X:read']);
});

Deno.test('recibo de falha carrega código e detalhe do erro da Meta', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      statuses: [
        {
          id: 'wamid.Y',
          status: 'failed',
          timestamp: '1757030000',
          errors: [
            {
              code: 131049,
              title: 'Message not sent due to marketing limits',
              error_data: { details: 'limite por usuário' },
            },
          ],
        },
      ],
    }),
  );
  const r = so(itens, 'recibo')[0];
  assertEquals(r.estado, 'failed');
  assertEquals(r.codigo, '131049');
  assertEquals(r.detalhe, 'Message not sent due to marketing limits');
});

Deno.test('eco do Coexistence: `to` é o fornecedor, `from` é o nosso número', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      message_echoes: [
        {
          from: '5584999880011',
          to: '5584988776655',
          id: 'wamid.ECO',
          timestamp: '1757030010',
          type: 'text',
          text: { body: 'Oi, Marcos, aqui é a Heloísa' },
        },
      ],
    }),
  );
  const e = so(itens, 'eco')[0];
  assertEquals(e.chave, 'wamid.ECO');
  assertEquals(e.para, '+5584988776655');
  assertEquals(e.numero_da_empresa, '+5584999880011');
  assertEquals(e.texto, 'Oi, Marcos, aqui é a Heloísa');
});

Deno.test('campo que este adaptador não trata é NOMEADO como ignorado', () => {
  const { itens, ignorados } = extrairDaMeta(
    envelope(
      { display_phone_number: '5584999880011', event: 'FLAGGED' },
      'phone_number_quality_update',
    ),
  );
  assertEquals(itens.length, 0);
  assertEquals(ignorados, ['field:phone_number_quality_update']);
});

Deno.test('mensagem sem id ou sem número é descartada com nome, não em silêncio', () => {
  const { itens, ignorados } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      messages: [
        { from: '5584988776655', timestamp: '1757030000', type: 'text', text: { body: 'x' } },
      ],
    }),
  );
  assertEquals(itens.length, 0);
  assertEquals(ignorados, ['mensagem_sem_id_ou_numero']);
});

Deno.test('corpo vazio ou estranho não quebra o adaptador', () => {
  assertEquals(extrairDaMeta(null).itens, []);
  assertEquals(extrairDaMeta({}).itens, []);
  assertEquals(extrairDaMeta({ entry: 'nao-e-lista' }).itens, []);
  assertEquals(extrairDaMeta({ object: 'page', entry: [] }).ignorados, ['object:page']);
});

Deno.test('um lote com mensagem, eco e recibo sai com os três', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      messages: [
        {
          from: '5584988776655',
          id: 'wamid.M',
          timestamp: '1757030000',
          type: 'text',
          text: { body: 'oi' },
        },
      ],
      message_echoes: [
        {
          from: '5584999880011',
          to: '5584988776655',
          id: 'wamid.E',
          timestamp: '1757030001',
          type: 'text',
          text: { body: 'eco' },
        },
      ],
      statuses: [{ id: 'wamid.S', status: 'delivered', timestamp: '1757030002' }],
    }),
  );
  assertEquals(
    itens.map((i) => i.tipo),
    ['mensagem', 'eco', 'recibo'],
  );
});

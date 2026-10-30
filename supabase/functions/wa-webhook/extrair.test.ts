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

Deno.test('a qualidade do número vira item de saúde, não linha de ignorados', () => {
  const { itens, ignorados } = extrairDaMeta(
    envelope(
      {
        display_phone_number: '5584999880011',
        event: 'THROUGHPUT_UPGRADE',
        max_daily_conversations_per_business: 'TIER_2K',
        current_limit: 'TIER_2K', // obsoleto desde fev/2026; chega em conta antiga
        old_limit: 'TIER_250',
      },
      'phone_number_quality_update',
    ),
  );
  assertEquals(ignorados, []);
  assertEquals(itens.length, 1);
  const item = so(itens, 'saude')[0];
  assertEquals(item.numero, '+5584999880011');
  assertEquals(item.limite_atual, 'TIER_2K');
  assertEquals(item.limite_anterior, 'TIER_250');
  assertEquals(item.chave, 'saude:phone_number_quality_update:e1:1757030000:0');
});

Deno.test('o campo obsoleto sozinho ainda vale: conta antiga não fica sem tier', () => {
  const { itens } = extrairDaMeta(
    envelope(
      { event: 'THROUGHPUT_UPGRADE', current_limit: 'TIER_250' },
      'phone_number_quality_update',
    ),
  );
  assertEquals(so(itens, 'saude')[0].limite_atual, 'TIER_250');
});

Deno.test('FLAGGED é a nota caindo, e chega ANTES da leitura da Graph', () => {
  const { itens } = extrairDaMeta(
    envelope(
      { display_phone_number: '5584999880011', event: 'FLAGGED' },
      'phone_number_quality_update',
    ),
  );
  assertEquals(so(itens, 'saude')[0].qualidade, 'RED');
});

Deno.test('UNFLAGGED não pinta de verde: só a Graph sabe a nota', () => {
  // "Deixou de estar em alerta" não é "está bem". Inventar um GREEN aqui
  // apagaria um RED verdadeiro que a leitura periódica já tivesse gravado.
  const { itens } = extrairDaMeta(
    envelope({ event: 'UNFLAGGED' }, 'phone_number_quality_update'),
  );
  assertEquals(so(itens, 'saude')[0].qualidade, null);
});

Deno.test('account_update traz restrição e banimento, e NÃO traz número', () => {
  const { itens, ignorados } = extrairDaMeta(
    envelope(
      {
        event: 'ACCOUNT_RESTRICTION',
        restriction_info: [
          { restriction_type: 'RESTRICTED_BIZ_INITIATED_MESSAGING', expiration: 1757030000 },
        ],
        ban_info: { waba_ban_state: 'DISABLE', waba_ban_date: '2026-09-25' },
      },
      'account_update',
    ),
  );
  assertEquals(ignorados, []);
  const item = so(itens, 'saude')[0];
  // A restrição é da WABA: o número é do banco, por app.wa_numero_padrao().
  assertEquals(item.numero, null);
  assertEquals(item.banido, true);
  assertEquals(item.restricoes.length, 1);
  assertEquals(item.restricoes[0].restriction_type, 'RESTRICTED_BIZ_INITIATED_MESSAGING');
});

Deno.test('SCHEDULE_FOR_DISABLE ainda não é banimento: a porta não fechou', () => {
  const { itens } = extrairDaMeta(
    envelope({ event: 'DISABLED_UPDATE', ban_info: { waba_ban_state: 'SCHEDULE_FOR_DISABLE' } },
      'account_update'),
  );
  assertEquals(so(itens, 'saude')[0].banido, false);
});

Deno.test('business_capability_update carrega o tier, que é a fonte viva', () => {
  const { itens } = extrairDaMeta(
    envelope(
      { max_daily_conversations_per_business: 'TIER_10K', max_phone_numbers_per_waba: 25 },
      'business_capability_update',
    ),
  );
  assertEquals(so(itens, 'saude')[0].limite_atual, 'TIER_10K');
});

Deno.test('campo realmente desconhecido continua NOMEADO como ignorado', () => {
  const { itens, ignorados } = extrairDaMeta(
    envelope({ new_category: 'UTILITY' }, 'template_category_update'),
  );
  assertEquals(itens.length, 0);
  assertEquals(ignorados, ['field:template_category_update']);
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

// ---- BSUID (nomes de usuário do WhatsApp, 2026) ------------------------------
// https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/

Deno.test('BSUID com telefone: a mensagem sai com os dois', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      contacts: [
        { profile: { name: 'Marcos' }, wa_id: '5584988776655', user_id: 'BR.13491208655302741918' },
      ],
      messages: [
        {
          from: '5584988776655',
          from_user_id: 'BR.13491208655302741918',
          id: 'wamid.BSUID.1',
          timestamp: '1757030000',
          type: 'text',
          text: { body: 'oi' },
        },
      ],
    }),
  );
  const m = so(itens, 'mensagem')[0];
  assertEquals(m.de, '+5584988776655');
  assertEquals(m.de_user_id, 'BR.13491208655302741918');
  assertEquals(m.nome_do_perfil, 'Marcos');
});

Deno.test('BSUID SEM telefone: a mensagem NÃO é descartada — segue com de = null', () => {
  const { itens, ignorados } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      contacts: [{ profile: { name: 'Marcos', username: 'marcos.som' }, user_id: 'BR.777' }],
      messages: [
        {
          from_user_id: 'BR.777',
          id: 'wamid.BSUID.2',
          timestamp: '1757030000',
          type: 'text',
          text: { body: 'parar' },
        },
      ],
    }),
  );
  assertEquals(ignorados, []);
  const m = so(itens, 'mensagem')[0];
  assertEquals(m.chave, 'wamid.BSUID.2');
  assertEquals(m.de, null);
  assertEquals(m.de_user_id, 'BR.777');
  assertEquals(m.texto, 'parar');
});

Deno.test('BSUID sem `from`, mas com wa_id em contacts[]: o telefone vem do contato', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      contacts: [{ wa_id: '5584988776655', user_id: 'BR.888' }],
      messages: [
        {
          from_user_id: 'BR.888',
          id: 'wamid.BSUID.3',
          timestamp: '1757030000',
          type: 'text',
          text: { body: 'x' },
        },
      ],
    }),
  );
  assertEquals(so(itens, 'mensagem')[0].de, '+5584988776655');
});

Deno.test('recibo com recipient_user_id e sem recipient_id: continua valendo pelo wamid', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      statuses: [
        { id: 'wamid.Z', status: 'read', timestamp: '1757030000', recipient_user_id: 'BR.999' },
      ],
    }),
  );
  const r = so(itens, 'recibo')[0];
  assertEquals(r.chave, 'status:wamid.Z:read');
  assertEquals(r.para_user_id, 'BR.999');
});

// ---- o nome do perfil (28/09/2026) ------------------------------------------
// A Meta manda `contacts[].profile.name` em toda mensagem recebida, e até esta
// data o extrator o ignorava: por isso 193 conversas em produção apareciam como
// "Contato do WhatsApp (11) 5128-5383".

Deno.test('nome do perfil: casa pelo wa_id e vem na mensagem', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      contacts: [{ profile: { name: 'Buffet Sabor do Sol' }, wa_id: '5584988776655' }],
      messages: [
        {
          from: '5584988776655',
          id: 'wamid.NOME.1',
          timestamp: '1757030000',
          type: 'text',
          text: { body: 'bom dia' },
        },
      ],
    }),
  );
  assertEquals(so(itens, 'mensagem')[0].nome_do_perfil, 'Buffet Sabor do Sol');
});

Deno.test('nome do perfil: casa pelo BSUID quando a Meta omitiu o telefone', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      contacts: [{ profile: { name: 'Marcos Som' }, user_id: 'BR.777' }],
      messages: [
        { from_user_id: 'BR.777', id: 'wamid.NOME.2', timestamp: '1757030000', type: 'text', text: { body: 'oi' } },
      ],
    }),
  );
  assertEquals(so(itens, 'mensagem')[0].nome_do_perfil, 'Marcos Som');
});

Deno.test('nome do perfil: contato de OUTRA pessoa não empresta o nome', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      contacts: [{ profile: { name: 'Fulano' }, wa_id: '5584900000000' }],
      messages: [
        { from: '5584988776655', id: 'wamid.NOME.3', timestamp: '1757030000', type: 'text', text: { body: 'oi' } },
      ],
    }),
  );
  assertEquals(so(itens, 'mensagem')[0].nome_do_perfil, null);
});

Deno.test('nome do perfil: em branco vira nulo, e nunca string vazia', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      contacts: [{ profile: { name: '   ' }, wa_id: '5584988776655' }],
      messages: [
        { from: '5584988776655', id: 'wamid.NOME.4', timestamp: '1757030000', type: 'text', text: { body: 'oi' } },
      ],
    }),
  );
  assertEquals(so(itens, 'mensagem')[0].nome_do_perfil, null);
});

Deno.test('nome do perfil: sem contacts, a mensagem segue sem nome', () => {
  const { itens } = extrairDaMeta(
    envelope({
      metadata: METADADOS,
      messages: [
        { from: '5584988776655', id: 'wamid.NOME.5', timestamp: '1757030000', type: 'text', text: { body: 'oi' } },
      ],
    }),
  );
  assertEquals(so(itens, 'mensagem')[0].nome_do_perfil, null);
});

// -----------------------------------------------------------------------------
// O WhatsApp completo (27/10/2026)
// -----------------------------------------------------------------------------

function uma(m: Record<string, unknown>, extras: Record<string, unknown> = {}) {
  return extrairDaMeta(
    envelope({
      metadata: METADADOS,
      messages: [{ from: '5584988776655', timestamp: '1757030000', ...m }],
      ...extras,
    }),
  ).itens;
}

Deno.test('resposta citada e encaminhada vão no extra', () => {
  const m = so(
    uma({
      id: 'wamid.CIT',
      type: 'text',
      text: { body: 'isso mesmo' },
      context: { from: '5584999880011', id: 'wamid.ORIGINAL', frequently_forwarded: true },
    }),
    'mensagem',
  )[0];
  assertEquals(m.extra.responde_a_wamid, 'wamid.ORIGINAL');
  assertEquals(m.extra.encaminhada, true);
  assertEquals(m.extra.conteudo, { muito_encaminhada: true });
});

Deno.test('reação aponta para a mensagem reagida; sem emoji é tirar', () => {
  const r = so(uma({ id: 'wamid.R', type: 'reaction', reaction: { message_id: 'wamid.ALVO', emoji: '👍' } }), 'mensagem')[0];
  assertEquals(r.texto, '👍');
  assertEquals(r.extra.reage_a_wamid, 'wamid.ALVO');
  const tirou = so(uma({ id: 'wamid.R2', type: 'reaction', reaction: { message_id: 'wamid.ALVO' } }), 'mensagem')[0];
  assertEquals(tirou.texto, null);
  assertEquals(tirou.extra.reage_a_wamid, 'wamid.ALVO');
});

Deno.test('localização guarda as coordenadas; cartão guarda nome e telefones', () => {
  const l = so(
    uma({ id: 'wamid.L', type: 'location', location: { latitude: -5.79, longitude: -35.2, name: 'Espaço Lagoa' } }),
    'mensagem',
  )[0];
  assertEquals(l.extra.conteudo, { latitude: -5.79, longitude: -35.2, nome: 'Espaço Lagoa' });
  const c = so(
    uma({
      id: 'wamid.C',
      type: 'contacts',
      contacts: [
        {
          name: { formatted_name: 'Marta Buffet' },
          phones: [{ phone: '+55 84 99999-0000', type: 'CELL', wa_id: '5584999990000' }],
        },
      ],
    }),
    'mensagem',
  )[0];
  assertEquals(c.extra.conteudo, {
    contatos: [
      { nome: 'Marta Buffet', telefones: [{ numero: '+55 84 99999-0000', tipo: 'CELL', wa_id: '5584999990000' }] },
    ],
  });
});

Deno.test('botão escolhido, documento com nome, anúncio e não suportado', () => {
  const b = so(
    uma({ id: 'wamid.B', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b2', title: 'Terça' } } }),
    'mensagem',
  )[0];
  assertEquals(b.texto, 'Terça');
  assertEquals(b.extra.conteudo, { resposta: { id: 'b2', titulo: 'Terça' } });
  const d = so(
    uma({ id: 'wamid.D', type: 'document', document: { id: 'm1', mime_type: 'application/pdf', filename: 'cardapio.pdf' } }),
    'mensagem',
  )[0];
  assertEquals(d.extra.media_nome, 'cardapio.pdf');
  const a = so(
    uma({ id: 'wamid.A', type: 'text', text: { body: 'oi' }, referral: { headline: 'Seja parceiro', source_type: 'ad' } }),
    'mensagem',
  )[0];
  assertEquals(a.extra.conteudo, { anuncio: { titulo: 'Seja parceiro', tipo: 'ad' } });
  const u = so(uma({ id: 'wamid.U', type: 'unsupported', unsupported: { type: 'edit' } }), 'mensagem')[0];
  assertEquals(u.extra.conteudo, { nao_suportado: { tipo: 'edit' } });
});

Deno.test('o contato apagou ou editou: evento sobre a original, não mensagem nova', () => {
  const apagou = uma({ id: 'wamid.REV', type: 'revoke', revoke: { original_message_id: 'wamid.X' } });
  assertEquals(so(apagou, 'mensagem').length, 0);
  assertEquals(so(apagou, 'evento')[0].alvo, 'wamid.X');
  const editou = so(
    uma({
      id: 'wamid.EDT',
      type: 'edit',
      edit: { original_message_id: 'wamid.Y', message: { type: 'text', text: { body: 'novo texto' } } },
    }),
    'evento',
  )[0];
  assertEquals(editou.evento, 'edit');
  assertEquals(editou.texto, 'novo texto');
});

Deno.test('mensagem de grupo leva o id do grupo', () => {
  const g = so(uma({ id: 'wamid.G', type: 'text', text: { body: 'oi, grupo' }, group_id: 'G1' }), 'mensagem')[0];
  assertEquals(g.grupo, 'G1');
});

Deno.test('webhooks de grupo viram um item por grupo, com chave estável', () => {
  const corpo = envelope(
    {
      messaging_product: 'whatsapp',
      metadata: METADADOS,
      groups: [
        {
          timestamp: '1757030000',
          type: 'group_create',
          group_id: 'G1',
          request_id: 'REQ1',
          subject: 'Réveillon',
          invite_link: 'https://chat.whatsapp.com/abc',
        },
      ],
    },
    'group_lifecycle_update',
  );
  const a = so(extrairDaMeta(corpo).itens, 'grupo');
  const b = so(extrairDaMeta(corpo).itens, 'grupo');
  assertEquals(a.length, 1);
  assertEquals(a[0].chave, b[0].chave);
  assertEquals(a[0].evento.tipo, 'group_create');
  assertEquals(a[0].evento.invite_link, 'https://chat.whatsapp.com/abc');
  assertEquals(a[0].evento.numero, '+5584999880011');
  const entrou = so(
    extrairDaMeta(
      envelope(
        {
          metadata: METADADOS,
          groups: [
            {
              timestamp: '1757030001',
              type: 'group_participants_add',
              group_id: 'G1',
              reason: 'invite_link',
              added_participants: [{ wa_id: '5584977776666' }],
            },
          ],
        },
        'group_participants_update',
      ),
    ).itens,
    'grupo',
  )[0];
  assertEquals(entrou.evento.added, [{ wa_id: '5584977776666' }]);
});

// =============================================================================
// A ligação pelo WhatsApp: o campo `calls` e a resposta ao pedido de permissão não
// entram na fila. Nada aqui pode virar `itens`, nem mensagem.
// =============================================================================
function loteDeLigacao(valor: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'calls', value: valor }] }],
  };
}
const META_DA_LIGACAO = { phone_number_id: 'PN', display_phone_number: '5584994058888' };
const CONTATO = [{ profile: { name: 'Carlos' }, wa_id: '5584999990001', user_id: 'BR.1' }];

Deno.test('o cliente ligou: a oferta vai para as chamadas, e nada para a fila', () => {
  const { itens, chamadas, ignorados } = extrairDaMeta(loteDeLigacao({
    metadata: META_DA_LIGACAO,
    contacts: CONTATO,
    calls: [{
      id: 'wacid.1',
      from: '5584999990001',
      from_user_id: 'BR.1',
      to: '5584994058888',
      event: 'connect',
      timestamp: '1671644824',
      session: { sdp_type: 'offer', sdp: 'v=0 oferta\r\n' },
    }],
  }));
  assertEquals(itens, []);
  assertEquals(ignorados, []);
  assertEquals(chamadas.length, 1);
  const c = chamadas[0];
  if (c.tipo !== 'chamada') throw new Error('tipo errado');
  assertEquals(c.evento, 'connect');
  assertEquals(c.meta_call_id, 'wacid.1');
  assertEquals(c.de, '+5584999990001');
  assertEquals(c.nome, 'Carlos');
  assertEquals(c.numero_da_empresa, '+5584994058888');
  assertEquals(c.sdp_tipo, 'offer');
  // Inteiro: sem a última quebra de linha, o navegador recusa o SDP.
  assertEquals(c.sdp, 'v=0 oferta\r\n');
});

Deno.test('a ligação feita: o cliente é o `to`, e a resposta volta com o id nosso', () => {
  const { chamadas } = extrairDaMeta(loteDeLigacao({
    metadata: META_DA_LIGACAO,
    contacts: CONTATO,
    calls: [{
      id: 'wacid.2',
      from: '5584994058888',
      to: '5584999990001',
      event: 'connect',
      direction: 'BUSINESS_INITIATED',
      biz_opaque_callback_data: 'id-nosso',
      timestamp: '1749196895',
      session: { sdp_type: 'answer', sdp: 'v=0 resposta' },
    }],
  }));
  const c = chamadas[0];
  if (c.tipo !== 'chamada') throw new Error('tipo errado');
  assertEquals(c.de, '+5584999990001');
  assertEquals(c.opaco, 'id-nosso');
  assertEquals(c.sdp_tipo, 'answer');
});

Deno.test('o fim traz duração e erros, e sem início os horários ficam nulos', () => {
  const { chamadas } = extrairDaMeta(loteDeLigacao({
    metadata: META_DA_LIGACAO,
    calls: [
      {
        id: 'wacid.3',
        from: '5584999990001',
        event: 'terminate',
        direction: 'USER_INITIATED',
        status: 'COMPLETED',
        start_time: '1671644824',
        end_time: '1671644944',
        duration: 120,
        timestamp: '1671644944',
      },
      {
        id: 'wacid.4',
        from: '5584999990001',
        event: 'terminate',
        direction: 'USER_INITIATED',
        status: 'FAILED',
        timestamp: '1671644944',
      },
    ],
    errors: [{ code: 138021, message: 'Media receive timeout' }],
  }));
  const [a, b] = chamadas;
  if (a.tipo !== 'chamada' || b.tipo !== 'chamada') throw new Error('tipo errado');
  assertEquals(a.duracao, 120);
  assertEquals(a.inicio, new Date(1671644824 * 1000).toISOString());
  assertEquals(b.inicio, null);
  assertEquals(b.fim, null);
  assertEquals(b.erros.length, 1);
});

Deno.test('o andamento da ligação feita vem em `statuses`, no mesmo campo', () => {
  const { itens, chamadas } = extrairDaMeta(loteDeLigacao({
    metadata: META_DA_LIGACAO,
    statuses: [{ id: 'wacid.5', type: 'call', status: 'RINGING', timestamp: '1671644824', recipient_id: '5584999990001' }],
  }));
  assertEquals(itens, []);
  assertEquals(chamadas, [{
    tipo: 'chamada_status',
    meta_call_id: 'wacid.5',
    status: 'RINGING',
    opaco: null,
    ocorrido_em: new Date(1671644824 * 1000).toISOString(),
  }]);
});

Deno.test('a resposta ao pedido de permissão não vira mensagem', () => {
  const { itens, chamadas } = extrairDaMeta({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA',
      changes: [{
        field: 'messages',
        value: {
          metadata: META_DA_LIGACAO,
          contacts: CONTATO,
          messages: [{
            id: 'wamid.PERM',
            from: '5584999990001',
            timestamp: '1768550000',
            type: 'interactive',
            interactive: {
              type: 'call_permission_reply',
              call_permission_reply: {
                response: 'accept',
                is_permanent: false,
                expiration_timestamp: '1768550400',
                response_source: 'user_action',
              },
            },
          }],
        },
      }],
    }],
  });
  assertEquals(itens, []);
  const c = chamadas[0];
  if (c.tipo !== 'permissao') throw new Error('tipo errado');
  assertEquals(c.resposta, 'accept');
  assertEquals(c.permanente, false);
  assertEquals(c.expira_em, new Date(1768550400 * 1000).toISOString());
  assertEquals(c.origem, 'user_action');
  assertEquals(c.de, '+5584999990001');
});

Deno.test('a permissão sem prazo, na forma que a Meta real mandou: sem expiration_timestamp', () => {
  const { itens, chamadas } = extrairDaMeta({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA',
      changes: [{
        field: 'messages',
        value: {
          metadata: { display_phone_number: '558494058888', phone_number_id: 'PID' },
          contacts: [{ wa_id: '5584999990001', user_id: 'BR.1', profile: { name: 'Cliente' } }],
          messages: [{
            from: '5584999990001',
            from_user_id: 'BR.1',
            id: 'wamid.RESPOSTA',
            timestamp: '1793384325',
            type: 'interactive',
            context: { from: '558494058888', id: 'wamid.PEDIDO' },
            interactive: {
              type: 'call_permission_reply',
              call_permission_reply: { response: 'accept', is_permanent: true, response_source: 'user_action' },
            },
          }],
        },
      }],
    }],
  });
  assertEquals(itens, []);
  const c = chamadas[0];
  if (c.tipo !== 'permissao') throw new Error('tipo errado');
  assertEquals(c.permanente, true);
  assertEquals(c.expira_em, null);
  assertEquals(c.ocorrido_em, new Date(1793384325 * 1000).toISOString());
});

Deno.test('a resposta a um botão comum continua sendo mensagem', () => {
  const { itens, chamadas } = extrairDaMeta({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA',
      changes: [{
        field: 'messages',
        value: {
          metadata: META_DA_LIGACAO,
          messages: [{
            id: 'wamid.BOT',
            from: '5584999990001',
            timestamp: '1768550000',
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Sim' } },
          }],
        },
      }],
    }],
  });
  assertEquals(chamadas, []);
  assertEquals(itens.length, 1);
  assertEquals(itens[0].tipo, 'mensagem');
});

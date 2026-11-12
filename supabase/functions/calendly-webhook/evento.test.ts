// =============================================================================
// Testes do aviso do Calendly resumido para o banco. Rodam sem rede e sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     deno test calendly-webhook/
//
// Protegem: o que é visita e o que é reunião; on-line × presencial × ligação
// (e que o telefone do cliente numa ligação não vire "local"); que a resposta
// de telefone vá para a ficha e não para as respostas; o cancelamento e a
// remarcação; os avisos que não são agendamento; o token do convite da Agenda
// (`tracking.utm_content`, 11/11/2026); e que o log não leve dado pessoal.
// =============================================================================

import { assertEquals } from 'jsr:@std/assert@1';
import {
  conviteDe,
  lerCorpo,
  lugarDe,
  naturezaDe,
  resumir,
  resumoParaLog,
  separarRespostas,
} from './evento.ts';

/** No formato do Calendly (developer.calendly.com, "Webhook payload"). */
function aviso(
  evento = 'invitee.created',
  payload: Record<string, unknown> = {},
  marcado: Record<string, unknown> = {},
) {
  return {
    created_at: '2026-11-10T15:00:00.000000Z',
    created_by: 'https://api.calendly.com/users/USR1',
    event: evento,
    payload: {
      cancel_url: 'https://calendly.com/cancellations/INV1',
      created_at: '2026-11-10T15:00:00.000000Z',
      email: 'maria@exemplo.com',
      event: 'https://api.calendly.com/scheduled_events/EV1',
      first_name: null,
      last_name: null,
      name: 'Maria  Souza',
      new_invitee: null,
      old_invitee: null,
      questions_and_answers: [
        { answer: '+55 84 99999-1234', position: 0, question: 'Telefone (WhatsApp)' },
        {
          answer: 'Quero conhecer o apartamento da Rua das Dunas',
          position: 1,
          question: 'Assunto',
        },
      ],
      reschedule_url: 'https://calendly.com/reschedulings/INV1',
      rescheduled: false,
      status: 'active',
      text_reminder_number: null,
      timezone: 'America/Fortaleza',
      tracking: {
        utm_campaign: null,
        utm_source: null,
        utm_medium: null,
        utm_content: null,
        utm_term: null,
        salesforce_uuid: null,
      },
      uri: 'https://api.calendly.com/scheduled_events/EV1/invitees/INV1',
      scheduled_event: {
        uri: 'https://api.calendly.com/scheduled_events/EV1',
        name: 'Reunião de 30 minutos',
        status: 'active',
        start_time: '2026-11-12T13:00:00.000000Z',
        end_time: '2026-11-12T13:30:00.000000Z',
        event_type: 'https://api.calendly.com/event_types/ET1',
        location: {
          type: 'google_conference',
          status: 'pushed',
          join_url: 'https://meet.google.com/abc-defg-hij',
        },
        event_memberships: [
          {
            user: 'https://api.calendly.com/users/USR1',
            user_email: 'contato@imovaimobiliaria.com.br',
            user_name: 'Imova',
          },
        ],
        ...marcado,
      },
      ...payload,
    },
  };
}

function resumoDe(corpo: unknown) {
  const r = resumir(corpo as Record<string, unknown>);
  if (r.tipo !== 'tratar') throw new Error(`esperava tratar, veio ${r.tipo}`);
  return r.resumo;
}

Deno.test('agendamento on-line: o resumo inteiro', () => {
  assertEquals(resumoDe(aviso()), {
    evento: 'invitee.created',
    convidado_uri: 'https://api.calendly.com/scheduled_events/EV1/invitees/INV1',
    evento_uri: 'https://api.calendly.com/scheduled_events/EV1',
    nome: 'Maria Souza',
    email: 'maria@exemplo.com',
    telefone: '+55 84 99999-1234',
    inicio: '2026-11-12T13:00:00.000Z',
    fim: '2026-11-12T13:30:00.000Z',
    tipo_de_evento: 'Reunião de 30 minutos',
    natureza: 'reuniao',
    formato: 'online',
    local: null,
    link: 'https://meet.google.com/abc-defg-hij',
    anfitriao_email: 'contato@imovaimobiliaria.com.br',
    respostas: [{ pergunta: 'Assunto', resposta: 'Quero conhecer o apartamento da Rua das Dunas' }],
    remarcado: false,
    convidado_anterior_uri: null,
    cancelamento: null,
    link_cancelar: 'https://calendly.com/cancellations/INV1',
    link_remarcar: 'https://calendly.com/reschedulings/INV1',
    convite: null,
  });
});

Deno.test('o convite da Agenda: o token do utm_content vai ao banco', () => {
  const comConvite = (utm: unknown) =>
    resumoDe(
      aviso('invitee.created', {
        tracking: {
          utm_campaign: 'ia',
          utm_source: 'crm',
          utm_medium: 'whatsapp',
          utm_content: utm,
          utm_term: null,
          salesforce_uuid: null,
        },
      }),
    ).convite;
  assertEquals(comConvite('k3p9x2m7q1za'), 'k3p9x2m7q1za');
  // O Calendly pode devolver em maiúsculas, ou com espaço em volta.
  assertEquals(comConvite(' K3P9X2M7Q1ZA '), 'k3p9x2m7q1za');
  // Não é token: curto, longo, com outro caractere, ou de outra campanha.
  assertEquals(comConvite('abc'), null);
  assertEquals(comConvite('a'.repeat(17)), null);
  assertEquals(comConvite('k3p9x2m7-q1za'), null);
  assertEquals(comConvite('instagram_bio'), null);
  assertEquals(comConvite(null), null);
  assertEquals(comConvite(12345678901), null);
  // Sem `tracking` (aviso antigo), ou tracking que não é objeto.
  assertEquals(conviteDe(undefined), null);
  assertEquals(conviteDe('k3p9x2m7q1za'), null);
  assertEquals(resumoDe(aviso('invitee.created', { tracking: undefined })).convite, null);
});

Deno.test('o convite vem também no cancelamento (o banco não precisa dele ali)', () => {
  const r = resumoDe(
    aviso('invitee.canceled', {
      tracking: { utm_content: 'k3p9x2m7q1za' },
      cancellation: { canceler_type: 'invitee', reason: null },
    }),
  );
  assertEquals(r.convite, 'k3p9x2m7q1za');
});

Deno.test('visita: pelo nome do tipo de evento, ou pela resposta "Visita…"', () => {
  assertEquals(naturezaDe('Visita ao imóvel', []), 'visita');
  assertEquals(naturezaDe('VISITA', []), 'visita');
  assertEquals(
    naturezaDe('Reunião', [
      { pergunta: 'O que você quer marcar?', resposta: 'Visita a um imóvel' },
    ]),
    'visita',
  );
  assertEquals(
    naturezaDe('Reunião', [{ pergunta: 'Assunto', resposta: 'Falar da visita de ontem' }]),
    'reuniao',
  );
  assertEquals(naturezaDe(null, []), 'reuniao');
  const r = resumoDe(
    aviso(
      'invitee.created',
      {},
      { name: 'Visita ao imóvel', location: { type: 'physical', location: 'Rua das Dunas, 142' } },
    ),
  );
  assertEquals(
    [r.natureza, r.formato, r.local, r.link],
    ['visita', 'presencial', 'Rua das Dunas, 142', null],
  );
});

Deno.test('o lugar: sala, endereço, ligação, link digitado e nada', () => {
  assertEquals(
    lugarDe({ type: 'zoom', join_url: 'https://zoom.us/j/1' }).link,
    'https://zoom.us/j/1',
  );
  assertEquals(lugarDe({ type: 'physical', location: 'Av. Roberto Freire, 100' }), {
    formato: 'presencial',
    local: 'Av. Roberto Freire, 100',
    link: null,
    telefone: null,
  });
  assertEquals(
    lugarDe({ type: 'ask_invitee', location: 'Minha casa, Ponta Negra' }).formato,
    'presencial',
  );
  // A empresa liga para o cliente: o "local" é o telefone DELE, e não vira lugar.
  assertEquals(lugarDe({ type: 'outbound_call', location: '+5584988887777' }), {
    formato: 'online',
    local: null,
    link: null,
    telefone: '+5584988887777',
  });
  assertEquals(lugarDe({ type: 'inbound_call', location: '+558433334444' }), {
    formato: 'online',
    local: null,
    link: null,
    telefone: null,
  });
  assertEquals(
    lugarDe({ type: 'custom', location: 'https://meet.jit.si/imova' }).link,
    'https://meet.jit.si/imova',
  );
  // Sala sem https não é aceita como link.
  assertEquals(lugarDe({ type: 'custom', location: 'http://inseguro.local' }).link, null);
  assertEquals(lugarDe(null), { formato: 'online', local: null, link: null, telefone: null });
});

Deno.test('o telefone da ligação entra quando não há outro', () => {
  const r = resumoDe(
    aviso(
      'invitee.created',
      { questions_and_answers: [] },
      {
        location: { type: 'outbound_call', location: '+5584988887777' },
      },
    ),
  );
  assertEquals([r.telefone, r.local], ['+5584988887777', null]);
});

Deno.test('o telefone do lembrete por SMS vale antes da pergunta', () => {
  const r = resumoDe(aviso('invitee.created', { text_reminder_number: '+55 84 91111-2222' }));
  assertEquals(r.telefone, '+55 84 91111-2222');
});

Deno.test('a resposta de telefone vai para a ficha, não para as respostas', () => {
  const { telefone, respostas } = separarRespostas([
    { question: 'Seu celular', answer: '84 98888-7777' },
    { question: 'WhatsApp', answer: 'não tenho' },
    { question: 'Código do imóvel', answer: 'AP-0142' },
    { question: 'Vazia', answer: '   ' },
  ]);
  assertEquals(telefone, '84 98888-7777');
  assertEquals(respostas, [{ pergunta: 'Código do imóvel', resposta: 'AP-0142' }]);
});

Deno.test('nome em duas partes, quando o Calendly separa', () => {
  const r = resumoDe(
    aviso('invitee.created', { name: null, first_name: 'João', last_name: 'Lima' }),
  );
  assertEquals(r.nome, 'João Lima');
});

Deno.test('cancelamento: quem cancelou e o motivo', () => {
  const r = resumoDe(
    aviso('invitee.canceled', {
      status: 'canceled',
      cancellation: { canceled_by: 'Maria Souza', reason: 'Viajei', canceler_type: 'invitee' },
    }),
  );
  assertEquals(
    [r.evento, r.cancelamento],
    ['invitee.canceled', { por: 'convidado', motivo: 'Viajei' }],
  );
  const pelaCasa = resumoDe(
    aviso('invitee.canceled', {
      cancellation: { canceled_by: 'Imova', reason: null, canceler_type: 'host' },
    }),
  );
  assertEquals(pelaCasa.cancelamento, { por: 'anfitriao', motivo: null });
});

Deno.test('remarcação: o cancelamento diz remarcado, e o novo traz o convidado anterior', () => {
  assertEquals(resumoDe(aviso('invitee.canceled', { rescheduled: true })).remarcado, true);
  const novo = resumoDe(
    aviso('invitee.created', {
      uri: 'https://api.calendly.com/scheduled_events/EV2/invitees/INV2',
      old_invitee: 'https://api.calendly.com/scheduled_events/EV1/invitees/INV1',
    }),
  );
  assertEquals(
    novo.convidado_anterior_uri,
    'https://api.calendly.com/scheduled_events/EV1/invitees/INV1',
  );
});

Deno.test('outros eventos do Calendly são ignorados, sem ir ao banco', () => {
  assertEquals(resumir(aviso('invitee_no_show.created')), {
    tipo: 'ignorar',
    evento: 'invitee_no_show.created',
  });
  assertEquals(resumir({}), { tipo: 'ignorar', evento: 'sem_evento' });
});

Deno.test('agendamento sem URI ou sem horário é inválido', () => {
  assertEquals(resumir(aviso('invitee.created', { uri: null })), {
    tipo: 'invalido',
    motivo: 'sem_uri',
  });
  assertEquals(resumir(aviso('invitee.created', {}, { end_time: '2026-11-12T12:00:00Z' })), {
    tipo: 'invalido',
    motivo: 'horario_invalido',
  });
  assertEquals(resumir(aviso('invitee.created', {}, { start_time: 'amanhã' })), {
    tipo: 'invalido',
    motivo: 'horario_invalido',
  });
  assertEquals(resumir({ event: 'invitee.created', payload: 'x' }), {
    tipo: 'invalido',
    motivo: 'sem_payload',
  });
});

Deno.test('lerCorpo: só objeto JSON', () => {
  assertEquals(lerCorpo('{').ok, false);
  assertEquals(lerCorpo('[1]').ok, false);
  assertEquals(lerCorpo('{"event":"x"}').ok, true);
});

Deno.test('o log não leva nome, e-mail, telefone nem resposta', () => {
  const linha = JSON.stringify(resumoParaLog(resumir(aviso())));
  for (const pessoal of ['Maria', 'maria@exemplo.com', '99999', 'Dunas', 'imovaimobiliaria']) {
    assertEquals(linha.includes(pessoal), false, pessoal);
  }
  assertEquals(resumoParaLog(resumir(aviso())), {
    evento: 'invitee.created',
    convidado: 'ees/INV1',
    natureza: 'reuniao',
    formato: 'online',
    remarcacao: false,
    com_convite: false,
  });
  // O token do convite não vai para o log: só se havia um.
  const comToken = resumoParaLog(
    resumir(aviso('invitee.created', { tracking: { utm_content: 'k3p9x2m7q1za' } })),
  );
  assertEquals(comToken.com_convite, true);
  assertEquals(JSON.stringify(comToken).includes('k3p9x2m7q1za'), false);
});

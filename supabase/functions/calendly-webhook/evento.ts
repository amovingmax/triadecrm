// =============================================================================
// TRIADE — o aviso do Calendly, resumido para o banco (10/11/2026)
//
// O Calendly manda o convidado inteiro (developer.calendly.com, "Webhook
// payload"): nome, e-mail, respostas, o evento marcado com o lugar e o
// anfitrião, links de cancelar e remarcar, e, quando é o caso, o cancelamento e
// a remarcação. `public.calendly_receber` recebe só o que usa, com nomes
// nossos, e não depende do formato do Calendly. Decidir aqui o que é visita, o
// que é on-line e qual resposta é o telefone deixa a regra testável sem banco.
//
// O QUE É VISITA: o tipo de evento com "visita" no nome ("Visita ao imóvel"),
// ou uma resposta que começa com "Visita" (a pergunta de múltipla escolha "O
// que você quer marcar?" com a opção "Visita a um imóvel"). Todo o resto é
// reunião.
//
// O TELEFONE: o número do lembrete por SMS, ou a resposta a uma pergunta de
// telefone/WhatsApp/celular. Essa resposta NÃO vai junto com as outras: o
// telefone mora na ficha, onde o SDR o vê mascarado.
// =============================================================================

export type Natureza = 'reuniao' | 'visita';

export type Resposta = { pergunta: string; resposta: string };

/** O objeto de `public.calendly_receber(p_evento jsonb)`. */
export type ParaOBanco = {
  evento: 'invitee.created' | 'invitee.canceled';
  convidado_uri: string;
  evento_uri: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  inicio: string;
  fim: string;
  tipo_de_evento: string | null;
  natureza: Natureza;
  formato: 'online' | 'presencial';
  local: string | null;
  link: string | null;
  anfitriao_email: string | null;
  respostas: Resposta[];
  remarcado: boolean;
  convidado_anterior_uri: string | null;
  cancelamento: { por: 'convidado' | 'anfitriao' | null; motivo: string | null } | null;
  link_cancelar: string | null;
  link_remarcar: string | null;
};

export type Leitura =
  | { tipo: 'tratar'; resumo: ParaOBanco }
  | { tipo: 'ignorar'; evento: string }
  | { tipo: 'invalido'; motivo: string };

const EVENTOS_TRATADOS = new Set(['invitee.created', 'invitee.canceled']);
const PERGUNTA_DE_TELEFONE = /telefone|celular|whats|fone|phone/i;
const MAX_RESPOSTAS = 20;

type Objeto = Record<string, unknown>;

function ehObjeto(v: unknown): v is Objeto {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function texto(v: unknown, teto = 500): string | null {
  if (typeof v !== 'string') return null;
  const limpo = v.replace(/\s+/g, ' ').trim();
  return limpo.length > 0 ? limpo.slice(0, teto) : null;
}

function instante(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Só número com DDD (8 dígitos ou mais); o banco normaliza para E.164. */
function telefoneDe(v: unknown): string | null {
  const t = texto(v, 40);
  if (!t) return null;
  return t.replace(/\D/g, '').length >= 8 ? t : null;
}

function link(v: unknown): string | null {
  const t = texto(v, 1000);
  return t && /^https:\/\//i.test(t) ? t : null;
}

export function lerCorpo(cru: string): { ok: true; corpo: Objeto } | { ok: false; motivo: string } {
  let valor: unknown;
  try {
    valor = JSON.parse(cru);
  } catch {
    return { ok: false, motivo: 'json_invalido' };
  }
  if (!ehObjeto(valor)) return { ok: false, motivo: 'nao_e_objeto' };
  return { ok: true, corpo: valor };
}

/** Respostas do Calendly, separando a de telefone das outras. */
export function separarRespostas(qa: unknown): { telefone: string | null; respostas: Resposta[] } {
  let telefone: string | null = null;
  const respostas: Resposta[] = [];
  if (!Array.isArray(qa)) return { telefone, respostas };
  for (const item of qa) {
    if (!ehObjeto(item)) continue;
    const pergunta = texto(item.question, 300);
    const resposta = texto(item.answer, 500);
    if (!pergunta || !resposta) continue;
    if (PERGUNTA_DE_TELEFONE.test(pergunta)) {
      telefone ??= telefoneDe(resposta);
      continue;
    }
    if (respostas.length < MAX_RESPOSTAS) respostas.push({ pergunta, resposta });
  }
  return { telefone, respostas };
}

export function naturezaDe(nomeDoEvento: string | null, respostas: Resposta[]): Natureza {
  if (nomeDoEvento && /visita/i.test(nomeDoEvento)) return 'visita';
  if (respostas.some((r) => /^visita/i.test(r.resposta))) return 'visita';
  return 'reuniao';
}

/**
 * O lugar do Calendly (`scheduled_event.location`): com link de sala é on-line;
 * endereço (presencial, "perguntar ao convidado", personalizado) é presencial;
 * ligação é on-line sem sala — e o "local" da ligação que a empresa faz é o
 * TELEFONE do cliente, que não vai como lugar.
 */
export function lugarDe(local: unknown): {
  formato: 'online' | 'presencial';
  local: string | null;
  link: string | null;
  telefone: string | null;
} {
  if (!ehObjeto(local)) return { formato: 'online', local: null, link: null, telefone: null };
  const tipo = typeof local.type === 'string' ? local.type : '';
  const sala = link(local.join_url);
  if (sala) return { formato: 'online', local: null, link: sala, telefone: null };
  if (tipo === 'outbound_call') {
    return { formato: 'online', local: null, link: null, telefone: telefoneDe(local.location) };
  }
  if (tipo === 'inbound_call')
    return { formato: 'online', local: null, link: null, telefone: null };
  const onde = texto(local.location, 500);
  if (!onde) return { formato: 'online', local: null, link: null, telefone: null };
  if (/^https?:\/\//i.test(onde))
    return { formato: 'online', local: null, link: link(onde), telefone: null };
  return { formato: 'presencial', local: onde, link: null, telefone: null };
}

/** Do corpo do Calendly (`{event, payload}`) ao objeto do banco. */
export function resumir(corpo: Objeto): Leitura {
  const evento = typeof corpo.event === 'string' ? corpo.event : '';
  if (!EVENTOS_TRATADOS.has(evento)) return { tipo: 'ignorar', evento: evento || 'sem_evento' };

  const p = corpo.payload;
  if (!ehObjeto(p)) return { tipo: 'invalido', motivo: 'sem_payload' };
  const marcado = p.scheduled_event;
  if (!ehObjeto(marcado)) return { tipo: 'invalido', motivo: 'sem_scheduled_event' };

  const convidado = texto(p.uri, 300);
  const eventoUri = texto(marcado.uri, 300);
  if (!convidado || !eventoUri) return { tipo: 'invalido', motivo: 'sem_uri' };
  const inicio = instante(marcado.start_time);
  const fim = instante(marcado.end_time);
  if (!inicio || !fim || Date.parse(fim) <= Date.parse(inicio)) {
    return { tipo: 'invalido', motivo: 'horario_invalido' };
  }

  const { telefone: telefoneDaPergunta, respostas } = separarRespostas(p.questions_and_answers);
  const tipoDeEvento = texto(marcado.name, 200);
  const lugar = lugarDe(marcado.location);

  const membros = Array.isArray(marcado.event_memberships) ? marcado.event_memberships : [];
  const anfitriao = membros.find(ehObjeto);

  const nome =
    texto(p.name, 120) ??
    (texto([p.first_name, p.last_name].filter((x) => typeof x === 'string').join(' '), 120) ||
      null);

  const cancelamento = ehObjeto(p.cancellation)
    ? {
        por:
          p.cancellation.canceler_type === 'host'
            ? ('anfitriao' as const)
            : p.cancellation.canceler_type === 'invitee'
              ? ('convidado' as const)
              : null,
        motivo: texto(p.cancellation.reason, 500),
      }
    : null;

  return {
    tipo: 'tratar',
    resumo: {
      evento: evento as ParaOBanco['evento'],
      convidado_uri: convidado,
      evento_uri: eventoUri,
      nome,
      email: texto(p.email, 254),
      telefone: telefoneDe(p.text_reminder_number) ?? telefoneDaPergunta ?? lugar.telefone,
      inicio,
      fim,
      tipo_de_evento: tipoDeEvento,
      natureza: naturezaDe(tipoDeEvento, respostas),
      formato: lugar.formato,
      local: lugar.local,
      link: lugar.link,
      anfitriao_email: anfitriao ? texto(anfitriao.user_email, 254) : null,
      respostas,
      remarcado: p.rescheduled === true,
      convidado_anterior_uri: texto(p.old_invitee, 300),
      cancelamento,
      link_cancelar: link(p.cancel_url),
      link_remarcar: link(p.reschedule_url),
    },
  };
}

/** O que vai para o log: nada de nome, e-mail, telefone ou resposta. */
export function resumoParaLog(leitura: Leitura): Record<string, unknown> {
  if (leitura.tipo !== 'tratar') return { leitura: leitura.tipo };
  const r = leitura.resumo;
  return {
    evento: r.evento,
    convidado: r.convidado_uri.slice(-8),
    natureza: r.natureza,
    formato: r.formato,
    remarcacao: r.convidado_anterior_uri !== null || r.remarcado,
  };
}

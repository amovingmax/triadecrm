/**
 * O que cancelar, remarcar e marcar fazem no Calendly e no e-mail, dito antes, na
 * tela (11/11/2026, o acabamento da Agenda da Imova). Regras puras, testadas sem
 * DOM; os diálogos (`dialogo-cancelar.tsx`, `excluir-compromisso.tsx`,
 * `acoes-da-reuniao.tsx`) e a lista do conflito (`lista-de-conflitos.tsx`) só
 * mostram a frase.
 *
 * 1. O E-MAIL DO TIME. "O time é avisado por e-mail" só vale onde o e-mail de
 *    reunião existe (`EMPRESA.modulos.emailDeReuniao`). Na Imova não há Resend: a
 *    frase sai, e o aviso "O time não foi avisado por e-mail" também, porque
 *    acusaria em todo cartão uma falha que é falta de configuração. Volta sozinha
 *    no dia em que o módulo for ligado.
 *
 * 2. CANCELAR O QUE FOI MARCADO NO CRM. O protótipo aprovado dizia: "o bloco
 *    'Ocupado — CRM Imova' sai do Google Agenda: o horário volta a aparecer para o
 *    cliente no Calendly". Isso só é verdade quando o compromisso está na agenda
 *    que o link oferece (a de quem atende o Calendly) e o espelho no Google está
 *    ligado; a tela pergunta isso ao banco (`public.calendly_agenda_do_link`, só
 *    na Imova) e, fora disso, não fala do Calendly.
 *
 * 3. REMARCAR UMA REUNIÃO DO CALENDLY. O CRM cancela o agendamento do cliente lá
 *    (`calendly_cancelamentos_pendentes`), e o Calendly manda a ele, por e-mail, a
 *    frase fixa de que a casa remarcou e vai combinar o novo horário. Quem remarca
 *    precisa saber disso antes, para avisar o cliente do horário novo.
 */
import { EMPRESA } from '@/lib/empresa';

import type { Compromisso, NaturezaDoCompromisso } from './tipos';
import { seguraHorario } from './tipos';

/** O e-mail de reunião está ligado nesta empresa. */
export const EMAIL_DE_REUNIAO: boolean = EMPRESA.modulos.emailDeReuniao;

// ---------------------------------------------------------------------------
// 1. O e-mail do time
// ---------------------------------------------------------------------------

/** " O time é avisado por e-mail." onde há e-mail; nada onde não há. */
export function fraseDoEmail(emailLigado: boolean = EMAIL_DE_REUNIAO): string {
  return emailLigado ? ' O time é avisado por e-mail.' : '';
}

/** O recado depois de cancelar uma reunião. */
export function recadoDeReuniaoCancelada(emailLigado: boolean = EMAIL_DE_REUNIAO): string {
  return `Reunião cancelada.${fraseDoEmail(emailLigado)}`;
}

/** O recado depois de remarcar: na do Calendly, o que o cliente recebe. */
export function recadoDeReuniaoRemarcada(
  peloCalendly: boolean,
  emailLigado: boolean = EMAIL_DE_REUNIAO,
): string {
  const doCalendly = peloCalendly
    ? ' O Calendly avisa o cliente que o horário vai ser combinado de novo: mande o novo pelo WhatsApp.'
    : '';
  return `Reunião remarcada.${fraseDoEmail(emailLigado)}${doCalendly}`;
}

// ---------------------------------------------------------------------------
// 2. A agenda que o link do Calendly oferece
// ---------------------------------------------------------------------------

/** O que `public.calendly_agenda_do_link()` devolve, já conferido. */
export type AgendaDoLink = {
  /** De quem é a agenda que o link oferece (e que o espelho copia no Google). */
  pessoaId: string | null;
  /** `app_settings['calendly'].google_agenda_id` preenchido: o espelho está ligado. */
  espelhoLigado: boolean;
};

/** Lê a resposta do banco sem confiar na forma. Nulo quando não é a resposta esperada. */
export function lerAgendaDoLink(valor: unknown): AgendaDoLink | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null;
  const v = valor as Record<string, unknown>;
  return {
    pessoaId: typeof v.pessoa_id === 'string' && v.pessoa_id !== '' ? v.pessoa_id : null,
    espelhoLigado: v.espelho_ligado === true,
  };
}

/**
 * A frase do efeito no Calendly ao cancelar (ou excluir) o que a EQUIPE marcou.
 * Nula quando o Calendly não tem nada a ver com o compromisso: veio do próprio
 * Calendly (esse tem a frase dele), está noutra agenda, ou o espelho está
 * desligado (aí o Calendly nunca escondeu o horário).
 */
export function efeitoDeCancelarNoCalendly(
  c: Pick<Compromisso, 'peloCalendly' | 'responsavelId'> & { natureza: NaturezaDoCompromisso },
  agenda: AgendaDoLink | null,
): string | null {
  if (c.peloCalendly || !agenda?.espelhoLigado || agenda.pessoaId !== c.responsavelId) return null;
  return seguraHorario(c)
    ? 'O bloco "Ocupado" sai do Google Agenda, e o horário volta a ficar livre para o cliente no Calendly.'
    : 'Ele não segurava horário, então nada muda no Calendly.';
}

/**
 * O que se marca na agenda desta pessoa some do link do Calendly (o "Novo
 * compromisso" diz isso, como no protótipo): a agenda é a que o link oferece e o
 * espelho está ligado.
 */
export function marcarSomeDoLink(pessoaId: string, agenda: AgendaDoLink | null): boolean {
  return agenda?.espelhoLigado === true && agenda.pessoaId === pessoaId;
}

/** A frase do "Novo compromisso" na agenda que o link oferece. */
export const MARCADO_SOME_DO_LINK =
  'Marcado aqui, o CRM grava um bloco "Ocupado" no Google Agenda que o Calendly confere, e o horário some para o cliente no link.';

// ---------------------------------------------------------------------------
// 3. Remarcar uma reunião do Calendly
// ---------------------------------------------------------------------------

/**
 * O aviso da folha de remarcar quando o cliente marcou pelo Calendly. A frase entre
 * aspas é a que o CRM manda o Calendly dizer (`calendly_cancelamentos_pendentes`,
 * reunião `remarcada`).
 */
export function avisoAoRemarcarDoCalendly(nomeDaEmpresa: string = EMPRESA.nome): string {
  return `O cliente marcou esta reunião pelo Calendly. Remarcar aqui cancela o agendamento dele lá, e o Calendly manda a ele por e-mail: "A ${nomeDaEmpresa} remarcou este compromisso e vai combinar o novo horário com você." Depois de remarcar, mande o horário novo pelo WhatsApp.`;
}

// ---------------------------------------------------------------------------
// 4. O conflito do "Novo compromisso"
// ---------------------------------------------------------------------------

/** Um compromisso que já ocupa o horário pedido, com a origem quando se sabe. */
export type ConflitoComOrigem = {
  tipo: 'reuniao' | 'visita';
  titulo: string;
  inicio: string;
  /** Veio do cliente, pelo link do Calendly (`tasks.origin = 'calendly'`). */
  peloCalendly: boolean;
};

/** "Visita: Maria (marcado pelo Calendly)", como no protótipo aprovado. */
export function rotuloDoConflito(c: Pick<ConflitoComOrigem, 'titulo' | 'peloCalendly'>): string {
  return c.peloCalendly ? `${c.titulo} (marcado pelo Calendly)` : c.titulo;
}

/**
 * Marca, entre os conflitos que o banco devolveu, os que vieram do Calendly: os que
 * começam no mesmo instante de uma tarefa do Calendly da mesma pessoa. A
 * comparação é pelo instante, e não pelo texto: o banco devolve `+00:00`.
 */
export function comOrigem(
  conflitos: readonly { tipo: 'reuniao' | 'visita'; titulo: string; inicio: string }[],
  iniciosDoCalendly: readonly string[],
): ConflitoComOrigem[] {
  const doCalendly = new Set(iniciosDoCalendly.map((iso) => Date.parse(iso)));
  return conflitos.map((c) => ({ ...c, peloCalendly: doCalendly.has(Date.parse(c.inicio)) }));
}

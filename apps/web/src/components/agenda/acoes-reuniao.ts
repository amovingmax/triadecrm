'use client';

import { createClient } from '@/lib/supabase/client';

import { diaDoInstante, horaEmNatal, type Dia } from './tipos';

/**
 * As quatro portas de reunião que `authenticated` executa (ADR-15).
 *
 * Nenhuma regra mora aqui: confirmar, cancelar, remarcar e fechar são funções
 * `security definer` em `public`, que conferem papel, visibilidade da ficha e
 * estado antes de escrever. Este arquivo monta argumento e traduz o que volta.
 *
 * E é de propósito que a IA não tenha nenhuma delas: `service_role` está
 * revogado nas quatro. Na Fase 4 o robô ganha `reuniao_horarios` e
 * `reuniao_marcar`, e nada mais — corrigir uma reunião é de gente.
 */

export type ResultadoDaAcao = { ok: true } | { ok: false; motivo: string };

const RECADO: Record<string, string> = {
  nao_existe: 'Esta reunião não existe mais.',
  sem_permissao: 'Seu perfil não pode mexer nesta reunião.',
  nao_esta_a_confirmar: 'Esta reunião já foi confirmada.',
  estado_invalido: 'Esta reunião já foi fechada.',
  ja_fechada: 'Esta reunião já foi fechada.',
  horario_indisponivel: 'Esse horário não está mais livre.',
  horario_tomado: 'Esse horário acabou de ser ocupado.',
  sem_sala: 'Quem atende ainda não cadastrou a sala de reunião em Ajustes.',
  suprimido: 'Este parceiro pediu para não ser contatado.',
  negocio_invisivel: 'Seu perfil não vê o negócio deste parceiro.',
  negocio_nao_existe: 'O negócio deste parceiro não existe mais. Recarregue a agenda.',
  sem_dono: 'O negócio deste parceiro não tem responsável. Defina um na ficha antes de marcar.',
  sem_lugar: 'Reunião presencial precisa do endereço.',
  formato_invalido: 'Escolha se a reunião é on-line ou presencial.',
  nao_acompanha: 'Você só marca na sua agenda ou na de quem você acompanha.',
  horario_ocupado: 'Essa pessoa já tem compromisso nesse horário.',
  no_passado: 'Esse horário já passou.',
  dia_nao_util: 'Sábado, domingo e feriado não recebem compromisso. Escolha um dia útil.',
};

export function recadoDoMotivo(motivo: string): string {
  return RECADO[motivo] ?? 'Não deu para falar com o servidor.';
}

async function chamar(nome: string, args: Record<string, unknown>): Promise<ResultadoDaAcao> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(nome, args);
  if (error) return { ok: false, motivo: 'erro_do_servidor' };
  const r = (data ?? {}) as { ok?: boolean; motivo?: string };
  return r.ok === true ? { ok: true } : { ok: false, motivo: r.motivo ?? 'erro_do_servidor' };
}

export function confirmarReuniao(reuniaoId: string): Promise<ResultadoDaAcao> {
  return chamar('reuniao_confirmar', { p_id: reuniaoId });
}

export function cancelarReuniao(reuniaoId: string, motivo?: string): Promise<ResultadoDaAcao> {
  return chamar('reuniao_cancelar', { p_id: reuniaoId, p_motivo: motivo ?? null });
}

export function remarcarReuniao(
  reuniaoId: string,
  novoInicio: string,
): Promise<ResultadoDaAcao> {
  return chamar('reuniao_remarcar', { p_id: reuniaoId, p_novo_inicio: novoInicio });
}

export type HorarioLivre = { inicio: string; fim: string; quandoPorExtenso: string };

/**
 * Os horários livres de um dia, pela MESMA grade que o robô usa
 * (`app.reuniao_horarios_livres`).
 *
 * Pessoa e robô escolhendo da mesma grade não é elegância: é a única forma de a
 * grade continuar verdadeira. Se a tela oferecesse a tarde de um dia com rota
 * planejada, o teto de 4 e o bloqueio da rota viravam ficção na primeira semana.
 */
export async function livresDoDia(dia: Dia, donoId?: string): Promise<HorarioLivre[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('reuniao_livres', {
    p_dia: dia,
    p_dono: donoId ?? null,
  });
  if (error) return [];
  const r = (data ?? {}) as { ok?: boolean; horarios?: unknown };
  if (r.ok !== true || !Array.isArray(r.horarios)) return [];
  return r.horarios.flatMap((linha) => {
    const l = (linha ?? {}) as Record<string, unknown>;
    if (typeof l.inicio !== 'string' || typeof l.fim !== 'string') return [];
    return [
      {
        inicio: l.inicio,
        fim: l.fim,
        quandoPorExtenso:
          typeof l.quando_por_extenso === 'string' ? l.quando_por_extenso : l.inicio,
      },
    ];
  });
}

/** "10h20–11h00", para o chip da tira de livres e para a folha de remarcar. */
export function faixaDoHorario(h: HorarioLivre): string {
  return `${horaEmNatal(h.inicio).replace(':', 'h')}–${horaEmNatal(h.fim).replace(':', 'h')}`;
}

/** O dia civil de um horário livre, em Natal. */
export function diaDoHorario(h: HorarioLivre): Dia {
  return diaDoInstante(h.inicio);
}

export type ResultadoDeMarcar =
  | { ok: true }
  | { ok: false; motivo: string; alternativas: HorarioLivre[] };

function horariosDe(lista: unknown): HorarioLivre[] {
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((linha) => {
    const l = (linha ?? {}) as Record<string, unknown>;
    if (typeof l.inicio !== 'string' || typeof l.fim !== 'string') return [];
    return [
      {
        inicio: l.inicio,
        fim: l.fim,
        quandoPorExtenso:
          typeof l.quando_por_extenso === 'string' ? l.quando_por_extenso : l.inicio,
      },
    ];
  });
}

/**
 * Marca uma reunião pela Agenda: `public.reuniao_marcar_na_agenda`.
 *
 * É a MESMA gravação do robô (`app.reuniao_gravar`): mesma grade, mesma trava de
 * colisão, mesmo e-mail ao dono, mesma `tasks` de eco. A diferença é de quem é a
 * agenda: sem `donoId`, a de quem marca; com ele, a de alguém que quem marca
 * acompanha (o banco confere — `app.pode_marcar_para`) — e essa pessoa ganha um
 * aviso em `agenda_avisos`.
 *
 * Quando o horário foi tomado no meio do caminho, a função recusa e devolve as
 * próximas opções livres no mesmo retorno; a folha mostra essas opções.
 */
export async function marcarReuniao(p: {
  dealId: string;
  inicio: string;
  formato: 'online' | 'presencial';
  local: string | null;
  observacao: string | null;
  donoId: string | null;
}): Promise<ResultadoDeMarcar> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('reuniao_marcar_na_agenda', {
    p_deal_id: p.dealId,
    p_inicio: p.inicio,
    p_formato: p.formato,
    p_local: p.local ?? undefined,
    p_observacao: p.observacao ?? undefined,
    p_dono: p.donoId ?? undefined,
  });
  if (error) return { ok: false, motivo: 'erro_do_servidor', alternativas: [] };
  const r = (data ?? {}) as { ok?: boolean; motivo?: string; alternativas?: unknown };
  return r.ok === true
    ? { ok: true }
    : {
        ok: false,
        motivo: r.motivo ?? 'erro_do_servidor',
        alternativas: horariosDe(r.alternativas),
      };
}

/** Um compromisso que já ocupa o horário pedido para a visita. */
export type ConflitoDeVisita = { tipo: 'reuniao' | 'visita'; titulo: string; inicio: string };

export type ResultadoDeVisita =
  | { ok: true }
  | { ok: false; motivo: string; conflitos: ConflitoDeVisita[] };

/**
 * Marca uma visita: `public.visita_marcar`, na agenda de quem marca ou de quem
 * ela acompanha. O banco recusa (`horario_ocupado`) quando a pessoa já tem
 * reunião viva ou outra tarefa de campo naquele horário, e devolve com o quê
 * bateu. Sem hora de fim e sem local gravados: a `tasks` da main não tem essas
 * colunas (decisão pendente, item 4 do plano).
 */
export async function marcarVisita(p: {
  organizationId: string;
  dealId: string | null;
  inicio: string;
  donoId: string | null;
}): Promise<ResultadoDeVisita> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('visita_marcar', {
    p_organization_id: p.organizationId,
    p_inicio: p.inicio,
    p_deal_id: p.dealId ?? undefined,
    p_dono: p.donoId ?? undefined,
  });
  if (error) return { ok: false, motivo: 'erro_do_servidor', conflitos: [] };
  const r = (data ?? {}) as { ok?: boolean; motivo?: string; conflitos?: unknown };
  if (r.ok === true) return { ok: true };
  const conflitos = Array.isArray(r.conflitos)
    ? r.conflitos.flatMap((c) => {
        const l = (c ?? {}) as Record<string, unknown>;
        return typeof l.titulo === 'string' && typeof l.inicio === 'string'
          ? [{ tipo: l.tipo === 'visita' ? ('visita' as const) : ('reuniao' as const), titulo: l.titulo, inicio: l.inicio }]
          : [];
      })
    : [];
  return { ok: false, motivo: r.motivo ?? 'erro_do_servidor', conflitos };
}

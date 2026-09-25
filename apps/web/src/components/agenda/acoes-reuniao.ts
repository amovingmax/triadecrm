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

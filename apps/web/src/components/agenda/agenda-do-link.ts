'use client';

import { useQuery } from '@tanstack/react-query';

import { EMPRESA } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/client';

import { lerAgendaDoLink, type AgendaDoLink } from './efeito-no-calendly';

/**
 * A agenda que o link do Calendly oferece, e se o espelho no Google está ligado
 * (`public.calendly_agenda_do_link`, migração 20261111211000, só na Imova). Serve
 * para o diálogo de cancelar dizer o efeito no Calendly só quando ele existe.
 *
 * Fora da Imova não vai ao banco. Banco sem a função, ou erro: nulo, e a tela só
 * deixa de falar do Calendly (é um aviso, não uma trava).
 */
async function buscarAgendaDoLink(): Promise<AgendaDoLink | null> {
  const { data, error } = await createClient().rpc('calendly_agenda_do_link');
  return error ? null : lerAgendaDoLink(data);
}

export function useAgendaDoLink(ligado = true): AgendaDoLink | null {
  const consulta = useQuery({
    queryKey: ['agenda', 'calendly', 'agenda-do-link'],
    queryFn: buscarAgendaDoLink,
    enabled: ligado && EMPRESA.modulos.calendly,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return consulta.data ?? null;
}

/**
 * Os instantes das tarefas do Calendly de uma pessoa entre dois instantes, para o
 * conflito do "Novo compromisso" dizer "(marcado pelo Calendly)". Sob a RLS de
 * quem lê, a mesma que deixa a Agenda abrir a agenda dessa pessoa. Erro vira lista
 * vazia: o conflito aparece do mesmo jeito, só sem a origem.
 */
export async function iniciosDoCalendly(
  donoId: string,
  de: string,
  ate: string,
): Promise<string[]> {
  if (!EMPRESA.modulos.calendly) return [];
  const { data, error } = await createClient()
    .from('tasks')
    .select('due_at')
    .eq('assignee_id', donoId)
    .eq('origin', 'calendly')
    .in('status', ['todo', 'doing'])
    .gte('due_at', de)
    .lte('due_at', ate);
  if (error || !data) return [];
  return data.flatMap((t) => (t.due_at ? [t.due_at] : []));
}

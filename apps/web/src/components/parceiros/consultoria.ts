/**
 * Mandar para a Consultoria pelo botão de Prospectados (14/10/2026).
 *
 * O pedido: "coloque um botão que eu consiga direcionar leads em prospectados
 * para a aba de consultorias em conversas, não sei como isso tá funcionando".
 *
 * Como funcionava: a aba Consultoria de Conversas mostrava só quem FECHOU —
 * negócio ganho ou etapa de cliente (na prática, "Publicado" no funil de
 * fornecedor). Não havia como pôr alguém lá sem fechar o negócio.
 *
 * O que muda: uma MARCA (`public.consultoria`, migração `20261014100000`),
 * posta e tirada por `consultoria_marcar`. Ela não mexe na etapa e não conta
 * como publicado em relatório nem em meta: é só "este parceiro é atendido pela
 * Consultoria". Quem tem negócio ganho continua lá sem precisar da marca.
 */
import { createClient } from '@/lib/supabase/client';

/** Chave da consulta de quem está marcado (TanStack Query). */
export const CHAVE_CONSULTORIA = ['parceiros-consultoria'] as const;

/** Onde a aba mora: a lista de Conversas, aberta direto nela. */
export const HREF_CONSULTORIA = '/conversas?aba=consultoria';

/** Quem tem a marca. A tabela é pequena (uma linha por parceiro marcado). */
export async function carregarConsultoria(): Promise<ReadonlySet<string>> {
  const supabase = createClient();
  const { data, error } = await supabase.from('consultoria').select('organization_id').limit(5000);
  if (error) throw error;
  return new Set((data ?? []).map((c) => c.organization_id));
}

export type ResultadoDaConsultoria = { ok: true; mudaram: number } | { ok: false; motivo: string };

export async function marcarConsultoria(
  ids: readonly string[],
  sim: boolean,
): Promise<ResultadoDaConsultoria> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('consultoria_marcar', {
    p_organization_ids: [...ids],
    p_sim: sim,
  });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, motivo: 'falhou' };
  }
  const r = data as { ok?: boolean; mudaram?: number; motivo?: string };
  return r.ok ? { ok: true, mudaram: r.mudaram ?? 0 } : { ok: false, motivo: r.motivo ?? 'falhou' };
}

const RECUSA: Record<string, string> = {
  sem_permissao: 'Seu perfil não mexe na Consultoria. Isso é de admin e gestor.',
  muitos_de_uma_vez: 'São muitos de uma vez. Mande no máximo 200 por pedido.',
  nada_escolhido: 'Escolha pelo menos um parceiro.',
};

export function recadoDaConsultoria(motivo: string): string {
  return RECUSA[motivo] ?? 'Não deu certo. Tente de novo em instantes.';
}

/** O aviso depois do clique. Pura, para caber em teste. */
export function avisoDaConsultoria(sim: boolean, pedidos: number, mudaram: number): string {
  if (sim) {
    if (mudaram === 0)
      return pedidos === 1 ? 'Já estava na Consultoria.' : 'Todos já estavam na Consultoria.';
    return mudaram === 1 ? 'Na Consultoria.' : `${mudaram} parceiros na Consultoria.`;
  }
  if (mudaram === 0)
    return pedidos === 1 ? 'Não estava na Consultoria.' : 'Nenhum estava na Consultoria.';
  return mudaram === 1 ? 'Saiu da Consultoria.' : `${mudaram} parceiros saíram da Consultoria.`;
}

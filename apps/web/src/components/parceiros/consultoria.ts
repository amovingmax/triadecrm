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
import { EMPRESA } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/client';
import { ehTipoDeParceria, TIPOS_DE_PARCERIA } from '@/components/conversas/perfil-regra';
import type { TipoDeParceria } from '@/components/conversas/tipos';

/**
 * Na Imova, desde 23/11/2026, a marca é o perfil de Parceiro (Clientes e
 * Parceiros, em Conversas), e os textos daqui falam disso. Na KOMUNE, os de
 * sempre.
 */
export const MARCA_E_PARCEIRO: boolean = EMPRESA.modulos.clientesEParceiros;

/** Chave da consulta de quem está marcado (TanStack Query). */
export const CHAVE_CONSULTORIA = ['parceiros-consultoria'] as const;

/** Onde a aba mora: a lista de Conversas, aberta direto nela. */
export const HREF_CONSULTORIA = '/conversas?aba=consultoria';

/** O nome do botão de pôr a marca. */
export const ROTULO_DE_MARCAR = MARCA_E_PARCEIRO
  ? 'Mudar para Parceiro'
  : 'Mandar para a Consultoria';

/**
 * Quem tem a marca, e com que tag (Imova, 23/11/2026; na KOMUNE a tag é sempre
 * nula). A tabela é pequena (uma linha por parceiro marcado).
 */
export async function carregarConsultoria(): Promise<ReadonlyMap<string, TipoDeParceria | null>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('consultoria')
    .select('organization_id, tipo')
    .limit(5000);
  if (error) throw error;
  return new Map(
    (data ?? []).map((c) => [c.organization_id, ehTipoDeParceria(c.tipo) ? c.tipo : null]),
  );
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

/**
 * Põe vários em Parceiros com a mesma tag, ou troca a tag de quem já é (Imova,
 * 23/11/2026: `public.parceiros_marcar`). Tirar continua em `marcarConsultoria`.
 */
export async function marcarParceirosComTag(
  ids: readonly string[],
  tipo: TipoDeParceria,
): Promise<ResultadoDaConsultoria> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('parceiros_marcar', {
    p_organization_ids: [...ids],
    p_tipo: tipo,
  });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, motivo: 'falhou' };
  }
  const r = data as { ok?: boolean; mudaram?: number; motivo?: string };
  return r.ok ? { ok: true, mudaram: r.mudaram ?? 0 } : { ok: false, motivo: r.motivo ?? 'falhou' };
}

const RECUSA: Record<string, string> = {
  sem_permissao: MARCA_E_PARCEIRO
    ? 'Seu perfil não muda o perfil de contatos. Fale com um gestor.'
    : 'Seu perfil não mexe na Consultoria. Isso é de admin e gestor.',
  muitos_de_uma_vez: 'São muitos de uma vez. Mande no máximo 200 por pedido.',
  nada_escolhido: 'Escolha pelo menos um parceiro.',
  falta_a_tag: 'Escolha a tag do Parceiro: Proprietário, Colaborador ou Inquilino.',
  tipo_invalido: 'Escolha uma das três tags: Proprietário, Colaborador ou Inquilino.',
};

export function recadoDaConsultoria(motivo: string): string {
  return RECUSA[motivo] ?? 'Não deu certo. Tente de novo em instantes.';
}

/** O aviso depois do clique. Pura, para caber em teste. */
export function avisoDaConsultoria(sim: boolean, pedidos: number, mudaram: number): string {
  if (MARCA_E_PARCEIRO) return avisoDoParceiro(sim, pedidos, mudaram);
  if (sim) {
    if (mudaram === 0)
      return pedidos === 1 ? 'Já estava na Consultoria.' : 'Todos já estavam na Consultoria.';
    return mudaram === 1 ? 'Na Consultoria.' : `${mudaram} parceiros na Consultoria.`;
  }
  if (mudaram === 0)
    return pedidos === 1 ? 'Não estava na Consultoria.' : 'Nenhum estava na Consultoria.';
  return mudaram === 1 ? 'Saiu da Consultoria.' : `${mudaram} parceiros saíram da Consultoria.`;
}

/** O mesmo aviso, na Imova: o perfil de Parceiro (23/11/2026). */
export function avisoDoParceiro(sim: boolean, pedidos: number, mudaram: number): string {
  if (sim) {
    if (mudaram === 0) return pedidos === 1 ? 'Já era Parceiro.' : 'Todos já eram Parceiros.';
    return mudaram === 1 ? 'Agora é Parceiro.' : `${mudaram} contatos agora são Parceiros.`;
  }
  if (mudaram === 0) return pedidos === 1 ? 'Já era Cliente.' : 'Nenhum era Parceiro.';
  return mudaram === 1 ? 'Voltou para Clientes.' : `${mudaram} contatos voltaram para Clientes.`;
}

/** O aviso de pôr a tag em vários (Imova, 23/11/2026). Pura, para caber em teste. */
export function avisoDaTag(tipo: TipoDeParceria, pedidos: number, mudaram: number): string {
  const t = TIPOS_DE_PARCERIA.find((x) => x.id === tipo);
  const rotulo = t?.rotulo ?? tipo;
  const plural = t?.plural ?? tipo;
  if (mudaram === 0) return pedidos === 1 ? `Já era ${rotulo}.` : `Todos já eram ${plural}.`;
  return mudaram === 1
    ? `Agora é Parceiro: ${rotulo}.`
    : `${mudaram} contatos agora são Parceiros: ${plural}.`;
}

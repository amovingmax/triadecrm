/**
 * O que a tela de Leads dos portais pede ao banco (05/11/2026), só na Imova.
 *
 * A lista é `public.portal_leads_na_lista` (migração 20261105130000: roda com os
 * direitos do dono, mostra só a admin, gestor e SDR, e mascara o telefone para o
 * SDR). As ações são funções do Postgres que conferem quem pode e devolvem
 * `{ ok, motivo }`: assumir (`public.portal_lead_assumir`) e mudar a situação
 * (`public.portal_lead_mudar`). O telefone de quem ainda não tem ficha se revela
 * por `public.portal_lead_revelar_telefone`, que fica registrado.
 * Nada daqui manda mensagem: responder o lead é pela conversa, como sempre.
 */
import { createClient } from '@/lib/supabase/client';

import type { Resultado } from '../dados';
import type { LeadDoPortal, SituacaoDoLead } from './leads-rotulos';

export const CHAVE_DOS_LEADS = ['anuncios', 'leads'] as const;
export const CHAVE_DA_LISTA_DE_LEADS = [...CHAVE_DOS_LEADS, 'lista'] as const;
export const CHAVE_DOS_LEADS_NOVOS = [...CHAVE_DOS_LEADS, 'novos'] as const;

/**
 * Os mais recentes bastam: a Imova tem um plano de 10 anúncios, e o resumo e os
 * filtros correm no navegador. Passou disso, a lista diz que mostra só os últimos.
 */
export const TETO_DOS_LEADS = 1000;

const COLUNAS =
  'id, origem, origin_lead_id, origem_no_portal, client_listing_id, origin_listing_id, anuncio_id, anuncio_no_canal_pro_id, organization_id, tipos, temperatura, transacao, lead_certo, mcmv, mensagem, link_historico, recebido_no_portal_em, recebido_em, situacao, situacao_registrada, responsavel_id, responsavel_nome, motivo_descarte, situacao_em, situacao_por, suprimido, ficha_nome, nome_no_portal, phone_e164, email, phone_is_masked, anuncio_codigo, anuncio_titulo, conversation_id, grupo, chegou_por, chegou_em, primeira_mensagem, primeira_mensagem_tipo, respondido_em, respondido_por_nome, contato_apagado_em';

/** Os mais recentes primeiro, pela hora em que chegaram (a mensagem, ou o clique). */
export async function carregarLeads(): Promise<LeadDoPortal[]> {
  const { data, error } = await createClient()
    .from('portal_leads_na_lista')
    .select(COLUNAS)
    .order('chegou_em', { ascending: false, nullsFirst: false })
    .order('recebido_em', { ascending: false })
    .limit(TETO_DOS_LEADS);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeadDoPortal[];
}

/**
 * Quantos mandaram mensagem e estão sem resposta: o número ao lado de "Leads"
 * no alto de Anúncios. Quem só clicou não conta: não escreveu nada.
 */
export async function contarLeadsNovos(): Promise<number> {
  const { count, error } = await createClient()
    .from('portal_leads_na_lista')
    .select('id', { count: 'exact', head: true })
    .eq('grupo', 'mensagem')
    .eq('situacao', 'novo');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * O telefone inteiro de quem ainda não tem ficha (o que o portal mandou). Fica
 * em `pii_access_log`. Quem tem ficha revela pelo botão da ficha (`reveal_phone`).
 */
export async function revelarTelefoneDoLead(
  id: string,
): Promise<{ ok: true; telefone: string } | { ok: false; motivo: string }> {
  const { data, error } = await createClient().rpc('portal_lead_revelar_telefone', { p_id: id });
  if (error) return { ok: false, motivo: error.message };
  if (!data) return { ok: false, motivo: 'O portal não mandou o telefone, ou ele já foi apagado.' };
  return { ok: true, telefone: data };
}

/** O banco diz `sem_motivo` e `nao_encontrado` também para o anúncio; aqui é do lead. */
const DO_LEAD = new Set(['sem_motivo', 'nao_encontrado']);

function resultado(data: unknown, error: { message: string } | null): Resultado {
  if (error) return { ok: false, motivo: error.message };
  const r = (data ?? {}) as { ok?: boolean; motivo?: string };
  if (r.ok) return r as Resultado;
  const motivo = r.motivo ?? 'falhou';
  return { ok: false, motivo: DO_LEAD.has(motivo) ? `lead_${motivo}` : motivo };
}

/** Quem clica passa a responder pelo lead; o novo vira "em atendimento". */
export async function assumirLead(id: string): Promise<Resultado> {
  const { data, error } = await createClient().rpc('portal_lead_assumir', { p_id: id });
  return resultado(data, error);
}

/** Respondido, em atendimento, de volta a novo, ou descartado (com motivo). */
export async function mudarLead(
  id: string,
  situacao: SituacaoDoLead,
  motivo?: string,
): Promise<Resultado> {
  const { data, error } = await createClient().rpc('portal_lead_mudar', {
    p_id: id,
    p_situacao: situacao,
    ...(motivo ? { p_motivo: motivo } : {}),
  });
  return resultado(data, error);
}

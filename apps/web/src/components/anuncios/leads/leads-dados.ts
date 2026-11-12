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
import { ORIGEM_WHATSAPP, type LeadDoPortal, type SituacaoDoLead } from './leads-rotulos';

export const CHAVE_DOS_LEADS = ['anuncios', 'leads'] as const;
export const CHAVE_DA_LISTA_DE_LEADS = [...CHAVE_DOS_LEADS, 'lista'] as const;
export const CHAVE_DOS_LEADS_NOVOS = [...CHAVE_DOS_LEADS, 'novos'] as const;

/**
 * Os mais recentes bastam: a Imova tem um plano de 10 anúncios, e o resumo e os
 * filtros correm no navegador. Passou disso, a lista diz que mostra só os últimos.
 */
export const TETO_DOS_LEADS = 1000;

const COLUNAS =
  'id, origem, origin_lead_id, origem_no_portal, client_listing_id, origin_listing_id, anuncio_id, anuncio_no_canal_pro_id, organization_id, tipos, temperatura, transacao, lead_certo, mcmv, mensagem, link_historico, recebido_no_portal_em, recebido_em, situacao, situacao_registrada, responsavel_id, responsavel_nome, motivo_descarte, situacao_em, situacao_por, suprimido, ficha_nome, nome_no_portal, phone_e164, email, phone_is_masked, anuncio_codigo, anuncio_titulo, conversation_id, grupo, chegou_por, chegou_em, primeira_mensagem, primeira_mensagem_tipo, respondido_em, respondido_por_nome, contato_apagado_em, portal';

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

/** Um lead que escreveu pelo portal, para o aviso de lead novo (`vigia-de-leads.tsx`). */
export interface LeadQueEscreveu {
  readonly id: string;
  readonly escreveuEm: string;
  readonly tipos: readonly string[];
  readonly codigo: string | null;
}

/** Quantos o aviso lê de uma vez. Mais do que isso em 30 segundos vira "N leads novos". */
const TETO_DO_AVISO = 20;

/**
 * Os leads que escreveram pelo portal depois de `desde` (migração 20261111120000,
 * `portal_leads.escreveu_em`), sem os descartados e os suprimidos, do mais novo
 * para o mais velho. `null` = a leitura falhou: o vigia tenta de novo na próxima volta.
 *
 * O lead que nasce da conversa de WhatsApp (12/11/2026, `origem = 'whatsapp'`)
 * fica de fora: a mensagem dele já avisou pelo aviso de mensagem nova, e avisar
 * de novo como lead seria o mesmo contato duas vezes.
 */
export async function lerLeadsQueEscreveram(desde: string): Promise<LeadQueEscreveu[] | null> {
  const { data, error } = await createClient()
    .from('portal_leads')
    .select('id, escreveu_em, tipos, client_listing_id')
    .gt('escreveu_em', desde)
    .eq('suprimido', false)
    .neq('situacao', 'descartado')
    .neq('origem', ORIGEM_WHATSAPP)
    .order('escreveu_em', { ascending: false })
    .limit(TETO_DO_AVISO);
  if (error || !data) return null;
  return data.flatMap((l) =>
    l.escreveu_em
      ? [{ id: l.id, escreveuEm: l.escreveu_em, tipos: l.tipos ?? [], codigo: l.client_listing_id }]
      : [],
  );
}

/**
 * Quando escreveu o lead mais recente: a linha de base da primeira vez que o vigia
 * roda neste navegador (o que já estava lá não é novidade). `null` = nenhum lead
 * escreveu ainda; `undefined` = a leitura falhou. Sem o lead do WhatsApp, como
 * em `lerLeadsQueEscreveram`.
 */
export async function lerUltimoLeadQueEscreveu(): Promise<string | null | undefined> {
  const { data, error } = await createClient()
    .from('portal_leads')
    .select('escreveu_em')
    .not('escreveu_em', 'is', null)
    .neq('origem', ORIGEM_WHATSAPP)
    .order('escreveu_em', { ascending: false })
    .limit(1);
  if (error) return undefined;
  return data?.[0]?.escreveu_em ?? null;
}

/**
 * O nome de cada lead para o aviso: o da ficha, ou o que o portal mandou. Pela
 * lista (`portal_leads_na_lista`), que vale igual para gestão e SDR. Falhou, o
 * aviso sai sem o nome ("Alguém").
 */
export async function lerNomesDosLeads(ids: readonly string[]): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  if (ids.length === 0) return nomes;
  const { data, error } = await createClient()
    .from('portal_leads_na_lista')
    .select('id, ficha_nome, nome_no_portal')
    .in('id', [...ids]);
  if (error || !data) return nomes;
  for (const l of data) {
    const nome = (l.ficha_nome ?? l.nome_no_portal ?? '').trim();
    if (l.id && nome) nomes.set(l.id, nome);
  }
  return nomes;
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

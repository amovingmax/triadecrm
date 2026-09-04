import type { OrgKind, Temperature } from '@komune/schema';

import { createClient } from '@/lib/supabase/server';

/**
 * Leitura da ficha do parceiro, no servidor.
 *
 * Fonte: `public.organizations_view` (telefone mascarado por papel, RF-BAS-14) mais
 * as tabelas-filha. São consultas separadas em vez de um embed do PostgREST porque
 * `organizations_view` é uma view: o PostgREST não infere relação a partir dela, e
 * um embed que às vezes funciona é pior do que quatro consultas que sempre funcionam.
 */

export type NegocioDaFicha = {
  id: string;
  funil: string;
  etapa: string;
  status: string;
  temperatura: Temperature;
  precisaAtencao: boolean;
  responsavel: string | null;
  proximaAcao: string | null;
  proximaAcaoEm: string | null;
  ultimoContatoEm: string | null;
  naEtapaDesde: string;
  tier: string | null;
};

export type Ficha = {
  id: string;
  nome: string;
  razaoSocial: string | null;
  tipo: OrgKind;
  cnpj: string | null;
  telefone: string | null;
  telefoneMascarado: boolean;
  email: string | null;
  instagram: string | null;
  site: string | null;
  cidade: string | null;
  bairro: string | null;
  endereco: string | null;
  temperatura: Temperature;
  temperaturaManual: number | null;
  temperaturaMotivo: string | null;
  responsavel: string | null;
  categorias: string[];
  categoriaPrimaria: string | null;
  origem: string | null;
  origemUrl: string | null;
  coletadoEm: string;
  coletadoPor: string;
  pessoaFisica: boolean;
  vip: boolean;
  naoContatar: boolean;
  descricao: string | null;
  negocios: NegocioDaFicha[];
};

/** `null` quando a ficha não existe ou está fora do que o papel enxerga. */
export async function carregarFicha(id: string): Promise<Ficha | null> {
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations_view')
    // Uma string literal só: o supabase-js deduz o tipo do retorno a partir dela, e
    // uma concatenação em tempo de execução apagaria essa dedução.
    .select(
      'id, name, legal_name, kind, cnpj, phone_e164, phone_is_masked, email, instagram_handle, website, city_name, neighborhood, address, temperature, temperature_override, temperature_override_reason, owner_id, source_id, source_url, collected_at, collector, is_natural_person, vip, do_not_contact, description, primary_category_name',
    )
    .eq('id', id)
    .maybeSingle();

  if (!org) return null;

  const [categorias, negocios, origem, time] = await Promise.all([
    supabase
      .from('organization_categories')
      .select('is_primary, categories(name)')
      .eq('organization_id', id),
    supabase
      .from('deals')
      .select(
        'id, status, temperature, needs_attention, owner_id, next_action, next_action_at, last_activity_at, entered_stage_at, tier, stage_id, pipeline_id',
      )
      .eq('organization_id', id)
      .order('updated_at', { ascending: false }),
    org.source_id
      ? supabase.from('sources').select('name').eq('id', org.source_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('team_directory').select('id, full_name'),
  ]);

  const nomeDoTime = new Map((time.data ?? []).map((p) => [p.id, p.full_name]));

  const idsDeEtapa = [...new Set((negocios.data ?? []).map((d) => d.stage_id))];
  const { data: etapas } = idsDeEtapa.length
    ? await supabase.from('stages').select('id, name, pipeline_id').in('id', idsDeEtapa)
    : { data: [] };
  const { data: funis } = await supabase.from('pipelines').select('id, name');

  const etapaPorId = new Map((etapas ?? []).map((e) => [e.id, e.name]));
  const funilPorId = new Map((funis ?? []).map((f) => [f.id, f.name]));

  const listaDeCategorias = (categorias.data ?? [])
    // O PostgREST devolve o embed como lista mesmo quando a relação é para um só.
    .map((c) => {
      const ligado = Array.isArray(c.categories) ? c.categories[0] : c.categories;
      return { nome: ligado?.name ?? null, primaria: c.is_primary };
    })
    .filter((c): c is { nome: string; primaria: boolean } => c.nome !== null)
    // A primária primeiro: é a que responde "isso aqui é o quê?".
    .sort((a, b) => Number(b.primaria) - Number(a.primaria));

  return {
    id: org.id,
    nome: org.name,
    razaoSocial: org.legal_name,
    tipo: org.kind,
    cnpj: org.cnpj,
    telefone: org.phone_e164,
    telefoneMascarado: org.phone_is_masked ?? true,
    email: org.email,
    instagram: org.instagram_handle,
    site: org.website,
    cidade: org.city_name,
    bairro: org.neighborhood,
    endereco: org.address,
    temperatura: org.temperature,
    temperaturaManual: org.temperature_override,
    temperaturaMotivo: org.temperature_override_reason,
    responsavel: org.owner_id ? (nomeDoTime.get(org.owner_id) ?? null) : null,
    categorias: listaDeCategorias.map((c) => c.nome),
    categoriaPrimaria: org.primary_category_name,
    origem: origem.data?.name ?? null,
    origemUrl: org.source_url,
    coletadoEm: org.collected_at,
    coletadoPor: org.collector,
    pessoaFisica: org.is_natural_person,
    vip: org.vip,
    naoContatar: org.do_not_contact,
    descricao: org.description,
    negocios: (negocios.data ?? []).map((d) => ({
      id: d.id,
      funil: funilPorId.get(d.pipeline_id) ?? 'Funil',
      etapa: etapaPorId.get(d.stage_id) ?? 'Etapa',
      status: d.status,
      temperatura: d.temperature,
      precisaAtencao: d.needs_attention,
      responsavel: d.owner_id ? (nomeDoTime.get(d.owner_id) ?? null) : null,
      proximaAcao: d.next_action,
      proximaAcaoEm: d.next_action_at,
      ultimoContatoEm: d.last_activity_at,
      naEtapaDesde: d.entered_stage_at,
      tier: d.tier,
    })),
  };
}

/** Dias inteiros desde uma data ISO; `null` quando não há data. */
export function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Rótulo do status do negócio (enum `app.deal_status`). */
export const ROTULO_STATUS: Record<string, string> = {
  open: 'Em aberto',
  won: 'Ganho',
  lost: 'Perdido',
  paused: 'Pausado',
  nurturing: 'Em nutrição',
};

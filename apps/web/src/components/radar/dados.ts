/**
 * Idas ao banco do Radar, todas pelo cliente do navegador.
 *
 * O Postgres é quem manda: a fila, a criação e a decisão são funções `security
 * definer` (`radar_fila`, `radar_criar_candidato`, `radar_revisar_candidato`,
 * `radar_alternar_fonte`). Aqui só ficam a montagem dos argumentos, a tradução
 * do que volta e — o que mais importa nesta tela — a tradução do ERRO: quem
 * revisa nunca deve ler um código do Postgres.
 */
import { createClient } from '@/lib/supabase/client';

import {
  POR_PAGINA,
  type CandidatoDaFila,
  type FiltrosDaFila,
  type FonteDoRadar,
  type ResultadoDaFila,
  type ResumoDoRadar,
} from './tipos';

/** Chave de cache do TanStack Query para um recorte da fila. */
export function chaveDaFila(f: FiltrosDaFila) {
  return [
    'radar',
    'fila',
    f.situacao,
    f.fonteId,
    f.categoriaId,
    f.q.trim().toLowerCase(),
    f.soMarcados,
    f.pagina,
  ] as const;
}

export async function buscarFila(f: FiltrosDaFila): Promise<ResultadoDaFila> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_fila', {
    p_status: f.situacao,
    p_source_id: f.fonteId,
    p_category_id: f.categoriaId,
    p_q: f.q.trim() || null,
    p_so_marcados: f.soMarcados,
    p_limit: POR_PAGINA,
    p_offset: (f.pagina - 1) * POR_PAGINA,
  });

  if (error) throw new Error(error.message);

  const linhas = (data ?? []) as CandidatoDaFila[];
  return { linhas, total: linhas[0]?.total_count ?? 0 };
}

export async function buscarResumo(): Promise<ResumoDoRadar | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_resumo');
  if (error) throw new Error(error.message);
  return (data ?? null) as ResumoDoRadar | null;
}

// ---------------------------------------------------------------------------
// Catálogo de fontes
// ---------------------------------------------------------------------------

/** Leitura segura de um campo de `sources.config`, que é jsonb livre. */
function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}
function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}
function listaDeTexto(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : [];
}

export type LinhaDeFonte = {
  id: number;
  slug: string;
  name: string;
  kind: FonteDoRadar['tipo'];
  base_url: string | null;
  legal_basis: string;
  terms_notes: string | null;
  robots_ok: boolean | null;
  is_enabled: boolean;
  rate_limit_seconds: number | string;
  config: unknown;
};

export async function buscarFontes(): Promise<FonteDoRadar[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sources')
    .select(
      'id, slug, name, kind, base_url, legal_basis, terms_notes, robots_ok, is_enabled, rate_limit_seconds, config',
    )
    .order('id');

  if (error) throw new Error(error.message);

  return ((data ?? []) as LinhaDeFonte[]).map(paraFonte);
}

/**
 * Traduz uma linha de `sources` para a fonte que a tela mostra.
 *
 * Fica separada e exportada porque `config` é jsonb livre: cada uma das 11 fontes
 * traz um conjunto diferente de chaves (umas têm `fields_whitelist`, outras têm
 * `cnaes` ou `sites`, o Instagram tem `manual_curation`), e nenhuma delas é
 * garantida. Toda leitura passa por guarda de tipo, e o teste cobre justamente as
 * formas que faltam campo.
 */
export function paraFonte(linha: LinhaDeFonte): FonteDoRadar {
  const config = objeto(linha.config);
  const coletor = objeto(config.collector);

  return {
    id: linha.id,
    slug: linha.slug,
    nome: linha.name,
    tipo: linha.kind,
    base_url: linha.base_url,
    base_legal: linha.legal_basis,
    avaliacao: linha.terms_notes,
    robots_ok: linha.robots_ok,
    ligada: linha.is_enabled,
    intervalo_segundos: Number(linha.rate_limit_seconds) || 0,
    fase: texto(coletor.phase),
    coletor: texto(coletor.kind),
    periodicidade: texto(coletor.schedule),
    coletor_pronto: coletor.enabled === true,
    campos: listaDeTexto(config.fields_whitelist),
    robots_nota: texto(config.robots),
    curadoria_manual: config.manual_curation === true,
  };
}

// ---------------------------------------------------------------------------
// Escritas
// ---------------------------------------------------------------------------

export type NovoCandidato = {
  nome: string;
  fonteId: number;
  categoriaId: number | null;
  telefone: string;
  instagram: string;
  site: string;
  cnpj: string;
  bairro: string;
  cidadeId: number | null;
  origemUrl: string;
  observacao: string;
};

export type RespostaDeCriacao =
  | { criado: true; candidatoId: string; marcas: string[]; naoContatar: boolean }
  | { criado: false; motivo: string; candidatoId?: string };

export async function criarCandidato(v: NovoCandidato): Promise<RespostaDeCriacao> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_criar_candidato', {
    p_name: v.nome,
    p_source_id: v.fonteId,
    p_category_id: v.categoriaId,
    p_phone: v.telefone.trim() || null,
    p_instagram: v.instagram.trim() || null,
    p_website: v.site.trim() || null,
    p_cnpj: v.cnpj.trim() || null,
    p_neighborhood: v.bairro.trim() || null,
    p_city_id: v.cidadeId,
    p_source_url: v.origemUrl.trim() || null,
    p_notes: v.observacao.trim() || null,
  });

  if (error) throw new Error(error.message);

  const r = objeto(data);
  if (r.created === true) {
    return {
      criado: true,
      candidatoId: String(r.candidate_id),
      marcas: listaDeTexto(r.flags),
      naoContatar: r.do_not_contact === true,
    };
  }
  return {
    criado: false,
    motivo: texto(r.reason) ?? 'desconhecido',
    candidatoId: texto(r.candidate_id) ?? undefined,
  };
}

export type AcaoDeRevisao = 'aprovar' | 'mesclar' | 'recusar' | 'nao_contatar';

export type RespostaDeRevisao =
  | { ok: true; situacao: string; organizacaoId: string | null }
  | { ok: false; motivo: string; organizacaoId: string | null };

export async function revisarCandidato(args: {
  candidatoId: string;
  acao: AcaoDeRevisao;
  organizacaoId?: string | null;
  categoriaId?: number | null;
  motivo?: string | null;
}): Promise<RespostaDeRevisao> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_revisar_candidato', {
    p_candidate_id: args.candidatoId,
    p_acao: args.acao,
    p_organization_id: args.organizacaoId ?? null,
    p_category_id: args.categoriaId ?? null,
    p_reason: args.motivo ?? null,
  });

  if (error) throw new Error(error.message);

  const r = objeto(data);
  const organizacaoId = texto(r.organization_id);
  if (r.ok === true) {
    return { ok: true, situacao: texto(r.status) ?? 'revisado', organizacaoId };
  }
  return { ok: false, motivo: texto(r.reason) ?? 'desconhecido', organizacaoId };
}

export async function alternarFonte(
  fonteId: number,
  ligar: boolean,
): Promise<{ ok: boolean; motivo?: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_alternar_fonte', {
    p_source_id: fonteId,
    p_enabled: ligar,
  });

  if (error) throw new Error(error.message);

  const r = objeto(data);
  return r.ok === true ? { ok: true } : { ok: false, motivo: texto(r.reason) ?? 'desconhecido' };
}

// ---------------------------------------------------------------------------
// Tradução de erro e de motivo
// ---------------------------------------------------------------------------

/** O que deu errado ao falar com o servidor, em português e com uma saída. */
export function mensagemDoErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : '';
  if (/não trabalha a fila|não revisa|não cadastra|42501|permission/i.test(texto)) {
    return 'O seu acesso não trabalha a fila do Radar.';
  }
  if (/jwt|autenticad/i.test(texto)) return 'A sua sessão expirou.';
  if (/fetch|network|failed/i.test(texto)) return 'O aplicativo não alcançou o servidor.';
  return 'O servidor não respondeu como esperado.';
}

/** Motivos que a RPC de criação devolve, escritos para quem está cadastrando. */
export const MOTIVO_DA_CRIACAO: Record<string, string> = {
  nome_obrigatorio: 'Informe o nome do candidato.',
  origem_invalida: 'Essa origem não existe mais no catálogo de fontes.',
  origem_desabilitada: 'Essa fonte está desligada. Ligue-a na aba Fontes ou escolha outra.',
  categoria_invalida: 'Essa categoria não está mais ativa. Escolha outra.',
  cnpj_invalido: 'O CNPJ não fecha: confira os dígitos.',
  ja_esta_na_fila: 'Esse alvo já está esperando revisão na fila.',
};

/** Motivos que a RPC de revisão devolve. */
export const MOTIVO_DA_REVISAO: Record<string, string> = {
  candidato_inexistente: 'Esse candidato não existe mais.',
  ja_revisado: 'Alguém já revisou esse candidato. Atualize a fila.',
  motivo_obrigatorio: 'Escreva o motivo da recusa.',
  acao_invalida: 'Ação desconhecida.',
  candidato_nao_contatar:
    'Esse contato pediu para não ser procurado (RF-ADM-04). Ele não pode virar parceiro.',
  categoria_obrigatoria: 'Escolha a categoria antes de aprovar.',
  organizacao_obrigatoria: 'Escolha com qual ficha mesclar.',
  organizacao_inexistente: 'Essa ficha não existe mais.',
  organizacao_fora_da_carteira:
    'Mesclar altera a ficha, e essa ficha não é sua. Peça ao gestor para mesclar ou para transferir a ficha para você.',
  ja_existe_na_base: 'Esse alvo já está na base. Mescle com a ficha em vez de aprovar.',
};

/** Motivos que a RPC de ligar/desligar fonte devolve (RF-RAD-01). */
export const MOTIVO_DA_FONTE: Record<string, string> = {
  fonte_inexistente: 'Essa fonte não existe mais.',
  robots_nao_avaliado:
    'O robots.txt desta fonte ainda não foi avaliado. Sem essa checagem registrada a fonte não liga (RF-RAD-01).',
  robots_proibe_coleta: 'O robots.txt desta fonte proíbe a coleta. Ela não pode ser ligada.',
  termos_nao_avaliados: 'Os termos de uso desta fonte ainda não foram avaliados.',
};

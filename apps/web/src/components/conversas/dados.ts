import { createClient } from '@/lib/supabase/client';

import type { AtividadeCrua, HistoricoCru, NegocioCru, OrganizacaoCrua } from './montagem';

/**
 * As consultas da tela de Conversas, no navegador, sob a mesma RLS de todo o resto.
 *
 * ===========================================================================
 * POR QUE NÃO HÁ UMA RPC AQUI
 * ===========================================================================
 * A lista precisa ordenar 100 organizações pela interação mais recente, e o PostgREST
 * não faz `distinct on`. O caminho certo seria uma função no Postgres — mas o banco
 * desta entrega já está fechado e migrado, e abrir uma migração fora da numeração
 * reservada quebraria o trabalho paralelo dos outros módulos. Então a agregação é
 * feita no cliente, sobre três leituras pequenas, e o custo está medido e limitado:
 * a base real tem 100 organizações, 147 atividades e 100 negócios.
 *
 * Os tetos abaixo são o contrato honesto disso. Quando a base crescer (o Radar promete
 * ≥ 300 candidatos), o certo é trocar `carregarConversas` por uma RPC com
 * `distinct on (organization_id) … order by occurred_at desc` e paginação de verdade;
 * a tela não muda, só a origem dos dados. Enquanto isso, a interface AVISA quando
 * bateu no teto, em vez de mostrar uma lista incompleta sem dizer.
 */

/** Organizações lidas de uma vez. Acima disso a tela avisa que a lista está cortada. */
export const TETO_ORGANIZACOES = 500;

/** Atividades lidas de uma vez, só para ordenar a lista e escrever a prévia. */
export const TETO_ATIVIDADES = 3000;

/** Colunas da atividade usadas pela lista e pela linha do tempo. */
const COLUNAS_ATIVIDADE =
  'id, organization_id, deal_id, type, channel, author_kind, occurred_at, body, duration_min, user_id, outcome_id, metadata';

export type BaseDasConversas = {
  organizacoes: OrganizacaoCrua[];
  atividades: AtividadeCrua[];
  negocios: NegocioCru[];
  /** `true` quando alguma leitura bateu no teto: a tela precisa dizer isso. */
  cortada: boolean;
};

/** Chave da consulta da lista (TanStack Query). */
export const CHAVE_CONVERSAS = ['conversas', 'lista'] as const;

/** Chave da linha do tempo de um parceiro. */
export function chaveDaLinha(organizacaoId: string) {
  return ['conversas', 'linha', organizacaoId] as const;
}

export async function carregarConversas(): Promise<BaseDasConversas> {
  const supabase = createClient();

  const [organizacoes, atividades, negocios] = await Promise.all([
    supabase
      .from('organizations_view')
      .select(
        'id, name, primary_category_name, neighborhood, city_name, temperature, phone_e164, phone_is_masked, do_not_contact',
      )
      .is('deleted_at', null)
      .order('name')
      .limit(TETO_ORGANIZACOES),
    supabase
      .from('activities')
      .select(COLUNAS_ATIVIDADE)
      .not('organization_id', 'is', null)
      .order('occurred_at', { ascending: false })
      .limit(TETO_ATIVIDADES),
    supabase
      .from('deals')
      .select(
        'id, organization_id, stage_id, status, owner_id, needs_attention, next_action, next_action_at, updated_at',
      )
      .limit(TETO_ORGANIZACOES * 2),
  ]);

  const erro = organizacoes.error ?? atividades.error ?? negocios.error;
  if (erro) throw new Error(erro.message);

  return {
    organizacoes: organizacoes.data ?? [],
    atividades: atividades.data ?? [],
    negocios: negocios.data ?? [],
    cortada:
      (organizacoes.data?.length ?? 0) >= TETO_ORGANIZACOES ||
      (atividades.data?.length ?? 0) >= TETO_ATIVIDADES,
  };
}

export type LinhaDoParceiro = {
  atividades: AtividadeCrua[];
  historico: HistoricoCru[];
  negocios: NegocioCru[];
};

/**
 * A linha do tempo COMPLETA de um parceiro, lida quando a conversa abre.
 *
 * Não reaproveita as atividades da lista de propósito: aquelas passaram pelo teto de
 * 3000 e poderiam estar cortadas justamente no parceiro que a pessoa abriu. Aqui a
 * consulta é por organização, então o que aparece na coluna é o histórico inteiro.
 */
export async function carregarLinhaDoParceiro(organizacaoId: string): Promise<LinhaDoParceiro> {
  const supabase = createClient();

  const [atividades, negocios] = await Promise.all([
    supabase
      .from('activities')
      .select(COLUNAS_ATIVIDADE)
      .eq('organization_id', organizacaoId)
      .order('occurred_at', { ascending: true }),
    supabase
      .from('deals')
      .select(
        'id, organization_id, stage_id, status, owner_id, needs_attention, next_action, next_action_at, updated_at',
      )
      .eq('organization_id', organizacaoId),
  ]);

  const erro = atividades.error ?? negocios.error;
  if (erro) throw new Error(erro.message);

  const idsDeNegocio = (negocios.data ?? []).map((d) => d.id);
  const historico = idsDeNegocio.length
    ? await supabase
        .from('deal_stage_history')
        .select('id, deal_id, changed_at, from_stage_id, to_stage_id, changed_by, reason')
        .in('deal_id', idsDeNegocio)
        .order('changed_at', { ascending: true })
    : { data: [] as HistoricoCru[], error: null };

  if (historico.error) throw new Error(historico.error.message);

  return {
    atividades: atividades.data ?? [],
    negocios: negocios.data ?? [],
    historico: historico.data ?? [],
  };
}

/**
 * Traduz a falha para o que a pessoa pode fazer. Nunca o texto cru do Postgres:
 * "PGRST116" e "JWT expired" não dizem a ninguém que basta entrar de novo.
 */
export function mensagemDoErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : '';
  if (/jwt|autenticad|refresh/i.test(texto)) return 'A sua sessão expirou.';
  if (/permission|denied|rls|42501/i.test(texto)) return 'O seu acesso não alcança este parceiro.';
  if (/fetch|network|failed|abort/i.test(texto)) return 'O aplicativo não alcançou o servidor.';
  return 'O servidor não respondeu.';
}

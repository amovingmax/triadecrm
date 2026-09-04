'use client';

/**
 * A conversa da tela de funis com o Postgres (RF-FUN-01/03/04/08).
 *
 * Três RPCs e um catálogo, e nada mais: `pipeline_board` monta o quadro inteiro em
 * uma consulta (sem N+1), `move_deal` move o cartão com todas as validações do lado
 * do banco, `deal_stage_timeline` devolve o histórico de etapas e `lost_reasons` é a
 * lista fechada de motivos de perda.
 *
 * Duas regras que valem para o arquivo inteiro:
 *
 *  * **O banco decide.** A UI valida antes de mandar só para não fazer a pessoa
 *    esperar uma ida à rede por um campo vazio; a validação que conta é a do
 *    `move_deal`, que revalida tudo (RF-FUN-03/04) e é quem enxerga a etapa real do
 *    cartão, a lista de motivos ativa e a política de escrita.
 *  * **Recusa não é exceção.** `move_deal` devolve `{ok:false, reason}` para o que a
 *    pessoa pode corrigir e só levanta exceção em falha técnica. Por isso
 *    `moverNegocio` devolve `ResultadoMover` e não estoura: quem estoura aqui é
 *    apenas a rede, a sessão e o servidor.
 */
import type { Json } from '@komune/schema';

import { createClient } from '@/lib/supabase/client';

import {
  ehFunilDoQuadro,
  moverNegocioSchema,
  pedidoQuadroSchema,
  type ItemHistoricoEtapa,
  type PedidoMover,
  type PedidoQuadro,
  type Quadro,
  type ResultadoMover,
} from '../tipos';

/** Um motivo de perda do catálogo `lost_reasons` (RF-FUN-04; 9 itens na seed). */
export type MotivoDePerda = { id: number; nome: string };

/** Um funil do CRM, do jeito que o seletor da página precisa. */
export type FunilDisponivel = {
  id: number;
  slug: string;
  nome: string;
  /**
   * `false` para o funil de ativação: as etapas dele são consequência de eventos da
   * plataforma Komune (publicou, recebeu lead, contratou), não de trabalho manual —
   * o PRD §6 põe "Funil 2 automático por eventos da Komune" na v1. Ele aparece no
   * seletor porque existe e o time pergunta por ele; o que não aparece é um quadro
   * onde ninguém pode arrastar nada.
   */
  noQuadro: boolean;
};

/** Chave de cache do catálogo de funis. */
export const CHAVE_FUNIS_DISPONIVEIS = ['funis-disponiveis'] as const;

/**
 * Os funis do CRM, na ordem em que o seletor os mostra.
 *
 * `pipeline_board` recebe `p_pipeline_id` (int) e a URL guarda o slug: alguém precisa
 * traduzir um no outro. São três linhas com leitura liberada a todo autenticado
 * (`pipelines_select`), cacheadas por uma hora — funil não nasce durante o expediente.
 */
export async function carregarFunisDisponiveis(): Promise<FunilDisponivel[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('pipelines')
    .select('id, slug, name, position')
    .order('position', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((funil) => ({
    id: funil.id,
    slug: funil.slug,
    nome: funil.name,
    noQuadro: ehFunilDoQuadro(funil.slug),
  }));
}

/** Chave de cache do catálogo de motivos de perda. */
export const CHAVE_MOTIVOS_DE_PERDA = ['funil-motivos-de-perda'] as const;

/** Chave de cache do histórico de etapas de um negócio. */
export function chaveDoHistorico(dealId: string) {
  return ['funil-historico-etapas', dealId] as const;
}

/**
 * O quadro de um funil.
 *
 * `pipeline_board` devolve `jsonb` — um documento só, no formato de `Quadro`. O
 * supabase-js tipa isso como `Json`, então a asserção aqui é a fronteira: a forma
 * está fixada no contrato (`tipos.ts`) e é a MESMA que a migração escreve com
 * `jsonb_build_object`. Um `Quadro` sem `stages` seria defeito de migração, não de
 * dado, e por isso vira exceção em vez de tela vazia silenciosa.
 */
export async function carregarQuadro(pedido: PedidoQuadro): Promise<Quadro> {
  const supabase = createClient();
  const p = pedidoQuadroSchema.parse(pedido);

  const { data, error } = await supabase.rpc('pipeline_board', {
    p_pipeline_id: p.p_pipeline_id,
    p_only_mine: p.p_only_mine,
    p_owner_id: p.p_owner_id ?? undefined,
    p_q: p.p_q ?? undefined,
    p_stage_id: p.p_stage_id ?? undefined,
    p_limit_per_stage: p.p_limit_per_stage,
    p_offset: p.p_offset,
  });

  if (error) throw error;

  const quadro = data as unknown as Quadro | null;
  if (!quadro || !Array.isArray(quadro.stages)) {
    throw new Error('O quadro voltou sem etapas.');
  }
  return quadro;
}

/**
 * Move um cartão de etapa.
 *
 * O pedido passa pelo `moverNegocioSchema` antes de sair: é ele que normaliza o
 * motivo (espaços, tamanho), garante o formato da próxima ação e recusa data no
 * passado sem gastar uma ida à rede. Depois disso, quem manda é o banco.
 *
 * `p_expected_stage_id` é a guarda contra duas pessoas arrastando o mesmo cartão:
 * quando ele não bate com a etapa real, o banco devolve `etapa_mudou` com
 * `current_stage_id` e a tela recarrega o quadro em vez de sobrescrever o outro.
 */
export async function moverNegocio(pedido: PedidoMover): Promise<ResultadoMover> {
  const supabase = createClient();
  const p = moverNegocioSchema.parse(pedido);

  const { data, error } = await supabase.rpc('move_deal', {
    p_deal_id: p.p_deal_id,
    p_to_stage_id: p.p_to_stage_id,
    p_expected_stage_id: p.p_expected_stage_id ?? undefined,
    p_reason: p.p_reason ?? undefined,
    p_fields: p.p_fields as Json,
    p_next_action: (p.p_next_action ?? undefined) as Json | undefined,
  });

  if (error) throw error;

  const resultado = data as unknown as ResultadoMover | null;
  if (!resultado || typeof resultado.ok !== 'boolean') {
    throw new Error('O servidor respondeu sem dizer se moveu o cartão.');
  }
  return resultado;
}

/**
 * Catálogo de motivos de perda (RF-FUN-04).
 *
 * Só os ativos e na ordem que o gestor definiu: o `move_deal` recusa motivo inativo,
 * então oferecer um na lista seria oferecer um caminho que o banco fecha. É `select`
 * direto na tabela porque `lost_reasons_select` já libera leitura para todo
 * autenticado — não há RPC a inventar aqui.
 */
export async function carregarMotivosDePerda(): Promise<MotivoDePerda[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('lost_reasons')
    .select('id, name')
    .eq('is_active', true)
    .order('position', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((linha) => ({ id: linha.id, nome: linha.name }));
}

/**
 * Histórico de etapas de um negócio (RF-FUN-08), do mais recente para o mais antigo.
 * `changed_by_name` nulo é automação, IA ou sistema — a tela escreve "Sistema".
 */
export async function carregarHistorico(dealId: string): Promise<ItemHistoricoEtapa[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('deal_stage_timeline', { p_deal_id: dealId });

  if (error) throw error;
  return (data ?? []) as unknown as ItemHistoricoEtapa[];
}

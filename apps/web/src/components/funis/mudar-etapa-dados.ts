/**
 * Mudar a etapa de um parceiro FORA do quadro (14/10/2026).
 *
 * O pedido: "deixe a opção de selecionar em que etapa do funil o lead está na aba
 * de conversas e na aba de prospectados". Até aqui a etapa só mudava arrastando
 * o cartão em Funis — e, depois da limpeza de 14/10, quase todo mundo mora em
 * Prospectados, fora do quadro.
 *
 * Quem move continua sendo a FOLHA DO FUNIS (`acoes/folha-mover.tsx`), com tudo o
 * que ela já cobra: data e formato para "Reunião marcada", motivo para "Perdido",
 * a próxima ação para as etapas de trabalho, e o `move_deal` do banco por trás.
 * Este arquivo só monta, a partir do id do parceiro, o que ela recebe do quadro:
 * o cartão do negócio e as etapas do funil dele.
 */
import { createClient } from '@/lib/supabase/client';
import { diaEmFortaleza } from '@/components/registro/tipos';
import { escolherNegocio } from '@/components/conversas/montagem';

import type { CartaoQuadro, EstadoProximaAcao, EtapaQuadro } from './tipos';

/** O estado da próxima ação, pela mesma régua do banco (`app.deal_cards`): o dia em Natal. */
export function estadoDaProximaAcao(
  quando: string | null | undefined,
  agora: Date = new Date(),
): EstadoProximaAcao {
  if (!quando) return 'sem';
  const dia = diaEmFortaleza(new Date(quando));
  const hoje = diaEmFortaleza(agora);
  if (dia < hoje) return 'atrasada';
  if (dia === hoje) return 'hoje';
  return 'agendada';
}

/** O que a folha de mover precisa, ou o motivo de não haver o que mover. */
export type ParaMover =
  | { ok: true; cartao: CartaoQuadro; etapaAtualId: number; etapas: EtapaQuadro[] }
  | { ok: false; motivo: 'sem_negocio' | 'falhou' };

type NegocioCru = {
  id: string;
  organization_id: string;
  pipeline_id: number;
  stage_id: number;
  status: CartaoQuadro['status'];
  owner_id: string | null;
  tier: CartaoQuadro['tier'];
  score: number | null;
  temperature: CartaoQuadro['temperature'];
  needs_attention: boolean;
  last_channel: CartaoQuadro['last_channel'];
  entered_stage_at: string;
  last_activity_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  updated_at: string;
};

type EtapaCrua = Omit<EtapaQuadro, 'total' | 'cards' | 'required_fields'> & {
  required_fields: unknown;
};

/** O cartão do quadro montado a partir do negócio. Pura, para caber em teste. */
export function cartaoDoNegocio(
  negocio: NegocioCru,
  nome: string,
  etapa: Pick<EtapaQuadro, 'name' | 'position'>,
  agora: Date = new Date(),
): CartaoQuadro {
  const dias = (de: string | null) =>
    de ? Math.max(0, Math.floor((agora.getTime() - Date.parse(de)) / 86_400_000)) : null;
  return {
    deal_id: negocio.id,
    organization_id: negocio.organization_id,
    organization_name: nome,
    primary_category: null,
    city: null,
    neighborhood: null,
    owner_id: negocio.owner_id,
    owner_name: null,
    temperature: negocio.temperature,
    needs_attention: negocio.needs_attention,
    stage_name: etapa.name,
    stage_position: etapa.position,
    last_channel: negocio.last_channel,
    status: negocio.status,
    tier: negocio.tier,
    score: negocio.score,
    entered_stage_at: negocio.entered_stage_at,
    days_in_stage: dias(negocio.entered_stage_at) ?? 0,
    is_rotting: false,
    last_activity_at: negocio.last_activity_at,
    days_since_contact: dias(negocio.last_activity_at),
    next_action: negocio.next_action,
    next_action_at: negocio.next_action_at,
    next_action_state: estadoDaProximaAcao(negocio.next_action_at, agora),
    updated_at: negocio.updated_at,
  };
}

/**
 * O negócio em foco do parceiro (a mesma escolha da lista de Conversas: o aberto
 * mexido por último) e as etapas do funil dele, sem as aposentadas. A etapa de
 * entrada FICA na lista: é por ela que se devolve alguém a Prospectados.
 */
export async function carregarParaMover(organizacaoId: string, nome: string): Promise<ParaMover> {
  const supabase = createClient();
  const { data: negocios, error } = await supabase
    .from('deals')
    .select(
      'id, organization_id, pipeline_id, stage_id, status, owner_id, tier, score, temperature, needs_attention, last_channel, entered_stage_at, last_activity_at, next_action, next_action_at, updated_at',
    )
    .eq('organization_id', organizacaoId);
  if (error) return { ok: false, motivo: 'falhou' };
  const negocio = escolherNegocio((negocios ?? []) as NegocioCru[]);
  if (!negocio) return { ok: false, motivo: 'sem_negocio' };

  const { data: etapas, error: erroDasEtapas } = await supabase
    .from('stages')
    .select(
      'id, slug, name, position, temperature, sla_hours, is_won, is_lost, is_dormant, is_optout, is_terminal, required_fields',
    )
    .eq('pipeline_id', negocio.pipeline_id)
    .is('retired_at', null)
    .order('position');
  if (erroDasEtapas || !etapas) return { ok: false, motivo: 'falhou' };

  const lista: EtapaQuadro[] = (etapas as EtapaCrua[]).map((e) => ({
    ...e,
    required_fields: Array.isArray(e.required_fields)
      ? (e.required_fields as EtapaQuadro['required_fields'])
      : [],
    total: 0,
    cards: [],
  }));
  const atual = lista.find((e) => e.id === negocio.stage_id);
  if (!atual) return { ok: false, motivo: 'falhou' };

  return {
    ok: true,
    cartao: cartaoDoNegocio(negocio, nome, atual),
    etapaAtualId: negocio.stage_id,
    etapas: lista,
  };
}

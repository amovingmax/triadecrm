import type { DesfechoCatalogo } from './tipos';

/**
 * Desfechos de verdade, copiados de `supabase/seed.sql` (os 34 do catálogo,
 * `docs/design/spec-desfechos-de-interacao.md` §3).
 *
 * São fixtures e não invenção: cada linha aqui existe no banco com esses valores, e é
 * por isso que os testes conseguem afirmar coisas como "não atendeu volta amanhã" sem
 * um Postgres ligado. Se o gestor mudar o catálogo (RF-ADM-02), estes casos mudam
 * junto — o que a tela NÃO pode fazer é trazer a lista dentro do código.
 */
function desfecho(
  parcial: Partial<DesfechoCatalogo> &
    Pick<DesfechoCatalogo, 'id' | 'slug' | 'name' | 'surfaces' | 'position'>,
): DesfechoCatalogo {
  return {
    cooldown_days: 0,
    can_reactivate: true,
    next_action_kind: null,
    next_action_label: null,
    next_action_offset_days: null,
    target_stage_slug: null,
    sets_temperature: null,
    requires_lost_reason: false,
    counts_as: 'batida',
    ...parcial,
  };
}

/** "Não atendeu": o desfecho mais frequente da ligação. Cadência 1+1 do RF-CON-13. */
export const LIG_NAO_ATENDEU = desfecho({
  id: 8,
  slug: 'lig_nao_atendeu',
  name: 'Não atendeu',
  surfaces: ['ligacao'],
  position: 201,
  cooldown_days: 1,
  next_action_kind: 'call',
  next_action_label: 'Ligar D+1 (última)',
  next_action_offset_days: 1,
});

/** "Decisor interessado": tira o parceiro de Frio no mesmo toque. */
export const VIS_DECISOR_INTERESSADO = desfecho({
  id: 18,
  slug: 'vis_decisor_interessado',
  name: 'Decisor interessado',
  surfaces: ['visita'],
  position: 303,
  next_action_kind: 'meeting',
  next_action_label: 'Marcar apresentação ou link',
  target_stage_slug: 'em_conversa',
  sets_temperature: 'quente',
  counts_as: 'aberta',
});

/** "Respondeu": porta aberta em potencial, mas o nome não afirma com quem se falou. */
export const WA_RESPONDEU = desfecho({
  id: 2,
  slug: 'wa_respondeu',
  name: 'Respondeu',
  surfaces: ['whatsapp'],
  position: 102,
  next_action_kind: 'message',
  next_action_label: 'Responder em 15 min',
  next_action_offset_days: 0,
  target_stage_slug: 'respondeu',
  sets_temperature: 'morno',
  counts_as: 'aberta',
});

/** "Sem interesse": perda, e perda exige motivo (RF-FUN-04). */
export const LIG_SEM_INTERESSE = desfecho({
  id: 14,
  slug: 'lig_sem_interesse',
  name: 'Sem interesse',
  surfaces: ['ligacao'],
  position: 207,
  cooldown_days: 90,
  can_reactivate: false,
  target_stage_slug: 'perdido',
  requires_lost_reason: true,
  counts_as: 'aberta',
});

/** "Reunião marcada": a data vem do mundo, não da régua. */
export const LIG_REUNIAO_MARCADA = desfecho({
  id: 15,
  slug: 'lig_reuniao_marcada',
  name: 'Reunião marcada',
  surfaces: ['ligacao'],
  position: 208,
  next_action_kind: 'meeting',
  next_action_label: 'Reunião na data',
  target_stage_slug: 'reuniao_marcada',
  sets_temperature: 'quente',
  counts_as: 'aberta',
});

/** "Realizada, autorizou": o único desfecho que exige a frase literal (LGPD). */
export const REU_AUTORIZOU = desfecho({
  id: 23,
  slug: 'reu_autorizou',
  name: 'Realizada, autorizou',
  surfaces: ['reuniao'],
  position: 402,
  next_action_kind: 'message',
  next_action_label: 'Enviar link de cadastro',
  next_action_offset_days: 0,
  target_stage_slug: 'autorizou',
  sets_temperature: 'quente',
  counts_as: 'aberta',
});

/** "Pediu para parar": opt-out, cooldown permanente, sem volta (RF-CON-18). */
export const WA_OPTOUT = desfecho({
  id: 7,
  slug: 'wa_optout',
  name: 'Pediu para parar',
  surfaces: ['whatsapp'],
  position: 107,
  cooldown_days: 36500,
  can_reactivate: false,
  target_stage_slug: 'optout',
  sets_temperature: 'frio',
  counts_as: 'nenhuma',
});

/** "Agora não": cooldown de 30 dias, nutrição, e a próxima ação sai do offset. */
export const WA_AGORA_NAO = desfecho({
  id: 4,
  slug: 'wa_agora_nao',
  name: 'Agora não',
  surfaces: ['whatsapp'],
  position: 104,
  cooldown_days: 30,
  next_action_kind: 'message',
  next_action_label: 'Reativar com gancho',
  next_action_offset_days: 30,
  target_stage_slug: 'nutricao',
  sets_temperature: 'frio',
  counts_as: 'aberta',
});

/** "Atendeu, retorna depois": sem etapa alvo, e a data é a combinada com ele. */
export const LIG_ATENDEU_RETORNA = desfecho({
  id: 11,
  slug: 'lig_atendeu_retorna',
  name: 'Atendeu, retorna depois',
  surfaces: ['ligacao'],
  position: 204,
  cooldown_days: 2,
  next_action_kind: 'call',
  next_action_label: 'Ligar na data combinada',
  sets_temperature: 'morno',
  counts_as: 'aberta',
});

export const CATALOGO_DE_TESTE: DesfechoCatalogo[] = [
  WA_RESPONDEU,
  WA_AGORA_NAO,
  WA_OPTOUT,
  LIG_NAO_ATENDEU,
  LIG_ATENDEU_RETORNA,
  LIG_SEM_INTERESSE,
  LIG_REUNIAO_MARCADA,
  VIS_DECISOR_INTERESSADO,
  REU_AUTORIZOU,
];

/** Etapas do funil `fornecedor` (pipeline 1) que o catálogo de teste alcança. */
export const ETAPAS_FORNECEDOR = [
  { pipelineId: 1, slug: 'respondeu', nome: 'Respondeu', temperatura: 'morno' as const },
  { pipelineId: 1, slug: 'em_conversa', nome: 'Em conversa', temperatura: 'morno' as const },
  {
    pipelineId: 1,
    slug: 'reuniao_marcada',
    nome: 'Reunião marcada',
    temperatura: 'quente' as const,
  },
  { pipelineId: 1, slug: 'autorizou', nome: 'Autorizou', temperatura: 'quente' as const },
  { pipelineId: 1, slug: 'nutricao', nome: 'Nutrição / dormente', temperatura: 'frio' as const },
  { pipelineId: 1, slug: 'perdido', nome: 'Perdido', temperatura: 'frio' as const },
  { pipelineId: 1, slug: 'optout', nome: 'Opt-out / não contatar', temperatura: 'frio' as const },
  // O funil `produtor` NÃO tem `em_conversa`: é metade da base, e é o caso que a
  // previsão precisa acertar sem mentir uma promoção que não vai acontecer.
  { pipelineId: 3, slug: 'respondeu', nome: 'Respondeu', temperatura: 'morno' as const },
  { pipelineId: 3, slug: 'nutricao', nome: 'Nutrição / dormente', temperatura: 'frio' as const },
];

/** Feriados de 2026 que caem perto da janela dos testes (seed `holidays`). */
export const FERIADOS_2026 = ['2026-09-07', '2026-10-03', '2026-10-12'];

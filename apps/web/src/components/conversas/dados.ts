import { createClient } from '@/lib/supabase/client';

import type { AtividadeCrua, HistoricoCru, NegocioCru, OrganizacaoCrua } from './montagem';
import type { FioCru, MensagemCrua, RascunhoCru } from './mensagens';
import type { DependenciasDaMeta } from './tipos';

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

/**
 * Colunas do fio. `peer_phone_e164` entra cru, sem máscara, e isso é decisão:
 * o telefone do parceiro é a IDENTIDADE do fio de WhatsApp — mascará-lo aqui
 * deixaria a Heloísa sem saber com qual dos dois números do buffet ela está
 * falando. A máscara do RF-BAS-14 protege a lista de fichas contra exportação em
 * massa; ela não se aplica a uma conversa aberta com uma pessoa só, que a RLS já
 * restringe a quem é dono do fio.
 */
const COLUNAS_FIO =
  'id, organization_id, contact_id, channel, peer_phone_e164, business_number, assignee_id, status, bot_paused, last_message_at, last_inbound_at, last_outbound_at, window_expires_at, unread_count, ai_summary, ai_intent, ai_confidence';

/** Colunas da mensagem. `body` pode ser null: a retenção dos 12 meses o apaga. */
const COLUNAS_MENSAGEM =
  'id, conversation_id, organization_id, direction, type, status, body, media_path, media_mime, transcript, template_id, draft_id, author_kind, sent_by, approved_by, is_first_contact, business_initiated, optout_confirmation, origin, error_code, error_detail, created_at, sent_at, delivered_at, read_at, failed_at';

/** Colunas do rascunho. `proposed_body` e `final_body` viajam os dois: a tela mostra a diferença. */
const COLUNAS_RASCUNHO =
  'id, organization_id, conversation_id, kind, status, proposed_body, proposed_claims, validator, prompt_version, final_body, foi_editado, reviewed_by, reviewed_at, discard_reason, created_at, expires_at';

export type BaseDasConversas = {
  organizacoes: OrganizacaoCrua[];
  atividades: AtividadeCrua[];
  negocios: NegocioCru[];
  fios: FioCru[];
  /** Só os pendentes: é a fila de aprovação e o ponto na linha da lista. */
  rascunhosPendentes: RascunhoCru[];
  /** O que ainda depende da Meta, contado no banco (ver `tipos.ts`). */
  meta: DependenciasDaMeta;
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

  const [organizacoes, atividades, negocios, fios, rascunhos, meta] = await Promise.all([
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
    supabase
      .from('conversations')
      .select(COLUNAS_FIO)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(TETO_ORGANIZACOES),
    supabase
      .from('message_drafts')
      .select(COLUNAS_RASCUNHO)
      .eq('status', 'pendente')
      .order('expires_at')
      .limit(TETO_ORGANIZACOES),
    dependenciasDaMeta(supabase),
  ]);

  const erro =
    organizacoes.error ?? atividades.error ?? negocios.error ?? fios.error ?? rascunhos.error;
  if (erro) throw new Error(erro.message);

  return {
    organizacoes: organizacoes.data ?? [],
    atividades: atividades.data ?? [],
    negocios: negocios.data ?? [],
    fios: fios.data ?? [],
    rascunhosPendentes: rascunhos.data ?? [],
    meta,
    cortada:
      (organizacoes.data?.length ?? 0) >= TETO_ORGANIZACOES ||
      (atividades.data?.length ?? 0) >= TETO_ATIVIDADES,
  };
}

/**
 * O que ainda depende da Meta, medido — e não escrito num parágrafo.
 *
 * São cinco perguntas, e as cinco têm resposta no banco: existe número
 * configurado (`app_settings`), quantos modelos a Meta já aprovou, quantos ainda
 * espera, quantas mensagens estão paradas em `queued` e quando o worker-wa bateu
 * ponto pela última vez (`worker_heartbeats`, que a RLS libera para qualquer
 * pessoa autenticada). Um texto fixo dizendo "faltam os modelos" continuaria na
 * tela no dia seguinte à aprovação, e ninguém perceberia.
 */
async function dependenciasDaMeta(
  supabase: ReturnType<typeof createClient>,
): Promise<DependenciasDaMeta> {
  const [config, modelos, fila, ponto] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'whatsapp.envio').maybeSingle(),
    // Só os modelos que PRECISAM de aprovação da Meta. `service` é resposta
    // livre dentro da janela de 24 h: não passa por aprovação nenhuma, e
    // contá-la aqui transformaria "0 de 39" em "0 de 126" — um número maior,
    // mais assustador e errado.
    supabase
      .from('message_templates')
      .select('meta_status')
      .eq('is_active', true)
      .eq('channel', 'whatsapp')
      .in('category', ['marketing', 'utility', 'authentication']),
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued')
      .eq('direction', 'out'),
    supabase
      .from('worker_heartbeats')
      .select('status, last_beat_at')
      .eq('worker', 'wa')
      .order('last_beat_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const valor = config.data?.value;
  const numero =
    valor !== null && typeof valor === 'object' && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)['numero_padrao']
      : null;

  const linhas = modelos.data ?? [];
  const batida = ponto.data;
  const estados = ['ok', 'degradado', 'parado'] as const;
  const estado = estados.find((e) => e === batida?.status);

  return {
    numeroConfigurado: typeof numero === 'string' && numero.trim() !== '',
    modelosAprovados: linhas.filter((m) => m.meta_status === 'approved').length,
    modelosAguardando: linhas.filter((m) => m.meta_status !== 'approved').length,
    naFila: fila.count ?? 0,
    worker: {
      // Sem linha nenhuma, o worker nunca subiu nesta base — que é diferente de
      // ter subido e parado, e leva a pessoa a perguntar outra coisa.
      estado: batida ? (estado ?? 'degradado') : 'nunca',
      ultimaBatidaEm: batida?.last_beat_at ?? null,
    },
  };
}

export type LinhaDoParceiro = {
  atividades: AtividadeCrua[];
  historico: HistoricoCru[];
  negocios: NegocioCru[];
  fios: FioCru[];
  mensagens: MensagemCrua[];
  /** Todos os rascunhos deste parceiro, inclusive os já descartados e enviados. */
  rascunhos: RascunhoCru[];
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

  const [atividades, negocios, fios, mensagens, rascunhos] = await Promise.all([
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
    supabase.from('conversations').select(COLUNAS_FIO).eq('organization_id', organizacaoId),
    // `messages.organization_id` é denormalizado pelo gatilho justamente para
    // esta leitura não depender de um join com a conversa (que pode ter perdido
    // a ficha depois). Sem teto: a conversa inteira é o que a pessoa abriu.
    supabase
      .from('messages')
      .select(COLUNAS_MENSAGEM)
      .eq('organization_id', organizacaoId)
      .order('created_at', { ascending: true }),
    supabase
      .from('message_drafts')
      .select(COLUNAS_RASCUNHO)
      .eq('organization_id', organizacaoId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const erro =
    atividades.error ?? negocios.error ?? fios.error ?? mensagens.error ?? rascunhos.error;
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
    fios: fios.data ?? [],
    mensagens: mensagens.data ?? [],
    rascunhos: rascunhos.data ?? [],
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

/** Um modelo que a Meta já aprovou — o único que atravessa a janela fechada. */
export type ModeloAprovado = { id: number; nome: string; categoria: string };

/**
 * Só os modelos com `meta_status = 'approved'`.
 *
 * O filtro é a diferença entre "existe no CRM" e "a Meta deixa passar". Hoje as
 * duas contas não batem: há dezenas de modelos escritos e nenhum aprovado, e um
 * seletor com os escritos faria a pessoa escolher um que seria recusado na
 * entrega — erro que só apareceria horas depois, no relatório de falhas.
 */
export async function carregarModelosAprovados(): Promise<ModeloAprovado[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, name, category')
    .eq('is_active', true)
    .eq('channel', 'whatsapp')
    .eq('meta_status', 'approved')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({ id: m.id, nome: m.name, categoria: m.category }));
}

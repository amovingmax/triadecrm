import type { MensagemCrua } from '@/components/conversas/mensagens';
import type { AtividadeCrua, HistoricoCru } from '@/components/conversas/montagem';
import { createClient } from '@/lib/supabase/server';

import {
  LINHAS_DE_ATIVIDADE,
  montarAtividade,
  montarLeituraDaFicha,
  montarProximosPassos,
  type Atividade,
  type LeituraCruaDaFicha,
  type LeituraDaFicha,
  type ProximosPassos,
  type ReuniaoCrua,
  type TarefaCrua,
} from './paineis-da-ficha';

/**
 * A leitura dos três painéis da ficha (atividade, próximos passos, leitura da
 * IA), no servidor e sob a RLS de quem entrou.
 *
 * SÓ `select`. Nada aqui grava, e nada aqui fala com a Meta nem com a IA: a
 * atividade é o que `messages`, `activities` e `deal_stage_history` já guardam;
 * os passos são `reunioes` e `tasks`; a leitura é a linha que o worker de IA já
 * escreveu em `ficha_da_conversa`.
 *
 * Quem não enxerga, não enxerga aqui também: as mensagens seguem
 * `messages_select`, as tarefas `tasks_select` (cada um vê as suas; admin,
 * gestor e sdr veem todas) e a leitura `app.conversa_visivel`.
 *
 * CADA PAINEL FALHA SOZINHO. O cabeçalho da ficha lança quando a leitura falha
 * (`ficha.ts`), porque sem ele não há ficha. Um painel que não carregou devolve
 * `null`, a tela escreve "não deu para carregar" naquele cartão, e o resto da
 * ficha abre — telefone e régua não podem cair por causa de uma lista.
 */

export type PaineisDaFicha = {
  atividade: Atividade | null;
  passos: ProximosPassos | null;
  leitura: {
    leitura: LeituraDaFicha | null;
    /** `ia.crm_inteligente.modulos.ficha`; `null` quando não deu para saber. */
    moduloLigado: boolean | null;
  } | null;
};

/**
 * As mesmas colunas de `conversas/dados.ts`: é o que `montarLinhaDoTempo`
 * espera. Repetidas aqui, e não importadas, porque aquele arquivo é do
 * navegador (cliente Supabase de browser) e este roda no servidor.
 */
const COLUNAS_ATIVIDADE =
  'id, organization_id, deal_id, type, channel, author_kind, occurred_at, body, duration_min, user_id, outcome_id, metadata, message_id';
const COLUNAS_MENSAGEM =
  'id, conversation_id, organization_id, direction, type, status, body, media_path, media_mime, transcript, template_id, draft_id, author_kind, sent_by, approved_by, is_first_contact, business_initiated, optout_confirmation, origin, error_code, error_detail, created_at, sent_at, delivered_at, read_at, failed_at';

/**
 * Quantas linhas de cada fonte bastam para as últimas cinco: as cinco mais novas
 * do conjunto estão, por força, entre as mais novas de cada fonte. A folga das
 * atividades cobre as que espelham mensagem e somem na montagem.
 */
const TETO_POR_FONTE = LINHAS_DE_ATIVIDADE + 3;
const TETO_DE_ATIVIDADES = 20;

type Cliente = Awaited<ReturnType<typeof createClient>>;

async function lerAtividade(
  supabase: Cliente,
  organizacaoId: string,
  pessoas: { id: string; nome: string }[],
): Promise<Atividade> {
  const [atividades, mensagens, negocios, desfechos, etapas, parceiro] = await Promise.all([
    supabase
      .from('activities')
      .select(COLUNAS_ATIVIDADE)
      .eq('organization_id', organizacaoId)
      .order('occurred_at', { ascending: false })
      .limit(TETO_DE_ATIVIDADES),
    supabase
      .from('messages')
      .select(COLUNAS_MENSAGEM)
      .eq('organization_id', organizacaoId)
      .order('created_at', { ascending: false })
      .limit(TETO_POR_FONTE),
    supabase.from('deals').select('id').eq('organization_id', organizacaoId),
    supabase.from('interaction_outcomes').select('id, name'),
    supabase.from('stages').select('id, name, is_entry'),
    // Quando a ficha nasceu: é o que separa "Entrou na base" dos outros
    // registros do sistema. Se não vier, nenhum registro é chamado de entrada.
    supabase.from('organizations_view').select('created_at').eq('id', organizacaoId).maybeSingle(),
  ]);

  const erro =
    atividades.error ?? mensagens.error ?? negocios.error ?? desfechos.error ?? etapas.error;
  if (erro) throw new Error(erro.message);

  const idsDeNegocio = (negocios.data ?? []).map((d) => d.id as string);
  const historico = idsDeNegocio.length
    ? await supabase
        .from('deal_stage_history')
        .select('id, deal_id, changed_at, from_stage_id, to_stage_id, changed_by, reason')
        .in('deal_id', idsDeNegocio)
        .order('changed_at', { ascending: false })
        .limit(TETO_POR_FONTE)
    : { data: [], error: null };
  if (historico.error) throw new Error(historico.error.message);

  return montarAtividade({
    atividades: (atividades.data ?? []) as AtividadeCrua[],
    mensagens: (mensagens.data ?? []) as MensagemCrua[],
    historico: (historico.data ?? []) as HistoricoCru[],
    pessoas,
    desfechos: (desfechos.data ?? []).map((d) => ({ id: d.id as number, nome: d.name as string })),
    etapas: new Map((etapas.data ?? []).map((e) => [e.id as number, e.name as string])),
    etapasDeEntrada: new Set(
      (etapas.data ?? []).filter((e) => e.is_entry === true).map((e) => e.id as number),
    ),
    criadaEm: (parceiro.data?.created_at as string | null | undefined) ?? null,
  });
}

async function lerPassos(
  supabase: Cliente,
  organizacaoId: string,
  pessoas: { id: string; nome: string }[],
): Promise<ProximosPassos> {
  const [reunioes, tarefas] = await Promise.all([
    // TODAS as reuniões do parceiro, e não só as de pé: é do `task_id` das
    // encerradas que sai a lista de tarefas que são eco de reunião.
    supabase
      .from('reunioes')
      .select('id, formato, inicio, fim, estado, link, local, dono_id, task_id')
      .eq('organization_id', organizacaoId)
      .order('inicio', { ascending: false })
      .limit(60),
    supabase
      .from('tasks')
      .select('id, title, kind, status, due_at, assignee_id')
      .eq('organization_id', organizacaoId)
      .in('status', ['todo', 'doing'])
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(60),
  ]);

  const erro = reunioes.error ?? tarefas.error;
  if (erro) throw new Error(erro.message);

  return montarProximosPassos({
    reunioes: (reunioes.data ?? []) as ReuniaoCrua[],
    tarefas: (tarefas.data ?? []) as TarefaCrua[],
    pessoas: new Map(pessoas.map((p) => [p.id, p.nome])),
  });
}

async function lerLeitura(
  supabase: Cliente,
  organizacaoId: string,
): Promise<NonNullable<PaineisDaFicha['leitura']>> {
  const [conversas, ajuste] = await Promise.all([
    // A MESMA conversa do cabeçalho (`ficha.ts`): a mais recente do parceiro.
    // Parceiro com dois números tem duas conversas; lendo a leitura "mais
    // recente de qualquer uma", a janela do cabeçalho era de uma conversa e a
    // nota da IA de outra, sem a tela dizer.
    supabase
      .from('conversations')
      .select('id, last_inbound_at')
      .eq('organization_id', organizacaoId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1),
    supabase.from('app_settings').select('value').eq('key', 'ia.crm_inteligente').maybeSingle(),
  ]);
  if (conversas.error) throw new Error(conversas.error.message);

  const conversa = (conversas.data?.[0] ?? null) as {
    id: string;
    last_inbound_at: string | null;
  } | null;

  const ficha = conversa
    ? await supabase
        .from('ficha_da_conversa')
        .select(
          'resumo, intencao, score_intencao, sentimento, sinais, objecoes, alertas, proxima_acao, dados_insuficientes, analisada_em',
        )
        .eq('conversation_id', conversa.id)
        .maybeSingle()
    : { data: null, error: null };
  if (ficha.error) throw new Error(ficha.error.message);

  const linha = (ficha.data ?? null) as LeituraCruaDaFicha | null;

  // O ajuste é só para escolher a frase do cartão vazio: falhar aqui não é erro.
  const modulos = (ajuste.data?.value as { modulos?: { ficha?: unknown } } | null)?.modulos;
  const moduloLigado = ajuste.error || !modulos ? null : modulos.ficha === true;

  return {
    leitura: montarLeituraDaFicha(linha, conversa?.last_inbound_at ?? null),
    moduloLigado,
  };
}

/** Um painel que falhou vira `null`; os outros seguem. */
async function ouNulo<T>(leitura: Promise<T>): Promise<T | null> {
  try {
    return await leitura;
  } catch {
    return null;
  }
}

export async function carregarPaineis(organizacaoId: string): Promise<PaineisDaFicha> {
  const supabase = await createClient();

  // O time uma vez só: a atividade e os passos dizem "Heloísa", não o uuid.
  const { data: time } = await supabase.from('team_directory').select('id, full_name');
  const pessoas = (time ?? []).map((p) => ({ id: p.id as string, nome: p.full_name as string }));

  const [atividade, passos, leitura] = await Promise.all([
    ouNulo(lerAtividade(supabase, organizacaoId, pessoas)),
    ouNulo(lerPassos(supabase, organizacaoId, pessoas)),
    ouNulo(lerLeitura(supabase, organizacaoId)),
  ]);

  return { atividade, passos, leitura };
}

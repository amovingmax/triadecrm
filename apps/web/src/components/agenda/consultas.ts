'use client';

import { createClient } from '@/lib/supabase/client';

import { janelaDeDias, type Compromisso, type Dia, type NaturezaDoCompromisso } from './tipos';

/**
 * De onde a Agenda tira os compromissos.
 *
 * Três consultas em paralelo, todas sob a RLS de quem entrou, sem RPC nova:
 *
 * 1. `tasks` de tipo `meeting` e `visit` com prazo dentro da semana. A política
 *    `tasks_select` já entrega só as da pessoa (`assignee_id`), mas o filtro vai
 *    explícito para a consulta continuar certa se a política mudar.
 * 2. `organizations_view`, e não `organizations`: a política `organizations_select` é
 *    `is_manager() or reads_base_pii()`, e a Heloísa é `sdr`, que não é nenhum dos
 *    dois. A view aplica `app.org_is_visible` e mascara o telefone (RF-BAS-14).
 * 3. `deals` do compromisso, com o nome da etapa embutido pela chave estrangeira. É o
 *    `stage_id` que diz se a reunião tem hora combinada, e é o `deal_id` +
 *    `stage_id` que viajam como `p_deal_id` e `p_expected_stage_id` no registro,
 *    pegando duas pessoas mexendo no mesmo negócio.
 *
 * Nenhum texto do Postgres chega à tela: falha vira `ErroDaAgenda` com frase em
 * português, pela mesma tradução que a tela de registro usa.
 */

export class ErroDaAgenda extends Error {
  readonly podeTentarDeNovo: boolean;

  constructor(mensagem: string, podeTentarDeNovo: boolean, causa?: unknown) {
    super(mensagem, { cause: causa });
    this.name = 'ErroDaAgenda';
    this.podeTentarDeNovo = podeTentarDeNovo;
  }
}

/** Espelha a tradução de `components/registro/gravar`, com as frases desta tela. */
function erroDe(codigo: string | null | undefined, causa: unknown): ErroDaAgenda {
  switch (codigo) {
    case '42501':
      return new ErroDaAgenda('Seu perfil não pode ver esta agenda.', false, causa);
    case 'PGRST301':
    case '401':
      return new ErroDaAgenda('Sua sessão expirou. Entre de novo para ver a agenda.', false, causa);
    default:
      return new ErroDaAgenda('Não deu para falar com o servidor.', true, causa);
  }
}

const COLUNAS_TAREFA = 'id, title, kind, status, due_at, organization_id, deal_id' as const;
const COLUNAS_ORG =
  'id, name, neighborhood, city_name, address, primary_category_name, temperature, do_not_contact' as const;
const COLUNAS_NEGOCIO =
  'id, pipeline_id, stage_id, temperature, needs_attention, last_activity_at, stages(name)' as const;

type LinhaTarefa = {
  id: string;
  title: string;
  kind: string;
  status: string;
  due_at: string | null;
  organization_id: string | null;
  deal_id: string | null;
};

type LinhaNegocio = {
  id: string;
  pipeline_id: number;
  stage_id: number;
  temperature: Compromisso['temperatura'];
  needs_attention: boolean;
  last_activity_at: string | null;
  stages: { name: string } | null;
};

/** Chave de cache do TanStack Query: muda com a pessoa e com a semana em foco. */
export function chaveDaAgenda(usuarioId: string, primeiroDia: Dia, ultimoDia: Dia) {
  return ['agenda', usuarioId, primeiroDia, ultimoDia] as const;
}

function diasDesde(iso: string | null, agora: number): number | null {
  if (!iso) return null;
  const quando = Date.parse(iso);
  if (Number.isNaN(quando)) return null;
  return Math.max(0, Math.floor((agora - quando) / 86_400_000));
}

/** Os negócios dos compromissos. Lista vazia não vai ao servidor. */
async function buscarNegocios(
  supabase: ReturnType<typeof createClient>,
  ids: readonly string[],
): Promise<LinhaNegocio[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('deals')
    .select(COLUNAS_NEGOCIO)
    .in('id', [...ids]);
  if (error) throw erroDe(error.code, error);
  return (data ?? []) as unknown as LinhaNegocio[];
}

export async function buscarCompromissos(params: {
  usuarioId: string;
  primeiroDia: Dia;
  ultimoDia: Dia;
  etapasComHoraMarcada: readonly number[];
}): Promise<Compromisso[]> {
  const supabase = createClient();
  const { de, ate } = janelaDeDias(params.primeiroDia, params.ultimoDia);

  const tarefas = await supabase
    .from('tasks')
    .select(COLUNAS_TAREFA)
    .eq('assignee_id', params.usuarioId)
    .in('kind', ['meeting', 'visit'])
    .in('status', ['todo', 'doing', 'done'])
    .not('due_at', 'is', null)
    .not('organization_id', 'is', null)
    .gte('due_at', de)
    .lt('due_at', ate)
    .order('due_at');

  if (tarefas.error) throw erroDe(tarefas.error.code, tarefas.error);

  const linhas = (tarefas.data ?? []) as unknown as LinhaTarefa[];
  if (linhas.length === 0) return [];

  const orgIds = [...new Set(linhas.map((t) => t.organization_id).filter((id) => id !== null))];
  const dealIds = [...new Set(linhas.map((t) => t.deal_id).filter((id) => id !== null))];

  const [orgs, negocios] = await Promise.all([
    supabase.from('organizations_view').select(COLUNAS_ORG).in('id', orgIds),
    buscarNegocios(supabase, dealIds),
  ]);

  if (orgs.error) throw erroDe(orgs.error.code, orgs.error);

  const porOrg = new Map((orgs.data ?? []).map((o) => [o.id, o] as const));
  const porNegocio = new Map(negocios.map((d) => [d.id, d] as const));
  const agora = Date.now();
  const marcamHora = new Set(params.etapasComHoraMarcada);

  return linhas.flatMap((tarefa) => {
    const org = tarefa.organization_id ? porOrg.get(tarefa.organization_id) : undefined;
    // Organização apagada ou fora da carteira: a tarefa existe e o parceiro não é
    // legível. Sem nome não há cartão honesto para desenhar.
    if (!org || !tarefa.due_at || !tarefa.organization_id) return [];

    const negocio = tarefa.deal_id ? porNegocio.get(tarefa.deal_id) : undefined;
    const ehVisita = tarefa.kind === 'visit';
    const natureza: NaturezaDoCompromisso = ehVisita
      ? 'visita'
      : negocio && marcamHora.has(negocio.stage_id)
        ? 'marcado'
        : 'a_marcar';

    return [
      {
        taskId: tarefa.id,
        natureza,
        tipo: ehVisita ? ('visita' as const) : ('reuniao' as const),
        titulo: tarefa.title,
        quando: tarefa.due_at,
        concluido: tarefa.status === 'done',
        organizationId: tarefa.organization_id,
        organizacao: org.name,
        bairro: org.neighborhood,
        cidade: org.city_name,
        endereco: org.address,
        categoria: org.primary_category_name,
        temperatura: negocio?.temperature ?? org.temperature,
        precisaAtencao: negocio?.needs_attention ?? false,
        dealId: negocio?.id ?? null,
        pipelineId: negocio?.pipeline_id ?? null,
        etapa: negocio?.stages?.name ?? null,
        etapaId: negocio?.stage_id ?? null,
        diasSemContato: diasDesde(negocio?.last_activity_at ?? null, agora),
        naoContatar: org.do_not_contact,
      } satisfies Compromisso,
    ];
  });
}

/**
 * Fecha a tarefa do compromisso depois que o desfecho foi gravado.
 *
 * Não é caminho paralelo nenhum: quem move etapa, temperatura e porta é a
 * `public.registrar_contato`, que já rodou. Isto é higiene da agenda — sem fechar, a
 * reunião de quinta continuaria pedindo desfecho na quinta seguinte. A política
 * `tasks_update` deixa o responsável fechar a própria tarefa, e o gatilho
 * `app.tasks_before_write` carimba `completed_at`.
 *
 * Falhar aqui NÃO é falhar o registro: o registro está gravado. Devolve `false` e a
 * tela avisa que o compromisso continua aberto na lista.
 */
export async function concluirCompromisso(taskId: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', taskId);
  return !error;
}

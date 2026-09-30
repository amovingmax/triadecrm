'use client';

import { createClient } from '@/lib/supabase/client';
import { prepararConsulta } from '@/components/parceiros/busca';
import { hidratarAlvos } from '@/components/registro/alvos';
import {
  COLUNAS_DESFECHO,
  type DesfechoCatalogo,
  type SugestaoDeAlvo,
} from '@/components/registro/tipos';

import { escaparCuringas, normalizarBusca, ordenarCandidatos } from './autocompletar';
import {
  escolherResultado,
  janelaDeDias,
  naturezaDoCompromisso,
  resultadoDoDesfecho,
  type Compromisso,
  type Dia,
  type RegistroComDesfecho,
} from './tipos';

/**
 * De onde a Agenda tira os compromissos.
 *
 * A consulta das `tasks` vem primeiro, sozinha; depois três em paralelo, todas sob a
 * RLS de quem entrou, sem RPC nova:
 *
 * 1. `tasks` de tipo `meeting` e `visit` com prazo dentro da semana, da pessoa cuja
 *    agenda está aberta (`assignee_id`). É a própria pessoa, ou — na visão da equipe,
 *    só para admin e gestor — quem ela escolheu; a política `tasks_select`
 *    (`sees_all()`) é que deixa ler a agenda de outra pessoa.
 * 2. `organizations_view`, e não `organizations`: a política `organizations_select` é
 *    `is_manager() or reads_base_pii()`, e a Heloísa é `sdr`, que não é nenhum dos
 *    dois. A view aplica `app.org_is_visible` e mascara o telefone (RF-BAS-14).
 * 3. `deals` do compromisso, com o nome da etapa embutido pela chave estrangeira. É o
 *    `stage_id` que diz se a reunião tem hora combinada, e é o `deal_id` +
 *    `stage_id` que viajam como `p_deal_id` e `p_expected_stage_id` no registro,
 *    pegando duas pessoas mexendo no mesmo negócio.
 * 4. `reunioes` das MESMAS tarefas, por `task_id` (ADR-15). Ela substituiu o espelho
 *    do Google, e no mesmo papel: a `tasks` é a espinha, a reunião é a carne. Não é
 *    segunda fonte de linhas — reunião e eco nascem e morrem juntos, e `Compromisso`
 *    tem `taskId` obrigatório porque `concluirCompromisso` e o registro de desfecho
 *    dependem dele.
 *
 *    A DIFERENÇA EM RELAÇÃO AO ESPELHO: falha aqui DERRUBA a semana. O espelho do
 *    Google era enfeite, e o erro dele era engolido de propósito. Sem `reunioes` a
 *    lista fica ERRADA, não incompleta: reunião de verdade apareceria como
 *    apresentação a combinar, sem sala, sem fim e sem as ações do cartão.
 * 5. Depois, e só para o que já foi fechado: os registros com desfecho que a MESMA
 *    pessoa fez para os MESMOS parceiros perto de quando cada tarefa foi fechada. É
 *    deles que sai o resultado pintado no cartão (`escolherResultado`). Falha aqui é
 *    engolida: o cartão fica sem a cor, e a semana continua certa.
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

const COLUNAS_TAREFA =
  'id, title, kind, status, due_at, organization_id, deal_id, completed_at' as const;
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
  completed_at: string | null;
};

const COLUNAS_REUNIAO =
  'id, task_id, inicio, fim, formato, link, local, estado, marcada_por, aviso_enviado_em, criada_em, remarcada_de' as const;

type LinhaReuniao = {
  id: string;
  task_id: string | null;
  inicio: string;
  fim: string | null;
  formato: string;
  link: string | null;
  local: string | null;
  estado: string;
  marcada_por: string;
  aviso_enviado_em: string | null;
  criada_em: string;
  remarcada_de: string | null;
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
  /** De quem é a agenda aberta: quem entrou, ou a pessoa escolhida na visão da equipe. */
  usuarioId: string;
  primeiroDia: Dia;
  ultimoDia: Dia;
  etapasComHoraMarcada: readonly number[];
  /** O catálogo de desfechos: é dele que sai o resultado de cada compromisso fechado. */
  catalogo: readonly DesfechoCatalogo[];
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

  const fechadas = linhas.filter((t) => t.status === 'done');

  const [orgs, negocios, reuniao, registros] = await Promise.all([
    supabase.from('organizations_view').select(COLUNAS_ORG).in('id', orgIds),
    buscarNegocios(supabase, dealIds),
    // As reuniões das tarefas desta janela. Uma ida só, e não uma por cartão:
    // numa semana cheia isso seriam trinta requisições para desenhar uma lista.
    supabase
      .from('reunioes')
      .select(COLUNAS_REUNIAO)
      .eq('dono_id', params.usuarioId)
      .in('estado', ['a_confirmar', 'marcada', 'confirmada', 'realizada', 'nao_compareceu'])
      .in(
        'task_id',
        linhas.map((t) => t.id),
      ),
    // Os registros que dão a cor aos cartões já fechados: só dependem das
    // tarefas, então vão na mesma leva.
    buscarRegistrosDasFechadas(supabase, {
      orgIds: [...new Set(fechadas.flatMap((t) => t.organization_id ?? []))],
      // Um dia antes do fechamento mais antigo (ou do começo da semana): é a
      // janela de `escolherResultado`.
      desde: new Date(
        Math.min(Date.parse(de), ...fechadas.map((t) => Date.parse(t.completed_at ?? de))) -
          86_400_000,
      ).toISOString(),
      catalogo: params.catalogo,
    }),
  ]);

  if (orgs.error) throw erroDe(orgs.error.code, orgs.error);
  // Ao contrário do espelho do Google, este erro NÃO é engolido: sem a reunião a
  // lista fica errada, não incompleta.
  if (reuniao.error) throw erroDe(reuniao.error.code, reuniao.error);

  const porOrg = new Map((orgs.data ?? []).map((o) => [o.id, o] as const));
  const porTarefa = new Map(
    ((reuniao.data ?? []) as unknown as LinhaReuniao[])
      .filter((r) => r.task_id !== null)
      .map((r) => [r.task_id as string, r] as const),
  );
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
    const reuniaoDaTarefa = porTarefa.get(tarefa.id) ?? null;
    const tipo = ehVisita ? ('visita' as const) : ('reuniao' as const);
    const natureza = naturezaDoCompromisso(
      { reuniaoId: reuniaoDaTarefa?.id ?? null, tipo, etapaId: negocio?.stage_id ?? null },
      marcamHora,
    );

    return [
      {
        taskId: tarefa.id,
        natureza,
        tipo,
        titulo: tarefa.title,
        quando: tarefa.due_at,
        concluido: tarefa.status === 'done',
        reuniaoId: reuniaoDaTarefa?.id ?? null,
        fim: reuniaoDaTarefa?.fim ?? null,
        link: reuniaoDaTarefa?.link ?? null,
        local: reuniaoDaTarefa?.local ?? null,
        estado: reuniaoDaTarefa?.estado ?? null,
        marcadaPeloRobo: reuniaoDaTarefa?.marcada_por === 'robo',
        avisoEnviadoEm: reuniaoDaTarefa?.aviso_enviado_em ?? null,
        reuniaoCriadaEm: reuniaoDaTarefa?.criada_em ?? null,
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
        resultado: resultadoDaTarefa(tarefa, tipo, registros, params.usuarioId),
        reagendada: reuniaoDaTarefa?.remarcada_de != null,
        responsavelId: params.usuarioId,
      } satisfies Compromisso,
    ];
  });
}

type RegistroDeQuem = RegistroComDesfecho & { autorId: string | null };

type RegistrosDasFechadas = {
  porOrg: Map<string, RegistroDeQuem[]>;
  desfechos: Map<number, DesfechoCatalogo>;
};

/**
 * Os registros com desfecho para os parceiros dos compromissos fechados — de
 * QUALQUER pessoa, porque o gestor também registra o resultado da visita da SDR —,
 * e os desfechos que eles citam. O catálogo da tela só traz desfecho ativo: um
 * registro com desfecho que o gestor desativou depois (RF-ADM-02) perderia a cor,
 * então esses vêm pelo id.
 */
async function buscarRegistrosDasFechadas(
  supabase: ReturnType<typeof createClient>,
  p: {
    orgIds: readonly string[];
    desde: string;
    catalogo: readonly DesfechoCatalogo[];
  },
): Promise<RegistrosDasFechadas> {
  const desfechos = new Map(p.catalogo.map((d) => [d.id, d] as const));
  const vazio = { porOrg: new Map<string, RegistroDeQuem[]>(), desfechos };
  if (p.orgIds.length === 0) return vazio;

  const { data, error } = await supabase
    .from('activities')
    .select('organization_id, created_at, outcome_id, user_id')
    .in('organization_id', [...p.orgIds])
    .not('outcome_id', 'is', null)
    .gte('created_at', p.desde);
  if (error || !data) return vazio;

  const porOrg = new Map<string, RegistroDeQuem[]>();
  for (const linha of data) {
    if (!linha.organization_id || linha.outcome_id === null) continue;
    const lista = porOrg.get(linha.organization_id) ?? [];
    lista.push({
      registradoEm: linha.created_at,
      desfechoId: linha.outcome_id,
      autorId: linha.user_id,
    });
    porOrg.set(linha.organization_id, lista);
  }

  const faltando = [
    ...new Set(data.flatMap((l) => (l.outcome_id !== null && !desfechos.has(l.outcome_id) ? [l.outcome_id] : []))),
  ];
  if (faltando.length > 0) {
    const antigos = await supabase
      .from('interaction_outcomes')
      .select(COLUNAS_DESFECHO)
      .in('id', faltando);
    for (const d of (antigos.data ?? []) as DesfechoCatalogo[]) desfechos.set(d.id, d);
  }
  return { porOrg, desfechos };
}

function resultadoDaTarefa(
  tarefa: LinhaTarefa,
  tipo: Compromisso['tipo'],
  registros: RegistrosDasFechadas,
  pessoaId: string,
): Compromisso['resultado'] {
  if (tarefa.status !== 'done' || !tarefa.organization_id || !tarefa.due_at) return null;
  const doParceiro = registros.porOrg.get(tarefa.organization_id) ?? [];
  // Com o carimbo de fechamento, o registro de quem fechou — seja quem for. Sem
  // ele, a regra do dia é frouxa demais para aceitar o registro de outra pessoa
  // (a ligação do gestor no mesmo dia pintaria a visita da SDR), e só vale o dela.
  const escolhido = escolherResultado(
    { quando: tarefa.due_at, fechadoEm: tarefa.completed_at },
    tarefa.completed_at ? doParceiro : doParceiro.filter((r) => r.autorId === pessoaId),
  );
  const desfecho = escolhido ? registros.desfechos.get(escolhido.desfechoId) : undefined;
  return desfecho ? resultadoDoDesfecho(desfecho, tipo) : null;
}

/** Quantos parceiros o autocompletar da folha de novo compromisso mostra. */
export const MAX_NO_AUTOCOMPLETAR = 8;

/**
 * O autocompletar de parceiro da folha de novo compromisso.
 *
 * Duas buscas em paralelo, sob a RLS de quem entrou: a `search_organizations` (que
 * acha por telefone, @, CNPJ e bairro) e um `ilike` no `search_name` da
 * `organizations_view` (que acha o trecho no meio do nome: "buf" em "Anne Vieira
 * Buffet"). `ordenarCandidatos` junta as duas sem repetir, e `hidratarAlvos` — a
 * mesma do Registrar contato — devolve cada parceiro com negócio, etapa e opt-out.
 */
export async function buscarParceirosParaAgenda(texto: string): Promise<SugestaoDeAlvo[]> {
  const termo = normalizarBusca(texto);
  if (!termo) return [];
  const supabase = createClient();
  const consultaDaRpc = prepararConsulta(texto);

  const [daRpc, doTrecho] = await Promise.all([
    consultaDaRpc
      ? supabase.rpc('search_organizations', { q: consultaDaRpc, p_limit: MAX_NO_AUTOCOMPLETAR })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('organizations_view')
      .select('id, name')
      .ilike('search_name', `%${escaparCuringas(termo)}%`)
      .order('name')
      .limit(30),
  ]);
  if (daRpc.error && doTrecho.error) throw erroDe(doTrecho.error.code, doTrecho.error);

  const nomes = (linhas: unknown) =>
    ((linhas ?? []) as { id: string; name: string | null }[]).map((l) => ({
      id: l.id,
      nome: l.name ?? '',
    }));
  const ids = ordenarCandidatos(
    termo,
    daRpc.error ? [] : nomes(daRpc.data),
    doTrecho.error ? [] : nomes(doTrecho.data),
    MAX_NO_AUTOCOMPLETAR,
  );
  const alvos = await hidratarAlvos(ids);
  return alvos.map((alvo) => ({ ...alvo, origem: 'busca' as const, motivo: null }));
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

/**
 * Fecha a REUNIÃO depois que o desfecho foi gravado.
 *
 * Irmã de `concluirCompromisso`, e não substituta dela: a tarefa é o eco que o
 * pulso do dia e o dreno leem, e a reunião é a verdade. Fechar só a tarefa deixa
 * a linha em `reunioes` viva para sempre — segurando o horário na trava de
 * colisão e contando no teto de 4 do dia.
 *
 * Falhar aqui NÃO é falhar o registro: o registro está gravado. Devolve `false`
 * e a tela avisa.
 */
export async function fecharReuniao(
  reuniaoId: string,
  estado: 'realizada' | 'nao_compareceu',
): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('reuniao_desfecho', {
    p_id: reuniaoId,
    p_estado: estado,
  });
  if (error) return false;
  return (data as { ok?: boolean } | null)?.ok === true;
}

'use client';

import { createClient } from '@/lib/supabase/client';
import { hojeEmNatal, janelaDeDias } from '@/components/agenda/tipos';

import type { RegistroDoDia } from './feito';
import { textoDaPrevia } from './novo';
import { lerPrimeiraResposta, type PrimeiraResposta } from './primeira-resposta';
import {
  ehTipoConhecido,
  hojeParaOCorte,
  montarProximosDias,
  type ItemDoDia,
  type MetricaDoDia,
  type NegocioDaTarefa,
  type ParceiroDaTarefa,
  type TarefaFutura,
  type TipoDeItem,
} from './tipos';

/**
 * As duas leituras da tela, ambas em funções `security definer` do banco:
 * `public.meu_dia` (a fila) e `public.goal_progress` (meta × realizado do dia).
 * Sem `p_user_id`, cada uma devolve a fila e as metas de quem está autenticado, que
 * é o contrato de "meu" dia. Com ele, o dia de quem o gestor ou o admin escolheu no
 * seletor (`lib/auth/hierarquia.ts`).
 */

/** Teto da fila. O banco corta em 300; 60 já é mais do que cabe num dia de trabalho. */
export const LIMITE_DA_FILA = 60;

/** Uma linha crua de `public.meu_dia`. O tipo gerado declara tudo não-nulo; não é. */
export type LinhaDaFila = {
  prioridade: number | null;
  tipo: string | null;
  motivo: string | null;
  titulo: string | null;
  quando: string | null;
  atraso_horas: number | string | null;
  task_id: string | null;
  activity_id: string | null;
  deal_id: string | null;
  organization_id: string | null;
  organizacao: string | null;
  bairro: string | null;
  categoria: string | null;
  temperatura: string | null;
  funil: string | null;
  etapa: string | null;
  /** Opcional no tipo cru de propósito: uma RPC velha em cache não a devolve. */
  atendente?: string | null;
};

type LinhaDeMetrica = {
  metrica: string | null;
  metrica_rotulo: string | null;
  meta: number | null;
  realizado: number | null;
  percentual: number | string | null;
  mensuravel: boolean | null;
  fonte: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
};

/** `numeric` do Postgres chega como string no PostgREST quando é grande; normaliza. */
function numero(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const n = typeof valor === 'number' ? valor : Number.parseFloat(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * A fronteira, numa função pura e exportada: é AQUI que a mentira do tipo gerado
 * (tudo não-nulo) vira campo honestamente opcional, e é aqui que uma coluna nova
 * pode faltar. `atendente` chegou em 28/09/2026 (ADR-17), e uma aba aberta desde
 * antes do deploy chama a RPC antiga — a linha volta sem o campo, e `?? null` é
 * o que impede isso de virar `undefined` na tela. Separada de `buscarFilaDoDia`
 * para poder ser medida sem inventar um cliente do Supabase.
 */
export function itemDaLinha(linha: LinhaDaFila): ItemDoDia {
  return {
    prioridade: linha.prioridade ?? 9,
    tipo: tipoDaLinha(linha.tipo),
    motivo: linha.motivo ?? 'Sem motivo registrado',
    titulo: linha.titulo ?? linha.organizacao ?? 'Sem título',
    quando: linha.quando,
    atrasoHoras: numero(linha.atraso_horas),
    tarefaId: linha.task_id,
    atividadeId: linha.activity_id,
    negocioId: linha.deal_id,
    organizacaoId: linha.organization_id,
    organizacao: linha.organizacao,
    bairro: linha.bairro,
    categoria: linha.categoria,
    temperatura: linha.temperatura as ItemDoDia['temperatura'],
    funil: linha.funil,
    etapa: linha.etapa,
    atendente: linha.atendente ?? null,
  };
}

/**
 * `pessoaId` só vai quando o gestor ou o admin abre o dia de outra pessoa; para o
 * próprio dia a chamada continua sem ele, exatamente como antes. A função do banco
 * recusa outra pessoa para quem não é gestor nem admin (42501).
 *
 * Atenção ao bloco de quem respondeu no dia de outra pessoa: a `meu_dia` recorta
 * pelo papel de QUEM A FILA É, e para admin, gestor e sdr ele é a fila de todos,
 * e não a dessa pessoa (ver `alcanceDeQuemRespondeu` em `tipos.ts`).
 */
export async function buscarFilaDoDia(pessoaId?: string): Promise<ItemDoDia[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('meu_dia', {
    p_limite: LIMITE_DA_FILA,
    ...(pessoaId ? { p_user_id: pessoaId } : {}),
  });
  if (error) throw new ErroDoDia(error.message, error.code);

  const linhas = (data ?? []) as unknown as LinhaDaFila[];
  return linhas.map(itemDaLinha);
}

function tipoDaLinha(valor: string | null): TipoDeItem {
  return valor && ehTipoConhecido(valor) ? valor : 'outro';
}

export async function buscarResumoDoDia(pessoaId?: string): Promise<MetricaDoDia[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('goal_progress', {
    p_period: 'day',
    ...(pessoaId ? { p_user_id: pessoaId } : {}),
  });
  if (error) throw new ErroDoDia(error.message, error.code);

  const linhas = (data ?? []) as unknown as LinhaDeMetrica[];
  return linhas.map((linha) => ({
    metrica: linha.metrica ?? '',
    rotulo: linha.metrica_rotulo ?? linha.metrica ?? '',
    meta: linha.meta,
    realizado: linha.realizado,
    percentual: numero(linha.percentual),
    mensuravel: linha.mensuravel ?? true,
    fonte: linha.fonte ?? '',
    periodoInicio: linha.periodo_inicio ?? '',
    periodoFim: linha.periodo_fim ?? '',
  }));
}

/**
 * Quantos negócios abertos ainda não têm responsável.
 *
 * Só é consultado quando a fila volta vazia, e existe para não deixar a tela mentir
 * pelo silêncio: hoje a base de 100 negócios entrou pela lista-semente com
 * `owner_id` nulo de propósito ("a triagem distribui depois"), então a fila de todo
 * mundo nasce vazia. "Fila zerada, parabéns" seria falso — o trabalho existe, só não
 * tem dono. Falhar aqui não é motivo para quebrar a tela: devolve `null` e o estado
 * vazio volta a ser o genérico.
 */
export async function contarNegociosSemResponsavel(): Promise<number | null> {
  const supabase = createClient();
  const { count, error } = await supabase
    .from('deals')
    .select('id', { count: 'exact', head: true })
    .is('owner_id', null)
    .eq('status', 'open');
  if (error) return null;
  return count ?? 0;
}

/**
 * Quantos candidatos na Revisão esperam uma decisão.
 *
 * Pelo mesmo motivo da contagem acima, e para desfazer a mesma mentira por outro
 * lado: a fila do dia enxerga tarefa, atividade e negócio, e candidato não é
 * nenhum dos três — candidato só vira alvo depois que alguém aprova. Com a fila
 * vazia, essa pilha costuma ser o único trabalho que existe, e a tela que existe
 * para mostrar trabalho não pode ser a única a não saber dele.
 *
 * A RLS de `supplier_candidates` exige `app.can_write()`: para `leitura` e
 * `financeiro` a contagem volta zero (nenhuma linha visível, sem erro), e a tela
 * deixa de oferecer um caminho que essas pessoas não podem percorrer. Falhar aqui
 * não quebra nada: devolve `null` e o vazio volta a ser o genérico.
 */
export async function contarCandidatosAguardandoRevisao(): Promise<number | null> {
  const supabase = createClient();
  const { count, error } = await supabase
    .from('supplier_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'novo');
  if (error) return null;
  return count ?? 0;
}

/**
 * Teto dos "Próximos dias". É folga, e não corte de trabalho: 300 compromissos à
 * frente de uma pessoa só é mais do que a agenda dela comporta em dois meses.
 */
export const LIMITE_DOS_PROXIMOS = 300;

/**
 * Quantos ids vão por consulta. O filtro `in` viaja na URL, e 600 uuids são uns
 * 22 KB de endereço — acima do que um gateway costuma aceitar. Em lotes de 100
 * cada URL fica em torno de 4 KB.
 */
const IDS_POR_LOTE = 100;

function emLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

const COLUNAS_DA_TAREFA_FUTURA = 'id, title, due_at, deal_id, organization_id' as const;

type LinhaDeNegocioDaTarefa = {
  id: string;
  temperature: NegocioDaTarefa['temperature'];
  stages: { name: string } | { name: string }[] | null;
  pipelines: { name: string } | { name: string }[] | null;
};

/** O PostgREST devolve o embed como objeto ou como lista de um, conforme a relação. */
function nomeDoEmbed(valor: { name: string } | { name: string }[] | null): string | null {
  const um = Array.isArray(valor) ? valor[0] : valor;
  return um?.name ?? null;
}

/**
 * Os compromissos à frente de uma pessoa, lidos direto de `tasks` — e não da
 * fila, cujo teto os deixava de fora (ver `montarProximosDias` em `tipos.ts`).
 *
 * Só `select`, sob a RLS de quem entrou: `tasks_select` deixa cada um ler as
 * suas, e admin, gestor e sdr lerem as de quem acompanham. Duas consultas de
 * tarefa (com prazo depois de hoje, e sem prazo) e, só se houver tarefa, os
 * parceiros e os negócios delas.
 */
export async function buscarProximosDias(
  usuarioId: string,
  hoje: string,
  /** Quem LÊ enxerga a base inteira (`app.sees_all`)? O embaixador não. */
  leitorVeTudo: boolean,
): Promise<ItemDoDia[]> {
  const supabase = createClient();
  // 00:00 de amanhã em Natal: "depois de hoje" é dia de calendário, como na função.
  //
  // O dia é o de AGORA, e não só o que o servidor mandou ao abrir a tela (ver
  // `hojeParaOCorte`): app aberto desde ontem não traz as tarefas de hoje para cá.
  const diaDoCorte = hojeParaOCorte(hoje, hojeEmNatal());
  const { ate: amanha } = janelaDeDias(diaDoCorte, diaDoCorte);

  const abertas = () =>
    supabase
      .from('tasks')
      .select(COLUNAS_DA_TAREFA_FUTURA)
      .eq('assignee_id', usuarioId)
      .in('status', ['todo', 'doing']);

  const [comPrazo, semPrazo] = await Promise.all([
    // O `id` desempata: duas tarefas no mesmo horário (a régua de cadência cria
    // várias às 09:00) trocavam de lugar entre uma recarga e outra.
    abertas().gte('due_at', amanha).order('due_at').order('id').limit(LIMITE_DOS_PROXIMOS),
    abertas().is('due_at', null).order('created_at').order('id').limit(LIMITE_DOS_PROXIMOS),
  ]);
  const erro = comPrazo.error ?? semPrazo.error;
  if (erro) throw new ErroDoDia(erro.message, erro.code);

  const tarefas = [...(comPrazo.data ?? []), ...(semPrazo.data ?? [])] as unknown as TarefaFutura[];
  if (tarefas.length === 0) return [];

  const orgIds = [...new Set(tarefas.flatMap((t) => t.organization_id ?? []))];
  const dealIds = [...new Set(tarefas.flatMap((t) => t.deal_id ?? []))];

  const [parceiros, negocios] = await Promise.all([
    Promise.all(
      emLotes(orgIds, IDS_POR_LOTE).map((lote) =>
        supabase
          .from('organizations_view')
          .select('id, name, neighborhood, primary_category_name, do_not_contact')
          .in('id', lote),
      ),
    ),
    Promise.all(
      emLotes(dealIds, IDS_POR_LOTE).map((lote) =>
        supabase
          .from('deals')
          .select('id, temperature, stages(name), pipelines(name)')
          .in('id', lote),
      ),
    ),
  ]);
  // Sem os parceiros não dá para saber quem saiu da base: falha a aba inteira.
  const erroDeParceiro = parceiros.find((r) => r.error)?.error;
  if (erroDeParceiro) throw new ErroDoDia(erroDeParceiro.message, erroDeParceiro.code);
  // O negócio só enfeita a linha (funil e etapa): o lote que não vier deixa as
  // linhas dele sem os dois.
  const linhasDeNegocio = negocios.flatMap((r) =>
    r.error ? [] : ((r.data ?? []) as unknown as LinhaDeNegocioDaTarefa[]),
  );

  return montarProximosDias({
    tarefas,
    parceiroForaDaVista: leitorVeTudo ? 'descarta' : 'mantem',
    parceiros: parceiros.flatMap((r) => (r.data ?? []) as unknown as ParceiroDaTarefa[]),
    negocios: linhasDeNegocio.map((n) => ({
      id: n.id,
      temperature: n.temperature,
      funil: nomeDoEmbed(n.pipelines),
      etapa: nomeDoEmbed(n.stages),
    })),
  });
}

/** Teto do "Feito hoje". Um dia cheio de campo passa de 40 registros; 200 é folga. */
const LIMITE_DO_FEITO = 200;

type LinhaDeAtividade = {
  id: string;
  occurred_at: string;
  organization_id: string | null;
  interaction_outcomes: RegistroDoDia['desfecho'] | null;
};

type LinhaDeParceiro = {
  id: string | null;
  name: string | null;
  neighborhood: string | null;
  primary_category_name: string | null;
};

/**
 * O que a pessoa registrou hoje (em `America/Fortaleza`), com resultado.
 *
 * Duas leituras sob a RLS de quem entrou, sem RPC nova:
 *
 * 1. `activities` da pessoa do dia (`user_id`) com `outcome_id` preenchido, com o
 *    desfecho embutido pela chave estrangeira. A política `activities_select` já deixa
 *    o `sdr` ler; o filtro por `user_id` é o que faz deste o "meu" dia — ou o dia de
 *    quem o gestor escolheu no seletor, que enxerga tudo por `app.sees_all()`.
 * 2. `organizations_view`, e não `organizations`, pelo mesmo motivo da Agenda: a
 *    `sdr` não lê a tabela base, e a view aplica `app.org_is_visible`.
 */
export async function buscarFeitoHoje(usuarioId: string, hoje: string): Promise<RegistroDoDia[]> {
  const supabase = createClient();
  // `hoje` vem do servidor, o mesmo do cabeçalho e do "Amanhã" dos próximos dias:
  // calculado aqui, uma aba aberta depois da meia-noite misturava dois dias na tela.
  const { de, ate } = janelaDeDias(hoje, hoje);

  const { data, error } = await supabase
    .from('activities')
    .select(
      'id, occurred_at, organization_id, interaction_outcomes(slug, name, surfaces, target_stage_slug, sets_temperature)',
    )
    .eq('user_id', usuarioId)
    .not('outcome_id', 'is', null)
    .gte('occurred_at', de)
    .lt('occurred_at', ate)
    .order('occurred_at', { ascending: false })
    .limit(LIMITE_DO_FEITO);
  if (error) throw new ErroDoDia(error.message, error.code);

  const linhas = ((data ?? []) as unknown as LinhaDeAtividade[]).filter(
    (linha) => linha.interaction_outcomes !== null,
  );
  const orgIds = [
    ...new Set(linhas.map((linha) => linha.organization_id).filter((id) => id !== null)),
  ];

  const parceiros = new Map<string, LinhaDeParceiro>();
  if (orgIds.length > 0) {
    const resposta = await supabase
      .from('organizations_view')
      .select('id, name, neighborhood, primary_category_name')
      .in('id', orgIds);
    if (resposta.error) throw new ErroDoDia(resposta.error.message, resposta.error.code);
    for (const parceiro of (resposta.data ?? []) as LinhaDeParceiro[]) {
      if (parceiro.id) parceiros.set(parceiro.id, parceiro);
    }
  }

  return linhas.map((linha) => {
    const parceiro = linha.organization_id ? parceiros.get(linha.organization_id) : undefined;
    return {
      atividadeId: linha.id,
      quando: linha.occurred_at,
      organizacaoId: linha.organization_id,
      organizacao: parceiro?.name ?? null,
      bairro: parceiro?.neighborhood ?? null,
      categoriaDoParceiro: parceiro?.primary_category_name ?? null,
      desfecho: linha.interaction_outcomes as RegistroDoDia['desfecho'],
    };
  });
}

// ---------------------------------------------------------------------------
// Meu dia novo da Imova (módulo `meuDiaNovo`): duas leituras a mais, só `select`
// ---------------------------------------------------------------------------

/**
 * A última mensagem que cada lead mandou, para a prévia na linha de quem respondeu.
 *
 * Uma consulta por parceiro, com `limit(1)`, e não um `in` só: com um `in` e um teto
 * de linhas, um lead que mandou vinte mensagens seguidas tomaria o lugar dos outros.
 * São no máximo 15 (o teto de conversas da `public.meu_dia`), em paralelo.
 *
 * Sob a RLS de quem entrou (`messages_select`), a mesma de Conversas. A prévia é um
 * acréscimo: se a leitura de um parceiro falhar, a linha fica sem prévia, e a fila
 * continua de pé — por isso aqui não se lança erro.
 */
export async function buscarUltimasMensagens(
  orgIds: readonly string[],
): Promise<Record<string, string>> {
  if (orgIds.length === 0) return {};
  const supabase = createClient();
  const respostas = await Promise.all(
    orgIds.map((id) =>
      supabase
        .from('messages')
        .select('organization_id, body, type, transcript')
        .eq('organization_id', id)
        .eq('direction', 'in')
        .order('created_at', { ascending: false })
        .limit(1),
    ),
  );
  const previas: Record<string, string> = {};
  for (const resposta of respostas) {
    const linha = resposta.data?.[0] as
      | {
          organization_id: string | null;
          body: string | null;
          type: string;
          transcript: string | null;
        }
      | undefined;
    if (resposta.error || !linha?.organization_id) continue;
    const texto = textoDaPrevia(linha);
    if (texto) previas[linha.organization_id] = texto;
  }
  return previas;
}

/** Um compromisso de hoje, para a coluna "Agenda de hoje" ao lado da fila. */
export type CompromissoDeHoje = {
  id: string;
  titulo: string;
  quando: string;
  tipo: 'meeting' | 'visit';
  feito: boolean;
  organizacaoId: string | null;
  organizacao: string | null;
};

/**
 * As reuniões e visitas de hoje de uma pessoa, feitas ou não (a feita aparece
 * riscada: a agenda do dia é o dia inteiro, e não só o que falta). Direto de
 * `tasks`, sob a mesma RLS de `buscarProximosDias`; os nomes, pela
 * `organizations_view`, como lá.
 */
export async function buscarAgendaDeHoje(
  usuarioId: string,
  hoje: string,
): Promise<CompromissoDeHoje[]> {
  const supabase = createClient();
  const diaDoCorte = hojeParaOCorte(hoje, hojeEmNatal());
  const { de, ate } = janelaDeDias(diaDoCorte, diaDoCorte);

  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, due_at, kind, status, organization_id')
    .eq('assignee_id', usuarioId)
    .in('kind', ['meeting', 'visit'])
    .in('status', ['todo', 'doing', 'done'])
    .gte('due_at', de)
    .lt('due_at', ate)
    .order('due_at')
    .order('id')
    .limit(30);
  if (error) throw new ErroDoDia(error.message, error.code);

  const linhas = (data ?? []) as unknown as {
    id: string;
    title: string;
    due_at: string;
    kind: 'meeting' | 'visit';
    status: string;
    organization_id: string | null;
  }[];
  const orgIds = [...new Set(linhas.flatMap((l) => l.organization_id ?? []))];

  const nomes = new Map<string, string>();
  if (orgIds.length > 0) {
    const resposta = await supabase.from('organizations_view').select('id, name').in('id', orgIds);
    if (resposta.error) throw new ErroDoDia(resposta.error.message, resposta.error.code);
    for (const parceiro of (resposta.data ?? []) as { id: string | null; name: string | null }[]) {
      if (parceiro.id && parceiro.name) nomes.set(parceiro.id, parceiro.name);
    }
  }

  return linhas.map((linha) => ({
    id: linha.id,
    titulo: linha.title,
    quando: linha.due_at,
    tipo: linha.kind,
    feito: linha.status === 'done',
    organizacaoId: linha.organization_id,
    organizacao: linha.organization_id ? (nomes.get(linha.organization_id) ?? null) : null,
  }));
}

/**
 * A primeira resposta do dia (Meu dia novo da Imova, 11/11/2026): quem espera a
 * resposta do time agora, as esperas respondidas no dia (mediana em minutos de
 * expediente e quantas no alvo) e, para admin e gestor, a equipe. Uma leitura
 * só, `public.meu_dia_primeira_resposta`, que confere no banco se quem lê pode
 * ver o dia de `pessoaId` (a mesma hierarquia do seletor) e recusa na KOMUNE.
 */
export async function buscarPrimeiraResposta(
  pessoaId: string | undefined,
  dia: string,
): Promise<PrimeiraResposta> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('meu_dia_primeira_resposta', {
    ...(pessoaId ? { p_pessoa: pessoaId } : {}),
    p_dia: dia,
  });
  if (error) throw new ErroDoDia(error.message, error.code);
  return lerPrimeiraResposta(data);
}

/** Erro do banco com o código preservado, para a tela traduzir em vez de exibir cru. */
export class ErroDoDia extends Error {
  readonly codigo: string | undefined;

  constructor(mensagem: string, codigo?: string) {
    super(mensagem);
    this.name = 'ErroDoDia';
    this.codigo = codigo;
  }
}

/**
 * O que dizer quando falha. Nunca o texto do Postgres: "permission denied for
 * function meu_dia" não diz a ninguém o que fazer, e "42501" menos ainda.
 */
export function mensagemDoErro(erro: unknown): string {
  const codigo = erro instanceof ErroDoDia ? erro.codigo : undefined;
  const texto = erro instanceof Error ? erro.message : '';

  if (codigo === '42501' || /não autenticado|not authenticated|jwt/i.test(texto)) {
    return 'A sua sessão expirou. Entre de novo para ver a fila.';
  }
  if (codigo === 'PGRST202' || /could not find the function/i.test(texto)) {
    return 'Esta versão do aplicativo está mais nova que a do banco. Avise no grupo do time.';
  }
  if (/fetch|network|failed to fetch/i.test(texto)) {
    return 'O aplicativo não alcançou o servidor. Confira a conexão.';
  }
  return 'O servidor não respondeu como esperado.';
}

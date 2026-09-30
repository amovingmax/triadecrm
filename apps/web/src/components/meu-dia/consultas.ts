'use client';

import { createClient } from '@/lib/supabase/client';
import { janelaDeDias } from '@/components/agenda/tipos';

import type { RegistroDoDia } from './feito';
import { ehTipoConhecido, type ItemDoDia, type MetricaDoDia, type TipoDeItem } from './tipos';

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

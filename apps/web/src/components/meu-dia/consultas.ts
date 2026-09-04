'use client';

import { createClient } from '@/lib/supabase/client';

import { ehTipoConhecido, type ItemDoDia, type MetricaDoDia, type TipoDeItem } from './tipos';

/**
 * As duas leituras da tela, ambas em funções `security definer` do banco:
 * `public.meu_dia` (a fila) e `public.goal_progress` (meta × realizado do dia).
 * Nenhuma das duas aceita parâmetro de pessoa aqui: sem `p_user_id`, cada uma
 * devolve a fila e as metas de quem está autenticado, que é o contrato de "meu" dia.
 */

/** Teto da fila. O banco corta em 300; 60 já é mais do que cabe num dia de trabalho. */
export const LIMITE_DA_FILA = 60;

/** Uma linha crua de `public.meu_dia`. O tipo gerado declara tudo não-nulo; não é. */
type LinhaDaFila = {
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

export async function buscarFilaDoDia(): Promise<ItemDoDia[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('meu_dia', { p_limite: LIMITE_DA_FILA });
  if (error) throw new ErroDoDia(error.message, error.code);

  const linhas = (data ?? []) as unknown as LinhaDaFila[];
  return linhas.map((linha) => ({
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
  }));
}

function tipoDaLinha(valor: string | null): TipoDeItem {
  return valor && ehTipoConhecido(valor) ? valor : 'outro';
}

export async function buscarResumoDoDia(): Promise<MetricaDoDia[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('goal_progress', { p_period: 'day' });
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

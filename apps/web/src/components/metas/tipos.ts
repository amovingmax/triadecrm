import type { GoalMetric } from '@komune/schema';

import type { AppRole } from '@/lib/auth/role';

import type { Periodo } from './periodo';

/**
 * Uma linha de `public.goal_progress`: uma métrica de uma pessoa num período.
 *
 * O tipo gerado (`packages/schema/src/database.types.ts`) declara `meta`,
 * `percentual`, `ritmo_necessario` e `pessoa_nome` como não-nulos, porque o gerador
 * do Supabase não enxerga nulo em coluna de `returns table`. Eles SÃO nulos na
 * prática (sem meta definida, período passado, pessoa fora do diretório), e é
 * justamente o nulo que a tela precisa distinguir do zero: "sem meta" e "meta zero"
 * são coisas diferentes. Por isso a linha é declarada aqui, à mão, com os nulos.
 */
export type LinhaProgresso = {
  pessoa_id: string;
  pessoa_nome: string | null;
  metrica: string;
  metrica_rotulo: string;
  periodo: Periodo;
  periodo_inicio: string;
  periodo_fim: string;
  meta: number | null;
  realizado: number | null;
  percentual: number | null;
  dias_uteis_total: number;
  dias_uteis_decorridos: number;
  ritmo_necessario: number | null;
  /** `false` quando a métrica ainda não tem de onde sair (ex.: o inbox do D5). */
  mensuravel: boolean;
  /** Como o número é contado, em uma frase escrita no próprio banco. */
  fonte: string;
};

/** Quem aparece na tela: o diretório do time, sem PII. */
export type Pessoa = { id: string; nome: string };

/**
 * Espelho de `app.is_manager()`: quem define meta e lê a meta das outras pessoas.
 *
 * A autorização de verdade é a RLS de `public.goals` e a checagem dentro de
 * `public.goal_progress`; isto existe só para a tela não oferecer o que seria
 * negado — e para não montar cartão de gente que o banco não vai devolver.
 */
export const PAPEIS_QUE_DEFINEM_META: readonly AppRole[] = ['admin', 'gestor'];

/**
 * A métrica em destaque no alto de cada cartão.
 *
 * É a meta do plano (PRD RF-MET-01/02: "3 portas abertas por dia"), e é fixa de
 * propósito: o número grande da tela tem de ser sempre o mesmo, senão duas pessoas
 * olham cartões diferentes e discutem sobre eixos diferentes.
 */
export const METRICA_DESTAQUE: GoalMetric = 'doors_opened';

/** Situação de uma métrica no período, para escolher a frase (nunca a cor). */
export type Situacao =
  | 'nao_mensuravel' // não há de onde tirar o número ainda
  | 'sem_meta' // ninguém definiu alvo para este período
  | 'sem_dia_util' // domingo, feriado: o período não tem dia útil
  | 'futuro' // o período ainda não começou
  | 'batida' // realizado >= meta
  | 'no_ritmo' // acompanha os dias úteis decorridos
  | 'atras'; // abaixo do que os dias decorridos pediriam

/** Quanto do período já passou, em dias úteis (0 a 1). */
export function fracaoDecorrida(linha: LinhaProgresso): number {
  if (linha.dias_uteis_total <= 0) return 0;
  return Math.min(1, linha.dias_uteis_decorridos / linha.dias_uteis_total);
}

/** Quanto já deveria estar feito a esta altura do período, para bater a meta no fim. */
export function esperadoAteAgora(linha: LinhaProgresso): number | null {
  if (linha.meta === null) return null;
  return linha.meta * fracaoDecorrida(linha);
}

export function situacaoDaLinha(linha: LinhaProgresso): Situacao {
  if (!linha.mensuravel) return 'nao_mensuravel';
  if (linha.meta === null) return 'sem_meta';
  const feito = linha.realizado ?? 0;
  if (feito >= linha.meta) return 'batida';
  if (linha.dias_uteis_total <= 0) return 'sem_dia_util';
  if (linha.dias_uteis_decorridos <= 0) return 'futuro';
  return feito >= (esperadoAteAgora(linha) ?? 0) ? 'no_ritmo' : 'atras';
}

/** Percentual 0..100 para a barra (a barra nunca passa de 100; o texto sim). */
export function percentualDaBarra(linha: LinhaProgresso): number {
  if (linha.meta === null || linha.meta <= 0) return 0;
  return Math.min(100, ((linha.realizado ?? 0) * 100) / linha.meta);
}

/** `true` quando o número é um proxy declarado pelo banco (a fonte de verdade é outra). */
export function ehProxy(linha: LinhaProgresso): boolean {
  return linha.fonte.startsWith('PROXY');
}

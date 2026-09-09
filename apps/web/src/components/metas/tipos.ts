import type { GoalMetric } from '@komune/schema';

import { ROTULO_PAPEL, type AppRole } from '@/lib/auth/role';

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
  /**
   * `false` quando a métrica ainda não tem de onde sair. Desde
   * `20260909170000_a_meta_de_resposta_passa_a_ser_medivel.sql` as dez saem, mas a
   * coluna e o tratamento dela ficam: quem responde "dá para medir?" é o banco, e
   * a tela lê a resposta em vez de saber de cor qual métrica está ligada.
   */
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
 * Espelho de `app.can_write()`: quem o banco deixa registrar trabalho.
 *
 * É a mesma lista de `lib/navegacao.ts`, e pelo mesmo motivo: no banco é uma
 * função só, e quem não passa por ela não grava atividade, não cria organização e
 * não move negócio de etapa. Toda métrica de `goal_progress` conta exatamente
 * isso — `activities`, `deal_stage_history`, `organizations` —, então para quem é
 * `leitura`, `financeiro` ou `bot` o realizado nasce zero e morre zero.
 *
 * Quem decide continua sendo o Postgres. Isto aqui não recusa nada: serve para a
 * tela poder DIZER, antes de alguém combinar um número, por que aquele número não
 * vai se mexer. Se `app.can_write()` mudar de lista, esta frase passa a mentir —
 * é o preço de espelhar, e o mesmo que os outros espelhos dessa função já pagam.
 */
export const PAPEIS_QUE_REGISTRAM_TRABALHO: readonly AppRole[] = [
  'admin',
  'gestor',
  'sdr',
  'embaixador',
];

/**
 * Por que o realizado desta pessoa vai ficar em zero — ou `null` quando não vai.
 *
 * A tela AVISA e não impede, de propósito. Impedir seria inventar uma recusa que o
 * banco não faz: a RLS de `public.goals` aceita meta para qualquer perfil, e pode
 * ser combinado de propósito (alguém que troca de papel na semana que vem, um
 * acordo registrado no 1:1). Quem decide se isso vira bloqueio é Rafael; enquanto
 * não decide, o gestor tem o fato na frente antes de salvar, que é o que faltava.
 *
 * `papel` indefinido não vira aviso: o diretório pode não ter respondido ainda, e
 * avisar por falta de resposta seria acusar sem prova.
 */
export function porQueFicaEmZero(
  papel: AppRole | undefined,
  nome: string,
  ehVoce: boolean,
): string | null {
  if (papel === undefined || PAPEIS_QUE_REGISTRAM_TRABALHO.includes(papel)) return null;

  const rotulo = ROTULO_PAPEL[papel];
  if (ehVoce) {
    return `O seu papel é ${rotulo}, e o Tríade não registra porta, ligação, visita nem cadastro em nome desse papel. Os números abaixo ficam em zero por isso, e não por falta de registro seu. Quem troca papel é o admin, na Administração.`;
  }
  return `${nome} tem o papel ${rotulo}, e o Tríade não registra porta, ligação, visita nem cadastro em nome desse papel. A meta definida aqui fica em zero até um admin trocar o papel, na Administração.`;
}

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

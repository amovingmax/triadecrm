import { MODELOS, type MetadadosDePrompt, type ModeloAlvo } from './versionamento';

/**
 * Custo por chamada e projeção mensal (PRD §10 "Custos": alerta a 80% do orçamento;
 * ADR-10; `ai_runs.cost_usd`).
 *
 * Os preços são os da API da Anthropic (primeira parte), em dólar por milhão de tokens,
 * conferidos em 05/09/2026. Cache e Batch seguem a regra da plataforma: escrita de cache
 * a 1,25× a entrada, leitura a 0,1×, Batch a 0,5× dos dois lados.
 *
 * Este módulo não chama a API e não estima tokens por adivinhação: quem chama passa a
 * contagem (do `count_tokens` ou do `usage` da resposta). O que está aqui são as
 * premissas de volume da operação — duas pessoas, ~60 ligações/dia —, que ficam num
 * lugar só para o documento de custos e o alerta lerem o mesmo número.
 */

export interface PrecoDoModelo {
  /** US$ por milhão de tokens de entrada. */
  readonly entrada: number;
  /** US$ por milhão de tokens de saída. */
  readonly saida: number;
  /** Escrita de cache (5 min): 1,25× a entrada. */
  readonly escritaDeCache: number;
  /** Leitura de cache: 0,1× a entrada. */
  readonly leituraDeCache: number;
}

export const PRECOS: Readonly<Record<ModeloAlvo, PrecoDoModelo>> = {
  [MODELOS.haiku]: { entrada: 1.0, saida: 5.0, escritaDeCache: 1.25, leituraDeCache: 0.1 },
  [MODELOS.sonnet]: { entrada: 2.0, saida: 10.0, escritaDeCache: 2.5, leituraDeCache: 0.2 },
};

/** A Batch API custa metade, nos dois lados. Usada na extração em lote do Radar. */
export const FATOR_BATCH = 0.5 as const;

export interface UsoDeTokens {
  readonly entrada: number;
  readonly saida: number;
  readonly escritaDeCache?: number;
  readonly leituraDeCache?: number;
}

export interface OpcoesDeCusto {
  readonly batch?: boolean;
}

/** Custo em US$ de uma chamada, com 5 casas — a precisão de `ai_runs.cost_usd`. */
export function custoDaChamada(
  modelo: ModeloAlvo,
  uso: UsoDeTokens,
  opcoes: OpcoesDeCusto = {},
): number {
  const preco = PRECOS[modelo];
  const fator = opcoes.batch === true ? FATOR_BATCH : 1;
  const bruto =
    (uso.entrada * preco.entrada +
      uso.saida * preco.saida +
      (uso.escritaDeCache ?? 0) * preco.escritaDeCache +
      (uso.leituraDeCache ?? 0) * preco.leituraDeCache) /
    1_000_000;
  return Math.round(bruto * fator * 1e5) / 1e5;
}

/** Premissas de volume da operação (R13: duas pessoas, ~60 ligações/dia). */
export const VOLUME_MENSAL = {
  diasUteis: 21,
  ligacoesPorDia: 60,
  /** Dos 60 discados, a fração em que alguém atende — e só essas viram resumo. */
  taxaDeAtendimento: 0.35,
  /** Áudios recebidos por dia no WhatsApp de apoio. */
  audiosPorDia: 12,
  /** Mensagens recebidas por dia que passam pelo classificador. */
  mensagensPorDia: 40,
} as const;

export interface ProjecaoDoPrompt {
  readonly id: string;
  readonly versao: number;
  readonly modelo: ModeloAlvo;
  readonly chamadasPorMes: number;
  readonly custoPorChamada: number;
  readonly custoMensal: number;
}

/** O que se espera gastar por chamada, com a contagem estimada de tokens do prompt. */
export function projetar(
  prompt: MetadadosDePrompt,
  uso: UsoDeTokens,
  chamadasPorMes: number,
  opcoes: OpcoesDeCusto = {},
): ProjecaoDoPrompt {
  const custoPorChamada = custoDaChamada(prompt.modelo, uso, opcoes);
  return {
    id: prompt.id,
    versao: prompt.versao,
    modelo: prompt.modelo,
    chamadasPorMes,
    custoPorChamada,
    custoMensal: Math.round(custoPorChamada * chamadasPorMes * 100) / 100,
  };
}

/**
 * Quantas chamadas por mês cada prompt recebe, nas premissas acima.
 *
 * Resumo e follow-up compartilham o mesmo denominador — a ligação atendida —, porque
 * toda ligação atendida gera um resumo e um rascunho de follow-up. Não atendida não
 * gera nenhum dos dois: `lig_nao_atendeu` é tabulação automática, sem texto e sem modelo.
 */
export const LIGACOES_ATENDIDAS_POR_DIA = Math.round(
  VOLUME_MENSAL.ligacoesPorDia * VOLUME_MENSAL.taxaDeAtendimento,
);

export const CHAMADAS_POR_MES: Readonly<Record<string, number>> = {
  'transcricao-audio': VOLUME_MENSAL.audiosPorDia * VOLUME_MENSAL.diasUteis,
  'resumo-ligacao': LIGACOES_ATENDIDAS_POR_DIA * VOLUME_MENSAL.diasUteis,
  'followup-ligacao': LIGACOES_ATENDIDAS_POR_DIA * VOLUME_MENSAL.diasUteis,
  'classificar-intencao': VOLUME_MENSAL.mensagensPorDia * VOLUME_MENSAL.diasUteis,
};

/**
 * Orçamento mensal só da IA, e o ponto em que o alerta dispara (PRD §10: alerta a 80%).
 *
 * O teto de US$ 320/mês do PRD é de infra + APIs inteiras (Supabase, Meta, IA). Este
 * aqui é a fatia da IA. O valor nasce medido: no volume da §"premissas" o gasto projetado
 * é da ordem de US$ 4/mês, e US$ 25 dá folga para o volume triplicar e para os prompts
 * engordarem sem que o alerta vire ruído. **Confirmar com Rafael/Dennis** — é dinheiro,
 * e dinheiro não se define em código.
 */
export const ORCAMENTO_MENSAL_USD = 25 as const;
export const FRACAO_DO_ALERTA = 0.8 as const;
export const LIMITE_DE_ALERTA_USD = ORCAMENTO_MENSAL_USD * FRACAO_DO_ALERTA;

export type SituacaoDoOrcamento = 'ok' | 'ritmo_acima' | 'passou_de_80';

export interface EstadoDoOrcamento {
  readonly gastoUsd: number;
  /** O que o mês fecha se o ritmo até aqui continuar. */
  readonly projecaoDoMesUsd: number;
  readonly situacao: SituacaoDoOrcamento;
}

/**
 * Onde o mês está.
 *
 * Duas perguntas, não uma: quanto já se gastou (o alerta de 80% do PRD) e, antes disso,
 * se o ritmo do mês já aponta para estourar. Num orçamento pequeno, o segundo aviso é o
 * único que chega a tempo de fazer alguma coisa — quando o acumulado bate 80%, o mês já
 * acabou.
 */
export function avaliarOrcamento(
  gastoUsd: number,
  diasUteisDecorridos: number,
  orcamentoUsd: number = ORCAMENTO_MENSAL_USD,
): EstadoDoOrcamento {
  const dias = Math.max(1, Math.min(diasUteisDecorridos, VOLUME_MENSAL.diasUteis));
  const projecao =
    Math.round(((gastoUsd / dias) * VOLUME_MENSAL.diasUteis + Number.EPSILON) * 100) / 100;
  const situacao: SituacaoDoOrcamento =
    gastoUsd >= orcamentoUsd * FRACAO_DO_ALERTA
      ? 'passou_de_80'
      : projecao > orcamentoUsd
        ? 'ritmo_acima'
        : 'ok';
  return { gastoUsd, projecaoDoMesUsd: projecao, situacao };
}

/** true quando o gasto acumulado do mês passou de 80% do orçamento (PRD §10). */
export function passouDoAlerta(gastoAcumuladoUsd: number): boolean {
  return gastoAcumuladoUsd >= LIMITE_DE_ALERTA_USD;
}

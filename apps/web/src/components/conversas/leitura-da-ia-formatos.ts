import { INTENCOES_DA_FICHA } from '@komune/prompts';

import { ROTULO_INTENCAO } from './mensagens';

/**
 * A leitura da IA sobre uma conversa, traduzida para o que uma pessoa lê.
 *
 * ===========================================================================
 * POR QUE ESTE ARQUIVO EXISTE SEPARADO DO COMPONENTE
 * ===========================================================================
 * O que a IA devolve é vocabulário de banco: `pediu_proposta`, `sumiu_apos_preco`,
 * `PRONTO_PARA_FECHAR`. Nada disso vai para a tela cru. A tradução e a ORDEM em que
 * a evidência aparece são a parte que decide se a pessoa confia no número — e por
 * isso são código testável, não JSX.
 *
 * ===========================================================================
 * A REGRA DA ORDEM
 * ===========================================================================
 * O score sozinho não convence ninguém, e não deveria. O que convence é a
 * evidência, e ela aparece na ordem em que uma pessoa a cobraria: primeiro o que
 * pesa contra (é o que muda o dia de quem lê), depois o que pesa a favor, e dentro
 * de cada grupo o forte antes do fraco. Um sinal fraco no topo faz a leitura
 * inteira parecer frouxa.
 */

export type PolaridadeDoSinal = 'positivo' | 'negativo';
export type ForcaDoSinal = 'forte' | 'fraco';

export interface SinalDaLeitura {
  readonly tipo: string;
  readonly polaridade: PolaridadeDoSinal;
  readonly forca: ForcaDoSinal;
  /** A mensagem que prova o sinal. É o que faz a leitura ser verificável. */
  readonly messageId: string | null;
  readonly trecho: string;
}

/**
 * O rótulo de cada sinal, em português de gente.
 *
 * `Record<string, string>` com busca por chave e recuo explícito: os sinais vêm do
 * prompt, e um `SINAIS_POSITIVOS` novo não pode deixar a tela em branco no meio de
 * uma conversa. Quando não houver rótulo, o próprio nome do sinal aparece legível
 * ("sumiu apos preco"), que é feio mas honesto.
 */
export const ROTULO_DO_SINAL: Readonly<Record<string, string>> = {
  // A favor
  pediu_orcamento: 'pediu orçamento',
  pediu_proposta: 'pediu proposta',
  informou_data: 'informou a data',
  informou_volume: 'informou quantas pessoas',
  informou_orcamento: 'informou o orçamento',
  perguntou_pagamento: 'perguntou como paga',
  pediu_contrato: 'pediu o contrato',
  confirmou_fechamento: 'confirmou o fechamento',
  envolveu_decisor: 'chamou quem decide',
  urgencia: 'tem pressa',
  // Contra
  vou_pensar: 'disse que vai pensar',
  objecao_preco: 'reclamou do preço',
  comparou_concorrente: 'comparou com concorrente',
  sumiu_apos_preco: 'sumiu depois do preço',
  reclamacao: 'reclamou',
  data_passou: 'a data já passou',
  fechou_com_outro: 'fechou com outro',
  sem_interesse: 'não tem interesse',
  respostas_curtas: 'responde por monossílabo',
};

export function rotuloDoSinal(tipo: string): string {
  return ROTULO_DO_SINAL[tipo] ?? tipo.replace(/_/g, ' ');
}

/**
 * As três intenções que o CRM Inteligente acrescentou às 25 do R08. O `Record`
 * fechado é de propósito, como o de `ROTULO_INTENCAO`: intenção nova sem frase
 * quebra o typecheck em vez de aparecer em caixa alta na tela.
 */
const ROTULO_DAS_TRES: Record<'PEDIU_PROPOSTA' | 'PRONTO_PARA_FECHAR' | 'RECLAMACAO', string> = {
  PEDIU_PROPOSTA: 'pediu proposta',
  PRONTO_PARA_FECHAR: 'pronto para fechar',
  RECLAMACAO: 'reclamou',
};

export function rotuloDaIntencao(intencao: string | null): string | null {
  if (intencao === null) return null;
  if (intencao in ROTULO_DAS_TRES) {
    return ROTULO_DAS_TRES[intencao as keyof typeof ROTULO_DAS_TRES];
  }
  const conhecida = (INTENCOES_DA_FICHA as readonly string[]).includes(intencao);
  if (!conhecida) return null;
  return ROTULO_INTENCAO[intencao as keyof typeof ROTULO_INTENCAO] ?? null;
}

/** Contra antes de a favor; forte antes de fraco. A ordem é o argumento. */
export function ordenarSinais(sinais: readonly SinalDaLeitura[]): SinalDaLeitura[] {
  const peso = (s: SinalDaLeitura): number =>
    (s.polaridade === 'negativo' ? 0 : 2) + (s.forca === 'forte' ? 0 : 1);
  return [...sinais].sort((a, b) => peso(a) - peso(b));
}

export const ALERTAS_DA_LEITURA: Readonly<Record<string, string>> = {
  reclamacao: 'reclamação em aberto',
  concorrente_citado: 'citou concorrente',
  pediu_proposta: 'proposta pedida',
  pronto_para_fechar: 'pronto para fechar',
  risco_perda: 'risco de perder',
};

export function rotuloDoAlerta(alerta: string): string {
  return ALERTAS_DA_LEITURA[alerta] ?? alerta.replace(/_/g, ' ');
}

/**
 * A faixa do score, no vocabulário da rubrica do prompt. Não é temperatura — a
 * temperatura continua sendo a do banco —, e por isso tem nome próprio.
 */
export type FaixaDoScore = 'sem_interesse' | 'vago' | 'interesse' | 'engajado' | 'quer_fechar';

export function faixaDoScore(score: number | null): FaixaDoScore | null {
  if (score === null) return null;
  if (score >= 80) return 'quer_fechar';
  if (score >= 60) return 'engajado';
  if (score >= 40) return 'interesse';
  if (score >= 20) return 'vago';
  return 'sem_interesse';
}

export const ROTULO_DA_FAIXA: Record<FaixaDoScore, string> = {
  quer_fechar: 'quer fechar',
  engajado: 'engajado',
  interesse: 'interesse sem dado concreto',
  vago: 'vago',
  sem_interesse: 'sem interesse',
};

/**
 * Um compromisso vencido é promessa NOSSA com prazo passado. A do parceiro que
 * venceu é assunto de cobrança, não de culpa — e por isso o rótulo é outro.
 */
export function compromissoVencido(
  prazo: string | null,
  status: string,
  agora: Date = new Date(),
): boolean {
  if (status !== 'aberto' || prazo === null) return false;
  const quando = new Date(prazo);
  return !Number.isNaN(quando.getTime()) && quando.getTime() < agora.getTime();
}

/**
 * Quando a leitura não vale a tela.
 *
 * Conversa de duas mensagens não tem dossiê, e mostrar "score 12, dados
 * insuficientes" ocupa a mesma altura de uma leitura de verdade para dizer que
 * não há leitura. A tela mostra uma linha discreta em vez do bloco.
 */
export function leituraVaziaDemais(ficha: {
  dadosInsuficientes: boolean;
  resumo: string | null;
  sinais: readonly SinalDaLeitura[];
}): boolean {
  return ficha.dadosInsuficientes && ficha.sinais.length === 0;
}

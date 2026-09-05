/**
 * Estimativa de tokens, para orçar antes de gastar.
 *
 * É estimativa, e o nome diz. A contagem verdadeira vem do `count_tokens` da API ou do
 * `usage` da resposta, e é ela que vai para `ai_runs`. Esta função existe porque o
 * documento de custos e os testes precisam de um número sem rede, e porque um prompt que
 * dobrou de tamanho sem ninguém notar é um custo que dobrou sem ninguém notar.
 *
 * O divisor 3,6 vem do português: palavra mais longa que em inglês, muito acento e
 * pontuação. Erra para mais em texto com muitos números e para menos em texto com muita
 * sigla — o suficiente para decidir orçamento, insuficiente para faturar.
 */
export const CARACTERES_POR_TOKEN_PT_BR = 3.6 as const;

export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / CARACTERES_POR_TOKEN_PT_BR);
}

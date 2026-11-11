/**
 * O vocabulário de tela desta empresa (11/11/2026: Agenda, Meu dia e Metas).
 *
 * Pedido do usuário para a Agenda da Imova: textos "no vocabulário da imobiliária
 * (cliente, proprietário, visita, corretor), nunca 'parceiro' nem 'fornecedor'". As
 * palavras moram em `EMPRESA.vocabulario` (`packages/schema/src/empresas.ts`); a
 * KOMUNE guarda, letra por letra, as que já estavam escritas.
 *
 * As métricas do `goal_progress` são o caso à parte: o rótulo e a fonte vêm
 * escritos do banco, com o jargão da captação ("Portas batidas", "máx. 1 por alvo
 * por dia"), e a função do banco é a MESMA nas duas empresas. A troca é feita aqui,
 * na leitura (`metricaNaEmpresa`), nos dois lugares que leem a função: a tela de
 * Metas (`metas/dados.ts`) e o Meu dia (`meu-dia/consultas.ts`).
 */
import type { Vocabulario } from '@komune/schema/empresas';

import { EMPRESA } from '@/lib/empresa';

export const VOCABULARIO: Vocabulario = EMPRESA.vocabulario;

/** "parceiro" → "Parceiro": a palavra que abre a frase. */
export function maiuscula(palavra: string): string {
  return palavra.charAt(0).toUpperCase() + palavra.slice(1);
}

/** O rótulo e a fonte de uma métrica nesta empresa; o do banco quando ela não troca. */
export function metricaNaEmpresa(
  metrica: string,
  doBanco: { rotulo: string; fonte: string },
  vocabulario: Vocabulario = VOCABULARIO,
): { rotulo: string; fonte: string } {
  const daEmpresa = vocabulario.metricas[metrica];
  return daEmpresa ? { rotulo: daEmpresa.rotulo, fonte: daEmpresa.fonte } : doBanco;
}

/** A leitura de uma linha da métrica nesta empresa, quando ela tem uma própria. */
export function definicaoNaEmpresa(
  metrica: string,
  vocabulario: Vocabulario = VOCABULARIO,
): string | null {
  return vocabulario.metricas[metrica]?.definicao ?? null;
}

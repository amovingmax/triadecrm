/**
 * `workers ai --chamada-de-teste`: uma chamada real, e o preço dela na tela.
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE
 * ===========================================================================
 * O GATE 1 do CRM Inteligente pede "custo real de uma chamada de teste". Estimativa
 * de tokens é conta de guardanapo: o que decide orçamento é o que a API cobra, com o
 * nosso prompt, no nosso formato de saída, com o cache ligado. Este comando faz essa
 * chamada uma vez, com uma conversa de EXEMPLO (a do próprio prompt, que não é de
 * ninguém), e imprime tokens de entrada, de saída, de cache e o custo em dólar.
 *
 * Ele passa pelo mesmo caminho de sempre — `prepararChamada`, pseudonimização,
 * auditoria de PII, validação da saída e linha em `ai_runs` — porque medir por um
 * atalho seria medir outra coisa. A única diferença é a origem dos dados: o exemplo
 * do prompt, e não uma conversa do banco.
 *
 * Rodar duas vezes seguidas é o teste do CACHE: a segunda chamada deve mostrar
 * leitura de cache e custar menos, e é isso que sustenta a projeção mensal.
 */

import { fichaDaConversaV1, type EntradaDaFicha } from '@komune/prompts';

import { executar, type ContextoDaIa } from './execucao';

export interface ResultadoDaChamadaDeTeste {
  readonly aiRunId: number;
  readonly custoUsd: number;
  readonly promptVersion: string;
  readonly modelo: string;
  readonly scoreIntencao: number;
  readonly resumo: string;
}

/**
 * A conversa de exemplo. Sai do próprio prompt (`exemplos[0]`), que é fixture e
 * não dado de parceiro: o comando não lê conversa real, para poder ser rodado em
 * produção sem tocar em ninguém.
 */
export function conversaDeExemplo(): EntradaDaFicha {
  const exemplo = fichaDaConversaV1.exemplos[0];
  if (exemplo === undefined) {
    throw new Error('ficha-da-conversa@v1 sem exemplo: não há o que medir');
  }
  return exemplo.entrada;
}

export async function chamadaDeTeste(
  contexto: ContextoDaIa,
): Promise<ResultadoDaChamadaDeTeste> {
  const entrada = conversaDeExemplo();

  const executada = await executar(
    contexto,
    fichaDaConversaV1,
    entrada,
    // Sem contato e sem ficha: a medição não pertence a nenhuma organização, e por
    // isso não entra no custo de ninguém — só no total do mês.
    { leadId: entrada.leadId, nome: null, empresa: null },
    {},
  );

  return {
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    promptVersion: executada.promptVersion,
    modelo: fichaDaConversaV1.modelo,
    scoreIntencao: executada.saida.scoreIntencao,
    resumo: executada.saida.resumo,
  };
}

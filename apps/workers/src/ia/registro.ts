/**
 * `ai_runs` — toda chamada ao modelo vira linha, inclusive as que não saíram.
 *
 * O worker manda TOKENS; quem faz a conta é o Postgres, a partir de
 * `public.ai_model_prices` e no gatilho `app.ai_runs_before_write` (ADR-03). O
 * que este arquivo manda em `cost_usd` seria ignorado, e por isso ele não manda
 * nada — mas **confere**: `custoDaChamada` de `packages/prompts` calcula o mesmo
 * número sem banco, e uma divergência entre os dois é log de aviso na hora, não
 * uma descoberta de fim de mês. Manter as duas contas é escolha (os evals rodam
 * sem rede, o alerta roda sem TypeScript); conferi-las é o que torna a escolha
 * barata.
 *
 * Três estados, e o terceiro é o que interessa:
 *   ok         — a chamada saiu e a saída passou pelo schema da versão.
 *   erro       — a chamada saiu e algo deu errado (rede, 5xx, JSON fora do schema).
 *   bloqueado  — a chamada NÃO saiu: `prepararChamada` viu PII na montagem, ou
 *                um tipo que a auditoria não sabe abrir. Custo zero por `check`.
 *                Guardrail que não deixa rastro é guardrail que ninguém sabe se
 *                funcionou.
 */
import { custoDaChamada, type ModeloAlvo, type PropositoDeAiRun } from '@komune/prompts';

import { ErroDaEsteira, type ClienteDoBanco } from '../ingest/esteira';

import type { UsoDoModelo } from './cliente';
import type { Logger } from '../lib/log';

export type SituacaoDaChamada = 'ok' | 'erro' | 'bloqueado';

/** Onde a chamada se pendura. Nenhum é obrigatório; o que existir, existe com FK. */
export interface VinculosDaChamada {
  readonly organizationId?: string | null;
  readonly activityId?: string | null;
  readonly conversationId?: string | null;
  /**
   * A pessoa do toque. NÃO vai para `ai_runs` — a tabela não tem a coluna, e
   * pendurar PII na contabilidade seria criar um segundo lugar onde o contato
   * mora (ADR-09). Existe só para a reconferência de supressão da entrega
   * (`executar`, laudo §3.3): supressão de pessoa não é a mesma coisa que
   * supressão de ficha.
   */
  readonly contactId?: string | null;
}

export interface ChamadaARegistrar {
  readonly proposito: PropositoDeAiRun;
  readonly modelo: ModeloAlvo;
  readonly promptVersion: string;
  readonly situacao: SituacaoDaChamada;
  readonly uso: UsoDoModelo;
  readonly latenciaMs: number | null;
  readonly saida: unknown;
  readonly erro: string | null;
  readonly vinculos: VinculosDaChamada;
  readonly lote?: boolean;
}

export interface ChamadaRegistrada {
  readonly id: number;
  /** O custo que o BANCO calculou. É ele que o alerta de orçamento lê. */
  readonly custoUsd: number;
}

const USO_ZERADO: UsoDoModelo = { entrada: 0, saida: 0, escritaDeCache: 0, leituraDeCache: 0 };

export { USO_ZERADO };

export async function registrarChamada(
  cliente: ClienteDoBanco,
  logger: Logger,
  chamada: ChamadaARegistrar,
): Promise<ChamadaRegistrada> {
  const { data, error } = await cliente
    .from('ai_runs')
    .insert({
      purpose: chamada.proposito,
      model: chamada.modelo,
      prompt_version: chamada.promptVersion,
      status: chamada.situacao,
      organization_id: chamada.vinculos.organizationId ?? null,
      activity_id: chamada.vinculos.activityId ?? null,
      conversation_id: chamada.vinculos.conversationId ?? null,
      batch: chamada.lote ?? false,
      tokens_in: chamada.uso.entrada,
      tokens_out: chamada.uso.saida,
      tokens_cache_write: chamada.uso.escritaDeCache,
      tokens_cache_read: chamada.uso.leituraDeCache,
      latency_ms: chamada.latenciaMs,
      output: chamada.saida ?? null,
      error: chamada.erro,
    })
    .select('id, cost_usd')
    .single();

  if (error) throw new ErroDaEsteira('ai_runs.insert', error.message);

  const linha = data as { id: number; cost_usd: number | string };
  const custoDoBanco = Number(linha.cost_usd);
  const custoLocal =
    chamada.situacao === 'bloqueado'
      ? 0
      : custoDaChamada(chamada.modelo, chamada.uso, { batch: chamada.lote ?? false });

  // Cinco casas é a precisão de `ai_runs.cost_usd` e a de `custoDaChamada`.
  if (Math.abs(custoDoBanco - custoLocal) > 1e-5) {
    logger.warn('o custo do banco e o de packages/prompts divergiram', {
      ai_run_id: linha.id,
      modelo: chamada.modelo,
      custo_do_banco: custoDoBanco,
      custo_local: custoLocal,
      tokens: chamada.uso,
    });
  }

  return { id: linha.id, custoUsd: custoDoBanco };
}

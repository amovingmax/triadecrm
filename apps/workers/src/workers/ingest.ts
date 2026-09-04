import type { WorkerContext } from '../lib/context';
import { heartbeat } from '../lib/heartbeat';

/**
 * worker-ingest — Radar (D4, RF-RAD, anexo R03): Crawlee + Playwright, planilhas e base CNPJ,
 * passando pela esteira única `raw_capture → source_record → supplier_candidate → revisão` (ADR-08),
 * consumindo filas `pgmq` com idempotência, visibility timeout, retry com backoff e dead-letter.
 */
export async function runIngest(ctx: WorkerContext<'ingest'>): Promise<number> {
  heartbeat(ctx.logger, 'ingest');
  ctx.logger.info(
    'worker-ingest sem tarefas nesta fase: a esteira de ingestão chega no D4 (RF-RAD).',
  );
  return 0;
}

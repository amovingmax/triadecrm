import type { WorkerContext } from '../lib/context';
import { heartbeat } from '../lib/heartbeat';

/**
 * worker-ai — IA (D6, ADR-10, anexo R08): classificação de intenção e extração com Claude Haiku 4.5,
 * rascunhos, resumos, digests e Assistente com Claude Sonnet 5; prompts versionados em @komune/prompts;
 * toda chamada registrada em `ai_runs` (modelo, tokens, custo) com pseudonimização do que vai ao modelo.
 */
export async function runAi(ctx: WorkerContext<'ai'>): Promise<number> {
  heartbeat(ctx.logger, 'ai');
  ctx.logger.info(
    'worker-ai sem tarefas nesta fase: classificação e rascunhos chegam no D6 (ADR-10).',
  );
  return 0;
}

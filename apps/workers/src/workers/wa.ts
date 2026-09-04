import type { WorkerContext } from '../lib/context';
import { heartbeat } from '../lib/heartbeat';

/**
 * worker-wa — WhatsApp (D5, RF-CON, anexo R04): envio pela Cloud API oficial da Meta (ADR-06) com rate-limit,
 * teto diário de primeiros contatos, janela permitida (RF-CON-11), cadências e biblioteca de áudios da Heloísa.
 * Nunca envia a contato em `suppression_list`, em nenhum modo.
 */
export async function runWa(ctx: WorkerContext<'wa'>): Promise<number> {
  heartbeat(ctx.logger, 'wa');
  ctx.logger.info('worker-wa sem tarefas nesta fase: envios e cadências chegam no D5 (RF-CON).');
  return 0;
}

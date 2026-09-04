import { hostname } from 'node:os';

import type { WorkerCommand } from '../cli';
import type { Logger } from './log';

import pkg from '../../package.json' with { type: 'json' };

/**
 * Heartbeat do worker. Nesta fase só vai para o log; no D4 passa a fazer upsert em `worker_heartbeats`
 * (worker, last_seen), que o `pg_cron` vigia e alerta se algum worker calar por mais de 10 min (RF-ADM-07).
 */
export function heartbeat(logger: Logger, command: WorkerCommand): void {
  logger.info('heartbeat', {
    event: 'heartbeat',
    command,
    version: pkg.version,
    pid: process.pid,
    hostname: hostname(),
    node: process.version,
  });
}

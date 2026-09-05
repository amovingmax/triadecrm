/**
 * CLI dos workers do KOMUNE CRM — uma imagem Docker, três comandos: ingest | wa | ai.
 *
 * `ingest` consome as filas `pgmq` da esteira de ingestão (RF-RAD). `wa` e `ai` ainda
 * validam o ambiente, registram um heartbeat no log e encerram com 0: os laços deles
 * chegam em D5 (wa) e D6 (ai).
 *
 * Códigos de saída: 0 ok · 1 ambiente inválido ou falha em execução · 2 uso incorreto do CLI.
 */
import { parseArgs, USAGE, type OpcoesDoComando, type WorkerCommand } from './cli';
import type { WorkerRunner } from './lib/context';
import { formatEnvIssues, loadEnv } from './lib/env';
import { createLogger } from './lib/log';
import { runAi } from './workers/ai';
import { runIngest } from './workers/ingest';
import { runWa } from './workers/wa';

async function start<C extends WorkerCommand>(
  command: C,
  run: WorkerRunner<C>,
  opcoes: OpcoesDoComando,
): Promise<number> {
  const loaded = loadEnv(command);
  if (!loaded.ok) {
    process.stderr.write(formatEnvIssues(command, loaded.issues));
    return 1;
  }

  const logger = createLogger({ worker: `worker-${command}`, level: loaded.env.LOG_LEVEL });
  try {
    return await run({ command, env: loaded.env, logger, opcoes });
  } catch (error) {
    logger.error('worker encerrou com erro não tratado', {
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });
    return 1;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.kind === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`${parsed.message}\n\n${USAGE}`);
    return 2;
  }

  switch (parsed.command) {
    case 'ingest':
      return start('ingest', runIngest, parsed.opcoes);
    case 'wa':
      return start('wa', runWa, parsed.opcoes);
    case 'ai':
      return start('ai', runAi, parsed.opcoes);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`Falha inesperada ao iniciar o worker: ${String(error)}\n`);
    process.exit(1);
  },
);

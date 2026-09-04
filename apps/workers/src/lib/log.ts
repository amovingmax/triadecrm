/**
 * Logger mínimo em JSON por linha (stdout/stderr), suficiente para `docker logs` e para o Logflare.
 * Nunca registre telefone, e-mail ou nome de contato: use ids (`lead_id`, `organization_id`) — guardrail do CLAUDE.md.
 * Quando o Sentry entrar (D4), os erros passam a ser reportados também por lá.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  /** Nome do worker, ex.: `worker-ingest`. Vai em toda linha. */
  worker: string;
  /** Nível mínimo registrado (padrão: info). */
  level?: LogLevel;
  /** Saídas substituíveis nos testes. */
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export function createLogger(options: LoggerOptions): Logger {
  const minimum = LEVEL_WEIGHT[options.level ?? 'info'];
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));

  const write = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVEL_WEIGHT[level] < minimum) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      worker: options.worker,
      msg,
      ...fields,
    });
    (level === 'error' ? stderr : stdout)(line);
  };

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}

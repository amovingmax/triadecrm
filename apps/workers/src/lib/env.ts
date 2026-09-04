/**
 * Validação (zod) das variáveis de ambiente dos workers.
 *
 * Todas as variáveis estão documentadas em `.env.example` na raiz. Cada comando exige só o que usa:
 * - base (todos): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; opcionais SENTRY_DSN, KOMUNE_HMAC_SECRET, LOG_LEVEL, TZ
 * - wa: META_WA_ACCESS_TOKEN, META_WA_PHONE_NUMBER_ID (VERIFY_TOKEN e APP_SECRET são do webhook, na Edge Function)
 * - ai: ANTHROPIC_API_KEY
 */
import { z } from 'zod';

import type { WorkerCommand } from '../cli';

/** Ao copiar o `.env.example`, valores ficam como string vazia; tratamos vazio como "não informado". */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());
const required = (name: string) => {
  const error = `${name} é obrigatória e não pode ficar vazia`;
  return z.string({ error }).min(1, { error });
};

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

const baseEnvSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(LOG_LEVELS).default('info')),
  /** Fuso oficial de toda lógica de janelas, cadências e digests (CLAUDE.md). */
  TZ: z.preprocess(emptyToUndefined, z.string().min(1).default('America/Fortaleza')),
  SUPABASE_URL: z.url({
    error: 'SUPABASE_URL deve ser uma URL (ex.: http://127.0.0.1:54321 em dev)',
  }),
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  SENTRY_DSN: optionalUrl,
  KOMUNE_HMAC_SECRET: optionalString,
});

const waEnvSchema = baseEnvSchema.extend({
  META_WA_ACCESS_TOKEN: required('META_WA_ACCESS_TOKEN'),
  META_WA_PHONE_NUMBER_ID: required('META_WA_PHONE_NUMBER_ID'),
  META_WA_VERIFY_TOKEN: optionalString,
  META_WA_APP_SECRET: optionalString,
});

const aiEnvSchema = baseEnvSchema.extend({
  ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
});

export const envSchemas = {
  ingest: baseEnvSchema,
  wa: waEnvSchema,
  ai: aiEnvSchema,
} as const;

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type WorkerEnv<C extends WorkerCommand> = z.infer<(typeof envSchemas)[C]>;

export type EnvResult<C extends WorkerCommand> =
  { ok: true; env: WorkerEnv<C> } | { ok: false; issues: string[] };

/** Valida `source` (por padrão `process.env`) para o comando informado. Não encerra o processo. */
export function loadEnv<C extends WorkerCommand>(
  command: C,
  source: NodeJS.ProcessEnv = process.env,
): EnvResult<C> {
  const result = envSchemas[command].safeParse(source);
  if (result.success) {
    return { ok: true, env: result.data as WorkerEnv<C> };
  }
  const issues = result.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(raiz)';
    return `${name}: ${issue.message}`;
  });
  return { ok: false, issues };
}

/** Mensagem única, em pt-BR, para o stderr quando o ambiente está incompleto. */
export function formatEnvIssues(command: WorkerCommand, issues: readonly string[]): string {
  return [
    `Ambiente inválido para o worker "${command}". Corrija o .env (modelo em .env.example):`,
    ...issues.map((issue) => `  - ${issue}`),
    '',
  ].join('\n');
}

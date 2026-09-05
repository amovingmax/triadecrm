/**
 * Validação (zod) das variáveis de ambiente dos workers.
 *
 * Todas as variáveis estão documentadas em `.env.example` na raiz. Cada comando exige só o que usa:
 * - base (todos): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; opcionais SENTRY_DSN, KOMUNE_HMAC_SECRET, LOG_LEVEL, TZ
 * - wa: META_WA_ACCESS_TOKEN, META_WA_PHONE_NUMBER_ID (VERIFY_TOKEN e APP_SECRET são do webhook, na Edge Function);
 *        opcionais META_WA_GRAPH_URL e META_WA_API_VERSION, que apontam o cliente para o dublê local
 * - ai: ANTHROPIC_API_KEY; opcional ANTHROPIC_BASE_URL (dublê local)
 * - rotas: OSRM_URL e NOMINATIM_USER_AGENT (a política do Nominatim EXIGE identificação);
 *          opcional NOMINATIM_URL, para apontar para uma instância própria ou para um dublê
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
  /**
   * Base da Graph API. Vazia = a Meta de verdade. Em desenvolvimento e em teste
   * aponta para o dublê local (`supabase/functions/_dubles/meta-graph-duble.mjs`),
   * que é como o worker-wa é exercitado sem credencial nenhuma no repositório.
   */
  META_WA_GRAPH_URL: optionalUrl,
  /** Versão da Graph API. Vazia = a versão contra a qual o cliente foi escrito. */
  META_WA_API_VERSION: optionalString,
});

const aiEnvSchema = baseEnvSchema.extend({
  ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
  /**
   * Para onde o SDK aponta. Vazio = API oficial da Anthropic. É por aqui que o
   * dublê local entra pelo MESMO lugar que o cliente real, sem `if` no código
   * do worker (apps/workers/src/ia/duble-servidor.ts).
   */
  ANTHROPIC_BASE_URL: optionalUrl,
});

/**
 * Rotas (RF-ROT-01 e RF-ROT-03).
 *
 * `NOMINATIM_USER_AGENT` é OBRIGATÓRIA, e é obrigatória de propósito: a política
 * de uso do Nominatim exige um User-Agent que identifique a aplicação e dê um
 * contato. Um valor padrão embutido no código seria uma identificação falsa. Sem
 * a variável, o worker não sobe — que é melhor do que subir escondido.
 */
const rotasEnvSchema = baseEnvSchema.extend({
  /** Onde o OSRM responde. Na máquina dedicada, `http://osrm:5000` (rede do Compose). */
  OSRM_URL: z.preprocess(emptyToUndefined, z.url().default('http://osrm:5000')),
  NOMINATIM_USER_AGENT: required('NOMINATIM_USER_AGENT'),
  /** Vazio = o serviço público do OpenStreetMap. */
  NOMINATIM_URL: optionalUrl,
});

export const envSchemas = {
  ingest: baseEnvSchema,
  wa: waEnvSchema,
  ai: aiEnvSchema,
  rotas: rotasEnvSchema,
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

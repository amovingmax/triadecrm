/**
 * @komune/schema — tipos gerados do banco, normalizadores e schemas zod, compartilhados
 * por `apps/web`, `apps/workers` e pelas Edge Functions.
 *
 * - `database.types.ts` é gerado por `pnpm db:types` (`supabase gen types`) e nunca é
 *   editado à mão: regenere após cada migração e faça commit do resultado.
 * - `tipos.ts` acrescenta os atalhos que o gerador não cria (`Functions`, `AppEnum`…).
 * - `normalizadores.ts` espelha as funções SQL do schema `app`; quando divergirem, o SQL
 *   é a verdade (há teste de paridade contra o Postgres local).
 * - `schemas.ts` traz os schemas zod da base de parceiros.
 *
 * Pacote "just-in-time": `exports` aponta para o fonte TypeScript. `apps/web` o lista em
 * `transpilePackages`; tsx (dev) e tsup (bundle dos workers) o consomem direto.
 */

export type { Database, Json } from './database.types';
export {
  type CompositeTypes,
  Constants,
  type Enums,
  type Tables,
  type TablesInsert,
  type TablesUpdate,
} from './database.types';

export * from './tipos';
export * from './normalizadores';
export * from './schemas';

/** Nome do pacote, útil em logs e testes de integração do workspace. */
export const SCHEMA_PACKAGE = '@komune/schema' as const;

/** Fuso horário oficial de toda a lógica de janelas, cadências, digests e relatórios (CLAUDE.md). */
export const TIMEZONE = 'America/Fortaleza' as const;

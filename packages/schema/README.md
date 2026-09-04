# @komune/schema

Tipos gerados do banco, normalizadores e schemas zod, compartilhados por `apps/web`, `apps/workers` e pelas Edge Functions.

## O que tem dentro

| Arquivo                 | O que é                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/database.types.ts` | Gerado por `pnpm db:types`. **Nunca edite à mão**: regenere após cada migração e faça commit (o CI tipa sem banco). Traz `Database`, `Json`, `Tables`, `TablesInsert`, `TablesUpdate`, `Enums`, `CompositeTypes` e `Constants`.                                                 |
| `src/tipos.ts`          | O que o gerador não cria: `Functions` / `FunctionArgs` / `FunctionReturns` (RPCs), `AppEnum<'temperature'>` (todos os enums moram no schema privado `app`, então o `Enums<>` padrão, que mira `public`, não os alcança) e apelidos como `OrgKind`, `Temperature`, `DealStatus`. |
| `src/normalizadores.ts` | Espelho fiel, em TypeScript, das funções SQL do schema `app`: `normalizePhoneBr`, `normalizeCnpj`, `cnpjIsValid`, `normalizeInstagram`, `websiteDomain`, `isSharedWebHost`, `searchName`, `maskPhone`.                                                                          |
| `src/schemas.ts`        | Schemas zod da base de parceiros: `organizationSchema`, `contactSchema`, `dealSchema`, `quickCreateOrganizationInput` e os tipos inferidos.                                                                                                                                     |

## A regra que vale aqui

O Postgres é o cérebro (ADR-03): quem decide o valor final é o trigger no banco. Estas funções existem para a UI validar e mostrar o valor normalizado **antes** do insert (RF-BAS-05, RF-BAS-15) e para os workers deduplicarem sem ida ao banco.

**Quando SQL e TypeScript divergirem, o SQL é a verdade** — corrija este pacote, nunca a migração. `src/normalizadores.paridade.test.ts` roda a mesma tabela de casos de `supabase/tests/02_normalizacao.sql` dentro do Postgres local (via `docker exec … psql`) e compara caso a caso com o TypeScript; quando o banco não responde, a suíte inteira é pulada, nunca falha por ambiente.

## Como regerar os tipos

Com a stack local de pé (`supabase start`):

```bash
pnpm db:types
```

O script prefixa `SUPABASE_DB_PASSWORD=postgres` porque, num projeto linkado, o CLI lê a senha do `.env` da raiz (a do projeto **remoto**) e o `--local` falha com `password authentication failed for user "postgres"`. A senha aí é a do Postgres da stack local, não é segredo.

## Como consumir

```ts
import { normalizePhoneBr, quickCreateOrganizationInput, type Tables } from '@komune/schema';
```

Pacote "just-in-time": `exports` aponta para o fonte TypeScript, sem passo de build.

- `apps/web` (Next.js): já lista `transpilePackages: ['@komune/schema']` em `next.config.ts`.
- `apps/workers`: o `tsup` inclui os pacotes `@komune/*` no bundle (`noExternal`).

Scripts: `pnpm --filter @komune/schema lint | typecheck | test`.

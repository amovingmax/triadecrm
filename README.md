# KOMUNE CRM

CRM web próprio da KOMUNE (marketplace de eventos, Natal/RN) para captar, manter e ativar fornecedores, produtores e cerimonialistas.
Módulos: base de parceiros, Radar (coleta em fontes públicas), funis kanban, inbox de WhatsApp com robô assistido, agenda e rotas, pré-cadastro na plataforma Komune, metas com Assistente, relatórios e administração/LGPD.

A fonte da verdade do produto é o [PRD v1.0](docs/PRD-CRM-Captacao-KOMUNE-v1.0.md); o que já foi entregue está no [CHANGELOG](docs/CHANGELOG.md); as instruções para o Claude Code, no [CLAUDE.md](CLAUDE.md).

## Pré-requisitos

| Ferramenta                                                             | Versão                                       | Observação                                         |
| ---------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| [nvm](https://github.com/nvm-sh/nvm) + Node                            | 22 (`.nvmrc`)                                | `nvm install 22`                                   |
| corepack + pnpm                                                        | pnpm 11.25.0 (`package.json#packageManager`) | `corepack enable` — o pnpm certo é baixado sozinho |
| [OrbStack](https://orbstack.dev) (macOS) ou Docker Engine + Compose v2 | —                                            | a stack local do Supabase roda em contêineres      |
| [Supabase CLI](https://supabase.com/docs/guides/cli)                   | ≥ 2.109                                      | `brew install supabase/tap/supabase`               |
| `psql` (libpq)                                                         | opcional                                     | só para `pnpm db:seed-dev`; `brew install libpq`   |

## Rodar localmente

```bash
source scripts/dev-env.sh   # Node 22 via nvm, docker do OrbStack no PATH (sem segredos)
cp .env.example .env        # preencha com os valores locais impressos por `supabase start`
cp apps/web/.env.example apps/web/.env.local   # o Next.js lê o .env.local do próprio app (cole a anon key local)
cp supabase/.env.example supabase/.env   # cliente OAuth do Google, lido pelo Supabase CLI (placeholders já sobem a stack)
pnpm install                # instala o workspace inteiro
supabase start              # sobe Postgres, Auth, Storage, Realtime, Edge Runtime e Studio (ou: pnpm db:start)
pnpm db:reset               # aplica supabase/migrations + supabase/seed.sql no banco local
pnpm db:types               # gera packages/schema/src/database.types.ts a partir do banco local
pnpm dev                    # apps/web em http://localhost:3000
```

Portas locais: API `54321` · Postgres `54322` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) · Studio `54323` · e-mails de teste `54324` · Metabase (infra/local) `3001`.

Auth local (`supabase/config.toml`): o único provedor é o Google (RF-ADM-01); o CLI lê `SUPABASE_AUTH_GOOGLE_CLIENT_ID`/`_SECRET` de `supabase/.env` — com os placeholders a stack sobe, mas o botão "Entrar com Google" só funciona com o cliente OAuth real (redirect `http://127.0.0.1:54321/auth/v1/callback`). O cadastro fica aberto no Auth; quem pode entrar é decidido por trigger em `auth.users`. O hook `public.custom_access_token_hook` (papel no JWT) já está ligado: enquanto a migração que cria a função não for aplicada (`pnpm db:reset`), qualquer emissão de token falha com HTTP 500 `Error running hook URI` — isso é esperado. Analytics e vector buckets ficam desligados localmente.

Outros comandos:

| Comando                                                     | O que faz                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | roda o script em todos os pacotes que o definem                                          |
| `pnpm format` / `pnpm format:check`                         | Prettier em todo o repositório                                                           |
| `pnpm db:lint`                                              | `supabase db lint --local` (plpgsql_check)                                               |
| `pnpm db:test`                                              | testes pgTAP em `supabase/tests` (RLS por papel, funções)                                |
| `pnpm db:seed-dev`                                          | carga de desenvolvimento (`scripts/seed-dev-5k.sql`, ~5 mil organizações) no banco local |
| `pnpm db:stop`                                              | derruba a stack local                                                                    |
| `pnpm --filter @komune/workers dev ingest`                  | roda um worker em dev (`ingest`, `wa` ou `ai`)                                           |

**Atenção:** o projeto está linkado ao Supabase remoto `komune-crm`. Não rode `supabase db push`, `supabase functions deploy` ou `migration up --linked` à mão; o deploy é feito pelo CI depois de revisão.

## Estrutura de pastas

```
apps/web              Next.js 16 (App Router, PWA, mobile-first nas telas de campo)
apps/workers          uma imagem Docker, três comandos: ingest | wa | ai
packages/schema       schemas zod + tipos gerados do banco (compartilhados por web, workers e Edge Functions)
packages/prompts      prompts versionados + evals (D6)
supabase/migrations   fonte da verdade do schema (RLS em toda tabela)
supabase/functions    wa-webhook · komune-webhook · claim-link · export-lgpd
supabase/seed.sql     categorias, cidades, feriados, funis/etapas, modelos de mensagem
supabase/tests        pgTAP
infra/local           docker-compose da máquina dedicada (workers, Metabase; depois OSRM e faster-whisper)
scripts/              dev-env.sh e cargas de desenvolvimento
.github/workflows     lint, typecheck, Vitest, supabase db lint, pgTAP
docs/                 PRD, anexos R00–R11, CHANGELOG, decisões
```

## Convenções

- **Migrações são a fonte da verdade.** Nada é alterado pelo dashboard. Toda tabela nasce com RLS e políticas por papel (`admin`, `gestor`, `sdr`, `embaixador`, `leitura`), testadas com pgTAP. Depois de cada migração: `pnpm db:reset && pnpm db:types` e commit dos tipos gerados.
- **Postgres é o cérebro** (ADR-03): normalização, dedup, etapas, temperatura, metas e retenção vivem em funções, triggers e views; UI e workers são finos.
- **pt-BR** em textos de UI, mensagens, comentários, nomes de migração, commits e PRs. Código em TypeScript e SQL.
- **Commits pequenos citando os requisitos e o dia**: ex. `feat(base): dedup por telefone E.164 (RF-BAS-15, D1)`. Cada PR lista os `RF-XXX-NN` que cobre; Matheus revisa.
- **Versões compartilhadas** ficam no `catalog` de `pnpm-workspace.yaml`; os pacotes declaram `"catalog:"`.
- **Pacotes internos são "just-in-time"**: `@komune/schema` e `@komune/prompts` exportam o fonte TypeScript. `apps/web` os lista em `transpilePackages`; os workers os incluem no bundle.
- **Segredos só em `.env` e `supabase/.env`** (gitignored) e no Vault; `.env.example` e `supabase/.env.example` sempre atualizados. Sem CPF, dados bancários ou Pix no CRM (ADR-09).
- **Fuso `America/Fortaleza`** em toda lógica de janelas, cadências, digests e relatórios; telefones em E.164.
- Ao fechar uma tarefa: lint, typecheck e testes verdes; `docs/CHANGELOG.md` atualizado com o que foi entregue, o que ficou pendente e o que precisa de decisão humana.

## Documentação

- [PRD v1.0](docs/PRD-CRM-Captacao-KOMUNE-v1.0.md) — produto, requisitos (`RF-*`), arquitetura (ADRs em §9.1), calendário D1–D10 (§11.2), Apêndices.
- [Anexos R00–R11](docs/anexos/) — arquitetura (R05), fontes do Radar (R03), WhatsApp (R04), playbook conversacional (R08), LGPD (R06), mercado de Natal (R09), pré-cadastro (R10), metas (R07).
- [CHANGELOG](docs/CHANGELOG.md) — registro por dia do calendário.

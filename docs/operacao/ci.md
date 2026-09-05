# Integração contínua (GitHub Actions)

Arquivo: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Roda em **todo pull request
para `main`** e em **todo push para `main`**.

O CI existe para responder uma pergunta só: *isto continua funcionando em uma máquina que não é a
sua?* Por isso ele nunca usa o banco de desenvolvimento de ninguém — sobe um Supabase novo, aplica
as migrações na ordem, roda a semente e derruba tudo no fim.

## O que ele roda

Dois trabalhos em paralelo. Cada um para no primeiro passo vermelho.

### 1. Aplicação — lint, tipos e testes

| passo | comando | por quê |
| --- | --- | --- |
| segredo versionado | `git ls-files \| grep '\.env'` | nenhum `.env` pode entrar no git (CLAUDE.md); só os `.env.example` |
| dependências | `pnpm install --frozen-lockfile` | pega quem mexeu em `package.json` sem atualizar o `pnpm-lock.yaml` |
| lint | `pnpm lint` | ESLint em `apps/web`, `apps/workers`, `packages/schema`, `packages/prompts` |
| tipos | `pnpm typecheck` | `tsc --noEmit` em todos, mais `next typegen` no web |
| testes | `pnpm test` | Vitest: normalização, dedup, temperatura, formatos, filas offline |

Node vem do `.nvmrc` (22) e o pnpm do campo `packageManager` do `package.json` (11.25.0): as mesmas
versões que `source scripts/dev-env.sh` seleciona na máquina de quem desenvolve. O armazém do pnpm
fica em cache, com chave derivada do `pnpm-lock.yaml`.

### 2. Banco — migrações, `db lint` e pgTAP

| passo | comando | por quê |
| --- | --- | --- |
| subir e migrar | `supabase start -x studio,imgproxy,vector,realtime,edge-runtime` | banco vazio, migrações na ordem, depois `supabase/seed.sql` |
| esquema | `supabase db lint --local --level warning --fail-on warning --schema public,app` | erro de tipagem em função ou view derruba o CI. O recorte de schema existe porque o PostGIS (migração 20260905000600) traz funções PL/pgSQL próprias no schema `extensions` que emitem avisos — código de terceiro, que não é nosso para consertar |
| pgTAP | `supabase test db --local` | RLS por papel, funções, esteira de ingestão, cadências e pré-cadastro |
| limpeza | `supabase stop --no-backup` (sempre, mesmo em falha) | não deixa contêiner nem volume para trás |

Ficam de fora do `-x` os contêineres que as migrações e o pgTAP não usam (Studio, imgproxy, vector,
realtime, edge-runtime). Banco, Auth, PostgREST, Storage e Kong sobem — o Auth é quem cria o schema
`auth`, de que as migrações dependem (gatilho de domínio permitido em `auth.users`).

> **A diferença que mais pega:** na sua máquina o banco já tem a semente aplicada de execuções
> anteriores; no CI ele nasce vazio e **as migrações rodam ANTES da `supabase/seed.sql`**. Migração
> que insere linha citando slug de catálogo (desfecho, modelo de mensagem, áudio) só passa se o
> catálogo for criado por outra **migração** — nunca pela semente. Para reproduzir o CI aqui:
> `supabase db reset --local` (apaga os dados locais de desenvolvimento).

> **A segunda que mais pega:** dois arquivos de migração com o **mesmo carimbo de versão**
> (o prefixo `20260904001802_`, por exemplo). A versão é a chave primária de
> `supabase_migrations.schema_migrations`; o segundo arquivo com o mesmo prefixo derruba a aplicação
> com `duplicate key value violates unique constraint "schema_migrations_pkey"`. No banco que já
> tinha a migração aplicada isso não aparece — só no banco novo do CI. Um carimbo por arquivo.

## Segredos — o que o Matheus precisa criar

Nenhum segredo está escrito no workflow. Em **Settings → Secrets and variables → Actions → New
repository secret**, dois segredos **opcionais**:

| segredo | para quê | se não existir |
| --- | --- | --- |
| `SUPABASE_AUTH_GOOGLE_CLIENT_ID` | resolve o `env(...)` de `[auth.external.google]` no `supabase/config.toml` | entra `ci-sem-google`; migrações e pgTAP passam igual |
| `SUPABASE_AUTH_GOOGLE_SECRET` | idem | entra `ci-sem-google` |

Nem as migrações nem o pgTAP fazem login com Google, então o CI fica verde sem eles — inclusive em
pull request vindo de fork, onde o GitHub não entrega segredo nenhum. Vale cadastrar quando o CI
passar a exercitar o fluxo de login de verdade.

**Nunca cadastre aqui**: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, tokens da Meta,
`KOMUNE_HMAC_SECRET`. O CI não publica nada e não fala com nenhum serviço externo; chave que ele não
precisa é chave que ele não pode vazar. Segredo de produção vive no Vault do projeto `komune-crm` e
nos *Edge Functions Secrets* (ver `.env.example` e `docs/operacao/publicar-na-vercel.md`).

## Reproduzir o CI na sua máquina

```bash
source scripts/dev-env.sh          # Node 22 pelo nvm + docker do OrbStack

pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test

supabase db reset --local          # apaga os dados locais; é o equivalente ao banco novo do CI
pnpm db:lint
pnpm db:test
```

Se não quiser perder o banco de desenvolvimento, dá para simular o CI em uma cópia isolada: copie
`supabase/` para uma pasta fora do repositório, troque `project_id` e as portas no `config.toml` e
rode `supabase start --workdir <cópia>`. Foi assim que este workflow foi validado.

## Proteção do ramo `main`

Depois do primeiro CI verde, em **Settings → Branches → Add branch ruleset** para `main`:

- exigir pull request antes de mesclar (o Matheus revisa, CLAUDE.md);
- exigir os dois *status checks* — `Aplicação — lint, tipos e testes` e `Banco — migrações, db lint e pgTAP`;
- exigir que o ramo esteja atualizado com `main` antes de mesclar.

## Versões fixadas e como subir

| o quê | onde | valor hoje |
| --- | --- | --- |
| Node | `.nvmrc` | 22 |
| pnpm | `package.json` → `packageManager` | 11.25.0 |
| Supabase CLI | `.github/workflows/ci.yml` → `supabase/setup-cli` | 2.109.0 |
| ações do GitHub | `.github/workflows/ci.yml` | `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4`, `supabase/setup-cli@v1` |

Subir a CLI do Supabase é trocar **um** número no workflow, e só depois de a mesma versão rodar
verde na máquina de quem desenvolve (`supabase --version`). Versão da CLI diferente entre CI e
máquina é a origem clássica de "passa aqui e quebra lá".

## O que este CI ainda NÃO faz

Cada item aqui é dívida consciente, não esquecimento:

- **`pnpm format:check` (Prettier)** — fora do CI de propósito: hoje 44 arquivos do repositório estão
  fora do padrão do Prettier, e ligar o passo deixaria `main` vermelha por motivo cosmético. Ligar
  logo depois de um `pnpm format` de faxina, em PR próprio.
- **`pnpm build`** — a Vercel já constrói o `apps/web` a cada push (ver `publicar-na-vercel.md`), então
  o CI não paga o mesmo minuto duas vezes. Se a publicação sair da Vercel, este passo entra.
- **Playwright (inbox e kanban)** — os testes de ponta a ponta ainda não existem; quando existirem,
  entram como terceiro trabalho, com o `apps/web` servido contra a stack local do próprio CI.
- **Conferir se `packages/schema/src/database.types.ts` está atualizado** — o certo é rodar
  `supabase gen types` no CI e falhar se o arquivo commitado divergir. Falta fechar o formato de saída
  para o diff não acusar diferença cosmética.
- **Implantar migração em produção** — de propósito. Publicação em `komune-crm` é decisão humana
  (Rafael/Matheus), nunca efeito colateral de um merge.

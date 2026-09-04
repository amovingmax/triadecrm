# syntax=docker/dockerfile:1.7
# Imagem única dos workers do KOMUNE CRM (ingest | wa | ai). Node 22, multi-stage.
#
# Construir sempre a partir da RAIZ do repositório (o contexto precisa do workspace inteiro):
#   docker build -f apps/workers/Dockerfile -t komune-crm/workers:local .
# Executar um comando:
#   docker run --rm --env-file .env komune-crm/workers:local ingest
# Em produção o infra/local/docker-compose.yml sobe os três comandos com esta mesma imagem.

ARG NODE_IMAGE=node:22-alpine

# ---------- base: Node 22 + pnpm (versão fixada em package.json#packageManager, via corepack) ----------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN corepack enable
WORKDIR /repo
# .dockerignore (na raiz) mantém fora do contexto node_modules, .env*, docs, supabase e dados locais.
COPY . .

# ---------- build: instala @komune/workers + dependências de workspace (com devDependencies) e empacota ----------
FROM base AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@komune/workers..."
RUN pnpm --filter @komune/workers build

# ---------- prod-deps: instalação limpa só com dependências de produção (o que o bundle importa) ----------
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@komune/workers..."

# ---------- runtime: imagem final enxuta, usuário sem privilégios ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    TZ=America/Fortaleza
WORKDIR /app
# Mantém o layout do workspace para os symlinks do pnpm continuarem válidos.
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/workers/node_modules ./apps/workers/node_modules
COPY --from=build /repo/apps/workers/package.json ./apps/workers/package.json
COPY --from=build /repo/apps/workers/dist ./apps/workers/dist
WORKDIR /app/apps/workers
USER node
ENTRYPOINT ["node", "dist/index.js"]
CMD ["ingest"]

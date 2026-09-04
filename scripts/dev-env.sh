#!/usr/bin/env bash
# Ambiente de desenvolvimento do KOMUNE CRM.
# Uso (humanos e CI): source scripts/dev-env.sh
# Não contém segredos — os segredos ficam apenas em .env* (gitignored) e no Vault.

# Entra na raiz do repositório (o shell não guarda estado entre chamadas de agentes/CI).
cd "/Users/matheusrondon/Documents/Tríade"

# Carrega o nvm, que não está no PATH padrão do shell.
source ~/.nvm/nvm.sh

# Seleciona o Node 22 (versão fechada no PRD/ADR); silencia a saída do nvm.
nvm use 22 >/dev/null 2>&1

# Coloca os binários do OrbStack (docker, docker compose) no PATH.
export PATH="$HOME/.orbstack/bin:$PATH"

# Aponta o cliente Docker para o socket do OrbStack (o Supabase CLI depende disso).
export DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock

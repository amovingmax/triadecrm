# @komune/workers

Workers da máquina dedicada (ADR-04: recepção em nuvem, processamento local). Uma imagem Docker, três comandos:

| Comando  | Papel                                                                                                          | Chega em         |
| -------- | -------------------------------------------------------------------------------------------------------------- | ---------------- |
| `ingest` | Radar: Crawlee + Playwright, planilhas, base CNPJ → esteira `raw_capture → source_record → supplier_candidate` | D4 (RF-RAD, R03) |
| `wa`     | WhatsApp: envios pela Cloud API da Meta, teto diário, janela permitida, cadências, áudios                      | D5 (RF-CON, R04) |
| `ai`     | IA: classificação (Haiku 4.5), rascunhos/resumos/Assistente (Sonnet 5), `ai_runs`                              | D6 (ADR-10, R08) |

Nesta fase (Fundação) cada comando valida o ambiente, registra um heartbeat no log (JSON) e sai com 0.

## Rodar em desenvolvimento

```bash
source scripts/dev-env.sh              # na raiz do repo
pnpm --filter @komune/workers dev ingest   # lê ../../.env se existir
pnpm --filter @komune/workers dev --help
```

Variáveis exigidas por comando estão em `src/lib/env.ts` (validação zod) e documentadas em `.env.example`.
Códigos de saída: `0` ok · `1` ambiente inválido ou erro · `2` uso incorreto.

## Build e imagem

```bash
pnpm --filter @komune/workers build     # tsup → dist/index.js (pacotes @komune/* entram no bundle)
docker build -f apps/workers/Dockerfile -t komune-crm/workers:local .   # a partir da raiz
docker run --rm --env-file .env komune-crm/workers:local wa
```

O `infra/local/docker-compose.yml` sobe os três comandos com esta imagem.

## Regras que valem aqui (CLAUDE.md)

- Idempotência em tudo que consome fila: chave de idempotência, `visibility timeout`, retry com backoff, dead-letter.
- Heartbeat em `worker_heartbeats`; alerta por `pg_cron` se calar > 10 min.
- Fuso `America/Fortaleza`; telefones em E.164; nunca logar telefone/e-mail (use ids).
- Segredos só no `.env` (gitignored) e no Vault.

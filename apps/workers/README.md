# @komune/workers

Workers da máquina dedicada (ADR-04: recepção em nuvem, processamento local). Uma imagem Docker, três comandos:

| Comando  | Papel                                                                                                        | Estado           |
| -------- | ------------------------------------------------------------------------------------------------------------ | ---------------- |
| `ingest` | Radar: coleta nas fontes públicas → esteira `raw_capture → source_record → supplier_candidate`                | pronto (RF-RAD)  |
| `wa`     | WhatsApp: envios pela Cloud API da Meta, teto diário, janela permitida, cadências, áudios                     | D5 (RF-CON, R04) |
| `ai`     | IA: classificação (Haiku 4.5), rascunhos/resumos/Assistente (Sonnet 5), `ai_runs`                            | D6 (ADR-10, R08) |

## O coletor (`ingest`)

Três filas `pgmq`, uma por etapa, e o Postgres como cérebro (ADR-03 e ADR-08 — planilha e robô
passam pela MESMA esteira):

```
ingest_jobs     "colete a fonte X"      → confere o robots.txt e enfileira as listagens
ingest_pages    "busque esta URL"       → respeita o intervalo da fonte, extrai e grava a captura
ingest_records  "resolva esta captura"  → normaliza, deduplica e cria o candidato para revisão
ingest_dlq      dead-letter             → o que falhou além do teto; ninguém consome sozinho
```

Nenhuma regra de negócio mora no worker: dedup, higiene do dado, resolução do candidato,
proveniência campo a campo e retenção são funções do banco (migrações `20260904001600` e
`20260904001802`). O worker busca a página, filtra pela whitelist e chama a RPC.

### Rodar

```bash
source scripts/dev-env.sh                 # na raiz do repo

# Contra a stack local (`supabase start`). O .env da raiz aponta para o projeto REMOTO:
# para desenvolvimento use um .env.local com a URL e a service_role locais (ambos gitignored).
cd apps/workers

# Uma coleta completa do catálogo de Natal, e sai quando as filas esvaziam:
node --env-file=../../.env.local --import tsx src/index.ts ingest \
  --agendar --paginas=2 --rotulo="Coleta do dia" --uma-vez

# Só duas categorias:
node --env-file=../../.env.local --import tsx src/index.ts ingest \
  --agendar --fonte=casamentos_com_br --categorias=cerimonialista,buffet-casamento --uma-vez

# Laço contínuo (é assim que ele roda na máquina dedicada); SIGINT/SIGTERM param
# depois da mensagem atual:
node --env-file=../../.env.local --import tsx src/index.ts ingest
```

`--help` lista as opções. Códigos de saída: `0` ok · `1` ambiente inválido, erro ou falha na
corrida · `2` uso incorreto.

### O que o coletor faz, e o que ele nunca faz

- Busca com **Crawlee** (`CheerioCrawler` para fonte de HTML servido, `PlaywrightCrawler` para
  fonte que só existe depois do JavaScript), com `respectRobotsTxtFile` ligado e a fila do
  Crawlee em memória (`persistStorage = false`) — a fila que manda é a `pgmq`.
- Confere o **robots.txt por conta própria** antes de cada requisição (`src/ingest/robots.ts` e
  `guarda.ts`), porque o Crawlee pula a URL proibida em silêncio e silêncio aqui esconderia o
  motivo de uma coleta vazia. Robots inalcançável (5xx, rede caída) = host proibido por inteiro.
- Se apresenta como `KomuneBot/1.0 (+https://komune.app.br)`, com o gerador de cabeçalho de
  navegador do Crawlee **desligado**. Nunca troca o user-agent para disfarçar, nunca contorna
  bloqueio, nunca tenta caminho alternativo: se a fonte barra, ele para e registra o motivo em
  `import_batches.error`.
- Respeita `sources.rate_limit_seconds` **entre mensagens da fila** (`src/ingest/acelerador.ts`),
  e não só dentro de uma corrida do Crawlee; quando a fonte declara `Crawl-delay` maior, vale o
  maior.
- Só guarda os campos da **whitelist do R06 SCR-01** (`src/ingest/whitelist.ts`, cópia literal de
  `app.payload_e_permitido`): foto, descrição, texto de avaliação, logo, preço de tabela, CPF e
  dado bancário são descartados **antes de sair da máquina**, e o descarte vira log com o nome do
  campo.
- Segue a paginação que a **própria página declara** (`<link rel="next">`); nunca monta `--2`,
  `--3` no código.
- Bate ponto em `worker_heartbeats` a cada 20 s (`src/lib/pulso.ts`). É o que a tela do Radar lê
  para dizer "coletor parado há 12 min" em vez de mostrar uma fila vazia sem explicação.

### Fontes com adaptador

| Fonte               | Adaptador                 | Como                                                            |
| ------------------- | ------------------------- | --------------------------------------------------------------- |
| `casamentos_com_br` | `src/ingest/casamentos.ts` | `ItemList` em JSON-LD das listagens categoria × cidade (R03 §2.1) |

O catálogo de listagens e o mapa "categoria da fonte → categoria do CRM" são **dados**
(`sources.config.collector.catalogo` e `public.source_category_map`), não código: mudar o que
coletar não exige deploy. Fonte sem adaptador recusa a coleta com motivo legível, em vez de
tentar adivinhar o layout.

O perfil de cada fornecedor no Casamentos **não é visitado**: telefone e site ficam atrás de
`emp-ShowTelefonoTrace.php` e `emp-ShowWebsiteTrace.php`, os dois em `Disallow` no robots.txt. O
telefone vem de outra fonte ou do próprio fornecedor, depois da autorização.

## Build e imagem

```bash
pnpm --filter @komune/workers build     # tsup → dist/index.js (pacotes @komune/* entram no bundle)
docker build -f apps/workers/Dockerfile -t komune-crm/workers:local .   # a partir da raiz
docker run --rm --env-file .env komune-crm/workers:local wa
```

O `infra/local/docker-compose.yml` sobe os três comandos com esta imagem.

## Regras que valem aqui (CLAUDE.md)

- Idempotência em tudo que consome fila: chave de idempotência, `visibility timeout`, retry com
  backoff, dead-letter.
- Heartbeat em `worker_heartbeats`; alerta por `pg_cron` se calar > 10 min.
- Fuso `America/Fortaleza`; telefones em E.164; nunca logar telefone/e-mail (use ids).
- Segredos só no `.env*` (gitignored) e no Vault.

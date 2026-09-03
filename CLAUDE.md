# KOMUNE CRM — instruções para o Claude Code

## O que é este repositório

CRM web próprio da KOMUNE (marketplace de eventos, Natal/RN) para captação, manutenção e ativação de fornecedores, produtores e cerimonialistas. Módulos: base de parceiros, "Radar" (coleta em fontes públicas), funis kanban, inbox de WhatsApp com robô assistido em nome da Heloísa, agenda e rotas de visita, pré-cadastro na plataforma Komune, metas com Assistente de cobrança, relatórios e administração/LGPD.

A fonte da verdade do produto é `docs/PRD-CRM-Captacao-KOMUNE-v1.0.md`. Quando o PRD e este arquivo divergirem, vale o PRD; quando o PRD e o código divergirem, avise antes de mudar qualquer um dos dois.

## Leia nesta ordem antes de qualquer tarefa

1. `docs/PRD-CRM-Captacao-KOMUNE-v1.0.md` — seções 5 (funis e regra de temperatura), 6 (escopo por fase e critérios de "pronto"), 7 (requisitos `RF-XXX-NN`), 9 (arquitetura e modelo de dados), 10.6 (retenção), 11.2 (calendário D1–D10) e Apêndice D (tabelas).
2. O anexo do módulo em que vai trabalhar, em `docs/anexos/`: R05 (arquitetura, DDL, filas), R03 (fontes e scraping do Radar), R04 (WhatsApp Cloud API, templates, janelas), R08 (playbook conversacional, 25 intenções, scripts), R10 (pré-cadastro e onboarding), R06 (LGPD e checklist legal por módulo), R09 (mercado de Natal, categorias e lista-semente), R07 (metas, digests e Assistente), R01/R02 (benchmarks e playbooks, referência de UX).
3. `docs/CHANGELOG.md` — o que já foi entregue e o que ficou pendente.

Não releia tudo a cada tarefa: use a seção do PRD e o anexo do módulo.

## Decisões fechadas (não rediscutir — ADRs no PRD §9.1)

- Construir do zero. Web: Next.js 16 (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Query/Table + dnd-kit + react-hook-form + zod. Back-end: Supabase (Postgres com RLS, Auth Google, Storage privado, Realtime, Edge Functions, `pgmq`, `pg_cron`, `pg_net`, Vault, PostGIS, `pg_trgm`, `unaccent`, `citext`). Workers: Node 22 + TypeScript em Docker Compose na máquina dedicada.
- Projeto Supabase separado `komune-crm`, região São Paulo (ADR-02; Luiz e Matheus confirmam no D1). Integração com a plataforma Komune apenas por contrato: Edge Function `crm-pre-registration` (HMAC, idempotente) + webhook de status + reconciliação noturna. Nunca ler ou escrever direto no banco do app.
- Postgres é o cérebro: normalização, dedup, etapas, temperatura, metas e retenção vivem em funções, triggers e views; UI e workers são finos (ADR-03).
- Recepção em nuvem, processamento local: webhooks (Meta, Komune) em Edge Functions → filas `pgmq`; workers consomem quando ligados (ADR-04).
- WhatsApp: Cloud API oficial da Meta (direto ou via 360dialog), Coexistence no número "Heloísa · Komune". Nunca Baileys, Evolution ou qualquer automação não oficial (ADR-06).
- Human-in-the-loop por padrão: o robô classifica e redige; a Heloísa aprova o primeiro contato e as respostas (ADR-05). O modo automático (RF-CON-09) fica atrás de uma feature flag desligada e está fora do MVP.
- Inbox próprio dentro do CRM no MVP (ADR-07); Chatwoot só se o gatilho de reversão do D8 disparar.
- IA: Claude Haiku 4.5 para classificação e extração (saídas estruturadas, Batch API), Claude Sonnet 5 para rascunhos, resumos, digests, Assistente e relatório (ADR-10). Prompts versionados em `packages/prompts`, com evals.
- Sem CPF, dados bancários ou Pix no CRM (ADR-09). Voz: biblioteca de áudios reais da Heloísa (ogg/opus); nada de voz clonada.
- Filas e cron nativos do Postgres (ADR-11); sem Redis, BullMQ ou n8n.
- Ingestão unificada: planilha e scrapers passam pela mesma esteira `raw_capture → source_record → supplier_candidate → revisão → organizations` (ADR-08).

## Estrutura do monorepo (pnpm workspaces; criar assim no D1)

```
apps/web              Next.js (PWA; mobile-first nas telas de campo)
apps/workers          uma imagem Docker, três comandos: ingest | wa | ai
packages/schema       zod + tipos gerados do banco (compartilhados por web e workers)
packages/prompts      prompts versionados + evals
supabase/migrations   fonte da verdade do schema
supabase/functions    wa-webhook · komune-webhook · claim-link · export-lgpd
supabase/seed.sql     categorias, cidades, feriados, funis/etapas, modelos de mensagem
infra/local           docker-compose da máquina dedicada (workers, Metabase, OSRM, faster-whisper)
.github/workflows     lint, typecheck, Vitest, supabase db lint, pgTAP
docs/                 PRD, anexos, CHANGELOG, decisões
```

## Regras de engenharia

- Migrações em `supabase/migrations` são a fonte da verdade; nada é alterado pelo dashboard. Desenvolvimento com `supabase start` (CLI local); toda tabela nasce com RLS habilitada e políticas por papel (`admin`, `gestor`, `sdr`, `embaixador`, `leitura`), testadas com pgTAP.
- Tipos gerados com `supabase gen types` e schemas zod em `packages/schema`, usados por web, workers e Edge Functions.
- Fuso `America/Fortaleza` em toda lógica de janelas, cadências, digests e relatórios. Telefones sempre em E.164; nomes normalizados (`unaccent` + `lower`) para dedup; chaves de dedup como índices únicos parciais em CNPJ, telefone e @instagram.
- Idempotência em tudo que consome fila ou webhook (chave de idempotência, `visibility timeout`, retry com backoff, dead-letter). Workers registram `worker_heartbeats`.
- Segredos só em `.env` (nunca commitados) e no Vault; `.env.example` sempre atualizado.
- Testes do que foi tocado: Vitest (normalização, dedup, score, regra de temperatura, cadências), pgTAP (RLS e funções), Playwright (inbox e kanban).
- Textos de UI, mensagens, commits e PRs em pt-BR. Commits pequenos e frequentes; cada PR cita os IDs de requisito (ex.: `RF-BAS-07`) e o dia do calendário (ex.: `D2`).
- Ao terminar cada tarefa: rodar lint, typecheck e testes; atualizar `docs/CHANGELOG.md` com o que foi entregue, o que ficou pendente e o que precisa de decisão humana.
- Antes de implementar algo fora do PRD, ou que mude uma decisão fechada, pare e pergunte.

## Guardrails de produto que o código deve garantir

- Opt-out por regra (palavras como "sair", "parar", "não quero", "remover") → `do_not_contact` imediato e entrada na `suppression_list`; nenhum envio a contato suprimido, em nenhum modo.
- Teto de primeiros contatos por dia e por número (configurável; padrão 20 na primeira semana, subindo até 40–60), envio só na janela permitida (RF-CON-11), nunca em domingo ou feriado.
- Pré-cadastro na Komune só depois de autorização registrada em `consent_events`; o pedido de autorização é a segunda mensagem da conversa, nunca a primeira.
- O robô nunca promete condição comercial fora da base de conhecimento (validador de promessas); dúvida financeira sem resposta na FAQ → "vou confirmar com o financeiro".
- Pseudonimizar o que vai ao modelo (`lead_id`, sem telefone ou e-mail quando evitável); registrar toda chamada em `ai_runs` com modelo, tokens e custo; alerta a 80% do orçamento mensal.
- Auditar mudança de etapa, envio, revelação de telefone, exportação e decisão de curadoria (`audit_log`, `pii_access_log`).
- Radar: respeitar `robots.txt` e os limites por fonte (R03), coletar só os campos da whitelist, guardar a proveniência de cada dado (`source_record`) e aplicar a retenção do PRD §10.6. GetNinjas está fora das fontes.

## Calendário e prioridades

MVP em 10 dias úteis: D1 sex 04/09/2026 → D10 sex 18/09/2026 (07/09 é feriado). MVP-núcleo = D1–D5 (fundamentos, importação, funil e ficha, Radar 1, WhatsApp v0); MVP-estendido = D6–D10 (IA v0, cadências e agenda v0, metas e Assistente v0, pré-cadastro v0, estabilização). Detalhe dia a dia no PRD §11.2; critérios de "pronto" no PRD §6. Se algo não couber no dia, corte escopo do dia — nunca a qualidade do que sobe para `main`.

## Pessoas

Rafael (CEO; decide) · Matheus (revisa PRs; faz o lado Komune: Edge Function, campos, webhooks) · Luiz (Meta Business, máquinas dedicadas, DNS, backups) · Heloísa (usa o CRM no campo; grava os áudios; valida os fluxos) · Bárbara (comercial e marketing; modelos de mensagem) · Dennis (financeiro, LGPD, termos e FAQ financeira).

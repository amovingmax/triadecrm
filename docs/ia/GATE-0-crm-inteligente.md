# GATE 0 — CRM Inteligente (IA sobre as conversas de WhatsApp)

> Auditoria somente leitura, 16/09/2026. Nenhum arquivo de código foi alterado.
> Escrito para: Rafael (decide) e Matheus (revisa o lado técnico).

## 1. Resposta curta

**Metade da spec já está construída neste repositório.** O Tríade tem, em produção:
esteira de IA com fila própria, pseudonimização obrigatória com auditoria independente,
prompts versionados, validador de promessas, contabilidade de tokens e custo por chamada,
alerta de orçamento e rascunho com aprovação humana (ADR-05, ADR-10).

O que **falta de verdade** são quatro coisas: a **ficha por conversa de WhatsApp**
(hoje a IA classifica a intenção, mas não mantém um dossiê), o **score explicável**, o
**resumo diário** e o **Pergunte ao CRM**.

E há **três conflitos** com decisões já fechadas do produto que eu não posso resolver
sozinho (seção 4). O maior deles é o nome: **"Radar" já é um módulo do CRM.**

---

## 2. O que a auditoria encontrou

### 2.1 Stack e infraestrutura

| Item | O que é |
| --- | --- |
| Web | Next.js 16 (App Router) + TypeScript + Tailwind + shadcn/ui, na Vercel (deploy manual por CLI) |
| Banco | Supabase Postgres (projeto `komune-crm`, São Paulo), RLS em todas as tabelas, papéis `admin`, `gestor`, `sdr`, `embaixador`, `leitura`, `financeiro` |
| Jobs | `pgmq` (13 filas) + `pg_cron` (14 tarefas) + workers Node 22 em Docker. O `worker-wa` roda no Fly.io (gru); `ingest`, `ai` e `rotas` foram desenhados para uma máquina dedicada **que ainda não existe** |
| Fuso | `America/Fortaleza` em toda regra de janela, cadência e digest |
| Notificação | Tarefas (`tasks`) dentro do CRM; e-mail transacional pelo **Resend** (ligado em 16/09, `app_settings.notificacoes.email`); WhatsApp pela Cloud API |
| Modelos | `ai_model_prices`: Haiku 4.5 (US$ 1,00/US$ 5,00 por Mtok) e Sonnet 5 (US$ 2,00/US$ 10,00), com preço de cache |

### 2.2 WhatsApp

- **Provedor:** Cloud API oficial da Meta, conexão direta (sem BSP, sem Coexistence — decisão de 14/09/2026). Número `+55 84 99931-8888`, conectado.
- **Entrada:** Edge Function `wa-webhook` → fila `wa_inbound` → `worker-wa` → `app.wa_registrar_entrada`.
- **Tabelas:** `conversations` (por par número-da-empresa × número-da-pessoa) e `messages` (direção `in`/`out`, `author_kind` = `human` | `bot_fixed` | `bot_ai` | `system`, `status`, `wa_message_id`, `transcript`, `media_path`, `template_id`, `origin`).
- **Áudio:** `messages.transcript` já existe e o worker já pede transcrição (`transcribe_audio`).
- **Celular:** o número não existe em aparelho nenhum — tudo passa pelo CRM. **Grupos não entram** (a Cloud API não entrega mensagem de grupo).
- **Ligação com o CRM:** `conversations.organization_id` / `contact_id` / `deal_id`; conversa de número fora da base nasce sem ficha e tem tela própria ("Fora da base", 15/09).
- **Bot de entrada (16/09):** quem escreve primeiro recebe um menu de 4 caminhos; a escolha grava `conversations.ai_intent` e abre tarefa.

### 2.3 O que já existe de IA

| Peça | Onde | Estado |
| --- | --- | --- |
| Fila de IA | `pgmq.ai_jobs` + `ai_dlq`, `app.ia_enfileirar(purpose, payload, chave)` | pronta, idempotente por chave |
| Propósitos declarados | `transcribe_audio`, `summarize_call`, `draft_followup`, `classify_inbound`, `draft_reply`, `summarize_deal`, `next_action`, `digest` | **4 implementados** (os quatro primeiros); os outros existem só no `check` |
| Prompts versionados | `packages/prompts` — catálogo imutável, schema de entrada e saída em zod, evals em Vitest sem rede | pronto (4 prompts) |
| Pseudonimização | `nucleo/pseudonimizacao.ts` + **auditoria independente** (`auditoria-pii.ts`): telefone, e-mail ou @ que escapem derrubam a chamada | pronto |
| Validador de promessas | `nucleo/validador-promessas.ts` — o rascunho não pode prometer condição fora da base de conhecimento | pronto |
| Custo | `ai_runs` (tokens de entrada, saída, escrita e leitura de cache, custo, latência, status), `ai_model_prices`, `ai_budget_alerts`, cron `ia_alerta_orcamento` | pronto, **0 execuções até hoje** |
| Human-in-the-loop | `message_drafts` (pendente → aprovado → enviado), gatilho que recusa mensagem de IA sem rascunho aprovado | pronto (ADR-05) |
| Temperatura | `app.compute_temperature` em SQL: etapa + última intenção + dias parados + override humano, recalculada por cron às 06:00 | pronto, **5 faixas** |
| Digest | Cron `relatorio_semanal` (segunda, 11h) + tabela `weekly_reports`; RF-MET-04 prevê digest diário às 07:30 | tabela vazia |
| Transcrição | `faster-whisper` no `infra/local/docker-compose` (RF-MET-07) + prompt `transcricao-audio` (o Claude **limpa** o texto do Whisper, não transcreve) | **infra não existe hoje** |

### 2.4 Volume real (últimos 30 dias)

| Medida | Número |
| --- | --- |
| Mensagens no total | **13** (12 recebidas) — o número entrou no ar em 14/09 |
| Conversas | 6 |
| Áudios | 0 |
| Atividades (ligação, visita, nota, mensagem) | 283 |
| Organizações vivas / negócios abertos | 206 / 205 |
| Pessoas no time | 7 perfis ativos (admin, gestor, sdr) |
| Execuções de IA | 0 |

**Consequência:** não dá para estimar custo com dado medido. A seção 6 usa cenários.

---

## 3. Riscos e lacunas

1. **Não existe base para calibrar.** A spec pede gabarito de 30–50 conversas reais rotuladas. Temos 6 conversas e 13 mensagens. Sem conversa real, o acerto de 80% não é verificável — ele viraria uma promessa em cima de fixtures escritas por mim.
2. **Não existe máquina para o worker de IA.** `worker-ai` foi desenhado para a máquina dedicada. Hoje só o `worker-wa` está no ar (Fly.io). Ou o `ai` sobe junto no Fly, ou a máquina precisa existir.
3. **Transcrição sem casa.** `faster-whisper` precisa de máquina com CPU sobrando (ou GPU). No Fly, uma instância que aguente Whisper `small` custa bem mais que os US$ 3/mês do worker atual.
4. **Sem áudio, metade do valor não aparece.** Hoje 0% das mensagens são áudio porque quase não há mensagem. Em WhatsApp de fornecedor, áudio costuma passar de 30%.
5. **A janela de 24 h da Meta manda no tempo.** Alerta de "cliente esperando" que chega tarde demais é alerta inútil: fora da janela, responder deixa de ser livre.
6. **Custo de conversa longa.** Análise incremental resolve, mas reanálise completa a cada 20 incrementos em conversa de 200 mensagens é uma chamada cara. Precisa de teto por conversa.

---

## 4. Conflitos com o que já está fechado (preciso de decisão)

### 4.1 O nome "Radar" já está ocupado — **impede começar**

`Radar` é o módulo de coleta de fornecedores em fontes públicas (PRD §7 RF-RAD-01..09, menu lateral, tabelas `raw_capture`, `source_record`, `supplier_candidate`). Chamar o resumo diário de "Radar" cria duas coisas com o mesmo nome no mesmo menu.

**Proposta:** o módulo se chama **Pulso** (tela "Pulso do dia"), e o resumo diário é o "Pulso do dia". Alternativas: "Leitura do dia", "O dia na Komune".

### 4.2 Temperatura: a spec propõe um segundo sistema

Hoje a temperatura é do **banco** (ADR-03, PRD §5.6): `app.compute_temperature` combina etapa, última intenção, dias parados, override humano e status, com **cinco faixas** (frio, morno, quente, **cliente**, **cliente_ativo**) — e as cinco são a única cor da interface (sistema visual de 04/09). A spec propõe um score 0–100 em código com **três faixas**.

**Proposta:** manter uma temperatura só, a do banco, e a IA passa a alimentá-la em vez de competir com ela:
- a ficha da conversa grava `score_intencao` (0–100) e os sinais que o justificam;
- `app.compute_temperature` ganha o score como mais um insumo (ainda em SQL, ainda explicável);
- o "Por que quente?" da tela mostra etapa + dias + sinais com link para a mensagem;
- `cliente` e `cliente_ativo` continuam existindo — são parceiro publicado, não lead.

### 4.3 Vocabulário de intenção

A spec propõe `orcamento | duvida | fechamento | pos_venda | reclamacao | parceria | outro`. O CRM já opera com as **25 intenções do R08** (`interessado`, `pediu_taxa`, `me_chama_depois`, `ja_uso_outro`, `desconfianca`…), e são elas que a temperatura, as cadências e o prompt `classificar-intencao` usam.

**Proposta:** manter as 25 e acrescentar só o que falta para o comercial (`pediu_proposta`, `pronto_para_fechar`, `reclamacao`), mapeando para os grupos da spec na tela.

### 4.4 Outras sobreposições (sem conflito, mas não duplicar)

| A spec pede | Já existe | O que fazer |
| --- | --- | --- |
| Tabela `ai_jobs` | `pgmq.ai_jobs` + `ai_dlq` | usar a fila que existe |
| `ai_usage` | `ai_runs` (mais completa: cache, latência, status, bloqueios) | usar `ai_runs` |
| `ai_settings` | `app_settings` por chave, com RLS | usar `app_settings` |
| `ai/privacy` | `packages/prompts/src/nucleo` (pseudonimização + auditoria) | usar o que existe |
| `ai/client` | `apps/workers/src/ia/{cliente,execucao,registro}.ts` | usar o que existe |
| Sugestão de resposta | `message_drafts` + validador + fila de aprovação | usar o que existe |
| Briefing por WhatsApp | **fora da janela de 24 h exige modelo aprovado pela Meta**; hoje temos 42 aprovados, nenhum de resumo | resumo vai por **e-mail (Resend)** e in-app; WhatsApp exige modelo novo aprovado |
| Digest matinal | RF-MET-04 prevê 07:30 | alinhar: um resumo às 18h30 e o digest de 07:30 que já estava no PRD |

### 4.5 Permissão: "responsável só vê o que é dele" não é a regra desta casa

A spec pede que o responsável veja só as próprias conversas. Aqui, `app.sees_all()` dá visão total a `admin`, `gestor`, `sdr`, `leitura` e `financeiro`; só `embaixador` é restrito à carteira. **A captação é de toda a equipe** (decisão registrada), e o time inteiro atende o mesmo número.

**Proposta:** a IA respeita a RLS que existe — quem vê a conversa vê a ficha dela. O critério de aceite vira: "o Pergunte ao CRM nunca devolve o que a RLS do usuário esconderia".

---

## 5. Spec adaptada aos nomes reais

### 5.1 Tabelas novas (mínimo necessário)

| Spec | Nome proposto aqui | Observação |
| --- | --- | --- |
| `ai_conversation_insights` | `public.ficha_da_conversa` | 1:1 com `conversations`; guarda resumo, intenção, score, sinais, dados extraídos, `ultima_mensagem_analisada`, `prompt_version`, `ai_run_id` |
| `ai_temperature_history` | **não criar** | `deal_stage_history` + a nova coluna de score cobrem; se faltar, uma tabela `historico_de_score` enxuta |
| `ai_commitments` | `public.compromissos_da_conversa` | quem prometeu, o quê, prazo, `message_id`, status; o vencimento vira `tasks` |
| `ai_daily_briefings` | `public.pulso_do_dia` | data, escopo, métricas (jsonb), texto, versão, `ai_run_id` |
| `ai_alerts` | **usar `tasks`** + uma coluna de origem | o CRM já avisa gente por tarefa, e tarefa tem dono, prazo e "resolvido" |
| `ai_field_suggestions` | `public.sugestoes_de_campo` | com `field_provenance`, que já existe, para não sobrescrever dado de pessoa |
| `ai_feedback` | `public.feedback_da_ia` | 👍/👎 e correção, para calibração |
| `ai_jobs`, `ai_usage`, `ai_settings` | não criar | já existem (4.4) |

Todas com RLS espelhando `conversations_select`, e exclusão em cascata a partir da conversa e da organização (retenção do PRD §10.6).

### 5.2 Prompts (no pacote que já existe)

`ficha-da-conversa` v1 (Haiku 4.5) e `pulso-do-dia` v1 (Sonnet 5), entrando em `CATALOGO`/`VIGENTES` como os outros quatro — com schema de entrada e saída em zod, evals sem rede e pseudonimização obrigatória.

### 5.3 Contexto do negócio (Anexo A adaptado)

> A Komune é um aplicativo de eventos de Natal/RN: quem vai dar uma festa (aniversário,
> casamento, formatura, evento de empresa) monta o evento no app e contrata os
> fornecedores da cidade num lugar só. O Tríade é o CRM de captação desses fornecedores,
> produtores e cerimonialistas. Estar na plataforma é de graça para o fornecedor, que só
> paga quando fecha um serviço por lá; quem organiza não paga nada e recebe 5% do que
> contratar. Ciclo de venda típico: primeiro contato → apresentação de 20 minutos →
> cadastro → publicação. Ticket: não há mensalidade; a receita é percentual por serviço
> fechado.

---

## 6. Custo

Com 13 mensagens em 30 dias, qualquer número medido seria ficção. Três cenários, com os
preços que já estão em `ai_model_prices` e a entrada fixa em cache (o prompt e a rubrica
são iguais em toda chamada):

| Cenário | Conversas ativas/dia | Análises/dia | Custo IA/mês |
| --- | --- | --- | --- |
| Hoje | 5 | ~10 | **< US$ 1** |
| Operação do MVP | 30 | ~60 | **≈ US$ 8** |
| Time inteiro prospectando | 100 | ~200 | **≈ US$ 26** |

Conta do cenário do meio: 60 análises × (4.000 tokens de entrada × US$ 1/Mtok × 0,3 com
cache + 800 de saída × US$ 5/Mtok) ≈ US$ 0,25/dia; mais o Pulso do dia no Sonnet
(≈ 12.000 entrada + 2.000 saída ≈ US$ 0,04/dia); mais o Pergunte ao CRM sob demanda.

**Transcrição de áudio, fora disso** (30% de áudio no cenário do meio ≈ 15 áudios/dia,
~40 s cada):

| Opção | Custo estimado | Observação |
| --- | --- | --- |
| **Groq Whisper large-v3-turbo** | ≈ US$ 0,04/mês | mais barato e rápido; manda o áudio para fora (avaliar LGPD) |
| **OpenAI Whisper API** | ≈ US$ 1,80/mês | US$ 0,006/min, referência conhecida |
| **faster-whisper próprio** | US$ 0 de API, mas máquina | é o que o `infra/local` já prevê; exige a máquina dedicada existir |

Sem áudio nenhum hoje, a decisão pode esperar a Fase 2 — mas não pode ser esquecida,
porque é ela que decide se a IA enxerga metade da conversa.

---

## 7. Decisões pendentes (proposta para cada uma)

| # | Decisão | Proposta |
| --- | --- | --- |
| 1 | Nome do módulo | **Pulso** ("Pulso do dia"), porque Radar já existe |
| 2 | Temperatura | Uma só, a do banco, alimentada pelo score da IA (4.2) |
| 3 | Intenções | As 25 do R08 + 3 novas (4.3) |
| 4 | Transcrição | Groq Whisper na Fase 2; faster-whisper quando a máquina existir |
| 5 | Horário do resumo | 18h30 (Fortaleza), e o digest de 07:30 do RF-MET-04 fica para depois |
| 6 | Canais do resumo | In-app + e-mail (Resend, já ligado). WhatsApp só depois de um modelo aprovado |
| 7 | SLA de resposta | 2 h **dentro da janela de envio** (seg–sex 9h–12h e 14h–18h, sábado só quem respondeu) — a janela já existe em `channel_windows` |
| 8 | Quem é gestor | `admin` e `gestor` |
| 9 | Campos que a IA pode sugerir | `organizations`: categoria, bairro, cidade, Instagram, site, CNPJ. `deals`: valor, próxima ação. `contacts`: nome, cargo. Nunca sobrescreve o que tem `field_provenance` humana |
| 10 | Números internos fora da análise | Lista inicial: os 7 do time |
| 11 | Orçamento mensal | US$ 40 (alerta em 80%, pausa das análises não essenciais em 100%) — o alerta já existe |
| 12 | Preenchimento automático | Desligado, como a spec pede |

---

## 8. Fase 1, se aprovado (não executada)

1. Migração aditiva: `ficha_da_conversa`, `compromissos_da_conversa`, `pulso_do_dia`, `sugestoes_de_campo`, `feedback_da_ia`, com RLS e retenção.
2. Propósitos `analisar_conversa` e `pulso_do_dia` no `check` de `ai_runs` e em `app.ia_enfileirar`.
3. Debounce por conversa (10 min parada / 30 min em conversa contínua) via `app_settings`.
4. Prompts `ficha-da-conversa` v1 e `pulso-do-dia` v1 no `packages/prompts`, com evals.
5. Subir o `worker-ai` (Fly.io, ao lado do `worker-wa`) e uma chamada de teste real medindo custo.
6. Feature flag por módulo em `app_settings`.

⛔ **Parado no GATE 0, aguardando aprovação.**

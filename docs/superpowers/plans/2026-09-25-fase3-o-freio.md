# Fase 3 — o freio (antes de qualquer robô) · plano corrigido

**Repo:** `/Users/matheusrondon/Documents/Tríade` · **Spec:** `docs/superpowers/specs/2026-09-24-pivo-scraper-e-robo-autonomo-design.md` §5, linhas 498–598 · **Hoje:** 25/09/2026

```bash
cd /Users/matheusrondon/Documents/Tríade && source scripts/dev-env.sh
```

Partida verde: pgTAP **2.900 asserções em 64 arquivos**; **803 testes do web em 52**; **324 dos workers**.

**Nomes das migrações:** hoje já existem `20260925130000` e `20260925140000`. Esta fase usa `20260925150000` … `20260925180000`, nesta ordem (a 12 recria `app.pode_enviar` por cima da 10).

---

## O que o plano anterior errou (conferido arquivo a arquivo)

| Afirmação do plano anterior | O que está no código / na Meta | Correção |
|---|---|---|
| Fixture `pg_temp.gastar` grava `cost_usd` direto "porque o custo é gravado por gatilho" | `app.ai_runs_before_write` (`20260905000200:228`) **sobrescreve** `new.cost_usd` a partir dos tokens no INSERT. Gravar 21 com tokens zerados dá **0** | **Tarefa 2** — fixture por tokens, modelo fixado |
| "Nenhuma asserção conta linha absoluta em tabela compartilhada" | …e logo abaixo afirma "com US$ 21 de 60", lendo `ai_runs` do mês corrente inteiro | **Tarefa 2** — zera o mês dentro da transação, como o 24 faz com `pgmq` |
| Nada a mexer nos testes de hoje ao subir o teto para 60 | `24_ia_e_whatsapp.sql:215–232` ancora `ritmo_acima`, `passou_de_80` e `alertou` **no teto de 25**. Sobe para 60 → **quatro asserções caem** | **Tarefa 1** — reancorar o bloco 2 do 24 |
| `app.ia_enfileirar` recusar "não perde nada" | `app.ia_enfileirar_resumo` roda dentro de `public.tabular_tentativa` e **não existe cron que repita `summarize_call`**. Recusado = resumo perdido para sempre | **Tarefa 4** (nova) |
| Tarefa 7 cobre a mensagem que chegou | Cobre só o `throw` de `executar()`. A recusa **no enfileiramento** (`tarefas.ts:261`, `:403`) devolve `{enfileirado:false}` e ninguém olha | **Tarefas 4 e 8** |
| `buscarConversa` "já devolve `assigneeId`? se não, acrescente" | `banco.ts:115–152` **não** seleciona `assignee_id` e `ConversaDoFio` não tem o campo. Passo sem código | **Tarefa 8** — edição escrita |
| `fila.test.ts` ganha dois testes | O teste **existente** (`fila.test.ts:29–48`) afirma `esteira_fila_enfileirar` e `purpose` no payload: **quebra** | **Tarefa 7** — substituição, não adição |
| Assinar os três campos "na lista que vai no corpo de `subscribed_apps`" | `conectar.ts:240` e `:269` chamam `POST /{waba}/subscribed_apps` **sem lista nenhuma**; o corpo do override só aceita `override_callback_uri` e `verify_token`. Campo de webhook se assina no **App Dashboard** (ou `/{app-id}/subscriptions`), e a própria `conectar.ts:266` já registra que a Meta recusa esse caminho para WhatsApp | **Tarefa 12** — vira conferência e instrução, não escrita |
| `current_limit` é a fonte do tier | Está **obsoleto**, "will be removed in February, 2026" — já passou. A fonte é `max_daily_conversations_per_business`, presente **também** no `phone_number_quality_update` | **Tarefa 11** |
| A nota GREEN/YELLOW/RED nunca vem por webhook | Quase: o `phone_number_quality_update` traz `event = FLAGGED` / `UNFLAGGED`, que é a queda de qualidade **na hora**. O plano jogava fora o único aviso rápido | **Tarefa 11** — `FLAGGED` vira `qualidade = 'RED'` |
| Tarefa 12 só mexe em `app.pode_enviar` | `app.toques_do_dia` (`20260905000200:1292`) delega a `primeiros_contatos_do_dia` e é **quem a cadência consulta** (`pode_tocar`, `001700:577`; recontato, `000801:427`; tela, `001890:152`). Mudar só `pode_enviar` deixa a cadência agendando o que a porteira recusa | **Tarefa 14** |
| Rede: `27_whatsapp_tetos.sql`; "57 exercita `pode_enviar`" | **`27_whatsapp_tetos.sql` não existe** (`27_rotas.sql`). Quem exercita `pode_enviar` direto é `24_ia_e_whatsapp.sql`, `25_confirmacao_de_optout_estreita.sql` e `24_worker_wa_e_webhook.sql`; o 57 só indiretamente | **Tarefas 10 e 14** |
| Teste usa `public.wa_optout_confirmar` | **Não existe.** O que existe é `public.wa_optout_registrar(uuid, text, boolean)` (`20260905000300:740`) | **Tarefa 15** |
| Teste de `saude.ts` usa `clienteFalso` e `loggerDeTeste` | Não existem em `apps/workers/src/whatsapp/`. O dublê expõe `cliente/cenario/zerar/conta/parar`, sem `clienteFalso` | **Tarefa 13** |
| `escalarConversa` em `banco.ts:411` | Está em **`:417`** | cosmético, corrigido abaixo |

Confirmado e mantido: `ai_alerta_orcamento` só avisa (`:483`, cron `'0 12 * * *'` em `:2223`); 14 propósitos (`20260917230200` é a versão viva); `executar()` só pergunta PII (`:159`) e supressão (`:178`); `fila.ts:80` pula `app.ia_enfileirar`; `app.pode_enviar` passo 2 libera dentro das 24 h (`:1348`/`:1385`); aquecimento só sob `if p_primeiro_contato`; `extrair.ts:194–200` descarta saúde; não existe tabela de histórico; `account_update` **não** traz `phone_number`; `ia.orcamento` não tem espelho no `seed.sql`; opt-out por regra roda antes do modelo (`tarefas.ts:548`) e **fica onde está**; `envio_um`/`wa_enviar_modelo` inserem `author_kind='human'`, logo campanha **não** é fala de robô.

---

## Ordem

Dinheiro (1–8) → Meta (9–13) → o furo do recontato (14) → teto de fala (15–16) → tela (17) → CHANGELOG (18).

---

## Tarefa 1 — O orçamento sobe para US$ 60, e o teste 24 é reancorado

### 1.1 — Reancorar `24_ia_e_whatsapp.sql` (4 min) — **antes de tudo**

O bloco 2 do 24 mede as linhas do orçamento com o teto de 25. Subir para 60 derruba quatro asserções. Elas não são ruído: são o exemplo do documento de custos. **Reancorar, não apagar** — o `plan()` do arquivo não muda.

`pg_temp.gastar` continua igual (tokens, `claude-sonnet-5`, US$ 1 = 500.000 tokens de entrada). Mudam os degraus:

```sql
select pg_temp.gastar(1);
select is(app.ai_gasto_do_mes(date '2026-08-07') ->> 'situacao', 'ok',
          'US$ 1 em 5 dias projeta US$ 4,20 no mês: dentro do orçamento');

-- 14 em 5 dias úteis projeta 58,80 sobre 21 dias: ainda abaixo de 60.
select pg_temp.gastar(13);   -- total US$ 14
select is(app.ai_gasto_do_mes(date '2026-08-07') ->> 'situacao', 'ok',
          'US$ 14 projeta US$ 58,80: apertado, e ainda dentro');

-- 15 projeta 63,00 > 60: o alerta de RITMO dispara ANTES do acumulado.
select pg_temp.gastar(1);    -- total US$ 15
select is((app.ai_gasto_do_mes(date '2026-08-07') ->> 'projecao_do_mes_usd')::numeric, 63.00::numeric,
          'US$ 15 em 5 dias projeta US$ 63,00 — o exemplo do documento de custos, reancorado no teto de 60');
select is(app.ai_gasto_do_mes(date '2026-08-07') ->> 'situacao', 'ritmo_acima',
          'e a situação é ritmo_acima ANTES de o acumulado passar de 80%: é este o alerta que chega a tempo');
select ok((app.ai_gasto_do_mes(date '2026-08-07') ->> 'gasto_usd')::numeric
          < (app.ai_gasto_do_mes(date '2026-08-07') ->> 'limite_de_alerta_usd')::numeric,
          'no mesmo instante, o alerta do PRD (80% do acumulado) ainda estaria calado');

select pg_temp.gastar(34);   -- total US$ 49
select is(app.ai_gasto_do_mes(date '2026-08-07') ->> 'situacao', 'passou_de_80',
          'passado o acumulado de US$ 48, a situação vira passou_de_80');
```

E a linha do mês corrente (`insert ... 12000000, 0` → US$ 24) passa a **30000000** (US$ 60), com o comentário:

```sql
-- US$ 60 é o teto inteiro desde 25/09/2026: o mês corrente entra JÁ estourado,
-- que é o único estado em que `alertou` é verdade independente de quantos dias
-- úteis do mês já correram.
insert into public.ai_runs (purpose, model, prompt_version, tokens_in, tokens_out)
values ('digest', 'claude-sonnet-5', 'resumo-ligacao@v1', 30000000, 0);
```

Cada asserção mexida ganha `-- reancorada em 25/09/2026: o teto passou de US$ 25 para US$ 60`. **Não se mexe no número do teto para fazer teste passar — mexe-se na âncora, e diz-se por quê.**

### 1.2 — O teste novo que falha (2 min)

`supabase/tests/67_o_freio_do_orcamento.sql`, cabeçalho no molde do 66, `plan(4)`:

```sql
select is((select (s.value ->> 'mensal_usd')::numeric from public.app_settings s
            where s.key = 'ia.orcamento'), 60::numeric,
          'o teto mensal de IA é US$ 60 (decisão de Rafael, 25/09/2026)');
select is((select (s.value ->> 'pendente_de_aprovacao')::boolean from public.app_settings s
            where s.key = 'ia.orcamento'), false,
          'o teto deixou de nascer pendente: ele foi decidido');
select is((app.ai_gasto_do_mes(null) ->> 'linha_do_freio_usd')::numeric, 60::numeric,
          'a linha do freio é o teto inteiro');
select is((app.ai_gasto_do_mes(null) ->> 'limite_de_alerta_usd')::numeric, 48::numeric,
          'a linha de alerta é 80% do teto, derivada e não escrita');
```

### 1.3 — A migração (5 min)

`supabase/migrations/20260925150000_o_orcamento_freia.sql`. Cabeçalho (POR QUE / O TETO SOBE E PASSA A DOER / AS DUAS LINHAS SÃO DERIVADAS / A REGRA É POR EXCLUSÃO), mais o `update` de `ia.orcamento` para `mensal_usd = 60` e `pendente_de_aprovacao = false` — `fracao_alerta` intacta, porque `app.app_settings_validate` (`20260905000200:367`) exige `mensal_usd` positivo e `fracao_alerta` em (0,1].

`app.ai_gasto_do_mes` recriada inteira com o `coalesce(..., 60)` no lugar do 25, a cascata de quatro degraus (`freou` → `passou_de_80` → `ritmo_acima` → `ok`) e o campo `linha_do_freio_usd`. E:

```sql
alter table public.ai_budget_alerts drop constraint if exists ai_budget_alerts_situacao_check;
alter table public.ai_budget_alerts
  add constraint ai_budget_alerts_situacao_check
  check (situacao in ('ritmo_acima', 'passou_de_80', 'freou'));
```

### 1.4 — Verde e commit

`pnpm db:reset && pnpm db:test && pnpm db:lint`

Commit: **O orçamento de IA sobe para 60 e ganha a linha do freio**

---

## Tarefa 2 — `app.ia_pode_gastar`, a casca, e uma fixture que funciona

### 2.1 — O teste que falha (5 min)

`plan(4)` → `plan(12)`. A fixture **corrigida em dois pontos**:

```sql
-- ---------- o mês, zerado dentro da transação ----------
-- Este banco tem operação real dentro, e `app.ia_pode_gastar` lê o mês
-- CORRENTE. Medir delta não serve: o que se mede aqui é uma LINHA absoluta.
-- Zerar o mês dentro da transação que dá rollback é o mesmo recurso que o
-- arquivo 24 usa com as filas do pgmq.
delete from public.ai_runs
 where (created_at at time zone 'America/Fortaleza')::date
       >= date_trunc('month', (now() at time zone 'America/Fortaleza')::date);

-- O custo NÃO é escrito: `app.ai_runs_before_write` (20260905000200:238)
-- recalcula `cost_usd` a partir dos tokens em todo INSERT e ignora o que
-- vier na coluna. O gasto se faz por TOKEN, e o modelo é fixado — com
-- `limit 1` em `ai_model_prices` o preço mudaria com a ordem das linhas.
-- claude-sonnet-5: US$ 1 = 500.000 tokens de entrada (mesma conta do 24).
create function pg_temp.gastar(p_usd numeric) returns void
  language sql security definer set search_path = '' as $$
  insert into public.ai_runs (purpose, model, prompt_version, tokens_in, tokens_out)
  values ('digest', 'claude-sonnet-5', 'pgtap67-gasto@v1', round(p_usd * 500000)::int, 0)
$$;

select pg_temp.gastar(21);
select ok((app.ia_pode_gastar('draft_reply') ->> 'pode')::boolean,
  'com US$ 21 de 60, os 12 propósitos ainda passam');

select pg_temp.gastar(28);                                   -- total 49
select ok(not (app.ia_pode_gastar('draft_reply') ->> 'pode')::boolean,
  'com US$ 49 de 60, draft_reply para na linha de alerta');
select is(app.ia_pode_gastar('draft_reply') ->> 'motivo', 'orcamento_na_linha_de_alerta',
  'e o motivo diz qual linha foi');
select ok((app.ia_pode_gastar('classify_inbound') ->> 'pode')::boolean,
  'classify_inbound sobrevive à linha de alerta: é ele que entende quem escreveu agora');
select ok((app.ia_pode_gastar('transcribe_audio') ->> 'pode')::boolean,
  'transcribe_audio também sobrevive');

select pg_temp.gastar(12);                                   -- total 61
select ok(not (app.ia_pode_gastar('classify_inbound') ->> 'pode')::boolean,
  'com US$ 61 de 60, nem classify_inbound passa');
select is(app.ia_pode_gastar('classify_inbound') ->> 'motivo', 'orcamento_esgotado',
  'e o motivo é o teto, não a linha de alerta');
select is(app.ia_gasto_bloqueado_para(), array['analisar_conversa','assistant','digest',
          'draft_followup','draft_reply','extract_listing','next_action','perguntar_ao_crm',
          'pulso_do_dia','summarize_call','summarize_deal','triar_candidato']::text[],
  'os 12 que param na linha de alerta, nomeados um a um: propósito novo derruba este teste');
```

### 2.2 — A função, a casca e a lista (4 min)

`app.ia_pode_gastar(text)` por exclusão, `app.ia_gasto_bloqueado_para()` perguntando à própria `ia_pode_gastar`, e `public.ia_pode_gastar(text)` como casca `security invoker` com `grant` só para `service_role` (o PostgREST expõe só `public`; mesmo motivo de `public.ia_fila_enfileirar`, `20260905000201:798`).

### 2.3 — Verde e commit

Commit: **O banco sabe dizer se ainda dá para gastar**

---

## Tarefa 3 — A fila recusa, o alerta grava `freou`, o painel conta

`plan(12)` → `plan(18)`. `app.ia_enfileirar` recriada perguntando ao freio **sem `raise`** (roda dentro da transação de `public.tabular_tentativa`, `20260906000100:358`), propósito desconhecido continua explodindo com `22023`; `app.ai_alerta_orcamento` grava as duas linhas quando o mês pula para `freou`, idempotente pela PK `(mes, situacao)`; `public.ia_orcamento_status()` ganha `freado`, `parados` e `propositos_parados`.

Antes das asserções do alerta, `delete from public.ai_budget_alerts where mes = to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM')` — que só funciona porque a transação dá rollback.

Commit: **A fila da IA recusa quando o mês acabou, e o alerta grava as duas linhas**

---

## Tarefa 4 — NOVA · A recusa não perde trabalho

**Este é o buraco do plano anterior.** Os cinco chamadores de `app.ia_enfileirar` e o que acontece com cada um quando o teto bate:

| Chamador | O que acontece hoje se recusar | Perde? |
|---|---|---|
| `app.ia_enfileirar_analises` (`20260917100000:332`), cron `*/5` | A chave é `conversa:contagem@última`. Não enfileirou → não gravou `ingest_dedup` → a passada seguinte tenta de novo | **não** |
| `app.ia_enfileirar_pulso` (`20260917120000:293`), cron `30 21 * * 1-5` | Chave do dia. O pulso **daquele** dia se perde; o de amanhã nasce | **um dia, e é aceitável** |
| `triar_candidato` (`20260917230300:44`), clique de gente | Chave do dia, dedup não gravado; o clique seguinte repete. A tela mostra `enfileirado:false` | **não** |
| `app.ia_enfileirar_resumo` → `public.tabular_tentativa` (`20260906000100:358`) | A tabulação **commita** e o resumo nunca mais é pedido. **Não existe cron que repita `summarize_call`** | **SIM — perda silenciosa** |
| `enfileirarTrabalho` (`tarefas.ts:261` e `:403`), depois da Tarefa 7 | `classify_inbound` depois da transcrição e `draft_followup` depois do resumo: devolvem `{enfileirado:false}` e **ninguém lê o motivo** | **SIM — duas perdas** |

Conserto: **a recusa por orçamento vira dívida anotada, não trabalho apagado.**

### 4.1 — O teste que falha (3 min)

`67_o_freio_do_orcamento.sql`, `plan(18)` → `plan(23)`. Com o mês em US$ 61 da fixture:

```sql
select has_table('public', 'ia_trabalho_adiado', 'a dívida do orçamento tem onde morar');

select is(app.ia_enfileirar('summarize_call',
            jsonb_build_object('attempt_id', '00000000-0000-4000-8000-000000000067'),
            'attempt:pgtap67') ->> 'motivo', 'orcamento',
  'a fila recusa o resumo da ligação');
select is((select count(*)::int from public.ia_trabalho_adiado a
            where a.chave = 'summarize_call:attempt:pgtap67'), 1,
  'e o trabalho recusado fica ANOTADO: a tabulação commita, e o resumo não some com ela');

select is((select count(*)::int from public.ia_trabalho_adiado a
            where a.chave = 'summarize_call:attempt:pgtap67'), 1,
  'anotar duas vezes o mesmo trabalho continua sendo uma linha: a chave é a idempotência');

-- Baixa o gasto abaixo da linha e prova que a dívida é paga sozinha.
delete from public.ai_runs where prompt_version = 'pgtap67-gasto@v1';
select is(app.ia_retomar_adiados(10), 1,
  'com o mês folgado de novo, o cron reenfileira o que ficou devendo');
```

### 4.2 — A tabela e a retomada (5 min)

No mesmo `20260925150000_o_orcamento_freia.sql`, **depois** de `app.ia_pode_gastar` e **antes** de `app.ia_enfileirar`: tabela `public.ia_trabalho_adiado` (chave PK, purpose, payload, chave_crua, motivo, tentativas, adiado_em, retomado_em), índice parcial de pendentes, RLS de leitura para `admin`/`gestor`/`financeiro`, `app.ia_retomar_adiados(int)` com `for update skip locked`, saída no primeiro "não pode", limpeza de dívida paga há mais de 30 dias, e cron `ia_retomar_adiados` a cada 20 min.

E `app.ia_enfileirar` anota antes de devolver, na mesma transação de quem chamou.

**Os três casos que não precisam de dívida continuam sem ela**: `analisar_conversa` e `triar_candidato` refazem a chave sozinhos, e a chave de `ingest_dedup` impede o duplo.

### 4.3 — Verde e commit

Commit: **A recusa por orçamento vira dívida anotada, não trabalho perdido**

---

## Tarefa 5 — `public.wa_servico_do_mes`

`plan(23)` → `plan(25)`: view `security_barrier = true, security_invoker = false` no molde de `public.wa_confirmacoes_devidas` (`20260905000400:759`), contando `direction='out' and not business_initiated and status <> 'failed'` por mês, com o filtro de papel escrito à mão. Só mede.

Commit: **O que a Meta cobra de serviço passa a ser medido**

---

## Tarefa 6 — `OrcamentoEsgotadoError` no worker

`montar()` (`execucao.test.ts:53`) já aceita `{ rpcs }`. Os dois testes, a classe ao lado de `AlvoSuprimidoError` (`execucao.ts:73`), a chamada **depois** de `alvoEstaSuprimido` (`:178`) e **antes** de `contexto.modelo.conversar()` (`:200`), a função `orcamentoPermite` e `eDeterministico` (`tarefas.ts:98`) aprendendo o erro novo.

Commit: **A chamada ao modelo pergunta se ainda dá para gastar**

---

## Tarefa 7 — A segunda porta, e o teste que já estava lá

`fila.ts:80` chama `esteira_fila_enfileirar` direto, pulando a lista de propósitos, o freio e agora a dívida.

### 7.1 — O teste existente **muda**, não é acompanhado

`fila.test.ts:29–48` afirma `nome === 'esteira_fila_enfileirar'`, `p_queue`, e `purpose` dentro de `p_payload`. Nada disso sobrevive. O `describe('enfileirarTrabalho')` inteiro é **substituído** por dois testes: a porta certa (`ia_fila_enfileirar`, `p_purpose`/`p_payload` com `chave`/`p_key`) e a recusa por orçamento que volta como motivo, não exceção.

O `describe('chaveDaMensagem')` (`:12–27`) **fica intacto**.

### 7.2 — A troca

`atrasoSegundos` some (nenhum dos dois chamadores o usava), `FILAS_DA_IA.trabalhos` continua exportada. O comentário de cabeçalho de `fila.ts` ganha o parágrafo de por que a porta larga foi fechada.

Commit: **A segunda porta da fila de IA passa a ter porteiro**

---

## Tarefa 8 — A mensagem que chegou não some

**(a) O `throw` de `executar()`** — `classificarEntrada` (`tarefas.ts:524`) captura `OrcamentoEsgotadoError`, escala e abre tarefa.

**(b) A recusa no ENFILEIRAMENTO** — `transcreverAudio` (`:261`) pede `classify_inbound` e `resumirLigacao` (`:403`) pede `draft_followup`.

### 8.1 — `buscarConversa` ganha a coluna

`banco.ts:115–152` passa a selecionar `assignee_id`, e `ConversaDoFio` ganha `assigneeId: string | null`.

### 8.2 — Os testes que falham

Orçamento estourado na entrada → `bot_paused`, `aguardando_nos`, tarefa; e transcrição com fila recusada → transcrição gravada, conversa escalada, tarefa com "Orçamento de IA" no título.

### 8.3 — O `catch` e o `if`

`abrirTarefaDeOrcamento` insere em `public.tasks` com `kind: 'message'`, `priority: 1`, `origin: 'system'`, título `'Orçamento de IA esgotado — responda à mão'`. `resumirLigacao` **não** abre tarefa: só `logger.warn`.

Commit: **Orçamento esgotado manda a conversa para gente, não para o silêncio**

---

## Tarefa 9 — A saúde do número: tabela, registrador e teto da Meta

`supabase/migrations/20260925160000_a_saude_do_numero.sql`. Tabela `public.wa_saude_numero` append-only por `app.forbid_change()` (`20260904000400:28`), RLS de leitura para `admin` e `gestor`, índice `(numero, ocorrido_em desc)`, `public.wa_saude_registrar(jsonb)` `security definer` só para `service_role`, com `coalesce(numero, app.wa_numero_padrao())`.

`app.wa_teto_da_meta(p_numero, p_quando)` lendo **a última linha que soube de cada coisa** (qualidade, tier, restrição separadamente), com a restrição vencida caindo sozinha e `ate` nulo quando alguma vigente não traz `expiration`.

**Correção do mapa de tiers.** A fonte viva é `max_daily_conversations_per_business`. `TIER_50`→50, `TIER_250`→250, `TIER_1K`→1000, `TIER_2K`→2000, `TIER_10K`→10000, `TIER_100K`→100000; `TIER_NOT_SET`/`TIER_UNLIMITED` → nulo.

Testes em `supabase/tests/68_saude_do_numero.sql`, `plan(16)`. A asserção de append-only usa `update … where true` esperando `42501`.

Commit: **O CRM guarda o que a Meta diz sobre o nosso número**

---

## Tarefa 10 — `app.pode_enviar` conhece a Meta

Passo 1.5 (banimento → `conta_banida` com `quando = +6 h`; restrição de entrada → `meta_restringiu_entrada`, **antes** do passo 2), passo 4.5 (`meta_restringiu_saida`), passo 5 com `least(nosso, da Meta)` e `qualidade_vermelha` quando `teto_dia = 0`, passo 6 também limitado. `app.envio_motivo_de_espera` ganha os quatro motivos novos — todos espera.

`68_saude_do_numero.sql`, `plan(16)` → `plan(20)`. Os helpers de conversa vêm do **`24_ia_e_whatsapp.sql`**.

Rede real: **`24_ia_e_whatsapp.sql`**, **`25_confirmacao_de_optout_estreita.sql`** e **`24_worker_wa_e_webhook.sql`**.

Commit: **O teto efetivo passa a ser o menor entre o nosso e o da Meta**

---

## Tarefa 11 — O webhook aprende três campos

`messaging_limit_tier_update` não existe. Os três que existem: `phone_number_quality_update`, `account_update`, `business_capability_update`.

Os tipos de restrição que nos afetam: `RESTRICTED_BIZ_INITIATED_MESSAGING` e `RESTRICTED_CUSTOMER_INITIATED_MESSAGING`.

### 11.1 — Os testes que falham

A asserção de hoje (`extrair.test.ts:192`) muda de expectativa, mais: tier vivo tem precedência sobre o obsoleto; campo obsoleto sozinho ainda vale; `FLAGGED` → `RED`; `UNFLAGGED` → `null`; `account_update` traz restrição e banimento e não traz número; campo realmente desconhecido continua em `ignorados`.

### 11.2 — O tipo e a extração

`ItemDaMeta` ganha o membro `tipo: 'saude'`. `CAMPOS_DE_SAUDE` no lugar do `continue` de `extrair.ts:197`. `chave = saude:${campo}:${entrada.id}:${entrada.time}:${indice}`.

### 11.3 — O worker despacha

`entrada.ts:117` ganha `tratarSaude`, e `ContagensDaEntrada` (`:73`) e `contagensDaEntradaZeradas()` (`:87`) ganham `saude_registrada`.

Commit: **O webhook para de jogar fora o que a Meta diz do número**

---

## Tarefa 12 — A assinatura dos campos, que não se faz por API

**Não existe** lista de campos no corpo de `subscribed_apps`. Quais campos a app recebe é configuração do App Dashboard. O passo 4 do `--conectar` passa a **conferir** e dizer, por nome, o que falta.

`CAMPOS_DE_SAUDE_ESPERADOS` exportada em `conectar.ts`, com o comentário explicando por que não se assina por ali. O mesmo texto entra em `docs/operacao/whatsapp-no-crm.md`.

Commit: **O conectar diz quais campos de webhook ainda faltam assinar**

---

## Tarefa 13 — A outra metade: a leitura periódica pela Graph

`CAMPOS_DO_NUMERO` (`conectar.ts:87`) já inclui `quality_rating`, `status`, `name_status`, `throughput`. Hoje é pedido uma vez, na conexão.

Testes com `bancoFalso` de `../ia/banco-de-teste` e o dublê da Graph — **não** `clienteFalso`/`loggerDeTeste`, que não existem.

`saude.ts`: `lerSaudeDoNumero` grava por `wa_saude_registrar` com `origem: 'graph'`; falha de rede **não grava nada**. `criarSaudePeriodica` com `talvezDisparar`/`encerrar`, instância própria, intervalo de 30 min.

`wa.ts`: instância ao lado de `modelos` (~`:157`), `talvezDisparar()` (`:216`), `encerrar(parando)` (`:252`).

Commit: **O worker-wa pergunta de meia em meia hora como está o número**

---

## Tarefa 14 — O furo do recontato, e os DOIS tetos que precisam concordar

`app.pode_enviar` consulta o aquecimento **dentro de `if p_primeiro_contato`**. Uma campanha de recontato sobre 3.000 fichas já tocadas pula o passo 5 inteiro.

**O que o plano anterior não viu:** `app.toques_do_dia` (`20260905000200:1292`) é **quem a cadência consulta**. Os dois têm de contar a mesma coisa.

### 14.1 — O teste que falha

`supabase/tests/69_teto_de_aberturas.sql`, `plan(9)` — os sete do plano anterior mais a igualdade `toques_do_dia == aberturas_do_dia` e `pode_tocar` devolvendo `teto_do_canal` com o dia cheio.

### 14.2 — `app.aberturas_do_dia` e o apelido

`supabase/migrations/20260925170000_o_teto_conta_aberturas.sql`. `app.aberturas_do_dia(p_channel, p_dia, p_numero)` como cópia de `app.primeiros_contatos_do_dia` trocando `m.is_first_contact` por `m.business_initiated` e acrescentando `and not m.optout_confirmation`. `app.toques_do_dia` passa a delegar.

`app.primeiros_contatos_do_dia` **fica de pé, sem mudar**.

Índice `messages_aberturas_idx`; `messages_teto_idx` cai.

### 14.3 — `app.pode_enviar` sem o `if`, e as duas telas

`if p_primeiro_contato` removido do passo 5. `public.envio_em_massa_teto()` ganha `teto_nosso`, `teto_da_meta`, `qualidade`, `quem_manda` e `usados`.

### 14.4 — O que isso faz com a operação de HOJE

- **Nenhum lote morre.** `teto_do_numero` já é espera; o lote dorme e continua amanhã.
- **O ritmo cai na hora.** De 150/dia para 45/dia. 3.000 fichas passam de 20 para 67 dias úteis.
- **O teto passa a ser do time inteiro.**
- **Subir é `update` do gestor**, em `app_settings.cadencia.tetos.whatsapp.depois`, com `teto_duro` de 100. Recomendação: só depois de **duas semanas com `qualidade = 'GREEN'`**.

### 14.5 — Verde e commit

Rede: **`24_ia_e_whatsapp.sql`** (`:558–594`) e **`25_confirmacao_de_optout_estreita.sql`**.

Commit: **O aquecimento passa a contar abertura, e a campanha de recontato deixa de passar por baixo**

---

## Tarefa 15 — O teto de fala do robô e o detector de pingue-pongue

`supabase/migrations/20260925180000_o_robo_tem_teto_de_fala.sql`. Os quatro números em `app_settings.whatsapp.robo_teto` (6 falas / 24 h; 3 recebidas em menos de 20 s; 3 iguais; 120 por hora), o modelo `GEN-SYS-HUMANO`, `app.wa_modelo_humano()`, `app.wa_bot_falas`, `app.wa_bot_pode_falar` (pura) e `app.wa_bot_freiar` (despedida → `bot_paused` → tarefa).

Campanha e cadência **não** entram nessa conta: `author_kind = 'human'`.

O gatilho `messages_a_freio_do_robo` roda antes de `messages_bot_de_entrada` porque `_` ordena antes de `f`.

### 15.1 — O teste

`supabase/tests/70_teto_de_fala_do_robo.sql`, `plan(11)`. A última asserção usa **`public.wa_optout_registrar(uuid, text, boolean)`** — `public.wa_optout_confirmar` não existe.

Commit: **O robô ganha teto de fala e detector de pingue-pongue**

---

## Tarefa 16 — O guarda aperta, e religar apaga o freio

A versão viva de `app.messages_guard` é `20260916130000:13`, recriada inteira, com o bloco `(0b)` **depois** do `return new` da confirmação de opt-out e **antes** do ramo `(1) Eco do celular`.

`public.wa_bot_ligar(true)` passa a apagar `freio` junto com `ativo`. Nasce `public.wa_freios_status()`.

`70_teto_de_fala_do_robo.sql`, `plan(11)` → `plan(14)`.

Rede: **`47_bot_de_entrada.sql`**, **`61_automacoes_do_atendimento.sql`**, **`24_ia_e_whatsapp.sql`**, **`25_confirmacao_de_optout_estreita.sql`**, **`49_a_ficha_gravada.sql`**.

Commit: **O guarda passa a contar as falas do robô, e religar apaga o freio**

---

## Tarefa 17 — Os tipos e a tela

```bash
pnpm db:types && pnpm typecheck
```

`public.ia_orcamento_status()` **não é chamada em lugar nenhum do `apps/web`**. Tipo `Freios`, `buscarFreios()`, e três cartões no topo de `painel-atendimento.tsx`: Orçamento de IA, Número na Meta, Teto de fala do robô.

`buscarTetoDeHoje` (`apps/web/src/components/envios/dados.ts:103`) tem `z.object` que descarta o resto: os campos novos entram no schema. "primeiros contatos" vira **"aberturas"**.

Commit: **Os freios aparecem na tela de quem opera**

---

## Tarefa 18 — O CHANGELOG

Entregue, o que mudou de comportamento, as correções de fato e as pendências.

Commit: **CHANGELOG: os quatro freios, antes de existir o que freiar**

---

## A conferência final

```bash
pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm db:types
pnpm lint && pnpm typecheck && pnpm test
deno test supabase/functions/wa-webhook/
```

Nada desta fase vai a produção. Os três campos de webhook ficam **escritos como pendência**, não assinados.

**O que esta fase NÃO fez, de propósito:** o árbitro de quem responde, intenção → texto pronto, os `GEN-SYS-*` por intenção e o fim do teto de duas falas do bot de entrada. Tudo Fase 4.

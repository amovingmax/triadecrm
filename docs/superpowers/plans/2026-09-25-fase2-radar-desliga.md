# Fase 2 — o Radar desliga, a Revisão fica

**Repositório:** `/Users/matheusrondon/Documents/Tríade` · **Spec:** `docs/superpowers/specs/2026-09-24-pivo-scraper-e-robo-autonomo-design.md` §4 (linhas 337–497) · **Hoje:** 25/09/2026 (sexta)

Antes de qualquer coisa, e em toda aba nova:

```bash
cd /Users/matheusrondon/Documents/Tríade && source scripts/dev-env.sh
```

Estado de partida verde: pgTAP **2.939 asserções em 66 arquivos**; **812 testes do web em 51 arquivos**.

A ordem das 11 tarefas é a da spec: **o interruptor antes da tesoura**. A Tarefa 1 é reversível com um `update` e é um commit inteiro por si só — se a decisão for esperar os sete dias que a spec §4.1 pede entre o interruptor e a tesoura, é nela que se para, e as Tarefas 2–11 esperam.

---

## Tarefa 1 — O Radar para de coletar, e a fonte fica

O `update` que desliga as cinco fontes de coleta, o espelho na seed (senão o próximo `db:reset` religa tudo) e os **três** pgTAP que contavam com fonte ligada.

### 1.1 — O teste que prova o estado (falha)

`supabase/tests/08_seed.sql` mede o que a seed deixa no banco. As duas asserções novas entram logo depois da contagem de fontes (linha 18):

```sql
-- O Radar parou de coletar (Fase 2 do pivô, 25/09/2026). O estado é
-- `is_enabled = false` nas CINCO fontes de coleta, e não linha apagada: os 277
-- candidatos já colhidos apontam para elas e o RF-RAD-05 exige a proveniência.
select is(
  (select count(*)::int from public.sources
    where slug in ('casamentos_com_br','base_cnpj','sympla_outgo','olx','telelistas')
      and is_enabled),
  0, 'seed: nenhuma das cinco fontes de coleta está ligada');

-- E são CINCO, não sete. Aqui `is_enabled` quer dizer "vale como ORIGEM no CRM"
-- (seed.sql:111): desligar o Instagram cortaria a mão de quem cadastra à mão, e
-- desligar o google_places cortaria a busca de telefone por candidato da Fase 1.
select is(
  (select count(*)::int from public.sources
    where slug in ('instagram','google_places') and is_enabled),
  2, 'seed: instagram e google_places continuam ligados — são origem, não coletor');
```

E o `plan()`: `select plan(62);` (era 60).

### 1.2 — A migração (o interruptor)

`supabase/migrations/20260925130000_o_radar_para_de_coletar.sql` — cabeçalho longo explicando POR QUE um `update` e não um `delete`, por que são cinco fontes e não sete, e que o arquivo é reversível de propósito. O corpo:

```sql
update public.sources
   set is_enabled = false
 where slug in ('casamentos_com_br','base_cnpj','sympla_outgo','olx','telelistas');
```

### 1.3 — O espelho na seed

Cinco literais em `supabase/seed.sql` (linhas 126, 131, 146, 151, 156) viram `false`; **136** (google_places) e **141** (instagram) ficam `true`. E o bloco de comentário de `is_enabled` (111–112) ganha o porquê.

### 1.4 — Os TRÊS pgTAP que dependiam de fonte ligada

- **`supabase/tests/16_esteira_de_ingestao.sql`** — antes da linha 147, `update public.sources set is_enabled = true where slug = 'casamentos_com_br';`, FORA da sessão simulada (precedente: `03_dedup.sql:154`, que faz o contrário para telelistas).
- **`supabase/tests/21_coletor_do_radar.sql`** — o mesmo antes da linha 157.
- **`supabase/tests/23_dreno_reconfere.sql:289`** — `radar_criar_candidato` recebia `(select id from public.sources order by id limit 1)`, que é `casamentos_com_br`. Passa a pedir `captura_campo` pelo slug. As linhas 93 e 326 do mesmo arquivo ficam: são `insert` direto, sem guarda de `is_enabled`.

Nenhum `plan()` muda nos três: não é asserção.

### 1.5 — Verde e commit

```bash
pnpm db:reset && pnpm db:test && pnpm db:lint
```

Commit: **O Radar para de coletar, e a fonte fica**.

---

## Tarefa 2 — O comando `ingest` sai do CLI dos workers

`apps/workers/src/ingest/` **não é uma pasta do coletor**: `ingest/esteira.ts` (356 linhas) é o cliente de fila genérico, importado por nove arquivos que ficam (`rotas/banco.ts`, `ia/execucao.ts`, `ia/tarefas.ts`, `ia/fila.ts`, `ia/banco.ts`, `ia/registro.ts`, `ia/banco-de-teste.ts`, `ia/fila.test.ts`, `lib/pulso.ts`).

### 2.1 — O teste que prova (falha)

Em `apps/workers/src/cli.test.ts`: o separador `--` passa a usar `wa`; o bloco `it('lê as opções da coleta')` sai inteiro; o bloco de opção errada troca para `wa`/`ai`; a linha 78 e a asserção de precedência passam a `wa`/`rotas`. E entra a asserção nova: `'ingest'` é comando desconhecido, tanto na linha quanto em `WORKER_COMANDO`.

### 2.2 — `lib/env.ts` e `lib/env.test.ts`

`ingest: baseEnvSchema` sai de `envSchemas`. Como `ingest` era o único comando cujo esquema era o base puro, `env.test.ts` passa a medir por `rotas`, com uma fixture `baseRotas` que acrescenta `NOMINATIM_USER_AGENT`.

### 2.3 — O CLI encolhe

`WORKER_COMMANDS = ['wa', 'ai', 'rotas']`; `OPCOES_POR_COMANDO` perde `ingest`; o `USAGE` perde a linha e o bloco de opções; o comentário da precedência passa a citar `rotas`.

### 2.4 — `esteira.ts` muda de casa; o resto sai

```bash
mkdir -p apps/workers/src/fila
git mv apps/workers/src/ingest/esteira.ts apps/workers/src/fila/esteira.ts
grep -rl "'../ingest/esteira'" apps/workers/src | xargs sed -i '' "s|'../ingest/esteira'|'../fila/esteira'|g"
git rm -r apps/workers/src/ingest apps/workers/src/workers/ingest.ts
```

14 arquivos, 2.408 linhas. Em `index.ts` saem o import e o `case`; `lib/log.ts:21` troca o exemplo. A whitelist do lado do worker vai junto — a lei mora em `app.payload_e_permitido`, amarrada por constraint.

### 2.5 — Verde e commit

Commit: **O comando ingest sai do CLI dos workers**.

---

## Tarefa 3 — A imagem dos workers larga o Chromium

### 3.1 — As três dependências saem

`cheerio`, `crawlee` e `playwright` saem de `apps/workers/package.json`; a `description` passa a dizer três comandos.

### 3.2 — O Dockerfile, o Compose e o healthcheck

`apps/workers/Dockerfile` tem `ENV WORKER_COMANDO=ingest`: sai, e a imagem passa a não ter padrão. O serviço `worker-ingest` sai do `infra/local/docker-compose.yml` (com o `shm_size: 512m`), e o healthcheck perde `'ingest'`.

### 3.3 — O Fly: o comando e a data, não a execução

**Nada é executado.** `infra/nuvem/fly.worker-ingest.toml` **fica**, com um cabeçalho: `fly scale count 0` hoje; `fly apps destroy` **não antes de 03/10/2026**; e o passo 3 é apagar o próprio arquivo no mesmo commit.

### 3.4 — Os textos da operação

`README.md:46,96`, `infra/local/README.md:14,36,40`, `.env.example:137,139`, `docs/operacao/maquina-do-luiz.md`.

### 3.5 — Verde e commit

Commit: **A imagem dos workers larga o Chromium**.

---

## Tarefa 4 — `/radar` vira `/revisao`, e o velho endereço redireciona

### 4.1 — O teste do redirect (falha)

Os redirects saem do `next.config.ts` para `apps/web/src/lib/redirecionamentos.ts`, porque o Vitest do web só enxerga `src/**/*.test.ts`. O teste prova o 308 e que nenhum redirect aponta para si mesmo. `rotas-publicas.test.ts:42` passa a usar `/revisao`.

### 4.2 — O módulo e o `next.config.ts`

`REDIRECIONAMENTOS` exportado; `async redirects()` no `next.config.ts`.

### 4.3 — As pastas mudam de nome

```bash
git mv "apps/web/src/app/(app)/radar" "apps/web/src/app/(app)/revisao"
git mv apps/web/src/components/radar apps/web/src/components/revisao
```

### 4.4 — A página

`page.tsx` perde `searchParams` e `abaInicial`; `podeLigarFonte` vira `podeAjustarTriagem`. `tela-radar.tsx` → `tela-revisao.tsx` (só o `git mv`, o export e as propriedades; o corpo é a Tarefa 7).

### 4.5 — Verde e commit

Commit: **/radar vira /revisao, e o velho endereço redireciona**.

---

## Tarefa 5 — No menu, Revisão

`navegacao.test.ts:84,149,212` mais uma asserção nova que trava a mudança de grupo. O item passa a `/revisao`, rótulo "Revisão", ícone `ListChecks`, grupo `todo_dia`, e continua fora de `ORDEM_PRINCIPAL`. `filas-do-menu.ts` só muda comentário.

Commit: **No menu, Revisão**.

---

## Tarefa 6 — A batida do worker vai para Ajustes → Atendimento

Esta tarefa **ACRESCENTA** em `admin/`, não move: o painel do coletor ainda importa os originais de `revisao/`, e ele só morre na Tarefa 7. Cada commit fica verde.

- `components/admin/tipos.ts` ganha `BatidaDeWorker`, `FilaDaEsteira`, `SaudeDaEsteira`.
- `components/admin/dados.ts` ganha `buscarSaudeDaEsteira` e os helpers `objeto()`/`texto()`.
- `components/admin/painel-atendimento.tsx` ganha ~40 linhas: uma linha por robô, só `wa` e `ai`.

Commit: **A batida do worker vai para Ajustes → Atendimento**.

---

## Tarefa 7 — O catálogo de fontes e o painel do coletor saem da tela

- `git rm` em `painel-coletor.test.ts`, `catalogo-fontes.tsx`, `painel-coletor.tsx`, `agendar-coleta.tsx` (935 linhas).
- `dados.test.ts` perde o `describe('paraFonte')` inteiro.
- `dados.ts` 652 → ~330; `tipos.ts` 387 → ~245. **`TipoDeFonte` FICA** (é o tipo de `CandidatoDaFila.fonte_tipo`). `buscarSaudeDaEsteira` sai daqui (ganhou casa em `admin/` na Tarefa 6).
- `tela-revisao.tsx` 444 → ~375: saem `PainelDoColetor`, `SeletorDeAba`, `AgendarColeta`, `CatalogoDeFontes`, o estado `aba` e o `useEffect` da URL.
- `barra-fila.tsx:79` — "Fonte" vira "Origem". `ui/abas.tsx` **não** é apagado.
- `estados.tsx` — a `FilaVazia` para de mandar olhar um painel que não existe.

Commit: **O catálogo de fontes e o painel do coletor saem da tela**.

---

## Tarefa 8 — A tesoura no banco: três funções e o catálogo de coleta

### 8.1 — Os pgTAP (falham)

- `git rm supabase/tests/37_a_coleta_cabe_num_botao.sql supabase/tests/54_agendar_coleta_pela_tela.sql` (−22 e −12).
- `14_radar_candidatos.sql`: sai o bloco "10. Ligar e desligar fonte" (4 asserções); `plan(65)`.
- `21_coletor_do_radar.sql`: saem 3 asserções do `config->collector->catalogo`; `plan(33)`.
- `22`, `33`, `03`, `08`, `41`, `55`, `64`, `66`: intocados.

### 8.2 — A migração (a tesoura)

`supabase/migrations/20260925140000_a_revisao_fica_o_coletor_sai.sql`:

```sql
drop function if exists public.radar_coletar_agora(int, text[], int);
drop function if exists public.radar_agendar_coleta(int, text[], int, text);
drop function if exists public.radar_alternar_fonte(int, boolean);
-- create or replace public.radar_resumo() sem os três números de fonte
update public.sources
   set config = (config #- '{collector,catalogo}') #- '{collector,agente}'
 where slug = 'casamentos_com_br';
```

### 8.3 — O espelho na seed

Sai o `update` do catálogo do bloco 3b (228–259); o `insert into public.source_category_map` fica. Na autoverificação, saem `n_rad` em **três** lugares: a declaração (1629), a contagem (1657–1658) e o `raise notice` (1747), mais o `if n_rad < 18`. `n_map` e `n_map_google` ficam: são contadores diferentes.

### 8.4 — Os tipos, o verde e o commit

`pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm db:types`. Esperado: pgTAP ~2.900 em 64 arquivos.

Commit: **A tesoura no banco: três funções e o catálogo de coleta**.

---

## Tarefa 9 — Nas telas, Radar vira Revisão

A varredura: ~152 ocorrências em 49 arquivos.

### 9.1 — Os que mudam o destino de um link

`importacao/recibo.tsx:103` (o único caminho entre "importei" e "agora decide"), `meu-dia/estados.tsx:56`, `meu-dia/tela-meu-dia.tsx:311`, `relatorios/painel-categorias.tsx:282`, `relatorios/painel-fontes.tsx:184,189,198`. Os `?aba=fontes` **não** viram `/revisao?aba=fontes`: a aba morreu.

### 9.2 — Os que só citam o nome

Três frases ficariam mentindo e ganham texto novo: `relatorios/estados.tsx:150`, `agenda/tela-rota.tsx:544,579`, `api/telefone/candidato/route.ts:12`.

**O que NÃO muda:** `filtro-comando.test.ts:36` e os nomes de RPC/tipo que espelham o banco (`carregarCatalogosDoRadar`, `CatalogosDoRadar`, `ResumoDoRadar`, `repontuarORadar`).

Commit: **Nas telas, Radar vira Revisão**.

---

## Tarefa 10 — A fila diz que candidato parado some em 90 dias

Os 277 candidatos **ficam onde estão. Nada é apagado à mão.** A retenção do PRD §10.6 resolve com data: **16/12/2026**.

- `components/revisao/tipos.test.ts` (novo): `diasAteSumir` e `PRAZO_DE_RETENCAO_DIAS`.
- `components/revisao/tipos.ts`: a constante e a função.
- `cartao-candidato.tsx`: uma linha discreta, só nos últimos 30 dias e só para `status === 'novo'`.

Commit: **A fila diz que candidato parado some em 90 dias**.

---

## Tarefa 11 — CHANGELOG

Entrada `### 25/09/2026 — Fase 2 do pivô: o Radar desliga, a Revisão fica`, com os números de verdade (não as estimativas deste plano), os três desvios da spec (`esteira.ts` mudou de casa em vez de sair, `TipoDeFonte` fica, `fly.worker-ingest.toml` fica) e as pendências com data.

Commit: **CHANGELOG: o Radar desliga, a Revisão fica**.

---

## Conferência final

```bash
pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm db:types
git diff --stat packages/schema/src/database.types.ts   # vazio depois do commit
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter web build

grep -rn "radar_coletar_agora\|radar_agendar_coleta\|radar_alternar_fonte" \
  apps/ packages/ supabase/ | grep -v "\.next\|supabase/migrations/2026092"

grep -rn "worker-ingest\|'ingest'\|WORKER_COMANDO=ingest\|ingest/esteira" \
  apps/ infra/ README.md .env.example | grep -v "\.next\|fly.worker-ingest.toml"
```

As duas varreduras devem sair vazias.

---

## Limites desta fase

- **Não** destruir nem tocar no app do Fly (`triade-worker-ingest`): a spec manda esperar sete dias. No máximo, deixar escrito o comando e a data.
- **Não** executar nada em produção: nem `supabase db push`, nem `vercel`, nem `git push`.
- **Não** apagar a tela de curadoria: ela vira "Revisão" e continua sendo o destino das linhas duplicadas e sem categoria de qualquer origem.
- O interruptor vem **antes** da tesoura.

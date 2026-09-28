# Plano — a distribuição sai, a fila vira de todos e o que saiu sozinho ganha tela

**Dia:** 28/09/2026 · **ADR novo:** ADR-17 ("a fila de quem respondeu é de quem abrir; ninguém distribui")
**Requisitos tocados:** RF-CON-04, RF-CON-05, RF-CON-24, RF-MET-03/04, RF-ADM-03

---

## O pedido do Rafael, nas palavras dele

> "onde e como vemos as mensagens que foram enviadas automáticas? como tá esse processo?
> deixe isso organizado, e não distribua automático, estamos com operadores reduzidos que
> nem logam às vezes".

Três coisas: **(A)** desligar a distribuição automática, **(B)** a fila de quem respondeu
deixar de ser de uma pessoa e passar a ser de quem abrir, **(C)** uma tela para ver o que
saiu sozinho.

---

## O que eu abri antes de escrever

### Confirmado no código

1. **`sdr` NÃO tem RLS estreita em `conversations`.** `app.sees_all()`
   (`20260904000500_rls_e_papeis.sql:46-50`) é `admin, gestor, sdr, leitura, financeiro`;
   `conversations_select` (`20260905000200:720-726`) começa por ele. Quem é estreito é o
   **embaixador**.
2. **Conversa nova sem dono não existe.** `assignee_id` é `not null`
   (`20260905000200:613`) e `app.conversations_before_write` (`:675-699`) preenche na
   cascata dono da ficha → `app_settings['inbox.responsavel_padrao'].profile_id` →
   primeiro ativo admin/gestor/sdr → exceção `23502`.
3. **`supabase/seed.sql` não tem `app_settings`.** O padrão mora em migração
   (`20260922120000:22-27`). Nada a editar na seed — o `db reset` roda as migrações.
4. **O cumprimento da campanha é `author_kind = 'human'`** (`20260915130000:338-341`,
   `sent_by = v_eu`), e a confirmação de opt-out é `'system'` (`20260905000300:802`).
   O recorte `in ('bot_fixed','bot_ai')` do pedido deixaria o opt-out de fora.

### Dois leitores da chave, não um

Além de `app.conversations_a_distribuir`, a função **`app.conversations_setor()`** consulta
`app.atendimento_liga('distribuicao_automatica')` (`20260922120000:101`) para reencaminhar a
conversa quando o menu do bot muda o setor. Desligar a chave **também desliga isso**. Não é
o que o Rafael pediu; é consequência, e ela precisa estar escrita e testada.

### O que não consigo medir

`select count(*) from public.messages` no banco local é **0**: nem `seed.sql` nem
`scripts/seed-dev-5k.sql` criam mensagem ou conversa. Os volumes por tipo saem da consulta
da Tarefa 13, para alguém rodar em produção.

---

## Decisões desta rodada

### (A) A distribuição automática sai

Uma migração vira a chave e passa a ser o padrão do `db reset`. O interruptor em
Ajustes → Atendimento continua religando sem deploy.

**O que passa a acontecer com conversa nova:** nada de órfão. A cascata do
`conversations_before_write` continua dando dono; o que some é o degrau do setor, e o dono
passa a ser quase sempre o mesmo perfil. Nenhuma tela quebra: `assignee_id` é `not null` e
nenhuma consulta o trata como opcional. O que quebra é a operação, se (B) não subir junto.

**A consequência fora do pedido:** `app.conversations_setor()` também lê a chave. Com ela
desligada, o menu do bot continua **mudando o setor** da conversa, mas **não reencaminha**
para alguém desse setor. Medido na asserção 6 do teste 89 e anotado como pergunta ao Rafael.

### (B) A fila de quem respondeu vira de quem abrir

- **Quem "pode atender": `admin`, `gestor`, `sdr` veem a fila inteira; `embaixador`
  continua vendo só as conversas endereçadas a ele; `leitura` e `financeiro` não veem
  nada.** O critério é o banco: responder é `insert` em `public.messages`, e
  `messages_insert` (`20260905000200:1691-1704`) exige `app.can_write()` **e** que a
  conversa passe no mesmo recorte de `conversations_select`. Para admin/gestor/sdr,
  `app.sees_all()` já resolve as duas coisas. Para `leitura`/`financeiro`, `can_write()` é
  falso: pôr item na fila de quem o banco vai recusar é mandar trabalhar e depois dizer não.
- **O embaixador: a verdade, não a frase bonita.** Ele continua recebendo
  `conversas_esperando_gente(v_alvo)`, ou seja, as conversas **endereçadas a ele** —
  exatamente o que recebe hoje. Não é "a carteira dele": uma conversa de uma ficha da
  carteira, endereçada a outra pessoa, não entra. Alargar para a carteira exigiria um
  segundo recorte dentro da função e ninguém pediu isso.
- **O que aparece no item:** coluna nova `atendente` em `public.meu_dia`, com o primeiro
  nome de quem a conversa aponta, e **`null` quando é minha**. O dono continua existindo,
  continua no cabeçalho da conversa ("Atendendo") e `public.assumir_conversa`
  (`20260914100000:854`) continua sendo o jeito de dizer "deixa comigo".
- **O que evita duas pessoas na mesma conversa: o que já existe.**
  `conversas_esperando_gente` exige que a última palavra seja do lead; quem responde vira a
  última palavra nossa e a conversa sai da fila **de todo mundo**.
  `app.messages_quem_responde_atende` (`20260914100000`) já passa o atendimento para quem
  falou. Sem lock, sem reserva. Medido na asserção 6 do teste 90.
- **Um defeito que só aparece agora:** `distinct on (q.de_quem, coalesce(org, conversa))`
  deduplicava **dentro de cada pessoa**. Sem filtro, dois fios da mesma ficha com atendentes
  diferentes renderiam duas linhas. Tirar `de_quem` da chave conserta e não muda nada no
  caso filtrado.

### (C) A tela do que saiu sozinho: aba "Automáticas" em Conversas

Relatórios é o grupo "Controle" (`lib/navegacao.ts:186`), de coisa semanal; a pergunta do
Rafael é diária. Ajustes é `papeis: ['admin','gestor']` (`:374`) e quem precisa flagrar "o
robô falou e ninguém assumiu" é quem atende, inclusive sdr. Conversas é onde a pergunta
termina: toda linha tem uma ação, e ela é sempre abrir e assumir.

**Decisão: aba `Automáticas` em `/conversas`, e um link de uma linha em Ajustes →
Atendimento.**

**Consulta nova, `public.mensagens_automaticas`.** Nenhuma existente serve:
`conversas_esperando_gente` responde por conversa; `envio_em_massa_detalhe`
(`20260921100000:603`) é por lote; `conversas/dados.ts` é por parceiro e tem teto.

**O recorte: `direction = 'out' and author_kind <> 'human'`.** Pega `bot_fixed` (menu do
bot, ausência, introdução), `bot_ai` (rascunhos aprovados) e `system` (confirmação de
opt-out). **Deixa de fora o cumprimento da campanha**, que é `human` assinado por quem
disparou e já tem tela em `/envios` com `respondeu` por item. **Isso é desvio do pedido**,
que listava o cumprimento; vai como pergunta ao Rafael, não como fato consumado.

**O que aconteceu depois, em duas colunas independentes** — `respondeu_em` (primeira
entrada do lead **depois daquela mensagem**) e `gente_falou_em` (primeira saída `human`
depois dela). Duas, e não um rótulo, porque um rótulo perderia o caso que importa:
*respondeu e ninguém falou*.

---

## As tarefas

### Tarefa 0 — o verde de partida

`source scripts/dev-env.sh`; contar `supabase/tests/*.sql`; `pnpm db:reset && pnpm db:test`;
`pnpm test`. Anotar arquivos e asserções — não presumir 3.176/81.

### (A) A distribuição automática sai

- **Tarefa 1** — `supabase/tests/89_a_distribuicao_sai.sql`, 6 asserções, vermelho medido:
  1. depois das migrações a distribuição nasce desligada;
  2. conversa nova continua com dono;
  3. e o dono é o *fallback* do `before_write`, não `app.setor_quem_recebe`;
  4. o interruptor continua sendo um interruptor (o gestor religa);
  5. religada, ela volta a distribuir (o esperado é capturado **antes** do insert, porque
     `setor_quem_recebe` conta conversas abertas e o próprio insert mudaria a resposta);
  6. com a chave desligada, o menu do bot muda o setor e **não** reencaminha.
- **Tarefa 2** — `supabase/migrations/20261002170000_a_distribuicao_automatica_sai.sql`:
  um `update` de uma linha em `app_settings`. O gatilho **fica**: apagar código para
  desligar comportamento é trocar um clique por um pull request.
- **Tarefa 3** — verde, `db:lint`, commit.

### (B) A fila de quem respondeu vira de quem abrir

- **Tarefa 4** — `supabase/tests/90_a_fila_e_de_quem_abrir.sql`, 7 asserções. Fixtures
  novas (o 87 não tem perfil embaixador nem leitura), e `pg_temp.saiu` ganha `p_quando`:
  pgTAP roda tudo numa transação e `now()` é **congelado**, então sem empurrar o carimbo
  toda comparação estrita de `created_at` daria falso.
- **Tarefa 5** — revirar a asserção 22 do 87 (ela fixava o comportamento antigo) e
  **reconferir 18–21 e 23–25**: com o bloco 0 global, as 15 vagas passam a ser preenchidas
  pelas conversas mais antigas de todo mundo.
- **Tarefa 6** — `20261002180000_a_fila_de_quem_respondeu_e_de_todos.sql`, parte 1: recriar
  `app.conversas_esperando_gente` inteira, mudando o `distinct on` e o `order by`. Grants:
  nenhum muda.
- **Tarefa 7** — parte 2: `public.meu_dia` ganha a coluna `atendente` (muda o tipo de
  retorno → `drop` + `create`, grants refeitos no fim). O papel que decide o recorte é o de
  **quem a fila é**, não de quem pergunta.
- **Tarefa 8** — verde, `db:lint`, e **medir** `explain analyze` da chamada sem filtro com
  3.000 esperando. Se passar de ~600 ms, empurrar o teto para dentro da função **nesta
  rodada**. Não criar índice: `20261002150000:201-210` já mediu que o pré-filtro não tem
  caminho de índice.
- **Tarefa 9** — `pnpm db:types`; `atendente` em `ItemDoDia`, `LinhaDaFila` e no `map`; a
  linha "Endereçada a X" no item; Vitest do **mapeamento** (não um literal que lê o próprio
  campo); commit.

### (C) A tela do que saiu sozinho

- **Tarefa 10** — `supabase/tests/91_o_que_saiu_sozinho.sql`, 7 asserções, com as fixtures
  que faltavam: **religar** `introducao_ativa` antes de o lead responder e **disparar** o
  opt-out, senão as asserções 1 e 2 medem o vazio.
- **Tarefa 11** — `20261002190000_o_que_saiu_sozinho.sql`: índice parcial +
  `public.mensagens_automaticas`. `respondeu_em` é subconsulta (a primeira entrada **depois
  daquela mensagem**), não `last_inbound_at` — este leria a última entrada da conversa
  inteira e marcaria "respondeu" em toda automática antiga de conversa viva.
- **Tarefa 12** — `system` ganha rótulo no fio (`'Confirmação automática'`), porque
  "Alguém do time" é falso para uma confirmação que o banco montou.
- **Tarefa 13** — a consulta de volumes por tipo, para alguém rodar em produção.
- **Tarefa 14** — Vitest primeiro: `ehAbaDaEsquerda`, `urlDoEstado` e
  `resumoDoQueAconteceu({ entrega, respondeuEm, genteFalouEm })` — "Não saiu" vem de
  `entrega === 'failed'`, não das duas colunas de depois.
- **Tarefa 15** — a aba, em largura cheia (a coluna esquerda de `tela-conversas.tsx:328` é
  renderizada sempre que não é `telaCheia`, então a condição muda, não a classe). Aba
  **sem contagem**: um número diria "trabalho parado", e o feed não é fila.
- **Tarefa 16** — a porta em Ajustes → Atendimento.
- **Tarefa 17** — suíte inteira, CHANGELOG com os desvios e as pendências, commit.

---

## Arquivos tocados

**Novos:** `supabase/migrations/20261002170000_a_distribuicao_automatica_sai.sql` ·
`20261002180000_a_fila_de_quem_respondeu_e_de_todos.sql` ·
`20261002190000_o_que_saiu_sozinho.sql` · `supabase/tests/89_a_distribuicao_sai.sql` ·
`90_a_fila_e_de_quem_abrir.sql` · `91_o_que_saiu_sozinho.sql` ·
`apps/web/src/components/conversas/{automaticas.tsx,automaticas-dados.ts,automaticas-formatos.ts,automaticas.test.ts}` ·
`apps/web/src/components/meu-dia/consultas.test.ts`

**Alterados:** `supabase/tests/87_quem_respondeu_no_meu_dia.sql` ·
`packages/schema/src/database.types.ts` (gerado) ·
`apps/web/src/components/meu-dia/{tipos.ts,consultas.ts,item-da-fila.tsx}` ·
`apps/web/src/components/conversas/{tipos.ts,tela-conversas.tsx,mensagem-do-fio.tsx}` ·
`apps/web/src/components/admin/painel-atendimento.tsx` · `docs/CHANGELOG.md`

**Não tocados, de propósito:** `app.wa_introduzir` e as onze recusas dela ·
`app.conversations_a_distribuir` e `app.conversations_setor` (os gatilhos ficam; só a chave
vira) · `supabase/seed.sql` (não tem `app_settings`) · qualquer coisa de opt-out,
supressão, tetos ou RLS.

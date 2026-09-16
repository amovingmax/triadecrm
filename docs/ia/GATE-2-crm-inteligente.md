# GATE 2 — CRM Inteligente, Fase 2 (a IA entra em serviço)

**Branch:** `feat/crm-inteligente` · **Data:** 17/09/2026 · **Estado:** **em produção**, com a ficha ligada

A Fase 1 pôs a mesa. A Fase 2 é a comida: o worker analisa conversa de verdade, a
leitura aparece na tela com a evidência a um clique, e às 18h30 sai o Pulso do dia.

Subiu em 17/09: as três migrações estão aplicadas, o `worker-ai` está de pé no Fly e o
módulo `ficha` foi ligado — as cinco primeiras leituras estão no banco. O `pulso` e os
outros três módulos continuam desligados. O estado real está na seção 5, o que a
produção mostrou de diferente do previsto na 4, e um achado que é maior que esta
entrega na 6.

---

## 1. O que foi feito

### A ficha de cada conversa (`20260917110000`)

As duas pontas da análise são do banco, e o worker só as liga:

- **`app.ia_entrada_da_ficha`** monta o que o prompt lê numa consulta só: a janela de
  mensagens novas (ou a conversa inteira, na primeira análise), quem falou em cada
  uma, a ficha anterior, os compromissos em aberto, etapa, etapas válidas,
  responsável, temperatura e o que o CRM ainda não sabe.
- **`app.ia_gravar_ficha`** grava numa transação só e **confere cada evidência contra
  as mensagens da própria conversa**: sinal, compromisso, cumprimento ou dado
  extraído que aponte para mensagem de outra conversa — ou para um id que nem é id —
  é descartado, e a conta do que caiu volta para quem chamou.

Ela **não move etapa** (`etapaSugerida` é sugestão e nada mais), **não escreve em campo
preenchido por gente**, e só cria sugestão de campo com a bandeira ligada, para campo
vazio, sempre `pendente`. Prazo que não veio escrito como data vira null: prazo
chutado viraria cobrança errada no Pulso.

**A janela é fechada pela última mensagem LIDA, não por `now()`.** Fechar em `now()`
esconderia a mensagem que chegasse enquanto o modelo pensa — ela ficaria antes do
corte e nunca seria analisada. Quem achou isso foi o pgTAP.

No worker, o propósito `analisar_conversa` entrou na fila. **O modelo não vê uuid
nenhum**: recebe `m1`, `m2`, `m3` e cita essas etiquetas. Etiqueta inventada morre no
worker; o que passa ainda é conferido no banco.

### A leitura da IA na tela de Conversas

Uma faixa entre os dados do parceiro e a primeira mensagem. Fechada, 40 px: score,
faixa da rubrica, resumo e alertas. Aberta: o motivo, os sinais **na ordem do
argumento** (contra antes de a favor, forte antes de fraco), a próxima ação sugerida,
o que foi prometido (com "venceu" quando o prazo passou) e o rodapé com a versão do
prompt e o 👍/👎.

Três decisões, e as três são decisão:

1. **Sem cor.** A escala térmica é a única cromia do produto e pertence ao banco.
   Pintar o score da IA com ela diria que ele é temperatura, e não é.
2. **Uma linha, até alguém pedir mais.** O painel já tinha perdido 200 px de cabeçalho
   para a conversa caber; um cartão de IA com seis campos devolveria o problema.
3. **Todo sinal aponta para a mensagem que o prova.** Clicar rola até ela e a pisca.

A tela **não corrige a ficha**: discordar é feedback (`feedback_da_ia`), que calibra a
versão seguinte. Corrigir texto de IA à mão criaria um dado sem dono.

### O Pulso do dia (`20260917120000`)

Às 18h30 (America/Fortaleza, segunda a sexta) o cron enfileira o resumo do dia.

**A IA escreve o texto; ela nunca faz a conta.** `app.ia_pulso_entrada` apura tudo em
SQL — conversas ativas, mensagens de cada lado, quem está há três dias sem resposta,
janelas fechando, compromissos vencidos, reuniões marcadas, contatos novos — e a
**ordem** das conversas também é do banco: compromisso que nós vencemos, janela
fechando, pediu proposta, risco, score. O modelo lê números prontos e uma lista já
ordenada.

Ele vê `lead-a46814`, nunca o nome do parceiro. O mapa de volta fica no worker:
prioridade que cita lead fora da lista não vira linha na tela. Regerar cria **versão
nova** em vez de sobrescrever.

**No Meu dia**, o Pulso entra entre o resumo de números e a fila — ele é o contexto da
fila, e contexto vem antes da lista. A tela mostra o mais recente e **diz de quando
é**: ele sai às 18h30 e quem abre de manhã lê o de ontem; passando de dois dias, ela
avisa que aquele foi "o último que saiu".

### A decisão do GATE 1, implementada

`escala: 'conversa'` no contrato do prompt e caminho aninhado em `camposDoTriade`.
De 31 de 31 conversas barradas pelo guardrail de PII para 0 de 31, ao preço de uma
única grafia de telefone (com palavra entre os dígitos), que é a mesma que a regra da
Anatel também não mascara. A lista está fixada em `evals/conversa-inteira.eval.test.ts`.

---

## 2. Arquivos

**Novos**
- `supabase/migrations/20260917110000_quem_monta_a_entrada_e_quem_grava_a_ficha.sql`
- `supabase/migrations/20260917120000_o_pulso_do_dia.sql`
- `supabase/tests/49_a_ficha_gravada.sql` (28 asserções) · `50_o_pulso_do_dia.sql` (16)
- `packages/prompts/src/prompts/pulso-do-dia/v1.ts` · `evals/conversa-inteira.eval.test.ts`
- `apps/web/src/components/conversas/leitura-da-ia.tsx` · `leitura-da-ia-formatos.ts` ·
  `leitura-da-ia-dados.ts` · `leitura-da-ia.test.ts`
- `apps/web/src/components/meu-dia/pulso-do-dia.tsx` · `pulso-formatos.ts` ·
  `pulso-dados.ts` · `pulso.test.ts`
- `infra/nuvem/fly.worker-ai.toml`

**Alterados**
- `apps/workers/src/ia/tarefas.ts` (dois propósitos novos), `banco.ts`, `duble.ts`
- `packages/prompts/src/nucleo/` — `auditoria-pii.ts` (varredura da conversa),
  `chamada.ts` (escala e caminho aninhado), `versionamento.ts` (campo `escala`)
- `apps/web/src/components/conversas/conversa.tsx`, `linha-do-tempo.tsx` (âncora da
  evidência), `apps/web/src/components/meu-dia/tela-meu-dia.tsx`

---

## 3. Como testar

```bash
supabase test db            # 50 arquivos, 2690 asserções
pnpm -r test                # prompts 276 · schema 105 · workers 347 · web 726
pnpm -r typecheck && pnpm -r lint
```

Ponta a ponta, sem gastar dinheiro com o modelo (dublê local, SDK real):

```bash
# terminal 1
node --import tsx apps/workers/src/ia/duble-servidor.ts 8787
# terminal 2 — liga o módulo, enfileira e roda uma volta
psql "$DB_URL" -c "update app_settings set value = jsonb_set(value,'{modulos,ficha}','true') where key='ia.crm_inteligente'"
psql "$DB_URL" -c "select app.ia_enfileirar_analises(5)"
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=sk-ant-duble \
  node --import tsx apps/workers/src/index.ts ai --uma-vez
```

---

## 4. O que isto custa — medido, não estimado

A primeira chamada real mostrou que a projeção dos evals **subestima em 2,6×**, por
duas razões que só a fatura mostra:

1. **O esquema da saída conta como entrada.** `output_config.format.schema` vai no
   pedido: os 28 valores de intenção, os 19 tipos de sinal e o resto da forma somam
   ~2.200 tokens. Entrada real de uma ficha: **3.053** tokens, contra 870 de projeção.
2. **O cache não entra.** O bloco de sistema tem 739 tokens, abaixo do mínimo
   cacheável do Haiku: `cache_control` é aceito e ignorado. Duas chamadas seguidas
   (`ai_runs` 157 e 158) vieram com escrita e leitura de cache zeradas.

| | projeção do eval | medido na fatura |
| --- | --- | --- |
| `ficha-da-conversa@v1` | US$ 0,00215 | **US$ 0,0044 – 0,0056** |
| `classificar-intencao@v1` | US$ 0,00129 | **US$ 0,0028** |
| `resumo-ligacao@v1` | US$ 0,00252 | **US$ 0,0070** |

**Primeiro dia em produção: 20 chamadas, US$ 0,076** — incluindo a fila que estava
represada desde antes (8 classificações, 1 resumo, 1 follow-up) e as 6 primeiras
fichas. No cenário do MVP (60 análises/dia) isso projeta **≈ US$ 12/mês**, ainda
dentro do orçamento de US$ 25, com o alerta de 80% em `ai_budget_alerts`.

**O que a API recusou pelo caminho:** a saída estruturada não aceita `minimum`,
`maximum` em `integer` nem `maxItems` em `array`. O esquema enviado passou a ser só
a FORMA; as faixas continuam valendo na volta, pelo zod.

## 5. O estado real, depois de subir

**Feito e verificado em produção (17/09):**

| | |
| --- | --- |
| As três migrações | aplicadas; as cinco tabelas respondendo |
| `worker-ai` no Fly | `triade-worker-ai`, região `gru`, máquina de pé + standby |
| Segredos no Fly | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` |
| Deploy do web | `READY`, produção |
| Módulo `ficha` | **ligado** |
| Módulo `pulso` e os outros três | desligados |
| Primeiras fichas | 5 escritas, leitura correta (inclusive `QUEM_E_VOCE` para uma mensagem automática da Meta e `FORA_ESCOPO` para quem perguntou de ingresso de samba) |

## 6. ⚠️ O cron de produção não está rodando — e isso é maior que esta entrega

Ao ligar a ficha, as seis conversas ficaram marcadas como pendentes e **nada foi
enfileirado**. A causa não é da Fase 2:

```
execuções de cron nas últimas 24 h: 1
```

A única que rodou foi a diária (`recompute_temperatures`, 06:00 UTC). **Nenhum job
abaixo de diário jamais aparece em `cron.job_run_details`:**

| agendamento | job | última execução |
| --- | --- | --- |
| `*/5` | `komune_push` | nunca |
| `*/5` | `ia_enfileirar_analises` | nunca |
| `*/10` | `wa_confirmacoes_reenfileirar` | nunca |
| `*/10` | `expirar_reservas_de_ligacao` | nunca |
| `*/15` | `cadencias_agendar` | nunca |
| `*/15` | `dlq_drenar` | nunca |
| `7 * * * *` | `wa_expirar_fila` | nunca |

Provado com um job de teste: `cron.schedule('teste', '* * * * *', 'select 1')`
não executou em 200 segundos. O processo `pg_cron launcher` está vivo (12 dias) e
parado em `wait_event = Extension`.

**O que isso significa hoje:** a reconfirmação de mensagem no WhatsApp, o dreno da
dead-letter, o agendamento de cadências, a expiração de reservas de ligação e o
push do pré-cadastro para o app **não estão acontecendo sozinhos** — e não é de hoje.

**O que eu faria, nesta ordem:**
1. Reiniciar a instância do Postgres pelo painel do Supabase (Settings → General →
   Restart project). Launcher do `pg_cron` travado costuma voltar com isso, e é o
   teste mais barato.
2. Se voltar, conferir em 10 minutos: `select count(*) from cron.job_run_details
   where start_time > now() - interval '10 minutes'` tem de ser maior que zero.
3. Se não voltar, é chamado para o suporte do Supabase — nenhum código nosso muda
   esse comportamento.
4. **Plano B, se o cron não voltar:** o `worker-ai` passa a enfileirar as análises
   ele mesmo a cada volta do laço (ele já fica de pé o dia inteiro). São ~15 linhas
   e uma porta pública nova; digo isso como alternativa, não como conserto do
   problema — os outros cinco jobs continuariam parados.

**Enquanto isso**, enfileirei as seis análises à mão
(`select app.ia_enfileirar_analises(20)`) e as fichas estão lá.

## 7. O que ainda falta

1. **`GROQ_API_KEY`** — o console do Groq estava com erro de cadastro. Sem ela, áudio
   recebido não vira transcrição (o worker avisa no log e segue). Quando sair:
   `fly secrets set GROQ_API_KEY=... --app triade-worker-ai` e pronto, sem deploy.
2. **Ligar o `pulso`** quando quiser o digest das 18h30 — depende do cron voltar.
3. **Olhar as fichas na tela** (`/conversas`) e me dizer se a leitura está boa: é o
   👍/👎 delas que calibra a versão seguinte.
4. No cabeçalho do aplicativo há 4 px de transbordo horizontal em 390 px (o bloco do
   avatar). Anterior a esta entrega.

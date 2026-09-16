# GATE 2 — CRM Inteligente, Fase 2 (a IA entra em serviço)

**Branch:** `feat/crm-inteligente` · **Data:** 17/09/2026 · **Estado:** construída, testada, **fora de produção**

A Fase 1 pôs a mesa. A Fase 2 é a comida: o worker analisa conversa de verdade, a
leitura aparece na tela com a evidência a um clique, e às 18h30 sai o Pulso do dia.

Nada disso está ligado. Os módulos nascem desligados em `app_settings.ia.crm_inteligente`,
e as migrações ainda não foram para produção — o que falta está na seção 5.

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

## 4. O que isto custa

| | modelo | por chamada | quando roda |
| --- | --- | --- | --- |
| `ficha-da-conversa@v1` | Haiku 4.5 | US$ 0,00215 | por janela de conversa (debounce de 10 min) |
| `pulso-do-dia@v1` | Sonnet 5 | US$ 0,00506 | uma vez por dia útil |
| transcrição (Groq) | whisper-large-v3-turbo | ≈ US$ 0,04/mês | por áudio recebido |

No cenário do MVP (30 conversas ativas/dia), **≈ US$ 8/mês**. O alerta de 80% do
orçamento continua em `ai_budget_alerts`.

---

## 5. O que falta, e o que é seu

1. **Aplicar as três migrações em produção.** Elas são aditivas e tudo nasce
   desligado: `supabase db push --linked`. (Tentei; a política desta sessão bloqueia
   deploy em produção, e é sua a decisão de quando.)
2. **`ANTHROPIC_API_KEY`** no `.env` e como segredo do Fly. Sem ela o `worker-ai` não
   sobe — e é ela que falta para medir o custo real de uma chamada.
3. **`GROQ_API_KEY`** para a transcrição (sem ela o áudio não vira texto e o log
   avisa; o worker continua de pé).
4. **Subir o `worker-ai`**: `fly deploy . --config infra/nuvem/fly.worker-ai.toml --dockerfile apps/workers/Dockerfile`.
5. **Ligar os módulos**, um de cada vez, quando quiser ver funcionando:
   `update app_settings set value = jsonb_set(value,'{modulos,ficha}','true') where key='ia.crm_inteligente'`.
   Recomendo ligar `ficha` primeiro, olhar as primeiras dez fichas e o custo em
   `ai_runs`, e só então ligar `pulso`.
6. **Deploy do web** (`vercel deploy --prod`), que é o que leva a leitura da IA e o
   Pulso para a tela de vocês.

**Nota fora de escopo:** no cabeçalho do aplicativo há 4 px de transbordo horizontal
em 390 px (o bloco do avatar). É anterior a esta entrega e vale um conserto à parte.

⛔ **Fase 2 entregue. Aguardando os passos acima, que dependem de você.**

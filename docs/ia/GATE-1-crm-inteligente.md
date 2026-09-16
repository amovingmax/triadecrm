# GATE 1 — CRM Inteligente, Fase 1 (fundação)

**Branch:** `feat/crm-inteligente` · **Data:** 17/09/2026 · **Estado:** construída, testada, com a decisão do guardrail tomada e implementada

A Fase 1 é o alicerce: tabelas, fila, prompts e transcrição. Nada dela fala com parceiro,
move etapa ou escreve em campo preenchido por gente. A ficha ainda **não roda sozinha** —
ligar o worker é Fase 2.

---

## 1. O que foi feito

### A migração `20260917100000_a_ficha_da_conversa.sql` (aditiva e reversível)

| Tabela | O que guarda |
| --- | --- |
| `ficha_da_conversa` | o dossiê de uma conversa: resumo, score, sinais, objeções, próxima ação, confiança |
| `compromissos_da_conversa` | o que foi prometido, por quem, com prazo e a mensagem que prova |
| `pulso_do_dia` | o resumo diário (um por dia e escopo; regerar cria versão nova) |
| `sugestoes_de_campo` | o que a IA propõe preencher, para uma pessoa aceitar ou recusar |
| `feedback_da_ia` | 👍/👎 e correção — é o que calibra a versão seguinte |

As cinco nascem com RLS, e a visibilidade é **a mesma da conversa**: quem enxerga a
conversa enxerga a ficha; embaixador fora da carteira não enxerga nenhuma das duas.
Nenhuma tem policy de UPDATE para gente — quem escreve é o worker.

Mais: o **debounce** (a conversa fica pendente quando chega mensagem; amadurece com 10 min
de silêncio, ou no teto de 30 min em conversa contínua), os propósitos `analisar_conversa`
e `pulso_do_dia` na fila e em `ai_runs`, e a bandeira por módulo em
`app_settings.ia.crm_inteligente` — ligar e desligar é `update`, não deploy.

**Temperatura continua sendo uma só**, a do banco (`app.compute_temperature`). O teste
prova que não existe tabela paralela de temperatura.

### Os dois prompts (`packages/prompts`)

- **`ficha-da-conversa@v1`** (Haiku 4.5) — lê a conversa e devolve o dossiê. Usa as 25
  intenções do R08 mais três que faltavam (`PEDIU_PROPOSTA`, `PRONTO_PARA_FECHAR`,
  `RECLAMACAO`). Todo sinal e todo compromisso cita o `messageId` que o prova; sem
  evidência, o item não existe. Custo medido por chamada: **US$ 0,00215** sem cache,
  US$ 0,00148 com.
- **`pulso-do-dia@v1`** (Sonnet 5) — lê o dia inteiro e escreve o texto. Os números vêm
  apurados do Postgres: o modelo **não soma, não conta e não estima**. Custo por chamada:
  **US$ 0,00506** sem cache, US$ 0,00403 com — e ele roda uma vez por dia.

### A transcrição de áudio (`apps/workers/src/ia/asr.ts`)

O buraco que existia: a API do Claude não transcreve áudio, e o `faster-whisper` da
máquina dedicada ainda não existe — então mensagem de áudio chegava e a IA ficava sem
metade da conversa. Agora o ASR é o Groq Whisper `large-v3-turbo` (≈ US$ 0,04/mês no
cenário do MVP), com confiança derivada do `avg_logprob` ponderado pela duração. Sem
`GROQ_API_KEY` o erro é determinístico — configuração faltando não faz a fila girar até a
dead-letter. Áudio mudo ou acima do teto (10 min) não vira chamada paga. O áudio nunca
vira token do Claude: o que chega ao modelo é a transcrição já pseudonimizada.

### O comando de medição

`workers ai --chamada-de-teste` faz **uma** chamada pelo caminho real (pseudonimização,
auditoria, validação da saída e linha em `ai_runs`), com a conversa de exemplo do próprio
prompt, e imprime tokens e custo. Rodar duas vezes mede o cache.

---

## 2. A decisão que era necessária — tomada e implementada

**O guardrail de PII impedia a ficha de existir.** Não era bug: era calibragem feita para
outra escala. Os quatro prompts antigos leem *uma* coisa por chamada; a ficha lê a conversa
inteira, e conversa de fornecedor é data, horário, preço e quantidade — colados pela
junção, viram telefone. Medido no corpus de 40 mensagens reais deste repositório,
**nenhuma com telefone**, depois de a regra pseudonimizar:

| | varredura de mensagem | com fronteira de letra |
| --- | --- | --- |
| mensagens barradas sozinhas (40) | 5 | **0** |
| conversas de 5 mensagens barradas (36) | 35 | **0** |
| conversas de 10 mensagens barradas (31) | 31 | **0** |

**Decidido em 17/09/2026 (Rafael): opção B + C.**

- **B — a escala entrou no contrato do prompt.** `escala: 'conversa'` faz a auditoria dos
  trechos de fora usar a varredura com a fronteira de letra (atravessa pontuação, espaço,
  hífen, barra e emoji; não atravessa palavra). Omitir `escala` é ser auditado como
  mensagem: quem não declarar nada continua na varredura estrita, e os quatro prompts
  antigos não mudaram uma linha.
- **C — `camposDoTriade` passou a aceitar caminho aninhado.** `mensagens[].quando`,
  `mensagens[].de`, `mensagens[].messageId` e os campos apurados de `conversas[]` são
  metadado nosso: entram na auditoria campo a campo, mas não na junção. Caminho só é
  aceito quando a raiz é texto de fora — o contrário significa que a raiz inteira devia
  estar declarada, e `prepararChamada` recusa.

**O que isso custa, em lista literal** (`evals/conversa-inteira.eval.test.ts`): de oito
grafias de telefone de verdade, a varredura da conversa deixa de pegar **uma** — telefone
com palavra entre os grupos de dígitos, `é 84 depois 9 9988 depois 0011`. E é a mesma
única que a regra (Anatel) também não mascara: para ela chegar ao modelo, as duas camadas
precisam falhar, e as duas só falham nesse caso. Se essa lista crescer, o teste fica
vermelho e a mudança aparece no diff.

A regra de pseudonimização **não mudou em nada** — ela continua mascarando telefone,
e-mail e @ em qualquer escala.

## 3. Arquivos

**Novos**
- `supabase/migrations/20260917100000_a_ficha_da_conversa.sql`
- `supabase/tests/48_ficha_da_conversa.sql` (23 asserções)
- `packages/prompts/src/prompts/ficha-da-conversa/v1.ts`
- `packages/prompts/src/prompts/pulso-do-dia/v1.ts`
- `packages/prompts/evals/conversa-inteira.eval.test.ts`
- `apps/workers/src/ia/asr.ts` + `asr.test.ts` (6 testes)
- `apps/workers/src/ia/chamada-de-teste.ts`
- `docs/ia/GATE-0-crm-inteligente.md` (auditoria) e este arquivo

**Alterados**
- `packages/prompts/src/catalogo.ts`, `index.ts`, `nucleo/versionamento.ts` (dois propósitos novos)
- `packages/prompts/evals/custos.eval.test.ts`, `versionamento.eval.test.ts`
- `apps/workers/src/ia/tarefas.ts`, `execucao.ts`, `duble.ts`, `workers/ai.ts`, `cli.ts`, `lib/env.ts`
- `.env.example` (`GROQ_API_KEY`)

**Intacto, de propósito:** `nucleo/auditoria-pii.ts`, `nucleo/chamada.ts`,
`nucleo/pseudonimizacao.ts` e toda a integração de WhatsApp.

---

## 4. Como testar

```bash
supabase test db                      # 48 arquivos, 2646 asserções — inclui o 48
pnpm -r test                          # prompts 270 · schema 105 · workers 340 · web 701
pnpm -r typecheck && pnpm -r lint
```

Para ver o debounce funcionando no banco local: mandar uma mensagem de entrada, conferir
`conversations.ia_pendente_desde`, envelhecer a conversa em 15 minutos e chamar
`app.ia_conversas_para_analisar(50)`.

---

## 5. Pendências

1. **`ANTHROPIC_API_KEY` não está no `.env`.** O caminho inteiro já foi provado ponta a
   ponta contra o dublê local (`ai_runs` 71: entrada 131, saída 182, leitura de cache 739,
   custo contabilizado, saída validada pelo schema) — o que falta é a chave para a mesma
   chamada sair para a API de verdade e o preço ser o da fatura, não o da tabela.
2. **A migração `20260917100000` ainda não foi aplicada em produção**, só no banco local.
   Enquanto não for, `--chamada-de-teste` apontado para produção falha no
   `ai_runs_purpose_check` — que é o comportamento certo.
3. **`GROQ_API_KEY`** para a transcrição (e a avaliação de LGPD de mandar áudio para o
   Groq — está em `docs/ia/GATE-0`, decisão 4).
4. **`worker-ai` no Fly.io**, ao lado do `worker-wa`. Item 5 do plano da Fase 1; faz mais
   sentido depois da decisão, junto com a Fase 2.
5. Os textos do Pulso são da Bárbara revisar quando o primeiro sair de verdade.

⛔ **Parado no GATE 1, aguardando "aprovado".**

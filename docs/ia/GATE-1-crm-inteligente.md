# GATE 1 — CRM Inteligente, Fase 1 (fundação)

**Branch:** `feat/crm-inteligente` · **Data:** 17/09/2026 · **Estado:** construída, testada, **parada aguardando decisão**

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

## 2. A decisão que falta (é o que trava a Fase 2)

**O guardrail de PII, como está hoje, impede a ficha de existir.** Não é bug: é uma
calibragem feita para outra escala.

Os quatro prompts antigos leem **uma** coisa por chamada. A auditoria de PII
(`nucleo/auditoria-pii.ts`) roda sobre os trechos de fora **colados sem fronteira nenhuma
— nem de letra** e acusa qualquer corrida de 10 a 13 dígitos que comece por DDD válido.
Nessa escala o falso positivo é barato.

A ficha lê a **conversa inteira**. E conversa de fornecedor é feita de data, horário, preço
e quantidade. Medido no corpus de 40 mensagens reais deste repositório, **nenhuma com
telefone**:

| | hoje | com fronteira de letra |
| --- | --- | --- |
| mensagens barradas sozinhas (40) | 5 | **0** |
| conversas de 5 mensagens barradas (36) | 35 | **0** |
| conversas de 10 mensagens barradas (31) | 31 | **0** |

O exemplo mais típico do prompt já é barrado hoje: `09:40` + `parceiro` + "casamento dia
12/12 para 150", colados, dão dez dígitos que começam por 94 — um DDD do Pará.

**O que a fronteira de letra perde**, medido sobre os 147 casos com 8+ dígitos da própria
suíte de evals, no caminho real (depois da regra pseudonimizar): **um**. Telefone com
palavra entre os grupos de dígitos — `é 84 depois 9 9988 depois 0011`. Telefone com
caractere invisível entre os dígitos (`8​4​9​9​9​8​8​0​0​1​1`) continua sendo pego pelas duas.

### As opções

| | O que muda | O que custa |
| --- | --- | --- |
| **A. Nada** | guardrail intacto | a ficha não existe; a Fase 2 não tem o que ligar |
| **B. Fronteira de letra na conversa** (recomendada) | prompt que lê conversa passa a ser auditado com a varredura que atravessa pontuação, espaço e emoji, mas **não** atravessa palavra — a mesma que já roda hoje sobre a montagem | perde o telefone escrito com palavra no meio, **se** a regra também tiver falhado. A regra (Anatel, precisa) continua mascarando todo telefone de forma normal |
| **C. Só corrigir o metadado** | `quando`/`de`/`messageId` passam a contar como campo nosso, não texto de fora | correto, mas **não resolve**: medido, 33 de 36 conversas continuam barradas |
| **D. Tirar a junção de lista** | mensagens deixam de ser coladas umas nas outras | telefone repartido entre duas mensagens passa, e ainda restam ~85% barradas por mensagem isolada |

**Recomendo B, com C junto** — B resolve, C deixa a classificação honesta. O que **não**
recomendo é mexer nisso sem decisão registrada: por isso o guardrail está intacto neste
commit, e há um eval (`evals/conversa-inteira.eval.test.ts`) que **fixa o número de hoje**.
Se alguém afrouxar a auditoria sem decidir, aquele teste fica vermelho.

> **Pergunta objetiva:** aprova a opção B (+C)? Se sim, ela entra num commit só, com o
> eval mudando junto e a lista literal do que a fronteira de letra deixa de pegar.

---

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

1. **A decisão do item 2.** Sem ela a Fase 2 não começa.
2. **`ANTHROPIC_API_KEY` não está no `.env`.** O custo por chamada acima é da tabela de
   preços da API aplicada aos tokens medidos do nosso prompt; a chamada real de medição
   (`workers ai --chamada-de-teste`) precisa da chave e da decisão do item 2 — hoje ela
   para no guardrail, que é exatamente o que este relatório mede.
3. **`GROQ_API_KEY`** para a transcrição (e a avaliação de LGPD de mandar áudio para o
   Groq — está em `docs/ia/GATE-0`, decisão 4).
4. **`worker-ai` no Fly.io**, ao lado do `worker-wa`. Item 5 do plano da Fase 1; faz mais
   sentido depois da decisão, junto com a Fase 2.
5. Os textos do Pulso são da Bárbara revisar quando o primeiro sair de verdade.

⛔ **Parado no GATE 1, aguardando "aprovado".**

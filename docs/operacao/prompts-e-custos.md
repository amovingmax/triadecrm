# Prompts e custos de IA — Tríade

> Versão 1.0 — 05/09/2026. Dono: `packages/prompts`.
> Referências: PRD §9.1 (ADR-09, ADR-10), §10 (custos e privacidade), RF-CON-19 a RF-CON-28;
> anexos R08 (playbook conversacional), R13 (prospecção ativa por ligação), R06 (LGPD).

Este documento responde a três perguntas: **o que cada prompt custa por chamada**, **quanto
a operação gasta por mês** e **onde o alerta dispara**. Todos os números saem do código —
`packages/prompts/src/nucleo/custos.ts` faz a conta e `packages/prompts/evals/custos.eval.test.ts`
a trava. Se um prompt engordar, o teste quebra antes de este documento ficar mentiroso.

---

## 1. Os quatro prompts, e por que nesta ordem

A ordem é a do R13: com o primeiro contato virando **ligação**, o que a IA precisa fazer
primeiro deixou de ser "redigir mensagem fria".

| # | Prompt | Modelo (ADR-10) | `ai_runs.purpose` | Para quê |
|---|---|---|---|---|
| 1 | `transcricao-audio@v1` | Claude Haiku 4.5 | `transcribe_audio` | Limpa a transcrição do áudio que o fornecedor manda — ele manda áudio mesmo quando a gente escreve. A transcrição em si é do faster-whisper local (RF-CON-27); o áudio não vira token. |
| 2 | `resumo-ligacao@v1` | Claude Sonnet 5 | `summarize_call` | Resume a ligação a partir do caminho percorrido no roteiro, das capturas e da anotação de quem ligou. Sem gravação. |
| 3 | `followup-ligacao@v1` | Claude Sonnet 5 | `draft_followup` | Redige o rascunho do WhatsApp que vai depois da ligação. Sempre rascunho: a pessoa aprova (ADR-05). |
| 4 | `classificar-intencao@v1` | Claude Haiku 4.5 | `classify_inbound` | Classifica a mensagem recebida em uma das 25 intenções do R08, com confiança e entidades. |

Cada versão é um objeto congelado com id, versão, modelo alvo, schema de entrada (zod),
schema de saída (zod) e o texto. Publicar uma v2 é acrescentar um arquivo ao lado do v1:
`obterPrompt('resumo-ligacao', 1)` continua devolvendo o v1, com os schemas do v1.
`ai_runs.prompt_version` grava `id@vN`.

---

## 2. Custo por chamada

Preços da API da Anthropic (primeira parte), em **US$ por milhão de tokens**, conferidos em
05/09/2026:

| Modelo | Entrada | Saída | Escrita de cache (5 min) | Leitura de cache |
|---|---|---|---|---|
| Claude Haiku 4.5 | 1,00 | 5,00 | 1,25 | 0,10 |
| Claude Sonnet 5 | 2,00 | 10,00 | 2,50 | 0,20 |

A **Batch API custa metade** dos dois lados. Ela não entra na conta abaixo: nenhum destes
quatro prompts é assíncrono — resumo e follow-up acontecem enquanto a pessoa ainda está na
tela, e classificação de mensagem recebida tem SLA de 15 minutos (RF-CON-04). O Batch vale
para a extração em lote do Radar, que é outro caminho.

Contagem de tokens: **estimativa** (`estimarTokens`, ~3,6 caracteres por token em pt-BR),
medida sobre o bloco de sistema real de cada versão e sobre o primeiro exemplo de cada uma.
A contagem verdadeira vem do `usage` da resposta e é ela que vai para `ai_runs`.

| Prompt | Modelo | Sistema (tokens) | Mensagem | Saída | **US$/chamada sem cache** | **com cache quente** |
|---|---|---:|---:|---:|---:|---:|
| `transcricao-audio@v1` | Haiku 4.5 | 446 | 79 | 91 | **0,00098** | 0,00058 |
| `resumo-ligacao@v1` | Sonnet 5 | 486 | 268 | 101 | **0,00252** | 0,00164 |
| `followup-ligacao@v1` | Sonnet 5 | 1.154 | 90 | 119 | **0,00368** | 0,00160 |
| `classificar-intencao@v1` | Haiku 4.5 | 966 | 49 | 55 | **0,00129** | 0,00042 |

O bloco de sistema é a parte estável (persona, regras, base de conhecimento, taxonomia) e é
onde vai o `cache_control`. O `followup-ligacao` é o mais caro justamente por carregar a base
de conhecimento inteira — e é o único que precisa dela, porque é o único que escreve texto
que uma pessoa vai ler.

**Aviso sobre a coluna "com cache quente": ela quase não se realiza no nosso volume.** O
cache de 5 minutos só rende quando a chamada seguinte usa o mesmo prefixo dentro da janela.
Com 21 ligações atendidas por dia espalhadas ao longo do expediente, o normal é errar o
cache. Planeje pela coluna **sem cache**; trate o cache como desconto eventual, não como
premissa. (Duas pessoas ligando em bloco, uma atrás da outra, mudam isso — e é o único
cenário em que vale medir de novo.)

---

## 3. Quanto a operação gasta por mês

Premissas (em `VOLUME_MENSAL`, no código): **21 dias úteis**, **60 ligações/dia** entre as duas
pessoas, **35% de atendimento** (21 atendidas/dia), **12 áudios recebidos/dia** e **40 mensagens
recebidas/dia** passando pelo classificador.

| Prompt | Chamadas/mês | US$/chamada | **US$/mês sem cache** | US$/mês com cache |
|---|---:|---:|---:|---:|
| `transcricao-audio@v1` | 252 | 0,00098 | **0,25** | 0,15 |
| `resumo-ligacao@v1` | 441 | 0,00252 | **1,11** | 0,72 |
| `followup-ligacao@v1` | 441 | 0,00368 | **1,62** | 0,71 |
| `classificar-intencao@v1` | 840 | 0,00129 | **1,08** | 0,35 |
| **Total** | **1.974** | — | **≈ US$ 4,07/mês** | ≈ US$ 1,93/mês |

Vale dizer o que este número significa: **a IA não é o custo desta operação.** Quatro dólares
por mês é menos que um dia de anúncio. O que custa aqui é o tempo das duas pessoas e a
telefonia (R13 §3.4, ainda sem fornecedor). Consequência prática para quem decide: escolher
o modelo mais barato para economizar em cima de US$ 4 é economia falsa; o critério de escolha
de modelo é qualidade da saída, e o ADR-10 já o fixou.

Onde este número mudaria de ordem de grandeza:

- **Volume por 10** (uma equipe, não duas pessoas) → ≈ US$ 40/mês. Continua pequeno.
- **Resumo com a transcrição inteira da ligação** em vez do caminho do roteiro: uma ligação
  de 4 minutos transcrita são ~600 tokens em vez de 268 — dobra o `resumo-ligacao`. É a razão
  técnica para o resumo ler o caminho, e não a gravação.
- **Modo automático (RF-CON-09) ligado**, com rascunho para cada mensagem recebida em vez de
  só depois de ligação: multiplica `followup` pelo número de mensagens, não de ligações.

---

## 4. Onde fica o alerta de 80%

- **Orçamento mensal só de IA: US$ 25.** É a fatia de IA do teto de US$ 320/mês de infra +
  APIs do PRD §10. O valor nasce medido — seis vezes o gasto nominal — para caber o volume
  triplicar e os prompts engordarem sem que o alerta vire ruído. **Pendente de confirmação de
  Rafael e Dennis:** é dinheiro, e dinheiro não se define em código.
- **Alerta em US$ 20** (80% do orçamento), como manda o PRD §10.
- **Segundo alerta, e é o que chega a tempo: o ritmo.** Num orçamento pequeno, quando o
  acumulado bate 80% o mês já acabou. `avaliarOrcamento(gasto, diasUteisDecorridos)` projeta o
  fechamento pelo ritmo até aqui e devolve `ok`, `ritmo_acima` ou `passou_de_80`. Cinco dias
  úteis com US$ 9 gastos ainda não passou de 20 — mas fecha o mês em US$ 37,80, e isso aparece
  no quinto dia, não no vigésimo.

Como medir: toda chamada grava em `ai_runs` (`purpose`, `model`, `prompt_version`,
`tokens_in`, `tokens_cached`, `tokens_out`, `cost_usd`, `latency_ms`). O agrupamento por
`purpose` e dia já tem índice (`ai_runs_purpose_day_idx`). A tabela `ai_runs` ainda **não
existe nas migrações** — está no R05 §DDL e é dono de outro agente; enquanto não existir,
os números acima são projeção, não medição.

---

## 5. Os dois guardrails, e o que eles custam

### Pseudonimização (ADR-09, R06 IA-06) — custo: zero token

Nenhum prompt recebe telefone. `prepararChamada` é o único caminho entre um prompt e a API:
valida a entrada, troca nome, empresa, telefone, e-mail e @instagram por marcadores
`[[NOME_1]]`, `[[TELEFONE_1]]`, monta a mensagem e **confere a mensagem já montada** — se
sobrou PII, a chamada não sai (`PiiNaChamadaError`). O mapa volta junto e reidrata o texto
antes de uma pessoa ler.

Dois limites conhecidos, ambos no eval: número ditado por extenso num áudio ("oito quatro
nove nove...") não é dígito e passa; nome de terceiro que o CRM não conhece ("fala com a Ana")
não tem como ser reconhecido sem mandar o texto a um modelo justamente para descobri-lo. O
primeiro é segurado pela regra do RF-CON-27 (áudio recebido vai para humano no MVP).

### Validador de promessas (RF-CON-24) — custo: zero token

Determinístico, roda depois do modelo e antes da pessoa. Recusa percentual, valor em reais ou
prazo que não esteja na base de conhecimento, palavra da lista proibida do R08 §5.4
("garant", "desconto", "exclusiv", "grátis", "promoção"), URL fora de `komune.app`, `claim`
sem fato correspondente e os limites de forma (300 caracteres, 4 linhas, 1 emoji, sem caixa
alta). Pergunta de dinheiro que a FAQ não responde não é bloqueada: é **substituída** por
"Vou confirmar com o financeiro e te respondo hoje", com tarefa humana.

Ser determinístico é escolha, não limitação de orçamento: um segundo modelo julgando o
primeiro dobraria o custo, não seria reproduzível e não daria para testar sem rede. O preço
está medido nos evals: promessa sem número ("a gente dá um jeito no valor pra você") atravessa,
e desconto montado só com percentuais que existem na base ("fica 5% em vez de 8%") atravessa
também. Quem segura os dois é a aprovação humana do ADR-05 — que por isso não é formalidade.

---

## 6. Evals: como se sabe que isto funciona

`pnpm -C packages/prompts test` — 108 testes, sem rede e sem credencial da Anthropic. A saída
do modelo entra como fixture; o que se mede é o código determinístico em volta (pseudonimização,
validador, decisão de intenção, roteamento do áudio, custo) e o contrato de cada versão.

Um caso pode ser marcado como **conhecido**: a resposta certa fica em `esperado`, a que a
versão atual dá fica em `conhecido.obtido`, e o teste afirma as duas. No dia em que alguém
melhorar o prompt, **o caso conhecido fica vermelho** — é o aviso de que virou régua nova e
deve ser promovido. Hoje são 10 casos conhecidos, e cada um tem motivo escrito e uma saída.

O número de casos conhecidos é declarado em cada suíte (`conhecidosEsperados`): acrescentar um
caso errado sem admitir que ele existe quebra a suíte.

---

## 7. Pendências

| # | O quê | De quem |
|---|---|---|
| 1 | Confirmar o orçamento mensal de IA (US$ 25) e o canal do alerta | Rafael, Dennis |
| 2 | `ai_runs` não existe nas migrações; sem ela não há medição, só projeção | dono de `supabase/**` |
| 3 | O léxico de opt-out do RF-CON-19 inclui "não quero" e "não tenho interesse", que o R08 §1 trata como recusa reativável. Hoje quem diz isso é suprimido para sempre | Rafael, Dennis |
| 4 | Os itens `[validar]` da FAQ do R08 §7 (prazo de repasse, cancelamento, nota, CNPJ) não estão na base de conhecimento, e por isso o robô não os responde | Dennis |
| 5 | Biblioteca de áudios: `followup-ligacao` sugere um slug, e a biblioteca do RF-CON-29 ainda não existe | Heloísa |

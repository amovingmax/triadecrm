# Laudo da varredura — TRIADE

**Para:** Matheus (dono do produto)
**Varredura:** 10 lentes independentes, sábado 05/09/2026, entre 18h18 e 19h30 (America/Fortaleza), no banco local compartilhado `supabase_db_komune-crm`.
**Reconferência para este laudo:** 05/09/2026, 19h25 a 19h32. Tudo que este laudo chama de "remedido" foi executado por mim agora, e o comando está escrito ao lado.

Convenção deste texto: **remedido** = eu rodei e vi; **relatado** = veio de uma lente e sobreviveu à verificação cruzada de outro auditor; **não verificado** = ninguém provou, e está dito.

---

## 1. Veredito

**Sim para começar a ligar e trabalhar o funil na segunda-feira; não para ligar o WhatsApp e a IA; e há um defeito que precisa cair antes da primeira reunião com um produtor ou cerimonialista.**

---

## 2. O que funciona

Esta parte importa tanto quanto a dos defeitos: é o que dá para usar amanhã.

### O ciclo de ligar (o coração do MVP) — está de pé

- **A janela de horário é do banco, não da tela.** A lente falsificou o relógio do navegador para terça 08/09 10h, a tela passou do bloqueio e chamou `proximo_da_fila` — e o servidor recusou sozinho: `{"ok": false, "motivo": "fora_da_janela", "detalhe": "depois_do_fechamento"}`. A conta da reabertura pula o domingo 06 **e** o feriado de 07/09 (`app.proxima_abertura('2026-09-05')` → `2026-09-08 09:00-03`).
- **Opt-out na ligação é imediato e não depende de gravar o resultado.** O toque em "Pediu para não ser mais procurado" dispara `marcar_nao_ligar_mais` antes de qualquer tabulação. Deixa `do_not_contact = t`, `suppression_list`, `consent_events(contact_optout)` com a evidência, negócio em `optout`/`lost`, tarefas abertas zeradas.
- **Quem foi suprimido não volta para lote nenhum.** Depois do opt-out, uma montagem de 30 devolveu `"excluidos": {"suprimido": 1, "nao_contatar": 1, ...}` e zero itens em fila para aquele contato.
- **A recusa de tabulação não engole o pedido de opt-out** (o caso mais fácil de errar): tabular sem motivo de perda com `p_pediu_para_nao_ligar=true` devolve `{"tabulado": false, "contato_suprimido": true, "optout_registrado": true}` — e a supressão aconteceu mesmo assim.
- **Os dois eixos do R13 §3.3 são inquebráveis no banco:** desfecho comercial sem atendimento → `sem_atendimento_com_desfecho`; atendeu sem desfecho → `atendeu_sem_desfecho`; e a tela também não oferece o chip impossível.
- **Toque duplo não conta duas vezes:** `iniciar_chamada` duas vezes devolve a mesma chamada e `attempts` continua 1; tabular duas vezes com o mesmo `client_key` devolve `{"repetido": true}` sem criar segunda atividade.

### Funil, temperatura e registro de contato — está de pé

- **Os 8 desfechos que levam a quente funcionam nos dois funis**: 16 execuções de `registrar_contato` (8 desfechos × 2 funis), 16 de 16 saíram de frio para quente.
- **A tela não inventa promoção**: quando a etapa não tem par no funil produtor, o recibo diz "A etapa deste funil não muda por este resultado" em vez de fingir avanço.
- **A regra de temperatura do PRD §5.6 bate nos limites** em 11 combinações de etapa × dias.
- **`move_deal` recusa com nome próprio**, um a um: `campos_obrigatorios` (`meeting_at`, `meeting_format`), `motivo_de_perda_invalido`, `proxima_acao_obrigatoria`.
- **O motivo de perda é exigido pelo gatilho, não só pela tela**: `UPDATE` direto em `public.deals` como papel `sdr` é barrado com "A etapa "Perdido" exige um motivo de perda (RF-FUN-04)".
- **`consent_events` é append-only de verdade**: `DELETE` recusado até com o usuário `postgres`.
- **Opt-out pelo kanban é opt-out completo**: avisa antes, e depois grava etapa, `consent_events`, `do_not_contact` e `suppression_list`.

### Importação e Radar — a esteira acerta o que precisa acertar

- **E.164 a partir de texto sujo**: `"84 98111-2233"`, `"8498111 2244"`, `"+55 84 99645-6054"` e o fixo `"84 3222-1010"` viraram números corretos.
- **Reimportar o mesmo arquivo não duplica nada**: segunda passada deu `entra=0, repetida=7`, e o toast diz "Nada novo entrou" em vez de fingir sucesso.
- **Duplicata é detectada pelas três chaves e com o nome de quem duplica**: "Já existe como Anne Vieira Buffet e Eventos (mesmo telefone)".
- **CPF plantado é apagado antes de gravar**, no nome e na observação, com aviso na prévia. Varredura pós-importação: 0 CPF em `activities`, `organizations.name` e `supplier_candidates`.
- **A supressão segura a reincidência**: um número que entrou como opt-out foi reclassificado como "Não contatar" numa planilha posterior que o trazia como linha normal.
- **`field_provenance` é preenchida** com fonte, URL, coletor e base legal.

### O que roda sozinho — cron e filas

- **Remedido, 19h27:** 13 jobs ativos em `cron.job`, todos `active = t`, com os horários do PRD (`recompute_temperatures 0 6 * * *`, `expirar_reservas_de_ligacao */10`, `cadencias_agendar */15`, `relatorio_semanal 0 11 * * 1`, etc.).
- **Relatado e confirmado:** os 13 foram executados à mão, cada um **duas vezes**, dentro de `begin/rollback`, e nenhum duplicou nada.
- **Remedido, 19h28:** as 13 filas `pgmq` existem e estão todas com profundidade 0.
- **A supressão é reconferida na entrega**, não só na entrada: `app.pode_tocar` começa por `if app.is_suppressed_target(...) then return 'suprimido'` — encerra, não adia.

### Código, testes e build

- **Remedido, 19h29 — `pnpm -r test`: 63 arquivos, 1.067 testes verdes, 1 pulado, 0 falhas** (prompts 255, schema 105+1, workers 231, web 476). O estado declarado dizia "~996"; o número real hoje é maior.
- **Remedido, 19h30 — `pnpm -r typecheck`: verde nos quatro pacotes.** Isso torna **desatualizada** a pendência do `docs/CHANGELOG.md:1189`, que ainda diz que `packages/prompts typecheck` está vermelho. Já foi consertado e o CHANGELOG não foi reconferido.
- **Remedido, 19h25:** 20 telas (`page.tsx`), 5 Edge Functions de produto (`claim-link`, `export-lgpd`, `komune-push`, `komune-webhook`, `wa-webhook`), 31 migrações, 30 arquivos pgTAP somando **2.122 asserções** (soma dos `select plan(n)` — bate com o declarado).
- **Remedido, 19h25:** 100 organizações (1 com `deleted_at`), 65 com telefone. O estado declarado dizia 100/66; a diferença é uma ficha que outra lente suprimiu às 19h00 para testar rotas e deixou de pé ("Ativa Cerimoniais", `suppression_list.reason = 'seed-visitas-dia'`).

---

## 3. O que está quebrado

Em ordem de urgência. Só o que sobreviveu à verificação cruzada.

### 3.1 — A autorização do produtor é exigida, aceita e jogada fora `[alta]`

**O que acontece na prática.** A Heloísa fecha a reunião com uma cerimonialista, colhe o "autorizo", digita a frase literal na tela (que exige o campo e promete que ele vira a prova), e ganha a tarefa "Enviar link de cadastro". Quando ela for cumprir a tarefa, o sistema recusa com `sem_autorizacao` — e não diz que a prova nunca foi guardada. A evidência de LGPD (texto literal, data, canal) sumiu. A única saída é pedir a autorização de novo ao parceiro.

**Remedido agora (19h26), com SQL direto:**

```
Funil                       | Etapa           | required_fields
Captação de fornecedor      | Autorizou       | [{"field":"authorization_evidence", "consent_kind":"data_use_authorized", ...}]
Produtor e cerimonialista   | Parceria aceita | []
```

A evidência só vira `consent_events` quando a etapa de destino declara `consent_kind` em `stages.required_fields`. No funil produtor esse campo é uma lista vazia. Confirmado pela verificação independente: `consent_events` 0, `tem_autorizacao_vigente` = f, e o texto literal não existe em nenhum dos cinco lugares onde se procurou.

**Quem pega.** Metade da base. Produtores, cerimonialistas e assessorias são 30 a 60 alvos pelo Apêndice F do PRD.

**Custo do conserto.** Uma linha de catálogo no `seed.sql` (dar à etapa "Parceria aceita" o mesmo `required_fields` com `consent_kind` que a "Autorizou" já tem) mais um pgTAP que rode a cadeia autorização → pré-cadastro nos **dois** funis. Consta como pendência conhecida no `docs/CHANGELOG.md:369`, aguardando decisão de catálogo — não é ocultação, mas está de pé no produto.

### 3.2 — Duas regras diferentes de piso de recontato; a da fila de ligação apaga a espera `[alta]`

**O que acontece na prática.** Alguém diz "agora não, me procure em 30 dias". Duas semanas depois, qualquer "não atendeu" registrado por qualquer motivo apaga o piso **na fila de ligação** — e a pessoa volta ao lote da Heloísa no dia seguinte. A cadência continua respeitando os 30 dias. Duas superfícies do mesmo produto, duas respostas para a mesma pergunta do RF-FUN-13.

**Remedido agora (19h27), em `begin/rollback`, com um alvo real:**

| Passo | Piso na fila de ligação (`v_contact_cooldown`) | Piso na cadência (`app.pode_tocar`) |
|---|---|---|
| A) só o "agora não" de 30 dias | **2026-10-04** | 2026-10-04 |
| B) depois de um "não atendeu" | **2026-09-06** | 2026-10-04 |

Vinte e oito dias de piso evaporaram de um lado e não do outro.

**Onde estão as duas regras, cada uma com um comentário defendendo o contrário da outra:**
- `supabase/migrations/20260904001700_cadencias_e_precadastro.sql:524` — `max(a.occurred_at + interval days => o.cooldown_days)` sobre **todo** o histórico. Comentário: *"um 'sem interesse' de 90 dias não pode ser apagado por um 'não atendeu' de 1 dia registrado depois."*
- `supabase/migrations/20260904000800_desfechos_de_interacao.sql:296-306` (view `v_contact_cooldown`, usada pela fila de ligação em `20260904001300_modulo_de_ligacao.sql:865`) — `distinct on ... order by occurred_at desc`, só o **último** desfecho. Comentário: *"e não o máximo do histórico. Com max(cooldown_days), um 'wa_agora_nao' de 30 dias continuaria excluindo o alvo mesmo depois de ele responder."*

Os dois raciocínios são defensáveis. O que não é defensável é o produto seguir os dois ao mesmo tempo, em superfícies que a mesma pessoa usa no mesmo dia.

**Custo do conserto.** Uma decisão sua (qual é a regra), depois uma função só, chamada pelos dois lados — provavelmente `max` com a exceção explícita de reabertura por resposta do alvo. Mais um pgTAP que faça exatamente a tabela acima e exija números iguais nas duas colunas. É a peça mais barata de acertar e a mais cara de descobrir tarde, porque falha em silêncio e a favor de ligar demais.

### 3.3 — A IA chama, paga e manda dado de contato suprimido `[alta — só morde quando a IA ligar]`

**O que acontece na prática.** O opt-out cancela tarefas e move negócios, mas não limpa `ai_jobs`. Nenhuma das quatro funções de tarefas do worker de IA pergunta se o alvo está suprimido — a única trava é o `insert` em `message_drafts`, que é o último passo. Resultado verificado: três chamadas pagas de `draft_followup` terminando em dead-letter sem produzir nada, com o dado do contato já suprimido tendo saído para a Anthropic.

**Remedido agora (19h28):** `grep -n "suppress|suprimid|do_not_contact|is_suppressed" apps/workers/src/ia/tarefas.ts` devolve **uma única linha, e é um comentário** (`tarefas.ts:444`: *"A supressão em si (do_not_contact + suppression_list) é do worker de WhatsApp"*). Não há pergunta de supressão em nenhuma das quatro funções.

**Custo do conserto.** Uma pergunta `app.is_suppressed_target` no topo do consumidor da fila, e o cancelamento de `ai_jobs` no mesmo lugar em que o opt-out já cancela `tasks`. Meia hora, mais um teste.

### 3.4 — Telefone ditado por extenso chega inteiro ao modelo `[alta — mesma condição]`

**O que acontece na prática.** Alguém escreve "meu whats é oito quatro nove nove seis quatro cinco seis zero cinco quatro". A pseudonimização não vê número, a auditoria de vazamento não vê número, e o telefone sai cru na mensagem que vai para a Anthropic.

**Remedido agora (19h28)**, chamando `pseudonimizar()` de `packages/prompts/src/nucleo/pseudonimizacao.ts` com um contexto que **já continha o telefone real do contato**:

```
"anota ai: 84 99645-6054"                          => "anota ai: [[TELEFONE_1]]"
"meu whats e oito quatro nove nove seis quatro
 cinco seis zero cinco quatro"                     => (idêntico, sem troca)
"liga pra mim, oito-quatro nove nove seis quatro
 cinco, seis zero cinco quatro"                    => (idêntico, sem troca)
```

O agravante: escapou o telefone que o CRM **já tinha no cadastro**. A passada que substitui valores conhecidos do contato só casa dígitos formatados. O próprio arquivo escreve, na linha 64, que *"Este caminho não pode falhar"* — e ele falha para a forma em que um fornecedor mais naturalmente dita um número em áudio transcrito.

**Custo do conserto.** Um normalizador de numerais por extenso antes das duas passadas (é uma tabela de 10 palavras mais os hífens e as vírgulas), e uma asserção no eval de vazamento com as três frases acima. Uma tarde.

### 3.5 — A confirmação de opt-out é reenfileirada de 10 em 10 minutos, para sempre `[alta — mesma condição]`

**O que acontece na prática.** Quando a confirmação de opt-out não consegue sair (hoje o caso real é "nenhum modelo aprovado na Meta"), o cron cria outra a cada 10 minutos, sem teto e sem backoff. Dez voltas, onze confirmações enfileiradas para a mesma pessoa. No dia em que a Meta aprovar o modelo, a fila descarrega tudo que se acumulou.

**Remedido agora (19h26)**, lendo `pg_get_functiondef('app.wa_confirmacoes_reenfileirar')` direto do banco: o laço seleciona conversas onde **não existe** confirmação viva (`status <> 'failed'`), insere uma mensagem nova e enfileira. Não há leitura de `tentativas_falhas` (que a própria view `wa_confirmacoes_devidas` calcula), não há teto, não há espera crescente. O índice parcial `messages_uma_confirmacao_de_optout` deixa de valer no instante em que a linha vira `failed`, e é isso que abre a porta.

**Custo do conserto.** Ler o `tentativas_falhas` que já está calculado, parar em N e mandar o caso para `acao_humana` em `wa_saude()`. Uma hora.

### 3.6 — O desfazer de 48 h da importação nunca remove ficha nenhuma, e culpa um trabalho humano que não houve `[alta operacional]`

**O que acontece na prática.** A Heloísa importa a planilha com uma coluna errada, aperta "Desfazer este lote", e lê: *"0 fichas removidas. 6 ficaram de pé porque alguém já trabalhou."* Ninguém trabalhou. Quem "tocou" a ficha foi o próprio importador, um instante antes, na mesma transação. Ela não procura o problema certo porque a mensagem manda ela procurar outro.

**Remedido agora (19h28)**, lendo os dois lados:
- `supabase/migrations/20260904001600_esteira_de_ingestao.sql:2068-2077` — só remove organização que não tenha **nenhuma** atividade com `type <> 'system'`.
- `supabase/migrations/20260904001820_importacao_de_planilha.sql:973-993` — o importador insere uma atividade de `type = 'note'` para toda linha que traga `ultimo_contato`.

**Ressalva de precisão** (que a verificação isolou com um controle que o relato original não tinha): o desfazer **funciona** para linhas sem `ultimo_contato`, e vira no-op para as que têm. Como a planilha-ponte pede a coluna "último contato", na prática o desfazer não serve para o caso real. O RF-BAS-17 existe no código e não existe na operação.

**Custo do conserto.** Trocar `a.type <> 'system'` por uma condição que ignore a nota do próprio lote (ela já carrega `metadata->>'batch_id'` e `origin = 'importacao_planilha'`). Uma linha, mais um teste. E reescrever a frase do recibo, que hoje afirma uma causa errada.

### 3.7 — O botão "Desfazer este lote" é oferecido a quem importa, responde 403, e a mensagem esconde o motivo `[alta operacional, mesma família]`

**O que acontece na prática.** Quem importa é a Heloísa, que é `sdr`. `public.esteira_desfazer_lote` exige `app.is_manager()`. O botão não tem trava de papel nenhuma (`apps/web/src/components/importacao/recibo.tsx:104-115`). Ela aperta e lê "O servidor não respondeu como esperado", quando o servidor respondeu exatamente como devia: `{"code":"42501","message":"Papel sdr nao desfaz importacao"}`. Ela não sabe que precisa chamar um gestor; o gestor não sabe que foi chamado.

**Nota do ambiente (remedido, 19h25):** hoje, neste banco, os quatro perfis são `sdr`, e o papel efetivo vem do JWT (`app.role()` lê `auth.jwt()->'app_metadata'->>'app_role'`), não de `profiles.role`. Ninguém desfaz nada neste ambiente. Não sei em que papel a Heloísa entra em produção; se for gestora, o defeito continua valendo para a Bárbara e para qualquer SDR.

**Custo do conserto.** Esconder o botão para quem não é gestor e mostrar "Peça a um gestor para desfazer", mais um caso de 403 no tradutor de erros (`dados.ts:196-206`). Meia hora. Junto com o 3.6, é o que torna o RF-BAS-17 utilizável.

### 3.8 — Chamada aberta há mais de 2 h não pode ser tabulada `[média — rebaixada de alta, ver §4]`

**O que acontece na prática.** Se a tela de chamada ficar aberta mais de duas horas (almoço, aba esquecida, distração na rua), a tabulação é recusada no cliente, antes de qualquer rede, e a mensagem manda "tentar de novo" — o que nunca vai funcionar, porque o cronômetro só cresce. `iniciar_chamada` é idempotente e devolve a mesma chamada com o `iniciada_em` original, então recarregar não salva: o item fica intabulável até a reserva de 30 min expirar, e a tentativa fica gravada com resultado nulo.

**Remedido agora (19h25 e 19h29):**
- `apps/web/src/components/ligacao/tela-chamada.tsx:451` → `duracaoSeg: segundos` (relógio de parede, sem teto).
- `apps/web/src/components/ligacao/tipos.ts:952` → `duracaoSeg: z.number().int().min(0).max(7200)`.
- `supabase/migrations/20260904001300_modulo_de_ligacao.sql:593` → `check (duracao_seg is null or duracao_seg between 0 and 7200)`. O banco também recusaria.

**Custo do conserto.** Uma linha: `Math.min(segundos, 7200)`. E, se quiser mais, um teste na tela de chamada — que hoje não tem nenhum (ver 3.11).

### 3.9 — Os campos obrigatórios de etapa não são do banco `[média]`

**O que acontece na prática.** O RF-FUN-04 promete por escrito que "importações e edições em massa não burlam a regra". Das três regras, só o motivo de perda está no gatilho `app.deals_before_write`. Data/formato de reunião e evidência de autorização vivem **só** dentro da RPC `move_deal`. Um `PATCH` direto no PostgREST põe o cartão em "Reunião marcada" sem data e em "Autorizou" sem evidência.

**Remedido agora (19h29):** `authenticated` tem `UPDATE`, `INSERT`, `DELETE` e `TRUNCATE` em `public.deals`. RLS ainda vale, mas ela diz quem pode escrever, não o que é uma linha válida.

**O que isso custa hoje:** nada, porque ninguém do time faz isso à mão. O que custa amanhã: qualquer script de importação, correção em lote ou tela nova que escreva direto em `deals` — que é o caminho mais natural em PostgREST — cria cartões em "Autorizou" sem prova nenhuma, e o relatório de funil passa a contar etapas que não aconteceram.

**Custo do conserto.** Levar a leitura de `stages.required_fields` para dentro do gatilho, como o `lost_reason_id` já está. Meio dia, e o pgTAP correspondente.

### 3.10 — A tela de montagem de lote mostra um número da base escrito à mão `[média — é mentira na tela]`

**Remedido agora (19h25):** `apps/web/src/components/ligacao/tipos.ts:327` traz `sem_telefone: 'sem telefone (34 dos 100 da base)'` como literal de string. Essa frase é impressa colada a um número que **é** calculado, em dois lugares (prévia e recibo). Quem lê tem todo motivo para achar que o parêntese também foi medido.

O propósito do produto é a base crescer pelo Radar e pela importação. O parêntese vai continuar dizendo "34 de 100" para sempre, e ninguém tem motivo para desconfiar. Hoje, 19h25, o número verdadeiro é **35 de 100** (100 organizações, 65 com telefone) — já está errado.

**Custo do conserto.** Apagar o parêntese, ou calculá-lo. Cinco minutos.

### 3.11 — A tela de ligação não tem teste nenhum, e é onde está o defeito de 3.8 `[média — lacuna]`

`apps/web/src/components/ligacao/` tem 903 linhas em `tela-chamada.tsx`, mais `chamada-tabulacao.tsx`, `chamada-rpc.ts` e o espelho da janela no cliente — e só dois arquivos de teste, ambos sobre a montagem de lote. O defeito de 3.8 mora exatamente nessa costura: o cliente valida uma coisa que o servidor também valida, ninguém compara os dois, e uma suíte verde de 23 testes passa a impressão de que o módulo está coberto.

### 3.12 — Os menores, em uma linha cada

| # | O que acontece | Onde |
|---|---|---|
| a | A prévia da montagem não enxerga a `suppression_list`: promete N e o banco entrega N−1 | `ligacao/consultas.ts:151-176` |
| b | A tarefa diz "Ligar D+1 (última)" já na **primeira** de três tentativas | `seed.sql:1219` × `ligacao/tipos.ts:267` (`MAX_TENTATIVAS = 3`) |
| c | O "Vale até" escolhido na montagem é esticado em silêncio (pede 1 dia, sai com 5, com 25 organizações reservadas nesse prazo) | `public.montar_lote`, `greatest(...)` |
| d | Teto de tentativas estourado é reportado como "fila vazia" — informação diferente e acionável virou genérica | `public.proximo_da_fila` |
| e | Item suprimido no meio da ligação continua contando em "restantes" por até 30 min | `public.tabular_chamada` / `proximo_da_fila` |
| f | DDD que não existe no Brasil (23, 39, 56, 78) vira telefone válido em E.164; só o zero é barrado | `app.normalize_phone_br` |
| g | O recibo da importação manda "Decidir as 3 que ficaram na fila" e só 2 candidatos chegam lá (conta linhas, não candidatos) | `importacao/recibo.tsx:88-95` |
| h | A busca do `robots.txt` não passa pelo freio de intervalo: duas requisições ao mesmo host em ~40 ms | `ingest/guarda.ts:47-52` × `ingest/etapas.ts:346` |
| i | A mensagem de erro da folha de mover mostra "consent_events" para a Heloísa | `stages.required_fields.label` |
| j | Negócio quente que nunca teve contato registrado nunca esfria nem acende alerta, nem parado há 90 dias | `app.compute_temperature` (`last_activity_at is null` → 0 dias) |
| k | O recibo de `/registrar` não pausa a contagem de 5 s enquanto a pessoa digita: tocar em "Anotar" faz o "Desfazer" sumir sem aviso | `registro/tela-registro.tsx` |
| l | Ninguém cria a "tarefa de reengajar" que o PRD §5.6 pede quando um morno passa de 7 dias — `recompute_temperatures` só liga a flag `needs_attention` | não confirmado por busca exaustiva |
| m | Proveniência do Radar sem `lia_version` em 100% das linhas (SCR-08 do R06 em branco) | esteira de ingestão |
| n | `ai_dlq`, `wa_dlq` e `komune_dlq` continuam sem quem as drene (já registrado no `CHANGELOG.md:1146`) | filas |

---

## 4. O que foi alarme falso

Ser honesto aqui é o que dá crédito ao resto.

### 4.1 — "Chamada com mais de 2 h não pode ser tabulada" foi relatada como **alta**; é **média**

O mecanismo reproduz letra por letra e está em 3.8. A **gravidade** não sobreviveu. Para a Heloísa perder uma tabulação, ela precisa ficar mais de duas horas com a tela de uma chamada aberta — sendo que a reserva do item expira em 30 minutos e a janela de ligação da sexta fecha às 20h. O relato tratou como perda garantida de conversa o que é uma esquina estreita, e a correção é uma linha. É defeito real, não é sangramento.

### 4.2 — "O coletor grava nota, avaliações e preço do Casamentos.com.br, quebrando o guardrail do R06" foi relatado como guardrail quebrado em silêncio; é **decisão já tomada e escrita**

O fato técnico reproduz inteiro: `raw_capture` guarda `nota`, `avaliacoes` e `preco`, e existem colunas `source_record.rating / reviews_count / price_from`. Mas a moldura do relato — "escolheu e não avisou", "precisa de decisão, não de conserto silencioso" — é falsa. A verificação achou a decisão documentada em cinco lugares do PRD e já na mesa do Dennis e do Rafael. Não é um guardrail furado por descuido; é uma escolha registrada que **você** ainda pode reverter, e que continua valendo a pena revisar antes de a coleta escalar — mas ela não pertence à lista de defeitos.

### 4.3 — "O desfazer nunca remove nada" precisou de ressalva

Verdadeiro e grave (3.6), com um detalhe que o relato original não tinha: o desfazer funciona quando a linha não traz `ultimo_contato`. A causa não é "o desfazer está quebrado"; é "o importador toca a ficha e o desfazer não sabe reconhecer o próprio toque". Isso muda o conserto.

### 4.4 — Duas coisas que pareciam defeito e são o produto funcionando

- A janela de sábado (10h–13h) impediu de rodar o ciclo de ligar às 18h. Isso é o guardrail, não uma falha — e nenhuma lente o contornou para "conseguir testar".
- Não foi possível apagar `consent_events` de dados de teste pelo caminho normal. Correto: a tabela é append-only por desenho.

---

## 5. O que ninguém conseguiu testar

Esta seção é o mapa do que você ainda não sabe.

| O que ficou sem prova | Por quê | O que falta para conseguir |
|---|---|---|
| **As 2.122 asserções pgTAP** | A extensão `pgtap` não está instalada (remedido, 19h29: 0 linhas em `pg_extension`; está disponível, mas instalar sujaria o `public` de um banco compartilhado e polui o `db lint`) | Rodar `supabase test db --local` num banco só seu. O `CHANGELOG.md:1391` **já declara** que 2 asserções de `09_seguranca_acesso.sql` falham — ou seja, a suíte não está verde e o repositório diz isso. Confirme antes de confiar no número |
| **O celular da Heloísa** | Todas as medições foram a 1440×900 no Chromium | Ninguém mediu alvo de toque, rolagem, nem a tela de chamada em 390 px — que é onde ela realmente trabalha. É o teste mais barato e mais ausente de todos |
| **O WhatsApp de ponta a ponta** | Remedido, 19h27-19h28: **0 conversas, 0 mensagens, 126 modelos cadastrados e 0 aprovados pela Meta**; o worker `wa` nunca bateu heartbeat (só `ai`, `rotas` e `ingest`) | Aprovação de modelo na Meta (é do Luiz e da Bárbara, não do código). Até lá, tudo que se sabe sobre o canal veio de leitura de código e de dublês — inclusive 3.5 |
| **Uma passada única do ciclo de ligar com tela e banco juntos** | Janela fechada no sábado à noite | Repetir na segunda entre 9h e 20h. As duas metades estão provadas separadamente; a costura não |
| **Corrida de duas pessoas** | Ninguém disparou duas montagens simultâneas nem dois arrastes no mesmo cartão | Duas sessões ao mesmo tempo. O mecanismo (índice único parcial, `on conflict do nothing`, `p_expected_stage_id`) foi lido e parece certo — mas "parece certo" não é medição |
| **A expiração real da reserva de 30 min** | Ninguém esperou 30 minutos nem forçou o `pg_cron` | Uma passada com relógio |
| **O arraste com mouse no kanban** | Só o caminho de teclado foi exercitado (chama a mesma `move_deal`) | Se houver defeito só no sensor de ponteiro do dnd-kit, ele passou |
| **O leitor de `.xlsx`** | `docs/planilha-ponte/planilha-ponte-komune.xlsx` só tem cabeçalho e a linha "EXEMPLO"; o teste foi feito com um CSV de 17 colunas montado à mão | Uma planilha real. O Web Worker que lê `.xlsx` está sem prova nenhuma |
| **As fontes v1 do Radar** | Sympla/Outgo, OLX, TeleListas, Instagram e Google Places estão com o coletor desligado no catálogo | Ligar uma é decisão de projeto (RF-RAD-01 exige robots.txt e termos avaliados), não de auditor |
| **O funil 2 (Ativação)** | Depende de eventos da plataforma Komune, que não existem no ambiente local | O lado Komune ligado |
| **A integração com a Komune** | `komune_push` está desligado (`push_desligado` nas duas execuções) | Ambiente com a Edge Function e o webhook de verdade |
| **O intervalo entre requisições do Radar medido de fora** | A conclusão de 4,00 s veio da aritmética dos próprios logs do worker | `tcpdump` ou um proxy |
| **O alerta vermelho do PRD §5.6 chegando à pessoa** | Só se verificou a flag `needs_attention` no banco | Ver o digest/WhatsApp/e-mail sair |

**E uma limitação desta varredura, que você precisa saber para calibrar quanto confiar nela:** dez lentes rodaram e 69 achados foram registrados, mas o relato completo chegou íntegro para 4 delas; das outras 6, chegaram os achados graves e a verificação cruzada deles. Este laudo nomeia **11 defeitos que passaram por verificação independente** (§3.1 a §3.11) e **14 menores** (§3.12) das lentes cujo relato veio inteiro. Os demais achados existem no registro da varredura e este laudo **não os julga** — não porque sejam irrelevantes, mas porque eu não os li e não vou fingir que li. Se algum módulo lhe parece pouco representado aqui — WhatsApp, IA, metas, relatórios, rotas, LGPD, administração —, é essa a razão, e vale pedir a lente correspondente por escrito.

---

## 6. As três coisas para fazer primeiro

### 1. Gravar a autorização no funil produtor — antes da primeira reunião com cerimonialista

É o único defeito que **destrói informação que não volta**. Todo o resto ou atrapalha, ou custa dinheiro, ou envergonha; este apaga a prova de um consentimento que uma pessoa deu de viva voz, e a única saída é pedir de novo. Como metade da base passa pelo funil produtor, o relógio começa a correr na primeira reunião que a Heloísa marcar. Conserto: uma linha de catálogo, mais um pgTAP que rode a cadeia inteira **nos dois funis** — porque foi exatamente a falta desse "nos dois" que criou o buraco.

### 2. Escolher uma regra só para o piso de recontato (RF-FUN-13)

É o defeito que falha em silêncio e **a favor de ligar demais** — a direção errada para um produto cujo guardrail central é não incomodar quem pediu para não ser incomodado. Ninguém vai notar: a fila simplesmente devolve gente antes da hora, e a Heloísa vai ligar acreditando que o sistema conferiu. Decida qual regra vale, ponha as duas superfícies chamando a mesma função, e escreva o teste como a tabela do §3.2 — duas colunas que precisam dar o mesmo número.

### 3. Deixar a IA e o WhatsApp trancados até fechar o pacote de três

Hoje eles estão desligados por acidente feliz (0 modelos aprovados na Meta, worker `wa` nunca rodou), não por decisão. Antes de qualquer um deles subir, feche os três de uma vez, porque são a mesma conversa: **(a)** a pergunta de supressão no worker de IA e a limpeza de `ai_jobs` no opt-out (§3.3); **(b)** o telefone por extenso na pseudonimização (§3.4); **(c)** o teto no reenfileiramento da confirmação de opt-out (§3.5). Os três juntos são cerca de um dia. Ligar o canal antes disso significa pagar por chamada de contato suprimido e mandar telefone para fora — os dois guardrails que o CLAUDE.md escreve com todas as letras.

**Depois desses três, na mesma semana:** o desfazer da importação (§3.6 e §3.7 juntos, é a mesma cena para o usuário), o `Math.min` da chamada de 2 h (§3.8, uma linha), e apagar o "(34 dos 100 da base)" (§3.10, cinco minutos, e é a única mentira que a tela conta hoje).

---

## Apêndice — estado do banco no fim da varredura

Remedido às 19h25-19h28 de 05/09/2026. O banco estava vivo e compartilhado por dez auditores; outro número medido em outra hora pode divergir.

- **100 organizações**, 1 com `deleted_at` preenchido, 65 com telefone. **Nenhuma ficha de teste de auditoria sobrou** (`name like 'Auditoria%'` → 0), nenhuma com `import_batch_id`.
- **`supplier_candidates`: 0.** As 85 capturas do Radar que uma lente deixou de propósito já foram removidas por alguém. **`raw_capture`: 95 linhas** — resíduo da varredura, sem impacto operacional.
- **`suppression_list`: 1 linha**, criada às 19h00 com `reason = 'seed-visitas-dia'` — é a organização "Ativa Cerimoniais", suprimida e soft-deletada por uma lente de rotas e **não desfeita**. Se ela for uma das suas 100 organizações reais de trabalho, reverta: `update organizations set deleted_at = null, do_not_contact = false where name = 'Ativa Cerimoniais'` e apague a linha 68 da `suppression_list` (o `DELETE` exige papel `admin`).
- **13 filas `pgmq`, todas com profundidade 0. 13 jobs de cron, todos ativos.**
- **Nada meu ficou no banco nem no repositório:** todas as minhas medições rodaram em `begin/rollback`; o único arquivo que criei (um teste de vazamento em `packages/prompts/evals/`) foi apagado, e `git status` está limpo.

# A IA abre, a pessoa conversa · plano conferido

**Repo:** `/Users/matheusrondon/Documents/Tríade` · **Spec:** `docs/superpowers/specs/2026-09-24-pivo-scraper-e-robo-autonomo-design.md` · **Hoje:** 28/09/2026

```bash
cd /Users/matheusrondon/Documents/Tríade && source scripts/dev-env.sh
```

Partida verde, conferida hoje: pgTAP **3.101 asserções em 76 arquivos**; **856 testes do web**.

---

## Por que isto existe

Rafael viu o protótipo da IA conversando e **recusou o desenho**:

> "Achei as respostas muito ruins. Os contatos iniciais eu achei bom, mas o desenvolver
> e a tag com conteúdo por IA, eu não quero que isso aconteça."

O desenho novo, em seis pontos, descrito por ele:

1. **A IA só abre a conversa.** O cumprimento ("Bom dia!") sai pela campanha, como já sai. Se o
   lead responder qualquer coisa, uma segunda mensagem — a **introdução** — sai sozinha, em
   segundos, dentro da janela de 24 h (texto livre de template, de graça). Dali em diante quem
   fala é gente, sempre.
2. **A introdução não tem nome**, de propósito: "para que qualquer atendente possa continuar".
3. **A tag de resposta automática sai.** A transparência era regra nossa (RF-CON-26), não da Meta —
   a Meta exige o caminho de saída para humano, não o aviso.
4. **A temperatura sai da frente e a etapa vira a verdade.** "O fato de só o lead responder e ele
   já virar morno não faz sentido e tá errado."
5. **Quem respondeu vira uma fila própria.**
6. **Filtro de canal no mesmo funil**, e não um funil separado para ligação (confirmado por ele
   hoje). O R13 §3.1 já tinha decidido: o canal é atributo do toque.

**O que isto cancela:** o ADR-14 da emenda de 25/09 e toda a Fase 4 que dependia dele. Nada disso
foi construído — é a spec que precisa dizer que o caminho foi abandonado. O ADR-05 volta inteiro.

---

## Os onze defeitos que a conferência do código encontrou no plano original

### Os sete que quebram

| # | defeito | correção |
|---|---|---|
| **D1** | `count(*) = 1` mata a introdução no **recontato**: quem levou "Bom dia!" em duas levas tem duas saídas, as duas cumprimentos | `count(*) >= 1 and bool_and(...)` — a pergunta é "tudo o que saiu foi cumprimento?" |
| **D2** | `public.pipeline_board` ganharia um 8º parâmetro sem que o 7º morresse. `create or replace` com parâmetro a mais **cria uma segunda função**, e `consultas.ts:103` chama por nome de argumento → PostgREST devolve *function is not unique* e **o quadro para de abrir** | `drop function` explícito da assinatura antiga + repetir `revoke`/`grant` |
| **D3** | ordem invertida: `app.deal_cards` (migração `…110000`) leria `deals.last_channel`, que só nasceria na `…120000` | coluna e backfill sobem para a `…110000` |
| **D4** | `ETAPAS_DE_TRABALHO` não é constante: fornecedor **9**, ativação **6**, produtor **11** (conferido na seed) | o denominador é parâmetro, vindo do funil |
| **D5** | `public.registrar_contato` **não recebe canal**: o par (tipo, canal) é derivado de `interaction_outcomes.surfaces` | o teste chama por `p_outcome_id`, com os desfechos reais |
| **D6** | o RF-CON-12 (PRD linha **339**) exige "nome real de quem envia" e ≤ 80 palavras; a introdução tira o nome e passa disso | a emenda registra as duas diferenças, por escrito |
| **D7** | fora do horário a introdução **cancela** a ausência (`app.ausencia_responder` se cala diante de qualquer saída `created_at >= m.created_at`) | a introdução só sai **dentro do horário**; a decisão volta para o Rafael |

### As quatro que enganam quem ler depois

- **D8** — `messages_after_write` escreve `last_inbound_at`; quem deriva `window_expires_at` é
  `app.conversations_before_write`. O comentário precisa nomear a função certa.
- **D9** — `GEN-SYS-TRANSPARENCIA` **nunca foi enviada por caminho de código nenhum** desde o D1,
  logo não pode ser a tag que o Rafael viu. **Pergunta-se antes** de escrever a migração.
- **D10** — `not exists (messages join GEN-SYS-TRANSPARENCIA)` é vacuamente verdadeira num banco
  recém-resetado. Sai; entra "nenhuma função do banco nomeia o modelo".
- **D11** — a varredura esquece `components/funis/semaforo.tsx`, onde o `SemaforoTermico` fica
  órfão depois da Tarefa 10.

### O que foi conferido e está certo (não se reabre)

- `app.wa_bot_dizer` insere `bot_fixed` + `template_id` copiando o corpo **cru**, e
  `app.messages_nome_do_atendente` pula `template_id is not null` **e** `author_kind not in
  ('human','bot_ai')`. **A introdução sai sem nome por estrutura.**
- `app.pode_enviar` passo 2 devolve `pode=true` para não-primeiro-contato com janela aberta — com
  a ressalva de que os passos 1 (supressão) e 1.5 (`conta_banida`, `meta_restringiu_entrada`) vêm
  antes e ainda podem recusar.
- `app.wa_resposta_no_funil` já leva o negócio para "Respondeu" na primeira resposta.
- `app.atendimento_liga(text)` devolve `false` para chave ausente; `app.app_settings_validate` só
  constrange `cadencia.tetos` e `ia.orcamento`.
- Testes **61**, **69** e **70** são os únicos que inserem mensagem de entrada, e em nenhum a saída
  anterior é cumprimento — **nenhum** dispara a introdução.

---

## Os automatismos no mesmo fio

Gatilhos `after insert` de `public.messages`, na ordem em que disparam (nome, na colação do banco):

| # | gatilho | responde? | o que faz |
|---|---|---|---|
| 1 | `messages_a_freio_do_robo` | **sim** | fusível, pingue-pongue, repetição |
| 2 | `messages_after_write` | não | `last_inbound_at` → (via `conversations_before_write`) `window_expires_at` |
| 3 | `messages_bot_de_entrada` | **sim** | menu e resposta da opção |
| 4 | `messages_ia_pendente` | não | ficha da conversa |
| 5 | `messages_quem_responde_atende` | não | `assignee_id` |
| 6 | `messages_resposta_ao_botao` | **sim** | link do botão, ou opt-out |
| 7 | `messages_resposta_no_funil` | não | atividade "Respondeu" + anda o negócio |
| 8 | **`messages_s_introducao`** | **sim** | **NOVO** |
| 9 | `messages_x_ausencia` | **sim** | fora do horário |
| 10 | `messages_zz_lead_automatico` | não | cria ficha |

O `s` é escolhido: **depois** de `after_write` (a janela precisa estar aberta), **depois** dos três
que podem responder, **antes** de `x_ausencia` e `zz_lead_automatico`. E a garantia não fica só no
nome: a introdução faz a mesma pergunta que a ausência faz — **existe qualquer saída nossa com
`created_at >= m.created_at`?** Se o freio, o menu, o botão ou um atendente falaram nesta entrada,
ela se cala sem precisar nomear nenhum deles.

---

## As tarefas

| # | o que | prova | commit |
|---|---|---|---|
| **0** | A emenda de 28/09 na spec: ADR-14 abandonado, ADR-05 inteiro, **ADR-16**, RF-CON-12 e RF-CON-26 alterados, §5.6 alterada, o canal é atributo do toque. Marcas no PRD | `git diff --stat` só em `docs/` | Registrar que o ADR-14 foi abandonado em 28/09 e que o ADR-05 volta inteiro |
| **0-bis** | **A pergunta ao Rafael** (D9): qual tag ele viu? Sem resposta, só o caminho (a) — desativar o modelo, que é reversível num clique | registrada no CHANGELOG | — |
| **1** | Migração `20261002090000`: modelo `GEN-SYS-INTRO` (sem variável, sem nome), chave `introducao_ativa`, `app.wa_modelos_de_cumprimento()`, `app.wa_modelo_introducao()`, `conversations.introducao_em` | `db:lint` limpo | A introdução ganha modelo, chave e as duas leituras |
| **2** | pgTAP **vermelho** `83_`: as cinco asserções da função pura, inclusive a do recontato (D1) | falha com `function does not exist` | *sem commit* |
| **3** | `app.wa_so_o_cumprimento_saiu` (com `>= 1`) e `app.wa_introduzir` com as **sete recusas nomeadas**: `desligada`, `sem_modelo`, `nao_e_texto_de_entrada`, `bot_pausado`, `parece_optout`, `contato_suprimido`, `fora_do_horario`, `a_conversa_ja_tem_dono`, `ja_respondida`, `ja_introduzida`, `modelo_sumiu` | as 5 asserções passam | A introdução sabe quando entra |
| **4** | O gatilho `messages_s_introducao` e o comentário que documenta a ordem | `pg_trigger` ordenado | O gatilho da introdução entra entre o funil e a ausência |
| **5** | `public.atendimento_configurar` aprende `introducao_ativa` e `texto_introducao` (recusando `{{`); a tela em `painel-atendimento.tsx` | RPC devolve `introducao_com_variavel` | O gestor liga, desliga e reescreve a introdução pela tela |
| **6** | pgTAP `83_` completo: o caminho feliz, **sem nome**, **sem variável**, as recusas, e as três que provam que os automatismos não se atropelam | `83_` verde, os outros 76 iguais | Provar que a introdução sai uma vez, sem nome, e não atropela ninguém |
| **7** | Migração `20261002100000`: `GEN-SYS-TRANSPARENCIA` a `is_active = false`; espelho no `seed.sql` **depois do bloco 10**; teste `84_` com a asserção que morde (D10) | `db:test` verde | A frase de transparência sai de uso; a saída para humano fica |
| **8** | R06 (IA-04, risco R9) e R08 riscados e datados | só `docs/` | O R06 e o R08 registram que a frase de transparência saiu |
| **9** | `funis/etapa.tsx`: `rotuloDaEtapa`, `preenchimentoDaEtapa(posicao, total)`, `EtiquetaEtapa`, `BarraEtapa` — com teste primeiro e o **total como parâmetro** (D4) | `test etapa` verde | A etapa ganha rótulo e barra própria, sem cor de temperatura |
| **10** | Migração `20261002110000`: `deals.last_channel` + backfill (D3) e `app.deal_cards` com `stage_name`, `stage_position`, `last_channel`. O cartão troca `BarraTermica`/`SemaforoTermico` por `BarraEtapa`; `SemaforoTermico` é apagado (D11) | os três quadros abrem | O cartão do funil troca a temperatura pela etapa |
| **11** | Lista de parceiros: coluna "Etapa" no lugar de "Temperatura" (zero SQL) | `/parceiros` | A lista de parceiros mostra a etapa no lugar da temperatura |
| **12** | Lista de conversas e cabeçalho da conversa aberta | `montagem.test.ts` verde | A lista de conversas mostra a etapa no lugar da temperatura |
| **13** | Meu dia (zero SQL; a ordenação interna continua lendo `temperature`) | fila idêntica | O Meu dia mostra a etapa no lugar da temperatura |
| **14** | A varredura e a dívida escrita: os arquivos que ainda mostram temperatura, e por quê | grep + suíte | Registrar as telas que ainda mostram temperatura e por quê |
| **15** | Migração `20261002120000`: índice e `app.activities_touch_deal` carimbando `last_channel` | `db:lint` | O negócio passa a saber o canal do último toque |
| **16** | pgTAP `85_`: o canal vem do **desfecho** (D5); a ligação troca o canal do **mesmo** negócio | `db:test` verde | Provar que o canal é do toque e o lead continua sendo um só |
| **17** | `public.pipeline_board` com `p_canal`, **precedido de `drop function`** (D2); filtro na barra do quadro | `/funis` abre | O quadro ganha filtro de canal, sem partir o lead em dois |
| **18** | A aba "Responderam": `esperandoResposta` + `filaDeQuemRespondeu`, com testes escritos antes | 5 testes novos | Quem respondeu ganha fila própria na caixa de entrada |
| **19** | A suíte inteira e o CHANGELOG, com as **seis decisões** que ficam com o Rafael | 79 arquivos pgTAP | O CHANGELOG conta o dia em que a IA parou de conversar |

---

## O texto da introdução

Três decisões, e nenhuma é estilo:

1. **Não diz "sem mensalidade".** `packages/prompts/src/nucleo/base-conhecimento.ts:36` registra em
   08/09/2026 que a frase é **falsa** (existe taxa mensal do escrow, em revisão). O texto é o fato
   `taxa` da base, palavra por palavra.
2. **"8%" e "komune.app.br"** estão em `VALORES_AUTORIZADOS` e `URLS_PERMITIDAS`.
3. **A origem é genérica** porque o corpo é copiado **cru**: nomear a fonte por ficha exigiria
   variável, e `{{origem}}` sairia literal no fio. Quem perguntar "onde pegou meu número?" recebe
   `GEN-SYS-QUEM-SOMOS`, que tem a fonte, a base legal e o encarregado, e que é mandada **por gente**.

---

## O que fica com o Rafael

1. **Qual tag ele viu?** `GEN-SYS-TRANSPARENCIA` nunca saiu por código nenhum. O que existe na tela
   é o rótulo **interno** "Texto fixo do robô".
2. **A introdução fora do horário.** Está desligada fora do expediente — decisão minha, não dele.
3. **A palavra HUMANO** é prometida por texto e não é tratada por código nenhum.
4. **O texto da introdução precisa dele e do Dennis** antes de produção.
5. **Três modelos ainda dizem "não tem mensalidade"**, que a base registra como falso.
6. **O filtro de canal é "último toque", não "origem".**

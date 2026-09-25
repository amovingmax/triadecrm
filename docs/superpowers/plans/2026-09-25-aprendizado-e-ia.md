# Terceira leva: o aprendizado e a IA sugerindo categoria

> **O portão que este documento abre.** O plano de `2026-09-25-importar-sem-fila.md`
> deixou as tarefas 9 e 10 atrás de um portão — "não começa sem um plano detalhado
> próprio". Este é o plano. A decisão 2 do Rafael punha a IA **depois** que o de-para
> (tarefa 1) e a tela de resolver (tarefa 6) estivessem de pé; as duas estão, e a
> tarefa 7 também.

## O que já mudou, e por que isso muda o plano

A segunda leva alterou o problema que a terceira resolve:

- **A tela de resolver já ensina o de-para.** `public.importacao_mapear_categorias`
  grava a regra na hora da importação, auditada. Então a tarefa 9 **não** precisa
  inventar como ensinar: ela cobre o outro caminho, o da **fila** — quando alguém
  escolhe a categoria de um nome que já está lá dentro.
- **A fila já sabe o nome da fonte** (`categoria_na_fonte`, tarefa 4) e já aprova
  por grupo (tarefa 7). O "valer para os outros N" tem onde se apoiar.
- **Os 7 nomes que sobram das 40 linhas** são os que a sugestão por radical não
  resolve sozinha: quatro dependem do NOME DA EMPRESA, não do rótulo. É
  exatamente isso que a IA lê.

## TAREFA 9 — O CRM aprende com quem escolhe na fila (1,5 dia)

**A regra:** só se aprende onde **uma pessoa escolheu**. `app.promover_candidato`
também é chamada pela importação, onde a categoria veio do mapa — ali não há nada
que aprender, e um gatilho de tabela não sabe a diferença. Por isso o ponto é
dentro de `public.radar_revisar_candidato`, no caminho `aprovar`, **depois** de
`app.promover_candidato` voltar ok.

- **9.1** `public.source_category_proposta` (source_id, category_source, category_id,
  vezes, quem uuid[], primeira_em, ultima_em, virou_regra_em). Nada escreve direto
  no mapa: **propõe**.
- **9.2** `public.source_category_map` ganha proveniência: `origem`
  (`semeado`|`aprendido`), `aprendido_por`, `aprendido_em`.
- **9.3** Os cinco freios, e nenhum é opcional:
  1. **Nunca no primeiro clique.** Vira regra com `vezes >= 3`, ou `vezes >= 2`
     vindo de **duas pessoas diferentes**.
  2. **Discordância congela.** Proposta concorrente viva para a mesma chave: nada
     promove. É o "revisão humana quando empatar" do RF-RAD-06.
  3. **Vale só para frente.** A regra nova não reescreve ficha já criada.
  4. **Uma tela e um desfazer**, com quantas fichas aquela regra criou.
  5. **`audit_log` em toda promoção.** Curadoria é decisão auditável.
- **9.4** O atalho da fila: `public.radar_aprender_agora(p_candidate_id, p_category_id)`
  — "valer para os outros N que também vieram como X". Consentimento explícito
  vale mais que contagem, então **pula o contador** e escreve a regra na hora.
  Desmarcado por padrão. O número vem de um `count` real.
- **9.5** pgTAP: um clique não vira regra; três viram; dois de duas pessoas viram;
  dois da MESMA pessoa não viram; discordância congela; desfazer volta atrás.
- **9.6** Tela: a caixinha no diálogo de aprovar, e a lista das regras aprendidas
  em Ajustes, com o desfazer.

## TAREFA 10 — A IA sugerindo categoria (1,5 dia)

Ela **já responde** `categoriaSugerida` e a gente joga fora em
`public.ia_gravar_triagem`. Três correções e três travas.

- **10.1** `app.ia_candidatos_para_triar` manda `'categoriaDaFonte', null` fixo.
  Trocar pelo `left join public.source_record` em `(source_id, external_id)` — a
  mesma junção pela qual o candidato é encontrado.
- **10.2** Colunas `ia_categoria_id` e `ia_run_id`; `ia_gravar_triagem` casa o
  nome devolvido contra `public.categories` por `app.chave_catalogo`, **só o que
  casar exato**.
- **10.3** A chave da fila passa a ser do **lote** (`'triar:lote:' || p_batch_id`)
  e não do dia: hoje são 20 por DIA, e a segunda importação do dia enfileira nada,
  em silêncio.
- **10.4** Prompt `triagem-do-radar@v2`: o único exemplo ensina a resposta errada
  — devolve `'Locais'` e `'Alimentos e Bebidas'`, que são nomes de **grupo**, não
  de categoria. Com a regra "só entra o que casar exato", o exemplo treina o
  modelo a produzir string que nunca casa. Eval junto.
- **10.5** A sugestão chega **pré-preenchida no diálogo** e nada escreve ficha
  sozinho (RF-RAD-11). `dialogo-decisao.tsx` já inicializa o seletor com
  `candidato.categoria_id`.
- **10.6** O freio de 80% do orçamento derruba a triagem, e a tela tem de **dizer
  isso** em vez de ficar quieta.

> **O que fica de fora, e é escolha:** limpar `ia_analisado_em` dos 155 já lidos
> para reprocessá-los. É uma segunda chamada paga por candidato e uma escrita em
> massa; a tarefa 7 resolve os 155 **de graça**, por grupo. Se depois disso
> sobrar fila, a limpeza auditada é um passo de dez linhas — e aí com motivo.

## O que NÃO muda, e é contrato

- **Nada escreve ficha sozinho.** RF-RAD-11: a fila de revisão humana continua
  sendo a única porta. A IA pré-preenche; a pessoa confirma.
- **Rastreabilidade (ADR-08)**, opt-out e supressão, intactos.
- **A Fase 4 (a IA escrevendo) não é tocada.**

# Plano de execução — Importar sem fila (corrigido)

Desenho aprovado: `docs/superpowers/specs/2026-09-25-importar-sem-fila-design.md`.

Onze tarefas. A **0** é o instrumento de medida; as **1–4** são a primeira leva (~2 dias); as **5–8** são a segunda (~3,5 dias); as **9–10** ficam como desenho fechado com plano a escrever (~3 dias), atrás de um portão de decisão.

---

## O que corrigi no plano anterior, e por quê

Abri os arquivos. Doze coisas não fechavam.

1. **A aritmética do placar se contradiz.** A tabela "A medida que importa" diz 13 (10 `fotógrafo` + 1 `serviço de fotografia` + 3 `salão de festas`, menos Lisboa); a "Prova" da 0.4 diz `fotografo = 9` "(10 fotógrafo − 1 Lisboa, **mais nada**)", esquecendo `serviço de fotografia`. Contei nos arquivos:

   | arquivo | categoria | linhas |
   |---|---|---|
   | fotógrafo | Fotógrafo | 10 |
   | | Estúdio fotográfico | 2 |
   | | Impressões fotográficas | 2 |
   | | Loja de artigos para fotografia | 2 |
   | | Loja de Presentes | 1 |
   | | Companhia de produção de filmes e conteúdos para TV | 1 |
   | | Serviço de fotografia | 1 |
   | | Estúdio de fotografia | 1 |
   | buffet | Buffet infantil | 6 |
   | | Buffet de casamento | 4 |
   | | Serviço de catering | 3 |
   | | Salão de festas | 3 |
   | | Serviços para festas infantis | 1 |
   | | Restaurante self-service | 1 |
   | | Centro de diversões infantil | 1 |
   | | Local para eventos | 1 |

   São 16 nomes distintos, sem sobreposição entre os arquivos — bate com o desenho. **Hoje:** fotógrafo 11 mapeadas − 1 Lisboa = **10**; buffet **3**. Total **13**. **Depois da tarefa 1:** fotógrafo 14 − 1 = **13**; buffet **17**. Total **30**. O total do plano estava certo; o recorte por arquivo, não. E as duas colunas `emails` vêm vazias nas 40 linhas — o recibo da tarefa 5 precisa dizer isso.

2. **O índice único sobre `app.chave_catalogo` contraria a regra do próprio repositório.** `app.chave_catalogo` (`20260904001820:71-81`) é declarada `immutable` mas chama `extensions.unaccent(text)`, que é `stable`. E o comentário de `app.search_name` (`20260904000100:328-330`) diz, com todas as letras, que é por isso que aquele valor é **materializado por gatilho e indexado na coluna**, nunca por expressão. Trocar: depois que a tarefa 1 normaliza tudo que está gravado, a **PK `(source_id, category_source)` já recusa a segunda grafia sozinha** — basta um `CHECK (category_source = app.chave_catalogo(category_source))` para garantir que só a forma normalizada entra. Ganho extra: a busca volta a ser igualdade simples sobre a PK, e não varredura por expressão. O `throws_ok` do pgTAP passa a esperar **23514**, não 23505.

3. **`audit_log` não tem gatilho em `supplier_candidates`.** Os gatilhos são só de `organizations`, `contacts`, `deals`, `consent_events`, `profiles` e `allowed_users` (`20260904000400:261-266`), e nem `radar_revisar_candidato` nem `app.promover_candidato` inserem lá. A asserção da 7.1 reprova. O que existe de verdade: cada aprovação cria uma `organizations` e uma `deals`, e **esses** gatilhos gravam uma linha cada.

4. **O laço do lote não tem subtransação.** `radar_revisar_candidato` devolve `ok:false` nas recusas previstas, mas qualquer exceção *levantada* lá dentro aborta a transação e desfaz os que já passaram.

5. **A marca `telefone_compartilhado` nunca chega ao cartão.** O bloco (5) de `app.resolver_source_record` (`20260904001600:927-944`) insere o candidato com `v_r.flags` — lida **antes** do `update public.source_record` do bloco (4) (`:918-921`).

6. **O pgTAP 77 não roda.** Não cria fixture nenhuma, não entra em sessão, e `p_q = 'Fixture 77'` casa também com `'Fixture 77 manual'`.

7. **Os trechos de tela da 2.4 não compilam.** `seletor-de-origem.tsx` não importa `Button`, não tem estado `abrirSeletor` e não recebe `deteccao`.

8. **A asserção 1 do pgTAP 76 é contagem absoluta em tabela compartilhada**, o que o cabeçalho do 66 proíbe.

9. **Carimbo de migração com 12 dígitos.** O Supabase exige 14.

10. **`app.categoria_por_radical` conta radical repetido.** Vira `count(distinct left(w, 6))`.

11. **A prova da tarefa 3 nunca fica verde.** Vira uma lista fechada de arquivos e strings.

12. **As tarefas 9 e 10 são prosa.** Ficam marcadas como tais, com portão de decisão.

Mais três acertos de referência: a linha do auto-teste da seed é **1677**; a transcrição de `public.importacao_previa` é **509-688**; e o `update` em massa de `public.activities` dispara `activities_apply_outcome`, que é **`before insert or update`**.

---

## Ambiente, em toda sessão

```bash
cd /Users/matheusrondon/Documents/Tríade && source scripts/dev-env.sh
```

`pnpm db:start` · `pnpm db:reset` · `pnpm db:test` · `pnpm db:lint` · `pnpm db:types` · `pnpm lint` · `pnpm typecheck` · `pnpm test`.
Verde de partida: pgTAP 3.028 asserções / 69 arquivos; web 814 / 52; workers 363 / 24.
Banco local: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

**Carimbo das migrações:** a última do repositório é `20260930120000` — data futura. As novas usam **14 dígitos** a partir de `20261001090000`. Os pgTAP novos começam em **76**.

**Ao fim de cada tarefa, sem exceção:** `pnpm db:lint && pnpm db:test && pnpm lint && pnpm typecheck && pnpm test`, o placar, e uma entrada em `docs/CHANGELOG.md`.

---

## A medida que importa

Uma só: **quantas das 40 linhas de `listas/` viram parceiro sem ninguém responder nada** — `contagem.entra` da prévia, com a origem certa e base limpa.

| momento | `entra` (fotógrafo + buffet) | o que falta |
|---|---|---|
| hoje, origem errada (o que o Rafael viu) | **0** | a detecção (tarefa 2) |
| hoje, origem certa à mão | 10 + 3 = **13** | o de-para (tarefa 1) |
| depois da tarefa 1 | 13 + 17 = **30** | — |
| depois da tarefa 8 | **29** + 1 duplicata honesta | a prévia deixa de mentir |
| depois da tarefa 6, com 2 respostas de um clique | **34** | — |

---

# TAREFA 0 — O placar (0,3 dia)

**Entrega:** `scripts/placar-importacao.sql`, que roda a prévia dos dois CSV reais dentro de uma transação e desfaz tudo.

### 0.0 — A trava contra a divergência

Em `apps/web/src/components/importacao/mapeamento.test.ts`, contra o cabeçalho real de `listas/2026-09-25-fotografo-natal-rn.csv`: `sugerirMapa` casa exatamente 10 campos, todos por nome exato; e nas três disputas de coluna ganha a certa (`link` vence `reviews_link`, `cid` vence `place_id`, `address` vence `complete_address`).

### 0.1 a 0.3 — O script

Roda em transação, `set_config('request.jwt.claims', …)` com papel `gestor`, `set local role authenticated`, temp tables criadas depois do `set local role`, `\copy` dos dois CSV, `public.importacao_previa` por arquivo, três `\echo` (placar, categorias desconhecidas, linha a linha), `rollback`.

### 0.4 — Rodar e gravar a linha de base

**Prova:** `fotografo: viram_parceiro = 10`, `buffet: viram_parceiro = 3` — **13 no total**, e `fotografo: nao_entram = 1`.

---

# PRIMEIRA LEVA

# TAREFA 1 — O de-para, a chave sem acento e a trava de grafia (0,5 dia)

**Entrega:** o mapa da fonte `google_maps_raspado` passa de 12 para 18 chaves, todas normalizadas por `app.chave_catalogo`, com um `CHECK` que recusa a segunda grafia na escrita.

- **1.1** pgTAP vermelho primeiro: `supabase/tests/76_o_crm_fala_google.sql`, `plan(10)`, sem contagem absoluta de tabela compartilhada.
- **1.2** Migração parte 1: guarda contra grafias duplas com destinos diferentes, remove duplicatas equivalentes, normaliza o que está gravado, e `CHECK (category_source = app.chave_catalogo(category_source))`.
- **1.3** Migração parte 2: as seis chaves novas (`buffet infantil`, `buffet de casamento`, `serviço de catering`, `estúdio fotográfico`, `estúdio de fotografia`, `local para eventos`).
- **1.4** Migração parte 3: os dois leitores vivos (`app.importacao_normalizar` e `public.esteira_processar_captura`) passam a comparar `app.chave_catalogo(<categoria da linha>)` contra a chave já normalizada. E `app.importacao_normalizar` devolve `site` e `categoria_origem` no topo.
- **1.5** A seed, espelho exato, e o auto-teste vira `< 18` (piso, não teto).
- **1.6** Prova: fotógrafo 10 → **13**; buffet 3 → **17**; total **13 → 30**. Nomes desconhecidos caem de 13 para **7**.

Commit: `O mapa de categorias perde o til e ganha seis nomes`.

---

# TAREFA 2 — A origem lida no cabeçalho (0,5 dia)

**Entrega:** o seletor "De onde veio esta lista" deixa de abrir no errado.

- **2.1** Fixtures reais copiadas de `listas/`. A `maps-natal-buffet.csv` antiga (29 colunas, com BOM) **fica**.
- **2.2** Teste vermelho, com a asserção de coerência: sem a fonte do Maps no catálogo, a tela não afirma o que não escolheu.
- **2.3** `origem-detectada.ts`: `cid` + (`plus_code` | `data_id`) → `google_maps_raspado`; o `porque` só existe quando a origem escolhida é mesmo a do Maps.
- **2.4** Ligar em `tela-importacao.tsx` (detecção depois de ler o arquivo, escolha manual vence) e `seletor-de-origem.tsx` (linha de fato + `[não é?]`). `Etapa` **não** muda.

Commit: `A tela reconhece o arquivo do Maps em vez de perguntar`.

---

# TAREFA 3 — Os textos que mentem (0,5 dia)

- **3.1/3.2** `fraseDeZero`: o `if` passa a olhar o maior grupo.
- **3.3** `ROTULO_DECISAO` / `EXPLICACAO_DECISAO` conforme §3.4 do desenho.
- **3.4** `EXPLICACAO_DA_MARCA` ganha `ja_existe_na_base` e `telefone_compartilhado`.
- **3.5** O glossário nos arquivos citados. Ficam de fora: os nomes das fontes na seed (migração) e a linha do histórico (tarefa 4).
- **3.6** Prova por `grep` sobre string literal em JSX.

Commit: `A tela para de dizer o contrário do que aconteceu`.

---

# TAREFA 4 — A fila diz como o Google chamou aquilo (0,5 dia)

- **4.1** pgTAP `77_a_fila_diz_o_nome_do_google.sql`, `plan(4)`, **com fixtures** e nomes disjuntos (`Zeta77 Duasfontes`, `Zeta77 Semfonte`).
- **4.2** Migração: `drop`+`create` de `public.radar_fila` com `categoria_na_fonte` por `lateral … order by sr.last_seen_at desc limit 1`; e o histórico "Aprovado na fila do Radar por X" → "Virou parceiro na fila, por X", com filtro estreito.
- **4.3** Tipos e tela: `categoria_na_fonte` em `CandidatoDaFila`; o cartão diz `Escolha a categoria · a fonte chamou de "…"`.
- **4.4** Prova contra a fila de verdade: a consulta do desenho §1(f) agrupa os presos.

Commit: `A fila mostra o nome que veio da fonte`.

**Fim da primeira leva.** `docs/CHANGELOG.md` com o placar antes/depois (**13 → 30 de 40**).

---

# SEGUNDA LEVA

# TAREFA 5 — O recibo de leitura das colunas (0,5 dia)

As 36 caixinhas viram um recibo; a grade inteira vai para um `<details>`; o passo do mapa é pulado quando não há dúvida; `E-mail (vazia no arquivo)`.

# TAREFA 6 — A pergunta passa a ser por categoria (1,5 dia)

`app.categoria_por_radical` (com `count(distinct left(w,6))`), `categorias_novas` na prévia, `public.importacao_mapear_categorias(int, jsonb)` auditada e `resolver-categorias.tsx`.

# TAREFA 7 — Aprovar em lote (1,0 dia)

`public.radar_revisar_lote(uuid[], int)`, laço sobre `radar_revisar_candidato` com subtransação por candidato, teto de 200. "Não contatar" e "recusar" continuam um a um.

# TAREFA 8 — A prévia para de mentir (0,5 dia)

`website` na prévia + `keepo.io`/`bio.link`/`campsite.bio` em `app.is_shared_web_host` (mesmo commit, sempre); `place_id` divergente no bloco (3) de `app.resolver_source_record`; e a marca `telefone_compartilhado` chegando ao candidato (blocos 4 e 5).

---

# TAREFA 9 — O CRM aprende com quem escolhe (1,5 dia) · **desenho fechado, plano a escrever**

> **Portão.** Não começa sem um plano detalhado próprio.

# TAREFA 10 — A IA sugerindo categoria (1,5 dia) · **desenho fechado, plano a escrever**

> **Portão.** Decisão 2 do Rafael: só depois que a 6 e a 7 estiverem de pé. A Fase 4 não é tocada.

---

## Ordem, e o que cada leva entrega

| leva | tarefas | dias | o que o Rafael sente |
|---|---|---|---|
| 0 | o placar | 0,3 | nenhuma promessa sem número |
| 1ª | 1 · 2 · 3 · 4 | 2,0 | arrasta o arquivo e **30 das 40** viram parceiro sem responder nada |
| 2ª | 5 · 6 · 7 · 8 | 3,5 | um passo a menos, a pergunta por categoria, o lote honesto e a prévia que não mente |
| 3ª | 9 · 10 (portão) | 3,0 | o aprendizado e a IA — depois de um plano próprio |

Total: **8,8 dias**.

---

## O que NÃO muda, e é contrato

- **Rastreabilidade (ADR-08):** toda linha continua passando por `raw_capture → source_record → supplier_candidate`, com proveniência campo a campo.
- **Opt-out e supressão:** `radar_revisar_lote` herda a recusa de candidato `do_not_contact`. "Não contatar" e "recusar" continuam fora do lote.
- **Nada em produção:** sem `supabase db push`, sem `vercel`, sem `git push`.
- **Fase 4 (a IA escrevendo) não é tocada.**

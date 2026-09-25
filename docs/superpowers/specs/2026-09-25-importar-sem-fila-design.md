# Importar sem fila: o desenho

**O erro não foi seu.** O seletor "De onde veio esta lista" nasce em *Planilha*, e o CSV do Maps precisa de *Google Maps*. Com ele errado, o mapa de categorias da fonte nem é consultado: as 19 linhas dos fotógrafos viraram 0 fichas, em silêncio.
A segunda causa: o de-para tem 12 nomes e o Google devolveu 16 — **casam 3**. Categoria que não casa vira cartão na fila, um por um.
No desenho novo o CRM reconhece o arquivo do Maps pelo cabeçalho, o passo das 36 caixinhas some, e antes de gravar ele pergunta **uma vez por nome de categoria novo** — nunca por linha. A resposta fica gravada; na lista seguinte ele não pergunta de novo.
Nas mesmas 20 linhas de fotógrafos: **12 viram parceiro sozinhas**, sem você responder nada. Com duas respostas de um clique, **16**.
Sobram 1 erro de arquivo (um fotógrafo de Lisboa), 1 duplicata e 2 que você deixou para depois. Hoje esse lote deu **0**.

---

## 1. O caminho novo, do arquivo à ficha

### A regra que muda tudo

Hoje o CRM pede uma decisão **por linha**. O caminho novo pede uma decisão **por nome de categoria** — e guarda a resposta.

Nos dois lotes de hoje o Google devolveu 16 nomes de categoria. Treze o CRM não conhece: `public.source_category_map` da fonte 13 tem 12 chaves, e só três casaram (`fotógrafo`, `serviço de fotografia`, `salão de festas`). Decidir por nome são **13 respostas, uma vez**. Decidir por linha são os **36 cartões** que nasceram hoje.

Nas mesmas 40 linhas:

| | hoje (medido) | caminho novo |
|---|---|---|
| fichas criadas | 3 | **27** |
| cartões na fila | 36 | **12** |
| decisões humanas | 36 cartões, um a um | **13 linhas de tabela + 12 cartões que valem a pena** |
| na segunda importação igual | os mesmos 36 | **0** |
| passos de tela | 4 | **2** |

De onde saem os 27 e os 12:

- **Fotógrafos (20):** 1 erro (Rômulo, telefone de Portugal). Com o de-para da §2, **12 entram sozinhas**. Sobram 4 nomes novos em 6 linhas; se dois deles viram *Fotografia e vídeo* e dois ficam em "não sei", entram **16 fichas** e vão à fila 2 "não sei" + 1 duplicata.
- **Buffets (20):** as **9 duplicatas continuam duplicatas** — não dependem de categoria e nenhuma tela as resolve. Os 8 que hoje param por categoria entram: 3 + 8 = **11 fichas**, 9 na fila.

Os 12 que sobram na fila são decisões de verdade: qual ficha vence. Não são ruído.

---

### (a) O seletor de origem: **some**

Vira detecção pelo cabeçalho. O CSV do Maps tem `cid`, `plus_code`, `place_id`, `data_id`, `input_id` e `reviews_link` — conferido no cabeçalho real de `listas/2026-09-25-fotografo-natal-rn.csv`, 36 colunas. Nenhuma planilha escrita por gente tem isso.

Regra: `cid` presente **e** (`plus_code` ou `data_id`) → `google_maps_raspado`. Senão → `planilha`.

A tela deixa de mostrar um menu que abre no errado e passa a mostrar um **fato contestável**, na linha do arquivo:

```
2026-09-25-fotografo-natal-rn.csv · 20 linhas
Lista do Google Maps — reconheci por cid, plus_code, place_id   [não é?]
```

`[não é?]` abre o seletor de hoje. A escolha manual vence a detecção e fica registrada no lote, como já fica.

Errar hoje custa 19 fichas → 0, em silêncio. Depois de (c), errar custa quase nada: a categoria que não casa cai na tela de resolver, que pergunta em vez de empurrar para a fila.

Onde: `apps/web/src/components/importacao/origem-detectada.ts` (novo, `detectarOrigem(cabecalho, origens)`); `tela-importacao.tsx:86` troca `origens.find((o) => o.slug === 'planilha')` pela detecção — e ela roda **depois** de ler o arquivo; `seletor-de-origem.tsx` deixa de ser bloco no passo do arquivo e vira o `[não é?]`.

---

### (b) A parede de 36 caixinhas: **vira um recibo de leitura**

Rodei `sugerirMapa` contra o cabeçalho real: as 10 colunas que o CRM usa casam **todas por nome exato**, nenhuma por semelhança. A pessoa não precisa ver 36 caixas para confirmar 10 acertos que a máquina já fez.

```
O CRM leu 10 colunas                                    [ ver as 36 ▾ ]
Nome · WhatsApp · Categoria · Endereço · Site · Link ·
ID do lugar (cid) · Nota · Nº de avaliações · E-mail (vazia no arquivo)
Nada em dúvida.
```

(`emails` vem vazia nas 20 linhas dos dois arquivos. O recibo diz isso, porque senão parece bug.)

Só aparece caixinha em dois casos: campo obrigatório que não foi achado, e coluna que casou por **semelhança** — hoje ela ganha o selo "Confira" (`passo-mapa.tsx:147`) e ele se perde no meio de 36 cartões.

**Disputa de coluna não vira pergunta.** No CSV do Maps há três (`link` × `reviews_link`, `cid` × `place_id`, `address` × `complete_address`) e nas três a coluna certa ganha. Além disso `sugerirMapa` nem registra disputa: `motivos` guarda só o vencedor. Perguntar aqui seria pedir três confirmações inúteis por arquivo. Disputa vira linha na lista dos ignorados, com o motivo.

Nos dois lotes reais o passo do mapa some, e sobram dois passos: arquivo → prévia → recibo. `[ ver as 36 ▾ ]` guarda a grade de hoje inteira (`passo-mapa.tsx:118`), para quem quiser trazer uma coluna ignorada. Nada se perde; só sai da frente.

Duas linhas de texto que economizam um chamado: `ROTULO_EXTRA.place_id` passa de "ID do lugar no Maps" para **"ID do lugar no Maps (cid)"**, e a coluna `place_id` do arquivo aparece entre as ignoradas com o motivo — *"o `place_id` da Places API não é o `cid` do Maps (ADR-12)"*.

---

### (c) A categoria: resolvida **antes** de gravar

A tela de resolver os nomes novos é o coração. Entre a prévia e o gravar:

```
6 nomes de categoria que o CRM ainda não conhece — 9 linhas paradas.
Você responde uma vez. Não pergunto de novo.

  Estúdio fotográfico            2   Show Fotografias, Bruna Xavier      [ ▾ ]
  Impressões fotográficas        2   PROALBUNS, Fotografe Mais CCAB SUL  [ ▾ ]
  Loja de artigos p/ fotografia  2   Viva Arte, Paparazzi Fotografia     [ ▾ ]
  Estúdio de fotografia          1   Narah Alves Estúdio Fotográfico     [ ▾ ]
  Loja de Presentes              1   PICMIMOS - Revelação de Fotos       [ ▾ ]
  Companhia de produção de TV    1   Fabio Carneiro Fotografia           [ ▾ ]
                                                        [ Aplicar aos 9 ]
```

Agrupado por nome, ordenado por quantas linhas destrava. **Os nomes das empresas ficam à vista, e essa coluna não é enfeite:** *Loja de Presentes* é a PICMIMOS, que revela foto, e *Companhia de produção de filmes* é o Fabio Carneiro, fotógrafo. Sem ver as empresas, a pessoa descarta lead bom pelo rótulo do Google.

Três respostas: uma categoria, "não importar estas linhas", ou "não sei" — aí vai para a fila, com o nome escrito no cartão. A resposta grava em `public.source_category_map` e vale para sempre. É isso que troca O(linhas) por O(nomes novos).

**A sugestão automática de hoje não funciona.** `app.importacao_categoria` (`20260904001820:146`) exige `similarity >= 0.55` contra `categories.name`. Rodei os 13 nomes novos contra as 19 categorias: **nenhum** chega a 0,55. *Estúdio fotográfico* × *Fotografia e vídeo* dá 0,34; até *Buffet infantil* × *Buffet infantil / casa de festas infantil* para em 0,52. A tabela sairia com 13 caixas vazias.

O que funciona é casar **palavra**, não frase: comparar os radicais de 6 letras do nome do Google com os do nome e do slug da categoria. Aí *Estúdio fotográfico*, *Impressões fotográficas*, *Loja de artigos para fotografia* e *Estúdio de fotografia* apontam todos para *Fotografia e vídeo* por `fotogr`; *Loja de Presentes* e *Companhia de produção* não apontam para nada, que é a resposta certa. Empate entre duas categorias (*Buffet de casamento* empata entre os dois buffets) vale como "não sei". A sugestão **sobe para o topo da lista e nunca vem marcada**.

**O que você foi buscar.** No momento de soltar o arquivo, um campo: *"O que você foi buscar nesta lista?"* → uma categoria do catálogo. Ela **não** pré-marca nada; só entra como primeira opção da lista suspensa, à frente da sugestão por radical.

**Por que não pré-marcar.** Pré-marcar e deixar confirmar tudo num clique é o carimbo silencioso com outro nome. Na lista do buffet ele transformaria *Restaurante self-service* e *Loja de Presentes* em Buffet adulto — e aí o funil erra, a meta de déficit erra, e alguém abre conversa com o pitch errado. O ganho é de segundos; o estrago é uma mensagem enviada.

Onde: `public.importacao_previa` passa a devolver `categorias_novas` — `[{nome_na_fonte, linhas, exemplos, sugestao_id, sugestao_nome}]`; `public.importacao_mapear_categorias(p_source_id int, p_pares jsonb)`, nova, `security definer`, `on conflict (source_id, category_source) do update`, com registro em `audit_log`; `apps/web/src/components/importacao/resolver-categorias.tsx`, novo, dentro de `passo-previa.tsx`. A normalização sem acento que essa tela pressupõe está na §2 (a.0) — não é opcional, é pré-requisito.

---

### (d) O que continua indo para a fila

| Vai para a fila | Por que precisa de gente | Nos 2 lotes |
|---|---|---|
| duplicata contra a base | juntar ou descartar é escolha de qual ficha manda | **10** |
| "não sei" da tela de resolver | a pessoa escolheu adiar | 2 |
| mesmo telefone, lugares diferentes | ver o achado abaixo | 1 (*Doce Sabor* × *Luz da Festa Kids*) |

Dez duplicatas, não uma. Uma fila de 12 é trabalhada no mesmo dia; uma de 155 é ignorada, e aí as duplicatas de verdade morrem junto com o ruído.

**Erro de arquivo já não vai para a fila** — `importacao_gravar` corta a linha com erro antes da esteira (`20260904001820:824-826`), então o fotógrafo de Lisboa nunca virou candidato. Ele já aparece no recibo. O que falta é o recibo dizer **qual linha** e **o que corrigir**.

**Achado 1 — o telefone compartilhado.** *Doce Sabor Buffet* e *Luz da Festa Kids* têm o mesmo `(84) 99988-0963` e `cid` diferentes. O bloco (3) de `app.resolver_source_record` casa por celular (`20260904001600:899-903`) e pendurou o `source_record` de um no candidato do outro — conferido: um candidato com dois `source_record`. A trava do bloco (4) não salvou porque exige `v_n > 3` candidatos no mesmo número (`:914-917`); aqui são dois. Conserto no bloco (3): não casar por telefone quando os dois lados têm `place_id` e eles **diferem**. Dois lugares do Google são dois negócios. O candidato nasce separado, com a marca `telefone_compartilhado`, e a prévia mostra os dois nomes.

**Achado 2 — a prévia mente por causa do site.** As duas linhas *Show Fotografias* têm `cid`, telefone e endereço diferentes, e a semelhança de nome dá 0,40 contra limiar de 0,85 em `app.find_org_matches`. O que as junta é o site: as duas apontam para `https://keepo.io/showfotografias`, e domínio igual vale 0,90. Daí dois defeitos:
1. `public.importacao_previa` **não passa o site** para `app.find_org_matches` (`20260924130000:585-597`), enquanto `app.resolver_source_record` passa (`20260904001600:988-992`). A prévia promete "entra" e a gravação responde "duplicata" — exatamente o defeito que uma prévia existe para não ter. Conserto: acrescentar `'website'` ao objeto da prévia.
2. `keepo.io` não está em `app.is_shared_web_host` (`20260904000100:320-324`), que já lista `linktr.ee`, `linkr.bio` e `beacons.ai`. Keepo é link na bio: vai fundir empresas sem relação. Entra na lista, com `bio.link` e `campsite.bio`.

---

### (e) Aprovar em lote: **sim, com uma linha divisória**

Em lote entra o que **não tem decisão dentro**: candidato com categoria, sem duplicata, sem supressão. A tela seleciona por grupo e confirma nomeando o que vai acontecer — *"Aprovar 12 fichas em Fotografia e vídeo"*.

Fica no cartão individual, sempre:
- **duplicata e mesclar** — a decisão é *qual ficha vence*, e isso não se agrupa;
- **não contatar** — escreve em `suppression_list` e em `consent_events` (`20260909150000:94-132`). Nunca em lote;
- **recusar** — o banco exige motivo escrito (`supplier_candidates_recusa_com_motivo`, `20260904001401:192`), e motivo em lote seria motivo genérico.

A segurança vem de não haver caminho novo de escrita. `public.radar_revisar_lote(p_ids uuid[], p_category_id int)` é um laço sobre **`public.radar_revisar_candidato(id, 'aprovar', null, p_category_id, null)`** — a mesma função que o cartão chama hoje, e não sobre `app.promover_candidato` direto: é ela que guarda o `can_write()`, a recusa de candidato `do_not_contact` e a máscara de ficha de carteira alheia. `app.promover_candidato` reconfere a supressão viva a cada candidato, dentro do laço. Uma entrada de auditoria por candidato. Teto de 200 ids. Devolve a conta do que passou e do que foi recusado, com o motivo de cada um.

---

### (f) Os 155 que já estão lá

Eles somem sozinhos em 16/12/2026 — `app.aplicar_retencao`, ramo 2: `status = 'novo'` com mais de 90 dias é apagado (`20260904001600:2139-2140`). Deixar morrer é honesto, mas é jogar fora lead já raspado.

A mesma tela de (c), apontada para o que já existe. Uma consulta agrupa o que está preso:

```sql
select sr.category_source, count(distinct c.id)
  from public.supplier_candidates c
  join public.source_record sr on sr.candidate_id = c.id
 where c.status = 'novo' and c.category_id is null
 group by 1 order by 2 desc;
```

Responde os nomes, `radar_revisar_lote` aprova por grupo. É uma tabela e dez minutos.

**Falta uma peça, e ela é a razão de a fila ser impossível hoje:** `public.radar_fila` **não devolve** `category_source`. Conferido — a palavra não aparece uma vez em `apps/web/src`. O cartão escreve "Sem categoria" (`cartao-candidato.tsx:163`) e não diz que o Google chamou aquilo de *Buffet infantil*. A pessoa adivinha, cartão por cartão, numa lista de 19 categorias.

Conserto: `radar_fila` ganha a coluna `categoria_na_fonte` (exige `drop function` e recriar, como a `20260917230100` já fez). Um candidato pode ter **vários** `source_record` — a chave única é `(source_id, external_id)` —, então a coluna vem de um `lateral` com `order by sr.last_seen_at desc limit 1`, nunca de um `join` que multiplicaria as linhas da fila.

---

### A tela, antes de gravar

```
┌──────────────────────────────────────────────────────────────────┐
│  Importar lista                                                  │
│                                                                  │
│  2026-09-25-fotografo-natal-rn.csv · 20 linhas                   │
│  Lista do Google Maps — reconheci por cid, plus_code   [não é?]  │
│  Você foi buscar:  [ Fotografia e vídeo            ▾ ]           │
├──────────────────────────────────────────────────────────────────┤
│  O CRM leu 10 colunas                            [ ver as 36 ▾ ] │
│  Nome · WhatsApp · Categoria · Endereço · Site · Link ·           │
│  ID do lugar (cid) · Nota · Nº de avaliações · E-mail (vazia)    │
│  Nada em dúvida.                                                 │
├──────────────────────────────────────────────────────────────────┤
│  6 nomes de categoria novos — 9 linhas paradas neles.            │
│  Você responde uma vez. Não pergunto de novo.                    │
│                                                                  │
│   Estúdio fotográfico          2  Show Fotografias, Bruna  [ ▾ ] │
│   Impressões fotográficas      2  PROALBUNS, Fotografe...  [ ▾ ] │
│   Loja de artigos p/ fotogr.   2  Viva Arte, Paparazzi     [ ▾ ] │
│   Estúdio de fotografia        1  Narah Alves              [ ▾ ] │
│   Loja de Presentes            1  PICMIMOS – Revelação     [ ▾ ] │
│   Companhia de produção de TV  1  Fabio Carneiro Fotogr.   [ ▾ ] │
│                                              [ Aplicar aos 9 ]   │
├──────────────────────────────────────────────────────────────────┤
│   16  viram ficha                                                │
│    3  vão para a fila                                            │
│       1 duplicata · 2 que você deixou em "não sei"               │
│    1  não dá para importar                                       │
│       linha 18 · Rômulo Jordão · +351 931 186 300 → Portugal     │
│                                                                  │
│                    [  Gravar 16 fichas  ]                        │
└──────────────────────────────────────────────────────────────────┘
```

### A tela, depois de gravar

```
┌──────────────────────────────────────────────────────────────────┐
│  Pronto.                                                         │
│                                                                  │
│  16 fichas criadas                              [ Ver no funil ] │
│     Fotografia e vídeo · etapa Primeiro contato · com você       │
│                                                                  │
│   3 para decidir                               [ Abrir a fila ]  │
│     Show Fotografias Escritório — mesmo site da linha 3          │
│     (keepo.io/showfotografias). Juntar ou são duas unidades?     │
│     PICMIMOS e Fabio Carneiro — você deixou para depois.         │
│                                                                  │
│   1 para corrigir no arquivo                                     │
│     linha 18 · Rômulo Jordão, fotógrafo em Lisboa · telefone     │
│     de Portugal. Sem telefone, sem @ e sem CNPJ não há contato.  │
│                                                                  │
│   4 nomes de categoria aprendidos: Estúdio fotográfico,          │
│   Impressões fotográficas, Estúdio de fotografia, Loja de        │
│   artigos para fotografia. Na próxima lista eu não pergunto.     │
│                                                                  │
│   Desfazer este lote · faltam 47 h 52 min                        │
└──────────────────────────────────────────────────────────────────┘
```

---

### O que muda, com nome

| Arquivo / função | Mudança |
|---|---|
| `apps/web/src/components/importacao/origem-detectada.ts` | **novo** — `detectarOrigem(cabecalho, origens)`: `cid` + (`plus_code` \| `data_id`) → `google_maps_raspado` |
| `…/importacao/tela-importacao.tsx:86` | sai `origens.find((o) => o.slug === 'planilha')`; a origem é detectada depois de ler o arquivo |
| `…/importacao/tela-importacao.tsx:47` | `Etapa` cai de 4 para 3 valores; `'mapa'` só existe quando há dúvida |
| `…/importacao/seletor-de-origem.tsx` | deixa de ser bloco fixo; vira o `[não é?]` da linha do arquivo |
| `…/importacao/passo-mapa.tsx:118` | grade de 36 `<Select>` → resumo do que foi lido + só as colunas em dúvida; a grade vai para `<details>` |
| `…/importacao/tipos.ts` (`ROTULO_EXTRA`) | `place_id` → "ID do lugar no Maps (cid)" |
| `…/importacao/resolver-categorias.tsx` | **novo** — a tabela de nomes novos, com os nomes das empresas |
| `public.importacao_previa` | devolve `categorias_novas` agrupado, com exemplos e sugestão por radical |
| `public.importacao_previa` (`20260924130000:585-597`) | acrescenta `'website'` ao objeto de `app.find_org_matches` |
| `app.importacao_categoria` (`20260904001820:146`) | ganha o passo por radical de palavra |
| `public.importacao_mapear_categorias(int, jsonb)` | **nova** — grava em `source_category_map`, audita, `can_write()` |
| `20260924130000:317` e `:749` | `lower(trim(...))` → `app.chave_catalogo()` **nos dois lados**, com chaves regravadas e índice único (ver §2 a.0) |
| `app.resolver_source_record` (`:899-903`) | não casar por telefone quando os dois `place_id` existem e diferem |
| `app.is_shared_web_host` (`20260904000100:320-324`) | entra `keepo.io` (e `bio.link`, `campsite.bio`) |
| `public.radar_fila` | `drop` e recria com `categoria_na_fonte`, por `lateral … order by sr.last_seen_at desc limit 1` |
| `…/revisao/cartao-candidato.tsx:163` | "Sem categoria" → "Sem categoria · o Google chamou de …" |
| `public.radar_revisar_lote(uuid[], int)` | **nova** — laço sobre `public.radar_revisar_candidato(…, 'aprovar', …)`; teto de 200 |
| `…/revisao/tela-revisao.tsx`, `barra-fila.tsx` | seleção múltipla e barra de ação em lote |

Testes: Vitest para `detectarOrigem` contra os dois CSVs de `listas/`; pgTAP para o mapa com acento (`fotógrafo` e `fotografo` casando a mesma categoria, e só uma linha no mapa), para a trava do `place_id` divergente, para a prévia e a gravação concordarem quando o domínio é a única chave, e para `radar_revisar_lote` recusando um candidato suprimido no meio do lote.

---

## 2. A categoria resolve sozinha

A categoria é a única coisa que decide se a linha vira ficha ou vira trabalho. E ela é decidida por uma tabela de 12 nomes escrita à mão contra um vocabulário que não é nosso. O Google não vai aprender a falar KOMUNE. O CRM tem que aprender a falar Google.

Não é ideia nova: **RF-RAD-06** já pede isso — "mapeamento de categoria de origem (…tipo do Places…) para a taxonomia KOMUNE, com voto ponderado entre fontes e revisão humana quando empatar" (PRD linha 278). Quatro camadas, da mais barata para a mais cara.

### (a.0) Antes do de-para: o mapa casa string crua

A busca é `m.category_source = lower(trim(...))` — sem `unaccent`, sem tirar pontuação. Nos dois leitores **vivos**, os dois na mesma migração: `20260924130000:317` (`app.importacao_normalizar`) e `20260924130000:749` (`public.esteira_processar_captura`, reescrita ali). A cópia em `20260904001600:1909` está morta; citar a antiga leva alguém a consertar o arquivo errado.

`"Salao de festas"` sem til não casaria com a chave `'salão de festas'`. Não aconteceu hoje por sorte.

O CRM já tem a função certa: `app.chave_catalogo()` (`20260904001820:71`) — sem acento, sem caixa, sem pontuação, e `immutable`, então serve de índice. Mas **trocar só um lado quebra o mapa inteiro**: as chaves estão gravadas em minúscula *com* acento, de propósito, e a própria migração diz por quê (`20260924130000`, bloco 7). `chave_catalogo('fotógrafo')` devolve `fotografo`, que não é igual a `fotógrafo`. Os 10 fotógrafos e os 3 salões parariam de casar.

A troca é em três lugares:
- as duas leituras comparam `app.chave_catalogo(m.category_source) = app.chave_catalogo(<categoria da linha>)`;
- as chaves gravadas são regravadas pela mesma função — na migração, na `supabase/seed.sql` (bloco 3b) e no bloco 7 da `20260924130000`;
- índice **único** sobre a chave normalizada:

```sql
create unique index on public.source_category_map
  (source_id, app.chave_catalogo(category_source));
```

A PK é `(source_id, category_source)` sobre o texto cru (`20260904001600:1858-1863`) e continua aceitando `'salão'` e `'salao'` como duas linhas. O risco não é colisão de PK: é o `limit 1` escolher entre as duas **sem critério**, e a mesma lista cair em categorias diferentes em duas importações. O índice único recusa a segunda grafia na escrita.

Custo: três linhas. Ganho hoje: zero. Ganho daqui pra frente: um til nunca mais manda 6 linhas para a fila.

### (a) Ampliar o mapa: o de-para dos 16 nomes

Contei nome por nome nos dois CSVs. Os slugs existem todos em `supabase/seed.sql:69-94`.

| Nome do Maps | Categoria do CRM (slug) | Linhas | Por quê |
|---|---|---|---|
| `fotógrafo` | `fotografia_video` | 10 | já está no mapa |
| `salão de festas` | `locais_saloes_chacaras_hoteis` | 3 | já está no mapa |
| `serviço de fotografia` | `fotografia_video` | 1 | já está no mapa |
| `buffet infantil` | `buffet_infantil_casa_de_festas` | **6** | é o nome da categoria, outra ordem de palavras |
| `buffet de casamento` | `buffet_adulto_corporativo` | **4** | casamento é buffet adulto; nunca infantil |
| `serviço de catering` | `buffet_adulto_corporativo` | **3** | catering é buffet que vai até o evento |
| `estúdio fotográfico` | `fotografia_video` | **2** | sinônimo puro de fotógrafo |
| `estúdio de fotografia` | `fotografia_video` | **1** | idem — o Maps usa as duas grafias |
| `local para eventos` | `locais_saloes_chacaras_hoteis` | **1** | o mapa já tem `espaço para eventos` |

**14 linhas hoje → 31 com categoria.** Seis chaves novas.

**Onde escrever: em dois lugares, e não é redundância.** Num `supabase db reset` as migrações rodam **antes** de `seed.sql`, e o `insert` da migração casa zero linhas em silêncio — o tropeço que os próprios comentários documentam (`20260924130000:905-915` e `seed.sql:278-287`). A migração atende produção; a seed atende local e CI. As duas listas têm que sair iguais.

Os que **não** mapearia:

| Nome do Maps | Linhas | Por que fica de fora |
|---|---|---|
| `impressões fotográficas` | 2 | laboratório de revelação: "PROALBUNS", "Fotografe Mais CCAB SUL" |
| `loja de artigos para fotografia` | 2 | é loja de câmera — **mas** as linhas são "Viva Arte em Fotografia" e "Paparazzi Fotografia". O Google errou o rótulo; quem salva é o **nome** |
| `loja de presentes` | 1 | varejo. "PICMIMOS — Revelação de Fotos" |
| `restaurante self-service` | 1 | almoço a quilo — **mas** a linha é "Recreio Festas Infantis e Buffet" |
| `companhia de produção de filmes…` | 1 | cabe em dois destinos = chute. A linha é "Fabio Carneiro Fotografia" |
| `serviços para festas infantis` | 1 | cabe em três destinos |
| `centro de diversões infantil` | 1 | a linha é **"Brincar no Quintal \| Contraturno Escolar"** — escola de meio período |

**Ficha errada custa mais que fila:** alguém vai mandar mensagem para ela.

### (b) A queda difusa: medida, e ela não serve

Refiz a conta com a regra do `pg_trgm` sobre `app.chave_catalogo`:

| Nome do Maps | Melhor categoria | `similarity` |
|---|---|---|
| Buffet infantil | Buffet infantil / casa de festas infantil | **0,516** |
| Estúdio de fotografia | Fotografia e vídeo | 0,414 |
| Fotógrafo | Fotografia e vídeo | **0,381** |
| **Buffet de casamento** | **Buffet infantil / casa de festas infantil** | **0,378** ← errado |
| Serviço de fotografia | Fotografia e vídeo | 0,367 |
| Estúdio fotográfico | Fotografia e vídeo | 0,345 |
| os outros 10 | — | 0,109 a 0,298 |

Com o limiar de hoje (0,55, `20260904001820:168`), nenhum dos 16 casa. A resposta certa de "Buffet de casamento" pontua **0,243** — abaixo da errada: o trigrama premia "infantil", que aparece duas vezes no nome comprido da categoria, e ignora "casamento", que é a única palavra que decide.

**Não mexer no limiar.** (1) Baixar para 0,50 captura só "Buffet infantil", que a camada (a) já resolve — e o mapa é consultado **antes** da queda difusa (`20260924130000:311-324`): seriam as mesmas 6 linhas contadas duas vezes. (2) Quando a queda difusa acerta, ela devolve `aproximado: true`, que só acrescenta o aviso `categoria_aproximada` (`:328`) e a linha **entra como parceiro**. Afrouxar não enche a fila: cria ficha em cima de palpite — o custo que a camada (a) recusa pagar.

A queda difusa continua servindo bem ao vocabulário da planilha, que é o nosso catálogo colado de volta (`"Buffet adulto / corporativo"` → 1,000). Contra o Google ela não tem o que fazer. Deixa como está.

### (c) A IA categorizando — ela já responde isso, e a gente joga fora

O prompt `triagem-do-radar@v1` já roda sobre esta fila, já recebe as 19 categorias e já devolve **`categoriaSugerida`**, com a regra no sistema: *"só pode ser uma das categorias que vieram na lista, ou nulo"* (`packages/prompts/src/prompts/triagem-do-radar/v1.ts:91` e `:112`). O worker repassa o objeto inteiro (`apps/workers/src/ia/tarefas.ts:1024-1028` → `banco.ts:820-828`). E `public.ia_gravar_triagem` grava veredito, porquê e confiança e **descarta `categoriaSugerida`** (`20260917230000:128-131`). Só a categoria morre no caminho.

Três correções pequenas:

1. `app.ia_candidatos_para_triar` manda `'categoriaDaFonte', null` fixo (`20260917230000:78`). Trocar por `left join public.source_record sr on sr.source_id = c.source_id and sr.external_id = c.external_id` e mandar `sr.category_source` — mesma chave pela qual o candidato é encontrado (`20260904001600:887-890`).
2. Coluna `ia_categoria_id int references public.categories(id)`; `ia_gravar_triagem` casa o nome devolvido contra `public.categories` por `app.chave_catalogo` — **só o que casar exato**.
3. Coluna `ia_run_id bigint references public.ai_runs(id)` (`ai_runs.id` é `bigserial`, `20260905000200:168`), para a ficha responder quem disse, com que modelo, quando e por quanto.

**E três travas sem as quais isto não roda:**

- **Uma vez por dia, 20 por vez.** `radar_triar_com_ia()` enfileira com a chave `'triar:' || <data>` e limite 20 (`20260917230300:44-46`). Não são "8 lotes": são **8 dias**, e a segunda importação do dia enfileira nada, em silêncio. A chave tem que ser do **lote** (`'triar:lote:' || p_batch_id`), e a função enfileirar quantas rodadas o lote pedir.
- **Quem já foi lido nunca volta.** `app.ia_candidatos_para_triar` só devolve `ia_analisado_em is null` (`20260917230000:89`) — de propósito, para não pagar duas vezes. Os 155 de hoje que já passaram pela triagem antiga (com `categoriaDaFonte` nulo) não voltam. Para alcançá-los é preciso limpar `ia_analisado_em` uma vez, com registro em `audit_log`, e pagar uma segunda chamada por candidato.
- **O único exemplo do prompt ensina a resposta errada.** As saídas de exemplo devolvem `categoriaSugerida: 'Locais'` e `'Alimentos e Bebidas'` (`v1.ts:211`, `:218`). São nomes de **grupo**, não de categoria — as reais são "Locais: salões, chácaras, hotéis, restaurantes, praia" e "Buffet adulto/corporativo" (`seed.sql:71-94`). Com a regra "só entra o que casar exato", o exemplo treina o modelo a produzir string que nunca casa. Isso é prompt **@v2 com eval**, não ajuste de coluna.

**Custo**, com `public.ai_model_prices` (Haiku 4.5, US$ 1,00/5,00 por milhão, `20260905000200:98-100`):

| | |
|---|---|
| lote de 20 candidatos | ~1.580 tokens entrada, ~1.250 saída → **US$ 0,00783** |
| por candidato | **US$ 0,00039** — R$ 0,002 |
| os 155 da fila hoje | **US$ 0,063** |

Orçamento do mês: US$ 60, alerta em 80% (`20260925150000:74-75`). Não é decisão de custo. Duas ressalvas: **a metade da Batch API não existe hoje** — `app.ai_custo` sabe cobrar metade e `FATOR_BATCH` está em `packages/prompts/src/nucleo/custos.ts:34`, mas não há nenhuma chamada à API de lotes em `apps/workers/src`. E **o freio de 80% derruba a triagem**: acima de US$ 48 só passam `classify_inbound` e `transcribe_audio` (`20260925150000:252-256`). Se o disparo pós-importação cair nesse degrau, ele não roda — e a tela tem que dizer isso em vez de ficar quieta.

**Onde entra:** depois da importação, nunca dentro. `importacao_gravar` roda em transação e não pode depender da API da Anthropic nem do freio. Se a IA cair, a importação continua como hoje.

**Quando ela erra, nada escreve ficha sozinho** — o requisito é **RF-RAD-11** (fila de revisão humana; PRD linha 285). A sugestão chega **pré-preenchida no diálogo**, e o encaixe já existe: `dialogo-decisao.tsx:89` inicializa o seletor com `candidato.categoria_id`. O trabalho humano sai de *escolher entre 19* e vira *confirmar ou trocar*.

**O que a IA compra, nas 40 linhas reais.** Das 9 que o de-para deixa sem categoria, o nome resolve 5 e condena 4:

| Linha | Rótulo do Google | O nome diz |
|---|---|---|
| Viva Arte em Fotografia | Loja de artigos para fotografia | Fotografia e vídeo |
| Paparazzi Fotografia | Loja de artigos para fotografia | Fotografia e vídeo |
| Fabio Carneiro Fotografia | Companhia de produção de filmes | Fotografia e vídeo |
| Luz da Festa Kids | Serviços para festas infantis | Buffet infantil / casa de festas |
| Recreio Festas Infantis e Buffet | Restaurante self-service | Buffet infantil / casa de festas |
| PICMIMOS — Revelação de Fotos | Loja de Presentes | **não** |
| PROALBUNS — Álbuns Personalizados | Impressões fotográficas | **não / incerto** |
| Fotografe Mais CCAB SUL | Impressões fotográficas | **incerto** |
| Brincar no Quintal \| Contraturno Escolar | Centro de diversões infantil | **não** |

### (d) O aprendizado: escolher à mão uma vez, nunca mais

Quando alguém escolhe a categoria na fila, o CRM sabe três coisas: a fonte, o texto que a fonte usou (`source_record.category_source`) e a categoria escolhida. É uma linha de `source_category_map` pronta, e hoje é jogada fora.

Não escrever direto no mapa. Propor:

```sql
create table public.source_category_proposta (
  source_id       int  not null references public.sources(id) on delete cascade,
  category_source text not null,
  category_id     int  not null references public.categories(id),
  vezes           int  not null default 0,
  quem            uuid[] not null default '{}',
  primeira_em     timestamptz not null default now(),
  ultima_em       timestamptz not null default now(),
  virou_regra_em  timestamptz,
  primary key (source_id, category_source, category_id)
);
```

E `source_category_map` ganha proveniência: `origem text not null default 'semeado' check (origem in ('semeado','aprendido'))`, mais `aprendido_por` e `aprendido_em`.

**Onde dispara:** dentro de `public.radar_revisar_candidato` (`20260909150000:61-65`, que já recebe `p_category_id`), no caminho `aprovar`, depois de `app.promover_candidato` voltar ok — **não** num gatilho de tabela. `promover_candidato` também é chamada pela importação (`20260904001820:936`), onde a categoria veio do mapa; ali não há nada para aprender. Só se aprende onde **uma pessoa escolheu**.

**Cinco freios contra erro humano virando regra permanente:**
1. **Nunca no primeiro clique.** Vira regra com `vezes >= 3`, ou `vezes >= 2` vindo de duas pessoas diferentes.
2. **Discordância congela.** Proposta concorrente para a mesma chave: nada promove, vai para uma tela de admin e um humano desempata. É o "revisão humana quando empatar" do RF-RAD-06.
3. **Vale só para frente.** A regra nova não reescreve ficha já criada.
4. **Uma tela e um desfazer.** Lista das regras aprendidas com quem, quando e quantas vezes, e um botão que remove — mostrando quantas fichas aquela regra criou.
5. **`audit_log` em toda promoção.** É decisão de curadoria.

**O atalho que resolve a fila de hoje.** No diálogo de aprovação, abaixo da categoria:

> ☐ Valer para os outros **5** que também vieram como "Buffet infantil" do Google Maps

Marcar aplica a categoria aos que estão na fila **e** escreve a regra na hora, pulando o contador — consentimento explícito vale mais que contagem. Desmarcada por padrão. Duas condições: o número vem de um `count` real (no lote de hoje "Buffet infantil" tem 6 linhas, logo "os outros 5"), e o `category_source` **não está em `supplier_candidates`** — mora em `source_record`. A fila precisa da mesma junção `(source_id, external_id)` da camada (c). É uma junção, escrita uma vez, usada em dois lugares.

### (e) O que sobra sem categoria depois de tudo isso

Primeiro, o que **não** proponho: afrouxar a categoria obrigatória. `app.promover_candidato` deriva o `org_kind` do **grupo** da categoria (`20260905000100_dreno_reconfere.sql:470-480`) — é isso que decide se o negócio nasce no funil de fornecedor, de espaço, de produtor ou de cerimonialista. Sem categoria não há funil, e sem funil a meta e o relatório de déficit não têm em que agrupar. Uma categoria "Outros" guarda-chuva envenenaria em silêncio justamente o relatório que existe para dizer qual categoria falta em Natal. O que muda não é a exigência: é **quem responde**.

Para o que ainda sobra:

1. **A fila passa a ser agrupada por `category_source`.** "Impressões fotográficas · 2 itens", decide uma vez. Já está escrito no RF-RAD-11 e nunca foi implementado.
2. **O cartão diz por que está ali.** O motivo `categoria_desconhecida` existe — `importacao_previa` (`20260924130000:656`) e `importacao_gravar` (`20260904001820:934`) o escrevem, e a web já tem a frase (`importacao/tipos.ts:306`). O que falta é o motivo **na linha do candidato**: `review_reason` só é preenchido na recusa. O motivo morre no recibo e nunca chega ao cartão. Conserto: uma coluna, e a tela escreve *"O Google chamou isto de 'Impressões fotográficas'. Não temos essa categoria."*
3. **A fila ganha prazo — e não é `'descartado'`.** Esse status não existe: `app.candidate_status` é `('novo','aprovado','recusado','mesclado')` (`20260904001401:56`), e `radar_revisar_candidato` recusa quem não está em `'novo'` (`20260909150000:88-90`) — quem fosse descartado nunca mais poderia ser revisto. O caminho que já existe é `recusado` com `review_reason`, que a constraint exige e o `audit_log` registra. O relógio é o do PRD §10.6 **"Lead coletado, nunca contatado — 90 dias"**, repetido no RF-RAD-15.
4. **A importação para de mentir na hora.** "0 fichas · 19 vai para revisão" não pode ser o recibo. Tem que ser "19 linhas pararam porque o Google chamou de *Estúdio fotográfico* e a gente não tem esse nome — resolver agora?", com o botão do de-para ali mesmo.

### O placar das 40 linhas

| | hoje (medido) | + mapa (a) | + IA (c) + aprendizado (d) |
|---|---|---|---|
| linhas com categoria resolvida | 3 · **14 se a origem estivesse certa** | **31** | **36** |
| nomes distintos a decidir na fila | 13 | **7** | **~4** |
| gestos humanos | 27 cartões × (abrir + escolher entre 19 + confirmar) ≈ **81** | 7 decisões de grupo | ~4 confirmações |
| fichas criadas | 3 | **entre 20 e 24** | **+4 a 5** |

A faixa é faixa de propósito: as 9 duplicatas do lote de buffet e o erro do lote de fotógrafos caem dentro dela, e o número exato sai de rodar a prévia com o mapa novo — não de estimativa. As linhas que nunca entram continuam de fora, e está certo: o fotógrafo de Lisboa e os duplicados. Nenhuma tem a ver com categoria.

---

## 3. Os textos da tela

Você perguntou "escolha de onde vem (?)" diante de um menu de **dois itens**. Não foi desatenção: nenhuma palavra da tela liga aquela escolha ao resultado. Reli os textos do caminho, arquivo por arquivo. Três coisas se repetem: o texto descreve o mecanismo e não a consequência; **quatro textos mentem**; e **dois nomes internos chegam à tela de verdade**.

### 3.1 As quatro promessas que o código não cumpre

**(1) O aviso que você leu quando 0 entraram.** `tela-importacao.tsx:251-256`

```ts
const criadas = resultado.contagem.entra ?? 0;
if (criadas === 0) {
  toast.info('Nada novo entrou: essas linhas já estavam na base.');
}
```

O `if` é só `contagem.entra === 0`. No lote dos fotógrafos **nenhuma** era duplicata: 19 pararam por categoria e 1 deu erro. A tela afirmou o contrário do que tinha acabado de acontecer. O comentário acima (`:253-255`) prevê um caso e escreve a frase dele para todos.

**(2) A explicação do grupo "vai para revisão" cita um motivo que esse grupo nunca tem.** `importacao/tipos.ts:289-290`: *"…ou o nome se parece com uma ficha existente."* A prévia tem exatamente dois caminhos para `revisao`: `categoria_desconhecida` (`20260924130000:654-656`) e `origem_desconhecida` (`:657-659`). Nome parecido cai em `duplicata`, no `elsif` de cima. O motivo `parecida_com_ficha` (`tipos.ts:305`) é código morto.

**(3) "com a etapa e o responsável da planilha".** `tipos.ts:286`. O CSV do Maps não tem nem etapa nem responsável. `app.promover_candidato` nasce com `v_owner := coalesce(p_owner_id, auth.uid())` (`20260905000100:425`) e com a primeira etapa do funil (`:514-518`). Quem importou vira o dono.

**(4) "o número entra na lista de supressão" — não entra.** `tipos.ts:291-292`. É ao contrário: a linha cai em `nao_contatar` porque `v_cand.do_not_contact` **já era** verdadeiro (`20260904001820:920-921`), e isso só acontece se o telefone já estava suprimido (o gatilho consulta `app.is_suppressed` antes de gravar, `20260904001600:828-830`). **Importar nunca põe ninguém na lista de supressão.** Lida por um gestor, essa frase faz ele achar que a importação sozinha resolve opt-out.

### 3.2 Os dois nomes internos que aparecem na tela

**`ja_existe_na_base`, escrito assim, no cartão.** `cartao-candidato.tsx:284-285` renderiza `{nota?.rotulo ?? marca}`. A flag é gravada em `supplier_candidates.flags` (`20260904001600:997`) e **não existe** em `EXPLICACAO_DA_MARCA` (`revisao/tipos.ts:175-210`, **sete** chaves). Resultado literal:

> ⚠ **ja_existe_na_base** Confira este dado antes de decidir.

São as 9 duplicatas do buffet. E são elas que inflam o "Só os marcados (155)": o filtro é `cardinality(c.flags) > 0` (`20260917230100:39`), sem distinguir "dado suspeito" de "já está na base".

**Mesmo fallback na prévia:** `textoDoAviso` faz `AVISO[aviso] ?? aviso` (`importacao/tipos.ts:345-346`) e `textoDoMotivo` devolve `null` para motivo sem tradução (`:340-343`) — aviso novo vira código na tela, motivo novo vira silêncio.

### 3.3 O glossário: o que morre

| Palavra de hoje | Onde | Vira |
|---|---|---|
| esteira | `tela-importacao.tsx:428`, `importacao/tipos.ts:311,312,318,319`, `revisao/estados.tsx:58-60` | some |
| candidato | `tela-revisao.tsx:174-186,237`, `cartao-candidato.tsx`, `dialogo-decisao.tsx:112-122` | **nome** ("19 nomes esperando") |
| ficha | `importacao/tipos.ts:286,288,290,304,305,314,333,334`, `tela-importacao.tsx:550,607`, `recibo.tsx` | **parceiro** |
| lote | `recibo.tsx:70,122,136`, `tela-importacao.tsx:593-595`, `dados.ts:157,167,338-341` | **esta importação** / o nome do arquivo |
| proveniência / origem do lote | `seletor-de-origem.tsx:14,40` | **de onde veio** (na frase, não como rótulo) |
| alvo | `revisao/dados.ts:203,208`, `revisao/tipos.ts:203`, `importacao/tipos.ts:292` | **nome** ou **empresa** |
| Radar | `activities.body` = "Aprovado na fila do Radar por X" | **Revisão** — o módulo mudou de nome em 25/09 e o histórico da ficha não |

### 3.4 ANTES → DEPOIS

#### A tela de importar

| Arquivo · linha | ANTES | DEPOIS |
|---|---|---|
| `importar/page.tsx:13` + `tela-importacao.tsx:426` | Importar planilha | **Trazer uma lista para a base** |
| `tela-importacao.tsx:427-430` | "A planilha vira ficha pela mesma esteira da Revisão…" | **"Você vê tudo antes de gravar, e nada que já está na base é sobrescrito."** |
| `seletor-de-origem.tsx:39-41` | De onde veio esta lista | **Que arquivo é este?** |
| `seletor-de-origem.tsx:63-67` | "Cada linha entra como *X*…" | **"É por aqui que o CRM traduz as categorias do arquivo — e é o que ele responde se alguém perguntar de onde saiu o número dele. Marcar errado manda a lista inteira para a fila."** |
| `seletor-de-origem.tsx:56-60` | "O arquivo tem uma coluna de origem: ela manda em cada linha." | **"Este arquivo já diz, linha a linha, de onde veio cada nome. O CRM usa o que está no arquivo."** |
| `seed.sql:166` (precisa de migração) | Planilha (importação) | **Planilha nossa (modelo da Komune)** |
| `20260924130000:875` (idem) | Google Maps (raspagem local) | **Lista puxada do Google Maps** |
| `passo-arquivo.tsx:78-79` | "…a planilha-ponte do Dia 0 entra sem ajuste nenhum…" | **"Aceita .xlsx e .csv. O CRM tenta entender as colunas sozinho e mostra o que entendeu antes de gravar qualquer coisa."** |
| `passo-mapa.tsx:83` | O que é cada coluna | **O CRM entendeu {n} das {total} colunas** (`porColuna.size` e `planilha.cabecalho.length`, já existem em `:60-64,88`) |
| `passo-mapa.tsx:110-115` | Tudo que é obrigatório está indicado | **Pode seguir** |
| `passo-mapa.tsx:105-109` | Falta indicar: {pendentes} | **Sem {pendentes} o CRM não consegue criar o parceiro. Indique {pendentes} para seguir.** — de `pendentes.map(rotuloDoCampo)`, **não** frase fixa |
| `passo-mapa.tsx:160` | Não importar esta coluna | **O CRM não usa esta coluna** |
| `passo-mapa.tsx:145-148` | Confira | **Chutei — confira** |
| `passo-mapa.tsx:142` | Sem exemplos nesta coluna | **Esta coluna está vazia no arquivo** |
| `tela-importacao.tsx:360` | Conferir antes de gravar | **Ver o que vai acontecer** |
| `tela-importacao.tsx:211,233` | Conferindo contra a base / Gravando | **Vendo quem já está na base** / **Criando os parceiros** |

> Os obrigatórios são três — `nome`, `categoria`, `origem` (`importacao/tipos.ts:77`) —, e `origem` sai da conta quando o seletor está preenchido (`mapeamento.ts:140-144`). No CSV do Maps `title`→nome e `category`→categoria casam por nome exato: esse aviso **nunca aparece nesse arquivo**. Escrever os nomes numa frase fixa seria inventar um caso.

#### Os números da prévia (`importacao/tipos.ts:275-296`)

| Linha | ANTES | DEPOIS |
|---|---|---|
| `:276` / `:286` | Entra na base · "…com a etapa e o responsável da planilha." | **viram parceiro** · "Entram na base e no funil, na primeira etapa, com você como responsável. Se o arquivo trouxer etapa ou responsável, vale o que está nele." |
| `:277` / `:287-288` | Já existe · "…vira candidato na fila de Revisão…" | **já estão na base** · "Nada é sobrescrito. Cada uma para na fila, com o parceiro parecido já apontado, para você juntar os dois ou descartar." |
| `:278` / `:289-290` | Vai para revisão · "…ou o nome se parece com uma ficha existente." | **param na fila** · frase montada dos motivos que caíram no grupo: com `categoria_desconhecida`, "O CRM não reconheceu a categoria que veio no arquivo. Você escolhe a categoria na fila e elas viram parceiro." |
| `:279` / `:291-292` | Não contatar · "…o número entra na lista de supressão…" | **já pediram para não receber** · "Essas empresas já tinham pedido para parar. Não entram, e ninguém volta a escrever." |
| `:280` / `:293-294` | Já importado antes | **já tinham entrado** · "Vieram numa importação anterior, ou repetidas dentro deste mesmo arquivo. Nada é criado de novo." |
| `:281` / `:295` | Não dá para importar | **não entram** · "Sem nome, ou sem telefone, @ e CNPJ: não há como falar com essa empresa. Corrija no arquivo e mande de novo." |

#### A linha de baixo e o recibo

| Arquivo · linha | ANTES | DEPOIS |
|---|---|---|
| `tela-importacao.tsx:394-397` | Gravar 40 linhas | **Gravar estas 40 linhas** (o botão conta linhas — ver 3.5) |
| `tela-importacao.tsx:398-401` | "12 viram ficha agora; o resto vai para a fila…" | **"12 viram parceiro agora. As outras 28 não somem: 19 param na fila esperando categoria, 8 param na fila porque já estão na base e 1 não entra."** — montada de `previa.contagem` |
| `tela-importacao.tsx:251-259` | "Nada novo entrou: essas linhas já estavam na base." | **o `if` passa a olhar o maior grupo:** com `duplicata` no topo, "Nada novo entrou — essas 20 já estavam na base."; com `revisao`, "Nenhuma virou parceiro ainda: as 19 pararam na fila esperando categoria."; com `erro`, "Nenhuma entrou: 20 linhas sem nome ou sem contato." |
| `tela-importacao.tsx:258` | 12 fichas criadas. | **12 viraram parceiro.** |
| `recibo.tsx:68` | Importação concluída | **Pronto: 12 viraram parceiro** — e, com zero, **"Pronto — nenhuma virou parceiro ainda"** |
| `recibo.tsx:69-77` | "Lote *arquivo.csv* · dá para desfazer até 27/09 14:10" | **"De *arquivo.csv* · dá para desfazer até 27/09, 14h10"** |
| `recibo.tsx:104` | Decidir as 19 que ficaram na fila | **Escolher a categoria das 19 que pararam na fila** |
| `recibo.tsx:111` / `:122` | Importar outra planilha / Desfazer este lote | **Trazer outra lista** / **Desfazer esta importação** |
| `recibo.tsx:130-132` | "O desfazer remove só o que este lote criou…" | **"Desfazer tira só os parceiros que esta importação criou e ninguém tocou depois. Quem já tem conversa, mudança de etapa, autorização ou ligação fica de pé — o CRM diz quantos."** |
| `tela-importacao.tsx:525` | Importações anteriores | **O que você já trouxe** |
| `tela-importacao.tsx:548-559` | "0 fichas · 19 vai para revisão" | **"0 viraram parceiro · 19 pararam na fila"** — são **duas** edições: "vai para revisão" vem de `ROTULO_DECISAO` (`tipos.ts:278`), mas "ficha/fichas" está escrito à mão em `tela-importacao.tsx:550` e `:607` |
| `estados.tsx:51-53` | "O CRM sugere o que é cada coluna…" | **"O CRM lê as colunas sozinho e mostra o que vai acontecer com cada linha. Nada é gravado antes de você mandar."** |
| `tela-importacao.tsx:291-293` | "O seu acesso não importa planilha…" | **"O seu acesso não traz listas para a base" / "Quem traz gente de fora para dentro da base é gestor ou SDR." / "Fale com um gestor se você precisa disso."** |

#### A fila

| Arquivo · linha | ANTES | DEPOIS |
|---|---|---|
| `revisao/page.tsx:8`, `navegacao.ts:299`, `tela-revisao.tsx:174` | Revisão | **Fila** |
| `tela-revisao.tsx:183-186` | 155 candidatos esperando revisão | **155 nomes esperando você** |
| `tela-revisao.tsx:181` | Nenhum candidato esperando revisão. | **Nada esperando. Tudo que entrou já foi decidido.** |
| `tela-revisao.tsx:237` | Nenhum candidato em "aprovados". | **Nenhum nome em "aprovados".** |
| `revisao/tipos.ts:167` | Esperando revisão | **Esperando você** |
| `barra-fila.tsx:103-105` | Só os marcados (155) | **Só os que têm um problema (155)** |
| `cartao-candidato.tsx:163` | Sem categoria | **Escolha a categoria** (é a ação, não o estado) |
| `cartao-candidato.tsx:284-285` | **ja_existe_na_base** · "Confira este dado antes de decidir." | **"Já está na base"** · "Um parceiro parecido já existe. Junte os dois em vez de criar um repetido." *(entrada nova em `EXPLICACAO_DA_MARCA`)* |
| `cartao-candidato.tsx:300-303` | Uma ficha da base pode ser a mesma empresa | **Pode ser um parceiro que você já tem** |
| `cartao-candidato.tsx:324` / `:342` / `:360` | Mesclar aqui / Aprovar / Não contatar | **Juntar com este** / **Virar parceiro** / **Nunca procurar** |
| `cartao-candidato.tsx:233` | Nenhum contato conhecido ainda. | **Sem telefone, @, site ou CNPJ. Virar parceiro cria a ficha, mas ninguém consegue falar com ele ainda.** |
| `cartao-candidato.tsx:364-366` | "Aprovar está bloqueado: este contato está na lista de supressão." | **"Esta empresa pediu para não ser procurada. Não dá para virar parceiro."** |
| `dialogo-decisao.tsx:112` | Aprovar candidato | **Falta a categoria** |
| `dialogo-decisao.tsx:119` | "*Nome* vira parceiro e entra no funil…" | **"O arquivo dizia *Buffet infantil*, que o CRM não conhece. Escolha a categoria e *Nome* vira parceiro, no funil, com 'Primeiro contato' no próximo dia útil."** |
| `dialogo-decisao.tsx:97` | "Escolha a categoria: é ela que decide em qual funil o negócio nasce." | **"Escolha a categoria — é ela que decide em que funil o parceiro nasce, e as metas e o relatório contam por ela."** |
| `dialogo-decisao.tsx:181` | Aprovar e criar parceiro | **Criar o parceiro** |
| `dialogo-decisao.tsx:114` / `:121` | Recusar candidato · "*Nome* sai da fila." | **Descartar este nome** · "Sai da fila. O motivo fica gravado com quem decidiu e quando." |
| `tela-revisao.tsx:128-129` | "Aprovado: virou parceiro." | **"*Nome* virou parceiro."** |
| `revisao/estados.tsx:56-60` | "…a fila enche quando alguém importa uma lista e a esteira não resolve…" | **"Fila vazia" / "Tudo que entrou já foi decidido. A fila enche quando uma lista traz um nome que o CRM não soube classificar sozinho."** |
| `revisao/dados.ts:202-203` | "A categoria deste alvo saiu de uso…" | **"A categoria deste nome saiu de uso. Peça a um administrador para reativá-la, ou descarte e cadastre à mão com outra categoria."** |
| `revisao/dados.ts:208` | "Esse alvo já está na base. Mescle…" | **"Este nome já é parceiro. Junte com o que existe."** |
| `20260905000100:559` | "Aprovado na fila do Radar por X" | **"Virou parceiro na fila, por X"** |

> Só existe **uma** função viva escrevendo a linha do "Radar": `app.promover_candidato` (`20260905000100:399-583`, string em `:559`). As outras duas ocorrências são definições mortas. As linhas já gravadas pedem um `update public.activities … where metadata->>'origin' = 'radar_approve'` na mesma migração.

### 3.5 O que o texto não conserta

- **O seletor de dois itens que abre no errado** (`tela-importacao.tsx:85-87`). A melhor frase do mundo ali ainda é uma armadilha que custou 19 fichas. O conserto é o da §1 (a).
- **"param na fila" precisa ler o motivo da linha, e não virar dois grupos.** `origem_desconhecida` **existe na prévia e não existe na gravação**: `importacao_gravar` resolve a fonte com `coalesce((v_n ->> 'source_id')::int, v_b.source_id)` (`20260904001820:880-881`) e não tem esse ramo — a linha que a prévia manda para a fila por origem vira parceiro ao gravar. Criar um grupo na tela para um desfecho que a gravação nunca produz é assinar uma terceira mentira. O certo é a frase se montar dos `motivo` que caíram no grupo (`20260924130000:670`) e, em separado, alinhar os dois `if`.
- **O botão não pode prometer menos do que a ação faz.** "12 viram parceiro" sugere que só 12 linhas são escritas. São 40: cada linha vira `raw_capture` → `source_record` → `supplier_candidates` (`20260904001820:876-885`). É essa escrita que sustenta o ADR-08. O botão conta linhas; o número de parceiros vai na frase de baixo.
- **Uma linha com e-mail e site, mas sem telefone, é jogada fora.** `20260924130000:393-396` reprova quando `v_tel`, `v_ig` e `v_cnpj` são nulos — e-mail e site não contam, embora o CSV do Maps traga as duas colunas. A frase nova é honesta com o código; o código é que está errado.

### 3.6 O que este capítulo **não** resolve

Palavra não tira clique. Para uma lista de 20 nomes que caiu inteira na fila, são os mesmos **3 cliques por nome** antes e depois — abrir a decisão, escolher a categoria, confirmar (`cartao-candidato.tsx:342` → `dialogo-decisao.tsx:130-140` → `:181`) — vezes 19. O que muda é que a pessoa entende, na prévia, que está prestes a comprar 57 cliques. Os cliques só caem com os itens de código do 3.5 e com a §2.

---

## O que ele decide

1. **Quem pode ensinar o mapa de categorias.** Hoje `source_category_map` só aceita escrita de `app.is_manager()` (`20260904001600:2306-2315`) e a Heloísa é `sdr`: ela importa, a fila enche, e ela não pode ensinar. Opções: manter em gestor · abrir para `app.can_write()` com auditoria de quem ensinou o quê. → **Recomendo `can_write()` auditado: é reversível, fica gravado, e sem isso metade da equipe não sai do lugar.**
2. **Ligar a IA para sugerir categoria.** Ela já responde e a gente descarta. Custa US$ 0,00039 por candidato (US$ 0,063 pelos 155), mas exige prompt `@v2` com eval e a limpeza auditada de `ia_analisado_em`. Opções: não ligar · ligar só para a fila nova · ligar e reprocessar os 155. → **Recomendo ligar depois que o de-para e a tela de resolver estiverem de pé; a IA é o ganho marginal, não o conserto.**
3. **Os 155 presos.** Eles morrem sozinhos em 16/12 por retenção. Opções: deixar expirar · resolver por grupo com `radar_revisar_lote` (uma tabela, ~10 min) · reprocessar com IA. → **Recomendo resolver por grupo assim que a coluna `categoria_na_fonte` existir: é lead já pago.**
4. **Renomear "Revisão" para "Fila".** É a palavra que você usou sozinho, e custa três strings. Mas desfaz um rename feito hoje (`20260925140000`) e obriga a acertar PRD §7.3, CHANGELOG e o nome da migração. Opções: manter "Revisão" · trocar para "Fila". → **Recomendo manter "Revisão" por enquanto e trocar só se a palavra continuar atrapalhando depois que a fila encolher.**

---

## Esforço e ordem

| # | O que entrega | Dias | Alívio imediato |
|---|---|---|---|
| 1 | De-para dos 16 nomes (6 chaves novas) + `chave_catalogo` nos dois lados + índice único + seed | 0,5 | **Sim** — 14 → 31 linhas com categoria, sem tela nova |
| 2 | Detecção de origem pelo cabeçalho + `[não é?]` | 0,5 | **Sim** — mata a causa que zerou o lote dos fotógrafos |
| 3 | Os textos da §3 (as 4 mentiras, `ja_existe_na_base`, glossário) | 0,5 | **Sim** — a tela para de dizer o contrário do que aconteceu |
| 4 | `radar_fila` com `categoria_na_fonte` + cartão dizendo o nome do Google | 0,5 | **Sim** — torna os 155 decidíveis |
| 5 | Recibo de leitura das colunas (36 caixinhas → `<details>`) | 0,5 | passo a menos |
| 6 | `categorias_novas` na prévia + `importacao_mapear_categorias` + `resolver-categorias.tsx` + sugestão por radical | 1,5 | o coração: O(linhas) → O(nomes novos) |
| 7 | `radar_revisar_lote` + seleção múltipla na fila | 1,0 | resolve os 155 em minutos |
| 8 | Dedup: `website` na prévia, `keepo.io` em `is_shared_web_host`, `place_id` divergente no bloco (3) | 0,5 | prévia para de mentir |
| 9 | Aprendizado (`source_category_proposta`, os 5 freios, tela de desfazer) | 1,5 | ganho composto |
| 10 | IA: junção `category_source`, `ia_categoria_id`, `ia_run_id`, chave por lote, prompt `@v2` + eval | 1,5 | ganho marginal |
| | **Total** | **8,5** | |

**A primeira leva é 1,5 dia (itens 1 a 3)** e já muda o próximo arquivo que você arrastar: origem certa sozinha, 31 das 40 linhas com categoria, e nenhum texto mentindo. O item 4 (+0,5) destrava a fila que já existe.

---

## O que NÃO vai mudar, e por quê

- **Rastreabilidade (ADR-08):** toda linha continua passando por `raw_capture → source_record → supplier_candidate`, com proveniência campo a campo — é a resposta a "de onde vocês tiraram meu número", e foi por falta dela que a CNIL multou a KASPR em €240 mil.
- **Opt-out:** `radar_revisar_lote` laça sobre `public.radar_revisar_candidato`, que mantém intacto o caminho de supressão e recusa candidato `do_not_contact`; "não contatar" e "recusar" continuam fora do lote, um a um, com motivo escrito.
- **Supressão:** `app.promover_candidato` reconfere `app.is_suppressed` a cada candidato, dentro do laço — nenhum caminho novo de escrita foi criado, e nada entra na base por baixo dela.
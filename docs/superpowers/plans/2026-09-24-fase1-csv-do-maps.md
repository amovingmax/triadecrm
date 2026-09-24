# Fase 1 — o CSV do Google Maps entra pela importação · Plano de implementação

> **Para quem executa:** use a skill superpowers:subagent-driven-development ou
> superpowers:executing-plans para implementar tarefa a tarefa. Os passos usam caixinha (`- [ ]`).

**Objetivo:** fazer o CSV raspado do Google Maps entrar pela porta de importação que já existe, sem construir caminho novo de escrita, consertando o estreitamento que jogava fora seis campos que o banco já permitia.

**Arquitetura:** o CSV entra por `/importar` e segue a esteira do ADR-08 (`raw_capture → source_record → supplier_candidate → revisão → organizations`), com prévia antes de gravar e desfazer de 48 h. O conserto é todo em Postgres — `app.importacao_normalizar` passa de 9 para 15 chaves de payload, `place_id` vira a identidade na fonte, o endereço de uma coluna só vira bairro/cidade/CEP — mais três peças finas na tela (cinco campos novos no mapa de colunas, sinônimos em inglês, seletor de origem do lote). A raspagem roda **fora** do CRM, num Docker em `127.0.0.1`, e o arquivo é subido por uma pessoa.

**Tecnologias:** Postgres 15 (plpgsql, pgTAP), Supabase CLI local, Next.js 16 + TypeScript, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-24-pivo-scraper-e-robo-autonomo-design.md` §3

---

## Restrições globais

Valem para **toda** tarefa deste plano. Nenhuma pode ser afrouxada sem parar e perguntar.

- **Todo comando roda depois de `source scripts/dev-env.sh`.** Nesta máquina o Node padrão do nvm é o 20 e o projeto exige o 22; o `docker` do OrbStack não está no PATH e o Supabase CLI não acha o daemon sem `DOCKER_HOST`. O script de 20 linhas faz as três coisas. Sem ele, `pnpm db:test` e todo `docker compose` falham por motivo que não tem nada a ver com a tarefa.
- **A whitelist do R06 SCR-01 não muda.** `app.payload_e_permitido` (`20260904001600:141`) tem 22 nomes permitidos; usamos 15 deles. `apps/workers/src/ingest/whitelist.ts` **não é tocado**. `facebook` e `linkedin` ficam de fora de propósito (§3.1). Uma chave fora da lista reprova o payload **inteiro**, não o campo.
- **ADR-08, caminho único de escrita:** `app.promover_candidato` continua sendo o único `insert` em `organizations` vindo de importação. Nenhuma tarefa cria caminho novo.
- **Sem CPF na base (ADR-09, RF-BAS-16):** `app.sem_cpf` passa a varrer `endereco` e `bairro` **antes** do payload, porque `public.esteira_gravar_captura` grava `raw_capture.payload` cru e `app.payload_e_permitido` confere nome de chave, não valor.
- **`nota` e `avaliacoes_qtd` são sinal numérico interno, nunca tela** (RF-RAD-04). `grep -rn "rating\|reviews_count" apps/web/src/components/parceiros` tem de continuar não achando nada.
- **Proveniência campo a campo** (`public.field_provenance`, R06 SCR-08) não pode ficar mais pobre do que está: é ela que responde "de onde vocês tiraram meu número?" com a URL exata.
- **Opt-out por regra antes de qualquer coisa:** telefone na `suppression_list` nunca vira alvo, em nenhum modo.
- **Migrações em `supabase/migrations/AAAAMMDDHHMMSS_nome_em_portugues.sql`**, com cabeçalho comentado explicando POR QUE, no tom dos arquivos existentes. Nada é alterado pelo dashboard.
- **Toda função do Postgres nasce ou é recriada com `set search_path` e com `revoke`/`grant` explícitos.**
- **pgTAP em `supabase/tests/NN_nome.sql`**, com `begin; select plan(N);` no topo e `select * from finish(); rollback;` no fim. Nenhuma asserção conta linha absoluta em tabela compartilhada — este banco tem operação real dentro; tudo é delta ou escopo por lote.
- **RLS:** toda tabela já nasce com RLS; nada aqui cria tabela. As funções `security definer` mantêm os `grant` que já têm.
- **Fuso `America/Fortaleza`**, telefones em **E.164**, nomes normalizados com `unaccent` + `lower` para dedup.
- **Textos de UI, comentários, nomes de variável e mensagens de commit em português do Brasil.** Commits pequenos, no imperativo, sem prefixo de tipo.
- **Ao fim de cada tarefa que muda o banco: `pnpm db:types`** (regenera `packages/schema/src/database.types.ts`).
- **`supabase/tests/22_importacao_de_planilha.sql` (plan(73)) e `supabase/tests/16_esteira_de_ingestao.sql` (plan(125)) NÃO são tocados.** Eles são a rede: se a transcrição de uma função grande perder uma linha, são eles que ficam vermelhos no mesmo `pnpm db:test`.

---

## Onde o foco da revisão precisa estar

Cinco coisas que a spec implica, que quebram calado, e que nenhuma das dez tarefas exercitava. Cada uma ganhou um teste na tarefa dona do código — a mais provável primeiro.

1. **O descarte de CPF deixa de ter registro legal.** Hoje o CPF chega ao `source_record` e o gatilho de higiene (`20260904001600:624-643`) faz três coisas: limpa, marca `cpf_descartado` em `flags` e grava `field_provenance` com `action='descartado'`, `reason='cpf'`. Com a Tarefa 2, `app.importacao_normalizar` limpa **antes** — o gatilho nunca vê o CPF, e as duas últimas somem. O §3.5 teste 14 da spec pede exatamente essa linha de `field_provenance`; ela deixa de existir. → **teste na Tarefa 2, Passo 2.4.**
2. **Uma chave fora da whitelist reprova o payload inteiro, e o erro aparece como "a importação toda falhou".** É o risco 2 da §11 e o teste 4 de §3.5. O plano afirmava que as 15 chaves passam; ninguém provava que a 16ª derruba tudo. → **teste na Tarefa 2, Passo 2.4.**
3. **Reimportar o mesmo arquivo.** É o critério de pronto 3 da §13 e o teste 6 de §3.5, e passa pelas duas funções que este plano substitui (`importacao_previa`, ramo `v_ja`; `importacao_gravar`, ramo `aprovado`). Nenhuma tarefa exercitava a segunda volta. → **teste na Tarefa 3, Passo 3.4.**
4. **A proveniência campo a campo com a URL do lugar.** Guardrail da §10 e critério de pronto 2 da §13: a ficha tem de responder `public.origem_dos_dados` com `phone_e164` **e** `place_id`, os dois com a URL do Maps. Só funciona porque `source_url` viaja dentro do payload; nenhuma tarefa provava. → **teste na Tarefa 4, Passo 4.2.**
5. **Telefone na `suppression_list`.** Guardrail de opt-out da §10 e teste 10 de §3.5: a linha tem de virar `nao_contatar` e **não abrir negócio nenhum**. → **teste na Tarefa 3, Passo 3.4.**

Dos cinco, só o (1) é vermelho→verde. Os outros quatro já passam com o código de hoje e entram como **rede de regressão**: existem para o dia em que a mudança seguinte os quebrar.

---

## Estrutura de arquivos

| Arquivo | Criado / alterado | De que é responsável |
|---|---|---|
| `supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql` | criado (T1), ampliado em T2–T5 | `app.endereco_br`; as três funções substituídas; a fonte nova, o mapa de categorias, `entrada_por_arquivo` e o índice do lugar. **Um arquivo só** |
| `supabase/tests/66_o_csv_do_maps.sql` | criado (T1), ampliado em T2–T5 | Toda a cobertura pgTAP da Fase 1. Termina em `plan(43)` |
| `supabase/seed.sql` | alterado (T5) | Espelho do mapa de categorias e do `entrada_por_arquivo`, mais a contagem na autoverificação do bloco 13 |
| `packages/schema/src/database.types.ts` | regerado (T1, T10) | Tipos do banco para web e workers |
| `apps/web/src/components/importacao/tipos.ts` | alterado (T6, T8) | `CAMPOS_EXTRAS`, `ROTULO_EXTRA`, `OrigemDeArquivo`, `ehEntradaPorArquivo` |
| `apps/web/src/components/importacao/mapeamento.ts` | alterado (T6, T8) | `SINONIMOS`, `faltando`, `linhaParaObjeto` |
| `apps/web/src/components/importacao/mapeamento.test.ts` | alterado (T6, T8) | Cabeçalho do kit, travas de regressão, injeção da origem |
| `apps/web/src/components/importacao/planilha.test.ts` | alterado (T7) | Leitura do CSV do kit contra a fixture real |
| `apps/web/src/components/importacao/fixtures/maps-natal-buffet.csv` | criado (T7) | 20 lugares fictícios no formato exato do kit |
| `apps/web/src/components/importacao/tipos.test.ts` | criado (T8) | `ehEntradaPorArquivo` |
| `apps/web/src/components/importacao/seletor-de-origem.tsx` | criado (T8) | O seletor "De onde veio esta lista" |
| `apps/web/src/components/importacao/passo-mapa.tsx` | alterado (T8) | Recebe `origemDoLote` e resolve o obrigatório `origem` |
| `apps/web/src/components/importacao/tela-importacao.tsx` | alterado (T8) | Estado da origem, injeção em `montarLinhas`, `source_id` do lote |
| `apps/web/src/app/(app)/importar/page.tsx` | alterado (T8) | Lista as fontes com `entrada_por_arquivo` |
| `infra/local/docker-compose.yml` | alterado (T9) | Perfil `maps`, porta presa em `127.0.0.1:8080` |
| `infra/local/.env.example` | alterado (T9) | `MAPS_SCRAPER_TAG`, `MAPS_SCRAPER_PORT`, `MEM_MAPS_SCRAPER` |
| `infra/local/README.md` | alterado (T9) | O passo a passo do operador |
| `docs/CHANGELOG.md` | alterado (T4, T5, T10) | Registro do que entregou, do que ficou pendente e do que é decisão humana |

**Ordem de execução:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. As tarefas 1 a 5 escrevem no **mesmo** arquivo de migração e no **mesmo** arquivo de teste, sempre acrescentando ao fim. As tarefas 3 e 4 mexem em funções **diferentes** do Postgres, mas as duas dependem de a Tarefa 2 já ter deixado `place_id` no topo do objeto devolvido por `app.importacao_normalizar`.

---

## Tarefa 1: `app.endereco_br(text)` — um endereço do Maps vira bairro, cidade e CEP

**Arquivos:** `supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql` (criado), `supabase/tests/66_o_csv_do_maps.sql` (criado), `packages/schema/src/database.types.ts` (regerado).

**Interfaces**
- *Consome:* `app.sem_cpf` como precedente de forma (`20260904001600:108`), nada mais.
- *Produz:* `app.endereco_br(t text) returns jsonb`, `language plpgsql`, `immutable`, `set search_path = ''`. Devolve `{"bairro": text|null, "cidade": text|null, "cep": text|null}`; CEP sempre `NNNNN-NNN`. `revoke all from public, anon`; `grant execute to authenticated, service_role`. E o arquivo de teste `supabase/tests/66_o_csv_do_maps.sql` em `plan(5)`.

**Contexto que você precisa saber antes de começar (leia, não adivinhe):**

- A migração desta tarefa é nova. A Tarefa 2 **acrescenta seções ao mesmo arquivo**; não crie um segundo.
- `search_path = ''` não esconde o `pg_catalog`: `regexp_matches`, `regexp_match`, `substr`, `replace`, `trim`, `string_to_array` e `position` continuam alcançáveis sem qualificar. O que precisa de prefixo é `extensions.*` (trigrama, unaccent) e `public.*` / `app.*`. Confira em `app.sem_cpf` (`supabase/migrations/20260904001600_esteira_de_ingestao.sql:108`), que é `set search_path = ''` e chama `regexp_matches` sem prefixo.
- Leia `supabase/tests/65_so_o_cumprimento.sql` inteiro antes (são 133 linhas) — é o formato mais recente.
- Para rodar os testes o Supabase local precisa estar de pé (`pnpm db:start`). Hoje existem **65** arquivos em `supabase/tests/`; o 66 é o primeiro número livre.

### Passos

- [ ] **1.1 — escrever o teste que falha.** Crie `supabase/tests/66_o_csv_do_maps.sql` com este conteúdo exato:

```sql
-- =====================================================================
-- pgTAP — O CSV do Google Maps entra pela importação (migração 20260924130000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. O ENDEREÇO NÃO É PALPITE. `app.endereco_br` lê bairro, cidade e CEP de
--      uma coluna só e devolve NULO em tudo que não casou. O Google não
--      garante formato nenhum (MEI que atende em casa, rodovia, ponto de
--      referência): bairro inventado não estraga a ficha, estraga a visita de
--      quem for até lá.
--
-- (As tarefas seguintes acrescentam a este cabeçalho os outros pontos, junto
-- com as asserções que os provam. Cabeçalho que descreve teste que não existe
-- é promessa, e este arquivo é sobre não palpitar.)
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada: este banco
-- tem operação real dentro. Tudo é delta ou escopo por lote deste arquivo.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(5);

-- =====================================================================
-- 1. O endereço numa coluna só vira três campos (§3.2 item 1)
-- =====================================================================
select is(
  app.endereco_br('Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095'),
  '{"bairro": "Capim Macio", "cidade": "Natal", "cep": "59082-095"}'::jsonb,
  'endereço completo: bairro, cidade e CEP saem os três');

select is(
  app.endereco_br('Av. Eng. Roberto Freire, Natal - RN, 59082-095'),
  '{"bairro": null, "cidade": "Natal", "cep": "59082-095"}'::jsonb,
  'sem bairro: o pedaço anterior ao da cidade não tem " - ", então bairro é nulo');

select is(
  app.endereco_br('Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN'),
  '{"bairro": "Capim Macio", "cidade": "Natal", "cep": null}'::jsonb,
  'sem CEP: os outros dois continuam saindo');

select is(
  app.endereco_br('Loja no calçadão, perto da praia'),
  '{"bairro": null, "cidade": null, "cep": null}'::jsonb,
  'endereço que não casa com nada volta todo nulo: aqui não se palpita');

select is(
  app.endereco_br('R. Pedro Velho, 500 - Petrópolis, Natal - RN, 59012310'),
  '{"bairro": "Petrópolis", "cidade": "Natal", "cep": "59012-310"}'::jsonb,
  'CEP sem hífen sai normalizado em NNNNN-NNN');

select * from finish();
rollback;
```

O `select plan(5)` cobre só esta tarefa. **A Tarefa 2 sobe esse número para `plan(23)`** — quando você chegar lá, troque o literal.

- [ ] **1.2 — rodar e ver falhar.**

```
source scripts/dev-env.sh
pnpm db:test
```

O arquivo 66 aborta inteiro com `ERROR: function app.endereco_br(unknown) does not exist`. Isso é o vermelho esperado: a função ainda não existe, então nenhuma das 5 asserções chega a rodar. Os outros 65 arquivos continuam verdes — confira que o número total não caiu além do arquivo novo.

- [ ] **1.3 — implementar o mínimo.** Crie `supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql` com este conteúdo:

```sql
-- =====================================================================
-- O CSV do Google Maps entra pela porta da planilha
--
-- Decisão do Rafael em 24/09/2026 (ADR-12): a lista de prospecção passa a vir
-- de uma raspagem local do Google Maps. O motivo está medido: a fila do Radar
-- tem 277 candidatos e UM telefone. Não é defeito do coletor — o
-- casamentos.com.br não publica o número (fica atrás de um endpoint em
-- Disallow), e nenhuma das outras fontes lidas em 17/09 publica o telefone e
-- permite a coleta ao mesmo tempo. O CRM inteiro começa numa mensagem; uma
-- fila bem ordenada de gente que não dá para chamar não vira conversa nenhuma.
--
-- POR QUE ESTA MIGRAÇÃO EXISTE, E POR QUE ELA É PEQUENA
-- Não se constrói caminho novo de escrita: o CSV entra pela importação de
-- planilha, que já é a esteira do ADR-08 (raw_capture → source_record →
-- supplier_candidate → revisão → organizations), com prévia, dedup e desfazer
-- de 48 h. O que se conserta aqui é um ESTREITAMENTO: o payload que
-- `app.importacao_normalizar` monta tem 9 campos (`20260904001820:531-540`) e a
-- whitelist do R06 (`app.payload_e_permitido`, `20260904001600:141`) permite 22.
-- `email`, `endereco`, `cep`, `nota`, `avaliacoes_qtd` e `place_id` já têm
-- coluna em `public.source_record` e eram jogados fora na porta de entrada.
--
-- O que esta migração ENTREGA
--   1. `app.endereco_br(text)`: o endereço de uma linha do Maps, que vem numa
--      coluna só, vira {bairro, cidade, cep}. Nulo onde não casou.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. Um endereço do Maps vira bairro, cidade e CEP
-- ---------------------------------------------------------------------------
-- O kit devolve o endereço inteiro numa coluna:
--   "Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095"
-- e o CRM precisa dos três separados: `cidade` alimenta `app.importacao_cidade`
-- (e a rota de visita), `bairro` alimenta a rota e a dedup de telefone fixo, e
-- `cep` para em `source_record` — não existe coluna de CEP em
-- `supplier_candidates` nem em `organizations`, e nesta fase não criamos uma.
--
-- A REGRA É ESTREITA DE PROPÓSITO, e o que não casou volta NULO. O Google não
-- garante formato nenhum: MEI que atende em casa, endereço sem número,
-- rodovia, ponto de referência. Palpitar bairro aqui não estraga a ficha —
-- estraga a visita de quem for até lá com a rota na mão.
create or replace function app.endereco_br(t text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_txt    text := coalesce(t, '');
  v_bruto  text;
  v_digito text;
  v_cep    text;
  v_partes text[];
  v_i      int;
  v_qual   int;      -- índice do pedaço que é a cidade
  v_cidade text;
  v_bairro text;
begin
  -- (a) CEP: a PRIMEIRA ocorrência de \d{5}-?\d{3}, sempre devolvida NNNNN-NNN.
  v_bruto := (select x[1] from regexp_matches(v_txt, '(\d{5}-?\d{3})') x limit 1);
  if v_bruto is not null then
    v_digito := replace(v_bruto, '-', '');
    v_cep    := substr(v_digito, 1, 5) || '-' || substr(v_digito, 6, 3);
    -- Tirado o CEP, o que sobra é o endereço. O espaço no lugar evita colar
    -- dois pedaços que eram vizinhos do número.
    v_txt := replace(v_txt, v_bruto, ' ');
  end if;

  -- (b) Cidade: o ÚLTIMO pedaço entre vírgulas que termine em "- UF".
  v_partes := string_to_array(v_txt, ',');
  for v_i in 1 .. coalesce(array_length(v_partes, 1), 0) loop
    if v_partes[v_i] ~ '^\s*(.+?)\s*-\s*[A-Z]{2}\s*$' then
      v_qual := v_i;
    end if;
  end loop;
  if v_qual is not null then
    v_cidade := (regexp_match(v_partes[v_qual], '^\s*(.+?)\s*-\s*[A-Z]{2}\s*$'))[1];
  end if;

  -- (c) Bairro: o que vem depois do último " - " no pedaço IMEDIATAMENTE
  -- anterior ao da cidade. Sem " - " ali, não há bairro — e não se inventa um.
  if v_qual is not null and v_qual > 1
     and position(' - ' in v_partes[v_qual - 1]) > 0 then
    v_bairro := nullif(trim(regexp_replace(v_partes[v_qual - 1], '^.* - ', '')), '');
  end if;

  return jsonb_build_object('bairro', v_bairro, 'cidade', v_cidade, 'cep', v_cep);
end $$;
comment on function app.endereco_br(text) is
  'Endereço de uma linha do Google Maps → {bairro, cidade, cep}. CEP normalizado em NNNNN-NNN; cidade do último pedaço "Nome - UF"; bairro depois do último " - " do pedaço anterior ao da cidade. O que não casou volta NULO: aqui não se palpita.';
revoke all on function app.endereco_br(text) from public, anon;
grant execute on function app.endereco_br(text) to authenticated, service_role;
```

- [ ] **1.4 — aplicar a migração e ver passar.**

```
pnpm db:reset
pnpm db:test
```

`pnpm db:reset` reaplica todas as migrações na ordem e depois a `supabase/seed.sql`. Se houver dado de desenvolvimento na base que você não queira perder, a alternativa usada neste repositório é aplicar só o arquivo novo em transação única:

```
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql
```

A migração é `create or replace`, reaplicável. Esperado: o arquivo 66 devolve `ok 1` a `ok 5` e o total da suíte sobe 5 asserções. Nenhum outro arquivo muda de resultado. (As cinco asserções foram medidas contra o banco local antes de este plano ser escrito: os cinco endereços devolvem exatamente os cinco objetos acima.)

- [ ] **1.5 — lint, tipos e commit.**

```
pnpm db:lint
pnpm db:types
```

`pnpm db:types` regenera `packages/schema/src/database.types.ts`; `app.endereco_br` aparece lá porque o comando gera `--schema public,app` — é o mesmo lugar em que `app.importacao_normalizar` já está (`database.types.ts:468`). Confira que o diff do arquivo gerado tem só a função nova.

```
git add supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql \
        supabase/tests/66_o_csv_do_maps.sql \
        packages/schema/src/database.types.ts
git commit -F - <<'MSG'
O endereço do Maps vira bairro, cidade e CEP

Primeira peça da Fase 1 do pivô: o CSV do Google Maps traz o endereço
numa coluna só e o CRM precisa dos três separados. `app.endereco_br`
devolve nulo em tudo que não casou — bairro inventado não estraga a
ficha, estraga a visita.

Spec: docs/superpowers/specs/2026-09-24-pivo-scraper-e-robo-autonomo-design.md §3.2

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Tarefa 2: `app.importacao_normalizar(jsonb)` substituída — o payload sai de 9 para 15 chaves

**Arquivos:** `supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql` (ampliado), `supabase/tests/66_o_csv_do_maps.sql` (ampliado, `plan(5)` → `plan(23)`).

**Interfaces**
- *Consome:* `app.endereco_br` (T1); `app.payload_e_permitido`, `app.tem_cpf`, `app.sem_cpf`, `app.normalize_phone_br`, `app.normalize_instagram`, `app.normalize_cnpj`, `app.cnpj_is_valid`, `app.importacao_fonte`, `app.importacao_cidade`, `app.importacao_categoria`, `app.importacao_pessoa`, `app.importacao_etapa`, `app.importacao_data`, `app.importacao_canal`, `app.chave_catalogo`, `app.is_suppressed`, `app.search_name`, `app.mask_phone`, `app.reads_base_pii`, `public.source_category_map` — todos já existem.
- *Produz:* `app.importacao_normalizar(p jsonb) returns jsonb` com a **mesma assinatura** (`stable`, `search_path` vazio). O objeto do topo ganha 6 chaves: `place_id` (text), `email` (text), `endereco` (text), `cep` (text), `nota` (numeric), `avaliacoes_qtd` (int). O `payload` passa a ter 15 chaves: `avaliacoes_qtd, bairro, categoria_origem, cep, cidade, cnpj, email, endereco, instagram, nome_comercial, nota, place_id, site, source_url, telefones`. `external_id` = `coalesce(place_id, telefone E.164, '@'||instagram, cnpj, search_name|cidade)`. Avisos novos: `email_invalido`, `nota_invalida`, `avaliacoes_invalidas`; `cpf_descartado` passa a disparar também por `endereco` e `bairro`.
- *Produz também, para as tarefas seguintes:* no arquivo 66, os auxiliares `pg_temp.entrar(uuid,text)`, `pg_temp.sair()`, `pg_temp.contratar(text,text)`, `pg_temp.admin()`, `pg_temp.linha_maps(jsonb)`, `pg_temp.linha_cpf()`, `pg_temp.aviso(jsonb,text)`, a temp table `equipe`, e a fonte fixture `public.sources` id **966** (`c66_maps`) com o mapa de categorias dela. Tudo desfeito no `rollback`.

**Contexto que você precisa saber antes de começar:**

- A versão viva da função está em `supabase/migrations/20260904001820_importacao_de_planilha.sql`, **da linha 363 (`create or replace function app.importacao_normalizar(p jsonb)`) à linha 575 (`end $$;`)**, seguida do `comment on` (576–577), do `revoke` (578) e do `grant` (579). Leia com `sed -n "363,579p"` e compare com a transcrição abaixo **linha a linha** antes de colar. O `begin` do corpo está na linha 396; a 392 é a declaração de `v_optout`.
- **Não toque no arquivo 20260904001820.** A substituição é um `create or replace` na migração nova desta Fase.
- **Duas funções chamam esta:** `public.importacao_previa(jsonb)` (linha **587**) e `public.importacao_gravar(uuid, jsonb)` (linha **766**) do mesmo arquivo. As duas leem só `v_n ->> '<campo>'` e `v_n -> 'payload'` — nunca abrem o payload. É por isso que os campos novos entram **no topo** do objeto devolvido, e não só dentro de `payload`.
- **Como a planilha comum fica protegida:** `supabase/tests/22_importacao_de_planilha.sql` (`plan(73)`, na linha 38) exercita as duas funções chamadoras com a planilha-ponte inteira. **Esse arquivo não pode ser tocado nesta tarefa**: ele é a rede.
- A expressão do mapa de categorias tem de ser a mesma de `public.esteira_processar_captura` (`supabase/migrations/20260904001600_esteira_de_ingestao.sql:1906-1910`): `lower(trim(...))`, **sem** `unaccent`. As chaves do mapa são minúsculas **com acento**.
- `app.payload_e_permitido` (`20260904001600:141`) tem `v_permitidas` com 22 nomes; os 15 que vamos usar já estão todos lá. A whitelist **não muda**, e `apps/workers/src/ingest/whitelist.ts` **não é tocado**.
- CNPJ válido usado como fixture neste repositório: `11222333000181` (`03_dedup.sql:51`). CPF válido: `111.444.777-35` (é o que o arquivo 22 usa, na linha 257).
- **O telefone da fixture é `84 98800-0166`, e `app.normalize_phone_br` devolve `+5584988000166`.** Conferido no banco. Não é `+5584988001166` — se você vir esse número em algum lugar, é erro de transcrição.

### Passos

- [ ] **2.1 — escrever a fixture do teste.** No `supabase/tests/66_o_csv_do_maps.sql`, **troque o cabeçalho inteiro** por:

```sql
-- =====================================================================
-- pgTAP — O CSV do Google Maps entra pela importação (migração 20260924130000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. O ENDEREÇO NÃO É PALPITE. `app.endereco_br` lê bairro, cidade e CEP de
--      uma coluna só e devolve NULO em tudo que não casou. O Google não
--      garante formato nenhum (MEI que atende em casa, rodovia, ponto de
--      referência): bairro inventado não estraga a ficha, estraga a visita de
--      quem for até lá.
--   2. O PAYLOAD DEIXOU DE SER ESTREITO. `app.importacao_normalizar` passa de
--      9 para 15 chaves, todas já dentro da whitelist do R06 SCR-01 —
--      `place_id`, `email`, `endereco`, `cep`, `nota` e `avaliacoes_qtd` já
--      tinham coluna em `public.source_record` e eram jogados fora na porta.
--      E a 16ª chave reprova o payload INTEIRO: a whitelist não é por campo.
--   3. A IDENTIDADE NA FONTE É O LUGAR, NÃO O TELEFONE. O telefone do Maps
--      muda; o `cid` não. Havendo `place_id`, ele é o `external_id`.
--   4. O MAPA DE CATEGORIAS VEM ANTES DA QUEDA DIFUSA. `app.importacao_categoria`
--      casa por trigrama a partir de 0,55; rodando primeiro, produziria
--      `categoria_aproximada` em cima de um palpite sobre uma categoria que o
--      mapa da fonte já sabia de cor.
--   5. O CPF NÃO CHEGA NA `raw_capture`. `public.esteira_gravar_captura` grava
--      o payload CRU (`app.payload_e_permitido` confere nome de chave, não
--      valor) e o gatilho que limpa CPF só roda um passo adiante, em
--      `source_record` (`20260904001600:624-643`). Com `endereco` no payload, a
--      limpeza tem de acontecer ANTES, dentro de `app.importacao_normalizar`
--      (ADR-09, RF-BAS-16). CONSEQUÊNCIA MEDIDA AQUI: o gatilho deixa de ver o
--      CPF, e com ele somem a flag `cpf_descartado` do `source_record` e a
--      linha de `field_provenance` com `reason = 'cpf'`. É dívida escrita, não
--      descuido — a asserção que a fixa diz o que fazer a respeito.
--
-- A REDE É O ARQUIVO 22. `app.importacao_normalizar` é chamada por
-- `public.importacao_previa` E por `public.importacao_gravar`, e a
-- planilha-ponte continua entrando pelas duas.
-- `supabase/tests/22_importacao_de_planilha.sql` (plan(73)) NÃO é tocado por
-- esta migração: é ele quem acusa, no mesmo `pnpm db:test`, se a planilha
-- comum quebrar.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada: este banco
-- tem operação real dentro. Tudo é delta ou escopo por lote deste arquivo.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
```

Troque `select plan(5);` por `select plan(23);` e acrescente, logo abaixo do `plan`, **antes** da seção 1 que já existe:

```sql
-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

-- ---------- quem importa (fixture, e não gente de verdade) ----------
-- `public.importacao_previa` e `public.importacao_gravar` exigem `app.can_write()`,
-- e um banco recém-resetado não tem NENHUM perfil: `supabase/seed.sql` semeia
-- `allowed_users`, não `auth.users`. O caminho é o mesmo do login real
-- (RF-ADM-01) e o `rollback` desfaz tudo. Sobrenome impossível na operação.
create function pg_temp.contratar(p_nome text, p_papel text) returns uuid
language plpgsql as $$
declare
  v_id    uuid  := gen_random_uuid();
  v_email text  := 'pgtap66.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                   || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 66 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  return v_id;
end $$;
create temp table equipe(papel text primary key, id uuid not null);
insert into equipe(papel, id) values ('admin', pg_temp.contratar('Anastacio Pgtap', 'admin'));
create function pg_temp.admin() returns uuid language sql as $$
  select id from equipe where papel = 'admin'
$$;
grant select on equipe to authenticated;

-- ---------- a fonte e o mapa de categorias DESTE arquivo ----------
-- A fonte de produção `google_maps_raspado` nasce numa seção posterior DESTA
-- MESMA migração (§3.2 item 6), escrita pela Tarefa 5 deste plano. Aqui ela é
-- fixture, para o arquivo não depender da ordem das tarefas.
-- O id 966 segue o padrão do 37_a_coleta_cabe_num_botao.sql (937–940).
insert into public.sources (id, slug, name, kind, base_url, legal_basis, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values (966, 'c66_maps', 'C66 Maps (pgTAP)', 'import', 'https://www.google.com/maps',
        'legitimo_interesse', false, 5.00, false,
        '{"collector": {"kind": "externo", "phase": "mvp", "enabled": false},
          "entrada_por_arquivo": true}'::jsonb);

insert into public.source_category_map (source_id, category_source, category_id)
select 966, m.chave, c.id
  from (values
          ('buffet', 'buffet_adulto_corporativo'),
          -- A chave que PROVA a ordem: este rótulo casa por trigrama com
          -- "Celebrante, beleza, convites, transfer, segurança, staff" — o
          -- arquivo 22 mede esse casamento (linhas 186-188). Se
          -- `app.importacao_categoria` rodasse primeiro, a linha viria
          -- APROXIMADA e na categoria errada.
          ('outros serviços (celebrante, beleza, convites, transfer, seguranca, staff)',
           'fotografia_video')
       ) as m(chave, slug_crm)
  join public.categories c on c.slug = m.slug_crm;

-- ---------- a linha do Maps ----------
create function pg_temp.linha_maps(p_extra jsonb default '{}'::jsonb) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'linha',          2,
    'nome',           'BUFFET C66 PGTAP',
    'whatsapp',       '84 98800-0166',
    'categoria',      'buffet',
    'origem',         'C66 Maps (pgTAP)',
    'origem_detalhe', 'https://www.google.com/maps/place/?q=place_id:C66PGTAP',
    'place_id',       'C66-CID-PGTAP',
    'email',          'contato@buffetc66.invalid; financeiro@buffetc66.invalid',
    'endereco',       'Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095',
    'nota',           '4,7',
    'avaliacoes_qtd', '238',
    'site',           'https://buffetc66.invalid',
    -- CNPJ e @ não vêm do CSV do Maps; entram aqui porque a MESMA função serve
    -- à planilha-ponte, e é com os 15 campos preenchidos que se conta o payload.
    'cnpj',           '11222333000181',
    'instagram',      '@buffetc66') || p_extra
$$;

create function pg_temp.aviso(p jsonb, p_aviso text) returns boolean language sql as $$
  select coalesce(p -> 'avisos', '[]'::jsonb) @> jsonb_build_array(p_aviso)
$$;
```

- [ ] **2.2 — escrever as asserções dos testes 2 e 3 de §3.5.** Acrescente ao fim do arquivo, **antes** de `select * from finish();`:

```sql
-- =====================================================================
-- 2. O payload de uma linha do Maps (§3.5 teste 2)
-- =====================================================================
select is(
  (select array_agg(k order by k collate "C")
     from jsonb_object_keys(app.importacao_normalizar(pg_temp.linha_maps()) -> 'payload') k),
  array['avaliacoes_qtd','bairro','categoria_origem','cep','cidade','cnpj','email',
        'endereco','instagram','nome_comercial','nota','place_id','site','source_url',
        'telefones'],
  'o payload sai de 9 para 15 chaves, e são exatamente estas');

select ok(app.payload_e_permitido(app.importacao_normalizar(pg_temp.linha_maps()) -> 'payload'),
          'e as 15 passam na whitelist do R06 SCR-01, sem ampliar a lista');

-- Os campos novos NO TOPO: `importacao_previa` e `importacao_gravar` leem
-- `v_n ->> '<campo>'` e nunca abrem o payload.
select is(
  (select jsonb_build_object(
            'place_id',       n ->> 'place_id',
            'email',          n ->> 'email',
            'endereco',       n ->> 'endereco',
            'cep',            n ->> 'cep',
            'nota',           n ->> 'nota',
            'avaliacoes_qtd', n ->> 'avaliacoes_qtd',
            'bairro',         n ->> 'bairro',
            'cidade_nome',    n ->> 'cidade_nome')
     from (select app.importacao_normalizar(pg_temp.linha_maps()) as n) x),
  jsonb_build_object(
    'place_id',       'C66-CID-PGTAP',
    'email',          'contato@buffetc66.invalid',
    'endereco',       'Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095',
    'cep',            '59082-095',
    'nota',           '4.7',
    'avaliacoes_qtd', '238',
    'bairro',         'Capim Macio',
    'cidade_nome',    'Natal'),
  'os campos novos vêm no TOPO do objeto, que é onde a prévia e a gravação leem');

-- Os três avisos que o item (c) de §3.2 inventa: nenhum deles reprova a linha.
select ok(pg_temp.aviso(app.importacao_normalizar(
            pg_temp.linha_maps('{"email":"fale conosco"}'::jsonb)), 'email_invalido')
      and (app.importacao_normalizar(
            pg_temp.linha_maps('{"email":"fale conosco"}'::jsonb)) ->> 'erro') is null,
          'texto que não é e-mail vira aviso e campo nulo, e a linha continua valendo um telefone');

select ok(pg_temp.aviso(app.importacao_normalizar(
            pg_temp.linha_maps('{"nota":"9,5"}'::jsonb)), 'nota_invalida')
      and (app.importacao_normalizar(
            pg_temp.linha_maps('{"nota":"9,5"}'::jsonb)) -> 'payload' ->> 'nota') is null,
          'nota fora de 0–5 vira aviso e não entra no payload');

select ok(pg_temp.aviso(app.importacao_normalizar(
            pg_temp.linha_maps('{"avaliacoes_qtd":"1.238 avaliações"}'::jsonb)),
            'avaliacoes_invalidas'),
          'contagem de avaliações que não é só dígito vira aviso');

-- =====================================================================
-- 3. A identidade na fonte é o LUGAR (§3.5 teste 3)
-- =====================================================================
select is(app.importacao_normalizar(pg_temp.linha_maps()) ->> 'external_id',
          'C66-CID-PGTAP',
          'com place_id, a identidade é o lugar — mesmo havendo telefone: o número do Maps muda, o cid não');

select is(app.importacao_normalizar(pg_temp.linha_maps('{"place_id": null}'::jsonb)) ->> 'external_id',
          '+5584988000166',
          'sem place_id nada muda para a planilha-ponte: a identidade continua sendo o celular');
```

- [ ] **2.3 — escrever as asserções dos testes 9 e 14 de §3.5.** Acrescente em seguida, ainda antes de `select * from finish();`:

```sql
-- =====================================================================
-- 9. O mapa da fonte vence a queda difusa (§3.5 teste 9)
-- =====================================================================
-- `app.importacao_categoria` casa por trigrama a partir de 0,55
-- (20260904001820:165-172). Este rótulo comprido casa por semelhança com
-- "Celebrante, beleza, convites, transfer, segurança, staff" — o arquivo 22
-- mede isso nas linhas 186-188. O mapa da fonte diz outra coisa, e é o mapa
-- que manda.
select is(
  (select jsonb_build_object('categoria', n ->> 'categoria_nome',
                             'aproximada', pg_temp.aviso(n, 'categoria_aproximada'))
     from (select app.importacao_normalizar(pg_temp.linha_maps(
             '{"categoria":"Outros serviços (celebrante, beleza, convites, transfer, seguranca, staff)"}'::jsonb)) as n) x),
  jsonb_build_object('categoria', 'Fotografia e vídeo', 'aproximada', false),
  'o mapa da fonte é consultado ANTES da queda difusa, e sem aviso de aproximação');

select is(
  (select jsonb_build_object('categoria', n ->> 'categoria_nome',
                             'desconhecida', pg_temp.aviso(n, 'categoria_desconhecida'))
     from (select app.importacao_normalizar(pg_temp.linha_maps()) as n) x),
  jsonb_build_object('categoria', 'Buffet adulto/corporativo', 'desconhecida', false),
  '"buffet", que sozinho casa com o catálogo a 0,27, resolve pelo mapa da fonte');

-- =====================================================================
-- 14. O CPF não chega na `raw_capture` (§3.5 teste 14)
-- =====================================================================
create function pg_temp.linha_cpf() returns jsonb language sql stable as $$
  select pg_temp.linha_maps(jsonb_build_object(
    'linha',    3,
    'nome',     'SALAO C66 PGTAP',
    'whatsapp', '84 98800-0177',
    'place_id', 'C66-CPF-PGTAP',
    'cnpj',     null,
    'instagram', null,
    'endereco', 'Av. Salgado Filho, 2000 - Lagoa Nova, Natal - RN, 59075-000 111.444.777-35',
    'bairro',   'Lagoa Nova Sul 111.444.777-35'))
$$;

select ok(pg_temp.aviso(app.importacao_normalizar(pg_temp.linha_cpf()), 'cpf_descartado'),
          'CPF no endereço ou no bairro vira aviso já na normalização');

select is(app.importacao_normalizar(pg_temp.linha_cpf()) -> 'payload' ->> 'endereco',
          'Av. Salgado Filho, 2000 - Lagoa Nova, Natal - RN, 59075-000',
          'e o endereço entra no payload SEM o CPF, porque a raw_capture guarda o payload cru');

select is(app.importacao_normalizar(pg_temp.linha_cpf()) -> 'payload' ->> 'bairro',
          'Lagoa Nova Sul',
          'o bairro também é varrido, e a coluna explícita continua ganhando do extraído do endereço');

select pg_temp.entrar(pg_temp.admin(), 'admin');

create temp table previa66 as
  select public.importacao_previa(jsonb_build_array(pg_temp.linha_cpf())) as j;
grant select on previa66 to authenticated;

create temp table lote66 as
  select (public.esteira_abrir_lote('planilha', 966, 'pgTAP 66 — CSV do Maps')
          ->> 'batch_id')::uuid as id;
grant select on lote66 to authenticated;

create temp table grav66 as
  select public.importacao_gravar((select id from lote66),
                                  jsonb_build_array(pg_temp.linha_cpf())) as j;
grant select on grav66 to authenticated;

select pg_temp.sair();

select ok((select l -> 'avisos' from previa66, jsonb_array_elements(j -> 'linhas') l)
          @> '["cpf_descartado"]'::jsonb,
          'o descarte aparece na PRÉVIA, antes de qualquer escrita');

select ok(not app.tem_cpf((select rc.payload ->> 'endereco' from public.raw_capture rc
                            where rc.source_id = 966 and rc.external_id = 'C66-CPF-PGTAP'))
      and (select rc.payload ->> 'endereco' from public.raw_capture rc
            where rc.source_id = 966 and rc.external_id = 'C66-CPF-PGTAP')
          = 'Av. Salgado Filho, 2000 - Lagoa Nova, Natal - RN, 59075-000',
          'e a raw_capture, que guarda o payload CRU, nunca vê o CPF');
```

- [ ] **2.4 — escrever as asserções do foco de revisão (itens 1 e 2 da lista do topo).** Ainda antes de `select * from finish();`, logo depois do bloco anterior (ele já deixou o `source_record` do CPF gravado):

```sql
-- =====================================================================
-- 14b. O QUE A LIMPEZA ANTECIPADA CUSTA (foco de revisão 1)
-- =====================================================================
-- Até hoje, quem registrava o descarte era o gatilho de higiene do
-- `source_record` (20260904001600:624-643): ele limpava `name`, `legal_name`,
-- `address` e `neighborhood`, marcava `cpf_descartado` em `flags` e gravava
-- `public.field_provenance` com action='descartado', reason='cpf'. Varrendo o
-- CPF antes (que é obrigatório: `raw_capture` guarda o payload CRU), o gatilho
-- deixa de ver o CPF — e as duas marcas somem.
--
-- É DÍVIDA, e está escrita aqui de propósito. O §3.5 teste 14 da spec pede a
-- linha de `field_provenance`; ela não existe mais por este caminho. O
-- registro do descarte sobrevive HOJE só na prévia (asserção acima), que não
-- é armazenada. O conserto natural é `public.importacao_gravar` chamar
-- `app.registrar_proveniencia` quando a linha trouxer o aviso `cpf_descartado`
-- — função de 230 linhas que esta fase não substitui, e por isso fica como
-- pendência escrita no CHANGELOG, para decisão.
select ok(not ('cpf_descartado' = any (
            (select sr.flags from public.source_record sr
              where sr.source_id = 966 and sr.external_id = 'C66-CPF-PGTAP'))),
          'DÍVIDA: o source_record não marca mais cpf_descartado — o CPF já não chega nele');

select is(
  (select count(*)::int
     from public.field_provenance fp
     join public.source_record sr
       on sr.id = fp.record_id and fp.record_type = 'source_record'
    where sr.source_id = 966 and sr.external_id = 'C66-CPF-PGTAP'
      and fp.action = 'descartado' and fp.reason = 'cpf'),
  0,
  'DÍVIDA: e não há linha de field_provenance do descarte — o registro do descarte ficou só na prévia');

-- =====================================================================
-- 4. A whitelist não é por campo: a 16ª chave reprova o payload INTEIRO
--    (§3.5 teste 4; risco 2 da §11) — foco de revisão 2
-- =====================================================================
-- Esta asserção já passa hoje, e é para isso que serve: ela é a rede do dia em
-- que alguém acrescentar `facebook` ao payload "só para não perder o dado". O
-- erro não apareceria como "campo recusado" — apareceria como "a importação
-- toda falhou", em 600 linhas de uma vez.
select ok(not app.payload_e_permitido(
            (app.importacao_normalizar(pg_temp.linha_maps()) -> 'payload')
            || '{"facebook": "https://facebook.com/buffetc66"}'::jsonb),
          'uma chave fora da whitelist do R06 SCR-01 reprova o payload inteiro, não só o campo');
```

- [ ] **2.5 — rodar e ver falhar.**

```
pnpm db:test
```

Esperado, no arquivo 66: as 5 asserções da Tarefa 1 continuam verdes; das **18** novas, **15 falham e 3 já passam**. Isso foi medido contra o banco local antes de este plano ser escrito — se o seu resultado for outro, é a fixture, não a função.

As 15 vermelhas, com a falha que você deve ver:

- `15 chaves` — devolve as 9 de hoje (`bairro, categoria_origem, cidade, cnpj, instagram, nome_comercial, site, source_url, telefones`);
- `campos no topo` — devolve `null` em `place_id`, `email`, `endereco`, `cep`, `nota` e `avaliacoes_qtd`;
- `email_invalido`, `nota_invalida`, `avaliacoes_invalidas` — nenhum dos três avisos existe hoje;
- `external_id = place_id` — devolve `+5584988000166` no lugar de `C66-CID-PGTAP`;
- `mapa vence difusa` — devolve `Celebrante, beleza, convites, transfer, segurança, staff` com `aproximada = true`;
- `buffet pelo mapa` — devolve categoria nula com `desconhecida = true`;
- as cinco do CPF (aviso, endereço no payload, bairro varrido, prévia, `raw_capture`) — hoje `endereco` não entra no payload e o CPF só é varrido em `nome`, `observacoes` e `origem_detalhe`;
- **as duas da dívida** — hoje o CPF chega ao `source_record` pelo campo `bairro`, o gatilho dispara, `flags` contém `cpf_descartado` e existe uma linha em `field_provenance`. As duas ficam verdes depois da mudança, e é essa virada que mede o custo.

As **3 que já passam de propósito**, e continuam passando depois — são rede, não vermelho:

- `e as 15 passam na whitelist do R06 SCR-01` — as 9 chaves de hoje também passam;
- `sem place_id nada muda para a planilha-ponte` — hoje o `external_id` já é o celular; a asserção prova que a mudança de §3.2 item 3 **não** mexeu na planilha-ponte;
- `uma chave fora da whitelist reprova o payload inteiro` — `facebook` nunca esteve em `v_permitidas`.

Se alguma falhar com `ERROR:` em vez de `not ok`, é a fixture — conserte antes de seguir.

- [ ] **2.6 — implementar: substituir a função inteira.** Acrescente ao fim de `supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql`. É a função viva de `20260904001820:363-575`, transcrita com as cinco mudanças de §3.2 item 2 e a troca do `external_id` de §3.2 item 3 já aplicadas:

```sql
-- ---------------------------------------------------------------------------
-- 2. A linha vira o objeto canônico da esteira — agora com 15 campos
-- ---------------------------------------------------------------------------
-- Recriada a partir da definição viva de `20260904001820:363`, com seis
-- mudanças e mais nada. Elas estão marcadas no corpo com "MUDOU:".
--
--   (a) A FONTE É RESOLVIDA ANTES DA CATEGORIA. Era o contrário; a categoria
--       passou a depender do `source_id` da linha.
--   (b) A CATEGORIA CONSULTA `public.source_category_map` PRIMEIRO, com a mesma
--       expressão de `public.esteira_processar_captura` (20260904001600:1906),
--       e só cai em `app.importacao_categoria` se o mapa não tiver a chave. A
--       ordem importa: `app.importacao_categoria` tem queda difusa em
--       `similarity >= 0.55` que dispararia antes do mapa e marcaria
--       `categoria_aproximada` em cima de um palpite.
--   (c) LÊ `place_id`, `email`, `endereco`, `nota` e `avaliacoes_qtd`, e usa
--       `app.endereco_br` para cidade/bairro/CEP quando não houver coluna
--       explícita — coluna explícita ganha. Nenhum dos três reprova a linha:
--       um lugar sem e-mail continua valendo um telefone.
--   (d) O CPF PASSA A SER VARRIDO NO ENDEREÇO E NO BAIRRO. Com `endereco` no
--       payload isso vira furo real: `public.esteira_gravar_captura` grava
--       `raw_capture.payload` CRU (`app.payload_e_permitido` confere nomes de
--       chave, não valores) e o gatilho que limpa CPF só roda um passo adiante,
--       em `source_record` (20260904001600:624-643). Aqui é antes. CUSTO
--       CONHECIDO: o gatilho deixa de ver o CPF, então a flag `cpf_descartado`
--       e a linha de `field_provenance` com reason='cpf' somem por este
--       caminho. Medido no arquivo 66, bloco 14b, e registrado no CHANGELOG.
--   (e) OS CAMPOS NOVOS VÊM NO TOPO do objeto devolvido, e não só dentro de
--       `payload`: `importacao_previa` (20260904001820:587) e
--       `importacao_gravar` (:766) leem `v_n ->> '<campo>'` e nunca abrem o
--       payload.
--   (f) `external_id`: `place_id` PRIMEIRO. O telefone do Maps muda, o `cid`
--       não. Para a planilha-ponte, que não tem `place_id`, nada muda.
--
-- Continua STABLE: a prévia e a gravação chamam ESTA função, e não duas
-- parecidas. Uma prévia que promete o que a gravação não cumpre é pior do que
-- não ter prévia.
create or replace function app.importacao_normalizar(p jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_avisos  text[] := '{}'::text[];
  v_erro    text;
  v_nome    text := nullif(trim(coalesce(p ->> 'nome', '')), '');
  v_bruto   text;
  v_tel     text;
  v_ig      text;
  v_cnpj    text;
  v_site    text;
  v_cat     jsonb;
  v_cid     jsonb;
  v_fonte   jsonb;
  v_pessoa  jsonb;
  v_etapa   jsonb;
  v_grupo   text;
  v_slug    text;
  v_kind    app.org_kind;
  v_pipe    int;
  v_tipo    text := app.chave_catalogo(p ->> 'tipo');
  v_ult     date;
  v_prox    date;
  v_obs     text;
  v_res     text;
  v_optout  boolean;
  v_ext     text;
  v_url     text;
  v_payload jsonb;
  -- MUDOU (c): os cinco campos do CSV do Maps e o que sai do endereço.
  v_place   text;
  v_email   text;
  v_end     text;
  v_bairro  text;
  v_cep     text;
  v_nota    numeric;
  v_aval    int;
  v_endj    jsonb;
  v_cidtxt  text;
begin
  -- ------------------------------------------------------------------
  -- Higiene do RF-BAS-16 antes de tudo: CPF não entra nem no que a prévia
  -- devolve para a tela. `app.sem_cpf` apaga; `app.tem_cpf` só conta que havia.
  -- MUDOU (d): `endereco` e `bairro` entram na varredura, porque agora vão
  -- para o payload — e `raw_capture.payload` é gravado CRU.
  -- ------------------------------------------------------------------
  if app.tem_cpf(coalesce(v_nome, '')) or app.tem_cpf(coalesce(p ->> 'observacoes', ''))
     or app.tem_cpf(coalesce(p ->> 'origem_detalhe', ''))
     or app.tem_cpf(coalesce(p ->> 'endereco', ''))
     or app.tem_cpf(coalesce(p ->> 'bairro', '')) then
    v_avisos := v_avisos || 'cpf_descartado'::text;
  end if;
  v_nome   := app.sem_cpf(v_nome);
  v_obs    := app.sem_cpf(nullif(trim(coalesce(p ->> 'observacoes', '')), ''));
  v_res    := nullif(trim(coalesce(p ->> 'resultado', '')), '');
  v_end    := app.sem_cpf(nullif(trim(coalesce(p ->> 'endereco', '')), ''));
  v_bairro := app.sem_cpf(nullif(trim(coalesce(p ->> 'bairro', '')), ''));

  -- ------------------------------------------------------------------
  -- Identidade
  -- ------------------------------------------------------------------
  v_bruto := nullif(trim(coalesce(p ->> 'whatsapp', '')), '');
  v_tel   := app.normalize_phone_br(v_bruto);
  if v_bruto is not null and v_tel is null then
    v_avisos := v_avisos || 'telefone_invalido'::text;
  end if;

  v_bruto := nullif(trim(coalesce(p ->> 'instagram', '')), '');
  v_ig    := app.normalize_instagram(v_bruto);
  if v_bruto is not null and v_ig is null then
    v_avisos := v_avisos || 'instagram_invalido'::text;
  end if;

  v_bruto := nullif(trim(coalesce(p ->> 'cnpj', '')), '');
  v_cnpj  := app.normalize_cnpj(v_bruto);
  if v_cnpj is not null and not app.cnpj_is_valid(v_cnpj) then
    v_avisos := v_avisos || 'cnpj_invalido'::text;
    v_cnpj := null;
  end if;

  v_site := nullif(trim(coalesce(p ->> 'site', '')), '');

  -- ------------------------------------------------------------------
  -- MUDOU (c): o que o CSV do Google Maps traz e a planilha jogava fora.
  -- O `cid` do Maps NÃO é o `place_id` da Places API; se um dia ligarmos o
  -- conector oficial, os dois identificadores não casam (ADR-12).
  -- ------------------------------------------------------------------
  v_place := nullif(trim(coalesce(p ->> 'place_id', '')), '');

  -- E-mail: o kit devolve uma lista. Fica o PRIMEIRO que é e-mail; o resto é
  -- descartado, porque minimização não é opcional.
  v_bruto := nullif(trim(coalesce(p ->> 'email', '')), '');
  if v_bruto is not null then
    select trim(e) into v_email
      from regexp_split_to_table(v_bruto, '[;,]') e
     where trim(e) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     limit 1;
    if v_email is null then
      v_avisos := v_avisos || 'email_invalido'::text;
    end if;
  end if;

  -- Nota: vírgula decimal do CSV em português, e sempre dentro de 0–5. É sinal
  -- numérico de pontuação (RF-RAD-04), nunca exibido como avaliação.
  v_bruto := nullif(trim(coalesce(p ->> 'nota', '')), '');
  if v_bruto is not null then
    begin
      v_nota := replace(v_bruto, ',', '.')::numeric;
    exception when others then
      v_nota := null;
    end;
    if v_nota is null or v_nota < 0 or v_nota > 5 then
      v_avisos := v_avisos || 'nota_invalida'::text;
      v_nota := null;
    end if;
  end if;

  -- Avaliações: só dígitos. "1.238 avaliações" não é um inteiro.
  v_bruto := nullif(trim(coalesce(p ->> 'avaliacoes_qtd', '')), '');
  if v_bruto is not null then
    if v_bruto ~ '^\d+$' then
      v_aval := v_bruto::int;
    else
      v_avisos := v_avisos || 'avaliacoes_invalidas'::text;
    end if;
  end if;

  -- O endereço vem numa coluna só: dele saem bairro, cidade e CEP. Coluna
  -- explícita GANHA — a planilha-ponte tem `cidade` e `bairro` próprios, e
  -- quem digitou sabe mais do que o regex. `v_bairro` já veio sem CPF acima, e
  -- o que sai de `v_end` também, porque `v_end` já foi varrido.
  v_endj   := case when v_end is not null then app.endereco_br(v_end) else '{}'::jsonb end;
  v_cidtxt := coalesce(nullif(trim(coalesce(p ->> 'cidade', '')), ''), v_endj ->> 'cidade');
  v_bairro := coalesce(v_bairro, v_endj ->> 'bairro');
  v_cep    := coalesce(nullif(trim(coalesce(p ->> 'cep', '')), ''), v_endj ->> 'cep');

  -- ------------------------------------------------------------------
  -- Catálogos
  -- MUDOU (a): a FONTE vem primeiro, porque a categoria depende dela.
  -- ------------------------------------------------------------------
  v_fonte  := app.importacao_fonte(p ->> 'origem');
  v_cid    := app.importacao_cidade(v_cidtxt);
  v_pessoa := app.importacao_pessoa(p ->> 'responsavel');

  -- MUDOU (b): o mapa da fonte antes da queda difusa. A expressão é a mesma de
  -- `public.esteira_processar_captura` (20260904001600:1906): `lower(trim(...))`,
  -- sem `unaccent` — as chaves do mapa são minúsculas e COM acento.
  v_cat := '{}'::jsonb;
  if v_fonte ->> 'id' is not null
     and nullif(trim(coalesce(p ->> 'categoria', '')), '') is not null then
    select jsonb_build_object('id', c.id, 'nome', c.name, 'aproximado', false)
      into v_cat
      from public.source_category_map m
      join public.categories c on c.id = m.category_id
     where m.source_id = (v_fonte ->> 'id')::int
       and m.category_source = lower(trim(coalesce(p ->> 'categoria', '')))
     limit 1;
  end if;
  -- `select into` sem linha deixa v_cat NULO, não '{}': por isso o coalesce.
  if coalesce(v_cat, '{}'::jsonb) = '{}'::jsonb then
    v_cat := app.importacao_categoria(p ->> 'categoria');
  end if;

  if v_cat = '{}'::jsonb then
    v_avisos := v_avisos || 'categoria_desconhecida'::text;
  elsif (v_cat ->> 'aproximado')::boolean then
    v_avisos := v_avisos || 'categoria_aproximada'::text;
  end if;
  -- A cidade nunca foi motivo de revisão nesta esteira: `city_id` é nulável e a
  -- linha entra assim mesmo, só marcada. Agora a cidade também pode ter vindo
  -- do endereço, e é `v_cidtxt` — não mais `p ->> 'cidade'` — que decide se
  -- houve cidade para reconhecer.
  if v_cidtxt is not null and v_cid = '{}'::jsonb then
    v_avisos := v_avisos || 'cidade_desconhecida'::text;
  end if;
  if v_fonte = '{}'::jsonb then
    v_avisos := v_avisos || 'origem_desconhecida'::text;
  end if;
  if v_pessoa ->> 'id' is null and nullif(trim(coalesce(p ->> 'responsavel', '')), '') is not null then
    v_avisos := v_avisos || (case when coalesce((v_pessoa ->> 'ambiguo')::boolean, false)
                                  then 'responsavel_ambiguo' else 'responsavel_desconhecido' end)::text;
  end if;

  -- O tipo do negócio sai da CATEGORIA, exatamente como em app.promover_candidato:
  -- se a coluna `tipo` discordar, quem manda é a categoria, e a prévia avisa.
  if v_cat ->> 'id' is not null then
    select c.group, c.slug into v_grupo, v_slug
      from public.categories c where c.id = (v_cat ->> 'id')::int;
    v_kind := case
                when v_slug = 'cerimonialistas_assessorias' then 'cerimonialista'
                when v_grupo = 'producao' then 'produtor'
                when v_grupo = 'locais'   then 'espaco'
                else 'fornecedor'
              end::app.org_kind;
    select pl.id into v_pipe from public.pipelines pl
     where pl.slug = case when v_kind in ('produtor','cerimonialista') then 'produtor' else 'fornecedor' end;
    if v_tipo is not null and v_tipo <> app.chave_catalogo(v_kind::text) then
      v_avisos := v_avisos || 'tipo_diferente_da_categoria'::text;
    end if;
  end if;

  v_etapa := app.importacao_etapa(p ->> 'etapa', v_pipe);
  if v_etapa = '{}'::jsonb and nullif(trim(coalesce(p ->> 'etapa', '')), '') is not null
     and v_pipe is not null then
    v_avisos := v_avisos || 'etapa_desconhecida'::text;
  elsif v_etapa <> '{}'::jsonb and (v_etapa ->> 'aproximado')::boolean then
    v_avisos := v_avisos || 'etapa_aproximada'::text;
  end if;

  -- ------------------------------------------------------------------
  -- Datas
  -- ------------------------------------------------------------------
  v_ult  := app.importacao_data(p ->> 'ultimo_contato');
  v_prox := app.importacao_data(p ->> 'data_proxima_acao');
  if nullif(trim(coalesce(p ->> 'ultimo_contato', '')), '') is not null and v_ult is null then
    v_avisos := v_avisos || 'data_invalida'::text;
  end if;
  if nullif(trim(coalesce(p ->> 'data_proxima_acao', '')), '') is not null and v_prox is null then
    v_avisos := v_avisos || 'data_invalida'::text;
  end if;

  -- ------------------------------------------------------------------
  -- Pediu para parar (regra 4 do README da planilha-ponte, guardrail do CLAUDE.md)
  -- ------------------------------------------------------------------
  v_optout := app.chave_catalogo(p ->> 'etapa') like 'opt out%'
           or app.chave_catalogo(v_res) like 'pediu para parar%'
           or app.is_suppressed(v_tel, v_cnpj, v_ig);

  -- ------------------------------------------------------------------
  -- Erros que impedem a linha de virar ficha
  -- ------------------------------------------------------------------
  if v_nome is null then
    v_erro := 'sem_nome';
  elsif v_tel is null and v_ig is null and v_cnpj is null then
    v_erro := 'sem_contato';
  end if;

  -- ------------------------------------------------------------------
  -- Identidade na fonte. NUNCA o número da linha: reordenar a planilha
  -- duplicaria a base inteira.
  -- MUDOU (f): lugar > celular > @ > CNPJ > nome+cidade. O telefone do Maps
  -- muda de uma raspagem para a outra; o `cid` do lugar não.
  -- ------------------------------------------------------------------
  v_ext := coalesce(v_place, v_tel, case when v_ig is not null then '@' || v_ig end, v_cnpj,
                    case when v_nome is not null
                         then app.search_name(v_nome) || '|' || coalesce(v_cid ->> 'nome', 'sem-cidade') end);

  -- `origem_detalhe` é a URL da fonte quando é uma URL; senão é observação da
  -- origem, e vira aviso na proveniência, não link.
  v_url := nullif(trim(coalesce(p ->> 'origem_detalhe', '')), '');
  if v_url is not null and v_url !~* '^https?://' then
    v_url := null;
  end if;

  -- ------------------------------------------------------------------
  -- O payload da captura: SÓ o que a whitelist do R06 SCR-01 permite. Etapa,
  -- responsável, resultado e observação são dado NOSSO, de operação — não são
  -- coleta de terceiro e não entram no `raw_capture`.
  -- MUDOU (c): de 9 para 15 chaves, todas já dentro de `v_permitidas`. A
  -- whitelist NÃO é ampliada, e `apps/workers/src/ingest/whitelist.ts` não é
  -- tocado: `facebook` e `linkedin` ficam de fora de propósito.
  -- ------------------------------------------------------------------
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'nome_comercial', v_nome,
    'cnpj',           v_cnpj,
    'cidade',         v_cid ->> 'nome',
    'bairro',         v_bairro,
    'instagram',      v_ig,
    'site',           v_site,
    'source_url',     v_url,
    'categoria_origem', nullif(trim(coalesce(p ->> 'categoria', '')), ''),
    'telefones',      case when v_tel is not null then jsonb_build_array(v_tel) end,
    'place_id',       v_place,
    'email',          v_email,
    'endereco',       v_end,
    'cep',            v_cep,
    'nota',           v_nota,
    'avaliacoes_qtd', v_aval));

  return jsonb_build_object(
    'linha',            coalesce((p ->> 'linha')::int, 0),
    'nome',             v_nome,
    'kind',             v_kind,
    'categoria_id',     (v_cat ->> 'id')::int,
    'categoria_nome',   v_cat ->> 'nome',
    'cidade_id',        (v_cid ->> 'id')::int,
    'cidade_nome',      v_cid ->> 'nome',
    'source_id',        (v_fonte ->> 'id')::int,
    'source_nome',      v_fonte ->> 'nome',
    'source_url',       v_url,
    'pipeline_id',      v_pipe,
    'etapa_id',         (v_etapa ->> 'id')::int,
    'etapa_nome',       v_etapa ->> 'nome',
    'responsavel_id',   v_pessoa ->> 'id',
    'responsavel_nome', v_pessoa ->> 'nome',
    'telefone',         v_tel,
    'telefone_visivel', case when v_tel is not null then
                               case when app.reads_base_pii() then v_tel else app.mask_phone(v_tel) end end,
    'instagram',        v_ig,
    'cnpj',             v_cnpj,
    'bairro',           v_bairro,
    -- MUDOU (e): os campos novos NO TOPO. `importacao_previa` e
    -- `importacao_gravar` leem `v_n ->> '<campo>'` e nunca abrem o payload.
    'place_id',         v_place,
    'email',            v_email,
    'endereco',         v_end,
    'cep',              v_cep,
    'nota',             v_nota,
    'avaliacoes_qtd',   v_aval,
    'ultimo_contato',   v_ult,
    'canal',            app.importacao_canal(p ->> 'canal_ultimo_contato'),
    'resultado',        v_res,
    'proxima_acao',     nullif(trim(coalesce(p ->> 'proxima_acao', '')), ''),
    'data_proxima_acao', v_prox,
    'observacoes',      v_obs,
    'optout',           v_optout,
    'external_id',      v_ext,
    'payload',          v_payload,
    'erro',             v_erro,
    'avisos',           to_jsonb(v_avisos));
end $$;
comment on function app.importacao_normalizar(jsonb) is
  'Uma linha de planilha ou do CSV do Google Maps (RF-BAS-07, ADR-12) vira o objeto canônico da esteira: telefone em E.164, endereço partido por app.endereco_br, categoria pelo mapa da fonte antes da queda difusa, external_id determinístico (place_id > celular > @ > CNPJ > nome+cidade) e payload de 15 campos já dentro da whitelist do R06 SCR-01, com CPF varrido de nome, observação, endereço e bairro ANTES da raw_capture. STABLE: a prévia e a gravação usam ESTA função, não duas parecidas.';
revoke all on function app.importacao_normalizar(jsonb) from public, anon;
grant execute on function app.importacao_normalizar(jsonb) to authenticated, service_role;
```

- [ ] **2.7 — rodar e ver passar.**

```
pnpm db:reset
pnpm db:test
```

Esperado (os números abaixo foram medidos rodando estes arquivos contra o banco local com a função nova aplicada):

- `66_o_csv_do_maps.sql` — `plan(23)`, **23/23**;
- **`22_importacao_de_planilha.sql` — `plan(73)`, 73/73, sem uma linha alterada.** É esta a prova de que `importacao_previa` e `importacao_gravar` continuam funcionando com a planilha comum;
- `16_esteira_de_ingestao.sql` — `plan(125)`, 125/125 (a esteira não foi tocada);
- `33_desfazer_o_lote.sql` — 16/16; `55_a_triagem_do_radar.sql` — 11/11;
- o total da suíte sobe exatamente 23 em relação ao início da Tarefa 1.

Se o 22 ficar vermelho, a transcrição da função perdeu alguma coisa: compare linha a linha com `sed -n "363,579p" supabase/migrations/20260904001820_importacao_de_planilha.sql` antes de mexer no teste.

- [ ] **2.8 — lint, tipos e commit.**

```
pnpm db:lint
pnpm db:types
```

`app.importacao_normalizar` mantém a mesma assinatura (`{ Args: { p: Json }; Returns: Json }`, `database.types.ts:468`), então o arquivo gerado provavelmente não muda — rode assim mesmo e inclua o arquivo se mudar.

```
git add supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql \
        supabase/tests/66_o_csv_do_maps.sql
git commit -F - <<'MSG'
A importação deixa de jogar fora seis campos do Maps

O payload da esteira tinha 9 campos e a whitelist do R06 permite 22:
place_id, email, endereco, cep, nota e avaliacoes_qtd já tinham coluna
em source_record e morriam na porta. Agora entram os 15, o endereço
vira bairro/cidade/CEP, a categoria consulta o mapa da fonte antes da
queda difusa, o lugar vira a identidade na fonte no lugar do telefone,
e o CPF é varrido do endereço antes da raw_capture — que guarda o
payload cru.

Custo conhecido e medido: varrendo o CPF antes, o gatilho de higiene do
source_record não o vê mais, então a flag cpf_descartado e a linha de
field_provenance com reason='cpf' somem por este caminho. Duas asserções
no arquivo 66 fixam isso, e a pendência vai para o CHANGELOG.

A planilha-ponte continua entrando pela mesma função: 22_importacao_de_planilha
não foi tocado e segue com 73 asserções verdes.

Spec: docs/superpowers/specs/2026-09-24-pivo-scraper-e-robo-autonomo-design.md §3.2

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

**Pendência conhecida, para as tarefas seguintes.** `public.importacao_previa` ainda não sonda `place_id` (§3.2 item 4, Tarefa 3) e `public.esteira_processar_captura` ainda não carrega `cep`, `place_id`, `city_id` e a categoria no ramo de UPDATE (§3.2 item 5, Tarefa 4). Enquanto isso não entrar, a prévia diz "entra" para um lugar cujo `place_id` já é de uma ficha e a gravação responde "duplicata". A fonte `google_maps_raspado` e o mapa de categorias de produção (§3.2 itens 6 e 7) entram na Tarefa 5, em seções posteriores **deste mesmo arquivo de migração**.

---

## Tarefa 3: a prévia passa a sondar o `place_id` (§3.2 item 4)

**Arquivos:** `supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql` (ampliado), `supabase/tests/66_o_csv_do_maps.sql` (ampliado, `plan(23)` → `plan(29)`), `packages/schema/src/database.types.ts`.

**Interfaces**
- *Consome:* `app.importacao_normalizar` **na versão da Tarefa 2** — precisa de `place_id` no **topo** do objeto devolvido, não só dentro de `payload`; `app.find_org_matches`, `app.org_is_visible`, `app.can_write`, `app.role`; os auxiliares `pg_temp.entrar`/`sair`/`admin`/`linha_maps` e a fonte 966 do arquivo 66 (Tarefa 2).
- *Produz:* `public.importacao_previa(p_linhas jsonb) returns jsonb`, `language plpgsql stable security definer set search_path = ''` — **assinatura inalterada**; passa a sondar `place_id` em `app.find_org_matches` e na sonda das chaves únicas, com `reason = 'place_id'`. No arquivo 66: o bloco 5 (1 asserção, deixa em pé a organização `ZWQX PGTAP66 FICHA ANTIGA` com `place_id = 'CID-PGTAP66-5'` e a temp table `t3_previa`), o bloco 6 (3 asserções, `pg_temp.linha_reimporte()`) e o bloco 10 (2 asserções, `pg_temp.linha_suprimida()`).

**Por que esta tarefa existe.** `public.importacao_previa` é caminho crítico de **toda** importação: é ela que a tela mostra antes de gravar. Hoje o comentário dela diz "a sonda das QUATRO chaves" e o código sonda três (CNPJ, telefone, Instagram), enquanto `app.promover_candidato` bloqueia **também** por `place_id` (`supabase/migrations/20260905000100_dreno_reconfere.sql:482-495`). Com o CSV do Maps, onde o `cid` é a identidade mais forte e o telefone muda, a prévia diria "entra" e a gravação responderia "duplicata" — que é exatamente o defeito que uma prévia existe para não ter.

**Confira o pré-requisito com um comando, antes de escrever o teste:**

```
grep -n "'place_id'" supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql
```

Tem de aparecer tanto na montagem do `payload` quanto no `jsonb_build_object` do `return`. Se estiver só no payload, o conserto desta tarefa entra e o teste continua vermelho — e você vai procurar o erro na função errada.

**A rede de segurança, que NÃO pode ser alterada:** `supabase/tests/22_importacao_de_planilha.sql` (`select plan(73)`), seção 6 "A prévia não mente sobre o telefone FIXO", asserções nas linhas **423–432**. **Não edite o 22.**

### Passos

- [ ] **3.1 — escrever a asserção que falha (teste 5 de §3.5).** No topo do arquivo 66, troque `select plan(23);` por `select plan(29);`. No fim, **antes** de `select * from finish();`, cole:

```sql
-- =====================================================================
-- 5. A prévia sonda o place_id (§3.2 item 4)
-- =====================================================================
-- A ficha já está na base com o `cid` do lugar. O telefone é OUTRO (o Maps
-- devolve o número que o dono publicou hoje) e o nome também. Sem o place_id
-- nada casa: a prévia dizia "entra" e `app.promover_candidato` responderia
-- "ja_existe_na_base" com chave 'place_id' na hora de gravar.
--
-- Os dois nomes são propositalmente dissemelhantes (ZWQX / BKJV). A regra de
-- nome por trigram de `app.find_org_matches` não pode ser quem responde aqui,
-- senão a asserção passaria pelo motivo errado; e a ficha nasce sem linha em
-- `organization_categories`, o que também fecha o ramo de categoria daquela
-- regra (20260904000300:698-710).
select pg_temp.sair();   -- o bloco anterior pode ter deixado a sessão em papel

insert into public.organizations (kind, name, phone_e164, place_id, source_id, collector)
values ('fornecedor', 'ZWQX PGTAP66 FICHA ANTIGA', '+5584977660001', 'CID-PGTAP66-5',
        (select id from public.sources where slug = 'planilha'), 'pgTAP 66');

select pg_temp.entrar(pg_temp.admin(), 'admin');
create temp table t3_previa as
  select public.importacao_previa(jsonb_build_array(jsonb_build_object(
           'linha',     1,
           'nome',      'BKJV PGTAP66 NOME DE HOJE',
           'whatsapp',  '84 97766-0002',
           'place_id',  'CID-PGTAP66-5',
           'categoria', 'Fotografia e vídeo',
           'cidade',    'Natal',
           'origem',    'planilha'))) as j;
select pg_temp.sair();

select is(array[
    (select l ->> 'decisao'
       from jsonb_array_elements((select j from pg_temp.t3_previa) -> 'linhas') l),
    (select l -> 'duplicata' ->> 'chave'
       from jsonb_array_elements((select j from pg_temp.t3_previa) -> 'linhas') l),
    (select l -> 'duplicata' ->> 'nome'
       from jsonb_array_elements((select j from pg_temp.t3_previa) -> 'linhas') l)],
  array['duplicata', 'place_id', 'ZWQX PGTAP66 FICHA ANTIGA'],
  'a prévia recusa pelo place_id, diz qual chave casou e de quem é a ficha');
```

- [ ] **3.2 — rodar e ver falhar.**

```
pnpm db:test
```

Espere ver o arquivo 66 vermelho na asserção nova, com `have` valendo `{entra,NULL,NULL}`. Esse é o defeito, medido: sem `place_id`, `app.find_org_matches` não casa nada (o telefone da linha é outro) e a sonda das chaves únicas também não.

- [ ] **3.3 — implementar: a função inteira, já corrigida.** Acrescente ao fim de `supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql`:

```sql
-- ---------------------------------------------------------------------------
-- 4. A prévia sonda o place_id (§3.2 item 4)
-- ---------------------------------------------------------------------------
-- O comentário da função dizia "as QUATRO chaves" e o código sondava três. Com
-- o CSV do Maps a quarta é a que mais importa: o `cid` não muda, o telefone
-- muda. Duas mudanças, e só duas:
--   (a) `place_id` entra na chamada de `app.find_org_matches` — ela já conhece a
--       chave (0,98, entre CNPJ e @instagram, 20260904000300:673-675) e só não a
--       recebia daqui;
--   (b) `place_id` entra na sonda das chaves únicas, na MESMA ORDEM e com os
--       MESMOS NOMES de `app.promover_candidato` (20260905000100:482-495), que
--       é quem recusa de verdade. Prévia e gravação não podem discordar.
-- A sonda é cinto e suspensório: com (a) no lugar, quem responde primeiro é o
-- `find_org_matches`. Ela existe para o dia em que as duas listas divergirem.
-- Função transcrita inteira da definição viva
-- (20260904001820_importacao_de_planilha.sql:587-756); só as linhas marcadas
-- com "NOVO" mudaram.
create or replace function public.importacao_previa(p_linhas jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_linha   jsonb;
  v_n       jsonb;
  v_saida   jsonb := '[]'::jsonb;
  v_vistos  text[] := '{}'::text[];
  v_chave   text;
  v_dup     record;
  v_ja      record;
  v_decisao text;
  v_motivo  text;
  v_dupjson jsonb;
  v_conta   jsonb := jsonb_build_object('entra', 0, 'duplicata', 0, 'revisao', 0,
                                        'nao_contatar', 0, 'repetida', 0, 'erro', 0);
begin
  if not app.can_write() then
    raise exception 'Papel % não importa planilha', app.role() using errcode = '42501';
  end if;
  if jsonb_typeof(p_linhas) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'linhas_invalidas');
  end if;
  if jsonb_array_length(p_linhas) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'lote_grande_demais');
  end if;

  for v_linha in select value from jsonb_array_elements(p_linhas) loop
    v_n := app.importacao_normalizar(v_linha);
    v_dupjson := null;
    v_motivo := null;
    v_dup := null;
    v_ja := null;

    if v_n ->> 'erro' is not null then
      v_decisao := 'erro';
      v_motivo  := v_n ->> 'erro';
    elsif coalesce((v_n ->> 'optout')::boolean, false) then
      v_decisao := 'nao_contatar';
      v_motivo  := 'pediu_para_parar';
    else
      v_chave := coalesce(v_n ->> 'source_id', '0') || '|' || coalesce(v_n ->> 'external_id', '');
      if v_chave = any (v_vistos) then
        v_decisao := 'repetida';
        v_motivo  := 'repetida_no_arquivo';
      else
        v_vistos := v_vistos || v_chave;

        -- (1) Esta linha já entrou numa importação anterior? A esteira reconhece
        -- pelo par (fonte, id externo), que é o mesmo par da gravação. É o que
        -- faz a SEGUNDA prévia do mesmo arquivo dizer "já importado" em vez de
        -- prometer 68 fichas que não vão nascer.
        select o.id, o.name into v_ja
          from public.source_record sr
          join public.supplier_candidates c on c.id = sr.candidate_id
          join public.organizations o on o.id = c.organization_id and o.deleted_at is null
         where sr.source_id = coalesce((v_n ->> 'source_id')::int, -1)
           and sr.external_id = coalesce(v_n ->> 'external_id', '')
           and c.status = 'aprovado'
         limit 1;

        -- (2) UMA linha por ficha, a de maior confiança: `app.find_org_matches`
        -- devolve uma por REGRA que casou, e a mesma empresa três vezes na tela
        -- não é "três suspeitas", é ruído (mesmo critério da fila do Radar).
        select u.organization_id, u.nome, u.confidence, u.reason, u.visivel
          into v_dup
          from (
            select distinct on (m.organization_id)
                   m.organization_id,
                   case when app.org_is_visible(m.organization_id) then o.name end as nome,
                   app.org_is_visible(m.organization_id) as visivel,
                   m.confidence, m.reason
              from app.find_org_matches(jsonb_build_object(
                     'name', v_n ->> 'nome', 'cnpj', v_n ->> 'cnpj',
                     'phone_e164', v_n ->> 'telefone',
                     'instagram_handle', v_n ->> 'instagram',
                     'place_id', v_n ->> 'place_id',            -- NOVO
                     'city_id', v_n ->> 'cidade_id',
                     'neighborhood', v_n ->> 'bairro',
                     'category_id', v_n ->> 'categoria_id')) m
              join public.organizations o
                on o.id = m.organization_id and o.deleted_at is null
             order by m.organization_id, m.confidence desc, m.reason
          ) u
         order by u.confidence desc, u.nome
         limit 1;

        -- (3) A sonda das QUATRO chaves que são índice único, igual à de
        -- `app.promover_candidato`. Sem ela a prévia mentiria num caso concreto:
        -- um telefone FIXO repetido bloqueia a promoção, mas `find_org_matches`
        -- só casa telefone com celular (o fixo exige bairro igual). A prévia
        -- dizia "entra" e a gravação recusava — que é o defeito que uma prévia
        -- existe para não ter. A ordem do `case` e os nomes de chave são os de
        -- `app.promover_candidato`: se as duas listas divergirem, a prévia volta
        -- a mentir.
        if v_dup.organization_id is null then
          select o.id                     as organization_id,
                 case when app.org_is_visible(o.id) then o.name end as nome,
                 app.org_is_visible(o.id) as visivel,
                 0.95::numeric            as confidence,
                 (case when v_n ->> 'cnpj' is not null and o.cnpj = v_n ->> 'cnpj' then 'cnpj'
                       when v_n ->> 'place_id' is not null
                        and o.place_id = v_n ->> 'place_id' then 'place_id'   -- NOVO
                       when v_n ->> 'instagram' is not null
                        and o.instagram_handle = v_n ->> 'instagram' then 'instagram'
                       else 'phone' end)  as reason
            into v_dup
            from public.organizations o
           where o.deleted_at is null
             and ((v_n ->> 'cnpj' is not null and o.cnpj = v_n ->> 'cnpj')
               or (v_n ->> 'telefone' is not null and o.phone_e164 = v_n ->> 'telefone')
               or (v_n ->> 'instagram' is not null and o.instagram_handle = v_n ->> 'instagram')
               or (v_n ->> 'place_id' is not null and o.place_id = v_n ->> 'place_id'))  -- NOVO
           limit 1;
        end if;

        if v_dup.organization_id is not null then
          v_dupjson := jsonb_build_object(
            'organization_id', v_dup.organization_id,
            'nome', coalesce(v_dup.nome, 'Ficha de outra carteira'),
            'visivel', v_dup.visivel,
            'confianca', v_dup.confidence,
            'chave', v_dup.reason);
        end if;

        -- A ordem é a MESMA de `public.importacao_gravar`. Se estas duas listas
        -- de `if` divergirem, a prévia vira promessa quebrada — é por isso que
        -- elas estão comentadas uma em função da outra.
        if v_ja.id is not null then
          v_decisao := 'repetida';
          v_motivo  := 'ja_importado';
          v_dupjson := jsonb_build_object(
            'organization_id', v_ja.id,
            'nome', case when app.org_is_visible(v_ja.id) then v_ja.name
                         else 'Ficha de outra carteira' end,
            'visivel', app.org_is_visible(v_ja.id),
            'confianca', 1.0,
            'chave', 'lote_anterior');
        elsif v_dup.organization_id is not null then
          v_decisao := 'duplicata';
          v_motivo  := 'ja_existe_na_base';
        elsif v_n ->> 'categoria_id' is null then
          v_decisao := 'revisao';
          v_motivo  := 'categoria_desconhecida';
        elsif v_n ->> 'source_id' is null then
          v_decisao := 'revisao';
          v_motivo  := 'origem_desconhecida';
        else
          v_decisao := 'entra';
        end if;
      end if;
    end if;

    v_conta := jsonb_set(v_conta, array[v_decisao],
                         to_jsonb(coalesce((v_conta ->> v_decisao)::int, 0) + 1));
    v_saida := v_saida || jsonb_build_array(jsonb_build_object(
      'linha',            (v_n ->> 'linha')::int,
      'nome',             v_n ->> 'nome',
      'decisao',          v_decisao,
      'motivo',           v_motivo,
      'duplicata',        v_dupjson,
      'categoria',        v_n ->> 'categoria_nome',
      'cidade',           v_n ->> 'cidade_nome',
      'origem',           v_n ->> 'source_nome',
      'etapa',            v_n ->> 'etapa_nome',
      'responsavel',      v_n ->> 'responsavel_nome',
      'telefone',         v_n ->> 'telefone_visivel',
      'avisos',           v_n -> 'avisos'));
  end loop;

  return jsonb_build_object('ok', true, 'contagem', v_conta, 'linhas', v_saida);
end $$;
comment on function public.importacao_previa(jsonb) is
  'Prévia da importação de planilha (RF-BAS-07): linha a linha, o que vai acontecer — entra, é duplicata de QUAL ficha (com o nome), vai para revisão por qual motivo, ou não entra por ter pedido para parar. Sonda as quatro chaves de índice único, place_id incluído, na mesma ordem de app.promover_candidato. Não escreve nada. Máximo de 500 linhas por chamada.';
revoke all on function public.importacao_previa(jsonb) from public, anon;
grant execute on function public.importacao_previa(jsonb) to authenticated, service_role;
```

- [ ] **3.4 — escrever os testes do foco de revisão (itens 3 e 5 da lista do topo).** Estes dois **já passam** com o código de hoje e continuam passando depois: são rede de regressão sobre um critério de pronto (§13.3) e sobre um guardrail (§10, opt-out). Acrescente ao fim do arquivo, antes de `select * from finish();`:

```sql
-- =====================================================================
-- 6. Reimportar o mesmo arquivo não cria ficha nova (§3.5 teste 6;
--    critério de pronto 3 da §13) — foco de revisão 3
-- =====================================================================
-- Dois lotes com a MESMA linha. O primeiro grava; o segundo tem de responder
-- `repetida`/`ja_importado` na prévia E na gravação, e a base cresce UMA ficha
-- ao todo. Quem responde é o ramo (1) de `public.importacao_previa` — que esta
-- tarefa acabou de transcrever inteira — e o ramo `aprovado` de
-- `public.importacao_gravar`. Passa antes e depois: é a rede da transcrição.
--
-- A linha é própria, sem CNPJ e sem @: o CNPJ de fixture 11222333000181
-- poderia estar em outra ficha deste banco, e a asserção passaria a falhar por
-- 'duplicata' — motivo certo, teste errado.
create function pg_temp.linha_reimporte() returns jsonb language sql stable as $$
  select pg_temp.linha_maps(jsonb_build_object(
    'linha',     9,
    'nome',      'BUFFET C66 REIMPORTE',
    'whatsapp',  '84 97766-0090',
    'place_id',  'C66-REIMPORTE',
    'cnpj',      null,
    'instagram', null))
$$;

select pg_temp.sair();
create temp table t3b_antes as
  select count(*)::int as n from public.organizations where deleted_at is null;

select pg_temp.entrar(pg_temp.admin(), 'admin');
create temp table t3b_l1 as
  select (public.esteira_abrir_lote('planilha', 966, 'pgTAP 66 — primeira volta')
          ->> 'batch_id')::uuid as id;
create temp table t3b_g1 as
  select public.importacao_gravar((select id from t3b_l1),
                                  jsonb_build_array(pg_temp.linha_reimporte())) as j;
create temp table t3b_l2 as
  select (public.esteira_abrir_lote('planilha', 966, 'pgTAP 66 — segunda volta')
          ->> 'batch_id')::uuid as id;
create temp table t3b_p2 as
  select public.importacao_previa(jsonb_build_array(pg_temp.linha_reimporte())) as j;
create temp table t3b_g2 as
  select public.importacao_gravar((select id from t3b_l2),
                                  jsonb_build_array(pg_temp.linha_reimporte())) as j;
select pg_temp.sair();

select is(
  (select l ->> 'decisao'
     from jsonb_array_elements((select j from pg_temp.t3b_g1) -> 'linhas') l),
  'entra',
  'a primeira volta grava a ficha');

select is(array[
    (select l ->> 'decisao' from jsonb_array_elements((select j from pg_temp.t3b_p2) -> 'linhas') l),
    (select l ->> 'motivo'  from jsonb_array_elements((select j from pg_temp.t3b_p2) -> 'linhas') l),
    (select l ->> 'decisao' from jsonb_array_elements((select j from pg_temp.t3b_g2) -> 'linhas') l),
    (select l ->> 'motivo'  from jsonb_array_elements((select j from pg_temp.t3b_g2) -> 'linhas') l)],
  array['repetida', 'ja_importado', 'repetida', 'ja_importado'],
  'na segunda volta a prévia e a gravação dizem a MESMA coisa: já importado');

select is(
  (select count(*)::int from public.organizations where deleted_at is null)
  - (select n from pg_temp.t3b_antes),
  1,
  'e a base cresceu UMA ficha ao todo, não duas');

-- =====================================================================
-- 10. Quem pediu para parar não vira alvo (§3.5 teste 10; guardrail de
--     opt-out da §10) — foco de revisão 5
-- =====================================================================
-- `app.is_suppressed` é consultado dentro de `app.importacao_normalizar`, e a
-- decisão `nao_contatar` sai antes de qualquer escrita. Esta asserção é rede:
-- ela existe para o dia em que alguém reordenar os `if` da prévia e a
-- supressão virar enfeite. `app.suppress` é concedida só a service_role
-- (20260904000400:493), por isso a sessão volta ao superusuário.
create function pg_temp.linha_suprimida() returns jsonb language sql stable as $$
  select pg_temp.linha_maps(jsonb_build_object(
    'linha',     10,
    'nome',      'BUFFET C66 PEDIU PARA PARAR',
    'whatsapp',  '84 97766-0099',
    'place_id',  'C66-SUPRIMIDO',
    'cnpj',      null,
    'instagram', null))
$$;

select pg_temp.sair();
select app.suppress('phone', app.normalize_phone_br('84 97766-0099'),
                    'pgTAP 66 — pediu para parar', 'whatsapp'::app.channel, null);

select pg_temp.entrar(pg_temp.admin(), 'admin');
create temp table t3c_l as
  select (public.esteira_abrir_lote('planilha', 966, 'pgTAP 66 — quem pediu para parar')
          ->> 'batch_id')::uuid as id;
create temp table t3c_p as
  select public.importacao_previa(jsonb_build_array(pg_temp.linha_suprimida())) as j;
create temp table t3c_g as
  select public.importacao_gravar((select id from t3c_l),
                                  jsonb_build_array(pg_temp.linha_suprimida())) as j;
select pg_temp.sair();

select is(array[
    (select l ->> 'decisao' from jsonb_array_elements((select j from pg_temp.t3c_p) -> 'linhas') l),
    (select l ->> 'motivo'  from jsonb_array_elements((select j from pg_temp.t3c_p) -> 'linhas') l),
    (select l ->> 'decisao' from jsonb_array_elements((select j from pg_temp.t3c_g) -> 'linhas') l)],
  array['nao_contatar', 'pediu_para_parar', 'nao_contatar'],
  'telefone na suppression_list: a prévia recusa antes de escrever, e a gravação também');

select is(array[
    (select count(*)::int from public.organizations o where o.place_id = 'C66-SUPRIMIDO'),
    (select count(*)::int from public.deals d
       join public.organizations o on o.id = d.organization_id
      where o.place_id = 'C66-SUPRIMIDO')],
  array[0, 0],
  'e nada nasce: nem ficha nem negócio para quem pediu para parar');
```

- [ ] **3.5 — aplicar e ver passar.**

```
pnpm db:reset
pnpm db:test
```

O arquivo 66 fica verde nas 6 asserções novas (`plan(29)`, 29/29). **Confira no resumo do pg_prove que `supabase/tests/22_importacao_de_planilha.sql` e `supabase/tests/16_esteira_de_ingestao.sql` aparecem com `.. ok`** (73 e 125 asserções) — é a prova de que a transcrição não perdeu linha. Se algum sair vermelho, `diff` a função nova contra `sed -n '587,756p' supabase/migrations/20260904001820_importacao_de_planilha.sql` antes de mexer em qualquer outra coisa.

- [ ] **3.6 — tipos e commit.**

```
pnpm db:types
git add supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql supabase/tests/66_o_csv_do_maps.sql packages/schema/src/database.types.ts
git commit -F - <<'MSG'
A prévia da importação enxerga o place_id

O comentário dizia "as QUATRO chaves" e a sonda testava três. app.promover_candidato
bloqueia também por place_id: sem isto a prévia prometia ficha que a gravação recusava.

Entram junto duas redes que faltavam: reimportar o mesmo arquivo devolve
repetida/ja_importado na prévia e na gravação e a base cresce uma ficha só, e
telefone na suppression_list não abre ficha nem negócio.

Vale para RF-BAS-07, RF-BAS-08 e para a Fase 1 do pivô do Maps. D1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

`database.types.ts` deve sair **sem diferença** (a assinatura de `importacao_previa` não mudou); se aparecer diff, é sinal de outra coisa — pare e olhe.

---

## Tarefa 4: o ramo "mudou na fonte" passa a carregar CEP, place_id, cidade e categoria (§3.2 item 5)

**Arquivos:** `supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql` (ampliado), `supabase/tests/66_o_csv_do_maps.sql` (ampliado, `plan(29)` → `plan(32)`), `docs/CHANGELOG.md`, `packages/schema/src/database.types.ts`.

**Interfaces**
- *Consome:* os mesmos auxiliares do arquivo 66 (Tarefa 2) e a versão de `app.importacao_normalizar` da Tarefa 2. **Não** depende da fonte `google_maps_raspado` (Tarefa 5): usa a fonte `planilha`, que já está na seed.
- *Produz:* `public.esteira_processar_captura(p_raw_capture_id uuid) returns jsonb`, `language plpgsql security definer set search_path = ''` — **assinatura inalterada**; o ramo "mudou na fonte" passa a carregar `cep`, `place_id`, `city_id`, `category_source` e `category_id`, todos com `coalesce`. No arquivo 66: a temp table `pg_temp.t4_ids (chave text primary key, v uuid)` com as chaves `lote1, lote2, rc1, sr1, cand, org, rc2, sr2`, um mapa `(planilha,'confeitaria') → doces_bolos_confeitaria`, e a organização `DOCERIA PGTAP66` com `place_id = 'CID-PGTAP66-7'`.

**Por que esta tarefa existe.** `public.esteira_processar_captura` é caminho crítico de **toda** importação e de toda coleta. O ramo de INSERT carrega 29 colunas; o de UPDATE carrega 18. Entre as que faltam estão `cep`, `place_id`, `city_id` e o par `category_source`/`category_id`. Consequência concreta: uma segunda raspagem que traga o CEP, a cidade ou a categoria **pela primeira vez** nunca os grava, e a linha que foi para a Revisão por `categoria_desconhecida` fica presa lá para sempre — justo o risco 5 da §11, onde 600 linhas do Maps chegam com categoria em texto livre.

Mudam **quatro campos** (cinco colunas), todos com `coalesce`. Os outros que o INSERT carrega e o UPDATE não (`source_url`, `price_from`, `capacity_max`, `photos_count`, `opened_at`, `is_mei`, `external_id`) **ficam como estão** — não é esta a tarefa. (`source_id` e `external_id` são a chave da busca; não se atualizam por definição.)

**A rede de segurança, que NÃO pode ser alterada:** `supabase/tests/16_esteira_de_ingestao.sql` (`select plan(125)`), asserções das linhas **424–428**. **Não edite o 16.**

### Passos

- [ ] **4.1 — escrever as asserções que falham (testes 7 e 8 de §3.5).** No topo, troque `select plan(29);` por `select plan(32);`. No fim, **antes** de `select * from finish();`, cole:

```sql
-- =====================================================================
-- 7 e 8. Segundo lote do mesmo lugar: completa sem duplicar (§3.2 item 5)
-- =====================================================================
-- Duas raspagens do mesmo `cid`. A primeira vem magra (o Maps nem sempre
-- devolve endereço e categoria); a segunda traz nota nova, CEP, cidade e
-- categoria. O ramo "mudou na fonte" tem de carregar os quatro — e ainda
-- assim produzir UM candidato e UMA ficha.
--
-- Dois lotes, e não um: a chave de idempotência da captura é
-- (batch_id, request_key), e o gatilho `app.raw_capture_normalize` monta
-- request_key = sha256(source_id|coalesce(source_url, external_id, ''))
-- (20260904001600:351-352). No mesmo lote, a segunda captura voltaria como
-- `pedido_repetido` e nada seria processado.
--
-- A sessão volta a ser a do superusuário: `public.esteira_gravar_captura`,
-- `public.esteira_processar_captura` e `app.promover_candidato` são revogadas
-- de `authenticated` e concedidas só a `service_role`
-- (20260904001600:2373-2374, 2381 e 1359-1362).
select pg_temp.sair();

-- O mapa de categoria desta fonte, só para este teste; o rollback desfaz.
-- A seed só popula `source_category_map` para `casamentos_com_br`
-- (supabase/seed.sql:252-283), então não há linha anterior a preservar.
insert into public.source_category_map (source_id, category_source, category_id)
values ((select id from public.sources where slug = 'planilha'), 'confeitaria',
        (select id from public.categories where slug = 'doces_bolos_confeitaria'))
on conflict (source_id, category_source) do nothing;

create table pg_temp.t4_ids (chave text primary key, v uuid);

insert into pg_temp.t4_ids
select 'lote1', (public.esteira_abrir_lote('planilha',
                   (select id from public.sources where slug = 'planilha'),
                   'pgTAP 66 — primeira raspagem') ->> 'batch_id')::uuid;
insert into pg_temp.t4_ids
select 'lote2', (public.esteira_abrir_lote('planilha',
                   (select id from public.sources where slug = 'planilha'),
                   'pgTAP 66 — segunda raspagem') ->> 'batch_id')::uuid;

-- Primeira raspagem: sem CEP, sem cidade, sem categoria. A `source_url` vai no
-- PAYLOAD (é assim que `public.importacao_gravar` faz, :880-887) e não no
-- argumento: o argumento entra na chave de idempotência e faria a segunda
-- linha de uma mesma listagem ser engolida como pedido repetido.
insert into pg_temp.t4_ids
select 'rc1', (public.esteira_gravar_captura(
          (select v from pg_temp.t4_ids where chave = 'lote1'),
          (select id from public.sources where slug = 'planilha'),
          jsonb_build_object('nome_comercial', 'DOCERIA PGTAP66',
                             'place_id',       'CID-PGTAP66-7',
                             'telefones',      jsonb_build_array('84 98766-0007'),
                             'source_url',     'https://www.google.com/maps/place/?q=place_id:CID-PGTAP66-7',
                             'nota',           '4.5'),
          'CID-PGTAP66-7', null, null, 'pgTAP 66') ->> 'raw_capture_id')::uuid;

-- Cada chamada no seu PRÓPRIO comando, e o retorno guardado em vez de
-- descartado: se `esteira_processar_captura` ou `promover_candidato`
-- recusarem, a coluna `v` vem nula e o motivo aparece aqui, e não seis linhas
-- adiante como uma contagem zero sem explicação. É a mesma disciplina do
-- comentário de 16_esteira_de_ingestao.sql:320-326.
insert into pg_temp.t4_ids
select 'sr1', (public.esteira_processar_captura(
                 (select v from pg_temp.t4_ids where chave = 'rc1'))
               ->> 'source_record_id')::uuid;

insert into pg_temp.t4_ids
select 'cand', (select sr.candidate_id from public.source_record sr
                 where sr.id = (select v from pg_temp.t4_ids where chave = 'sr1'));

insert into pg_temp.t4_ids
select 'org', (app.promover_candidato(
                 (select v from pg_temp.t4_ids where chave = 'cand'),
                 null, null, null, null,
                 (select id from public.categories where slug = 'buffet_adulto_corporativo'),
                 (select v from pg_temp.t4_ids where chave = 'lote1'))
               ->> 'organization_id')::uuid;

-- Segunda raspagem: nota nova, e CEP, cidade e categoria pela primeira vez.
insert into pg_temp.t4_ids
select 'rc2', (public.esteira_gravar_captura(
          (select v from pg_temp.t4_ids where chave = 'lote2'),
          (select id from public.sources where slug = 'planilha'),
          jsonb_build_object('nome_comercial',   'DOCERIA PGTAP66',
                             'place_id',         'CID-PGTAP66-7',
                             'telefones',        jsonb_build_array('84 98766-0007'),
                             'source_url',       'https://www.google.com/maps/place/?q=place_id:CID-PGTAP66-7',
                             'nota',             '4.8',
                             'cep',              '59082-095',
                             'cidade',           'Natal',
                             'categoria_origem', 'Confeitaria'),
          'CID-PGTAP66-7', null, null, 'pgTAP 66') ->> 'raw_capture_id')::uuid;
insert into pg_temp.t4_ids
select 'sr2', (public.esteira_processar_captura(
                 (select v from pg_temp.t4_ids where chave = 'rc2'))
               ->> 'source_record_id')::uuid;

select is(array[
    (select count(*)::int from public.supplier_candidates c where c.place_id = 'CID-PGTAP66-7'),
    (select count(*)::int from public.organizations o
      where o.place_id = 'CID-PGTAP66-7' and o.deleted_at is null),
    (select count(*)::int from public.source_record sr
      where sr.id = (select v from pg_temp.t4_ids where chave = 'sr1')
        and sr.id = (select v from pg_temp.t4_ids where chave = 'sr2')
        and 'mudou_na_fonte' = any (sr.flags))],
  array[1, 1, 1],
  'segunda raspagem com nota nova: um candidato, uma ficha, o mesmo registro de fonte marcado mudou_na_fonte');

-- O CEP é comparado só com dígitos: o gatilho `app.source_record_normalize`
-- guarda `cep` sem a máscara (20260904001600:690).
select is(
    (select array[sr.cep, sr.city_id::text, sr.category_id::text, sr.category_source]
       from public.source_record sr
      where sr.id = (select v from pg_temp.t4_ids where chave = 'sr2')),
    array['59082095',
          (select id::text from public.cities where name = 'Natal' and state = 'RN'),
          (select id::text from public.categories where slug = 'doces_bolos_confeitaria'),
          'confeitaria'],
  'o segundo lote grava CEP, cidade e categoria que o primeiro não tinha');
```

- [ ] **4.2 — escrever o teste do foco de revisão (item 4 da lista do topo).** Em seguida, ainda antes de `select * from finish();`:

```sql
-- =====================================================================
-- 11. "De onde vocês tiraram o meu número?" (§3.5 teste 11; critério de
--     pronto 2 da §13; guardrail de proveniência da §10) — foco de revisão 4
-- =====================================================================
-- `app.resolver_source_record` grava `public.field_provenance` para dez campos
-- (20260904001600:969-983), com a `source_url` do `source_record` — que vem do
-- payload, porque a captura é gravada com o argumento `p_source_url` nulo de
-- propósito. Se alguém tirar `source_url` do payload da importação, a resposta
-- ao titular volta a ser "fontes públicas", que é literalmente o que multou a
-- KASPR. Passa hoje, e é para continuar passando.
--
-- Roda como superusuário: `public.origem_dos_dados` confere
-- `app.org_is_visible`, e sem JWT `app.role()` cai em `leitura`, que está em
-- `app.sees_all()` (20260904000500:46-50).
select is(
  (select array_agg(c ->> 'campo' order by c ->> 'campo' collate "C")
     from jsonb_array_elements(
            public.origem_dos_dados((select v from pg_temp.t4_ids where chave = 'org'))
            -> 'campos') c
    where c ->> 'url' = 'https://www.google.com/maps/place/?q=place_id:CID-PGTAP66-7'
      and c ->> 'campo' in ('phone_e164', 'place_id')),
  array['phone_e164', 'place_id'],
  'a ficha responde de onde veio o número com a URL do lugar no Maps, em phone_e164 E em place_id');
```

- [ ] **4.3 — rodar e ver falhar.**

```
pnpm db:test
```

A asserção 7 passa: o ramo já marca `mudou_na_fonte`, já reencontra o mesmo `source_record` pelo par (fonte, id externo) e já não duplica — ela é regressão, e está aqui para que o conserto do passo seguinte não quebre nada disso. A asserção 11 também passa, pelo mesmo motivo. **A 8 falha**, com `have` valendo `{NULL,NULL,NULL,NULL}`: `cep`, `city_id`, `category_id` e `category_source` nunca foram gravados, porque a primeira raspagem não os trouxe e a segunda não os carrega. É a prova do defeito.

Se a 7 também falhar, o problema não é este: olhe primeiro se alguma das linhas `insert into pg_temp.t4_ids` deixou `v` nulo (`select * from pg_temp.t4_ids;`).

- [ ] **4.4 — implementar: a função inteira, já corrigida.** Acrescente ao fim de `supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql`:

```sql
-- ---------------------------------------------------------------------------
-- 5. O ramo "mudou na fonte" passa a carregar quatro campos (§3.2 item 5)
-- ---------------------------------------------------------------------------
-- O ramo de INSERT carregava 29 colunas e o de UPDATE, 18. Quatro das que
-- faltavam custam caro na Fase 1: `cep`, `place_id`, `city_id` e o par
-- `category_source`/`category_id`. O Maps não devolve tudo em toda rodada — uma
-- segunda raspagem que trouxesse o CEP, a cidade ou a categoria pela PRIMEIRA
-- vez simplesmente não os gravava, e a linha que caiu na Revisão por
-- `categoria_desconhecida` ficava presa lá para sempre.
-- Os quatro entram com `coalesce(<o que veio>, <o que já estava>)`: a fonte só
-- preenche vazio, nunca apaga o que alguém confirmou (RF-RAD-08).
-- Os outros que só o INSERT carrega (`source_url`, `price_from`,
-- `capacity_max`, `photos_count`, `opened_at`, `is_mei`, `external_id`) ficam
-- como estão: não é este o conserto, e esta função é caminho crítico de toda
-- importação. Transcrita inteira da definição viva
-- (20260904001600_esteira_de_ingestao.sql:1868-1978); só as linhas marcadas
-- com "NOVO" mudaram.
create or replace function public.esteira_processar_captura(p_raw_capture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rc    public.raw_capture;
  v_p     jsonb;
  v_id    uuid;
  v_hash  text;
  v_antes text;
  v_ext   text;
  v_city  int;
  v_cat   int;
  v_tel   text;
begin
  select * into v_rc from public.raw_capture where id = p_raw_capture_id;
  if v_rc.id is null then
    return jsonb_build_object('ok', false, 'reason', 'captura_inexistente');
  end if;
  v_p := v_rc.payload;

  -- Identidade do registro na fonte: o id externo da captura, e na falta dele o
  -- que a fonte usa como identidade (CNPJ, place_id, @). Sem identidade não há
  -- como reconhecer o mesmo fornecedor na próxima coleta.
  v_ext := coalesce(v_rc.external_id, v_p ->> 'place_id',
                    app.normalize_cnpj(v_p ->> 'cnpj'),
                    app.normalize_instagram(v_p ->> 'instagram'),
                    v_rc.source_url);
  if v_ext is null then
    return jsonb_build_object('ok', false, 'reason', 'sem_identidade_na_fonte');
  end if;

  select c.id into v_city
    from public.cities c
   where app.search_name(c.name) = app.search_name(v_p ->> 'cidade')
   limit 1;
  select m.category_id into v_cat
    from public.source_category_map m
   where m.source_id = v_rc.source_id
     and m.category_source = lower(trim(coalesce(v_p ->> 'categoria_origem', '')))
   limit 1;

  -- O telefone principal é o primeiro que normaliza. Todos ficam em `phones`.
  select app.normalize_phone_br(t) into v_tel
    from jsonb_array_elements_text(
           case when jsonb_typeof(v_p -> 'telefones') = 'array' then v_p -> 'telefones'
                else '[]'::jsonb end) t
   where app.normalize_phone_br(t) is not null
   limit 1;

  v_hash := app.payload_hash(v_p);

  select sr.id, sr.content_hash into v_id, v_antes
    from public.source_record sr
   where sr.source_id = v_rc.source_id and sr.external_id = v_ext;

  if v_id is null then
    insert into public.source_record
      (raw_capture_id, batch_id, source_id, external_id, source_url,
       name, legal_name, cnpj, phone_e164, phones, email, instagram_handle, website,
       place_id, city_id, neighborhood, address, cep, category_source, category_id,
       rating, reviews_count, price_from, capacity_max, photos_count,
       opened_at, is_mei, registry_status, content_hash)
    values
      (v_rc.id, v_rc.batch_id, v_rc.source_id, v_ext, coalesce(v_rc.source_url, v_p ->> 'source_url'),
       coalesce(v_p ->> 'nome_comercial', v_p ->> 'razao_social'), v_p ->> 'razao_social',
       v_p ->> 'cnpj', v_tel,
       case when jsonb_typeof(v_p -> 'telefones') = 'array' then v_p -> 'telefones' else '[]'::jsonb end,
       nullif(v_p ->> 'email', '')::extensions.citext, v_p ->> 'instagram', v_p ->> 'site',
       v_p ->> 'place_id', v_city, v_p ->> 'bairro', v_p ->> 'endereco', v_p ->> 'cep',
       lower(nullif(trim(coalesce(v_p ->> 'categoria_origem', '')), '')), v_cat,
       nullif(v_p ->> 'nota', '')::numeric, nullif(v_p ->> 'avaliacoes_qtd', '')::int,
       nullif(v_p ->> 'preco_a_partir_de', '')::numeric, nullif(v_p ->> 'capacidade_max', '')::int,
       nullif(v_p ->> 'fotos_qtd', '')::int,
       nullif(v_p ->> 'data_abertura', '')::date,
       nullif(v_p ->> 'mei', '')::boolean, v_p ->> 'situacao_cadastral', v_hash)
    returning id into v_id;
  elsif v_antes = v_hash then
    -- Nada mudou na fonte: só o carimbo de "visto agora". A mensagem é
    -- concluída e o candidato não é tocado.
    update public.source_record set last_seen_at = now(), raw_capture_id = v_rc.id where id = v_id;
    return jsonb_build_object('ok', true, 'mudou', false, 'source_record_id', v_id);
  else
    -- Mudou em campo-chave: o candidato ganha a marca `mudou_na_fonte` e volta
    -- para a fila de quem revisa (situação cadastral baixada, telefone novo).
    update public.source_record sr
       set raw_capture_id = v_rc.id, batch_id = v_rc.batch_id,
           name = coalesce(v_p ->> 'nome_comercial', v_p ->> 'razao_social', sr.name),
           legal_name = coalesce(v_p ->> 'razao_social', sr.legal_name),
           cnpj = coalesce(v_p ->> 'cnpj', sr.cnpj),
           phone_e164 = coalesce(v_tel, sr.phone_e164),
           phones = case when jsonb_typeof(v_p -> 'telefones') = 'array' then v_p -> 'telefones' else sr.phones end,
           email = coalesce(nullif(v_p ->> 'email', '')::extensions.citext, sr.email),
           instagram_handle = coalesce(v_p ->> 'instagram', sr.instagram_handle),
           website = coalesce(v_p ->> 'site', sr.website),
           address = coalesce(v_p ->> 'endereco', sr.address),
           neighborhood = coalesce(v_p ->> 'bairro', sr.neighborhood),
           cep = coalesce(v_p ->> 'cep', sr.cep),                              -- NOVO
           place_id = coalesce(v_p ->> 'place_id', sr.place_id),               -- NOVO
           city_id = coalesce(v_city, sr.city_id),                             -- NOVO
           category_source = coalesce(                                         -- NOVO
             lower(nullif(trim(coalesce(v_p ->> 'categoria_origem', '')), '')),
             sr.category_source),
           category_id = coalesce(v_cat, sr.category_id),                      -- NOVO
           registry_status = coalesce(v_p ->> 'situacao_cadastral', sr.registry_status),
           rating = coalesce(nullif(v_p ->> 'nota', '')::numeric, sr.rating),
           reviews_count = coalesce(nullif(v_p ->> 'avaliacoes_qtd', '')::int, sr.reviews_count),
           content_hash = v_hash,
           last_seen_at = now(),
           flags = (select coalesce(array_agg(distinct f order by f), '{}')
                      from unnest(sr.flags || array['mudou_na_fonte']) f)
     where sr.id = v_id;
  end if;

  return app.resolver_source_record(v_id) || jsonb_build_object('source_record_id', v_id, 'mudou', true);
end $$;
comment on function public.esteira_processar_captura(uuid) is
  'Captura → source_record (com a higiene do RF-BAS-16 em gatilho) → candidato. Conteúdo idêntico só atualiza last_seen_at; conteúdo mudado marca `mudou_na_fonte`, COMPLETA o que estava vazio (inclusive CEP, place_id, cidade e categoria) e devolve o candidato à revisão.';
revoke all on function public.esteira_processar_captura(uuid) from public, anon, authenticated;
grant execute on function public.esteira_processar_captura(uuid) to service_role;
```

- [ ] **4.5 — aplicar e ver passar.**

```
pnpm db:reset
pnpm db:test
```

As três asserções novas ficam verdes (`plan(32)`, 32/32). **Confira no resumo do pg_prove que `supabase/tests/16_esteira_de_ingestao.sql` e `supabase/tests/22_importacao_de_planilha.sql` seguem com `.. ok`** (125 e 73). Se o 16 cair, `diff` a função nova contra `sed -n '1868,1978p' supabase/migrations/20260904001600_esteira_de_ingestao.sql`.

- [ ] **4.6 — tipos.**

```
pnpm db:types
```

`database.types.ts` deve sair sem diferença: nem `importacao_previa` nem `esteira_processar_captura` mudaram de assinatura. Se aparecer diff, pare e olhe o que mais entrou na migração.

- [ ] **4.7 — CHANGELOG e commit.** Os consertos das Tarefas 3 e 4 são duas metades da mesma migração, então vão numa entrada só. Acrescente ao topo da seção do dia em `docs/CHANGELOG.md`:

```markdown
- **Esteira de importação, dois consertos de `place_id` e de campo vazio** (Fase 1 do pivô do Maps,
  RF-BAS-07, RF-BAS-08, RF-RAD-08, ADR-08). `public.importacao_previa` passa a sondar `place_id`, na
  mesma ordem e com os mesmos nomes de chave de `app.promover_candidato` — a prévia não promete mais
  ficha que a gravação recusa. `public.esteira_processar_captura` passa a carregar `cep`, `place_id`,
  `city_id` e `category_source`/`category_id` no ramo "mudou na fonte", com `coalesce`: a segunda
  raspagem completa o que faltava em vez de deixar a linha presa na Revisão. Cobertura em
  `supabase/tests/66_o_csv_do_maps.sql` (testes 5, 6, 7, 8, 10 e 11); `16` e `22` intocados e verdes.
  Pendente: o descarte de CPF deixou de gerar linha em `public.field_provenance` (a limpeza agora
  acontece antes do gatilho do `source_record`) — o conserto natural é `public.importacao_gravar`
  registrar a proveniência quando a linha trouxer o aviso `cpf_descartado`, e isso não cabe nesta
  fase. Decisão humana: se essa pendência entra na Fase 2 ou espera.
```

```
git add supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql supabase/tests/66_o_csv_do_maps.sql packages/schema/src/database.types.ts docs/CHANGELOG.md
git commit -F - <<'MSG'
A segunda raspagem grava o CEP, a cidade e a categoria que faltavam

O ramo "mudou na fonte" de esteira_processar_captura carregava 18 das 29 colunas
do ramo de INSERT. Quatro entram com coalesce: cep, place_id, city_id e o par
category_source/category_id. Sem isto a linha que caiu na Revisão por
categoria_desconhecida ficava presa lá.

Entra junto a rede da proveniência: a ficha responde origem_dos_dados com a URL
do lugar no Maps em phone_e164 e em place_id, que é o critério 2 do pronto.

Fase 1 do pivô do Maps, ADR-08, RF-RAD-08. D1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Tarefa 5: a fonte nova, o mapa de categorias, o `entrada_por_arquivo` e o índice do lugar

**Arquivos:** `supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql` (blocos 6 a 9 no fim), `supabase/seed.sql`, `supabase/tests/66_o_csv_do_maps.sql` (`plan(32)` → `plan(43)`), `docs/CHANGELOG.md`.

**Interfaces**
- *Consome:* `public.sources`, `public.categories`, `public.source_category_map`, `public.esteira_abrir_lote`, `app.importacao_fonte`, `app.chave_catalogo` — todos existentes. Nenhuma função nova do Postgres nasce aqui.
- *Produz:*
  - `public.sources` com `slug='google_maps_raspado'`: `name='Google Maps (raspagem local)'`, `kind='import'`, `base_url='https://www.google.com/maps'`, `legal_basis='legitimo_interesse'`, `robots_ok=false`, `rate_limit_seconds=5.00`, `is_enabled=false`, `config={"collector":{"kind":"externo","phase":"mvp","enabled":false},"entrada_por_arquivo":true,"ferramenta":"google-maps-scraper-kit (MIT) sobre gosom/google-maps-scraper","adr":"ADR-12"}`. **A linha vive só na migração**, não em `supabase/seed.sql`.
  - 12 linhas em `public.source_category_map` para essa fonte, chave em minúscula e **com acento** — espelhadas na seed.
  - `config->>'entrada_por_arquivo' = 'true'` em exatamente duas fontes (`google_maps_raspado` e `planilha`). **É este o filtro do seletor de origem de `/importar`, e não `is_enabled`.**
  - `index supplier_candidates_place_idx on public.supplier_candidates (place_id) where place_id is not null` — parcial e **não único**.
  - Na seed: `n_map_google int` na autoverificação do bloco 13 e a exceção `'seed: mapa de categorias do Google Maps com % linhas (esperadas 12, ADR-12)'`.

**Antes de escrever a primeira linha, uma porta que não é de código.** A §12, decisão 1, diz que a redação exata do `terms_notes` de `google_maps_raspado` é **do Rafael, e não delegável**: "é a linha que vai ser lida se alguém perguntar por que raspamos". O texto abaixo é o da spec §3.3, transcrito. Mande a ele o bloco 6 da migração (só ele) e só suba o commit do passo 5.2 depois do "pode subir". Se ele reescrever, o texto novo entra **na migração** e as quatro asserções de conteúdo do passo 5.1 continuam valendo (elas conferem os quatro pedaços que não podem sumir na reescrita: os ToS do Google, o SCR-04, o ADR-12 e o limite da rodada).

**Antes de começar**, no terminal:

```bash
cd /Users/matheusrondon/Documents/Tríade
source scripts/dev-env.sh
supabase status   # se não estiver de pé: pnpm db:start
```

**Uma nota sobre a contagem de asserções.** A §13, Fase 1, item 8 pede "o arquivo 66 somando 15 asserções". Os 15 são os **casos** listados em §3.5, não asserções: esta tarefa sozinha cobre os casos 12 e 13 e acrescenta 11 asserções. O arquivo termina a Fase 1 em 43 — isso é esperado, e ninguém deve apagar asserção para fazer o número bater. O critério de §13 é que vai precisar de outro número.

**O ciclo de cada passo** é sempre `pnpm db:reset && pnpm db:test`: o que muda é migração e seed, não função em memória.

### Passos

- [ ] **5.1 — escrever o teste que falha: a fonte `google_maps_raspado`.** São 7 asserções. No topo do arquivo 66, troque `select plan(32);` por `select plan(39);`. Imediatamente **antes** de `select * from finish();`, cole:

```sql
-- =====================================================================
-- A fonte nova: a linha é o registro escrito da decisão (§3.3, ADR-12)
-- =====================================================================
select ok(exists (
  select 1 from public.sources s
   where s.slug = 'google_maps_raspado'
     and s.name = 'Google Maps (raspagem local)'
     and s.kind = 'import'
     and s.base_url = 'https://www.google.com/maps'
     and s.legal_basis = 'legitimo_interesse'
     and s.robots_ok = false
     and s.rate_limit_seconds = 5.00
     and s.is_enabled = false),
  'a fonte google_maps_raspado existe: kind import, robots_ok false, 5 s entre requisições, desligada');

select ok(coalesce((select s.terms_notes like '%CONTRARIA OS TERMOS DE SERVIÇO DO GOOGLE%'
                     and s.terms_notes like '%SCR-04%'
                     and s.terms_notes like '%ADR-12%'
                     and s.terms_notes like '%600 lugares por rodada%'
                      from public.sources s where s.slug = 'google_maps_raspado'), false),
  'terms_notes carrega os quatro pedaços que nenhuma reescrita pode perder: os ToS do Google, a revogação do SCR-04, o ADR-12 e o limite da rodada');

select is(
  (select s.config from public.sources s where s.slug = 'google_maps_raspado'),
  '{"adr": "ADR-12", "collector": {"kind": "externo", "phase": "mvp", "enabled": false}, "entrada_por_arquivo": true, "ferramenta": "google-maps-scraper-kit (MIT) sobre gosom/google-maps-scraper"}'::jsonb,
  'o config da fonte é o do ADR-12: coletor externo e desligado, entrada por arquivo ligada');

-- =====================================================================
-- Teste 12 de §3.5 — a fonte nova não coleta; ela recebe arquivo
-- =====================================================================
select is(
  public.esteira_abrir_lote('coleta',
    (select s.id from public.sources s where s.slug = 'google_maps_raspado'),
    'pgTAP maps coleta') ->> 'reason',
  'origem_desabilitada',
  'lote de COLETA na fonte nova é recusado: o CRM não visita o Google');

select ok((public.esteira_abrir_lote('planilha',
    (select s.id from public.sources s where s.slug = 'google_maps_raspado'),
    'pgTAP maps planilha') ->> 'ok')::boolean,
  'lote de PLANILHA na fonte nova abre: o CSV entra pela porta que já existe');

-- =====================================================================
-- Teste 13 de §3.5 — o rótulo do seletor não se confunde com o Places
-- =====================================================================
select is(
  (select s.slug from public.sources s
    where s.id = (app.importacao_fonte('Google Maps (raspagem local)') ->> 'id')::int),
  'google_maps_raspado',
  'o nome do seletor de origem casa com a fonte raspada');

select is(
  (select s.slug from public.sources s
    where s.id = (app.importacao_fonte('Google Maps') ->> 'id')::int),
  'google_places',
  '"Google Maps" continua sendo o conector oficial do Places: a proveniência não se confunde');
```

Duas coisas para quem vier depois: a asserção do lote de planilha **cria de verdade** uma linha em `public.import_batches` (com `label = 'pgTAP maps planilha'`), que só some no `rollback` — qualquer asserção futura que conte lotes tem de filtrar por `label`. E o bloco inteiro vai no fim, depois das fixtures das tarefas 1 a 4, para não atravessar nenhuma delas.

Rode e veja falhar:

```bash
pnpm db:reset && pnpm db:test
```

**Seis das sete falham.** A fonte não existe: `ok(false)`, `is(NULL, …)`, e `esteira_abrir_lote` recebe `p_source_id` nulo — devolve `origem_invalida` (não `origem_desabilitada`) no primeiro caso e `ok = false` no segundo. A sétima — a do `google_places` — **já passa**, e é de propósito: é a guarda que prova que a fonte nova não rouba o casamento do conector oficial. Não commite ainda.

- [ ] **5.2 — a fonte nova na migração (e só lá).** Acrescente no **fim** de `supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql`:

```sql
-- ---------------------------------------------------------------------
-- 6. A fonte nova, com o risco escrito na própria linha
--
-- A linha de `public.sources` é o registro da operação de tratamento
-- (LGPD art. 37) e, aqui, também o registro escrito da decisão. Por isso
-- ela nasce na MIGRAÇÃO: quem abrir o banco de produção daqui a um ano acha
-- o ADR-12 inteiro em `terms_notes`, sem precisar do repositório.
--
-- E nasce SÓ na migração, sem cópia em supabase/seed.sql. A migração roda
-- antes da seed em todo ambiente (`supabase db reset` aplica as migrações e
-- só depois o seed.sql), então a linha já existe quando a seed começa — uma
-- segunda cópia lá não acrescentaria nada e criaria 1,3 mil caracteres de
-- texto jurídico que teriam de bater caractere a caractere, com o
-- `on conflict (slug) do update` da seed (seed.sql:183-193) sobrescrevendo
-- `terms_notes` em silêncio se divergissem. Não é hipótese: `whatsapp_entrada`
-- está nos dois lugares e os dois textos JÁ divergem
-- (20260915130000:59 vs seed.sql:171) — lá é inofensivo porque a migração usa
-- `do nothing`. Aqui o texto é o registro legal, e ele tem um dono só.
--
-- `on conflict (slug) do update` (e não `do nothing`): esta migração roda uma
-- vez, e se alguém tiver criado a linha à mão antes dela, o que vale é o texto
-- aprovado, não o improviso.
--
-- kind = 'import', e não 'scrape'. É verdade literal — o CRM não visita o
-- Google, o que entra é um arquivo que uma pessoa subiu — e é também o que
-- evita um estrago: `app.envio_variaveis` (20260921100000:268) e
-- `app.wa_preparar_abertura` (20260917200100:114) preenchem a variável
-- {{origem}} da mensagem com `s.name` quando `s.kind in ('scrape','api')`.
-- Com 'scrape', a string "Google Maps (raspagem local)" iria literalmente
-- dentro de um primeiro contato de campanha.
--
-- Nenhuma trava se perde com isso: `is_enabled = false` já faz
-- `public.esteira_abrir_lote` recusar `p_kind='coleta'`
-- (20260904001600:1788-1790), `config.collector.enabled` é false, e não existe
-- adaptador para esta fonte em apps/workers/src/ingest/adaptador.ts.
-- ---------------------------------------------------------------------
insert into public.sources (slug, name, kind, base_url, legal_basis, terms_notes,
                            robots_ok, rate_limit_seconds, is_enabled, config)
values (
  'google_maps_raspado',
  'Google Maps (raspagem local)',
  'import',
  'https://www.google.com/maps',
  'legitimo_interesse',
  'Raspagem do Google Maps por ferramenta local (google-maps-scraper-kit, MIT, sobre gosom/google-maps-scraper), em Docker em 127.0.0.1, fora do CRM. CONTRARIA OS TERMOS DE SERVIÇO DO GOOGLE, que proíbem extração automatizada, e REVOGA POR ESCRITO o R06 §B.1 SCR-04 ("nada de scraping direto ou via terceiros", docs/anexos/R06-lgpd-compliance.md:227), recusa de 04/09/2026. Decisão do Rafael em 24/09/2026, ADR-12, risco assumido no nível da empresa. O resto do SCR-03 continua valendo e é o que limita o dano: sem login, sem burla de CAPTCHA, sem proxy rotativo, user-agent identificado, 1 requisição a cada 5 s. O que coletamos são dados factuais de contato comercial publicados pelo próprio estabelecimento: nome, categoria, telefone, site, e-mail, endereço e dois números de reputação. Nunca foto, texto descritivo ou texto de avaliação. nota e avaliacoes_qtd entram apenas como sinal numérico de pontuação, pela mesma exceção consciente ao SCR-02 já registrada (RF-RAD-04, RF-RAD-12, PRD §13 item 10) — nunca exibidos como avaliação. Nunca republicação, nunca revenda. Limite: no máximo 2 rodadas por semana e 600 lugares por rodada, só Natal e região metropolitana. Consequência realista se der errado: bloqueio do IP ou CAPTCHA permanente na máquina que raspa — não há contrato entre a KOMUNE e o Google que possa ser rescindido, e não há dado de terceiro republicado que gere dano indenizável. O cid que gravamos em place_id NÃO É o place_id da Places API: se um dia ligarmos o conector oficial (google_places), os dois identificadores não casam.',
  false,
  5.00,
  false,
  '{"collector": {"kind": "externo", "phase": "mvp", "enabled": false}, "entrada_por_arquivo": true, "ferramenta": "google-maps-scraper-kit (MIT) sobre gosom/google-maps-scraper", "adr": "ADR-12"}'::jsonb
)
on conflict (slug) do update
  set name               = excluded.name,
      kind               = excluded.kind,
      base_url           = excluded.base_url,
      legal_basis        = excluded.legal_basis,
      terms_notes        = excluded.terms_notes,
      robots_ok          = excluded.robots_ok,
      rate_limit_seconds = excluded.rate_limit_seconds,
      is_enabled         = excluded.is_enabled,
      config             = excluded.config;
```

O `terms_notes` é uma única linha longa, como as da `supabase/seed.sql` — não quebre o literal em várias linhas, senão os quebra-linhas entram no texto gravado. Ele não tem nenhuma aspa simples.

E, em `supabase/seed.sql`, uma linha de comentário para ninguém "consertar" a ausência. Logo **depois** da linha 193 (`config = case when public.sources.config = '{}'::jsonb then excluded.config else public.sources.config end;`) e antes do cabeçalho `-- 3b. Catálogo de coleta do Radar…`:

```sql
-- `google_maps_raspado` NÃO está na lista acima de propósito: ela nasce na
-- migração 20260924130000, que é o registro escrito do ADR-12 e roda antes deste
-- arquivo em todo ambiente. Uma cópia aqui só duplicaria o texto jurídico — e o
-- `on conflict do update` acima sobrescreveria o original em silêncio se os dois
-- divergissem um dia.
```

Rode, veja as 7 verdes e commite:

```bash
pnpm db:reset && pnpm db:test
git add supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql \
        supabase/seed.sql supabase/tests/66_o_csv_do_maps.sql
git commit -m "A fonte do Maps nasce com o risco escrito na linha"
```

- [ ] **5.3 — escrever o teste que falha: o mapa das 12 categorias.** Suba o `plan` em **+1** (`plan(40)`). Antes de `select * from finish();`, cole:

```sql
-- =====================================================================
-- O mapa categoria-do-Maps → categoria do CRM (§3.3): só o que é evidente
-- =====================================================================
select is(
  (select jsonb_object_agg(m.category_source, c.slug)
     from public.source_category_map m
     join public.categories c on c.id = m.category_id
     join public.sources s    on s.id = m.source_id
    where s.slug = 'google_maps_raspado'),
  '{"dj": "djs_bandas_musicos",
    "buffet": "buffet_adulto_corporativo",
    "confeitaria": "doces_bolos_confeitaria",
    "floricultura": "decoracao_flores",
    "fotógrafo": "fotografia_video",
    "salão de festas": "locais_saloes_chacaras_hoteis",
    "serviço de buffet": "buffet_adulto_corporativo",
    "locação de tendas": "tendas_estruturas_palcos",
    "espaço para eventos": "locais_saloes_chacaras_hoteis",
    "aluguel de brinquedos": "locacao_brinquedos_inflaveis",
    "serviço de fotografia": "fotografia_video",
    "casa de festas infantis": "buffet_infantil_casa_de_festas"}'::jsonb,
  'as 12 categorias que o Maps devolve em Natal caem na categoria certa do CRM, e só elas');
```

Esta asserção única cobre conteúdo **e** contagem: uma 13ª linha, um acento errado ou um slug trocado a derrubam. Os nove slugs de destino existem em `supabase/seed.sql:69-95`. Rode e veja falhar (`is(NULL, …)`, o mapa está vazio).

- [ ] **5.4 — o mapa na migração, na seed, e o barulho na autoverificação.** São três edições, e as três entram juntas — é isso que fecha o ciclo em verde.

**(a)** No fim da migração:

```sql
-- ---------------------------------------------------------------------
-- 7. O mapa categoria-do-Maps → categoria do CRM
--
-- Só o que é evidente, a mesma régua que a seed já aplica ao Casamentos
-- (supabase/seed.sql:247-283): o que não é evidente fica de fora, o
-- candidato chega com `category_id` nulo e a Revisão pergunta.
--
-- A chave é gravada em MINÚSCULA E COM ACENTO porque é assim que as duas
-- leituras a procuram: `public.esteira_processar_captura`
-- (20260904001600:1906-1910) e `app.importacao_normalizar` (bloco 2 desta
-- migração) comparam com `lower(trim(coalesce(v_p ->> 'categoria_origem','')))`
-- — sem `unaccent`. "fotografo" sem acento aqui nunca casaria.
--
-- ORDEM, E ESTE É O PONTO DELICADO: `public.categories` é semeada só em
-- supabase/seed.sql, que roda DEPOIS de todas as migrações. Num
-- `supabase db reset` este insert casa ZERO linhas e termina calado — o
-- mesmo tropeço de 05/09/2026 que o bloco 3b da seed descreve. Por isso o
-- mapa está TAMBÉM lá, espelhado, e é de lá que o banco local e o CI o
-- recebem. Aqui ele existe para o banco de PRODUÇÃO, onde as categorias já
-- estão semeadas.
-- ---------------------------------------------------------------------
insert into public.source_category_map (source_id, category_source, category_id)
select s.id, m.categoria_origem, c.id
  from public.sources s
  join (values
          ('buffet',                  'buffet_adulto_corporativo'),
          ('serviço de buffet',       'buffet_adulto_corporativo'),
          ('casa de festas infantis', 'buffet_infantil_casa_de_festas'),
          ('fotógrafo',               'fotografia_video'),
          ('serviço de fotografia',   'fotografia_video'),
          ('salão de festas',         'locais_saloes_chacaras_hoteis'),
          ('espaço para eventos',     'locais_saloes_chacaras_hoteis'),
          ('aluguel de brinquedos',   'locacao_brinquedos_inflaveis'),
          ('confeitaria',             'doces_bolos_confeitaria'),
          ('floricultura',            'decoracao_flores'),
          ('dj',                      'djs_bandas_musicos'),
          ('locação de tendas',       'tendas_estruturas_palcos')
       ) as m(categoria_origem, categoria_crm) on true
  join public.categories c on c.slug = m.categoria_crm
 where s.slug = 'google_maps_raspado'
on conflict (source_id, category_source) do update
  set category_id = excluded.category_id;
```

**(b)** Em `supabase/seed.sql`, logo **depois** do bloco do mapa do Casamentos (que termina na linha 283, `  set category_id = excluded.category_id;`) e **antes** do cabeçalho `-- =====` do bloco `-- 4. Feriados 2026 e 2027` (linhas 285-286), cole:

```sql

-- O mapa do Google Maps raspado (ADR-12, spec §3.3). Espelho exato do que a
-- migração 20260924130000 grava em produção: aqui ele existe porque, num
-- `supabase db reset`, as migrações rodam ANTES deste arquivo e o insert de lá
-- não acha `public.categories` para casar. Mesmo motivo do bloco acima.
--
-- A chave vai em minúscula e COM acento: quem lê é
-- `lower(trim(v_p ->> 'categoria_origem'))`, sem `unaccent`.
-- Só o evidente entra. "serviços para casamento", "loja de presentes" e as
-- outras categorias soltas do Maps ficam de fora e vão para a Revisão com o
-- motivo escrito — palpite aqui contamina o funil inteiro.
insert into public.source_category_map (source_id, category_source, category_id)
select s.id, m.categoria_origem, c.id
  from public.sources s
  join (values
          ('buffet',                  'buffet_adulto_corporativo'),
          ('serviço de buffet',       'buffet_adulto_corporativo'),
          ('casa de festas infantis', 'buffet_infantil_casa_de_festas'),
          ('fotógrafo',               'fotografia_video'),
          ('serviço de fotografia',   'fotografia_video'),
          ('salão de festas',         'locais_saloes_chacaras_hoteis'),
          ('espaço para eventos',     'locais_saloes_chacaras_hoteis'),
          ('aluguel de brinquedos',   'locacao_brinquedos_inflaveis'),
          ('confeitaria',             'doces_bolos_confeitaria'),
          ('floricultura',            'decoracao_flores'),
          ('dj',                      'djs_bandas_musicos'),
          ('locação de tendas',       'tendas_estruturas_palcos')
       ) as m(categoria_origem, categoria_crm) on true
  join public.categories c on c.slug = m.categoria_crm
 where s.slug = 'google_maps_raspado'
on conflict (source_id, category_source) do update
  set category_id = excluded.category_id;
```

**(c)** O barulho, na autoverificação do bloco 13 da seed. Três edições pequenas.

Na linha 1580, que hoje é `  n_rad int; n_map int;`, troque por:

```sql
  n_rad int; n_map int; n_map_google int;
```

Logo **depois** da linha 1613 (`   where s.slug = 'casamentos_com_br';`, a que fecha o `select count(*) into n_map`), acrescente:

```sql
  -- O mesmo barulho para o mapa do Google Maps raspado (ADR-12, spec §3.3):
  -- se um slug de categoria for renomeado, este insert casa menos de 12 linhas
  -- e o reset falha aqui, em vez de deixar 600 lugares indo para a Revisão sem
  -- ninguém entender por quê.
  select count(*) into n_map_google
    from public.source_category_map m
    join public.sources s on s.id = m.source_id
   where s.slug = 'google_maps_raspado';
```

Logo **depois** da linha 1647 (`  if n_map < 23  then raise exception 'seed: mapa de categorias do Radar com % linhas (esperadas ≥ 23, bloco 3b)', n_map; end if;`), acrescente:

```sql
  if n_map_google <> 12 then raise exception 'seed: mapa de categorias do Google Maps com % linhas (esperadas 12, ADR-12)', n_map_google; end if;
```

Não há risco de colisão: `n_map` e `n_rad` filtram por `s.slug = 'casamentos_com_br'`, e `n_src` só aparece num `raise notice` — passa de 12 para 13 e nada quebra.

Rode, veja passar e commite:

```bash
pnpm db:reset && pnpm db:test
git add supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql \
        supabase/seed.sql supabase/tests/66_o_csv_do_maps.sql
git commit -m "O mapa de categorias do Maps, na migração e na seed"
```

- [ ] **5.5 — escrever o teste que falha: as duas fontes que entram por arquivo.** Suba o `plan` em **+1** (`plan(41)`). Antes de `select * from finish();`:

```sql
-- =====================================================================
-- O seletor de origem da tela de importação (§3.2 item 7)
-- =====================================================================
select is(
  array(select s.slug from public.sources s
         where s.config ->> 'entrada_por_arquivo' = 'true'
         order by s.slug collate "C"),
  array['google_maps_raspado', 'planilha'],
  'só as duas fontes que entram por arquivo aparecem no seletor de origem da importação');
```

Rode e veja falhar: a `planilha` ainda não tem a chave, então o array volta com um elemento só.

- [ ] **5.6 — o `entrada_por_arquivo` na migração e na seed.**

**(a)** No fim da migração:

```sql
-- ---------------------------------------------------------------------
-- 8. Quais fontes aparecem no seletor de origem da importação
--
-- A tela filtra por `config->>'entrada_por_arquivo' = 'true'`, e NÃO por
-- `is_enabled`: `is_enabled` diz se o coletor automático pode rodar, e a
-- fonte nova nasce desligada de propósito — mas é ela que o operador
-- escolhe ao arrastar o CSV. A fonte nova já traz a chave no bloco 6; a
-- `planilha` a recebe aqui, por `update` explícito e não por edição do
-- literal da seed, porque o `on conflict` de lá preserva `config` quando ele
-- já não está vazio (supabase/seed.sql:193) — num banco que já rodou a seed
-- antes, mexer no literal não teria efeito nenhum.
--
-- Mesma ressalva de ordem do bloco 7: a linha `planilha` nasce só em
-- supabase/seed.sql, então num `supabase db reset` ela ainda não existe
-- quando esta migração roda e este update casa zero linhas. O espelho na
-- seed cobre esse caso; este bloco é o que atende produção.
-- ---------------------------------------------------------------------
update public.sources
   set config = config || '{"entrada_por_arquivo": true}'::jsonb
 where slug = 'planilha';
```

**(b)** Em `supabase/seed.sql`, logo **depois** do comentário que você deixou no passo 5.2 e antes do cabeçalho `-- 3b. Catálogo de coleta do Radar…`:

```sql
-- As duas fontes que entram por ARQUIVO, e que por isso aparecem no seletor de
-- origem de /importar. Fica num `update` à parte, e não no literal de `config`
-- acima, porque o `on conflict` preserva `config` quando ele já não está vazio:
-- num banco que já foi semeado antes, o literal não chegaria a valer. `||` é
-- idempotente, então roda em todo reset sem efeito colateral.
-- Espelha o bloco 8 da migração 20260924130000, que faz o mesmo em produção.
update public.sources
   set config = config || '{"entrada_por_arquivo": true}'::jsonb
 where slug in ('planilha', 'google_maps_raspado');
```

Rode, veja passar e commite:

```bash
pnpm db:reset && pnpm db:test
git add supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql \
        supabase/seed.sql supabase/tests/66_o_csv_do_maps.sql
git commit -m "As duas fontes que entram por arquivo aparecem no seletor"
```

- [ ] **5.7 — escrever o teste que falha: o índice do lugar, parcial e não único.** Suba o `plan` em **+2** (`plan(43)`). Antes de `select * from finish();`:

```sql
-- =====================================================================
-- O índice do lugar (§3.2, bloco Índices): parcial, e NÃO único
-- =====================================================================
select has_index('public', 'supplier_candidates', 'supplier_candidates_place_idx',
  'índice supplier_candidates_place_idx existe');

select ok((select indexdef from pg_indexes
            where schemaname = 'public'
              and indexname = 'supplier_candidates_place_idx')
          ~ '^CREATE INDEX .*\(place_id\) WHERE \(place_id IS NOT NULL\)$',
  'o índice do lugar é parcial e não é único: o mesmo lugar pode chegar por duas fontes');
```

A forma de quatro argumentos de `has_index`, com descrição no lugar da coluna, é a que `supabase/tests/03_dedup.sql:25-29` já usa. E a âncora `^CREATE INDEX ` é o que prova que o índice não é único: um `create unique index` renderia `CREATE UNIQUE INDEX` e a asserção reprovaria. Rode e veja as duas falharem.

- [ ] **5.8 — o índice na migração.** No fim da migração:

```sql
-- ---------------------------------------------------------------------
-- 9. Achar o candidato pelo lugar, sem varrer a tabela
--
-- O passo (3) de `app.resolver_source_record` (20260904001600:894-905) procura
-- o candidato por `c.place_id = v_r.place_id` e hoje faz varredura de
-- tabela — e a partir da Fase 1 quase toda linha que entra tem place_id.
--
-- É PARCIAL (só quem tem place_id) e NÃO É ÚNICO, de propósito: um índice
-- único global seria uma restrição NOVA, e quebraria o caso legítimo do
-- mesmo lugar chegando por duas fontes diferentes (o Maps raspado e, um dia,
-- o conector oficial do Places). A unicidade que queremos já existe e é por
-- fonte: `supplier_candidates_fonte_externo_uq (source_id, external_id)`
-- (20260904001401:211), com `external_id = place_id` a partir desta fase.
-- ---------------------------------------------------------------------
create index if not exists supplier_candidates_place_idx
  on public.supplier_candidates (place_id) where place_id is not null;
```

Rode, veja passar e commite:

```bash
pnpm db:reset && pnpm db:test
git add supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql \
        supabase/tests/66_o_csv_do_maps.sql
git commit -m "Achar o candidato pelo lugar sem varrer a tabela"
```

- [ ] **5.9 — fechar a tarefa: tipos, lint e CHANGELOG.**

```bash
pnpm db:types
git diff --stat packages/schema/src/database.types.ts
pnpm db:lint
pnpm lint && pnpm typecheck
```

`pnpm db:types` **não deve produzir diff nenhum**: esta tarefa não cria função, coluna nem tabela. Se aparecer diff, é sinal de que outra migração da Fase 1 ficou por regenerar.

`pnpm db:lint` **já devolve uma lista de avisos antigos** neste repositório — `app.ia_prazo` (IMMUTABLE com expressão STABLE), `app.radar_pontuar` (cast de `text` para `text[]`), `app.envio_um` (variável `v_ct` nunca lida) e dezenas vindos das funções do PostGIS em `extensions`. O que você confere é que **nenhum nome novo entrou na lista**. Não prometa "sem apontamentos": é promessa que não dá para cumprir aqui.

Acrescente ao fim de `docs/CHANGELOG.md`:

```markdown
### 24/09/2026 — A fonte do Google Maps entra no catálogo (Fase 1 do pivô)

O catálogo de origens ganhou a linha que faltava para o CSV do Maps entrar pela porta da importação, e ela é também o registro escrito do **ADR-12** (spec `docs/superpowers/specs/2026-09-24-pivo-scraper-e-robo-autonomo-design.md`, §3.3). A redação do `terms_notes` foi lida e aprovada pelo Rafael antes de subir (§12, decisão 1).

Entregue, dentro da migração `20260924130000_o_csv_do_maps_entra_pela_importacao.sql`:
- **`google_maps_raspado`**, `kind = 'import'` e `is_enabled = false`. Não é `'scrape'` de propósito: `app.envio_variaveis` e `app.wa_preparar_abertura` preenchem a variável `{{origem}}` com o nome da fonte quando o `kind` é `scrape` ou `api` — a string "Google Maps (raspagem local)" iria literalmente dentro de um primeiro contato de campanha. Desligada, `public.esteira_abrir_lote` recusa lote de coleta com `origem_desabilitada`; lote de planilha abre normalmente.
- **O risco por escrito em `terms_notes`**: contraria os ToS do Google, revoga o R06 §B.1 SCR-04, decisão do Rafael em 24/09/2026, e os limites assumidos (sem login, sem CAPTCHA burlado, sem proxy, 1 req/5 s, 2 rodadas por semana, 600 lugares por rodada, só Natal e região).
- **12 linhas em `public.source_category_map`**, em minúscula e com acento (é assim que a consulta lê). O que não é evidente fica de fora e vai para a Revisão com o motivo escrito.
- **`entrada_por_arquivo`** em `google_maps_raspado` e `planilha`: é por esta chave que o seletor de origem da tela filtra, e não por `is_enabled`.
- **`supplier_candidates_place_idx`**, parcial e não único: `app.resolver_source_record` procura o candidato por `place_id` e fazia varredura. Não é único porque o mesmo lugar pode chegar por duas fontes; a unicidade por fonte já existe em `supplier_candidates_fonte_externo_uq`.

**A linha da fonte vive só na migração**, sem cópia em `supabase/seed.sql`. As migrações rodam antes do seed em todo ambiente, então a linha já existe quando a seed começa; uma segunda cópia seria 1,3 mil caracteres de texto jurídico obrigados a bater caractere a caractere, com o `on conflict do update` da seed sobrescrevendo o original em silêncio se divergissem — que é exatamente o que já aconteceu com `whatsapp_entrada`, cujos dois textos divergem desde 15/09.

**O mapa de categorias, esse sim, está nos dois lugares**: `public.categories` nasce só na seed, que roda depois das migrações, então num `supabase db reset` o insert da migração casa zero linhas e termina calado — o mesmo tropeço de 05/09/2026 registrado no bloco 3b da seed. A migração serve a produção; a seed serve ao banco novo. E a autoverificação do bloco 13 da seed passou a contar essas 12 linhas: se um slug de categoria for renomeado, o `db reset` falha ali em vez de deixar 600 lugares indo para a Revisão sem motivo aparente.

Verificado: `pnpm db:reset && pnpm db:test` verdes, `pnpm db:types` sem diff, `pnpm db:lint` sem nenhum apontamento novo (a saída continua com os avisos antigos de `app.ia_prazo`, `app.radar_pontuar`, `app.envio_um` e das funções do PostGIS).

Pendente: o seletor de origem na tela de `/importar` é quem consome `entrada_por_arquivo` — até ele existir (Tarefa 8), a fonte nova está no banco mas não aparece para o operador.
```

Commite:

```bash
git add docs/CHANGELOG.md
git commit -m "CHANGELOG: a fonte do Maps entra no catálogo"
```

(`packages/schema/src/database.types.ts` não entra neste commit: se `pnpm db:types` fez o que devia, não há diff nele.)

**Somando**: esta tarefa acrescenta **11 asserções** ao `supabase/tests/66_o_csv_do_maps.sql` (7 no passo 5.1, 1 no 5.3, 1 no 5.5, 2 no 5.7). Entrou com `plan(32)`, sai com `plan(43)`.

---

## Tarefa 6: os cinco campos novos e os sinônimos em inglês do kit

**Arquivos:** `apps/web/src/components/importacao/tipos.ts`, `apps/web/src/components/importacao/mapeamento.ts`, `apps/web/src/components/importacao/mapeamento.test.ts`. **Sem migração, sem `pnpm db:types`:** esta tarefa não toca o banco.

**Interfaces**
- *Consome:* `acharCampo`, `chave`, `faltando`, `linhaParaObjeto`, `sugerirMapa`, `temConteudo` (já exportados por `mapeamento.ts`), `TODOS_OS_CAMPOS`/`CampoQualquer` (`tipos.ts`).
- *Produz:* `CAMPOS_EXTRAS` = `readonly ['cnpj','site','place_id','email','endereco','nota','avaliacoes_qtd']`; `ROTULO_EXTRA: Record<CampoExtra, string>` com os 7 rótulos; `TODOS_OS_CAMPOS` passa de 19 para 24 entradas, na ordem `[...CAMPOS, ...CAMPOS_EXTRAS]`. `SINONIMOS` ganha 5 chaves novas e 3 sinônimos em inglês (`nome`+`title`, `categoria`+`category`, `whatsapp`+`phone`). **Assinaturas inalteradas.** No teste: `CABECALHO_DO_KIT: string[]` (29 colunas) no escopo do módulo e dois `describe` novos (6 + 3 testes).

**Por quê.** `app.importacao_normalizar` montava 9 chaves de payload enquanto `app.payload_e_permitido` permite 22. A tela é metade desse estreitamento: `CAMPOS_EXTRAS` só conhece `cnpj` e `site`, então `place_id`, `email`, `endereco`, `nota` e `avaliacoes_qtd` não têm nem como ser mapeados. E `SINONIMOS` é todo em português, enquanto o cabeçalho do `google-maps-scraper-kit` é todo em inglês.

**O que foi conferido rodando o código de hoje** (a spec erra em dois pontos; a tabela abaixo é o comportamento real):

| cabeçalho | hoje | depois |
|---|---|---|
| `title` | **nulo** | `nome` exato |
| `category` | **nulo** | `categoria` exato |
| `phone` | **nulo** (a spec diz "parecido por conter `fone`" — `phone` contém `hone`, não `fone`) | `whatsapp` exato |
| `cid` | `cidade` **parecido** | `place_id` exato |
| `emails` | nulo | `email` exato |
| `address` | nulo | `endereco` exato |
| `review_rating` | nulo | `nota` exato |
| `review_count` | nulo | `avaliacoes_qtd` exato |
| `link` | `origem_detalhe` exato | igual |
| `website` | `site` exato | igual |
| `Endereço` (pt-BR) | `site` **parecido** (defeito existente: `site` tem o sinônimo `endereco na web`) | `endereco` exato |
| `linkedin` | `origem_detalhe` **parecido** (a spec diz que não casa com nada — casa: `'linkedin'.includes('link')`) | igual, e inofensivo: `link` já tomou o campo por acerto exato e `sugerirMapa` não deixa um "parecido" substituir um "exato" |
| `reviews_link` | `origem_detalhe` **parecido**, pela mesma razão | igual, e igualmente inofensivo |
| `facebook` | nulo | nulo |
| `status` | `etapa` exato | igual — ver o passo 6.7 |
| `owner` | `responsavel` exato | igual — ver o passo 6.7 |

### Passos

- [ ] **6.1 — escrever o teste.** Acrescentar ao **fim** de `apps/web/src/components/importacao/mapeamento.test.ts`. O arquivo já importa `acharCampo`, `chave`, `faltando`, `linhaParaObjeto`, `sugerirMapa`, `temConteudo` (linha 12) e `describe`, `expect`, `it` (linha 10) — **não mexa nos imports**.

```ts

/**
 * O cabeçalho que o `google-maps-scraper-kit` devolve.
 *
 * As 29 colunas estão listadas na spec do pivô (§3.1): dez viram campo e
 * dezenove são descartadas, cada uma com motivo escrito. O cabeçalho está aqui à
 * mão de propósito — se o kit renomear uma coluna, quem tem de quebrar é este
 * teste, e não a importação de 600 linhas na mão de quem está prospectando.
 */
const CABECALHO_DO_KIT = [
  'link',
  'title',
  'category',
  'address',
  'open_hours',
  'popular_times',
  'website',
  'phone',
  'plus_code',
  'review_count',
  'review_rating',
  'latitude',
  'longitude',
  'cid',
  'status',
  'descriptions',
  'reviews_link',
  'thumbnail',
  'timezone',
  'price_range',
  'images',
  'reservations',
  'menu',
  'owner',
  'about',
  'user_reviews',
  'emails',
  'facebook',
  'linkedin',
];

describe('cabeçalho do google-maps-scraper-kit', () => {
  const { mapa, motivos } = sugerirMapa(CABECALHO_DO_KIT);

  it('casa as dez colunas que viram campo, todas por nome exato', () => {
    expect(mapa.origem_detalhe).toBe(0);
    expect(mapa.nome).toBe(1);
    expect(mapa.categoria).toBe(2);
    expect(mapa.endereco).toBe(3);
    expect(mapa.site).toBe(6);
    expect(mapa.whatsapp).toBe(7);
    expect(mapa.avaliacoes_qtd).toBe(9);
    expect(mapa.nota).toBe(10);
    expect(mapa.place_id).toBe(13);
    expect(mapa.email).toBe(26);
    const dez = [
      'origem_detalhe',
      'nome',
      'categoria',
      'endereco',
      'site',
      'whatsapp',
      'avaliacoes_qtd',
      'nota',
      'place_id',
      'email',
    ] as const;
    expect(dez.map((c) => motivos[c])).toEqual(dez.map(() => 'exato'));
  });

  it('title, category e phone passam a casar: hoje não casavam com nada', () => {
    expect(acharCampo('title')).toEqual({ campo: 'nome', motivo: 'exato' });
    expect(acharCampo('category')).toEqual({ campo: 'categoria', motivo: 'exato' });
    // `phone` não casava nem por semelhança: contém `hone`, e não `fone`.
    expect(acharCampo('phone')).toEqual({ campo: 'whatsapp', motivo: 'exato' });
  });

  it('cid é o ID do lugar, e não a cidade', () => {
    expect(acharCampo('cid')).toEqual({ campo: 'place_id', motivo: 'exato' });
    expect(mapa.cidade).toBeUndefined();
  });

  it('"Endereço" deixa de cair em Site, e "Endereço na web" continua no Site', () => {
    expect(acharCampo('Endereço')).toEqual({ campo: 'endereco', motivo: 'exato' });
    expect(acharCampo('Endereço completo')).toEqual({ campo: 'endereco', motivo: 'exato' });
    expect(acharCampo('Endereço na web')).toEqual({ campo: 'site', motivo: 'exato' });
  });

  it('a linha vira objeto só com o que foi mapeado', () => {
    const valores = CABECALHO_DO_KIT.map((c) => `v_${c}`);
    const objeto = linhaParaObjeto(valores, mapa, 2);
    expect(objeto.place_id).toBe('v_cid');
    expect(objeto.email).toBe('v_emails');
    expect(objeto.endereco).toBe('v_address');
    expect(objeto.nota).toBe('v_review_rating');
    expect(objeto.avaliacoes_qtd).toBe('v_review_count');
    expect('facebook' in objeto).toBe(false);
    expect('linkedin' in objeto).toBe(false);
    const valoresEmitidos = Object.values(objeto);
    for (const proibida of [
      'v_facebook',
      'v_linkedin',
      'v_thumbnail',
      'v_user_reviews',
      'v_images',
    ]) {
      expect(valoresEmitidos).not.toContain(proibida);
    }
  });

  it('o CSV do kit não traz origem: ela vem do seletor do lote', () => {
    expect(faltando(mapa)).toEqual(['origem']);
  });
});

/**
 * Trava de regressão: isto JÁ é verdade hoje, e o passo 6.4 não pode quebrar.
 *
 * Cinco sinônimos novos entram num casador que faz uma passada exata e depois uma
 * por trecho. Um sinônimo curto demais rouba coluna alheia em silêncio, e o
 * sintoma só aparece quando alguém importa 600 linhas com o campo trocado. Estes
 * três testes passam antes e depois da mudança — é esse o ponto.
 */
describe('o que o cabeçalho do kit NÃO pode passar a casar', () => {
  const { mapa } = sugerirMapa(CABECALHO_DO_KIT);

  it('facebook não casa com nada, e nem linkedin nem reviews_link roubam o link do lugar', () => {
    expect(acharCampo('facebook')).toBeNull();
    // `linkedin` e `reviews_link` contêm `link`, então casam por SEMELHANÇA com
    // "detalhe da origem". Nenhum dos dois entra no mapa: `link` já tomou o campo
    // por nome exato, e `sugerirMapa` não deixa um acerto parecido substituir um
    // exato.
    expect(acharCampo('linkedin')).toEqual({ campo: 'origem_detalhe', motivo: 'parecido' });
    expect(acharCampo('reviews_link')).toEqual({ campo: 'origem_detalhe', motivo: 'parecido' });
    expect(mapa.origem_detalhe).toBe(CABECALHO_DO_KIT.indexOf('link'));
  });

  it('as colunas que a whitelist não recebe não viram campo nenhum', () => {
    const fora = [
      'plus_code',
      'latitude',
      'longitude',
      'descriptions',
      'about',
      'images',
      'thumbnail',
      'user_reviews',
      'price_range',
      'open_hours',
      'popular_times',
      'menu',
      'reservations',
      'timezone',
    ];
    expect(fora.map(acharCampo)).toEqual(fora.map(() => null));
  });

  it('status e owner ainda casam: é o operador que os tira na tela', () => {
    // `status` ("Operacional") cai em Etapa e `owner` (nome de pessoa) em
    // Responsável. Os dois são sinônimos legítimos para planilha de CRM em
    // inglês, então não saem de `SINONIMOS`: o passo 5 do roteiro de §3.4 manda
    // conferir o mapa sugerido, e é lá que os dois são desmarcados. Este teste
    // existe para que isso seja uma decisão escrita, e não um esquecimento.
    expect(acharCampo('status')).toEqual({ campo: 'etapa', motivo: 'exato' });
    expect(acharCampo('owner')).toEqual({ campo: 'responsavel', motivo: 'exato' });
    expect(mapa.etapa).toBe(14);
    expect(mapa.responsavel).toBe(23);
  });
});
```

- [ ] **6.2 — rodar e ver falhar.**

```
pnpm -C apps/web test src/components/importacao/mapeamento.test.ts
```

**Esperado: 9 testes novos, 6 vermelhos e 3 verdes.** Os 15 que já existiam continuam verdes (24 no arquivo).

| teste novo | hoje |
|---|---|
| casa as dez colunas … | **vermelho** (`expected undefined to be 3`) |
| title, category e phone … | **vermelho** (`expected null to equal { campo: 'nome', … }`) |
| cid é o ID do lugar … | **vermelho** (hoje devolve `{ campo: 'cidade', motivo: 'parecido' }`) |
| "Endereço" deixa de cair em Site … | **vermelho** (hoje devolve `{ campo: 'site', motivo: 'parecido' }`) |
| a linha vira objeto … | **vermelho** (`objeto.place_id` é `undefined`) |
| o CSV do kit não traz origem … | **vermelho** (hoje `faltando` devolve `['nome', 'categoria', 'origem']`) |
| os três do segundo `describe` | **verdes** — são as travas de regressão |

Os erros são de valor, não de compilação: o Vitest transpila sem checar tipos, e `Mapa` é `Partial<Record<…>>`. **Não rode `pnpm -C apps/web typecheck` entre este passo e o 6.3**: o `tsconfig.json` de `apps/web` inclui `**/*.ts`, e `motivos['place_id']` ainda é chave inexistente em `CampoQualquer`.

- [ ] **6.3 — criar os cinco campos em `tipos.ts`.** Substituir o bloco das linhas 79–82:

```ts
/** Um campo a mais que a planilha-ponte não tem, mas que outras listas trazem. */
export const CAMPOS_EXTRAS = ['cnpj', 'site'] as const;
export type CampoExtra = (typeof CAMPOS_EXTRAS)[number];
export const ROTULO_EXTRA: Record<CampoExtra, string> = { cnpj: 'CNPJ', site: 'Site' };
```

por:

```ts
/**
 * Campos que a planilha-ponte não tem, mas que outras listas trazem.
 *
 * Os cinco últimos entraram com o CSV do `google-maps-scraper-kit` (spec do pivô
 * de 24/09/2026, §3.1): `app.importacao_normalizar` já sabia montar 9 chaves de
 * payload enquanto `app.payload_e_permitido` permitia 22, e o que o Maps entrega
 * de mais valioso — e-mail, endereço e o `cid` do lugar — caía nesse estreitamento.
 *
 * A ORDEM IMPORTA, e não é estética: `TODOS_OS_CAMPOS` é `[...CAMPOS, ...CAMPOS_EXTRAS]`,
 * `acharCampo` percorre os campos nessa ordem e para no primeiro acerto. Entrando
 * por último, nenhum campo novo pode roubar por semelhança uma coluna que hoje
 * casa com um campo antigo.
 *
 * `nota` e `avaliacoes_qtd` são sinal numérico de pontuação e NUNCA vão para a
 * tela como avaliação (RF-RAD-04): é a exceção consciente ao R06 SCR-02.
 */
export const CAMPOS_EXTRAS = [
  'cnpj',
  'site',
  'place_id',
  'email',
  'endereco',
  'nota',
  'avaliacoes_qtd',
] as const;
export type CampoExtra = (typeof CAMPOS_EXTRAS)[number];
export const ROTULO_EXTRA: Record<CampoExtra, string> = {
  cnpj: 'CNPJ',
  site: 'Site',
  place_id: 'ID do lugar no Maps',
  email: 'E-mail',
  endereco: 'Endereço',
  nota: 'Nota do Google',
  avaliacoes_qtd: 'Nº de avaliações',
};
```

Nada mais em `tipos.ts` muda: `CampoQualquer` (linha 84), `TODOS_OS_CAMPOS` (linha 86) e `rotuloDoCampo` (linha 93) derivam de `CAMPOS_EXTRAS` sozinhos. `passo-mapa.tsx` também não muda — ele varre `TODOS_OS_CAMPOS` (linhas 54, 66 e 155) e chama `rotuloDoCampo` (linhas 102 e 157), então os cinco campos novos aparecem na lista suspensa de cada coluna automaticamente.

**Não rode teste nem typecheck agora.** Entre este passo e o próximo, `SINONIMOS[campo]` é `undefined` para os cinco campos novos e `CHAVES` (linha 56 de `mapeamento.ts`) estoura com `TypeError: Cannot read properties of undefined (reading 'map')` na carga do módulo. O passo 6.4 conserta. Os dois passos são **um commit só**: não existe ordem que deixe o repositório verde no meio, porque `SINONIMOS` é `Record<CampoQualquer, string[]>` e as duas metades têm de mudar juntas.

- [ ] **6.4 — ensinar o inglês do kit a `SINONIMOS`.** Em `apps/web/src/components/importacao/mapeamento.ts`, três linhas trocadas e cinco acrescentadas dentro de `SINONIMOS` (linhas 34–54).

Linha 35, trocar por:

```ts
  nome: ['nome', 'nome fantasia', 'nome comercial', 'empresa', 'fornecedor', 'razao social', 'parceiro', 'title'],
```

Linha 37, trocar por:

```ts
  categoria: ['categoria', 'segmento', 'ramo', 'servico', 'especialidade', 'category'],
```

Linha 38, trocar por:

```ts
  whatsapp: ['whatsapp', 'whats', 'telefone', 'celular', 'fone', 'contato', 'tel', 'numero', 'phone'],
```

E, logo depois da linha 53 (`site: [...]`), antes do `};` da linha 54, acrescentar:

```ts
  place_id: ['place id', 'cid', 'id do lugar', 'google cid'],
  email: ['email', 'e mail', 'emails', 'e mails', 'correio eletronico'],
  endereco: ['endereco', 'address', 'endereco completo', 'logradouro'],
  nota: ['nota', 'review rating', 'nota google', 'avaliacao google', 'estrelas'],
  avaliacoes_qtd: ['avaliacoes qtd', 'review count', 'avaliacoes', 'qtd de avaliacoes', 'numero de avaliacoes'],
```

Mantenha cada array numa linha só, como o resto do arquivo faz. Duas das linhas novas passam de 100 colunas, e isso é aceito aqui: `mapeamento.ts`, `tipos.ts` e `planilha.test.ts` **já falham** em `prettier --check` hoje (a linha 35 de `mapeamento.ts` tem 105 caracteres contra `printWidth: 100`), `.prettierignore` não exclui `apps/web/` e o CI roda `pnpm lint`, `pnpm typecheck`, `pnpm test`, `supabase db lint` e `supabase test db` — nunca `format:check`.

Quatro coisas que decidem a forma desses arrays, e nenhuma é estética:

1. **`cid` precisa ser sinônimo exato.** `acharCampo` faz uma passada exata em todos os campos e só depois uma por trecho com `c.length >= 4` (linhas 68–78). Com 3 letras, `cid` só pode ser pego na passada exata; na de trecho, `'cidade'.includes('cid')` o mandaria para **Cidade** — que é o que acontece hoje.
2. **Os campos novos entram no fim de `CAMPOS_EXTRAS`** (passo 6.3). `CHAVES` (linha 56) segue a ordem de `TODOS_OS_CAMPOS` e as duas passadas param no primeiro acerto.
3. **`nota` não recebe o sinônimo solto `avaliacao`.** Se recebesse, um cabeçalho "Qtd de avaliações" cairia em Nota pela passada de trecho antes de chegar em `avaliacoes_qtd`.
4. **`avaliacoes_qtd` não recebe o sinônimo solto `reviews`.** Se recebesse, a coluna `user_reviews` (texto de avaliação — proibida pelo R06 SCR-02) cairia num campo numérico. Sem ele, `user_reviews` não casa com nada, que é o que o segundo `describe` afirma.

- [ ] **6.5 — rodar e ver passar.**

```
pnpm -C apps/web test src/components/importacao/
```

Esperado: **3 arquivos, 63 testes, todos verdes** — 24 em `mapeamento.test.ts` (15 antigos + 9 novos), 24 em `planilha.test.ts` e 15 em `desfazer.test.ts`, os dois últimos intactos.

Se algum dos testes antigos da planilha-ponte quebrar, o sinônimo novo roubou uma coluna que já funcionava — volte ao passo 6.4 e tire o sinônimo culpado; **não conserte mexendo em `acharCampo`**. Os que denunciam isso primeiro são `casa as 17 colunas sozinho`, `nenhuma coluna da planilha-ponte precisa de conferência` e `não deixa a segunda coluna de telefone roubar a primeira`.

- [ ] **6.6 — lint e typecheck.**

```
pnpm -C apps/web lint
pnpm -C apps/web typecheck
```

Os dois têm de sair limpos. `ROTULO_EXTRA` é `Record<CampoExtra, string>` e `SINONIMOS` é `Record<CampoQualquer, string[]>`: se faltar um rótulo ou um sinônimo para qualquer campo novo, é aqui que aparece.

- [ ] **6.7 — commitar.**

```bash
git add apps/web/src/components/importacao/tipos.ts \
        apps/web/src/components/importacao/mapeamento.ts \
        apps/web/src/components/importacao/mapeamento.test.ts
git commit -F - <<'MSG'
Importação: os cinco campos do Maps e o cabeçalho em inglês

CAMPOS_EXTRAS ganha place_id, email, endereco, nota e avaliacoes_qtd, que
a whitelist do banco já permitia e a tela não sabia mapear. SINONIMOS
aprende title, category, phone, cid, emails, address, review_rating e
review_count — hoje o cabeçalho do google-maps-scraper-kit casava só link,
website, status e owner, e `cid` ia parar em Cidade. De brinde, uma coluna
"Endereço" deixa de cair em Site.

Os cinco campos entram no FIM de CAMPOS_EXTRAS de propósito: acharCampo
percorre os campos nessa ordem e para no primeiro acerto, então nenhum
sinônimo novo pode roubar por semelhança uma coluna da planilha-ponte.

RF-BAS-07, spec do pivô de 24/09/2026 §3.1 e §3.4.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Tarefa 7: a fixture do CSV do Maps e o teste de leitura

**Arquivos:** `apps/web/src/components/importacao/fixtures/maps-natal-buffet.csv` (novo), `apps/web/src/components/importacao/planilha.test.ts`. **Sem migração, sem `pnpm db:types`.**

**Interfaces**
- *Consome:* `descobrirSeparador` e `lerCsv` (já importados em `planilha.test.ts`, linhas 13–21) e o ajudante `texto` (linha 26).
- *Produz:* `apps/web/src/components/importacao/fixtures/maps-natal-buffet.csv` — 21 linhas (1 cabeçalho + 20 dados), BOM `EF BB BF`, separador vírgula, 29 colunas, `cid` duplicado `10453218876690042117` nas linhas 2 e 14. É a fixture que a conferência à mão em `/importar` deve usar. E o `describe 'CSV do google-maps-scraper-kit'` (12 testes).

**Por quê.** O leitor de CSV foi escrito contra a planilha-ponte: `;`, UTF-8 com BOM, 17 colunas, exportação do Excel em pt-BR. O kit devolve outra coisa: `,` como separador, 29 colunas em inglês, endereço com vírgula dentro de aspas em **toda** linha. Testar contra CSV escrito na hora no corpo do teste provaria só que o leitor concorda consigo mesmo — é o que o cabeçalho de `planilha.test.ts` já diz (linhas 1–8).

**O que a fixture tem, de propósito** (todos os dados são fictícios; nenhum telefone é de alguém):

| exigência | onde está |
|---|---|
| BOM UTF-8 no começo do arquivo | bytes `EF BB BF` antes de `link,` |
| separador `,` | 28 vírgulas no cabeçalho, e nenhum `;` nele |
| 20 linhas de dados | linhas 2 a 21 do arquivo |
| endereço com vírgula dentro de aspas | todas as 20 |
| descrição com vírgula dentro de aspas | "Confeitaria Dona Cotinha" e "Espaço Jardim das Artes" |
| um telefone fixo | "Salão Mirante do Forte", `+55 84 3999-9001` (10 dígitos, para exercitar `app.normalize_phone_br`) |
| um sem e-mail | "Espaço Verde Ponta Negra", coluna `emails` vazia — e sem `review_count`/`review_rating` |
| um endereço sem bairro | "Tendas Coqueiral", `Rodovia BR-101, Km 12, Parnamirim - RN, 59146-000` — `app.endereco_br` devolve cidade e CEP, e **nulo** no bairro |
| um `cid` duplicado | `10453218876690042117` nas linhas 2 e 14 ("Buffet Sabor do Sol"), com telefone e nota diferentes na segunda |

E mais quatro armadilhas que a esteira vai precisar: um e-mail inválido (`contato arroba djmarcinholima` → aviso `email_invalido`), dois e-mails separados por `;` na mesma célula, **sem aspas** ("Casa de Festas Pequeno Reino" → fica o primeiro; o `;` não atrapalha porque `descobrirSeparador` só lê a primeira linha), uma categoria fora do `source_category_map` ("Empresa de eventos" → `categoria_desconhecida`; as outras 12 categorias distintas do arquivo são exatamente as 12 do mapa de §3.3) e uma segunda cidade (Parnamirim, em duas linhas).

### Passos

- [ ] **7.1 — escrever o teste que falha.** Acrescentar ao **fim** de `apps/web/src/components/importacao/planilha.test.ts` (não mexa nos imports):

```ts

describe('CSV do google-maps-scraper-kit', () => {
  const cru = texto('maps-natal-buffet.csv');
  const maps = lerCsv(cru, 'maps-natal-buffet.csv');

  it('descobre a vírgula do kit, e não o ponto e vírgula do Excel', () => {
    const primeiraLinha = cru.slice(1).split('\n')[0] ?? '';
    expect(descobrirSeparador(primeiraLinha)).toBe(',');
  });

  it('tira o BOM e lê as 29 colunas', () => {
    expect(cru.charCodeAt(0)).toBe(0xfeff);
    expect(maps.cabecalho).toHaveLength(29);
    expect(maps.cabecalho[0]).toBe('link');
    expect(maps.cabecalho[13]).toBe('cid');
    expect(maps.cabecalho[26]).toBe('emails');
    expect(maps.cabecalho.at(-1)).toBe('linkedin');
  });

  it('lê as 20 linhas, sem confundir o cabeçalho com título', () => {
    expect(maps.linhas).toHaveLength(20);
    expect(maps.tituloIgnorado).toEqual([]);
    expect(maps.cortadas).toBe(0);
  });

  it('nenhuma linha escorregou de coluna', () => {
    // `montar` preenche e corta toda linha no tamanho do cabeçalho, então
    // `l.length === 29` seria verdade mesmo com uma vírgula a mais ou a menos
    // no arquivo. O que denuncia o escorregão é o CONTEÚDO de duas colunas
    // distantes: o `cid` tem 20 dígitos e o fuso é o mesmo nas 20 linhas.
    expect(maps.linhas.filter((l) => !/^\d{20}$/.test(l[13] ?? ''))).toEqual([]);
    expect(maps.linhas.filter((l) => l[18] !== 'America/Fortaleza')).toEqual([]);
  });

  it('preserva a vírgula de dentro do endereço entre aspas', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Buffet Sabor do Sol');
    expect(linha?.[3]).toBe('Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095');
  });

  it('preserva a vírgula de dentro da descrição entre aspas', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Espaço Jardim das Artes');
    expect(linha?.[15]).toBe('Salão climatizado, jardim e estacionamento, com cozinha de apoio');
  });

  it('o telefone fixo chega inteiro', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Salão Mirante do Forte');
    expect(linha?.[7]).toBe('+55 84 3999-9001');
  });

  it('lugar sem e-mail chega com a coluna vazia, e com telefone', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Espaço Verde Ponta Negra');
    expect(linha?.[26]).toBe('');
    expect(linha?.[7]).toBe('+55 84 99999-0005');
    // Sem nota e sem nº de avaliações: um lugar recém-cadastrado no Maps.
    expect(linha?.[9]).toBe('');
    expect(linha?.[10]).toBe('');
  });

  it('endereço sem bairro chega como veio, sem completar nada', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Tendas Coqueiral');
    expect(linha?.[3]).toBe('Rodovia BR-101, Km 12, Parnamirim - RN, 59146-000');
  });

  it('o mesmo cid aparece duas vezes, com telefone e nota diferentes', () => {
    const repetidas = maps.linhas.filter((l) => l[13] === '10453218876690042117');
    expect(repetidas).toHaveLength(2);
    expect(repetidas[0]?.[7]).toBe('+55 84 99999-0001');
    expect(repetidas[1]?.[7]).toBe('+55 84 99999-0013');
    expect(repetidas[0]?.[10]).toBe('4.7');
    expect(repetidas[1]?.[10]).toBe('4.8');
  });

  it('o ponto e vírgula de dentro do e-mail não vira separador', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Casa de Festas Pequeno Reino');
    expect(linha?.[26]).toBe(
      'festas@pequenoreinonatal.com.br;financeiro@pequenoreinonatal.com.br',
    );
  });

  it('nenhum telefone da fixture pode ser de alguém de verdade', () => {
    const fora = maps.linhas
      .map((l) => l[7] ?? '')
      .filter((t) => t !== '' && !/^\+55 84 (99999-00\d\d|3999-9001)$/.test(t));
    expect(fora).toEqual([]);
  });
});
```

- [ ] **7.2 — rodar e ver falhar.**

```
pnpm -C apps/web test src/components/importacao/planilha.test.ts
```

Esperado: **o arquivo inteiro falha na carga**, com `ENOENT: no such file or directory, open '…/fixtures/maps-natal-buffet.csv'` — `texto()` é chamado no corpo do `describe`, fora do `it`, e o Vitest executa os `describe` na coleta. Os 24 testes que já existiam não chegam a rodar.

- [ ] **7.3 — criar a fixture.** Dois comandos, e não um só: o arquivo precisa começar com o BOM UTF-8 (`EF BB BF`), que é o que o segundo `it` verifica e o que nenhum editor garante ao salvar. Da raiz do repositório:

```bash
printf '\xef\xbb\xbf' > apps/web/src/components/importacao/fixtures/maps-natal-buffet.csv
cat >> apps/web/src/components/importacao/fixtures/maps-natal-buffet.csv <<'CSV'
link,title,category,address,open_hours,popular_times,website,phone,plus_code,review_count,review_rating,latitude,longitude,cid,status,descriptions,reviews_link,thumbnail,timezone,price_range,images,reservations,menu,owner,about,user_reviews,emails,facebook,linkedin
https://www.google.com/maps/place/?q=place_id:10453218876690042117,Buffet Sabor do Sol,Buffet,"Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095",,,https://buffetsabordosol.com.br,+55 84 99999-0001,,184,4.7,-5.8801,-35.2011,10453218876690042117,Operacional,,https://www.google.com/maps/place/?q=place_id:10453218876690042117&reviews=1,https://lh5.googleusercontent.com/p/exemplo-1,America/Fortaleza,$$,,,,Buffet Sabor do Sol,,,contato@buffetsabordosol.com.br,https://www.facebook.com/buffetsabordosol,
https://www.google.com/maps/place/?q=place_id:11872340951226678431,Casa de Festas Pequeno Reino,Casa de festas infantis,"Av. Prudente de Morais, 4455 - Lagoa Nova, Natal - RN, 59056-200",segunda-feira: 09:00-18:00,,https://pequenoreinonatal.com.br,+55 84 99999-0002,,96,4.5,-5.8177,-35.2094,11872340951226678431,Operacional,,https://www.google.com/maps/place/?q=place_id:11872340951226678431&reviews=1,,America/Fortaleza,,,,,Pequeno Reino,,,festas@pequenoreinonatal.com.br;financeiro@pequenoreinonatal.com.br,,
https://www.google.com/maps/place/?q=place_id:12903447781120095563,Estúdio Luz de Dunas,Fotógrafo,"R. Mossoró, 780 - Petrópolis, Natal - RN, 59020-200",,,https://luzdedunas.com.br,+55 84 99999-0003,,51,4.9,-5.7905,-35.2028,12903447781120095563,Operacional,,https://www.google.com/maps/place/?q=place_id:12903447781120095563&reviews=1,,America/Fortaleza,,,,,Estúdio Luz de Dunas,,,ola@luzdedunas.com.br,,https://www.linkedin.com/company/luzdedunas
https://www.google.com/maps/place/?q=place_id:13664120037755884290,Salão Mirante do Forte,Salão de festas,"Av. Câmara Cascudo, 210 - Ribeira, Natal - RN, 59012-260",,,,+55 84 3999-9001,,233,4.2,-5.7741,-35.2049,13664120037755884290,Operacional,,https://www.google.com/maps/place/?q=place_id:13664120037755884290&reviews=1,,America/Fortaleza,,,,,Mirante do Forte,,,reservas@mirantedoforte.com.br,,
https://www.google.com/maps/place/?q=place_id:14220983355471106834,Espaço Verde Ponta Negra,Espaço para eventos,"Av. Eng. Roberto Freire, 8900 - Ponta Negra, Natal - RN, 59090-000",,,https://espacoverdepontanegra.com.br,+55 84 99999-0005,,,,-5.8836,-35.1725,14220983355471106834,Operacional,,https://www.google.com/maps/place/?q=place_id:14220983355471106834&reviews=1,,America/Fortaleza,,,,,Espaço Verde,,,,,
https://www.google.com/maps/place/?q=place_id:15330118826604477192,Pula-Pula Alegria Locações,Aluguel de brinquedos,"R. Serra do Mel, 45 - Neópolis, Natal - RN, 59088-100",,,,+55 84 99999-0006,,37,4.8,-5.8722,-35.2196,15330118826604477192,Operacional,,https://www.google.com/maps/place/?q=place_id:15330118826604477192&reviews=1,,America/Fortaleza,,,,,,,,alegria.locacoes@gmail.com,,
https://www.google.com/maps/place/?q=place_id:16091773450028866514,Confeitaria Dona Cotinha,Confeitaria,"Av. Amintas Barros, 3366 - Tirol, Natal - RN, 59022-050",,,https://donacotinha.com.br,+55 84 99999-0007,,412,4.6,-5.7986,-35.2114,16091773450028866514,Operacional,"Bolos, doces e salgados para festas",https://www.google.com/maps/place/?q=place_id:16091773450028866514&reviews=1,,America/Fortaleza,,,,,Dona Cotinha,,,bolos@donacotinha.com.br,,
https://www.google.com/maps/place/?q=place_id:17548902217763310048,Flores do Potengi,Floricultura,"R. Apodi, 155 - Tirol, Natal - RN, 59020-120",,,,+55 84 99999-0008,,78,4.3,-5.7931,-35.2087,17548902217763310048,Operacional,,https://www.google.com/maps/place/?q=place_id:17548902217763310048&reviews=1,,America/Fortaleza,,,,,,,,floresdopotengi@outlook.com,,
https://www.google.com/maps/place/?q=place_id:18660334498012275561,DJ Marcinho Lima,DJ,"Av. Rio Branco, 512 - Cidade Alta, Natal - RN, 59025-003",,,https://djmarcinholima.com.br,+55 84 99999-0009,,64,5.0,-5.7822,-35.2083,18660334498012275561,Operacional,,https://www.google.com/maps/place/?q=place_id:18660334498012275561&reviews=1,,America/Fortaleza,,,,,,,,contato arroba djmarcinholima,,
https://www.google.com/maps/place/?q=place_id:19077215530884461209,Tendas Coqueiral,Locação de tendas,"Rodovia BR-101, Km 12, Parnamirim - RN, 59146-000",,,,+55 84 99999-0010,,19,4.1,-5.9142,-35.2626,19077215530884461209,Operacional,,https://www.google.com/maps/place/?q=place_id:19077215530884461209&reviews=1,,America/Fortaleza,,,,,,,,comercial@tendascoqueiral.com.br,,
https://www.google.com/maps/place/?q=place_id:20114668903357720445,Buffet Maré Cheia,Serviço de buffet,"Av. Praia de Ponta Negra, 9001 - Ponta Negra, Natal - RN, 59090-100",,,https://buffetmarecheia.com.br,+55 84 99999-0011,,147,4.5,-5.8869,-35.1701,20114668903357720445,Operacional,,https://www.google.com/maps/place/?q=place_id:20114668903357720445&reviews=1,,America/Fortaleza,,,,,Maré Cheia,,,eventos@buffetmarecheia.com.br,,
https://www.google.com/maps/place/?q=place_id:21558790046612238870,Foto & Cia Natal,Serviço de fotografia,"R. Trairi, 900 - Petrópolis, Natal - RN, 59020-150",,,https://fotoecianatal.com.br,+55 84 99999-0012,,88,4.7,-5.7898,-35.2065,21558790046612238870,Operacional,,https://www.google.com/maps/place/?q=place_id:21558790046612238870&reviews=1,,America/Fortaleza,,,,,,,,estudio@fotoecianatal.com.br,,
https://www.google.com/maps/place/?q=place_id:10453218876690042117,Buffet Sabor do Sol,Buffet,"Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095",,,https://buffetsabordosol.com.br,+55 84 99999-0013,,191,4.8,-5.8801,-35.2011,10453218876690042117,Operacional,,https://www.google.com/maps/place/?q=place_id:10453218876690042117&reviews=1,,America/Fortaleza,,,,,Buffet Sabor do Sol,,,contato@buffetsabordosol.com.br,,
https://www.google.com/maps/place/?q=place_id:22903411778866540193,Eventos Dunas Produções,Empresa de eventos,"Av. Hermes da Fonseca, 1200 - Tirol, Natal - RN, 59020-650",,,https://eventosdunas.com.br,+55 84 99999-0014,,23,4.0,-5.7953,-35.2101,22903411778866540193,Operacional,,https://www.google.com/maps/place/?q=place_id:22903411778866540193&reviews=1,,America/Fortaleza,,,,,,,,producao@eventosdunas.com.br,,
https://www.google.com/maps/place/?q=place_id:23448120097735668204,Espaço Jardim das Artes,Espaço para eventos,"R. dos Caicós, 77 - Alecrim, Natal - RN, 59030-030",,,,+55 84 99999-0015,,310,4.6,-5.7836,-35.2237,23448120097735668204,Operacional,"Salão climatizado, jardim e estacionamento, com cozinha de apoio",https://www.google.com/maps/place/?q=place_id:23448120097735668204&reviews=1,,America/Fortaleza,,,,,,,,jardimdasartes@uol.com.br,,
https://www.google.com/maps/place/?q=place_id:24770335518820046791,Confeitaria Mel & Canela,Confeitaria,"Av. Jaguarari, 2100 - Lagoa Nova, Natal - RN, 59062-500",,,https://melecanela.com.br,+55 84 99999-0016,,265,4.4,-5.8210,-35.2128,24770335518820046791,Operacional,,https://www.google.com/maps/place/?q=place_id:24770335518820046791&reviews=1,,America/Fortaleza,,,,,,,,atendimento@melecanela.com.br,,
https://www.google.com/maps/place/?q=place_id:25081947760233115538,Buffet Infantil Tico-Tico,Casa de festas infantis,"R. Coronel Estevam, 1440 - Alecrim, Natal - RN, 59030-600",,,,+55 84 99999-0017,,132,4.2,-5.7871,-35.2254,25081947760233115538,Operacional,,https://www.google.com/maps/place/?q=place_id:25081947760233115538&reviews=1,,America/Fortaleza,,,,,,,,ticotico.festas@gmail.com,,
https://www.google.com/maps/place/?q=place_id:26619008843370554872,Cerimonial Casa Branca,Salão de festas,"Av. Sen. Salgado Filho, 3000 - Candelária, Natal - RN, 59064-000",,,https://cerimonialcasabranca.com.br,+55 84 99999-0018,,357,4.9,-5.8339,-35.2069,26619008843370554872,Operacional,,https://www.google.com/maps/place/?q=place_id:26619008843370554872&reviews=1,,America/Fortaleza,,,,,Casa Branca Cerimonial,,,cerimonial@casabranca.com.br,https://www.facebook.com/cerimonialcasabranca,https://www.linkedin.com/company/casabrancacerimonial
https://www.google.com/maps/place/?q=place_id:27230554418896007316,Locações Nordeste Tendas,Locação de tendas,"R. São José, 62 - Igapó, Natal - RN, 59104-160",,,,+55 84 99999-0019,,44,3.9,-5.7402,-35.2565,27230554418896007316,Operacional,,https://www.google.com/maps/place/?q=place_id:27230554418896007316&reviews=1,,America/Fortaleza,,,,,,,,nordestetendas@bol.com.br,,
https://www.google.com/maps/place/?q=place_id:28904117763350228641,Floricultura Orquídea do Norte,Floricultura,"Av. Ayrton Senna, 1580 - Nova Parnamirim, Parnamirim - RN, 59151-600",,,https://orquideadonorte.com.br,+55 84 99999-0020,,91,4.5,-5.8895,-35.2192,28904117763350228641,Operacional,,https://www.google.com/maps/place/?q=place_id:28904117763350228641&reviews=1,,America/Fortaleza,,,,,,,,vendas@orquideadonorte.com.br,,
CSV
```

Conferir que ficou como esperado:

```bash
# tem de começar com efbb bf
xxd apps/web/src/components/importacao/fixtures/maps-natal-buffet.csv | head -1
# 21
wc -l apps/web/src/components/importacao/fixtures/maps-natal-buffet.csv
# nada: toda linha tem 29 campos (28 vírgulas fora de aspas)
awk -F'"' '{n=0; for(i=1;i<=NF;i+=2){n+=gsub(/,/,",",$i)}; if(n!=28) print NR": "n}' \
  apps/web/src/components/importacao/fixtures/maps-natal-buffet.csv
```

- [ ] **7.4 — rodar e ver passar.**

```
pnpm -C apps/web test src/components/importacao/planilha.test.ts
```

Confira o número que o Vitest imprimir contra esta conta, e não contra memória: `planilha.test.ts` tinha **24** testes antes desta tarefa (1 + 2 + 3 + 4 + 4 + 1 + 3 + 1 + 5, na ordem dos `describe` do arquivo) e o bloco novo traz **12** — são **36**.

Depois, a pasta e o pacote inteiros:

```
pnpm -C apps/web test src/components/importacao/
pnpm -C apps/web test
pnpm -C apps/web lint
pnpm -C apps/web typecheck
```

Com a Tarefa 6 já dentro, a pasta dá **3 arquivos, 75 testes verdes** (24 + 36 + 15). `pnpm -C apps/web test` roda os 50 arquivos de `src/**/*.test.ts` e também tem de sair verde: a fixture nova não é importada por mais ninguém — se algo além da pasta `importacao/` quebrar, foi a Tarefa 6 que vazou.

- [ ] **7.5 — commitar.**

```bash
git add apps/web/src/components/importacao/fixtures/maps-natal-buffet.csv \
        apps/web/src/components/importacao/planilha.test.ts
git commit -F - <<'MSG'
Importação: a fixture do CSV do Maps, e o leitor contra ela

Vinte lugares fictícios de Natal no formato exato que o
google-maps-scraper-kit devolve: BOM, separador vírgula, 29 colunas em
inglês e endereço entre aspas com vírgula dentro. Tem um fixo, um sem
e-mail, um endereço sem bairro, dois e-mails separados por ponto e
vírgula na mesma célula e um cid repetido com nota e telefone
diferentes — os casos que a esteira precisa saber tratar.

O teste de alinhamento olha o conteúdo do cid e do fuso, e não o número
de colunas: `montar` preenche e corta toda linha no tamanho do
cabeçalho, então contar colunas não acharia uma vírgula a mais.

Nenhum telefone é de alguém: todos são +55 84 99999-00XX (e um fixo
3999-9001), e o teste recusa qualquer outro formato.

RF-BAS-07, spec do pivô de 24/09/2026 §3.4 e §3.5.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

**O que fica pronto ao fim das tarefas 6 e 7.** `sugerirMapa` no cabeçalho do kit devolve dez campos, todos `exato`; `linhaParaObjeto` emite `place_id`, `email`, `endereco`, `nota` e `avaliacoes_qtd` e não emite nada de `facebook`, `linkedin`, `thumbnail`, `images` ou `user_reviews`; e existe um CSV real em `fixtures/` para a conferência à mão em `/importar`. Quem converte esses campos em payload é `app.importacao_normalizar`, já entregue na Tarefa 2 — então, com as tarefas 1 a 5 aplicadas no banco local, subir a fixture em `/importar` já grava os quinze campos. Se você executar fora de ordem e o banco ainda não tiver a migração, a prévia descarta os cinco campos novos em silêncio: é o comportamento esperado, e não um defeito destas duas tarefas.

---

## Tarefa 8: o seletor de origem do lote (spec §3.4)

**Arquivos:** `apps/web/src/components/importacao/tipos.ts`, `tipos.test.ts` (novo), `mapeamento.ts`, `mapeamento.test.ts`, `seletor-de-origem.tsx` (novo), `passo-mapa.tsx`, `tela-importacao.tsx`, `apps/web/src/app/(app)/importar/page.tsx`.

**Interfaces**
- *Consome:* `config->>'entrada_por_arquivo'` nas fontes (Tarefa 5); `podeCriarParceiro`, `podeDesfazerLote`, `requireSession`, `createClient`, `abrirLote`.
- *Produz:* `export type OrigemDeArquivo = { id: number; slug: string; nome: string }`; `export function ehEntradaPorArquivo(config: unknown): boolean`; `faltando(mapa: Mapa, origemDoLote?: string)`; `linhaParaObjeto(valores, mapa, numeroDaLinha, origemDoLote?)`; `origemDoLoteLimpa` (privada ao módulo); `SeletorDeOrigem`; `PassoMapa` ganha a prop obrigatória `origemDoLote: string`; `TelaImportacao` troca `origemPlanilhaId: number` por `origens: readonly OrigemDeArquivo[]`.

**Por quê.** Hoje `/importar` grava `sources.slug = 'planilha'` fixo em `import_batches.source_id` (`apps/web/src/app/(app)/importar/page.tsx:26-30`). Um lote de raspagem do Google Maps rotulado "planilha" é mentira no registro legal das operações de tratamento (LGPD art. 37) — e `import_batches.source_id` é exatamente onde ela ficaria guardada. A tela passa a listar as fontes que aceitam arquivo, a pessoa escolhe, e `montarLinhas` injeta o **nome** da fonte escolhida em cada linha como campo `origem` quando o mapa não tiver coluna de origem. Na planilha-ponte a coluna existe e continua mandando.

**Antes de começar**, em toda sessão de terminal desta tarefa:

```bash
source /Users/matheusrondon/Documents/Tríade/scripts/dev-env.sh
```

### Passos

- [ ] **8.1 — teste que falha: `ehEntradaPorArquivo`.** Crie `apps/web/src/components/importacao/tipos.test.ts`:

```ts
/**
 * O seletor de origem do lote: quais fontes entram na lista.
 *
 * A pergunta não é "esta fonte está ligada?" — a fonte do Maps nasce DESLIGADA,
 * porque ninguém raspa de dentro do CRM (`is_enabled = false` é o que faz
 * `public.esteira_abrir_lote` recusar `p_kind = 'coleta'`, e só esse caso). É
 * "esta fonte entra por arquivo que uma pessoa sobe?".
 */
import { describe, expect, it } from 'vitest';

import { ehEntradaPorArquivo } from './tipos';

describe('fonte que entra por arquivo', () => {
  it('reconhece o booleano do jsonb', () => {
    expect(ehEntradaPorArquivo({ entrada_por_arquivo: true })).toBe(true);
  });

  it('reconhece o texto que o PostgREST devolve em `config->>`', () => {
    expect(ehEntradaPorArquivo({ entrada_por_arquivo: 'true' })).toBe(true);
  });

  it('não confunde com o `collector.enabled` nem com a chave ausente', () => {
    expect(ehEntradaPorArquivo({ collector: { kind: 'http', enabled: true } })).toBe(false);
    expect(ehEntradaPorArquivo({ entrada_por_arquivo: false })).toBe(false);
    expect(ehEntradaPorArquivo({})).toBe(false);
  });

  it('aguenta config torta sem estourar', () => {
    expect(ehEntradaPorArquivo(null)).toBe(false);
    expect(ehEntradaPorArquivo('{}')).toBe(false);
    expect(ehEntradaPorArquivo(undefined)).toBe(false);
  });
});
```

> Este arquivo **não** repete o teste de `podeDesfazerLote`: ele já existe, palavra por palavra, em `apps/web/src/components/importacao/desfazer.test.ts:40-52`, e lá ele cobre também o papel `financeiro`. Duplicar não acrescenta cobertura — acrescenta um segundo lugar para consertar quando `PAPEIS_QUE_DESFAZEM` mudar.

Rode e veja falhar (erro de importação: `ehEntradaPorArquivo` não existe):

```bash
pnpm -C apps/web test src/components/importacao/tipos.test.ts
```

- [ ] **8.2 — implementar `OrigemDeArquivo` e `ehEntradaPorArquivo`.** Em `apps/web/src/components/importacao/tipos.ts`, insira **logo antes** da linha de separador que abre a seção `// O arquivo lido` (linha 99, depois de `rotuloDoCampo`):

```ts
// ---------------------------------------------------------------------------
// A origem do lote
// ---------------------------------------------------------------------------

/** Uma fonte do catálogo que aceita arquivo: o que o seletor de origem lista. */
export type OrigemDeArquivo = {
  /** `sources.id` — é o `source_id` do lote em `import_batches`. */
  id: number;
  /** `sources.slug` — só serve para a tela escolher o padrão. */
  slug: string;
  /**
   * `sources.name`, e é ele que vai injetado em cada linha.
   *
   * O slug também casaria: `app.importacao_fonte` procura por
   * `app.chave_catalogo(s.name) = k or app.chave_catalogo(s.slug) = k`
   * (`20260904001820:227-229`), e as duas chaves levam à mesma linha. Manda-se
   * o NOME porque é o texto que a pessoa acabou de ler no seletor, e é o texto
   * que volta para a tela: `public.importacao_previa` devolve a coluna "Origem"
   * como `v_n ->> 'source_nome'` (`:748`), ou seja, o nome que está no banco.
   * Escrever o nome faz a ida e a volta dizerem a mesma coisa.
   */
  nome: string;
};

/**
 * A fonte entra no seletor quando `config.entrada_por_arquivo` é verdadeiro.
 *
 * Não é `kind = 'import'` nem `is_enabled`: `is_enabled` governa a COLETA
 * automática (`public.esteira_abrir_lote` só o consulta para `p_kind = 'coleta'`,
 * `20260904001600:1788-1790`), e a fonte do Maps nasce desligada de propósito —
 * a raspagem roda fora do CRM, num Docker em 127.0.0.1. Quem diz "esta fonte
 * entra por arquivo que uma pessoa sobe" é a chave da config, e só ela.
 *
 * Aceita `true` e `"true"`: o jsonb guarda booleano, e um filtro de PostgREST
 * por `config->>entrada_por_arquivo` devolveria texto.
 */
export function ehEntradaPorArquivo(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const valor = (config as Record<string, unknown>).entrada_por_arquivo;
  return valor === true || valor === 'true';
}
```

Rode, veja passar e commite:

```bash
pnpm -C apps/web test src/components/importacao/tipos.test.ts
git add apps/web/src/components/importacao/tipos.ts apps/web/src/components/importacao/tipos.test.ts
git commit -m "A tela sabe quais fontes entram por arquivo

O critério é config.entrada_por_arquivo, e não is_enabled: is_enabled só
governa a coleta automática (esteira_abrir_lote o consulta apenas para
p_kind='coleta'), e a fonte do Maps nasce desligada de propósito.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **8.3 — teste que falha: a injeção da origem e o obrigatório resolvido.** Em `apps/web/src/components/importacao/mapeamento.test.ts`, acrescente ao fim:

```ts
describe('a origem do lote entra na linha', () => {
  it('injeta o nome da fonte quando o arquivo não tem coluna de origem', () => {
    const mapa: Mapa = { nome: 0, categoria: 1, whatsapp: 2 };
    const objeto = linhaParaObjeto(
      ['Buffet Alegria', 'Buffet', '84 99999-0000'],
      mapa,
      2,
      'Google Maps (raspagem local)',
    );
    expect(objeto.origem).toBe('Google Maps (raspagem local)');
  });

  it('não mexe na linha quando o arquivo TEM coluna de origem', () => {
    const mapa: Mapa = { nome: 0, categoria: 1, origem: 2 };
    const objeto = linhaParaObjeto(
      ['Buffet Alegria', 'Buffet', 'Indicação'],
      mapa,
      2,
      'Google Maps (raspagem local)',
    );
    expect(objeto.origem).toBe('Indicação');
  });

  it('célula de origem vazia continua vazia: quem manda é a coluna', () => {
    const mapa: Mapa = { nome: 0, categoria: 1, origem: 2 };
    const objeto = linhaParaObjeto(
      ['Buffet Alegria', 'Buffet', ''],
      mapa,
      2,
      'Planilha (importação)',
    );
    expect('origem' in objeto).toBe(false);
  });

  it('sem origem escolhida, a linha sai como saía antes', () => {
    const mapa: Mapa = { nome: 0, categoria: 1 };
    expect('origem' in linhaParaObjeto(['A', 'B'], mapa, 2)).toBe(false);
    expect('origem' in linhaParaObjeto(['A', 'B'], mapa, 2, '   ')).toBe(false);
  });
});

describe('o obrigatório `origem`, com o seletor do lote', () => {
  it('a origem escolhida no lote resolve o obrigatório', () => {
    const mapa: Mapa = { nome: 0, categoria: 1 };
    expect(faltando(mapa)).toEqual(['origem']);
    expect(faltando(mapa, 'Google Maps (raspagem local)')).toEqual([]);
  });

  it('e não resolve nome nem categoria', () => {
    expect(faltando({}, 'Google Maps (raspagem local)')).toEqual(['nome', 'categoria']);
  });
});
```

Rode:

```bash
pnpm -C apps/web test src/components/importacao/mapeamento.test.ts
```

**Veja falhar — e confira QUAIS falham, que são exatamente três:**

1. `injeta o nome da fonte quando o arquivo não tem coluna de origem` — o 4º argumento é ignorado, e `objeto.origem` sai `undefined`.
2. `a origem escolhida no lote resolve o obrigatório` — a primeira asserção já passa; a segunda quebra.
3. `e não resolve nome nem categoria` — hoje devolve `['nome', 'categoria', 'origem']`.

As outras três asserções de injeção **já passam** com a implementação atual, e é bom que passem: são a rede que prova que a mudança não mexeu no caminho da planilha-ponte. Se o Vitest acusar um número diferente de três falhas, alguma coisa já saiu do lugar — pare e leia.

> **Não rode `pnpm -C apps/web typecheck` entre este passo e o próximo.** Ele vai reclamar de "Expected 3 arguments, but got 4" e de "Expected 1 argument, but got 2", e está certo. Os dois ficam verdes no 8.4.

- [ ] **8.4 — implementar a injeção em `mapeamento.ts`.** Substitua o bloco que vai da linha 106 (`/** Campos obrigatórios que o mapa ainda não cobre. */`) até a linha 131 (o `}` que fecha `linhaParaObjeto`) por:

```ts
/** A origem escolhida no seletor do lote, sem espaço em volta. Vazio = nenhuma. */
function origemDoLoteLimpa(origemDoLote?: string): string {
  return (origemDoLote ?? '').trim();
}

/**
 * Campos obrigatórios que o mapa ainda não cobre.
 *
 * `origemDoLote` é o nome da fonte escolhida no seletor da tela. Com ela,
 * `origem` deixa de ser pendência do ARQUIVO: a linha ganha a origem do lote em
 * `linhaParaObjeto`, e a exigência de LGPD continua cumprida — só que pelo
 * seletor, e não por uma coluna que o CSV do Maps não tem.
 */
export function faltando(mapa: Mapa, origemDoLote?: string): CampoQualquer[] {
  const doLote = origemDoLoteLimpa(origemDoLote);
  return CAMPOS_OBRIGATORIOS.filter(
    (c) => mapa[c] === undefined && !(c === 'origem' && doLote !== ''),
  );
}

/**
 * Uma linha da planilha vira o objeto que o banco entende.
 *
 * O número da linha vai junto (`linha`) e é o número REAL do arquivo, contando o
 * cabeçalho: quando a prévia disser "linha 47", a pessoa abre a planilha, vai na
 * 47 e vê o problema. Sem isso, a prévia obriga a contar linhas com o dedo.
 *
 * `origemDoLote` é o nome da fonte escolhida no seletor. Ela entra só quando o
 * ARQUIVO não tem coluna de origem. Na planilha-ponte a coluna existe e continua
 * mandando — inclusive quando a célula está vazia: ali o vazio é um dado (quem
 * preencheu não soube dizer de onde veio), e carimbá-lo com o nome do lote
 * inventaria uma proveniência.
 */
export function linhaParaObjeto(
  valores: string[],
  mapa: Mapa,
  numeroDaLinha: number,
  origemDoLote?: string,
): Record<string, string | number> {
  const objeto: Record<string, string | number> = { linha: numeroDaLinha };
  for (const campo of TODOS_OS_CAMPOS) {
    const indice = mapa[campo];
    if (indice === undefined) continue;
    const valor = (valores[indice] ?? '').trim();
    if (valor) objeto[campo] = valor;
  }
  const doLote = origemDoLoteLimpa(origemDoLote);
  if (mapa.origem === undefined && doLote !== '') objeto.origem = doLote;
  return objeto;
}
```

(`temConteudo`, logo abaixo, não muda.)

Rode, veja passar e commite:

```bash
pnpm -C apps/web test src/components/importacao/mapeamento.test.ts
git add apps/web/src/components/importacao/mapeamento.ts apps/web/src/components/importacao/mapeamento.test.ts
git commit -m "A origem do lote entra em cada linha quando o arquivo não traz coluna

O CSV do Google Maps não tem coluna de origem, e origem é obrigatória por
LGPD. Com a fonte escolhida no seletor, a linha ganha a origem do lote e o
obrigatório fica cumprido pelo seletor. Onde o arquivo TEM a coluna, ela
continua mandando — inclusive com a célula vazia, que ali é um dado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **8.5 — o componente do seletor.** Crie `apps/web/src/components/importacao/seletor-de-origem.tsx`:

```tsx
'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { OrigemDeArquivo } from './tipos';

/**
 * De onde veio esta lista (RF-BAS-10; anexo R06).
 *
 * Até aqui a tela gravava `planilha` fixo em `import_batches.source_id`. Um lote
 * de raspagem rotulado "planilha" é mentira no registro legal das operações de
 * tratamento — e é essa linha que se lê quando alguém pergunta de onde saiu o
 * número dele. A lista vem de `sources`, das fontes que aceitam arquivo.
 */
export function SeletorDeOrigem({
  origens,
  valor,
  aoMudar,
  temColunaDeOrigem,
}: {
  origens: readonly OrigemDeArquivo[];
  /** `sources.id` da fonte escolhida. */
  valor: number;
  aoMudar: (id: number) => void;
  /** O arquivo traz coluna de origem? Então ela manda em cada linha. */
  temColunaDeOrigem: boolean;
}) {
  const escolhida = origens.find((o) => o.id === valor);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-hairline p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="origem-do-lote" className="font-medium">
          De onde veio esta lista
        </label>
        <Select value={String(valor)} onValueChange={(v) => aoMudar(Number(v))}>
          <SelectTrigger id="origem-do-lote" className="toque h-11 w-full md:h-9 md:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {origens.map((o) => (
              <SelectItem key={o.id} value={String(o.id)}>
                {o.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">
        {temColunaDeOrigem ? (
          <>
            O arquivo tem uma coluna de origem: ela manda em cada linha.{' '}
            <span className="text-foreground">{escolhida?.nome ?? 'A origem escolhida'}</span> fica
            registrada no lote.
          </>
        ) : (
          <>
            Cada linha entra como{' '}
            <span className="text-foreground">{escolhida?.nome ?? 'a origem escolhida'}</span>. É o
            que o CRM responde quando perguntarem de onde saiu aquele número.
          </>
        )}
      </p>
    </div>
  );
}
```

Sem teste e sem commit próprio: o Vitest do `apps/web` roda em `environment: 'node'` e só coleta `src/**/*.test.ts` (`apps/web/vitest.config.mts`) — não há DOM para renderizar componente. Este arquivo entra no commit do 8.9.

- [ ] **8.6 — `PassoMapa` recebe a origem do lote.** Em `apps/web/src/components/importacao/passo-mapa.tsx`, duas edições.

**(a)** a assinatura, linhas 41-51:

```tsx
export function PassoMapa({
  planilha,
  mapa,
  sugestao,
  origemDoLote,
  aoMudar,
}: {
  planilha: PlanilhaLida;
  mapa: Mapa;
  sugestao: Sugestao;
  /**
   * Nome da fonte escolhida no seletor do lote. Com ela, a coluna "Origem"
   * deixa de ser obrigatória no arquivo: o CSV do Maps não tem uma.
   */
  origemDoLote: string;
  aoMudar: (mapa: Mapa) => void;
}) {
```

**(b)** a chamada de `faltando`, linha 61:

```tsx
  const pendentes = faltando(mapa, origemDoLote);
```

`PassoMapa` só é chamado de `tela-importacao.tsx` (confira com `grep -rn "PassoMapa" apps/web/src`), então não há outro chamador para acertar.

- [ ] **8.7 — a tela: estado, seletor e `montarLinhas`.** Em `apps/web/src/components/importacao/tela-importacao.tsx`, cinco edições.

**(a)** depois do import de `PassoPrevia` (linha 33):

```tsx
import { SeletorDeOrigem } from './seletor-de-origem';
```

**(b)** no bloco de imports de `./tipos` (linhas 36-43), acrescente `type OrigemDeArquivo,`:

```tsx
import {
  ROTULO_DECISAO,
  type LoteAnterior,
  type Mapa,
  type OrigemDeArquivo,
  type PlanilhaLida,
  type Previa,
  type Recibo as TipoRecibo,
} from './tipos';
```

**(c)** troque a prop `origemPlanilhaId` (linhas 64-77) por:

```tsx
export function TelaImportacao({ podeImportar, podeDesfazer, origens }: {
  /** Papéis que escrevem na base. A autorização de verdade é o RLS. */
  podeImportar: boolean;
  /**
   * Espelho de `app.is_manager()`: quem desfaz um lote (RF-BAS-17).
   *
   * Vem separado de `podeImportar` de propósito — quem importa (sdr) não desfaz,
   * e oferecer o botão a ela era o §3.7 do laudo.
   */
  podeDesfazer: boolean;
  /**
   * As fontes que entram por arquivo, para o seletor de origem do lote.
   * Nunca vazia: a página garante a planilha como último recurso.
   */
  origens: readonly OrigemDeArquivo[];
}) {
  const clienteDeConsultas = useQueryClient();

  // A planilha continua sendo o padrão: é o caso de todo dia, e mudar o padrão
  // faria a equipe rotular a planilha-ponte de Google Maps por distração.
  const padrao = origens.find((o) => o.slug === 'planilha') ?? origens[0];
  const [origemId, setOrigemId] = useState<number>(padrao?.id ?? 0);
  const escolhida = origens.find((o) => o.id === origemId) ?? padrao;
  const nomeDaOrigem = escolhida?.nome ?? '';
```

(A declaração `const [etapa, setEtapa] = useState<Etapa>('arquivo');` continua logo abaixo, sem mudança. `useState` já está importado na linha 3.)

**(d)** `montarLinhas` (linhas 169-180) e `importar`:

```tsx
  /** As linhas com conteúdo, já no formato que o banco entende. */
  const montarLinhas = useCallback((): LinhaCrua[] => {
    if (!planilha) return [];
    const saida: LinhaCrua[] = [];
    planilha.linhas.forEach((valores, i) => {
      if (!temConteudo(valores, mapa)) return;
      // +2: a linha 1 é o cabeçalho e a contagem da planilha começa em 1. Assim o
      // número que a prévia mostra é o número que a pessoa vê no Excel.
      //
      // A origem do lote entra aqui, e não só em `import_batches`: quem decide é
      // `public.importacao_gravar`, com `coalesce((v_n ->> 'source_id')::int,
      // v_b.source_id)` (`20260904001820:880-881`) — mandando nas duas, as duas
      // passam a ser a mesma por construção.
      saida.push(linhaParaObjeto(valores, mapa, i + 2, nomeDaOrigem));
    });
    return saida;
  }, [planilha, mapa, nomeDaOrigem]);
```

Em `importar` (linha 220), troque `origemPlanilhaId` por `origemId`:

```tsx
      loteId = await abrirLote(rotulo, origemId);
```

e a lista de dependências (linha 254):

```tsx
  }, [arquivo, clienteDeConsultas, montarLinhas, origemId]);
```

**(e)** as pendências e a renderização. Linha 266:

```tsx
  const pendentes = faltando(mapa, nomeDaOrigem);
```

No passo `arquivo` (linhas 297-303), o seletor vai acima de `PassoArquivo` — `ListaDeLotes`, logo abaixo, não muda:

```tsx
      {etapa === 'arquivo' ? (
        <>
          <SeletorDeOrigem
            origens={origens}
            valor={origemId}
            aoMudar={setOrigemId}
            temColunaDeOrigem={false}
          />
          <PassoArquivo
            aoEscolher={lerArquivoEscolhido}
            ocupado={passoDaLeitura !== null}
            passo={passoDaLeitura}
          />
```

(`temColunaDeOrigem={false}` é verdade neste passo: nenhum arquivo foi lido ainda, `mapa` é `{}`.)

No passo `mapa` (linhas 315-318), o seletor continua à mão — é ali que a pessoa descobre que o arquivo não tem coluna de origem:

```tsx
      {etapa === 'mapa' && planilha ? (
        <>
          <ArquivoEscolhido arquivo={arquivo} planilha={planilha} aoTrocar={recomecar} />
          <SeletorDeOrigem
            origens={origens}
            valor={origemId}
            aoMudar={setOrigemId}
            temColunaDeOrigem={mapa.origem !== undefined}
          />
          <PassoMapa
            planilha={planilha}
            mapa={mapa}
            sugestao={sugestao}
            origemDoLote={nomeDaOrigem}
            aoMudar={setMapa}
          />
```

- [ ] **8.8 — a página lista as fontes que entram por arquivo.** Substitua `apps/web/src/app/(app)/importar/page.tsx` inteiro por:

```tsx
import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { podeCriarParceiro } from '@/lib/navegacao';
import {
  ehEntradaPorArquivo,
  podeDesfazerLote,
  type OrigemDeArquivo,
} from '@/components/importacao/tipos';
import { createClient } from '@/lib/supabase/server';
import { TelaImportacao } from '@/components/importacao/tela-importacao';

export const metadata: Metadata = { title: 'Importar planilha' };

/**
 * Fonte "planilha" do catálogo, se por algum motivo a seed não tiver rodado.
 *
 * O id 8 é a posição da linha `planilha` no `insert` de `supabase/seed.sql:159`
 * sobre a `serial` de `public.sources`. É um palpite de último recurso: num
 * banco em que a seed não rodou, `esteira_abrir_lote` responde `origem_invalida`
 * — que é o certo, e é mensagem de erro na tela, não lote com origem errada.
 */
const ORIGEM_PADRAO: OrigemDeArquivo = {
  id: 8,
  slug: 'planilha',
  nome: 'Planilha (importação)',
};

/**
 * Importar planilha (RF-BAS-07; PRD §11.2 D2; anexo R06 para a proveniência).
 *
 * O servidor faz duas coisas: descobre o papel de quem entrou (para não oferecer
 * uma tela — nem um botão — que o RLS vai recusar; importar e DESFAZER são dois
 * conjuntos de papéis diferentes, §3.7 do laudo) e lista as fontes que entram
 * por arquivo, que é o seletor de origem do lote. Não é mais a `planilha` fixa:
 * o CSV do Google Maps entra pela mesma porta (ADR-08) e precisa ficar
 * registrado como o que é (ADR-12). Ler o arquivo, conferir a prévia e gravar
 * acontece no cliente, contra as funções do Postgres.
 */
export default async function Pagina() {
  const [sessao, supabase] = await Promise.all([requireSession(), createClient()]);

  // `sources_select` é `for select to authenticated using (true)`
  // (`20260904000500:96`): qualquer papel que chegue aqui lê o catálogo.
  const { data } = await supabase.from('sources').select('id, slug, name, config').order('name');

  // O filtro é aqui, e não no PostgREST: `config->>entrada_por_arquivo` não é
  // coluna, e o cliente tipado não conhece caminho dentro de jsonb. São treze
  // fontes no catálogo inteiro — filtrar em memória não custa nada.
  const origens: OrigemDeArquivo[] = (data ?? [])
    .filter((f) => ehEntradaPorArquivo(f.config))
    .map((f) => ({ id: f.id, slug: f.slug, nome: f.name }));

  return (
    <TelaImportacao
      podeImportar={podeCriarParceiro(sessao.papel)}
      podeDesfazer={podeDesfazerLote(sessao.papel)}
      origens={origens.length > 0 ? origens : [ORIGEM_PADRAO]}
    />
  );
}
```

> São **treze** fontes no catálogo depois da Tarefa 5 (doze na `seed.sql` mais a `google_maps_raspado`). A página engole o `error` do select em `sources` — comportamento pré-existente: um erro de leitura cai no fallback e a pessoa vê um seletor com uma opção só, o que ao menos se anuncia na tela.

- [ ] **8.9 — rodar tudo e commitar.**

```bash
pnpm -C apps/web test src/components/importacao
pnpm -C apps/web lint
pnpm -C apps/web typecheck
```

Os três verdes.

> Se o `typecheck` reclamar em `ehEntradaPorArquivo(f.config)`, **não** é falta de `pnpm db:types`: `sources.config` está em `database.types.ts` como `config: Json` desde o primeiro `gen types` (a coluna existe desde `20260904000200:225`). O motivo real é outro: sobrou uma referência a `origemPlanilhaId`. Ache com `grep -rn "origemPlanilhaId" apps/web/src` — não pode achar nada.

Confira na tela: `pnpm dev`, abra `http://localhost:3000/importar`. Para o seletor mostrar **Google Maps (raspagem local)** e **Planilha (importação)**, o banco local precisa já ter a migração da **Tarefa 5** aplicada — se você ainda não rodou `pnpm db:reset` desde então, o seletor vai listar só a planilha, e isso não é defeito desta tarefa. (Aba já aberta roda o JS antigo: `Ctrl+Shift+R` antes de olhar.)

```bash
git add apps/web/src/components/importacao apps/web/src/app/\(app\)/importar/page.tsx
git commit -m "A importação pergunta de onde veio a lista

O lote deixa de nascer rotulado 'planilha' por padrão: a tela lista as fontes
que entram por arquivo e injeta o nome da escolhida em cada linha que não tiver
coluna de origem. RF-BAS-07, RF-BAS-10, ADR-08, ADR-12.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarefa 9: o perfil `maps` no Docker da máquina dedicada (spec §3.4)

**Arquivos:** `infra/local/docker-compose.yml`, `infra/local/.env.example`, `infra/local/README.md`.

**Interfaces**
- *Consome:* o anchor `*logging` do compose, `.gitignore:25` (`infra/local/data/*`).
- *Produz:* serviço `maps-scraper`, perfil `maps`, porta `127.0.0.1:${MAPS_SCRAPER_PORT:-8080}:8080`, volume `./data/maps/saida:/app/webdata`; `MAPS_SCRAPER_TAG`, `MAPS_SCRAPER_PORT`, `MEM_MAPS_SCRAPER` no `.env.example`; a linha na tabela e a seção `### Raspar o Google Maps (perfil maps, ADR-12)` no README.

**Por quê.** O CSV vem de um raspador que roda **fora** do CRM, em `127.0.0.1:8080`. Hoje ele está só na máquina do Rafael, dirigido pelo Claude Code. Um perfil no compose faz a máquina dedicada rodar o mesmo comando depois, com a porta presa no loopback e a saída numa pasta já ignorada pelo git. Nada disto liga o raspador ao CRM: a Vercel e o Fly.io não alcançam `127.0.0.1` em Natal, e é de propósito — com uma pessoa no meio, a raspagem vira decisão auditável em `import_batches.triggered_by` em vez de cron silencioso.

**Antes de começar:**

```bash
source /Users/matheusrondon/Documents/Tríade/scripts/dev-env.sh
```

O `docker` do OrbStack não está no PATH padrão e o `DOCKER_HOST` precisa apontar para o socket dele; o script faz as duas coisas.

### Passos

- [ ] **9.1 — conferir que a pasta de saída já está ignorada.**

```bash
sed -n '24,27p' /Users/matheusrondon/Documents/Tríade/.gitignore
```

Tem de imprimir exatamente:

```
# infra local
infra/local/data/*
!infra/local/data/.gitkeep
infra/local/.env
```

Se imprimir isso, **nada a fazer neste passo** — `infra/local/data/maps/saida/` já está coberto. Se não imprimir, pare e avise: alguém mexeu no `.gitignore` e o CSV com dados pessoais entraria no git.

Crie a pasta antes de subir o contêiner, para ela nascer com o seu usuário em vez de `root`:

```bash
mkdir -p /Users/matheusrondon/Documents/Tríade/infra/local/data/maps/saida
```

- [ ] **9.2 — atualizar o cabeçalho de perfis do compose.** Em `infra/local/docker-compose.yml`, na lista de perfis (linhas 14-19), depois da linha do `tunel`, acrescente:

```
#   maps          maps-scraper (ADR-12; raspagem do Google Maps, tarefa de operador — não deixe ligado)
```

E, nas **linhas 10-11**, troque:

```
# nenhum serviço publica porta para a internet — o único `ports:` do arquivo é o do
# Metabase, preso em 127.0.0.1. Administração pela Tailscale.
```

por:

```
# nenhum serviço publica porta para a internet — os dois únicos `ports:` do arquivo
# (Metabase e maps-scraper) ficam presos em 127.0.0.1. Administração pela Tailscale.
```

- [ ] **9.3 — o serviço `maps-scraper`.** Acrescente ao **fim do arquivo** (depois do bloco `cloudflared`, que termina em `pids_limit: 128`):

```yaml

  # -------------------------------------------------------------------------
  # maps-scraper — a lista de prospecção vem daqui (ADR-12).
  #
  # O que é: `gosom/google-maps-scraper` (MIT) em modo web — fila de tarefas na
  # interface e um CSV por tarefa. Na máquina do Rafael a mesma coisa é operada
  # pelo `google-maps-scraper-kit`, que é um invólucro de conveniência em volta
  # deste mesmo binário: não muda o que é coletado nem o ritmo. Aqui rodamos a
  # imagem de cima direto, porque é ela que existe publicada.
  #
  # Contraria os Termos do Google e REVOGA por escrito o R06 §B.1 SCR-04 —
  # decisão do Rafael em 24/09/2026, risco assumido no nível da empresa e
  # registrado em `sources.terms_notes` da fonte `google_maps_raspado`.
  #
  # O que continua valendo do SCR-03, e é o que limita o dano: sem login, sem
  # burla de CAPTCHA, sem proxy rotativo, user-agent identificado, ritmo de 1
  # requisição a cada 5 s. ATENÇÃO: `-c 1` é UMA aba por vez (concorrência), e
  # NÃO um intervalo de 5 s — a ferramenta não conhece o nosso ritmo. O intervalo
  # é limite de conduta, garantido por quem opera, e o passo 9.5 manda conferir
  # em `-h` se existe flag de atraso para codificá-lo.
  # Limite de conduta: no máximo 2 rodadas por semana, 600 lugares por rodada, só
  # Natal e região metropolitana. Se der bloqueio de IP ou CAPTCHA: PARE E AVISE.
  # Insistir com proxy ou login transforma quebra de contrato em acesso não
  # autorizado.
  #
  # O CRM NÃO fala com este contêiner. A web roda na Vercel e o worker-wa no
  # Fly.io; nenhum dos dois alcança 127.0.0.1 em Natal, e é de propósito: com uma
  # pessoa no meio, quem sobe o arquivo nomeia o lote, lê a prévia e fica
  # registrado em `import_batches.triggered_by`.
  #
  # PASSO A PASSO DO OPERADOR (spec §3.4):
  #   1. mkdir -p infra/local/data/maps/saida
  #      docker compose -f infra/local/docker-compose.yml --profile maps up -d
  #   2. Pedir ao Claude Code a consulta: categoria + cidade ("buffet infantil em
  #      Natal RN"), teto de 600 lugares, ritmo de 5 s.
  #   3. O kit escreve em ./data/maps/saida/, por exemplo
  #      2026-09-25-buffet-infantil-natal.csv
  #   4. Abrir /importar, escolher "Google Maps (raspagem local)" no seletor de
  #      origem e arrastar o CSV.
  #   5. Conferir o mapa de colunas sugerido (a tela diz se cada acerto foi
  #      `exato` ou `parecido`).
  #   6. Ler a prévia — quantas entram, quantas são duplicata DE QUEM, quantas vão
  #      para revisão, quantas pediram para parar — e gravar.
  #   7. Ler o recibo, derrubar o contêiner (`--profile maps down`) e APAGAR O CSV
  #      da pasta. Enquanto o arquivo existe, é uma base de dados pessoais fora do
  #      CRM: sem retenção, sem RLS e sem auditoria.
  # -------------------------------------------------------------------------
  maps-scraper:
    # Tag por variável porque a imagem sobe versão sem aviso, e pinar um número
    # que não existe quebraria o `up` de quem clonar o repo. Fixe em ./.env
    # quando uma rodada boa acontecer, para repeti-la igual.
    image: gosom/google-maps-scraper:${MAPS_SCRAPER_TAG:-latest}
    # Confirmado contra `-h` no passo 9.5, que é onde estes três nomes valem ou
    # são corrigidos: -web sobe a interface na 8080, -data-folder é onde ela grava
    # o CSV de cada tarefa, -c 1 é uma aba por vez.
    command: ['-web', '-data-folder', '/app/webdata', '-c', '1']
    ports:
      # Loopback do host, de propósito: nada de LAN, nada de internet, nada que o
      # CRM alcance. Quem abre a interface é a pessoa sentada na máquina.
      - '127.0.0.1:${MAPS_SCRAPER_PORT:-8080}:8080'
    volumes:
      - ./data/maps/saida:/app/webdata
    profiles: ['maps']
    # `no`, e não `unless-stopped`: o raspador é tarefa de operador, ligada para
    # uma rodada e desligada depois. Um raspador que volta sozinho a cada boot é
    # exatamente o cron silencioso que a §3.4 recusou.
    restart: 'no'
    init: true
    stop_grace_period: 30s
    logging: *logging
    # Endurecimento escrito à mão, e não `<<: *endurecimento`, pelo mesmo motivo
    # do metabase logo acima: este contêiner roda um Chromium, e Chromium em
    # contêiner é o caso clássico de precisar de exceção. Escrevendo aqui, a
    # exceção (se for preciso, passo 9.5) não mexe no anchor de que os outros
    # seis contêineres dependem.
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    # O Chromium morre com os 64 MB de /dev/shm padrão do Docker — mesmo motivo
    # do worker-ingest (linha 103).
    shm_size: 512m
    tmpfs:
      - /tmp:size=512m,mode=1777
    mem_limit: ${MEM_MAPS_SCRAPER:-2g}
    mem_reservation: 512m
    memswap_limit: ${MEM_MAPS_SCRAPER:-2g}
    cpus: 2.0
    pids_limit: 512
```

- [ ] **9.4 — as variáveis no `.env.example`.** Em `infra/local/.env.example`, na lista de perfis (linhas 31-36), depois da linha do `tunel` (linha 35):

```
#   maps          maps-scraper (ADR-12) — tarefa de operador, NUNCA deixe ligado em COMPOSE_PROFILES
```

Logo depois do bloco do Metabase (depois de `METABASE_PORT=3001`, linha 44):

```
# ---------------------------------------------------------------------------
# maps-scraper (perfil `maps`, ADR-12)
# ---------------------------------------------------------------------------
# Versão da imagem. `latest` funciona; fixe numa tag quando uma rodada boa
# acontecer, para poder repeti-la igual.
MAPS_SCRAPER_TAG=latest
# Porta no HOST, sempre presa em 127.0.0.1 (o compose fixa o endereço; aqui só o número).
MAPS_SCRAPER_PORT=8080
```

E, no bloco de limites de memória, **ao fim dele**, depois de `MEM_OSRM_PREPARO=4g` (linha 74):

```
# Só durante uma rodada de raspagem: o perfil `maps` não fica ligado, então isto
# não entra na conta dos ~9,3 GB acima — como o MEM_OSRM_PREPARO, que roda uma vez.
MEM_MAPS_SCRAPER=2g
```

- [ ] **9.5 — validar a sintaxe e subir.**

```bash
cd /Users/matheusrondon/Documents/Tríade/infra/local
docker compose -f docker-compose.yml config --no-env-resolution -q && echo "sintaxe ok"
```

> `--no-env-resolution` é flag do subcomando `config`, e por isso vem **depois** dele — é assim que o próprio `infra/local/README.md:46` já documenta. Escrito antes do `-f`, o Docker responde "unknown flag". E nunca rode `docker compose config` sem ela: ele imprime o conteúdo dos `env_file`, ou seja, as chaves de produção.

```bash
docker compose -f docker-compose.yml --profile maps up -d
curl -fsSL -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/    # 200 (pode redirecionar; por isso -L)
ls -d data/maps/saida                                                  # a pasta existe
docker compose -f docker-compose.yml --profile maps down
```

Se algo der errado:

- **"open ../../.env: no such file or directory"** — o Compose lê os `env_file` de todos os serviços do arquivo, inclusive os que o perfil não sobe. Esse é o `.env` da raiz do repositório; crie-o a partir de `.env.example` da raiz.
- **O contêiner morre em laço.** Leia `docker compose logs maps-scraper`. Se a flag `-web`, `-data-folder` ou `-c` não existir nesta versão, rode `docker run --rm gosom/google-maps-scraper:latest -h` e corrija o `command:` com os nomes impressos. **Nessa mesma leitura, procure uma flag de atraso entre requisições** (algo como `-delay`, `-rate`, `-interval`). Se existir, ponha-a no `command:` com o valor de 5 s e troque o comentário do serviço para dizer que o ritmo é aplicado pela ferramenta. Se não existir, deixe o comentário como está: o intervalo é conduta do operador, e escrever que o `-c 1` o garante seria mentira em cima de uma decisão já delicada.
- **Chromium reclamando de sandbox, `clone`, `namespace` ou capability.** Duas saídas, nesta ordem: (1) se a imagem já passa `--no-sandbox` ao Chromium, o erro é outro — releia o log; (2) se for mesmo o sandbox, tire a linha `security_opt: [- no-new-privileges:true]` **deste serviço só** (é ela que impede o binário setuid do sandbox de ganhar privilégio) e, se ainda faltar, acrescente `cap_add: [SYS_ADMIN]`, com um comentário dizendo por quê — é exatamente o que o `metabase` faz nas linhas 209-217. **Não mexa no `x-endurecimento` compartilhado.**
- **"permission denied" ao gravar em `/app/webdata`** — a pasta do host foi criada pelo Docker como `root`. `sudo chown -R "$(id -u):$(id -g)" data/maps` e suba de novo.

- [ ] **9.6 — a seção nova no README de `infra/local`.** Na tabela "O que sobe aqui" (linhas 10-20), depois de `cloudflared`:

```
| `maps-scraper`   | `maps`         | Lista de prospecção raspada do Google Maps (ADR-12)                 | `127.0.0.1:8080` |
```

Logo abaixo da tabela (linhas 22-24), troque o parágrafo "Nenhum serviço abre porta para a internet" por:

```
**Nenhum serviço abre porta para a internet.** A recepção de webhook (Meta, Komune) fica nas
Edge Functions do Supabase, que enfileiram em `pgmq`; aqui só se **consome** fila. Os dois
únicos `ports:` do arquivo — Metabase e `maps-scraper` — ficam presos em `127.0.0.1`; de fora
chega-se pela Tailscale.
```

Na seção "Dados locais (`./data`, gitignored)" (linha 80), acrescente uma quarta linha:

```
- `data/maps/saida/` — CSV de cada rodada do `maps-scraper`. **É base de dados pessoais**:
  apague o arquivo assim que a importação terminar (passo 7 abaixo).
```

E acrescente, **antes** da seção "### Desenvolvimento: alcançar o OSRM de fora do Docker" (linha 86), a seção nova. Cole só o miolo, sem as quatro crases:

````markdown
### Raspar o Google Maps (perfil `maps`, ADR-12)

A lista de prospecção vem daqui: o `gosom/google-maps-scraper` (MIT) devolve CSV **com
telefone**, e o CSV entra pela porta da planilha — nenhum caminho novo de escrita para a
base (ADR-08). Na máquina do Rafael a mesma coisa é operada pelo `google-maps-scraper-kit`,
um invólucro de conveniência do mesmo binário.

Isto **contraria os Termos de Serviço do Google** e revoga por escrito a recusa do
R06 §B.1 SCR-04. É decisão do Rafael de 24/09/2026, com o risco registrado em
`sources.terms_notes` da fonte `google_maps_raspado`. O que continua valendo, e é o que
limita o dano: sem login, sem burla de CAPTCHA, sem proxy rotativo, user-agent
identificado, 1 requisição a cada 5 s. Limite de conduta: **2 rodadas por semana, 600
lugares por rodada, só Natal e região metropolitana**. Deu bloqueio de IP ou CAPTCHA:
**pare e avise** — insistir com proxy ou login transforma quebra de contrato em acesso não
autorizado.

O ritmo de 5 s é **conduta de quem opera**, não flag: `-c 1` limita a concorrência a uma
aba por vez e não impõe intervalo nenhum. Se uma versão da imagem passar a ter flag de
atraso, ela entra no `command:` e este parágrafo muda.

O CRM **não** chama este contêiner. A web roda na Vercel e o `worker-wa` no Fly.io, e
nenhum dos dois alcança `127.0.0.1` em Natal. Com uma pessoa no meio, quem sobe o arquivo
nomeia o lote, lê a prévia e fica registrado em `import_batches.triggered_by`: a raspagem
vira decisão auditável em vez de cron silencioso.

```bash
# 1. subir (só durante a rodada; o perfil NÃO entra no COMPOSE_PROFILES do .env)
mkdir -p data/maps/saida
docker compose -f docker-compose.yml --profile maps up -d
open http://127.0.0.1:8080

# 2. pedir ao Claude Code a consulta: categoria + cidade ("buffet infantil em Natal RN"),
#    teto de 600 lugares, ritmo de 5 s

# 3. o kit escreve em ./data/maps/saida/, por exemplo:
ls data/maps/saida

# 7. terminada a importação, derrubar e APAGAR o arquivo
docker compose -f docker-compose.yml --profile maps down
rm data/maps/saida/*.csv
```

Entre os passos 3 e 7, no CRM: abrir `/importar`, escolher **Google Maps (raspagem local)**
no seletor de origem, arrastar o CSV, conferir o mapa de colunas (a tela diz se cada acerto
foi `exato` ou `parecido`), ler a prévia — quantas entram, quantas são duplicata **de quem**,
quantas vão para revisão, quantas pediram para parar — e gravar. 600 linhas cabem sem
ajuste: o cliente fatia em 200 para a prévia e 100 para a gravação.

**O passo 7 não é zelo.** Enquanto o CSV existe na pasta, é uma base de dados pessoais fora
do CRM: sem retenção, sem RLS e sem auditoria.
````

- [ ] **9.7 — commit.**

```bash
cd /Users/matheusrondon/Documents/Tríade
git add infra/local/docker-compose.yml infra/local/.env.example infra/local/README.md
git commit -m "O raspador do Maps ganha perfil no compose da máquina dedicada

Perfil 'maps', porta presa em 127.0.0.1:8080, saída em data/maps/saida (já
gitignored) e o passo a passo do operador no compose e no README. O
endurecimento é escrito à mão neste serviço, como no metabase, porque
Chromium em contêiner pede exceção e o anchor é de outros seis. O ritmo de
5 s fica escrito como conduta: -c 1 é concorrência, não intervalo.

O CRM não fala com ele: a raspagem continua sendo decisão de gente. ADR-12.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarefa 10: fechamento da Fase 1

**Arquivos:** `packages/schema/src/database.types.ts`, `docs/CHANGELOG.md`.

**Interfaces**
- *Consome:* tudo o que as nove tarefas anteriores produziram.
- *Produz:* os tipos regerados contra um banco reconstruído do zero, a conferência dos oito critérios de pronto da §13 e a entrada de CHANGELOG da fase.

**Antes de começar**, em toda sessão de terminal:

```bash
source /Users/matheusrondon/Documents/Tríade/scripts/dev-env.sh
```

### Passos

- [ ] **10.1 — banco do zero e tipos regerados.** O `db:types` lê o banco local: sem reconstruir, ele geraria tipos de um banco que não tem as migrações desta fase.

```bash
pnpm db:start      # se o Supabase local ainda não estiver de pé
pnpm db:reset      # reaplica todas as migrações + supabase/seed.sql
pnpm db:types      # reescreve packages/schema/src/database.types.ts
git diff --stat packages/schema/src/database.types.ts
```

Confira que a migração da Fase 1 de fato subiu, direto no catálogo do Postgres:

```bash
export BANCO="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
psql "$BANCO" -c "select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'endereco_br';"
psql "$BANCO" -c "select id, slug, name, kind, is_enabled, config -> 'entrada_por_arquivo' from public.sources where slug in ('google_maps_raspado', 'planilha');"
```

A primeira tem de devolver `app.endereco_br`; a segunda, duas linhas, as duas com `true` em `entrada_por_arquivo`, e `google_maps_raspado` com `kind = import` e `is_enabled = f`.

E que os tipos foram mesmo regerados:

```bash
grep -c "endereco_br" packages/schema/src/database.types.ts   # > 0
```

Se o `psql` achar a função mas o `grep` não achar nada, o `db:types` não rodou — repita. Se o `psql` não achar a função, pare: a migração não subiu, e a suíte seguinte vai falhar por motivo errado.

- [ ] **10.2 — pgTAP.**

```bash
pnpm db:test
grep -n "select plan(" supabase/tests/66_o_csv_do_maps.sql   # select plan(43);
ls supabase/tests/*.sql | wc -l                               # 66 (eram 65)
```

- [ ] **10.3 — lint e typecheck.**

```bash
pnpm lint
pnpm typecheck
```

- [ ] **10.4 — Vitest.**

```bash
pnpm test
```

Anote os dois números que o Vitest imprime para o `apps/web` (arquivos e testes): eles vão para o CHANGELOG. A entrada de 24/09 registrou 780 testes; o número novo é maior.

- [ ] **10.5 — os critérios de pronto da Fase 1 (spec §13).** Os oito, com o comando que prova cada um. A variável `$BANCO` é a do passo 10.1.

**1. A prévia bate com o recibo linha a linha.** Importe um CSV de verdade pela tela e compare o que a prévia mostrou com o recibo. O que ficou gravado:

```bash
psql "$BANCO" -c "select label, status, stats from public.import_batches order by created_at desc limit 1;"
```

A verificação automática do caso duro (mesmo arquivo duas vezes) é o bloco 6 de `supabase/tests/66_o_csv_do_maps.sql`, escrito na Tarefa 3 — ache com `grep -n "Reimportar o mesmo arquivo" supabase/tests/66_o_csv_do_maps.sql`.

**2. As fichas criadas respondem `origem_dos_dados` com a URL do lugar no Maps em `phone_e164` e em `place_id`.**

```bash
psql "$BANCO" -c "select jsonb_pretty(public.origem_dos_dados(o.id)) from public.organizations o join public.sources s on s.id = o.source_id where s.slug = 'google_maps_raspado' order by o.created_at desc limit 1;"
```

Em `campos` têm de aparecer duas entradas com `"campo": "phone_e164"` e `"campo": "place_id"`, as duas com a mesma `url`. (Funciona pelo `psql` sem JWT: `app.role()` cai em `leitura`, que está em `app.sees_all()`.) A versão automática é o bloco 11 do arquivo 66, escrito na Tarefa 4.

**3. Reimportar o mesmo arquivo cria zero ficha nova** e devolve `repetida`/`ja_importado`:

```bash
pnpm db:test   # bloco 6 do arquivo 66
```

**4. `esteira_desfazer_lote` limpa o lote inteiro dentro das 48 h**, e `count(*)` de `organizations` volta ao de antes. O caminho normal é a própria tela: entre como **gestor** ou **admin** em `/importar` e aperte "Desfazer" no lote.

```bash
psql "$BANCO" -c "select count(*) as antes from public.organizations where deleted_at is null;"
# ...aperte o botão na tela...
psql "$BANCO" -c "select count(*) as depois from public.organizations where deleted_at is null;"
```

> **Não chame `public.esteira_desfazer_lote` por `psql -c` sem JWT: sempre falha.** A função abre com `if not app.is_manager() then raise exception ... 42501` (`20260904001800:112-114`) e sem JWT `app.role()` devolve `'leitura'`. Se precisar mesmo do caminho por `psql`, finja o JWT na mesma sessão, num bloco só:

```bash
psql "$BANCO" <<'SQL'
select count(*) as antes from public.organizations where deleted_at is null;
select set_config('request.jwt.claims',
         json_build_object(
           'sub', (select id from public.profiles where role = 'gestor'::app.user_role and is_active order by created_at limit 1),
           'role', 'authenticated',
           'app_metadata', json_build_object('app_role', 'gestor'))::text,
         false);
select public.esteira_desfazer_lote((select id from public.import_batches order by created_at desc limit 1));
select count(*) as depois from public.organizations where deleted_at is null;
SQL
```

`set_config(..., false)` é de sessão, não de transação: por isso as quatro consultas vão no mesmo `psql`, e não em quatro `-c` separados.

**5. Um segundo lote do mesmo lugar com nota diferente produz um candidato e uma ficha**, com `mudou_na_fonte`:

```bash
pnpm db:test   # blocos 7 e 8 do arquivo 66
```

**6. Mais de 50% das linhas do lote têm telefone.** Abaixo disso, a fonte não resolveu o problema que motivou o ADR-12:

```bash
psql "$BANCO" -c "select count(*) filter (where c.phone_e164 is not null) as com_telefone, count(*) as total, round(100.0 * count(*) filter (where c.phone_e164 is not null) / nullif(count(*), 0), 1) as pct from public.supplier_candidates c join public.sources s on s.id = c.source_id where s.slug = 'google_maps_raspado';"
```

**7. Nenhuma tela imprime `rating` ou `reviews_count`:**

```bash
grep -rn "rating\|reviews_count" apps/web/src/components/parceiros   # não pode achar nada
```

(Conferido em 24/09, antes desta fase: já não acha nada.) A outra metade do critério — a lista de Parceiros filtrar por etiqueta, origem, temperatura e qualificação — é o item de carona §7.1 da spec, que **não faz parte destas dez tarefas**. Se ele não entrou neste lote, registre a pendência no CHANGELOG em vez de dar o critério por cumprido.

**8. Suíte inteira verde:**

```bash
pnpm db:test && pnpm lint && pnpm typecheck && pnpm test
```

> Sobre o número do item 8 da §13 ("o arquivo 66 somando 15 asserções"): os 15 são os **casos** de §3.5, não asserções. O arquivo 66 termina a Fase 1 com **43** asserções. Registre isso no CHANGELOG e não apague teste para fazer o número bater — o critério da spec é que precisa de outro número.

- [ ] **10.6 — a entrada do CHANGELOG.** Acrescente ao **fim** de `docs/CHANGELOG.md` (o arquivo é cronológico e cresce por baixo). Troque os números entre `⟨⟩` pelos que os comandos imprimiram:

```markdown
### 24/09/2026 — Fase 1 do pivô: o CSV do Google Maps entra pela porta da planilha (ADR-12)

A fila de revisão tinha **277 candidatos e um telefone**. Não era defeito do coletor: o casamentos.com.br não publica o número, e a varredura de `robots.txt` de 17/09 concluiu que não existe caminho de raspagem legal e barato para telefone. O Rafael decidiu em 24/09 raspar o Google Maps com o `gosom/google-maps-scraper` em Docker local — ciente de que contraria os Termos do Google e de que o R06 §B.1 SCR-04 já havia recusado. A decisão revoga essa recusa por escrito, e o risco está registrado na própria linha da fonte, em `sources.terms_notes`.

Não construímos caminho novo. O CSV entra pela importação de planilha, pela mesma esteira do ADR-08 (`raw_capture → source_record → supplier_candidate → revisão → organizations`), com prévia antes de gravar e desfazer de 48 h. O que se consertou foi o estreitamento: o payload que a tela montava tinha 9 campos e a whitelist do banco permitia 22.

Entregue (migração `20260924130000_o_csv_do_maps_entra_pela_importacao.sql`):
- **`app.endereco_br(text)`**: um endereço do Maps vira `bairro`, `cidade` e `cep`. A regra devolve **nulo onde não casou, nunca palpite** — ficha sem bairro estraga a rota de visita, não a ficha.
- **`app.importacao_normalizar` refeita**: o payload sai de 9 para 15 chaves (`place_id`, `email`, `endereco`, `nota`, `avaliacoes_qtd` e `cep`, todos já dentro da whitelist). A fonte passa a ser resolvida antes da categoria, e a categoria consulta `public.source_category_map` **antes** da queda difusa — senão um palpite de 0,55 de similaridade venceria o mapa escrito à mão.
- **CPF varrido no endereço**, antes do payload: `raw_capture` guarda o payload cru, e o gatilho que limpa CPF só roda depois, em `source_record`. Sem isso, CPF de MEI ficaria guardado com retenção de coleta, fora do alcance da limpeza.
- **`place_id` vira o `external_id`** da linha do Maps: o telefone muda, o `cid` não. A prévia passa a sondar as **quatro** chaves únicas (o comentário dizia quatro e o código testava três), e para de dizer "entra" onde a gravação responde "duplicata".
- **A segunda raspagem grava o que faltava**: o ramo de UPDATE de `esteira_processar_captura` carregava 11 campos a menos que o de INSERT; `cep`, `place_id`, `city_id` e a categoria passam a entrar com `coalesce`. Sem isso, linha parada em revisão por `categoria_desconhecida` ficava presa para sempre.
- **A fonte `google_maps_raspado`**, `kind = 'import'` e não `'scrape'` — com `'scrape'`, a string "Google Maps (raspagem local)" iria literalmente para dentro da variável `{{origem}}` de um primeiro contato de campanha.

Na tela:
- **Cinco campos novos** no mapa de colunas (ID do lugar, e-mail, endereço, nota, nº de avaliações) e o cabeçalho em inglês do kit passa a casar sozinho: `title`, `category`, `phone`, `cid`, `emails`, `address`, `review_rating`, `review_count`. `cid` entra como sinônimo **exato** de `place_id` — pela passada por trecho ele iria para **cidade**.
- **O seletor de origem do lote**: a tela lista as fontes com `config.entrada_por_arquivo` e injeta o nome da escolhida em cada linha que não tiver coluna de origem. Um lote de raspagem rotulado "planilha" era mentira no registro legal das operações de tratamento, e `import_batches.source_id` é onde ela ficaria guardada. O critério é a chave da config, e não `is_enabled`: `is_enabled` governa só a coleta automática, e a fonte nova nasce desligada de propósito.
- **Uma fixture de verdade**, `apps/web/src/components/importacao/fixtures/maps-natal-buffet.csv`: 20 lugares fictícios no formato exato do kit, com um telefone fixo, um sem e-mail, um endereço sem bairro, dois e-mails na mesma célula e um `cid` repetido.

Na infra:
- **Perfil `maps`** em `infra/local/docker-compose.yml`, porta presa em `127.0.0.1:8080`, saída em `data/maps/saida/` (já gitignored), com o passo a passo do operador no compose e no README. O endurecimento é escrito à mão neste serviço, como no `metabase`: Chromium em contêiner pede exceção, e o `x-endurecimento` compartilhado é de outros seis. O CRM **não** chama o raspador: a Vercel e o Fly.io não alcançam `127.0.0.1` em Natal, e com uma pessoa no meio a raspagem fica registrada em `import_batches.triggered_by`.

Limite de conduta, escrito e não codificado: **2 rodadas por semana, 600 lugares por rodada, só Natal e região metropolitana**; sem login, sem burla de CAPTCHA, sem proxy rotativo, 1 requisição a cada 5 s. Esse intervalo é disciplina de quem opera — `-c 1` limita a concorrência a uma aba, não impõe atraso. Bloqueio de IP ou CAPTCHA: para e avisa.

**Dívida assumida, e medida em teste.** Varrendo o CPF dentro de `app.importacao_normalizar`, o gatilho de higiene do `source_record` não o vê mais: a flag `cpf_descartado` e a linha de `public.field_provenance` com `reason = 'cpf'` deixam de existir por este caminho, e o registro do descarte passa a viver só na prévia, que não é armazenada. Duas asserções do arquivo 66 fixam exatamente isso (bloco 14b). O conserto natural é `public.importacao_gravar` chamar `app.registrar_proveniencia` quando a linha trouxer o aviso — função de 230 linhas que esta fase não substituiu.

Pendente: ⟨o filtro por etiqueta/origem/temperatura/qualificação na lista de Parceiros (§7.1 da spec), se não entrou neste lote⟩; a dívida do `field_provenance` do CPF acima; ADR-12 e ADR-13 ainda não estão na tabela do PRD §9.1, que para no ADR-11; e o critério de pronto 8 da §13 fala em "15 asserções" no arquivo 66, quando os 15 são os casos de §3.5 — o arquivo fecha a fase com 43.

Precisa de decisão humana: a redação do `terms_notes` da fonte é a linha que vai ser lida se alguém perguntar por que raspamos — **o Rafael precisa ler e aprovar** (spec §12, decisão 1). E os 277 candidatos parados somem sozinhos em 16/12/2026 pela retenção: ou alguém trabalha os 108 de A+/A antes disso, ou eles somem (§12, decisão 8).

Verificado: pgTAP ⟨N⟩ asserções em 66 arquivos (o 66 com 43), lint, typecheck e ⟨N⟩ testes do web, todos verdes, com o banco reconstruído do zero.
```

- [ ] **10.7 — o commit final.**

```bash
git add docs/CHANGELOG.md packages/schema/src/database.types.ts
git status --short   # nada mais pode estar solto
git commit -m "CHANGELOG: o CSV do Maps entra pela porta da planilha

Fase 1 do pivô de 24/09: fonte google_maps_raspado, payload de 15 chaves,
place_id como external_id, seletor de origem na importação e o perfil maps no
compose. ADR-08, ADR-12; RF-BAS-07, RF-BAS-10, RF-RAD-05, RF-RAD-11.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Se `git status --short` mostrar `apps/web/AGENTS.md` ou `apps/web/CLAUDE.md` modificados, é o `next dev` que os reescreve: commite junto, em vez de reverter — tirá-los do diff só recria a mudança.

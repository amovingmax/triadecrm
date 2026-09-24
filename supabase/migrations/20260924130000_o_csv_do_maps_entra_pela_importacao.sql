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
--   2. `app.importacao_normalizar(jsonb)` recriada: o payload sai de 9 para 15
--      chaves, a categoria consulta o mapa da fonte antes da queda difusa, o
--      `place_id` vira a identidade na fonte e o CPF é varrido do endereço e do
--      bairro ANTES da `raw_capture`.
--   3. `public.importacao_previa(jsonb)` recriada: a prévia passa a sondar o
--      `place_id`, a quarta chave de índice único — a mesma por que
--      `app.promover_candidato` recusa. Sem isso a prévia prometia ficha que a
--      gravação responderia como duplicata.
--   4. `public.esteira_processar_captura(uuid)` recriada: o ramo "mudou na
--      fonte" passa a carregar `cep`, `place_id`, `city_id` e o par
--      `category_source`/`category_id`, todos com `coalesce`. A segunda
--      raspagem completa o que faltava em vez de deixar a linha presa na
--      Revisão por `categoria_desconhecida`.
--   5. A fonte `google_maps_raspado` no catálogo, com o ADR-12 inteiro escrito
--      em `terms_notes` — `kind = 'import'` e desligada de propósito.
--   6. O mapa das 12 categorias do Maps → categoria do CRM, só o que é
--      evidente. Espelhado em `supabase/seed.sql`, que é quem serve o banco
--      novo (aqui `public.categories` ainda não existe num `db reset`).
--   7. `entrada_por_arquivo` em `google_maps_raspado` e `planilha`: é por esta
--      chave que o seletor de origem de `/importar` filtra, e não por
--      `is_enabled`.
--   8. `supplier_candidates_place_idx`, parcial e NÃO único: a busca do
--      candidato por `place_id` deixa de varrer a tabela, sem criar restrição
--      nova — o mesmo lugar pode chegar por duas fontes.
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
-- `stable`, e não `immutable`: `jsonb_build_object` é STABLE no Postgres (a
-- conversão de um valor para json pode depender de configuração da sessão), e
-- `plpgsql_check` acusa a mentira. Nada aqui precisa de `immutable`: a função
-- não entra em índice nem em coluna gerada, e quem a chama
-- (`app.importacao_normalizar`) também é `stable`.
stable
set search_path = ''
as $$
declare
  v_txt    text := coalesce(t, '');
  v_bruto  text;
  v_digito text;
  v_cep    text;
  v_partes text[];
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


-- ---------------------------------------------------------------------------
-- 4. A prévia sonda o place_id (§3.2 item 4)
-- ---------------------------------------------------------------------------
-- (Não há seção 3: a numeração segue os itens do §3.2 da spec, e o item 3 — a
-- identidade na fonte passa a ser o lugar — coube inteiro dentro da seção 2.)
--
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

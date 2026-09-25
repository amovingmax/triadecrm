-- =====================================================================
-- O CRM aprende a falar Google
--
-- POR QUÊ (medido em 25/09/2026, nos dois CSV de listas/): o Google
-- devolveu 16 nomes de categoria; o mapa da fonte tinha 12 chaves e só 3
-- casaram. Categoria que não casa não vira palpite — vira cartão na fila,
-- um por linha. Foram 36 cartões e 3 fichas em 40 linhas.
--
-- Duas causas, e as duas moram aqui:
--   (a) O MAPA É CURTO. Seis nomes evidentes do vocabulário do Maps não
--       estavam nele. "Buffet infantil" é o nome da nossa categoria em
--       outra ordem de palavras, e destravava 6 linhas sozinho.
--   (b) O MAPA CASA STRING CRUA. As duas leituras vivas comparam
--       `lower(trim(...))`, sem unaccent: "Salao de festas" sem til não
--       casaria com a chave 'salão de festas'. Não aconteceu por sorte.
--
-- A troca é nos TRÊS lugares ao mesmo tempo, e é por isso que está numa
-- migração só: trocar um lado quebraria o mapa inteiro, porque as chaves
-- estão gravadas com acento de propósito.
--
-- POR QUE UM CHECK, E NÃO UM ÍNDICE ÚNICO SOBRE A EXPRESSÃO: o desenho
-- pediu `create unique index ... (app.chave_catalogo(category_source))`.
-- `app.chave_catalogo` é declarada IMMUTABLE mas chama
-- `extensions.unaccent(text)`, que é STABLE — e este repositório já decidiu
-- essa questão uma vez: o comentário de `app.search_name`
-- (20260904000100:328-330) diz que é exatamente por isso que aquele valor é
-- materializado em coluna e indexado na coluna, nunca por expressão. Com
-- TODA chave gravada na forma normalizada, a PK (source_id, category_source)
-- já recusa a segunda grafia; o CHECK é o que garante a forma. De quebra, a
-- leitura volta a ser igualdade simples sobre a PK, e não varredura.
--
-- O que NÃO muda: nada vira palpite. Categoria não mapeada continua
-- chegando com category_id nulo e a Revisão continua perguntando.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Antes de normalizar: nenhuma grafia dupla pode estar apontando para
--    categorias diferentes. Se estiver, é decisão humana, e a migração
--    falha aqui em vez de eleger uma no `limit 1`.
-- ---------------------------------------------------------------------
do $$
declare v_conflito text;
begin
  select string_agg(distinct s.slug || ': ' || app.chave_catalogo(m.category_source), ', ')
    into v_conflito
    from public.source_category_map m
    join public.sources s on s.id = m.source_id
   where exists (select 1 from public.source_category_map o
                  where o.source_id = m.source_id
                    and o.category_source <> m.category_source
                    and app.chave_catalogo(o.category_source) = app.chave_catalogo(m.category_source)
                    and o.category_id <> m.category_id);
  if v_conflito is not null then
    raise exception
      'source_category_map: duas grafias da mesma chave apontam para categorias diferentes (%). Decida à mão antes de normalizar.',
      v_conflito;
  end if;
end $$;

-- Grafias duplicadas que apontam para a MESMA categoria: fica uma.
delete from public.source_category_map m
 using public.source_category_map k
 where m.source_id = k.source_id
   and m.category_source <> k.category_source
   and app.chave_catalogo(m.category_source) = app.chave_catalogo(k.category_source)
   and m.ctid > k.ctid;

update public.source_category_map
   set category_source = app.chave_catalogo(category_source)
 where category_source is distinct from app.chave_catalogo(category_source);

-- ---------------------------------------------------------------------
-- 2. A forma da chave vira contrato de escrita.
-- ---------------------------------------------------------------------
alter table public.source_category_map
  drop constraint if exists source_category_map_chave_normalizada;
alter table public.source_category_map
  add constraint source_category_map_chave_normalizada
  check (category_source = app.chave_catalogo(category_source));
comment on constraint source_category_map_chave_normalizada on public.source_category_map is
  'A chave da fonte é gravada só na forma de app.chave_catalogo (sem acento, sem caixa, sem pontuação). Com isso a PK (source_id, category_source) recusa a segunda grafia sozinha — um nome da fonte tem um destino só.';

-- ---------------------------------------------------------------------
-- 3. Seis chaves novas. Contadas nome por nome nos dois CSV de listas/
--    (20 fotógrafos + 20 buffets, 25/09/2026): 14 linhas com categoria
--    passam a 31.
--      buffet infantil       6 linhas · é o nome da nossa categoria, invertido
--      buffet de casamento   4 · casamento é buffet adulto, nunca infantil
--      serviço de catering   3 · catering é buffet que vai até o evento
--      estúdio fotográfico   2 · sinônimo puro de fotógrafo
--      estúdio de fotografia 1 · o Maps usa as duas grafias
--      local para eventos    1 · o mapa já tem 'espaço para eventos'
--    O que NÃO entra, e é escolha: impressões fotográficas (laboratório),
--    loja de artigos para fotografia (loja de câmera), loja de presentes,
--    restaurante self-service, companhia de produção de filmes, serviços
--    para festas infantis e centro de diversões infantil. Cada um cabe em
--    dois ou três destinos: palpite aqui contamina o funil, a meta e o
--    relatório de déficit. Quem resolve esses é a tela de resolver
--    categorias (tarefa 6 do plano de 25/09/2026).
--
--    Os quatro slugs de destino foram conferidos um a um em
--    supabase/seed.sql:71-94 — buffet_infantil_casa_de_festas,
--    buffet_adulto_corporativo, fotografia_video e
--    locais_saloes_chacaras_hoteis existem e estão ativos.
--
--    ORDEM: num `supabase db reset` as migrações rodam ANTES de seed.sql
--    e este insert casa ZERO linhas, calado. Por isso ele está TAMBÉM na
--    seed (bloco 3b). Este aqui atende produção; o de lá, local e CI.
-- ---------------------------------------------------------------------
insert into public.source_category_map (source_id, category_source, category_id)
select s.id, app.chave_catalogo(m.categoria_origem), c.id
  from public.sources s
  join (values
          ('buffet infantil',       'buffet_infantil_casa_de_festas'),
          ('buffet de casamento',   'buffet_adulto_corporativo'),
          ('serviço de catering',   'buffet_adulto_corporativo'),
          ('estúdio fotográfico',   'fotografia_video'),
          ('estúdio de fotografia', 'fotografia_video'),
          ('local para eventos',    'locais_saloes_chacaras_hoteis')
       ) as m(categoria_origem, categoria_crm) on true
  join public.categories c on c.slug = m.categoria_crm
 where s.slug = 'google_maps_raspado'
on conflict (source_id, category_source) do update
  set category_id = excluded.category_id;


-- ---------------------------------------------------------------------
-- 4. Os dois leitores vivos do mapa
-- ---------------------------------------------------------------------
-- Transcrição da definição VIVA de `app.importacao_normalizar`
-- (20260924130000:158-486) e de `public.esteira_processar_captura`
-- (:708-829), como manda a prática do repositório: a função inteira vem
-- junto e só o bloco marcado muda. Ver o comentário em 20260924130000:503-508.
--
-- MUDOU, nas duas: só o lado da LINHA precisa de normalização, porque o
-- CHECK do bloco 2 garante que o lado GRAVADO já está normalizado. Isto é
-- igualdade sobre a PK, e não expressão sobre a coluna.
--
-- MUDOU, só em `app.importacao_normalizar`: duas chaves a mais no retorno,
-- `site` e `categoria_origem`. As duas JÁ existem dentro de `v_payload`
-- (:427 e :430); o que falta é subirem ao topo, que é onde
-- `importacao_previa` e `importacao_gravar` leem — elas nunca abrem o
-- payload. `site` é o que falta para a prévia sondar domínio como a gravação
-- já sonda; `categoria_origem` é o texto CRU que a tela de resolver agrupa.
-- Nenhuma das duas é lida por ninguém ainda: acrescentá-las agora evita
-- transcrever esta função três vezes.
-- ---------------------------------------------------------------------
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

  -- MUDOU (b): o mapa da fonte antes da queda difusa.
  -- MUDOU em 25/09/2026: a comparação passa a ser `app.chave_catalogo` do lado
  -- da LINHA contra a chave já normalizada. O CHECK
  -- `source_category_map_chave_normalizada` garante a forma do lado gravado, e
  -- por isso isto continua sendo igualdade sobre a PK — não expressão sobre a
  -- coluna, que obrigaria a varredura. Antes era `lower(trim(...))`, sem
  -- `unaccent`: "Salao de festas" sem til não casava com 'salão de festas'.
  v_cat := '{}'::jsonb;
  if v_fonte ->> 'id' is not null
     and nullif(trim(coalesce(p ->> 'categoria', '')), '') is not null then
    select jsonb_build_object('id', c.id, 'nome', c.name, 'aproximado', false)
      into v_cat
      from public.source_category_map m
      join public.categories c on c.id = m.category_id
     where m.source_id = (v_fonte ->> 'id')::int
       and m.category_source = app.chave_catalogo(coalesce(p ->> 'categoria', ''))
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
    -- MUDOU em 25/09/2026: `site` e `categoria_origem` também NO TOPO. As duas
    -- já estavam dentro de `v_payload`, onde ninguém as lê. `site` é o que
    -- falta para a prévia sondar domínio como a gravação já sonda (o defeito
    -- das duas Show Fotografias); `categoria_origem` é o texto CRU da
    -- categoria, que é o que a tela de resolver agrupa e o que o cartão da
    -- fila mostra quando o CRM não conhece o nome.
    'site',             v_site,
    'categoria_origem', nullif(trim(coalesce(p ->> 'categoria', '')), ''),
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
  'Uma linha de planilha ou do CSV do Google Maps (RF-BAS-07, ADR-12) vira o objeto canônico da esteira: telefone em E.164, endereço partido por app.endereco_br, categoria pelo mapa da fonte antes da queda difusa, external_id determinístico (place_id > celular > @ > CNPJ > nome+cidade) e payload de 15 campos já dentro da whitelist do R06 SCR-01, com CPF varrido de nome, observação, endereço e bairro ANTES da raw_capture. Desde 25/09/2026 o mapa da fonte casa por app.chave_catalogo (um til não manda mais a linha para a fila) e o retorno carrega site e categoria_origem no topo, que é onde a prévia e a gravação leem. STABLE: a prévia e a gravação usam ESTA função, não duas parecidas.';
revoke all on function app.importacao_normalizar(jsonb) from public, anon;
grant execute on function app.importacao_normalizar(jsonb) to authenticated, service_role;


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
     -- MUDOU em 25/09/2026, pelo mesmo motivo do leitor de cima: a chave
     -- gravada já está na forma de `app.chave_catalogo`, então só o lado da
     -- captura precisa ser normalizado. Continua igualdade sobre a PK.
     and m.category_source = app.chave_catalogo(coalesce(v_p ->> 'categoria_origem', ''))
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

-- =============================================================================
-- TRIADE — A API lê o sistema inteiro: a permissão "sistema:ler" (25/11/2026)
--
-- Pedido do Rafael, para a ISA (a assistente dele, ligada à API da Imova):
--   "Quero que você libere a ISA fazer tudo dentro do sistema da Imova. Ver
--    relatório, ver progresso da IA que atende, ver anúncios, ter integração
--    completa com o sistema. A única coisa que a ISA não terá permissão é de
--    enviar mensagem. De resto, a ISA deverá ter acesso total às informações."
--
-- A API v1 (migração 20261117200000) lia fichas, funil e conversas. O resto do
-- CRM (relatórios, Progresso da IA, anúncios, agenda, Meu dia, mercado, caderno
-- da IA...) não tinha porta. Em vez de uma rota por tela, duas portas que
-- acompanham o sistema sozinhas, só de leitura:
--
--   GET /v1/consultas          as consultas das telas, com área, descrição e parâmetros
--   GET /v1/consultas/{nome}   roda uma delas (parâmetros na URL)
--   GET /v1/tabelas            as tabelas e visões que as telas leem, com as colunas
--   GET /v1/tabelas/{nome}     lê uma delas, com filtro, ordem e página
--
-- Regras:
--   * Consulta = função de `public` que quem entra no CRM pode chamar e que o
--     Postgres garante que não grava (STABLE ou IMMUTABLE). Ficam de fora as da
--     gerência de chaves (`api_*`) e as que preparam envio ou ligação
--     (`wa_preparar_envio*`, `wa_chamada_autorizar`).
--   * Tabela = tabela ou visão de `public` que quem entra no CRM pode ler. As
--     colunas de segredo de link e de aparelho (`token`, `voip_token`,
--     `claim_token_hash`, `chave_crua`) não saem.
--   * As duas exigem a permissão nova "sistema:ler" e chave em nome de um
--     admin (o admin vê tudo nas telas; a chave vê o mesmo).
--   * Nenhuma das duas grava. Mandar mensagem continua só com "mensagens:enviar".
--
-- Só a chave da ISA na Imova recebe a permissão, fora desta migração (25/11/2026).
-- =============================================================================


-- =============================================================================
-- A. A PERMISSÃO NOVA
-- =============================================================================

alter table app.api_chaves drop constraint api_chaves_escopos_check;
alter table app.api_chaves add constraint api_chaves_escopos_check check (
  cardinality(escopos) > 0
  and escopos <@ array['fichas:ler', 'fichas:escrever', 'funil:ler', 'funil:escrever',
                       'conversas:ler', 'mensagens:enviar', 'webhooks', 'sistema:ler']::text[]);

create or replace function app.api_escopos()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'fichas:ler', 'nome', 'Ler fichas',
                       'descricao', 'Consultar fichas, contatos e telefones.'),
    jsonb_build_object('id', 'fichas:escrever', 'nome', 'Criar leads e mexer em fichas',
                       'descricao', 'Criar lead, atualizar dados da ficha e escrever nota.'),
    jsonb_build_object('id', 'funil:ler', 'nome', 'Ler o funil',
                       'descricao', 'Consultar funis, etapas e negócios.'),
    jsonb_build_object('id', 'funil:escrever', 'nome', 'Mover no funil',
                       'descricao', 'Mudar a etapa de um negócio, com as mesmas regras do quadro.'),
    jsonb_build_object('id', 'conversas:ler', 'nome', 'Ler conversas',
                       'descricao', 'Consultar conversas e mensagens do WhatsApp.'),
    jsonb_build_object('id', 'mensagens:enviar', 'nome', 'Mandar WhatsApp',
                       'descricao', 'Mandar texto na janela de 24 h e modelo aprovado, com as travas do CRM.'),
    jsonb_build_object('id', 'webhooks', 'nome', 'Avisos para fora',
                       'descricao', 'Criar e apagar webhooks pela própria API.'),
    jsonb_build_object('id', 'sistema:ler', 'nome', 'Ler o sistema inteiro',
                       'descricao', 'Consultar tudo o que o admin vê nas telas: relatórios, Progresso da IA, anúncios, agenda, mercado e as tabelas. Só leitura; só vale em chave em nome de um admin.'))
$$;

create or replace function app.api_rotas()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'GET /v1',                           null,
    'GET /v1/fichas',                    'fichas:ler',
    'GET /v1/fichas/{id}',               'fichas:ler',
    'PATCH /v1/fichas/{id}',             'fichas:escrever',
    'POST /v1/fichas/{id}/notas',        'fichas:escrever',
    'POST /v1/fichas/{id}/modelo',       'mensagens:enviar',
    'POST /v1/leads',                    'fichas:escrever',
    'GET /v1/funis',                     'funil:ler',
    'GET /v1/negocios',                  'funil:ler',
    'GET /v1/negocios/{id}',             'funil:ler',
    'POST /v1/negocios/{id}/mover',      'funil:escrever',
    'GET /v1/conversas',                 'conversas:ler',
    'GET /v1/conversas/{id}',            'conversas:ler',
    'GET /v1/conversas/{id}/mensagens',  'conversas:ler',
    'POST /v1/conversas/{id}/mensagens', 'mensagens:enviar',
    'POST /v1/conversas/{id}/modelo',    'mensagens:enviar',
    'GET /v1/modelos',                   'mensagens:enviar',
    'GET /v1/webhooks',                  'webhooks',
    'POST /v1/webhooks',                 'webhooks',
    'DELETE /v1/webhooks/{id}',          'webhooks',
    'POST /v1/webhooks/{id}/teste',      'webhooks',
    'GET /v1/consultas',                 'sistema:ler',
    'GET /v1/consultas/{nome}',          'sistema:ler',
    'GET /v1/tabelas',                   'sistema:ler',
    'GET /v1/tabelas/{nome}',            'sistema:ler')
$$;


-- =============================================================================
-- B. O QUE AS DUAS PORTAS ALCANÇAM
-- =============================================================================

-- A área de cada consulta ou tabela, pelo nome, para o catálogo se organizar
-- como o menu do CRM.
create or replace function app.api_area(p_nome text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_nome ~ '^(relatorio|weekly_reports|goal)' then 'Relatórios e metas'
    when p_nome ~ '^(ia_|ai_|feedback_da_ia)' then 'IA que atende'
    when p_nome ~ '^(anuncio|canal_pro|interesse_no_imovel|portal_lead)' then 'Anúncios e portais'
    when p_nome ~ '^mercado_' then 'Inteligência de mercado'
    when p_nome ~ '^(agenda|calendly|visita|reuni|lembrete|compromissos|rota|route_|esperas)' then 'Agenda e visitas'
    when p_nome ~ '^(meu_dia|resumo_do_dia|pulso_do_dia|tasks|proximas_acoes|activities|avisos)' then 'Meu dia e tarefas'
    when p_nome ~ '^(conversa|messages|mensage|message_|wa_|channel_windows|canal_|respostas_rapidas|chegada|atitude|objec|consultoria)' then 'Conversas e WhatsApp'
    when p_nome ~ '^(deal|pipeline|stage|lost_reasons|cadenc|negocios)' then 'Funil'
    when p_nome ~ '^(envio|disparo|publicos_salvos|ofertas_por_email)' then 'Disparos'
    when p_nome ~ '^(organization|contact|ficha|search_organizations|parceiro|origem_dos_dados|tags|categories|cities|geo_places|field_provenance|sugestoes_de_campo|pre_)' then 'Fichas e contatos'
    when p_nome ~ '^(radar|raw_capture|source|supplier|ingest|import|sistema_atual)' then 'Radar e importação'
    when p_nome ~ '^(voz|voice_|call_|ligac|lote|v_call|v_contact)' then 'Ligações'
    else 'Equipe, ajustes e registros'
  end
$$;

-- Os parâmetros de entrada de uma função, na ordem: nome, tipo e se é obrigatório.
create or replace function app.api_parametros(p_fn oid)
returns table (k integer, nome text, tipo oid, obrigatorio boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  f      record;
  v_modo "char";
  v_i    integer;
begin
  select p.proargnames, p.proargmodes, p.proargtypes, p.pronargs, p.pronargdefaults,
         coalesce(array_length(p.proallargtypes, 1), p.pronargs) as total
    into f
    from pg_catalog.pg_proc p where p.oid = p_fn;
  if not found then
    return;
  end if;
  k := 0;
  for v_i in 1 .. f.total loop
    v_modo := case when f.proargmodes is null then 'i' else f.proargmodes[v_i] end;
    if v_modo in ('i', 'b', 'v') then
      k := k + 1;
      nome := f.proargnames[v_i];
      tipo := (f.proargtypes)[k - 1];
      obrigatorio := k <= f.pronargs - f.pronargdefaults;
      return next;
    end if;
  end loop;
end $$;

-- As consultas que a API roda: o que a tela pode chamar e não grava.
create or replace function app.api_consultas_permitidas()
returns table (fn oid, nome text, area text, descricao text, parametros jsonb,
               devolve text, lista boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.oid, p.proname::text, app.api_area(p.proname::text),
         pg_catalog.obj_description(p.oid, 'pg_proc'),
         coalesce((select jsonb_agg(jsonb_build_object(
                             'nome', a.nome,
                             'tipo', pg_catalog.format_type(a.tipo, null),
                             'obrigatorio', a.obrigatorio) order by a.k)
                     from app.api_parametros(p.oid) a), '[]'::jsonb),
         pg_catalog.format_type(p.prorettype, null), p.proretset
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_type rt on rt.oid = p.prorettype
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.provolatile in ('s', 'i')
     and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and p.proname !~ '^(api_|wa_preparar_envio|wa_chamada_autorizar)'
     -- devolve algo que vira JSON (nem void, nem record sem colunas, nem gatilho)
     and (rt.typtype <> 'p' or (rt.oid = 'pg_catalog.record'::pg_catalog.regtype and p.proallargtypes is not null))
     -- todo parâmetro tem nome e um tipo que se escreve na URL
     and not exists (select 1
                       from app.api_parametros(p.oid) a
                       join pg_catalog.pg_type t on t.oid = a.tipo
                      where coalesce(a.nome, '') = '' or t.typtype in ('c', 'p'))
$$;

-- Colunas que não saem pela API: segredo de link e de aparelho.
create or replace function app.api_coluna_escondida(p_coluna text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_coluna in ('token', 'voip_token', 'claim_token_hash', 'chave_crua')
$$;

-- As tabelas e visões que a API lê: o que a tela pode ler.
create or replace function app.api_tabelas_permitidas()
returns table (rel oid, nome text, tipo text, area text, descricao text, linhas_aprox bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.oid, c.relname::text,
         case when c.relkind in ('v', 'm') then 'visão' else 'tabela' end,
         app.api_area(c.relname::text),
         pg_catalog.obj_description(c.oid, 'pg_class'),
         case when c.relkind in ('r', 'p') and c.reltuples >= 0 then c.reltuples::bigint end
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'v', 'm', 'p')
     and not c.relispartition
     and pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
$$;

-- As colunas de uma tabela, na ordem, sem as escondidas.
create or replace function app.api_colunas(p_rel oid)
returns table (nome text, tipo text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.attname::text, pg_catalog.format_type(a.atttypid, a.atttypmod)
    from pg_catalog.pg_attribute a
   where a.attrelid = p_rel and a.attnum > 0 and not a.attisdropped
     and not app.api_coluna_escondida(a.attname::text)
   order by a.attnum
$$;


-- =============================================================================
-- C. AS ROTAS
-- =============================================================================

-- GET /v1/consultas  (?busca=texto filtra por nome, área ou descrição)
create or replace function app.api_v1_consultas(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_busca text := nullif(btrim(coalesce(p ->> 'busca', '')), '');
  v_lista jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome', c.nome, 'area', c.area, 'descricao', c.descricao,
           'parametros', c.parametros,
           'devolve', case when c.lista then 'lista' else 'valor' end,
           'tipo', c.devolve) order by c.area, c.nome), '[]'::jsonb)
    into v_lista
    from app.api_consultas_permitidas() c
   where v_busca is null
      or c.nome ilike '%' || v_busca || '%'
      or c.area ilike '%' || v_busca || '%'
      or coalesce(c.descricao, '') ilike '%' || v_busca || '%';
  return app.api_ok(200, v_lista, jsonb_build_object('registros', jsonb_array_length(v_lista)));
end $$;

-- GET /v1/consultas/{nome}?parametro=valor
-- O parâmetro vai com o nome da função (p_de) ou sem o "p_" (de). Lista volta
-- inteira até `limite` (padrão 1000, até 5000).
create or replace function app.api_v1_consulta(p_nome text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c        record;
  a        record;
  v_args   text[] := '{}'::text[];
  v_usados text[] := '{}'::text[];
  v_val    text;
  v_chave  text;
  v_tipo   text;
  v_cat    "char";
  v_lim    integer;
  v_sql    text;
  v_res    jsonb;
  v_aceita text;
begin
  select * into c from app.api_consultas_permitidas() x where x.nome = lower(p_nome) limit 1;
  if not found then
    perform app.api_falhar(404, 'consulta_inexistente',
      'Não existe consulta com este nome que a API rode. A lista está em GET /v1/consultas.');
  end if;
  v_aceita := coalesce((select string_agg(x ->> 'nome', ', ') from jsonb_array_elements(c.parametros) x), 'nenhum');

  for a in select * from app.api_parametros(c.fn) order by k loop
    v_chave := case
      when p ? a.nome then a.nome
      when a.nome like 'p\_%' and p ? substr(a.nome, 3) then substr(a.nome, 3)
    end;
    if v_chave is null then
      if a.obrigatorio then
        perform app.api_falhar(400, 'parametro_faltando',
          format('A consulta %s pede o parâmetro %s (%s). Parâmetros: %s.',
                 c.nome, a.nome, pg_catalog.format_type(a.tipo, null), v_aceita));
      end if;
      continue;
    end if;
    v_usados := v_usados || v_chave;
    v_val := p ->> v_chave;
    select t.typcategory into v_cat from pg_catalog.pg_type t where t.oid = a.tipo;
    v_tipo := pg_catalog.format_type(a.tipo, null);
    if v_cat = 'B' then
      v_val := case lower(btrim(v_val)) when 'sim' then 'true' when 'nao' then 'false'
                                        when 'não' then 'false' else v_val end;
    elsif v_cat = 'A' and left(btrim(v_val), 1) <> '{' then
      v_val := '{' || v_val || '}';
    end if;
    if lower(btrim(v_val)) in ('nulo', 'null') then
      v_args := v_args || format('%I => null::%s', a.nome, v_tipo);
    else
      v_args := v_args || format('%I => %L::%s', a.nome, v_val, v_tipo);
    end if;
  end loop;

  select string_agg(x, ', ') into v_chave
    from jsonb_object_keys(p) x
   where x <> 'limite' and not x = any (v_usados);
  if v_chave is not null then
    perform app.api_falhar(400, 'parametro_desconhecido',
      format('A consulta %s não tem o parâmetro %s. Parâmetros: %s.', c.nome, v_chave, v_aceita));
  end if;

  if c.lista then
    v_lim := app.api_limite(p, 1000, 5000);
    v_sql := format('select coalesce(jsonb_agg(to_jsonb(s.t)), ''[]''::jsonb) from (select t from public.%I(%s) t limit %s) s',
                    c.nome, array_to_string(v_args, ', '), v_lim);
  else
    v_sql := format('select to_jsonb(t) from public.%I(%s) t', c.nome, array_to_string(v_args, ', '));
  end if;

  begin
    execute v_sql into v_res;
  exception
    when data_exception then
      perform app.api_falhar(400, 'parametro_invalido',
        format('Um parâmetro de %s não está no formato esperado: %s. Parâmetros: %s.', c.nome, sqlerrm, v_aceita));
  end;

  return app.api_ok(200, v_res,
    jsonb_build_object('consulta', c.nome,
                       'registros', case when jsonb_typeof(v_res) = 'array' then jsonb_array_length(v_res) end)
    || case when c.lista and jsonb_array_length(v_res) >= v_lim
            then jsonb_build_object('cortado_no_limite', v_lim) else '{}'::jsonb end);
end $$;

-- GET /v1/tabelas  (?busca=texto filtra por nome, área ou descrição)
-- As colunas vêm com a busca ou com ?colunas=sim: o catálogo inteiro com elas
-- passa de 150 KB, pesado para uma IA ler de uma vez.
create or replace function app.api_v1_tabelas(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_busca text := nullif(btrim(coalesce(p ->> 'busca', '')), '');
  v_cols  boolean := v_busca is not null or lower(btrim(coalesce(p ->> 'colunas', ''))) in ('sim', 'true', '1');
  v_lista jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome', t.nome, 'tipo', t.tipo, 'area', t.area, 'descricao', t.descricao,
           'linhas_aprox', t.linhas_aprox)
         || case when v_cols then jsonb_build_object('colunas',
              (select coalesce(jsonb_agg(jsonb_build_object('nome', c.nome, 'tipo', c.tipo)), '[]'::jsonb)
                 from app.api_colunas(t.rel) c)) else '{}'::jsonb end
         order by t.area, t.nome), '[]'::jsonb)
    into v_lista
    from app.api_tabelas_permitidas() t
   where v_busca is null
      or t.nome ilike '%' || v_busca || '%'
      or t.area ilike '%' || v_busca || '%'
      or coalesce(t.descricao, '') ilike '%' || v_busca || '%';
  return app.api_ok(200, v_lista, jsonb_build_object('registros', jsonb_array_length(v_lista)));
end $$;

-- GET /v1/tabelas/{nome}
--   coluna=valor        igual (valor "nulo" = vazio)
--   coluna.diferente=   diferente
--   coluna.de= / .ate=  de / até (data sozinha em coluna de data e hora vale o dia inteiro)
--   coluna.contem=      contém o texto (sem diferença de maiúscula)
--   coluna.em=a,b,c     um destes
--   coluna.nulo=sim|nao vazio ou preenchido
--   colunas=a,b  ordem=coluna,-outra  limite=1..1000 (100)  pagina=1..
create or replace function app.api_v1_tabela(p_nome text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t        record;
  v_cols   text[];
  v_tipos  text[];
  v_sel    text[] := '{}'::text[];
  v_onde   text[] := '{}'::text[];
  v_ordem  text[] := '{}'::text[];
  v_k      text;
  v_v      text;
  v_col    text;
  v_op     text;
  v_tipo   text;
  v_i      integer;
  v_item   text;
  v_lim    integer;
  v_pag    integer := 1;
  v_where  text;
  v_res    jsonb;
  v_total  bigint;
  v_lista  text;
begin
  select * into t from app.api_tabelas_permitidas() x where x.nome = lower(p_nome);
  if not found then
    perform app.api_falhar(404, 'tabela_inexistente',
      'Não existe tabela ou visão com este nome que a API leia. A lista está em GET /v1/tabelas.');
  end if;
  select array_agg(c.nome), array_agg(c.tipo) into v_cols, v_tipos from app.api_colunas(t.rel) c;
  v_lista := array_to_string(v_cols, ', ');

  -- colunas
  if nullif(btrim(coalesce(p ->> 'colunas', '')), '') is not null then
    foreach v_item in array string_to_array(p ->> 'colunas', ',') loop
      v_item := lower(btrim(v_item));
      continue when v_item = '';
      if not v_item = any (v_cols) then
        perform app.api_falhar(400, 'coluna_inexistente',
          format('A tabela %s não tem a coluna %s. Colunas: %s.', t.nome, v_item, v_lista));
      end if;
      v_sel := v_sel || format('%I', v_item);
    end loop;
  end if;
  if cardinality(v_sel) = 0 then
    select array_agg(format('%I', x)) into v_sel from unnest(v_cols) x;
  end if;

  -- filtros
  for v_k, v_v in select key, value from jsonb_each_text(p) loop
    continue when v_k in ('colunas', 'ordem', 'limite', 'pagina');
    v_col := lower(split_part(v_k, '.', 1));
    v_op := nullif(lower(split_part(v_k, '.', 2)), '');
    v_i := array_position(v_cols, v_col);
    if v_i is null then
      perform app.api_falhar(400, 'coluna_inexistente',
        format('A tabela %s não tem a coluna %s. Colunas: %s.', t.nome, v_col, v_lista));
    end if;
    v_tipo := v_tipos[v_i];
    v_onde := v_onde || case coalesce(v_op, 'igual')
      when 'igual' then
        case when lower(btrim(v_v)) in ('nulo', 'null') then format('%I is null', v_col)
             else format('%I = %L::%s', v_col, v_v, v_tipo) end
      when 'diferente' then format('%I is distinct from %L::%s', v_col, v_v, v_tipo)
      when 'de' then format('%I >= %L::%s', v_col, v_v, v_tipo)
      when 'ate' then
        case when v_tipo like 'timestamp%' and btrim(v_v) ~ '^\d{4}-\d{2}-\d{2}$'
             then format('%I < (%L::date + 1)', v_col, btrim(v_v))
             else format('%I <= %L::%s', v_col, v_v, v_tipo) end
      when 'contem' then
        format('%I::text ilike %L', v_col,
               '%' || replace(replace(replace(v_v, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      when 'em' then format('%I = any (%L::%s[])', v_col, '{' || v_v || '}', v_tipo)
      when 'nulo' then
        case when lower(btrim(v_v)) in ('sim', 'true', '1') then format('%I is null', v_col)
             else format('%I is not null', v_col) end
    end;
    if v_onde[cardinality(v_onde)] is null then
      perform app.api_falhar(400, 'filtro_invalido',
        format('O filtro "%s" não existe. Use coluna=valor, ou coluna.diferente, .de, .ate, .contem, .em ou .nulo.', v_k));
    end if;
  end loop;
  v_where := case when cardinality(v_onde) > 0 then 'where ' || array_to_string(v_onde, ' and ') else '' end;

  -- ordem
  if nullif(btrim(coalesce(p ->> 'ordem', '')), '') is not null then
    foreach v_item in array string_to_array(p ->> 'ordem', ',') loop
      v_item := lower(btrim(v_item));
      continue when v_item in ('', '-');
      v_col := ltrim(v_item, '-');
      if not v_col = any (v_cols) then
        perform app.api_falhar(400, 'coluna_inexistente',
          format('A tabela %s não tem a coluna %s para ordenar. Colunas: %s.', t.nome, v_col, v_lista));
      end if;
      v_ordem := v_ordem || format('%I %s', v_col,
                                   case when left(v_item, 1) = '-' then 'desc nulls last' else 'asc' end);
    end loop;
  else
    select format('%I desc nulls last', x) into v_col
      from unnest(array['atualizado_em', 'atualizada_em', 'updated_at', 'criado_em', 'criada_em',
                        'created_at', 'changed_at', 'occurred_at']) with ordinality as o(x, n)
     where x = any (v_cols) order by n limit 1;
    if v_col is not null then
      v_ordem := array[v_col];
    end if;
  end if;

  -- página
  v_lim := app.api_limite(p, 100, 1000);
  if nullif(btrim(coalesce(p ->> 'pagina', '')), '') is not null then
    if btrim(p ->> 'pagina') !~ '^[0-9]{1,6}$' or (p ->> 'pagina')::integer < 1 then
      perform app.api_falhar(400, 'parametro_invalido', 'O parâmetro pagina precisa ser um número a partir de 1.');
    end if;
    v_pag := (p ->> 'pagina')::integer;
  end if;

  begin
    execute format('select count(*) from public.%I %s', t.nome, v_where) into v_total;
    execute format('select coalesce(jsonb_agg(to_jsonb(s)), ''[]''::jsonb) from (select %s from public.%I %s %s limit %s offset %s) s',
                   array_to_string(v_sel, ', '), t.nome, v_where,
                   case when cardinality(v_ordem) > 0 then 'order by ' || array_to_string(v_ordem, ', ') else '' end,
                   v_lim, (v_pag - 1) * v_lim)
      into v_res;
  exception
    when data_exception or undefined_function then
      perform app.api_falhar(400, 'filtro_invalido',
        format('Um valor de filtro não serve para a coluna: %s. Colunas: %s.', sqlerrm, v_lista));
  end;

  return app.api_ok(200, v_res, jsonb_build_object(
    'tabela', t.nome, 'total', v_total, 'pagina', v_pag, 'limite', v_lim,
    'proxima_pagina', case when v_pag::bigint * v_lim < v_total then v_pag + 1 end,
    'registros', jsonb_array_length(v_res)));
end $$;


-- =============================================================================
-- D. A PORTA E A CRIAÇÃO DA CHAVE, COM A PERMISSÃO NOVA
-- =============================================================================

create or replace function app.api_chave_nova(p_nome text, p_escopos text[], p_em_nome_de uuid,
                                              p_criada_por uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome    text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_escopos text[];
  v_chave   text;
  v_id      uuid;
  v_papel   text;
  -- O começo da chave diz de que empresa ela é; antes da identidade (banco novo), "crm".
  v_empresa text := coalesce(public.empresa_do_banco(), 'crm');
begin
  if char_length(v_nome) < 2 or char_length(v_nome) > 80 then
    return jsonb_build_object('ok', false, 'motivo', 'nome_invalido');
  end if;
  select array_agg(distinct e order by e) into v_escopos from unnest(coalesce(p_escopos, '{}'::text[])) e;
  if v_escopos is null
     or not v_escopos <@ array['fichas:ler', 'fichas:escrever', 'funil:ler', 'funil:escrever',
                               'conversas:ler', 'mensagens:enviar', 'webhooks', 'sistema:ler']::text[] then
    return jsonb_build_object('ok', false, 'motivo', 'escopos_invalidos');
  end if;
  select p.role::text into v_papel from public.profiles p where p.id = p_em_nome_de and p.is_active;
  if v_papel is null or v_papel not in ('admin', 'gestor') then
    return jsonb_build_object('ok', false, 'motivo', 'em_nome_de_invalido');
  end if;

  v_chave := 'trd_' || v_empresa || '_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into app.api_chaves (nome, prefixo, resumo, escopos, em_nome_de, criada_por)
  values (v_nome, left(v_chave, char_length(v_empresa) + 11),
          encode(extensions.digest(v_chave, 'sha256'), 'hex'), v_escopos, p_em_nome_de, p_criada_por)
  returning id into v_id;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (p_criada_por, app.role()::text, 'INSERT', 'api_chaves', v_id::text,
          jsonb_build_object('nome', v_nome, 'escopos', v_escopos, 'em_nome_de', p_em_nome_de));

  return jsonb_build_object('ok', true, 'id', v_id, 'chave', v_chave,
                            'prefixo', left(v_chave, char_length(v_empresa) + 11));
end $$;

create or replace function public.api_atender(p_resumo text, p_metodo text, p_caminho text,
                                              p_consulta jsonb default '{}'::jsonb,
                                              p_corpo jsonb default null,
                                              p_idempotencia text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k        app.api_chaves%rowtype;
  v_metodo text := upper(btrim(coalesce(p_metodo, '')));
  v_seg    text[];
  v_s      text;
  v_ids    uuid[] := '{}'::uuid[];
  v_partes text[] := '{}'::text[];
  v_rota   text;
  v_rotas  jsonb := app.api_rotas();
  v_escopo text;
  v_papel  text;
  v_uso    integer;
  v_idem   app.api_idempotencia%rowtype;
  v_idem_c text := nullif(btrim(coalesce(p_idempotencia, '')), '');
  v_cons   jsonb := case when jsonb_typeof(p_consulta) = 'object' then p_consulta else '{}'::jsonb end;
  v_resp   jsonb;
  v_estado text;
  v_texto  text;
  v_det    text;
  v_dica   text;
  v_codigo text;
  v_nome   text;
  v_rota_log text;
begin
  -- ---- 1. A chave ----
  if p_resumo is null or p_resumo !~ '^[0-9a-f]{64}$' then
    return app.api_erro(401, 'chave_ausente',
      'Mande a chave da API no cabeçalho Authorization: Bearer <chave>. A chave é criada em Ajustes → Integrações.');
  end if;
  select * into k from app.api_chaves where resumo = p_resumo;
  if not found then
    return app.api_erro(401, 'chave_invalida',
      'Esta chave não existe neste CRM. Confira se ela é desta empresa (o começo diz: trd_imova_ ou trd_komune_).');
  end if;

  -- ---- 2. A rota ----
  v_seg := array_remove(string_to_array(btrim(coalesce(p_caminho, ''), '/'), '/'), '');
  foreach v_s in array coalesce(v_seg, '{}'::text[]) loop
    if v_s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_ids := v_ids || v_s::uuid;
      v_partes := v_partes || '{id}'::text;
    else
      v_partes := v_partes || lower(v_s);
    end if;
  end loop;
  -- /v1/consultas/{nome} e /v1/tabelas/{nome}: o nome é parâmetro (20261125185000).
  if coalesce(array_length(v_partes, 1), 0) = 3 and v_partes[1] = 'v1'
     and v_partes[2] in ('consultas', 'tabelas') and v_partes[3] <> '{id}' then
    v_nome := v_partes[3];
    v_partes[3] := '{nome}';
  end if;
  v_rota := v_metodo || ' /' || array_to_string(v_partes, '/');
  v_rota_log := replace(v_rota, '{nome}', coalesce(v_nome, ''));

  if k.revogada_em is not null then
    insert into app.api_chamadas (chave_id, metodo, rota, status, codigo)
    values (k.id, v_metodo, left(v_rota_log, 200), 401, 'chave_revogada');
    return app.api_erro(401, 'chave_revogada',
      'Esta chave foi revogada em Ajustes → Integrações. Peça uma chave nova a quem administra o CRM.');
  end if;

  select p.role::text into v_papel from public.profiles p where p.id = k.em_nome_de and p.is_active;
  if v_papel is null or v_papel not in ('admin', 'gestor') then
    insert into app.api_chamadas (chave_id, metodo, rota, status, codigo)
    values (k.id, v_metodo, left(v_rota_log, 200), 403, 'dono_sem_acesso');
    return app.api_erro(403, 'dono_sem_acesso',
      'A pessoa em nome de quem esta chave age não é mais admin ou gestor ativo no CRM. Crie uma chave nova em Ajustes → Integrações.');
  end if;

  if not v_rotas ? v_rota then
    v_resp := case
      when exists (select 1 from jsonb_object_keys(v_rotas) r
                    where split_part(r, ' ', 2) = '/' || array_to_string(v_partes, '/'))
        then app.api_erro(405, 'metodo_nao_permitido',
               format('A rota /%s não aceita %s.', array_to_string(v_partes, '/'), v_metodo))
      else app.api_erro(404, 'rota_inexistente',
             'Esta rota não existe. As rotas estão na documentação da API (docs/operacao/api-externa.md).')
    end;
    insert into app.api_chamadas (chave_id, metodo, rota, status, codigo)
    values (k.id, v_metodo, left(v_rota_log, 200), (v_resp ->> 'status')::integer, v_resp #>> '{erro,codigo}');
    return v_resp;
  end if;

  -- ---- 3. A permissão ----
  v_escopo := v_rotas ->> v_rota;
  if v_escopo is not null and not (v_escopo = any (k.escopos)) then
    insert into app.api_chamadas (chave_id, metodo, rota, status, codigo)
    values (k.id, v_metodo, left(v_rota_log, 200), 403, 'sem_escopo');
    return app.api_erro(403, 'sem_escopo',
      format('Esta chave não tem a permissão "%s", que esta rota pede. Crie uma chave com ela em Ajustes → Integrações.', v_escopo),
      jsonb_build_object('escopo', v_escopo));
  end if;

  -- Ler o sistema inteiro é só de chave em nome de admin (20261125185000).
  if v_escopo = 'sistema:ler' and v_papel <> 'admin' then
    insert into app.api_chamadas (chave_id, metodo, rota, status, codigo)
    values (k.id, v_metodo, left(v_rota_log, 200), 403, 'sistema_so_admin');
    return app.api_erro(403, 'sistema_so_admin',
      'Ler o sistema inteiro (sistema:ler) vale só para chave em nome de um admin. Crie a chave em nome de um admin em Ajustes → Integrações.');
  end if;

  -- ---- 4. O limite por minuto ----
  insert into app.api_uso as u (chave_id, minuto, chamadas)
  values (k.id, date_trunc('minute', now()), 1)
  on conflict (chave_id, minuto) do update set chamadas = u.chamadas + 1
  returning u.chamadas into v_uso;
  if v_uso > k.limite_por_minuto then
    return app.api_erro(429, 'limite_por_minuto',
      format('Esta chave passou de %s chamadas neste minuto. Espere e tente de novo.', k.limite_por_minuto),
      jsonb_build_object('espera_s', 60 - floor(extract(second from now()))::integer));
  end if;

  -- ---- 5. A idempotência (POST) ----
  if v_idem_c is not null and v_metodo = 'POST' then
    if char_length(v_idem_c) > 200 then
      return app.api_erro(400, 'idempotencia_invalida', 'Idempotency-Key tem de ter até 200 caracteres.');
    end if;
    select * into v_idem from app.api_idempotencia i
     where i.chave_id = k.id and i.chave = v_idem_c and i.criada_em > now() - interval '24 hours';
    if found then
      if v_idem.rota is distinct from v_metodo || ' /' || array_to_string(v_seg, '/') then
        return app.api_erro(422, 'idempotencia_reusada',
          'Esta Idempotency-Key já foi usada em outro pedido nas últimas 24 h. Use uma chave nova para cada pedido.');
      end if;
      insert into app.api_chamadas (chave_id, metodo, rota, status, codigo)
      values (k.id, v_metodo, left(v_rota_log, 200), (v_idem.resposta ->> 'status')::integer, 'repetido');
      return v_idem.resposta || jsonb_build_object('repetido_pela_idempotencia', true);
    end if;
  end if;

  if v_metodo in ('POST', 'PATCH') and p_corpo is not null and jsonb_typeof(p_corpo) <> 'object' then
    return app.api_erro(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  end if;

  -- ---- 6. O trabalho, em nome da pessoa ----
  begin
    perform app.api_agir_como(k.em_nome_de, v_papel);
    v_resp := case v_rota
      when 'GET /v1'                           then app.api_v1_inicio(k)
      when 'GET /v1/fichas'                    then app.api_v1_fichas(v_cons)
      when 'GET /v1/fichas/{id}'               then app.api_v1_ficha(v_ids[1])
      when 'PATCH /v1/fichas/{id}'             then app.api_v1_ficha_mudar(v_ids[1], p_corpo)
      when 'POST /v1/fichas/{id}/notas'        then app.api_v1_nota(k, v_ids[1], p_corpo)
      when 'POST /v1/fichas/{id}/modelo'       then app.api_v1_modelo(v_ids[1], null, p_corpo)
      when 'POST /v1/leads'                    then app.api_v1_lead(k, coalesce(p_corpo, '{}'::jsonb))
      when 'GET /v1/funis'                     then app.api_v1_funis()
      when 'GET /v1/negocios'                  then app.api_v1_negocios(v_cons)
      when 'GET /v1/negocios/{id}'             then app.api_v1_negocio(v_ids[1])
      when 'POST /v1/negocios/{id}/mover'      then app.api_v1_mover(v_ids[1], coalesce(p_corpo, '{}'::jsonb))
      when 'GET /v1/conversas'                 then app.api_v1_conversas(v_cons)
      when 'GET /v1/conversas/{id}'            then app.api_v1_conversa(v_ids[1])
      when 'GET /v1/conversas/{id}/mensagens'  then app.api_v1_mensagens(v_ids[1], v_cons)
      when 'POST /v1/conversas/{id}/mensagens' then app.api_v1_responder(k, v_ids[1], coalesce(p_corpo, '{}'::jsonb))
      when 'POST /v1/conversas/{id}/modelo'    then app.api_v1_modelo(null, v_ids[1], coalesce(p_corpo, '{}'::jsonb))
      when 'GET /v1/modelos'                   then app.api_v1_modelos()
      when 'GET /v1/webhooks'                  then app.api_v1_webhooks(k, 'GET', null, false, null)
      when 'POST /v1/webhooks'                 then app.api_v1_webhooks(k, 'POST', null, false, coalesce(p_corpo, '{}'::jsonb))
      when 'DELETE /v1/webhooks/{id}'          then app.api_v1_webhooks(k, 'DELETE', v_ids[1], false, null)
      when 'POST /v1/webhooks/{id}/teste'      then app.api_v1_webhooks(k, 'POST', v_ids[1], true, null)
      when 'GET /v1/consultas'                 then app.api_v1_consultas(v_cons)
      when 'GET /v1/consultas/{nome}'          then app.api_v1_consulta(v_nome, v_cons)
      when 'GET /v1/tabelas'                   then app.api_v1_tabelas(v_cons)
      when 'GET /v1/tabelas/{nome}'            then app.api_v1_tabela(v_nome, v_cons)
    end;
  exception when others then
    get stacked diagnostics v_estado = returned_sqlstate, v_texto = message_text,
                            v_det = pg_exception_detail, v_dica = pg_exception_hint;
    v_resp := app.api_resposta_da_excecao(v_estado, v_texto, v_det, v_dica);
    if (v_resp ->> 'status')::integer >= 500 then
      v_codigo := 'erro_interno:' || v_estado;
      raise warning 'api: % % falhou (%: %)', v_metodo, v_rota, v_estado, left(v_texto, 300);
    end if;
  end;

  -- ---- 7. Guardar, anotar ----
  if v_idem_c is not null and v_metodo = 'POST' and (v_resp ->> 'status')::integer between 200 and 299 then
    insert into app.api_idempotencia (chave_id, chave, rota, resposta)
    values (k.id, v_idem_c, v_metodo || ' /' || array_to_string(v_seg, '/'), v_resp)
    on conflict (chave_id, chave) do update
      set rota = excluded.rota, resposta = excluded.resposta, criada_em = excluded.criada_em;
  end if;
  update app.api_chaves set usada_em = now()
   where id = k.id and (usada_em is null or usada_em < now() - interval '1 minute');
  insert into app.api_chamadas (chave_id, metodo, rota, status, codigo, registros)
  values (k.id, v_metodo, left(v_rota_log, 200), (v_resp ->> 'status')::integer,
          coalesce(v_codigo, v_resp #>> '{erro,codigo}'), (v_resp ->> 'registros')::integer);

  return v_resp;
end $$;
comment on function public.api_atender(text, text, text, jsonb, jsonb, text) is
  'A API externa do CRM (Edge Function api, só com a service_role). Recebe o SHA-256 da chave, o método, o caminho (v1/...), a consulta, o corpo e a Idempotency-Key; confere a chave, a rota, o escopo e o limite; faz o trabalho em nome da pessoa da chave, com as regras do CRM; anota a chamada. Devolve {status, dados|erro, ...}. Desde 20261125185000 também lê o sistema inteiro (consultas e tabelas, escopo sistema:ler, só chave de admin).';


-- =============================================================================
-- E. QUEM CHAMA O QUÊ
-- =============================================================================

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname in ('api_area', 'api_parametros', 'api_consultas_permitidas', 'api_coluna_escondida',
                         'api_tabelas_permitidas', 'api_colunas', 'api_v1_consultas', 'api_v1_consulta',
                         'api_v1_tabelas', 'api_v1_tabela', 'api_escopos', 'api_rotas', 'api_chave_nova')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.assinatura);
  end loop;
end $$;

revoke all on function public.api_atender(text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.api_atender(text, text, text, jsonb, jsonb, text) to service_role;

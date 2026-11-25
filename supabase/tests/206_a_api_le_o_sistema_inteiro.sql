-- =====================================================================
-- pgTAP — A API lê o sistema inteiro (migração 20261125185000)
--
-- Prova: a permissão "sistema:ler" existe e entra na chave; o catálogo de
-- consultas traz as das telas, com área e parâmetros, e deixa de fora as que
-- gravam, as das chaves e as que preparam envio; a consulta roda com o
-- parâmetro com ou sem "p_", converte data, enum e sim/não, devolve valor ou
-- lista e recusa parâmetro que falta, que não existe e que não serve; o
-- catálogo de tabelas traz as que a tela lê, com as colunas, sem as do schema
-- app e sem as colunas de segredo; a tabela filtra (igual, diferente, de, até,
-- contém, em, nulo), ordena, pagina e recusa coluna e filtro que não existem;
-- sem a permissão é 403, e com ela em chave de gestor também; a anotação
-- guarda o nome da consulta; nada disso grava.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(48);

insert into public.allowed_users (email, role, note) values
  ('g206@teste.local', 'gestor', 'pgTAP 206'),
  ('a206@teste.local', 'admin', 'pgTAP 206');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000020601'::uuid, 'g206@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000020602'::uuid, 'a206@teste.local', '{"full_name":"Ada Admin"}');

create function pg_temp.g() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000020601'::uuid $$;
create function pg_temp.a() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000020602'::uuid $$;

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
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'reset role';
end $$;

create temp table t206 (chave text primary key, v jsonb);
grant all on t206 to authenticated, service_role;
create function pg_temp.v(p text) returns jsonb language sql stable as $$ select v from t206 where chave = p $$;
create function pg_temp.guardar(p text, x jsonb) returns jsonb language sql as
  $$ insert into t206 values (p, x) on conflict (chave) do update set v = excluded.v returning v $$;
create function pg_temp.resumo(p text) returns text language sql immutable as
  $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;
create function pg_temp.api(p_nome text, p_chave text, p_caminho text, p_consulta jsonb default '{}'::jsonb)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := public.api_atender(pg_temp.resumo(p_chave), 'GET', p_caminho, p_consulta, null, null);
  perform pg_temp.sair();
  return pg_temp.guardar(p_nome, r);
end $$;
create function pg_temp.st(p text) returns int language sql stable as $$ select (pg_temp.v(p) ->> 'status')::int $$;
create function pg_temp.cod(p text) returns text language sql stable as $$ select pg_temp.v(p) #>> '{erro,codigo}' $$;
create function pg_temp.dados(p text) returns jsonb language sql stable as $$ select pg_temp.v(p) -> 'dados' $$;
create function pg_temp.k(p text) returns text language sql stable as $$ select pg_temp.v(p) ->> 'chave' $$;

-- Três cidades para filtrar.
insert into public.cities (name, state, ibge_code, is_metro_natal) values
  ('Cidade Teste 206 A', 'RN', '9920601', true),
  ('Cidade Teste 206 B', 'RN', '9920602', false),
  ('Cidade Teste 206 C', 'PB', '9920603', false);

-- =====================================================================
-- 1. A permissão
-- =====================================================================
select ok(app.api_escopos() @> '[{"id": "sistema:ler"}]'::jsonb, 'a permissão "Ler o sistema inteiro" está no catálogo da tela');

select pg_temp.entrar(pg_temp.a(), 'admin');
select pg_temp.guardar('adm', public.api_chave_criar('ISA', array['sistema:ler', 'fichas:ler']));
select pg_temp.guardar('so_fichas', public.api_chave_criar('Só fichas', array['fichas:ler']));
select pg_temp.guardar('do_gestor', public.api_chave_criar('Do gestor', array['sistema:ler'], pg_temp.g()));
select pg_temp.sair();
select ok((pg_temp.v('adm') ->> 'ok')::boolean and (pg_temp.v('do_gestor') ->> 'ok')::boolean,
  'a chave nasce com sistema:ler');

select pg_temp.api('inicio', pg_temp.k('adm'), 'v1');
select ok(pg_temp.dados('inicio') #> '{chave,escopos}' ? 'sistema:ler', 'GET /v1 mostra a permissão nova');

-- =====================================================================
-- 2. Sem a permissão, ou em nome de gestor
-- =====================================================================
select pg_temp.api('sem', pg_temp.k('so_fichas'), 'v1/consultas');
select is(pg_temp.st('sem') || ' ' || pg_temp.cod('sem'), '403 sem_escopo', 'sem sistema:ler: 403');
select pg_temp.api('sem_t', pg_temp.k('so_fichas'), 'v1/tabelas/cities');
select is(pg_temp.st('sem_t') || ' ' || pg_temp.cod('sem_t'), '403 sem_escopo', 'sem sistema:ler a tabela também é 403');
select pg_temp.api('gestor', pg_temp.k('do_gestor'), 'v1/consultas');
select is(pg_temp.st('gestor') || ' ' || pg_temp.cod('gestor'), '403 sistema_so_admin', 'chave em nome de gestor: 403');

-- =====================================================================
-- 3. O catálogo de consultas
-- =====================================================================
select pg_temp.api('cons', pg_temp.k('adm'), 'v1/consultas');
select is(pg_temp.st('cons'), 200, 'GET /v1/consultas: 200');
select ok(pg_temp.dados('cons') @> '[{"nome": "relatorio_atendimento", "area": "Relatórios e metas", "devolve": "valor",
                                       "parametros": [{"nome": "p_de", "tipo": "date", "obrigatorio": false}]}]'::jsonb,
  'traz o relatório de atendimento, com área e parâmetros');
select ok(pg_temp.dados('cons') @> '[{"nome": "deal_stage_timeline", "parametros": [{"nome": "p_deal_id", "obrigatorio": true}]}]'::jsonb,
  'diz quando o parâmetro é obrigatório');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.dados('cons')) x
                       where x ->> 'nome' ~ '^(api_|wa_preparar_envio|wa_chamada_autorizar|move_deal$)'),
  'fora: as das chaves, as que preparam envio e as que gravam');
select is((select count(*) from app.api_consultas_permitidas() c join pg_proc p on p.oid = c.fn where p.provolatile = 'v'),
  0::bigint, 'nenhuma consulta do catálogo pode gravar (todas STABLE ou IMMUTABLE)');
select is((pg_temp.v('cons') ->> 'registros')::int, jsonb_array_length(pg_temp.dados('cons')), 'registros conta o catálogo');

select pg_temp.api('cons_busca', pg_temp.k('adm'), 'v1/consultas', '{"busca": "relatorio_por"}');
select ok(jsonb_array_length(pg_temp.dados('cons_busca')) > 0
          and not exists (select 1 from jsonb_array_elements(pg_temp.dados('cons_busca')) x
                           where x ->> 'nome' not like '%relatorio_por%' and x ->> 'descricao' not ilike '%relatorio_por%'),
  'busca filtra o catálogo');

-- =====================================================================
-- 4. Rodar uma consulta
-- =====================================================================
select pg_temp.api('empresa', pg_temp.k('adm'), 'v1/consultas/empresa_do_banco');
select is(pg_temp.dados('empresa'), to_jsonb(public.empresa_do_banco()), 'consulta sem parâmetro devolve o valor');

select pg_temp.api('ra', pg_temp.k('adm'), 'v1/consultas/relatorio_atendimento', '{"de": "2026-11-01", "ate": "2026-11-30"}');
select is(pg_temp.st('ra'), 200, 'parâmetro sem o "p_" vale');
select pg_temp.entrar(pg_temp.a(), 'admin');
select pg_temp.guardar('ra_tela', public.relatorio_atendimento('2026-11-01', '2026-11-30'));
select pg_temp.sair();
select is(pg_temp.dados('ra'), pg_temp.v('ra_tela'), 'a API devolve o mesmo que a tela recebe');

select pg_temp.api('ra_p', pg_temp.k('adm'), 'v1/consultas/relatorio_atendimento', '{"p_de": "2026-11-01"}');
select is(pg_temp.st('ra_p'), 200, 'parâmetro com o "p_" também vale');

select pg_temp.api('lista', pg_temp.k('adm'), 'v1/consultas/relatorios_semanais', '{"semanas": "3"}');
select ok(pg_temp.st('lista') = 200 and jsonb_typeof(pg_temp.dados('lista')) = 'array',
  'consulta que devolve várias linhas vem como lista');

select pg_temp.api('enum', pg_temp.k('adm'), 'v1/consultas/goal_progress', '{"period": "week", "ref": "2026-11-25"}');
select is(pg_temp.st('enum'), 200, 'parâmetro de tipo próprio do CRM (enum) é convertido');

select pg_temp.api('lim', pg_temp.k('adm'), 'v1/consultas/search_organizations', '{"limite": "1"}');
select ok(pg_temp.st('lim') = 200 and jsonb_array_length(pg_temp.dados('lim')) <= 1, 'limite corta a lista');

select pg_temp.api('falta', pg_temp.k('adm'), 'v1/consultas/deal_stage_timeline');
select is(pg_temp.st('falta') || ' ' || pg_temp.cod('falta'), '400 parametro_faltando', 'parâmetro obrigatório que falta: 400');
select ok(pg_temp.v('falta') #>> '{erro,mensagem}' like '%p_deal_id%', 'a recusa diz qual parâmetro falta');

select pg_temp.api('ruim', pg_temp.k('adm'), 'v1/consultas/deal_stage_timeline', '{"deal_id": "abc"}');
select is(pg_temp.st('ruim') || ' ' || pg_temp.cod('ruim'), '400 parametro_invalido', 'valor que não serve: 400');

select pg_temp.api('desc', pg_temp.k('adm'), 'v1/consultas/empresa_do_banco', '{"x": "1"}');
select is(pg_temp.st('desc') || ' ' || pg_temp.cod('desc'), '400 parametro_desconhecido', 'parâmetro que não existe: 400');

select pg_temp.api('grava', pg_temp.k('adm'), 'v1/consultas/move_deal');
select is(pg_temp.st('grava') || ' ' || pg_temp.cod('grava'), '404 consulta_inexistente', 'função que grava não roda: 404');
select pg_temp.api('chaves', pg_temp.k('adm'), 'v1/consultas/api_integracoes');
select is(pg_temp.st('chaves') || ' ' || pg_temp.cod('chaves'), '404 consulta_inexistente', 'a lista de chaves não sai: 404');

select is((select rota from app.api_chamadas where chave_id = (pg_temp.v('adm') ->> 'id')::uuid and status = 200
            and rota like 'GET /v1/consultas/empresa%' limit 1),
  'GET /v1/consultas/empresa_do_banco', 'a anotação guarda o nome da consulta');

-- =====================================================================
-- 5. O catálogo de tabelas
-- =====================================================================
select pg_temp.api('tabs_leve', pg_temp.k('adm'), 'v1/tabelas');
select ok(pg_temp.st('tabs_leve') = 200
          and pg_temp.dados('tabs_leve') @> '[{"nome": "cities", "tipo": "tabela"}]'::jsonb
          and not exists (select 1 from jsonb_array_elements(pg_temp.dados('tabs_leve')) x where x ? 'colunas'),
  'GET /v1/tabelas: 200, leve, sem as colunas');
select pg_temp.api('tabs', pg_temp.k('adm'), 'v1/tabelas', '{"colunas": "sim"}');
select ok(pg_temp.dados('tabs') @> '[{"nome": "cities", "tipo": "tabela", "colunas": [{"nome": "name", "tipo": "text"}]}]'::jsonb,
  'com colunas=sim, traz as colunas e os tipos');
select pg_temp.api('tabs_busca', pg_temp.k('adm'), 'v1/tabelas', '{"busca": "cities"}');
select ok(pg_temp.dados('tabs_busca') @> '[{"nome": "cities", "colunas": [{"nome": "name"}]}]'::jsonb,
  'com a busca, as colunas vêm junto');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.dados('tabs')) x where x ->> 'nome' like 'api\_%'),
  'as tabelas da API (schema app) não aparecem');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.dados('tabs')) x,
                                    jsonb_array_elements(x -> 'colunas') c
                       where c ->> 'nome' in ('token', 'voip_token', 'claim_token_hash', 'chave_crua')),
  'as colunas de segredo não aparecem');
select is((select count(*) from jsonb_array_elements(pg_temp.dados('tabs')) x
            where not has_table_privilege('authenticated', ('public.' || quote_ident(x ->> 'nome'))::regclass, 'SELECT')),
  0::bigint, 'só tabela que a tela pode ler');

-- =====================================================================
-- 6. Ler uma tabela
-- =====================================================================
select pg_temp.api('t_igual', pg_temp.k('adm'), 'v1/tabelas/cities', '{"name": "Cidade Teste 206 B"}');
select ok(pg_temp.st('t_igual') = 200 and (pg_temp.v('t_igual') ->> 'total')::int = 1
          and pg_temp.dados('t_igual') -> 0 ->> 'ibge_code' = '9920602', 'filtro igual');

select pg_temp.api('t_contem', pg_temp.k('adm'), 'v1/tabelas/cities',
  '{"name.contem": "teste 206", "ordem": "-name", "colunas": "name,state"}');
select is(pg_temp.dados('t_contem'),
  '[{"name": "Cidade Teste 206 C", "state": "PB"}, {"name": "Cidade Teste 206 B", "state": "RN"}, {"name": "Cidade Teste 206 A", "state": "RN"}]'::jsonb,
  'contém (sem diferença de maiúscula), ordem decrescente e só as colunas pedidas');

select pg_temp.api('t_em', pg_temp.k('adm'), 'v1/tabelas/cities',
  '{"ibge_code.em": "9920601,9920603", "is_metro_natal": "false"}');
select is((pg_temp.v('t_em') ->> 'total')::int, 1, 'filtros "em" e igual juntos');

select pg_temp.api('t_dif', pg_temp.k('adm'), 'v1/tabelas/cities', '{"name.contem": "Teste 206", "state.diferente": "RN"}');
select is((pg_temp.v('t_dif') ->> 'total')::int, 1, 'filtro diferente');

select pg_temp.api('t_data', pg_temp.k('adm'), 'v1/tabelas/cities',
  jsonb_build_object('name.contem', 'Teste 206', 'created_at.de', to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM-DD'),
                     'created_at.ate', to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM-DD')));
select is((pg_temp.v('t_data') ->> 'total')::int, 3, 'de e até com a data sozinha valem o dia inteiro');

select pg_temp.api('t_pag', pg_temp.k('adm'), 'v1/tabelas/cities', '{"name.contem": "Teste 206", "ordem": "name", "limite": "2", "pagina": "2"}');
select ok(jsonb_array_length(pg_temp.dados('t_pag')) = 1 and pg_temp.dados('t_pag') -> 0 ->> 'name' = 'Cidade Teste 206 C'
          and pg_temp.v('t_pag') -> 'proxima_pagina' = 'null'::jsonb, 'pagina e limite');
select pg_temp.api('t_pag1', pg_temp.k('adm'), 'v1/tabelas/cities', '{"name.contem": "Teste 206", "limite": "2"}');
select is((pg_temp.v('t_pag1') ->> 'proxima_pagina')::int, 2, 'diz a próxima página quando há mais');

select pg_temp.api('t_col', pg_temp.k('adm'), 'v1/tabelas/cities', '{"nome": "x"}');
select ok(pg_temp.st('t_col') || ' ' || pg_temp.cod('t_col') = '400 coluna_inexistente'
          and pg_temp.v('t_col') #>> '{erro,mensagem}' like '%Colunas: id, name%', 'coluna que não existe: 400, com a lista');
select pg_temp.api('t_op', pg_temp.k('adm'), 'v1/tabelas/cities', '{"name.parece": "x"}');
select is(pg_temp.st('t_op') || ' ' || pg_temp.cod('t_op'), '400 filtro_invalido', 'filtro que não existe: 400');
select pg_temp.api('t_val', pg_temp.k('adm'), 'v1/tabelas/cities', '{"id": "abc"}');
select is(pg_temp.st('t_val') || ' ' || pg_temp.cod('t_val'), '400 filtro_invalido', 'valor que não serve para a coluna: 400');
select pg_temp.api('t_ord', pg_temp.k('adm'), 'v1/tabelas/cities', '{"ordem": "-xyz"}');
select is(pg_temp.st('t_ord') || ' ' || pg_temp.cod('t_ord'), '400 coluna_inexistente', 'ordem por coluna que não existe: 400');
select pg_temp.api('t_app', pg_temp.k('adm'), 'v1/tabelas/api_chaves');
select is(pg_temp.st('t_app') || ' ' || pg_temp.cod('t_app'), '404 tabela_inexistente', 'tabela fora do alcance da tela: 404');
select pg_temp.api('t_nulo', pg_temp.k('adm'), 'v1/tabelas/cities', '{"name.contem": "Teste 206", "ibge_code.nulo": "nao"}');
select is((pg_temp.v('t_nulo') ->> 'total')::int, 3, 'filtro nulo');

-- =====================================================================
-- 7. Nada grava; o resto da API continua igual
-- =====================================================================
select is((select count(*) from public.cities where name like 'Cidade Teste 206%'), 3::bigint,
  'ler não muda nada');
select pg_temp.api('fichas', pg_temp.k('adm'), 'v1/fichas', '{"limite": "1"}');
select is(pg_temp.st('fichas'), 200, 'as rotas de antes continuam');

select * from finish();
rollback;

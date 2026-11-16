-- =====================================================================
-- pgTAP — A largura e o comprimento do terreno no anúncio (migração
-- 20261116120000), só na Imova
--
-- Prova: as duas colunas existem, em metros com duas casas; o salvar grava,
-- troca e apaga as medidas (o formulário vai inteiro: campo vazio apaga), em
-- terreno e em casa; as medidas não mudam as pendências do portal; zero,
-- negativo e medida grande demais são recusados; a terceira casa arredonda; o
-- resto do formulário continua indo; quem chama o salvar; nenhum UPDATE sem
-- WHERE.
--
-- Roda em transação e desfaz tudo. Na KOMUNE a migração não cria nada.
-- =====================================================================
begin;
select plan(17);

insert into public.allowed_users (email, role, note) values
  ('a174.s@teste.local', 'sdr', 'pgTAP medidas do terreno');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000017401'::uuid, 'a174.s@teste.local', '{"full_name":"Sol SDR"}');
create function pg_temp.sdr() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'a0000000-0000-4000-8000-000000017401', 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', 'sdr'))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

create temp table t174(chave text primary key, v jsonb);
grant select, insert on t174 to authenticated;
create function pg_temp.v(p text) returns jsonb language sql as
  $$ select v from t174 where chave = p $$;
create function pg_temp.id(p text) returns uuid language sql as
  $$ select (v ->> 'id')::uuid from t174 where chave = p $$;
create function pg_temp.medidas(p text) returns numeric[] language sql as
  $$ select array[a.largura_terreno, a.comprimento_terreno]
       from public.anuncios a where a.id = pg_temp.id(p) $$;

-- =====================================================================
-- 1. As colunas
-- =====================================================================
select col_type_is('public', 'anuncios', 'largura_terreno', 'numeric(8,2)',
  'a largura do terreno é em metros, com duas casas');
select col_type_is('public', 'anuncios', 'comprimento_terreno', 'numeric(8,2)',
  'o comprimento do terreno é em metros, com duas casas');
select ok((select bool_and(not attnotnull) from pg_attribute
            where attrelid = 'public.anuncios'::regclass
              and attname in ('largura_terreno', 'comprimento_terreno')),
  'as duas medidas são opcionais');

-- =====================================================================
-- 2. O salvar grava, troca e apaga
-- =====================================================================
select pg_temp.sdr();
insert into t174 select 'terreno', public.anuncio_salvar(
  '{"tipo": "terreno", "titulo": "Terreno T174", "area_total": 375,
    "largura_terreno": 12.5, "comprimento_terreno": 30}'::jsonb);
insert into t174 select 'sem_medidas', public.anuncio_salvar(
  '{"tipo": "terreno", "titulo": "Terreno T174", "area_total": 375}'::jsonb);
insert into t174 select 'casa', public.anuncio_salvar(
  '{"tipo": "casa", "titulo": "Casa T174", "largura_terreno": 10, "comprimento_terreno": 25.75}'::jsonb);
select pg_temp.sair();

select ok((pg_temp.v('terreno') ->> 'ok')::boolean and (pg_temp.v('casa') ->> 'ok')::boolean,
  'o SDR salva o anúncio com as medidas');
select is(pg_temp.medidas('terreno'), array[12.50, 30.00]::numeric[],
  'o terreno guarda 12,5 m de largura e 30 m de comprimento');
select is(pg_temp.medidas('casa'), array[10.00, 25.75]::numeric[],
  'a casa também guarda as medidas do terreno');
select is((select area_total from public.anuncios where id = pg_temp.id('terreno')), 375,
  'a área total continua indo, à parte das medidas');
select is(pg_temp.medidas('sem_medidas'), array[null, null]::numeric[],
  'sem as medidas, as colunas ficam vazias');
select is(pg_temp.v('terreno') -> 'pendencias', pg_temp.v('sem_medidas') -> 'pendencias',
  'as medidas não mudam o que falta para o portal');

select pg_temp.sdr();
insert into t174 select 'trocou', public.anuncio_salvar(
  '{"tipo": "terreno", "titulo": "Terreno T174", "largura_terreno": 15, "comprimento_terreno": 40}'::jsonb,
  pg_temp.id('terreno'));
select pg_temp.sair();
select is(pg_temp.medidas('terreno'), array[15.00, 40.00]::numeric[],
  'salvar de novo troca as medidas');

select pg_temp.sdr();
insert into t174 select 'apagou', public.anuncio_salvar(
  '{"tipo": "terreno", "titulo": "Terreno T174"}'::jsonb, pg_temp.id('terreno'));
select pg_temp.sair();
select is(pg_temp.medidas('terreno'), array[null, null]::numeric[],
  'o formulário vai inteiro: medida vazia apaga a que estava');

-- =====================================================================
-- 3. O que o banco recusa ou arredonda
-- =====================================================================
select pg_temp.sdr();
select throws_ok(
  $$ select public.anuncio_salvar('{"tipo": "terreno", "largura_terreno": 0}'::jsonb) $$,
  '23514', null, 'largura zero é recusada');
select throws_ok(
  $$ select public.anuncio_salvar('{"tipo": "terreno", "comprimento_terreno": -3}'::jsonb) $$,
  '23514', null, 'comprimento negativo é recusado');
select throws_ok(
  $$ select public.anuncio_salvar('{"tipo": "terreno", "largura_terreno": 1000000}'::jsonb) $$,
  '22003', null, 'medida de um milhão de metros não cabe');
insert into t174 select 'tres_casas', public.anuncio_salvar(
  '{"tipo": "terreno", "titulo": "Terreno T174 três casas", "largura_terreno": 12.345}'::jsonb);
select pg_temp.sair();
select is(pg_temp.medidas('tres_casas'), array[12.35, null]::numeric[],
  'a terceira casa arredonda para duas');

-- =====================================================================
-- 4. Quem chama o salvar
-- =====================================================================
select ok(has_function_privilege('authenticated', 'public.anuncio_salvar(jsonb, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.anuncio_salvar(jsonb, uuid)', 'execute'),
  'o salvar continua da equipe logada, não do anon');
select is(
  (select count(*)::int
     from pg_proc p, regexp_split_to_table(p.prosrc, ';') as comando
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'anuncio_salvar'
      and comando ~* '(^|\n)\s*(update|delete)\s'
      and comando !~* '\swhere\s'),
  0, 'nenhum UPDATE ou DELETE sem WHERE (o safeupdate da API recusaria)');

select * from finish();
rollback;

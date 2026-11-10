-- =====================================================================
-- pgTAP — O código do anúncio com a tag do tipo (migração 20261110100000),
-- só na Imova
--
-- Prova: a tag de cada tipo; o próximo número conta o CRM (com os excluídos),
-- o relatório do Canal Pro e o arquivo do sistema atual, com ou sem sufixo;
-- criar dá o código pela tag do tipo, e um `prefixo` mandado não muda isso; a
-- prévia acompanha; no rascunho do CRM que nunca foi ao ar o código segue o
-- tipo (e o IMV-… antigo ganha a tag); o código trazido de fora e o do anúncio
-- que já foi ao ar não mudam; quem pode chamar o quê; nenhum UPDATE sem WHERE.
--
-- Os números do teste começam em 7001 para não depender dos anúncios que o
-- banco já tem. Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(21);

insert into public.allowed_users (email, role, note) values
  ('a141.s@teste.local', 'sdr', 'pgTAP código com tag');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000014101'::uuid, 'a141.s@teste.local', '{"full_name":"Sara SDR"}');
create function pg_temp.entrar(p_id text, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sdr() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000014101', 'sdr') $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

-- Os retornos das chamadas, para as asserções lerem depois.
create temp table t141(chave text primary key, v jsonb);
grant select, insert on t141 to authenticated;
create function pg_temp.v(p text) returns jsonb language sql as
  $$ select v from t141 where chave = p $$;
create function pg_temp.id(p text) returns uuid language sql as
  $$ select (v ->> 'id')::uuid from t141 where chave = p $$;
create function pg_temp.codigo(p text) returns text language sql as
  $$ select a.codigo from public.anuncios a where a.id = pg_temp.id(p) $$;

-- =====================================================================
-- 1. O vocabulário
-- =====================================================================
select is(
  (select array_agg(app.anuncio_tag_do_tipo(t) order by o)
     from unnest(array['terreno', 'terreno_comercial', 'sala_comercial', 'consultorio', 'casa',
                       'apartamento', 'chacara', 'loja', 'galpao', 'predio_residencial'])
          with ordinality as x(t, o)),
  array['TE', 'TE', 'SA', 'SA', 'IM', 'IM', 'IM', 'CO', 'CO', 'CO'],
  'a tag do tipo: terrenos TE, sala e consultório SA, residenciais IM, comerciais CO');

select is(
  (select array_agg(coalesce(app.anuncio_tag_do_codigo(c), '-') order by o)
     from unnest(array['TE0006', 'SA0013', 'TE0001_IMOVA', 'IMV-0001', 'PT0001', 'Casa extremox'])
          with ordinality as x(c, o)),
  array['TE', 'SA', '-', '-', '-', '-'],
  'a tag do código só existe no código que o CRM deu');

select ok(app.anuncio_tag_valida('TE') and app.anuncio_tag_valida('CO')
          and not app.anuncio_tag_valida('PT') and not app.anuncio_tag_valida('te')
          and not app.anuncio_tag_valida(null),
  'PT não é tag do CRM; a tag é em maiúscula');

-- =====================================================================
-- 2. O próximo número conta tudo o que o CRM conhece
-- =====================================================================
insert into public.anuncios (codigo, titulo, tipo, origem) values
  ('TE7001_IMOVA', 'Terreno T141 do sistema atual', 'terreno', 'sistema_atual');
insert into public.anuncios (codigo, titulo, tipo, excluido_em, motivo_exclusao) values
  ('TE7002', 'Terreno T141 excluído', 'terreno', now(), 'teste');
insert into public.anuncios_no_canal_pro (codigo, titulo) values
  ('TE7003', 'Terreno T141 só no Canal Pro'),
  ('Terreno TE7999', 'Não começa com a tag: não conta');
insert into public.sistema_atual_no_arquivo (codigo, no_arquivo) values ('TE7004_IMOVA', true);
-- Um anúncio já publicado uma vez, hoje fora do ar, e um rascunho antigo do CRM.
insert into public.anuncios (codigo, titulo, tipo, situacao, publicado_em) values
  ('IM7001', 'Casa T141 que já foi ao ar', 'casa', 'pausado', now() - interval '1 day');
insert into public.anuncios (codigo, titulo, tipo) values
  ('IMV-7001', 'Casa T141 com o código antigo', 'casa');

select is(app.anuncio_proximo_codigo('TE'), 'TE7005',
  'o próximo terreno passa do maior: CRM, excluído, relatório e arquivo, com ou sem sufixo');
select is(app.anuncio_proximo_codigo('PT'), null, 'PT não tem próximo código');

-- =====================================================================
-- 3. Criar: o código sai do tipo
-- =====================================================================
create temp table antes as
  select app.anuncio_proximo_codigo('SA') as sa, app.anuncio_proximo_codigo('IM') as im,
         app.anuncio_proximo_codigo('CO') as co, (select count(*) from public.anuncios) as n;
grant select on antes to authenticated;

select pg_temp.sdr();
insert into t141 select 'terreno', public.anuncio_salvar(
  '{"tipo": "terreno", "titulo": "Terreno T141"}'::jsonb);
insert into t141 select 'sala', public.anuncio_salvar(
  '{"tipo": "sala_comercial", "titulo": "Sala T141"}'::jsonb);
insert into t141 select 'casa', public.anuncio_salvar(
  '{"tipo": "casa", "titulo": "Casa T141"}'::jsonb);
insert into t141 select 'loja', public.anuncio_salvar(
  '{"tipo": "loja", "titulo": "Loja T141"}'::jsonb);
insert into t141 select 'com_prefixo', public.anuncio_salvar(
  '{"tipo": "terreno", "titulo": "Terreno T141 com outra tag pedida", "prefixo": "SA"}'::jsonb);
insert into t141 select 'previa', public.anuncio_proximos_codigos();
select pg_temp.sair();

select is(pg_temp.v('terreno') ->> 'codigo', 'TE7005', 'terreno ganha TE e o próximo número livre');
select is(pg_temp.codigo('terreno'), 'TE7005', 'e é o código gravado');
select is(pg_temp.v('sala') ->> 'codigo', (select sa from antes), 'sala comercial ganha SA');
select is(pg_temp.v('casa') ->> 'codigo', (select im from antes), 'casa ganha IM');
select is(pg_temp.v('loja') ->> 'codigo', (select co from antes), 'loja ganha CO');
select is(pg_temp.v('com_prefixo') ->> 'codigo', 'TE7006',
  'a tag sai sempre do tipo: um prefixo mandado não muda o código');
select is((select count(*) from public.anuncios), (select n + 5 from antes),
  'os cinco anúncios foram criados');
select is(pg_temp.v('previa') -> 'codigos' ->> 'TE', 'TE7007', 'a prévia já mostra o terreno seguinte');

-- =====================================================================
-- 4. Trocar o tipo depois de criado
-- =====================================================================
select pg_temp.sdr();
insert into t141 select 'mesma_tag', public.anuncio_salvar(
  '{"tipo": "apartamento", "titulo": "Casa T141 virou apartamento"}'::jsonb, pg_temp.id('casa'));
insert into t141 select 'virou_terreno', public.anuncio_salvar(
  '{"tipo": "terreno", "titulo": "Casa T141 virou terreno"}'::jsonb, pg_temp.id('casa'));
insert into t141 select 'antigo', public.anuncio_salvar(
  '{"tipo": "casa", "titulo": "Casa T141 com o código antigo"}'::jsonb,
  (select id from public.anuncios where codigo = 'IMV-7001'));
insert into t141 select 'de_fora', public.anuncio_salvar(
  '{"tipo": "casa", "titulo": "Terreno T141 do sistema atual"}'::jsonb,
  (select id from public.anuncios where codigo = 'TE7001_IMOVA'));
insert into t141 select 'ja_foi', public.anuncio_salvar(
  '{"tipo": "terreno", "titulo": "Casa T141 que já foi ao ar"}'::jsonb,
  (select id from public.anuncios where codigo = 'IM7001'));
select pg_temp.sair();

select is(pg_temp.v('mesma_tag') ->> 'codigo', (select im from antes),
  'casa → apartamento: a mesma tag, o código fica');
select is(pg_temp.v('virou_terreno') ->> 'codigo', 'TE7007',
  'casa → terreno no rascunho do CRM: o código vira o próximo TE');
select matches(pg_temp.v('antigo') ->> 'codigo', '^IM[0-9]{4,}$',
  'o rascunho antigo do CRM (IMV-…) ganha a tag no próximo salvar');
select is(pg_temp.v('de_fora') ->> 'codigo', 'TE7001_IMOVA',
  'o código trazido do sistema atual não muda com o tipo');
select is(pg_temp.v('ja_foi') ->> 'codigo', 'IM7001',
  'o código do anúncio que já foi ao ar não muda com o tipo');

-- =====================================================================
-- 5. Quem chama o quê
-- =====================================================================
select ok(has_function_privilege('authenticated', 'public.anuncio_proximos_codigos()', 'execute')
          and not has_function_privilege('anon', 'public.anuncio_proximos_codigos()', 'execute'),
  'a prévia é da equipe logada, não do anon');
select ok(not has_function_privilege('authenticated', 'app.anuncio_proximo_codigo(text)', 'execute')
          and not has_function_privilege('anon', 'app.anuncio_proximo_codigo(text)', 'execute'),
  'a conta do próximo número só roda por dentro das funções');
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

-- =====================================================================
-- pgTAP — Fotos do Canal Pro (migração 20261118120000), só na Imova
--
-- Prova: o anúncio aceita até 60 fotos (era 40); `anuncio_fotos_trocar` deixa só
-- as novas, na ordem pedida, e devolve os caminhos das que saíram; recusa vetor
-- vazio e foto de outro anúncio; no anúncio no ar, só a gestão troca; o anon nem
-- executa; nenhum UPDATE ou DELETE sem WHERE.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(15);

insert into public.allowed_users (email, role, note) values
  ('a131.g@teste.local', 'gestor', 'pgTAP fotos do Canal Pro'),
  ('a131.s@teste.local', 'sdr', 'pgTAP fotos do Canal Pro');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000013101'::uuid, 'a131.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000013102'::uuid, 'a131.s@teste.local', '{"full_name":"Sara SDR"}');
create function pg_temp.entrar(p_id text, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.gestor() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000013101', 'gestor') $$;
create function pg_temp.sdr() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000013102', 'sdr') $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

insert into public.anuncios (codigo, titulo, tipo, negocio, area_total, cidade) values
  ('T131A', 'Muitas fotos', 'terreno', 'venda', 13101, 'Cidade T131'),
  ('T131B', 'Trocar fotos', 'terreno', 'venda', 13102, 'Cidade T131'),
  ('T131C', 'No ar', 'terreno', 'venda', 13103, 'Cidade T131');
create function pg_temp.id(p_codigo text) returns uuid language sql as
  $$ select id from public.anuncios where codigo = p_codigo $$;
grant execute on function pg_temp.id(text) to authenticated;

-- O arquivo no balde (a rota sobe antes de registrar): aqui, só a linha do Storage.
create function pg_temp.arquivo(p_anuncio uuid) returns text language plpgsql as $$
declare v text := p_anuncio::text || '/' || gen_random_uuid()::text || '.jpg';
begin
  insert into storage.objects (bucket_id, name) values ('anuncios', v);
  return v;
end $$;
create temp table caminhos(n int, anuncio text, caminho text);
insert into caminhos select g, 'A', pg_temp.arquivo(pg_temp.id('T131A')) from generate_series(1, 61) g;
insert into caminhos select g, 'B', pg_temp.arquivo(pg_temp.id('T131B')) from generate_series(1, 5) g;
insert into caminhos select g, 'C', pg_temp.arquivo(pg_temp.id('T131C')) from generate_series(1, 2) g;
grant select on caminhos to authenticated;
create temp table r(chave text, valor jsonb);
grant select, insert on r to authenticated;

-- =====================================================================
-- 1. Até 60 fotos
-- =====================================================================
select pg_temp.gestor();
insert into r select 'A' || n, public.anuncio_foto_adicionar(pg_temp.id('T131A'), caminho)
  from caminhos where anuncio = 'A' order by n;
select pg_temp.sair();
select is((select count(*)::int from r where chave ~ '^A' and valor ->> 'ok' = 'true'), 60,
  'o anúncio aceita 60 fotos (o Edifício Simone tem 47 no Canal Pro)');
select is((select valor ->> 'motivo' from r where chave = 'A61'), 'fotos_demais', 'a 61ª é recusada');

-- =====================================================================
-- 2. Trocar pelas que acabaram de chegar
-- =====================================================================
select pg_temp.gestor();
-- Três antigas, depois duas novas (que entram no fim da fila).
insert into r select 'B' || n, public.anuncio_foto_adicionar(pg_temp.id('T131B'), caminho)
  from caminhos where anuncio = 'B' order by n;
insert into r select 'trocaB', public.anuncio_fotos_trocar(pg_temp.id('T131B'),
  array[(select (valor ->> 'id')::uuid from r where chave = 'B5'),
        (select (valor ->> 'id')::uuid from r where chave = 'B4'),
        (select (valor ->> 'id')::uuid from r where chave = 'B5')]);
select pg_temp.sair();
select is((select valor - 'removidas' from r where chave = 'trocaB'), '{"ok": true, "fotos": 2}'::jsonb,
  'troca: ficam as duas novas (a repetida conta uma vez)');
select is((select jsonb_array_length(valor -> 'removidas') from r where chave = 'trocaB'), 3,
  'e devolve os caminhos das três que saíram, para a rota apagar do balde');
select ok((select bool_and(c.caminho in (select jsonb_array_elements_text(valor -> 'removidas') from r where chave = 'trocaB'))
             from caminhos c where c.anuncio = 'B' and c.n <= 3),
  'as que saíram são as antigas');
select is((select string_agg(c.n::text || '@' || f.posicao, ' ' order by f.posicao)
             from public.anuncio_fotos f join caminhos c on c.caminho = f.caminho
            where f.anuncio_id = pg_temp.id('T131B')),
  '5@0 4@1', 'as novas ficam na ordem pedida, a partir da capa');

select pg_temp.gestor();
select is(public.anuncio_fotos_trocar(pg_temp.id('T131B'), array[]::uuid[]) ->> 'motivo', 'sem_fotos_novas',
  'trocar por nada é recusado (apagaria todas)');
select is(public.anuncio_fotos_trocar(pg_temp.id('T131B'), array[(select (valor ->> 'id')::uuid from r where chave = 'A1')])
            ->> 'motivo', 'foto_de_outro_anuncio', 'foto de outro anúncio é recusada');
select pg_temp.sair();
select is((select count(*)::int from public.anuncio_fotos where anuncio_id = pg_temp.id('T131B')), 2,
  'e nenhuma recusa mexeu nas fotos');

-- =====================================================================
-- 3. No ar, só a gestão troca; o anon nem executa
-- =====================================================================
select pg_temp.gestor();
insert into r select 'C' || n, public.anuncio_foto_adicionar(pg_temp.id('T131C'), caminho)
  from caminhos where anuncio = 'C' order by n;
select pg_temp.sair();
update public.anuncios set situacao = 'no_ar' where codigo = 'T131C';

select pg_temp.sdr();
select is(public.anuncio_fotos_trocar(pg_temp.id('T131C'), array[(select (valor ->> 'id')::uuid from r where chave = 'C2')])
            ->> 'motivo', 'so_gestao_mexe_no_ar', 'no anúncio no ar, o SDR não troca');
select pg_temp.sair();
select pg_temp.gestor();
select is(public.anuncio_fotos_trocar(pg_temp.id('T131C'), array[(select (valor ->> 'id')::uuid from r where chave = 'C2')])
            ->> 'ok', 'true', 'a gestão troca');
select pg_temp.sair();
select is((select count(*)::int from public.anuncio_fotos where anuncio_id = pg_temp.id('T131C')), 1,
  'e o anúncio no ar continua com foto');

select ok(not has_function_privilege('anon', 'public.anuncio_fotos_trocar(uuid, uuid[])', 'execute'),
  'o anon não executa a troca');
select ok(has_function_privilege('authenticated', 'public.anuncio_fotos_trocar(uuid, uuid[])', 'execute'),
  'quem entrou executa (e a função confere quem pode)');

-- =====================================================================
-- 4. O safeupdate da API
-- =====================================================================
select is(
  (select count(*)::int
     from pg_proc p
    cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('anuncio_foto_adicionar', 'anuncio_fotos_trocar')
      and comando ~* '(^|\n)\s*(update|delete)\s'
      and comando !~* '\swhere\s'),
  0, 'nenhum UPDATE ou DELETE sem WHERE (o safeupdate da API recusaria)');

select * from finish();
rollback;

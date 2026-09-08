-- =====================================================================
-- pgTAP — A coleta do Radar cabe num botão
--         (migração 20260908170000_a_coleta_do_radar_cabe_num_botao.sql)
--
-- Até 08/09/2026 nada no produto enfileirava um `ingest_jobs`: para pedir uma
-- coleta era preciso montar o payload à mão e chamar a fila por psql com
-- service_role. `radar_coletar_agora` fecha isso.
--
-- As asserções que importam mais neste arquivo não são as do caminho feliz.
-- São duas:
--
--   1. TODA recusa acontece ANTES de escrever. Uma recusa que já abriu o lote
--      deixa `import_batches` com uma linha em `previa` que ninguém vai
--      concluir — foi exatamente o que aconteceu no lote de teste que motivou
--      esta função.
--   2. Lote e job entram JUNTOS. Um lote em `na_fila` sem mensagem na fila é um
--      lote que espera para sempre, e a tela mostra "rodando" para algo que
--      nunca vai rodar.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(22);

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
create function pg_temp.lotes(p_fonte int) returns bigint
  language sql security definer set search_path = '' as $$
  select count(*) from public.import_batches where source_id = p_fonte and kind = 'coleta'
$$;
create function pg_temp.na_fila(p_batch uuid) returns bigint
  language sql security definer set search_path = '' as $$
  select count(*) from public.ingest_dedup
   where queue = 'ingest_jobs' and batch_id = p_batch and msg_id is not null
$$;

create table pg_temp.r (chave text primary key, valor jsonb);
grant select on pg_temp.r to authenticated;

-- Entra no papel, chama, sai do papel e grava. O `insert` acontece de volta
-- como postgres: `authenticated` tem select em pg_temp.r, não insert.
create function pg_temp.pedir(p_chave text, p_uid uuid, p_papel text,
                              p_fonte int, p_cats text[] default null, p_pag int default 1)
returns void language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.entrar(p_uid, p_papel);
  v := public.radar_coletar_agora(p_fonte, p_cats, p_pag);
  perform pg_temp.sair();
  insert into pg_temp.r values (p_chave, v);
end $$;

-- ---------- gente ----------
insert into public.allowed_users (email, role, note)
values ('c37.sdr@teste.local', 'sdr', 'pgTAP coleta num botão'),
       ('c37.leitura@teste.local', 'leitura', 'pgTAP coleta num botão');
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-0000000037a1', 'c37.sdr@teste.local', '{"full_name":"SDR C37"}'),
       ('a0000000-0000-4000-8000-0000000037a2', 'c37.leitura@teste.local', '{"full_name":"Leitura C37"}');

-- ---------- fontes de teste ----------
-- Uma fonte completa (ligada, coletor ligado, catálogo com duas categorias),
-- uma com o coletor desligado e uma ligada sem catálogo nenhum.
insert into public.sources (id, slug, name, kind, legal_basis, is_enabled, config)
values
  (937, 'c37_boa', 'C37 Fonte boa', 'scrape', 'legitimo_interesse', true,
   jsonb_build_object('collector', jsonb_build_object(
     'kind', 'http', 'enabled', true,
     'catalogo', jsonb_build_array(
       jsonb_build_object('caminho', '/a', 'categoria_origem', 'c37-alfa'),
       jsonb_build_object('caminho', '/b', 'categoria_origem', 'c37-beta'))))),
  (938, 'c37_coletor_off', 'C37 Coletor desligado', 'scrape', 'legitimo_interesse', true,
   jsonb_build_object('collector', jsonb_build_object(
     'kind', 'http', 'enabled', false,
     'catalogo', jsonb_build_array(
       jsonb_build_object('caminho', '/a', 'categoria_origem', 'c37-alfa'))))),
  (939, 'c37_sem_catalogo', 'C37 Sem catálogo', 'scrape', 'legitimo_interesse', true,
   jsonb_build_object('collector', jsonb_build_object('kind', 'http', 'enabled', true))),
  (940, 'c37_desligada', 'C37 Fonte desligada', 'scrape', 'legitimo_interesse', false,
   jsonb_build_object('collector', jsonb_build_object(
     'kind', 'http', 'enabled', true,
     'catalogo', jsonb_build_array(
       jsonb_build_object('caminho', '/a', 'categoria_origem', 'c37-alfa')))));


-- =====================================================================
-- 1. Quem não escreve na base não manda coletar
-- =====================================================================
select pg_temp.pedir('leitura', 'a0000000-0000-4000-8000-0000000037a2', 'leitura', 937);

select is((select valor ->> 'motivo' from pg_temp.r where chave = 'leitura'), 'sem_permissao',
  'papel leitura recebe sem_permissao');
select is(pg_temp.lotes(937), 0::bigint,
  'a recusa por permissão não abriu lote nenhum');


-- =====================================================================
-- 2. As recusas de configuração, todas antes de escrever
-- =====================================================================
select pg_temp.pedir('inexistente', 'a0000000-0000-4000-8000-0000000037a1', 'sdr', 9999);
select pg_temp.pedir('desligada',   'a0000000-0000-4000-8000-0000000037a1', 'sdr', 940);
select pg_temp.pedir('coletor_off', 'a0000000-0000-4000-8000-0000000037a1', 'sdr', 938);
select pg_temp.pedir('sem_cat',     'a0000000-0000-4000-8000-0000000037a1', 'sdr', 939);
select pg_temp.pedir('cat_errada',  'a0000000-0000-4000-8000-0000000037a1', 'sdr', 937, array['c37-nao-existe']);

select is((select valor ->> 'motivo' from pg_temp.r where chave = 'inexistente'), 'origem_invalida',
  'id que não existe recebe origem_invalida');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'desligada'), 'origem_desabilitada',
  'fonte desligada recebe origem_desabilitada');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'coletor_off'), 'coletor_desligado',
  'fonte ligada com coletor desligado recebe coletor_desligado');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'sem_cat'), 'sem_catalogo',
  'coletor ligado sem catálogo recebe sem_catalogo');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'cat_errada'), 'categoria_fora_do_catalogo',
  'categoria fora do catálogo é recusada aqui, não no worker');
select is((select valor -> 'faltando' from pg_temp.r where chave = 'cat_errada'), '["c37-nao-existe"]'::jsonb,
  'a recusa diz QUAL categoria não existe');
select is((select valor -> 'disponiveis' from pg_temp.r where chave = 'cat_errada'),
  '["c37-alfa","c37-beta"]'::jsonb,
  'a recusa devolve o catálogo, para a pessoa escolher sem sair da tela');

select is(pg_temp.lotes(937) + pg_temp.lotes(938) + pg_temp.lotes(939) + pg_temp.lotes(940), 0::bigint,
  'NENHUMA das cinco recusas abriu lote: toda checagem acontece antes de escrever');


-- =====================================================================
-- 3. O caminho feliz: lote e job entram juntos
-- =====================================================================
select pg_temp.pedir('ok', 'a0000000-0000-4000-8000-0000000037a1', 'sdr', 937, array['c37-alfa'], 3);

select ok((select (valor ->> 'ok')::boolean from pg_temp.r where chave = 'ok'),
  'sdr consegue pedir coleta de fonte configurada');
select is(pg_temp.lotes(937), 1::bigint,
  'o pedido abriu exatamente um lote');
select is(
  (select status from public.import_batches
    where id = (select (valor ->> 'batch_id')::uuid from pg_temp.r where chave = 'ok')),
  'na_fila',
  'o lote de coleta nasce em na_fila, e não em previa: coleta não tem prévia');
select is(
  pg_temp.na_fila((select (valor ->> 'batch_id')::uuid from pg_temp.r where chave = 'ok')),
  1::bigint,
  'o job entrou na fila ingest_jobs com msg_id, na mesma transação do lote');
select is(
  (select params -> 'categorias' from public.import_batches
    where id = (select (valor ->> 'batch_id')::uuid from pg_temp.r where chave = 'ok')),
  '["c37-alfa"]'::jsonb,
  'a categoria pedida ficou gravada no lote');
select is(
  (select params ->> 'max_paginas' from public.import_batches
    where id = (select (valor ->> 'batch_id')::uuid from pg_temp.r where chave = 'ok')),
  '3',
  'o teto de páginas pedido ficou gravado no lote');
select is((select valor ->> 'coletor_de_pe' from pg_temp.r where chave = 'ok'), 'false',
  'a resposta diz que o coletor está parado: o pedido entrou, os dados não chegaram');


-- =====================================================================
-- 4. Duas coletas na mesma fonte ao mesmo tempo, não
-- =====================================================================
-- O limite por fonte do R03 é por FONTE, não por pedido: duas corridas
-- simultâneas dobram o tráfego contra um limite que o robots.txt já fixou.
select pg_temp.pedir('repetida', 'a0000000-0000-4000-8000-0000000037a1', 'sdr', 937, array['c37-beta']);

select is((select valor ->> 'motivo' from pg_temp.r where chave = 'repetida'), 'ja_rodando',
  'segunda coleta da mesma fonte com uma em andamento recebe ja_rodando');
select is(pg_temp.lotes(937), 1::bigint,
  'a recusa por ja_rodando não abriu um segundo lote');
select is(
  (select valor ->> 'batch_id' from pg_temp.r where chave = 'repetida'),
  (select valor ->> 'batch_id' from pg_temp.r where chave = 'ok'),
  'a recusa aponta o lote que já está rodando, para a pessoa ir olhar');


-- =====================================================================
-- 5. Sem categoria pedida, o lote é o catálogo inteiro
-- =====================================================================
update public.import_batches set status = 'concluido'
 where source_id = 937 and kind = 'coleta';

select pg_temp.pedir('tudo', 'a0000000-0000-4000-8000-0000000037a1', 'sdr', 937);

select is((select valor -> 'categorias' from pg_temp.r where chave = 'tudo'),
  '["c37-alfa","c37-beta"]'::jsonb,
  'sem categoria pedida, a resposta lista o catálogo inteiro que vai ser coberto');
select is(
  (select params -> 'categorias' from public.import_batches
    where id = (select (valor ->> 'batch_id')::uuid from pg_temp.r where chave = 'tudo')),
  'null'::jsonb,
  'e o lote grava categorias nulo, que é como o worker entende "tudo"');

select * from finish();
rollback;

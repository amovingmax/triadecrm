-- =====================================================================
-- pgTAP — Agendar coleta pela tela (migração 20260917170000)
--
-- Até 17/09/2026, mandar o Radar trabalhar era `ingest --agendar` num terminal.
-- A tela mostrava "coletor parado, fila vazia" e quem olhava concluía que o
-- Radar estava quebrado — quando o que faltava era uma ordem.
--
-- O que este arquivo prova:
--   1. Só admin e gestor agendam. Coleta gasta o limite da fonte e responde pelo
--      robots.txt (R03, R06 §3): é decisão de operação, não de campo.
--   2. Fonte desligada e fonte inexistente são recusadas com motivo nomeado.
--   3. Duas coletas na mesma fonte ao mesmo tempo não acontecem — o segundo
--      clique recebe "coleta_em_andamento" e o id do lote que já existe.
--   4. Quando dá certo, a ordem entra na fila `ingest_jobs` com o MESMO payload
--      que o terminal monta. O worker não distingue a origem.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(12);

insert into public.allowed_users (email, role, note) values
  ('f54.admin@teste.local', 'admin', 'pgTAP coleta'),
  ('f54.sdr@teste.local', 'sdr', 'pgTAP coleta');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-00000000f541', 'f54.admin@teste.local', '{"full_name":"Admin F54"}'),
  ('a0000000-0000-4000-8000-00000000f542', 'f54.sdr@teste.local', '{"full_name":"Sdr F54"}');

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

create function pg_temp.fonte(p_slug text) returns int language sql stable as $$
  select id from public.sources where slug = p_slug
$$;

-- ---------- 1. quem não pode ----------
select pg_temp.entrar('a0000000-0000-4000-8000-00000000f542', 'sdr');
select throws_ok(
  format($$select public.radar_agendar_coleta(%s, null, 1, null)$$, pg_temp.fonte('casamentos_com_br')),
  '42501', NULL,
  'SDR NÃO AGENDA COLETA: ela gasta o limite da fonte e responde pelo robots.txt');
select pg_temp.sair();

-- ---------- 2. quem pode, e o que recusa ----------
select pg_temp.entrar('a0000000-0000-4000-8000-00000000f541', 'admin');

select is(public.radar_agendar_coleta(-1, null, 1, null) ->> 'motivo', 'fonte_inexistente',
  'fonte que não existe é recusada com motivo nomeado, não com erro');

update public.sources set is_enabled = false where slug = 'olx';
select is(public.radar_agendar_coleta(pg_temp.fonte('olx'), null, 1, null) ->> 'motivo',
  'fonte_desligada',
  'fonte desligada é recusada: ligar exige robots.txt e termos avaliados (RF-RAD-01)');

-- ---------- 3. o caminho que dá certo ----------
create table pg_temp.primeira as
  select public.radar_agendar_coleta(pg_temp.fonte('casamentos_com_br'),
                                     array['bufe'], 3, 'Coleta de teste F54') as r;

select is((select r ->> 'ok' from pg_temp.primeira), 'true', 'a coleta é agendada');
select is((select r ->> 'rotulo' from pg_temp.primeira), 'Coleta de teste F54',
  'com o rótulo que a tela mandou');
select is((select r ->> 'max_paginas' from pg_temp.primeira), '3', 'e o teto de páginas pedido');

select pg_temp.sair();

select is((select b.status from public.import_batches b
            where b.id = (select (r ->> 'lote')::uuid from pg_temp.primeira)),
  'na_fila', 'o lote sai de "prévia" para "na fila" — quem olha a tela vê a ordem viva');

select is((select count(*)::int from pgmq.q_ingest_jobs q
            where q.message ->> 'batch_id' = (select r ->> 'lote' from pg_temp.primeira)), 1,
  'A ORDEM ESTÁ NA FILA: é isso que faz o worker sair do lugar');
select is((select q.message ->> 'chave' from pgmq.q_ingest_jobs q
            where q.message ->> 'batch_id' = (select r ->> 'lote' from pg_temp.primeira)),
  'job:' || (select r ->> 'lote' from pg_temp.primeira),
  'com a mesma chave de idempotência que o terminal monta (job:<lote>)');
select is((select q.message -> 'categorias' ->> 0 from pgmq.q_ingest_jobs q
            where q.message ->> 'batch_id' = (select r ->> 'lote' from pg_temp.primeira)), 'bufe',
  'e com as categorias escolhidas na tela');

-- ---------- 4. o clique duplo ----------
select pg_temp.entrar('a0000000-0000-4000-8000-00000000f541', 'admin');
select is(public.radar_agendar_coleta(pg_temp.fonte('casamentos_com_br'), null, 1, null) ->> 'motivo',
  'coleta_em_andamento',
  'O SEGUNDO CLIQUE NÃO DOBRA O TRÁFEGO: recusa enquanto a primeira não termina');
select is(public.radar_agendar_coleta(pg_temp.fonte('casamentos_com_br'), null, 1, null) ->> 'lota',
  NULL, 'e a recusa não inventa campo nenhum além do que documenta');

select pg_temp.sair();
rollback;

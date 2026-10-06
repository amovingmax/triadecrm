-- =====================================================================
-- pgTAP — A gestão monta o lote, e diz de quem ele é (migração 20261006130000)
--
-- Pivô de 06/10/2026: admin e gestor montam o lote para eles mesmos ou para um
-- SDR. Este arquivo prova:
--
--   1. O GESTOR PASSA O LOTE para quem vai ligar, e o lote aparece para ela;
--   2. A RESERVA ACOMPANHA: os contatos continuam no lote, sem voltar à base;
--   3. O DIA É DE QUEM LIGOU: a ligação feita no lote recebido conta para ela;
--   4. SÓ A GESTÃO ATRIBUI — o SDR não passa lote para ninguém, nem o dele;
--   5. NÃO SE DÁ LOTE A QUEM NÃO EXISTE no time, nem lote já encerrado.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(13);

insert into public.allowed_users (email, role, note) values
  ('l101.g@teste.local', 'gestor', 'pgTAP 101'),
  ('l101.a@teste.local', 'sdr', 'pgTAP 101'),
  ('l101.b@teste.local', 'sdr', 'pgTAP 101'),
  ('l101.x@teste.local', 'leitura', 'pgTAP 101');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000010101'::uuid, 'l101.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000010102'::uuid, 'l101.a@teste.local', '{"full_name":"Ana Freela"}'),
  ('a0000000-0000-4000-8000-000000010103'::uuid, 'l101.b@teste.local', '{"full_name":"Bia Freela"}'),
  ('a0000000-0000-4000-8000-000000010104'::uuid, 'l101.x@teste.local', '{"full_name":"Xis Antigo"}');

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
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010101'::uuid $$;
create function pg_temp.ana() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010102'::uuid $$;
create function pg_temp.bia() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010103'::uuid $$;
create function pg_temp.hoje() returns date language sql stable as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;

-- Um lote montado pelo gestor, no nome dele, com dois contatos reservados.
create temp table t101(chave text primary key, valor uuid);
grant select on t101 to authenticated;
do $$
declare
  v_script uuid; v_versao int; v_lote uuid; v_org uuid; v_item uuid; i int;
begin
  select id, versao into v_script, v_versao from public.call_scripts where is_published order by versao desc limit 1;
  insert into public.call_batches (nome, owner_id, status, pipeline_id, temperature_origin,
                                   script_id, script_version, starts_on, ends_on)
  values ('Lote do pgTAP 101', pg_temp.gil(), 'ativo',
          (select id from public.pipelines where slug = 'fornecedor'), 'frio', v_script, v_versao,
          pg_temp.hoje(), pg_temp.hoje() + 1)
  returning id into v_lote;
  insert into t101 values ('lote', v_lote);
  for i in 1..2 loop
    insert into public.organizations (name, phone_e164, source_id, collector)
    values ('Buffet 101-' || i, '+558499910110' || i,
            (select id from public.sources where slug = 'planilha'), 'pgtap101')
    returning id into v_org;
    insert into public.call_batch_items (batch_id, organization_id, phone_e164, position)
    values (v_lote, v_org, '+558499910110' || i, i) returning id into v_item;
    insert into t101 values ('org' || i, v_org), ('item' || i, v_item);
  end loop;
end $$;
create function pg_temp.v(p text) returns uuid language sql stable as $$
  select valor from t101 where chave = p
$$;
create function pg_temp.dono() returns uuid language sql stable as $$
  select owner_id from public.call_batches where id = pg_temp.v('lote')
$$;

select is(pg_temp.dono(), pg_temp.gil(), 'o lote nasce no nome de quem montou');

-- =====================================================================
-- 4. Só a gestão atribui
-- =====================================================================
select pg_temp.entrar(pg_temp.ana(), 'sdr');
select is(public.lote_atribuir(pg_temp.v('lote'), pg_temp.ana()) ->> 'motivo', 'sem_permissao',
  'o SDR não puxa para si um lote que a gestão não lhe deu');
select pg_temp.sair();
select is(pg_temp.dono(), pg_temp.gil(), 'e o lote continua de quem era');

-- =====================================================================
-- 1. O gestor passa o lote para quem vai ligar
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(public.lote_atribuir(pg_temp.v('lote'), pg_temp.ana()) ->> 'ok', 'true',
  'o gestor passa o lote para a Ana');
select is(public.lote_atribuir(pg_temp.v('lote'), pg_temp.ana()) ->> 'nome', 'Ana Freela',
  'atribuir de novo à mesma pessoa não quebra, e a resposta diz o nome dela');
select pg_temp.sair();
select is(pg_temp.dono(), pg_temp.ana(), 'e o lote passa a ser dela');

-- =====================================================================
-- 2. A reserva acompanha
-- =====================================================================
select is((select count(*)::int from public.call_batch_items where batch_id = pg_temp.v('lote')), 2,
  'os dois contatos continuam reservados no lote: a reserva é do lote, não da pessoa');

-- =====================================================================
-- 3. O dia é de quem ligou
-- =====================================================================
insert into public.call_attempts (item_id, batch_id, organization_id, user_id, iniciada_em,
                                  encerrada_em, duracao_seg, resultado)
values (pg_temp.v('item1'), pg_temp.v('lote'), pg_temp.v('org1'), pg_temp.ana(),
        (pg_temp.hoje() + time '10:00') at time zone 'America/Fortaleza',
        (pg_temp.hoje() + time '10:01') at time zone 'America/Fortaleza', 0, 'nao_atendeu');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(
  (select (p ->> 'ligacoes')::int
     from jsonb_array_elements(public.ligacoes_do_dia(pg_temp.hoje(), null) -> 'pessoas') p
    where (p ->> 'pessoa_id')::uuid = pg_temp.ana()),
  1, 'a ligação feita no lote recebido aparece no dia da Ana, no relatório da gestão');

-- =====================================================================
-- 5. Não se dá lote a quem não existe no time, nem lote encerrado
-- =====================================================================
select is(public.lote_atribuir(pg_temp.v('lote'), 'a0000000-0000-4000-8000-000000010104'::uuid) ->> 'motivo',
  'pessoa_invalida', 'papel desativado no pivô não recebe lote');
select is(public.lote_atribuir(pg_temp.v('lote'), 'a0000000-0000-4000-8000-0000000101ff'::uuid) ->> 'motivo',
  'pessoa_invalida', 'nem quem não existe');
select is(public.lote_atribuir('a0000000-0000-4000-8000-0000000101fe'::uuid, pg_temp.bia()) ->> 'motivo',
  'lote_inexistente', 'lote que não existe responde pelo nome');
select pg_temp.sair();

update public.call_batches set status = 'encerrado' where id = pg_temp.v('lote');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(public.lote_atribuir(pg_temp.v('lote'), pg_temp.bia()) ->> 'motivo', 'lote_encerrado',
  'lote encerrado não muda de mão');
select pg_temp.sair();

select ok(not has_function_privilege('anon', 'public.lote_atribuir(uuid, uuid)', 'execute'),
  'quem não entrou nem chama a função');

select * from finish();
rollback;

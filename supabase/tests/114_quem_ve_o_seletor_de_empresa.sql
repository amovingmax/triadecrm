-- =====================================================================
-- pgTAP — Quem vê o botão de trocar de empresa
--         (migração 20261022110000_quem_ve_o_seletor_de_empresa.sql)
--
--   1. a marcação mora em `public.acesso_a_outras_empresas`, com RLS;
--   2. só admin marca e desmarca; gestor e SDR não;
--   3. a própria empresa do banco não pode ser marcada;
--   4. cada pessoa lê só a sua marcação (`public.minhas_outras_empresas()`),
--      e o admin lê a de todos;
--   5. marcar e desmarcar ficam na auditoria; não existe UPDATE.
--
-- Funciona em qualquer banco com identidade (a "outra" empresa é a que não é
-- a deste banco). Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(16);

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
-- A empresa deste banco e "a outra".
create function pg_temp.esta() returns text language sql as $$ select public.empresa_do_banco() $$;
create function pg_temp.outra() returns text language sql as $$
  select case public.empresa_do_banco() when 'komune' then 'imova' else 'komune' end
$$;

insert into public.allowed_users (email, role, note) values
  ('admin.sel@teste.local',  'admin',  'pgTAP'),
  ('gestor.sel@teste.local', 'gestor', 'pgTAP'),
  ('sdr.sel@teste.local',    'sdr',    'pgTAP');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000001141', 'admin.sel@teste.local',  '{"full_name":"Admin Sel"}'),
  ('a0000000-0000-4000-8000-000000001142', 'gestor.sel@teste.local', '{"full_name":"Gestor Sel"}'),
  ('a0000000-0000-4000-8000-000000001143', 'sdr.sel@teste.local',    '{"full_name":"SDR Sel"}');

select has_table('public', 'acesso_a_outras_empresas', 'a marcação tem a sua tabela');
select is((select relrowsecurity from pg_class where oid = 'public.acesso_a_outras_empresas'::regclass), true,
          'a tabela tem RLS');
select isnt(pg_temp.esta(), null, 'o banco do teste tem identidade');

-- 2. Só admin marca.
select pg_temp.entrar('a0000000-0000-4000-8000-000000001142', 'gestor');
select throws_ok(
  format($$insert into public.acesso_a_outras_empresas (user_id, empresa)
           values ('a0000000-0000-4000-8000-000000001142', %L)$$, pg_temp.outra()),
  '42501', null, 'gestor não marca nem a si mesmo');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000001141', 'admin');
select lives_ok(
  format($$insert into public.acesso_a_outras_empresas (user_id, empresa)
           values ('a0000000-0000-4000-8000-000000001142', %L)$$, pg_temp.outra()),
  'admin marca o gestor na outra empresa');
-- 3. A própria empresa não.
select throws_ok(
  format($$insert into public.acesso_a_outras_empresas (user_id, empresa)
           values ('a0000000-0000-4000-8000-000000001143', %L)$$, pg_temp.esta()),
  '23514', null, 'a empresa deste banco não pode ser marcada');
select is((select count(*)::int from public.acesso_a_outras_empresas
            where user_id in ('a0000000-0000-4000-8000-000000001142', 'a0000000-0000-4000-8000-000000001143')),
          1, 'o admin vê a marcação dos outros');
-- 5. Não existe UPDATE.
select throws_ok(
  $$update public.acesso_a_outras_empresas set empresa = 'outra-qualquer'
     where user_id = 'a0000000-0000-4000-8000-000000001142'$$,
  '42501', null, 'marcação não se edita: desmarca e marca de novo');
select pg_temp.sair();

-- 4. Cada um lê a sua.
select pg_temp.entrar('a0000000-0000-4000-8000-000000001142', 'gestor');
select is(public.minhas_outras_empresas(), array[pg_temp.outra()], 'o gestor marcado vê a outra empresa');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000001143', 'sdr');
select is(public.minhas_outras_empresas(), '{}'::text[], 'a SDR sem marcação não vê nenhuma');
select is((select count(*)::int from public.acesso_a_outras_empresas), 0,
          'a SDR não enxerga a marcação dos outros');
select lives_ok($$delete from public.acesso_a_outras_empresas$$, 'a SDR tenta desmarcar...');
select pg_temp.sair();
select is((select count(*)::int from public.acesso_a_outras_empresas
            where user_id = 'a0000000-0000-4000-8000-000000001142'),
          1, '...e nada some: só admin desmarca');

-- Admin desmarca.
select pg_temp.entrar('a0000000-0000-4000-8000-000000001141', 'admin');
delete from public.acesso_a_outras_empresas where user_id = 'a0000000-0000-4000-8000-000000001142';
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000001142', 'gestor');
select is(public.minhas_outras_empresas(), '{}'::text[], 'desmarcado, o botão some para o gestor');
select pg_temp.sair();

select is((select count(*)::int from public.audit_log
            where table_name = 'acesso_a_outras_empresas'
              and actor_id = 'a0000000-0000-4000-8000-000000001141'
              and action in ('INSERT', 'DELETE')),
          2, 'marcar e desmarcar ficam na auditoria, com quem fez');

set local role anon;
select throws_ok($$select public.minhas_outras_empresas()$$, '42501', null,
                 'anônimo não pergunta nada');
reset role;

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — O perfil na lista de Prospectados (migração 20261123210000)
--
-- Prova:
--   1. sem `p_perfil`, a busca é a de antes (ninguém some);
--   2. cliente = sem a marca; parceiro = com ela (qualquer tag);
--   3. cada tag acha só os seus;
--   4. o perfil soma com a busca de texto e devolve o total certo;
--   5. valor desconhecido é recusado (22023);
--   6. só existe uma `search_organizations`.
--
-- Roda nas duas empresas (a tabela e a coluna existem nas duas). Em
-- transação, desfaz tudo.
-- =====================================================================
begin;

select plan(14);

insert into public.allowed_users (email, role, note) values ('g200@teste.local', 'gestor', 'pgTAP 200');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000020001'::uuid, 'g200@teste.local', '{"full_name":"Gil Gestor"}');

create function pg_temp.entrar() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'a0000000-0000-4000-8000-000000020001', 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', 'gestor'))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.o(n int) returns uuid language sql immutable as $$
  select ('c0000000-0000-4000-8000-0000000200' || lpad(n::text, 2, '0'))::uuid
$$;

-- Cinco fichas com o mesmo começo de nome, para a busca isolar só elas:
-- 1 Cliente; 2 Proprietário; 3 Colaborador; 4 Inquilino; 5 Cliente.
insert into public.organizations (id, name, phone_e164, source_id, owner_id)
select pg_temp.o(n), 'Zeferina Perfil ' || n, '+55849888200' || lpad(n::text, 2, '0'),
       (select id from public.sources where slug = 'captura_campo'),
       'a0000000-0000-4000-8000-000000020001'::uuid
  from generate_series(1, 5) n;
insert into public.consultoria (organization_id, tipo) values
  (pg_temp.o(2), 'proprietario'), (pg_temp.o(3), 'colaborador'), (pg_temp.o(4), 'inquilino');

create function pg_temp.achados(p_perfil text) returns text language sql as $$
  select string_agg(right(s.name, 1), ',' order by s.name)
    from public.search_organizations(q => 'Zeferina Perfil', p_limit => 50, p_perfil => p_perfil) s
$$;

select pg_temp.entrar();
select is(pg_temp.achados(null), '1,2,3,4,5', 'sem perfil, a busca acha os cinco, como antes');
select is(pg_temp.achados('cliente'), '1,5', 'Clientes: quem não tem a marca');
select is(pg_temp.achados('parceiro'), '2,3,4', 'Parceiros: quem tem a marca, qualquer tag');
select is(pg_temp.achados('proprietario'), '2', 'Proprietários');
select is(pg_temp.achados('colaborador'), '3', 'Colaboradores');
select is(pg_temp.achados('inquilino'), '4', 'Inquilinos');
select is(pg_temp.achados('  '), '1,2,3,4,5', 'perfil em branco é sem filtro');
select is((select total_count from public.search_organizations(
             q => 'Zeferina Perfil', p_limit => 1, p_perfil => 'parceiro') limit 1),
          3::bigint, 'o total conta só o perfil pedido, mesmo com a página de 1');
select is((select string_agg(right(s.name, 1), ',' order by s.name)
             from public.search_organizations(
                    q => 'Zeferina Perfil', p_perfil => 'parceiro',
                    p_owner_id => 'a0000000-0000-4000-8000-000000020001'::uuid) s),
          '2,3,4', 'o perfil soma com os outros filtros (responsável)');
select pg_temp.sair();

select pg_temp.entrar();
select throws_ok($$ select * from public.search_organizations(p_perfil => 'comprador') $$,
                 '22023', null, 'comprador não é perfil');
select pg_temp.sair();
select pg_temp.entrar();
select throws_ok($$ select * from public.search_organizations(p_perfil => 'outro') $$,
                 '22023', null, 'outro também não');
select pg_temp.sair();

-- Uma ficha que vira Parceiro some de Clientes na hora.
insert into public.consultoria (organization_id, tipo) values (pg_temp.o(5), 'inquilino');
select pg_temp.entrar();
select is(pg_temp.achados('cliente'), '1', 'o 5 virou Inquilino e saiu de Clientes');
select is(pg_temp.achados('inquilino'), '4,5', 'e entrou em Inquilinos');
select pg_temp.sair();

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'search_organizations'),
          1, 'só existe uma search_organizations');

select * from finish();
rollback;

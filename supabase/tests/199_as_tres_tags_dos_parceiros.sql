-- =====================================================================
-- pgTAP — As três tags dos Parceiros da Imova (migração 20261123200000)
--
-- Prova:
--   1. a coluna só aceita proprietario, colaborador e inquilino;
--   2. `parceiro_mudar` exige a tag e recusa comprador e outro;
--   3. `parceiros_marcar` põe vários de uma vez com a tag, troca a tag de
--      quem já é (sem mexer em "desde", "por" e imóvel) e não conta quem já
--      tinha a mesma tag;
--   4. `parceiros_marcar` recusa sem tag, tag errada, lista vazia, mais de
--      200 e quem não está logado;
--   5. `consultoria_marcar` não põe mais Parceiro sem tag, mas ainda tira;
--   6. tudo vai para o audit_log.
--
-- Só na Imova. Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'pgTAP 199 é da Imova: rode no banco local da Imova';
  end if;
end $$;

select plan(24);

insert into public.allowed_users (email, role, note) values ('g199@teste.local', 'gestor', 'pgTAP 199');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000019901'::uuid, 'g199@teste.local', '{"full_name":"Gil Gestor"}');

create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000019901'::uuid $$;
create function pg_temp.entrar() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.gil(), 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', 'gestor'))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.o(n int) returns uuid language sql immutable as $$
  select ('c0000000-0000-4000-8000-0000000199' || lpad(n::text, 2, '0'))::uuid
$$;
create function pg_temp.tag(n int) returns text language sql stable as $$
  select tipo from public.consultoria where organization_id = pg_temp.o(n)
$$;

insert into public.organizations (id, name, phone_e164, source_id, owner_id)
select pg_temp.o(n), 'Contato ' || n, '+55849888199' || lpad(n::text, 2, '0'),
       (select id from public.sources where slug = 'captura_campo'), pg_temp.gil()
  from generate_series(1, 5) n;

-- ---------------------------------------------------------------------
-- 1. A coluna
-- ---------------------------------------------------------------------
select throws_ok($$ insert into public.consultoria (organization_id, tipo)
                    values ('c0000000-0000-4000-8000-000000019901', 'comprador') $$,
                 '23514', null, 'a coluna não aceita mais comprador');
select throws_ok($$ insert into public.consultoria (organization_id, tipo)
                    values ('c0000000-0000-4000-8000-000000019901', 'outro') $$,
                 '23514', null, 'nem outro');
select lives_ok($$ insert into public.consultoria (organization_id, tipo)
                   values ('c0000000-0000-4000-8000-000000019901', 'colaborador');
                   delete from public.consultoria
                    where organization_id = 'c0000000-0000-4000-8000-000000019901' $$,
                'e aceita colaborador');

-- ---------------------------------------------------------------------
-- 2. Um de cada vez: a tag é obrigatória
-- ---------------------------------------------------------------------
select pg_temp.entrar();
select is(public.parceiro_mudar(pg_temp.o(1), true, null, null) ->> 'motivo', 'falta_a_tag',
          'sem tag não vira Parceiro');
select is(public.parceiro_mudar(pg_temp.o(1), true, '  ', null) ->> 'motivo', 'falta_a_tag',
          'tag em branco também não');
select is(public.parceiro_mudar(pg_temp.o(1), true, 'comprador', null) ->> 'motivo', 'tipo_invalido',
          'comprador saiu da lista');
select is(public.parceiro_mudar(pg_temp.o(1), true, 'outro', null) ->> 'motivo', 'tipo_invalido',
          'outro também');
select is((public.parceiro_mudar(pg_temp.o(1), true, 'colaborador', null) ->> 'ok')::boolean, true,
          'colaborador é aceito');
select pg_temp.sair();
select is(pg_temp.tag(1), 'colaborador', 'e fica gravado');

-- ---------------------------------------------------------------------
-- 3. Vários de uma vez
-- ---------------------------------------------------------------------
-- O 1 já é colaborador; o 2 é inquilino com imóvel guardado; 3 e 4 são Clientes.
insert into public.anuncios (codigo, titulo) values ('PGT199', 'Casa de teste');
insert into public.consultoria (organization_id, por, tipo, anuncio_id, desde)
values (pg_temp.o(2), pg_temp.gil(), 'inquilino', (select id from public.anuncios where codigo = 'PGT199'),
        now() - interval '10 days');

select pg_temp.entrar();
select is((public.parceiros_marcar(array[pg_temp.o(1), pg_temp.o(2), pg_temp.o(3), pg_temp.o(4), pg_temp.o(3)],
                                   'colaborador') ->> 'mudaram')::int, 3,
          'quatro contatos com Colaborador: mudam três (o 1 já era colaborador; repetido conta uma vez)');
select pg_temp.sair();
select is(array[pg_temp.tag(1), pg_temp.tag(2), pg_temp.tag(3), pg_temp.tag(4)],
          array['colaborador', 'colaborador', 'colaborador', 'colaborador'], 'os quatro são Colaboradores');
select is(pg_temp.tag(5), null, 'quem não foi escolhido continua Cliente');
select ok((select anuncio_id is not null and desde < now() - interval '9 days'
             from public.consultoria where organization_id = pg_temp.o(2)),
          'quem já era Parceiro troca só a tag: o imóvel e "desde" ficam');
select is((select por from public.consultoria where organization_id = pg_temp.o(3)), pg_temp.gil(),
          'quem virou Parceiro guarda quem mudou');

-- ---------------------------------------------------------------------
-- 4. Recusas de vários de uma vez
-- ---------------------------------------------------------------------
select pg_temp.entrar();
select is(public.parceiros_marcar(array[pg_temp.o(5)], null) ->> 'motivo', 'falta_a_tag',
          'sem tag é recusado');
select is(public.parceiros_marcar(array[pg_temp.o(5)], 'comprador') ->> 'motivo', 'tipo_invalido',
          'tag fora das três é recusada');
select is(public.parceiros_marcar('{}'::uuid[], 'inquilino') ->> 'motivo', 'nada_escolhido',
          'lista vazia é recusada');
select is(public.parceiros_marcar(array(select gen_random_uuid() from generate_series(1, 201)), 'inquilino')
            ->> 'motivo', 'muitos_de_uma_vez', 'mais de 200 é recusado');
select pg_temp.sair();
select is(pg_temp.tag(5), null, 'nenhuma recusa gravou marca');
select throws_ok($$ select public.parceiros_marcar(array['c0000000-0000-4000-8000-000000019905'::uuid], 'inquilino') $$,
                 '42501', null, 'sem login, a função recusa');

-- ---------------------------------------------------------------------
-- 5. O botão antigo: tirar sim, pôr sem tag não
-- ---------------------------------------------------------------------
select pg_temp.entrar();
select is(public.consultoria_marcar(array[pg_temp.o(5)], true) ->> 'motivo', 'falta_a_tag',
          'consultoria_marcar não põe Parceiro sem tag');
select is((public.consultoria_marcar(array[pg_temp.o(3), pg_temp.o(4)], false) ->> 'mudaram')::int, 2,
          'mas ainda volta contatos para Clientes');
select pg_temp.sair();
select is((select count(*)::int from public.consultoria
            where organization_id in (pg_temp.o(3), pg_temp.o(4), pg_temp.o(5))), 0,
          'o 3 e o 4 voltaram para Clientes, e o 5 continua Cliente');

-- ---------------------------------------------------------------------
-- 6. O registro
-- ---------------------------------------------------------------------
select is((select new_data ->> 'tipo' from public.audit_log
            where action = 'PARCEIROS_MARCADOS' and actor_id = pg_temp.gil()),
          'colaborador', 'vários de uma vez ficou no audit_log, com a tag');

select * from finish();
rollback;

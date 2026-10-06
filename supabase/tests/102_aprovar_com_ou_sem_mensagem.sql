-- =====================================================================
-- pgTAP — Aprovar com mensagem, ou só aprovar (migração 20261006140000)
--
-- Pivô de 06/10/2026: a Revisão tem dois botões. Este arquivo prova:
--
--   1. SÓ APROVAR NÃO MANDA NADA: a ficha nasce e não entra na fila do
--      cumprimento — nem com a chave ligada, nem vindo do Google;
--   2. APROVAR COM MENSAGEM ENFILEIRA, na mesma transação, e a resposta diz
--      quantas entraram;
--   3. O DISJUNTOR GERAL MANDA: com a chave desligada o botão aprova e avisa
--      que a mensagem está desligada, em vez de fingir que mandou;
--   4. EM LOTE É A MESMA REGRA, e a conta é do lote inteiro;
--   5. A MENSAGEM É DA GESTÃO: SDR não aprova com mensagem; e só ao APROVAR —
--      recusar "com mensagem" não existe;
--   6. FORA DA REVISÃO NINGUÉM RECEBE SOZINHO: ficha criada por outro caminho
--      não entra na fila.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(18);

insert into public.allowed_users (email, role, note) values
  ('m102.g@teste.local', 'gestor', 'pgTAP 102'),
  ('m102.s@teste.local', 'sdr', 'pgTAP 102');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000010201'::uuid, 'm102.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000010202'::uuid, 'm102.s@teste.local', '{"full_name":"Sara Sdr"}');

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
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010201'::uuid $$;

-- O estado de partida: chave ligada, sem fila herdada de quem usou o banco antes.
update public.app_settings set value = value || '{"cumprimento_automatico": true}'::jsonb
 where key = 'atendimento';
update public.message_templates set meta_status = 'approved' where template_code like 'GEN-ABR-OLA-%';
delete from public.envios_em_massa_itens where envio_id in (select id from public.envios_em_massa where continuo);
delete from public.envios_em_massa where continuo;

insert into public.sources (id, slug, name, kind, base_url, legal_basis, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values (982, 'z102', 'Z102 Fonte (pgTAP)', 'import', 'https://exemplo102.test',
        'legitimo_interesse', false, 5.00, false, '{"entrada_por_arquivo": true}'::jsonb);

-- Seis candidatos com categoria, para aprovar ser um clique só.
create temp table c102(chave text primary key, id uuid not null);
grant select on c102 to authenticated;
with novos as (
  insert into public.supplier_candidates
    (source_id, external_id, collector, name, phone_e164, city_id, status, category_id)
  select 982, 'z102-' || k, 'pgTAP 102', 'CENTO E DOIS ' || upper(k), '+558498810200' || n, 1, 'novo',
         (select id from public.categories order by id limit 1)
    from (values ('a', 1), ('b', 2), ('c', 3), ('d', 4), ('e', 5), ('f', 6)) t(k, n)
  returning id, external_id
)
insert into c102(chave, id) select right(external_id, 1), id from novos;

create function pg_temp.cand(p text) returns uuid language sql stable as $$
  select id from c102 where chave = p
$$;
-- A ficha que nasceu de um candidato, pelo telefone dele (a aprovação o consome).
create function pg_temp.ficha(p_n int) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.organizations where phone_e164 = '+558498810200' || p_n and deleted_at is null
$$;
create function pg_temp.na_fila(p_org uuid) returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.envios_em_massa_itens where organization_id = p_org
$$;

create temp table r102(chave text primary key, valor jsonb);
grant select, insert on r102 to authenticated;
create function pg_temp.r(p text) returns jsonb language sql stable as $$
  select valor from r102 where chave = p
$$;

-- =====================================================================
-- 1. Só aprovar não manda nada
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into r102 values ('so', public.radar_revisar_candidato(pg_temp.cand('a'), 'aprovar'));
select pg_temp.sair();
select is(pg_temp.r('so') ->> 'ok', 'true', 'o botão "só aprovar" aprova');
select ok(pg_temp.ficha(1) is not null, 'a ficha nasce, e vai para Prospectados');
select is(pg_temp.na_fila(pg_temp.ficha(1)), 0,
  'e NÃO entra na fila do cumprimento, mesmo com a chave ligada: ninguém pediu');

-- =====================================================================
-- 2. Aprovar com mensagem enfileira
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into r102 values ('com', public.radar_revisar_candidato_com_mensagem(pg_temp.cand('b'), 'aprovar'));
select pg_temp.sair();
select is(pg_temp.r('com') ->> 'ok', 'true', 'o botão "aprovar e mandar mensagem" aprova');
select is(pg_temp.na_fila(pg_temp.ficha(2)), 1, 'e a ficha entra na fila do cumprimento, na mesma hora');
select is(pg_temp.r('com') -> 'mensagem' ->> 'na_fila', '1', 'a resposta diz que uma mensagem entrou na fila');
select is(pg_temp.r('com') -> 'mensagem' ->> 'ligada', 'true', 'e que o envio automático está ligado');

-- O pedido não vaza: a aprovação simples seguinte, na mesma sessão, não manda.
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select public.radar_revisar_candidato(pg_temp.cand('c'), 'aprovar') ->> 'ok';
select pg_temp.sair();
select is(pg_temp.na_fila(pg_temp.ficha(3)), 0,
  'o pedido vale só para aquela aprovação: a seguinte, sem mensagem, não enfileira');

-- =====================================================================
-- 4. Em lote é a mesma regra
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into r102 values ('lote', public.radar_revisar_lote_com_mensagem(array[pg_temp.cand('d'), pg_temp.cand('e')]));
select pg_temp.sair();
select is(pg_temp.r('lote') ->> 'aprovados', '2', 'o lote aprova os dois');
select is(pg_temp.r('lote') -> 'mensagem' ->> 'na_fila', '2', 'e as duas mensagens entram na fila');
select is(pg_temp.na_fila(pg_temp.ficha(4)) + pg_temp.na_fila(pg_temp.ficha(5)), 2,
  'uma por ficha: elas saem no ritmo da fila, não todas de uma vez');

-- =====================================================================
-- 3. O disjuntor geral manda
-- =====================================================================
update public.app_settings set value = value || '{"cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into r102 values ('desligada', public.radar_revisar_candidato_com_mensagem(pg_temp.cand('f'), 'aprovar'));
select pg_temp.sair();
select is(pg_temp.r('desligada') ->> 'ok', 'true', 'com a chave geral desligada, o botão ainda aprova');
select is(pg_temp.r('desligada') -> 'mensagem' ->> 'ligada', 'false',
  'mas AVISA que a mensagem está desligada, em vez de fingir que mandou');
select is(pg_temp.na_fila(pg_temp.ficha(6)), 0, 'e nada entra na fila');
update public.app_settings set value = value || '{"cumprimento_automatico": true}'::jsonb
 where key = 'atendimento';

-- =====================================================================
-- 5. A mensagem é da gestão, e só ao aprovar
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000010202'::uuid, 'sdr');
select is(public.radar_revisar_candidato_com_mensagem(gen_random_uuid(), 'aprovar') ->> 'reason',
  'sem_permissao', 'SDR não aprova com mensagem');
select is(public.radar_revisar_lote_com_mensagem(array[gen_random_uuid()]) ->> 'reason',
  'sem_permissao', 'nem em lote');
select pg_temp.sair();
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(public.radar_revisar_candidato_com_mensagem(gen_random_uuid(), 'recusar') ->> 'reason',
  'acao_invalida', 'recusar "com mensagem" não existe: mensagem só ao aprovar');
select pg_temp.sair();

-- =====================================================================
-- 6. Fora da Revisão ninguém recebe sozinho
-- =====================================================================
insert into public.organizations (name, phone_e164, source_id, collector, place_id)
values ('Ficha do Maps criada por fora', '+5584988102099',
        (select id from public.sources where slug = 'planilha'), 'pgtap102', '1020000000000000001');
select is(pg_temp.na_fila((select id from public.organizations where phone_e164 = '+5584988102099')), 0,
  'ficha do Google criada por outro caminho não entra na fila: até 06/10 entrava sozinha');

select * from finish();
rollback;

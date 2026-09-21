-- =====================================================================
-- pgTAP — Fase 1: atendimento em equipe (migração 20260922100000)
--
-- O que este arquivo prova:
--   1. OS SETORES nascem: Comercial, Suporte, Financeiro.
--   2. TODA CONVERSA TEM SETOR: nasce no Comercial; o menu automático a leva
--      ao setor da escolha ("pagamentos" → Financeiro).
--   3. TRANSFERIR PARA UMA PESSOA muda quem atende, guarda a nota e avisa quem
--      recebe com uma tarefa.
--   4. TRANSFERIR PARA UM SETOR entrega a quem tem menos conversas abertas; setor
--      sem ninguém muda o setor e deixa a conversa com quem está.
--   5. Quem só lê não transfere; transferir para o mesmo lugar não faz nada.
--   6. SÓ GESTOR diz quem é de qual setor.
-- =====================================================================
begin;
select plan(20);

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
create function pg_temp.p(p_n text) returns uuid language sql as $$
  select ('a0000000-0000-4000-8000-0000000059' || p_n)::uuid
$$;
create function pg_temp.setor(p_slug text) returns int language sql as $$
  select id from public.setores where slug = p_slug
$$;
create function pg_temp.conv(p_tel text) returns public.conversations
language sql security definer set search_path = '' as $$
  select * from public.conversations where peer_phone_e164 = p_tel
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;
grant execute on function pg_temp.conv(text) to authenticated;

insert into public.allowed_users (email, role, note) values
  ('f59.sdr@teste.local', 'sdr', 'pgTAP fase 1'),
  ('f59.gestor@teste.local', 'gestor', 'pgTAP fase 1'),
  ('f59.a@teste.local', 'sdr', 'pgTAP fase 1'),
  ('f59.b@teste.local', 'sdr', 'pgTAP fase 1'),
  ('f59.leitor@teste.local', 'leitura', 'pgTAP fase 1');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.p('01'), 'f59.sdr@teste.local', '{"full_name":"Sara Sdr"}'),
  (pg_temp.p('02'), 'f59.gestor@teste.local', '{"full_name":"Gil Gestor"}'),
  (pg_temp.p('03'), 'f59.a@teste.local', '{"full_name":"Ana Atende"}'),
  (pg_temp.p('04'), 'f59.b@teste.local', '{"full_name":"Bia Atende"}'),
  (pg_temp.p('05'), 'f59.leitor@teste.local', '{"full_name":"Leo Leitor"}');

-- O menu automático com as escolhas do jeito de produção.
update public.app_settings
   set value = jsonb_build_object('ativo', true, 'opcoes', jsonb_build_array(
                 jsonb_build_object('chave', '1', 'intencao', 'parceria'),
                 jsonb_build_object('chave', '3', 'intencao', 'financeiro'),
                 jsonb_build_object('chave', '4', 'intencao', 'suporte')))
 where key = 'whatsapp.bot_de_entrada';

insert into public.conversations (channel, business_number, peer_phone_e164, assignee_id, status)
values ('whatsapp', '+5584999995900', '+5584999995901', pg_temp.p('01'), 'aguardando_nos'),
       ('whatsapp', '+5584999995900', '+5584999995902', pg_temp.p('01'), 'aguardando_nos'),
       ('whatsapp', '+5584999995900', '+5584999995903', pg_temp.p('03'), 'aguardando_nos'),
       ('whatsapp', '+5584999995900', '+5584999995904', pg_temp.p('03'), 'aguardando_nos');

-- =====================================================================
-- 1 e 2. Setores e o setor da conversa
-- =====================================================================
select is((select array_agg(slug order by posicao) from public.setores),
          array['comercial', 'suporte', 'financeiro'], 'os três setores nascem');
select is((pg_temp.conv('+5584999995901')).setor_id, pg_temp.setor('comercial'),
          'toda conversa nasce no Comercial');
update public.conversations set bot_opcao = '3' where peer_phone_e164 = '+5584999995902';
select is((pg_temp.conv('+5584999995902')).setor_id, pg_temp.setor('financeiro'),
          'quem escolhe "pagamentos" no menu automático vai para o Financeiro');

-- =====================================================================
-- 3. Transferir para uma pessoa
-- =====================================================================
select pg_temp.entrar(pg_temp.p('05'), 'leitura');
select is(public.transferir_conversa((pg_temp.conv('+5584999995901')).id, pg_temp.p('02')) ->> 'motivo',
          'sem_permissao', 'quem só lê não transfere');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.p('01'), 'sdr');
insert into pg_temp.r values ('t1', public.transferir_conversa(
  (pg_temp.conv('+5584999995901')).id, pg_temp.p('02'), null, 'Quer falar de preço com o gestor'));
select pg_temp.sair();
select is(pg_temp.v('t1') ->> 'ok', 'true', 'quem atende transfere para uma pessoa');
select is((pg_temp.conv('+5584999995901')).assignee_id, pg_temp.p('02'), 'e ela passa a atender');
select is((select nota from public.conversa_transferencias
            where conversation_id = (pg_temp.conv('+5584999995901')).id),
          'Quer falar de preço com o gestor', 'a nota fica guardada com a transferência');
select ok(exists (select 1 from public.tasks
                   where assignee_id = pg_temp.p('02') and title like '%Quer falar de preço%'),
          'e quem recebe ganha uma tarefa, com a nota');

select pg_temp.entrar(pg_temp.p('02'), 'gestor');
select is(public.transferir_conversa((pg_temp.conv('+5584999995901')).id, pg_temp.p('02')) ->> 'motivo',
          'nada_mudou', 'transferir para quem já atende não faz nada');
select is(public.transferir_conversa((pg_temp.conv('+5584999995901')).id) ->> 'motivo',
          'sem_destino', 'transferir sem dizer para onde é recusado');
select pg_temp.sair();

-- =====================================================================
-- 4. Transferir para um setor
-- =====================================================================
-- Os setores começam vazios neste teste, seja qual for o estado do banco.
delete from public.setor_membros;
insert into public.setor_membros (setor_id, profile_id) values
  (pg_temp.setor('suporte'), pg_temp.p('03')),
  (pg_temp.setor('suporte'), pg_temp.p('04'));
select pg_temp.entrar(pg_temp.p('02'), 'gestor');
insert into pg_temp.r values ('t2', public.transferir_conversa(
  (pg_temp.conv('+5584999995901')).id, null, pg_temp.setor('suporte'), null));
select pg_temp.sair();
select is(pg_temp.v('t2') ->> 'setor', 'Suporte', 'a conversa vai para o Suporte');
select is((pg_temp.conv('+5584999995901')).assignee_id, pg_temp.p('04'),
          'e cai com quem tem menos conversas abertas no setor (a Bia, com zero; a Ana tem duas)');

select pg_temp.entrar(pg_temp.p('02'), 'gestor');
insert into pg_temp.r values ('t3', public.transferir_conversa(
  (pg_temp.conv('+5584999995902')).id, null, pg_temp.setor('comercial'), null));
select pg_temp.sair();
select is((pg_temp.conv('+5584999995902')).setor_id, pg_temp.setor('comercial'),
          'setor sem ninguém cadastrado: a conversa muda de setor');
select is((pg_temp.conv('+5584999995902')).assignee_id, pg_temp.p('01'),
          'e continua com quem estava');
select ok(not exists (select 1 from public.tasks where assignee_id = pg_temp.p('01')
                       and title like 'Conversa passada%'),
          'sem troca de pessoa, ninguém ganha tarefa');
select is((select count(*)::int from public.conversa_transferencias
            where conversation_id = (pg_temp.conv('+5584999995901')).id), 2,
          'o histórico guarda as duas transferências da conversa');

-- =====================================================================
-- 6. Quem é de qual setor
-- =====================================================================
select pg_temp.entrar(pg_temp.p('01'), 'sdr');
select is(public.definir_setores_da_pessoa(pg_temp.p('01'), array[pg_temp.setor('suporte')]) ->> 'motivo',
          'sem_permissao', 'SDR não muda setor de ninguém');
select pg_temp.sair();
select pg_temp.entrar(pg_temp.p('02'), 'gestor');
select is(public.definir_setores_da_pessoa(pg_temp.p('01'),
            array[pg_temp.setor('comercial'), pg_temp.setor('financeiro')]) ->> 'ok',
          'true', 'gestor põe a Sara no Comercial e no Financeiro');
select is(public.definir_setores_da_pessoa(pg_temp.p('01'), array[pg_temp.setor('financeiro')]) ->> 'ok',
          'true', 'e depois tira do Comercial');
select pg_temp.sair();
select is((select array_agg(s.slug order by s.slug) from public.setor_membros m
             join public.setores s on s.id = m.setor_id where m.profile_id = pg_temp.p('01')),
          array['financeiro'], 'a lista de setores dela é exatamente a escolhida');

select * from finish();
rollback;

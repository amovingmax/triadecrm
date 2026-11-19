-- =====================================================================
-- pgTAP — O e-mail do cliente (migração 20261118150000), nas duas empresas
--
-- Prova: o e-mail que o cliente escreve vai para a ficha sem e-mail; o cliente
-- corrigindo troca o que ele mesmo mandou; o que a equipe digitou não é trocado
-- (fica só a anotação); o mesmo e-mail de novo não anota nada; mensagem sem
-- e-mail e conversa sem ficha não mexem em nada nem recusam a mensagem; a IA
-- sabe se a ficha tem e-mail (sem o endereço) e se o cliente aceitou ou recusou
-- ofertas por e-mail; a resposta ao convite é idempotente e o "não" NÃO suprime
-- o contato; a tabela só se lê por quem tem acesso, só o worker grava e a linha
-- gravada não muda; o dossiê da LGPD traz o histórico.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(30);

insert into public.allowed_users (email, role, note) values
  ('g181@teste.local', 'gestor', 'pgTAP 185');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000018101'::uuid, 'g181@teste.local', '{"full_name":"Gil Gestor"}');

create function pg_temp.g() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000018101'::uuid $$;
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

-- Sem automações em volta: o que se mede é só o gatilho do e-mail.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999918100"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

-- A: ficha sem e-mail. B: ficha com o e-mail que a equipe digitou.
insert into public.organizations (id, kind, name, phone_e164, email, source_id, collector, source_url, owner_id)
select v.id, 'produtor', v.nome, v.fone, v.email,
       (select id from public.sources order by id limit 1), 'pgtap', 'https://exemplo.invalido/181', pg_temp.g()
  from (values
    ('b0000000-0000-4000-8000-000000018101'::uuid, 'Ana Teste 181', '+5584900018101', null::text),
    ('b0000000-0000-4000-8000-000000018102'::uuid, 'Bia Teste 181', '+5584900018102', 'equipe181@exemplo.com')
  ) v(id, nome, fone, email);

create function pg_temp.a() returns uuid language sql as $$ select 'b0000000-0000-4000-8000-000000018101'::uuid $$;
create function pg_temp.b() returns uuid language sql as $$ select 'b0000000-0000-4000-8000-000000018102'::uuid $$;

create table pg_temp.ids (rotulo text primary key, conv uuid, msg uuid);
create function pg_temp.entra(p_rotulo text, p_fone text, p_texto text) returns void language plpgsql as $$
declare v jsonb;
begin
  v := app.wa_registrar_entrada('wamid.PGTAP181.' || p_rotulo, '+5584999918100', p_fone, 'text', p_texto);
  insert into pg_temp.ids values (p_rotulo, (v ->> 'conversation_id')::uuid, (v ->> 'message_id')::uuid);
end $$;
create function pg_temp.conv(p text) returns uuid language sql as $$ select conv from pg_temp.ids where rotulo = p $$;
create function pg_temp.msg(p text) returns uuid language sql as $$ select msg from pg_temp.ids where rotulo = p $$;
create function pg_temp.email(p uuid) returns text language sql as $$
  select email::text from public.organizations where id = p $$;
create function pg_temp.anotacoes(p uuid) returns bigint language sql as $$
  select count(*) from public.activities a
   where a.organization_id = p and a.type = 'system'
     and a.metadata ->> 'origin' = 'conversa' and a.metadata ->> 'campo' = 'email' $$;

-- ---------- achar o e-mail ----------
select is(app.email_achado('meu email é Fulano.Silva@Gmail.com.br.'), 'fulano.silva@gmail.com.br',
  'acha o e-mail, em minúsculas, sem o ponto final da frase');
select is(app.email_achado('me segue no @imova'), null, '@ do Instagram não é e-mail');
select is(app.email_achado('pode mandar pra 84988887777@gmail.com ou liga'), '84988887777@gmail.com',
  'e-mail que começa com número continua e-mail');
select is(app.email_achado(null), null, 'texto nulo não quebra');

-- ---------- ficha sem e-mail ----------
select pg_temp.entra('a1', '+5584900018101', 'Pode sim! Meu e-mail é Ana.Lima@Gmail.com');
select is(pg_temp.email(pg_temp.a()), 'ana.lima@gmail.com', 'a ficha sem e-mail ganha o que o cliente escreveu');
select is(pg_temp.anotacoes(pg_temp.a()), 1::bigint, 'e fica uma anotação na linha do tempo');
select is((select a.body from public.activities a
            where a.organization_id = pg_temp.a() and a.metadata ->> 'campo' = 'email'),
          'E-mail anotado pela conversa: ana.lima@gmail.com', 'a anotação diz o que entrou');
select is((select a.message_id from public.activities a
            where a.organization_id = pg_temp.a() and a.metadata ->> 'campo' = 'email'),
          pg_temp.msg('a1'), 'a anotação aponta a mensagem do cliente');
select ok(exists (select 1 from public.messages m where m.id = pg_temp.msg('a1') and m.body like '%Ana.Lima@Gmail.com%'),
  'a mensagem chega inteira, com o e-mail');

-- ---------- o mesmo e-mail de novo ----------
select pg_temp.entra('a2', '+5584900018101', 'repetindo: ana.lima@gmail.com');
select is(pg_temp.anotacoes(pg_temp.a()), 1::bigint, 'o mesmo e-mail de novo não anota nada');

-- ---------- o cliente corrigindo ----------
select pg_temp.entra('a3', '+5584900018101', 'errei, o certo é ana.lima@exemplo.com.br');
select is(pg_temp.email(pg_temp.a()), 'ana.lima@exemplo.com.br', 'o cliente corrigindo troca o que ele mesmo mandou');
select ok(exists (select 1 from public.activities a
                   where a.organization_id = pg_temp.a() and a.metadata ->> 'campo' = 'email'
                     and a.body = 'E-mail trocado pela conversa: ana.lima@gmail.com → ana.lima@exemplo.com.br'),
  'e a anotação conta a troca');

-- ---------- o e-mail que a equipe digitou ----------
select pg_temp.entra('b1', '+5584900018102', 'meu email: bia@exemplo.com');
select is(pg_temp.email(pg_temp.b()), 'equipe181@exemplo.com', 'o e-mail que a equipe digitou não é trocado');
select ok(exists (select 1 from public.activities a
                   where a.organization_id = pg_temp.b() and a.metadata ->> 'campo' = 'email'
                     and (a.metadata ->> 'gravado')::boolean = false
                     and a.metadata ->> 'email' = 'bia@exemplo.com'),
  'fica a anotação com o e-mail novo, para a equipe decidir');

-- ---------- sem e-mail, sem ficha ----------
select pg_temp.entra('a4', '+5584900018101', 'oi, tudo bem? manda no @imova');
select is(pg_temp.anotacoes(pg_temp.a()), 2::bigint, 'mensagem sem e-mail não anota nada');
select lives_ok($$ select pg_temp.entra('x1', '+5584900018199', 'sem ficha: x@exemplo.com') $$,
  'conversa sem ficha recebe a mensagem com e-mail sem erro');
select ok(exists (select 1 from public.messages m where m.id = pg_temp.msg('x1')),
  'e a mensagem fica gravada');

-- ---------- o que a IA sabe ----------
select is(app.ia_email_do_cliente(pg_temp.conv('a1')),
          '{"na_ficha": true, "ofertas": null, "ofertas_em": null}'::jsonb,
  'a IA sabe que a ficha tem e-mail, e que ele ainda não respondeu às ofertas');
select ok(position('ana.lima' in app.ia_email_do_cliente(pg_temp.conv('a1'))::text) = 0,
  'a IA nunca recebe o endereço');
select is(public.ia_entrada_do_atendente(pg_temp.conv('a1')) -> 'email' -> 'na_ficha', 'true'::jsonb,
  'a entrada do worker traz o e-mail');

-- ---------- a resposta ao convite ----------
select is(public.ia_atendente_ofertas_por_email(pg_temp.conv('a1'), pg_temp.msg('a1'), true) ->> 'gravado', 'true',
  'o "sim" fica registrado');
select is(public.ia_atendente_ofertas_por_email(pg_temp.conv('a1'), pg_temp.msg('a1'), true) ->> 'motivo', 'ja_estava',
  'o mesmo "sim" de novo não duplica');
select is(app.ia_email_do_cliente(pg_temp.conv('a1')) ->> 'ofertas', 'aceitou', 'e a IA passa a saber que ele aceitou');
select is(public.ia_atendente_ofertas_por_email(pg_temp.conv('a1'), pg_temp.msg('a3'), false) ->> 'gravado', 'true',
  'mudar de ideia é uma linha nova');
select is(app.ia_email_do_cliente(pg_temp.conv('a1')) ->> 'ofertas', 'recusou', 'vale a decisão mais nova');
select is((select do_not_contact from public.organizations where id = pg_temp.a()), false,
  'o "não" às ofertas por e-mail não suprime o contato (o WhatsApp continua)');
select is(jsonb_array_length(app.lgpd_dossie(pg_temp.a()) -> 'ofertas_por_email'), 2,
  'o dossiê da LGPD traz o histórico das ofertas por e-mail');

-- ---------- quem lê e quem grava ----------
select throws_ok($$ update public.ofertas_por_email set aceita = true where organization_id = pg_temp.a() $$,
  null, null, 'a decisão registrada não muda');

select pg_temp.entrar(pg_temp.g(), 'gestor');
select is((select count(*) from public.ofertas_por_email where organization_id = pg_temp.a()), 2::bigint,
  'quem tem acesso ao CRM lê as decisões');
select throws_ok($$ select public.ia_atendente_ofertas_por_email(
                      'b0000000-0000-4000-8000-000000018101'::uuid, null, true) $$,
  '42501', null, 'só o worker registra a resposta ao convite');
select pg_temp.sair();

select * from finish();
rollback;

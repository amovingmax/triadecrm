-- =====================================================================
-- pgTAP — O teto de fala do robô (migração 20260925180000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. SEIS FALAS EM 24 H, E A SÉTIMA É RECUSADA. Uma conversa real tem
--      saudação, preço, link do cadastro e mais duas idas. A sétima é sinal de
--      que o robô não está entendendo, e insistir é o que queima o número.
--   2. A DESPEDIDA SAI MESMO ASSIM, e não conta como fala. Sem essa exceção,
--      uma conversa no teto emudeceria sem dizer por quê — e o robô que some
--      no meio da frase é pior que o robô que fala uma vez a mais.
--   3. PINGUE-PONGUE É MÁQUINA. Três recebidas seguidas, cada uma menos de
--      20 s depois da nossa saída: gente lê antes de responder.
--   4. O FUSÍVEL É DO SISTEMA, não da conversa, e religar o apaga no mesmo
--      gesto: ligar e continuar mudo seria pior que continuar desligado.
--   5. O FREIO NOVO NÃO ENCOSTA NO GUARDRAIL ANTIGO. Conversa pausada e com o
--      teto cheio continua deixando SAIR a confirmação de opt-out.
--
-- ESCOPO: conversas e número próprios deste arquivo. O fusível global é a
-- única medida que olha o sistema inteiro, e por isso é medida em DELTA.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(13);

create function pg_temp.num() returns text language sql immutable as $$
  select '+5584900000070'::text
$$;
create function pg_temp.entrar_worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
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
create function pg_temp.contratar(p_nome text, p_papel text) returns uuid
language plpgsql as $$
declare
  v_id    uuid  := gen_random_uuid();
  v_email text  := 'pgtap70.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                   || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 70 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  return v_id;
end $$;
create temp table equipe70(papel text primary key, id uuid not null);
insert into equipe70(papel, id) values ('gestor', pg_temp.contratar('Dorival Pgtap', 'gestor'));
create function pg_temp.gestor() returns uuid language sql as $$
  select id from equipe70 where papel = 'gestor'
$$;

create function pg_temp.conv() returns uuid language sql immutable as $$
  select 'c0000000-0000-4000-8000-0000000c7001'::uuid
$$;
insert into public.conversations (id, business_number, peer_phone_e164, assignee_id, last_inbound_at)
values (pg_temp.conv(), pg_temp.num(), '+5584911110701', pg_temp.gestor(), now() - interval '10 minutes');

-- O robô falando: `bot_fixed` com `template_id`, que é o que o guarda exige de
-- texto de robô (RF-CON-22). O modelo é o do menu, que já existe no seed.
create function pg_temp.robo_fala(p_n int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tpl int := (select t.id from public.message_templates t
                 where t.template_code = 'GEN-SYS-MENU' and t.is_active);
  i int;
begin
  for i in 1..p_n loop
    insert into public.messages (conversation_id, direction, type, status, body,
                                 template_id, author_kind, origin)
    values (pg_temp.conv(), 'out'::app.msg_direction, 'text'::app.msg_type,
            'queued'::app.msg_status, 'fala de teste', v_tpl, 'bot_fixed', 'crm');
  end loop;
end $$;

-- =====================================================================
-- 1. SEIS FALAS, E A SÉTIMA É RECUSADA
-- =====================================================================
select pg_temp.entrar_worker();
select pg_temp.robo_fala(5);
select pg_temp.sair();

select is((app.wa_bot_pode_falar(pg_temp.conv(), now()) ->> 'pode')::boolean, true,
  'com cinco falas, o robô ainda pode falar');
select is((app.wa_bot_pode_falar(pg_temp.conv(), now()) ->> 'falas')::int, 5,
  'e a conta é de cinco');

select pg_temp.entrar_worker();
select pg_temp.robo_fala(1);
select pg_temp.sair();

select is(app.wa_bot_pode_falar(pg_temp.conv(), now()) ->> 'motivo', 'teto_de_falas',
  'com seis, o teto está cheio');
select pg_temp.entrar_worker();
select throws_ok($$ select pg_temp.robo_fala(1) $$, '42501', NULL,
  'e a SÉTIMA é recusada pelo guarda: o teto vale para o bot de entrada, para a ausência e para o que vier');
select pg_temp.sair();

-- =====================================================================
-- 2. A DESPEDIDA SAI, E NÃO CONTA
-- =====================================================================
-- `app.wa_bot_dizer` é revogada de todo mundo (é do gatilho, não de gente):
-- o atalho abaixo a chama como dona, que é o que o gatilho faz.
create function pg_temp.despedir() returns uuid
  language sql security definer set search_path = '' as $$
  select app.wa_bot_dizer(pg_temp.conv(), 'GEN-SYS-HUMANO')
$$;
select lives_ok($$ select pg_temp.despedir() $$,
  'a despedida SAI com o teto cheio: sem ela, a conversa emudeceria sem dizer por quê');
select is(app.wa_bot_falas(pg_temp.conv(), now() - interval '24 hours'), 6,
  'e não conta como fala: se contasse, uma conversa no teto não poderia se despedir');

-- =====================================================================
-- 3. PINGUE-PONGUE É MÁQUINA
-- =====================================================================
create function pg_temp.conv2() returns uuid language sql immutable as $$
  select 'c0000000-0000-4000-8000-0000000c7002'::uuid
$$;
insert into public.conversations (id, business_number, peer_phone_e164, assignee_id)
values (pg_temp.conv2(), pg_temp.num(), '+5584911110702', pg_temp.gestor());

-- Três pares (nossa saída, resposta 5 s depois). Gente não responde em 5 s
-- três vezes seguidas.
create function pg_temp.par(p_i int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tpl int := (select t.id from public.message_templates t
                 where t.template_code = 'GEN-SYS-MENU' and t.is_active);
  v_base timestamptz := now() - make_interval(mins => 30 - p_i * 5);
begin
  insert into public.messages (conversation_id, direction, type, status, body,
                               template_id, author_kind, origin, created_at, sent_at)
  values (pg_temp.conv2(), 'out'::app.msg_direction, 'text'::app.msg_type,
          'sent'::app.msg_status, 'fala ' || p_i, v_tpl, 'bot_fixed', 'crm', v_base, v_base);
  insert into public.messages (conversation_id, direction, type, status, body,
                               origin, wa_message_id, created_at)
  values (pg_temp.conv2(), 'in'::app.msg_direction, 'text'::app.msg_type,
          'received'::app.msg_status, 'resposta ' || p_i, 'echo',
          'wamid.PGTAP70.PP.' || p_i, v_base + interval '5 seconds');
end $$;

select pg_temp.entrar_worker();
select pg_temp.par(1);
select pg_temp.par(2);
select pg_temp.par(3);
select pg_temp.sair();

-- A pergunta agora devolve `bot_pausado`, e não `pingue_pongue` — porque o
-- gatilho JÁ agiu quando a terceira resposta chegou. É o desfecho certo, e a
-- prova de que o freio não espera o robô tentar falar: quem diz qual detector
-- disparou é a tarefa.
select is((select c.bot_paused from public.conversations c where c.id = pg_temp.conv2()), true,
  'o gatilho pausou a conversa quando a terceira resposta em menos de 20 s chegou');
select ok(exists (select 1 from public.tasks t
                   where t.origin = 'system'
                     and t.title like 'O robô parou nesta conversa (pingue_pongue)%'),
  'com tarefa para uma pessoa, dizendo qual detector disparou: freio sem tarefa é um silêncio');
select is((select count(*)::int from public.messages m
            where m.conversation_id = pg_temp.conv2()
              and m.template_id = app.wa_modelo_humano()), 1,
  'e a despedida saiu ANTES da pausa — invertida a ordem, o próprio guarda a recusaria');

-- =====================================================================
-- 4. RELIGAR APAGA O FREIO, NO MESMO GESTO
-- =====================================================================
update public.app_settings
   set value = jsonb_set(jsonb_set(value, '{ativo}', 'false'::jsonb), '{freio}',
                 jsonb_build_object('parado_em', to_jsonb(now()), 'motivo', '"fusivel_global"'::jsonb))
 where key = 'whatsapp.bot_de_entrada';

select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is((public.wa_bot_ligar(true) -> 'freio'), NULL,
  'ligar o bot apaga o freio no mesmo gesto: ligar e continuar mudo seria pior que continuar desligado');
select pg_temp.sair();
select is((select (s.value ->> 'ativo')::boolean from public.app_settings s
            where s.key = 'whatsapp.bot_de_entrada'), true,
  'e o bot ficou ligado');

-- =====================================================================
-- 5. O FREIO NOVO NÃO ENCOSTA NO GUARDRAIL ANTIGO
-- =====================================================================
-- A conversa 01 está com o teto cheio. Quem pede para sair tem de conseguir
-- sair: a confirmação de opt-out é `author_kind = 'system'` e retorna ANTES do
-- bloco novo do guarda. Ela nunca pode ser barrada por um teto de robô.
update public.conversations set bot_paused = true, last_inbound_at = now() - interval '5 minutes'
 where id = pg_temp.conv();
select pg_temp.entrar_worker();
select lives_ok(
  $$ select public.wa_optout_registrar(pg_temp.conv(), 'quero sair', true) $$,
  'conversa pausada e com o teto cheio continua deixando SAIR a confirmação de opt-out: o freio novo não encosta no guardrail antigo');
select pg_temp.sair();
select is((select count(*)::int from public.messages m
            where m.conversation_id = pg_temp.conv() and m.optout_confirmation), 1,
  'e a confirmação está lá, uma só');

select * from finish();
rollback;

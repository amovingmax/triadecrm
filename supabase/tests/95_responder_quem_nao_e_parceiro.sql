-- =====================================================================
-- pgTAP — Responder quem não é parceiro (migração 20261003100000)
--
-- Rafael, 01/10/2026: "adeque o crm pra responder clientes normais, oq vem
-- 'fora da base' em conversas". O número da KOMUNE vive só na Cloud API, então
-- cliente e curioso também chegam ao CRM — sem ficha. Este arquivo prova:
--
--   1. DENTRO DA JANELA, a resposta de uma pessoa sai sem ficha (isso já valia
--      no banco; o teste fixa para ninguém quebrar sem querer);
--   2. A PRÉVIA por conversa diz o mesmo que a por ficha: janela, bloqueio,
--      modelos e o primeiro nome do perfil do WhatsApp para o `{{nome}}`;
--   3. O MODELO sai pela conversa, assinado por quem clicou, e NÃO cria ficha
--      nem negócio — cliente não entra em funil;
--   4. NINGUÉM FURA A LEITURA: quem não vê a conversa ouve "não encontrada", e
--      quem não escreve não envia;
--   5. CONVERSA COM FICHA usa o caminho dela.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(13);

insert into public.allowed_users (email, role, note) values
  ('h94.s@teste.local', 'sdr', 'pgTAP 94'),
  ('h94.e@teste.local', 'embaixador', 'pgTAP 94'),
  ('h94.l@teste.local', 'leitura', 'pgTAP 94');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000009401'::uuid, 'h94.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000009402'::uuid, 'h94.e@teste.local', '{"full_name":"Eva Embaixadora"}'),
  ('a0000000-0000-4000-8000-000000009403'::uuid, 'h94.l@teste.local', '{"full_name":"Leo Leitura"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999999400"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

insert into public.message_templates (template_code, name, channel, category, kind,
                                      meta_template_name, meta_status, body)
values ('TST-94-OLA', 'Olá do pgTAP 94', 'whatsapp', 'utility', 'abertura',
        'tst_94_ola', 'approved', 'Oi, {{nome}}! Aqui é {{atendente}}, da KOMUNE.');

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

-- A conversa de um CLIENTE: número que não é ficha, nome do perfil do WhatsApp,
-- e uma mensagem dele há pouco (janela de 24 h aberta).
create temp table t94(chave text primary key, valor uuid);
grant select on t94 to authenticated;
do $$
declare v_conv uuid; v_org uuid; v_conv_ficha uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999999400', '+5584999999401', 'Maria Souza',
          'a0000000-0000-4000-8000-000000009401'::uuid, 'aguardando_nos')
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'oi, comprei ingresso e não chegou', 'system', 'crm');
  insert into t94 values ('cliente', v_conv);

  -- E uma conversa COM ficha, para o caso 5.
  insert into public.organizations (name, phone_e164, source_id, collector)
  values ('Buffet do pgTAP 94', '+5584999999402',
          (select id from public.sources where slug = 'planilha'), 'pgtap94')
  returning id into v_org;
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999999400', '+5584999999402', v_org,
          'a0000000-0000-4000-8000-000000009401'::uuid, 'aguardando_nos')
  returning id into v_conv_ficha;
  insert into t94 values ('com_ficha', v_conv_ficha);
end $$;

create function pg_temp.conv(p text) returns uuid language sql stable as $$
  select valor from t94 where chave = p
$$;
create temp table t94_contas as
  select (select count(*) from public.organizations) as fichas,
         (select count(*) from public.deals) as negocios;
grant select on t94_contas to authenticated;

-- ---------------------------------------------------------------------
-- 1. Texto livre dentro da janela, sem ficha
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000009401'::uuid, 'sdr');
select lives_ok(
  $$ insert into public.messages (conversation_id, direction, type, status, body,
                                  author_kind, sent_by, origin)
     values (pg_temp.conv('cliente'), 'out', 'text', 'queued', 'Oi, Maria! Já vejo para você.',
             'human', 'a0000000-0000-4000-8000-000000009401'::uuid, 'crm') $$,
  'dentro da janela, uma pessoa responde o cliente em texto livre, sem ficha');
select pg_temp.sair();
select is(
  (select organization_id from public.messages
    where conversation_id = pg_temp.conv('cliente') and direction = 'out' and type = 'text'),
  null::uuid,
  'a resposta fica na conversa do cliente, sem ficha nenhuma');

-- ---------------------------------------------------------------------
-- 2. A prévia por conversa
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000009401'::uuid, 'sdr');
select is((public.wa_preparar_envio_na_conversa(pg_temp.conv('cliente')) ->> 'janela_24h_aberta')::boolean,
          true, 'a prévia vê a janela de 24 h aberta');
select is(public.wa_preparar_envio_na_conversa(pg_temp.conv('cliente')) -> 'bloqueio',
          'null'::jsonb, 'nada barra o envio');
select is(public.wa_preparar_envio_na_conversa(pg_temp.conv('cliente')) -> 'valores' ->> 'nome',
          'Maria', 'o {{nome}} sai do primeiro nome do perfil do WhatsApp');
select ok(
  exists (select 1 from jsonb_array_elements(
            public.wa_preparar_envio_na_conversa(pg_temp.conv('cliente')) -> 'modelos') m
           where m ->> 'codigo' = 'TST-94-OLA'),
  'a prévia oferece os modelos aprovados pela Meta');

-- ---------------------------------------------------------------------
-- 3. O modelo sai pela conversa, e ninguém vira ficha
-- ---------------------------------------------------------------------
select is(
  (public.wa_enviar_modelo_na_conversa(pg_temp.conv('cliente'),
     (select id from public.message_templates where template_code = 'TST-94-OLA'),
     '{"nome": "Maria"}'::jsonb) ->> 'ok')::boolean,
  true, 'o modelo entra na fila pela conversa');
select pg_temp.sair();
select is(
  (select body from public.messages
    where conversation_id = pg_temp.conv('cliente') and type = 'template'),
  'Oi, Maria! Aqui é Sara, da KOMUNE.',
  'assinado com o primeiro nome de quem clicou');
select is(
  (select count(*) from public.organizations) - (select fichas from t94_contas)
  + (select count(*) from public.deals) - (select negocios from t94_contas),
  0::bigint, 'responder um cliente não cria ficha nem negócio');

-- ---------------------------------------------------------------------
-- 4. Ninguém fura a leitura
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000009402'::uuid, 'embaixador');
select throws_ok(
  $$ select public.wa_preparar_envio_na_conversa(pg_temp.conv('cliente')) $$,
  'P0002', 'Conversa não encontrada',
  'quem não vê a conversa não descobre nada sobre ela');
select throws_ok(
  $$ select public.wa_enviar_modelo_na_conversa(pg_temp.conv('cliente'),
       (select id from public.message_templates where template_code = 'TST-94-OLA'),
       '{"nome": "Maria"}'::jsonb) $$,
  'P0002', 'Conversa não encontrada',
  'e não manda nada para ela');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000009403'::uuid, 'leitura');
select throws_ok(
  $$ select public.wa_enviar_modelo_na_conversa(pg_temp.conv('cliente'),
       (select id from public.message_templates where template_code = 'TST-94-OLA'),
       '{"nome": "Maria"}'::jsonb) $$,
  '42501', 'Sem permissão para enviar mensagem pelo WhatsApp',
  'quem só lê não envia');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 5. Conversa com ficha usa o caminho dela
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000009401'::uuid, 'sdr');
select throws_ok(
  $$ select public.wa_enviar_modelo_na_conversa(pg_temp.conv('com_ficha'),
       (select id from public.message_templates where template_code = 'TST-94-OLA'),
       '{"nome": "Maria"}'::jsonb) $$,
  '22023', 'Envio recusado: conversa_tem_ficha — use wa_enviar_modelo',
  'conversa com ficha não passa por aqui: ela conta no funil pelo caminho próprio');
select pg_temp.sair();

select * from finish();
rollback;

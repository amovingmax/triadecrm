-- =====================================================================
-- pgTAP — Cliente não recebe resposta automática (migração 20261003110000)
--
-- Rafael, 01/10/2026: "tire a resposta automatica quando a conversa vier de
-- clientes". Conversa de cliente é a conversa sem ficha. Este arquivo prova, na
-- própria função de cada automação, que as três se calam para ela — e que a
-- resposta não depende do relógio (a pergunta vem antes da hora):
--
--   1. o menu de entrada (`app.wa_bot_de_entrada`);
--   2. o aviso de fora do horário (`app.ausencia_responder`);
--   3. a apresentação, mesmo depois de o cliente responder ao "Bom dia!"
--      (`app.wa_introduzir`).
--
-- E que para parceiro o menu continua (o resto do comportamento de parceiro está
-- nos pgTAP 47, 61, 83 e 86).
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(5);

insert into public.allowed_users (email, role, note) values ('h96.s@teste.local', 'sdr', 'pgTAP 96');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000009601'::uuid, 'h96.s@teste.local', '{"full_name":"Sol Sdr"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999999600"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": true, "ausencia_ativa": true, "lead_automatico": false,
                          "distribuicao_automatica": false, "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'true')
 where key = 'whatsapp.bot_de_entrada';

create temp table t96(chave text primary key, valor uuid);
do $$
declare v_conv uuid; v_msg uuid; v_org uuid; v_conv_p uuid; v_msg_p uuid;
begin
  -- O cliente: número sem ficha, que escreveu agora.
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999999600', '+5584999999601', 'Clara Cliente',
          'a0000000-0000-4000-8000-000000009601'::uuid, 'aguardando_nos')
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'Oi, tudo bem? Queria saber do meu ingresso', 'system', 'crm')
  returning id into v_msg;
  insert into t96 values ('conv_cliente', v_conv), ('msg_cliente', v_msg);

  -- O parceiro: ficha com o número, que escreveu primeiro.
  insert into public.organizations (name, phone_e164, source_id, collector)
  values ('Buffet do pgTAP 96', '+5584999999602',
          (select id from public.sources where slug = 'planilha'), 'pgtap96')
  returning id into v_org;
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999999600', '+5584999999602', v_org,
          'a0000000-0000-4000-8000-000000009601'::uuid, 'aguardando_nos')
  returning id into v_conv_p;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (v_conv_p, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'Oi, boa tarde', 'system', 'crm')
  returning id into v_msg_p;
  insert into t96 values ('conv_parceiro', v_conv_p);
end $$;

create function pg_temp.v(p text) returns uuid language sql stable as $$
  select valor from t96 where chave = p
$$;
create function pg_temp.saidas(p_conv uuid) returns int language sql stable as $$
  select count(*)::int from public.messages
   where conversation_id = p_conv and direction = 'out'::app.msg_direction
$$;

-- 1 · o menu
select is(pg_temp.saidas(pg_temp.v('conv_cliente')), 0,
  'o cliente que escreveu não recebeu nada automático');
select is(app.wa_bot_de_entrada(pg_temp.v('msg_cliente')) ->> 'motivo', 'conversa_de_cliente',
  'o menu de entrada se cala para conversa sem ficha');

-- 2 · o aviso de fora do horário, sem depender da hora
select is(app.ausencia_responder(pg_temp.v('msg_cliente')) ->> 'motivo', 'conversa_de_cliente',
  'o aviso de fora do horário se cala para conversa sem ficha, a qualquer hora');

-- 3 · a apresentação
select is(app.wa_introduzir(pg_temp.v('msg_cliente')) ->> 'motivo', 'conversa_de_cliente',
  'a apresentação de captação nunca vai para quem não é parceiro');

-- E para o parceiro, o menu continua.
select ok(pg_temp.saidas(pg_temp.v('conv_parceiro')) >= 1,
  'o parceiro que escreve primeiro continua recebendo o menu');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — O portal de cada lead, sempre que se sabe (migração
-- 20261123170000), Leads da Imova
--
-- O aviso do Grupo OLX não diz de qual portal veio. Este arquivo prova:
--   0. A view tem as mesmas colunas, na mesma ordem, e nada gravado muda;
--   1. O CHAT É DA OLX: o lead do chat do portal sai da lista com o portal
--      'olx' (o formulário e o pedido de visita, que existem no ZAP e no Viva
--      Real, continuam sem portal: não se adivinha);
--   2. NA OLX, O WHATSAPP VEM DEPOIS DE "VER TELEFONE" (Kívia, 18/11/2026): o
--      PHONE_VIEW puro e a mensagem com o link da OLX, da mesma pessoa, são UM
--      na lista, com o anúncio do aviso e o portal da OLX;
--   3. O que não forma par continua separado: o "ver telefone" fora da janela,
--      e o "ver telefone" junto com o formulário (não é clique puro).
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(14);

insert into public.allowed_users (email, role, note) values
  ('p198.g@teste.local', 'gestor', 'pgTAP 198'),
  ('p198.s@teste.local', 'sdr', 'pgTAP 198');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000019801'::uuid, 'p198.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000019802'::uuid, 'p198.s@teste.local', '{"full_name":"Sol SDR"}');

-- Nada automático responde às mensagens de teste.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999919800"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
-- O canal de chegada ligado, sem IA, olhando os últimos 120 dias.
insert into public.app_settings (key, value, description)
values ('canal_de_chegada',
        jsonb_build_object('ligada', true, 'ia', false,
                           'aplicar_desde', to_char((now() at time zone 'America/Fortaleza')::date - 120, 'YYYY-MM-DD')),
        'pgTAP 198')
on conflict (key) do update set value = excluded.value;

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
create function pg_temp.gestor() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000019801'::uuid, 'gestor')
$$;
create function pg_temp.sdr() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000019802'::uuid, 'sdr')
$$;
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

create temp table t198(chave text primary key, valor uuid);
grant select on t198 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t198 where chave = p_chave
$$;
grant execute on function pg_temp.id(text) to authenticated;

-- A pessoa escreveu no WhatsApp (conversa nova) e o canal de chegada rodou.
create function pg_temp.chegou(p_chave text, p_tel text, p_texto text, p_em timestamptz) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999919800', p_tel, 'Perfil ' || p_chave,
          'a0000000-0000-4000-8000-000000019801'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t198 values (p_chave, v);
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (v, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_texto, 'system', 'crm', p_em);
  perform app.chegadas_rodar(1000);
  return v;
end $$;
create function pg_temp.chegada(p_conv uuid) returns uuid language sql stable as $$
  select c.id from public.chegadas c where c.conversation_id = p_conv order by c.inicio_em desc limit 1
$$;
create function pg_temp.lead_de(p_conv uuid) returns public.portal_leads language sql stable as $$
  select l.* from public.portal_leads l
   where l.origem = 'whatsapp' and l.chegada_id = pg_temp.chegada(p_conv)
$$;
create function pg_temp.lead_id(p_conv uuid) returns uuid language sql stable as $$
  select (pg_temp.lead_de(p_conv)).id
$$;
grant execute on function pg_temp.lead_id(uuid), pg_temp.lead_de(uuid), pg_temp.chegada(uuid) to authenticated;

-- Um aviso do webhook do Grupo OLX, com o clique em p_clique.
create function pg_temp.receber(p_chave text, p_ddd_tel text, p_clique timestamptz, p_tipo text,
                                p_extra jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
declare
  v jsonb;
begin
  execute 'set local role service_role';
  v := public.grupozap_lead_receber(p_chave,
         jsonb_build_object(
           'leadOrigin', 'Grupo OLX',
           'timestamp', to_char(p_clique at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'),
           'originLeadId', p_chave, 'originListingId', '2920019800', 'clientListingId', 'SA0198_IMOVA',
           'temperature', 'Baixa', 'transactionType', 'RENT',
           'name', 'Nome do Portal ' || p_chave, 'ddd', left(p_ddd_tel, 2), 'phone', substr(p_ddd_tel, 3),
           'extraData', jsonb_build_object('leadType', p_tipo))
         || p_extra);
  execute 'reset role';
  return (v ->> 'lead_id')::uuid;
end $$;
create function pg_temp.webhook(p_chave text) returns uuid language sql stable as $$
  select id from public.portal_leads where origem = 'grupo_olx' and origin_lead_id = p_chave
$$;
grant execute on function pg_temp.webhook(text) to authenticated;
create function pg_temp.na_lista(p_id uuid) returns public.portal_leads_na_lista language sql stable as $$
  select * from public.portal_leads_na_lista where id = p_id
$$;
grant execute on function pg_temp.na_lista(uuid) to authenticated;
create function pg_temp.na_lista_entre(p_ids uuid[]) returns int language sql stable as $$
  select count(*)::int from public.portal_leads_na_lista where id = any (p_ids)
$$;
grant execute on function pg_temp.na_lista_entre(uuid[]) to authenticated;

-- O texto que chega no WhatsApp de quem veio da OLX (o link do anúncio de lá).
create function pg_temp.texto_olx() returns text language sql immutable as $$
  select 'Olá, vi o anúncio https://rn.olx.com.br/rio-grande-do-norte/imoveis/sala-comercial-19m-no-brisa-mall-1419800001 ainda está disponível?'
$$;

with x as (insert into public.anuncios (codigo, titulo, negocio)
           values ('SA0198_IMOVA', 'Sala comercial 198 no Brisa Mall', 'aluguel') returning id)
insert into t198 select 'an_sa', id from x;

select pg_temp.virar('imova');

-- =====================================================================
-- 0. A view tem as mesmas colunas
-- =====================================================================
select is((select string_agg(attname, ',' order by attnum) from pg_attribute
            where attrelid = 'public.portal_leads_na_lista'::regclass and attnum > 0 and not attisdropped),
  'id,origem,origem_no_portal,origin_lead_id,client_listing_id,origin_listing_id,anuncio_id,anuncio_no_canal_pro_id,organization_id,tipos,temperatura,transacao,lead_certo,mcmv,mensagem,link_historico,recebido_no_portal_em,recebido_em,situacao,responsavel_id,motivo_descarte,situacao_em,situacao_por,suprimido,ficha_nome,phone_e164,phone_is_masked,email,anuncio_codigo,anuncio_titulo,conversation_id,responsavel_nome,situacao_registrada,nome_no_portal,grupo,chegou_por,chegou_em,primeira_mensagem,primeira_mensagem_tipo,respondido_em,respondido_por_nome,contato_apagado_em,portal',
  'a lista tem as mesmas colunas, na mesma ordem');

-- =====================================================================
-- 1. O chat é da OLX
-- =====================================================================
select pg_temp.receber('p198-chat', '84981980001', now() - interval '1 hour', 'CONTACT_CHAT',
  '{"message": "Olá, gostaria de ter mais informações para alugar: Sala comercial 19m² no Brisa Mall [MENSAGEM DO CHAT] Ainda disponível?"}'::jsonb)
  is not null as webhook_gravou;
select pg_temp.receber('p198-form', '84981980002', now() - interval '1 hour', 'CONTACT_FORM',
  '{"message": "Olá, gostaria de ter mais informações. Aguardo seu contato, obrigado."}'::jsonb)
  is not null as webhook_gravou;

select pg_temp.gestor();
select is((pg_temp.na_lista(pg_temp.webhook('p198-chat'))).chegou_por, 'chat', 'o chat do portal chega pelo chat');
select is((pg_temp.na_lista(pg_temp.webhook('p198-chat'))).portal, 'olx', 'e o portal dele é a OLX');
select is((pg_temp.na_lista(pg_temp.webhook('p198-form'))).chegou_por, 'formulario', 'o formulário chega pelo formulário');
select is((pg_temp.na_lista(pg_temp.webhook('p198-form'))).portal, null,
  'e fica sem portal: ZAP e Viva Real têm formulário, e o aviso não diz qual');
select pg_temp.sair();
select pg_temp.sdr();
select is((pg_temp.na_lista(pg_temp.webhook('p198-chat'))).portal, 'olx', 'o SDR também vê a OLX no chat');
select pg_temp.sair();
select is((select portal from public.portal_leads where id = pg_temp.webhook('p198-chat')), null,
  'nada gravado muda: o portal do chat é só da lista');

-- =====================================================================
-- 2. Na OLX, o WhatsApp vem depois de "ver telefone" (o caso da Kívia)
-- =====================================================================
-- O Grupo OLX avisa o "ver telefone" (08:34:15 no caso real) e, 12 s depois,
-- a mensagem com o link da OLX chega no WhatsApp.
select pg_temp.receber('p198-tel', '84981980003', now() - interval '2 days' - interval '12 seconds', 'PHONE_VIEW')
  is not null as webhook_gravou;
update public.portal_leads set recebido_em = recebido_no_portal_em + interval '2 seconds'
 where origem = 'grupo_olx' and origin_lead_id = 'p198-tel';
select pg_temp.chegou('kivia', '+5584981980003', pg_temp.texto_olx(), now() - interval '2 days');

select is((select canal || '/' || subcanal_automatico from public.chegadas
            where id = pg_temp.chegada(pg_temp.id('kivia'))),
  'anuncios/portal_olx', 'o canal reconhece o link da OLX');
select ok((pg_temp.lead_de(pg_temp.id('kivia'))).portal = 'olx'
          and (pg_temp.lead_de(pg_temp.id('kivia'))).anuncio_id is null,
  'a mensagem vira o lead do WhatsApp pela OLX, sem anúncio (o link da OLX não traz o código)');

select pg_temp.gestor();
select is(pg_temp.na_lista_entre(array[pg_temp.lead_id(pg_temp.id('kivia')), pg_temp.webhook('p198-tel')]), 1,
  'o "ver telefone" e a mensagem da mesma pessoa aparecem uma vez só');
select ok((pg_temp.na_lista(pg_temp.webhook('p198-tel'))).portal = 'olx'
          and (pg_temp.na_lista(pg_temp.webhook('p198-tel'))).chegou_por = 'whatsapp'
          and (pg_temp.na_lista(pg_temp.webhook('p198-tel'))).anuncio_codigo = 'SA0198_IMOVA',
  'fica o aviso (chegou primeiro), pelo WhatsApp, com o anúncio dele e o portal da OLX');
select pg_temp.sair();

-- =====================================================================
-- 3. O que não forma par continua separado
-- =====================================================================
-- "Ver telefone" 3 dias antes da mensagem: fora da janela de −24 h.
select pg_temp.receber('p198-fora', '84981980004', now() - interval '5 days', 'PHONE_VIEW')
  is not null as webhook_gravou;
select pg_temp.chegou('fora', '+5584981980004', pg_temp.texto_olx(), now() - interval '2 days');
select pg_temp.gestor();
select is(pg_temp.na_lista_entre(array[pg_temp.lead_id(pg_temp.id('fora')), pg_temp.webhook('p198-fora')]), 2,
  '"ver telefone" fora da janela: os dois ficam');
select is((pg_temp.na_lista(pg_temp.webhook('p198-fora'))).portal, null,
  'e o aviso sozinho fica sem portal (não se adivinha)');
select pg_temp.sair();

-- "Ver telefone" junto com o formulário: não é clique puro, é outro contato.
select pg_temp.receber('p198-misto', '84981980005', now() - interval '2 days' - interval '5 minutes', 'PHONE_VIEW',
  '{"message": "Quero saber o condomínio", "extraData": {"leadType": "CONTACT_FORM"}}'::jsonb)
  is not null as webhook_gravou;
update public.portal_leads set tipos = array['CONTACT_FORM', 'PHONE_VIEW']
 where origem = 'grupo_olx' and origin_lead_id = 'p198-misto';
select pg_temp.chegou('misto', '+5584981980005', pg_temp.texto_olx(), now() - interval '2 days');
select pg_temp.gestor();
select is(pg_temp.na_lista_entre(array[pg_temp.lead_id(pg_temp.id('misto')), pg_temp.webhook('p198-misto')]), 2,
  '"ver telefone" com o formulário não some atrás da mensagem no WhatsApp');
select pg_temp.sair();

select * from finish();
rollback;

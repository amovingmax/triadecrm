-- =====================================================================
-- pgTAP — O WhatsApp que vem do portal vira lead do portal (migração
-- 20261113130000), só na Imova
--
-- A aba Leads mostrava 0 leads, mas os leads dos portais já chegavam pelo
-- WhatsApp, com o texto pronto do ZAP e do Viva Real, e o canal de chegada já
-- os reconhecia. Este arquivo prova:
--
--   0. A ESTRUTURA: as colunas novas, o gatilho em chegadas (e nenhum em
--      messages ou conversations), a rotina de 5 minutos, quem executa o quê e
--      o safeupdate;
--   1. A REGRA: a chegada pelo texto do ZAP e do Viva Real vira UM lead (e um
--      só, rodando de novo), com o tipo, o portal, a hora da chegada, a
--      conversa e o telefone; o código casa com o anúncio exato, sem o sufixo,
--      com espaço e zeros, e com a linha do relatório do Canal Pro; o número do
--      portal vai para origin_listing_id;
--   2. O QUE NÃO É DE PORTAL não vira lead (placa, "Oi", anúncio da Meta);
--   3. A CORREÇÃO DE GENTE cria o lead; desmarcar esconde o que ninguém mexeu;
--      marcar de novo traz de volta; o que alguém assumiu fica;
--   4. QUEM VÊ: gestor, admin e SDR veem como antes (o telefone inteiro só para
--      a gestão; o SDR revela, com registro); embaixador e leitura não veem;
--   5. SEM LEAD DOBRADO: o CLICK_WHATSAPP do Grupo OLX da mesma pessoa, na
--      janela de −24 h a +15 min, aparece uma vez só na lista e na conta do
--      anúncio; fora da janela, são dois;
--   6. SEM AVISO DOBRADO: o lead do WhatsApp não põe o aviso "Lead novo dos
--      portais" na fila (o do portal põe);
--   7. A ROTINA: a chegada antiga (sem o gatilho) vira lead, uma vez só; a
--      ficha que veio depois é ligada, com a atividade; o erro do lead não
--      derruba a chegada nem a correção;
--   8. A KOMUNE: com a identidade "komune" nada vira lead;
--   9. O WHATSAPP NÃO É TOCADO: nenhuma mensagem de saída, nada na fila, a
--      conversa fica igual, até o updated_at.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(112);

insert into public.allowed_users (email, role, note) values
  ('w172.g@teste.local', 'gestor', 'pgTAP 172'),
  ('w172.s@teste.local', 'sdr', 'pgTAP 172'),
  ('w172.a@teste.local', 'admin', 'pgTAP 172'),
  ('w172.e@teste.local', 'embaixador', 'pgTAP 172'),
  ('w172.l@teste.local', 'leitura', 'pgTAP 172');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000017201'::uuid, 'w172.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000017202'::uuid, 'w172.s@teste.local', '{"full_name":"Sol SDR"}'),
  ('a0000000-0000-4000-8000-000000017203'::uuid, 'w172.a@teste.local', '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000017204'::uuid, 'w172.e@teste.local', '{"full_name":"Edu Embaixador"}'),
  ('a0000000-0000-4000-8000-000000017205'::uuid, 'w172.l@teste.local', '{"full_name":"Leo Leitura"}');

insert into public.categories (slug, name, "group", priority, position, komune_category_key, is_active)
values ('comprador', 'Comprador', 'producao', 1, 900, null, true),
       ('locatario', 'Locatário', 'producao', 1, 901, null, true)
on conflict (slug) do update set is_active = true;

-- Nada automático responde às mensagens de teste.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999917200"')
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
        'pgTAP 172')
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
  select pg_temp.entrar('a0000000-0000-4000-8000-000000017201'::uuid, 'gestor')
$$;
create function pg_temp.sdr() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000017202'::uuid, 'sdr')
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

create temp table t172(chave text primary key, valor uuid);
grant select on t172 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t172 where chave = p_chave
$$;
grant execute on function pg_temp.id(text) to authenticated;

create function pg_temp.conversa(p_chave text, p_tel text, p_ficha uuid default null) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999917200', p_tel, 'Perfil ' || p_chave, p_ficha,
          'a0000000-0000-4000-8000-000000017201'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t172 values (p_chave, v);
  return v;
end $$;
-- A pessoa escreveu; com o instante, o texto e o conteúdo que o teste quiser.
create function pg_temp.dele(p_conv uuid, p_em timestamptz, p_body text, p_conteudo jsonb default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               conteudo, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_body, 'system', 'crm', p_conteudo, p_em)
  returning id into v;
  return v;
end $$;
-- Uma pessoa nova que escreveu este texto (há 2 dias, por padrão), e a rodada do canal.
create function pg_temp.chegou(p_chave text, p_tel text, p_texto text,
                               p_em timestamptz default now() - interval '2 days',
                               p_ficha uuid default null, p_conteudo jsonb default null) returns uuid
language plpgsql as $$
declare v uuid;
begin
  v := pg_temp.conversa(p_chave, p_tel, p_ficha);
  perform pg_temp.dele(v, p_em, p_texto, p_conteudo);
  perform app.chegadas_rodar(1000);
  return v;
end $$;
create function pg_temp.chegada(p_conv uuid) returns uuid language sql stable as $$
  select c.id from public.chegadas c where c.conversation_id = p_conv order by c.inicio_em desc limit 1
$$;
grant execute on function pg_temp.chegada(uuid) to authenticated;
create function pg_temp.lead_de(p_conv uuid) returns public.portal_leads language sql stable as $$
  select l.* from public.portal_leads l
   where l.origem = 'whatsapp' and l.chegada_id = pg_temp.chegada(p_conv)
$$;
create function pg_temp.leads_de(p_conv uuid) returns int language sql stable as $$
  select count(*)::int from public.portal_leads l
   where l.origem = 'whatsapp' and l.chegada_id in (select c.id from public.chegadas c where c.conversation_id = p_conv)
$$;
create function pg_temp.lead_id(p_conv uuid) returns uuid language sql stable as $$
  select (pg_temp.lead_de(p_conv)).id
$$;
grant execute on function pg_temp.lead_id(uuid), pg_temp.lead_de(uuid) to authenticated;
create function pg_temp.na_lista(p_id uuid) returns public.portal_leads_na_lista language sql stable as $$
  select * from public.portal_leads_na_lista where id = p_id
$$;
grant execute on function pg_temp.na_lista(uuid) to authenticated;
create function pg_temp.na_lista_da_conversa(p_conv uuid) returns int language sql stable as $$
  select count(*)::int from public.portal_leads_na_lista where conversation_id = p_conv
$$;
grant execute on function pg_temp.na_lista_da_conversa(uuid) to authenticated;
-- Um aviso do webhook do Grupo OLX (como o 127): CLICK_WHATSAPP, com o clique em p_clique.
create temp table t172_r(chave text primary key, r jsonb);
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
           'originLeadId', p_chave, 'originListingId', '2790000172', 'clientListingId', 'PT0172_IMOVA',
           'temperature', 'Alta', 'transactionType', 'SELL',
           'name', 'Nome do Portal ' || p_chave, 'ddd', left(p_ddd_tel, 2), 'phone', substr(p_ddd_tel, 3),
           'extraData', jsonb_build_object('leadType', p_tipo))
         || p_extra);
  execute 'reset role';
  insert into t172_r values (p_chave, v) on conflict (chave) do update set r = excluded.r;
  return (v ->> 'lead_id')::uuid;
end $$;

-- Os textos prontos dos portais, como chegam no WhatsApp.
create function pg_temp.texto_zap(p_codigo text) returns text language sql immutable as $$
  select 'Olá! Tenho interesse em casa, Avenida Praia de Pirangi, 2206 - Ponta Negra, Natal - RN que encontrei no Zap: '
         || 'https://www.zapimoveis.com.br/imovel/venda-casa-3-quartos-ponta-negra-natal-rn-120m2-id-2812345678/. '
         || 'Código da oferta: ' || p_codigo || '. Código do anúncio no Zap: 2812345678'
$$;
create function pg_temp.texto_vivareal(p_codigo text) returns text language sql immutable as $$
  select 'Olá! Tenho interesse em sala comercial, Avenida Engenheiro Roberto Freire, 9100 - Ponta Negra, Natal - RN '
         || 'que encontrei no VivaReal: https://www.vivareal.com.br/imovel/sala-comercial-ponta-negra-natal-38m2-aluguel-id-2799990001/. '
         || 'Código do anúncio: ' || p_codigo
$$;

-- Os anúncios: no CRM com o código exato, sem sufixo, com espaço e zeros; e uma
-- linha só do relatório do Canal Pro.
with x as (insert into public.anuncios (codigo, titulo, negocio)
           values ('PT0172_IMOVA', 'Repasse Loja + Casa 172', 'venda') returning id)
insert into t172 select 'an_pt', id from x;
with x as (insert into public.anuncios (codigo, titulo, negocio)
           values ('TE0172', 'Terreno 172', 'venda') returning id)
insert into t172 select 'an_te', id from x;
with x as (insert into public.anuncios (codigo, titulo, negocio)
           values ('Brisa Mall - Loja 072', 'Sala no Brisa Mall 172', 'aluguel') returning id)
insert into t172 select 'an_brisa', id from x;
with x as (insert into public.anuncios_no_canal_pro (codigo, titulo)
           values ('CASA-172-CP', 'Casa só no Canal Pro 172') returning id)
insert into t172 select 'cp_casa', id from x;
-- Uma ficha que já conversa pelo WhatsApp.
with x as (
  insert into public.organizations (kind, name, phone_e164, source_id, collector)
  values ('produtor', 'Paula da Ficha', '+5584981720001',
          (select id from public.sources where slug = 'whatsapp_entrada'), 'pgTAP 172')
  returning id)
insert into t172 select 'ficha_zap', id from x;
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex('+5584981720013'), 'phone', 'pgTAP 172');

select pg_temp.virar('imova');

-- A linha de base do WhatsApp, antes de qualquer lead.
create temp table t172_base as
  select (select count(*) from public.messages where direction = 'out'::app.msg_direction) as saidas,
         (select count(*) from pgmq.q_wa_outbound) as fila,
         (select count(*) from public.wa_acoes) as acoes;

-- =====================================================================
-- 0. A estrutura
-- =====================================================================
select has_column('public', 'portal_leads', 'portal', 'portal_leads diz de qual portal veio');
select has_column('public', 'portal_leads', 'chegada_id', 'portal_leads guarda a chegada de que nasceu');
select has_column('public', 'portal_leads', 'escondido_em', 'portal_leads guarda quando o lead saiu da lista');
select has_trigger('public', 'chegadas', 'chegadas_lead_do_portal', 'o gatilho é em chegadas');
select is((select count(*)::int
             from pg_trigger t join pg_proc p on p.oid = t.tgfoid
            where t.tgrelid in ('public.messages'::regclass, 'public.conversations'::regclass)
              and not t.tgisinternal
              and (p.proname ~* '(portal|chegada)' or p.prosrc ~* '(portal_lead|chegada)')), 0,
  'nenhum gatilho de messages ou conversations sabe dos leads ou das chegadas');
select ok(not exists (select 1 from pg_constraint
                       where conrelid = 'public.portal_leads'::regclass
                         and confrelid in ('public.conversations'::regclass, 'public.messages'::regclass)),
  'nenhuma chave estrangeira de portal_leads para conversations ou messages');
select is((select schedule from cron.job where jobname = 'portal_leads_do_whatsapp'), '*/5 * * * *',
  'a rotina roda a cada 5 minutos');
select ok(not has_function_privilege('authenticated', 'app.portal_lead_da_chegada(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'app.portal_leads_do_whatsapp(integer)', 'execute')
          and not has_function_privilege('anon', 'app.portal_lead_da_chegada(uuid)', 'execute')
          and not has_function_privilege('anon', 'app.portal_lead_anuncio_pelo_codigo(text)', 'execute')
          and not has_function_privilege('authenticated', 'app.portal_lead_da_chegada_gatilho()', 'execute'),
  'as funções novas são só do banco');
-- O `safeupdate` da API recusa UPDATE e DELETE sem WHERE (ver o 123 e o 125).
select is(
  (select count(*)::int
     from pg_proc p
    cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
    where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
      and (p.proname like 'portal_lead%' or p.proname = 'avisos_push_varrer_leads')
      and comando ~* '(^|\n)\s*(update|delete)\s'
      and comando !~* '\swhere\s'),
  0, 'nenhuma função do lead do WhatsApp tem UPDATE ou DELETE sem WHERE');
select ok((select p.prosrc !~* '(insert\s+into\s+public\.messages|update\s+public\.(messages|conversations)|wa_outbound|wa_acoes|pode_enviar)'
             from pg_proc p where p.oid = 'app.portal_lead_da_chegada(uuid)'::regprocedure)
          and (select p.prosrc !~* '(insert\s+into\s+public\.messages|update\s+public\.(messages|conversations)|wa_outbound|wa_acoes|pode_enviar)'
                 from pg_proc p where p.oid = 'app.portal_leads_do_whatsapp(integer)'::regprocedure),
  'nenhuma função nova grava mensagem, mexe na conversa ou toca a saída do WhatsApp');

-- =====================================================================
-- 1. A regra: o texto pronto do ZAP e do Viva Real
-- =====================================================================
select pg_temp.chegou('zap', '+5584981720001', pg_temp.texto_zap('PT0172_IMOVA'),
                      p_ficha => pg_temp.id('ficha_zap'));
select is((select canal || '/' || subcanal_automatico || '/' || regra_slug from public.chegadas
            where id = pg_temp.chegada(pg_temp.id('zap'))),
  'anuncios/portal_zap/texto_do_zap', 'o canal reconhece o texto pronto do ZAP');
select is(pg_temp.leads_de(pg_temp.id('zap')), 1, 'a chegada do ZAP vira um lead');
select is((pg_temp.lead_de(pg_temp.id('zap'))).origin_lead_id,
          'whatsapp:' || pg_temp.chegada(pg_temp.id('zap')),
  'com a chave estável whatsapp:<chegada>');
select is((pg_temp.lead_de(pg_temp.id('zap'))).tipos, array['WHATSAPP_DO_PORTAL'],
  'com o tipo próprio WHATSAPP_DO_PORTAL');
select is((pg_temp.lead_de(pg_temp.id('zap'))).portal, 'zap', 'e diz que veio do ZAP');
select ok((pg_temp.lead_de(pg_temp.id('zap'))).escreveu_em
            = (select inicio_em from public.chegadas where id = pg_temp.chegada(pg_temp.id('zap')))
          and (pg_temp.lead_de(pg_temp.id('zap'))).recebido_em
            = (select inicio_em from public.chegadas where id = pg_temp.chegada(pg_temp.id('zap')))
          and (pg_temp.lead_de(pg_temp.id('zap'))).recebido_no_portal_em is null,
  'escreveu_em e recebido_em são o início da chegada; o portal não avisou nada');
select is((pg_temp.lead_de(pg_temp.id('zap'))).anuncio_id, pg_temp.id('an_pt'),
  'o código da oferta casa com o anúncio do CRM');
select is((pg_temp.lead_de(pg_temp.id('zap'))).origin_listing_id, '2812345678',
  'o número do anúncio no portal vai para origin_listing_id');
select is((pg_temp.lead_de(pg_temp.id('zap'))).transacao, 'SELL', 'o negócio do anúncio diz que quer comprar');
select ok((pg_temp.lead_de(pg_temp.id('zap'))).conversation_id = pg_temp.id('zap')
          and (pg_temp.lead_de(pg_temp.id('zap'))).organization_id = pg_temp.id('ficha_zap'),
  'ligado à conversa e à ficha que a conversa tem');
select is((select k.telefone_e164 from public.portal_lead_contatos k
            where k.lead_id = pg_temp.lead_id(pg_temp.id('zap'))), '+5584981720001',
  'o telefone fica em portal_lead_contatos');
select ok(exists (select 1 from public.activities a
                   where a.metadata ->> 'portal_lead_id' = pg_temp.lead_id(pg_temp.id('zap'))::text
                     and a.body = 'Lead do portal: anúncio PT0172_IMOVA (mandou mensagem no WhatsApp pelo ZAP Imóveis)'
                     and a.occurred_at = (pg_temp.lead_de(pg_temp.id('zap'))).escreveu_em),
  'a ficha ganha a atividade "Lead do portal", na hora da chegada');

-- Uma vez só.
select app.chegadas_rodar(1000);
select is(app.portal_lead_da_chegada(pg_temp.chegada(pg_temp.id('zap'))), 'ja_existia',
  'chamar de novo não cria outro');
select is((app.portal_leads_do_whatsapp() ->> 'criados')::int, 0, 'a rotina não cria nada que já existe');
select is(pg_temp.leads_de(pg_temp.id('zap')), 1, 'e continua um lead só');

-- O Viva Real, com o código do Canal Pro (espaço, caixa e zero diferentes).
select pg_temp.chegou('vr', '+5584981720002', pg_temp.texto_vivareal('BRISA MALL - loja 72'));
select is((select subcanal_automatico from public.chegadas where id = pg_temp.chegada(pg_temp.id('vr'))),
  'portal_vivareal', 'o canal reconhece o texto pronto do Viva Real');
select is(pg_temp.leads_de(pg_temp.id('vr')), 1, 'a chegada do Viva Real vira um lead');
select is((pg_temp.lead_de(pg_temp.id('vr'))).portal, 'vivareal', 'e diz que veio do Viva Real');
select ok((pg_temp.lead_de(pg_temp.id('vr'))).client_listing_id = 'BRISA MALL - loja 72'
          and (pg_temp.lead_de(pg_temp.id('vr'))).anuncio_id = pg_temp.id('an_brisa'),
  '"Código do anúncio: BRISA MALL - loja 72" casa com "Brisa Mall - Loja 072"');
select is((pg_temp.lead_de(pg_temp.id('vr'))).transacao, 'RENT', 'o anúncio de aluguel diz que quer alugar');
select ok((pg_temp.lead_de(pg_temp.id('vr'))).organization_id is null
          and (pg_temp.lead_de(pg_temp.id('vr'))).conversation_id = pg_temp.id('vr'),
  'sem ficha ainda: ligado à conversa');

-- Com o sufixo no texto e sem no anúncio; e a linha só do relatório.
select pg_temp.chegou('sufixo', '+5584981720003', pg_temp.texto_zap('TE0172_IMOVA'));
select is((pg_temp.lead_de(pg_temp.id('sufixo'))).anuncio_id, pg_temp.id('an_te'),
  '"TE0172_IMOVA" no texto casa com o anúncio TE0172 (sem o sufixo)');
select pg_temp.chegou('relatorio', '+5584981720004', pg_temp.texto_zap('CASA-172-CP'));
select ok((pg_temp.lead_de(pg_temp.id('relatorio'))).anuncio_no_canal_pro_id = pg_temp.id('cp_casa')
          and (pg_temp.lead_de(pg_temp.id('relatorio'))).anuncio_id is null,
  'o código que só está no relatório do Canal Pro casa com a linha dele');

-- =====================================================================
-- 2. O que não é de portal não vira lead
-- =====================================================================
select pg_temp.chegou('placa', '+5584981720005', 'Passei em frente e vi a placa de vende');
select pg_temp.chegou('oi', '+5584981720006', 'Oi, tudo bem?');
select pg_temp.chegou('meta', '+5584981720007', 'Olá! Quero mais informações',
                      p_conteudo => '{"anuncio": {"tipo": "ad", "titulo": "Apto Ponta Negra", "id": "172"}}'::jsonb);
-- A ordem é a da conversa, e não `inicio_em`: as três chegadas nascem no mesmo
-- instante da transação, e o empate deixava a ordem ao acaso.
select is((select string_agg(c.canal || '/' || c.subcanal_automatico, ','
                             order by case c.conversation_id
                                        when pg_temp.id('placa') then 1
                                        when pg_temp.id('oi') then 2
                                        else 3
                                      end)
             from public.chegadas c
            where c.conversation_id in (pg_temp.id('placa'), pg_temp.id('oi'), pg_temp.id('meta'))),
  'placa/texto_da_placa,nao_identificado/desconhecido,anuncios/meta_anuncio',
  'placa, "Oi" e o anúncio da Meta têm os canais deles');
select is(pg_temp.leads_de(pg_temp.id('placa')) + pg_temp.leads_de(pg_temp.id('oi'))
          + pg_temp.leads_de(pg_temp.id('meta')), 0,
  'e nenhum vira lead (o anúncio da Meta é Anúncios, mas não é portal)');

-- =====================================================================
-- 3. A correção de gente
-- =====================================================================
select pg_temp.sdr();
select is(public.chegada_marcar(pg_temp.chegada(pg_temp.id('oi')), 'anuncios', 'portal_vivareal') ->> 'ok',
  'true', 'o SDR corrige o "Oi" para Anúncios · Viva Real');
select pg_temp.sair();
select is(pg_temp.leads_de(pg_temp.id('oi')), 1, 'a correção de gente cria o lead');
select ok((pg_temp.lead_de(pg_temp.id('oi'))).portal = 'vivareal'
          and (pg_temp.lead_de(pg_temp.id('oi'))).payload ->> 'decidido_por' = 'gente'
          and (pg_temp.lead_de(pg_temp.id('oi'))).client_listing_id is null,
  'com o portal da correção, quem decidiu e sem código (o texto não tinha)');
select pg_temp.gestor();
select is(public.chegada_marcar(pg_temp.chegada(pg_temp.id('oi')), 'placa') ->> 'ok', 'true',
  'o gestor desmarca: era placa');
select is((select count(*)::int from public.portal_leads_na_lista where id = pg_temp.lead_id(pg_temp.id('oi'))), 0,
  'o lead que ninguém mexeu sai da lista');
select pg_temp.sair();
select ok((pg_temp.lead_de(pg_temp.id('oi'))).escondido_em is not null
          and (pg_temp.lead_de(pg_temp.id('oi'))).motivo_escondido like 'A chegada passou a ser Placa%',
  'escondido, com o motivo, e não apagado');
select pg_temp.gestor();
select public.chegada_marcar(pg_temp.chegada(pg_temp.id('oi')), 'anuncios', 'portal_zap');
select is((select portal from public.portal_leads_na_lista where id = pg_temp.lead_id(pg_temp.id('oi'))), 'zap',
  'marcar portal de novo traz o mesmo lead de volta, com o portal novo');
select is((public.portal_lead_assumir(pg_temp.lead_id(pg_temp.id('oi')))) ->> 'ok', 'true',
  'o gestor assume o lead');
select public.chegada_marcar(pg_temp.chegada(pg_temp.id('oi')), 'outros', 'indicacao');
select is((select count(*)::int from public.portal_leads_na_lista where id = pg_temp.lead_id(pg_temp.id('oi'))), 1,
  'o lead que alguém já assumiu fica na lista, mesmo desmarcado');
select pg_temp.sair();
select is(pg_temp.leads_de(pg_temp.id('oi')), 1, 'e é sempre o mesmo lead, nunca outro');

-- =====================================================================
-- 4. Quem vê
-- =====================================================================
select pg_temp.gestor();
select is((pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('zap')))).grupo, 'mensagem',
  'o gestor vê o lead em "Mandaram mensagem"');
select ok((pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('zap')))).chegou_por = 'whatsapp'
          and (pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('zap')))).portal = 'zap'
          and (pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('zap')))).anuncio_codigo = 'PT0172_IMOVA'
          and (pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('zap')))).conversation_id = pg_temp.id('zap'),
  'chegou pelo WhatsApp, do ZAP, do anúncio PT0172_IMOVA, com a conversa');
select ok((pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('zap')))).primeira_mensagem like 'Olá! Tenho interesse em casa%'
          and (pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('zap')))).chegou_em
              = (pg_temp.lead_de(pg_temp.id('zap'))).escreveu_em
          and (pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('zap')))).situacao = 'novo',
  'a primeira mensagem é o texto pronto, chegou na hora da chegada, e está sem resposta');
select ok((pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('vr')))).phone_e164 = '+5584981720002'
          and not (pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('vr')))).phone_is_masked
          and (pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('vr')))).ficha_nome = 'Perfil vr',
  'sem ficha: o gestor vê o telefone inteiro e o nome do perfil do WhatsApp');
select is((select count(*)::int from public.portal_lead_contatos
            where lead_id = pg_temp.lead_id(pg_temp.id('vr'))), 1, 'o gestor lê portal_lead_contatos');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000017203'::uuid, 'admin');
select is((pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('vr')))).phone_e164, '+5584981720002',
  'o admin também vê o telefone inteiro');
select pg_temp.sair();
select pg_temp.sdr();
select ok((pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('vr')))).phone_is_masked
          and (pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('vr')))).phone_e164 <> '+5584981720002',
  'o SDR vê o lead, com o telefone mascarado');
select ok((pg_temp.na_lista(pg_temp.lead_id(pg_temp.id('zap')))).phone_is_masked,
  'também na ficha (o telefone da ficha, mascarado como em todo o CRM)');
select is((select count(*)::int from public.portal_lead_contatos
            where lead_id = pg_temp.lead_id(pg_temp.id('vr'))), 0, 'o SDR não lê portal_lead_contatos');
select is(public.portal_lead_revelar_telefone(pg_temp.lead_id(pg_temp.id('vr'))), '+5584981720002',
  'e revela pelo botão');
select pg_temp.sair();
select ok(exists (select 1 from public.pii_access_log
                   where entity_type = 'portal_lead' and entity_id = pg_temp.lead_id(pg_temp.id('vr'))
                     and actor_id = 'a0000000-0000-4000-8000-000000017202'::uuid),
  'com registro em pii_access_log');
select pg_temp.entrar('a0000000-0000-4000-8000-000000017204'::uuid, 'embaixador');
select is((select count(*)::int from public.portal_leads_na_lista), 0, 'o embaixador não vê a lista');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000017205'::uuid, 'leitura');
select is((select count(*)::int from public.portal_leads_na_lista), 0, 'quem só lê também não');
select pg_temp.sair();

-- =====================================================================
-- 5. Sem lead dobrado: o CLICK_WHATSAPP do Grupo OLX da mesma pessoa
-- =====================================================================
-- O webhook chega depois (o Grupo OLX passou a mandar), com o clique 5 minutos
-- antes da mensagem.
select pg_temp.receber('w172-par', '84981720001',
                       (pg_temp.lead_de(pg_temp.id('zap'))).escreveu_em - interval '5 minutes', 'CLICK_WHATSAPP')
  is not null as webhook_gravou;
select is((select count(*)::int from public.portal_leads l
            join public.portal_lead_contatos k on k.lead_id = l.id
           where k.telefone_e164 = '+5584981720001'), 2,
  'no banco são dois leads da mesma pessoa (o do WhatsApp e o do webhook)');
select pg_temp.gestor();
select is(pg_temp.na_lista_da_conversa(pg_temp.id('zap')), 1, 'e a lista mostra a pessoa uma vez só');
select is((select id from public.portal_leads_na_lista where conversation_id = pg_temp.id('zap')),
          pg_temp.lead_id(pg_temp.id('zap')),
  'o que chegou primeiro (o do WhatsApp) fica');
select is((select leads from public.anuncios_na_lista where id = pg_temp.id('an_pt')), 1,
  'e a conta do anúncio na lista de Anúncios é 1');
select pg_temp.sair();

-- O webhook tinha chegado antes (na hora do clique): fica ele, com o portal do par.
update public.portal_leads set recebido_em = recebido_no_portal_em
 where origem = 'grupo_olx' and origin_lead_id = 'w172-par';
select pg_temp.gestor();
select is(pg_temp.na_lista_da_conversa(pg_temp.id('zap')), 1, 'com o webhook primeiro, também uma vez só');
select ok((select origem || '/' || portal from public.portal_leads_na_lista where conversation_id = pg_temp.id('zap'))
            = 'grupo_olx/zap',
  'fica o do Grupo OLX, que ganha o portal do par');
select is((public.portal_lead_assumir(pg_temp.lead_id(pg_temp.id('zap')))) ->> 'ok', 'true',
  'mexer no do WhatsApp (pelo id, como a ficha aberta faz)');
select is((select id from public.portal_leads_na_lista where conversation_id = pg_temp.id('zap')),
          pg_temp.lead_id(pg_temp.id('zap')),
  'o que alguém mexeu fica, mesmo tendo chegado depois');
select is((select leads from public.anuncios_na_lista where id = pg_temp.id('an_pt')), 1,
  'e a conta do anúncio continua 1');
select pg_temp.sair();

-- Fora da janela (o clique 3 dias antes da mensagem): são duas pessoas para a lista.
select pg_temp.chegou('fora', '+5584981720008', pg_temp.texto_zap('PT0172_IMOVA'));
select pg_temp.receber('w172-fora', '84981720008',
                       (pg_temp.lead_de(pg_temp.id('fora'))).escreveu_em - interval '3 days', 'CLICK_WHATSAPP')
  is not null as webhook_gravou;
select pg_temp.gestor();
select is(pg_temp.na_lista_da_conversa(pg_temp.id('fora')), 2,
  'clique fora da janela de −24 h a +15 min: os dois ficam');
select pg_temp.sair();

-- =====================================================================
-- 6. Sem aviso dobrado
-- =====================================================================
select pg_temp.chegou('agora', '+5584981720009', pg_temp.texto_zap('PT0172_IMOVA'), now() - interval '1 minute');
select is(pg_temp.leads_de(pg_temp.id('agora')), 1,
  'a mensagem de agora vira lead na mesma rodada (a regra forte não espera as 24 h)');
select pg_temp.receber('w172-form', '84981720010', now(), 'CONTACT_FORM', '{"message": "Tem garagem?"}');
select app.avisos_push_varrer_leads();
select is((select count(*)::int from app.push_fila
            where tipo = 'lead_portal' and chave like 'lead_portal:' || pg_temp.lead_id(pg_temp.id('agora')) || ':%'), 0,
  'o lead do WhatsApp não põe o aviso "Lead novo dos portais" na fila');
select cmp_ok((select count(*)::int from app.push_fila
                where tipo = 'lead_portal'
                  and chave like 'lead_portal:' || (select (r ->> 'lead_id') from t172_r where chave = 'w172-form') || ':%'),
  '>=', 2, 'o lead que escreveu pelo portal continua avisando');

-- =====================================================================
-- 7. A rotina: a chegada antiga, a ficha que veio depois e o erro engolido
-- =====================================================================
-- A chegada de antes desta migração (aqui, sem o gatilho).
alter table public.chegadas disable trigger chegadas_lead_do_portal;
alter table public.chegadas disable trigger chegadas_lead_do_portal_ao_nascer;
select pg_temp.chegou('antiga', '+5584981720011', pg_temp.texto_zap('PT0172_IMOVA'));
alter table public.chegadas enable trigger chegadas_lead_do_portal;
alter table public.chegadas enable trigger chegadas_lead_do_portal_ao_nascer;
select is(pg_temp.leads_de(pg_temp.id('antiga')), 0, 'sem o gatilho, a chegada antiga ainda não é lead');
select cmp_ok((app.portal_leads_do_whatsapp() ->> 'criados')::int, '>=', 1, 'a rotina a transforma em lead');
select is(pg_temp.leads_de(pg_temp.id('antiga')), 1, 'um lead');
select app.portal_leads_do_whatsapp();
select is(pg_temp.leads_de(pg_temp.id('antiga')), 1, 'rodando de novo, continua um só');

-- A ficha que a ficha automática criou depois do lead.
with x as (
  insert into public.organizations (kind, name, phone_e164, source_id, collector)
  values ('produtor', 'Vera da Ficha Nova', '+5584981720002',
          (select id from public.sources where slug = 'whatsapp_entrada'), 'pgTAP 172')
  returning id)
insert into t172 select 'ficha_vr', id from x;
update public.conversations set organization_id = pg_temp.id('ficha_vr') where id = pg_temp.id('vr');
select cmp_ok((app.portal_leads_do_whatsapp() ->> 'fichas')::int, '>=', 1, 'a rotina acha a ficha que veio depois');
select is((pg_temp.lead_de(pg_temp.id('vr'))).organization_id, pg_temp.id('ficha_vr'), 'e liga o lead a ela');
select ok(exists (select 1 from public.activities a
                   where a.organization_id = pg_temp.id('ficha_vr')
                     and a.metadata ->> 'portal_lead_id' = pg_temp.lead_id(pg_temp.id('vr'))::text
                     and a.body like 'Lead do portal: anúncio BRISA MALL - loja 72 (mandou mensagem no WhatsApp pelo Viva Real)'),
  'com a atividade "Lead do portal" na ficha');

-- O erro do lead não derruba a chegada nem a correção.
alter table public.portal_leads add constraint t172_quebra check (origem <> 'whatsapp') not valid;
select pg_temp.chegou('erro', '+5584981720012', pg_temp.texto_zap('PT0172_IMOVA'));
select ok((select canal = 'anuncios' and subcanal_automatico = 'portal_zap' and situacao = 'fechada'
             from public.chegadas where id = pg_temp.chegada(pg_temp.id('erro')))
          and pg_temp.leads_de(pg_temp.id('erro')) = 0,
  'com o lead falhando, a chegada é gravada e fechada do mesmo jeito (o gatilho engole o erro)');
select pg_temp.gestor();
select is(public.chegada_marcar(pg_temp.chegada(pg_temp.id('placa')), 'anuncios', 'portal_olx') ->> 'ok', 'true',
  'e a correção de gente também passa');
select pg_temp.sair();
alter table public.portal_leads drop constraint t172_quebra;
select app.portal_leads_do_whatsapp();
select ok(pg_temp.leads_de(pg_temp.id('erro')) = 1 and pg_temp.leads_de(pg_temp.id('placa')) = 1
          and (pg_temp.lead_de(pg_temp.id('placa'))).portal = 'olx',
  'a rotina refaz o que o gatilho não conseguiu');
select ok((pg_temp.lead_de(pg_temp.id('oi'))).escondido_em is null,
  'e não esconde o lead que alguém assumiu, mesmo com a chegada fora de portal');

-- Telefone que pediu para sair: o lead fica marcado, sem contato nem conversa.
select pg_temp.chegou('suprimido', '+5584981720013', pg_temp.texto_zap('PT0172_IMOVA'));
select ok((pg_temp.lead_de(pg_temp.id('suprimido'))).suprimido
          and (pg_temp.lead_de(pg_temp.id('suprimido'))).conversation_id is null
          and not exists (select 1 from public.portal_lead_contatos
                           where lead_id = pg_temp.lead_id(pg_temp.id('suprimido'))),
  'telefone suprimido: lead marcado, sem telefone guardado e sem conversa');

-- =====================================================================
-- 8. A KOMUNE
-- =====================================================================
select pg_temp.chegou('komune', '+5584981720014', 'Oi, boa noite');
select pg_temp.virar('komune');
update public.chegadas
   set canal_marcado = 'anuncios', subcanal_marcado = 'portal_zap', marcado_em = now()
 where id = pg_temp.chegada(pg_temp.id('komune'));
select is(pg_temp.leads_de(pg_temp.id('komune')), 0, 'com a identidade "komune", a chegada de portal não vira lead');
select is(app.portal_lead_da_chegada(pg_temp.chegada(pg_temp.id('komune'))), 'fora_da_imova',
  'a função diz por quê');
select is(app.portal_leads_do_whatsapp(), '{"ligada": false}'::jsonb, 'e a rotina não faz nada');
select pg_temp.virar('imova');

-- =====================================================================
-- 10. O par só com o clique puro, do mesmo anúncio, e um por grupo
-- =====================================================================
-- Quantos da lista (como a gestão vê) estão entre estes ids.
create function pg_temp.na_lista_entre(p_ids uuid[]) returns int language sql stable as $$
  select count(*)::int from public.portal_leads_na_lista where id = any (p_ids)
$$;
grant execute on function pg_temp.na_lista_entre(uuid[]) to authenticated;
create function pg_temp.webhook(p_chave text) returns uuid language sql stable as $$
  select id from public.portal_leads where origem = 'grupo_olx' and origin_lead_id = p_chave
$$;
grant execute on function pg_temp.webhook(text) to authenticated;
create function pg_temp.leads_do_anuncio(p_anuncio uuid) returns int language sql stable as $$
  select leads from public.anuncios_na_lista where id = p_anuncio
$$;
grant execute on function pg_temp.leads_do_anuncio(uuid) to authenticated;
create temp table t172_conta (chave text primary key, n int);
grant select, insert on t172_conta to authenticated;

-- a. A mensagem no WhatsApp pelo ZAP (PT0172) e, 10 minutos depois, um pedido de
--    visita em OUTRO anúncio (TE0172): são dois contatos (cenário do revisor).
select pg_temp.gestor();
insert into t172_conta values ('te_antes', pg_temp.leads_do_anuncio(pg_temp.id('an_te')));
select pg_temp.sair();
select pg_temp.chegou('d', '+5584981720021', pg_temp.texto_zap('PT0172_IMOVA'), now() - interval '60 minutes');
select pg_temp.receber('w172-visita', '84981720021', now() - interval '50 minutes', 'VISIT_REQUEST',
                       '{"message": "Quero visitar sábado", "clientListingId": "TE0172"}'::jsonb)
  is not null as webhook_gravou;
select app.avisos_push_varrer_leads();
select pg_temp.gestor();
select is(pg_temp.na_lista_entre(array[pg_temp.lead_id(pg_temp.id('d')), pg_temp.webhook('w172-visita')]), 2,
  'a visita pedida no portal não some atrás da mensagem no WhatsApp: os dois na lista');
select is(pg_temp.leads_do_anuncio(pg_temp.id('an_te')), (select n from t172_conta where chave = 'te_antes') + 1,
  'e a visita conta para o anúncio dela');
select pg_temp.sair();
select ok(exists (select 1 from app.push_fila f
                   where f.tipo = 'lead_portal'
                     and f.caminho = '/anuncios/leads?lead=' || pg_temp.webhook('w172-visita')),
  'o aviso "pediu uma visita" abre esse lead, que a lista mostra');

-- b. Clique puro, mas em outro anúncio: dois contatos.
select pg_temp.chegou('e', '+5584981720022', pg_temp.texto_zap('PT0172_IMOVA'));
select pg_temp.receber('w172-outro', '84981720022',
                       (pg_temp.lead_de(pg_temp.id('e'))).escreveu_em - interval '5 minutes', 'CLICK_WHATSAPP',
                       '{"clientListingId": "TE0172"}'::jsonb) is not null as webhook_gravou;
select pg_temp.gestor();
select is(pg_temp.na_lista_entre(array[pg_temp.lead_id(pg_temp.id('e')), pg_temp.webhook('w172-outro')]), 2,
  'o clique no WhatsApp de outro anúncio não forma par');
select pg_temp.sair();

-- c. Clique puro sem o código do anúncio: forma par (um lado sem anúncio).
select pg_temp.chegou('f', '+5584981720023', pg_temp.texto_zap('PT0172_IMOVA'));
select pg_temp.receber('w172-semcod', '84981720023',
                       (pg_temp.lead_de(pg_temp.id('f'))).escreveu_em - interval '5 minutes', 'CLICK_WHATSAPP',
                       '{"clientListingId": null}'::jsonb) is not null as webhook_gravou;
select pg_temp.gestor();
select is(pg_temp.na_lista_entre(array[pg_temp.lead_id(pg_temp.id('f')), pg_temp.webhook('w172-semcod')]), 1,
  'o clique sem código do anúncio forma par com a mensagem');
select pg_temp.sair();

-- d. Cadeia (cenário B do revisor): formulário em TE0172 (assumido), clique em
--    PT0172 e a mensagem no WhatsApp em PT0172.
select pg_temp.gestor();
insert into t172_conta values ('b_te', pg_temp.leads_do_anuncio(pg_temp.id('an_te'))),
                              ('b_pt', pg_temp.leads_do_anuncio(pg_temp.id('an_pt')));
select pg_temp.sair();
select pg_temp.receber('w172-b1', '84981720024', now() - interval '2 days 3 hours', 'CONTACT_FORM',
                       '{"message": "Quero visitar o terreno", "clientListingId": "TE0172"}'::jsonb)
  is not null as webhook_gravou;
select pg_temp.receber('w172-b2', '84981720024', now() - interval '2 days 2 hours', 'CLICK_WHATSAPP')
  is not null as webhook_gravou;
select pg_temp.chegou('b', '+5584981720024', pg_temp.texto_zap('PT0172_IMOVA'));
select pg_temp.gestor();
select is((public.portal_lead_assumir(pg_temp.webhook('w172-b1'))) ->> 'ok', 'true', 'o gestor assume o formulário');
select ok(pg_temp.na_lista_entre(array[pg_temp.webhook('w172-b1')]) = 1
          and pg_temp.na_lista_entre(array[pg_temp.webhook('w172-b2'), pg_temp.lead_id(pg_temp.id('b'))]) = 1,
  'o formulário aparece, e o clique com a mensagem aparecem uma vez (o vencedor do par não some por outro par)');
select ok(pg_temp.leads_do_anuncio(pg_temp.id('an_te')) = (select n from t172_conta where chave = 'b_te') + 1
          and pg_temp.leads_do_anuncio(pg_temp.id('an_pt')) = (select n from t172_conta where chave = 'b_pt') + 1,
  'cada anúncio conta o seu: TE0172 o formulário, PT0172 a mensagem');
select pg_temp.sair();

-- e. Dois cliques puros e a mensagem: um grupo, um na lista; quem alguém mexeu fica.
select pg_temp.chegou('h', '+5584981720025', pg_temp.texto_zap('PT0172_IMOVA'));
select pg_temp.receber('w172-h1', '84981720025',
                       (pg_temp.lead_de(pg_temp.id('h'))).escreveu_em - interval '30 minutes', 'CLICK_WHATSAPP')
  is not null as webhook_gravou;
select pg_temp.receber('w172-h2', '84981720025',
                       (pg_temp.lead_de(pg_temp.id('h'))).escreveu_em - interval '10 minutes', 'CLICK_WHATSAPP')
  is not null as webhook_gravou;
select pg_temp.gestor();
select is(pg_temp.na_lista_entre(array[pg_temp.lead_id(pg_temp.id('h')), pg_temp.webhook('w172-h1'),
                                       pg_temp.webhook('w172-h2')]), 1,
  'dois cliques e a mensagem da mesma pessoa e anúncio: um só na lista');
select public.portal_lead_assumir(pg_temp.webhook('w172-h2'));
select ok(pg_temp.na_lista_entre(array[pg_temp.webhook('w172-h2')]) = 1
          and pg_temp.na_lista_entre(array[pg_temp.lead_id(pg_temp.id('h')), pg_temp.webhook('w172-h1')]) = 0,
  'o que alguém assumiu é o que fica');
select pg_temp.sair();

-- =====================================================================
-- 11. O código do anúncio não come o resto da frase
-- =====================================================================
select pg_temp.chegou('virgula', '+5584981720031',
  'Olá! Tenho interesse que encontrei no Zap: https://www.zapimoveis.com.br/imovel/x-id-2812345678/. Código da oferta: TE0172, gostaria de visitar amanhã');
select ok((pg_temp.lead_de(pg_temp.id('virgula'))).client_listing_id = 'TE0172'
          and (pg_temp.lead_de(pg_temp.id('virgula'))).anuncio_id = pg_temp.id('an_te'),
  '"TE0172, gostaria de visitar amanhã": o código é TE0172, com o anúncio');
select pg_temp.chegou('colado', '+5584981720032',
  'Olá! Tenho interesse em casa que encontrei no Zap. Código da oferta: PT0172_IMOVA.Obrigado');
select ok((pg_temp.lead_de(pg_temp.id('colado'))).client_listing_id = 'PT0172_IMOVA'
          and (pg_temp.lead_de(pg_temp.id('colado'))).anuncio_id = pg_temp.id('an_pt'),
  '"PT0172_IMOVA.Obrigado": o ponto colado fecha o código');
select pg_temp.chegou('palavra', '+5584981720033',
  'Olá! Tenho interesse em terreno que encontrei no Zap. Código da oferta: TE0172 quero visitar');
select ok((pg_temp.lead_de(pg_temp.id('palavra'))).client_listing_id = 'TE0172'
          and (pg_temp.lead_de(pg_temp.id('palavra'))).anuncio_id = pg_temp.id('an_te'),
  'sem pontuação, vale a primeira palavra que acha o anúncio');
select pg_temp.chegou('brisa', '+5584981720034', pg_temp.texto_vivareal('Brisa Mall - Loja 072, obrigado'));
select ok((pg_temp.lead_de(pg_temp.id('brisa'))).client_listing_id = 'Brisa Mall - Loja 072'
          and (pg_temp.lead_de(pg_temp.id('brisa'))).anuncio_id = pg_temp.id('an_brisa'),
  'o código com espaço do Canal Pro fica inteiro, sem o que vem depois da vírgula');
select is(app.portal_codigo_no_texto('Código do anúncio: Terreno Bonor 10.000'), 'Terreno Bonor 10.000',
  'o ponto entre algarismos é do código');
select pg_temp.chegou('depois', '+5584981720035', pg_temp.texto_zap('CO0172'));
select ok((pg_temp.lead_de(pg_temp.id('depois'))).client_listing_id = 'CO0172'
          and (pg_temp.lead_de(pg_temp.id('depois'))).anuncio_id is null,
  'código sem anúncio no CRM: o lead fica com o código, sem anúncio');
with x as (insert into public.anuncios (codigo, titulo, negocio)
           values ('CO0172', 'Loja 172', 'aluguel') returning id)
insert into t172 select 'an_co', id from x;
select app.portal_lead_da_chegada(pg_temp.chegada(pg_temp.id('depois')));
select ok((pg_temp.lead_de(pg_temp.id('depois'))).anuncio_id = pg_temp.id('an_co')
          and (pg_temp.lead_de(pg_temp.id('depois'))).transacao = 'RENT',
  'o anúncio que entrou depois é ligado ao lead que estava sem nenhum');

-- =====================================================================
-- 12. O caminho até o primeiro lead conta o que a lista mostra
-- =====================================================================
select pg_temp.chegou('c', '+5584981720041', pg_temp.texto_zap('TE0172'), now() - interval '1 hour');
select pg_temp.gestor();
select public.chegada_marcar(pg_temp.chegada(pg_temp.id('c')), 'placa', 'texto_da_placa');
select pg_temp.sair();
select ok((pg_temp.lead_de(pg_temp.id('c'))).escondido_em is not null, 'o lead do WhatsApp desmarcado saiu da lista');
select pg_temp.gestor();
select is((public.anuncios_caminho_do_lead() -> 'leads' ->> 'total')::int,
          (select count(*)::int from public.portal_leads_na_lista),
  'o caminho conta os leads que a lista mostra (sem o escondido e com o par uma vez)');
select ok(exists (select 1 from public.portal_leads_na_lista
                   where id::text = public.anuncios_caminho_do_lead() -> 'leads' -> 'ultimo' ->> 'id'),
  'e o último lead do caminho é um que a lista mostra');
select pg_temp.sair();
select is(pg_temp.leads_de(pg_temp.id('c')), 1, 'o lead escondido continua no banco (nada é apagado)');

-- O gatilho põe 1 s de espera de trava só na parte do lead, e devolve o que havia.
set local lock_timeout = '7s';
select pg_temp.gestor();
select public.chegada_marcar(pg_temp.chegada(pg_temp.id('c')), 'anuncios', 'portal_zap');
select is(current_setting('lock_timeout'), '7s', 'o gatilho devolve o lock_timeout de antes');
select pg_temp.sair();
-- A rotina de 5 min também devolve (a migração a chama e segue com o cron).
select app.portal_leads_do_whatsapp();
select is(current_setting('lock_timeout'), '7s', 'a rotina devolve o lock_timeout de antes');
reset lock_timeout;

-- =====================================================================
-- 9. O WhatsApp não é tocado
-- =====================================================================
create temp table t172_k as
  select row(c.status, c.bot_paused, c.window_expires_at, c.unread_count, c.assignee_id,
             c.last_message_at, c.snoozed_until, c.arquivada_em, c.organization_id, c.updated_at)::text as antes
    from public.conversations c where c.id = pg_temp.id('zap');
select app.portal_leads_do_whatsapp();
select app.portal_lead_da_chegada(pg_temp.chegada(pg_temp.id('zap')));
select pg_temp.gestor();
select public.chegada_marcar(pg_temp.chegada(pg_temp.id('zap')), 'anuncios', 'portal_vivareal');
select pg_temp.sair();
select is((select row(c.status, c.bot_paused, c.window_expires_at, c.unread_count, c.assignee_id,
                      c.last_message_at, c.snoozed_until, c.arquivada_em, c.organization_id, c.updated_at)::text
             from public.conversations c where c.id = pg_temp.id('zap')),
  (select antes from t172_k), 'a conversa fica igual, até o updated_at');
select is((select count(*) from public.messages where direction = 'out'::app.msg_direction),
  (select saidas from t172_base), 'nenhuma mensagem de saída nasceu');
select ok((select count(*) from pgmq.q_wa_outbound) = (select fila from t172_base)
          and (select count(*) from public.wa_acoes) = (select acoes from t172_base),
  'e nada entrou na fila de saída nem nas ações do WhatsApp');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — O lead do portal só entra no CRM quando a pessoa manda mensagem
-- (migração 20261105130000), só na Imova
--
-- Este arquivo prova:
--
--   1. QUEM SÓ CLICOU espera: sem ficha, sem atividade; o contato que o portal
--      mandou fica à parte (portal_lead_contatos), que só a gestão lê;
--   2. QUEM LÊ: a gestão vê o telefone inteiro na lista, o SDR mascarado e
--      revela com registro; o embaixador não vê nada;
--   3. A MENSAGEM PELO WHATSAPP liga o lead à conversa do mesmo telefone, só se
--      chegou depois do clique; a primeira resposta do time (não a do robô)
--      vira "respondido" sozinha;
--   4. A MENSAGEM PELO PORTAL depois do clique dá a ficha naquela hora;
--   5. TELEFONE SUPRIMIDO não guarda contato;
--   6. A ROTINA DE 15 MINUTOS grava a conversa, põe a atividade na ficha e, em
--      90 dias, apaga o contato;
--   7. O WHATSAPP NÃO MUDA: nada sai, nada entra na fila, e nenhuma chave
--      estrangeira (gatilho por dentro) aponta para conversations.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(43);

insert into public.allowed_users (email, role, note) values
  ('a127.g@teste.local', 'gestor', 'pgTAP leads só com mensagem'),
  ('a127.s@teste.local', 'sdr', 'pgTAP leads só com mensagem'),
  ('a127.e@teste.local', 'embaixador', 'pgTAP leads só com mensagem');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000012701'::uuid, 'a127.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000012702'::uuid, 'a127.s@teste.local', '{"full_name":"Sol SDR"}'),
  ('a0000000-0000-4000-8000-000000012703'::uuid, 'a127.e@teste.local', '{"full_name":"Edu Embaixador"}');

insert into public.categories (slug, name, "group", priority, position, komune_category_key, is_active)
values ('comprador', 'Comprador', 'producao', 1, 900, null, true),
       ('locatario', 'Locatário', 'producao', 1, 901, null, true)
on conflict (slug) do update set is_active = true;

update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';

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
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012701'::uuid, 'gestor')
$$;
create function pg_temp.sdr() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012702'::uuid, 'sdr')
$$;
create function pg_temp.embaixador() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012703'::uuid, 'embaixador')
$$;

create temp table t127(chave text primary key, valor uuid);
grant select on t127 to authenticated;
create temp table t127_r(chave text primary key, r jsonb);
grant select on t127_r to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t127 where chave = p_chave
$$;
create function pg_temp.lead_id(p_chave text) returns uuid language sql stable as $$
  select (r ->> 'lead_id')::uuid from t127_r where chave = p_chave
$$;
grant execute on function pg_temp.id(text), pg_temp.lead_id(text) to authenticated;
create function pg_temp.lead(p_chave text) returns public.portal_leads language sql stable as $$
  select * from public.portal_leads where id = pg_temp.lead_id(p_chave)
$$;
-- O clique foi há uma hora, no anúncio do CRM, pelo WhatsApp (o padrão deste arquivo).
create function pg_temp.receber(p_chave text, p_extra jsonb) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  execute 'set local role service_role';
  v := public.grupozap_lead_receber(p_chave,
         jsonb_build_object(
           'leadOrigin', 'Grupo OLX',
           'timestamp', to_char((now() - interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'),
           'originLeadId', p_chave, 'originListingId', '2790000127', 'clientListingId', 'T127-CRM',
           'temperature', 'Alta', 'transactionType', 'SELL',
           'extraData', jsonb_build_object('leadType', 'CLICK_WHATSAPP'))
         || p_extra);
  execute 'reset role';
  insert into t127_r values (p_chave, v) on conflict (chave) do update set r = excluded.r;
  return v;
end $$;
-- Uma conversa de WhatsApp com o telefone, e as mensagens dela (como o 117 faz).
create function pg_temp.conversa(p_chave text, p_tel text, p_ficha uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id, status)
  values ('whatsapp'::app.channel, '+5584999912700', p_tel, p_ficha, 'aguardando_nos')
  returning id into v;
  insert into t127 values (p_chave, v);
  return v;
end $$;
create function pg_temp.dele(p_conv uuid, p_em timestamptz, p_texto text) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_texto, 'system', 'crm', p_em)
$$;
create function pg_temp.nossa(p_conv uuid, p_em timestamptz, p_autor text, p_quem uuid) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'pgtap127 nossa', p_autor, 'echo', p_quem, 'wamid.PGTAP127.' || gen_random_uuid(), p_em, p_em)
$$;
create function pg_temp.na_lista(p_chave text) returns public.portal_leads_na_lista language sql stable as $$
  select * from public.portal_leads_na_lista where id = pg_temp.lead_id(p_chave)
$$;
grant execute on function pg_temp.na_lista(text) to authenticated;

with x as (insert into public.anuncios (codigo, titulo) values ('T127-CRM', 'Terreno em Parnamirim') returning id)
insert into t127 select 'anuncio', id from x;
-- Uma ficha que já conversa pelo WhatsApp (para a atividade da rotina).
with x as (
  insert into public.organizations (kind, name, phone_e164, source_id, collector)
  values ('produtor', 'Zeca da Conversa', '+5584981270004',
          (select id from public.sources where slug = 'whatsapp_entrada'), 'pgTAP 127')
  returning id)
insert into t127 select 'Z', id from x;
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex('+5584981270003'), 'phone', 'pgTAP 127');

create temp table t127_base as
  select (select count(*) from public.messages where direction = 'out'::app.msg_direction) as saidas,
         (select count(*) from pgmq.q_wa_outbound) as fila,
         (select count(*) from public.wa_acoes) as acoes;

-- =====================================================================
-- 0. A estrutura
-- =====================================================================
select ok((select relrowsecurity from pg_class where oid = 'public.portal_lead_contatos'::regclass),
  'portal_lead_contatos nasce com RLS');
select ok(not exists (select 1 from pg_constraint
                       where conrelid = 'public.portal_leads'::regclass
                         and confrelid = 'public.conversations'::regclass),
  'nenhuma chave estrangeira de portal_leads para conversations (seria gatilho lá dentro)');
select is((select schedule from cron.job where jobname = 'portal_leads_manter'), '*/15 * * * *',
  'a rotina roda a cada 15 minutos');
select ok(not has_function_privilege('authenticated', 'app.portal_leads_manter()', 'execute')
          and not has_function_privilege('anon', 'public.portal_lead_revelar_telefone(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.portal_lead_revelar_telefone(uuid)', 'execute'),
  'a rotina é só do banco; revelar é de quem entrou');

-- =====================================================================
-- 1. Quem só clicou espera
-- =====================================================================
select pg_temp.receber('t127-clique', '{"ddd": "84", "phone": "981270001", "name": "Paula  Clique",
                                        "email": "Paula@Teste.local"}'::jsonb);
select is(pg_temp.lead_id('t127-clique') is not null and (select r ->> 'ficha' from t127_r where chave = 't127-clique') = 'aguarda_mensagem',
  true, 'o clique no WhatsApp é guardado e espera a mensagem');
select ok((pg_temp.lead('t127-clique')).organization_id is null, 'sem ficha');
select ok(not exists (select 1 from public.organizations where phone_e164 = '+5584981270001'),
  'e nenhuma ficha nasce com o número');
select ok(not exists (select 1 from public.activities where metadata ->> 'portal_lead_id' = pg_temp.lead_id('t127-clique')::text),
  'nem atividade');
select is((select nome || ' · ' || telefone_e164 || ' · ' || email from public.portal_lead_contatos
            where lead_id = pg_temp.lead_id('t127-clique')),
  'Paula Clique · +5584981270001 · paula@teste.local', 'o contato que o portal mandou fica à parte, normalizado');
select ok(not ((pg_temp.lead('t127-clique')).payload ?| array['name', 'email', 'ddd', 'phone']),
  'e não entra no payload');

-- =====================================================================
-- 2. Quem lê
-- =====================================================================
select pg_temp.gestor();
select is((select grupo || ' · ' || coalesce(chegou_por, '-') || ' · ' || ficha_nome || ' · ' || phone_e164 || ' · ' || phone_is_masked
             from pg_temp.na_lista('t127-clique')),
  'clicou · - · Paula Clique · +5584981270001 · false', 'a gestão vê o clique, com o telefone inteiro');
select is((select count(*)::int from public.portal_lead_contatos where lead_id = pg_temp.lead_id('t127-clique')), 1,
  'e lê a tabela de contatos');
select pg_temp.sair();

select pg_temp.sdr();
select is((select phone_e164 || ' · ' || phone_is_masked from pg_temp.na_lista('t127-clique')),
  '+55 84 •••••-••01 · true', 'o SDR vê o telefone mascarado');
select is((select count(*)::int from public.portal_lead_contatos), 0, 'e não lê a tabela de contatos');
select is(public.portal_lead_revelar_telefone(pg_temp.lead_id('t127-clique')), '+5584981270001',
  'revela pelo botão');
select pg_temp.sair();
select ok(exists (select 1 from public.pii_access_log
                   where action = 'reveal_phone' and entity_type = 'portal_lead'
                     and entity_id = pg_temp.lead_id('t127-clique')
                     and actor_id = 'a0000000-0000-4000-8000-000000012702'::uuid),
  'e a revelação fica registrada');

select pg_temp.embaixador();
select is((select count(*)::int from public.portal_leads_na_lista), 0, 'o embaixador não vê os leads');
select throws_ok(format('select public.portal_lead_revelar_telefone(%L)', pg_temp.lead_id('t127-clique')),
  '42501', null, 'nem revela');
select pg_temp.sair();

-- =====================================================================
-- 3. A mensagem pelo WhatsApp
-- =====================================================================
select pg_temp.conversa('conv_P', '+5584981270001', null);
-- Uma mensagem de dois dias antes do clique não conta.
select pg_temp.dele(pg_temp.id('conv_P'), now() - interval '2 days', 'Conversa antiga');
select pg_temp.gestor();
select is((pg_temp.na_lista('t127-clique')).grupo, 'clicou', 'mensagem de antes do clique não faz o lead');
select pg_temp.sair();

select pg_temp.dele(pg_temp.id('conv_P'), now() - interval '50 minutes', 'Oi, vi o anúncio no ZAP');
select pg_temp.gestor();
select is((select grupo || ' · ' || chegou_por from pg_temp.na_lista('t127-clique')), 'mensagem · whatsapp',
  'a mensagem depois do clique faz o lead, pelo WhatsApp');
select is((pg_temp.na_lista('t127-clique')).conversation_id, pg_temp.id('conv_P'), 'ligado à conversa do mesmo telefone');
select is((pg_temp.na_lista('t127-clique')).chegou_em, now() - interval '50 minutes', 'chegou quando a mensagem chegou');
select is((pg_temp.na_lista('t127-clique')).primeira_mensagem, 'Oi, vi o anúncio no ZAP', 'com a primeira mensagem');
select ok((pg_temp.na_lista('t127-clique')).situacao = 'novo' and (pg_temp.na_lista('t127-clique')).respondido_em is null,
  'ainda sem resposta');
select pg_temp.sair();

select pg_temp.nossa(pg_temp.id('conv_P'), now() - interval '45 minutes', 'bot_fixed', null);
select pg_temp.gestor();
select ok((pg_temp.na_lista('t127-clique')).respondido_em is null, 'a resposta do robô não conta');
select pg_temp.sair();

select pg_temp.nossa(pg_temp.id('conv_P'), now() - interval '40 minutes', 'human',
                     'a0000000-0000-4000-8000-000000012701'::uuid);
select pg_temp.gestor();
select is((select situacao || ' · ' || respondido_por_nome || ' · ' || situacao_registrada
             from pg_temp.na_lista('t127-clique')),
  'respondido · Gil Gestor · novo', 'a resposta do time vira "respondido" sozinha, sem mexer na situação gravada');
select is((pg_temp.na_lista('t127-clique')).respondido_em, now() - interval '40 minutes', 'com a hora da resposta');
select is((select leads from public.anuncios_na_lista where id = pg_temp.id('anuncio')), 1,
  'a lista de Anúncios conta o lead que mandou mensagem');
select pg_temp.sair();

-- =====================================================================
-- 4. Clicou antes, escreveu pelo portal depois
-- =====================================================================
select pg_temp.receber('t127-depois', '{"ddd": "84", "phone": "981270002", "name": "Rui Depois"}'::jsonb);
select ok((pg_temp.lead('t127-depois')).organization_id is null, 'o clique espera');
select pg_temp.receber('t127-depois', '{"extraData": {"leadType": "CONTACT_FORM"}}'::jsonb);
select ok((pg_temp.lead('t127-depois')).organization_id is not null, 'o formulário depois dá a ficha naquela hora');
select ok(exists (select 1 from public.activities
                   where organization_id = (pg_temp.lead('t127-depois')).organization_id
                     and body = 'Lead do portal: anúncio T127-CRM (preencheu o formulário)'),
  'com a atividade do formulário');
select pg_temp.gestor();
select is((select grupo || ' · ' || chegou_por from pg_temp.na_lista('t127-depois')), 'mensagem · formulario',
  'e entra na lista principal, pelo formulário');
select pg_temp.sair();

-- =====================================================================
-- 5. Telefone suprimido
-- =====================================================================
select pg_temp.receber('t127-sup', '{"ddd": "84", "phone": "981270003", "name": "Saiu", "email": "s@teste.local"}'::jsonb);
select ok((pg_temp.lead('t127-sup')).suprimido
          and not exists (select 1 from public.portal_lead_contatos where lead_id = pg_temp.lead_id('t127-sup')),
  'telefone suprimido: o lead fica marcado e nenhum contato é guardado');

-- =====================================================================
-- 6. A rotina de 15 minutos
-- =====================================================================
select pg_temp.receber('t127-ficha', '{"ddd": "84", "phone": "981270004"}'::jsonb);
select pg_temp.conversa('conv_Z', '+5584981270004', pg_temp.id('Z'));
select pg_temp.dele(pg_temp.id('conv_Z'), now() - interval '30 minutes', 'Bom dia');
select pg_temp.receber('t127-velho', '{"ddd": "84", "phone": "981270005", "name": "Vera Velha",
                                       "message": "Um novo contato foi estabelecido via WhatsApp."}'::jsonb);
update public.portal_leads set recebido_em = now() - interval '91 days' where id = pg_temp.lead_id('t127-velho');

-- O banco local pode ter outros leads de exemplo: a conta é pelo menos as duas deste teste.
select ok((app.portal_leads_manter() ->> 'ligados')::int >= 2, 'a rotina grava as conversas achadas');
select is((pg_temp.lead('t127-clique')).conversation_id, pg_temp.id('conv_P'), 'a conversa fica gravada no lead');
select is((pg_temp.lead('t127-ficha')).organization_id, pg_temp.id('Z'), 'e a ficha da conversa também');
select ok(exists (select 1 from public.activities
                   where organization_id = pg_temp.id('Z')
                     and body = 'Lead do portal: anúncio T127-CRM (mandou mensagem pelo WhatsApp)'),
  'a ficha ganha a atividade "Lead do portal"');
select is((app.portal_leads_manter() ->> 'ligados')::int, 0, 'rodar de novo não liga nada duas vezes');
select ok(not exists (select 1 from public.portal_lead_contatos where lead_id = pg_temp.lead_id('t127-velho'))
          and (pg_temp.lead('t127-velho')).contato_apagado_em is not null
          and (pg_temp.lead('t127-velho')).mensagem is null,
  'noventa dias depois, o contato e a mensagem de quem só clicou são apagados');
select ok((pg_temp.lead('t127-velho')).anuncio_id = pg_temp.id('anuncio'),
  'e o lead fica, com o anúncio, para a conta');
select ok(exists (select 1 from public.portal_lead_contatos where lead_id = pg_temp.lead_id('t127-depois')),
  'o contato recente continua');

-- =====================================================================
-- 7. O WhatsApp não muda
-- =====================================================================
select is((select count(*) from public.messages where direction = 'out'::app.msg_direction),
  (select saidas + 2 from t127_base), 'só as duas respostas que o próprio teste gravou');
select ok((select count(*) from pgmq.q_wa_outbound) = (select fila from t127_base)
          and (select count(*) from public.wa_acoes) = (select acoes from t127_base),
  'nada entrou na fila de saída nem nas ações do WhatsApp');

select * from finish();
rollback;

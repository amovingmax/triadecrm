-- =====================================================================
-- pgTAP — Fase 2: lead automático e valor (migração 20260922110000)
--
-- O que este arquivo prova:
--   1. SEM MENU AUTOMÁTICO, quem escreve pela primeira vez vira parceiro,
--      contato e negócio na captação — e a conversa sai de "Fora da base".
--   2. COM O MENU, o CRM espera a escolha: "quero ser fornecedor" cria;
--      "quero organizar um evento" (cliente do app) não cria.
--   3. NÚMERO QUE JÁ ESTÁ NA BASE não duplica: a conversa é ligada à ficha.
--   4. DESLIGADO em Ajustes, nada é criado.
--   5. O VALOR: quem escreve define; quem só lê não; negativo não; e o quadro
--      devolve o valor do cartão e a soma da coluna.
-- =====================================================================
begin;
select plan(14);

create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.conv(p_tel text) returns public.conversations
language sql security definer set search_path = '' as $$
  select * from public.conversations where peer_phone_e164 = p_tel
$$;
create function pg_temp.chega(p_wamid text, p_tel text, p_texto text) returns void language plpgsql as $$
begin
  perform pg_temp.worker();
  perform public.wa_entrada_registrar(p_wamid, '+5584999996000', p_tel, 'text', p_texto);
  perform pg_temp.sair();
end $$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;

insert into public.allowed_users (email, role, note) values
  ('g60.sdr@teste.local', 'sdr', 'pgTAP fase 2'),
  ('g60.leitor@teste.local', 'leitura', 'pgTAP fase 2');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000006001', 'g60.sdr@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000006002', 'g60.leitor@teste.local', '{"full_name":"Leo Leitor"}');

-- O número da empresa, e quem atende quem chega de fora (o dono padrão).
update public.app_settings
   set value = jsonb_set(value, '{numero_padrao}', '"+5584999996000"') where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"lead_automatico": true}'::jsonb where key = 'atendimento';

-- =====================================================================
-- 1. Sem menu automático
-- =====================================================================
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false') where key = 'whatsapp.bot_de_entrada';
select pg_temp.chega('wamid.g60.1', '+5584999996001', 'Oi, vi vocês no Instagram');
-- Quem atende uma conversa que chega de fora é quem o banco escolheu; para o
-- teste, a Sara, que escreve.
update public.conversations set assignee_id = 'a0000000-0000-4000-8000-000000006001'
 where peer_phone_e164 in ('+5584999996001');
select app.lead_automatico((pg_temp.conv('+5584999996001')).id);

select isnt((pg_temp.conv('+5584999996001')).organization_id, null,
  'quem escreve pela primeira vez vira parceiro, e a conversa deixa "Fora da base"');
select is((select o.name from public.organizations o where o.id = (pg_temp.conv('+5584999996001')).organization_id),
  'Contato do WhatsApp (84) 99999-6001', 'com um nome que diz de onde veio, até alguém renomear');
select is((select p.slug from public.deals d join public.pipelines p on p.id = d.pipeline_id
            where d.organization_id = (pg_temp.conv('+5584999996001')).organization_id),
  'fornecedor', 'e com um negócio no funil de captação');
select is((select s.slug from public.sources s join public.organizations o on o.source_id = s.id
            where o.id = (pg_temp.conv('+5584999996001')).organization_id),
  'whatsapp_entrada', 'marcado como "chegou pelo WhatsApp"');

-- =====================================================================
-- 2. Com o menu automático
-- =====================================================================
update public.app_settings set value = jsonb_set(value, '{ativo}', 'true') where key = 'whatsapp.bot_de_entrada';
insert into public.conversations (channel, business_number, peer_phone_e164, assignee_id, status)
values ('whatsapp', '+5584999996000', '+5584999996002', 'a0000000-0000-4000-8000-000000006001', 'aguardando_nos'),
       ('whatsapp', '+5584999996000', '+5584999996003', 'a0000000-0000-4000-8000-000000006001', 'aguardando_nos');
update public.conversations set bot_estado = 'menu_enviado' where peer_phone_e164 in ('+5584999996002', '+5584999996003');
select is(app.lead_automatico((pg_temp.conv('+5584999996002')).id) ->> 'motivo', 'esperando_o_menu',
  'com o menu ligado, o CRM espera a pessoa escolher');

update public.conversations set bot_estado = 'escolhido', bot_opcao = '2' where peer_phone_e164 = '+5584999996002';
select is(app.lead_automatico((pg_temp.conv('+5584999996002')).id) ->> 'motivo', 'nao_e_parceiro',
  'quem quer organizar um evento é cliente do app: não vira lead de fornecedor');

update public.conversations set bot_estado = 'escolhido', bot_opcao = '1' where peer_phone_e164 = '+5584999996003';
select app.lead_automatico((pg_temp.conv('+5584999996003')).id);
select isnt((pg_temp.conv('+5584999996003')).organization_id, null,
  'quem escolhe "quero ser fornecedor ou parceiro" vira lead');

-- =====================================================================
-- 3. Número que já está na base
-- =====================================================================
insert into public.organizations (id, name, phone_e164, source_id)
values ('c0000000-0000-4000-8000-000000006004', 'G60 Buffet Antigo', '+5584999996004',
        (select id from public.sources where slug = 'planilha'));
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false') where key = 'whatsapp.bot_de_entrada';
-- A conversa nasce solta (sem ficha), de um número que a base já conhece.
insert into public.conversations (channel, business_number, peer_phone_e164, assignee_id, status)
values ('whatsapp', '+5584999996000', '+5584999996004', 'a0000000-0000-4000-8000-000000006001', 'aguardando_nos');
select app.lead_automatico((pg_temp.conv('+5584999996004')).id);
select is((pg_temp.conv('+5584999996004')).organization_id, 'c0000000-0000-4000-8000-000000006004'::uuid,
  'número que a base já conhece: a conversa é ligada à ficha, sem duplicar');

-- =====================================================================
-- 4. Desligado
-- =====================================================================
update public.app_settings set value = value || '{"lead_automatico": false}'::jsonb where key = 'atendimento';
insert into public.conversations (channel, business_number, peer_phone_e164, assignee_id, status)
values ('whatsapp', '+5584999996000', '+5584999996005', 'a0000000-0000-4000-8000-000000006001', 'aguardando_nos');
select is(app.lead_automatico((pg_temp.conv('+5584999996005')).id) ->> 'motivo', 'desligado',
  'desligado em Ajustes, nada é criado');

-- =====================================================================
-- 5. O valor
-- =====================================================================
insert into pg_temp.r
select 'deal', to_jsonb(d.id) from public.deals d
 where d.organization_id = (pg_temp.conv('+5584999996001')).organization_id;

select pg_temp.entrar('a0000000-0000-4000-8000-000000006002', 'leitura');
select is(public.definir_valor_do_negocio((pg_temp.v('deal') #>> '{}')::uuid, 1500) ->> 'motivo',
  'sem_permissao', 'quem só lê não põe valor');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000006001', 'sdr');
select is(public.definir_valor_do_negocio((pg_temp.v('deal') #>> '{}')::uuid, -10) ->> 'motivo',
  'valor_invalido', 'valor negativo não entra');
select is(public.definir_valor_do_negocio((pg_temp.v('deal') #>> '{}')::uuid, 1500.456) ->> 'valor',
  '1500.46', 'quem escreve põe o valor, em centavos');
insert into pg_temp.r
select 'etapa', e from jsonb_array_elements(
  public.pipeline_board((select id from public.pipelines where slug = 'fornecedor'), false, null,
                        'Contato do WhatsApp (84) 99999-6001') -> 'stages') e
 where (e ->> 'total')::int > 0;
select pg_temp.sair();
select is((pg_temp.v('etapa') ->> 'valor_total')::numeric, 1500.46, 'a coluna soma o valor dos cartões');
select is((pg_temp.v('etapa') #>> '{cards,0,valor}')::numeric, 1500.46, 'e o cartão mostra o dele');

select * from finish();
rollback;

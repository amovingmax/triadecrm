-- =====================================================================
-- pgTAP — A conversa fora da base e o funil que anda com o WhatsApp
--         (migração 20260915130000_a_conversa_fora_da_base_e_o_funil_do_whatsapp.sql)
--
-- O que este arquivo prova:
--   A. O navegador não insere modelo direto em `messages`: modelo só pela RPC.
--   C. A primeira mensagem pelo CRM registra "Enviado, sem resposta" e leva o
--      negócio a Contatado; a primeira resposta registra "Respondeu" e leva a
--      Respondeu — uma vez só, só para a frente.
--   B. Quem escreve de um número fora da base aparece, e a conversa se liga a uma
--      ficha existente ou vira ficha nova com a origem "Chegou pelo WhatsApp".
--
-- Escopo pelos ids e telefones deste arquivo. Roda em transação e desfaz.
-- =====================================================================
begin;
select plan(23);

-- O lead automático (Fase 2) e a distribuição (Fase 3) mudariam o que este
-- arquivo prova: a conversa de número desconhecido nascendo SEM ficha.
update public.app_settings
   set value = value || '{"lead_automatico": false, "distribuicao_automatica": false, "ausencia_ativa": false}'::jsonb
 where key = 'atendimento';

create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.entrar_como_worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.sdr() returns uuid language sql as $$
  select 'a0000000-0000-4000-8000-00000000e461'::uuid
$$;
create function pg_temp.leitor() returns uuid language sql as $$
  select 'a0000000-0000-4000-8000-00000000e462'::uuid
$$;
create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-00000000e4' || p_n)::uuid
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_slug
$$;
create function pg_temp.etapa_da(p_org uuid) returns text language sql security definer set search_path = '' as $$
  select s.slug from public.deals d join public.stages s on s.id = d.stage_id
   where d.organization_id = p_org order by d.created_at limit 1
$$;
create function pg_temp.n_desfecho(p_org uuid, p_slug text) returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.activities a join public.interaction_outcomes o on o.id = a.outcome_id
   where a.organization_id = p_org and o.slug = p_slug
$$;
create function pg_temp.conversa(p_peer text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.conversations where peer_phone_e164 = p_peer
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated, service_role;
grant execute on function pg_temp.conversa(text) to authenticated, service_role;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;

create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                            'fecha_em', now() + interval '4 hours')
$$;

insert into public.allowed_users (email, role, note) values
  ('w46.sdr@teste.local',     'sdr',     'pgTAP fora da base'),
  ('w46.leitura@teste.local', 'leitura', 'pgTAP fora da base');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.sdr(),    'w46.sdr@teste.local',     '{"full_name":"Sdr W46"}'),
  (pg_temp.leitor(), 'w46.leitura@teste.local', '{"full_name":"Leitura W46"}');

-- 61 com WhatsApp e negócio em Prospectado · 62 sem telefone, para ligar a conversa
-- 63 com negócio já Em conversa (não pode voltar)
insert into public.organizations (id, name, phone_e164, source_id) values
  (pg_temp.org('61'), 'W46 Buffet Prospectado', '+5584999994661', (select id from public.sources where slug = 'google_places')),
  (pg_temp.org('62'), 'W46 Sem Telefone',       null,             (select id from public.sources where slug = 'planilha')),
  (pg_temp.org('63'), 'W46 Em Conversa',        '+5584999994663', (select id from public.sources where slug = 'google_places'));
insert into public.organization_categories (organization_id, category_id, is_primary)
select o, (select id from public.categories where slug = 'buffet_adulto_corporativo'), true
  from unnest(array[pg_temp.org('61'), pg_temp.org('62'), pg_temp.org('63')]) o;
insert into public.deals (organization_id, pipeline_id, stage_id) values
  (pg_temp.org('61'), (select id from public.pipelines where slug = 'fornecedor'), pg_temp.etapa('fornecedor', 'prospectado')),
  (pg_temp.org('62'), (select id from public.pipelines where slug = 'fornecedor'), pg_temp.etapa('fornecedor', 'prospectado')),
  (pg_temp.org('63'), (select id from public.pipelines where slug = 'fornecedor'), pg_temp.etapa('fornecedor', 'em_conversa'));

-- Fora de uso desde 22/09/2026 (só o cumprimento abre conversa); o teste reativa
-- porque prova o mecanismo do envio, não o catálogo.
update public.message_templates set meta_status = 'approved', meta_template_name = 'aeb_abr_a_v1', is_active = true
 where template_code = 'AEB-ABR-A';
update public.app_settings set value = jsonb_set(value, '{inicio}', '"2026-09-04"') where key = 'cadencia.tetos';
select pg_temp.entrar_como_worker();
select public.wa_numero_configurar('+5584999994600', '109876', '554433', 'Komune', 'GREEN');
select pg_temp.sair();


-- =====================================================================
-- C.2 · A primeira mensagem pelo CRM
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
insert into pg_temp.r values ('envio', public.wa_enviar_modelo(pg_temp.org('61'),
  (select id from public.message_templates where template_code = 'AEB-ABR-A'),
  '{"nome":"Mariana","empresa":"W46 Buffet","origem":"Google Maps","detalhe":"doces finos"}'));

-- A · o navegador não manda modelo por fora
select throws_ok(format($$
  insert into public.messages (conversation_id, direction, type, status, body, template_id, author_kind, sent_by, origin)
  values (%L, 'out', 'template', 'queued', 'oi', (select id from public.message_templates where template_code = 'AEB-ABR-A'),
          'human', %L, 'crm') $$, pg_temp.v('envio') ->> 'conversation_id', pg_temp.sdr()),
  '42501', NULL, 'A: modelo inserido direto do navegador é recusado pela policy');
select throws_ok(format($$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
  values (%L, 'out', 'template', 'queued', 'oi', 'human', %L, 'crm') $$,
  pg_temp.v('envio') ->> 'conversation_id', pg_temp.sdr()),
  '42501', NULL, 'A: nem com o tipo template sem id');
select pg_temp.sair();

select ok((pg_temp.v('envio') ->> 'primeiro_contato')::boolean, 'o envio é primeiro contato');
select is(pg_temp.n_desfecho(pg_temp.org('61'), 'wa_sem_resposta'), 1,
  'C.2: a primeira mensagem registra "Enviado, sem resposta"');
select is((select a.user_id from public.activities a join public.interaction_outcomes o on o.id = a.outcome_id
            where a.organization_id = pg_temp.org('61') and o.slug = 'wa_sem_resposta'), pg_temp.sdr(),
  'C.2: em nome de quem clicou');
select is(pg_temp.etapa_da(pg_temp.org('61')), 'contatado', 'C.2: e o negócio vai para Contatado');


-- =====================================================================
-- C.1 · A primeira resposta
-- =====================================================================
select pg_temp.entrar_como_worker();
select public.wa_entrada_registrar('wamid.W46.A', '+5584999994600', '+5584999994661', 'text', 'Oi! Tenho interesse sim');
select public.wa_entrada_registrar('wamid.W46.B', '+5584999994600', '+5584999994661', 'text', 'Me conta mais');
select public.wa_entrada_registrar('wamid.W46.C', '+5584999994600', '+5584999994663', 'text', 'Bom dia');
select pg_temp.sair();

select is(pg_temp.n_desfecho(pg_temp.org('61'), 'wa_respondeu'), 1,
  'C.1: a resposta registra "Respondeu" uma vez só, mesmo com duas mensagens');
select is((select a.message_id from public.activities a join public.interaction_outcomes o on o.id = a.outcome_id
            where a.organization_id = pg_temp.org('61') and o.slug = 'wa_respondeu'),
          (select id from public.messages where wa_message_id = 'wamid.W46.A'),
  'C.1: amarrado à primeira mensagem que chegou');
select is(pg_temp.etapa_da(pg_temp.org('61')), 'respondeu', 'C.1: o negócio vai para Respondeu');
select is(pg_temp.etapa_da(pg_temp.org('63')), 'em_conversa', 'C.1: negócio já adiante não volta');
select is(pg_temp.n_desfecho(pg_temp.org('63')::uuid, 'wa_respondeu'), 1, 'C.1: mas a resposta fica registrada');


-- =====================================================================
-- B · Número fora da base
-- =====================================================================
select pg_temp.entrar_como_worker();
select public.wa_entrada_registrar('wamid.W46.D', '+5584999994600', '+5584999994698', 'text', 'Olá, vi vocês no Instagram');
select public.wa_entrada_registrar('wamid.W46.E', '+5584999994600', '+5584999994699', 'text', 'Quero anunciar meu buffet');
select pg_temp.sair();

select is((select organization_id from public.conversations where id = pg_temp.conversa('+5584999994698')), null,
  'B: a conversa de número desconhecido nasce sem ficha');

select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is((select count(*)::int from public.conversations
            where organization_id is null and peer_phone_e164 in ('+5584999994698', '+5584999994699')), 2,
  'B: quem liga enxerga as conversas fora da base');
insert into pg_temp.r values ('vinculo', public.vincular_conversa(pg_temp.conversa('+5584999994698'), pg_temp.org('62')));
insert into pg_temp.r values ('nova', public.criar_ficha_da_conversa(pg_temp.conversa('+5584999994699'), 'W46 Buffet Novo',
  (select id from public.categories where slug = 'buffet_adulto_corporativo'), 'fornecedor'));
insert into pg_temp.r values ('de_novo', public.vincular_conversa(pg_temp.conversa('+5584999994698'), pg_temp.org('61')));
select pg_temp.sair();

select ok((pg_temp.v('vinculo') ->> 'ok')::boolean, 'B: a conversa se liga a uma ficha existente');
select is((select organization_id from public.conversations where id = pg_temp.conversa('+5584999994698')), pg_temp.org('62'),
  'B: a conversa passa a ser da ficha');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.conversa('+5584999994698')
              and organization_id is distinct from pg_temp.org('62')), 0,
  'B: e as mensagens também');
select is((select phone_e164 from public.organizations where id = pg_temp.org('62')), '+5584999994698',
  'B: a ficha sem telefone ganha o número da conversa');
select is(pg_temp.etapa_da(pg_temp.org('62')), 'respondeu',
  'B: quem já tinha escrito conta como resposta no funil');
select is(pg_temp.v('de_novo') ->> 'motivo', 'ja_vinculada', 'B: conversa ligada não troca de ficha');

select ok((pg_temp.v('nova') ->> 'criada')::boolean, 'B: a ficha nova é criada a partir da conversa');
select is((select s.slug from public.organizations o join public.sources s on s.id = o.source_id
            where o.id = (pg_temp.v('nova') ->> 'organization_id')::uuid), 'whatsapp_entrada',
  'B: com a origem "Chegou pelo WhatsApp" e o telefone da conversa');
select is((select organization_id from public.conversations where id = pg_temp.conversa('+5584999994699')),
          (pg_temp.v('nova') ->> 'organization_id')::uuid, 'B: e a conversa fica nela');

select pg_temp.entrar(pg_temp.leitor(), 'leitura');
select throws_ok(format($$ select public.vincular_conversa(%L, %L) $$,
                        pg_temp.conversa('+5584999994661'), pg_temp.org('62')),
  '42501', NULL, 'B: quem só lê não liga conversa a ficha');
select pg_temp.sair();

select * from finish();
rollback;

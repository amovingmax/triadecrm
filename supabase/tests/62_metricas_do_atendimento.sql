-- =====================================================================
-- pgTAP — Fase 4: métricas do atendimento (migração 20260922130000)
--
--   1. PRIMEIRA RESPOSTA: a chegada respondida por gente em 10 min mede 10; o
--      aviso automático no meio não conta como resposta; a chegada sem resposta
--      aparece como "sem resposta".
--   2. POR ATENDENTE: quem respondeu, quantas e em quanto tempo.
--   3. PERDAS: o motivo conta; embaixador não vê o relatório.
-- =====================================================================
begin;
select plan(9);

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
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;

create or replace function app.janela_do_canal(p_channel app.channel, p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null, 'fecha_em', null)
$$;

insert into public.allowed_users (email, role, note) values
  ('i62.ana@teste.local', 'sdr', 'pgTAP fase 4'), ('i62.emb@teste.local', 'embaixador', 'pgTAP fase 4');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000006201', 'i62.ana@teste.local', '{"full_name":"Ana Métrica"}'),
  ('a0000000-0000-4000-8000-000000006202', 'i62.emb@teste.local', '{"full_name":"Emb"}');
update public.app_settings
   set value = value || '{"lead_automatico": false, "distribuicao_automatica": false, "ausencia_ativa": false}'::jsonb
 where key = 'atendimento';

insert into public.conversations (id, channel, business_number, peer_phone_e164, assignee_id, status)
values ('f0000000-0000-4000-8000-000000006201', 'whatsapp', '+5584999996200', '+5584999996201',
        'a0000000-0000-4000-8000-000000006201', 'aguardando_nos'),
       ('f0000000-0000-4000-8000-000000006202', 'whatsapp', '+5584999996200', '+5584999996202',
        'a0000000-0000-4000-8000-000000006201', 'aguardando_nos');

-- Conversa A: chega há 2 h, o aviso automático sai 1 min depois (não conta), a Ana
-- responde 10 min depois.
insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
values ('f0000000-0000-4000-8000-000000006201', 'in', 'text', 'received', 'Oi, quanto custa?', 'system', 'crm',
        now() - interval '2 hours');
insert into public.messages (conversation_id, direction, type, status, body, template_id, author_kind, origin,
                             wa_message_id, created_at)
values ('f0000000-0000-4000-8000-000000006201', 'out', 'text', 'sent', 'Aviso automático',
        (select id from public.message_templates where template_code = 'GEN-SYS-AUSENCIA'),
        'bot_fixed', 'echo', 'wamid.i62.aviso', now() - interval '119 minutes');
insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin,
                             wa_message_id, created_at, sent_at)
values ('f0000000-0000-4000-8000-000000006201', 'out', 'text', 'sent', 'É de graça!', 'human',
        'a0000000-0000-4000-8000-000000006201', 'echo', 'wamid.i62.resposta',
        now() - interval '110 minutes', now() - interval '110 minutes');
update public.conversations set last_message_at = now() - interval '110 minutes'
 where id = 'f0000000-0000-4000-8000-000000006201';

-- Conversa B: chega há 1 h e ninguém respondeu.
insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
values ('f0000000-0000-4000-8000-000000006202', 'in', 'text', 'received', 'Alguém aí?', 'system', 'crm',
        now() - interval '1 hour');

-- Uma perda com motivo, hoje.
insert into public.organizations (id, name, phone_e164, source_id)
values ('c0000000-0000-4000-8000-000000006201', 'I62 Perdido', '+5584999996299',
        (select id from public.sources where slug = 'planilha'));
insert into public.deals (organization_id, pipeline_id, stage_id, status, lost_at, lost_reason_id)
select 'c0000000-0000-4000-8000-000000006201', p.id,
       (select s.id from public.stages s where s.pipeline_id = p.id and s.is_lost limit 1),
       'lost', now(), (select id from public.lost_reasons order by id limit 1)
  from public.pipelines p where p.slug = 'fornecedor';

-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000006202', 'embaixador');
select throws_ok($$ select public.relatorio_atendimento() $$, '42501', NULL,
  'embaixador não vê o relatório de atendimento');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000006201', 'sdr');
insert into pg_temp.r values ('m', public.relatorio_atendimento(
  ((now() at time zone 'America/Fortaleza')::date - 1), (now() at time zone 'America/Fortaleza')::date));
select pg_temp.sair();

select ok((pg_temp.v('m') #>> '{primeira_resposta,chegadas}')::int >= 2, 'as duas chegadas entram');
select is((pg_temp.v('m') #>> '{primeira_resposta,mediana_min}')::int <= 10
          and (pg_temp.v('m') #>> '{primeira_resposta,mediana_min}')::int > 0, true,
  'a primeira resposta mede o tempo até a pessoa responder, não até o aviso automático');
select ok((pg_temp.v('m') #>> '{primeira_resposta,sem_resposta}')::int >= 1,
  'a chegada sem resposta aparece como "sem resposta"');

insert into pg_temp.r
select 'ana', e from jsonb_array_elements(pg_temp.v('m') -> 'por_atendente') e
 where e ->> 'pessoa_id' = 'a0000000-0000-4000-8000-000000006201';
select is((pg_temp.v('ana') ->> 'respondidas')::int, 1, 'a Ana respondeu uma chegada');
select is((pg_temp.v('ana') ->> 'mediana_min')::int, 10, 'em 10 minutos');
select is((pg_temp.v('ana') ->> 'conversas')::int, 2, 'e atende as duas conversas que tiveram mensagem no período');

select ok(jsonb_array_length(pg_temp.v('m') -> 'perdas') >= 1, 'as perdas do período aparecem');
select ok(jsonb_array_length(pg_temp.v('m') -> 'conversao') > 3, 'a conversão vem etapa por etapa');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — A sala deixa de ser obrigatória para quem marca pela tela
-- (migração 20261003120000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. O ROBÔ NÃO MUDOU. Sem sala de quem atende, `public.reuniao_marcar`
--      continua recusando com `sem_sala` e não cria nada; com sala, marca e
--      congela o link. É a promessa da migração ao mexer em `app.reuniao_gravar`.
--   2. A PESSOA MARCA SEM SALA: para si e para quem acompanha. A reunião
--      nasce on-line com `link` nulo, e com o eco em `tasks` de sempre.
--   3. QUEM TEM SALA CONTINUA COM ELA congelada na reunião.
--   4. O PRESENCIAL CONTINUA EXIGINDO ENDEREÇO, na função e na restrição.
--   5. REMARCAR uma reunião sem sala funciona.
--   6. NADA DISSO FALA NO WHATSAPP.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(18);

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

-- A casa sem sala padrão: é o estado de produção, e o que faz a falta da sala
-- da pessoa aparecer.
update public.app_settings set value = jsonb_set(value, '{sala_padrao}', 'null'::jsonb)
 where key = 'agenda.reunioes';

create function pg_temp.contratar(p_nome text, p_papel text, p_com_sala boolean) returns uuid
language plpgsql as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := 'pgtap97.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                  || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 97 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  update public.profiles
     set sala_url = case when p_com_sala then 'https://sala.invalid/' || v_id::text end
   where id = v_id;
  return v_id;
end $$;

create temp table equipe97(papel text primary key, id uuid not null);
insert into equipe97 values
  ('gestor',  pg_temp.contratar('Gervasio Pgtap97', 'gestor', false)),
  ('sdr_sem', pg_temp.contratar('Serafina Pgtap97', 'sdr', false)),
  ('sdr_com', pg_temp.contratar('Sebastiao Pgtap97', 'sdr', true));
grant select on equipe97 to authenticated;
create function pg_temp.p(p_papel text) returns uuid language sql stable as $$
  select id from equipe97 where papel = p_papel $$;

create function pg_temp.nascer_org(p_nome text, p_dono uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.organizations (kind, name, source_id, collector, owner_id, phone_e164)
  select 'fornecedor'::app.org_kind, p_nome, s.id, 'pgtap97', p_dono,
         '+5584976' || lpad((random()*99999)::int::text, 5, '0')
    from public.sources s order by s.id limit 1
  returning id into v_id;
  return v_id;
end $$;
create function pg_temp.nascer_deal(p_org uuid, p_dono uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
  select p_org, 1, st.id, p_dono from public.stages st
   where st.pipeline_id = 1 and st.slug = 'respondeu'
  returning id into v_id;
  return v_id;
end $$;

create temp table fixt97(chave text primary key, id uuid not null);
insert into fixt97 values ('org_a',  pg_temp.nascer_org('Buffet Pgtap97 A', pg_temp.p('sdr_sem')));
insert into fixt97 values ('org_b',  pg_temp.nascer_org('Buffet Pgtap97 B', pg_temp.p('sdr_sem')));
insert into fixt97 values ('org_c',  pg_temp.nascer_org('Buffet Pgtap97 C', pg_temp.p('sdr_com')));
insert into fixt97 values ('org_rs', pg_temp.nascer_org('Buffet Pgtap97 Robo Sem', pg_temp.p('sdr_sem')));
insert into fixt97 values ('org_rc', pg_temp.nascer_org('Buffet Pgtap97 Robo Com', pg_temp.p('sdr_com')));
insert into fixt97 values ('deal_a',  pg_temp.nascer_deal((select id from fixt97 where chave='org_a'),  pg_temp.p('sdr_sem')));
insert into fixt97 values ('deal_b',  pg_temp.nascer_deal((select id from fixt97 where chave='org_b'),  pg_temp.p('sdr_sem')));
insert into fixt97 values ('deal_c',  pg_temp.nascer_deal((select id from fixt97 where chave='org_c'),  pg_temp.p('sdr_com')));
insert into fixt97 values ('deal_rs', pg_temp.nascer_deal((select id from fixt97 where chave='org_rs'), pg_temp.p('sdr_sem')));
insert into fixt97 values ('deal_rc', pg_temp.nascer_deal((select id from fixt97 where chave='org_rc'), pg_temp.p('sdr_com')));
with c as (
  insert into public.conversations (peer_phone_e164, business_number, organization_id, deal_id, assignee_id)
  values ('+5584976000097', '+5584900000097', (select id from fixt97 where chave='org_rs'),
          (select id from fixt97 where chave='deal_rs'), pg_temp.p('sdr_sem'))
  returning id)
insert into fixt97 select 'conv_rs', id from c;
with c as (
  insert into public.conversations (peer_phone_e164, business_number, organization_id, deal_id, assignee_id)
  values ('+5584976100097', '+5584900000097', (select id from fixt97 where chave='org_rc'),
          (select id from fixt97 where chave='deal_rc'), pg_temp.p('sdr_com'))
  returning id)
insert into fixt97 select 'conv_rc', id from c;
grant select on fixt97 to authenticated;
create function pg_temp.f(p_chave text) returns uuid language sql stable as $$
  select id from fixt97 where chave = p_chave $$;

-- Um dia útil três dias úteis à frente, congelado (ver o porquê no pgTAP 74).
create temp table dia97 as
  select app.next_business_day((now() at time zone 'America/Fortaleza')::date, 3) as d;
grant select on dia97 to authenticated;
create function pg_temp.as(p_hora text) returns timestamptz language sql stable as $$
  select ((select d from dia97) + p_hora::time) at time zone 'America/Fortaleza' $$;

-- A linha de base do WhatsApp, antes de qualquer ação deste arquivo.
create temp table zap97 as
  select (select count(*) from public.messages) as msgs,
         (select count(*) from pgmq.q_wa_outbound) as fila;

create temp table r97(chave text primary key, r jsonb);
grant select, insert on r97 to authenticated;
create function pg_temp.r(p_chave text) returns jsonb language sql stable as $$
  select r from r97 where chave = p_chave $$;

-- ---------- 1. o robô não mudou ----------
insert into r97 values ('robo_sem', public.reuniao_marcar(pg_temp.f('conv_rs'), pg_temp.as('09:30')));
select is(pg_temp.r('robo_sem') ->> 'motivo', 'sem_sala',
  'o robô continua recusando quando quem atende não tem sala');
select is((select count(*)::int from public.reunioes where deal_id = pg_temp.f('deal_rs')), 0,
  'e não cria reunião nenhuma');

insert into r97 values ('robo_com', public.reuniao_marcar(pg_temp.f('conv_rc'), pg_temp.as('09:30')));
select is((pg_temp.r('robo_com') ->> 'ok')::boolean, true,
  'o robô marca quando quem atende tem sala, como antes');
select is(
  (select link from public.reunioes where deal_id = pg_temp.f('deal_rc')),
  'https://sala.invalid/' || pg_temp.p('sdr_com')::text,
  'e a sala fica congelada na reunião');

-- ---------- 2. a pessoa marca sem sala ----------
select pg_temp.entrar(pg_temp.p('gestor'), 'gestor');
insert into r97 values ('gestor_para_si',
  public.reuniao_marcar_na_agenda(pg_temp.f('deal_a'), pg_temp.as('10:20')));
insert into r97 values ('gestor_para_sdr',
  public.reuniao_marcar_na_agenda(pg_temp.f('deal_b'), pg_temp.as('11:10'), 'online', null, null, pg_temp.p('sdr_sem')));
select pg_temp.sair();

select is((pg_temp.r('gestor_para_si') ->> 'ok')::boolean, true,
  'o gestor sem sala marca uma reunião on-line para si');
select is(
  (select formato || '/' || coalesce(link, 'sem link') from public.reunioes
    where id = (pg_temp.r('gestor_para_si') ->> 'reuniao_id')::uuid),
  'online/sem link', 'a reunião nasce on-line e sem link');
select is(
  (select t.kind::text || '/' || t.assignee_id::text from public.tasks t
    where t.id = (select task_id from public.reunioes
                   where id = (pg_temp.r('gestor_para_si') ->> 'reuniao_id')::uuid)),
  'meeting/' || pg_temp.p('gestor')::text, 'com o eco em tasks de sempre');
select is((pg_temp.r('gestor_para_sdr') ->> 'ok')::boolean, true,
  'o gestor marca para a SDR que também não tem sala');
select is(
  (select dono_id::text || '/' || coalesce(link, 'sem link') from public.reunioes
    where id = (pg_temp.r('gestor_para_sdr') ->> 'reuniao_id')::uuid),
  pg_temp.p('sdr_sem')::text || '/sem link', 'a reunião é dela, e sem link');

-- ---------- 3. quem tem sala continua com ela ----------
select pg_temp.entrar(pg_temp.p('sdr_com'), 'sdr');
insert into r97 values ('sdr_com_sala',
  public.reuniao_marcar_na_agenda(pg_temp.f('deal_c'), pg_temp.as('12:00')));
select pg_temp.sair();
select is(
  (select link from public.reunioes where id = (pg_temp.r('sdr_com_sala') ->> 'reuniao_id')::uuid),
  'https://sala.invalid/' || pg_temp.p('sdr_com')::text,
  'quem tem sala marca com a sala congelada, como antes');
select is(pg_temp.r('sdr_com_sala') ->> 'link',
  'https://sala.invalid/' || pg_temp.p('sdr_com')::text,
  'e o retorno traz o link');

-- ---------- 4. o presencial continua exigindo endereço ----------
select pg_temp.entrar(pg_temp.p('gestor'), 'gestor');
insert into r97 values ('presencial_sem_local',
  public.reuniao_marcar_na_agenda(pg_temp.f('deal_a'), pg_temp.as('13:40'), 'presencial'));
select pg_temp.sair();
select is(pg_temp.r('presencial_sem_local') ->> 'motivo', 'sem_lugar',
  'reunião presencial sem endereço continua recusada');
select throws_ok(
  format($q$insert into public.reunioes (organization_id, deal_id, dono_id, titulo, formato,
                                         inicio, fim, estado, marcada_por, marcada_por_id)
            values (%L, %L, %L, 'Pgtap97', 'presencial', %L, %L, 'marcada', 'pessoa', %L)$q$,
         pg_temp.f('org_a'), pg_temp.f('deal_a'), pg_temp.p('gestor'),
         pg_temp.as('15:20'), pg_temp.as('16:00'), pg_temp.p('gestor')),
  '23514', null, 'e a restrição da tabela recusa presencial sem endereço');
select lives_ok(
  format($q$insert into public.reunioes (organization_id, deal_id, dono_id, titulo, formato,
                                         inicio, fim, estado, marcada_por, marcada_por_id)
            values (%L, %L, %L, 'Pgtap97', 'online', %L, %L, 'marcada', 'pessoa', %L)$q$,
         pg_temp.f('org_a'), pg_temp.f('deal_a'), pg_temp.p('gestor'),
         pg_temp.as('15:20'), pg_temp.as('16:00'), pg_temp.p('gestor')),
  'a restrição aceita on-line sem link');

-- ---------- 5. remarcar uma reunião sem sala ----------
select pg_temp.entrar(pg_temp.p('gestor'), 'gestor');
insert into r97 values ('remarca',
  public.reuniao_remarcar((pg_temp.r('gestor_para_si') ->> 'reuniao_id')::uuid, pg_temp.as('14:30')));
select pg_temp.sair();
select is((pg_temp.r('remarca') ->> 'ok')::boolean, true,
  'a reunião sem sala é remarcada');
select is(
  (select count(*)::int from public.reunioes
    where deal_id = pg_temp.f('deal_a') and dono_id = pg_temp.p('gestor')
      and inicio = pg_temp.as('14:30') and link is null and estado = 'marcada'),
  1, 'e a nova continua on-line e sem link');

-- ---------- 6. nada disso fala no WhatsApp ----------
select is((select count(*) from public.messages), (select msgs from zap97),
  'nenhuma mensagem nova em public.messages');
select is((select count(*) from pgmq.q_wa_outbound), (select fila from zap97),
  'nada na fila de saída do WhatsApp');

select * from finish();
rollback;

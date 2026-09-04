-- =====================================================================
-- pgTAP — Funil (RF-FUN-01, RF-FUN-04, RF-FUN-08; migração 000300): negócio único por
-- organização × funil, coerência etapa × funil, histórico de etapas, entered_stage_at,
-- status derivado (ganho/perdido/pausado) e recência por atividade.
-- =====================================================================
begin;
select plan(36);

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
create function pg_temp.funil(p_slug text) returns int language sql as $$
  select id from public.pipelines where slug = p_slug
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = p_funil and s.slug = p_slug
$$;

-- ---------- fixtures ----------
insert into public.allowed_users (email, role, note) values ('sdr.funil@teste.local', 'sdr', 'pgTAP');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000301', 'sdr.funil@teste.local', '{"full_name":"SDR Funil"}');
insert into public.organizations (id, name, source_id, owner_id) values
  ('b0000000-0000-4000-8000-000000000301', 'Funil Org 1', (select id from public.sources where slug = 'captura_campo'), 'a0000000-0000-4000-8000-000000000301'),
  ('b0000000-0000-4000-8000-000000000302', 'Funil Org 2', (select id from public.sources where slug = 'captura_campo'), 'a0000000-0000-4000-8000-000000000301');

select col_is_unique('public', 'deals', array['organization_id', 'pipeline_id'], 'deals: unique (organization_id, pipeline_id)');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000301', 'sdr');

-- ---------- um negócio por organização por funil ----------
select lives_ok(
  $$insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id)
      values ('d0000000-0000-4000-8000-000000000301', 'b0000000-0000-4000-8000-000000000301', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'), 'a0000000-0000-4000-8000-000000000301')$$,
  'deals: cria negócio no funil de fornecedor');
select throws_ok(
  $$insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
      values ('b0000000-0000-4000-8000-000000000301', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'contatado'), 'a0000000-0000-4000-8000-000000000301')$$,
  '23505', null, 'deals: segundo negócio da mesma organização no mesmo funil é rejeitado');
select lives_ok(
  $$insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
      values ('b0000000-0000-4000-8000-000000000301', pg_temp.funil('ativacao'), pg_temp.etapa('ativacao', 'publicado'), 'a0000000-0000-4000-8000-000000000301')$$,
  'deals: a mesma organização pode ter negócio em outro funil');

-- ---------- coerência etapa × funil ----------
select throws_ok(
  $$insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
      values ('b0000000-0000-4000-8000-000000000302', pg_temp.funil('fornecedor'), pg_temp.etapa('produtor', 'identificado'), 'a0000000-0000-4000-8000-000000000301')$$,
  '23514', null, 'deals: etapa de outro funil é rejeitada');
select throws_ok(
  $$insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
      values ('b0000000-0000-4000-8000-000000000302', pg_temp.funil('fornecedor'), 999999, 'a0000000-0000-4000-8000-000000000301')$$,
  '23503', null, 'deals: etapa inexistente é rejeitada');
select throws_ok(
  $$insert into public.deals (organization_id, pipeline_id, stage_id, owner_id, tier)
      values ('b0000000-0000-4000-8000-000000000302', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'), 'a0000000-0000-4000-8000-000000000301', 'Z')$$,
  '23514', null, 'deals: tier fora de A+/A/B/C é rejeitado');

-- ---------- histórico de etapas (RF-FUN-08) ----------
select results_eq(
  $$select from_stage_id, to_stage_id, changed_by from public.deal_stage_history where deal_id = 'd0000000-0000-4000-8000-000000000301'$$,
  $$values (null::int, pg_temp.etapa('fornecedor', 'prospectado'), 'a0000000-0000-4000-8000-000000000301'::uuid)$$,
  'histórico: criação gera linha (de NULL para a 1ª etapa) com quem criou');

-- entered_stage_at: recua para simular tempo passado (now() é fixo na transação)
update public.deals set entered_stage_at = now() - interval '3 days' where id = 'd0000000-0000-4000-8000-000000000301';
select is((select entered_stage_at from public.deals where id = 'd0000000-0000-4000-8000-000000000301'), now() - interval '3 days',
  'entered_stage_at: update sem mudança de etapa não reinicia o carimbo');
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'contatado'), stage_change_reason = 'primeiro contato enviado'
  where id = 'd0000000-0000-4000-8000-000000000301';
select is((select entered_stage_at from public.deals where id = 'd0000000-0000-4000-8000-000000000301'), now(),
  'entered_stage_at: mudança de etapa reinicia o carimbo');
select is((select count(*)::int from public.deal_stage_history where deal_id = 'd0000000-0000-4000-8000-000000000301'), 2,
  'histórico: mudança de etapa gera nova linha');
select results_eq(
  $$select from_stage_id, to_stage_id, changed_by, reason from public.deal_stage_history
     where deal_id = 'd0000000-0000-4000-8000-000000000301' order by id desc limit 1$$,
  $$values (pg_temp.etapa('fornecedor', 'prospectado'), pg_temp.etapa('fornecedor', 'contatado'), 'a0000000-0000-4000-8000-000000000301'::uuid, 'primeiro contato enviado'::text)$$,
  'histórico: de/para, autor e motivo da mudança');
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'respondeu') where id = 'd0000000-0000-4000-8000-000000000301';
select is((select stage_change_reason from public.deals where id = 'd0000000-0000-4000-8000-000000000301'), null,
  'motivo: não é herdado da mudança anterior');
select is((select reason from public.deal_stage_history where deal_id = 'd0000000-0000-4000-8000-000000000301' order by id desc limit 1), null,
  'histórico: sem motivo quando a mudança não informou');
select set_config('app.stage_reason', 'automação de teste', true);
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'em_conversa') where id = 'd0000000-0000-4000-8000-000000000301';
select is((select reason from public.deal_stage_history where deal_id = 'd0000000-0000-4000-8000-000000000301' order by id desc limit 1), 'automação de teste',
  'histórico: motivo vindo de current_setting(app.stage_reason) (automações)');
select set_config('app.stage_reason', '', true);
select is((select count(*)::int from public.deal_stage_history where deal_id = 'd0000000-0000-4000-8000-000000000301'), 4,
  'histórico: uma linha por mudança (4 etapas percorridas)');
select throws_ok(
  $$insert into public.deal_stage_history (deal_id, to_stage_id) values ('d0000000-0000-4000-8000-000000000301', pg_temp.etapa('fornecedor', 'contatado'))$$,
  '42501', null, 'histórico: usuário não escreve direto (só o trigger)');

-- ---------- status derivado da etapa ----------
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'publicado') where id = 'd0000000-0000-4000-8000-000000000301';
select results_eq(
  $$select status::text, won_at is not null, lost_at from public.deals where id = 'd0000000-0000-4000-8000-000000000301'$$,
  $$values ('won'::text, true, null::timestamptz)$$,
  'status: etapa de ganho => won + won_at');
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'contatado') where id = 'd0000000-0000-4000-8000-000000000301';
select results_eq(
  $$select status::text, won_at from public.deals where id = 'd0000000-0000-4000-8000-000000000301'$$,
  $$values ('open'::text, null::timestamptz)$$,
  'status: reabertura por decisão humana volta a open e limpa won_at');
select throws_ok(
  $$update public.deals set stage_id = pg_temp.etapa('fornecedor', 'perdido') where id = 'd0000000-0000-4000-8000-000000000301'$$,
  '23514', null, 'status: perdido sem motivo de perda é rejeitado (RF-FUN-04)');
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'perdido'),
       lost_reason_id = (select id from public.lost_reasons where slug = 'nao_aceita_comissao')
  where id = 'd0000000-0000-4000-8000-000000000301';
select results_eq(
  $$select status::text, lost_at is not null from public.deals where id = 'd0000000-0000-4000-8000-000000000301'$$,
  $$values ('lost'::text, true)$$,
  'status: etapa de perda com motivo => lost + lost_at');
-- Nutrição/dormente é etapa E status (PRD §5.3 e §5.6, linha "Frio: nutrição/dormente"):
-- entrar nela deriva status 'nurturing' — antes o negócio continuava 'open' e podia ficar
-- morno/quente pela última intenção, entrando na fila do dia e no needs_attention.
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'nutricao') where id = 'd0000000-0000-4000-8000-000000000301';
select results_eq(
  $$select status::text, lost_at, temperature::text from public.deals where id = 'd0000000-0000-4000-8000-000000000301'$$,
  $$values ('nurturing'::text, null::timestamptz, 'frio'::text)$$,
  'status: sair de perdido para Nutrição/dormente limpa lost_at e deriva nurturing (frio)');
select is((select lost_reason_id from public.deals where id = 'd0000000-0000-4000-8000-000000000301'), null,
  'status: sair da perda limpa o motivo de perda');
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'respondeu') where id = 'd0000000-0000-4000-8000-000000000301';
select is((select status::text from public.deals where id = 'd0000000-0000-4000-8000-000000000301'), 'open',
  'status: sair da nutrição volta a open');

-- Opt-out (PRD §5.3): é perda, mas por REGRA — não tem motivo na lista fechada. Antes a
-- constraint deals_lost_needs_reason impedia até mover o cartão para a etapa.
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'optout'), stage_change_reason = 'pediu para sair'
  where id = 'd0000000-0000-4000-8000-000000000301';
select results_eq(
  $$select status::text, lost_reason_id, lost_at is not null from public.deals where id = 'd0000000-0000-4000-8000-000000000301'$$,
  $$values ('lost'::text, null::int, true)$$,
  'status: etapa de opt-out é perda sem motivo da lista fechada (guardrail de opt-out)');
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'nutricao') where id = 'd0000000-0000-4000-8000-000000000301';
select throws_ok(
  $$update public.deals set status = 'paused' where id = 'd0000000-0000-4000-8000-000000000301'$$,
  '23514', null, 'status: pausado sem data é rejeitado');
select lives_ok(
  $$update public.deals set status = 'paused', paused_until = now() + interval '7 days' where id = 'd0000000-0000-4000-8000-000000000301'$$,
  'status: pausado com data é aceito');
update public.deals set status = 'open' where id = 'd0000000-0000-4000-8000-000000000301';
select is((select paused_until from public.deals where id = 'd0000000-0000-4000-8000-000000000301'), null,
  'status: voltar a open limpa paused_until');

-- ---------- recência: atividades alimentam last_activity_at ----------
select is((select last_activity_at from public.deals where id = 'd0000000-0000-4000-8000-000000000301'), null,
  'recência: negócio novo sem atividade');
insert into public.activities (type, organization_id, deal_id, user_id, occurred_at, body)
  values ('message', 'b0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000301', 'a0000000-0000-4000-8000-000000000301', now() - interval '1 hour', 'oi');
select is((select last_activity_at from public.deals where id = 'd0000000-0000-4000-8000-000000000301'), now() - interval '1 hour',
  'recência: atividade humana atualiza last_activity_at');
insert into public.activities (type, organization_id, deal_id, user_id, occurred_at, body, author_kind)
  values ('system', 'b0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000301', 'a0000000-0000-4000-8000-000000000301', now(), 'sistema', 'system');
select is((select last_activity_at from public.deals where id = 'd0000000-0000-4000-8000-000000000301'), now() - interval '1 hour',
  'recência: atividade de sistema não conta como contato');
insert into public.activities (type, organization_id, deal_id, user_id, occurred_at, body)
  values ('call', 'b0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000301', 'a0000000-0000-4000-8000-000000000301', now() - interval '2 days', 'ligação antiga');
select is((select last_activity_at from public.deals where id = 'd0000000-0000-4000-8000-000000000301'), now() - interval '1 hour',
  'recência: atividade mais antiga não recua last_activity_at');

-- ---------- tarefas ----------
insert into public.tasks (id, title, deal_id, organization_id, assignee_id)
  values ('e0000000-0000-4000-8000-000000000301', 'Ligar', 'd0000000-0000-4000-8000-000000000301', 'b0000000-0000-4000-8000-000000000301', 'a0000000-0000-4000-8000-000000000301');
select results_eq(
  $$select created_by, completed_at from public.tasks where id = 'e0000000-0000-4000-8000-000000000301'$$,
  $$values ('a0000000-0000-4000-8000-000000000301'::uuid, null::timestamptz)$$,
  'tarefas: created_by = quem criou; sem completed_at');
update public.tasks set status = 'done' where id = 'e0000000-0000-4000-8000-000000000301';
select is((select completed_at from public.tasks where id = 'e0000000-0000-4000-8000-000000000301'), now(),
  'tarefas: concluir carimba completed_at');
update public.tasks set status = 'todo' where id = 'e0000000-0000-4000-8000-000000000301';
select is((select completed_at from public.tasks where id = 'e0000000-0000-4000-8000-000000000301'), null,
  'tarefas: reabrir limpa completed_at');

select pg_temp.sair();

-- ---------- cascata ----------
delete from public.deals where id = 'd0000000-0000-4000-8000-000000000301';
select is((select count(*)::int from public.deal_stage_history where deal_id = 'd0000000-0000-4000-8000-000000000301'), 0,
  'histórico: apagar o negócio apaga o histórico (cascade)');

select * from finish();
rollback;

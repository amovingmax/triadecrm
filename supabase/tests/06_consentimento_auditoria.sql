-- =====================================================================
-- pgTAP — Consentimento, supressão e auditoria (RF-ADM-03, RF-ADM-04, RF-BAS-14;
-- migrações 000400/000500): opt-out => do_not_contact + suppression_list; append-only;
-- audit_log; pii_access_log em reveal_phone / reveal_contact_phone.
-- =====================================================================
begin;
select plan(45);

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

-- ---------- fixtures ----------
insert into public.allowed_users (email, role, note) values
  ('sdr.consent@teste.local', 'sdr', 'pgTAP'), ('emb.consent@teste.local', 'embaixador', 'pgTAP');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000501', 'sdr.consent@teste.local', '{"full_name":"SDR Consent"}'),
  ('a0000000-0000-4000-8000-000000000502', 'emb.consent@teste.local', '{"full_name":"Embaixador Consent"}');
insert into public.organizations (id, name, phone_e164, cnpj, instagram_handle, source_id, owner_id) values
  ('b0000000-0000-4000-8000-000000000501', 'Consent Org', '+5584999990101', '11.222.333/0001-81', 'org.consent',
     (select id from public.sources where slug = 'captura_campo'), 'a0000000-0000-4000-8000-000000000501'),
  ('b0000000-0000-4000-8000-000000000502', 'Consent Org 2', '+5584999990103', null, null,
     (select id from public.sources where slug = 'captura_campo'), 'a0000000-0000-4000-8000-000000000501'),
  ('b0000000-0000-4000-8000-000000000503', 'Consent Org apagada', '+5584999990105', null, null,
     (select id from public.sources where slug = 'captura_campo'), null);
update public.organizations set deleted_at = now() where id = 'b0000000-0000-4000-8000-000000000503';
insert into public.contacts (id, full_name, phone_e164, instagram_handle) values
  ('c0000000-0000-4000-8000-000000000501', 'Pessoa Consent', '+5584999990102', 'pessoa.consent'),
  ('c0000000-0000-4000-8000-000000000502', 'Pessoa Alheia', '+5584999990104', null);
insert into public.organization_contacts (organization_id, contact_id, is_primary) values
  ('b0000000-0000-4000-8000-000000000501', 'c0000000-0000-4000-8000-000000000501', true),
  ('b0000000-0000-4000-8000-000000000502', 'c0000000-0000-4000-8000-000000000501', true);
-- Negócios em andamento: o opt-out precisa aparecer no funil, não só nas flags (PRD §5.3).
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = p_funil and s.slug = p_slug
$$;
insert into public.deals (id, organization_id, pipeline_id, stage_id) values
  ('d0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000501',
   (select id from public.pipelines where slug = 'fornecedor'), pg_temp.etapa('fornecedor', 'em_conversa')),
  ('d0000000-0000-4000-8000-000000000502', 'b0000000-0000-4000-8000-000000000502',
   (select id from public.pipelines where slug = 'fornecedor'), pg_temp.etapa('fornecedor', 'contatado'));

-- =====================================================================
-- opt-out registrado pela SDR
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000501', 'sdr');
select lives_ok(
  $$insert into public.consent_events (id, kind, contact_id, channel, evidence_text)
      values ('f0000000-0000-4000-8000-000000000501', 'contact_optout', 'c0000000-0000-4000-8000-000000000501', 'whatsapp', 'SAIR')$$,
  'opt-out: evento registrado');
select is((select recorded_by from public.consent_events where id = 'f0000000-0000-4000-8000-000000000501'), 'a0000000-0000-4000-8000-000000000501',
  'opt-out: recorded_by = quem registrou');
select is((select do_not_contact from public.contacts_view where id = 'c0000000-0000-4000-8000-000000000501'), true,
  'opt-out: pessoa marcada do_not_contact');
select results_eq(
  $$select id, do_not_contact from public.organizations_view where id in ('b0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000502') order by id$$,
  $$values ('b0000000-0000-4000-8000-000000000501'::uuid, true), ('b0000000-0000-4000-8000-000000000502'::uuid, true)$$,
  'opt-out: todas as organizações da pessoa marcadas do_not_contact');
select is((select do_not_contact from public.contacts_view where id = 'c0000000-0000-4000-8000-000000000502'), false,
  'opt-out: pessoa sem relação não é afetada');
select is(app.is_suppressed(p_phone := '84 99999-0102'), true, 'supressão: telefone da pessoa (em qualquer formato)');
select is(app.is_suppressed(p_instagram := '@Pessoa.Consent'), true, 'supressão: @instagram da pessoa');
select is(app.is_suppressed(p_phone := '+5584999990101'), true, 'supressão: telefone da organização');
select is(app.is_suppressed(p_phone := '+5584999990103'), true, 'supressão: telefone da segunda organização');
select is(app.is_suppressed(p_cnpj := '11.222.333/0001-81'), false, 'supressão: opt-out não suprime CNPJ (só eliminação)');
select is(app.is_suppressed(p_phone := '+5584999990104'), false, 'supressão: telefone de outra pessoa continua livre');
select results_eq(
  $$select kind, reason, created_by from public.suppression_list where source_event_id = 'f0000000-0000-4000-8000-000000000501' order by kind, id$$,
  $$values ('instagram'::text, 'contact_optout'::text, 'a0000000-0000-4000-8000-000000000501'::uuid),
           ('instagram'::text, 'contact_optout'::text, 'a0000000-0000-4000-8000-000000000501'::uuid),
           ('phone'::text,     'contact_optout'::text, 'a0000000-0000-4000-8000-000000000501'::uuid),
           ('phone'::text,     'contact_optout'::text, 'a0000000-0000-4000-8000-000000000501'::uuid),
           ('phone'::text,     'contact_optout'::text, 'a0000000-0000-4000-8000-000000000501'::uuid)$$,
  'supressão: 5 hashes ligados ao evento (3 telefones + 2 @), com motivo e autor');
select is(
  (select hash from public.suppression_list where kind = 'phone' and hash = app.sha256_hex('+5584999990102')),
  app.sha256_hex('+5584999990102'), 'supressão: hash = sha256 do telefone E.164');
insert into public.consent_events (kind, contact_id, channel, evidence_text)
  values ('contact_optin', 'c0000000-0000-4000-8000-000000000501', 'whatsapp', 'pode mandar');
select is((select do_not_contact from public.contacts_view where id = 'c0000000-0000-4000-8000-000000000501'), true,
  'opt-in depois do opt-out não reabre automaticamente (telefone continua suprimido)');
select throws_ok(
  $$update public.consent_events set evidence_text = 'x' where id = 'f0000000-0000-4000-8000-000000000501'$$,
  '42501', null, 'append-only: usuário não altera consent_events');
select throws_ok(
  $$delete from public.consent_events where id = 'f0000000-0000-4000-8000-000000000501'$$,
  '42501', null, 'append-only: usuário não apaga consent_events');
select pg_temp.sair();

select throws_ok(
  $$update public.consent_events set evidence_text = 'x' where id = 'f0000000-0000-4000-8000-000000000501'$$,
  '42501', null, 'append-only: nem o superusuário altera (trigger)');
select throws_ok(
  $$delete from public.consent_events where id = 'f0000000-0000-4000-8000-000000000501'$$,
  '42501', null, 'append-only: nem o superusuário apaga (trigger)');

-- ---------- o opt-out move o funil (PRD §5.3; guardrail "opt-out imediato, nunca reabre") ----------
select results_eq(
  $$select d.id, s.slug, d.status::text, d.lost_reason_id, s.is_terminal
      from public.deals d join public.stages s on s.id = d.stage_id
     where d.id in ('d0000000-0000-4000-8000-000000000501', 'd0000000-0000-4000-8000-000000000502') order by d.id$$,
  $$values ('d0000000-0000-4000-8000-000000000501'::uuid, 'optout'::text, 'lost'::text, null::int, true),
           ('d0000000-0000-4000-8000-000000000502'::uuid, 'optout'::text, 'lost'::text, null::int, true)$$,
  'opt-out: negócios em andamento vão para a etapa Opt-out (perda sem motivo da lista fechada)');
select is(
  (select count(*)::int from public.deal_stage_history h
    where h.deal_id = 'd0000000-0000-4000-8000-000000000501' and h.to_stage_id = pg_temp.etapa('fornecedor', 'optout')),
  1, 'opt-out: a ida para Opt-out fica no histórico de etapas (RF-FUN-08)');
select is(
  (select h.reason from public.deal_stage_history h
    where h.deal_id = 'd0000000-0000-4000-8000-000000000501' order by h.id desc limit 1),
  'Opt-out registrado (contact_optout)', 'opt-out: histórico guarda o motivo da mudança');
select is((select temperature::text from public.deals where id = 'd0000000-0000-4000-8000-000000000501'), 'frio',
  'opt-out: negócio movido fica frio');

-- eliminação suprime também o CNPJ
insert into public.consent_events (kind, organization_id, evidence_text)
  values ('erasure_request', 'b0000000-0000-4000-8000-000000000501', 'pedido do titular');
select is(app.is_suppressed(p_cnpj := '11222333000181'), true, 'eliminação: CNPJ entra na suppression_list');

-- =====================================================================
-- audit_log (RF-ADM-03)
-- =====================================================================
select results_eq(
  $$select action, table_name, new_data ->> 'name' from public.audit_log
     where table_name = 'organizations' and row_id = 'b0000000-0000-4000-8000-000000000501' order by id limit 1$$,
  $$values ('INSERT'::text, 'organizations'::text, 'Consent Org'::text)$$,
  'audit: INSERT de organização registrado com os dados novos');
select is(
  (select count(*)::int from public.audit_log where table_name = 'consent_events' and new_data ->> 'id' = 'f0000000-0000-4000-8000-000000000501'),
  1, 'audit: INSERT de consent_events registrado');
select cmp_ok((select count(*)::int from public.audit_log where table_name = 'profiles' and action = 'INSERT'), '>=', 2,
  'audit: criação de perfis registrada');
create temporary table n_audit as select count(*) as n from public.audit_log;
update public.organizations set name = name where id = 'b0000000-0000-4000-8000-000000000502';
select is((select count(*) from public.audit_log), (select n from n_audit),
  'audit: update sem mudança real (só updated_at) não gera registro');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000501', 'sdr');
update public.organizations_view set name = 'Consent Org 2 (editada)' where id = 'b0000000-0000-4000-8000-000000000502';
select pg_temp.sair();
select results_eq(
  $$select action, actor_id, actor_role, old_data ->> 'name', new_data ->> 'name' from public.audit_log
     where table_name = 'organizations' and row_id = 'b0000000-0000-4000-8000-000000000502' and action = 'UPDATE' order by id desc limit 1$$,
  $$values ('UPDATE'::text, 'a0000000-0000-4000-8000-000000000501'::uuid, 'sdr'::text, 'Consent Org 2'::text, 'Consent Org 2 (editada)'::text)$$,
  'audit: UPDATE via view registra ator, papel, antes e depois');
-- app.role() devolve 'leitura' quando não há claim (menor privilégio, pensado para a RLS):
-- usar esse valor na auditoria fazia worker, pg_cron e seed assinarem como o papel que, por
-- definição, não escreve. Automação agora é 'bot' (service_role) ou 'sistema' (sem JWT).
select is(
  (select actor_role from public.audit_log where table_name = 'organizations'
      and row_id = 'b0000000-0000-4000-8000-000000000501' and action = 'INSERT' order by id limit 1),
  'sistema', 'audit: escrita sem JWT (seed, cron, migração) é registrada como "sistema"');
select is((select count(*)::int from public.audit_log where actor_id is null and actor_role = 'leitura'), 0,
  'audit: nenhuma escrita automática assina como o papel "leitura"');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.organizations set name = 'Consent Org 2 (worker)' where id = 'b0000000-0000-4000-8000-000000000502';
select set_config('request.jwt.claims', '', true);
select results_eq(
  $$select actor_id, actor_role from public.audit_log where table_name = 'organizations'
      and row_id = 'b0000000-0000-4000-8000-000000000502' and action = 'UPDATE' order by id desc limit 1$$,
  $$values (null::uuid, 'bot'::text)$$,
  'audit: escrita do service role (workers, Edge Functions) é registrada como "bot" (RF-ADM-01)');
-- pg_cron: o recálculo noturno de temperatura roda sem JWT nenhum e escreve em deals — a mesma
-- via do seed, da migração e do psql. Assinar 'leitura' aqui era dizer que o papel que não
-- escreve tinha escrito (RF-ADM-03).
insert into public.deals (id, organization_id, pipeline_id, stage_id) values
  ('d0000000-0000-4000-8000-000000000503', 'b0000000-0000-4000-8000-000000000501',
   (select id from public.pipelines where slug = 'produtor'), pg_temp.etapa('produtor', 'identificado'));
alter table public.deals disable trigger zz_deals_apply_temperature;
update public.deals set temperature = 'quente' where id = 'd0000000-0000-4000-8000-000000000503';
alter table public.deals enable trigger zz_deals_apply_temperature;
create temporary table n_cron as select coalesce(max(id), 0) as id from public.audit_log;
select cmp_ok(app.recompute_temperatures(), '>', 0,
  'audit: o recálculo do pg_cron mexeu em pelo menos um negócio (senão o teste seguinte é vazio)');
select results_eq(
  $$select distinct actor_id, actor_role from public.audit_log
     where table_name = 'deals' and action = 'UPDATE' and id > (select id from n_cron)$$,
  $$values (null::uuid, 'sistema'::text)$$,
  'audit: escrita do pg_cron (app.recompute_temperatures) assina como "sistema", nunca "leitura"');

-- =====================================================================
-- revelação de telefone com log (RF-BAS-14)
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000501', 'sdr');
select is(public.reveal_phone('b0000000-0000-4000-8000-000000000501'), '+5584999990101',
  'reveal_phone: sdr recebe o telefone completo');
select is(public.reveal_contact_phone('c0000000-0000-4000-8000-000000000501'), '+5584999990102',
  'reveal_contact_phone: telefone completo da pessoa');
select throws_ok($$select public.reveal_phone('b0000000-0000-4000-8000-000000000503')$$, 'P0002', null,
  'reveal_phone: organização apagada não é encontrada');
select throws_ok($$select public.reveal_phone('00000000-0000-4000-8000-000000000000')$$, 'P0002', null,
  'reveal_phone: organização inexistente');
select pg_temp.sair();
-- (o pii_access_log é lido como postgres: sdr não tem política de leitura nele)
select results_eq(
  $$select actor_id, actor_role, action, entity_type, entity_id from public.pii_access_log
     where entity_id = 'b0000000-0000-4000-8000-000000000501' and action = 'reveal_phone'$$,
  $$values ('a0000000-0000-4000-8000-000000000501'::uuid, 'sdr'::text, 'reveal_phone'::text, 'organization'::text, 'b0000000-0000-4000-8000-000000000501'::uuid)$$,
  'reveal_phone: revelação registrada em pii_access_log');
select is(
  (select count(*)::int from public.pii_access_log where entity_id = 'c0000000-0000-4000-8000-000000000501' and action = 'view_contact_phone' and actor_id = 'a0000000-0000-4000-8000-000000000501'),
  1, 'reveal_contact_phone: registrado em pii_access_log');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000502', 'embaixador');
select throws_ok($$select public.reveal_phone('b0000000-0000-4000-8000-000000000501')$$, '42501', null,
  'reveal_phone: embaixador fora da carteira é bloqueado');
select throws_ok($$select public.reveal_contact_phone('c0000000-0000-4000-8000-000000000501')$$, '42501', null,
  'reveal_contact_phone: embaixador fora da carteira é bloqueado');
select pg_temp.sair();
select is((select count(*)::int from public.pii_access_log where actor_id = 'a0000000-0000-4000-8000-000000000502'), 0,
  'reveal: tentativa bloqueada não gera registro de acesso');
select throws_ok($$select public.reveal_phone('b0000000-0000-4000-8000-000000000501')$$, '42501', null,
  'reveal_phone: sem usuário autenticado é bloqueado');

-- privilégios: logs são só de leitura para a API
select throws_ok($$set local role authenticated; insert into public.pii_access_log (actor_id, action) values ('a0000000-0000-4000-8000-000000000501', 'export_csv')$$,
  '42501', null, 'pii_access_log: usuário não escreve direto');
select pg_temp.sair();
select throws_ok($$set local role authenticated; insert into public.suppression_list (hash, kind) values ('x', 'phone')$$,
  '42501', null, 'suppression_list: inserção manual só por admin (sdr sem claim = leitura)');
select pg_temp.sair();

select * from finish();
rollback;

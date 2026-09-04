-- =====================================================================
-- pgTAP — RLS por papel (RF-ADM-01, RF-BAS-14; migração 000500).
-- Para cada papel (anon, leitura, financeiro, sdr, embaixador, gestor, admin):
-- leitura permitida/negada e escrita permitida/negada. Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(66);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.anonimo() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
-- Total de negócios na base, lido FORA da RLS (definer, dono postgres). "Vê todos os
-- negócios" tem de ser comparado com a base inteira, e não com um número fixo: qualquer
-- carga de dados de outro processo (a seed de leads, por exemplo) tornaria a contagem
-- fixa falsa sem que nada de RLS tivesse mudado.
create function pg_temp.total_negocios() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.deals
$$;

-- ---------- usuários de teste (o trigger em auth.users cria o profile com o papel) ----------
insert into public.allowed_users (email, role, note) values
  ('admin@teste.local',      'admin',      'pgTAP'),
  ('gestor@teste.local',     'gestor',     'pgTAP'),
  ('sdr@teste.local',        'sdr',        'pgTAP'),
  ('emb1@teste.local',       'embaixador', 'pgTAP'),
  ('emb2@teste.local',       'embaixador', 'pgTAP'),
  ('leitura@teste.local',    'leitura',    'pgTAP'),
  ('financeiro@teste.local', 'financeiro', 'pgTAP');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'admin@teste.local',      '{"full_name":"Admin Teste"}'),
  ('a0000000-0000-4000-8000-000000000002', 'gestor@teste.local',     '{"full_name":"Gestor Teste"}'),
  ('a0000000-0000-4000-8000-000000000003', 'sdr@teste.local',        '{"full_name":"SDR Teste"}'),
  ('a0000000-0000-4000-8000-000000000004', 'emb1@teste.local',       '{"full_name":"Embaixador Um Teste"}'),
  ('a0000000-0000-4000-8000-000000000005', 'emb2@teste.local',       '{"full_name":"Embaixador Dois Teste"}'),
  ('a0000000-0000-4000-8000-000000000006', 'leitura@teste.local',    '{"full_name":"Leitura Teste"}'),
  ('a0000000-0000-4000-8000-000000000007', 'financeiro@teste.local', '{"full_name":"Financeiro Teste"}');

-- ---------- dados de teste ----------
insert into public.organizations (id, name, phone_e164, source_id, owner_id, deleted_at) values
  ('b0000000-0000-4000-8000-000000000001', 'Teste RLS Org Embaixador', '+5584999990001',
     (select id from public.sources where slug = 'captura_campo'), 'a0000000-0000-4000-8000-000000000004', null),
  ('b0000000-0000-4000-8000-000000000002', 'Teste RLS Org SDR',        '+5584999990002',
     (select id from public.sources where slug = 'captura_campo'), 'a0000000-0000-4000-8000-000000000003', null),
  ('b0000000-0000-4000-8000-000000000003', 'Teste RLS Org Apagada',    '+5584999990003',
     (select id from public.sources where slug = 'captura_campo'), null, now()),
  ('b0000000-0000-4000-8000-000000000004', 'Teste RLS Org Sem Dono',   '+5584999990004',
     (select id from public.sources where slug = 'captura_campo'), null, null);
insert into public.contacts (id, full_name, phone_e164) values
  ('c0000000-0000-4000-8000-000000000001', 'Pessoa do Embaixador', '+5584999990011'),
  ('c0000000-0000-4000-8000-000000000002', 'Pessoa do SDR',        '+5584999990012');
insert into public.organization_contacts (organization_id, contact_id, is_primary) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', true),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', true);
insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
     (select id from public.pipelines where slug = 'fornecedor'),
     (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'fornecedor' and s.slug = 'prospectado'),
     'a0000000-0000-4000-8000-000000000004'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
     (select id from public.pipelines where slug = 'fornecedor'),
     (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'fornecedor' and s.slug = 'prospectado'),
     'a0000000-0000-4000-8000-000000000003');
select app.suppress('phone', '+5584999990099', 'pgTAP', null::app.channel, null::uuid);

-- =====================================================================
-- anon: nada (nem usage no schema public)
-- =====================================================================
select pg_temp.anonimo();
select throws_ok($$select count(*) from public.organizations$$, '42501', null,
  'anon: leitura negada na tabela organizations');
select throws_ok($$select count(*) from public.organizations_view$$, '42501', null,
  'anon: leitura negada na view organizations_view');
select throws_ok($$insert into public.tags (name) values ('anon')$$, '42501', null,
  'anon: escrita negada em tags');
select pg_temp.sair();

-- =====================================================================
-- leitura: lê tudo (ativos, telefone completo), não escreve
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000006', 'leitura');
select results_eq(
  $$select count(*)::int from public.organizations where name like 'Teste RLS%'$$,
  $$values (3)$$,
  'leitura: vê as organizações ativas (a apagada não aparece)');
select results_eq(
  $$select count(*)::int from public.organizations where deleted_at is not null$$,
  $$values (0)$$,
  'leitura: não vê organizações apagadas (soft delete)');
select is(
  (select phone_e164 from public.organizations where id = 'b0000000-0000-4000-8000-000000000001'),
  '+5584999990001',
  'leitura: telefone completo na tabela base');
select results_eq(
  $$select phone_e164, phone_is_masked from public.organizations_view where id = 'b0000000-0000-4000-8000-000000000001'$$,
  $$values ('+5584999990001'::text, false)$$,
  'leitura: telefone sem máscara na view');
select throws_ok(
  $$insert into public.organizations (name, source_id) values ('Teste RLS leitura', (select id from public.sources where slug = 'captura_campo'))$$,
  '42501', null,
  'leitura: escrita negada em organizations (RLS)');
select throws_ok(
  $$update public.organizations_view set name = 'x' where id = 'b0000000-0000-4000-8000-000000000002'$$,
  '42501', null,
  'leitura: escrita negada pela view (INSTEAD OF)');
select results_eq(
  $$select count(*)::int from public.suppression_list$$, $$values (0)$$,
  'leitura: não lê a suppression_list');
select results_eq(
  $$select count(*)::int from public.audit_log$$, $$values (0)$$,
  'leitura: não lê o audit_log');

-- =====================================================================
-- financeiro: mesma leitura de leitura, sem escrita
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000007', 'financeiro');
select is(
  (select phone_e164 from public.contacts where id = 'c0000000-0000-4000-8000-000000000001'),
  '+5584999990011',
  'financeiro: telefone completo em contacts');
select results_eq(
  $$select count(*)::int from public.deals$$, $$select pg_temp.total_negocios()$$,
  'financeiro: vê todos os negócios');
select results_eq(
  $$select count(*)::int from public.suppression_list$$, $$values (0)$$,
  'financeiro: não lê a suppression_list');
select results_eq(
  $$select count(*)::int from public.pii_access_log$$, $$values (0)$$,
  'financeiro: não lê o pii_access_log');
select throws_ok(
  $$insert into public.contacts (full_name) values ('Teste RLS financeiro')$$, '42501', null,
  'financeiro: escrita negada em contacts');
select throws_ok(
  $$insert into public.tags (name) values ('financeiro')$$, '42501', null,
  'financeiro: escrita negada em catálogos');
select throws_ok(
  $$select public.quick_create_organization('Teste RLS financeiro', (select id from public.categories where slug = 'buffet_adulto_corporativo'), '84 99999-0031', (select id from public.sources where slug = 'captura_campo'))$$,
  '42501', null,
  'financeiro: cadastro rápido negado');

-- =====================================================================
-- sdr: não lê a tabela base (telefone completo); lê e edita pela view (mascarado)
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000003', 'sdr');
select results_eq(
  $$select count(*)::int from public.organizations$$, $$values (0)$$,
  'sdr: não lê organizations na tabela base (phone_e164 completo inacessível)');
select results_eq(
  $$select count(*)::int from public.contacts$$, $$values (0)$$,
  'sdr: não lê contacts na tabela base');
select results_eq(
  $$select count(*)::int from public.organizations_view where name like 'Teste RLS%'$$, $$values (3)$$,
  'sdr: vê todas as organizações ativas pela view');
select results_eq(
  $$select phone_e164, phone_is_masked from public.organizations_view where id = 'b0000000-0000-4000-8000-000000000001'$$,
  $$values ('+55 84 •••••-••01'::text, true)$$,
  'sdr: telefone mascarado na organizations_view');
select is(
  (select phone_e164 from public.contacts_view where id = 'c0000000-0000-4000-8000-000000000001'),
  '+55 84 •••••-••11',
  'sdr: telefone mascarado na contacts_view');
select lives_ok(
  $$insert into public.organizations_view (name, phone_e164, source_id) values ('Teste RLS Criada SDR', '84 99999-0021', (select id from public.sources where slug = 'captura_campo'))$$,
  'sdr: cria organização pela view');
select is(
  (select owner_id from public.organizations_view where name = 'Teste RLS Criada SDR'),
  'a0000000-0000-4000-8000-000000000003',
  'sdr: organização criada fica com o próprio sdr como responsável');
select lives_ok(
  $$update public.organizations_view set name = 'Teste RLS Org SDR (editada)' where id = 'b0000000-0000-4000-8000-000000000002'$$,
  'sdr: edita a própria organização pela view');
select is(
  (select name from public.organizations_view where id = 'b0000000-0000-4000-8000-000000000002'),
  'Teste RLS Org SDR (editada)',
  'sdr: edição pela view persistiu');
select throws_ok(
  $$update public.organizations_view set name = 'x' where id = 'b0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'sdr: não edita organização de outro responsável');
select results_eq(
  $$select count(*)::int from public.pii_access_log$$, $$values (0)$$,
  'sdr: não lê o pii_access_log');
select results_eq(
  $$select count(*)::int from public.suppression_list$$, $$values (1)$$,
  'sdr: lê a suppression_list (consulta antes de enviar)');
select throws_ok(
  $$insert into public.allowed_users (email, role) values ('x@teste.local', 'admin')$$, '42501', null,
  'sdr: não escreve em allowed_users');
select results_eq(
  $$select count(*)::int from public.deals$$, $$select pg_temp.total_negocios()$$,
  'sdr: vê todos os negócios do funil');
select results_eq(
  $$with u as (update public.deals set next_action = 'x' where id = 'd0000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'sdr: não altera negócio de outro responsável (0 linhas)');
select throws_ok(
  $$update public.profiles set role = 'admin' where id = 'a0000000-0000-4000-8000-000000000003'$$, '42501', null,
  'sdr: não muda o próprio papel (profiles_guard)');
select lives_ok(
  $$update public.profiles set full_name = 'SDR Renomeado Teste' where id = 'a0000000-0000-4000-8000-000000000003'$$,
  'sdr: edita o próprio nome no perfil');

-- =====================================================================
-- embaixador: só o que é seu
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000004', 'embaixador');
select results_eq(
  $$select count(*)::int from public.organizations_view where name like 'Teste RLS%'$$, $$values (1)$$,
  'embaixador: vê só a própria organização');
select is(
  (select name from public.organizations_view where name like 'Teste RLS%'),
  'Teste RLS Org Embaixador',
  'embaixador: a organização visível é a sua');
select results_eq(
  $$select count(*)::int from public.deals$$, $$values (1)$$,
  'embaixador: vê só o próprio negócio');
select results_eq(
  $$select id from public.contacts_view$$,
  $$values ('c0000000-0000-4000-8000-000000000001'::uuid)$$,
  'embaixador: vê só as pessoas das suas organizações');
select results_eq(
  $$select count(*)::int from public.deal_stage_history$$, $$values (1)$$,
  'embaixador: histórico de etapas só dos próprios negócios');
select results_eq(
  $$select count(*)::int from public.team_directory where full_name like '% Teste'$$, $$values (7)$$,
  'embaixador: lê o diretório do time (sem PII)');
select lives_ok(
  $$insert into public.deals (organization_id, pipeline_id, stage_id, owner_id) values
      ('b0000000-0000-4000-8000-000000000001', (select id from public.pipelines where slug = 'ativacao'),
       (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'ativacao' and s.slug = 'publicado'),
       'a0000000-0000-4000-8000-000000000004')$$,
  'embaixador: cria negócio próprio na sua organização');
select throws_ok(
  $$insert into public.deals (organization_id, pipeline_id, stage_id, owner_id) values
      ('b0000000-0000-4000-8000-000000000001', (select id from public.pipelines where slug = 'produtor'),
       (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'produtor' and s.slug = 'identificado'),
       'a0000000-0000-4000-8000-000000000005')$$,
  '42501', null,
  'embaixador: não cria negócio em nome de outro responsável');
select lives_ok(
  $$insert into public.activities (type, organization_id, user_id, body) values ('note', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 'nota do embaixador')$$,
  'embaixador: registra atividade própria');
select throws_ok(
  $$insert into public.activities (type, organization_id, user_id, body) values ('note', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', 'nota alheia')$$,
  '42501', null,
  'embaixador: não registra atividade em nome de outro usuário');
select results_eq(
  $$with u as (update public.organizations_view set name = 'x' where id = 'b0000000-0000-4000-8000-000000000002' returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'embaixador: não edita organização alheia (a view nem a mostra: 0 linhas)');
select lives_ok(
  $$insert into public.organizations_view (name, phone_e164, source_id, owner_id) values ('Teste RLS Criada Embaixador', '84 99999-0041', (select id from public.sources where slug = 'captura_campo'), 'a0000000-0000-4000-8000-000000000005')$$,
  'embaixador: cria organização pela view');
select is(
  (select owner_id from public.organizations_view where name = 'Teste RLS Criada Embaixador'),
  'a0000000-0000-4000-8000-000000000004',
  'embaixador: responsável forçado para ele mesmo, mesmo informando outro');
select throws_ok(
  $$select public.reveal_phone('b0000000-0000-4000-8000-000000000002')$$, '42501', null,
  'embaixador: não revela telefone de organização fora da carteira');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000005', 'embaixador');
select results_eq(
  $$select count(*)::int from public.organizations_view where name like 'Teste RLS%'$$, $$values (0)$$,
  'embaixador sem carteira: não vê organização alguma');
select results_eq(
  $$select count(*)::int from public.deals$$, $$values (0)$$,
  'embaixador sem carteira: não vê negócio algum');

-- =====================================================================
-- gestor: vê tudo (inclusive apagadas), edita base e catálogos; não apaga nem administra acesso
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000002', 'gestor');
select results_eq(
  $$select count(*)::int from public.organizations where name like 'Teste RLS%' and deleted_at is not null$$, $$values (1)$$,
  'gestor: vê organizações apagadas (para restaurar)');
select lives_ok(
  $$update public.organizations set name = 'Teste RLS Org Embaixador (gestor)' where id = 'b0000000-0000-4000-8000-000000000001'$$,
  'gestor: edita organização de qualquer responsável na tabela base');
select lives_ok(
  $$insert into public.tags (name, color) values ('pgtap-gestor', '#000000')$$,
  'gestor: escreve em catálogos');
select results_eq(
  $$with d as (delete from public.organizations where id = 'b0000000-0000-4000-8000-000000000004' returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'gestor: não apaga organizações (0 linhas; só admin)');
select throws_ok(
  $$insert into public.allowed_users (email, role) values ('y@teste.local', 'sdr')$$, '42501', null,
  'gestor: não escreve em allowed_users');
select results_eq(
  $$select count(*)::int from public.audit_log$$, $$values (0)$$,
  'gestor: não lê o audit_log (só admin)');
select lives_ok(
  $$select count(*) from public.pii_access_log$$,
  'gestor: lê o pii_access_log');
select results_eq(
  $$with u as (update public.deals set next_action = 'ligar' where id = 'd0000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'gestor: altera negócio de qualquer responsável');

-- =====================================================================
-- admin: tudo, exceto o que é append-only/sistema
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000001', 'admin');
select cmp_ok((select count(*)::int from public.audit_log), '>', 0,
  'admin: lê o audit_log');
select lives_ok(
  $$insert into public.allowed_users (email, role, note) values ('novo@teste.local', 'sdr', 'pgTAP admin')$$,
  'admin: escreve em allowed_users');
select results_eq(
  $$with d as (delete from public.organizations where id = 'b0000000-0000-4000-8000-000000000004' returning 1) select count(*)::int from d$$,
  $$values (1)$$,
  'admin: apaga organização');
select throws_ok(
  $$insert into public.audit_log (action, table_name, row_id) values ('INSERT', 'x', '1')$$, '42501', null,
  'admin: não escreve no audit_log (sistema)');
select throws_ok(
  $$update public.consent_events set evidence_text = 'x'$$, '42501', null,
  'admin: não altera consent_events (append-only)');
select lives_ok(
  $$update public.profiles set role = 'gestor' where id = 'a0000000-0000-4000-8000-000000000006'$$,
  'admin: altera o papel de outro perfil');
select is(
  (select role::text from public.profiles where id = 'a0000000-0000-4000-8000-000000000006'),
  'gestor',
  'admin: papel alterado persistiu');

select pg_temp.sair();
select * from finish();
rollback;

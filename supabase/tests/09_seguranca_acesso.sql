-- =====================================================================
-- pgTAP — regressões de segurança e acesso (revisão do D1).
-- Cada bloco reproduz um furo encontrado na revisão e fixa o comportamento corrigido:
--   * consent_events: quem pode registrar consentimento e de quem (RF-ADM-01, RF-ADM-04);
--   * embaixador: não escala a carteira criando/movendo negócio nem tocando atividade alheia (RF-ADM-01, RF-BAS-14);
--   * sdr: não escreve na tabela base de organizations/contacts (a superfície dele é a view);
--   * override manual de temperatura vale mesmo quando quem grava é sdr/embaixador (PRD §5.6);
--   * app.find_org_matches enxerga a base para quem captura, sem PII, e recusa leitura/financeiro (RF-BAS-08);
--   * busca por trecho de dígitos não reconstrói o telefone mascarado (RF-BAS-14).
-- =====================================================================
begin;
select plan(50);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
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
create function pg_temp.fonte(p text) returns int language sql as $$
  select id from public.sources where slug = p
$$;

-- ---------- fixtures ----------
insert into public.allowed_users (email, role, note) values
  ('sdr.seg@teste.local',        'sdr',        'pgTAP'),
  ('emb.seg@teste.local',        'embaixador', 'pgTAP'),
  ('leitura.seg@teste.local',    'leitura',    'pgTAP'),
  ('financeiro.seg@teste.local', 'financeiro', 'pgTAP'),
  ('gestor.seg@teste.local',     'gestor',     'pgTAP');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000901', 'sdr.seg@teste.local',        '{"full_name":"SDR Seg"}'),
  ('a0000000-0000-4000-8000-000000000902', 'emb.seg@teste.local',        '{"full_name":"Embaixador Seg"}'),
  ('a0000000-0000-4000-8000-000000000903', 'leitura.seg@teste.local',    '{"full_name":"Leitura Seg"}'),
  ('a0000000-0000-4000-8000-000000000904', 'financeiro.seg@teste.local', '{"full_name":"Financeiro Seg"}'),
  ('a0000000-0000-4000-8000-000000000905', 'gestor.seg@teste.local',     '{"full_name":"Gestor Seg"}');

-- Alfa é da SDR e tem override de 3 estrelas; Gama é do embaixador.
insert into public.organizations (id, name, phone_e164, source_id, owner_id, temperature_override, temperature_override_reason) values
  ('b0000000-0000-4000-8000-000000000901', 'Seguranca Alfa', '+5584999990912', pg_temp.fonte('captura_campo'),
     'a0000000-0000-4000-8000-000000000901', 3, 'contato pessoal do Rafael'),
  ('b0000000-0000-4000-8000-000000000902', 'Seguranca Gama', '+5584999990914', pg_temp.fonte('captura_campo'),
     'a0000000-0000-4000-8000-000000000902', null, null);
insert into public.contacts (id, full_name, phone_e164) values
  ('c0000000-0000-4000-8000-000000000901', 'Pessoa da Alfa', '+5584966660911');
insert into public.organization_contacts (organization_id, contact_id, is_primary) values
  ('b0000000-0000-4000-8000-000000000901', 'c0000000-0000-4000-8000-000000000901', true);
insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000901', 'b0000000-0000-4000-8000-000000000901',
     (select id from public.pipelines where slug = 'fornecedor'),
     (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
       where p.slug = 'fornecedor' and s.slug = 'prospectado'),
     'a0000000-0000-4000-8000-000000000901');

-- =====================================================================
-- consent_events: papel e carteira (o INSERT dispara app.consent_apply, que suprime)
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000903', 'leitura');
select throws_ok(
  $$insert into public.consent_events (kind, organization_id, evidence_text)
      values ('data_use_authorized', 'b0000000-0000-4000-8000-000000000901', 'autorizo')$$,
  '42501', null, 'consent: leitura não registra autorização de uso de dados');
select throws_ok(
  $$insert into public.consent_events (kind, organization_id, evidence_text)
      values ('contact_optout', 'b0000000-0000-4000-8000-000000000901', 'sair')$$,
  '42501', null, 'consent: leitura não registra opt-out (não suprime a base)');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000904', 'financeiro');
select throws_ok(
  $$insert into public.consent_events (kind, organization_id, evidence_text)
      values ('erasure_request', 'b0000000-0000-4000-8000-000000000901', 'apaga tudo')$$,
  '42501', null, 'consent: financeiro não registra pedido de eliminação');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000901', 'bot');
select throws_ok(
  $$insert into public.consent_events (kind, organization_id, evidence_text)
      values ('data_use_authorized', 'b0000000-0000-4000-8000-000000000901', 'x')$$,
  '42501', null, 'consent: papel bot não registra consentimento (workers usam service_role)');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000902', 'embaixador');
select throws_ok(
  $$insert into public.consent_events (kind, organization_id, evidence_text)
      values ('erasure_request', 'b0000000-0000-4000-8000-000000000901', 'apaga tudo')$$,
  '42501', null, 'consent: embaixador não registra evento em organização fora da carteira');
select throws_ok(
  $$insert into public.consent_events (kind, contact_id, evidence_text)
      values ('contact_optout', 'c0000000-0000-4000-8000-000000000901', 'sair')$$,
  '42501', null, 'consent: embaixador não registra evento de pessoa fora da carteira');
select lives_ok(
  $$insert into public.consent_events (kind, organization_id, evidence_text)
      values ('data_use_authorized', 'b0000000-0000-4000-8000-000000000902', 'autorizo')$$,
  'consent: embaixador registra na própria carteira');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000901', 'sdr');
select lives_ok(
  $$insert into public.consent_events (id, kind, organization_id, evidence_text, recorded_by)
      values ('f0000000-0000-4000-8000-000000000901', 'data_use_authorized',
              'b0000000-0000-4000-8000-000000000901', 'autorizo', 'a0000000-0000-4000-8000-000000000905')$$,
  'consent: sdr registra na organização que enxerga');
select pg_temp.sair();
select is(
  (select recorded_by from public.consent_events where id = 'f0000000-0000-4000-8000-000000000901'),
  'a0000000-0000-4000-8000-000000000901',
  'consent: recorded_by não é forjável (vale sempre auth.uid())');
select is(
  (select do_not_contact from public.organizations where id = 'b0000000-0000-4000-8000-000000000901'),
  false, 'consent: as tentativas bloqueadas não marcaram do_not_contact');
-- Contagem restrita à organização do teste: a suppression_list é permanente e recebe linhas
-- de qualquer opt-out real (inclusive o gravado pelo kanban), então contagem global aqui
-- quebraria o teste sem que nada de segurança tivesse mudado.
select is(
  (select count(*)::int from public.suppression_list s
     where s.source_event_id in (select c.id from public.consent_events c
                                  where c.organization_id = 'b0000000-0000-4000-8000-000000000901')),
  0,
  'consent: as tentativas bloqueadas não suprimiram nada');
-- Contraprova: a restrição é do papel do JWT, não da máquina. Worker e wa-webhook entram pelo
-- service_role e continuam registrando o consentimento que chega pela conversa (RF-ADM-01).
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok(
  $$insert into public.consent_events (kind, organization_id, evidence_text)
      values ('data_use_authorized', 'b0000000-0000-4000-8000-000000000901', 'autorizou na conversa')$$,
  'consent: service_role (worker, Edge Function) continua registrando consentimento');
reset role;
select set_config('request.jwt.claims', '', true);

-- =====================================================================
-- embaixador: negócio não amplia a carteira; atividade/tarefa não alcançam negócio alheio
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000902', 'embaixador');
select is(
  (select r ->> 'existing_id' from (select public.quick_create_organization(
      'Sonda', (select id from public.categories where slug = 'buffet_adulto_corporativo'),
      '84 99999 0912', pg_temp.fonte('captura_campo')) as r) s),
  null, 'quick_create: não entrega o id de organização fora da carteira');
select is(
  (select r ->> 'reason' from (select public.quick_create_organization(
      'Sonda', (select id from public.categories where slug = 'buffet_adulto_corporativo'),
      '84 99999 0912', pg_temp.fonte('captura_campo')) as r) s),
  'telefone_ja_cadastrado', 'quick_create: ainda avisa que o telefone já existe (dedup preservada)');
select throws_ok(
  $$insert into public.deals (organization_id, pipeline_id, stage_id, owner_id) values
      ('b0000000-0000-4000-8000-000000000901', (select id from public.pipelines where slug = 'ativacao'),
       (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'ativacao' and s.slug = 'publicado'),
       'a0000000-0000-4000-8000-000000000902')$$,
  '42501', null, 'embaixador: não cria negócio em organização alheia (escalada de privilégio)');
select lives_ok(
  $$insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id) values
      ('d0000000-0000-4000-8000-000000000902', 'b0000000-0000-4000-8000-000000000902',
       (select id from public.pipelines where slug = 'ativacao'),
       (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'ativacao' and s.slug = 'publicado'),
       'a0000000-0000-4000-8000-000000000902')$$,
  'embaixador: cria negócio na própria organização');
select throws_ok(
  $$update public.deals set organization_id = 'b0000000-0000-4000-8000-000000000901'
     where id = 'd0000000-0000-4000-8000-000000000902'$$,
  '42501', null, 'embaixador: não move o próprio negócio para organização alheia');
select results_eq(
  $$select count(*)::int from public.organizations_view where name like 'Seguranca%'$$, $$values (1)$$,
  'embaixador: a carteira continua com uma organização só');
select throws_ok(
  $$select public.reveal_phone('b0000000-0000-4000-8000-000000000901')$$, '42501', null,
  'embaixador: telefone da organização alheia continua fora de alcance');
select throws_ok(
  $$insert into public.activities (type, organization_id, deal_id, user_id, body)
      values ('note', 'b0000000-0000-4000-8000-000000000901', 'd0000000-0000-4000-8000-000000000901',
              'a0000000-0000-4000-8000-000000000902', 'nota alheia')$$,
  '42501', null, 'embaixador: não registra atividade em negócio alheio');
select throws_ok(
  $$insert into public.tasks (title, deal_id, organization_id, assignee_id)
      values ('Ligar', 'd0000000-0000-4000-8000-000000000901', 'b0000000-0000-4000-8000-000000000901',
              'a0000000-0000-4000-8000-000000000902')$$,
  '42501', null, 'embaixador: não cria tarefa em negócio alheio');
select lives_ok(
  $$insert into public.activities (type, organization_id, deal_id, user_id, body)
      values ('note', 'b0000000-0000-4000-8000-000000000902', 'd0000000-0000-4000-8000-000000000902',
              'a0000000-0000-4000-8000-000000000902', 'minha nota')$$,
  'embaixador: registra atividade no próprio negócio');
select pg_temp.sair();
select is(
  (select last_activity_at from public.deals where id = 'd0000000-0000-4000-8000-000000000901'),
  null, 'embaixador: last_activity_at do negócio alheio não foi tocado (temperatura intacta)');

-- =====================================================================
-- sdr: a tabela base de organizations/contacts é fechada (a superfície dele é a view)
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000901', 'sdr');
select results_eq(
  $$with u as (update public.organizations
                  set do_not_contact = false, deleted_at = now(), temperature = 'quente', anonymized_at = now()
              returning 1)
    select count(*)::int from u$$,
  $$values (0)$$,
  'sdr: UPDATE sem WHERE na tabela base não atinge linha alguma');
select throws_ok(
  $$insert into public.organizations (name, source_id, owner_id, phone_e164)
      values ('Seguranca Direto', (select id from public.sources where slug = 'captura_campo'),
              'a0000000-0000-4000-8000-000000000903', '84 99999-0999')$$,
  '42501', null, 'sdr: INSERT direto na tabela base é negado (owner_id de terceiro incluído)');
select results_eq(
  $$with u as (update public.contacts set notes = 'zz' returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'sdr: UPDATE sem WHERE em contacts não atinge linha alguma');
select throws_ok(
  $$insert into public.contacts (full_name, phone_e164) values ('Pessoa Direta', '84 96666-0919')$$,
  '42501', null, 'sdr: INSERT direto na tabela base de contacts é negado (a superfície dele é a view)');
select lives_ok(
  $$update public.organizations_view set name = 'Seguranca Alfa (editada)'
     where id = 'b0000000-0000-4000-8000-000000000901'$$,
  'sdr: continua editando a própria organização pela view');
select pg_temp.sair();
select results_eq(
  $$select name, deleted_at is null, do_not_contact from public.organizations
     where id = 'b0000000-0000-4000-8000-000000000901'$$,
  $$values ('Seguranca Alfa (editada)'::text, true, false)$$,
  'sdr: a organização segue viva, sem supressão revertida, com a edição da view aplicada');

-- O embaixador tem a mesma superfície reduzida; admin/gestor continuam escrevendo na base.
select pg_temp.entrar('a0000000-0000-4000-8000-000000000902', 'embaixador');
select throws_ok(
  $$insert into public.organizations (name, source_id, phone_e164)
      values ('Seguranca Direta Emb', (select id from public.sources where slug = 'captura_campo'), '84 95555-0001')$$,
  '42501', null, 'embaixador: INSERT direto na tabela base de organizations é negado');
select pg_temp.entrar('a0000000-0000-4000-8000-000000000905', 'gestor');
select lives_ok(
  $$insert into public.organizations (id, name, source_id, phone_e164)
      values ('b0000000-0000-4000-8000-000000000903', 'Seguranca Gestor',
              (select id from public.sources where slug = 'captura_campo'), '84 95555-0002')$$,
  'gestor: continua escrevendo direto na tabela base (a restrição é de papel, não da tabela)');
select pg_temp.sair();

-- =====================================================================
-- override manual de temperatura vale para quem grava com RLS (PRD §5.6)
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000901', 'sdr');
select lives_ok(
  $$update public.deals set next_action = 'ligar' where id = 'd0000000-0000-4000-8000-000000000901'$$,
  'override: sdr atualiza o próprio negócio');
select pg_temp.sair();
select is(
  (select temperature::text from public.deals where id = 'd0000000-0000-4000-8000-000000000901'),
  'quente', 'override: 3 estrelas vencem a regra mesmo com a escrita feita pela sdr');
select is(
  (select temperature::text from public.organizations where id = 'b0000000-0000-4000-8000-000000000901'),
  'quente', 'override: o espelho na organização também fica quente');

-- =====================================================================
-- dedup (app.find_org_matches): quem captura enxerga a base; quem só lê, não executa
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000901', 'sdr');
select cmp_ok(
  (select count(*)::int from app.find_org_matches('{"phone_e164":"84999990912","name":"Seguranca Alfa"}')),
  '>', 0, 'find_org_matches: sdr recebe candidatos (dedup deixa de ser cega em campo)');
select pg_temp.entrar('a0000000-0000-4000-8000-000000000902', 'embaixador');
select cmp_ok(
  (select count(*)::int from app.find_org_matches('{"phone_e164":"84999990912"}')),
  '>', 0, 'find_org_matches: embaixador recebe candidatos (só id/confiança/motivo, sem PII)');
select pg_temp.entrar('a0000000-0000-4000-8000-000000000903', 'leitura');
select throws_ok(
  $$select count(*) from app.find_org_matches('{"phone_e164":"84999990912"}')$$,
  '42501', null, 'find_org_matches: papel que não escreve não executa');
select pg_temp.entrar('a0000000-0000-4000-8000-000000000904', 'financeiro');
select throws_ok(
  $$select count(*) from app.find_org_matches('{"cnpj":"11.222.333/0001-81"}')$$,
  '42501', null, 'find_org_matches: financeiro também não consulta candidatos a duplicata');
select is(
  (select pg_get_function_result(p.oid) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'find_org_matches'),
  'TABLE(organization_id uuid, confidence numeric, reason text)',
  'find_org_matches: definer devolve só id, confiança e motivo — nenhuma PII escapa da dedup');
select pg_temp.sair();

-- =====================================================================
-- busca: trecho de dígitos não reconstrói o telefone mascarado (RF-BAS-14)
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000901', 'sdr');
select is(
  (select count(*)::int from public.search_organizations('99999')), 0,
  'search: sdr não busca por trecho de dígitos (o telefone dele é mascarado)');
select is(
  (select count(*)::int from public.search_organizations('84999990912')), 1,
  'search: sdr acha pelo número completo (RF-BAS-12 preservado)');
select pg_temp.entrar('a0000000-0000-4000-8000-000000000903', 'leitura');
select cmp_ok(
  (select count(*)::int from public.search_organizations('99999')), '>', 0,
  'search: quem já lê o telefone completo continua buscando por trecho');
select pg_temp.entrar('a0000000-0000-4000-8000-000000000902', 'embaixador');
select is(
  (select count(*)::int from public.search_organizations('99999')), 0,
  'search: embaixador também não busca por trecho de dígitos (mesmo oráculo, mesma máscara)');
select is(
  (select count(*)::int from public.search_organizations('84999990914')), 1,
  'search: embaixador acha a própria organização pelo número completo (o zero acima é a regra, não a carteira)');
select pg_temp.entrar('a0000000-0000-4000-8000-000000000905', 'gestor');
select cmp_ok(
  (select count(*)::int from public.search_organizations('99999')), '>', 0,
  'search: gestor lê o telefone completo e continua buscando por trecho');
select pg_temp.sair();

-- =====================================================================
-- privilégios de execução
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'app.handle_new_auth_user()', 'execute'),
  'privilégios: authenticated não executa a função de gatilho de auth.users');
select ok(not has_function_privilege('anon', 'app.find_org_matches(jsonb, numeric)', 'execute'),
  'privilégios: anon não executa app.find_org_matches');
select ok(has_function_privilege('authenticated', 'app.find_org_matches(jsonb, numeric)', 'execute'),
  'privilégios: authenticated executa app.find_org_matches (o papel é checado dentro dela)');
-- Varredura, e não lista: qualquer função de gatilho nova nasce sem EXECUTE para a API, e
-- nenhuma função do schema app pode ficar aberta (o padrão de fábrica do Postgres é EXECUTE
-- para PUBLIC, que anon herda).
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prorettype = 'pg_catalog.trigger'::regtype
      and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute'))),
  0, 'privilégios: nenhuma função de gatilho do schema app é executável por authenticated/anon');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute')),
  0, 'privilégios: anon não executa função alguma do schema app (nem por EXECUTE de PUBLIC)');

select * from finish();
rollback;

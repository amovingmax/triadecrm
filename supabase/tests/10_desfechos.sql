-- =====================================================================
-- pgTAP — Catálogo de desfechos de interação e janela de recontato
-- (RF-FUN-12 e RF-FUN-13; migração 20260904000800; especificação
--  docs/design/spec-desfechos-de-interacao.md, §6 "Testes pgTAP a escrever").
--
-- Cobre, na ordem: estrutura e RLS do catálogo; app.interaction_surface;
-- teto de 8 desfechos ativos por superfície; recusa de desfecho fora da
-- superfície; outcome_pending; porta batida e porta aberta (RF-MET-01);
-- cooldown_until e a view v_contact_cooldown (RF-FUN-13); efeito declarado
-- em etapa e temperatura; motivo de perda (RF-FUN-04); privilégios.
--
-- O vocabulário vem da seed (supabase/seed.sql, seção 12: os 34 desfechos da
-- §3 da especificação). Este arquivo NÃO semeia catálogo: ele testa o que a
-- seed carregou, que é o que a §6, item 9, pede. Se a seed não tiver rodado
-- (catálogo vazio), o bloco 12 acusa antes dos demais.
--
-- Roda em transação e desfaz tudo (nenhuma linha sobrevive ao arquivo).
-- =====================================================================
begin;
select plan(157);

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
create function pg_temp.fonte(p text) returns int language sql as $$
  select id from public.sources where slug = p
$$;
create function pg_temp.funil(p_slug text) returns int language sql as $$
  select id from public.pipelines where slug = p_slug
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_slug
$$;
create function pg_temp.desfecho(p_slug text) returns int language sql as $$
  select id from public.interaction_outcomes where slug = p_slug
$$;
create function pg_temp.motivo(p_slug text) returns int language sql as $$
  select id from public.lost_reasons where slug = p_slug
$$;
-- Metadata de uma atividade pelo apelido gravado em metadata.rotulo.
create function pg_temp.meta(p_rotulo text) returns jsonb language sql as $$
  select metadata from public.activities where metadata ->> 'rotulo' = p_rotulo
$$;

-- ---------- pessoas e alvos ----------
insert into public.allowed_users (email, role, note) values
  ('admin.desf@teste.local',   'admin',      'pgTAP'),
  ('gestor.desf@teste.local',  'gestor',     'pgTAP'),
  ('sdr.desf@teste.local',     'sdr',        'pgTAP'),
  ('emb.desf@teste.local',     'embaixador', 'pgTAP'),
  ('leitura.desf@teste.local', 'leitura',    'pgTAP');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000001001', 'admin.desf@teste.local',   '{"full_name":"Admin Desfecho"}'),
  ('a0000000-0000-4000-8000-000000001002', 'gestor.desf@teste.local',  '{"full_name":"Gestor Desfecho"}'),
  ('a0000000-0000-4000-8000-000000001003', 'sdr.desf@teste.local',     '{"full_name":"SDR Desfecho"}'),
  ('a0000000-0000-4000-8000-000000001004', 'emb.desf@teste.local',     '{"full_name":"Embaixador Desfecho"}'),
  ('a0000000-0000-4000-8000-000000001005', 'leitura.desf@teste.local', '{"full_name":"Leitura Desfecho"}');

insert into public.organizations (id, name, phone_e164, source_id, owner_id) values
  ('b0000000-0000-4000-8000-000000001001', 'Desfecho Alvo Geral',        '+5584988881001', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  ('b0000000-0000-4000-8000-000000001002', 'Desfecho Janela Ultima',     '+5584988881002', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  ('b0000000-0000-4000-8000-000000001003', 'Desfecho Janela Aberta',     '+5584988881003', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  ('b0000000-0000-4000-8000-000000001004', 'Desfecho Bloqueio Optout',   '+5584988881004', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  ('b0000000-0000-4000-8000-000000001005', 'Desfecho Bloqueio Reaberto', '+5584988881005', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  ('b0000000-0000-4000-8000-000000001006', 'Desfecho Optout Sem Volta',  '+5584988881006', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  ('b0000000-0000-4000-8000-000000001007', 'Desfecho Carteira Embaixador','+5584988881007', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001004'),
  ('b0000000-0000-4000-8000-000000001008', 'Desfecho Etapa Destino',     '+5584988881008', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  ('b0000000-0000-4000-8000-000000001009', 'Desfecho Motivo de Perda',   '+5584988881009', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  ('b0000000-0000-4000-8000-000000001010', 'Desfecho Porta Aberta',      '+5584988881010', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  -- Números mortos (RF-FUN-13): não bloqueiam, ficam em janela permanente até outro canal.
  ('b0000000-0000-4000-8000-000000001011', 'Desfecho Numero Invalido',   '+5584988881011', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  ('b0000000-0000-4000-8000-000000001012', 'Desfecho Numero Errado S/N', '+5584988881012', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  ('b0000000-0000-4000-8000-000000001013', 'Desfecho Numero e Outro Canal','+5584988881013', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003'),
  ('b0000000-0000-4000-8000-000000001014', 'Desfecho Atividade Sem Org', '+5584988881014', pg_temp.fonte('captura_campo'), 'a0000000-0000-4000-8000-000000001003');

insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id) values
  ('d0000000-0000-4000-8000-000000001005', 'b0000000-0000-4000-8000-000000001005', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado'), 'a0000000-0000-4000-8000-000000001003'),
  ('d0000000-0000-4000-8000-000000001006', 'b0000000-0000-4000-8000-000000001006', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado'), 'a0000000-0000-4000-8000-000000001003'),
  ('d0000000-0000-4000-8000-000000001008', 'b0000000-0000-4000-8000-000000001008', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','contatado'),   'a0000000-0000-4000-8000-000000001003'),
  ('d0000000-0000-4000-8000-000000001009', 'b0000000-0000-4000-8000-000000001009', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','em_conversa'), 'a0000000-0000-4000-8000-000000001003'),
  ('d0000000-0000-4000-8000-000000001011', 'b0000000-0000-4000-8000-000000001011', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','contatado'),   'a0000000-0000-4000-8000-000000001003'),
  ('d0000000-0000-4000-8000-000000001014', 'b0000000-0000-4000-8000-000000001014', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','contatado'),   'a0000000-0000-4000-8000-000000001003');

-- =====================================================================
-- 1. Estrutura do catálogo (spec §6, item 1)
-- =====================================================================
select has_table('public', 'interaction_outcomes', 'catálogo: a tabela public.interaction_outcomes existe');
select has_column('public', 'interaction_outcomes', 'slug',              'catálogo: coluna slug');
select has_column('public', 'interaction_outcomes', 'surfaces',          'catálogo: coluna surfaces');
select has_column('public', 'interaction_outcomes', 'cooldown_days',     'catálogo: coluna cooldown_days (RF-FUN-13)');
select has_column('public', 'interaction_outcomes', 'can_reactivate',    'catálogo: coluna can_reactivate (RF-FUN-13)');
select has_column('public', 'interaction_outcomes', 'counts_as',         'catálogo: coluna counts_as (RF-MET-01)');
select has_column('public', 'activities',           'outcome_id',        'activities: coluna outcome_id (RF-FUN-12)');
select hasnt_column('public', 'activities', 'outcome',
  'activities: a coluna de texto livre outcome foi derrubada (nada de desfecho digitado)');
select col_is_unique('public', 'interaction_outcomes', array['slug'], 'catálogo: slug é único');
select ok((select relrowsecurity from pg_class where oid = 'public.interaction_outcomes'::regclass),
  'catálogo: RLS habilitada na tabela');
select set_eq(
  $$select policyname::text from pg_policies where schemaname = 'public' and tablename = 'interaction_outcomes'$$,
  $$values ('interaction_outcomes_select'::text), ('interaction_outcomes_insert'::text),
           ('interaction_outcomes_update'::text), ('interaction_outcomes_delete'::text)$$,
  'catálogo: as quatro políticas nomeadas existem (select/insert/update/delete)');
-- Aposentar chip é is_active = false, nunca delete: a FK precisa existir para segurar isso.
select ok(exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.activities'::regclass and c.contype = 'f'
       and c.confrelid = 'public.interaction_outcomes'::regclass),
  'activities.outcome_id é chave estrangeira para o catálogo (chip aposentado não some do histórico)');
-- Nome do chip: 28 caracteres é o que cabe numa linha no celular (RF-MET-06).
select throws_ok(
  $$insert into public.interaction_outcomes (slug, name, surfaces)
      values ('tst_nome_longo', 'Perfil inativo ou não é fornecedor', array['visita']::app.interaction_surface[])$$,
  '23514', null, 'catálogo: rótulo com mais de 28 caracteres é recusado');
select throws_ok(
  $$insert into public.interaction_outcomes (slug, name, surfaces)
      values ('tst_sem_superficie', 'Sem superfície', array[]::app.interaction_surface[])$$,
  '23514', null, 'catálogo: desfecho sem superfície alguma é recusado');
select throws_ok(
  $$insert into public.interaction_outcomes (slug, name, surfaces, requires_lost_reason)
      values ('tst_perda_sem_etapa', 'Perda sem etapa', array['visita']::app.interaction_surface[], true)$$,
  '23514', null, 'catálogo: desfecho que exige motivo de perda sem etapa de destino é recusado');
select throws_ok(
  $$insert into public.interaction_outcomes (slug, name, surfaces, cooldown_days)
      values ('tst_cooldown_negativo', 'Cooldown negativo', array['visita']::app.interaction_surface[], -1)$$,
  '23514', null, 'catálogo: cooldown_days negativo é recusado');

-- =====================================================================
-- 2. RLS do catálogo por papel (spec §6, item 1)
-- =====================================================================
select pg_temp.anonimo();
select throws_ok($$select count(*) from public.interaction_outcomes$$, '42501', null,
  'anon: leitura negada no catálogo de desfechos');
select throws_ok($$select count(*) from public.v_contact_cooldown$$, '42501', null,
  'anon: leitura negada na view de janela de recontato');
select throws_ok(
  $$insert into public.interaction_outcomes (slug, name, surfaces)
      values ('tst_anon', 'Anon', array['visita']::app.interaction_surface[])$$,
  '42501', null, 'anon: escrita negada no catálogo');
select pg_temp.sair();

-- sdr: lê tudo, não escreve nada
select pg_temp.entrar('a0000000-0000-4000-8000-000000001003', 'sdr');
select is((select count(*)::int from public.interaction_outcomes where slug like 'wa\_%'), 7,
  'sdr: lê o catálogo (os 7 chips de WhatsApp)');
select throws_ok(
  $$insert into public.interaction_outcomes (slug, name, surfaces)
      values ('tst_sdr', 'SDR', array['visita']::app.interaction_surface[])$$,
  '42501', null, 'sdr: insert negado no catálogo (chip novo é ato de gestão, RF-ADM-02)');
update public.interaction_outcomes set name = 'Hackeado' where slug = 'wa_respondeu';
select is((select name from public.interaction_outcomes where slug = 'wa_respondeu'), 'Respondeu',
  'sdr: update no catálogo não alcança linha alguma (RLS)');
delete from public.interaction_outcomes where slug = 'wa_respondeu';
select is((select count(*)::int from public.interaction_outcomes where slug = 'wa_respondeu'), 1,
  'sdr: delete no catálogo não alcança linha alguma (RLS)');
select pg_temp.sair();

-- embaixador: lê tudo, não escreve nada
select pg_temp.entrar('a0000000-0000-4000-8000-000000001004', 'embaixador');
select is((select count(*)::int from public.interaction_outcomes where slug like 'vis\_%'), 7,
  'embaixador: lê o catálogo (os 7 chips de visita)');
select throws_ok(
  $$insert into public.interaction_outcomes (slug, name, surfaces)
      values ('tst_emb', 'Embaixador', array['visita']::app.interaction_surface[])$$,
  '42501', null, 'embaixador: insert negado no catálogo');
update public.interaction_outcomes set cooldown_days = 0 where slug = 'wa_optout';
select is((select cooldown_days from public.interaction_outcomes where slug = 'wa_optout'), 36500,
  'embaixador: update no catálogo não alcança linha alguma (RLS)');
select pg_temp.sair();

-- leitura: lê o catálogo (a UI mostra o nome do chip nos relatórios), não escreve
select pg_temp.entrar('a0000000-0000-4000-8000-000000001005', 'leitura');
select ok((select count(*) from public.interaction_outcomes) >= 34, 'leitura: lê o catálogo');
select throws_ok(
  $$insert into public.interaction_outcomes (slug, name, surfaces)
      values ('tst_leitura', 'Leitura', array['visita']::app.interaction_surface[])$$,
  '42501', null, 'leitura: insert negado no catálogo');
select pg_temp.sair();

-- gestor e admin escrevem
select pg_temp.entrar('a0000000-0000-4000-8000-000000001002', 'gestor');
select lives_ok(
  $$insert into public.interaction_outcomes (slug, name, surfaces, position)
      values ('tst_gestor', 'Chip do gestor', array['visita']::app.interaction_surface[], 90)$$,
  'gestor: cria chip no catálogo (RF-ADM-02)');
update public.interaction_outcomes set is_active = false where slug = 'tst_gestor';
select is((select is_active from public.interaction_outcomes where slug = 'tst_gestor'), false,
  'gestor: aposenta chip por is_active = false');
delete from public.interaction_outcomes where slug = 'tst_gestor';
select is((select count(*)::int from public.interaction_outcomes where slug = 'tst_gestor'), 0,
  'gestor: apaga chip do catálogo');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000001001', 'admin');
select lives_ok(
  $$insert into public.interaction_outcomes (slug, name, surfaces, position)
      values ('tst_admin', 'Chip do admin', array['visita']::app.interaction_surface[], 91)$$,
  'admin: cria chip no catálogo');
select lives_ok($$delete from public.interaction_outcomes where slug = 'tst_admin'$$,
  'admin: apaga chip do catálogo');
select pg_temp.sair();

-- Auditoria do catálogo (spec §5: "chip novo é ato de gestor, auditado", RF-ADM-02/03).
-- As escrituras acima (gestor e admin) são as únicas que alcançaram linha até aqui.
select is(
  (select count(distinct action)::int from public.audit_log where table_name = 'interaction_outcomes'),
  3, 'auditoria: criar, alterar e apagar chip do catálogo deixam linha em audit_log (RF-ADM-03)');
select is(
  (select actor_role from public.audit_log
    where table_name = 'interaction_outcomes' and action = 'UPDATE'
    order by created_at desc limit 1),
  'gestor', 'auditoria: a linha do catálogo registra quem alterou (papel do JWT)');

-- =====================================================================
-- 3. app.interaction_surface (spec §6, item 2)
-- =====================================================================
select is(app.interaction_surface('presencial', 'visit'),    'visita'::app.interaction_surface,
  'superfície: (presencial, visit) = visita');
select is(app.interaction_surface('presencial', 'meeting'),  'reuniao'::app.interaction_surface,
  'superfície: (presencial, meeting) = reuniao');
select is(app.interaction_surface('phone', 'call'),          'ligacao'::app.interaction_surface,
  'superfície: (phone, call) = ligacao');
select is(app.interaction_surface('whatsapp', 'call'),       'ligacao'::app.interaction_surface,
  'superfície: o TIPO manda — (whatsapp, call) continua sendo ligacao');
select is(app.interaction_surface('instagram', 'message'),   'instagram_dm'::app.interaction_surface,
  'superfície: (instagram, message) = instagram_dm');
select is(app.interaction_surface('whatsapp', 'message'),    'whatsapp'::app.interaction_surface,
  'superfície: (whatsapp, message) = whatsapp');
select is(app.interaction_surface('email', 'email'),         null::app.interaction_surface,
  'superfície: e-mail não é superfície de porta (NULL)');
select is(app.interaction_surface(null, 'note'),             null::app.interaction_surface,
  'superfície: nota não é superfície de porta (NULL)');
select is(app.interaction_surface(null, 'stage_change'),     null::app.interaction_surface,
  'superfície: mudança de etapa não é superfície de porta (NULL)');
select is(app.interaction_surface('other', 'system'),        null::app.interaction_surface,
  'superfície: evento de sistema não é superfície de porta (NULL)');
-- 'triagem' nasce reservado no enum para os motivos de descarte da §5.2 (D4).
select ok('triagem' = any (enum_range(null::app.interaction_surface)::text[]),
  'superfície: o valor triagem existe reservado no enum (motivos de descarte, D4)');
select set_eq(
  $$select unnest(enum_range(null::app.interaction_surface))::text$$,
  $$values ('whatsapp'::text), ('ligacao'), ('visita'), ('reuniao'), ('instagram_dm'), ('triagem')$$,
  'superfície: o enum tem exatamente as seis superfícies previstas');

-- =====================================================================
-- 4. Teto de 8 desfechos ativos por superfície (RF-FUN-12, risco 23)
-- =====================================================================
select is(
  (select count(*)::int from (
     select unnest(surfaces) as s from public.interaction_outcomes where is_active
   ) t group by s having count(*) > 8 limit 1),
  null, 'teto: nenhuma superfície passa de 8 desfechos ativos');
select results_eq(
  $$select s::text, count(*)::int from (
      select unnest(surfaces) as s from public.interaction_outcomes where is_active
    ) t group by s order by s::text$$,
  $$values ('instagram_dm'::text, 6), ('ligacao', 8), ('reuniao', 6), ('visita', 7), ('whatsapp', 7)$$,
  'teto: a lista da §3 distribui 34 chips em 5 superfícies, nenhuma acima de 8');
select is((select count(*)::int from public.interaction_outcomes where is_active), 34,
  'teto: a lista da §3 tem 34 desfechos ativos');
select is(
  (select count(*)::int from public.interaction_outcomes where length(trim(name)) > 28),
  0, 'teto: todo rótulo de chip cabe em 28 caracteres');
-- Lacuna consciente: o teto é norma de gestão, não constraint. O banco aceita o 9º chip.
select lives_ok(
  $$insert into public.interaction_outcomes (slug, name, surfaces, position) values
      ('tst_wa_oitavo', 'Oitavo do WhatsApp', array['whatsapp']::app.interaction_surface[], 80),
      ('tst_wa_nono',   'Nono do WhatsApp',   array['whatsapp']::app.interaction_surface[], 81)$$,
  'teto: o banco NÃO impede o 9º chip ativo (o teto é norma de gestão, RF-FUN-12)');
select is(
  (select count(*)::int from public.interaction_outcomes
    where is_active and 'whatsapp'::app.interaction_surface = any (surfaces)),
  9, 'teto: com os dois chips extras o WhatsApp fica com 9 ativos (lacuna registrada)');
delete from public.interaction_outcomes where slug in ('tst_wa_oitavo', 'tst_wa_nono');
select is(
  (select count(*)::int from public.interaction_outcomes
    where is_active and 'whatsapp'::app.interaction_surface = any (surfaces)),
  7, 'teto: removidos os extras, o WhatsApp volta aos 7 chips ativos');

-- =====================================================================
-- 5. Desfecho fora da superfície é recusado (spec §6, item 3)
-- =====================================================================
select throws_ok(
  format($$insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id)
             values ('call', 'phone', 'b0000000-0000-4000-8000-000000001001',
                     'a0000000-0000-4000-8000-000000001003', now(), %s)$$, pg_temp.desfecho('vis_decisor_interessado')),
  '23514', null, 'superfície: desfecho de visita numa ligação é recusado');
select throws_ok(
  format($$insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id)
             values ('message', 'whatsapp', 'b0000000-0000-4000-8000-000000001001',
                     'a0000000-0000-4000-8000-000000001003', now(), %s)$$, pg_temp.desfecho('vis_nao_estava')),
  '23514', null, 'superfície: desfecho de visita numa mensagem de WhatsApp é recusado');
select throws_ok(
  format($$insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id)
             values ('message', 'instagram', 'b0000000-0000-4000-8000-000000001001',
                     'a0000000-0000-4000-8000-000000001003', now(), %s)$$, pg_temp.desfecho('wa_respondeu')),
  '23514', null, 'superfície: desfecho de WhatsApp numa DM do Instagram é recusado');
select throws_ok(
  format($$insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id)
             values ('note', null, 'b0000000-0000-4000-8000-000000001001',
                     'a0000000-0000-4000-8000-000000001003', now(), %s)$$, pg_temp.desfecho('wa_respondeu')),
  '23514', null, 'superfície: nota não tem superfície, logo não aceita desfecho');
select throws_ok(
  $$insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id)
      values ('visit', 'presencial', 'b0000000-0000-4000-8000-000000001001',
              'a0000000-0000-4000-8000-000000001003', now(), 999999)$$,
  '23503', null, 'superfície: desfecho inexistente é recusado');
select lives_ok(
  format($$insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id, metadata)
             values ('visit', 'presencial', 'b0000000-0000-4000-8000-000000001001',
                     'a0000000-0000-4000-8000-000000001003', now(), %s, '{"rotulo":"visita_ok"}')$$,
         pg_temp.desfecho('vis_nao_estava')),
  'superfície: desfecho de visita numa visita é aceito');
select lives_ok(
  format($$insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id, metadata)
             values ('meeting', 'presencial', 'b0000000-0000-4000-8000-000000001001',
                     'a0000000-0000-4000-8000-000000001003', now(), %s, '{"rotulo":"reuniao_ok"}')$$,
         pg_temp.desfecho('reu_no_show')),
  'superfície: desfecho de reunião numa reunião é aceito');

-- Desfecho inativo: recusado em atividade nova, legível nas antigas (spec §6, item 8)
insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id, metadata)
  values ('call', 'phone', 'b0000000-0000-4000-8000-000000001001', 'a0000000-0000-4000-8000-000000001003',
          now() - interval '5 days', pg_temp.desfecho('lig_caixa_postal'), '{"rotulo":"antes_de_aposentar"}');
update public.interaction_outcomes set is_active = false where slug = 'lig_caixa_postal';
select throws_ok(
  format($$insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id)
             values ('call', 'phone', 'b0000000-0000-4000-8000-000000001001',
                     'a0000000-0000-4000-8000-000000001003', now(), %s)$$, pg_temp.desfecho('lig_caixa_postal')),
  '23503', null, 'aposentadoria: desfecho inativo é recusado em atividade nova');
select is(
  (select o.name from public.activities a join public.interaction_outcomes o on o.id = a.outcome_id
    where a.metadata ->> 'rotulo' = 'antes_de_aposentar'),
  'Caixa postal', 'aposentadoria: a atividade antiga continua legível com o nome do chip aposentado');
select is(pg_temp.meta('antes_de_aposentar') ->> 'outcome_slug', 'lig_caixa_postal',
  'aposentadoria: o slug gravado em metadata sobrevive à aposentadoria do chip');
update public.interaction_outcomes set is_active = true where slug = 'lig_caixa_postal';

-- =====================================================================
-- 6. outcome_pending: o banco não trava a captura em campo (spec §6, item 3)
-- =====================================================================
insert into public.activities (id, type, channel, organization_id, user_id, occurred_at, metadata) values
  ('e0000000-0000-4000-8000-000000001001', 'call',    'phone',      'b0000000-0000-4000-8000-000000001001', 'a0000000-0000-4000-8000-000000001003', now(), '{"rotulo":"pend_call"}'),
  ('e0000000-0000-4000-8000-000000001002', 'visit',   'presencial', 'b0000000-0000-4000-8000-000000001001', 'a0000000-0000-4000-8000-000000001003', now(), '{"rotulo":"pend_visit"}'),
  ('e0000000-0000-4000-8000-000000001003', 'meeting', 'presencial', 'b0000000-0000-4000-8000-000000001001', 'a0000000-0000-4000-8000-000000001003', now(), '{"rotulo":"pend_meeting"}'),
  ('e0000000-0000-4000-8000-000000001004', 'message', 'whatsapp',   'b0000000-0000-4000-8000-000000001001', 'a0000000-0000-4000-8000-000000001003', now(), '{"rotulo":"pend_msg"}'),
  ('e0000000-0000-4000-8000-000000001005', 'note',    null,         'b0000000-0000-4000-8000-000000001001', 'a0000000-0000-4000-8000-000000001003', now(), '{"rotulo":"pend_note"}');
insert into public.activities (id, type, channel, organization_id, user_id, author_kind, occurred_at, metadata) values
  ('e0000000-0000-4000-8000-000000001006', 'message', 'whatsapp', 'b0000000-0000-4000-8000-000000001001', null, 'bot_ai', now(), '{"rotulo":"pend_bot"}');
select is(pg_temp.meta('pend_call') ->> 'outcome_pending', 'true',
  'pendência: ligação sem desfecho é ACEITA e nasce com outcome_pending (RF-MET-04, critério 3)');
select is(pg_temp.meta('pend_visit') ->> 'outcome_pending', 'true',
  'pendência: visita sem desfecho é aceita e nasce com outcome_pending');
select is(pg_temp.meta('pend_meeting') ->> 'outcome_pending', 'true',
  'pendência: reunião sem desfecho é aceita e nasce com outcome_pending');
select ok(not (pg_temp.meta('pend_msg') ? 'outcome_pending'),
  'pendência: mensagem humana sem desfecho passa sem a marca (o worker do D5 grava sem chip)');
select ok(not (pg_temp.meta('pend_bot') ? 'outcome_pending'),
  'pendência: mensagem de robô sem desfecho passa sem a marca');
select ok(not (pg_temp.meta('pend_note') ? 'outcome_pending'),
  'pendência: nota sem desfecho passa sem a marca');
-- Gravar o desfecho depois apaga a marca.
update public.activities set outcome_id = pg_temp.desfecho('lig_nao_atendeu')
  where id = 'e0000000-0000-4000-8000-000000001001';
select ok(not (pg_temp.meta('pend_call') ? 'outcome_pending'),
  'pendência: gravar o desfecho depois apaga a marca outcome_pending');
select is(pg_temp.meta('pend_call') ->> 'outcome_slug', 'lig_nao_atendeu',
  'pendência: gravar o desfecho depois grava o slug em metadata');
-- Retirar o desfecho num UPDATE devolve a pendência e limpa a contagem de porta.
update public.activities set outcome_id = null where id = 'e0000000-0000-4000-8000-000000001001';
select is(pg_temp.meta('pend_call') ->> 'outcome_pending', 'true',
  'pendência: retirar o desfecho devolve a marca outcome_pending');
select ok(not (pg_temp.meta('pend_call') ? 'door_knocked') and not (pg_temp.meta('pend_call') ? 'cooldown_until'),
  'pendência: retirar o desfecho limpa door_knocked e cooldown_until (a métrica não conta porta sem desfecho)');

-- =====================================================================
-- 7. Porta batida e porta aberta (RF-MET-01; spec §6, item 4)
-- =====================================================================
insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id, metadata) values
  ('visit', 'presencial', 'b0000000-0000-4000-8000-000000001010', 'a0000000-0000-4000-8000-000000001003',
     now(), pg_temp.desfecho('vis_decisor_interessado'), '{"rotulo":"porta_funcionario","com_quem":"funcionario"}'),
  ('visit', 'presencial', 'b0000000-0000-4000-8000-000000001010', 'a0000000-0000-4000-8000-000000001003',
     now(), pg_temp.desfecho('vis_decisor_interessado'), '{"rotulo":"porta_decisor","com_quem":"decisor"}'),
  ('visit', 'presencial', 'b0000000-0000-4000-8000-000000001010', 'a0000000-0000-4000-8000-000000001003',
     now(), pg_temp.desfecho('vis_decisor_interessado'), '{"rotulo":"porta_influenciador","com_quem":"influenciador"}'),
  ('visit', 'presencial', 'b0000000-0000-4000-8000-000000001010', 'a0000000-0000-4000-8000-000000001003',
     now(), pg_temp.desfecho('vis_decisor_interessado'), '{"rotulo":"porta_sem_quem"}'),
  ('visit', 'presencial', 'b0000000-0000-4000-8000-000000001010', 'a0000000-0000-4000-8000-000000001003',
     now(), pg_temp.desfecho('vis_nao_estava'), '{"rotulo":"porta_batida_decisor","com_quem":"decisor"}'),
  ('message', 'whatsapp', 'b0000000-0000-4000-8000-000000001010', 'a0000000-0000-4000-8000-000000001003',
     now(), pg_temp.desfecho('wa_numero_invalido'), '{"rotulo":"porta_nenhuma","com_quem":"decisor"}');
select is(pg_temp.meta('porta_funcionario') ->> 'door_opened', 'false',
  'porta: counts_as aberta com "com_quem" = funcionario NÃO grava porta aberta');
select is(pg_temp.meta('porta_funcionario') ->> 'door_knocked', 'true',
  'porta: counts_as aberta com funcionario ainda grava porta batida');
select is(pg_temp.meta('porta_decisor') ->> 'door_opened', 'true',
  'porta: counts_as aberta com decisor grava porta aberta (RF-MET-06, "com quem falou")');
select is(pg_temp.meta('porta_influenciador') ->> 'door_opened', 'true',
  'porta: counts_as aberta com influenciador grava porta aberta');
select is(pg_temp.meta('porta_sem_quem') ->> 'door_opened', 'false',
  'porta: counts_as aberta sem "com_quem" não grava porta aberta (porta é teto, não veredito)');
select is(pg_temp.meta('porta_batida_decisor') ->> 'door_opened', 'false',
  'porta: counts_as batida não vira porta aberta nem falando com decisor');
select is(pg_temp.meta('porta_batida_decisor') ->> 'door_knocked', 'true',
  'porta: counts_as batida grava porta batida');
select is(pg_temp.meta('porta_nenhuma') ->> 'door_knocked', 'false',
  'porta: counts_as nenhuma não conta nem porta batida (número inválido é erro de cadastro)');
select is(pg_temp.meta('porta_nenhuma') ->> 'door_opened', 'false',
  'porta: counts_as nenhuma não conta porta aberta');
select is(
  (select count(*)::int from public.activities
    where organization_id = 'b0000000-0000-4000-8000-000000001010' and metadata ->> 'door_opened' = 'true'),
  2, 'porta: a métrica lê metadata.door_opened, e só duas das seis linhas contam');
-- LACUNA (RF-MET-01): "máximo 1 porta aberta por alvo a cada 30 dias" não existe no banco.
-- O teste fixa o comportamento de hoje para que a regra, quando chegar, quebre aqui.
insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id, metadata) values
  ('visit', 'presencial', 'b0000000-0000-4000-8000-000000001010', 'a0000000-0000-4000-8000-000000001003',
     now() - interval '10 days', pg_temp.desfecho('vis_decisor_interessado'), '{"rotulo":"porta_30d_a","com_quem":"decisor"}'),
  ('visit', 'presencial', 'b0000000-0000-4000-8000-000000001010', 'a0000000-0000-4000-8000-000000001003',
     now() - interval '1 day',  pg_temp.desfecho('vis_decisor_interessado'), '{"rotulo":"porta_30d_b","com_quem":"decisor"}');
select is(
  (select count(*)::int from public.activities
    where organization_id = 'b0000000-0000-4000-8000-000000001010'
      and metadata ->> 'door_opened' = 'true'
      and occurred_at > now() - interval '30 days'),
  4, 'porta: LACUNA — o banco grava 4 portas abertas no mesmo alvo em 30 dias; o teto de 1 (RF-MET-01) ainda não está no banco');

-- =====================================================================
-- 8. Data de espera de recontato em metadata (RF-FUN-13; spec §6, item 5)
-- =====================================================================
insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id, metadata) values
  ('message', 'whatsapp', 'b0000000-0000-4000-8000-000000001001', 'a0000000-0000-4000-8000-000000001003',
     timestamptz '2026-09-01 10:00:00-03', pg_temp.desfecho('wa_agora_nao'), '{"rotulo":"cd_30"}'),
  ('call', 'phone', 'b0000000-0000-4000-8000-000000001001', 'a0000000-0000-4000-8000-000000001003',
     timestamptz '2026-09-01 10:00:00-03', pg_temp.desfecho('lig_nao_atendeu'), '{"rotulo":"cd_1"}'),
  ('message', 'whatsapp', 'b0000000-0000-4000-8000-000000001001', 'a0000000-0000-4000-8000-000000001003',
     timestamptz '2026-09-01 10:00:00-03', pg_temp.desfecho('wa_respondeu'), '{"rotulo":"cd_0"}'),
  ('message', 'whatsapp', 'b0000000-0000-4000-8000-000000001001', 'a0000000-0000-4000-8000-000000001003',
     timestamptz '2026-09-01 10:00:00-03', pg_temp.desfecho('wa_optout'), '{"rotulo":"cd_permanente"}');
select is((pg_temp.meta('cd_30') ->> 'cooldown_until')::timestamptz, timestamptz '2026-10-01 10:00:00-03',
  'espera: "Agora não" grava occurred_at + 30 dias');
select is((pg_temp.meta('cd_1') ->> 'cooldown_until')::timestamptz, timestamptz '2026-09-02 10:00:00-03',
  'espera: "Não atendeu" grava occurred_at + 1 dia');
select is((pg_temp.meta('cd_0') ->> 'cooldown_until')::timestamptz, timestamptz '2026-09-01 10:00:00-03',
  'espera: cooldown 0 grava a própria data da interação (sem espera)');
select is((pg_temp.meta('cd_permanente') ->> 'cooldown_until')::timestamptz,
  timestamptz '2026-09-01 10:00:00-03' + interval '36500 days',
  'espera: opt-out grava espera permanente (36500 dias, RF-CON-18)');
-- Texto normalizado em UTC: o jsonb guarda o TEXTO do timestamptz, que mudaria com o
-- TimeZone da sessão que gravou (worker em UTC, app em America/Fortaleza). Normalizado,
-- a chave é comparável e ordenável como texto.
select is(pg_temp.meta('cd_30') ->> 'cooldown_until', '2026-10-01T13:00:00.000000Z',
  'espera: cooldown_until é gravado em UTC, ISO 8601, independente do TimeZone da sessão');

-- =====================================================================
-- 9. View v_contact_cooldown (RF-FUN-13; spec §6, itens 5, 6 e 10)
-- =====================================================================
select has_view('public', 'v_contact_cooldown', 'view: public.v_contact_cooldown existe');
select ok(
  (select reloptions from pg_class where oid = 'public.v_contact_cooldown'::regclass) @> array['security_invoker=true'],
  'view: declarada com security_invoker = true (a RLS de activities filtra as linhas, RF-ADM-01)');
select ok(
  (select reloptions from pg_class where oid = 'public.v_contact_cooldown'::regclass) @> array['security_barrier=true'],
  'view: declarada com security_barrier = true');

-- Janela da ÚLTIMA atividade, não o máximo do histórico.
insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id) values
  ('message', 'whatsapp', 'b0000000-0000-4000-8000-000000001002', 'a0000000-0000-4000-8000-000000001003',
     now() - interval '1 day', pg_temp.desfecho('wa_agora_nao')),
  ('message', 'whatsapp', 'b0000000-0000-4000-8000-000000001002', 'a0000000-0000-4000-8000-000000001003',
     now() - interval '1 hour', pg_temp.desfecho('wa_respondeu'));
select is(
  (select cooldown_until from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001002'),
  now() - interval '1 hour',
  'view: a janela é a da ÚLTIMA atividade com desfecho ("Agora não" de 30 dias não sobrevive à resposta)');
select ok(
  (select cooldown_until from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001002') <= now(),
  'view: com a resposta recente a janela está vencida (o alvo volta a ser elegível à fila)');
select is(
  (select blocked_forever from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001002'),
  false, 'view: sem desfecho bloqueante, blocked_forever é falso');

-- Janela ainda aberta.
insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id) values
  ('call', 'phone', 'b0000000-0000-4000-8000-000000001003', 'a0000000-0000-4000-8000-000000001003',
     now(), pg_temp.desfecho('lig_nao_atendeu'));
select ok(
  (select cooldown_until from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001003') > now(),
  'view: "Não atendeu" mantém o alvo em janela de silêncio por 1 dia (a fila do RF-CON-08 exclui)');
select is(
  (select count(*)::int from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001007'),
  0, 'view: organização sem atividade com desfecho não aparece na view');

-- Bloqueio grudento: opt-out não cai por resposta posterior.
insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id) values
  ('message', 'whatsapp', 'b0000000-0000-4000-8000-000000001004', 'a0000000-0000-4000-8000-000000001003',
     now() - interval '2 days', pg_temp.desfecho('wa_optout'));
select is(
  (select blocked_forever from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001004'),
  true, 'view: desfecho com can_reactivate = false marca blocked_forever');
insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id) values
  ('message', 'whatsapp', 'b0000000-0000-4000-8000-000000001004', 'a0000000-0000-4000-8000-000000001003',
     now(), pg_temp.desfecho('wa_respondeu'));
select is(
  (select blocked_forever from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001004'),
  true, 'view: desfecho reativável posterior NÃO derruba o bloqueio (o worker do WhatsApp não desfaz opt-out)');
select is(
  (select cooldown_until from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001004'),
  now(), 'view: a janela, essa sim, passa a ser a da última atividade');

-- Saída do bloqueio: reabertura humana registrada, saindo de etapa de perda que não é opt-out.
insert into public.activities (type, channel, organization_id, deal_id, user_id, occurred_at, outcome_id) values
  ('visit', 'presencial', 'b0000000-0000-4000-8000-000000001005', 'd0000000-0000-4000-8000-000000001005',
     'a0000000-0000-4000-8000-000000001003', now() - interval '100 days', pg_temp.desfecho('vis_decisor_recusou'));
select is(
  (select blocked_forever from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001005'),
  true, 'view: "Decisor recusou" (can_reactivate = false) bloqueia o alvo');
select pg_temp.entrar('a0000000-0000-4000-8000-000000001002', 'gestor');
update public.deals
   set stage_id = pg_temp.etapa('fornecedor', 'perdido'),
       lost_reason_id = pg_temp.motivo('nao_aceita_comissao'),
       stage_change_reason = 'decisor recusou na visita'
 where id = 'd0000000-0000-4000-8000-000000001005';
update public.deals
   set stage_id = pg_temp.etapa('fornecedor', 'prospectado'),
       stage_change_reason = 'reabertura combinada com o Rafael'
 where id = 'd0000000-0000-4000-8000-000000001005';
select pg_temp.sair();
select is(
  (select blocked_forever from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001005'),
  false, 'view: reabertura humana registrada (motivo + autor, saindo de perda) derruba o bloqueio (RF-FUN-08, §5.3)');
select ok(
  (select cooldown_until from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001005') <= now(),
  'view: derrubado o bloqueio, a janela de 90 dias do desfecho já venceu (a atividade tem 100 dias)');

-- Opt-out não tem saída (RF-CON-18).
insert into public.activities (type, channel, organization_id, deal_id, user_id, occurred_at, outcome_id) values
  ('message', 'whatsapp', 'b0000000-0000-4000-8000-000000001006', 'd0000000-0000-4000-8000-000000001006',
     'a0000000-0000-4000-8000-000000001003', now() - interval '100 days', pg_temp.desfecho('wa_optout'));
select pg_temp.entrar('a0000000-0000-4000-8000-000000001002', 'gestor');
update public.deals
   set stage_id = pg_temp.etapa('fornecedor', 'optout'), stage_change_reason = 'pediu para parar'
 where id = 'd0000000-0000-4000-8000-000000001006';
update public.deals
   set stage_id = pg_temp.etapa('fornecedor', 'prospectado'), stage_change_reason = 'tentativa de reabrir opt-out'
 where id = 'd0000000-0000-4000-8000-000000001006';
select pg_temp.sair();
select is(
  (select blocked_forever from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001006'),
  true, 'view: sair da etapa de opt-out NÃO reabre o bloqueio (RF-CON-18)');

-- Carteira: a view respeita a RLS de activities (spec §6, item 10).
insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id) values
  ('visit', 'presencial', 'b0000000-0000-4000-8000-000000001007', 'a0000000-0000-4000-8000-000000001004',
     now(), pg_temp.desfecho('vis_nao_estava'));
select pg_temp.entrar('a0000000-0000-4000-8000-000000001004', 'embaixador');
select results_eq(
  $$select organization_id from public.v_contact_cooldown
     where organization_id in ('b0000000-0000-4000-8000-000000001002','b0000000-0000-4000-8000-000000001003',
                               'b0000000-0000-4000-8000-000000001007')$$,
  $$values ('b0000000-0000-4000-8000-000000001007'::uuid)$$,
  'view: o embaixador só enxerga a organização da própria carteira (RF-ADM-01)');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000001002', 'gestor');
select is(
  (select count(*)::int from public.v_contact_cooldown
    where organization_id in ('b0000000-0000-4000-8000-000000001002','b0000000-0000-4000-8000-000000001003',
                              'b0000000-0000-4000-8000-000000001007')),
  3, 'view: o gestor enxerga a base inteira');
select pg_temp.sair();
-- Contraprova: sem security_invoker o embaixador passaria a ler linha alheia.
alter view public.v_contact_cooldown reset (security_invoker);
select pg_temp.entrar('a0000000-0000-4000-8000-000000001004', 'embaixador');
select is(
  (select count(*)::int from public.v_contact_cooldown
    where organization_id in ('b0000000-0000-4000-8000-000000001002','b0000000-0000-4000-8000-000000001003',
                              'b0000000-0000-4000-8000-000000001007')),
  3, 'view: CONTRAPROVA — sem security_invoker o embaixador leria a carteira alheia');
select pg_temp.sair();
alter view public.v_contact_cooldown set (security_invoker = true);
select pg_temp.entrar('a0000000-0000-4000-8000-000000001004', 'embaixador');
select is(
  (select count(*)::int from public.v_contact_cooldown
    where organization_id in ('b0000000-0000-4000-8000-000000001002','b0000000-0000-4000-8000-000000001003',
                              'b0000000-0000-4000-8000-000000001007')),
  1, 'view: reposto o security_invoker, o embaixador volta a ver só a própria carteira');
select pg_temp.sair();

-- Número morto NÃO é bloqueio: "Número inválido" e "Número errado" têm
-- can_reactivate = false (ficam fora da reativação do RF-CON-15), mas não levam o
-- negócio a etapa de perda, então não entram na CTE de bloqueio. Quem segura o alvo
-- é a janela de 36500 dias, e ela cai no primeiro toque por outro canal, que é a
-- própria próxima ação do chip. Sem isso, um telefone errado prendia a organização
-- inteira, em todos os canais, para sempre.
insert into public.activities (type, channel, organization_id, deal_id, user_id, occurred_at, outcome_id) values
  ('message', 'whatsapp', 'b0000000-0000-4000-8000-000000001011', 'd0000000-0000-4000-8000-000000001011',
     'a0000000-0000-4000-8000-000000001003', now() - interval '10 days', pg_temp.desfecho('wa_numero_invalido'));
select is(
  (select blocked_forever from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001011'),
  false, 'view: "Número inválido" NÃO bloqueia a organização (a próxima ação do chip é buscar outro canal)');
select ok(
  (select cooldown_until from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001011') > now(),
  'view: "Número inválido" segura o alvo por janela permanente, não por bloqueio (RF-CON-10, risco 2)');

-- Organização SEM negócio: a saída do bloqueio passa por deals, então um alvo do Radar
-- ainda fora do funil não teria saída alguma se este desfecho bloqueasse.
insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id) values
  ('call', 'phone', 'b0000000-0000-4000-8000-000000001012', 'a0000000-0000-4000-8000-000000001003',
     now() - interval '3 days', pg_temp.desfecho('lig_numero_errado'));
select is(
  (select blocked_forever from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001012'),
  false, 'view: "Número errado" em organização SEM negócio não bloqueia (o lead do Radar não fica sem saída)');
select ok(
  (select cooldown_until from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001012') > now(),
  'view: "Número errado" também segura o alvo pela janela permanente');

-- O outro canal derruba a janela sem precisar de mudança de etapa nenhuma.
insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id) values
  ('message', 'whatsapp',  'b0000000-0000-4000-8000-000000001013', 'a0000000-0000-4000-8000-000000001003',
     now() - interval '2 days', pg_temp.desfecho('wa_numero_invalido')),
  ('message', 'instagram', 'b0000000-0000-4000-8000-000000001013', 'a0000000-0000-4000-8000-000000001003',
     now() - interval '1 hour', pg_temp.desfecho('dm_respondeu'));
select ok(
  (select cooldown_until from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001013') <= now(),
  'view: um toque posterior em outra superfície vence a janela do número morto (sem mudança de etapa)');
select is(
  (select blocked_forever from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001013'),
  false, 'view: e o alvo volta a ser elegível à fila das 06:00 (RF-CON-08)');

-- Desfecho gravado só com deal_id (o worker de WhatsApp do D5 grava assim): a view
-- resolve a organização pelo negócio, senão um opt-out ficaria invisível para a fila.
insert into public.activities (type, channel, organization_id, deal_id, user_id, occurred_at, outcome_id) values
  ('message', 'whatsapp', null, 'd0000000-0000-4000-8000-000000001014',
     'a0000000-0000-4000-8000-000000001003', now() - interval '1 day', pg_temp.desfecho('wa_optout'));
select is(
  (select count(*)::int from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001014'),
  1, 'view: atividade sem organization_id entra na view pela organização do negócio');
select is(
  (select blocked_forever from public.v_contact_cooldown where organization_id = 'b0000000-0000-4000-8000-000000001014'),
  true, 'view: opt-out gravado só com deal_id bloqueia igual (RF-CON-18)');

-- Guardrail do catálogo: quem bloqueia é quem manda o negócio para a perda. Um chip
-- futuro do gestor com can_reactivate = false e etapa que não é de perda recriaria a
-- armadilha; um sem etapa de perda precisa da janela permanente para não voltar à fila.
select is(
  (select count(*)::int from public.interaction_outcomes o
    where not o.can_reactivate and o.target_stage_slug is not null
      and not exists (select 1 from public.stages s where s.slug = o.target_stage_slug and s.is_lost)),
  0, 'catálogo: todo desfecho não reativável com etapa de destino aponta para etapa de perda');
select is(
  (select count(*)::int from public.interaction_outcomes o
    where not o.can_reactivate
      and exists (select 1 from public.stages s where s.slug = o.target_stage_slug and s.is_lost)),
  8, 'catálogo: 8 desfechos da §3 bloqueiam de fato (os que levam o negócio à perda ou ao opt-out)');
select is(
  (select count(*)::int from public.interaction_outcomes o
    where not o.can_reactivate and o.cooldown_days < 36500
      and not exists (select 1 from public.stages s where s.slug = o.target_stage_slug and s.is_lost)),
  0, 'catálogo: desfecho não reativável que não bloqueia tem janela permanente (não volta à fila na manhã seguinte)');

-- =====================================================================
-- 10. Efeito em etapa, temperatura e próxima ação (RF-FUN-12, RF-FUN-03)
-- =====================================================================
-- O catálogo declara o destino, e o destino existe no funil de fornecedor.
select is(
  (select count(*)::int from public.interaction_outcomes o
    where o.target_stage_slug is not null
      and not exists (select 1 from public.stages s join public.pipelines p on p.id = s.pipeline_id
                       where p.slug = 'fornecedor' and s.slug = o.target_stage_slug)),
  0, 'etapa: todo target_stage_slug do catálogo corresponde a uma etapa do funil fornecedor');
select is((select target_stage_slug from public.interaction_outcomes where slug = 'lig_reuniao_marcada'),
  'reuniao_marcada', 'etapa: "Reunião marcada" aponta para a etapa reuniao_marcada');
select is((select target_stage_slug from public.interaction_outcomes where slug = 'vis_cadastro_iniciado'),
  'cadastro_em_andamento', 'etapa: "Cadastro iniciado na hora" aponta para cadastro_em_andamento');
select is((select target_stage_slug from public.interaction_outcomes where slug = 'wa_respondeu'),
  'respondeu', 'etapa: "Respondeu" aponta para a etapa respondeu');
select is((select target_stage_slug from public.interaction_outcomes where slug = 'wa_optout'),
  'optout', 'etapa: "Pediu para parar" aponta para a etapa optout');
select is((select sets_temperature from public.interaction_outcomes where slug = 'lig_interessado'),
  'quente'::app.temperature, 'temperatura: "Interessado" declara temperatura quente');
select is((select sets_temperature from public.interaction_outcomes where slug = 'wa_agora_nao'),
  'frio'::app.temperature, 'temperatura: "Agora não" declara temperatura fria (nutrição)');
select is((select count(*)::int from public.interaction_outcomes where target_stage_slug is null), 12,
  'etapa: 12 desfechos da §3 mantêm a etapa do negócio');
select is((select next_action_kind from public.interaction_outcomes where slug = 'vis_nao_estava'),
  'visit'::app.task_kind, 'próxima ação: "Não estava" propõe nova visita');
select is((select next_action_offset_days from public.interaction_outcomes where slug = 'vis_nao_estava'), 7,
  'próxima ação: "Não estava" propõe D+7 (próxima passagem da zona)');
select is((select next_action_offset_days from public.interaction_outcomes where slug = 'lig_atendeu_retorna'), null,
  'próxima ação: "Atendeu, retorna depois" deixa a data nula (vale a data combinada / a temperatura)');

-- LACUNA (RF-FUN-12): a migração 000800 guarda target_stage_slug, sets_temperature e
-- next_action_* como DADO, mas nada no banco os aplica. Gravar o desfecho não move o
-- negócio, não muda a temperatura e não cria tarefa. Os testes abaixo fixam isso.
insert into public.activities (type, channel, organization_id, deal_id, user_id, occurred_at, outcome_id, metadata)
  values ('call', 'phone', 'b0000000-0000-4000-8000-000000001008', 'd0000000-0000-4000-8000-000000001008',
          'a0000000-0000-4000-8000-000000001003', now(), pg_temp.desfecho('lig_reuniao_marcada'),
          '{"rotulo":"etapa_destino","com_quem":"decisor"}');
select is(
  (select s.slug from public.deals d join public.stages s on s.id = d.stage_id
    where d.id = 'd0000000-0000-4000-8000-000000001008'),
  'contatado',
  'etapa: LACUNA — o desfecho "Reunião marcada" NÃO move o negócio para reuniao_marcada (nada no banco aplica target_stage_slug)');
select is(
  (select count(*)::int from public.tasks where deal_id = 'd0000000-0000-4000-8000-000000001008'),
  0, 'próxima ação: LACUNA — o desfecho não cria a tarefa de next_action_kind (RF-FUN-03 fica com a UI)');
select is(pg_temp.meta('etapa_destino') ->> 'door_opened', 'true',
  'etapa: o que o desfecho de fato grava hoje é a porta em metadata');

-- =====================================================================
-- 11. Motivo de perda (RF-FUN-04; spec §6, item 7)
-- =====================================================================
select is((select count(*)::int from public.interaction_outcomes where requires_lost_reason), 6,
  'perda: 6 desfechos da §3 exigem motivo de perda');
select is(
  (select count(*)::int from public.interaction_outcomes where requires_lost_reason and target_stage_slug is null),
  0, 'perda: todo desfecho que exige motivo declara a etapa de destino (constraint da migração)');
select is(
  (select count(*)::int from public.interaction_outcomes where requires_lost_reason and target_stage_slug <> 'perdido'),
  0, 'perda: os seis apontam para a etapa perdido');
select is(
  (select count(*)::int from public.interaction_outcomes where target_stage_slug = 'optout' and requires_lost_reason),
  0, 'perda: os dois desfechos de opt-out NÃO exigem motivo (opt-out é perda por regra, §5.3)');

-- A recusa de hoje acontece na mudança de etapa, não na gravação da atividade.
select pg_temp.entrar('a0000000-0000-4000-8000-000000001002', 'gestor');
select throws_ok(
  $$update public.deals set stage_id = pg_temp.etapa('fornecedor','perdido'),
       stage_change_reason = 'sem interesse' where id = 'd0000000-0000-4000-8000-000000001009'$$,
  '23514', null, 'perda: mover para "perdido" sem motivo é recusado (RF-FUN-04)');
select lives_ok(
  $$update public.deals set stage_id = pg_temp.etapa('fornecedor','perdido'),
       lost_reason_id = pg_temp.motivo('nao_aceita_comissao'),
       stage_change_reason = 'sem interesse' where id = 'd0000000-0000-4000-8000-000000001009'$$,
  'perda: mover para "perdido" com motivo da lista fechada é aceito');
select is(
  (select status::text from public.deals where id = 'd0000000-0000-4000-8000-000000001009'),
  'lost', 'perda: o negócio fica com status lost');
select pg_temp.sair();
-- LACUNA: gravar um desfecho com requires_lost_reason num negócio SEM motivo não é recusado.
select lives_ok(
  $$insert into public.activities (type, channel, organization_id, deal_id, user_id, occurred_at, outcome_id, metadata)
      values ('call', 'phone', 'b0000000-0000-4000-8000-000000001008', 'd0000000-0000-4000-8000-000000001008',
              'a0000000-0000-4000-8000-000000001003', now(),
              (select id from public.interaction_outcomes where slug = 'lig_sem_interesse'),
              '{"rotulo":"perda_sem_motivo"}')$$,
  'perda: LACUNA — o desfecho "Sem interesse" é aceito num negócio sem lost_reason_id (nada liga o catálogo a app.deals_before_write)');
select is(
  (select d.lost_reason_id from public.deals d where d.id = 'd0000000-0000-4000-8000-000000001008'),
  null, 'perda: LACUNA — e o negócio segue sem motivo de perda depois do desfecho');

-- =====================================================================
-- 12. Seed do catálogo (spec §6, item 9)
-- =====================================================================
select is((select count(*)::int from public.interaction_outcomes), 34,
  'seed: o catálogo tem exatamente os 34 desfechos da §3');
select set_eq(
  $$select slug from public.interaction_outcomes$$,
  $$values ('wa_sem_resposta'::text),('wa_respondeu'),('wa_nao_e_a_pessoa'),('wa_agora_nao'),('wa_nao_firme'),
           ('wa_numero_invalido'),('wa_optout'),('lig_nao_atendeu'),('lig_caixa_postal'),('lig_numero_errado'),
           ('lig_atendeu_retorna'),('lig_interessado'),('lig_agora_nao'),('lig_sem_interesse'),('lig_reuniao_marcada'),
           ('vis_nao_estava'),('vis_funcionario'),('vis_decisor_interessado'),('vis_decisor_agora_nao'),
           ('vis_decisor_recusou'),('vis_cadastro_iniciado'),('vis_sem_perfil'),('reu_interessado'),('reu_autorizou'),
           ('reu_objecao'),('reu_nao'),('reu_no_show'),('reu_reagendada'),('dm_sem_resposta'),('dm_respondeu'),
           ('dm_pediu_whatsapp'),('dm_nao_e_a_pessoa'),('dm_perfil_inativo'),('dm_optout')$$,
  'seed: os 34 slugs da §3 estão semeados, sem sobra nem falta');
select is((select count(*)::int from public.interaction_outcomes where not is_active), 0,
  'seed: todo desfecho semeado nasce ativo');
select is(
  (select count(*)::int from public.interaction_outcomes
    where surfaces && array['triagem']::app.interaction_surface[]),
  0, 'seed: nenhum desfecho de triagem é semeado agora (a caixa de triagem é do D4, §5.2)');

-- =====================================================================
-- 13. Privilégios (guardrails da migração 000500 e da 000800)
-- =====================================================================
select ok(not has_table_privilege('anon', 'public.interaction_outcomes', 'select'),
  'privilégios: anon não lê o catálogo');
select ok(not has_table_privilege('anon', 'public.interaction_outcomes', 'insert'),
  'privilégios: anon não escreve no catálogo');
select ok(not has_table_privilege('anon', 'public.v_contact_cooldown', 'select'),
  'privilégios: anon não lê a view de janela de recontato');
select ok(has_table_privilege('authenticated', 'public.interaction_outcomes', 'select'),
  'privilégios: authenticated lê o catálogo (a RLS decide as linhas)');
select ok(has_table_privilege('authenticated', 'public.v_contact_cooldown', 'select'),
  'privilégios: authenticated lê a view de janela de recontato');
select ok(not has_sequence_privilege('anon', 'public.interaction_outcomes_id_seq', 'usage'),
  'privilégios: anon não usa a sequência do catálogo');
select ok(has_function_privilege('authenticated', 'app.interaction_surface(app.channel, app.activity_type)', 'execute'),
  'privilégios: authenticated executa app.interaction_surface (o gatilho a chama como invocador)');
select ok(not has_function_privilege('anon', 'app.interaction_surface(app.channel, app.activity_type)', 'execute'),
  'privilégios: anon não executa app.interaction_surface');
select ok(not has_function_privilege('authenticated', 'app.activities_apply_outcome()', 'execute'),
  'privilégios: a função de gatilho app.activities_apply_outcome não é superfície de API');
select ok(not has_function_privilege('anon', 'app.activities_apply_outcome()', 'execute'),
  'privilégios: anon não executa app.activities_apply_outcome');

select * from finish();
rollback;

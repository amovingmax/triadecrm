-- =====================================================================
-- pgTAP — A evidência da autorização, do "autorizo" ao link de cadastro,
-- nos DOIS funis (laudo §3.1), os campos obrigatórios da etapa dentro do
-- gatilho (§3.9) e o rótulo em português de gente (§3.12i).
--
-- Migração 20260905000800 + catálogo da seed.
--
-- O defeito que este arquivo trava: a etapa "Autorizou" (funil fornecedor)
-- declarava `authorization_evidence` com `consent_kind`, e a etapa "Parceria
-- aceita" (funil produtor, para onde `app.stage_for` resolve o desfecho
-- "Realizada, autorizou") declarava lista vazia. A frase literal que a tela
-- EXIGE era descartada em silêncio, e o pré-cadastro recusava depois com
-- `sem_autorizacao` sem dizer que a prova nunca existiu.
--
-- Roda em transação e desfaz tudo. Toda contagem é DELTA: o banco tem operação
-- dentro e nada aqui depende de número absoluto de tabela compartilhada.
-- =====================================================================
begin;
select plan(26);

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
create function pg_temp.etapa_de(p_deal uuid) returns text language sql as $$
  select s.slug from public.deals d join public.stages s on s.id = d.stage_id where d.id = p_deal
$$;
-- DELTA de consent_events da organização: contagem antes, guardada, e diferença.
create function pg_temp.n_consent(p_org uuid) returns int language sql as $$
  select count(*)::int from public.consent_events
   where organization_id = p_org and kind = 'data_use_authorized'::app.consent_kind
$$;

-- ---------- pessoa ----------
insert into public.allowed_users (email, role, note) values
  ('ev.admin@teste.local', 'admin', 'pgTAP evidência da autorização');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000003101', 'ev.admin@teste.local', '{"full_name":"Admin Evidência"}');

-- ---------- parceiros ----------
--   31 produtor  → a cerimonialista da §3.1
--   32 fornecedor→ o controle, no funil que já funcionava
--   33 produtor  → "Cadastro iniciado na hora", que não colhe frase nenhuma
--   34 fornecedor→ o PATCH direto do §3.9
--   35 fornecedor→ o move_deal do §3.9 (não pode ter regredido)
insert into public.organizations (id, name, phone_e164, neighborhood, source_id)
select ('c0000000-0000-4000-8000-0000000031' || lpad(i::text, 2, '0'))::uuid,
       'EV Parceiro ' || i, '+558499999' || lpad((3100 + i)::text, 4, '0'), 'Tirol',
       (select id from public.sources where slug = 'captura_campo')
  from generate_series(1, 5) i;

insert into public.deals (id, organization_id, pipeline_id, stage_id) values
  ('e0000000-0000-4000-8000-000000003101', 'c0000000-0000-4000-8000-000000003101',
     pg_temp.funil('produtor'),   pg_temp.etapa('produtor', 'demonstracao_realizada')),
  ('e0000000-0000-4000-8000-000000003102', 'c0000000-0000-4000-8000-000000003102',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'apresentacao_realizada')),
  ('e0000000-0000-4000-8000-000000003103', 'c0000000-0000-4000-8000-000000003103',
     pg_temp.funil('produtor'),   pg_temp.etapa('produtor', 'identificado')),
  ('e0000000-0000-4000-8000-000000003104', 'c0000000-0000-4000-8000-000000003104',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'respondeu')),
  ('e0000000-0000-4000-8000-000000003105', 'c0000000-0000-4000-8000-000000003105',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'respondeu'));

-- =====================================================================
-- 1. O catálogo (§3.1 e §3.12i)
-- =====================================================================
select ok(
  exists (select 1 from public.stages s
            join public.pipelines p on p.id = s.pipeline_id,
          lateral jsonb_array_elements(s.required_fields) e
           where p.slug = 'fornecedor' and s.slug = 'autorizou'
             and e.value ->> 'consent_kind' = 'data_use_authorized'),
  '§3.1: "Autorizou" (fornecedor) declara consent_kind = data_use_authorized');

select ok(
  exists (select 1 from public.stages s
            join public.pipelines p on p.id = s.pipeline_id,
          lateral jsonb_array_elements(s.required_fields) e
           where p.slug = 'produtor' and s.slug = 'parceria_aceita'
             and e.value ->> 'consent_kind' = 'data_use_authorized'),
  '§3.1: "Parceria aceita" (produtor) TAMBÉM declara consent_kind — era aqui que a prova sumia');

-- A varredura da família: qualquer funil cuja resolução de "autorizou" não
-- declare a prova volta a ser o mesmo defeito. Não é uma etapa: é a regra.
select is(
  (select count(*)::int
     from public.pipelines p
     cross join lateral app.stage_for(p.id, 'autorizou') s
    where not exists (select 1 from jsonb_array_elements(s.required_fields) e
                       where e.value ->> 'consent_kind' = 'data_use_authorized')),
  0, '§3.1: nenhum funil resolve "autorizou" para uma etapa que não declara a prova');

select is(
  (select count(*)::int from public.stages s, lateral jsonb_array_elements(s.required_fields) e
    where e.value ->> 'label' ilike '%consent_events%'),
  0, '§3.12i: nenhum rótulo de campo obrigatório mostra "consent_events" para a Heloísa');

select is(
  (select count(*)::int from public.stages s, lateral jsonb_array_elements(s.required_fields) e
    where e.value ->> 'label' ~ '[a-z]_[a-z]'),
  0, '§3.12i: nenhum rótulo de campo obrigatório traz nome de coluna do banco');

-- =====================================================================
-- 2. A cadeia autorização → pré-cadastro no funil PRODUTOR (§3.1)
-- =====================================================================
create table pg_temp.antes(org uuid primary key, n int);
insert into pg_temp.antes
  select id, pg_temp.n_consent(id) from public.organizations
   where id in ('c0000000-0000-4000-8000-000000003101','c0000000-0000-4000-8000-000000003102',
                'c0000000-0000-4000-8000-000000003103');

select pg_temp.entrar('a0000000-0000-4000-8000-000000003101', 'admin');
select is(public.criar_pre_cadastro('c0000000-0000-4000-8000-000000003101',
            jsonb_build_object('nome_exibicao', 'EV CERIMONIAL', 'cidade', 'Natal')) ->> 'ok',
          'true', '§3.1 produtor: o rascunho do pré-cadastro nasce');

create table pg_temp.r_prod as
select public.registrar_contato(
         gen_random_uuid(), 'c0000000-0000-4000-8000-000000003101',
         pg_temp.desfecho('reu_autorizou'), 'decisor',
         'e0000000-0000-4000-8000-000000003101', null, now(),
         'pgTAP §3.1 produtor', null, null, null, null,
         'Autorizo vocês a cadastrarem a minha assessoria na Komune — WhatsApp, 05/09') as res;
select pg_temp.sair();

select is((select res ->> 'etapa_aplicada' from pg_temp.r_prod), 'true',
  '§3.1 produtor: "Realizada, autorizou" move o negócio');
select is(pg_temp.etapa_de('e0000000-0000-4000-8000-000000003101'), 'parceria_aceita',
  '§3.1 produtor: e o destino é "Parceria aceita"');
select is(pg_temp.n_consent('c0000000-0000-4000-8000-000000003101')
          - (select n from pg_temp.antes where org = 'c0000000-0000-4000-8000-000000003101'),
  1, '§3.1 produtor: a evidência vira EXATAMENTE uma linha em consent_events (era zero)');
select is(
  (select evidence_text from public.consent_events
    where organization_id = 'c0000000-0000-4000-8000-000000003101'
      and kind = 'data_use_authorized'::app.consent_kind
    order by occurred_at desc, id desc limit 1),
  'Autorizo vocês a cadastrarem a minha assessoria na Komune — WhatsApp, 05/09',
  '§3.1 produtor: com as palavras dela, literais');
select ok(app.tem_autorizacao_vigente('c0000000-0000-4000-8000-000000003101'),
  '§3.1 produtor: a autorização passa a ser vigente');

select pg_temp.entrar('a0000000-0000-4000-8000-000000003101', 'admin');
select is(public.gerar_link_de_reivindicacao('c0000000-0000-4000-8000-000000003101') ->> 'ok',
  'true', '§3.1 produtor: o link de cadastro SAI (antes recusava com sem_autorizacao)');
select pg_temp.sair();

-- =====================================================================
-- 3. A mesma cadeia no funil FORNECEDOR (o controle que já passava)
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000003101', 'admin');
select is(public.criar_pre_cadastro('c0000000-0000-4000-8000-000000003102',
            jsonb_build_object('nome_exibicao', 'EV BUFFET', 'cidade', 'Natal')) ->> 'ok',
          'true', '§3.1 fornecedor: o rascunho do pré-cadastro nasce');
create table pg_temp.r_forn as
select public.registrar_contato(
         gen_random_uuid(), 'c0000000-0000-4000-8000-000000003102',
         pg_temp.desfecho('reu_autorizou'), 'decisor',
         'e0000000-0000-4000-8000-000000003102', null, now(),
         'pgTAP §3.1 fornecedor', null, null, null, null,
         'Pode cadastrar meu buffet lá, sim — WhatsApp, 05/09') as res;
select pg_temp.sair();

select is(pg_temp.etapa_de('e0000000-0000-4000-8000-000000003102'), 'autorizou',
  '§3.1 fornecedor: o negócio entra em "Autorizou"');
select is(pg_temp.n_consent('c0000000-0000-4000-8000-000000003102')
          - (select n from pg_temp.antes where org = 'c0000000-0000-4000-8000-000000003102'),
  1, '§3.1 fornecedor: uma linha em consent_events');
select pg_temp.entrar('a0000000-0000-4000-8000-000000003101', 'admin');
select is(public.gerar_link_de_reivindicacao('c0000000-0000-4000-8000-000000003102') ->> 'ok',
  'true', '§3.1 fornecedor: e o link de cadastro sai');
select pg_temp.sair();

-- =====================================================================
-- 4. Sem colateral: "Cadastro iniciado na hora" não colhe frase nenhuma
--    e continua movendo o cartão no funil produtor ("required": false)
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000003101', 'admin');
create table pg_temp.r_vis as
select public.registrar_contato(
         gen_random_uuid(), 'c0000000-0000-4000-8000-000000003103',
         pg_temp.desfecho('vis_cadastro_iniciado'), 'decisor',
         'e0000000-0000-4000-8000-000000003103', null, now(),
         'pgTAP §3.1 colateral', null, null, null, null, null) as res;
select pg_temp.sair();

select is(pg_temp.etapa_de('e0000000-0000-4000-8000-000000003103'), 'parceria_aceita',
  '§3.1: "Cadastro iniciado na hora" continua movendo o produtor (o campo não barra)');
select is(pg_temp.n_consent('c0000000-0000-4000-8000-000000003103')
          - (select n from pg_temp.antes where org = 'c0000000-0000-4000-8000-000000003103'),
  0, '§3.1: e sem frase digitada não se inventa consentimento nenhum');

-- =====================================================================
-- 5. O gatilho: um UPDATE direto não burla a etapa (§3.9)
-- =====================================================================
select throws_ok(
  $$update public.deals set stage_id = (select s.id from public.stages s
       join public.pipelines p on p.id = s.pipeline_id
      where p.slug = 'fornecedor' and s.slug = 'autorizou')
     where id = 'e0000000-0000-4000-8000-000000003104'$$,
  '23514',
  null,
  '§3.9: PATCH direto para "Autorizou" sem prova em consent_events é recusado pelo gatilho');
select is(pg_temp.etapa_de('e0000000-0000-4000-8000-000000003104'), 'respondeu',
  '§3.9: e o cartão não se mexeu');

insert into public.consent_events (kind, organization_id, channel, evidence_text)
values ('data_use_authorized', 'c0000000-0000-4000-8000-000000003104', 'whatsapp',
        'pgTAP §3.9: autorizou por áudio');
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'autorizou')
 where id = 'e0000000-0000-4000-8000-000000003104';
select is(pg_temp.etapa_de('e0000000-0000-4000-8000-000000003104'), 'autorizou',
  '§3.9: com a prova gravada, o mesmo UPDATE passa');

select throws_ok(
  $$update public.deals set stage_id = (select s.id from public.stages s
       join public.pipelines p on p.id = s.pipeline_id
      where p.slug = 'fornecedor' and s.slug = 'reuniao_marcada')
     where id = 'e0000000-0000-4000-8000-000000003105'$$,
  '23514',
  null,
  '§3.9: PATCH direto para "Reunião marcada" sem data é recusado pelo gatilho');

update public.deals
   set stage_id = pg_temp.etapa('fornecedor', 'reuniao_marcada'),
       next_action = 'Reunião marcada',
       next_action_at = now() + interval '2 days'
 where id = 'e0000000-0000-4000-8000-000000003105';
select is(pg_temp.etapa_de('e0000000-0000-4000-8000-000000003105'), 'reuniao_marcada',
  '§3.9: com a data como próxima ação, o mesmo UPDATE passa');

-- E o caminho normal não regrediu: `move_deal` continua movendo e gravando.
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'respondeu'),
                        next_action = null, next_action_at = null
 where id = 'e0000000-0000-4000-8000-000000003105';
select pg_temp.entrar('a0000000-0000-4000-8000-000000003101', 'admin');
select is(
  (public.move_deal('e0000000-0000-4000-8000-000000003105',
                    pg_temp.etapa('fornecedor', 'reuniao_marcada'), null, 'aceitou o horário',
                    jsonb_build_object('meeting_at', (now() + interval '2 days')::text,
                                       'meeting_format', 'meet')) ->> 'ok'),
  'true', '§3.9: move_deal com data e formato continua passando pelo gatilho novo');
create table pg_temp.antes105 as select pg_temp.n_consent('c0000000-0000-4000-8000-000000003105') as n;
select is(
  (public.move_deal('e0000000-0000-4000-8000-000000003105',
                    pg_temp.etapa('fornecedor', 'autorizou'), null, null,
                    jsonb_build_object('authorization_evidence', 'pode cadastrar sim, autorizo'),
                    jsonb_build_object('kind', 'message', 'label', 'Enviar link de cadastro',
                                       'at', now() + interval '1 day')) ->> 'ok'),
  'true', '§3.9: move_deal grava a prova ANTES do movimento e o gatilho a encontra');
select pg_temp.sair();
select is(pg_temp.n_consent('c0000000-0000-4000-8000-000000003105') - (select n from pg_temp.antes105),
  1, '§3.9: e a prova é uma linha só');

select * from finish();
rollback;

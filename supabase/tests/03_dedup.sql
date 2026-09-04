-- =====================================================================
-- pgTAP — Dedup (RF-BAS-08, RF-BAS-15): índices únicos parciais em CNPJ, telefone e
-- @instagram; app.find_org_matches; quick_create_organization com duplicado/suprimido.
-- =====================================================================
begin;
select plan(54);

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
create function pg_temp.fonte(p_slug text) returns int language sql as $$
  select id from public.sources where slug = p_slug
$$;

-- ---------- índices únicos parciais ----------
select has_index('public', 'organizations', 'organizations_cnpj_uq',      'índice organizations_cnpj_uq existe');
select has_index('public', 'organizations', 'organizations_phone_uq',     'índice organizations_phone_uq existe');
select has_index('public', 'organizations', 'organizations_instagram_uq', 'índice organizations_instagram_uq existe');
select has_index('public', 'contacts',      'contacts_phone_uq',          'índice contacts_phone_uq existe');
select has_index('public', 'organizations', 'organizations_place_uq',     'índice organizations_place_uq existe (place_id, RF-BAS-08)');
select index_is_unique('public', 'organizations', 'organizations_place_uq', 'organizations_place_uq é único');
select index_is_unique('public', 'organizations', 'organizations_cnpj_uq',      'organizations_cnpj_uq é único');
select index_is_unique('public', 'organizations', 'organizations_phone_uq',     'organizations_phone_uq é único');
select index_is_unique('public', 'organizations', 'organizations_instagram_uq', 'organizations_instagram_uq é único');
select index_is_unique('public', 'contacts',      'contacts_phone_uq',          'contacts_phone_uq é único');
select ok((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'organizations_cnpj_uq') ~ 'WHERE .*deleted_at IS NULL',
  'organizations_cnpj_uq é parcial (ignora soft-deleted)');
select ok((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'organizations_phone_uq') ~ 'WHERE .*deleted_at IS NULL',
  'organizations_phone_uq é parcial (ignora soft-deleted)');
select ok((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'organizations_instagram_uq') ~ 'WHERE .*deleted_at IS NULL',
  'organizations_instagram_uq é parcial (ignora soft-deleted)');
select ok((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'contacts_phone_uq') ~ 'WHERE .*deleted_at IS NULL',
  'contacts_phone_uq é parcial (ignora soft-deleted)');

-- ---------- duplicatas exatas ----------
insert into public.organizations (id, name, phone_e164, cnpj, instagram_handle, source_id) values
  ('b0000000-0000-4000-8000-000000000201', 'Dedup Buffet Sao Joao', '+5584999990301', '11.222.333/0001-81', 'dedup.buffet', pg_temp.fonte('captura_campo'));
select throws_ok(
  $$insert into public.organizations (name, phone_e164, source_id) values ('Outro nome', '(84) 99999-0301', pg_temp.fonte('captura_campo'))$$,
  '23505', null, 'organizations: telefone duplicado (mesmo após normalização) é rejeitado');
select throws_ok(
  $$insert into public.organizations (name, cnpj, source_id) values ('Outro nome', '11222333000181', pg_temp.fonte('captura_campo'))$$,
  '23505', null, 'organizations: CNPJ duplicado é rejeitado');
select throws_ok(
  $$insert into public.organizations (name, instagram_handle, source_id) values ('Outro nome', '@Dedup.Buffet', pg_temp.fonte('captura_campo'))$$,
  '23505', null, 'organizations: @instagram duplicado é rejeitado');
update public.organizations set deleted_at = now() where id = 'b0000000-0000-4000-8000-000000000201';
select lives_ok(
  $$insert into public.organizations (id, name, phone_e164, cnpj, instagram_handle, source_id)
      values ('b0000000-0000-4000-8000-000000000202', 'Dedup Buffet Sao Joao', '+5584999990301', '11.222.333/0001-81', 'dedup.buffet', pg_temp.fonte('captura_campo'))$$,
  'organizations: registro soft-deleted não bloqueia as chaves de dedup');

insert into public.contacts (id, full_name, phone_e164) values ('c0000000-0000-4000-8000-000000000201', 'Pessoa Dedup', '+5584999990311');
select throws_ok(
  $$insert into public.contacts (full_name, phone_e164) values ('Outra pessoa', '84 99999 0311')$$,
  '23505', null, 'contacts: telefone duplicado é rejeitado');
update public.contacts set deleted_at = now() where id = 'c0000000-0000-4000-8000-000000000201';
select lives_ok(
  $$insert into public.contacts (full_name, phone_e164) values ('Outra pessoa', '84 99999 0311')$$,
  'contacts: pessoa soft-deleted não bloqueia o telefone');

-- ---------- candidatos a duplicata (app.find_org_matches) ----------
-- As sete chaves do RF-BAS-08 com a confiança graduada do PRD (a revisão humana e a importação
-- ordenam por ela): CNPJ 0,99 → place_id 0,98 → @instagram 0,97 → celular 0,95 →
-- fixo + mesmo bairro 0,90 → domínio 0,90 → nome por trigram ≥ 0,85 (sugestão).
update public.organizations
   set place_id     = 'ChIJdedup0001Buffet',
       website      = 'https://www.dedupbuffet.com.br/contato?utm=1',
       city_id      = (select id from public.cities where name = 'Natal'),
       neighborhood = 'Ponta Negra'
 where id = 'b0000000-0000-4000-8000-000000000202';
insert into public.organizations (id, name, phone_e164, neighborhood, website, source_id) values
  ('b0000000-0000-4000-8000-000000000203', 'Dedup Espaço Tirol', '84 3206-4212', 'Tirol',
   'https://www.instagram.com/dedup.espaco', pg_temp.fonte('captura_campo'));

select results_eq(
  $$select organization_id, confidence, reason from app.find_org_matches('{"cnpj":"11.222.333/0001-81"}')$$,
  $$values ('b0000000-0000-4000-8000-000000000202'::uuid, 0.99::numeric, 'cnpj'::text)$$,
  'find_org_matches: CNPJ exato com confiança 0,99 (ignora o soft-deleted)');
select results_eq(
  $$select organization_id, confidence, reason from app.find_org_matches('{"place_id":" ChIJdedup0001Buffet "}')$$,
  $$values ('b0000000-0000-4000-8000-000000000202'::uuid, 0.98::numeric, 'place_id'::text)$$,
  'find_org_matches: place_id do Google Places com confiança 0,98');
select results_eq(
  $$select organization_id, confidence, reason from app.find_org_matches('{"instagram_handle":"https://instagram.com/Dedup.Buffet/"}')$$,
  $$values ('b0000000-0000-4000-8000-000000000202'::uuid, 0.97::numeric, 'instagram'::text)$$,
  'find_org_matches: @instagram exato com confiança 0,97');
select results_eq(
  $$select organization_id, confidence, reason from app.find_org_matches('{"phone_e164":"(84) 99999-0301"}')$$,
  $$values ('b0000000-0000-4000-8000-000000000202'::uuid, 0.95::numeric, 'phone'::text)$$,
  'find_org_matches: celular exato com confiança 0,95');
select results_eq(
  $$select organization_id, confidence, reason from app.find_org_matches('{"phone_e164":"84 3206-4212","neighborhood":"tirol"}')$$,
  $$values ('b0000000-0000-4000-8000-000000000203'::uuid, 0.90::numeric, 'landline_neighborhood'::text)$$,
  'find_org_matches: fixo + mesmo bairro com confiança 0,90');
select is(
  (select count(*)::int from app.find_org_matches('{"phone_e164":"84 3206-4212","neighborhood":"Lagoa Nova"}')),
  0, 'find_org_matches: fixo em outro bairro não é duplicata (recepção compartilhada)');
select results_eq(
  $$select organization_id, confidence, reason from app.find_org_matches('{"website":"http://dedupbuffet.com.br/"}')$$,
  $$values ('b0000000-0000-4000-8000-000000000202'::uuid, 0.90::numeric, 'domain'::text)$$,
  'find_org_matches: domínio do site com confiança 0,90');
select is(
  (select count(*)::int from app.find_org_matches('{"website":"https://www.instagram.com/outra.empresa"}') where reason = 'domain'),
  0, 'find_org_matches: host compartilhado (instagram.com) não vale como domínio');
select results_eq(
  $$select organization_id, confidence, reason from app.find_org_matches('{"cnpj":"11.222.333/0001-81","phone_e164":"(84) 99999-0301","place_id":"ChIJdedup0001Buffet"}')$$,
  $$values ('b0000000-0000-4000-8000-000000000202'::uuid, 0.99::numeric, 'cnpj'::text),
           ('b0000000-0000-4000-8000-000000000202'::uuid, 0.98::numeric, 'place_id'::text),
           ('b0000000-0000-4000-8000-000000000202'::uuid, 0.95::numeric, 'phone'::text)$$,
  'find_org_matches: candidatos vêm ordenados por confiança decrescente');
select ok(
  (select confidence >= 0.85 from app.find_org_matches('{"name":"Dedup Buffet Sao Joao 2"}')
     where reason = 'name_trgm' and organization_id = 'b0000000-0000-4000-8000-000000000202'),
  'find_org_matches: nome muito parecido (trigram >= 0,85) aparece como sugestão');
select is(
  (select count(*)::int from app.find_org_matches('{"name":"Buffet São João"}') where reason = 'name_trgm'),
  0, 'find_org_matches: nome apenas parecido (0,71) fica abaixo do limiar do RF-BAS-08');
select ok(
  (select count(*) > 0 from app.find_org_matches('{"name":"Buffet São João"}', 0.6) where reason = 'name_trgm'),
  'find_org_matches: limiar é parametrizável (0,6 na revisão do Radar)');
select is(
  (select count(*)::int from app.find_org_matches(
     jsonb_build_object('name', 'Dedup Buffet Sao Joao 2', 'city_id', (select id from public.cities where name = 'Parnamirim')))
     where reason = 'name_trgm'),
  0, 'find_org_matches: sugestão por nome exige a mesma cidade quando ela é informada');
select is(
  (select count(*)::int from app.find_org_matches('{"name":"Padaria Central"}') where reason = 'name_trgm'),
  0, 'find_org_matches: nome diferente não sugere nada');

-- ---------- cadastro rápido (public.quick_create_organization) ----------
-- Pessoa (dono/sócio) com WhatsApp próprio, ligada a uma organização: o cadastro rápido não
-- pode criar uma segunda organização para o mesmo número (RF-BAS-15).
insert into public.contacts (id, full_name, phone_e164) values
  ('c0000000-0000-4000-8000-000000000202', 'Dono Dedup', '+5584999990312');
insert into public.organization_contacts (organization_id, contact_id, is_primary) values
  ('b0000000-0000-4000-8000-000000000202', 'c0000000-0000-4000-8000-000000000202', true);
-- Fonte desligada pelo gestor (RF-ADM-02): deixa de ser origem válida no cadastro rápido.
update public.sources set is_enabled = false where slug = 'telelistas';
insert into public.allowed_users (email, role, note) values ('sdr.dedup@teste.local', 'sdr', 'pgTAP'), ('leitura.dedup@teste.local', 'leitura', 'pgTAP');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000201', 'sdr.dedup@teste.local', '{"full_name":"SDR Dedup"}'),
  ('a0000000-0000-4000-8000-000000000202', 'leitura.dedup@teste.local', '{"full_name":"Leitura Dedup"}');
select app.suppress('phone', '+5584999990402', 'pgTAP', null::app.channel, null::uuid);

select pg_temp.entrar('a0000000-0000-4000-8000-000000000201', 'sdr');
create temporary table qc as
  select public.quick_create_organization('Dedup Rápido', (select id from public.categories where slug = 'buffet_adulto_corporativo'),
                                          '(84) 99999-0401', pg_temp.fonte('captura_campo')) as r;
select is((select r ->> 'created' from qc), 'true', 'quick_create: cria quando não há duplicado');
select results_eq(
  $$select o.phone_e164, o.owner_id, o.collector from public.organizations_view o where o.id = (select (r ->> 'organization_id')::uuid from qc)$$,
  $$values ('+55 84 •••••-••01'::text, 'a0000000-0000-4000-8000-000000000201'::uuid, 'SDR Dedup'::text)$$,
  'quick_create: organização com telefone normalizado, dono = quem criou, collector = nome do usuário');
select is(
  (select oc.is_primary from public.organization_categories oc
     where oc.organization_id = (select (r ->> 'organization_id')::uuid from qc)
       and oc.category_id = (select id from public.categories where slug = 'buffet_adulto_corporativo')),
  true, 'quick_create: categoria primária gravada');
select results_eq(
  $$select p.slug, s.slug, d.owner_id, d.next_action, d.status::text
      from public.deals d join public.pipelines p on p.id = d.pipeline_id join public.stages s on s.id = d.stage_id
     where d.id = (select (r ->> 'deal_id')::uuid from qc)$$,
  $$values ('fornecedor'::text, 'prospectado'::text, 'a0000000-0000-4000-8000-000000000201'::uuid, 'Primeiro contato'::text, 'open'::text)$$,
  'quick_create: negócio na 1ª etapa do funil de fornecedor com "Primeiro contato"');
select ok(
  (select extract(isodow from (d.next_action_at at time zone 'America/Fortaleza')) < 6
          and (d.next_action_at at time zone 'America/Fortaleza')::time = time '09:00'
          and not exists (select 1 from public.holidays h where h.date = (d.next_action_at at time zone 'America/Fortaleza')::date)
          and (d.next_action_at at time zone 'America/Fortaleza')::date > (now() at time zone 'America/Fortaleza')::date
     from public.deals d where d.id = (select (r ->> 'deal_id')::uuid from qc)),
  'quick_create: primeiro contato em D+1 útil às 09:00 (America/Fortaleza)');
select is(
  (select count(*)::int from public.activities a
     where a.deal_id = (select (r ->> 'deal_id')::uuid from qc) and a.type = 'system' and a.metadata ->> 'origin' = 'quick_create'),
  1, 'quick_create: atividade de sistema na timeline');

create temporary table qc_dup as
  select public.quick_create_organization('Dedup Rápido de novo', (select id from public.categories where slug = 'buffet_adulto_corporativo'),
                                          '84 99999 0401', pg_temp.fonte('captura_campo')) as r;
select is((select r ->> 'created' from qc_dup), 'false', 'quick_create: duplicado não cria');
select is((select r ->> 'reason' from qc_dup), 'telefone_ja_cadastrado', 'quick_create: motivo telefone_ja_cadastrado');
select is((select r ->> 'existing_id' from qc_dup), (select r ->> 'organization_id' from qc), 'quick_create: devolve o id do existente');
select is((select count(*)::int from public.organizations_view where phone_e164 = '+55 84 •••••-••01' and name like 'Dedup Rápido%'), 1,
  'quick_create: uma única organização para o telefone');

-- Número já cadastrado como WhatsApp de uma pessoa ligada a uma organização: dois cartões e
-- duas conversas para o mesmo número é o que o RF-BAS-15 quer evitar.
select is(
  (select public.quick_create_organization('Pessoa já cadastrada', (select id from public.categories where slug = 'buffet_adulto_corporativo'), '84 99999-0312', pg_temp.fonte('captura_campo')) ->> 'reason'),
  'telefone_de_contato_existente', 'quick_create: telefone de pessoa já ligada a uma organização não cria outra');
select is(
  (select public.quick_create_organization('Suprimido', (select id from public.categories where slug = 'buffet_adulto_corporativo'), '84 99999-0402', pg_temp.fonte('captura_campo')) ->> 'reason'),
  'telefone_suprimido', 'quick_create: telefone na suppression_list é recusado');
select is(
  (select public.quick_create_organization('Inválido', (select id from public.categories where slug = 'buffet_adulto_corporativo'), '84 1234', pg_temp.fonte('captura_campo')) ->> 'reason'),
  'telefone_invalido', 'quick_create: telefone inválido');
select is(
  (select public.quick_create_organization('   ', (select id from public.categories where slug = 'buffet_adulto_corporativo'), '84 99999-0403', pg_temp.fonte('captura_campo')) ->> 'reason'),
  'nome_obrigatorio', 'quick_create: nome obrigatório');
select is(
  (select public.quick_create_organization('Categoria ruim', 999999, '84 99999-0403', pg_temp.fonte('captura_campo')) ->> 'reason'),
  'categoria_invalida', 'quick_create: categoria inexistente');
select is(
  (select public.quick_create_organization('Origem ruim', (select id from public.categories where slug = 'buffet_adulto_corporativo'), '84 99999-0403', 999999) ->> 'reason'),
  'origem_invalida', 'quick_create: origem inexistente');
select is(
  (select public.quick_create_organization('Origem desligada', (select id from public.categories where slug = 'buffet_adulto_corporativo'), '84 99999-0403', pg_temp.fonte('telelistas')) ->> 'reason'),
  'origem_desabilitada', 'quick_create: origem desabilitada pelo gestor é recusada (RF-ADM-02)');

create temporary table qc_ref as
  select public.quick_create_organization('Indicado', (select id from public.categories where slug = 'fotografia_video'),
                                          '84 99999-0404', pg_temp.fonte('indicacao')) as r;
select is((select tier from public.deals where id = (select (r ->> 'deal_id')::uuid from qc_ref)), 'A+',
  'quick_create: origem de indicação entra como Tier A+');

create temporary table qc_prod as
  select public.quick_create_organization('Cerimonial Dedup', (select id from public.categories where slug = 'cerimonialistas_assessorias'),
                                          '84 99999-0405', pg_temp.fonte('captura_campo'), 'cerimonialista') as r;
select results_eq(
  $$select p.slug, s.slug from public.deals d join public.pipelines p on p.id = d.pipeline_id join public.stages s on s.id = d.stage_id
     where d.id = (select (r ->> 'deal_id')::uuid from qc_prod)$$,
  $$values ('produtor'::text, 'identificado'::text)$$,
  'quick_create: cerimonialista entra no funil de produtor, 1ª etapa');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000202', 'leitura');
select throws_ok(
  $$select public.quick_create_organization('Leitura', (select id from public.categories where slug = 'buffet_adulto_corporativo'), '84 99999-0406', pg_temp.fonte('captura_campo'))$$,
  '42501', null, 'quick_create: papel leitura não cria parceiros');
select pg_temp.sair();

select * from finish();
rollback;

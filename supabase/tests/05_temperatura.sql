-- =====================================================================
-- pgTAP — Regra de temperatura (PRD §5.6; migração 000400): app.compute_temperature
-- (etapa × intenção × recência × override × status), triggers em deals/organizations,
-- espelho na organização e app.recompute_temperatures().
-- =====================================================================
begin;
select plan(45);

create function pg_temp.funil(p_slug text) returns int language sql as $$
  select id from public.pipelines where slug = p_slug
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = p_funil and s.slug = p_slug
$$;
-- (temperatura, alerta) da regra pura, em texto, para comparar com results_eq.
create function pg_temp.regra(p_stage app.temperature, p_intent text, p_last timestamptz, p_override smallint, p_status app.deal_status)
returns table (temperatura text, alerta boolean) language sql as $$
  select temperature::text, needs_attention from app.compute_temperature(p_stage, p_intent, p_last, p_override, p_status)
$$;

-- ---------- regra pura ----------
select results_eq($$select * from pg_temp.regra('frio', null, now() - interval '1 day', null, 'open')$$,
  $$values ('frio'::text, false)$$, 'regra: etapa fria sem intenção => frio');
select results_eq($$select * from pg_temp.regra('frio', 'interessado', now() - interval '1 day', null, 'open')$$,
  $$values ('quente'::text, false)$$, 'regra: interesse declarado (interessado) => quente mesmo em etapa fria');
select results_eq($$select * from pg_temp.regra('frio', 'Interessado', now() - interval '1 day', null, 'open')$$,
  $$values ('quente'::text, false)$$, 'regra: intenção comparada sem diferenciar maiúsculas');
select results_eq($$select * from pg_temp.regra('frio', 'pediu_taxa', now() - interval '6 days', null, 'open')$$,
  $$values ('quente'::text, true)$$, 'regra: pediu taxa há 6 dias => quente com alerta vermelho');
select results_eq($$select * from pg_temp.regra('frio', 'autoriza_pre_cadastro', now() - interval '1 day', null, 'open')$$,
  $$values ('quente'::text, false)$$, 'regra: autoriza pré-cadastro => quente');
select results_eq($$select * from pg_temp.regra('quente', null, now() - interval '2 days', null, 'open')$$,
  $$values ('quente'::text, false)$$, 'regra: etapa quente (5–8) com contato há 2 dias => quente');
select results_eq($$select * from pg_temp.regra('quente', null, now() - interval '6 days', null, 'open')$$,
  $$values ('quente'::text, true)$$, 'regra: quente > 5 dias sem contato => alerta vermelho');
select results_eq($$select * from pg_temp.regra('quente', null, now() - interval '15 days', null, 'open')$$,
  $$values ('morno'::text, true)$$, 'regra: quente > 14 dias => desce a morno');
select results_eq($$select * from pg_temp.regra('quente', null, null, null, 'open')$$,
  $$values ('quente'::text, false)$$, 'regra: sem contato registrado conta como 0 dias');
select results_eq($$select * from pg_temp.regra('morno', null, now() - interval '3 days', null, 'open')$$,
  $$values ('morno'::text, false)$$, 'regra: respondeu/em conversa com contato há 3 dias => morno');
select results_eq($$select * from pg_temp.regra('morno', null, now() - interval '8 days', null, 'open')$$,
  $$values ('morno'::text, true)$$, 'regra: morno > 7 dias => alerta de reengajar');
select results_eq($$select * from pg_temp.regra('morno', null, now() - interval '15 days', null, 'open')$$,
  $$values ('frio'::text, false)$$, 'regra: morno > 14 dias => dormente (frio)');
select results_eq($$select * from pg_temp.regra('frio', 'me_chama_depois', now() - interval '2 days', null, 'open')$$,
  $$values ('morno'::text, false)$$, 'regra: "me chama depois" sem interesse declarado => morno');
select results_eq($$select * from pg_temp.regra('frio', 'manda_material', now() - interval '10 days', null, 'open')$$,
  $$values ('morno'::text, true)$$, 'regra: "manda material" há 10 dias => morno com alerta');
select results_eq($$select * from pg_temp.regra('quente', 'interessado', now(), 1::smallint, 'open')$$,
  $$values ('frio'::text, false)$$, 'regra: override 1 estrela vence etapa quente e interesse');
select results_eq($$select * from pg_temp.regra('frio', null, now() - interval '30 days', 3::smallint, 'open')$$,
  $$values ('quente'::text, false)$$, 'regra: override 3 estrelas => quente sem alerta');
select results_eq($$select * from pg_temp.regra('quente', null, now(), 2::smallint, 'lost')$$,
  $$values ('morno'::text, false)$$, 'regra: override 2 estrelas vence até o status perdido');
select results_eq($$select * from pg_temp.regra('quente', 'interessado', now(), null, 'lost')$$,
  $$values ('frio'::text, false)$$, 'regra: perdido => frio');
select results_eq($$select * from pg_temp.regra('quente', null, now(), null, 'paused')$$,
  $$values ('frio'::text, false)$$, 'regra: pausado => frio');
select results_eq($$select * from pg_temp.regra('morno', null, now(), null, 'nurturing')$$,
  $$values ('frio'::text, false)$$, 'regra: nutrição/dormente => frio');
select results_eq($$select * from pg_temp.regra('cliente', null, now() - interval '40 days', null, 'open')$$,
  $$values ('cliente'::text, false)$$, 'regra: etapa Publicado/Verificado (Funil 2) => cliente, sem esfriar por recência');
select results_eq($$select * from pg_temp.regra('cliente_ativo', null, now() - interval '90 days', null, 'won')$$,
  $$values ('cliente_ativo'::text, false)$$, 'regra: etapas 3–6 do Funil 2 => cliente ativo');
select results_eq($$select * from pg_temp.regra('cliente', null, now(), null, 'lost')$$,
  $$values ('frio'::text, false)$$, 'regra: cliente perdido => frio');

-- ---------- integração: triggers em deals e espelho na organização ----------
insert into public.organizations (id, name, source_id) values
  ('b0000000-0000-4000-8000-000000000401', 'Temperatura Org', (select id from public.sources where slug = 'captura_campo')),
  ('b0000000-0000-4000-8000-000000000402', 'Temperatura Org sem negócio', (select id from public.sources where slug = 'captura_campo'));
insert into public.deals (id, organization_id, pipeline_id, stage_id) values
  ('d0000000-0000-4000-8000-000000000401', 'b0000000-0000-4000-8000-000000000401', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'reuniao_marcada'));
select results_eq(
  $$select temperature::text, needs_attention from public.deals where id = 'd0000000-0000-4000-8000-000000000401'$$,
  $$values ('quente'::text, false)$$, 'deals: negócio em Reunião marcada nasce quente');
select is((select temperature::text from public.organizations where id = 'b0000000-0000-4000-8000-000000000401'), 'quente',
  'organizations: temperatura espelha o negócio');
update public.deals set last_activity_at = now() - interval '6 days' where id = 'd0000000-0000-4000-8000-000000000401';
select results_eq(
  $$select temperature::text, needs_attention from public.deals where id = 'd0000000-0000-4000-8000-000000000401'$$,
  $$values ('quente'::text, true)$$, 'deals: 6 dias sem contato => quente com alerta');
update public.deals set last_activity_at = now() - interval '15 days' where id = 'd0000000-0000-4000-8000-000000000401';
select is((select temperature::text from public.deals where id = 'd0000000-0000-4000-8000-000000000401'), 'morno',
  'deals: 15 dias sem contato => morno');
select is((select temperature::text from public.organizations where id = 'b0000000-0000-4000-8000-000000000401'), 'morno',
  'organizations: espelho acompanha o esfriamento');

-- override manual (1 a 3 estrelas, com motivo)
select throws_ok(
  $$update public.organizations set temperature_override = 1 where id = 'b0000000-0000-4000-8000-000000000401'$$,
  '23514', null, 'override: exige motivo');
update public.organizations set temperature_override = 1, temperature_override_reason = 'pediu para não insistir'
  where id = 'b0000000-0000-4000-8000-000000000401';
select is((select temperature::text from public.deals where id = 'd0000000-0000-4000-8000-000000000401'), 'frio',
  'override: 1 estrela recalcula o negócio para frio');
select results_eq(
  $$select temperature::text, temperature_override_at is not null from public.organizations where id = 'b0000000-0000-4000-8000-000000000401'$$,
  $$values ('frio'::text, true)$$, 'override: organização fica fria e registra quando');
update public.organizations set temperature_override = null where id = 'b0000000-0000-4000-8000-000000000401';
select results_eq(
  $$select o.temperature::text, o.temperature_override_reason, o.temperature_override_at, d.temperature::text
      from public.organizations o join public.deals d on d.organization_id = o.id where o.id = 'b0000000-0000-4000-8000-000000000401'$$,
  $$values ('morno'::text, null::text, null::timestamptz, 'morno'::text)$$,
  'override: remover volta à regra calculada e limpa motivo/data');

-- cliente / cliente ativo (Funil 2) e maior temperatura entre negócios
insert into public.deals (id, organization_id, pipeline_id, stage_id) values
  ('d0000000-0000-4000-8000-000000000402', 'b0000000-0000-4000-8000-000000000401', pg_temp.funil('ativacao'), pg_temp.etapa('ativacao', 'publicado'));
select is((select temperature::text from public.deals where id = 'd0000000-0000-4000-8000-000000000402'), 'cliente',
  'deals: Publicado no Funil 2 => cliente');
select is((select temperature::text from public.organizations where id = 'b0000000-0000-4000-8000-000000000401'), 'cliente',
  'organizations: espelho é a maior temperatura entre os negócios (cliente > morno)');
update public.deals set stage_id = pg_temp.etapa('ativacao', 'primeiro_lead') where id = 'd0000000-0000-4000-8000-000000000402';
select is((select temperature::text from public.deals where id = 'd0000000-0000-4000-8000-000000000402'), 'cliente_ativo',
  'deals: 1º lead entregue (Funil 2, etapa 3) => cliente ativo');
select is((select temperature::text from public.organizations where id = 'b0000000-0000-4000-8000-000000000401'), 'cliente_ativo',
  'organizations: espelho sobe para cliente ativo');
update public.deals set status = 'lost', lost_reason_id = (select id from public.lost_reasons where slug = 'agenda_cheia')
  where id = 'd0000000-0000-4000-8000-000000000402';
select is((select temperature::text from public.deals where id = 'd0000000-0000-4000-8000-000000000402'), 'frio',
  'deals: negócio perdido => frio');
select is((select temperature::text from public.organizations where id = 'b0000000-0000-4000-8000-000000000401'), 'morno',
  'organizations: negócio perdido não conta no espelho');

-- recálculo noturno (pg_cron): corrige temperatura defasada
--
-- DRENA A BASE ANTES DE FORJAR (conserto do achado D5). `app.recompute_temperatures`
-- devolve quantos negócios da BASE INTEIRA mudaram, e a base é compartilhada: basta
-- um negócio real ter ficado defasado (uma ligação tabulada com o gatilho de
-- temperatura já disparado, por exemplo) para a asserção "mudou 1" virar "mudou 2"
-- sem que nada da regra tivesse mudado. Medido: have 2, want 1, no banco local
-- depois das primeiras doze chamadas. Uma rodada antes do forjamento zera essa
-- dívida, e o que a asserção passa a medir é exatamente o negócio que este arquivo
-- desalinhou — que é o que ela sempre quis dizer.
select ok(app.recompute_temperatures() >= 0,
  'recompute_temperatures: a base é alinhada antes do forjamento (o teste mede o delta, não a dívida da base)');
-- Desliga o trigger de cálculo só para forjar um valor defasado (postgres é dono da tabela).
alter table public.deals disable trigger zz_deals_apply_temperature;
update public.deals set temperature = 'quente', needs_attention = false where id = 'd0000000-0000-4000-8000-000000000401';
alter table public.deals enable trigger zz_deals_apply_temperature;
select is(app.recompute_temperatures(), 1, 'recompute_temperatures: devolve quantos negócios mudaram');
select results_eq(
  $$select temperature::text, needs_attention from public.deals where id = 'd0000000-0000-4000-8000-000000000401'$$,
  $$values ('morno'::text, true)$$, 'recompute_temperatures: temperatura e alerta recalculados');
select is(app.recompute_temperatures(), 0, 'recompute_temperatures: segunda rodada não muda nada');

-- override em organização sem negócio aberto
select lives_ok(
  $$update public.organizations set temperature_override = 3, temperature_override_reason = 'contato pessoal do Rafael'
      where id = 'b0000000-0000-4000-8000-000000000402'$$,
  'override: organização sem negócio aberto aceita as estrelas (app.organizations_override_changed)');
select is((select temperature::text from public.organizations where id = 'b0000000-0000-4000-8000-000000000402'), 'quente',
  'override: organização sem negócio recebe a temperatura das estrelas');
update public.organizations set temperature_override = null where id = 'b0000000-0000-4000-8000-000000000402';
select is((select temperature::text from public.organizations where id = 'b0000000-0000-4000-8000-000000000402'), 'frio',
  'override: organização sem negócio volta a frio ao remover as estrelas');

select * from finish();
rollback;

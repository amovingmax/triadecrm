-- =====================================================================
-- pgTAP — Correções do módulo de ligação (migração 20260904001500)
--   app.prazo_do_lote · public.montar_lote (prazo e lote fantasma)
--   · app.call_candidates (ordem dos motivos)
--   · app.registrar_optout_de_contato · public.marcar_nao_ligar_mais
--   · public.tabular_chamada (opt-out em toda recusa)
--   · public.devolver_item_do_lote (opt-out sem tabular)
--   · o roteiro da seed (captura no nó certo)
--
-- O que este arquivo tem de provar, e por quê:
--   D2. O lote que promete três tentativas precisa VIVER três tentativas. Antes
--       ele nascia com ends_on = hoje e a segunda tentativa caía fora do período.
--   D6. O opt-out não pode depender de o operador chegar até um nó do roteiro
--       NEM de a tabulação ter sido aceita. A prova central é a regressão: "Sem
--       interesse" sem motivo de perda é RECUSADO e ainda assim o opt-out fica
--       registrado. Era exatamente aí que ele sumia (guardrail do CLAUDE.md).
--   D7. Montagem sem candidato não deixa lote nenhum para trás.
--   D8. Quem pediu opt-out aparece no recibo como "suprimido", e não escondido
--       atrás de "sem negócio aberto".
--   D4. Quem faz a pergunta do volume é quem guarda a resposta dela.
--
-- NENHUMA asserção deste arquivo conta linha absoluta em tabela compartilhada:
-- todas são delta contra uma base lida FORA da RLS, ou escopo por id de teste.
-- Este banco já foi usado de verdade (lotes e chamadas do Matheus), e a suíte
-- tem de continuar verde depois de cada ligação — não só em banco virgem.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(57);

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
create function pg_temp.hoje() returns date language sql as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;

-- ---------- contagens de BASE, lidas FORA da RLS (o padrão de 01_rls_por_papel) ----------
-- Contagem fixa em tabela que a operação alimenta é um teste que só passa uma vez.
create function pg_temp.n_lotes() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.call_batches
$$;
create function pg_temp.n_consent(p_org uuid) returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.consent_events
   where organization_id = p_org and kind = 'contact_optout'::app.consent_kind
$$;
create function pg_temp.status_do_item(p_item uuid) returns text language sql security definer set search_path = '' as $$
  select status::text from public.call_batch_items where id = p_item
$$;
create function pg_temp.etapa_do_negocio(p_org uuid) returns text language sql security definer set search_path = '' as $$
  select s.slug from public.deals d join public.stages s on s.id = d.stage_id
   where d.organization_id = p_org order by d.created_at limit 1
$$;
create function pg_temp.etapa_e_optout(p_org uuid) returns boolean language sql security definer set search_path = '' as $$
  select s.is_optout from public.deals d join public.stages s on s.id = d.stage_id
   where d.organization_id = p_org order by d.created_at limit 1
$$;

-- guarda o retorno das RPCs (o mesmo padrão do 13)
create table pg_temp.r (chave text primary key, valor jsonb);
create table pg_temp.base (chave text primary key, n int);
-- lidas também de dentro de `set role authenticated`
grant select on pg_temp.r, pg_temp.base to authenticated;

-- ---------- gente ----------
insert into public.allowed_users (email, role, note) values
  ('c15.sdr@teste.local',     'sdr',     'pgTAP correções'),
  ('c15.leitura@teste.local', 'leitura', 'pgTAP correções');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000015a1', 'c15.sdr@teste.local',     '{"full_name":"SDR Correções"}'),
  ('a0000000-0000-4000-8000-0000000015a2', 'c15.leitura@teste.local', '{"full_name":"Leitura Correções"}');

-- ---------- parceiros (categoria própria: o lote é determinístico) ----------
insert into public.categories (id, slug, name, "group", priority, position)
values (915, 'c15_teste', 'Categoria de teste das correções', 'servicos', 2, 915),
       (916, 'c15_vazia', 'Categoria sem nenhuma organização', 'servicos', 2, 916);

insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind)
select ('c0000000-0000-4000-8000-0000000015' || lpad(i::text, 2, '0'))::uuid,
       'C15 Buffet ' || i, '+558499915' || lpad(i::text, 4, '0'), 'Tirol',
       (select id from public.sources where slug = 'planilha'), 'fornecedor'
  from generate_series(1, 10) i;
insert into public.organization_categories (organization_id, category_id, is_primary)
select id, 915, true from public.organizations where name like 'C15 Buffet %';
insert into public.deals (organization_id, pipeline_id, stage_id)
select o.id, pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado')
  from public.organizations o where o.name like 'C15 Buffet %';

-- Três casos de exclusão, e os três com o negócio FECHADO ou prestes a ser — que é
-- a armadilha do D8: `app.consent_apply` leva o negócio de quem pediu opt-out para a
-- etapa de opt-out, que é is_lost, e o negócio deixa de estar 'open'. Com a ordem
-- antiga do `case`, os três apareciam no recibo como "sem negócio aberto".
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind) values
  ('c0000000-0000-4000-8000-000000001591', 'C15 Já Pediu Sair',  '+5584999159100', 'Tirol',
   (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  ('c0000000-0000-4000-8000-000000001592', 'C15 Não Contatar',   '+5584999159200', 'Tirol',
   (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  ('c0000000-0000-4000-8000-000000001593', 'C15 Só Supressão',   '+5584999159300', 'Tirol',
   (select id from public.sources where slug = 'planilha'), 'fornecedor');
insert into public.organization_categories (organization_id, category_id, is_primary) values
  ('c0000000-0000-4000-8000-000000001591', 915, true),
  ('c0000000-0000-4000-8000-000000001592', 915, true),
  ('c0000000-0000-4000-8000-000000001593', 915, true);
insert into public.deals (organization_id, pipeline_id, stage_id) values
  ('c0000000-0000-4000-8000-000000001591', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado')),
  ('c0000000-0000-4000-8000-000000001592', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado')),
  ('c0000000-0000-4000-8000-000000001593', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'));
-- 1591: opt-out de verdade (consent_events -> do_not_contact + etapa de opt-out).
insert into public.consent_events (kind, organization_id, channel, evidence_text)
  values ('contact_optout', 'c0000000-0000-4000-8000-000000001591', 'phone', 'pgTAP: pediu para sair');
-- 1592: só a bandeira da organização, com o negócio aberto.
update public.organizations set do_not_contact = true
  where id = 'c0000000-0000-4000-8000-000000001592';
-- 1593: NÃO tem do_not_contact; está só na suppression_list pelo telefone (é o caso
-- de quem pediu para sair por outro canal) E com o negócio já fechado. É este que
-- separa 'suprimido' de 'sem_negocio_aberto' na ordem do `case`.
insert into public.suppression_list (hash, kind, reason, channel)
  values (app.sha256_hex(app.normalize_phone_br('+5584999159300')), 'phone', 'pgTAP', 'phone');
update public.deals set status = 'lost',
       lost_reason_id = (select id from public.lost_reasons where slug = 'agenda_cheia')
 where organization_id = 'c0000000-0000-4000-8000-000000001593';


-- =====================================================================
-- 1. D2 — o prazo do lote cabe nas tentativas que ele promete
-- =====================================================================
select has_function('app', 'prazo_do_lote', array['date','integer'], 'app.prazo_do_lote existe');
-- Sexta 04/09/2026, três tentativas: sábado 05 (1), domingo 06 não abre, segunda
-- 07 é feriado da Independência (está na seed), terça 08 (2), quarta 09 (3).
select is(app.prazo_do_lote('2026-09-04'::date, 3), '2026-09-09'::date,
  'prazo: três tentativas a partir de sexta 04/09/2026 pedem até quarta 09/09 (pula domingo e o feriado de 07/09)');
select is(app.prazo_do_lote('2026-09-04'::date, 1), '2026-09-04'::date,
  'prazo: uma tentativa cabe no próprio dia — quem quer lote de um dia pede uma tentativa');
select ok(app.prazo_do_lote('2026-09-04'::date, 5) > app.prazo_do_lote('2026-09-04'::date, 3),
  'prazo: mais tentativas, mais prazo (a relação é monótona)');
select is((select count(*)::int from generate_series(0, 20) t
            where extract(dow from app.prazo_do_lote(date '2026-09-01' + t, 3)) = 0), 0,
  'prazo: em 21 dias de início seguidos, o último dia do lote nunca cai num domingo');

-- ---------- a janela abre o dia inteiro DENTRO da transação ----------
-- Só a PARTIR daqui: as asserções acima são sobre o calendário de verdade (sábado
-- 10h-13h, domingo fechado, 07/09 feriado) e perderiam o sentido sob uma janela
-- forjada. Da montagem em diante a janela precisa estar aberta, senão a suíte
-- passaria às 15h e falharia às 3h — que é o pior tipo de teste. Que o fluxo
-- consulta a janela de verdade já está provado no 13.
create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select h.de, h.ate from (values (0, 0::numeric, 24::numeric), (1, 0::numeric, 24::numeric),
    (2, 0::numeric, 24::numeric), (3, 0::numeric, 24::numeric), (4, 0::numeric, 24::numeric),
    (5, 0::numeric, 24::numeric), (6, 0::numeric, 24::numeric)) as h(dow, de, ate) where h.dow = p_dow
$$;
create temporary table feriado_de_hoje as
  select * from public.holidays where date = pg_temp.hoje();
delete from public.holidays where date = pg_temp.hoje();

-- A montagem: a tela sempre manda terminaEm = hoje (lote-montagem.tsx). O piso vale.
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000015a1', 'sdr');
  v := public.montar_lote('C15 prazo', pg_temp.funil('fornecedor'), 'frio',
         (select id from public.call_scripts where slug = 'captacao_v1' and is_published),
         array[915], 'prioridade', 6, 3, 20, null, pg_temp.hoje(), pg_temp.hoje());
  execute 'reset role';
  insert into pg_temp.r values ('prazo', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'montado' from pg_temp.r where chave = 'prazo'), 'true',
  'montagem: o lote de prova foi montado');
select is((select (valor ->> 'termina_em')::date from pg_temp.r where chave = 'prazo'),
          app.prazo_do_lote(pg_temp.hoje(), 3),
  'D2: mesmo com terminaEm = hoje, o lote nasce com o prazo que três tentativas exigem');
select ok((select (valor ->> 'termina_em')::date from pg_temp.r where chave = 'prazo') > pg_temp.hoje(),
  'D2: e esse prazo passa de hoje — era aqui que a 2ª tentativa morria');
select ok(
  (select ends_on from public.call_batches
    where id = ((select valor ->> 'lote_id' from pg_temp.r where chave = 'prazo'))::uuid)
  >= ((now() + interval '20 hours') at time zone 'America/Fortaleza')::date,
  'D2: o lote ainda está no período quando a 2ª tentativa (min_hours = 20) fica devida');
select is((select valor ->> 'max_tentativas' from pg_temp.r where chave = 'prazo'), '3',
  'D2: o recibo devolve quantas tentativas o lote promete, para a tela poder dizê-lo');

-- Prazo maior pedido pelo autor continua valendo: o piso alarga, nunca encurta.
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000015a1', 'sdr');
  v := public.montar_lote('C15 prazo longo', pg_temp.funil('fornecedor'), 'frio',
         (select id from public.call_scripts where slug = 'captacao_v1' and is_published),
         array[915], 'prioridade', 1, 3, 20, null, pg_temp.hoje(), pg_temp.hoje() + 40);
  execute 'reset role';
  insert into pg_temp.r values ('prazo_longo', v);
end $$;
select pg_temp.sair();
select is((select (valor ->> 'termina_em')::date from pg_temp.r where chave = 'prazo_longo'),
          pg_temp.hoje() + 40,
  'D2: quem pede um lote MAIS LONGO continua com o prazo que pediu (greatest, não coalesce)');


-- =====================================================================
-- 2. D7 — lote fantasma: contar antes de criar, desfazer se nascer vazio
-- =====================================================================
insert into pg_temp.base values ('lotes', pg_temp.n_lotes());
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000015a1', 'sdr');
  -- Categoria 916 não tem organização nenhuma: nenhum candidato elegível.
  v := public.montar_lote('C15 fantasma', pg_temp.funil('fornecedor'), 'frio',
         (select id from public.call_scripts where slug = 'captacao_v1' and is_published),
         array[916], 'prioridade', 25);
  execute 'reset role';
  insert into pg_temp.r values ('fantasma', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'montado' from pg_temp.r where chave = 'fantasma'), 'false',
  'D7: montagem sem candidato nenhum é recusa, não lote vazio');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'fantasma'), 'sem_candidatos',
  'D7: com o motivo nomeado, para a tela virar frase em português');
select is((select valor ->> 'entraram' from pg_temp.r where chave = 'fantasma'), '0',
  'D7: e o recibo diz que ninguém entrou');
select is(pg_temp.n_lotes(), (select n from pg_temp.base where chave = 'lotes'),
  'D7: NENHUMA linha nova em call_batches — o lote fantasma não existe mais (delta = 0)');


-- =====================================================================
-- 3. D8 — o motivo verdadeiro aparece: suprimido antes de sem_negocio_aberto
-- =====================================================================
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000015a1', 'sdr');
  v := public.montar_lote('C15 motivos', pg_temp.funil('fornecedor'), 'frio',
         (select id from public.call_scripts where slug = 'captacao_v1' and is_published),
         array[915], 'prioridade', 1);
  execute 'reset role';
  insert into pg_temp.r values ('motivos', v);
end $$;
select pg_temp.sair();
select is((select (valor -> 'excluidos' ->> 'nao_contatar')::int from pg_temp.r where chave = 'motivos'), 2,
  'D8: quem pediu opt-out e quem está em do_not_contact são contados como "nao_contatar"');
select is((select (valor -> 'excluidos' ->> 'suprimido')::int from pg_temp.r where chave = 'motivos'), 1,
  'D8: e quem está só na suppression_list é contado como "suprimido"');
select is((select coalesce((valor -> 'excluidos' ->> 'sem_negocio_aberto')::int, 0)
             from pg_temp.r where chave = 'motivos'), 0,
  'D8: nenhum dos três se esconde atrás de "sem negócio aberto" (era o defeito: o opt-out FECHA o negócio)');
select is(
  (select c.motivo from app.call_candidates(pg_temp.funil('fornecedor'), 'frio', array[915],
                                            'prioridade', 1) c
    where c.organization_id = 'c0000000-0000-4000-8000-000000001591'),
  'nao_contatar',
  'D8: a organização que pediu opt-out sai com o motivo de quem pediu para sair, não com "sem negócio aberto"');
select is(
  (select c.motivo from app.call_candidates(pg_temp.funil('fornecedor'), 'frio', array[915],
                                            'prioridade', 1) c
    where c.organization_id = 'c0000000-0000-4000-8000-000000001593'),
  'suprimido',
  'D8: e a que está na suppression_list COM o negócio já fechado sai como "suprimido" (a ordem do case)');


-- =====================================================================
-- 4. D6 — o opt-out tem porta própria, e nenhuma recusa o engole
-- =====================================================================
select has_function('public', 'marcar_nao_ligar_mais', array['uuid','uuid','uuid','text'],
  'public.marcar_nao_ligar_mais existe');
select has_function('public', 'devolver_item_do_lote', array['uuid','text','boolean'],
  'public.devolver_item_do_lote aceita o pedido de opt-out');
select ok(not has_function_privilege('anon', 'public.marcar_nao_ligar_mais(uuid,uuid,uuid,text)', 'execute'),
  'privilégio: anon não registra opt-out de ninguém');
select ok(not has_function_privilege('anon',
  'app.registrar_optout_de_contato(uuid,uuid,text,app.channel)', 'execute'),
  'privilégio: anon não executa a função que grava o consentimento');

-- ---------- 4.1 a porta independente: só o item, sem roteiro e sem desfecho ----------
do $$
declare v_lote uuid; v_item uuid; v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000015a1', 'sdr');
  v_lote := ((select valor ->> 'lote_id' from pg_temp.r where chave = 'prazo'))::uuid;
  v := public.proximo_da_fila(v_lote);
  v_item := (v -> 'item' ->> 'id')::uuid;
  execute 'reset role';
  insert into pg_temp.r values ('porta_item', jsonb_build_object('item_id', v_item, 'org',
                                 v -> 'item' -> 'organization_id'));
end $$;
select pg_temp.sair();
insert into pg_temp.base
  select 'consent_porta', pg_temp.n_consent(((select valor ->> 'org' from pg_temp.r where chave = 'porta_item'))::uuid);

do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000015a1', 'sdr');
  v := public.marcar_nao_ligar_mais(
         ((select valor ->> 'item_id' from pg_temp.r where chave = 'porta_item'))::uuid,
         null, null, 'me tira dessa lista');
  execute 'reset role';
  insert into pg_temp.r values ('porta1', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'porta1'), 'true',
  'D6: a porta independente aceita o pedido no meio da ligação, sem desfecho nenhum');
select is(pg_temp.n_consent(((select valor ->> 'org' from pg_temp.r where chave = 'porta_item'))::uuid),
          (select n from pg_temp.base where chave = 'consent_porta') + 1,
  'D6: e grava exatamente UM consent_events a mais para o alvo (delta = 1)');
select is((select do_not_contact from public.organizations
            where id = ((select valor ->> 'org' from pg_temp.r where chave = 'porta_item'))::uuid),
  true, 'D6: o gatilho app.consent_apply marcou do_not_contact');
select ok(app.is_suppressed((select phone_e164 from public.organizations
            where id = ((select valor ->> 'org' from pg_temp.r where chave = 'porta_item'))::uuid)),
  'D6: e o telefone entrou na suppression_list (guardrail central do CLAUDE.md)');
select is(pg_temp.status_do_item(((select valor ->> 'item_id' from pg_temp.r where chave = 'porta_item'))::uuid),
  'devolvido', 'D6: o item sai da fila do lote na hora — ninguém liga de novo para quem pediu para sair');

-- Idempotência: a Heloísa clica duas vezes; a prova de LGPD não vira duas provas.
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000015a1', 'sdr');
  v := public.marcar_nao_ligar_mais(
         ((select valor ->> 'item_id' from pg_temp.r where chave = 'porta_item'))::uuid,
         null, null, 'me tira dessa lista');
  execute 'reset role';
  insert into pg_temp.r values ('porta2', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'porta2'), 'true',
  'D6: clicar de novo continua devolvendo ok (o guardrail está em vigor)');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'porta2'), 'ja_registrado',
  'D6: e diz que já estava registrado');
select is(pg_temp.n_consent(((select valor ->> 'org' from pg_temp.r where chave = 'porta_item'))::uuid),
          (select n from pg_temp.base where chave = 'consent_porta') + 1,
  'D6: sem duplicar o consent_events (consent_events é append-only: duplicata é prova suja)');

-- Papel que não escreve não registra opt-out (a porta nova não é um buraco novo).
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000015a2', 'leitura');
  v := public.marcar_nao_ligar_mais(null, 'c0000000-0000-4000-8000-000000001592', null, 'tentativa');
  execute 'reset role';
  insert into pg_temp.r values ('porta_leitura', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'porta_leitura'), 'sem_permissao',
  'D6: papel de leitura não registra opt-out — a porta nova repete a política, não a afrouxa');
select is(pg_temp.n_consent('c0000000-0000-4000-8000-000000001592'), 0,
  'D6: e nada foi gravado na tentativa recusada');

-- ---------- 4.2 A REGRESSÃO: a recusa que engolia o pedido ----------
-- "Sem interesse" sem motivo de perda é a recusa mais comum da tabulação — e é o
-- caminho do próprio nó `fim_optout` do roteiro, cuja nota manda marcar "não me
-- ligue mais". Medido antes do conserto: {tabulado:false,
-- motivo:"motivo_de_perda_obrigatorio"} e consent_events = 0, do_not_contact = false.
do $$
declare v_lote uuid; v_item uuid; v_org uuid; v_ch jsonb; v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000015a1', 'sdr');
  v_lote := ((select valor ->> 'lote_id' from pg_temp.r where chave = 'prazo'))::uuid;
  v      := public.proximo_da_fila(v_lote);
  v_item := (v -> 'item' ->> 'id')::uuid;
  v_org  := (v -> 'item' ->> 'organization_id')::uuid;
  v_ch   := public.iniciar_chamada(v_item);
  v := public.tabular_chamada(gen_random_uuid(), (v_ch -> 'chamada' ->> 'id')::uuid, v_item,
         'atendida_humano', 'decisor', pg_temp.desfecho('lig_sem_interesse'),
         array['abertura','gancho_fornecedor','fim_optout'], 42,
         'me tira dessa lista, não me ligue mais',
         '{}'::jsonb, null, null, null, null, true);
  execute 'reset role';
  insert into pg_temp.r values ('recusa', v || jsonb_build_object('_org', v_org, '_item', v_item));
end $$;
select pg_temp.sair();
select is((select valor ->> 'tabulado' from pg_temp.r where chave = 'recusa'), 'false',
  'D6/regressão: "Sem interesse" sem motivo de perda continua sendo recusado (nada foi afrouxado)');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'recusa'), 'motivo_de_perda_obrigatorio',
  'D6/regressão: e com o mesmo motivo de antes');
select is((select valor ->> 'optout_registrado' from pg_temp.r where chave = 'recusa'), 'true',
  'D6/regressão: MAS o pedido de opt-out foi registrado — a recusa não o engole mais');
select is(pg_temp.n_consent(((select valor ->> '_org' from pg_temp.r where chave = 'recusa'))::uuid), 1,
  'D6/regressão: o consent_events está lá (era 0 antes do conserto)');
select is((select do_not_contact from public.organizations
            where id = ((select valor ->> '_org' from pg_temp.r where chave = 'recusa'))::uuid),
  true, 'D6/regressão: do_not_contact marcado (era false antes do conserto)');
select ok(app.is_suppressed((select phone_e164 from public.organizations
            where id = ((select valor ->> '_org' from pg_temp.r where chave = 'recusa'))::uuid)),
  'D6/regressão: e o telefone na suppression_list (era ausente antes do conserto)');

-- ---------- 4.3 tabulação ACEITA com opt-out: as duas coisas valem ----------
do $$
declare v_lote uuid; v_item uuid; v_org uuid; v_ch jsonb; v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000015a1', 'sdr');
  v_lote := ((select valor ->> 'lote_id' from pg_temp.r where chave = 'prazo'))::uuid;
  v      := public.proximo_da_fila(v_lote);
  v_item := (v -> 'item' ->> 'id')::uuid;
  v_org  := (v -> 'item' ->> 'organization_id')::uuid;
  v_ch   := public.iniciar_chamada(v_item);
  v := public.tabular_chamada(gen_random_uuid(), (v_ch -> 'chamada' ->> 'id')::uuid, v_item,
         'atendida_humano', 'decisor', pg_temp.desfecho('lig_agora_nao'),
         array['abertura','forn_proposta','fim_agora_nao'], 61,
         'agora não, e não me liga mais',
         '{}'::jsonb, null, null, null, null, true);
  execute 'reset role';
  insert into pg_temp.r values ('aceita', v || jsonb_build_object('_org', v_org, '_item', v_item));
end $$;
select pg_temp.sair();
select is((select valor ->> 'tabulado' from pg_temp.r where chave = 'aceita'), 'true',
  'D6: com desfecho válido a tabulação passa...');
select is((select valor ->> 'optout_registrado' from pg_temp.r where chave = 'aceita'), 'true',
  '...e o opt-out pedido na mesma chamada também é registrado (as duas coisas valem)');
select is((select valor ->> 'contato_suprimido' from pg_temp.r where chave = 'aceita'), 'true',
  'D6: o retorno diz à tela que o contato ficou suprimido');
select is(pg_temp.status_do_item(((select valor ->> '_item' from pg_temp.r where chave = 'aceita'))::uuid),
  'devolvido', 'D6: e o item sai do lote em vez de voltar para a fila');
select ok(pg_temp.etapa_e_optout(((select valor ->> '_org' from pg_temp.r where chave = 'aceita'))::uuid),
  'D6: o negócio termina na etapa de OPT-OUT do funil — é ela que a tela usa para dizer "não contatar"');
select is((select valor ->> 'volta_para_fila' from pg_temp.r where chave = 'aceita'), 'false',
  'D6: quem pediu para sair nunca volta para a fila, mesmo com tentativas sobrando');

-- ---------- 4.4 devolver sem tabular também ouve o pedido ----------
do $$
declare v_lote uuid; v_item uuid; v_org uuid; v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000015a1', 'sdr');
  v_lote := ((select valor ->> 'lote_id' from pg_temp.r where chave = 'prazo'))::uuid;
  v      := public.proximo_da_fila(v_lote);
  v_item := (v -> 'item' ->> 'id')::uuid;
  v_org  := (v -> 'item' ->> 'organization_id')::uuid;
  perform public.iniciar_chamada(v_item);
  v := public.devolver_item_do_lote(v_item, 'desligou dizendo para parar de ligar', true);
  execute 'reset role';
  insert into pg_temp.r values ('devolve', v || jsonb_build_object('_org', v_org, '_item', v_item));
end $$;
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'devolve'), 'true',
  'D6: devolver o item sem tabular continua funcionando');
select is((select valor ->> 'optout_registrado' from pg_temp.r where chave = 'devolve'), 'true',
  'D6: e aceita o pedido de opt-out de quem desligou antes da tabulação');
select is((select valor ->> 'item_status' from pg_temp.r where chave = 'devolve'), 'devolvido',
  'D6: o item sai do lote em vez de voltar à fila (a devolução consulta a supressão que acabou de chegar)');
select is(pg_temp.n_consent(((select valor ->> '_org' from pg_temp.r where chave = 'devolve'))::uuid), 1,
  'D6: com o consent_events gravado');


-- =====================================================================
-- 5. D4 — quem faz a pergunta do volume é quem guarda a resposta
-- =====================================================================
select results_eq(
  $$select n ->> 'id', n ->> 'tipo', n ->> 'campo'
      from public.call_scripts s, jsonb_array_elements(s.arvore) n
     where s.slug = 'captacao_v1' and n ->> 'id' = 'forn_explica'$$,
  $$values ('forn_explica'::text, 'captura'::text, 'eventos_por_mes'::text)$$,
  'D4: o nó que pergunta "quantos eventos por mês" é captura e guarda em eventos_por_mes');
select results_eq(
  $$select n ->> 'id', n ->> 'tipo', n ->> 'campo'
      from public.call_scripts s, jsonb_array_elements(s.arvore) n
     where s.slug = 'captacao_v1' and n ->> 'id' = 'prod_explica'$$,
  $$values ('prod_explica'::text, 'captura'::text, 'eventos_por_ano'::text)$$,
  'D4: o nó que pergunta "quantos eventos por ano" é captura e guarda em eventos_por_ano');
select is((select n ->> 'campo' from public.call_scripts s, jsonb_array_elements(s.arvore) n
            where s.slug = 'captacao_v1' and n ->> 'id' = 'forn_qualifica'),
  'prioridade_do_dono',
  'D4: "mais pedido ou pedido melhor" não é volume — vai para prioridade_do_dono');
select is((select n ->> 'campo' from public.call_scripts s, jsonb_array_elements(s.arvore) n
            where s.slug = 'captacao_v1' and n ->> 'id' = 'prod_qualifica'),
  'maior_aperto',
  'D4: "qual é o seu maior aperto" não é volume — vai para maior_aperto');
select is((select count(*)::int from public.call_scripts s, jsonb_array_elements(s.arvore) n
            where n ->> 'tipo' = 'captura' and coalesce(n ->> 'campo', '') = ''), 0,
  'D4: nenhum nó de captura ficou sem campo em roteiro nenhum');
select is((select count(*)::int from public.call_scripts s, jsonb_array_elements(s.arvore) n
            where n ->> 'campo' in ('eventos_por_mes','eventos_por_ano')
              and n ->> 'texto' !~* 'quantos eventos'), 0,
  'D4: só nó que pergunta "quantos eventos" grava em eventos_por_mes/eventos_por_ano');
select is((select cardinality(app.validar_roteiro(s.arvore)) from public.call_scripts s
            where s.slug = 'captacao_v1'), 0,
  'D4: e a árvore corrigida continua válida para app.validar_roteiro');

-- devolve o feriado de hoje, se havia (a transação some, mas o arquivo não mente)
insert into public.holidays select * from feriado_de_hoje;

select * from finish();
rollback;

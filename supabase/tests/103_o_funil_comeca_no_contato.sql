-- =====================================================================
-- pgTAP — O funil começa no contato (migração 20261007100000)
--
-- Limpeza do funil de 07/10/2026: "Prospectado" e "Identificado" deixam de ser
-- coluna (viram a etapa de ENTRADA, fora do quadro); "Em conversa" e
-- "Autorizou" saem do funil (etapa APOSENTADA). Este arquivo prova:
--
--   1. AS DUAS MARCAS existem, e uma etapa não pode ser as duas;
--   2. APOSENTAR leva quem estava na etapa para a sucessora, com o motivo no
--      histórico, e não apaga nada — é o mesmo código que roda em produção;
--   3. ETAPA APOSENTADA NÃO RECEBE NEGÓCIO, por caminho nenhum;
--   4. O QUADRO começa em Contatado e não conta quem ainda não foi contatado;
--   5. O RELATÓRIO DE FUNIL lê as mesmas linhas, e quem passou pela etapa
--      aposentada continua contando como "chegou até aqui ou adiante";
--   6. A PLANILHA e a IA não devolvem ninguém a etapa que saiu;
--   7. O CATÁLOGO DE DESFECHOS só aponta para etapa que existe.
--
-- O banco de teste nasce da seed nova, que já não cria "Em conversa". Para
-- exercitar a aposentadoria o arquivo RECRIA a etapa como ela existe em
-- produção (posição 4, morno), dentro da transação.
--
-- Roda em transação e desfaz tudo. As contagens do quadro e do relatório são
-- recortadas pelo nome das fichas daqui ("F103"), porque o banco pode ter
-- operação dentro.
-- =====================================================================
begin;
select plan(39);

-- ---------- utilitários ----------
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
create function pg_temp.etapa_de(p_deal uuid) returns text language sql as $$
  select s.slug from public.deals d join public.stages s on s.id = d.stage_id where d.id = p_deal
$$;
create function pg_temp.org(p text) returns uuid language sql immutable as $$
  select ('c0000000-0000-4000-8000-0000000103' || p)::uuid
$$;
create function pg_temp.neg(p text) returns uuid language sql immutable as $$
  select ('e0000000-0000-4000-8000-0000000103' || p)::uuid
$$;
create function pg_temp.gil() returns uuid language sql immutable as $$
  select 'a0000000-0000-4000-8000-000000010301'::uuid
$$;
-- Colunas e total do quadro, só das fichas deste arquivo.
create function pg_temp.quadro() returns jsonb language sql as $$
  select public.pipeline_board(pg_temp.funil('fornecedor'), false, null, 'f103')
$$;
create function pg_temp.total_do_quadro() returns int language sql as $$
  select coalesce(sum((s ->> 'total')::int), 0)::int
    from jsonb_array_elements(pg_temp.quadro() -> 'stages') s
$$;

insert into public.allowed_users (email, role, note) values
  ('f103.g@teste.local', 'gestor', 'pgTAP 103');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gil(), 'f103.g@teste.local', '{"full_name":"Gil Gestor"}');

-- =====================================================================
-- 1. As duas marcas
-- =====================================================================
select has_column('public', 'stages', 'is_entry',   'stages.is_entry existe');
select has_column('public', 'stages', 'retired_at', 'stages.retired_at existe');
select throws_ok(
  $$update public.stages set retired_at = now() where is_entry$$,
  '23514', null, 'uma etapa de entrada não pode ser aposentada por UPDATE direto (check)');
-- É nesta regra que `quick_create_organization` e `app.promover_candidato` se
-- apoiam: o negócio nasce na primeira etapa por posição que não é ganho nem perda.
select is(
  (select bool_and(x.is_entry) from (
     select distinct on (st.pipeline_id) st.is_entry
       from public.stages st join public.pipelines p on p.id = st.pipeline_id
      where p.slug in ('fornecedor', 'produtor') and not st.is_lost and not st.is_won
      order by st.pipeline_id, st.position) x),
  true, 'a etapa em que o negócio nasce (a primeira por posição) é a de entrada, nos dois funis');

-- =====================================================================
-- 2. Aposentar
-- =====================================================================
-- "Em conversa" como está em produção.
insert into public.stages (pipeline_id, slug, name, position, temperature, sla_hours)
values (pg_temp.funil('fornecedor'), 'em_conversa', 'Em conversa', 4, 'morno', 24);

--   01, 02  estavam em "Em conversa"            → vão para Respondeu
--   03      ainda em Prospectado                → fica onde está, fora do quadro
--   04      Contatado → Em conversa → Apresentação realizada (pulou Reunião
--           marcada): passou pela etapa que vai sair, e não está mais nela
insert into public.organizations (id, name, phone_e164, source_id)
select pg_temp.org(lpad(i::text, 2, '0')), 'F103 Parceiro ' || i,
       '+55849991030' || i, (select id from public.sources where slug = 'captura_campo')
  from generate_series(1, 5) i;
insert into public.deals (id, organization_id, pipeline_id, stage_id) values
  (pg_temp.neg('01'), pg_temp.org('01'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'em_conversa')),
  (pg_temp.neg('02'), pg_temp.org('02'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'em_conversa')),
  (pg_temp.neg('03'), pg_temp.org('03'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado')),
  (pg_temp.neg('04'), pg_temp.org('04'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'contatado'));
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'em_conversa')            where id = pg_temp.neg('04');
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'apresentacao_realizada') where id = pg_temp.neg('04');

select is(app.aposentar_etapa('fornecedor', 'em_conversa', 'respondeu'), 2,
  'aposentar devolve quantos negócios mudaram de etapa');
select is(pg_temp.etapa_de(pg_temp.neg('01')), 'respondeu', 'quem estava em "Em conversa" foi para "Respondeu"');
select is(pg_temp.etapa_de(pg_temp.neg('02')), 'respondeu', 'os dois');
select is(pg_temp.etapa_de(pg_temp.neg('04')), 'apresentacao_realizada',
  'quem só PASSOU pela etapa não é tocado');
select results_eq(
  $$select sf.slug, st.slug, h.changed_by, h.reason
      from public.deal_stage_history h
      join public.stages sf on sf.id = h.from_stage_id
      join public.stages st on st.id = h.to_stage_id
     where h.deal_id = pg_temp.neg('01') order by h.id desc limit 1$$,
  $$values ('em_conversa'::text, 'respondeu'::text, null::uuid,
            'A etapa "Em conversa" saiu do funil; quem estava nela foi para "Respondeu"'::text)$$,
  'o histórico guarda de onde veio, para onde foi e o porquê — sem autor (Sistema)');
select isnt((select retired_at from public.stages where id = pg_temp.etapa('fornecedor', 'em_conversa')),
  null, 'a etapa fica marcada como aposentada');
select is((select count(*)::int from public.stages where slug = 'em_conversa'), 1,
  'e a linha NÃO é apagada: o histórico aponta para ela');
select is((select from_stage_name from public.deal_stage_timeline(pg_temp.neg('01')) limit 1),
  'Em conversa', 'a linha do tempo da ficha continua sabendo o nome da etapa que saiu');

select is(app.aposentar_etapa('fornecedor', 'em_conversa', 'respondeu'), 0,
  'aposentar de novo não faz nada (a migração é reaplicável)');
select is(app.aposentar_etapa('fornecedor', 'etapa_que_nunca_existiu', 'respondeu'), 0,
  'etapa que não existe devolve 0, sem erro: é o banco novo, que nasce sem ela');
select throws_ok(
  $$select app.aposentar_etapa('fornecedor', 'prospectado', 'contatado')$$,
  '23514', null, 'a etapa de entrada não se aposenta');
select throws_ok(
  $$select app.aposentar_etapa('fornecedor', 'contatado', 'etapa_que_nunca_existiu')$$,
  '23503', null, 'sem sucessora válida, nada é aposentado');
select throws_ok(
  $$select app.aposentar_etapa('fornecedor', 'contatado', 'em_conversa')$$,
  '23503', null, 'e etapa aposentada não serve de sucessora');
select is((select retired_at from public.stages where id = pg_temp.etapa('fornecedor', 'contatado')),
  null, 'a recusa não deixou a etapa pela metade');

select pg_temp.entrar(pg_temp.gil(), 'gestor');
select throws_ok(
  $$select app.aposentar_etapa('fornecedor', 'contatado', 'respondeu')$$,
  '42501', null, 'ninguém aposenta etapa pela API: a função é só de migração');
select pg_temp.sair();

-- =====================================================================
-- 3. Etapa aposentada não recebe negócio
-- =====================================================================
select throws_ok(
  format($$update public.deals set stage_id = %s where id = %L$$,
         pg_temp.etapa('fornecedor', 'em_conversa'), pg_temp.neg('03')),
  '23514', null, 'UPDATE direto para etapa aposentada é recusado pelo gatilho');
select throws_ok(
  format($$insert into public.deals (organization_id, pipeline_id, stage_id) values (%L, %s, %s)$$,
         pg_temp.org('05'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'em_conversa')),
  '23514', null, 'e negócio não nasce nela');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
-- Com próxima ação, para o pedido passar pelas recusas com nome do `move_deal`
-- e chegar ao UPDATE: é ali que o gatilho barra.
select throws_ok(
  format($$select public.move_deal(%L, %s, null, null, null,
                  jsonb_build_object('kind', 'call', 'label', 'Ligar para confirmar',
                                     'at', now() + interval '1 day'))$$,
         pg_temp.neg('04'), pg_temp.etapa('fornecedor', 'em_conversa')),
  '23514', null, 'move_deal com o id de uma etapa aposentada (aba antiga aberta) não passa');
select pg_temp.sair();
select is(pg_temp.etapa_de(pg_temp.neg('04')), 'apresentacao_realizada', 'e o cartão não se mexeu');
select is((select count(*)::int from app.stage_for(pg_temp.funil('fornecedor'), 'em_conversa')), 0,
  'stage_for nunca resolve para etapa aposentada: desfecho antigo vira "etapa fora do funil", não exceção');

-- =====================================================================
-- 4. O quadro começa em Contatado
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.quadro() -> 'stages') s
    where s ->> 'slug' in ('prospectado', 'em_conversa')),
  0, 'quadro: nem a etapa de entrada nem a aposentada são coluna');
select is(
  (select s ->> 'slug' from jsonb_array_elements(pg_temp.quadro() -> 'stages') s
    order by (s ->> 'position')::int limit 1),
  'contatado', 'quadro: a primeira coluna é Contatado');
select is(pg_temp.total_do_quadro(), 3,
  'quadro: conta quem já foi contatado (01, 02 e 04) e não quem ainda está em Prospectado (03)');
select is(
  (select count(*)::int
     from jsonb_array_elements(public.pipeline_board(pg_temp.funil('produtor')) -> 'stages') s
    where s ->> 'slug' = 'identificado'),
  0, 'quadro: no funil produtor a entrada é Identificado, e também não é coluna');
select pg_temp.sair();

-- Quem sobe o negócio da entrada para Contatado é a primeira mensagem
-- (`app.wa_envio_no_funil`, provado no 46). Aqui, só o efeito no quadro.
update public.deals set stage_id = pg_temp.etapa('fornecedor', 'contatado') where id = pg_temp.neg('03');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(pg_temp.total_do_quadro(), 4, 'quadro: saiu da entrada, entrou na conta');

-- =====================================================================
-- 5. O relatório de funil lê as mesmas linhas
-- =====================================================================
select is(
  (select count(*)::int from public.relatorio_funil(current_date, current_date, pg_temp.funil('fornecedor'))
    where etapa_slug in ('prospectado', 'em_conversa')),
  0, 'relatório: a entrada e a aposentada não são linha');
select is(
  (select etapa_slug from public.relatorio_funil(current_date, current_date, pg_temp.funil('fornecedor'))
    order by posicao limit 1),
  'contatado', 'relatório: a primeira linha é Contatado');
-- 01 e 02 foram levados a Respondeu; 04 passou por "Em conversa" (posição 4, à
-- frente de Respondeu) e está em Apresentação realizada. Os três chegaram a
-- Respondeu ou adiante — e o 04 só entra na conta porque a etapa aposentada
-- continua valendo como "adiante".
select cmp_ok(
  (select chegaram_ate from public.relatorio_funil(current_date, current_date, pg_temp.funil('fornecedor'))
    where etapa_slug = 'respondeu'),
  '>=', 3, 'relatório: quem passou pela etapa aposentada continua contando como "chegou a Respondeu ou adiante"');
select ok(
  (select bool_and(conversao_etapa <= 100) and count(*) > 0
     from public.relatorio_funil(current_date, current_date, pg_temp.funil('fornecedor'))
    where conversao_etapa is not null),
  'relatório: há conversão etapa a etapa para conferir, e nenhuma passa de 100% (o 04 pulou Reunião marcada)');
select pg_temp.sair();

-- =====================================================================
-- 6. A planilha e a IA
-- =====================================================================
select isnt(
  (app.importacao_etapa('Em conversa', pg_temp.funil('fornecedor')) ->> 'id')::int,
  pg_temp.etapa('fornecedor', 'em_conversa'),
  'planilha: uma coluna "Etapa" que diga "Em conversa" não casa com a etapa aposentada');
select is(
  app.importacao_etapa('Prospectado', pg_temp.funil('fornecedor')) ->> 'nome',
  'Prospectado', 'planilha: "Prospectado" continua casando — a etapa de entrada existe');

-- A IA lê a lista de etapas pela conversa. A conversa nasce pelo caminho real
-- (uma mensagem que chega) e é ligada ao negócio 01 à mão.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999910300"')
 where key = 'whatsapp.envio';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
set role service_role;
select public.wa_entrada_registrar('wamid.F103.1', '+5584999910300', '+5584999910399', 'text', 'Oi, tudo bem?');
reset role;
update public.conversations
   set organization_id = pg_temp.org('01'), deal_id = pg_temp.neg('01')
 where peer_phone_e164 = '+5584999910399';
select is(
  (select count(*)::int
     from jsonb_array_elements_text(
            app.ia_entrada_da_ficha((select id from public.conversations
                                      where peer_phone_e164 = '+5584999910399')) -> 'etapas_validas') e
    where e in ('Prospectado', 'Em conversa')),
  0, 'IA: a lista de etapas que o modelo pode sugerir não tem a entrada nem a aposentada');
select is(
  app.ia_entrada_da_ficha((select id from public.conversations
                            where peer_phone_e164 = '+5584999910399')) -> 'etapas_validas' ->> 0,
  'Contatado', 'IA: e começa em Contatado');

-- =====================================================================
-- 7. O catálogo de desfechos
-- =====================================================================
select is(
  (select count(*)::int from public.interaction_outcomes o
    where o.target_stage_slug is not null
      and not exists (select 1 from app.stage_for(pg_temp.funil('fornecedor'), o.target_stage_slug))),
  0, 'desfechos: todo destino resolve para uma etapa viva do funil fornecedor');
select results_eq(
  $$select slug, target_stage_slug from public.interaction_outcomes
     where slug in ('lig_interessado', 'vis_decisor_interessado', 'reu_autorizou') order by slug$$,
  $$values ('lig_interessado'::text, 'respondeu'::text),
           ('reu_autorizou', 'cadastro_em_andamento'),
           ('vis_decisor_interessado', 'respondeu')$$,
  'desfechos: "Interessado" leva a Respondeu e "Realizada, autorizou" a Cadastro em andamento');

select * from finish();
rollback;

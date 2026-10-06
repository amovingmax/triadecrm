-- =====================================================================
-- pgTAP — O dia de quem ligou (migração 20261006120000)
--
-- Pivô de 06/10/2026: a gestão quer "um relatório exato sobre tudo que ocorreu
-- para cada pessoa que ligou nesse dia", e quem liga quer ver o próprio dia.
-- Este arquivo prova:
--
--   1. A CONTA BATE: feitas, atendidas, não atendidas, sem resultado, tempo
--      falado, contatos e reuniões, tirados de public.call_attempts;
--   2. O DIA É O DE NATAL: a ligação das 23:30 de ontem não entra em hoje;
--   3. A GESTÃO VÊ TODOS, e a lista ligação a ligação só vem pedindo UMA pessoa;
--   4. QUEM LIGA SÓ VÊ O PRÓPRIO DIA — pedir o de outro é recusado;
--   5. QUEM NÃO LIGOU aparece zerado quando perguntam por ele, e não some;
--   6. PAPEL FORA DOS TRÊS não vê nada.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(27);

insert into public.allowed_users (email, role, note) values
  ('d100.g@teste.local', 'gestor', 'pgTAP 100'),
  ('d100.a@teste.local', 'sdr', 'pgTAP 100'),
  ('d100.b@teste.local', 'sdr', 'pgTAP 100'),
  ('d100.l@teste.local', 'leitura', 'pgTAP 100');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000010001'::uuid, 'd100.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000010002'::uuid, 'd100.a@teste.local', '{"full_name":"Ana Freela"}'),
  ('a0000000-0000-4000-8000-000000010003'::uuid, 'd100.b@teste.local', '{"full_name":"Bia Freela"}'),
  ('a0000000-0000-4000-8000-000000010004'::uuid, 'd100.l@teste.local', '{"full_name":"Leo Leitura"}');

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
create function pg_temp.hoje() returns date language sql stable as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;
-- A hora de HOJE em Natal, como carimbo: `hoje_as('10:05')`.
create function pg_temp.hoje_as(p_hora time) returns timestamptz language sql stable as $$
  select (pg_temp.hoje() + p_hora) at time zone 'America/Fortaleza'
$$;
create function pg_temp.ana() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010002'::uuid $$;
create function pg_temp.bia() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010003'::uuid $$;
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010001'::uuid $$;

-- ---------------------------------------------------------------------
-- O dia: um lote da Ana com quatro contatos, um da Bia com um.
-- ---------------------------------------------------------------------
create temp table t100(chave text primary key, valor uuid);
grant select on t100 to authenticated;
do $$
declare
  v_funil  int  := (select id from public.pipelines where slug = 'fornecedor');
  v_script uuid; v_versao int;
  v_lote_a uuid; v_lote_b uuid;
  v_org uuid; v_item uuid; v_ativ uuid;
  v_nomes text[] := array['Buffet Alfa', 'Decor Beta', 'Som Gama', 'Foto Delta', 'Flor Épsilon'];
  i int;
begin
  select id, versao into v_script, v_versao from public.call_scripts where is_published order by versao desc limit 1;

  insert into public.call_batches (nome, owner_id, status, pipeline_id, temperature_origin,
                                   script_id, script_version, starts_on, ends_on)
  values ('Lote da Ana — pgTAP 100', pg_temp.ana(), 'ativo', v_funil, 'frio', v_script, v_versao,
          pg_temp.hoje() - 1, pg_temp.hoje() + 1) returning id into v_lote_a;
  insert into public.call_batches (nome, owner_id, status, pipeline_id, temperature_origin,
                                   script_id, script_version, starts_on, ends_on)
  values ('Lote da Bia — pgTAP 100', pg_temp.bia(), 'ativo', v_funil, 'frio', v_script, v_versao,
          pg_temp.hoje() - 1, pg_temp.hoje() + 1) returning id into v_lote_b;

  for i in 1..5 loop
    insert into public.organizations (name, phone_e164, source_id, collector)
    values (v_nomes[i], '+558499910010' || i,
            (select id from public.sources where slug = 'planilha'), 'pgtap100')
    returning id into v_org;
    insert into public.call_batch_items (batch_id, organization_id, phone_e164, position)
    values (case when i = 5 then v_lote_b else v_lote_a end, v_org, '+558499910010' || i, i)
    returning id into v_item;
    insert into t100 values ('org' || i, v_org), ('item' || i, v_item);
  end loop;
  insert into t100 values ('lote_a', v_lote_a), ('lote_b', v_lote_b);

  -- A atividade que a tabulação grava: é dela que vêm a observação e o "com quem".
  insert into public.activities (type, channel, organization_id, user_id, occurred_at, outcome_id,
                                 body, metadata)
  values ('call', 'phone', (select valor from t100 where chave = 'org1'), pg_temp.ana(),
          pg_temp.hoje_as('10:03'),
          (select id from public.interaction_outcomes where slug = 'lig_reuniao_marcada'),
          'Quer reunião na terça de manhã', '{"com_quem": "decisor"}'::jsonb)
  returning id into v_ativ;
  insert into t100 values ('ativ1', v_ativ);
end $$;

create function pg_temp.v(p text) returns uuid language sql stable as $$
  select valor from t100 where chave = p
$$;
create function pg_temp.desfecho(p_slug text) returns int language sql stable as $$
  select id from public.interaction_outcomes where slug = p_slug
$$;

-- ANA, hoje: cinco tentativas.
insert into public.call_attempts (item_id, batch_id, organization_id, user_id, iniciada_em,
                                  atendida_em, encerrada_em, duracao_seg, resultado, outcome_id, activity_id) values
  -- 10:00 atendeu, reunião marcada, 3 min
  (pg_temp.v('item1'), pg_temp.v('lote_a'), pg_temp.v('org1'), pg_temp.ana(), pg_temp.hoje_as('10:00'),
   pg_temp.hoje_as('10:00'), pg_temp.hoje_as('10:03'), 180, 'atendida_humano',
   pg_temp.desfecho('lig_reuniao_marcada'), pg_temp.v('ativ1')),
  -- 10:05 não atendeu
  (pg_temp.v('item2'), pg_temp.v('lote_a'), pg_temp.v('org2'), pg_temp.ana(), pg_temp.hoje_as('10:05'),
   null, pg_temp.hoje_as('10:06'), 0, 'nao_atendeu', null, null),
  -- 10:10 atendeu, sem interesse, 1 min
  (pg_temp.v('item3'), pg_temp.v('lote_a'), pg_temp.v('org3'), pg_temp.ana(), pg_temp.hoje_as('10:10'),
   pg_temp.hoje_as('10:10'), pg_temp.hoje_as('10:11'), 60, 'atendida_humano',
   pg_temp.desfecho('lig_sem_interesse'), null),
  -- 10:20 de novo o segundo contato: caixa postal
  (pg_temp.v('item2'), pg_temp.v('lote_a'), pg_temp.v('org2'), pg_temp.ana(), pg_temp.hoje_as('10:20'),
   null, pg_temp.hoje_as('10:21'), 0, 'caixa_postal', null, null),
  -- 10:30 começou e não tabulou
  (pg_temp.v('item4'), pg_temp.v('lote_a'), pg_temp.v('org4'), pg_temp.ana(), pg_temp.hoje_as('10:30'),
   null, null, null, null, null, null);

-- ANA, ontem às 23:30 de Natal: é de ontem.
insert into public.call_attempts (item_id, batch_id, organization_id, user_id, iniciada_em,
                                  encerrada_em, duracao_seg, resultado)
values (pg_temp.v('item1'), pg_temp.v('lote_a'), pg_temp.v('org1'), pg_temp.ana(),
        pg_temp.hoje_as('00:00') - interval '30 minutes',
        pg_temp.hoje_as('00:00') - interval '29 minutes', 0, 'ocupado');

-- BIA, hoje: uma tentativa.
insert into public.call_attempts (item_id, batch_id, organization_id, user_id, iniciada_em,
                                  encerrada_em, duracao_seg, resultado)
values (pg_temp.v('item5'), pg_temp.v('lote_b'), pg_temp.v('org5'), pg_temp.bia(),
        pg_temp.hoje_as('11:00'), pg_temp.hoje_as('11:01'), 0, 'nao_atendeu');

-- ANA também registrou uma visita fora da tela de Ligar, e ouviu um "não me ligue mais".
insert into public.activities (type, channel, organization_id, user_id, occurred_at, body)
values ('visit', 'presencial', pg_temp.v('org4'), pg_temp.ana(), pg_temp.hoje_as('15:00'), 'Passei na loja');
insert into public.consent_events (kind, organization_id, channel, evidence_text, occurred_at, recorded_by)
values ('contact_optout', pg_temp.v('org3'), 'phone', 'Pediu para não ligar mais',
        pg_temp.hoje_as('10:11'), pg_temp.ana());

-- O que o relatório devolve fica guardado para as asserções lerem sem trocar de papel.
create temp table r100(chave text primary key, valor jsonb);
grant select, insert on r100 to authenticated;
create function pg_temp.r(p text) returns jsonb language sql stable as $$
  select valor from r100 where chave = p
$$;
create function pg_temp.pessoa(p text, p_id uuid) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(pg_temp.r(p) -> 'pessoas') x where (x ->> 'pessoa_id')::uuid = p_id
$$;
create function pg_temp.quantas(p text, p_id uuid, p_chave text) returns int language sql stable as $$
  select (x ->> 'quantas')::int
    from jsonb_array_elements(pg_temp.pessoa(p, p_id) -> 'resultados') x where x ->> 'chave' = p_chave
$$;

select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into r100 values
  ('todos',     public.ligacoes_do_dia(pg_temp.hoje(), null)),
  ('ana',       public.ligacoes_do_dia(pg_temp.hoje(), pg_temp.ana())),
  ('ana_ontem', public.ligacoes_do_dia(pg_temp.hoje() - 1, pg_temp.ana())),
  ('gil',       public.ligacoes_do_dia(pg_temp.hoje(), pg_temp.gil()));
select pg_temp.sair();

-- =====================================================================
-- 1. A conta bate
-- =====================================================================
select is((pg_temp.pessoa('todos', pg_temp.ana()) ->> 'ligacoes')::int, 5, 'Ana fez cinco ligações hoje');
select is((pg_temp.pessoa('todos', pg_temp.ana()) ->> 'atendidas')::int, 2, 'duas atenderam');
select is((pg_temp.pessoa('todos', pg_temp.ana()) ->> 'nao_atendidas')::int, 2,
  'duas não atenderam (não atendeu e caixa postal)');
select is((pg_temp.pessoa('todos', pg_temp.ana()) ->> 'sem_resultado')::int, 1,
  'e uma ficou SEM RESULTADO: começou e não tabulou — num relatório exato ela aparece');
select is((pg_temp.pessoa('todos', pg_temp.ana()) ->> 'tempo_falado_seg')::int, 240,
  'tempo falado é a soma das atendidas: 3 min + 1 min');
select is((pg_temp.pessoa('todos', pg_temp.ana()) ->> 'contatos')::int, 4,
  'quatro contatos diferentes: ligar duas vezes para o mesmo não conta dois');
select is((pg_temp.pessoa('todos', pg_temp.ana()) ->> 'reunioes_marcadas')::int, 1, 'uma reunião marcada');
select is((pg_temp.pessoa('todos', pg_temp.ana()) ->> 'pediram_para_nao_ligar')::int, 1,
  'um pedido de não ligar mais');
select is((pg_temp.pessoa('todos', pg_temp.ana()) ->> 'outros_registros')::int, 1,
  'a visita registrada fora da tela de Ligar aparece à parte, e não some');
select is(pg_temp.quantas('todos', pg_temp.ana(), 'lig_reuniao_marcada')
          + pg_temp.quantas('todos', pg_temp.ana(), 'lig_sem_interesse')
          + pg_temp.quantas('todos', pg_temp.ana(), 'nao_atendeu')
          + pg_temp.quantas('todos', pg_temp.ana(), 'caixa_postal')
          + pg_temp.quantas('todos', pg_temp.ana(), 'sem_resultado'), 5,
  'como terminou: uma linha por desfecho, e a soma delas é o total de ligações');
select is((pg_temp.pessoa('todos', pg_temp.ana()) ->> 'primeira_em')::timestamptz, pg_temp.hoje_as('10:00'),
  'a primeira ligação do dia foi às 10:00');

-- =====================================================================
-- 2. O dia é o de Natal
-- =====================================================================
select is((pg_temp.pessoa('ana_ontem', pg_temp.ana()) ->> 'ligacoes')::int, 1,
  'a ligação das 23:30 de ontem é de ONTEM, e não entra em hoje');
select is(pg_temp.r('todos') ->> 'dia', pg_temp.hoje()::text, 'a resposta diz de que dia está falando');

-- =====================================================================
-- 3. A gestão vê todos; a lista só vem pedindo uma pessoa
-- =====================================================================
select is(jsonb_array_length(pg_temp.r('todos') -> 'pessoas'), 2,
  'sem pedir ninguém, vêm as duas pessoas que ligaram hoje — e só elas');
select is(pg_temp.r('todos') -> 'pessoas' -> 0 ->> 'nome', 'Ana Freela', 'quem mais ligou vem primeiro');
select is(pg_temp.pessoa('todos', pg_temp.ana()) -> 'lista', 'null'::jsonb,
  'no resumo de todos a lista ligação a ligação NÃO vem');
select is(jsonb_array_length(pg_temp.pessoa('ana', pg_temp.ana()) -> 'lista'), 5,
  'pedindo a Ana, vêm as cinco ligações dela');
select is(pg_temp.pessoa('ana', pg_temp.ana()) -> 'lista' -> 0 ->> 'organizacao', 'Buffet Alfa',
  'em ordem de horário: a primeira foi para o Buffet Alfa');
select is(pg_temp.pessoa('ana', pg_temp.ana()) -> 'lista' -> 0 ->> 'observacao', 'Quer reunião na terça de manhã',
  'com a anotação que ela escreveu ao desligar');
select is(pg_temp.pessoa('ana', pg_temp.ana()) -> 'lista' -> 0 ->> 'desfecho_nome', 'Reunião marcada',
  'e o desfecho pelo nome do catálogo');

-- =====================================================================
-- 5. Quem não ligou aparece zerado quando perguntam por ele
-- =====================================================================
select is((pg_temp.pessoa('gil', pg_temp.gil()) ->> 'ligacoes')::int, 0,
  'o gestor não ligou hoje: perguntando por ele, vem zerado, e não vazio');
select is(pg_temp.pessoa('gil', pg_temp.gil()) -> 'lista', '[]'::jsonb, 'com a lista vazia');

-- =====================================================================
-- 4. Quem liga só vê o próprio dia
-- =====================================================================
select pg_temp.entrar(pg_temp.ana(), 'sdr');
insert into r100 values ('da_ana', public.ligacoes_do_dia(pg_temp.hoje(), null));
select throws_ok(
  $$ select public.ligacoes_do_dia(pg_temp.hoje(), pg_temp.bia()) $$,
  '42501', 'Você só vê as suas próprias ligações',
  'a Ana pede o dia da Bia e é recusada');
select pg_temp.sair();
select is(jsonb_array_length(pg_temp.r('da_ana') -> 'pessoas'), 1,
  'sem pedir ninguém, quem liga recebe só o PRÓPRIO dia — nunca o do time');
select is(jsonb_array_length(pg_temp.pessoa('da_ana', pg_temp.ana()) -> 'lista'), 5,
  'e já com a lista dela, que é o "meu dia" de quem liga');

-- =====================================================================
-- 6. Papel fora dos três não vê nada
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000010004'::uuid, 'leitura');
select throws_ok(
  $$ select public.ligacoes_do_dia(pg_temp.hoje(), null) $$,
  '42501', 'Sem permissão para ver as ligações do dia',
  'papel desativado no pivô não lê o relatório');
select pg_temp.sair();
select ok(not has_function_privilege('anon', 'public.ligacoes_do_dia(date, uuid)', 'execute'),
  'quem não entrou nem chama a função');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — Metas, "Meu dia" e relatórios (migração 20260904001400):
--   public.goals · public.goal_progress · public.meu_dia
--   · public.relatorio_funil / _por_responsavel / _por_categoria
--   / _por_bairro / _por_fonte / _por_horario
--   · app.portas e app.portas_contadas (os dois tetos do RF-MET-01)
--
-- O que este arquivo prova, além do caminho feliz:
--   1) meta é dado sensível: sdr lê a própria e não a do colega, e não escreve
--      meta nenhuma (RF-MET-02 / RF-ADM-01);
--   2) os tetos antimanipulação do RF-MET-01 valem de verdade — 1 porta batida
--      por alvo por dia e 1 porta aberta por alvo a cada 30 dias;
--   3) a fila do "Meu dia" sai ordenada por urgência e NÃO oferece toque em alvo
--      suprimido (guardrail de opt-out);
--   4) embaixador não abre relatório nenhum;
--   5) a conversão do funil nunca passa de 100% mesmo quando a etapa é pulada —
--      que foi exatamente o defeito da primeira versão da função.
--
-- Roda em transação e desfaz tudo. Nada depende de contagem absoluta da seed.
-- =====================================================================
begin;
select plan(73);

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
create function pg_temp.desfecho(p_slug text) returns int language sql as $$
  select id from public.interaction_outcomes where slug = p_slug
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_slug
$$;
create function pg_temp.funil(p_slug text) returns int language sql as $$
  select id from public.pipelines where slug = p_slug
$$;
create function pg_temp.fonte() returns int language sql as $$
  select id from public.sources where slug = 'captura_campo'
$$;

-- Âncora de relógio. As métricas do RF-MET-01 são recortadas pelo DIA civil em
-- America/Fortaleza, então fixar interação com `now() - 3 horas` é apostar que a
-- suíte nunca roda de madrugada: às 00h28 de Fortaleza aquelas três ligações
-- caem em ONTEM e o "realizado" do dia vira zero. Isto não é folga do código —
-- é o teste ler o próprio relógio errado. Aqui a hora do dia é escolhida, e não
-- sorteada pelo horário em que alguém aperta enter.
create function pg_temp.hoje_as(p_hora numeric) returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Fortaleza')::date::timestamp
           + make_interval(mins => (p_hora * 60)::int))
          at time zone 'America/Fortaleza')
$$;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('mt.gestor@teste.local', 'gestor',     'pgTAP metas'),
  ('mt.sdr1@teste.local',   'sdr',        'pgTAP metas'),
  ('mt.sdr2@teste.local',   'sdr',        'pgTAP metas'),
  ('mt.emb@teste.local',    'embaixador', 'pgTAP metas');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1400000-0000-4000-8000-000000001401', 'mt.gestor@teste.local', '{"full_name":"Gestor Metas"}'),
  ('a1400000-0000-4000-8000-000000001402', 'mt.sdr1@teste.local',   '{"full_name":"SDR Um Metas"}'),
  ('a1400000-0000-4000-8000-000000001403', 'mt.sdr2@teste.local',   '{"full_name":"SDR Dois Metas"}'),
  ('a1400000-0000-4000-8000-000000001404', 'mt.emb@teste.local',    '{"full_name":"Embaixador Metas"}');

-- ---------- parceiros e negócios ----------
--   401 sem próxima ação e sem tarefa   → item "sem_proxima_acao" da fila
--   402 com duas tarefas (uma vencida, uma reunião em 2 h)
--   403 com do_not_contact e próxima ação vencida → NÃO pode entrar na fila
--   404 e 405 servem só à regra dos 30 dias da porta aberta
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, owner_id) values
  ('c1400000-0000-4000-8000-000000001401', 'MT Buffet da Fila',  '+5584999914001', 'Tirol',
     pg_temp.fonte(), 'a1400000-0000-4000-8000-000000001402'),
  ('c1400000-0000-4000-8000-000000001402', 'MT Som da Fila',     '+5584999914002', 'Tirol',
     pg_temp.fonte(), 'a1400000-0000-4000-8000-000000001402'),
  ('c1400000-0000-4000-8000-000000001403', 'MT Pediu Para Parar','+5584999914003', 'Tirol',
     pg_temp.fonte(), 'a1400000-0000-4000-8000-000000001402'),
  ('c1400000-0000-4000-8000-000000001404', 'MT Porta 10 Dias',   '+5584999914004', 'Tirol',
     pg_temp.fonte(), 'a1400000-0000-4000-8000-000000001403'),
  ('c1400000-0000-4000-8000-000000001405', 'MT Porta 40 Dias',   '+5584999914005', 'Tirol',
     pg_temp.fonte(), 'a1400000-0000-4000-8000-000000001403');

insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id, next_action_at)
values
  ('e1400000-0000-4000-8000-000000001401', 'c1400000-0000-4000-8000-000000001401',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'),
     'a1400000-0000-4000-8000-000000001402', null),
  ('e1400000-0000-4000-8000-000000001402', 'c1400000-0000-4000-8000-000000001402',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'),
     'a1400000-0000-4000-8000-000000001402', null),
  ('e1400000-0000-4000-8000-000000001403', 'c1400000-0000-4000-8000-000000001403',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'),
     'a1400000-0000-4000-8000-000000001402', now() - interval '2 days'),
  ('e1400000-0000-4000-8000-000000001404', 'c1400000-0000-4000-8000-000000001404',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'),
     'a1400000-0000-4000-8000-000000001403', null),
  ('e1400000-0000-4000-8000-000000001405', 'c1400000-0000-4000-8000-000000001405',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'),
     'a1400000-0000-4000-8000-000000001403', null);

update public.organizations set do_not_contact = true
 where id = 'c1400000-0000-4000-8000-000000001403';

-- ---------- interações ----------
-- SDR 1, hoje: duas ligações no MESMO alvo (401) e uma no alvo 402 com decisor.
-- Esperado: 3 ligações, 2 portas batidas (401 conta uma só), 1 porta aberta.
insert into public.activities
  (id, type, channel, organization_id, deal_id, user_id, occurred_at, outcome_id, metadata) values
  ('f1400000-0000-4000-8000-000000001401', 'call', 'phone',
     'c1400000-0000-4000-8000-000000001401', 'e1400000-0000-4000-8000-000000001401',
     'a1400000-0000-4000-8000-000000001402', pg_temp.hoje_as(9),
     pg_temp.desfecho('lig_nao_atendeu'), '{"com_quem":"ninguem"}'::jsonb),
  ('f1400000-0000-4000-8000-000000001402', 'call', 'phone',
     'c1400000-0000-4000-8000-000000001401', 'e1400000-0000-4000-8000-000000001401',
     'a1400000-0000-4000-8000-000000001402', pg_temp.hoje_as(10),
     pg_temp.desfecho('lig_nao_atendeu'), '{"com_quem":"ninguem"}'::jsonb),
  ('f1400000-0000-4000-8000-000000001403', 'call', 'phone',
     'c1400000-0000-4000-8000-000000001402', 'e1400000-0000-4000-8000-000000001402',
     'a1400000-0000-4000-8000-000000001402', pg_temp.hoje_as(11),
     pg_temp.desfecho('lig_interessado'), '{"com_quem":"decisor"}'::jsonb);

-- SDR 2: duas portas abertas no alvo 404 com 10 dias de intervalo (só a 1ª conta)
-- e duas no alvo 405 com 40 dias (as duas contam).
insert into public.activities
  (id, type, channel, organization_id, deal_id, user_id, occurred_at, outcome_id, metadata) values
  ('f1400000-0000-4000-8000-000000001404', 'call', 'phone',
     'c1400000-0000-4000-8000-000000001404', 'e1400000-0000-4000-8000-000000001404',
     'a1400000-0000-4000-8000-000000001403', pg_temp.hoje_as(10) - interval '10 days',
     pg_temp.desfecho('lig_interessado'), '{"com_quem":"decisor"}'::jsonb),
  ('f1400000-0000-4000-8000-000000001405', 'call', 'phone',
     'c1400000-0000-4000-8000-000000001404', 'e1400000-0000-4000-8000-000000001404',
     'a1400000-0000-4000-8000-000000001403', pg_temp.hoje_as(10),
     pg_temp.desfecho('lig_interessado'), '{"com_quem":"decisor"}'::jsonb),
  ('f1400000-0000-4000-8000-000000001406', 'call', 'phone',
     'c1400000-0000-4000-8000-000000001405', 'e1400000-0000-4000-8000-000000001405',
     'a1400000-0000-4000-8000-000000001403', pg_temp.hoje_as(10) - interval '40 days',
     pg_temp.desfecho('lig_interessado'), '{"com_quem":"decisor"}'::jsonb),
  ('f1400000-0000-4000-8000-000000001407', 'call', 'phone',
     'c1400000-0000-4000-8000-000000001405', 'e1400000-0000-4000-8000-000000001405',
     'a1400000-0000-4000-8000-000000001403', pg_temp.hoje_as(10),
     pg_temp.desfecho('lig_interessado'), '{"com_quem":"decisor"}'::jsonb);

-- ---------- tarefas do SDR 1 ----------
insert into public.tasks (id, title, kind, status, due_at, assignee_id, organization_id, deal_id) values
  ('11400000-0000-4000-8000-000000001401', 'Ligar de novo para o MT Som', 'call', 'todo',
     now() - interval '1 day', 'a1400000-0000-4000-8000-000000001402',
     'c1400000-0000-4000-8000-000000001402', 'e1400000-0000-4000-8000-000000001402'),
  ('11400000-0000-4000-8000-000000001402', 'Reunião com o MT Som', 'meeting', 'todo',
     now() + interval '2 hours', 'a1400000-0000-4000-8000-000000001402',
     'c1400000-0000-4000-8000-000000001402', 'e1400000-0000-4000-8000-000000001402'),
  ('11400000-0000-4000-8000-000000001403', 'Mandar material (feita no prazo)', 'follow_up', 'done',
     now() - interval '2 hours', 'a1400000-0000-4000-8000-000000001402',
     'c1400000-0000-4000-8000-000000001402', 'e1400000-0000-4000-8000-000000001402');
update public.tasks set completed_at = now() - interval '3 hours'
 where id = '11400000-0000-4000-8000-000000001403';


-- =====================================================================
-- 1. Estrutura e privilégios
-- =====================================================================
select has_table('public', 'goals', 'estrutura: a tabela public.goals existe');
select ok((select relrowsecurity from pg_class where oid = 'public.goals'::regclass),
  'estrutura: goals nasce com RLS habilitada');
select ok(to_regprocedure('public.goal_progress(uuid, app.goal_period, date)') is not null,
  'estrutura: public.goal_progress(uuid, goal_period, date) existe');
select ok(to_regprocedure('public.meu_dia(uuid, int)') is not null,
  'estrutura: public.meu_dia(uuid, int) existe');
select ok(to_regprocedure('public.relatorio_funil(date, date, int)') is not null,
  'estrutura: public.relatorio_funil(date, date, int) existe');
select ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'relatorio\_%') = 6,
  'estrutura: são seis funções de relatório');
select ok(not has_function_privilege('anon', 'public.meu_dia(uuid, int)', 'execute'),
  'privilégio: anon não executa meu_dia');
select ok(not has_function_privilege('anon', 'public.goal_progress(uuid, app.goal_period, date)', 'execute'),
  'privilégio: anon não executa goal_progress');
select ok(has_function_privilege('authenticated', 'public.relatorio_funil(date, date, int)', 'execute'),
  'privilégio: authenticated executa relatorio_funil');
select ok(not has_table_privilege('authenticated', 'app.portas_contadas', 'select'),
  'privilégio: authenticated NÃO lê app.portas_contadas (a projeção traz o alvo de toda atividade)');


-- =====================================================================
-- 2. Os dois tetos do RF-MET-01, na projeção que todo mundo lê
-- =====================================================================
select is((select count(*)::int from app.portas_contadas
            where organization_id = 'c1400000-0000-4000-8000-000000001401' and batida),
  2, 'teto: as duas ligações do mesmo dia no mesmo alvo são duas portas BATIDAS cruas');
select is((select count(*)::int from app.portas_contadas
            where organization_id = 'c1400000-0000-4000-8000-000000001401' and batida_conta),
  1, 'teto: mas contam como UMA porta batida (máx. 1 por alvo por dia)');
select is((select count(*)::int from app.portas_contadas
            where organization_id = 'c1400000-0000-4000-8000-000000001404' and aberta),
  2, 'teto: o alvo com 10 dias de intervalo tem duas portas abertas cruas');
select is((select count(*)::int from app.portas_contadas
            where organization_id = 'c1400000-0000-4000-8000-000000001404' and aberta_conta),
  1, 'teto: e conta UMA (máx. 1 porta aberta por alvo a cada 30 dias)');
select is((select count(*)::int from app.portas_contadas
            where organization_id = 'c1400000-0000-4000-8000-000000001405' and aberta_conta),
  2, 'teto: com 40 dias de intervalo, as duas portas abertas contam');
select is((select count(*)::int from app.portas_contadas
            where organization_id = 'c1400000-0000-4000-8000-000000001402' and aberta_conta),
  1, 'teto: "interessado" com decisor é porta aberta');


-- =====================================================================
-- 3. goals: normalização do período, unicidade e RLS
-- =====================================================================
select pg_temp.entrar('a1400000-0000-4000-8000-000000001401', 'gestor');

select lives_ok(
  $$insert into public.goals (id, user_id, metric, period, period_start, target)
      values ('21400000-0000-4000-8000-000000001401',
              'a1400000-0000-4000-8000-000000001402', 'doors_opened', 'day', current_date, 3)$$,
  'goals: gestor define a meta diária de portas abertas do sdr');
select lives_ok(
  $$insert into public.goals (id, user_id, metric, period, period_start, target)
      values ('21400000-0000-4000-8000-000000001402',
              'a1400000-0000-4000-8000-000000001402', 'calls_made', 'week', date '2026-09-09', 40)$$,
  'goals: a métrica nova "calls_made" (ligações) é aceita pelo catálogo de metas');
select lives_ok(
  $$insert into public.goals (id, user_id, metric, period, period_start, target)
      values ('21400000-0000-4000-8000-000000001403',
              'a1400000-0000-4000-8000-000000001403', 'pre_registrations', 'month', date '2026-09-20', 5)$$,
  'goals: gestor define meta mensal de cadastros para o outro sdr');

select is((select period_start from public.goals where id = '21400000-0000-4000-8000-000000001402'),
  date '2026-09-07', 'goals: meta semanal gravada numa quarta é normalizada para a segunda');
select is((select period_start from public.goals where id = '21400000-0000-4000-8000-000000001403'),
  date '2026-09-01', 'goals: meta mensal gravada no dia 20 é normalizada para o dia 1');
select is((select created_by from public.goals where id = '21400000-0000-4000-8000-000000001401'),
  'a1400000-0000-4000-8000-000000001401'::uuid, 'goals: created_by é carimbado com quem definiu');

select throws_ok(
  $$insert into public.goals (user_id, metric, period, period_start, target)
      values ('a1400000-0000-4000-8000-000000001402', 'doors_opened', 'day', current_date, 9)$$,
  '23505', null, 'goals: uma meta por pessoa, métrica e período — a segunda colide');
select throws_ok(
  $$insert into public.goals (metric, period, period_start, target)
      values ('doors_opened', 'day', current_date, 9)$$,
  '23514', null, 'goals: meta sem pessoa e sem time é recusada');

select pg_temp.entrar('a1400000-0000-4000-8000-000000001402', 'sdr');
select throws_ok(
  $$insert into public.goals (user_id, metric, period, period_start, target)
      values ('a1400000-0000-4000-8000-000000001402', 'visits_done', 'day', current_date, 99)$$,
  '42501', null, 'goals: sdr NÃO define a própria meta (meta é ato de gestão)');
select is((select count(*)::int from public.goals
            where id in ('21400000-0000-4000-8000-000000001401', '21400000-0000-4000-8000-000000001402')),
  2, 'goals: sdr lê as próprias metas');
select is((select count(*)::int from public.goals where id = '21400000-0000-4000-8000-000000001403'),
  0, 'goals: sdr NÃO lê a meta do colega');
select lives_ok(
  $$update public.goals set target = 1 where id = '21400000-0000-4000-8000-000000001401'$$,
  'goals: o UPDATE do sdr não estoura — a política de escrita simplesmente não alcança linha nenhuma');
select is((select target from public.goals where id = '21400000-0000-4000-8000-000000001401'),
  3, 'goals: e a meta continua sendo a que o gestor definiu');

select pg_temp.entrar('a1400000-0000-4000-8000-000000001404', 'embaixador');
select is((select count(*)::int from public.goals
            where id::text like '21400000-0000-4000-8000-00000000140%'),
  0, 'goals: embaixador não lê meta de ninguém');

select pg_temp.entrar('a1400000-0000-4000-8000-000000001401', 'gestor');
select is((select count(*)::int from public.goals
            where id in ('21400000-0000-4000-8000-000000001401',
                         '21400000-0000-4000-8000-000000001402',
                         '21400000-0000-4000-8000-000000001403')),
  3, 'goals: gestor lê as metas de todo mundo');
select pg_temp.sair();


-- =====================================================================
-- 4. goal_progress
-- =====================================================================
select pg_temp.entrar('a1400000-0000-4000-8000-000000001402', 'sdr');

select is((select count(*)::int from public.goal_progress()),
  10, 'goal_progress: uma linha por métrica do catálogo, com ou sem meta definida');
select is((select realizado from public.goal_progress() where metrica = 'calls_made'),
  3, 'goal_progress: três ligações no dia');
select is((select realizado from public.goal_progress() where metrica = 'doors_knocked'),
  2, 'goal_progress: duas portas batidas (o alvo ligado duas vezes conta uma)');
select is((select realizado from public.goal_progress() where metrica = 'doors_opened'),
  1, 'goal_progress: uma porta aberta');
select is((select meta from public.goal_progress() where metrica = 'doors_opened'),
  3, 'goal_progress: a meta do dia definida pelo gestor aparece');
select is((select percentual from public.goal_progress() where metrica = 'doors_opened'),
  33.3::numeric, 'goal_progress: 1 de 3 é 33,3%');
select is((select meta from public.goal_progress() where metrica = 'visits_done'),
  null, 'goal_progress: métrica sem meta definida vem com meta nula, e não com zero');
select is((select mensuravel from public.goal_progress() where metrica = 'replies'),
  false, 'goal_progress: "respostas recebidas" ainda não é medível (depende do inbox do D5)');
select is((select realizado from public.goal_progress() where metrica = 'replies'),
  null, 'goal_progress: e volta sem número, em vez de fingir zero');
select ok((select fonte from public.goal_progress() where metrica = 'published') like 'PROXY:%',
  'goal_progress: "publicados" se declara PROXY — a fonte da verdade é a plataforma');
select ok((select dias_uteis_total from public.goal_progress(null, 'month') limit 1) between 19 and 23,
  'goal_progress: o mês tem entre 19 e 23 dias úteis');

select throws_ok(
  $$select * from public.goal_progress('a1400000-0000-4000-8000-000000001403')$$,
  '42501', null, 'goal_progress: sdr não lê a meta de outra pessoa');

select pg_temp.entrar('a1400000-0000-4000-8000-000000001401', 'gestor');
select is((select realizado from public.goal_progress('a1400000-0000-4000-8000-000000001403')
            where metrica = 'doors_opened'),
  1, 'goal_progress: gestor lê a de qualquer um — e o teto de 30 dias corta uma das duas portas de hoje do outro sdr');
select pg_temp.sair();


-- =====================================================================
-- 5. meu_dia
-- =====================================================================
select pg_temp.entrar('a1400000-0000-4000-8000-000000001402', 'sdr');

select is((select prioridade from public.meu_dia(null, 300) limit 1),
  1, 'meu_dia: o primeiro item é a reunião das próximas 3 h');
select is((select tipo from public.meu_dia(null, 300) limit 1),
  'reuniao_proxima', 'meu_dia: e vem rotulada como tal');
select is((select count(*)::int from public.meu_dia(null, 300) where tipo = 'tarefa_atrasada'),
  1, 'meu_dia: a tarefa vencida entra uma vez');
select ok((select atraso_horas from public.meu_dia(null, 300) where tipo = 'tarefa_atrasada') between 20 and 30,
  'meu_dia: com o atraso em horas calculado');
select is((select count(*)::int from public.meu_dia(null, 300)
            where organization_id = 'c1400000-0000-4000-8000-000000001403'),
  0, 'meu_dia: alvo que pediu para parar NÃO entra na fila, mesmo com próxima ação vencida');
select is((select tipo from public.meu_dia(null, 300)
            where organization_id = 'c1400000-0000-4000-8000-000000001401'),
  'sem_proxima_acao', 'meu_dia: negócio aberto sem próxima ação e sem tarefa é cobrado (§3.2: meta 0%)');
select is((select count(*)::int from public.meu_dia(null, 300)
            where organization_id = 'c1400000-0000-4000-8000-000000001402' and deal_id is not null
              and task_id is null),
  0, 'meu_dia: negócio que já tem tarefa aberta não aparece duas vezes');
select ok((select bool_and(prioridade = sorted) from (
             select prioridade, max(prioridade) over (order by rn) as sorted
               from (select prioridade, row_number() over () as rn from public.meu_dia(null, 300)) x) y),
  'meu_dia: a fila já vem ordenada por prioridade');
select throws_ok(
  $$select * from public.meu_dia('a1400000-0000-4000-8000-000000001403')$$,
  '42501', null, 'meu_dia: sdr não lê a fila de outra pessoa');

select pg_temp.entrar('a1400000-0000-4000-8000-000000001401', 'gestor');
select lives_ok(
  $$select * from public.meu_dia('a1400000-0000-4000-8000-000000001402')$$,
  'meu_dia: gestor lê a fila de qualquer um');
select pg_temp.sair();


-- =====================================================================
-- 6. Relatórios: acesso por papel e sanidade dos números
-- =====================================================================
select pg_temp.entrar('a1400000-0000-4000-8000-000000001404', 'embaixador');
select throws_ok($$select * from public.relatorio_funil()$$,            '42501', null,
  'relatório: embaixador não abre o funil');
select throws_ok($$select * from public.relatorio_por_responsavel()$$,  '42501', null,
  'relatório: embaixador não abre a produtividade por pessoa');
select throws_ok($$select * from public.relatorio_por_categoria()$$,    '42501', null,
  'relatório: embaixador não abre a densidade por categoria');
select throws_ok($$select * from public.relatorio_por_bairro()$$,       '42501', null,
  'relatório: embaixador não abre o corte por bairro');
select throws_ok($$select * from public.relatorio_por_fonte()$$,        '42501', null,
  'relatório: embaixador não abre o aproveitamento por fonte');
select throws_ok($$select * from public.relatorio_por_horario()$$,      '42501', null,
  'relatório: embaixador não abre o corte por horário');

select pg_temp.entrar('a1400000-0000-4000-8000-000000001402', 'sdr');
select lives_ok($$select * from public.relatorio_funil()$$,
  'relatório: sdr abre os relatórios (o time do MVP tem duas pessoas, ambas sdr)');

select pg_temp.entrar('a1400000-0000-4000-8000-000000001401', 'gestor');

select ok((select bool_and(conversao_etapa <= 100)
             from public.relatorio_funil(date '2020-01-01', current_date)
            where conversao_etapa is not null),
  'relatório: nenhuma conversão etapa a etapa passa de 100%, mesmo com etapa pulada');
select ok((select bool_and(conversao_acumulada <= 100)
             from public.relatorio_funil(date '2020-01-01', current_date)
            where conversao_acumulada is not null),
  'relatório: nem a conversão acumulada');
select ok((select bool_and(chegaram_ate >= alcancaram)
             from public.relatorio_funil(date '2020-01-01', current_date)
            where na_linha_do_funil),
  'relatório: "chegaram até aqui" nunca é menor que "entraram exatamente aqui"');
select is((select conversao_etapa from public.relatorio_funil(date '2020-01-01', current_date)
            where etapa_slug = 'perdido' and funil_slug = 'fornecedor'),
  null, 'relatório: perda não está na linha do funil e não tem conversão de etapa');

select is((select ligacoes from public.relatorio_por_responsavel(date '2020-01-01', current_date)
            where pessoa_id = 'a1400000-0000-4000-8000-000000001402'),
  3, 'relatório: as três ligações do sdr aparecem na produtividade dele');
select is((select portas_batidas from public.relatorio_por_responsavel(date '2020-01-01', current_date)
            where pessoa_id = 'a1400000-0000-4000-8000-000000001402'),
  2, 'relatório: com o mesmo teto de porta batida da tela de metas');
select is((select tarefas_no_prazo from public.relatorio_por_responsavel(date '2020-01-01', current_date)
            where pessoa_id = 'a1400000-0000-4000-8000-000000001402'),
  1, 'relatório: uma tarefa concluída dentro do prazo (RF-REL-10)');
select is((select tarefas_vencidas_abertas from public.relatorio_por_responsavel(date '2020-01-01', current_date)
            where pessoa_id = 'a1400000-0000-4000-8000-000000001402'),
  1, 'relatório: e uma vencida ainda em aberto, que conta como atrasada');

select ok((select count(*) = count(distinct (cidade, bairro))
             from public.relatorio_por_bairro(date '2020-01-01', current_date)),
  'relatório: cada par cidade + bairro aparece uma vez só no corte por bairro');
select ok((select count(*) from public.relatorio_por_bairro(date '2020-01-01', current_date)
            where bairro = 'Tirol') >= 1,
  'relatório: o bairro Tirol das organizações de teste está lá');
select ok((select bool_and(contatados <= alvos)
             from public.relatorio_por_fonte(date '2020-01-01', current_date)),
  'relatório: por fonte, contatados nunca passa do denominador de alvos');
select ok((select count(*) from public.relatorio_por_horario(date '2020-01-01', current_date)
            where superficie = 'ligacao') >= 1,
  'relatório: o corte por horário separa a ligação das demais superfícies');

select pg_temp.sair();

select * from finish();
rollback;

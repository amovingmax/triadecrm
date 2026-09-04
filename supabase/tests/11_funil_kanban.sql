-- =====================================================================
-- pgTAP — Funil kanban (RF-FUN-01/02/03/04/08; migração 000900):
--   public.pipeline_board · public.move_deal · public.deal_stage_timeline
--
-- Cobre: mover válido, recusa sem próxima ação, recusa de perda sem motivo,
-- campos obrigatórios da etapa, histórico (deal_stage_history), auditoria
-- (audit_log), temperatura recalculada por app.compute_temperature, o quadro
-- (contagem, filtros, paginação, modo de uma etapa) e a RLS por papel (admin,
-- gestor, sdr, embaixador, leitura, financeiro e anon) sobre as três funções.
--
-- Roda em transação e desfaz tudo. Os negócios da seed continuam na base, por
-- isso nenhuma asserção depende de contagem absoluta de dado semeado: tudo é
-- recortado por responsável, por organização ou pelo próprio negócio de teste.
-- =====================================================================
begin;
select plan(79);

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
create function pg_temp.funil(p_slug text) returns int language sql as $$
  select id from public.pipelines where slug = p_slug
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_slug
$$;
create function pg_temp.acao(p_dias int, p_texto text default 'Ligar para confirmar')
returns jsonb language sql as $$
  select jsonb_build_object('kind', 'call', 'label', p_texto,
                            'at', (now() + make_interval(days => p_dias))::text)
$$;
create function pg_temp.total_etapa(b jsonb, p_slug text) returns int language sql as $$
  select (s ->> 'total')::int from jsonb_array_elements(b -> 'stages') s
   where s ->> 'slug' = p_slug
$$;
create function pg_temp.cartoes(b jsonb, p_slug text) returns int language sql as $$
  select jsonb_array_length(s -> 'cards') from jsonb_array_elements(b -> 'stages') s
   where s ->> 'slug' = p_slug
$$;
create function pg_temp.cartao(b jsonb, p_slug text, p_i int default 0) returns jsonb language sql as $$
  select (s -> 'cards') -> p_i from jsonb_array_elements(b -> 'stages') s
   where s ->> 'slug' = p_slug
$$;
create function pg_temp.soma_totais(b jsonb) returns int language sql as $$
  select coalesce(sum((s ->> 'total')::int), 0)::int from jsonb_array_elements(b -> 'stages') s
$$;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('kb.admin@teste.local',      'admin',      'pgTAP kanban'),
  ('kb.gestor@teste.local',     'gestor',     'pgTAP kanban'),
  ('kb.sdr1@teste.local',       'sdr',        'pgTAP kanban'),
  ('kb.sdr2@teste.local',       'sdr',        'pgTAP kanban'),
  ('kb.emb1@teste.local',       'embaixador', 'pgTAP kanban'),
  ('kb.emb2@teste.local',       'embaixador', 'pgTAP kanban'),
  ('kb.leitura@teste.local',    'leitura',    'pgTAP kanban'),
  ('kb.financeiro@teste.local', 'financeiro', 'pgTAP kanban');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000901', 'kb.admin@teste.local',      '{"full_name":"Admin Kanban"}'),
  ('a0000000-0000-4000-8000-000000000902', 'kb.gestor@teste.local',     '{"full_name":"Gestor Kanban"}'),
  ('a0000000-0000-4000-8000-000000000903', 'kb.sdr1@teste.local',       '{"full_name":"SDR Um Kanban"}'),
  ('a0000000-0000-4000-8000-000000000904', 'kb.sdr2@teste.local',       '{"full_name":"SDR Dois Kanban"}'),
  ('a0000000-0000-4000-8000-000000000905', 'kb.emb1@teste.local',       '{"full_name":"Embaixador Um Kanban"}'),
  ('a0000000-0000-4000-8000-000000000906', 'kb.emb2@teste.local',       '{"full_name":"Embaixador Dois Kanban"}'),
  ('a0000000-0000-4000-8000-000000000907', 'kb.leitura@teste.local',    '{"full_name":"Leitura Kanban"}'),
  ('a0000000-0000-4000-8000-000000000908', 'kb.financeiro@teste.local', '{"full_name":"Financeiro Kanban"}');

-- ---------- parceiros e negócios ----------
-- O1 é do sdr1, O2 do sdr2, O3 do embaixador 1, O4 não tem dono (bolo comum).
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, owner_id) values
  ('b0000000-0000-4000-8000-000000000901', 'Kanban Buffet Aurora',   '+5584999990901', 'Tirol',
     (select id from public.sources where slug = 'captura_campo'), 'a0000000-0000-4000-8000-000000000903'),
  ('b0000000-0000-4000-8000-000000000902', 'Kanban Espaço Boreal',   '+5584999990902', 'Petrópolis',
     (select id from public.sources where slug = 'captura_campo'), 'a0000000-0000-4000-8000-000000000904'),
  ('b0000000-0000-4000-8000-000000000903', 'Kanban Doces Celeste',   '+5584999990903', 'Ponta Negra',
     (select id from public.sources where slug = 'captura_campo'), 'a0000000-0000-4000-8000-000000000905'),
  ('b0000000-0000-4000-8000-000000000904', 'Kanban Som Delta',       '+5584999990904', 'Capim Macio',
     (select id from public.sources where slug = 'captura_campo'), null);
insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000901', 'b0000000-0000-4000-8000-000000000901',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'), 'a0000000-0000-4000-8000-000000000903'),
  ('d0000000-0000-4000-8000-000000000902', 'b0000000-0000-4000-8000-000000000902',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'), 'a0000000-0000-4000-8000-000000000904'),
  ('d0000000-0000-4000-8000-000000000903', 'b0000000-0000-4000-8000-000000000903',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'), 'a0000000-0000-4000-8000-000000000905'),
  ('d0000000-0000-4000-8000-000000000904', 'b0000000-0000-4000-8000-000000000904',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'), null);

-- =====================================================================
-- 1. Superfície: as três funções existem e a projeção do cartão é interna
-- =====================================================================
select has_function('public', 'pipeline_board',
  array['integer','boolean','uuid','text','integer','integer','integer'],
  'pipeline_board existe com a assinatura do contrato');
select has_function('public', 'move_deal',
  array['uuid','integer','integer','text','jsonb','jsonb'],
  'move_deal existe com a assinatura do contrato');
select has_function('public', 'deal_stage_timeline', array['uuid'],
  'deal_stage_timeline existe');

-- =====================================================================
-- 2. Mover válido (RF-FUN-01/03): histórico, auditoria, temperatura, claim
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000903', 'sdr');

-- Sem próxima ação e sem próxima ação futura no negócio: o BANCO recusa.
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'contatado')) ->> 'reason'),
  'proxima_acao_obrigatoria',
  'RF-FUN-03: mover para etapa de trabalho sem próxima ação é recusado pelo banco');
select is((select stage_id from public.deals where id = 'd0000000-0000-4000-8000-000000000901'),
  pg_temp.etapa('fornecedor', 'prospectado'),
  'RF-FUN-03: a recusa não moveu o cartão');

-- Próxima ação com data no passado.
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'contatado'),
                    null, null, null, pg_temp.acao(-3)) ->> 'reason'),
  'proxima_acao_no_passado',
  'RF-FUN-03: próxima ação com data vencida é recusada');

-- Movimento válido.
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'respondeu'),
                    pg_temp.etapa('fornecedor', 'prospectado'),
                    'respondeu no WhatsApp', null, pg_temp.acao(1)) ->> 'ok'),
  'true',
  'mover válido: aceito');
select is((select stage_id from public.deals where id = 'd0000000-0000-4000-8000-000000000901'),
  pg_temp.etapa('fornecedor', 'respondeu'), 'mover válido: etapa gravada');
select is((select next_action from public.deals where id = 'd0000000-0000-4000-8000-000000000901'),
  'Ligar para confirmar', 'mover válido: próxima ação gravada no negócio');
select is((select count(*)::int from public.tasks
            where deal_id = 'd0000000-0000-4000-8000-000000000901' and kind = 'call'),
  1, 'mover válido: próxima ação também vira tarefa do responsável');

-- Temperatura recalculada pela regra que já existe (app.compute_temperature).
select is((select temperature::text from public.deals where id = 'd0000000-0000-4000-8000-000000000901'),
  'morno', 'temperatura: recalculada pela etapa (Respondeu = morno, PRD §5.6)');
select is(
  (select d.temperature
     from public.deals d
     join public.stages s on s.id = d.stage_id
     join public.organizations o on o.id = d.organization_id,
          lateral app.compute_temperature(s.temperature, d.last_intent, d.last_activity_at,
                                          o.temperature_override, d.status) r
    where d.id = 'd0000000-0000-4000-8000-000000000901'),
  (select r.temperature
     from public.deals d
     join public.stages s on s.id = d.stage_id
     join public.organizations o on o.id = d.organization_id,
          lateral app.compute_temperature(s.temperature, d.last_intent, d.last_activity_at,
                                          o.temperature_override, d.status) r
    where d.id = 'd0000000-0000-4000-8000-000000000901'),
  'temperatura: o valor gravado é o que app.compute_temperature devolve (regra não reimplementada)');

-- O movimento NÃO grava atividade (senão zeraria "dias sem contato" — ver migração).
select is((select count(*)::int from public.activities where deal_id = 'd0000000-0000-4000-8000-000000000901'),
  0, 'mover: não cria atividade (last_activity_at intacto)');
select is((select last_activity_at from public.deals where id = 'd0000000-0000-4000-8000-000000000901'),
  null::timestamptz, 'mover: last_activity_at continua nulo');

-- Histórico (RF-FUN-08).
select is((select count(*)::int from public.deal_stage_history
            where deal_id = 'd0000000-0000-4000-8000-000000000901'),
  2, 'RF-FUN-08: histórico com a criação e a mudança');
select results_eq(
  $$select from_stage_id, to_stage_id, changed_by, reason
      from public.deal_stage_history
     where deal_id = 'd0000000-0000-4000-8000-000000000901' order by id desc limit 1$$,
  $$values (pg_temp.etapa('fornecedor', 'prospectado'), pg_temp.etapa('fornecedor', 'respondeu'),
            'a0000000-0000-4000-8000-000000000903'::uuid, 'respondeu no WhatsApp'::text)$$,
  'RF-FUN-08: de/para, autor e motivo gravados pelo move_deal');
select results_eq(
  $$select from_stage_name, to_stage_name, changed_by_name, reason
      from public.deal_stage_timeline('d0000000-0000-4000-8000-000000000901') limit 1$$,
  $$values ('Prospectado'::text, 'Respondeu'::text, 'SDR Um Kanban'::text, 'respondeu no WhatsApp'::text)$$,
  'deal_stage_timeline: nomes da etapa e do autor');
select is((select changed_by_name from public.deal_stage_timeline('d0000000-0000-4000-8000-000000000901')
            order by changed_at asc, id asc limit 1),
  null::text, 'deal_stage_timeline: autor nulo (sistema) na criação feita pela carga');

-- Recusa por concorrência e por etapa igual.
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'em_conversa'),
                    pg_temp.etapa('fornecedor', 'prospectado'), null, null, pg_temp.acao(1)) ->> 'reason'),
  'etapa_mudou', 'concorrência: etapa esperada diferente da real é recusada');
select is(
  ((public.move_deal('d0000000-0000-4000-8000-000000000901',
                     pg_temp.etapa('fornecedor', 'em_conversa'),
                     pg_temp.etapa('fornecedor', 'prospectado')) -> 'current_stage_id')::int),
  pg_temp.etapa('fornecedor', 'respondeu'), 'concorrência: devolve a etapa real do cartão');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'respondeu')) ->> 'reason'),
  'etapa_igual', 'soltar na mesma coluna: recusado sem escrever');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('produtor', 'identificado'), null, null, null, pg_temp.acao(1)) ->> 'reason'),
  'etapa_de_outro_funil', 'etapa de outro funil é recusada');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000999',
                    pg_temp.etapa('fornecedor', 'contatado'), null, null, null, pg_temp.acao(1)) ->> 'reason'),
  'negocio_nao_encontrado', 'negócio inexistente: recusa nomeada, sem exceção');

-- =====================================================================
-- 3. Campos obrigatórios por etapa (RF-FUN-04)
-- =====================================================================
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'reuniao_marcada'),
                    null, null, null, pg_temp.acao(1)) ->> 'reason'),
  'campos_obrigatorios', 'RF-FUN-04: reunião marcada sem data e formato é recusada');
select is(
  (select jsonb_array_length(
     public.move_deal('d0000000-0000-4000-8000-000000000901',
                      pg_temp.etapa('fornecedor', 'reuniao_marcada'),
                      null, null, null, pg_temp.acao(1)) -> 'missing')),
  2, 'RF-FUN-04: a recusa diz QUAIS campos faltam');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'reuniao_marcada'), null, null,
                    jsonb_build_object('meeting_at', (now() + interval '2 days')::text,
                                       'meeting_format', 'cafe_da_manha')) ->> 'reason'),
  'campos_obrigatorios', 'RF-FUN-04: formato fora da lista de opções da etapa é recusado');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'reuniao_marcada'), null, 'aceitou o horário',
                    jsonb_build_object('meeting_at', (now() + interval '2 days')::text,
                                       'meeting_format', 'meet')) ->> 'ok'),
  'true', 'RF-FUN-04: com data e formato válidos o movimento passa');
select is(
  (select count(*)::int from public.tasks
    where deal_id = 'd0000000-0000-4000-8000-000000000901' and kind = 'meeting'),
  1, 'RF-FUN-04: a reunião marcada vira tarefa kind = meeting (agenda é D7)');
select is((select next_action_at from public.deals where id = 'd0000000-0000-4000-8000-000000000901'),
  (select due_at from public.tasks
    where deal_id = 'd0000000-0000-4000-8000-000000000901' and kind = 'meeting'),
  'RF-FUN-04: a data da reunião é a próxima ação do negócio');
select is((select temperature::text from public.deals where id = 'd0000000-0000-4000-8000-000000000901'),
  'quente', 'temperatura: etapa quente esquenta o negócio');

-- Evidência de autorização vira prova em consent_events (guardrail do pré-cadastro).
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'autorizou'), null, null,
                    jsonb_build_object('authorization_evidence', 'pode cadastrar sim, autorizo'),
                    pg_temp.acao(1, 'Enviar link de reivindicação')) ->> 'ok'),
  'true', 'RF-FUN-04: autorizou com evidência é aceito');
select is(
  (select count(*)::int from public.consent_events
    where organization_id = 'b0000000-0000-4000-8000-000000000901' and kind = 'data_use_authorized'),
  1, 'RF-FUN-04: a evidência da autorização vira consent_events (guardrail do pré-cadastro)');
select is(
  (select evidence_text from public.consent_events
    where organization_id = 'b0000000-0000-4000-8000-000000000901' and kind = 'data_use_authorized'),
  'pode cadastrar sim, autorizo', 'RF-FUN-04: o texto literal da autorização é guardado');

-- =====================================================================
-- 4. Perda: motivo da lista fechada (RF-FUN-04)
-- =====================================================================
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'perdido')) ->> 'reason'),
  'motivo_de_perda_invalido', 'RF-FUN-04: perder sem motivo é recusado pelo banco');
select is((select status::text from public.deals where id = 'd0000000-0000-4000-8000-000000000901'),
  'open', 'RF-FUN-04: a recusa de perda não mudou o status');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'perdido'), null, null,
                    jsonb_build_object('lost_reason_id', 999999)) ->> 'reason'),
  'motivo_de_perda_invalido', 'RF-FUN-04: motivo fora da lista fechada é recusado');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'perdido'), null, 'disse não na reunião',
                    jsonb_build_object('lost_reason_id',
                      (select id from public.lost_reasons where slug = 'nao_aceita_comissao'))) ->> 'ok'),
  'true', 'RF-FUN-04: perder com motivo da lista é aceito');
select results_eq(
  $$select status::text, lost_reason_id, next_action, next_action_at
      from public.deals where id = 'd0000000-0000-4000-8000-000000000901'$$,
  $$values ('lost'::text, (select id from public.lost_reasons where slug = 'nao_aceita_comissao'),
            null::text, null::timestamptz)$$,
  'RF-FUN-04: perda grava status, motivo e limpa a próxima ação');
select is((select temperature::text from public.deals where id = 'd0000000-0000-4000-8000-000000000901'),
  'frio', 'temperatura: negócio perdido esfria (PRD §5.6)');

-- Auditoria da mudança de etapa (RF-ADM-03 / CLAUDE.md).
select pg_temp.sair();
select is(
  (select count(*)::int from public.audit_log
    where table_name = 'deals' and row_id = 'd0000000-0000-4000-8000-000000000901'
      and action = 'UPDATE'
      and old_data ->> 'stage_id' is distinct from new_data ->> 'stage_id'),
  4, 'auditoria: uma linha de audit_log por mudança de etapa feita pelo move_deal');
select results_eq(
  $$select actor_id, actor_role from public.audit_log
     where table_name = 'deals' and row_id = 'd0000000-0000-4000-8000-000000000901'
       and action = 'UPDATE' order by id desc limit 1$$,
  $$values ('a0000000-0000-4000-8000-000000000903'::uuid, 'sdr'::text)$$,
  'auditoria: quem moveu e com que papel');

-- =====================================================================
-- 5. Guardrail de opt-out: arrastar para a coluna de opt-out suprime o contato
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000904', 'sdr');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000902',
                    pg_temp.etapa('fornecedor', 'optout'), null, 'pediu para parar') ->> 'ok'),
  'true', 'opt-out: a etapa de opt-out não exige motivo da lista (é perda por regra)');
select pg_temp.sair();
select is((select do_not_contact from public.organizations where id = 'b0000000-0000-4000-8000-000000000902'),
  true, 'opt-out: mover para a coluna liga do_not_contact');
select is(app.is_suppressed('+5584999990902'), true,
  'opt-out: o telefone entra na suppression_list (guardrail do CLAUDE.md)');

-- =====================================================================
-- 6. Bolo comum: negócio sem dono é assumido por quem move (RF-CON-04)
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000903', 'sdr');
select is(
  ((public.move_deal('d0000000-0000-4000-8000-000000000904',
                     pg_temp.etapa('fornecedor', 'contatado'),
                     null, 'primeiro contato enviado', null, pg_temp.acao(2)) -> 'claimed')::text),
  'true', 'sem dono: quem move assume o negócio (claimed)');
select is((select owner_id from public.deals where id = 'd0000000-0000-4000-8000-000000000904'),
  'a0000000-0000-4000-8000-000000000903'::uuid, 'sem dono: owner_id passa a ser quem moveu');
select is((select assignee_id from public.tasks where deal_id = 'd0000000-0000-4000-8000-000000000904'),
  'a0000000-0000-4000-8000-000000000903'::uuid, 'sem dono: a tarefa da próxima ação fica com o novo dono');

-- =====================================================================
-- 7. RLS por papel sobre as funções novas
-- =====================================================================
-- sdr: vê tudo no quadro, mas não move a carteira alheia.
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000902',
                    pg_temp.etapa('fornecedor', 'contatado'), null, null, null, pg_temp.acao(1)) ->> 'reason'),
  'sem_permissao', 'sdr: não move negócio de outro responsável (política deals_update mantida)');
select is(pg_temp.total_etapa(public.pipeline_board(pg_temp.funil('fornecedor'), false,
                                                   'a0000000-0000-4000-8000-000000000904'), 'optout'),
  1, 'sdr: enxerga no quadro a carteira dos colegas (app.sees_all)');

-- embaixador: só a própria carteira, no quadro e no movimento.
select pg_temp.entrar('a0000000-0000-4000-8000-000000000905', 'embaixador');
select is(pg_temp.soma_totais(public.pipeline_board(pg_temp.funil('fornecedor'))),
  1, 'embaixador: o quadro traz só a carteira dele');
select is(
  (pg_temp.cartao(public.pipeline_board(pg_temp.funil('fornecedor')), 'prospectado') ->> 'organization_name'),
  'Kanban Doces Celeste', 'embaixador: o cartão do quadro é o dele');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000903',
                    pg_temp.etapa('fornecedor', 'contatado'),
                    null, 'visita combinada', null, pg_temp.acao(1)) ->> 'ok'),
  'true', 'embaixador: move negócio da própria carteira');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000901',
                    pg_temp.etapa('fornecedor', 'contatado'), null, null, null, pg_temp.acao(1)) ->> 'reason'),
  'negocio_nao_encontrado', 'embaixador: negócio fora da carteira nem aparece');
select is((select count(*)::int from public.deal_stage_timeline('d0000000-0000-4000-8000-000000000901')),
  0, 'embaixador: histórico de negócio alheio volta vazio (RLS de deal_stage_history)');
select isnt((select count(*)::int from public.deal_stage_timeline('d0000000-0000-4000-8000-000000000903')),
  0, 'embaixador: histórico do próprio negócio é visível');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000906', 'embaixador');
select is(pg_temp.soma_totais(public.pipeline_board(pg_temp.funil('fornecedor'))),
  0, 'embaixador sem carteira: quadro vazio, e não a base inteira');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000903',
                    pg_temp.etapa('fornecedor', 'respondeu'), null, null, null, pg_temp.acao(1)) ->> 'reason'),
  'negocio_nao_encontrado', 'embaixador: não move o negócio de outro embaixador');

-- leitura e financeiro: leem o quadro, não movem nada.
select pg_temp.entrar('a0000000-0000-4000-8000-000000000907', 'leitura');
select isnt(pg_temp.soma_totais(public.pipeline_board(pg_temp.funil('fornecedor'))), 0,
  'leitura: enxerga o quadro (app.sees_all)');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000904',
                    pg_temp.etapa('fornecedor', 'respondeu'), null, null, null, pg_temp.acao(1)) ->> 'reason'),
  'sem_permissao', 'leitura: não move cartão');
select pg_temp.entrar('a0000000-0000-4000-8000-000000000908', 'financeiro');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000904',
                    pg_temp.etapa('fornecedor', 'respondeu'), null, null, null, pg_temp.acao(1)) ->> 'reason'),
  'sem_permissao', 'financeiro: não move cartão');

-- gestor e admin: movem a carteira de qualquer pessoa.
select pg_temp.entrar('a0000000-0000-4000-8000-000000000902', 'gestor');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000903',
                    pg_temp.etapa('fornecedor', 'respondeu'), null, 'realocado', null, pg_temp.acao(1)) ->> 'ok'),
  'true', 'gestor: move negócio de outra pessoa');
select is((select owner_id from public.deals where id = 'd0000000-0000-4000-8000-000000000903'),
  'a0000000-0000-4000-8000-000000000905'::uuid, 'gestor: mover não rouba o dono do negócio');
select pg_temp.entrar('a0000000-0000-4000-8000-000000000901', 'admin');
select is(
  (public.move_deal('d0000000-0000-4000-8000-000000000903',
                    pg_temp.etapa('fornecedor', 'em_conversa'), null, null, null, pg_temp.acao(1)) ->> 'ok'),
  'true', 'admin: move qualquer negócio');

-- anon: nada.
select pg_temp.anonimo();
select throws_ok(
  $$select public.pipeline_board(1)$$, '42501', null, 'anon: sem execute em pipeline_board');
select throws_ok(
  $$select public.move_deal('d0000000-0000-4000-8000-000000000904', 1)$$, '42501', null,
  'anon: sem execute em move_deal');
select throws_ok(
  $$select * from public.deal_stage_timeline('d0000000-0000-4000-8000-000000000904')$$, '42501', null,
  'anon: sem execute em deal_stage_timeline');

-- A projeção do cartão é interna: nem authenticated a lê direto (RF-BAS-14).
select pg_temp.entrar('a0000000-0000-4000-8000-000000000903', 'sdr');
select throws_ok(
  $$select count(*) from app.deal_cards$$, '42501', null,
  'app.deal_cards não é superfície de API nem para authenticated');

-- =====================================================================
-- 8. O quadro: forma, contagem, filtros e paginação (RF-FUN-01/09)
-- =====================================================================
select is(
  (select jsonb_array_length(public.pipeline_board(pg_temp.funil('fornecedor')) -> 'stages')),
  12, 'quadro: o funil de fornecedor tem 12 colunas');
select is(
  (select jsonb_array_length(public.pipeline_board(pg_temp.funil('produtor')) -> 'stages')),
  14, 'quadro: o funil de produtor tem 14 colunas');
select is(
  (select public.pipeline_board(pg_temp.funil('fornecedor')) -> 'pipeline' ->> 'slug'),
  'fornecedor', 'quadro: identifica o funil');
select is(
  (select count(*)::int from jsonb_object_keys(
     pg_temp.cartao(public.pipeline_board(pg_temp.funil('fornecedor'), true), 'contatado'))),
  22, 'quadro: o cartão tem as 22 chaves do contrato (CartaoQuadro)');
select is(
  (select count(*)::int from jsonb_object_keys(
     pg_temp.cartao(public.pipeline_board(pg_temp.funil('fornecedor'), true), 'contatado')) k
    where k in ('phone','phone_e164','email','instagram_handle','cnpj')),
  0, 'quadro: nenhum dado pessoal viaja no cartão (RF-BAS-14)');
select is(pg_temp.total_etapa(
    public.pipeline_board(pg_temp.funil('fornecedor'), true), 'contatado'),
  1, 'quadro: filtro "meus" recorta pelo responsável logado');
select is(pg_temp.total_etapa(
    public.pipeline_board(pg_temp.funil('fornecedor'), false, null, 'kanban som delta'), 'contatado'),
  1, 'quadro: busca por nome do parceiro dentro do quadro');
select is(pg_temp.cartoes(
    public.pipeline_board(pg_temp.funil('fornecedor'), true, null, null,
                          pg_temp.etapa('fornecedor', 'contatado')), 'prospectado'),
  0, 'quadro: com p_stage_id só a etapa pedida devolve cartões (modo celular)');
select is(pg_temp.cartoes(
    public.pipeline_board(pg_temp.funil('fornecedor'), true, null, null,
                          pg_temp.etapa('fornecedor', 'contatado')), 'contatado'),
  1, 'quadro: a etapa pedida devolve os cartões dela');
select is(pg_temp.cartoes(
    public.pipeline_board(pg_temp.funil('fornecedor'), true, null, null,
                          pg_temp.etapa('fornecedor', 'contatado'), 40, 1), 'contatado'),
  0, 'quadro: p_offset pagina dentro da etapa');
select is(pg_temp.total_etapa(
    public.pipeline_board(pg_temp.funil('fornecedor'), true, null, null,
                          pg_temp.etapa('fornecedor', 'contatado'), 40, 1), 'contatado'),
  1, 'quadro: a contagem da coluna não muda com a paginação');
select is(
  (select s ->> 'required_fields' is not null
     from jsonb_array_elements(public.pipeline_board(pg_temp.funil('fornecedor')) -> 'stages') s
    where s ->> 'slug' = 'perdido'),
  true, 'quadro: a coluna carrega os campos obrigatórios da etapa (RF-FUN-04)');

select pg_temp.sair();
select * from finish();
rollback;

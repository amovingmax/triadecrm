-- =====================================================================
-- Tela das cadências e Resumo do dia
--   (RF-CON-09..17, RF-MET-03/04, RF-AST-02; PRD §7.4 e §7.7; R07 §8;
--    R13 §7; ADR-05)
--
-- O que esta migração acrescenta, e por quê:
--
--   1. `public.cadencias_visao()` — a leitura da tela das cadências. Uma
--      chamada devolve as cinco cadências, os passos em ordem (canal, atraso,
--      condição), quantos contatos estão parados em cada passo, quantos toques
--      pendentes e quantos já foram feitos ou pulados ali. Contar isso no
--      cliente exigiria cinco consultas e um `group by` em JavaScript sobre
--      linhas que a RLS já sabe filtrar; o Postgres é o cérebro (ADR-03).
--
--   2. `public.ligar_cadencia(slug, ativa)` — ligar e desligar. Existe em vez
--      de um `update` direto porque a RLS de `cadences` é `USING (is_manager())`
--      e um UPDATE que não casa com a política NÃO estoura: devolve zero linhas.
--      A tela ficaria mentindo em silêncio para a Heloísa (`sdr`). A RPC devolve
--      `{ok:false, motivo:'sem_permissao'}` e a tela diz quem pode.
--
--      Desligar não encerra ninguém: `matricular_em_cadencia` já filtra por
--      `is_active`, então a cadência desligada apenas para de aceitar entradas
--      novas, e quem já está dentro segue até o fim. A RPC devolve quantas
--      matrículas ativas continuam correndo, para a tela poder dizer isso.
--
--   3. `public.resumo_do_dia(pessoa, momento)` — o resumo das 07:30 e das
--      18:00 (RF-AST-02, R07 §8.1 e §8.2) calculado do dado real de hoje.
--      Não envia nada: é a mesma mensagem, lida na tela. Enquanto o número da
--      Meta não existir, é o único lugar onde ela existe — e o campo
--      `entrega.envio_automatico` diz isso na cara.
--
--      A fila da manhã e o "faltou" da noite reusam `public.meu_dia`, que já
--      ordena por urgência e já traz o porquê de cada item (RF-MET-04). Duas
--      ordenações de urgência no mesmo produto seria a primeira a divergir.
--
--   4. A flag do modo automático (RF-CON-09) vira LINHA e vira GUARDA. Não
--      basta a tela dizer "está desligado": `app_settings` ganha a chave
--      `cadencia.modo_automatico` e um gatilho que RECUSA ligá-la. O ADR-05 é
--      decisão de projeto — gente aprova cada primeiro contato e cada resposta
--      —, e decisão de projeto que só existe em prosa é decisão que um dia
--      alguém desfaz por engano numa tela de configuração.
--
-- Nada aqui envia mensagem, cria toque ou muda matrícula: são três leituras e
-- um interruptor.
-- =====================================================================


-- ===========================================================================
-- A. O MODO AUTOMÁTICO É UMA LINHA DESLIGADA, E O BANCO A SEGURA
-- ===========================================================================

insert into public.app_settings (key, value, description) values
  ('cadencia.modo_automatico',
   jsonb_build_object(
     'ligado',      false,
     'requisito',   'RF-CON-09',
     'decisao',     'ADR-05',
     'explicacao',  'Human-in-the-loop por padrão: o robô classifica e redige, a pessoa aprova o primeiro contato e as respostas.'),
   'Feature flag do disparo automático (RF-CON-09). Fora do MVP por decisão de projeto (ADR-05); o gatilho app.app_settings_modo_automatico recusa ligá-la.')
on conflict (key) do nothing;

create or replace function app.app_settings_modo_automatico()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.key = 'cadencia.modo_automatico'
     and coalesce((new.value ->> 'ligado')::boolean, false) then
    raise exception
      'O modo automático (RF-CON-09) está fora do MVP por decisão do projeto (ADR-05): quem aprova cada primeiro contato e cada resposta é gente. Ligar isto é mudar a decisão no PRD, não a configuração.'
      using errcode = '42501';
  end if;
  return new;
end $$;
comment on function app.app_settings_modo_automatico() is
  'Guarda do ADR-05: a flag do modo automático existe para ser lida e mostrada, não para ser ligada. Recusa com 42501.';

-- `zz_` para rodar depois de `app_settings_validate` (gatilhos BEFORE disparam
-- em ordem alfabética do nome).
drop trigger if exists zz_app_settings_modo_automatico on public.app_settings;
create trigger zz_app_settings_modo_automatico
  before insert or update on public.app_settings
  for each row execute function app.app_settings_modo_automatico();


-- ===========================================================================
-- B. `public.cadencias_visao()` — a tela das cadências numa chamada
-- ===========================================================================

drop function if exists public.cadencias_visao();
create or replace function public.cadencias_visao()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_hoje  date;
  v_res   jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_hoje := (now() at time zone 'America/Fortaleza')::date;

  select jsonb_build_object(
    'gerado_em',           now(),
    'dia',                 v_hoje,
    'papel',               app.role()::text,
    'pode_ligar_desligar', app.is_manager(),
    'dia_de_operacao',     app.dia_util_de_operacao(),

    -- O que a máquina faz sozinha, dito com o nome do job e o horário reais.
    'agendador', (
      select jsonb_agg(jsonb_build_object(
               'job',    j.jobname,
               'agenda', j.schedule,
               'ativo',  j.active)
               order by j.jobname)
        from cron.job j
       where j.jobname in ('cadencias_agendar', 'cadencias_encerrar_silencio')),

    -- O que a máquina NÃO faz: nenhum worker de WhatsApp bateu ponto.
    'envio', jsonb_build_object(
      'modo_automatico', coalesce(
        (select (s.value ->> 'ligado')::boolean
           from public.app_settings s where s.key = 'cadencia.modo_automatico'), false),
      'modo_automatico_decisao', coalesce(
        (select s.value ->> 'decisao'
           from public.app_settings s where s.key = 'cadencia.modo_automatico'), 'ADR-05'),
      'worker_whatsapp', (
        select jsonb_build_object(
                 'visto_em', max(w.last_beat_at),
                 -- `coalesce` porque `bool_or` sobre zero linhas devolve NULL, e
                 -- "não sei" viraria "talvez" na tela. Sem worker, está parado.
                 'ativo', coalesce(bool_or(w.status = 'ok'
                                           and w.last_beat_at > now() - interval '15 minutes'), false))
          from public.worker_heartbeats w
         where w.worker like 'wa%')),

    -- Teto e consumo de hoje, por canal (RF-CON-10). É o número que explica
    -- por que um toque pode ficar para amanhã.
    -- A ordem é a de R13 §7 (a voz primeiro, o WhatsApp de apoio), não a
    -- alfabética: é a ordem em que o time pensa nos canais.
    'canais', (
      select jsonb_agg(jsonb_build_object(
               'canal', c.canal,
               'teto',  app.teto_do_canal(c.canal::app.channel, v_hoje),
               'hoje',  app.toques_do_dia(c.canal::app.channel, v_hoje))
               order by c.ordem)
        from (values ('phone', 1), ('whatsapp', 2), ('instagram', 3), ('presencial', 4))
               c(canal, ordem)),

    'cadencias', coalesce((
      select jsonb_agg(x.linha order by x.id)
        from (
          select c.id,
                 jsonb_build_object(
                   'id',              c.id,
                   'slug',            c.slug,
                   'nome',            c.name,
                   'ativa',           c.is_active,
                   'funil',           c.pipeline_slug,
                   'max_toques',      c.max_touches,
                   'limite_dias',     c.limite_dias,
                   'etapa_do_fim',    c.end_stage_slug,
                   'exige_gancho',    c.requires_gancho,
                   'exige_autorizacao', c.requires_authorization,
                   'nota_de_entrada', c.entry_note,
                   'descricao',       c.description,
                   'matriculas', (
                     select jsonb_build_object(
                              'ativas',     count(*) filter (where e.status = 'ativa'::app.cadence_status),
                              'pausadas',   count(*) filter (where e.status = 'pausada'::app.cadence_status),
                              'concluidas', count(*) filter (where e.status = 'concluida'::app.cadence_status),
                              'encerradas', count(*) filter (where e.status = 'encerrada'::app.cadence_status),
                              'esperando_o_primeiro', count(*) filter (
                                where e.status = 'ativa'::app.cadence_status and e.current_position = 0))
                       from public.cadence_enrollments e
                      where e.cadence_id = c.id
                        and app.org_is_visible(e.organization_id)),
                   'passos', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'posicao',       s."position",
                              'canal',         s.channel::text,
                              'tarefa',        s.task_kind::text,
                              'atraso_dias',   s.delay_days,
                              'atraso_de',     s.delay_from,
                              'titulo',        s.title,
                              'modelo',        s.template_code,
                              'audio',         s.audio_slug,
                              'condicao',      s.condition,
                              'tiers',         to_jsonb(s.tiers),
                              'dica_de_janela', s.window_hint,
                              'ultimo_automatico', s.is_last_automatic,
                              -- Quantos contatos estão AQUI: matrícula ativa cujo
                              -- último passo aberto (ou pulado) é este.
                              'aqui', (
                                select count(*) from public.cadence_enrollments e
                                 where e.cadence_id = c.id
                                   and e.status = 'ativa'::app.cadence_status
                                   and e.current_position = s."position"
                                   and app.org_is_visible(e.organization_id)),
                              'pendentes', (
                                select count(*) from public.cadence_touches t
                                 where t.step_id = s.id
                                   and t.status = 'pendente'::app.touch_status
                                   and app.org_is_visible(t.organization_id)),
                              'feitos', (
                                select count(*) from public.cadence_touches t
                                 where t.step_id = s.id
                                   and t.status = 'feito'::app.touch_status
                                   and app.org_is_visible(t.organization_id)),
                              'pulados', (
                                select count(*) from public.cadence_touches t
                                 where t.step_id = s.id
                                   and t.status = 'pulado'::app.touch_status
                                   and app.org_is_visible(t.organization_id)))
                              order by s."position")
                       from public.cadence_steps s
                      where s.cadence_id = c.id), '[]'::jsonb)) as linha
            from public.cadences c) x), '[]'::jsonb))
  into v_res;

  return v_res;
end $$;
comment on function public.cadencias_visao() is
  'A tela das cadências numa chamada: cadências, passos em ordem com canal/atraso/condição, quantos contatos param em cada passo, tetos do dia por canal e o que roda sozinho (jobs) contra o que não roda (envio por WhatsApp, modo automático). Definer, mas conta só o que a RLS da organização deixa a pessoa ver.';


-- ===========================================================================
-- C. `public.ligar_cadencia()` — o interruptor, com recusa legível
-- ===========================================================================

drop function if exists public.ligar_cadencia(text, boolean);
create or replace function public.ligar_cadencia(p_slug text, p_ativa boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_papel  app.user_role;
  c        public.cadences%rowtype;
  v_ativas int;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_papel := app.role();
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_ativa is null then
    return jsonb_build_object('ok', false, 'motivo', 'estado_ausente');
  end if;

  select * into c from public.cadences where slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'cadencia_inexistente');
  end if;

  if c.is_active = p_ativa then
    select count(*) into v_ativas from public.cadence_enrollments e
     where e.cadence_id = c.id and e.status = 'ativa'::app.cadence_status;
    return jsonb_build_object('ok', true, 'mudou', false, 'ativa', c.is_active,
                              'matriculas_ativas', v_ativas);
  end if;

  update public.cadences set is_active = p_ativa where id = c.id;

  select count(*) into v_ativas from public.cadence_enrollments e
   where e.cadence_id = c.id and e.status = 'ativa'::app.cadence_status;

  -- O gatilho `audit_cadences` já grava o antes e o depois da linha; esta
  -- entrada existe para o log dizer a INTENÇÃO com o nome que a tela usa.
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, v_papel::text,
          case when p_ativa then 'LIGAR_CADENCIA' else 'DESLIGAR_CADENCIA' end,
          'cadences', c.id::text,
          jsonb_build_object('cadencia', c.slug, 'ativa', p_ativa,
                             'matriculas_ativas', v_ativas));

  return jsonb_build_object('ok', true, 'mudou', true, 'ativa', p_ativa,
                            'matriculas_ativas', v_ativas);
end $$;
comment on function public.ligar_cadencia(text, boolean) is
  'Liga e desliga uma cadência (gestor e admin). Desligar NÃO encerra ninguém: apenas fecha a entrada, e o retorno diz quantas matrículas ativas seguem correndo. Recusa legível em vez do zero-linhas silencioso do UPDATE sob RLS.';


-- ===========================================================================
-- D. `public.resumo_do_dia()` — as 07:30 e as 18:00, do dado real de hoje
-- ===========================================================================

drop function if exists public.resumo_do_dia(uuid, text);
create or replace function public.resumo_do_dia(p_user_id uuid default null,
                                                p_momento text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_alvo     uuid;
  v_nome     text;
  v_agora    timestamptz := now();
  v_hoje     date;
  v_inicio   timestamptz;
  v_fim      timestamptz;
  v_ontem    date;
  v_relogio  text;
  v_momento  text;
  v_registros int;
  v_res      jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_alvo := coalesce(p_user_id, v_uid);
  if v_alvo <> v_uid and not app.is_manager() then
    raise exception 'Só gestor ou admin lê o resumo de outra pessoa' using errcode = '42501';
  end if;

  select p.full_name into v_nome from public.profiles p where p.id = v_alvo;

  v_hoje   := (v_agora at time zone 'America/Fortaleza')::date;
  v_ontem  := v_hoje - 1;
  -- O dia civil de Fortaleza, convertido de volta para instantes.
  v_inicio := (v_hoje::timestamp) at time zone 'America/Fortaleza';
  v_fim    := ((v_hoje + 1)::timestamp) at time zone 'America/Fortaleza';

  -- O relógio decide o momento; a tela pode pedir o outro sem mentir sobre isso.
  v_relogio := case when (v_agora at time zone 'America/Fortaleza')::time < time '13:00'
                    then 'manha' else 'noite' end;
  v_momento := case when p_momento in ('manha', 'noite') then p_momento else v_relogio end;

  select count(*) into v_registros
    from public.activities a
   where a.user_id = v_alvo and a.occurred_at >= v_inicio and a.occurred_at < v_fim;

  select jsonb_build_object(
    'pessoa',    jsonb_build_object('id', v_alvo, 'nome', v_nome,
                                    'eu_mesmo', v_alvo = v_uid),
    'dia',       v_hoje,
    'gerado_em', v_agora,
    'momento',   v_momento,
    'momento_do_relogio', v_relogio,
    'dia_de_operacao',    app.dia_util_de_operacao(v_agora),

    -- A honestidade do módulo, em dado e não em prosa de tela: os horários
    -- existem, a mensagem não sai sozinha.
    'entrega', jsonb_build_object(
      'horario_manha', '07:30',
      'horario_noite', '18:00',
      'envio_automatico', false,
      'canal_previsto', 'whatsapp',
      'worker_whatsapp_ativo', coalesce((
        select bool_or(w.status = 'ok' and w.last_beat_at > now() - interval '15 minutes')
          from public.worker_heartbeats w where w.worker like 'wa%'), false)),

    -- ---------- manhã: quem te espera hoje, e por quê ----------
    'agenda', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id',   t.id,
               'quando',    t.due_at,
               'tipo',      t.kind::text,
               'titulo',    t.title,
               'organizacao', o.name,
               'bairro',    o.neighborhood,
               'organization_id', t.organization_id,
               'deal_id',   t.deal_id)
               order by t.due_at)
        from public.tasks t
        left join public.organizations o on o.id = t.organization_id
       where t.assignee_id = v_alvo
         and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
         and t.kind in ('meeting'::app.task_kind, 'visit'::app.task_kind)
         and t.due_at >= v_inicio and t.due_at < v_fim), '[]'::jsonb),

    'fila', coalesce((
      select jsonb_agg(jsonb_build_object(
               'motivo',      f.motivo,
               'titulo',      f.titulo,
               'organizacao', f.organizacao,
               'quando',      f.quando,
               'atraso_horas', f.atraso_horas,
               'temperatura', f.temperatura,
               'tipo',        f.tipo,
               'bairro',      f.bairro,
               'organization_id', f.organization_id,
               'deal_id',     f.deal_id,
               'task_id',     f.task_id)
               order by f.prioridade, f.quando nulls last)
        from (select * from public.meu_dia(v_alvo, 60)) f
       where f.tipo <> 'tarefa_futura'), '[]'::jsonb),

    -- Toques de cadência que vencem hoje ou já venceram. Cada um é uma tarefa
    -- para gente executar: nenhum sai daqui sozinho.
    'toques', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',      tc.id,
               'canal',   tc.channel::text,
               'passo',   tc."position",
               'titulo',  s.title,
               'cadencia', cd.name,
               'quando',  tc.due_at,
               'organizacao', o.name,
               'organization_id', tc.organization_id,
               'task_id', tc.task_id)
               order by tc.due_at)
        from public.cadence_touches tc
        join public.cadence_steps s        on s.id  = tc.step_id
        join public.cadence_enrollments en on en.id = tc.enrollment_id
        join public.cadences cd            on cd.id = en.cadence_id
        left join public.organizations o   on o.id  = tc.organization_id
       where tc.status = 'pendente'::app.touch_status
         and tc.due_at < v_fim
         and coalesce(en.assignee_id, v_alvo) = v_alvo
         and app.org_is_visible(tc.organization_id)), '[]'::jsonb),

    'metas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'metrica',   g.metrica,
               'rotulo',    g.metrica_rotulo,
               'meta',      g.meta,
               'realizado', g.realizado,
               'mensuravel', g.mensuravel)
               order by g.metrica)
        from public.goal_progress(v_alvo, 'day'::app.goal_period) g), '[]'::jsonb),

    -- ---------- noite: o que foi feito, e o que ficou ----------
    'feito', jsonb_build_object(
      'registros',      v_registros,
      'portas_abertas', coalesce((
        select count(*) from public.activities a
          join public.interaction_outcomes io on io.id = a.outcome_id
         where a.user_id = v_alvo and a.occurred_at >= v_inicio and a.occurred_at < v_fim
           and io.counts_as = 'aberta'::app.door_kind), 0),
      'portas_batidas', coalesce((
        select count(*) from public.activities a
          join public.interaction_outcomes io on io.id = a.outcome_id
         where a.user_id = v_alvo and a.occurred_at >= v_inicio and a.occurred_at < v_fim
           and io.counts_as = 'batida'::app.door_kind), 0),
      'sem_desfecho', coalesce((
        select count(*) from public.activities a
         where a.user_id = v_alvo and a.occurred_at >= v_inicio and a.occurred_at < v_fim
           and a.outcome_id is null), 0),
      'tarefas_concluidas', coalesce((
        select count(*) from public.tasks t
         where t.assignee_id = v_alvo and t.status = 'done'::app.task_status
           and t.completed_at >= v_inicio and t.completed_at < v_fim), 0),
      'movimentos', coalesce((
        select count(*) from public.deal_stage_history h
         where h.changed_by = v_alvo
           and h.changed_at >= v_inicio and h.changed_at < v_fim), 0),
      'por_tipo', coalesce((
        select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'quantos', x.quantos)
                 order by x.quantos desc, x.tipo)
          from (select a.type::text as tipo, count(*) as quantos
                  from public.activities a
                 where a.user_id = v_alvo
                   and a.occurred_at >= v_inicio and a.occurred_at < v_fim
                 group by a.type) x), '[]'::jsonb)),

    'ontem', jsonb_build_object(
      'registros', coalesce((
        select count(*) from public.activities a
         where a.user_id = v_alvo
           and a.occurred_at >= ((v_ontem::timestamp) at time zone 'America/Fortaleza')
           and a.occurred_at <  v_inicio), 0),
      'portas_abertas', coalesce((
        select count(*) from public.activities a
          join public.interaction_outcomes io on io.id = a.outcome_id
         where a.user_id = v_alvo
           and a.occurred_at >= ((v_ontem::timestamp) at time zone 'America/Fortaleza')
           and a.occurred_at <  v_inicio
           and io.counts_as = 'aberta'::app.door_kind), 0)),

    -- R07 §8.2: antes de contar zero, a Assistente pergunta se houve atividade
    -- que não entrou. A tela precisa saber a diferença entre "não fez" e "não
    -- registrou", então o dado sai daqui e não de um `length === 0` no cliente.
    'sem_registro', v_registros = 0)
  into v_res;

  return v_res;
end $$;
comment on function public.resumo_do_dia(uuid, text) is
  'O resumo das 07:30 e das 18:00 (RF-AST-02, R07 §8) calculado do dado real do dia civil de Fortaleza: agenda, fila com o porquê (reusa public.meu_dia), toques de cadência pendentes, metas, o que foi feito e se houve algum registro. Não envia nada — `entrega.envio_automatico` é falso enquanto o número da Meta não existir. Definer: a pessoa lê o próprio resumo; gestor e admin leem o de qualquer um.';


-- ===========================================================================
-- E. Grants — o padrão do repositório: nada para `public` nem `anon`
-- ===========================================================================

-- Função de GATILHO: ninguém a chama de fora, e o 09_seguranca_acesso cobra isso
-- de toda função de gatilho do schema `app`.
revoke all on function app.app_settings_modo_automatico()      from public, anon, authenticated;

revoke all on function public.cadencias_visao()                from public, anon;
revoke all on function public.ligar_cadencia(text, boolean)    from public, anon;
revoke all on function public.resumo_do_dia(uuid, text)        from public, anon;

grant execute on function public.cadencias_visao()             to authenticated, service_role;
grant execute on function public.ligar_cadencia(text, boolean) to authenticated, service_role;
grant execute on function public.resumo_do_dia(uuid, text)     to authenticated, service_role;

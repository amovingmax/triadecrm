-- =====================================================================
-- TRIADE — v0.1 — D8/D9 — Metas por pessoa, fila do "Meu dia" e relatórios
-- (RF-MET-01/02/03/04; RF-REL-01/02/03/04/06/10/11; PRD §7.7 e §7.8; anexo R07).
--
-- O que esta migração ENTREGA
--   1. `public.goals`  — meta por pessoa (ou por time) × métrica × período.
--   2. `public.goal_progress(...)` — meta contra realizado no período, lendo
--      activities, deals/deal_stage_history, organizations e tasks. NÃO persiste
--      agregado, NÃO cria job: é conta feita na hora, como manda o RF-REL-01.
--   3. `public.meu_dia(...)` — a fila do dia de uma pessoa, já ordenada por
--      urgência (RF-MET-04), reusando a projeção `app.deal_cards` do kanban.
--   4. Seis funções de leitura para os relatórios: funil, responsável, categoria,
--      bairro, fonte e faixa de horário do contato.
--
-- O que esta migração NÃO faz (e por quê)
--   * Nenhuma tabela de agregação e nenhum `pg_cron`: os números do MVP saem de
--     centenas de linhas, não de milhões. Materializar aqui seria cache antes de
--     existir problema de leitura.
--   * Não inventa métrica sem lastro. `replies` (respostas recebidas) depende do
--     inbox de WhatsApp, que só nasce no D5 — a função devolve a linha da métrica
--     com `mensuravel = false` e o motivo escrito, em vez de devolver zero e
--     deixar a tela mentir. `pre_registrations` e `published` saem do funil como
--     PROXY declarado: a fonte da verdade é a plataforma Komune, cuja integração
--     ainda não está ligada.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 1. Uma métrica nova no catálogo de metas: ligações
-- ---------------------------------------------------------------------------
-- O PRD (Apêndice D) fecha `goal_metric` sem uma métrica de ligação, porque o
-- texto trata a ligação como uma das formas de "porta batida" (RF-MET-01). Só que
-- o produto ganhou um módulo de ligação próprio (tela /ligar) e a meta pedida é
-- "ligações por dia", que `doors_knocked` não sabe separar de mensagem e visita.
-- Acrescentar um rótulo ao enum não muda nenhuma decisão fechada nem apaga
-- métrica existente. FICA REGISTRADO PARA CONFIRMAÇÃO HUMANA (Rafael/Matheus):
-- é o único ponto desta migração que sai do Apêndice D.
--
-- Cuidado técnico: em Postgres um rótulo acrescentado por `add value` NÃO pode ser
-- USADO na mesma transação que o acrescentou. Por isso, em toda esta migração, a
-- métrica é comparada como TEXTO (`metric::text = 'calls_made'`) e nunca como
-- literal do enum — a migração aplica de uma vez só, em transação única.
alter type app.goal_metric add value if not exists 'calls_made' after 'doors_opened';


-- ---------------------------------------------------------------------------
-- 2. Funções de apoio: dias úteis e limites do período
-- ---------------------------------------------------------------------------

-- Dias úteis no intervalo FECHADO [p_de, p_ate], com a mesma definição já usada em
-- app.next_business_day (migração 000200): segunda a sexta, fora dos feriados de
-- qualquer escopo. É o denominador do "ritmo necessário" do RF-MET-02.
create or replace function app.business_days(p_de date, p_ate date)
returns int
language sql
stable
set search_path = ''
as $$
  select case
           when p_de is null or p_ate is null or p_ate < p_de then 0
           else (select count(*)::int
                   from generate_series(p_de, p_ate, interval '1 day') g(d)
                  where extract(isodow from g.d) < 6
                    and not exists (select 1 from public.holidays h where h.date = g.d::date))
         end
$$;
comment on function app.business_days(date, date) is
  'Dias úteis no intervalo fechado [p_de, p_ate] (segunda a sexta, sem feriados), mesma regra de app.next_business_day. Denominador do ritmo necessário (RF-MET-02).';

-- Primeiro e último dia do período de uma meta a partir de uma data qualquer.
-- Semana começa na segunda (date_trunc('week')); mês, no dia 1. É o que normaliza
-- `goals.period_start` e o que a tela usa para dizer "semana de 07/09 a 13/09".
create or replace function app.goal_bounds(p_period app.goal_period, p_ref date)
returns table (period_start date, period_end date)
language sql
immutable
set search_path = ''
as $$
  select case p_period
           when 'day'::app.goal_period  then p_ref
           when 'week'::app.goal_period then (date_trunc('week',  p_ref::timestamp))::date
           else                              (date_trunc('month', p_ref::timestamp))::date
         end,
         case p_period
           when 'day'::app.goal_period  then p_ref
           when 'week'::app.goal_period then (date_trunc('week',  p_ref::timestamp))::date + 6
           else ((date_trunc('month', p_ref::timestamp) + interval '1 month')::date - 1)
         end
$$;
comment on function app.goal_bounds(app.goal_period, date) is
  'Início e fim do período (dia, semana começando na segunda, mês) que contém p_ref. Normaliza goals.period_start e delimita o cálculo do realizado.';


-- ---------------------------------------------------------------------------
-- 3. A porta como projeção única (RF-MET-01)
-- ---------------------------------------------------------------------------
-- Toda métrica de porta, todo relatório por canal e todo corte por horário leem
-- DAQUI. Escrever a regra uma vez é o que impede a tela de metas e o relatório de
-- segunda discordarem sobre quantas portas a Heloísa abriu na terça.
--
-- `organization_id` vem com coalesce do negócio porque o worker de WhatsApp (D5)
-- grava a mensagem só com deal_id — o mesmo cuidado que a v_contact_cooldown já
-- toma (migração 000800).
--
-- Não é superfície de API: fica em `app` e é revogada de authenticated, porque
-- traz o alvo de toda atividade e sdr/embaixador leem parceiro pela view mascarada
-- (RF-BAS-14). Só as funções definer abaixo a consultam.
create or replace view app.portas
with (security_barrier = true, security_invoker = false) as
  select a.id                                                     as activity_id,
         coalesce(a.organization_id, d.organization_id)            as organization_id,
         a.deal_id,
         a.user_id,
         a.occurred_at,
         (a.occurred_at at time zone 'America/Fortaleza')::date    as dia,
         extract(hour from (a.occurred_at at time zone 'America/Fortaleza'))::int as hora,
         a.type,
         a.channel,
         app.interaction_surface(a.channel, a.type)                as superficie,
         a.outcome_id,
         io.slug                                                   as desfecho,
         coalesce((a.metadata ->> 'door_knocked')::boolean,    false) as batida,
         coalesce((a.metadata ->> 'door_opened')::boolean,     false) as aberta,
         coalesce((a.metadata ->> 'outcome_pending')::boolean, false) as sem_desfecho
    from public.activities a
    left join public.deals d                on d.id  = a.deal_id
    left join public.interaction_outcomes io on io.id = a.outcome_id
   where a.type <> 'system'::app.activity_type;
alter view app.portas owner to postgres;
comment on view app.portas is
  'Uma linha por interação humana (RF-MET-01): alvo resolvido, dia e hora em America/Fortaleza, superfície e as marcas door_knocked/door_opened que o gatilho do catálogo escreveu. Não é API.';

-- As duas regras antimanipulação do RF-MET-01, aplicadas aqui e em lugar nenhum mais:
--   * porta batida: no máximo 1 por alvo por dia;
--   * porta aberta: no máximo 1 por alvo a cada 30 dias.
--
-- A regra da porta aberta é implementada pela distância até a porta aberta ANTERIOR
-- do mesmo alvo (contada ou não), e não pela distância até a última CONTADA. A
-- diferença aparece em sequências longas (dias 0, 20 e 40: aqui contam 1; pela
-- leitura gulosa contariam 2) e é deliberada — numa métrica que existe para não ser
-- inflada, errar para menos é o lado certo de errar. Está escrito para que ninguém
-- descubra isso lendo o gráfico.
--
-- Atividade sem alvo resolvido (nem organização, nem negócio) não tem como ser
-- deduplicada por alvo: cada linha conta por si.
create or replace view app.portas_contadas
with (security_barrier = true, security_invoker = false) as
  with p as (select * from app.portas),
  batidas as (
    select p.activity_id,
           row_number() over (partition by coalesce(p.organization_id::text, 'a:' || p.activity_id::text),
                                           p.dia
                              order by p.occurred_at, p.activity_id) = 1 as conta
      from p
     where p.batida),
  abertas as (
    select p.activity_id,
           p.occurred_at - lag(p.occurred_at) over (
             partition by coalesce(p.organization_id::text, 'a:' || p.activity_id::text)
             order by p.occurred_at, p.activity_id) as desde_anterior
      from p
     where p.aberta)
  select p.*,
         coalesce(b.conta, false) as batida_conta,
         (p.aberta and (ab.desde_anterior is null or ab.desde_anterior > interval '30 days')) as aberta_conta
    from p
    left join batidas b  on b.activity_id  = p.activity_id
    left join abertas ab on ab.activity_id = p.activity_id;
alter view app.portas_contadas owner to postgres;
comment on view app.portas_contadas is
  'app.portas com os tetos do RF-MET-01 aplicados: batida_conta (máx. 1 por alvo por dia) e aberta_conta (máx. 1 por alvo a cada 30 dias, medido contra a porta aberta anterior). Não é API.';


-- ---------------------------------------------------------------------------
-- 4. Metas (RF-MET-02, PRD Apêndice D)
-- ---------------------------------------------------------------------------
create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles (id) on delete cascade,   -- null = meta do time
  team_id       int  references public.teams (id)    on delete cascade,
  metric        app.goal_metric not null,
  period        app.goal_period not null,
  period_start  date not null,                                            -- normalizado pelo gatilho
  target        int  not null check (target between 0 and 10000),
  note          text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint goals_precisa_de_dono check (user_id is not null or team_id is not null)
);
alter table public.goals enable row level security;
comment on table public.goals is
  'Meta por pessoa (user_id) ou por time (user_id nulo) × métrica × período (RF-MET-02). O realizado NÃO mora aqui: é calculado por public.goal_progress.';
comment on column public.goals.period_start is
  'Primeiro dia do período, normalizado pelo gatilho (semana = segunda, mês = dia 1): sem isso, duas metas da mesma semana com datas diferentes escapariam do índice único.';
comment on column public.goals.target is
  'Alvo do período inteiro (3 portas por dia, 5 cadastros por semana). Teto de 10000 só para barrar dedo escorregado.';
comment on column public.goals.note is 'Por que essa meta (dedicação parcial, semana de férias, ajuste combinado no 1:1).';

-- Uma meta por pessoa/métrica/período e uma por time/métrica/período.
create unique index if not exists goals_pessoa_uq
  on public.goals (user_id, metric, period, period_start) where user_id is not null;
create unique index if not exists goals_time_uq
  on public.goals (team_id, metric, period, period_start) where user_id is null and team_id is not null;
create index if not exists goals_team_idx    on public.goals (team_id);
create index if not exists goals_creator_idx on public.goals (created_by);
create index if not exists goals_periodo_idx on public.goals (period, period_start);

create or replace function app.goals_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ini date;
begin
  select b.period_start into v_ini from app.goal_bounds(new.period, new.period_start) b;
  new.period_start := v_ini;
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists goals_before_write on public.goals;
create trigger goals_before_write before insert or update on public.goals
  for each row execute function app.goals_before_write();

-- Meta é registro sensível (define cobrança e escalonamento, RF-AST-04): mudança
-- entra no audit_log como qualquer alteração de etapa ou de consentimento.
drop trigger if exists audit_goals on public.goals;
create trigger audit_goals after insert or update or delete on public.goals
  for each row execute function app.audit();

-- RLS: admin e gestor enxergam e mexem em todas; qualquer outro papel só lê a
-- PRÓPRIA meta (e a do seu time). Definir meta é ato de gestão — sdr e embaixador
-- não escrevem, senão a meta vira número que a pessoa cobrada escolhe.
drop policy if exists goals_select on public.goals;
drop policy if exists goals_insert on public.goals;
drop policy if exists goals_update on public.goals;
drop policy if exists goals_delete on public.goals;
create policy goals_select on public.goals for select to authenticated
  using ((select app.is_manager())
         or user_id = (select auth.uid())
         or (user_id is null
             and team_id is not null
             and team_id = (select p.team_id from public.profiles p where p.id = (select auth.uid()))));
create policy goals_insert on public.goals for insert to authenticated
  with check ((select app.is_manager()));
create policy goals_update on public.goals for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));
create policy goals_delete on public.goals for delete to authenticated
  using ((select app.is_manager()));

grant select, insert, update, delete on public.goals to authenticated, service_role;
revoke all on public.goals from anon;


-- ---------------------------------------------------------------------------
-- 4b. Reaplicação: `create or replace` não muda o tipo de retorno
-- ---------------------------------------------------------------------------
-- Toda função abaixo devolve TABLE. Se a lista de colunas mudar entre versões
-- desta migração, o `create or replace` falha com "cannot change return type of
-- existing function" e a migração para no meio. Derrubar antes mantém o arquivo
-- reaplicável; os privilégios são reconcedidos na seção 8.
drop function if exists public.goal_progress(uuid, app.goal_period, date);
drop function if exists public.meu_dia(uuid, int);
drop function if exists public.relatorio_funil(date, date, int);
drop function if exists public.relatorio_por_responsavel(date, date);
drop function if exists public.relatorio_por_categoria(date, date);
drop function if exists public.relatorio_por_bairro(date, date);
drop function if exists public.relatorio_por_fonte(date, date);
drop function if exists public.relatorio_por_horario(date, date);


-- ---------------------------------------------------------------------------
-- 5. Meta × realizado no período (RF-MET-02, RF-REL-01)
-- ---------------------------------------------------------------------------
-- Devolve UMA LINHA POR MÉTRICA do catálogo, tenha ou não meta definida: a tela
-- precisa mostrar "portas abertas 2 — sem meta definida" e não esconder a métrica.
-- `mensuravel` e `fonte` dizem, em português, de onde saiu (ou por que não sai)
-- cada número.
--
-- SECURITY DEFINER porque lê activities, organizations e deals de terceiros para
-- contar — e porque sdr não lê a tabela base de organizations (RF-BAS-14). O
-- controle de acesso está na guarda: a pessoa lê a própria; gestor e admin leem a
-- de qualquer um. Nenhum dado pessoal sai daqui, só contagens.
create or replace function public.goal_progress(
  p_user_id uuid            default null,
  p_period  app.goal_period default 'day',
  p_ref     date            default null)
returns table (
  pessoa_id             uuid,
  pessoa_nome           text,
  metrica               text,
  metrica_rotulo        text,
  periodo               app.goal_period,
  periodo_inicio        date,
  periodo_fim           date,
  meta                  int,
  realizado             int,
  percentual            numeric,
  dias_uteis_total      int,
  dias_uteis_decorridos int,
  ritmo_necessario      numeric,
  mensuravel            boolean,
  fonte                 text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_alvo      uuid;
  v_periodo   app.goal_period := coalesce(p_period, 'day'::app.goal_period);
  v_hoje      date := (now() at time zone 'America/Fortaleza')::date;
  v_ini       date;
  v_fim       date;
  v_de        timestamptz;
  v_ate       timestamptz;
  v_total     int;
  v_decorrido int;
  v_restante  int;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_alvo := coalesce(p_user_id, v_uid);
  if v_alvo <> v_uid and not app.is_manager() then
    raise exception 'Só gestor ou admin lê a meta de outra pessoa' using errcode = '42501';
  end if;

  select b.period_start, b.period_end into v_ini, v_fim
    from app.goal_bounds(v_periodo, coalesce(p_ref, v_hoje)) b;
  v_de  := (v_ini::timestamp) at time zone 'America/Fortaleza';
  v_ate := ((v_fim + 1)::timestamp) at time zone 'America/Fortaleza';

  v_total     := app.business_days(v_ini, v_fim);
  v_decorrido := app.business_days(v_ini, least(v_fim, v_hoje));
  v_restante  := app.business_days(greatest(v_ini, v_hoje), v_fim);

  return query
  with catalogo (metric, rotulo, pode_medir, fonte, ordem) as (
    values
      ('doors_knocked',     'Portas batidas',      true,
       'activities com desfecho do catálogo (RF-FUN-12); máx. 1 por alvo por dia', 1),
      ('doors_opened',      'Portas abertas',      true,
       'activities cujo desfecho vale porta aberta e com quem se falou é decisor ou influenciador; máx. 1 por alvo a cada 30 dias', 2),
      ('calls_made',        'Ligações',            true,
       'activities.type = call (com ou sem desfecho registrado)', 3),
      ('meetings_booked',   'Reuniões marcadas',   true,
       'deal_stage_history: entradas nas etapas "Reunião marcada" e "Demonstração marcada"', 4),
      ('meetings_done',     'Reuniões realizadas', true,
       'activities.type = meeting, exceto desfecho de no-show (RF-MET-01)', 5),
      ('visits_done',       'Visitas',             true,
       'activities.type = visit', 6),
      ('new_targets',       'Alvos novos',         true,
       'organizations criadas no período com a pessoa como responsável', 7),
      ('pre_registrations', 'Cadastros iniciados', true,
       'PROXY: entradas na etapa "Cadastro em andamento". A fonte da verdade é a plataforma Komune, cuja integração ainda não está ligada', 8),
      ('published',         'Publicados',          true,
       'PROXY: entradas na etapa de ganho do funil de captação. A fonte da verdade é a plataforma Komune, cuja integração ainda não está ligada', 9),
      ('replies',           'Respostas recebidas', false,
       'Ainda não é medível: depende do inbox de WhatsApp (D5); a tabela de mensagens não existe', 10)
  ),
  feito as (
    select c.metric,
           (case c.metric
              when 'doors_knocked' then
                (select count(*) from app.portas_contadas pc
                  where pc.user_id = v_alvo and pc.batida_conta
                    and pc.occurred_at >= v_de and pc.occurred_at < v_ate)
              when 'doors_opened' then
                (select count(*) from app.portas_contadas pc
                  where pc.user_id = v_alvo and pc.aberta_conta
                    and pc.occurred_at >= v_de and pc.occurred_at < v_ate)
              when 'calls_made' then
                (select count(*) from app.portas p
                  where p.user_id = v_alvo and p.type = 'call'::app.activity_type
                    and p.occurred_at >= v_de and p.occurred_at < v_ate)
              when 'meetings_booked' then
                (select count(*) from public.deal_stage_history h
                   join public.stages s on s.id = h.to_stage_id
                   join public.deals  d on d.id = h.deal_id
                  where s.slug in ('reuniao_marcada', 'demonstracao_marcada')
                    and coalesce(h.changed_by, d.owner_id) = v_alvo
                    and h.changed_at >= v_de and h.changed_at < v_ate)
              when 'meetings_done' then
                (select count(*) from app.portas p
                  where p.user_id = v_alvo and p.type = 'meeting'::app.activity_type
                    and coalesce(p.desfecho, '') <> 'reu_no_show'
                    and p.occurred_at >= v_de and p.occurred_at < v_ate)
              when 'visits_done' then
                (select count(*) from app.portas p
                  where p.user_id = v_alvo and p.type = 'visit'::app.activity_type
                    and p.occurred_at >= v_de and p.occurred_at < v_ate)
              when 'new_targets' then
                (select count(*) from public.organizations o
                  where o.owner_id = v_alvo and o.deleted_at is null
                    and o.created_at >= v_de and o.created_at < v_ate)
              when 'pre_registrations' then
                (select count(*) from public.deal_stage_history h
                   join public.stages s on s.id = h.to_stage_id
                   join public.deals  d on d.id = h.deal_id
                  where s.slug = 'cadastro_em_andamento'
                    and coalesce(h.changed_by, d.owner_id) = v_alvo
                    and h.changed_at >= v_de and h.changed_at < v_ate)
              when 'published' then
                (select count(*) from public.deal_stage_history h
                   join public.stages    s  on s.id  = h.to_stage_id
                   join public.pipelines pl on pl.id = s.pipeline_id
                   join public.deals     d  on d.id  = h.deal_id
                  where s.is_won and pl.slug = 'fornecedor'
                    and coalesce(h.changed_by, d.owner_id) = v_alvo
                    and h.changed_at >= v_de and h.changed_at < v_ate)
            end)::int as valor
      from catalogo c
     where c.pode_medir
  )
  select v_alvo,
         (select td.full_name from public.team_directory td where td.id = v_alvo),
         c.metric,
         c.rotulo,
         v_periodo,
         v_ini,
         v_fim,
         g.target,
         f.valor,
         case when g.target is not null and g.target > 0 and f.valor is not null
              then round(f.valor * 100.0 / g.target, 1) end,
         v_total,
         v_decorrido,
         -- Ritmo necessário: quanto falta dividido pelos dias úteis que restam.
         case when g.target is not null and v_restante > 0 and coalesce(f.valor, 0) < g.target
              then round((g.target - coalesce(f.valor, 0))::numeric / v_restante, 2) end,
         c.pode_medir,
         c.fonte
    from catalogo c
    left join feito f on f.metric = c.metric
    left join public.goals g
           on g.user_id = v_alvo
          and g.metric::text = c.metric
          and g.period = v_periodo
          and g.period_start = v_ini
   order by c.ordem;
end $$;
comment on function public.goal_progress(uuid, app.goal_period, date) is
  'Meta × realizado de uma pessoa num período (RF-MET-02): uma linha por métrica, com meta (nula quando não definida), realizado, percentual, dias úteis e ritmo necessário. Métrica sem lastro volta com mensuravel = false e o motivo em `fonte`. Definer: a pessoa lê a própria; gestor e admin leem a de qualquer um.';


-- ---------------------------------------------------------------------------
-- 6. "Meu dia": a fila ordenada por urgência (RF-MET-03, RF-MET-04)
-- ---------------------------------------------------------------------------
-- Ordenação, na ordem do RF-MET-04 que já é medível hoje:
--   1 reuniao_proxima      reunião ou visita nas próximas 3 h
--   2 desfecho_pendente    ligação/visita/reunião registrada sem resultado
--   3 tarefa_atrasada      tarefa com prazo vencido
--   4 proxima_acao_atrasada  negócio com próxima ação vencida
--   5 tarefa_hoje          tarefa com prazo para hoje
--   6 proxima_acao_hoje    negócio com próxima ação para hoje
--   7 sem_proxima_acao     negócio aberto sem próxima ação e sem tarefa (§3.2: meta 0%)
--   8 negocio_parado       negócio parado além do SLA da etapa
--   9 tarefa_futura        tarefa com prazo à frente (aba "Futuro")
--
-- Os dois primeiros critérios do RF-MET-04 que dependem do inbox ("parceiro
-- respondeu e está sem resposta há mais de 2 h") NÃO estão aqui: mensagens só
-- existem a partir do D5. Fila curta e verdadeira em vez de fila cheia e falsa.
--
-- Cada negócio entra NO MÁXIMO UMA VEZ (o CASE é exclusivo), e negócio que já tem
-- tarefa aberta não entra pelos itens 4 a 8: a tarefa É o compromisso, e mostrar as
-- duas linhas faria a mesma empresa aparecer duas e três vezes na mesma fila.
--
-- Guardrail: alvo com do_not_contact nunca entra nos itens que propõem toque novo.
--
-- Reuso: os campos do cartão (temperatura, parado, dias na etapa, bairro,
-- categoria) vêm de `app.deal_cards`, a mesma projeção do kanban (migração 000900).
-- Nada de uma segunda definição de "parado" discordando da primeira.
create or replace function public.meu_dia(
  p_user_id uuid default null,
  p_limite  int  default 60)
returns table (
  prioridade      int,
  tipo            text,
  motivo          text,
  titulo          text,
  quando          timestamptz,
  atraso_horas    numeric,
  task_id         uuid,
  activity_id     uuid,
  deal_id         uuid,
  organization_id uuid,
  organizacao     text,
  bairro          text,
  categoria       text,
  temperatura     app.temperature,
  funil           text,
  etapa           text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_alvo   uuid;
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_limite int  := least(greatest(coalesce(p_limite, 60), 1), 300);
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_alvo := coalesce(p_user_id, v_uid);
  if v_alvo <> v_uid and not app.is_manager() then
    raise exception 'Só gestor ou admin lê a fila de outra pessoa' using errcode = '42501';
  end if;

  return query
  with tarefas as (
    select t.id, t.title, t.kind, t.due_at, t.deal_id, t.organization_id,
           o.name         as organizacao,
           o.neighborhood as bairro,
           cat.name       as categoria,
           d.temperature  as temperatura,
           pl.name        as funil,
           st.name        as etapa
      from public.tasks t
      left join public.organizations o on o.id = t.organization_id
      left join public.deals     d  on d.id  = t.deal_id
      left join public.stages    st on st.id = d.stage_id
      left join public.pipelines pl on pl.id = d.pipeline_id
      left join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
      left join public.categories cat on cat.id = pc.category_id
     where t.assignee_id = v_alvo
       and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
       and (o.id is null or (o.deleted_at is null and not o.do_not_contact))
  ),
  negocios as (
    select c.deal_id, c.organization_id, c.organization_name, c.next_action_at,
           (c.card ->> 'temperature')::app.temperature as temperatura,
           coalesce((c.card ->> 'is_rotting')::boolean, false) as parado,
           coalesce((c.card ->> 'days_in_stage')::int, 0)      as dias_na_etapa,
           c.card ->> 'neighborhood'      as bairro,
           c.card ->> 'primary_category'  as categoria,
           c.card ->> 'next_action'       as proxima_acao,
           (c.card ->> 'days_since_contact')::int as dias_sem_contato,
           pl.name       as funil,
           st.name       as etapa,
           st.sla_hours
      from app.deal_cards c
      join public.deals         d  on d.id  = c.deal_id
      join public.organizations o  on o.id  = c.organization_id
      join public.stages        st on st.id = c.stage_id
      join public.pipelines     pl on pl.id = c.pipeline_id
     where c.owner_id = v_alvo
       and c.org_deleted_at is null
       and d.status = 'open'::app.deal_status
       and not o.do_not_contact
       and not st.is_terminal
       -- Negócio com tarefa aberta JÁ está na fila como tarefa: a próxima ação do
       -- negócio e a tarefa são o mesmo compromisso (o registrar_contato cria as
       -- duas juntas). Repetir a empresa em duas linhas transforma a fila do dia
       -- numa lista de coisas que parecem duas e são uma.
       and not exists (select 1 from public.tasks t2
                        where t2.deal_id = c.deal_id
                          and t2.status in ('todo'::app.task_status, 'doing'::app.task_status))
  ),
  itens as (
    -- 1 · reunião ou visita nas próximas 3 h
    select 1, 'reuniao_proxima'::text,
           'Reunião ou visita em menos de 3 h'::text,
           t.title, t.due_at, null::numeric,
           t.id, null::uuid, t.deal_id, t.organization_id,
           t.organizacao, t.bairro, t.categoria, t.temperatura, t.funil, t.etapa
      from tarefas t
     where t.kind in ('meeting'::app.task_kind, 'visit'::app.task_kind)
       and t.due_at is not null
       and t.due_at >= now() and t.due_at < now() + interval '3 hours'

    union all
    -- 2 · interação registrada sem resultado (o gatilho do catálogo marcou)
    select 2, 'desfecho_pendente',
           'Registrada sem resultado: falta dizer o que aconteceu',
           coalesce(o.name, 'Interação sem alvo'),
           a.occurred_at,
           round(extract(epoch from (now() - a.occurred_at)) / 3600.0, 1),
           null::uuid, a.id, a.deal_id, coalesce(a.organization_id, d.organization_id),
           o.name, o.neighborhood, cat.name, d.temperature, pl.name, st.name
      from public.activities a
      left join public.deals         d  on d.id  = a.deal_id
      left join public.organizations o  on o.id  = coalesce(a.organization_id, d.organization_id)
      left join public.stages        st on st.id = d.stage_id
      left join public.pipelines     pl on pl.id = d.pipeline_id
      left join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
      left join public.categories cat on cat.id = pc.category_id
     where a.user_id = v_alvo
       and coalesce((a.metadata ->> 'outcome_pending')::boolean, false)
       and a.occurred_at < now()
       and a.occurred_at > now() - interval '30 days'
       and (o.id is null or o.deleted_at is null)

    union all
    -- 3 / 5 / 9 · tarefas por prazo
    select case
             when t.due_at is null then 9
             when t.due_at < now() then 3
             when (t.due_at at time zone 'America/Fortaleza')::date = v_hoje then 5
             else 9
           end,
           case
             when t.due_at is null then 'tarefa_sem_data'
             when t.due_at < now() then 'tarefa_atrasada'
             when (t.due_at at time zone 'America/Fortaleza')::date = v_hoje then 'tarefa_hoje'
             else 'tarefa_futura'
           end,
           case
             when t.due_at is null then 'Tarefa sem prazo'
             when t.due_at < now() - interval '2 days' then 'Tarefa vencida há '
                  || (v_hoje - (t.due_at at time zone 'America/Fortaleza')::date) || ' dia(s)'
             when t.due_at < now() then 'Tarefa vencida há '
                  || round(extract(epoch from (now() - t.due_at)) / 3600.0) || ' h'
             when (t.due_at at time zone 'America/Fortaleza')::date = v_hoje then 'Tarefa para hoje'
             else 'Tarefa agendada'
           end,
           t.title, t.due_at,
           case when t.due_at < now()
                then round(extract(epoch from (now() - t.due_at)) / 3600.0, 1) end,
           t.id, null::uuid, t.deal_id, t.organization_id,
           t.organizacao, t.bairro, t.categoria, t.temperatura, t.funil, t.etapa
      from tarefas t
     where not (t.kind in ('meeting'::app.task_kind, 'visit'::app.task_kind)
                and t.due_at is not null
                and t.due_at >= now() and t.due_at < now() + interval '3 hours')

    union all
    -- 4 / 6 / 7 / 8 · o negócio entra uma vez só, pelo motivo mais urgente
    select case
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date < v_hoje then 4
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date = v_hoje then 6
             when n.next_action_at is null then 7
             else 8
           end,
           case
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date < v_hoje then 'proxima_acao_atrasada'
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date = v_hoje then 'proxima_acao_hoje'
             when n.next_action_at is null then 'sem_proxima_acao'
             else 'negocio_parado'
           end,
           case
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date < v_hoje
               then 'Próxima ação vencida há '
                    || (v_hoje - (n.next_action_at at time zone 'America/Fortaleza')::date) || ' dia(s)'
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date = v_hoje
               then 'Próxima ação para hoje'
             when n.next_action_at is null
               then 'Negócio aberto sem próxima ação, na etapa ' || n.etapa
             when n.dias_sem_contato is null
               then 'Sem nenhum contato registrado, há ' || n.dias_na_etapa
                    || ' dia(s) na etapa ' || n.etapa
                    || ' (SLA ' || coalesce(n.sla_hours::text, '—') || ' h)'
             else 'Sem contato há ' || n.dias_sem_contato || ' dia(s) na etapa ' || n.etapa
                  || ' (SLA ' || coalesce(n.sla_hours::text, '—') || ' h)'
           end,
           coalesce(n.proxima_acao, n.organization_name),
           n.next_action_at,
           case when n.next_action_at is not null and n.next_action_at < now()
                then round(extract(epoch from (now() - n.next_action_at)) / 3600.0, 1) end,
           null::uuid, null::uuid, n.deal_id, n.organization_id,
           n.organization_name, n.bairro, n.categoria, n.temperatura, n.funil, n.etapa
      from negocios n
     where (n.next_action_at is not null
            and (n.next_action_at at time zone 'America/Fortaleza')::date <= v_hoje)
        or n.next_action_at is null
        or n.parado
  )
  select i.*
    from itens i (prioridade, tipo, motivo, titulo, quando, atraso_horas, task_id, activity_id,
                  deal_id, organization_id, organizacao, bairro, categoria, temperatura, funil, etapa)
   order by i.prioridade,
            case i.temperatura
              when 'quente'::app.temperature        then 4
              when 'cliente_ativo'::app.temperature then 3
              when 'cliente'::app.temperature       then 3
              when 'morno'::app.temperature         then 2
              else 1
            end desc,
            i.quando nulls last,
            i.organizacao
   limit v_limite;
end $$;
comment on function public.meu_dia(uuid, int) is
  'Fila do dia de uma pessoa (RF-MET-03/04), já ordenada por urgência: reunião em menos de 3 h, interação sem resultado, tarefa vencida, próxima ação vencida, tarefa e próxima ação de hoje, negócio sem próxima ação, negócio parado além do SLA e tarefa futura. Cada negócio entra uma vez só, e alvo com do_not_contact fica de fora. Definer: a pessoa lê a própria fila; gestor e admin leem a de qualquer um.';


-- ---------------------------------------------------------------------------
-- 7. Relatórios de leitura (RF-REL-01: toda métrica é uma consulta com dono)
-- ---------------------------------------------------------------------------
-- Todas são SECURITY DEFINER, STABLE, sem PII (nome de empresa não aparece — só
-- agregados por etapa, pessoa, categoria, bairro, fonte e horário) e barradas para
-- o embaixador, cuja visão é a própria carteira (RF-ADM-01). O período é sempre
-- explícito: sem parâmetro, os últimos 30 dias terminando hoje (America/Fortaleza).

-- 7.1 Conversão por etapa do funil (RF-REL-02, RF-REL-04)
-- A conversão é de COORTE: a base são os negócios NASCIDOS no período (primeira
-- linha do histórico de etapas), e conta-se quantos deles já alcançaram cada etapa
-- — inclusive depois do fim do período. Percentual de negócio que ainda está
-- andando não é conversão, é foto tirada cedo demais.
--
-- Etapa é PULADA o tempo todo neste produto: o registro de contato leva o negócio
-- de "Prospectado" direto para "Em conversa" quando o desfecho manda. Por isso a
-- conversão NÃO se calcula sobre quem entrou exatamente na etapa anterior — assim
-- sairiam os 300% que a primeira versão desta função devolveu. Ela se calcula
-- sobre `chegaram_ate`: quantos alcançaram esta etapa OU qualquer etapa adiante
-- dela na linha do funil. Esse número só decresce, e a conversão nunca passa de
-- 100%. `alcancaram` continua exposto ao lado, cru, para quem quiser ver quantos
-- pisaram exatamente ali.
--
-- Perdido, opt-out e nutrição não estão na linha do funil: para eles a conversão
-- vem nula e `chegaram_ate` repete `alcancaram`.
create or replace function public.relatorio_funil(
  p_de          date default null,
  p_ate         date default null,
  p_pipeline_id int  default null)
returns table (
  funil_id              int,
  funil_slug            text,
  funil_nome            text,
  etapa_id              int,
  etapa_slug            text,
  etapa_nome            text,
  posicao               int,
  temperatura           app.temperature,
  sla_horas             int,
  is_ganho              boolean,
  is_perda              boolean,
  is_dormente           boolean,
  na_linha_do_funil     boolean,
  negocios_agora        int,
  negocios_parados      int,
  entradas_no_periodo   int,
  coorte                int,
  alcancaram            int,
  chegaram_ate          int,
  conversao_etapa       numeric,
  conversao_acumulada   numeric,
  mediana_dias_na_etapa numeric,
  p75_dias_na_etapa     numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ate  date;
  v_dei  date;
  v_de   timestamptz;
  v_fim  timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;
  v_ate := coalesce(p_ate, v_hoje);
  v_dei := coalesce(p_de, v_ate - 29);
  v_de  := (v_dei::timestamp) at time zone 'America/Fortaleza';
  v_fim := ((v_ate + 1)::timestamp) at time zone 'America/Fortaleza';

  return query
  with etapas as (
    select s.id, s.pipeline_id, s.slug, s.name, s.position, s.temperature, s.sla_hours,
           s.is_won, s.is_lost, s.is_dormant,
           (not s.is_lost and not s.is_dormant) as linear,
           pl.slug as funil_slug, pl.name as funil_nome
      from public.stages s
      join public.pipelines pl on pl.id = s.pipeline_id
     where p_pipeline_id is null or s.pipeline_id = p_pipeline_id),
  nascimento as (
    select h.deal_id, min(h.changed_at) as nasceu
      from public.deal_stage_history h
     group by h.deal_id),
  coorte_deals as (
    select d.id as deal_id, d.pipeline_id
      from public.deals d
      join nascimento n on n.deal_id = d.id
      join public.organizations o on o.id = d.organization_id
     where o.deleted_at is null
       and n.nasceu >= v_de and n.nasceu < v_fim
       and (p_pipeline_id is null or d.pipeline_id = p_pipeline_id)),
  coorte_total as (
    select cd.pipeline_id, count(*)::int as n from coorte_deals cd group by cd.pipeline_id),
  alcance as (
    select h.to_stage_id as stage_id, count(distinct h.deal_id)::int as n
      from public.deal_stage_history h
      join coorte_deals cd on cd.deal_id = h.deal_id
     group by h.to_stage_id),
  -- "chegou até aqui ou adiante": é o que torna a conversão monótona quando a
  -- etapa é pulada. Só olha as etapas da linha do funil (fora perda e nutrição).
  alcance_ate as (
    select e.id as stage_id, count(distinct h.deal_id)::int as n
      from etapas e
      join public.stages adiante
        on adiante.pipeline_id = e.pipeline_id
       and adiante.position >= e.position
       and not adiante.is_lost and not adiante.is_dormant
      join public.deal_stage_history h on h.to_stage_id = adiante.id
      join coorte_deals cd on cd.deal_id = h.deal_id
     where e.linear
     group by e.id),
  entradas as (
    select h.to_stage_id as stage_id, count(*)::int as n
      from public.deal_stage_history h
     where h.changed_at >= v_de and h.changed_at < v_fim
     group by h.to_stage_id),
  agora as (
    select d.stage_id,
           count(*)::int as n,
           count(*) filter (
             where st.sla_hours is not null
               and coalesce(d.last_activity_at, d.entered_stage_at)
                   < now() - make_interval(hours => st.sla_hours))::int as parados
      from public.deals d
      join public.organizations o on o.id = d.organization_id and o.deleted_at is null
      join public.stages st on st.id = d.stage_id
     group by d.stage_id),
  permanencia as (
    select h.to_stage_id as stage_id,
           percentile_cont(0.50) within group (
             order by extract(epoch from (px.changed_at - h.changed_at)) / 86400.0)::numeric as mediana,
           percentile_cont(0.75) within group (
             order by extract(epoch from (px.changed_at - h.changed_at)) / 86400.0)::numeric as p75
      from public.deal_stage_history h
      join lateral (select min(h2.changed_at) as changed_at
                      from public.deal_stage_history h2
                     where h2.deal_id = h.deal_id
                       and h2.changed_at > h.changed_at) px on px.changed_at is not null
     group by h.to_stage_id),
  linhas as (
    select e.pipeline_id, e.funil_slug, e.funil_nome, e.id, e.slug, e.name, e.position,
           e.temperature, e.sla_hours, e.is_won, e.is_lost, e.is_dormant, e.linear,
           coalesce(ag.n, 0)       as agora_n,
           coalesce(ag.parados, 0) as parados_n,
           coalesce(en.n, 0)       as entradas_n,
           coalesce(ct.n, 0)       as coorte_n,
           coalesce(al.n, 0)       as alcancaram_n,
           coalesce(ate.n, al.n, 0) as ate_n,
           pm.mediana, pm.p75
      from etapas e
      left join coorte_total ct  on ct.pipeline_id = e.pipeline_id
      left join alcance      al  on al.stage_id    = e.id
      left join alcance_ate  ate on ate.stage_id   = e.id
      left join entradas     en  on en.stage_id    = e.id
      left join agora        ag  on ag.stage_id    = e.id
      left join permanencia  pm  on pm.stage_id    = e.id)
  select l.pipeline_id, l.funil_slug, l.funil_nome,
         l.id, l.slug, l.name, l.position, l.temperature, l.sla_hours,
         l.is_won, l.is_lost, l.is_dormant, l.linear,
         l.agora_n, l.parados_n, l.entradas_n,
         l.coorte_n, l.alcancaram_n, l.ate_n,
         -- Partição por `linear` deixa as etapas da linha do funil juntas e em
         -- ordem: o lag é sempre a etapa anterior DA LINHA, nunca "Perdido".
         case
           when not l.linear then null
           when lag(l.ate_n) over (partition by l.pipeline_id, l.linear order by l.position) > 0
             then round(l.ate_n * 100.0
                        / lag(l.ate_n) over (partition by l.pipeline_id, l.linear order by l.position), 1)
         end,
         case when l.coorte_n > 0 then round(l.ate_n * 100.0 / l.coorte_n, 1) end,
         round(l.mediana, 1), round(l.p75, 1)
    from linhas l
   order by l.pipeline_id, l.position;
end $$;
comment on function public.relatorio_funil(date, date, int) is
  'Funil por etapa (RF-REL-02/04): negócios agora, parados, entradas no período, coorte dos negócios nascidos no período, quantos entraram exatamente na etapa (alcancaram) e quantos chegaram até ela ou adiante (chegaram_ate), conversão etapa a etapa e acumulada sobre chegaram_ate, mediana e p75 de dias na etapa. Etapa pulada não infla a conversão; perda, opt-out e nutrição ficam fora da linha do funil e voltam com conversão nula.';


-- 7.2 Produtividade por responsável (RF-REL-06, RF-REL-10)
create or replace function public.relatorio_por_responsavel(
  p_de  date default null,
  p_ate date default null)
returns table (
  pessoa_id                   uuid,
  pessoa_nome                 text,
  papel                       app.user_role,
  alvos_novos                 int,
  portas_batidas              int,
  portas_abertas              int,
  ligacoes                    int,
  visitas                     int,
  reunioes_realizadas         int,
  mensagens                   int,
  reunioes_marcadas           int,
  cadastros_iniciados         int,
  publicados                  int,
  negocios_abertos            int,
  negocios_ganhos             int,
  negocios_perdidos           int,
  negocios_sem_proxima_acao   int,
  negocios_parados            int,
  tarefas_com_prazo           int,
  tarefas_no_prazo            int,
  percentual_no_prazo         numeric,
  tarefas_vencidas_abertas    int,
  mediana_atraso_horas        numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ate  date;
  v_dei  date;
  v_de   timestamptz;
  v_fim  timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;
  v_ate := coalesce(p_ate, v_hoje);
  v_dei := coalesce(p_de, v_ate - 29);
  v_de  := (v_dei::timestamp) at time zone 'America/Fortaleza';
  v_fim := ((v_ate + 1)::timestamp) at time zone 'America/Fortaleza';

  return query
  with pessoas as (
    select p.id, p.full_name, p.role from public.profiles p where p.is_active),
  portas as (
    select pc.user_id,
           count(*) filter (where pc.batida_conta)::int as batidas,
           count(*) filter (where pc.aberta_conta)::int as abertas,
           count(*) filter (where pc.type = 'call'::app.activity_type)::int    as ligacoes,
           count(*) filter (where pc.type = 'visit'::app.activity_type)::int   as visitas,
           count(*) filter (where pc.type = 'meeting'::app.activity_type
                              and coalesce(pc.desfecho, '') <> 'reu_no_show')::int as reunioes,
           count(*) filter (where pc.type = 'message'::app.activity_type)::int as mensagens
      from app.portas_contadas pc
     where pc.user_id is not null
       and pc.occurred_at >= v_de and pc.occurred_at < v_fim
     group by pc.user_id),
  movimentos as (
    select coalesce(h.changed_by, d.owner_id) as pessoa,
           count(*) filter (where s.slug in ('reuniao_marcada', 'demonstracao_marcada'))::int as marcadas,
           count(*) filter (where s.slug = 'cadastro_em_andamento')::int as cadastros,
           count(*) filter (where s.is_won and pl.slug = 'fornecedor')::int as publicados
      from public.deal_stage_history h
      join public.stages    s  on s.id  = h.to_stage_id
      join public.pipelines pl on pl.id = s.pipeline_id
      join public.deals     d  on d.id  = h.deal_id
     where h.changed_at >= v_de and h.changed_at < v_fim
       and coalesce(h.changed_by, d.owner_id) is not null
     group by 1),
  alvos as (
    select o.owner_id as pessoa, count(*)::int as n
      from public.organizations o
     where o.owner_id is not null and o.deleted_at is null
       and o.created_at >= v_de and o.created_at < v_fim
     group by o.owner_id),
  carteira as (
    select d.owner_id as pessoa,
           count(*) filter (where d.status = 'open'::app.deal_status)::int as abertos,
           count(*) filter (where d.status = 'won'::app.deal_status
                              and d.won_at >= v_de and d.won_at < v_fim)::int as ganhos,
           count(*) filter (where d.status = 'lost'::app.deal_status
                              and d.lost_at >= v_de and d.lost_at < v_fim)::int as perdidos,
           count(*) filter (where d.status = 'open'::app.deal_status
                              and d.next_action_at is null and not st.is_terminal)::int as sem_acao,
           count(*) filter (where d.status = 'open'::app.deal_status
                              and st.sla_hours is not null
                              and coalesce(d.last_activity_at, d.entered_stage_at)
                                  < now() - make_interval(hours => st.sla_hours))::int as parados
      from public.deals d
      join public.organizations o on o.id = d.organization_id and o.deleted_at is null
      join public.stages st on st.id = d.stage_id
     where d.owner_id is not null
     group by d.owner_id),
  -- RF-REL-10: a única fórmula de prazo do sistema. Denominador = tarefas com prazo
  -- no período (canceladas fora). Numerador = concluídas até o prazo. A tarefa ainda
  -- aberta e vencida conta como atrasada, e entra na mediana com o atraso até agora.
  prazos as (
    select t.assignee_id as pessoa,
           count(*)::int as com_prazo,
           count(*) filter (where t.completed_at is not null and t.completed_at <= t.due_at)::int as no_prazo,
           count(*) filter (where t.status in ('todo'::app.task_status, 'doing'::app.task_status)
                              and t.due_at < now())::int as vencidas_abertas,
           percentile_cont(0.5) within group (
             order by extract(epoch from (coalesce(t.completed_at, now()) - t.due_at)) / 3600.0)
             filter (where coalesce(t.completed_at, now()) > t.due_at)::numeric as mediana_atraso
      from public.tasks t
     where t.assignee_id is not null
       and t.due_at is not null
       and t.status <> 'cancelled'::app.task_status
       and t.due_at >= v_de and t.due_at < v_fim
     group by t.assignee_id)
  select pe.id, pe.full_name, pe.role,
         coalesce(al.n, 0),
         coalesce(po.batidas, 0), coalesce(po.abertas, 0), coalesce(po.ligacoes, 0),
         coalesce(po.visitas, 0), coalesce(po.reunioes, 0), coalesce(po.mensagens, 0),
         coalesce(mv.marcadas, 0), coalesce(mv.cadastros, 0), coalesce(mv.publicados, 0),
         coalesce(ca.abertos, 0), coalesce(ca.ganhos, 0), coalesce(ca.perdidos, 0),
         coalesce(ca.sem_acao, 0), coalesce(ca.parados, 0),
         coalesce(pz.com_prazo, 0), coalesce(pz.no_prazo, 0),
         case when coalesce(pz.com_prazo, 0) > 0
              then round(coalesce(pz.no_prazo, 0) * 100.0 / pz.com_prazo, 1) end,
         coalesce(pz.vencidas_abertas, 0),
         round(pz.mediana_atraso, 1)
    from pessoas pe
    left join portas     po on po.user_id = pe.id
    left join movimentos mv on mv.pessoa  = pe.id
    left join alvos      al on al.pessoa  = pe.id
    left join carteira   ca on ca.pessoa  = pe.id
    left join prazos     pz on pz.pessoa  = pe.id
   order by coalesce(po.abertas, 0) desc, pe.full_name;
end $$;
comment on function public.relatorio_por_responsavel(date, date) is
  'Atividade e produtividade por pessoa (RF-REL-06) com a fórmula de prazo do RF-REL-10: percentual de tarefas concluídas até o prazo sobre as tarefas com prazo no período, com as vencidas em aberto contando como atrasadas. Carteira (abertos, sem próxima ação, parados) é foto de agora, não do período.';


-- 7.3 Densidade e conversão por categoria (RF-REL-03)
create or replace function public.relatorio_por_categoria(
  p_de  date default null,
  p_ate date default null)
returns table (
  categoria_id            int,
  categoria_slug          text,
  categoria_nome          text,
  grupo                   text,
  prioridade              smallint,
  organizacoes            int,
  com_telefone            int,
  sem_contato             int,
  negocios_abertos        int,
  negocios_quentes        int,
  publicados              int,
  perdidos                int,
  portas_batidas_periodo  int,
  portas_abertas_periodo  int,
  taxa_abertura           numeric,
  etiqueta                text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ate  date;
  v_dei  date;
  v_de   timestamptz;
  v_fim  timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;
  v_ate := coalesce(p_ate, v_hoje);
  v_dei := coalesce(p_de, v_ate - 29);
  v_de  := (v_dei::timestamp) at time zone 'America/Fortaleza';
  v_fim := ((v_ate + 1)::timestamp) at time zone 'America/Fortaleza';

  return query
  with orgs as (
    select o.id, o.phone_e164, pc.category_id
      from public.organizations o
      join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
     where o.deleted_at is null),
  tocadas as (
    select distinct pc.organization_id
      from app.portas_contadas pc
     where pc.organization_id is not null and pc.batida),
  base as (
    select o.category_id,
           count(*)::int as organizacoes,
           count(*) filter (where o.phone_e164 is not null)::int as com_telefone,
           count(*) filter (where t.organization_id is null)::int as sem_contato
      from orgs o
      left join tocadas t on t.organization_id = o.id
     group by o.category_id),
  negocios as (
    select o.category_id,
           count(*) filter (where d.status = 'open'::app.deal_status)::int as abertos,
           count(*) filter (where d.status = 'open'::app.deal_status
                              and d.temperature = 'quente'::app.temperature)::int as quentes,
           count(*) filter (where d.status = 'won'::app.deal_status)::int  as publicados,
           count(*) filter (where d.status = 'lost'::app.deal_status)::int as perdidos
      from public.deals d
      join orgs o on o.id = d.organization_id
     group by o.category_id),
  portas as (
    select o.category_id,
           count(*) filter (where pc.batida_conta)::int as batidas,
           count(*) filter (where pc.aberta_conta)::int as abertas
      from app.portas_contadas pc
      join orgs o on o.id = pc.organization_id
     where pc.occurred_at >= v_de and pc.occurred_at < v_fim
     group by o.category_id)
  select c.id, c.slug, c.name, c."group", c.priority,
         coalesce(b.organizacoes, 0), coalesce(b.com_telefone, 0), coalesce(b.sem_contato, 0),
         coalesce(n.abertos, 0), coalesce(n.quentes, 0), coalesce(n.publicados, 0), coalesce(n.perdidos, 0),
         coalesce(p.batidas, 0), coalesce(p.abertas, 0),
         case when coalesce(p.batidas, 0) > 0
              then round(coalesce(p.abertas, 0) * 100.0 / p.batidas, 1) end,
         -- Etiqueta do RF-REL-03 sobre a meta de 5 publicados por categoria.
         case
           when coalesce(n.publicados, 0) >= 5   then 'fechada'
           when coalesce(b.organizacoes, 0) = 0  then 'sem_alvos'
           when coalesce(b.sem_contato, 0) = 0   then 'em_risco'
           else 'no_ritmo'
         end
    from public.categories c
    left join base     b on b.category_id = c.id
    left join negocios n on n.category_id = c.id
    left join portas   p on p.category_id = c.id
   where c.is_active
   order by c.priority, coalesce(n.publicados, 0) desc, c.name;
end $$;
comment on function public.relatorio_por_categoria(date, date) is
  'Densidade por categoria (RF-REL-03): organizações, com telefone, ainda sem nenhum toque, negócios abertos/quentes, publicados e perdidos, portas do período, taxa de abertura e a etiqueta fechada/no_ritmo/em_risco/sem_alvos sobre a meta de 5 publicados.';


-- 7.4 Por bairro (corte de zona para rota e prospecção)
create or replace function public.relatorio_por_bairro(
  p_de  date default null,
  p_ate date default null)
returns table (
  cidade                  text,
  bairro                  text,
  organizacoes            int,
  com_telefone            int,
  sem_contato             int,
  negocios_abertos        int,
  publicados              int,
  portas_batidas_periodo  int,
  portas_abertas_periodo  int,
  taxa_abertura           numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ate  date;
  v_dei  date;
  v_de   timestamptz;
  v_fim  timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;
  v_ate := coalesce(p_ate, v_hoje);
  v_dei := coalesce(p_de, v_ate - 29);
  v_de  := (v_dei::timestamp) at time zone 'America/Fortaleza';
  v_fim := ((v_ate + 1)::timestamp) at time zone 'America/Fortaleza';

  return query
  with orgs as (
    select o.id, o.phone_e164,
           coalesce(ci.name, 'Sem cidade')  as cidade,
           coalesce(nullif(trim(o.neighborhood), ''), 'Sem bairro') as bairro
      from public.organizations o
      left join public.cities ci on ci.id = o.city_id
     where o.deleted_at is null),
  tocadas as (
    select distinct pc.organization_id
      from app.portas_contadas pc
     where pc.organization_id is not null and pc.batida),
  base as (
    select o.cidade, o.bairro,
           count(*)::int as organizacoes,
           count(*) filter (where o.phone_e164 is not null)::int as com_telefone,
           count(*) filter (where t.organization_id is null)::int as sem_contato
      from orgs o
      left join tocadas t on t.organization_id = o.id
     group by o.cidade, o.bairro),
  negocios as (
    select o.cidade, o.bairro,
           count(*) filter (where d.status = 'open'::app.deal_status)::int as abertos,
           count(*) filter (where d.status = 'won'::app.deal_status)::int  as publicados
      from public.deals d
      join orgs o on o.id = d.organization_id
     group by o.cidade, o.bairro),
  portas as (
    select o.cidade, o.bairro,
           count(*) filter (where pc.batida_conta)::int as batidas,
           count(*) filter (where pc.aberta_conta)::int as abertas
      from app.portas_contadas pc
      join orgs o on o.id = pc.organization_id
     where pc.occurred_at >= v_de and pc.occurred_at < v_fim
     group by o.cidade, o.bairro)
  select b.cidade, b.bairro,
         b.organizacoes, b.com_telefone, b.sem_contato,
         coalesce(n.abertos, 0), coalesce(n.publicados, 0),
         coalesce(p.batidas, 0), coalesce(p.abertas, 0),
         case when coalesce(p.batidas, 0) > 0
              then round(coalesce(p.abertas, 0) * 100.0 / p.batidas, 1) end
    from base b
    left join negocios n on n.cidade = b.cidade and n.bairro = b.bairro
    left join portas   p on p.cidade = b.cidade and p.bairro = b.bairro
   order by b.organizacoes desc, b.bairro;
end $$;
comment on function public.relatorio_por_bairro(date, date) is
  'Cobertura e conversão por bairro: organizações, com telefone, ainda sem toque, negócios abertos, publicados, portas do período e taxa de abertura. Bairro e cidade em branco viram "Sem bairro"/"Sem cidade" em vez de sumirem da conta.';


-- 7.5 Aproveitamento por fonte, com denominador (RF-REL-11)
-- O denominador é a quantidade de ALVOS daquela fonte trazidos no período; os
-- degraus (contatado, respondeu, autorizou, publicou) são contados sem recorte de
-- data, porque um alvo coletado em setembro pode responder em outubro e cortar o
-- degrau pela data do período faria a fonte parecer pior do que é.
create or replace function public.relatorio_por_fonte(
  p_de  date default null,
  p_ate date default null)
returns table (
  fonte_id           int,
  fonte_slug         text,
  fonte_nome         text,
  tipo               app.source_kind,
  alvos              int,
  com_contato_valido int,
  contatados         int,
  responderam        int,
  autorizaram        int,
  publicados         int,
  pct_com_contato    numeric,
  pct_contatados     numeric,
  pct_responderam    numeric,
  pct_autorizaram    numeric,
  pct_publicados     numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ate  date;
  v_dei  date;
  v_de   timestamptz;
  v_fim  timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;
  v_ate := coalesce(p_ate, v_hoje);
  v_dei := coalesce(p_de, v_ate - 29);
  v_de  := (v_dei::timestamp) at time zone 'America/Fortaleza';
  v_fim := ((v_ate + 1)::timestamp) at time zone 'America/Fortaleza';

  return query
  with orgs as (
    select o.id, o.source_id, o.phone_e164
      from public.organizations o
     where o.deleted_at is null
       and o.created_at >= v_de and o.created_at < v_fim),
  batidas as (
    select distinct pc.organization_id from app.portas_contadas pc
     where pc.organization_id is not null and pc.batida),
  abertas as (
    select distinct pc.organization_id from app.portas_contadas pc
     where pc.organization_id is not null and pc.aberta),
  autorizadas as (
    select distinct ce.organization_id from public.consent_events ce
     where ce.organization_id is not null
       and ce.kind = 'data_use_authorized'::app.consent_kind),
  ganhas as (
    select distinct d.organization_id from public.deals d
     where d.status = 'won'::app.deal_status),
  base as (
    select o.source_id,
           count(*)::int as alvos,
           count(*) filter (where o.phone_e164 is not null)::int as com_contato,
           count(*) filter (where b.organization_id  is not null)::int as contatados,
           count(*) filter (where ab.organization_id is not null)::int as responderam,
           count(*) filter (where au.organization_id is not null)::int as autorizaram,
           count(*) filter (where g.organization_id  is not null)::int as publicados
      from orgs o
      left join batidas     b  on b.organization_id  = o.id
      left join abertas     ab on ab.organization_id = o.id
      left join autorizadas au on au.organization_id = o.id
      left join ganhas      g  on g.organization_id  = o.id
     group by o.source_id)
  select s.id, s.slug, s.name, s.kind,
         coalesce(b.alvos, 0), coalesce(b.com_contato, 0), coalesce(b.contatados, 0),
         coalesce(b.responderam, 0), coalesce(b.autorizaram, 0), coalesce(b.publicados, 0),
         case when coalesce(b.alvos, 0) > 0 then round(b.com_contato * 100.0 / b.alvos, 1) end,
         case when coalesce(b.alvos, 0) > 0 then round(b.contatados  * 100.0 / b.alvos, 1) end,
         case when coalesce(b.alvos, 0) > 0 then round(b.responderam * 100.0 / b.alvos, 1) end,
         case when coalesce(b.alvos, 0) > 0 then round(b.autorizaram * 100.0 / b.alvos, 1) end,
         case when coalesce(b.alvos, 0) > 0 then round(b.publicados  * 100.0 / b.alvos, 1) end
    from public.sources s
    left join base b on b.source_id = s.id
   order by coalesce(b.alvos, 0) desc, s.name;
end $$;
comment on function public.relatorio_por_fonte(date, date) is
  'Aproveitamento por fonte com denominador (RF-REL-11): alvos trazidos no período, com contato válido, contatados, que responderam, que autorizaram e que publicaram, em número e em percentual dos alvos. Os degraus não têm recorte de data — o alvo coletado no período pode responder depois.';


-- 7.6 Eficiência por faixa de horário do contato (RF-REL-06)
-- Faixas de duas horas no fuso America/Fortaleza, por superfície (WhatsApp,
-- ligação, visita, reunião, DM). É o número que decide a que horas ligar.
create or replace function public.relatorio_por_horario(
  p_de  date default null,
  p_ate date default null)
returns table (
  faixa          text,
  hora_inicio    int,
  superficie     app.interaction_surface,
  toques         int,
  portas_batidas int,
  portas_abertas int,
  taxa_abertura  numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ate  date;
  v_dei  date;
  v_de   timestamptz;
  v_fim  timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;
  v_ate := coalesce(p_ate, v_hoje);
  v_dei := coalesce(p_de, v_ate - 29);
  v_de  := (v_dei::timestamp) at time zone 'America/Fortaleza';
  v_fim := ((v_ate + 1)::timestamp) at time zone 'America/Fortaleza';

  return query
  select lpad(((pc.hora / 2) * 2)::text, 2, '0') || 'h–'
         || lpad(((pc.hora / 2) * 2 + 2)::text, 2, '0') || 'h',
         (pc.hora / 2) * 2,
         pc.superficie,
         count(*)::int,
         count(*) filter (where pc.batida_conta)::int,
         count(*) filter (where pc.aberta_conta)::int,
         case when count(*) filter (where pc.batida_conta) > 0
              then round(count(*) filter (where pc.aberta_conta) * 100.0
                         / count(*) filter (where pc.batida_conta), 1) end
    from app.portas_contadas pc
   where pc.superficie is not null
     and pc.occurred_at >= v_de and pc.occurred_at < v_fim
   group by (pc.hora / 2) * 2, pc.superficie
   order by (pc.hora / 2) * 2, pc.superficie;
end $$;
comment on function public.relatorio_por_horario(date, date) is
  'Portas por faixa de duas horas (America/Fortaleza) e por superfície (RF-REL-06): toques, portas batidas, portas abertas e taxa de abertura. É o número que decide a que horas ligar.';


-- ---------------------------------------------------------------------------
-- 8. Privilégios
-- ---------------------------------------------------------------------------
-- Projeções internas: `authenticated` tem USAGE em `app` (migração 000100), então
-- é preciso revogar explicitamente — senão sdr e embaixador leriam por aqui o alvo
-- de toda atividade, contornando a máscara do RF-BAS-14.
revoke all on app.portas          from public, anon, authenticated;
revoke all on app.portas_contadas from public, anon, authenticated;

-- Funções de gatilho não são superfície de API (padrão da migração 000500).
revoke all on function app.goals_before_write() from public, anon, authenticated;

revoke all on function app.business_days(date, date)              from public, anon;
revoke all on function app.goal_bounds(app.goal_period, date)     from public, anon;
grant execute on function app.business_days(date, date)           to authenticated, service_role;
grant execute on function app.goal_bounds(app.goal_period, date)  to authenticated, service_role;

revoke all on function public.goal_progress(uuid, app.goal_period, date) from public, anon;
revoke all on function public.meu_dia(uuid, int)                         from public, anon;
revoke all on function public.relatorio_funil(date, date, int)           from public, anon;
revoke all on function public.relatorio_por_responsavel(date, date)      from public, anon;
revoke all on function public.relatorio_por_categoria(date, date)        from public, anon;
revoke all on function public.relatorio_por_bairro(date, date)           from public, anon;
revoke all on function public.relatorio_por_fonte(date, date)            from public, anon;
revoke all on function public.relatorio_por_horario(date, date)          from public, anon;

grant execute on function public.goal_progress(uuid, app.goal_period, date) to authenticated, service_role;
grant execute on function public.meu_dia(uuid, int)                         to authenticated, service_role;
grant execute on function public.relatorio_funil(date, date, int)           to authenticated, service_role;
grant execute on function public.relatorio_por_responsavel(date, date)      to authenticated, service_role;
grant execute on function public.relatorio_por_categoria(date, date)        to authenticated, service_role;
grant execute on function public.relatorio_por_bairro(date, date)           to authenticated, service_role;
grant execute on function public.relatorio_por_fonte(date, date)            to authenticated, service_role;
grant execute on function public.relatorio_por_horario(date, date)          to authenticated, service_role;

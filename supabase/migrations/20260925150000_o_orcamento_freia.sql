-- =====================================================================
-- O orçamento de IA deixa de avisar e passa a FREIAR
-- =====================================================================
-- POR QUE ESTA MIGRAÇÃO EXISTE. Até hoje o freio do gasto de IA só avisa:
-- `app.ai_alerta_orcamento` roda num cron diário (`0 12 * * *`), abre uma
-- tarefa e não bloqueia nada. Nenhum caminho entre a fila e a API da
-- Anthropic pergunta quanto já se gastou. Isso funcionava porque havia uma
-- pessoa no meio: ela via a conta e parava. A Fase 4 tira a pessoa do meio.
-- Então o freio tem de existir ANTES de existir o que freiar.
--
-- O TETO SOBE E PASSA A DOER. `ia.orcamento.mensal_usd` sai de US$ 25 para
-- US$ 60 (decisão de Rafael, 25/09/2026) e deixa de nascer pendente. Subir o
-- teto no mesmo gesto em que ele passa a bloquear não é afrouxamento: hoje
-- US$ 25 é um número que ninguém tinha confirmado, e um número não confirmado
-- que começa a recusar chamada é uma parada de produção esperando acontecer.
-- Mudar daqui para a frente é `update` do gestor em `app_settings`, não
-- deploy — dinheiro não se muda por migração.
--
-- AS DUAS LINHAS SÃO DERIVADAS, e não escritas em lugar nenhum:
--   linha de alerta = mensal_usd x fracao_alerta   (hoje US$ 48)
--   linha do freio  = mensal_usd                    (hoje US$ 60)
-- Quem mexer no teto move as duas juntas. Guardar 48 em algum campo seria
-- criar uma segunda fonte para o mesmo fato.
--
-- A CASCATA DA SITUAÇÃO ganha um degrau no topo: freou > passou_de_80 >
-- ritmo_acima > ok. A ordem importa e é a mesma de antes — quem já passou do
-- acumulado passou, tenha o ritmo que tiver.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O teto, decidido
-- ---------------------------------------------------------------------
-- `fracao_alerta` e `dias_minimos_para_ritmo` ficam intactos: o validador
-- `app.app_settings_validate` exige `mensal_usd` positivo e `fracao_alerta`
-- em (0, 1], e um `jsonb_build_object` novo apagaria o que não foi citado.
update public.app_settings
   set value = value
               || jsonb_build_object('mensal_usd', 60, 'pendente_de_aprovacao', false),
       description = 'Orçamento mensal só de IA, em US$ (PRD §10; ADR-10). 60 desde 25/09/2026, decidido por Rafael — e desde então ele BLOQUEIA, não só avisa. fracao_alerta = a linha de alerta (80% do teto), a partir da qual param os propósitos que não são de atendimento; o teto inteiro é a linha do freio, a partir da qual não sai chamada nenhuma. dias_minimos_para_ritmo = a partir de quantos dias úteis o alerta de RITMO passa a valer.'
 where key = 'ia.orcamento';

-- ---------------------------------------------------------------------
-- 2. Onde o mês está — agora com a linha do freio
-- ---------------------------------------------------------------------
create or replace function app.ai_gasto_do_mes(p_ref date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje      date    := (now() at time zone 'America/Fortaleza')::date;
  v_ref       date    := coalesce(p_ref, v_hoje);
  v_ini       date    := date_trunc('month', v_ref)::date;
  v_fim       date    := (date_trunc('month', v_ref) + interval '1 month - 1 day')::date;
  -- Até hoje quando o mês é o corrente; o mês inteiro quando já passou.
  v_ate       date    := least(v_fim, greatest(v_ini, case when v_ref >= v_hoje then v_hoje else v_ref end));
  v_cfg       jsonb;
  v_orc       numeric;
  v_frac      numeric;
  v_gasto     numeric;
  v_chamadas  int;
  v_bloq      int;
  v_du_mes    int;
  v_du_ate    int;
  v_proj      numeric;
  v_sit       text;
  v_por       jsonb;
begin
  select s.value into v_cfg from public.app_settings s where s.key = 'ia.orcamento';
  -- O padrão do `coalesce` é o mesmo valor da linha de `app_settings`: se
  -- alguém apagar a linha, o freio continua existindo em vez de sumir.
  v_orc  := coalesce((v_cfg ->> 'mensal_usd')::numeric, 60);
  v_frac := coalesce((v_cfg ->> 'fracao_alerta')::numeric, 0.8);

  select coalesce(sum(r.cost_usd), 0),
         count(*)::int,
         count(*) filter (where r.status = 'bloqueado')::int
    into v_gasto, v_chamadas, v_bloq
    from public.ai_runs r
   where (r.created_at at time zone 'America/Fortaleza')::date between v_ini and v_ate;

  select coalesce(jsonb_object_agg(t.purpose, jsonb_build_object('chamadas', t.n, 'usd', t.usd)), '{}'::jsonb)
    into v_por
    from (select r.purpose, count(*)::int as n, round(sum(r.cost_usd), 5) as usd
            from public.ai_runs r
           where (r.created_at at time zone 'America/Fortaleza')::date between v_ini and v_ate
           group by r.purpose) t;

  v_du_mes := greatest(app.business_days(v_ini, v_fim), 1);
  v_du_ate := greatest(least(app.business_days(v_ini, v_ate), v_du_mes), 1);
  v_proj   := round((v_gasto / v_du_ate) * v_du_mes, 2);

  -- A ordem importa: quem já passou do teto parou, quem passou de 80% do
  -- acumulado passou tenha o ritmo que tiver, e `ritmo_acima` é o aviso de
  -- quem ainda não passou de nada.
  v_sit := case
             when v_gasto >= v_orc          then 'freou'
             when v_gasto >= v_orc * v_frac then 'passou_de_80'
             when v_proj  >  v_orc          then 'ritmo_acima'
             else                                'ok'
           end;

  return jsonb_build_object(
    'mes',                 to_char(v_ini, 'YYYY-MM'),
    'ate',                 v_ate,
    'gasto_usd',           round(v_gasto, 5),
    'chamadas',            v_chamadas,
    'bloqueadas',          v_bloq,
    'orcamento_usd',       v_orc,
    'limite_de_alerta_usd', round(v_orc * v_frac, 2),
    'linha_do_freio_usd',  v_orc,
    'dias_uteis_do_mes',   v_du_mes,
    'dias_uteis_decorridos', v_du_ate,
    'projecao_do_mes_usd', v_proj,
    'situacao',            v_sit,
    'por_proposito',       v_por);
end $$;
comment on function app.ai_gasto_do_mes(date) is
  'Onde o mês está: gasto acumulado, projeção do fechamento pelo ritmo dos dias úteis decorridos e a situação (ok | ritmo_acima | passou_de_80 | freou). As duas linhas são derivadas do teto de app_settings: alerta = mensal_usd x fracao_alerta, freio = mensal_usd. O denominador da projeção são os dias úteis REAIS do mês (app.business_days), não os 21 fixos do TypeScript de packages/prompts.';

-- ---------------------------------------------------------------------
-- 3. O registro do alerta aceita o degrau novo
-- ---------------------------------------------------------------------
alter table public.ai_budget_alerts drop constraint if exists ai_budget_alerts_situacao_check;
alter table public.ai_budget_alerts
  add constraint ai_budget_alerts_situacao_check
  check (situacao in ('ritmo_acima', 'passou_de_80', 'freou'));

-- E o alerta sabe dizer o nome do degrau novo. A frase importa: "passou de
-- 80%" e "o mês acabou" pedem coisas diferentes de quem lê a tarefa.
create or replace function app.ai_alerta_orcamento()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado jsonb := app.ai_gasto_do_mes(null);
  v_sit    text  := v_estado ->> 'situacao';
  v_mes    text  := v_estado ->> 'mes';
  v_min    int;
  v_dono   uuid;
  v_task   uuid;
begin
  if v_sit = 'ok' then
    return jsonb_build_object('alertou', false, 'motivo', 'dentro_do_orcamento', 'estado', v_estado);
  end if;

  -- O piso de dias úteis: só o alerta de RITMO espera. O de 80% do acumulado
  -- e o do freio não esperam nada — se o mês já gastou tudo no segundo dia, é
  -- justamente o segundo dia que precisa saber.
  select coalesce((s.value ->> 'dias_minimos_para_ritmo')::int, 3) into v_min
    from public.app_settings s where s.key = 'ia.orcamento';
  if v_sit = 'ritmo_acima' and (v_estado ->> 'dias_uteis_decorridos')::int < coalesce(v_min, 3) then
    return jsonb_build_object('alertou', false, 'motivo', 'poucos_dias_para_projetar', 'estado', v_estado);
  end if;

  if exists (select 1 from public.ai_budget_alerts a where a.mes = v_mes and a.situacao = v_sit) then
    return jsonb_build_object('alertou', false, 'motivo', 'ja_alertado', 'estado', v_estado);
  end if;

  -- A tarefa é como este banco fala com uma pessoa (mesmo caminho de
  -- app.precadastros_lembrete). Vai para um admin ativo; sem admin, o
  -- alerta ainda é gravado — perder o registro seria pior que perder o aviso.
  select p.id into v_dono
    from public.profiles p
   where p.is_active and p.role = 'admin'::app.user_role
   order by p.created_at
   limit 1;

  if v_dono is not null then
    insert into public.tasks (title, kind, due_at, assignee_id, origin, priority)
    values (case v_sit
              when 'freou'        then 'Orçamento de IA: o mês acabou e as chamadas estão bloqueadas'
              when 'passou_de_80' then 'Orçamento de IA: passou de 80% do teto do mês'
              else 'Orçamento de IA: o ritmo do mês projeta estouro'
            end
            || ' (' || v_mes || ') — gasto US$ ' || (v_estado ->> 'gasto_usd')
            || ', projeção US$ ' || (v_estado ->> 'projecao_do_mes_usd')
            || ' sobre teto de US$ ' || (v_estado ->> 'orcamento_usd'),
            'other'::app.task_kind,
            now(), v_dono, 'system', 1)
    returning id into v_task;
  end if;

  insert into public.ai_budget_alerts (mes, situacao, gasto_usd, projecao_usd, orcamento_usd, task_id)
  values (v_mes, v_sit,
          (v_estado ->> 'gasto_usd')::numeric,
          (v_estado ->> 'projecao_do_mes_usd')::numeric,
          (v_estado ->> 'orcamento_usd')::numeric,
          v_task)
  on conflict (mes, situacao) do nothing;

  return jsonb_build_object('alertou', true, 'situacao', v_sit, 'task_id', v_task, 'estado', v_estado);
end $$;
comment on function app.ai_alerta_orcamento() is
  'Emite, uma vez por mês e por nível, o alerta de orçamento de IA: freou (o teto inteiro), passou_de_80 (o do PRD §10) e ritmo_acima (a projeção pelo ritmo, que é a que chega a tempo num orçamento pequeno). Cria tarefa para um admin e grava a linha em ai_budget_alerts. Idempotente por (mês, situação).';

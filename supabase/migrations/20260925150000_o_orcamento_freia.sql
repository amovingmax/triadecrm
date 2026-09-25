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

  -- O mês pode pular direto de `ok` para `freou` — um lote de Batch API que
  -- fecha entre duas passadas do cron faz exatamente isso. Sem esta linha, o
  -- registro de "passamos de 80%" nunca existiria para esse mês, e quem for
  -- olhar a história depois veria um freio sem aviso antes. A tarefa é uma
  -- só, a do degrau de agora; a linha de 80% nasce sem tarefa de propósito.
  if v_sit = 'freou' then
    insert into public.ai_budget_alerts (mes, situacao, gasto_usd, projecao_usd, orcamento_usd, task_id)
    values (v_mes, 'passou_de_80',
            (v_estado ->> 'gasto_usd')::numeric,
            (v_estado ->> 'projecao_do_mes_usd')::numeric,
            (v_estado ->> 'orcamento_usd')::numeric,
            null)
    on conflict (mes, situacao) do nothing;
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


-- ---------------------------------------------------------------------
-- 4. O freio: `app.ia_pode_gastar`
-- ---------------------------------------------------------------------
-- A REGRA É POR EXCLUSÃO, e é de propósito. Sobrevivem à linha de alerta
-- apenas `classify_inbound` e `transcribe_audio` — os dois únicos propósitos
-- que servem para entender quem escreveu AGORA. Todo o resto para. Escrita
-- assim, a lista dos que param não existe em lugar nenhum: um propósito novo
-- entra no lado seguro sozinho, sem ninguém se lembrar de acrescentá-lo.
-- Escrita ao contrário (uma lista dos que param), o propósito novo nasceria
-- livre, e o dia em que alguém esquecer é o dia em que o freio deixa de valer.
--
-- Os dois degraus:
--   gasto >= linha de alerta (US$ 48)  → param os 12
--   gasto >= linha do freio  (US$ 60)  → param todos, os 14
--
-- MORA NO POSTGRES, e não no worker: o teto é `app_settings`, e o freio tem
-- de mudar junto com ele sem deploy (ADR-03).
create or replace function app.ia_pode_gastar(p_purpose text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_estado jsonb := app.ai_gasto_do_mes(null);
  v_gasto  numeric := (v_estado ->> 'gasto_usd')::numeric;
  v_freio  numeric := (v_estado ->> 'linha_do_freio_usd')::numeric;
  v_alerta numeric := (v_estado ->> 'limite_de_alerta_usd')::numeric;
  v_pode   boolean;
  v_motivo text;
begin
  if v_gasto >= v_freio then
    v_pode := false;
    v_motivo := 'orcamento_esgotado';
  elsif v_gasto >= v_alerta
        and p_purpose is distinct from 'classify_inbound'
        and p_purpose is distinct from 'transcribe_audio' then
    v_pode := false;
    v_motivo := 'orcamento_na_linha_de_alerta';
  else
    v_pode := true;
    v_motivo := null;
  end if;

  return jsonb_build_object(
    'pode',                 v_pode,
    'motivo',               v_motivo,
    'purpose',              p_purpose,
    'gasto_usd',            v_gasto,
    'linha_de_alerta_usd',  v_alerta,
    'teto_usd',             v_freio,
    'situacao',             v_estado ->> 'situacao');
end $$;
comment on function app.ia_pode_gastar(text) is
  'Diz se ainda dá para gastar com este propósito. Dois degraus: na linha de alerta (80% do teto) param os propósitos que não são de atendimento; no teto inteiro param todos. A regra é por EXCLUSÃO — sobrevivem ao primeiro degrau só classify_inbound e transcribe_audio —, para que um propósito novo nasça no lado seguro.';
revoke all on function app.ia_pode_gastar(text) from public, anon, authenticated;
grant execute on function app.ia_pode_gastar(text) to service_role;

-- Quem são os que param na linha de alerta, hoje. Não é uma segunda lista:
-- a função PERGUNTA à `ia_pode_gastar`, propósito a propósito. Existe para a
-- tela poder dizer o que parou, e para o pgTAP poder nomeá-los um a um.
create or replace function app.ia_gasto_bloqueado_para()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p order by p), array[]::text[])
    from unnest(array['transcribe_audio', 'summarize_call', 'draft_followup', 'classify_inbound',
                      'draft_reply', 'summarize_deal', 'next_action', 'digest',
                      'extract_listing', 'assistant',
                      'analisar_conversa', 'pulso_do_dia', 'perguntar_ao_crm',
                      'triar_candidato']) as p
   where not coalesce((app.ia_pode_gastar(p) ->> 'pode')::boolean, false)
$$;
comment on function app.ia_gasto_bloqueado_para() is
  'Os propósitos que o freio está recusando neste instante, perguntados um a um a app.ia_pode_gastar. Para a tela dizer o que parou; nunca para decidir — quem decide é a ia_pode_gastar.';
revoke all on function app.ia_gasto_bloqueado_para() from public, anon, authenticated;
grant execute on function app.ia_gasto_bloqueado_para() to service_role;

-- A casca para quem só alcança o schema `public`: o PostgREST não expõe
-- `app`, e é por RPC que o worker pergunta. Mesmo motivo (e mesmo grant) de
-- `public.ia_fila_enfileirar`.
create or replace function public.ia_pode_gastar(p_purpose text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app.ia_pode_gastar(p_purpose)
$$;
comment on function public.ia_pode_gastar(text) is
  'Casca de app.ia_pode_gastar para o worker-ai perguntar, antes de chamar o modelo, se ainda dá para gastar.';
revoke all on function public.ia_pode_gastar(text) from public, anon, authenticated;
grant execute on function public.ia_pode_gastar(text) to service_role;


-- ---------------------------------------------------------------------
-- 5. A dívida do orçamento
-- ---------------------------------------------------------------------
-- POR QUE ESTA TABELA EXISTE. `app.ia_enfileirar_resumo` roda DENTRO da
-- transação de `public.tabular_tentativa`: quem acabou de registrar uma
-- ligação commita a tabulação e, se o freio recusar, o `summarize_call`
-- daquela tentativa NUNCA MAIS é pedido — não há cron que o repita. Recusar
-- sem anotar não é "não gastar", é perder o trabalho em silêncio, que é pior
-- que gastar: o gasto aparece na conta, a perda não aparece em lugar nenhum.
--
-- Os cinco chamadores de `app.ia_enfileirar`, conferidos um a um:
--   `ia_enfileirar_analises` (cron */5) e `triar_candidato` (clique) refazem a
--   chave sozinhos na passada seguinte — não perdem nada. `ia_enfileirar_pulso`
--   perde o pulso daquele dia, e o de amanhã nasce. `ia_enfileirar_resumo` e os
--   dois pedidos do worker (`classify_inbound` depois da transcrição,
--   `draft_followup` depois do resumo) perdem para sempre.
--
-- A recusa continua sem `raise`. O que muda é que ela deixa rastro: a mesma
-- transação que grava a tabulação grava a dívida, e um cron a paga quando o
-- mês voltar a caber. A chave é a de `ingest_dedup` ("<propósito>:<chave>"),
-- então anotar duas vezes o mesmo trabalho é uma linha só.
create table if not exists public.ia_trabalho_adiado (
  chave        text primary key,
  purpose      text not null,
  payload      jsonb not null default '{}'::jsonb,
  chave_crua   text not null,
  motivo       text not null,
  tentativas   int  not null default 0,
  adiado_em    timestamptz not null default now(),
  retomado_em  timestamptz
);
comment on table public.ia_trabalho_adiado is
  'O que o freio do orçamento recusou e não pode se perder (Fase 3 do pivô). A chave é a de ingest_dedup. Paga por app.ia_retomar_adiados, no cron ia_retomar_adiados.';
create index if not exists ia_trabalho_adiado_pendentes_idx
  on public.ia_trabalho_adiado (adiado_em) where retomado_em is null;

alter table public.ia_trabalho_adiado enable row level security;
drop policy if exists ia_trabalho_adiado_select on public.ia_trabalho_adiado;
create policy ia_trabalho_adiado_select on public.ia_trabalho_adiado
  for select to authenticated
  using ((select app.role()) in ('admin'::app.user_role, 'gestor'::app.user_role,
                                 'financeiro'::app.user_role));

-- Paga a dívida, do mais antigo para o mais novo. Pergunta ao freio a cada
-- linha, e não uma vez para o lote: o mês pode acabar no meio do lote, e
-- reenfileirar o resto seria furar o próprio freio que acabou de fechar.
create or replace function app.ia_retomar_adiados(p_limite int default 50)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      public.ia_trabalho_adiado%rowtype;
  v_res  jsonb;
  v_n    int := 0;
begin
  for r in select * from public.ia_trabalho_adiado
            where retomado_em is null
            order by adiado_em
            limit greatest(coalesce(p_limite, 50), 1)
            for update skip locked loop
    if not coalesce((app.ia_pode_gastar(r.purpose) ->> 'pode')::boolean, false) then
      exit;
    end if;
    -- Chama `esteira_enfileirar` e não `ia_enfileirar`: a chave já vem pronta
    -- (é a que foi anotada), e passar por `ia_enfileirar` de novo faria a
    -- concatenação do propósito duas vezes.
    v_res := app.esteira_enfileirar('ai_jobs',
               jsonb_build_object('purpose', r.purpose) || coalesce(r.payload, '{}'::jsonb),
               r.chave);
    update public.ia_trabalho_adiado
       set tentativas = tentativas + 1,
           retomado_em = case when coalesce((v_res ->> 'enfileirado')::boolean, false)
                              then now() else null end
     where chave = r.chave;
    if coalesce((v_res ->> 'enfileirado')::boolean, false) then
      v_n := v_n + 1;
    end if;
  end loop;
  -- Dívida paga há mais de 30 dias não é dívida, é história de custo.
  delete from public.ia_trabalho_adiado
   where retomado_em is not null and retomado_em < now() - interval '30 days';
  return v_n;
end $$;
comment on function app.ia_retomar_adiados(int) is
  'Paga a dívida que o freio do orçamento deixou: reenfileira o que foi recusado, do mais antigo para o mais novo, perguntando ao freio a cada linha. Roda no cron ia_retomar_adiados, de 20 em 20 minutos.';
revoke all on function app.ia_retomar_adiados(int) from public, anon, authenticated;
grant execute on function app.ia_retomar_adiados(int) to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ia_retomar_adiados', '*/20 * * * *',
                          $cron$select app.ia_retomar_adiados(50)$cron$);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 6. A fila pergunta ao freio antes de enfileirar
-- ---------------------------------------------------------------------
-- SEM `raise`, e isso é essencial: `app.ia_enfileirar_resumo` roda DENTRO da
-- transação de `public.tabular_tentativa` (20260906000100:358). Uma exceção
-- aqui abortaria a tabulação da ligação que a pessoa acabou de registrar —
-- perder o trabalho dela para economizar centavos de IA seria trocar caro por
-- barato. A recusa volta como `{enfileirado:false, motivo:'orcamento'}`, na
-- mesma forma de `app.esteira_enfileirar`.
--
-- O propósito desconhecido continua EXPLODINDO com 22023: aquilo é erro de
-- programação, não estado do mês, e tem de doer na hora.
create or replace function app.ia_enfileirar(p_purpose text, p_payload jsonb, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_freio jsonb;
begin
  if p_purpose not in ('transcribe_audio', 'summarize_call', 'draft_followup', 'classify_inbound',
                       'draft_reply', 'summarize_deal', 'next_action', 'digest',
                       'extract_listing', 'assistant',
                       'analisar_conversa', 'pulso_do_dia', 'perguntar_ao_crm',
                       'triar_candidato') then
    raise exception 'Propósito % não existe em ai_runs.purpose: gasto que ninguém nomeou é gasto que ninguém orçou', p_purpose
      using errcode = '22023';
  end if;

  v_freio := app.ia_pode_gastar(p_purpose);
  if not coalesce((v_freio ->> 'pode')::boolean, false) then
    -- A recusa deixa rastro NA MESMA TRANSAÇÃO de quem chamou. Se ela abortar,
    -- a dívida aborta junto — que é o certo: não houve trabalho a dever.
    insert into public.ia_trabalho_adiado (chave, purpose, payload, chave_crua, motivo)
    values (p_purpose || ':' || p_key, p_purpose, coalesce(p_payload, '{}'::jsonb),
            p_key, coalesce(v_freio ->> 'motivo', 'orcamento'))
    on conflict (chave) do nothing;
    return jsonb_build_object('enfileirado', false, 'motivo', 'orcamento',
                              'detalhe', v_freio ->> 'motivo', 'adiado', true);
  end if;

  return app.esteira_enfileirar('ai_jobs',
                                jsonb_build_object('purpose', p_purpose) || coalesce(p_payload, '{}'::jsonb),
                                p_purpose || ':' || p_key);
end $$;
comment on function app.ia_enfileirar(text, jsonb, text) is
  'Porta única da fila de IA: confere a lista de propósitos (o CHECK de ai_runs protege a gravação; este if protege a FILA, que é onde o gasto nasce) e pergunta ao freio do orçamento. Recusa por orçamento volta como {enfileirado:false, motivo:"orcamento"}, nunca como exceção — roda dentro da transação de quem chamou.';

-- ---------------------------------------------------------------------
-- 7. O painel diz o que está parado
-- ---------------------------------------------------------------------
create or replace function public.ia_orcamento_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parados text[];
begin
  if auth.uid() is null
     or app.role() not in ('admin'::app.user_role, 'gestor'::app.user_role, 'financeiro'::app.user_role) then
    raise exception 'Sem permissão para ver o orçamento de IA' using errcode = '42501';
  end if;
  v_parados := app.ia_gasto_bloqueado_para();
  return app.ai_gasto_do_mes(null)
         || jsonb_build_object(
              'freado', (app.ai_gasto_do_mes(null) ->> 'situacao') = 'freou',
              'parados', coalesce(array_length(v_parados, 1), 0),
              'propositos_parados', to_jsonb(v_parados),
              'alertas_do_mes',
              coalesce((select jsonb_agg(jsonb_build_object('situacao', a.situacao, 'quando', a.created_at)
                                         order by a.created_at)
                          from public.ai_budget_alerts a
                         where a.mes = to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM')),
                       '[]'::jsonb));
end $$;
comment on function public.ia_orcamento_status() is
  'Painel do custo de IA para admin, gestor e financeiro: gasto do mês, projeção pelo ritmo, situação, quebra por propósito, os alertas já emitidos e — desde a Fase 3 — se o mês está freado e quais propósitos o freio está recusando agora.';
revoke all on function public.ia_orcamento_status() from public, anon;
grant execute on function public.ia_orcamento_status() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 8. O outro dinheiro: o que a Meta cobra de SERVIÇO
-- ---------------------------------------------------------------------
-- O orçamento de IA não é a única conta que a Fase 4 faz crescer. Toda
-- resposta que sai dentro da janela de 24 h — que é tudo o que um robô
-- autônomo faz — abre ou mantém uma conversa de SERVIÇO, e a Meta cobra por
-- ela. É o contrário exato de `app.iniciadas_pela_empresa`: aquela conta o
-- que a empresa começou; esta conta o que a empresa respondeu.
--
-- NESTA FASE ELA SÓ MEDE. Um teto sem número medido seria um palpite, e um
-- palpite que recusa mensagem de cliente é pior que nenhum teto. Primeiro se
-- olha a curva por dois meses; o teto, se vier, vem depois e com número.
--
-- `security_invoker = false` com o filtro de papel escrito à mão, no molde de
-- `public.wa_confirmacoes_devidas` (20260905000400:759): a pergunta é de
-- custo, e custo é de quem paga a conta.
drop view if exists public.wa_servico_do_mes;
create view public.wa_servico_do_mes
with (security_barrier = true, security_invoker = false) as
select to_char((coalesce(m.sent_at, m.created_at) at time zone 'America/Fortaleza')::date,
               'YYYY-MM')                                as mes,
       c.business_number                                 as numero,
       count(*)::int                                     as mensagens_de_servico,
       count(distinct m.conversation_id)::int            as conversas,
       min(coalesce(m.sent_at, m.created_at))            as primeira,
       max(coalesce(m.sent_at, m.created_at))            as ultima
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
 where m.direction = 'out'::app.msg_direction
   and not m.business_initiated
   and m.status <> 'failed'::app.msg_status
   and (select app.role()) in ('admin'::app.user_role, 'gestor'::app.user_role,
                               'financeiro'::app.user_role)
 group by 1, 2;
comment on view public.wa_servico_do_mes is
  'Quanto WhatsApp de SERVIÇO sai por mês e por número: saída dentro da janela de 24 h, que é o que a Meta cobra como conversa de serviço e o que um robô autônomo mais produz. O contrário exato de app.iniciadas_pela_empresa. Na Fase 3 ela só MEDE — teto sem número medido é palpite.';
revoke all on public.wa_servico_do_mes from public, anon;
grant select on public.wa_servico_do_mes to authenticated, service_role;

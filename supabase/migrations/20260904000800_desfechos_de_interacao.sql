-- =====================================================================
-- KOMUNE CRM — v0.1 — D3 — Catálogo de desfechos de interação
-- (RF-FUN-12 catálogo e RF-FUN-13 janela de recontato; alimenta RF-MET-06,
--  RF-MET-01/04, RF-FUN-03/04, RF-CON-08, RF-REL-02/06).
-- Especificação: docs/design/spec-desfechos-de-interacao.md
--
-- O problema: `activities.outcome` nasceu `text` livre (migração 000300, com os
-- valores só num comentário). Com 20 a 60 toques por dia isso vira quarenta
-- grafias de "não atendeu" no primeiro mês, apaga a distinção entre "não fez" e
-- "não registrou" (RF-AST-06), impede o corte do funil por canal (RF-REL-02) e
-- deixa "porta aberta exige resultado registrado" (RF-MET-01) na mão de quem
-- digitou. Ligação, visita e DM são a maioria das portas do time (só a Heloísa
-- dispara pelo Número 1) e são justamente os canais sem vocabulário: as três
-- listas fechadas que já existem não os cobrem (`lost_reasons` só descreve perda,
-- as 25 intenções do Apêndice C só classificam mensagem recebida no WhatsApp, e
-- os chips do RF-MET-06 vivem na UI).
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- A seed do catálogo (34 desfechos, §3 da especificação) vai em supabase/seed.sql,
-- que roda DEPOIS das migrações — por isso não há de-para do texto livre aqui.
-- =====================================================================

-- ---------- 1. tipos enumerados ----------
-- create type não aceita "if not exists": o bloco captura duplicate_object,
-- no mesmo padrão da migração 000100.

-- Superfície de interação, e não canal puro: `app.channel` não separa visita de
-- reunião (as duas são 'presencial') e `app.activity_type` não separa WhatsApp de
-- Instagram (os dois são 'message'). O catálogo precisa das duas dimensões juntas
-- para filtrar os chips do formulário de 20 s, então indexa por superfície.
-- 'triagem' nasce reservado para os motivos de descarte da §5.2 do PRD (fora do
-- perfil, fora da região, duplicado, sem contato), que entram no mesmo catálogo no
-- D4, quando a caixa de triagem existir. Não são semeados agora.
do $$
begin
  create type app.interaction_surface as enum ('whatsapp','ligacao','visita','reuniao','instagram_dm','triagem');
exception when duplicate_object then null; end $$;

-- Teto de contagem da porta (RF-MET-01): 'aberta' (conversa real), 'batida'
-- (tentativa registrada) e 'nenhuma' (número inválido, perfil morto: não conta
-- nem como tentativa, para não inflar a métrica com erro de cadastro).
do $$
begin
  create type app.door_kind as enum ('aberta','batida','nenhuma');
exception when duplicate_object then null; end $$;

-- ---------- 2. superfície derivada do par (canal, tipo) ----------
-- Determinística e IMMUTABLE, para poder ser usada em índice e em view.
-- Ordem das cláusulas importa: o TIPO manda em ligação, visita e reunião (uma
-- visita registrada com canal 'whatsapp' continua sendo visita); o CANAL só
-- decide o que sobrou, que é mensagem escrita.
-- Ligação é `type = 'call'` (o canal correspondente é 'phone', não existe
-- 'ligacao' em app.channel). E-mail, nota, mudança de etapa e evento de sistema
-- devolvem NULL de propósito: não são superfície de porta e não têm chip.
--
-- Atenção ao nome: a função homônima do tipo só é alcançável com DOIS argumentos.
-- `app.interaction_surface('x')` é lido pelo Postgres como cast para o enum, não
-- como chamada de função — por isso não se deve criar sobrecarga de um argumento.
create or replace function app.interaction_surface(p_channel app.channel, p_type app.activity_type)
returns app.interaction_surface
language sql
immutable
set search_path = ''
as $$
  select case
           when p_type = 'call'::app.activity_type    then 'ligacao'
           when p_type = 'visit'::app.activity_type   then 'visita'
           when p_type = 'meeting'::app.activity_type then 'reuniao'
           when p_channel = 'instagram'::app.channel  then 'instagram_dm'
           when p_channel = 'whatsapp'::app.channel   then 'whatsapp'
         end::app.interaction_surface
$$;
comment on function app.interaction_surface(app.channel, app.activity_type) is
  'Superfície da interação a partir de (canal, tipo): ligacao/visita/reuniao pelo tipo, instagram_dm/whatsapp pelo canal; NULL para e-mail, nota e sistema (RF-FUN-12).';

-- ---------- 3. catálogo de desfechos ----------
create table if not exists public.interaction_outcomes (
  id                       serial primary key,
  slug                     text not null unique,
  -- 28 caracteres é o que cabe num chip de uma linha na largura de celular sem
  -- reticências; acima disso o formulário de 20 s (RF-MET-06) quebra a grade.
  name                     text not null check (length(trim(name)) between 1 and 28),
  surfaces                 app.interaction_surface[] not null check (cardinality(surfaces) > 0),
  position                 int not null default 0,
  is_active                boolean not null default true,
  cooldown_days            int not null default 0 check (cooldown_days between 0 and 36500),
  can_reactivate           boolean not null default true,
  next_action_kind         app.task_kind,                 -- próxima ação padrão (RF-FUN-03)
  next_action_label        text,
  next_action_offset_days  int check (next_action_offset_days is null or next_action_offset_days >= 0),
  target_stage_slug        text check (target_stage_slug is null or target_stage_slug ~ '^[a-z0-9_]+$'),
  sets_temperature         app.temperature,               -- null = mantém a temperatura calculada
  requires_lost_reason     boolean not null default false,
  counts_as                app.door_kind not null default 'batida',
  created_at               timestamptz not null default now(),
  -- Desfecho que exige motivo de perda tem de dizer para qual etapa vai: sem
  -- etapa de destino o motivo nunca seria pedido por ninguém (RF-FUN-04).
  constraint interaction_outcomes_perda_exige_etapa
    check (not requires_lost_reason or target_stage_slug is not null)
);
alter table public.interaction_outcomes enable row level security;

comment on table public.interaction_outcomes is
  'Lista fechada de resultados de interação por superfície (RF-FUN-12; RF-MET-06). Toda métrica de porta e todo relatório por canal derivam daqui.';
comment on column public.interaction_outcomes.slug is 'Identificador estável do desfecho; é o que a seed e os testes referenciam.';
comment on column public.interaction_outcomes.name is 'Rótulo do chip (máx. 28 caracteres, para caber numa linha no celular).';
comment on column public.interaction_outcomes.surfaces is 'Superfícies em que o chip aparece; teto de 8 ativos por superfície (RF-FUN-12, risco 23).';
comment on column public.interaction_outcomes.position is 'Ordem do chip dentro da superfície (o mais provável primeiro).';
comment on column public.interaction_outcomes.is_active is 'Aposentar chip é is_active = false, nunca delete: atividades antigas apontam para ele.';
comment on column public.interaction_outcomes.cooldown_days is
  'Piso de espera antes de novo toque, em dias (RF-FUN-13; 36500 = permanente). É filtro da fila, NUNCA gatilho de reenvio automático.';
comment on column public.interaction_outcomes.can_reactivate is
  'false = não volta à fila nem à reativação do RF-CON-15; só por decisão humana registrada (RF-FUN-08).';
comment on column public.interaction_outcomes.next_action_kind is 'Tipo da próxima ação padrão criada pelo desfecho (RF-FUN-03).';
comment on column public.interaction_outcomes.next_action_label is 'Texto da próxima ação padrão, como aparece no cartão do Meu dia.';
comment on column public.interaction_outcomes.next_action_offset_days is
  'Dias até a próxima ação; null = data pela temperatura resultante (D+1 quente, D+3 morno, D+7 frio — RF-MET-06).';
comment on column public.interaction_outcomes.target_stage_slug is
  'Etapa de destino, null = mantém a etapa. É slug e não FK porque a etapa é por funil (stages é única por pipeline_id+slug) e o destino se resolve no funil do próprio negócio.';
comment on column public.interaction_outcomes.sets_temperature is 'Temperatura forçada pelo desfecho; null = mantém a calculada pela regra do PRD §5.6.';
comment on column public.interaction_outcomes.requires_lost_reason is
  'Exige lost_reason_id no negócio (RF-FUN-04). A recusa acontece em app.deals_before_write, na mudança de etapa, e não na gravação da atividade: o desfecho é registrado antes de o negócio se mover, e travar aqui devolveria erro na tela errada.';
comment on column public.interaction_outcomes.counts_as is
  'Teto da contagem (RF-MET-01): porta aberta só é gravada se o formulário também disser decisor/influenciador.';

-- GIN em array de enum (opclass array_ops): o filtro do formulário é
-- `surfaces @> array[<superfície>]`, e é a única consulta quente do catálogo.
create index if not exists interaction_outcomes_surface_idx
  on public.interaction_outcomes using gin (surfaces);

-- ---------- 4. RLS do catálogo (padrão dos catálogos da migração 000500) ----------
-- Leitura para todo autenticado (a UI monta os chips), escrita só para gestor e
-- admin (chip novo é ato de gestão, RF-ADM-02). Nada para anon.
-- `(select app.is_manager())` faz o planner avaliar uma vez por comando (initplan).
drop policy if exists interaction_outcomes_select on public.interaction_outcomes;
drop policy if exists interaction_outcomes_insert on public.interaction_outcomes;
drop policy if exists interaction_outcomes_update on public.interaction_outcomes;
drop policy if exists interaction_outcomes_delete on public.interaction_outcomes;
create policy interaction_outcomes_select on public.interaction_outcomes
  for select to authenticated using (true);
create policy interaction_outcomes_insert on public.interaction_outcomes
  for insert to authenticated with check ((select app.is_manager()));
create policy interaction_outcomes_update on public.interaction_outcomes
  for update to authenticated using ((select app.is_manager())) with check ((select app.is_manager()));
create policy interaction_outcomes_delete on public.interaction_outcomes
  for delete to authenticated using ((select app.is_manager()));

-- Auditoria do catálogo (RF-ADM-02, RF-ADM-03). Estas colunas governam supressão de
-- contato (cooldown_days, can_reactivate) e contagem de meta (counts_as): zerar a
-- janela do opt-out ou reativar um chip aposentado não pode acontecer sem linha em
-- audit_log. Mesmo gatilho genérico da migração 000400 (app.audit(), que grava o id
-- como texto, então serve para chave serial também).
drop trigger if exists audit_interaction_outcomes on public.interaction_outcomes;
create trigger audit_interaction_outcomes
  after insert or update or delete on public.interaction_outcomes
  for each row execute function app.audit();

-- ---------- 5. activities.outcome_id e a queda do texto livre ----------
alter table public.activities
  add column if not exists outcome_id int references public.interaction_outcomes (id);
comment on column public.activities.outcome_id is
  'Desfecho da interação (lista fechada, RF-FUN-12). No WhatsApp descreve A PORTA; o que foi dito continua em deals.last_intent (Apêndice C). As duas taxonomias não se sobrepõem.';
create index if not exists activities_outcome_idx
  on public.activities (outcome_id) where outcome_id is not null;

-- Queda da coluna de texto livre: `activities.body` já é a observação livre, então
-- manter `outcome` seria duas colunas para a mesma coisa e a garantia de que alguém
-- volta a digitar. Sem de-para, e está escrito de propósito: a seed do catálogo roda
-- depois das migrações (no instante deste comando interaction_outcomes está vazia e
-- um update com join não converteria linha nenhuma) e não há dado de produção antes
-- do D3 — os cinco valores do comentário antigo nunca chegaram a ser gravados.
alter table public.activities drop column if exists outcome;

-- ---------- 6. gatilho: valida a superfície e grava o efeito ----------
-- O que o gatilho faz (e o que não faz):
--   * NÃO exige desfecho. O banco não recusa atividade sem outcome_id, por três
--     razões: RF-FUN-12 descreve o catálogo como fonte dos chips e não como
--     constraint; travar a gravação contraria o guardrail escrito ("não pode
--     travar captura em campo", 20 s no RF-MET-06 e 30 s no RF-BAS-15); e o
--     worker de WhatsApp do D5 grava mensagem recebida e enviada sem ter como
--     escolher desfecho no ato. Ligação, visita e reunião sem desfecho nascem com
--     metadata.outcome_pending = true, e quem cobra é o Meu dia (critério 3 do
--     RF-MET-04).
--   * Recusa desfecho inexistente, inativo ou fora da superfície da atividade:
--     isso é erro de programa ou de tela, não hesitação de quem está em campo.
--   * Grava o efeito em metadata, fonte única das metas (RF-MET-01): door_opened,
--     door_knocked e cooldown_until. Some a divergência entre o que a tela mostra
--     e o que a métrica conta, porque as duas leem a mesma linha.
-- Não é security definer: o catálogo é legível por todo autenticado (política
-- interaction_outcomes_select), então o gatilho enxerga o que o autor enxerga.
create or replace function app.activities_apply_outcome()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  o       public.interaction_outcomes%rowtype;
  v_surf  app.interaction_surface := app.interaction_surface(new.channel, new.type);
  v_meta  jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_aberta boolean;
begin
  if new.outcome_id is null then
    -- Marca a pendência só onde o desfecho é esperado por gente (ligação, visita,
    -- reunião). Mensagem, nota, e-mail e evento de sistema passam sem marca.
    if new.type in ('call'::app.activity_type, 'visit'::app.activity_type, 'meeting'::app.activity_type) then
      v_meta := v_meta || jsonb_build_object('outcome_pending', true);
    else
      v_meta := v_meta - 'outcome_pending';
    end if;
    -- Desfecho retirado num UPDATE: limpa o que ESTE gatilho havia escrito, para
    -- a métrica não continuar contando uma porta que não tem mais desfecho.
    -- Só nesse caso, para não apagar metadata.door_opened gravado à mão pelo
    -- worker de WhatsApp (o comentário de activities.metadata prevê esse uso).
    if tg_op = 'UPDATE' and old.outcome_id is not null then
      v_meta := v_meta - 'outcome_slug' - 'door_opened' - 'door_knocked' - 'cooldown_until';
    end if;
    new.metadata := v_meta;
    return new;
  end if;

  v_meta := v_meta - 'outcome_pending';

  select * into o
    from public.interaction_outcomes
   where id = new.outcome_id and is_active;
  if not found then
    raise exception 'Desfecho inexistente ou inativo (id %).', new.outcome_id using errcode = '23503';
  end if;

  if v_surf is null or not (v_surf = any (o.surfaces)) then
    raise exception 'Desfecho % não vale para a superfície %.', o.slug, coalesce(v_surf::text, 'indefinida')
      using errcode = '23514';
  end if;

  -- Porta é TETO, não veredito: counts_as diz o máximo que o desfecho pode valer;
  -- a porta aberta só é gravada se o formulário também disser com quem se falou
  -- (RF-MET-06, campo "com quem falou"). O limite de 1 porta aberta por alvo a
  -- cada 30 dias continua sendo regra da métrica (RF-MET-01), não do catálogo.
  v_aberta := o.counts_as = 'aberta'::app.door_kind
              and coalesce(v_meta ->> 'com_quem', '') in ('decisor', 'influenciador');

  new.metadata := v_meta || jsonb_build_object(
    'outcome_slug',   o.slug,
    'door_opened',    v_aberta,
    'door_knocked',   o.counts_as <> 'nenhuma'::app.door_kind,
    -- cooldown_until vai como TEXTO NORMALIZADO EM UTC (ISO 8601 com Z), e não como
    -- timestamptz solto: o jsonb guarda o texto que a função de saída do tipo produz,
    -- e esse texto muda com o TimeZone da sessão que gravou (o worker em UTC e o app
    -- em America/Fortaleza escreveriam o mesmo instante de dois jeitos). Normalizado,
    -- a chave é comparável e ordenável como texto, e a leitura com cast para
    -- timestamptz continua exata. A conta autoritativa é a de v_contact_cooldown;
    -- isto aqui é a cópia que a tela da atividade mostra.
    'cooldown_until', to_char((new.occurred_at + make_interval(days => o.cooldown_days))
                                at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  return new;
end $$;
comment on function app.activities_apply_outcome() is
  'Valida o desfecho contra a superfície da atividade e grava door_opened/door_knocked/cooldown_until em metadata (RF-FUN-12, RF-MET-01). Não exige desfecho: marca outcome_pending em ligação, visita e reunião.';

drop trigger if exists activities_apply_outcome on public.activities;
create trigger activities_apply_outcome
  before insert or update on public.activities
  for each row execute function app.activities_apply_outcome();

-- ---------- 7. janela de recontato por organização (RF-FUN-13) ----------
-- Lida pela fila das 06:00 (RF-CON-08) e pelo Meu dia (RF-MET-04), que excluem
-- quem está em janela de silêncio ANTES de ordenar por tier, categoria em déficit
-- e zona do dia. Nada aqui dispara envio: cooldown é filtro de entrada na fila.
--
-- security_invoker = true: a view roda com o papel de quem consulta, então a RLS
-- de activities (app.org_is_visible) filtra as linhas. Sem a opção declarada o
-- padrão do Postgres é rodar como dona e devolver a carteira inteira a embaixador
-- e leitura, furando RF-ADM-01. As três views da migração 000500 usam
-- invoker = false porque embutem elas mesmas o filtro de carteira; esta não embute.
create or replace view public.v_contact_cooldown
with (security_barrier = true, security_invoker = true) as
  with com_desfecho as (
    -- Toques com desfecho, já resolvidos para a organização.
    -- activities.organization_id é ANULÁVEL e o worker de WhatsApp do D5 grava a
    -- mensagem só com deal_id e contact_id. Sem o coalesce, um 'wa_optout' gravado
    -- assim não produziria linha alguma nesta view e o alvo continuaria elegível à
    -- fila das 06:00 pelo que ela diz (o guardrail forte do opt-out continua em
    -- consent_events e suppression_list, migração 000400, mas a view que a fila
    -- consulta não pode ficar em silêncio sobre ele).
    select coalesce(a.organization_id, d.organization_id) as organization_id,
           a.occurred_at,
           a.created_at,
           a.id,
           o.cooldown_days,
           o.can_reactivate,
           o.target_stage_slug
      from public.activities a
      join public.interaction_outcomes o on o.id = a.outcome_id
      left join public.deals d on d.id = a.deal_id
     where coalesce(a.organization_id, d.organization_id) is not null
  ),
  ultimo as (
    -- Piso de espera: janela da ÚLTIMA atividade com desfecho, e não o máximo do
    -- histórico. Com max(cooldown_days), um 'wa_agora_nao' de 30 dias continuaria
    -- excluindo o alvo mesmo depois de ele responder.
    select distinct on (c.organization_id)
           c.organization_id,
           c.occurred_at,
           c.cooldown_days
      from com_desfecho c
     order by c.organization_id, c.occurred_at desc, c.created_at desc, c.id desc
  ),
  bloqueio as (
    -- Bloqueio: ao contrário do piso de espera, NÃO se lê da última atividade.
    -- can_reactivate = false é grudento — o alvo pediu para parar ou disse "não"
    -- em definitivo, e só sai disso por decisão humana registrada (RF-CON-15,
    -- RF-CON-18). Se lêssemos a última linha, o worker do WhatsApp gravando
    -- 'wa_respondeu' numa mensagem que chega depois do opt-out desfaria o
    -- bloqueio sozinho, que é exatamente o guardrail que não pode cair.
    -- Guarda-se a data do último desfecho bloqueante para comparar com a reabertura.
    --
    -- Só bloqueia quem EMPURRA O NEGÓCIO PARA UMA ETAPA DE PERDA, que é exatamente a
    -- condição que dá sentido à única saída codificada abaixo ("sair de etapa de
    -- perda"). Sem essa simetria, 'wa_numero_invalido' e 'lig_numero_errado'
    -- (can_reactivate = false e target_stage_slug nulo) prendiam a organização
    -- inteira, em todos os canais, para sempre — e a própria próxima ação desses
    -- dois chips é "Buscar outro canal". O que segura o número morto é o
    -- cooldown_days de 36500 desses dois desfechos na seed, janela que cai sozinha
    -- assim que alguém registra qualquer outro toque (o tal outro canal), inclusive
    -- em organização que ainda não tem negócio.
    select distinct on (c.organization_id)
           c.organization_id,
           c.occurred_at as blocked_since
      from com_desfecho c
     where not c.can_reactivate
       and exists (select 1 from public.stages s
                    where s.slug = c.target_stage_slug and s.is_lost)
     order by c.organization_id, c.occurred_at desc, c.created_at desc, c.id desc
  )
  select u.organization_id,
         u.occurred_at + make_interval(days => u.cooldown_days) as cooldown_until,
         b.organization_id is not null and not exists (
           -- Saída do bloqueio: reabertura humana com motivo, saindo de uma etapa
           -- de perda (PRD §5.3, RF-FUN-08). Opt-out não tem saída (RF-CON-18),
           -- daí o `not sd.is_optout`. Vencido o bloqueio, o cooldown do desfecho
           -- (90 dias no "não" firme) ainda segura o alvo pelo prazo da §5.3.
           select 1
             from public.deal_stage_history h
             join public.deals  d  on d.id  = h.deal_id
             join public.stages sd on sd.id = h.from_stage_id
             join public.stages sp on sp.id = h.to_stage_id
            where d.organization_id = u.organization_id
              and h.changed_at > b.blocked_since
              and h.changed_by is not null
              and h.reason is not null
              and sd.is_lost and not sd.is_optout
              and not sp.is_lost
         ) as blocked_forever
    from ultimo u
    left join bloqueio b on b.organization_id = u.organization_id;
alter view public.v_contact_cooldown owner to postgres;
comment on view public.v_contact_cooldown is
  'Piso de espera e bloqueio por desfecho, por organização (RF-FUN-13). A fila filtra por aqui; nada aqui dispara envio. Só bloqueia desfecho que leva o negócio a etapa de perda, e o bloqueio termina na reabertura registrada, com o cooldown do desfecho ainda valendo depois dela (PRD §5.3). Número inválido e número errado não bloqueiam: eles seguram o alvo pela janela de 36500 dias, que cai no primeiro toque por outro canal.';

-- ---------- 8. privilégios ----------
-- A RLS restringe as LINHAS; o privilégio de tabela precisa existir para a API
-- chegar nela. As default privileges da migração 000500 já cobrem tabelas novas
-- criadas por `postgres`, mas repetimos aqui para o arquivo ser autossuficiente
-- (e idempotente) quando aplicado isoladamente.
grant select, insert, update, delete on public.interaction_outcomes to authenticated, service_role;
grant usage, select on sequence public.interaction_outcomes_id_seq to authenticated, service_role;
grant select on public.v_contact_cooldown to authenticated, service_role;

-- anon não enxerga nada (guardrail do 000500).
revoke all on public.interaction_outcomes  from anon;
revoke all on public.v_contact_cooldown    from anon;
revoke all on sequence public.interaction_outcomes_id_seq from anon;

-- app.interaction_surface é chamada DENTRO do gatilho, que roda como invocador:
-- sem EXECUTE para authenticated, toda gravação de atividade falharia.
revoke all on function app.interaction_surface(app.channel, app.activity_type) from public, anon;
grant execute on function app.interaction_surface(app.channel, app.activity_type) to authenticated, service_role;

-- Função de gatilho não é superfície de API: o Postgres a chama em nome do dono
-- do gatilho, e ninguém precisa de EXECUTE para ela disparar (padrão do 000500).
revoke all on function app.activities_apply_outcome() from public, anon, authenticated;

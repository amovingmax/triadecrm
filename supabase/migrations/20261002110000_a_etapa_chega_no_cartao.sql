-- =====================================================================
-- A etapa chega ao cartão, e o canal do último toque junto
-- =====================================================================
-- POR QUE. Rafael, 28/09/2026: "o fato de só o lead responder e ele já virar
-- morno não faz sentido e tá errado". A temperatura é derivada da etapa por
-- `app.compute_temperature`, com uma cor colada em cada etapa na seed
-- (`respondeu` = morno) — e era a COR que aparecia no cartão, na lista de
-- parceiros, na lista de conversas e no Meu dia. As 12 etapas do funil
-- fornecedor apareciam, na tela, como três cores.
--
-- A ETAPA PASSA A SER O QUE A TELA MOSTRA (ADR-16). A temperatura continua
-- inteira no banco — relatórios, override manual de 1–3 estrelas,
-- `needs_attention` e a ordenação interna de `public.meu_dia` — e some das
-- quatro telas de trabalho. NADA em `app.compute_temperature`,
-- `app.deals_apply_temperature` ou `app.recompute_temperatures` é tocado aqui.
--
-- O QUE FALTAVA NO CARTÃO: a etapa. Até hoje `app.deal_cards` carregava
-- `temperature` e mais nada sobre etapa, porque no quadro a COLUNA já é a etapa.
-- Isso bastava no quadro e falta em tudo que não agrupa por etapa.
--
-- E `deals.last_channel` NASCE AQUI, e não na 20261002120000 que é a dela: a
-- view abaixo lê a coluna, e migração que lê antes de criar não sobe
-- (`supabase db reset` falharia em "column d.last_channel does not exist").
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O canal do último toque, no negócio
-- ---------------------------------------------------------------------
alter table public.deals add column if not exists last_channel app.channel;
comment on column public.deals.last_channel is
  'Canal do último toque com este negócio (activities.channel). Derivada por app.activities_touch_deal (20261002120000). O canal é atributo do TOQUE, não funil próprio (R13 §3.1, ADR-16).';

-- Backfill: uma varredura, sem laço. `distinct on` com `order by deal_id,
-- occurred_at desc` devolve o toque mais recente de cada negócio.
update public.deals d
   set last_channel = ultimo.channel
  from (select distinct on (a.deal_id) a.deal_id, a.channel
          from public.activities a
         where a.deal_id is not null and a.channel is not null
         order by a.deal_id, a.occurred_at desc) ultimo
 where d.id = ultimo.deal_id and d.last_channel is null;

-- ---------------------------------------------------------------------
-- 2. A projeção do cartão
-- ---------------------------------------------------------------------
-- Recriada a partir da definição viva (20260904000900), com TRÊS chaves a mais
-- no `jsonb_build_object` e as três colunas que as alimentam na subconsulta `b`.
-- O `join public.stages st` já existia ali (é ele que dá `sla_hours`).
-- `create or replace view` é seguro aqui: a lista de COLUNAS da view não muda,
-- só o conteúdo do jsonb `card`.
create or replace view app.deal_cards as
select b.deal_id,
       b.organization_id,
       b.pipeline_id,
       b.stage_id,
       b.owner_id,
       b.org_deleted_at,
       b.search_name,
       b.organization_name,
       b.next_action_at,
       b.next_action_state,
       jsonb_build_object(
         'deal_id',            b.deal_id,
         'organization_id',    b.organization_id,
         'organization_name',  b.organization_name,
         'primary_category',   b.primary_category,
         'city',               b.city,
         'neighborhood',       b.neighborhood,
         'owner_id',           b.owner_id,
         'owner_name',         b.owner_name,
         'temperature',        b.temperature,
         'needs_attention',    b.needs_attention,
         -- NOVO (28/09/2026, ADR-16): a etapa e o canal chegam ao cartão.
         'stage_name',         b.stage_name,
         'stage_position',     b.stage_position,
         'last_channel',       b.last_channel,
         'status',             b.status,
         'tier',               b.tier,
         'score',              b.score,
         'entered_stage_at',   b.entered_stage_at,
         'days_in_stage',      b.days_in_stage,
         'is_rotting',         b.is_rotting,
         'last_activity_at',   b.last_activity_at,
         'days_since_contact', b.days_since_contact,
         'next_action',        b.next_action,
         'next_action_at',     b.next_action_at,
         'next_action_state',  b.next_action_state,
         'updated_at',         b.updated_at) as card
  from (
    select d.id                        as deal_id,
           d.organization_id,
           d.pipeline_id,
           d.stage_id,
           d.owner_id,
           o.deleted_at                as org_deleted_at,
           o.search_name,
           o.name                      as organization_name,
           cat.name                    as primary_category,
           ci.name                     as city,
           o.neighborhood,
           pr.full_name                as owner_name,
           d.temperature,
           d.needs_attention,
           st.name                     as stage_name,      -- NOVO
           st.position                 as stage_position,  -- NOVO
           d.last_channel,                                 -- NOVO
           d.status,
           d.tier,
           d.score,
           d.entered_stage_at,
           greatest(0, floor(extract(epoch from (now() - d.entered_stage_at)) / 86400)::int) as days_in_stage,
           (st.sla_hours is not null
            and coalesce(d.last_activity_at, d.entered_stage_at) < now() - make_interval(hours => st.sla_hours)) as is_rotting,
           d.last_activity_at,
           case when d.last_activity_at is null then null
                else greatest(0, floor(extract(epoch from (now() - d.last_activity_at)) / 86400)::int)
           end                         as days_since_contact,
           d.next_action,
           d.next_action_at,
           case
             when d.next_action_at is null then 'sem'
             when (d.next_action_at at time zone 'America/Fortaleza')::date
                < (now() at time zone 'America/Fortaleza')::date then 'atrasada'
             when (d.next_action_at at time zone 'America/Fortaleza')::date
                = (now() at time zone 'America/Fortaleza')::date then 'hoje'
             else 'agendada'
           end                         as next_action_state,
           d.updated_at
      from public.deals d
      join public.organizations o  on o.id  = d.organization_id
      join public.stages st        on st.id = d.stage_id
      left join public.cities ci   on ci.id = o.city_id
      left join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
      left join public.categories cat on cat.id = pc.category_id
      left join public.profiles pr on pr.id = d.owner_id
  ) b;
alter view app.deal_cards owner to postgres;
comment on view app.deal_cards is
  'Projeção única do cartão do kanban (RF-FUN-02), sem PII. Lida apenas pelas funções definer public.pipeline_board e public.move_deal. Desde 28/09/2026 carrega stage_name, stage_position e last_channel: a etapa passou a ser o que a tela mostra (ADR-16).';
revoke all on app.deal_cards from public, anon, authenticated;

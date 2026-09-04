-- =====================================================================
-- KOMUNE CRM — v0.1 — D4 — Lado do banco do funil kanban
-- (RF-FUN-01 quadro · RF-FUN-02 cartão e "parado" · RF-FUN-03 próxima ação
--  obrigatória · RF-FUN-04 campos obrigatórios por etapa · RF-FUN-08 histórico).
-- Contrato: apps/web/src/components/funis/tipos.ts (fonte da forma dos retornos).
--
-- Três funções, uma view interna e dois índices:
--   * app.deal_cards          — projeção única do cartão (nenhuma PII); o quadro e o
--                               "mover" leem a MESMA definição, então cartão devolvido
--                               por move_deal e cartão do quadro nunca divergem.
--   * public.pipeline_board   — o quadro inteiro em UMA consulta (sem N+1).
--   * public.move_deal        — mover cartão com todas as recusas nomeadas.
--   * public.deal_stage_timeline — histórico de etapas com nome de etapa e de autor.
--
-- ---------------------------------------------------------------------
-- Por que move_deal e pipeline_board são SECURITY DEFINER
-- ---------------------------------------------------------------------
-- Nenhuma política foi enfraquecida por esta migração: as políticas da 000500
-- continuam exatamente como estavam, e as funções REPETEM a mesma regra dentro
-- do corpo, em vez de afrouxá-la fora dele. Os dois motivos concretos:
--
--   1) sdr e embaixador NÃO leem public.organizations na tabela base (RF-BAS-14,
--      migração 000500): a superfície deles são as views com telefone mascarado.
--      O cartão precisa de nome, categoria, cidade e bairro do parceiro — como
--      invoker, o quadro voltaria vazio justamente para quem trabalha nele.
--      A função não devolve telefone, e-mail nem @: quem precisa do número abre a
--      ficha e revela lá, com linha em pii_access_log.
--
--   2) Os 100 negócios da base nasceram com `owner_id` nulo e os seis perfis são
--      todos `sdr`. A política `deals_update` é
--      `is_manager() or owner_id = auth.uid()`, então ela recusaria QUALQUER
--      movimento de cartão sem dono. Em vez de alargar a política (o que daria a
--      todo sdr escrita sobre a carteira alheia), `move_deal` trata o caso
--      estreito que existe: negócio SEM DONO é do bolo comum e quem o move o
--      assume (`claimed = true`). Negócio com dono continua obedecendo à regra da
--      política — gestor/admin ou o próprio dono, e nada mais.
--
-- Toda função definer aqui tem `search_path = ''` fixo, nomes qualificados, exige
-- `auth.uid()` e checa o papel com as mesmas funções das políticas
-- (app.can_write, app.sees_all, app.is_manager, app.org_is_mine,
-- app.org_is_editable). `leitura` e `financeiro` leem o quadro (app.sees_all já os
-- inclui) e recebem `sem_permissao` ao tentar mover. `anon` não tem execute.
--
-- ---------------------------------------------------------------------
-- O que o "mover" NÃO faz, de propósito
-- ---------------------------------------------------------------------
--   * Não grava `activities`. O gatilho app.activities_touch_deal só ignora
--     `type = 'system'`; registrar a mudança como atividade atualizaria
--     `deals.last_activity_at` e arrastar um cartão zeraria "dias sem contato" e
--     reesquentaria o negócio pela regra do PRD §5.6. O registro da mudança é o
--     `deal_stage_history` que o RF-FUN-08 pede (gravado pelo gatilho
--     app.deals_track_stage) mais a linha do `audit_log` (gatilho app.audit no
--     UPDATE de deals, com actor_id, papel, old_data e new_data).
--   * Não recalcula temperatura à mão: quem calcula continua sendo
--     app.compute_temperature, chamada pelo gatilho zz_deals_apply_temperature.
--   * Não dispara automação de etapa (RF-FUN-05): o motor é D5–D7.
-- =====================================================================

-- ---------- índices do quadro ----------
-- deals_board_idx é parcial (`where status = 'open'`) e não serve ao quadro, que
-- mostra também ganho, perda, opt-out e nutrição. Este cobre a leitura por funil
-- e a contagem por etapa.
create index if not exists deals_pipeline_stage_idx on public.deals (pipeline_id, stage_id);
-- Filtro "meus" e recorte por responsável dentro de um funil.
create index if not exists deals_pipeline_owner_idx on public.deals (pipeline_id, owner_id);

-- ---------- projeção do cartão (RF-FUN-02) ----------
-- Fica em `app` porque não é superfície de API: só as funções definer abaixo a leem.
-- Sem telefone, e-mail ou @ — o quadro carrega dezenas de cartões por tela e PII em
-- lote é exatamente o que RF-BAS-14 e o pii_access_log existem para evitar.
--
-- `card` já sai como jsonb no formato de CartaoQuadro (tipos.ts): as 22 chaves são
-- escritas UMA vez, aqui. As demais colunas existem para filtrar e ordenar.
--
-- Regras que moram nesta view:
--   * days_in_stage      — dias inteiros desde entered_stage_at.
--   * is_rotting         — "parado" do RF-FUN-02: conta da ÚLTIMA ATIVIDADE (é o que
--                          diz o comentário de stages.sla_hours: "horas sem atividade
--                          até contar como parado"); sem atividade nenhuma, conta de
--                          entered_stage_at. Etapa sem sla_hours nunca apodrece —
--                          por isso publicado, perdido e opt-out (sla_hours nulo na
--                          seed) não ganham fundo de parado e nutrição (720 h) ganha.
--   * days_since_contact — nulo quando nunca houve contato ("sem contato" não é "hoje").
--   * next_action_state  — semáforo por DIA em America/Fortaleza, e não por instante:
--                          "hoje às 9h" continua sendo hoje às 14h. O fuso é o do
--                          banco porque o "hoje" da Heloísa no celular e o do relatório
--                          de segunda têm de ser o mesmo dia (CLAUDE.md).
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
  'Projeção única do cartão do kanban (RF-FUN-02), sem PII. Lida apenas pelas funções definer public.pipeline_board e public.move_deal.';
-- Não é superfície de API: authenticated tem usage em `app` (000100) e não pode
-- ler esta view direto, senão sdr e embaixador contornariam a máscara de RF-BAS-14
-- pela porta dos fundos (nome e bairro de organização fora da carteira).
revoke all on app.deal_cards from public, anon, authenticated;

-- ---------- o quadro (RF-FUN-01) ----------
-- UMA consulta: as janelas (count/row_number por etapa) fazem contagem e paginação
-- no mesmo passe, e a lista de etapas entra por LEFT JOIN — nada de uma consulta
-- por coluna. Com centenas de negócios o plano é um index scan em
-- deals_pipeline_stage_idx mais junções por chave primária.
--
-- p_stage_id: quando informado, SÓ essa etapa devolve cartões; as demais vêm com
-- `total` e `cards` vazio. É o modo do celular (uma etapa por vez) e o alvo de
-- p_offset ("carregar mais" dentro da coluna).
--
-- Ordem dentro da coluna (RF-FUN-03): quem está sem próxima ação sobe ao topo,
-- depois atrasada, hoje e agendada; empate por data, nome e id (paginação estável).
create or replace function public.pipeline_board(
  p_pipeline_id     int,
  p_only_mine       boolean default false,
  p_owner_id        uuid    default null,
  p_q               text    default null,
  p_stage_id        int     default null,
  p_limit_per_stage int     default 40,
  p_offset          int     default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_sees_all boolean;
  v_emb      boolean;
  v_limit    int  := least(greatest(coalesce(p_limit_per_stage, 40), 1), 200);
  v_offset   int  := greatest(coalesce(p_offset, 0), 0);
  v_name     text := app.search_name(nullif(trim(coalesce(p_q, '')), ''));
  v_owner    uuid := case when coalesce(p_only_mine, false) then v_uid else p_owner_id end;
  v_pipeline record;
  v_board    jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_sees_all := app.sees_all();
  v_emb      := app.role() = 'embaixador'::app.user_role;

  select p.id, p.slug, p.name, p.kind into v_pipeline
    from public.pipelines p where p.id = p_pipeline_id;
  if v_pipeline.id is null then
    raise exception 'Funil % não existe', p_pipeline_id using errcode = '23503';
  end if;

  with visiveis as (
    select c.deal_id, c.stage_id, c.organization_name, c.next_action_at, c.next_action_state, c.card
      from app.deal_cards c
     where c.pipeline_id = p_pipeline_id
       and c.org_deleted_at is null
       -- Mesma regra da política deals_select (000500), escrita aqui em linha para
       -- não pagar uma função por linha: app.sees_all() cobre admin, gestor, sdr,
       -- leitura e financeiro; sobra o embaixador, que vê o que é dele e as
       -- organizações da carteira (app.org_is_mine, aberto nos dois EXISTS).
       and (v_sees_all
            or (v_emb
                and (c.owner_id = v_uid
                     or exists (select 1 from public.organizations o2
                                 where o2.id = c.organization_id and o2.owner_id = v_uid)
                     or exists (select 1 from public.deals d2
                                 where d2.organization_id = c.organization_id and d2.owner_id = v_uid))))
       and (v_owner is null or c.owner_id = v_owner)
       and (v_name is null
            or c.search_name like v_name || '%'
            or c.search_name operator(extensions.%) v_name)
  ),
  numerados as (
    select v.stage_id, v.card,
           count(*) over (partition by v.stage_id) as total_na_etapa,
           row_number() over (
             partition by v.stage_id
             order by case v.next_action_state
                        when 'sem'      then 0
                        when 'atrasada' then 1
                        when 'hoje'     then 2
                        else 3
                      end,
                      v.next_action_at nulls first,
                      v.organization_name,
                      v.deal_id) as rn
      from visiveis v
  ),
  por_etapa as (
    select n.stage_id,
           max(n.total_na_etapa) as total,
           coalesce(
             jsonb_agg(n.card order by n.rn) filter (
               where (p_stage_id is null or n.stage_id = p_stage_id)
                 and n.rn >  (case when p_stage_id is null then 0 else v_offset end)
                 and n.rn <= (case when p_stage_id is null then 0 else v_offset end) + v_limit),
             '[]'::jsonb) as cards
      from numerados n
     group by n.stage_id
  )
  select jsonb_build_object(
           'pipeline', jsonb_build_object(
              'id', v_pipeline.id, 'slug', v_pipeline.slug,
              'name', v_pipeline.name, 'kind', v_pipeline.kind),
           'generated_at', now(),
           'stages', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id',              s.id,
                      'slug',            s.slug,
                      'name',            s.name,
                      'position',        s.position,
                      'temperature',     s.temperature,
                      'sla_hours',       s.sla_hours,
                      'is_won',          s.is_won,
                      'is_lost',         s.is_lost,
                      'is_dormant',      s.is_dormant,
                      'is_optout',       s.is_optout,
                      'is_terminal',     s.is_terminal,
                      'required_fields', s.required_fields,
                      'total',           coalesce(e.total, 0),
                      'cards',           coalesce(e.cards, '[]'::jsonb))
                    order by s.position)
               from public.stages s
               left join por_etapa e on e.stage_id = s.id
              where s.pipeline_id = p_pipeline_id), '[]'::jsonb))
    into v_board;

  return v_board;
end $$;
comment on function public.pipeline_board(int, boolean, uuid, text, int, int, int) is
  'Quadro kanban de um funil em uma consulta (RF-FUN-01/02): etapas com contagem e página de cartões, filtro meus/todos, responsável e busca por nome. Definer sem PII, com a visibilidade da política deals_select.';

-- ---------- mover o cartão (RF-FUN-01/03/04/08) ----------
-- Devolve o formato de ResultadoMover (tipos.ts): `{ok:true, card, from_stage_id,
-- to_stage_id, claimed, task_id}` ou `{ok:false, reason, missing?, current_stage_id?}`.
-- Recusa esperada NÃO é exceção: a tela precisa reabrir o formulário com os campos
-- que faltam, e uma exceção abortaria a transação sem estrutura para isso. Erro de
-- programa (funil inexistente, consent_kind inválido na seed) continua sendo exceção.
--
-- Ordem das checagens: papel → negócio visível → escrita → etapa do mesmo funil →
-- concorrência → etapa igual → campos obrigatórios (RF-FUN-04) → próxima ação
-- (RF-FUN-03). Só então escreve.
create or replace function public.move_deal(
  p_deal_id           uuid,
  p_to_stage_id       int,
  p_expected_stage_id int   default null,
  p_reason            text  default null,
  p_fields            jsonb default '{}'::jsonb,
  p_next_action       jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid            uuid := auth.uid();
  v_role           app.user_role;
  v_deal           public.deals%rowtype;
  v_stage          public.stages%rowtype;
  v_org_deleted    timestamptz;
  v_saida          boolean;
  v_claim          boolean := false;
  v_reason         text := nullif(trim(coalesce(p_reason, '')), '');
  v_fields         jsonb := coalesce(p_fields, '{}'::jsonb);
  v_missing        jsonb := '[]'::jsonb;
  v_consents       jsonb := '[]'::jsonb;
  v_spec           jsonb;
  v_key            text;
  v_val            jsonb;
  v_txt            text;
  v_type           text;
  v_ts             timestamptz;
  v_lost           int;
  v_consent_kind   app.consent_kind;
  v_meeting_at     timestamptz;
  v_meeting_format text;
  v_na_kind        app.task_kind;
  v_na_label       text;
  v_na_at          timestamptz;
  v_hoje           date := (now() at time zone 'America/Fortaleza')::date;
  v_prev_reason    text;
  v_task           uuid;
  v_card           jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_role := app.role();

  -- Papéis sem escrita (leitura, financeiro) param aqui, como na política deals_update.
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;

  select d.* into v_deal from public.deals d where d.id = p_deal_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'negocio_nao_encontrado');
  end if;

  -- Organização apagada (soft delete) não se trabalha.
  select o.deleted_at into v_org_deleted
    from public.organizations o where o.id = v_deal.organization_id;
  if v_org_deleted is not null then
    return jsonb_build_object('ok', false, 'reason', 'negocio_nao_encontrado');
  end if;

  -- Visibilidade: cópia literal da política deals_select.
  if not (app.sees_all()
          or (v_role = 'embaixador'::app.user_role
              and (v_deal.owner_id = v_uid or app.org_is_mine(v_deal.organization_id)))) then
    return jsonb_build_object('ok', false, 'reason', 'negocio_nao_encontrado');
  end if;

  -- Escrita: cópia da política deals_update (is_manager ou dono), mais a única
  -- ampliação desta migração, escrita e restrita: negócio SEM DONO é do bolo comum
  -- e quem o move o assume. Negócio com outro dono continua fora de alcance.
  v_claim := v_deal.owner_id is null;
  if not (app.is_manager() or v_deal.owner_id = v_uid or v_claim) then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  -- E o WITH CHECK da mesma política: embaixador só mexe em organização dele.
  if v_role = 'embaixador'::app.user_role and not app.org_is_editable(v_deal.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;

  select s.* into v_stage from public.stages s where s.id = p_to_stage_id;
  if not found or v_stage.pipeline_id <> v_deal.pipeline_id then
    return jsonb_build_object('ok', false, 'reason', 'etapa_de_outro_funil');
  end if;

  -- Duas pessoas arrastando o mesmo cartão: quem chegou depois recebe a etapa real.
  if p_expected_stage_id is not null and p_expected_stage_id <> v_deal.stage_id then
    return jsonb_build_object('ok', false, 'reason', 'etapa_mudou',
                              'current_stage_id', v_deal.stage_id);
  end if;
  if p_to_stage_id = v_deal.stage_id then
    return jsonb_build_object('ok', false, 'reason', 'etapa_igual');
  end if;

  v_saida := v_stage.is_won or v_stage.is_lost or v_stage.is_dormant or v_stage.is_terminal;

  -- ----- campos obrigatórios da etapa (RF-FUN-04) -----
  -- Dirigido por dados: a regra é o que está em stages.required_fields, então um
  -- campo novo no catálogo passa a ser exigido sem uma linha de código nova.
  for v_spec in select e.value from jsonb_array_elements(v_stage.required_fields) e loop
    v_key  := v_spec ->> 'field';
    v_type := coalesce(v_spec ->> 'type', '');
    v_val  := v_fields -> v_key;
    v_txt  := case
                when v_val is null or jsonb_typeof(v_val) = 'null' then null
                when jsonb_typeof(v_val) = 'string' then nullif(trim(v_val #>> '{}'), '')
                else v_val #>> '{}'
              end;

    -- Motivo de perda: lista fechada (lost_reasons), recusa com nome próprio.
    if v_key = 'lost_reason_id' or coalesce(v_spec ->> 'table', '') = 'lost_reasons' then
      begin
        v_lost := v_txt::int;
      exception when invalid_text_representation then
        v_lost := null;
      end;
      if v_lost is null
         or not exists (select 1 from public.lost_reasons lr where lr.id = v_lost and lr.is_active) then
        return jsonb_build_object('ok', false, 'reason', 'motivo_de_perda_invalido');
      end if;
      continue;
    end if;

    if v_txt is null then
      v_missing := v_missing || jsonb_build_array(v_spec);
      continue;
    end if;

    if v_type = 'timestamptz' then
      begin
        v_ts := v_txt::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        v_ts := null;
      end;
      if v_ts is null then
        v_missing := v_missing || jsonb_build_array(v_spec);
        continue;
      end if;
      if v_key = 'meeting_at' then
        v_meeting_at := v_ts;
      end if;
    elsif v_type = 'enum' then
      if not exists (select 1
                       from jsonb_array_elements_text(coalesce(v_spec -> 'options', '[]'::jsonb)) o
                      where o.value = v_txt) then
        v_missing := v_missing || jsonb_build_array(v_spec);
        continue;
      end if;
      if v_key = 'meeting_format' then
        v_meeting_format := v_txt;
      end if;
    end if;

    -- Campo que é prova de consentimento (na seed: a evidência da autorização da
    -- etapa "Autorizou") vira linha em consent_events — guardrail do CLAUDE.md:
    -- pré-cadastro só depois de autorização registrada. Gravado DEPOIS de todas as
    -- validações, para não sobrar prova de um movimento que foi recusado.
    if v_spec ? 'consent_kind' then
      begin
        v_consent_kind := (v_spec ->> 'consent_kind')::app.consent_kind;
      exception when invalid_text_representation then
        raise exception 'Etapa "%": consent_kind "%" não existe em app.consent_kind',
          v_stage.name, v_spec ->> 'consent_kind' using errcode = '22P02';
      end;
      v_consents := v_consents || jsonb_build_array(
        jsonb_build_object('kind', v_consent_kind::text, 'text', v_txt));
    end if;
  end loop;

  if jsonb_array_length(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'campos_obrigatorios', 'missing', v_missing);
  end if;

  -- Perda exige motivo mesmo que a etapa esteja mal configurada no catálogo (sem a
  -- linha `lost_reason_id` em required_fields): é o guardrail do RF-FUN-04 e o que
  -- impede o relatório de motivos de perda de nascer furado. Opt-out é perda POR
  -- REGRA e não tem motivo a escolher (PRD §5.3).
  if v_stage.is_lost and not v_stage.is_optout and v_lost is null then
    begin
      v_lost := nullif(trim(coalesce(v_fields ->> 'lost_reason_id', '')), '')::int;
    exception when invalid_text_representation then
      v_lost := null;
    end;
    if v_lost is null
       or not exists (select 1 from public.lost_reasons lr where lr.id = v_lost and lr.is_active) then
      return jsonb_build_object('ok', false, 'reason', 'motivo_de_perda_invalido');
    end if;
  end if;

  -- ----- próxima ação (RF-FUN-03) -----
  if p_next_action is not null and jsonb_typeof(p_next_action) = 'object' then
    v_na_label := nullif(trim(regexp_replace(coalesce(p_next_action ->> 'label', ''), '\s+', ' ', 'g')), '');
    v_na_kind  := coalesce(nullif(p_next_action ->> 'kind', ''), 'follow_up')::app.task_kind;
    begin
      v_na_at := (p_next_action ->> 'at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      v_na_at := null;
    end;
    if v_na_label is null or v_na_at is null then
      return jsonb_build_object('ok', false, 'reason', 'proxima_acao_obrigatoria');
    end if;
    if (v_na_at at time zone 'America/Fortaleza')::date < v_hoje then
      return jsonb_build_object('ok', false, 'reason', 'proxima_acao_no_passado');
    end if;
  end if;

  -- A reunião/demonstração marcada É a próxima ação quando nenhuma outra veio no
  -- pedido. É a solução do contrato para required_fields pedir meeting_at/
  -- meeting_format sem que exista coluna de reunião em deals (agenda é D7):
  -- a data vira deals.next_action_at e uma tarefa kind = 'meeting'.
  if v_na_at is null and v_meeting_at is not null then
    v_na_at    := v_meeting_at;
    v_na_kind  := 'meeting'::app.task_kind;
    v_na_label := v_stage.name
                  || coalesce(' — formato: ' || v_meeting_format, '');
    if (v_na_at at time zone 'America/Fortaleza')::date < v_hoje then
      return jsonb_build_object('ok', false, 'reason', 'proxima_acao_no_passado');
    end if;
  end if;

  -- Etapa de trabalho exige próxima ação FUTURA depois do movimento. Etapa de saída
  -- (ganho, perda, opt-out, nutrição) dispensa: a justificativa é a própria etapa.
  -- Uma próxima ação futura que o negócio JÁ tem satisfaz a regra — o requisito é
  -- "negócio aberto sem próxima ação futura é destacado" (RF-FUN-03), não "digite
  -- de novo o que já está marcado".
  if not v_saida and v_na_at is null
     and not (v_deal.next_action_at is not null
              and nullif(trim(coalesce(v_deal.next_action, '')), '') is not null
              and (v_deal.next_action_at at time zone 'America/Fortaleza')::date >= v_hoje) then
    return jsonb_build_object('ok', false, 'reason', 'proxima_acao_obrigatoria');
  end if;

  -- ----- escrita -----
  -- O motivo viaja no MESMO comando da mudança de etapa, para o gatilho
  -- app.deals_track_stage copiá-lo ao histórico (RF-FUN-08). O GUC app.stage_reason
  -- é a rede de segurança do único caso em que deals_before_write zera a coluna:
  -- quando o motivo é idêntico ao da mudança anterior.
  if v_reason is not null then
    v_prev_reason := current_setting('app.stage_reason', true);
    perform set_config('app.stage_reason', v_reason, true);
  end if;

  update public.deals d
     set stage_id            = p_to_stage_id,
         stage_change_reason = v_reason,
         owner_id            = case when v_claim then v_uid else d.owner_id end,
         lost_reason_id      = case when v_stage.is_lost and not v_stage.is_optout
                                    then v_lost else d.lost_reason_id end,
         next_action         = case when v_na_label is not null then v_na_label
                                    when v_saida then null
                                    else d.next_action end,
         next_action_at      = case when v_na_at is not null then v_na_at
                                    when v_saida then null
                                    else d.next_action_at end
   where d.id = p_deal_id;

  if v_reason is not null then
    perform set_config('app.stage_reason', coalesce(v_prev_reason, ''), true);
  end if;

  -- Tarefa da próxima ação, para o dono do negócio (o novo dono, quando houve claim).
  if v_na_at is not null then
    insert into public.tasks (title, kind, due_at, assignee_id, organization_id,
                              deal_id, contact_id, created_by, origin)
    values (left(v_na_label, 200), v_na_kind, v_na_at, coalesce(v_deal.owner_id, v_uid),
            v_deal.organization_id, p_deal_id, v_deal.primary_contact_id, v_uid, 'system')
    returning id into v_task;
  end if;

  -- Reunião marcada além da próxima ação (o pedido trouxe as duas coisas): o
  -- compromisso também vira tarefa, senão a data combinada não existe em lugar nenhum.
  if v_meeting_at is not null and (v_na_kind is distinct from 'meeting'::app.task_kind
                                   or v_na_at is distinct from v_meeting_at) then
    insert into public.tasks (title, kind, due_at, assignee_id, organization_id,
                              deal_id, contact_id, created_by, origin)
    values (left(v_stage.name || coalesce(' — formato: ' || v_meeting_format, ''), 200),
            'meeting'::app.task_kind, v_meeting_at, coalesce(v_deal.owner_id, v_uid),
            v_deal.organization_id, p_deal_id, v_deal.primary_contact_id, v_uid, 'system');
  end if;

  -- Guardrail de opt-out (CLAUDE.md, RF-ADM-04): arrastar um cartão para a etapa
  -- "Opt-out / não contatar" É um opt-out. Sem esta linha o cartão mudava de coluna
  -- e o número continuava contatável — do_not_contact e suppression_list só existem
  -- a partir de consent_events. Não é o motor de automação de etapa (RF-FUN-05, que
  -- fica para D5–D7): é a única consequência que não pode esperar por ele.
  -- O gatilho app.consent_apply faz o resto (flag, hashes e os outros negócios da
  -- organização); este negócio já está na etapa e não é movido de novo.
  if v_stage.is_optout then
    insert into public.consent_events (kind, organization_id, contact_id, evidence_text)
    values ('contact_optout'::app.consent_kind, v_deal.organization_id, v_deal.primary_contact_id,
            coalesce(v_reason, 'Movido para a etapa "' || v_stage.name || '" no funil'));
  end if;

  -- Provas de consentimento (append-only; o gatilho consent_apply cuida do resto).
  for v_spec in select e.value from jsonb_array_elements(v_consents) e loop
    insert into public.consent_events (kind, organization_id, contact_id, evidence_text)
    values ((v_spec ->> 'kind')::app.consent_kind, v_deal.organization_id,
            v_deal.primary_contact_id, v_spec ->> 'text');
  end loop;

  select c.card into v_card from app.deal_cards c where c.deal_id = p_deal_id;

  return jsonb_build_object(
           'ok',            true,
           'card',          v_card,
           'from_stage_id', v_deal.stage_id,
           'to_stage_id',   p_to_stage_id,
           'claimed',       v_claim,
           'task_id',       v_task);
end $$;
comment on function public.move_deal(uuid, int, int, text, jsonb, jsonb) is
  'Move um negócio de etapa com as validações do RF-FUN-03/04 no banco (próxima ação, campos obrigatórios da etapa, motivo de perda da lista fechada), grava deal_stage_history (RF-FUN-08) e audit_log pelos gatilhos, e assume negócio sem dono para quem move. Recusa esperada volta como {ok:false, reason}.';

-- ---------- histórico de etapas (RF-FUN-08) ----------
-- SECURITY INVOKER de propósito: a política deal_stage_history_select já filtra pelo
-- negócio que o papel enxerga, stages é catálogo aberto a todo autenticado e
-- team_directory expõe só nome e papel. Não há nada que justifique elevar aqui.
-- changed_by nulo = automação, IA ou sistema (migração 000300).
create or replace function public.deal_stage_timeline(p_deal_id uuid)
returns table (
  id              bigint,
  changed_at      timestamptz,
  from_stage_id   int,
  from_stage_name text,
  to_stage_id     int,
  to_stage_name   text,
  changed_by      uuid,
  changed_by_name text,
  reason          text)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.id, h.changed_at, h.from_stage_id, sf.name, h.to_stage_id, sto.name,
         h.changed_by, td.full_name, h.reason
    from public.deal_stage_history h
    join public.stages sto      on sto.id = h.to_stage_id
    left join public.stages sf  on sf.id  = h.from_stage_id
    left join public.team_directory td on td.id = h.changed_by
   where h.deal_id = p_deal_id
   order by h.changed_at desc, h.id desc
$$;
comment on function public.deal_stage_timeline(uuid) is
  'Histórico de etapas de um negócio com nome da etapa e do autor (RF-FUN-08); invoker, filtrado pela RLS de deal_stage_history.';

-- ---------- privilégios ----------
revoke all on function public.pipeline_board(int, boolean, uuid, text, int, int, int) from public, anon;
revoke all on function public.move_deal(uuid, int, int, text, jsonb, jsonb)          from public, anon;
revoke all on function public.deal_stage_timeline(uuid)                              from public, anon;
grant execute on function public.pipeline_board(int, boolean, uuid, text, int, int, int) to authenticated, service_role;
grant execute on function public.move_deal(uuid, int, int, text, jsonb, jsonb)          to authenticated, service_role;
grant execute on function public.deal_stage_timeline(uuid)                              to authenticated, service_role;

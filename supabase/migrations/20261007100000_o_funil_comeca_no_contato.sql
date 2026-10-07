-- =====================================================================
-- O funil começa no contato
--
-- Pedido do Rafael em 07/10/2026, na limpeza do funil: "tire o funil de
-- prospectado, pois essa parte a gente já tem uma tabela própria; o primeiro
-- funil vai ser Contatado, que a partir da primeira mensagem que a gente
-- mandar a pessoa já sobe para lá; tire Em conversa e deixe apenas Respondeu;
-- retire Autorizou. Faça as mesmas remoções nos outros funis, com as que se
-- parecem (prospectado = identificado)".
--
-- ===========================================================================
-- DUAS SAÍDAS DIFERENTES, E POR QUE NÃO SÃO A MESMA COISA
-- ===========================================================================
-- "Tirar uma etapa" quer dizer duas coisas, e o banco precisa saber qual:
--
--   ETAPA DE ENTRADA (`stages.is_entry`) — Prospectado (fornecedor) e
--     Identificado (produtor). O negócio CONTINUA nascendo nela: aprovar na
--     Revisão, o cadastro rápido e a importação criam ficha + negócio, e é desse
--     negócio que saem o lote de ligação, a próxima ação e o Meu dia. O que
--     muda é que ela deixa de ser COLUNA: quem ainda não foi contatado mora na
--     lista de Prospectados, e o quadro começa em Contatado. A subida já
--     existia e não muda: `app.wa_envio_no_funil` leva de Prospectado /
--     Identificado para Contatado na primeira mensagem — a de quem clicou e a
--     do bom-dia automático.
--
--   ETAPA APOSENTADA (`stages.retired_at`) — Em conversa e Autorizou
--     (fornecedor). Ninguém mais entra nelas. Quem estava é levado para a
--     sucessora (`app.aposentar_etapa`): Em conversa → Respondeu; Autorizou →
--     Cadastro em andamento. A linha NÃO é apagada: `deal_stage_history` e
--     `call_batch_items` apontam para ela, e apagar seria reescrever o
--     histórico ("de Respondeu para Em conversa" viraria uma frase sem nome).
--
-- No funil produtor a única parecida é Identificado: ele nunca teve "Em
-- conversa" (PRD §5.5 vai de Respondeu a Demonstração marcada), e o "sim" dele
-- é Parceria aceita, que já era o destino de `cadastro_em_andamento` por
-- `stage_equivalences` — fica.
--
-- O funil de Ativação não é tocado aqui: ele sai da TELA de Funis (era uma aba
-- que só mostrava uma régua), e continua no banco porque o roteiro de ligação
-- tem variante própria para ele (20260915100000).
--
-- ===========================================================================
-- O QUE A AUTORIZAÇÃO VIRA SEM A ETAPA
-- ===========================================================================
-- A etapa "Autorizou" fazia duas coisas além de ser coluna, e nenhuma se perde:
--
--   · transformava a frase do parceiro em `consent_events` (o `consent_kind`
--     de `required_fields`). A especificação passa para "Cadastro em
--     andamento", com `"required": false` — igual a "Parceria aceita" no
--     produtor, e pelo mesmo motivo: "Cadastro iniciado na hora" (visita) leva
--     à mesma etapa e não colhe frase nenhuma. Quando a frase vem, vira prova;
--     quando não vem, a etapa não barra. Quem barra o pré-cadastro continua
--     sendo `gerar_link_de_reivindicacao` e `komune_push`, com `sem_autorizacao`.
--   · contava "autorizações" no relatório de segunda. A conta passa a ler o
--     fato (`consent_events`), que é o que `relatorio_por_fonte` já fazia.
--
-- O desfecho "Realizada, autorizou" continua exigindo a frase
-- (`registrar_contato` recusa `reu_autorizou` sem evidência) e passa a levar a
-- "Cadastro em andamento"; "Interessado" (ligação e visita) passa a levar a
-- "Respondeu". O "quente" desses dois nunca veio da etapa: vem de
-- `sets_temperature`, que grava a intenção.
--
-- RF-FUN-01, RF-FUN-04, RF-FUN-08, RF-FUN-12, RF-REL-10
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · As duas marcas na etapa
-- ---------------------------------------------------------------------
alter table public.stages
  add column if not exists is_entry   boolean not null default false,
  add column if not exists retired_at timestamptz;

comment on column public.stages.is_entry is
  'Etapa de entrada (07/10/2026): o negócio nasce aqui e ainda não foi contatado. Não é coluna do quadro nem linha do relatório de funil — quem está nela mora na lista de Prospectados. Sai dela sozinho na primeira mensagem (app.wa_envio_no_funil) ou quando um desfecho move a etapa.';
comment on column public.stages.retired_at is
  'Etapa aposentada: não recebe negócio (app.deals_before_write recusa), não aparece no quadro, no relatório de funil nem nas listas de escolha. A linha fica pela história — deal_stage_history e call_batch_items apontam para ela. Quem aposenta é app.aposentar_etapa, que antes leva os negócios para a sucessora.';

-- Uma etapa não pode ser as duas coisas: a de entrada é onde o negócio nasce.
alter table public.stages drop constraint if exists stages_entrada_nao_aposentada;
alter table public.stages add constraint stages_entrada_nao_aposentada
  check (not (is_entry and retired_at is not null));


-- ---------------------------------------------------------------------
-- 2 · O gatilho do negócio recusa etapa aposentada
-- ---------------------------------------------------------------------
-- Cópia da definição viva (20260905000800) com UMA regra a mais, marcada
-- `-- NOVO`. É no gatilho, e não só no `move_deal`, pelo motivo que a própria
-- 000800 deu: um UPDATE direto pelo PostgREST não pode burlar o que a função
-- cobra. O `move_deal` não foi reescrito — nenhuma tela oferece etapa
-- aposentada (o quadro não a devolve), e quem chegar a ela por um id antigo
-- recebe a exceção daqui.
CREATE OR REPLACE FUNCTION app.deals_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  s      record;
  v_spec jsonb;
begin
  select st.pipeline_id, st.is_won, st.is_lost, st.is_dormant, st.is_optout, st.name,
         st.required_fields, st.retired_at
    into s from public.stages st where st.id = new.stage_id;
  if s.pipeline_id is null then
    raise exception 'Etapa % não existe', new.stage_id using errcode = '23503';
  end if;
  if s.pipeline_id <> new.pipeline_id then
    raise exception 'A etapa % não pertence ao funil %', new.stage_id, new.pipeline_id using errcode = '23514';
  end if;
  -- NOVO (07/10/2026): etapa aposentada não recebe negócio — nem por
  -- `move_deal`, nem por `PATCH` direto, nem por negócio que nasce nela. Quem
  -- JÁ estava lá foi levado para a sucessora por `app.aposentar_etapa`.
  if s.retired_at is not null
     and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id) then
    raise exception 'A etapa "%" saiu do funil e não recebe mais negócio', s.name using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    new.entered_stage_at := now();
    -- O motivo vale só se vier no mesmo comando da mudança de etapa (não herda o anterior).
    if new.stage_change_reason is not distinct from old.stage_change_reason then
      new.stage_change_reason := null;
    end if;
    if s.is_won then
      new.status := 'won';
    elsif s.is_lost then
      new.status := 'lost';
    elsif s.is_dormant then
      new.status := 'nurturing';                -- Nutrição/dormente é etapa E status (PRD §5.6: Frio)
    elsif old.status in ('won','lost','nurturing') then
      new.status := 'open';                     -- reabertura/saída da nutrição (PRD §5.3)
    end if;

    -- RF-FUN-04 no banco (§3.9): a etapa cobra o que declarou, venha o comando
    -- do `move_deal` ou de um `PATCH` direto no PostgREST.
    for v_spec in select e.value from jsonb_array_elements(coalesce(s.required_fields, '[]'::jsonb)) e loop
      if coalesce((v_spec ->> 'required')::boolean, true) is not true then
        continue;
      end if;
      if v_spec ? 'consent_kind' then
        if not app.tem_autorizacao_vigente(new.organization_id) then
          raise exception
            'A etapa "%" exige autorização registrada em consent_events antes de entrar (RF-FUN-04, RF-PRE-06)',
            s.name using errcode = '23514';
        end if;
      elsif coalesce(v_spec ->> 'type', '') = 'timestamptz'
            and new.next_action_at is null then
        raise exception 'A etapa "%" exige % — e ela vira a próxima ação do negócio (RF-FUN-04)',
          s.name, coalesce(v_spec ->> 'label', v_spec ->> 'field') using errcode = '23514';
      end if;
    end loop;
  elsif tg_op = 'INSERT' then
    if s.is_won then new.status := 'won';
    elsif s.is_lost then new.status := 'lost';
    elsif s.is_dormant then new.status := 'nurturing';
    end if;
  end if;

  -- RF-FUN-04: perda exige motivo da lista fechada — exceto no opt-out, que é perda por regra
  -- (guardrail: imediato e nunca reabre) e não tem motivo a escolher. Sair da etapa de opt-out
  -- ou de perda limpa o motivo para não sobrar lixo no relatório de motivos de perda.
  if new.status = 'lost' and not coalesce(s.is_optout, false) and new.lost_reason_id is null then
    raise exception 'A etapa "%" exige um motivo de perda (RF-FUN-04)', s.name using errcode = '23514';
  end if;
  if new.status <> 'lost' or coalesce(s.is_optout, false) then
    new.lost_reason_id := null;
  end if;

  if new.status = 'won'  and new.won_at  is null then new.won_at  := now(); end if;
  if new.status = 'lost' and new.lost_at is null then new.lost_at := now(); end if;
  if new.status <> 'won'  then new.won_at  := null; end if;
  if new.status <> 'lost' then new.lost_at := null; end if;
  if new.status <> 'paused' then new.paused_until := null; end if;

  new.updated_at := now();
  return new;
end $function$;


-- ---------------------------------------------------------------------
-- 3 · O destino de um desfecho nunca é uma etapa aposentada
-- ---------------------------------------------------------------------
-- `app.stage_for` prefere o slug literal quando ele existe no funil. Etapa
-- aposentada continua existindo como linha, então sem este filtro um catálogo
-- de desfechos desatualizado resolveria para ela e a tabulação morreria na
-- exceção do gatilho. Com ele, slug aposentado é "este funil não tem etapa
-- para este desfecho" — a recusa honesta que `registrar_contato` já sabe dar
-- (`etapa_fora_do_funil`), com o contato gravado do mesmo jeito.
create or replace function app.stage_for(p_pipeline_id int, p_slug text)
returns setof public.stages
language sql
stable
security invoker
set search_path = ''
as $$
  select s.*
    from public.stages s
   where s.pipeline_id = p_pipeline_id
     and s.retired_at is null
     and s.slug = case
           when exists (select 1 from public.stages d
                         where d.pipeline_id = p_pipeline_id and d.slug = p_slug
                           and d.retired_at is null)
             then p_slug
           else (select e.stage_slug from public.stage_equivalences e
                  where e.pipeline_id = p_pipeline_id and e.canonical_slug = p_slug)
         end
$$;
comment on function app.stage_for(int, text) is
  'Etapa de destino de um desfecho no funil pedido: o slug literal quando existe nesse funil e não foi aposentado, senão a equivalência de public.stage_equivalences. Vazio quando o funil não tem equivalente. Nunca devolve etapa aposentada.';


-- ---------------------------------------------------------------------
-- 4 · Aposentar uma etapa
-- ---------------------------------------------------------------------
-- Uma função, e não um `update` solto na migração, por dois motivos: a ordem
-- importa (primeiro os negócios saem, depois a etapa fecha — etapa fechada com
-- gente dentro é um estado que nenhuma tela mostra), e assim o pgTAP exerce o
-- mesmo código que a produção vai rodar, em vez de uma cópia dele.
--
-- Funil ou etapa que não existem = 0 e nada feito: é o caso do banco novo,
-- em que a migração roda ANTES da seed e a seed já não traz essas etapas.
create or replace function app.aposentar_etapa(p_funil text, p_etapa text, p_sucessora text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa public.stages%rowtype;
  v_para  public.stages%rowtype;
  v_n     int := 0;
begin
  select s.* into v_etapa
    from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_etapa;
  if not found or v_etapa.retired_at is not null then
    return 0;
  end if;
  if v_etapa.is_entry then
    raise exception 'A etapa de entrada "%" não se aposenta: é nela que o negócio nasce', v_etapa.name
      using errcode = '23514';
  end if;

  select s.* into v_para
    from public.stages s
   where s.pipeline_id = v_etapa.pipeline_id and s.slug = p_sucessora and s.retired_at is null;
  if not found or v_para.id = v_etapa.id then
    raise exception 'A sucessora "%" não existe (ou já saiu) no funil "%"', p_sucessora, p_funil
      using errcode = '23503';
  end if;

  -- `changed_by` fica nulo no histórico (não há sessão): a linha do tempo da
  -- ficha escreve "Sistema", e o motivo diz o que houve.
  update public.deals d
     set stage_id = v_para.id,
         stage_change_reason = 'A etapa "' || v_etapa.name || '" saiu do funil; quem estava nela foi para "'
                               || v_para.name || '"'
   where d.stage_id = v_etapa.id;
  get diagnostics v_n = row_count;

  update public.stages set retired_at = now() where id = v_etapa.id;
  return v_n;
end $$;
comment on function app.aposentar_etapa(text, text, text) is
  'Tira uma etapa do funil sem apagar a história: leva os negócios que estão nela para a sucessora (com o motivo no histórico de etapas) e marca stages.retired_at. Devolve quantos negócios mudaram. Etapa inexistente ou já aposentada devolve 0.';
revoke all on function app.aposentar_etapa(text, text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 5 · O quadro começa em Contatado
-- ---------------------------------------------------------------------
-- Definição viva de 20261002120000 (mesma assinatura, então `create or
-- replace` substitui e os grants ficam). A única mudança está marcada `-- NOVO`.
CREATE OR REPLACE FUNCTION public.pipeline_board(p_pipeline_id integer, p_only_mine boolean DEFAULT false, p_owner_id uuid DEFAULT NULL::uuid, p_q text DEFAULT NULL::text, p_stage_id integer DEFAULT NULL::integer, p_limit_per_stage integer DEFAULT 40, p_offset integer DEFAULT 0, p_canal app.channel DEFAULT NULL::app.channel)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       -- NOVO (28/09/2026, ADR-16): o recorte por canal do ÚLTIMO TOQUE. Lido do
       -- jsonb `card`, e não por `join public.deals`: a 20261002110000 já pôs
       -- `last_channel` lá, e uma junção a mais por cartão custaria mais que uma
       -- leitura de chave no jsonb que a view já montou.
       and (p_canal is null or (c.card ->> 'last_channel') = p_canal::text)
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
              where s.pipeline_id = p_pipeline_id
                -- NOVO (07/10/2026): o quadro começa no contato. A etapa de
                -- entrada (quem ainda não foi contatado mora em Prospectados) e
                -- as aposentadas não são coluna — nem contagem, nem destino.
                and not s.is_entry
                and s.retired_at is null), '[]'::jsonb))
    into v_board;

  return v_board;
end $function$;
comment on function public.pipeline_board(int, boolean, uuid, text, int, int, int, app.channel) is
  'O quadro do kanban (RF-FUN-01): etapas, contagem e uma página de cartões por etapa, com o recorte de visibilidade do papel e o filtro por canal do último toque. Desde 07/10/2026 começa em Contatado: a etapa de entrada (stages.is_entry) e as aposentadas (stages.retired_at) não são coluna.';


-- ---------------------------------------------------------------------
-- 6 · O relatório de funil lê as mesmas linhas do quadro
-- ---------------------------------------------------------------------
-- Definição viva; a única mudança está marcada `-- NOVO`. A coorte continua
-- sendo "negócios que nasceram no período" — então a primeira linha
-- (Contatado) passa a dizer, na conversão acumulada, quanto da base nascida
-- no período já foi contatada.
CREATE OR REPLACE FUNCTION public.relatorio_funil(p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date, p_pipeline_id integer DEFAULT NULL::integer)
 RETURNS TABLE(funil_id integer, funil_slug text, funil_nome text, etapa_id integer, etapa_slug text, etapa_nome text, posicao integer, temperatura app.temperature, sla_horas integer, is_ganho boolean, is_perda boolean, is_dormente boolean, na_linha_do_funil boolean, negocios_agora integer, negocios_parados integer, entradas_no_periodo integer, coorte integer, alcancaram integer, chegaram_ate integer, conversao_etapa numeric, conversao_acumulada numeric, mediana_dias_na_etapa numeric, p75_dias_na_etapa numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     where (p_pipeline_id is null or s.pipeline_id = p_pipeline_id)
       -- NOVO (07/10/2026): as mesmas linhas do quadro. A etapa de entrada e
       -- as aposentadas saem da LISTA; continuam contando em `alcance_ate`
       -- (que lê `public.stages` direto), então quem passou por "Em conversa"
       -- em setembro segue valendo como "chegou a Respondeu ou adiante".
       and not s.is_entry
       and s.retired_at is null),
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
end $function$;


-- ---------------------------------------------------------------------
-- 7 · A IA só sugere etapa que o quadro tem
-- ---------------------------------------------------------------------
-- Definição viva; a única mudança está marcada `-- NOVO`.
CREATE OR REPLACE FUNCTION app.ia_entrada_da_ficha(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_conversa  public.conversations%rowtype;
  v_deal      public.deals%rowtype;
  v_org       public.organizations%rowtype;
  v_ficha     public.ficha_da_conversa%rowtype;
  v_desde     timestamptz;
  v_desde_id  uuid;
  v_teto      int;
  v_msgs      jsonb;
begin
  select * into v_conversa from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('existe', false);
  end if;

  select * into v_ficha from public.ficha_da_conversa where conversation_id = p_conversation_id;
  if v_conversa.deal_id is not null then
    select * into v_deal from public.deals where id = v_conversa.deal_id;
  end if;
  if v_conversa.organization_id is not null then
    select * into v_org from public.organizations where id = v_conversa.organization_id;
  end if;

  -- A janela: só o que chegou depois da última análise. Sem ficha, a conversa
  -- inteira — que é a primeira análise, e é a única vez que ela sai cara.
  --
  -- O corte é o PAR (data, id) da última mensagem lida, e não a data sozinha:
  -- duas mensagens no mesmo instante são o caso comum aqui (a que chega e a
  -- resposta do bot nascem na mesma transação, onde `now()` não anda), e com o
  -- corte por data uma delas nunca seria analisada.
  v_desde    := v_ficha.analisada_em;
  v_desde_id := v_ficha.ultima_mensagem_analisada;
  v_teto     := 60;

  -- As mais RECENTES, até o teto, devolvidas em ordem de conversa. Cortar pelo
  -- começo seria analisar o passado e ignorar o que acabou de ser dito.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'de', m.de, 'quando', m.quando, 'texto', m.texto)
         order by m.created_at, m.id), '[]'::jsonb)
    into v_msgs
    from (
      select msg.id,
             -- Quem falou, no vocabulário do prompt. O robô assina diferente de
             -- gente porque cortesia de robô não é sinal de interesse.
             case
               when msg.direction = 'in' then 'parceiro'
               when msg.author_kind = 'bot' then 'robo'
               else 'equipe'
             end as de,
             to_char(msg.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI') as quando,
             left(coalesce(msg.body, msg.transcript), 4000) as texto,
             msg.created_at
        from public.messages msg
       where msg.conversation_id = p_conversation_id
         and coalesce(msg.body, msg.transcript) is not null
         and (v_desde is null
              or (msg.created_at, msg.id) > (v_desde, coalesce(v_desde_id, '00000000-0000-0000-0000-000000000000'::uuid)))
       order by msg.created_at desc, msg.id desc
       limit v_teto
    ) m;

  return jsonb_build_object(
    'existe', true,
    'conversation_id', v_conversa.id,
    'organization_id', v_conversa.organization_id,
    'contact_id',      v_conversa.contact_id,
    'deal_id',         v_conversa.deal_id,
    -- Fuso do CRM inteiro (America/Fortaleza): é com este "agora" que o modelo
    -- transforma "amanhã" em data e julga o que é recente.
    'agora', to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI'),
    'etapa', (select s.name from public.stages s where s.id = v_deal.stage_id),
    'etapas_validas', coalesce((
      select jsonb_agg(s.name order by s.position)
        from public.stages s
       where s.pipeline_id = v_deal.pipeline_id
         and not s.is_terminal
         -- NOVO (07/10/2026): a IA só sugere etapa que o quadro tem.
         and not s.is_entry
         and s.retired_at is null
    ), '[]'::jsonb),
    'responsavel', (
      select split_part(coalesce(p.full_name, ''), ' ', 1)
        from public.profiles p where p.id = v_conversa.assignee_id
    ),
    'temperatura', coalesce(v_deal.temperature::text, v_org.temperature::text),
    'ultima_intencao', v_conversa.ai_intent,
    'ficha_anterior', v_ficha.resumo,
    'analisada_em', v_desde,
    'compromissos_abertos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'o_que', c.o_que,
               'prazo', to_char(c.prazo at time zone 'America/Fortaleza', 'DD/MM HH24:MI'))
             order by c.created_at)
        from public.compromissos_da_conversa c
       where c.conversation_id = p_conversation_id and c.status = 'aberto'
    ), '[]'::jsonb),
    'mensagens', v_msgs,
    -- Até onde esta janela leu. O worker devolve este id na gravação, e é ele
    -- que fecha a janela — não `now()`, que esconderia o que chegou durante a
    -- chamada ao modelo.
    'ate_message_id', v_msgs -> -1 ->> 'id',
    -- O que o CRM ainda não sabe é o que vale a pena procurar na conversa.
    'campos_vazios', coalesce((
      select jsonb_agg(campo) from (
        select 'bairro' as campo where v_org.id is not null and v_org.neighborhood is null
        union all select 'instagram' where v_org.id is not null and v_org.instagram_handle is null
        union all select 'email'     where v_org.id is not null and v_org.email is null
        union all select 'site'      where v_org.id is not null and v_org.website is null
        union all select 'telefone_fixo' where v_org.id is not null and v_org.phone_e164 is null
      ) c
    ), '[]'::jsonb)
  );
end $function$;


-- ---------------------------------------------------------------------
-- 8 · A planilha não devolve ninguém a uma etapa aposentada
-- ---------------------------------------------------------------------
-- Definição viva com `st.retired_at is null` nas duas buscas. Uma coluna
-- "Etapa" que diga "Em conversa" cai na busca aproximada entre as etapas que
-- existem; sem parecida, o negócio nasce na etapa de entrada, como qualquer
-- linha sem etapa. "Prospectado" continua casando: a etapa de entrada existe.
CREATE OR REPLACE FUNCTION app.importacao_etapa(t text, p_pipeline integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  k text := app.chave_catalogo(t);
  r record;
begin
  if k is null or p_pipeline is null then
    return '{}'::jsonb;
  end if;
  select st.id, st.name into r
    from public.stages st
   where st.pipeline_id = p_pipeline
     and st.retired_at is null
     and (app.chave_catalogo(st.name) = k or app.chave_catalogo(st.slug) = k)
   limit 1;
  if r.id is not null then
    return jsonb_build_object('id', r.id, 'nome', r.name, 'aproximado', false);
  end if;
  select st.id, st.name into r
    from public.stages st
   where st.pipeline_id = p_pipeline
     and st.retired_at is null
     and extensions.similarity(app.chave_catalogo(st.name), k) >= 0.55
   order by extensions.similarity(app.chave_catalogo(st.name), k) desc, st.position, st.id
   limit 1;
  if r.id is null then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('id', r.id, 'nome', r.name, 'aproximado', true);
end $function$;


-- ---------------------------------------------------------------------
-- 9 · "Autorizações" no relatório de segunda: o fato, não a etapa
-- ---------------------------------------------------------------------
-- Definição viva; as mudanças estão marcadas `-- NOVO`. Contar a passagem pela
-- etapa deixaria o número em zero para sempre no funil fornecedor.
CREATE OR REPLACE FUNCTION app.relatorio_semanal_numeros(p_de date, p_ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_de   timestamptz := (p_de::timestamp) at time zone 'America/Fortaleza';
  v_fim  timestamptz := ((p_ate + 1)::timestamp) at time zone 'America/Fortaleza';
  v_out  jsonb;
begin
  select pg_catalog.jsonb_build_object(
           'alvos_novos',         al.n,
           'portas_batidas',      po.batidas,
           'portas_abertas',      po.abertas,
           'ligacoes',            po.ligacoes,
           'visitas',             po.visitas,
           'mensagens',           po.mensagens,
           'reunioes_realizadas', po.reunioes,
           'reunioes_marcadas',   mo.marcadas,
           'autorizacoes',        au.n,
           'cadastros_iniciados', mo.cadastros,
           'publicados',          mo.publicados,
           'avancos',             mo.avancos,
           'esfriaram',           mo.esfriaram,
           'optouts',             ct.optouts,
           'tarefas_com_prazo',   tf.com_prazo,
           'tarefas_no_prazo',    tf.no_prazo)
    into v_out
    from (select
            count(*) filter (where pc.batida_conta)::int as batidas,
            count(*) filter (where pc.aberta_conta)::int as abertas,
            count(*) filter (where pc.type = 'call'::app.activity_type)::int    as ligacoes,
            count(*) filter (where pc.type = 'visit'::app.activity_type)::int   as visitas,
            count(*) filter (where pc.type = 'message'::app.activity_type)::int as mensagens,
            count(*) filter (where pc.type = 'meeting'::app.activity_type
                               and coalesce(pc.desfecho, '') <> 'reu_no_show')::int as reunioes
            from app.portas_contadas pc
           where pc.occurred_at >= v_de and pc.occurred_at < v_fim) po,
         -- `sa` é a etapa DE ONDE saiu. Sem ela a linha é o nascimento do
         -- negócio, e nascer não é avançar.
         (select
            count(*) filter (where s.slug in ('reuniao_marcada', 'demonstracao_marcada'))::int as marcadas,
            count(*) filter (where s.slug = 'cadastro_em_andamento')::int                      as cadastros,
            count(*) filter (where s.is_won and pl.slug = 'fornecedor')::int                   as publicados,
            count(*) filter (where sa.position is not null and s.position > sa.position
                               and not s.is_lost and not s.is_dormant)::int                    as avancos,
            count(*) filter (where s.is_lost or s.is_dormant)::int                             as esfriaram
            from public.deal_stage_history h
            join public.stages    s  on s.id  = h.to_stage_id
            join public.pipelines pl on pl.id = s.pipeline_id
            join public.deals     d  on d.id  = h.deal_id
            join public.organizations o on o.id = d.organization_id and o.deleted_at is null
            left join public.stages sa on sa.id = h.from_stage_id
           where h.changed_at >= v_de and h.changed_at < v_fim) mo,
         (select count(*)::int as n
            from public.organizations o
           where o.deleted_at is null
             and o.created_at >= v_de and o.created_at < v_fim) al,
         -- NOVO (07/10/2026): a autorização é o FATO gravado em
         -- `consent_events`, e não mais a passagem pela etapa "Autorizou", que
         -- saiu do funil. É a mesma conta de `relatorio_por_fonte` (uma regra,
         -- um lugar): quantos parceiros autorizaram na semana.
         (select count(distinct ce.organization_id)::int as n
            from public.consent_events ce
            join public.organizations o on o.id = ce.organization_id and o.deleted_at is null
           where ce.kind = 'data_use_authorized'::app.consent_kind
             and ce.occurred_at >= v_de and ce.occurred_at < v_fim) au,
         (select count(*)::int as optouts
            from public.consent_events ce
           where ce.kind = 'contact_optout'::app.consent_kind
             and ce.occurred_at >= v_de and ce.occurred_at < v_fim) ct,
         -- RF-REL-10, a única fórmula de prazo do sistema, com o mesmo recorte
         -- de public.relatorio_por_responsavel: denominador = tarefas com prazo
         -- na semana; numerador = concluídas até o prazo.
         (select count(*)::int as com_prazo,
                 count(*) filter (where t.completed_at is not null
                                    and t.completed_at <= t.due_at)::int as no_prazo
            from public.tasks t
           where t.due_at is not null
             and t.status <> 'cancelled'::app.task_status
             and t.due_at >= v_de and t.due_at < v_fim) tf;

  return v_out;
end $function$;


-- ---------------------------------------------------------------------
-- 10 · Os dados: quem entra, quem sai, e para onde
-- ---------------------------------------------------------------------
-- No banco novo `stages` ainda está vazia aqui (a seed roda depois, e já nasce
-- no desenho novo): cada comando abaixo acha zero linha e não faz nada. Em
-- produção é isto que move os negócios.

-- 10.1 · As etapas de entrada.
update public.stages s
   set is_entry = true
  from public.pipelines p
 where p.id = s.pipeline_id
   and ((p.slug = 'fornecedor' and s.slug = 'prospectado')
     or (p.slug = 'produtor'   and s.slug = 'identificado'))
   and not s.is_entry;

-- 10.2 · A frase da autorização passa a virar prova em "Cadastro em andamento".
-- `"required": false`: declarada para ser gravada quando vier, sem barrar a
-- entrada (é o mesmo texto de "Parceria aceita", 20260905000800).
update public.stages s
   set required_fields = s.required_fields || jsonb_build_array(jsonb_build_object(
         'field', 'authorization_evidence',
         'label', 'O que ele autorizou, com as palavras dele (a frase, a data e por onde veio)',
         'consent_kind', 'data_use_authorized',
         'required', false))
  from public.pipelines p
 where p.id = s.pipeline_id and p.slug = 'fornecedor' and s.slug = 'cadastro_em_andamento'
   and not exists (select 1 from jsonb_array_elements(s.required_fields) e
                    where e.value ->> 'field' = 'authorization_evidence');

-- 10.3 · Os desfechos passam a apontar para etapa que existe. O catálogo fala
-- o vocabulário do funil fornecedor (a autoverificação da seed confere).
update public.interaction_outcomes set target_stage_slug = 'respondeu'
 where target_stage_slug = 'em_conversa';
update public.interaction_outcomes set target_stage_slug = 'cadastro_em_andamento'
 where target_stage_slug = 'autorizou';

-- 10.4 · A equivalência que traduzia "autorizou" para o funil produtor perde o
-- sentido: nenhum desfecho fala mais esse slug. "Parceria aceita" continua
-- sendo o destino de `cadastro_em_andamento` no produtor, que é a linha que fica.
delete from public.stage_equivalences where canonical_slug in ('autorizou', 'em_conversa');

-- 10.5 · As duas etapas saem, e quem estava nelas vai para a sucessora.
do $$
declare
  n_conversa int;
  n_autoriz  int;
begin
  n_conversa := app.aposentar_etapa('fornecedor', 'em_conversa', 'respondeu');
  n_autoriz  := app.aposentar_etapa('fornecedor', 'autorizou',   'cadastro_em_andamento');
  raise notice 'funil: % negócio(s) de "Em conversa" para "Respondeu"; % de "Autorizou" para "Cadastro em andamento"',
    n_conversa, n_autoriz;
end $$;

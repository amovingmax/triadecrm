-- =====================================================================
-- O negócio volta a não ter preço
--
-- Decisão do Rafael em 24/09/2026, ao ver o campo pela primeira vez:
-- "esse campo n faz sentido pra gente".
--
-- POR QUE ELE NÃO DEVIA TER NASCIDO
-- O PRD já tinha registrado a recusa por escrito no RF-REL-12: "ficam
-- recusados por escrito o valor por negócio e a probabilidade digitada pelo
-- vendedor (a receita é 8% de uma transação futura, e probabilidade digitada
-- é ficção)". A Komune não vende nada ao fornecedor — ela fica com 8% de uma
-- festa que pode não acontecer, meses depois. Um número digitado ali não é
-- previsão, é palpite, e palpite somado no topo da coluna vira relatório.
-- A migração 20260922110000 trouxe `deals.valor` sem notar que cruzava essa
-- recusa. Aqui ela é desfeita; o resto daquela migração (lead automático,
-- telefone legível) fica de pé.
--
-- NADA SE PERDE: conferido em produção em 24/09/2026, nenhum negócio tinha
-- valor preenchido — o campo subiu dia 22 e ninguém chegou a usar.
--
-- O peso de uma etapa continua sendo a CONTAGEM de negócios, e o equivalente
-- ao valor monetário continua sendo a categoria em déficit (RF-REL-03).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Some quem escrevia o valor
-- ---------------------------------------------------------------------
drop function if exists public.definir_valor_do_negocio(uuid, numeric);

-- ---------------------------------------------------------------------
-- 2. O quadro volta a contar cartões, não reais
--
-- Recriado a partir da definição viva de 20260922110000, com o `join` em
-- `deals` e as três contas de valor removidas. O `join` existia só para o
-- valor: `app.deal_cards` já traz tudo o que o cartão mostra.
-- ---------------------------------------------------------------------
create or replace function public.pipeline_board(p_pipeline_id integer, p_only_mine boolean default false,
                                                 p_owner_id uuid default null, p_q text default null,
                                                 p_stage_id integer default null,
                                                 p_limit_per_stage integer default 40,
                                                 p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
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
end $function$;

-- ---------------------------------------------------------------------
-- 3. E o campo sai da tabela
-- ---------------------------------------------------------------------
alter table public.deals drop column if exists valor;

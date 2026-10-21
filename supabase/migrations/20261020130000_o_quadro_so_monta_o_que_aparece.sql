-- =============================================================================
-- O quadro só monta o cartão de quem aparece nele (20/10/2026)
-- =============================================================================
-- `public.pipeline_board` montava o cartão (`app.deal_cards`, um jsonb de 27
-- chaves) e a ordenação por janela de TODO negócio do funil, e só no fim tirava
-- as etapas que não são coluna: a de entrada (Prospectado, Identificado — quem
-- ainda não foi contatado mora em Prospectados) e as aposentadas. Depois de
-- `app.esvaziar_quadro` (14/10/2026), quase todo negócio aberto está na etapa de
-- entrada: era quase todo o trabalho da função, para nada aparecer.
--
-- A única mudança é o filtro por etapa logo em `visiveis`, com a MESMA condição
-- do fim (`not s.is_entry and s.retired_at is null`). Conferido no banco local,
-- com 5.000 negócios na entrada e 300 em Contatado: o jsonb devolvido é idêntico
-- (fora `generated_at`) nos três funis, nos recortes padrão, "só meus", busca e
-- "mais da etapa", para gestor e embaixador; o funil de fornecedores do gestor
-- foi de 224 ms a 16 ms.
--
-- A definição de partida é a de `20261007100000_o_funil_comeca_no_contato.sql`
-- (com o recorte por canal da `20261002110000`), lida do banco em 20/10/2026.
-- Pode rodar de novo sem efeito.
-- =============================================================================

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
       -- NOVO (20/10/2026): as etapas que não são coluna (a de entrada e as
       -- aposentadas) saem AQUI, e não só no fim. O resultado é o mesmo — o fim
       -- continua filtrando —, mas o cartão (um jsonb de 27 chaves por negócio) e a
       -- ordenação por janela deixam de ser montados para quem não aparece. Depois
       -- de `app.esvaziar_quadro` (14/10/2026) quase todo negócio aberto está na
       -- etapa de entrada, então era quase todo o trabalho da função.
       and c.stage_id in (select s.id from public.stages s
                           where s.pipeline_id = p_pipeline_id
                             and not s.is_entry
                             and s.retired_at is null)
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
end $function$

;

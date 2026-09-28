-- =====================================================================
-- O canal do último toque, no negócio
-- =====================================================================
-- Rafael confirmou em 28/09/2026: FILTRO de canal no funil que já existe, e NÃO
-- um funil separado para ligação. O motivo é do R13 §3.1 e está no ADR-16: o
-- fornecedor que ignorou o WhatsApp e atendeu o telefone é UM lead, não dois.
-- Com dois funis ele apareceria em dois lugares, com duas etapas que discordam,
-- e ninguém saberia qual vale.
--
-- ONDE O CANAL JÁ MORA: `activities.channel`. O que falta é o funil poder
-- perguntar sem varrer a timeline de cada cartão. A coluna é DERIVADA e a
-- mantém quem já mantém `last_activity_at` — o mesmo gatilho, no mesmo toque,
-- pelo mesmo motivo (recência).
--
-- LIMITE ESCRITO: isto é o canal do ÚLTIMO TOQUE, não "por onde o lead entrou".
-- `app.wa_resposta_no_funil` grava uma atividade de WhatsApp na primeira
-- resposta (20260915130000), então um fornecedor tocado por telefone que
-- responde no WhatsApp migra para `whatsapp`. Se o Rafael quiser origem, é outra
-- coluna e outra rodada.
--
-- A COLUNA E O BACKFILL ESTÃO NA 20261002110000, e não aqui: `app.deal_cards` é
-- recriada lá e lê `last_channel`, e migração que lê antes de criar não sobe.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O índice do filtro
-- ---------------------------------------------------------------------
-- Parcial em `status = 'open'` porque o quadro só mostra negócio aberto, e
-- (pipeline_id, last_channel) na ordem em que a consulta filtra.
create index if not exists deals_last_channel_idx on public.deals (pipeline_id, last_channel)
  where status = 'open'::app.deal_status;

-- ---------------------------------------------------------------------
-- 2. Quem mantém a coluna
-- ---------------------------------------------------------------------
-- Recriada a partir da definição viva (20260904000300), com uma linha nova.
-- Assinatura idêntica, então `create or replace` substitui de verdade e o
-- gatilho `activities_touch_deal` não precisa ser recriado.
create or replace function app.activities_touch_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deal_id is not null and new.type <> 'system' then
    update public.deals d
       set last_activity_at = greatest(coalesce(d.last_activity_at, new.occurred_at), new.occurred_at),
           -- NOVO (28/09/2026, ADR-16): o canal do toque mais recente. As
           -- expressões do SET leem a linha ANTIGA, então `d.last_activity_at`
           -- aqui é o valor de antes — é assim que um toque retroativo (uma DM
           -- importada de dez dias atrás) não rouba o carimbo de quem é mais
           -- recente. `coalesce` porque atividade de nota e de mudança de etapa
           -- chegam sem canal, e um toque sem canal não apaga o canal do toque
           -- anterior.
           last_channel = case when new.occurred_at >= coalesce(d.last_activity_at, new.occurred_at)
                               then coalesce(new.channel, d.last_channel)
                               else d.last_channel end
     where d.id = new.deal_id;
  end if;
  return new;
end $$;
comment on function app.activities_touch_deal() is
  'Mantém deals.last_activity_at e deals.last_channel a cada atividade que não é de sistema. O canal é atributo do TOQUE (R13 §3.1): a ligação não cria um segundo lead, ela troca o canal do mesmo negócio.';

-- ---------------------------------------------------------------------
-- 3. O filtro de canal no quadro
-- ---------------------------------------------------------------------
-- A ASSINATURA MUDA, ENTÃO A ANTIGA MORRE PRIMEIRO. `create or replace` com um
-- parâmetro a mais CRIA uma segunda função em vez de substituir a primeira, e
-- `apps/web/src/components/funis/acoes/consultas.ts` chama
-- `supabase.rpc('pipeline_board', {…})` por NOME de argumento: com duas
-- sobrecargas o PostgREST devolve "function is not unique" e o quadro inteiro
-- para de abrir — não no filtro, na PRIMEIRA abertura. O `drop` leva os grants
-- junto, e por isso eles são repetidos no fim.
--
-- O corpo abaixo é a definição VIVA copiada por `pg_get_functiondef`, e não
-- reescrita de memória: são ~100 linhas de recorte de visibilidade (`sees_all`,
-- embaixador, carteira) e perder uma sem perceber é perder a máscara do
-- RF-BAS-14 pela porta dos fundos. A única mudança está marcada `-- NOVO`.
drop function if exists public.pipeline_board(int, boolean, uuid, text, int, int, int);

create function public.pipeline_board(p_pipeline_id integer, p_only_mine boolean default false, p_owner_id uuid default null::uuid, p_q text default null::text, p_stage_id integer default null::integer, p_limit_per_stage integer default 40, p_offset integer default 0, p_canal app.channel default null::app.channel)
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
              where s.pipeline_id = p_pipeline_id), '[]'::jsonb))
    into v_board;

  return v_board;
end $function$;

comment on function public.pipeline_board(int, boolean, uuid, text, int, int, int, app.channel) is
  'O quadro do kanban (RF-FUN-01): etapas, contagem e uma página de cartões por etapa, com o recorte de visibilidade do papel. NOVO em 28/09/2026: o recorte por canal do ÚLTIMO TOQUE. É filtro, não funil — o lead tocado por dois canais continua num cartão só (R13 §3.1, ADR-16).';
revoke all on function public.pipeline_board(int, boolean, uuid, text, int, int, int, app.channel)
  from public, anon;
grant execute on function public.pipeline_board(int, boolean, uuid, text, int, int, int, app.channel)
  to authenticated, service_role;

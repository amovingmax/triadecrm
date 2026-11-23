-- =====================================================================
-- O perfil na lista de Prospectados (Imova, 23/11/2026)
--
-- Pedido do usuário, depois das três tags dos Parceiros (20261123200000):
-- "A aba de prospectados também deve aparecer um filtro para buscarmos os
-- clientes e os parceiros."
--
-- `public.search_organizations` ganha `p_perfil`: cliente (sem a marca de
-- `public.consultoria`), parceiro (com ela), ou uma das três tags
-- (proprietario, colaborador, inquilino). Valor desconhecido é recusado (22023),
-- como o `p_contato`: um filtro que falha em silêncio devolve a base inteira.
--
-- O corpo é o da 20260911100000, igual ao do banco (conferido pelo md5 do
-- corpo no banco local da Imova em 23/11/2026), com só o parâmetro, a checagem
-- e o recorte novos. Colunas devolvidas, ordem e permissões não mudam.
--
-- NAS DUAS EMPRESAS: a função é a mesma na KOMUNE. Sem `p_perfil` (nulo), a
-- busca é a de antes; a tela da KOMUNE não manda o parâmetro.
--
-- POR QUE `drop function`: parâmetro novo cria uma função NOVA, e duas
-- `search_organizations` convivendo deixam o PostgREST escolher entre elas
-- (ver a 20260911100000).
--
-- COMO DESFAZER: `drop function public.search_organizations(text, integer, integer, integer, uuid, app.org_kind, integer, integer, text, text)`
-- e reaplicar a da 20260911100000.
-- =====================================================================

drop function if exists public.search_organizations(
  text, integer, integer, integer, uuid, app.org_kind, integer, integer, text);

create or replace function public.search_organizations(
  q              text          default null,
  p_category_id  integer       default null,
  p_city_id      integer       default null,
  p_stage_id     integer       default null,
  p_owner_id     uuid          default null,
  p_kind         app.org_kind  default null,
  p_limit        integer       default 50,
  p_offset       integer       default 0,
  p_contato      text          default null,
  p_perfil       text          default null
)
returns table (
  id                        uuid,
  name                      text,
  kind                      app.org_kind,
  primary_category          text,
  city                      text,
  neighborhood              text,
  phone                     text,
  instagram_handle          text,
  temperature               app.temperature,
  owner                     text,
  stage                     text,
  next_action_at            timestamptz,
  last_activity_at          timestamptz,
  days_since_contact        integer,
  needs_attention           boolean,
  last_outcome_slug         text,
  last_outcome_name         text,
  last_outcome_counts_as    text,
  last_outcome_temperature  text,
  last_contact_channel      text,
  last_contact_at           timestamptz,
  last_contact_by           text,
  contact_attempts          integer,
  total_count               bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_q       text := nullif(trim(coalesce(q, '')), '');
  v_digits  text := regexp_replace(coalesce(q, ''), '\D', '', 'g');
  v_phone   text;
  v_cnpj    text;
  v_ig      text;
  v_name    text;
  v_limit   int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset  int := greatest(coalesce(p_offset, 0), 0);
  v_contato text := nullif(trim(coalesce(p_contato, '')), '');
  v_perfil  text := nullif(trim(coalesce(p_perfil, '')), '');
begin
  -- Valor de filtro desconhecido é recusado, e não ignorado: um filtro que falha
  -- em silêncio devolve a base inteira, e quem pediu "só quem não atendeu" liga
  -- para quem já marcou reunião achando que está na fila certa.
  if v_contato is not null
     and v_contato not in ('nunca', 'sem_conversa', 'conversou', 'invalido') then
    raise exception 'Filtro de contato desconhecido: %', v_contato using errcode = '22023';
  end if;
  -- O perfil (23/11/2026): Cliente = sem a marca de `public.consultoria`;
  -- Parceiro = com ela; e cada uma das três tags.
  if v_perfil is not null
     and v_perfil not in ('cliente', 'parceiro', 'proprietario', 'colaborador', 'inquilino') then
    raise exception 'Filtro de perfil desconhecido: %', v_perfil using errcode = '22023';
  end if;

  if v_q is not null then
    if length(v_digits) >= 8 and v_q ~ '^[\d\s()+.-]+$' then
      v_phone := app.normalize_phone_br(v_q);
    end if;
    if length(v_digits) = 14 then
      v_cnpj := app.normalize_cnpj(v_q);
    end if;
    if v_q ~* '^@|instagram\.com/' then
      v_ig := app.normalize_instagram(v_q);
    end if;
    if v_q !~ '^[\d\s()+.-]+$' then
      v_name := app.search_name(regexp_replace(v_q, '^@', ''));
    end if;
    if length(v_digits) < 4 or v_q !~ '^[\d\s()+.-]+$' then
      v_digits := null;
    end if;
    -- RF-BAS-14: para quem vê o telefone mascarado (sdr/embaixador) a busca por
    -- "contém" seria um oráculo — um dígito por consulta reconstrói o número
    -- inteiro sem passar por reveal_phone e, portanto, sem linha em
    -- pii_access_log. Esses papéis só acham pelo número completo.
    if not app.reads_base_pii() then
      v_digits := null;
    end if;
  else
    v_digits := null;
  end if;

  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;

  return query
  with base as (
    select o.id, o.name, o.kind, cat.name as primary_category_name, ci.name as city_name, o.neighborhood,
           case when app.reads_base_pii() then o.phone_e164 else app.mask_phone(o.phone_e164) end as phone_e164,
           o.instagram_handle, o.temperature, o.owner_id,
           case
             when v_phone is not null and o.phone_e164 = v_phone then 0
             when v_cnpj  is not null and o.cnpj = v_cnpj then 0
             when v_ig    is not null and o.instagram_handle = v_ig then 0
             when v_name  is not null and o.search_name like v_name || '%' then 1
             when v_name  is not null and o.instagram_handle like v_name || '%' then 2
             when v_name  is not null and o.search_name operator(extensions.%) v_name then 3
             else 4
           end as rank,
           case when v_name is not null then extensions.similarity(o.search_name, v_name) else 0 end as sim
      from public.organizations o
      left join public.cities ci on ci.id = o.city_id
      left join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
      left join public.categories cat on cat.id = pc.category_id
     where o.deleted_at is null
       and app.org_is_visible(o.id)
       and (p_kind is null or o.kind = p_kind)
       and (p_city_id is null or o.city_id = p_city_id)
       and (p_owner_id is null or o.owner_id = p_owner_id)
       and (p_category_id is null or exists (
              select 1 from public.organization_categories oc
               where oc.organization_id = o.id and oc.category_id = p_category_id))
       and (p_stage_id is null or exists (
              select 1 from public.deals d where d.organization_id = o.id and d.stage_id = p_stage_id))
       -- O filtro de contato olha o ÚLTIMO contato de gente, e não "algum dia":
       -- quem não atendeu em agosto e marcou reunião ontem não está na fila de
       -- ligar de novo. A subconsulta é a mesma leitura do lateral `uc` abaixo.
       and (
             v_contato is null
          or (v_contato = 'nunca' and not exists (
                select 1 from public.activities a
                 where a.organization_id = o.id and a.outcome_id is not null))
          or (v_contato <> 'nunca' and (
                -- `counts_as` é o enum app.door_kind; o `case` abaixo devolve texto,
                -- e não existe operador door_kind = text.
                select io.counts_as::text
                  from public.activities a
                  join public.interaction_outcomes io on io.id = a.outcome_id
                 where a.organization_id = o.id and a.outcome_id is not null
                 order by a.occurred_at desc, a.created_at desc
                 limit 1) = case v_contato
                              when 'sem_conversa' then 'batida'
                              when 'conversou'    then 'aberta'
                              when 'invalido'     then 'nenhuma'
                            end)
           )
       and (
             v_perfil is null
          or (v_perfil = 'cliente' and not exists (
                select 1 from public.consultoria k where k.organization_id = o.id))
          or (v_perfil = 'parceiro' and exists (
                select 1 from public.consultoria k where k.organization_id = o.id))
          or (v_perfil in ('proprietario', 'colaborador', 'inquilino') and exists (
                select 1 from public.consultoria k
                 where k.organization_id = o.id and k.tipo = v_perfil))
           )
       and (
             v_q is null
          or (v_phone  is not null and o.phone_e164 = v_phone)
          or (v_digits is not null and o.phone_e164 like '%' || v_digits || '%')
          or (v_cnpj   is not null and o.cnpj = v_cnpj)
          or (v_ig     is not null and o.instagram_handle = v_ig)
          or (v_name   is not null and (
                  o.search_name like v_name || '%'
               or o.search_name operator(extensions.%) v_name
               or o.instagram_handle like v_name || '%'
               or app.search_name(o.neighborhood) like v_name || '%'))
           )
  ),
  counted as (
    select b.*, count(*) over () as total_count
      from base b
  ),
  -- Ordena e corta ANTES dos LATERAIS: o negócio, a recência e o último contato
  -- são resolvidos só para as linhas que a página realmente mostra.
  pagina as (
    select c.*
      from counted c
     order by c.rank, c.sim desc, c.name
     limit v_limit offset v_offset
  )
  select p.id, p.name, p.kind, p.primary_category_name, p.city_name, p.neighborhood,
         p.phone_e164, p.instagram_handle, p.temperature,
         td.full_name as owner,
         dl.stage_name as stage,
         dl.next_action_at,
         rec.last_activity_at,
         case when rec.last_activity_at is null then null
              else greatest(0, floor(extract(epoch from (now() - rec.last_activity_at)) / 86400)::int)
         end as days_since_contact,
         coalesce(rec.needs_attention, false) as needs_attention,
         uc.slug,
         uc.nome,
         uc.counts_as,
         uc.temperatura,
         uc.canal,
         uc.quando,
         uc.quem,
         coalesce(tent.n, 0)::int,
         p.total_count
    from pagina p
    left join public.team_directory td on td.id = p.owner_id
    left join lateral (
      select s.name as stage_name, d.next_action_at
        from public.deals d
        join public.stages s on s.id = d.stage_id
       where d.organization_id = p.id
         and (p_stage_id is null or d.stage_id = p_stage_id)
         and d.status = 'open'
         and (app.sees_all() or d.owner_id = auth.uid())
       order by d.updated_at desc
       limit 1) dl on true
    left join lateral (
      select max(d2.last_activity_at) as last_activity_at,
             bool_or(d2.needs_attention) filter (where d2.status = 'open') as needs_attention
        from public.deals d2
       where d2.organization_id = p.id
         and (app.sees_all() or d2.owner_id = auth.uid())) rec on true
    -- O último contato DE GENTE: a atividade com desfecho mais recente. "Com
    -- desfecho" é o que separa uma ligação de uma importação — medido, as 168
    -- atividades de sistema da base não têm nenhuma.
    left join lateral (
      select io.slug,
             io.name        as nome,
             io.counts_as::text as counts_as,
             io.sets_temperature::text as temperatura,
             a.channel::text as canal,
             a.occurred_at   as quando,
             who.full_name   as quem
        from public.activities a
        join public.interaction_outcomes io on io.id = a.outcome_id
        left join public.team_directory who on who.id = a.user_id
       where a.organization_id = p.id
         and a.outcome_id is not null
       order by a.occurred_at desc, a.created_at desc
       limit 1) uc on true
    left join lateral (
      select count(*) as n
        from public.activities a
       where a.organization_id = p.id
         and a.outcome_id is not null) tent on true
   order by p.rank, p.sim desc, p.name;
end $function$;

comment on function public.search_organizations(text, integer, integer, integer, uuid, app.org_kind, integer, integer, text, text) is
  'Busca de parceiros (RF-BAS-12/15). Devolve, além do funil, o último contato de GENTE — desfecho, se houve conversa, canal, quando, quem e quantas tentativas — para a lista dizer o que o contato deu, e não só quando foi. p_contato filtra pelo último contato: nunca | sem_conversa | conversou | invalido. p_perfil (23/11/2026) filtra pelo perfil: cliente | parceiro | proprietario | colaborador | inquilino (a marca de public.consultoria e a tag dela).';

revoke all on function public.search_organizations(text, integer, integer, integer, uuid, app.org_kind, integer, integer, text, text) from public, anon;
grant execute on function public.search_organizations(text, integer, integer, integer, uuid, app.org_kind, integer, integer, text, text) to authenticated, service_role;

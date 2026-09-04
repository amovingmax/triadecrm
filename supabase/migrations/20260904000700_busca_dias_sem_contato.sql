-- =====================================================================
-- KOMUNE CRM — v0.1 — D2 — A busca devolve a recência do relacionamento
-- (RF-BAS-12; PRD §5.6; tela de Parceiros).
--
-- Por que mexer numa RPC que já funciona:
--
-- 1) A lista de parceiros lê a temperatura pela cor e a inércia pelo NÚMERO de dias
--    desde o último contato. Sem `days_since_contact` a tela teria de buscar as
--    atividades de cada linha (50 consultas por página) ou mentir. A recência é
--    parte da mesma leitura que a temperatura (PRD §5.6, que é literalmente
--    "etapa x intenção x dias sem contato"), então sai da mesma consulta.
-- 2) `needs_attention` (negócio que passou do prazo da etapa) já é calculado e
--    gravado pelos gatilhos em `deals`; a lista precisa dele para marcar a linha.
-- 3) Desempenho: a versão anterior fazia o LATERAL do negócio para TODAS as linhas
--    filtradas antes de ordenar e cortar. Agora a paginação acontece numa CTE
--    (`pagina`) e os LATERAIS rodam só nas 50 linhas exibidas.
--
-- O que NÃO muda: a assinatura de entrada, a regra de visibilidade
-- (app.org_is_visible), a máscara de telefone (app.mask_phone por app.reads_base_pii)
-- e a proteção de RF-BAS-14 contra busca por trecho de dígitos. As colunas antigas
-- continuam com o mesmo nome e o mesmo tipo; as novas entram antes de `total_count`.
--
-- Precisa de DROP: o tipo de retorno de uma função com OUT parameters não pode ser
-- alterado por CREATE OR REPLACE.
-- =====================================================================

drop function if exists public.search_organizations(text, int, int, int, uuid, app.org_kind, int, int);

create or replace function public.search_organizations(
  q              text default null,
  p_category_id  int default null,
  p_city_id      int default null,
  p_stage_id     int default null,
  p_owner_id     uuid default null,
  p_kind         app.org_kind default null,
  p_limit        int default 50,
  p_offset       int default 0)
returns table (
  id                 uuid,
  name               text,
  kind               app.org_kind,
  primary_category   text,
  city               text,
  neighborhood       text,
  phone              text,
  instagram_handle   text,
  temperature        app.temperature,
  owner              text,
  stage              text,
  next_action_at     timestamptz,
  last_activity_at   timestamptz,
  days_since_contact int,
  needs_attention    boolean,
  total_count        bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q       text := nullif(trim(coalesce(q, '')), '');
  v_digits  text := regexp_replace(coalesce(q, ''), '\D', '', 'g');
  v_phone   text;
  v_cnpj    text;
  v_ig      text;
  v_name    text;
  v_limit   int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset  int := greatest(coalesce(p_offset, 0), 0);
begin
  if v_q is not null then
    -- Parece telefone (≥ 8 dígitos e só caracteres de telefone)?
    if length(v_digits) >= 8 and v_q ~ '^[\d\s()+.-]+$' then
      v_phone := app.normalize_phone_br(v_q);
    end if;
    if length(v_digits) = 14 then
      v_cnpj := app.normalize_cnpj(v_q);
    end if;
    if v_q ~* '^@|instagram\.com/' then
      v_ig := app.normalize_instagram(v_q);
    end if;
    -- Nome/bairro: só quando não é puramente numérico.
    if v_q !~ '^[\d\s()+.-]+$' then
      v_name := app.search_name(regexp_replace(v_q, '^@', ''));
    end if;
    -- Entrada só com caracteres de telefone e ≥ 4 dígitos: também busca por "contém"
    -- (últimos dígitos, trecho do meio). Texto com letras não usa esse caminho.
    if length(v_digits) < 4 or v_q !~ '^[\d\s()+.-]+$' then
      v_digits := null;
    end if;
    -- RF-BAS-14: para quem vê o telefone mascarado (sdr/embaixador) a busca por "contém" seria um
    -- oráculo — um dígito por consulta reconstrói o número inteiro sem passar por reveal_phone e,
    -- portanto, sem linha em pii_access_log. Esses papéis só acham pelo número completo
    -- (RF-BAS-12 continua atendido: quem tem o número em mãos chega na ficha).
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
  -- Ordena e corta ANTES dos LATERAIS: o negócio e a recência são resolvidos só
  -- para as linhas que a página realmente mostra.
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
         -- Dias inteiros desde o último contato; NULL quando nunca houve contato
         -- (a interface escreve "sem contato", que não é o mesmo que "hoje").
         case when rec.last_activity_at is null then null
              else greatest(0, floor(extract(epoch from (now() - rec.last_activity_at)) / 86400)::int)
         end as days_since_contact,
         coalesce(rec.needs_attention, false) as needs_attention,
         p.total_count
    from pagina p
    left join public.team_directory td on td.id = p.owner_id
    -- Negócio em foco: o aberto mais recentemente mexido (respeitando o filtro de etapa).
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
    -- Recência do relacionamento: o contato mais recente entre TODOS os negócios
    -- visíveis da organização (não só o aberto). Quem fechou ou perdeu também tem
    -- uma última conversa, e é ela que diz há quanto tempo ninguém fala com a pessoa.
    left join lateral (
      select max(d2.last_activity_at) as last_activity_at,
             bool_or(d2.needs_attention) filter (where d2.status = 'open') as needs_attention
        from public.deals d2
       where d2.organization_id = p.id
         and (app.sees_all() or d2.owner_id = auth.uid())) rec on true
   order by p.rank, p.sim desc, p.name;
end $$;
comment on function public.search_organizations(text, int, int, int, uuid, app.org_kind, int, int) is
  'Busca global de organizações por nome, telefone, @instagram, CNPJ e bairro (RF-BAS-12), com etapa, próxima ação, dias desde o último contato e alerta de esfriamento; mesma visibilidade e máscara da organizations_view. Busca por trecho de dígitos só para quem já lê o telefone completo (RF-BAS-14).';

-- ---------- grants (o DROP levou junto os anteriores) ----------
revoke all on function public.search_organizations(text, int, int, int, uuid, app.org_kind, int, int) from public, anon;
grant execute on function public.search_organizations(text, int, int, int, uuid, app.org_kind, int, int) to authenticated, service_role;

-- =====================================================================
-- KOMUNE CRM — v0.1 — D1 — RPCs da base de parceiros (schema public: a API só expõe public)
--   * public.search_organizations  — busca global da lista (RF-BAS-12, RF-BAS-14)
--   * public.quick_create_organization — cadastro rápido com dedup por telefone (RF-BAS-15)
-- =====================================================================

-- ---------- busca ----------
-- Entrada livre `q`: nome (prefixo + trigram), telefone (normalizado, exato; ou trecho de dígitos),
-- @instagram, CNPJ e bairro.
--
-- SECURITY DEFINER sobre a tabela base (desvio consciente da especificação "invoker sobre
-- organizations_view"): pela view, o telefone já chega mascarado para sdr/embaixador e a busca
-- por telefone (RF-BAS-12) ficaria impossível para exatamente quem mais a usa em campo.
-- A função aplica a MESMA regra de visibilidade da view (app.org_is_visible) e a MESMA máscara
-- (app.mask_phone por app.reads_base_pii), e o embaixador só enxerga a etapa dos próprios negócios.
--
-- Desempenho (≈ 5 mil linhas): telefone/CNPJ/@ exatos usam os índices únicos parciais;
-- nome usa o GIN trigram de search_name (prefixo via LIKE e similaridade via %);
-- bairro e trecho de telefone são LIKE sem índice, aceitáveis nesse volume (< 10 ms);
-- total_count via window function evita uma segunda consulta para paginação.
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
  id                uuid,
  name              text,
  kind              app.org_kind,
  primary_category  text,
  city              text,
  neighborhood      text,
  phone             text,
  instagram_handle  text,
  temperature       app.temperature,
  owner             text,
  stage             text,
  next_action_at    timestamptz,
  total_count       bigint)
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
           o.instagram_handle, o.temperature, o.owner_id, o.search_name, o.cnpj,
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
  )
  select c.id, c.name, c.kind, c.primary_category_name, c.city_name, c.neighborhood,
         c.phone_e164, c.instagram_handle, c.temperature,
         td.full_name as owner,
         dl.stage_name as stage,
         dl.next_action_at,
         c.total_count
    from counted c
    left join public.team_directory td on td.id = c.owner_id
    left join lateral (
      select s.name as stage_name, d.next_action_at
        from public.deals d
        join public.stages s on s.id = d.stage_id
       where d.organization_id = c.id
         and (p_stage_id is null or d.stage_id = p_stage_id)
         and d.status = 'open'
         and (app.sees_all() or d.owner_id = auth.uid())
       order by d.updated_at desc
       limit 1) dl on true
   order by c.rank, c.sim desc, c.name
   limit v_limit offset v_offset;
end $$;
comment on function public.search_organizations(text, int, int, int, uuid, app.org_kind, int, int) is
  'Busca global de organizações por nome, telefone, @instagram, CNPJ e bairro (RF-BAS-12); mesma visibilidade e máscara da organizations_view. Busca por trecho de dígitos só para quem já lê o telefone completo (RF-BAS-14).';

-- ---------- cadastro rápido (RF-BAS-15) ----------
-- Quatro campos (nome, categoria, WhatsApp, origem) + tipo. Dedup imediata por telefone e
-- pela lista de supressão. Cria organização (dono = quem chamou), categoria primária, negócio
-- no funil coerente com o tipo (fornecedor/espaco/empresa/outro → fornecedor;
-- produtor/cerimonialista → produtor) na primeira etapa, com "Primeiro contato" em D+1 útil,
-- e uma atividade de sistema na timeline.
--
-- SECURITY DEFINER (desvio consciente da especificação "security invoker"): a dedup precisa
-- enxergar todas as organizações, inclusive as que o papel do chamador não vê, e o
-- INSERT ... RETURNING exigiria política de SELECT na tabela base para sdr/embaixador.
-- O papel é checado explicitamente (leitura/financeiro não criam) e o dono é sempre auth.uid().
create or replace function public.quick_create_organization(
  p_name         text,
  p_category_id  int,
  p_phone        text,
  p_source_id    int,
  p_kind         app.org_kind default 'fornecedor')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_phone     text;
  v_existing  uuid;
  v_pipeline  int;
  v_stage     int;
  v_source    record;
  v_org       uuid;
  v_deal      uuid;
  v_tier      text;
  v_collector text;
begin
  if v_uid is null or not app.can_write() then
    raise exception 'Papel % não pode criar parceiros', app.role() using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    return jsonb_build_object('created', false, 'reason', 'nome_obrigatorio');
  end if;

  v_phone := app.normalize_phone_br(p_phone);
  if v_phone is null then
    return jsonb_build_object('created', false, 'reason', 'telefone_invalido');
  end if;

  if app.is_suppressed(v_phone) then
    return jsonb_build_object('created', false, 'reason', 'telefone_suprimido');
  end if;

  select o.id into v_existing
    from public.organizations o
   where o.phone_e164 = v_phone and o.deleted_at is null
   limit 1;
  if v_existing is not null then
    -- A dedup olha a base inteira, mas o id só volta para quem já podia abrir a ficha: devolvê-lo
    -- a um embaixador fora da carteira entregava a chave de uma organização alheia.
    if app.org_is_visible(v_existing) then
      return jsonb_build_object('created', false, 'existing_id', v_existing, 'reason', 'telefone_ja_cadastrado');
    end if;
    return jsonb_build_object('created', false, 'reason', 'telefone_ja_cadastrado');
  end if;

  -- O mesmo número pode já estar cadastrado como WhatsApp de uma PESSOA (dono, sócio) ligada a
  -- uma organização: criar outra organização geraria dois cartões e duas conversas para o mesmo
  -- número, exatamente o que RF-BAS-15 quer evitar. Devolve a pessoa e, quando visível, a ficha.
  select oc.organization_id into v_existing
    from public.contacts c
    join public.organization_contacts oc on oc.contact_id = c.id
    join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
   where c.phone_e164 = v_phone and c.deleted_at is null
   order by oc.is_primary desc
   limit 1;
  if v_existing is not null then
    if app.org_is_visible(v_existing) then
      return jsonb_build_object('created', false, 'existing_id', v_existing, 'reason', 'telefone_de_contato_existente');
    end if;
    return jsonb_build_object('created', false, 'reason', 'telefone_de_contato_existente');
  end if;

  if not exists (select 1 from public.categories c where c.id = p_category_id and c.is_active) then
    return jsonb_build_object('created', false, 'reason', 'categoria_invalida');
  end if;

  -- A origem precisa existir E estar habilitada: sources é catálogo configurável (RF-ADM-02) e
  -- uma fonte desligada pelo gestor não pode continuar entrando como origem pelo cadastro rápido.
  select s.id, s.kind, s.slug into v_source from public.sources s where s.id = p_source_id;
  if v_source.id is null then
    return jsonb_build_object('created', false, 'reason', 'origem_invalida');
  end if;
  if not exists (select 1 from public.sources s where s.id = p_source_id and s.is_enabled) then
    return jsonb_build_object('created', false, 'reason', 'origem_desabilitada');
  end if;

  -- Funil coerente com o tipo e sua primeira etapa.
  select p.id into v_pipeline
    from public.pipelines p
   where p.slug = case when p_kind in ('produtor','cerimonialista') then 'produtor' else 'fornecedor' end;
  select st.id into v_stage
    from public.stages st
   where st.pipeline_id = v_pipeline and not st.is_lost and not st.is_won
   order by st.position
   limit 1;
  if v_stage is null then
    raise exception 'Funil sem etapas cadastradas: aplique a seed (pipelines/stages)' using errcode = 'P0001';
  end if;

  -- Indicação / contato pessoal entram como Tier A+ (RF-BAS-15).
  v_tier := case when v_source.kind = 'referral' then 'A+' end;
  select pr.full_name into v_collector from public.profiles pr where pr.id = v_uid;

  insert into public.organizations (kind, name, phone_e164, source_id, collected_at, collector, owner_id)
  values (p_kind, p_name, v_phone, p_source_id, now(), coalesce(v_collector, 'cadastro rápido'), v_uid)
  returning id into v_org;

  insert into public.organization_categories (organization_id, category_id, is_primary)
  values (v_org, p_category_id, true);

  insert into public.deals (organization_id, pipeline_id, stage_id, owner_id, source_id, tier, next_action, next_action_at)
  values (v_org, v_pipeline, v_stage, v_uid, p_source_id, v_tier, 'Primeiro contato',
          ((app.next_business_day((now() at time zone 'America/Fortaleza')::date) + time '09:00') at time zone 'America/Fortaleza'))
  returning id into v_deal;

  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('system', v_org, v_deal, v_uid, 'system', 'Parceiro criado pelo cadastro rápido',
          jsonb_build_object('origin', 'quick_create', 'source_slug', v_source.slug));

  return jsonb_build_object('created', true, 'organization_id', v_org, 'deal_id', v_deal);
end $$;
comment on function public.quick_create_organization(text, int, text, int, app.org_kind) is
  'Cadastro rápido (RF-BAS-15): dedup por telefone/supressão; cria organização, categoria primária, negócio e atividade.';

-- ---------- grants ----------
revoke all on function public.search_organizations(text, int, int, int, uuid, app.org_kind, int, int) from public, anon;
revoke all on function public.quick_create_organization(text, int, text, int, app.org_kind) from public, anon;
grant execute on function public.search_organizations(text, int, int, int, uuid, app.org_kind, int, int) to authenticated, service_role;
grant execute on function public.quick_create_organization(text, int, text, int, app.org_kind) to authenticated, service_role;

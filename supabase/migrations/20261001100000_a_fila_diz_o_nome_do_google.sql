-- =====================================================================
-- A fila diz como a fonte chamou aquilo
--
-- POR QUÊ (medido em 25/09/2026): a fila tinha 155 candidatos, quase todos sem
-- categoria, e o cartão escrevia "Sem categoria". A pessoa tinha de adivinhar,
-- cartão por cartão, entre 19 categorias — sem saber que o Google chamara
-- aquilo de "Impressões fotográficas". O texto EXISTE desde 04/09, em
-- `public.source_record.category_source`; `public.radar_fila` é que nunca o
-- devolveu (a palavra não aparecia uma vez em `apps/web/src`).
--
-- É esta coluna que torna os 155 DECIDÍVEIS, e não só trabalhosos: com ela a
-- fila agrupa por nome da fonte e a decisão passa a ser por grupo.
--
-- COMO, e é o cuidado que importa: um candidato pode ter VÁRIOS
-- `source_record` — a chave única é (source_id, external_id), e o mesmo negócio
-- chega por duas fontes. Um `join` comum multiplicaria as linhas da fila. Daí o
-- `left join lateral … order by sr.last_seen_at desc limit 1`: o mais recente,
-- que é o que a pessoa acabou de importar.
--
-- Acrescentar coluna a um `returns table` exige drop + create (foi assim na
-- 20260917230100, e pelo mesmo motivo). A definição viva é a dela, em estilo
-- pg_dump; está transcrita inteira abaixo e só duas linhas mudam.
--
-- NA MESMA MIGRAÇÃO, o histórico que ficou falando de Radar: o módulo virou
-- "Revisão" em 25/09/2026 e a linha da ficha não soube.
-- =====================================================================

drop function if exists public.radar_fila(text,int,int,text,boolean,int,int);

CREATE OR REPLACE FUNCTION public.radar_fila(p_status text DEFAULT 'novo'::text, p_source_id integer DEFAULT NULL::integer, p_category_id integer DEFAULT NULL::integer, p_q text DEFAULT NULL::text, p_so_marcados boolean DEFAULT false, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, nome text, status app.candidate_status, fonte_id integer, fonte text, fonte_tipo app.source_kind, source_url text, categoria_id integer, categoria text, categoria_na_fonte text, tipo app.org_kind, cidade text, bairro text, telefone text, tem_telefone boolean, instagram text, site text, cnpj text, email text, observacao text, sinalizacoes text[], nao_contatar boolean, pontuacao smallint, faixa text, ia_veredito text, ia_porque text, coletado_em timestamp with time zone, coletor text, criado_em timestamp with time zone, revisado_em timestamp with time zone, revisado_por text, motivo_da_revisao text, organizacao_id uuid, duplicatas jsonb, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_q      text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not app.can_write() then
    raise exception 'Papel % não trabalha a fila do Radar', app.role() using errcode = '42501';
  end if;

  return query
  with filtrada as (
    select c.*
      from public.supplier_candidates c
     where (p_status is null or p_status = 'todos' or c.status::text = p_status)
       and (p_source_id is null   or c.source_id = p_source_id)
       and (p_category_id is null or c.category_id = p_category_id)
       and (not coalesce(p_so_marcados, false) or cardinality(c.flags) > 0)
       and (v_q is null
            or c.search_name like '%' || app.search_name(v_q) || '%'
            or c.cnpj = app.normalize_cnpj(v_q)
            or c.phone_e164 = app.normalize_phone_br(v_q)
            or c.instagram_handle = app.normalize_instagram(v_q))
  ),
  contada as (select count(*) as n from filtrada),
  pagina as (
    select f.* from filtrada f
     order by (f.status = 'novo') desc, f.score desc nulls last, f.created_at desc
     limit v_limit offset v_offset
  )
  select p.id,
         p.name,
         p.status,
         s.id, s.name, s.kind,
         p.source_url,
         p.category_id, cat.name,
         cs.category_source,
         p.kind,
         ci.name, p.neighborhood,
         -- Telefone segue a regra da base (RF-BAS-14): sdr e embaixador leem mascarado.
         case when p.phone_e164 is null then null
              when app.reads_base_pii() then p.phone_e164
              else app.mask_phone(p.phone_e164) end,
         p.phone_e164 is not null,
         p.instagram_handle,
         p.website_domain,
         p.cnpj,
         case when p.email is null then null
              when app.reads_base_pii() then p.email::text
              else '•••' end,
         p.notes,
         p.flags,
         p.do_not_contact,
         p.score,
         p.tier,
         p.ia_veredito,
         p.ia_porque,
         p.collected_at,
         p.collector,
         p.created_at,
         p.reviewed_at,
         rev.full_name,
         p.review_reason,
         p.organization_id,
         coalesce((
           select jsonb_agg(d.*)
             from (
               -- UMA linha por ficha. app.find_org_matches devolve uma linha por REGRA
               -- que casou (a mesma empresa aparece por nome E por telefone), e três
               -- vezes a mesma ficha na tela não é "três suspeitas": é ruído que faz
               -- quem revisa reler para descobrir que é tudo a mesma coisa. Fica a
               -- regra de maior confiança, que é a que explica melhor o casamento.
               select u.organization_id, u.name, u.confidence, u.reason
                 from (
                   select distinct on (m.organization_id)
                          m.organization_id, o.name, m.confidence, m.reason
                     from app.find_org_matches(
                            jsonb_build_object(
                              'name', p.name, 'cnpj', p.cnpj, 'phone_e164', p.phone_e164,
                              'instagram_handle', p.instagram_handle, 'website', p.website_domain,
                              'place_id', p.place_id, 'city_id', p.city_id,
                              'neighborhood', p.neighborhood, 'category_id', p.category_id)) m
                     join public.organizations o
                       on o.id = m.organization_id and o.deleted_at is null
                    -- Só o que a pessoa já poderia abrir: a dedup não é atalho para
                    -- ver ficha de carteira alheia.
                    where app.org_is_visible(m.organization_id)
                    order by m.organization_id, m.confidence desc, m.reason
                 ) u
                order by u.confidence desc, u.name
                limit 3
             ) d
         ), '[]'::jsonb),
         contada.n
    from pagina p
    cross join contada
    join public.sources s on s.id = p.source_id
    left join public.categories cat on cat.id = p.category_id
    left join public.cities ci on ci.id = p.city_id
    left join public.profiles rev on rev.id = p.reviewed_by
    -- O texto que a FONTE usou. Um candidato pode ter VÁRIOS source_record — a
    -- chave única é (source_id, external_id) —, então um join comum
    -- multiplicaria as linhas da fila. `order by last_seen_at desc limit 1`
    -- entrega o mais recente, que é o que a pessoa acabou de importar.
    left join lateral (
      select sr.category_source
        from public.source_record sr
       where sr.candidate_id = p.id
         and sr.category_source is not null
       order by sr.last_seen_at desc
       limit 1
    ) cs on true
   order by (p.status = 'novo') desc, p.score desc nulls last, p.created_at desc;
end $function$;


comment on function public.radar_fila(text,int,int,text,boolean,int,int) is
  'A fila de revisão (RF-RAD-11), ordenada pela triagem (RF-RAD-12). Devolve pontuacao, faixa (A+..C), o veredito da IA sobre o nome — que é opinião, não decisão — e, desde 25/09/2026, categoria_na_fonte: o texto que a FONTE usou, do source_record mais recente. Sem ele a pessoa adivinhava a categoria entre 19 opções, cartão por cartão. Telefone e e-mail saem mascarados para quem não lê PII da base.';

revoke all on function public.radar_fila(text,int,int,text,boolean,int,int) from public, anon;
grant execute on function public.radar_fila(text,int,int,text,boolean,int,int) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- O histórico da ficha ainda falava de "Radar"
-- ---------------------------------------------------------------------
-- O módulo virou "Revisão" em 25/09/2026 (migração 20260925140000) e a linha
-- que a promoção escreve em `public.activities` não soube.
--
-- Só UMA função viva escreve esta linha: `app.promover_candidato`
-- (20260905000100:399-583, string em :559). As outras duas ocorrências
-- (20260904001401:848 e 20260904001600:1175) são definições mortas, substituídas
-- por aquela.
--
-- CUIDADO, e é por isso que o filtro é estreito: `public.activities` tem o
-- gatilho `activities_apply_outcome`, que é BEFORE INSERT OR UPDATE
-- (20260904000800:261-263). Para linhas `type = 'system'` com `outcome_id` nulo
-- ele só remove `metadata.outcome_pending` e segue — inofensivo, mas medido, e
-- não suposto. `activities_touch_deal` e `zz_cadence_on_activity` são AFTER
-- INSERT e não disparam num update.
do $$
declare n int;
begin
  update public.activities
     set body = replace(body, 'Aprovado na fila do Radar por ', 'Virou parceiro na fila, por ')
   where type = 'system'
     and outcome_id is null
     and metadata ->> 'origin' = 'radar_approve'
     and body like 'Aprovado na fila do Radar por %';
  get diagnostics n = row_count;
  raise notice 'histórico da fila reescrito em % atividade(s)', n;
end $$;

-- E a função que escreve as próximas. Transcrição da definição viva
-- (20260905000100:399-584), com a string nova.
create or replace function app.promover_candidato(
  p_candidate_id   uuid,
  p_stage_id       int  default null,
  p_owner_id       uuid default null,
  p_next_action    text default null,
  p_next_action_at timestamptz default null,
  p_category_id    int  default null,
  p_batch_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c        public.supplier_candidates;
  v_cat      int;
  v_grupo    text;
  v_slug     text;
  v_kind     app.org_kind;
  v_pipeline int;
  v_stage    int := p_stage_id;
  v_org      uuid;
  v_deal     uuid;
  v_tier     text;
  v_fonte    record;
  v_owner    uuid := coalesce(p_owner_id, auth.uid());
  v_quem     text;
  v_sug      jsonb;
  v_motivo   text;
begin
  select * into v_c from public.supplier_candidates where id = p_candidate_id for update;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'candidato_inexistente');
  end if;

  -- Idempotência: promover duas vezes devolve a MESMA organização. É o que
  -- separa "o worker reprocessou a captura" de "a base ganhou uma ficha dupla".
  if v_c.status = 'aprovado' and v_c.organization_id is not null then
    return jsonb_build_object('ok', true, 'status', 'aprovado', 'ja_estava', true,
                              'organization_id', v_c.organization_id,
                              'deal_id', (select d.id from public.deals d
                                           where d.organization_id = v_c.organization_id
                                           order by d.created_at limit 1));
  end if;
  if v_c.status <> 'novo' then
    return jsonb_build_object('ok', false, 'reason', 'ja_revisado', 'status', v_c.status);
  end if;
  -- Suprimido não vira alvo, em nenhum modo (RF-RAD-09, guardrail do CLAUDE.md).
  --
  -- `v_c.do_not_contact` é o CARIMBO DA COLETA: verdadeiro para quem já estava
  -- na lista de supressão no instante em que o candidato foi gravado
  -- (app.supplier_candidates_normalize). Entre a coleta e esta curadoria pode
  -- ter passado uma semana, e nela alguém pode ter respondido "SAIR" — e aí o
  -- carimbo continua falso enquanto a lista de hoje já diz não. É o mesmo
  -- buraco do dreno da Komune, na porta da curadoria: decidido na entrada,
  -- entregue depois. A lista que vale é a de agora.
  if v_c.do_not_contact
     or app.is_suppressed(v_c.phone_e164, v_c.cnpj, v_c.instagram_handle) then
    -- E o carimbo passa a contar a verdade, para a fila do Radar mostrar o
    -- motivo em vez de oferecer o mesmo alvo de novo amanhã.
    if not v_c.do_not_contact then
      update public.supplier_candidates set do_not_contact = true where id = v_c.id;
    end if;
    return jsonb_build_object('ok', false, 'reason', 'candidato_nao_contatar');
  end if;

  v_cat := coalesce(p_category_id, v_c.category_id);
  if v_cat is null then
    return jsonb_build_object('ok', false, 'reason', 'categoria_obrigatoria');
  end if;
  select c.group, c.slug into v_grupo, v_slug
    from public.categories c where c.id = v_cat and c.is_active;
  if v_grupo is null then
    return jsonb_build_object('ok', false, 'reason', 'categoria_invalida');
  end if;
  v_kind := case
              when v_slug = 'cerimonialistas_assessorias' then 'cerimonialista'
              when v_grupo = 'producao' then 'produtor'
              when v_grupo = 'locais'   then 'espaco'
              else 'fornecedor'
            end::app.org_kind;

  -- Bloqueio: exatamente as quatro chaves que são índice único parcial.
  select o.id,
         case when v_c.cnpj is not null and o.cnpj = v_c.cnpj then 'cnpj'
              when v_c.place_id is not null and o.place_id = v_c.place_id then 'place_id'
              when v_c.instagram_handle is not null and o.instagram_handle = v_c.instagram_handle then 'instagram'
              else 'phone' end
    into v_org, v_motivo
    from public.organizations o
   where o.deleted_at is null
     and ((v_c.cnpj is not null and o.cnpj = v_c.cnpj)
       or (v_c.phone_e164 is not null and o.phone_e164 = v_c.phone_e164)
       or (v_c.instagram_handle is not null and o.instagram_handle = v_c.instagram_handle)
       or (v_c.place_id is not null and o.place_id = v_c.place_id))
   limit 1;
  if v_org is not null then
    return jsonb_build_object('ok', false, 'reason', 'ja_existe_na_base',
                              'organization_id', v_org, 'chave', v_motivo);
  end if;

  -- Explicação (as sete chaves do RF-BAS-08), para quem revisa e para o log.
  select coalesce(jsonb_agg(jsonb_build_object('organization_id', m.organization_id,
                                               'confidence', m.confidence, 'reason', m.reason)
                            order by m.confidence desc), '[]'::jsonb)
    into v_sug
    from app.find_org_matches(jsonb_build_object(
           'name', v_c.name, 'cnpj', v_c.cnpj, 'phone_e164', v_c.phone_e164,
           'instagram_handle', v_c.instagram_handle, 'website', v_c.website_domain,
           'place_id', v_c.place_id, 'city_id', v_c.city_id,
           'neighborhood', v_c.neighborhood, 'category_id', v_cat)) m;

  select p.id into v_pipeline from public.pipelines p
   where p.slug = case when v_kind in ('produtor','cerimonialista') then 'produtor' else 'fornecedor' end;
  if v_stage is null then
    select st.id into v_stage from public.stages st
     where st.pipeline_id = v_pipeline and not st.is_lost and not st.is_won
     order by st.position limit 1;
  end if;
  if v_stage is null then
    raise exception 'Funil sem etapas cadastradas: aplique a seed (pipelines/stages)' using errcode = 'P0001';
  end if;

  select s.id, s.kind, s.slug into v_fonte from public.sources s where s.id = v_c.source_id;
  v_tier := coalesce(v_c.tier, case when v_fonte.kind = 'referral' then 'A+' end);
  select pr.full_name into v_quem from public.profiles pr where pr.id = v_owner;

  insert into public.organizations
    (kind, name, legal_name, cnpj, phone_e164, email, instagram_handle, website,
     place_id, city_id, neighborhood, address, rating, reviews_count,
     source_id, source_url, collected_at, collector, owner_id, is_natural_person,
     import_batch_id)
  values
    (v_kind, v_c.name, v_c.legal_name, v_c.cnpj, v_c.phone_e164, v_c.email,
     v_c.instagram_handle, v_c.website, v_c.place_id, v_c.city_id, v_c.neighborhood,
     v_c.address, v_c.rating, v_c.reviews_count,
     v_c.source_id, v_c.source_url, v_c.collected_at,
     coalesce(v_c.collector, 'radar'), v_owner, v_c.is_natural_person,
     coalesce(p_batch_id, v_c.import_batch_id))
  returning id into v_org;

  insert into public.organization_categories (organization_id, category_id, is_primary)
  values (v_org, v_cat, true)
  on conflict do nothing;

  insert into public.deals
    (organization_id, pipeline_id, stage_id, owner_id, source_id, tier,
     next_action, next_action_at, import_batch_id)
  values
    (v_org, v_pipeline, v_stage, v_owner, v_c.source_id, v_tier,
     coalesce(nullif(trim(coalesce(p_next_action, '')), ''), 'Primeiro contato'),
     coalesce(p_next_action_at,
              ((app.next_business_day((now() at time zone 'America/Fortaleza')::date) + time '09:00')
               at time zone 'America/Fortaleza')),
     coalesce(p_batch_id, v_c.import_batch_id))
  returning id into v_deal;

  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('system', v_org, v_deal, v_owner, 'system',
          -- MUDOU em 25/09/2026: o módulo chama-se Revisão, e a linha do
          -- histórico é lida por quem abre a ficha, não por quem escreveu o código.
          'Virou parceiro na fila, por ' || coalesce(v_quem, 'revisor'),
          jsonb_build_object('origin', 'radar_approve', 'candidate_id', v_c.id,
                             'source_slug', v_fonte.slug, 'batch_id', coalesce(p_batch_id, v_c.import_batch_id)));

  update public.supplier_candidates
     set status = 'aprovado', organization_id = v_org, category_id = v_cat, kind = v_kind,
         reviewed_by = coalesce(auth.uid(), v_owner), reviewed_at = now(),
         import_batch_id = coalesce(import_batch_id, p_batch_id)
   where id = p_candidate_id;

  -- A proveniência acompanha a ficha: sem isto, o titular pergunta "de onde
  -- veio o meu número?" e a resposta morre no candidato, que a retenção apaga.
  insert into public.field_provenance
    (record_type, record_id, field, source_id, source_url, batch_id, collected_at,
     collector, tool, action, reason, legal_basis, lia_version)
  select 'organization', v_org, fp.field, fp.source_id, fp.source_url, fp.batch_id,
         fp.collected_at, fp.collector, fp.tool, fp.action, fp.reason, fp.legal_basis, fp.lia_version
    from public.field_provenance fp
   where fp.record_type = 'supplier_candidate' and fp.record_id = v_c.id;

  return jsonb_build_object('ok', true, 'status', 'aprovado',
                            'organization_id', v_org, 'deal_id', v_deal,
                            'sugestoes', v_sug);
end $$;
comment on function app.promover_candidato(uuid,int,uuid,text,timestamptz,int,uuid) is
  'Caminho único de promoção candidato → organização + negócio. Dedup do RF-BAS-08 refeita DENTRO da transação. Idempotente. Reconfere a lista de supressão NO INSTANTE DA CURADORIA, não no carimbo da coleta: quem pediu para sair depois de ser coletado não vira ficha.';

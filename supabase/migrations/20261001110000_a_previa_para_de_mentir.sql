-- =====================================================================
-- A prévia para de mentir: domínio, host de bio e dois lugares do Google
--
-- POR QUÊ (desenho de 25/09/2026, §1(d) "Achado 1" e "Achado 2",
-- docs/superpowers/specs/2026-09-25-importar-sem-fila-design.md, item 8 da
-- tabela de esforço). Três defeitos medidos nas 40 linhas de `listas/`:
--
--  1. `public.importacao_previa` NÃO passa o site para `app.find_org_matches`,
--     enquanto `app.resolver_source_record` passa. As duas linhas "Show
--     Fotografias" têm cid, telefone e endereço diferentes — o que as junta é
--     o site (`keepo.io/showfotografias`), e domínio igual vale 0,90. A prévia
--     prometia "entra" e a gravação respondia "duplicata": exatamente o
--     defeito que uma prévia existe para não ter.
--
--  2. `keepo.io` não está em `app.is_shared_web_host`, que já lista
--     `linktr.ee`, `linkr.bio` e `beacons.ai`. Keepo é link na bio: o domínio
--     não identifica empresa nenhuma, e usá-lo como chave funde negócios sem
--     relação. Entram também `bio.link` e `campsite.bio`, da mesma família.
--     Os dois defeitos andam juntos: consertar (1) sem (2) faria a prévia
--     passar a mentir do outro lado — prometer duplicata onde há duas empresas.
--
--  3. `app.resolver_source_record`, bloco (3), casa por celular e pendurou o
--     `source_record` de "Doce Sabor Buffet" no candidato de "Luz da Festa
--     Kids": mesmo (84) 99988-0963, `place_id` diferentes. A trava do bloco (4)
--     não salvou porque exige mais de 3 candidatos no mesmo número; aqui são
--     dois. Dois lugares do Google são dois negócios: o `place_id` divergente
--     recusa o laço por telefone, o candidato nasce separado e a marca
--     `telefone_compartilhado` diz por quê a quem revisa.
--
-- O que NÃO muda: nenhuma linha deixa de passar por
-- `raw_capture → source_record → supplier_candidate` (ADR-08), a proveniência
-- campo a campo continua gravada e a supressão continua reconferida.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Os hosts de "link na bio" não são chave de dedup
-- ---------------------------------------------------------------------
create or replace function app.is_shared_web_host(d text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(trim(d)), '') = any (array[
    'instagram.com','facebook.com','fb.com','m.facebook.com','linktr.ee','linkr.bio','beacons.ai',
    -- MUDOU em 25/09/2026: a mesma família de "link na bio". `keepo.io` veio
    -- das duas linhas "Show Fotografias" do lote de fotógrafos.
    'keepo.io','bio.link','campsite.bio',
    'wa.me','api.whatsapp.com','whatsapp.com','bit.ly','tinyurl.com','linkedin.com','youtube.com',
    'youtu.be','tiktok.com','x.com','twitter.com','sites.google.com','google.com','business.site',
    'wixsite.com','blogspot.com','wordpress.com','gmail.com','hotmail.com','outlook.com','yahoo.com'])
$$;
comment on function app.is_shared_web_host(text) is 'true para hosts compartilhados (redes sociais, encurtadores, construtores de site, link na bio) que não servem como chave de dedup por domínio.';


-- ---------------------------------------------------------------------
-- 2. Dois lugares do Google são dois negócios
-- ---------------------------------------------------------------------
create or replace function app.resolver_source_record(p_source_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r    public.source_record;
  v_cand public.supplier_candidates;
  v_id   uuid;
  v_n    int;
  v_dup  jsonb;
  v_novo boolean := false;
begin
  select * into v_r from public.source_record where id = p_source_record_id for update;
  if v_r.id is null then
    return jsonb_build_object('ok', false, 'reason', 'registro_inexistente');
  end if;

  -- (1) Já resolvido: completa só o que está vazio. Reprocessar a mesma captura
  -- duas vezes não pode criar dois candidatos — e muito menos duas organizações.
  if v_r.candidate_id is not null then
    select * into v_cand from public.supplier_candidates where id = v_r.candidate_id;
  end if;

  -- (2) O mesmo id externo na mesma fonte é a identidade mais forte que existe,
  -- e é índice único em supplier_candidates: sem esta busca o INSERT lá embaixo
  -- estouraria 23505 no reprocessamento de uma captura já resolvida.
  if v_cand.id is null and v_r.external_id is not null then
    select c.* into v_cand
      from public.supplier_candidates c
     where c.source_id = v_r.source_id and c.external_id = v_r.external_id
     limit 1;
  end if;

  -- (3) Chave determinística já esperando revisão.
  if v_cand.id is null then
    select c.* into v_cand
      from public.supplier_candidates c
     where c.status in ('novo','aprovado','mesclado')
       and ((v_r.cnpj             is not null and c.cnpj = v_r.cnpj)
         or (v_r.place_id         is not null and c.place_id = v_r.place_id)
         or (v_r.instagram_handle is not null and c.instagram_handle = v_r.instagram_handle)
         or (v_r.phone_e164       is not null and length(v_r.phone_e164) = 14
             and c.phone_e164 = v_r.phone_e164
             -- MUDOU em 25/09/2026: dois `place_id` do Google que DIFEREM são
             -- dois negócios, por mais que o telefone seja o mesmo. Sem esta
             -- linha, "Doce Sabor Buffet" e "Luz da Festa Kids" viraram um
             -- candidato só, e o `source_record` de um ficou pendurado no
             -- outro. A trava do bloco (4) não alcança o caso: são dois
             -- candidatos no número, e ela só age acima de tres.
             and not (v_r.place_id is not null and c.place_id is not null
                      and c.place_id is distinct from v_r.place_id)))
     order by (c.status = 'novo') desc, c.created_at
     limit 1;

    -- (3b) A trava acima é silenciosa por construção — ela apenas deixa de
    -- casar. Quem revisa precisa saber que havia um laço possível e por que
    -- ele foi recusado, senão vê dois candidatos parecidos e nenhuma pista.
    -- A marca vai no `source_record` E em `v_r.flags`, que é o que o INSERT do
    -- bloco (5) copia para o candidato que nasce agora.
    if v_cand.id is null and v_r.place_id is not null
       and v_r.phone_e164 is not null and length(v_r.phone_e164) = 14
       and exists (select 1
                     from public.supplier_candidates c
                    where c.status in ('novo','aprovado','mesclado')
                      and c.phone_e164 = v_r.phone_e164
                      and c.place_id is not null
                      and c.place_id is distinct from v_r.place_id) then
      update public.source_record
         set flags = (select coalesce(array_agg(distinct f order by f), '{}')
                        from unnest(flags || array['telefone_compartilhado']) f)
       where id = v_r.id;
      v_r.flags := (select coalesce(array_agg(distinct f order by f), '{}')
                      from unnest(v_r.flags || array['telefone_compartilhado']) f);
    end if;

    -- (4) Número compartilhado (contador, agência, produtora que atende vários):
    -- acima de 3 candidatos no mesmo celular a fusão para de ser dedup e vira
    -- confusão de empresas. Não funde; marca e deixa para o humano.
    if v_cand.id is not null and v_r.phone_e164 is not null
       and v_cand.cnpj is null and v_cand.place_id is null
       and (v_r.cnpj is null or v_cand.cnpj is distinct from v_r.cnpj)
       and (v_r.instagram_handle is null or v_cand.instagram_handle is distinct from v_r.instagram_handle) then
      select count(*) into v_n
        from public.supplier_candidates c
       where c.phone_e164 = v_r.phone_e164;
      if v_n > 3 then
        v_cand := null;
        update public.source_record
           set flags = (select coalesce(array_agg(distinct f order by f), '{}')
                          from unnest(flags || array['telefone_compartilhado']) f)
         where id = v_r.id;
        -- MUDOU em 25/09/2026: a marca ia só para o `source_record`, e o
        -- candidato que nascia logo abaixo saía limpo — a fila mostrava dois
        -- nomes iguais sem dizer que o número era compartilhado.
        v_r.flags := (select coalesce(array_agg(distinct f order by f), '{}')
                        from unnest(v_r.flags || array['telefone_compartilhado']) f);
      end if;
    end if;
  end if;

  if v_cand.id is null then
    -- (5) Candidato novo, pela MESMA esteira do formulário manual.
    insert into public.supplier_candidates
      (source_id, source_url, external_id, collected_at, collector, payload,
       name, legal_name, cnpj, phone_e164, email, instagram_handle, website,
       place_id, city_id, neighborhood, address, category_id, kind,
       rating, reviews_count, is_natural_person, import_batch_id, flags)
    values
      (v_r.source_id, v_r.source_url, v_r.external_id, v_r.first_seen_at,
       coalesce((select rc.collector from public.raw_capture rc where rc.id = v_r.raw_capture_id), 'coletor'),
       jsonb_build_object('origin', 'esteira', 'source_record_id', v_r.id,
                          'raw_capture_id', v_r.raw_capture_id, 'at', now()),
       v_r.name, v_r.legal_name, v_r.cnpj, v_r.phone_e164, v_r.email, v_r.instagram_handle,
       v_r.website, v_r.place_id, v_r.city_id, v_r.neighborhood, v_r.address,
       v_r.category_id, v_r.kind, v_r.rating, v_r.reviews_count, v_r.is_natural_person,
       v_r.batch_id, v_r.flags)
    returning id into v_id;
    v_novo := true;
  else
    -- (6) Vinculado: completa só campo vazio. O que já foi confirmado vale mais
    -- que o que uma fonte pública diz (RF-RAD-08).
    v_id := v_cand.id;
    update public.supplier_candidates c
       set legal_name       = coalesce(c.legal_name, v_r.legal_name),
           cnpj             = coalesce(c.cnpj, v_r.cnpj),
           phone_e164       = coalesce(c.phone_e164, v_r.phone_e164),
           email            = coalesce(c.email, v_r.email),
           instagram_handle = coalesce(c.instagram_handle, v_r.instagram_handle),
           website          = coalesce(c.website, v_r.website),
           place_id         = coalesce(c.place_id, v_r.place_id),
           city_id          = coalesce(c.city_id, v_r.city_id),
           neighborhood     = coalesce(c.neighborhood, v_r.neighborhood),
           address          = coalesce(c.address, v_r.address),
           category_id      = coalesce(c.category_id, v_r.category_id),
           rating           = coalesce(c.rating, v_r.rating),
           reviews_count    = coalesce(c.reviews_count, v_r.reviews_count),
           import_batch_id  = coalesce(c.import_batch_id, v_r.batch_id)
     where c.id = v_id;
  end if;

  -- Proveniência campo a campo: é isto que responde "de onde vocês tiraram o
  -- meu número?" com a URL exata, e não com "fontes públicas" (caso KASPR).
  perform app.registrar_proveniencia(
            'supplier_candidate', v_id, f.campo, 'gravado',
            v_r.source_id, v_r.source_url, v_r.batch_id,
            (select rc.collector from public.raw_capture rc where rc.id = v_r.raw_capture_id),
            (select s.slug from public.sources s where s.id = v_r.source_id),
            null, null, v_r.first_seen_at)
    from (values ('name', v_r.name), ('legal_name', v_r.legal_name), ('cnpj', v_r.cnpj),
                 ('phone_e164', v_r.phone_e164), ('email', v_r.email::text),
                 ('instagram_handle', v_r.instagram_handle), ('website', v_r.website),
                 ('place_id', v_r.place_id), ('address', v_r.address),
                 ('neighborhood', v_r.neighborhood)) as f(campo, valor)
   where f.valor is not null;

  -- Duplicata contra a base, ANTES de a pessoa abrir a fila: quem revisa já
  -- chega sabendo que essa ficha existe.
  select coalesce(jsonb_agg(jsonb_build_object('organization_id', m.organization_id,
                                               'confidence', m.confidence, 'reason', m.reason)
                            order by m.confidence desc), '[]'::jsonb)
    into v_dup
    from app.find_org_matches(jsonb_build_object(
           'name', v_r.name, 'cnpj', v_r.cnpj, 'phone_e164', v_r.phone_e164,
           'instagram_handle', v_r.instagram_handle, 'website', v_r.website_domain,
           'place_id', v_r.place_id, 'city_id', v_r.city_id,
           'neighborhood', v_r.neighborhood, 'category_id', v_r.category_id)) m;

  if jsonb_array_length(v_dup) > 0 then
    update public.supplier_candidates
       set flags = (select coalesce(array_agg(distinct f order by f), '{}')
                      from unnest(flags || array['ja_existe_na_base']) f),
           payload = payload || jsonb_build_object('duplicatas', v_dup)
     where id = v_id;
  end if;

  update public.source_record
     set candidate_id = v_id, last_seen_at = now()
   where id = v_r.id;

  return jsonb_build_object('ok', true, 'candidate_id', v_id, 'criado', v_novo,
                            'duplicatas', v_dup);
end $$;

comment on function app.resolver_source_record(uuid) is
  'Resolve um source_record em UM supplier_candidate (ADR-08): vincula por chave determinística (CNPJ, place_id, @, celular), nunca por nome; nunca funde por telefone dois place_id do Google que diferem; recusa fundir número compartilhado por mais de 3 candidatos; grava proveniência campo a campo e marca a duplicata contra a base.';


-- ---------------------------------------------------------------------
-- 3. A prévia sonda o domínio, como a gravação já sonda
-- ---------------------------------------------------------------------
create or replace function public.importacao_previa(p_linhas jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_linha   jsonb;
  v_n       jsonb;
  v_saida   jsonb := '[]'::jsonb;
  v_vistos  text[] := '{}'::text[];
  v_chave   text;
  v_dup     record;
  v_ja      record;
  v_decisao text;
  v_motivo  text;
  v_dupjson jsonb;
  v_conta   jsonb := jsonb_build_object('entra', 0, 'duplicata', 0, 'revisao', 0,
                                        'nao_contatar', 0, 'repetida', 0, 'erro', 0);
begin
  if not app.can_write() then
    raise exception 'Papel % não importa planilha', app.role() using errcode = '42501';
  end if;
  if jsonb_typeof(p_linhas) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'linhas_invalidas');
  end if;
  if jsonb_array_length(p_linhas) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'lote_grande_demais');
  end if;

  for v_linha in select value from jsonb_array_elements(p_linhas) loop
    v_n := app.importacao_normalizar(v_linha);
    v_dupjson := null;
    v_motivo := null;
    v_dup := null;
    v_ja := null;

    if v_n ->> 'erro' is not null then
      v_decisao := 'erro';
      v_motivo  := v_n ->> 'erro';
    elsif coalesce((v_n ->> 'optout')::boolean, false) then
      v_decisao := 'nao_contatar';
      v_motivo  := 'pediu_para_parar';
    else
      v_chave := coalesce(v_n ->> 'source_id', '0') || '|' || coalesce(v_n ->> 'external_id', '');
      if v_chave = any (v_vistos) then
        v_decisao := 'repetida';
        v_motivo  := 'repetida_no_arquivo';
      else
        v_vistos := v_vistos || v_chave;

        -- (1) Esta linha já entrou numa importação anterior? A esteira reconhece
        -- pelo par (fonte, id externo), que é o mesmo par da gravação. É o que
        -- faz a SEGUNDA prévia do mesmo arquivo dizer "já importado" em vez de
        -- prometer 68 fichas que não vão nascer.
        select o.id, o.name into v_ja
          from public.source_record sr
          join public.supplier_candidates c on c.id = sr.candidate_id
          join public.organizations o on o.id = c.organization_id and o.deleted_at is null
         where sr.source_id = coalesce((v_n ->> 'source_id')::int, -1)
           and sr.external_id = coalesce(v_n ->> 'external_id', '')
           and c.status = 'aprovado'
         limit 1;

        -- (2) UMA linha por ficha, a de maior confiança: `app.find_org_matches`
        -- devolve uma por REGRA que casou, e a mesma empresa três vezes na tela
        -- não é "três suspeitas", é ruído (mesmo critério da fila do Radar).
        select u.organization_id, u.nome, u.confidence, u.reason, u.visivel
          into v_dup
          from (
            select distinct on (m.organization_id)
                   m.organization_id,
                   case when app.org_is_visible(m.organization_id) then o.name end as nome,
                   app.org_is_visible(m.organization_id) as visivel,
                   m.confidence, m.reason
              from app.find_org_matches(jsonb_build_object(
                     'name', v_n ->> 'nome', 'cnpj', v_n ->> 'cnpj',
                     'phone_e164', v_n ->> 'telefone',
                     'instagram_handle', v_n ->> 'instagram',
                     'place_id', v_n ->> 'place_id',
                     -- MUDOU em 25/09/2026: o site, que faltava. A gravação
                     -- sempre o passou (`app.resolver_source_record`) e a
                     -- prévia não — daí ela prometer "entra" para uma linha
                     -- que o domínio já condenava a duplicata.
                     -- `find_org_matches` aplica `app.website_domain` e ignora
                     -- host compartilhado, então mandar a URL crua é correto.
                     'website', v_n ->> 'site',
                     'city_id', v_n ->> 'cidade_id',
                     'neighborhood', v_n ->> 'bairro',
                     'category_id', v_n ->> 'categoria_id')) m
              join public.organizations o
                on o.id = m.organization_id and o.deleted_at is null
             order by m.organization_id, m.confidence desc, m.reason
          ) u
         order by u.confidence desc, u.nome
         limit 1;

        -- (3) A sonda das QUATRO chaves que são índice único, igual à de
        -- `app.promover_candidato`. Sem ela a prévia mentiria num caso concreto:
        -- um telefone FIXO repetido bloqueia a promoção, mas `find_org_matches`
        -- só casa telefone com celular (o fixo exige bairro igual). A prévia
        -- dizia "entra" e a gravação recusava — que é o defeito que uma prévia
        -- existe para não ter. A ordem do `case` e os nomes de chave são os de
        -- `app.promover_candidato`: se as duas listas divergirem, a prévia volta
        -- a mentir.
        if v_dup.organization_id is null then
          select o.id                     as organization_id,
                 case when app.org_is_visible(o.id) then o.name end as nome,
                 app.org_is_visible(o.id) as visivel,
                 0.95::numeric            as confidence,
                 (case when v_n ->> 'cnpj' is not null and o.cnpj = v_n ->> 'cnpj' then 'cnpj'
                       when v_n ->> 'place_id' is not null
                        and o.place_id = v_n ->> 'place_id' then 'place_id'   -- NOVO
                       when v_n ->> 'instagram' is not null
                        and o.instagram_handle = v_n ->> 'instagram' then 'instagram'
                       else 'phone' end)  as reason
            into v_dup
            from public.organizations o
           where o.deleted_at is null
             and ((v_n ->> 'cnpj' is not null and o.cnpj = v_n ->> 'cnpj')
               or (v_n ->> 'telefone' is not null and o.phone_e164 = v_n ->> 'telefone')
               or (v_n ->> 'instagram' is not null and o.instagram_handle = v_n ->> 'instagram')
               or (v_n ->> 'place_id' is not null and o.place_id = v_n ->> 'place_id'))  -- NOVO
           limit 1;
        end if;

        if v_dup.organization_id is not null then
          v_dupjson := jsonb_build_object(
            'organization_id', v_dup.organization_id,
            'nome', coalesce(v_dup.nome, 'Ficha de outra carteira'),
            'visivel', v_dup.visivel,
            'confianca', v_dup.confidence,
            'chave', v_dup.reason);
        end if;

        -- A ordem é a MESMA de `public.importacao_gravar`. Se estas duas listas
        -- de `if` divergirem, a prévia vira promessa quebrada — é por isso que
        -- elas estão comentadas uma em função da outra.
        if v_ja.id is not null then
          v_decisao := 'repetida';
          v_motivo  := 'ja_importado';
          v_dupjson := jsonb_build_object(
            'organization_id', v_ja.id,
            'nome', case when app.org_is_visible(v_ja.id) then v_ja.name
                         else 'Ficha de outra carteira' end,
            'visivel', app.org_is_visible(v_ja.id),
            'confianca', 1.0,
            'chave', 'lote_anterior');
        elsif v_dup.organization_id is not null then
          v_decisao := 'duplicata';
          v_motivo  := 'ja_existe_na_base';
        elsif v_n ->> 'categoria_id' is null then
          v_decisao := 'revisao';
          v_motivo  := 'categoria_desconhecida';
        elsif v_n ->> 'source_id' is null then
          v_decisao := 'revisao';
          v_motivo  := 'origem_desconhecida';
        else
          v_decisao := 'entra';
        end if;
      end if;
    end if;

    v_conta := jsonb_set(v_conta, array[v_decisao],
                         to_jsonb(coalesce((v_conta ->> v_decisao)::int, 0) + 1));
    v_saida := v_saida || jsonb_build_array(jsonb_build_object(
      'linha',            (v_n ->> 'linha')::int,
      'nome',             v_n ->> 'nome',
      'decisao',          v_decisao,
      'motivo',           v_motivo,
      'duplicata',        v_dupjson,
      'categoria',        v_n ->> 'categoria_nome',
      'cidade',           v_n ->> 'cidade_nome',
      'origem',           v_n ->> 'source_nome',
      'etapa',            v_n ->> 'etapa_nome',
      'responsavel',      v_n ->> 'responsavel_nome',
      'telefone',         v_n ->> 'telefone_visivel',
      'avisos',           v_n -> 'avisos'));
  end loop;

  return jsonb_build_object('ok', true, 'contagem', v_conta, 'linhas', v_saida);
end $$;
comment on function public.importacao_previa(jsonb) is
  'Prévia da importação de planilha (RF-BAS-07): linha a linha, o que vai acontecer — entra, é duplicata de QUAL ficha (com o nome), vai para revisão por qual motivo, ou não entra por ter pedido para parar. Sonda as quatro chaves de índice único, place_id incluído, na mesma ordem de app.promover_candidato, e desde 25/09/2026 passa o SITE a app.find_org_matches, como a gravação já passava. Não escreve nada. Máximo de 500 linhas por chamada.';
revoke all on function public.importacao_previa(jsonb) from public, anon;
grant execute on function public.importacao_previa(jsonb) to authenticated, service_role;

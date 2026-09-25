-- =====================================================================
-- A pergunta passa a ser POR NOME DE CATEGORIA, e a resposta fica gravada
--
-- POR QUÊ (desenho de 25/09/2026, §1(c) e §2, item 6 da tabela de esforço;
-- docs/superpowers/specs/2026-09-25-importar-sem-fila-design.md):
--
-- Hoje o CRM pede uma decisão POR LINHA. Nas 40 linhas de `listas/` isso deu
-- 36 cartões de fila, um a um, sobre 13 nomes distintos de categoria. Decidir
-- por NOME são 13 respostas, uma vez — e na lista seguinte, zero. É essa troca
-- de O(linhas) por O(nomes novos) que este arquivo torna possível no banco.
--
-- Três peças:
--
--  1. `app.categoria_por_radical` — a sugestão que a queda difusa nunca soube
--     dar. Medido: com o limiar de 0,55 de `app.importacao_categoria`, NENHUM
--     dos 16 nomes do Google chega lá (o melhor, "Buffet infantil", dá 0,516),
--     e a resposta certa de "Buffet de casamento" pontua 0,243 — ABAIXO da
--     errada, porque o trigrama premia "infantil", que aparece duas vezes no
--     nome comprido da categoria, e ignora "casamento", que é a única palavra
--     que decide. O que funciona é casar PALAVRA, não frase: o radical de 6
--     letras. E empate vale como "não sei", nunca como palpite.
--
--  2. `public.importacao_previa` passa a devolver `categoria_origem` por linha
--     e `categorias_novas` agrupado — o que a tela de resolver precisa para
--     perguntar uma vez por nome, com as empresas à vista.
--
--  3. `public.importacao_mapear_categorias` — a escrita no de-para, aberta a
--     `app.can_write()` com auditoria (decisão 1 do Rafael, 25/09). Hoje a
--     tabela só aceita escrita de `app.is_manager()` e a Heloísa é `sdr`: ela
--     importa, a fila enche, e ela não pode ensinar. A RLS da tabela NÃO muda;
--     quem abre é esta função, `security definer`, que registra em `audit_log`
--     quem ensinou o quê.
--
-- O que NÃO muda: a categoria continua OBRIGATÓRIA para virar parceiro.
-- `app.promover_candidato` deriva o `org_kind` do GRUPO da categoria, e é isso
-- que decide em que funil o negócio nasce. O que muda é quem responde, e
-- quantas vezes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A sugestão por radical de palavra
-- ---------------------------------------------------------------------
-- Seis letras, e não a palavra inteira, porque é o que faz "fotográfico",
-- "fotografia" e "fotográficas" caírem no mesmo `fotogr`. Palavra com menos de
-- seis letras não entra: "de", "para", "e", "com" casariam tudo com tudo.
--
-- Compara contra o NOME e contra o SLUG da categoria. O slug é o que salva
-- "local para eventos": o nome é "Locais: salões, chácaras, hotéis,
-- restaurantes, praia" e o slug é `locais_saloes_chacaras_hoteis`.
--
-- EMPATE É NULO, e isso é a regra, não um detalhe: "buffet de casamento" casa
-- `buffet` com "Buffet adulto/corporativo" E com "Buffet infantil / casa de
-- festas infantil". Escolher uma das duas ali seria pôr um infantil no funil
-- de adulto — e alguém abre conversa com o pitch errado.
create or replace function app.categoria_por_radical(p_nome text)
returns int
language sql
stable
set search_path = ''
as $$
  with palavras as (
    select distinct left(w, 6) as r
      from unnest(string_to_array(app.chave_catalogo(p_nome), ' ')) as w
     where length(w) >= 6
  ),
  cat as (
    select c.id,
           (select array_agg(distinct left(w, 6))
              from unnest(string_to_array(
                     coalesce(app.chave_catalogo(c.name), '') || ' ' ||
                     coalesce(app.chave_catalogo(replace(c.slug, '_', ' ')), ''), ' ')) as w
             where length(w) >= 6) as radicais
      from public.categories c
     where c.is_active
  ),
  pontos as (
    select cat.id, count(*)::int as n
      from cat join palavras p on p.r = any (cat.radicais)
     group by cat.id
  )
  select case
           when (select count(*) from pontos
                  where n = (select max(n) from pontos)) = 1
             then (select id from pontos order by n desc limit 1)
         end
$$;
comment on function app.categoria_por_radical(text) is
  'Sugestão de categoria do CRM para um nome de categoria da fonte, por radical de 6 letras contra o nome E o slug do catálogo. Empate devolve NULO — "não sei" é resposta, palpite não. Serve à tela de resolver categorias; NUNCA vem pré-marcada e nunca cria ficha sozinha (RF-RAD-11).';
revoke all on function app.categoria_por_radical(text) from public, anon;
grant execute on function app.categoria_por_radical(text) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 2. Ensinar o de-para: `app.can_write()` com auditoria
-- ---------------------------------------------------------------------
-- Decisão 1 do Rafael (25/09/2026): abrir para quem escreve na base, com
-- registro de quem ensinou o quê. É reversível (a linha pode ser apagada por
-- gestor), fica gravado, e sem isso metade da equipe não sai do lugar.
--
-- A chave é gravada por `app.chave_catalogo` sempre — é o que o CHECK da
-- 20261001090000 exige, e é o que faz a PK recusar a segunda grafia sozinha.
--
-- `on conflict do update`: ensinar de novo o mesmo nome com outro destino é
-- CORREÇÃO, não erro. O `audit_log` guarda o que havia antes.
create or replace function public.importacao_mapear_categorias(
  p_source_id int,
  p_pares     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_par   jsonb;
  v_nome  text;
  v_chave text;
  v_cat   int;
  v_antes int;
  v_n     int := 0;
  v_saida jsonb := '[]'::jsonb;
begin
  if v_uid is null or not app.can_write() then
    raise exception 'Papel % não ensina categoria ao CRM', app.role() using errcode = '42501';
  end if;
  if jsonb_typeof(p_pares) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'pares_invalidos');
  end if;
  -- Teto pelo mesmo motivo do teto da prévia: esta função roda dentro do clique
  -- de uma pessoa, e uma lista de 500 nomes de categoria não é uma lista, é um
  -- acidente.
  if jsonb_array_length(p_pares) > 100 then
    return jsonb_build_object('ok', false, 'reason', 'lote_grande_demais');
  end if;
  if not exists (select 1 from public.sources s where s.id = p_source_id) then
    return jsonb_build_object('ok', false, 'reason', 'fonte_inexistente');
  end if;

  for v_par in select value from jsonb_array_elements(p_pares) loop
    v_nome  := nullif(trim(coalesce(v_par ->> 'nome_na_fonte', '')), '');
    v_chave := app.chave_catalogo(v_nome);
    v_cat   := nullif(v_par ->> 'categoria_id', '')::int;

    -- Sem nome não há chave; sem categoria não há regra. Os dois casos são
    -- "não sei" vindo da tela, e "não sei" NÃO escreve: a linha vai para a
    -- fila, com o nome da fonte no cartão, que é o que a tarefa 4 pôs lá.
    if v_chave is null or v_cat is null then
      continue;
    end if;
    if not exists (select 1 from public.categories c where c.id = v_cat and c.is_active) then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object(
        'nome_na_fonte', v_nome, 'ok', false, 'reason', 'categoria_inexistente'));
      continue;
    end if;

    select m.category_id into v_antes
      from public.source_category_map m
     where m.source_id = p_source_id and m.category_source = v_chave;

    insert into public.source_category_map (source_id, category_source, category_id)
    values (p_source_id, v_chave, v_cat)
        on conflict (source_id, category_source) do update set category_id = excluded.category_id;

    -- Curadoria é decisão auditável (CLAUDE.md, guardrails): fica quem ensinou,
    -- o que havia antes e o que passou a valer.
    insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
    values (v_uid, app.role()::text, 'ENSINAR_CATEGORIA', 'source_category_map',
            p_source_id || '|' || v_chave,
            case when v_antes is not null
                 then jsonb_build_object('category_id', v_antes) end,
            jsonb_build_object('source_id', p_source_id, 'category_source', v_chave,
                               'category_id', v_cat, 'nome_na_fonte', v_nome));

    v_n := v_n + 1;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object(
      'nome_na_fonte', v_nome, 'chave', v_chave, 'categoria_id', v_cat,
      'ok', true, 'corrigiu', v_antes is not null and v_antes is distinct from v_cat));
  end loop;

  return jsonb_build_object('ok', true, 'gravadas', v_n, 'pares', v_saida);
end $$;
comment on function public.importacao_mapear_categorias(int, jsonb) is
  'Ensina ao CRM o que um nome de categoria da fonte quer dizer (RF-RAD-06). Aberta a app.can_write() com registro em audit_log de quem ensinou o quê — a RLS da tabela continua exigindo gestor para escrita direta. Par sem categoria é "não sei" e não escreve nada: a linha vai para a fila. Máximo de 100 pares por chamada.';
revoke all on function public.importacao_mapear_categorias(int, jsonb) from public, anon;
grant execute on function public.importacao_mapear_categorias(int, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3. A prévia devolve os nomes de categoria novos, agrupados
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
  -- NOVO em 25/09/2026: os nomes de categoria que o CRM ainda não conhece,
  -- agrupados. É o que troca 36 cartões de fila por 13 respostas.
  v_novas   jsonb := '[]'::jsonb;
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
      -- NOVO: o texto CRU que a fonte usou. Sem ele a tela não tem o que
      -- agrupar, e o recibo do placar agrupava tudo em nulo.
      'categoria_origem', v_n ->> 'categoria_origem',
      'cidade',           v_n ->> 'cidade_nome',
      'origem',           v_n ->> 'source_nome',
      'etapa',            v_n ->> 'etapa_nome',
      'responsavel',      v_n ->> 'responsavel_nome',
      'telefone',         v_n ->> 'telefone_visivel',
      'avisos',           v_n -> 'avisos'));
  end loop;

  -- ------------------------------------------------------------------
  -- Os nomes de categoria novos, agrupados: uma pergunta por NOME, e não
  -- uma por linha.
  --
  -- `exemplos` não é enfeite. "Loja de Presentes" é a PICMIMOS, que revela
  -- foto, e "Companhia de produção de filmes" é o Fabio Carneiro, fotógrafo:
  -- sem ver as empresas, a pessoa descarta lead bom pelo rótulo do Google.
  --
  -- Linha que caiu na fila SEM nome de categoria nenhum (coluna vazia) não
  -- entra aqui: não há o que ensinar, e inventar um grupo "(sem categoria)"
  -- seria prometer uma resposta que não resolve nada.
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome_na_fonte', g.nome,
           'linhas',        g.n,
           'exemplos',      to_jsonb(g.exemplos),
           'sugestao_id',   app.categoria_por_radical(g.nome),
           'sugestao_nome', (select c.name from public.categories c
                              where c.id = app.categoria_por_radical(g.nome))
         ) order by g.n desc, g.nome), '[]'::jsonb)
    into v_novas
    from (
      select l ->> 'categoria_origem'                                   as nome,
             count(*)::int                                              as n,
             (array_agg(l ->> 'nome' order by (l ->> 'linha')::int))[1:3] as exemplos
        from jsonb_array_elements(v_saida) l
       where l ->> 'motivo' = 'categoria_desconhecida'
         and nullif(trim(coalesce(l ->> 'categoria_origem', '')), '') is not null
       group by 1
    ) g;

  return jsonb_build_object('ok', true, 'contagem', v_conta, 'linhas', v_saida,
                            'categorias_novas', v_novas);
end $$;
comment on function public.importacao_previa(jsonb) is
  'Prévia da importação de planilha (RF-BAS-07): linha a linha, o que vai acontecer — entra, é duplicata de QUAL ficha (com o nome), vai para revisão por qual motivo, ou não entra por ter pedido para parar. Sonda as quatro chaves de índice único, place_id incluído, na mesma ordem de app.promover_candidato, e passa o SITE a app.find_org_matches, como a gravação já passava. Desde 25/09/2026 devolve também categoria_origem por linha e categorias_novas agrupado (nome da fonte, quantas linhas, até três empresas de exemplo e a sugestão por radical), que é o que a tela de resolver pergunta UMA vez por nome. Não escreve nada. Máximo de 500 linhas por chamada.';
revoke all on function public.importacao_previa(jsonb) from public, anon;
grant execute on function public.importacao_previa(jsonb) to authenticated, service_role;

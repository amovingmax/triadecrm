-- =====================================================================
-- TRIADE — v0.1 — D2 — RF-BAS-07: importação de planilha
--
-- A planilha-ponte (`docs/planilha-ponte/`) é o instrumento de transição do
-- Dia 0: a equipe registra nela todo contato feito entre 04 e 09/09 e, no D2,
-- a planilha entra no CRM. Esta migração dá as três bocas que a tela precisa —
-- e NENHUMA delas é um caminho novo de escrita.
--
-- O que esta migração ENTREGA
--   1. Os resolvedores de catálogo (`app.importacao_*`): o texto que uma pessoa
--      digitou na planilha ("Buffet adulto / corporativo", "Heloísa", "Base CNPJ",
--      "Opt-out (não contatar)") vira id do CRM, com casamento exato, por slug e,
--      só então, por trigrama — e a linha SEMPRE conta na prévia qual foi a
--      escolha e se ela foi aproximada. Nada é adivinhado em silêncio.
--   2. `app.importacao_normalizar(jsonb)`: uma linha da planilha vira o objeto
--      canônico da esteira (telefone em E.164, @ normalizado, ids resolvidos,
--      `external_id` determinístico e `payload` já dentro da whitelist do R06).
--      É função STABLE: não escreve nada, e por isso serve à prévia e à gravação
--      sem duas implementações que possam divergir.
--   3. `public.importacao_previa(jsonb)`: a prévia do RF-BAS-07. Diz, linha a
--      linha, o que vai acontecer — entra, é duplicata DE QUEM (com o nome da
--      ficha, senão a pessoa não decide), vai para revisão por qual motivo, ou
--      não entra por ter pedido para parar. Não escreve uma linha sequer.
--   4. `public.importacao_gravar(uuid, jsonb)`: a gravação, em pedaços, pela
--      esteira do ADR-08 — `esteira_gravar_captura` → `esteira_processar_captura`
--      → `app.promover_candidato`. Todo caminho de escrita já existia; aqui só
--      se decide qual deles cada linha percorre.
--   5. `public.importacao_encerrar_lote(uuid, jsonb)`: fecha o lote com as
--      estatísticas, deixando a janela de desfazer de 48 h do `import_batches`
--      (e o `esteira_desfazer_lote` que já existe) valendo para a planilha.
--
-- IDEMPOTÊNCIA (a promessa central: importar duas vezes não duplica nada)
--   Ela não é nova, é herdada — e é herdada em QUATRO camadas independentes:
--     * `raw_capture_conteudo_uq (source_id, content_hash)` — a mesma linha, com
--       o mesmo conteúdo, não vira duas capturas.
--     * `source_record_fonte_externo_uq (source_id, external_id)` — o mesmo
--       fornecedor não vira dois registros normalizados; conteúdo idêntico só
--       carimba `last_seen_at` e devolve `mudou = false`.
--     * `app.promover_candidato` devolve a MESMA organização quando o candidato
--       já está aprovado, e recusa com `ja_existe_na_base` quando alguma das
--       quatro chaves únicas já está na base.
--     * `activities_client_key_idx` — a atividade de histórico da planilha tem
--       chave de cliente determinística e não vira duas linhas de agenda.
--   O `external_id` é o que amarra tudo: é derivado do que identifica o
--   fornecedor (celular > @ > CNPJ > nome+cidade), nunca do número da linha —
--   se fosse o número da linha, reordenar a planilha duplicaria a base inteira.
--
-- O que esta migração NÃO faz
--   * Não cria organização por fora da esteira. Linha nenhuma escreve em
--     `organizations` a não ser por `app.promover_candidato`.
--   * Não decide duplicata sozinha: a linha que casa com ficha existente NÃO é
--     mesclada nem descartada — vira candidato marcado `ja_existe_na_base` e vai
--     para a fila de revisão do Radar, que já sabe mesclar e recusar.
--   * Não sintetiza desfecho: a coluna `resultado` da planilha vira TEXTO na
--     atividade de histórico, com `outcome_id` nulo. Um desfecho de verdade
--     moveria etapa, marcaria temperatura, abriria tarefa e dispararia cadência
--     HOJE por um contato que aconteceu semana passada. Ver `docs/CHANGELOG.md`.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 1. A chave de casamento de catálogo
-- ---------------------------------------------------------------------------
-- `app.search_name` guarda a pontuação (é a chave do trigrama de nomes de
-- empresa, onde "&" e "." importam). Para casar o texto de uma LISTA SUSPENSA
-- com o catálogo do banco, a pontuação é só ruído: "Buffet adulto / corporativo"
-- na planilha e "Buffet adulto/corporativo" no banco são a mesma coisa, e a
-- diferença é uma barra com espaço.
create or replace function app.chave_catalogo(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
           trim(regexp_replace(
             lower(extensions.unaccent(coalesce(t, ''))), '[^a-z0-9]+', ' ', 'g')),
           '')
$$;
comment on function app.chave_catalogo(text) is
  'Chave de casamento de valor de lista com catálogo: sem acento, sem caixa e sem pontuação. Não substitui app.search_name, que é a chave do trigrama de nomes de empresa.';
revoke all on function app.chave_catalogo(text) from public, anon;
grant execute on function app.chave_catalogo(text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. Data escrita por gente
-- ---------------------------------------------------------------------------
-- A planilha chega com a data já em ISO quando o leitor do navegador conseguiu
-- interpretar a célula (serial do Excel, célula de data). Quando a pessoa digitou
-- à mão, vem "09/09/2026" ou "9-9-2026". As duas formas entram; o resto vira
-- nulo com aviso, e nunca uma exceção que derrubaria a linha inteira.
create or replace function app.importacao_data(t text)
returns date
language plpgsql
-- STABLE, e não IMMUTABLE: o cast de texto para `date` consulta o DateStyle da
-- sessão. Prometer imutabilidade aqui autorizaria o planejador a dobrar a
-- chamada numa constante — e a função nunca é chave de índice, então não há o
-- que ganhar com a promessa.
stable
set search_path = ''
as $$
declare
  v text := trim(coalesce(t, ''));
  m text[];
begin
  if v = '' then
    return null;
  end if;
  if v ~ '^\d{4}-\d{2}-\d{2}' then
    begin
      return substr(v, 1, 10)::date;
    exception when others then
      return null;
    end;
  end if;
  m := regexp_match(v, '^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$');
  if m is null then
    return null;
  end if;
  begin
    return make_date(
      case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end,
      m[2]::int, m[1]::int);
  exception when others then
    return null;
  end;
end $$;
comment on function app.importacao_data(text) is
  'Data de célula de planilha: aceita ISO (o que o leitor do navegador já converteu) e o dd/mm/aaaa que a pessoa digita. Devolve nulo em vez de estourar.';
revoke all on function app.importacao_data(text) from public, anon;
grant execute on function app.importacao_data(text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. Resolvedores de catálogo
-- ---------------------------------------------------------------------------
-- Todos devolvem `{id, nome, aproximado}` — ou `{}` quando não reconheceram.
-- `aproximado` é o que a prévia mostra: casou por semelhança, confira. O limiar
-- de 0,55 foi escolhido contra a lista real da planilha-ponte (aba Listas): ele
-- casa "Outros serviços (celebrante, beleza, ...)" com "Celebrante, beleza, ..."
-- e NÃO casa duas categorias diferentes entre si.

create or replace function app.importacao_categoria(t text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  k text := app.chave_catalogo(t);
  r record;
begin
  if k is null then
    return '{}'::jsonb;
  end if;
  select c.id, c.name into r
    from public.categories c
   where c.is_active and (app.chave_catalogo(c.name) = k or app.chave_catalogo(c.slug) = k)
   limit 1;
  if r.id is not null then
    return jsonb_build_object('id', r.id, 'nome', r.name, 'aproximado', false);
  end if;
  select c.id, c.name into r
    from public.categories c
   where c.is_active and extensions.similarity(app.chave_catalogo(c.name), k) >= 0.55
   order by extensions.similarity(app.chave_catalogo(c.name), k) desc, c.position, c.id
   limit 1;
  if r.id is null then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('id', r.id, 'nome', r.name, 'aproximado', true);
end $$;

create or replace function app.importacao_cidade(t text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  k text := app.chave_catalogo(t);
  r record;
begin
  if k is null then
    return '{}'::jsonb;
  end if;
  select ci.id, ci.name into r
    from public.cities ci
   where app.chave_catalogo(ci.name) = k
   limit 1;
  if r.id is null then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('id', r.id, 'nome', r.name, 'aproximado', false);
end $$;

-- A origem é obrigatória por LGPD (a abertura da conversa diz de onde veio o
-- número, R06). Por isso ela não casa "quase": ou o rótulo da lista bate com uma
-- fonte cadastrada, ou a linha vai para revisão.
create or replace function app.importacao_fonte(t text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  k text := app.chave_catalogo(t);
  r record;
begin
  if k is null then
    return '{}'::jsonb;
  end if;
  -- Apelidos da aba "Listas" da planilha-ponte que não são o nome nem o slug da
  -- fonte no banco. Ficam aqui, e não no meio do fluxo, porque são o contrato
  -- entre um arquivo de Excel e o catálogo — muda o Excel, muda esta lista.
  k := case k
         when 'base cnpj'      then 'base cnpj'
         when 'google places'  then 'google places'
         when 'planilha atual' then 'planilha'
         when 'sympla outgo'   then 'sympla outgo'
         else k
       end;
  select s.id, s.name into r
    from public.sources s
   where app.chave_catalogo(s.name) = k or app.chave_catalogo(s.slug) = k
   limit 1;
  if r.id is not null then
    return jsonb_build_object('id', r.id, 'nome', r.name, 'aproximado', false);
  end if;

  -- Fonte que agrupa vários diretórios traz os apelidos no PRÓPRIO nome, separados
  -- por barra: "TeleListas / GuiaMais / Organizando Eventos / Solutudo". Quem
  -- preencheu a planilha escreveu o diretório onde achou o telefone, e é essa a
  -- resposta que o titular merece ouvir. Casar por parte do nome não é palpite: a
  -- lista de apelidos é o catálogo, não uma tabela paralela.
  select s.id, s.name into r
    from public.sources s,
         lateral unnest(string_to_array(s.name, '/')) parte
   where app.chave_catalogo(parte) = k
   limit 1;
  if r.id is null then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('id', r.id, 'nome', r.name, 'aproximado', true);
end $$;

-- Duas pessoas com o mesmo primeiro nome não viram um palpite: o dono fica em
-- branco (e a promoção usa quem importou), com aviso na prévia. Errar o dono de
-- uma carteira é pior do que não ter dono, porque some da fila de quem deveria
-- trabalhar a ficha.
create or replace function app.importacao_pessoa(t text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  k text := app.chave_catalogo(t);
  r record;
  n int;
begin
  if k is null then
    return '{}'::jsonb;
  end if;
  select p.id, p.full_name into r
    from public.profiles p
   where p.is_active and app.chave_catalogo(p.full_name) = k
   limit 1;
  if r.id is not null then
    return jsonb_build_object('id', r.id, 'nome', r.full_name, 'aproximado', false);
  end if;
  select count(*) into n
    from public.profiles p
   where p.is_active and app.chave_catalogo(p.full_name) like k || ' %';
  if n <> 1 then
    return jsonb_build_object('ambiguo', n > 1);
  end if;
  select p.id, p.full_name into r
    from public.profiles p
   where p.is_active and app.chave_catalogo(p.full_name) like k || ' %'
   limit 1;
  return jsonb_build_object('id', r.id, 'nome', r.full_name, 'aproximado', true);
end $$;

-- A etapa é resolvida DENTRO do funil que a categoria manda: "Contatado",
-- "Respondeu", "Perdido" e "Opt-out" existem nos dois funis, e trocar de funil
-- é trocar o negócio de lugar.
create or replace function app.importacao_etapa(t text, p_pipeline int)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
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
     and (app.chave_catalogo(st.name) = k or app.chave_catalogo(st.slug) = k)
   limit 1;
  if r.id is not null then
    return jsonb_build_object('id', r.id, 'nome', r.name, 'aproximado', false);
  end if;
  select st.id, st.name into r
    from public.stages st
   where st.pipeline_id = p_pipeline
     and extensions.similarity(app.chave_catalogo(st.name), k) >= 0.55
   order by extensions.similarity(app.chave_catalogo(st.name), k) desc, st.position, st.id
   limit 1;
  if r.id is null then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('id', r.id, 'nome', r.name, 'aproximado', true);
end $$;

create or replace function app.importacao_canal(t text)
returns app.channel
language sql
immutable
set search_path = ''
as $$
  select case
           when app.chave_catalogo(t) is null then null
           when app.chave_catalogo(t) like 'whatsapp%'   then 'whatsapp'
           when app.chave_catalogo(t) like 'instagram%'  then 'instagram'
           when app.chave_catalogo(t) like 'e mail%'
             or app.chave_catalogo(t) like 'email%'      then 'email'
           when app.chave_catalogo(t) like 'ligacao%'    then 'phone'
           when app.chave_catalogo(t) like 'visita%'
             or app.chave_catalogo(t) like 'pessoalmente%' then 'presencial'
           else 'other'
         end::app.channel
$$;

revoke all on function app.importacao_categoria(text) from public, anon;
revoke all on function app.importacao_cidade(text)    from public, anon;
revoke all on function app.importacao_fonte(text)     from public, anon;
revoke all on function app.importacao_pessoa(text)    from public, anon;
revoke all on function app.importacao_etapa(text,int) from public, anon;
revoke all on function app.importacao_canal(text)     from public, anon;
grant execute on function app.importacao_categoria(text) to authenticated, service_role;
grant execute on function app.importacao_cidade(text)    to authenticated, service_role;
grant execute on function app.importacao_fonte(text)     to authenticated, service_role;
grant execute on function app.importacao_pessoa(text)    to authenticated, service_role;
grant execute on function app.importacao_etapa(text,int) to authenticated, service_role;
grant execute on function app.importacao_canal(text)     to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. A linha da planilha vira o objeto canônico da esteira
-- ---------------------------------------------------------------------------
-- STABLE de propósito: a prévia e a gravação chamam ESTA função, e não duas
-- parecidas. Uma prévia que promete o que a gravação não cumpre é pior do que
-- não ter prévia.
create or replace function app.importacao_normalizar(p jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_avisos  text[] := '{}'::text[];
  v_erro    text;
  v_nome    text := nullif(trim(coalesce(p ->> 'nome', '')), '');
  v_bruto   text;
  v_tel     text;
  v_ig      text;
  v_cnpj    text;
  v_site    text;
  v_cat     jsonb;
  v_cid     jsonb;
  v_fonte   jsonb;
  v_pessoa  jsonb;
  v_etapa   jsonb;
  v_grupo   text;
  v_slug    text;
  v_kind    app.org_kind;
  v_pipe    int;
  v_tipo    text := app.chave_catalogo(p ->> 'tipo');
  v_ult     date;
  v_prox    date;
  v_obs     text;
  v_res     text;
  v_optout  boolean;
  v_ext     text;
  v_url     text;
  v_payload jsonb;
begin
  -- ------------------------------------------------------------------
  -- Higiene do RF-BAS-16 antes de tudo: CPF não entra nem no que a prévia
  -- devolve para a tela. `app.sem_cpf` apaga; `app.tem_cpf` só conta que havia.
  -- ------------------------------------------------------------------
  if app.tem_cpf(coalesce(v_nome, '')) or app.tem_cpf(coalesce(p ->> 'observacoes', ''))
     or app.tem_cpf(coalesce(p ->> 'origem_detalhe', '')) then
    v_avisos := v_avisos || 'cpf_descartado'::text;
  end if;
  v_nome := app.sem_cpf(v_nome);
  v_obs  := app.sem_cpf(nullif(trim(coalesce(p ->> 'observacoes', '')), ''));
  v_res  := nullif(trim(coalesce(p ->> 'resultado', '')), '');

  -- ------------------------------------------------------------------
  -- Identidade
  -- ------------------------------------------------------------------
  v_bruto := nullif(trim(coalesce(p ->> 'whatsapp', '')), '');
  v_tel   := app.normalize_phone_br(v_bruto);
  if v_bruto is not null and v_tel is null then
    v_avisos := v_avisos || 'telefone_invalido'::text;
  end if;

  v_bruto := nullif(trim(coalesce(p ->> 'instagram', '')), '');
  v_ig    := app.normalize_instagram(v_bruto);
  if v_bruto is not null and v_ig is null then
    v_avisos := v_avisos || 'instagram_invalido'::text;
  end if;

  v_bruto := nullif(trim(coalesce(p ->> 'cnpj', '')), '');
  v_cnpj  := app.normalize_cnpj(v_bruto);
  if v_cnpj is not null and not app.cnpj_is_valid(v_cnpj) then
    v_avisos := v_avisos || 'cnpj_invalido'::text;
    v_cnpj := null;
  end if;

  v_site := nullif(trim(coalesce(p ->> 'site', '')), '');

  -- ------------------------------------------------------------------
  -- Catálogos
  -- ------------------------------------------------------------------
  v_cat   := app.importacao_categoria(p ->> 'categoria');
  v_cid   := app.importacao_cidade(p ->> 'cidade');
  v_fonte := app.importacao_fonte(p ->> 'origem');
  v_pessoa := app.importacao_pessoa(p ->> 'responsavel');

  if v_cat = '{}'::jsonb then
    v_avisos := v_avisos || 'categoria_desconhecida'::text;
  elsif (v_cat ->> 'aproximado')::boolean then
    v_avisos := v_avisos || 'categoria_aproximada'::text;
  end if;
  if nullif(trim(coalesce(p ->> 'cidade', '')), '') is not null and v_cid = '{}'::jsonb then
    v_avisos := v_avisos || 'cidade_desconhecida'::text;
  end if;
  if v_fonte = '{}'::jsonb then
    v_avisos := v_avisos || 'origem_desconhecida'::text;
  end if;
  if v_pessoa ->> 'id' is null and nullif(trim(coalesce(p ->> 'responsavel', '')), '') is not null then
    v_avisos := v_avisos || (case when coalesce((v_pessoa ->> 'ambiguo')::boolean, false)
                                  then 'responsavel_ambiguo' else 'responsavel_desconhecido' end)::text;
  end if;

  -- O tipo do negócio sai da CATEGORIA, exatamente como em app.promover_candidato:
  -- se a coluna `tipo` discordar, quem manda é a categoria, e a prévia avisa.
  if v_cat ->> 'id' is not null then
    select c.group, c.slug into v_grupo, v_slug
      from public.categories c where c.id = (v_cat ->> 'id')::int;
    v_kind := case
                when v_slug = 'cerimonialistas_assessorias' then 'cerimonialista'
                when v_grupo = 'producao' then 'produtor'
                when v_grupo = 'locais'   then 'espaco'
                else 'fornecedor'
              end::app.org_kind;
    select pl.id into v_pipe from public.pipelines pl
     where pl.slug = case when v_kind in ('produtor','cerimonialista') then 'produtor' else 'fornecedor' end;
    if v_tipo is not null and v_tipo <> app.chave_catalogo(v_kind::text) then
      v_avisos := v_avisos || 'tipo_diferente_da_categoria'::text;
    end if;
  end if;

  v_etapa := app.importacao_etapa(p ->> 'etapa', v_pipe);
  if v_etapa = '{}'::jsonb and nullif(trim(coalesce(p ->> 'etapa', '')), '') is not null
     and v_pipe is not null then
    v_avisos := v_avisos || 'etapa_desconhecida'::text;
  elsif v_etapa <> '{}'::jsonb and (v_etapa ->> 'aproximado')::boolean then
    v_avisos := v_avisos || 'etapa_aproximada'::text;
  end if;

  -- ------------------------------------------------------------------
  -- Datas
  -- ------------------------------------------------------------------
  v_ult  := app.importacao_data(p ->> 'ultimo_contato');
  v_prox := app.importacao_data(p ->> 'data_proxima_acao');
  if nullif(trim(coalesce(p ->> 'ultimo_contato', '')), '') is not null and v_ult is null then
    v_avisos := v_avisos || 'data_invalida'::text;
  end if;
  if nullif(trim(coalesce(p ->> 'data_proxima_acao', '')), '') is not null and v_prox is null then
    v_avisos := v_avisos || 'data_invalida'::text;
  end if;

  -- ------------------------------------------------------------------
  -- Pediu para parar (regra 4 do README da planilha-ponte, guardrail do CLAUDE.md)
  -- ------------------------------------------------------------------
  v_optout := app.chave_catalogo(p ->> 'etapa') like 'opt out%'
           or app.chave_catalogo(v_res) like 'pediu para parar%'
           or app.is_suppressed(v_tel, v_cnpj, v_ig);

  -- ------------------------------------------------------------------
  -- Erros que impedem a linha de virar ficha
  -- ------------------------------------------------------------------
  if v_nome is null then
    v_erro := 'sem_nome';
  elsif v_tel is null and v_ig is null and v_cnpj is null then
    v_erro := 'sem_contato';
  end if;

  -- ------------------------------------------------------------------
  -- Identidade na fonte. NUNCA o número da linha: reordenar a planilha
  -- duplicaria a base inteira. Celular > @ > CNPJ > nome+cidade.
  -- ------------------------------------------------------------------
  v_ext := coalesce(v_tel, case when v_ig is not null then '@' || v_ig end, v_cnpj,
                    case when v_nome is not null
                         then app.search_name(v_nome) || '|' || coalesce(v_cid ->> 'nome', 'sem-cidade') end);

  -- `origem_detalhe` é a URL da fonte quando é uma URL; senão é observação da
  -- origem, e vira aviso na proveniência, não link.
  v_url := nullif(trim(coalesce(p ->> 'origem_detalhe', '')), '');
  if v_url is not null and v_url !~* '^https?://' then
    v_url := null;
  end if;

  -- ------------------------------------------------------------------
  -- O payload da captura: SÓ o que a whitelist do R06 SCR-01 permite. Etapa,
  -- responsável, resultado e observação são dado NOSSO, de operação — não são
  -- coleta de terceiro e não entram no `raw_capture`.
  -- ------------------------------------------------------------------
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'nome_comercial', v_nome,
    'cnpj',           v_cnpj,
    'cidade',         v_cid ->> 'nome',
    'bairro',         nullif(trim(coalesce(p ->> 'bairro', '')), ''),
    'instagram',      v_ig,
    'site',           v_site,
    'source_url',     v_url,
    'categoria_origem', nullif(trim(coalesce(p ->> 'categoria', '')), ''),
    'telefones',      case when v_tel is not null then jsonb_build_array(v_tel) end));

  return jsonb_build_object(
    'linha',            coalesce((p ->> 'linha')::int, 0),
    'nome',             v_nome,
    'kind',             v_kind,
    'categoria_id',     (v_cat ->> 'id')::int,
    'categoria_nome',   v_cat ->> 'nome',
    'cidade_id',        (v_cid ->> 'id')::int,
    'cidade_nome',      v_cid ->> 'nome',
    'source_id',        (v_fonte ->> 'id')::int,
    'source_nome',      v_fonte ->> 'nome',
    'source_url',       v_url,
    'pipeline_id',      v_pipe,
    'etapa_id',         (v_etapa ->> 'id')::int,
    'etapa_nome',       v_etapa ->> 'nome',
    'responsavel_id',   v_pessoa ->> 'id',
    'responsavel_nome', v_pessoa ->> 'nome',
    'telefone',         v_tel,
    'telefone_visivel', case when v_tel is not null then
                               case when app.reads_base_pii() then v_tel else app.mask_phone(v_tel) end end,
    'instagram',        v_ig,
    'cnpj',             v_cnpj,
    'bairro',           nullif(trim(coalesce(p ->> 'bairro', '')), ''),
    'ultimo_contato',   v_ult,
    'canal',            app.importacao_canal(p ->> 'canal_ultimo_contato'),
    'resultado',        v_res,
    'proxima_acao',     nullif(trim(coalesce(p ->> 'proxima_acao', '')), ''),
    'data_proxima_acao', v_prox,
    'observacoes',      v_obs,
    'optout',           v_optout,
    'external_id',      v_ext,
    'payload',          v_payload,
    'erro',             v_erro,
    'avisos',           to_jsonb(v_avisos));
end $$;
comment on function app.importacao_normalizar(jsonb) is
  'Uma linha da planilha-ponte (RF-BAS-07) vira o objeto canônico da esteira: telefone em E.164, catálogos resolvidos com aviso quando aproximados, external_id determinístico (nunca o número da linha) e payload já dentro da whitelist do R06 SCR-01. STABLE: a prévia e a gravação usam ESTA função, não duas parecidas.';
revoke all on function app.importacao_normalizar(jsonb) from public, anon;
grant execute on function app.importacao_normalizar(jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5. A prévia (RF-BAS-07): o que vai acontecer, sem que nada aconteça
-- ---------------------------------------------------------------------------
-- "Quantos entram, quantos são duplicata — COM O NOME de quem duplicam — e
-- quantos vão para revisão." O nome não é enfeite: sem ele a pessoa não decide.
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
        -- existe para não ter.
        if v_dup.organization_id is null then
          select o.id                     as organization_id,
                 case when app.org_is_visible(o.id) then o.name end as nome,
                 app.org_is_visible(o.id) as visivel,
                 0.95::numeric            as confidence,
                 (case when v_n ->> 'cnpj' is not null and o.cnpj = v_n ->> 'cnpj' then 'cnpj'
                       when v_n ->> 'instagram' is not null
                        and o.instagram_handle = v_n ->> 'instagram' then 'instagram'
                       else 'phone' end)  as reason
            into v_dup
            from public.organizations o
           where o.deleted_at is null
             and ((v_n ->> 'cnpj' is not null and o.cnpj = v_n ->> 'cnpj')
               or (v_n ->> 'telefone' is not null and o.phone_e164 = v_n ->> 'telefone')
               or (v_n ->> 'instagram' is not null and o.instagram_handle = v_n ->> 'instagram'))
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
  'Prévia da importação de planilha (RF-BAS-07): linha a linha, o que vai acontecer — entra, é duplicata de QUAL ficha (com o nome), vai para revisão por qual motivo, ou não entra por ter pedido para parar. Não escreve nada. Máximo de 500 linhas por chamada.';
revoke all on function public.importacao_previa(jsonb) from public, anon;
grant execute on function public.importacao_previa(jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 6. A gravação, pela esteira do ADR-08
-- ---------------------------------------------------------------------------
create or replace function public.importacao_gravar(p_batch_id uuid, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b       public.import_batches;
  v_linha   jsonb;
  v_n       jsonb;
  v_cap     jsonb;
  v_proc    jsonb;
  v_cand    public.supplier_candidates;
  v_candid  uuid;
  v_prom    jsonb;
  v_org     uuid;
  v_orgnome text;
  v_decisao text;
  v_motivo  text;
  v_saida   jsonb := '[]'::jsonb;
  v_conta   jsonb := jsonb_build_object('entra', 0, 'duplicata', 0, 'revisao', 0,
                                        'nao_contatar', 0, 'erro', 0, 'repetida', 0);
  v_quem    text;
  v_ult     timestamptz;
  v_corpo   text;
begin
  if not app.can_write() then
    raise exception 'Papel % não importa planilha', app.role() using errcode = '42501';
  end if;
  select * into v_b from public.import_batches where id = p_batch_id;
  if v_b.id is null then
    return jsonb_build_object('ok', false, 'reason', 'lote_inexistente');
  end if;
  if v_b.kind <> 'planilha' then
    return jsonb_build_object('ok', false, 'reason', 'lote_nao_e_planilha');
  end if;
  if v_b.status in ('concluido', 'desfeito', 'falhou') then
    return jsonb_build_object('ok', false, 'reason', 'lote_encerrado', 'status', v_b.status);
  end if;
  if jsonb_typeof(p_linhas) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'linhas_invalidas');
  end if;
  if jsonb_array_length(p_linhas) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'lote_grande_demais');
  end if;

  update public.import_batches
     set status = 'rodando', started_at = coalesce(started_at, now())
   where id = p_batch_id and status = 'previa';

  select pr.full_name into v_quem from public.profiles pr where pr.id = auth.uid();
  v_quem := coalesce(v_quem, 'importação');

  for v_linha in select value from jsonb_array_elements(p_linhas) loop
    v_n := app.importacao_normalizar(v_linha);
    v_candid := null; v_org := null; v_orgnome := null; v_motivo := null;
    v_cand := null;

    -- (a) A linha não vira ficha.
    if v_n ->> 'erro' is not null then
      v_decisao := 'erro';
      v_motivo  := v_n ->> 'erro';

    -- (b) Pediu para parar: NÃO vira alvo, mas o pedido tem de sobreviver — o
    -- telefone entra na lista de supressão e o candidato nasce "não contatar"
    -- pelo gatilho de `supplier_candidates`. É o guardrail do CLAUDE.md: nenhuma
    -- cadência, tarefa ou toque nasce para contato suprimido.
    elsif coalesce((v_n ->> 'optout')::boolean, false) then
      -- A ficha JÁ existe? Então o caminho certo não é suprimir por fora: é
      -- registrar o `contact_optout` em `consent_events` e deixar
      -- `app.consent_apply` fazer o resto — do_not_contact na ficha, os hashes na
      -- lista de supressão E o negócio movido para a etapa de opt-out do funil.
      -- Suprimir por fora deixaria o cartão em "Em conversa", na fila do dia de
      -- alguém que não pode mais escrever.
      select o.id into v_org
        from public.organizations o
       where o.deleted_at is null
         and ((v_n ->> 'telefone'  is not null and o.phone_e164 = v_n ->> 'telefone')
           or (v_n ->> 'instagram' is not null and o.instagram_handle = v_n ->> 'instagram')
           or (v_n ->> 'cnpj'      is not null and o.cnpj = v_n ->> 'cnpj'))
       limit 1;

      if v_org is not null then
        insert into public.consent_events
          (kind, organization_id, channel, evidence_text, occurred_at, recorded_by)
        values
          ('contact_optout'::app.consent_kind, v_org,
           coalesce(nullif(v_n ->> 'canal', '')::app.channel, 'whatsapp'::app.channel),
           concat_ws(' — ', 'Planilha-ponte', v_n ->> 'resultado', v_n ->> 'observacoes'),
           coalesce((((v_n ->> 'ultimo_contato')::date + time '12:00')
                     at time zone 'America/Fortaleza'), now()),
           auth.uid());
      else
        -- Sem ficha, não há a que apensar o evento: guarda-se o HASH e mais nada.
        -- É o mínimo que cumpre o pedido, e o máximo que a minimização permite.
        perform app.suppress('phone', v_n ->> 'telefone',
                             'Planilha-ponte: ' || coalesce(v_n ->> 'resultado', 'pediu para parar'),
                             'whatsapp'::app.channel, null);
        if v_n ->> 'instagram' is not null then
          perform app.suppress('instagram', v_n ->> 'instagram',
                               'Planilha-ponte: pediu para parar', 'instagram'::app.channel, null);
        end if;
      end if;
      v_decisao := 'nao_contatar';
      v_motivo  := 'pediu_para_parar';

    else
      -- (c) A esteira, do jeito que já existia. Repare que `p_source_url` vai
      -- NULO de propósito: a chave de idempotência da captura é
      -- sha256(source_id|source_url|external_id), e várias linhas costumam
      -- compartilhar a mesma URL de listagem — passar a URL ali faria a segunda
      -- linha ser engolida como "pedido repetido". A URL viaja dentro do
      -- payload (`source_url` está na whitelist) e o processamento a lê de lá.
      v_cap := public.esteira_gravar_captura(
                 p_batch_id,
                 coalesce((v_n ->> 'source_id')::int, v_b.source_id),
                 v_n -> 'payload',
                 v_n ->> 'external_id',
                 null, null, v_quem);

      if not coalesce((v_cap ->> 'ok')::boolean, false) then
        v_decisao := 'erro';
        v_motivo  := coalesce(v_cap ->> 'reason', 'captura_recusada');
      else
        v_proc := public.esteira_processar_captura((v_cap ->> 'raw_capture_id')::uuid);
        if not coalesce((v_proc ->> 'ok')::boolean, false) then
          v_decisao := 'erro';
          v_motivo  := coalesce(v_proc ->> 'reason', 'processamento_recusado');
        else
          select sr.candidate_id into v_candid
            from public.source_record sr where sr.id = (v_proc ->> 'source_record_id')::uuid;
          v_candid := coalesce((v_proc ->> 'candidate_id')::uuid, v_candid);

          if v_candid is null then
            v_decisao := 'revisao';
            v_motivo  := 'sem_candidato';
          else
            select * into v_cand from public.supplier_candidates where id = v_candid;

            -- Observação, resultado e data do último contato completam o
            -- candidato: são dado nosso, não coleta, e por isso não passam pelo
            -- payload da captura.
            if v_n ->> 'observacoes' is not null or v_n ->> 'resultado' is not null then
              update public.supplier_candidates c
                 set notes = coalesce(c.notes,
                       concat_ws(' — ', v_n ->> 'resultado', v_n ->> 'observacoes'))
               where c.id = v_candid;
            end if;

            if v_cand.status = 'aprovado' and v_cand.organization_id is not null then
              -- Já entrou numa importação anterior. É AQUI que "importar duas
              -- vezes não duplica nada" aparece na conta da tela.
              v_decisao := 'repetida';
              v_motivo  := 'ja_importado';
              v_org     := v_cand.organization_id;
            elsif v_cand.do_not_contact then
              v_decisao := 'nao_contatar';
              v_motivo  := 'pediu_para_parar';
            elsif v_cand.status <> 'novo' then
              v_decisao := 'revisao';
              v_motivo  := 'ja_revisado';
            elsif 'ja_existe_na_base' = any (v_cand.flags) then
              v_decisao := 'duplicata';
              v_motivo  := 'ja_existe_na_base';
              select (d ->> 'organization_id')::uuid into v_org
                from jsonb_array_elements(coalesce(v_cand.payload -> 'duplicatas', '[]'::jsonb)) d
               order by (d ->> 'confidence')::numeric desc limit 1;
            elsif v_n ->> 'categoria_id' is null then
              v_decisao := 'revisao';
              v_motivo  := 'categoria_desconhecida';
            else
              v_prom := app.promover_candidato(
                          v_candid,
                          (v_n ->> 'etapa_id')::int,
                          nullif(v_n ->> 'responsavel_id', '')::uuid,
                          v_n ->> 'proxima_acao',
                          case when v_n ->> 'data_proxima_acao' is not null
                               then (((v_n ->> 'data_proxima_acao')::date + time '09:00')
                                     at time zone 'America/Fortaleza') end,
                          (v_n ->> 'categoria_id')::int,
                          p_batch_id);
              if coalesce((v_prom ->> 'ok')::boolean, false) then
                v_decisao := 'entra';
                v_org     := (v_prom ->> 'organization_id')::uuid;
                if coalesce((v_prom ->> 'ja_estava')::boolean, false) then
                  v_decisao := 'repetida';
                  v_motivo  := 'ja_importado';
                end if;
              elsif v_prom ->> 'reason' = 'ja_existe_na_base' then
                v_decisao := 'duplicata';
                v_motivo  := 'ja_existe_na_base';
                v_org     := (v_prom ->> 'organization_id')::uuid;
              else
                v_decisao := 'revisao';
                v_motivo  := coalesce(v_prom ->> 'reason', 'promocao_recusada');
              end if;
            end if;
          end if;
        end if;
      end if;
    end if;

    -- (d) O histórico do que a planilha registrou. Atividade de NOTA com
    -- `outcome_id` nulo: um desfecho de verdade moveria etapa, marcaria
    -- temperatura, abriria tarefa e dispararia cadência HOJE por um contato que
    -- aconteceu semana passada. A chave de cliente é determinística, então
    -- reimportar não vira segunda linha de agenda.
    if v_decisao = 'entra' and v_org is not null and v_n ->> 'ultimo_contato' is not null then
      v_ult := (((v_n ->> 'ultimo_contato')::date + time '12:00') at time zone 'America/Fortaleza');
      v_corpo := concat_ws(' — ',
                   'Registrado na planilha-ponte',
                   v_n ->> 'resultado', v_n ->> 'observacoes');
      insert into public.activities
        (type, organization_id, deal_id, user_id, author_kind, occurred_at, body, channel, metadata)
      values
        ('note'::app.activity_type, v_org,
         (select d.id from public.deals d where d.organization_id = v_org order by d.created_at limit 1),
         coalesce(nullif(v_n ->> 'responsavel_id', '')::uuid, auth.uid()),
         'human', v_ult, v_corpo,
         nullif(v_n ->> 'canal', '')::app.channel,
         jsonb_build_object(
           'client_key', 'planilha:' || coalesce(v_n ->> 'source_id', '0') || ':'
                         || coalesce(v_n ->> 'external_id', '') || ':' || (v_n ->> 'ultimo_contato'),
           'origin', 'importacao_planilha',
           'batch_id', p_batch_id,
           'resultado_planilha', v_n ->> 'resultado'))
      on conflict do nothing;
    end if;

    if v_org is not null then
      select o.name into v_orgnome from public.organizations o where o.id = v_org;
    end if;

    v_conta := jsonb_set(v_conta, array[v_decisao],
                         to_jsonb(coalesce((v_conta ->> v_decisao)::int, 0) + 1));
    v_saida := v_saida || jsonb_build_array(jsonb_build_object(
      'linha', (v_n ->> 'linha')::int,
      'nome', v_n ->> 'nome',
      'decisao', v_decisao,
      'motivo', v_motivo,
      'organization_id', v_org,
      'organizacao', v_orgnome,
      'candidate_id', v_candid));
  end loop;

  update public.import_batches b
     set stats = (
           select jsonb_object_agg(k, coalesce((b.stats ->> k)::int, 0) + coalesce((v_conta ->> k)::int, 0))
             from jsonb_object_keys(v_conta) k)
   where b.id = p_batch_id;

  return jsonb_build_object('ok', true, 'contagem', v_conta, 'linhas', v_saida);
end $$;
comment on function public.importacao_gravar(uuid, jsonb) is
  'Grava um pedaço da planilha pela esteira do ADR-08 (esteira_gravar_captura → esteira_processar_captura → app.promover_candidato). Máximo de 200 linhas por chamada. Idempotente por herança: a mesma linha na segunda importação volta como `repetida`, não como ficha nova.';
revoke all on function public.importacao_gravar(uuid, jsonb) from public, anon;
grant execute on function public.importacao_gravar(uuid, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7. Fechar o lote
-- ---------------------------------------------------------------------------
create or replace function public.importacao_encerrar_lote(p_batch_id uuid, p_erro text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.import_batches;
begin
  if not app.can_write() then
    raise exception 'Papel % não importa planilha', app.role() using errcode = '42501';
  end if;
  select * into v_b from public.import_batches where id = p_batch_id;
  if v_b.id is null then
    return jsonb_build_object('ok', false, 'reason', 'lote_inexistente');
  end if;
  update public.import_batches
     set status = case when p_erro is null then 'concluido' else 'falhou' end,
         finished_at = now(),
         error = nullif(trim(coalesce(p_erro, '')), ''),
         -- A janela de desfazer conta do FIM, não da abertura: um lote grande
         -- que levou uma hora para gravar não pode nascer com uma hora a menos.
         can_undo_until = now() + interval '48 hours'
   where id = p_batch_id
     and status not in ('concluido', 'desfeito');
  select * into v_b from public.import_batches where id = p_batch_id;
  return jsonb_build_object('ok', true, 'status', v_b.status, 'stats', v_b.stats,
                            'desfazer_ate', v_b.can_undo_until);
end $$;
comment on function public.importacao_encerrar_lote(uuid, text) is
  'Fecha o lote de planilha (concluído ou falhou) e reinicia a janela de 48 h do desfazer a partir do fim da gravação, não da abertura.';
revoke all on function public.importacao_encerrar_lote(uuid, text) from public, anon;
grant execute on function public.importacao_encerrar_lote(uuid, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 8. Os lotes já importados (para a tela contar o que foi feito)
-- ---------------------------------------------------------------------------
create or replace function public.importacao_lotes(p_limit int default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.can_write() then
    raise exception 'Papel % não lê os lotes de importação', app.role() using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'rotulo', b.label, 'status', b.status, 'stats', b.stats,
             'criado_em', b.created_at, 'terminou_em', b.finished_at,
             'desfazer_ate', b.can_undo_until,
             'pode_desfazer', b.status = 'concluido' and b.can_undo_until > now(),
             'quem', (select pr.full_name from public.profiles pr where pr.id = b.triggered_by),
             'organizacoes', (select count(*) from public.organizations o
                               where o.import_batch_id = b.id and o.deleted_at is null))
             order by b.created_at desc)
      from (select * from public.import_batches
             where kind = 'planilha'
             order by created_at desc
             limit greatest(1, least(coalesce(p_limit, 10), 50))) b
  ), '[]'::jsonb);
end $$;
comment on function public.importacao_lotes(int) is
  'Últimos lotes de planilha com estatísticas, quantas fichas nasceram deles e se ainda dá para desfazer (48 h, RF-BAS-17).';
revoke all on function public.importacao_lotes(int) from public, anon;
grant execute on function public.importacao_lotes(int) to authenticated, service_role;

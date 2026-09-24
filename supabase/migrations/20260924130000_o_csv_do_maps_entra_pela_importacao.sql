-- =====================================================================
-- O CSV do Google Maps entra pela porta da planilha
--
-- Decisão do Rafael em 24/09/2026 (ADR-12): a lista de prospecção passa a vir
-- de uma raspagem local do Google Maps. O motivo está medido: a fila do Radar
-- tem 277 candidatos e UM telefone. Não é defeito do coletor — o
-- casamentos.com.br não publica o número (fica atrás de um endpoint em
-- Disallow), e nenhuma das outras fontes lidas em 17/09 publica o telefone e
-- permite a coleta ao mesmo tempo. O CRM inteiro começa numa mensagem; uma
-- fila bem ordenada de gente que não dá para chamar não vira conversa nenhuma.
--
-- POR QUE ESTA MIGRAÇÃO EXISTE, E POR QUE ELA É PEQUENA
-- Não se constrói caminho novo de escrita: o CSV entra pela importação de
-- planilha, que já é a esteira do ADR-08 (raw_capture → source_record →
-- supplier_candidate → revisão → organizations), com prévia, dedup e desfazer
-- de 48 h. O que se conserta aqui é um ESTREITAMENTO: o payload que
-- `app.importacao_normalizar` monta tem 9 campos (`20260904001820:531-540`) e a
-- whitelist do R06 (`app.payload_e_permitido`, `20260904001600:141`) permite 22.
-- `email`, `endereco`, `cep`, `nota`, `avaliacoes_qtd` e `place_id` já têm
-- coluna em `public.source_record` e eram jogados fora na porta de entrada.
--
-- O que esta migração ENTREGA
--   1. `app.endereco_br(text)`: o endereço de uma linha do Maps, que vem numa
--      coluna só, vira {bairro, cidade, cep}. Nulo onde não casou.
--   2. `app.importacao_normalizar(jsonb)` recriada: o payload sai de 9 para 15
--      chaves, a categoria consulta o mapa da fonte antes da queda difusa, o
--      `place_id` vira a identidade na fonte e o CPF é varrido do endereço e do
--      bairro ANTES da `raw_capture`.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. Um endereço do Maps vira bairro, cidade e CEP
-- ---------------------------------------------------------------------------
-- O kit devolve o endereço inteiro numa coluna:
--   "Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095"
-- e o CRM precisa dos três separados: `cidade` alimenta `app.importacao_cidade`
-- (e a rota de visita), `bairro` alimenta a rota e a dedup de telefone fixo, e
-- `cep` para em `source_record` — não existe coluna de CEP em
-- `supplier_candidates` nem em `organizations`, e nesta fase não criamos uma.
--
-- A REGRA É ESTREITA DE PROPÓSITO, e o que não casou volta NULO. O Google não
-- garante formato nenhum: MEI que atende em casa, endereço sem número,
-- rodovia, ponto de referência. Palpitar bairro aqui não estraga a ficha —
-- estraga a visita de quem for até lá com a rota na mão.
create or replace function app.endereco_br(t text)
returns jsonb
language plpgsql
-- `stable`, e não `immutable`: `jsonb_build_object` é STABLE no Postgres (a
-- conversão de um valor para json pode depender de configuração da sessão), e
-- `plpgsql_check` acusa a mentira. Nada aqui precisa de `immutable`: a função
-- não entra em índice nem em coluna gerada, e quem a chama
-- (`app.importacao_normalizar`) também é `stable`.
stable
set search_path = ''
as $$
declare
  v_txt    text := coalesce(t, '');
  v_bruto  text;
  v_digito text;
  v_cep    text;
  v_partes text[];
  v_qual   int;      -- índice do pedaço que é a cidade
  v_cidade text;
  v_bairro text;
begin
  -- (a) CEP: a PRIMEIRA ocorrência de \d{5}-?\d{3}, sempre devolvida NNNNN-NNN.
  v_bruto := (select x[1] from regexp_matches(v_txt, '(\d{5}-?\d{3})') x limit 1);
  if v_bruto is not null then
    v_digito := replace(v_bruto, '-', '');
    v_cep    := substr(v_digito, 1, 5) || '-' || substr(v_digito, 6, 3);
    -- Tirado o CEP, o que sobra é o endereço. O espaço no lugar evita colar
    -- dois pedaços que eram vizinhos do número.
    v_txt := replace(v_txt, v_bruto, ' ');
  end if;

  -- (b) Cidade: o ÚLTIMO pedaço entre vírgulas que termine em "- UF".
  v_partes := string_to_array(v_txt, ',');
  for v_i in 1 .. coalesce(array_length(v_partes, 1), 0) loop
    if v_partes[v_i] ~ '^\s*(.+?)\s*-\s*[A-Z]{2}\s*$' then
      v_qual := v_i;
    end if;
  end loop;
  if v_qual is not null then
    v_cidade := (regexp_match(v_partes[v_qual], '^\s*(.+?)\s*-\s*[A-Z]{2}\s*$'))[1];
  end if;

  -- (c) Bairro: o que vem depois do último " - " no pedaço IMEDIATAMENTE
  -- anterior ao da cidade. Sem " - " ali, não há bairro — e não se inventa um.
  if v_qual is not null and v_qual > 1
     and position(' - ' in v_partes[v_qual - 1]) > 0 then
    v_bairro := nullif(trim(regexp_replace(v_partes[v_qual - 1], '^.* - ', '')), '');
  end if;

  return jsonb_build_object('bairro', v_bairro, 'cidade', v_cidade, 'cep', v_cep);
end $$;
comment on function app.endereco_br(text) is
  'Endereço de uma linha do Google Maps → {bairro, cidade, cep}. CEP normalizado em NNNNN-NNN; cidade do último pedaço "Nome - UF"; bairro depois do último " - " do pedaço anterior ao da cidade. O que não casou volta NULO: aqui não se palpita.';
revoke all on function app.endereco_br(text) from public, anon;
grant execute on function app.endereco_br(text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. A linha vira o objeto canônico da esteira — agora com 15 campos
-- ---------------------------------------------------------------------------
-- Recriada a partir da definição viva de `20260904001820:363`, com seis
-- mudanças e mais nada. Elas estão marcadas no corpo com "MUDOU:".
--
--   (a) A FONTE É RESOLVIDA ANTES DA CATEGORIA. Era o contrário; a categoria
--       passou a depender do `source_id` da linha.
--   (b) A CATEGORIA CONSULTA `public.source_category_map` PRIMEIRO, com a mesma
--       expressão de `public.esteira_processar_captura` (20260904001600:1906),
--       e só cai em `app.importacao_categoria` se o mapa não tiver a chave. A
--       ordem importa: `app.importacao_categoria` tem queda difusa em
--       `similarity >= 0.55` que dispararia antes do mapa e marcaria
--       `categoria_aproximada` em cima de um palpite.
--   (c) LÊ `place_id`, `email`, `endereco`, `nota` e `avaliacoes_qtd`, e usa
--       `app.endereco_br` para cidade/bairro/CEP quando não houver coluna
--       explícita — coluna explícita ganha. Nenhum dos três reprova a linha:
--       um lugar sem e-mail continua valendo um telefone.
--   (d) O CPF PASSA A SER VARRIDO NO ENDEREÇO E NO BAIRRO. Com `endereco` no
--       payload isso vira furo real: `public.esteira_gravar_captura` grava
--       `raw_capture.payload` CRU (`app.payload_e_permitido` confere nomes de
--       chave, não valores) e o gatilho que limpa CPF só roda um passo adiante,
--       em `source_record` (20260904001600:624-643). Aqui é antes. CUSTO
--       CONHECIDO: o gatilho deixa de ver o CPF, então a flag `cpf_descartado`
--       e a linha de `field_provenance` com reason='cpf' somem por este
--       caminho. Medido no arquivo 66, bloco 14b, e registrado no CHANGELOG.
--   (e) OS CAMPOS NOVOS VÊM NO TOPO do objeto devolvido, e não só dentro de
--       `payload`: `importacao_previa` (20260904001820:587) e
--       `importacao_gravar` (:766) leem `v_n ->> '<campo>'` e nunca abrem o
--       payload.
--   (f) `external_id`: `place_id` PRIMEIRO. O telefone do Maps muda, o `cid`
--       não. Para a planilha-ponte, que não tem `place_id`, nada muda.
--
-- Continua STABLE: a prévia e a gravação chamam ESTA função, e não duas
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
  -- MUDOU (c): os cinco campos do CSV do Maps e o que sai do endereço.
  v_place   text;
  v_email   text;
  v_end     text;
  v_bairro  text;
  v_cep     text;
  v_nota    numeric;
  v_aval    int;
  v_endj    jsonb;
  v_cidtxt  text;
begin
  -- ------------------------------------------------------------------
  -- Higiene do RF-BAS-16 antes de tudo: CPF não entra nem no que a prévia
  -- devolve para a tela. `app.sem_cpf` apaga; `app.tem_cpf` só conta que havia.
  -- MUDOU (d): `endereco` e `bairro` entram na varredura, porque agora vão
  -- para o payload — e `raw_capture.payload` é gravado CRU.
  -- ------------------------------------------------------------------
  if app.tem_cpf(coalesce(v_nome, '')) or app.tem_cpf(coalesce(p ->> 'observacoes', ''))
     or app.tem_cpf(coalesce(p ->> 'origem_detalhe', ''))
     or app.tem_cpf(coalesce(p ->> 'endereco', ''))
     or app.tem_cpf(coalesce(p ->> 'bairro', '')) then
    v_avisos := v_avisos || 'cpf_descartado'::text;
  end if;
  v_nome   := app.sem_cpf(v_nome);
  v_obs    := app.sem_cpf(nullif(trim(coalesce(p ->> 'observacoes', '')), ''));
  v_res    := nullif(trim(coalesce(p ->> 'resultado', '')), '');
  v_end    := app.sem_cpf(nullif(trim(coalesce(p ->> 'endereco', '')), ''));
  v_bairro := app.sem_cpf(nullif(trim(coalesce(p ->> 'bairro', '')), ''));

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
  -- MUDOU (c): o que o CSV do Google Maps traz e a planilha jogava fora.
  -- O `cid` do Maps NÃO é o `place_id` da Places API; se um dia ligarmos o
  -- conector oficial, os dois identificadores não casam (ADR-12).
  -- ------------------------------------------------------------------
  v_place := nullif(trim(coalesce(p ->> 'place_id', '')), '');

  -- E-mail: o kit devolve uma lista. Fica o PRIMEIRO que é e-mail; o resto é
  -- descartado, porque minimização não é opcional.
  v_bruto := nullif(trim(coalesce(p ->> 'email', '')), '');
  if v_bruto is not null then
    select trim(e) into v_email
      from regexp_split_to_table(v_bruto, '[;,]') e
     where trim(e) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     limit 1;
    if v_email is null then
      v_avisos := v_avisos || 'email_invalido'::text;
    end if;
  end if;

  -- Nota: vírgula decimal do CSV em português, e sempre dentro de 0–5. É sinal
  -- numérico de pontuação (RF-RAD-04), nunca exibido como avaliação.
  v_bruto := nullif(trim(coalesce(p ->> 'nota', '')), '');
  if v_bruto is not null then
    begin
      v_nota := replace(v_bruto, ',', '.')::numeric;
    exception when others then
      v_nota := null;
    end;
    if v_nota is null or v_nota < 0 or v_nota > 5 then
      v_avisos := v_avisos || 'nota_invalida'::text;
      v_nota := null;
    end if;
  end if;

  -- Avaliações: só dígitos. "1.238 avaliações" não é um inteiro.
  v_bruto := nullif(trim(coalesce(p ->> 'avaliacoes_qtd', '')), '');
  if v_bruto is not null then
    if v_bruto ~ '^\d+$' then
      v_aval := v_bruto::int;
    else
      v_avisos := v_avisos || 'avaliacoes_invalidas'::text;
    end if;
  end if;

  -- O endereço vem numa coluna só: dele saem bairro, cidade e CEP. Coluna
  -- explícita GANHA — a planilha-ponte tem `cidade` e `bairro` próprios, e
  -- quem digitou sabe mais do que o regex. `v_bairro` já veio sem CPF acima, e
  -- o que sai de `v_end` também, porque `v_end` já foi varrido.
  v_endj   := case when v_end is not null then app.endereco_br(v_end) else '{}'::jsonb end;
  v_cidtxt := coalesce(nullif(trim(coalesce(p ->> 'cidade', '')), ''), v_endj ->> 'cidade');
  v_bairro := coalesce(v_bairro, v_endj ->> 'bairro');
  v_cep    := coalesce(nullif(trim(coalesce(p ->> 'cep', '')), ''), v_endj ->> 'cep');

  -- ------------------------------------------------------------------
  -- Catálogos
  -- MUDOU (a): a FONTE vem primeiro, porque a categoria depende dela.
  -- ------------------------------------------------------------------
  v_fonte  := app.importacao_fonte(p ->> 'origem');
  v_cid    := app.importacao_cidade(v_cidtxt);
  v_pessoa := app.importacao_pessoa(p ->> 'responsavel');

  -- MUDOU (b): o mapa da fonte antes da queda difusa. A expressão é a mesma de
  -- `public.esteira_processar_captura` (20260904001600:1906): `lower(trim(...))`,
  -- sem `unaccent` — as chaves do mapa são minúsculas e COM acento.
  v_cat := '{}'::jsonb;
  if v_fonte ->> 'id' is not null
     and nullif(trim(coalesce(p ->> 'categoria', '')), '') is not null then
    select jsonb_build_object('id', c.id, 'nome', c.name, 'aproximado', false)
      into v_cat
      from public.source_category_map m
      join public.categories c on c.id = m.category_id
     where m.source_id = (v_fonte ->> 'id')::int
       and m.category_source = lower(trim(coalesce(p ->> 'categoria', '')))
     limit 1;
  end if;
  -- `select into` sem linha deixa v_cat NULO, não '{}': por isso o coalesce.
  if coalesce(v_cat, '{}'::jsonb) = '{}'::jsonb then
    v_cat := app.importacao_categoria(p ->> 'categoria');
  end if;

  if v_cat = '{}'::jsonb then
    v_avisos := v_avisos || 'categoria_desconhecida'::text;
  elsif (v_cat ->> 'aproximado')::boolean then
    v_avisos := v_avisos || 'categoria_aproximada'::text;
  end if;
  -- A cidade nunca foi motivo de revisão nesta esteira: `city_id` é nulável e a
  -- linha entra assim mesmo, só marcada. Agora a cidade também pode ter vindo
  -- do endereço, e é `v_cidtxt` — não mais `p ->> 'cidade'` — que decide se
  -- houve cidade para reconhecer.
  if v_cidtxt is not null and v_cid = '{}'::jsonb then
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
  -- duplicaria a base inteira.
  -- MUDOU (f): lugar > celular > @ > CNPJ > nome+cidade. O telefone do Maps
  -- muda de uma raspagem para a outra; o `cid` do lugar não.
  -- ------------------------------------------------------------------
  v_ext := coalesce(v_place, v_tel, case when v_ig is not null then '@' || v_ig end, v_cnpj,
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
  -- MUDOU (c): de 9 para 15 chaves, todas já dentro de `v_permitidas`. A
  -- whitelist NÃO é ampliada, e `apps/workers/src/ingest/whitelist.ts` não é
  -- tocado: `facebook` e `linkedin` ficam de fora de propósito.
  -- ------------------------------------------------------------------
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'nome_comercial', v_nome,
    'cnpj',           v_cnpj,
    'cidade',         v_cid ->> 'nome',
    'bairro',         v_bairro,
    'instagram',      v_ig,
    'site',           v_site,
    'source_url',     v_url,
    'categoria_origem', nullif(trim(coalesce(p ->> 'categoria', '')), ''),
    'telefones',      case when v_tel is not null then jsonb_build_array(v_tel) end,
    'place_id',       v_place,
    'email',          v_email,
    'endereco',       v_end,
    'cep',            v_cep,
    'nota',           v_nota,
    'avaliacoes_qtd', v_aval));

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
    'bairro',           v_bairro,
    -- MUDOU (e): os campos novos NO TOPO. `importacao_previa` e
    -- `importacao_gravar` leem `v_n ->> '<campo>'` e nunca abrem o payload.
    'place_id',         v_place,
    'email',            v_email,
    'endereco',         v_end,
    'cep',              v_cep,
    'nota',             v_nota,
    'avaliacoes_qtd',   v_aval,
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
  'Uma linha de planilha ou do CSV do Google Maps (RF-BAS-07, ADR-12) vira o objeto canônico da esteira: telefone em E.164, endereço partido por app.endereco_br, categoria pelo mapa da fonte antes da queda difusa, external_id determinístico (place_id > celular > @ > CNPJ > nome+cidade) e payload de 15 campos já dentro da whitelist do R06 SCR-01, com CPF varrido de nome, observação, endereço e bairro ANTES da raw_capture. STABLE: a prévia e a gravação usam ESTA função, não duas parecidas.';
revoke all on function app.importacao_normalizar(jsonb) from public, anon;
grant execute on function app.importacao_normalizar(jsonb) to authenticated, service_role;

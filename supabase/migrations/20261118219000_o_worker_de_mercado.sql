-- =====================================================================
-- O worker de mercado: as portas que faltavam para o comando `mercado` dos
-- workers (só Imova, 18/11/2026)
--
-- O banco de mercado (210000 a 214000) já traz a fila `mercado_coleta`, o
-- pg_cron de segunda e quinta às 6h (`mercado_coleta_seg_qui`), a abertura e o
-- fechamento da coleta e a gravação dos anúncios. Esta migração liga o worker
-- (apps/workers/src/mercado) a isso, sem mudar nenhuma regra de veracidade:
--
--   1. `mercado_fontes.coletor`: o nome do coletor do worker em cada fonte que
--      tem coletor portado. Só diz COMO coletar; QUEM pode continua sendo
--      `pode_coletar` (liberada, não PROIBIDA, sem reconferência), decisão do
--      dono. Nenhuma fonte é liberada aqui. O Obrasgov.br passa a "rodada":
--      a leitura dele vai em ciclos de 20 minutos e precisa continuar na
--      rodada seguinte; o ciclo inteiro continua semanal (o coletor só
--      recomeça um ciclo fechado depois de 6 dias). O Overpass (`osm-overpass`)
--      fica SEM coletor: o robots.txt dele fecha /api/ ("Disallow: /api/") e o
--      worker respeita o robots, então a rodada pararia com erro toda segunda e
--      quinta. As proximidades esperam o dono escolher outra fonte (o extrato
--      da Geofabrik, já PERMITIDA, lido na máquina, ou um Overpass próprio).
--   2. `public.mercado_anuncios_vistos`: o anúncio que o site ainda lista no
--      mapa do site, mas que o rodízio não releu nesta rodada, continua no ar
--      (sem isso, quem não foi relido ganharia falta e sairia do ar à toa).
--   3. `public.mercado_coleta_fechar_por_consulta`: fecha a rodada dando falta
--      só aos anúncios de consulta lida até o fim (uma busca interrompida não
--      diz nada sobre quem saiu) e em que esta coleta viu pelo menos um
--      anúncio (consulta "completa" vazia é site que mudou de formato, não
--      site sem imóvel), e chama `public.mercado_coleta_fechar`.
--   4. `public.mercado_proximidades_gravar`: o upsert das proximidades (os
--      índices únicos são parciais, e a API não sabe usar índice parcial no
--      "on conflict").
--   5. `public.mercado_pos_rodada`: depois que a fila esvazia, fecha coleta
--      abandonada (worker que caiu no meio), refaz a veracidade e, na segunda,
--      sorteia a amostra da semana (o sorteio é um por semana: o pg_cron das
--      12h, que continua, não sorteia de novo).
--   6. `public.mercado_worker_estado`: o que o worker confere antes de rodar
--      (empresa, chave `mercado.ligado`, a fila, e se a fonte já está sendo
--      coletada). Só leitura. O ensaio (`--fonte=<id> --ensaio`), que não abre
--      coleta, passa por ela: com a chave desligada, nenhum pedido sai.
--   7. `public.mercado_coleta_abrir_worker`: abre a coleta automática de uma
--      fonte só se não houver outra "rodando" dela (menos de 3 horas), com uma
--      trava por fonte. Uma `--fonte=<id>` à mão durante a rodada da fila, ou
--      duas cópias do worker, não dobram o ritmo de pedidos ao site.
--
-- A dead-letter: `mercado_coleta` manda para `mercado_dlq` (coluna
-- `ingest_queues.dlq`), porque `app.esteira_falhar` respeita a dlq de cada
-- fila desde a migração 20260905000200 (o pgTAP 194 prova).
--
-- Tudo só `service_role` (o worker). Na KOMUNE não cria nada (o worker vê que
-- `mercado_worker_estado` não existe e sai sem bater ponto).
--
-- COMO DESFAZER (no banco da Imova):
--   drop function if exists public.mercado_anuncios_vistos(bigint, text[]),
--     public.mercado_coleta_fechar_por_consulta(bigint, text[], text, jsonb, text),
--     public.mercado_proximidades_gravar(bigint, jsonb), public.mercado_pos_rodada(),
--     public.mercado_worker_estado(text), public.mercado_coleta_abrir_worker(text, text, jsonb);
--   update public.mercado_fontes set coletor = null
--    where id in ('lopes', 'catalogue-imoveis', 'primore-imoveis', 'marta-de-graglia-imoveis', 'zil-monteiro',
--                 'tatiana-maia-imoveis', 'jl-imoveis-rn', 'ibeda', 'imobinova-pipa', 'abreu-imoveis',
--                 'feeds-imobiliarias', 'dom-natal', 'obrasgov');
--   (o Chaves na Mão, a Fipe, o Banco Central, o SICONFI, A Corrida e o GeoMapas
--   já nascem com o coletor na 20261118210000: o update aqui não muda nada neles.)
--   update public.mercado_fontes set frequencia = 'semanal' where id = 'obrasgov';
-- =====================================================================

do $worker$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A inteligência de mercado é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. Os coletores do worker em cada fonte
-- =====================================================================
update public.mercado_fontes f
   set coletor = v.coletor, atualizada_em = now()
  from (values
          ('chavesnamao-mcp', 'anuncios/chavesnamao'),
          ('lopes', 'anuncios/lopes'),
          ('catalogue-imoveis', 'anuncios/catalogue'),
          ('primore-imoveis', 'anuncios/imobibrasil'),
          ('marta-de-graglia-imoveis', 'anuncios/imobibrasil'),
          ('zil-monteiro', 'anuncios/imobibrasil'),
          ('tatiana-maia-imoveis', 'anuncios/imobibrasil'),
          ('jl-imoveis-rn', 'anuncios/imobibrasil'),
          ('ibeda', 'anuncios/ibeda'),
          ('imobinova-pipa', 'anuncios/imobinova'),
          ('abreu-imoveis', 'anuncios/abreu'),
          ('feeds-imobiliarias', 'anuncios/feeds'),
          ('fipezap-planilha', 'fipezap'),
          ('bcb', 'bcb'),
          ('siconfi', 'siconfi'),
          ('corrida-dos-bairros', 'corrida'),
          ('geomapas-natal', 'construcao'),
          ('dom-natal', 'obras/dom-natal'),
          ('obrasgov', 'obras/obrasgov')
          -- ('osm-overpass', 'proximidades'): fora até o dono escolher a fonte (ver o cabeçalho).
       ) as v(id, coletor)
 where f.id = v.id
   and f.veredito <> 'PROIBIDA'
   and f.coletor is distinct from v.coletor;

update public.mercado_fontes
   set frequencia = 'rodada', atualizada_em = now()
 where id = 'obrasgov' and frequencia = 'semanal';

-- =====================================================================
-- 2. Visto no mapa do site, não relido: continua no ar
-- =====================================================================
create or replace function public.mercado_anuncios_vistos(p_coleta bigint, p_ids text[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c    public.mercado_coletas;
  v_n  int := 0;
begin
  if not app.mercado_ligado() then
    return 0;
  end if;
  select * into c from public.mercado_coletas where id = p_coleta;
  if not found or c.situacao <> 'rodando' or c.origem <> 'auto' then
    return 0;
  end if;
  if coalesce(cardinality(p_ids), 0) = 0 then
    return 0;
  end if;
  if cardinality(p_ids) > 20000 then
    raise exception 'Lote grande demais (% ids): mande até 20.000 por vez.', cardinality(p_ids) using errcode = '22023';
  end if;
  update public.mercado_anuncios a
     set ultima_vez_visto = greatest(now(), a.primeira_vez_visto),
         ultima_coleta_id = c.id,
         faltas = 0
   where a.fonte = c.fonte
     and a.id_externo = any (p_ids)
     and a.origem = 'auto'
     and a.saiu_do_ar_em is null
     and a.ultima_coleta_id <> c.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function public.mercado_anuncios_vistos(bigint, text[]) is
  'O anúncio que a fonte ainda lista (mapa do site), mas que o rodízio não releu nesta rodada, continua no ar: renova a última vez visto e zera as faltas. Só anúncio já gravado pela coleta automática; nunca cria anúncio nem muda preço. Só o worker.';
revoke all on function public.mercado_anuncios_vistos(bigint, text[]) from public, anon, authenticated;
grant execute on function public.mercado_anuncios_vistos(bigint, text[]) to service_role;

-- =====================================================================
-- 3. Fechar dando falta só a quem era de consulta completa
-- =====================================================================
create or replace function public.mercado_coleta_fechar_por_consulta(
  p_id bigint, p_consultas text[], p_erro text default null,
  p_detalhes jsonb default null, p_hash_bruto text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c          public.mercado_coletas;
  v_faltas   int := 0;
  v_saidas   int := 0;
  v_ok       boolean := nullif(btrim(coalesce(p_erro, '')), '') is null;
  v_r        jsonb;
  v_vistas   text[] := '{}'::text[];
  v_vazias   int := 0;
begin
  select * into c from public.mercado_coletas where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'coleta_desconhecida');
  end if;
  if c.situacao <> 'rodando' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_fechada', 'situacao', c.situacao);
  end if;
  if p_hash_bruto is not null and lower(p_hash_bruto) !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'motivo', 'hash_invalido');
  end if;

  -- Falta só para anúncio automático, no ar, de uma consulta que esta rodada
  -- leu até o fim e em que ele não apareceu. Rodada com erro não tira ninguém.
  -- E a mesma trava de `mercado_coleta_fechar` ("uma rodada que não viu nenhum
  -- anúncio não tira ninguém do ar"), por consulta: só vale a consulta em que
  -- ESTA coleta viu pelo menos um anúncio (gravado ou "visto no mapa"). Um
  -- site que mudou de formato devolve a lista vazia e o coletor pode achar que
  -- leu tudo; sem esta trava, em duas rodadas a fonte inteira sairia do ar.
  if v_ok and c.origem = 'auto' and coalesce(cardinality(p_consultas), 0) > 0 then
    select coalesce(array_agg(q.consulta), '{}'::text[]) into v_vistas
      from (select distinct x as consulta from unnest(p_consultas) x) q
     where exists (select 1 from public.mercado_anuncios v
                    where v.fonte = c.fonte and v.ultima_coleta_id = c.id and v.consulta_id = q.consulta);
    v_vazias := (select count(distinct x)::int from unnest(p_consultas) x) - cardinality(v_vistas);
  end if;
  if cardinality(v_vistas) > 0 then
    update public.mercado_anuncios a
       set faltas = a.faltas + 1
     where a.fonte = c.fonte
       and a.origem = 'auto'
       and a.saiu_do_ar_em is null
       and a.consulta_id = any (v_vistas)
       and a.ultima_coleta_id <> c.id
       and a.ultima_vez_visto < c.inicio;
    get diagnostics v_faltas = row_count;
    update public.mercado_anuncios a
       set saiu_do_ar_em = now()
     where a.fonte = c.fonte
       and a.origem = 'auto'
       and a.saiu_do_ar_em is null
       and a.consulta_id = any (v_vistas)
       and a.faltas >= app.mercado_regra_num('{saida_rodadas}', 2);
    get diagnostics v_saidas = row_count;
  end if;

  -- O fechamento de sempre (com a veracidade), sem a falta "da fonte inteira".
  v_r := public.mercado_coleta_fechar(
           p_id, p_erro, null,
           coalesce(case when jsonb_typeof(p_detalhes) = 'object' then p_detalhes end, '{}'::jsonb)
             || jsonb_build_object('consultas_completas', coalesce(cardinality(p_consultas), 0),
                                   'consultas_completas_vazias', v_vazias,
                                   'faltaram', v_faltas, 'sairam_do_ar', v_saidas),
           false, p_hash_bruto);
  return v_r || jsonb_build_object('faltaram', v_faltas, 'sairam_do_ar', v_saidas, 'consultas_completas_vazias', v_vazias);
end $$;
comment on function public.mercado_coleta_fechar_por_consulta(bigint, text[], text, jsonb, text) is
  'Fecha a rodada do worker: dá falta só aos anúncios automáticos de consulta lida até o fim, em que esta coleta viu pelo menos um anúncio, e em que eles não apareceram (com 2 faltas, saem do ar); chama mercado_coleta_fechar (que roda a veracidade). Com erro, ou consulta "completa" vazia, ninguém ganha falta. Só o worker.';
revoke all on function public.mercado_coleta_fechar_por_consulta(bigint, text[], text, jsonb, text) from public, anon, authenticated;
grant execute on function public.mercado_coleta_fechar_por_consulta(bigint, text[], text, jsonb, text) to service_role;

-- =====================================================================
-- 4. Proximidades: upsert pelos índices parciais
-- =====================================================================
-- Cada item: {"imovel_codigo": "AP0001"} OU {"mercado_anuncio_id": "<uuid>"},
-- mais categoria, osm_tipo, osm_id, osm_versao, osm_timestamp, etiqueta, nome,
-- lat, lng, distancia_m, precisao_ponto, url e data_dado. A fonte é a da
-- coleta; o contrato V0 (gatilho) confere fonte, coleta aberta e link, e
-- calcula a validade.
create or replace function public.mercado_proximidades_gravar(p_coleta bigint, p_itens jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c    public.mercado_coletas;
  x    jsonb;
  v_n  int := 0;
begin
  if not app.mercado_ligado() then
    return 0;
  end if;
  select * into c from public.mercado_coletas where id = p_coleta;
  if not found or c.situacao <> 'rodando' then
    raise exception 'A coleta % não está aberta.', p_coleta using errcode = '22023';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' then
    raise exception 'O lote de proximidades precisa ser uma lista.' using errcode = '22023';
  end if;
  for x in select e from jsonb_array_elements(p_itens) e loop
    if nullif(x ->> 'imovel_codigo', '') is not null then
      insert into public.mercado_proximidades as p
        (imovel_codigo, categoria, osm_tipo, osm_id, osm_versao, osm_timestamp, etiqueta, nome, lat, lng,
         distancia_m, precisao_ponto, fonte, url, data_dado, valido_ate, coleta_id)
      values
        (x ->> 'imovel_codigo', x ->> 'categoria', x ->> 'osm_tipo', (x ->> 'osm_id')::bigint,
         nullif(x ->> 'osm_versao', '')::int, nullif(x ->> 'osm_timestamp', '')::timestamptz, x ->> 'etiqueta',
         left(nullif(x ->> 'nome', ''), 200), nullif(x ->> 'lat', '')::numeric, nullif(x ->> 'lng', '')::numeric,
         (x ->> 'distancia_m')::int, x ->> 'precisao_ponto', c.fonte, x ->> 'url', (x ->> 'data_dado')::date, null, c.id)
      on conflict (imovel_codigo, categoria, osm_tipo, osm_id) where imovel_codigo is not null do update
        set osm_versao = excluded.osm_versao, osm_timestamp = excluded.osm_timestamp, etiqueta = excluded.etiqueta,
            nome = excluded.nome, lat = excluded.lat, lng = excluded.lng, distancia_m = excluded.distancia_m,
            precisao_ponto = excluded.precisao_ponto, fonte = excluded.fonte, url = excluded.url,
            data_dado = excluded.data_dado, coletado_em = now(), valido_ate = null, coleta_id = excluded.coleta_id;
    elsif nullif(x ->> 'mercado_anuncio_id', '') is not null then
      insert into public.mercado_proximidades as p
        (mercado_anuncio_id, categoria, osm_tipo, osm_id, osm_versao, osm_timestamp, etiqueta, nome, lat, lng,
         distancia_m, precisao_ponto, fonte, url, data_dado, valido_ate, coleta_id)
      values
        ((x ->> 'mercado_anuncio_id')::uuid, x ->> 'categoria', x ->> 'osm_tipo', (x ->> 'osm_id')::bigint,
         nullif(x ->> 'osm_versao', '')::int, nullif(x ->> 'osm_timestamp', '')::timestamptz, x ->> 'etiqueta',
         left(nullif(x ->> 'nome', ''), 200), nullif(x ->> 'lat', '')::numeric, nullif(x ->> 'lng', '')::numeric,
         (x ->> 'distancia_m')::int, x ->> 'precisao_ponto', c.fonte, x ->> 'url', (x ->> 'data_dado')::date, null, c.id)
      on conflict (mercado_anuncio_id, categoria, osm_tipo, osm_id) where mercado_anuncio_id is not null do update
        set osm_versao = excluded.osm_versao, osm_timestamp = excluded.osm_timestamp, etiqueta = excluded.etiqueta,
            nome = excluded.nome, lat = excluded.lat, lng = excluded.lng, distancia_m = excluded.distancia_m,
            precisao_ponto = excluded.precisao_ponto, fonte = excluded.fonte, url = excluded.url,
            data_dado = excluded.data_dado, coletado_em = now(), valido_ate = null, coleta_id = excluded.coleta_id;
    else
      raise exception 'Proximidade sem imóvel nosso nem anúncio.' using errcode = '22023';
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
comment on function public.mercado_proximidades_gravar(bigint, jsonb) is
  'Grava (upsert) as proximidades de uma coleta aberta do OpenStreetMap, por imóvel nosso ou por anúncio. O contrato V0 confere a fonte, a coleta e o link e calcula a validade (90 dias; costa 180). Só o worker.';
revoke all on function public.mercado_proximidades_gravar(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.mercado_proximidades_gravar(bigint, jsonb) to service_role;

-- =====================================================================
-- 5. Depois da rodada
-- =====================================================================
create or replace function public.mercado_pos_rodada()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c          record;
  v_abandon  int := 0;
  v_verif    jsonb;
  v_amostra  int := null;
  v_na_fila  bigint := 0;
begin
  if not app.mercado_ligado() then
    return jsonb_build_object('ok', false, 'motivo', 'desligado');
  end if;
  -- Coleta aberta há mais de 3 horas é de um worker que caiu: fecha com erro
  -- (ninguém ganha falta e nada do que ela viu é apagado).
  for c in
    select id from public.mercado_coletas
     where situacao = 'rodando' and inicio < now() - interval '3 hours'
     order by id
  loop
    perform public.mercado_coleta_fechar(c.id, 'abandonada: o worker parou no meio da rodada', null,
                                         jsonb_build_object('fechada_por', 'mercado_pos_rodada'), false, null);
    v_abandon := v_abandon + 1;
  end loop;

  v_verif := app.mercado_verificar();

  -- Na segunda, com a fila vazia (todas as fontes da manhã já passaram), a
  -- amostra da semana sai. Um sorteio por semana: se já houver, não refaz.
  select count(*) into v_na_fila from pgmq.q_mercado_coleta;
  if extract(isodow from app.mercado_hoje()) = 1 and v_na_fila = 0 then
    v_amostra := app.mercado_sortear_amostra();
  end if;

  return jsonb_build_object('ok', true, 'abandonadas', v_abandon, 'veracidade', v_verif,
                            'na_fila', v_na_fila, 'amostra_sorteada', v_amostra);
end $$;
comment on function public.mercado_pos_rodada() is
  'Depois que a fila da coleta esvazia: fecha coleta abandonada (mais de 3 h aberta), refaz a veracidade e, na segunda com a fila vazia, sorteia a amostra da semana (uma por semana). Com a chave desligada, nada. Só o worker.';
revoke all on function public.mercado_pos_rodada() from public, anon, authenticated;
grant execute on function public.mercado_pos_rodada() to service_role;

-- =====================================================================
-- 6. O estado que o worker confere antes de rodar
-- =====================================================================
create or replace function public.mercado_worker_estado(p_fonte text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'empresa', (select i.empresa::text from app.identidade i limit 1),
    'ligado', app.mercado_ligado(),
    'fila', exists (select 1 from public.ingest_queues q where q.name = 'mercado_coleta'),
    'rodando', case when p_fonte is null then null else exists (
                 select 1 from public.mercado_coletas c
                  where c.fonte = lower(btrim(p_fonte)) and c.origem = 'auto' and c.situacao = 'rodando'
                    and c.inicio > now() - interval '3 hours') end)
$$;
comment on function public.mercado_worker_estado(text) is
  'Só leitura, para o worker de mercado: a empresa do banco, a chave mercado.ligado, se a fila mercado_coleta existe e se a fonte dada já tem coleta automática rodando (menos de 3 h). O ensaio não roda com a chave desligada. Só o worker.';
revoke all on function public.mercado_worker_estado(text) from public, anon, authenticated;
grant execute on function public.mercado_worker_estado(text) to service_role;

-- =====================================================================
-- 7. Uma coleta automática por fonte de cada vez
-- =====================================================================
create or replace function public.mercado_coleta_abrir_worker(
  p_fonte text, p_coletor_versao text, p_detalhes jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fonte text := lower(btrim(coalesce(p_fonte, '')));
  v_id    bigint;
begin
  -- A trava vale até o fim desta chamada (a transação da API): duas aberturas
  -- ao mesmo tempo da mesma fonte esperam uma pela outra, e a segunda já vê a
  -- primeira "rodando".
  perform pg_advisory_xact_lock(hashtextextended('mercado_coleta_abrir:' || v_fonte, 0));
  select c.id into v_id
    from public.mercado_coletas c
   where c.fonte = v_fonte and c.origem = 'auto' and c.situacao = 'rodando'
     and c.inicio > now() - interval '3 hours'
   order by c.id desc
   limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_rodando', 'coleta_id', v_id);
  end if;
  return public.mercado_coleta_abrir(v_fonte, null, 'auto', p_coletor_versao, p_detalhes);
end $$;
comment on function public.mercado_coleta_abrir_worker(text, text, jsonb) is
  'Abre a coleta automática de uma fonte (public.mercado_coleta_abrir, com todas as travas dela) só se não houver outra rodando da mesma fonte há menos de 3 horas; senão, ja_rodando. A coleta abandonada (mais de 3 h) é fechada pelo pós-rodada. Só o worker.';
revoke all on function public.mercado_coleta_abrir_worker(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mercado_coleta_abrir_worker(text, text, jsonb) to service_role;

  $ddl$;
end $worker$;

notify pgrst, 'reload schema';

-- =====================================================================
-- pgTAP — O worker de mercado (migração 20261119169000)
--
-- Prova as portas que o comando `mercado` dos workers usa, e que a gravação
-- dele é idempotente:
--
--   1. OS COLETORES: cada fonte com coletor portado aponta para ele; nenhuma
--      PROIBIDA ganha coletor; nada foi liberado; o Obrasgov.br virou
--      "rodada" (o ciclo continua na rodada seguinte); o Overpass fica sem
--      coletor (o robots.txt dele fecha /api/);
--   2. O UPSERT DOS ANÚNCIOS: o mesmo lote duas vezes não duplica (a segunda
--      vez só atualiza) e o histórico de preço só cresce quando o preço muda;
--   3. VISTO NO MAPA: o anúncio listado e não relido continua no ar; o que
--      nunca foi gravado não é criado;
--   4. A FALTA POR CONSULTA: só ganha falta quem era de consulta lida até o
--      fim; com 2 rodadas, sai do ar; rodada com erro não tira ninguém;
--      consulta "completa" em que a coleta não viu nenhum anúncio (site que
--      mudou de formato) não dá falta a ninguém;
--   5. AS PROXIMIDADES: o upsert pelos índices parciais não duplica e o V0
--      calcula a validade; os ÍNDICES e as OBRAS pelo mesmo upsert que o
--      worker manda pela API (todas as colunas, com fonte, coleta e hora): não
--      duplicam, a mesma chave duas vezes num lote quebra o lote (por isso o
--      worker tira os repetidos antes) e obra de fonte não liberada é recusada
--      pelo V0;
--   6. UMA COLETA POR FONTE: a abertura do worker recusa a segunda coleta da
--      mesma fonte (`ja_rodando`) e o estado diz empresa, chave, fila e
--      "rodando";
--   7. O PÓS-RODADA: fecha coleta abandonada e roda a veracidade; desligado,
--      não faz nada;
--   8. A DEAD-LETTER: depois de 3 falhas, o pedido de coleta vai para a
--      `mercado_dlq` (a dlq da fila em `ingest_queues`), não para a
--      `ingest_dlq`;
--   9. A GRADE: só o worker (`service_role`) chama as funções novas.
--
-- Vira Imova dentro da transação (como o 190) e desfaz tudo no fim.
-- =====================================================================
begin;

do $$
begin
  if to_regprocedure('public.mercado_pos_rodada()') is null then
    raise exception 'pgTAP 194 é da Imova: rode num banco com as migrações de mercado e a 20261119169000';
  end if;
end $$;

select plan(45);

create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;
select pg_temp.virar('imova');

update public.app_settings set value = value || '{"ligado": true}'::jsonb where key = 'mercado';

create function pg_temp.an(p_id text, p_preco bigint, p_consulta text) returns jsonb language sql as $$
  select jsonb_build_object('id_externo', p_id, 'url', 'https://www.chavesnamao.com.br/imovel/' || p_id,
                            'modo', 'venda', 'tipo', 'terreno', 'preco', p_preco, 'area_total', 450,
                            'bairro', 'Capim Macio', 'cidade', 'Natal', 'consulta_id', p_consulta,
                            'consulta_completa', true, 'hash_bruto', repeat('a', 64))
$$;

create temp table t194 (chave text primary key, valor text);

-- Volta o relógio da rodada anterior (a transação tem um now() só): a coleta,
-- os anúncios e o histórico de preço ficam "dias antes" da rodada seguinte.
create function pg_temp.voltar(p_coleta text, p_dias int) returns void language plpgsql as $$
begin
  update public.mercado_coletas set inicio = inicio - make_interval(days => p_dias), fim = fim - make_interval(days => p_dias)
   where id = (select valor::bigint from t194 where chave = p_coleta);
  update public.mercado_anuncios set ultima_vez_visto = ultima_vez_visto - make_interval(days => p_dias),
         primeira_vez_visto = primeira_vez_visto - make_interval(days => p_dias)
   where id_externo like 'w194-%';
  update public.mercado_anuncio_precos p set visto_em = p.visto_em - make_interval(days => p_dias)
    from public.mercado_anuncios a where a.id = p.anuncio_id and a.id_externo like 'w194-%';
end $$;

-- ---------------------------------------------------------------------
-- 1. Os coletores na lista
-- ---------------------------------------------------------------------
select is((select coletor from public.mercado_fontes where id = 'chavesnamao-mcp'), 'anuncios/chavesnamao',
          'o Chaves na Mão (MCP oficial) aponta para o coletor do worker');
select is((select count(*)::int from public.mercado_fontes
            where id in ('primore-imoveis', 'marta-de-graglia-imoveis', 'zil-monteiro', 'tatiana-maia-imoveis', 'jl-imoveis-rn')
              and coletor = 'anuncios/imobibrasil'), 5,
          'os 5 sites da mesma plataforma apontam para o mesmo coletor');
select is((select coletor from public.mercado_fontes where id = 'osm-overpass'), null,
          'o Overpass fica sem coletor: o robots.txt dele fecha /api/ (as proximidades esperam o dono escolher a fonte)');
select is((select count(*)::int from public.mercado_fontes where veredito = 'PROIBIDA' and coletor is not null), 0,
          'nenhuma fonte PROIBIDA tem coletor');
select is((select count(*)::int from public.mercado_fontes
            where id in ('lopes', 'catalogue-imoveis', 'ibeda', 'abreu-imoveis', 'imobinova-pipa', 'corrida-dos-bairros') and liberada), 0,
          'a migração não libera fonte nenhuma: os sites CONDICIONAIS esperam o dono');
select is((select frequencia from public.mercado_fontes where id = 'obrasgov'), 'rodada',
          'o Obrasgov.br roda toda rodada (o coletor continua o ciclo e só recomeça depois de 6 dias)');

-- ---------------------------------------------------------------------
-- 2. O upsert dos anúncios é idempotente
-- ---------------------------------------------------------------------
insert into t194 values ('c1', (public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'mercado-worker@teste') ->> 'coleta_id'));
select is((public.mercado_anuncios_registrar((select valor::bigint from t194 where chave = 'c1'),
             jsonb_build_array(pg_temp.an('w194-1', 500000, 'busca-a'), pg_temp.an('w194-2', 600000, 'busca-a'),
                               pg_temp.an('w194-3', 700000, 'busca-b'))) ->> 'novos')::int, 3,
          'o primeiro lote grava 3 anúncios novos');
select is((public.mercado_anuncios_registrar((select valor::bigint from t194 where chave = 'c1'),
             jsonb_build_array(pg_temp.an('w194-1', 500000, 'busca-a'), pg_temp.an('w194-2', 600000, 'busca-a'),
                               pg_temp.an('w194-3', 700000, 'busca-b'))) ->> 'atualizados')::int, 3,
          'o mesmo lote de novo só atualiza (nenhum novo)');
select is((select count(*)::int from public.mercado_anuncios where fonte = 'chavesnamao-mcp' and id_externo like 'w194-%'), 3,
          'continuam 3 anúncios (fonte + id externo é a identidade)');
select is((select count(*)::int from public.mercado_anuncio_precos p join public.mercado_anuncios a on a.id = p.anuncio_id
            where a.id_externo = 'w194-1'), 1,
          'o preço igual não cria histórico novo');

-- ---------------------------------------------------------------------
-- 3 e 4. Visto no mapa e falta por consulta
-- ---------------------------------------------------------------------
select is((public.mercado_coleta_fechar_por_consulta((select valor::bigint from t194 where chave = 'c1'),
             array['busca-a', 'busca-b'], null, '{"teste": 194}'::jsonb, repeat('b', 64)) ->> 'situacao'), 'ok',
          'a primeira rodada fecha ok');
-- Rodada 2: só w194-1 aparece na busca-a; a busca-b foi interrompida; w194-3 só foi "visto no mapa".
-- O relógio da transação é o mesmo: a coleta 1 fica "antes" da 2.
select pg_temp.voltar('c1', 2);
insert into t194 values ('c2', (public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'mercado-worker@teste') ->> 'coleta_id'));
select public.mercado_anuncios_registrar((select valor::bigint from t194 where chave = 'c2'),
                                         jsonb_build_array(pg_temp.an('w194-1', 480000, 'busca-a')));
select is((select count(*)::int from public.mercado_anuncio_precos p join public.mercado_anuncios a on a.id = p.anuncio_id
            where a.id_externo = 'w194-1'), 2,
          'o preço que mudou (500 mil para 480 mil) entra no histórico');
select is(public.mercado_anuncios_vistos((select valor::bigint from t194 where chave = 'c2'), array['w194-3', 'w194-nunca-gravado']), 1,
          'visto no mapa: só o anúncio já gravado é renovado (o que nunca foi lido não é criado)');
select is((select count(*)::int from public.mercado_anuncios where id_externo = 'w194-nunca-gravado'), 0,
          'nenhum anúncio nasce de "visto no mapa"');
select is((public.mercado_coleta_fechar_por_consulta((select valor::bigint from t194 where chave = 'c2'),
             array['busca-a'], null, '{}'::jsonb, null) ->> 'faltaram')::int, 1,
          'na consulta completa, quem faltou (w194-2) ganha uma falta');
select is((select faltas::int from public.mercado_anuncios where id_externo = 'w194-3'), 0,
          'o anúncio de consulta interrompida (e visto no mapa) não ganha falta');
select ok((select saiu_do_ar_em is null from public.mercado_anuncios where id_externo = 'w194-2'),
          'uma falta ainda não tira do ar');

-- Rodada 3, com ERRO: ninguém ganha falta.
select pg_temp.voltar('c2', 1);
insert into t194 values ('c3', (public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'mercado-worker@teste') ->> 'coleta_id'));
select public.mercado_anuncios_registrar((select valor::bigint from t194 where chave = 'c3'),
                                         jsonb_build_array(pg_temp.an('w194-1', 480000, 'busca-a')));
select is((public.mercado_coleta_fechar_por_consulta((select valor::bigint from t194 where chave = 'c3'),
             array['busca-a'], 'HTTP 429 (o site pediu para parar)', '{}'::jsonb, null) ->> 'faltaram')::int, 0,
          'rodada com erro não dá falta a ninguém');
select is((select situacao from public.mercado_coletas where id = (select valor::bigint from t194 where chave = 'c3')), 'erro',
          'e fica registrada como erro');

-- Rodada 4, boa: a segunda falta tira do ar.
select pg_temp.voltar('c3', 1);
insert into t194 values ('c4', (public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'mercado-worker@teste') ->> 'coleta_id'));
select public.mercado_anuncios_registrar((select valor::bigint from t194 where chave = 'c4'),
                                         jsonb_build_array(pg_temp.an('w194-1', 480000, 'busca-a')));
select is((public.mercado_coleta_fechar_por_consulta((select valor::bigint from t194 where chave = 'c4'),
             array['busca-a'], null, '{}'::jsonb, null) ->> 'sairam_do_ar')::int, 1,
          'com 2 rodadas completas sem aparecer, sai do ar');
select is((select count(*)::int from public.mercado_anuncio_precos p join public.mercado_anuncios a on a.id = p.anuncio_id
            where a.id_externo = 'w194-1'), 2,
          'o mesmo preço em rodadas seguintes não cria histórico');
select is(public.mercado_coleta_fechar_por_consulta((select valor::bigint from t194 where chave = 'c4'),
            array['busca-a'], null, '{}'::jsonb, null) ->> 'motivo', 'ja_fechada',
          'fechar duas vezes não dá falta duas vezes');

-- Rodada 5: w194-5 entra na busca-c. Rodada 6: o site mudou de formato, a
-- busca-c veio vazia, mas o coletor disse "completa". Ninguém ganha falta.
select pg_temp.voltar('c4', 1);
insert into t194 values ('c5', (public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'mercado-worker@teste') ->> 'coleta_id'));
select public.mercado_anuncios_registrar((select valor::bigint from t194 where chave = 'c5'),
                                         jsonb_build_array(pg_temp.an('w194-1', 480000, 'busca-a'), pg_temp.an('w194-5', 390000, 'busca-c')));
select public.mercado_coleta_fechar_por_consulta((select valor::bigint from t194 where chave = 'c5'),
                                                 array['busca-a', 'busca-c'], null, '{}'::jsonb, null);
select pg_temp.voltar('c5', 1);
insert into t194 values ('c6', (public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'mercado-worker@teste') ->> 'coleta_id'));
select public.mercado_anuncios_registrar((select valor::bigint from t194 where chave = 'c6'),
                                         jsonb_build_array(pg_temp.an('w194-1', 480000, 'busca-a')));
insert into t194 values ('f6', public.mercado_coleta_fechar_por_consulta((select valor::bigint from t194 where chave = 'c6'),
                                                                         array['busca-a', 'busca-c'], null, '{}'::jsonb, null)::text);
select is((select (valor::jsonb ->> 'faltaram')::int from t194 where chave = 'f6'), 0,
          'consulta "completa" sem nenhum anúncio visto nesta coleta não dá falta (site que mudou de formato)');
select is((select (valor::jsonb ->> 'consultas_completas_vazias')::int from t194 where chave = 'f6'), 1,
          'e a coleta conta a consulta vazia, para a saúde da fonte');
select ok((select faltas = 0 and saiu_do_ar_em is null from public.mercado_anuncios where id_externo = 'w194-5'),
          'o anúncio da consulta vazia continua no ar, sem falta');

-- ---------------------------------------------------------------------
-- 5. Proximidades e índices: upsert sem duplicar
-- ---------------------------------------------------------------------
insert into t194 values ('p1', (public.mercado_coleta_abrir('osm-overpass', null, 'auto', 'mercado-worker@teste') ->> 'coleta_id'));
insert into t194 values ('anuncio', (select id::text from public.mercado_anuncios where id_externo = 'w194-1'));
create function pg_temp.prox(p_dist int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'mercado_anuncio_id', (select valor from t194 where chave = 'anuncio'), 'categoria', 'escola', 'osm_tipo', 'node',
    'osm_id', 123456, 'osm_versao', 3, 'etiqueta', 'amenity=school', 'nome', 'Escola Teste', 'lat', -5.85, 'lng', -35.2,
    'distancia_m', p_dist, 'precisao_ponto', 'exata', 'url', 'https://www.openstreetmap.org/node/123456',
    'data_dado', app.mercado_hoje()::text))
$$;
select is(public.mercado_proximidades_gravar((select valor::bigint from t194 where chave = 'p1'), pg_temp.prox(420)), 1,
          'a proximidade entra');
select is(public.mercado_proximidades_gravar((select valor::bigint from t194 where chave = 'p1'), pg_temp.prox(380)), 1,
          'a mesma proximidade de novo é atualizada');
select is((select count(*)::int || ':' || max(distancia_m)::text || ':' || max(distancia_dita_m)::text
             from public.mercado_proximidades where mercado_anuncio_id = (select valor::uuid from t194 where chave = 'anuncio')),
          '1:380:400', 'uma linha só, com a distância nova (dita "cerca de 400 m")');
select is((select valido_ate from public.mercado_proximidades where mercado_anuncio_id = (select valor::uuid from t194 where chave = 'anuncio')),
          app.mercado_hoje() + 90, 'o V0 calcula a validade (90 dias para ponto de interesse)');

-- Índices: o mesmo comando que a API monta para o `upsert` do worker
-- (`on_conflict=serie,mes`, "merge-duplicates": todas as colunas do corpo,
-- inclusive fonte, coleta e hora da coleta).
insert into t194 values ('i1', (public.mercado_coleta_abrir('bcb', null, 'auto', 'mercado-worker@teste') ->> 'coleta_id'));
create function pg_temp.upsert_indices(p_linhas jsonb) returns void language sql as $$
  insert into public.mercado_indices (serie, mes, valor, nome, unidade, local, regiao_id, sub, modo, amostra, metodo, url, obs,
                                      aproximado, fonte, coleta_id, coletado_em)
  select x.serie, x.mes, x.valor, x.nome, x.unidade, x.local, x.regiao_id, x.sub, x.modo, x.amostra, x.metodo, x.url, x.obs,
         x.aproximado, x.fonte, x.coleta_id, x.coletado_em
    from jsonb_to_recordset(p_linhas) as x(serie text, mes date, valor numeric, nome text, unidade text, local text,
                                          regiao_id text, sub text, modo text, amostra int, metodo text, url text, obs text,
                                          aproximado boolean, fonte text, coleta_id bigint, coletado_em timestamptz)
  on conflict (serie, mes) do update
     set valor = excluded.valor, nome = excluded.nome, unidade = excluded.unidade, local = excluded.local,
         regiao_id = excluded.regiao_id, sub = excluded.sub, modo = excluded.modo, amostra = excluded.amostra,
         metodo = excluded.metodo, url = excluded.url, obs = excluded.obs, aproximado = excluded.aproximado,
         fonte = excluded.fonte, coleta_id = excluded.coleta_id, coletado_em = excluded.coletado_em
$$;
create function pg_temp.indice(p_valor numeric) returns jsonb language sql as $$
  select jsonb_build_object('serie', 'bcb-teste-194', 'mes', '2026-08-01', 'valor', p_valor, 'nome', 'Juros de teste',
                            'unidade', '% ao ano', 'local', 'RN', 'regiao_id', null, 'sub', null, 'modo', null, 'amostra', null,
                            'metodo', 'API Olinda', 'url', 'https://olinda.bcb.gov.br/olinda/servico/teste', 'obs', null,
                            'aproximado', false, 'fonte', 'bcb', 'coleta_id', (select valor::bigint from t194 where chave = 'i1'),
                            'coletado_em', now())
$$;
select pg_temp.upsert_indices(jsonb_build_array(pg_temp.indice(13.86)));
select pg_temp.upsert_indices(jsonb_build_array(pg_temp.indice(13.91)));
select is((select count(*)::int || ':' || max(valor)::text from public.mercado_indices where serie = 'bcb-teste-194'), '1:13.91',
          'índices pelo upsert do worker: o ponto da série é um por mês, o segundo envio atualiza');
select throws_ok($$select pg_temp.upsert_indices(jsonb_build_array(pg_temp.indice(1), pg_temp.indice(2)))$$, '21000', null,
                 'a mesma série e mês duas vezes NO MESMO LOTE quebra o lote inteiro (por isso o worker tira os repetidos antes)');

-- Obras: o mesmo comando do upsert do worker (`on_conflict=fonte,id_externo`).
insert into t194 values ('o1', (public.mercado_coleta_abrir('dom-natal', null, 'auto', 'mercado-worker@teste') ->> 'coleta_id'));
create function pg_temp.upsert_obra(p_fonte text, p_objeto text) returns void language sql as $$
  insert into public.mercado_obras (id_externo, url, documento, tipo, fase, orgao, objeto, local_texto, bairro, cidade, regiao_id,
                                    lat, lng, precisao_ponto, unidades, valor, publicado_em, fonte, coleta_id, coletado_em)
  values ('dom-194:tirol', 'https://dom.natal.rn.gov.br/teste-194', null, 'alvara', 'em_andamento', 'SEMURB', p_objeto,
          'Rua de teste', 'Tirol', 'Natal', null, null, null, null, 12, null, app.mercado_hoje(), p_fonte,
          (select valor::bigint from t194 where chave = 'o1'), now())
  on conflict (fonte, id_externo) do update
     set url = excluded.url, tipo = excluded.tipo, fase = excluded.fase, orgao = excluded.orgao, objeto = excluded.objeto,
         local_texto = excluded.local_texto, bairro = excluded.bairro, cidade = excluded.cidade, unidades = excluded.unidades,
         publicado_em = excluded.publicado_em, coleta_id = excluded.coleta_id, coletado_em = excluded.coletado_em
$$;
select pg_temp.upsert_obra('dom-natal', 'Alvará de construção de teste');
select pg_temp.upsert_obra('dom-natal', 'Alvará de construção de teste, retificado');
select is((select count(*)::int || ':' || max(objeto) from public.mercado_obras where id_externo = 'dom-194:tirol'),
          '1:Alvará de construção de teste, retificado',
          'obras pelo upsert do worker: a mesma obra de novo atualiza, sem duplicar');
select throws_ok($$select pg_temp.upsert_obra('corrida-dos-bairros', 'Obra de fonte que não pode ser coletada')$$, '42501', null,
                 'o V0 recusa obra de fonte não liberada pelo dono');

-- ---------------------------------------------------------------------
-- 6. Uma coleta por fonte de cada vez, e o estado que o worker confere
-- ---------------------------------------------------------------------
select is(public.mercado_coleta_abrir_worker('bcb', 'mercado-worker@teste', '{}'::jsonb) ->> 'motivo', 'ja_rodando',
          'a abertura do worker recusa a segunda coleta da mesma fonte (o Banco Central já está rodando)');
insert into t194 values ('a1', public.mercado_coleta_abrir_worker('fipezap-planilha', 'mercado-worker@teste', '{}'::jsonb)::text);
select ok((select (valor::jsonb ->> 'ok')::boolean and (valor::jsonb ->> 'coleta_id') is not null from t194 where chave = 'a1'),
          'fonte sem coleta rodando: abre normalmente (com as travas de mercado_coleta_abrir)');
select is(public.mercado_coleta_abrir_worker('fipezap-planilha', 'mercado-worker@teste', '{}'::jsonb) ->> 'motivo', 'ja_rodando',
          'e a segunda abertura da mesma fonte é recusada');
select is(public.mercado_worker_estado() - 'rodando', '{"empresa": "imova", "ligado": true, "fila": true}'::jsonb,
          'o estado diz a empresa, a chave e a fila');
select is((public.mercado_worker_estado('fipezap-planilha') ->> 'rodando')::boolean, true,
          'e se a fonte já está rodando (o ensaio não roda por cima)');

-- ---------------------------------------------------------------------
-- 7. O pós-rodada
-- ---------------------------------------------------------------------
insert into t194 values ('abandonada', (public.mercado_coleta_abrir('siconfi', null, 'auto', 'mercado-worker@teste') ->> 'coleta_id'));
update public.mercado_coletas set inicio = now() - interval '4 hours' where id = (select valor::bigint from t194 where chave = 'abandonada');
insert into t194 values ('pos', public.mercado_pos_rodada()::text);
select ok((select (valor::jsonb ->> 'ok')::boolean and (valor::jsonb ->> 'abandonadas')::int >= 1 and valor::jsonb ? 'veracidade'
             from t194 where chave = 'pos'),
          'o pós-rodada fecha a coleta abandonada e roda a veracidade');
select is((select situacao || ':' || coalesce(erro, '') from public.mercado_coletas where id = (select valor::bigint from t194 where chave = 'abandonada')),
          'erro:abandonada: o worker parou no meio da rodada', 'a coleta abandonada fica como erro, com o motivo');
update public.app_settings set value = value || '{"ligado": false}'::jsonb where key = 'mercado';
select is(public.mercado_pos_rodada() ->> 'motivo', 'desligado', 'desligado, o pós-rodada não faz nada');

-- ---------------------------------------------------------------------
-- 8. A dead-letter da coleta é a mercado_dlq
-- ---------------------------------------------------------------------
insert into t194 values ('q', app.esteira_enfileirar('mercado_coleta', '{"fonte": "teste-194", "coletor": "bcb"}'::jsonb,
                                                     'mercado:teste-194:dlq') ->> 'msg_id');
select public.esteira_fila_falhar('mercado_coleta', (select valor::bigint from t194 where chave = 'q'), 'mercado:teste-194:dlq', 'falha 1');
select public.esteira_fila_falhar('mercado_coleta', (select valor::bigint from t194 where chave = 'q'), 'mercado:teste-194:dlq', 'falha 2');
insert into t194 values ('q3', public.esteira_fila_falhar('mercado_coleta', (select valor::bigint from t194 where chave = 'q'),
                                                          'mercado:teste-194:dlq', 'falha 3')::text);
select is((select (valor::jsonb ->> 'acao') || ':' || (valor::jsonb ->> 'dlq') from t194 where chave = 'q3'), 'dead_letter:mercado_dlq',
          'na terceira falha, o pedido de coleta vai para a dead-letter da própria fila');
select ok(exists (select 1 from pgmq.q_mercado_dlq d
                   where d.message ->> 'fila_de_origem' = 'mercado_coleta' and d.message ->> 'idempotency_key' = 'mercado:teste-194:dlq')
          and not exists (select 1 from pgmq.q_ingest_dlq d where d.message ->> 'idempotency_key' = 'mercado:teste-194:dlq'),
          'ele está na mercado_dlq (com o erro e a fila de origem), não na ingest_dlq');

-- ---------------------------------------------------------------------
-- 9. A grade
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.mercado_anuncios_vistos(bigint,text[])', 'execute')
          and not has_function_privilege('authenticated', 'public.mercado_coleta_fechar_por_consulta(bigint,text[],text,jsonb,text)', 'execute')
          and not has_function_privilege('authenticated', 'public.mercado_proximidades_gravar(bigint,jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.mercado_pos_rodada()', 'execute')
          and not has_function_privilege('authenticated', 'public.mercado_worker_estado(text)', 'execute')
          and not has_function_privilege('authenticated', 'public.mercado_coleta_abrir_worker(text,text,jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.mercado_pos_rodada()', 'execute')
          and not has_function_privilege('anon', 'public.mercado_coleta_abrir_worker(text,text,jsonb)', 'execute'),
          'a equipe e o anônimo não chamam as funções do worker');
select ok(has_function_privilege('service_role', 'public.mercado_anuncios_vistos(bigint,text[])', 'execute')
          and has_function_privilege('service_role', 'public.mercado_coleta_fechar_por_consulta(bigint,text[],text,jsonb,text)', 'execute')
          and has_function_privilege('service_role', 'public.mercado_proximidades_gravar(bigint,jsonb)', 'execute')
          and has_function_privilege('service_role', 'public.mercado_pos_rodada()', 'execute')
          and has_function_privilege('service_role', 'public.mercado_worker_estado(text)', 'execute')
          and has_function_privilege('service_role', 'public.mercado_coleta_abrir_worker(text,text,jsonb)', 'execute'),
          'o worker (service_role) chama as seis');

select * from finish();
rollback;

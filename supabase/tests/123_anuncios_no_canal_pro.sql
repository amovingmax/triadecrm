-- =====================================================================
-- pgTAP — Anúncios que sobem para o Canal Pro, só na Imova (migração 20261104150000)
--
-- Pedido de 04/11/2026: subir o anúncio do imóvel pelo CRM em vez de subir pelo
-- ZAP, continuando com o plano do Canal Pro. A integração oficial do Grupo OLX
-- é o arquivo VRSync lido a cada 12 h, e este arquivo prova:
--
--   1. TODOS CRIAM, A GESTÃO PUBLICA: o SDR cria e edita rascunho; pôr no ar,
--      tirar do ar, destaque, excluir e mexer em anúncio no ar é de admin e
--      gestor (decisão do usuário, porque é o que gasta a cota do plano);
--   2. O QUE O PORTAL EXIGE: anúncio com pendência não vai ao ar, e anúncio no
--      ar não é salvo com pendência (fica como estava);
--   3. AS FOTOS: só o arquivo que chegou ao balde, no caminho do anúncio; no ar,
--      nunca menos de 5; a primeira da ordem é a capa;
--   4. O ARQUIVO: sem a chave não sai nada e nada é anotado; com ela, só os
--      anúncios no ar, e a leitura do robô do Grupo OLX fica registrada;
--   5. A CHAVE NÃO SAI PARA O SDR, e o anônimo só alcança o arquivo;
--   6. OS ANÚNCIOS MANUAIS DO CANAL PRO (decisão da noite: mostrar todos e
--      migrar aos poucos): só a gestão importa o relatório; quem some dele saiu
--      do Canal Pro; trazer para o CRM cria o rascunho uma vez só; e o rascunho
--      não vai ao ar enquanto o original não for excluído no Canal Pro e marcado.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(60);

insert into public.allowed_users (email, role, note) values
  ('a123.g@teste.local', 'gestor', 'pgTAP anúncios'),
  ('a123.s@teste.local', 'sdr', 'pgTAP anúncios');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000012301'::uuid, 'a123.g@teste.local', '{"full_name":"Gina Gestora"}'),
  ('a0000000-0000-4000-8000-000000012302'::uuid, 'a123.s@teste.local', '{"full_name":"Sara SDR"}');

create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.gestor() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012301'::uuid, 'gestor')
$$;
create function pg_temp.sdr() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012302'::uuid, 'sdr')
$$;

-- O anúncio do teste e os arquivos "que chegaram" ao balde. O SDR não enxerga
-- `storage.objects`: os caminhos ficam numa tabela temporária que ele lê.
create temp table t123(chave text primary key, valor uuid);
grant select, insert on t123 to authenticated;
create temp table t123_fotos(caminho text primary key);
grant select on t123_fotos to authenticated;
create temp table t123_feed(f jsonb);
grant select, insert on t123_feed to anon;
create function pg_temp.id() returns uuid language sql stable as $$
  select valor from t123 where chave = 'anuncio'
$$;
create function pg_temp.arquivo() returns text language plpgsql as $$
declare v_caminho text := pg_temp.id()::text || '/' || gen_random_uuid()::text || '.jpg';
begin
  insert into storage.objects (bucket_id, name) values ('anuncios', v_caminho);
  insert into t123_fotos values (v_caminho);
  return v_caminho;
end $$;

-- O ponto de partida: integração sem contato, e a chave e as leituras de antes
-- guardadas para o anônimo e para a conta do fim (nem ele nem a equipe leem
-- `canal_pro`). O limite do plano (migração 20261104180000) tem teste próprio,
-- o 124: aqui ele não conta.
update public.canal_pro set nome = null, email = null, limite_anuncios = null, limite_destaques = null
 where um;
select set_config('t123.chave', (select chave from public.canal_pro), true);
select set_config('t123.leituras', (select count(*) from public.canal_pro_leituras)::text, true);
create function pg_temp.campo(p_campo text) returns text language sql stable as $$
  select to_jsonb(a) ->> p_campo from public.anuncios a where a.id = pg_temp.id()
$$;
-- O anúncio do teste dentro do arquivo baixado: o banco pode ter outros no ar.
create function pg_temp.no_arquivo() returns setof jsonb language sql stable as $$
  select a from t123_feed, jsonb_array_elements(f -> 'anuncios') a
   where a ->> 'codigo' = pg_temp.campo('codigo')
$$;

-- =====================================================================
-- 0. O que a migração criou
-- =====================================================================
select ok((select relrowsecurity from pg_class where oid = 'public.anuncios'::regclass),
  'anuncios nasce com RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.canal_pro'::regclass),
  'canal_pro nasce com RLS e sem política: só as funções a leem');
select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'anuncios'$$,
  $$values (true, 7340032::bigint, array['image/jpeg']::text[])$$,
  'o balde das fotos é público, só JPEG e até 7 MB (o limite do portal)');
select is((select area from app.anuncio_tipo('terreno')), 'total',
  'terreno manda a área total (LotArea)');
select throws_ok(
  $$insert into public.anuncios (tipo) values ('mansao_flutuante')$$, '23514', null,
  'tipo fora da lista do VRSync é recusado pelo banco');
-- Pela API, o `authenticator` do Supabase carrega o `safeupdate`, que recusa
-- UPDATE e DELETE sem WHERE, e este teste roda direto no banco, sem ele (o
-- `postgres` não pode carregá-lo). Uma função que passa aqui falharia na tela:
-- aconteceu com `canal_pro_ajustar` em 04/11/2026. Então o texto é conferido.
select is(
  (select count(*)::int
     from pg_proc p
    cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
    where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
      and (p.proname like 'anuncio%' or p.proname like 'canal_pro%')
      and comando ~* '(^|\n)\s*(update|delete)\s'
      and comando !~* '\swhere\s'),
  0, 'nenhuma função dos anúncios tem UPDATE ou DELETE sem WHERE (o safeupdate da API recusaria)');

-- =====================================================================
-- 1. Todos criam, a gestão publica
-- =====================================================================
select pg_temp.sdr();
insert into t123
select 'anuncio', (r ->> 'id')::uuid
  from (select public.anuncio_salvar('{
          "tipo": "apartamento", "negocio": "venda", "titulo": "Apto",
          "descricao": "curta", "preco_venda": 450000, "cep": "59090-000",
          "estado": "rn", "cidade": "Natal", "bairro": "Ponta Negra",
          "caracteristicas": ["Pool", " Pool", "Elevator"]}'::jsonb) as r) x;
select pg_temp.sair();

select ok(pg_temp.id() is not null, 'o SDR cria o anúncio');
select matches(pg_temp.campo('codigo'), '^IM[0-9]{4,}$', 'o anúncio ganha o código do portal, com a tag do tipo (20261110100000)');
select is(pg_temp.campo('situacao'), 'rascunho', 'e nasce como rascunho');
select is(pg_temp.campo('cep') || '/' || pg_temp.campo('estado'), '59090000/RN',
  'CEP só com números e estado em maiúscula');
select is((select caracteristicas from public.anuncios where id = pg_temp.id()),
  array['Elevator', 'Pool'], 'características sem repetição nem espaço');

select pg_temp.sdr();
select is(public.anuncio_publicar(pg_temp.id()) ->> 'motivo', 'sem_permissao',
  'o SDR não põe no ar');
select is(public.anuncio_destaque(pg_temp.id(), 'super_destaque') ->> 'motivo', 'sem_permissao',
  'nem escolhe o destaque');
select is(public.canal_pro_ajustar('Imova', 'contato@imova.test', null, null) ->> 'motivo',
  'sem_permissao', 'nem mexe no contato da imobiliária');
select ok((public.canal_pro_situacao() ->> 'chave') is null, 'e não vê a chave da URL do arquivo');
select pg_temp.sair();

-- =====================================================================
-- 2. O que o portal exige
-- =====================================================================
select pg_temp.gestor();
select is(public.anuncio_publicar(pg_temp.id()) ->> 'motivo', 'pendencias',
  'com pendência, nem a gestão põe no ar');
select ok((public.anuncio_publicar(pg_temp.id()) -> 'pendencias') ? 'pelo menos 1 foto',
  'e a recusa diz o que falta, em frase');
select ok((select pendencias from public.anuncios_na_lista where id = pg_temp.id())
            @> array['área útil', 'quartos', 'banheiros', 'nome e e-mail da imobiliária, no painel do Canal Pro'],
  'a lista mostra as pendências do tipo e da integração');
select is(public.canal_pro_ajustar('Imova Imobiliária', 'Contato@Imova.test', '(84) 99405-8888', null) ->> 'ok',
  'true', 'a gestão grava o contato da imobiliária');
select ok((public.canal_pro_situacao() ->> 'chave') ~ '^[0-9a-f]{64}$', 'e vê a chave');
select isnt(public.canal_pro_trocar_chave() ->> 'chave', current_setting('t123.chave'),
  'trocar a chave sorteia outra');
select pg_temp.sair();
select set_config('t123.chave', (select chave from public.canal_pro), true);

-- =====================================================================
-- 3. As fotos
-- =====================================================================
select pg_temp.sdr();
select is(public.anuncio_foto_adicionar(pg_temp.id(), 'outro/' || gen_random_uuid() || '.jpg') ->> 'motivo',
  'caminho_invalido', 'foto fora da pasta do anúncio é recusada');
select is(public.anuncio_foto_adicionar(pg_temp.id(), pg_temp.id() || '/' || gen_random_uuid() || '.jpg') ->> 'motivo',
  'arquivo_nao_chegou', 'foto que não chegou ao balde é recusada');
select pg_temp.sair();
select pg_temp.arquivo() from generate_series(1, 5);
select pg_temp.sdr();
select is(count(*)::int, 5, 'o SDR registra as 5 fotos que chegaram')
  from t123_fotos c
 cross join lateral public.anuncio_foto_adicionar(pg_temp.id(), c.caminho) r
 where (r ->> 'ok')::boolean;
select is(public.anuncio_salvar('{
          "tipo": "apartamento", "negocio": "venda",
          "titulo": "Apartamento de 3 quartos em Ponta Negra",
          "descricao": "Apartamento nascente, perto da praia, com varanda, piscina e duas vagas na garagem.",
          "preco_venda": 450000, "cep": "59090000", "estado": "RN", "cidade": "Natal",
          "bairro": "Ponta Negra", "endereco": "Rua Praia de Genipabu", "numero": "100",
          "area_util": 90, "quartos": 3, "banheiros": 2, "vagas": 2,
          "caracteristicas": ["Pool", "Elevator"]}'::jsonb, pg_temp.id()) -> 'pendencias', '[]'::jsonb,
  'com tudo preenchido, o rascunho fica sem pendência');
select pg_temp.sair();

select pg_temp.gestor();
select is(public.anuncio_publicar(pg_temp.id()) ->> 'ok', 'true', 'e a gestão põe no ar');
select pg_temp.sair();
select is(pg_temp.campo('situacao'), 'no_ar', 'o anúncio está no ar');

select pg_temp.sdr();
select is(public.anuncio_salvar('{"titulo": "Mudei o título do SDR"}'::jsonb, pg_temp.id()) ->> 'motivo',
  'so_gestao_mexe_no_ar', 'no ar, o SDR não edita');
select pg_temp.sair();

select pg_temp.gestor();
select is(public.anuncio_salvar('{"tipo": "apartamento", "negocio": "venda",
          "titulo": "Curto", "preco_venda": 450000}'::jsonb, pg_temp.id()) ->> 'motivo',
  'no_ar_com_pendencias', 'no ar, salvar pela metade é recusado');
select pg_temp.sair();
select is(pg_temp.campo('titulo'), 'Apartamento de 3 quartos em Ponta Negra',
  'e o anúncio fica exatamente como estava');

select pg_temp.gestor();
-- Sem mínimo além de uma (20261105160000): das 5, quatro podem sair; a última não.
select is((select string_agg(public.anuncio_foto_remover(x.id) ->> 'ok', ',')
             from (select id from public.anuncio_fotos where anuncio_id = pg_temp.id()
                    order by posicao desc limit 4) x),
  'true,true,true,true', 'no ar com 5 fotos, quatro podem sair');
select is(public.anuncio_foto_remover((select id from public.anuncio_fotos where anuncio_id = pg_temp.id() limit 1))
            ->> 'motivo', 'no_ar_ultima_foto', 'no ar, a última foto não sai');
select is(public.anuncio_fotos_ordenar(pg_temp.id(),
            (select array_agg(id order by posicao desc) from public.anuncio_fotos where anuncio_id = pg_temp.id()))
            ->> 'ok', 'true', 'a gestão muda a ordem das fotos');
select is(public.anuncio_fotos_ordenar(pg_temp.id(), array[gen_random_uuid()]) ->> 'motivo',
  'ordem_invalida', 'ordem que não é exatamente as fotos do anúncio é recusada');
select is(public.anuncio_destaque(pg_temp.id(), 'super_destaque') ->> 'ok', 'true',
  'e escolhe o destaque');
select pg_temp.sair();

-- =====================================================================
-- 4. O arquivo
-- =====================================================================
set local role anon;
select is(public.canal_pro_feed('errada', 'VivaRealBot/1.0') ->> 'ok', 'false',
  'sem a chave certa, o arquivo não sai');
reset role;
select is((select count(*)::int from public.canal_pro_leituras), current_setting('t123.leituras')::int,
  'e nada é anotado');

set local role anon;
insert into t123_feed
  select public.canal_pro_feed(current_setting('t123.chave'), 'VivaRealBot/1.0 (+http://www.vivareal.com/bot.html)');
reset role;
select is((select count(*)::int from pg_temp.no_arquivo()), 1,
  'com a chave, o anônimo recebe o anúncio no ar');
select is((select a ->> 'tipo_vrsync' || ' · ' || (a ->> 'destaque') from pg_temp.no_arquivo() a),
  'Residential / Apartment · super_destaque', 'com o tipo do VRSync e o destaque escolhido');
select is((select a #>> '{fotos,0}' from pg_temp.no_arquivo() a),
  (select caminho from public.anuncio_fotos where anuncio_id = pg_temp.id() order by posicao limit 1),
  'a primeira foto da ordem vem primeiro (a capa)');
select is((select f #>> '{imobiliaria,email}' from t123_feed), 'contato@imova.test',
  'e o contato da imobiliária vai junto');
select ok((select do_grupo_olx from public.canal_pro_leituras order by em desc limit 1),
  'a leitura do robô do Grupo OLX fica anotada');

set local role anon;
select throws_ok($$select count(*) from public.anuncios$$, '42501', null,
  'o anônimo não lê a tabela de anúncios');
reset role;

-- =====================================================================
-- 5. Tirar do ar, excluir e restaurar
-- =====================================================================
select pg_temp.gestor();
select is(public.anuncio_excluir(pg_temp.id(), '') ->> 'motivo', 'sem_motivo',
  'excluir pede o motivo');
select is(public.anuncio_excluir(pg_temp.id(), 'Imóvel vendido') ->> 'ok', 'true',
  'com motivo, exclui');
select is((select count(*)::int
             from jsonb_array_elements(public.canal_pro_feed(current_setting('t123.chave'), 'teste') -> 'anuncios') a
            where a ->> 'codigo' = pg_temp.campo('codigo')),
  0, 'o excluído sai do arquivo');
select is(public.anuncio_restaurar(pg_temp.id()) ->> 'ok', 'true', 'e volta pelo restaurar');
select pg_temp.sair();
select is(pg_temp.campo('situacao'), 'pausado', 'fora do ar: restaurar nunca põe direto no portal');

-- =====================================================================
-- 6. Os anúncios cadastrados à mão no Canal Pro
-- =====================================================================
create function pg_temp.manual(p_codigo text) returns public.anuncios_no_canal_pro
language sql stable as $$
  select * from public.anuncios_no_canal_pro where codigo = p_codigo
$$;

-- O código "PGTAP 123 - código do Canal Pro que passa de cinquenta letras" não cabe no ListingID (mais de 50 caracteres):
-- trazido para o CRM, ele ganha o código da sequência, e é esse caso, o de
-- código diferente, que pede excluir o original. O de mesmo código é do 126
-- (migração 20261105110000).
select pg_temp.gestor();
select is(public.canal_pro_importar('[
  {"codigo": "PGTAP 123 - código do Canal Pro que passa de cinquenta letras", "titulo": "Casa com 4 quartos em Capim Macio", "tipo": "Casa",
   "tipo_crm": "casa", "negocio": "venda", "preco_venda": 890000, "bairro": "Capim Macio",
   "cidade": "Natal", "area": 180, "quartos": 4, "situacao": "Ativo",
   "linha": {"Código": "PGTAP 123 - código do Canal Pro que passa de cinquenta letras"}},
  {"codigo": "PGTAP-123-2", "titulo": "Terreno", "tipo": "Terreno", "tipo_crm": "terreno",
   "preco_venda": 200000, "area": 360}]'::jsonb) ->> 'anuncios', '2',
  'a gestão importa o relatório do Canal Pro');
select is(public.canal_pro_importar('[{"titulo": "linha sem código"}]'::jsonb) ->> 'motivo',
  'relatorio_sem_codigo', 'arquivo sem a coluna do código é recusado');
select pg_temp.sair();
select ok((pg_temp.manual('PGTAP 123 - código do Canal Pro que passa de cinquenta letras')).no_relatorio and (pg_temp.manual('PGTAP-123-2')).no_relatorio,
  'e a recusa não mexe em nada');

select pg_temp.sdr();
select is(public.canal_pro_importar('[{"codigo": "X"}]'::jsonb) ->> 'motivo', 'sem_permissao',
  'o SDR não importa o relatório');
select pg_temp.sair();

select pg_temp.gestor();
select public.canal_pro_importar('[{"codigo": "PGTAP 123 - código do Canal Pro que passa de cinquenta letras", "titulo": "Casa com 4 quartos em Capim Macio",
  "tipo_crm": "casa", "negocio": "venda", "preco_venda": 890000, "area": 180, "quartos": 4,
  "bairro": "Capim Macio", "cidade": "Natal"}]'::jsonb);
select pg_temp.sair();
select ok(not (pg_temp.manual('PGTAP-123-2')).no_relatorio,
  'quem sumiu do relatório novo saiu do Canal Pro');

select pg_temp.sdr();
insert into t123
select 'trazido', (r ->> 'anuncio_id')::uuid
  from (select public.canal_pro_trazer((pg_temp.manual('PGTAP 123 - código do Canal Pro que passa de cinquenta letras')).id) as r) x;
select ok((select valor from t123 where chave = 'trazido') is not null, 'o SDR traz o anúncio manual para o CRM');
select is((select public.canal_pro_trazer((pg_temp.manual('PGTAP 123 - código do Canal Pro que passa de cinquenta letras')).id) ->> 'ja_existia'),
  'true', 'trazer de novo abre o mesmo rascunho, sem criar outro');
select pg_temp.sair();
select is((select a.tipo || ' · ' || a.situacao || ' · ' || a.preco_venda || ' · ' || a.area_util || ' · ' || a.quartos
             from public.anuncios a where a.id = (select valor from t123 where chave = 'trazido')),
  'casa · rascunho · 890000 · 180 · 4', 'o rascunho nasce com o que o relatório tinha');

select pg_temp.gestor();
select ok(app.anuncio_pendencias((select valor from t123 where chave = 'trazido'))
            @> array['excluir o original (código PGTAP 123 - código do Canal Pro que passa de cinquenta letras) no Canal Pro e marcar aqui como excluído'],
  'enquanto o original estiver no Canal Pro, o trazido não vai ao ar');
select pg_temp.sair();

select pg_temp.sdr();
select is(public.canal_pro_marcar_excluido((pg_temp.manual('PGTAP 123 - código do Canal Pro que passa de cinquenta letras')).id) ->> 'motivo', 'sem_permissao',
  'o SDR não marca o original como excluído');
select pg_temp.sair();

select pg_temp.gestor();
select public.canal_pro_marcar_excluido((pg_temp.manual('PGTAP 123 - código do Canal Pro que passa de cinquenta letras')).id);
select ok(not exists (select 1 from unnest(app.anuncio_pendencias((select valor from t123 where chave = 'trazido'))) p
                       where p like 'excluir o original%'),
  'a gestão marca o original como excluído, e a pendência sai');
select public.canal_pro_importar('[{"codigo": "PGTAP 123 - código do Canal Pro que passa de cinquenta letras", "titulo": "Casa com 4 quartos em Capim Macio"}]'::jsonb);
select pg_temp.sair();
select ok((pg_temp.manual('PGTAP 123 - código do Canal Pro que passa de cinquenta letras')).excluido_em is null,
  'se o original volta no relatório, ele está no Canal Pro: a marca de excluído cai');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — A troca da Arbo pelo CRM, segura (migração 20261119120000), só na Imova
--
-- Prova:
--   1. as coordenadas: as duas juntas, na faixa, fora do 0,0; o importador as
--      grava do arquivo e não as apaga quando o arquivo não traz (nem com valor
--      torto); salvar o anúncio não as apaga; o arquivo do Canal Pro as leva;
--   2. pôr no ar limpa `saiu_do_ar_em`, e o anúncio reposto volta à carteira;
--   3. antes da troca, o importador atualiza o anúncio no ar; depois (o robô do
--      Grupo OLX leu o arquivo do CRM), pula o anúncio no ar e devolve o
--      motivo, e o rascunho e o anúncio novo continuam vindo;
--   4. a lista diz se a linha do relatório gasta destaque, também para o SDR;
--      o rascunho que é um dos destaques do portal vai ao ar com destaque com o
--      plano "cheio", e o outro não;
--   5. a IA não vê a cópia do relatório de um código do CRM nem a linha marcada
--      como excluída;
--   6. quem executa o quê; nenhum UPDATE ou DELETE sem WHERE.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(45);

insert into public.allowed_users (email, role, note) values
  ('a187.g@teste.local', 'gestor', 'pgTAP troca da Arbo'),
  ('a187.s@teste.local', 'sdr', 'pgTAP troca da Arbo');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000018701'::uuid, 'a187.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000018702'::uuid, 'a187.s@teste.local', '{"full_name":"Sol SDR"}');

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
  select pg_temp.entrar('a0000000-0000-4000-8000-000000018701'::uuid, 'gestor')
$$;
create function pg_temp.sdr() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000018702'::uuid, 'sdr')
$$;

create temp table t187(chave text primary key, valor jsonb);
grant select, insert on t187 to authenticated;
create function pg_temp.v(p_chave text) returns jsonb language sql stable as $$
  select valor from t187 where chave = p_chave
$$;
create function pg_temp.anuncio(p_codigo text) returns public.anuncios language sql stable as $$
  select * from public.anuncios where codigo = p_codigo
$$;
grant execute on function pg_temp.anuncio(text) to authenticated;
-- O formulário completo de um anúncio do sistema atual (sem pendência fora as fotos).
create function pg_temp.completo(p_codigo text, p_titulo text) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'codigo', p_codigo, 'tipo', 'apartamento', 'negocio', 'venda', 'titulo', p_titulo,
    'descricao', 'Apartamento nascente, perto da praia, com varanda gourmet e duas vagas na garagem.',
    'preco_venda', 450000, 'cep', '59090-000', 'estado', 'RN', 'cidade', 'Natal', 'bairro', 'Ponta Negra',
    'area_util', 90, 'quartos', 3, 'banheiros', 2, 'vagas', 2, 'mostrar_endereco', 'completo')
$$;
-- Uma foto, direto na tabela (a rota sobe o arquivo; aqui só conta a linha).
create function pg_temp.foto(p_codigo text) returns void language sql as $$
  insert into public.anuncio_fotos (anuncio_id, caminho, posicao)
  select a.id, a.id::text || '/' || gen_random_uuid()::text || '.jpg', 0
    from public.anuncios a where a.codigo = p_codigo
$$;

-- O contato da imobiliária preenchido e o plano sem limite de vagas.
update public.canal_pro set nome = 'Imova Imobiliária', email = 'contato@imova.teste',
                            limite_anuncios = null, limite_destaques = null
 where um;

-- =====================================================================
-- 1. As coordenadas
-- =====================================================================
select col_type_is('public', 'anuncios', 'latitude', 'numeric(10,7)', 'a latitude, em graus, 7 casas');
select col_type_is('public', 'anuncios', 'longitude', 'numeric(10,7)', 'a longitude, em graus, 7 casas');
select throws_ok($$insert into public.anuncios (codigo, latitude, longitude) values ('T187Z1', 91, -35)$$,
  '23514', null, 'latitude fora da faixa é recusada');
select throws_ok($$insert into public.anuncios (codigo, latitude, longitude) values ('T187Z2', -6, 181)$$,
  '23514', null, 'longitude fora da faixa é recusada');
select throws_ok($$insert into public.anuncios (codigo, latitude) values ('T187Z3', -6)$$,
  '23514', null, 'uma sem a outra é recusada');
select throws_ok($$insert into public.anuncios (codigo, latitude, longitude) values ('T187Z4', 0, 0)$$,
  '23514', null, 'o 0,0 é recusado (é de quem não tem coordenada)');

select pg_temp.gestor();
insert into t187 select 'imp1', public.anuncio_importar(
  pg_temp.completo('T187A', 'Apartamento com vista para o mar')
  || '{"latitude": -6.055992499999999, "longitude": -35.1708741}');
select pg_temp.sair();
select is(pg_temp.v('imp1') ->> 'ok', 'true', 'o importador traz o anúncio com as coordenadas');
select is(((pg_temp.anuncio('T187A')).latitude, (pg_temp.anuncio('T187A')).longitude)::text,
  '(-6.0559925,-35.1708741)', 'as coordenadas do arquivo, em 7 casas');

select pg_temp.gestor();
insert into t187 select 'imp2', public.anuncio_importar(pg_temp.completo('T187A', 'Apartamento com vista para o mar'));
insert into t187 select 'imp3', public.anuncio_importar(
  pg_temp.completo('T187A', 'Apartamento com vista para o mar') || '{"latitude": 1234.5, "longitude": -35}');
insert into t187 select 'imp4', public.anuncio_importar(
  pg_temp.completo('T187A', 'Apartamento com vista para o mar') || '{"latitude": "abc", "longitude": "-35"}');
insert into t187 select 'imp5', public.anuncio_importar(
  pg_temp.completo('T187A', 'Apartamento com vista para o mar') || '{"latitude": -5.8}');
insert into t187 select 'imp6', public.anuncio_importar(
  pg_temp.completo('T187A', 'Apartamento com vista para o mar') || '{"latitude": 0, "longitude": 0}');
select pg_temp.sair();
select is((select string_agg(valor ->> 'ok', ',' order by chave) from t187 where chave in ('imp2', 'imp3', 'imp4', 'imp5', 'imp6')),
  'true,true,true,true,true', 'arquivo sem coordenada ou com coordenada torta não derruba a importação');
select is(((pg_temp.anuncio('T187A')).latitude, (pg_temp.anuncio('T187A')).longitude)::text,
  '(-6.0559925,-35.1708741)', 'e as coordenadas que o anúncio tinha ficam');

-- Salvar no editor manda o formulário sem coordenada: elas ficam.
select pg_temp.gestor();
insert into t187 select 'salvar', public.anuncio_salvar(
  pg_temp.completo('T187A', 'Apartamento com vista para o mar, salvo no editor') - 'codigo',
  (pg_temp.anuncio('T187A')).id);
select pg_temp.sair();
select is(pg_temp.v('salvar') ->> 'ok', 'true', 'o editor salva o anúncio');
select is(((pg_temp.anuncio('T187A')).latitude, (pg_temp.anuncio('T187A')).longitude)::text,
  '(-6.0559925,-35.1708741)', 'salvar não apaga as coordenadas');

-- No ar, o arquivo do Canal Pro as leva.
select pg_temp.foto('T187A');
select pg_temp.gestor();
select is(public.anuncio_publicar((pg_temp.anuncio('T187A')).id) ->> 'ok', 'true', 'o anúncio vai ao ar');
select pg_temp.sair();
insert into t187 select 'feed', public.canal_pro_feed((select chave from public.canal_pro), 'curl/8.7.1');
select is((select (a ->> 'latitude')::numeric from jsonb_array_elements(pg_temp.v('feed') -> 'anuncios') a
            where a ->> 'codigo' = 'T187A'), -6.0559925::numeric, 'o arquivo leva a latitude');
select is((select (a ->> 'longitude')::numeric from jsonb_array_elements(pg_temp.v('feed') -> 'anuncios') a
            where a ->> 'codigo' = 'T187A'), -35.1708741::numeric, 'e a longitude');
select is((select jsonb_typeof(a -> 'latitude') from jsonb_array_elements(pg_temp.v('feed') -> 'anuncios') a
            where a ->> 'codigo' = 'T187A'), 'number', 'como número');

-- =====================================================================
-- 2. Tirado do ar e reposto, volta à carteira
-- =====================================================================
select pg_temp.gestor();
select is(public.anuncio_tirar_do_ar((pg_temp.anuncio('T187A')).id) ->> 'ok', 'true', 'sai do ar');
select pg_temp.sair();
select ok((pg_temp.anuncio('T187A')).saiu_do_ar_em is not null, 'e ganha a data em que saiu');
select ok(not exists (select 1 from app.imova_carteira() k where k.codigo = 'T187A'),
  'fora do ar, não está na carteira dos relatórios');
select pg_temp.gestor();
select is(public.anuncio_publicar((pg_temp.anuncio('T187A')).id) ->> 'ok', 'true', 'volta ao ar');
select pg_temp.sair();
select ok((pg_temp.anuncio('T187A')).saiu_do_ar_em is null, 'e a data em que saiu fica vazia');
select ok(exists (select 1 from app.imova_carteira() k where k.codigo = 'T187A'),
  'de volta ao ar, volta à carteira dos relatórios');

-- =====================================================================
-- 3. Antes da troca, o importador atualiza o anúncio no ar; depois, não
-- =====================================================================
select ok(not app.canal_pro_crm_publica(), 'sem leitura do robô do Grupo OLX, o CRM ainda não publica');
select pg_temp.gestor();
insert into t187 select 'antes', public.anuncio_importar(
  pg_temp.completo('T187A', 'Apartamento com vista para o mar, do arquivo'));
insert into t187 select 'rascunhoB', public.anuncio_importar(pg_temp.completo('T187B', 'Rascunho que vem da Arbo'));
select pg_temp.sair();
select is(pg_temp.v('antes') ->> 'pulado', null, 'antes da troca, nada é pulado');
select is((pg_temp.anuncio('T187A')).titulo, 'Apartamento com vista para o mar, do arquivo',
  'e o anúncio no ar é atualizado pelo arquivo (como sempre foi)');

-- A troca: o robô do Grupo OLX lê o arquivo do CRM.
insert into t187 select 'robo', public.canal_pro_feed((select chave from public.canal_pro),
                                                      'Mozilla/5.0 (compatible; VivaRealBot/2.0)');
select ok(app.canal_pro_crm_publica(), 'lido pelo robô, quem publica é o CRM');

select pg_temp.gestor();
insert into t187 select 'depois', public.anuncio_importar(
  pg_temp.completo('T187A', 'Título velho que a Arbo ainda manda')
  || '{"latitude": -5.1, "longitude": -35.1, "destaque": "destaque"}');
insert into t187 select 'rascunhoB2', public.anuncio_importar(pg_temp.completo('T187B', 'Rascunho atualizado pela Arbo'));
insert into t187 select 'novoC', public.anuncio_importar(pg_temp.completo('T187C', 'Anúncio novo que veio da Arbo'));
select pg_temp.sair();
select is(pg_temp.v('depois') - 'id' - 'pendencias',
  '{"ok": true, "novo": false, "fotos": 1, "codigo": "T187A", "pulado": "no_ar_pelo_crm"}'::jsonb,
  'depois da troca, o anúncio no ar é pulado, com o motivo');
select is((pg_temp.anuncio('T187A')).titulo, 'Apartamento com vista para o mar, do arquivo',
  'e o título do CRM fica');
select is(((pg_temp.anuncio('T187A')).latitude, (pg_temp.anuncio('T187A')).longitude)::text,
  '(-6.0559925,-35.1708741)', 'e as coordenadas também');
select is((pg_temp.anuncio('T187B')).titulo, 'Rascunho atualizado pela Arbo', 'o rascunho continua vindo');
select is(pg_temp.v('novoC') ->> 'novo', 'true', 'e o anúncio novo também');

-- =====================================================================
-- 4. A linha do relatório que gasta destaque
-- =====================================================================
create temp table base187 as select o.destaques from app.canal_pro_ocupadas() o;
select pg_temp.gestor();
insert into t187 select 'D', public.anuncio_importar(pg_temp.completo('T187D', 'É um dos destaques do portal'));
insert into t187 select 'E', public.anuncio_importar(pg_temp.completo('T187E', 'Está no portal, sem destaque'));
select pg_temp.sair();
select pg_temp.foto('T187D');
select pg_temp.foto('T187E');
insert into public.anuncios_no_canal_pro (codigo, situacao, destaque, titulo, no_relatorio) values
  ('T187D', 'Ativo', 'Destaque', 'É um dos destaques do portal', true),
  ('T187E', 'Ativo', 'Padrão', 'Está no portal, sem destaque', true),
  ('T187 outro destaque', 'Ativo', 'Destaque', 'O outro destaque do portal', true);
-- O plano com os dois destaques em uso: o do T187D e o outro.
update public.canal_pro set limite_destaques = (select destaques from base187) + 2 where um;

select pg_temp.sdr();
select is((select string_agg(codigo || '=' || no_canal_pro_com_destaque::text, ' ' order by codigo)
             from public.anuncios_na_lista where codigo in ('T187D', 'T187E', 'T187B')),
  'T187B=false T187D=true T187E=false',
  'a lista diz se a linha do relatório gasta destaque (o SDR também lê)');
select pg_temp.sair();

select pg_temp.gestor();
select is(public.anuncio_destaque((pg_temp.anuncio('T187D')).id, 'destaque') ->> 'ok', 'true',
  'o rascunho escolhe o destaque');
select is(public.anuncio_destaque((pg_temp.anuncio('T187E')).id, 'destaque') ->> 'ok', 'true',
  'os dois');
select is(public.anuncio_publicar((pg_temp.anuncio('T187D')).id) ->> 'ok', 'true',
  'com 2 de 2 em uso, o rascunho que é um dos destaques vai ao ar com destaque');
select is(public.anuncio_publicar((pg_temp.anuncio('T187E')).id) ->> 'motivo', 'plano_sem_destaque',
  'o que não é destaque no portal, não');
select pg_temp.sair();

-- =====================================================================
-- 5. A IA não vê as cópias do relatório
-- =====================================================================
insert into public.anuncios_no_canal_pro (codigo, situacao, titulo, no_relatorio, marcado_excluido_em) values
  ('T187B', 'Ativo', 'A cópia do relatório do rascunho', true, null),
  ('T187 copia antiga', 'Ativo', 'Cópia marcada como excluída', true, now()),
  ('T187 so no portal', 'Ativo', 'Só existe no Canal Pro', true, null);
select is((select string_agg(i ->> 'situacao', ',') from jsonb_array_elements(app.ia_atendente_imoveis()) i
            where i ->> 'codigo' = 'T187B'), 'rascunho',
  'o código do CRM aparece uma vez, com a situação do CRM (a cópia Ativa do relatório não diz no ar)');
select ok(not exists (select 1 from jsonb_array_elements(app.ia_atendente_imoveis()) i
                       where i ->> 'codigo' = 'T187 copia antiga'),
  'a linha marcada como excluída no Canal Pro não entra');
select is((select i ->> 'situacao' from jsonb_array_elements(app.ia_atendente_imoveis()) i
            where i ->> 'codigo' = 'T187 so no portal'), 'no_ar',
  'o anúncio que só existe no Canal Pro continua entrando');
select is((select count(*)::int from jsonb_array_elements(app.ia_atendente_imoveis()) i
            where i ->> 'codigo' = 'T187D'), 1, 'o destaque do portal que o CRM tem, uma vez');

-- =====================================================================
-- 6. Quem executa; o safeupdate da API
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'app.canal_pro_crm_publica()', 'execute'),
  'só as funções do banco perguntam se o CRM publica');
select ok(not has_function_privilege('anon', 'public.anuncio_importar(jsonb)', 'execute'),
  'o anon não importa');
select ok(has_function_privilege('authenticated', 'app.canal_pro_destaque_do_relatorio(text)', 'execute'),
  'quem entrou lê a regra do destaque (a lista roda com o papel de quem lê)');
select pg_temp.sdr();
select is(public.anuncio_importar(pg_temp.completo('T187F', 'O SDR não importa')) ->> 'motivo', 'sem_permissao',
  'importar continua sendo da gestão');
select pg_temp.sair();
select is(
  (select count(*)::int
     from pg_proc p
    cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('anuncio_importar', 'anuncio_publicar', 'canal_pro_feed')
      and comando ~* '(^|\n)\s*(update|delete)\s'
      and comando !~* '\swhere\s'),
  0, 'nenhum UPDATE ou DELETE sem WHERE (o safeupdate da API recusaria)');

select * from finish();
rollback;

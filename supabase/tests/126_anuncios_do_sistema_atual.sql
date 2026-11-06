-- =====================================================================
-- pgTAP — Os anúncios do sistema atual vêm com o mesmo código (migração 20261105110000)
--
-- Os anúncios da Imova no Canal Pro chegam "Via Integração" de outro sistema
-- (SA0012_IMOVA, PT0001_IMOVA...). Para o CRM assumir a integração sem o
-- portal perder nem duplicar nenhum, cada um precisa vir com o MESMO
-- ListingID. Este arquivo prova:
--
--   1. IMPORTAR É DA GESTÃO e confere o código e o tipo;
--   2. O ANÚNCIO NOVO nasce com o código dado, como rascunho, origem
--      sistema_atual — sem herdar situação nem destaque do que veio;
--   3. O QUE JÁ EXISTE é atualizado no lugar; excluído não volta; no ar não
--      fica com pendência; valor fora da regra volta como motivo;
--   4. TRAZER DO RELATÓRIO mantém o código quando ele cabe no ListingID e está
--      livre (com espaço e acento também, 20261105170000); senão, o da sequência;
--   5. A PENDÊNCIA DO ORIGINAL só vale com código diferente.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(39);

insert into public.allowed_users (email, role, note) values
  ('a126.g@teste.local', 'gestor', 'pgTAP sistema atual'),
  ('a126.s@teste.local', 'sdr', 'pgTAP sistema atual');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000012601'::uuid, 'a126.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000012602'::uuid, 'a126.s@teste.local', '{"full_name":"Sol SDR"}');

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
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012601'::uuid, 'gestor')
$$;
create function pg_temp.sdr() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012602'::uuid, 'sdr')
$$;

create temp table t126(chave text primary key, valor jsonb);
grant select, insert on t126 to authenticated;
create function pg_temp.v(p_chave text) returns jsonb language sql stable as $$
  select valor from t126 where chave = p_chave
$$;
create function pg_temp.anuncio(p_codigo text) returns public.anuncios language sql stable as $$
  select * from public.anuncios where codigo = p_codigo
$$;
create function pg_temp.manual(p_codigo text) returns public.anuncios_no_canal_pro language sql stable as $$
  select * from public.anuncios_no_canal_pro where codigo = p_codigo
$$;
-- O formulário completo de um anúncio do sistema atual (sem pendência fora as fotos).
create function pg_temp.completo(p_codigo text, p_titulo text) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'codigo', p_codigo, 'tipo', 'apartamento', 'negocio', 'venda', 'titulo', p_titulo,
    'descricao', 'Apartamento nascente, perto da praia, com varanda gourmet e duas vagas na garagem.',
    'preco_venda', 450000, 'cep', '59090-000', 'estado', 'rn', 'cidade', 'Natal', 'bairro', 'Ponta Negra',
    'area_util', 90, 'quartos', 3, 'banheiros', 2, 'vagas', 2,
    'caracteristicas', jsonb_build_array('Pool', ' Pool', 'Elevator'))
$$;

-- O contato da imobiliária preenchido e o plano sem limite: aqui só conta o código.
update public.canal_pro set nome = 'Imova Imobiliária', email = 'contato@imova.teste',
                            limite_anuncios = null, limite_destaques = null
 where um;

-- =====================================================================
-- 0. O que a migração criou
-- =====================================================================
select has_column('public', 'anuncios', 'origem', 'o anúncio guarda de onde veio');
select has_column('public', 'anuncios', 'importado_em', 'e quando foi importado');
select throws_ok($$insert into public.anuncios (origem) values ('outro_portal')$$, '23514', null,
  'origem fora da lista é recusada pelo banco');
select ok(not exists (select 1 from public.anuncios a
                        join public.anuncios_no_canal_pro m on m.anuncio_id = a.id
                       where a.origem = 'crm'),
  'nenhum anúncio trazido do relatório fica com origem crm');
select ok(not has_function_privilege('anon', 'public.anuncio_importar(jsonb)', 'execute'),
  'o anônimo não importa');
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
-- 1. Importar é da gestão e confere o código e o tipo
-- =====================================================================
select pg_temp.sdr();
select is(public.anuncio_importar(pg_temp.completo('T126SA0012_IMOVA', 'Apartamento importado')) ->> 'motivo',
  'sem_permissao', 'o SDR não importa');
select pg_temp.sair();

select pg_temp.gestor();
select is(public.anuncio_importar('{"titulo": "sem código"}'::jsonb) ->> 'motivo', 'codigo_invalido',
  'sem código é recusado');
select is(public.anuncio_importar(pg_temp.completo('SA0012_IMOVA - código do sistema atual que passa de cinquenta', 'x')) ->> 'motivo', 'codigo_invalido',
  'código que não cabe no ListingID (mais de 50 caracteres) é recusado');
select is(public.anuncio_importar(pg_temp.completo('T126XX', 'x') || '{"tipo": "mansao_flutuante"}') ->> 'motivo',
  'tipo_invalido', 'tipo que o CRM não conhece é recusado');

-- =====================================================================
-- 2. O anúncio novo
-- =====================================================================
insert into t126
select 'novo', public.anuncio_importar(pg_temp.completo('T126SA0012_IMOVA', 'Apartamento de 3 quartos em Ponta Negra')
                                       || '{"situacao": "no_ar", "destaque": "super_destaque"}');
select pg_temp.sair();

select is(pg_temp.v('novo') ->> 'novo', 'true', 'o código que o CRM não tem cria um anúncio');
select is(pg_temp.v('novo') ->> 'codigo', 'T126SA0012_IMOVA', 'com o MESMO código do sistema atual');
select is((select a.situacao || ' · ' || a.destaque || ' · ' || a.origem from public.anuncios a
            where a.id = (pg_temp.v('novo') ->> 'id')::uuid),
  'rascunho · super_destaque · sistema_atual', 'como rascunho, com o destaque do arquivo e origem sistema_atual');
select ok((pg_temp.anuncio('T126SA0012_IMOVA')).importado_em is not null, 'e a hora da importação');
select is((pg_temp.anuncio('T126SA0012_IMOVA')).cep || '/' || (pg_temp.anuncio('T126SA0012_IMOVA')).estado,
  '59090000/RN', 'com as mesmas normalizações do salvar');
select is(pg_temp.v('novo') ->> 'fotos', '0', 'a resposta diz quantas fotos o anúncio tem');
select ok((pg_temp.v('novo') -> 'pendencias') ? 'pelo menos 1 foto',
  'e o que falta para ir ao ar');

-- =====================================================================
-- 3. O que já existe
-- =====================================================================
select pg_temp.gestor();
select is(public.anuncio_importar(pg_temp.completo('T126SA0012_IMOVA', 'Apartamento com vista para o mar')) ->> 'novo',
  'false', 'importar de novo o mesmo código atualiza');
select pg_temp.sair();
select is((select count(*)::int from public.anuncios where codigo = 'T126SA0012_IMOVA'), 1, 'sem criar outro');
select is((pg_temp.anuncio('T126SA0012_IMOVA')).titulo, 'Apartamento com vista para o mar', 'o título novo fica');

-- O proprietário ligado no CRM fica; o destaque do arquivo vale no rascunho.
update public.anuncios
   set proprietario_id = (select o.id from public.organizations o where o.deleted_at is null limit 1)
 where codigo = 'T126SA0012_IMOVA';
select set_config('t126.dono', coalesce((pg_temp.anuncio('T126SA0012_IMOVA')).proprietario_id::text, ''), true);
select pg_temp.gestor();
select is(public.anuncio_importar(pg_temp.completo('T126SA0012_IMOVA', 'Apartamento com vista para o mar')
                                  || '{"destaque": "destaque"}') ->> 'ok', 'true',
  'trazer de novo com destaque');
select pg_temp.sair();
select is(coalesce((pg_temp.anuncio('T126SA0012_IMOVA')).proprietario_id::text, ''), current_setting('t126.dono'),
  'trazer de novo não desfaz o proprietário ligado no CRM');
select is((pg_temp.anuncio('T126SA0012_IMOVA')).destaque, 'destaque', 'o destaque do arquivo vale no rascunho');

-- Cinco fotos e no ar: importar pela metade não tira o anúncio do portal.
insert into public.anuncio_fotos (anuncio_id, caminho, posicao)
select a.id, a.id::text || '/' || gen_random_uuid()::text || '.jpg', n
  from public.anuncios a, generate_series(0, 4) n
 where a.codigo = 'T126SA0012_IMOVA';
select pg_temp.gestor();
select is(public.anuncio_publicar((pg_temp.anuncio('T126SA0012_IMOVA')).id) ->> 'ok', 'true', 'o importado vai ao ar');
select is(public.anuncio_importar('{"codigo": "T126SA0012_IMOVA", "tipo": "apartamento", "titulo": "Curto"}'::jsonb)
            ->> 'motivo', 'no_ar_com_pendencias', 'no ar, a importação pela metade é recusada');
select pg_temp.sair();
select is((pg_temp.anuncio('T126SA0012_IMOVA')).titulo, 'Apartamento com vista para o mar',
  'e o anúncio fica como estava');
select pg_temp.gestor();
select is(public.anuncio_importar(pg_temp.completo('T126SA0012_IMOVA', 'Apartamento com vista para o mar')) ->> 'fotos',
  '5', 'a importação inteira passa, e as fotos continuam');
select is(public.anuncio_importar(pg_temp.completo('T126TE0002_IMOVA', 'Terreno') || '{"negocio": "troca"}') ->> 'motivo',
  'dados_invalidos', 'valor fora da regra volta como motivo, sem derrubar a importação');
select is(public.anuncio_excluir((pg_temp.anuncio('T126SA0012_IMOVA')).id, 'Vendido') ->> 'ok', 'true',
  '(excluído com motivo)');
select is(public.anuncio_importar(pg_temp.completo('T126SA0012_IMOVA', 'Apartamento com vista para o mar')) ->> 'motivo',
  'excluido', 'o excluído não volta pela importação');
select pg_temp.sair();

-- =====================================================================
-- 4. Trazer do relatório
-- =====================================================================
insert into public.anuncios_no_canal_pro (codigo, titulo, tipo_crm, negocio, preco_venda, area, quartos)
values ('T126PT0001_IMOVA', 'Casa do sistema atual', 'casa', 'venda', 890000, 180, 4),
       ('T126 - código do Canal Pro que passa de cinquenta letras', 'Casa com código fora do formato', 'casa', 'venda', 500000, 120, 3),
       ('T126SA0012_IMOVA', 'O código já usado no CRM', 'apartamento', 'venda', 450000, 90, 3);

select pg_temp.sdr();
insert into t126 select 'mesmo', public.canal_pro_trazer((pg_temp.manual('T126PT0001_IMOVA')).id);
insert into t126 select 'fora', public.canal_pro_trazer((pg_temp.manual('T126 - código do Canal Pro que passa de cinquenta letras')).id);
insert into t126 select 'usado', public.canal_pro_trazer((pg_temp.manual('T126SA0012_IMOVA')).id);
select pg_temp.sair();

select is(pg_temp.v('mesmo') ->> 'codigo', 'T126PT0001_IMOVA', 'trazer mantém o código do relatório');
select is((select origem from public.anuncios where id = (pg_temp.v('mesmo') ->> 'anuncio_id')::uuid),
  'relatorio_canal_pro', 'com a origem do relatório');
select matches(pg_temp.v('fora') ->> 'codigo', '^IMV-[0-9]{4,}$',
  'código fora do formato do ListingID: o da sequência');
select matches(pg_temp.v('usado') ->> 'codigo', '^IMV-[0-9]{4,}$',
  'código já usado no CRM (mesmo por um excluído): o da sequência');

-- =====================================================================
-- 5. A pendência do original
-- =====================================================================
select ok(not exists (select 1 from unnest(app.anuncio_pendencias((pg_temp.v('mesmo') ->> 'anuncio_id')::uuid)) p
                       where p like 'excluir o original%'),
  'mesmo código: é o mesmo anúncio, não há original a excluir');
select ok(app.anuncio_pendencias((pg_temp.v('fora') ->> 'anuncio_id')::uuid)
            @> array['excluir o original (código T126 - código do Canal Pro que passa de cinquenta letras) no Canal Pro e marcar aqui como excluído'],
  'código diferente: o original precisa sair do Canal Pro antes');
select ok(app.anuncio_pendencias((pg_temp.v('usado') ->> 'anuncio_id')::uuid)
            @> array['excluir o original (código T126SA0012_IMOVA) no Canal Pro e marcar aqui como excluído'],
  'e o mesmo vale para o que ganhou o código da sequência porque o dele estava em uso');

-- =====================================================================
-- 6. A vaga do plano conta uma vez
-- =====================================================================
-- Direto no banco (sem as pendências de foto): o que importa aqui é a conta.
select set_config('t126.antes', (select anuncios from app.canal_pro_ocupadas())::text, true);
update public.anuncios set situacao = 'no_ar' where id = (pg_temp.v('mesmo') ->> 'anuncio_id')::uuid;
select is((select anuncios from app.canal_pro_ocupadas()), current_setting('t126.antes')::int,
  'mesmo código no ar no CRM e no relatório: uma vaga só');
update public.anuncios set situacao = 'no_ar' where id = (pg_temp.v('fora') ->> 'anuncio_id')::uuid;
select is((select anuncios from app.canal_pro_ocupadas()), current_setting('t126.antes')::int,
  'trazido com outro código: ligado ao original, é o mesmo imóvel e conta uma vez');

select * from finish();
rollback;

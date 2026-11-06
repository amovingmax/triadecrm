-- =====================================================================
-- pgTAP — O relatório de verdade do Canal Pro (migração 20261105150000), só na Imova
--
-- Prova: só o ATIVO no Canal Pro ocupa vaga do plano; "Trazer para o CRM" de uma
-- linha com o código de um anúncio do CRM liga os dois (não duplica); a linha
-- com outro código vira rascunho com descrição, CEP, estado em sigla, cômodos,
-- áreas, condomínio e IPTU; a lista de Anúncios mostra visualizações, contatos e
-- a data de criação do Canal Pro.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(18);

insert into public.allowed_users (email, role, note) values
  ('a128.g@teste.local', 'gestor', 'pgTAP relatório do Canal Pro');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000012801'::uuid, 'a128.g@teste.local', '{"full_name":"Gil Gestor"}');
create function pg_temp.gestor() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'a0000000-0000-4000-8000-000000012801', 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', 'gestor'))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create temp table t128(chave text primary key, valor uuid);
grant select, insert on t128 to authenticated;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select valor from t128 where chave = p $$;
grant execute on function pg_temp.id(text) to authenticated;

-- O plano e o relatório começam vazios neste teste.
update public.canal_pro set limite_anuncios = 10, limite_destaques = 2 where um;
update public.anuncios_no_canal_pro set no_relatorio = false where no_relatorio;
update public.anuncios set situacao = 'rascunho' where situacao = 'no_ar';

-- Um anúncio do CRM com o código que a Arbo publica.
with x as (insert into public.anuncios (codigo, titulo, tipo, negocio, area_total, cidade, bairro)
           values ('T128_IMOVA', 'Terreno T128', 'terreno', 'venda', 3500, 'Parnamirim', 'Rosa dos Ventos')
           returning id)
insert into t128 select 'crm', id from x;

-- O relatório, como a tela manda (a linha inteira no `linha`).
select pg_temp.gestor();
select is((public.canal_pro_importar(jsonb_build_array(
  jsonb_build_object('codigo', 'T128_IMOVA', 'titulo', 'Terreno T128', 'tipo', 'Lote/Terreno', 'tipo_crm', 'terreno',
    'negocio', 'venda', 'preco_venda', 2275000, 'area', 3500, 'destaque', 'Destaque', 'situacao', 'Ativo',
    'linha', jsonb_build_object('Código do Imóvel', 'T128_IMOVA', 'Total de visualizações', '21',
                                'Total de contatos', '4', 'Criação', '23-07-2026')),
  jsonb_build_object('codigo', 'T128 antigo', 'titulo', 'Terreno T128 (antigo)', 'tipo', 'Lote/Terreno',
    'tipo_crm', 'terreno', 'preco_venda', 2275000, 'area', 3500, 'cidade', 'Parnamirim',
    'destaque', 'Padrão', 'situacao', 'Ativo',
    'linha', jsonb_build_object('Código do Imóvel', 'T128 antigo')),
  jsonb_build_object('codigo', 'Casa T128', 'titulo', 'Casa à venda em Extremoz', 'tipo', 'Casa', 'tipo_crm', 'casa',
    'negocio', 'venda', 'preco_venda', 168000, 'area', 64, 'quartos', 2, 'destaque', 'Destaque',
    'situacao', 'Inativo',
    'linha', jsonb_build_object('Código do Imóvel', 'Casa T128', 'Descrição', 'Casa com 2 quartos, sendo 1 suíte, quintal espaçoso e varanda. Meu CPF 529.982.247-25.',
                                'CEP', '59575-000', 'Estado', 'Rio Grande do Norte', 'Suítes', '1',
                                'Banheiros', '2', 'Vagas', '3', 'Área útil', '64', 'Área total', '225',
                                'Condomínio/mês', '0', 'IPTU/ano', '1.050'))
)) ->> 'anuncios')::int, 3, 'o relatório entra com as três linhas');
select pg_temp.sair();

-- =====================================================================
-- 1. Só o ativo ocupa vaga
-- =====================================================================
select is((select anuncios from app.canal_pro_ocupadas()), 2, 'dois ativos ocupam vaga; o inativo não');
select is((select destaques from app.canal_pro_ocupadas()), 1, 'e só o destaque ativo ocupa vaga de destaque');
select ok(app.canal_pro_ativo_no_relatorio('Ativo') and not app.canal_pro_ativo_no_relatorio('Inativo')
          and app.canal_pro_ativo_no_relatorio(null), 'Ativo sim, Inativo não, sem situação sim');

-- =====================================================================
-- 2. Trazer: o mesmo código liga; outro código vira rascunho completo
-- =====================================================================
select pg_temp.gestor();
select is((select (public.canal_pro_trazer(m.id)) ->> 'ja_existia' from public.anuncios_no_canal_pro m where m.codigo = 'T128_IMOVA'),
  'true', 'trazer a linha com o código de um anúncio do CRM não cria outro');
select pg_temp.sair();
select is((select anuncio_id from public.anuncios_no_canal_pro where codigo = 'T128_IMOVA'), pg_temp.id('crm'),
  'e liga a linha ao anúncio do CRM');
select is((select count(*)::int from public.anuncios where titulo like 'Terreno T128%' and excluido_em is null), 1,
  'continua um anúncio só');

select pg_temp.gestor();
insert into t128 select 'casa', ((public.canal_pro_trazer(m.id)) ->> 'anuncio_id')::uuid
  from public.anuncios_no_canal_pro m where m.codigo = 'Casa T128';
select pg_temp.sair();
select is((select origem || ' · ' || tipo || ' · ' || negocio || ' · ' || codigo from public.anuncios where id = pg_temp.id('casa')),
  'relatorio_canal_pro · casa · venda · Casa T128', 'o código do Canal Pro vem como é, com espaço (20261105170000)');
select is((select cep || ' · ' || estado || ' · ' || suites || ' · ' || banheiros || ' · ' || vagas
             from public.anuncios where id = pg_temp.id('casa')),
  '59575000 · RN · 1 · 2 · 3', 'CEP, estado em sigla e cômodos vêm da linha');
select is((select area_util || ' · ' || area_total || ' · ' || condominio || ' · ' || iptu
             from public.anuncios where id = pg_temp.id('casa')),
  '64 · 225 · 0 · 1050', 'as duas áreas, o condomínio e o IPTU ("1.050") também');
select ok((select descricao like 'Casa com 2 quartos%' and descricao !~ '529' from public.anuncios where id = pg_temp.id('casa')),
  'a descrição vem, sem o CPF');

-- =====================================================================
-- 3. A lista mostra o que o Canal Pro informa
-- =====================================================================
select pg_temp.gestor();
select is((select no_canal_pro_situacao || ' · ' || no_canal_pro_visualizacoes || ' · ' || no_canal_pro_contatos
             from public.anuncios_na_lista where id = pg_temp.id('crm')),
  'Ativo · 21 · 4', 'situação, visualizações e contatos do relatório');
select is((select no_canal_pro_criado_em from public.anuncios_na_lista where id = pg_temp.id('crm')),
  '2026-07-23'::date, 'e a data de criação no Canal Pro');
select pg_temp.sair();

-- =====================================================================
-- 4. As funções novas
-- =====================================================================
select is(app.uf_do_estado('São Paulo') || app.uf_do_estado('rn') || coalesce(app.uf_do_estado('Atlântida'), '-'),
  'SPRN-', 'nome por extenso vira sigla; o que não é estado fica vazio');
select is(app.canal_pro_inteiro('1.050')::text || ' ' || app.canal_pro_inteiro('3800,00')::text || ' '
          || coalesce(app.canal_pro_inteiro('NÃO')::text, '-'), '1050 3800 -', 'números do relatório');
select is(
  (select count(*)::int
     from pg_proc p
    cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
    where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
      and p.proname in ('canal_pro_trazer', 'canal_pro_ocupadas', 'canal_pro_campo', 'canal_pro_inteiro', 'uf_do_estado')
      and comando ~* '(^|\n)\s*(update|delete)\s'
      and comando !~* '\swhere\s'),
  0, 'nenhum UPDATE ou DELETE sem WHERE (o safeupdate da API recusaria)');

select ok(app.codigo_de_anuncio_valido('Edifício Simone') and app.codigo_de_anuncio_valido('Brisa Mall - Loja 02')
          and app.codigo_de_anuncio_valido('TE0001_IMOVA'), 'código com espaço e acento vale, como no Canal Pro');
select ok(not app.codigo_de_anuncio_valido(' Casa') and not app.codigo_de_anuncio_valido('Casa <b>')
          and not app.codigo_de_anuncio_valido(repeat('x', 51)) and not app.codigo_de_anuncio_valido(''),
  'espaço na ponta, < >, mais de 50 caracteres e vazio não valem');

select * from finish();
rollback;

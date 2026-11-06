-- =====================================================================
-- pgTAP — Atualizar com um clique (migração 20261106100000), só na Imova
--
-- Prova: o endereço do sistema atual fica guardado e só admin e gestor o leem
-- ou trocam (a tela só sabe se ele existe); a leitura do arquivo marca quem está
-- nele e quem saiu, e a lista mostra; `canal_pro_parece_com` acha a cópia
-- antiga; o relatório do Canal Pro traz sozinho o que só existe lá, sem trazer
-- cópia, código do CRM (nem excluído) ou a segunda linha do mesmo imóvel, e
-- importar de novo não traz duas vezes.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(26);

insert into public.allowed_users (email, role, note) values
  ('a129.g@teste.local', 'gestor', 'pgTAP atualizar com um clique'),
  ('a129.s@teste.local', 'sdr', 'pgTAP atualizar com um clique');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000012901'::uuid, 'a129.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000012902'::uuid, 'a129.s@teste.local', '{"full_name":"Sara SDR"}');
create function pg_temp.entrar(p_id text, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.gestor() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000012901', 'gestor') $$;
create function pg_temp.sdr() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000012902', 'sdr') $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create temp table t129(chave text primary key, valor jsonb);
grant select, insert on t129 to authenticated;
create function pg_temp.v(p text) returns jsonb language sql stable as $$ select valor from t129 where chave = p $$;
grant execute on function pg_temp.v(text) to authenticated;

-- O arquivo, o relatório e o endereço começam vazios neste teste.
delete from public.sistema_atual_no_arquivo where true;
update public.anuncios_no_canal_pro set no_relatorio = false where no_relatorio;
update public.canal_pro set sistema_atual_url = null, sistema_atual_lido_em = null where um;

insert into public.anuncios (codigo, titulo, tipo, negocio, area_total, cidade, bairro, origem) values
  ('T129A', 'Terreno T129 A', 'terreno', 'venda', 12901, 'Ceará-Mirim T129', 'Bairro Um', 'sistema_atual'),
  ('T129B', 'Terreno T129 B', 'terreno', 'venda', 12902, 'Outra T129', 'Tabatinga', 'sistema_atual');
insert into public.anuncios (codigo, titulo, tipo, negocio, area_total, cidade, excluido_em, motivo_exclusao)
values ('T129EXCL', 'Excluído no CRM', 'terreno', 'venda', 12904, 'Natal T129', now(), 'pgTAP');

-- =====================================================================
-- 1. O endereço guardado
-- =====================================================================
select pg_temp.sdr();
select is(public.sistema_atual_endereco_salvar('https://exemplo.test/feed.xml') ->> 'motivo', 'sem_permissao',
  'o SDR não guarda o endereço');
select is(public.sistema_atual_endereco(), null, 'nem o lê');
select pg_temp.sair();

select pg_temp.gestor();
select is(public.sistema_atual_endereco_salvar('ftp://exemplo.test/feed.xml') ->> 'motivo', 'url_invalida',
  'endereço que não é http(s) é recusado');
select is(public.sistema_atual_endereco_salvar('  https://exemplo.test/imobiliaria/SEGREDO/feed.xml ') ->> 'ok', 'true',
  'a gestão guarda o endereço');
select is(public.sistema_atual_endereco(), 'https://exemplo.test/imobiliaria/SEGREDO/feed.xml',
  'e o servidor o lê, sem os espaços');
select pg_temp.sair();

select pg_temp.sdr();
select ok((public.canal_pro_situacao() #>> '{sistema_atual,tem_endereco}')::boolean
          and public.canal_pro_situacao()::text !~ 'SEGREDO',
  'a tela sabe que há endereço, mas o endereço não vem');
select pg_temp.sair();

-- =====================================================================
-- 2. Quem está no arquivo do sistema atual
-- =====================================================================
select pg_temp.sdr();
select is(public.sistema_atual_leitura_registrar(array['T129A']) ->> 'motivo', 'sem_permissao',
  'o SDR não registra leitura');
select pg_temp.sair();

select pg_temp.gestor();
select is(public.sistema_atual_leitura_registrar(array[]::text[]) ->> 'motivo', 'arquivo_vazio',
  'arquivo vazio não marca todo mundo como saído');
select is(public.sistema_atual_leitura_registrar(array['T129A', 'T129B', 'T129A', ' ']) - 'ok',
  '{"no_arquivo": 2, "sairam": 0}'::jsonb, 'a leitura marca os dois códigos (repetido e vazio não contam)');
select is((select string_agg(codigo || ':' || no_sistema_atual::text, ' ' order by codigo)
             from public.anuncios_na_lista where codigo in ('T129A', 'T129B')),
  'T129A:true T129B:true', 'a lista diz que os dois estão no arquivo');
select is(public.sistema_atual_leitura_registrar(array['T129A']) ->> 'sairam', '1',
  'na leitura seguinte, sem o B: um saiu');
select ok((select no_sistema_atual = false and sistema_atual_em is not null
             from public.anuncios_na_lista where codigo = 'T129B'),
  'e a lista mostra o B fora do arquivo, com a hora');
select is(public.sistema_atual_leitura_registrar(array['T129A']) ->> 'sairam', '0',
  'quem já tinha saído não sai de novo');
select isnt(public.canal_pro_situacao() #>> '{sistema_atual,lido_em}', null,
  'a situação diz quando o arquivo foi lido');
select pg_temp.sair();

-- =====================================================================
-- 3. O relatório traz sozinho o que só existe no Canal Pro
-- =====================================================================
select pg_temp.gestor();
insert into t129 select 'imp', public.canal_pro_importar(jsonb_build_array(
  -- O mesmo código de um anúncio do CRM: não vem de novo.
  jsonb_build_object('codigo', 'T129A', 'titulo', 'Terreno T129 A', 'tipo_crm', 'terreno', 'negocio', 'venda',
    'preco_venda', 2275000, 'area', 12901, 'cidade', 'Ceará-Mirim T129', 'situacao', 'Ativo'),
  -- Cópia antiga do T129A (outro código, mesma cidade e área): não vem.
  jsonb_build_object('codigo', 'T129 antigo', 'titulo', 'Terreno T129 A (antigo)', 'tipo_crm', 'terreno',
    'preco_venda', 2275000, 'area', 12901, 'cidade', 'CEARA MIRIM T129', 'bairro', 'bairro um', 'situacao', 'Ativo'),
  -- Só existe lá: vem, com o mesmo código.
  jsonb_build_object('codigo', 'Casa T129', 'titulo', 'Casa à venda em Extremoz', 'tipo_crm', 'casa',
    'negocio', 'venda', 'preco_venda', 168000, 'area', 12903, 'cidade', 'Extremoz T129', 'situacao', 'Inativo'),
  -- O código de um anúncio EXCLUÍDO no CRM: quem excluiu não quer de volta.
  jsonb_build_object('codigo', 'T129EXCL', 'titulo', 'Excluído no CRM', 'tipo_crm', 'terreno',
    'preco_venda', 100000, 'area', 12904, 'cidade', 'Natal T129', 'situacao', 'Ativo'),
  -- Duas linhas do mesmo imóvel que só existe lá: vem a ativa, e a outra parece com ela.
  jsonb_build_object('codigo', 'Dup T129 velho', 'titulo', 'Sala 19 m² (velho)', 'tipo_crm', 'sala',
    'preco_aluguel', 1600, 'area', 12905, 'cidade', 'Natal T129', 'bairro', 'Ponta Negra', 'situacao', 'Inativo'),
  jsonb_build_object('codigo', 'Dup T129 ativo', 'titulo', 'Sala 19 m²', 'tipo_crm', 'sala',
    'preco_aluguel', 1600, 'area', 12905, 'cidade', 'Natal T129', 'bairro', 'Ponta Negra', 'situacao', 'Ativo')
));
select pg_temp.sair();

select is((pg_temp.v('imp') ->> 'anuncios')::int, 6, 'o relatório entra com as seis linhas');
select is((pg_temp.v('imp') ->> 'trazidos')::int, 2, 'e traz dois para o CRM sozinho');
select is((select string_agg(codigo || ':' || origem, ' ' order by codigo) from public.anuncios
            where origem = 'relatorio_canal_pro' and codigo like '%T129%'),
  'Casa T129:relatorio_canal_pro Dup T129 ativo:relatorio_canal_pro',
  'o que só existe lá, com o código de lá, e a linha ativa do imóvel repetido');
select is((select count(*)::int from public.anuncios where codigo like 'T129%' or codigo like 'IMV-%' and titulo like '%T129%'),
  3, 'o código do CRM e a cópia antiga não viraram outro anúncio (continuam T129A, T129B e T129EXCL)');
select is((select count(*)::int from public.anuncios where codigo = 'T129EXCL'), 1,
  'o excluído não voltou nem ganhou irmão');

select pg_temp.gestor();
select is((select a.codigo from public.anuncios a
            where a.id = (select public.canal_pro_parece_com(m) from public.anuncios_no_canal_pro m
                           where m.codigo = 'T129 antigo')),
  'T129A', 'a cópia antiga parece o T129A (cidade e bairro sem diferença de caixa e acento)');
select is((select a.codigo from public.anuncios a
            where a.id = (select public.canal_pro_parece_com(m) from public.anuncios_no_canal_pro m
                           where m.codigo = 'Dup T129 velho')),
  'Dup T129 ativo', 'e a linha velha do imóvel repetido parece a ativa, que veio');
select is((select public.canal_pro_parece_com(m) from public.anuncios_no_canal_pro m where m.codigo = 'Casa T129'),
  null, 'o que veio não parece consigo mesmo');
select ok((select parece_com is null from (
             select public.canal_pro_parece_com(m) as parece_com
               from public.anuncios_no_canal_pro m where m.codigo = 'T129A') x),
  'nem a linha de mesmo código parece com o próprio anúncio');

-- Importar de novo não traz duas vezes.
select is((public.canal_pro_importar((select jsonb_agg(jsonb_build_object(
             'codigo', m.codigo, 'titulo', m.titulo, 'tipo_crm', m.tipo_crm, 'area', m.area,
             'cidade', m.cidade, 'bairro', m.bairro, 'situacao', m.situacao))
           from public.anuncios_no_canal_pro m where m.codigo like '%T129%')) ->> 'trazidos')::int,
  0, 'importar o mesmo relatório de novo não traz nada');
select pg_temp.sair();

select pg_temp.sdr();
select is((public.canal_pro_importar('[{"codigo": "SDR T129", "titulo": "x"}]'::jsonb)) ->> 'motivo',
  'sem_permissao', 'o SDR não importa o relatório (nem traz por ele)');
select pg_temp.sair();

-- =====================================================================
-- 4. O safeupdate da API
-- =====================================================================
select is(
  (select count(*)::int
     from pg_proc p
    cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('sistema_atual_endereco_salvar', 'sistema_atual_leitura_registrar',
                        'canal_pro_importar', 'canal_pro_parece_com')
      and comando ~* '(^|\n)\s*(update|delete)\s'
      and comando !~* '\swhere\s'),
  0, 'nenhum UPDATE ou DELETE sem WHERE (o safeupdate da API recusaria)');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — A veracidade do mercado (migração 20261119162000)
--
-- As regras de `_redesign/pipeline/veracidade.md`, com os casos reais de
-- 18/11 (§12.5) refeitos com anúncios de teste:
--
--   1. FAIXAS DURAS: terreno de R$ 1.500 (preco_baixo), terreno de 13,38 m²
--      (area_baixa, provável hectare), casa de 1 m²; terreno de 75.000 m² vira
--      gleba e fica ok;
--   2. COERÊNCIA: áreas trocadas (a de referência fica com a menor), terreno
--      com quartos (tipo duvidoso);
--   3. IMÓVEL NOSSO: o terreno de 10.000 m² da BONOR anunciado por outra
--      fonte e a casa do Potengi (322 m², R$ 180 mil) saem das contas
--      (oculto_proprio); o terreno de 900 m² a R$ 790 mil é "possível mesmo
--      imóvel" e trava o preço do nosso até a equipe decidir; "não é" vale até
--      o preço mudar mais de 10%;
--   4. QUASE GÊMEOS: área até 2% e preço até 3% viram um imóvel só, e fica o
--      mais barato;
--   5. CERCA: o terreno de R$ 19.444 o m² entre terrenos de R$ 1.000 é só
--      marcado (suspeito_3iqr), não sai da conta;
--   6. VALIDADE: não visto há 10 dias vence; levantamento manual vence na data
--      da régua;
--   7. CONFRONTO: A Corrida dos Bairros nasce desligada (decisão do dono
--      pendente); liberada, a célula que diverge mais de 40% dela entra em
--      quarentena; com a causa aprovada fica em alerta.
--
-- O CI roda as migrações sem identidade e a semente grava 'komune': o teste
-- vira Imova dentro da transação (como o 121). Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if to_regclass('public.mercado_anuncios') is null then
    raise exception 'pgTAP 191 é da Imova: rode num banco com as migrações de mercado (Imova ou sem identidade)';
  end if;
end $$;

select plan(35);

-- A identidade da Imova (a semente do CI grava 'komune'), desfeita no rollback.
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

-- A régua do levantamento manual fica 30 dias à frente de hoje: o teste não
-- vence com o calendário (a seção 6 a põe no passado de propósito).
update public.mercado_regras
   set regras = jsonb_set(regras, '{manual,frase_ate}', to_jsonb((app.mercado_hoje() + 30)::text))
 where ativa;

insert into public.allowed_users (email, role, note) values
  ('m191.g@teste.local', 'gestor', 'pgTAP 191'),
  ('m191.s@teste.local', 'sdr', 'pgTAP 191'),
  ('m191.l@teste.local', 'leitura', 'pgTAP 191');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000019101'::uuid, 'm191.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000019102'::uuid, 'm191.s@teste.local', '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000019103'::uuid, 'm191.l@teste.local', '{"full_name":"Lia Leitura"}');

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
create function pg_temp.an(p_id text, p_tipo text, p_preco bigint, p_area numeric, p_bairro text, p_cidade text,
                           p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id_externo', p_id, 'url', 'https://exemplo-permitido.com.br/imovel/' || p_id,
                            'modo', 'venda', 'tipo', p_tipo, 'preco', p_preco,
                            'area_util', case when p_tipo in ('terreno') then null else p_area end,
                            'area_total', p_area, 'bairro', p_bairro, 'cidade', p_cidade) || p_extra
$$;
create function pg_temp.estado(p_id text) returns text language sql as $$
  select estado || coalesce(':' || motivo, '') from public.mercado_anuncios where id_externo = p_id
$$;
create function pg_temp.id(p_id text) returns uuid language sql as $$
  select id from public.mercado_anuncios where id_externo = p_id
$$;
create temp table t191 (chave text primary key, valor text);

-- A carteira do teste: tira a do banco local (desfeito no fim) e põe três imóveis.
update public.anuncios set excluido_em = now() where excluido_em is null;
update public.anuncios_no_canal_pro set excluido_em = now() where excluido_em is null;
insert into public.anuncios (codigo, tipo, negocio, preco_venda, area_util, area_total, quartos, bairro, cidade, estado) values
  ('TE0003T', 'terreno', 'venda', 4000000, null, 10000, null, 'Rosa dos Ventos', 'Parnamirim', 'RN'),
  ('TE0006T', 'terreno', 'venda', 1000000, null, 900, null, 'Capim Macio', 'Natal', 'RN'),
  ('CA0002T', 'casa', 'venda', 175000, null, 323, 3, 'Potengi', 'Natal', 'RN');

update public.app_settings set value = value || '{"ligado": true}'::jsonb where key = 'mercado';

insert into t191 values ('c', public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'chavesnamao@1') ->> 'coleta_id');
select public.mercado_anuncios_registrar((select valor::bigint from t191 where chave = 'c'),
  jsonb_build_array(
    pg_temp.an('v-preco-baixo', 'terreno', 1500, 12300, 'Capim Macio', 'Natal'),
    pg_temp.an('v-hectare', 'terreno', 1650000, 13.38, 'Praia de Tabatinga', 'Nísia Floresta'),
    pg_temp.an('v-gleba', 'terreno', 1350000, 75000, 'Cotovelo', 'Parnamirim'),
    pg_temp.an('v-casa-1m2', 'casa', 500000, 1, 'Petrópolis', 'Natal'),
    pg_temp.an('v-bonor', 'terreno', 4000000, 10000, 'Rosa dos Ventos', 'Parnamirim'),
    pg_temp.an('v-potengi', 'casa', 180000, 322, 'Potengi', 'Natal', '{"area_util": null, "quartos": 3}'),
    pg_temp.an('v-cj790', 'terreno', 790000, 900, 'Capim Macio', 'Natal'),
    pg_temp.an('v-g1', 'apartamento', 300000, 60, 'Lagoa Nova', 'Natal', '{"quartos": 2, "area_total": null}'),
    pg_temp.an('v-g2', 'apartamento', 305000, 60.5, 'Lagoa Nova', 'Natal', '{"quartos": 2, "area_total": null}'),
    pg_temp.an('v-g3', 'apartamento', 300000, 70, 'Lagoa Nova', 'Natal', '{"quartos": 2, "area_total": null}'),
    pg_temp.an('v-velho', 'terreno', 400000, 400, 'Candelária', 'Natal'),
    pg_temp.an('v-trocadas', 'casa', 600000, 100, 'Ponta Negra', 'Natal', '{"area_util": 200, "area_total": 100}'),
    pg_temp.an('v-tipo-duv', 'terreno', 300000, 300, 'Lagoa Nova', 'Natal', '{"quartos": 3}'),
    pg_temp.an('v-outlier', 'terreno', 3500000, 180, 'Neópolis', 'Natal')));
-- 24 terrenos de Neópolis perto de R$ 1.000 o m² (áreas 4% distantes: nenhum é gêmeo do outro).
select public.mercado_anuncios_registrar((select valor::bigint from t191 where chave = 'c'),
  (select jsonb_agg(pg_temp.an('v-neo-' || g, 'terreno', (round(300 * power(1.04, g)) * (950 + 4 * g))::bigint,
                               round(300 * power(1.04, g)), 'Neópolis', 'Natal'))
     from generate_series(1, 24) g));
-- Uma carga manual com a fonte verdadeira (conferência à mão pelo mesmo MCP).
insert into t191 values ('cm', public.mercado_coleta_abrir('chavesnamao-mcp', null, 'manual', 'chavesnamao-mcp-manual@1') ->> 'coleta_id');
select public.mercado_anuncios_registrar((select valor::bigint from t191 where chave = 'cm'),
  jsonb_build_array(pg_temp.an('v-manual', 'terreno', 500000, 600, 'Candelária', 'Natal')));
select public.mercado_coleta_fechar((select valor::bigint from t191 where chave = 'cm'));
do $v$ begin if to_regprocedure('app.mercado_verificar_se_pendente()') is not null then execute 'select app.mercado_verificar_se_pendente()'; end if; end $v$; -- 20261125120000: a veracidade roda depois
select public.mercado_coleta_fechar((select valor::bigint from t191 where chave = 'c'));
do $v$ begin if to_regprocedure('app.mercado_verificar_se_pendente()') is not null then execute 'select app.mercado_verificar_se_pendente()'; end if; end $v$; -- 20261125120000: a veracidade roda depois

-- ---------------------------------------------------------------------
-- 1. Faixas duras
-- ---------------------------------------------------------------------
select is(pg_temp.estado('v-preco-baixo'), 'fora:preco_baixo', 'terreno de R$ 1.500 por 12.300 m²: fora (provável aluguel ou erro)');
select is(pg_temp.estado('v-hectare'), 'fora:area_baixa', 'terreno de 13,38 m² por R$ 1,65 milhão: fora (provável hectare)');
select is(pg_temp.estado('v-casa-1m2'), 'fora:area_baixa', 'casa de 1 m²: fora');
select is((select sub || ':' || estado from public.mercado_anuncios where id_externo = 'v-gleba'), 'gleba:ok',
          'terreno de 75.000 m² em Cotovelo vira gleba e fica ok');

-- ---------------------------------------------------------------------
-- 2. Coerência
-- ---------------------------------------------------------------------
select ok((select 'areas_trocadas' = any (marcas) and area_ref = 100 from public.mercado_anuncios where id_externo = 'v-trocadas'),
          'área útil maior que a total: marca areas_trocadas e a de referência fica com a menor');
select ok((select 'tipo_duvidoso' = any (marcas) from public.mercado_anuncios where id_externo = 'v-tipo-duv'),
          'terreno com quartos: tipo duvidoso');
select is((public.mercado_m2('natal-lagoa-nova', 'terreno') ->> 'n')::int, 0,
          'e o tipo duvidoso fica fora do m² de terreno');

-- ---------------------------------------------------------------------
-- 3. Imóvel nosso e possível mesmo imóvel
-- ---------------------------------------------------------------------
select is((select estado || ':' || nosso_imovel_codigo from public.mercado_anuncios where id_externo = 'v-bonor'),
          'oculto_proprio:TE0003T', 'o terreno de 10.000 m² da BONOR em outra fonte é o nosso (TE0003): fora das contas');
select is((select estado || ':' || nosso_imovel_codigo from public.mercado_anuncios where id_externo = 'v-potengi'),
          'oculto_proprio:CA0002T', 'a casa do Potengi de 322 m² a R$ 180 mil é provavelmente a nossa (323 m², R$ 175 mil)');
select ok((select nosso_imovel from public.mercado_anuncios where id_externo = 'v-potengi'), 'a marca nosso_imovel fica ligada');
select is((select count(*)::int from public.mercado_pares where tipo = 'proprio' and decisao is null), 2,
          'os dois vão para a lista da equipe ("nossos imóveis vistos fora")');
select ok((select possivel_mesmo_imovel and estado = 'ok' from public.mercado_anuncios where id_externo = 'v-cj790'),
          'o terreno de 900 m² a R$ 790 mil (79% do nosso) é possível mesmo imóvel e continua nas contas');
select ok(app.mercado_preco_bloqueado('TE0006T'), 'e o argumento de preço do nosso terreno de 900 m² fica travado');
select ok(app.mercado_preco_bloqueado('TE0003T'), 'o provável próprio, sem a equipe confirmar, também trava o preço do nosso');

select pg_temp.entrar('a0000000-0000-4000-8000-000000019103'::uuid, 'leitura');
select throws_ok($$ select public.mercado_par_decidir('TE0006T', pg_temp.id('v-cj790'), 'nao_e') $$, '42501', null,
                 'outro papel não decide par');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000019102'::uuid, 'sdr');
select is(public.mercado_par_decidir('TE0006T', pg_temp.id('v-cj790'), 'nao_e', 'outra quadra') ->> 'ok', 'true',
          'o SDR decide: não é o mesmo imóvel');
select pg_temp.sair();
select ok(not app.mercado_preco_bloqueado('TE0006T'), 'decidido, o preço do nosso destrava');
select pg_temp.entrar('a0000000-0000-4000-8000-000000019102'::uuid, 'sdr');
select public.mercado_par_decidir('TE0003T', pg_temp.id('v-bonor'), 'e_nosso');
select pg_temp.sair();
select ok(not app.mercado_preco_bloqueado('TE0003T')
          and (select estado from public.mercado_anuncios where id_externo = 'v-bonor') = 'oculto_proprio',
          'confirmado "é o nosso", o anúncio fica fora das contas e o preço destrava');
select ok((select not possivel_mesmo_imovel from public.mercado_anuncios where id_externo = 'v-cj790'),
          'e a marca sai do anúncio');

insert into t191 values ('c2', public.mercado_coleta_abrir('chavesnamao-mcp', 'natal-capim-macio', 'auto', 'chavesnamao@1') ->> 'coleta_id');
select public.mercado_anuncios_registrar((select valor::bigint from t191 where chave = 'c2'),
  jsonb_build_array(pg_temp.an('v-cj790', 'terreno', 700000, 900, 'Capim Macio', 'Natal')));
select public.mercado_coleta_fechar((select valor::bigint from t191 where chave = 'c2'), null, null, null, false);
do $v$ begin if to_regprocedure('app.mercado_verificar_se_pendente()') is not null then execute 'select app.mercado_verificar_se_pendente()'; end if; end $v$; -- 20261125120000: a veracidade roda depois
select ok(app.mercado_preco_bloqueado('TE0006T'), 'o anúncio baixou mais de 10%: a pergunta volta e o preço trava de novo');

-- ---------------------------------------------------------------------
-- 4. Quase gêmeos
-- ---------------------------------------------------------------------
select is((select grupo_dup from public.mercado_anuncios where id_externo = 'v-g2'), pg_temp.id('v-g1'),
          'área 0,8% e preço 1,7% diferentes: o mesmo imóvel, no grupo do mais barato');
select ok((select representante from public.mercado_anuncios where id_externo = 'v-g1')
          and not (select representante from public.mercado_anuncios where id_externo = 'v-g2'),
          'fica só o mais barato nas contas');
select ok((select representante and grupo_dup is null from public.mercado_anuncios where id_externo = 'v-g3'),
          'o de 70 m² é outro imóvel');
select is((public.mercado_m2('natal-lagoa-nova', 'apartamento') ->> 'n')::int, 2,
          'o m² de apartamentos de Lagoa Nova conta 2 imóveis distintos, não 3 anúncios');

-- ---------------------------------------------------------------------
-- 5. A cerca de 3 intervalos interquartis (só marca)
-- ---------------------------------------------------------------------
select ok((select 'suspeito_3iqr' = any (marcas) and estado = 'ok' from public.mercado_anuncios where id_externo = 'v-outlier'),
          'o terreno de R$ 19.444 o m² entre terrenos de R$ 1.000 é marcado, não tirado');
select is((select (r ->> 'n')::int || '/' || (r ->> 'n_suspeitos') || '/' || (r ->> 'amostra')
             from public.mercado_m2('natal-neopolis', 'terreno') r), '25/1/indicio',
          'o m² de Neópolis conta 25 (1 suspeito) e é indício (menos de 30)');

-- ---------------------------------------------------------------------
-- 6. Validade
-- ---------------------------------------------------------------------
select is(pg_temp.estado('v-manual'), 'ok', 'o anúncio do levantamento manual vale até a data da régua');
update public.mercado_anuncios set ultima_vez_visto = now() - interval '10 days', primeira_vez_visto = now() - interval '20 days'
 where id_externo = 'v-velho';
update public.mercado_regras set regras = jsonb_set(regras, '{manual,frase_ate}', '"2026-01-01"') where ativa;
select app.mercado_verificar();
select is(pg_temp.estado('v-velho'), 'vencido:nao_visto_8_dias', 'não visto há 10 dias: vencido');
select is(pg_temp.estado('v-manual'), 'vencido:levantamento_manual_vencido', 'passada a data, o levantamento manual vence');

-- ---------------------------------------------------------------------
-- 7. Confronto com A Corrida dos Bairros
-- ---------------------------------------------------------------------
select is(public.mercado_coleta_abrir('corrida-dos-bairros', null, 'auto', 'corrida@1') ->> 'motivo', 'fonte_nao_liberada',
          'A Corrida dos Bairros nasce desligada: sem a decisão do dono, nem entra na conta');
select pg_temp.entrar('a0000000-0000-4000-8000-000000019101'::uuid, 'gestor');
select public.mercado_fonte_liberar('corrida-dos-bairros', true,
                                    'Teste: o dono decidiu usar a Corrida e mandou o e-mail avisando o uso');
select pg_temp.sair();
insert into t191 values ('cc', public.mercado_coleta_abrir('corrida-dos-bairros', null, 'auto', 'corrida@1') ->> 'coleta_id');
insert into public.mercado_indices (serie, mes, valor, nome, unidade, local, regiao_id, sub, modo, amostra, aproximado,
                                    metodo, fonte, url, coleta_id)
values ('corrida-natal-neopolis-terreno-venda', date_trunc('month', current_date)::date, 500, 'Mediana do m² de terreno',
        'R$/m²', 'Neópolis', 'natal-neopolis', 'terreno', 'venda', 40, false, 'csv', 'corrida-dos-bairros',
        'https://acorridadosbairros.com.br/rn/natal/dados.csv', (select valor::bigint from t191 where chave = 'cc'));
select public.mercado_coleta_fechar((select valor::bigint from t191 where chave = 'cc'));
do $v$ begin if to_regprocedure('app.mercado_verificar_se_pendente()') is not null then execute 'select app.mercado_verificar_se_pendente()'; end if; end $v$; -- 20261125120000: a veracidade roda depois
select app.mercado_verificar();
select is((select estado from public.mercado_celulas where regiao_id = 'natal-neopolis' and sub = 'terreno'), 'quarentena',
          'nossa mediana o dobro da Corrida: a célula entra em quarentena');
select is((select estado from public.mercado_celulas where regiao_id = 'natal-lagoa-nova' and sub = 'apartamento'),
          'sem_referencia', 'onde a Corrida não cobre: sem referência');

select pg_temp.entrar('a0000000-0000-4000-8000-000000019102'::uuid, 'sdr');
select throws_ok($$ select public.mercado_celula_liberar('natal-neopolis', 'venda', 'terreno', 'mistura de lote em condomínio') $$,
                 '42501', null, 'o SDR não aprova a causa de uma quarentena');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000019101'::uuid, 'gestor');
select is(public.mercado_celula_liberar('natal-neopolis', 'venda', 'terreno',
                                        'A Corrida mede só lotes avulsos; a nossa amostra tem lotes em condomínio.') ->> 'estado',
          'alerta', 'com a causa escrita e aprovada, a célula sai da quarentena para alerta (sem adjetivo)');
select pg_temp.sair();
select app.mercado_verificar();
select is((select estado from public.mercado_celulas where regiao_id = 'natal-neopolis' and sub = 'terreno'), 'alerta',
          'e a próxima verificação não a devolve para a quarentena');

select * from finish();
rollback;

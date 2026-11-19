-- =====================================================================
-- pgTAP — A conferência semanal do mercado pela equipe (migração 20261119163000)
--
-- Decisão do dono (18/11/2026): além da veracidade automática, toda semana
-- uma pequena amostra vai para a equipe conferir no link. Este arquivo prova:
--
--   1. O SORTEIO: só com a chave ligada; 20 itens (acaso, os que sustentam
--      vantagens, marcados), o que falta num estrato vai para o acaso, uma vez
--      por semana, com a impressão das coletas;
--   2. A RESPOSTA: admin, gestor e SDR respondem; outro papel não; resposta
--      dada não muda nem some; preço e área diferentes pedem o valor visto;
--   3. "ERRADO" NA HORA: o anúncio sai das contas (contestado) e a vantagem
--      cuja prova o usa sai da IA; "é imóvel nosso" grava o par; "saiu do ar"
--      vence o anúncio;
--   4. DESATUALIZADO: a fonte também mudou o preço depois: não é erro;
--   5. A SAÚDE DA FONTE: 3 erros entre os do acaso põem a fonte em quarentena
--      (caso 14 do §12.5), e a vantagem nova dessa fonte já nasce marcada;
--   6. A CAUSA do erro: só admin e gestor, uma vez; amostra vencida não aceita
--      resposta;
--   7. A TRAVA DA RENOVAÇÃO fecha sem conferência de verdade: semanas sem
--      amostra sorteada não valem como em dia, e "não consegui" não conta;
--      a folga é só o começo (antes da primeira conferência, com a primeira
--      amostra no prazo).
--
-- O CI roda as migrações sem identidade e a semente grava 'komune': o teste
-- vira Imova dentro da transação (como o 121). Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if to_regclass('public.mercado_conferencias') is null then
    raise exception 'pgTAP 193 é da Imova: rode num banco com as migrações de mercado (Imova ou sem identidade)';
  end if;
end $$;

select plan(37);

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

insert into public.allowed_users (email, role, note) values
  ('m193.g@teste.local', 'gestor', 'pgTAP 193'),
  ('m193.s@teste.local', 'sdr', 'pgTAP 193'),
  ('m193.l@teste.local', 'leitura', 'pgTAP 193');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000019301'::uuid, 'm193.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000019302'::uuid, 'm193.s@teste.local', '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000019303'::uuid, 'm193.l@teste.local', '{"full_name":"Lia Leitura"}');

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
create function pg_temp.sdr() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000019302'::uuid, 'sdr')
$$;
create function pg_temp.an(p_id text, p_preco bigint, p_area numeric) returns jsonb language sql as $$
  select jsonb_build_object('id_externo', p_id, 'url', 'https://exemplo-permitido.com.br/imovel/' || p_id,
                            'modo', 'venda', 'tipo', 'terreno', 'preco', p_preco, 'area_total', p_area,
                            'bairro', 'Neópolis', 'cidade', 'Natal')
$$;
create function pg_temp.aid(p_id text) returns uuid language sql as $$
  select id from public.mercado_anuncios where id_externo = p_id
$$;
-- O item da amostra desta semana de um anúncio, ou o n-ésimo de um estrato.
create function pg_temp.item(p_id text) returns bigint language sql as $$
  select c.id from public.mercado_conferencias c
   where c.mercado_anuncio_id = pg_temp.aid(p_id) and c.semana = app.mercado_semana()
$$;
create function pg_temp.item_a(p_n int) returns bigint language sql as $$
  select c.id from public.mercado_conferencias c
   where c.estrato = 'A' and c.semana = app.mercado_semana() and c.resposta is null
   order by c.ordem offset p_n - 1 limit 1
$$;
create temp table t193 (chave text primary key, valor text);
grant select, insert on t193 to authenticated;

update public.anuncios set excluido_em = now() where excluido_em is null;
update public.anuncios_no_canal_pro set excluido_em = now() where excluido_em is null;
insert into public.anuncios (codigo, tipo, negocio, preco_venda, area_total, bairro, cidade, estado)
values ('TE0009T', 'terreno', 'venda', 900000, 5000, 'Ponta Negra', 'Natal', 'RN');

-- ---------------------------------------------------------------------
-- 1. O sorteio
-- ---------------------------------------------------------------------
select ok(app.mercado_amostra_em_dia(), 'antes da primeira amostra, a trava da renovação não fecha (o começo)');
update public.app_settings set value = value || '{"ligado": false}'::jsonb where key = 'mercado';
select is(app.mercado_sortear_amostra(), 0, 'desligada, não há sorteio');
update public.app_settings set value = value || '{"ligado": true}'::jsonb where key = 'mercado';

insert into t193 values ('c', public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'chavesnamao@1') ->> 'coleta_id');
select public.mercado_anuncios_registrar((select valor::bigint from t193 where chave = 'c'),
  (select jsonb_agg(pg_temp.an('k-' || g, (round(300 * power(1.04, g)) * (950 + 4 * g))::bigint, round(300 * power(1.04, g))))
     from generate_series(1, 35) g));
select public.mercado_coleta_fechar((select valor::bigint from t193 where chave = 'c'), null, null, null, true, repeat('b', 64));

-- Uma vantagem aprovada cuja prova usa o k-5.
select public.mercado_argumentos_propor('TE0009T', jsonb_build_array(jsonb_build_object(
  'chave', 'te9-tamanho', 'regra', 'T1', 'eixo', 'tamanho', 'forca', 'A', 'molde', 'T1-1',
  'texto', 'É mais área do que se costuma achar: dos 35 terrenos anunciados que levantamos, 34 eram menores.',
  'fonte_texto', 'pelos anúncios da região que acompanhamos', 'numeros', '{"n": 35, "menores": 34}'::jsonb,
  'prova', jsonb_build_object('anuncios', jsonb_build_array(pg_temp.aid('k-5')::text)),
  'fontes', jsonb_build_array('chavesnamao-mcp'), 'data_dado', app.mercado_hoje(), 'coletado_em', now(),
  'valido_ate', app.mercado_hoje() + 10, 'hash_dados', md5('te9'))), 'motor@1');
select pg_temp.entrar('a0000000-0000-4000-8000-000000019301'::uuid, 'gestor');
select public.mercado_argumento_decidir((select id from public.mercado_argumentos where chave = 'te9-tamanho'), 'aprovar');
select pg_temp.sair();
select is(jsonb_array_length(app.mercado_vantagens_para_ia() -> 'TE0009T' -> 'diferenciais'), 1,
          'antes da conferência, a IA tem a vantagem de tamanho');

select is(app.mercado_sortear_amostra(), 20, 'a amostra da semana tem 20 itens');
select is((select string_agg(estrato || '=' || n, ' ' order by estrato)
             from (select estrato, count(*) as n from public.mercado_conferencias
                    where semana = app.mercado_semana() group by 1) x),
          'A=17 B=1 C=2', 'B pega o anúncio da prova, C os de fonte nova, e o que faltou vai para o acaso');
select is(app.mercado_sortear_amostra(), 0, 'uma amostra por semana');
select ok((select bool_and(hash_rodada ~ '^[0-9a-f]{32}$' and link like 'https://%' and vence_em = semana + 7)
             from public.mercado_conferencias where semana = app.mercado_semana()),
          'cada item leva a impressão das coletas, o link e o prazo (a segunda seguinte)');
select is(pg_temp.item('k-5') is not null, true, 'o anúncio que sustenta a vantagem está na amostra');
select ok(app.mercado_amostra_em_dia(), 'a primeira amostra da história, ainda no prazo, não fecha a trava');

-- ---------------------------------------------------------------------
-- 2 e 3. A resposta e o "errado" na hora
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000019303'::uuid, 'leitura');
select throws_ok($$ select public.mercado_conferir(pg_temp.item_a(1), 'confere') $$, '42501', null,
                 'outro papel não confere');
select pg_temp.sair();

select pg_temp.sdr();
select is(public.mercado_conferir(pg_temp.item('k-5'), 'preco_diferente') ->> 'motivo', 'preco_visto_obrigatorio',
          '"preço diferente" pede o preço visto');
insert into t193 values ('e1', public.mercado_conferir(pg_temp.item('k-5'), 'preco_diferente', '{"preco": 250000}',
                                                        'a página mostra outro valor')::text);
select pg_temp.sair();
select is((select (valor::jsonb ->> 'vantagens_suspensas')::int from t193 where chave = 'e1'), 1,
          'o SDR marca preço diferente: a vantagem que usava o anúncio é suspensa');
select is((select estado from public.mercado_anuncios where id_externo = 'k-5'), 'contestado',
          'o anúncio sai de todas as contas na hora');
select is((select correcao_humana from public.mercado_anuncios where id_externo = 'k-5'), '{"preco": 250000}'::jsonb,
          'o valor visto fica ao lado do original');
select ok((select status = 'proposto' and 'contestado' = any (marcas) from public.mercado_argumentos where chave = 'te9-tamanho'),
          'a vantagem volta para aprovação, marcada contestado');
select is(app.mercado_vantagens_para_ia(), '{}'::jsonb, 'e sai da IA');

select pg_temp.sdr();
select is(public.mercado_conferir(pg_temp.item('k-5'), 'confere') ->> 'motivo', 'ja_conferido', 'resposta dada não muda');
select pg_temp.sair();
select throws_ok($$ update public.mercado_conferencias set resposta = 'confere' where id = pg_temp.item('k-5') $$,
                 '42501', null, 'nem por baixo dos panos');
select throws_ok($$ delete from public.mercado_conferencias where id = pg_temp.item('k-5') $$,
                 '42501', null, 'conferência não se apaga');

select pg_temp.sdr();
select is(public.mercado_conferir(pg_temp.item_a(1), 'e_imovel_nosso') ->> 'motivo', 'codigo_do_imovel_obrigatorio',
          '"é imóvel nosso" pede o código');
insert into t193 values ('nosso', (select mercado_anuncio_id::text from public.mercado_conferencias where id = pg_temp.item_a(1)));
select is(public.mercado_conferir(pg_temp.item_a(1), 'e_imovel_nosso', '{"codigo": "TE0009T"}') ->> 'ok', 'true',
          'com o código, grava');
insert into t193 values ('saiu', (select mercado_anuncio_id::text from public.mercado_conferencias where id = pg_temp.item_a(1)));
select is(public.mercado_conferir(pg_temp.item_a(1), 'saiu_do_ar') ->> 'ok', 'true', '"saiu do ar" grava');
select pg_temp.sair();
select is((select estado || ':' || nosso_imovel_codigo from public.mercado_anuncios
            where id = (select valor::uuid from t193 where chave = 'nosso')), 'oculto_proprio:TE0009T',
          '"é imóvel nosso": o par vira decisão e o anúncio sai das contas');
select is((select estado from public.mercado_anuncios where id = (select valor::uuid from t193 where chave = 'saiu')), 'vencido',
          '"saiu do ar": vence antes do prazo (não é erro)');

-- ---------------------------------------------------------------------
-- 4. Desatualizado
-- ---------------------------------------------------------------------
insert into t193 values ('c2', public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'chavesnamao@1') ->> 'coleta_id');
select public.mercado_anuncios_registrar((select valor::bigint from t193 where chave = 'c2'),
  jsonb_build_array(pg_temp.an('k-5', 250000, round(300 * power(1.04, 5)))));
select is((select estado from public.mercado_anuncios where id_externo = 'k-5'), 'ok',
          'a fonte também mudou o preço: o anúncio volta para as contas com o preço novo');
select is((select reclassificada from public.mercado_conferencias where id = pg_temp.item('k-5')), 'desatualizado',
          'e a resposta vira "desatualizado" (não conta como erro da coleta)');

-- ---------------------------------------------------------------------
-- 5. A saúde da fonte
-- ---------------------------------------------------------------------
select pg_temp.sdr();
select public.mercado_conferir(pg_temp.item_a(1), 'preco_diferente', '{"preco": 1}');
select public.mercado_conferir(pg_temp.item_a(1), 'area_diferente', '{"area": 1}');
select public.mercado_conferir(pg_temp.item_a(1), 'tipo_ou_lugar_errado', '{"certo": "casa"}');
select pg_temp.sair();
select is((select estado from app.mercado_saude_fontes() where fonte = 'chavesnamao-mcp'), 'quarentena',
          '3 erros entre os do acaso: a fonte entra em quarentena');
select ok('chavesnamao-mcp' = any (app.mercado_fontes_em_quarentena()), 'e a lista de quarentena a traz');
select ok(app.mercado_amostra_em_dia(), 'a amostra da semana foi conferida');

-- ---------------------------------------------------------------------
-- 6. A causa e a amostra vencida
-- ---------------------------------------------------------------------
select pg_temp.sdr();
select throws_ok($$ select public.mercado_conferencia_causa(
                     (select id from public.mercado_conferencias where ok = false and causa is null limit 1), 'coleta') $$,
                 '42501', null, 'o SDR não escreve a causa');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000019301'::uuid, 'gestor');
insert into t193 values ('erro', (select id::text from public.mercado_conferencias where ok = false and causa is null
                                    and reclassificada is null order by id limit 1));
select is(public.mercado_conferencia_causa((select valor::bigint from t193 where chave = 'erro'), 'fonte') ->> 'ok', 'true',
          'o gestor escreve a causa do erro');
select is(public.mercado_conferencia_causa((select valor::bigint from t193 where chave = 'erro'), 'coleta') ->> 'motivo',
          'item_sem_erro_ou_com_causa', 'uma vez só');
select pg_temp.sair();

select app.mercado_sortear_amostra(app.mercado_hoje() - 14);
select pg_temp.sdr();
select is(public.mercado_conferir((select id from public.mercado_conferencias where semana = app.mercado_semana(app.mercado_hoje() - 14)
                                    order by id limit 1), 'confere') ->> 'motivo',
          'amostra_vencida', 'amostra de duas semanas atrás não aceita mais resposta');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 7. A trava da renovação fecha sem conferência de verdade
-- ---------------------------------------------------------------------
-- O sorteio "falhou" por quatro semanas: tudo o que existe vai 4 semanas para trás.
alter table public.mercado_conferencias disable trigger mercado_conferencia_imutavel;
update public.mercado_conferencias
   set semana = semana - 28, vence_em = vence_em - 28, sorteado_em = sorteado_em - interval '28 days';
alter table public.mercado_conferencias enable trigger mercado_conferencia_imutavel;
select ok(not app.mercado_amostra_em_dia(),
          'sem amostra sorteada nas 2 últimas semanas (o cron falhou): a trava fecha e a renovação automática para');
select ok(app.mercado_sortear_amostra() > 0, 'a amostra desta semana sai');
select pg_temp.sdr();
select public.mercado_conferir(pg_temp.item_a(1), 'nao_consegui');
select pg_temp.sair();
select ok(not app.mercado_amostra_em_dia(), '"não consegui" em todos os itens respondidos não conta como conferida');
select pg_temp.sdr();
select public.mercado_conferir(pg_temp.item_a(1), 'confere');
select pg_temp.sair();
select ok(app.mercado_amostra_em_dia(), 'um item conferido de verdade (certo ou errado) põe a amostra em dia');

select * from finish();
rollback;

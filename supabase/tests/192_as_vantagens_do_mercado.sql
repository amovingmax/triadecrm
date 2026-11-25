-- =====================================================================
-- pgTAP — As vantagens de cada imóvel nosso (migração 20261119164000)
--
-- Decisões do dono (16/11 e 18/11/2026): o sistema calcula e propõe, a gestão
-- aprova POR IMÓVEL, a vantagem aprovada se renova sozinha quando cada número
-- muda até 10% (e até 20% desde a aprovação), e a IA só recebe o que está
-- aprovado e válido. Este arquivo prova:
--
--   1. O MOTOR PROPÕE: nova nasce proposta; texto com palavra proibida ou nome
--      de portal é recusado, e também a fonte citada que nomeia o portal de
--      onde vêm os anúncios; o "não use" com nome de portal fica de fora; a
--      vantagem tirada de anúncios vale no máximo 14 dias;
--   2. A GESTÃO APROVA: só admin e gestor; por vantagem ou pelo imóvel todo;
--      "conferir" só com confirmação; preço travado por par sem decisão;
--   3. A IA LÊ: só aprovada, válida, com a ficha igual e a chave ligada; sem
--      prova, sem link e sem nome de portal (o filtro roda de novo na leitura);
--   4. A RENOVAÇÃO: "20 de 26" → "21 de 27" renova sozinha (caso 16 do §12.5);
--      um novo envio na mesma rodada de coleta não conta como rodada nova;
--      frase diferente da aprovada volta para aprovação; → "16 de 22" volta
--      para aprovação (caso 17); a que some do motor vence e, se voltar,
--      reabre como proposta; a ficha que muda devolve para aprovação;
--   5. O VENCIMENTO e o histórico só com acréscimo.
--
-- O CI roda as migrações sem identidade e a semente grava 'komune': o teste
-- vira Imova dentro da transação (como o 121). As datas são as de Fortaleza
-- (app.mercado_hoje()), como nas funções. Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if to_regclass('public.mercado_argumentos') is null then
    raise exception 'pgTAP 192 é da Imova: rode num banco com as migrações de mercado (Imova ou sem identidade)';
  end if;
end $$;

select plan(47);

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
  ('m192.g@teste.local', 'gestor', 'pgTAP 192'),
  ('m192.s@teste.local', 'sdr', 'pgTAP 192');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000019201'::uuid, 'm192.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000019202'::uuid, 'm192.s@teste.local', '{"full_name":"Sara SDR"}');

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
  select pg_temp.entrar('a0000000-0000-4000-8000-000000019201'::uuid, 'gestor')
$$;

-- Uma vantagem como o motor manda.
create function pg_temp.v(p_chave text, p_regra text, p_eixo text, p_forca text, p_numeros jsonb,
                          p_texto text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
           'chave', p_chave, 'regra', p_regra, 'eixo', p_eixo, 'forca', p_forca, 'molde', p_regra || '-1',
           'anel', 'Capim Macio', 'localidade', 'Capim Macio', 'regiao_id', 'natal-capim-macio', 'sub', 'terreno',
           'texto', p_texto, 'fonte_texto', 'pelos anúncios da região que acompanhamos', 'numeros', p_numeros,
           'prova', jsonb_build_object('anuncios', '[]'::jsonb, 'itens', '[]'::jsonb),
           'fontes', jsonb_build_array('chavesnamao-mcp'), 'data_dado', app.mercado_hoje(),
           'coletado_em', now(), 'valido_ate', app.mercado_hoje() + 60,
           'momentos', jsonb_build_array('apresentacao', 'retomada'), 'objecoes', jsonb_build_array('tamanho'),
           'hash_dados', md5(p_chave || p_numeros::text)) || p_extra
$$;
create function pg_temp.tam(p_n int, p_menores int) returns jsonb language sql as $$
  select pg_temp.v('cm-tamanho', 'T1', 'tamanho', 'A', jsonb_build_object('n', p_n, 'menores', p_menores),
                   'Área desse tamanho é rara no bairro: dos ' || p_n || ' terrenos anunciados lá que levantamos, '
                   || p_menores || ' eram menores.')
$$;
create function pg_temp.renda() returns jsonb language sql as $$
  select pg_temp.v('cm-renda', 'C2', 'regiao', 'B', '{"renda": 8234, "cidade": 3680}'::jsonb,
                   'Pelo Censo 2022, quem chefia a casa em Capim Macio ganha em média R$ 8.234, mais que o dobro da média de Natal.',
                   jsonb_build_object('fonte_texto', 'pelo Censo 2022 do IBGE', 'fontes', jsonb_build_array('ibge'),
                                      'valido_ate', app.mercado_hoje() + 365, 'momentos', '[]'::jsonb,
                                      'objecoes', jsonb_build_array('regiao')))
$$;
create function pg_temp.preco(p_texto text default 'Dos 12 terrenos parecidos anunciados no bairro que levantamos, 10 pedem mais.')
returns jsonb language sql as $$
  select pg_temp.v('cm-preco', 'P3', 'preco', 'B', '{"n": 12, "pedem_mais": 10}'::jsonb, p_texto,
                   jsonb_build_object('explica_preco', true, 'marcas', jsonb_build_array('conferir'),
                                      'objecoes', jsonb_build_array('caro')))
$$;
-- Uma rodada de coleta nova: uma coleta automática boa num dia depois de hoje
-- (a rodada é o dia da última coleta automática boa).
create function pg_temp.nova_rodada(p_dias int) returns void language plpgsql as $$
declare
  v_id bigint;
begin
  v_id := (public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'chavesnamao@1') ->> 'coleta_id')::bigint;
  perform public.mercado_coleta_fechar(v_id, null, null, null, false);
  update public.mercado_coletas
     set inicio = now() + make_interval(days => p_dias), fim = now() + make_interval(days => p_dias)
   where id = v_id;
end $$;
create function pg_temp.rodadas(p_chave text) returns int language sql as $$
  select rodadas_seguidas from public.mercado_argumentos where imovel_codigo = 'TE0001T' and chave = p_chave
$$;
create function pg_temp.st(p_chave text) returns text language sql as $$
  select status from public.mercado_argumentos where imovel_codigo = 'TE0001T' and chave = p_chave
$$;
create function pg_temp.aid(p_chave text) returns uuid language sql as $$
  select id from public.mercado_argumentos where imovel_codigo = 'TE0001T' and chave = p_chave
$$;
create temp table t192 (chave text primary key, valor jsonb);
grant select, insert on t192 to authenticated;

update public.anuncios set excluido_em = now() where excluido_em is null;
update public.anuncios_no_canal_pro set excluido_em = now() where excluido_em is null;
insert into public.anuncios (codigo, tipo, negocio, preco_venda, area_total, bairro, cidade, estado, titulo)
values ('TE0001T', 'terreno', 'venda', 5500000, 3000, 'Capim Macio', 'Natal', 'RN', 'Terreno de 3.000 m² em Capim Macio');
update public.app_settings set value = value || '{"ligado": true}'::jsonb where key = 'mercado';

-- ---------------------------------------------------------------------
-- 1. O motor propõe
-- ---------------------------------------------------------------------
insert into t192 values ('r1', public.mercado_argumentos_propor('TE0001T', jsonb_build_array(
  pg_temp.tam(26, 20), pg_temp.renda(), pg_temp.preco(),
  pg_temp.v('cm-ruim', 'S1', 'serie', 'C', '{"var": 9.6}'::jsonb, 'O bairro tem valorização garantida: subiu 9,6% em 12 meses.'),
  pg_temp.v('cm-portal', 'S1', 'serie', 'C', '{"var": 9.6}'::jsonb, 'Pelos anúncios do ZAP, o bairro é muito procurado.'),
  pg_temp.v('cm-fonte', 'D1', 'documentacao', 'C', '{"n": 5}'::jsonb, 'O terreno tem a documentação em dia, o que é raro no bairro.',
            jsonb_build_object('fonte_texto', 'pelos anúncios do Chaves na Mão')),
  pg_temp.v('cm-aviso', 'D2', 'documentacao', 'C', '{"n": 6}'::jsonb, 'O terreno tem escritura e registro, o que facilita o financiamento.',
            jsonb_build_object('aviso', 'Conferir na página da Lopes Imóveis antes de usar'))),
  'motor@1', array['comparação do preço com outros terrenos', 'não cite o Chaves na Mão']));
select is((select (valor ->> 'novos')::int from t192 where chave = 'r1'), 3, 'três vantagens nascem propostas');
select is((select jsonb_array_length(valor -> 'recusados') from t192 where chave = 'r1'), 4,
          '"valorização garantida", portal no texto, portal na fonte citada e imobiliária no aviso: recusados pelo banco');
select ok((select valor -> 'recusados' @> '[{"chave": "cm-fonte"}, {"chave": "cm-aviso"}]'::jsonb from t192 where chave = 'r1'),
          'a fonte citada que nomeia o Chaves na Mão não chega à IA, nem o aviso com o nome da imobiliária');
select is((select (valor ->> 'nao_use_recusados')::int from t192 where chave = 'r1'), 1,
          'o "não use" que nomeia o portal fica de fora (e é contado)');
select is(pg_temp.st('cm-tamanho'), 'proposto', 'vantagem nova nasce proposta');
select is((select valido_ate from public.mercado_argumentos where id = pg_temp.aid('cm-tamanho')), app.mercado_hoje() + 14,
          'a vantagem tirada de anúncios vale no máximo 14 dias, mesmo que o motor diga 60');
select is((select valido_ate from public.mercado_argumentos where id = pg_temp.aid('cm-renda')), app.mercado_hoje() + 365,
          'a do Censo vale o que o motor diz');
select is(public.mercado_argumentos_propor('NAO-EXISTE', '[]'::jsonb, 'motor@1') ->> 'motivo', 'imovel_desconhecido',
          'imóvel fora da carteira: recusado');
select is(app.mercado_vantagens_para_ia(), '{}'::jsonb, 'nada aprovado, nada vai à IA');

-- ---------------------------------------------------------------------
-- 2. A gestão aprova
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000019202'::uuid, 'sdr');
select throws_ok($$ select public.mercado_argumento_decidir(pg_temp.aid('cm-tamanho'), 'aprovar') $$, '42501', null,
                 'o SDR não aprova vantagem');
select ok((select count(*) from public.mercado_argumentos where imovel_codigo = 'TE0001T') = 3,
          'mas vê as vantagens propostas');
select pg_temp.sair();

select pg_temp.gestor();
select is(public.mercado_argumento_decidir(pg_temp.aid('cm-tamanho'), 'aprovar') ->> 'status', 'aprovado',
          'o gestor aprova uma vantagem');
insert into t192 values ('ap', public.mercado_argumentos_aprovar_imovel('TE0001T'));
select pg_temp.sair();
select is((select (valor ->> 'aprovadas')::int from t192 where chave = 'ap'), 1, 'aprovar o imóvel aprova o que pode');
select is((select valor -> 'nao_aprovadas' -> 0 ->> 'motivo' from t192 where chave = 'ap'), 'precisa_confirmar_que_conferiu',
          'a marcada "conferir" espera a confirmação de quem aprova');
select pg_temp.gestor();
select is(public.mercado_argumento_decidir(pg_temp.aid('cm-preco'), 'aprovar', null, true) ->> 'status', 'aprovado',
          'confirmando que conferiu, aprova');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 3. A IA lê
-- ---------------------------------------------------------------------
select is(jsonb_array_length(app.mercado_vantagens_para_ia() -> 'TE0001T' -> 'diferenciais'), 3,
          'a IA recebe as três aprovadas do imóvel');
select is(app.mercado_vantagens_para_ia() -> 'TE0001T' -> 'diferenciais' -> 0 ->> 'id', 'cm-tamanho',
          'em ordem de força (A antes de B)');
select ok(not (app.mercado_vantagens_para_ia()::text ~* '(prova|https?://|chavesnamao|chaves na m|lopes|hash)'),
          'sem prova, sem link, sem nome de fonte de anúncio e sem impressão digital');
select is(app.mercado_vantagens_para_ia() -> 'TE0001T' -> 'nao_use', '["comparação do preço com outros terrenos"]'::jsonb,
          'com a linha "Não use neste imóvel", sem o item que nomeia o portal');
-- Mesmo gravada por baixo dos panos, a vantagem que nomeia o portal não chega à IA.
update public.mercado_argumentos set fonte_texto = 'pelos anúncios do Chaves na Mão' where id = pg_temp.aid('cm-renda');
select is(jsonb_array_length(app.mercado_vantagens_para_ia() -> 'TE0001T' -> 'diferenciais'), 2,
          'a leitura da IA filtra de novo: a vantagem com o portal na fonte citada some');
update public.mercado_argumentos set fonte_texto = 'pelo Censo 2022 do IBGE' where id = pg_temp.aid('cm-renda');
update public.app_settings set value = value || '{"ligado": false}'::jsonb where key = 'mercado';
select is(app.mercado_vantagens_para_ia(), '{}'::jsonb, 'desligada a chave, a IA não recebe nada');
update public.app_settings set value = value || '{"ligado": true}'::jsonb where key = 'mercado';
select pg_temp.entrar('a0000000-0000-4000-8000-000000019202'::uuid, 'sdr');
select is(jsonb_array_length(public.mercado_vantagens_para_ia() -> 'TE0001T' -> 'diferenciais'), 3,
          'a tela "Para a IA" mostra exatamente o que a IA recebe');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 4. A renovação
-- ---------------------------------------------------------------------
insert into t192 values ('r2', public.mercado_argumentos_propor('TE0001T',
  jsonb_build_array(pg_temp.tam(27, 21), pg_temp.renda(), pg_temp.preco()), 'motor@1'));
select is((select (valor ->> 'renovados')::int from t192 where chave = 'r2'), 3, '"20 de 26" vira "21 de 27": renova sozinha');
select is(pg_temp.st('cm-tamanho'), 'aprovado', 'e continua aprovada');
select is((select numeros from public.mercado_argumentos where id = pg_temp.aid('cm-tamanho')),
          '{"n": 27, "menores": 21}'::jsonb, 'com os números da rodada atual (nunca os da aprovação antiga)');
select is((select count(*)::int from public.mercado_argumento_eventos
            where argumento_id = pg_temp.aid('cm-tamanho') and evento = 'renovado'), 1,
          'a renovação fica no histórico com a prova');
select ok(app.mercado_vantagens_para_ia()::text like '%dos 27 terrenos%', 'a IA já recebe o texto novo');
select is(pg_temp.rodadas('cm-renda'), 1, 'um novo envio na mesma rodada de coleta não conta como rodada nova');

-- Na mesma rodada, o motor manda a vantagem de preço com outra frase.
insert into t192 values ('r2b', public.mercado_argumentos_propor('TE0001T',
  jsonb_build_array(pg_temp.tam(27, 21), pg_temp.renda(),
                    pg_temp.preco('Quase todos os terrenos parecidos do bairro pedem mais: 10 de 12.')), 'motor@1'));
select ok((select status = 'proposto' and motivo_status like '%texto_mudou%' from public.mercado_argumentos
            where id = pg_temp.aid('cm-preco')),
          'frase diferente da aprovada (mesmo com os mesmos números): volta para aprovação');

select pg_temp.nova_rodada(1);
insert into t192 values ('r3', public.mercado_argumentos_propor('TE0001T',
  jsonb_build_array(pg_temp.tam(22, 16), pg_temp.renda()), 'motor@1'));
select is(pg_temp.rodadas('cm-renda'), 2, 'a rodada de coleta seguinte soma uma rodada');
select is(pg_temp.st('cm-tamanho'), 'proposto', '"21 de 27" vira "16 de 22": mudou mais de 10%, volta para aprovação');
select ok((select motivo_status like 'renovacao_negada:%numero_mudou_mais_de_10%' from public.mercado_argumentos
            where id = pg_temp.aid('cm-tamanho')), 'com o motivo escrito');
select is((select count(*)::int from public.mercado_argumento_eventos
            where argumento_id = pg_temp.aid('cm-tamanho') and evento = 'voltou_para_aprovacao'), 1,
          'e o antes e o depois no histórico');
select is(pg_temp.st('cm-preco'), 'vencido', 'a que sumiu do motor vence na hora');
select is(jsonb_array_length(app.mercado_vantagens_para_ia() -> 'TE0001T' -> 'diferenciais'), 1,
          'a IA fica só com a do Censo');

insert into t192 values ('r4', public.mercado_argumentos_propor('TE0001T',
  jsonb_build_array(pg_temp.tam(22, 16), pg_temp.renda(), pg_temp.preco()), 'motor@1'));
select is(pg_temp.st('cm-preco'), 'proposto', 'se voltar no motor, reabre como proposta (nunca volta aprovada sozinha)');

-- O preço do nosso imóvel muda: a ficha mudou.
update public.anuncios set preco_venda = 5000000 where codigo = 'TE0001T';
select is(app.mercado_vantagens_para_ia(), '{}'::jsonb, 'a ficha mudou: nada do imóvel vai à IA até refazer');
insert into t192 values ('r5', public.mercado_argumentos_propor('TE0001T',
  jsonb_build_array(pg_temp.tam(22, 16), pg_temp.renda(), pg_temp.preco()), 'motor@1'));
select ok((select status = 'proposto' and motivo_status like '%ficha_do_imovel_mudou%' from public.mercado_argumentos
            where id = pg_temp.aid('cm-renda')), 'e a aprovada volta para aprovação com o motivo');

-- Preço travado por par sem decisão.
insert into t192 values ('c', public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'chavesnamao@1'));
select public.mercado_anuncios_registrar((select (valor ->> 'coleta_id')::bigint from t192 where chave = 'c'),
  jsonb_build_array(jsonb_build_object('id_externo', 'p192', 'url', 'https://exemplo-permitido.com.br/p192', 'tipo', 'terreno',
                                       'preco', 4200000, 'area_total', 3000, 'bairro', 'Capim Macio', 'cidade', 'Natal')));
select public.mercado_coleta_fechar((select (valor ->> 'coleta_id')::bigint from t192 where chave = 'c'));
do $v$ begin if to_regprocedure('app.mercado_verificar_se_pendente()') is not null then execute 'select app.mercado_verificar_se_pendente()'; end if; end $v$; -- 20261125120000: a veracidade roda depois
select ok(app.mercado_preco_bloqueado('TE0001T'), 'um terreno de 3.000 m² a R$ 4,2 milhões no bairro: possível mesmo imóvel');
insert into t192 values ('r6', public.mercado_argumentos_propor('TE0001T',
  jsonb_build_array(pg_temp.tam(22, 16), pg_temp.renda(), pg_temp.preco()), 'motor@1'));
select ok((select 'possivel_mesmo_imovel' = any (marcas) from public.mercado_argumentos where id = pg_temp.aid('cm-preco')),
          'a vantagem de preço ganha a marca possivel_mesmo_imovel');
select pg_temp.gestor();
select is(public.mercado_argumento_decidir(pg_temp.aid('cm-preco'), 'aprovar', null, true) ->> 'motivo', 'marca_bloqueia',
          'e não pode ser aprovada até a equipe decidir o par');
select is(public.mercado_argumento_decidir(pg_temp.aid('cm-renda'), 'aprovar') ->> 'status', 'aprovado',
          'a do Censo, com a ficha refeita, aprova de novo');
select is(public.mercado_argumento_decidir(pg_temp.aid('cm-tamanho'), 'recusar', 'Prefiro não falar de tamanho') ->> 'status',
          'recusado', 'o gestor recusa uma vantagem');
select pg_temp.sair();
insert into t192 values ('r7', public.mercado_argumentos_propor('TE0001T',
  jsonb_build_array(pg_temp.tam(22, 16), pg_temp.renda(), pg_temp.preco()), 'motor@1'));
select is(pg_temp.st('cm-tamanho'), 'recusado', 'a recusada fica recusada enquanto os números não mudam');

-- ---------------------------------------------------------------------
-- 5. Vencimento e histórico
-- ---------------------------------------------------------------------
update public.mercado_argumentos set valido_ate = app.mercado_hoje() - 1, data_dado = app.mercado_hoje() - 30
 where id = pg_temp.aid('cm-renda');
select is(app.mercado_argumentos_vencer(), 1, 'passada a validade, vence');
select is(pg_temp.st('cm-renda'), 'vencido', 'e sai da IA');
select throws_ok($$ update public.mercado_argumento_eventos set motivo = 'apagar rastro' $$, '42501', null,
                 'o histórico das vantagens só recebe acréscimo');

select * from finish();
rollback;

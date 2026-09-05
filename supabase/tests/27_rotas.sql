-- =====================================================================
-- TRIADE — pgTAP — 20260905000600: rotas de visita
--
-- O que este arquivo trava para sempre:
--
--   1. A ROTA RECONFERE, e reconfere QUATRO vezes. `app.rota_alvos` é a
--      única regra de quem entra, e ela é chamada na leitura da tela, no
--      pedido, na saída da fila e — a que importa — na GRAVAÇÃO da ordem
--      que voltou do OSRM. O buraco do dreno da Komune
--      (20260905000100_dreno_reconfere.sql) foi exatamente uma decisão
--      tomada na entrada e nunca mais reconferida; aqui o mundo muda DUAS
--      vezes dentro do ciclo, e nas duas a rota obedece.
--
--   2. A PRECISÃO NÃO É PALPITE. `public.geo_gravar` deriva a precisão do
--      `addresstype` que o OpenStreetMap devolveu, e o "else" é `incerta`,
--      nunca o palpite otimista. Foi um caso real: "Ponta Negra, Natal"
--      devolve uma PRAIA e "Cidade Satélite" devolve uma ESTAÇÃO.
--      Coordenada de precisão `cidade` ou `incerta` fica fora do
--      planejador (RF-ROT-01).
--
--   3. A COORDENADA NUNCA ENTRA MUDA. O CHECK de `organizations` recusa
--      latitude sem precisão declarada.
--
--   4. `geo_gravar` COMPLETA, não sobrescreve: coordenada corrigida à mão
--      não é apagada por um centroide de bairro.
--
-- Toda asserção de contagem é DELTA sobre a base medida no início.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(57);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
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

create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('d0000000-0000-4000-8000-0000000e00' || p_n)::uuid
$$;
create function pg_temp.tar(p_n text) returns uuid language sql as $$
  select ('d0000000-0000-4000-8000-0000000e10' || p_n)::uuid
$$;

create function pg_temp.dia() returns date
  language sql stable as $$ select (now() at time zone 'America/Fortaleza')::date $$;

-- ---------- a base, para toda contagem virar delta ----------
create function pg_temp.n_paradas() returns int
  language sql security definer set search_path = '' as $$
  select count(*)::int from public.route_stops
$$;
create function pg_temp.n_planos() returns int
  language sql security definer set search_path = '' as $$
  select count(*)::int from public.route_plans
$$;
create function pg_temp.n_lugares() returns int
  language sql security definer set search_path = '' as $$
  select count(*)::int from public.geo_places
$$;
create table pg_temp.base (chave text primary key, n int);
insert into pg_temp.base values ('paradas', pg_temp.n_paradas()),
                                ('planos',  pg_temp.n_planos()),
                                ('lugares', pg_temp.n_lugares());
create function pg_temp.delta(p_chave text, p_agora int) returns int language sql as $$
  select p_agora - (select n from pg_temp.base where chave = p_chave)
$$;

-- A fila `rotas_jobs` é global. Esvaziá-la DENTRO desta transação (que desfaz
-- tudo no fim) é o que torna determinístico o lote lido aqui.
delete from pgmq.q_rotas_jobs;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('rt.sdr@teste.local', 'sdr', 'pgTAP rotas'),
  ('rt.outra@teste.local', 'sdr', 'pgTAP rotas'),
  ('rt.gestor@teste.local', 'gestor', 'pgTAP rotas');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000e0001', 'rt.sdr@teste.local',   '{"full_name":"SDR Rota"}'),
  ('a0000000-0000-4000-8000-0000000e0002', 'rt.outra@teste.local', '{"full_name":"Outra SDR"}'),
  ('a0000000-0000-4000-8000-0000000e0003', 'rt.gestor@teste.local','{"full_name":"Gestor Rota"}');

-- =====================================================================
-- PARTE A — A PRECISÃO SAI DO QUE O OSM RESPONDEU
-- =====================================================================
-- Seis fichas sem coordenada, todas em Natal, cada uma num "bairro" cujo
-- nome é a pergunta que vai ao Nominatim.
insert into public.organizations (id, kind, name, phone_e164, city_id, neighborhood,
                                  source_id, collector, source_url)
select v.id, 'fornecedor', v.nome, v.fone, 1, v.bairro,
       (select id from public.sources order by id limit 1), 'pgtap',
       'https://exemplo.invalido/rotas'
  from (values
    (pg_temp.org('01'), 'ROTA PGTAP TIROL',      '+5584900000901', 'PGTAP Tirol'),
    (pg_temp.org('02'), 'ROTA PGTAP CAPIM',      '+5584900000902', 'PGTAP Capim'),
    (pg_temp.org('03'), 'ROTA PGTAP LAGOA',      '+5584900000903', 'PGTAP Lagoa'),
    (pg_temp.org('04'), 'ROTA PGTAP SUPRIMIDA',  '+5584900000904', 'PGTAP Tirol'),
    (pg_temp.org('05'), 'ROTA PGTAP PRAIA',      '+5584900000905', 'PGTAP Praia'),
    (pg_temp.org('06'), 'ROTA PGTAP SO CIDADE',  '+5584900000906', null)
  ) as v(id, nome, fone, bairro);

-- Bairro de verdade: `suburb` → precisão de bairro.
select is(public.geo_gravar('PGTAP Tirol, Natal, RN, Brasil', 'bairro', 1, 'PGTAP Tirol',
                            true, -5.80369, -35.19882, 'suburb', 'relation', 1757115, 'boundary',
                            'PGTAP Tirol', array[-5.8155, -5.7862, -35.2080, -35.1917],
                            'Data © OpenStreetMap contributors, ODbL 1.0') ->> 'precisao',
          'bairro', 'addresstype "suburb" vira precisão de bairro');

-- Praia: o OSM respondeu outra coisa. NÃO é bairro e NÃO é cidade.
select is(public.geo_gravar('PGTAP Praia, Natal, RN, Brasil', 'bairro', 1, 'PGTAP Praia',
                            true, -5.87360, -35.17663, 'beach', 'way', 100, 'natural',
                            'PGTAP Praia', array[-5.8830, -5.8640, -35.1830, -35.1700], null)
            ->> 'precisao',
          'incerta',
          'perguntar por um bairro e receber uma PRAIA vira precisão incerta, não "bairro"');

-- Município: precisão de cidade.
select is(public.geo_gravar('PGTAP Municipio, RN, Brasil', 'cidade', 1, null,
                            true, -5.80540, -35.20809, 'municipality', 'relation', 200, 'boundary',
                            'PGTAP Municipio', array[-5.9200, -5.6900, -35.3400, -35.1500], null)
            ->> 'precisao',
          'cidade', 'addresstype "municipality" vira precisão de cidade');

-- Logradouro: o dia em que a base tiver rua e número.
select is(public.geo_gravar('PGTAP Rua, Natal, RN, Brasil', 'bairro', 1, 'PGTAP Rua',
                            true, -5.80100, -35.20100, 'road', 'way', 300, 'highway',
                            'PGTAP Rua', null, null) ->> 'precisao',
          'logradouro', 'addresstype "road" vira precisão de logradouro');

-- Não encontrado: fica gravado como tal, sem coordenada.
select is(public.geo_gravar('PGTAP Nao Existe, Natal, RN, Brasil', 'bairro', 1, 'PGTAP Nao Existe',
                            false) ->> 'aplicadas',
          '0', 'lugar não encontrado não escreve coordenada em ficha nenhuma');
select is((select encontrado::text from public.geo_places
            where consulta = 'PGTAP Nao Existe, Natal, RN, Brasil'),
          'false', 'e fica gravado como "não encontrado", para não ser perguntado de novo');

select is(pg_temp.delta('lugares', pg_temp.n_lugares()), 5,
          'cinco perguntas gravadas no cache, e nenhuma a mais');

-- O raio sai da caixa delimitadora, pelo PostGIS, e é a incerteza em metros.
select cmp_ok((select raio_m from public.geo_places
                where consulta = 'PGTAP Tirol, Natal, RN, Brasil'), '>', 1000,
          'o raio do bairro sai da bounding box do OSM (mais de 1 km, no Tirol)');
select cmp_ok((select raio_m from public.geo_places
                where consulta = 'PGTAP Municipio, RN, Brasil'), '>',
              (select raio_m from public.geo_places where consulta = 'PGTAP Tirol, Natal, RN, Brasil'),
          'e o raio do município é maior que o do bairro — a incerteza cresce junto');

-- As fichas herdaram a coordenada da pergunta do bairro delas.
select is((select geo_precision::text from public.organizations where id = pg_temp.org('01')),
          'bairro', 'a ficha do bairro real ficou com precisão de bairro');
select is((select geo_precision::text from public.organizations where id = pg_temp.org('05')),
          'incerta', 'a ficha da praia ficou com precisão incerta');
select is((select geo_precision::text from public.organizations where id = pg_temp.org('06')),
          'cidade', 'a ficha do município ficou com precisão de cidade');

-- Capim e Lagoa: dois bairros com coordenadas distintas, para a rota ter o que ordenar.
select public.geo_gravar('PGTAP Capim, Natal, RN, Brasil', 'bairro', 1, 'PGTAP Capim',
                         true, -5.85764, -35.20145, 'suburb', 'relation', 400, 'boundary',
                         'PGTAP Capim', array[-5.8740, -5.8388, -35.2110, -35.1845], null);
select public.geo_gravar('PGTAP Lagoa, Natal, RN, Brasil', 'bairro', 1, 'PGTAP Lagoa',
                         true, -5.82269, -35.21264, 'suburb', 'relation', 500, 'boundary',
                         'PGTAP Lagoa', array[-5.8380, -5.8060, -35.2280, -35.1950], null);

-- COMPLETA, não sobrescreve: coordenada que já existe fica onde está.
select public.geo_gravar('PGTAP Tirol, Natal, RN, Brasil', 'bairro', 1, 'PGTAP Tirol',
                         true, -9.99999, -39.99999, 'suburb', 'relation', 1757115, 'boundary',
                         'PGTAP Tirol', null, null);
select cmp_ok((select lat from public.organizations where id = pg_temp.org('01')), '=',
              -5.80369::double precision,
          'ficha que JÁ tinha coordenada não é sobrescrita por uma nova geocodificação');

-- Coordenada nunca fica muda. `organizations_view` repassa lat/lng na escrita e
-- não tem coluna de precisão: uma coordenada que entre por ali chegaria sem
-- dizer o que é. O gatilho a marca como `incerta` — que é a verdade sobre ela,
-- e já a mantém fora do planejador.
update public.organizations set lat = -5.8, lng = -35.2, geo_precision = null
 where id = pg_temp.org('02');
select is((select geo_precision::text from public.organizations where id = pg_temp.org('02')),
          'incerta',
          'coordenada escrita sem precisão declarada não fica muda: vira "incerta"');

-- Meia coordenada não existe: some inteira, em vez de virar um ponto no zero.
update public.organizations set lat = -5.9, lng = null where id = pg_temp.org('02');
select is((select num_nonnulls(lat, lng) from public.organizations where id = pg_temp.org('02')),
          0, 'coordenada pela metade é apagada, não vira ponto no meio do oceano');

-- E o CHECK continua de pé como rede: caminho que passe por cima do gatilho
-- (uma carga em massa com `alter table ... disable trigger`) ainda esbarra nele.
select ok(exists (select 1 from pg_constraint where conname = 'organizations_geo_chk'),
          'o CHECK de coordenada com precisão declarada continua no banco, como rede');

-- Devolve a ficha ao estado de bairro, para o resto do arquivo seguir.
update public.organizations
   set lat = -5.85764, lng = -35.20145, geo_precision = 'bairro'::app.geo_precision
 where id = pg_temp.org('02');

-- =====================================================================
-- PARTE B — QUEM ENTRA NA ROTA
-- =====================================================================
insert into public.tasks (id, title, kind, status, due_at, assignee_id, organization_id, created_by)
select v.id, v.titulo, 'visit'::app.task_kind, 'todo'::app.task_status,
       (pg_temp.dia() + v.hora) at time zone 'America/Fortaleza',
       'a0000000-0000-4000-8000-0000000e0001', v.org,
       'a0000000-0000-4000-8000-0000000e0001'
  from (values
    (pg_temp.tar('01'), 'Visita Tirol',    pg_temp.org('01'), time '14:00'),
    (pg_temp.tar('02'), 'Visita Capim',    pg_temp.org('02'), time '15:00'),
    (pg_temp.tar('03'), 'Visita Lagoa',    pg_temp.org('03'), time '16:00'),
    (pg_temp.tar('04'), 'Visita suprimida',pg_temp.org('04'), time '16:30'),
    (pg_temp.tar('05'), 'Visita praia',    pg_temp.org('05'), time '17:00'),
    (pg_temp.tar('06'), 'Visita cidade',   pg_temp.org('06'), time '17:30')
  ) as v(id, titulo, org, hora);

select is((select count(*)::int from app.rota_alvos(pg_temp.dia(),
            'a0000000-0000-4000-8000-0000000e0001') a where a.elegivel),
          4, 'quatro das seis visitas do dia podem entrar na rota');
select is((select a.motivo from app.rota_alvos(pg_temp.dia(),
            'a0000000-0000-4000-8000-0000000e0001') a where a.task_id = pg_temp.tar('05')),
          'precisao_incerta', 'a da praia fica fora, por precisão incerta');
select is((select a.motivo from app.rota_alvos(pg_temp.dia(),
            'a0000000-0000-4000-8000-0000000e0001') a where a.task_id = pg_temp.tar('06')),
          'so_cidade', 'a que só tem município fica fora (RF-ROT-01)');

-- =====================================================================
-- PARTE C — O CICLO INTEIRO, COM O MUNDO MUDANDO NO MEIO
-- =====================================================================
-- 1. A pessoa pede a rota. Neste instante, as quatro ainda valem.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000e0001', 'sdr');
select is(public.rota_montar(pg_temp.dia(), null, 4) ->> 'enfileirado', 'true',
          'a rota é pedida e entra na fila');
select is(public.rota_montar(pg_temp.dia(), null, 4) ->> 'alvos_elegiveis', '4',
          'e o pedido conta as quatro elegíveis do momento');
select is(public.rota_do_dia(pg_temp.dia()) -> 'plano' ->> 'status', 'enfileirada',
          'o plano fica "enfileirada" até o worker responder');
select is(public.rota_do_dia(pg_temp.dia()) -> 'plano' ->> 'tentativa', '2',
          'pedir de novo reusa o plano do dia e incrementa a tentativa, sem criar outro');
select pg_temp.sair();

select is(pg_temp.delta('planos', pg_temp.n_planos()), 1,
          'um plano por pessoa e por dia, mesmo com dois pedidos');

-- 2. O MUNDO MUDA — a ficha do Tirol entra na lista de supressão DEPOIS de
--    o pedido estar na fila. É a linha do tempo do dreno da Komune.
select app.suppress('phone', '+5584900000901', 'pgTAP rotas: pediu para sair', null, null);

-- 3. O worker tira o pedido da fila. A reconferência 3 de 4 acontece aqui.
create table pg_temp.lote as select public.rota_proximas(5) as pedidos;

select is(jsonb_array_length((select pedidos from pg_temp.lote)), 1,
          'o worker recebe UM pedido: a mensagem da tentativa anterior é descartada, '
          'senão o OSRM calcularia o mesmo dia duas vezes');
select is(jsonb_array_length((select pedidos -> 0 -> 'paradas' from pg_temp.lote)), 3,
          'e recebe TRÊS paradas, não quatro: a que foi suprimida depois do pedido não sai daqui');
select ok(not exists (
    select 1 from jsonb_array_elements((select pedidos -> 0 -> 'paradas' from pg_temp.lote)) p
     where p ->> 'task_id' = pg_temp.tar('01')::text),
  'a visita suprimida não aparece em lugar nenhum do que vai ao OSRM');

-- 4. O OSRM responde. O worker manda gravar QUATRO paradas — inclusive a
--    suprimida, como se a tivesse calculado. A reconferência 4 de 4 é a que
--    impede que ela vire linha em `route_stops`.
--
--    E, no meio do cálculo, o mundo muda DE NOVO: a ficha do Capim é apagada.
update public.organizations set deleted_at = now() where id = pg_temp.org('02');

create table pg_temp.gravacao as
select public.rota_gravar_ordem(
  ((select pedidos -> 0 ->> 'plano_id' from pg_temp.lote))::uuid,
  jsonb_build_array(
    jsonb_build_object('task_id', pg_temp.tar('01'), 'segundos_do_anterior', 100, 'metros_do_anterior', 1000),
    jsonb_build_object('task_id', pg_temp.tar('02'), 'segundos_do_anterior', 200, 'metros_do_anterior', 2000),
    jsonb_build_object('task_id', pg_temp.tar('03'), 'segundos_do_anterior', 300, 'metros_do_anterior', 3000)),
  600, 6000) as r;

select is((select r ->> 'gravadas' from pg_temp.gravacao), '1',
          'das três que o OSRM devolveu, só UMA vira parada: as outras duas já não valiam');
select is(jsonb_array_length((select r -> 'descartadas' from pg_temp.gravacao)), 2,
          'e as duas descartadas são nomeadas na resposta, não somem em silêncio');
select is(pg_temp.delta('paradas', pg_temp.n_paradas()), 1,
          'uma linha em route_stops, e nenhuma a mais');
select ok(not exists (
    select 1 from public.route_stops s where s.task_id in (pg_temp.tar('01'), pg_temp.tar('02'))),
  'nem a suprimida nem a apagada estão gravadas, mesmo tendo tempo calculado');

select is((select r ->> 'total_segundos' from pg_temp.gravacao), '300',
          'o total é recalculado do que SOBROU (300 s), não o que o OSRM somou (600 s)');
select is((select total_seconds::text from public.route_plans
            where id = ((select pedidos -> 0 ->> 'plano_id' from pg_temp.lote))::uuid),
          '300', 'e é esse total que fica no plano');
select is((select status::text from public.route_plans
            where id = ((select pedidos -> 0 ->> 'plano_id' from pg_temp.lote))::uuid),
          'pronta', 'o plano fica pronto');
select isnt((select failure_reason from public.route_plans
              where id = ((select pedidos -> 0 ->> 'plano_id' from pg_temp.lote))::uuid),
            null, 'e guarda por escrito que paradas caíram entre o cálculo e a gravação');

-- A parada gravada carrega a precisão CONGELADA da coordenada usada.
select is((select geo_precision::text from public.route_stops where task_id = pg_temp.tar('03')),
          'bairro', 'a parada registra com que precisão de coordenada a rota foi feita');

-- O worker conclui a mensagem depois de gravar: é isso que arquiva a mensagem
-- e fecha a chave de idempotência (ADR-11).
select ok(public.esteira_fila_concluir('rotas_jobs',
            ((select pedidos -> 0 ->> 'msg_id' from pg_temp.lote))::bigint,
            (select pedidos -> 0 ->> 'chave' from pg_temp.lote)),
          'o worker conclui a mensagem depois de gravar a ordem');
select is((select position::text from public.route_stops where task_id = pg_temp.tar('03')),
          '1', 'e a posição é recontada: com paradas descartadas, não sobra buraco na ordem');

-- 5. A tela lê, e a leitura reconfere de novo.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000e0001', 'sdr');
select is(jsonb_array_length(public.rota_do_dia(pg_temp.dia()) -> 'paradas'), 1,
          'a tela vê a parada que sobrou');
select is(public.rota_do_dia(pg_temp.dia()) -> 'paradas' -> 0 ->> 'ainda_vale', 'true',
          'e ela ainda vale');
select is((select count(*)::int from jsonb_array_elements(
            public.rota_do_dia(pg_temp.dia()) -> 'alvos') a
            where (a ->> 'elegivel')::boolean is false),
          4, 'a tela também recebe os quatro alvos que ficaram de fora, com o motivo de cada um');
select is(public.rota_do_dia(pg_temp.dia()) -> 'motor' ->> 'nome', 'osrm',
          'e recebe qual motor calculou a ordem');
select pg_temp.sair();

-- 6. O mundo muda mais uma vez, agora DEPOIS de a rota estar pronta: a
--    última parada é suprimida. A leitura tem de dizer isso.
select app.suppress('phone', '+5584900000903', 'pgTAP rotas: pediu para sair', null, null);
select pg_temp.entrar('a0000000-0000-4000-8000-0000000e0001', 'sdr');
select is(public.rota_do_dia(pg_temp.dia()) -> 'paradas' -> 0 ->> 'ainda_vale', 'false',
          'parada suprimida depois do cálculo aparece marcada como "não vale mais" na tela');
select pg_temp.sair();

-- =====================================================================
-- PARTE D — SEM ALVO NÃO HÁ ROTA
-- =====================================================================
-- A outra SDR não tem visita nenhuma no dia: pedir a rota não cria plano.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000e0002', 'sdr');
select is(public.rota_montar(pg_temp.dia()) ->> 'enfileirado', 'false',
          'sem alvo elegível, o pedido é recusado');
select is(public.rota_montar(pg_temp.dia()) ->> 'motivo', 'sem_alvos',
          'com o motivo dito por extenso');
select pg_temp.sair();
select is(pg_temp.delta('planos', pg_temp.n_planos()), 1,
          'e nenhum plano vazio foi criado');

-- =====================================================================
-- PARTE E — QUEM PODE VER E PEDIR
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000e0002', 'sdr');
select throws_ok(
  $$ select public.rota_do_dia(null, 'a0000000-0000-4000-8000-0000000e0001') $$,
  '42501', null, 'uma SDR não lê a rota de outra pessoa');
select throws_ok(
  $$ select public.rota_montar(null, 'a0000000-0000-4000-8000-0000000e0001') $$,
  '42501', null, 'nem monta a rota de outra pessoa');
-- A RLS de `route_plans` é a MESMA de `tasks` (`app.sees_all()`, que inclui
-- sdr): quem enxerga a tarefa de visita enxerga a rota feita com ela. O que a
-- RPC barra é PEDIR ou LER a rota de outra pessoa como se fosse a própria —
-- exatamente o recorte de `public.meu_dia`.
select is((select count(*)::int from public.route_plans
            where assignee_id = 'a0000000-0000-4000-8000-0000000e0001'),
          1, 'a linha do plano é legível pela equipe, como a tarefa que a originou');
select is((select count(*)::int from public.route_stops s where s.task_id = pg_temp.tar('03')),
          1, 'e as paradas também');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000e0003', 'gestor');
select is(public.rota_do_dia(pg_temp.dia(), 'a0000000-0000-4000-8000-0000000e0001')
            -> 'plano' ->> 'status',
          'pronta', 'o gestor lê a rota da equipe');
select is((select count(*)::int from public.route_plans
            where assignee_id = 'a0000000-0000-4000-8000-0000000e0001'),
          1, 'e enxerga o plano pela RLS');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000e0001', 'sdr');
select throws_ok(
  $$ insert into public.route_stops (plan_id, position, task_id, organization_id, lat, lng,
                                     geo_precision, seconds_from_prev, meters_from_prev)
     select p.id, 9, 'd0000000-0000-4000-8000-0000000e1003', 'd0000000-0000-4000-8000-0000000e0003',
            -5.8, -35.2, 'bairro'::app.geo_precision, 0, 0
       from public.route_plans p limit 1 $$,
  '42501', null, 'ninguém insere parada pela API: a ordem só entra pela RPC que reconfere');
select pg_temp.sair();

-- =====================================================================
-- PARTE F — A FILA
-- =====================================================================
-- Mensagem de plano que já não espera cálculo é arquivada, não devolvida:
-- senão o worker recalcularia para sempre uma rota que ninguém pediu mais.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000e0001', 'sdr');
select public.rota_montar(pg_temp.dia(), null, 4);
select pg_temp.sair();
update public.route_plans set status = 'pronta'::app.route_status
 where assignee_id = 'a0000000-0000-4000-8000-0000000e0001';
select is(jsonb_array_length(public.rota_proximas(5)), 0,
          'pedido de plano que já não espera cálculo não volta para o worker');
select is((select count(*)::int from pgmq.q_rotas_jobs), 0,
          'e a mensagem é arquivada, em vez de reaparecer a cada leitura');

select is((select worker from public.ingest_queues where name = 'rotas_jobs'), 'rotas',
          'a fila das rotas é do worker de rotas');
select is((select dlq from public.ingest_queues where name = 'rotas_jobs'), 'rotas_dlq',
          'e tem dead-letter: pedido que falha além do teto para onde alguém veja');

select * from finish();
rollback;

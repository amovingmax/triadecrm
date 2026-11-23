-- =====================================================================
-- pgTAP — A ligação toca no app (migração 20261124090000)
--
-- Pedido de 23/11/2026 para a Imova: a ligação do cliente pelo WhatsApp toca na tela
-- de chamada do iPhone, com o app fechado, com Atender e Recusar. Este arquivo prova:
--
--   1. DESLIGADA POR PADRÃO E SÓ NA IMOVA: sem a chave nada é cutucado; na KOMUNE não
--      liga nem com as chaves gravadas à força;
--   2. O ENDEREÇO DE CHAMADA: só com sessão, só no próprio iPhone, só hexadecimal, e
--      o mesmo endereço não fica em dois aparelhos;
--   3. O GATILHO: a ligação que entra tocando cutuca a função voip-push; ligação feita
--      pela empresa não cutuca;
--   4. QUEM TOCA: os iPhones de quem atende, menos quem desligou "Cliente ligando" e
--      quem só lê; um convite por aparelho; a segunda rodada não repete nada;
--   5. ATENDER PELO CELULAR: o convite reserva a ligação, o primeiro leva, o mesmo
--      aparelho pode repetir o pedido, convite errado não passa;
--   6. PARAR: quem tocou e não atendeu recebe "parar", uma vez só; o aparelho que
--      atendeu, não;
--   7. A RESPOSTA DA APPLE: app apagado (410) esquece o endereço;
--   8. O AVISO COMUM "ESTÁ LIGANDO" não vai a quem já toca na tela de chamada;
--   9. AS PORTAS: nada disto é chamável por quem está logado.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(53);

insert into public.allowed_users (email, role, note) values
  ('h199.g@teste.local', 'gestor', 'pgTAP 199'),
  ('h199.s@teste.local', 'sdr', 'pgTAP 199'),
  ('h199.d@teste.local', 'sdr', 'pgTAP 199'),
  ('h199.l@teste.local', 'leitura', 'pgTAP 199'),
  ('h199.a@teste.local', 'gestor', 'pgTAP 199');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000019901'::uuid, 'h199.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000019902'::uuid, 'h199.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000019903'::uuid, 'h199.d@teste.local', '{"full_name":"Dora Desligou"}'),
  ('a0000000-0000-4000-8000-000000019904'::uuid, 'h199.l@teste.local', '{"full_name":"Leo Leitura"}'),
  ('a0000000-0000-4000-8000-000000019905'::uuid, 'h199.a@teste.local', '{"full_name":"Ana Android"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999919900"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';

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

create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

create function pg_temp.voip(p_n int) returns text language sql immutable as $$
  select repeat(lpad(to_hex(p_n), 2, '0'), 32)
$$;

-- Os aparelhos: três iPhones de quem atende, um de quem só lê e um Android.
insert into public.aparelhos_push (token, pessoa_id, plataforma, empresa, empresa_nome) values
  ('ExponentPushToken[h199gilgilgil]', 'a0000000-0000-4000-8000-000000019901', 'ios', 'imova', 'Imova Imobiliária'),
  ('ExponentPushToken[h199sarasara]',  'a0000000-0000-4000-8000-000000019902', 'ios', 'imova', 'Imova Imobiliária'),
  ('ExponentPushToken[h199doradora]',  'a0000000-0000-4000-8000-000000019903', 'ios', 'imova', 'Imova Imobiliária'),
  ('ExponentPushToken[h199leoleoleo]', 'a0000000-0000-4000-8000-000000019904', 'ios', 'imova', 'Imova Imobiliária'),
  ('ExponentPushToken[h199anaanaana]', 'a0000000-0000-4000-8000-000000019905', 'android', 'imova', 'Imova Imobiliária');
insert into public.avisos_desligados (pessoa_id, tipo)
values ('a0000000-0000-4000-8000-000000019903', 'ligando');

create function pg_temp.ligou(p_call text, p_de text, p_nome text default 'Maria Cliente') returns jsonb language sql as $$
  select public.wa_chamada_eventos(jsonb_build_array(jsonb_build_object(
    'tipo', 'chamada', 'evento', 'connect', 'direcao', 'USER_INITIATED', 'sdp_tipo', 'offer',
    'sdp', 'v=0 oferta', 'meta_call_id', p_call, 'numero_da_empresa', '+5584999919900',
    'de', p_de, 'nome', p_nome)))
$$;
create function pg_temp.chamada(p_call text) returns uuid language sql stable as $$
  select id from public.wa_chamadas where meta_call_id = p_call
$$;
create function pg_temp.cutucadas() returns bigint language sql stable as $$
  select count(*) from net.http_request_queue where url like '%/voip-push'
$$;

-- =====================================================================
-- 1. Desligada por padrão, e só na Imova
-- =====================================================================
select pg_temp.virar('imova');
update public.app_settings set value = '{"ativa": true}'::jsonb where key = 'whatsapp.ligacao';

select is((select value ->> 'ativa' from public.app_settings where key = 'ligacao.app'), 'false',
          'a chave da ligação no app nasce desligada');
select is(app.voip_ligado(), false, 'desligada, nada toca no app');

create temp table t199_antes as select pg_temp.cutucadas() as n;
select pg_temp.ligou('wacid.Z1', '+5584999919901');
select is(pg_temp.cutucadas(), (select n from t199_antes), 'desligada, a ligação não cutuca a função');
select is(jsonb_array_length(public.voip_a_enviar(pg_temp.chamada('wacid.Z1')) -> 'envios'), 0,
          'desligada, ninguém recebe o aviso de chamada');

update public.app_settings
   set value = '{"ativa": true, "funcao_url": "https://exemplo.supabase.co/functions/v1"}'::jsonb
 where key = 'ligacao.app';
select pg_temp.virar('komune');
select is(app.voip_ligado(), false, 'na KOMUNE não liga nem com as duas chaves gravadas');
select pg_temp.virar('imova');
select is(app.voip_ligado(), true, 'na Imova, com as duas chaves, liga');

-- =====================================================================
-- 2. O endereço de chamada
-- =====================================================================
select throws_ok($$select public.aparelho_voip_registrar('ExponentPushToken[h199gilgilgil]', '$$ || pg_temp.voip(1) || $$', false)$$,
                 '42501', null, 'sem sessão não registra');

select pg_temp.entrar('a0000000-0000-4000-8000-000000019901', 'gestor');
select is(public.aparelho_voip_registrar('ExponentPushToken[h199gilgilgil]', pg_temp.voip(1), false), true,
          'quem está logado registra o endereço de chamada do próprio iPhone');
select is(public.aparelho_voip_registrar('ExponentPushToken[h199sarasara]', pg_temp.voip(9), false), false,
          'não registra no aparelho de outra pessoa');
select throws_ok($$select public.aparelho_voip_registrar('ExponentPushToken[h199gilgilgil]', 'nao-e-hex', false)$$,
                 '22023', null, 'endereço fora do formato é recusado');
select throws_ok($$select * from public.aparelhos_push$$, '42501', null,
                 'quem está logado não lê a tabela de aparelhos');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000019902', 'sdr');
select is(public.aparelho_voip_registrar('ExponentPushToken[h199sarasara]', pg_temp.voip(2), true), true, 'a SDR registra o dela');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000019903', 'sdr');
select public.aparelho_voip_registrar('ExponentPushToken[h199doradora]', pg_temp.voip(3), false);
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000019904', 'leitura');
select public.aparelho_voip_registrar('ExponentPushToken[h199leoleoleo]', pg_temp.voip(4), false);
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000019905', 'gestor');
select is(public.aparelho_voip_registrar('ExponentPushToken[h199anaanaana]', pg_temp.voip(5), false), false,
          'Android não tem endereço de chamada da Apple');
select pg_temp.sair();

select is((select voip_sandbox from public.aparelhos_push where token = 'ExponentPushToken[h199sarasara]'), true,
          'o app de teste fica marcado para o servidor de teste da Apple');

-- O app reinstalado: outro endereço do Expo, o mesmo endereço da Apple.
insert into public.aparelhos_push (token, pessoa_id, plataforma, empresa, empresa_nome)
values ('ExponentPushToken[h199gilnovo00]', 'a0000000-0000-4000-8000-000000019901', 'ios', 'imova', 'Imova Imobiliária');
select pg_temp.entrar('a0000000-0000-4000-8000-000000019901', 'gestor');
select public.aparelho_voip_registrar('ExponentPushToken[h199gilnovo00]', pg_temp.voip(1), false);
select pg_temp.sair();
select is((select count(*)::int from public.aparelhos_push where voip_token = pg_temp.voip(1)), 1,
          'o mesmo endereço de chamada não fica em dois aparelhos');
select is((select token from public.aparelhos_push where voip_token = pg_temp.voip(1)), 'ExponentPushToken[h199gilnovo00]',
          'fica com o aparelho que registrou por último');
delete from public.aparelhos_push where token = 'ExponentPushToken[h199gilgilgil]';

-- =====================================================================
-- 3. O gatilho
-- =====================================================================
create temp table t199_antes2 as select pg_temp.cutucadas() as n;
select pg_temp.ligou('wacid.A1', '+5584999919902');
select is(pg_temp.cutucadas(), (select n from t199_antes2) + 1, 'a ligação que entra tocando cutuca a função');
select is((select convert_from(body, 'utf8')::jsonb ->> 'chamada_id' from net.http_request_queue where url like '%/voip-push' order by id desc limit 1),
          pg_temp.chamada('wacid.A1')::text, 'o pedido leva só o id da ligação');
select is((select url from net.http_request_queue where url like '%/voip-push' order by id desc limit 1),
          'https://exemplo.supabase.co/functions/v1/voip-push', 'para a função voip-push do projeto');

select pg_temp.ligou('wacid.A1', '+5584999919902');
select is(pg_temp.cutucadas(), (select n from t199_antes2) + 1, 'a reentrega da Meta não cutuca de novo');

-- =====================================================================
-- 4. Quem toca
-- =====================================================================
create temp table t199_r1 as select public.voip_a_enviar(pg_temp.chamada('wacid.A1')) as r;
select is((select jsonb_array_length(r -> 'envios') from t199_r1), 2, 'tocam os dois iPhones de quem atende');
select is((select array_agg(e ->> 'voip_token' order by e ->> 'voip_token') from t199_r1, jsonb_array_elements(r -> 'envios') e),
          array[pg_temp.voip(1), pg_temp.voip(2)], 'o gestor e a SDR; nem quem desligou, nem quem só lê, nem o Android');
select is((select bool_and(e ->> 'evento' = 'tocar') from t199_r1, jsonb_array_elements(r -> 'envios') e), true, 'é o aviso de tocar');
select is((select bool_and(e ->> 'convite' ~ '^[A-Za-z0-9_-]{43}$') from t199_r1, jsonb_array_elements(r -> 'envios') e), true,
          'cada aparelho leva um convite de 32 bytes');
select isnt((select r -> 'envios' -> 0 ->> 'convite' from t199_r1), (select r -> 'envios' -> 1 ->> 'convite' from t199_r1),
            'um convite diferente por aparelho');
select is((select r ->> 'quem' from t199_r1), 'Maria Cliente', 'a tela de chamada mostra o nome');
select is((select (e ->> 'sandbox')::boolean from t199_r1, jsonb_array_elements(r -> 'envios') e
            where e ->> 'voip_token' = pg_temp.voip(2)),
          true, 'o app de teste vai pelo servidor de teste');
select is((select count(*)::int from app.voip_convites where chamada_id = pg_temp.chamada('wacid.A1')), 2,
          'o banco guarda o hash do convite, não o convite');
select is(jsonb_array_length(public.voip_a_enviar(pg_temp.chamada('wacid.A1')) -> 'envios'), 0,
          'a segunda rodada não toca de novo');

create function pg_temp.convite(p_voip text) returns text language sql stable as $$
  select e ->> 'convite' from t199_r1, jsonb_array_elements(r -> 'envios') e where e ->> 'voip_token' = p_voip
$$;

-- =====================================================================
-- 5. Atender pelo celular
-- =====================================================================
select is(public.wa_chamada_app('convite-que-nao-existe-convite-que-nao-existe', 'atender') ->> 'motivo', 'convite_invalido',
          'convite inventado não atende');
create temp table t199_at as select public.wa_chamada_app(pg_temp.convite(pg_temp.voip(2)), 'atender') as r;
select is((select r ->> 'ok' from t199_at), 'true', 'a SDR atende pelo celular com o convite');
select is((select r ->> 'oferta_sdp' from t199_at), 'v=0 oferta', 'e recebe a oferta da Meta');
select is((select estado || '/' || atendida_por from public.wa_chamadas where id = pg_temp.chamada('wacid.A1')),
          'atendendo/a0000000-0000-4000-8000-000000019902', 'a ligação fica reservada para ela');
select is(public.wa_chamada_app(pg_temp.convite(pg_temp.voip(1)), 'atender') ->> 'motivo', 'ja_atendida',
          'o gestor chega depois: já atendida');
select is(public.wa_chamada_app(pg_temp.convite(pg_temp.voip(2)), 'atender') ->> 'ok', 'true',
          'o mesmo aparelho pode repetir o pedido (a rede caiu no meio)');
select is(public.wa_chamada_app(pg_temp.convite(pg_temp.voip(2)), 'autorizar') ->> 'ok', 'true',
          'a SDR pode mandar a resposta e aceitar');
select is(public.wa_chamada_app(pg_temp.convite(pg_temp.voip(1)), 'autorizar') ->> 'motivo', 'acao_nao_permitida',
          'o gestor não aceita a ligação dela');
select is(public.wa_chamada_app(pg_temp.convite(pg_temp.voip(2)), 'estado') ->> 'estado', 'atendendo',
          'o app acompanha o estado da ligação');

-- =====================================================================
-- 6. Parar
-- =====================================================================
create temp table t199_r2 as select public.voip_a_enviar(pg_temp.chamada('wacid.A1')) as r;
select is((select jsonb_array_length(r -> 'envios') from t199_r2), 1, 'atendida: para um aparelho só');
select is((select r -> 'envios' -> 0 ->> 'voip_token' from t199_r2), pg_temp.voip(1),
          'para no gestor, não no aparelho que atendeu');
select is((select r -> 'envios' -> 0 ->> 'evento' || '/' || (r ->> 'motivo') from t199_r2), 'parar/atendida',
          'o aviso é de parar, porque alguém atendeu');
select is(jsonb_array_length(public.voip_a_enviar(pg_temp.chamada('wacid.A1')) -> 'envios'), 0, 'e não para duas vezes');

-- A ligação que ninguém atende também para.
select pg_temp.ligou('wacid.B1', '+5584999919903');
select public.voip_a_enviar(pg_temp.chamada('wacid.B1'));
update public.wa_chamadas set estado = 'perdida', encerrada_em = now() where id = pg_temp.chamada('wacid.B1');
select is((select count(*)::int from jsonb_array_elements(public.voip_a_enviar(pg_temp.chamada('wacid.B1')) -> 'envios') e
            where e ->> 'evento' = 'parar'), 2, 'ninguém atendeu: para nos dois');

-- Quem tocou em Recusar não recebe "parar" (a tela piscaria de novo no iPhone dele).
select pg_temp.ligou('wacid.D1', '+5584999919905');
create temp table t199_r3 as select public.voip_a_enviar(pg_temp.chamada('wacid.D1')) as r;
select is(public.wa_chamada_app((select e ->> 'convite' from t199_r3, jsonb_array_elements(r -> 'envios') e
                                  where e ->> 'voip_token' = pg_temp.voip(1)), 'recusar') ->> 'ok', 'true',
          'Recusar no iPhone fica anotado no convite');
update public.wa_chamadas set estado = 'perdida', encerrada_em = now() where id = pg_temp.chamada('wacid.D1');
select is((select array_agg(e ->> 'voip_token') from jsonb_array_elements(public.voip_a_enviar(pg_temp.chamada('wacid.D1')) -> 'envios') e),
          array[pg_temp.voip(2)], 'o iPhone que recusou não recebe "parar"; o outro, sim');

-- O "tocar" que a Apple recusou não recebe "parar".
select pg_temp.ligou('wacid.C1', '+5584999919904');
select public.voip_a_enviar(pg_temp.chamada('wacid.C1'));
select public.voip_resultado(jsonb_build_array(
  jsonb_build_object('chamada_id', pg_temp.chamada('wacid.C1'), 'voip_token', pg_temp.voip(1), 'evento', 'tocar', 'status', 400, 'motivo', 'BadDeviceToken'),
  jsonb_build_object('chamada_id', pg_temp.chamada('wacid.C1'), 'voip_token', pg_temp.voip(2), 'evento', 'tocar', 'status', 200, 'motivo', null)));
update public.wa_chamadas set estado = 'perdida', encerrada_em = now() where id = pg_temp.chamada('wacid.C1');
select is((select array_agg(e ->> 'voip_token') from jsonb_array_elements(public.voip_a_enviar(pg_temp.chamada('wacid.C1')) -> 'envios') e),
          array[pg_temp.voip(2)], 'o aparelho que a Apple recusou no "tocar" não recebe "parar"');

-- =====================================================================
-- 7. A resposta da Apple
-- =====================================================================
select public.voip_resultado(jsonb_build_array(
  jsonb_build_object('chamada_id', pg_temp.chamada('wacid.B1'), 'voip_token', pg_temp.voip(1), 'evento', 'parar', 'status', 410, 'motivo', 'Unregistered')));
select is((select status from app.voip_envios where chamada_id = pg_temp.chamada('wacid.B1') and voip_token = pg_temp.voip(1) and evento = 'parar'),
          410, 'a resposta da Apple fica anotada');
select is((select voip_token from public.aparelhos_push where token = 'ExponentPushToken[h199gilnovo00]'), null,
          'app apagado do aparelho: o endereço de chamada é esquecido');

-- =====================================================================
-- 8. O aviso comum "está ligando"
-- =====================================================================
insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho) values
  ('a0000000-0000-4000-8000-000000019902', 'ligando', 'h199-sara', 'Maria está ligando', '/conversas'),
  ('a0000000-0000-4000-8000-000000019905', 'ligando', 'h199-ana', 'Maria está ligando', '/conversas');
select app.avisos_push_enviar();
select is((select resultado from app.push_fila where chave = 'h199-sara'), 'tela_de_chamada',
          'quem toca na tela de chamada não recebe também o aviso comum');
select is((select resultado from app.push_fila where chave = 'h199-ana'), 'enviado',
          'quem não tem a tela de chamada continua recebendo o aviso comum');

-- =====================================================================
-- 9. As portas
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000019901', 'gestor');
select throws_ok($$select public.voip_a_enviar(gen_random_uuid())$$, '42501', null, 'quem está logado não pede avisos de chamada');
select throws_ok($$select public.wa_chamada_app('x', 'estado')$$, '42501', null, 'nem usa a porta do app');
select throws_ok($$select public.voip_resultado('[]'::jsonb)$$, '42501', null, 'nem anota resposta da Apple');
select pg_temp.sair();

select * from finish();
rollback;

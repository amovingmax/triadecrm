-- =====================================================================
-- pgTAP — O limite da Meta chega ao CRM (migração 20261112110000)
--
-- O que este arquivo prova:
--   1. O NÚMERO BATE: o registro grava em E.164 o que a Graph escreve com
--      espaço, hífen e sem o nono dígito; e as linhas antigas, gravadas assim,
--      passam a valer.
--   2. O LIMITE INFORMADO POR GENTE: só admin e gestor; só os tiers da Meta;
--      vale como notícia; a próxima notícia da Meta passa por cima.
--
-- Número próprio deste arquivo. Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(9);

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
create function pg_temp.gestor() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000015801'::uuid $$;
create function pg_temp.sdr()    returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000015802'::uuid $$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;

insert into public.allowed_users (email, role, note) values
  ('l158.gestor@teste.local', 'gestor', 'pgTAP 158'),
  ('l158.sdr@teste.local',    'sdr',    'pgTAP 158');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gestor(), 'l158.gestor@teste.local', '{"full_name":"Lia Limite"}'),
  (pg_temp.sdr(),    'l158.sdr@teste.local',    '{"full_name":"Saulo Sdr"}');

-- O número deste arquivo: 84 9 9158-0158, que a Graph escreve "+55 84 9158-0158".
update public.app_settings
   set value = jsonb_set(value, '{numero_padrao}', '"+5584991580158"') where key = 'whatsapp.envio';

-- =====================================================================
-- 1. O número bate
-- =====================================================================
-- Uma linha antiga, gravada como a Graph escreve (direto na tabela, como antes
-- da correção), com a nota verde.
insert into public.wa_saude_numero (numero, origem, campo, qualidade, ocorrido_em)
values ('+55 84 9158-0158', 'graph', 'phone_number', 'GREEN', now() - interval '2 days');
select is(app.wa_teto_da_meta(null, now()) ->> 'qualidade', 'GREEN',
  'a linha antiga, com o número do jeito da Graph, passa a valer');

insert into pg_temp.r values ('id', to_jsonb(public.wa_saude_registrar(jsonb_build_object(
  'numero', '+55 84 9158-0158', 'origem', 'graph', 'campo', 'phone_number', 'qualidade', 'YELLOW'))));
select is((select numero from public.wa_saude_numero where id = (pg_temp.v('id'))::bigint),
          '+5584991580158', 'o registro grava o número em E.164, com o nono dígito');
select is(app.wa_teto_da_meta(null, now()) ->> 'qualidade', 'YELLOW', 'e a nota nova vale');

-- =====================================================================
-- 2. O limite informado por gente
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is(public.wa_limite_informar('TIER_2K') ->> 'motivo', 'sem_permissao',
  'o SDR não informa limite: é Ajustes, de admin e gestor');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is(public.wa_limite_informar('TIER_5K') ->> 'motivo', 'limite_invalido',
  'só os tiers que a Meta tem');
insert into pg_temp.r values ('informado', public.wa_limite_informar('tier_2k'));
select pg_temp.sair();
select is((pg_temp.v('informado') ->> 'teto')::int, 1000,
  'o gestor informa 2.000, e com a nota amarela o teto que vale é 1.000');
select is((select origem from public.wa_saude_numero order by id desc limit 1), 'pessoa',
  'a linha diz que a notícia veio de gente, não da Meta');

insert into public.wa_saude_numero (numero, origem, campo, qualidade, ocorrido_em)
values ('+5584991580158', 'webhook', 'phone_number_quality_update', 'GREEN', now() + interval '1 second');
select is(app.wa_teto_da_meta(null, now() + interval '2 seconds') ->> 'teto_dia', '2000',
  'nota de volta ao verde: 2.000');

insert into public.wa_saude_numero (numero, origem, campo, limite_atual, ocorrido_em)
values ('+5584991580158', 'webhook', 'business_capability_update', 'TIER_10K', now() + interval '3 seconds');
select is(app.wa_teto_da_meta(null, now() + interval '4 seconds') ->> 'teto_dia', '10000',
  'a próxima notícia da Meta passa por cima do que foi informado');

select * from finish();
rollback;

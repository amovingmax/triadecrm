-- =====================================================================
-- pgTAP — A agenda do Google entra no CRM
--         (migração 20260908180000_a_agenda_do_google_entra_no_crm.sql)
--
-- Esta integração guarda uma credencial que ABRE A AGENDA DE UMA PESSOA. Não é
-- um dado de trabalho; é um segredo com o nome de alguém. Por isso a maioria das
-- asserções deste arquivo não testa funcionalidade — testa que o segredo não sai.
--
-- As quatro que mais importam:
--
--   1. `authenticated` não lê `app.agendas_do_google`. Nem a linha, nem o id do
--      segredo.
--   2. `agenda_google_estado`, que a TELA chama, não devolve o token em campo
--      nenhum do JSON — mesmo sendo `security definer` e portanto capaz de lê-lo.
--   3. `agenda_google_token` recusa quem não é service_role.
--   4. Desconectar APAGA o segredo do Vault. Marcar a linha e deixar o token lá
--      seria guardar exatamente aquilo que a pessoa pediu para revogar.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(21);

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

create table pg_temp.r (chave text primary key, valor jsonb);

-- Entra no papel, chama, sai do papel e grava. O `insert` acontece de volta como
-- postgres: `authenticated` não tem insert em pg_temp.r (padrão dos testes 35-37).
create function pg_temp.olhar(p_chave text, p_uid uuid) returns void language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.entrar(p_uid, 'sdr');
  v := public.agenda_google_estado();
  perform pg_temp.sair();
  insert into pg_temp.r values (p_chave, v);
end $$;

create function pg_temp.desligar(p_chave text, p_uid uuid) returns void language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.entrar(p_uid, 'sdr');
  v := public.agenda_google_desconectar();
  perform pg_temp.sair();
  insert into pg_temp.r values (p_chave, v);
end $$;

create function pg_temp.segredos() returns bigint
  language sql security definer set search_path = '' as $$
  select count(*) from vault.secrets where name = 'agenda_google:a0000000-0000-4000-8000-0000000038a1'
$$;

-- ---------- gente ----------
insert into public.allowed_users (email, role, note)
values ('c38.sdr@teste.local', 'sdr', 'pgTAP agenda Google'),
       ('c38.outro@teste.local', 'sdr', 'pgTAP agenda Google');
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-0000000038a1', 'c38.sdr@teste.local', '{"full_name":"SDR C38"}'),
       ('a0000000-0000-4000-8000-0000000038a2', 'c38.outro@teste.local', '{"full_name":"Outro C38"}');


-- =====================================================================
-- 1. Guardar a ligação
-- =====================================================================
insert into pg_temp.r values
  ('sem_token',  app.agenda_google_guardar('a0000000-0000-4000-8000-0000000038a1', '   ', 'p@gmail.com', '{x}')),
  ('sem_email',  app.agenda_google_guardar('a0000000-0000-4000-8000-0000000038a1', 'tok', '  ', '{x}')),
  ('sem_pessoa', app.agenda_google_guardar('00000000-0000-4000-8000-0000000000ff', 'tok', 'p@gmail.com', '{x}')),
  ('guardou',    app.agenda_google_guardar('a0000000-0000-4000-8000-0000000038a1', 'refresh-1', 'Pessoa@GMAIL.com', '{calendar.events}'));

select is((select valor ->> 'motivo' from pg_temp.r where chave = 'sem_token'), 'sem_refresh_token',
  'token em branco é recusado: uma ligação sem credencial nunca cria evento');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'sem_email'), 'sem_email',
  'sem e-mail da conta Google é recusado: a tela precisa dizer QUAL agenda recebeu o evento');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'sem_pessoa'), 'pessoa_inexistente',
  'não se guarda agenda para quem não tem perfil no CRM');
select is((select valor ->> 'ok' from pg_temp.r where chave = 'guardou'), 'true',
  'a ligação é guardada');
select is((select valor ->> 'email' from pg_temp.r where chave = 'guardou'), 'pessoa@gmail.com',
  'o e-mail é normalizado para minúsculas');

select is(pg_temp.segredos(), 1::bigint,
  'o refresh token foi para o Vault');
select is(
  (select count(*) from app.agendas_do_google a
    where a.user_id = 'a0000000-0000-4000-8000-0000000038a1'
      and a.segredo_id is not null),
  1::bigint,
  'a tabela guarda o id do segredo');
select ok(
  not exists (
    select 1 from app.agendas_do_google a
     where a.user_id = 'a0000000-0000-4000-8000-0000000038a1'
       and a::text like '%refresh-1%'),
  'o refresh token NÃO aparece em nenhuma coluna da tabela');


-- =====================================================================
-- 2. Reconectar reaproveita o segredo
-- =====================================================================
-- O Google só devolve refresh token com prompt=consent, então reconectar é
-- rotina. Criar um segredo novo a cada vez deixaria lixo cifrado acumulando, e
-- ninguém saberia qual apagar.
select app.agenda_google_guardar('a0000000-0000-4000-8000-0000000038a1', 'refresh-2', 'pessoa@gmail.com', '{calendar.events}');

select is(pg_temp.segredos(), 1::bigint,
  'reconectar NÃO cria um segundo segredo no Vault');
select is(app.agenda_google_token('a0000000-0000-4000-8000-0000000038a1'), 'refresh-2',
  'e o token lido é o novo, não o antigo');


-- =====================================================================
-- 3. O segredo não sai para quem está logado
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000038a1', 'sdr');

select throws_ok(
  'select count(*) from app.agendas_do_google',
  '42501',
  null,
  'authenticated não lê a tabela da ligação: o schema app não é exposto e não há grant');

select throws_ok(
  $$select app.agenda_google_token('a0000000-0000-4000-8000-0000000038a1')$$,
  '42501',
  null,
  'authenticated não executa agenda_google_token');

select pg_temp.sair();
select pg_temp.olhar('estado', 'a0000000-0000-4000-8000-0000000038a1');

select is((select valor ->> 'conectada' from pg_temp.r where chave = 'estado'), 'true',
  'a tela consegue saber que a agenda está conectada');
select is((select valor ->> 'email' from pg_temp.r where chave = 'estado'), 'pessoa@gmail.com',
  'e com qual conta');
select ok(
  (select valor::text not like '%refresh-%' from pg_temp.r where chave = 'estado'),
  'agenda_google_estado NÃO devolve o token em campo nenhum, apesar de poder lê-lo');


-- =====================================================================
-- 4. Cada pessoa vê a própria ligação, e só
-- =====================================================================
select pg_temp.olhar('estado_do_outro', 'a0000000-0000-4000-8000-0000000038a2');

select is((select valor ->> 'conectada' from pg_temp.r where chave = 'estado_do_outro'), 'false',
  'quem não conectou vê "não conectada", e não a ligação da outra pessoa');
select ok(
  (select valor -> 'email' is null from pg_temp.r where chave = 'estado_do_outro'),
  'e não descobre o e-mail Google de ninguém');


-- =====================================================================
-- 5. Desconectar apaga o segredo
-- =====================================================================
select pg_temp.desligar('desconectou', 'a0000000-0000-4000-8000-0000000038a1');

select is((select valor ->> 'ok' from pg_temp.r where chave = 'desconectou'), 'true',
  'a pessoa desconecta a própria agenda');
select is(pg_temp.segredos(), 0::bigint,
  'o refresh token foi APAGADO do Vault: guardá-lo seria manter o que ela pediu para revogar');
select ok(
  app.agenda_google_token('a0000000-0000-4000-8000-0000000038a1') is null,
  'e o token deixa de ser legível mesmo por service_role');
select is(
  (select count(*) from app.agendas_do_google where user_id = 'a0000000-0000-4000-8000-0000000038a1'),
  1::bigint,
  'a LINHA sobrevive, para a tela oferecer "reconectar" em vez de "nunca conectou"');

select * from finish();
rollback;

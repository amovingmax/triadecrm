-- =====================================================================
-- pgTAP — SSO restrito e claim de papel (RF-ADM-01; migração 000200):
-- custom_access_token_hook injeta app_metadata.app_role a partir de profiles.role;
-- trigger em auth.users bloqueia e-mail fora de allowed_users/allowed_domains e cria o profile.
-- =====================================================================
begin;
select plan(26);

-- ---------- estrutura e privilégios ----------
select has_trigger('auth', 'users', 'on_auth_user_created', 'trigger on_auth_user_created existe em auth.users');
select has_function('public', 'custom_access_token_hook', array['jsonb'], 'função custom_access_token_hook(jsonb) existe');
select function_privs_are('public', 'custom_access_token_hook', array['jsonb'], 'supabase_auth_admin', array['EXECUTE'],
  'hook: supabase_auth_admin executa');
select function_privs_are('public', 'custom_access_token_hook', array['jsonb'], 'authenticated', array[]::text[],
  'hook: authenticated não executa');
select function_privs_are('public', 'custom_access_token_hook', array['jsonb'], 'anon', array[]::text[],
  'hook: anon não executa');
select function_privs_are('app', 'handle_new_auth_user', array[]::text[], 'authenticated', array[]::text[],
  'trigger de auth.users: authenticated não executa a função');

-- ---------- fixtures ----------
insert into public.allowed_users (email, role, note) values
  ('gestora@teste.local',     'gestor',  'pgTAP'),
  ('inativa@teste.local',     'leitura', 'pgTAP'),
  ('pessoa.nova@teste.local', 'gestor',  'pgTAP'),
  ('chefe@komune.app.br',     'admin',   'pgTAP');
insert into public.allowed_domains (domain, default_role, is_active) values ('inativo.local', 'sdr', false);
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000601', 'gestora@teste.local', '{"full_name":"Gestora Teste"}'),
  ('a0000000-0000-4000-8000-000000000602', 'inativa@teste.local', '{"full_name":"Inativa Teste"}');
update public.profiles set is_active = false where id = 'a0000000-0000-4000-8000-000000000602';

-- ---------- custom_access_token_hook ----------
create function pg_temp.evento(p_uid text) returns jsonb language sql as $$
  select jsonb_build_object(
    'user_id', p_uid,
    'claims', jsonb_build_object('sub', p_uid, 'email', 'x@teste.local', 'role', 'authenticated',
                                 'app_metadata', jsonb_build_object('provider', 'google')),
    'authentication_method', 'oauth')
$$;
select is(
  public.custom_access_token_hook(pg_temp.evento('a0000000-0000-4000-8000-000000000601')) -> 'claims' -> 'app_metadata' ->> 'app_role',
  'gestor', 'hook: injeta app_metadata.app_role = profiles.role');
select is(
  public.custom_access_token_hook(pg_temp.evento('a0000000-0000-4000-8000-000000000601')) -> 'claims' -> 'app_metadata' ->> 'provider',
  'google', 'hook: preserva o app_metadata existente');
select is(
  public.custom_access_token_hook(pg_temp.evento('a0000000-0000-4000-8000-000000000601')) -> 'claims' ->> 'email',
  'x@teste.local', 'hook: preserva as demais claims');
select is(
  public.custom_access_token_hook(pg_temp.evento('a0000000-0000-4000-8000-000000000601')) ->> 'authentication_method',
  'oauth', 'hook: devolve o evento inteiro, não só as claims');
select is(
  (public.custom_access_token_hook(pg_temp.evento('00000000-0000-4000-8000-000000000000')) -> 'error' ->> 'http_code')::int,
  403, 'hook: usuário sem profile recebe erro 403 (não vira leitura)');
select is(
  (public.custom_access_token_hook(pg_temp.evento('a0000000-0000-4000-8000-000000000602')) -> 'error' ->> 'http_code')::int,
  403, 'hook: usuário desativado recebe erro 403 (sem token)');
select ok(
  public.custom_access_token_hook(pg_temp.evento('a0000000-0000-4000-8000-000000000602')) -> 'claims' is null,
  'hook: usuário desativado não recebe claims');

-- ---------- trigger em auth.users: allowlist ----------
select throws_ok(
  $$insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000603', 'intruso@gmail.com')$$,
  'P0001', null, 'allowlist: e-mail fora da lista e do domínio é bloqueado');
select throws_matching(
  $$insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000603', 'intruso@gmail.com')$$,
  'não autorizado', 'allowlist: mensagem explica que o e-mail não está autorizado');
select is((select count(*)::int from auth.users where email = 'intruso@gmail.com'), 0,
  'allowlist: usuário bloqueado não fica em auth.users');
select is((select count(*)::int from public.profiles where id = 'a0000000-0000-4000-8000-000000000603'), 0,
  'allowlist: usuário bloqueado não ganha profile');
select throws_ok(
  $$insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000604', 'alguem@inativo.local')$$,
  'P0001', null, 'allowlist: domínio desativado não libera');
select throws_ok(
  $$insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000605', null)$$,
  'P0001', null, 'allowlist: cadastro sem e-mail é bloqueado');

select lives_ok(
  $$insert into auth.users (id, email, raw_user_meta_data) values ('a0000000-0000-4000-8000-000000000606', 'Pessoa.Nova@Teste.Local', '{"name":"Pessoa Nova"}')$$,
  'allowlist: e-mail nominal entra (comparação sem diferenciar maiúsculas)');
select results_eq(
  $$select role::text, full_name, is_active from public.profiles where id = 'a0000000-0000-4000-8000-000000000606'$$,
  $$values ('gestor'::text, 'Pessoa Nova'::text, true)$$,
  'allowlist: profile criado com o papel da lista e o nome do provedor (chave name)');
select is((select full_name from public.profiles where id = 'a0000000-0000-4000-8000-000000000601'), 'Gestora Teste',
  'allowlist: nome vindo de full_name do provedor');

select lives_ok(
  $$insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000607', 'alguem@komune.app.br')$$,
  'allowlist: e-mail do domínio da empresa entra');
select results_eq(
  $$select role::text, full_name from public.profiles where id = 'a0000000-0000-4000-8000-000000000607'$$,
  $$values ('sdr'::text, 'alguem'::text)$$,
  'allowlist: domínio dá o papel padrão (sdr) e o nome cai para a parte local do e-mail');

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000608', 'chefe@komune.app.br');
select is((select role::text from public.profiles where id = 'a0000000-0000-4000-8000-000000000608'), 'admin',
  'allowlist: a lista nominal vence o papel padrão do domínio');

select is((select count(*)::int from public.audit_log where table_name = 'profiles' and row_id = 'a0000000-0000-4000-8000-000000000607'), 1,
  'allowlist: criação do profile é auditada');

select * from finish();
rollback;

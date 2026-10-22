-- =====================================================================
-- pgTAP — Quem entra responde à outra empresa
--         (migração 20261023090000_quem_entra_responde_a_outra_empresa.sql)
--
--   1. `public.email_entra_no_crm` segue a regra do login:
--      - quem nunca entrou: lista de permitidos ou domínio permitido e aberto;
--      - quem já entrou: perfil ativo, mesmo fora da lista; perfil desativado
--        ou ausente não entra, mesmo na lista;
--   2. maiúsculas e espaços não mudam a resposta; lixo responde "não";
--   3. só `service_role` executa: nem anônimo nem gente logada pergunta por
--      e-mail alheio.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(15);

insert into public.allowed_users (email, role, note) values
  ('lista.nunca@teste.local',   'sdr',    'pgTAP'),
  ('ativo.entrou@teste.local',  'gestor', 'pgTAP'),
  ('desativado@teste.local',    'sdr',    'pgTAP'),
  ('sem.perfil@teste.local',    'sdr',    'pgTAP');
insert into public.allowed_domains (domain, default_role, is_active) values
  ('aberto.teste.local',  'sdr', true),
  ('fechado.teste.local', 'sdr', false);

-- O gatilho de auth.users cria o perfil de quem está na lista.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000001151', 'ativo.entrou@teste.local', '{"full_name":"Ativo"}'),
  ('a0000000-0000-4000-8000-000000001152', 'desativado@teste.local',   '{"full_name":"Desativado"}'),
  ('a0000000-0000-4000-8000-000000001153', 'sem.perfil@teste.local',   '{"full_name":"Sem Perfil"}');
update public.profiles set is_active = false where id = 'a0000000-0000-4000-8000-000000001152';
delete from public.profiles where id = 'a0000000-0000-4000-8000-000000001153';

select has_function('public', 'email_entra_no_crm', array['text'], 'a função existe');

-- Quem nunca entrou
select is(public.email_entra_no_crm('lista.nunca@teste.local'), true,
          'na lista e nunca entrou: entra');
select is(public.email_entra_no_crm('qualquer@aberto.teste.local'), true,
          'de domínio aberto: entra');
select is(public.email_entra_no_crm('qualquer@fechado.teste.local'), false,
          'de domínio fechado: não entra');
select is(public.email_entra_no_crm('ninguem@outro.teste.local'), false,
          'fora da lista e de domínio desconhecido: não entra');

-- Quem já entrou
select is(public.email_entra_no_crm('ativo.entrou@teste.local'), true,
          'já entrou e o perfil está ativo: entra');
delete from public.allowed_users where email = 'ativo.entrou@teste.local';
select is(public.email_entra_no_crm('ativo.entrou@teste.local'), true,
          'fora da lista, mas já entrou e está ativo: continua entrando, como no login');
select is(public.email_entra_no_crm('desativado@teste.local'), false,
          'perfil desativado: não entra, mesmo na lista');
select is(public.email_entra_no_crm('sem.perfil@teste.local'), false,
          'conta sem perfil: não entra, mesmo na lista');

-- Forma do e-mail
select is(public.email_entra_no_crm('  ATIVO.Entrou@Teste.Local '), true,
          'maiúsculas e espaços não mudam a resposta');
select is(public.email_entra_no_crm(''), false, 'vazio: não');
select is(public.email_entra_no_crm(null), false, 'nulo: não');

-- Quem pode perguntar
set local role anon;
select throws_ok($$select public.email_entra_no_crm('ativo.entrou@teste.local')$$, '42501', null,
                 'anônimo não pergunta');
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-000000001151', 'role', 'authenticated',
                    'app_metadata', json_build_object('app_role', 'admin'))::text, true);
set local role authenticated;
select throws_ok($$select public.email_entra_no_crm('ativo.entrou@teste.local')$$, '42501', null,
                 'nem admin logado pergunta por e-mail alheio');
reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;
select is(public.email_entra_no_crm('ativo.entrou@teste.local'), true,
          'a chave de serviço, que a rota usa depois de conferir a assinatura, pergunta');
reset role;

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — Quem abre a conversa, leu (migração 20261006100000)
--
-- Pedido de 06/10/2026: "eu to visualizando as mensagens do povo, mas n ta
-- contabilizando que ta sendo visualizada". Este arquivo prova:
--
--   1. O FURO QUE EXISTIA: o UPDATE direto de quem não atende a conversa não
--      muda nada e não dá erro — o "por ler" ficava lá em silêncio;
--   2. QUEM ENXERGA E ESCREVE, MARCA: a função zera para o SDR que não é o
--      atendente, e chamar de novo não quebra nada;
--   3. LIDA NÃO É PARA SEMPRE: mensagem nova volta a contar;
--   4. NINGUÉM APAGA O SINAL DOS OUTROS: quem só lê não marca, e quem não vê a
--      conversa também não;
--   5. QUEM RESPONDEU, LEU — mas só gente, e só texto: o modelo (campanha) e o
--      robô não zeram nada.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(17);

insert into public.allowed_users (email, role, note) values
  ('h99.g@teste.local', 'gestor', 'pgTAP 99'),
  ('h99.s@teste.local', 'sdr', 'pgTAP 99'),
  ('h99.e@teste.local', 'embaixador', 'pgTAP 99'),
  ('h99.l@teste.local', 'leitura', 'pgTAP 99');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000009901'::uuid, 'h99.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000009902'::uuid, 'h99.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000009903'::uuid, 'h99.e@teste.local', '{"full_name":"Eva Embaixadora"}'),
  ('a0000000-0000-4000-8000-000000009904'::uuid, 'h99.l@teste.local', '{"full_name":"Leo Leitura"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999999900"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

insert into public.message_templates (template_code, name, channel, category, kind,
                                      meta_template_name, meta_status, body)
values ('TST-99-OLA', 'Olá do pgTAP 99', 'whatsapp', 'utility', 'abertura',
        'tst_99_ola', 'approved', 'Oi, {{nome}}! Aqui é {{atendente}}, da KOMUNE.');

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

-- A conversa de um CLIENTE (sem ficha), atendida pelo gestor, com duas
-- mensagens dele por ler. É o caso da tela: quem abre é o SDR, que não atende.
create temp table t99(chave text primary key, valor uuid);
grant select on t99 to authenticated;
do $$
declare v_conv uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999999900', '+5584999999901', 'Renata Souza',
          'a0000000-0000-4000-8000-000000009901'::uuid, 'aguardando_nos')
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'Olá', 'system', 'crm'),
         (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'Bom dia', 'system', 'crm');
  insert into t99 values ('cliente', v_conv);
end $$;

create function pg_temp.conv() returns uuid language sql stable as $$
  select valor from t99 where chave = 'cliente'
$$;
create function pg_temp.por_ler() returns int language sql stable as $$
  select unread_count from public.conversations where id = pg_temp.conv()
$$;
create function pg_temp.chegou(p_texto text) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (pg_temp.conv(), 'in'::app.msg_direction, 'text'::app.msg_type,
          'received'::app.msg_status, p_texto, 'system', 'crm')
$$;

select is(pg_temp.por_ler(), 2, 'duas mensagens chegaram, duas por ler');

-- =====================================================================
-- 1. O furo que existia
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000009902'::uuid, 'sdr');
select lives_ok(
  $$ update public.conversations set unread_count = 0
      where id = pg_temp.conv() and unread_count > 0 $$,
  'o caminho antigo: o UPDATE direto do SDR que não atende a conversa não dá erro');
select pg_temp.sair();
select is(pg_temp.por_ler(), 2,
  'E NÃO MUDA NADA: a política de update casa zero linhas, e o "por ler" ficava lá em silêncio');

-- =====================================================================
-- 2. Quem enxerga e escreve, marca
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000009902'::uuid, 'sdr');
select is(public.conversa_marcar_lida(pg_temp.conv()) ->> 'ok', 'true',
  'pela função, o SDR marca como lida a conversa que abriu, mesmo sem ser quem atende');
select pg_temp.sair();
select is(pg_temp.por_ler(), 0, 'e o contador zera');
select is((select assignee_id from public.conversations where id = pg_temp.conv()),
  'a0000000-0000-4000-8000-000000009901'::uuid,
  'ler não é assumir: quem atende continua sendo quem era');

select pg_temp.entrar('a0000000-0000-4000-8000-000000009902'::uuid, 'sdr');
select is(public.conversa_marcar_lida(pg_temp.conv()) ->> 'ok', 'true',
  'marcar o que já está lido não quebra nada');
select pg_temp.sair();

-- =====================================================================
-- 3. Lida não é para sempre
-- =====================================================================
select pg_temp.chegou('Vocês atendem em Parnamirim?');
select is(pg_temp.por_ler(), 1, 'a pessoa escreveu de novo e a conversa voltou a ter uma por ler');

-- =====================================================================
-- 4. Ninguém apaga o sinal dos outros
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000009904'::uuid, 'leitura');
select is(public.conversa_marcar_lida(pg_temp.conv()) ->> 'motivo', 'sem_permissao',
  'quem só lê enxerga a conversa e NÃO apaga o "por ler" de quem atende');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000009903'::uuid, 'embaixador');
select is(public.conversa_marcar_lida(pg_temp.conv()) ->> 'motivo', 'sem_permissao',
  'o embaixador não marca conversa que a RLS não lhe mostra');
select pg_temp.sair();
select is(pg_temp.por_ler(), 1, 'e a mensagem continua por ler depois das duas tentativas');

select pg_temp.entrar('a0000000-0000-4000-8000-000000009902'::uuid, 'sdr');
select is(public.conversa_marcar_lida('a0000000-0000-4000-8000-0000000099ff'::uuid) ->> 'motivo',
  'conversa_inexistente', 'conversa que não existe responde pelo nome');
select pg_temp.sair();

select ok(not has_function_privilege('anon', 'public.conversa_marcar_lida(uuid)', 'execute'),
  'quem não entrou nem chama a função');

-- =====================================================================
-- 5. Quem respondeu, leu — mas só gente, e só texto
-- =====================================================================
-- O MODELO não zera: é como saem a campanha e o bom-dia, para conversas que
-- ninguém abriu. Aqui ele sai pela mão da Sara e a mensagem segue por ler.
select pg_temp.entrar('a0000000-0000-4000-8000-000000009902'::uuid, 'sdr');
select is(
  (public.wa_enviar_modelo_na_conversa(pg_temp.conv(),
     (select id from public.message_templates where template_code = 'TST-99-OLA'),
     '{"nome": "Renata"}'::jsonb) ->> 'ok')::boolean,
  true, 'um modelo sai pela conversa, assinado por gente');
select pg_temp.sair();
select is(pg_temp.por_ler(), 1,
  'MODELO NÃO É LEITURA: a campanha sai para quem ninguém abriu, e o "por ler" fica');

-- A RESPOSTA ESCRITA zera, sem ninguém ter chamado função nenhuma.
select pg_temp.entrar('a0000000-0000-4000-8000-000000009902'::uuid, 'sdr');
insert into public.messages (conversation_id, direction, type, status, body,
                             author_kind, sent_by, origin)
values (pg_temp.conv(), 'out', 'text', 'queued', 'Atendemos sim, Renata!',
        'human', 'a0000000-0000-4000-8000-000000009902'::uuid, 'crm');
select pg_temp.sair();
select is(pg_temp.por_ler(), 0,
  'QUEM RESPONDEU, LEU: a resposta escrita por uma pessoa zera o "por ler" sozinha');

-- O ROBÔ não zera. Um parceiro escreve pela primeira vez com o bot de entrada
-- ligado: o menu sai na hora, e a mensagem dele continua por ler — ninguém leu.
update public.app_settings set value = jsonb_set(value, '{ativo}', 'true')
 where key = 'whatsapp.bot_de_entrada';
insert into public.organizations (name, phone_e164, source_id, collector)
values ('Buffet do pgTAP 99', '+5584999999902',
        (select id from public.sources where slug = 'planilha'), 'pgtap99');
set role service_role;
select public.wa_entrada_registrar('wamid.H99.1', '+5584999999900', '+5584999999902', 'text',
                                   'Oi, boa tarde');
reset role;
select is(
  (select c.unread_count::text || '/' ||
          (select count(*) from public.messages m
            where m.conversation_id = c.id and m.direction = 'out'::app.msg_direction
              and m.author_kind = 'bot_fixed')::text
     from public.conversations c where c.peer_phone_e164 = '+5584999999902'),
  '1/1',
  'ROBÔ NÃO É LEITURA: o menu respondeu sozinho (1 saída do bot) e a mensagem segue por ler (1)');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — A conversa de teste da IA que atende (migração 20261110150000)
--
-- Pedido do usuário em 10/11/2026: "Quero que a IA fale com o Matheu Rondon
-- Teste, mas utilize a conversa apenas para conversar mesmo, não para
-- aprender." Este arquivo prova:
--
--   1. Só admin e gestor marcam; SDR não; conversa que não existe, não;
--   2. No MODO TREINO, a IA atende a conversa do treino e as de teste, e
--      nenhuma outra; marcar liga a IA mesmo onde o time já tinha escrito;
--   3. A conversa de teste NÃO APRENDE: a entrada diz treino = false, o
--      caderno e a foto ensinada recusam;
--   4. PASSAR, ali, é como no treino: o aviso sai, a IA continua, sem tarefa;
--   5. O ESTADO e o PAINEL dizem que é de teste;
--   6. A conversa do treino não pode ser de teste, e a conversa de teste que
--      vira a do treino sai da lista; o teto é 5; configurar não aceita a
--      lista por fora;
--   7. DESMARCAR para a IA ali;
--   8. Na KOMUNE nada disto existe (o arquivo só roda onde a IA existe).
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(26);

insert into public.allowed_users (email, role, note) values
  ('h143.g@teste.local', 'gestor', 'pgTAP 143'),
  ('h143.s@teste.local', 'sdr', 'pgTAP 143');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000014301'::uuid, 'h143.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000014302'::uuid, 'h143.s@teste.local', '{"full_name":"Sara Sdr"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999914300"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
delete from public.app_settings where key = 'ia.atendente';

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

create temp table t143(chave text primary key, valor uuid);
grant all on t143 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t143 where chave = p_chave
$$;
create function pg_temp.conversa(p_chave text, p_tel text, p_nome text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999914300', p_tel, p_nome,
          'a0000000-0000-4000-8000-000000014301'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t143 values (p_chave, v);
  return v;
end $$;
create function pg_temp.dele(p_chave text, p_conv uuid, p_seg int, p_texto text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_texto, 'system', 'crm', now() - make_interval(secs => p_seg))
  returning id into v;
  insert into t143 values (p_chave, v);
  return v;
end $$;
-- Mensagem de gente do time, há `p_seg` segundos.
create function pg_temp.nossa(p_conv uuid, p_seg int) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'pgtap143 nossa', 'human', 'echo', 'a0000000-0000-4000-8000-000000014301'::uuid,
          'wamid.PGTAP143.' || gen_random_uuid(), now() - make_interval(secs => p_seg),
          now() - make_interval(secs => p_seg))
$$;

select pg_temp.conversa('treino', '+5584988814301', 'Janio Ramalho');
select pg_temp.conversa('teste', '+5584988814302', 'Matheu Rondon Teste');
select pg_temp.conversa('cliente', '+5584988814303', 'Clara Cliente');
select pg_temp.dele('x1', pg_temp.id('teste'), 900, 'Oi');
select pg_temp.nossa(pg_temp.id('teste'), 800);
select pg_temp.dele('x2', pg_temp.id('teste'), 60, 'Tem terreno em Parnamirim?');
select pg_temp.dele('c1', pg_temp.id('cliente'), 60, 'Bom dia, quanto custa o terreno?');

-- O gestor liga a IA no modo treino, com a conversa do Janio.
select pg_temp.entrar('a0000000-0000-4000-8000-000000014301'::uuid, 'gestor');
select public.ia_atendente_configurar(jsonb_build_object(
         'ligada', true, 'modo', 'treino', 'conversa_de_treino', pg_temp.id('treino')));
select pg_temp.sair();

select is(app.ia_atende(pg_temp.id('teste')), false, 'antes de marcar: no treino, a IA não fala com o Matheu');

-- ---------------------------------------------------------------------
-- 1. Quem marca
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000014302'::uuid, 'sdr');
select is(public.ia_conversa_de_teste_marcar(pg_temp.id('teste'), true) ->> 'motivo', 'sem_permissao',
          'o SDR não marca conversa de teste (é configuração)');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000014301'::uuid, 'gestor');
select is(public.ia_conversa_de_teste_marcar(gen_random_uuid(), true) ->> 'motivo', 'conversa_inexistente',
          'conversa que não existe não vira de teste');
select is(public.ia_conversa_de_teste_marcar(pg_temp.id('treino'), true) ->> 'motivo', 'e_a_conversa_do_treino',
          'a conversa do treino não pode ser de teste (lá ela aprende)');
select is((public.ia_conversa_de_teste_marcar(pg_temp.id('teste'), true) ->> 'atende')::boolean, true,
          'o gestor marca a conversa do Matheu, e a IA passa a atender ali');
select is((public.ia_conversa_de_teste_marcar(pg_temp.id('teste'), true) ->> 'ok')::boolean, true,
          'marcar de novo não dá erro');
select is(cardinality(app.ia_conversas_de_teste()), 1, 'e não repete a conversa na lista');
select is(public.ia_atendente_configurar(jsonb_build_object('conversas_de_teste', jsonb_build_array(pg_temp.id('cliente'))))
            ->> 'motivo', 'chave_desconhecida',
          'configurar não mexe na lista por fora (só pela função de marcar)');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 2. Quem a IA atende no modo treino
-- ---------------------------------------------------------------------
select is(app.ia_atende(pg_temp.id('treino')), true, 'treino: a conversa do treino continua');
select is(app.ia_atende(pg_temp.id('teste')), true,
          'treino: a conversa de teste também, mesmo com mensagem antiga do time');
select is(app.ia_atende(pg_temp.id('cliente')), false, 'treino: cliente de verdade, não');
select ok(app.ia_atendente_enfileirar(20) >= 1, 'a fila pega a mensagem do Matheu');
select ok(exists (select 1 from public.ingest_dedup d
                   where d.queue = 'ai_jobs'
                     and d.idempotency_key = 'draft_reply:atender:' || pg_temp.id('x2')::text),
          'e manda para o worker responder à última mensagem dele');

-- ---------------------------------------------------------------------
-- 3. A conversa de teste não aprende
-- ---------------------------------------------------------------------
select is((public.ia_entrada_do_atendente(pg_temp.id('teste')) ->> 'treino')::boolean, false,
          'a entrada diz ao worker que não é treino (a IA trata como cliente)');
select throws_ok(
  $$select public.ia_atendente_anotar(pg_temp.id('teste'), pg_temp.id('x2'), array['Desconto de 50% para o Matheu'])$$,
  '42501', null, 'a conversa de teste não anota no caderno');
select is(public.ia_foto_ensinar(pg_temp.id('teste'), pg_temp.id('x2'), 'TE0001_IMOVA', null) ->> 'motivo', 'so_no_treino',
          'a conversa de teste não ensina foto');

-- ---------------------------------------------------------------------
-- 4. Passar, na conversa de teste, é como no treino
-- ---------------------------------------------------------------------
select is((public.ia_atendente_passar(pg_temp.id('teste'), pg_temp.id('x2'), null,
                                      'pediu corretor', null, 'regra') ->> 'teste')::boolean, true,
          'o aviso de passar sai na conversa de teste');
select is(app.ia_atende(pg_temp.id('teste')), true, 'e a IA continua conversando com o Matheu');
select ok(not exists (select 1 from public.tasks t where t.title like 'A IA passou o cliente para você: Matheu%'),
          'sem tarefa para corretor por uma conversa de teste');

-- ---------------------------------------------------------------------
-- 5. O estado e o painel
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000014302'::uuid, 'sdr');
select is((public.ia_conversa_estado(pg_temp.id('teste')) ->> 'teste')::boolean, true,
          'o estado na conversa diz que é de teste');
select is((public.ia_atendente_painel(7) -> 'conversas_de_teste' -> 0 ->> 'nome'), 'Matheu Rondon Teste',
          'o painel mostra a conversa de teste pelo nome');
select is((public.ia_atendente_painel(7) -> 'placar' ->> 'no_teste')::int, 1,
          'o placar conta a resposta da conversa de teste');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 6. O teto e a troca com a conversa do treino
-- ---------------------------------------------------------------------
select pg_temp.conversa('t2', '+5584988814312', 'Teste Dois');
select pg_temp.conversa('t3', '+5584988814313', 'Teste Tres');
select pg_temp.conversa('t4', '+5584988814314', 'Teste Quatro');
select pg_temp.conversa('t5', '+5584988814315', 'Teste Cinco');
select pg_temp.conversa('t6', '+5584988814316', 'Teste Seis');
select pg_temp.entrar('a0000000-0000-4000-8000-000000014301'::uuid, 'gestor');
select public.ia_conversa_de_teste_marcar(pg_temp.id(k), true) from unnest(array['t2', 't3', 't4', 't5']) k;
select is(public.ia_conversa_de_teste_marcar(pg_temp.id('t6'), true) ->> 'motivo', 'muitas_conversas_de_teste',
          'até 5 conversas de teste');
select public.ia_atendente_configurar(jsonb_build_object('conversa_de_treino', pg_temp.id('t5')));
select is(app.ia_conversa_de_teste(pg_temp.id('t5')), false,
          'a conversa de teste escolhida para o treino sai da lista de teste');

-- ---------------------------------------------------------------------
-- 7. Desmarcar
-- ---------------------------------------------------------------------
select is((public.ia_conversa_de_teste_marcar(pg_temp.id('teste'), false) ->> 'atende')::boolean, false,
          'desmarcada, a IA para de falar com o Matheu');
select pg_temp.sair();
select is((select a.estado from public.ia_atendimento a where a.conversation_id = pg_temp.id('teste')), 'parada',
          'e fica parada ali, também se o modo virar clientes');

select * from finish();
rollback;

-- =====================================================================
-- TRIADE — pgTAP — 20260905000803: os três que só mordem quando a IA
-- e o WhatsApp ligarem (laudo §3.3, §3.5 e §3.12n)
--
--   1. §3.3 — A FILA DA IA NÃO TOCA EM CONTATO SUPRIMIDO. Duas metades,
--      e as duas precisam existir: a PERGUNTA (o worker pergunta antes
--      de montar chamada paga) e a LIMPEZA (o opt-out esvazia `ai_jobs`
--      no mesmo laço em que já cancela `tasks`). O teste prova o ciclo
--      inteiro — enfileira, o mundo muda, confere — e prova também que
--      o trabalho da organização LEGÍTIMA sobrevive, porque cancelar
--      tudo não é consertar nada.
--
--   2. §3.5 — A CONFIRMAÇÃO DE OPT-OUT PARA. Cinco tentativas, e não
--      infinitas; espera crescente entre elas; e o caso esgotado vira
--      `acao_humana` em `public.wa_saude()`.
--
--   3. §3.12n — A DEAD-LETTER TEM DRENO. O que morre em `*_dlq` vai
--      para `public.dead_letters`, com tarefa, e a fila volta a zero.
--
-- Toda asserção de contagem é DELTA sobre a base medida no início: este
-- banco tem operação dentro e quatro consertadores trabalhando nele.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(34);

-- ---------- utilitários de sessão ----------
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
  select ('e0000000-0000-4000-8000-00000803e0' || p_n)::uuid $$;
create function pg_temp.gente(p_n text) returns uuid language sql as $$
  select ('b0000000-0000-4000-8000-00000803b0' || p_n)::uuid $$;

-- ---------- a base, para toda contagem virar delta ----------
create function pg_temp.n_fila() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from pgmq.q_ai_jobs $$;
create function pg_temp.n_dl() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.dead_letters $$;
create function pg_temp.n_msg() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.messages $$;
create table pg_temp.base (chave text primary key, n int);
insert into pg_temp.base values ('fila', pg_temp.n_fila()), ('dl', pg_temp.n_dl()),
                                ('msg', pg_temp.n_msg());
create function pg_temp.delta(p_chave text, p_agora int) returns int language sql as $$
  select p_agora - (select n from pg_temp.base where chave = p_chave) $$;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('dlq.admin@teste.local', 'admin', 'pgTAP 803'),
  ('dlq.sdr@teste.local',   'sdr',   'pgTAP 803');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gente('01'), 'dlq.admin@teste.local', '{"full_name":"Admin 803"}'),
  (pg_temp.gente('02'), 'dlq.sdr@teste.local',   '{"full_name":"SDR 803"}');

-- ---------- fichas: 01 legítima, 02 vai pedir opt-out ----------
insert into public.organizations (id, kind, name, phone_e164, source_id, collector, source_url, owner_id)
select v.id, 'fornecedor', v.nome, v.fone,
       (select id from public.sources order by id limit 1), 'pgtap',
       'https://exemplo.invalido/803', pg_temp.gente('02')
  from (values
    (pg_temp.org('01'), '803 PGTAP LEGITIMA', '+5584900008031'),
    (pg_temp.org('02'), '803 PGTAP DESISTE',  '+5584900008032')
  ) as v(id, nome, fone);

-- ---------- conversas e mensagens recebidas (o alvo dos trabalhos) ----------
-- Pelo caminho real (`app.wa_registrar_entrada`), e não por insert cru: é
-- ele que cria a conversa, resolve a ficha pelo telefone e grava a
-- mensagem — e um teste que monta o estado por fora testa o teste.
create table pg_temp.ids (rotulo text primary key, conv uuid, msg uuid);
do $$
declare v jsonb;
begin
  v := app.wa_registrar_entrada('wamid.PGTAP803.LEGITIMA', '+5584999999999',
                                '+5584900008031', 'text', 'quanto custa?');
  insert into pg_temp.ids values ('legitima', (v ->> 'conversation_id')::uuid, (v ->> 'message_id')::uuid);
  v := app.wa_registrar_entrada('wamid.PGTAP803.DESISTE', '+5584999999999',
                                '+5584900008032', 'text', 'me manda mais detalhes');
  insert into pg_temp.ids values ('desiste', (v ->> 'conversation_id')::uuid, (v ->> 'message_id')::uuid);
end $$;
create function pg_temp.conv(p text) returns uuid language sql as $$
  select conv from pg_temp.ids where rotulo = p $$;
create function pg_temp.msg(p text) returns uuid language sql as $$
  select msg from pg_temp.ids where rotulo = p $$;

-- A janela de 24 h precisa estar ABERTA na conversa que vai desistir: é
-- essa a condição real do §3.5 (com a janela fechada e nenhum modelo
-- aprovado na Meta, `devida` é false e o laço nunca insere nada — medido).
update public.conversations set last_inbound_at = now() - interval '1 hour'
 where id = pg_temp.conv('desiste');


-- =====================================================================
-- 1. §3.3 — DE QUEM É O TRABALHO
-- =====================================================================
select is((select organization_id from app.ia_alvo_do_trabalho(
            jsonb_build_object('purpose','classify_inbound','message_id', pg_temp.msg('desiste')))),
          pg_temp.org('02'),
          'o trabalho que aponta para uma mensagem tem o dono da mensagem');
select is((select organization_id from app.ia_alvo_do_trabalho(
            jsonb_build_object('conversation_id', pg_temp.conv('legitima')))),
          pg_temp.org('01'),
          'e o que aponta para uma conversa, o dono da conversa');
select is((select organization_id from app.ia_alvo_do_trabalho(
            jsonb_build_object('organization_id', pg_temp.org('01')))),
          pg_temp.org('01'),
          'o par explícito no payload também resolve');
select is((select organization_id from app.ia_alvo_do_trabalho('{"purpose":"digest"}'::jsonb)),
          null,
          'payload que não aponta para ninguém devolve alvo nulo — e nulo não é "pode"');
-- Payload torto não pode derrubar a transação de quem está suprimindo alguém.
select lives_ok($$ select * from app.ia_alvo_do_trabalho('{"message_id":"nao-sou-uuid"}'::jsonb) $$,
                'payload com uuid torto não estoura: opt-out não pode falhar por causa de fila suja');


-- =====================================================================
-- 2. §3.3 — A PERGUNTA, E A LIMPEZA NO MESMO LAÇO DO OPT-OUT
-- =====================================================================
-- Dois trabalhos na fila: um da ficha legítima, um da que vai desistir.
select ok((app.ia_enfileirar('classify_inbound',
             jsonb_build_object('chave','pgtap803-legitima','message_id', pg_temp.msg('legitima')),
             'pgtap803-legitima') ->> 'enfileirado')::boolean,
          'o trabalho da ficha legítima entra na fila');
select ok((app.ia_enfileirar('classify_inbound',
             jsonb_build_object('chave','pgtap803-desiste','message_id', pg_temp.msg('desiste')),
             'pgtap803-desiste') ->> 'enfileirado')::boolean,
          'e o da ficha que vai desistir também');
select is(pg_temp.delta('fila', pg_temp.n_fila()), 2, 'dois trabalhos a mais na fila, e nenhum a mais');

-- Antes do opt-out, os dois passam.
select is(app.ia_trabalho_suprimido('classify_inbound',
            jsonb_build_object('message_id', pg_temp.msg('desiste'))) ->> 'suprimido', 'false',
          'antes do pedido, o trabalho pode rodar');

-- O pedido de opt-out. É o mesmo caminho de qualquer opt-out do produto.
insert into public.consent_events (kind, organization_id, channel, evidence_text, occurred_at)
values ('contact_optout', pg_temp.org('02'), 'whatsapp', 'pgtap 803: nao quero mais', now());

select is(app.ia_trabalho_suprimido('classify_inbound',
            jsonb_build_object('message_id', pg_temp.msg('desiste'))) ->> 'suprimido', 'true',
          'depois do pedido, a MESMA pergunta responde "suprimido" — é a reconferência da entrega');
select is(app.ia_trabalho_suprimido('classify_inbound',
            jsonb_build_object('message_id', pg_temp.msg('desiste'))) ->> 'motivo', 'contato_suprimido',
          'com o motivo NOMEADO, nunca "fila vazia" nem silêncio');
select is(app.ia_trabalho_suprimido('classify_inbound',
            jsonb_build_object('message_id', pg_temp.msg('legitima'))) ->> 'suprimido', 'false',
          'e o trabalho de quem NÃO pediu para sair continua podendo rodar');

-- A limpeza: a fila perdeu o trabalho do suprimido, e SÓ ele.
select is(pg_temp.delta('fila', pg_temp.n_fila()), 1,
          'o opt-out tirou da fila o trabalho do suprimido — e deixou o legítimo de pé');
select is((select count(*)::int from pgmq.q_ai_jobs q
            where q.message ->> 'chave' = 'pgtap803-desiste'), 0,
          'o trabalho do suprimido não está mais em ai_jobs (laudo §3.3)');
select is((select count(*)::int from pgmq.q_ai_jobs q
            where q.message ->> 'chave' = 'pgtap803-legitima'), 1,
          'e o do legítimo continua lá: fechar tudo não é consertar nada');
select isnt((select processed_at from public.ingest_dedup
              where queue = 'ai_jobs' and idempotency_key = 'classify_inbound:pgtap803-desiste'),
            null,
            'a chave de idempotência do trabalho cancelado é fechada: ninguém o reenfileira depois');
select ok((select last_error from public.ingest_dedup
             where queue = 'ai_jobs' and idempotency_key = 'classify_inbound:pgtap803-desiste')
            like '%opt-out%',
          'com o motivo escrito na linha, e não um cancelamento anônimo');

-- E a tarefa continua sendo cancelada como antes: nada do que já existia regrediu.
select ok(app.is_suppressed_target(pg_temp.org('02')),
          'a supressão em si continua acontecendo — a limpeza da fila é acréscimo, não troca');


-- =====================================================================
-- 3. §3.5 — A CONFIRMAÇÃO DE OPT-OUT PARA DE GIRAR
-- =====================================================================
-- A conversa 12 está dentro da janela de 24 h e já tem o pedido: a
-- confirmação é "devida" toda vez. O envio falha toda vez (é o mundo de
-- hoje: nenhum número conectado). Vinte voltas do cron, com o backoff já
-- vencido, para medir o TETO e não a espera.
do $$
declare i int;
begin
  for i in 1..20 loop
    perform app.wa_confirmacoes_reenfileirar(50);
    update public.messages set status = 'failed'::app.msg_status,
           failed_at = now() - interval '30 days', error_code = 'pgtap_sem_numero'
     where conversation_id = (select id from public.conversations where id = pg_temp.conv('desiste'))
       and optout_confirmation and status = 'queued'::app.msg_status;
  end loop;
end $$;

select is((select count(*)::int from public.messages
            where conversation_id = pg_temp.conv('desiste') and optout_confirmation),
          app.wa_confirmacao_teto(),
          'vinte voltas do cron produzem CINCO confirmações, não vinte (laudo §3.5)');
select is(app.wa_confirmacoes_reenfileirar(50) ->> 'esgotadas', '1',
          'a volta seguinte não enfileira nada e diz por quê: esgotou');
select ok((select esgotou_tentativas from public.wa_confirmacoes_devidas
            where conversation_id = pg_temp.conv('desiste')) is not false,
          'a view diz que esta conversa esgotou as tentativas');

-- A espera crescente, medida na própria função que a calcula.
select is(app.wa_confirmacao_proxima_em(1, '2026-09-05 10:00-03'::timestamptz), null,
          'a PRIMEIRA falha não espera: é o conserto da 20260905000400, e uma falha isolada é soluço');
select ok(app.wa_confirmacao_proxima_em(2, '2026-09-05 10:00-03'::timestamptz)
            = '2026-09-05 10:10-03'::timestamptz,
          'da segunda em diante a escalada começa: 10 minutos');
select ok(app.wa_confirmacao_proxima_em(4, '2026-09-05 10:00-03'::timestamptz)
            = '2026-09-05 10:40-03'::timestamptz,
          'e ela dobra: a quarta já espera 40');

-- O painel precisa contar o caso, senão o teto é só uma forma silenciosa
-- de não responder.
select pg_temp.entrar(pg_temp.gente('01'), 'admin');
select ok((public.wa_saude() -> 'confirmacoes_de_optout' ->> 'esgotaram_tentativas')::int >= 1,
          'public.wa_saude() conta as confirmações que esgotaram o teto');
select ok(exists (select 1 from jsonb_array_elements(public.wa_saude() -> 'acao_humana') a
                   where a ->> 'o_que' like 'Destravar as confirma%'),
          'e abre uma acao_humana para elas, com quem e por quê');
select pg_temp.sair();


-- =====================================================================
-- 4. §3.12n — A DEAD-LETTER TEM DRENO
-- =====================================================================
select ok((select count(*)::int from pgmq.list_queues()
            where queue_name in ('ingest_dlq','wa_dlq','ai_dlq','komune_dlq')) = 4,
          'as quatro dead-letters do produto existem');

select pgmq.send('ai_dlq', jsonb_build_object(
         'fila_de_origem','ai_jobs','msg_id', 4242,
         'idempotency_key','pgtap803-morta','erro','estourou o teto de propósito',
         'tentativas', 3, 'em', now(), 'mensagem', jsonb_build_object('purpose','draft_followup')));

select is(app.dlq_drenar(100) -> 'por_fila' ->> 'ai_dlq', '1',
          'o dreno tira a mensagem morta de ai_dlq');
select is((select count(*)::int from pgmq.q_ai_dlq q
            where q.message ->> 'idempotency_key' = 'pgtap803-morta'), 0,
          'e a fila volta a zero para aquela mensagem');
select is((select erro from public.dead_letters where idempotency_key = 'pgtap803-morta'),
          'estourou o teto de propósito',
          'a mensagem morta virou linha em public.dead_letters, com o erro junto');
select is((select fila_de_origem from public.dead_letters where idempotency_key = 'pgtap803-morta'),
          'ai_jobs',
          'e com a fila de onde ela veio, que é o que diz a quem pertence o problema');
select ok((select task_id from public.dead_letters where idempotency_key = 'pgtap803-morta') is not null,
          'uma tarefa foi aberta: dead-letter que ninguém lê é fila invisível');

-- RLS: o dreno é assunto de gestão, não de campo.
select pg_temp.entrar(pg_temp.gente('02'), 'sdr');
select is((select count(*)::int from public.dead_letters where idempotency_key = 'pgtap803-morta'),
          0, 'sdr não lê a dead-letter: é operação, e RLS por papel vale aqui como em tudo');
select pg_temp.sair();
select pg_temp.entrar(pg_temp.gente('01'), 'admin');
select is((select count(*)::int from public.dead_letters where idempotency_key = 'pgtap803-morta'),
          1, 'admin lê');
select pg_temp.sair();

select * from finish();
rollback;

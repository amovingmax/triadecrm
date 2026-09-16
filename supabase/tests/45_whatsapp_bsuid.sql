-- =====================================================================
-- pgTAP — O WhatsApp guarda o BSUID
--         (migração 20260915120000_o_whatsapp_guarda_o_bsuid.sql)
--
-- O que este arquivo prova, nesta ordem:
--
--   1. A COLUNA existe, com índice, e as portas novas são só do worker.
--   2. COM TELEFONE E BSUID: a conversa nasce sabendo o BSUID e o reaprende
--      quando a Meta manda outro.
--   3. SÓ COM BSUID, CONVERSA CONHECIDA: a mensagem entra no fio certo, e o
--      opt-out dela suprime o TELEFONE daquele fio.
--   4. SÓ COM BSUID, NINGUÉM CONHECE: não nasce fio sem telefone; a mensagem
--      vai para a wa_dlq com nome, uma vez só, e o dreno a põe em
--      public.dead_letters.
--   5. SEM TELEFONE E SEM BSUID: recusa.
--   6. O RECIBO continua valendo pelo wamid e ensina o BSUID ao fio.
--   7. A TELA não escreve o BSUID (desviaria um opt-out), mas continua
--      editando o resto da conversa.
--
-- Nenhuma asserção conta linha absoluta em tabela compartilhada: tudo é DELTA
-- ou escopo pelos ids e telefones deste arquivo. Roda em transação e desfaz.
-- =====================================================================
begin;
select plan(33);

-- ---------- sessões (simulam o JWT do PostgREST) ----------
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
create function pg_temp.gestor() returns uuid language sql as $$
  select 'a0000000-0000-4000-8000-00000000e451'::uuid
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert, update on pg_temp.r to authenticated, service_role;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;
create function pg_temp.conv(p_chave text) returns uuid language sql as $$
  select (valor ->> 'conversation_id')::uuid from pg_temp.r where chave = p_chave
$$;

-- ---------- leituras FORA da RLS ----------
create function pg_temp.n_conversas() returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from public.conversations
$$;
create function pg_temp.n_na_dlq(p_wamid text) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from pgmq.q_wa_dlq q
   where q.message ->> 'idempotency_key' = p_wamid
$$;
grant execute on function pg_temp.n_conversas(), pg_temp.n_na_dlq(text)
  to authenticated, service_role;

-- ---------- gente (a conversa precisa de dono) ----------
insert into public.allowed_users (email, role, note) values
  ('w45.gestor@teste.local', 'gestor', 'pgTAP BSUID');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gestor(), 'w45.gestor@teste.local', '{"full_name":"Gestor W45"}');


-- =====================================================================
-- 1. A COLUNA E AS PORTAS
-- =====================================================================
select has_column('public', 'conversations', 'peer_user_id',
                  'a conversa tem onde guardar o BSUID');
select has_index('public', 'conversations', 'conversations_bsuid_idx',
                 'e acha a conversa por ele sem varrer a tabela');
select ok(has_function_privilege('service_role',
            'public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text)', 'execute'),
          'o worker chama a entrada com o BSUID');
select ok(not has_function_privilege('authenticated',
            'public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text)', 'execute'),
          'e a tela não');
select ok(has_function_privilege('service_role',
            'public.wa_status_registrar(text, text, timestamptz, text, text, text)', 'execute')
          and not has_function_privilege('authenticated',
            'public.wa_status_registrar(text, text, timestamptz, text, text, text)', 'execute'),
          'o recibo com BSUID também é só do worker');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('wa_entrada_registrar', 'wa_status_registrar')),
          2, 'a assinatura antiga saiu: não sobram duas candidatas para o PostgREST escolher');


-- =====================================================================
-- 2. COM TELEFONE E BSUID
-- =====================================================================
insert into pg_temp.r values ('com_tel', public.wa_entrada_registrar(
  'wamid.W45.COMTEL.1', '+5584988887777', '+5584900004501', 'text', 'oi, vi seu contato',
  null, null, now(), 'BR.4501000000000000001'));
select is(pg_temp.v('com_tel') ->> 'novo', 'true', 'a mensagem com telefone e BSUID entra');
select is((select peer_user_id from public.conversations where id = pg_temp.conv('com_tel')),
          'BR.4501000000000000001', 'e a conversa nasce sabendo o BSUID');
select is(pg_temp.v('com_tel') ->> 'sem_telefone', 'false', 'e não é tratada como "sem telefone"');

-- A Meta gera BSUID novo quando a pessoa troca de número; o fio reaprende.
select public.wa_entrada_registrar('wamid.W45.COMTEL.2', '+5584988887777', '+5584900004501',
                                   'text', 'de novo', null, null, now(), 'BR.4501000000000000002');
select is((select peer_user_id from public.conversations where id = pg_temp.conv('com_tel')),
          'BR.4501000000000000002', 'o BSUID mais recente vence');

-- Quem chama do jeito antigo (cinco posicionais, sem BSUID) continua chamando
-- e não apaga o BSUID que o fio já sabe.
select is(public.wa_entrada_registrar('wamid.W45.COMTEL.3', '+5584988887777', '+5584900004501',
                                      'text', 'sem bsuid') ->> 'novo', 'true',
          'a chamada antiga, sem BSUID, continua funcionando');
select is((select peer_user_id from public.conversations where id = pg_temp.conv('com_tel')),
          'BR.4501000000000000002', 'e não apaga o BSUID que a conversa já sabia');


-- =====================================================================
-- 3. SÓ COM BSUID, CONVERSA CONHECIDA
-- =====================================================================
insert into pg_temp.r values ('base_conv', to_jsonb(pg_temp.n_conversas()));
insert into pg_temp.r values ('so_bsuid', public.wa_entrada_registrar(
  'wamid.W45.SOBSUID.1', '+5584988887777', null, 'text', 'parar',
  null, null, now(), 'BR.4501000000000000002'));
select is(pg_temp.v('so_bsuid') ->> 'novo', 'true',
          'a mensagem SEM telefone entra');
select is(pg_temp.conv('so_bsuid'), pg_temp.conv('com_tel'),
          'no fio que já conhecia aquele BSUID');
select is(pg_temp.n_conversas(), (pg_temp.v('base_conv'))::int,
          'sem inventar uma segunda conversa');
select is((select direction::text || ':' || body from public.messages
            where wa_message_id = 'wamid.W45.SOBSUID.1'),
          'in:parar', 'gravada como recebida, com o que a pessoa escreveu');
select is(public.wa_entrada_registrar('wamid.W45.SOBSUID.1', '+5584988887777', null, 'text', 'parar',
                                      null, null, now(), 'BR.4501000000000000002') ->> 'novo',
          'false', 'a reentrega do mesmo wamid não duplica');

-- O opt-out que chegou sem telefone suprime o telefone do fio.
select is(public.wa_optout_registrar(pg_temp.conv('so_bsuid'), 'pgTAP 45: "parar" sem telefone', false) ->> 'ok',
          'true', 'o opt-out da mensagem sem telefone é registrado na conversa');
select ok(app.is_suppressed('+5584900004501', null, null),
          'e o TELEFONE daquele fio vai para a supressão — o guardrail não depende de a Meta mandar o número');


-- =====================================================================
-- 4. SÓ COM BSUID, NINGUÉM CONHECE
-- =====================================================================
insert into pg_temp.r values ('base_conv2', to_jsonb(pg_temp.n_conversas()));
insert into pg_temp.r values ('orfa', public.wa_entrada_registrar(
  'wamid.W45.ORFA.1', '+5584988887777', null, 'text', 'oi, achei vocês pelo nome de usuário',
  null, null, now(), 'BR.4599999999999999999'));
select is(pg_temp.v('orfa') ->> 'sem_telefone', 'true',
          'mensagem sem telefone de BSUID desconhecido volta marcada como sem_telefone');
select ok(pg_temp.v('orfa') -> 'conversation_id' = 'null'::jsonb
          and pg_temp.v('orfa') -> 'message_id' = 'null'::jsonb,
          'sem conversa e sem mensagem: fio sem telefone não teria como ser suprimido');
select is(pg_temp.n_conversas(), (pg_temp.v('base_conv2'))::int,
          'nenhuma conversa nasce');
select is(pg_temp.n_na_dlq('wamid.W45.ORFA.1'), 1,
          'a mensagem foi para a wa_dlq — não sumiu');
select is(public.wa_entrada_registrar('wamid.W45.ORFA.1', '+5584988887777', null, 'text', 'oi',
                                      null, null, now(), 'BR.4599999999999999999') ->> 'novo',
          'false', 'a reentrega da Meta não entra de novo na dead-letter');
select is(pg_temp.n_na_dlq('wamid.W45.ORFA.1'), 1, 'continua uma só');

select app.dlq_drenar(100);
select is((select fila_de_origem || ' | ' || (payload -> 'mensagem' ->> 'de_user_id')
             || ' | ' || (payload -> 'mensagem' ->> 'texto')
             from public.dead_letters where idempotency_key = 'wamid.W45.ORFA.1'),
          'wa_inbound | BR.4599999999999999999 | oi, achei vocês pelo nome de usuário',
          'o dreno a põe em public.dead_letters com a fila de origem, o BSUID e o texto');
select ok((select erro like 'mensagem_sem_telefone:%'
             from public.dead_letters where idempotency_key = 'wamid.W45.ORFA.1'),
          'e com um erro que diz o que aconteceu');


-- =====================================================================
-- 5. SEM TELEFONE E SEM BSUID
-- =====================================================================
select throws_ok($$select public.wa_entrada_registrar('wamid.W45.NADA', '+5584988887777', null,
                                                        'text', 'x', null, null, now(), null)$$,
                 '22023', null,
                 'sem telefone e sem BSUID não há de quem a mensagem seja: recusa');


-- =====================================================================
-- 6. O RECIBO
-- =====================================================================
-- Um fio que só teve mensagem NOSSA: o recibo é o primeiro lugar do BSUID.
insert into pg_temp.r values ('saida', public.wa_entrada_registrar(
  'wamid.W45.SAIDA.ABRE', '+5584988887777', '+5584900004502', 'text', 'pode mandar'));
-- Como no 24: a resposta nasce `queued` (a janela de 24 h está aberta) e só
-- ganha wamid depois de a Meta aceitar o envio.
insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by)
values (pg_temp.conv('saida'), 'out', 'text', 'queued', 'Mando já!', 'human', pg_temp.gestor());
update public.messages set status = 'sent', wa_message_id = 'wamid.W45.SAIDA.1', sent_at = now()
 where conversation_id = pg_temp.conv('saida') and direction = 'out'
   and author_kind = 'human';   -- o menu do bot de entrada também é 'out' desde 16/09

select is(public.wa_status_registrar('wamid.W45.SAIDA.1', 'read', now(), null, null,
                                     'BR.4502000000000000001') ->> 'motivo',
          'atualizado', 'o recibo com recipient_user_id é aplicado pelo wamid');
select is((select status::text from public.messages where wa_message_id = 'wamid.W45.SAIDA.1'),
          'read', 'a mensagem anda para read');
select is((select peer_user_id from public.conversations where id = pg_temp.conv('saida')),
          'BR.4502000000000000001', 'e a conversa aprende o BSUID pelo recibo');


-- =====================================================================
-- 7. A TELA NÃO ESCREVE O BSUID
-- =====================================================================
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select throws_ok(format($$update public.conversations set peer_user_id = 'BR.4599999999999999999'
                           where id = %L$$, pg_temp.conv('saida')),
                 '42501', null,
                 'nem o gestor troca o BSUID: pôr o BSUID de outra pessoa desviaria o opt-out dela');
select lives_ok(format($$update public.conversations set bot_paused = true where id = %L$$,
                       pg_temp.conv('saida')),
                'e o resto da conversa continua editável');
select pg_temp.sair();

select * from finish();
rollback;

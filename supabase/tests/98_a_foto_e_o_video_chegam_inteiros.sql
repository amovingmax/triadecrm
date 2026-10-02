-- =====================================================================
-- pgTAP — A foto e o vídeo chegam inteiros (migração 20261003130000)
--
-- A fila de recuperação do worker-wa: o que ela devolve, o que ela deixa de
-- fora, e quem pode chamá-la.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(9);

-- Conversa precisa de dono ativo (RF-CON-04).
insert into public.allowed_users (email, role, note) values ('h97.s@teste.local', 'sdr', 'pgTAP 97');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000009701'::uuid, 'h97.s@teste.local', '{"full_name":"Sid Sdr"}');

create temp table t97(chave text primary key, valor uuid);
grant select on t97 to authenticated;
do $$
declare v_conv uuid; v_id uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, assignee_id, status)
  values ('whatsapp', '+5584999999700', '+5584999999701',
          'a0000000-0000-4000-8000-000000009701'::uuid, 'aguardando_nos') returning id into v_conv;
  insert into t97 values ('conv', v_conv);

  -- Foto recebida hoje, sem arquivo: entra.
  insert into public.messages (conversation_id, direction, type, status, media_id, media_mime, author_kind, origin)
  values (v_conv, 'in', 'image', 'received', 'mid-foto', 'image/jpeg', 'system', 'crm') returning id into v_id;
  insert into t97 values ('foto', v_id);
  -- Vídeo recebido hoje, sem arquivo: entra.
  insert into public.messages (conversation_id, direction, type, status, media_id, media_mime, author_kind, origin)
  values (v_conv, 'in', 'video', 'received', 'mid-video', 'video/mp4', 'system', 'crm') returning id into v_id;
  insert into t97 values ('video', v_id);
  -- Foto JÁ guardada: não entra.
  insert into public.messages (conversation_id, direction, type, status, media_id, media_mime, media_path, author_kind, origin)
  values (v_conv, 'in', 'image', 'received', 'mid-guardada', 'image/jpeg', 'x/y.jpg', 'system', 'crm') returning id into v_id;
  insert into t97 values ('guardada', v_id);
  -- Foto de 40 dias atrás: a Meta já não tem; não entra.
  insert into public.messages (conversation_id, direction, type, status, media_id, media_mime, author_kind, origin, created_at)
  values (v_conv, 'in', 'image', 'received', 'mid-velha', 'image/jpeg', 'system', 'crm', now() - interval '40 days') returning id into v_id;
  insert into t97 values ('velha', v_id);
  -- Texto: não é mídia; não entra.
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (v_conv, 'in', 'text', 'received', 'oi', 'system', 'crm') returning id into v_id;
  insert into t97 values ('texto', v_id);
end $$;

create function pg_temp.v(p text) returns uuid language sql stable as $$ select valor from t97 where chave = p $$;
create function pg_temp.na_fila(p text) returns boolean language sql stable as $$
  select exists (select 1 from public.wa_midias_sem_arquivo(100) f where f.message_id = pg_temp.v(p))
$$;

select ok(pg_temp.na_fila('foto'), 'foto recebida sem arquivo entra na fila de recuperação');
select ok(pg_temp.na_fila('video'), 'vídeo também');
select ok(not pg_temp.na_fila('guardada'), 'o que já está no balde não entra');
select ok(not pg_temp.na_fila('velha'), 'mais de 30 dias: a Meta já apagou, não entra');
select ok(not pg_temp.na_fila('texto'), 'texto não é mídia');

-- Três falhas tiram da fila.
select public.wa_midia_falhou(pg_temp.v('foto'), 'baixar: 404');
select public.wa_midia_falhou(pg_temp.v('foto'), 'baixar: 404');
select ok(pg_temp.na_fila('foto'), 'com duas falhas ainda tenta');
select is((public.wa_midia_falhou(pg_temp.v('foto'), 'baixar: 404') ->> 'tentativas')::int, 3,
  'a terceira falha fica contada');
select ok(not pg_temp.na_fila('foto'), 'e na terceira sai da fila');

-- Só o worker chama.
set local role authenticated;
select throws_ok($$ select * from public.wa_midias_sem_arquivo(10) $$, '42501', NULL,
  'quem usa o CRM não chama a fila de recuperação');
reset role;

select * from finish();
rollback;

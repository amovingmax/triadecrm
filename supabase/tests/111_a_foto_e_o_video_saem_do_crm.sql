-- =====================================================================
-- pgTAP — A foto e o vídeo saem do CRM (migração 20261016100000)
--
--   1. A gestão grava, com a própria sessão, a mensagem de foto e de vídeo
--      (é o que a rota /api/midia-de-saida/enviar faz depois do upload).
--   2. A legenda sai assinada com o primeiro nome, como o texto livre; a foto
--      sem legenda continua sem corpo nenhum.
--   3. O item do lote leva o arquivo e o tipo para o worker.
--   4. O balde aceita os formatos que a tela sobe.
--
-- Roda em transação e desfaz tudo.
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
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000011101'::uuid $$;
create function pg_temp.conversa(p_peer text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.conversations where peer_phone_e164 = p_peer
$$;
create function pg_temp.corpo(p_id uuid) returns text language sql security definer set search_path = '' as $$
  select body from public.messages where id = p_id
$$;

insert into public.allowed_users (email, role, note) values ('f111.g@teste.local', 'gestor', 'pgTAP 111');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gil(), 'f111.g@teste.local', '{"full_name":"Gilberto Gestor"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999911100"')
 where key = 'whatsapp.envio';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

-- A janela de 24 h aberta: quem fala, abre.
set role service_role;
select public.wa_entrada_registrar('wamid.F111.1', '+5584999911100', '+5584988811101', 'text', 'oi');
reset role;

-- ---------- 1. a gestão grava a foto e o vídeo ----------
-- O caminho é o que a rota de upload escolhe: a pasta da conversa. Desde
-- 27/10/2026 (`app.messages_forma`) arquivo de fora da pasta da conversa só
-- entra se for de uma mensagem que quem envia já enxerga.
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select lives_ok($$
  insert into public.messages (id, conversation_id, direction, type, status, body, media_path, media_mime,
                               author_kind, sent_by, origin)
  values ('a1110000-0000-4000-8000-000000000001', pg_temp.conversa('+5584988811101'), 'out', 'image',
          'queued', 'O cardápio de dezembro',
          pg_temp.conversa('+5584988811101') || '/saida/1760000000000-abcd1234.jpg', 'image/jpeg',
          'human', 'a0000000-0000-4000-8000-000000011101', 'crm')
$$, 'A GESTÃO GRAVA A FOTO com a própria sessão: a policy de messages aceita image');
select lives_ok($$
  insert into public.messages (id, conversation_id, direction, type, status, body, media_path, media_mime,
                               author_kind, sent_by, origin)
  values ('a1110000-0000-4000-8000-000000000002', pg_temp.conversa('+5584988811101'), 'out', 'video',
          'queued', null, pg_temp.conversa('+5584988811101') || '/saida/1760000000001-beef5678.mp4', 'video/mp4',
          'human', 'a0000000-0000-4000-8000-000000011101', 'crm')
$$, 'e o vídeo, sem legenda');
select pg_temp.sair();

-- ---------- 2. a legenda leva o nome ----------
select is(pg_temp.corpo('a1110000-0000-4000-8000-000000000001'), E'*Gilberto:*\nO cardápio de dezembro',
  'A LEGENDA SAI ASSINADA com o primeiro nome em negrito, como o texto livre');
select ok(pg_temp.corpo('a1110000-0000-4000-8000-000000000002') is null,
  'e o vídeo sem legenda continua sem corpo: não nasce uma legenda só com o nome');

-- ---------- 3. o lote leva o arquivo ----------
select is(app.wa_enfileirar_envio('a1110000-0000-4000-8000-000000000001') ->> 'enfileirado', 'true',
  'a foto entra na fila de saída');
select is(app.wa_enfileirar_envio('a1110000-0000-4000-8000-000000000002') ->> 'enfileirado', 'true',
  'e o vídeo também');

create table pg_temp.lote as select app.wa_proximos(50) as j;
select is((select i ->> 'media_path' || ' ' || (i ->> 'tipo') from pg_temp.lote l, jsonb_array_elements(l.j -> 'itens') i
            where (i ->> 'message_id')::uuid = 'a1110000-0000-4000-8000-000000000001'),
  pg_temp.conversa('+5584988811101') || '/saida/1760000000000-abcd1234.jpg image',
  'O ITEM DA FOTO LEVA O ARQUIVO E O TIPO — é o que o worker sobe para a Meta');
select is((select i ->> 'media_mime' from pg_temp.lote l, jsonb_array_elements(l.j -> 'itens') i
            where (i ->> 'message_id')::uuid = 'a1110000-0000-4000-8000-000000000002'),
  'video/mp4', 'e o do vídeo leva o tipo do arquivo');

-- ---------- 4. o balde ----------
select ok((select allowed_mime_types @> array['image/jpeg', 'image/png', 'video/mp4', 'video/3gpp']
                  and file_size_limit >= 16 * 1024 * 1024
             from storage.buckets where id = 'mensagens'),
  'O BALDE ACEITA o que a tela sobe (JPEG, PNG, MP4, 3GP) e cabe o vídeo de 16 MB');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — O áudio gravado na tela chega ao worker (migração 20260917130000)
--
-- Até aqui, o lote de saída dizia QUEM, PARA QUEM e O QUÊ — e "o quê" era
-- sempre texto. Áudio existia só como biblioteca (R04 §6): catálogo, sem
-- arquivo. Agora quem atende grava na hora, o arquivo fica no balde privado
-- `mensagens`, e o worker precisa saber ONDE ele está para subi-lo à Meta.
--
-- O que este arquivo prova:
--   1. O item do lote carrega `media_path` e `media_mime`.
--   2. O que era texto continua saindo com os dois em null — a mudança não
--      inventou campo obrigatório para quem escreve.
--   3. As recusas da entrega continuam valendo para áudio: quem pediu para
--      sair não recebe áudio, como não recebia texto.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(11);

create function pg_temp.entrar_worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.conversa(p_peer text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.conversations where peer_phone_e164 = p_peer
$$;

-- Alguém ativo para assumir as conversas (RF-CON-04).
insert into public.allowed_users (email, role, note) values
  ('f51.sdr@teste.local', 'sdr', 'pgTAP F51');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-00000000f511', 'f51.sdr@teste.local', '{"full_name":"Sdr F51"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999995100"')
 where key = 'whatsapp.envio';
-- O bot responderia sozinho e encheria o lote de mensagens que não são o teste.
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

-- Duas conversas com a janela de 24 h aberta: quem fala, abre.
set role service_role;
select public.wa_entrada_registrar('wamid.F51.1', '+5584999995100', '+5584988885101', 'text', 'oi');
select public.wa_entrada_registrar('wamid.F51.2', '+5584999995100', '+5584988885102', 'text', 'oi');
reset role;

-- ---------- 1. o áudio, o texto e o recusado ----------
select pg_temp.entrar_worker();
insert into public.messages (id, conversation_id, direction, type, author_kind, status,
                             media_path, media_mime, sent_by)
values ('a1000000-0000-4000-8000-0000000a5101', pg_temp.conversa('+5584988885101'), 'out',
        'audio', 'human', 'queued',
        'fio/saida/1758000000000-abcd1234.webm', 'audio/webm',
        'a0000000-0000-4000-8000-00000000f511');

insert into public.messages (id, conversation_id, direction, type, author_kind, status, body, sent_by)
values ('a1000000-0000-4000-8000-0000000a5102', pg_temp.conversa('+5584988885101'), 'out',
        'text', 'human', 'queued', 'segue o áudio acima',
        'a0000000-0000-4000-8000-00000000f511');

insert into public.messages (id, conversation_id, direction, type, author_kind, status,
                             media_path, media_mime, sent_by)
values ('a1000000-0000-4000-8000-0000000a5103', pg_temp.conversa('+5584988885102'), 'out',
        'audio', 'human', 'queued',
        'fio/saida/1758000000001-beef5678.webm', 'audio/webm',
        'a0000000-0000-4000-8000-00000000f511');

select is(app.wa_enfileirar_envio('a1000000-0000-4000-8000-0000000a5101') ->> 'enfileirado', 'true',
  'o áudio entra na fila de saída como qualquer mensagem');
select is(app.wa_enfileirar_envio('a1000000-0000-4000-8000-0000000a5102') ->> 'enfileirado', 'true',
  'e o texto da mesma conversa também');
select is(app.wa_enfileirar_envio('a1000000-0000-4000-8000-0000000a5103') ->> 'enfileirado', 'true',
  'o áudio da segunda conversa idem');

-- O MUNDO MUDA depois da enfileirada: a segunda conversa pede para sair.
select app.suppress('phone', '+5584988885102', 'contact_optout', 'whatsapp'::app.channel, null);

create table pg_temp.lote as select app.wa_proximos(50) as j;
create function pg_temp.item(p_msg uuid) returns jsonb language sql as $$
  select i from pg_temp.lote l, jsonb_array_elements(l.j -> 'itens') i
   where (i ->> 'message_id')::uuid = p_msg
$$;

-- ---------- 2. o lote leva o arquivo ----------
select is(pg_temp.item('a1000000-0000-4000-8000-0000000a5101') ->> 'media_path',
  'fio/saida/1758000000000-abcd1234.webm',
  'O ITEM DO ÁUDIO LEVA O CAMINHO DO ARQUIVO — sem isto o worker não tem o que subir');
select is(pg_temp.item('a1000000-0000-4000-8000-0000000a5101') ->> 'media_mime', 'audio/webm',
  'e leva o tipo, que é o que decide entre subir como está e trocar a embalagem');
select is(pg_temp.item('a1000000-0000-4000-8000-0000000a5101') ->> 'tipo', 'audio',
  'o tipo da mensagem continua dizendo que é áudio');

-- ---------- 3. o que não mudou ----------
select ok(pg_temp.item('a1000000-0000-4000-8000-0000000a5102') ->> 'media_path' is null,
  'mensagem de texto sai com o caminho vazio: a mudança não inventou campo obrigatório');
select is((select status from public.messages where id = 'a1000000-0000-4000-8000-0000000a5103'),
  'failed', 'e o áudio de quem pediu para sair morre na entrega, como o texto morreria');
select pg_temp.sair();

-- ---------- 4. o balde aceita o que o NAVEGADOR grava ----------
-- Esta é a lição de uma recusa em produção: o balde `mensagens` nasceu com a
-- lista de tipos da CLOUD API, porque o único remetente era o worker guardando
-- o que chega. Quem grava pela tela é o segundo remetente, e o Chrome grava
-- webm — que a Meta não aceita e que por isso não estava na lista. O upload era
-- recusado antes de virar mensagem, e a tela só sabia dizer "tente de novo".
select ok('audio/webm' = any (select unnest(allowed_mime_types) from storage.buckets where id = 'mensagens'),
  'O BALDE ACEITA audio/webm — é o que o Chrome grava, e é o que a tela sobe');
select ok('video/webm' = any (select unnest(allowed_mime_types) from storage.buckets where id = 'mensagens'),
  'e video/webm também: alguns navegadores rotulam assim a gravação só de áudio');
select ok('audio/ogg' = any (select unnest(allowed_mime_types) from storage.buckets where id = 'mensagens'),
  'sem perder o ogg da Meta: guardar o que chega continua sendo o outro trabalho do balde');

rollback;

-- =====================================================================
-- pgTAP — A IA que atende manda a foto do imóvel para confirmar
-- (migração 20261124170000, Imova)
--
-- Prova:
--   1. a capa do anúncio é a primeira foto da ordem; código desconhecido ou
--      anúncio sem foto devolvem nulo;
--   2. a foto só sai depois do texto daquela resposta, uma vez, assinada, em
--      fila, como imagem da IA, com o código em `ia_respostas.detalhes.foto`;
--   3. as travas: legenda vazia ou longa, imóvel desconhecido, arquivo fora de
--      `ia/` ou que não existe, mensagem nova do cliente, conversa em que a IA
--      não atende;
--   4. a IA lê a própria foto na conversa como "[foto do anúncio X que você
--      mandou]" e a legenda, sem a assinatura;
--   5. a foto da IA sem a prova continua recusada pela porteira.
--
-- Só na Imova. Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'pgTAP 203 é da Imova: rode no banco local da Imova';
  end if;
end $$;

select plan(24);

insert into public.allowed_users (email, role, note) values ('g203@teste.local', 'gestor', 'pgTAP 203');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000020301'::uuid, 'g203@teste.local', '{"full_name":"Gil Gestor"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999920300"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
delete from public.app_settings where key = 'ia.atendente';
insert into public.app_settings (key, value, description)
values ('ia.atendente',
        '{"ligada": true, "modo": "clientes", "assinatura": "Imova", "espera_seg": 15,
          "teto_por_hora": 20, "conversas_de_teste": []}'::jsonb,
        'pgTAP 203');

create temp table t203(chave text primary key, valor uuid);
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t203 where chave = p_chave
$$;

-- O anúncio com duas fotos (a de posição 1 é a capa) e um sem foto.
insert into public.anuncios (codigo, titulo) values ('PGT203', 'Terreno de teste em Capim Macio');
insert into t203 select 'anuncio', id from public.anuncios where codigo = 'PGT203';
insert into public.anuncio_fotos (anuncio_id, caminho, posicao) values
  (pg_temp.id('anuncio'), 'pgt203/segunda.jpg', 2),
  (pg_temp.id('anuncio'), 'pgt203/capa.jpg', 1);
insert into public.anuncios (codigo, titulo) values ('PGT203S', 'Sem foto');

-- A conversa do cliente, com a mensagem dele esperando resposta.
insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
values ('whatsapp'::app.channel, '+5584999920300', '+5584988820301', 'Clara Cliente',
        'a0000000-0000-4000-8000-000000020301'::uuid, 'aguardando_nos');
insert into t203 select 'conversa', id from public.conversations where peer_phone_e164 = '+5584988820301';
insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
values (pg_temp.id('conversa'), 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
        'Oi, vi um terreno à venda perto da Avenida Gustavo Neves. Ainda está disponível?', 'system', 'crm',
        now() - interval '1 minute');
insert into t203 select 'm1', id from public.messages where conversation_id = pg_temp.id('conversa');

-- A cópia da capa no balde das mensagens, como o worker faz.
insert into storage.objects (bucket_id, name) values
  ('mensagens', 'ia/pgt203/capa.jpg'), ('mensagens', 'fora/pgt203.jpg');

-- ---------------------------------------------------------------------
-- 1. A capa
-- ---------------------------------------------------------------------
select is(public.ia_atendente_capa_do_imovel('PGT203') ->> 'caminho', 'pgt203/capa.jpg',
          'a capa é a primeira foto da ordem do anúncio');
select is(public.ia_atendente_capa_do_imovel('pgt203') ->> 'codigo', 'PGT203',
          'o código vale sem diferença de maiúscula');
select is(public.ia_atendente_capa_do_imovel('NAOEXISTE'), null, 'código desconhecido: nulo');
select is(public.ia_atendente_capa_do_imovel('PGT203S'), null, 'anúncio sem foto: nulo');

-- ---------------------------------------------------------------------
-- 2. A foto vem depois do texto
-- ---------------------------------------------------------------------
select is(public.ia_atendente_mostrar_foto(pg_temp.id('conversa'), pg_temp.id('m1'), 'PGT203',
            'ia/pgt203/capa.jpg', 'É este aqui que você viu?') ->> 'motivo',
          'sem_texto_antes', 'sem o texto da resposta, a foto não sai');

select is((public.ia_atendente_responder(pg_temp.id('conversa'), pg_temp.id('m1'),
             'Acho que já sei qual é! Temos um terreno de 900 m² bem perto da Gustavo Neves.') ->> 'ok')::boolean,
          true, 'o texto sai primeiro');

-- ---------------------------------------------------------------------
-- 3. As travas
-- ---------------------------------------------------------------------
select is(public.ia_atendente_mostrar_foto(pg_temp.id('conversa'), pg_temp.id('m1'), 'PGT203',
            'ia/pgt203/capa.jpg', '   ') ->> 'motivo', 'legenda_vazia', 'legenda vazia: recusa');
select is(public.ia_atendente_mostrar_foto(pg_temp.id('conversa'), pg_temp.id('m1'), 'PGT203',
            'ia/pgt203/capa.jpg', repeat('a', 301)) ->> 'motivo', 'legenda_longa_demais', 'legenda longa: recusa');
select is(public.ia_atendente_mostrar_foto(pg_temp.id('conversa'), pg_temp.id('m1'), 'NAOEXISTE',
            'ia/pgt203/capa.jpg', 'É este aqui?') ->> 'motivo', 'imovel_desconhecido', 'imóvel desconhecido: recusa');
select is(public.ia_atendente_mostrar_foto(pg_temp.id('conversa'), pg_temp.id('m1'), 'PGT203',
            'fora/pgt203.jpg', 'É este aqui?') ->> 'motivo', 'arquivo_nao_existe', 'arquivo fora de ia/: recusa');
select is(public.ia_atendente_mostrar_foto(pg_temp.id('conversa'), pg_temp.id('m1'), 'PGT203',
            'ia/pgt203/nao-subiu.jpg', 'É este aqui?') ->> 'motivo', 'arquivo_nao_existe',
          'arquivo que não está no balde: recusa');
select is((select count(*) from public.messages
            where conversation_id = pg_temp.id('conversa') and type = 'image'::app.msg_type)::int, 0,
          'nenhuma recusa pôs foto na fila');

-- ---------------------------------------------------------------------
-- 2 (continuação). A foto sai
-- ---------------------------------------------------------------------
select is((public.ia_atendente_mostrar_foto(pg_temp.id('conversa'), pg_temp.id('m1'), 'pgt203',
             'ia/pgt203/capa.jpg', 'É este aqui que você viu?', '{"motivo": "teste"}'::jsonb) ->> 'ok')::boolean,
          true, 'com o texto já enviado, a foto sai');
select is((select m.body from public.messages m
            where m.conversation_id = pg_temp.id('conversa') and m.type = 'image'::app.msg_type),
          '*Imova:*' || E'\n' || 'É este aqui que você viu?', 'a legenda sai assinada "Imova", como o texto');
select is((select m.author_kind || '/' || m.status::text || '/' || m.media_path || '/' || m.media_mime
             from public.messages m
            where m.conversation_id = pg_temp.id('conversa') and m.type = 'image'::app.msg_type),
          'bot_ai/queued/ia/pgt203/capa.jpg/image/jpeg', 'em fila, como foto da IA, com o arquivo copiado');
select ok((select m_foto.created_at >= m_texto.created_at and m_foto.id <> m_texto.id
             from public.messages m_texto, public.messages m_foto
            where m_texto.conversation_id = pg_temp.id('conversa') and m_texto.type = 'text'::app.msg_type
              and m_texto.direction = 'out'::app.msg_direction
              and m_foto.conversation_id = pg_temp.id('conversa') and m_foto.type = 'image'::app.msg_type),
          'a foto entra na fila depois do texto');
select is((select r.detalhes ->> 'foto' || '/' || (r.detalhes ->> 'motivo')
             from public.ia_respostas r join public.messages m on m.id = r.message_id
            where m.conversation_id = pg_temp.id('conversa') and m.type = 'image'::app.msg_type),
          'PGT203/teste', 'a resposta da foto guarda o código do anúncio e os detalhes');
select is(public.ia_atendente_mostrar_foto(pg_temp.id('conversa'), pg_temp.id('m1'), 'PGT203',
            'ia/pgt203/capa.jpg', 'É este aqui?') ->> 'motivo', 'foto_ja_mandada',
          'uma foto por mensagem do cliente');

-- ---------------------------------------------------------------------
-- 4. A IA vê a própria foto
-- ---------------------------------------------------------------------
select ok(exists (select 1 from jsonb_array_elements(public.ia_entrada_do_atendente(pg_temp.id('conversa')) -> 'mensagens') x
                   where x ->> 'de' = 'ia'
                     and x ->> 'texto' = '[foto do anúncio PGT203 que você mandou] É este aqui que você viu?'),
          'a IA lê a foto que mandou, com o código e a legenda sem assinatura');

-- ---------------------------------------------------------------------
-- 3 (continuação). Mensagem nova do cliente e conversa sem IA
-- ---------------------------------------------------------------------
insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
values (pg_temp.id('conversa'), 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
        'É esse sim!', 'system', 'crm', now());
insert into t203 select 'm2', id from public.messages
 where conversation_id = pg_temp.id('conversa') and body = 'É esse sim!';
select is(public.ia_atendente_mostrar_foto(pg_temp.id('conversa'), pg_temp.id('m1'), 'PGT203',
            'ia/pgt203/capa.jpg', 'É este aqui?') ->> 'motivo', 'chegou_mensagem_nova',
          'o cliente escreveu de novo: a foto velha não sai');
select ok(exists (select 1 from jsonb_array_elements(public.ia_entrada_do_atendente(pg_temp.id('conversa')) -> 'mensagens') x
                   where x ->> 'de' = 'cliente' and x ->> 'texto' = 'É esse sim!'),
          'e a resposta do cliente à foto chega para a IA');

update public.app_settings set value = value || '{"ligada": false}'::jsonb where key = 'ia.atendente';
select is(public.ia_atendente_mostrar_foto(pg_temp.id('conversa'), pg_temp.id('m2'), 'PGT203',
            'ia/pgt203/capa.jpg', 'É este aqui?') ->> 'motivo', 'ia_nao_atende',
          'IA desligada: nenhuma foto sai');
update public.app_settings set value = value || '{"ligada": true}'::jsonb where key = 'ia.atendente';

-- ---------------------------------------------------------------------
-- 5. A porteira
-- ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.messages (conversation_id, direction, type, status, body, media_path, media_mime, author_kind, origin)
    values (pg_temp.id('conversa'), 'out', 'image', 'queued', '*Imova:*' || E'\n' || 'foto solta',
            'ia/pgt203/capa.jpg', 'image/jpeg', 'bot_ai', 'crm')$$,
  '42501', null,
  'foto da IA sem a prova da porta continua recusada');

select ok(obj_description('public.ia_atendente_mostrar_foto(uuid,uuid,text,text,text,jsonb,bigint,text)'::regprocedure, 'pg_proc')
            like '%foto do imóvel%',
          'a porta conta o que faz');

select * from finish();
rollback;

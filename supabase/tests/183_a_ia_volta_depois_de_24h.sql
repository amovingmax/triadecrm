-- =====================================================================
-- pgTAP — A IA volta a atender 24 h depois do time (migração 20261117230000)
--
-- Decisão do usuário em 17/11/2026: a IA atende quando a mensagem do cliente
-- chega 24 h ou mais depois da última mensagem do time (ou da passagem da IA
-- para a equipe). "Parar a IA" por uma pessoa continua valendo até religar.
-- Este arquivo prova:
--
--   1. O time escreveu há pouco: a IA fica quieta (como antes);
--   2. O time escreveu há mais de 24 h e o cliente escreve agora: a IA atende;
--   3. O cliente respondeu ao time dentro das 24 h: a mensagem fica com o
--      time, mesmo depois que as 24 h passam;
--   4. Sem mensagem esperando, a tela diz se a IA responderia a próxima;
--   5. A IA passou para a equipe: 24 h com a equipe, depois a IA volta;
--   6. Uma pessoa parou a IA: fica parada, com qualquer idade;
--   7. Robô pausado e modo treino continuam valendo;
--   8. A fila pega o cliente que voltou depois de 24 h.
--
-- Só na Imova (na KOMUNE a IA que atende não existe). Roda em transação e
-- desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'pgTAP 183 é da Imova: rode no banco local da Imova';
  end if;
end $$;

select plan(16);

insert into public.allowed_users (email, role, note) values
  ('h183.g@teste.local', 'gestor', 'pgTAP 183');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000018301'::uuid, 'h183.g@teste.local', '{"full_name":"Gil Gestor"}');

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
        '{"ligada": true, "modo": "clientes", "espera_seg": 15, "teto_por_hora": 20,
          "conversas_de_teste": []}'::jsonb,
        'pgTAP 183');

create temp table t183(chave text primary key, valor uuid);
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t183 where chave = p_chave
$$;
create function pg_temp.conversa(p_chave text, p_tel text, p_nome text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status,
                                    last_inbound_at)
  values ('whatsapp'::app.channel, '+5584999918300', p_tel, p_nome,
          'a0000000-0000-4000-8000-000000018301'::uuid, 'aguardando_nos', now())
  returning id into v;
  insert into t183 values (p_chave, v);
  return v;
end $$;
-- Mensagem do cliente, há `p_horas` horas.
create function pg_temp.dele(p_conv uuid, p_horas numeric, p_texto text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_texto, 'system', 'crm', now() - make_interval(secs => (p_horas * 3600)::int))
  returning id into v;
  return v;
end $$;
-- Mensagem de gente do time, há `p_horas` horas.
create function pg_temp.nossa(p_conv uuid, p_horas numeric) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'pgtap183 nossa', 'human', 'echo', 'a0000000-0000-4000-8000-000000018301'::uuid,
          'wamid.PGTAP183.' || gen_random_uuid(),
          now() - make_interval(secs => (p_horas * 3600)::int),
          now() - make_interval(secs => (p_horas * 3600)::int))
$$;

-- ---------------------------------------------------------------------
-- 1. O time escreveu há pouco
-- ---------------------------------------------------------------------
select pg_temp.conversa('recente', '+5584988818301', 'Rita Recente');
select pg_temp.dele(pg_temp.id('recente'), 3, 'Oi, o terreno ainda está à venda?');
select pg_temp.nossa(pg_temp.id('recente'), 2);
select pg_temp.dele(pg_temp.id('recente'), 0.01, 'E aceita proposta?');
select is(app.ia_atende(pg_temp.id('recente')), false,
          'o time escreveu há 2 h e o cliente respondeu: a conversa é do time');

-- ---------------------------------------------------------------------
-- 2. O time escreveu há mais de 24 h; o cliente volta agora
-- ---------------------------------------------------------------------
select pg_temp.conversa('volta', '+5584988818302', 'Vitor Volta');
select pg_temp.dele(pg_temp.id('volta'), 50, 'Bom dia, quanto custa a casa?');
select pg_temp.nossa(pg_temp.id('volta'), 49);
select pg_temp.dele(pg_temp.id('volta'), 0.01, 'Oi, ainda tem aquela casa?');
select is(app.ia_atende(pg_temp.id('volta')), true,
          'o time escreveu há 49 h e o cliente volta agora: a IA atende');

-- Na beira: 23 h 50 min depois do time, ainda é do time.
select pg_temp.conversa('beira', '+5584988818303', 'Bia Beira');
select pg_temp.nossa(pg_temp.id('beira'), 24);
select pg_temp.dele(pg_temp.id('beira'), 0.2, 'Obrigada, vou pensar');
select is(app.ia_atende(pg_temp.id('beira')), false,
          '23 h 48 min depois do time: ainda é do time');

-- ---------------------------------------------------------------------
-- 3. O cliente respondeu dentro das 24 h, e as 24 h passaram depois
-- ---------------------------------------------------------------------
select pg_temp.conversa('esperou', '+5584988818304', 'Edu Esperou');
select pg_temp.nossa(pg_temp.id('esperou'), 30);
select pg_temp.dele(pg_temp.id('esperou'), 29, 'Combinado, fico no aguardo');
select is(app.ia_atende(pg_temp.id('esperou')), false,
          'resposta do cliente 1 h depois do time fica com o time, mesmo 29 h depois');
select pg_temp.dele(pg_temp.id('esperou'), 0.01, 'Alguma novidade?');
select is(app.ia_atende(pg_temp.id('esperou')), true,
          'o cliente escreve de novo 30 h depois do time: a IA atende');

-- ---------------------------------------------------------------------
-- 4. Sem mensagem esperando: a tela diz se a IA responderia a próxima
-- ---------------------------------------------------------------------
select pg_temp.conversa('quieta', '+5584988818305', 'Quim Quieta');
select pg_temp.dele(pg_temp.id('quieta'), 3, 'Bom dia');
select pg_temp.nossa(pg_temp.id('quieta'), 2);
select is(app.ia_atende(pg_temp.id('quieta')), false,
          'o time foi o último a escrever, há 2 h: a tela diz parada');
select pg_temp.conversa('antiga', '+5584988818306', 'Ana Antiga');
select pg_temp.dele(pg_temp.id('antiga'), 80, 'Bom dia');
select pg_temp.nossa(pg_temp.id('antiga'), 79);
select is(app.ia_atende(pg_temp.id('antiga')), true,
          'o time foi o último a escrever, há 79 h: a IA responderia o próximo');

-- ---------------------------------------------------------------------
-- 5. A IA passou para a equipe
-- ---------------------------------------------------------------------
select pg_temp.conversa('passou', '+5584988818307', 'Paulo Passou');
select pg_temp.dele(pg_temp.id('passou'), 26, 'Quero visitar no sábado');
insert into public.ia_atendimento (conversation_id, estado, motivo, mudou_por, mudou_em)
values (pg_temp.id('passou'), 'parada', 'pedido de visita', null, now() - interval '25 hours');
select pg_temp.dele(pg_temp.id('passou'), 0.01, 'Alguém vai me responder?');
select is(app.ia_atende(pg_temp.id('passou')), true,
          'a IA passou há 25 h e a equipe não respondeu: o cliente escreve e a IA volta');
update public.ia_atendimento set mudou_em = now() - interval '3 hours'
 where conversation_id = pg_temp.id('passou');
select is(app.ia_atende(pg_temp.id('passou')), false,
          'a IA passou há 3 h: ainda é da equipe');

-- ---------------------------------------------------------------------
-- 6. Uma pessoa parou a IA
-- ---------------------------------------------------------------------
select pg_temp.conversa('parou', '+5584988818308', 'Pedro Parou');
select pg_temp.dele(pg_temp.id('parou'), 100, 'Oi');
insert into public.ia_atendimento (conversation_id, estado, motivo, mudou_por, mudou_em)
values (pg_temp.id('parou'), 'parada', 'falando errado', 'a0000000-0000-4000-8000-000000018301'::uuid,
        now() - interval '90 hours');
select pg_temp.dele(pg_temp.id('parou'), 0.01, 'Oi de novo');
select is(app.ia_atende(pg_temp.id('parou')), false,
          'parada por uma pessoa há 90 h: continua parada');
-- Religada pela pessoa: volta, e mensagem do time de antes de ligar não conta.
update public.ia_atendimento set estado = 'atendendo', mudou_em = now() - interval '1 hour'
 where conversation_id = pg_temp.id('parou');
select pg_temp.nossa(pg_temp.id('parou'), 2);
select is(app.ia_atende(pg_temp.id('parou')), true,
          'religada há 1 h: a mensagem do time de 2 h atrás, antes de ligar, não conta');

-- ---------------------------------------------------------------------
-- 7. Robô pausado e modo treino continuam valendo
-- ---------------------------------------------------------------------
update public.conversations set bot_paused = true where id = pg_temp.id('volta');
select is(app.ia_atende(pg_temp.id('volta')), false, 'robô pausado: a IA não atende');
update public.conversations set bot_paused = false where id = pg_temp.id('volta');
update public.app_settings set value = value || '{"modo": "treino"}'::jsonb where key = 'ia.atendente';
select is(app.ia_atende(pg_temp.id('volta')), false, 'modo treino: cliente de verdade, não');
update public.app_settings set value = value || '{"modo": "clientes"}'::jsonb where key = 'ia.atendente';

-- ---------------------------------------------------------------------
-- 8. A fila pega quem voltou
-- ---------------------------------------------------------------------
select ok(app.ia_atendente_enfileirar(50) >= 1, 'a fila anda');
select ok(exists (select 1 from pgmq.q_ai_jobs q
                   where q.message ->> 'purpose' = 'draft_reply'
                     and (q.message ->> 'conversation_id')::uuid = pg_temp.id('volta')),
          'o cliente que voltou depois de 24 h entra na fila da IA');
select ok(not exists (select 1 from pgmq.q_ai_jobs q
                       where (q.message ->> 'conversation_id')::uuid
                             in (pg_temp.id('recente'), pg_temp.id('beira'), pg_temp.id('passou'))),
          'quem é do time, ou foi passado pela IA há pouco, fica fora da fila');

select * from finish();
rollback;

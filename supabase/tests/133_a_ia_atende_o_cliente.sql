-- =====================================================================
-- pgTAP — A IA que atende o cliente sozinha (migração 20261106170000)
--
-- Decisões do usuário em 06/11/2026: na Imova a trava do ADR-05 não existe
-- para a IA que atende; ela assina "Imova"; quando o cliente pede corretor,
-- avisa e passa; o colaborador para a IA numa conversa; uma semana de treino
-- pela conversa do Janio. Este arquivo prova:
--
--   1. Os PREÇOS do Opus 5.5 e do Sonnet 5.5 existem;
--   2. A PORTEIRA continua recusando `bot_ai` sem rascunho que não venha da
--      função da IA, mesmo com a IA ligada;
--   3. DESLIGADA, a IA não atende ninguém; no TREINO, só a conversa do treino;
--      com CLIENTES, a conversa em que o time não escreveu (ou em que alguém a
--      ligou);
--   4. RESPONDER: sai em fila, `bot_ai`, assinado "Imova", sem aprovador, com a
--      prova ligada à mensagem; não responde duas vezes a mesma mensagem; não
--      responde com mensagem nova do cliente na frente; respeita o teto por hora;
--   5. GENTE ASSUME: mensagem de alguém do time para a IA; parar pela tela
--      também; ligar de novo devolve;
--   6. PASSAR: avisa, para, entrega e abre tarefa; pedido de corretor é
--      resolvido pela fila, sem modelo;
--   7. A FILA pega quem parou de escrever e espera quem acabou de escrever;
--   8. O CADERNO: só a conversa do treino anota; "Corrigir" vira linha do
--      caderno;
--   9. QUEM VÊ: gestor e SDR veem; leitura não.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(44);

insert into public.allowed_users (email, role, note) values
  ('h133.g@teste.local', 'gestor', 'pgTAP 133'),
  ('h133.s@teste.local', 'sdr', 'pgTAP 133'),
  ('h133.l@teste.local', 'leitura', 'pgTAP 133');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000013301'::uuid, 'h133.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000013302'::uuid, 'h133.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000013303'::uuid, 'h133.l@teste.local', '{"full_name":"Leo Leitura"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999913300"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
delete from public.app_settings where key = 'ia.atendente';
delete from public.ia_caderno;

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

create temp table t133(chave text primary key, valor uuid);
grant all on t133 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t133 where chave = p_chave
$$;
create function pg_temp.conversa(p_chave text, p_tel text, p_nome text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999913300', p_tel, p_nome,
          'a0000000-0000-4000-8000-000000013301'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t133 values (p_chave, v);
  return v;
end $$;
-- Mensagem do cliente, há `p_seg` segundos.
create function pg_temp.dele(p_chave text, p_conv uuid, p_seg int, p_texto text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_texto, 'system', 'crm', now() - make_interval(secs => p_seg))
  returning id into v;
  insert into t133 values (p_chave, v);
  return v;
end $$;
-- Mensagem de gente do time, `p_seg` segundos DEPOIS de agora (o relógio da
-- transação não anda).
create function pg_temp.nossa(p_conv uuid, p_seg int) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'pgtap133 nossa', 'human', 'echo', 'a0000000-0000-4000-8000-000000013301'::uuid,
          'wamid.PGTAP133.' || gen_random_uuid(), now() + make_interval(secs => p_seg),
          now() + make_interval(secs => p_seg))
$$;

select pg_temp.conversa('treino', '+5584988813301', 'Janio Ramalho');
select pg_temp.conversa('cliente', '+5584988813302', 'Clara Cliente');
select pg_temp.conversa('atendida', '+5584988813303', 'Ana Atendida');
select pg_temp.conversa('corretor', '+5584988813304', 'Caio Corretor');
select pg_temp.dele('t1', pg_temp.id('treino'), 120, 'Oi, vi a placa de vocês. Tem apartamento para alugar?');
select pg_temp.dele('c1', pg_temp.id('cliente'), 60, 'Bom dia, quanto custa o terreno?');
select pg_temp.dele('a1', pg_temp.id('atendida'), 600, 'Oi');
select pg_temp.nossa(pg_temp.id('atendida'), -500);
select pg_temp.dele('a2', pg_temp.id('atendida'), 60, 'E o condomínio?');

-- ---------------------------------------------------------------------
-- 1. Os preços
-- ---------------------------------------------------------------------
select ok(exists (select 1 from public.ai_model_prices where model = 'claude-opus-5-5' and entrada = 4.00 and saida = 20.00),
          'o Opus 5.5 tem preço (US$ 4 / US$ 20)');
select ok(exists (select 1 from public.ai_model_prices where model = 'claude-sonnet-5-5' and entrada = 2.00 and saida = 10.00),
          'o Sonnet 5.5 tem preço (US$ 2 / US$ 10)');

-- ---------------------------------------------------------------------
-- 3. Desligada, não atende ninguém
-- ---------------------------------------------------------------------
select is(app.ia_atende(pg_temp.id('treino')), false, 'desligada: a IA não atende nem a conversa do treino');
select is(public.ia_atendente_responder(pg_temp.id('treino'), pg_temp.id('t1'), 'Oi!') ->> 'motivo', 'ia_nao_atende',
          'desligada: responder é recusado com motivo');

-- Ligar é de admin e gestor; o SDR não configura.
select pg_temp.entrar('a0000000-0000-4000-8000-000000013302'::uuid, 'sdr');
select is(public.ia_atendente_configurar('{"ligada": true}'::jsonb) ->> 'motivo', 'sem_permissao',
          'o SDR não liga a IA');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000013301'::uuid, 'gestor');
select is(public.ia_atendente_configurar('{"ligada": "sim"}'::jsonb) ->> 'motivo', 'ligada_nao_e_sim_ou_nao',
          'configurar recusa valor torto');
select is(public.ia_atendente_configurar('{"chave_que_nao_existe": 1}'::jsonb) ->> 'motivo', 'chave_desconhecida',
          'configurar recusa chave desconhecida');
select is((public.ia_atendente_configurar(jsonb_build_object(
            'ligada', true, 'modo', 'treino', 'conversa_de_treino', pg_temp.id('treino'))) ->> 'ok')::boolean,
          true, 'o gestor liga a IA no treino, com a conversa do Janio');
select pg_temp.sair();

select is(app.ia_atende(pg_temp.id('treino')), true, 'treino: a IA atende a conversa do treino');
select is(app.ia_atende(pg_temp.id('cliente')), false, 'treino: a IA não atende cliente nenhum');

-- ---------------------------------------------------------------------
-- 2. A porteira continua fechada para bot_ai que não vem da IA que atende
-- ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
    values (pg_temp.id('treino'), 'out', 'text', 'queued', '*Imova:*' || E'\n' || 'texto solto', 'bot_ai', 'crm')$$,
  '42501', null,
  'bot_ai sem rascunho e sem a prova da IA continua recusado, mesmo com a IA ligada');

-- ---------------------------------------------------------------------
-- 4. Responder
-- ---------------------------------------------------------------------
select is((public.ia_atendente_responder(pg_temp.id('treino'), pg_temp.id('t1'),
             'Oi, Janio! Temos sim. Que bairro você procura?') ->> 'ok')::boolean,
          true, 'a IA responde à conversa do treino');
select is((select m.body from public.messages m
            where m.conversation_id = pg_temp.id('treino') and m.direction = 'out'),
          '*Imova:*' || E'\n' || 'Oi, Janio! Temos sim. Que bairro você procura?',
          'a mensagem sai assinada "Imova"');
select is((select m.author_kind || '/' || m.status::text || '/' || coalesce(m.approved_by::text, 'sem aprovador')
             from public.messages m where m.conversation_id = pg_temp.id('treino') and m.direction = 'out'),
          'bot_ai/queued/sem aprovador',
          'sai em fila, como texto da IA e sem aprovador (ninguém finge ter aprovado)');
select ok(exists (select 1 from public.ia_respostas r join public.messages m on m.id = r.message_id
                   where r.conversation_id = pg_temp.id('treino') and r.acao = 'respondeu'
                     and r.em_resposta_a = pg_temp.id('t1') and r.corpo = m.body),
          'a resposta fica registrada e ligada à mensagem que saiu');
select is(public.ia_atendente_responder(pg_temp.id('treino'), pg_temp.id('t1'), 'De novo?') ->> 'motivo',
          'ja_respondida', 'a mesma mensagem do cliente não é respondida duas vezes');

select pg_temp.dele('t2', pg_temp.id('treino'), 30, 'Ponta Negra');
select pg_temp.dele('t3', pg_temp.id('treino'), 20, 'e com garagem');
select is(public.ia_atendente_responder(pg_temp.id('treino'), pg_temp.id('t2'), 'Resposta velha') ->> 'motivo',
          'chegou_mensagem_nova', 'resposta à mensagem anterior não sai quando o cliente já escreveu de novo');

update public.app_settings set value = value || '{"teto_por_hora": 1}'::jsonb where key = 'ia.atendente';
select is(public.ia_atendente_responder(pg_temp.id('treino'), pg_temp.id('t3'), 'Mais uma') ->> 'motivo',
          'teto_por_hora', 'o teto de respostas por hora segura o pingue-pongue');
update public.app_settings set value = value || '{"teto_por_hora": 20}'::jsonb where key = 'ia.atendente';

select is(public.ia_atendente_responder(pg_temp.id('treino'), pg_temp.id('t3'), '   ') ->> 'motivo',
          'texto_vazio', 'texto vazio não sai');

-- A entrada que o worker lê
select is((public.ia_entrada_do_atendente(pg_temp.id('treino')) ->> 'treino')::boolean, true,
          'a entrada diz que é a conversa do treino');
select is((public.ia_entrada_do_atendente(pg_temp.id('treino')) ->> 'ultima_do_cliente')::uuid, pg_temp.id('t3'),
          'a entrada aponta a última mensagem do cliente');
select is((select x ->> 'texto' from jsonb_array_elements(public.ia_entrada_do_atendente(pg_temp.id('treino')) -> 'mensagens') x
            where x ->> 'de' = 'ia'),
          'Oi, Janio! Temos sim. Que bairro você procura?',
          'na entrada, a fala da IA vem sem a assinatura');

-- ---------------------------------------------------------------------
-- 8. O caderno
-- ---------------------------------------------------------------------
select is(public.ia_atendente_anotar(pg_temp.id('treino'), pg_temp.id('t3'),
                                     array['Aceitamos seguro-fiança no aluguel.', '  ', 'ok']), 1,
          'a conversa do treino anota no caderno (só o que tem conteúdo)');
select throws_ok(
  $$select public.ia_atendente_anotar(pg_temp.id('cliente'), pg_temp.id('c1'), array['Desconto de 50%'])$$,
  '42501', null, 'conversa de cliente não anota no caderno');

select pg_temp.entrar('a0000000-0000-4000-8000-000000013302'::uuid, 'sdr');
select is(public.ia_resposta_avaliar((select r.id from public.ia_respostas r
                                       where r.conversation_id = pg_temp.id('treino') and r.acao = 'respondeu'),
                                     'corrigir', null) ->> 'motivo',
          'sem_correcao', '"Corrigir" sem dizer o certo é recusado');
select is((public.ia_resposta_avaliar((select r.id from public.ia_respostas r
                                        where r.conversation_id = pg_temp.id('treino') and r.acao = 'respondeu'),
                                      'corrigir', 'Pergunte também se é para morar ou investir.') ->> 'ok')::boolean,
          true, 'o SDR corrige a resposta');
select pg_temp.sair();
select ok(exists (select 1 from public.ia_caderno k
                   where k.origem = 'correcao' and k.ativo and k.texto like '%morar ou investir%'
                     and k.texto like '%vi a placa%'),
          'a correção vira linha do caderno, com o que o cliente disse');

-- ---------------------------------------------------------------------
-- 5. Gente assume; parar e ligar pela tela
-- ---------------------------------------------------------------------
select pg_temp.nossa(pg_temp.id('treino'), 5);
select is(app.ia_atende(pg_temp.id('treino')), false, 'quando alguém do time escreve, a IA para de responder');
select pg_temp.entrar('a0000000-0000-4000-8000-000000013302'::uuid, 'sdr');
select is((public.ia_conversa_ligar(pg_temp.id('treino')) ->> 'ok')::boolean, true, 'o SDR liga a IA de volta na conversa');
select pg_temp.sair();
-- Ligar marca "agora" (o início da transação); a mensagem do time ficou 5 s
-- depois e ainda conta: só mensagem de gente DEPOIS de ligar para a IA.
select is(app.ia_atende(pg_temp.id('treino')), false,
          'mensagem do time depois do momento em que ligaram continua valendo');
update public.ia_atendimento set mudou_em = now() + interval '10 seconds' where conversation_id = pg_temp.id('treino');
select is(app.ia_atende(pg_temp.id('treino')), true, 'ligada depois da mensagem do time, a IA volta a atender');

select pg_temp.entrar('a0000000-0000-4000-8000-000000013302'::uuid, 'sdr');
select is((public.ia_conversa_parar(pg_temp.id('treino'), 'falando errado do aluguel') ->> 'ok')::boolean, true,
          'o colaborador para a IA na conversa');
select is(public.ia_conversa_estado(pg_temp.id('treino')) ->> 'estado', 'parada',
          'a tela vê a conversa parada');
select pg_temp.sair();
select is(app.ia_atende(pg_temp.id('treino')), false, 'parada, a IA não atende');

-- ---------------------------------------------------------------------
-- 3 (clientes). Com clientes, quem o time não atendia
-- ---------------------------------------------------------------------
update public.app_settings set value = value || '{"modo": "clientes"}'::jsonb where key = 'ia.atendente';
select is(app.ia_atende(pg_temp.id('cliente')), true, 'clientes: a IA atende quem o time ainda não atendeu');
select is(app.ia_atende(pg_temp.id('atendida')), false, 'clientes: conversa em que o time já falava fica com o time');

-- ---------------------------------------------------------------------
-- 7 e 6. A fila e o pedido de corretor
-- ---------------------------------------------------------------------
select pg_temp.dele('k1', pg_temp.id('corretor'), 40, 'Quero falar com um corretor, por favor');
select pg_temp.dele('c2', pg_temp.id('cliente'), 2, 'É em Parnamirim?');
select ok(app.ia_atendente_enfileirar(20) >= 1, 'a fila pega quem está esperando');
select ok(exists (select 1 from public.ia_respostas r
                   where r.conversation_id = pg_temp.id('corretor') and r.acao = 'passou_para_pessoa'
                     and r.message_id is not null and r.prompt_version = 'regra'),
          'pedido de corretor: o aviso sai na hora, por regra');
select is((select a.estado from public.ia_atendimento a where a.conversation_id = pg_temp.id('corretor')),
          'parada', 'depois do aviso, a IA para naquela conversa');
select ok(exists (select 1 from public.tasks t
                   where t.title like 'A IA passou o cliente para você: Caio Corretor%' and t.priority = 1),
          'quem recebe ganha tarefa para agora');
select ok(not exists (select 1 from public.ia_respostas r where r.em_resposta_a = pg_temp.id('c2')),
          'quem acabou de escrever espera (a IA lê as mensagens seguidas de uma vez)');

-- ---------------------------------------------------------------------
-- 9. Quem vê
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000013303'::uuid, 'leitura');
select is((select count(*)::int from public.ia_respostas), 0, 'leitura não vê as respostas da IA');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 10. O anúncio feito à mão no Canal Pro: ativo está no ar; inativo, pausado
-- ---------------------------------------------------------------------
insert into public.anuncios_no_canal_pro (codigo, situacao, titulo, no_relatorio) values
  ('TST133A_IMOVA', 'Ativo', 'Casa de teste ativa', true),
  ('TST133B_IMOVA', 'Inativo', 'Casa de teste inativa', true);
select is((select i ->> 'situacao' from jsonb_array_elements(app.ia_atendente_imoveis()) i
            where i ->> 'codigo' = 'TST133A_IMOVA'), 'no_ar',
          'anúncio ativo no relatório do Canal Pro: a IA o oferece como disponível');
select is((select i ->> 'situacao' from jsonb_array_elements(app.ia_atendente_imoveis()) i
            where i ->> 'codigo' = 'TST133B_IMOVA'), 'pausado',
          'anúncio inativo no relatório (fora do portal): vai como pausado, a IA confirma antes');

select * from finish();
rollback;

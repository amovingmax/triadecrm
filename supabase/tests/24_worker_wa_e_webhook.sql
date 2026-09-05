-- =====================================================================
-- TRIADE — pgTAP — 20260905000201: a ponte pública do WhatsApp
--
-- A migração 20260905000200 construiu o cérebro em `app` e o teste
-- `24_ia_e_whatsapp.sql` o travou. Este arquivo trava a PONTE — o que o
-- worker e a Edge Function conseguem alcançar, que é só `public`, e as
-- três regras que nasceram junto com ela.
--
-- O que este arquivo trava, em uma frase cada:
--
--   1. A ENTRADA DA META É UMA TRANSAÇÃO SÓ. A entrega crua e os itens na
--      fila entram juntos ou não entram. A alternativa — a Edge Function
--      grava, depois enfileira — tem um instante em que a entrega está
--      registrada como recebida e nada foi enfileirado; e o registro é
--      justamente o que faz a reentrega da Meta ser ignorada. Falha no
--      meio = mensagem de fornecedor perdida em silêncio.
--
--   2. FORA DA JANELA DE 24 H SÓ SAI TEMPLATE APROVADO PELA META (R04
--      §2.1). `template_id` é uma linha da NOSSA tabela; `meta_status =
--      'approved'` é a aprovação DELES. Hoje, dos 126 modelos semeados,
--      nenhum está aprovado. Confundir os dois é mandar 132001 para a
--      Cloud API e gastar reputação do número com um erro que era nosso.
--
--   3. OPT-OUT IMEDIATO, COM FICHA OU SEM (RF-CON-19). Quem tem ficha vai
--      pelo caminho único do módulo de ligação (`app.registrar_optout_de_
--      contato`, migração 001500) — não existe um segundo. Quem NÃO tem
--      ficha, que é o caso novo do WhatsApp (uma conversa pode chegar de
--      um número que o CRM não conhece), tem o número posto na
--      `suppression_list`, que é o mesmo hash que `app.wa_motivo_de_
--      recusa` consulta. E a confirmação sai UMA vez, por constraint.
--
--   4. O RECIBO DA META SÓ ANDA PARA FRENTE. `sent`, `delivered` e `read`
--      chegam em webhooks separados e sem ordem garantida; um `delivered`
--      atrasado não pode apagar um `read` que já chegou.
--
--   5. NADA DISSO É PARA A TELA. As onze funções novas de `public` são
--      executáveis por `service_role` e por mais ninguém.
--
-- Toda asserção de contagem é DELTA sobre a base medida no início.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(71);

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
  select ('f0000000-0000-4000-8000-0000000f00' || p_n)::uuid $$;
create function pg_temp.gente(p_n text) returns uuid language sql as $$
  select ('a0000000-0000-4000-8000-0000000a00' || p_n)::uuid $$;

create function pg_temp.n_msg() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.messages $$;
create function pg_temp.n_conv() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.conversations $$;
create function pg_temp.n_entrega() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.webhook_deliveries where source = 'meta' $$;
create table pg_temp.base (chave text primary key, n int);
insert into pg_temp.base values ('msg', pg_temp.n_msg()), ('conv', pg_temp.n_conv()),
                                ('entrega', pg_temp.n_entrega());
create function pg_temp.delta(p_chave text, p_agora int) returns int language sql as $$
  select p_agora - (select n from pg_temp.base where chave = p_chave) $$;

-- As filas são globais; esvaziá-las DENTRO desta transação (que desfaz
-- tudo no fim) é o que torna determinístico o lote que o dreno devolve.
delete from pgmq.q_wa_inbound;
delete from pgmq.q_wa_outbound;
delete from pgmq.q_ai_jobs;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('ponte.admin@teste.local',   'admin',   'pgTAP wa_ponte_publica'),
  ('ponte.heloisa@teste.local', 'sdr',     'pgTAP wa_ponte_publica'),
  ('ponte.leitura@teste.local', 'leitura', 'pgTAP wa_ponte_publica');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gente('01'), 'ponte.admin@teste.local',   '{"full_name":"Admin Ponte"}'),
  (pg_temp.gente('02'), 'ponte.heloisa@teste.local', '{"full_name":"Heloisa Ponte"}'),
  (pg_temp.gente('03'), 'ponte.leitura@teste.local', '{"full_name":"Leitura Ponte"}');

-- ---------- fichas ----------
insert into public.organizations (id, kind, name, phone_e164, source_id, collector, source_url, owner_id)
select v.id, 'fornecedor', v.nome, v.fone,
       (select id from public.sources order by id limit 1), 'pgtap',
       'https://exemplo.invalido/ponte', pg_temp.gente('02')
  from (values
    (pg_temp.org('01'), 'PONTE PGTAP COM FICHA',  '+5584900000801'),
    (pg_temp.org('02'), 'PONTE PGTAP DESISTE',    '+5584900000802'),
    (pg_temp.org('03'), 'PONTE PGTAP TEMPLATE',   '+5584900000803')
  ) as v(id, nome, fone);
insert into public.contacts (id, full_name, first_name, phone_e164)
values (pg_temp.gente('11'), 'Marcos da Ponte', 'Marcos', '+5584900000801');
insert into public.organization_contacts (organization_id, contact_id, is_primary)
values (pg_temp.org('01'), pg_temp.gente('11'), true);

-- Um modelo APROVADO pela Meta, que não existe na semente: dos 126 modelos
-- semeados, nenhum tem meta_status = 'approved'. É a diferença entre o
-- nosso código e a aprovação deles que este arquivo mede.
insert into public.message_templates (template_code, name, channel, category,
                                      meta_template_name, meta_status, language, body)
values ('PGTAP-APROVADO', 'Modelo aprovado (pgTAP)', 'whatsapp', 'utility',
        'pgtap_aprovado', 'approved', 'pt_BR', 'Oi, {{nome}}, tudo certo?'),
       ('PGTAP-APROVADO-SEM-NOME', 'Aprovado sem nome na Meta (pgTAP)', 'whatsapp', 'utility',
        null, 'approved', 'pt_BR', 'Oi, {{nome}}.');


-- =====================================================================
-- 1. O BALDE DAS MÍDIAS
-- =====================================================================
-- Áudio recebido precisa ser baixado da Meta em ≤ 5 min (a URL dela
-- expira) e guardado em algum lugar. Não havia balde nenhum no projeto.
select is((select public from storage.buckets where id = 'mensagens'), false,
          'o balde das mídias recebidas é PRIVADO: balde público de áudio de conversa é vazamento por configuração');
select ok((select file_size_limit from storage.buckets where id = 'mensagens') >= 16777216,
          'e cabe o teto de 16 MB da Cloud API');


-- =====================================================================
-- 2. A ENTRADA DA META — uma transação, duas idempotências
-- =====================================================================
create table pg_temp.entrega1 as select public.wa_webhook_receber(
  'sha256-pgtap-entrega-1',
  '{"object":"whatsapp_business_account"}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('tipo','mensagem','chave','wamid.PONTE.1','wamid','wamid.PONTE.1'),
    jsonb_build_object('tipo','recibo','chave','status:wamid.PONTE.9:sent','wamid','wamid.PONTE.9'))
) as j;

select is((select j ->> 'duplicado' from pg_temp.entrega1), 'false', 'a primeira entrega da Meta é nova');
select is((select j ->> 'enfileirados' from pg_temp.entrega1), '2', 'e os dois itens foram enfileirados');
select is(pg_temp.delta('entrega', pg_temp.n_entrega()), 1,
          'a entrega crua ficou registrada em webhook_deliveries');
select is((select count(*)::int from pgmq.q_wa_inbound), 2, 'a fila wa_inbound tem os dois itens');

-- A reentrega da Meta (mesmo corpo → mesma assinatura → mesma delivery).
create table pg_temp.entrega2 as select public.wa_webhook_receber(
  'sha256-pgtap-entrega-1',
  '{"object":"whatsapp_business_account"}'::jsonb,
  jsonb_build_array(jsonb_build_object('tipo','mensagem','chave','wamid.PONTE.1','wamid','wamid.PONTE.1'))
) as j;
select is((select j ->> 'duplicado' from pg_temp.entrega2), 'true',
          'a REENTREGA da mesma delivery é reconhecida — a Meta reenvia quando não recebe 200 a tempo');
select is((select count(*)::int from pgmq.q_wa_inbound), 2,
          'e não enfileira nada de novo: a fila continua com dois itens');

-- Uma entrega DIFERENTE carregando um item já visto: a segunda trava.
create table pg_temp.entrega3 as select public.wa_webhook_receber(
  'sha256-pgtap-entrega-2',
  '{"object":"whatsapp_business_account"}'::jsonb,
  jsonb_build_array(jsonb_build_object('tipo','mensagem','chave','wamid.PONTE.1','wamid','wamid.PONTE.1'))
) as j;
select is((select j ->> 'enfileirados' from pg_temp.entrega3), '0',
          'entrega nova com item já visto não enfileira o item: a segunda idempotência é a da FILA (ingest_dedup)');
select is((select j ->> 'repetidos' from pg_temp.entrega3), '1', 'e ele é contado como repetido, não perdido');

select throws_ok($$ select public.wa_webhook_receber('  ', '{}'::jsonb, '[]'::jsonb) $$,
  '22023', NULL, 'entrega sem identificador não é idempotente e não entra');
select lives_ok($$ select public.wa_webhook_receber('sha256-pgtap-vazia', '{}'::jsonb, '[]'::jsonb) $$,
  'entrega sem itens (só account_update, por exemplo) é registrada e não quebra nada');


-- =====================================================================
-- 3. A MENSAGEM RECEBIDA — a casca que o worker alcança
-- =====================================================================
create table pg_temp.recebida1 as select public.wa_entrada_registrar(
  'wamid.PONTE.RECEBIDA.1', '+5584988887777', '+5584900000801',
  'text', 'Oi, vi sua ligação') as j;
select is((select j ->> 'novo' from pg_temp.recebida1), 'true', 'a mensagem recebida entra');
select is((select organization_id from public.conversations
            where id = (select (j ->> 'conversation_id')::uuid from pg_temp.recebida1)),
          pg_temp.org('01'),
          'e a conversa nasce já ligada à ficha dona daquele telefone');
select is((select assignee_id from public.conversations
            where id = (select (j ->> 'conversation_id')::uuid from pg_temp.recebida1)),
          pg_temp.gente('02'),
          'com dono: conversa sem dono é impossível (RF-CON-04)');

create table pg_temp.recebida2 as select public.wa_entrada_registrar(
  'wamid.PONTE.RECEBIDA.1', '+5584988887777', '+5584900000801',
  'text', 'Oi, vi sua ligação') as j;
select is((select j ->> 'novo' from pg_temp.recebida2), 'false',
          'a reentrega do mesmo wamid não cria uma segunda linha (RF-CON-03)');

-- Tipo que a Meta invente e o nosso enum não conheça: a mensagem NÃO se
-- perde por causa de uma coluna nossa.
select is(public.wa_entrada_registrar('wamid.PONTE.TIPO.NOVO', '+5584988887777', '+5584900000801',
                                      'coisa_que_a_meta_inventou', 'oi') ->> 'novo', 'true',
          'tipo desconhecido da Meta vira "system" e a mensagem entra — perder o que a pessoa escreveu por causa de um enum nosso seria pior');
select is((select type::text from public.messages where wa_message_id = 'wamid.PONTE.TIPO.NOVO'),
          'system', 'e fica marcada como system, para ser encontrada depois');


-- =====================================================================
-- 4. O RECIBO DA META — só anda para frente
-- =====================================================================
-- A conversa 03 responde agora, o que abre a janela de 24 h e deixa o
-- envio de texto livre passar pela porteira a qualquer hora do dia (é a
-- regra 2 de app.pode_enviar: responder a quem escreveu é livre).
create table pg_temp.conversa3 as select
  (public.wa_entrada_registrar('wamid.PONTE.ABRE.3', '+5584988887777', '+5584900000803',
                               'text', 'pode me explicar') ->> 'conversation_id')::uuid as id;

insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by)
select id, 'out', 'text', 'queued', 'Claro! Te explico em 20 minutos.', 'human', pg_temp.gente('02')
  from pg_temp.conversa3;
create table pg_temp.saida3 as
  select id from public.messages where conversation_id = (select id from pg_temp.conversa3)
     and direction = 'out' order by created_at desc limit 1;

-- Sem wamid ainda: o recibo só existe depois de a Meta aceitar o envio.
update public.messages set status = 'sent', wa_message_id = 'wamid.PONTE.SAIU.3', sent_at = now()
 where id = (select id from pg_temp.saida3);

select is(public.wa_status_registrar('wamid.PONTE.SAIU.3', 'read', now()) ->> 'motivo', 'atualizado',
          'o recibo de leitura é aplicado');
select is(public.wa_status_registrar('wamid.PONTE.SAIU.3', 'delivered', now()) ->> 'motivo',
          'estado_nao_retrocede',
          'e um delivered ATRASADO não apaga o read que já chegou: a Meta não garante ordem entre os webhooks');
select is((select status::text from public.messages where id = (select id from pg_temp.saida3)), 'read',
          'a linha continua em read');
select is(public.wa_status_registrar('wamid.PONTE.SAIU.3', 'failed', now(), '131049', 'limite') ->> 'motivo',
          'atualizado', 'failed vence tudo: mensagem devolvida com erro não foi entregue');
select is((select error_code from public.messages where id = (select id from pg_temp.saida3)), '131049',
          'e o código de erro da Meta fica na linha, para a tela dizer por quê');
select is(public.wa_status_registrar('wamid.NAO.EXISTE', 'sent', now()) ->> 'motivo',
          'mensagem_desconhecida',
          'recibo de mensagem ainda desconhecida não é erro: o eco do celular pode chegar depois dele');
select is(public.wa_status_registrar('wamid.PONTE.SAIU.3', 'inventado', now()) ->> 'motivo',
          'estado_desconhecido', 'e estado que a Meta não define não passa');


-- =====================================================================
-- 5. O ECO DO COEXISTENCE
-- =====================================================================
create table pg_temp.eco1 as select public.wa_eco_registrar(
  'wamid.PONTE.ECO.1', '+5584988887777', '+5584900000802',
  'text', 'Oi! Aqui é a Heloísa, da Komune.') as j;
select is((select j ->> 'novo' from pg_temp.eco1), 'true',
          'o eco do celular entra: é registro do que JÁ aconteceu, com o polegar de uma pessoa');
select is((select origin from public.messages where wa_message_id = 'wamid.PONTE.ECO.1'), 'echo',
          'com origem "echo", que é o que o distingue de um pedido de envio');
select is((select direction::text from public.messages where wa_message_id = 'wamid.PONTE.ECO.1'), 'out',
          'e sentido de saída: quem falou fomos nós');
select is((select j ->> 'novo' from
            (select public.wa_eco_registrar('wamid.PONTE.ECO.1', '+5584988887777', '+5584900000802',
                                            'text', 'Oi!') as j) x), 'false',
          'o eco também é idempotente pelo wamid');
select throws_ok($$ select public.wa_eco_registrar('', '+5584988887777', '+5584900000802') $$,
  '22023', NULL, 'eco sem wamid não é idempotente e não entra');


-- =====================================================================
-- 6. OPT-OUT — o guardrail do CLAUDE.md, com ficha e sem
-- =====================================================================
create table pg_temp.conversa_opt as select
  (public.wa_entrada_registrar('wamid.PONTE.OPTOUT.1', '+5584988887777', '+5584900000802',
                               'text', 'SAIR') ->> 'conversation_id')::uuid as id;

select ok(app.wa_motivo_de_recusa(pg_temp.org('02'), null, '+5584900000802') is null,
          'antes do pedido, a ficha 02 podia receber mensagem');

create table pg_temp.optout1 as
  select public.wa_optout_registrar((select id from pg_temp.conversa_opt),
                                    'Pedido por escrito no WhatsApp (regra "sair").') as j;

select is((select j ->> 'ok' from pg_temp.optout1), 'true', 'o opt-out é registrado');
select is(app.wa_motivo_de_recusa(pg_temp.org('02'), null, '+5584900000802'), 'contato_suprimido',
          'e a ficha passa a ser recusada IMEDIATAMENTE — do_not_contact e suppression_list, pelo caminho único da 001500');
select is((select count(*)::int from public.consent_events
            where kind = 'contact_optout' and organization_id = pg_temp.org('02')), 1,
          'com um evento de consentimento, que é a prova de LGPD');
select is((select j ->> 'confirmacao_enfileirada' from pg_temp.optout1), 'true',
          'e a confirmação de UMA linha (RF-CON-19) é enfileirada na mesma transação');
select is((select body from public.messages
            where id = (select (j ->> 'message_id')::uuid from pg_temp.optout1)),
          'Entendido. Não vou mais te mandar mensagem. Obrigada pelo retorno e sucesso nos eventos.',
          'com o texto FIXO do GEN-SYS-OPTOUT, sem o vocativo vazio de quem não tem nome no cadastro');
select is((select author_kind from public.messages
            where id = (select (j ->> 'message_id')::uuid from pg_temp.optout1)), 'system',
          'e nunca redigida por IA: confirmação de opt-out improvisada é a última coisa que alguém quer ver');
select ok((select bot_paused from public.conversations where id = (select id from pg_temp.conversa_opt)),
          'o robô cala nesse fio');

-- Chamar de novo não manda uma segunda confirmação.
select is(public.wa_optout_registrar((select id from pg_temp.conversa_opt), 'de novo')
            ->> 'confirmacao_enfileirada', 'false',
          'chamar duas vezes NÃO manda duas confirmações: quem garante é o índice único parcial de messages');
select is((select count(*)::int from public.messages
            where conversation_id = (select id from pg_temp.conversa_opt) and optout_confirmation), 1,
          'uma confirmação, e uma só');

-- O caso NOVO do WhatsApp: conversa de um número que o CRM não conhece.
create table pg_temp.conversa_sem_ficha as select
  (public.wa_entrada_registrar('wamid.PONTE.OPTOUT.2', '+5584988887777', '+5584911112222',
                               'text', 'nao quero receber mais nada') ->> 'conversation_id')::uuid as id;
select ok((select organization_id is null from public.conversations
            where id = (select id from pg_temp.conversa_sem_ficha)),
          'a conversa de um número desconhecido nasce SEM ficha — e é o caso que a ligação não tem');
select is(public.wa_optout_registrar((select id from pg_temp.conversa_sem_ficha), 'regra: nao quero')
            ->> 'motivo', 'numero_suprimido_sem_ficha',
          'sem ficha não há consent_events (ele exige um alvo), e o pedido não pode morrer em silêncio');
select ok(app.is_suppressed('+5584911112222', null, null),
          'então o NÚMERO entra na suppression_list — o mesmo hash que app.wa_motivo_de_recusa consulta');
select is(app.wa_motivo_de_recusa(null, null, '+5584911112222'), 'numero_suprimido',
          'e a porteira passa a recusá-lo: o guardrail vale com ficha ou sem');

select is(public.wa_optout_registrar('00000000-0000-4000-8000-000000000000', 'x') ->> 'motivo',
          'conversa_inexistente', 'opt-out de conversa que não existe devolve motivo, não exceção');


-- =====================================================================
-- 7. A REGRA DO R04 §2.1 — só template APROVADO PELA META sai fora da janela
-- =====================================================================
-- Medida na função que a decide, e não só no dreno: no dreno ela depende
-- da hora do relógio (a janela de horário do RF-CON-11), e regra que só
-- pode ser medida às 10h da manhã é regra que ninguém mede.
select is(app.wa_modelo_da_meta(null) ->> 'situacao', 'sem_modelo',
          'sem template não há como iniciar conversa fora da janela');
select is(app.wa_modelo_da_meta(999999) ->> 'situacao', 'modelo_inexistente',
          'template apagado depois de a mensagem ser enfileirada também não sai');
select is(app.wa_modelo_da_meta((select id from public.message_templates where template_code = 'AEB-ABR-A'))
            ->> 'situacao', 'pending',
          'modelo NOSSO com aprovação PENDENTE na Meta não está aprovado — é a confusão que gera 132001');
select is(app.wa_modelo_da_meta((select id from public.message_templates where template_code = 'GEN-FUP-LIG-V1'))
            ->> 'situacao', 'nao_enviado_a_meta',
          'e modelo que nunca foi enviado à Meta diz isso por escrito, em vez de "null"');
select is(app.wa_modelo_da_meta((select id from public.message_templates where template_code = 'PGTAP-APROVADO-SEM-NOME'))
            ->> 'situacao', 'aprovado_sem_nome_na_meta',
          'aprovado sem o nome do template na Meta ainda não dá para enviar: é o nome deles que vai no POST');
select is(app.wa_modelo_da_meta((select id from public.message_templates where template_code = 'PGTAP-APROVADO'))
            ->> 'aprovado', 'true', 'e só o aprovado COM nome na Meta passa');
select is(app.wa_modelo_da_meta((select id from public.message_templates where template_code = 'PGTAP-APROVADO'))
            ->> 'nome_meta', 'pgtap_aprovado',
          'o que o worker manda no POST é o nome DELES, não o código nosso');

select is((select count(*)::int from public.message_templates
            where meta_status = 'approved' and template_code not like 'PGTAP-%'), 0,
          'e hoje, de fato, NENHUM modelo semeado está aprovado pela Meta: sem isto, toda mensagem fora da janela morreria na Graph API');


-- =====================================================================
-- 8. O DRENO DA SAÍDA
-- =====================================================================
-- A mensagem da conversa 03 (janela de 24 h aberta) é enfileirada e sai.
-- Uma mensagem em `queued` criada AQUI, para a asserção não depender de o
-- banco de desenvolvimento ter sobras: a conversa 03 está com a janela de
-- 24 h aberta, então responder passa pela porteira a qualquer hora do dia.
insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by)
select id, 'out', 'text', 'queued', 'Te mando o link do cadastro agora.', 'human', pg_temp.gente('02')
  from pg_temp.conversa3;

create table pg_temp.varredura as select public.wa_saida_enfileirar_pendentes(200) as j;
select is(((select (j ->> 'enfileirados')::int + (j ->> 'ja_estavam')::int from pg_temp.varredura)),
          (select count(*)::int from public.messages where status = 'queued' and direction = 'out'),
          'a varredura cobre TODA mensagem em queued — app.wa_enfileirar_envio não tinha quem a chamasse');
select ok((select (j ->> 'enfileirados')::int from pg_temp.varredura) >= 1,
          'e ela de fato enfileirou o que ainda não estava na fila');
select is(public.wa_saida_enfileirar_pendentes(200) ->> 'enfileirados', '0',
          'chamar de novo não duplica nada: a chave de idempotência é o id da mensagem');

create table pg_temp.lote as select public.wa_saida_proximos(20) as j;
select ok((select jsonb_array_length(j -> 'itens') from pg_temp.lote) >= 1,
          'o dreno devolve a mensagem que está dentro da janela de 24 h');
select ok((select bool_and((i ->> 'janela_aberta')::boolean)
             from pg_temp.lote, jsonb_array_elements(j -> 'itens') i),
          'marcada como janela aberta: é texto livre, gratuito, e não precisa de template');

-- A confirmação de opt-out enfileirada na seção 6 é a única mensagem que
-- atravessa a supressão — e ela precisa continuar saindo.
select ok((select count(*)::int from pgmq.q_wa_outbound) >= 1,
          'a confirmação do opt-out está na fila de saída: é a única mensagem que sai para quem está suprimido (RF-CON-19)');


-- =====================================================================
-- 9. A FALHA DEFINITIVA — sem backoff
-- =====================================================================
create table pg_temp.morrer as
  select (i ->> 'message_id')::uuid as mid, (i ->> 'msg_id')::bigint as qid
    from pg_temp.lote, jsonb_array_elements(j -> 'itens') i limit 1;

select is(public.wa_saida_falha_definitiva((select qid from pg_temp.morrer),
                                           (select mid from pg_temp.morrer),
                                           'Receiver is incapable of receiving this message', '131026')
            ->> 'acao', 'encerrado',
          'erro que não melhora com repetição encerra a mensagem de uma vez');
select is((select status::text from public.messages where id = (select mid from pg_temp.morrer)), 'failed',
          'a mensagem fica failed');
select is((select error_code from public.messages where id = (select mid from pg_temp.morrer)), '131026',
          'com o código da Meta na linha, que é o que a tela lê');
select is((select count(*)::int from pgmq.q_wa_outbound
            where msg_id = (select qid from pg_temp.morrer)), 0,
          'e fora da fila: insistir quatro vezes num "este número não tem WhatsApp" não muda o resultado');


-- =====================================================================
-- 10. NADA DISSO É PARA A TELA
-- =====================================================================
select pg_temp.entrar(pg_temp.gente('01'), 'admin');
select throws_ok($$ select public.wa_webhook_receber('x', '{}'::jsonb, '[]'::jsonb) $$,
  '42501', NULL, 'nem o admin recebe webhook da Meta: quem faz isso é a Edge Function com a chave de serviço');
select throws_ok($$ select public.wa_entrada_registrar('x', '+5584988887777', '+5584900000801') $$,
  '42501', NULL, 'nem o admin registra mensagem recebida à mão');
select throws_ok($$ select public.wa_optout_registrar('00000000-0000-4000-8000-000000000000', 'x') $$,
  '42501', NULL, 'nem o admin suprime por esta porta: a porta da tela é public.marcar_nao_ligar_mais, que exige sessão');
select throws_ok($$ select public.wa_saida_proximos(1) $$,
  '42501', NULL, 'e ninguém drena a fila de envio pelo navegador');
select pg_temp.sair();

select is((select count(*)::int from information_schema.role_routine_grants
            where grantee in ('anon', 'authenticated')
              and specific_schema = 'public'
              and routine_name in ('wa_webhook_receber', 'wa_entrada_registrar', 'wa_status_registrar',
                                   'wa_eco_registrar', 'wa_optout_registrar', 'wa_midia_registrar',
                                   'wa_saida_enfileirar_pendentes', 'wa_saida_proximos',
                                   'wa_saida_sucesso', 'wa_saida_falha', 'wa_saida_falha_definitiva',
                                   'ia_fila_enfileirar')), 0,
          'nenhuma das doze funções da ponte é executável por anon ou authenticated');
select is((select count(*)::int from information_schema.role_routine_grants
            where grantee = 'service_role'
              and specific_schema = 'public'
              and routine_name in ('wa_webhook_receber', 'wa_entrada_registrar', 'wa_status_registrar',
                                   'wa_eco_registrar', 'wa_optout_registrar', 'wa_midia_registrar',
                                   'wa_saida_enfileirar_pendentes', 'wa_saida_proximos',
                                   'wa_saida_sucesso', 'wa_saida_falha', 'wa_saida_falha_definitiva',
                                   'ia_fila_enfileirar')), 12,
          'e as doze são executáveis pelo service_role, que é o worker e a Edge Function');


-- =====================================================================
-- 11. O MOTIVO EM PORTUGUÊS — o que a tela mostra
-- =====================================================================
select matches(app.wa_motivo_legivel('sem_janela_e_sem_template', null), 'template',
               'a espera por falta de template vira frase, não código');
select matches(app.wa_motivo_legivel('teto_do_numero',
                 (timestamp '2026-09-08 09:00') at time zone 'America/Fortaleza'),
               '08/09 09:00',
               'e quando existe uma próxima hora, ela aparece em America/Fortaleza');

select * from finish();
rollback;

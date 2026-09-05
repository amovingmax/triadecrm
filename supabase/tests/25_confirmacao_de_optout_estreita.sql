-- =====================================================================
-- TRIADE — pgTAP — 20260905000300: a confirmação de opt-out estreita
--
-- A migração 20260905000200 deu à confirmação do RF-CON-19 uma exceção
-- DECLARADA: um booleano que quem insere escrevia e que fazia
-- `app.messages_guard` sair da função antes de qualquer checagem. Abaixo
-- daquele `return` ficavam o human-in-the-loop do ADR-05, a supressão, a
-- janela de 24 h, a janela de horário, domingo, feriado e os tetos.
--
-- A conferência adversarial provou o furo com o worker de verdade: o
-- MESMO texto livre, para o MESMO número suprimido, sem a flag dava
-- "Envio recusado: contato_suprimido"; COM a flag entrava, saía pela fila
-- e a Graph API o recebia.
--
-- Este arquivo é a prova do conserto, e ele tem de valer nos DOIS
-- sentidos — fechar tudo não seria conserto nenhum:
--
--   1. O ATAQUE, LETRA POR LETRA. Mesmo texto, com a flag, para
--      suprimido: RECUSADO, e com o motivo tendo nome próprio.
--   2. A LEGÍTIMA SAI. Quem pediu para sair recebe a confirmação — com a
--      supressão ligada e a janela de 24 h fechada, que são as duas
--      únicas coisas que a exceção dispensa.
--   3. O CORPO É O TEXTO FIXO do GEN-SYS-OPTOUT, montado pelo banco, com
--      o {{nome}} vindo de `contacts` — uma COLUNA, nunca o corpo que
--      veio no insert. Qualquer outro texto é recusado.
--   4. UMA VEZ SÓ, e a segunda tentativa é recusada com motivo nomeado
--      (`confirmacao_ja_enviada`) antes de o índice único precisar
--      trabalhar — o índice fica, para a corrida de duas transações.
--   5. AS NÃO-DISPENSAS. Domingo, feriado, fora de hora e teto continuam
--      valendo para a confirmação. E "não pode agora" nunca vira morte:
--      o dreno adia.
--
-- Datas fixas, para o teste não depender da hora em que roda:
--   2026-09-16 (quarta, dia útil) · 2026-09-13 (domingo) · 2026-09-07
--   (feriado da Independência, que está na tabela `holidays`).
-- Onde o `now()` é inevitável (dreno e UPDATE), a transação abre uma
-- janela 24/7 para o canal e a fecha em seguida.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(54);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
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
  select ('f0000000-0000-4000-8000-0000000f90' || p_n)::uuid $$;
create function pg_temp.gente(p_n text) returns uuid language sql as $$
  select ('a0000000-0000-4000-8000-0000000a90' || p_n)::uuid $$;
create function pg_temp.n_msg() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.messages $$;

delete from pgmq.q_wa_inbound;
delete from pgmq.q_wa_outbound;

-- ---------- gente ----------
insert into public.allowed_users (email, role, note) values
  ('estreita.admin@teste.local', 'admin', 'pgTAP confirmacao de optout estreita');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gente('01'), 'estreita.admin@teste.local', '{"full_name":"Admin Estreita"}');

-- ---------- fichas ----------
insert into public.organizations (id, kind, name, phone_e164, source_id, collector, source_url, owner_id)
select v.id, 'fornecedor', v.nome, v.fone,
       (select id from public.sources order by id limit 1), 'pgtap',
       'https://exemplo.invalido/estreita', pg_temp.gente('01')
  from (values
    (pg_temp.org('01'), 'ESTREITA — O ALVO DO ATAQUE', '+5584900000911'),
    (pg_temp.org('02'), 'ESTREITA — A FICHA LIMPA',    '+5584900000912'),
    (pg_temp.org('03'), 'ESTREITA — SEM PESSOA',       '+5584900000913'),
    (pg_temp.org('04'), 'ESTREITA — A ENTREGA',        '+5584900000914')
  ) as v(id, nome, fone);
insert into public.contacts (id, full_name, first_name, phone_e164)
values (pg_temp.gente('11'), 'Marcos do Ataque', 'Marcos', '+5584900000911');
insert into public.organization_contacts (organization_id, contact_id, is_primary)
values (pg_temp.org('01'), pg_temp.gente('11'), true);

-- ---------- as conversas, criadas pelo caminho de verdade ----------
select public.wa_entrada_registrar('wamid.ESTREITA.A', '+5584988887777', '+5584900000911',
                                  'text', 'oi, quero saber mais');
select public.wa_entrada_registrar('wamid.ESTREITA.B', '+5584988887777', '+5584900000912',
                                  'text', 'boa tarde');
select public.wa_entrada_registrar('wamid.ESTREITA.C', '+5584988887777', '+5584900000913',
                                  'text', 'opa');
select public.wa_entrada_registrar('wamid.ESTREITA.D', '+5584988887777', '+5584900000914',
                                  'text', 'e ai');
-- `security definer` porque metade das asserções roda como `authenticated`,
-- e a tela não enxerga a conversa pelo telefone — o teste enxerga.
create function pg_temp.fio(p_fone text) returns uuid
  language sql security definer set search_path = '' as $$
  select id from public.conversations where peer_phone_e164 = p_fone limit 1 $$;
create function pg_temp.a() returns uuid language sql as $$ select pg_temp.fio('+5584900000911') $$;
create function pg_temp.b() returns uuid language sql as $$ select pg_temp.fio('+5584900000912') $$;
create function pg_temp.c() returns uuid language sql as $$ select pg_temp.fio('+5584900000913') $$;
create function pg_temp.d() returns uuid language sql as $$ select pg_temp.fio('+5584900000914') $$;
create function pg_temp.tpl() returns int language sql security definer set search_path = '' as $$
  select id from public.message_templates where template_code = 'GEN-SYS-OPTOUT' $$;

-- O texto do ataque, escrito uma vez só para que "o MESMO texto" seja
-- literalmente o mesmo nas três tentativas.
create function pg_temp.texto() returns text language sql immutable as $$
  select 'CONFERENTE: texto livre, nenhuma pessoa aprovou, e o numero esta suprimido.'::text $$;


-- =====================================================================
-- 1. ANTES DO PEDIDO — nada é devido, e a flag já não é de quem insere
-- =====================================================================
select is(app.wa_confirmacao_de_optout(pg_temp.a()) ->> 'motivo', 'sem_pedido_de_optout',
          'sem ninguém ter pedido para sair, o banco não deve confirmação nenhuma');
select is(app.wa_confirmacao_de_optout(pg_temp.a()) ->> 'devida', 'false',
          'e "devida" é falso: a pergunta é de ESTADO, não de quem chama');

select pg_temp.entrar(pg_temp.gente('01'), 'admin');
-- A mensagem legítima da tela, para a ficha ainda limpa. Fica em `queued`
-- e volta a aparecer na seção 7 (a reconferência da entrega).
insert into public.messages (id, conversation_id, direction, type, status, body,
                             author_kind, sent_by, origin)
values ('e1000000-0000-4000-8000-0000000e0001', pg_temp.a(), 'out', 'text', 'queued',
        'Oi, Marcos! Posso te mandar o link do cadastro?', 'human', pg_temp.gente('01'), 'crm');
select pass('a mensagem humana legítima entra — fechar tudo não seria conserto');
select is((select optout_confirmation from public.messages
            where id = 'e1000000-0000-4000-8000-0000000e0001'), false,
          'e nasce com optout_confirmation FALSA, derivada pelo banco');

select throws_ok($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, sent_by, origin, optout_confirmation)
  values (pg_temp.a(), 'out', 'text', 'queued', pg_temp.texto(),
          'human', pg_temp.gente('01'), 'crm', true) $$,
  '42501', NULL,
  'declarar optout_confirmation sem pedido de opt-out nenhum já é recusado');
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, sent_by, origin, optout_confirmation)
  values (pg_temp.a(), 'out', 'text', 'queued', pg_temp.texto(),
          'human', pg_temp.gente('01'), 'crm', true) $$,
  '%sem_pedido_de_optout%',
  'e o motivo tem nome próprio, que é o que a tela lê');
select pg_temp.sair();


-- =====================================================================
-- 2. O ATAQUE DA CONFERÊNCIA, LETRA POR LETRA
-- =====================================================================
-- O estado que o ataque precisava: a pessoa está suprimida e a
-- confirmação ainda não saiu. É a janela exata em que a exceção larga
-- valia — e é onde ela tem de valer, para quem tem direito a ela.
select app.suppress('phone', '+5584900000911', 'contact_optout', 'whatsapp'::app.channel, null);
select is(app.wa_motivo_de_recusa(pg_temp.org('01'), null, '+5584900000911'), 'contato_suprimido',
          'a ficha 01 está suprimida: a porteira comum a recusa');
select is(app.wa_confirmacao_de_optout(pg_temp.a()) ->> 'devida', 'true',
          'e AGORA a confirmação é devida — o estado mudou, não o insert');

create table pg_temp.antes as select pg_temp.n_msg() as n;

select pg_temp.entrar(pg_temp.gente('01'), 'admin');
-- CONTROLE (o "controle 3" da conferência): o mesmo texto, humano, SEM a
-- flag. Já era recusado antes do conserto, e continua sendo.
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, sent_by, origin)
  values (pg_temp.a(), 'out', 'text', 'queued', pg_temp.texto(),
          'human', pg_temp.gente('01'), 'crm') $$,
  '%contato_suprimido%',
  'CONTROLE: o mesmo texto, sem a flag, é recusado — contato_suprimido');

-- O ATAQUE: o MESMO texto, COM a flag. Antes: INSERT 0 1, e a Meta o
-- recebia. Agora: recusado, e pelo motivo certo.
select throws_ok($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, sent_by, origin, optout_confirmation)
  values (pg_temp.a(), 'out', 'text', 'queued', pg_temp.texto(),
          'human', pg_temp.gente('01'), 'crm', true) $$,
  '42501', NULL,
  'O ATAQUE: o MESMO texto, COM optout_confirmation = true, é RECUSADO');
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, sent_by, origin, optout_confirmation)
  values (pg_temp.a(), 'out', 'text', 'queued', pg_temp.texto(),
          'human', pg_temp.gente('01'), 'crm', true) $$,
  '%confirmacao_nao_e_de_pessoa%',
  'e o motivo diz o que houve: confirmação de opt-out não é mensagem de pessoa');

-- A mesma tentativa vestida de robô de texto fixo, com o modelo CERTO.
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, sent_by, origin, template_id, optout_confirmation)
  values (pg_temp.a(), 'out', 'text', 'queued', pg_temp.texto(),
          'bot_fixed', pg_temp.gente('01'), 'crm', pg_temp.tpl(), true) $$,
  '%confirmacao_nao_e_de_pessoa%',
  'vestir o ataque de bot_fixed com o modelo certo não muda nada: quem confirma é o sistema');
select pg_temp.sair();

select is(pg_temp.n_msg(), (select n from pg_temp.antes),
          'e NENHUMA linha entrou: quatro tentativas, quatro recusas');

-- A mesma tentativa com a CHAVE DE SERVIÇO, que é o que o worker tem.
-- Aqui a policy não protege ninguém (service_role a atravessa): quem
-- protege é o gatilho, e é por isso que a regra mora nele.
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, origin, template_id, optout_confirmation)
  values (pg_temp.a(), 'out', 'text', 'queued', pg_temp.texto(),
          'system', 'crm', pg_temp.tpl(), true) $$,
  '%texto_diferente_do_modelo_fixo%',
  'com a chave de serviço e a forma toda certa, o TEXTO ainda barra: confirmação não é texto livre');
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, origin, optout_confirmation)
  values (pg_temp.a(), 'out', 'text', 'queued',
          'Entendido, Marcos. Não vou mais te mandar mensagem. Obrigada pelo retorno e sucesso nos eventos.',
          'system', 'crm', true) $$,
  '%modelo_nao_e_o_gen_sys_optout%',
  'e o texto certo sem o modelo também barra: a confirmação é o GEN-SYS-OPTOUT, não uma imitação dele');
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, origin, template_id, optout_confirmation)
  values (pg_temp.a(), 'out', 'text', 'queued', pg_temp.texto(),
          'bot_ai', 'crm', pg_temp.tpl(), true) $$,
  '%confirmacao_nao_e_de_pessoa%',
  'e a IA nunca redige a confirmação: improvisar a despedida é a última coisa que alguém quer ver');


-- =====================================================================
-- 3. A LEGÍTIMA SAI — e é só isso que a exceção existe para permitir
-- =====================================================================
create table pg_temp.opt1 as
  select public.wa_optout_registrar(pg_temp.a(), 'Pediu por escrito no WhatsApp (regra "sair").') as j;
select is((select j ->> 'confirmacao_enfileirada' from pg_temp.opt1), 'true',
          'A CONFIRMAÇÃO LEGÍTIMA SAI: quem pediu para sair recebe a linha que o RF-CON-19 promete');
create function pg_temp.msg1() returns uuid language sql as $$
  select (j ->> 'message_id')::uuid from pg_temp.opt1 $$;
select is((select body from public.messages where id = pg_temp.msg1()),
          'Entendido, Marcos. Não vou mais te mandar mensagem. Obrigada pelo retorno e sucesso nos eventos.',
          'com o texto FIXO do GEN-SYS-OPTOUT e o nome vindo de contacts — uma COLUNA, não o corpo do insert');
select is((select author_kind from public.messages where id = pg_temp.msg1()), 'system',
          'escrita pelo sistema');
select ok((select optout_confirmation from public.messages where id = pg_temp.msg1()),
          'e a coluna optout_confirmation ficou VERDADEIRA sem ninguém a declarar: o banco a derivou do estado');
select is((select template_id from public.messages where id = pg_temp.msg1()), pg_temp.tpl(),
          'apontando para o GEN-SYS-OPTOUT');
select is((select is_first_contact from public.messages where id = pg_temp.msg1()), false,
          'e nunca como primeiro contato — o teto do RF-CON-10 não é dispensado, ele simplesmente não a alcança');


-- =====================================================================
-- 4. UMA VEZ SÓ — agora por estado, com o índice como segunda fechadura
-- =====================================================================
select is(public.wa_optout_registrar(pg_temp.a(), 'de novo') ->> 'confirmacao_enfileirada', 'false',
          'chamar duas vezes NÃO manda duas confirmações');
select is(public.wa_optout_registrar(pg_temp.a(), 'de novo') ->> 'confirmacao_motivo',
          'confirmacao_ja_enviada',
          'e o motivo tem nome: a segunda é recusada por ESTADO, antes de o índice único precisar trabalhar');
select is(app.wa_confirmacao_de_optout(pg_temp.a()) ->> 'motivo', 'confirmacao_ja_enviada',
          'a própria pergunta já responde "já foi"');
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, origin, template_id, optout_confirmation)
  values (pg_temp.a(), 'out', 'text', 'queued',
          'Entendido, Marcos. Não vou mais te mandar mensagem. Obrigada pelo retorno e sucesso nos eventos.',
          'system', 'crm', pg_temp.tpl(), true) $$,
  '%confirmacao_ja_enviada%',
  'e a segunda confirmação inserida à mão, com a forma toda certa, é recusada com o motivo nomeado');
select is((select count(*)::int from public.messages
            where conversation_id = pg_temp.a() and optout_confirmation), 1,
          'uma confirmação, e uma só');


-- =====================================================================
-- 5. O CORPO É O TEXTO FIXO — e a variável vem de coluna
-- =====================================================================
-- A conversa C não tem pessoa no cadastro. Sem nome, o texto perde o
-- vocativo (e a vírgula junto) — e quem faz isso é o banco, não quem
-- insere. É a prova de que {{nome}} nunca veio do corpo do insert.
select app.suppress('phone', '+5584900000913', 'contact_optout', 'whatsapp'::app.channel, null);
select is(app.wa_confirmacao_de_optout(pg_temp.c()) ->> 'corpo',
          'Entendido. Não vou mais te mandar mensagem. Obrigada pelo retorno e sucesso nos eventos.',
          'sem pessoa no cadastro o vocativo vazio some, e é o banco que monta o texto');
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, origin, template_id, optout_confirmation)
  values (pg_temp.c(), 'out', 'text', 'queued', 'Tá bom, tchau.',
          'system', 'crm', pg_temp.tpl(), true) $$,
  '%texto_diferente_do_modelo_fixo%',
  'qualquer outro texto é recusado, mesmo com o estado devendo a confirmação');

-- E com o corpo NULO o banco preenche: quem insere não precisa saber o
-- texto, e por isso não pode escolhê-lo.
insert into public.messages (id, conversation_id, direction, type, status,
                             author_kind, origin, template_id, optout_confirmation)
values ('e1000000-0000-4000-8000-0000000e0003', pg_temp.c(), 'out', 'text', 'queued',
        'system', 'crm', pg_temp.tpl(), true);
select is((select body from public.messages where id = 'e1000000-0000-4000-8000-0000000e0003'),
          'Entendido. Não vou mais te mandar mensagem. Obrigada pelo retorno e sucesso nos eventos.',
          'com o corpo nulo o banco escreve o texto fixo: não há como mandar outro');


-- =====================================================================
-- 6. AS DISPENSAS, ITEM A ITEM (é a lista, e não há mais nada nela)
-- =====================================================================
-- Quarta-feira 16/09/2026, 10h de Fortaleza: dia útil, dentro da janela.
select is(app.pode_enviar(pg_temp.a(), false, true, '2026-09-16 10:00-03'::timestamptz) ->> 'motivo',
          'contato_suprimido',
          'no mesmo instante, a porteira COMUM recusa a conversa suprimida');
select is(app.pode_enviar_confirmacao_optout(pg_temp.a(), '2026-09-16 10:00-03'::timestamptz) ->> 'pode',
          'true',
          'DISPENSA 1 — a supressão: a confirmação atravessa a supressão que ela mesma criou');

-- DISPENSA 2 — a janela de 24 h. A conversa C não recebe mensagem desde
-- que nasceu; empurrando a última entrada para 3 dias atrás, a janela
-- fecha e a confirmação continua podendo.
update public.conversations set last_inbound_at = now() - interval '3 days',
       last_message_at = now() - interval '3 days' where id = pg_temp.c();
select ok(not app.janela_de_24h_aberta(pg_temp.c(), '2026-09-16 10:00-03'::timestamptz),
          'a janela de 24 h da conversa C está fechada');
select is(app.pode_enviar_confirmacao_optout(pg_temp.c(), '2026-09-16 10:00-03'::timestamptz) ->> 'pode',
          'true',
          'DISPENSA 2 — a janela de 24 h: o opt-out pode ter vindo de uma ligação, dias depois da última mensagem');

-- NÃO DISPENSA: domingo, feriado e fora de hora.
select is(app.pode_enviar_confirmacao_optout(pg_temp.a(), '2026-09-13 10:00-03'::timestamptz) ->> 'motivo',
          'janela_domingo',
          'NÃO DISPENSA domingo: confirmação de opt-out no domingo não é respeito, é mais uma mensagem fora de hora');
select is(app.pode_enviar_confirmacao_optout(pg_temp.a(), '2026-09-07 10:00-03'::timestamptz) ->> 'motivo',
          'janela_feriado',
          'NÃO DISPENSA feriado');
select is(app.pode_enviar_confirmacao_optout(pg_temp.a(), '2026-09-16 03:00-03'::timestamptz) ->> 'motivo',
          'janela_antes_da_abertura',
          'NÃO DISPENSA a janela de horário do RF-CON-11: às 3h da manhã ela espera');
select ok((app.pode_enviar_confirmacao_optout(pg_temp.a(), '2026-09-13 10:00-03'::timestamptz)
             ->> 'quando') is not null,
          'e a recusa diz QUANDO abre: é "agora não", nunca "nunca mais" — por isso o dreno adia em vez de matar');

-- NÃO DISPENSA: os tetos de volume do RF-CON-10.
update public.app_settings set value = jsonb_set(value, '{teto_iniciadas_hora}', '0'::jsonb)
 where key = 'whatsapp.envio';
select is(app.pode_enviar_confirmacao_optout(pg_temp.a(), '2026-09-16 10:00-03'::timestamptz) ->> 'motivo',
          'teto_iniciadas_hora',
          'NÃO DISPENSA o teto de volume: o teto protege o número, e o número não distingue confirmação de convite');
select is(app.pode_enviar_confirmacao_optout(pg_temp.a(), '2026-09-16 10:00-03'::timestamptz, false) ->> 'pode',
          'true',
          'só a reconferência do UPDATE o dispensa, e por aritmética: ali a própria linha já está contada');
update public.app_settings set value = jsonb_set(value, '{teto_iniciadas_hora}', '60'::jsonb)
 where key = 'whatsapp.envio';


-- =====================================================================
-- 7. A ENTREGA E O DRENO — a isenção larga sumiu dos dois
-- =====================================================================
-- Daqui para baixo o `now()` é inevitável: o UPDATE acontece agora e o
-- dreno lê a fila agora. E a janela do canal NÃO pode ser aberta para o
-- teste — `channel_windows_teto_legal` proíbe domingo e limita as faixas
-- (é teto legal, e um teste não é motivo para furá-lo).
--
-- Então o que se mede aqui é o que NÃO depende da hora, que é exatamente
-- a afirmação em jogo: a confirmação deixou de morrer de supressão, e o
-- máximo que a hora pode fazer com ela é ADIÁ-LA. Que ela respeita a
-- hora já está provado na seção 6, com datas fixas.
create function pg_temp.tentar_entregar(p_id uuid) returns text language plpgsql as $$
begin
  update public.messages set status = 'sent'::app.msg_status,
         wa_message_id = 'wamid.ESTREITA.' || left(p_id::text, 8)
   where id = p_id;
  return 'entregue';
exception when others then
  return sqlerrm;
end $$;

-- A conversa D existe só para isto: uma confirmação legítima e intocada,
-- para a transição queued → sent ser medida sem atrapalhar as outras.
select app.suppress('phone', '+5584900000914', 'contact_optout', 'whatsapp'::app.channel, null);
create table pg_temp.entrega as
select public.wa_optout_registrar(pg_temp.d(), 'regra: sair') ->> 'message_id' as conf_id;
create function pg_temp.confd() returns uuid language sql as $$
  select conf_id::uuid from pg_temp.entrega $$;

-- A RECONFERÊNCIA DO UPDATE. Antes do dreno, porque o dreno mata a
-- mensagem comum e depois já não haveria o que reconferir.
create table pg_temp.resultado as
select pg_temp.tentar_entregar(pg_temp.confd()) as conf,
       pg_temp.tentar_entregar('e1000000-0000-4000-8000-0000000e0001'::uuid) as comum;

select ok((select conf from pg_temp.resultado) not like '%suprimido%',
          'na entrega, a confirmação NÃO morre de supressão: é para isso que a exceção existe');
select ok((select conf from pg_temp.resultado) = 'entregue'
          or (select conf from pg_temp.resultado) like '%janela_%',
          'e se não sai agora é só pela janela de horário — a única coisa que ainda a segura');
select alike((select comum from pg_temp.resultado), '%contato_suprimido%',
             'enquanto a mensagem comum da MESMA conversa não atravessa: a regra vale na entrega');
select throws_ok($$ update public.messages set optout_confirmation = true
                     where id = 'e1000000-0000-4000-8000-0000000e0001' $$,
  '42501', NULL,
  'e ninguém liga a flag no UPDATE: sem isso, bastava um segundo comando para queimar o índice único da conversa');

-- O DRENO. Uma mensagem COMUM para a ficha 02, enfileirada ANTES de ela
-- pedir para sair: é a lição do dreno, aprovado às 9h não é permissão
-- para as 9h40.
select pg_temp.entrar(pg_temp.gente('01'), 'admin');
insert into public.messages (id, conversation_id, direction, type, status, body,
                             author_kind, sent_by, origin)
values ('e1000000-0000-4000-8000-0000000e0002', pg_temp.b(), 'out', 'text', 'queued',
        'Oi! Posso te mandar o link do cadastro?', 'human', pg_temp.gente('01'), 'crm');
select pg_temp.sair();
select app.suppress('phone', '+5584900000912', 'contact_optout', 'whatsapp'::app.channel, null);

select ok((public.wa_saida_enfileirar_pendentes(200) ->> 'enfileirados')::int >= 2,
          'a confirmação e a mensagem comum vão as duas para wa_outbound');

create table pg_temp.dreno as select app.wa_proximos(50) as j;
create function pg_temp.no_dreno(p_id uuid) returns text language sql as $$
  select coalesce((select r ->> 'acao'
                     from jsonb_array_elements((select j from pg_temp.dreno) -> 'recusados') r
                    where (r ->> 'message_id')::uuid = p_id),
                  (select 'entregue'
                     from jsonb_array_elements((select j from pg_temp.dreno) -> 'itens') i
                    where (i ->> 'message_id')::uuid = p_id)) $$;

select isnt(pg_temp.no_dreno(pg_temp.msg1()), 'morto',
            'O DRENO NÃO MATA A CONFIRMAÇÃO: a supressão que ela confirma deixou de ser motivo de morte');
select ok(pg_temp.no_dreno(pg_temp.msg1()) in ('entregue', 'adiado'),
          'ela é entregue, ou adiada até a janela abrir — as duas coisas que "agora não" pode significar');
select is((select r ->> 'motivo' from jsonb_array_elements((select j from pg_temp.dreno) -> 'recusados') r
            where (r ->> 'message_id')::uuid = 'e1000000-0000-4000-8000-0000000e0002'),
          'contato_suprimido',
          'enquanto a mensagem COMUM da mesma fila morre no dreno: o guardrail continua inteiro');
select is(pg_temp.no_dreno('e1000000-0000-4000-8000-0000000e0002'), 'morto',
          'e morre, não adia — supressão é "nunca mais"');


-- =====================================================================
-- 8. E ELA NÃO PODE EXPIRAR POR ESPERAR A SEGUNDA-FEIRA
-- =====================================================================
-- Consequência direta de respeitar domingo e feriado: um "SAIR" no sábado
-- à noite espera a janela de segunda. Com o prazo único de 12 h a
-- confirmação morreria calada — e quem pediu para sair nunca saberia.
update public.messages set created_at = now() - interval '20 hours'
 where id = 'e1000000-0000-4000-8000-0000000e0003';
select ok((app.wa_expirar_fila(12, 96) ->> 'expiradas')::int >= 0,
          'a faxina da fila roda com os dois prazos');
select is((select status::text from public.messages where id = 'e1000000-0000-4000-8000-0000000e0003'),
          'queued',
          'a confirmação parada há 20 h SOBREVIVE ao prazo de 12 h das mensagens comuns');
select is((app.wa_expirar_fila(12, 1) ->> 'confirmacoes_expiradas')::int, 1,
          'mas o prazo dela existe: com 1 h, ela expira — e o error_detail diz que foi a janela de horário');
select is((select error_code from public.messages where id = 'e1000000-0000-4000-8000-0000000e0003'),
          'expirou_na_fila', 'com o motivo por escrito na linha');


-- =====================================================================
-- 9. A POLICY DIZ, POR ESCRITO, QUE A TELA NÃO ESCREVE ESSA COLUNA
-- =====================================================================
select ok(pg_get_expr(polwithcheck, polrelid) like '%optout_confirmation%',
          'a policy messages_insert menciona optout_confirmation — a coluna que abriu o furo não era mencionada nela')
  from pg_policy where polname = 'messages_insert';

select * from finish();
rollback;

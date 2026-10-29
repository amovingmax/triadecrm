-- =====================================================================
-- pgTAP — O WhatsApp inteiro dentro do CRM (migrações 20261027100000 e
-- 20261027110000)
--
-- Pedido de 27/10/2026: "quero todas as funcionalidades do wpp no nosso CRM,
-- criar grupo, apagar mensagem e etc". Este arquivo prova:
--
--   1. REAGIR: a reação aponta para a mensagem e passa pela porteira (fora da
--      janela de 24 h não sai);
--   2. APAGAR: o que está na fila é cancelado de verdade; o que já saiu some
--      só do CRM; e, se a Meta mandou mesmo assim, o registro diz que saiu;
--   3. CORRIGIR: sai uma mensagem nova, assinada, respondendo à errada;
--   4. A FORMA: localização sem latitude, quatro botões e documento sem
--      arquivo morrem no banco, com a frase certa;
--   5. BLOQUEAR: vale na hora no CRM, cancela a fila e pede à Meta; se a Meta
--      recusar, a conversa diz por quê;
--   6. LIDA E DIGITANDO: viram pedido ao worker, uma vez só;
--   7. O QUE CHEGA: resposta citada, reação e localização ficam ligadas à
--      mensagem certa; o contato apagou a dele;
--   8. ENCAMINHAR: cada destino passa pela porteira dele;
--   9. GRUPOS: criar, o webhook ativa, a mensagem do grupo chega, o envio
--      espera a janela do grupo e sai assinado;
--  10. QUEM PODE: ninguém escreve na fila de ações por fora; leitura não cria
--      grupo; fixar tem teto de três.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(49);

insert into public.allowed_users (email, role, note) values
  ('h116.g@teste.local', 'gestor', 'pgTAP 116'),
  ('h116.l@teste.local', 'leitura', 'pgTAP 116');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000011601'::uuid, 'h116.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000011602'::uuid, 'h116.l@teste.local', '{"full_name":"Leo Leitura"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999911600"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

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
create function pg_temp.gil() returns uuid language sql immutable as $$
  select 'a0000000-0000-4000-8000-000000011601'::uuid
$$;

create temp table t116(chave text primary key, valor text);
grant select, insert on t116 to authenticated;
create function pg_temp.v(p text) returns text language sql stable as $$
  select valor from t116 where chave = p
$$;
create function pg_temp.u(p text) returns uuid language sql stable as $$
  select valor::uuid from t116 where chave = p
$$;

-- Duas conversas: uma com a janela aberta (o contato escreveu agora), outra
-- fechada (escreveu há três dias).
select public.wa_entrada_registrar('wamid.W116.1', '+5584999911600', '+5584999911601', 'text', 'Oi, tudo bem?');
select public.wa_entrada_registrar('wamid.W116.F', '+5584999911600', '+5584999911602', 'text', 'Antigo',
                                   null, null, now() - interval '3 days');
insert into t116 values
  ('aberta', (select id::text from public.conversations where peer_phone_e164 = '+5584999911601')),
  ('fechada', (select id::text from public.conversations where peer_phone_e164 = '+5584999911602')),
  ('oi', (select id::text from public.messages where wa_message_id = 'wamid.W116.1'));
update public.conversations set assignee_id = pg_temp.gil() where id in (pg_temp.u('aberta'), pg_temp.u('fechada'));

-- =====================================================================
-- 1. Reagir
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into t116 values ('reacao', public.mensagem_reagir(pg_temp.u('oi'), '👍') ->> 'message_id');
select pg_temp.sair();
select is((select type::text from public.messages where id = pg_temp.u('reacao')), 'reaction',
  'reagir grava uma reação');
select is((select reage_a from public.messages where id = pg_temp.u('reacao')), pg_temp.u('oi'),
  'apontando para a mensagem reagida');

select public.wa_entrada_registrar('wamid.W116.F2', '+5584999911600', '+5584999911602', 'text', 'Também antigo',
                                   null, null, now() - interval '3 days');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into t116 values ('reacao_fechada',
  public.mensagem_reagir((select id from public.messages where wa_message_id = 'wamid.W116.F2'), '❤️') ->> 'ok');
select pg_temp.sair();
select is(pg_temp.v('reacao_fechada'), 'false', 'fora da janela de 24 h a reação não sai: a porteira vale para ela');

-- =====================================================================
-- 2. Apagar
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
values (pg_temp.u('aberta'), 'out', 'text', 'queued', 'Mensagem errada', 'human', pg_temp.gil(), 'crm');
insert into t116 values ('errada', (select id::text from public.messages
                                     where conversation_id = pg_temp.u('aberta') and body like '%Mensagem errada'));
insert into t116 values ('apagar_fila', public.mensagem_apagar(pg_temp.u('errada'))::text);
select pg_temp.sair();
select is(pg_temp.v('apagar_fila')::jsonb ->> 'cancelada', 'true', 'apagar o que está na fila cancela o envio');
select is((select status::text || '/' || error_code from public.messages where id = pg_temp.u('errada')),
  'failed/cancelada', 'e a mensagem não sai: falhou, com o motivo "cancelada"');
select ok(not public.wa_saida_ainda_vale(pg_temp.u('errada')),
  'o worker pergunta antes de mandar e ouve "não vale mais"');

-- A corrida: a Meta aceitou um instante antes do cancelamento.
select app.wa_sucesso(0, pg_temp.u('errada'), 'wamid.W116.CORRIDA');
select is((select status::text from public.messages where id = pg_temp.u('errada')), 'sent',
  'se saiu mesmo assim, o registro diz a verdade: saiu');
select ok((select apagada_em is null from public.messages where id = pg_temp.u('errada')),
  'e volta a aparecer no fio, porque o contato recebeu');

select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into t116 values ('apagar_saiu', public.mensagem_apagar(pg_temp.u('errada'))::text);
select pg_temp.sair();
select is(pg_temp.v('apagar_saiu')::jsonb ->> 'cancelada', 'false', 'o que já saiu é apagado só no CRM');
select is((select apagada_por from public.messages where id = pg_temp.u('errada')), pg_temp.gil(),
  'com quem apagou');
select is((select status::text from public.messages where id = pg_temp.u('errada')), 'sent',
  'e sem mentir sobre a entrega');

-- =====================================================================
-- 3. Corrigir
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into t116 values ('correcao', public.mensagem_corrigir(pg_temp.u('errada'), 'Mensagem certa') ->> 'message_id');
select pg_temp.sair();
select is((select corrige_a from public.messages where id = pg_temp.u('correcao')), pg_temp.u('errada'),
  'a correção aponta para a errada');
select is((select responde_a from public.messages where id = pg_temp.u('correcao')), pg_temp.u('errada'),
  'e sai como resposta a ela, para o contato ver qual foi corrigida');
select is((select body from public.messages where id = pg_temp.u('correcao')),
  E'*Gil:*\n*Correção:* Mensagem certa', 'assinada e com "Correção:" em negrito na frente');

-- =====================================================================
-- 4. A forma
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select throws_like(
  format($$ insert into public.messages (conversation_id, direction, type, status, author_kind, sent_by, origin, conteudo)
            values (%L, 'out', 'location', 'queued', 'human', %L, 'crm', '{"latitude": 200}') $$,
         pg_temp.u('aberta'), pg_temp.gil()),
  '%latitude e longitude válidas%', 'localização sem latitude válida não entra');
select throws_like(
  format($$ insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin, conteudo)
            values (%L, 'out', 'interactive', 'queued', 'Qual dia?', 'human', %L, 'crm',
                    '{"interativo": {"tipo": "botoes", "botoes": ["Seg", "Ter", "Qua", "Qui"]}}') $$,
         pg_temp.u('aberta'), pg_temp.gil()),
  '%de 1 a 3 botões%', 'quatro botões não entram: a Meta aceita três');
select throws_like(
  format($$ insert into public.messages (conversation_id, direction, type, status, author_kind, sent_by, origin)
            values (%L, 'out', 'document', 'queued', 'human', %L, 'crm') $$,
         pg_temp.u('aberta'), pg_temp.gil()),
  '%documento sem arquivo%', 'documento sem arquivo não entra');
select throws_like(
  format($$ insert into public.messages (conversation_id, direction, type, status, author_kind, sent_by, origin, media_path, media_mime)
            values (%L, 'out', 'image', 'queued', 'human', %L, 'crm', 'outra-conversa/saida/x.jpg', 'image/jpeg') $$,
         pg_temp.u('aberta'), pg_temp.gil()),
  '%não é desta conversa%', 'arquivo de fora da pasta da conversa, que ninguém aqui enxerga, não sai');
select lives_ok(
  format($$ insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin, conteudo)
            values (%L, 'out', 'interactive', 'queued', 'Qual dia fica melhor?', 'human', %L, 'crm',
                    '{"interativo": {"tipo": "botoes", "botoes": ["Segunda", "Terça"]}}') $$,
         pg_temp.u('aberta'), pg_temp.gil()),
  'dois botões entram');
select pg_temp.sair();
select is((select body from public.messages where conversation_id = pg_temp.u('aberta')
            and type = 'interactive' order by created_at desc limit 1),
  E'*Gil:*\nQual dia fica melhor?', 'e a pergunta dos botões sai assinada, como o texto');

-- =====================================================================
-- 5. Bloquear
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
values (pg_temp.u('aberta'), 'out', 'text', 'queued', 'Vai ficar na fila', 'human', pg_temp.gil(), 'crm');
insert into t116 values ('bloquear', public.conversa_bloquear(pg_temp.u('aberta'), true)::text);
select pg_temp.sair();
select is(pg_temp.v('bloquear')::jsonb ->> 'bloqueada', 'true', 'bloquear vale na hora');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.u('aberta')
            and status = 'queued'), 0, 'e o que estava na fila não sai');
select is((select count(*)::int from public.wa_acoes where conversation_id = pg_temp.u('aberta') and tipo = 'bloquear'),
  1, 'o pedido de bloqueio vai para o worker');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select throws_like(
  format($$ insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
            values (%L, 'out', 'text', 'queued', 'Oi de novo', 'human', %L, 'crm') $$,
         pg_temp.u('aberta'), pg_temp.gil()),
  '%conversa_bloqueada%', 'conversa bloqueada não manda nada');
select pg_temp.sair();

-- A Meta recusa (o contato escreveu há mais de 24 h, por exemplo).
select public.wa_acoes_proximas(50);
select public.wa_acao_falhar((select id from public.wa_acoes where conversation_id = pg_temp.u('aberta') and tipo = 'bloquear'),
                             '131047', 'Re-engagement message', false);
select is((select bloqueio_na_meta || ' / ' || bloqueio_erro from public.conversations where id = pg_temp.u('aberta')),
  'falhou / Re-engagement message', 'se a Meta recusar, a conversa diz que lá não bloqueou, e por quê');
select ok((select bloqueada_em is not null from public.conversations where id = pg_temp.u('aberta')),
  'e o bloqueio do CRM continua valendo');

select pg_temp.entrar(pg_temp.gil(), 'gestor');
select public.conversa_bloquear(pg_temp.u('aberta'), false);
select pg_temp.sair();
select ok((select bloqueada_em is null from public.conversations where id = pg_temp.u('aberta')), 'desbloquear devolve a conversa');

-- =====================================================================
-- 6. Lida e "digitando…"
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select public.conversa_marcar_lida(pg_temp.u('aberta'));
select public.conversa_marcar_lida(pg_temp.u('aberta'));
insert into t116 values ('digitando', public.conversa_digitando(pg_temp.u('aberta')) ->> 'ok');
insert into t116 values ('digitando_fechada', public.conversa_digitando(pg_temp.u('fechada')) ->> 'motivo');
select pg_temp.sair();
select is((select count(*)::int from public.wa_acoes where tipo = 'ler' and dados ->> 'wamid' = 'wamid.W116.1'),
  1, 'abrir duas vezes marca como lida uma vez só, na Meta');
select is(pg_temp.v('digitando'), 'true', '"digitando…" vira pedido ao worker');
select is(pg_temp.v('digitando_fechada'), 'janela_fechada', 'e não aparece para quem não está esperando resposta');

-- =====================================================================
-- 7. O que chega
-- =====================================================================
select public.wa_entrada_registrar('wamid.W116.2', '+5584999911600', '+5584999911601', 'text', 'Respondendo você',
  null, null, now(), null, null, '{"responde_a_wamid": "wamid.W116.1"}'::jsonb);
select public.wa_entrada_registrar('wamid.W116.3', '+5584999911600', '+5584999911601', 'reaction', '🙏',
  null, null, now(), null, null, '{"reage_a_wamid": "wamid.W116.1"}'::jsonb);
select public.wa_entrada_registrar('wamid.W116.4', '+5584999911600', '+5584999911601', 'location', 'Espaço Lagoa',
  null, null, now(), null, null,
  '{"conteudo": {"latitude": -5.79, "longitude": -35.2, "nome": "Espaço Lagoa"}}'::jsonb);
select is((select responde_a from public.messages where wa_message_id = 'wamid.W116.2'), pg_temp.u('oi'),
  'a resposta citada fica ligada à mensagem citada');
select is((select reage_a from public.messages where wa_message_id = 'wamid.W116.3'), pg_temp.u('oi'),
  'a reação do contato fica ligada à mensagem reagida');
select is((select type::text || ' ' || (conteudo ->> 'latitude') from public.messages where wa_message_id = 'wamid.W116.4'),
  'location -5.79', 'a localização entra com o tipo e as coordenadas');

select public.wa_entrada_evento('revoke', 'wamid.W116.2', now());
select ok((select apagada_pelo_contato_em is not null from public.messages where wa_message_id = 'wamid.W116.2'),
  'o contato apagou a dele: a original fica marcada, sem linha nova no fio');

-- =====================================================================
-- 8. Encaminhar
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into t116 values ('encaminhar',
  public.mensagem_encaminhar((select id from public.messages where wa_message_id = 'wamid.W116.4'),
                             array[pg_temp.u('aberta'), pg_temp.u('fechada')])::text);
select pg_temp.sair();
select is((select count(*)::int from jsonb_array_elements(pg_temp.v('encaminhar')::jsonb -> 'resultados') r
            where (r ->> 'ok')::boolean), 1, 'encaminhar: sai para quem está com a janela aberta');
select is((select count(*)::int from jsonb_array_elements(pg_temp.v('encaminhar')::jsonb -> 'resultados') r
            where not (r ->> 'ok')::boolean and r ->> 'motivo' like '%Envio recusado%'), 1,
  'e para quem não está, diz que a porteira recusou');

-- =====================================================================
-- 9. Grupos
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into t116 values ('grupo', public.grupo_criar('Fornecedores do Réveillon', 'Combinados da festa') ->> 'grupo_id');
select pg_temp.sair();
select is((select estado from public.wa_grupos where id = pg_temp.u('grupo')), 'criando', 'criar o grupo pede à Meta');
select is((select count(*)::int from public.wa_acoes where grupo_id = pg_temp.u('grupo') and tipo = 'grupo_criar'),
  1, 'pelo worker');

select public.wa_grupo_evento_registrar(jsonb_build_object(
  'tipo', 'group_create', 'group_id', 'G116', 'subject', 'Fornecedores do Réveillon',
  'invite_link', 'https://chat.whatsapp.com/abc116', 'join_approval_mode', 'approval_required'));
select is((select estado || ' ' || link_convite from public.wa_grupos where id = pg_temp.u('grupo')),
  'ativo https://chat.whatsapp.com/abc116', 'o webhook da Meta ativa o grupo e traz o link de convite');

select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into t116 values ('grupo_sem_janela', public.grupo_enviar(pg_temp.u('grupo'), 'text', 'Bom dia, pessoal') ->> 'motivo');
select pg_temp.sair();
select is(pg_temp.v('grupo_sem_janela'), 'janela_do_grupo_fechada',
  'ninguém escreveu no grupo: fora da janela não sai texto livre');

select public.wa_grupo_entrada_registrar('wamid.G116.1', '+5584999911600', 'G116', '5584999911605', 'Marta Buffet',
                                         'text', 'Cheguei!');
select is((select unread_count from public.wa_grupos where id = pg_temp.u('grupo')), 1, 'a mensagem do grupo chega');
select is((select nome from public.wa_grupo_participantes where grupo_id = pg_temp.u('grupo') and wa_id = '5584999911605'),
  'Marta Buffet', 'e quem escreveu entra na lista de participantes');

select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into t116 values ('grupo_msg', public.grupo_enviar(pg_temp.u('grupo'), 'text', 'Bom dia, pessoal') ->> 'mensagem_id');
select pg_temp.sair();
select is((select body from public.wa_grupo_mensagens where id = pg_temp.u('grupo_msg')),
  E'*Gil:*\nBom dia, pessoal', 'com a janela aberta, sai assinado como no 1:1');
select is((select count(*)::int from public.wa_acoes where grupo_id = pg_temp.u('grupo') and tipo = 'grupo_enviar'),
  1, 'e vai para o worker mandar');

select pg_temp.entrar(pg_temp.gil(), 'gestor');
insert into t116 values ('grupo_outro_arquivo',
  public.grupo_enviar(pg_temp.u('grupo'), 'image', null, pg_temp.u('aberta') || '/foto.jpg', 'image/jpeg') ->> 'motivo');
select pg_temp.sair();
select is(pg_temp.v('grupo_outro_arquivo'), 'arquivo_de_outro_lugar',
  'o grupo só recebe arquivo da pasta dele, e não a mídia de outra conversa do balde');

-- O worker manda e conclui.
select public.wa_acoes_proximas(50);
select public.wa_acao_concluir((select id from public.wa_acoes where grupo_id = pg_temp.u('grupo') and tipo = 'grupo_enviar'),
                               '{"wamid": "wamid.G116.OUT"}'::jsonb);
select public.wa_grupo_status_registrar('wamid.G116.OUT', 'delivered');
select is((select status::text from public.wa_grupo_mensagens where id = pg_temp.u('grupo_msg')), 'delivered',
  'o recibo da Meta chega na mensagem do grupo');

-- =====================================================================
-- 10. Quem pode
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select throws_ok(
  format($$ insert into public.wa_acoes (tipo, conversation_id) values ('bloquear', %L) $$, pg_temp.u('aberta')),
  '42501', null, 'ninguém escreve na fila de ações por fora das funções');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000011602'::uuid, 'leitura');
insert into t116 values ('leitura_grupo', public.grupo_criar('Grupo da leitura') ->> 'motivo');
select pg_temp.sair();
select is(pg_temp.v('leitura_grupo'), 'sem_permissao', 'quem só lê não cria grupo');

do $$
declare i int;
begin
  for i in 1..4 loop
    insert into public.conversations (channel, business_number, peer_phone_e164, assignee_id, status)
    values ('whatsapp', '+5584999911600', '+558499991170' || i,
            'a0000000-0000-4000-8000-000000011601'::uuid, 'aguardando_nos');
  end loop;
end $$;
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select public.conversa_fixar(c.id, true) from public.conversations c
 where c.peer_phone_e164 in ('+5584999911701', '+5584999911702', '+5584999911703');
insert into t116 values ('quarta_fixada',
  public.conversa_fixar((select id from public.conversations where peer_phone_e164 = '+5584999911704'), true) ->> 'motivo');
select pg_temp.sair();
select is(pg_temp.v('quarta_fixada'), 'ja_tem_tres_fixadas', 'fixar tem teto de três, como no WhatsApp');

select * from finish();
rollback;

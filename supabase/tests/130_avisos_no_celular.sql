-- =====================================================================
-- pgTAP — Avisos no celular (migração 20261106120000)
--
-- Pedido de 05/11/2026: o app avisa mensagem nova, conversa transferida e
-- compromisso marcado (com lembrete 30 min antes), com o NOME e nunca o conteúdo.
-- Este arquivo prova:
--
--   1. O APARELHO é de quem está logado: só a própria pessoa registra e remove o
--      dela, e ninguém lê a tabela direto;
--   2. QUEM RECEBE a mensagem nova é a regra do aviso do navegador: parceiro já
--      atendido avisa só o responsável; cliente avisa todos que atendem; quem
--      silenciou não recebe;
--   3. TRANSFERÊNCIA e COMPROMISSO avisam quem recebeu, não quem fez;
--   4. O LEMBRETE sai 30 min antes da reunião;
--   5. O MESMO FATO NÃO VIRA DOIS AVISOS, e sem aparelho nada é mandado;
--   6. O WHATSAPP NÃO É TOCADO: a varredura não grava mensagem nenhuma;
--   7. A CHAVE GERAL desliga tudo;
--   8. CADA EMPRESA TEM O SEU CATÁLOGO (entrevista de 06/11/2026): lote, robô e
--      publicado só na KOMUNE; ligação perdida só na Imova;
--   9. CADA PESSOA DESLIGA O QUE QUISER, e o desligado não sai;
--  10. A RESPOSTA ATRASADA avisa quem atende, uma vez, 24 h depois;
--  11. O RESUMO DAS 8H fala do dia da pessoa.
--
-- Roda em transação e desfaz tudo (inclusive o pedido ao Expo, que o pg_net só
-- faria depois do commit).
-- =====================================================================
begin;
select plan(28);

insert into public.allowed_users (email, role, note) values
  ('p130.g1@teste.local', 'gestor', 'pgTAP avisos'),
  ('p130.g2@teste.local', 'gestor', 'pgTAP avisos'),
  ('p130.s1@teste.local', 'sdr', 'pgTAP avisos');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000013001'::uuid, 'p130.g1@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000013002'::uuid, 'p130.g2@teste.local', '{"full_name":"Gabi Gestora"}'),
  ('a0000000-0000-4000-8000-000000013003'::uuid, 'p130.s1@teste.local', '{"full_name":"Sara SDR"}');

-- Nada automático responde enquanto o teste faz mensagens chegarem.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999913000"')
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

create temp table t130(chave text primary key, valor uuid);
-- Uma conversa: de parceiro (com ficha) ou de cliente (sem ficha), com G1 atendendo.
create function pg_temp.conversa(p_chave text, p_telefone text, p_parceiro boolean) returns uuid
language plpgsql as $$
declare v_org uuid; v_conv uuid;
begin
  if p_parceiro then
    insert into public.organizations (name, phone_e164, source_id, collector)
    values ('Buffet do pgTAP 130 ' || p_chave, p_telefone,
            (select id from public.sources where slug = 'planilha'), 'pgtap130')
    returning id into v_org;
  end if;
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome,
                                    organization_id, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999913000', p_telefone, 'Cliente ' || p_chave, v_org,
          'a0000000-0000-4000-8000-000000013001'::uuid, 'aguardando_nos')
  returning id into v_conv;
  insert into t130 values (p_chave, v_conv);
  return v_conv;
end $$;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t130 where chave = p_chave
$$;
create function pg_temp.chega(p_chave text) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (pg_temp.id(p_chave), 'in'::app.msg_direction, 'text'::app.msg_type,
          'received'::app.msg_status, 'quanto custa o pacote?', 'system', 'crm');
$$;
create function pg_temp.avisos(p_tipo text, p_pessoa uuid) returns bigint language sql stable as $$
  select count(*) from app.push_fila where tipo = p_tipo and pessoa_id = p_pessoa
$$;

-- ---------------------------------------------------------------------
-- 1. O aparelho
-- ---------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.aparelhos_push', 'select'),
  'ninguém logado lê a tabela de aparelhos direto');

select throws_ok(
  $$select public.aparelho_registrar('ExponentPushToken[abcdefghij0123456789]', 'ios', 'komune', 'Komune')$$,
  '42501', null, 'sem sessão não registra aparelho');

select pg_temp.entrar('a0000000-0000-4000-8000-000000013001'::uuid, 'gestor');
select public.aparelho_registrar('ExponentPushToken[abcdefghij0123456789]', 'ios', 'komune', 'Komune');
select pg_temp.sair();
select is((select pessoa_id from public.aparelhos_push where token = 'ExponentPushToken[abcdefghij0123456789]'),
  'a0000000-0000-4000-8000-000000013001'::uuid, 'o aparelho fica com quem registrou');

select pg_temp.entrar('a0000000-0000-4000-8000-000000013002'::uuid, 'gestor');
select public.aparelho_registrar('ExponentPushToken[abcdefghij0123456789]', 'ios', 'komune', 'Komune');
select pg_temp.sair();
select is((select pessoa_id from public.aparelhos_push where token = 'ExponentPushToken[abcdefghij0123456789]'),
  'a0000000-0000-4000-8000-000000013002'::uuid, 'outra pessoa entrou no mesmo aparelho: os avisos passam a ser dela');

select pg_temp.entrar('a0000000-0000-4000-8000-000000013001'::uuid, 'gestor');
select public.aparelho_remover('ExponentPushToken[abcdefghij0123456789]');
select pg_temp.sair();
select ok(exists (select 1 from public.aparelhos_push where token = 'ExponentPushToken[abcdefghij0123456789]'),
  'ninguém remove o aparelho de outra pessoa');

select pg_temp.entrar('a0000000-0000-4000-8000-000000013002'::uuid, 'gestor');
select public.aparelho_remover('ExponentPushToken[abcdefghij0123456789]');
select pg_temp.sair();
select ok(not exists (select 1 from public.aparelhos_push where token = 'ExponentPushToken[abcdefghij0123456789]'),
  'ao sair da conta, o aparelho deixa de receber');

-- ---------------------------------------------------------------------
-- 2. Quem recebe a mensagem nova
-- ---------------------------------------------------------------------
select pg_temp.conversa('atendida', '+5584900013001', true);
-- O parceiro escreveu (abre a janela de 24 h) e G1 respondeu: a conversa é dele.
select pg_temp.chega('atendida');
insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
values (pg_temp.id('atendida'), 'out'::app.msg_direction, 'text'::app.msg_type, 'queued'::app.msg_status,
        'oi, tudo bem?', 'human', 'a0000000-0000-4000-8000-000000013001'::uuid, 'crm');
select pg_temp.conversa('cliente', '+5584900013002', false);
select pg_temp.conversa('silenciada', '+5584900013003', false);
insert into public.conversa_preferencias (profile_id, conversation_id, silenciada_ate)
values ('a0000000-0000-4000-8000-000000013002'::uuid, pg_temp.id('silenciada'), 'infinity');

create temp table t130_saida as
  select count(*) as n from public.messages where direction = 'out';
select pg_temp.chega('atendida');
select pg_temp.chega('cliente');
select pg_temp.chega('silenciada');
select app.avisos_push_varrer();

select is((select count(*) from app.push_fila where conversa_id = pg_temp.id('atendida')),
  1::bigint, 'parceiro já atendido: o aviso é só de quem atende');
select is((select corpo from app.push_fila where conversa_id = pg_temp.id('atendida')),
  'Nova mensagem de Buffet do pgTAP 130 atendida', 'o aviso diz o nome, sem o conteúdo da mensagem');
select ok((select count(*) from app.push_fila
            where conversa_id = pg_temp.id('cliente')
              and pessoa_id in ('a0000000-0000-4000-8000-000000013001'::uuid,
                                'a0000000-0000-4000-8000-000000013002'::uuid,
                                'a0000000-0000-4000-8000-000000013003'::uuid)) = 3,
  'cliente é de todos: gestores e SDR recebem');
select ok(not exists (select 1 from app.push_fila
                       where conversa_id = pg_temp.id('silenciada')
                         and pessoa_id = 'a0000000-0000-4000-8000-000000013002'::uuid)
          and exists (select 1 from app.push_fila
                       where conversa_id = pg_temp.id('silenciada')
                         and pessoa_id = 'a0000000-0000-4000-8000-000000013001'::uuid),
  'quem silenciou a conversa não recebe; os outros recebem');
select is((select caminho from app.push_fila
            where conversa_id = pg_temp.id('cliente')
              and pessoa_id = 'a0000000-0000-4000-8000-000000013001'::uuid),
  '/conversas?cliente=' || pg_temp.id('cliente'), 'o toque abre a conversa do cliente');

-- ---------------------------------------------------------------------
-- 3. Transferência e compromisso
-- ---------------------------------------------------------------------
insert into public.conversa_transferencias (conversation_id, de_pessoa, para_pessoa, feita_por)
values (pg_temp.id('atendida'), 'a0000000-0000-4000-8000-000000013001'::uuid,
        'a0000000-0000-4000-8000-000000013002'::uuid, 'a0000000-0000-4000-8000-000000013001'::uuid),
       (pg_temp.id('cliente'), null,
        'a0000000-0000-4000-8000-000000013003'::uuid, 'a0000000-0000-4000-8000-000000013003'::uuid);
-- G1 marca uma visita para S1: a agenda grava o aviso apontando para a tarefa.
with visita as (
  insert into public.tasks (title, kind, status, due_at, assignee_id, created_by)
  values ('Visita ao Buffet', 'visit', 'todo', '2026-11-20 13:00:00-03',
          'a0000000-0000-4000-8000-000000013003'::uuid, 'a0000000-0000-4000-8000-000000013001'::uuid)
  returning id
)
insert into public.agenda_avisos (dono_id, marcado_por, tipo, task_id, titulo, quando)
select 'a0000000-0000-4000-8000-000000013003'::uuid, 'a0000000-0000-4000-8000-000000013001'::uuid,
       'visita', visita.id, 'Visita ao Buffet', '2026-11-20 13:00:00-03'
  from visita;
select app.avisos_push_varrer();

select is((select corpo from app.push_fila
            where tipo = 'transferencia' and pessoa_id = 'a0000000-0000-4000-8000-000000013002'::uuid),
  'Gil passou a conversa com Buffet do pgTAP 130 atendida para você',
  'a transferência avisa quem recebeu a conversa, dizendo quem passou');
select is(pg_temp.avisos('transferencia', 'a0000000-0000-4000-8000-000000013003'::uuid), 0::bigint,
  'quem pegou a conversa para si não recebe aviso');
select is((select corpo from app.push_fila
            where tipo = 'compromisso' and pessoa_id = 'a0000000-0000-4000-8000-000000013003'::uuid),
  'Gil marcou para você: Visita ao Buffet, 20/11 às 13:00',
  'o compromisso marcado por outra pessoa avisa quem vai, com dia e hora de Fortaleza');

-- ---------------------------------------------------------------------
-- 4. O lembrete de 30 minutos
-- ---------------------------------------------------------------------
insert into public.tasks (title, kind, status, due_at, assignee_id, created_by)
values ('Visita ao salão', 'visit', 'todo', now() + interval '28 minutes',
        'a0000000-0000-4000-8000-000000013001'::uuid, 'a0000000-0000-4000-8000-000000013001'::uuid),
       ('Visita amanhã', 'visit', 'todo', now() + interval '1 day',
        'a0000000-0000-4000-8000-000000013001'::uuid, 'a0000000-0000-4000-8000-000000013001'::uuid);
select app.avisos_push_varrer();
select is(pg_temp.avisos('lembrete', 'a0000000-0000-4000-8000-000000013001'::uuid), 1::bigint,
  'o lembrete sai para o compromisso daqui a 30 minutos, e só para ele');

-- ---------------------------------------------------------------------
-- 5 e 6. Sem repetição, sem aparelho nada sai, e o WhatsApp fica como estava
-- ---------------------------------------------------------------------
select is(app.avisos_push_varrer(), 0, 'varrer de novo não repete aviso nenhum');

-- 9. Gabi desliga "Mensagem nova" para si.
select pg_temp.entrar('a0000000-0000-4000-8000-000000013002'::uuid, 'gestor');
select public.avisos_definir('mensagem', false);
select is((select ligado from public.avisos_meus() where tipo = 'mensagem'), false,
  'a tela "Avisos no celular" mostra o aviso desligado');
select throws_ok($$select public.avisos_definir('lead_inventado', false)$$, '22023', null,
  'aviso que não existe nesta empresa não se desliga');
select pg_temp.sair();

select app.avisos_push_enviar();
select ok(not exists (select 1 from app.push_fila
                       where pessoa_id = 'a0000000-0000-4000-8000-000000013002'::uuid
                         and tipo = 'mensagem' and resultado <> 'desligado'),
  'o aviso desligado pela pessoa não sai');
select ok(not exists (select 1 from app.push_fila
                       where pessoa_id in ('a0000000-0000-4000-8000-000000013001'::uuid,
                                           'a0000000-0000-4000-8000-000000013002'::uuid,
                                           'a0000000-0000-4000-8000-000000013003'::uuid)
                         and coalesce(resultado, '') not in ('sem_aparelho', 'desligado')),
  'sem aparelho registrado, nada é mandado ao Expo');
select is((select count(*) from public.messages where direction = 'out'), (select n from t130_saida),
  'os avisos não gravam mensagem nenhuma: o WhatsApp não é tocado');

-- ---------------------------------------------------------------------
-- 10. A resposta atrasada: o cliente escreveu há 24 h e ninguém respondeu
-- ---------------------------------------------------------------------
select pg_temp.conversa('esquecida', '+5584900013004', false);
select pg_temp.chega('esquecida');
update public.conversations set last_inbound_at = now() - interval '24 hours 5 minutes'
 where id = pg_temp.id('esquecida');
select app.avisos_push_varrer();
select is((select corpo from app.push_fila
            where tipo = 'atrasada' and conversa_id = pg_temp.id('esquecida')
              and pessoa_id = 'a0000000-0000-4000-8000-000000013001'::uuid),
  'Cliente esquecida espera resposta há 24 h', 'a resposta atrasada avisa quem atende a conversa');
select is((select count(*) from app.push_fila
            where tipo = 'atrasada' and conversa_id = pg_temp.id('esquecida')), 1::bigint,
  'com alguém atendendo, só essa pessoa é avisada do atraso');

-- ---------------------------------------------------------------------
-- 11. O resumo das 8h
-- ---------------------------------------------------------------------
insert into public.tasks (title, kind, status, due_at, assignee_id, created_by)
values ('Visita ao Salão Azul', 'visit', 'todo',
        ((now() at time zone 'America/Fortaleza')::date + time '23:59') at time zone 'America/Fortaleza',
        'a0000000-0000-4000-8000-000000013003'::uuid, 'a0000000-0000-4000-8000-000000013001'::uuid);
select app.avisos_push_resumo();
select matches((select corpo from app.push_fila
                 where tipo = 'resumo' and pessoa_id = 'a0000000-0000-4000-8000-000000013003'::uuid),
  '^Bom dia! .*você tem 1 compromisso hoje, às 23:59$',
  'o resumo das 8h conta o compromisso do dia, com a hora');
select is(app.avisos_push_resumo(), (select count(*)::integer from app.push_fila where tipo = 'resumo'),
  'o resumo sai uma vez por dia para cada pessoa');

-- ---------------------------------------------------------------------
-- 8. O catálogo de cada empresa
-- ---------------------------------------------------------------------
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;
select pg_temp.virar('komune');
select ok((select array_agg(tipo) from app.avisos_catalogo()) @> array['mensagem', 'resumo', 'lote', 'reuniao_robo', 'publicado']
          and not exists (select 1 from app.avisos_catalogo() where tipo = 'ligacao_perdida'),
  'na KOMUNE: os comuns, lote, reunião do robô e parceiro publicado; sem ligação perdida');
select pg_temp.virar('imova');
select ok((select array_agg(tipo) from app.avisos_catalogo()) @> array['mensagem', 'resumo', 'ligacao_perdida']
          and not exists (select 1 from app.avisos_catalogo() where tipo in ('lote', 'reuniao_robo', 'publicado')),
  'na Imova: os comuns e a ligação perdida; nada de lote nem de parceiro publicado');

-- ---------------------------------------------------------------------
-- 7. A chave geral
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values ('avisos.push', '{"ativo": false}')
on conflict (key) do update set value = excluded.value;
select is(app.avisos_push_rodar() ->> 'ligado', 'false', 'com a chave geral desligada, nada roda');

select * from finish();
rollback;

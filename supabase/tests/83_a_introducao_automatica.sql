-- =====================================================================
-- pgTAP — A introdução automática (migração 20261002090000, ADR-16)
--
-- O que este arquivo tem de provar, e por quê:
--   1. A PERGUNTA CERTA É "TUDO O QUE SAIU FOI CUMPRIMENTO?", e não "saiu um?".
--      A campanha de RECONTATO existe (20260925170000 fala em 3.000 fichas já
--      tocadas): um fornecedor que levou "Bom dia!" em duas levas tem DUAS
--      saídas, as duas cumprimentos, e é justamente ele que merece a
--      apresentação quando enfim responde. Um `count(*) = 1` o deixaria mudo.
--   2. CONVERSA SEM SAÍDA NENHUMA não é "só o cumprimento": foi o lead que
--      começou, e quem responde a ele é o bot de entrada, com o menu.
--   3. SAÍDA SEM `template_id` (texto livre de gente) não conta como
--      cumprimento — e o `coalesce` externo existe porque `bool_and` sobre
--      nulo devolve NULL, que deixaria a introdução passar.
--   4. A INTRODUÇÃO SAI SOZINHA, PELO GATILHO, UMA VEZ POR CONVERSA — e SEM
--      NOME. O sem-nome é o pedido do Rafael em forma de teste: qualquer
--      atendente continua a conversa sem o lead perceber troca de pessoa.
--   5. OS AUTOMATISMOS NÃO SE ATROPELAM. Fora do horário a introdução se cala
--      e quem fala é a AUSÊNCIA, sozinha — se a introdução saísse ali, a
--      ausência veria a saída e se calaria (20260922120000), e o lead de
--      domingo à noite ficaria com uma oferta comercial e nenhum aviso de que
--      ninguém responde agora.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(20);

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

-- ---------- o ambiente ----------
-- A janela do canal, controlada pelo teste: a introdução só sai dentro do
-- horário (regra 0), e a campanha fictícia também precisa da porta aberta.
create table pg_temp.relogio (aberto boolean);
insert into pg_temp.relogio values (true);
create or replace function app.janela_do_canal(p_channel app.channel, p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', (select aberto from pg_temp.relogio),
                            'motivo', 'fora_do_horario',
                            'abre_em', now() + interval '10 hours', 'fecha_em', null)
$$;

insert into public.allowed_users (email, role, note)
values ('h83.g@teste.local', 'gestor', 'pgTAP introdução');
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000008301'::uuid, 'h83.g@teste.local', '{"full_name":"Gil Gestor"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999998300"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = jsonb_set(jsonb_set(value, '{inicio}', '"2026-01-01"'), '{whatsapp,depois}', '100')
 where key = 'cadencia.tetos';
update public.app_settings
   set value = value || '{"lead_automatico": false, "distribuicao_automatica": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
update public.message_templates set meta_status = 'approved' where template_code like 'GEN-ABR-OLA-%';

create function pg_temp.quem_assina() returns uuid language sql stable as $$
  select 'a0000000-0000-4000-8000-000000008301'::uuid
$$;
create function pg_temp.modelo(p_codigo text) returns int language sql stable as $$
  select id from public.message_templates where template_code = p_codigo
$$;

-- Uma ficha e um fio, sem saída nenhuma.
create function pg_temp.conversa_nova(p_tel text) returns uuid language plpgsql as $$
declare v_org uuid; v_conv uuid;
begin
  -- `public.organizations.collector` é not null mas tem preenchimento
  -- automático (20260904000300); passar explícito continua válido.
  insert into public.organizations (name, phone_e164, source_id, collector)
  values ('Buffet do pgTAP 83 ' || p_tel, p_tel,
          (select id from public.sources where slug = 'planilha'), 'pgtap83')
  returning id into v_org;
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, app.wa_numero_padrao(), p_tel, v_org,
          pg_temp.quem_assina(), 'aguardando_parceiro')
  returning id into v_conv;
  return v_conv;
end $$;

-- Um cumprimento de campanha, como a campanha o grava.
create function pg_temp.saiu_cumprimento(p_conv uuid, p_quando timestamptz) returns void
language plpgsql as $$
begin
  insert into public.messages (conversation_id, direction, type, status, body, template_id,
                               author_kind, sent_by, origin, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'Bom dia!', pg_temp.modelo('GEN-ABR-OLA-MANHA'),
          'human', pg_temp.quem_assina(), 'crm', p_quando, p_quando);
end $$;

-- Texto livre de gente: sem `template_id`.
create function pg_temp.saiu_texto_livre(p_conv uuid, p_quando timestamptz) returns void
language plpgsql as $$
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind,
                               sent_by, origin, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'Oi! Já te respondo com calma.', 'human', pg_temp.quem_assina(), 'crm', p_quando, p_quando);
end $$;

create function pg_temp.conversa_com_cumprimento(p_tel text) returns uuid language plpgsql as $$
declare v_conv uuid;
begin
  v_conv := pg_temp.conversa_nova(p_tel);
  perform pg_temp.saiu_cumprimento(v_conv, now() - interval '2 hours');
  return v_conv;
end $$;

create function pg_temp.conversa_com_dois_cumprimentos() returns uuid language plpgsql as $$
declare v_conv uuid;
begin
  v_conv := pg_temp.conversa_nova('+5584999998302');
  perform pg_temp.saiu_cumprimento(v_conv, now() - interval '30 days');
  perform pg_temp.saiu_cumprimento(v_conv, now() - interval '2 hours');
  return v_conv;
end $$;

-- Uma entrada do lead, pelo caminho de verdade: o worker chama
-- `public.wa_entrada_registrar`, como o webhook da Meta faz. É a entrada que
-- abre a janela de 24 h, e é ela que dispara os gatilhos.
create function pg_temp.worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.chegou(p_tel text, p_texto text, p_quando timestamptz default now())
returns void language plpgsql as $$
begin
  perform pg_temp.worker();
  perform public.wa_entrada_registrar('wamid.pgtap83.' || md5(p_tel || p_texto || p_quando::text),
                                      app.wa_numero_padrao(), p_tel, 'text', p_texto,
                                      null, null, p_quando);
  perform pg_temp.sair();
end $$;

create function pg_temp.chegou_audio(p_tel text) returns void language plpgsql as $$
begin
  perform pg_temp.worker();
  perform public.wa_entrada_registrar('wamid.pgtap83.audio.' || md5(p_tel),
                                      app.wa_numero_padrao(), p_tel, 'audio', null,
                                      'media83', 'audio/ogg', now());
  perform pg_temp.sair();
end $$;

-- O atendente já respondeu. Responde POR MODELO (e não por texto livre) porque
-- a conversa ainda não tem entrada nenhuma: fora da janela de 24 h a porteira
-- exige template (RF-CON-18), e o que a asserção precisa é só que a saída NÃO
-- seja um cumprimento.
create function pg_temp.conversa_com_resposta_humana() returns uuid language plpgsql as $$
declare v_conv uuid;
begin
  v_conv := pg_temp.conversa_com_cumprimento('+5584999998303');
  insert into public.messages (conversation_id, direction, type, status, body, template_id,
                               author_kind, sent_by, origin, created_at, sent_at)
  values (v_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'Passando para retomar nossa conversa.', pg_temp.modelo('GEN-FUP-LIG-V1'),
          'human', pg_temp.quem_assina(), 'crm', now() - interval '1 hour', now() - interval '1 hour');
  return v_conv;
end $$;

create function pg_temp.conversa_sem_saida() returns uuid language plpgsql as $$
begin
  return pg_temp.conversa_nova('+5584999998304');
end $$;

-- Texto livre de gente só existe com a janela aberta, e quem abre a janela é a
-- entrada do lead. Aqui a conversa é do lead: não houve cumprimento nenhum.
create function pg_temp.conversa_com_texto_livre() returns uuid language plpgsql as $$
declare v_conv uuid;
begin
  v_conv := pg_temp.conversa_nova('+5584999998305');
  perform pg_temp.chegou('+5584999998305', 'oi, vocês trabalham com o quê?', now() - interval '3 hours');
  perform pg_temp.saiu_texto_livre(v_conv, now() - interval '2 hours');
  return v_conv;
end $$;

-- ---------- os casos, cada um na sua instrução ----------
-- POR QUE UMA INSTRUÇÃO POR CASO, e não a fixture dentro do `select ok(...)`:
-- `app.wa_so_o_cumprimento_saiu` é STABLE, e função STABLE enxerga o snapshot
-- do INÍCIO da instrução. Montar a conversa dentro do mesmo `select` que a
-- pergunta deixaria a pergunta olhando para um banco sem as linhas que a
-- fixture acabou de inserir — e o teste ficaria vermelho por artefato, não por
-- defeito. As linhas nascem antes; a pergunta vem depois.
create table pg_temp.casos (nome text primary key, conv uuid);
create function pg_temp.caso(p_nome text) returns uuid language sql stable as $$
  select conv from pg_temp.casos where nome = p_nome
$$;

insert into pg_temp.casos values ('um_cumprimento', pg_temp.conversa_com_cumprimento('+5584999998301'));
insert into pg_temp.casos values ('recontato', pg_temp.conversa_com_dois_cumprimentos());
insert into pg_temp.casos values ('resposta_humana', pg_temp.conversa_com_resposta_humana());
insert into pg_temp.casos values ('sem_saida', pg_temp.conversa_sem_saida());
insert into pg_temp.casos values ('texto_livre', pg_temp.conversa_com_texto_livre());

-- =====================================================================
-- 1. A função pura
-- =====================================================================
select ok(app.wa_so_o_cumprimento_saiu(pg_temp.caso('um_cumprimento'), now()),
  'só o cumprimento saiu: a conversa está pronta para a introdução');

select ok(app.wa_so_o_cumprimento_saiu(pg_temp.caso('recontato'), now()),
  'RECONTATO: dois "Bom dia!" seguidos não são um dono — o lead que responde na segunda leva merece a apresentação igual');

select ok(not app.wa_so_o_cumprimento_saiu(pg_temp.caso('resposta_humana'), now()),
  'atendente já respondeu ao cumprimento: a introdução não entra por cima');

select ok(not app.wa_so_o_cumprimento_saiu(pg_temp.caso('sem_saida'), now()),
  'sem saída nenhuma não é "só o cumprimento": quem responde é o bot de entrada');

select ok(not app.wa_so_o_cumprimento_saiu(pg_temp.caso('texto_livre'), now()),
  'saída sem template_id não conta como cumprimento: coalesce fecha o nulo do bool_and');

-- ---------- leituras ----------
create function pg_temp.introducoes(p_nome text) returns int language sql stable as $$
  select count(*)::int from public.messages m
   where m.conversation_id = pg_temp.caso(p_nome)
     and m.template_id = app.wa_modelo_introducao()
$$;
create function pg_temp.corpo_da_introducao(p_nome text) returns text language sql stable as $$
  select m.body from public.messages m
   where m.conversation_id = pg_temp.caso(p_nome)
     and m.template_id = app.wa_modelo_introducao()
   order by m.created_at limit 1
$$;
create function pg_temp.autor_da_introducao(p_nome text) returns text language sql stable as $$
  select m.author_kind from public.messages m
   where m.conversation_id = pg_temp.caso(p_nome)
     and m.template_id = app.wa_modelo_introducao()
   order by m.created_at limit 1
$$;
create function pg_temp.ausencias(p_nome text) returns int language sql stable as $$
  select count(*)::int from public.messages m
   join public.message_templates t on t.id = m.template_id
   where m.conversation_id = pg_temp.caso(p_nome) and t.template_code = 'GEN-SYS-AUSENCIA'
$$;
create function pg_temp.ultima_entrada(p_tel text) returns uuid language sql stable as $$
  select m.id from public.messages m join public.conversations c on c.id = m.conversation_id
   where c.peer_phone_e164 = p_tel and m.direction = 'in'::app.msg_direction
   order by m.created_at desc, m.id desc limit 1
$$;

-- =====================================================================
-- 2. O caminho feliz: o gatilho, e só o insert da entrada
-- =====================================================================
insert into pg_temp.casos values ('feliz', pg_temp.conversa_com_cumprimento('+5584999998310'));

select lives_ok($$ select pg_temp.chegou('+5584999998310', 'bom dia, tudo bem?') $$,
  'a entrada do lead grava sem erro');

select is(pg_temp.introducoes('feliz'), 1,
  'a introdução saiu sozinha, pelo gatilho, uma vez');

select is(pg_temp.autor_da_introducao('feliz'), 'bot_fixed',
  'a introdução é bot_fixed com template: é isso que o messages_guard aceita sem rascunho');

-- =====================================================================
-- 3. O pedido do Rafael em forma de teste
-- =====================================================================
select ok(pg_temp.corpo_da_introducao('feliz') !~ '^\*[^*]+:\*',
  'A INTRODUÇÃO NÃO TEM NOME: app.messages_nome_do_atendente não assina bot_fixed com template');

select ok((select body from public.message_templates where template_code = 'GEN-SYS-INTRO')
          not like '%{{%',
  'a introdução não tem variável: wa_bot_dizer copia o corpo cru e um {{nome}} sairia literal');

-- =====================================================================
-- 4. As recusas, uma asserção cada
-- =====================================================================
-- UMA POR CONVERSA. O motivo é `a_conversa_ja_tem_dono`, e não `ja_introduzida`:
-- a regra (1) vem antes da (3), e a PRÓPRIA introdução já é uma saída que não é
-- cumprimento — ela virou o dono da conversa. O carimbo `introducao_em` continua
-- existindo porque ele resolve outra coisa: DUAS entradas ao mesmo tempo, em
-- transações diferentes, em que nenhuma enxerga a saída da outra. Esse caminho
-- não se alcança num teste de uma linha do tempo só, e por isso está escrito
-- aqui em vez de asseverado com uma fixture que fingisse concorrência.
select pg_temp.chegou('+5584999998310', 'pode explicar sim');
select is(app.wa_introduzir(pg_temp.ultima_entrada('+5584999998310')) ->> 'motivo',
  'a_conversa_ja_tem_dono',
  'segunda resposta do lead: a introdução já saiu e agora ELA é o dono da conversa');
select is(pg_temp.introducoes('feliz'), 1,
  'lead que responde duas vezes seguidas recebe UMA introdução, e só uma');

-- Reaproveita a conversa do caso 3 (o cumprimento e a resposta por modelo já
-- estão lá): criar outra com o mesmo telefone esbarraria no índice único de
-- `organizations.phone_e164`, que é o dedup do PRD e não uma chateação do teste.
insert into pg_temp.casos values ('apos_humano', pg_temp.caso('resposta_humana'));
select pg_temp.chegou('+5584999998303', 'oi, vi sua mensagem');
select is(app.wa_introduzir(pg_temp.ultima_entrada('+5584999998303')) ->> 'motivo',
  'a_conversa_ja_tem_dono',
  'atendente já respondeu: a introdução não fala por cima dele');

insert into pg_temp.casos values ('optout', pg_temp.conversa_com_cumprimento('+5584999998311'));
select pg_temp.chegou('+5584999998311', 'sair');
select is(app.wa_introduzir(pg_temp.ultima_entrada('+5584999998311')) ->> 'motivo', 'parece_optout',
  'quem escreve SAIR recebe a confirmação do RF-CON-19, não uma apresentação');

insert into pg_temp.casos values ('audio', pg_temp.conversa_com_cumprimento('+5584999998312'));
select pg_temp.chegou_audio('+5584999998312');
select is(app.wa_introduzir(pg_temp.ultima_entrada('+5584999998312')) ->> 'motivo',
  'nao_e_texto_de_entrada',
  'áudio recebido vai para gente (RF-CON-27), não para a apresentação automática');

-- A chave, pela RPC do gestor: é ela que a tela chama.
insert into pg_temp.casos values ('desligada', pg_temp.conversa_com_cumprimento('+5584999998313'));
select pg_temp.entrar(pg_temp.quem_assina(), 'gestor');
select public.atendimento_configurar('{"introducao_ativa": false}');
select pg_temp.sair();
select pg_temp.chegou('+5584999998313', 'bom dia');
select is(app.wa_introduzir(pg_temp.ultima_entrada('+5584999998313')) ->> 'motivo', 'desligada',
  'a chave em app_settings desliga sem deploy');
select pg_temp.entrar(pg_temp.quem_assina(), 'gestor');
select public.atendimento_configurar('{"introducao_ativa": true}');
select pg_temp.sair();

-- =====================================================================
-- 5. Os automatismos não se atropelam
-- =====================================================================
-- FORA DO HORÁRIO a introdução se cala e a AUSÊNCIA fala. É a correção de
-- 28/09: se a introdução saísse aqui, a ausência veria a saída e se calaria, e
-- o lead ficaria com uma oferta comercial e nenhum aviso de que ninguém
-- responde agora.
insert into pg_temp.casos values ('fora_do_horario', pg_temp.conversa_com_cumprimento('+5584999998314'));
update pg_temp.relogio set aberto = false;
select pg_temp.chegou('+5584999998314', 'oi, ainda tem vaga?');
select is(pg_temp.introducoes('fora_do_horario'), 0,
  'fora do horário a introdução NÃO sai');
select is(pg_temp.ausencias('fora_do_horario'), 1,
  'e quem fala fora do horário continua sendo a ausência, sozinha');
update pg_temp.relogio set aberto = true;

-- Conversa que o lead começou: não houve cumprimento, então não é da introdução.
insert into pg_temp.casos values ('lead_comecou', pg_temp.conversa_nova('+5584999998315'));
select pg_temp.chegou('+5584999998315', 'oi, quero saber sobre a plataforma');
select is(pg_temp.introducoes('lead_comecou'), 0,
  'conversa que o lead começou é do menu, não da introdução: não houve cumprimento');

-- Recontato, ponta a ponta: duas levas de campanha continuam sendo "só cumprimento".
select pg_temp.chegou('+5584999998302', 'agora sim, me explica');
select is(pg_temp.introducoes('recontato'), 1,
  'RECONTATO: quem levou dois "Bom dia!" e respondeu recebe a apresentação');

select * from finish();
rollback;

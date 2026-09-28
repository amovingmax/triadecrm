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
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(5);

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

select * from finish();
rollback;

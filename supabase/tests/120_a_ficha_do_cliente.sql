-- =====================================================================
-- pgTAP — A ficha do cliente que se preenche sozinha (migração 20261104100000)
--
-- Pedido de 03/11/2026 para a Imova: todo cliente que escreve tem ficha, e a
-- ficha se preenche sozinha — a régua anda e a próxima ação diz o que fazer.
-- Este arquivo prova:
--
--   1. SÓ DA IMOVA: num banco da KOMUNE nada liga, nem com a chave gravada à
--      força, e o job não cria ficha nenhuma;
--   2. A FICHA NASCE: quem escreveu vira Cliente (Comprador, funil Clientes,
--      "Chegou pelo WhatsApp"), com o nome do perfil, o atendente como
--      responsável, a conversa e as mensagens ligadas, e a régua em Respondeu;
--   3. NÃO DUPLICA NEM FORÇA: número que já é ficha é ligado a ela; quem pediu
--      para sair, conversa bloqueada e quem só recebeu mensagem ficam sem
--      ficha, e o job não tenta de novo a cada minuto;
--   4. A PRÓXIMA AÇÃO segue a conversa: Responder quando o cliente espera,
--      Retomar quando esperamos nós, a visita marcada, a etapa (proposta,
--      documentação) com as palavras de cada funil;
--   5. A MANUAL VALE até um fato novo: o cliente escrever de novo;
--   6. A RÉGUA ANDA de Nutrição para Respondeu quando o cliente volta;
--   7. QUEM LÊ: quem vê o negócio lê o porquê da próxima ação;
--   8. O WHATSAPP NÃO MUDA: nenhuma mensagem nova, nada na fila de saída, e a
--      conversa (estado, robô, janela, por ler, atendente) fica igual.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(44);

insert into public.allowed_users (email, role, note) values
  ('h120.g@teste.local', 'gestor', 'pgTAP 120'),
  ('h120.e@teste.local', 'embaixador', 'pgTAP 120');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000012001'::uuid, 'h120.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000012002'::uuid, 'h120.e@teste.local', '{"full_name":"Eva Embaixadora"}');

-- Nada automático responde às mensagens de teste.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999911900"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

-- A categoria da Imova (o banco do teste tem o seed da KOMUNE).
insert into public.categories (slug, name, "group", priority, position, komune_category_key, is_active)
values ('comprador', 'Comprador', 'producao', 1, 900, null, true)
on conflict (slug) do update set is_active = true;

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

create temp table t119(chave text primary key, valor uuid);
grant select on t119 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t119 where chave = p_chave
$$;
grant execute on function pg_temp.id(text) to authenticated;

create function pg_temp.conversa(p_chave text, p_tel text, p_nome text default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999911900', p_tel, p_nome,
          'a0000000-0000-4000-8000-000000012001'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t119 values (p_chave, v);
  return v;
end $$;
create function pg_temp.dele(p_conv uuid, p_em timestamptz) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'pgtap120 dele', 'system', 'crm', p_em)
$$;
create function pg_temp.nossa(p_conv uuid, p_em timestamptz) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'pgtap120 nossa', 'human', 'echo', 'a0000000-0000-4000-8000-000000012001'::uuid,
          'wamid.PGTAP119.' || gen_random_uuid(), p_em, p_em)
$$;
create function pg_temp.ficha(p_conv uuid) returns uuid language sql stable as $$
  select organization_id from public.conversations where id = p_conv
$$;
create function pg_temp.negocio(p_conv uuid) returns uuid language sql stable as $$
  select d.id from public.deals d where d.organization_id = pg_temp.ficha(p_conv)
   order by d.created_at limit 1
$$;
create function pg_temp.acao(p_conv uuid) returns text language sql stable as $$
  select d.next_action from public.deals d where d.id = pg_temp.negocio(p_conv)
$$;
create function pg_temp.etapa(p_conv uuid) returns text language sql stable as $$
  select s.slug from public.deals d join public.stages s on s.id = d.stage_id
   where d.id = pg_temp.negocio(p_conv)
$$;

create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

-- A linha de base do WhatsApp, antes de qualquer função da ficha.
create temp table t119_base as
  select (select count(*) from public.messages where direction = 'out'::app.msg_direction) as saidas,
         (select count(*) from pgmq.q_wa_outbound) as fila;

insert into public.app_settings (key, value, description)
values ('ficha_automatica', '{"ligada": true}'::jsonb, 'pgTAP 120')
on conflict (key) do update set value = excluded.value;

-- =====================================================================
-- 1. Só da Imova
-- =====================================================================
select pg_temp.conversa('a', '+5584999911901', 'Ana Souza');
select pg_temp.dele(pg_temp.id('a'), now() - interval '10 minutes');

select pg_temp.virar('komune');
select is(app.ficha_automatica_config() ->> 'ligada', 'false',
  'na KOMUNE a ficha automática não liga, nem com a chave gravada');
select is(app.fichas_automaticas_rodar(200) ->> 'ligada', 'false', 'e o job não faz nada');
select is(pg_temp.ficha(pg_temp.id('a')), null, 'a conversa continua sem ficha');

select pg_temp.virar('imova');
select is(app.ficha_automatica_config() ->> 'ligada', 'true', 'na Imova, com a chave, liga');

-- =====================================================================
-- 2. A ficha nasce
-- =====================================================================
create temp table t119_a as
  select row(c.status, c.bot_paused, c.bot_estado, c.window_expires_at, c.unread_count,
             c.assignee_id, c.last_message_at, c.snoozed_until, c.arquivada_em)::text as antes
    from public.conversations c where c.id = pg_temp.id('a');

select is((app.fichas_automaticas_rodar(200) ->> 'fichas')::int, 1, 'o job cria uma ficha');
select isnt(pg_temp.ficha(pg_temp.id('a')), null, 'e liga a conversa a ela');
select is((select o.kind::text || '|' || o.name || '|' || s.slug || '|' || o.is_natural_person
             from public.organizations o join public.sources s on s.id = o.source_id
            where o.id = pg_temp.ficha(pg_temp.id('a'))),
  'produtor|Ana Souza|whatsapp_entrada|true',
  'Cliente pessoa física, com o nome do perfil e a origem do WhatsApp');
select is((select ca.slug from public.organization_categories oc join public.categories ca on ca.id = oc.category_id
            where oc.organization_id = pg_temp.ficha(pg_temp.id('a')) and oc.is_primary),
  'comprador', 'categoria Comprador');
select is((select p.slug from public.deals d join public.pipelines p on p.id = d.pipeline_id
            where d.id = pg_temp.negocio(pg_temp.id('a'))),
  'produtor', 'o negócio está no funil de clientes');
select is(pg_temp.etapa(pg_temp.id('a')), 'respondeu', 'e a régua já está em Respondeu: ela escreveu');
select is((select d.owner_id from public.deals d where d.id = pg_temp.negocio(pg_temp.id('a')))::text,
  'a0000000-0000-4000-8000-000000012001', 'quem atende a conversa responde pela ficha');
select is((select count(*)::int from public.messages m
            where m.conversation_id = pg_temp.id('a') and m.organization_id is distinct from pg_temp.ficha(pg_temp.id('a'))),
  0, 'as mensagens da conversa carregam a ficha');
select is((select count(*)::int from public.activities a
            where a.organization_id = pg_temp.ficha(pg_temp.id('a')) and a.metadata ->> 'origin' = 'ficha_automatica'),
  1, 'a atividade diz que a ficha nasceu sozinha');

-- =====================================================================
-- 4. A próxima ação segue a conversa
-- =====================================================================
select is(pg_temp.acao(pg_temp.id('a')), 'Responder a mensagem', 'ela escreveu: Responder a mensagem');
select is((select d.next_action_at from public.deals d where d.id = pg_temp.negocio(pg_temp.id('a'))),
  (select max(m.created_at) from public.messages m where m.conversation_id = pg_temp.id('a') and m.direction = 'in'),
  'com a hora da mensagem dela');
select is((select a.regra || '|' || a.autor from public.proximas_acoes_automaticas a
            where a.deal_id = pg_temp.negocio(pg_temp.id('a'))),
  'responder|regra', 'e o porquê fica guardado, como da regra');
select is((app.fichas_automaticas_rodar(200) ->> 'proximas_acoes')::int, 0,
  'sem nada novo, o job seguinte não reescreve nada');

select pg_temp.nossa(pg_temp.id('a'), now() - interval '5 minutes');
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('a')), 'Retomar a conversa', 'respondemos: Retomar a conversa');
select is((select d.next_action_at from public.deals d where d.id = pg_temp.negocio(pg_temp.id('a'))),
  app.proxima_acao_dia(now() - interval '5 minutes', 2), 'dois dias úteis depois, às 9h');

-- Visita marcada na agenda: é ela a próxima ação.
insert into public.reunioes (organization_id, deal_id, dono_id, titulo, formato, inicio, fim, link, estado, marcada_por, marcada_por_id)
values (pg_temp.ficha(pg_temp.id('a')), pg_temp.negocio(pg_temp.id('a')),
        'a0000000-0000-4000-8000-000000012001'::uuid, 'Visita pgTAP 120', 'online',
        now() + interval '2 days', now() + interval '2 days 40 minutes', 'https://sala.invalid/s',
        'marcada', 'pessoa', 'a0000000-0000-4000-8000-000000012001'::uuid);
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('a')), 'Fazer a visita', 'visita na agenda: Fazer a visita');

-- =====================================================================
-- 5. A manual vale até um fato novo
-- =====================================================================
update public.deals set next_action = 'Ligar para combinar a chave', next_action_at = now() + interval '1 day'
 where id = pg_temp.negocio(pg_temp.id('a'));
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('a')), 'Ligar para combinar a chave',
  'a próxima ação escrita por alguém do time fica');
select is((select a.manual_texto from public.proximas_acoes_automaticas a
            where a.deal_id = pg_temp.negocio(pg_temp.id('a'))),
  'Ligar para combinar a chave', 'e a regra anota que está respeitando uma manual');
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('a')), 'Ligar para combinar a chave', 'no minuto seguinte também');
-- A regra viu a manual há um minuto, e agora o cliente escreve.
update public.proximas_acoes_automaticas set manual_desde = now() - interval '1 minute'
 where deal_id = pg_temp.negocio(pg_temp.id('a'));
select pg_temp.dele(pg_temp.id('a'), now());
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('a')), 'Responder a mensagem',
  'o cliente escreveu depois: a regra volta a escrever');

-- =====================================================================
-- 3. Não duplica nem força
-- =====================================================================
-- Número que já é ficha (proprietário).
do $$
declare v_org uuid;
begin
  insert into public.organizations (kind, name, source_id, collector, owner_id, phone_e164)
  select 'fornecedor'::app.org_kind, 'Proprietário pgTAP 120', s.id, 'pgtap120',
         'a0000000-0000-4000-8000-000000012001'::uuid, '+5584999911902'
    from public.sources s where s.slug = 'planilha'
  returning id into v_org;
  insert into t119 values ('dono', v_org);
  insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
  select v_org, p.id, st.id, 'a0000000-0000-4000-8000-000000012001'::uuid
    from public.pipelines p join public.stages st on st.pipeline_id = p.id and st.slug = 'apresentacao_realizada'
   where p.slug = 'fornecedor';
end $$;
select pg_temp.conversa('b', '+5584999911902', 'Outro nome');
update public.conversations set organization_id = null where id = pg_temp.id('b');
select pg_temp.dele(pg_temp.id('b'), now() - interval '3 hours');
select pg_temp.nossa(pg_temp.id('b'), now() - interval '2 hours');
select app.fichas_automaticas_rodar(200);
select is(pg_temp.ficha(pg_temp.id('b')), pg_temp.id('dono'), 'número que já é ficha: liga a ela');
select is((select count(*)::int from public.organizations where phone_e164 = '+5584999911902'), 1,
  'e não cria outra');
select is(pg_temp.acao(pg_temp.id('b')), 'Pedir a documentação do imóvel',
  'proprietário com o imóvel avaliado: as palavras do funil de captação');

-- Quem pediu para sair.
select pg_temp.conversa('c', '+5584999911903', 'Carla');
select pg_temp.dele(pg_temp.id('c'), now() - interval '1 hour');
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex(app.normalize_phone_br('+5584999911903')), 'phone', 'pgtap120');
-- Só recebeu mensagem nossa.
select pg_temp.conversa('d', '+5584999911904', 'Diego');
select pg_temp.nossa(pg_temp.id('d'), now() - interval '1 hour');
-- Conversa bloqueada.
select pg_temp.conversa('e', '+5584999911905', 'Edu');
select pg_temp.dele(pg_temp.id('e'), now() - interval '1 hour');
update public.conversations set bloqueada_em = now() where id = pg_temp.id('e');

select app.fichas_automaticas_rodar(200);
select is(pg_temp.ficha(pg_temp.id('c')), null, 'quem pediu para sair fica sem ficha');
select is((select motivo from app.ficha_automatica_recusas where conversation_id = pg_temp.id('c')),
  'telefone_suprimido', 'com o motivo anotado');
select is(pg_temp.ficha(pg_temp.id('d')), null, 'quem só recebeu mensagem nossa fica sem ficha');
select is(pg_temp.ficha(pg_temp.id('e')), null, 'conversa bloqueada fica sem ficha');
select is((select count(*)::int from app.ficha_automatica_recusas where conversation_id = pg_temp.id('e')), 0,
  'e nem é olhada');
-- A recusa de 10 minutos depois da última mensagem (no teste tudo acontece no
-- mesmo instante; a folga do job é de 5 minutos).
update app.ficha_automatica_recusas set tentada_em = now() + interval '10 minutes'
 where conversation_id = pg_temp.id('c');
create temp table t119_rec as
  select tentada_em from app.ficha_automatica_recusas where conversation_id = pg_temp.id('c');
select app.fichas_automaticas_rodar(200);
select is((select tentada_em from app.ficha_automatica_recusas where conversation_id = pg_temp.id('c')),
  (select tentada_em from t119_rec), 'a recusa não é tentada de novo a cada minuto');

-- =====================================================================
-- 6. A régua anda de Nutrição para Respondeu
-- =====================================================================
select pg_temp.conversa('f', '+5584999911906', 'Fábio');
select pg_temp.dele(pg_temp.id('f'), now() - interval '40 days');
select app.fichas_automaticas_rodar(200);
update public.deals
   set stage_id = (select st.id from public.stages st join public.pipelines p on p.id = st.pipeline_id
                    where p.slug = 'produtor' and st.slug = 'nutricao')
 where id = pg_temp.negocio(pg_temp.id('f'));
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('f')), 'Reativar com uma novidade', 'em nutrição: reativar');
update public.deals set entered_stage_at = now() - interval '1 day' where id = pg_temp.negocio(pg_temp.id('f'));
select pg_temp.dele(pg_temp.id('f'), now());
select app.fichas_automaticas_rodar(200);
select is(pg_temp.etapa(pg_temp.id('f')), 'respondeu', 'voltou a escrever: a régua volta para Respondeu');
select is((select d.status::text from public.deals d where d.id = pg_temp.negocio(pg_temp.id('f'))), 'open',
  'e o negócio reabre');
select is(pg_temp.acao(pg_temp.id('f')), 'Responder a mensagem', 'com a próxima ação de responder');

-- =====================================================================
-- 7. Quem lê
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000012001'::uuid, 'gestor');
select is((select a.regra from public.proximas_acoes_automaticas a where a.deal_id = pg_temp.negocio(pg_temp.id('f'))),
  'responder', 'o gestor lê o porquê da próxima ação');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000012002'::uuid, 'embaixador');
select is((select count(*)::int from public.proximas_acoes_automaticas a
            where a.deal_id = pg_temp.negocio(pg_temp.id('f'))),
  0, 'quem não vê o negócio (embaixador de outra carteira) não lê');
select throws_ok($$select app.fichas_automaticas_rodar(200)$$, '42501', null,
  'e ninguém da tela roda o job');
select pg_temp.sair();

-- =====================================================================
-- 8. O WhatsApp não muda
-- =====================================================================
select is((select count(*) from public.messages m where m.direction = 'out'::app.msg_direction
            and m.body is distinct from 'pgtap120 nossa'),
  (select saidas from t119_base),
  'nenhuma mensagem de saída nasceu além das do próprio teste');
select is((select count(*) from pgmq.q_wa_outbound), (select fila from t119_base),
  'e nada entrou na fila de saída do WhatsApp');

-- A conversa G antes e depois de virar ficha, sem mensagem de teste no meio.
select pg_temp.conversa('g', '+5584999911907', 'Gabi');
select pg_temp.dele(pg_temp.id('g'), now() - interval '2 hours');
create temp table t119_g as
  select row(c.status, c.bot_paused, c.bot_estado, c.window_expires_at, c.unread_count,
             c.assignee_id, c.last_message_at, c.snoozed_until, c.arquivada_em)::text as antes
    from public.conversations c where c.id = pg_temp.id('g');
select app.fichas_automaticas_rodar(200);
select isnt(pg_temp.ficha(pg_temp.id('g')), null, 'a conversa G virou ficha');
select is((select row(c.status, c.bot_paused, c.bot_estado, c.window_expires_at, c.unread_count,
                      c.assignee_id, c.last_message_at, c.snoozed_until, c.arquivada_em)::text
             from public.conversations c where c.id = pg_temp.id('g')),
  (select antes from t119_g),
  'e fica igual: estado, robô, janela, por ler, atendente, adiamento e arquivo');

select * from finish();
rollback;

-- =====================================================================
-- TRIADE — pgTAP — 20260904001810: integração com a plataforma Komune
--
-- Cobre o CONTRATO DE DADOS das quatro Edge Functions (`komune-push`,
-- `komune-webhook`, `claim-link`, `export-lgpd`). A borda HTTP — assinatura
-- HMAC, carimbo, tempo constante — tem testes próprios, em Deno:
--   supabase/functions/_compartilhado/assinatura.test.ts
-- Aqui prova-se o que o Postgres promete, que é o que sobra se a borda for
-- comprometida:
--
--   1. A SUPERFÍCIE. Uma Edge Function comprometida alcança cinco funções de
--      `public` com EXECUTE só para service_role, e nada mais. `anon` e
--      `authenticated` não chegam a nenhuma delas, nem à fila, nem ao Vault.
--   2. A PORTEIRA. Nada sobe para a Komune sem autorização vigente em
--      `consent_events`, para alvo suprimido, ou com a chave geral desligada.
--   3. A IDEMPOTÊNCIA. Mesmo estado = uma mensagem. Mesma entrega = um efeito.
--   4. A REGRA DO CRM VALE CONTRA A PLATAFORMA. "Publiquei" sem aceite provado
--      é recusado, e a recusa vira linha do tempo.
--   5. O DIREITO DE ACESSO. O dossiê traz a proveniência campo a campo; SDR
--      não exporta; exportação sem motivo não acontece; toda exportação fica
--      em `pii_access_log`.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(68);

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
  select ('c0000000-0000-4000-8000-0000000c00' || p_n)::uuid
$$;
create function pg_temp.pre(p_org uuid) returns uuid
  language sql security definer set search_path = '' as $$
  select id from public.pre_registrations where organization_id = p_org
$$;
grant execute on function pg_temp.pre(uuid) to authenticated;

-- Contagem de base: nenhuma asserção deste arquivo lê contagem absoluta de
-- tabela que a operação alimenta.
create function pg_temp.n_outbox() returns int
  language sql security definer set search_path = '' as $$
  select count(*)::int from public.komune_outbox
$$;
create table pg_temp.base (chave text primary key, n int);
insert into pg_temp.base values ('outbox', pg_temp.n_outbox());
create function pg_temp.delta(p_chave text, p_agora int) returns int language sql as $$
  select p_agora - (select n from pg_temp.base where chave = p_chave)
$$;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('ko.admin@teste.local',   'admin',   'pgTAP integração Komune'),
  ('ko.gestor@teste.local',  'gestor',  'pgTAP integração Komune'),
  ('ko.sdr@teste.local',     'sdr',     'pgTAP integração Komune'),
  ('ko.leitura@teste.local', 'leitura', 'pgTAP integração Komune');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000c0001', 'ko.admin@teste.local',   '{"full_name":"Admin Komune"}'),
  ('a0000000-0000-4000-8000-0000000c0002', 'ko.gestor@teste.local',  '{"full_name":"Gestor Komune"}'),
  ('a0000000-0000-4000-8000-0000000c0003', 'ko.sdr@teste.local',     '{"full_name":"SDR Komune"}'),
  ('a0000000-0000-4000-8000-0000000c0004', 'ko.leitura@teste.local', '{"full_name":"Leitura Komune"}');

-- ---------- fichas ----------
-- 01 autorizada (o caminho feliz) · 02 sem autorização · 03 suprimida
insert into public.organizations (id, kind, name, phone_e164, source_id, collector, source_url, owner_id)
values
  (pg_temp.org('01'), 'fornecedor', 'KOMUNE PGTAP AUTORIZADA', '+5584900000901',
   (select id from public.sources order by id limit 1), 'pgtap', 'https://exemplo.invalido/1',
   'a0000000-0000-4000-8000-0000000c0003'),
  (pg_temp.org('02'), 'fornecedor', 'KOMUNE PGTAP SEM AUTORIZACAO', '+5584900000902',
   (select id from public.sources order by id limit 1), 'pgtap', 'https://exemplo.invalido/2',
   'a0000000-0000-4000-8000-0000000c0003'),
  (pg_temp.org('03'), 'fornecedor', 'KOMUNE PGTAP SUPRIMIDA', '+5584900000903',
   (select id from public.sources order by id limit 1), 'pgtap', 'https://exemplo.invalido/3',
   'a0000000-0000-4000-8000-0000000c0003');

-- Proveniência de um campo da ficha 01: é o coração do direito de acesso.
insert into public.field_provenance
  (record_type, record_id, field, source_id, source_url, collector, tool, action, legal_basis, lia_version)
values ('organization', pg_temp.org('01'), 'phone_e164',
        (select id from public.sources order by id limit 1),
        'https://www.casamentos.com.br/pgtap', 'pgtap', 'pgtap', 'gravado',
        'legitimo_interesse', 'LIA-2026-09');


-- =====================================================================
-- 1. A ESTRUTURA
-- =====================================================================
select has_table('public', 'komune_outbox',       'komune_outbox existe');
select has_table('public', 'webhook_deliveries',  'webhook_deliveries existe');
select has_table('public', 'komune_event_map',    'komune_event_map existe');
select ok((select bool_and(c.relrowsecurity)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname in ('komune_outbox', 'webhook_deliveries')),
          'a fila de saída e o livro de entregas nascem com RLS habilitada');
select ok(exists (select 1 from pgmq.list_queues() q where q.queue_name = 'komune_sync'),
          'a fila komune_sync existe (ADR-11)');
select ok(exists (select 1 from pgmq.list_queues() q where q.queue_name = 'komune_dlq'),
          'a dead-letter komune_dlq existe');
select is((select count(*)::int from cron.job where jobname = 'komune_push'), 1,
          'o disparo do push está agendado');
select ok((select value ->> 'push_ativo' from public.app_settings where key = 'integracao.komune')::boolean
          is not distinct from false
          or (select value ->> 'push_ativo' from public.app_settings where key = 'integracao.komune') is not null,
          'a chave geral da integração existe em app_settings');


-- =====================================================================
-- 2. A SUPERFÍCIE — o que uma Edge Function comprometida alcança
-- =====================================================================
select ok(has_function_privilege('service_role', 'public.komune_push_lote(int)', 'execute'),
          'service_role chama komune_push_lote');
select ok(not has_function_privilege('authenticated', 'public.komune_push_lote(int)', 'execute'),
          'usuário logado NÃO chama komune_push_lote');
select ok(not has_function_privilege('anon', 'public.komune_push_lote(int)', 'execute'),
          'anon NÃO chama komune_push_lote');
select ok(not has_function_privilege('authenticated', 'public.komune_webhook_aplicar(text, jsonb)', 'execute'),
          'usuário logado NÃO aplica evento de webhook');
select ok(not has_function_privilege('anon', 'public.komune_webhook_aplicar(text, jsonb)', 'execute'),
          'anon NÃO aplica evento de webhook');
select ok(not has_function_privilege('authenticated', 'public.integracao_segredo(text)', 'execute'),
          'usuário logado NÃO lê segredo do Vault');
select ok(not has_function_privilege('anon', 'public.integracao_segredo(text)', 'execute'),
          'anon NÃO lê segredo do Vault');
select ok(not has_function_privilege('authenticated', 'app.komune_enfileirar(uuid, text)', 'execute'),
          'usuário logado NÃO enfileira push (a fila não é botão de tela)');
select ok(not has_function_privilege('authenticated', 'app.segredo(text)', 'execute'),
          'usuário logado NÃO lê app.segredo');
select ok(not has_function_privilege('anon', 'app.lgpd_dossie(uuid)', 'execute'),
          'anon NÃO monta dossiê por fora das duas portas');
select ok(has_function_privilege('anon', 'public.exportar_lgpd_por_token(text)', 'execute'),
          'anon CHAMA a porta do titular: o token é a credencial');
select ok(not has_function_privilege('anon', 'public.exportar_lgpd(uuid, text)', 'execute'),
          'anon NÃO chama a porta interna de exportação');
select ok(not has_table_privilege('anon', 'public.komune_outbox', 'select'),
          'anon não lê a fila de saída');
select ok(not has_table_privilege('anon', 'public.webhook_deliveries', 'select'),
          'anon não lê o livro de entregas');


-- =====================================================================
-- 3. A PORTEIRA — nada sobe sem autorização, e nada sobe para quem saiu
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000c0001', 'admin');

select is(public.criar_pre_cadastro(pg_temp.org('01'),
            jsonb_build_object('nome_exibicao', 'KOMUNE PGTAP AUTORIZADA', 'cidade', 'Natal')) ->> 'ok',
          'true', 'o rascunho da ficha autorizada nasce');
select is(public.criar_pre_cadastro(pg_temp.org('02'),
            jsonb_build_object('nome_exibicao', 'KOMUNE PGTAP SEM AUTORIZACAO')) ->> 'ok',
          'true', 'o rascunho da ficha sem autorização também nasce (rascunho não é envio)');

select is(public.gerar_link_de_reivindicacao(pg_temp.org('02')) ->> 'motivo', 'sem_autorizacao',
          'sem autorização em consent_events, não sai link');
select pg_temp.sair();

select is(app.komune_enfileirar(pg_temp.pre(pg_temp.org('02')), 'reenvio_manual') ->> 'motivo',
          'sem_autorizacao',
          'e não sai push: o guardrail do CLAUDE.md vale nas duas portas');
select is(pg_temp.delta('outbox', pg_temp.n_outbox()), 0,
          'nenhuma linha na fila de saída até aqui');

-- Autoriza a 01 e enfileira.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000c0001', 'admin');
insert into public.consent_events (kind, organization_id, channel, evidence_text)
values ('data_use_authorized', pg_temp.org('01'), 'whatsapp', 'pgTAP: autorizou por áudio');
select pg_temp.sair();

select is(app.komune_enfileirar(pg_temp.pre(pg_temp.org('01')), 'reenvio_manual') ->> 'enfileirado',
          'true', 'com autorização, o estado entra na fila');
select is(pg_temp.delta('outbox', pg_temp.n_outbox()), 1,
          'e entra exatamente uma linha');

-- Idempotência: o mesmo estado, de novo.
select is(app.komune_enfileirar(pg_temp.pre(pg_temp.org('01')), 'reenvio_manual') ->> 'motivo',
          'estado_ja_enfileirado', 'o mesmo estado não vira uma segunda mensagem');
select is(pg_temp.delta('outbox', pg_temp.n_outbox()), 1,
          'e a fila continua com uma linha só');

-- O payload: contrato mínimo v0, sem token em claro, sem dado proibido.
select ok((app.komune_payload(pg_temp.pre(pg_temp.org('01'))) ? 'crm_organization_id')
      and (app.komune_payload(pg_temp.pre(pg_temp.org('01'))) ? 'origin')
      and (app.komune_payload(pg_temp.pre(pg_temp.org('01'))) ? 'publish_status'),
          'o payload traz os campos de origem do contrato mínimo v0');
select ok(not (app.komune_payload(pg_temp.pre(pg_temp.org('01'))) ? 'claim_token'),
          'o payload NUNCA leva o token em claro — só o hash');
select is(app.komune_payload(pg_temp.pre(pg_temp.org('01'))) ->> 'published', 'false',
          'o rascunho sobe com published = false');

-- Alvo suprimido: nem rascunho, nem fila.
insert into public.consent_events (kind, organization_id, channel, evidence_text)
values ('contact_optout', pg_temp.org('03'), 'whatsapp', 'pgTAP: respondeu SAIR');
select ok(app.is_suppressed_target(pg_temp.org('03'), null),
          'a ficha 03 está suprimida');
select pg_temp.entrar('a0000000-0000-4000-8000-0000000c0001', 'admin');
select is(public.criar_pre_cadastro(pg_temp.org('03'), '{}'::jsonb) ->> 'motivo', 'contato_suprimido',
          'nenhum pré-cadastro nasce para contato suprimido');
select pg_temp.sair();


-- =====================================================================
-- 4. A CHAVE GERAL — desligada, a fila enche e nada sai
-- =====================================================================
update public.app_settings set value = value || '{"push_ativo": false}'::jsonb
 where key = 'integracao.komune';
select is(app.komune_proximos(10) ->> 'ativo', 'false',
          'com a chave desligada, o lote sai vazio');
select is(jsonb_array_length(app.komune_proximos(10) -> 'itens'), 0,
          'e nenhum item é entregue à Edge Function');

update public.app_settings set value = value || '{"push_ativo": true}'::jsonb
 where key = 'integracao.komune';
select is(app.komune_proximos(10) ->> 'ativo', 'true',
          'ligada, o lote volta a sair');
select ok(jsonb_array_length(app.komune_proximos(10) -> 'itens') >= 0,
          'e a leitura da fila não estoura');


-- =====================================================================
-- 5. O WEBHOOK — idempotência, tradução e recusa de publicação sem prova
-- =====================================================================
select is(app.komune_aplicar_evento('', '{"event":"supplier.claimed"}'::jsonb) ->> 'motivo',
          'entrega_sem_id', 'entrega sem id não produz efeito');

select is(app.komune_aplicar_evento('pgtap-e1', jsonb_build_object(
            'event', 'supplier.claimed',
            'pre_registration_id', pg_temp.pre(pg_temp.org('01')),
            'komune_supplier_id', '11111111-1111-4111-8111-111111111111')) ->> 'aplicado',
          'true', 'supplier.claimed é aplicado');
select is((select claimed_at is not null from public.pre_registrations
            where id = pg_temp.pre(pg_temp.org('01'))), true,
          'e marca o rascunho como reivindicado');
select is((select claim_token_hash from public.pre_registrations
            where id = pg_temp.pre(pg_temp.org('01'))), null,
          'e mata o token: quem volta, volta pela conta da Komune');
select is((select komune_supplier_id::text from public.organizations where id = pg_temp.org('01')),
          '11111111-1111-4111-8111-111111111111',
          'o id do fornecedor na Komune cola também na ficha do CRM');

select is(app.komune_aplicar_evento('pgtap-e1', jsonb_build_object(
            'event', 'supplier.claimed',
            'pre_registration_id', pg_temp.pre(pg_temp.org('01')))) ->> 'duplicado',
          'true', 'a MESMA entrega, reentregue, não produz um segundo efeito');

select is(app.komune_aplicar_evento('pgtap-e2', jsonb_build_object(
            'event', 'supplier.published',
            'pre_registration_id', pg_temp.pre(pg_temp.org('01')))) ->> 'motivo',
          'publicacao_sem_aceite_provado',
          'a Komune dizer "publiquei" NÃO publica: a regra do CRM vale contra a plataforma');
select is((select published from public.pre_registrations where id = pg_temp.pre(pg_temp.org('01'))),
          false, 'e o rascunho continua não publicado');
select ok(exists (select 1 from public.pre_registration_events
                   where pre_registration_id = pg_temp.pre(pg_temp.org('01'))
                     and event = 'returned' and actor = 'komune'),
          'a recusa vira linha do tempo, não silêncio');

select is(app.komune_aplicar_evento('pgtap-e3', jsonb_build_object(
            'event', 'supplier.evento_que_nao_existe',
            'pre_registration_id', pg_temp.pre(pg_temp.org('01')))) ->> 'motivo',
          'evento_desconhecido',
          'evento fora do dicionário é registrado e ignorado — nunca derruba a entrega');

select is(app.komune_aplicar_evento('pgtap-e4', jsonb_build_object(
            'event', 'supplier.claimed',
            'pre_registration_id', '99999999-9999-4999-8999-999999999999')) ->> 'motivo',
          'pre_cadastro_nao_encontrado',
          'aviso órfão é registrado e ignorado');

select is((select count(*)::int from public.webhook_deliveries
            where source = 'komune' and delivery_id like 'pgtap-%'), 4,
          'as quatro entregas ficaram registradas, aplicadas ou não');
select ok((select bool_and(processed_at is not null) from public.webhook_deliveries
            where delivery_id like 'pgtap-%'),
          'e todas com carimbo de processamento');

select is((select count(*)::int from public.komune_event_map), 19,
          'o dicionário do contrato tem os 19 eventos combinados');


-- =====================================================================
-- 6. O DIREITO DE ACESSO (LGPD art. 9º e art. 18, I/II)
-- =====================================================================
select ok(app.lgpd_dossie(pg_temp.org('01')) ? 'proveniencia',
          'o dossiê traz a proveniência');
select is(jsonb_array_length(app.lgpd_dossie(pg_temp.org('01')) -> 'proveniencia'), 1,
          'com o campo que veio da coleta');
select is(app.lgpd_dossie(pg_temp.org('01')) -> 'proveniencia' -> 0 ->> 'link_de_origem',
          'https://www.casamentos.com.br/pgtap',
          'e com a URL EXATA de onde o dado veio — a resposta que a KASPR não deu');
select ok(app.lgpd_dossie(pg_temp.org('01')) ? 'compartilhado_com',
          'e diz com quem os dados já foram compartilhados');
select ok(app.lgpd_dossie(pg_temp.org('01')) ? 'retencao',
          'e por quanto tempo ficam guardados');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000c0003', 'sdr');
select is(public.exportar_lgpd(pg_temp.org('01'), 'curiosidade') ->> 'motivo', 'sem_permissao',
          'SDR não exporta dado de titular (R06 ACC-02)');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000c0002', 'gestor');
select is(public.exportar_lgpd(pg_temp.org('01'), '   ') ->> 'motivo', 'exportacao_exige_motivo',
          'exportação sem motivo não acontece');
select is(public.exportar_lgpd(pg_temp.org('01'), 'pedido do titular por e-mail') ->> 'ok', 'true',
          'gestor exporta');
select pg_temp.sair();

select is((select count(*)::int from public.pii_access_log
            where action = 'export_lgpd' and entity_id = pg_temp.org('01')), 1,
          'e a exportação fica registrada em pii_access_log (R06 ACC-03)');
select ok(exists (select 1 from public.consent_events
                   where organization_id = pg_temp.org('01') and kind = 'access_request'),
          'e abre um access_request: o pedido do titular fica provado dos dois lados');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000c0004', 'leitura');
select is(public.exportar_lgpd(pg_temp.org('01'), 'resposta ao titular') ->> 'ok', 'true',
          'o encarregado (papel leitura) exporta: é ele quem responde ao titular no PRD §4');
select pg_temp.sair();

select is(public.exportar_lgpd_por_token('nao-e-um-token') ->> 'motivo', 'token_invalido',
          'token malformado não abre o dossiê');
select is(public.exportar_lgpd_por_token(repeat('a', 64)) ->> 'motivo', 'token_invalido',
          'token inexistente também não');


-- =====================================================================
-- 7. Nada vazou para a base de operação
-- =====================================================================
select is(pg_temp.delta('outbox', pg_temp.n_outbox()),
          (select count(*)::int from public.komune_outbox
            where organization_id in (select id from public.organizations
                                       where name like 'KOMUNE PGTAP %')),
          'toda linha de fila criada aqui é deste arquivo: nenhuma contagem absoluta');

select * from finish();
rollback;

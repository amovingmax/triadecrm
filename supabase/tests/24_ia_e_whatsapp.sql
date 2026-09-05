-- =====================================================================
-- TRIADE — pgTAP — 20260905000200: IA, WhatsApp e o human-in-the-loop
--
-- O que este arquivo trava, em uma frase cada:
--
--   1. CUSTO. `ai_runs` não existia, e por isso os US$ 4/mês medidos em
--      packages/prompts eram projeção. Aqui o custo é recalculado pelo
--      Postgres a partir dos tokens: o que o worker disser que gastou é
--      ignorado. E o alerta de orçamento tem DOIS níveis, porque num
--      orçamento de US$ 25 o de 80% do acumulado chega quando o mês
--      acabou — o que chega a tempo é o do RITMO.
--
--   2. APROVAÇÃO (ADR-05). "A IA classifica e redige, a PESSOA aprova"
--      deixa de ser frase: mensagem com `author_kind = 'bot_ai'` sem
--      rascunho aprovado por gente NÃO ENTRA na tabela. O worker, com a
--      chave de serviço, não consegue aprovar o próprio rascunho — ele
--      não tem `auth.uid()`, e a condição exige um.
--
--   3. SUPRIMIDO NUNCA RECEBE, E A REGRA VALE NA ENTREGA. É a lição da
--      migração 000100 (o dreno da Komune) aplicada onde o custo de errar
--      é maior: uma mensagem aprovada às 9h e entregue às 9h40 é
--      reconferida às 9h40. Prova-se com o ciclo inteiro — enfileira, o
--      mundo muda, drena — e prova-se também que a mensagem LEGÍTIMA
--      continua saindo, porque fechar tudo não é consertar nada.
--
--   4. TETO, JANELA DE HORÁRIO E JANELA DE 24 H. Inclusive a nota que
--      `app.toques_do_dia` deixou escrita em 001700 e que ninguém tinha
--      pago: o teto do RF-CON-10 é do NÚMERO, então a fila assistida
--      precisa somar no mesmo balde da cadência.
--
--   5. IDEMPOTÊNCIA DO WEBHOOK por `wa_message_id`, com o índice único
--      fazendo o trabalho — não um `if exists` que dois webhooks
--      simultâneos atravessam juntos.
--
--   6. RLS por papel nas quatro tabelas novas.
--
-- Toda asserção de contagem é DELTA sobre a base medida no início; nenhuma
-- lê contagem absoluta de tabela que a operação alimenta.
--
-- Datas fixas, para o teste não depender da hora em que roda:
--   2026-09-16 (quarta, dia útil) · 2026-09-13 (domingo) · 2026-09-07
--   (feriado da Independência, que está na tabela `holidays`).
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(94);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
-- O worker: chave de serviço, sem pessoa nenhuma por trás. É exatamente
-- este o sujeito que o ADR-05 proíbe de aprovar.
create function pg_temp.entrar_worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('e0000000-0000-4000-8000-0000000e00' || p_n)::uuid
$$;
create function pg_temp.gente(p_n text) returns uuid language sql as $$
  select ('b0000000-0000-4000-8000-0000000b00' || p_n)::uuid
$$;

-- Instantes fixos, em America/Fortaleza.
create function pg_temp.quarta_10h()  returns timestamptz language sql immutable as $$
  select (timestamp '2026-09-16 10:00') at time zone 'America/Fortaleza' $$;
create function pg_temp.quarta_20h()  returns timestamptz language sql immutable as $$
  select (timestamp '2026-09-16 20:00') at time zone 'America/Fortaleza' $$;
create function pg_temp.domingo_10h() returns timestamptz language sql immutable as $$
  select (timestamp '2026-09-13 10:00') at time zone 'America/Fortaleza' $$;
create function pg_temp.feriado_10h() returns timestamptz language sql immutable as $$
  select (timestamp '2026-09-07 10:00') at time zone 'America/Fortaleza' $$;

-- ---------- a base, para toda contagem virar delta ----------
create function pg_temp.n_msg()    returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.messages $$;
create function pg_temp.n_draft()  returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.message_drafts $$;
create function pg_temp.n_run()    returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.ai_runs $$;
create function pg_temp.n_conv()   returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.conversations $$;
create function pg_temp.n_alerta() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.ai_budget_alerts $$;
create table pg_temp.base (chave text primary key, n int);
insert into pg_temp.base values ('msg', pg_temp.n_msg()), ('draft', pg_temp.n_draft()),
                                ('run', pg_temp.n_run()), ('conv', pg_temp.n_conv()),
                                ('alerta', pg_temp.n_alerta());
create function pg_temp.delta(p_chave text, p_agora int) returns int language sql as $$
  select p_agora - (select n from pg_temp.base where chave = p_chave)
$$;

-- As filas são globais; esvaziá-las DENTRO desta transação (que desfaz tudo
-- no fim) é o que torna determinístico o lote que o dreno devolve.
delete from pgmq.q_wa_outbound;
delete from pgmq.q_wa_dlq;


-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('ia.admin@teste.local',      'admin',      'pgTAP ia_e_whatsapp'),
  ('ia.heloisa@teste.local',    'sdr',        'pgTAP ia_e_whatsapp'),
  ('ia.embaixador@teste.local', 'embaixador', 'pgTAP ia_e_whatsapp'),
  ('ia.leitura@teste.local',    'leitura',    'pgTAP ia_e_whatsapp'),
  ('ia.gestor@teste.local',     'gestor',     'pgTAP ia_e_whatsapp');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gente('01'), 'ia.admin@teste.local',      '{"full_name":"Admin IA"}'),
  (pg_temp.gente('02'), 'ia.heloisa@teste.local',    '{"full_name":"Heloisa IA"}'),
  (pg_temp.gente('03'), 'ia.embaixador@teste.local', '{"full_name":"Embaixador IA"}'),
  (pg_temp.gente('04'), 'ia.leitura@teste.local',    '{"full_name":"Leitura IA"}'),
  (pg_temp.gente('05'), 'ia.gestor@teste.local',     '{"full_name":"Gestor IA"}');

-- ---------- fichas ----------
--   01 legítima (carteira da Heloísa) · 02 vai pedir opt-out no meio
--   03 do embaixador (para a RLS) · 04 usada nos tetos
insert into public.organizations (id, kind, name, phone_e164, source_id, collector, source_url, owner_id)
select v.id, 'fornecedor', v.nome, v.fone,
       (select id from public.sources order by id limit 1), 'pgtap',
       'https://exemplo.invalido/ia', v.dono
  from (values
    (pg_temp.org('01'), 'IA PGTAP LEGITIMA',    '+5584900000901', pg_temp.gente('02')),
    (pg_temp.org('02'), 'IA PGTAP DESISTE',     '+5584900000902', pg_temp.gente('02')),
    (pg_temp.org('03'), 'IA PGTAP DO EMBAIXADOR','+5584900000903', pg_temp.gente('03')),
    (pg_temp.org('04'), 'IA PGTAP TETO',        '+5584900000904', pg_temp.gente('02'))
  ) as v(id, nome, fone, dono);


-- =====================================================================
-- 1. O CUSTO DEIXA DE SER PROJEÇÃO
-- =====================================================================
select is((select count(*)::int from public.ai_model_prices where model in ('claude-haiku-4-5','claude-sonnet-5')),
          2, 'os dois modelos do ADR-10 têm preço publicado');

-- Paridade com custoDaChamada() de packages/prompts: `resumo-ligacao@v1` no
-- documento de custos são 486 tokens de sistema + 268 de mensagem = 754 de
-- entrada e 101 de saída, a US$ 2/M e US$ 10/M → US$ 0,00252.
select is(app.ai_custo('claude-sonnet-5', 754, 101, 0, 0, false), 0.00252::numeric,
          'resumo-ligacao@v1 custa US$ 0,00252 — o mesmo número do documento de custos');
select is(app.ai_custo('claude-haiku-4-5', 1015, 55, 0, 0, false), 0.00129::numeric,
          'classificar-intencao@v1 custa US$ 0,00129, idem');
select is(app.ai_custo('claude-sonnet-5', 754, 101, 0, 0, true),
          round(app.ai_custo('claude-sonnet-5', 754, 101, 0, 0, false) / 2, 5),
          'a Batch API custa metade, dos dois lados');
-- Escrita e leitura de cache têm preços 12,5 vezes diferentes: é por isso
-- que são duas colunas, e não o `tokens_cached` único do esboço do R05.
select isnt(app.ai_custo('claude-sonnet-5', 0, 0, 1000000, 0, false),
            app.ai_custo('claude-sonnet-5', 0, 0, 0, 1000000, false),
            'escrita e leitura de cache não custam a mesma coisa — por isso são duas colunas');

select pg_temp.entrar_worker();
insert into public.ai_runs (purpose, model, prompt_version, organization_id,
                            tokens_in, tokens_out, cost_usd, latency_ms)
values ('summarize_call', 'claude-sonnet-5', 'resumo-ligacao@v1', pg_temp.org('01'),
        754, 101, 999.99, 1200);
select is((select cost_usd from public.ai_runs order by id desc limit 1), 0.00252::numeric,
          'o custo que o worker mandou (US$ 999,99) é IGNORADO: quem faz a conta é o Postgres');

-- Chamada bloqueada pelo guardrail de PII: houve decisão, não houve gasto.
insert into public.ai_runs (purpose, model, prompt_version, status, tokens_in, tokens_out, error)
values ('draft_followup', 'claude-sonnet-5', 'followup-ligacao@v1', 'bloqueado', 1200, 0,
        'PiiNaChamadaError: telefone do cadastro sobrou na mensagem montada');
select is((select cost_usd from public.ai_runs order by id desc limit 1), 0::numeric,
          'chamada BLOQUEADA pelo guardrail entra na tabela e custa zero — guardrail sem rastro é guardrail que ninguém sabe se funcionou');
select pg_temp.sair();

select throws_ok($$
  insert into public.ai_runs (purpose, model, prompt_version, tokens_in, tokens_out)
  values ('classify_inbound', 'gpt-nao-existe', 'classificar-intencao@v1', 10, 10) $$,
  '23503', NULL, 'modelo sem preço publicado não roda (o ADR-10 vira FK)');
select throws_ok($$
  insert into public.ai_runs (purpose, model, prompt_version, tokens_in, tokens_out)
  values ('inventar_coisa', 'claude-haiku-4-5', 'classificar-intencao@v1', 10, 10) $$,
  '23514', NULL, 'propósito fora da lista não entra: gasto que ninguém nomeou é gasto que ninguém orçou');
select throws_ok($$
  update public.ai_runs set tokens_in = 1 where id = (select max(id) from public.ai_runs) $$,
  '42501', NULL, 'ai_runs é append-only: custo que se edita não serve para auditar custo');
select lives_ok($$
  update public.ai_runs set output = null where id = (select max(id) from public.ai_runs) $$,
  'mas a retenção pode apagar a saída do modelo (PRD §10.6: 90 dias)');
select is(pg_temp.delta('run', pg_temp.n_run()), 2, 'duas chamadas registradas, e nenhuma a mais');


-- =====================================================================
-- 2. O ORÇAMENTO — e por que o alerta de 80% chega tarde
-- =====================================================================
-- Agosto de 2026 é usado como mês de referência porque o produto não
-- existia: o gasto de IA daquele mês é, e continuará sendo, zero. A
-- asserção abaixo é o que torna esta premissa visível se um dia mudar.
select is((app.ai_gasto_do_mes(date '2026-08-07') ->> 'gasto_usd')::numeric, 0::numeric,
          'agosto de 2026 não tem gasto de IA: o produto não existia');
select is((app.ai_gasto_do_mes(date '2026-08-07') ->> 'dias_uteis_decorridos')::int, 5,
          'e até 07/08/2026 haviam corrido 5 dias úteis');

create function pg_temp.gastar(p_usd numeric) returns void
  language sql security definer set search_path = '' as $$
  insert into public.ai_runs (purpose, model, prompt_version, tokens_in, tokens_out, created_at)
  values ('digest', 'claude-sonnet-5', 'resumo-ligacao@v1', round(p_usd * 500000)::int, 0,
          (timestamp '2026-08-05 10:00') at time zone 'America/Fortaleza')
$$;

select pg_temp.gastar(1);
select is(app.ai_gasto_do_mes(date '2026-08-07') ->> 'situacao', 'ok',
          'US$ 1 em 5 dias projeta US$ 4,20 no mês: dentro do orçamento');

select pg_temp.gastar(8);   -- total US$ 9
select is((app.ai_gasto_do_mes(date '2026-08-07') ->> 'projecao_do_mes_usd')::numeric, 37.80::numeric,
          'US$ 9 em 5 dias projeta US$ 37,80 — o exemplo do documento de custos, agora medido');
select is(app.ai_gasto_do_mes(date '2026-08-07') ->> 'situacao', 'ritmo_acima',
          'e a situação é ritmo_acima ANTES de o acumulado passar de 80%: é este o alerta que chega a tempo');
select ok((app.ai_gasto_do_mes(date '2026-08-07') ->> 'gasto_usd')::numeric
          < (app.ai_gasto_do_mes(date '2026-08-07') ->> 'limite_de_alerta_usd')::numeric,
          'no mesmo instante, o alerta do PRD (80% do acumulado) ainda estaria calado');

select pg_temp.gastar(12);  -- total US$ 21
select is(app.ai_gasto_do_mes(date '2026-08-07') ->> 'situacao', 'passou_de_80',
          'passado o acumulado de US$ 20, a situação vira passou_de_80');

-- O alerta do mês corrente: emitido uma vez, e não uma por execução do cron.
insert into public.ai_runs (purpose, model, prompt_version, tokens_in, tokens_out)
values ('digest', 'claude-sonnet-5', 'resumo-ligacao@v1', 12000000, 0);
select is(app.ai_alerta_orcamento() ->> 'alertou', 'true',
          'com o mês corrente estourado, o alerta é emitido');
select is(app.ai_alerta_orcamento() ->> 'motivo', 'ja_alertado',
          'e a segunda passada do cron não emite de novo: a chave (mês, situação) é a idempotência');
select is(pg_temp.delta('alerta', pg_temp.n_alerta()), 1,
          'uma linha de alerta, e uma só');
select ok(exists (select 1 from public.tasks t
                   where t.origin = 'system' and t.title like 'Orçamento de IA:%'),
          'e uma tarefa para uma pessoa: alerta que ninguém lê não é alerta');

select throws_ok($$
  update public.app_settings set value = jsonb_build_object('mensal_usd', 0, 'fracao_alerta', 0.8)
   where key = 'ia.orcamento' $$,
  '23514', NULL, 'orçamento zero seria desligar o alerta em silêncio: recusado');
select throws_ok($$
  update public.app_settings set value = jsonb_build_object('mensal_usd', 25, 'fracao_alerta', 3)
   where key = 'ia.orcamento' $$,
  '23514', NULL, 'fração de alerta fora de (0,1] também é recusada');


-- =====================================================================
-- 3. A CONVERSA — dono obrigatório e janela de 24 h
-- =====================================================================
insert into public.conversations (id, business_number, peer_phone_e164, organization_id, last_inbound_at)
values ('c0000000-0000-4000-8000-0000000c0001', '+5584988887777', '+5584900000901',
        pg_temp.org('01'), now() - interval '1 hour');
select is((select assignee_id from public.conversations where id = 'c0000000-0000-4000-8000-0000000c0001'),
          pg_temp.gente('02'),
          'conversa sem dono é impossível (RF-CON-04): o gatilho herdou o responsável da ficha');
select ok(app.janela_de_24h_aberta('c0000000-0000-4000-8000-0000000c0001'),
          'com mensagem recebida há 1 h, a janela de 24 h está aberta');

update public.conversations set last_inbound_at = now() - interval '30 hours'
 where id = 'c0000000-0000-4000-8000-0000000c0001';
select ok(not app.janela_de_24h_aberta('c0000000-0000-4000-8000-0000000c0001'),
          'passadas 30 h, ela fechou — e ninguém pode estendê-la digitando');
update public.conversations set last_inbound_at = now() - interval '1 hour'
 where id = 'c0000000-0000-4000-8000-0000000c0001';

-- A conversa da ficha do embaixador, para a RLS mais adiante.
insert into public.conversations (id, business_number, peer_phone_e164, organization_id, last_inbound_at)
values ('c0000000-0000-4000-8000-0000000c0003', '+5584988887777', '+5584900000903',
        pg_temp.org('03'), now() - interval '1 hour');
-- A da ficha que vai desistir no meio do caminho.
insert into public.conversations (id, business_number, peer_phone_e164, organization_id, last_inbound_at)
values ('c0000000-0000-4000-8000-0000000c0002', '+5584988887777', '+5584900000902',
        pg_temp.org('02'), now() - interval '1 hour');


-- =====================================================================
-- 4. A FILA DE APROVAÇÃO — o ADR-05 com dentes
-- =====================================================================
select pg_temp.entrar_worker();
insert into public.message_drafts (id, organization_id, conversation_id, kind,
                                   prompt_version, proposed_body)
values ('d0000000-0000-4000-8000-0000000d0001', pg_temp.org('01'),
        'c0000000-0000-4000-8000-0000000c0001', 'followup_ligacao',
        'followup-ligacao@v1', 'Oi! Foi bom falar com você agora. Te mando o link do cadastro?');
select pg_temp.sair();

select is((select status from public.message_drafts where id = 'd0000000-0000-4000-8000-0000000d0001'),
          'pendente', 'rascunho nasce pendente');

-- Um rascunho na carteira do embaixador, criado agora (antes de a ficha 03
-- pedir opt-out na seção 7), para a comparação de RLS ter os dois lados.
select pg_temp.entrar_worker();
insert into public.message_drafts (id, organization_id, conversation_id, kind, proposed_body)
values ('d0000000-0000-4000-8000-0000000d0003', pg_temp.org('03'),
        'c0000000-0000-4000-8000-0000000c0003', 'resposta', 'rascunho da carteira do embaixador');
select pg_temp.sair();

select throws_ok($$
  insert into public.message_drafts (organization_id, conversation_id, kind, proposed_body,
                                     status, reviewed_by, reviewed_at, final_body)
  values ('e0000000-0000-4000-8000-0000000e0001', 'c0000000-0000-4000-8000-0000000c0001',
          'resposta', 'ja nasce aprovado', 'aprovado',
          'b0000000-0000-4000-8000-0000000b0001', now(), 'ja nasce aprovado') $$,
  '23514', NULL, 'rascunho não nasce aprovado: a aprovação é ato posterior e de outra pessoa');

-- (3) QUEM APROVA É GENTE. Esta é a asserção que sustenta o ADR-05.
select pg_temp.entrar_worker();
select throws_ok($$
  update public.message_drafts
     set status = 'aprovado', reviewed_by = 'b0000000-0000-4000-8000-0000000b0002',
         final_body = 'Oi! Foi bom falar com você agora. Te mando o link do cadastro?'
   where id = 'd0000000-0000-4000-8000-0000000d0001' $$,
  '42501', NULL, 'O WORKER NÃO APROVA O PRÓPRIO RASCUNHO: automação não tem auth.uid() (ADR-05)');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.gente('04'), 'leitura');
select throws_ok($$ select public.aprovar_rascunho('d0000000-0000-4000-8000-0000000d0001', null) $$,
  '42501', NULL, 'papel "leitura" não aprova envio');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.gente('02'), 'sdr');
select throws_ok($$
  update public.message_drafts set proposed_body = 'reescrevi o que a IA disse'
   where id = 'd0000000-0000-4000-8000-0000000d0001' $$,
  '42501', NULL, 'o que a IA propôs é imutável: é a diferença entre proposto e enviado que melhora o prompt');

select is(public.aprovar_rascunho('d0000000-0000-4000-8000-0000000d0001',
                                  'Oi! Foi bom falar com você. Te mando o link do cadastro?') ->> 'foi_editado',
          'true', 'a Heloísa aprova com edição, e o banco registra que houve edição');
select pg_temp.sair();

select is((select proposed_body from public.message_drafts where id = 'd0000000-0000-4000-8000-0000000d0001'),
          'Oi! Foi bom falar com você agora. Te mando o link do cadastro?',
          'e o texto ORIGINAL da IA continua lá, ao lado do que a pessoa mandou');
select is((select reviewed_by from public.message_drafts where id = 'd0000000-0000-4000-8000-0000000d0001'),
          pg_temp.gente('02'), 'com nome de quem aprovou (RF-ADM-03)');

select pg_temp.entrar(pg_temp.gente('02'), 'sdr');
select throws_ok($$ select public.descartar_rascunho('d0000000-0000-4000-8000-0000000d0001', '  ') $$,
  '23514', NULL, 'descarte sem motivo não ensina nada ao prompt: recusado');
select pg_temp.sair();


-- =====================================================================
-- 5. NADA SAI SEM APROVAÇÃO
-- =====================================================================
select pg_temp.entrar_worker();

select throws_ok($$
  insert into public.messages (conversation_id, direction, author_kind, body)
  values ('c0000000-0000-4000-8000-0000000c0001', 'out', 'bot_ai', 'texto que a IA inventou') $$,
  '42501', NULL, 'MENSAGEM DE IA SEM RASCUNHO NÃO ENTRA NA TABELA (ADR-05, RF-CON-22)');

insert into public.message_drafts (id, organization_id, conversation_id, kind, proposed_body)
values ('d0000000-0000-4000-8000-0000000d0002', pg_temp.org('02'),
        'c0000000-0000-4000-8000-0000000c0002', 'resposta', 'rascunho que ninguem olhou ainda');
select throws_ok($$
  insert into public.messages (conversation_id, direction, author_kind, body, draft_id)
  values ('c0000000-0000-4000-8000-0000000c0002', 'out', 'bot_ai', 'rascunho que ninguem olhou ainda',
          'd0000000-0000-4000-8000-0000000d0002') $$,
  '42501', NULL, 'rascunho ainda PENDENTE também não sai: "aprovado" é o único estado que libera');

select throws_ok($$
  insert into public.messages (conversation_id, direction, author_kind, body, draft_id)
  values ('c0000000-0000-4000-8000-0000000c0001', 'out', 'bot_ai', 'um texto diferente do aprovado',
          'd0000000-0000-4000-8000-0000000d0001') $$,
  '42501', NULL, 'nem um texto diferente do que a pessoa aprovou: o corpo tem de ser exatamente o final_body');

select throws_ok($$
  insert into public.messages (conversation_id, direction, author_kind, body)
  values ('c0000000-0000-4000-8000-0000000c0001', 'out', 'system', 'mensagem do sistema qualquer') $$,
  '23514', NULL, 'saída com author_kind "system" só existe como confirmação de opt-out');

select throws_ok($$
  insert into public.messages (conversation_id, direction, author_kind, body)
  values ('c0000000-0000-4000-8000-0000000c0001', 'out', 'bot_fixed', 'texto fixo sem modelo aprovado') $$,
  '42501', NULL, 'texto fixo do robô sai por modelo aprovado ou por toque de cadência (RF-CON-22)');

insert into public.messages (id, conversation_id, direction, author_kind, body, draft_id, status)
values ('a1000000-0000-4000-8000-0000000a0001', 'c0000000-0000-4000-8000-0000000c0001', 'out',
        'bot_ai', 'Oi! Foi bom falar com você. Te mando o link do cadastro?',
        'd0000000-0000-4000-8000-0000000d0001', 'queued');
select pass('COM O RASCUNHO APROVADO POR GENTE, A MENSAGEM ENTRA — fechar tudo não seria conserto');
select is((select status from public.message_drafts where id = 'd0000000-0000-4000-8000-0000000d0001'),
          'enviado', 'e o rascunho fecha o ciclo: aprovado → enviado, com a mensagem na linha');
select is((select approved_by from public.messages where id = 'a1000000-0000-4000-8000-0000000a0001'),
          pg_temp.gente('02'),
          'a mensagem carrega quem aprovou, copiado do rascunho e não informado pelo worker');
select pg_temp.sair();


-- =====================================================================
-- 6. SUPRIMIDO NUNCA RECEBE — e a regra vale na ENTREGA
-- =====================================================================
-- A ficha 02 pede para sair depois de a conversa já existir. É a linha do
-- tempo da migração 000100, agora no canal em que o efeito é uma mensagem
-- no celular de quem disse não.
select app.suppress('phone', '+5584900000902', 'contact_optout', 'whatsapp'::app.channel, null);
select ok(app.is_suppressed_target(pg_temp.org('02'), null),
          'a ficha 02 está suprimida (pelo telefone, sem do_not_contact na ficha)');
select is(app.wa_motivo_de_recusa(pg_temp.org('02'), null, '+5584900000902'), 'contato_suprimido',
          'e a pergunta única responde: contato_suprimido');
select is(app.wa_motivo_de_recusa(pg_temp.org('01'), null, '+5584900000901'), null,
          'enquanto a 01 continua legítima');

select pg_temp.entrar_worker();
select throws_ok($$
  insert into public.messages (conversation_id, direction, author_kind, body, sent_by)
  values ('c0000000-0000-4000-8000-0000000c0002', 'out', 'human', 'oi, tudo bem?',
          'b0000000-0000-4000-8000-0000000b0002') $$,
  '42501', NULL, 'NENHUMA MENSAGEM SAI PARA CONTATO SUPRIMIDO, em nenhum modo');

-- Recebida de quem está suprimido ENTRA: é a prova do opt-out.
select lives_ok($$
  select app.wa_registrar_entrada('wamid.PGTAP.OPTOUT.1', '+5584988887777', '+5584900000902',
                                  'text', 'SAIR') $$,
  'mensagem RECEBIDA de contato suprimido entra: barrá-la apagaria a prova do próprio opt-out');

-- A confirmação única do RF-CON-19: a exceção declarada.
insert into public.messages (id, conversation_id, direction, author_kind, body,
                             optout_confirmation, status)
values ('a1000000-0000-4000-8000-0000000a0002', 'c0000000-0000-4000-8000-0000000c0002', 'out',
        'bot_fixed', 'Pronto, não te procuro mais. Obrigada!', true, 'sent');
select pass('a confirmação de opt-out do RF-CON-19 SAI, e é a única mensagem que atravessa o guardrail');
select throws_ok($$
  insert into public.messages (conversation_id, direction, author_kind, body,
                               optout_confirmation, status)
  values ('c0000000-0000-4000-8000-0000000c0002', 'out', 'bot_fixed', 'de novo?', true, 'sent') $$,
  '23505', NULL, '"confirmação única" é índice único, não boa intenção: a segunda é recusada');
select throws_ok($$
  insert into public.messages (conversation_id, direction, author_kind, body,
                               optout_confirmation, status)
  values ('c0000000-0000-4000-8000-0000000c0003', 'out', 'bot_ai', 'deixa eu explicar melhor...',
          true, 'sent') $$,
  '23514', NULL, 'e a confirmação de opt-out é texto fixo, nunca redigida por IA');

-- ---------------------------------------------------------------------
-- A LIÇÃO DO DRENO: aprovado às 9h não é permissão para as 9h40
-- ---------------------------------------------------------------------
-- A mensagem da ficha 01 está em `queued` desde antes. Agora a 01 pede para
-- sair, e a transição para `sent` é reconferida.
select app.suppress('phone', '+5584900000901', 'contact_optout', 'whatsapp'::app.channel, null);
select throws_ok($$
  update public.messages set status = 'sent', wa_message_id = 'wamid.PGTAP.NAODEVIA'
   where id = 'a1000000-0000-4000-8000-0000000a0001' $$,
  '42501', NULL,
  'A REGRA VALE NA ENTREGA: mensagem aprovada e enfileirada ANTES do opt-out não sai DEPOIS dele');
select pg_temp.sair();

-- Desfaz a supressão da 01 para o dreno ter um item legítimo a entregar.
delete from public.suppression_list where hash = app.sha256_hex(app.normalize_phone_br('+5584900000901'));
select is(app.wa_motivo_de_recusa(pg_temp.org('01'), null, '+5584900000901'), null,
          'a 01 volta a ser legítima (a supressão foi de teste)');


-- =====================================================================
-- 7. O DRENO — enfileira, o mundo muda, drena
-- =====================================================================
select pg_temp.entrar_worker();
-- Um envio legítimo para a 03 (que ninguém suprimiu) e o da 01, os dois na
-- janela de 24 h aberta.
insert into public.messages (id, conversation_id, direction, author_kind, body, sent_by, status)
values ('a1000000-0000-4000-8000-0000000a0003', 'c0000000-0000-4000-8000-0000000c0003', 'out',
        'human', 'oi! consegue falar hoje?', pg_temp.gente('03'), 'queued');

select is(app.wa_enfileirar_envio('a1000000-0000-4000-8000-0000000a0001') ->> 'enfileirado', 'true',
          'a mensagem da 01 entra na fila de saída');
select is(app.wa_enfileirar_envio('a1000000-0000-4000-8000-0000000a0003') ->> 'enfileirado', 'true',
          'a da 03 também');

-- O MUNDO MUDA depois da enfileirada: a 03 pede para sair.
select app.suppress('phone', '+5584900000903', 'contact_optout', 'whatsapp'::app.channel, null);

create table pg_temp.lote as select app.wa_proximos(50) as j;
create function pg_temp.saiu(p_msg uuid) returns boolean language sql as $$
  select exists (select 1 from pg_temp.lote l, jsonb_array_elements(l.j -> 'itens') i
                  where (i ->> 'message_id')::uuid = p_msg)
$$;
select ok(pg_temp.saiu('a1000000-0000-4000-8000-0000000a0001'),
          'O ITEM LEGÍTIMO CONTINUA SAINDO do dreno');
select ok(not pg_temp.saiu('a1000000-0000-4000-8000-0000000a0003'),
          'e o item de quem pediu para sair DEPOIS de entrar na fila não sai');
select is((select status from public.messages where id = 'a1000000-0000-4000-8000-0000000a0003'),
          'failed', 'ele não volta para a fila: morre, com o estado na linha');
select is((select error_detail from public.messages where id = 'a1000000-0000-4000-8000-0000000a0003'),
          'contato_suprimido', 'com o motivo por escrito, para a recusa não ser indistinguível de bug');
select is((select count(*)::int from pgmq.q_wa_outbound
                 where (message ->> 'message_id')::uuid = 'a1000000-0000-4000-8000-0000000a0003'), 0,
          'e a mensagem pgmq do recusado foi ARQUIVADA: sem isso ela voltaria a cada leitura, para sempre');
select is((select count(*)::int from pgmq.a_wa_outbound
                 where (message ->> 'message_id')::uuid = 'a1000000-0000-4000-8000-0000000a0003'), 1,
          'ela está no arquivo da fila, que é onde uma mensagem morta deve terminar');
select pg_temp.sair();


-- =====================================================================
-- 8. TETO, JANELA DE HORÁRIO E JANELA DE 24 H
-- =====================================================================
-- A conversa da ficha 04 fica FORA da janela de 24 h, que é o estado de
-- quem nunca respondeu — é nela que os tetos e a janela de horário valem.
insert into public.conversations (id, business_number, peer_phone_e164, organization_id, assignee_id)
values ('c0000000-0000-4000-8000-0000000c0004', '+5584988887777', '+5584900000904',
        pg_temp.org('04'), pg_temp.gente('02'));

select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c0004', true, false, pg_temp.quarta_10h())
            ->> 'motivo', 'sem_janela_e_sem_template',
          'fora da janela de 24 h, texto livre não sai: só template aprovado (regra da Meta, R04 §2.1)');
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c0004', true, true, pg_temp.quarta_10h())
            ->> 'pode', 'true',
          'com template aprovado, numa quarta às 10h, o primeiro contato pode sair');
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c0004', true, true, pg_temp.domingo_10h())
            ->> 'motivo', 'janela_domingo',
          'NUNCA DOMINGO (RF-CON-11)');
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c0004', true, true, pg_temp.feriado_10h())
            ->> 'motivo', 'janela_feriado',
          'NUNCA FERIADO — 07/09/2026 está na tabela holidays');
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c0004', true, true, pg_temp.quarta_20h())
            ->> 'motivo', 'janela_depois_do_fechamento',
          'e nunca às 20h: a janela do WhatsApp fecha às 18h (RF-CON-11)');
select ok((app.pode_enviar('c0000000-0000-4000-8000-0000000c0004', true, true, pg_temp.domingo_10h())
            ->> 'quando')::timestamptz > pg_temp.domingo_10h(),
          'e a recusa por janela devolve QUANDO tentar de novo — "agora não" não é "nunca mais"');
-- Uma conversa cuja janela de 24 h cobre a quarta às 20h, para provar que
-- responder fora do horário comercial continua permitido (RF-CON-11:
-- "respostas a quem escreveu: imediatas").
insert into public.conversations (id, business_number, peer_phone_e164, organization_id,
                                  assignee_id, last_inbound_at)
values ('c0000000-0000-4000-8000-0000000c0005', '+5584988887777', '+5584900000905',
        pg_temp.org('04'), pg_temp.gente('02'), pg_temp.quarta_10h());
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c0005', false, false, pg_temp.quarta_20h())
            ->> 'pode', 'true',
          'mas RESPONDER dentro da janela de 24 h é livre a qualquer hora: quem escreveu foi a pessoa');

-- ---------------------------------------------------------------------
-- O teto é do NÚMERO: a nota que app.toques_do_dia deixou escrita em 001700
-- ---------------------------------------------------------------------
create function pg_temp.usados() returns int language sql as $$
  select app.primeiros_contatos_do_dia('whatsapp'::app.channel, date '2026-09-16', '+5584988887777')
$$;
create table pg_temp.usados_antes as select pg_temp.usados() as n;

-- Os três primeiros contatos entram como ECO do celular — que é o modo
-- assistido do RF-CON-08: a Heloísa manda pelo WhatsApp Business App e o
-- Coexistence avisa. O eco não passa pela porteira (é registro do que já
-- aconteceu), mas GASTA o número, e é justamente isso que precisa contar.
select pg_temp.entrar_worker();
insert into public.messages (conversation_id, direction, author_kind, body, sent_by,
                             is_first_contact, status, sent_at, origin, wa_message_id)
select 'c0000000-0000-4000-8000-0000000c0004', 'out', 'human',
       'abertura ' || g, pg_temp.gente('02'), true, 'sent', pg_temp.quarta_10h(),
       'echo', 'wamid.PGTAP.ECO.' || g
  from generate_series(1, 3) g;
select pg_temp.sair();

select is(pg_temp.usados() - (select n from pg_temp.usados_antes), 3,
          'PRIMEIRO CONTATO FEITO FORA DA CADÊNCIA CONTA NO TETO — inclusive o eco do celular; a nota de 001700 está paga');
select is(app.toques_do_dia('whatsapp'::app.channel, date '2026-09-16')
          - (select n from pg_temp.usados_antes), 3,
          'e app.toques_do_dia, que a cadência inteira consulta, enxerga a mesma soma');

-- Baixa o teto do canal a 1 e prova que a porteira fecha.
update public.app_settings
   set value = jsonb_set(value, '{whatsapp}',
        jsonb_build_object('semana1', 1, 'semana2', 1, 'depois', 1, 'teto_duro', 1))
 where key = 'cadencia.tetos';
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c0004', true, true, pg_temp.quarta_10h())
            ->> 'motivo', 'teto_do_numero',
          'com o teto do número cheio, o primeiro contato para (RF-CON-10)');
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c0005', false, false, pg_temp.quarta_10h())
            ->> 'pode', 'true',
          'e o teto não atrapalha quem só está respondendo: o teto é de ABERTURAS');


-- =====================================================================
-- 9. IDEMPOTÊNCIA DO WEBHOOK
-- =====================================================================
create table pg_temp.entrada1 as
  select app.wa_registrar_entrada('wamid.PGTAP.IDEM.1', '+5584988887777', '+5584900000904',
                                  'text', 'oi, vi sua mensagem') as j;
create table pg_temp.entrada2 as
  select app.wa_registrar_entrada('wamid.PGTAP.IDEM.1', '+5584988887777', '+5584900000904',
                                  'text', 'oi, vi sua mensagem') as j;
select is((select j ->> 'novo' from pg_temp.entrada1), 'true', 'o webhook entrega uma mensagem nova');
select is((select j ->> 'novo' from pg_temp.entrada2), 'false',
          'e a REENTREGA do mesmo wamid não cria uma segunda: idempotência do RF-CON-03');
select is((select j ->> 'message_id' from pg_temp.entrada1),
          (select j ->> 'message_id' from pg_temp.entrada2),
          'as duas apontam para a mesma linha');
select is((select count(*)::int from public.messages where wa_message_id = 'wamid.PGTAP.IDEM.1'), 1,
          'uma linha, e uma só, para aquele wamid');
select throws_ok($$
  insert into public.messages (conversation_id, direction, type, status, wa_message_id, body, author_kind)
  values ('c0000000-0000-4000-8000-0000000c0004', 'in', 'text', 'received',
          'wamid.PGTAP.IDEM.1', 'de novo', 'system') $$,
  '23505', NULL, 'e quem tentar por fora esbarra no ÍNDICE ÚNICO, que dois webhooks simultâneos não atravessam');
select ok(app.janela_de_24h_aberta('c0000000-0000-4000-8000-0000000c0004'),
          'a mensagem recebida abriu a janela de 24 h dessa conversa');
select is((select unread_count from public.conversations where id = 'c0000000-0000-4000-8000-0000000c0004'),
          1, 'e o fio contou a mensagem não lida');


-- =====================================================================
-- 10. RLS POR PAPEL
-- =====================================================================
create function pg_temp.vejo_conv(p_id uuid) returns boolean
  language sql as $$ select exists (select 1 from public.conversations c where c.id = p_id) $$;
create function pg_temp.vejo_runs() returns int
  language sql as $$ select count(*)::int from public.ai_runs $$;
create function pg_temp.vejo_draft(p_id uuid) returns boolean
  language sql as $$ select exists (select 1 from public.message_drafts d where d.id = p_id) $$;

select pg_temp.entrar(pg_temp.gente('03'), 'embaixador');
select ok(pg_temp.vejo_conv('c0000000-0000-4000-8000-0000000c0003'),
          'o embaixador vê a conversa da ficha da carteira dele');
select ok(not pg_temp.vejo_conv('c0000000-0000-4000-8000-0000000c0004'),
          'e não vê a conversa de ficha alheia');
select is(pg_temp.vejo_runs(), 0, 'embaixador não vê ai_runs: custo é assunto de quem responde por dinheiro');
select ok(pg_temp.vejo_draft('d0000000-0000-4000-8000-0000000d0003'),
          'vê o rascunho da ficha dele');
select ok(not pg_temp.vejo_draft('d0000000-0000-4000-8000-0000000d0001'),
          'e não vê rascunho de ficha alheia');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.gente('05'), 'gestor');
select ok(pg_temp.vejo_runs() > 0, 'o gestor vê ai_runs');
select ok(pg_temp.vejo_conv('c0000000-0000-4000-8000-0000000c0004'), 'e vê todas as conversas');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.gente('02'), 'sdr');
select is(pg_temp.vejo_runs(), 0, 'o sdr trabalha sem ver custo de IA');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.gente('04'), 'leitura');
select throws_ok($$
  insert into public.messages (conversation_id, direction, author_kind, body, sent_by)
  values ('c0000000-0000-4000-8000-0000000c0001', 'out', 'human', 'oi',
          'b0000000-0000-4000-8000-0000000b0004') $$,
  '42501', NULL, 'papel "leitura" não manda mensagem');
select pg_temp.sair();


-- =====================================================================
-- 11. AS FILAS
-- =====================================================================
select is((select dlq from public.ingest_queues where name = 'wa_outbound'), 'wa_dlq',
          'a fila de saída do WhatsApp tem dead-letter PRÓPRIA: mensagem morta na DLQ do Radar é mensagem que ninguém acha');
select is((select dlq from public.ingest_queues where name = 'ingest_dlq'), null,
          'e a dead-letter não tem dead-letter: DLQ que reenfileira em si mesma é laço');
select ok((select count(*)::int from pgmq.list_queues()
            where queue_name in ('wa_inbound', 'wa_outbound', 'ai_jobs', 'wa_dlq', 'ai_dlq')) = 5,
          'as cinco filas dos dois workers existem no pgmq');

-- Uma falha além do teto vai para a dead-letter certa.
select app.esteira_enfileirar('wa_outbound', jsonb_build_object('message_id', gen_random_uuid()), 'pgtap-dlq');
select is(app.esteira_falhar('wa_outbound',
            (select msg_id from pgmq.q_wa_outbound order by msg_id desc limit 1),
            'pgtap-dlq', 'falhou de propósito') ->> 'acao', 'reagendado',
          'a primeira falha reagenda com backoff');

select * from finish();
rollback;

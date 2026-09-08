-- =====================================================================
-- pgTAP — A tabulação da ligação enfileira o resumo
--         (migração 20260906000100_resumo_da_ligacao_enfileirado.sql)
--
-- O pendente estava escrito no CHANGELOG desde o D10: "ninguém enfileira
-- `ai_jobs` sozinho ainda... a tabulação da ligação deveria enfileirar
-- `summarize_call`". Sem esse gatilho, `resumo-ligacao` e `followup-ligacao`
-- — dois dos quatro prompts, com evals e custo medido — nunca rodam, porque
-- `draft_followup` nasce de dentro do `summarize_call`.
--
-- A porta é ESTREITA de propósito. `app.ia_enfileirar` continua fora do
-- alcance de `authenticated` (qualquer propósito, qualquer payload, gasto que
-- ninguém orçou); quem a tela alcança é `app.ia_enfileirar_resumo(attempt)`,
-- que só sabe fazer uma coisa e faz as cinco perguntas antes:
--
--   1. a tentativa existe e está encerrada?
--   2. alguém atendeu? (sem atendimento não há conversa a resumir, e é a
--      premissa de custo do CHAMADAS_POR_MES em packages/prompts)
--   3. o roteiro foi percorrido? (caminho vazio é o que o worker recusa)
--   4. tem atividade? (é onde o resumo vai ser lido)
--   5. o alvo está suprimido? (RF-CON-18: quem pediu para sair não vira
--      chamada paga — a mesma pergunta que o worker refaz na entrega)
--
-- As cinco recusas devolvem motivo NOMEADO, porque "não enfileirou" sem
-- motivo é a mesma coisa que silêncio.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada: toda
-- contagem é delta ou escopo por id. Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(29);

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
create function pg_temp.funil(p_slug text) returns int language sql as $$
  select id from public.pipelines where slug = p_slug
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_slug
$$;
create function pg_temp.desfecho(p_slug text) returns int language sql as $$
  select id from public.interaction_outcomes where slug = p_slug
$$;
create function pg_temp.hoje() returns date language sql as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;

-- ---------- leituras FORA da RLS (o padrão de 01_rls_por_papel) ----------
create function pg_temp.n_ai_jobs() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from pgmq.q_ai_jobs
$$;
create function pg_temp.resumo_na_fila(p_attempt uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select q.message from pgmq.q_ai_jobs q
   where q.message ->> 'purpose' = 'summarize_call'
     and q.message ->> 'attempt_id' = p_attempt::text
   order by q.msg_id limit 1
$$;
create function pg_temp.n_resumos_na_fila(p_attempt uuid) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from pgmq.q_ai_jobs q
   where q.message ->> 'purpose' = 'summarize_call'
     and q.message ->> 'attempt_id' = p_attempt::text
$$;
create function pg_temp.n_dedup(p_chave text) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from public.ingest_dedup
   where queue = 'ai_jobs' and idempotency_key = p_chave
$$;

create table pg_temp.r (chave text primary key, valor jsonb);
create table pg_temp.base (chave text primary key, n int);
grant select on pg_temp.r, pg_temp.base to authenticated;

-- ---------- gente ----------
insert into public.allowed_users (email, role, note) values
  ('c35.sdr@teste.local',     'sdr',     'pgTAP resumo enfileirado'),
  ('c35.leitura@teste.local', 'leitura', 'pgTAP resumo enfileirado');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000035a1', 'c35.sdr@teste.local',     '{"full_name":"SDR Resumo"}'),
  ('a0000000-0000-4000-8000-0000000035a2', 'c35.leitura@teste.local', '{"full_name":"Leitura Resumo"}');

-- ---------- parceiros (categoria própria: o lote é determinístico) ----------
insert into public.categories (id, slug, name, "group", priority, position)
values (935, 'c35_teste', 'Categoria de teste do resumo enfileirado', 'servicos', 2, 935);
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind)
select ('c0000000-0000-4000-8000-0000000035' || lpad(i::text, 2, '0'))::uuid,
       'C35 Buffet ' || i, '+558499935' || lpad(i::text, 4, '0'), 'Tirol',
       (select id from public.sources where slug = 'planilha'), 'fornecedor'
  from generate_series(1, 8) i;
insert into public.organization_categories (organization_id, category_id, is_primary)
select id, 935, true from public.organizations where name like 'C35 Buffet %';
insert into public.deals (organization_id, pipeline_id, stage_id)
select o.id, pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado')
  from public.organizations o where o.name like 'C35 Buffet %';

-- ---------- a janela abre o dia inteiro DENTRO da transação ----------
-- Sem isto a suíte passaria numa terça às 10h e falharia num domingo — e hoje,
-- 06/09/2026, é domingo. Que o fluxo consulta a janela de verdade está provado no 13.
create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select h.de, h.ate from (values (0, 0::numeric, 24::numeric), (1, 0::numeric, 24::numeric),
    (2, 0::numeric, 24::numeric), (3, 0::numeric, 24::numeric), (4, 0::numeric, 24::numeric),
    (5, 0::numeric, 24::numeric), (6, 0::numeric, 24::numeric)) as h(dow, de, ate) where h.dow = p_dow
$$;
create temporary table feriado_de_hoje as
  select * from public.holidays where date = pg_temp.hoje();
delete from public.holidays where date = pg_temp.hoje();


-- =====================================================================
-- 1. A porta estreita existe, e a larga continua fechada
-- =====================================================================
select has_function('app', 'ia_enfileirar_resumo', array['uuid'],
  'app.ia_enfileirar_resumo(uuid) existe: a tabulação não fala com a fila da IA por uma porta genérica');
select ok(not has_function_privilege('authenticated',
            'app.ia_enfileirar(text,jsonb,text)', 'execute'),
  'a porta LARGA continua fora do alcance de authenticated (qualquer propósito, qualquer payload)');
select ok(has_function_privilege('authenticated',
            'app.ia_enfileirar_resumo(uuid)', 'execute'),
  'a porta ESTREITA é a única que a tela alcança — e ela só sabe pedir o resumo de uma tentativa');


-- =====================================================================
-- 2. O caminho feliz: atendeu, percorreu o roteiro, o resumo entra na fila
-- =====================================================================
insert into pg_temp.base values ('antes_a', pg_temp.n_ai_jobs());
do $$
declare v_lote uuid; v_item uuid; v_ch jsonb; v jsonb; v_key uuid := gen_random_uuid();
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000035a1', 'sdr');
  v := public.montar_lote('C35 resumo', pg_temp.funil('fornecedor'), 'frio',
         (select id from public.call_scripts where slug = 'captacao_v1' and is_published),
         array[935], 'prioridade', 6, 3, 20, null, pg_temp.hoje(), pg_temp.hoje());
  v_lote := (v ->> 'lote_id')::uuid;
  v      := public.proximo_da_fila(v_lote);
  v_item := (v -> 'item' ->> 'id')::uuid;
  v_ch   := public.iniciar_chamada(v_item);
  v := public.tabular_chamada(v_key, (v_ch -> 'chamada' ->> 'id')::uuid, v_item,
         'atendida_humano', 'decisor', pg_temp.desfecho('lig_atendeu_retorna'),
         array['abertura','gancho_fornecedor','forn_proposta'], 184,
         'gostou, pediu para ligar na quinta', '{}'::jsonb, null, null, null, null, false);
  execute 'reset role';
  insert into pg_temp.r values ('lote', jsonb_build_object('id', v_lote, 'key', v_key));
  insert into pg_temp.r values ('feliz', v);
end $$;
select pg_temp.sair();

select is((select valor ->> 'tabulado' from pg_temp.r where chave = 'feliz'), 'true',
  'caminho feliz: a tabulação passou');
select is((select valor ->> 'resumo_enfileirado' from pg_temp.r where chave = 'feliz'), 'true',
  'caminho feliz: e o retorno DIZ que o resumo foi enfileirado — enfileirar em silêncio é o mesmo que não enfileirar');
select is(pg_temp.n_ai_jobs() - (select n from pg_temp.base where chave = 'antes_a'), 1,
  'caminho feliz: exatamente UMA mensagem nova em ai_jobs (nem zero, nem duas)');
select is(pg_temp.n_resumos_na_fila(((select valor ->> 'attempt_id' from pg_temp.r where chave = 'feliz'))::uuid), 1,
  'caminho feliz: e ela é o summarize_call DESTA tentativa');
select is((select pg_temp.resumo_na_fila(((select valor ->> 'attempt_id' from pg_temp.r where chave = 'feliz'))::uuid) ->> 'chave'),
          'attempt:' || (select valor ->> 'attempt_id' from pg_temp.r where chave = 'feliz'),
  'contrato do worker: a chave de idempotência viaja DENTRO do payload (sem ela o worker não sabe qual mensagem concluir)');
select is(pg_temp.n_dedup('summarize_call:attempt:' ||
            (select valor ->> 'attempt_id' from pg_temp.r where chave = 'feliz')), 1,
  'a chave "<propósito>:<chave>" está fechada em ingest_dedup: resumir duas vezes é pagar duas vezes');


-- =====================================================================
-- 3. Ninguém atendeu: não há conversa a resumir (e é a premissa de custo)
-- =====================================================================
insert into pg_temp.base values ('antes_b', pg_temp.n_ai_jobs());
do $$
declare v_lote uuid; v_item uuid; v_ch jsonb; v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000035a1', 'sdr');
  v_lote := ((select valor ->> 'id' from pg_temp.r where chave = 'lote'))::uuid;
  v      := public.proximo_da_fila(v_lote);
  v_item := (v -> 'item' ->> 'id')::uuid;
  v_ch   := public.iniciar_chamada(v_item);
  v := public.tabular_chamada(gen_random_uuid(), (v_ch -> 'chamada' ->> 'id')::uuid, v_item,
         'nao_atendeu', 'nao_informado', null, '{}', 12,
         null, '{}'::jsonb, null, null, null, null, false);
  execute 'reset role';
  insert into pg_temp.r values ('nao_atendeu', v);
end $$;
select pg_temp.sair();

select is((select valor ->> 'tabulado' from pg_temp.r where chave = 'nao_atendeu'), 'true',
  'não atendeu: a tabulação passa normalmente');
select is((select valor ->> 'resumo_enfileirado' from pg_temp.r where chave = 'nao_atendeu'), 'false',
  'não atendeu: e o resumo NÃO é enfileirado — lig_nao_atendeu é tabulação automática, sem texto e sem modelo');
select is(pg_temp.n_ai_jobs() - (select n from pg_temp.base where chave = 'antes_b'), 0,
  'não atendeu: nenhuma mensagem nova em ai_jobs');


-- =====================================================================
-- 4. Atendeu, mas ninguém percorreu o roteiro: o worker recusaria
-- =====================================================================
-- É o mesmo `caminho_vazio` de resumirLigacao (apps/workers/src/ia/tarefas.ts).
-- Enfileirar aqui seria pagar uma volta de fila para ouvir "não".
insert into pg_temp.base values ('antes_c', pg_temp.n_ai_jobs());
do $$
declare v_lote uuid; v_item uuid; v_ch jsonb; v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000035a1', 'sdr');
  v_lote := ((select valor ->> 'id' from pg_temp.r where chave = 'lote'))::uuid;
  v      := public.proximo_da_fila(v_lote);
  v_item := (v -> 'item' ->> 'id')::uuid;
  v_ch   := public.iniciar_chamada(v_item);
  v := public.tabular_chamada(gen_random_uuid(), (v_ch -> 'chamada' ->> 'id')::uuid, v_item,
         'atendida_humano', 'decisor', pg_temp.desfecho('lig_agora_nao'),
         '{}', 55, 'anotou na mão, sem roteiro', '{}'::jsonb, null, null, null, null, false);
  execute 'reset role';
  insert into pg_temp.r values ('sem_caminho', v);
end $$;
select pg_temp.sair();

select is((select valor ->> 'tabulado' from pg_temp.r where chave = 'sem_caminho'), 'true',
  'sem caminho: a tabulação passa (o roteiro não é obrigatório)');
select is((select valor ->> 'resumo_enfileirado' from pg_temp.r where chave = 'sem_caminho'), 'false',
  'sem caminho: mas o resumo não entra na fila — é o mesmo caminho_vazio que o worker recusa');
select is(pg_temp.n_ai_jobs() - (select n from pg_temp.base where chave = 'antes_c'), 0,
  'sem caminho: nenhuma mensagem nova em ai_jobs');


-- =====================================================================
-- 5. Pediu para sair na própria ligação: o guardrail vem antes do gasto
-- =====================================================================
-- RF-CON-18. A tabulação aceita, o opt-out é registrado — e a IA não é chamada.
insert into pg_temp.base values ('antes_d', pg_temp.n_ai_jobs());
do $$
declare v_lote uuid; v_item uuid; v_org uuid; v_ch jsonb; v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000035a1', 'sdr');
  v_lote := ((select valor ->> 'id' from pg_temp.r where chave = 'lote'))::uuid;
  v      := public.proximo_da_fila(v_lote);
  v_item := (v -> 'item' ->> 'id')::uuid;
  v_org  := (v -> 'item' ->> 'organization_id')::uuid;
  v_ch   := public.iniciar_chamada(v_item);
  v := public.tabular_chamada(gen_random_uuid(), (v_ch -> 'chamada' ->> 'id')::uuid, v_item,
         'atendida_humano', 'decisor', pg_temp.desfecho('lig_agora_nao'),
         array['abertura','forn_proposta','fim_agora_nao'], 77,
         'não me ligue mais', '{}'::jsonb, null, null, null, null, true);
  execute 'reset role';
  insert into pg_temp.r values ('optout', v || jsonb_build_object('_org', v_org));
end $$;
select pg_temp.sair();

select is((select valor ->> 'tabulado' from pg_temp.r where chave = 'optout'), 'true',
  'opt-out: a tabulação passa');
select is((select valor ->> 'optout_registrado' from pg_temp.r where chave = 'optout'), 'true',
  'opt-out: o pedido foi registrado');
select is((select valor ->> 'resumo_enfileirado' from pg_temp.r where chave = 'optout'), 'false',
  'opt-out: e a IA NÃO é chamada para quem acabou de pedir para sair (RF-CON-18)');
select is(pg_temp.n_ai_jobs() - (select n from pg_temp.base where chave = 'antes_d'), 0,
  'opt-out: nenhuma mensagem nova em ai_jobs — o guardrail vem ANTES do gasto, não depois');
select is(pg_temp.n_resumos_na_fila(((select valor ->> 'attempt_id' from pg_temp.r where chave = 'optout'))::uuid), 0,
  'opt-out: e nada com o attempt_id dele na fila');


-- =====================================================================
-- 6. Idempotência: a fila offline reenvia a mesma tabulação
-- =====================================================================
-- `tabular_chamada` já devolve `repetido` para a mesma client_key. O que este
-- bloco prova é que o reenvio não gera uma SEGUNDA chamada paga.
insert into pg_temp.base values ('antes_e', pg_temp.n_ai_jobs());
do $$
declare v jsonb; v_att uuid;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000035a1', 'sdr');
  v_att := ((select valor ->> 'attempt_id' from pg_temp.r where chave = 'feliz'))::uuid;
  v := public.tabular_chamada(
         ((select valor ->> 'key' from pg_temp.r where chave = 'lote'))::uuid,
         v_att,
         (select item_id from public.call_attempts where id = v_att),
         'atendida_humano', 'decisor', pg_temp.desfecho('lig_atendeu_retorna'),
         array['abertura','gancho_fornecedor','forn_proposta'], 184,
         'gostou, pediu para ligar na quinta', '{}'::jsonb, null, null, null, null, false);
  execute 'reset role';
  insert into pg_temp.r values ('repetida', v);
end $$;
select pg_temp.sair();

select is((select valor ->> 'repetido' from pg_temp.r where chave = 'repetida'), 'true',
  'idempotência: o reenvio da mesma client_key é reconhecido como repetido');
select is(pg_temp.n_ai_jobs() - (select n from pg_temp.base where chave = 'antes_e'), 0,
  'idempotência: e NÃO gera uma segunda chamada paga');
select is(pg_temp.n_resumos_na_fila(((select valor ->> 'attempt_id' from pg_temp.r where chave = 'feliz'))::uuid), 1,
  'idempotência: continua exatamente um summarize_call para aquela tentativa');


-- =====================================================================
-- 7. A porta estreita, chamada direto: as recusas nomeadas
-- =====================================================================
insert into pg_temp.base values ('antes_f', pg_temp.n_ai_jobs());

-- 7.1 quem não escreve não gasta
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000035a2', 'leitura');
  v := app.ia_enfileirar_resumo(((select valor ->> 'attempt_id' from pg_temp.r where chave = 'feliz'))::uuid);
  execute 'reset role';
  insert into pg_temp.r values ('leitura', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'enfileirado' from pg_temp.r where chave = 'leitura'), 'false',
  'porta estreita: quem não escreve no CRM não enfileira chamada paga');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'leitura'), 'sem_permissao',
  'porta estreita: com motivo nomeado');

-- 7.2 tentativa que não existe
select is(app.ia_enfileirar_resumo('00000000-0000-4000-8000-000000000000'::uuid) ->> 'motivo',
          'tentativa_inexistente',
  'porta estreita: tentativa inexistente não vira mensagem na fila');

-- 7.3 tentativa ainda aberta (a chamada não terminou)
do $$
declare v_lote uuid; v_item uuid; v_ch jsonb; v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000035a1', 'sdr');
  v_lote := ((select valor ->> 'id' from pg_temp.r where chave = 'lote'))::uuid;
  v      := public.proximo_da_fila(v_lote);
  v_item := (v -> 'item' ->> 'id')::uuid;
  v_ch   := public.iniciar_chamada(v_item);
  v := app.ia_enfileirar_resumo((v_ch -> 'chamada' ->> 'id')::uuid);
  execute 'reset role';
  insert into pg_temp.r values ('aberta', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'aberta'), 'tentativa_aberta',
  'porta estreita: chamada que ainda não terminou não tem o que resumir');

select is(pg_temp.n_ai_jobs() - (select n from pg_temp.base where chave = 'antes_f'), 0,
  'porta estreita: nenhuma das três recusas pôs mensagem na fila');


-- =====================================================================
-- 8. O gasto tem dono declarado
-- =====================================================================
select is((select obj_description('app.ia_enfileirar_resumo(uuid)'::regprocedure, 'pg_proc') is not null)::text,
          'true',
  'a porta estreita tem comentário: quem lê o schema descobre por que ela existe sem abrir o git');

select * from finish();
rollback;

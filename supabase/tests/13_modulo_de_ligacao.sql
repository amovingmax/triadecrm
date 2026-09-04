-- =====================================================================
-- pgTAP — Módulo de prospecção ativa por ligação (migração 20260904001300)
--   public.montar_lote · public.proximo_da_fila · public.iniciar_chamada
--   · public.tabular_chamada · public.devolver_item_do_lote
--   · app.call_window · app.outcome_for_call_result · app.validar_roteiro
--
-- O que este arquivo tem de provar, e por quê:
--   1. RESERVA — são duas pessoas ligando da mesma base de 66 telefones. Se o
--      contato do lote do Matheus puder entrar no lote da Heloísa, os dois ligam
--      para o mesmo buffet no mesmo dia (R13 §3.1).
--   2. TRAVA DA FILA — puxar duas vezes nunca devolve o mesmo contato.
--   3. JANELA — domingo, feriado e fora de hora recusam NO BANCO, com motivo
--      nomeado (R13 §6). A tela é a primeira barreira e nunca a única.
--   4. SUPRIMIDO — não entra na montagem e, se pedir opt-out DEPOIS de o lote
--      estar montado, sai do lote em vez de ser entregue (RF-CON-18).
--   5. TABULAÇÃO — a consequência é a do catálogo: etapa e temperatura saem de
--      public.registrar_contato, não de código novo.
--   6. RLS por papel, incluindo o telefone que a cópia do lote NÃO pode revelar
--      a quem não o lê na base (RF-BAS-14).
--
-- Sobre a janela e o relógio: `app.call_window` é testada com instantes fixos
-- (domingo, 07/09, 7h, 15h, 21h), que é onde a REGRA vive. Para o fluxo, a tabela
-- de horários `app.call_window_hours` é substituída DENTRO da transação — sem
-- isso, a suíte passaria às 15h e falharia às 3h, que é o pior tipo de teste. Que
-- o fluxo realmente consulta a janela fica provado pelos dois testes em que ela
-- recusa: feriado de hoje e faixa fechada.
--
-- Roda em transação e desfaz tudo. As organizações do teste têm categoria própria
-- e o lote é montado com filtro por ela.
--
-- SOBRE CONTAGEM (conserto do achado D5): este cabeçalho AFIRMAVA que nada aqui
-- dependia de contagem absoluta, e quatro asserções dependiam — pii_access_log,
-- activities, v_call_script_steps e call_batches eram contadas na base INTEIRA.
-- Elas passavam em banco virgem e ficavam vermelhas na primeira ligação de
-- verdade: com três lotes e doze chamadas do Matheus no banco local, o arquivo
-- reprovava 4 de 91 sem que nada do módulo tivesse mudado. Toda contagem em
-- tabela que a operação alimenta agora é DELTA contra uma base lida FORA da RLS
-- (pg_temp.n_*, o mesmo padrão de pg_temp.total_negocios em 01_rls_por_papel).
-- =====================================================================
begin;
select plan(92);

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
create function pg_temp.desfecho(p_slug text) returns int language sql as $$
  select id from public.interaction_outcomes where slug = p_slug
$$;
create function pg_temp.etapa_de(p_org uuid) returns text language sql as $$
  select s.slug from public.deals d join public.stages s on s.id = d.stage_id
   where d.organization_id = p_org
$$;
create function pg_temp.temp_de(p_org uuid) returns text language sql as $$
  select d.temperature::text from public.deals d where d.organization_id = p_org
$$;
create function pg_temp.status_do_item(p_item uuid) returns text language sql as $$
  select status::text from public.call_batch_items where id = p_item
$$;
create function pg_temp.hoje() returns date language sql as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;

-- ---------- contagens de BASE, lidas FORA da RLS (padrão de 01_rls_por_papel) ----------
-- Este banco já foi usado de verdade. Contagem fixa em tabela que a operação
-- alimenta é um teste que só passa uma vez; o que estas asserções têm de provar é
-- o DELTA que o próprio arquivo produziu.
create function pg_temp.n_lotes() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.call_batches
$$;
create function pg_temp.n_revelacoes() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.pii_access_log
   where action = 'reveal_phone' and scope ->> 'origem' = 'proximo_da_fila'
$$;
create function pg_temp.n_nao_atendeu() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.activities a
    join public.interaction_outcomes o on o.id = a.outcome_id
   where o.slug = 'lig_nao_atendeu' and a.type = 'call'
$$;
create function pg_temp.n_fim_reuniao() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.v_call_script_steps s
   where s.no_id = 'fim_reuniao' and s.ultimo_no
$$;
create table pg_temp.base (chave text primary key, n int);
-- lida também de dentro de `set role authenticated` (a base é a mesma para todo papel)
grant select on pg_temp.base to authenticated;
insert into pg_temp.base values
  ('lotes',       pg_temp.n_lotes()),
  ('revelacoes',  pg_temp.n_revelacoes()),
  ('nao_atendeu', pg_temp.n_nao_atendeu()),
  ('fim_reuniao', pg_temp.n_fim_reuniao());

-- ---------- gente ----------
insert into public.allowed_users (email, role, note) values
  ('lig.admin@teste.local',  'admin',      'pgTAP ligação'),
  ('lig.sdr1@teste.local',   'sdr',        'pgTAP ligação'),
  ('lig.sdr2@teste.local',   'sdr',        'pgTAP ligação'),
  ('lig.leitura@teste.local','leitura',    'pgTAP ligação'),
  ('lig.emb@teste.local',    'embaixador', 'pgTAP ligação');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000013a1', 'lig.admin@teste.local',  '{"full_name":"Admin Ligação"}'),
  ('a0000000-0000-4000-8000-0000000013a2', 'lig.sdr1@teste.local',   '{"full_name":"Matheus"}'),
  ('a0000000-0000-4000-8000-0000000013a3', 'lig.sdr2@teste.local',   '{"full_name":"Heloísa"}'),
  ('a0000000-0000-4000-8000-0000000013a4', 'lig.leitura@teste.local','{"full_name":"Leitura"}'),
  ('a0000000-0000-4000-8000-0000000013a5', 'lig.emb@teste.local',    '{"full_name":"Embaixador"}');

-- ---------- parceiros do teste (categoria própria, para o lote ser determinístico) ----------
insert into public.categories (id, slug, name, "group", priority, position)
values (901, 'lig_teste', 'Categoria de teste da ligação', 'servicos', 2, 900);

insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind)
select ('c0000000-0000-4000-8000-0000000013' || lpad(i::text, 2, '0'))::uuid,
       'LIG Buffet ' || i,
       '+558499991' || lpad(i::text, 4, '0'),
       'Tirol',
       (select id from public.sources where slug = 'planilha'),
       'fornecedor'
  from generate_series(1, 8) i;
insert into public.organization_categories (organization_id, category_id, is_primary)
select id, 901, true from public.organizations where name like 'LIG Buffet %';
insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
select o.id, pg_temp.funil('fornecedor'),
       (select s.id from public.stages s where s.pipeline_id = pg_temp.funil('fornecedor')
         and s.slug = 'prospectado'), null
  from public.organizations o where o.name like 'LIG Buffet %';

-- Um produtor, para provar que o lote é de funil único e que a variante do roteiro
-- é escolhida pelo sistema.
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind) values
  ('c0000000-0000-4000-8000-000000001390', 'LIG Produtora Sul', '+5584999919000', 'Tirol',
   (select id from public.sources where slug = 'planilha'), 'produtor');
insert into public.organization_categories (organization_id, category_id, is_primary)
  values ('c0000000-0000-4000-8000-000000001390', 901, true);
insert into public.deals (organization_id, pipeline_id, stage_id) values
  ('c0000000-0000-4000-8000-000000001390', pg_temp.funil('produtor'),
   (select s.id from public.stages s where s.pipeline_id = pg_temp.funil('produtor')
     and s.slug = 'identificado'));

-- Dois suprimidos: um por do_not_contact, outro só pelo telefone na suppression_list.
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, do_not_contact) values
  ('c0000000-0000-4000-8000-000000001391', 'LIG Não Contatar', '+5584999919100', 'Tirol',
   (select id from public.sources where slug = 'planilha'), true),
  ('c0000000-0000-4000-8000-000000001392', 'LIG Só Supressão', '+5584999919200', 'Tirol',
   (select id from public.sources where slug = 'planilha'), false);
insert into public.organization_categories (organization_id, category_id, is_primary) values
  ('c0000000-0000-4000-8000-000000001391', 901, true),
  ('c0000000-0000-4000-8000-000000001392', 901, true);
insert into public.deals (organization_id, pipeline_id, stage_id) values
  ('c0000000-0000-4000-8000-000000001391', pg_temp.funil('fornecedor'),
   (select s.id from public.stages s where s.pipeline_id = pg_temp.funil('fornecedor') and s.slug = 'prospectado')),
  ('c0000000-0000-4000-8000-000000001392', pg_temp.funil('fornecedor'),
   (select s.id from public.stages s where s.pipeline_id = pg_temp.funil('fornecedor') and s.slug = 'prospectado'));
insert into public.suppression_list (hash, kind, reason, channel)
  values (app.sha256_hex(app.normalize_phone_br('+5584999919200')), 'phone', 'pgTAP', 'phone');

-- Uma organização sem telefone, para o motivo aparecer nomeado na montagem.
insert into public.organizations (id, name, neighborhood, source_id) values
  ('c0000000-0000-4000-8000-000000001393', 'LIG Sem Telefone', 'Tirol',
   (select id from public.sources where slug = 'planilha'));
insert into public.organization_categories (organization_id, category_id, is_primary) values
  ('c0000000-0000-4000-8000-000000001393', 901, true);
insert into public.deals (organization_id, pipeline_id, stage_id) values
  ('c0000000-0000-4000-8000-000000001393', pg_temp.funil('fornecedor'),
   (select s.id from public.stages s where s.pipeline_id = pg_temp.funil('fornecedor') and s.slug = 'prospectado'));


-- =====================================================================
-- 1. Superfície nova
-- =====================================================================
select has_table('public', 'call_scripts',     'call_scripts existe');
select has_table('public', 'call_batches',     'call_batches existe');
select has_table('public', 'call_batch_items', 'call_batch_items existe');
select has_table('public', 'call_attempts',    'call_attempts existe');
select has_view ('public', 'v_call_script_steps', 'v_call_script_steps existe');
select has_function('public', 'montar_lote',
  array['text','integer','app.temperature','uuid','integer[]','app.call_order',
        'integer','integer','integer','integer','date','date'], 'public.montar_lote existe');
select has_function('public', 'proximo_da_fila', array['uuid'], 'public.proximo_da_fila existe');
select has_function('public', 'iniciar_chamada', array['uuid'], 'public.iniciar_chamada existe');
select has_function('public', 'devolver_item_do_lote', array['uuid','text','boolean'],
  'public.devolver_item_do_lote existe (com o sinal de opt-out da migração 001500)');
select has_column('public', 'interaction_outcomes', 'requires_answer',
  'interaction_outcomes.requires_answer existe');

-- RLS ligada em toda tabela nova.
select is((select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname in ('call_scripts','call_batches','call_batch_items','call_attempts')),
  true, 'RLS habilitada nas quatro tabelas novas');


-- =====================================================================
-- 2. Os dois eixos (R13 §3.3) — o catálogo não ganhou chip novo
-- =====================================================================
select is((select count(*)::int from public.interaction_outcomes o
            where o.is_active and 'ligacao'::app.interaction_surface = any (o.surfaces)),
  8, 'a superfície ligacao continua com 8 desfechos ativos (o teto do RF-MET-06)');
select is((select array_agg(o.slug order by o.position)
             from public.interaction_outcomes o
            where o.requires_answer),
  array['lig_atendeu_retorna','lig_interessado','lig_agora_nao','lig_sem_interesse','lig_reuniao_marcada'],
  'requires_answer marca exatamente os 5 desfechos comerciais de ligação');

-- Espelho de MAPA_RESULTADO_TECNICO (components/ligacao/tipos.ts).
select is(app.outcome_for_call_result('atendida_humano'), null::text,
  'atendida_humano não tem desfecho técnico: quem responde é o eixo comercial');
select is(app.outcome_for_call_result('nao_atendeu'),     'lig_nao_atendeu',   'nao_atendeu → lig_nao_atendeu');
select is(app.outcome_for_call_result('ocupado'),         'lig_nao_atendeu',   'ocupado → lig_nao_atendeu');
select is(app.outcome_for_call_result('chamada_muda'),    'lig_nao_atendeu',   'chamada_muda → lig_nao_atendeu');
select is(app.outcome_for_call_result('queda_de_linha'),  'lig_nao_atendeu',   'queda_de_linha → lig_nao_atendeu');
select is(app.outcome_for_call_result('caixa_postal'),    'lig_caixa_postal',  'caixa_postal → lig_caixa_postal');
select is(app.outcome_for_call_result('numero_invalido'), 'lig_numero_errado', 'numero_invalido → lig_numero_errado');

-- Espelho de RESULTADOS_TECNICOS.
select is((select array_agg(e.enumlabel::text order by e.enumsortorder)
             from pg_type t join pg_enum e on e.enumtypid = t.oid
             join pg_namespace n on n.oid = t.typnamespace
            where n.nspname = 'app' and t.typname = 'call_result'),
  array['atendida_humano','nao_atendeu','caixa_postal','ocupado','numero_invalido','chamada_muda','queda_de_linha'],
  'app.call_result é igual a RESULTADOS_TECNICOS em components/ligacao/tipos.ts');


-- =====================================================================
-- 3. Janela de horário (R13 §6) — a regra, com instantes fixos
-- =====================================================================
-- Espelho de JANELA_DE_LIGACAO: seis dias, e domingo é AUSÊNCIA de linha.
select is((select count(*)::int from generate_series(0, 6) d, app.call_window_hours(d)),
  6, 'app.call_window_hours tem seis dias: domingo é ausência, não uma linha com zeros');
select is((select count(*)::int from app.call_window_hours(0)), 0, 'domingo não abre');
select is((select w.de || '-' || w.ate from app.call_window_hours(3) w), '9-20', 'quarta: 9h às 20h');
select is((select w.de || '-' || w.ate from app.call_window_hours(6) w), '10-13', 'sábado: 10h às 13h');

select is(app.call_window('2026-09-08 15:00-03'::timestamptz) ->> 'aberta', 'true',
  'terça, 15h: janela aberta');
select is(app.call_window('2026-09-06 15:00-03'::timestamptz) ->> 'motivo', 'domingo',
  'domingo, 15h: recusa por domingo');
select is(app.call_window('2026-09-07 15:00-03'::timestamptz) ->> 'motivo', 'feriado',
  '07/09, 15h: recusa por feriado (a tabela holidays manda)');
select is(app.call_window('2026-09-08 07:00-03'::timestamptz) ->> 'motivo', 'antes_da_abertura',
  'terça, 7h: cedo demais');
select is(app.call_window('2026-09-08 21:00-03'::timestamptz) ->> 'motivo', 'depois_do_fechamento',
  'terça, 21h: passou do horário');
select is(app.call_window('2026-09-06 15:00-03'::timestamptz) ->> 'abre_em',
  '2026-09-08T09:00:00-03:00',
  'domingo: a próxima abertura pula o feriado de 07/09 e cai na terça, 9h');


-- =====================================================================
-- 4. Roteiro em árvore
-- =====================================================================
select is((select cardinality(app.validar_roteiro(r.arvore)) from public.call_scripts r
            where r.slug = 'captacao_v1'),
  0, 'o roteiro semeado não tem erro estrutural');
select is((select jsonb_array_length(r.arvore) from public.call_scripts r where r.slug = 'captacao_v1'),
  37, 'o roteiro semeado tem os 37 nós do contrato');
select ok((select cardinality(app.validar_roteiro(
             '[{"id":"abertura","tipo":"pergunta","variante":"ambas","texto":"oi",
                "saidas":[{"rotulo":"a","destino":"nao_existe"}]}]'::jsonb)) > 0),
  'validar_roteiro acusa destino inexistente');
select ok((select cardinality(app.validar_roteiro(
             '[{"id":"abertura","tipo":"fim","variante":"ambas","texto":"oi","saidas":[]}]'::jsonb)) > 0),
  'validar_roteiro acusa fim que não fecha por nenhum dos dois eixos');
-- Caminho da mensagem literal (sem `format`): é onde `text[] || unknown` estourava
-- como array_cat antes do conserto apontado pelo db lint.
select is((select app.validar_roteiro(
             '[{"id":"outro","tipo":"fim","variante":"ambas","texto":"oi","saidas":[],
                "desfecho":"lig_interessado"}]'::jsonb)),
  array['Falta o nó "abertura".'],
  'validar_roteiro acusa a falta do nó de abertura, com a mensagem inteira');
select throws_ok($$
  insert into public.call_scripts (slug, nome, versao, arvore)
  values ('quebrado', 'Roteiro quebrado', 1,
          '[{"id":"abertura","tipo":"pergunta","variante":"ambas","texto":"oi","saidas":[]}]'::jsonb)
$$, '23514', null, 'o gatilho recusa roteiro em que a ligação trava num nó sem saída');


-- =====================================================================
-- 5. Montagem, exclusões e RESERVA
-- =====================================================================
create table pg_temp.r(chave text primary key, valor jsonb);
-- Os blocos abaixo consultam esta tabela já dentro do papel `authenticated`
-- (é assim que a RPC é chamada de verdade), então ela precisa ser legível por ele.
grant select on pg_temp.r to authenticated;

do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a2', 'sdr');
  v := public.montar_lote(
         p_nome               => 'LIG lote do Matheus',
         p_pipeline_id        => pg_temp.funil('fornecedor'),
         p_temperatura_origem => 'frio',
         p_roteiro_id         => (select id from public.call_scripts where slug = 'captacao_v1'),
         p_categoria_ids      => array[901],
         p_tamanho            => 25);
  execute 'reset role';
  insert into pg_temp.r values ('lote1', v);
end $$;
select pg_temp.sair();

select is((select (valor ->> 'entraram')::int from pg_temp.r where chave = 'lote1'), 8,
  'montagem: entram só as 8 organizações limpas da categoria do teste');
select is((select valor -> 'excluidos' ->> 'nao_contatar' from pg_temp.r where chave = 'lote1'), '1',
  'montagem: do_not_contact fica de fora, nomeado');
select is((select valor -> 'excluidos' ->> 'suprimido' from pg_temp.r where chave = 'lote1'), '1',
  'montagem: telefone na suppression_list fica de fora, nomeado (RF-CON-18)');
select is((select valor -> 'excluidos' ->> 'sem_telefone' from pg_temp.r where chave = 'lote1'), '1',
  'montagem: organização sem telefone fica de fora, nomeada');
-- Escopo nas organizações DESTE arquivo (conserto do achado D5). A asserção contava
-- `call_batch_items` da base inteira e reprovava por um motivo que não é defeito
-- nenhum: "Mesas e Festas" entrou num lote real do Matheus em 04/09/2026 e SÓ
-- DEPOIS pediu opt-out — a linha antiga do lote é história, e o guardrail que
-- importa (proximo_da_fila não entrega suprimido, e a montagem não o admite) segue
-- provado abaixo e na seção 7.
select is((select count(*)::int from public.call_batch_items i
            join public.organizations o on o.id = i.organization_id
           where o.name like 'LIG %'
             and (o.do_not_contact or o.phone_e164 = '+5584999919200')), 0,
  'guardrail: nenhum suprimido do teste tem linha em call_batch_items, em nenhum lote');
select is((select count(distinct position)::int from public.call_batch_items i
            where i.batch_id = ((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid), 8,
  'montagem: a ordem é congelada em posições distintas');
select is((select b.total || '/' || b.pending from public.call_batches b
            where b.id = ((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid),
  '8/8', 'os contadores do lote são materializados na montagem');

-- ---------- a reserva: a Heloísa monta o mesmo recorte e não pega ninguém ----------
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a3', 'sdr');
  v := public.montar_lote(
         p_nome               => 'LIG lote da Heloísa',
         p_pipeline_id        => pg_temp.funil('fornecedor'),
         p_temperatura_origem => 'frio',
         p_roteiro_id         => (select id from public.call_scripts where slug = 'captacao_v1'),
         p_categoria_ids      => array[901],
         p_tamanho            => 25);
  execute 'reset role';
  insert into pg_temp.r values ('lote2', v);
end $$;
select pg_temp.sair();

select is((select (valor ->> 'entraram')::int from pg_temp.r where chave = 'lote2'), 0,
  'reserva: o segundo lote não pega nenhum contato já reservado (R13 §3.1)');
select is((select valor -> 'excluidos' ->> 'reservado_em_outro_lote' from pg_temp.r where chave = 'lote2'), '8',
  'reserva: e a tela recebe o motivo nomeado, com a contagem certa');

-- A reserva por LINHA TELEFÔNICA é um segundo índice, e não redundância:
-- organizations.phone_e164 só é único entre organizações VIVAS.
select throws_ok($$
  insert into public.call_batch_items (batch_id, organization_id, phone_e164, position)
  select i.batch_id, 'c0000000-0000-4000-8000-000000001390', i.phone_e164, 900
    from public.call_batch_items i limit 1
$$, '23505', null, 'reserva: duas linhas de lote não podem apontar para o mesmo telefone');

-- Um lote não mistura funis: o produtor não entrou no lote do funil fornecedor.
select is((select count(*)::int from public.call_batch_items i
            where i.organization_id = 'c0000000-0000-4000-8000-000000001390'), 0,
  'lote de funil único: o produtor não entra num lote do funil fornecedor');


-- =====================================================================
-- 6. A janela recusa NO BANCO ao puxar da fila
-- =====================================================================
-- Faixa fechada o dia inteiro: prova que proximo_da_fila consulta app.call_window.
create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select h.de, h.ate from (values (0, 0::numeric, 0::numeric), (1, 0::numeric, 0::numeric),
    (2, 0::numeric, 0::numeric), (3, 0::numeric, 0::numeric), (4, 0::numeric, 0::numeric),
    (5, 0::numeric, 0::numeric), (6, 0::numeric, 0::numeric)) as h(dow, de, ate) where h.dow = p_dow
$$;

do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a2', 'sdr');
  v := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid);
  execute 'reset role';
  insert into pg_temp.r values ('fechado', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'fechado'), 'fora_da_janela',
  'janela: fora de hora, a fila não entrega contato — e a recusa é do banco');
select is((select valor ->> 'detalhe' from pg_temp.r where chave = 'fechado'), 'depois_do_fechamento',
  'janela: com o motivo nomeado, para a tela virar frase em português');

-- Agora a faixa abre o dia inteiro; o FERIADO continua bloqueando sozinho.
create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select h.de, h.ate from (values (0, 0::numeric, 24::numeric), (1, 0::numeric, 24::numeric),
    (2, 0::numeric, 24::numeric), (3, 0::numeric, 24::numeric), (4, 0::numeric, 24::numeric),
    (5, 0::numeric, 24::numeric), (6, 0::numeric, 24::numeric)) as h(dow, de, ate) where h.dow = p_dow
$$;
insert into public.holidays (date, name, scope) values (pg_temp.hoje(), 'Feriado do pgTAP', 'municipal');

do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a2', 'sdr');
  v := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid);
  execute 'reset role';
  insert into pg_temp.r values ('feriado', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'feriado'), 'fora_da_janela',
  'janela: em feriado a fila não entrega contato, mesmo com a faixa aberta');
select is((select valor ->> 'detalhe' from pg_temp.r where chave = 'feriado'), 'feriado',
  'janela: e o motivo nomeado é o feriado');

delete from public.holidays where name = 'Feriado do pgTAP';


-- =====================================================================
-- 7. A fila: trava, dono e guardrail depois da montagem
-- =====================================================================
do $$
declare v1 jsonb; v2 jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a2', 'sdr');
  v1 := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid);
  v2 := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid);
  execute 'reset role';
  insert into pg_temp.r values ('puxa1', v1), ('puxa2', v2);
end $$;
select pg_temp.sair();

select is((select valor ->> 'ok' from pg_temp.r where chave = 'puxa1'), 'true',
  'fila: com a janela aberta, o primeiro contato é entregue');
select isnt((select valor -> 'item' ->> 'id' from pg_temp.r where chave = 'puxa1'),
            (select valor -> 'item' ->> 'id' from pg_temp.r where chave = 'puxa2'),
  'trava: puxar duas vezes nunca devolve o mesmo contato');
select is(pg_temp.status_do_item(((select valor -> 'item' ->> 'id' from pg_temp.r where chave = 'puxa1'))::uuid),
  'em_andamento', 'trava: o contato entregue fica em_andamento, segurando a reserva');
select is((select valor -> 'item' ->> 'telefone' from pg_temp.r where chave = 'puxa1') ~ '^\+55', true,
  'a fila entrega o telefone em E.164, que é o que o link tel: precisa');
select is(pg_temp.n_revelacoes(), (select n from pg_temp.base where chave = 'revelacoes') + 2,
  'RF-BAS-14: revelar o telefone pela fila é registrado em pii_access_log (duas revelações a mais)');
select is((select valor ->> 'variante' from pg_temp.r where chave = 'puxa1'), 'fornecedor',
  'a variante do roteiro é escolhida pelo sistema, pelo kind da organização');
select is((select jsonb_array_length(valor -> 'roteiro' -> 'arvore') from pg_temp.r where chave = 'puxa1'), 37,
  'a fila entrega o roteiro congelado do lote, inteiro');

-- Lote de outra pessoa: sdr enxerga (sees_all), mas não puxa.
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a3', 'sdr');
  v := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid);
  execute 'reset role';
  insert into pg_temp.r values ('outro_dono', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'outro_dono'), 'lote_de_outro_dono',
  'ninguém puxa contato do lote de outra pessoa (R13 §3.1)');

-- ---------- opt-out DEPOIS da montagem ----------
-- O item já está reservado; o guardrail tem de valer de novo na hora de puxar.
update public.organizations set do_not_contact = true
 where id = (select i.organization_id from public.call_batch_items i
              where i.batch_id = ((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid
                and i.status = 'fila' order by i.position limit 1);

do $$
declare v jsonb; v_org uuid;
begin
  select i.organization_id into v_org from public.call_batch_items i
    where i.batch_id = ((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid
      and i.status = 'fila' order by i.position limit 1;
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a2', 'sdr');
  v := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid);
  execute 'reset role';
  insert into pg_temp.r values ('optout_depois', v || jsonb_build_object('org_suprimida', v_org));
end $$;
select pg_temp.sair();
select isnt((select valor -> 'item' ->> 'organization_id' from pg_temp.r where chave = 'optout_depois'),
            (select valor ->> 'org_suprimida' from pg_temp.r where chave = 'optout_depois'),
  'RF-CON-18: quem pediu opt-out depois do lote montado não é entregue');
select is((select i.status::text from public.call_batch_items i
            where i.organization_id = ((select valor ->> 'org_suprimida' from pg_temp.r where chave = 'optout_depois'))::uuid),
  'devolvido', 'e o item sai do lote, liberando a reserva');


-- =====================================================================
-- 8. Chamada e tabulação — a consequência é a do catálogo
-- =====================================================================
-- 8.1 Ninguém atendeu: um toque, e o item volta para a fila.
do $$
declare v_item uuid; v_ch jsonb; v_tab jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a2', 'sdr');
  v_item := ((select valor -> 'item' ->> 'id' from pg_temp.r where chave = 'puxa1'))::uuid;
  v_ch  := public.iniciar_chamada(v_item);
  v_tab := public.tabular_chamada(
             p_client_key => gen_random_uuid(),
             p_chamada_id => (v_ch -> 'chamada' ->> 'id')::uuid,
             p_item_id    => v_item,
             p_resultado  => 'nao_atendeu',
             p_com_quem   => 'ninguem',
             p_duracao_seg => 12);
  execute 'reset role';
  insert into pg_temp.r values ('chamada1', v_ch), ('tab1', v_tab);
end $$;
select pg_temp.sair();

select is((select valor ->> 'ok' from pg_temp.r where chave = 'chamada1'), 'true',
  'iniciar_chamada abre a tentativa e devolve o telefone');
select is((select valor ->> 'tabulado' from pg_temp.r where chave = 'tab1'), 'true',
  'tabular sem atendimento não exige desfecho comercial: o técnico resolve');
select is((select valor ->> 'outcome_slug' from pg_temp.r where chave = 'tab1'), 'lig_nao_atendeu',
  'e o desfecho gravado é o que o mapa resolveu, não uma escolha de quem ligou');
select is((select valor ->> 'volta_para_fila' from pg_temp.r where chave = 'tab1'), 'true',
  '"não atendeu" pede nova tentativa: o item volta para a fila');
select is((select valor ->> 'tentativas' from pg_temp.r where chave = 'tab1'), '1',
  'e a tentativa foi contada');
select is(pg_temp.n_nao_atendeu(), (select n from pg_temp.base where chave = 'nao_atendeu') + 1,
  'a tabulação grava a atividade pela public.registrar_contato que já existia (uma a mais)');

-- 8.2 Eixos incoerentes: sem atendimento não existe resultado comercial.
do $$
declare v_item uuid; v_ch jsonb; v_a jsonb; v_b jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a2', 'sdr');
  v_item := ((select valor -> 'item' ->> 'id' from pg_temp.r where chave = 'puxa2'))::uuid;
  v_ch := public.iniciar_chamada(v_item);
  v_a := public.tabular_chamada(gen_random_uuid(), (v_ch -> 'chamada' ->> 'id')::uuid, v_item,
                                'nao_atendeu', 'ninguem', pg_temp.desfecho('lig_interessado'));
  v_b := public.tabular_chamada(gen_random_uuid(), (v_ch -> 'chamada' ->> 'id')::uuid, v_item,
                                'atendida_humano', 'decisor', null);
  execute 'reset role';
  insert into pg_temp.r values ('eixo_a', v_a), ('eixo_b', v_b), ('chamada2', v_ch);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'eixo_a'), 'eixos_incoerentes',
  'eixos: sem atendimento, mandar desfecho comercial é recusado');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'eixo_b'), 'eixos_incoerentes',
  'eixos: com atendimento, não mandar desfecho é recusado');

-- 8.3 Atendeu e marcou reunião: etapa e temperatura saem do catálogo.
do $$
declare v_item uuid; v_org uuid; v_tab jsonb; v_key uuid := gen_random_uuid(); v_rep jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a2', 'sdr');
  v_item := ((select valor -> 'item' ->> 'id' from pg_temp.r where chave = 'puxa2'))::uuid;
  select i.organization_id into v_org from public.call_batch_items i where i.id = v_item;
  v_tab := public.tabular_chamada(
             p_client_key      => v_key,
             p_chamada_id      => ((select valor -> 'chamada' ->> 'id' from pg_temp.r where chave = 'chamada2'))::uuid,
             p_item_id         => v_item,
             p_resultado       => 'atendida_humano',
             p_com_quem        => 'decisor',
             p_outcome_id      => pg_temp.desfecho('lig_reuniao_marcada'),
             p_caminho_script  => array['abertura','gancho_fornecedor','forn_indicacao','forn_qualifica',
                                        'forn_proposta','agendar_reuniao','confirmar_contato',
                                        'enviar_whatsapp','fim_reuniao'],
             p_duracao_seg     => 214,
             p_capturas        => '{"eventos_por_mes":"4"}'::jsonb,
             p_reuniao_em      => now() + interval '3 days',
             p_reuniao_formato => 'meet');
  -- Reenvio da fila offline, com a MESMA chave.
  v_rep := public.tabular_chamada(
             p_client_key      => v_key,
             p_chamada_id      => ((select valor -> 'chamada' ->> 'id' from pg_temp.r where chave = 'chamada2'))::uuid,
             p_item_id         => v_item,
             p_resultado       => 'atendida_humano',
             p_com_quem        => 'decisor',
             p_outcome_id      => pg_temp.desfecho('lig_reuniao_marcada'),
             p_reuniao_em      => now() + interval '3 days',
             p_reuniao_formato => 'meet');
  execute 'reset role';
  insert into pg_temp.r values ('tab2', v_tab || jsonb_build_object('org', v_org)), ('tab2_rep', v_rep);
end $$;
select pg_temp.sair();

select is((select valor ->> 'tabulado' from pg_temp.r where chave = 'tab2'), 'true',
  'atendeu e marcou reunião: tabulado');
select is(pg_temp.etapa_de(((select valor ->> 'org' from pg_temp.r where chave = 'tab2'))::uuid),
  'reuniao_marcada', 'tabulação move a ETAPA, pela consequência do catálogo (RF-FUN-12)');
select is(pg_temp.temp_de(((select valor ->> 'org' from pg_temp.r where chave = 'tab2'))::uuid),
  'quente', 'e a TEMPERATURA sai da regra do PRD §5.6, não de código novo');
select is((select valor ->> 'volta_para_fila' from pg_temp.r where chave = 'tab2'), 'false',
  'reunião marcada encerra o item: não pede nova tentativa');
select is(pg_temp.status_do_item(((select valor -> 'item' ->> 'id' from pg_temp.r where chave = 'puxa2'))::uuid),
  'concluido', 'e o item fica concluído');
select is((select valor ->> 'tabulado' from pg_temp.r where chave = 'tab2_rep'), 'true',
  'reenvio da fila offline: aceito');
select is((select valor ->> 'repetido' from pg_temp.r where chave = 'tab2_rep'), 'true',
  'reenvio da fila offline: marcado como repetido, sem tabular de novo');
select is((select count(*)::int from public.call_attempts a where a.item_id =
            ((select valor -> 'item' ->> 'id' from pg_temp.r where chave = 'puxa2'))::uuid), 1,
  'reenvio: e sem abrir uma segunda tentativa');
select is(pg_temp.n_fim_reuniao(), (select n from pg_temp.base where chave = 'fim_reuniao') + 1,
  'o caminho do roteiro fica em linhas: dá para perguntar em qual frase as pessoas desligam (uma a mais)');

-- 8.4 "Não me ligue mais": o desfecho é registrado E o opt-out também.
do $$
declare v_pux jsonb; v_item uuid; v_org uuid; v_ch jsonb; v_tab jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a2', 'sdr');
  v_pux  := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid);
  v_item := (v_pux -> 'item' ->> 'id')::uuid;
  v_org  := (v_pux -> 'item' ->> 'organization_id')::uuid;
  v_ch   := public.iniciar_chamada(v_item);
  v_tab  := public.tabular_chamada(
              p_client_key           => gen_random_uuid(),
              p_chamada_id           => (v_ch -> 'chamada' ->> 'id')::uuid,
              p_item_id              => v_item,
              p_resultado            => 'atendida_humano',
              p_com_quem             => 'decisor',
              p_outcome_id           => pg_temp.desfecho('lig_sem_interesse'),
              p_lost_reason_id       => (select id from public.lost_reasons order by id limit 1),
              p_observacao           => 'Pediu para não ligar mais.',
              p_pediu_para_nao_ligar => true);
  execute 'reset role';
  insert into pg_temp.r values ('optout', v_tab || jsonb_build_object('org', v_org, 'item', v_item));
end $$;
select pg_temp.sair();
select is((select valor ->> 'tabulado' from pg_temp.r where chave = 'optout'), 'true',
  'opt-out: o registro do toque continua sendo gravado (RF-MET-01)');
select is((select o.do_not_contact from public.organizations o
            where o.id = ((select valor ->> 'org' from pg_temp.r where chave = 'optout'))::uuid), true,
  'opt-out: app.consent_apply marcou do_not_contact');
select is(pg_temp.status_do_item(((select valor ->> 'item' from pg_temp.r where chave = 'optout'))::uuid),
  'devolvido', 'opt-out: o item sai do lote e não volta para a fila');

-- 8.5 Devolver sem tabular (aba fechada).
do $$
declare v_pux jsonb; v_dev jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a2', 'sdr');
  v_pux := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid);
  v_dev := public.devolver_item_do_lote((v_pux -> 'item' ->> 'id')::uuid, 'aba fechada no pgTAP');
  execute 'reset role';
  insert into pg_temp.r values ('devolver', v_dev);
end $$;
select pg_temp.sair();
select is((select valor ->> 'item_status' from pg_temp.r where chave = 'devolver'), 'fila',
  'devolver sem tabular: o item volta para a fila e a reserva cai');


-- =====================================================================
-- 9. RLS por papel
-- =====================================================================
-- O telefone copiado no item não pode ser lido por quem não o lê na base (RF-BAS-14).
select pg_temp.entrar('a0000000-0000-4000-8000-0000000013a2', 'sdr');
select throws_ok('select phone_e164 from public.call_batch_items limit 1', '42501', null,
  'RF-BAS-14: sdr não lê a cópia do telefone na tabela do lote');
select lives_ok('select id, status, position from public.call_batch_items limit 1',
  'mas lê as demais colunas do item normalmente');
select pg_temp.sair();

-- Leitura não escreve: não monta lote.
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000013a4', 'leitura');
  v := public.montar_lote('LIG lote proibido', pg_temp.funil('fornecedor'), 'frio',
                          (select id from public.call_scripts where slug = 'captacao_v1'));
  execute 'reset role';
  insert into pg_temp.r values ('leitura', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'leitura'), 'sem_permissao',
  'RLS: papel de leitura não monta lote');

-- Embaixador só vê os lotes dele.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000013a5', 'embaixador');
select is((select count(*)::int from public.call_batches), 0,
  'RLS: embaixador não enxerga lote de outra pessoa');
select pg_temp.sair();

-- sdr enxerga os lotes do time (sees_all), mas não os altera.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000013a3', 'sdr');
-- sdr tem app.sees_all: o que ele enxerga é a base INTEIRA, e por isso a asserção
-- compara com a base (lida fora da RLS), e não com os dois lotes deste arquivo.
select is((select count(*)::int from public.call_batches), pg_temp.n_lotes(),
  'RLS: sdr enxerga os lotes do time (app.sees_all)');
select is(pg_temp.n_lotes(), (select n from pg_temp.base where chave = 'lotes') + 1,
  '...e este arquivo deixou UM lote a mais: a montagem da Heloísa não pegou ninguém e, desde a 20260904001500, não deixa lote vazio para trás (D7)');
-- RLS de UPDATE não levanta exceção: ela simplesmente não encontra linha. O que
-- prova o guardrail é a linha continuar como estava.
select lives_ok($$
  update public.call_batch_items set note = 'invasão'
   where batch_id in (select id from public.call_batches where nome = 'LIG lote do Matheus')
$$, 'RLS: o UPDATE no lote de outra pessoa não estoura...');
select is((select count(*)::int from public.call_batch_items where note = 'invasão'), 0,
  '...e também não altera nenhuma linha (app.call_batch_is_mine)');
select pg_temp.sair();

-- anon não enxerga nada.
select is((select count(*)::int from information_schema.role_table_grants
            where grantee = 'anon'
              and table_name in ('call_scripts','call_batches','call_batch_items','call_attempts')),
  0, 'anon não tem privilégio nenhum nas tabelas do módulo');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — A regra de recontato e seis miudezas de banco
--         (migração 20260905000801_recontato_e_miudezas.sql)
--
-- O laudo §3.2 achou DUAS regras diferentes para a mesma pergunta do
-- RF-FUN-13 — "posso tocar esta organização hoje?" — e as duas em produção,
-- nas duas superfícies que a mesma pessoa usa no mesmo dia:
--
--   · a fila de ligação lê `public.v_contact_cooldown`, que olhava só o
--     ÚLTIMO desfecho. Um "não atendeu" de 1 dia apagava um "agora não" de
--     30 dias registrado antes.
--   · a cadência lê `app.pode_tocar`, que fazia o MÁXIMO sobre todo o
--     histórico e mantinha os 30 dias.
--
-- Este arquivo é a tabela do laudo virada teste: DUAS COLUNAS, uma por
-- superfície, e a asserção é que os dois números são IGUAIS em cada passo.
-- Falhar aqui, com o código antigo, é o ponto: a coluna da fila devolvia
-- "amanhã" onde a da cadência devolvia "daqui a 16 dias".
--
-- A regra decidida (escrita por extenso na migração):
--   piso = MÁXIMO de (occurred_at + cooldown_days) sobre as atividades com
--   desfecho da organização, com duas exceções nomeadas —
--     E1 (o alvo voltou a falar): atividades anteriores à ÚLTIMA porta
--        aberta (`counts_as = 'aberta'`) não contam mais;
--     E2 (canal morto): "Número inválido" e "Número errado" (36500 dias,
--        sem etapa de destino) só contam enquanto forem a última atividade
--        — o primeiro toque por outro canal derruba a janela, que é a
--        própria próxima ação desses dois chips.
--
-- E as miudezas do §3.12: b (a tarefa sabe em qual tentativa está),
-- c (o "Vale até" esticado deixa de ser silencioso), d (teto de tentativas
-- estourado não é mais "fila vazia"), e (item suprimido some de "restantes"),
-- f (DDD que não existe no Brasil não vira telefone), j (negócio sem contato
-- registrado esfria pela data de criação), l (o morno de 7 dias ganha a
-- tarefa de reengajar do PRD §5.6).
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada: toda
-- contagem é delta contra uma base lida FORA da RLS, ou escopo por id.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(60);

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
create function pg_temp.org(p_n text) returns uuid language sql immutable as $$
  select ('c0000000-0000-4000-8000-0000000032' || p_n)::uuid
$$;
create function pg_temp.roteiro() returns uuid language sql as $$
  select id from public.call_scripts where slug = 'captacao_v1' and is_published
$$;

-- ---------- as DUAS COLUNAS da tabela do §3.2 ----------
-- Cada uma devolve "o piso de recontato que ainda está de pé", ou NULL quando
-- não há espera nenhuma. É a mesma pergunta feita às duas superfícies.
--   coluna 1: o que a FILA DE LIGAÇÃO enxerga (public.v_contact_cooldown,
--             lida por app.call_candidates em 20260904001500:375);
--   coluna 2: o que a CADÊNCIA enxerga (app.pode_tocar, motivo 'cooldown').
create function pg_temp.piso_da_fila(p_org uuid) returns timestamptz
language sql security definer set search_path = '' as $$
  select c.cooldown_until from public.v_contact_cooldown c
   where c.organization_id = p_org and c.cooldown_until > now()
$$;
create function pg_temp.piso_da_cadencia(p_org uuid) returns timestamptz
language sql security definer set search_path = '' as $$
  select case when app.pode_tocar(p_org, null, 'phone'::app.channel) ->> 'motivo' = 'cooldown'
              then (app.pode_tocar(p_org, null, 'phone'::app.channel) ->> 'quando')::timestamptz
         end
$$;
create function pg_temp.quando_ocorreu(p_rotulo text) returns timestamptz
language sql security definer set search_path = '' as $$
  select a.occurred_at from public.activities a where a.metadata ->> 'rotulo' = p_rotulo
$$;
create function pg_temp.bloqueada(p_org uuid) returns boolean
language sql security definer set search_path = '' as $$
  select c.blocked_forever from public.v_contact_cooldown c where c.organization_id = p_org
$$;
create function pg_temp.n_tarefas_reengajar(p_deal uuid) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from public.tasks t
   where t.deal_id = p_deal and t.origin = 'system'
     and t.title like 'Reengajar%'
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
$$;
create function pg_temp.temp_do_negocio(p_deal uuid) returns text
language sql security definer set search_path = '' as $$
  select d.temperature::text || case when d.needs_attention then '+alerta' else '' end
    from public.deals d where d.id = p_deal
$$;
create function pg_temp.titulo_da_tarefa(p_id uuid) returns text
language sql security definer set search_path = '' as $$
  select t.title from public.tasks t where t.id = p_id
$$;

create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated;

-- ---------- gente ----------
insert into public.allowed_users (email, role, note) values
  ('c32.sdr@teste.local', 'sdr', 'pgTAP recontato');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000032a1', 'c32.sdr@teste.local', '{"full_name":"SDR Recontato"}');

-- ---------- parceiros ----------
-- Uma categoria por lote: a reserva de `montar_lote` é por organização E por
-- linha telefônica, então lotes que dividissem candidatos fariam o teste
-- depender da ordem em que ele mesmo roda.
insert into public.categories (id, slug, name, "group", priority, position) values
  (932, 'c32_regra',     'C32 regra de recontato', 'servicos', 2, 932),
  (933, 'c32_lote_tres', 'C32 lote de três',       'servicos', 2, 933),
  (934, 'c32_lote_um',   'C32 lote de uma',        'servicos', 2, 934),
  (935, 'c32_restantes', 'C32 restantes',          'servicos', 2, 935);

insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind) values
  (pg_temp.org('01'), 'C32 Tabela do Laudo',   '+5584999320001', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('02'), 'C32 Alvo Respondeu',    '+5584999320002', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('03'), 'C32 Canal Morto',       '+5584999320003', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('04'), 'C32 Optout e Resposta', '+5584999320004', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('05'), 'C32 Quente Parado',     '+5584999320005', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('06'), 'C32 Morno Parado',      '+5584999320006', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('07'), 'C32 Morno Suprimido',   '+5584999320007', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('08'), 'C32 Frio Sem Contato',  '+5584999320008', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('21'), 'C32 Lote Tres',         '+5584999320021', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('31'), 'C32 Lote Um',           '+5584999320031', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('41'), 'C32 Restantes A',       '+5584999320041', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('42'), 'C32 Restantes B',       '+5584999320042', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'),
  (pg_temp.org('43'), 'C32 Restantes C',       '+5584999320043', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor');
insert into public.organization_categories (organization_id, category_id, is_primary)
select o.id,
       case when o.name = 'C32 Lote Tres' then 933
            when o.name = 'C32 Lote Um'   then 934
            when o.name like 'C32 Restantes%' then 935
            else 932 end,
       true
  from public.organizations o where o.name like 'C32 %';

insert into public.deals (id, organization_id, pipeline_id, stage_id) values
  ('d0000000-0000-4000-8000-000000003201', pg_temp.org('01'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado')),
  ('d0000000-0000-4000-8000-000000003202', pg_temp.org('02'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado')),
  ('d0000000-0000-4000-8000-000000003203', pg_temp.org('03'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado')),
  ('d0000000-0000-4000-8000-000000003204', pg_temp.org('04'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado')),
  ('d0000000-0000-4000-8000-000000003205', pg_temp.org('05'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','reuniao_marcada')),
  ('d0000000-0000-4000-8000-000000003206', pg_temp.org('06'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','respondeu')),
  ('d0000000-0000-4000-8000-000000003207', pg_temp.org('07'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','respondeu')),
  ('d0000000-0000-4000-8000-000000003208', pg_temp.org('08'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado')),
  ('d0000000-0000-4000-8000-000000003221', pg_temp.org('21'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado')),
  ('d0000000-0000-4000-8000-000000003231', pg_temp.org('31'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado')),
  ('d0000000-0000-4000-8000-000000003241', pg_temp.org('41'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado')),
  ('d0000000-0000-4000-8000-000000003242', pg_temp.org('42'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado')),
  ('d0000000-0000-4000-8000-000000003243', pg_temp.org('43'), pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor','prospectado'));


-- =====================================================================
-- 1. §3.2 — A TABELA DO LAUDO, com números iguais nas duas colunas
-- =====================================================================
-- Passo A: só o "agora não" de 30 dias, registrado há 14 dias.
insert into public.activities (type, channel, organization_id, deal_id, occurred_at, outcome_id, metadata)
values ('message', 'whatsapp', pg_temp.org('01'), 'd0000000-0000-4000-8000-000000003201',
        now() - interval '14 days', pg_temp.desfecho('wa_agora_nao'), '{"rotulo":"c32_agora_nao"}');

select is(pg_temp.piso_da_fila(pg_temp.org('01')),
          pg_temp.quando_ocorreu('c32_agora_nao') + interval '30 days',
  'A · fila: só o "agora não" de 30 dias — o piso é a data do desfecho + 30 dias');
select is(pg_temp.piso_da_cadencia(pg_temp.org('01')),
          pg_temp.quando_ocorreu('c32_agora_nao') + interval '30 days',
  'A · cadência: o mesmo piso');
select is(pg_temp.piso_da_fila(pg_temp.org('01')), pg_temp.piso_da_cadencia(pg_temp.org('01')),
  'A · as duas colunas dão o MESMO número (RF-FUN-13 tem uma resposta só)');

-- Passo B: um "não atendeu" de 1 dia registrado DEPOIS. Era aqui que 28 dias
-- de piso evaporavam do lado da fila e não do lado da cadência.
insert into public.activities (type, channel, organization_id, deal_id, occurred_at, outcome_id, metadata)
values ('call', 'phone', pg_temp.org('01'), 'd0000000-0000-4000-8000-000000003201',
        now() - interval '1 hour', pg_temp.desfecho('lig_nao_atendeu'), '{"rotulo":"c32_nao_atendeu"}');

select is(pg_temp.piso_da_fila(pg_temp.org('01')),
          pg_temp.quando_ocorreu('c32_agora_nao') + interval '30 days',
  'B · fila: o "não atendeu" de 1 dia NÃO apaga o "agora não" de 30 (era o defeito §3.2)');
select is(pg_temp.piso_da_cadencia(pg_temp.org('01')),
          pg_temp.quando_ocorreu('c32_agora_nao') + interval '30 days',
  'B · cadência: continua nos 30 dias');
select is(pg_temp.piso_da_fila(pg_temp.org('01')), pg_temp.piso_da_cadencia(pg_temp.org('01')),
  'B · as duas colunas dão o MESMO número — a linha que o laudo pediu');
select ok(pg_temp.piso_da_fila(pg_temp.org('01')) > now() + interval '15 days',
  'B · e o piso continua a mais de 15 dias daqui (ninguém volta ao lote amanhã)');

-- Exceção E1: o alvo voltou a falar. É a única coisa que apaga um piso de
-- desfecho anterior — e apaga nas DUAS superfícies, não em uma só.
insert into public.activities (type, channel, organization_id, deal_id, occurred_at, outcome_id, metadata)
values ('message', 'whatsapp', pg_temp.org('02'), 'd0000000-0000-4000-8000-000000003202',
        now() - interval '10 days', pg_temp.desfecho('wa_agora_nao'), '{"rotulo":"c32_r_agora_nao"}');
select ok(pg_temp.piso_da_fila(pg_temp.org('02')) is not null,
  'E1 · antes da resposta: o "agora não" segura o alvo na fila');
select ok(pg_temp.piso_da_cadencia(pg_temp.org('02')) is not null,
  'E1 · antes da resposta: e segura na cadência');
insert into public.activities (type, channel, organization_id, deal_id, occurred_at, outcome_id, metadata)
values ('message', 'whatsapp', pg_temp.org('02'), 'd0000000-0000-4000-8000-000000003202',
        now() - interval '1 hour', pg_temp.desfecho('wa_respondeu'), '{"rotulo":"c32_respondeu"}');
select is(pg_temp.piso_da_fila(pg_temp.org('02')), null,
  'E1 · o alvo respondeu: a espera cai na fila (a porta aberta reabre o assunto)');
select is(pg_temp.piso_da_cadencia(pg_temp.org('02')), null,
  'E1 · e cai também na cadência — que antes ficava presa aos 30 dias');
select is(pg_temp.piso_da_fila(pg_temp.org('02')), pg_temp.piso_da_cadencia(pg_temp.org('02')),
  'E1 · as duas colunas concordam também na exceção');

-- Exceção E2: canal morto. "Número inválido" segura por 36500 dias, e a janela
-- cai no primeiro toque por outro canal — que é a própria próxima ação do chip.
insert into public.activities (type, channel, organization_id, deal_id, occurred_at, outcome_id, metadata)
values ('message', 'whatsapp', pg_temp.org('03'), 'd0000000-0000-4000-8000-000000003203',
        now() - interval '2 days', pg_temp.desfecho('wa_numero_invalido'), '{"rotulo":"c32_numero_morto"}');
select ok(pg_temp.piso_da_fila(pg_temp.org('03')) > now() + interval '90 years',
  'E2 · número morto sozinho: janela permanente na fila');
select ok(pg_temp.piso_da_cadencia(pg_temp.org('03')) > now() + interval '90 years',
  'E2 · e na cadência');
insert into public.activities (type, channel, organization_id, deal_id, occurred_at, outcome_id, metadata)
values ('visit', 'presencial', pg_temp.org('03'), 'd0000000-0000-4000-8000-000000003203',
        now() - interval '1 hour', pg_temp.desfecho('vis_nao_estava'), '{"rotulo":"c32_outro_canal"}');
select is(pg_temp.piso_da_fila(pg_temp.org('03')),
          pg_temp.quando_ocorreu('c32_outro_canal') + interval '7 days',
  'E2 · o toque por outro canal derruba os 36500 dias e vale o piso do toque novo (fila)');
select is(pg_temp.piso_da_cadencia(pg_temp.org('03')),
          pg_temp.quando_ocorreu('c32_outro_canal') + interval '7 days',
  'E2 · a cadência, que antes ficava com os 36500 dias para sempre, dá o mesmo número');
select is(pg_temp.piso_da_fila(pg_temp.org('03')), pg_temp.piso_da_cadencia(pg_temp.org('03')),
  'E2 · as duas colunas concordam no canal morto');

-- O que a unificação NÃO pode afrouxar: opt-out. A resposta posterior derruba a
-- ESPERA (é a mesma exceção E1, e é o que a fila já fazia), e não pode derrubar
-- o BLOQUEIO nem a supressão.
insert into public.activities (type, channel, organization_id, deal_id, occurred_at, outcome_id, metadata)
values ('message', 'whatsapp', pg_temp.org('04'), 'd0000000-0000-4000-8000-000000003204',
        now() - interval '2 days', pg_temp.desfecho('wa_optout'), '{"rotulo":"c32_optout"}');
insert into public.activities (type, channel, organization_id, deal_id, occurred_at, outcome_id, metadata)
values ('message', 'whatsapp', pg_temp.org('04'), 'd0000000-0000-4000-8000-000000003204',
        now() - interval '1 hour', pg_temp.desfecho('wa_respondeu'), '{"rotulo":"c32_optout_resposta"}');
select is(pg_temp.bloqueada(pg_temp.org('04')), true,
  'guardrail: resposta depois do opt-out NÃO derruba o bloqueio (RF-CON-18)');
select isnt(app.pode_tocar(pg_temp.org('04'), null, 'phone') ->> 'motivo', 'cooldown',
  'guardrail: e a cadência não recusa por espera — recusa por algo que ENCERRA');
select is((app.pode_tocar(pg_temp.org('04'), null, 'phone') ->> 'pode')::boolean, false,
  'guardrail: a porteira continua dizendo NÃO para quem pediu para parar');
select is(app.pode_tocar(pg_temp.org('04'), null, 'phone') -> 'quando', 'null'::jsonb,
  'guardrail: e sem "quando" — supressão e bloqueio encerram a matrícula, não adiam');


-- =====================================================================
-- 2. §3.12f — DDD que não existe no Brasil não vira telefone
-- =====================================================================
-- A régua é a numeração da Anatel, a mesma lista de
-- packages/prompts/src/nucleo/telefone-br.ts (67 DDDs, nenhum com zero).
select is(app.normalize_phone_br('(23) 99999-1234'), null, 'DDD 23 não existe no Brasil');
select is(app.normalize_phone_br('(39) 99999-1234'), null, 'DDD 39 não existe no Brasil');
select is(app.normalize_phone_br('(56) 3206-4212'),  null, 'DDD 56 não existe no Brasil (fixo)');
select is(app.normalize_phone_br('+55 78 99999-1234'), null, 'DDD 78 não existe no Brasil (com DDI)');
select is(app.normalize_phone_br('(84) 99999-1234'), '+5584999991234', 'DDD 84 (Natal) continua valendo');
select is(app.normalize_phone_br('(11) 99999-1234'), '+5511999991234', 'DDD 11 continua valendo');
select is(app.normalize_phone_br('(99) 3206-4212'),  '+559932064212',  'DDD 99 (MA) continua valendo');
select is((select count(*)::int from generate_series(11, 99) g where app.ddd_br_valido(g::text)), 67,
  'a lista tem os 67 DDDs em uso — a mesma de packages/prompts/src/nucleo/telefone-br.ts');
-- Um por um, e não só a contagem: é esta asserção que fica vermelha quando a
-- cópia do banco e as duas do TypeScript (telefone-br.ts e auditoria-pii.ts,
-- separadas de propósito) deixam de dizer a mesma coisa.
select is((select string_agg(g::text, ',' order by g)
             from generate_series(11, 99) g where app.ddd_br_valido(g::text)),
          '11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,'
       || '41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,'
       || '71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99',
  'e são exatamente estes — a lista da Anatel, código a código');


-- =====================================================================
-- 3. §3.12j — negócio sem contato registrado esfria pela data de criação
-- =====================================================================
-- `last_activity_at` nulo virava "0 dias" e o quente ficava quente para sempre.
select is(pg_temp.temp_do_negocio('d0000000-0000-4000-8000-000000003205'), 'quente',
  'quente recém-criado, sem contato: quente e sem alerta (é o certo)');
update public.deals set created_at = now() - interval '90 days'
 where id = 'd0000000-0000-4000-8000-000000003205';
select is(pg_temp.temp_do_negocio('d0000000-0000-4000-8000-000000003205'), 'morno+alerta',
  'quente criado há 90 dias e nunca tocado: esfria para morno com alerta (PRD §5.6)');
update public.deals set created_at = now() - interval '90 days'
 where id = 'd0000000-0000-4000-8000-000000003208';
select is(pg_temp.temp_do_negocio('d0000000-0000-4000-8000-000000003208'), 'frio',
  'frio parado há 90 dias continua frio e sem alerta (os 100 leads reais não se mexem)');
select is(pg_temp.temp_do_negocio('d0000000-0000-4000-8000-000000003206'), 'morno',
  'morno recém-criado, sem contato: morno e sem alerta');


-- =====================================================================
-- 4. §3.12l — a tarefa de reengajar do PRD §5.6
-- =====================================================================
-- "Morno > 7 dias sem contato → alerta E TAREFA DE REENGAJAR." Só o alerta
-- existia. O contato suprimido não ganha tarefa nenhuma (guardrail do CLAUDE.md).
update public.deals set created_at = now() - interval '10 days'
 where id in ('d0000000-0000-4000-8000-000000003206', 'd0000000-0000-4000-8000-000000003207');
update public.organizations set do_not_contact = true where id = pg_temp.org('07');

select is(pg_temp.n_tarefas_reengajar('d0000000-0000-4000-8000-000000003206'), 0,
  'antes do recálculo: nenhuma tarefa de reengajar');
select ok(app.recompute_temperatures() >= 0, 'o recálculo diário roda');
select is(pg_temp.temp_do_negocio('d0000000-0000-4000-8000-000000003206'), 'morno+alerta',
  'morno parado há 10 dias: alerta ligado');
select is(pg_temp.n_tarefas_reengajar('d0000000-0000-4000-8000-000000003206'), 1,
  '§3.12l: e a tarefa de reengajar do PRD §5.6 nasce junto com o alerta');
select is(pg_temp.n_tarefas_reengajar('d0000000-0000-4000-8000-000000003207'), 0,
  'guardrail: contato suprimido não ganha tarefa de reengajar, em modo nenhum');
select ok(app.recompute_temperatures() >= 0, 'o recálculo roda de novo (é diário)');
select is(pg_temp.n_tarefas_reengajar('d0000000-0000-4000-8000-000000003206'), 1,
  'e não duplica: a tarefa de ontem ainda aberta é a tarefa de hoje');


-- =====================================================================
-- 5. O módulo de ligação: §3.12c, §3.12b, §3.12d e §3.12e
-- =====================================================================
-- A janela abre o dia inteiro DENTRO da transação (mesmo recurso do 15): sem
-- isso a suíte passaria às 15h e falharia às 3h. O rollback desfaz.
create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select h.de, h.ate from (values (0, 0::numeric, 24::numeric), (1, 0::numeric, 24::numeric),
    (2, 0::numeric, 24::numeric), (3, 0::numeric, 24::numeric), (4, 0::numeric, 24::numeric),
    (5, 0::numeric, 24::numeric), (6, 0::numeric, 24::numeric)) as h(dow, de, ate) where h.dow = p_dow
$$;
delete from public.holidays where date = pg_temp.hoje();

-- ---------- §3.12c: o "Vale até" esticado deixa de ser silencioso ----------
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000032a1', 'sdr');
  v := public.montar_lote('C32 tres tentativas', pg_temp.funil('fornecedor'), 'frio',
         pg_temp.roteiro(), array[933], 'prioridade', 1, 3, 20, null, pg_temp.hoje(), pg_temp.hoje());
  execute 'reset role';
  insert into pg_temp.r values ('lote3', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'montado' from pg_temp.r where chave = 'lote3'), 'true',
  'montagem: o lote de três tentativas foi montado');
select is((select (valor ->> 'prazo_esticado')::boolean from pg_temp.r where chave = 'lote3'), true,
  '§3.12c: pedir 1 dia com 3 tentativas ESTICA o prazo — e o recibo diz que esticou');
select is((select (valor ->> 'termina_em_pedido')::date from pg_temp.r where chave = 'lote3'), pg_temp.hoje(),
  '§3.12c: e diz qual foi a data pedida, para a tela poder contar a diferença');
select ok((select (valor ->> 'termina_em')::date from pg_temp.r where chave = 'lote3') > pg_temp.hoje(),
  '§3.12c: a data que valeu é maior que a pedida (o piso do D2 continua de pé)');

do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000032a1', 'sdr');
  v := public.montar_lote('C32 uma tentativa', pg_temp.funil('fornecedor'), 'frio',
         pg_temp.roteiro(), array[934], 'prioridade', 1, 1, 20, null, pg_temp.hoje(), pg_temp.hoje());
  execute 'reset role';
  insert into pg_temp.r values ('lote1', v);
end $$;
select pg_temp.sair();
select is((select (valor ->> 'prazo_esticado')::boolean from pg_temp.r where chave = 'lote1'), false,
  '§3.12c: quem pede uma tentativa em um dia recebe um dia, e o recibo não avisa nada');

-- ---------- §3.12b e §3.12d (espera): o lote de três tentativas ----------
do $$
declare v jsonb; v_item uuid; v_ch uuid;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000032a1', 'sdr');
  v := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote3'))::uuid);
  insert into pg_temp.r values ('proximo3', v);
  v_item := (v -> 'item' ->> 'id')::uuid;
  v := public.iniciar_chamada(v_item);
  v_ch := (v -> 'chamada' ->> 'id')::uuid;
  v := public.tabular_chamada(gen_random_uuid(), v_ch, v_item, 'nao_atendeu'::app.call_result,
                              'nao_informado', null, '{}', 9, null, '{}'::jsonb);
  insert into pg_temp.r values ('tab3', v);
  v := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote3'))::uuid);
  insert into pg_temp.r values ('espera3', v);
  execute 'reset role';
end $$;
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'proximo3'), 'true',
  'lote de três: o contato saiu da fila');
select is((select valor ->> 'tabulado' from pg_temp.r where chave = 'tab3'), 'true',
  'lote de três: a primeira tentativa foi tabulada');
select is((select (valor ->> 'volta_para_fila')::boolean from pg_temp.r where chave = 'tab3'), true,
  'lote de três: e o item volta para a fila (ainda restam duas tentativas)');
select alike(
  pg_temp.titulo_da_tarefa(((select valor -> 'registro' ->> 'task_id' from pg_temp.r where chave = 'tab3'))::uuid),
  '%tentativa 2 de 3%',
  '§3.12b: a tarefa diz em qual tentativa está — 2 de 3');
select unalike(
  pg_temp.titulo_da_tarefa(((select valor -> 'registro' ->> 'task_id' from pg_temp.r where chave = 'tab3'))::uuid),
  '%ltima%',
  '§3.12b: e não chama de última a tentativa que não é a última');
select is((select valor ->> 'ok' from pg_temp.r where chave = 'espera3'), 'false',
  'fila: na mesma hora não há mais ninguém para ligar neste lote');
select is((select valor ->> 'detalhe' from pg_temp.r where chave = 'espera3'), 'aguardando_intervalo',
  '§3.12d: item que só espera as 20 h entre tentativas não é "fila vazia" — é espera');
select ok((select (valor ->> 'volta_em')::timestamptz from pg_temp.r where chave = 'espera3') > now(),
  '§3.12d: e a fila diz A QUE HORAS ele volta');

-- ---------- §3.12d (teto): a ligação abandonada volta à fila no teto ----------
-- É o caminho real: a chamada foi aberta (conta tentativa) e a reserva de 30 min
-- caiu sem tabulação. O item volta para a fila JÁ no teto e some da consulta.
do $$
declare v jsonb; v_item uuid;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000032a1', 'sdr');
  v := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid);
  v_item := (v -> 'item' ->> 'id')::uuid;
  perform public.iniciar_chamada(v_item);
  execute 'reset role';
  update public.call_batch_items set reserved_until = now() - interval '1 minute' where id = v_item;
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000032a1', 'sdr');
  v := public.proximo_da_fila(((select valor ->> 'lote_id' from pg_temp.r where chave = 'lote1'))::uuid);
  insert into pg_temp.r values ('teto1', v);
  execute 'reset role';
end $$;
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'teto1'), 'false',
  'fila: com a única tentativa gasta, o lote não entrega mais ninguém');
select is((select valor ->> 'detalhe' from pg_temp.r where chave = 'teto1'), 'tentativas_esgotadas',
  '§3.12d: e o motivo é NOMEADO — teto de tentativas, não "fila vazia" genérica');
select is((select (valor ->> 'itens_no_teto')::int from pg_temp.r where chave = 'teto1'), 1,
  '§3.12d: com a contagem de quantos bateram no teto (informação acionável)');

-- ---------- §3.12e: item suprimido no meio da ligação sai de "restantes" ----------
do $$
declare v jsonb; v_item uuid; v_ch uuid; v_lote uuid;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000032a1', 'sdr');
  v := public.montar_lote('C32 restantes', pg_temp.funil('fornecedor'), 'frio',
         pg_temp.roteiro(), array[935], 'prioridade', 3, 3, 20, null, pg_temp.hoje(), null);
  insert into pg_temp.r values ('loteR', v);
  v_lote := (v ->> 'lote_id')::uuid;
  v := public.proximo_da_fila(v_lote);
  insert into pg_temp.r values ('proximoR', v);
  v_item := (v -> 'item' ->> 'id')::uuid;
  v := public.iniciar_chamada(v_item);
  v_ch := (v -> 'chamada' ->> 'id')::uuid;
  execute 'reset role';
  -- No meio da ligação, um dos OUTROS alvos do lote pede para parar por WhatsApp.
  update public.organizations set do_not_contact = true
   where id = (select x.organization_id from public.call_batch_items x
                where x.batch_id = v_lote and x.status = 'fila'::app.call_item_status
                order by x.position limit 1);
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000032a1', 'sdr');
  v := public.tabular_chamada(gen_random_uuid(), v_ch, v_item, 'nao_atendeu'::app.call_result,
                              'nao_informado', null, '{}', 7, null, '{}'::jsonb);
  insert into pg_temp.r values ('tabR', v);
  execute 'reset role';
end $$;
select pg_temp.sair();
select is((select (valor ->> 'entraram')::int from pg_temp.r where chave = 'loteR'), 3,
  'restantes: o lote nasceu com três itens');
select is((select (valor ->> 'restantes')::int from pg_temp.r where chave = 'proximoR'), 3,
  'restantes: com todo mundo limpo, os três contam');
select is((select (valor ->> 'restantes')::int from pg_temp.r where chave = 'tabR'), 2,
  '§3.12e: quem foi suprimido no meio da ligação sai de "restantes" na hora, não em 30 min');

select * from finish();
rollback;

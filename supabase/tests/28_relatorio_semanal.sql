-- =====================================================================
-- pgTAP — O relatório de segunda (migração 20260905000700):
--   public.weekly_reports · app.relatorio_semanal_numeros / _fatos / _texto
--   / _gravar / _cron · public.relatorio_semanal_gerar
--   · public.relatorio_semanal · public.relatorios_semanais
--
-- COMO ESTE ARQUIVO MEDE
--   Em DELTA, nunca em número absoluto. O banco de desenvolvimento tem 100
--   organizações reais de Natal e a suíte roda depois de outros arquivos: fixar
--   "portas_batidas = 7" seria fixar o estado do banco, não o comportamento da
--   função. Cada asserção tira uma foto ANTES, insere um fato conhecido e
--   confere que o número mexeu EXATAMENTE o quanto devia.
--
-- A semana escolhida (06/07 a 12/07/2026) fica longe do presente de propósito:
-- nenhum dado da seed, da carga de leads ou dos outros testes cai nela, então o
-- delta é só o que este arquivo colocou.
--
-- O que ele prova, além do caminho feliz:
--   1) o teto do RF-MET-01 vale dentro do relatório da semana: a segunda
--      ligação para o mesmo alvo no mesmo dia NÃO vira uma segunda porta;
--   2) o relatório não afirma tendência sem base nos dois lados;
--   3) publicados e cadastros saem marcados como PROXY do funil;
--   4) o texto não vaza telefone nem nome de fornecedor (é contagem, e revelar
--      contato tem caminho próprio e auditado);
--   5) embaixador não abre o relatório, e ninguém escreve em weekly_reports
--      pela API — nem insert, nem update, nem delete.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(76);

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
create function pg_temp.desfecho(p_slug text) returns int language sql as $$
  select id from public.interaction_outcomes where slug = p_slug
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_slug
$$;
create function pg_temp.fonte() returns int language sql as $$
  select id from public.sources where slug = 'captura_campo'
$$;

-- A semana medida e a anterior. Datas fixas: a conta de "que segunda é essa"
-- não pode depender do dia em que alguém aperta enter.
create function pg_temp.semana() returns date language sql immutable as $$ select date '2026-07-06' $$;
create function pg_temp.dia(p_offset int, p_hora int) returns timestamptz language sql stable as $$
  select ((pg_temp.semana() + p_offset)::timestamp + make_interval(hours => p_hora))
         at time zone 'America/Fortaleza'
$$;

-- Um número do relatório, pela chave. É o leitor que todas as asserções usam.
create function pg_temp.numero(p_chave text) returns int language sql stable as $$
  select (x ->> 'semana')::int
    from public.weekly_reports r,
         lateral jsonb_array_elements(r.fatos -> 'numeros') x
   where r.semana_inicio = pg_temp.semana() and x ->> 'chave' = p_chave
$$;
-- O número de uma regra de atenção, pela chave. Lê `atencao_todas` (todas as que
-- dispararam) e não `atencao` (as três exibidas): a asserção não pode depender de
-- a regra estar entre as três mais pesadas do dia.
create function pg_temp.atencao(p_chave text) returns int language sql stable as $$
  select coalesce((select (x ->> 'numero')::int
                     from public.weekly_reports r,
                          lateral jsonb_array_elements(r.fatos -> 'atencao_todas') x
                    where r.semana_inicio = pg_temp.semana() and x ->> 'chave' = p_chave), 0)
$$;
create function pg_temp.marca(p_chave text, p_campo text) returns boolean language sql stable as $$
  select (x ->> p_campo)::boolean
    from public.weekly_reports r,
         lateral jsonb_array_elements(r.fatos -> 'numeros') x
   where r.semana_inicio = pg_temp.semana() and x ->> 'chave' = p_chave
$$;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('rs.gestor@teste.local', 'gestor',     'pgTAP relatório semanal'),
  ('rs.sdr@teste.local',    'sdr',        'pgTAP relatório semanal'),
  ('rs.emb@teste.local',    'embaixador', 'pgTAP relatório semanal');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a2800000-0000-4000-8000-000000002801', 'rs.gestor@teste.local', '{"full_name":"Gestor Semanal"}'),
  ('a2800000-0000-4000-8000-000000002802', 'rs.sdr@teste.local',    '{"full_name":"SDR Semanal"}'),
  ('a2800000-0000-4000-8000-000000002803', 'rs.emb@teste.local',    '{"full_name":"Embaixador Semanal"}');

-- ---------- alvos e negócios ----------
-- Sete organizações e sete negócios no funil de fornecedor. Nenhuma delas tem
-- atividade anterior, o que deixa a regra dos 30 dias da porta aberta livre.
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, owner_id)
select ('c2800000-0000-4000-8000-00000000280' || i)::uuid,
       'RS Alvo ' || i, '+5584999928' || lpad(i::text, 3, '0'), 'Tirol',
       pg_temp.fonte(), 'a2800000-0000-4000-8000-000000002802'
  from generate_series(1, 7) i;

insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id)
select ('d2800000-0000-4000-8000-00000000280' || i)::uuid,
       ('c2800000-0000-4000-8000-00000000280' || i)::uuid,
       (select id from public.pipelines where slug = 'fornecedor'),
       pg_temp.etapa('fornecedor', 'prospectado'),
       'a2800000-0000-4000-8000-000000002802'
  from generate_series(1, 7) i;

-- =====================================================================
-- 1. A FOTO DE ANTES
-- =====================================================================
select app.relatorio_semanal_gravar(pg_temp.semana(), 'cron', null);

create temporary table rs_antes as
select x ->> 'chave' as chave, (x ->> 'semana')::int as valor
  from public.weekly_reports r, lateral jsonb_array_elements(r.fatos -> 'numeros') x
 where r.semana_inicio = pg_temp.semana();

create function pg_temp.antes(p_chave text) returns int language sql stable as $$
  select valor from rs_antes where chave = p_chave
$$;
create function pg_temp.delta(p_chave text) returns int language sql stable as $$
  select pg_temp.numero(p_chave) - pg_temp.antes(p_chave)
$$;

select is((select count(*)::int from public.weekly_reports where semana_inicio = pg_temp.semana()), 1,
  'a semana é gravada uma vez só, chaveada pela segunda-feira');
select is((select semana_fim from public.weekly_reports where semana_inicio = pg_temp.semana()),
          pg_temp.semana() + 6,
  'a semana guardada fecha em domingo (início + 6)');
select is((select parcial from public.weekly_reports where semana_inicio = pg_temp.semana()), false,
  'semana já terminada não é marcada como parcial');

-- =====================================================================
-- 2. OS FATOS DA SEMANA
-- =====================================================================

-- 2.1 Atividades. A ligação repetida para o MESMO alvo no MESMO dia existe de
-- propósito: ela precisa NÃO virar uma segunda porta batida (RF-MET-01).
insert into public.activities (type, organization_id, deal_id, user_id, occurred_at, channel, outcome_id)
values
  ('call', 'c2800000-0000-4000-8000-000000002801', 'd2800000-0000-4000-8000-000000002801',
   'a2800000-0000-4000-8000-000000002802', pg_temp.dia(1, 10), 'phone', pg_temp.desfecho('lig_nao_atendeu')),
  ('call', 'c2800000-0000-4000-8000-000000002801', 'd2800000-0000-4000-8000-000000002801',
   'a2800000-0000-4000-8000-000000002802', pg_temp.dia(1, 15), 'phone', pg_temp.desfecho('lig_nao_atendeu')),
  ('call', 'c2800000-0000-4000-8000-000000002802', 'd2800000-0000-4000-8000-000000002802',
   'a2800000-0000-4000-8000-000000002802', pg_temp.dia(1, 11), 'phone', pg_temp.desfecho('lig_nao_atendeu')),
  ('call', 'c2800000-0000-4000-8000-000000002803', 'd2800000-0000-4000-8000-000000002803',
   'a2800000-0000-4000-8000-000000002802', pg_temp.dia(2, 11), 'phone', pg_temp.desfecho('lig_nao_atendeu'));

-- Porta ABERTA é teto mais testemunha: sem `com_quem` o catálogo grava só a
-- batida (regra de app.activities_apply_outcome, RF-MET-06).
insert into public.activities
  (type, organization_id, deal_id, user_id, occurred_at, channel, outcome_id, metadata)
values
  ('call', 'c2800000-0000-4000-8000-000000002804', 'd2800000-0000-4000-8000-000000002804',
   'a2800000-0000-4000-8000-000000002802', pg_temp.dia(2, 12), 'phone',
   pg_temp.desfecho('lig_interessado'), '{"com_quem":"decisor"}'::jsonb),
  ('call', 'c2800000-0000-4000-8000-000000002805', 'd2800000-0000-4000-8000-000000002805',
   'a2800000-0000-4000-8000-000000002802', pg_temp.dia(3, 12), 'phone',
   pg_temp.desfecho('lig_interessado'), '{"com_quem":"decisor"}'::jsonb),
  ('meeting', 'c2800000-0000-4000-8000-000000002806', 'd2800000-0000-4000-8000-000000002806',
   'a2800000-0000-4000-8000-000000002802', pg_temp.dia(3, 14), 'other',
   pg_temp.desfecho('reu_interessado'), '{"com_quem":"decisor"}'::jsonb),
  ('meeting', 'c2800000-0000-4000-8000-000000002806', 'd2800000-0000-4000-8000-000000002806',
   'a2800000-0000-4000-8000-000000002802', pg_temp.dia(4, 14), 'other',
   pg_temp.desfecho('reu_no_show'), '{}'::jsonb);

-- 2.2 Movimentos de etapa: 5 avanços, 2 esfriadas.
insert into public.deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by, changed_at)
values
  ('d2800000-0000-4000-8000-000000002801', pg_temp.etapa('fornecedor','prospectado'),
   pg_temp.etapa('fornecedor','reuniao_marcada'),       'a2800000-0000-4000-8000-000000002802', pg_temp.dia(1, 16)),
  ('d2800000-0000-4000-8000-000000002802', pg_temp.etapa('fornecedor','prospectado'),
   pg_temp.etapa('fornecedor','reuniao_marcada'),       'a2800000-0000-4000-8000-000000002802', pg_temp.dia(2, 16)),
  ('d2800000-0000-4000-8000-000000002803', pg_temp.etapa('fornecedor','em_conversa'),
   pg_temp.etapa('fornecedor','autorizou'),             'a2800000-0000-4000-8000-000000002802', pg_temp.dia(2, 17)),
  ('d2800000-0000-4000-8000-000000002804', pg_temp.etapa('fornecedor','autorizou'),
   pg_temp.etapa('fornecedor','cadastro_em_andamento'), 'a2800000-0000-4000-8000-000000002802', pg_temp.dia(3, 16)),
  ('d2800000-0000-4000-8000-000000002805', pg_temp.etapa('fornecedor','cadastro_em_andamento'),
   pg_temp.etapa('fornecedor','publicado'),             'a2800000-0000-4000-8000-000000002802', pg_temp.dia(4, 16)),
  ('d2800000-0000-4000-8000-000000002806', pg_temp.etapa('fornecedor','em_conversa'),
   pg_temp.etapa('fornecedor','nutricao'),              'a2800000-0000-4000-8000-000000002802', pg_temp.dia(4, 17)),
  ('d2800000-0000-4000-8000-000000002807', pg_temp.etapa('fornecedor','contatado'),
   pg_temp.etapa('fornecedor','perdido'),               'a2800000-0000-4000-8000-000000002802', pg_temp.dia(5, 17));

-- 2.3 Um pedido para não contatar, duas próximas ações com prazo (uma cumprida)
-- e um alvo novo nascido dentro da semana.
insert into public.consent_events (kind, organization_id, channel, occurred_at, evidence_text)
values ('contact_optout', 'c2800000-0000-4000-8000-000000002807', 'whatsapp',
        pg_temp.dia(3, 9), 'pgTAP: pediu para sair');

insert into public.tasks (title, kind, status, due_at, assignee_id, organization_id, completed_at)
values ('RS retornar ligação', 'call', 'done', pg_temp.dia(2, 12),
        'a2800000-0000-4000-8000-000000002802', 'c2800000-0000-4000-8000-000000002801',
        pg_temp.dia(2, 11)),
       ('RS enviar proposta',  'other', 'todo', pg_temp.dia(3, 12),
        'a2800000-0000-4000-8000-000000002802', 'c2800000-0000-4000-8000-000000002802', null);

insert into public.organizations (id, name, phone_e164, neighborhood, source_id, created_at)
values ('c2800000-0000-4000-8000-000000002808', 'RS Alvo Nascido Na Semana',
        '+5584999928808', 'Tirol', pg_temp.fonte(), pg_temp.dia(2, 8));

-- 2.4 A semana ANTERIOR, só para dar base à comparação de portas batidas.
insert into public.activities (type, organization_id, deal_id, user_id, occurred_at, channel, outcome_id)
select 'call', ('c2800000-0000-4000-8000-00000000280' || i)::uuid,
       ('d2800000-0000-4000-8000-00000000280' || i)::uuid,
       'a2800000-0000-4000-8000-000000002802',
       ((pg_temp.semana() - 7 + i)::timestamp + interval '10 hours') at time zone 'America/Fortaleza',
       'phone', pg_temp.desfecho('lig_nao_atendeu')
  from generate_series(1, 6) i;

select app.relatorio_semanal_gravar(pg_temp.semana(), 'cron', null);

-- ---------- os deltas ----------
select is(pg_temp.delta('portas_batidas'), 7,
  'portas batidas: 8 atividades, 7 portas — a segunda ligação ao mesmo alvo no mesmo dia não conta (RF-MET-01)');
select is(pg_temp.delta('portas_abertas'), 3,
  'portas abertas: só as três com "com_quem" preenchido; o no-show não abre porta');
select is(pg_temp.delta('ligacoes'), 6,
  'ligações: conta toda atividade de ligação, sem o teto por alvo');
select is(pg_temp.delta('visitas'), 0, 'visitas: nenhuma foi registrada nesta semana');
select is(pg_temp.delta('mensagens'), 0, 'mensagens: nenhuma foi registrada nesta semana');
select is(pg_temp.delta('reunioes_realizadas'), 1,
  'reuniões realizadas: a reunião com desfecho conta, o no-show não');
select is(pg_temp.delta('reunioes_marcadas'), 2,
  'reuniões marcadas: as duas entradas em Reunião marcada');
select is(pg_temp.delta('autorizacoes'), 1, 'autorizações: a entrada em Autorizou');
select is(pg_temp.delta('cadastros_iniciados'), 1, 'cadastros iniciados: a entrada em Cadastro em andamento');
select is(pg_temp.delta('publicados'), 1, 'publicados: o negócio ganho no funil de fornecedor');
select is(pg_temp.delta('avancos'), 5,
  'avanços: cinco subidas na linha do funil — nutrição e perdido não são avanço');
select is(pg_temp.delta('esfriaram'), 2, 'esfriaram: a ida para Nutrição e a ida para Perdido');
select is(pg_temp.delta('optouts'), 1, 'opt-outs: o pedido para não contatar da semana');
select is(pg_temp.delta('alvos_novos'), 1, 'alvos novos: só o que nasceu dentro da semana');
select is(pg_temp.delta('tarefas_com_prazo'), 2, 'próximas ações com prazo: as duas com due_at na semana');
select is(pg_temp.delta('tarefas_no_prazo'), 1, 'próximas ações no prazo: só a concluída antes do prazo');

-- =====================================================================
-- 3. O RELATÓRIO NÃO INVENTA TENDÊNCIA
-- =====================================================================
select ok(pg_temp.marca('portas_batidas', 'comparavel'),
  'portas batidas: com base nos dois lados, a comparação é declarada comparável');
select ok(not pg_temp.marca('portas_abertas', 'comparavel'),
  'portas abertas: sem base na semana anterior, a comparação NÃO é comparável');
select ok((select texto from public.weekly_reports where semana_inicio = pg_temp.semana())
            like '%Com esta base ainda não dá para chamar de tendência.%',
  'o texto diz, por escrito, quando não dá para tirar tendência');
select ok((select texto from public.weekly_reports where semana_inicio = pg_temp.semana())
            not like '%tendência de alta%',
  'o texto nunca afirma alta ou baixa em cima de dois pontos pequenos');

-- =====================================================================
-- 4. PROXY DECLARADO (o que é do funil e não da plataforma Komune)
-- =====================================================================
select ok(pg_temp.marca('publicados', 'proxy'), 'publicados vem marcado como proxy do funil');
select ok(pg_temp.marca('cadastros_iniciados', 'proxy'), 'cadastros iniciados vem marcado como proxy do funil');
select ok(not pg_temp.marca('portas_batidas', 'proxy'), 'portas batidas não é proxy: é dado do próprio CRM');
select ok((select texto from public.weekly_reports where semana_inicio = pg_temp.semana())
            like '%plataforma Komune%',
  'o texto avisa que publicados e cadastros saem do funil, não da plataforma Komune');
select ok((select texto from public.weekly_reports where semana_inicio = pg_temp.semana())
            like '%entrega automática%',
  'o texto avisa que a entrega automática depende de um canal que ainda não existe');

-- =====================================================================
-- 5. O TEXTO NÃO VAZA CONTATO NEM NOME DE FORNECEDOR
-- =====================================================================
select ok((select texto from public.weekly_reports where semana_inicio = pg_temp.semana())
            not like '%+55%',
  'guardrail: o texto do relatório não traz telefone nenhum');
select ok((select texto from public.weekly_reports where semana_inicio = pg_temp.semana())
            not like '%RS Alvo%',
  'guardrail: o texto do relatório não nomeia fornecedor — é contagem, não lista');
select ok((select r.fatos::text from public.weekly_reports r where r.semana_inicio = pg_temp.semana())
            not like '%+55%',
  'guardrail: os fatos guardados também não trazem telefone');

-- =====================================================================
-- 6. O QUE MERECE ATENÇÃO
-- =====================================================================
select ok((select jsonb_array_length(fatos -> 'atencao')
             from public.weekly_reports where semana_inicio = pg_temp.semana()) <= 3,
  'no máximo três coisas merecem atenção: a quarta não cabe no celular de ninguém');
select ok((select bool_and((x ->> 'numero')::int > 0)
             from public.weekly_reports r, lateral jsonb_array_elements(r.fatos -> 'atencao') x
            where r.semana_inicio = pg_temp.semana()),
  'nenhum item de atenção entra com número zero: alerta inventado é ruído');
select ok((select bool_and(x ? 'titulo' and x ? 'texto' and x ? 'chave')
             from public.weekly_reports r, lateral jsonb_array_elements(r.fatos -> 'atencao') x
            where r.semana_inicio = pg_temp.semana()),
  'todo item de atenção diz o quê e por quê, não só o número');

-- =====================================================================
-- 7. A LISTA DO QUE AVANÇOU E DO QUE ESFRIOU
-- =====================================================================
select is((select (x ->> 'n')::int
             from public.weekly_reports r, lateral jsonb_array_elements(r.fatos -> 'avancos') x
            where r.semana_inicio = pg_temp.semana() and x ->> 'etapa' = 'Reunião marcada'), 2,
  'o que avançou vem quebrado por etapa de destino');
select ok((select bool_or(x ->> 'etapa' = 'Nutrição / dormente')
             from public.weekly_reports r, lateral jsonb_array_elements(r.fatos -> 'esfriaram') x
            where r.semana_inicio = pg_temp.semana()),
  'o que esfriou nomeia a etapa para onde foi');
select ok((select texto from public.weekly_reports where semana_inicio = pg_temp.semana())
            like '%Reunião marcada%',
  'o texto lista as etapas que receberam movimento');

-- =====================================================================
-- 8. NORMALIZAÇÃO, IDEMPOTÊNCIA E O CRON
-- =====================================================================
select is(app.relatorio_semanal_gravar(pg_temp.semana() + 3, 'cron', null), pg_temp.semana(),
  'uma data no meio da semana é normalizada para a segunda-feira');
select is((select count(*)::int from public.weekly_reports where semana_inicio = pg_temp.semana()), 1,
  'gerar de novo reescreve a mesma linha: uma semana, um relatório');

select pg_temp.entrar('a2800000-0000-4000-8000-000000002801', 'gestor');
select is(public.relatorio_semanal_gerar(pg_temp.semana()), pg_temp.semana(),
  'gestor gera o relatório de uma semana fechada');
select pg_temp.sair();
select is((select gerado_por from public.weekly_reports where semana_inicio = pg_temp.semana()), 'manual',
  'gerar pela tela marca a origem como manual');
select is((select p.full_name from public.weekly_reports r
             join public.profiles p on p.id = r.gerado_por_id
            where r.semana_inicio = pg_temp.semana()), 'Gestor Semanal',
  'gerar pela tela guarda quem pediu');

select is(app.relatorio_semanal_cron(),
          (date_trunc('week', ((now() at time zone 'America/Fortaleza')::date - 7)::timestamp))::date,
  'o cron gera a semana que acabou, nunca a que está em curso');
select is((select parcial from public.weekly_reports
            where semana_inicio = (date_trunc('week',
                    ((now() at time zone 'America/Fortaleza')::date - 7)::timestamp))::date), false,
  'a semana que o cron gera já está fechada, então não é parcial');

select pg_temp.entrar('a2800000-0000-4000-8000-000000002801', 'gestor');
select throws_ok(
  format('select public.relatorio_semanal_gerar(date %L)',
         (now() at time zone 'America/Fortaleza')::date + 30),
  '22007', null, 'semana que ainda não começou é recusada, em vez de gerar um relatório vazio');
select pg_temp.sair();

-- =====================================================================
-- 9. A LEITURA DA TELA
-- =====================================================================
-- A semana em curso é gravada de propósito, para a próxima asserção ter o que
-- ignorar: sem parâmetro, a tela precisa abrir na semana FECHADA mais recente.
select is(app.relatorio_semanal_gravar((now() at time zone 'America/Fortaleza')::date, 'cron', null),
          (date_trunc('week', (now() at time zone 'America/Fortaleza')::date::timestamp))::date,
  'a semana em curso também pode ser gravada, marcada como parcial');
select is((select parcial from public.weekly_reports
            where semana_inicio = (date_trunc('week',
                    (now() at time zone 'America/Fortaleza')::date::timestamp))::date), true,
  'a semana que ainda não acabou é marcada como parcial');

select pg_temp.entrar('a2800000-0000-4000-8000-000000002802', 'sdr');
select is((select parcial from public.relatorio_semanal(null)), false,
  'sem parâmetro, a tela abre na semana fechada mais recente, nunca na que está em curso');
select is((select count(*)::int from public.relatorio_semanal(pg_temp.semana())), 1,
  'sdr abre o relatório de uma semana guardada');
select is((select rotulo from public.relatorio_semanal(pg_temp.semana())), '06/07 a 12/07',
  'o rótulo da semana sai pronto para ler (dia/mês a dia/mês)');
select is((select count(*)::int from public.relatorios_semanais(8)), 8,
  'o seletor devolve as últimas oito semanas civis, geradas ou não');
select ok((select bool_or(not gerado) from public.relatorios_semanais(8)),
  'a semana que ninguém gerou aparece na lista marcada como não gerada');
select ok((select gerado from public.relatorios_semanais(52)
            where semana_inicio = pg_temp.semana()),
  'a semana gerada aparece marcada como gerada');
select is((select count(*)::int from public.weekly_reports where semana_inicio = pg_temp.semana()), 1,
  'sdr enxerga a linha guardada de weekly_reports (RLS de leitura)');

-- Ninguém escreve em weekly_reports pela API: não há política de escrita.
select throws_ok(
  $$insert into public.weekly_reports (semana_inicio, semana_fim, fatos, texto)
    values (date '2020-01-06', date '2020-01-12', '{}'::jsonb, 'inventado')$$,
  '42501', null, 'sdr não insere relatório à mão: o relatório é registro, não rascunho');
select ok(not has_table_privilege('authenticated', 'public.weekly_reports', 'UPDATE'),
  'authenticated não tem sequer o privilégio de UPDATE em weekly_reports');
select throws_ok(
  $$update public.weekly_reports set texto = 'reescrito' where semana_inicio = date '2026-07-06'$$,
  '42501', null, 'sdr não reescreve o texto de um relatório guardado');
select throws_ok(
  $$delete from public.weekly_reports where semana_inicio = date '2026-07-06'$$,
  '42501', null, 'sdr não apaga um relatório guardado');

-- As funções internas não são superfície de API.
select throws_ok($$select app.relatorio_semanal_gravar(date '2026-07-06', 'manual', null)$$,
  '42501', null, 'authenticated não chama a gravação interna do relatório');
select throws_ok($$select app.relatorio_semanal_fatos(date '2026-07-06')$$,
  '42501', null, 'authenticated não chama a montagem interna dos fatos');
select throws_ok($$select app.relatorio_semanal_numeros(date '2026-07-06', date '2026-07-12')$$,
  '42501', null, 'authenticated não lê os números por dentro (eles vêm de app.portas_contadas)');
select pg_temp.sair();

-- =====================================================================
-- 10. EMBAIXADOR NÃO ABRE RELATÓRIO DO TIME (RF-ADM-01)
-- =====================================================================
select pg_temp.entrar('a2800000-0000-4000-8000-000000002803', 'embaixador');
select throws_ok($$select * from public.relatorio_semanal(null)$$,
  '42501', null, 'embaixador não abre o relatório de segunda');
select throws_ok($$select * from public.relatorios_semanais(8)$$,
  '42501', null, 'embaixador não lista as semanas');
select throws_ok($$select public.relatorio_semanal_gerar(null)$$,
  '42501', null, 'embaixador não gera relatório');
select is((select count(*)::int from public.weekly_reports), 0,
  'embaixador não enxerga linha nenhuma de weekly_reports');
select pg_temp.sair();

-- =====================================================================
-- 11. OS UTILITÁRIOS DE ESCRITA
-- =====================================================================
select is(app.numero_pt(1234567), '1.234.567', 'número sai com ponto de milhar do português');
select is(app.numero_pt(null), '—', 'número ausente vira travessão, não zero');
select is(app.percentual_pt(28.04), '28,0%', 'percentual sai com vírgula decimal');
select is(app.plural_pt(1, 'porta', 'portas'), 'porta', 'concordância no singular');
select is(app.frase_variacao_semanal(
            '{"semana":0,"anterior":0,"delta":0,"comparavel":false}'::jsonb),
          'Zero nas duas semanas.',
  'zero dos dois lados é dito como zero, não escondido');
select is(app.frase_variacao_semanal(
            '{"semana":12,"anterior":7,"delta":5,"comparavel":true}'::jsonb),
          '5 a mais que na semana passada (7).',
  'com base nos dois lados, a frase diz a diferença e o número de trás');
select is(app.lista_de_etapas('[{"etapa":"Contatado","n":4},{"etapa":"Respondeu","n":2}]'::jsonb),
          '4 para Contatado e 2 para Respondeu',
  'a lista de etapas fecha com "e", que é como se fala');

-- =====================================================================
-- 12. GUARDRAIL: QUEM PEDIU PARA SAIR NÃO VIRA COBRANÇA
-- =====================================================================
-- As três regras de atenção que são CHAMADO PARA AGIR não podem cobrar retorno de
-- um alvo suprimido: cobrar visita a quem pediu para parar é convidar ao toque
-- proibido, e o CLAUDE.md não abre exceção nem para número agregado.
--
-- O par é sempre o mesmo: um alvo normal e um suprimido, nas MESMAS condições. O
-- delta tem de ser 1, e não 2 — se a exclusão sumir, esta asserção vira 2 e 1.
create temporary table rs_atencao_antes as
select 'sem_proxima_acao'::text as chave, pg_temp.atencao('sem_proxima_acao') as valor
union all select 'quentes_parados', pg_temp.atencao('quentes_parados')
union all select 'portas_sem_retorno', pg_temp.atencao('portas_sem_retorno');

create function pg_temp.atencao_delta(p_chave text) returns int language sql stable as $$
  select pg_temp.atencao(p_chave) - (select valor from rs_atencao_antes where chave = p_chave)
$$;

insert into public.organizations (id, name, phone_e164, neighborhood, source_id, do_not_contact)
values ('c2800000-0000-4000-8000-000000002811', 'RS Alvo Normal Guardrail',
        '+5584999928811', 'Tirol', pg_temp.fonte(), false),
       ('c2800000-0000-4000-8000-000000002812', 'RS Alvo Suprimido Guardrail',
        '+5584999928812', 'Tirol', pg_temp.fonte(), true),
       ('c2800000-0000-4000-8000-000000002813', 'RS Alvo Normal Porta',
        '+5584999928813', 'Tirol', pg_temp.fonte(), false),
       ('c2800000-0000-4000-8000-000000002814', 'RS Alvo Suprimido Porta',
        '+5584999928814', 'Tirol', pg_temp.fonte(), true);

-- Dois negócios quentes, parados muito além do SLA de 24 h da etapa, sem próxima
-- ação marcada. Um dos alvos pediu para sair.
insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id,
                          entered_stage_at, last_activity_at, next_action_at)
select ('d2800000-0000-4000-8000-00000000281' || i)::uuid,
       ('c2800000-0000-4000-8000-00000000281' || i)::uuid,
       (select id from public.pipelines where slug = 'fornecedor'),
       pg_temp.etapa('fornecedor', 'reuniao_marcada'),
       'a2800000-0000-4000-8000-000000002802',
       now() - interval '30 days', now() - interval '30 days', null
  from generate_series(1, 2) i;

-- Duas portas abertas na semana, sem nenhum toque depois. Um dos alvos pediu para sair.
insert into public.activities
  (type, organization_id, user_id, occurred_at, channel, outcome_id, metadata)
select 'call', ('c2800000-0000-4000-8000-00000000281' || i)::uuid,
       'a2800000-0000-4000-8000-000000002802', pg_temp.dia(5, 10), 'phone',
       pg_temp.desfecho('lig_interessado'), '{"com_quem":"decisor"}'::jsonb
  from generate_series(3, 4) i;

select app.relatorio_semanal_gravar(pg_temp.semana(), 'cron', null);

select is(pg_temp.atencao_delta('sem_proxima_acao'), 1,
  'guardrail: negócio sem próxima ação de alvo suprimido não entra na cobrança');
select is(pg_temp.atencao_delta('quentes_parados'), 1,
  'guardrail: negócio quente parado de alvo suprimido não entra na cobrança');
select is(pg_temp.atencao_delta('portas_sem_retorno'), 1,
  'guardrail: porta aberta de alvo suprimido não vira "ninguém voltou"');
select ok((select count(*) from public.weekly_reports r,
                  lateral jsonb_array_elements(r.fatos -> 'atencao') x
            where r.semana_inicio = pg_temp.semana()
              and not exists (select 1
                                from lateral jsonb_array_elements(r.fatos -> 'atencao_todas') y
                               where y ->> 'chave' = x ->> 'chave')) = 0,
  'as três exibidas são sempre um recorte da lista completa, nunca outra lista');

select * from finish();
rollback;

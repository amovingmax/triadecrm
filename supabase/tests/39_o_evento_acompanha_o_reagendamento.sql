-- =====================================================================
-- pgTAP — O evento acompanha o reagendamento
--         (migração 20260909100000_o_evento_acompanha_o_reagendamento.sql)
--
-- O bug que estas asserções travam: reagendar FECHA a tarefa da reunião e insere
-- uma NOVA. Como o espelho do Google é chaveado por `task_id`, ele continuava na
-- tarefa fechada, e o evento ficava no horário velho — na agenda do fornecedor,
-- onde ninguém da Komune olharia.
--
-- As três que mais importam:
--
--   1. O espelho MUDA de tarefa, e continua sendo um só. Duplicar o espelho faria
--      as duas reuniões mostrarem o mesmo link.
--   2. Quando a tarefa nova NÃO é encontrada, a função recusa sem mexer em nada.
--      Mover o espelho para a tarefa errada é pior que deixá-lo parado.
--   3. `agenda_google_token_do_evento` devolve o token de QUEM CRIOU, e não o de
--      quem está clicando: o evento vive na agenda de quem o criou, e o token de
--      outra pessoa recebe 404 do Google.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(15);

create table pg_temp.r (chave text primary key, valor jsonb);

-- ---------- gente ----------
insert into public.allowed_users (email, role, note)
values ('c39.a@teste.local', 'sdr', 'pgTAP reagendamento'),
       ('c39.b@teste.local', 'sdr', 'pgTAP reagendamento');
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-0000000039a1', 'c39.a@teste.local', '{"full_name":"Quem criou C39"}'),
       ('a0000000-0000-4000-8000-0000000039a2', 'c39.b@teste.local', '{"full_name":"Quem remarca C39"}');

-- Quem CRIOU o evento tem agenda conectada; quem remarca, não. É o cenário que
-- motivou `agenda_google_token_do_evento`.
select app.agenda_google_guardar('a0000000-0000-4000-8000-0000000039a1',
                                 'refresh-de-quem-criou', 'criou@gmail.com', '{calendar.events}');

-- ---------- ficha, negócio e as duas tarefas ----------
insert into public.categories (id, slug, name, "group", priority, position)
values (939, 'c39_teste', 'Categoria do teste de reagendamento', 'servicos', 2, 939);
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind)
values ('c0000000-0000-4000-8000-000000003901', 'C39 Buffet do Reagendamento',
        '+5584999390001', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor');
insert into public.organization_categories (organization_id, category_id, is_primary)
values ('c0000000-0000-4000-8000-000000003901', 939, true);

insert into public.deals (id, organization_id, pipeline_id, stage_id)
values ('d0000000-0000-4000-8000-000000003901',
        'c0000000-0000-4000-8000-000000003901',
        (select p.id from public.pipelines p order by p.position limit 1),
        (select s.id from public.stages s
          where s.pipeline_id = (select p.id from public.pipelines p order by p.position limit 1)
          order by s.position limit 1));

-- A reunião original, que já foi para o Google e depois foi fechada pelo
-- reagendamento.
insert into public.tasks (id, title, kind, status, due_at, assignee_id, organization_id, deal_id, created_by, origin)
values ('e0000000-0000-4000-8000-000000003901', 'Reunião marcada', 'meeting', 'done',
        '2026-09-15 14:00:00-03', 'a0000000-0000-4000-8000-0000000039a1',
        'c0000000-0000-4000-8000-000000003901', 'd0000000-0000-4000-8000-000000003901',
        'a0000000-0000-4000-8000-0000000039a1', 'system');

-- A tarefa nova, como `move_deal` a insere: mesmo negócio, kind meeting, aberta,
-- com o horário combinado.
insert into public.tasks (id, title, kind, status, due_at, assignee_id, organization_id, deal_id, created_by, origin)
values ('e0000000-0000-4000-8000-000000003902', 'Reunião marcada — formato: meet', 'meeting', 'todo',
        '2026-09-18 10:00:00-03', 'a0000000-0000-4000-8000-0000000039a1',
        'c0000000-0000-4000-8000-000000003901', 'd0000000-0000-4000-8000-000000003901',
        'a0000000-0000-4000-8000-0000000039a1', 'system');

select app.compromisso_do_google_gravar(
  'e0000000-0000-4000-8000-000000003901', 'evt-c39', 'primary',
  'https://meet.google.com/c39-teste', 'https://calendar.google.com/c39',
  'a0000000-0000-4000-8000-0000000039a1');


-- =====================================================================
-- 1. Ler o espelho traz o dono, e não só o evento
-- =====================================================================
insert into pg_temp.r values
  ('leu', app.compromisso_do_google_ler('e0000000-0000-4000-8000-000000003901'));

select is((select valor ->> 'evento_id' from pg_temp.r where chave = 'leu'), 'evt-c39',
  'o espelho devolve o id do evento no Google');
select is((select valor ->> 'criado_por' from pg_temp.r where chave = 'leu'),
  'a0000000-0000-4000-8000-0000000039a1',
  'e devolve QUEM criou: é o dono do evento no Google, e o token dele é o que serve');

-- =====================================================================
-- 2. O token é o de quem criou, mesmo que quem remarca seja outra pessoa
-- =====================================================================
select is(app.agenda_google_token_do_evento('e0000000-0000-4000-8000-000000003901'),
  'refresh-de-quem-criou',
  'o token do evento é o de quem o criou, e não o de quem está clicando agora');
select ok(app.agenda_google_token('a0000000-0000-4000-8000-0000000039a2') is null,
  'quem remarca não tem agenda conectada — e mesmo assim o remanejamento funciona');


-- =====================================================================
-- 3. O caminho feliz: o espelho muda de tarefa
-- =====================================================================
insert into pg_temp.r values
  ('remanejou', app.compromisso_do_google_remanejar('e0000000-0000-4000-8000-000000003901',
                                                    '2026-09-18 10:00:00-03'));

select is((select valor ->> 'ok' from pg_temp.r where chave = 'remanejou'), 'true',
  'o espelho é remanejado para a tarefa nova');
select is((select valor ->> 'task_id' from pg_temp.r where chave = 'remanejou'),
  'e0000000-0000-4000-8000-000000003902',
  'e a tarefa nova é encontrada por negócio + kind + due_at + estar aberta');

select is((select count(*) from public.compromissos_no_google), 1::bigint,
  'continua existindo UM espelho: duplicar faria as duas reuniões mostrarem o mesmo link');
select is(
  (select task_id from public.compromissos_no_google),
  'e0000000-0000-4000-8000-000000003902'::uuid,
  'e ele agora pertence à tarefa nova');
select is(
  (select evento_id from public.compromissos_no_google),
  'evt-c39',
  'o EVENTO é o mesmo: o Google foi alterado, não recriado — o convidado recebe "remarcada", não um cancelamento seguido de convite novo');


-- =====================================================================
-- 4. Sem tarefa nova, não mexe em nada
-- =====================================================================
-- Pedir um horário em que `move_deal` não criou tarefa nenhuma. Acontece de
-- verdade quando o desfecho não move etapa, e a resposta não pode ser "achei a
-- mais próxima".
insert into pg_temp.r values
  ('sem_alvo', app.compromisso_do_google_remanejar('e0000000-0000-4000-8000-000000003902',
                                                   '2026-12-25 09:00:00-03'));

select is((select valor ->> 'motivo' from pg_temp.r where chave = 'sem_alvo'), 'tarefa_nova_nao_encontrada',
  'sem tarefa nova no horário pedido, a função recusa');
select is(
  (select task_id from public.compromissos_no_google),
  'e0000000-0000-4000-8000-000000003902'::uuid,
  'e a recusa NÃO mexeu no espelho: ele continua onde estava');


-- =====================================================================
-- 5. Tarefa nova que já tem evento próprio: quem decide é gente
-- =====================================================================
insert into public.tasks (id, title, kind, status, due_at, assignee_id, organization_id, deal_id, created_by, origin)
values ('e0000000-0000-4000-8000-000000003903', 'Reunião marcada', 'meeting', 'todo',
        '2026-09-20 16:00:00-03', 'a0000000-0000-4000-8000-0000000039a1',
        'c0000000-0000-4000-8000-000000003901', 'd0000000-0000-4000-8000-000000003901',
        'a0000000-0000-4000-8000-0000000039a1', 'system');
select app.compromisso_do_google_gravar(
  'e0000000-0000-4000-8000-000000003903', 'evt-c39-outro', 'primary', null, null,
  'a0000000-0000-4000-8000-0000000039a1');

insert into pg_temp.r values
  ('ja_tem', app.compromisso_do_google_remanejar('e0000000-0000-4000-8000-000000003902',
                                                 '2026-09-20 16:00:00-03'));

select is((select valor ->> 'motivo' from pg_temp.r where chave = 'ja_tem'), 'tarefa_nova_ja_tem_evento',
  'quando a tarefa nova já tem evento próprio, existem DOIS no Google e a função não escolhe qual apagar');
select is((select count(*) from public.compromissos_no_google), 2::bigint,
  'os dois espelhos continuam de pé, para uma pessoa resolver');


-- =====================================================================
-- 6. Esquecer o espelho
-- =====================================================================
insert into pg_temp.r values
  ('esqueceu', app.compromisso_do_google_esquecer('e0000000-0000-4000-8000-000000003903')),
  ('de_novo',  app.compromisso_do_google_esquecer('e0000000-0000-4000-8000-000000003903'));

select is((select valor ->> 'ok' from pg_temp.r where chave = 'esqueceu'), 'true',
  'esquecer apaga a linha do espelho');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'de_novo'), 'sem_espelho',
  'esquecer duas vezes é seguro e nomeia o motivo: a rota trata 410 do Google como sucesso e chega aqui de novo');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — Concluir a conversa limpa o Meu dia (migração 20261117210000)
--
-- Pedido de 17/11/2026: "Assim que concluirmos conversa com cliente não pode
-- haver nada desse cliente na aba de 'meu dia', as tarefas associadas a ele
-- devem ser concluídas e não mostradas como pendente". Este arquivo prova:
--
--   1. CONCLUIR FECHA AS TAREFAS DO CLIENTE, com a marca da conversa, e diz
--      quantas; a visita marcada daqui para frente fica (a que já passou, não);
--   2. NADA DO CLIENTE NA FILA DO DIA: nem tarefa, nem negócio sem próxima
--      ação, nem registro sem resultado de antes da conclusão (o de depois fica);
--   3. O QUE O SISTEMA CRIA SOZINHO PARA CLIENTE CONCLUÍDO NASCE FEITO; o que
--      uma pessoa cria, e visita, nascem abertos;
--   4. REABRIR DEVOLVE as tarefas desta conclusão;
--   5. O CLIENTE ESCREVENDO traz a conversa de volta sem reabrir as tarefas
--      velhas, e a tarefa automática seguinte nasce aberta — mesmo dentro do
--      insert da mensagem, antes de o gatilho que desarquiva rodar;
--   6. FICHA COM OUTRA CONVERSA ABERTA: concluir uma não fecha nada.
--
-- Roda em transação e desfaz tudo. Dentro da transação `now()` é um só: o que
-- precisa acontecer "depois" da conclusão leva carimbo explícito.
-- =====================================================================
begin;
select plan(31);

insert into public.allowed_users (email, role, note) values
  ('h181.g@teste.local', 'gestor', 'pgTAP concluir limpa o Meu dia');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000018101'::uuid, 'h181.g@teste.local', '{"full_name":"Gil Gestor"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999918100"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

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
create function pg_temp.g() returns uuid language sql immutable as $$
  select 'a0000000-0000-4000-8000-000000018101'::uuid
$$;

create temp table t181(chave text primary key, valor uuid);
grant select on t181 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t181 where chave = p_chave
$$;

-- Uma automação que cria tarefa DENTRO do insert da mensagem do cliente, antes
-- de `messages_desarquiva` (o nome vem antes na ordem alfabética). Criado aqui,
-- antes de qualquer insert: depois, a tabela tem eventos de gatilho pendentes e
-- o Postgres recusa mexer nela. Só age na mensagem marcada da seção 5.
create temp table t181_meio(arquivada boolean);
create function pg_temp.automacao_no_meio() returns trigger language plpgsql as $$
declare v uuid;
begin
  if new.body = 'pgtap181: no meio' then
    insert into t181_meio
      select arquivada_em is not null from public.conversations where id = new.conversation_id;
    insert into public.tasks (title, kind, due_at, assignee_id, organization_id, origin)
    select 'Tarefa a.no_meio', 'follow_up', now() + interval '1 day', pg_temp.g(),
           c.organization_id, 'system'
      from public.conversations c where c.id = new.conversation_id
    returning id into v;
    insert into t181 values ('a.no_meio', v);
  end if;
  return null;
end $$;
create trigger messages_aa_pgtap181 after insert on public.messages
  for each row execute function pg_temp.automacao_no_meio();

-- Uma ficha com conversa em que o cliente falou por último, e um negócio dela
-- com o gestor, aberto e sem próxima ação.
create function pg_temp.cliente(p_chave text, p_telefone text) returns void
language plpgsql as $$
declare v_org uuid; v_conv uuid; v_deal uuid; v_etapa int; v_funil int;
begin
  insert into public.organizations (name, phone_e164, source_id, collector, owner_id)
  values ('Cliente do pgTAP 181 ' || p_chave, p_telefone,
          (select id from public.sources where slug = 'planilha'), 'pgtap181', pg_temp.g())
  returning id into v_org;
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999918100', p_telefone, v_org, pg_temp.g(),
          'aguardando_nos')
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'ok, obrigado', 'system', 'crm');
  select s.id, s.pipeline_id into v_etapa, v_funil
    from public.stages s
   where not s.is_terminal and s.retired_at is null
   order by s.pipeline_id, s.position, s.id
   limit 1;
  insert into public.deals (organization_id, pipeline_id, stage_id, owner_id, next_action_at)
  values (v_org, v_funil, v_etapa, pg_temp.g(), null)
  returning id into v_deal;
  insert into t181 values (p_chave || '.org', v_org), (p_chave || '.conv', v_conv),
                          (p_chave || '.deal', v_deal);
end $$;

-- Uma tarefa do gestor para o cliente, criada pelo sistema (sem pessoa).
create function pg_temp.tarefa(p_chave text, p_cliente text, p_tipo text, p_prazo timestamptz)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.tasks (title, kind, due_at, assignee_id, organization_id, deal_id, origin)
  values ('Tarefa ' || p_chave, p_tipo::app.task_kind, p_prazo, pg_temp.g(),
          pg_temp.id(p_cliente || '.org'), pg_temp.id(p_cliente || '.deal'), 'system')
  returning id into v;
  insert into t181 values (p_chave, v);
  return v;
end $$;
create function pg_temp.estado(p_chave text) returns text language sql stable as $$
  select status::text from public.tasks where id = pg_temp.id(p_chave)
$$;

create function pg_temp.concluir(p_cliente text, p_concluir boolean default true) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  v := public.conversa_arquivar(pg_temp.id(p_cliente || '.conv'), p_concluir);
  perform pg_temp.sair();
  return v;
end $$;

-- A fila do dia do gestor, só com as linhas do cliente.
create function pg_temp.fila(p_cliente text)
returns table (tipo text, task_id uuid, activity_id uuid) language plpgsql as $$
begin
  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  return query
    select f.tipo, f.task_id, f.activity_id
      from public.meu_dia(null, 300) f
     where f.organization_id = pg_temp.id(p_cliente || '.org');
  perform pg_temp.sair();
end $$;

-- =====================================================================
-- 1. Concluir fecha as tarefas do cliente
-- =====================================================================
select pg_temp.cliente('a', '+5584999918101');
select pg_temp.tarefa('a.vencida', 'a', 'follow_up', now() - interval '2 days');
select pg_temp.tarefa('a.ligar', 'a', 'call', now() + interval '1 hour');
select pg_temp.tarefa('a.visita_passada', 'a', 'visit', now() - interval '1 day');
select pg_temp.tarefa('a.visita_futura', 'a', 'visit', now() + interval '1 day');

select ok((select count(*) from pg_temp.fila('a') f where f.tipo like 'tarefa%') >= 2,
  'antes de concluir, as tarefas do cliente estão na fila do dia');

create temp table t181_r as select pg_temp.concluir('a') as r;
select is((select r ->> 'ok' from t181_r), 'true', 'quem atende conclui a conversa');
select is((select (r ->> 'tarefas_concluidas')::int from t181_r), 3,
  'e a resposta diz quantas tarefas do cliente foram concluídas junto');
select is(
  (select array_agg(pg_temp.estado(k) order by k) from unnest(array['a.ligar', 'a.vencida', 'a.visita_passada']) k),
  array['done', 'done', 'done'],
  'CONCLUIR FECHA AS TAREFAS: a vencida, a de hoje e a visita que já passou viram feitas');
select is(
  (select count(*)::int from public.tasks
    where id in (pg_temp.id('a.vencida'), pg_temp.id('a.ligar'), pg_temp.id('a.visita_passada'))
      and concluida_com_conversa = pg_temp.id('a.conv') and completed_at is not null),
  3, 'com a marca da conversa que as fechou e a hora em que fecharam');
select is(pg_temp.estado('a.visita_futura'), 'todo',
  'A VISITA MARCADA DAQUI PARA FRENTE FICA: é hora combinada, não pendência');

-- =====================================================================
-- 2. Nada do cliente na fila do dia
-- =====================================================================
select is(
  (select count(*)::int from pg_temp.fila('a') f where f.task_id is distinct from pg_temp.id('a.visita_futura')),
  0, 'NADA DO CLIENTE NA FILA: nenhuma tarefa e nenhum pedido de resposta, só a visita marcada');

select pg_temp.cliente('b', '+5584999918102');
insert into public.activities (type, channel, organization_id, deal_id, user_id, occurred_at)
values ('call', 'phone', pg_temp.id('b.org'), pg_temp.id('b.deal'), pg_temp.g(),
        now() - interval '3 hours');
select ok(exists (select 1 from pg_temp.fila('b') f where f.tipo = 'sem_proxima_acao'),
  'antes de concluir, o negócio sem próxima ação do cliente está na fila');
select ok(exists (select 1 from pg_temp.fila('b') f where f.tipo = 'desfecho_pendente'),
  'e a ligação registrada sem resultado também');
select pg_temp.concluir('b');
select is((select count(*)::int from pg_temp.fila('b')), 0,
  'CONCLUÍDO, O NEGÓCIO E O REGISTRO SEM RESULTADO SAEM: nada do cliente na fila');

-- O registro feito DEPOIS da conclusão (alguém ligou mesmo assim) aparece. A
-- conclusão é posta duas horas atrás para caber um "depois" antes de agora (e o
-- "ok, obrigado" do cliente, três horas atrás, para continuar antes dela).
update public.messages set created_at = now() - interval '3 hours'
 where conversation_id = pg_temp.id('b.conv');
update public.conversations set arquivada_em = now() - interval '2 hours'
 where id = pg_temp.id('b.conv');
insert into public.activities (type, channel, organization_id, deal_id, user_id, occurred_at)
values ('call', 'phone', pg_temp.id('b.org'), pg_temp.id('b.deal'), pg_temp.g(),
        now() - interval '1 hour');
select ok(exists (select 1 from pg_temp.fila('b') f where f.tipo = 'desfecho_pendente'),
  'o registro sem resultado feito depois da conclusão aparece: alguém agiu depois');
select ok(not exists (select 1 from pg_temp.fila('b') f where f.tipo <> 'desfecho_pendente'),
  'e o negócio continua de fora');

-- =====================================================================
-- 3. O que o sistema cria sozinho para cliente concluído nasce feito
-- =====================================================================
select pg_temp.tarefa('a.reengajar', 'a', 'follow_up', now());
select is(pg_temp.estado('a.reengajar'), 'done',
  'TAREFA AUTOMÁTICA DE CLIENTE CONCLUÍDO NASCE FEITA (o "Reengajar" do relógio)');
select is((select concluida_com_conversa from public.tasks where id = pg_temp.id('a.reengajar')),
  pg_temp.id('a.conv'), 'com a marca da conversa concluída');
select ok((select completed_at is not null from public.tasks where id = pg_temp.id('a.reengajar')),
  'e com a hora em que fechou');
select ok(not exists (select 1 from pg_temp.fila('a') f where f.task_id = pg_temp.id('a.reengajar')),
  'e não aparece na fila do dia');

select pg_temp.tarefa('a.visita_calendly', 'a', 'visit', now() + interval '3 days');
select is(pg_temp.estado('a.visita_calendly'), 'todo',
  'visita marcada sem pessoa (Calendly) nasce aberta: ela vai acontecer');

insert into public.tasks (title, kind, due_at, assignee_id, organization_id, origin, created_by)
values ('Ligar em março', 'call', now() + interval '10 days', pg_temp.g(), pg_temp.id('a.org'),
        'manual', pg_temp.g())
returning id as v \gset
insert into t181 values ('a.da_pessoa', :'v');
select is(pg_temp.estado('a.da_pessoa'), 'todo',
  'TAREFA CRIADA POR UMA PESSOA nasce aberta, mesmo com o cliente concluído');

select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.g(), 'role', 'authenticated')::text, true);
insert into public.tasks (title, kind, due_at, assignee_id, organization_id, origin)
values ('Pela API, como a pessoa', 'follow_up', now() + interval '5 days', pg_temp.g(),
        pg_temp.id('a.org'), 'system')
returning id as v \gset
select set_config('request.jwt.claims', '', true);
insert into t181 values ('a.pela_api', :'v');
select is(pg_temp.estado('a.pela_api'), 'todo',
  'e a que nasce com alguém autenticado (a API age como a pessoa) também');

-- =====================================================================
-- 4. Reabrir devolve as tarefas desta conclusão
-- =====================================================================
delete from t181_r;
insert into t181_r select pg_temp.concluir('a', false);
select is((select (r ->> 'tarefas_devolvidas')::int from t181_r), 4,
  'REABRIR DEVOLVE: as três fechadas ao concluir e a que nasceu feita enquanto valia');
select is(
  (select array_agg(pg_temp.estado(k) order by k)
     from unnest(array['a.ligar', 'a.reengajar', 'a.vencida', 'a.visita_passada']) k),
  array['todo', 'todo', 'todo', 'todo'], 'e elas voltam a abertas');
select is(
  (select count(*)::int from public.tasks
    where organization_id = pg_temp.id('a.org') and concluida_com_conversa is not null),
  0, 'sem a marca da conclusão desfeita');

-- =====================================================================
-- 5. O cliente escreve de novo
-- =====================================================================
delete from t181_r;
insert into t181_r select pg_temp.concluir('a');
select is((select (r ->> 'tarefas_concluidas')::int from t181_r), 6,
  'concluída de novo, fecha tudo o que estava aberto (menos as duas visitas marcadas)');

insert into public.messages (conversation_id, direction, type, status, body, author_kind,
                             origin, created_at)
values (pg_temp.id('a.conv'), 'in'::app.msg_direction, 'text'::app.msg_type,
        'received'::app.msg_status, 'voltei, ainda tem?', 'system', 'crm',
        now() + interval '1 minute');
select ok((select arquivada_em is null from public.conversations where id = pg_temp.id('a.conv')),
  'o cliente escreveu e a conversa voltou');
select is(pg_temp.estado('a.vencida'), 'done',
  'mas as tarefas velhas NÃO voltam: o item novo é responder, não o follow-up antigo');
select pg_temp.tarefa('a.depois_da_volta', 'a', 'follow_up', now() + interval '1 day');
select is(pg_temp.estado('a.depois_da_volta'), 'todo',
  'e a tarefa automática seguinte nasce aberta: o cliente não está mais concluído');

-- A mensagem do cliente já conta dentro do próprio insert, antes de o gatilho
-- que desarquiva rodar (gatilhos AFTER rodam em ordem alfabética). O gatilho
-- de teste `messages_aa_pgtap181`, criado no começo do arquivo, cria a tarefa
-- automática nesse meio, como faria uma automação real.
-- A conclusão vai para depois da mensagem de 1 minuto atrás (o relógio da
-- transação é um só), e a tarefa de controle prova que o cliente está concluído.
select pg_temp.concluir('a');
update public.conversations set arquivada_em = now() + interval '90 seconds'
 where id = pg_temp.id('a.conv');
select pg_temp.tarefa('a.controle', 'a', 'follow_up', now() + interval '1 day');
select is(pg_temp.estado('a.controle'), 'done',
  '(controle: concluída de novo, a tarefa automática volta a nascer feita)');
insert into public.messages (conversation_id, direction, type, status, body, author_kind,
                             origin, created_at)
values (pg_temp.id('a.conv'), 'in'::app.msg_direction, 'text'::app.msg_type,
        'received'::app.msg_status, 'pgtap181: no meio', 'system', 'crm',
        now() + interval '2 minutes');
select ok((select arquivada from t181_meio),
  '(a tarefa nasceu com a conversa ainda concluída: o gatilho que a traz de volta ainda não tinha rodado)');
select is(pg_temp.estado('a.no_meio'), 'todo',
  'A MENSAGEM QUE ACABOU DE ENTRAR JÁ CONTA: a tarefa criada no meio dela nasce aberta');

-- =====================================================================
-- 6. Ficha com outra conversa aberta
-- =====================================================================
select pg_temp.cliente('c', '+5584999918103');
insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                  assignee_id, status)
values ('whatsapp'::app.channel, '+5584999918100', '+5584999918104', pg_temp.id('c.org'),
        pg_temp.g(), 'aguardando_nos');
select pg_temp.tarefa('c.vencida', 'c', 'follow_up', now() - interval '1 day');
delete from t181_r;
insert into t181_r select pg_temp.concluir('c');
select is((select (r ->> 'tarefas_concluidas')::int from t181_r), 0,
  'FICHA COM OUTRA CONVERSA ABERTA: concluir uma não fecha nada, a conversa com o cliente continua');
select is(pg_temp.estado('c.vencida'), 'todo', 'e a tarefa dele segue aberta');

select * from finish();
rollback;

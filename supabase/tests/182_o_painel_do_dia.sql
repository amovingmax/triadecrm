-- =====================================================================
-- pgTAP — O Painel do dia (migração 20261117220000)
--
-- A aba inicial nova da Imova lê tudo de `public.meu_dia_painel`. Este arquivo
-- prova:
--   1. A PORTA: sem login não lê; quem não é da gestão não lê o dia de outra
--      pessoa; e para quem não vê a base inteira os blocos da empresa voltam nulos;
--   2. OS NÚMEROS contam como os Relatórios: o lead novo de hoje entra em
--      "leads novos" e a reunião marcada pela IA em "visitas" e "pela IA";
--   3. A AGENDA de hoje traz a visita da pessoa com o imóvel;
--   4. PRECISA DE VOCÊ: a passagem da IA sem resposta entra e sai quando alguém
--      do time responde; a tarefa vencida entra; o aviso do motor sem cliente, não.
--
-- Roda em transação e desfaz tudo. As contas são por diferença (antes e depois),
-- para não depender do que mais houver no banco.
-- =====================================================================
begin;
select plan(15);

insert into public.allowed_users (email, role, note) values
  ('p182.g@teste.local', 'gestor', 'pgTAP painel'),
  ('p182.e@teste.local', 'embaixador', 'pgTAP painel');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000018201'::uuid, 'p182.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000018202'::uuid, 'p182.e@teste.local', '{"full_name":"Edu Embaixador"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999918200"')
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
  select 'a0000000-0000-4000-8000-000000018201'::uuid
$$;
-- O painel do gestor (sem `p_pessoa`).
create function pg_temp.painel(p_periodo text default 'hoje') returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  v := public.meu_dia_painel(p_periodo);
  perform pg_temp.sair();
  return v;
end $$;

create temp table t182(chave text primary key, valor uuid);
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t182 where chave = p_chave
$$;

-- Um cliente com conversa (a última palavra é dele), criado agora.
create function pg_temp.cliente(p_chave text, p_telefone text) returns void language plpgsql as $$
declare v_org uuid; v_conv uuid;
begin
  insert into public.organizations (name, phone_e164, source_id, collector, owner_id, kind)
  values ('Cliente 182 ' || p_chave, p_telefone,
          (select id from public.sources where slug = 'planilha'), 'pgtap182', pg_temp.g(),
          'produtor'::app.org_kind)
  returning id into v_org;
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999918200', p_telefone, v_org, pg_temp.g(), 'aguardando_nos')
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'oi, vi o anúncio', 'system', 'crm');
  insert into t182 values (p_chave || '.org', v_org), (p_chave || '.conv', v_conv);
end $$;

-- =====================================================================
-- 1. A porta
-- =====================================================================
select throws_ok($$ select public.meu_dia_painel('hoje') $$, '42501', null,
  'sem login, o painel não abre');

select pg_temp.entrar('a0000000-0000-4000-8000-000000018202'::uuid, 'embaixador');
select throws_ok($$ select public.meu_dia_painel('hoje', 'a0000000-0000-4000-8000-000000018201'::uuid) $$,
  '42501', null, 'quem não é da gestão não lê o dia de outra pessoa');
create temp table t182_emb as select public.meu_dia_painel('hoje') as p;
select pg_temp.sair();
select ok((select p -> 'numeros' = 'null'::jsonb and p -> 'leads' = 'null'::jsonb and p -> 'ia' = 'null'::jsonb
             from t182_emb),
  'para quem não vê a base inteira, números, leads e IA da empresa voltam nulos');
select ok((select jsonb_typeof(p -> 'agenda') = 'array' and p -> 'precisa' ? 'total' from t182_emb),
  'mas a agenda e as pendências dele vêm');

-- =====================================================================
-- 2. Os números
-- =====================================================================
create temp table t182_antes as select pg_temp.painel('hoje') as p;
select pg_temp.cliente('a', '+5584999918201');
insert into public.reunioes (organization_id, conversation_id, dono_id, titulo, formato, inicio, fim,
                             local, estado, marcada_por)
values (pg_temp.id('a.org'), pg_temp.id('a.conv'), pg_temp.g(), 'Visita 182', 'presencial',
        now() + interval '1 day', now() + interval '1 day 1 hour', 'Ponta Negra', 'marcada', 'robo');
create temp table t182_depois as select pg_temp.painel('hoje') as p;

select is((select (d.p #>> '{numeros,leads,agora}')::int - (a.p #>> '{numeros,leads,agora}')::int
             from t182_antes a, t182_depois d), 1,
  'o lead novo de hoje entra em "leads novos" (a conta dos Relatórios)');
select is((select (d.p #>> '{numeros,visitas,agora}')::int - (a.p #>> '{numeros,visitas,agora}')::int
             from t182_antes a, t182_depois d), 1,
  'a reunião criada hoje entra em "visitas marcadas"');
select is((select (d.p #>> '{numeros,visitas,pela_ia}')::int - (a.p #>> '{numeros,visitas,pela_ia}')::int
             from t182_antes a, t182_depois d), 1,
  'e, marcada pela IA, também em "pela IA"');
select ok((select jsonb_array_length(p #> '{numeros,leads,serie}') = 7
                  and jsonb_array_length(p #> '{numeros,dias}') = 7 from t182_depois),
  'a série dos dias tem 7 pontos em "hoje"');
select ok((select exists (select 1 from jsonb_array_elements(p -> 'leads') l
                           where l ->> 'conversation_id' = pg_temp.id('a.conv')::text)
             from t182_depois),
  'e o lead aparece na lista de leads novos');

-- =====================================================================
-- 3. A agenda de hoje
-- =====================================================================
insert into public.tasks (title, kind, due_at, assignee_id, organization_id, origin, created_by)
values ('Visita 182', 'visit',
        (((now() at time zone 'America/Fortaleza')::date)::timestamp + time '23:30') at time zone 'America/Fortaleza',
        pg_temp.g(), pg_temp.id('a.org'), 'manual', pg_temp.g())
returning id as v \gset
insert into t182 values ('visita', :'v');
insert into public.visita_imoveis (task_id, codigo, endereco, origem)
values (pg_temp.id('visita'), 'TE9182_IMOVA', 'Rua do Teste, 182, Natal', 'crm');
select is(
  (select x #>> '{imovel,codigo}' from jsonb_array_elements(pg_temp.painel() -> 'agenda') x
    where x ->> 'task_id' = pg_temp.id('visita')::text),
  'TE9182_IMOVA', 'A AGENDA DE HOJE traz a visita da pessoa com o imóvel');

-- =====================================================================
-- 4. Precisa de você
-- =====================================================================
insert into public.ia_respostas (conversation_id, corpo, acao, detalhes, criada_em)
values (pg_temp.id('a.conv'), 'Vou chamar alguém da equipe.', 'passou_para_pessoa',
        '{"motivo": "quer negociar o valor"}'::jsonb, now() - interval '10 minutes');
select ok((select exists (select 1 from jsonb_array_elements(pg_temp.painel() #> '{precisa,itens}') x
                           where x ->> 'tipo' = 'ia' and x ->> 'titulo' = 'Cliente 182 a'
                             and x ->> 'detalhe' = 'quer negociar o valor')),
  'PRECISA DE VOCÊ: a passagem da IA sem resposta entra, com o motivo');

insert into public.tasks (title, kind, due_at, assignee_id, organization_id, origin, created_by)
values ('Retornar 182', 'follow_up', now() - interval '1 day', pg_temp.g(), pg_temp.id('a.org'),
        'manual', pg_temp.g()),
       ('Aviso do motor 182', 'other', now() - interval '1 day', pg_temp.g(), null, 'system', null);
select ok((select exists (select 1 from jsonb_array_elements(pg_temp.painel() #> '{precisa,itens}') x
                           where x ->> 'tipo' = 'venceu' and x ->> 'titulo' = 'Retornar 182')
             or (pg_temp.painel() #>> '{precisa,total}')::int > 5),
  'a tarefa vencida entra');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.painel() #> '{precisa,itens}') x
                       where x ->> 'titulo' = 'Aviso do motor 182'),
  'o aviso do motor, sem cliente, não entra');

insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin,
                             created_at)
values (pg_temp.id('a.conv'), 'out'::app.msg_direction, 'text'::app.msg_type, 'queued'::app.msg_status,
        'oi, posso ajudar', 'human', pg_temp.g(), 'crm', now() + interval '1 minute');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.painel() #> '{precisa,itens}') x
                       where x ->> 'tipo' = 'ia' and x ->> 'titulo' = 'Cliente 182 a'),
  'e a passagem sai quando alguém do time responde');

select is(pg_temp.painel('mes') #>> '{periodo,nome}', 'mes', 'o período "mês" é aceito e devolvido');

select * from finish();
rollback;

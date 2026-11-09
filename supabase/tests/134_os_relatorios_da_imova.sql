-- =====================================================================
-- pgTAP — Os relatórios da Imova (migração 20261109200000)
--
-- Decisões do usuário em 06/11/2026: clique do anúncio = visualizações do
-- relatório do Canal Pro, com o período pela diferença entre duas fotos;
-- mensagem positiva = respondeu em 24 h e estava interessado; a IA que atende
-- medida por indicadores e por uma IA juíza diária. Este arquivo prova:
--
--   1. O PROPÓSITO `avaliar_atendimento` entrou nas listas sem tirar nenhum;
--   2. As FOTOS do Canal Pro: uma por número novo, nenhuma repetida, e o
--      período é a diferença entre duas;
--   3. As NOTAS da leitura da IA ficam com a hora, só quando mudam;
--   4. CLIENTES QUENTES: o calor, a ordem e quem fica fora;
--   5. MENSAGENS: assinatura e nome ignorados, texto repetido só com 3
--      pessoas, modelo aprovado e resposta rápida, e as taxas;
--   6. A IA QUE ATENDE: totais sem o treino, interesse antes e depois;
--   7. A JUÍZA: fila diária sem repetir, entrada, gravação e o relatório;
--   8. QUEM VÊ: os papéis dos relatórios de sempre (`app.sees_all`); o
--      embaixador e o anônimo não; as portas da juíza só por
--      service_role;
--   9. O WHATSAPP NÃO MUDA: nenhum relatório grava mensagem nem fila.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(55);

insert into public.allowed_users (email, role, note) values
  ('h134.g@teste.local', 'gestor', 'pgTAP 134'),
  ('h134.s@teste.local', 'sdr', 'pgTAP 134'),
  ('h134.l@teste.local', 'embaixador', 'pgTAP 134');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000013401'::uuid, 'h134.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000013402'::uuid, 'h134.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000013403'::uuid, 'h134.l@teste.local', '{"full_name":"Edu Embaixador"}');

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
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

create temp table t134(chave text primary key, valor uuid);
grant all on t134 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t134 where chave = p_chave
$$;
create function pg_temp.conversa(p_chave text, p_tel text, p_nome text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999913400', p_tel, p_nome,
          'a0000000-0000-4000-8000-000000013401'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t134 values (p_chave, v);
  return v;
end $$;
create function pg_temp.dele(p_conv uuid, p_em timestamptz, p_texto text default 'pgtap134 dele') returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_texto, 'system', 'crm', p_em)
  returning id into v;
  update public.conversations set last_inbound_at = greatest(coalesce(last_inbound_at, p_em), p_em)
   where id = p_conv;
  return v;
end $$;
create function pg_temp.nossa(p_conv uuid, p_em timestamptz, p_texto text, p_template int default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at, template_id)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          p_texto, 'human', 'echo', 'a0000000-0000-4000-8000-000000013401'::uuid,
          'wamid.PGTAP134.' || gen_random_uuid(), p_em, p_em, p_template)
  returning id into v;
  update public.conversations set last_outbound_at = greatest(coalesce(last_outbound_at, p_em), p_em)
   where id = p_conv;
  return v;
end $$;
-- A resposta da IA: a mensagem `bot_ai` entra sem passar pela porteira (que
-- exige a prova da função da IA), só para montar o cenário.
create function pg_temp.da_ia(p_conv uuid, p_em timestamptz, p_acao text, p_em_resposta_a uuid,
                              p_avaliacao text default null) returns uuid
language plpgsql as $$
declare v uuid;
begin
  set local session_replication_role = replica;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'pgtap134 da IA', 'bot_ai', 'crm', 'wamid.PGTAP134IA.' || gen_random_uuid(), p_em, p_em)
  returning id into v;
  set local session_replication_role = origin;
  insert into public.ia_respostas (conversation_id, em_resposta_a, message_id, corpo, acao, criada_em, avaliacao,
                                   correcao)
  values (p_conv, p_em_resposta_a, v, 'pgtap134 da IA', p_acao, p_em, p_avaliacao,
          case when p_avaliacao = 'corrigir' then 'pgtap134' end);
  return v;
end $$;
create function pg_temp.atitude(p_conv uuid, p_etiqueta text, p_em timestamptz) returns void
language plpgsql as $$
begin
  insert into public.atitude_historico (conversation_id, tipo, de, para, motivo, em)
  values (p_conv, 'etiqueta', null, p_etiqueta, 'pgtap134', p_em);
  insert into public.atitudes (conversation_id, etiqueta, motivo, desde, calculada_em)
  values (p_conv, p_etiqueta, 'pgtap134', p_em, p_em)
  on conflict (conversation_id) do update set etiqueta = excluded.etiqueta, desde = excluded.desde;
end $$;

select pg_temp.virar('imova');
-- A conversa do treino e a juíza ligada, só nesta transação.
select pg_temp.conversa('treino', '+5584999913490', 'Treino 134');
delete from public.app_settings where key in ('ia.atendente', 'ia.juiza');
insert into public.app_settings (key, value)
values ('ia.atendente', jsonb_build_object('ligada', true, 'modo', 'clientes',
                                            'conversa_de_treino', pg_temp.id('treino'))),
       ('ia.juiza', '{"ligada": true}'::jsonb);

-- =====================================================================
-- 1. O propósito novo, acrescentado
-- =====================================================================
select ok((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'ai_runs_purpose_check')
            like '%''avaliar_atendimento''%'
          and (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'ai_runs_purpose_check')
            like '%''triar_candidato''%',
          'ai_runs aceita avaliar_atendimento e continua aceitando os de antes');
select ok(position('''avaliar_atendimento''' in pg_get_functiondef('app.ia_enfileirar(text,jsonb,text)'::regprocedure)) > 0
          and position('''avaliar_atendimento''' in pg_get_functiondef('public.ia_adiar_trabalho(text,jsonb,text,text)'::regprocedure)) > 0
          and position('''avaliar_atendimento''' in pg_get_functiondef('app.ia_gasto_bloqueado_para()'::regprocedure)) > 0,
          'as três listas de propósito do banco ganharam avaliar_atendimento');
select lives_ok($$ select app.ia_enfileirar('avaliar_atendimento', '{"conversation_id": null}'::jsonb, 'pgtap134-proposito') $$,
                'a fila aceita o trabalho da juíza');

-- =====================================================================
-- 2. As fotos do relatório do Canal Pro
-- =====================================================================
insert into public.anuncios_no_canal_pro (codigo, titulo, situacao, bairro, linha)
values ('T134_IMOVA', 'Apartamento teste 134', 'Ativo', 'Ponta Negra',
        '{"Total de visualizações": "100", "Total de contatos": "4", "Criação": "01-01-2025"}'::jsonb);
select is((select count(*)::int from public.canal_pro_fotos where codigo = 'T134_IMOVA'), 1,
          'a importação do anúncio tira a primeira foto');
update public.anuncios_no_canal_pro
   set linha = linha || '{"Tour Virtual": "Não"}'::jsonb
 where codigo = 'T134_IMOVA';
select is((select count(*)::int from public.canal_pro_fotos where codigo = 'T134_IMOVA'), 1,
          'importar de novo com os mesmos números não tira foto repetida');
-- A primeira foto vira de 10 dias atrás; a nova importação traz números maiores.
update public.canal_pro_fotos set em = now() - interval '10 days' where codigo = 'T134_IMOVA';
update public.anuncios_no_canal_pro
   set linha = linha || '{"Total de visualizações": "160", "Total de contatos": "7"}'::jsonb
 where codigo = 'T134_IMOVA';
select is((select count(*)::int from public.canal_pro_fotos where codigo = 'T134_IMOVA'), 2,
          'número novo, foto nova');
update public.anuncios_no_canal_pro
   set no_relatorio = false, linha = linha || '{"Total de visualizações": "999"}'::jsonb
 where codigo = 'T134_IMOVA';
select is((select count(*)::int from public.canal_pro_fotos where codigo = 'T134_IMOVA'), 2,
          'o anúncio que saiu do relatório não ganha foto');
update public.anuncios_no_canal_pro
   set no_relatorio = true, linha = linha || '{"Total de visualizações": "160"}'::jsonb
 where codigo = 'T134_IMOVA';

-- =====================================================================
-- 3. As notas da leitura da IA, com a hora
-- =====================================================================
select pg_temp.conversa('b', '+5584999913402', 'João Morno');
insert into public.ficha_da_conversa (conversation_id, score_intencao, intencao, sentimento, analisada_em)
values (pg_temp.id('b'), 30, 'PEDIU_INFORMACAO', 'neutro', now() - interval '2 days');
update public.ficha_da_conversa set score_intencao = 70, analisada_em = now() where conversation_id = pg_temp.id('b');
update public.ficha_da_conversa set resumo = 'pgtap134' where conversation_id = pg_temp.id('b');
select is((select count(*)::int from public.ficha_da_conversa_notas where conversation_id = pg_temp.id('b')), 2,
          'cada nota nova fica com a hora; mudar só o resumo não anota');
select is((select array_agg(score_intencao order by em)::int[] from public.ficha_da_conversa_notas
            where conversation_id = pg_temp.id('b')), array[30, 70],
          'a nota de antes e a de depois');

-- =====================================================================
-- 4. Clientes quentes
-- =====================================================================
select pg_temp.conversa('a', '+5584999913401', 'Maria Quente');
select pg_temp.dele(pg_temp.id('a'), now() - interval '2 hours', 'Oi, vi o anúncio T134 no ZAP, ainda está disponível?');
select pg_temp.atitude(pg_temp.id('a'), 'muito_interessado', now() - interval '2 hours');
insert into public.ficha_da_conversa (conversation_id, score_intencao, intencao, analisada_em, dados_extraidos)
values (pg_temp.id('a'), 80, 'PEDIU_VISITA', now() - interval '1 hour',
        '{"finalidade": {"valor": "compra"}, "tipo_imovel": {"valor": "apartamento"},
          "bairros": {"valor": "Ponta Negra"}, "quartos": {"valor": "2"}}'::jsonb);

select pg_temp.dele(pg_temp.id('b'), now() - interval '5 days');
select pg_temp.atitude(pg_temp.id('b'), 'morno', now() - interval '5 days');

select pg_temp.conversa('c', '+5584999913403', 'Ana Fria');
select pg_temp.dele(pg_temp.id('c'), now() - interval '1 hour');
select pg_temp.atitude(pg_temp.id('c'), 'sem_interesse', now() - interval '1 hour');

select pg_temp.dele(pg_temp.id('treino'), now() - interval '1 hour');
select pg_temp.atitude(pg_temp.id('treino'), 'muito_interessado', now() - interval '1 hour');

select pg_temp.conversa('e', '+5584999913405', 'Pedro Esperando');
select pg_temp.dele(pg_temp.id('e'), now() - interval '30 minutes');
select pg_temp.atitude(pg_temp.id('e'), 'interessado', now() - interval '30 minutes');
insert into public.ficha_da_conversa (conversation_id, score_intencao, analisada_em)
values (pg_temp.id('e'), 50, now());

select pg_temp.entrar('a0000000-0000-4000-8000-000000013401'::uuid, 'gestor');
create temp table t134_quentes as
  select row_number() over () as pos, q.* from public.relatorio_imova_quentes(500) q;
select pg_temp.sair();

select is((select calor from t134_quentes where conversation_id = pg_temp.id('a')), 95,
          'muito interessado (90) com nota 80 da IA, falou há 2 h: calor 95');
select is((select calor from t134_quentes where conversation_id = pg_temp.id('b')), 58,
          'morno (40) com nota 70 da IA, falou há 5 dias: calor 58');
select is((select calor from t134_quentes where conversation_id = pg_temp.id('e')), 65,
          'interessado (60) com nota 50, falou há 30 min: calor 65');
select ok((select pos from t134_quentes where conversation_id = pg_temp.id('a'))
            < (select pos from t134_quentes where conversation_id = pg_temp.id('e')),
          'o mais quente vem primeiro');
select ok(not exists (select 1 from t134_quentes where conversation_id in (pg_temp.id('c'), pg_temp.id('treino'))),
          'sem interesse e a conversa do treino ficam fora');
select is((select procura from t134_quentes where conversation_id = pg_temp.id('a')),
          'compra · apartamento · 2 quartos · Ponta Negra', 'o que o cliente procura, numa linha');
select is((select esperando_resposta from t134_quentes where conversation_id = pg_temp.id('e')), true,
          'a última mensagem é do cliente: esperando resposta');

-- =====================================================================
-- 5. As mensagens que mais funcionam
-- =====================================================================
select is(app.texto_de_modelo(E'*Gil:*\nOlá Carla, tudo bem?', array['Carla Souza'], true),
          'ola {nome}, tudo bem?', 'para comparar: sem assinatura, sem acento e com {nome}');
select pg_temp.conversa('m1', '+5584999913411', 'Carla Souza');
select pg_temp.conversa('m2', '+5584999913412', 'Bruno Lima');
select pg_temp.conversa('m3', '+5584999913413', 'Lia');
select pg_temp.nossa(pg_temp.id('m1'), now() - interval '30 hours',
  E'*Gil:*\nOlá Carla, temos um apartamento de 2 quartos em Ponta Negra. Quer marcar uma visita?');
select pg_temp.nossa(pg_temp.id('m2'), now() - interval '30 hours',
  E'*Sara:*\nOlá Bruno, temos um apartamento de 2 quartos em Ponta Negra. Quer marcar uma visita?');
select pg_temp.nossa(pg_temp.id('m3'), now() - interval '30 hours',
  'Olá Lia, temos um apartamento de 2 quartos em Ponta Negra. Quer marcar uma visita?');
-- Carla responde em 1 h e fica interessada; Bruno responde 28 h depois; Lia não responde.
select pg_temp.dele(pg_temp.id('m1'), now() - interval '29 hours', 'Quero sim!');
select pg_temp.atitude(pg_temp.id('m1'), 'interessado', now() - interval '29 hours' + interval '1 minute');
select pg_temp.dele(pg_temp.id('m2'), now() - interval '2 hours', 'Agora vi');
insert into public.organizations (kind, name, source_id, collector, phone_e164)
select 'produtor'::app.org_kind, 'Carla pgTAP 134', s.id, 'pgtap134', '+5584999913411'
  from public.sources s where s.slug = 'planilha';
insert into public.reunioes (organization_id, conversation_id, dono_id, titulo, formato, inicio, fim, local,
                             marcada_por, criada_em)
select o.id, pg_temp.id('m1'), 'a0000000-0000-4000-8000-000000013401'::uuid, 'Visita pgtap134', 'presencial',
       now() + interval '1 day', now() + interval '1 day 1 hour', 'Rua teste 134', 'pessoa', now() - interval '28 hours'
  from public.organizations o where o.name = 'Carla pgTAP 134';
-- Texto mandado a só duas pessoas não é modelo.
select pg_temp.nossa(pg_temp.id('m1'), now() - interval '26 hours', 'Segue a lista completa dos imóveis 134 para você olhar.');
select pg_temp.nossa(pg_temp.id('m2'), now() - interval '26 hours', 'Segue a lista completa dos imóveis 134 para você olhar.');
-- Uma resposta rápida e um modelo aprovado, uma vez cada.
insert into public.respostas_rapidas (atalho, titulo, texto)
values ('visita134', 'Visita amanhã', 'Podemos agendar a sua visita para amanhã pela manhã? (134)');
select pg_temp.nossa(pg_temp.id('m3'), now() - interval '27 hours',
  E'*Gil:*\nPodemos agendar a sua visita para amanhã pela manhã? (134)');
select pg_temp.nossa(pg_temp.id('b'), now() - interval '27 hours', 'Texto do modelo 134',
  (select min(id) from public.message_templates));

select pg_temp.entrar('a0000000-0000-4000-8000-000000013402'::uuid, 'sdr');
create temp table t134_msgs as
  select * from public.relatorio_imova_mensagens(current_date - 3, current_date, 3);
select pg_temp.sair();

select is((select tipo from t134_msgs where texto like '%temos um apartamento de 2 quartos em Ponta Negra%'),
          'texto_repetido', 'o texto mandado a três pessoas é um modelo, com nome e assinatura ignorados');
select is((select envios || '/' || conversas || '/' || maduros || '/' || responderam || '/' || interessaram || '/' || visitas
             from t134_msgs where texto like '%temos um apartamento de 2 quartos em Ponta Negra%'),
          '3/3/3/1/1/1', 'envios, pessoas, maduros, responderam em 24 h, interessaram e visitas');
select is((select taxa_positiva from t134_msgs where texto like '%temos um apartamento de 2 quartos em Ponta Negra%'),
          33.3::numeric, 'respondeu e se interessou: 1 de 3');
select is((select texto from t134_msgs where texto like '%temos um apartamento de 2 quartos em Ponta Negra%'),
          'Olá {nome}, temos um apartamento de 2 quartos em Ponta Negra. Quer marcar uma visita?',
          'o texto mostrado é o do time, sem assinatura e com {nome}');
select ok(not exists (select 1 from t134_msgs where texto like '%lista completa dos imóveis 134%'),
          'texto mandado a duas pessoas não é modelo');
select is((select tipo || ' ' || nome from t134_msgs where texto like '%(134)%'),
          'resposta_rapida /visita134 · Visita amanhã', 'a resposta rápida é achada pelo texto, mesmo assinado');
select is((select tipo from t134_msgs where chave = 'modelo:' || (select min(id) from public.message_templates)),
          'modelo', 'o modelo aprovado entra mesmo com um envio só');

-- =====================================================================
-- 6. Os anúncios
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000013401'::uuid, 'gestor');
create temp table t134_anuncios as
  select * from public.relatorio_imova_anuncios(current_date - 3, current_date);
create temp table t134_anuncios_30 as
  select * from public.relatorio_imova_anuncios(current_date - 30, current_date);
select pg_temp.sair();

select is((select visualizacoes || '/' || visualizacoes_periodo || '/' || contatos || '/' || contatos_periodo
             from t134_anuncios where codigo = 'T134_IMOVA'),
          '160/60/7/3', 'total e período (diferença entre a foto de 10 dias atrás e a de agora)');
select is((select taxa_de_contato from t134_anuncios where codigo = 'T134_IMOVA'), 4.4::numeric,
          'contato por clique: 7 de 160');
select is((select onde from t134_anuncios where codigo = 'T134_IMOVA'), 'Canal Pro', 'só no Canal Pro');
select is((select conversas from t134_anuncios where codigo = 'T134_IMOVA'), 1,
          'a conversa em que o cliente citou o código conta para o anúncio');
select is((select visualizacoes_periodo from t134_anuncios_30 where codigo = 'T134_IMOVA'), null::int,
          'em 30 dias a primeira foto (há 10 dias) fica dentro do período e o anúncio é de 2025: em branco, e não o total');

-- =====================================================================
-- 7. A IA que atende
-- =====================================================================
-- Só as respostas deste teste (no banco local há outras).
delete from public.ia_respostas;
select pg_temp.conversa('i1', '+5584999913421', 'Rita IA');
insert into t134 values ('i1_pergunta',
  pg_temp.dele(pg_temp.id('i1'), now() - interval '26 hours', 'Qual o preço do T134?'));
select pg_temp.atitude(pg_temp.id('i1'), 'morno', now() - interval '27 hours');
select pg_temp.da_ia(pg_temp.id('i1'), now() - interval '26 hours' + interval '30 seconds', 'respondeu',
                     pg_temp.id('i1_pergunta'), 'boa');
select pg_temp.da_ia(pg_temp.id('i1'), now() - interval '25 hours 30 minutes', 'marcou_visita',
                     pg_temp.id('i1_pergunta'));
select pg_temp.dele(pg_temp.id('i1'), now() - interval '25 hours', 'Ótimo, obrigada!');
select pg_temp.atitude(pg_temp.id('i1'), 'interessado', now() - interval '25 hours');
select pg_temp.da_ia(pg_temp.id('treino'), now() - interval '26 hours', 'respondeu', null);

select pg_temp.entrar('a0000000-0000-4000-8000-000000013401'::uuid, 'gestor');
create temp table t134_ia as select public.relatorio_imova_ia(current_date - 6, current_date) as r;
select pg_temp.sair();

select is((select (r -> 'totais' ->> 'respostas')::int from t134_ia), 2, 'duas respostas a clientes; o treino fica fora');
select is((select (r -> 'totais' ->> 'no_treino')::int from t134_ia), 1, 'o treino é contado à parte');
select is((select (r -> 'totais' ->> 'visitas_marcadas')::int from t134_ia), 1, 'uma visita marcada pela IA');
select is((select (r -> 'totais' ->> 'continuou')::int || '/' || (r -> 'totais' ->> 'maduras') from t134_ia), '2/2',
          'o cliente voltou a escrever depois das duas respostas');
select is((select (r -> 'totais' ->> 'mediana_resposta_seg')::numeric from t134_ia), 915::numeric,
          'a mediana do tempo de resposta (30 s e 30 min)');
select is((select (r -> 'interesse' ->> 'subiu')::int from t134_ia), 1, 'de morno para interessado: o interesse subiu');
select is((select (r -> 'totais' ->> 'boas')::int from t134_ia), 1, 'o Boa de quem acompanha');

-- =====================================================================
-- 8. A IA juíza
-- =====================================================================
select is((app.ia_juiza_config() ->> 'ligada')::boolean, true, 'ligada pela chave ia.juiza num banco da Imova');
select ok(app.ia_juiza_enfileirar() >= 1, 'o dia de ontem da Rita entra na fila');
select is(app.ia_juiza_enfileirar(), 0, 'pedir de novo não paga duas vezes');

create temp table t134_dia as
  select (q.criada_em at time zone 'America/Fortaleza')::date as dia
    from public.ia_respostas q where q.conversation_id = pg_temp.id('i1') limit 1;
create temp table t134_entrada as
  select public.ia_juiza_entrada(pg_temp.id('i1'), (select dia from t134_dia)) as e;
select is((select (e ->> 'respostas')::int from t134_entrada),
          (select count(*)::int from public.ia_respostas q
            where q.conversation_id = pg_temp.id('i1')
              and (q.criada_em at time zone 'America/Fortaleza')::date = (select dia from t134_dia)),
          'a entrada conta as respostas do dia');
select ok((select e -> 'mensagens' @> '[{"de": "cliente"}]'::jsonb and e -> 'mensagens' @> '[{"de": "ia"}]'::jsonb
             from t134_entrada), 'a entrada traz o cliente e a IA, separados');
select is((select e ->> 'atitude_antes' from t134_entrada), 'morno', 'a atitude antes da IA');

select is((public.ia_juiza_gravar(pg_temp.id('i1'), (select dia from t134_dia),
            '{"duvida": 6, "informacao": 4, "satisfacao": "5", "interesse": "subiu", "porque": "Respondeu o preço e marcou a visita."}'::jsonb)
           ->> 'ok')::boolean, true, 'a juíza grava');
select is((select coalesce(duvida::text, 'nula') || '/' || informacao || '/' || satisfacao || '/' || interesse
             from public.ia_atendimento_notas where conversation_id = pg_temp.id('i1')),
          'nula/4/5/subiu', 'nota fora de 1 a 5 vira nula em vez de derrubar a gravação');
select pg_temp.entrar('a0000000-0000-4000-8000-000000013401'::uuid, 'gestor');
select is(((public.relatorio_imova_ia(current_date - 6, current_date)) -> 'juiza' ->> 'informacao')::numeric, 4.0::numeric,
          'o relatório traz a média da juíza');
select pg_temp.sair();

select pg_temp.virar('komune');
select is((app.ia_juiza_config() ->> 'ligada')::boolean, false, 'num banco da KOMUNE a juíza não liga');
select is(app.ia_juiza_enfileirar(), 0, 'e não põe nada na fila');
select pg_temp.virar('imova');

-- =====================================================================
-- 9. Quem vê e o WhatsApp
-- =====================================================================
create temp table t134_base as
  select (select count(*) from public.messages where direction = 'out'::app.msg_direction) as saidas,
         (select count(*) from pgmq.q_wa_outbound) as fila;

select pg_temp.entrar('a0000000-0000-4000-8000-000000013402'::uuid, 'sdr');
select lives_ok($$ select public.relatorio_imova_visao_geral(current_date - 30, current_date) $$, 'o SDR vê a visão geral');
select ok((select public.relatorio_imova_visao_geral(current_date - 30, current_date)
             ?& array['contatos', 'agora', 'visitas', 'funil', 'objecoes', 'procura', 'procura_e_oferta', 'anuncios']),
          'a visão geral traz todos os blocos');
select ok(((select public.relatorio_imova_visao_geral(current_date - 30, current_date)) -> 'agora' ->> 'esperando_resposta')::int >= 1,
          'quem espera resposta agora aparece');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000013403'::uuid, 'embaixador');
select throws_ok($$ select * from public.relatorio_imova_quentes() $$, '42501', null, 'o embaixador não vê');
select pg_temp.sair();

select ok(not has_function_privilege('anon', 'public.relatorio_imova_quentes(int)', 'execute'),
          'o anônimo não chama os relatórios');
select ok(not has_function_privilege('authenticated', 'public.ia_juiza_entrada(uuid,date)', 'execute')
          and not has_function_privilege('authenticated', 'public.ia_juiza_gravar(uuid,date,jsonb,bigint,text)', 'execute'),
          'as portas da juíza são só do worker');

select is((select count(*) from public.messages where direction = 'out'::app.msg_direction), (select saidas from t134_base),
          'nenhum relatório escreveu mensagem');
select is((select count(*) from pgmq.q_wa_outbound), (select fila from t134_base),
          'nem pôs nada na fila do WhatsApp');

select * from finish();
rollback;

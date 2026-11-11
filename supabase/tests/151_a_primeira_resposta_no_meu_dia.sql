-- =====================================================================
-- pgTAP — A primeira resposta no Meu dia (migração 20261111201000), só na Imova
--
-- O gargalo de 11/11/2026: o cliente espera 73 min pela primeira resposta no
-- expediente e 10 h fora dele, e "ninguém é cobrado por ela". Pedido: "Uma meta
-- de 'primeira resposta' no Meu dia." Este arquivo prova:
--
--   1. A RÉGUA: a chave `primeira_resposta` com os padrões, e o expediente
--      contado certo (mesmo dia, de sexta à noite para segunda, feriado, fim
--      de semana, intervalo invertido, a régua mudada);
--   2. CADA ESPERA RESPONDIDA: começa na primeira mensagem do cliente, termina
--      na primeira resposta; modelo, falha e robô não respondem; a IA responde;
--      a segunda fala seguida não abre espera; a espera de ontem respondida
--      hoje conta hoje;
--   3. A MEDIANA E O ALVO, da pessoa, com as sem responsável, e o par;
--   4. ESPERANDO AGORA: desde a primeira mensagem sem resposta; modelo e falha
--      não tiram ninguém da espera; reação não abre espera; concluída,
--      bloqueada e quem pediu para sair ficam de fora; sem responsável aparece
--      para todos que atendem, e só uma vez;
--   5. A CONVERSA DE TESTE E A DO TREINO ficam de fora;
--   6. QUEM VÊ QUEM: a hierarquia do Meu dia (`app.acompanha`), a versão da
--      equipe só para admin e gestor;
--   7. A KOMUNE: a leitura recusa; e, no banco da KOMUNE, nada foi criado
--      (o mesmo arquivo roda lá e prova só isso);
--   8. OS PRIVILÉGIOS.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;

select coalesce((select i.empresa from app.identidade i) = 'komune', false) as eh_komune \gset

\if :eh_komune
-- ---------------------------------------------------------------------
-- No banco da KOMUNE a migração não cria nada.
-- ---------------------------------------------------------------------
select plan(5);
select ok(to_regprocedure('public.meu_dia_primeira_resposta(uuid,date)') is null,
  'KOMUNE: a leitura do Meu dia não existe');
select ok(to_regprocedure('app.primeira_resposta_esperando()') is null
          and to_regprocedure('app.primeira_resposta_respondidas(timestamp with time zone,timestamp with time zone)') is null,
  'KOMUNE: as leituras da espera não existem');
select ok(to_regprocedure('app.minutos_no_expediente(timestamp with time zone,timestamp with time zone)') is null,
  'KOMUNE: o relógio do expediente não existe');
select ok(to_regprocedure('app.primeira_resposta_config()') is null,
  'KOMUNE: o leitor da régua não existe');
select ok(not exists (select 1 from public.app_settings where key = 'primeira_resposta'),
  'KOMUNE: a chave primeira_resposta não foi gravada');
select * from finish();
rollback;
\quit
\endif

select plan(58);

insert into public.allowed_users (email, role, note) values
  ('p151.a@teste.local',  'admin',  'pgTAP primeira resposta'),
  ('p151.g@teste.local',  'gestor', 'pgTAP primeira resposta'),
  ('p151.s1@teste.local', 'sdr',    'pgTAP primeira resposta'),
  ('p151.s2@teste.local', 'sdr',    'pgTAP primeira resposta'),
  ('p151.s3@teste.local', 'sdr',    'pgTAP primeira resposta'),
  ('p151.g2@teste.local', 'gestor', 'pgTAP primeira resposta');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000015101'::uuid, 'p151.a@teste.local',  '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000015102'::uuid, 'p151.g@teste.local',  '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000015103'::uuid, 'p151.s1@teste.local', '{"full_name":"Sol SDR"}'),
  ('a0000000-0000-4000-8000-000000015104'::uuid, 'p151.s2@teste.local', '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000015105'::uuid, 'p151.s3@teste.local', '{"full_name":"Saulo Saiu"}'),
  ('a0000000-0000-4000-8000-000000015106'::uuid, 'p151.g2@teste.local', '{"full_name":"Gabi Gestora"}');

-- Nada automático responde enquanto o teste faz mensagens chegarem.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999915100"')
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
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

-- Pessoas pelo apelido: a admin, o gestor, as três SDRs e a outra gestora.
create function pg_temp.p(p_quem text) returns uuid language sql immutable as $$
  select case p_quem
           when 'A'  then 'a0000000-0000-4000-8000-000000015101'
           when 'G'  then 'a0000000-0000-4000-8000-000000015102'
           when 'S1' then 'a0000000-0000-4000-8000-000000015103'
           when 'S2' then 'a0000000-0000-4000-8000-000000015104'
           when 'S3' then 'a0000000-0000-4000-8000-000000015105'
           when 'G2' then 'a0000000-0000-4000-8000-000000015106'
         end::uuid
$$;
grant execute on function pg_temp.p(text) to authenticated;
grant execute on function pg_temp.sair() to authenticated;

create temp table t151(chave text primary key, valor uuid);
grant select on t151 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t151 where chave = p_chave
$$;
grant execute on function pg_temp.id(text) to authenticated;

-- Uma conversa de cliente (sem ficha), atendida por `p_quem`.
create function pg_temp.conversa(p_chave text, p_telefone text, p_quem text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999915100', p_telefone, 'Cliente ' || p_chave,
          pg_temp.p(p_quem), 'aguardando_nos')
  returning id into v;
  insert into t151 values (p_chave, v);
  return v;
end $$;
-- O cliente escreve.
create function pg_temp.chega(p_chave text, p_em timestamptz) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (pg_temp.id(p_chave), 'in', 'text', 'received', 'Ainda está disponível?', 'system', 'crm', p_em);
$$;
-- O cliente reage à última mensagem da conversa.
create function pg_temp.reage(p_chave text, p_em timestamptz) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               reage_a, created_at)
  values (pg_temp.id(p_chave), 'in', 'reaction', 'received', '👍', 'system', 'crm',
          (select m.id from public.messages m where m.conversation_id = pg_temp.id(p_chave)
            order by m.created_at desc limit 1), p_em);
$$;
-- O time escreve: gente (texto ou modelo, enviado ou falhado), o robô fixo ou a IA
-- que atende. São mensagens do passado, já saídas: a porteira (janela de 24 h, rascunho
-- da IA) é de quem ENVIA e fica de lado só para estas linhas; o que se prova aqui é a
-- leitura.
create function pg_temp.responde(p_chave text, p_em timestamptz, p_quem text,
                                 p_tipo text default 'text', p_status text default 'sent',
                                 p_autor text default 'human') returns void language plpgsql as $$
begin
  alter table public.messages disable trigger messages_guard;
  insert into public.messages (conversation_id, direction, type, status, body, template_id,
                               author_kind, sent_by, origin, created_at, sent_at,
                               failed_at, error_code, error_detail)
  values (pg_temp.id(p_chave), 'out', p_tipo::app.msg_type, p_status::app.msg_status,
          'Olá! Está sim.',
          case when p_tipo = 'template' then (select t.id from public.message_templates t order by t.id limit 1) end,
          p_autor, case when p_autor = 'human' then pg_temp.p(p_quem) end, 'crm', p_em,
          case when p_status = 'sent' then p_em end,
          case when p_status = 'failed' then p_em end,
          case when p_status = 'failed' then '131047' end,
          case when p_status = 'failed' then 'Fora da janela de 24 h' end);
  alter table public.messages enable trigger messages_guard;
end $$;
create function pg_temp.ia_responde(p_chave text, p_em timestamptz) returns void language sql as $$
  select pg_temp.responde(p_chave, p_em, null, 'text', 'sent', 'bot_ai');
$$;
-- Um instante em Fortaleza.
create function pg_temp.em(p_quando text) returns timestamptz language sql immutable as $$
  select p_quando::timestamp at time zone 'America/Fortaleza'
$$;
-- A leitura da tela, como a tela chama.
create function pg_temp.ler(p_quem text, p_papel text, p_pessoa text, p_dia date) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.entrar(pg_temp.p(p_quem), p_papel);
  v := public.meu_dia_primeira_resposta(pg_temp.p(p_pessoa), p_dia);
  perform pg_temp.sair();
  return v;
end $$;
-- A linha de uma pessoa na versão da equipe.
create function pg_temp.linha(p_leitura jsonb, p_quem text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(p_leitura -> 'equipe' -> 'pessoas') x
   where (x ->> 'id')::uuid = pg_temp.p(p_quem)
$$;

-- O que já esperava sem responsável antes do teste (no banco local há dados reais).
create temp table t151_base as
  select (select count(*) from app.primeira_resposta_esperando() e where e.dono is null) as sem_dono;

-- ---------------------------------------------------------------------
-- 1. A régua e o expediente
-- ---------------------------------------------------------------------
select is(app.primeira_resposta_config(),
  '{"alvo_min": 15, "gestao_min": 60, "expediente_inicio": "08:00", "expediente_fim": "18:00"}'::jsonb,
  'a régua: 15 min de alvo, a gestão aos 60, expediente das 8h às 18h');

-- Semana de 04/08/2025 (segunda) a 11/08/2025; quinta, 07/08, vira feriado aqui.
insert into public.holidays (date, name, scope) values ('2025-08-07', 'Feriado do pgTAP 151', 'municipal');

select is(app.minutos_no_expediente(pg_temp.em('2025-08-05 10:00'), pg_temp.em('2025-08-05 10:20')),
  20::numeric, 'das 10h às 10h20 do mesmo dia útil: 20 min');
select is(app.minutos_no_expediente(pg_temp.em('2025-08-08 22:00'), pg_temp.em('2025-08-11 08:10')),
  10::numeric, 'sexta 22h, resposta segunda 8h10: 10 min (a noite e o fim de semana não contam)');
select is(app.minutos_no_expediente(pg_temp.em('2025-08-06 17:50'), pg_temp.em('2025-08-08 08:10')),
  20::numeric, 'quarta 17h50 a sexta 8h10, com a quinta feriado: 10 + 10 min');
select is(app.minutos_no_expediente(pg_temp.em('2025-08-04 07:00'), pg_temp.em('2025-08-04 19:00')),
  600::numeric, 'das 7h às 19h: só as 10 h do expediente');
select is(app.minutos_no_expediente(pg_temp.em('2025-08-09 10:00'), pg_temp.em('2025-08-09 12:00')),
  0::numeric, 'sábado não conta');
select ok(app.minutos_no_expediente(pg_temp.em('2025-08-05 10:20'), pg_temp.em('2025-08-05 10:00')) = 0
          and app.minutos_no_expediente(pg_temp.em('2025-08-05 10:00'), pg_temp.em('2025-08-05 10:00')) = 0,
  'intervalo invertido ou vazio: 0');
update public.app_settings set value = value || '{"expediente_inicio": "09:00"}'::jsonb
 where key = 'primeira_resposta';
select is(app.minutos_no_expediente(pg_temp.em('2025-08-04 08:00'), pg_temp.em('2025-08-04 10:00')),
  60::numeric, 'a régua manda: com o expediente às 9h, das 8h às 10h conta 60 min');
update public.app_settings set value = value || '{"expediente_inicio": "08:00"}'::jsonb
 where key = 'primeira_resposta';

-- ---------------------------------------------------------------------
-- 2 e 3. As esperas respondidas na terça, 05/08/2025
-- ---------------------------------------------------------------------
-- S1: cinco esperas respondidas na terça.
select pg_temp.conversa('r1', '+5584900151001', 'S1');
select pg_temp.chega('r1', pg_temp.em('2025-08-05 09:00'));
select pg_temp.chega('r1', pg_temp.em('2025-08-05 09:03'));
select pg_temp.responde('r1', pg_temp.em('2025-08-05 09:10'), 'S1');          -- 10 min
select pg_temp.chega('r1', pg_temp.em('2025-08-05 11:00'));
select pg_temp.responde('r1', pg_temp.em('2025-08-05 11:30'), 'S1');          -- 30 min
select pg_temp.conversa('r2', '+5584900151002', 'S1');
select pg_temp.chega('r2', pg_temp.em('2025-08-04 17:50'));
select pg_temp.responde('r2', pg_temp.em('2025-08-05 08:05'), 'S1');          -- 10 + 5 = 15 min
select pg_temp.conversa('r3', '+5584900151003', 'S1');
select pg_temp.chega('r3', pg_temp.em('2025-08-05 14:00'));
select pg_temp.responde('r3', pg_temp.em('2025-08-05 14:05'), 'S1', 'template');           -- modelo
select pg_temp.responde('r3', pg_temp.em('2025-08-05 14:06'), 'S1', 'text', 'failed');     -- falhou
select pg_temp.responde('r3', pg_temp.em('2025-08-05 14:07'), null, 'text', 'sent', 'bot_fixed'); -- robô
select pg_temp.responde('r3', pg_temp.em('2025-08-05 16:00'), 'S1');          -- 120 min
select pg_temp.conversa('r4', '+5584900151004', 'S1');
select pg_temp.chega('r4', pg_temp.em('2025-08-05 15:00'));
select pg_temp.ia_responde('r4', pg_temp.em('2025-08-05 15:01'));             -- 1 min, pela IA
select pg_temp.conversa('r5', '+5584900151005', 'S1');
select pg_temp.chega('r5', pg_temp.em('2025-08-05 17:00'));
select pg_temp.responde('r5', pg_temp.em('2025-08-06 08:20'), 'S1');          -- quarta: 60 + 20
select pg_temp.conversa('r6', '+5584900151006', 'S1');
select pg_temp.chega('r6', pg_temp.em('2025-08-04 10:00'));
select pg_temp.responde('r6', pg_temp.em('2025-08-04 10:10'), 'S1');          -- segunda
select pg_temp.responde('r6', pg_temp.em('2025-08-05 09:00'), 'S1');          -- terça, sem o cliente ter escrito
select pg_temp.responde('r6', pg_temp.em('2025-08-05 09:05'), 'S1');
-- S2: duas.
select pg_temp.conversa('s2a', '+5584900151011', 'S2');
select pg_temp.chega('s2a', pg_temp.em('2025-08-05 09:00'));
select pg_temp.responde('s2a', pg_temp.em('2025-08-05 09:04'), 'S2');         -- 4 min
select pg_temp.conversa('s2b', '+5584900151012', 'S2');
select pg_temp.chega('s2b', pg_temp.em('2025-08-05 10:00'));
select pg_temp.responde('s2b', pg_temp.em('2025-08-05 10:20'), 'S2');         -- 20 min
-- S3 responde e depois sai da empresa: a conversa fica sem responsável.
select pg_temp.conversa('rsem', '+5584900151021', 'S3');
select pg_temp.chega('rsem', pg_temp.em('2025-08-05 13:00'));
select pg_temp.responde('rsem', pg_temp.em('2025-08-05 13:40'), 'S3');        -- 40 min
-- A conversa de teste e a do treino da IA, de S1: rápidas ou lentas, não contam.
select pg_temp.conversa('teste', '+5584900151031', 'S1');
select pg_temp.chega('teste', pg_temp.em('2025-08-05 10:00'));
select pg_temp.responde('teste', pg_temp.em('2025-08-05 10:50'), 'S1');
select pg_temp.conversa('treino', '+5584900151032', 'S1');
select pg_temp.chega('treino', pg_temp.em('2025-08-05 10:00'));
select pg_temp.responde('treino', pg_temp.em('2025-08-05 10:40'), 'S1');
insert into public.app_settings (key, value)
values ('ia.atendente', jsonb_build_object('ligada', false,
                                           'conversa_de_treino', pg_temp.id('treino'),
                                           'conversas_de_teste', jsonb_build_array(pg_temp.id('teste'))))
on conflict (key) do update
  set value = public.app_settings.value || excluded.value;

-- ---------------------------------------------------------------------
-- 4. Esperando agora (o relógio do teste é o now() da transação)
-- ---------------------------------------------------------------------
select pg_temp.conversa('e1', '+5584900151041', 'S1');
select pg_temp.chega('e1', now() - interval '3 hours');
select pg_temp.chega('e1', now() - interval '2 hours');
select pg_temp.conversa('e2', '+5584900151042', 'S1');
select pg_temp.chega('e2', now() - interval '1 hour');
select pg_temp.responde('e2', now() - interval '50 minutes', 'S1', 'template');
select pg_temp.conversa('e3', '+5584900151043', 'S1');
select pg_temp.chega('e3', now() - interval '30 minutes');
select pg_temp.responde('e3', now() - interval '20 minutes', 'S1');
select pg_temp.conversa('e4', '+5584900151044', 'S1');
select pg_temp.chega('e4', now() - interval '5 hours');
select pg_temp.responde('e4', now() - interval '4 hours', 'S1');
select pg_temp.reage('e4', now() - interval '3 hours');
select pg_temp.conversa('e5', '+5584900151045', 'S1');
select pg_temp.chega('e5', now() - interval '2 hours');
update public.conversations set arquivada_em = now(), arquivada_por = pg_temp.p('S1')
 where id = pg_temp.id('e5');
select pg_temp.conversa('e6', '+5584900151046', 'S1');
select pg_temp.chega('e6', now() - interval '2 hours');
update public.conversations set bloqueada_em = now(), bloqueada_por = pg_temp.p('S1')
 where id = pg_temp.id('e6');
select pg_temp.conversa('e7', '+5584900151047', 'S1');
select pg_temp.chega('e7', now() - interval '2 hours');
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex('+5584900151047'), 'phone', 'pgTAP 151');
select pg_temp.conversa('e9', '+5584900151049', 'S1');
select pg_temp.chega('e9', now() - interval '40 minutes');
select pg_temp.responde('e9', now() - interval '30 minutes', 'S1', 'text', 'failed');
select pg_temp.chega('teste', now() - interval '1 hour');
select pg_temp.conversa('esem', '+5584900151051', 'S3');
select pg_temp.chega('esem', now() - interval '4 hours');
select pg_temp.conversa('e8', '+5584900151048', 'S2');
select pg_temp.chega('e8', now() - interval '10 minutes');

-- Saulo sai da empresa: o que era dele fica sem responsável.
update public.profiles set is_active = false where id = pg_temp.p('S3');

-- ---------------------------------------------------------------------
-- 2. Cada espera respondida
-- ---------------------------------------------------------------------
create temp table t151_resp as
  select r.*, t.chave
    from app.primeira_resposta_respondidas(pg_temp.em('2025-08-05 00:00'), pg_temp.em('2025-08-06 00:00')) r
    join t151 t on t.valor = r.conversation_id;

select is((select array_agg(minutos order by desde) from t151_resp where chave = 'r1'),
  array[10, 30]::numeric[],
  'duas esperas na mesma conversa; a primeira conta da primeira mensagem (9h), não da segunda (9h03)');
select is((select minutos from t151_resp where chave = 'r2'), 15::numeric,
  'a espera de segunda respondida na terça conta na terça: 10 min de segunda + 5 de terça');
select is((select minutos from t151_resp where chave = 'r3'), 120::numeric,
  'modelo, mensagem que falhou e robô fixo não respondem: a espera vai até a resposta de gente');
select ok((select pela_ia and minutos = 1 from t151_resp where chave = 'r4'),
  'a IA que atende responde (1 min) e a linha diz que foi ela');
select ok(not exists (select 1 from t151_resp where chave = 'r5'),
  'a resposta de quarta não entra na terça');
select is((select minutos from app.primeira_resposta_respondidas(pg_temp.em('2025-08-06 00:00'), pg_temp.em('2025-08-07 00:00')) r
            where r.conversation_id = pg_temp.id('r5')), 80::numeric,
  'na quarta ela entra: 60 min de terça + 20 de quarta');
select ok(not exists (select 1 from t151_resp where chave = 'r6'),
  'falar de novo sem o cliente ter escrito não abre espera');
select ok(not exists (select 1 from t151_resp where chave in ('teste', 'treino')),
  'a conversa de teste e a do treino da IA ficam de fora');
select ok((select dono is null from t151_resp where chave = 'rsem')
          and (select bool_and(dono = pg_temp.p('S1')) from t151_resp where chave = 'r1'),
  'de quem é: quem atende; quem saiu da empresa deixa a conversa sem responsável');

-- ---------------------------------------------------------------------
-- 3. A mediana e o alvo
-- ---------------------------------------------------------------------
create temp table t151_l (quem text primary key, v jsonb);
grant select on t151_l to authenticated;
insert into t151_l values
  ('S1',     pg_temp.ler('S1', 'sdr',    null, '2025-08-05')),
  ('S2',     pg_temp.ler('S2', 'sdr',    null, '2025-08-05')),
  ('G',      pg_temp.ler('G',  'gestor', null, '2025-08-05')),
  ('A',      pg_temp.ler('A',  'admin',  null, '2025-08-05')),
  ('G>S1',   pg_temp.ler('G',  'gestor', 'S1', '2025-08-05')),
  ('S1>S2',  pg_temp.ler('S1', 'sdr',    'S2', '2025-08-05'));

-- Sol: 1, 10, 15, 30, 120 e a sem responsável (40).
select is((select v -> 'pessoa' -> 'respondidas' from t151_l where quem = 'S1'), '6'::jsonb,
  'Sol: as cinco esperas dela respondidas na terça e a sem responsável');
select is((select v -> 'pessoa' -> 'mediana_min' from t151_l where quem = 'S1'), '22.5'::jsonb,
  'Sol: a mediana de 1, 10, 15, 30, 40 e 120 é 22,5 min');
select is((select v -> 'pessoa' -> 'no_alvo' from t151_l where quem = 'S1'), '3'::jsonb,
  'Sol: 3 em até 15 min (1, 10 e o 15 da borda)');
select is((select v -> 'pessoa' -> 'mediana_min' from t151_l where quem = 'S2'), '20'::jsonb,
  'Sara: a mediana de 4, 20 e 40 é 20 min');
select is((select v -> 'regua' from t151_l where quem = 'S1'),
  '{"alvo_min": 15, "gestao_min": 60, "expediente_inicio": "08:00", "expediente_fim": "18:00"}'::jsonb,
  'a leitura devolve a régua, para a tela comparar');
select is((select v ->> 'dia' from t151_l where quem = 'S1'), '2025-08-05', 'e o dia pedido');

-- ---------------------------------------------------------------------
-- 4. Esperando agora
-- ---------------------------------------------------------------------
create temp table t151_esp as
  select e.*, t.chave from app.primeira_resposta_esperando() e join t151 t on t.valor = e.conversation_id;

select is((select desde from t151_esp where chave = 'e1'), now() - interval '3 hours',
  'espera desde a primeira mensagem sem resposta, e não da última');
select ok(exists (select 1 from t151_esp where chave = 'e2'),
  'o modelo não tira o cliente da espera');
select ok(exists (select 1 from t151_esp where chave = 'e9'),
  'a resposta que falhou não tira o cliente da espera');
select ok(not exists (select 1 from t151_esp where chave = 'e3'),
  'quem foi respondido não espera');
select ok(not exists (select 1 from t151_esp where chave = 'e4'),
  'reação não abre espera');
select ok(not exists (select 1 from t151_esp where chave in ('e5', 'e6', 'e7')),
  'concluída, bloqueada e quem pediu para sair ficam de fora');
select ok(not exists (select 1 from t151_esp where chave = 'teste'),
  'a conversa de teste não espera ninguém');
select ok(not exists (select 1 from t151_esp where chave like 'r%' or chave in ('s2a', 's2b')),
  'as conversas respondidas não esperam');

select is((select v -> 'pessoa' -> 'esperando' from t151_l where quem = 'S1'),
  to_jsonb(4 + (select sem_dono from t151_base)),
  'Sol: três esperas dela e a sem responsável');
select is((select v -> 'pessoa' -> 'sem_responsavel' from t151_l where quem = 'S1'),
  to_jsonb(1 + (select sem_dono from t151_base)),
  'Sol: e diz quantas são sem responsável');
select is((select array_agg(t.chave order by o.n)
             from t151_l l
             cross join lateral jsonb_array_elements(l.v -> 'pessoa' -> 'itens') with ordinality o (x, n)
             join t151 t on t.valor = (o.x ->> 'conversation_id')::uuid
            where l.quem = 'S1'),
  array['esem', 'e1', 'e2', 'e9'],
  'Sol: a lista vai da mais antiga para a mais nova');
select ok((select (x ->> 'sem_responsavel')::boolean and x ->> 'caminho' = '/conversas?cliente=' || pg_temp.id('esem')
                  and x ->> 'nome' = 'Cliente esem'
             from t151_l l, jsonb_array_elements(l.v -> 'pessoa' -> 'itens') x
            where l.quem = 'S1' and (x ->> 'conversation_id')::uuid = pg_temp.id('esem')),
  'cada item diz o nome, o caminho da conversa e se está sem responsável');
select ok((select (x ->> 'minutos')::numeric between 0 and 240
             from t151_l l, jsonb_array_elements(l.v -> 'pessoa' -> 'itens') x
            where l.quem = 'S1' and (x ->> 'conversation_id')::uuid = pg_temp.id('esem')),
  'e quantos minutos de expediente a espera já tem');
select is((select v -> 'pessoa' -> 'esperando' from t151_l where quem = 'S2'),
  to_jsonb(2 + (select sem_dono from t151_base)),
  'Sara: a dela e a sem responsável');

-- ---------------------------------------------------------------------
-- 6. Quem vê quem, e a versão da equipe
-- ---------------------------------------------------------------------
select is((select v -> 'pessoa' ->> 'id' from t151_l where quem = 'G>S1'), pg_temp.p('S1')::text,
  'o gestor abre o dia da SDR');
select is((select v -> 'pessoa' -> 'esperando' from t151_l where quem = 'G>S1'),
  (select v -> 'pessoa' -> 'esperando' from t151_l where quem = 'S1'),
  'e vê o mesmo que ela vê');
select is((select v -> 'pessoa' ->> 'id' from t151_l where quem = 'S1>S2'), pg_temp.p('S2')::text,
  'a SDR abre o dia de outra SDR (o SDR acompanha o mesmo que o gestor)');

select pg_temp.entrar(pg_temp.p('S1'), 'sdr');
select throws_ok($$select public.meu_dia_primeira_resposta(pg_temp.p('G'), null)$$, '42501', null,
  'a SDR não abre o dia do gestor');
select pg_temp.sair();
select pg_temp.entrar(pg_temp.p('G'), 'gestor');
select throws_ok($$select public.meu_dia_primeira_resposta(pg_temp.p('A'), null)$$, '42501', null,
  'o gestor não abre o dia da admin');
select throws_ok($$select public.meu_dia_primeira_resposta(pg_temp.p('G2'), null)$$, '42501', null,
  'nem o de outro gestor');
select throws_ok($$select public.meu_dia_primeira_resposta(pg_temp.p('S3'), null)$$, '42501', null,
  'nem o de quem saiu da empresa');
select pg_temp.sair();
select is((select v -> 'pessoa' ->> 'id' from (select pg_temp.ler('A', 'admin', 'G', '2025-08-05') as v) x),
  pg_temp.p('G')::text, 'a admin abre o dia do gestor');
select throws_ok($$select public.meu_dia_primeira_resposta(null, null)$$, '42501', null,
  'sem sessão, nada');

select ok((select v -> 'equipe' = 'null'::jsonb from t151_l where quem = 'S1'),
  'a SDR não recebe a versão da equipe');
select ok((select pg_temp.linha(v, 'S1') is not null and pg_temp.linha(v, 'S2') is not null
                  and pg_temp.linha(v, 'G') is not null
                  and pg_temp.linha(v, 'A') is null and pg_temp.linha(v, 'G2') is null
                  and pg_temp.linha(v, 'S3') is null
             from t151_l where quem = 'G'),
  'o gestor vê ele mesmo e as SDRs; não a admin, nem a outra gestora, nem quem saiu');
select ok((select pg_temp.linha(v, 'G') is not null and pg_temp.linha(v, 'G2') is not null
                  and pg_temp.linha(v, 'S1') is not null
             from t151_l where quem = 'A'),
  'a admin vê os gestores e as SDRs');
select is((select pg_temp.linha(v, 'S1') - 'id' - 'nome' - 'papel' - 'mais_antiga' - 'mais_antiga_min'
             from t151_l where quem = 'G'),
  '{"esperando": 3, "respondidas": 5, "no_alvo": 3, "mediana_min": 15}'::jsonb,
  'a linha da Sol na equipe: as três dela esperando e as cinco respondidas, sem a sem responsável');
select is((select pg_temp.linha(v, 'S2') -> 'mediana_min' from t151_l where quem = 'G'), '12'::jsonb,
  'a linha da Sara: a mediana de 4 e 20 é 12 min');
select ok((select pg_temp.linha(v, 'S1') ->> 'mais_antiga' = to_jsonb(now() - interval '3 hours') #>> '{}'
                  and (pg_temp.linha(v, 'S1') ->> 'mais_antiga_min')::numeric
                      = app.minutos_no_expediente(now() - interval '3 hours', now())
             from t151_l where quem = 'G'),
  'e a espera mais antiga de cada um, com os minutos de expediente dela');
select ok((select (v -> 'equipe' -> 'sem_responsavel' -> 'esperando')::int = 1 + (select sem_dono from t151_base)
                  and v -> 'equipe' -> 'sem_responsavel' -> 'respondidas' = '1'::jsonb
                  and v -> 'equipe' -> 'sem_responsavel' -> 'mediana_min' = '40'::jsonb
             from t151_l where quem = 'G'),
  'as sem responsável à parte: uma esperando e uma respondida em 40 min');
select is((select (v -> 'equipe' -> 'total') - 'esperando' - 'mais_antiga' - 'mais_antiga_min'
             from t151_l where quem = 'G'),
  '{"respondidas": 8, "no_alvo": 4, "mediana_min": 17.5}'::jsonb,
  'o total da equipe: 8 respondidas, 4 no alvo, mediana 17,5 min');

-- ---------------------------------------------------------------------
-- 7. A KOMUNE
-- ---------------------------------------------------------------------
select pg_temp.virar('komune');
select pg_temp.entrar(pg_temp.p('G'), 'gestor');
select throws_ok($$select public.meu_dia_primeira_resposta(null, null)$$, '0A000', null,
  'com a identidade da KOMUNE, a leitura recusa');
select pg_temp.sair();
select pg_temp.virar('imova');

-- ---------------------------------------------------------------------
-- 8. Os privilégios
-- ---------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.meu_dia_primeira_resposta(uuid,date)', 'execute')
          and not has_function_privilege('anon', 'public.meu_dia_primeira_resposta(uuid,date)', 'execute'),
  'a leitura da tela é de quem está logado, e não de anônimo');
select ok(not has_function_privilege('authenticated', 'app.primeira_resposta_esperando()', 'execute')
          and not has_function_privilege('anon', 'app.primeira_resposta_esperando()', 'execute')
          and not has_function_privilege('authenticated', 'app.primeira_resposta_respondidas(timestamptz,timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.primeira_resposta_respondidas(timestamptz,timestamptz)', 'execute'),
  'as leituras da espera só rodam por dentro das funções do banco');
select ok(not has_function_privilege('authenticated', 'app.minutos_no_expediente(timestamptz,timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.minutos_no_expediente(timestamptz,timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'app.primeira_resposta_config()', 'execute')
          and not has_function_privilege('anon', 'app.primeira_resposta_config()', 'execute'),
  'a régua e o relógio do expediente também');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — A espera em degraus (migração 20261111200000), só na Imova
--
-- Pedido de 11/11/2026: "Alerta em degraus: 15 min sem resposta avisa quem
-- atende; 1 h avisa a gestão." Este arquivo prova:
--
--   1. O RELÓGIO DO EXPEDIENTE: 22h de sexta até 8h10 de segunda são 10 min;
--      10h às 10h20 do mesmo dia útil são 20; fim de semana e feriado não contam;
--      intervalo invertido é 0;
--   2. O DEGRAU 1 (15 min), uma vez por espera, pela regra do aviso de mensagem:
--      antes da primeira resposta do time, todos que atendem; com resposta do
--      time, ficha e responsável que atende, só o responsável;
--   3. O DEGRAU 2 (1 h) avisa admin e gestor (não o SDR), dizendo com quem está;
--   4. O QUE É ESPERA: resposta de gente ou da IA encerra; modelo e mensagem que
--      falhou não; reação não começa espera; o cliente que escreve de novo não
--      atrasa o alerta; mensagem da noite conta da abertura;
--   5. FICA DE FORA: quem silenciou, a conversa de teste, a concluída (até o
--      cliente voltar, e aí conta da volta), a bloqueada e a suprimida;
--   6. O DEGRAU DESLIGADO em "Avisos no celular" não sai, no celular nem no
--      computador;
--   7. O COMPUTADOR pergunta ao banco e recebe a mesma regra;
--   8. A KOMUNE fica sem nada novo, e o catálogo da Imova ganha os dois avisos;
--   9. OS PRIVILÉGIOS, e o WhatsApp não é tocado.
--
-- No banco da KOMUNE de verdade (identidade komune, sem as funções da Imova) o
-- arquivo prova só que nada da espera foi criado e que a rodada segue igual.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
select to_regprocedure('app.esperas_de_resposta(timestamptz)') is not null as tem_espera \gset
begin;

\if :tem_espera
select plan(56);

insert into public.allowed_users (email, role, note) values
  ('e150.joao@teste.local', 'gestor', 'pgTAP espera em degraus'),
  ('e150.gabi@teste.local', 'gestor', 'pgTAP espera em degraus'),
  ('e150.sara@teste.local', 'sdr', 'pgTAP espera em degraus'),
  ('e150.ana@teste.local', 'admin', 'pgTAP espera em degraus'),
  ('e150.ex@teste.local', 'gestor', 'pgTAP espera em degraus');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000015001'::uuid, 'e150.joao@teste.local', '{"full_name":"João Lima"}'),
  ('a0000000-0000-4000-8000-000000015002'::uuid, 'e150.gabi@teste.local', '{"full_name":"Gabi Gestora"}'),
  ('a0000000-0000-4000-8000-000000015003'::uuid, 'e150.sara@teste.local', '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000015004'::uuid, 'e150.ana@teste.local', '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000015005'::uuid, 'e150.ex@teste.local', '{"full_name":"Ex Gestor"}');
-- Quem saiu da empresa: a conversa dele fica "sem responsável".
update public.profiles set is_active = false where id = 'a0000000-0000-4000-8000-000000015005'::uuid;

-- Nada automático responde enquanto o teste monta as conversas.
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
-- A configuração padrão, mesmo que o banco local tenha outra.
delete from public.app_settings where key = 'primeira_resposta';
-- Nada vai ao Expo: sem aparelho, o envio só marca o que sairia.
delete from public.aparelhos_push;

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
-- A empresa do banco, para o mesmo arquivo provar a KOMUNE e a Imova.
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

create temp table t150(chave text primary key, valor uuid);
grant select on t150 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t150 where chave = p_chave
$$;
grant execute on function pg_temp.id(text) to authenticated;
-- Uma conversa de cliente (sem ficha), com `p_dono` atendendo.
create function pg_temp.conversa(p_chave text, p_tel text, p_nome text, p_dono uuid) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999915000', p_tel, p_nome, p_dono, 'aguardando_nos')
  returning id into v;
  insert into t150 values (p_chave, v);
  return v;
end $$;
-- Mensagem do cliente em `p_em`, sem os gatilhos da entrada (robô, IA, ficha): a
-- conversa é anotada à mão, como o gatilho faria.
create function pg_temp.dele(p_chave text, p_em timestamptz, p_tipo text default 'text') returns void
language plpgsql as $$
begin
  set local session_replication_role = replica;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               reage_a_wamid, created_at)
  values (pg_temp.id(p_chave), 'in'::app.msg_direction, p_tipo::app.msg_type, 'received'::app.msg_status,
          case when p_tipo = 'reaction' then '👍' else 'tem visita no sábado?' end, 'system', 'crm',
          case when p_tipo = 'reaction' then 'wamid.PGTAP150.alvo' end, p_em);
  set local session_replication_role = origin;
  update public.conversations set last_inbound_at = greatest(coalesce(last_inbound_at, p_em), p_em)
   where id = pg_temp.id(p_chave);
end $$;
-- Mensagem do time em `p_em`, sem a porteira (só para montar o cenário).
create function pg_temp.nossa(p_chave text, p_em timestamptz, p_autor text default 'human',
                              p_tipo text default 'text', p_status text default 'sent') returns void
language plpgsql as $$
begin
  set local session_replication_role = replica;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, error_code, created_at, sent_at)
  values (pg_temp.id(p_chave), 'out'::app.msg_direction, p_tipo::app.msg_type, p_status::app.msg_status,
          'Olá! Tem sim.', p_autor, 'crm',
          case when p_autor = 'human' then 'a0000000-0000-4000-8000-000000015001'::uuid end,
          case when p_status = 'failed' then 'pgtap150' end, p_em, p_em);
  set local session_replication_role = origin;
  update public.conversations set last_outbound_at = greatest(coalesce(last_outbound_at, p_em), p_em)
   where id = pg_temp.id(p_chave);
end $$;
-- A conversa ganha ficha (o cliente com ficha, como a Imova faz sozinha).
create function pg_temp.ficha(p_chave text, p_nome text) returns uuid language plpgsql as $$
declare v_org uuid;
begin
  insert into public.organizations (name, phone_e164, source_id, collector)
  select p_nome, c.peer_phone_e164, (select id from public.sources where slug = 'planilha'), 'pgtap150'
    from public.conversations c where c.id = pg_temp.id(p_chave)
  returning id into v_org;
  update public.conversations set organization_id = v_org where id = pg_temp.id(p_chave);
  return v_org;
end $$;
create function pg_temp.quantos(p_chave text, p_tipo text, p_pessoa uuid) returns bigint language sql stable as $$
  select count(*) from app.push_fila
   where conversa_id = pg_temp.id(p_chave) and tipo = p_tipo and pessoa_id = p_pessoa
$$;
create function pg_temp.avisos(p_chave text, p_tipo text) returns bigint language sql stable as $$
  select count(*) from app.push_fila where conversa_id = pg_temp.id(p_chave) and tipo = p_tipo
$$;
create function pg_temp.recebeu(p_chave text, p_tipo text, p_pessoa uuid) returns boolean language sql stable as $$
  select exists (select 1 from app.push_fila
                  where conversa_id = pg_temp.id(p_chave) and tipo = p_tipo and pessoa_id = p_pessoa)
$$;

select pg_temp.virar('imova');

-- ---------------------------------------------------------------------
-- 1. O relógio do expediente (padrão: dias úteis, 8h às 18h, Fortaleza)
-- ---------------------------------------------------------------------
select is(app.minutos_no_expediente('2026-11-06 22:00-03', '2026-11-09 08:10-03'), 10::numeric,
          'mensagem às 22h de sexta, resposta na segunda às 8h10: 10 min de expediente');
select is(app.minutos_no_expediente('2026-11-09 10:00-03', '2026-11-09 10:20-03'), 20::numeric,
          'das 10h às 10h20 do mesmo dia útil: 20 min');
select is(app.minutos_no_expediente('2026-11-06 17:00-03', '2026-11-10 09:00-03'), 720::numeric,
          'sexta 17h a terça 9h: 1 h de sexta, a segunda inteira (10 h) e 1 h de terça');
select is(app.minutos_no_expediente('2026-11-07 09:00-03', '2026-11-08 17:00-03'), 0::numeric,
          'o fim de semana não conta');
select is(app.minutos_no_expediente('2026-11-09 10:20-03', '2026-11-09 10:00-03'), 0::numeric,
          'intervalo invertido devolve 0');
insert into public.holidays (date, name) values ('2026-11-10', 'Feriado do pgTAP 150');
select is(app.minutos_no_expediente('2026-11-06 17:00-03', '2026-11-10 09:00-03'), 660::numeric,
          'o feriado também não conta');
delete from public.holidays where name = 'Feriado do pgTAP 150';
select is(app.primeira_resposta_config() ->> 'alvo_min', '15',
          'sem a chave no banco, valem os padrões (alvo de 15 min)');

-- ---------------------------------------------------------------------
-- 2 e 3. Os dois degraus (segunda, 09/11/2026)
-- ---------------------------------------------------------------------
select pg_temp.conversa('maria', '+5584900015001', 'Maria Souza', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('maria', '2026-11-09 10:00-03');
-- O cliente que insiste não atrasa o alerta: espera desde o primeiro "oi".
select pg_temp.conversa('lucas', '+5584900015002', 'Lucas Insistente', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('lucas', '2026-11-09 10:00-03');
select pg_temp.dele('lucas', '2026-11-09 10:10-03');
-- O responsável saiu da empresa: a conversa é de todos que atendem.
select pg_temp.conversa('sem_dono', '+5584900015003', 'Sem Dono', 'a0000000-0000-4000-8000-000000015005'::uuid);
select pg_temp.dele('sem_dono', '2026-11-09 10:00-03');
-- O time já respondeu antes (João), a conversa tem ficha e ele atende: a espera
-- nova é dele.
select pg_temp.conversa('atendida', '+5584900015004', 'Pedro', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.ficha('atendida', 'Pedro Atendido');
select pg_temp.dele('atendida', '2026-11-09 09:00-03');
select pg_temp.nossa('atendida', '2026-11-09 09:05-03');
select pg_temp.dele('atendida', '2026-11-09 10:00-03');

select app.avisos_push_varrer_espera('2026-11-09 10:14-03');
select is(pg_temp.avisos('maria', 'espera'), 0::bigint, 'aos 14 min ninguém é avisado');

select app.avisos_push_varrer_espera('2026-11-09 10:15-03');
select ok(pg_temp.recebeu('maria', 'espera', 'a0000000-0000-4000-8000-000000015001'::uuid)
          and pg_temp.recebeu('maria', 'espera', 'a0000000-0000-4000-8000-000000015002'::uuid)
          and pg_temp.recebeu('maria', 'espera', 'a0000000-0000-4000-8000-000000015003'::uuid)
          and pg_temp.recebeu('maria', 'espera', 'a0000000-0000-4000-8000-000000015004'::uuid),
          'ninguém do time respondeu ainda (a primeira resposta): aos 15 min todos que atendem são avisados, o responsável, os gestores, o SDR e a admin');
select ok(pg_temp.avisos('atendida', 'espera') = 1
          and pg_temp.recebeu('atendida', 'espera', 'a0000000-0000-4000-8000-000000015001'::uuid),
          'o time já respondeu, a conversa tem ficha e o responsável atende: só o responsável é avisado');
select is((select corpo from app.push_fila
            where conversa_id = pg_temp.id('maria') and tipo = 'espera' and pessoa_id = 'a0000000-0000-4000-8000-000000015001'::uuid),
          'Maria Souza espera resposta há 15 min', 'o aviso diz quem e há quanto tempo');
select is((select caminho from app.push_fila
            where conversa_id = pg_temp.id('maria') and tipo = 'espera' and pessoa_id = 'a0000000-0000-4000-8000-000000015001'::uuid),
          '/conversas?cliente=' || pg_temp.id('maria'), 'o toque abre a conversa');
select ok(pg_temp.recebeu('lucas', 'espera', 'a0000000-0000-4000-8000-000000015001'::uuid),
          'quem escreveu de novo aos 10 min é avisado aos 15 min do primeiro "oi"');
select ok(pg_temp.recebeu('sem_dono', 'espera', 'a0000000-0000-4000-8000-000000015002'::uuid)
          and pg_temp.recebeu('sem_dono', 'espera', 'a0000000-0000-4000-8000-000000015003'::uuid)
          and pg_temp.recebeu('sem_dono', 'espera', 'a0000000-0000-4000-8000-000000015004'::uuid),
          'responsável fora da empresa: todos que atendem são avisados (gestor, SDR e admin)');

create temp table t150_antes_da_repeticao as
  select count(*) as n from app.push_fila
   where conversa_id in (pg_temp.id('maria'), pg_temp.id('lucas'), pg_temp.id('sem_dono'));
select app.avisos_push_varrer_espera('2026-11-09 10:15:10-03');
select app.avisos_push_varrer_espera('2026-11-09 10:20-03');
select is((select count(*) from app.push_fila
            where conversa_id in (pg_temp.id('maria'), pg_temp.id('lucas'), pg_temp.id('sem_dono'))),
          (select n from t150_antes_da_repeticao),
          'as rodadas seguintes não repetem o aviso da mesma espera');
select is(pg_temp.quantos('maria', 'espera', 'a0000000-0000-4000-8000-000000015001'::uuid), 1::bigint, 'a mesma espera não avisa duas vezes');
select is(pg_temp.avisos('maria', 'espera_gestao'), 0::bigint, 'aos 15 min a gestão ainda não é avisada');

select app.avisos_push_varrer_espera('2026-11-09 11:00-03');
select ok(pg_temp.recebeu('maria', 'espera_gestao', 'a0000000-0000-4000-8000-000000015002'::uuid)
          and pg_temp.recebeu('maria', 'espera_gestao', 'a0000000-0000-4000-8000-000000015004'::uuid),
          'a 1 h, admin e gestor são avisados');
select ok(not pg_temp.recebeu('maria', 'espera_gestao', 'a0000000-0000-4000-8000-000000015003'::uuid),
          'o SDR não recebe o aviso da gestão');
select is((select corpo from app.push_fila
            where conversa_id = pg_temp.id('maria') and tipo = 'espera_gestao'
              and pessoa_id = 'a0000000-0000-4000-8000-000000015004'::uuid),
          'Maria Souza espera resposta há 1 h · com João', 'o aviso da gestão diz com quem está');
select is((select corpo from app.push_fila
            where conversa_id = pg_temp.id('sem_dono') and tipo = 'espera_gestao'
              and pessoa_id = 'a0000000-0000-4000-8000-000000015004'::uuid),
          'Sem Dono espera resposta há 1 h · sem responsável', 'sem responsável que atenda, diz isso');
select is(pg_temp.quantos('maria', 'espera', 'a0000000-0000-4000-8000-000000015001'::uuid), 1::bigint, 'a 1 h o degrau de 15 min não volta');

-- ---------------------------------------------------------------------
-- 4. O que é espera
-- ---------------------------------------------------------------------
select pg_temp.conversa('respondida', '+5584900015011', 'Rita Respondida', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('respondida', '2026-11-09 10:00-03');
select pg_temp.nossa('respondida', '2026-11-09 10:05-03');
select pg_temp.conversa('ia', '+5584900015012', 'Ivo da IA', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('ia', '2026-11-09 10:00-03');
select pg_temp.nossa('ia', '2026-11-09 10:01-03', 'bot_ai');
select pg_temp.conversa('falhou', '+5584900015013', 'Fábio Falhou', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('falhou', '2026-11-09 10:00-03');
select pg_temp.nossa('falhou', '2026-11-09 10:05-03', 'human', 'text', 'failed');
select pg_temp.nossa('falhou', '2026-11-09 10:06-03', 'bot_fixed', 'template', 'sent');
select pg_temp.conversa('reacao', '+5584900015014', 'Rui Reação', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('reacao', '2026-11-09 09:00-03');
select pg_temp.nossa('reacao', '2026-11-09 09:05-03');
select pg_temp.dele('reacao', '2026-11-09 10:00-03', 'reaction');
select pg_temp.conversa('noite', '+5584900015015', 'Nina da Noite', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('noite', '2026-11-06 22:00-03');

select app.avisos_push_varrer_espera('2026-11-09 10:15-03');
select ok(pg_temp.avisos('respondida', 'espera') = 0 and pg_temp.avisos('ia', 'espera') = 0,
          'respondida por gente ou pela IA que atende: não é espera');
select ok(pg_temp.recebeu('falhou', 'espera', 'a0000000-0000-4000-8000-000000015001'::uuid),
          'resposta que falhou e modelo automático não contam: o cliente segue esperando');
select is(pg_temp.avisos('reacao', 'espera'), 0::bigint, 'reação do cliente não começa espera');

select app.avisos_push_varrer_espera('2026-11-09 08:14-03');
select is(pg_temp.avisos('noite', 'espera'), 0::bigint,
          'mensagem das 22h de sexta: às 8h14 de segunda ainda não deu 15 min');
select app.avisos_push_varrer_espera('2026-11-09 08:15-03');
select ok(pg_temp.recebeu('noite', 'espera', 'a0000000-0000-4000-8000-000000015001'::uuid),
          'mensagem das 22h de sexta: o aviso sai às 8h15 de segunda');

-- ---------------------------------------------------------------------
-- 5. O que fica de fora
-- ---------------------------------------------------------------------
select pg_temp.conversa('silenciada', '+5584900015021', 'Sílvia Silenciada', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('silenciada', '2026-11-09 10:00-03');
insert into public.conversa_preferencias (profile_id, conversation_id, silenciada_ate) values
  ('a0000000-0000-4000-8000-000000015001'::uuid, pg_temp.id('silenciada'), 'infinity'),
  ('a0000000-0000-4000-8000-000000015002'::uuid, pg_temp.id('silenciada'), 'infinity');
select pg_temp.conversa('teste', '+5584900015022', 'Matheu Rondon Teste', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('teste', '2026-11-09 10:00-03');
insert into public.app_settings (key, value)
values ('ia.atendente', jsonb_build_object('conversas_de_teste', jsonb_build_array(pg_temp.id('teste'))))
on conflict (key) do update set value = public.app_settings.value || excluded.value;
select pg_temp.conversa('concluida', '+5584900015023', 'Clara Concluída', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('concluida', '2026-11-09 09:00-03');
update public.conversations set arquivada_em = '2026-11-09 09:01-03' where id = pg_temp.id('concluida');
select pg_temp.conversa('bloqueada', '+5584900015024', 'Bia Bloqueada', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('bloqueada', '2026-11-09 10:00-03');
update public.conversations set bloqueada_em = '2026-11-09 10:01-03' where id = pg_temp.id('bloqueada');
select pg_temp.conversa('suprimida', '+5584900015025', 'Sueli Suprimida', 'a0000000-0000-4000-8000-000000015001'::uuid);
select pg_temp.dele('suprimida', '2026-11-09 10:00-03');
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex('+5584900015025'), 'phone', 'pgTAP 150');

select app.avisos_push_varrer_espera('2026-11-09 10:15-03');
select app.avisos_push_varrer_espera('2026-11-09 11:00-03');
select ok(not pg_temp.recebeu('silenciada', 'espera', 'a0000000-0000-4000-8000-000000015001'::uuid)
          and not pg_temp.recebeu('silenciada', 'espera', 'a0000000-0000-4000-8000-000000015002'::uuid)
          and pg_temp.recebeu('silenciada', 'espera', 'a0000000-0000-4000-8000-000000015003'::uuid),
          'quem silenciou a conversa não recebe o aviso de 15 min; os outros que atendem recebem');
select ok(not pg_temp.recebeu('silenciada', 'espera_gestao', 'a0000000-0000-4000-8000-000000015002'::uuid)
          and pg_temp.recebeu('silenciada', 'espera_gestao', 'a0000000-0000-4000-8000-000000015004'::uuid),
          'quem silenciou fica de fora do aviso da gestão; os outros recebem');
select is(pg_temp.avisos('teste', 'espera') + pg_temp.avisos('teste', 'espera_gestao'), 0::bigint,
          'a conversa de teste da IA não avisa');
select is(pg_temp.avisos('bloqueada', 'espera') + pg_temp.avisos('suprimida', 'espera'), 0::bigint,
          'a conversa bloqueada e a do número suprimido não avisam');
select is(pg_temp.avisos('concluida', 'espera'), 0::bigint, 'a conversa concluída não avisa');

-- O cliente volta a escrever às 10h30: o gatilho de verdade traz a conversa de volta.
insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
values (pg_temp.id('concluida'), 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
        'Oi de novo, ainda está disponível?', 'system', 'crm', '2026-11-09 10:30-03');
select ok((select arquivada_em is null from public.conversations where id = pg_temp.id('concluida')),
          'o cliente escreveu de novo: a conversa concluída volta para a lista');
select app.avisos_push_varrer_espera('2026-11-09 10:44-03');
select is(pg_temp.avisos('concluida', 'espera'), 0::bigint,
          'a espera conta da volta, não do "ok, obrigado" de antes de concluir');
select app.avisos_push_varrer_espera('2026-11-09 10:45-03');
select ok(pg_temp.recebeu('concluida', 'espera', 'a0000000-0000-4000-8000-000000015001'::uuid),
          'aos 15 min da volta, o aviso sai');

-- ---------------------------------------------------------------------
-- 6. O degrau desligado
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000015002'::uuid, 'gestor');
select public.avisos_definir('espera_gestao', false);
select is((select ligado from public.avisos_meus() where tipo = 'espera_gestao'), false,
          'a tela "Avisos no celular" mostra o degrau da gestão desligado');
select pg_temp.sair();
select app.avisos_push_enviar();
select ok(not exists (select 1 from app.push_fila
                       where pessoa_id = 'a0000000-0000-4000-8000-000000015002'::uuid
                         and tipo = 'espera_gestao' and resultado <> 'desligado'),
          'o aviso da gestão desligado pela pessoa não sai no celular');
select ok(not exists (select 1 from app.esperas_da_pessoa('a0000000-0000-4000-8000-000000015002'::uuid,
                                                          '2026-11-09 11:00-03')
                       where degrau = 'espera_gestao'),
          'nem no computador');

-- ---------------------------------------------------------------------
-- 7. O computador: a mesma regra, para quem pergunta
-- ---------------------------------------------------------------------
select ok(exists (select 1 from app.esperas_da_pessoa('a0000000-0000-4000-8000-000000015001'::uuid,
                                                      '2026-11-09 11:00-03') e
                   where e.conversa_id = pg_temp.id('maria') and e.degrau = 'espera'
                     and e.nome = 'Maria Souza' and e.desde = '2026-11-09 10:00-03'
                     and e.minutos = 60),
          'o responsável vê a espera da Maria no degrau de 15 min, com o nome, o começo e os minutos');
select is((select e.responsavel
             from app.esperas_da_pessoa('a0000000-0000-4000-8000-000000015004'::uuid, '2026-11-09 11:00-03') e
            where e.conversa_id = pg_temp.id('maria') and e.degrau = 'espera_gestao'),
          'João', 'a admin vê a mesma espera no degrau da gestão, com o responsável');
select ok(exists (select 1 from app.esperas_da_pessoa('a0000000-0000-4000-8000-000000015003'::uuid,
                                                      '2026-11-09 11:00-03') e
                   where e.conversa_id = pg_temp.id('maria') and e.degrau = 'espera')
          and not exists (select 1 from app.esperas_da_pessoa('a0000000-0000-4000-8000-000000015003'::uuid,
                                                          '2026-11-09 11:00-03') e
                           where e.degrau = 'espera_gestao' or e.conversa_id = pg_temp.id('atendida'))
          and exists (select 1 from app.esperas_da_pessoa('a0000000-0000-4000-8000-000000015001'::uuid,
                                                      '2026-11-09 11:00-03') e
                       where e.conversa_id = pg_temp.id('atendida') and e.degrau = 'espera'),
          'no computador, a mesma divisão: o SDR vê a Maria (sem resposta) e não a do Pedro, que é só do João, e nunca o degrau da gestão');
select ok(not exists (select 1 from app.esperas_da_pessoa('a0000000-0000-4000-8000-000000015001'::uuid,
                                                          '2026-11-09 11:00-03') e
                       where e.conversa_id in (pg_temp.id('silenciada'), pg_temp.id('teste'),
                                               pg_temp.id('respondida'), pg_temp.id('reacao'))),
          'no computador também ficam de fora a silenciada, a de teste e as respondidas');
create temp table t150_site (conversa_id uuid, degrau text, desde timestamptz);
grant insert, select on t150_site to authenticated;
select pg_temp.entrar('a0000000-0000-4000-8000-000000015001'::uuid, 'gestor');
insert into t150_site select conversa_id, degrau, desde from public.esperas_para_avisar();
select pg_temp.sair();
select results_eq(
  $$select conversa_id, degrau, desde from t150_site order by 1, 2$$,
  $$select conversa_id, degrau, desde
      from app.esperas_da_pessoa('a0000000-0000-4000-8000-000000015001'::uuid, now()) order by 1, 2$$,
  'o site recebe, para quem está logado, exatamente o que a regra do banco manda');
select is((select count(*) from public.esperas_para_avisar()), 0::bigint,
          'sem sessão, nada');

-- ---------------------------------------------------------------------
-- 8. A KOMUNE fica sem nada novo; o catálogo e a rodada da Imova
-- ---------------------------------------------------------------------
select pg_temp.virar('komune');
select ok(not exists (select 1 from app.avisos_catalogo() where tipo in ('espera', 'espera_gestao')),
          'o catálogo da KOMUNE não tem os avisos da espera');
create temp table t150_antes as select count(*) as n from app.push_fila where tipo like 'espera%';
select is((app.avisos_push_rodar() ->> 'ligado'), 'true', 'na KOMUNE a rodada continua rodando');
select is((select count(*) from app.push_fila where tipo like 'espera%'), (select n from t150_antes),
          'na KOMUNE a rodada não olha a espera');
select pg_temp.virar('imova');
select results_eq(
  $$select tipo, ordem from app.avisos_catalogo() where tipo in ('espera', 'espera_gestao') order by ordem$$,
  $$values ('espera', 13), ('espera_gestao', 14)$$,
  'o catálogo da Imova ganha "Cliente esperando resposta" (13) e "Cliente esperando há 1 hora" (14)');
select is((select count(*) from app.avisos_catalogo()), 11::bigint,
          'a Imova tem os 6 comuns, ligando, ligação perdida, lead novo e os dois da espera');
select lives_ok($$select app.avisos_push_rodar()$$, 'na Imova a rodada chama a varredura da espera sem erro');
select ok(exists (select 1 from pg_constraint
                   where conname = 'push_fila_tipo_check'
                     and pg_get_constraintdef(oid) like '%espera_gestao%'),
          'a fila aceita os dois tipos novos');

-- ---------------------------------------------------------------------
-- 9. Os privilégios, e o WhatsApp não é tocado
-- ---------------------------------------------------------------------
create temp table t150_base as
  select (select count(*) from public.messages) as mensagens,
         (select count(*) from pgmq.q_wa_outbound) as fila,
         (select max(updated_at) from public.conversations) as conversas;
select app.avisos_push_varrer_espera('2026-11-09 10:15-03');
select app.avisos_push_varrer_espera('2026-11-09 11:00-03');
select public.esperas_para_avisar();
select ok((select count(*) from public.messages) = (select mensagens from t150_base)
          and (select count(*) from pgmq.q_wa_outbound) = (select fila from t150_base)
          and (select max(updated_at) from public.conversations) = (select conversas from t150_base),
          'a espera só lê: nenhuma mensagem, nada na fila do WhatsApp, nenhuma conversa mexida');
select ok(not has_function_privilege('authenticated', 'app.avisos_push_varrer_espera(timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.avisos_push_varrer_espera(timestamptz)', 'execute'),
          'a varredura da espera não é executável por quem está logado nem por anônimo');
select ok(not has_function_privilege('authenticated', 'app.primeira_resposta_config()', 'execute')
          and not has_function_privilege('anon', 'app.primeira_resposta_config()', 'execute')
          and not has_function_privilege('authenticated', 'app.minutos_no_expediente(timestamptz, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.minutos_no_expediente(timestamptz, timestamptz)', 'execute'),
          'a configuração e o relógio do expediente não são executáveis de fora');
select ok(not has_function_privilege('authenticated', 'app.esperas_de_resposta(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'app.esperas_da_pessoa(uuid, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.esperas_da_pessoa(uuid, timestamptz)', 'execute'),
          'as esperas de todos e de outra pessoa não são executáveis de fora');
select ok(has_function_privilege('authenticated', 'public.esperas_para_avisar()', 'execute')
          and not has_function_privilege('anon', 'public.esperas_para_avisar()', 'execute'),
          'o site logado pergunta as próprias esperas; anônimo não');

\else
-- O banco da KOMUNE de verdade: a parte da Imova não foi criada.
select plan(6);

select ok(to_regprocedure('app.primeira_resposta_config()') is null
          and to_regprocedure('app.minutos_no_expediente(timestamptz, timestamptz)') is null
          and to_regprocedure('app.esperas_de_resposta(timestamptz)') is null
          and to_regprocedure('app.esperas_da_pessoa(uuid, timestamptz)') is null
          and to_regprocedure('app.avisos_push_varrer_espera(timestamptz)') is null
          and to_regprocedure('public.esperas_para_avisar()') is null,
          'na KOMUNE as funções da espera não existem');
select ok(not exists (select 1 from public.app_settings where key = 'primeira_resposta'),
          'na KOMUNE a chave primeira_resposta não foi criada');
select ok(not exists (select 1 from app.avisos_catalogo() where tipo in ('espera', 'espera_gestao')),
          'o catálogo da KOMUNE não tem os avisos da espera');
create temp table t150_antes as select count(*) as n from app.push_fila where tipo like 'espera%';
select is((app.avisos_push_rodar() ->> 'ligado'), 'true', 'a rodada da KOMUNE continua rodando');
select is((select count(*) from app.push_fila where tipo like 'espera%'), (select n from t150_antes),
          'a rodada da KOMUNE não põe aviso de espera');
select ok(exists (select 1 from pg_constraint
                   where conname = 'push_fila_tipo_check'
                     and pg_get_constraintdef(oid) like '%lead_portal%'),
          'a fila continua aceitando os tipos de antes');
\endif

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — O aviso da visita: Aceitar, Agendar e Não é possível
-- (migração 20261125180000, Imova)
--
-- Prova:
--   1. a porta da IA guarda a hora que o cliente pediu ("sábado às 10h"), tira
--      dela o período, e descarta hora sem dia ou fora de 6h–22h; a chamada
--      antiga (sem a hora) continua valendo;
--   2. a lista dos admins traz o título do imóvel, a cidade, a hora e o dia
--      pedido com a hora;
--   3. aceitar num sábado ou num horário ocupado: a Agenda recusa, nada vale e
--      nada sai ao cliente;
--   4. agendar fora do pedido (outro_dia): "Nesse horário" no mesmo dia, o
--      horário fica reservado como "Visita a confirmar" e a proposta aparece
--      na lista do que espera o cliente;
--   5. o cliente confirma: a reserva vira "Visita:" e ele recebe a confirmação;
--      o cliente não pode: a reserva sai da Agenda e nada sai;
--   6. só admin vê o que espera o cliente e marca a resposta.
--
-- Só na Imova. Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'pgTAP 205 é da Imova: rode no banco local da Imova';
  end if;
end $$;

select plan(34);

insert into public.allowed_users (email, role, note) values
  ('a205@teste.local', 'admin', 'pgTAP 205'),
  ('b205@teste.local', 'admin', 'pgTAP 205'),
  ('g205@teste.local', 'gestor', 'pgTAP 205');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000020501'::uuid, 'a205@teste.local', '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000020502'::uuid, 'b205@teste.local', '{"full_name":"Beto Admin"}'),
  ('a0000000-0000-4000-8000-000000020503'::uuid, 'g205@teste.local', '{"full_name":"Gil Gestor"}');

create function pg_temp.ana() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020501'::uuid $$;
create function pg_temp.beto() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020502'::uuid $$;
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020503'::uuid $$;
create function pg_temp.entrar(p_id uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999920500"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

create temp table t205(chave text primary key, valor uuid);
grant select on t205 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t205 where chave = p_chave
$$;

-- Os dias: um dia útil daqui a 2 (e o seguinte) e o próximo sábado.
create function pg_temp.util(p_n int) returns date language sql stable as $$
  select app.next_business_day((now() at time zone 'America/Fortaleza')::date, p_n)
$$;
create function pg_temp.sabado() returns date language sql stable as $$
  select d::date from generate_series((now() at time zone 'America/Fortaleza')::date + 1,
                                      (now() at time zone 'America/Fortaleza')::date + 7, interval '1 day') d
   where extract(isodow from d) = 6
$$;
create function pg_temp.em(p_dia date, p_hora time) returns timestamptz language sql stable as $$
  select (p_dia + p_hora) at time zone 'America/Fortaleza'
$$;

-- A casa de teste em Ponta Negra.
insert into public.anuncios (codigo, titulo, tipo, bairro, cidade, estado, endereco)
values ('PGT205', 'Casa com piscina', 'casa', 'Ponta Negra', 'Natal', 'RN', 'Rua das Dunas');
insert into t205 select 'anuncio', id from public.anuncios where codigo = 'PGT205';

create function pg_temp.cliente(p_chave text, p_nome text, p_tel text) returns void language plpgsql as $$
declare
  v_org  uuid := gen_random_uuid();
  v_conv uuid;
  v_msg  uuid;
begin
  insert into public.organizations (id, name, phone_e164, source_id, owner_id)
  values (v_org, p_nome, p_tel, (select id from public.sources where slug = 'captura_campo'), pg_temp.ana());
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, organization_id,
                                    assignee_id, status, last_inbound_at)
  values ('whatsapp'::app.channel, '+5584999920500', p_tel, p_nome, v_org, pg_temp.ana(), 'aguardando_nos', now())
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'Pode ser às 10h?', 'system', 'crm', now() - interval '1 minute')
  returning id into v_msg;
  insert into t205 values ('org_' || p_chave, v_org), ('conversa_' || p_chave, v_conv), ('msg_' || p_chave, v_msg);
end $$;
select pg_temp.cliente('marcos', 'Marcos Teixeira', '+5584988820501');
select pg_temp.cliente('lia', 'Lia Campos', '+5584988820502');
select pg_temp.cliente('davi', 'Davi Nunes', '+5584988820503');
select pg_temp.cliente('olga', 'Olga Prado', '+5584988820504');

create function pg_temp.pedir(p_chave text, p_data date, p_periodo text, p_disse text, p_hora time) returns jsonb
language sql as $$
  select public.ia_atendente_pedir_visita(pg_temp.id('conversa_' || p_chave), pg_temp.id('msg_' || p_chave),
                                          'pgt205', p_data, p_periodo, p_disse, 7, 'atendente-imova@v9', p_hora)
$$;
create function pg_temp.pedido(p_chave text) returns public.visita_pedidos language sql stable as $$
  select * from public.visita_pedidos
   where conversation_id = pg_temp.id('conversa_' || p_chave) and situacao <> 'substituida'
   order by criado_em desc, id limit 1
$$;

-- ---------------------------------------------------------------------
-- 1. A hora pedida
-- ---------------------------------------------------------------------
select is(pg_temp.pedir('marcos', pg_temp.util(2), null, 'às 10h', '10:00') ->> 'hora', '10:00',
          'a IA grava a hora que o cliente pediu');
select is((select row(p.hora, p.periodo)::text from pg_temp.pedido('marcos') p),
          row('10:00'::time, 'manha')::text, 'o período sai da hora');
select is(pg_temp.pedir('lia', null, null, 'às 15h', '15:00') ->> 'hora', null,
          'hora sem dia não diz nada: fica nula');
select is(pg_temp.pedir('lia', pg_temp.util(2), 'tarde', 'às 3h', '03:00') ->> 'hora', null,
          'hora fora do horário de visita também');
select is((select p.periodo from pg_temp.pedido('lia') p), 'tarde', 'e o período que a IA disse fica');
select is(public.ia_atendente_pedir_visita(pg_temp.id('conversa_davi'), pg_temp.id('msg_davi'), 'PGT205',
                                           pg_temp.util(3), 'manha', 'quinta de manhã', 7, 'atendente-imova@v9') ->> 'ok',
          'true', 'a chamada antiga, sem a hora, continua valendo');
select is(pg_temp.pedir('olga', pg_temp.sabado(), null, 'sábado às 10h', '10:00') ->> 'ok', 'true',
          'o pedido para sábado entra');

insert into t205 select 'p_marcos', (pg_temp.pedido('marcos')).id;
insert into t205 select 'p_lia', (pg_temp.pedido('lia')).id;
insert into t205 select 'p_davi', (pg_temp.pedido('davi')).id;
insert into t205 select 'p_olga', (pg_temp.pedido('olga')).id;

-- ---------------------------------------------------------------------
-- 2. A lista dos admins
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.ana(), 'admin');
create temp table l205 as
  select x from jsonb_array_elements(public.visita_pedidos_abertos()) x
   where (x ->> 'id')::uuid = pg_temp.id('p_olga');
select is((select x ->> 'titulo' from l205), 'Casa em Ponta Negra', 'o título do imóvel, sem artigo e sem código');
select is((select x ->> 'lugar' from l205), 'Natal/RN', 'a cidade');
select is((select x ->> 'hora' from l205), '10:00', 'a hora pedida');
select matches((select x ->> 'dia_pedido' from l205), '^sábado, \d{2}/\d{2}, às 10h$',
               'o dia pedido por extenso, com a hora');
select is((select x ->> 'imovel_codigo' from l205), 'PGT205', 'e o código, para o admin');

-- ---------------------------------------------------------------------
-- 3. A Agenda recusa: nada vale
-- ---------------------------------------------------------------------
create temp table r205a as
  select public.visita_pedido_decidir(pg_temp.id('p_olga'), 'aprovada', pg_temp.em(pg_temp.sabado(), '10:00')) as r;
select is((select r ->> 'motivo' from r205a), 'agenda_recusou', 'sábado não entra na Agenda');
select is((select r -> 'agenda' ->> 'motivo' from r205a), 'dia_nao_util', 'e a resposta diz por quê');
select is((pg_temp.pedido('olga')).situacao, 'pendente', 'o pedido continua esperando');
select is((select count(*)::int from public.messages
            where conversation_id = pg_temp.id('conversa_olga') and direction = 'out'::app.msg_direction), 0,
          'nada sai ao cliente');

select is(public.visita_pedido_decidir(pg_temp.id('p_marcos'), 'aprovada', pg_temp.em(pg_temp.util(2), '10:00')) ->> 'na_agenda',
          'true', 'a Ana aceita o Marcos às 10h');
create temp table r205b as
  select public.visita_pedido_decidir(pg_temp.id('p_lia'), 'aprovada', pg_temp.em(pg_temp.util(2), '10:00')) as r;
select is((select r -> 'agenda' ->> 'motivo' from r205b), 'horario_ocupado',
          'no mesmo horário da Ana, a Agenda recusa a Lia');
select is((pg_temp.pedido('lia')).situacao, 'pendente', 'e o pedido da Lia continua esperando');

-- ---------------------------------------------------------------------
-- 4. Agendar fora do pedido: a proposta reserva o horário
-- ---------------------------------------------------------------------
create temp table r205c as
  select public.visita_pedido_decidir(pg_temp.id('p_lia'), 'outro_dia', pg_temp.em(pg_temp.util(2), '11:30')) as r;
select is((select r ->> 'mensagem_saiu' from r205c), 'true', 'a proposta sai');
select matches((select r ->> 'mensagem' from r205c),
               '^Nesse horário não vamos conseguir\. Pode ser [a-zç-]+, \d{2}/\d{2}, às 11h30\?$',
               'no mesmo dia, "Nesse horário"');
select is((select row(t.title, t.status::text, t.kind::text)::text from public.tasks t
            where t.id = (select (r ->> 'task_id')::uuid from r205c)),
          row('Visita a confirmar: Lia Campos', 'todo', 'visit')::text,
          'o horário fica reservado na Agenda como "Visita a confirmar"');
select is((select count(*)::int from jsonb_array_elements(public.visita_pedidos_aguardando()) x
            where (x ->> 'id')::uuid = pg_temp.id('p_lia')), 1, 'a proposta aparece no que espera o cliente');
select matches((select x ->> 'quando' from jsonb_array_elements(public.visita_pedidos_aguardando()) x
                 where (x ->> 'id')::uuid = pg_temp.id('p_lia')),
               '^[a-zç-]+, \d{2}/\d{2}, às 11h30$', 'com o dia e a hora propostos');
select is(public.visita_pedido_decidir(pg_temp.id('p_davi'), 'outro_dia', pg_temp.em(pg_temp.util(4), '15:00')) ->> 'na_agenda',
          'true', 'a proposta ao Davi também reserva');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 6. Só admin
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(jsonb_array_length(public.visita_pedidos_aguardando()), 0, 'o gestor não vê o que espera o cliente');
select is(public.visita_pedido_cliente_respondeu(pg_temp.id('p_lia'), true) ->> 'motivo', 'sem_permissao',
          'nem marca a resposta');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 5. A resposta do cliente
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.beto(), 'admin');
create temp table r205d as select public.visita_pedido_cliente_respondeu(pg_temp.id('p_lia'), true) as r;
select is((select r ->> 'mensagem_saiu' from r205d), 'true', 'a Lia confirmou: a confirmação sai');
select matches((select r ->> 'mensagem' from r205d),
               '^Combinado! Sua visita à casa em Ponta Negra ficou para [a-zç-]+, \d{2}/\d{2}, às 11h30\.',
               'com o horário proposto');
select is((select t.title from public.tasks t where t.id = (pg_temp.pedido('lia')).task_id),
          'Visita: Lia Campos', 'a reserva vira a visita');
select is(public.visita_pedido_cliente_respondeu(pg_temp.id('p_lia'), false) ->> 'motivo', 'ja_respondido',
          'a resposta vale uma vez');

select is(public.visita_pedido_cliente_respondeu(pg_temp.id('p_davi'), false) ->> 'ok', 'true',
          'o Davi não pode');
select is((select t.status::text from public.tasks t
            where t.title = 'Visita a confirmar: Davi Nunes'), 'cancelled', 'a reserva sai da Agenda');
select is(jsonb_array_length(public.visita_pedidos_aguardando()), 0, 'e nada mais espera o cliente');
select pg_temp.sair();

select * from finish();
rollback;

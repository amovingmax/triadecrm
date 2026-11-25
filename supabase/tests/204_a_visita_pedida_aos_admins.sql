-- =====================================================================
-- pgTAP — A visita presencial vira um pedido que os admins aprovam
-- (migração 20261124190000, Imova)
--
-- Prova:
--   1. a porta da IA grava o pedido (imóvel pelo código, dia, período, como o
--      cliente disse); o novo substitui o aberto; dia no passado vira nulo;
--   2. só admin vê os pedidos (função e tabela);
--   3. aprovar: a visita entra na Agenda com o imóvel, dono = quem aprovou, e
--      o cliente recebe "Combinado! Sua visita ao terreno em ... ficou para
--      ..." em nome de quem aprovou; o primeiro admin vale;
--   4. outro dia: o cliente recebe a proposta; recusar: nada sai;
--   5. o aviso "Pedido de visita" vai a cada admin ativo, uma vez, e não ao
--      gestor; o catálogo tem o tipo novo.
--
-- Só na Imova. Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'pgTAP 204 é da Imova: rode no banco local da Imova';
  end if;
end $$;

select plan(30);

insert into public.allowed_users (email, role, note) values
  ('a204@teste.local', 'admin', 'pgTAP 204'),
  ('b204@teste.local', 'admin', 'pgTAP 204'),
  ('g204@teste.local', 'gestor', 'pgTAP 204');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000020401'::uuid, 'a204@teste.local', '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000020402'::uuid, 'b204@teste.local', '{"full_name":"Beto Admin"}'),
  ('a0000000-0000-4000-8000-000000020403'::uuid, 'g204@teste.local', '{"full_name":"Gil Gestor"}');

create function pg_temp.ana() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020401'::uuid $$;
create function pg_temp.beto() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020402'::uuid $$;
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020403'::uuid $$;
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

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999920400"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

create temp table t204(chave text primary key, valor uuid);
grant select on t204 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t204 where chave = p_chave
$$;

-- O terreno de teste em Tabatinga.
insert into public.anuncios (codigo, titulo, tipo, bairro, cidade, endereco)
values ('PGT204', 'Terreno de frente para o mar', 'terreno', 'Tabatinga', 'Nísia Floresta', 'Rua Barra de Tabatinga');
insert into t204 select 'anuncio', id from public.anuncios where codigo = 'PGT204';

-- Três clientes, cada um com a ficha, a conversa e a mensagem de agora.
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
  values ('whatsapp'::app.channel, '+5584999920400', p_tel, p_nome, v_org, pg_temp.ana(), 'aguardando_nos', now())
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'Pode ser quinta de manhã.', 'system', 'crm', now() - interval '1 minute')
  returning id into v_msg;
  insert into t204 values ('org_' || p_chave, v_org), ('conversa_' || p_chave, v_conv), ('msg_' || p_chave, v_msg);
end $$;
select pg_temp.cliente('silvia', 'Sílvia Rocha', '+5584988820401');
select pg_temp.cliente('caio', 'Caio Prado', '+5584988820402');
select pg_temp.cliente('rita', 'Rita Lopes', '+5584988820403');

-- ---------------------------------------------------------------------
-- 1. A porta da IA
-- ---------------------------------------------------------------------
create function pg_temp.pedir(p_chave text, p_data date, p_periodo text, p_disse text) returns jsonb
language sql as $$
  select public.ia_atendente_pedir_visita(pg_temp.id('conversa_' || p_chave), pg_temp.id('msg_' || p_chave),
                                          'pgt204', p_data, p_periodo, p_disse, 7, 'atendente-imova@v9')
$$;

select is(pg_temp.pedir('silvia', current_date + 2, 'tarde', 'quinta à tarde') ->> 'ok', 'true',
          'a IA grava o pedido de visita');
select is(pg_temp.pedir('silvia', current_date + 2, 'manha', 'quinta de manhã') ->> 'ok', 'true',
          'um pedido novo na mesma conversa também entra');
select is((select count(*)::int from public.visita_pedidos
            where conversation_id = pg_temp.id('conversa_silvia') and situacao = 'pendente'), 1,
          'um pedido aberto por conversa: o novo substitui o anterior');
select is((select count(*)::int from public.visita_pedidos
            where conversation_id = pg_temp.id('conversa_silvia') and situacao = 'substituida'), 1,
          'o pedido anterior fica como substituído');
select is((select row(imovel_codigo, anuncio_id, periodo, como_disse)::text from public.visita_pedidos
            where conversation_id = pg_temp.id('conversa_silvia') and situacao = 'pendente'),
          row('PGT204', pg_temp.id('anuncio'), 'manha', 'quinta de manhã')::text,
          'o imóvel vem pelo código (sem diferença de caixa), com período e as palavras do cliente');
select is(pg_temp.pedir('caio', current_date - 3, 'noite', 'ontem') ->> 'data', null,
          'dia no passado vira nulo');
select is(public.ia_atendente_pedir_visita(gen_random_uuid(), null, 'PGT204') ->> 'motivo', 'conversa_nao_existe',
          'conversa que não existe é recusada');
select is(pg_temp.pedir('rita', current_date + 3, null, 'sábado') ->> 'ok', 'true', 'o terceiro pedido entra');

insert into t204 select 'p_silvia', id from public.visita_pedidos
 where conversation_id = pg_temp.id('conversa_silvia') and situacao = 'pendente';
insert into t204 select 'p_caio', id from public.visita_pedidos
 where conversation_id = pg_temp.id('conversa_caio') and situacao = 'pendente';
insert into t204 select 'p_rita', id from public.visita_pedidos
 where conversation_id = pg_temp.id('conversa_rita') and situacao = 'pendente';

-- ---------------------------------------------------------------------
-- 2. Só admin vê
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(jsonb_array_length(public.visita_pedidos_abertos()), 0, 'o gestor não vê os pedidos');
select is((select count(*)::int from public.visita_pedidos), 0, 'nem pela tabela');
select is(public.visita_pedido_decidir(pg_temp.id('p_silvia'), 'aprovada', now() + interval '2 days') ->> 'motivo',
          'sem_permissao', 'o gestor não decide');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.ana(), 'admin');
select is(jsonb_array_length(public.visita_pedidos_abertos()), 3, 'o admin vê os três pedidos abertos');
select is((select x ->> 'imovel' from jsonb_array_elements(public.visita_pedidos_abertos()) x
            where (x ->> 'id')::uuid = pg_temp.id('p_silvia')), 'o terreno em Tabatinga',
          'o imóvel aparece como o cliente reconhece, sem código');
select is((select x ->> 'cliente' from jsonb_array_elements(public.visita_pedidos_abertos()) x
            where (x ->> 'id')::uuid = pg_temp.id('p_silvia')), 'Sílvia Rocha', 'com o nome do cliente');

-- ---------------------------------------------------------------------
-- 3. Aprovar
-- ---------------------------------------------------------------------
select is(public.visita_pedido_decidir(pg_temp.id('p_silvia'), 'aprovada', null) ->> 'motivo', 'quando_invalido',
          'aprovar exige o dia e a hora');
select is(public.visita_pedido_decidir(pg_temp.id('p_silvia'), 'aprovada', now() - interval '1 hour') ->> 'motivo',
          'quando_invalido', 'e no futuro');
create temp table r204 as
  select public.visita_pedido_decidir(pg_temp.id('p_silvia'), 'aprovada',
                                      date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza'
                                        + interval '2 days 9 hours') as r;
select is((select r ->> 'ok' from r204), 'true', 'a Ana aprova');
select is((select r ->> 'mensagem_saiu' from r204), 'true', 'a confirmação sai');
select matches((select r ->> 'mensagem' from r204),
               '^Combinado! Sua visita ao terreno em Tabatinga ficou para [a-zç-]+, \d{2}/\d{2}, às 9h\. Qualquer coisa, é só me chamar por aqui\.$',
               'o texto da confirmação: o imóvel sem código, o dia por extenso e a hora');
select is((select row(m.author_kind::text, m.sent_by, m.status::text, m.direction::text)::text
             from public.messages m
            where m.conversation_id = pg_temp.id('conversa_silvia') and m.direction = 'out'::app.msg_direction),
          row('human', pg_temp.ana(), 'queued', 'out')::text,
          'em nome de quem aprovou, na fila, pela porteira de sempre');
select is((select r ->> 'na_agenda' from r204), 'true', 'a visita entra na Agenda');
select is((select row(t.kind::text, t.assignee_id, v.anuncio_id)::text
             from public.tasks t join public.visita_imoveis v on v.task_id = t.id
            where t.id = (select (r ->> 'task_id')::uuid from r204)),
          row('visit', pg_temp.ana(), pg_temp.id('anuncio'))::text,
          'como visita, de quem aprovou, com o imóvel');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.beto(), 'admin');
select is(public.visita_pedido_decidir(pg_temp.id('p_silvia'), 'recusada') ->> 'motivo', 'ja_decidido',
          'o primeiro admin vale: o Beto não decide de novo');
select is(jsonb_array_length(public.visita_pedidos_abertos()), 2, 'o pedido aprovado some da lista');

-- ---------------------------------------------------------------------
-- 4. Outro dia e recusar
-- ---------------------------------------------------------------------
select is(public.visita_pedido_decidir(pg_temp.id('p_caio'), 'outro_dia', now() + interval '3 days') ->> 'mensagem_saiu',
          'true', 'outro dia: a proposta sai');
select matches((select body from public.messages
                 where conversation_id = pg_temp.id('conversa_caio') and direction = 'out'::app.msg_direction),
               'Nesse dia não vamos conseguir\. Pode ser [a-záéíóúâêôãõç-]+, \d{2}/\d{2}, às \d{1,2}h(\d{2})?\?$',
               'com o dia e a hora propostos');
select is((select r ->> 'mensagem_saiu' from (select public.visita_pedido_decidir(pg_temp.id('p_rita'), 'recusada', null, 'sem horário') as r) x),
          'false', 'recusar não manda nada ao cliente');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 5. O aviso no celular
-- ---------------------------------------------------------------------
update public.visita_pedidos set situacao = 'pendente', decidido_em = null, decidido_por = null
 where id = pg_temp.id('p_rita');
select app.avisos_push_varrer_visitas();
select is((select count(*)::int from app.push_fila
            where tipo = 'visita_pedida' and chave like 'visita_pedida:' || pg_temp.id('p_rita') || ':%'
              and pessoa_id in (pg_temp.ana(), pg_temp.beto())), 2,
          'cada admin recebe o aviso do pedido aberto');
select is((select count(*)::int from app.push_fila where tipo = 'visita_pedida' and pessoa_id = pg_temp.gil()), 0,
          'o gestor não');
select is(app.avisos_push_varrer_visitas(), 0, 'a rodada seguinte não repete o aviso');

select * from finish();
rollback;

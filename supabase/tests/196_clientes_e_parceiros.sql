-- =====================================================================
-- pgTAP — Clientes e Parceiros nas Conversas da Imova (migração 20261123120000;
-- as três tags, 20261123200000: comprador virou colaborador e o botão de
-- Prospectados põe a marca com tag, por `parceiros_marcar`)
--
-- Prova:
--   1. o gestor e o SDR mudam o perfil para Parceiro, com tipo e imóvel;
--   2. tipo, imóvel e ficha errados são recusados sem gravar nada;
--   3. corrigir o tipo mantém "desde" e "por" da primeira vez;
--   4. voltar para Clientes tira a marca, e de novo não faz nada;
--   5. tudo vai para o audit_log;
--   6. a IA que atende fica quieta com Parceiro e volta com Cliente, e a
--      tela sabe por quê (`ia_conversa_estado`);
--   7. a marca do botão de Prospectados (com tag) também cala a IA;
--   8. sem login, a função recusa.
--
-- Só na Imova. Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'pgTAP 196 é da Imova: rode no banco local da Imova';
  end if;
end $$;

select plan(30);

insert into public.allowed_users (email, role, note) values
  ('g196@teste.local', 'gestor', 'pgTAP 196'), ('s196@teste.local', 'sdr', 'pgTAP 196');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000019601'::uuid, 'g196@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000019602'::uuid, 's196@teste.local', '{"full_name":"Sara Sdr"}');

create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000019601'::uuid $$;
create function pg_temp.sara() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000019602'::uuid $$;
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

-- Sem automações em volta: o que se mede é o perfil e a IA.
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
delete from public.app_settings where key = 'ia.atendente';
insert into public.app_settings (key, value, description)
values ('ia.atendente',
        '{"ligada": true, "modo": "clientes", "espera_seg": 15, "teto_por_hora": 20,
          "conversas_de_teste": []}'::jsonb,
        'pgTAP 196');

create temp table t196(chave text primary key, valor uuid);
-- As funções são chamadas também dentro do papel `authenticated`.
grant select on t196 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t196 where chave = p_chave
$$;

insert into public.organizations (id, name, phone_e164, source_id, owner_id)
select x.id, x.nome, x.tel, (select id from public.sources where slug = 'captura_campo'), pg_temp.gil()
  from (values ('c0000000-0000-4000-8000-000000019601'::uuid, 'Ana Inquilina', '+5584988819601'),
               ('c0000000-0000-4000-8000-000000019602'::uuid, 'Beto Colaborador', '+5584988819602'),
               ('c0000000-0000-4000-8000-000000019603'::uuid, 'Caio Prospectados', '+5584988819603')) x(id, nome, tel);
insert into t196 values
  ('ana', 'c0000000-0000-4000-8000-000000019601'), ('beto', 'c0000000-0000-4000-8000-000000019602'),
  ('caio', 'c0000000-0000-4000-8000-000000019603');

insert into public.anuncios (codigo, titulo) values ('PGT196', 'Apto de teste em Ponta Negra');
insert into t196 select 'anuncio', id from public.anuncios where codigo = 'PGT196';
insert into public.anuncios (codigo, titulo, excluido_em) values ('PGT196X', 'Excluído', now());
insert into t196 select 'excluido', id from public.anuncios where codigo = 'PGT196X';

-- A conversa da Ana, com mensagem dela esperando resposta.
insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, organization_id,
                                  assignee_id, status, last_inbound_at)
values ('whatsapp'::app.channel, '+5584999919600', '+5584988819601', 'Ana', pg_temp.id('ana'),
        pg_temp.gil(), 'aguardando_nos', now());
insert into t196 select 'conversa_ana', id from public.conversations where peer_phone_e164 = '+5584988819601';
insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
values (pg_temp.id('conversa_ana'), 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
        'O chuveiro queimou, podem mandar alguém?', 'system', 'crm', now() - interval '1 minute');
-- A conversa do Caio, para a marca do botão de Prospectados.
insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, organization_id,
                                  assignee_id, status, last_inbound_at)
values ('whatsapp'::app.channel, '+5584999919600', '+5584988819603', 'Caio', pg_temp.id('caio'),
        pg_temp.gil(), 'aguardando_nos', now());
insert into t196 select 'conversa_caio', id from public.conversations where peer_phone_e164 = '+5584988819603';
insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
values (pg_temp.id('conversa_caio'), 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
        'Bom dia, tem terreno em Pipa?', 'system', 'crm', now() - interval '1 minute');

-- ---------------------------------------------------------------------
-- 6 (antes). Como Cliente, a IA atende
-- ---------------------------------------------------------------------
select is(app.ia_atende(pg_temp.id('conversa_ana')), true,
          'Cliente com mensagem esperando: a IA atende');

-- ---------------------------------------------------------------------
-- 1. Virar Parceiro, pelo gestor e pelo SDR
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is((public.parceiro_mudar(pg_temp.id('ana'), true, 'inquilino', pg_temp.id('anuncio')) ->> 'perfil'),
          'parceiro', 'o gestor muda a Ana para Parceiro');
select is((public.ia_conversa_estado(pg_temp.id('conversa_ana')) ->> 'parceiro')::boolean, true,
          'a tela sabe que a conversa é de Parceiro');
select is((public.ia_conversa_estado(pg_temp.id('conversa_ana')) ->> 'atende')::boolean, false,
          'e que a IA não atende');
select ok((public.ia_conversa_estado(pg_temp.id('conversa_ana')) ->> 'motivo') like 'É Parceiro%',
          'com o motivo dito em português');
select pg_temp.sair();

select is((select tipo from public.consultoria where organization_id = pg_temp.id('ana')), 'inquilino',
          'a marca guarda o tipo');
select is((select anuncio_id from public.consultoria where organization_id = pg_temp.id('ana')),
          pg_temp.id('anuncio'), 'e o imóvel');
select is((select por from public.consultoria where organization_id = pg_temp.id('ana')), pg_temp.gil(),
          'e quem mudou');
select is(app.ia_atende(pg_temp.id('conversa_ana')), false,
          'Parceiro: a IA que atende fica quieta');

select pg_temp.entrar(pg_temp.sara(), 'sdr');
select is((public.parceiro_mudar(pg_temp.id('beto'), true, 'colaborador', null) ->> 'ok')::boolean, true,
          'o SDR também muda o perfil (quem atende muda)');
select pg_temp.sair();
select is((select tipo from public.consultoria where organization_id = pg_temp.id('beto')), 'colaborador',
          'o Beto virou Parceiro colaborador, sem imóvel');
select ok((select anuncio_id is null from public.consultoria where organization_id = pg_temp.id('beto')),
          'o imóvel é opcional');

-- ---------------------------------------------------------------------
-- 2. Recusas
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(public.parceiro_mudar(pg_temp.id('caio'), true, 'socio', null) ->> 'motivo', 'tipo_invalido',
          'tipo fora da lista é recusado');
select is(public.parceiro_mudar(pg_temp.id('caio'), true, 'inquilino', gen_random_uuid()) ->> 'motivo',
          'anuncio_invalido', 'anúncio que não existe é recusado');
select is(public.parceiro_mudar(pg_temp.id('caio'), true, 'inquilino', pg_temp.id('excluido')) ->> 'motivo',
          'anuncio_invalido', 'anúncio excluído é recusado');
select is(public.parceiro_mudar(gen_random_uuid(), true, 'inquilino', null) ->> 'motivo',
          'ficha_inexistente', 'ficha que não existe é recusada');
select pg_temp.sair();
select is((select count(*)::int from public.consultoria where organization_id = pg_temp.id('caio')), 0,
          'nenhuma recusa gravou marca');

-- ---------------------------------------------------------------------
-- 3. Corrigir o tipo
-- ---------------------------------------------------------------------
update public.consultoria set desde = now() - interval '10 days' where organization_id = pg_temp.id('ana');
select pg_temp.entrar(pg_temp.sara(), 'sdr');
select is((public.parceiro_mudar(pg_temp.id('ana'), true, 'proprietario', null) ->> 'era_parceiro')::boolean,
          true, 'corrigir quem já é Parceiro');
select pg_temp.sair();
select is((select tipo from public.consultoria where organization_id = pg_temp.id('ana')), 'proprietario',
          'o tipo foi corrigido');
select ok((select desde < now() - interval '9 days' from public.consultoria
            where organization_id = pg_temp.id('ana')), '"desde" continua o da primeira vez');
select is((select por from public.consultoria where organization_id = pg_temp.id('ana')), pg_temp.gil(),
          '"por" continua quem mudou primeiro');

-- ---------------------------------------------------------------------
-- 4. Voltar para Clientes
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is((public.parceiro_mudar(pg_temp.id('ana'), false) ->> 'perfil'), 'cliente',
          'a Ana volta para Clientes');
select is((public.parceiro_mudar(pg_temp.id('ana'), false) ->> 'mudou')::boolean, false,
          'de novo não faz nada');
select pg_temp.sair();
select is((select count(*)::int from public.consultoria where organization_id = pg_temp.id('ana')), 0,
          'a marca saiu');
select is(app.ia_atende(pg_temp.id('conversa_ana')), true,
          'Cliente de novo: a IA volta a atender');

-- ---------------------------------------------------------------------
-- 5. O registro
-- ---------------------------------------------------------------------
select is((select string_agg(action, ',' order by id) from public.audit_log
            where table_name = 'consultoria' and row_id = pg_temp.id('ana')::text),
          'VIROU_PARCEIRO,PARCERIA_CORRIGIDA,VOLTOU_PARA_CLIENTES',
          'cada mudança da Ana ficou no audit_log, na ordem');
select is((select actor_id from public.audit_log
            where table_name = 'consultoria' and row_id = pg_temp.id('ana')::text
              and action = 'PARCERIA_CORRIGIDA'), pg_temp.sara(),
          'com quem fez');

-- ---------------------------------------------------------------------
-- 7. A marca do botão de Prospectados (com tag) também cala a IA
-- ---------------------------------------------------------------------
select is(app.ia_atende(pg_temp.id('conversa_caio')), true, 'o Caio, Cliente, tem IA');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select public.parceiros_marcar(array[pg_temp.id('caio')], 'proprietario');
select pg_temp.sair();
select is(app.ia_atende(pg_temp.id('conversa_caio')), false,
          'marcado pelo botão de Prospectados: a IA fica quieta');

-- ---------------------------------------------------------------------
-- 8. Sem login
-- ---------------------------------------------------------------------
select throws_ok($$ select public.parceiro_mudar('c0000000-0000-4000-8000-000000019602'::uuid, false) $$,
                 '42501', null, 'sem login, a função recusa');

select * from finish();
rollback;

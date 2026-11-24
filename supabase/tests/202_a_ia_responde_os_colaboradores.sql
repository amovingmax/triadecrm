-- =====================================================================
-- pgTAP — A IA que atende responde os Parceiros Colaboradores
-- (migração 20261124150000, Imova)
--
-- Prova:
--   1. Parceiro com a tag Colaborador: a IA atende, e a tela o trata como
--      Cliente (`parceiro` falso, os controles da IA aparecem);
--   2. Proprietário, Inquilino e marca sem tag: a IA fica quieta, e a tela
--      diz por quê;
--   3. trocar a tag de Colaborador para Inquilino cala a IA; voltar para
--      Colaborador a traz de volta;
--   4. as outras regras continuam valendo para o Colaborador: time que
--      escreveu nas últimas 24 h e "Parar a IA" à mão.
--
-- Só na Imova. Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'pgTAP 202 é da Imova: rode no banco local da Imova';
  end if;
end $$;

select plan(16);

insert into public.allowed_users (email, role, note) values ('g202@teste.local', 'gestor', 'pgTAP 202');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000020201'::uuid, 'g202@teste.local', '{"full_name":"Gil Gestor"}');

create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020201'::uuid $$;
create function pg_temp.entrar() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.gil(), 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', 'gestor'))::text, true);
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
        'pgTAP 202');

create temp table t202(chave text primary key, valor uuid);
grant select on t202 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t202 where chave = p_chave
$$;

-- Quatro fichas, cada uma com a conversa e uma mensagem esperando resposta.
create function pg_temp.ficha(p_chave text, p_nome text, p_tel text) returns void language plpgsql as $$
declare
  v_org  uuid := gen_random_uuid();
  v_conv uuid;
begin
  insert into public.organizations (id, name, phone_e164, source_id, owner_id)
  values (v_org, p_nome, p_tel, (select id from public.sources where slug = 'captura_campo'), pg_temp.gil());
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, organization_id,
                                    assignee_id, status, last_inbound_at)
  values ('whatsapp'::app.channel, '+5584999920200', p_tel, p_nome, v_org, pg_temp.gil(), 'aguardando_nos', now())
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'Olá, boa tarde!', 'system', 'crm', now() - interval '1 minute');
  insert into t202 values (p_chave, v_org), ('conversa_' || p_chave, v_conv);
end $$;
select pg_temp.ficha('colab', 'Cleo Colaboradora', '+5584988820201');
select pg_temp.ficha('dono', 'Davi Proprietário', '+5584988820202');
select pg_temp.ficha('inq', 'Iara Inquilina', '+5584988820203');
select pg_temp.ficha('semtag', 'Saulo Sem Tag', '+5584988820204');

select pg_temp.entrar();
select public.parceiro_mudar(pg_temp.id('colab'), true, 'colaborador', null);
select public.parceiro_mudar(pg_temp.id('dono'), true, 'proprietario', null);
select public.parceiro_mudar(pg_temp.id('inq'), true, 'inquilino', null);
select pg_temp.sair();
-- A marca de antes das três tags, sem tipo (a função de hoje não deixa pôr assim).
insert into public.consultoria (organization_id, por) values (pg_temp.id('semtag'), pg_temp.gil());

-- ---------------------------------------------------------------------
-- 1. O Colaborador tem IA
-- ---------------------------------------------------------------------
select is(app.ia_atende(pg_temp.id('conversa_colab')), true,
          'Parceiro Colaborador com mensagem esperando: a IA atende');
select pg_temp.entrar();
select is((public.ia_conversa_estado(pg_temp.id('conversa_colab')) ->> 'parceiro')::boolean, false,
          'para a tela, o Colaborador é como um Cliente (os controles da IA aparecem)');
select is((public.ia_conversa_estado(pg_temp.id('conversa_colab')) ->> 'atende')::boolean, true,
          'e a tela diz que a IA atende');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 2. Os outros Parceiros ficam com a equipe
-- ---------------------------------------------------------------------
select is(app.ia_atende(pg_temp.id('conversa_dono')), false, 'Proprietário: a IA fica quieta');
select is(app.ia_atende(pg_temp.id('conversa_inq')), false, 'Inquilino: a IA fica quieta');
select is(app.ia_atende(pg_temp.id('conversa_semtag')), false, 'Parceiro sem tag: a IA fica quieta');
select pg_temp.entrar();
select is((public.ia_conversa_estado(pg_temp.id('conversa_inq')) ->> 'parceiro')::boolean, true,
          'a tela sabe que o Inquilino é Parceiro que a IA não atende');
select ok((public.ia_conversa_estado(pg_temp.id('conversa_inq')) ->> 'motivo') like 'É Parceiro%Colaborador%',
          'e o motivo diz que a IA responde Clientes e Colaboradores');
select is((public.ia_conversa_estado(pg_temp.id('conversa_semtag')) ->> 'parceiro')::boolean, true,
          'o mesmo para a marca sem tag');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 3. Trocar a tag muda a resposta
-- ---------------------------------------------------------------------
select pg_temp.entrar();
select public.parceiro_mudar(pg_temp.id('colab'), true, 'inquilino', null);
select pg_temp.sair();
select is(app.ia_atende(pg_temp.id('conversa_colab')), false, 'Colaborador que virou Inquilino: a IA cala');
select pg_temp.entrar();
select public.parceiro_mudar(pg_temp.id('colab'), true, 'colaborador', null);
select pg_temp.sair();
select is(app.ia_atende(pg_temp.id('conversa_colab')), true, 'voltou para Colaborador: a IA volta');

-- O Proprietário que vira Colaborador também ganha a IA.
select pg_temp.entrar();
select public.parceiros_marcar(array[pg_temp.id('dono')], 'colaborador');
select pg_temp.sair();
select is(app.ia_atende(pg_temp.id('conversa_dono')), true,
          'marcado Colaborador pelo botão de Prospectados: a IA atende');

-- ---------------------------------------------------------------------
-- 4. As outras regras continuam valendo para o Colaborador
-- ---------------------------------------------------------------------
-- O time respondeu o Colaborador: a conversa é do time por 24 h.
insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at, sent_by)
values (pg_temp.id('conversa_colab'), 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
        'Oi, Cleo! Já te respondo.', 'human', 'crm', now() - interval '30 seconds', pg_temp.gil());
select is(app.ia_atende(pg_temp.id('conversa_colab')), false,
          'o time escreveu ao Colaborador há pouco: a IA fica quieta');
select is((select count(*) from public.consultoria where organization_id = pg_temp.id('colab'))::int, 1,
          'e a marca de Colaborador continua lá');

-- Alguém apertou "Parar a IA" na conversa do Proprietário que virou Colaborador.
insert into public.ia_atendimento (conversation_id, estado, mudou_por, mudou_em)
values (pg_temp.id('conversa_dono'), 'parada', pg_temp.gil(), now());
select is(app.ia_atende(pg_temp.id('conversa_dono')), false,
          '"Parar a IA" à mão vale também para o Colaborador');

-- Na KOMUNE a migração não faz nada; aqui, o comentário conta a regra nova.
select ok(obj_description('app.ia_atende(uuid)'::regprocedure, 'pg_proc') like '%Colaborador%',
          'o comentário da função conta a regra do Colaborador');

select * from finish();
rollback;

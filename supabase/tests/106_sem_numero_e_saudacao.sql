-- =====================================================================
-- pgTAP — Quem não tem número sai, e a saudação tem botão (migração 20261007130000)
--
-- Este arquivo prova:
--   1. A LIMPEZA tira quem não tem número nenhum — e só esses: fica quem tem
--      telefone numa pessoa de contato, quem tem conversa e o cliente. A
--      reunião de quem sai é cancelada, e a exclusão é assinada pelo sistema;
--   2. A EXCLUSÃO MANUAL continua igual depois de ganhar a camada interna;
--   3. O BOTÃO DA SAUDAÇÃO põe na fila só quem pode receber, e diz por que
--      pulou os outros; respeita o interruptor; não repete; desfaz;
--   4. SÓ A GESTÃO usa os dois.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(24);

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
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010601'::uuid $$;
create function pg_temp.ana() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010602'::uuid $$;
create function pg_temp.org(p text) returns uuid language sql immutable as $$
  select ('c0000000-0000-4000-8000-0000000106' || p)::uuid
$$;
create function pg_temp.excluida(p text) returns boolean language sql security definer set search_path = '' as $$
  select deleted_at is not null from public.organizations where id = ('c0000000-0000-4000-8000-0000000106' || p)::uuid
$$;
create function pg_temp.na_fila(p text) returns text language sql security definer set search_path = '' as $$
  select i.status from public.envios_em_massa_itens i join public.envios_em_massa e on e.id = i.envio_id
   where e.continuo and i.organization_id = ('c0000000-0000-4000-8000-0000000106' || p)::uuid
$$;

insert into public.allowed_users (email, role, note) values
  ('s106.g@teste.local', 'gestor', 'pgTAP 106'), ('s106.a@teste.local', 'sdr', 'pgTAP 106');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gil(), 's106.g@teste.local', '{"full_name":"Gil Gestor"}'),
  (pg_temp.ana(), 's106.a@teste.local', '{"full_name":"Ana Freela"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999910600"')
 where key = 'whatsapp.envio';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
update public.app_settings set value = value || '{"lead_automatico": false, "cumprimento_automatico": true}'::jsonb
 where key = 'atendimento';

--   01 com telefone            02 sem nada                 03 telefone só na pessoa
--   04 sem telefone, cliente   05 sem telefone, com conversa   06 sem telefone, com reunião
--   07 com telefone, pediu para não ser contatado
insert into public.organizations (id, name, phone_e164, source_id, owner_id)
select pg_temp.org(x.n), x.nome, x.fone, (select id from public.sources where slug = 'captura_campo'), pg_temp.gil()
  from (values ('01', 'S106 Com Fone',      '+5584999960601'),
               ('02', 'S106 Sem Nada',      null),
               ('03', 'S106 Fone Na Pessoa', null),
               ('04', 'S106 Cliente',       null),
               ('05', 'S106 Com Conversa',  null),
               ('06', 'S106 Com Reuniao',   null),
               ('07', 'S106 Nao Contatar',  '+5584999960607')) x(n, nome, fone);
insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
select o.id, 1, (select id from public.stages where pipeline_id = 1
                   and slug = case when o.name = 'S106 Cliente' then 'publicado' else 'prospectado' end),
       pg_temp.gil()
  from public.organizations o where o.name like 'S106 %';
insert into public.contacts (id, full_name, phone_e164)
values ('d0000000-0000-4000-8000-000000010603', 'Pessoa', '+5584999960603');
insert into public.organization_contacts (organization_id, contact_id, is_primary)
values (pg_temp.org('03'), 'd0000000-0000-4000-8000-000000010603', true);
set role service_role;
select public.wa_entrada_registrar('wamid.S106.1', '+5584999910600', '+5584999960605', 'text', 'oi');
reset role;
update public.conversations set organization_id = pg_temp.org('05') where peer_phone_e164 = '+5584999960605';
insert into public.reunioes (id, organization_id, dono_id, titulo, formato, inicio, fim, link, estado, marcada_por, marcada_por_id)
values ('d0000000-0000-4000-8000-000000010611', pg_temp.org('06'), pg_temp.gil(), 'Reunião S106', 'online',
        now() + interval '2 days', now() + interval '2 days 40 minutes', 'https://sala.invalid/s', 'marcada', 'pessoa', pg_temp.gil());
update public.organizations set do_not_contact = true where id = pg_temp.org('07');

-- =====================================================================
-- 1. A limpeza
-- =====================================================================
create temp table l106 as select app.limpar_sem_numero('pgTAP: limpeza de teste') as v;
select is((select (v ->> 'excluidas')::int from l106) >= 2, true, 'a limpeza exclui quem não tem número');
select is(pg_temp.excluida('02'), true, 'sem número nenhum: sai');
select is(pg_temp.excluida('06'), true, 'sem número e com reunião marcada: sai');
select is((select estado from public.reunioes where id = 'd0000000-0000-4000-8000-000000010611'), 'cancelada',
  'e a reunião dele é cancelada, com o horário solto');
select is(pg_temp.excluida('01'), false, 'com telefone: fica');
select is(pg_temp.excluida('03'), false, 'telefone só na pessoa de contato: fica (é por ele que a mensagem sai)');
select is(pg_temp.excluida('05'), false, 'com conversa de WhatsApp: fica (o número está no fio)');
select is(pg_temp.excluida('04'), false, 'cliente sem telefone: fica, pela regra da exclusão');
select results_eq(
  $$select deleted_by, deleted_reason from public.organizations where id = pg_temp.org('02')$$,
  $$values (null::uuid, 'pgTAP: limpeza de teste'::text)$$,
  'a ficha guarda o motivo, e "quem excluiu" fica vazio: foi o sistema');
select is((select actor_role from public.audit_log
            where action = 'EXCLUIR_PARCEIRO' and row_id = pg_temp.org('02')::text), 'sistema',
  'auditoria: assinada pelo sistema');

-- =====================================================================
-- 2. A exclusão manual depois da camada interna
-- =====================================================================
select pg_temp.entrar(pg_temp.ana(), 'sdr');
select is(public.parceiro_excluir(pg_temp.org('01'), 'teste') ->> 'motivo', 'sem_permissao',
  'quem liga continua sem excluir');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(public.parceiro_restaurar(pg_temp.org('02')) ->> 'ok', 'true',
  'quem saiu na limpeza volta pelo Restaurar');

-- =====================================================================
-- 3. O botão da saudação
-- =====================================================================
create temp table s106 as
  select public.saudacao_enfileirar(array[pg_temp.org('01'), pg_temp.org('02'), pg_temp.org('03'),
                                          pg_temp.org('05'), pg_temp.org('06'), pg_temp.org('07')]) as v;
grant select on s106 to authenticated;
select is((select (v ->> 'na_fila')::int from s106), 2, 'entram na fila só os dois que podem receber');
select is(pg_temp.na_fila('01'), 'pendente', 'quem tem telefone na ficha');
select is(pg_temp.na_fila('03'), 'pendente', 'e quem tem telefone na pessoa de contato');
select is((select v -> 'recusados' from s106),
  '{"sem_whatsapp": 1, "ja_conversou": 1, "nao_contatar": 1, "nao_encontrado": 1}'::jsonb,
  'e os outros quatro são pulados, cada um com o seu motivo');
select is(public.saudacao_enfileirar(array[pg_temp.org('01')]) -> 'recusados' ->> 'ja_na_fila', '1',
  'pedir de novo não põe duas vezes');
select is((public.saudacao_desfazer(array[pg_temp.org('01')]) ->> 'tiradas')::int, 1,
  'desfazer tira da fila o que ainda não saiu');
select is(pg_temp.na_fila('01'), 'cancelada', 'e a linha fica cancelada');
select is((public.saudacao_enfileirar(array[pg_temp.org('01')]) ->> 'na_fila')::int, 1,
  'e um novo pedido a põe de volta');
select is(public.saudacao_enfileirar('{}'::uuid[]) ->> 'motivo', 'nada_escolhido',
  'pedido vazio: recusa com nome');
select pg_temp.sair();

update public.app_settings set value = value || '{"cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(public.saudacao_enfileirar(array[pg_temp.org('03')]) ->> 'motivo', 'saudacao_desligada',
  'com o interruptor de Ajustes desligado, nada entra na fila');

-- =====================================================================
-- 4. Só a gestão
-- =====================================================================
select pg_temp.entrar(pg_temp.ana(), 'sdr');
select is(public.saudacao_enfileirar(array[pg_temp.org('03')]) ->> 'motivo', 'sem_permissao',
  'quem liga não manda saudação pela lista');
select throws_ok($$select app.limpar_sem_numero('x')$$, '42501', null,
  'a limpeza não é superfície de API');
select pg_temp.sair();

select * from finish();
rollback;

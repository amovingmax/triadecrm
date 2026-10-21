-- =====================================================================
-- pgTAP — O SDR tem o poder do gestor, menos Ajustes
--         (migração 20261021090000_o_sdr_tem_o_poder_do_gestor.sql)
--
--   1. `app.is_manager()` é de admin, gestor e SDR; `app.admin_ou_gestor()`,
--      só de admin e gestor; os papéis antigos não passam em nenhuma;
--   2. o SDR faz o que o gestor faz: excluir e restaurar parceiro, marcar
--      Consultoria, mexer no negócio de outra pessoa, abrir o dia e a meta de
--      outra SDR, mudar os pesos da triagem;
--   3. o SDR continua fora de Ajustes: telefonia, atendimento, robô,
--      exportação LGPD, catálogos, outras chaves de `app_settings`;
--   4. o telefone inteiro continua fora do alcance do SDR (tabela-base);
--   5. nada disso põe mensagem na fila de saída.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(35);

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
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000011101'::uuid $$;
create function pg_temp.ana() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000011102'::uuid $$;
create function pg_temp.bia() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000011103'::uuid $$;
create function pg_temp.edu() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000011104'::uuid $$;
create function pg_temp.org() returns uuid language sql immutable as $$ select 'c0000000-0000-4000-8000-000000011101'::uuid $$;
create function pg_temp.neg() returns uuid language sql immutable as $$ select 'e0000000-0000-4000-8000-000000011101'::uuid $$;
-- O que a fila de saída tem agora: mensagens e itens de envio em massa.
create function pg_temp.saida() returns bigint language sql security definer set search_path = '' as $$
  select (select count(*) from public.messages where direction = 'out')
       + (select count(*) from public.envios_em_massa_itens)
$$;

create temp table r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated;

insert into public.allowed_users (email, role, note) values
  ('f111.g@teste.local', 'gestor', 'pgTAP 111'), ('f111.a@teste.local', 'sdr', 'pgTAP 111'),
  ('f111.b@teste.local', 'sdr', 'pgTAP 111'), ('f111.e@teste.local', 'embaixador', 'pgTAP 111');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gil(), 'f111.g@teste.local', '{"full_name":"Gil Gestor"}'),
  (pg_temp.ana(), 'f111.a@teste.local', '{"full_name":"Ana SDR"}'),
  (pg_temp.bia(), 'f111.b@teste.local', '{"full_name":"Bia SDR"}'),
  (pg_temp.edu(), 'f111.e@teste.local', '{"full_name":"Edu Embaixador"}');

-- Um parceiro do Gil, com um negócio aberto dele.
insert into public.organizations (id, name, phone_e164, source_id, owner_id)
values (pg_temp.org(), 'F111 Parceiro do Gil', '+5584999111101',
        (select id from public.sources where slug = 'captura_campo'), pg_temp.gil());
insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id)
select pg_temp.neg(), pg_temp.org(), p.id, s.id, pg_temp.gil()
  from public.pipelines p join public.stages s on s.pipeline_id = p.id
 where p.slug = 'fornecedor' and s.slug = 'contatado';

insert into pg_temp.r values ('saida_antes', to_jsonb(pg_temp.saida()));

-- =====================================================================
-- 1. As duas regras, papel por papel
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'admin');
select ok(app.is_manager() and app.admin_ou_gestor(), 'admin: poder da gestão e Ajustes');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select ok(app.is_manager() and app.admin_ou_gestor(), 'gestor: poder da gestão e Ajustes');
select pg_temp.entrar(pg_temp.ana(), 'sdr');
select ok(app.is_manager(), 'SDR: tem o poder da gestão');
select ok(not app.admin_ou_gestor(), 'SDR: mas não entra em Ajustes');
select pg_temp.entrar(pg_temp.edu(), 'embaixador');
select ok(not app.is_manager() and not app.admin_ou_gestor(), 'embaixador (papel antigo): nenhuma das duas');
select pg_temp.entrar(pg_temp.edu(), 'leitura');
select ok(not app.is_manager() and not app.admin_ou_gestor(), 'leitura: nenhuma das duas');
select pg_temp.entrar(pg_temp.edu(), 'financeiro');
select ok(not app.is_manager() and not app.admin_ou_gestor(), 'financeiro: nenhuma das duas');
select pg_temp.sair();

-- =====================================================================
-- 2. O SDR faz o que o gestor faz
-- =====================================================================
do $$
begin
  perform pg_temp.entrar(pg_temp.ana(), 'sdr');
  insert into pg_temp.r values ('excluir', public.parceiro_excluir(pg_temp.org(), 'pgTAP 111: teste do SDR'));
  insert into pg_temp.r values ('restaurar', public.parceiro_restaurar(pg_temp.org()));
  insert into pg_temp.r values ('consultoria', public.consultoria_marcar(array[pg_temp.org()], true));
end $$;
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'excluir'), 'true',
  'o SDR exclui o parceiro de outra pessoa, com motivo');
select is((select valor ->> 'ok' from pg_temp.r where chave = 'restaurar'), 'true',
  'e o restaura');
select is((select valor ->> 'ok' from pg_temp.r where chave = 'consultoria'), 'true',
  'o SDR marca Consultoria');
select ok(exists (select 1 from public.consultoria where organization_id = pg_temp.org()),
  'e a marca fica');

select pg_temp.entrar(pg_temp.ana(), 'sdr');
select results_eq(
  $$with u as (update public.deals set next_action = 'Ligar de novo (SDR)' where id = pg_temp.neg() returning 1)
    select count(*)::int from u$$,
  $$values (1)$$,
  'o SDR mexe no negócio de outra pessoa');
select lives_ok(
  $$update public.organizations_view set description = 'editada pelo SDR' where id = pg_temp.org()$$,
  'o SDR edita, pela view, a ficha de outra pessoa');
select ok(app.acompanha(pg_temp.bia()), 'o SDR acompanha outra SDR, como o gestor');
select ok(not app.acompanha(pg_temp.gil()), 'e não acompanha quem está acima');
select lives_ok($$select public.meu_dia(pg_temp.bia(), 10)$$, 'o SDR abre o Meu dia de outra SDR');
select lives_ok($$select public.goal_progress(pg_temp.bia(), 'day', current_date)$$,
  'e a meta dela');
select lives_ok(
  $$insert into public.goals (user_id, period, metric, target, period_start)
    values (pg_temp.bia(), 'week', 'calls_made', 50, date_trunc('week', current_date)::date)$$,
  'o SDR define a meta de outra SDR');
select results_eq(
  $$with u as (update public.app_settings set value = value where key = 'radar.triagem' returning 1)
    select count(*)::int from u$$,
  $$values (1)$$,
  'o SDR muda os pesos da triagem, que ficam na Revisão');

-- =====================================================================
-- 3. O SDR continua fora de Ajustes
-- =====================================================================
select results_eq(
  $$with u as (update public.app_settings set value = value where key = 'voz.telefonia' returning 1)
    select count(*)::int from u$$,
  $$values (0)$$,
  'o SDR não liga nem desliga a telefonia (app_settings fora da triagem)');
select results_eq(
  $$with u as (update public.app_settings set value = value where key = 'whatsapp.envio' returning 1)
    select count(*)::int from u$$,
  $$values (0)$$,
  'nem mexe no envio do WhatsApp');
select is((public.voz_configurar('{}'::jsonb)) ->> 'motivo', 'sem_permissao',
  'nem nas chaves da voz (Ajustes → Ligações)');
select is((public.atendimento_configurar('{}'::jsonb)) ->> 'motivo', 'sem_permissao',
  'nem no atendimento (Ajustes → Atendimento)');
select throws_ok($$select public.wa_bot_ligar(false)$$, '42501', null,
  'nem liga ou desliga o robô de entrada');
select is((public.exportar_lgpd(pg_temp.org(), 'pgTAP 111')) ->> 'motivo', 'sem_permissao',
  'nem exporta os dados de um parceiro (LGPD, em Ajustes)');
select throws_ok($$insert into public.tags (name) values ('F111 etiqueta do SDR')$$, '42501', null,
  'nem cria etiqueta no catálogo');

-- =====================================================================
-- 4. O telefone inteiro continua fora do alcance do SDR
-- =====================================================================
select results_eq($$select count(*)::int from public.organizations$$, $$values (0)$$,
  'o SDR não lê a tabela-base de parceiros, onde está o telefone inteiro');
select results_eq($$select count(*)::int from public.contacts$$, $$values (0)$$,
  'nem a de pessoas');
select is((select phone_is_masked from public.organizations_view where id = pg_temp.org()), true,
  'pela view, o telefone continua mascarado para ele');
select results_eq($$select count(*)::int from public.pii_access_log$$, $$values (0)$$,
  'nem lê o registro de quem revelou telefone');
select pg_temp.sair();

-- =====================================================================
-- 5. Os papéis antigos continuam de fora; a gestão continua com tudo
-- =====================================================================
do $$
begin
  perform pg_temp.entrar(pg_temp.edu(), 'embaixador');
  insert into pg_temp.r values ('emb_excluir', public.parceiro_excluir(pg_temp.org(), 'pgTAP 111'));
  insert into pg_temp.r values ('emb_consultoria', public.consultoria_marcar(array[pg_temp.org()], false));
  perform pg_temp.entrar(pg_temp.gil(), 'gestor');
  insert into pg_temp.r values ('gestor_voz', public.voz_configurar('{}'::jsonb));
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'emb_excluir'), 'sem_permissao',
  'o embaixador não exclui parceiro');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'emb_consultoria'), 'sem_permissao',
  'nem mexe na Consultoria');
select isnt((select valor ->> 'motivo' from pg_temp.r where chave = 'gestor_voz'), 'sem_permissao',
  'o gestor continua nas chaves da voz');

select pg_temp.entrar(pg_temp.gil(), 'gestor');
select results_eq(
  $$with u as (update public.app_settings set value = value where key = 'voz.telefonia' returning 1)
    select count(*)::int from u$$,
  $$values (1)$$,
  'e na telefonia');
select pg_temp.sair();

-- =====================================================================
-- 6. Nada disso pôs mensagem na fila de saída
-- =====================================================================
select is(pg_temp.saida(), (select (valor #>> '{}')::bigint from pg_temp.r where chave = 'saida_antes'),
  'excluir, restaurar, Consultoria, negócio, meta e pesos não mandam mensagem a ninguém');

select * from finish();
rollback;

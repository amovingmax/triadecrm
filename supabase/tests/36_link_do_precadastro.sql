-- =====================================================================
-- pgTAP — O link do pré-cadastro sai do código
--         (migração 20260908120000_o_link_do_precadastro_sai_do_codigo.sql)
--
-- Decisão de produto de 08/09/2026: o fornecedor captado NÃO passa por uma
-- página do Tríade. O link leva ao cadastro que a Komune já tem, e o endereço
-- é configuração (`app_settings[precadastro.link].modelo`), não código.
--
-- A asserção que importa mais neste arquivo não é a do endereço certo — é a de
-- que, SEM endereço configurado, o token do fornecedor NÃO é queimado. Gerar um
-- link revoga o anterior; se a função descobrisse tarde que não sabe para onde
-- apontar, teria invalidado o link que já está no celular de alguém para
-- descobrir um problema nosso de configuração.
--
-- Roda em transação e desfaz tudo, inclusive a configuração que ela mexe.
-- =====================================================================
begin;
select plan(13);

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
create function pg_temp.versao(p_org uuid) returns int
  language sql security definer set search_path = '' as $$
  select claim_token_version from public.pre_registrations where organization_id = p_org
$$;
-- `to_jsonb` de um text nulo dá `null` jsonb, que é o que a função de emissão lê
-- como "não configurado". `jsonb_build_object('modelo', null)` faria o mesmo, mas
-- por um caminho que some se alguém trocar o tipo do parâmetro.
create function pg_temp.modelo(p_valor text) returns void
  language sql security definer set search_path = '' as $$
  update public.app_settings
     set value = jsonb_build_object('modelo', to_jsonb(p_valor))
   where key = 'precadastro.link'
$$;

create table pg_temp.r (chave text primary key, valor jsonb);
grant select on pg_temp.r to authenticated;

-- ---------- gente e ficha ----------
insert into public.allowed_users (email, role, note)
values ('c36.gestor@teste.local', 'gestor', 'pgTAP link do pré-cadastro');
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-0000000036a1', 'c36.gestor@teste.local', '{"full_name":"Gestor C36"}');

insert into public.categories (id, slug, name, "group", priority, position)
values (936, 'c36_teste', 'Categoria do teste do link', 'servicos', 2, 936);
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind)
values ('c0000000-0000-4000-8000-000000003601', 'C36 Buffet do Link', '+5584999360001', 'Tirol',
        (select id from public.sources where slug = 'planilha'), 'fornecedor');
insert into public.organization_categories (organization_id, category_id, is_primary)
values ('c0000000-0000-4000-8000-000000003601', 936, true);
insert into public.deals (organization_id, pipeline_id, stage_id)
values ('c0000000-0000-4000-8000-000000003601',
        (select id from public.pipelines where slug = 'fornecedor'),
        (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
          where p.slug = 'fornecedor' and s.slug = 'prospectado'));

-- ---------- a configuração existe e aponta para o cadastro real ----------
-- Até 09/09/2026 esta seção afirmava que o modelo "nasce VAZIO". Nascia mesmo, e
-- era o certo enquanto o endereço não estivesse decidido. Ele foi decidido no
-- mesmo dia, e a migração 20260909110000 passou a preenchê-lo — antes disso o
-- valor só existia como UPDATE à mão em produção, o que fazia este arquivo
-- passar no CI e falhar na máquina de quem tinha rodado o UPDATE.
select ok(exists (select 1 from public.app_settings where key = 'precadastro.link'),
  'a configuração precadastro.link existe');
select is((select value ->> 'modelo' from public.app_settings where key = 'precadastro.link'),
  'https://admin.komune.app.br/seja-parceiro?pre={token}',
  'e aponta para o cadastro da Komune, vindo de migração e não de UPDATE à mão');

-- O caminho "sem endereço" continua sendo testado, mas agora o teste o CRIA em
-- vez de contar com o estado inicial: a configuração vazia deixou de ser o padrão
-- do banco e virou uma situação (alguém limpou, ou um ambiente novo ainda não
-- decidiu). Testar o padrão de ontem seria testar o passado.
select pg_temp.modelo(null);

-- ---------- sem autorização, nem chega perto do endereço ----------
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000036a1', 'gestor');
  v := public.gerar_link_de_reivindicacao('c0000000-0000-4000-8000-000000003601');
  execute 'reset role';
  insert into pg_temp.r values ('sem_autorizacao', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'sem_autorizacao'), 'sem_autorizacao',
  'regressão: sem autorização registrada o link continua recusado (o guardrail do CLAUDE.md não foi afrouxado)');

-- ---------- com autorização e rascunho, mas sem endereço ----------
insert into public.consent_events (kind, organization_id, channel, evidence_text)
values ('data_use_authorized', 'c0000000-0000-4000-8000-000000003601', 'phone', 'pgTAP: autorizou');

do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000036a1', 'gestor');
  v := public.criar_pre_cadastro_da_ficha('c0000000-0000-4000-8000-000000003601');
  execute 'reset role';
  insert into pg_temp.r values ('rascunho', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'rascunho'), 'true',
  'o rascunho foi criado');
select is(pg_temp.versao('c0000000-0000-4000-8000-000000003601'), 0,
  'e nasce com versão de token 0 (nenhum link emitido ainda)');

do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000036a1', 'gestor');
  v := public.gerar_link_de_reivindicacao('c0000000-0000-4000-8000-000000003601');
  execute 'reset role';
  insert into pg_temp.r values ('sem_endereco', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'sem_endereco'),
          'endereco_nao_configurado',
  'sem endereço configurado, a emissão é recusada com motivo nomeado');

-- ESTA é a asserção que justifica o arquivo:
select is(pg_temp.versao('c0000000-0000-4000-8000-000000003601'), 0,
  'e o token do fornecedor NÃO foi queimado — a versão continua 0');

-- ---------- modelo torto: sem {token} não serve ----------
select pg_temp.modelo('https://komune.app.br/seja-parceiro');
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000036a1', 'gestor');
  v := public.gerar_link_de_reivindicacao('c0000000-0000-4000-8000-000000003601');
  execute 'reset role';
  insert into pg_temp.r values ('sem_placeholder', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'sem_placeholder'),
          'endereco_nao_configurado',
  'modelo sem {token} é tão inútil quanto modelo nenhum, e é recusado igual');
select is(pg_temp.versao('c0000000-0000-4000-8000-000000003601'), 0,
  'e também não queima o token');

-- ---------- com endereço, o link sai ----------
select pg_temp.modelo('https://komune.app.br/seja-parceiro?pre={token}');
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000036a1', 'gestor');
  v := public.gerar_link_de_reivindicacao('c0000000-0000-4000-8000-000000003601');
  execute 'reset role';
  insert into pg_temp.r values ('emitido', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'emitido'), 'true',
  'com endereço configurado, o link é emitido');
select ok((select valor ->> 'url' from pg_temp.r where chave = 'emitido')
          like 'https://komune.app.br/seja-parceiro?pre=%',
  'e a url sai do MODELO, não do corpo da função');
select ok((select valor ->> 'url' from pg_temp.r where chave = 'emitido')
          = 'https://komune.app.br/seja-parceiro?pre=' || (select valor ->> 'token' from pg_temp.r where chave = 'emitido'),
  'com o token no lugar do {token}, e não outro qualquer');
select is(pg_temp.versao('c0000000-0000-4000-8000-000000003601'), 1,
  'e SÓ AGORA a versão do token subiu — a revogação acontece quando o link existe');

select * from finish();
rollback;

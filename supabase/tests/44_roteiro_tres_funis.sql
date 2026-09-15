-- =====================================================================
-- pgTAP — O roteiro ganha os três funis (migração 20260915100000)
--   app.no_vale_na_variante · app.validar_roteiro (ativação)
--   · app.variante_da_ligacao · app.entrada_da_ligacao
--   · app.call_candidates (etapa_sem_ligacao) · public.proximo_da_fila (variante e
--   entrada) · public.iniciar_chamada (call_attempts.variante) · roteiro v3 publicado
--   · os três modelos de depois da ligação
--
-- O que este arquivo tem de provar:
--   1. A variante sai do FUNIL do lote: um produtor num lote do funil fornecedor ouve
--      o roteiro do fornecedor, e um fornecedor no funil de ativação, o de ativação.
--   2. A ativação começa pelo motivo da etapa ATUAL do negócio.
--   3. Quem já contratou pela Komune não entra em lote de ativação, e o recibo diz por quê.
--   4. A v2 continua válida (os lotes montados com ela seguem lendo a árvore dela).
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(32);

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
create function pg_temp.funil(p_slug text) returns int language sql as $$
  select id from public.pipelines where slug = p_slug
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_slug
$$;
create function pg_temp.hoje() returns date language sql as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;
create function pg_temp.roteiro() returns uuid language sql as $$
  select id from public.call_scripts where slug = 'captacao_v1' and is_published
$$;

create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated;

-- A janela abre o dia inteiro DENTRO da transação (o mesmo recurso do 15 e do 32).
create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select 0::numeric, 24::numeric where p_dow between 0 and 6
$$;
delete from public.holidays where date = pg_temp.hoje();


-- =====================================================================
-- 1. Onde um nó vale
-- =====================================================================
select ok(app.no_vale_na_variante('captacao', 'produtor'), 'captacao vale para produtor');
select ok(not app.no_vale_na_variante('captacao', 'ativacao'), 'captacao não vale para ativação');
select ok(app.no_vale_na_variante('ambas', 'ativacao'), 'ambas vale para ativação');


-- =====================================================================
-- 2. O roteiro publicado
-- =====================================================================
select is((select versao from public.call_scripts where slug = 'captacao_v1' and is_published), 3,
  'a versão publicada é a 3');
select is((select count(*)::int from public.call_scripts where slug = 'captacao_v1' and is_published), 1,
  'uma versão publicada só');
select is(app.validar_roteiro((select arvore from public.call_scripts where id = pg_temp.roteiro())),
  '{}'::text[], 'a v3 passa no validador');
select is(app.validar_roteiro((select arvore from public.call_scripts where slug = 'captacao_v1' and versao = 2)),
  '{}'::text[], 'a v2 continua válida: os lotes dela seguem lendo a árvore');
select ok((select count(distinct n ->> 'variante')::int
             from public.call_scripts s, jsonb_array_elements(s.arvore) n
            where s.id = pg_temp.roteiro()) >= 5,
  'a v3 usa os escopos ambas, captacao, fornecedor, produtor e ativacao');
select ok(
  'Falta o nó de entrada da ativação "ativ_abertura_pedido".' = any (app.validar_roteiro($j$[
    {"id":"abertura","tipo":"pergunta","variante":"ambas","texto":"Oi?","saidas":[{"rotulo":"Ok","destino":"ativ_abertura_perfil"}]},
    {"id":"ativ_abertura_perfil","tipo":"fim","variante":"ativacao","texto":"Tchau.","desfecho":"lig_interessado"}
  ]$j$::jsonb)),
  'árvore com ativação precisa das quatro entradas');
select ok(
  '"abertura" fica sem saída na variante ativacao.' = any (app.validar_roteiro($j$[
    {"id":"abertura","tipo":"pergunta","variante":"ambas","texto":"Oi?","saidas":[{"rotulo":"Ok","destino":"f"}]},
    {"id":"f","tipo":"fim","variante":"captacao","texto":"Tchau.","desfecho":"lig_interessado"},
    {"id":"ativ_abertura_perfil","tipo":"fim","variante":"ativacao","texto":"T.","desfecho":"lig_interessado"},
    {"id":"ativ_abertura_pedido","tipo":"fim","variante":"ativacao","texto":"T.","desfecho":"lig_interessado"},
    {"id":"ativ_abertura_respondido","tipo":"fim","variante":"ativacao","texto":"T.","desfecho":"lig_interessado"},
    {"id":"ativ_abertura_reativar","tipo":"fim","variante":"ativacao","texto":"T.","desfecho":"lig_interessado"}
  ]$j$::jsonb)),
  'nó comum sem saída na ativação é erro');

select is((select count(*)::int from public.message_templates
            where template_code in ('GEN-LIG-CONFIRMA', 'GEN-LIG-RESUMO-FOR', 'GEN-LIG-RESUMO-PRO')
              and is_active and channel = 'whatsapp'), 3,
  'os três modelos de depois da ligação existem');
select is((select count(*)::int from public.message_templates
            where template_code like 'GEN-LIG-%'
              and body !~ '^Oi, \{\{nome\}\}! Aqui é \{\{atendente\}\}, da Komune\.'), 0,
  'os três se apresentam com o nome de quem envia');


-- =====================================================================
-- 3. As funções de roteamento não são chamáveis de fora
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'app.entrada_da_ligacao(text, int)', 'execute'),
  'authenticated não executa app.entrada_da_ligacao');
select ok(not has_function_privilege('anon', 'app.variante_da_ligacao(uuid, app.org_kind)', 'execute'),
  'anon não executa app.variante_da_ligacao');


-- =====================================================================
-- 4. Gente e parceiros
-- =====================================================================
insert into public.allowed_users (email, role, note) values ('c44.sdr@teste.local', 'sdr', 'pgTAP três funis');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000044a1', 'c44.sdr@teste.local', '{"full_name":"SDR Três Funis"}');

insert into public.categories (id, slug, name, "group", priority, position)
values (944, 'c44_ativacao', 'Categoria de teste da ativação', 'servicos', 2, 944),
       (945, 'c44_captacao', 'Categoria de teste da captação', 'servicos', 2, 945);

-- Ativação: um parceiro por etapa, e o de "primeira_contratacao" tem de ficar fora do lote
-- ("recorrente" é etapa ganha: o negócio já não está aberto e sai por isso).
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind)
select ('c0000000-0000-4000-8000-00000000440' || i)::uuid, 'C44 Parceiro ' || e, '+55849994400' || lpad(i::text, 2, '0'),
       'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor'
  from (values (1, 'publicado'), (2, 'primeiro_lead'), (3, 'lead_respondido'),
               (4, 'em_risco'), (5, 'primeira_contratacao')) as t(i, e);
insert into public.organization_categories (organization_id, category_id, is_primary)
select id, 944, true from public.organizations where name like 'C44 Parceiro %';
insert into public.deals (organization_id, pipeline_id, stage_id)
select o.id, pg_temp.funil('ativacao'), pg_temp.etapa('ativacao', replace(o.name, 'C44 Parceiro ', ''))
  from public.organizations o where o.name like 'C44 Parceiro %';

-- Captação: um cerimonialista no funil do FORNECEDOR.
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind) values
  ('c0000000-0000-4000-8000-000000004411', 'C44 Cerimonial no funil errado', '+5584999441100', 'Tirol',
   (select id from public.sources where slug = 'planilha'), 'cerimonialista');
insert into public.organization_categories (organization_id, category_id, is_primary) values
  ('c0000000-0000-4000-8000-000000004411', 945, true);
insert into public.deals (organization_id, pipeline_id, stage_id) values
  ('c0000000-0000-4000-8000-000000004411', pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'));

-- A temperatura vem da etapa: publicado, perfil_completo e em_risco são "cliente";
-- do primeiro pedido em diante, "cliente_ativo". Um lote não mistura temperaturas, então
-- a ativação deste teste são dois lotes.
select is((select string_agg(replace(o.name, 'C44 Parceiro ', '') || ':' || d.temperature, ',' order by o.name)
             from public.deals d join public.organizations o on o.id = d.organization_id
            where o.name like 'C44 Parceiro %'),
  'em_risco:cliente,lead_respondido:cliente_ativo,primeira_contratacao:cliente_ativo,primeiro_lead:cliente_ativo,publicado:cliente',
  'a temperatura dos negócios da ativação sai da etapa');


-- =====================================================================
-- 5. O lote de ativação
-- =====================================================================
do $$
declare v jsonb; i int; t text; lote uuid;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000044a1', 'sdr');
  foreach t in array array['cliente', 'cliente_ativo'] loop
    v := public.montar_lote('C44 ativação ' || t, pg_temp.funil('ativacao'), t::app.temperature,
           pg_temp.roteiro(), array[944], 'prioridade', 10, 1, 20, null, pg_temp.hoje(), pg_temp.hoje());
    insert into pg_temp.r values ('lote_' || t, v);
    lote := (v ->> 'lote_id')::uuid;
    for i in 1..3 loop
      v := public.proximo_da_fila(lote);
      insert into pg_temp.r values ('ativ_' || coalesce(v -> 'item' ->> 'nome', t || '_fim_' || i), v);
    end loop;
  end loop;
end $$;
select pg_temp.sair();

select is((select valor ->> 'entraram' from pg_temp.r where chave = 'lote_cliente_ativo'), '2',
  'no lote "cliente_ativo" entram os dois com pedido');
select is((select valor -> 'excluidos' ->> 'etapa_sem_ligacao' from pg_temp.r where chave = 'lote_cliente_ativo'), '1',
  'quem já está em primeira contratação sai, e o recibo diz por quê');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'ativ_cliente_ativo_fim_3'), 'fila_vazia',
  'e não aparece na fila');
select is((select valor ->> 'entraram' from pg_temp.r where chave = 'lote_cliente'), '2',
  'no lote "cliente" entram o publicado e o em risco');

select is((select valor ->> 'variante' from pg_temp.r where chave = 'ativ_C44 Parceiro publicado'), 'ativacao',
  'lote de ativação: variante ativacao, mesmo o parceiro sendo fornecedor');
select is((select valor ->> 'entrada' from pg_temp.r where chave = 'ativ_C44 Parceiro publicado'), 'ativ_abertura_perfil',
  'publicado entra pelo perfil');
select is((select valor ->> 'entrada' from pg_temp.r where chave = 'ativ_C44 Parceiro primeiro_lead'), 'ativ_abertura_pedido',
  'primeiro_lead entra pelo pedido esperando resposta');
select is((select valor ->> 'entrada' from pg_temp.r where chave = 'ativ_C44 Parceiro lead_respondido'), 'ativ_abertura_respondido',
  'lead_respondido entra pelo pedido respondido');
select is((select valor ->> 'entrada' from pg_temp.r where chave = 'ativ_C44 Parceiro em_risco'), 'ativ_abertura_reativar',
  'em_risco entra pela reativação');

select is(app.entrada_da_ligacao('fornecedor', pg_temp.etapa('ativacao', 'em_risco')), 'abertura',
  'captação sempre entra pela abertura');

do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000044a1', 'sdr');
  v := public.iniciar_chamada((select (valor -> 'item' ->> 'id')::uuid from pg_temp.r
                                where chave = 'ativ_C44 Parceiro em_risco'));
  insert into pg_temp.r values ('chamada_ativ', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'chamada_ativ'), 'true',
  'a chamada de ativação abre');
select is((select variante from public.call_attempts
            where id = (select (valor -> 'chamada' ->> 'id')::uuid from pg_temp.r where chave = 'chamada_ativ')),
  'ativacao', 'e a tentativa grava a variante ativacao');


-- =====================================================================
-- 6. O funil manda mais que o tipo
-- =====================================================================
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000044a1', 'sdr');
  v := public.montar_lote('C44 captação', pg_temp.funil('fornecedor'), 'frio', pg_temp.roteiro(),
         array[945], 'prioridade', 5, 1, 20, null, pg_temp.hoje(), pg_temp.hoje());
  insert into pg_temp.r values ('lote_forn', v);
  v := public.proximo_da_fila((v ->> 'lote_id')::uuid);
  insert into pg_temp.r values ('forn', v);
  v := public.iniciar_chamada((v -> 'item' ->> 'id')::uuid);
  insert into pg_temp.r values ('chamada_forn', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'variante' from pg_temp.r where chave = 'forn'), 'fornecedor',
  'cerimonialista num lote do funil fornecedor ouve o roteiro do fornecedor');
select is((select valor ->> 'entrada' from pg_temp.r where chave = 'forn'), 'abertura',
  'e começa pela abertura');
select is((select variante from public.call_attempts
            where id = (select (valor -> 'chamada' ->> 'id')::uuid from pg_temp.r where chave = 'chamada_forn')),
  'fornecedor', 'a tentativa grava a variante do funil');

-- Lote de ativação com roteiro SEM ativação (a v2) cai na regra antiga, pelo tipo.
update public.call_batches set script_id = (select id from public.call_scripts where slug = 'captacao_v1' and versao = 2)
 where id = (select (valor ->> 'lote_id')::uuid from pg_temp.r where chave = 'lote_cliente');
select is(app.variante_da_ligacao((select (valor ->> 'lote_id')::uuid from pg_temp.r where chave = 'lote_cliente'),
                                  'cerimonialista'), 'produtor',
  'lote de ativação com a v2: a variante volta a sair do tipo');

select is((select count(*)::int from app.call_candidates(pg_temp.funil('produtor'), 'cliente_ativo', array[944], 'prioridade', 1)
            where motivo = 'etapa_sem_ligacao'), 0,
  '"recorrente" do funil produtor não é confundido com o da ativação');

select * from finish();
rollback;

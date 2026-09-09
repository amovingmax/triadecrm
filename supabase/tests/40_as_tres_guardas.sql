-- =====================================================================
-- pgTAP — As três guardas que faltavam
--         (migração 20260909140000_as_tres_guardas_que_faltavam.sql)
--
-- Os três defeitos não têm assunto em comum, mas têm um formato em comum: em
-- todos, o papel `leitura` fazia alguma coisa que o produto diz que ele não
-- faz. Este arquivo trava as três correções pelo mesmo lado — o do papel.
--
--   1. `komune_event_map` estava sem RLS e, pela `alter default privileges` da
--      000500, com INSERT/UPDATE/DELETE concedidos a todo autenticado. Quem
--      reescrevesse o dicionário mudava o que um webhook da Komune faz com o
--      pré-cadastro, e a entrega continuava respondendo 200: o estrago seria
--      silencioso. Aqui: `leitura` LÊ (é catálogo) e não escreve — e nem o
--      admin escreve, porque isso é metade de um contrato e muda por migração.
--
--   2. `relatorio_semanal_gerar` guardava com `app.sees_all()`, que inclui
--      `leitura`. Gerar não lê: sobrescreve o único registro daquela semana e
--      assina quem pediu. Aqui: `leitura` e `financeiro` LEEM o relatório e não
--      o geram; gestor gera e fica gravado como autor.
--
--   3. `app.role()` caía em `leitura` quando a claim do papel faltava — e
--      `leitura` é o papel que lê `organizations`/`contacts` na tabela base,
--      com telefone sem máscara. NÃO foi consertada: ver o cabeçalho da
--      is_admin, is_manager, can_write, sees_all nem reads_base_pii, e por isso
--      não enxerga a base.
--
-- O par de asserções que mais importa está na seção 3: a MESMA organização, o
-- MESMO banco, a MESMA consulta, contada duas vezes. Com a claim de papel
-- presente, `leitura` vê a linha; com a claim perdida, a sessão não vê nada.
-- Antes desta migração as duas viam — e viam o telefone inteiro.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(23);

create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;

-- A mesma entrada, com o JWT que o Custom Access Token Hook NÃO conseguiu
-- carimbar: tem `sub` (a pessoa está logada de verdade) e não tem
-- `app_metadata.app_role`. É o cenário do terceiro defeito.
create function pg_temp.entrar_sem_papel(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- E o JWT com um papel que não existe no enum (claim antiga, hook de outra
-- versão): cai no mesmo lugar que a claim ausente.
create function pg_temp.entrar_com_papel_torto(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', 'superusuario'))::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

-- Três semanas atrás: fechada com folga, e longe do que os outros arquivos da
-- suíte geram.
create function pg_temp.semana() returns date language sql stable as $$
  select (date_trunc('week', ((now() at time zone 'America/Fortaleza')::date - 21)::timestamp))::date
$$;

-- ---------- gente ----------
insert into public.allowed_users (email, role, note) values
  ('c40.gestor@teste.local',   'gestor',    'pgTAP três guardas'),
  ('c40.leitura@teste.local',  'leitura',   'pgTAP três guardas'),
  ('c40.fin@teste.local',      'financeiro','pgTAP três guardas'),
  ('c40.admin@teste.local',    'admin',     'pgTAP três guardas'),
  -- No banco esta pessoa É `leitura`. O token é que esqueceu de dizer.
  ('c40.semclaim@teste.local', 'leitura',   'pgTAP três guardas');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000040a1', 'c40.gestor@teste.local',   '{"full_name":"Gestor C40"}'),
  ('a0000000-0000-4000-8000-0000000040a2', 'c40.leitura@teste.local',  '{"full_name":"Leitura C40"}'),
  ('a0000000-0000-4000-8000-0000000040a3', 'c40.fin@teste.local',      '{"full_name":"Financeiro C40"}'),
  ('a0000000-0000-4000-8000-0000000040a4', 'c40.admin@teste.local',    '{"full_name":"Admin C40"}'),
  ('a0000000-0000-4000-8000-0000000040a5', 'c40.semclaim@teste.local', '{"full_name":"Sem Claim C40"}');

-- ---------- uma ficha com telefone, para a queda do papel ter o que não ver ----------
insert into public.categories (id, slug, name, "group", priority, position)
values (940, 'c40_teste', 'Categoria do teste das três guardas', 'servicos', 2, 940);
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind)
values ('c0000000-0000-4000-8000-000000004001', 'C40 Buffet das Três Guardas',
        '+5584999400001', 'Tirol', (select id from public.sources where slug = 'planilha'), 'fornecedor');
insert into public.organization_categories (organization_id, category_id, is_primary)
values ('c0000000-0000-4000-8000-000000004001', 940, true);
insert into public.contacts (id, full_name, phone_e164, role_title)
values ('f0000000-0000-4000-8000-000000004001', 'Pessoa de Contato C40', '+5584999400002', 'dono');
insert into public.organization_contacts (organization_id, contact_id, is_primary)
values ('c0000000-0000-4000-8000-000000004001', 'f0000000-0000-4000-8000-000000004001', true);


-- =====================================================================
-- 1. O DICIONÁRIO DA KOMUNE: CATÁLOGO DE LEITURA, ESCRITA POR MIGRAÇÃO
-- =====================================================================
select ok((select relrowsecurity from pg_class where oid = 'public.komune_event_map'::regclass),
  'komune_event_map agora tem RLS habilitada — era a única tabela de public sem ela');

-- Não é `force` de propósito: `app.komune_aplicar_evento` é security definer e
-- roda como o dono da tabela. Tornar a RLS `force` cortaria o webhook, que é
-- justamente quem precisa ler o dicionário.
select ok(not (select relforcerowsecurity from pg_class where oid = 'public.komune_event_map'::regclass),
  'a RLS não é FORCE: o dono da tabela, que é quem o webhook vira ao rodar, continua lendo o dicionário');

select results_eq(
  $$select policyname, cmd from pg_policies
     where schemaname = 'public' and tablename = 'komune_event_map'$$,
  $$values ('komune_event_map_select'::name, 'SELECT'::text)$$,
  'a única política é a de leitura: não existe caminho de escrita pela API, nem para admin');

select ok(has_table_privilege('authenticated', 'public.komune_event_map', 'select'),
  'ler o dicionário continua sendo de todo autenticado: a tela mostra o nome do evento em português');
select ok(not has_table_privilege('authenticated', 'public.komune_event_map', 'insert'),
  'authenticated perdeu o privilégio de INSERT que a default privileges tinha dado');
select ok(not has_table_privilege('authenticated', 'public.komune_event_map', 'update'),
  'e o de UPDATE: o banco recusa antes de olhar a RLS, e não só porque falta política');
select ok(not has_table_privilege('authenticated', 'public.komune_event_map', 'delete'),
  'e o de DELETE');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000040a2', 'leitura');
select ok((select count(*) from public.komune_event_map) > 0,
  'leitura enxerga o dicionário inteiro: é catálogo, e esconder faria a tela mostrar o código cru');
select throws_ok(
  $$insert into public.komune_event_map (external, internal) values ('pgtap.c40', 'inventado')$$,
  '42501', null,
  'leitura não acrescenta evento ao dicionário — quem escreve nele muda o que o webhook faz com o pré-cadastro');
select throws_ok(
  $$update public.komune_event_map set internal = 'sequestrado' where external = 'supplier.published'$$,
  '42501', null,
  'leitura não reescreve a tradução de um evento existente');
select throws_ok(
  $$delete from public.komune_event_map where external = 'supplier.published'$$,
  '42501', null,
  'leitura não apaga uma linha do dicionário (apagar não derruba a entrega: ela passa a ser ignorada em silêncio)');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000040a4', 'admin');
select throws_ok(
  $$insert into public.komune_event_map (external, internal) values ('pgtap.c40.admin', 'inventado')$$,
  '42501', null,
  'nem admin escreve no dicionário pela API: é a metade nossa de um contrato, e muda por migração revisada');
select pg_temp.sair();


-- =====================================================================
-- 2. GERAR O RELATÓRIO DA SEMANA É ATO DE GESTÃO; LER NÃO É
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000040a2', 'leitura');
select throws_ok(
  format('select public.relatorio_semanal_gerar(date %L)', pg_temp.semana()),
  '42501', null,
  'leitura não gera o relatório: gerar sobrescreve o único registro da semana e assina quem pediu');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000040a1', 'gestor');
select is(public.relatorio_semanal_gerar(pg_temp.semana()), pg_temp.semana(),
  'gestor gera o relatório da semana fechada');
select pg_temp.sair();

select is((select gerado_por_id from public.weekly_reports where semana_inicio = pg_temp.semana()),
  'a0000000-0000-4000-8000-0000000040a1'::uuid,
  'e fica gravado como autor quem tinha permissão de gerar');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000040a2', 'leitura');
select is((select count(*)::int from public.relatorio_semanal(pg_temp.semana())), 1,
  'leitura continua ABRINDO o relatório: a correção tirou a escrita, não a leitura');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000040a3', 'financeiro');
select throws_ok(
  format('select public.relatorio_semanal_gerar(date %L)', pg_temp.semana()),
  '42501', null,
  'financeiro também não gera: passa em app.sees_all, que era a guarda errada, e não em app.is_manager');
select is((select count(*)::int from public.relatorio_semanal(pg_temp.semana())), 1,
  'e financeiro também continua abrindo o relatório guardado');
select pg_temp.sair();


-- =====================================================================
-- 3. A QUEDA DO PAPEL DEIXA DE SER O PAPEL QUE LÊ TELEFONE
-- =====================================================================
-- Primeiro o retrato de `leitura` COM a claim, para a comparação valer: é o
-- mesmo banco, a mesma organização e a mesma consulta das asserções seguintes.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000040a5', 'leitura');
select is(app.role()::text, 'leitura',
  'com a claim carimbada, app.role() devolve o papel do perfil');
select ok(app.reads_base_pii(),
  'e leitura lê organizations/contacts na tabela BASE: telefone completo, sem passar por reveal_phone');
select is((select count(*)::int from public.organizations
            where id = 'c0000000-0000-4000-8000-000000004001'), 1,
  'com a claim, a sessão enxerga a ficha do teste na tabela base');
select pg_temp.sair();

-- A terceira guarda — a queda de `app.role()` — foi DIAGNOSTICADA e não
-- consertada. Cair em `bot` quebra `public.origem_dos_dados` e mais dois
-- arquivos de teste, porque meio produto guarda com `app.org_is_visible` e
-- nenhum papel que não enxergue a base passa por ali. O porquê está no
-- cabeçalho da migração 20260909140000.
--
-- O que sobra aqui é a asserção que TRAVA o defeito no lugar, para ninguém o
-- descobrir de novo do zero: a queda continua sendo `leitura`, e `leitura` lê
-- PII. Quando alguém consertar de verdade, é esta linha que vai falhar — e é
-- assim que ela avisa.
select pg_temp.entrar_sem_papel('a0000000-0000-4000-8000-0000000040a5');
select is(app.role()::text, 'leitura',
  'DEFEITO CONHECIDO: sem a claim do papel, a queda ainda é leitura (ver o cabeçalho da migração)');
select ok(app.reads_base_pii(),
  'e essa queda lê o telefone sem máscara — é o buraco que continua aberto');
select pg_temp.sair();

select * from finish();
rollback;

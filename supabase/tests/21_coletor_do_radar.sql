-- =====================================================================
-- pgTAP — O coletor do Radar (migração 20260904001802)
--   public.esteira_fila_enfileirar / esteira_fila_ler / esteira_fila_concluir
--   · public.esteira_fila_falhar · public.esteira_estado_lote
--   · app.e_o_worker · app.can_write · sources.config.collector.catalogo
--   · public.source_category_map
--
-- O que este arquivo tem de provar, e por quê:
--   1. O WORKER NÃO É "PAPEL LEITURA". A chave `service_role` é um JWT: os
--      guardas escritos como "com claims, exige can_write()" barravam o único
--      chamador honesto da esteira. Foi o defeito que impediu a primeira coleta
--      real de abrir lote e, depois, de resolver a captura. Aqui ele fica preso.
--   2. As quatro bocas da fila existem em `public` (o schema `app` não é exposto
--      ao PostgREST) e SÓ o worker as executa. Se alguém conceder uma delas a
--      `authenticated` por engano, este arquivo acusa.
--   3. O invólucro não é uma segunda implementação: ele delega, e a chave de
--      idempotência continua valendo — a mesma chave não entra duas vezes.
--   4. O catálogo de coleta e o mapa de categoria são DADOS, e todo caminho
--      cadastrado é permitido pelo robots.txt da fonte (o worker confere de
--      novo a cada corrida; aqui o que se prova é que nenhum caminho do
--      catálogo cai nos prefixos que o R03 registrou como proibidos).
--   5. `cabine-de-fotos` fica DE PROPÓSITO fora do mapa: sem mapa, a categoria
--      chega nula e quem revisa escolhe. É a regra da 001600, e é fácil de
--      quebrar por gentileza.
--
-- Nenhuma asserção conta linha absoluta em tabela compartilhada: este banco tem
-- operação real dentro. Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(36);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
-- O worker: claims de service_role e o papel de banco que o PostgREST assume.
create function pg_temp.entrar_como_worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.fonte(p_slug text) returns int language sql as $$
  select id from public.sources where slug = p_slug
$$;
grant execute on function pg_temp.fonte(text) to authenticated, service_role;


-- =====================================================================
-- 1. app.e_o_worker: quem é o worker, e quem não é
-- =====================================================================
select pg_temp.entrar_como_worker();
select is(app.e_o_worker(), true, 'worker: a chave service_role é reconhecida como worker');
select is(app.can_write(), true,
  'worker: can_write() diz a verdade — service_role é BYPASSRLS e escreve de qualquer forma');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000901', 'sdr');
select is(app.e_o_worker(), false, 'sdr: uma pessoa logada nunca é o worker');
select is(app.can_write(), true, 'sdr: continua escrevendo na base, como antes');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000904', 'leitura');
select is(app.e_o_worker(), false, 'leitura: não é o worker');
select is(app.can_write(), false, 'leitura: continua sem escrever na base (a correção não afrouxou nada)');

select pg_temp.entrar('a0000000-0000-4000-8000-000000000905', 'financeiro');
select is(app.can_write(), false, 'financeiro: continua sem escrever na base');
select pg_temp.sair();


-- =====================================================================
-- 2. As quatro bocas da fila: existem, e só o worker executa
-- =====================================================================
select has_function('public', 'esteira_fila_enfileirar',
  array['text','jsonb','text','uuid','integer'], 'fila: esteira_fila_enfileirar existe em public');
select has_function('public', 'esteira_fila_ler', array['text','integer'],
  'fila: esteira_fila_ler existe em public');
select has_function('public', 'esteira_fila_concluir', array['text','bigint','text'],
  'fila: esteira_fila_concluir existe em public');
select has_function('public', 'esteira_fila_falhar', array['text','bigint','text','text'],
  'fila: esteira_fila_falhar existe em public');
select has_function('public', 'esteira_estado_lote', array['uuid','text','jsonb','text'],
  'lote: esteira_estado_lote existe em public');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'esteira\_fila\_%'
      and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute'))),
  0, 'fila: nenhuma boca da fila é executável por authenticated ou anon');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'esteira\_fila\_%'
      and has_function_privilege('service_role', p.oid, 'execute')),
  4, 'fila: as quatro bocas são executáveis pelo worker');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'esteira_estado_lote'
      and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute'))),
  0, 'lote: fechar lote é do worker, não de gente');

-- Uma pessoa logada não alcança a fila nem pelo caminho novo.
select pg_temp.entrar('a0000000-0000-4000-8000-000000000901', 'sdr');
select throws_ok(
  $$select public.esteira_fila_ler('ingest_jobs', 1)$$,
  '42501', null, 'fila: sdr não lê a fila da esteira nem pelo invólucro público');
select pg_temp.sair();


-- =====================================================================
-- 3. O invólucro delega de verdade (e a idempotência continua valendo)
-- =====================================================================
select pg_temp.entrar_como_worker();

create temporary table pg_temp_chave (chave text) on commit drop;
insert into pg_temp_chave values ('pgtap:20:' || gen_random_uuid()::text);

select is(
  (select (public.esteira_fila_enfileirar('ingest_jobs', '{"teste":"pgtap"}'::jsonb, c.chave)) ->> 'enfileirado'
     from pg_temp_chave c),
  'true', 'fila: a primeira mensagem entra');

select is(
  (select (public.esteira_fila_enfileirar('ingest_jobs', '{"teste":"pgtap"}'::jsonb, c.chave)) ->> 'motivo'
     from pg_temp_chave c),
  'ja_enfileirado', 'fila: a mesma chave não entra duas vezes (é a esteira funcionando, não erro)');

select is(
  (select count(*)::int from public.ingest_dedup d, pg_temp_chave c
    where d.queue = 'ingest_jobs' and d.idempotency_key = c.chave),
  1, 'fila: uma linha só de idempotência para a chave');

select throws_ok(
  $$select public.esteira_fila_enfileirar('fila_que_nao_existe', '{}'::jsonb, 'x')$$,
  '22023', null, 'fila: fila inexistente é recusada com erro explícito');

select throws_ok(
  $$select public.esteira_fila_enfileirar('ingest_jobs', '{}'::jsonb, '   ')$$,
  '22023', null, 'fila: mensagem sem chave de idempotência não entra na esteira');

select pg_temp.sair();


-- =====================================================================
-- 4. O lote: abrir pelo worker e andar até concluído
-- =====================================================================
select pg_temp.entrar_como_worker();

create temporary table pg_temp_lote (id uuid) on commit drop;
insert into pg_temp_lote
select ((public.esteira_abrir_lote('coleta', pg_temp.fonte('casamentos_com_br'),
                                   'pgtap 21 · lote do coletor')) ->> 'batch_id')::uuid;

select isnt((select id from pg_temp_lote), null,
  'lote: o worker abre lote de coleta (o defeito que impediu a primeira coleta real)');

select is((select b.status from public.import_batches b, pg_temp_lote l where b.id = l.id),
  'previa', 'lote: nasce em prévia');

select is(
  (select (public.esteira_estado_lote(l.id, 'rodando')) ->> 'status' from pg_temp_lote l),
  'rodando', 'lote: o worker move para rodando');

select isnt((select b.started_at from public.import_batches b, pg_temp_lote l where b.id = l.id),
  null, 'lote: rodando carimba started_at');

select is(
  (select (public.esteira_estado_lote(l.id, 'concluido', '{"capturas": 7}'::jsonb)) ->> 'status'
     from pg_temp_lote l),
  'concluido', 'lote: o worker conclui');

select is((select b.stats ->> 'capturas' from public.import_batches b, pg_temp_lote l where b.id = l.id),
  '7', 'lote: as estatísticas da corrida ficam guardadas');

select isnt((select b.finished_at from public.import_batches b, pg_temp_lote l where b.id = l.id),
  null, 'lote: concluído carimba finished_at');

select is(
  (select (public.esteira_estado_lote(l.id, 'desfeito')) ->> 'reason' from pg_temp_lote l),
  'status_invalido', 'lote: desfazer não é trabalho do coletor (só esteira_desfazer_lote desfaz)');

select is(
  (public.esteira_estado_lote('00000000-0000-4000-8000-000000000000', 'rodando')) ->> 'reason',
  'lote_inexistente', 'lote: lote que não existe devolve motivo legível, não exceção');

select pg_temp.sair();


-- =====================================================================
-- 5. O catálogo de coleta e o mapa de categoria são dados
-- =====================================================================
select cmp_ok(
  (select jsonb_array_length(s.config -> 'collector' -> 'catalogo')
     from public.sources s where s.slug = 'casamentos_com_br'),
  '>=', 18, 'catálogo: as 18 listagens de Natal do R03 §2.1 estão em sources.config');

-- Todo caminho do catálogo é uma listagem categoria × cidade, e nenhum cai nos
-- prefixos que o robots.txt da fonte proíbe (R03 §2.1: /json/, /emp-*.php,
-- /busc-*.php, /apps/empresas/). O worker confere o robots de novo a cada
-- corrida; isto aqui impede que um caminho proibido seja CADASTRADO.
select is(
  (select count(*)::int
     from public.sources s,
          jsonb_array_elements(s.config -> 'collector' -> 'catalogo') e
    where s.slug = 'casamentos_com_br'
      and (e ->> 'caminho' !~ '^/[a-z0-9-]+/rio-grande-do-norte/natal$'
        or e ->> 'caminho' ~ '^/(json|apps/empresas)/'
        or e ->> 'caminho' ~ '^/(emp|busc)-')),
  0, 'catálogo: todo caminho é listagem categoria × cidade e nenhum é proibido pelo robots');

select is(
  (select c.slug from public.source_category_map m
     join public.categories c on c.id = m.category_id
    where m.source_id = pg_temp.fonte('casamentos_com_br')
      and m.category_source = 'cerimonialista'),
  'cerimonialistas_assessorias', 'mapa: cerimonialista vira a categoria certa do CRM');

select is(
  (select c.slug from public.source_category_map m
     join public.categories c on c.id = m.category_id
    where m.source_id = pg_temp.fonte('casamentos_com_br')
      and m.category_source = 'espaco-casamento'),
  'locais_saloes_chacaras_hoteis', 'mapa: espaço de casamento vira "Locais"');

select is(
  (select count(*)::int from public.source_category_map m
    where m.source_id = pg_temp.fonte('casamentos_com_br')
      and m.category_source = 'cabine-de-fotos'),
  0, 'mapa: cabine de fotos fica sem mapa DE PROPÓSITO — quem revisa escolhe (regra da 001600)');

select is(
  (select count(*)::int
     from public.sources s,
          jsonb_array_elements(s.config -> 'collector' -> 'catalogo') e
    where s.slug = 'casamentos_com_br'
      and not exists (select 1 from public.source_category_map m
                       where m.source_id = s.id
                         and m.category_source = e ->> 'categoria_origem')),
  1, 'mapa: exatamente uma categoria do catálogo fica sem mapa, e é a cabine de fotos');

select * from finish();
rollback;

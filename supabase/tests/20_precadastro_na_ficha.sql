-- =====================================================================
-- 20 — O pré-cadastro nascendo da ficha (migração 20260904001830)
--
-- Duas funções novas, e uma promessa em cada uma:
--   `app.prefill_da_organizacao`  — só o factual do RF-PRE-03, e SEM TELEFONE;
--   `public.criar_pre_cadastro_da_ficha` — a ficha não escolhe campo, e o
--   guardrail de supressão continua valendo por baixo.
--
-- O que este arquivo NÃO testa de novo: as travas de `criar_pre_cadastro`,
-- `gerar_link_de_reivindicacao`, `abrir_reivindicacao`, `aceitar_reivindicacao`
-- e `recusar_reivindicacao`. Elas são da 20260904001700 e já estão cobertas em
-- `17_cadencias_e_precadastro.sql`; repetir asserção é criar dois lugares para
-- consertar quando a regra mudar.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(35);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
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

create function pg_temp.fonte() returns int language sql as $$
  select id from public.sources where slug = 'captura_campo'
$$;
create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-00000000fc' || p_n)::uuid
$$;
create function pg_temp.categoria(p_n int) returns int language sql as $$
  select id from public.categories where is_active order by id limit 1 offset p_n
$$;

-- Lê o rascunho FORA da RLS: o que interessa aqui é o que ficou gravado,
-- não o que cada papel enxerga (isso é assunto do 17_).
create function pg_temp.rascunho(p_org uuid) returns public.pre_registrations
  language sql security definer set search_path = '' as $$
  select * from public.pre_registrations where organization_id = p_org
$$;
create function pg_temp.n_eventos(p_org uuid, p_evento text) returns int
  language sql security definer set search_path = '' as $$
  select count(*)::int from public.pre_registration_events
   where organization_id = p_org and event = p_evento
$$;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('fic.gestor@teste.local',  'gestor',  'pgTAP pré-cadastro na ficha'),
  ('fic.sdr@teste.local',     'sdr',     'pgTAP pré-cadastro na ficha'),
  ('fic.leitura@teste.local', 'leitura', 'pgTAP pré-cadastro na ficha');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000fc001', 'fic.gestor@teste.local',  '{"full_name":"Gestor Ficha"}'),
  ('a0000000-0000-4000-8000-0000000fc002', 'fic.sdr@teste.local',     '{"full_name":"SDR Ficha"}'),
  ('a0000000-0000-4000-8000-0000000fc003', 'fic.leitura@teste.local', '{"full_name":"Leitura Ficha"}');

-- ---------- fichas ----------
-- A 11 é a ficha cheia: tem TUDO que a whitelist admite e mais o que ela não
-- admite (descrição, faixa de preço, avaliação), justamente para provar o corte.
insert into public.organizations
  (id, name, phone_e164, email, instagram_handle, website, neighborhood, city_id,
   description, price_range, rating, reviews_count, source_id, source_url, owner_id)
values
  (pg_temp.org('11'), 'FICHA Buffet Cheio', '+5584999996011', 'contato@fichacheio.local',
   'fichacheio', 'https://fichacheio.local', 'Tirol',
   (select id from public.cities where name = 'Natal' limit 1),
   'Texto de terceiro copiado de um perfil público', '$$$', 4.70, 812,
   pg_temp.fonte(), 'https://exemplo.local/ficha-cheia', null),
  (pg_temp.org('12'), 'FICHA Só Nome', null, null, null, null, null, null,
   null, null, null, null, pg_temp.fonte(), null, null),
  (pg_temp.org('13'), 'FICHA Suprimida', '+5584999996013', null, null, null, 'Tirol', null,
   null, null, null, null, pg_temp.fonte(), null, null);

insert into public.organization_categories (organization_id, category_id, is_primary) values
  (pg_temp.org('11'), pg_temp.categoria(0), true),
  (pg_temp.org('11'), pg_temp.categoria(1), false);

-- A 13 pediu para não ser procurada. O guardrail vale antes de tudo.
update public.organizations set do_not_contact = true where id = pg_temp.org('13');


-- =====================================================================
-- 1. AS FUNÇÕES EXISTEM, E COM A SUPERFÍCIE CERTA
-- =====================================================================
select has_function('app', 'prefill_da_organizacao', array['uuid'],
                    'app.prefill_da_organizacao existe');
select has_function('public', 'criar_pre_cadastro_da_ficha', array['uuid'],
                    'public.criar_pre_cadastro_da_ficha existe');

select ok(not has_function_privilege('anon', 'app.prefill_da_organizacao(uuid)', 'execute'),
          'anon não monta prefill');
select ok(not has_function_privilege('authenticated', 'app.prefill_da_organizacao(uuid)', 'execute'),
          'nem authenticated: o prefill é peça interna, e ele carrega o que a ficha tem');
select ok(has_function_privilege('service_role', 'app.prefill_da_organizacao(uuid)', 'execute'),
          'o worker monta prefill');

select ok(not has_function_privilege('anon', 'public.criar_pre_cadastro_da_ficha(uuid)', 'execute'),
          'anon não cria rascunho: a página pública não escreve na base');
select ok(has_function_privilege('authenticated', 'public.criar_pre_cadastro_da_ficha(uuid)', 'execute'),
          'quem está logado chama a RPC, e a RPC decide se pode');

select is((select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'criar_pre_cadastro_da_ficha'),
          true, 'a RPC é security definer (a ficha não lê organizations direto)');


-- =====================================================================
-- 2. O PREFILL: SÓ O FACTUAL, E SEM TELEFONE
-- =====================================================================
select is(app.prefill_da_organizacao(pg_temp.org('11')) ->> 'nome_exibicao',
          'FICHA Buffet Cheio', 'prefill leva o nome');
select is(app.prefill_da_organizacao(pg_temp.org('11')) ->> 'cidade',
          'Natal', 'prefill leva a cidade');
select is(app.prefill_da_organizacao(pg_temp.org('11')) ->> 'bairro',
          'Tirol', 'prefill leva o bairro');
select is(app.prefill_da_organizacao(pg_temp.org('11')) ->> 'instagram',
          'fichacheio', 'prefill leva o @');
select is(app.prefill_da_organizacao(pg_temp.org('11')) ->> 'site',
          'https://fichacheio.local', 'prefill leva o site');
select is(jsonb_array_length(app.prefill_da_organizacao(pg_temp.org('11')) -> 'categorias'),
          2, 'prefill leva as categorias, primária na frente');
select is(app.prefill_da_organizacao(pg_temp.org('11')) -> 'categorias' ->> 0,
          (select c.name from public.categories c where c.id = pg_temp.categoria(0)),
          'e a primária é mesmo a primeira');

-- O ponto do arquivo inteiro.
select ok(not (app.prefill_da_organizacao(pg_temp.org('11')) ? 'telefone_comercial'),
          'O TELEFONE NÃO ENTRA no rascunho, mesmo estando na whitelist (RF-BAS-14)');
select ok(not (app.prefill_da_organizacao(pg_temp.org('11')) ? 'descricao_neutra'),
          'texto de terceiro não entra (R03: descrição não é campo de coleta)');
select ok(not (app.prefill_da_organizacao(pg_temp.org('11')) ? 'faixa_preco'),
          'preço copiado não entra');
select ok(app.prefilled_ok(app.prefill_da_organizacao(pg_temp.org('11'))),
          'o prefill inteiro passa na whitelist do RF-PRE-03');
select ok(not (app.prefill_da_organizacao(pg_temp.org('11'))
               ?| array['cpf', 'pix', 'conta_bancaria', 'cnpj_faturamento']),
          'nada de dado sensível (ADR-09)');

-- Ficha vazia: o `jsonb_strip_nulls` não deixa chave com null sobrando.
select is(app.prefill_da_organizacao(pg_temp.org('12')),
          jsonb_build_object('nome_exibicao', 'FICHA Só Nome'),
          'ficha sem nada devolve só o nome, sem chave vazia');
select is(app.prefill_da_organizacao('00000000-0000-4000-8000-0000000000ff'::uuid), null,
          'organização inexistente devolve null, não um objeto vazio');


-- =====================================================================
-- 3. A RPC DA FICHA
-- =====================================================================
select throws_ok($$ select public.criar_pre_cadastro_da_ficha(
                      'c0000000-0000-4000-8000-00000000fc11'::uuid) $$,
                 '42501', 'Usuário não autenticado',
                 'sem sessão a RPC estoura, não devolve objeto');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000fc003', 'leitura');
select is(public.criar_pre_cadastro_da_ficha(pg_temp.org('11')) ->> 'motivo',
          'sem_permissao', 'leitura não cria rascunho');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000fc002', 'sdr');
select is(public.criar_pre_cadastro_da_ficha(pg_temp.org('13')) ->> 'motivo',
          'contato_suprimido',
          'nenhum rascunho nasce para quem pediu para não ser procurado');
select is(public.criar_pre_cadastro_da_ficha('00000000-0000-4000-8000-0000000000ff'::uuid) ->> 'motivo',
          'organizacao_inexistente', 'ficha que não existe recusa com motivo legível');

select is(public.criar_pre_cadastro_da_ficha(pg_temp.org('11')) ->> 'novo', 'true',
          'o SDR cria o rascunho da própria ficha');
select is(public.criar_pre_cadastro_da_ficha(pg_temp.org('11')) ->> 'novo', 'false',
          'chamar de novo atualiza em vez de duplicar (organization_id é único)');
select pg_temp.sair();


-- =====================================================================
-- 4. O QUE FICOU GRAVADO
-- =====================================================================
select is((pg_temp.rascunho(pg_temp.org('11'))).prefilled,
          app.prefill_da_organizacao(pg_temp.org('11')),
          'o que foi gravado é exatamente o que a função monta');
select ok(not ((pg_temp.rascunho(pg_temp.org('11'))).prefilled ? 'telefone_comercial'),
          'e o telefone continua fora depois de gravado');
select is((pg_temp.rascunho(pg_temp.org('11'))).photos_found_count, 0,
          'fotos encontradas = 0: a coleta não copia foto (R03)');
select is((pg_temp.rascunho(pg_temp.org('11'))).source_url,
          'https://exemplo.local/ficha-cheia',
          'a proveniência da ficha viaja para o rascunho (PRE-04, RF-BAS-10)');
select is((pg_temp.rascunho(pg_temp.org('11'))).source_label,
          (select name from public.sources where id = pg_temp.fonte()),
          'e o nome da fonte também, que é o que a página pública mostra');
select is((pg_temp.rascunho(pg_temp.org('11'))).claim_token_hash, null,
          'criar rascunho NÃO emite link: o link é outra porta, e ela exige autorização');
select is(pg_temp.n_eventos(pg_temp.org('11'), 'pre_registration_created'), 2,
          'cada chamada deixa um evento no log de onboarding (R10 §5.2)');

select * from finish();
rollback;

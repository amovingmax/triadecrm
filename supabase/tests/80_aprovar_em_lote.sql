-- =====================================================================
-- pgTAP — Aprovar em lote o que não tem decisão dentro (migração 20261001130000)
--
-- POR QUÊ: em 25/09/2026 a fila tinha 155 candidatos presos, quase todos por um
-- nome de categoria que o CRM não conhecia. Um a um são três cliques por nome
-- vezes 155 — e uma fila desse tamanho é ignorada, e aí as duplicatas de
-- verdade morrem junto com o ruído.
--
-- O que este arquivo tem de provar, e cada item é um jeito de o lote virar um
-- atalho perigoso:
--   1. O LOTE NÃO É UM CAMINHO NOVO DE ESCRITA. Ele laça sobre
--      `public.radar_revisar_candidato`, então herda TUDO: papel, carteira e,
--      sobretudo, a recusa de candidato `do_not_contact`.
--   2. UM SUPRIMIDO NO MEIO NÃO DERRUBA O LOTE, e também não passa. É a
--      asserção que o desenho pediu com estas palavras.
--   3. A CATEGORIA DO LOTE VALE PARA QUEM NÃO TEM. É para isso que ele existe.
--   4. ID REPETIDO NA SELEÇÃO NÃO CONTA DUAS VEZES — senão a tela diria "1 não
--      passou" por um erro que não existe.
--   5. TETO DE 200, e papel `leitura` fora.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(10);

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
create function pg_temp.contratar(p_nome text, p_papel text) returns uuid
language plpgsql as $$
declare
  v_id    uuid  := gen_random_uuid();
  v_email text  := 'pgtap80.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                   || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 80 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  insert into public.profiles (id, full_name, role, is_active)
  values (v_id, p_nome, p_papel::app.user_role, true)
      on conflict (id) do nothing;
  return v_id;
end $$;
create temp table equipe80(papel text primary key, id uuid not null);
insert into equipe80(papel, id)
values ('gestor',  pg_temp.contratar('Oitenta Gestora', 'gestor')),
       ('leitura', pg_temp.contratar('Oitenta Leitura', 'leitura'));
create function pg_temp.quem(p_papel text) returns uuid language sql as $$
  select id from equipe80 where papel = p_papel
$$;

insert into public.sources (id, slug, name, kind, base_url, legal_basis, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values (980, 'z80', 'Z80 Fonte (pgTAP)', 'import', 'https://exemplo80.test',
        'legitimo_interesse', false, 5.00, false, '{"entrada_por_arquivo": true}'::jsonb);

create function pg_temp.cat(p_slug text) returns int language sql stable as $$
  select id from public.categories where slug = p_slug
$$;

create temp table c80(chave text primary key, id uuid not null);
-- As fixtures são criadas como `postgres` e LIDAS dentro da sessão de gestor,
-- que roda como `authenticated`. Sem este grant o teste falha por permissão na
-- própria fixture, e não pelo que quer medir.
grant select on c80, equipe80 to authenticated;

-- Três sem categoria, que é o caso dos 155 presos.
with novos as (
  insert into public.supplier_candidates
    (source_id, external_id, collector, name, phone_e164, city_id, status)
  values (980, 'z80-a', 'pgTAP 80', 'OITENTA ALFA',  '+5584988000001', 1, 'novo'),
         (980, 'z80-b', 'pgTAP 80', 'OITENTA BETA',  '+5584988000002', 1, 'novo'),
         (980, 'z80-c', 'pgTAP 80', 'OITENTA GAMA',  '+5584988000003', 1, 'novo')
  returning id, external_id
)
insert into c80(chave, id) select right(external_id, 1), id from novos;

-- E um que JÁ pediu para não ser procurado: o carimbo da coleta.
with novo as (
  insert into public.supplier_candidates
    (source_id, external_id, collector, name, phone_e164, city_id, status, do_not_contact)
  values (980, 'z80-x', 'pgTAP 80', 'OITENTA SUPRIMIDA', '+5584988000009', 1, 'novo', true)
  returning id
)
insert into c80(chave, id) select 'x', novo.id from novo;


-- =====================================================================
-- 1. Papel, teto e lote vazio
-- =====================================================================
select pg_temp.entrar(pg_temp.quem('leitura'), 'leitura');
select throws_ok(
  $$ select public.radar_revisar_lote(array[gen_random_uuid()]) $$, '42501',
  null, 'papel leitura não aprova em lote — o lote herda o guarda do cartão');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.quem('gestor'), 'gestor');
select is(public.radar_revisar_lote('{}'::uuid[]) ->> 'reason', 'lote_vazio',
          'lote vazio é recusado, e não "aprovado zero"');
select is(public.radar_revisar_lote(
            (select array_agg(gen_random_uuid()) from generate_series(1, 201))) ->> 'reason',
          'lote_grande_demais',
          'teto de 200: um lote que estoura no meio é pior que dois lotes que terminam');
select is(public.radar_revisar_lote(array[(select id from c80 where chave = 'a')], -7) ->> 'reason',
          'categoria_inexistente',
          'categoria que não existe é recusada ANTES de tocar em candidato nenhum');
select pg_temp.sair();


-- =====================================================================
-- 2. O suprimido no meio não passa, e não derruba o lote
-- =====================================================================
select pg_temp.entrar(pg_temp.quem('gestor'), 'gestor');
create temp table l80 as
  select public.radar_revisar_lote(
           array[(select id from c80 where chave = 'a'),
                 (select id from c80 where chave = 'x'),
                 (select id from c80 where chave = 'b')],
           pg_temp.cat('fotografia_video')) as j;
select pg_temp.sair();

select is((select (j ->> 'aprovados')::int from pg_temp.l80), 2,
          'os dois que podiam viraram parceiro');
select is((select (j ->> 'recusados')::int from pg_temp.l80), 1,
          'e o suprimido no meio não derrubou o lote: ele apenas não passou');
select is((select i ->> 'reason'
             from jsonb_array_elements((select j from pg_temp.l80) -> 'itens') i
            where (i ->> 'candidate_id')::uuid = (select id from c80 where chave = 'x')),
          'candidato_nao_contatar',
          'e o relatório diz POR QUE ele não passou, com o nome do motivo');
select is((select c.status::text from public.supplier_candidates c
            where c.id = (select id from c80 where chave = 'x')),
          'novo',
          'quem pediu para não ser procurado continua intocado na fila');


-- =====================================================================
-- 3. A categoria do lote vale, e id repetido não conta duas vezes
-- =====================================================================
select is((select o.id is not null
             from public.organizations o
             join public.organization_categories oc on oc.organization_id = o.id
            where o.name = 'OITENTA ALFA'
              and oc.category_id = pg_temp.cat('fotografia_video')),
          true,
          'a categoria do lote foi aplicada a quem não tinha — é para isso que ele existe');

select pg_temp.entrar(pg_temp.quem('gestor'), 'gestor');
create temp table l80b as
  select public.radar_revisar_lote(
           array[(select id from c80 where chave = 'c'),
                 (select id from c80 where chave = 'c')],
           pg_temp.cat('fotografia_video')) as j;
select pg_temp.sair();

select is(array[(select (j ->> 'aprovados')::int from pg_temp.l80b),
                (select (j ->> 'recusados')::int from pg_temp.l80b)],
          array[1, 0],
          'o mesmo id duas vezes na seleção é um trabalho só, e não um erro a relatar');

select * from finish();
rollback;

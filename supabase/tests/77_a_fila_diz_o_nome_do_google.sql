-- =====================================================================
-- pgTAP — A fila diz como a fonte chamou aquilo (migração 20261001100000)
--
-- POR QUÊ: o cartão da fila escrevia "Sem categoria" e não dizia que o Google
-- tinha chamado aquilo de "Impressões fotográficas". A pessoa adivinhava,
-- cartão por cartão, numa lista de 19 categorias — e por isso os 155 presos na
-- fila em 25/09/2026 eram indecidíveis, não trabalhosos. O texto existe em
-- `public.source_record.category_source` desde 04/09; a fila é que não o
-- devolvia.
--
-- O que este arquivo tem de provar:
--   1. A COLUNA NÃO MULTIPLICA A FILA. Um candidato pode ter VÁRIOS
--      `source_record` — a chave única é (source_id, external_id), e o mesmo
--      negócio chega por duas fontes. Um `join` comum devolveria o candidato
--      duas vezes. Por isso é `lateral … order by last_seen_at desc limit 1`.
--   2. VENCE O MAIS RECENTE. É o que a pessoa acabou de importar, e não o que
--      uma raspagem de três meses atrás chamou aquilo.
--   3. SEM `source_record`, É NULO. Nome cadastrado à mão não tem fonte
--      externa, e string vazia faria o cartão escrever aspas em volta de nada.
--
-- `radar_fila` exige `app.can_write()`: sem sessão, tudo reprova em 42501.
-- Por isso os utilitários de sessão, idênticos aos de 66_o_csv_do_maps.sql.
--
-- NOMES DISJUNTOS DE PROPÓSITO: `radar_fila` filtra por
-- `search_name like '%' || app.search_name(p_q) || '%'` (20260917230100:41), e
-- 'Fixture 77' casaria também com 'Fixture 77 manual'. Daí 'Zeta77 Duasfontes'
-- e 'Zeta77 Semfonte'.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(4);

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
create function pg_temp.contratar(p_nome text, p_papel text) returns uuid
language plpgsql as $$
declare
  v_id    uuid  := gen_random_uuid();
  v_email text  := 'pgtap77.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                   || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 77 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  return v_id;
end $$;
create temp table equipe(papel text primary key, id uuid not null);
insert into equipe(papel, id) values ('admin', pg_temp.contratar('Anastacio Setesete', 'admin'));
create function pg_temp.admin() returns uuid language sql as $$
  select id from equipe where papel = 'admin'
$$;

-- ---------- as fontes e os nomes ----------
-- Ids 977/978 no padrão do 37 e do 66. As duas desligadas: ninguém raspa daqui.
insert into public.sources (id, slug, name, kind, base_url, legal_basis, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values (977, 'z77_a', 'Z77 Fonte A (pgTAP)', 'import', 'https://exemplo77.test',
        'legitimo_interesse', false, 5.00, false, '{"entrada_por_arquivo": true}'::jsonb),
       (978, 'z77_b', 'Z77 Fonte B (pgTAP)', 'import', 'https://exemplo77.test',
        'legitimo_interesse', false, 5.00, false, '{"entrada_por_arquivo": true}'::jsonb);

create temp table z77(chave text primary key, id uuid not null);

-- (a) Um candidato com DOIS source_record, cada um de uma fonte, com
--     `category_source` diferente e `last_seen_at` diferente.
with novo as (
  insert into public.supplier_candidates (source_id, external_id, collector, name, status)
  values (977, 'z77-duas', 'pgTAP 77', 'Zeta77 Duasfontes', 'novo')
  returning id
)
insert into z77(chave, id) select 'duas', novo.id from novo;

insert into public.source_record
  (source_id, external_id, name, category_source, candidate_id, last_seen_at)
values (977, 'z77-duas', 'Zeta77 Duasfontes', 'Loja de artigos para fotografia',
        (select id from z77 where chave = 'duas'), now() - interval '30 days'),
       (978, 'z77-duas-b', 'Zeta77 Duasfontes', 'Impressões fotográficas',
        (select id from z77 where chave = 'duas'), now());

-- (b) Um candidato SEM source_record nenhum: é o nome cadastrado à mão.
with novo as (
  insert into public.supplier_candidates (source_id, external_id, collector, name, status)
  values (977, 'z77-sem', 'pgTAP 77', 'Zeta77 Semfonte', 'novo')
  returning id
)
insert into z77(chave, id) select 'sem', novo.id from novo;

select pg_temp.entrar(pg_temp.admin(), 'admin');

select has_function('public', 'radar_fila', 'radar_fila continua existindo');

select is((select count(*)::int
             from public.radar_fila('novo', null, null, 'Zeta77 Duasfontes', false, 30, 0)),
          1, 'candidato com dois source_record aparece UMA vez na fila');

select is((select f.categoria_na_fonte
             from public.radar_fila('novo', null, null, 'Zeta77 Duasfontes', false, 30, 0) f),
          'Impressões fotográficas',
          'a fila devolve o texto que a FONTE usou, e o mais recente por last_seen_at');

select is((select f.categoria_na_fonte
             from public.radar_fila('novo', null, null, 'Zeta77 Semfonte', false, 30, 0) f),
          null, 'candidato sem source_record devolve nulo, e não string vazia');

select pg_temp.sair();
select * from finish();
rollback;

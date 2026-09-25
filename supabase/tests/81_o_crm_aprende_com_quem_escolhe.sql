-- =====================================================================
-- pgTAP — O CRM aprende com quem escolhe na fila (migração 20261001140000)
--
-- POR QUÊ: quando alguém escolhe a categoria de um nome na fila, o CRM sabe a
-- fonte, o texto que a fonte usou e a categoria escolhida — uma linha de
-- `source_category_map` pronta, que hoje é jogada fora. Na importação seguinte
-- o mesmo rótulo do Google volta a parar na fila.
--
-- Mas erro humano num clique NÃO PODE virar regra permanente que cria ficha
-- errada para sempre. Este arquivo prende os cinco freios, e cada um deles é um
-- jeito de o aprendizado virar um estrago silencioso:
--   1. NUNCA NO PRIMEIRO CLIQUE — e dois cliques da MESMA pessoa também não.
--   2. DISCORDÂNCIA CONGELA: duas pessoas apontando para categorias
--      diferentes não promovem nenhuma das duas.
--   3. VALE SÓ PARA FRENTE: a regra nova não toca em ficha já criada.
--   4. DÁ PARA DESFAZER — e regra SEMEADA não sai pela tela.
--   5. `audit_log` em toda promoção.
-- E mais duas, que são o desenho e não o freio:
--   6. O LOTE NÃO CONTA COMO N DECISÕES. Aprovar 30 em lote é uma decisão
--      humana, não trinta — senão o contador enche de uma vez e o freio 1 vira
--      enfeite.
--   7. A IMPORTAÇÃO NÃO APRENDE. `app.promover_candidato` também é chamada por
--      `importacao_gravar`, onde a categoria veio do próprio mapa.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(14);

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
  v_email text  := 'pgtap81.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                   || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 81 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  insert into public.profiles (id, full_name, role, is_active)
  values (v_id, p_nome, p_papel::app.user_role, true) on conflict (id) do nothing;
  return v_id;
end $$;
create temp table equipe81(papel text primary key, id uuid not null);
insert into equipe81(papel, id)
values ('gestor', pg_temp.contratar('Oitentaum Gestora', 'gestor')),
       ('sdr',    pg_temp.contratar('Oitentaum Sedeerre', 'sdr'));
create function pg_temp.quem(p_papel text) returns uuid language sql as $$
  select id from equipe81 where papel = p_papel
$$;
grant select on equipe81 to authenticated;

insert into public.sources (id, slug, name, kind, base_url, legal_basis, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values (981, 'z81', 'Z81 Fonte (pgTAP)', 'import', 'https://exemplo81.test',
        'legitimo_interesse', false, 5.00, false, '{"entrada_por_arquivo": true}'::jsonb);

create function pg_temp.cat(p_slug text) returns int language sql stable as $$
  select id from public.categories where slug = p_slug
$$;

-- Um candidato novo, com um `source_record` que carrega o rótulo do Google.
create function pg_temp.nascer(p_ext text, p_nome text, p_tel text, p_rotulo text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.supplier_candidates
    (source_id, external_id, collector, name, phone_e164, city_id, status)
  values (981, p_ext, 'pgTAP 81', p_nome, p_tel, 1, 'novo')
  returning id into v_id;
  insert into public.source_record
    (source_id, external_id, name, category_source, candidate_id, last_seen_at)
  values (981, p_ext, p_nome, p_rotulo, v_id, now());
  return v_id;
end $$;

create temp table c81(chave text primary key, id uuid not null);
grant select on c81 to authenticated;
insert into c81(chave, id) values
  ('a', pg_temp.nascer('z81-a', 'OITENTAUM ALFA',  '+5584981000001', 'Impressões fotográficas')),
  ('b', pg_temp.nascer('z81-b', 'OITENTAUM BETA',  '+5584981000002', 'Impressões fotográficas')),
  ('c', pg_temp.nascer('z81-c', 'OITENTAUM GAMA',  '+5584981000003', 'Impressões fotográficas')),
  ('d', pg_temp.nascer('z81-d', 'OITENTAUM DELTA', '+5584981000004', 'Loja de artigos para fotografia')),
  ('e', pg_temp.nascer('z81-e', 'OITENTAUM EPSILON','+5584981000005', 'Loja de artigos para fotografia')),
  -- Três com o MESMO rótulo, para o lote do freio 6.
  ('f', pg_temp.nascer('z81-f', 'OITENTAUM ZETA',  '+5584981000006', 'Centro de diversões infantil')),
  ('g', pg_temp.nascer('z81-g', 'OITENTAUM ETA',   '+5584981000007', 'Centro de diversões infantil')),
  ('h', pg_temp.nascer('z81-h', 'OITENTAUM TETA',  '+5584981000008', 'Centro de diversões infantil')),
  -- Três com o mesmo rótulo, para a caixinha "valer para os outros N".
  ('i', pg_temp.nascer('z81-i', 'OITENTAUM IOTA',  '+5584981000009', 'Serviços para festas infantis')),
  ('j', pg_temp.nascer('z81-j', 'OITENTAUM KAPA',  '+5584981000010', 'Serviços para festas infantis')),
  ('k', pg_temp.nascer('z81-k', 'OITENTAUM LAMBDA','+5584981000011', 'Serviços para festas infantis'));

create function pg_temp.eh_regra(p_texto text, p_slug text) returns boolean
language sql stable as $$
  select exists (select 1 from public.source_category_map m
                  where m.source_id = 981
                    and m.category_source = app.chave_catalogo(p_texto)
                    and m.category_id = pg_temp.cat(p_slug))
$$;


-- =====================================================================
-- Freio 1 — nunca no primeiro clique, e dois da mesma pessoa não bastam
-- =====================================================================
select pg_temp.entrar(pg_temp.quem('sdr'), 'sdr');
select public.radar_revisar_candidato((select id from c81 where chave = 'a'), 'aprovar',
                                      null, pg_temp.cat('fotografia_video'));
select pg_temp.sair();

select ok(not pg_temp.eh_regra('Impressões fotográficas', 'fotografia_video'),
          'um clique NÃO vira regra: erro humano não pode criar ficha errada para sempre');
select is((select p.vezes from public.source_category_proposta p
            where p.source_id = 981
              and p.category_source = app.chave_catalogo('Impressões fotográficas')),
          1, 'mas a proposta fica registrada, com a conta');

select pg_temp.entrar(pg_temp.quem('sdr'), 'sdr');
select public.radar_revisar_candidato((select id from c81 where chave = 'b'), 'aprovar',
                                      null, pg_temp.cat('fotografia_video'));
select pg_temp.sair();

select ok(not pg_temp.eh_regra('Impressões fotográficas', 'fotografia_video'),
          'dois cliques da MESMA pessoa também não viram regra — o freio é sobre concordância, não sobre teimosia');

select pg_temp.entrar(pg_temp.quem('gestor'), 'gestor');
select public.radar_revisar_candidato((select id from c81 where chave = 'c'), 'aprovar',
                                      null, pg_temp.cat('fotografia_video'));
select pg_temp.sair();

select ok(pg_temp.eh_regra('Impressões fotográficas', 'fotografia_video'),
          'à terceira escolha a regra é promovida');
select is((select m.origem from public.source_category_map m
            where m.source_id = 981
              and m.category_source = app.chave_catalogo('Impressões fotográficas')),
          'aprendido', 'e nasce marcada como aprendida, e não semeada');
select ok((select exists (select 1 from public.audit_log a
                           where a.action = 'APRENDER_CATEGORIA'
                             and a.row_id = '981|impressoes fotograficas')),
          'freio 5: toda promoção fica no audit_log');


-- =====================================================================
-- Freio 2 — discordância congela
-- =====================================================================
-- Duas pessoas, dois destinos, para o MESMO rótulo. Nenhuma promove.
select pg_temp.entrar(pg_temp.quem('sdr'), 'sdr');
select public.radar_revisar_candidato((select id from c81 where chave = 'd'), 'aprovar',
                                      null, pg_temp.cat('fotografia_video'));
select pg_temp.sair();
select pg_temp.entrar(pg_temp.quem('gestor'), 'gestor');
select public.radar_revisar_candidato((select id from c81 where chave = 'e'), 'aprovar',
                                      null, pg_temp.cat('doces_bolos_confeitaria'));
select pg_temp.sair();

select is((select count(*)::int from public.source_category_map m
            where m.source_id = 981
              and m.category_source = app.chave_catalogo('Loja de artigos para fotografia')),
          0,
          'freio 2: duas pessoas discordando não promovem nenhuma das duas — um humano desempata');


-- =====================================================================
-- Freio 3 e 4 — vale só para frente, e dá para desfazer
-- =====================================================================
select is((select o.id is not null from public.organizations o
            where o.name = 'OITENTAUM ALFA'),
          true,
          'freio 3: a ficha criada ANTES da regra continua de pé — a regra vale para frente');

select pg_temp.entrar(pg_temp.quem('sdr'), 'sdr');
select throws_ok(
  $$ select public.source_category_esquecer(981, 'Impressões fotográficas') $$, '42501',
  null, 'esquecer uma regra é de gestor, e não de quem a ensinou');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.quem('gestor'), 'gestor');
create temp table esq81 as
  select public.source_category_esquecer(981, 'Impressões Fotográficas') as j;
select pg_temp.sair();

select is(array[(select j ->> 'ok' from pg_temp.esq81),
                (select count(*)::text from public.source_category_map m
                  where m.source_id = 981
                    and m.category_source = app.chave_catalogo('Impressões fotográficas')),
                (select count(*)::text from public.source_category_proposta p
                  where p.source_id = 981
                    and p.category_source = app.chave_catalogo('Impressões fotográficas'))],
          array['true', '0', '0'],
          'freio 4: esquecer apaga a regra E a proposta — senão a próxima escolha a reergueria cheia');

-- Regra SEMEADA é decisão de produto e sai por migração, não pela tela: deixar
-- a tela apagá-la faria a próxima `db reset` trazê-la de volta sem aviso.
select pg_temp.entrar(pg_temp.quem('gestor'), 'gestor');
select is(public.source_category_esquecer(
            (select id from public.sources where slug = 'google_maps_raspado'),
            'fotógrafo') ->> 'reason',
          'regra_semeada',
          'e regra semeada não sai pela tela: ela volta na próxima migração');
select pg_temp.sair();


-- =====================================================================
-- Freio 6 — um lote é UMA decisão humana, não N
-- =====================================================================
-- Sem isto o contador encheria de uma vez e a regra seria promovida no mesmo
-- clique: o freio 1 viraria enfeite, e bastaria marcar tudo e apertar para
-- ensinar ao CRM qualquer coisa.
select pg_temp.entrar(pg_temp.quem('gestor'), 'gestor');
select public.radar_revisar_lote(
         array[(select id from c81 where chave = 'f'),
               (select id from c81 where chave = 'g'),
               (select id from c81 where chave = 'h')],
         pg_temp.cat('buffet_infantil_casa_de_festas'));
select pg_temp.sair();

select is(array[
    (select count(*)::text from public.source_category_map m
      where m.source_id = 981
        and m.category_source = app.chave_catalogo('Centro de diversões infantil')),
    (select count(*)::text from public.source_category_proposta p
      where p.source_id = 981
        and p.category_source = app.chave_catalogo('Centro de diversões infantil')),
    (select count(*)::text from public.organizations o
      where o.name in ('OITENTAUM ZETA', 'OITENTAUM ETA', 'OITENTAUM TETA'))],
  array['0', '0', '3'],
  'freio 6: o lote aprovou os três e NÃO ensinou nada — três aprovações num clique não são três concordâncias');


-- =====================================================================
-- A caixinha "valer para os outros N": consentimento explícito
-- =====================================================================
-- Ela PULA o contador de propósito — quem marca está vendo o rótulo e a
-- categoria lado a lado, e isso vale mais que três cliques cegos. E o número
-- que a tela promete vem de um `count` real: prometer 2 e mexer em 5 seria
-- pior que não oferecer.
select pg_temp.entrar(pg_temp.quem('gestor'), 'gestor');
select is(public.radar_irmas_pelo_rotulo((select id from c81 where chave = 'i')) ->> 'outros',
          '2', 'a caixinha promete o número que um count real devolveu');

create temp table ag81 as
  select public.radar_revisar_candidato((select id from c81 where chave = 'i'), 'aprovar',
                                        null, pg_temp.cat('buffet_infantil_casa_de_festas'),
                                        null, true) as j;
select pg_temp.sair();

select is(array[
    (select (j -> 'aprendizado' ->> 'virou_regra') from pg_temp.ag81),
    (select (j -> 'irmas' ->> 'aprovados') from pg_temp.ag81),
    (select count(*)::text from public.organizations o
      where o.name in ('OITENTAUM IOTA', 'OITENTAUM KAPA', 'OITENTAUM LAMBDA'))],
  array['true', '2', '3'],
  'marcada, ela grava a regra na hora E aprova os outros dois pelo mesmo caminho do cartão');

select * from finish();
rollback;

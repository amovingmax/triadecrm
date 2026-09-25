-- =====================================================================
-- pgTAP — A prévia para de mentir (migração 20261001110000)
--
-- POR QUÊ: nas 40 linhas de `listas/` de 25/09/2026 a prévia prometeu "entra"
-- para linhas que a gravação recusou, e fundiu duas empresas que o Google
-- lista como dois lugares. Três defeitos, medidos, e um teste para cada:
--
--   1. O SITE FALTAVA NA PRÉVIA. `app.resolver_source_record` passava
--      `website` a `app.find_org_matches`; `public.importacao_previa`, não.
--      Domínio igual vale 0,90 na dedup — a prévia prometia o contrário do que
--      a gravação faria, que é o defeito que uma prévia existe para não ter.
--   2. `keepo.io` NÃO ERA HOST COMPARTILHADO. As duas "Show Fotografias" têm
--      cid, telefone e endereço diferentes e o MESMO `keepo.io/...`. Link na
--      bio não identifica empresa: consertar (1) sem (2) trocaria uma mentira
--      por outra — prometer duplicata onde há duas empresas.
--   3. DOIS `place_id` QUE DIFEREM SÃO DOIS NEGÓCIOS. "Doce Sabor Buffet" e
--      "Luz da Festa Kids" dividem o (84) 99988-0963 e têm cid diferentes; o
--      bloco (3) casou por celular e pendurou o `source_record` de um no
--      candidato do outro. A trava do bloco (4) não alcança: ela exige mais de
--      três candidatos no mesmo número, e aqui são dois.
--
-- O que este arquivo NÃO afrouxa: a esteira do ADR-08 continua inteira — cada
-- `source_record` vira candidato, com proveniência campo a campo. O que muda é
-- em QUANTOS candidatos eles caem.
--
-- Nomes e domínios próprios (sufixo P78 / `.invalid`): este banco tem operação
-- real dentro, e um vizinho de fixture faria a asserção passar pelo motivo
-- errado. Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(9);

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
  v_email text  := 'pgtap78.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                   || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 78 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  return v_id;
end $$;
create temp table equipe78(papel text primary key, id uuid not null);
insert into equipe78(papel, id) values ('admin', pg_temp.contratar('Anastacio Setoito', 'admin'));
create function pg_temp.admin() returns uuid language sql as $$
  select id from equipe78 where papel = 'admin'
$$;

-- A fonte de arquivo deste teste, desligada: ninguém raspa daqui.
insert into public.sources (id, slug, name, kind, base_url, legal_basis, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values (988, 'z78', 'Z78 Fonte (pgTAP)', 'import', 'https://exemplo78.test',
        'legitimo_interesse', false, 5.00, false, '{"entrada_por_arquivo": true}'::jsonb);


-- =====================================================================
-- 1. Link na bio não é chave de dedup
-- =====================================================================
select ok(app.is_shared_web_host('keepo.io'),
          'keepo.io entra na lista de host compartilhado: é link na bio, como linktr.ee');
select ok(app.is_shared_web_host('bio.link') and app.is_shared_web_host('campsite.bio'),
          'bio.link e campsite.bio entram junto, pela mesma razão');
select ok(not app.is_shared_web_host('showfotografias.com.br'),
          'e um domínio próprio continua sendo chave');


-- =====================================================================
-- 2. Duas empresas com o mesmo keepo.io continuam duas
-- =====================================================================
-- É a asserção que impede o conserto (1) de virar um defeito novo: com o site
-- na prévia e keepo.io fora da lista, estas duas linhas fundiriam.
insert into public.organizations (kind, name, website, source_id, collector)
values ('fornecedor', 'SHOW P78 UNIDADE NATAL', 'https://keepo.io/showp78', 988, 'pgTAP 78');

select pg_temp.entrar(pg_temp.admin(), 'admin');
create temp table t78_bio as
  select public.importacao_previa(jsonb_build_array(jsonb_build_object(
           'linha',     1,
           'nome',      'QRTZ P78 ESCRITORIO',
           'whatsapp',  '84 97788-0011',
           'site',      'https://keepo.io/showp78',
           'categoria', 'Fotografia e vídeo',
           'cidade',    'Natal',
           'origem',    'Z78 Fonte (pgTAP)'))) as j;
select pg_temp.sair();

select is((select l ->> 'decisao'
             from jsonb_array_elements((select j from pg_temp.t78_bio) -> 'linhas') l),
          'entra',
          'o mesmo link na bio NÃO funde duas empresas: keepo.io não é chave');


-- =====================================================================
-- 3. O domínio próprio, esse sim, a prévia enxerga
-- =====================================================================
-- Nomes dissemelhantes de propósito (QRTZ / VBNM): quem tem de responder aqui
-- é a regra de domínio (0,90), não a de nome por trigram.
insert into public.organizations (kind, name, website, source_id, collector)
values ('fornecedor', 'VBNM P78 FICHA ANTIGA', 'https://dominioproprio78.invalid/contato',
        988, 'pgTAP 78');

select pg_temp.entrar(pg_temp.admin(), 'admin');
create temp table t78_dom as
  select public.importacao_previa(jsonb_build_array(jsonb_build_object(
           'linha',     1,
           'nome',      'QRTZ P78 NOME DE HOJE',
           'whatsapp',  '84 97788-0022',
           'site',      'https://www.dominioproprio78.invalid/',
           'categoria', 'Fotografia e vídeo',
           'cidade',    'Natal',
           'origem',    'Z78 Fonte (pgTAP)'))) as j;
select pg_temp.sair();

select is(array[
    (select l ->> 'decisao'
       from jsonb_array_elements((select j from pg_temp.t78_dom) -> 'linhas') l),
    (select l -> 'duplicata' ->> 'chave'
       from jsonb_array_elements((select j from pg_temp.t78_dom) -> 'linhas') l),
    (select l -> 'duplicata' ->> 'nome'
       from jsonb_array_elements((select j from pg_temp.t78_dom) -> 'linhas') l)],
  array['duplicata', 'domain', 'VBNM P78 FICHA ANTIGA'],
  'a prévia vê o domínio, diz qual chave casou e de quem é a ficha — como a gravação já via');


-- =====================================================================
-- 4. Dois lugares do Google, um telefone só
-- =====================================================================
-- O caso literal de 25/09: mesmo celular, `place_id` diferentes. Antes desta
-- migração o segundo `source_record` se pendurava no candidato do primeiro.
insert into public.source_record (source_id, external_id, name, phone_e164, place_id)
values (988, 'p78-lugar-a', 'DOCE P78 BUFFET',   '+5584999880963', 'CID-P78-A'),
       (988, 'p78-lugar-b', 'LUZ P78 FESTA KIDS','+5584999880963', 'CID-P78-B');

create temp table t78_a as
  select app.resolver_source_record(
           (select id from public.source_record where external_id = 'p78-lugar-a')) as j;
create temp table t78_b as
  select app.resolver_source_record(
           (select id from public.source_record where external_id = 'p78-lugar-b')) as j;

select is((select j ->> 'criado' from pg_temp.t78_a), 'true',
          'o primeiro lugar cria candidato');
select is((select j ->> 'criado' from pg_temp.t78_b), 'true',
          'o segundo lugar cria OUTRO candidato: dois place_id que diferem são dois negócios');
select ok((select 'telefone_compartilhado' = any (c.flags)
             from public.supplier_candidates c
            where c.id = ((select j from pg_temp.t78_b) ->> 'candidate_id')::uuid),
          'e o candidato nasce marcado, para quem revisa saber por que há dois nomes no mesmo número');

-- A trava é ESTREITA de propósito: sem `place_id` do lado do candidato, o
-- celular continua sendo chave determinística. Afrouxar aqui encheria a fila
-- de duplicata de novo.
insert into public.source_record (source_id, external_id, name, phone_e164)
values (988, 'p78-sem-lugar', 'DOCE P78 SEM CID', '+5584999880963');
select is(app.resolver_source_record(
            (select id from public.source_record where external_id = 'p78-sem-lugar')) ->> 'criado',
          'false',
          'sem place_id dos dois lados, o celular continua fundindo — a trava não é um afrouxamento');

select * from finish();
rollback;

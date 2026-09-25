-- =====================================================================
-- pgTAP — A pergunta passa a ser por categoria (migração 20261001120000)
--
-- POR QUÊ: nas 40 linhas de `listas/` de 25/09/2026 o CRM pediu 36 decisões,
-- uma por linha, sobre 13 nomes distintos de categoria. Decidir por NOME são
-- 13 respostas, uma vez. Este arquivo prende as três peças que tornam isso
-- possível no banco.
--
-- O que tem de ser verdade:
--   1. A SUGESTÃO CASA PALAVRA, NÃO FRASE. "Impressões fotográficas" e "Loja
--      de artigos para fotografia" apontam para Fotografia e vídeo pelo
--      radical `fotogr`; "Loja de Presentes" não aponta para nada, que é a
--      resposta certa. Com o limiar de 0,55 da queda difusa, NENHUM dos dois
--      primeiros chegava lá.
--   2. EMPATE É NULO. "Buffet de casamento" casa `buffet` com os DOIS buffets
--      do catálogo. Escolher um ali põe infantil no funil de adulto, e alguém
--      abre conversa com o pitch errado.
--   3. A PRÉVIA AGRUPA POR NOME, com as empresas à vista — porque "Loja de
--      Presentes" é a PICMIMOS, que revela foto, e sem ver a empresa a pessoa
--      descarta lead bom pelo rótulo do Google.
--   4. QUEM ENSINA É `app.can_write()`, COM AUDITORIA (decisão 1 do Rafael).
--      A Heloísa é `sdr`: sem isso ela importa, a fila enche, e ela não pode
--      ensinar. `leitura` continua fora.
--   5. "NÃO SEI" NÃO ESCREVE. Par sem categoria não vira regra: a linha vai
--      para a fila, com o nome da fonte no cartão.
--   6. A CHAVE É GRAVADA NORMALIZADA, e ensinar de novo CORRIGE em vez de
--      estourar a PK.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(16);

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
  v_email text  := 'pgtap79.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                   || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 79 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  return v_id;
end $$;
create temp table equipe79(papel text primary key, id uuid not null);
insert into equipe79(papel, id)
values ('sdr',     pg_temp.contratar('Setenove Sedeerre', 'sdr')),
       ('leitura', pg_temp.contratar('Setenove Leitura', 'leitura'));
create function pg_temp.quem(p_papel text) returns uuid language sql as $$
  select id from equipe79 where papel = p_papel
$$;

-- A fonte deste teste. Desligada: ninguém raspa daqui.
insert into public.sources (id, slug, name, kind, base_url, legal_basis, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values (979, 'z79', 'Z79 Fonte (pgTAP)', 'import', 'https://exemplo79.test',
        'legitimo_interesse', false, 5.00, false, '{"entrada_por_arquivo": true}'::jsonb);

create function pg_temp.cat(p_slug text) returns int language sql stable as $$
  select id from public.categories where slug = p_slug
$$;

-- A fonte já sabe uma palavra, como a do Maps sabe: é o que faz a linha do
-- "Fotógrafo" virar parceiro sem pergunta, e é contra ela que se mede quantos
-- nomes SOBRAM.
insert into public.source_category_map (source_id, category_source, category_id)
values (979, app.chave_catalogo('Fotógrafo'), pg_temp.cat('fotografia_video'));


-- =====================================================================
-- 1. A sugestão casa palavra, e não frase
-- =====================================================================
select is(app.categoria_por_radical('Impressões fotográficas'), pg_temp.cat('fotografia_video'),
          'o radical fotogr leva "Impressões fotográficas" a Fotografia e vídeo');
select is(app.categoria_por_radical('Loja de artigos para fotografia'), pg_temp.cat('fotografia_video'),
          'e leva "Loja de artigos para fotografia" ao mesmo lugar — o nome da empresa é que salva o lead');
select is(app.categoria_por_radical('Loja de Presentes'), null,
          '"Loja de Presentes" não aponta para nada, e não apontar É a resposta certa');
select is(app.categoria_por_radical('Buffet de casamento'), null,
          'empate entre os dois buffets vale como "não sei": palpite aqui põe infantil no funil de adulto');
select is(app.categoria_por_radical('de e com para'), null,
          'palavra de menos de seis letras não casa nada — senão "de" casaria tudo com tudo');


-- =====================================================================
-- 2. A prévia agrupa por nome, com as empresas à vista
-- =====================================================================
create function pg_temp.linha(p_linha int, p_nome text, p_cat text, p_tel text)
returns jsonb language sql stable as $$
  select jsonb_build_object('linha', p_linha, 'nome', p_nome, 'categoria', p_cat,
                            'whatsapp', p_tel, 'cidade', 'Natal',
                            'origem', 'Z79 Fonte (pgTAP)')
$$;

select pg_temp.entrar(pg_temp.quem('sdr'), 'sdr');
create temp table p79 as
  select public.importacao_previa(jsonb_build_array(
           pg_temp.linha(2, 'XPTO79 PROALBUNS',  'Impressões fotográficas', '84 97799-0001'),
           pg_temp.linha(3, 'XPTO79 FOTOGRAFE',  'Impressões fotográficas', '84 97799-0002'),
           pg_temp.linha(4, 'XPTO79 PICMIMOS',   'Loja de Presentes',       '84 97799-0003'),
           pg_temp.linha(5, 'XPTO79 CLICK',      'Fotógrafo',               '84 97799-0004'))) as j;
select pg_temp.sair();

select is((select jsonb_array_length((select j from pg_temp.p79) -> 'categorias_novas')),
          2, 'quatro linhas, dois nomes novos: a pergunta é por nome, não por linha');

select is((select g ->> 'nome_na_fonte'
             from jsonb_array_elements((select j from pg_temp.p79) -> 'categorias_novas') g
            limit 1),
          'Impressões fotográficas',
          'o grupo que destrava mais linhas vem primeiro');

select is((select (g ->> 'linhas')::int
             from jsonb_array_elements((select j from pg_temp.p79) -> 'categorias_novas') g
            where g ->> 'nome_na_fonte' = 'Impressões fotográficas'),
          2, 'e ele conta as duas linhas que dependem dele');

select is((select g -> 'exemplos'
             from jsonb_array_elements((select j from pg_temp.p79) -> 'categorias_novas') g
            where g ->> 'nome_na_fonte' = 'Loja de Presentes'),
          '["XPTO79 PICMIMOS"]'::jsonb,
          'os nomes das empresas vêm junto: é por eles que se descobre que a loja de presentes revela foto');

select is((select g ->> 'sugestao_nome'
             from jsonb_array_elements((select j from pg_temp.p79) -> 'categorias_novas') g
            where g ->> 'nome_na_fonte' = 'Impressões fotográficas'),
          'Fotografia e vídeo', 'a sugestão por radical chega junto do grupo');

select is((select l ->> 'categoria_origem'
             from jsonb_array_elements((select j from pg_temp.p79) -> 'linhas') l
            where (l ->> 'linha')::int = 4),
          'Loja de Presentes',
          'e cada linha carrega o texto cru da fonte, que é o que o cartão da fila mostra');


-- =====================================================================
-- 3. Quem ensina, e o que fica gravado
-- =====================================================================
select pg_temp.entrar(pg_temp.quem('leitura'), 'leitura');
select throws_ok(
  $$ select public.importacao_mapear_categorias(979, '[]'::jsonb) $$, '42501',
  null, 'papel leitura não ensina categoria ao CRM');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.quem('sdr'), 'sdr');
create temp table e79 as
  select public.importacao_mapear_categorias(979, jsonb_build_array(
           jsonb_build_object('nome_na_fonte', 'Impressões Fotográficas',
                              'categoria_id', pg_temp.cat('fotografia_video')),
           -- "não sei": vem da tela sem categoria e NÃO pode virar regra.
           jsonb_build_object('nome_na_fonte', 'Loja de Presentes',
                              'categoria_id', null))) as j;
select pg_temp.sair();

select is((select (j ->> 'gravadas')::int from pg_temp.e79), 1,
          'ensinar grava só o par que tem categoria: "não sei" vai para a fila, não para o mapa');

select ok((select exists (select 1 from public.source_category_map m
                           where m.source_id = 979
                             and m.category_source = 'impressoes fotograficas')),
          'a chave é gravada normalizada — é o que faz a PK recusar a segunda grafia sozinha');

select ok((select exists (select 1 from public.audit_log a
                           where a.action = 'ENSINAR_CATEGORIA'
                             and a.row_id = '979|impressoes fotograficas'
                             and a.actor_id = pg_temp.quem('sdr'))),
          'e fica gravado quem ensinou o quê: curadoria é decisão auditável');

-- Ensinar de novo o mesmo nome com outro destino é CORREÇÃO, não erro.
select pg_temp.entrar(pg_temp.quem('sdr'), 'sdr');
create temp table e79b as
  select public.importacao_mapear_categorias(979, jsonb_build_array(
           jsonb_build_object('nome_na_fonte', 'impressões fotográficas',
                              'categoria_id', pg_temp.cat('doces_bolos_confeitaria')))) as j;
select pg_temp.sair();

select is(array[
    (select (j -> 'pares' -> 0 ->> 'corrigiu') from pg_temp.e79b),
    (select count(*)::text from public.source_category_map m
      where m.source_id = 979 and m.category_source like 'impressoes%')],
  array['true', '1'],
  'a segunda grafia CORRIGE a regra em vez de virar uma segunda linha no mapa');

select * from finish();
rollback;

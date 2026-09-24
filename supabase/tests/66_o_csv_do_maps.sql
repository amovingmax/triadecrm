-- =====================================================================
-- pgTAP — O CSV do Google Maps entra pela importação (migração 20260924130000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. O ENDEREÇO NÃO É PALPITE. `app.endereco_br` lê bairro, cidade e CEP de
--      uma coluna só e devolve NULO em tudo que não casou. O Google não
--      garante formato nenhum (MEI que atende em casa, rodovia, ponto de
--      referência): bairro inventado não estraga a ficha, estraga a visita de
--      quem for até lá.
--   2. O PAYLOAD DEIXOU DE SER ESTREITO. `app.importacao_normalizar` passa de
--      9 para 15 chaves, todas já dentro da whitelist do R06 SCR-01 —
--      `place_id`, `email`, `endereco`, `cep`, `nota` e `avaliacoes_qtd` já
--      tinham coluna em `public.source_record` e eram jogados fora na porta.
--      E a 16ª chave reprova o payload INTEIRO: a whitelist não é por campo.
--   3. A IDENTIDADE NA FONTE É O LUGAR, NÃO O TELEFONE. O telefone do Maps
--      muda; o `cid` não. Havendo `place_id`, ele é o `external_id`.
--   4. O MAPA DE CATEGORIAS VEM ANTES DA QUEDA DIFUSA. `app.importacao_categoria`
--      casa por trigrama a partir de 0,55; rodando primeiro, produziria
--      `categoria_aproximada` em cima de um palpite sobre uma categoria que o
--      mapa da fonte já sabia de cor.
--   5. O CPF NÃO CHEGA NA `raw_capture`. `public.esteira_gravar_captura` grava
--      o payload CRU (`app.payload_e_permitido` confere nome de chave, não
--      valor) e o gatilho que limpa CPF só roda um passo adiante, em
--      `source_record` (`20260904001600:624-643`). Com `endereco` no payload, a
--      limpeza tem de acontecer ANTES, dentro de `app.importacao_normalizar`
--      (ADR-09, RF-BAS-16). CONSEQUÊNCIA MEDIDA AQUI: o gatilho deixa de ver o
--      CPF, e com ele somem a flag `cpf_descartado` do `source_record` e a
--      linha de `field_provenance` com `reason = 'cpf'`. É dívida escrita, não
--      descuido — a asserção que a fixa diz o que fazer a respeito.
--
-- A REDE É O ARQUIVO 22. `app.importacao_normalizar` é chamada por
-- `public.importacao_previa` E por `public.importacao_gravar`, e a
-- planilha-ponte continua entrando pelas duas.
-- `supabase/tests/22_importacao_de_planilha.sql` (plan(73)) NÃO é tocado por
-- esta migração: é ele quem acusa, no mesmo `pnpm db:test`, se a planilha
-- comum quebrar.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada: este banco
-- tem operação real dentro. Tudo é delta ou escopo por lote deste arquivo.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(32);

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

-- ---------- quem importa (fixture, e não gente de verdade) ----------
-- `public.importacao_previa` e `public.importacao_gravar` exigem `app.can_write()`,
-- e um banco recém-resetado não tem NENHUM perfil: `supabase/seed.sql` semeia
-- `allowed_users`, não `auth.users`. O caminho é o mesmo do login real
-- (RF-ADM-01) e o `rollback` desfaz tudo. Sobrenome impossível na operação.
create function pg_temp.contratar(p_nome text, p_papel text) returns uuid
language plpgsql as $$
declare
  v_id    uuid  := gen_random_uuid();
  v_email text  := 'pgtap66.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                   || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 66 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  return v_id;
end $$;
create temp table equipe(papel text primary key, id uuid not null);
insert into equipe(papel, id) values ('admin', pg_temp.contratar('Anastacio Pgtap', 'admin'));
create function pg_temp.admin() returns uuid language sql as $$
  select id from equipe where papel = 'admin'
$$;
grant select on equipe to authenticated;

-- ---------- a fonte e o mapa de categorias DESTE arquivo ----------
-- A fonte de produção `google_maps_raspado` nasce numa seção posterior DESTA
-- MESMA migração (§3.2 item 6), escrita pela Tarefa 5 deste plano. Aqui ela é
-- fixture, para o arquivo não depender da ordem das tarefas.
-- O id 966 segue o padrão do 37_a_coleta_cabe_num_botao.sql (937–940).
insert into public.sources (id, slug, name, kind, base_url, legal_basis, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values (966, 'c66_maps', 'C66 Maps (pgTAP)', 'import', 'https://www.google.com/maps',
        'legitimo_interesse', false, 5.00, false,
        '{"collector": {"kind": "externo", "phase": "mvp", "enabled": false},
          "entrada_por_arquivo": true}'::jsonb);

insert into public.source_category_map (source_id, category_source, category_id)
select 966, m.chave, c.id
  from (values
          ('buffet', 'buffet_adulto_corporativo'),
          -- A chave que PROVA a ordem: este rótulo casa por trigrama com
          -- "Celebrante, beleza, convites, transfer, segurança, staff" — o
          -- arquivo 22 mede esse casamento (linhas 186-188). Se
          -- `app.importacao_categoria` rodasse primeiro, a linha viria
          -- APROXIMADA e na categoria errada.
          ('outros serviços (celebrante, beleza, convites, transfer, seguranca, staff)',
           'fotografia_video')
       ) as m(chave, slug_crm)
  join public.categories c on c.slug = m.slug_crm;

-- ---------- a linha do Maps ----------
create function pg_temp.linha_maps(p_extra jsonb default '{}'::jsonb) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'linha',          2,
    'nome',           'BUFFET C66 PGTAP',
    'whatsapp',       '84 98800-0166',
    'categoria',      'buffet',
    'origem',         'C66 Maps (pgTAP)',
    'origem_detalhe', 'https://www.google.com/maps/place/?q=place_id:C66PGTAP',
    'place_id',       'C66-CID-PGTAP',
    'email',          'contato@buffetc66.invalid; financeiro@buffetc66.invalid',
    'endereco',       'Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095',
    'nota',           '4,7',
    'avaliacoes_qtd', '238',
    'site',           'https://buffetc66.invalid',
    -- CNPJ e @ não vêm do CSV do Maps; entram aqui porque a MESMA função serve
    -- à planilha-ponte, e é com os 15 campos preenchidos que se conta o payload.
    'cnpj',           '11222333000181',
    'instagram',      '@buffetc66') || p_extra
$$;

create function pg_temp.aviso(p jsonb, p_aviso text) returns boolean language sql as $$
  select coalesce(p -> 'avisos', '[]'::jsonb) @> jsonb_build_array(p_aviso)
$$;

-- =====================================================================
-- 1. O endereço numa coluna só vira três campos (§3.2 item 1)
-- =====================================================================
select is(
  app.endereco_br('Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095'),
  '{"bairro": "Capim Macio", "cidade": "Natal", "cep": "59082-095"}'::jsonb,
  'endereço completo: bairro, cidade e CEP saem os três');

select is(
  app.endereco_br('Av. Eng. Roberto Freire, Natal - RN, 59082-095'),
  '{"bairro": null, "cidade": "Natal", "cep": "59082-095"}'::jsonb,
  'sem bairro: o pedaço anterior ao da cidade não tem " - ", então bairro é nulo');

select is(
  app.endereco_br('Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN'),
  '{"bairro": "Capim Macio", "cidade": "Natal", "cep": null}'::jsonb,
  'sem CEP: os outros dois continuam saindo');

select is(
  app.endereco_br('Loja no calçadão, perto da praia'),
  '{"bairro": null, "cidade": null, "cep": null}'::jsonb,
  'endereço que não casa com nada volta todo nulo: aqui não se palpita');

select is(
  app.endereco_br('R. Pedro Velho, 500 - Petrópolis, Natal - RN, 59012310'),
  '{"bairro": "Petrópolis", "cidade": "Natal", "cep": "59012-310"}'::jsonb,
  'CEP sem hífen sai normalizado em NNNNN-NNN');

-- =====================================================================
-- 2. O payload de uma linha do Maps (§3.5 teste 2)
-- =====================================================================
select is(
  (select array_agg(k order by k collate "C")
     from jsonb_object_keys(app.importacao_normalizar(pg_temp.linha_maps()) -> 'payload') k),
  array['avaliacoes_qtd','bairro','categoria_origem','cep','cidade','cnpj','email',
        'endereco','instagram','nome_comercial','nota','place_id','site','source_url',
        'telefones'],
  'o payload sai de 9 para 15 chaves, e são exatamente estas');

select ok(app.payload_e_permitido(app.importacao_normalizar(pg_temp.linha_maps()) -> 'payload'),
          'e as 15 passam na whitelist do R06 SCR-01, sem ampliar a lista');

-- Os campos novos NO TOPO: `importacao_previa` e `importacao_gravar` leem
-- `v_n ->> '<campo>'` e nunca abrem o payload.
select is(
  (select jsonb_build_object(
            'place_id',       n ->> 'place_id',
            'email',          n ->> 'email',
            'endereco',       n ->> 'endereco',
            'cep',            n ->> 'cep',
            'nota',           n ->> 'nota',
            'avaliacoes_qtd', n ->> 'avaliacoes_qtd',
            'bairro',         n ->> 'bairro',
            'cidade_nome',    n ->> 'cidade_nome')
     from (select app.importacao_normalizar(pg_temp.linha_maps()) as n) x),
  jsonb_build_object(
    'place_id',       'C66-CID-PGTAP',
    'email',          'contato@buffetc66.invalid',
    'endereco',       'Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095',
    'cep',            '59082-095',
    'nota',           '4.7',
    'avaliacoes_qtd', '238',
    'bairro',         'Capim Macio',
    'cidade_nome',    'Natal'),
  'os campos novos vêm no TOPO do objeto, que é onde a prévia e a gravação leem');

-- Os três avisos que o item (c) de §3.2 inventa: nenhum deles reprova a linha.
select ok(pg_temp.aviso(app.importacao_normalizar(
            pg_temp.linha_maps('{"email":"fale conosco"}'::jsonb)), 'email_invalido')
      and (app.importacao_normalizar(
            pg_temp.linha_maps('{"email":"fale conosco"}'::jsonb)) ->> 'erro') is null,
          'texto que não é e-mail vira aviso e campo nulo, e a linha continua valendo um telefone');

select ok(pg_temp.aviso(app.importacao_normalizar(
            pg_temp.linha_maps('{"nota":"9,5"}'::jsonb)), 'nota_invalida')
      and (app.importacao_normalizar(
            pg_temp.linha_maps('{"nota":"9,5"}'::jsonb)) -> 'payload' ->> 'nota') is null,
          'nota fora de 0–5 vira aviso e não entra no payload');

select ok(pg_temp.aviso(app.importacao_normalizar(
            pg_temp.linha_maps('{"avaliacoes_qtd":"1.238 avaliações"}'::jsonb)),
            'avaliacoes_invalidas'),
          'contagem de avaliações que não é só dígito vira aviso');

-- =====================================================================
-- 3. A identidade na fonte é o LUGAR (§3.5 teste 3)
-- =====================================================================
select is(app.importacao_normalizar(pg_temp.linha_maps()) ->> 'external_id',
          'C66-CID-PGTAP',
          'com place_id, a identidade é o lugar — mesmo havendo telefone: o número do Maps muda, o cid não');

select is(app.importacao_normalizar(pg_temp.linha_maps('{"place_id": null}'::jsonb)) ->> 'external_id',
          '+5584988000166',
          'sem place_id nada muda para a planilha-ponte: a identidade continua sendo o celular');

-- =====================================================================
-- 9. O mapa da fonte vence a queda difusa (§3.5 teste 9)
-- =====================================================================
-- `app.importacao_categoria` casa por trigrama a partir de 0,55
-- (20260904001820:165-172). Este rótulo comprido casa por semelhança com
-- "Celebrante, beleza, convites, transfer, segurança, staff" — o arquivo 22
-- mede isso nas linhas 186-188. O mapa da fonte diz outra coisa, e é o mapa
-- que manda.
select is(
  (select jsonb_build_object('categoria', n ->> 'categoria_nome',
                             'aproximada', pg_temp.aviso(n, 'categoria_aproximada'))
     from (select app.importacao_normalizar(pg_temp.linha_maps(
             '{"categoria":"Outros serviços (celebrante, beleza, convites, transfer, seguranca, staff)"}'::jsonb)) as n) x),
  jsonb_build_object('categoria', 'Fotografia e vídeo', 'aproximada', false),
  'o mapa da fonte é consultado ANTES da queda difusa, e sem aviso de aproximação');

select is(
  (select jsonb_build_object('categoria', n ->> 'categoria_nome',
                             'desconhecida', pg_temp.aviso(n, 'categoria_desconhecida'))
     from (select app.importacao_normalizar(pg_temp.linha_maps()) as n) x),
  jsonb_build_object('categoria', 'Buffet adulto/corporativo', 'desconhecida', false),
  '"buffet", que sozinho casa com o catálogo a 0,27, resolve pelo mapa da fonte');

-- =====================================================================
-- 14. O CPF não chega na `raw_capture` (§3.5 teste 14)
-- =====================================================================
create function pg_temp.linha_cpf() returns jsonb language sql stable as $$
  select pg_temp.linha_maps(jsonb_build_object(
    'linha',    3,
    'nome',     'SALAO C66 PGTAP',
    'whatsapp', '84 98800-0177',
    'place_id', 'C66-CPF-PGTAP',
    'cnpj',     null,
    'instagram', null,
    'endereco', 'Av. Salgado Filho, 2000 - Lagoa Nova, Natal - RN, 59075-000 111.444.777-35',
    'bairro',   'Lagoa Nova Sul 111.444.777-35'))
$$;

select ok(pg_temp.aviso(app.importacao_normalizar(pg_temp.linha_cpf()), 'cpf_descartado'),
          'CPF no endereço ou no bairro vira aviso já na normalização');

select is(app.importacao_normalizar(pg_temp.linha_cpf()) -> 'payload' ->> 'endereco',
          'Av. Salgado Filho, 2000 - Lagoa Nova, Natal - RN, 59075-000',
          'e o endereço entra no payload SEM o CPF, porque a raw_capture guarda o payload cru');

select is(app.importacao_normalizar(pg_temp.linha_cpf()) -> 'payload' ->> 'bairro',
          'Lagoa Nova Sul',
          'o bairro também é varrido, e a coluna explícita continua ganhando do extraído do endereço');

select pg_temp.entrar(pg_temp.admin(), 'admin');

create temp table previa66 as
  select public.importacao_previa(jsonb_build_array(pg_temp.linha_cpf())) as j;
grant select on previa66 to authenticated;

create temp table lote66 as
  select (public.esteira_abrir_lote('planilha', 966, 'pgTAP 66 — CSV do Maps')
          ->> 'batch_id')::uuid as id;
grant select on lote66 to authenticated;

create temp table grav66 as
  select public.importacao_gravar((select id from lote66),
                                  jsonb_build_array(pg_temp.linha_cpf())) as j;
grant select on grav66 to authenticated;

select pg_temp.sair();

select ok((select l -> 'avisos' from previa66, jsonb_array_elements(j -> 'linhas') l)
          @> '["cpf_descartado"]'::jsonb,
          'o descarte aparece na PRÉVIA, antes de qualquer escrita');

select ok(not app.tem_cpf((select rc.payload ->> 'endereco' from public.raw_capture rc
                            where rc.source_id = 966 and rc.external_id = 'C66-CPF-PGTAP'))
      and (select rc.payload ->> 'endereco' from public.raw_capture rc
            where rc.source_id = 966 and rc.external_id = 'C66-CPF-PGTAP')
          = 'Av. Salgado Filho, 2000 - Lagoa Nova, Natal - RN, 59075-000',
          'e a raw_capture, que guarda o payload CRU, nunca vê o CPF');

-- =====================================================================
-- 14b. O QUE A LIMPEZA ANTECIPADA CUSTA (foco de revisão 1)
-- =====================================================================
-- Até hoje, quem registrava o descarte era o gatilho de higiene do
-- `source_record` (20260904001600:624-643): ele limpava `name`, `legal_name`,
-- `address` e `neighborhood`, marcava `cpf_descartado` em `flags` e gravava
-- `public.field_provenance` com action='descartado', reason='cpf'. Varrendo o
-- CPF antes (que é obrigatório: `raw_capture` guarda o payload CRU), o gatilho
-- deixa de ver o CPF — e as duas marcas somem.
--
-- É DÍVIDA, e está escrita aqui de propósito. O §3.5 teste 14 da spec pede a
-- linha de `field_provenance`; ela não existe mais por este caminho. O
-- registro do descarte sobrevive HOJE só na prévia (asserção acima), que não
-- é armazenada. O conserto natural é `public.importacao_gravar` chamar
-- `app.registrar_proveniencia` quando a linha trouxer o aviso `cpf_descartado`
-- — função de 230 linhas que esta fase não substitui, e por isso fica como
-- pendência escrita no CHANGELOG, para decisão.
-- `= any ((select ...))` seria lido como a forma de SUBCONSULTA do ANY e tentaria
-- converter o literal em text[] ("malformed array literal"). O `any` fica DENTRO
-- da subconsulta, e o `coalesce(..., true)` faz a asserção falhar — e não passar
-- de graça — se o `source_record` do lote sequer existir.
select ok(not coalesce(
            (select 'cpf_descartado' = any (coalesce(sr.flags, '{}'::text[]))
               from public.source_record sr
              where sr.source_id = 966 and sr.external_id = 'C66-CPF-PGTAP'),
            true),
          'DÍVIDA: o source_record não marca mais cpf_descartado — o CPF já não chega nele');

-- A contagem vem ACOMPANHADA da existência do registro: zero linha de
-- proveniência só quer dizer alguma coisa se o `source_record` do lugar estiver
-- lá. Sem isso, a asserção passaria de graça em qualquer dia em que o
-- `external_id` mudasse de forma.
select is(
  jsonb_build_object(
    'registro_existe',
      exists (select 1 from public.source_record sr
               where sr.source_id = 966 and sr.external_id = 'C66-CPF-PGTAP'),
    'descartes',
      (select count(*)::int
         from public.field_provenance fp
         join public.source_record sr
           on sr.id = fp.record_id and fp.record_type = 'source_record'
        where sr.source_id = 966 and sr.external_id = 'C66-CPF-PGTAP'
          and fp.action = 'descartado' and fp.reason = 'cpf')),
  jsonb_build_object('registro_existe', true, 'descartes', 0),
  'DÍVIDA: e não há linha de field_provenance do descarte — o registro do descarte ficou só na prévia');

-- =====================================================================
-- 4. A whitelist não é por campo: a 16ª chave reprova o payload INTEIRO
--    (§3.5 teste 4; risco 2 da §11) — foco de revisão 2
-- =====================================================================
-- Esta asserção já passa hoje, e é para isso que serve: ela é a rede do dia em
-- que alguém acrescentar `facebook` ao payload "só para não perder o dado". O
-- erro não apareceria como "campo recusado" — apareceria como "a importação
-- toda falhou", em 600 linhas de uma vez.
select ok(not app.payload_e_permitido(
            (app.importacao_normalizar(pg_temp.linha_maps()) -> 'payload')
            || '{"facebook": "https://facebook.com/buffetc66"}'::jsonb),
          'uma chave fora da whitelist do R06 SCR-01 reprova o payload inteiro, não só o campo');

-- =====================================================================
-- 5. A prévia sonda o place_id (§3.2 item 4)
-- =====================================================================
-- A ficha já está na base com o `cid` do lugar. O telefone é OUTRO (o Maps
-- devolve o número que o dono publicou hoje) e o nome também. Sem o place_id
-- nada casa: a prévia dizia "entra" e `app.promover_candidato` responderia
-- "ja_existe_na_base" com chave 'place_id' na hora de gravar.
--
-- Os dois nomes são propositalmente dissemelhantes (ZWQX / BKJV). A regra de
-- nome por trigram de `app.find_org_matches` não pode ser quem responde aqui,
-- senão a asserção passaria pelo motivo errado; e a ficha nasce sem linha em
-- `organization_categories`, o que também fecha o ramo de categoria daquela
-- regra (20260904000300:698-710).
select pg_temp.sair();   -- o bloco anterior pode ter deixado a sessão em papel

insert into public.organizations (kind, name, phone_e164, place_id, source_id, collector)
values ('fornecedor', 'ZWQX PGTAP66 FICHA ANTIGA', '+5584977660001', 'CID-PGTAP66-5',
        (select id from public.sources where slug = 'planilha'), 'pgTAP 66');

select pg_temp.entrar(pg_temp.admin(), 'admin');
create temp table t3_previa as
  select public.importacao_previa(jsonb_build_array(jsonb_build_object(
           'linha',     1,
           'nome',      'BKJV PGTAP66 NOME DE HOJE',
           'whatsapp',  '84 97766-0002',
           'place_id',  'CID-PGTAP66-5',
           'categoria', 'Fotografia e vídeo',
           'cidade',    'Natal',
           'origem',    'planilha'))) as j;
select pg_temp.sair();

select is(array[
    (select l ->> 'decisao'
       from jsonb_array_elements((select j from pg_temp.t3_previa) -> 'linhas') l),
    (select l -> 'duplicata' ->> 'chave'
       from jsonb_array_elements((select j from pg_temp.t3_previa) -> 'linhas') l),
    (select l -> 'duplicata' ->> 'nome'
       from jsonb_array_elements((select j from pg_temp.t3_previa) -> 'linhas') l)],
  array['duplicata', 'place_id', 'ZWQX PGTAP66 FICHA ANTIGA'],
  'a prévia recusa pelo place_id, diz qual chave casou e de quem é a ficha');

-- =====================================================================
-- 6. Reimportar o mesmo arquivo não cria ficha nova (§3.5 teste 6;
--    critério de pronto 3 da §13) — foco de revisão 3
-- =====================================================================
-- Dois lotes com a MESMA linha. O primeiro grava; o segundo tem de responder
-- `repetida`/`ja_importado` na prévia E na gravação, e a base cresce UMA ficha
-- ao todo. Quem responde é o ramo (1) de `public.importacao_previa` — que esta
-- tarefa acabou de transcrever inteira — e o ramo `aprovado` de
-- `public.importacao_gravar`. Passa antes e depois: é a rede da transcrição.
--
-- A linha é própria, sem CNPJ e sem @: o CNPJ de fixture 11222333000181
-- poderia estar em outra ficha deste banco, e a asserção passaria a falhar por
-- 'duplicata' — motivo certo, teste errado.
--
-- O `site` também é próprio, e pelo mesmo motivo. `pg_temp.linha_maps` traz
-- `https://buffetc66.invalid`, e o bloco 14 já gravou uma ficha com esse
-- domínio (SALAO C66 PGTAP): `app.find_org_matches` casa domínio a 0,90
-- (20260904000300:692-696), então a PRIMEIRA volta sairia 'duplicata' por um
-- vizinho de fixture, e não pelo que este bloco quer medir.
create function pg_temp.linha_reimporte() returns jsonb language sql stable as $$
  select pg_temp.linha_maps(jsonb_build_object(
    'linha',     9,
    'nome',      'BUFFET C66 REIMPORTE',
    'whatsapp',  '84 97766-0090',
    'place_id',  'C66-REIMPORTE',
    'site',      'https://reimportec66.invalid',
    'cnpj',      null,
    'instagram', null))
$$;

select pg_temp.sair();
create temp table t3b_antes as
  select count(*)::int as n from public.organizations where deleted_at is null;

select pg_temp.entrar(pg_temp.admin(), 'admin');
create temp table t3b_l1 as
  select (public.esteira_abrir_lote('planilha', 966, 'pgTAP 66 — primeira volta')
          ->> 'batch_id')::uuid as id;
create temp table t3b_g1 as
  select public.importacao_gravar((select id from t3b_l1),
                                  jsonb_build_array(pg_temp.linha_reimporte())) as j;
create temp table t3b_l2 as
  select (public.esteira_abrir_lote('planilha', 966, 'pgTAP 66 — segunda volta')
          ->> 'batch_id')::uuid as id;
create temp table t3b_p2 as
  select public.importacao_previa(jsonb_build_array(pg_temp.linha_reimporte())) as j;
create temp table t3b_g2 as
  select public.importacao_gravar((select id from t3b_l2),
                                  jsonb_build_array(pg_temp.linha_reimporte())) as j;
select pg_temp.sair();

select is(
  (select l ->> 'decisao'
     from jsonb_array_elements((select j from pg_temp.t3b_g1) -> 'linhas') l),
  'entra',
  'a primeira volta grava a ficha');

select is(array[
    (select l ->> 'decisao' from jsonb_array_elements((select j from pg_temp.t3b_p2) -> 'linhas') l),
    (select l ->> 'motivo'  from jsonb_array_elements((select j from pg_temp.t3b_p2) -> 'linhas') l),
    (select l ->> 'decisao' from jsonb_array_elements((select j from pg_temp.t3b_g2) -> 'linhas') l),
    (select l ->> 'motivo'  from jsonb_array_elements((select j from pg_temp.t3b_g2) -> 'linhas') l)],
  array['repetida', 'ja_importado', 'repetida', 'ja_importado'],
  'na segunda volta a prévia e a gravação dizem a MESMA coisa: já importado');

select is(
  (select count(*)::int from public.organizations where deleted_at is null)
  - (select n from pg_temp.t3b_antes),
  1,
  'e a base cresceu UMA ficha ao todo, não duas');

-- =====================================================================
-- 10. Quem pediu para parar não vira alvo (§3.5 teste 10; guardrail de
--     opt-out da §10) — foco de revisão 5
-- =====================================================================
-- `app.is_suppressed` é consultado dentro de `app.importacao_normalizar`, e a
-- decisão `nao_contatar` sai antes de qualquer escrita. Esta asserção é rede:
-- ela existe para o dia em que alguém reordenar os `if` da prévia e a
-- supressão virar enfeite. `app.suppress` é concedida só a service_role
-- (20260904000400:493), por isso a sessão volta ao superusuário.
-- O `site` é próprio pelo mesmo motivo do bloco 6: com o domínio de fixture
-- compartilhado, uma supressão que parasse de funcionar sairia 'duplicata' em
-- vez de criar ficha, e a segunda asserção passaria pelo motivo errado.
create function pg_temp.linha_suprimida() returns jsonb language sql stable as $$
  select pg_temp.linha_maps(jsonb_build_object(
    'linha',     10,
    'nome',      'BUFFET C66 PEDIU PARA PARAR',
    'whatsapp',  '84 97766-0099',
    'place_id',  'C66-SUPRIMIDO',
    'site',      'https://paradoc66.invalid',
    'cnpj',      null,
    'instagram', null))
$$;

select pg_temp.sair();
select app.suppress('phone', app.normalize_phone_br('84 97766-0099'),
                    'pgTAP 66 — pediu para parar', 'whatsapp'::app.channel, null);

select pg_temp.entrar(pg_temp.admin(), 'admin');
create temp table t3c_l as
  select (public.esteira_abrir_lote('planilha', 966, 'pgTAP 66 — quem pediu para parar')
          ->> 'batch_id')::uuid as id;
create temp table t3c_p as
  select public.importacao_previa(jsonb_build_array(pg_temp.linha_suprimida())) as j;
create temp table t3c_g as
  select public.importacao_gravar((select id from t3c_l),
                                  jsonb_build_array(pg_temp.linha_suprimida())) as j;
select pg_temp.sair();

select is(array[
    (select l ->> 'decisao' from jsonb_array_elements((select j from pg_temp.t3c_p) -> 'linhas') l),
    (select l ->> 'motivo'  from jsonb_array_elements((select j from pg_temp.t3c_p) -> 'linhas') l),
    (select l ->> 'decisao' from jsonb_array_elements((select j from pg_temp.t3c_g) -> 'linhas') l)],
  array['nao_contatar', 'pediu_para_parar', 'nao_contatar'],
  'telefone na suppression_list: a prévia recusa antes de escrever, e a gravação também');

select is(array[
    (select count(*)::int from public.organizations o where o.place_id = 'C66-SUPRIMIDO'),
    (select count(*)::int from public.deals d
       join public.organizations o on o.id = d.organization_id
      where o.place_id = 'C66-SUPRIMIDO')],
  array[0, 0],
  'e nada nasce: nem ficha nem negócio para quem pediu para parar');

-- =====================================================================
-- 7 e 8. Segundo lote do mesmo lugar: completa sem duplicar (§3.2 item 5)
-- =====================================================================
-- Duas raspagens do mesmo `cid`. A primeira vem magra (o Maps nem sempre
-- devolve endereço e categoria); a segunda traz nota nova, CEP, cidade e
-- categoria. O ramo "mudou na fonte" tem de carregar os quatro — e ainda
-- assim produzir UM candidato e UMA ficha.
--
-- Dois lotes, e não um: a chave de idempotência da captura é
-- (batch_id, request_key), e o gatilho `app.raw_capture_normalize` monta
-- request_key = sha256(source_id|coalesce(source_url, external_id, ''))
-- (20260904001600:351-352). No mesmo lote, a segunda captura voltaria como
-- `pedido_repetido` e nada seria processado.
--
-- A sessão volta a ser a do superusuário: `public.esteira_gravar_captura`,
-- `public.esteira_processar_captura` e `app.promover_candidato` são revogadas
-- de `authenticated` e concedidas só a `service_role`
-- (20260904001600:2373-2374, 2381 e 1359-1362).
select pg_temp.sair();

-- O mapa de categoria desta fonte, só para este teste; o rollback desfaz.
-- A seed só popula `source_category_map` para `casamentos_com_br`
-- (supabase/seed.sql:252-283), então não há linha anterior a preservar.
insert into public.source_category_map (source_id, category_source, category_id)
values ((select id from public.sources where slug = 'planilha'), 'confeitaria',
        (select id from public.categories where slug = 'doces_bolos_confeitaria'))
on conflict (source_id, category_source) do nothing;

create table pg_temp.t4_ids (chave text primary key, v uuid);

insert into pg_temp.t4_ids
select 'lote1', (public.esteira_abrir_lote('planilha',
                   (select id from public.sources where slug = 'planilha'),
                   'pgTAP 66 — primeira raspagem') ->> 'batch_id')::uuid;
insert into pg_temp.t4_ids
select 'lote2', (public.esteira_abrir_lote('planilha',
                   (select id from public.sources where slug = 'planilha'),
                   'pgTAP 66 — segunda raspagem') ->> 'batch_id')::uuid;

-- Primeira raspagem: sem CEP, sem cidade, sem categoria. A `source_url` vai no
-- PAYLOAD (é assim que `public.importacao_gravar` faz, :880-887) e não no
-- argumento: o argumento entra na chave de idempotência e faria a segunda
-- linha de uma mesma listagem ser engolida como pedido repetido.
insert into pg_temp.t4_ids
select 'rc1', (public.esteira_gravar_captura(
          (select v from pg_temp.t4_ids where chave = 'lote1'),
          (select id from public.sources where slug = 'planilha'),
          jsonb_build_object('nome_comercial', 'DOCERIA PGTAP66',
                             'place_id',       'CID-PGTAP66-7',
                             'telefones',      jsonb_build_array('84 98766-0007'),
                             'source_url',     'https://www.google.com/maps/place/?q=place_id:CID-PGTAP66-7',
                             'nota',           '4.5'),
          'CID-PGTAP66-7', null, null, 'pgTAP 66') ->> 'raw_capture_id')::uuid;

-- Cada chamada no seu PRÓPRIO comando, e o retorno guardado em vez de
-- descartado: se `esteira_processar_captura` ou `promover_candidato`
-- recusarem, a coluna `v` vem nula e o motivo aparece aqui, e não seis linhas
-- adiante como uma contagem zero sem explicação. É a mesma disciplina do
-- comentário de 16_esteira_de_ingestao.sql:320-326.
insert into pg_temp.t4_ids
select 'sr1', (public.esteira_processar_captura(
                 (select v from pg_temp.t4_ids where chave = 'rc1'))
               ->> 'source_record_id')::uuid;

insert into pg_temp.t4_ids
select 'cand', (select sr.candidate_id from public.source_record sr
                 where sr.id = (select v from pg_temp.t4_ids where chave = 'sr1'));

insert into pg_temp.t4_ids
select 'org', (app.promover_candidato(
                 (select v from pg_temp.t4_ids where chave = 'cand'),
                 null, null, null, null,
                 (select id from public.categories where slug = 'buffet_adulto_corporativo'),
                 (select v from pg_temp.t4_ids where chave = 'lote1'))
               ->> 'organization_id')::uuid;

-- Segunda raspagem: nota nova, e CEP, cidade e categoria pela primeira vez.
insert into pg_temp.t4_ids
select 'rc2', (public.esteira_gravar_captura(
          (select v from pg_temp.t4_ids where chave = 'lote2'),
          (select id from public.sources where slug = 'planilha'),
          jsonb_build_object('nome_comercial',   'DOCERIA PGTAP66',
                             'place_id',         'CID-PGTAP66-7',
                             'telefones',        jsonb_build_array('84 98766-0007'),
                             'source_url',       'https://www.google.com/maps/place/?q=place_id:CID-PGTAP66-7',
                             'nota',             '4.8',
                             'cep',              '59082-095',
                             'cidade',           'Natal',
                             'categoria_origem', 'Confeitaria'),
          'CID-PGTAP66-7', null, null, 'pgTAP 66') ->> 'raw_capture_id')::uuid;
insert into pg_temp.t4_ids
select 'sr2', (public.esteira_processar_captura(
                 (select v from pg_temp.t4_ids where chave = 'rc2'))
               ->> 'source_record_id')::uuid;

select is(array[
    (select count(*)::int from public.supplier_candidates c where c.place_id = 'CID-PGTAP66-7'),
    (select count(*)::int from public.organizations o
      where o.place_id = 'CID-PGTAP66-7' and o.deleted_at is null),
    (select count(*)::int from public.source_record sr
      where sr.id = (select v from pg_temp.t4_ids where chave = 'sr1')
        and sr.id = (select v from pg_temp.t4_ids where chave = 'sr2')
        and 'mudou_na_fonte' = any (sr.flags))],
  array[1, 1, 1],
  'segunda raspagem com nota nova: um candidato, uma ficha, o mesmo registro de fonte marcado mudou_na_fonte');

-- O CEP é comparado só com dígitos: o gatilho `app.source_record_normalize`
-- guarda `cep` sem a máscara (20260904001600:690).
select is(
    (select array[sr.cep, sr.city_id::text, sr.category_id::text, sr.category_source]
       from public.source_record sr
      where sr.id = (select v from pg_temp.t4_ids where chave = 'sr2')),
    array['59082095',
          (select id::text from public.cities where name = 'Natal' and state = 'RN'),
          (select id::text from public.categories where slug = 'doces_bolos_confeitaria'),
          'confeitaria'],
  'o segundo lote grava CEP, cidade e categoria que o primeiro não tinha');

-- =====================================================================
-- 11. "De onde vocês tiraram o meu número?" (§3.5 teste 11; critério de
--     pronto 2 da §13; guardrail de proveniência da §10) — foco de revisão 4
-- =====================================================================
-- `app.resolver_source_record` grava `public.field_provenance` para dez campos
-- (20260904001600:969-983), com a `source_url` do `source_record` — que vem do
-- payload, porque a captura é gravada com o argumento `p_source_url` nulo de
-- propósito. Se alguém tirar `source_url` do payload da importação, a resposta
-- ao titular volta a ser "fontes públicas", que é literalmente o que multou a
-- KASPR. Passa hoje, e é para continuar passando.
--
-- Roda como superusuário: `public.origem_dos_dados` confere
-- `app.org_is_visible`, e sem JWT `app.role()` cai em `leitura`, que está em
-- `app.sees_all()` (20260904000500:46-50).
--
-- `distinct`, e não a lista crua: `public.field_provenance` é registro
-- append-only (`app.registrar_proveniencia` faz `insert`, :572) e
-- `app.resolver_source_record` grava os dez campos a CADA passada. Com duas
-- raspagens e uma promoção, `phone_e164` e `place_id` aparecem três vezes cada
-- um — o que se afirma aqui é QUAIS campos a ficha sabe explicar, não quantas
-- vezes foram vistos.
select is(
  (select array_agg(t.campo order by t.campo collate "C")
     from (select distinct c ->> 'campo' as campo
             from jsonb_array_elements(
                    public.origem_dos_dados(
                      (select v from pg_temp.t4_ids where chave = 'org')) -> 'campos') c
            where c ->> 'url' = 'https://www.google.com/maps/place/?q=place_id:CID-PGTAP66-7'
              and c ->> 'campo' in ('phone_e164', 'place_id')) t),
  array['phone_e164', 'place_id'],
  'a ficha responde de onde veio o número com a URL do lugar no Maps, em phone_e164 E em place_id');


select * from finish();
rollback;

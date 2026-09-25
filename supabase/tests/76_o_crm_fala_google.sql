-- =====================================================================
-- pgTAP — O CRM aprende a falar Google (migração 20261001090000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. O DE-PARA GANHOU SEIS NOMES. Medido em 25/09/2026 nos dois CSV de
--      `listas/`: o Google devolveu 16 nomes de categoria, o mapa da fonte
--      tinha 12 chaves e só 3 casaram. Seis nomes evidentes do vocabulário do
--      Maps não estavam lá; "buffet infantil" sozinho destravava 6 linhas.
--   2. O TIL DEIXOU DE DECIDIR O DESTINO DA LINHA. As duas leituras vivas
--      comparavam `lower(trim(...))`, sem `unaccent`: "Salao de festas" sem
--      til não casaria com a chave 'salão de festas'. Não aconteceu por sorte.
--   3. A FORMA DA CHAVE É CONTRATO DE ESCRITA. Com toda chave gravada na forma
--      de `app.chave_catalogo`, a PK (source_id, category_source) recusa a
--      segunda grafia sozinha; o CHECK é o que garante a forma. É de propósito
--      que NÃO há índice único sobre `app.chave_catalogo(category_source)`:
--      ela é declarada `immutable` mas chama `extensions.unaccent(text)`, que é
--      `stable`, e este repositório já decidiu essa questão uma vez — o
--      comentário de `app.search_name` (20260904000100:328-330) diz que é por
--      isso que aquele valor é materializado em coluna e indexado na coluna,
--      nunca por expressão.
--   4. A NORMALIZAÇÃO DEVOLVE O TEXTO CRU DA CATEGORIA. É ele que a tela de
--      resolver (tarefa 6 do plano) agrupa, e é ele que o placar conta. Sem
--      subir ao topo do retorno, ninguém o lê: `importacao_previa` e
--      `importacao_gravar` nunca abrem o payload.
--
-- NENHUMA asserção conta linha absoluta em `public.source_category_map`: ela é
-- tabela compartilhada e a tarefa 6 passa a ESCREVER nela. Um `count(*) = 18`
-- quebraria no dia em que alguém ensinasse a primeira categoria.
--
-- A REDE É O ARQUIVO 22 (`22_importacao_de_planilha.sql`): a planilha-ponte
-- continua entrando pela mesma `app.importacao_normalizar`, e é ele quem
-- acusa, no mesmo `pnpm db:test`, se ela quebrar.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(10);

-- 1. As seis chaves novas existem e apontam para a categoria medida.
select is_empty($$
  select v.chave
    from (values ('buffet infantil','buffet_infantil_casa_de_festas'),
                 ('buffet de casamento','buffet_adulto_corporativo'),
                 ('servico de catering','buffet_adulto_corporativo'),
                 ('estudio fotografico','fotografia_video'),
                 ('estudio de fotografia','fotografia_video'),
                 ('local para eventos','locais_saloes_chacaras_hoteis')
         ) v(chave, slug)
   where not exists (
     select 1 from public.source_category_map m
       join public.sources s    on s.id = m.source_id   and s.slug = 'google_maps_raspado'
       join public.categories c on c.id = m.category_id and c.slug = v.slug
      where m.category_source = v.chave) $$,
  'as seis chaves novas do de-para existem, e cada uma aponta para a categoria medida');

-- 2. Invariante da forma: nenhuma chave gravada fora de app.chave_catalogo.
select is((select count(*)::int from public.source_category_map m
            where m.category_source is distinct from app.chave_catalogo(m.category_source)), 0,
  'nenhuma chave do mapa está gravada fora da forma de app.chave_catalogo');

-- 3. O til deixa de decidir o destino da linha.
select is(app.importacao_normalizar(jsonb_build_object(
            'linha', 1, 'nome', 'Fixture 76 com til', 'categoria', 'Salão de Festas',
            'origem', 'Google Maps (raspagem local)', 'whatsapp', '84999990076'))
          ->> 'categoria_nome',
          'Locais: salões, chácaras, hotéis, restaurantes, praia',
          'com acento e com caixa alta, casa');
select is(app.importacao_normalizar(jsonb_build_object(
            'linha', 1, 'nome', 'Fixture 76 sem til', 'categoria', 'salao de festas',
            'origem', 'Google Maps (raspagem local)', 'whatsapp', '84999990076'))
          ->> 'categoria_nome',
          'Locais: salões, chácaras, hotéis, restaurantes, praia',
          'sem acento, casa a MESMA categoria');

-- 4. Duas chaves novas, uma asserção por família destravada.
select is(app.importacao_normalizar(jsonb_build_object(
            'linha', 1, 'nome', 'Fixture 76 buffet', 'categoria', 'Buffet de casamento',
            'origem', 'Google Maps (raspagem local)', 'whatsapp', '84999990076'))
          ->> 'categoria_nome', 'Buffet adulto/corporativo',
          'buffet de casamento é buffet ADULTO, nunca infantil');
select is(app.importacao_normalizar(jsonb_build_object(
            'linha', 1, 'nome', 'Fixture 76 estudio', 'categoria', 'Estúdio fotográfico',
            'origem', 'Google Maps (raspagem local)', 'whatsapp', '84999990076'))
          ->> 'categoria_nome', 'Fotografia e vídeo',
          'estúdio fotográfico é sinônimo de fotógrafo');

-- 5. A trava de grafia.
select has_check('public', 'source_category_map',
  'o mapa tem CHECK de forma da chave');
select throws_ok($$
  insert into public.source_category_map (source_id, category_source, category_id)
  select s.id, 'SALÃO DE FESTAS', c.id from public.sources s, public.categories c
   where s.slug = 'google_maps_raspado' and c.slug = 'fotografia_video' $$,
  '23514', null,
  'grafia fora da forma normalizada é recusada na escrita, e não vira um segundo destino');
select throws_ok($$
  insert into public.source_category_map (source_id, category_source, category_id)
  select s.id, 'salao de festas', c.id from public.sources s, public.categories c
   where s.slug = 'google_maps_raspado' and c.slug = 'fotografia_video' $$,
  '23505', null,
  'a MESMA chave normalizada colide na PK: um nome da fonte tem um destino só');

-- 6. O retorno da normalização carrega o texto cru da categoria.
select is(app.importacao_normalizar(jsonb_build_object(
            'linha', 1, 'nome', 'Fixture 76 cru', 'categoria', 'Loja de Presentes',
            'site', 'https://exemplo76.test/loja',
            'origem', 'Google Maps (raspagem local)', 'whatsapp', '84999990076'))
          ->> 'categoria_origem', 'Loja de Presentes',
  'a normalização devolve o texto CRU da categoria: é ele que a tela de resolver agrupa');

select * from finish();
rollback;

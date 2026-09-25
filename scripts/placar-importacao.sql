-- =====================================================================
-- O placar da importação — mede, não escreve.
--
-- POR QUÊ: o desenho de 25/09/2026 (docs/superpowers/specs/
-- 2026-09-25-importar-sem-fila-design.md) troca "eu acho que melhorou" por um
-- número só — quantas das 40 linhas de listas/ viram parceiro sem ninguém
-- responder nada. Este script roda a prévia contra os dois CSV DE VERDADE,
-- com a origem certa, e imprime o placar. Roda em transação e faz rollback:
-- nenhuma linha fica no banco.
--
-- POR QUE ELE FUNCIONA SEM CRIAR GENTE: `app.role()` lê só o claim do JWT
-- (20260904000100:353-365), e `public.importacao_previa` é STABLE — não grava
-- nada e não precisa de `owner_id`. `public.importacao_gravar` NÃO roda
-- assim: ela exige um profile de verdade.
--
-- O objeto de cada linha espelha `linhaParaObjeto`
-- (apps/web/src/components/importacao/mapeamento.ts) sobre o mapa que
-- `sugerirMapa` devolve para este cabeçalho: dez campos, todos por nome
-- exato. A trava contra a divergência é o bloco "o CSV de 36 colunas do
-- Google Maps" em apps/web/src/components/importacao/mapeamento.test.ts —
-- se aquele teste ficar vermelho, este placar está medindo outra coisa que
-- não a tela.
--
-- Uso:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/placar-importacao.sql
-- (da raiz do repositório — os \copy são relativos ao diretório atual)
-- =====================================================================
\set ON_ERROR_STOP on
begin;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-000000000001',
                    'role', 'authenticated',
                    'app_metadata', json_build_object('app_role', 'gestor'))::text, true);
set local role authenticated;

-- Os temp são criados DEPOIS do `set local role` de propósito: assim
-- pertencem a `authenticated`, e o \copy escreve neles sem grant.
-- As 36 colunas, nesta ordem, conferidas contra o cabeçalho dos dois
-- arquivos de listas/. Os arquivos não têm BOM.
create temp table csv_maps (
  input_id text, link text, title text, category text, address text,
  open_hours text, popular_times text, website text, phone text, plus_code text,
  review_count text, review_rating text, reviews_per_rating text, latitude text,
  longitude text, cid text, status text, descriptions text, reviews_link text,
  thumbnail text, timezone text, price_range text, data_id text,
  street_view_url text, place_id text, images text, reservations text,
  order_online text, menu text, owner text, complete_address text,
  credit_cards_accepted text, about text, user_reviews text,
  user_reviews_extended text, emails text
) on commit drop;
create temp table linhas_do_placar (arquivo text, linha int, obj jsonb) on commit drop;

create or replace function pg_temp.carregar(p_arquivo text) returns void
language plpgsql as $$
begin
  insert into linhas_do_placar (arquivo, linha, obj)
  select p_arquivo, n.linha,
         jsonb_strip_nulls(jsonb_build_object(
           'linha',          n.linha,
           'nome',           nullif(trim(n.title), ''),
           'categoria',      nullif(trim(n.category), ''),
           'whatsapp',       nullif(trim(n.phone), ''),
           'origem',         (select s.name from public.sources s where s.slug = 'google_maps_raspado'),
           'origem_detalhe', nullif(trim(n.link), ''),
           'site',           nullif(trim(n.website), ''),
           'place_id',       nullif(trim(n.cid), ''),
           'endereco',       nullif(trim(n.address), ''),
           'email',          nullif(trim(n.emails), ''),
           'nota',           nullif(trim(n.review_rating), ''),
           'avaliacoes_qtd', nullif(trim(n.review_count), '')))
    from (
      -- `row_number() over ()` sem ORDER BY não é determinístico. `ctid` é a
      -- ordem física do heap recém-carregado, que é a ordem do arquivo — e é
      -- o que faz "linha 18 · Rômulo" significar alguma coisa.
      select c.*, (row_number() over (order by c.ctid))::int + 1 as linha
        from csv_maps c
    ) n;
  delete from csv_maps;
end $$;

\copy csv_maps from 'listas/2026-09-25-fotografo-natal-rn.csv' with (format csv, header true)
select pg_temp.carregar('fotografo');
\copy csv_maps from 'listas/2026-09-25-teste-buffet-natal.csv' with (format csv, header true)
select pg_temp.carregar('buffet');

create temp table resultado on commit drop as
select l.arquivo,
       (p.previa -> 'contagem') as contagem,
       p.previa -> 'linhas'     as linhas
  from (select distinct arquivo from linhas_do_placar) l
  cross join lateral (
    select public.importacao_previa(
             (select jsonb_agg(x.obj order by x.linha)
                from linhas_do_placar x where x.arquivo = l.arquivo)) as previa
  ) p;

\echo '--- PLACAR: quantas viram parceiro sem ninguém responder nada ---'
select arquivo,
       (contagem ->> 'entra')::int     as viram_parceiro,
       (contagem ->> 'revisao')::int   as param_na_fila,
       (contagem ->> 'duplicata')::int as ja_na_base,
       (contagem ->> 'repetida')::int  as repetidas,
       (contagem ->> 'erro')::int      as nao_entram
  from resultado order by arquivo;

\echo '--- Os nomes de categoria que o CRM ainda não conhece (a partir da tarefa 1) ---'
-- `categoria_origem` por linha só existe depois da tarefa 1.4; até lá esta
-- consulta agrupa em nulo e os nomes se leem no próprio CSV.
select j ->> 'categoria_origem' as categoria_da_fonte,
       count(*)                 as linhas_paradas,
       string_agg(j ->> 'nome', ' ; ') as empresas
  from resultado r, lateral jsonb_array_elements(r.linhas) j
 where j ->> 'motivo' = 'categoria_desconhecida'
 group by 1 order by 2 desc, 1;

\echo '--- Linha a linha, o que a prévia promete ---'
select r.arquivo, (j ->> 'linha')::int as linha, j ->> 'nome' as nome,
       j ->> 'decisao' as decisao, j ->> 'motivo' as motivo
  from resultado r, lateral jsonb_array_elements(r.linhas) j
 order by r.arquivo, 2;

rollback;

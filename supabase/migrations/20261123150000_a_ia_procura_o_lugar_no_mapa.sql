-- =====================================================================
-- A IA que atende procura no mapa o lugar que o cliente citou — só na Imova
-- (23/11/2026)
--
-- O usuário, depois da Alinne (23/11): a cliente disse "terreno em Camurupim",
-- "perto do Condomínio Serv Club", "Condomínio Itapetinga" e mandou "Avenida Praia
-- de Camurupim, Nísia Floresta, 59164-000", e ninguém achou o terreno (o TE0004).
-- "Preciso que sempre que for passada alguma informação relevante, tipo algum ponto
-- de referência, 'é perto de...', 'fica nas proximidades de...', você use métodos de
-- busca e consiga buscar a referência que o cliente passou e verifique se bate com
-- algum terreno/imóvel nosso."
--
-- E, depois de duas versões descartadas no mesmo dia (um extrator e um agente
-- separado): "Não precisa de um agente especializado na busca, mas devemos passar a
-- instrução para IA sempre buscar no mapa de acordo com a referência que o cliente
-- passou para que possamos ver se as informações batem."
--
-- A IA que atende ganha a ferramenta `buscar_no_mapa` (`atendente-imova@v7`). Quem a
-- executa é o worker (`apps/workers/src/ia/busca-no-mapa.ts`): procura no
-- OpenStreetMap (só ele, decisão do usuário), e o CÓDIGO mede a distância até os
-- imóveis. O que a IA buscou fica em `ai_runs` (cada volta, com a ferramenta pedida).
--
-- O QUE ENTRA (só na Imova):
--   1. `public.ia_lugares_no_mapa`: o cache do mapa (OpenStreetMap, ODbL), uma
--      linha por pergunta, com até 3 resultados. A política do Nominatim pede
--      cache: a mesma pergunta não volta ao serviço enquanto a linha vale.
--   2. As portas do worker (só `service_role`): ler e gravar o cache e onde ficam os
--      imóveis que a IA conhece (o pino do anúncio, quando há).
--
-- O que NÃO muda: nada no WhatsApp, nada nos anúncios (o pino continua o do
-- anúncio; o imóvel sem pino ganha um pino aproximado no worker, pelo cache, sem
-- gravar no anúncio).
--
-- Na KOMUNE não faz nada: a IA que atende não existe lá.
--
-- COMO DESFAZER:
--   drop function public.ia_imoveis_no_mapa();
--   drop function public.ia_lugar_no_mapa_gravar(text, jsonb, text);
--   drop function public.ia_lugar_no_mapa_ler(text);
--   drop function app.ia_chave_do_lugar(text);
--   drop table public.ia_lugares_no_mapa;
-- =====================================================================

do $mapa$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$
-- ---------------------------------------------------------------------
-- 0. A chave de uma pergunta ao mapa: sem acento, minúscula, um espaço só
-- ---------------------------------------------------------------------
create or replace function app.ia_chave_do_lugar(p_consulta text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(extensions.unaccent(btrim(regexp_replace(coalesce(p_consulta, ''), '\s+', ' ', 'g')))), '')
$$;
revoke all on function app.ia_chave_do_lugar(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. O cache do mapa
-- ---------------------------------------------------------------------
create table if not exists public.ia_lugares_no_mapa (
  consulta    text primary key check (char_length(consulta) between 1 and 300),
  -- Até 3 lugares, como o OpenStreetMap devolveu: nome, tipo (addresstype), nível
  -- ('ponto' dá distância; 'cidade' só diz a cidade), bairro, cidade, lat, lng.
  -- Lista vazia = o mapa não conhece o lugar.
  resultados  jsonb not null default '[]'::jsonb
                check (jsonb_typeof(resultados) = 'array' and jsonb_array_length(resultados) <= 3),
  licenca     text check (char_length(licenca) <= 300),
  buscado_em  timestamptz not null default now(),
  expira_em   timestamptz not null
);
alter table public.ia_lugares_no_mapa enable row level security;
comment on table public.ia_lugares_no_mapa is
  'Cache do mapa da IA que atende (Imova, 23/11/2026): o que o OpenStreetMap (ODbL) devolveu para cada lugar que o Localizador procurou ou que um anúncio sem pino tem. Só o worker lê e grava.';

-- ---------------------------------------------------------------------
-- 2. As portas do worker
-- ---------------------------------------------------------------------

-- O que o cache sabe de uma pergunta, se ainda vale (nada = perguntar ao mapa).
create or replace function public.ia_lugar_no_mapa_ler(p_consulta text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select l.resultados
    from public.ia_lugares_no_mapa l
   where l.consulta = app.ia_chave_do_lugar(p_consulta)
     and l.expira_em > now()
$$;
revoke all on function public.ia_lugar_no_mapa_ler(text) from public, anon, authenticated;
grant execute on function public.ia_lugar_no_mapa_ler(text) to service_role;

-- Grava a resposta do mapa. Achado vale 180 dias; "não achado", 30 (o mapa aprende
-- lugar novo, e a pergunta volta a ser feita). Mais de 3 resultados ficam os 3
-- primeiros.
create or replace function public.ia_lugar_no_mapa_gravar(p_consulta text, p_resultados jsonb, p_licenca text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_chave text := app.ia_chave_do_lugar(p_consulta);
  v_lista jsonb := case when jsonb_typeof(p_resultados) = 'array' then p_resultados else '[]'::jsonb end;
begin
  if v_chave is null or char_length(v_chave) > 300 then
    return jsonb_build_object('ok', false, 'motivo', 'consulta_invalida');
  end if;
  if jsonb_array_length(v_lista) > 3 then
    select coalesce(jsonb_agg(e order by n), '[]'::jsonb) into v_lista
      from jsonb_array_elements(v_lista) with ordinality as t(e, n) where n <= 3;
  end if;
  insert into public.ia_lugares_no_mapa (consulta, resultados, licenca, buscado_em, expira_em)
  values (v_chave, v_lista, left(nullif(btrim(coalesce(p_licenca, '')), ''), 300), now(),
          now() + case when jsonb_array_length(v_lista) = 0 then interval '30 days' else interval '180 days' end)
  on conflict (consulta) do update
    set resultados = excluded.resultados, licenca = excluded.licenca,
        buscado_em = excluded.buscado_em, expira_em = excluded.expira_em;
  return jsonb_build_object('ok', true, 'resultados', jsonb_array_length(v_lista));
end $$;
revoke all on function public.ia_lugar_no_mapa_gravar(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.ia_lugar_no_mapa_gravar(text, jsonb, text) to service_role;

-- Onde ficam os imóveis que a IA conhece (os mesmos de `app.ia_atendente_imoveis`):
-- o pino do anúncio quando há, e o endereço INTEIRO (só para o worker achar o pino
-- do anúncio que não tem; ele não vai ao modelo).
create or replace function public.ia_imoveis_no_mapa()
returns table (codigo text, tipo text, situacao text, bairro text, cidade text,
               endereco text, cep text, latitude double precision, longitude double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select i ->> 'codigo', i ->> 'tipo', i ->> 'situacao', i ->> 'bairro', i ->> 'cidade',
         coalesce(nullif(btrim(a.endereco), ''), nullif(btrim(i ->> 'rua'), '')),
         nullif(btrim(a.cep), ''),
         a.latitude::double precision, a.longitude::double precision
    from jsonb_array_elements(app.ia_atendente_imoveis()) i
    left join lateral (
      select x.endereco, x.cep, x.latitude, x.longitude
        from public.anuncios x
       where x.excluido_em is null and x.codigo = i ->> 'codigo'
       order by x.updated_at desc nulls last
       limit 1) a on true
   where nullif(btrim(i ->> 'codigo'), '') is not null
$$;
revoke all on function public.ia_imoveis_no_mapa() from public, anon, authenticated;
grant execute on function public.ia_imoveis_no_mapa() to service_role;
  $ddl$;
end
$mapa$;

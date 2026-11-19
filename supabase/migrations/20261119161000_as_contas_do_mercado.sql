-- =====================================================================
-- As contas do mercado no Postgres — só na Imova (18/11/2026)
--
-- Segunda das cinco migrações da inteligência de mercado (ver a 210000).
-- O CLAUDE.md manda: "o Postgres é o cérebro". O que é simples de contar fica
-- aqui, igual para a tela, para o worker e para o motor das vantagens:
--
--   * `app.mercado_m2(região, sub, área mínima, área máxima, modo, vizinhos)`:
--     quantos imóveis distintos, quartis, média, mínimo e máximo do m² pedido.
--     Conta só anúncio `ok` (sem absurdos, sem os nossos, sem contestados, sem
--     vencidos), um por grupo de quase gêmeos (o mais barato), de consulta
--     lida até o fim e sem as marcas que tiram do m² (tipo_duvidoso,
--     area_ambigua). A cerca de 1,5 intervalo interquartil não tira nada
--     (veracidade §5.4): `n_suspeitos` diz quantos têm a marca suspeito_3iqr.
--     A amostra é "firme" (30 ou mais), "indicio" (10 a 29) ou "pouco" (menos
--     de 10): com menos de 10, a mediana não vai à frase (§7).
--   * `app.mercado_liquidez(região, sub, modo, dias)`: ativos, quantos saíram
--     do ar nos últimos N dias, a mediana de dias no ar (com 10 saídas ou mais;
--     "firme" com 30), quantos baixaram o preço (queda de 1% e R$ 2 mil ou
--     mais) e a queda média. Só faz sentido a partir da 2ª coleta.
--   * `app.mercado_confronto_fipezap()`: a conferência de nível da cidade
--     (mediana do m² dos nossos apartamentos de Natal contra o último FipeZAP).
--   * Testes estatísticos do motor: `app.k_max_sinal` (teste do sinal),
--     `app.wilson` (intervalo de Wilson) e `app.clopper_pearson_sup` (limite
--     de cima de Clopper-Pearson, usado na saúde das fontes).
--   * `public.mercado_m2(...)` e `public.mercado_liquidez(...)`: as mesmas
--     contas pela API, com a RLS de quem chama (admin, gestor, SDR e o worker).
--
-- O que NÃO está aqui, de propósito: a regressão (o peso de cada
-- característica) e as regras de cada vantagem rodam no motor (o mesmo
-- JavaScript no protótipo e no worker), como diz o PLANO.md.
--
-- Na KOMUNE não cria nada.
--
-- COMO DESFAZER (no banco da Imova):
--   drop function if exists public.mercado_m2(text, text, numeric, numeric, text, boolean),
--     public.mercado_liquidez(text, text, text, int), app.mercado_confronto_fipezap(),
--     app.mercado_m2(text, text, numeric, numeric, text, boolean),
--     app.mercado_liquidez(text, text, text, int), app.mercado_regioes_da_conta(text, boolean),
--     app.k_max_sinal(int, numeric), app.wilson(int, int, numeric),
--     app.clopper_pearson_sup(int, int, numeric), app.binomial_acumulada(int, int, float8);
-- =====================================================================

do $contas$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A inteligência de mercado é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. Testes estatísticos
-- =====================================================================
-- Teste do sinal (estatistica.md §4.3): o maior k de "lado ruim" aceito com n
-- parecidos, ao nível alfa (unilateral). n=10 → 1, 20 → 5, 30 → 10, 100 → 41.
create or replace function app.k_max_sinal(n int, alfa numeric default 0.05)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  k   int := -1;
  acc numeric := 0;
  c   numeric := 1;
begin
  if n is null or n < 1 then
    return -1;
  end if;
  for i in 0..n loop
    if i > 0 then c := c * (n - i + 1) / i; end if;
    acc := acc + c / power(2::numeric, n);
    exit when acc > alfa;
    k := i;
  end loop;
  return k;
end $$;
comment on function app.k_max_sinal(int, numeric) is
  'Teste do sinal: o maior número de parecidos do lado ruim aceito com n parecidos ao nível alfa (n=10 → 1, 20 → 5, 30 → 10, 100 → 41).';

-- Intervalo de Wilson para k sucessos em n (z = 1,96 para 95%).
create or replace function app.wilson(k int, n int, z numeric default 1.96)
returns numrange
language sql
immutable
set search_path = ''
as $$
  select case when n is null or n <= 0 or k is null or k < 0 or k > n then null
         else numrange(
           round(greatest(0, ((k::numeric / n) + z * z / (2 * n)
                 - z * sqrt((k::numeric / n) * (1 - k::numeric / n) / n + z * z / (4 * n * n)))
                 / (1 + z * z / n)), 6),
           round(least(1, ((k::numeric / n) + z * z / (2 * n)
                 + z * sqrt((k::numeric / n) * (1 - k::numeric / n) / n + z * z / (4 * n * n)))
                 / (1 + z * z / n)), 6),
           '[]')
         end
$$;
comment on function app.wilson(int, int, numeric) is 'Intervalo de Wilson (fechado) para a proporção k/n.';

-- P(X ≤ x) numa binomial(n, p).
create or replace function app.binomial_acumulada(x int, n int, p float8)
returns float8
language plpgsql
immutable
set search_path = ''
as $$
declare
  pmf float8;
  acc float8;
begin
  if x < 0 then return 0; end if;
  if x >= n then return 1; end if;
  if p <= 0 then return 1; end if;
  if p >= 1 then return 0; end if;
  pmf := power(1 - p, n);
  acc := pmf;
  for i in 0..(x - 1) loop
    pmf := pmf * (n - i)::float8 / (i + 1)::float8 * p / (1 - p);
    acc := acc + pmf;
  end loop;
  return least(acc, 1);
end $$;

-- Limite de cima do intervalo de Clopper-Pearson (bilateral, 1 − alfa) para x
-- erros em n itens: o p em que P(X ≤ x) = alfa/2. 0 em 10 → 0,308; 0 em 80 → 0,045.
create or replace function app.clopper_pearson_sup(x int, n int, alfa numeric default 0.05)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  lo  float8 := 0;
  hi  float8 := 1;
  mid float8;
begin
  if n is null or n <= 0 or x is null or x < 0 then
    return null;
  end if;
  if x >= n then
    return 1;
  end if;
  for i in 1..60 loop
    mid := (lo + hi) / 2;
    if app.binomial_acumulada(x, n, mid) > alfa / 2 then
      lo := mid;
    else
      hi := mid;
    end if;
  end loop;
  return round(((lo + hi) / 2)::numeric, 6);
end $$;
comment on function app.clopper_pearson_sup(int, int, numeric) is
  'Limite de cima do intervalo de Clopper-Pearson (bilateral, 1 − alfa) da taxa de erro com x erros em n itens (0 em 10 → 0,308; 0 em 80 → 0,045).';

revoke all on function app.k_max_sinal(int, numeric), app.wilson(int, int, numeric),
  app.binomial_acumulada(int, int, float8), app.clopper_pearson_sup(int, int, numeric) from public, anon;
grant execute on function app.k_max_sinal(int, numeric), app.wilson(int, int, numeric),
  app.binomial_acumulada(int, int, float8), app.clopper_pearson_sup(int, int, numeric)
  to authenticated, service_role;

-- =====================================================================
-- 2. O m² por região
-- =====================================================================
-- A região e, se pedido, as vizinhas a até 6 km (princípio 1.5 do motor).
create or replace function app.mercado_regioes_da_conta(p_regiao text, p_vizinhos boolean)
returns text[]
language sql
stable
set search_path = ''
as $$
  select array(
    select x.id from (
      select p_regiao as id
      union
      select v ->> 'id'
        from public.mercado_regioes r
        cross join lateral jsonb_array_elements(r.vizinhos) v
       where coalesce(p_vizinhos, false)
         and r.id = p_regiao
         and jsonb_typeof(v -> 'km') = 'number'
         and (v ->> 'km')::numeric <= 6
    ) x
    where x.id is not null
    order by x.id)
$$;
revoke all on function app.mercado_regioes_da_conta(text, boolean) from public, anon;
grant execute on function app.mercado_regioes_da_conta(text, boolean) to authenticated, service_role;

create or replace function app.mercado_m2(
  p_regiao   text,
  p_sub      text,
  p_area_min numeric default null,
  p_area_max numeric default null,
  p_modo     text    default 'venda',
  p_vizinhos boolean default false)
returns table (
  n           int,
  n_suspeitos int,
  q1          numeric,
  mediana     numeric,
  q3          numeric,
  media       numeric,
  minimo      numeric,
  maximo      numeric,
  amostra     text,
  regioes     text[])
language sql
stable
security invoker
set search_path = ''
as $$
  with regs as (
    select app.mercado_regioes_da_conta(p_regiao, p_vizinhos) as ids
  ),
  base as (
    select a.m2::float8 as m2, 'suspeito_3iqr' = any (a.marcas) as suspeito
      from public.mercado_anuncios a, regs
     where a.regiao_id = any (regs.ids)
       and a.modo = coalesce(p_modo, 'venda')
       and a.sub = p_sub
       and a.estado = 'ok'
       and a.representante
       and a.consulta_completa
       and not (a.marcas && array['tipo_duvidoso', 'area_ambigua']::text[])
       and a.m2 is not null
       and (p_area_min is null or a.area_ref >= p_area_min)
       and (p_area_max is null or a.area_ref <= p_area_max)
  )
  select count(*)::int,
         count(*) filter (where b.suspeito)::int,
         round((percentile_cont(0.25) within group (order by b.m2))::numeric, 2),
         round((percentile_cont(0.5)  within group (order by b.m2))::numeric, 2),
         round((percentile_cont(0.75) within group (order by b.m2))::numeric, 2),
         round(avg(b.m2)::numeric, 2),
         round(min(b.m2)::numeric, 2),
         round(max(b.m2)::numeric, 2),
         case when count(*) >= app.mercado_regra_num('{minimos,percentual}', 30) then 'firme'
              when count(*) >= app.mercado_regra_num('{minimos,frase}', 10) then 'indicio'
              else 'pouco' end,
         (select r.ids from regs r)
    from base b
$$;
comment on function app.mercado_m2(text, text, numeric, numeric, text, boolean) is
  'm² pedido de uma região (e vizinhas a até 6 km, se pedido), tipo refinado (sub) e faixa de área: imóveis distintos ok (sem absurdos, nossos, contestados, vencidos e repetidos), quartis, média, mínimo, máximo e quantos têm suspeito_3iqr. amostra: firme (30+), indicio (10–29), pouco (<10).';
revoke all on function app.mercado_m2(text, text, numeric, numeric, text, boolean) from public, anon;
grant execute on function app.mercado_m2(text, text, numeric, numeric, text, boolean) to authenticated, service_role;

-- =====================================================================
-- 3. A liquidez (precisa de 2 coletas ou mais)
-- =====================================================================
create or replace function app.mercado_liquidez(
  p_regiao text,
  p_sub    text,
  p_modo   text default 'venda',
  p_dias   int  default 60)
returns table (
  ativos                 int,
  sairam                 int,
  mediana_dias_ate_sair  numeric,
  leitura                text,
  baixaram_preco         int,
  acompanhados           int,
  queda_media_pct        numeric,
  coletas                int,
  desde                  timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  with grupo as (
    select a.*
      from public.mercado_anuncios a
     where a.regiao_id = p_regiao
       and a.modo = coalesce(p_modo, 'venda')
       and a.sub = p_sub
       and a.origem = 'auto'
       and a.representante
       and a.estado in ('ok', 'vencido')
  ),
  precos as (
    select g.id,
           (array_agg(p.preco order by p.visto_em asc))[1]  as primeiro,
           (array_agg(p.preco order by p.visto_em desc))[1] as ultimo,
           count(*) as vistos
      from grupo g
      join public.mercado_anuncio_precos p on p.anuncio_id = g.id
     group by g.id
  ),
  saidas as (
    select extract(epoch from g.saiu_do_ar_em - g.primeira_vez_visto) / 86400.0 as dias
      from grupo g
     where g.saiu_do_ar_em >= now() - make_interval(days => greatest(coalesce(p_dias, 60), 1))
  ),
  quedas as (
    select pr.* from precos pr
     where pr.ultimo < pr.primeiro
       and (pr.primeiro - pr.ultimo) >= pr.primeiro * app.mercado_regra_num('{queda,pct}', 0.01)
       and (pr.primeiro - pr.ultimo) >= app.mercado_regra_num('{queda,reais}', 2000)
  )
  select (select count(*)::int from grupo g where g.estado = 'ok' and g.saiu_do_ar_em is null),
         (select count(*)::int from saidas),
         case when (select count(*) from saidas) >= app.mercado_regra_num('{minimos,saidas_indicio}', 10)
              then (select round((percentile_cont(0.5) within group (order by s.dias))::numeric, 1) from saidas s) end,
         case when (select count(*) from public.mercado_coletas c
                     where c.situacao = 'ok' and c.origem = 'auto'
                       and c.fonte in (select distinct g.fonte from grupo g)) < 2 then 'sem_historico'
              when (select count(*) from saidas) >= app.mercado_regra_num('{minimos,saidas_mediana}', 30) then 'firme'
              when (select count(*) from saidas) >= app.mercado_regra_num('{minimos,saidas_indicio}', 10) then 'indicio'
              else 'pouco' end,
         (select count(*)::int from quedas),
         (select count(*)::int from precos pr where pr.vistos >= 1),
         (select round(avg((q.primeiro - q.ultimo)::numeric / q.primeiro * 100), 1) from quedas q),
         (select count(*)::int from public.mercado_coletas c
           where c.situacao = 'ok' and c.origem = 'auto'
             and c.fonte in (select distinct g.fonte from grupo g)),
         (select min(g.primeira_vez_visto) from grupo g)
$$;
comment on function app.mercado_liquidez(text, text, text, int) is
  'Liquidez de uma região e tipo refinado (só para a equipe): ativos, saídas do ar nos últimos N dias, mediana de dias no ar (com 10 saídas ou mais), leitura (sem_historico, pouco, indicio, firme), quantos baixaram o preço (1% e R$ 2 mil ou mais) e a queda média (%).';
revoke all on function app.mercado_liquidez(text, text, text, int) from public, anon;
grant execute on function app.mercado_liquidez(text, text, text, int) to authenticated, service_role;

-- =====================================================================
-- 4. O nível da cidade contra o FipeZAP (veracidade §6.2)
-- =====================================================================
create or replace function app.mercado_confronto_fipezap()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cidade text := coalesce(app.mercado_regras() #>> '{confronto_fipezap,cidade}', 'Natal');
  v_sub    text := coalesce(app.mercado_regras() #>> '{confronto_fipezap,sub}', 'apartamento');
  v_serie  text := coalesce(app.mercado_regras() #>> '{confronto_fipezap,serie_cidade}', 'fipezap-natal-venda');
  v_lim    numeric := app.mercado_regra_num('{confronto_fipezap,nivel}', 0.30);
  v_n      int;
  v_med    numeric;
  i        public.mercado_indices;
  v_d      numeric;
begin
  select count(*)::int, round((percentile_cont(0.5) within group (order by a.m2))::numeric, 2)
    into v_n, v_med
    from public.mercado_anuncios a
   where a.estado = 'ok' and a.representante and a.modo = 'venda' and a.sub = v_sub
     and a.consulta_completa and a.m2 is not null
     and app.mercado_texto_chave(a.cidade) = app.mercado_texto_chave(v_cidade);
  select * into i from public.mercado_indices x where x.serie = v_serie order by x.mes desc limit 1;
  if not found or v_n < app.mercado_regra_num('{minimos,percentual}', 30) or v_med is null then
    return jsonb_build_object('estado', 'sem_dado', 'n', v_n, 'nossa_mediana', v_med,
                              'fipezap', case when i.serie is not null then i.valor end,
                              'mes', case when i.serie is not null then i.mes end);
  end if;
  v_d := round(v_med / nullif(i.valor, 0) - 1, 4);
  return jsonb_build_object('estado', case when abs(v_d) <= v_lim then 'concorda' else 'diverge' end,
                            'n', v_n, 'nossa_mediana', v_med, 'fipezap', i.valor, 'mes', i.mes,
                            'diferenca', v_d, 'limite', v_lim, 'serie', v_serie);
end $$;
comment on function app.mercado_confronto_fipezap() is
  'Conferência de nível: mediana do m² dos apartamentos ok de Natal (30 ou mais) contra o último FipeZAP de venda de Natal; concorda até 30% de diferença.';
revoke all on function app.mercado_confronto_fipezap() from public, anon;
grant execute on function app.mercado_confronto_fipezap() to authenticated, service_role;

-- =====================================================================
-- 5. Pela API (o schema app não é exposto), com a RLS de quem chama
-- =====================================================================
create or replace function public.mercado_m2(
  p_regiao   text,
  p_sub      text,
  p_area_min numeric default null,
  p_area_max numeric default null,
  p_modo     text    default 'venda',
  p_vizinhos boolean default false)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select to_jsonb(r) from app.mercado_m2(p_regiao, p_sub, p_area_min, p_area_max, p_modo, p_vizinhos) r
$$;
comment on function public.mercado_m2(text, text, numeric, numeric, text, boolean) is
  'app.mercado_m2 pela API, com a RLS de quem chama (admin, gestor, SDR e o worker; outro papel recebe n = 0).';
revoke all on function public.mercado_m2(text, text, numeric, numeric, text, boolean) from public, anon;
grant execute on function public.mercado_m2(text, text, numeric, numeric, text, boolean) to authenticated, service_role;

create or replace function public.mercado_liquidez(
  p_regiao text,
  p_sub    text,
  p_modo   text default 'venda',
  p_dias   int  default 60)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select to_jsonb(r) from app.mercado_liquidez(p_regiao, p_sub, p_modo, p_dias) r
$$;
comment on function public.mercado_liquidez(text, text, text, int) is
  'app.mercado_liquidez pela API, com a RLS de quem chama.';
revoke all on function public.mercado_liquidez(text, text, text, int) from public, anon;
grant execute on function public.mercado_liquidez(text, text, text, int) to authenticated, service_role;

  $ddl$;
end $contas$;

notify pgrst, 'reload schema';

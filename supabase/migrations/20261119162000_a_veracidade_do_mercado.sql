-- =====================================================================
-- A veracidade do mercado no Postgres — só na Imova (18/11/2026)
--
-- Terceira das cinco migrações da inteligência de mercado (ver a 210000).
-- As regras de `_redesign/pipeline/veracidade.md` que cabem no banco, com as
-- réguas lidas de `mercado_regras` (a mesma versão que o protótipo lê):
--
--   * `app.mercado_carteira()`: os imóveis da Imova (aba Anúncios e os feitos
--     à mão no Canal Pro que ainda não vieram para o CRM — só a lista que já
--     está no banco, nenhum acesso ao portal), com tipo refinado e região.
--   * `mercado_pares`: o anúncio de terceiros que É um imóvel nosso
--     (`proprio`) ou que PODE SER o mesmo imóvel (`possivel_mesmo`), com a
--     decisão da equipe (`public.mercado_par_decidir`). "Não é" vale enquanto
--     o preço do anúncio não muda mais de 10%.
--   * `app.mercado_verificar()`: refaz, para todos os anúncios, nesta ordem:
--       contestado (fica) → par decidido como nosso → validade (vivo em 8
--       dias; levantamento manual até 17/12/2026; fora do ar) → V2 faixas
--       duras por tipo → V3 coerência (áreas trocadas, tipo duvidoso, provável
--       aluguel, área ambígua, consulta incompleta) → V5 imóvel nosso (3% de
--       área e preço) e possível mesmo imóvel (60% a 140% do preço) → V6 quase
--       gêmeos por âncora (fica o mais barato) → V7 cerca de 3 intervalos
--       interquartis no log do m² (só marca) → V8 confronto das células.
--     Roda sozinho ao fechar cada coleta e uma vez por dia (214000).
--   * `mercado_celulas` e `app.mercado_confrontar_celulas()`: a mediana de
--     cada região × tipo contra A Corrida dos Bairros (concorda até 25%,
--     alerta até 40%, quarentena acima) e o salto de uma rodada para a outra.
--     `public.mercado_celula_liberar` registra a causa escrita (admin e gestor).
--   * `app.mercado_preco_bloqueado(código)`: o argumento de preço do imóvel
--     nosso fica bloqueado enquanto houver par sem decisão.
--
-- Na KOMUNE não cria nada.
--
-- COMO DESFAZER (no banco da Imova; antes, desfazer a 214000 e a 213000):
--   drop function if exists app.mercado_verificar(), app.mercado_confrontar_celulas(),
--     app.mercado_carteira(), app.mercado_preco_bloqueado(text), app.mercado_par_vigente(text, bigint, bigint),
--     public.mercado_par_decidir(text, uuid, text, text), public.mercado_celula_liberar(text, text, text, text);
--   drop table if exists public.mercado_celulas, public.mercado_pares, app.mercado_verificar_v,
--     app.mercado_verificar_anc;
--   update public.mercado_anuncios set estado = 'ok', motivo = null, marcas = '{}', grupo_dup = null,
--     nosso_imovel_codigo = null, possivel_mesmo_imovel = false;
-- =====================================================================

do $veracidade$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A inteligência de mercado é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. A carteira da Imova, vista pelo mercado
-- =====================================================================
create or replace function app.mercado_carteira()
returns table (
  codigo        text,
  origem        text,
  anuncio_id    uuid,
  tipo          text,
  sub           text,
  negocio       text,
  preco_venda   bigint,
  preco_aluguel bigint,
  area_util     numeric,
  area_total    numeric,
  area_ref      numeric,
  quartos       smallint,
  bairro        text,
  cidade        text,
  logradouro    text,
  regiao_id     text,
  situacao      text)
language sql
stable
security definer
set search_path = ''
as $$
  with crm as (
    select a.codigo, 'crm'::text as origem, a.id as anuncio_id, a.tipo, a.negocio, a.preco_venda, a.preco_aluguel,
           a.area_util::numeric as area_util, a.area_total::numeric as area_total, a.quartos,
           a.bairro, a.cidade, a.endereco as logradouro, a.titulo, a.situacao
      from public.anuncios a
     where a.excluido_em is null
  ),
  manual as (
    select m.codigo, 'canal_pro'::text as origem, null::uuid as anuncio_id, coalesce(m.tipo_crm, 'terreno') as tipo,
           m.negocio, m.preco_venda, m.preco_aluguel,
           case when app.mercado_tipo_base(coalesce(m.tipo_crm, '')) in ('terreno', 'rural') then null else m.area::numeric end,
           case when app.mercado_tipo_base(coalesce(m.tipo_crm, '')) in ('terreno', 'rural') then m.area::numeric end,
           m.quartos, m.bairro, m.cidade, m.endereco, m.titulo, coalesce(m.situacao, 'no_ar')
      from public.anuncios_no_canal_pro m
     where m.excluido_em is null and m.no_relatorio and m.anuncio_id is null and m.tipo_crm is not null
  ),
  todos as (
    select * from crm
    union all
    select * from manual where not exists (select 1 from crm where crm.codigo = manual.codigo)
  ),
  ref as (
    select t.*,
           case when t.area_util is not null and t.area_total is not null and t.area_util > 1.05 * t.area_total
                  then t.area_total
                when t.tipo in ('terreno', 'terreno_comercial', 'lote', 'galpao', 'chacara', 'fazenda_sitio')
                  then coalesce(t.area_total, t.area_util)
                else coalesce(t.area_util, t.area_total) end as area_ref
      from todos t
  )
  select r.codigo, r.origem, r.anuncio_id, r.tipo,
         app.mercado_sub(r.tipo, r.area_ref, '{}'::jsonb, null, r.titulo),
         r.negocio, r.preco_venda, r.preco_aluguel, r.area_util, r.area_total, r.area_ref, r.quartos,
         r.bairro, r.cidade, r.logradouro, app.mercado_regiao_do_bairro(r.bairro, r.cidade), r.situacao
    from ref r
$$;
comment on function app.mercado_carteira() is
  'Os imóveis da carteira da Imova (aba Anúncios, menos os excluídos, e os feitos à mão no Canal Pro ainda não trazidos, pelo relatório que já está no banco), com tipo refinado, área de referência e região de mercado.';
revoke all on function app.mercado_carteira() from public, anon;
grant execute on function app.mercado_carteira() to authenticated, service_role;

-- =====================================================================
-- 2. Os pares "imóvel nosso × anúncio de terceiros"
-- =====================================================================
create table if not exists public.mercado_pares (
  id                 bigint generated always as identity primary key,
  imovel_codigo      text not null check (char_length(imovel_codigo) between 1 and 80),
  mercado_anuncio_id uuid not null references public.mercado_anuncios (id) on delete cascade,
  -- proprio: é o nosso (sai das contas); possivel_mesmo: pode ser o mesmo imóvel
  -- anunciado por outro (bloqueia o preço do nosso).
  tipo               text not null check (tipo in ('proprio', 'possivel_mesmo')),
  -- A regra que achou (regra_3pct, faixa_preco, mesma_rua, conferencia, equipe).
  regra              text not null check (char_length(regra) between 2 and 60),
  preco_na_marca     bigint,
  criado_em          timestamptz not null default now(),
  -- e_nosso, mesmo_outra_imobiliaria e mesmo_preco_antigo: fora das contas;
  -- nao_e: some da lista enquanto o preço do anúncio não mudar mais de 10%.
  decisao            text check (decisao in ('e_nosso', 'mesmo_outra_imobiliaria', 'mesmo_preco_antigo', 'nao_e')),
  preco_na_decisao   bigint,
  decidido_por       uuid references public.profiles (id) on delete set null,
  decidido_em        timestamptz,
  obs                text check (char_length(obs) <= 1000),
  unique (imovel_codigo, mercado_anuncio_id),
  check ((decisao is null) = (decidido_em is null))
);
create index if not exists mercado_pares_anuncio_idx on public.mercado_pares (mercado_anuncio_id);
comment on table public.mercado_pares is
  'Anúncio de terceiros que é (proprio) ou pode ser (possivel_mesmo) um imóvel da carteira, com a decisão da equipe. Escrita pelas funções (app.mercado_verificar, public.mercado_par_decidir, public.mercado_conferir).';

alter table public.mercado_pares enable row level security;
drop policy if exists mercado_pares_select on public.mercado_pares;
create policy mercado_pares_select on public.mercado_pares
  for select to authenticated using ((select app.is_manager()));
revoke all on public.mercado_pares from anon;
revoke insert, update, delete, truncate, references, trigger on public.mercado_pares from authenticated, service_role;
grant select on public.mercado_pares to authenticated, service_role;
revoke all on sequence public.mercado_pares_id_seq from anon, authenticated;

-- A decisão ainda vale? "Não é" cai quando o preço do anúncio muda mais de 10%.
create or replace function app.mercado_par_vigente(p_decisao text, p_preco_decisao bigint, p_preco_atual bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
           when p_decisao is null then false
           when p_decisao <> 'nao_e' then true
           when p_preco_decisao is null or p_preco_atual is null then true
           else abs(p_preco_atual::numeric / p_preco_decisao - 1) <= app.mercado_regra_num('{proprio,nao_e_ate}', 0.10)
         end
$$;
revoke all on function app.mercado_par_vigente(text, bigint, bigint) from public, anon;
grant execute on function app.mercado_par_vigente(text, bigint, bigint) to authenticated, service_role;

-- A equipe decide um par (ou marca à mão que um anúncio é nosso). Admin,
-- gestor e SDR: é trabalho de conferência.
create or replace function public.mercado_par_decidir(
  p_codigo text, p_anuncio uuid, p_decisao text, p_obs text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.mercado_anuncios;
  v_tipo text;
begin
  if not app.is_manager() then
    raise exception 'Só admin, gestor e SDR decidem um par de mercado.' using errcode = '42501';
  end if;
  if p_decisao is null or p_decisao not in ('e_nosso', 'mesmo_outra_imobiliaria', 'mesmo_preco_antigo', 'nao_e') then
    return jsonb_build_object('ok', false, 'motivo', 'decisao_invalida');
  end if;
  if not exists (select 1 from app.mercado_carteira() k where k.codigo = p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'imovel_desconhecido');
  end if;
  select * into a from public.mercado_anuncios where id = p_anuncio;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'anuncio_desconhecido');
  end if;
  v_tipo := case when p_decisao = 'e_nosso' then 'proprio' else 'possivel_mesmo' end;
  insert into public.mercado_pares as p
    (imovel_codigo, mercado_anuncio_id, tipo, regra, preco_na_marca, decisao, preco_na_decisao,
     decidido_por, decidido_em, obs)
  values (p_codigo, a.id, v_tipo, 'equipe', a.preco, p_decisao, a.preco, auth.uid(), now(),
          left(nullif(btrim(p_obs), ''), 1000))
  on conflict (imovel_codigo, mercado_anuncio_id) do update
    set decisao = excluded.decisao, preco_na_decisao = excluded.preco_na_decisao,
        decidido_por = excluded.decidido_por, decidido_em = excluded.decidido_em,
        tipo = case when excluded.decisao = 'e_nosso' then 'proprio' else p.tipo end,
        obs = coalesce(excluded.obs, p.obs);
  perform app.mercado_verificar();
  return jsonb_build_object('ok', true, 'imovel', p_codigo, 'anuncio', a.id, 'decisao', p_decisao,
                            'estado', (select x.estado from public.mercado_anuncios x where x.id = a.id));
end $$;
comment on function public.mercado_par_decidir(text, uuid, text, text) is
  'A equipe (admin, gestor e SDR) decide se um anúncio de terceiros é um imóvel nosso (e_nosso), o mesmo anunciado por outra imobiliária, o mesmo com preço antigo, ou não é. Refaz a veracidade na hora.';
revoke all on function public.mercado_par_decidir(text, uuid, text, text) from public, anon;
grant execute on function public.mercado_par_decidir(text, uuid, text, text) to authenticated;

-- O argumento de preço do imóvel nosso fica bloqueado com par sem decisão
-- (ou com "não é" que caducou porque o preço mudou).
create or replace function app.mercado_preco_bloqueado(p_codigo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.mercado_pares p
      join public.mercado_anuncios a on a.id = p.mercado_anuncio_id
     where p.imovel_codigo = p_codigo
       and a.estado <> 'vencido'
       and not app.mercado_par_vigente(p.decisao, p.preco_na_decisao, a.preco))
$$;
comment on function app.mercado_preco_bloqueado(text) is
  'O imóvel da carteira tem par com anúncio de terceiros ainda sem decisão da equipe: nenhum argumento de preço até decidir.';
revoke all on function app.mercado_preco_bloqueado(text) from public, anon;
grant execute on function app.mercado_preco_bloqueado(text) to authenticated, service_role;

-- =====================================================================
-- 3. As células (região × tipo) e o confronto com as referências
-- =====================================================================
create table if not exists public.mercado_celulas (
  regiao_id           text not null references public.mercado_regioes (id) on delete cascade,
  modo                text not null check (modo in ('venda', 'aluguel')),
  sub                 text not null check (sub ~ '^[a-z_]{2,40}$'),
  n                   int not null default 0,
  q1                  numeric,
  mediana             numeric,
  q3                  numeric,
  n_anterior          int,
  mediana_anterior    numeric,
  -- A última coleta automática boa que entrou na conta (para medir o salto entre rodadas).
  rodada_ref          timestamptz,
  referencia_serie    text,
  referencia_mes      date,
  referencia_mediana  numeric,
  referencia_n        int,
  -- ln(nossa mediana ÷ mediana da referência).
  d                   numeric,
  -- concorda, alerta, quarentena, sem_referencia (a Corrida não cobre) ou
  -- pouco (menos de 20 imóveis distintos: não dá para conferir).
  estado              text not null default 'sem_referencia'
                        check (estado in ('concorda', 'alerta', 'quarentena', 'sem_referencia', 'pouco')),
  -- A mediana mudou mais de 15% de uma rodada para a outra sem o FipeZAP mudar:
  -- as vantagens da célula não se renovam sozinhas.
  salto               boolean not null default false,
  quarentena_desde    timestamptz,
  causa               text check (char_length(causa) <= 2000),
  causa_aprovada_por  uuid references public.profiles (id) on delete set null,
  causa_aprovada_em   timestamptz,
  calculada_em        timestamptz not null default now(),
  primary key (regiao_id, modo, sub)
);
comment on table public.mercado_celulas is
  'Cada região × modo × tipo refinado: mediana do m² (imóveis distintos ok), confronto com A Corrida dos Bairros (concorda até 25%, alerta até 40%, quarentena acima) e salto entre rodadas. Calculada por app.mercado_confrontar_celulas.';

alter table public.mercado_celulas enable row level security;
drop policy if exists mercado_celulas_select on public.mercado_celulas;
create policy mercado_celulas_select on public.mercado_celulas
  for select to authenticated using ((select app.is_manager()));
revoke all on public.mercado_celulas from anon;
revoke insert, update, delete, truncate, references, trigger on public.mercado_celulas from authenticated, service_role;
grant select on public.mercado_celulas to authenticated, service_role;

create or replace function app.mercado_confrontar_celulas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rodada   timestamptz;
  v_prefixo  text := coalesce(app.mercado_regras() #>> '{confronto_corrida,serie_prefixo}', 'corrida-');
  v_nmin     numeric := app.mercado_regra_num('{confronto_corrida,n_min}', 20);
  v_alerta   numeric := ln(1 + app.mercado_regra_num('{confronto_corrida,alerta}', 0.25));
  v_quar     numeric := ln(1 + app.mercado_regra_num('{confronto_corrida,quarentena}', 0.40));
  v_salto    numeric := app.mercado_regra_num('{confronto_fipezap,salto}', 0.15);
  v_salto_n  numeric := app.mercado_regra_num('{confronto_fipezap,salto_n_min}', 30);
  v_sfipe    numeric := app.mercado_regra_num('{confronto_fipezap,salto_fipe}', 0.02);
  v_serie    text := coalesce(app.mercado_regras() #>> '{confronto_fipezap,serie_cidade}', 'fipezap-natal-venda');
  v_vmax     numeric := app.mercado_regra_num('{validade_dias,corrida_max}', 60);
  v_fipe_var numeric;
  v_n        int;
begin
  select max(c.fim) into v_rodada
    from public.mercado_coletas c
   where c.origem = 'auto' and c.situacao = 'ok';

  -- A variação do FipeZAP da cidade no último mês (sem dado: desconhecida).
  select abs(x.v1 / nullif(x.v0, 0) - 1) into v_fipe_var
    from (select (array_agg(i.valor order by i.mes desc))[1] as v1,
                 (array_agg(i.valor order by i.mes desc))[2] as v0
            from public.mercado_indices i where i.serie = v_serie) x;

  -- Rodada nova: a mediana atual vira a anterior antes da conta.
  update public.mercado_celulas c
     set n_anterior = c.n, mediana_anterior = c.mediana, rodada_ref = v_rodada
   where v_rodada is not null and (c.rodada_ref is null or c.rodada_ref < v_rodada);

  with base as (
    select a.regiao_id, a.modo, a.sub, a.m2::float8 as m2
      from public.mercado_anuncios a
     where a.estado = 'ok' and a.representante and a.consulta_completa
       and a.regiao_id is not null and a.sub is not null and a.m2 is not null
       and not (a.marcas && array['tipo_duvidoso', 'area_ambigua']::text[])
  ),
  conta as (
    select b.regiao_id, b.modo, b.sub, count(*)::int as n,
           round((percentile_cont(0.25) within group (order by b.m2))::numeric, 2) as q1,
           round((percentile_cont(0.5)  within group (order by b.m2))::numeric, 2) as mediana,
           round((percentile_cont(0.75) within group (order by b.m2))::numeric, 2) as q3
      from base b
     group by 1, 2, 3
  ),
  com_ref as (
    select k.*, r.serie as rserie, r.mes as rmes, r.valor as rmed, r.amostra as rn
      from conta k
      left join lateral (
        select i.* from public.mercado_indices i
         where i.serie like v_prefixo || '%'
           and i.regiao_id = k.regiao_id and i.sub = k.sub and coalesce(i.modo, 'venda') = k.modo
           and coalesce(i.amostra, 0) >= v_nmin and not i.aproximado and i.valor > 0
           and i.mes >= (app.mercado_hoje() - make_interval(days => v_vmax::int + 31))::date
         order by i.mes desc limit 1) r on true
  )
  insert into public.mercado_celulas as c
    (regiao_id, modo, sub, n, q1, mediana, q3, rodada_ref, referencia_serie, referencia_mes,
     referencia_mediana, referencia_n, d, estado, calculada_em)
  select x.regiao_id, x.modo, x.sub, x.n, x.q1, x.mediana, x.q3, v_rodada, x.rserie, x.rmes, x.rmed, x.rn,
         case when x.rmed is not null and x.mediana > 0 then round(ln(x.mediana / x.rmed), 4) end,
         case when x.rmed is null then 'sem_referencia'
              when x.n < v_nmin then 'pouco'
              when abs(ln(x.mediana / x.rmed)) <= v_alerta then 'concorda'
              when abs(ln(x.mediana / x.rmed)) <= v_quar then 'alerta'
              else 'quarentena' end,
         now()
    from com_ref x
  on conflict (regiao_id, modo, sub) do update
    set n = excluded.n, q1 = excluded.q1, mediana = excluded.mediana, q3 = excluded.q3,
        rodada_ref = coalesce(c.rodada_ref, excluded.rodada_ref),
        referencia_serie = excluded.referencia_serie, referencia_mes = excluded.referencia_mes,
        referencia_mediana = excluded.referencia_mediana, referencia_n = excluded.referencia_n,
        d = excluded.d,
        -- Da quarentena só se sai com uma rodada que concorda, ou com a causa
        -- escrita e aprovada (e aí fica, no máximo, em alerta: sem adjetivo).
        estado = case
                   when c.estado = 'quarentena' and excluded.estado in ('alerta', 'quarentena')
                     then case when c.causa_aprovada_em is not null then 'alerta' else 'quarentena' end
                   when c.estado = 'quarentena' and excluded.estado in ('sem_referencia', 'pouco')
                        and c.causa_aprovada_em is null then 'quarentena'
                   when excluded.estado = 'quarentena' and c.causa_aprovada_em is not null
                        and c.quarentena_desde is not null then 'alerta'
                   else excluded.estado end,
        calculada_em = now();
  get diagnostics v_n = row_count;

  -- Célula que ficou sem anúncio nenhum: zera a conta, guarda o histórico.
  update public.mercado_celulas c
     set n = 0, q1 = null, mediana = null, q3 = null, d = null,
         estado = case when c.estado = 'quarentena' and c.causa_aprovada_em is null then 'quarentena' else 'pouco' end,
         calculada_em = now()
   where not exists (
           select 1 from public.mercado_anuncios a
            where a.regiao_id = c.regiao_id and a.modo = c.modo and a.sub = c.sub
              and a.estado = 'ok' and a.representante and a.m2 is not null)
     and c.n > 0;

  update public.mercado_celulas c
     set quarentena_desde = case when c.estado = 'quarentena' then coalesce(c.quarentena_desde, now()) end,
         causa = case when c.estado = 'concorda' then null else c.causa end,
         causa_aprovada_por = case when c.estado = 'concorda' then null else c.causa_aprovada_por end,
         causa_aprovada_em = case when c.estado = 'concorda' then null else c.causa_aprovada_em end,
         salto = coalesce(c.n, 0) >= v_salto_n and coalesce(c.n_anterior, 0) >= v_salto_n
                 and c.mediana_anterior > 0
                 and abs(c.mediana / c.mediana_anterior - 1) > v_salto
                 and (v_fipe_var is null or v_fipe_var <= v_sfipe);
  return v_n;
end $$;
comment on function app.mercado_confrontar_celulas() is
  'V8: recalcula mercado_celulas (mediana do m² de cada região × modo × tipo refinado, confronto com A Corrida dos Bairros, salto entre rodadas). Quarentena só sai com uma rodada que concorda ou com a causa aprovada (fica em alerta).';
revoke all on function app.mercado_confrontar_celulas() from public, anon, authenticated;
grant execute on function app.mercado_confrontar_celulas() to service_role;

create or replace function public.mercado_celula_liberar(p_regiao text, p_modo text, p_sub text, p_causa text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
begin
  if not app.admin_ou_gestor() then
    raise exception 'Só admin e gestor aprovam a causa de uma quarentena.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_causa, ''))) < 10 then
    return jsonb_build_object('ok', false, 'motivo', 'causa_obrigatoria');
  end if;
  update public.mercado_celulas c
     set causa = left(btrim(p_causa), 2000), causa_aprovada_por = auth.uid(), causa_aprovada_em = now(),
         estado = case when c.estado = 'quarentena' then 'alerta' else c.estado end
   where c.regiao_id = p_regiao and c.modo = p_modo and c.sub = p_sub
  returning c.estado into v_estado;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'celula_desconhecida');
  end if;
  return jsonb_build_object('ok', true, 'estado', v_estado);
end $$;
comment on function public.mercado_celula_liberar(text, text, text, text) is
  'Admin e gestor registram a causa escrita de uma quarentena de célula; a célula vai para alerta (vantagens de preço sem adjetivo).';
revoke all on function public.mercado_celula_liberar(text, text, text, text) from public, anon;
grant execute on function public.mercado_celula_liberar(text, text, text, text) to authenticated;

-- =====================================================================
-- 4. A verificação inteira (V2 a V8), idempotente
-- =====================================================================
-- As duas tabelas de trabalho da verificação. Nascem aqui, e não como tabela
-- temporária dentro da função: o `supabase db lint` (plpgsql_check) não acha
-- tabela criada no meio da função e reprova o CI. São do banco inteiro, por
-- isso a verificação segura uma trava (uma por vez) e as esvazia no começo e
-- no fim. Sem log (unlogged): é rascunho, refeito a cada verificação.
create unlogged table if not exists app.mercado_verificar_v (
  id uuid primary key, estado text, motivo text, marcas text[], nosso text, possivel boolean, grupo uuid
);
create unlogged table if not exists app.mercado_verificar_anc (
  id uuid primary key, regiao_id text, modo text, sub text, preco bigint, area_ref numeric,
  quartos smallint, rua text, lat numeric, lng numeric, loc text, foto bit(64), membros int
);
create index if not exists mercado_verificar_anc_celula on app.mercado_verificar_anc (regiao_id, modo, sub, preco);
comment on table app.mercado_verificar_v is
  'Rascunho de app.mercado_verificar (o estado de cada anúncio antes de gravar). Esvaziada a cada verificação; ninguém lê nem escreve fora da função.';
comment on table app.mercado_verificar_anc is
  'Rascunho de app.mercado_verificar (as âncoras dos quase gêmeos, V6). Esvaziada a cada verificação.';
alter table app.mercado_verificar_v enable row level security;
alter table app.mercado_verificar_anc enable row level security;
revoke all on app.mercado_verificar_v, app.mercado_verificar_anc from public, anon, authenticated, service_role;

create or replace function app.mercado_verificar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rg          jsonb := app.mercado_regras();
  v_vivo      int := app.mercado_regra_num('{validade_dias,vivo}', 8)::int;
  v_manual    date := coalesce(nullif(rg #>> '{manual,frase_ate}', '')::date, '2026-12-17'::date);
  v_pmin      numeric := coalesce((rg #>> '{preco_venda,0}')::numeric, 20000);
  v_pmax      numeric := coalesce((rg #>> '{preco_venda,1}')::numeric, 100000000);
  v_almin     numeric := coalesce((rg #>> '{aluguel_m2_mes,0}')::numeric, 2);
  v_almax     numeric := coalesce((rg #>> '{aluguel_m2_mes,1}')::numeric, 400);
  v_trocadas  numeric := app.mercado_regra_num('{coerencia,areas_trocadas}', 1.05);
  v_alug_x    numeric := app.mercado_regra_num('{coerencia,aluguel_vezes}', 60);
  v_alug_n    numeric := app.mercado_regra_num('{coerencia,aluguel_n_min}', 5);
  v_amb       numeric := app.mercado_regra_num('{coerencia,area_ambigua}', 1.5);
  v_amb_n     numeric := app.mercado_regra_num('{coerencia,area_ambigua_n_min}', 5);
  v_p_area    numeric := app.mercado_regra_num('{proprio,area}', 0.03);
  v_p_preco   numeric := app.mercado_regra_num('{proprio,preco}', 0.03);
  v_c_lo      numeric := coalesce((rg #>> '{proprio,conferir_preco,0}')::numeric, 0.60);
  v_c_hi      numeric := coalesce((rg #>> '{proprio,conferir_preco,1}')::numeric, 1.40);
  v_anel      numeric := app.mercado_regra_num('{proprio,anel_km}', 3);
  v_g_area    numeric := app.mercado_regra_num('{gemeos,area}', 0.02);
  v_g_preco   numeric := app.mercado_regra_num('{gemeos,preco}', 0.03);
  v_g_ham     numeric := app.mercado_regra_num('{gemeos,foto_hamming}', 6);
  v_g_farea   numeric := app.mercado_regra_num('{gemeos,foto_area}', 0.10);
  v_g_m       numeric := app.mercado_regra_num('{gemeos,ponto_m}', 30);
  v_g_parea   numeric := app.mercado_regra_num('{gemeos,ponto_area}', 0.03);
  v_k         numeric := app.mercado_regra_num('{cerca_iqr,k}', 3);
  v_nbase     numeric := app.mercado_regra_num('{cerca_iqr,n_base}', 20);
  r           record;
  v_anc       uuid;
  v_grupos    int;
  v_celulas   int;
  v_mudou     int;
begin
  -- O tipo refinado depende das réguas (gleba): refaz onde mudou.
  update public.mercado_anuncios a
     set sub = app.mercado_sub(a.tipo, a.area_ref, a.atributos, a.subtipo, a.titulo)
   where a.sub is distinct from app.mercado_sub(a.tipo, a.area_ref, a.atributos, a.subtipo, a.titulo);

  -- Uma verificação por vez (as tabelas de trabalho são do banco inteiro).
  perform pg_advisory_xact_lock(hashtext('app.mercado_verificar'));
  truncate app.mercado_verificar_v, app.mercado_verificar_anc;
  insert into app.mercado_verificar_v (id, estado, motivo, marcas, nosso, possivel, grupo)
  select a.id,
         case when a.estado = 'contestado' then 'contestado' end,
         case when a.estado = 'contestado' then a.motivo end,
         coalesce(a.marcas_do_coletor, '{}'), null, false, null
    from public.mercado_anuncios a;

  -- Par decidido como nosso (ou o mesmo imóvel por outra imobiliária, ou com preço antigo).
  update app.mercado_verificar_v v
     set estado = coalesce(v.estado, 'oculto_proprio'),
         motivo = coalesce(v.motivo, p.decisao),
         nosso = p.imovel_codigo
    from public.mercado_pares p
   where p.mercado_anuncio_id = v.id
     and p.decisao in ('e_nosso', 'mesmo_outra_imobiliaria', 'mesmo_preco_antigo');

  -- Validade: fora do ar; automático não visto há mais de 8 dias; levantamento manual vencido.
  update app.mercado_verificar_v v
     set estado = 'vencido',
         motivo = case when a.saiu_do_ar_em is not null then 'fora_do_ar'
                       when a.origem = 'manual' then 'levantamento_manual_vencido'
                       else 'nao_visto_' || v_vivo || '_dias' end
    from public.mercado_anuncios a
   where a.id = v.id and v.estado is null
     and (a.saiu_do_ar_em is not null
          or (a.origem = 'auto' and a.ultima_vez_visto < now() - make_interval(days => v_vivo))
          or (a.origem = 'manual' and app.mercado_hoje() > v_manual));

  -- V2: campos mínimos e faixas duras por tipo (§5.1 e §5.2).
  update app.mercado_verificar_v v
     set estado = 'fora',
         motivo = x.motivo
    from (
      select a.id,
             case
               when a.preco is null then 'sem_preco'
               when a.area_ref is null then 'sem_area'
               when a.modo = 'venda' and a.preco < v_pmin then 'preco_baixo'
               when a.modo = 'venda' and a.preco > v_pmax then 'preco_alto'
               when a.modo = 'aluguel' and a.m2 < v_almin then 'm2_baixo'
               when a.modo = 'aluguel' and a.m2 > v_almax then 'm2_alto'
               when a.modo = 'venda' and f.faixa is not null and jsonb_typeof(f.faixa #> '{area,0}') = 'number'
                    and a.area_ref < (f.faixa #>> '{area,0}')::numeric then 'area_baixa'
               when a.modo = 'venda' and f.faixa is not null and jsonb_typeof(f.faixa #> '{area,1}') = 'number'
                    and a.area_ref > (f.faixa #>> '{area,1}')::numeric then 'area_alta'
               when a.modo = 'venda' and f.faixa is not null and jsonb_typeof(f.faixa #> '{m2,0}') = 'number'
                    and a.m2 < (f.faixa #>> '{m2,0}')::numeric then 'm2_baixo'
               when a.modo = 'venda' and f.faixa is not null and jsonb_typeof(f.faixa #> '{m2,1}') = 'number'
                    and a.m2 > (f.faixa #>> '{m2,1}')::numeric then 'm2_alto'
             end as motivo
        from public.mercado_anuncios a
        cross join lateral (
          select rg -> 'faixas_venda' -> (case a.sub when 'terreno_condominio' then 'terreno' else a.sub end) as faixa
        ) f
    ) x
   where x.id = v.id and v.estado is null and x.motivo is not null;

  -- V3: coerência interna (§5.3).
  update app.mercado_verificar_v v
     set marcas = v.marcas
                  || case when a.area_util is not null and a.area_total is not null
                               and a.area_util > v_trocadas * a.area_total then array['areas_trocadas'] else '{}' end
                  || case when app.mercado_tipo_base(a.tipo) = 'terreno'
                               and (coalesce(a.quartos, 0) > 0
                                    or (coalesce(app.mercado_texto_chave(a.titulo), '') ~ '\m(apartamento|casa|sala)\M'
                                        and coalesce(app.mercado_texto_chave(a.titulo), '') !~ '\m(terreno|lote|loteamento|area)\M'))
                          then array['tipo_duvidoso']
                          when app.mercado_tipo_base(a.tipo) in ('casa', 'apartamento')
                               and coalesce(app.mercado_texto_chave(a.titulo), '') ~ '\m(terreno|lote)\M'
                               and coalesce(app.mercado_texto_chave(a.titulo), '') !~ '\m(casa|apartamento|sobrado|apto)\M'
                          then array['tipo_duvidoso'] else '{}' end
                  || case when not a.consulta_completa then array['consulta_incompleta'] else '{}' end
                  || case when a.origem = 'manual' then array['origem_manual'] else '{}' end
    from public.mercado_anuncios a
   where a.id = v.id;

  -- C4: venda por menos de 60 vezes o aluguel mediano do mesmo tipo e região.
  update app.mercado_verificar_v v
     set estado = 'fora', motivo = 'provavel_aluguel'
    from public.mercado_anuncios a
    join (select a2.regiao_id, a2.sub, percentile_cont(0.5) within group (order by a2.preco) as mediana, count(*) as n
            from public.mercado_anuncios a2
            join app.mercado_verificar_v v2 on v2.id = a2.id and v2.estado is null
           where a2.modo = 'aluguel' and a2.preco is not null and a2.regiao_id is not null
           group by 1, 2) al on al.regiao_id = a.regiao_id and al.sub = a.sub and al.n >= v_alug_n
   where a.id = v.id and v.estado is null and a.modo = 'venda'
     and a.preco < v_alug_x * al.mediana;

  -- C5: casa com a área útil igual à total e maior que 1,5 vez a mediana de útil da região.
  update app.mercado_verificar_v v
     set marcas = v.marcas || array['area_ambigua']
    from public.mercado_anuncios a
    join (select a2.regiao_id, percentile_cont(0.5) within group (order by a2.area_util) as mediana, count(*) as n
            from public.mercado_anuncios a2
            join app.mercado_verificar_v v2 on v2.id = a2.id and v2.estado is null
           where app.mercado_tipo_base(a2.tipo) = 'casa' and a2.area_util is not null and a2.regiao_id is not null
           group by 1) md on md.regiao_id = a.regiao_id and md.n >= v_amb_n
   where a.id = v.id and v.estado is null
     and app.mercado_tipo_base(a.tipo) = 'casa'
     and a.area_util is not null and a.area_util = a.area_total
     and a.area_util > v_amb * md.mediana;

  -- V5: imóvel nosso pela regra de 3% (§9.1 c). Na casa, toda área que as duas
  -- fichas têm precisa bater, e pelo menos uma precisa existir.
  with k as (select * from app.mercado_carteira()),
  achados as (
    select distinct on (a.id) a.id, k.codigo, a.preco
      from public.mercado_anuncios a
      join app.mercado_verificar_v v on v.id = a.id and v.estado is null
      join k on k.regiao_id = a.regiao_id
            and app.mercado_tipo_base(k.tipo) = app.mercado_tipo_base(a.tipo)
            and ((a.modo = 'venda' and k.negocio in ('venda', 'venda_aluguel') and k.preco_venda is not null
                  and abs(a.preco::numeric / k.preco_venda - 1) <= v_p_preco)
              or (a.modo = 'aluguel' and k.negocio in ('aluguel', 'venda_aluguel') and k.preco_aluguel is not null
                  and abs(a.preco::numeric / k.preco_aluguel - 1) <= v_p_preco))
            and (case when app.mercado_tipo_base(a.tipo) = 'casa' then
                   (a.area_util is not null and k.area_util is not null or a.area_total is not null and k.area_total is not null)
                   and (a.area_util is null or k.area_util is null or abs(a.area_util / k.area_util - 1) <= v_p_area)
                   and (a.area_total is null or k.area_total is null or abs(a.area_total / k.area_total - 1) <= v_p_area)
                 else a.area_ref is not null and k.area_ref is not null and abs(a.area_ref / k.area_ref - 1) <= v_p_area
                 end)
      left join public.mercado_pares p on p.mercado_anuncio_id = a.id and p.imovel_codigo = k.codigo
     where a.preco is not null
       and not coalesce(app.mercado_par_vigente(p.decisao, p.preco_na_decisao, a.preco) and p.decisao = 'nao_e', false)
     order by a.id, k.codigo
  ),
  marca as (
    update app.mercado_verificar_v v
       set estado = 'oculto_proprio', motivo = 'regra_3pct', nosso = x.codigo
      from achados x where x.id = v.id
    returning v.id, x.codigo, x.preco
  )
  insert into public.mercado_pares (imovel_codigo, mercado_anuncio_id, tipo, regra, preco_na_marca)
  select m.codigo, m.id, 'proprio', 'regra_3pct', m.preco from marca m
  on conflict (imovel_codigo, mercado_anuncio_id) do nothing;

  -- V5: possível o mesmo imóvel (§9.1): mesmo tipo, mesma região ou vizinha a até
  -- 3 km, área até 3% e preço entre 60% e 140% do nosso; ou mesma rua e mesmos quartos.
  with k as (select * from app.mercado_carteira()),
  achados as (
    select a.id, k.codigo, a.preco,
           case when k.logradouro is not null and a.logradouro is not null
                     and app.mercado_texto_chave(k.logradouro) = app.mercado_texto_chave(a.logradouro)
                     and k.quartos is not null and k.quartos = a.quartos
                then 'mesma_rua' else 'faixa_preco' end as regra
      from public.mercado_anuncios a
      join app.mercado_verificar_v v on v.id = a.id and v.estado is null
      join k on app.mercado_tipo_base(k.tipo) = app.mercado_tipo_base(a.tipo)
     where a.preco is not null
       and (
             ( (a.regiao_id = k.regiao_id
                or exists (select 1 from public.mercado_regioes reg
                            cross join lateral jsonb_array_elements(reg.vizinhos) vz
                            where reg.id = k.regiao_id and vz ->> 'id' = a.regiao_id
                              and jsonb_typeof(vz -> 'km') = 'number' and (vz ->> 'km')::numeric <= v_anel))
               and a.area_ref is not null and k.area_ref is not null
               and abs(a.area_ref / k.area_ref - 1) <= v_p_area
               and ((a.modo = 'venda' and k.preco_venda is not null
                     and a.preco between v_c_lo * k.preco_venda and v_c_hi * k.preco_venda)
                 or (a.modo = 'aluguel' and k.preco_aluguel is not null
                     and a.preco between v_c_lo * k.preco_aluguel and v_c_hi * k.preco_aluguel)))
          or ( k.logradouro is not null and a.logradouro is not null and a.regiao_id = k.regiao_id
               and app.mercado_texto_chave(k.logradouro) = app.mercado_texto_chave(a.logradouro)
               and k.quartos is not null and k.quartos = a.quartos)
           )
  ),
  novos as (
    insert into public.mercado_pares (imovel_codigo, mercado_anuncio_id, tipo, regra, preco_na_marca)
    select x.codigo, x.id, 'possivel_mesmo', x.regra, x.preco from achados x
    on conflict (imovel_codigo, mercado_anuncio_id) do nothing
    returning 1
  )
  select count(*) into v_mudou from novos;

  update app.mercado_verificar_v v
     set possivel = true,
         marcas = v.marcas || array['possivel_mesmo_imovel']
   where v.estado is distinct from 'oculto_proprio'
     and exists (select 1 from public.mercado_pares p
                   join public.mercado_anuncios a on a.id = p.mercado_anuncio_id
                  where p.mercado_anuncio_id = v.id and p.tipo = 'possivel_mesmo'
                    and not app.mercado_par_vigente(p.decisao, p.preco_na_decisao, a.preco));

  -- V6: quase gêmeos por âncora (§4.2): por célula, do mais barato ao mais caro;
  -- entra no primeiro grupo cuja âncora case por foto (G1), ponto exato (G2) ou
  -- ficha (G3); senão abre um grupo novo. Fica só a âncora (o mais barato).
  for r in
    select a.id, a.regiao_id, a.modo, a.sub, a.preco, a.area_ref, a.quartos,
           app.mercado_texto_chave(a.logradouro) as rua, a.lat, a.lng, a.loc_precisao as loc, a.foto_hash as foto
      from public.mercado_anuncios a
      join app.mercado_verificar_v v on v.id = a.id and v.estado is null
     where a.regiao_id is not null and a.preco is not null and a.area_ref is not null and a.sub is not null
     order by a.regiao_id, a.modo, a.sub, a.preco, a.id
  loop
    select n.id into v_anc
      from app.mercado_verificar_anc n
     where n.regiao_id = r.regiao_id and n.modo = r.modo and n.sub = r.sub
       and (
             -- G3: a ficha.
             (abs(r.area_ref / n.area_ref - 1) <= v_g_area
              and abs(r.preco::numeric / n.preco - 1) <= v_g_preco
              and (r.quartos is null or n.quartos is null or r.quartos = n.quartos)
              and (r.rua is null or n.rua is null or r.rua = n.rua))
             -- G2: o mesmo ponto exato.
          or (r.loc = 'exata' and n.loc = 'exata' and r.lat is not null and n.lat is not null
              and extensions.st_distance(
                    extensions.st_setsrid(extensions.st_makepoint(r.lng::float8, r.lat::float8), 4326)::extensions.geography,
                    extensions.st_setsrid(extensions.st_makepoint(n.lng::float8, n.lat::float8), 4326)::extensions.geography)
                  <= v_g_m
              and abs(r.area_ref / n.area_ref - 1) <= v_g_parea)
             -- G1: a mesma foto.
          or (r.foto is not null and n.foto is not null
              and bit_count(r.foto # n.foto) <= v_g_ham
              and abs(r.area_ref / n.area_ref - 1) <= v_g_farea)
           )
     order by n.preco, n.id
     limit 1;
    if v_anc is null then
      insert into app.mercado_verificar_anc values (r.id, r.regiao_id, r.modo, r.sub, r.preco, r.area_ref, r.quartos,
                                      r.rua, r.lat, r.lng, r.loc, r.foto, 0);
    else
      update app.mercado_verificar_v set grupo = v_anc where id = r.id;
      update app.mercado_verificar_anc set membros = membros + 1 where id = v_anc;
    end if;
  end loop;
  update app.mercado_verificar_v v set grupo = v.id from app.mercado_verificar_anc n where n.id = v.id and n.membros > 0;
  select count(*) into v_grupos from app.mercado_verificar_anc where membros > 0;

  -- V7: a cerca de 3 intervalos interquartis no log do m², por tipo refinado e
  -- cidade, com 20 ou mais imóveis distintos: só marca (§5.4).
  with b as (
    select a.id, a.sub, app.mercado_texto_chave(a.cidade) as cidade, ln(a.m2::float8) as lm
      from public.mercado_anuncios a
      join app.mercado_verificar_v v on v.id = a.id and v.estado is null and (v.grupo is null or v.grupo = v.id)
     where a.modo = 'venda' and a.m2 > 0
  ),
  c as (
    select b.sub, b.cidade,
           percentile_cont(0.25) within group (order by b.lm) as q1,
           percentile_cont(0.75) within group (order by b.lm) as q3
      from b group by 1, 2 having count(*) >= v_nbase
  )
  update app.mercado_verificar_v v
     set marcas = v.marcas || array['suspeito_3iqr']
    from b join c on c.sub = b.sub and c.cidade is not distinct from b.cidade
   where v.id = b.id
     and (b.lm < c.q1 - v_k * (c.q3 - c.q1) or b.lm > c.q3 + v_k * (c.q3 - c.q1));

  -- Grava só o que mudou.
  update public.mercado_anuncios a
     set estado = coalesce(v.estado, 'ok'),
         motivo = v.motivo,
         marcas = array(select distinct m from unnest(v.marcas) m order by m),
         nosso_imovel_codigo = v.nosso,
         possivel_mesmo_imovel = v.possivel,
         grupo_dup = v.grupo,
         verificado_em = now()
    from app.mercado_verificar_v v
   where v.id = a.id
     and (a.estado, a.motivo, a.marcas, a.nosso_imovel_codigo, a.possivel_mesmo_imovel, a.grupo_dup)
         is distinct from
         (coalesce(v.estado, 'ok'), v.motivo, array(select distinct m from unnest(v.marcas) m order by m),
          v.nosso, v.possivel, v.grupo);
  get diagnostics v_mudou = row_count;

  truncate app.mercado_verificar_v, app.mercado_verificar_anc;
  v_celulas := app.mercado_confrontar_celulas();

  return jsonb_build_object(
    'mudaram', v_mudou,
    'grupos', v_grupos,
    'celulas', v_celulas,
    'estados', (select coalesce(jsonb_object_agg(x.estado, x.n), '{}'::jsonb)
                  from (select a.estado, count(*) as n from public.mercado_anuncios a group by 1) x));
end $$;
comment on function app.mercado_verificar() is
  'Refaz a veracidade de todos os anúncios de mercado (contestado, par decidido, validade, V2 faixas, V3 coerência, V5 imóvel nosso e possível mesmo imóvel, V6 quase gêmeos, V7 cerca 3·IQR) e o confronto das células (V8). Grava só o que mudou.';
revoke all on function app.mercado_verificar() from public, anon, authenticated;
grant execute on function app.mercado_verificar() to service_role;

  $ddl$;
end $veracidade$;

notify pgrst, 'reload schema';

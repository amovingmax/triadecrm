-- =====================================================================
-- A conferência semanal do mercado pela equipe — só na Imova (18/11/2026)
--
-- Quarta das cinco migrações da inteligência de mercado (ver a 210000).
-- Decisão do dono (18/11): além da veracidade automática, toda semana uma
-- pequena amostra vai para a equipe conferir no link (veracidade.md §11).
--
--   * `mercado_conferencias`: cada item sorteado (semana, estrato, link, o
--     que o sistema tem) e a resposta da equipe (quem conferiu, quando, ok ou
--     errado, o que viu, observação). Nunca é apagada; a resposta, depois de
--     dada, não muda (só a causa do erro e a reclassificação "desatualizado"
--     são acrescentadas depois).
--   * `app.mercado_sortear_amostra(semana)`: toda segunda às 12h (depois da
--     coleta das 6h), 20 itens sorteados pelo banco, determinístico e
--     auditável (md5 da semana + impressão da rodada + id): 10 ao acaso entre
--     os anúncios ok e vivos (pelo menos 2 por fonte com 30 ou mais; 4 se a
--     fonte está em atenção; 20 se alguma fonte teve alerta), 6 entre os que
--     sustentam vantagens (sorteio ponderado sem reposição), 4 marcados ou de
--     dados extras. O que faltar num estrato vai para o acaso.
--   * `public.mercado_conferir(item, resposta, valor, observação)`: admin,
--     gestor e SDR respondem. "Errado" tira o anúncio das contas na hora
--     (`contestado`) e suspende as vantagens cuja prova o usa; "é imóvel nosso"
--     grava o par; "saiu do ar" tira do ar. Preço diferente que a fonte também
--     mudou depois vira "desatualizado" (não é erro da coleta).
--   * `app.mercado_saude_fontes(semana)`: a taxa de erro de cada fonte só com
--     o estrato do acaso, em 8 semanas (Clopper-Pearson): saudável, atenção,
--     alerta (2 erros em 10) e quarentena (3 erros em 10, ou taxa acima de 5%
--     com 20 conferidos); sai da quarentena com 2 semanas sem erro e a causa
--     escrita.
--   * `app.mercado_amostra_em_dia()`: houve conferência de verdade (certo ou
--     errado) em pelo menos 1 das 2 últimas semanas? Sem isso (inclusive sem
--     amostra sorteada), a renovação automática das vantagens para. Folga só
--     no começo, enquanto a primeira amostra da história está no prazo.
--
-- Na KOMUNE não cria nada.
--
-- COMO DESFAZER (no banco da Imova; antes, desfazer a 214000):
--   select cron.unschedule('mercado_amostra_semanal');
--   drop trigger if exists mercado_anuncio_desatualizado on public.mercado_anuncios;
--   drop function if exists app.mercado_sortear_amostra(date), public.mercado_conferir(bigint, text, jsonb, text),
--     public.mercado_conferencia_causa(bigint, text), app.mercado_saude_fontes(date), public.mercado_saude_fontes(date),
--     app.mercado_fontes_em_quarentena(), app.mercado_amostra_em_dia(), app.mercado_semana(date),
--     app.mercado_sorteio_u(text), app.mercado_conferencia_imutavel(), app.mercado_anuncio_desatualizado();
--   drop table if exists public.mercado_conferencias, app.mercado_sorteio_trabalho;
-- =====================================================================

do $conferencia$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A inteligência de mercado é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- A segunda-feira da semana (ISO) de uma data, no fuso da operação.
create or replace function app.mercado_semana(p_data date default null)
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('week', coalesce(p_data, app.mercado_hoje())::timestamp)::date
$$;
revoke all on function app.mercado_semana(date) from public, anon;
grant execute on function app.mercado_semana(date) to authenticated, service_role;

-- Um número entre 0 e 1 tirado do md5 de uma semente (o mesmo no JavaScript).
create or replace function app.mercado_sorteio_u(p_semente text)
returns float8
language sql
immutable
set search_path = ''
as $$
  select (('x' || substr(md5(p_semente), 1, 8))::bit(32)::bigint + 0.5) / 4294967296.0
$$;
revoke all on function app.mercado_sorteio_u(text) from public, anon;
grant execute on function app.mercado_sorteio_u(text) to authenticated, service_role;

create table if not exists public.mercado_conferencias (
  id                  bigint generated always as identity primary key,
  semana              date not null check (extract(isodow from semana) = 1),
  -- A impressão das coletas da semana: ninguém a conhece antes da coleta.
  hash_rodada         text not null check (hash_rodada ~ '^[0-9a-f]{32}$'),
  -- A: ao acaso (mede a taxa de erro); B: sustenta vantagem; C: marcado ou dado extra.
  estrato             text not null check (estrato in ('A', 'B', 'C')),
  ordem               int not null check (ordem >= 1),
  item_tipo           text not null check (item_tipo in ('anuncio', 'proximidade', 'obra', 'indice')),
  -- O id do item (uuid do anúncio, id da proximidade ou da obra, "série|mês" do índice).
  item_ref            text not null check (char_length(item_ref) between 1 and 200),
  mercado_anuncio_id  uuid references public.mercado_anuncios (id) on delete set null,
  fonte               text not null references public.mercado_fontes (id) on update cascade,
  link                text not null check (char_length(link) between 8 and 1000),
  -- O que o sistema tem: tipo, bairro, área, preço, data da coleta...
  resumo              jsonb not null default '{}'::jsonb check (jsonb_typeof(resumo) = 'object'),
  peso                numeric,
  preco_no_sorteio    bigint,
  sorteado_em         timestamptz not null default now(),
  -- Não respondida até a segunda seguinte, vence.
  vence_em            date not null,
  -- A resposta (uma só). Anúncio: confere, preco_diferente, area_diferente,
  -- tipo_ou_lugar_errado, saiu_do_ar, repetido, e_imovel_nosso, nao_consegui.
  -- Outro fato: confere, errado, nao_consegui.
  resposta            text check (resposta in ('confere', 'preco_diferente', 'area_diferente', 'tipo_ou_lugar_errado',
                                               'saiu_do_ar', 'repetido', 'e_imovel_nosso', 'nao_consegui', 'errado')),
  -- ok: true (confere, saiu do ar), false (errado), nulo (não conferiu ou não conseguiu).
  ok                  boolean generated always as (
                        case when resposta in ('confere', 'saiu_do_ar') then true
                             when resposta in ('preco_diferente', 'area_diferente', 'tipo_ou_lugar_errado',
                                               'repetido', 'e_imovel_nosso', 'errado') then false
                        end) stored,
  valor_visto         jsonb check (valor_visto is null or jsonb_typeof(valor_visto) = 'object'),
  preco_do_sistema    bigint,
  conferido_por       uuid references public.profiles (id) on delete set null,
  conferido_em        timestamptz,
  observacao          text check (char_length(observacao) <= 1000),
  -- O preço da página mudou depois da coleta: não conta como erro do pipeline.
  reclassificada      text check (reclassificada in ('desatualizado')),
  -- A causa do erro, escolhida pela equipe de dados depois (resumo da sexta).
  causa               text check (causa in ('coleta', 'fonte', 'regra', 'ficha')),
  causa_por           uuid references public.profiles (id) on delete set null,
  causa_em            timestamptz,
  unique (semana, item_tipo, item_ref),
  check ((resposta is null) = (conferido_em is null)),
  check (causa is null or resposta is not null)
);
create index if not exists mercado_conferencias_semana_idx on public.mercado_conferencias (semana, estrato, ordem);
create index if not exists mercado_conferencias_anuncio_idx on public.mercado_conferencias (mercado_anuncio_id)
  where mercado_anuncio_id is not null;
comment on table public.mercado_conferencias is
  'A amostra semanal que a equipe confere no link (veracidade §11): item sorteado (semana, estrato, link, o que o sistema tem) e a resposta (quem, quando, ok ou errado, o que viu, observação). Só acréscimo: a resposta não muda depois de dada.';

alter table public.mercado_conferencias enable row level security;
drop policy if exists mercado_conferencias_select on public.mercado_conferencias;
create policy mercado_conferencias_select on public.mercado_conferencias
  for select to authenticated using ((select app.is_manager()));
revoke all on public.mercado_conferencias from anon;
revoke insert, update, delete, truncate, references, trigger on public.mercado_conferencias from authenticated, service_role;
grant select on public.mercado_conferencias to authenticated, service_role;
revoke all on sequence public.mercado_conferencias_id_seq from anon, authenticated;

-- Nunca se apaga; o item não muda; a resposta, uma vez dada, não muda. Só se
-- acrescentam a causa e a reclassificação.
create or replace function app.mercado_conferencia_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Conferência de mercado não se apaga.' using errcode = '42501';
  end if;
  if (new.semana, new.hash_rodada, new.estrato, new.ordem, new.item_tipo, new.item_ref, new.fonte, new.link,
      new.resumo, new.peso, new.preco_no_sorteio, new.sorteado_em, new.vence_em)
     is distinct from
     (old.semana, old.hash_rodada, old.estrato, old.ordem, old.item_tipo, old.item_ref, old.fonte, old.link,
      old.resumo, old.peso, old.preco_no_sorteio, old.sorteado_em, old.vence_em) then
    raise exception 'O item sorteado não muda.' using errcode = '42501';
  end if;
  if old.resposta is not null
     and (new.resposta, new.valor_visto, new.preco_do_sistema, new.conferido_por, new.conferido_em, new.observacao)
         is distinct from
         (old.resposta, old.valor_visto, old.preco_do_sistema, old.conferido_por, old.conferido_em, old.observacao) then
    raise exception 'A resposta da conferência não muda depois de dada.' using errcode = '42501';
  end if;
  if old.reclassificada is not null and new.reclassificada is distinct from old.reclassificada then
    raise exception 'A reclassificação não muda.' using errcode = '42501';
  end if;
  if old.causa is not null and (new.causa, new.causa_por, new.causa_em) is distinct from (old.causa, old.causa_por, old.causa_em) then
    raise exception 'A causa do erro não muda depois de escrita.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function app.mercado_conferencia_imutavel() from public, anon, authenticated;

drop trigger if exists mercado_conferencia_imutavel on public.mercado_conferencias;
create trigger mercado_conferencia_imutavel before update or delete on public.mercado_conferencias
  for each row execute function app.mercado_conferencia_imutavel();

-- "Preço diferente" e a fonte também mudou o preço depois: o anúncio volta para
-- as contas com o preço novo, e a resposta vira "desatualizado" (§11.4).
create or replace function app.mercado_anuncio_desatualizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.estado = 'contestado' and old.correcao_humana ? 'preco' and new.preco is distinct from old.preco then
    new.estado := 'ok';
    new.motivo := null;
    new.correcao_humana := null;
    update public.mercado_conferencias c
       set reclassificada = 'desatualizado'
     where c.mercado_anuncio_id = new.id and c.resposta = 'preco_diferente' and c.reclassificada is null;
  end if;
  return new;
end $$;
revoke all on function app.mercado_anuncio_desatualizado() from public, anon, authenticated;

drop trigger if exists mercado_anuncio_desatualizado on public.mercado_anuncios;
create trigger mercado_anuncio_desatualizado before update of preco on public.mercado_anuncios
  for each row execute function app.mercado_anuncio_desatualizado();

-- =====================================================================
-- A saúde de cada fonte (§11.5), só com o estrato do acaso
-- =====================================================================
create or replace function app.mercado_saude_fontes(p_semana date default null)
returns table (
  fonte              text,
  semana             date,
  conferidos_semana  int,
  erros_semana       int,
  desatualizados_semana int,
  conferidos_8s      int,
  erros_8s           int,
  taxa_8s            numeric,
  cp_sup_8s          numeric,
  estado             text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_semana  date := app.mercado_semana(p_semana);
  v_janela  int := app.mercado_regra_num('{amostra,janela_semanas}', 8)::int;
  v_cp      numeric := app.mercado_regra_num('{amostra,cp_sup_saudavel}', 0.10);
  v_taxa_q  numeric := app.mercado_regra_num('{amostra,taxa_quarentena}', 0.05);
  v_taxa_n  numeric := app.mercado_regra_num('{amostra,taxa_n_min}', 20);
  v_alerta  numeric := app.mercado_regra_num('{amostra,alerta_erros}', 2);
  v_quar    numeric := app.mercado_regra_num('{amostra,quarentena_erros}', 3);
  f         text;
  w         date;
  v_estado  text;
  v_conf    int; v_err int; v_des int; v_conf8 int; v_err8 int;
  v_limpas  int;
  v_inicio_q date;
  v_causas  boolean;
begin
  for f in
    select distinct c.fonte from public.mercado_conferencias c
     where c.item_tipo = 'anuncio' and c.estrato = 'A' and c.semana <= v_semana
     order by 1
  loop
    v_estado := null; v_limpas := 0; v_inicio_q := null;
    -- A máquina de estados anda semana a semana (12 semanas para trás bastam
    -- para a quarentena e a janela de 8).
    for w in select generate_series(v_semana - 7 * (v_janela + 4), v_semana, interval '7 days')::date loop
      select count(*) filter (where c.ok is not null and c.reclassificada is null),
             count(*) filter (where c.ok = false and c.reclassificada is null),
             count(*) filter (where c.reclassificada = 'desatualizado')
        into v_conf, v_err, v_des
        from public.mercado_conferencias c
       where c.fonte = f and c.estrato = 'A' and c.item_tipo = 'anuncio' and c.semana = w;
      select count(*) filter (where c.ok is not null and c.reclassificada is null),
             count(*) filter (where c.ok = false and c.reclassificada is null)
        into v_conf8, v_err8
        from public.mercado_conferencias c
       where c.fonte = f and c.estrato = 'A' and c.item_tipo = 'anuncio'
         and c.semana > w - 7 * v_janela and c.semana <= w;

      if v_estado = 'quarentena' then
        -- Sai com 2 semanas seguidas conferidas e sem erro, e a causa escrita
        -- em todos os erros desde o início da quarentena.
        if v_conf > 0 and v_err = 0 then v_limpas := v_limpas + 1; else v_limpas := 0; end if;
        select coalesce(bool_and(c.causa is not null), true) into v_causas
          from public.mercado_conferencias c
         where c.fonte = f and c.estrato = 'A' and c.ok = false and c.reclassificada is null
           and c.semana >= v_inicio_q and c.semana <= w;
        if v_limpas >= 2 and v_causas then
          v_estado := 'atencao'; v_limpas := 0; v_inicio_q := null;
        end if;
      elsif v_err >= v_quar or (v_conf8 >= v_taxa_n and v_err8::numeric / v_conf8 > v_taxa_q) then
        v_estado := 'quarentena'; v_inicio_q := w; v_limpas := 0;
      elsif v_err >= v_alerta then
        v_estado := 'alerta';
      elsif v_conf8 = 0 then
        v_estado := 'sem_conferencia';
      elsif app.clopper_pearson_sup(v_err8, v_conf8) > v_cp then
        v_estado := 'atencao';
      else
        v_estado := 'saudavel';
      end if;
    end loop;

    fonte := f; semana := v_semana;
    conferidos_semana := v_conf; erros_semana := v_err; desatualizados_semana := v_des;
    conferidos_8s := v_conf8; erros_8s := v_err8;
    taxa_8s := case when v_conf8 > 0 then round(v_err8::numeric / v_conf8, 4) end;
    cp_sup_8s := app.clopper_pearson_sup(v_err8, v_conf8);
    estado := v_estado;
    return next;
  end loop;
end $$;
comment on function app.mercado_saude_fontes(date) is
  'Saúde de cada fonte pela amostra do acaso (estrato A): conferidos, erros, desatualizados, taxa e limite de cima de Clopper-Pearson em 8 semanas, e o estado (saudavel, atencao, alerta, quarentena, sem_conferencia).';
revoke all on function app.mercado_saude_fontes(date) from public, anon;
grant execute on function app.mercado_saude_fontes(date) to authenticated, service_role;

create or replace function public.mercado_saude_fontes(p_semana date default null)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_manager() then
    raise exception 'Só admin, gestor e SDR veem a saúde das fontes.' using errcode = '42501';
  end if;
  return query select to_jsonb(s) from app.mercado_saude_fontes(p_semana) s;
end $$;
comment on function public.mercado_saude_fontes(date) is 'app.mercado_saude_fontes pela API (admin, gestor e SDR).';
revoke all on function public.mercado_saude_fontes(date) from public, anon;
grant execute on function public.mercado_saude_fontes(date) to authenticated;

create or replace function app.mercado_fontes_em_quarentena()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.fonte order by s.fonte), '{}')
    from app.mercado_saude_fontes(null) s
   where s.estado = 'quarentena'
$$;
revoke all on function app.mercado_fontes_em_quarentena() from public, anon;
grant execute on function app.mercado_fontes_em_quarentena() to authenticated, service_role;

-- Conferida de verdade em pelo menos 1 das 2 últimas semanas? "Conferida" é
-- um item com resposta que diz certo ou errado (`ok` não nulo): "não consegui"
-- não conta. Na falta, a trava FECHA (a renovação automática para): semana sem
-- amostra sorteada (o cron falhou, a chave ficou desligada) não vale como em
-- dia. A única folga é o começo: antes da primeira conferência da história,
-- enquanto a primeira amostra ainda está no prazo (ou nem foi sorteada).
create or replace function app.mercado_amostra_em_dia()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when not exists (select 1 from public.mercado_conferencias c where c.ok is not null)
             then coalesce((select min(c.vence_em) from public.mercado_conferencias c), app.mercado_hoje())
                  >= app.mercado_hoje()
           else exists (select 1 from public.mercado_conferencias c
                         where c.semana >= app.mercado_semana() - 7 and c.ok is not null)
         end
$$;
comment on function app.mercado_amostra_em_dia() is
  'A equipe conferiu de verdade (certo ou errado; "não consegui" não conta) algum item da amostra em 1 das 2 últimas semanas? Sem amostra sorteada nessas semanas, não está em dia. Folga só no começo: antes da primeira conferência, com a primeira amostra ainda no prazo. Sem isso, as vantagens não se renovam sozinhas.';
revoke all on function app.mercado_amostra_em_dia() from public, anon;
grant execute on function app.mercado_amostra_em_dia() to authenticated, service_role;

-- =====================================================================
-- O sorteio (§11.1 e §11.2)
-- =====================================================================
-- A tabela de trabalho do sorteio nasce aqui, e não como temporária dentro
-- da função (o `supabase db lint` não a acharia). O sorteio segura uma trava
-- e a esvazia no começo e no fim.
create unlogged table if not exists app.mercado_sorteio_trabalho (
  estrato text, item_tipo text, item_ref text, anuncio uuid, fonte text, link text, resumo jsonb,
  peso numeric, preco bigint, chave float8
);
comment on table app.mercado_sorteio_trabalho is
  'Rascunho de app.mercado_sortear_amostra (os itens sorteados antes de gravar). Esvaziada a cada sorteio.';
alter table app.mercado_sorteio_trabalho enable row level security;
revoke all on app.mercado_sorteio_trabalho from public, anon, authenticated, service_role;

create or replace function app.mercado_sortear_amostra(p_semana date default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana    date := app.mercado_semana(p_semana);
  v_hash      text;
  v_vivo      int := app.mercado_regra_num('{validade_dias,vivo}', 8)::int;
  v_acaso     int := app.mercado_regra_num('{amostra,acaso}', 10)::int;
  v_vant      int := app.mercado_regra_num('{amostra,vantagens}', 6)::int;
  v_marc      int := app.mercado_regra_num('{amostra,marcados}', 4)::int;
  v_outros    int := app.mercado_regra_num('{amostra,outros_max}', 2)::int;
  v_minf      int := app.mercado_regra_num('{amostra,min_por_fonte}', 2)::int;
  v_fonte_n   int := app.mercado_regra_num('{amostra,fonte_n_min}', 30)::int;
  v_repetir   int := app.mercado_regra_num('{amostra,nao_repetir_dias}', 60)::int;
  v_prazo     date;
  v_anterior  date;
  v_alerta    boolean := false;
  v_atencao   text[] := '{}'::text[];
  v_b         int := 0;
  v_c         int := 0;
  v_n         int;
begin
  if not app.mercado_ligado() then
    return 0;
  end if;
  if exists (select 1 from public.mercado_conferencias c where c.semana = v_semana) then
    return 0;
  end if;
  v_prazo := v_semana + 7;
  v_anterior := v_semana - 7;

  select md5(coalesce(string_agg(c.id::text || ':' || coalesce(c.fim::text, '') || ':' || coalesce(c.hash_bruto, ''),
                                 ',' order by c.id), ''))
    into v_hash
    from public.mercado_coletas c
   where c.situacao = 'ok' and c.fim >= v_semana::timestamp at time zone 'America/Fortaleza' - interval '7 days'
     and c.fim < (v_semana + 7)::timestamp at time zone 'America/Fortaleza';

  -- A semana anterior manda: alerta dobra o acaso; atenção dobra a cota da fonte.
  select coalesce(bool_or(s.estado = 'alerta'), false),
         coalesce(array_agg(s.fonte) filter (where s.estado = 'atencao'), '{}'::text[])
    into v_alerta, v_atencao
    from app.mercado_saude_fontes(v_anterior) s;
  if v_alerta then v_acaso := v_acaso * 2; end if;

  perform pg_advisory_xact_lock(hashtext('app.mercado_sortear_amostra'));
  truncate app.mercado_sorteio_trabalho;

  -- B. Os que sustentam vantagens aprovadas ou propostas (peso maior para quem
  -- muda a classe se sair: o motor manda em prova.pesos).
  if to_regclass('public.mercado_argumentos') is not null then
    execute $q$
      insert into app.mercado_sorteio_trabalho
      select 'B', 'anuncio', a.id::text, a.id, a.fonte, a.url,
             jsonb_build_object('tipo', a.tipo, 'sub', a.sub, 'modo', a.modo, 'bairro', a.bairro, 'cidade', a.cidade,
                                'area', a.area_ref, 'preco', a.preco, 'quartos', a.quartos, 'coletado_em', a.ultima_vez_visto),
             p.peso, a.preco,
             -ln(app.mercado_sorteio_u('veracidade:' || $1 || ':' || $2 || ':' || a.id::text)) / greatest(p.peso, 0.0001)
        from (select (e.v)::uuid as id, max(coalesce((g.prova -> 'pesos' ->> e.v)::numeric, 1)) as peso
                from public.mercado_argumentos g
                cross join lateral jsonb_array_elements_text(
                  case when jsonb_typeof(g.prova -> 'anuncios') = 'array' then g.prova -> 'anuncios' else '[]'::jsonb end) e(v)
               where g.status in ('aprovado', 'proposto')
                 and e.v ~ '^[0-9a-f-]{36}$'
               group by 1) p
        join public.mercado_anuncios a on a.id = p.id
       where a.estado = 'ok'
       order by 10
       limit $3
    $q$ using v_semana::text, v_hash, v_vant;
    get diagnostics v_b = row_count;
  end if;

  -- C1. Marcados: suspeitos, possível mesmo imóvel sem decisão, célula em
  -- alerta, ou de fonte nova (primeira coleta há menos de 14 dias).
  insert into app.mercado_sorteio_trabalho
  select 'C', 'anuncio', a.id::text, a.id, a.fonte, a.url,
         jsonb_build_object('tipo', a.tipo, 'sub', a.sub, 'modo', a.modo, 'bairro', a.bairro, 'cidade', a.cidade,
                            'area', a.area_ref, 'preco', a.preco, 'quartos', a.quartos, 'coletado_em', a.ultima_vez_visto,
                            'marcas', to_jsonb(a.marcas)),
         1, a.preco, app.mercado_sorteio_u('veracidade:' || v_semana || ':' || v_hash || ':' || a.id::text)
    from public.mercado_anuncios a
   where a.estado = 'ok' and a.representante
     and not exists (select 1 from app.mercado_sorteio_trabalho s where s.anuncio = a.id)
     and (a.marcas && array['suspeito_3iqr', 'suspeito_isca', 'possivel_mesmo_imovel']::text[]
          or exists (select 1 from public.mercado_celulas k
                      where k.regiao_id = a.regiao_id and k.modo = a.modo and k.sub = a.sub and k.estado = 'alerta')
          or (select min(c.inicio) from public.mercado_coletas c where c.fonte = a.fonte and c.origem = 'auto')
               > now() - interval '14 days')
   order by app.mercado_sorteio_u('veracidade:' || v_semana || ':' || v_hash || ':' || a.id::text)
   limit greatest(v_marc - v_outros, 0);
  get diagnostics v_n = row_count;
  v_c := v_n;

  -- C2. Fatos de outra natureza: ponto do mapa, obra, linha da Corrida.
  insert into app.mercado_sorteio_trabalho
  select 'C', x.item_tipo, x.item_ref, null, x.fonte, x.link, x.resumo, 1, null,
         app.mercado_sorteio_u('veracidade:' || v_semana || ':' || v_hash || ':' || x.item_tipo || ':' || x.item_ref)
    from (
      select 'proximidade'::text as item_tipo, p.id::text as item_ref, p.fonte, p.url as link,
             jsonb_build_object('categoria', p.categoria, 'nome', p.nome, 'distancia_m', p.distancia_m,
                                'imovel', p.imovel_codigo, 'etiqueta', p.etiqueta) as resumo
        from public.mercado_proximidades p
       where not p.suspenso and p.contestado_em is null and p.valido_ate >= app.mercado_hoje() and p.nome is not null
      union all
      select 'obra', o.id::text, o.fonte, o.url,
             jsonb_build_object('tipo', o.tipo, 'fase', o.fase, 'objeto', left(o.objeto, 200),
                                'bairro', o.bairro, 'publicado_em', o.publicado_em)
        from public.mercado_obras o
       where o.contestado_em is null and o.fase in ('em_andamento', 'concluida')
      union all
      select 'indice', i.serie || '|' || i.mes::text, i.fonte, i.url,
             jsonb_build_object('serie', i.serie, 'mes', i.mes, 'valor', i.valor, 'nome', i.nome, 'unidade', i.unidade)
        from public.mercado_indices i
       where i.serie like coalesce(app.mercado_regras() #>> '{confronto_corrida,serie_prefixo}', 'corrida-') || '%'
         and i.mes >= (app.mercado_hoje() - 90)
    ) x
   order by 10
   limit greatest(least(v_outros, v_marc - v_c), 0);
  get diagnostics v_n = row_count;
  v_c := v_c + v_n;

  -- A. Ao acaso: anúncios ok, vivos, um por grupo de quase gêmeos, que não
  -- foram conferidos "confere" com o mesmo preço nos últimos 60 dias. Cada
  -- fonte com 30 ou mais recebe pelo menos 2 (4 em atenção); o resto, na ordem
  -- do md5. O que faltou nos outros estratos vem para cá.
  v_acaso := v_acaso + greatest(v_vant - v_b, 0) + greatest(v_marc - v_c, 0);
  with cand as (
    select a.*, app.mercado_sorteio_u('veracidade:' || v_semana || ':' || v_hash || ':' || a.id::text) as u,
           count(*) over (partition by a.fonte) as nf
      from public.mercado_anuncios a
     where a.estado = 'ok' and a.representante and a.origem = 'auto'
       and a.ultima_vez_visto >= now() - make_interval(days => v_vivo)
       and not exists (select 1 from app.mercado_sorteio_trabalho s where s.anuncio = a.id)
       and not exists (select 1 from public.mercado_conferencias c
                        where c.mercado_anuncio_id = a.id and c.resposta = 'confere'
                          and c.conferido_em > now() - make_interval(days => v_repetir)
                          and c.preco_do_sistema is not distinct from a.preco)
  ),
  ordenado as (
    select c.*, row_number() over (partition by c.fonte order by c.u) as rk
      from cand c
  ),
  minimos as (
    select o.* from ordenado o
     where o.nf >= v_fonte_n
       and o.rk <= case when o.fonte = any (v_atencao) then v_minf * 2 else v_minf end
     order by o.u
     limit v_acaso
  ),
  resto as (
    select o.* from ordenado o
     where not exists (select 1 from minimos m where m.id = o.id)
     order by o.u
     limit greatest(v_acaso - (select count(*) from minimos), 0)
  )
  insert into app.mercado_sorteio_trabalho
  select 'A', 'anuncio', z.id::text, z.id, z.fonte, z.url,
         jsonb_build_object('tipo', z.tipo, 'sub', z.sub, 'modo', z.modo, 'bairro', z.bairro, 'cidade', z.cidade,
                            'area', z.area_ref, 'preco', z.preco, 'quartos', z.quartos, 'coletado_em', z.ultima_vez_visto),
         1, z.preco, z.u
    from (select * from minimos union all select * from resto) z;

  insert into public.mercado_conferencias
    (semana, hash_rodada, estrato, ordem, item_tipo, item_ref, mercado_anuncio_id, fonte, link, resumo,
     peso, preco_no_sorteio, vence_em)
  select v_semana, v_hash, s.estrato,
         row_number() over (partition by s.estrato order by s.chave, s.item_ref),
         s.item_tipo, s.item_ref, s.anuncio, s.fonte, s.link, s.resumo, s.peso, s.preco, v_prazo
    from app.mercado_sorteio_trabalho s;
  get diagnostics v_n = row_count;
  truncate app.mercado_sorteio_trabalho;
  return v_n;
end $$;
comment on function app.mercado_sortear_amostra(date) is
  'Sorteia a amostra semanal (determinística: md5 da semana, da impressão das coletas e do id): estrato A ao acaso (10, ou 20 com alerta; mínimo por fonte), B das provas das vantagens (6, ponderado), C marcados e dados extras (4). Uma vez por semana; com a chave desligada, nada.';
revoke all on function app.mercado_sortear_amostra(date) from public, anon, authenticated;
grant execute on function app.mercado_sortear_amostra(date) to service_role;

-- =====================================================================
-- A resposta da equipe (§11.3 e §11.4)
-- =====================================================================
create or replace function public.mercado_conferir(
  p_item bigint, p_resposta text, p_valor jsonb default null, p_observacao text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c          public.mercado_conferencias;
  a          public.mercado_anuncios;
  v_valor    jsonb := case when jsonb_typeof(p_valor) = 'object' then p_valor else '{}'::jsonb end;
  v_codigo   text;
  v_susp     int := 0;
begin
  if not app.is_manager() then
    raise exception 'Só admin, gestor e SDR conferem a amostra de mercado.' using errcode = '42501';
  end if;
  select * into c from public.mercado_conferencias where id = p_item for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'item_desconhecido');
  end if;
  if c.resposta is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_conferido');
  end if;
  if app.mercado_hoje() > c.vence_em then
    return jsonb_build_object('ok', false, 'motivo', 'amostra_vencida');
  end if;
  if (c.item_tipo = 'anuncio' and p_resposta not in ('confere', 'preco_diferente', 'area_diferente',
        'tipo_ou_lugar_errado', 'saiu_do_ar', 'repetido', 'e_imovel_nosso', 'nao_consegui'))
     or (c.item_tipo <> 'anuncio' and p_resposta not in ('confere', 'errado', 'nao_consegui'))
     or p_resposta is null then
    return jsonb_build_object('ok', false, 'motivo', 'resposta_invalida');
  end if;
  if p_resposta = 'e_imovel_nosso' then
    v_codigo := nullif(btrim(v_valor ->> 'codigo'), '');
    if v_codigo is null or not exists (select 1 from app.mercado_carteira() k where k.codigo = v_codigo) then
      return jsonb_build_object('ok', false, 'motivo', 'codigo_do_imovel_obrigatorio');
    end if;
  end if;
  if p_resposta = 'preco_diferente' and jsonb_typeof(v_valor -> 'preco') is distinct from 'number' then
    return jsonb_build_object('ok', false, 'motivo', 'preco_visto_obrigatorio');
  end if;
  if p_resposta = 'area_diferente' and jsonb_typeof(v_valor -> 'area') is distinct from 'number' then
    return jsonb_build_object('ok', false, 'motivo', 'area_vista_obrigatoria');
  end if;

  if c.mercado_anuncio_id is not null then
    select * into a from public.mercado_anuncios where id = c.mercado_anuncio_id for update;
  end if;

  update public.mercado_conferencias
     set resposta = p_resposta, valor_visto = nullif(v_valor, '{}'::jsonb),
         preco_do_sistema = a.preco, conferido_por = auth.uid(), conferido_em = now(),
         observacao = left(nullif(btrim(p_observacao), ''), 1000)
   where id = c.id;

  if c.item_tipo = 'anuncio' and a.id is not null then
    if p_resposta in ('preco_diferente', 'area_diferente', 'tipo_ou_lugar_errado', 'repetido') then
      update public.mercado_anuncios
         set estado = 'contestado', contestado_em = now(), motivo = 'conferencia:' || p_resposta,
             correcao_humana = nullif(v_valor, '{}'::jsonb)
       where id = a.id;
    elsif p_resposta = 'e_imovel_nosso' then
      insert into public.mercado_pares as p
        (imovel_codigo, mercado_anuncio_id, tipo, regra, preco_na_marca, decisao, preco_na_decisao,
         decidido_por, decidido_em, obs)
      values (v_codigo, a.id, 'proprio', 'conferencia', a.preco, 'e_nosso', a.preco, auth.uid(), now(),
              'Marcado na conferência semanal ' || c.semana::text)
      on conflict (imovel_codigo, mercado_anuncio_id) do update
        set tipo = 'proprio', decisao = 'e_nosso', preco_na_decisao = excluded.preco_na_decisao,
            decidido_por = excluded.decidido_por, decidido_em = excluded.decidido_em;
    elsif p_resposta = 'saiu_do_ar' then
      update public.mercado_anuncios
         set saiu_do_ar_em = coalesce(saiu_do_ar_em, now())
       where id = a.id;
    end if;
    if p_resposta in ('e_imovel_nosso', 'saiu_do_ar') then
      perform app.mercado_verificar();
    end if;
    if p_resposta in ('preco_diferente', 'area_diferente', 'tipo_ou_lugar_errado', 'repetido', 'e_imovel_nosso')
       and to_regprocedure('app.mercado_argumentos_suspender(uuid, text, text)') is not null then
      execute 'select app.mercado_argumentos_suspender($1, null, $2)' into v_susp
        using a.id, 'conferencia:' || p_resposta;
    end if;
  elsif p_resposta = 'errado' then
    if c.item_tipo = 'proximidade' then
      update public.mercado_proximidades
         set suspenso = true, suspenso_motivo = 'conferencia semanal', contestado_em = now()
       where id = c.item_ref::bigint;
    elsif c.item_tipo = 'obra' then
      update public.mercado_obras set contestado_em = now() where id = c.item_ref::bigint;
    end if;
    if to_regprocedure('app.mercado_argumentos_suspender(uuid, text, text)') is not null then
      execute 'select app.mercado_argumentos_suspender(null, $1, $2)' into v_susp
        using c.item_tipo || ':' || c.item_ref, 'conferencia:errado';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'item', c.id, 'resposta', p_resposta,
                            'vantagens_suspensas', coalesce(v_susp, 0));
end $$;
comment on function public.mercado_conferir(bigint, text, jsonb, text) is
  'Admin, gestor e SDR respondem um item da amostra semanal. Errado: o anúncio sai das contas (contestado) e as vantagens cuja prova o usa saem da IA; é imóvel nosso: grava o par; saiu do ar: tira do ar. A resposta não muda depois.';
revoke all on function public.mercado_conferir(bigint, text, jsonb, text) from public, anon;
grant execute on function public.mercado_conferir(bigint, text, jsonb, text) to authenticated;

-- A causa de cada erro, escolhida pela equipe de dados no resumo da semana.
create or replace function public.mercado_conferencia_causa(p_item bigint, p_causa text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    raise exception 'Só admin e gestor escrevem a causa de um erro de mercado.' using errcode = '42501';
  end if;
  if p_causa is null or p_causa not in ('coleta', 'fonte', 'regra', 'ficha') then
    return jsonb_build_object('ok', false, 'motivo', 'causa_invalida');
  end if;
  update public.mercado_conferencias
     set causa = p_causa, causa_por = auth.uid(), causa_em = now()
   where id = p_item and ok = false and causa is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'item_sem_erro_ou_com_causa');
  end if;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.mercado_conferencia_causa(bigint, text) is
  'Admin e gestor escrevem a causa de um erro da amostra (coleta, fonte, regra ou ficha), uma vez.';
revoke all on function public.mercado_conferencia_causa(bigint, text) from public, anon;
grant execute on function public.mercado_conferencia_causa(bigint, text) to authenticated;

  $ddl$;

  -- Segunda às 12h em Fortaleza (15h UTC), depois da coleta das 6h.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mercado_amostra_semanal', '0 15 * * 1',
                          $cron$select app.mercado_sortear_amostra()$cron$);
  end if;
end $conferencia$;

notify pgrst, 'reload schema';

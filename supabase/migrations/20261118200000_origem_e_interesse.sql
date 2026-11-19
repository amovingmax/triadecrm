-- =====================================================================
-- Origem e interesse: a aba nova dos Relatórios da Imova (18/11/2026)
--
-- Pedido do Rafael (18/11/2026): "É necessário que tenhamos dados de quantas
-- pessoas vieram por um anúncio x, quantas vieram de placas, redes sociais
-- [...] quantas pessoas ficaram mais interessadas em um período x de tempo,
-- comparativo entre os meses, anúncios mais buscados e que mais tiveram
-- interesse [...] dados mais voltados a entender como nosso sistema está
-- lidando." O protótipo com os números reais foi aprovado no mesmo dia
-- ("Gostei do protótipo [...] suba para produção").
--
-- O que esta migração cria:
--   1. `public.canal_pro_numeros_do_dia`: a foto diária dos vistos e contatos
--      de cada anúncio do Canal Pro. O Canal Pro só informa o ACUMULADO desde
--      que o anúncio entrou no ar; guardando um número por dia (a cada
--      importação ou sincronização, pelo gatilho), o relatório passa a dizer
--      quanto foi visto NO PERÍODO. A primeira foto sai desta migração.
--   2. `public.anuncios_da_meta`: a marca de quem conhece o anúncio da Meta
--      (é ou não é da Imova). No dia do protótipo, as 5 chegadas "de anúncio
--      da Meta" vinham de um anúncio de uma degustação no Malca Club, que leva
--      para o WhatsApp da Imova: ele já nasce marcado como de fora. Admin e
--      gestor mudam pela `public.anuncio_da_meta_marcar`.
--   3. `public.relatorio_imova_painel_origem(p_de, p_ate)`: a aba inteira num
--      jsonb (ADR-03: nenhuma conta na tela). De onde vieram (o canal da
--      chegada, com a Meta separada dos portais e cada anúncio da Meta pelo
--      nome), anúncio a anúncio (vistos e contatos no portal, quem chegou com o
--      código, quem se interessou), o interesse (degraus de hoje, quem subiu e
--      quem esfriou), as semanas, os meses e como o sistema está lidando (quem
--      respondeu primeiro, como a origem foi descoberta, quem ficou sem
--      resposta, os contatos do Grupo OLX e o volume de mensagens).
--
-- A UNIDADE de origem é a CHEGADA (`public.chegadas`, 20261109220000): cada
-- vez que a pessoa procurou a Imova (a primeira mensagem, ou a volta depois de
-- 30 dias). Conversa que nós começamos não é chegada. "Respondeu" é a primeira
-- mensagem nossa escrita por gente ou pela IA depois do começo da chegada (a
-- mensagem fixa automática não conta como atendimento).
--
-- Mesmo acesso dos outros relatórios da Imova (`app.relatorio_imova_porteira`:
-- admin, gestor e SDR) e datas em America/Fortaleza. O WhatsApp não é tocado:
-- nada aqui escreve em `messages` ou `conversations`. O gatilho do Canal Pro
-- nunca derruba a importação (qualquer erro dele é engolido).
--
-- SÓ DA IMOVA: no banco da KOMUNE nada é criado (fica só o registro da versão).
--
-- COMO DESFAZER: drop function public.relatorio_imova_painel_origem(date, date),
-- public.anuncio_da_meta_marcar(text, boolean), app.origem_chegadas(timestamptz,
-- timestamptz), app.origem_grupo(text, text), app.origem_chave(text); drop trigger
-- canal_pro_guarda_numeros on public.anuncios_no_canal_pro; drop function
-- app.canal_pro_guardar_numeros(); drop table public.canal_pro_numeros_do_dia,
-- public.anuncios_da_meta.
-- =====================================================================

do $origem$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A aba Origem e interesse é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. A foto diária dos números do Canal Pro
-- =====================================================================
create table if not exists public.canal_pro_numeros_do_dia (
  anuncio_no_canal_pro_id uuid not null references public.anuncios_no_canal_pro (id) on delete cascade,
  -- O dia em America/Fortaleza. Uma linha por anúncio e dia: a última leitura do dia vale.
  dia                     date not null,
  vistos                  int check (vistos >= 0),
  contatos                int check (contatos >= 0),
  lido_em                 timestamptz not null default now(),
  primary key (anuncio_no_canal_pro_id, dia)
);
alter table public.canal_pro_numeros_do_dia enable row level security;
drop policy if exists canal_pro_numeros_do_dia_ler on public.canal_pro_numeros_do_dia;
create policy canal_pro_numeros_do_dia_ler on public.canal_pro_numeros_do_dia
  for select to authenticated using ((select app.sees_all()));
revoke all on public.canal_pro_numeros_do_dia from anon;
revoke insert, update, delete, truncate on public.canal_pro_numeros_do_dia from authenticated;
comment on table public.canal_pro_numeros_do_dia is
  'Os vistos e contatos ACUMULADOS de cada anúncio do Canal Pro, um por dia (America/Fortaleza), gravados pelo gatilho a cada importação ou sincronização (18/11/2026). A diferença entre dois dias é o que o anúncio teve no período.';

create or replace function app.canal_pro_guardar_numeros()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vistos   bigint;
  v_contatos bigint;
begin
  begin
    v_vistos := app.canal_pro_inteiro(app.canal_pro_campo(new.linha, array['total de visualizacoes', 'visualizacoes']));
    v_contatos := app.canal_pro_inteiro(app.canal_pro_campo(new.linha, array['total de contatos', 'contatos']));
    if v_vistos is null and v_contatos is null then
      return new;
    end if;
    insert into public.canal_pro_numeros_do_dia (anuncio_no_canal_pro_id, dia, vistos, contatos)
    values (new.id, (now() at time zone 'America/Fortaleza')::date,
            case when v_vistos between 0 and 2147483647 then v_vistos::int end,
            case when v_contatos between 0 and 2147483647 then v_contatos::int end)
    on conflict (anuncio_no_canal_pro_id, dia) do update
      set vistos = excluded.vistos, contatos = excluded.contatos, lido_em = now();
  exception when others then
    -- O relatório nunca derruba a importação do Canal Pro.
    raise warning 'canal_pro_guardar_numeros: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end $$;
comment on function app.canal_pro_guardar_numeros() is
  'Gatilho de anuncios_no_canal_pro: guarda os vistos e contatos do dia em canal_pro_numeros_do_dia. Qualquer erro vira aviso: a importação segue.';
revoke all on function app.canal_pro_guardar_numeros() from public, anon, authenticated;

drop trigger if exists canal_pro_guarda_numeros on public.anuncios_no_canal_pro;
create trigger canal_pro_guarda_numeros
  after insert or update of linha on public.anuncios_no_canal_pro
  for each row execute function app.canal_pro_guardar_numeros();

-- A primeira foto: o que o Canal Pro disse até hoje.
insert into public.canal_pro_numeros_do_dia (anuncio_no_canal_pro_id, dia, vistos, contatos)
select m.id, (now() at time zone 'America/Fortaleza')::date, x.vistos, x.contatos
  from public.anuncios_no_canal_pro m
  cross join lateral (
    select case when v between 0 and 2147483647 then v::int end as vistos,
           case when c between 0 and 2147483647 then c::int end as contatos
      from (select app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['total de visualizacoes', 'visualizacoes'])) as v,
                   app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['total de contatos', 'contatos'])) as c) n
  ) x
 where x.vistos is not null or x.contatos is not null
on conflict (anuncio_no_canal_pro_id, dia) do nothing;

-- =====================================================================
-- 2. Os anúncios da Meta: é ou não é da Imova
-- =====================================================================
create table if not exists public.anuncios_da_meta (
  -- O `source_id` que a Meta manda no clique do anúncio (messages.conteudo.anuncio.id).
  anuncio_id  text primary key check (anuncio_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  da_imova    boolean not null,
  nota        text check (char_length(nota) <= 300),
  marcado_por uuid references public.profiles (id) on delete set null,
  marcado_em  timestamptz not null default now()
);
alter table public.anuncios_da_meta enable row level security;
drop policy if exists anuncios_da_meta_ler on public.anuncios_da_meta;
create policy anuncios_da_meta_ler on public.anuncios_da_meta
  for select to authenticated using ((select app.sees_all()));
revoke all on public.anuncios_da_meta from anon;
revoke insert, update, delete, truncate on public.anuncios_da_meta from authenticated;
comment on table public.anuncios_da_meta is
  'O que a equipe sabe de cada anúncio da Meta que trouxe gente pelo WhatsApp: se é da Imova (18/11/2026). Sem linha = ninguém disse. Escrita só por public.anuncio_da_meta_marcar.';

insert into public.anuncios_da_meta (anuncio_id, da_imova, nota) values
  ('120251297618790739', false,
   'Degustação de Beats Pink Lemonade no Malca Club (Instagram). Leva para o WhatsApp da Imova, mas não é anúncio da Imova (visto em 18/11/2026).')
on conflict (anuncio_id) do nothing;

create or replace function public.anuncio_da_meta_marcar(p_anuncio_id text, p_da_imova boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not coalesce(app.admin_ou_gestor(), false) then
    raise exception 'Só admin e gestor dizem de quem é o anúncio' using errcode = '42501';
  end if;
  if p_anuncio_id is null or p_anuncio_id !~ '^[0-9A-Za-z_-]{1,64}$' or p_da_imova is null then
    raise exception 'Anúncio ou marca inválida' using errcode = '22023';
  end if;
  insert into public.anuncios_da_meta (anuncio_id, da_imova, marcado_por, marcado_em)
  values (p_anuncio_id, p_da_imova, auth.uid(), now())
  on conflict (anuncio_id) do update
    set da_imova = excluded.da_imova, marcado_por = excluded.marcado_por, marcado_em = excluded.marcado_em;
end $$;
comment on function public.anuncio_da_meta_marcar(text, boolean) is
  'Admin e gestor dizem se um anúncio da Meta é da Imova (aba Origem e interesse).';
revoke all on function public.anuncio_da_meta_marcar(text, boolean) from public, anon;
grant execute on function public.anuncio_da_meta_marcar(text, boolean) to authenticated;

-- =====================================================================
-- 3. Peças
-- =====================================================================
-- O grupo da aba: a Meta sai de dentro de "Anúncios" para ficar à parte dos portais.
create or replace function app.origem_grupo(p_canal text, p_subcanal text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_canal = 'anuncios' and p_subcanal = 'meta_anuncio' then 'meta'
           when p_canal = 'anuncios' then 'portais'
           when p_canal in ('placa', 'redes_sociais', 'outros') then p_canal
           else 'nao_identificado'
         end
$$;
revoke all on function app.origem_grupo(text, text) from public, anon, authenticated;

-- A chave de comparação de um código de anúncio: minúsculo, sem acento, sem o
-- "_IMOVA" do fim ("TE0002_IMOVA" e "te0002" são o mesmo).
create or replace function app.origem_chave(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(lower(extensions.unaccent(split_part(coalesce(p, ''), '_', 1)))), '')
$$;
revoke all on function app.origem_chave(text) from public, anon, authenticated;

-- Cada chegada de um intervalo com o que a aba precisa dela: o grupo, quem
-- decidiu, o anúncio da Meta, a primeira resposta, a etiqueta de agora e se
-- marcou visita. Sem a conversa do treino da IA.
create or replace function app.origem_chegadas(p_de timestamptz, p_fim timestamptz)
returns table (
  chegada_id uuid, conversation_id uuid, organization_id uuid, inicio_em timestamptz,
  grupo text, canal text, subcanal text, decidido_por text, marcado boolean, foto jsonb,
  codigo_do_anuncio text, meta_id text, meta_titulo text,
  resposta_em timestamptz, respondeu text, resposta_min numeric, etiqueta text, visita boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.conversation_id, cv.organization_id, c.inicio_em,
         app.origem_grupo(coalesce(c.canal, 'nao_identificado'), s.sub),
         coalesce(c.canal, 'nao_identificado'), s.sub, c.decidido_por, c.canal_marcado is not null, c.foto,
         c.codigo_do_anuncio,
         nullif(btrim(ad.anuncio ->> 'id'), ''),
         nullif(btrim(coalesce(ad.anuncio ->> 'titulo', ad.anuncio ->> 'corpo')), ''),
         r.created_at,
         case r.author_kind when 'bot_ai' then 'ia' when 'human' then 'equipe' end,
         case when r.created_at is not null then round(extract(epoch from (r.created_at - c.inicio_em)) / 60.0, 1) end,
         a.etiqueta,
         exists (select 1 from public.reunioes v
                  where (v.conversation_id = c.conversation_id
                         or (cv.organization_id is not null and v.organization_id = cv.organization_id))
                    and v.criada_em >= c.inicio_em
                    and v.estado <> 'cancelada')
    from public.chegadas c
    join public.conversations cv on cv.id = c.conversation_id
    left join public.atitudes a on a.conversation_id = c.conversation_id
    cross join lateral (
      select coalesce(case when c.canal_marcado is not null then c.subcanal_marcado else c.subcanal_automatico end,
                      'desconhecido') as sub) s
    left join lateral (
      select m.created_at, m.author_kind
        from public.messages m
       where m.conversation_id = c.conversation_id
         and m.direction = 'out'::app.msg_direction
         and m.author_kind in ('human', 'bot_ai')
         and m.status <> 'failed'::app.msg_status
         and m.created_at >= c.inicio_em
       order by m.created_at
       limit 1) r on true
    left join lateral (
      select m.conteudo -> 'anuncio' as anuncio
        from public.messages m
       where m.conversation_id = c.conversation_id
         and m.direction = 'in'::app.msg_direction
         and m.conteudo ? 'anuncio'
         and m.created_at >= c.inicio_em
         and m.created_at < c.inicio_em + interval '24 hours'
       order by m.created_at
       limit 1) ad on true
   where c.inicio_em >= p_de and c.inicio_em < p_fim
     and c.conversation_id is distinct from app.ia_conversa_de_treino()
$$;
revoke all on function app.origem_chegadas(timestamptz, timestamptz) from public, anon, authenticated;

-- =====================================================================
-- 4. A aba
-- =====================================================================
create or replace function public.relatorio_imova_painel_origem(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje    date := (now() at time zone 'America/Fortaleza')::date;
  v_ate     date := coalesce(p_ate, v_hoje);
  v_dei     date := coalesce(p_de, v_ate - 29);
  v_de      timestamptz := (v_dei::timestamp at time zone 'America/Fortaleza');
  v_fim     timestamptz := ((v_ate + 1)::timestamp at time zone 'America/Fortaleza');
  v_treino  uuid := app.ia_conversa_de_treino();
  v_primeiro timestamptz;
  v_inicio  date;
  v_mes_de  date;
  v_mes_fim timestamptz;
  v_res     jsonb;
begin
  perform app.relatorio_imova_porteira();
  if v_dei > v_ate then
    raise exception 'O começo do período vem depois do fim' using errcode = '22023';
  end if;

  -- O primeiro dia do CRM: a primeira chegada ou a primeira conversa.
  select least((select min(c.inicio_em) from public.chegadas c where c.conversation_id is distinct from v_treino),
               (select min(cv.created_at) from public.conversations cv where cv.id is distinct from v_treino))
    into v_primeiro;
  v_inicio := (v_primeiro at time zone 'America/Fortaleza')::date;
  -- Os meses: até seis, do primeiro com dado até o atual.
  v_mes_de := greatest((date_trunc('month', v_hoje::timestamp) - interval '5 months')::date,
                       coalesce(date_trunc('month', v_inicio::timestamp)::date, date_trunc('month', v_hoje::timestamp)::date));
  v_mes_fim := ((v_hoje + 1)::timestamp at time zone 'America/Fortaleza');

  with
  ch as materialized (select * from app.origem_chegadas(v_de, v_fim)),
  grupos(grupo, posicao) as (
    values ('placa', 1), ('meta', 2), ('portais', 3), ('redes_sociais', 4), ('outros', 5), ('nao_identificado', 6)
  ),
  -- ---- Interesse: as mudanças de etiqueta do período, com o degrau de cada uma.
  hist as (
    select h.conversation_id, h.de, h.para,
           coalesce(array_position(array['sem_resposta', 'esfriando', 'morno', 'interessado', 'muito_interessado'], h.de), 0) as de_n,
           coalesce(array_position(array['sem_resposta', 'esfriando', 'morno', 'interessado', 'muito_interessado'], h.para), 0) as para_n,
           h.em
      from public.atitude_historico h
     where h.tipo = 'etiqueta'
       and h.conversation_id is distinct from v_treino
       and h.em >= v_de and h.em < v_fim
  ),
  -- ---- Anúncio a anúncio.
  cart as (select k.codigo, k.titulo, k.onde from app.imova_carteira() k),
  cp as (
    select m.id, m.codigo as codigo_cp, coalesce(nullif(btrim(m.titulo), ''), m.codigo) as titulo_cp,
           app.canal_pro_ativo_no_relatorio(m.situacao) as ativo,
           coalesce(
             (select a.codigo from public.anuncios a where a.id = m.anuncio_id and a.excluido_em is null),
             (select a.codigo from public.anuncios a where a.codigo = m.codigo and a.excluido_em is null limit 1),
             (select a.codigo from public.anuncios a where a.id = public.canal_pro_parece_com(m)),
             m.codigo) as codigo_imovel,
           app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['total de visualizacoes', 'visualizacoes'])) as vistos,
           app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['total de contatos', 'contatos'])) as contatos,
           (select n.vistos from public.canal_pro_numeros_do_dia n
             where n.anuncio_no_canal_pro_id = m.id and n.dia <= v_ate order by n.dia desc limit 1) as vistos_fim,
           (select n.vistos from public.canal_pro_numeros_do_dia n
             where n.anuncio_no_canal_pro_id = m.id and n.dia < v_dei order by n.dia desc limit 1) as vistos_ini,
           (select n.contatos from public.canal_pro_numeros_do_dia n
             where n.anuncio_no_canal_pro_id = m.id and n.dia <= v_ate order by n.dia desc limit 1) as contatos_fim,
           (select n.contatos from public.canal_pro_numeros_do_dia n
             where n.anuncio_no_canal_pro_id = m.id and n.dia < v_dei order by n.dia desc limit 1) as contatos_ini
      from public.anuncios_no_canal_pro m
     where m.excluido_em is null
  ),
  imoveis as (
    select k.codigo, k.titulo from cart k
    union
    (select distinct on (p.codigo_imovel) p.codigo_imovel, p.titulo_cp
       from cp p
      where p.codigo_imovel not in (select k.codigo from cart k)
      order by p.codigo_imovel, (p.codigo_cp = p.codigo_imovel) desc)
  ),
  -- Os códigos de cada imóvel: o dele e os dos anúncios antigos do mesmo imóvel.
  codigos as (
    select i.codigo as imovel, i.codigo as codigo from imoveis i
    union
    select p.codigo_imovel, p.codigo_cp from cp p
  ),
  lv as (
    select l.conversation_id from app.imova_leads_agora() l
     where l.ultima_do_cliente >= v_de and l.ultima_do_cliente < v_fim
  ),
  interesse as (
    select x.conversation_id, x.codigo as imovel, x.nivel
      from app.imova_interesses() x join lv on lv.conversation_id = x.conversation_id
    union all
    select i.conversation_id, k.imovel, i.nivel
      from public.interesse_no_imovel i
      join lv on lv.conversation_id = i.conversation_id
      join codigos k on k.codigo = i.codigo and k.codigo <> k.imovel
  ),
  pl as (
    select p.id, p.origem, p.anuncio_id, p.anuncio_no_canal_pro_id, p.client_listing_id, p.tipos, p.recebido_em,
           p.conversation_id, p.organization_id,
           (p.conversation_id is null
              and not exists (select 1 from public.conversations cv
                               where p.organization_id is not null and cv.organization_id = p.organization_id)) as sem_conversa
      from public.portal_leads p
     where p.recebido_em >= v_de and p.recebido_em < v_fim
  ),
  chegaram as (
    -- Quem veio com o código do anúncio: o texto pronto do portal na chegada ou o lead do portal.
    select k.imovel, ch.conversation_id::text as quem, false as sem_conversa, false as do_olx
      from ch join codigos k on app.origem_chave(k.codigo) = app.origem_chave(ch.codigo_do_anuncio)
    union
    select k.imovel, coalesce(p.conversation_id::text, 'org:' || p.organization_id::text, 'pl:' || p.id::text),
           p.sem_conversa, p.origem = 'grupo_olx'
      from pl p
      join codigos k on app.origem_chave(k.codigo) = app.origem_chave(p.client_listing_id)
                     or exists (select 1 from public.anuncios a where a.id = p.anuncio_id and a.codigo = k.codigo)
                     or exists (select 1 from cp where cp.id = p.anuncio_no_canal_pro_id and cp.codigo_cp = k.codigo)
  ),
  linhas_anuncio as (
    select i.codigo, i.titulo,
           a.id as anuncio_id, a.situacao as situacao_crm,
           (select bool_or(p.ativo) from cp p where p.codigo_imovel = i.codigo) as portal_ativo,
           exists (select 1 from cp p where p.codigo_imovel = i.codigo) as tem_portal,
           (select sum(p.vistos) from cp p where p.codigo_imovel = i.codigo) as vistos,
           (select sum(p.contatos) from cp p where p.codigo_imovel = i.codigo) as contatos,
           (select case when count(*) filter (where p.vistos_ini is null or p.vistos_fim is null) = 0 and count(*) > 0
                        then sum(greatest(p.vistos_fim - p.vistos_ini, 0)) end
              from cp p where p.codigo_imovel = i.codigo) as vistos_periodo,
           (select case when count(*) filter (where p.contatos_ini is null or p.contatos_fim is null) = 0 and count(*) > 0
                        then sum(greatest(p.contatos_fim - p.contatos_ini, 0)) end
              from cp p where p.codigo_imovel = i.codigo) as contatos_periodo,
           (select coalesce(jsonb_agg(p.codigo_cp order by p.codigo_cp), '[]'::jsonb)
              from cp p where p.codigo_imovel = i.codigo and p.codigo_cp <> i.codigo) as juntou,
           (select count(distinct c.quem) from chegaram c where c.imovel = i.codigo) as chegaram,
           (select count(distinct c.quem) filter (where c.sem_conversa and c.do_olx) from chegaram c where c.imovel = i.codigo) as sem_conversa,
           (select count(distinct x.conversation_id) from interesse x where x.imovel = i.codigo) as interessados,
           (select count(distinct x.conversation_id) filter (where x.nivel = 'muito') from interesse x where x.imovel = i.codigo) as muito
      from imoveis i
      left join public.anuncios a on a.codigo = i.codigo and a.excluido_em is null
  ),
  -- ---- Os meses.
  meses as (
    select g::date as mes,
           (g::timestamp at time zone 'America/Fortaleza') as ini,
           ((g + interval '1 month')::timestamp at time zone 'America/Fortaleza') as fim,
           greatest(0, (least((g + interval '1 month')::date - 1, v_hoje) - greatest(g::date, coalesce(v_inicio, g::date)) + 1))::int as dias
      from generate_series(v_mes_de::timestamp, date_trunc('month', v_hoje::timestamp), interval '1 month') g
  ),
  mch as materialized (
    select * from app.origem_chegadas((v_mes_de::timestamp at time zone 'America/Fortaleza'), v_mes_fim)
  ),
  -- ---- As semanas do período (segunda a domingo), até 13.
  semanas as (
    select s::date as inicio from generate_series(date_trunc('week', v_dei::timestamp), v_ate::timestamp, interval '7 days') s
     where v_inicio is null or s::date + 6 >= v_inicio
     order by s desc limit 13
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_dei, 'ate', v_ate),
    'desde', v_inicio,
    'pode_marcar', coalesce(app.admin_ou_gestor(), false),

    'kpis', jsonb_build_object(
      'chegadas', (select count(*) from ch)::int,
      'identificadas', (select count(*) from ch where ch.grupo <> 'nao_identificado')::int,
      'responderam', (select count(*) from ch where ch.resposta_em is not null)::int,
      'rapidas', (select count(*) from ch where ch.resposta_min <= 5)::int,
      'mediana_min', (select round(percentile_cont(0.5) within group (order by ch.resposta_min)::numeric, 1)
                        from ch where ch.resposta_min is not null),
      'subiram', (select count(distinct h.conversation_id) from hist h where h.de is not null and h.para_n > h.de_n)::int,
      'esfriaram', (select count(distinct h.conversation_id) from hist h where h.para = 'esfriando')::int,
      'visitas', (select count(*) from public.reunioes r
                   where r.criada_em >= v_de and r.criada_em < v_fim and r.estado <> 'cancelada'
                     and r.conversation_id is distinct from v_treino)::int,
      'visitas_canceladas', (select count(*) from public.reunioes r
                              where r.criada_em >= v_de and r.criada_em < v_fim and r.estado = 'cancelada'
                                and r.conversation_id is distinct from v_treino)::int,
      'fechados', (select count(*) from public.deals d
                    where d.status = 'won'::app.deal_status
                      and coalesce(d.won_at, d.updated_at) >= v_de and coalesce(d.won_at, d.updated_at) < v_fim)::int),

    'grupos', (select jsonb_agg(jsonb_build_object(
        'grupo', g.grupo,
        'chegadas', (select count(*) from ch where ch.grupo = g.grupo),
        'responderam', (select count(*) from ch where ch.grupo = g.grupo and ch.resposta_em is not null),
        'rapidas', (select count(*) from ch where ch.grupo = g.grupo and ch.resposta_min <= 5),
        'mediana_min', (select round(percentile_cont(0.5) within group (order by ch.resposta_min)::numeric, 1)
                          from ch where ch.grupo = g.grupo and ch.resposta_min is not null),
        'interessados', (select count(*) from ch where ch.grupo = g.grupo
                           and ch.etiqueta in ('interessado', 'muito_interessado')),
        'esfriando', (select count(*) from ch where ch.grupo = g.grupo and ch.etiqueta = 'esfriando'),
        'visitas', (select count(*) from ch where ch.grupo = g.grupo and ch.visita),
        'subs', coalesce((
            select jsonb_agg(jsonb_build_object('subcanal', x.subcanal, 'chegadas', x.n) order by x.n desc, x.subcanal)
              from (select ch.subcanal, count(*)::int as n from ch where ch.grupo = g.grupo and g.grupo <> 'meta'
                     group by 1) x), '[]'::jsonb),
        'anuncios', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'id', x.meta_id, 'titulo', x.titulo, 'chegadas', x.n, 'sem_resposta', x.sem_resposta,
                     'da_imova', (select d.da_imova from public.anuncios_da_meta d where d.anuncio_id = x.meta_id))
                   order by x.n desc, x.titulo)
              from (select ch.meta_id, max(ch.meta_titulo) as titulo, count(*)::int as n,
                           count(*) filter (where ch.resposta_em is null)::int as sem_resposta
                      from ch where ch.grupo = g.grupo and g.grupo = 'meta' group by 1) x), '[]'::jsonb))
        order by g.posicao) from grupos g),

    'placa', jsonb_build_object(
      'fotos', (select count(*) from ch where ch.grupo = 'placa' and ch.foto is not null)::int,
      'fotos_com_codigo', (select count(*) from ch where ch.grupo = 'placa'
                             and nullif(btrim(ch.foto ->> 'codigo_do_imovel'), '') is not null)::int),

    'semanas', coalesce((select jsonb_agg(jsonb_build_object(
        'inicio', s.inicio,
        'parcial', s.inicio < v_dei or s.inicio + 6 > v_ate,
        'grupos', (select jsonb_object_agg(g.grupo, (select count(*) from ch
                                                      where ch.grupo = g.grupo
                                                        and (ch.inicio_em at time zone 'America/Fortaleza')::date between s.inicio and s.inicio + 6))
                     from grupos g))
        order by s.inicio) from semanas s), '[]'::jsonb),

    'interesse', jsonb_build_object(
      'hoje', (select jsonb_build_object(
                 'sem_resposta', count(*) filter (where a.etiqueta = 'sem_resposta'),
                 'morno', count(*) filter (where a.etiqueta = 'morno'),
                 'interessado', count(*) filter (where a.etiqueta = 'interessado'),
                 'muito_interessado', count(*) filter (where a.etiqueta = 'muito_interessado'),
                 'esfriando', count(*) filter (where a.etiqueta = 'esfriando'),
                 'sem_interesse', count(*) filter (where a.etiqueta in ('sem_interesse', 'nao_contatar')),
                 'sem_etiqueta', count(*) filter (where a.etiqueta is null),
                 'total', count(*))
                 from public.atitudes a
                 join public.conversations cv on cv.id = a.conversation_id
                where a.conversation_id is distinct from v_treino and cv.arquivada_em is null),
      'subiram', (select count(distinct h.conversation_id) from hist h where h.de is not null and h.para_n > h.de_n)::int,
      'responderam', (select count(distinct h.conversation_id) from hist h where h.de = 'sem_resposta' and h.para = 'morno')::int,
      'ficaram_interessadas', (select count(distinct h.conversation_id) from hist h
                                where h.para = 'interessado' and h.de in ('sem_resposta', 'esfriando', 'morno', 'sem_interesse'))::int,
      'viraram_muito', (select count(distinct h.conversation_id) from hist h where h.para = 'muito_interessado' and h.de is not null)::int,
      'esfriaram', (select count(distinct h.conversation_id) from hist h where h.para = 'esfriando')::int,
      'juiza', (select jsonb_build_object(
                  'subiu', count(*) filter (where n.interesse = 'subiu'),
                  'igual', count(*) filter (where n.interesse = 'igual'),
                  'caiu', count(*) filter (where n.interesse = 'caiu'))
                  from public.ia_atendimento_notas n
                 where n.dia between v_dei and v_ate and not n.dados_insuficientes)),

    'anuncios', coalesce((select jsonb_agg(jsonb_build_object(
        'codigo', l.codigo, 'titulo', l.titulo,
        'situacao', case when l.situacao_crm = 'no_ar' or coalesce(l.portal_ativo, false) then 'no_ar'
                         when l.tem_portal then 'fora_do_ar' else 'so_no_crm' end,
        'vistos', l.vistos, 'contatos', l.contatos,
        'vistos_periodo', l.vistos_periodo, 'contatos_periodo', l.contatos_periodo,
        'juntou', l.juntou,
        'chegaram', l.chegaram, 'sem_conversa', l.sem_conversa,
        'interessados', l.interessados, 'muito', l.muito)
        order by l.interessados desc, l.vistos desc nulls last, l.codigo) from linhas_anuncio l), '[]'::jsonb),
    'numeros_desde', (select min(n.dia) from public.canal_pro_numeros_do_dia n),

    'sistema', jsonb_build_object(
      'primeiro', jsonb_build_object(
        'ia', (select count(*) from ch where ch.respondeu = 'ia')::int,
        'ia_mediana_min', (select round(percentile_cont(0.5) within group (order by ch.resposta_min)::numeric, 1)
                             from ch where ch.respondeu = 'ia'),
        'equipe', (select count(*) from ch where ch.respondeu = 'equipe')::int,
        'equipe_mediana_min', (select round(percentile_cont(0.5) within group (order by ch.resposta_min)::numeric, 1)
                                 from ch where ch.respondeu = 'equipe'),
        'ninguem', (select count(*) from ch where ch.resposta_em is null)::int),
      'descoberta', jsonb_build_object(
        'regra', (select count(*) from ch where not ch.marcado and ch.decidido_por = 'regra' and ch.grupo <> 'nao_identificado')::int,
        'ia', (select count(*) from ch where not ch.marcado and ch.decidido_por = 'ia' and ch.grupo <> 'nao_identificado')::int,
        'equipe', (select count(*) from ch where ch.marcado)::int,
        'sem_pista', (select count(*) from ch where not ch.marcado and ch.grupo = 'nao_identificado')::int,
        'fotos', (select count(*) from ch where ch.foto is not null)::int,
        'fotos_da_imova', (select count(*) from ch where ch.foto ->> 'peca' in ('placa', 'banner')
                             and ch.foto ->> 'marca' = 'imova')::int,
        'prints', (select count(*) from ch where ch.foto ->> 'peca' = 'print_de_anuncio')::int,
        'fotos_com_codigo', (select count(*) from ch where nullif(btrim(ch.foto ->> 'codigo_do_imovel'), '') is not null)::int),
      'sem_resposta', coalesce((select jsonb_agg(jsonb_build_object(
          'conversation_id', x.conversation_id, 'organization_id', x.organization_id,
          'inicio_em', x.inicio_em, 'grupo', x.grupo) order by x.inicio_em desc)
          from (select * from ch where ch.resposta_em is null order by ch.inicio_em desc limit 20) x), '[]'::jsonb),
      'grupo_olx', jsonb_build_object(
        'contatos', (select count(*) from pl where pl.origem = 'grupo_olx')::int,
        'sem_conversa', (select count(*) from pl where pl.origem = 'grupo_olx' and pl.sem_conversa)::int,
        'desde', (select min(p.recebido_em) from public.portal_leads p where p.origem = 'grupo_olx'),
        'telefone', (select count(*) from pl where pl.origem = 'grupo_olx' and pl.tipos[1] = 'PHONE_VIEW')::int,
        'chat', (select count(*) from pl where pl.origem = 'grupo_olx' and pl.tipos[1] = 'CONTACT_CHAT')::int,
        'formulario', (select count(*) from pl where pl.origem = 'grupo_olx' and pl.tipos[1] = 'CONTACT_FORM')::int,
        'whatsapp', (select count(*) from pl where pl.origem = 'grupo_olx' and pl.tipos[1] = 'CLICK_WHATSAPP')::int,
        'visita', (select count(*) from pl where pl.origem = 'grupo_olx'
                     and pl.tipos[1] in ('VISIT_REQUEST', 'CLICK_SCHEDULE'))::int,
        'por_anuncio', coalesce((select jsonb_agg(jsonb_build_object('codigo', x.codigo, 'contatos', x.n) order by x.n desc, x.codigo)
            from (select split_part(coalesce(pl.client_listing_id, '?'), '_', 1) as codigo, count(*)::int as n
                    from pl where pl.origem = 'grupo_olx' group by 1) x), '[]'::jsonb)),
      'mensagens', (select jsonb_build_object(
          'recebidas', count(*) filter (where m.direction = 'in'::app.msg_direction),
          'ia', count(*) filter (where m.direction = 'out'::app.msg_direction and m.author_kind = 'bot_ai'),
          'equipe', count(*) filter (where m.direction = 'out'::app.msg_direction and m.author_kind = 'human'))
          from public.messages m
         where m.created_at >= v_de and m.created_at < v_fim
           and m.conversation_id is distinct from v_treino)),

    'meses', coalesce((select jsonb_agg(jsonb_build_object(
        'mes', to_char(mm.mes, 'YYYY-MM'),
        'dias', mm.dias,
        'chegadas', (select count(*) from mch where mch.inicio_em >= mm.ini and mch.inicio_em < mm.fim),
        'grupos', (select jsonb_object_agg(g.grupo, (select count(*) from mch
                                                      where mch.grupo = g.grupo and mch.inicio_em >= mm.ini and mch.inicio_em < mm.fim))
                     from grupos g),
        'nossas', (select count(*) from public.conversations cv
                    where cv.created_at >= mm.ini and cv.created_at < mm.fim
                      and cv.id is distinct from v_treino
                      and not exists (select 1 from public.chegadas c where c.conversation_id = cv.id)),
        'responderam', (select count(*) from mch where mch.inicio_em >= mm.ini and mch.inicio_em < mm.fim and mch.resposta_em is not null),
        'rapidas', (select count(*) from mch where mch.inicio_em >= mm.ini and mch.inicio_em < mm.fim and mch.resposta_min <= 5),
        'mediana_min', (select round(percentile_cont(0.5) within group (order by mch.resposta_min)::numeric, 1)
                          from mch where mch.inicio_em >= mm.ini and mch.inicio_em < mm.fim and mch.resposta_min is not null),
        'sem_resposta', (select count(*) from mch where mch.inicio_em >= mm.ini and mch.inicio_em < mm.fim and mch.resposta_em is null),
        'recebidas', (select count(*) from public.messages m
                       where m.created_at >= mm.ini and m.created_at < mm.fim and m.direction = 'in'::app.msg_direction
                         and m.conversation_id is distinct from v_treino),
        'ia', (select count(*) from public.messages m
                where m.created_at >= mm.ini and m.created_at < mm.fim and m.direction = 'out'::app.msg_direction
                  and m.author_kind = 'bot_ai' and m.conversation_id is distinct from v_treino),
        'equipe', (select count(*) from public.messages m
                    where m.created_at >= mm.ini and m.created_at < mm.fim and m.direction = 'out'::app.msg_direction
                      and m.author_kind = 'human' and m.conversation_id is distinct from v_treino),
        'subiram', (select count(distinct h.conversation_id) from public.atitude_historico h
                     where h.tipo = 'etiqueta' and h.em >= mm.ini and h.em < mm.fim and h.de is not null
                       and h.conversation_id is distinct from v_treino
                       and coalesce(array_position(array['sem_resposta', 'esfriando', 'morno', 'interessado', 'muito_interessado'], h.para), 0)
                         > coalesce(array_position(array['sem_resposta', 'esfriando', 'morno', 'interessado', 'muito_interessado'], h.de), 0)),
        'esfriaram', (select count(distinct h.conversation_id) from public.atitude_historico h
                       where h.tipo = 'etiqueta' and h.em >= mm.ini and h.em < mm.fim and h.para = 'esfriando'
                         and h.conversation_id is distinct from v_treino),
        'visitas', (select count(*) from public.reunioes r
                     where r.criada_em >= mm.ini and r.criada_em < mm.fim and r.estado <> 'cancelada'
                       and r.conversation_id is distinct from v_treino),
        'fechados', (select count(*) from public.deals d
                      where d.status = 'won'::app.deal_status
                        and coalesce(d.won_at, d.updated_at) >= mm.ini and coalesce(d.won_at, d.updated_at) < mm.fim))
        order by mm.mes) from meses mm), '[]'::jsonb)
  )
  into v_res;

  return v_res;
end $$;
comment on function public.relatorio_imova_painel_origem(date, date) is
  'A aba Origem e interesse dos Relatórios da Imova (18/11/2026): de onde vieram as chegadas do período (com a Meta por anúncio), anúncio a anúncio (vistos e contatos no portal, quem chegou com o código, quem se interessou), o interesse (degraus, quem subiu e esfriou), as semanas, até seis meses e como o sistema está lidando. Admin, gestor e SDR. Datas em America/Fortaleza; padrão: os últimos 30 dias.';
revoke all on function public.relatorio_imova_painel_origem(date, date) from public, anon;
grant execute on function public.relatorio_imova_painel_origem(date, date) to authenticated;

  $ddl$;
end $origem$;

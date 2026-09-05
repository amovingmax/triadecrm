-- =====================================================================
-- TRIADE — v0.1 — D9 — ROTAS DE VISITA
-- (RF-ROT-01 a RF-ROT-07; PRD §7.5 e §9; ADR-03, ADR-04, ADR-11;
--  anexos R06 §5 e §92, R09.)
--
-- O BLOQUEIO QUE ESTE ARQUIVO DESTRAVA
-- ---------------------------------------------------------------------
-- A tela /agenda já agrupa as visitas do dia por bairro, e diz na cara que
-- não existe rota otimizada porque NENHUMA das 100 organizações da base
-- tem coordenada. Não é falta de código de roteirização: é falta de
-- latitude e longitude. Sem elas, "ordem por vizinho mais próximo" seria
-- ordem por nada.
--
-- =====================================================================
-- DECISÃO 1 — DE ONDE VÊM AS COORDENADAS: NOMINATIM (OpenStreetMap)
-- =====================================================================
-- O R06 §5 é explícito: "Google Maps/Places não pode virar base do CRM.
-- Os termos da Google Maps Platform proíbem 'copy and save business names,
-- addresses, or user reviews' e limitam cache a `place_id` (e lat/lng por
-- 30 dias)". A tabela de fontes do R06 fecha a questão na coluna de
-- alternativa: "OpenStreetMap (ODbL) para geodados".
--
-- Guardar a coordenada de um parceiro no CRM é exatamente o "save" que os
-- termos do Google proíbem. Então a coordenada vem do OpenStreetMap, pelo
-- Nominatim, sob ODbL — que EXIGE atribuição e permite guardar. A licença
-- devolvida em cada resposta fica gravada em `geo_places.licenca`, e a
-- tela credita o OpenStreetMap.
--
-- O Google Maps continua no produto para NAVEGAR: abrir o aplicativo de
-- mapas com um destino é uso de usuário final, não é cópia de base. O que
-- o R06 proíbe é guardar os dados deles; não é abrir o app deles.
--
-- A política de uso do Nominatim (nominatim.org/release-docs/latest/api/
-- Overview) tem três exigências, e todas são respeitadas do lado do worker
-- (apps/workers/src/rotas/nominatim.ts), não aqui:
--   1. no máximo 1 requisição por segundo — o worker serializa e dorme;
--   2. User-Agent identificando a aplicação e um contato — vai carimbado;
--   3. resultado em cache, para não repetir a mesma pergunta — é esta
--      tabela `public.geo_places`.
-- A terceira exigência é a razão de a tabela existir. Sem cache, montar a
-- rota da tarde bateria no Nominatim de novo todo dia, para as mesmas 39
-- perguntas. Com cache, cada pergunta é feita UMA vez na vida.
--
-- =====================================================================
-- DECISÃO 2 — A PRECISÃO É PARTE DO DADO, NÃO NOTA DE RODAPÉ
-- =====================================================================
-- O que a base tem hoje é bairro e cidade; logradouro, nenhum (100 de 100
-- com `address` nulo). Geocodificar "Capim Macio, Natal, RN" devolve o
-- CENTROIDE DO BAIRRO — um ponto no meio de um polígono de ~1,3 km de
-- raio. Isso é bom o bastante para AGRUPAR e ORDENAR visitas, e é ruim
-- para dizer "chegue aqui": mandar a Heloísa para o centroide de Capim
-- Macio achando que é a porta do buffet é pior do que não ter rota
-- nenhuma, porque ela sai do carro.
--
-- Por isso `app.geo_precision` ('logradouro' | 'bairro' | 'cidade') não é
-- opcional: o CHECK abaixo impede coordenada sem precisão declarada. E a
-- precisão não sai do que PERGUNTAMOS, sai do que o OSM RESPONDEU (o
-- `addresstype` da resposta): perguntar por um bairro e receber um
-- município é o erro que o `escopo` sozinho esconderia.
--
-- `raio_m` é a segunda metade da mesma honestidade: a meia-diagonal da
-- caixa delimitadora que o OSM devolve, calculada em metros pelo PostGIS.
-- É o tamanho da incerteza, em número, e a tela mostra esse número.
--
-- RF-ROT-01 manda o alvo com precisão "cidade" ficar FORA do planejador
-- até correção. Aqui isso é regra de banco (`app.rota_alvos`), não regra
-- de tela: o centro de Natal não é o endereço de ninguém.
--
-- =====================================================================
-- DECISÃO 3 — QUEM ORDENA É O OSRM, NA MÁQUINA DEDICADA
-- =====================================================================
-- O web roda na Vercel (docs/operacao/publicar-na-vercel.md) e o OSRM roda
-- na máquina do Luiz, sem porta publicada (infra/local/docker-compose.yml).
-- A Vercel não alcança o OSRM, e não deve alcançar. Então o caminho é o
-- mesmo de todo o resto do sistema (ADR-04): a tela ENFILEIRA o pedido em
-- `pgmq`, o worker consome quando está ligado, chama o OSRM e grava a
-- ordem de volta. A tela mostra o estado real da fila — inclusive
-- "o worker de rotas não bate ponto desde as 14:12", que é a verdade nos
-- dias em que a máquina está desligada.
--
-- Nada aqui calcula distância em linha reta e chama de rota. Se o OSRM não
-- responder, o plano fica `falhou` com o motivo escrito, e a tela cai no
-- que a agenda já fazia: agrupar por bairro e dizer por quê.
--
-- =====================================================================
-- DECISÃO 4 — A ROTA RECONFERE NA MONTAGEM (a forma do 20260905000100)
-- =====================================================================
-- A tarefa de visita nasce dias antes de ser percorrida, e nasce com
-- `app.tasks_guard_suppressed` dizendo que naquele momento podia. Entre a
-- criação da tarefa e a manhã da visita existe tempo, e no tempo o mundo
-- muda: a pessoa pede para sair, a ficha é apagada, a irmã com o mesmo
-- telefone entra na `suppression_list`. Foi exatamente assim que o dreno
-- da Komune furou (20260905000100_dreno_reconfere.sql): a decisão morava
-- na ENFILEIRADA e o dreno não recheca nada.
--
-- A rota não repete o erro. A elegibilidade mora em UMA função,
-- `app.rota_alvos`, e ela é chamada nos QUATRO pontos do ciclo:
--   1. `public.rota_do_dia`      — quando a tela mostra o que entra;
--   2. `public.rota_montar`      — quando a pessoa pede a rota;
--   3. `public.rota_proximas`    — quando o worker tira o pedido da fila;
--   4. `public.rota_gravar_ordem`— quando a ordem volta do OSRM, parada a
--      parada, antes de virar linha em `route_stops`.
-- Uma parada que ficou suprimida enquanto o OSRM calculava NÃO é gravada,
-- ainda que o OSRM tenha devolvido tempo para ela.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. PostGIS
--
-- Já estava no ADR-01 e ainda não tinha sido instalado (nenhuma tabela
-- precisava de geometria até hoje). Entra no schema `extensions`, como as
-- outras (20260904000100).
-- ---------------------------------------------------------------------
create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------
-- B. Precisão da coordenada
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t
                   join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'app' and t.typname = 'geo_precision') then
    create type app.geo_precision as enum ('logradouro', 'bairro', 'cidade', 'incerta');
  end if;
end $$;

comment on type app.geo_precision is
  'O que a coordenada sabe responder. logradouro = a porta; bairro = o centroide do polígono do bairro (ordena visita, NÃO manda ninguém chegar); cidade = o centro do município; incerta = o OSM devolveu um lugar de outro tipo (uma praia, uma estação) e ninguém sabe o que aquele ponto significa. Só logradouro e bairro entram no planejador (RF-ROT-01).';

-- `incerta` não é preciosismo. Na primeira passada de verdade sobre a base,
-- "Ponta Negra, Natal, RN" devolveu uma PRAIA (natural/beach) e
-- "Cidade Satélite, Natal, RN" devolveu uma ESTAÇÃO FERROVIÁRIA
-- (railway/railway) — nenhuma das duas é o polígono do bairro que a pergunta
-- pedia. Chamar aquilo de "centro do município" seria mentira com dado
-- verdadeiro; chamar de "bairro" seria pior. `incerta` é o nome certo, fica
-- fora da rota, e a tela diz o que o OSM respondeu para alguém decidir.

-- ---------------------------------------------------------------------
-- C. `public.geo_places` — o cache do Nominatim
--
-- Uma linha por PERGUNTA, não por organização. Seis fornecedores em Capim
-- Macio são uma pergunta só; 39 organizações com bairro em Natal são 21
-- perguntas. É o que transforma "geocodificar a base" em menos de meio
-- minuto de Nominatim a 1 req/s, dentro da política deles.
--
-- `encontrado = false` é uma resposta legítima e fica gravada: sem isso, a
-- pergunta que o OSM não sabe responder voltaria à fila todo dia.
-- ---------------------------------------------------------------------
create table if not exists public.geo_places (
  id              bigint generated always as identity primary key,
  -- A pergunta, exatamente como foi ao Nominatim.
  consulta        text not null,
  -- A mesma pergunta sem acento e em minúscula: a chave única. `unaccent`
  -- não é imutável, então a normalização é gravada, não indexada por
  -- expressão.
  consulta_norm   text not null,
  -- O que a pergunta PEDIA (bairro ou cidade).
  escopo          app.geo_precision not null,
  city_id         integer references public.cities (id) on delete set null,
  neighborhood    text,
  encontrado      boolean not null default false,
  lat             double precision,
  lng             double precision,
  -- O que a RESPOSTA É, derivado do `addresstype` do OSM.
  precisao        app.geo_precision,
  -- Meia-diagonal da caixa delimitadora, em metros: o tamanho da incerteza.
  raio_m          integer,
  osm_type        text,
  osm_id          bigint,
  osm_class       text,
  osm_addresstype text,
  display_name    text,
  fonte           text not null default 'nominatim',
  -- ODbL exige atribuição; a licença vem na resposta e fica com o dado.
  licenca         text not null default 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
  buscado_em      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint geo_places_coordenada_chk check (
    (encontrado and lat is not null and lng is not null and precisao is not null)
    or (not encontrado and lat is null and lng is null and precisao is null)
  ),
  constraint geo_places_lat_chk check (lat is null or (lat between -90 and 90)),
  constraint geo_places_lng_chk check (lng is null or (lng between -180 and 180)),
  constraint geo_places_raio_chk check (raio_m is null or raio_m >= 0)
);

create unique index if not exists geo_places_consulta_uq on public.geo_places (consulta_norm);
create index if not exists geo_places_bairro_idx
  on public.geo_places (city_id, neighborhood) where neighborhood is not null;

comment on table public.geo_places is
  'Cache de geocodificação do Nominatim/OpenStreetMap (RF-ROT-01). Uma linha por pergunta, para nunca repetir a mesma consulta — a política do Nominatim pede cache, e a ODbL pede a atribuição que fica em `licenca`. Google Maps não entra aqui: os termos dele proíbem guardar (R06 §5).';
comment on column public.geo_places.escopo is 'O que a pergunta pedia.';
comment on column public.geo_places.precisao is 'O que a resposta é, lida do `addresstype` do OSM. Pode ser pior que o escopo — e é isso que precisa aparecer.';
comment on column public.geo_places.raio_m is 'Meia-diagonal da caixa delimitadora do OSM, em metros: o tamanho da incerteza daquele ponto.';

drop trigger if exists geo_places_updated_at on public.geo_places;
create trigger geo_places_updated_at
  before update on public.geo_places
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------
-- D. A coordenada na ficha
--
-- `lat`/`lng` já existiam em `organizations` (e estavam nulos em 100 de
-- 100). O que faltava era a procedência e a precisão. O CHECK garante que
-- daqui em diante nenhuma coordenada entre sem dizer o que ela é.
-- ---------------------------------------------------------------------
alter table public.organizations
  add column if not exists geo_precision app.geo_precision,
  add column if not exists geo_place_id  bigint references public.geo_places (id) on delete set null,
  add column if not exists geo_radius_m  integer,
  add column if not exists geocoded_at   timestamptz;

-- Antes do CHECK, o acerto do que já existe.
--
-- `organizations.lat`/`lng` são colunas antigas (20260904000300) e o gatilho de
-- escrita de `organizations_view` sempre as repassou. No banco de hoje elas
-- estão nulas em 100 de 100 fichas, mas um banco que já tenha recebido
-- coordenada por qualquer outro caminho travaria a migração inteira num
-- "check constraint is violated by some row" — e o certo, para uma coordenada
-- de origem desconhecida, não é recusar a migração: é dizer a verdade sobre
-- ela. `incerta` é essa verdade, e mantém o ponto fora do planejador.
update public.organizations
   set geo_precision = 'incerta'::app.geo_precision
 where lat is not null and lng is not null and geo_precision is null;

-- Coordenada pela metade (uma das duas nula) nunca foi utilizável: some.
update public.organizations set lat = null, lng = null
 where num_nonnulls(lat, lng) = 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_geo_chk') then
    alter table public.organizations add constraint organizations_geo_chk check (
      num_nonnulls(lat, lng) <> 1
      and (lat is null or geo_precision is not null)
      and (geo_precision is null or lat is not null)
    );
  end if;
end $$;

-- E o mesmo cuidado daqui para a frente, para o CHECK não virar um 23514 na
-- cara de quem está editando uma ficha.
--
-- `organizations_view` repassa `lat`/`lng` na escrita e NÃO tem coluna de
-- precisão: uma coordenada que entre por ali chegaria muda. Recusar a escrita
-- seria transformar um dado sem procedência em erro de tela; o gatilho faz a
-- coisa honesta — aceita a coordenada e a marca como `incerta`, que é
-- exatamente o que ela é, e que já a mantém fora da rota (RF-ROT-01).
create or replace function app.organizations_geo_precision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lat is not null and new.lng is not null and new.geo_precision is null then
    new.geo_precision := 'incerta'::app.geo_precision;
  elsif new.lat is null or new.lng is null then
    new.lat := null;
    new.lng := null;
    new.geo_precision := null;
    new.geo_radius_m := null;
  end if;
  return new;
end $$;

comment on function app.organizations_geo_precision() is
  'Coordenada nunca fica muda: entrou sem precisão declarada, vira `incerta` — e `incerta` fica fora do planejador de rotas (RF-ROT-01).';

drop trigger if exists organizations_geo_precision on public.organizations;
-- `a_` no nome para rodar ANTES de `app.organizations_before_write` e dos
-- outros gatilhos BEFORE, que o Postgres dispara em ordem alfabética.
create trigger a_organizations_geo_precision
  before insert or update of lat, lng, geo_precision on public.organizations
  for each row execute function app.organizations_geo_precision();

comment on column public.organizations.geo_precision is
  'O que a coordenada da ficha sabe responder (RF-ROT-01). `bairro` é centroide: serve para ordenar a visita, não para chegar na porta.';
comment on column public.organizations.geo_radius_m is
  'Raio aproximado da incerteza, em metros, herdado de `geo_places.raio_m`.';

-- Geografia derivada: é ela que o PostGIS indexa, e é ela que o check-in
-- por geolocalização (RF-ROT-06, [v1]) vai medir. Coluna gerada, para não
-- existir caminho em que a geometria discorde de `lat`/`lng`.
alter table public.organizations
  add column if not exists geog extensions.geography(Point, 4326)
  generated always as (
    case when lat is not null and lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
    end
  ) stored;

create index if not exists organizations_geog_idx
  on public.organizations using gist (geog)
  where deleted_at is null;

-- ---------------------------------------------------------------------
-- E. O plano da tarde e as paradas
--
-- Um plano por pessoa e por dia (RF-ROT-03). Remontar não cria plano novo:
-- reusa a linha e incrementa `tentativa`, que é o que dá chave de
-- idempotência diferente para a fila sem deixar lixo de planos velhos.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t
                   join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'app' and t.typname = 'route_status') then
    create type app.route_status as enum ('enfileirada', 'pronta', 'falhou');
  end if;
end $$;

create table if not exists public.route_plans (
  id             uuid primary key default gen_random_uuid(),
  plan_date      date not null,
  assignee_id    uuid not null references public.profiles (id) on delete cascade,
  origin_label   text not null,
  origin_lat     double precision not null,
  origin_lng     double precision not null,
  status         app.route_status not null default 'enfileirada',
  tentativa      integer not null default 1,
  engine         text not null default 'osrm',
  total_seconds  integer,
  total_meters   integer,
  failure_reason text,
  computed_at    timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint route_plans_origem_chk check (
    origin_lat between -90 and 90 and origin_lng between -180 and 180
  ),
  constraint route_plans_tentativa_chk check (tentativa >= 1)
);

create unique index if not exists route_plans_dia_uq
  on public.route_plans (assignee_id, plan_date);
create index if not exists route_plans_status_idx
  on public.route_plans (status, plan_date);

comment on table public.route_plans is
  'A rota da tarde de uma pessoa num dia (RF-ROT-03). Quem calcula a ordem é o OSRM na máquina dedicada; esta linha é o pedido e o resultado.';

drop trigger if exists route_plans_updated_at on public.route_plans;
create trigger route_plans_updated_at
  before update on public.route_plans
  for each row execute function app.set_updated_at();

create table if not exists public.route_stops (
  plan_id           uuid not null references public.route_plans (id) on delete cascade,
  position          smallint not null,
  task_id           uuid not null references public.tasks (id) on delete cascade,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  lat               double precision not null,
  lng               double precision not null,
  geo_precision     app.geo_precision not null,
  geo_radius_m      integer,
  -- Tempo e distância DESDE A PARADA ANTERIOR (na primeira, desde a origem),
  -- pelo grafo de ruas do OSRM. Nunca linha reta.
  seconds_from_prev integer not null,
  meters_from_prev  integer not null,
  created_at        timestamptz not null default now(),
  primary key (plan_id, position),
  constraint route_stops_pos_chk    check (position >= 1),
  constraint route_stops_tempo_chk  check (seconds_from_prev >= 0 and meters_from_prev >= 0)
);

create unique index if not exists route_stops_tarefa_uq on public.route_stops (plan_id, task_id);
create index if not exists route_stops_org_idx on public.route_stops (organization_id);

comment on table public.route_stops is
  'As paradas de um plano, na ordem que o OSRM devolveu. `seconds_from_prev` é tempo de carro pelo grafo de ruas, não distância em linha reta.';
comment on column public.route_stops.geo_precision is
  'A precisão CONGELADA no momento da montagem: a rota registra com que qualidade de coordenada ela foi feita.';

-- ---------------------------------------------------------------------
-- F. A fila
--
-- Reusa a esteira que já existe (ADR-11): catálogo em `ingest_queues`,
-- dedup em `ingest_dedup`, `visibility timeout`, backoff e dead-letter.
-- Nenhuma máquina de fila nova.
-- ---------------------------------------------------------------------
alter table public.ingest_queues drop constraint if exists ingest_queues_worker_check;
alter table public.ingest_queues add constraint ingest_queues_worker_check
  check (worker = any (array['ingest', 'wa', 'ai', 'rotas']));

insert into public.ingest_queues (name, visibility_seconds, max_attempts, description, worker) values
  ('rotas_dlq', 3600, 1,
   'Dead-letter das rotas: pedido que falhou além do teto para onde alguém veja. Ninguém consome automaticamente.',
   'rotas'),
  ('rotas_jobs', 120, 3,
   'Pedido de rota da tarde: matriz de tempos no OSRM e ordem das paradas (RF-ROT-03). Dois minutos cabem a matriz mais a gravação.',
   'rotas')
on conflict (name) do update
  set visibility_seconds = excluded.visibility_seconds,
      max_attempts       = excluded.max_attempts,
      description        = excluded.description,
      worker             = excluded.worker;

update public.ingest_queues set dlq = 'rotas_dlq' where name = 'rotas_jobs';

do $$
declare
  q text;
begin
  foreach q in array array['rotas_jobs', 'rotas_dlq'] loop
    if not exists (select 1 from pgmq.list_queues() lq where lq.queue_name = q) then
      perform pgmq.create(q);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- G. Configuração do planejador
--
-- Origem, teto de paradas e janela da tarde ficam em `app_settings`
-- (RF-ROT-03 pede 3–6 paradas configuráveis, entre 14:00 e 18:00). A
-- origem padrão é o marco zero de Natal, e a tela DIZ que é padrão: fingir
-- que o CRM sabe de onde a Heloísa sai seria inventar dado.
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('rotas.planejador',
   jsonb_build_object(
     'origem', jsonb_build_object(
       'rotulo', 'Centro de Natal (origem padrão)',
       'lat', -5.7945, 'lng', -35.2094,
       'confirmada', false),
     'max_paradas', 4,
     'min_paradas', 3,
     'teto_paradas', 6,
     'janela', jsonb_build_object('inicio', '14:00', 'fim', '18:00')),
   'Planejador de rotas (RF-ROT-03): ponto de partida, teto de paradas e janela da tarde. `origem.confirmada = false` significa que ninguém confirmou de onde a pessoa sai — a tela avisa.')
on conflict (key) do nothing;

-- =====================================================================
-- H. A REGRA DE QUEM ENTRA NA ROTA — uma só, chamada quatro vezes
-- =====================================================================
-- `elegivel = false` não some da resposta: some da rota e APARECE na tela
-- com o motivo. "Sumiu e não sei por quê" é o jeito de a ferramenta perder
-- a confiança de quem usa.
--
-- A ordem dos motivos é a ordem da gravidade: supressão antes de tudo, e
-- ficha apagada antes de qualquer coisa sobre coordenada. Uma ficha
-- apagada não vira "sem coordenada" — vira "apagada".
-- =====================================================================
create or replace function app.rota_alvos(p_dia date, p_assignee uuid)
returns table (
  task_id         uuid,
  organization_id uuid,
  organizacao     text,
  bairro          text,
  cidade          text,
  endereco        text,
  titulo          text,
  due_at          timestamptz,
  lat             double precision,
  lng             double precision,
  precisao        app.geo_precision,
  raio_m          integer,
  temperatura     app.temperature,
  categoria       text,
  deal_id         uuid,
  etapa           text,
  elegivel        boolean,
  motivo          text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    o.id,
    o.name,
    o.neighborhood,
    c.name,
    o.address,
    t.title,
    t.due_at,
    case when o.deleted_at is null then o.lat end,
    case when o.deleted_at is null then o.lng end,
    o.geo_precision,
    o.geo_radius_m,
    coalesce(d.temperature, o.temperature),
    cat.name,
    d.id,
    st.name,
    -- elegível
    o.deleted_at is null
      and o.anonymized_at is null
      and not app.is_suppressed_target(o.id, t.contact_id)
      and o.lat is not null
      and o.geo_precision in ('logradouro'::app.geo_precision, 'bairro'::app.geo_precision),
    -- e, quando não é, por quê
    case
      when o.deleted_at is not null or o.anonymized_at is not null then 'apagada'
      when app.is_suppressed_target(o.id, t.contact_id)             then 'suprimido'
      when o.lat is null                                            then 'sem_coordenada'
      when o.geo_precision = 'cidade'::app.geo_precision            then 'so_cidade'
      when o.geo_precision = 'incerta'::app.geo_precision           then 'precisao_incerta'
    end
  from public.tasks t
  join public.organizations o on o.id = t.organization_id
  left join public.cities c on c.id = o.city_id
  left join public.deals d on d.id = t.deal_id
  left join public.stages st on st.id = d.stage_id
  left join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
  left join public.categories cat on cat.id = pc.category_id
  where t.assignee_id = p_assignee
    and t.kind = 'visit'::app.task_kind
    and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
    and t.due_at is not null
    and (t.due_at at time zone 'America/Fortaleza')::date = p_dia
  order by t.due_at, o.name, t.id
$$;

comment on function app.rota_alvos(date, uuid) is
  'As visitas de um dia e quem delas pode entrar na rota (RF-ROT-03). Reconfere supressão, ficha apagada e precisão da coordenada A CADA CHAMADA — é a mesma forma do dreno da Komune (20260905000100): a decisão não pode morar só na criação da tarefa.';

-- =====================================================================
-- I. O QUE A TELA LÊ
-- =====================================================================
create or replace function public.rota_do_dia(
  p_dia      date default null,
  p_assignee uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_alvo      uuid;
  v_dia       date := coalesce(p_dia, (now() at time zone 'America/Fortaleza')::date);
  v_cfg       jsonb;
  v_plano     public.route_plans%rowtype;
  v_alvos     jsonb;
  v_paradas   jsonb;
  v_pulso     timestamptz;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_alvo := coalesce(p_assignee, v_uid);
  if v_alvo <> v_uid and not app.is_manager() then
    raise exception 'Só gestor ou admin lê a rota de outra pessoa' using errcode = '42501';
  end if;

  select value into v_cfg from public.app_settings where key = 'rotas.planejador';
  select * into v_plano from public.route_plans
   where assignee_id = v_alvo and plan_date = v_dia;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.due_at, a.organizacao), '[]'::jsonb)
    into v_alvos
    from app.rota_alvos(v_dia, v_alvo) a;

  -- As paradas gravadas, cada uma reconferida DE NOVO na leitura: um plano
  -- calculado às 13:40 pode ter uma parada suprimida às 13:55, e a tela não
  -- pode ser o último lugar do sistema a saber disso.
  select coalesce(jsonb_agg(jsonb_build_object(
           'posicao',           s.position,
           'task_id',           s.task_id,
           'organization_id',   s.organization_id,
           'organizacao',       o.name,
           'bairro',            o.neighborhood,
           'cidade',            ci.name,
           'endereco',          o.address,
           'titulo',            t.title,
           'quando',            t.due_at,
           'lat',               s.lat,
           'lng',               s.lng,
           'precisao',          s.geo_precision,
           'raio_m',            s.geo_radius_m,
           'segundos_do_anterior', s.seconds_from_prev,
           'metros_do_anterior',   s.meters_from_prev,
           'temperatura',       coalesce(d.temperature, o.temperature),
           'etapa',             st.name,
           'concluida',         t.status = 'done'::app.task_status,
           'ainda_vale',        o.deleted_at is null
                                  and o.anonymized_at is null
                                  and not app.is_suppressed_target(o.id, t.contact_id)
         ) order by s.position), '[]'::jsonb)
    into v_paradas
    from public.route_stops s
    join public.tasks t on t.id = s.task_id
    join public.organizations o on o.id = s.organization_id
    left join public.cities ci on ci.id = o.city_id
    left join public.deals d on d.id = t.deal_id
    left join public.stages st on st.id = d.stage_id
   where s.plan_id = v_plano.id;

  select max(h.last_beat_at) into v_pulso
    from public.worker_heartbeats h where h.worker = 'rotas';

  return jsonb_build_object(
    'dia', v_dia,
    'assignee_id', v_alvo,
    'config', v_cfg,
    'plano', case when v_plano.id is null then null else jsonb_build_object(
      'id',             v_plano.id,
      'status',         v_plano.status,
      'tentativa',      v_plano.tentativa,
      'origem',         jsonb_build_object('rotulo', v_plano.origin_label,
                                           'lat', v_plano.origin_lat,
                                           'lng', v_plano.origin_lng),
      'total_segundos', v_plano.total_seconds,
      'total_metros',   v_plano.total_meters,
      'motivo_da_falha', v_plano.failure_reason,
      'calculado_em',   v_plano.computed_at,
      'pedido_em',      v_plano.updated_at) end,
    'paradas', coalesce(v_paradas, '[]'::jsonb),
    'alvos', v_alvos,
    'motor', jsonb_build_object(
      'nome', 'osrm',
      'ultimo_pulso', v_pulso,
      -- 10 minutos é o mesmo limite do alerta de worker parado (RF-ADM-07).
      'de_pe', v_pulso is not null and v_pulso > now() - interval '10 minutes'),
    'atribuicao', 'Coordenadas © colaboradores do OpenStreetMap (ODbL); rotas pelo OSRM.'
  );
end $$;

comment on function public.rota_do_dia(date, uuid) is
  'Tudo que a tela de rota precisa num objeto: o plano, as paradas na ordem do OSRM, os alvos do dia com o motivo de quem ficou de fora, e se o worker de rotas está de pé (RF-ROT-03, RF-ROT-05).';

-- =====================================================================
-- J. PEDIR A ROTA
-- =====================================================================
create or replace function public.rota_montar(
  p_dia         date default null,
  p_assignee    uuid default null,
  p_max_paradas int  default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_alvo   uuid;
  v_dia    date := coalesce(p_dia, (now() at time zone 'America/Fortaleza')::date);
  v_cfg    jsonb;
  v_max    int;
  v_teto   int;
  v_n      int;
  v_plano  public.route_plans%rowtype;
  v_fila   jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_alvo := coalesce(p_assignee, v_uid);
  if v_alvo <> v_uid and not app.is_manager() then
    raise exception 'Só gestor ou admin monta a rota de outra pessoa' using errcode = '42501';
  end if;

  select value into v_cfg from public.app_settings where key = 'rotas.planejador';
  v_teto := coalesce((v_cfg ->> 'teto_paradas')::int, 6);
  v_max  := least(greatest(coalesce(p_max_paradas, (v_cfg ->> 'max_paradas')::int, 4), 1), v_teto);

  -- Reconferência 2 de 4: quantos alvos AINDA são elegíveis agora.
  select count(*) into v_n from app.rota_alvos(v_dia, v_alvo) a where a.elegivel;
  if v_n = 0 then
    return jsonb_build_object('enfileirado', false, 'motivo', 'sem_alvos',
      'frase', 'Nenhuma visita do dia tem coordenada boa o bastante para entrar numa rota.');
  end if;

  insert into public.route_plans as rp (
      plan_date, assignee_id, origin_label, origin_lat, origin_lng,
      status, tentativa, created_by)
  values (
      v_dia, v_alvo,
      coalesce(v_cfg -> 'origem' ->> 'rotulo', 'Origem padrão'),
      coalesce((v_cfg -> 'origem' ->> 'lat')::double precision, -5.7945),
      coalesce((v_cfg -> 'origem' ->> 'lng')::double precision, -35.2094),
      'enfileirada'::app.route_status, 1, v_uid)
  on conflict (assignee_id, plan_date) do update
     set status         = 'enfileirada'::app.route_status,
         tentativa      = rp.tentativa + 1,
         failure_reason = null,
         total_seconds  = null,
         total_meters   = null,
         computed_at    = null,
         origin_label   = excluded.origin_label,
         origin_lat     = excluded.origin_lat,
         origin_lng     = excluded.origin_lng
  returning * into v_plano;

  -- Remontar apaga as paradas velhas: meia rota antiga misturada com meia
  -- rota nova é pior que nenhuma rota.
  delete from public.route_stops where plan_id = v_plano.id;

  -- `tentativa` viaja no payload porque um plano remontado deixa a mensagem
  -- ANTERIOR viva na fila: sem esse número, o worker calcularia a mesma rota
  -- duas vezes e chamaria o OSRM à toa. Quem descarta a mensagem velha é
  -- `public.rota_proximas`, comparando com a tentativa atual do plano.
  v_fila := app.esteira_enfileirar(
    'rotas_jobs',
    jsonb_build_object(
      'chave', 'rota:' || v_plano.id::text || ':' || v_plano.tentativa::text,
      'plano_id', v_plano.id,
      'tentativa', v_plano.tentativa,
      'max_paradas', v_max),
    'rota:' || v_plano.id::text || ':' || v_plano.tentativa::text,
    null, 0);

  return jsonb_build_object(
    'enfileirado', coalesce((v_fila ->> 'enfileirado')::boolean, false),
    'plano_id', v_plano.id,
    'tentativa', v_plano.tentativa,
    'alvos_elegiveis', v_n,
    'max_paradas', v_max,
    'fila', v_fila);
end $$;

comment on function public.rota_montar(date, uuid, int) is
  'Pede a rota da tarde: reconfere os alvos, cria ou reaproveita o plano do dia e enfileira em `rotas_jobs`. Quem calcula é o worker de rotas com o OSRM (ADR-04) — a Vercel não alcança a máquina dedicada.';

-- =====================================================================
-- K. O DRENO DO WORKER — reconfere de novo (3 de 4)
-- =====================================================================
create or replace function public.rota_proximas(p_qty int default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msgs    jsonb;
  v_msg     jsonb;
  v_saida   jsonb := '[]'::jsonb;
  v_plano   public.route_plans%rowtype;
  v_max     int;
  v_paradas jsonb;
begin
  v_msgs := public.esteira_fila_ler('rotas_jobs', least(greatest(coalesce(p_qty, 1), 1), 10));

  for v_msg in select * from jsonb_array_elements(v_msgs) loop
    select * into v_plano from public.route_plans
     where id = (v_msg -> 'mensagem' ->> 'plano_id')::uuid;

    -- Três jeitos de a mensagem estar velha, e todos terminam do mesmo modo:
    -- arquivar em silêncio. Devolvê-la ao worker seria pedir a ele que
    -- calculasse uma rota que ninguém pediu mais.
    --   · o plano sumiu (ficha apagada, pessoa removida);
    --   · o plano já não espera cálculo (ficou pronto ou falhou);
    --   · a pessoa pediu a rota DE NOVO, e esta é a mensagem da tentativa
    --     anterior. Sem esta terceira checagem, remontar a rota faria o OSRM
    --     calcular duas vezes o mesmo dia.
    if v_plano.id is null
       or v_plano.status <> 'enfileirada'::app.route_status
       or v_plano.tentativa is distinct from (v_msg -> 'mensagem' ->> 'tentativa')::int then
      perform public.esteira_fila_concluir('rotas_jobs',
        (v_msg ->> 'msg_id')::bigint, v_msg -> 'mensagem' ->> 'chave');
      continue;
    end if;

    v_max := least(greatest(coalesce((v_msg -> 'mensagem' ->> 'max_paradas')::int, 4), 1), 6);

    -- Reconferência 3 de 4, no instante em que o trabalho sai da fila.
    select coalesce(jsonb_agg(jsonb_build_object(
             'task_id', a.task_id,
             'organization_id', a.organization_id,
             'organizacao', a.organizacao,
             'lat', a.lat, 'lng', a.lng,
             'precisao', a.precisao,
             'raio_m', a.raio_m,
             'quando', a.due_at) order by a.due_at, a.organizacao), '[]'::jsonb)
      into v_paradas
      from (select * from app.rota_alvos(v_plano.plan_date, v_plano.assignee_id) x
             where x.elegivel
             order by x.due_at, x.organizacao
             limit v_max) a;

    if jsonb_array_length(v_paradas) = 0 then
      update public.route_plans
         set status = 'pronta'::app.route_status,
             total_seconds = 0, total_meters = 0, computed_at = now()
       where id = v_plano.id;
      perform public.esteira_fila_concluir('rotas_jobs',
        (v_msg ->> 'msg_id')::bigint, v_msg -> 'mensagem' ->> 'chave');
      continue;
    end if;

    v_saida := v_saida || jsonb_build_array(jsonb_build_object(
      'msg_id', (v_msg ->> 'msg_id')::bigint,
      'chave', v_msg -> 'mensagem' ->> 'chave',
      'plano_id', v_plano.id,
      'dia', v_plano.plan_date,
      'origem', jsonb_build_object('rotulo', v_plano.origin_label,
                                   'lat', v_plano.origin_lat,
                                   'lng', v_plano.origin_lng),
      'paradas', v_paradas));
  end loop;

  return v_saida;
end $$;

comment on function public.rota_proximas(int) is
  'Dreno de `rotas_jobs` para o worker: tira o pedido da fila e RECONFERE os alvos antes de entregar coordenada nenhuma ao OSRM. Plano cujo alvo inteiro caiu volta pronto com zero paradas, sem incomodar o OSRM.';

-- =====================================================================
-- L. A ORDEM VOLTA DO OSRM — reconfere parada a parada (4 de 4)
-- =====================================================================
create or replace function public.rota_gravar_ordem(
  p_plano_id      uuid,
  p_paradas       jsonb,
  p_total_seconds int,
  p_total_meters  int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plano    public.route_plans%rowtype;
  v_item     jsonb;
  v_pos      smallint := 0;
  v_gravadas int := 0;
  v_caidas   jsonb := '[]'::jsonb;
  v_seg      int := 0;
  v_met      int := 0;
  v_ok       boolean;
  v_lat      double precision;
  v_lng      double precision;
  v_prec     app.geo_precision;
  v_raio     int;
begin
  select * into v_plano from public.route_plans where id = p_plano_id for update;
  if v_plano.id is null then
    raise exception 'Plano de rota % não existe', p_plano_id using errcode = '23503';
  end if;

  delete from public.route_stops where plan_id = p_plano_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_paradas, '[]'::jsonb)) loop
    -- A reconferência que fecha o ciclo. O OSRM levou segundos para
    -- responder; nesses segundos alguém pode ter mandado parar. Uma parada
    -- que deixou de ser elegível NÃO entra, ainda que o tempo dela tenha
    -- voltado calculado.
    select a.elegivel, a.lat, a.lng, a.precisao, a.raio_m
      into v_ok, v_lat, v_lng, v_prec, v_raio
      from app.rota_alvos(v_plano.plan_date, v_plano.assignee_id) a
     where a.task_id = (v_item ->> 'task_id')::uuid;

    if not coalesce(v_ok, false) then
      v_caidas := v_caidas || jsonb_build_array(v_item ->> 'task_id');
      continue;
    end if;

    v_pos := v_pos + 1;
    insert into public.route_stops (
      plan_id, position, task_id, organization_id, lat, lng,
      geo_precision, geo_radius_m, seconds_from_prev, meters_from_prev)
    select p_plano_id, v_pos, (v_item ->> 'task_id')::uuid, a.organization_id,
           v_lat, v_lng, v_prec, v_raio,
           greatest(coalesce((v_item ->> 'segundos_do_anterior')::int, 0), 0),
           greatest(coalesce((v_item ->> 'metros_do_anterior')::int, 0), 0)
      from app.rota_alvos(v_plano.plan_date, v_plano.assignee_id) a
     where a.task_id = (v_item ->> 'task_id')::uuid;

    v_gravadas := v_gravadas + 1;
    v_seg := v_seg + greatest(coalesce((v_item ->> 'segundos_do_anterior')::int, 0), 0);
    v_met := v_met + greatest(coalesce((v_item ->> 'metros_do_anterior')::int, 0), 0);
  end loop;

  update public.route_plans
     set status = 'pronta'::app.route_status,
         -- Totais recalculados a partir do que SOBROU: somar o total que o
         -- OSRM devolveu incluiria o trecho de uma parada descartada.
         total_seconds = v_seg,
         total_meters  = v_met,
         computed_at   = now(),
         failure_reason = case when jsonb_array_length(v_caidas) > 0
           then jsonb_array_length(v_caidas) ||
                ' parada(s) saíram entre o cálculo e a gravação (supressão ou ficha apagada).' end
   where id = p_plano_id;

  return jsonb_build_object('plano_id', p_plano_id, 'gravadas', v_gravadas,
                            'descartadas', v_caidas,
                            'total_segundos', v_seg, 'total_metros', v_met,
                            'total_do_osrm_segundos', p_total_seconds,
                            'total_do_osrm_metros', p_total_meters);
end $$;

comment on function public.rota_gravar_ordem(uuid, jsonb, int, int) is
  'Grava a ordem que o OSRM devolveu, reconferindo CADA parada antes de escrevê-la (RF-ROT-03; forma de 20260905000100). O total é recalculado a partir do que sobrou.';

create or replace function public.rota_falhar(p_plano_id uuid, p_motivo text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.route_plans
     set status = 'falhou'::app.route_status,
         failure_reason = left(coalesce(p_motivo, 'falha sem motivo informado'), 500),
         computed_at = now()
   where id = p_plano_id;
  return found;
end $$;

comment on function public.rota_falhar(uuid, text) is
  'Marca o plano como falho com o motivo por extenso. Rota que não saiu tem de dizer por quê — a tela mostra esse texto.';

-- =====================================================================
-- M. GEOCODIFICAÇÃO — o que perguntar, e o que fazer com a resposta
-- =====================================================================
-- `geo_pendentes` devolve PERGUNTAS, não fichas: é o que mantém o número de
-- requisições ao Nominatim na casa das dezenas em vez das centenas.
-- =====================================================================
create or replace function public.geo_pendentes(p_limite int default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.alvos desc, p.consulta), '[]'::jsonb)
  from (
    -- bairro + cidade: a pergunta que responde a maioria da base
    select trim(o.neighborhood) || ', ' || c.name || ', ' || c.state || ', Brasil' as consulta,
           'bairro'::text as escopo,
           c.id as city_id,
           trim(o.neighborhood) as neighborhood,
           count(*)::int as alvos
      from public.organizations o
      join public.cities c on c.id = o.city_id
     where o.deleted_at is null
       and o.lat is null
       and o.neighborhood is not null and trim(o.neighborhood) <> ''
       and not exists (
         select 1 from public.geo_places g
          where g.consulta_norm = lower(extensions.unaccent(
            trim(o.neighborhood) || ', ' || c.name || ', ' || c.state || ', Brasil')))
     group by 1, 2, 3, 4

    union all

    -- só cidade: responde, mas com precisão que NÃO entra no planejador
    -- (RF-ROT-01). Vale a pena mesmo assim: é o que separa "não sei onde
    -- fica" de "sei o município e não sei mais nada".
    select c.name || ', ' || c.state || ', Brasil',
           'cidade', c.id, null,
           count(*)::int
      from public.organizations o
      join public.cities c on c.id = o.city_id
     where o.deleted_at is null
       and o.lat is null
       and (o.neighborhood is null or trim(o.neighborhood) = '')
       and not exists (
         select 1 from public.geo_places g
          where g.consulta_norm = lower(extensions.unaccent(c.name || ', ' || c.state || ', Brasil')))
     group by 1, 2, 3, 4
    limit greatest(coalesce(p_limite, 50), 1)
  ) p
$$;

comment on function public.geo_pendentes(int) is
  'As perguntas de geocodificação que faltam (RF-ROT-01). Uma pergunta por bairro, não por ficha: é o que cabe na política de 1 req/s do Nominatim.';

create or replace function public.geo_gravar(
  p_consulta        text,
  p_escopo          text,
  p_city_id         int,
  p_neighborhood    text,
  p_encontrado      boolean,
  p_lat             double precision default null,
  p_lng             double precision default null,
  p_addresstype     text default null,
  p_osm_type        text default null,
  p_osm_id          bigint default null,
  p_osm_class       text default null,
  p_display_name    text default null,
  p_bbox            double precision[] default null,
  p_licenca         text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm     text := lower(extensions.unaccent(p_consulta));
  v_precisao app.geo_precision;
  v_raio     int;
  v_id       bigint;
  v_aplicadas int := 0;
begin
  if p_encontrado then
    -- A precisão sai do que o OSM RESPONDEU. Perguntar por um bairro e
    -- receber um município é o erro que só aparece aqui.
    -- Lista fechada, e o "else" é `incerta` — nunca o palpite mais otimista.
    -- Perguntar por Ponta Negra e receber uma praia cai aqui, e é para cair.
    v_precisao := case
      when p_addresstype in ('house_number', 'building', 'road', 'residential',
                             'amenity', 'shop', 'place_of_worship', 'commercial')
        then 'logradouro'::app.geo_precision
      when p_addresstype in ('suburb', 'neighbourhood', 'quarter', 'city_district', 'borough')
        then 'bairro'::app.geo_precision
      when p_addresstype in ('municipality', 'city', 'town', 'village', 'hamlet', 'administrative')
        then 'cidade'::app.geo_precision
      else 'incerta'::app.geo_precision
    end;

    -- Raio = meia-diagonal da caixa delimitadora, em metros, pelo PostGIS.
    -- bbox do Nominatim: [lat_min, lat_max, lon_min, lon_max].
    if p_bbox is not null and array_length(p_bbox, 1) = 4 then
      v_raio := ceil(extensions.st_distance(
        extensions.st_setsrid(extensions.st_makepoint(p_bbox[3], p_bbox[1]), 4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(p_bbox[4], p_bbox[2]), 4326)::extensions.geography) / 2.0)::int;
    end if;
  end if;

  insert into public.geo_places as g (
    consulta, consulta_norm, escopo, city_id, neighborhood, encontrado,
    lat, lng, precisao, raio_m, osm_type, osm_id, osm_class, osm_addresstype,
    display_name, licenca, buscado_em)
  values (
    p_consulta, v_norm, p_escopo::app.geo_precision, p_city_id, nullif(trim(coalesce(p_neighborhood, '')), ''),
    coalesce(p_encontrado, false),
    case when p_encontrado then p_lat end,
    case when p_encontrado then p_lng end,
    v_precisao, v_raio, p_osm_type, p_osm_id, p_osm_class, p_addresstype,
    p_display_name,
    coalesce(nullif(p_licenca, ''), 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright'),
    now())
  on conflict (consulta_norm) do update
     set escopo = excluded.escopo, city_id = excluded.city_id,
         neighborhood = excluded.neighborhood, encontrado = excluded.encontrado,
         lat = excluded.lat, lng = excluded.lng, precisao = excluded.precisao,
         raio_m = excluded.raio_m, osm_type = excluded.osm_type, osm_id = excluded.osm_id,
         osm_class = excluded.osm_class, osm_addresstype = excluded.osm_addresstype,
         display_name = excluded.display_name, licenca = excluded.licenca,
         buscado_em = excluded.buscado_em
  returning g.id into v_id;

  if p_encontrado then
    -- Aplica na ficha. Só COMPLETA o que está vazio: coordenada corrigida à
    -- mão (RF-ROT-01 fala em correção pelo check-in) não é sobrescrita por
    -- um centroide de bairro.
    update public.organizations o
       set lat = p_lat, lng = p_lng,
           geo_precision = v_precisao, geo_radius_m = v_raio,
           geo_place_id = v_id, geocoded_at = now()
     where o.lat is null
       and o.deleted_at is null
       and o.city_id = p_city_id
       and (
         (p_escopo = 'bairro' and lower(extensions.unaccent(trim(coalesce(o.neighborhood, ''))))
                                = lower(extensions.unaccent(trim(coalesce(p_neighborhood, '@')))))
         or
         (p_escopo = 'cidade' and (o.neighborhood is null or trim(o.neighborhood) = ''))
       );
    get diagnostics v_aplicadas = row_count;
  end if;

  return jsonb_build_object('id', v_id, 'precisao', v_precisao, 'raio_m', v_raio,
                            'aplicadas', v_aplicadas);
end $$;

comment on function public.geo_gravar(text,text,int,text,boolean,double precision,double precision,text,text,bigint,text,text,double precision[],text) is
  'Grava a resposta do Nominatim no cache e aplica nas fichas sem coordenada (RF-ROT-01). A precisão sai do `addresstype` que o OSM devolveu, e o raio da caixa delimitadora dele — a incerteza vira número.';

-- ---------------------------------------------------------------------
-- N. Segurança
--
-- `route_plans` e `route_stops`: a pessoa vê a própria rota; gestor e admin
-- veem as de todos. Escrita, só pelas RPC acima (nenhum insert direto da
-- tela). `geo_places` é catálogo: todo autenticado lê, ninguém escreve pela
-- API — quem escreve é o worker, por `geo_gravar`.
-- ---------------------------------------------------------------------
alter table public.geo_places  enable row level security;
alter table public.route_plans enable row level security;
alter table public.route_stops enable row level security;

drop policy if exists geo_places_select on public.geo_places;
create policy geo_places_select on public.geo_places for select to authenticated using (true);

drop policy if exists route_plans_select on public.route_plans;
create policy route_plans_select on public.route_plans for select to authenticated
  using ((select app.sees_all()) or assignee_id = (select auth.uid()));

drop policy if exists route_stops_select on public.route_stops;
create policy route_stops_select on public.route_stops for select to authenticated
  using (exists (select 1 from public.route_plans p
                  where p.id = route_stops.plan_id
                    and ((select app.sees_all()) or p.assignee_id = (select auth.uid()))));

-- A função de gatilho entra aqui pelo mesmo motivo das outras do schema `app`
-- (20260904000800, 20260904001700): o padrão de fábrica do Postgres é EXECUTE
-- para PUBLIC, e `anon` herda de PUBLIC. Sem esta linha, o teste 09 (varredura,
-- não lista) fica vermelho — foi assim que a falta apareceu.
revoke all on function app.organizations_geo_precision()                       from public, anon, authenticated;
revoke all on function app.rota_alvos(date, uuid)                              from public, anon, authenticated;
revoke all on function public.rota_do_dia(date, uuid)                          from public, anon;
revoke all on function public.rota_montar(date, uuid, int)                     from public, anon;
revoke all on function public.rota_proximas(int)                               from public, anon, authenticated;
revoke all on function public.rota_gravar_ordem(uuid, jsonb, int, int)         from public, anon, authenticated;
revoke all on function public.rota_falhar(uuid, text)                          from public, anon, authenticated;
revoke all on function public.geo_pendentes(int)                               from public, anon, authenticated;
revoke all on function public.geo_gravar(text,text,int,text,boolean,double precision,double precision,text,text,bigint,text,text,double precision[],text)
                                                                               from public, anon, authenticated;

grant execute on function app.rota_alvos(date, uuid)                      to service_role;
grant execute on function public.rota_do_dia(date, uuid)                  to authenticated, service_role;
grant execute on function public.rota_montar(date, uuid, int)             to authenticated, service_role;
grant execute on function public.rota_proximas(int)                       to service_role;
grant execute on function public.rota_gravar_ordem(uuid, jsonb, int, int) to service_role;
grant execute on function public.rota_falhar(uuid, text)                  to service_role;
grant execute on function public.geo_pendentes(int)                       to service_role;
grant execute on function public.geo_gravar(text,text,int,text,boolean,double precision,double precision,text,text,bigint,text,text,double precision[],text)
                                                                          to service_role;

grant select on public.geo_places, public.route_plans, public.route_stops to authenticated, service_role;
grant insert, update, delete on public.geo_places, public.route_plans, public.route_stops to service_role;

-- `worker_heartbeats` já aceita qualquer nome de worker; 'rotas' entra por lá
-- sem alteração de schema. A tela lê o pulso por `public.rota_do_dia`.

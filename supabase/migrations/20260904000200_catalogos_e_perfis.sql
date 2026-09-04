-- =====================================================================
-- KOMUNE CRM — v0.1 — D1 — Catálogos, time e controle de acesso ao login
-- (RF-ADM-01 SSO restrito + hook do JWT; RF-ADM-02 catálogos; RF-BAS-02 categorias;
--  R09 §E; PRD §5.3 motivos de perda). Todas as tabelas nascem com RLS habilitada;
-- as políticas ficam na migração 000500.
-- =====================================================================

-- ---------- time ----------
create table if not exists public.teams (
  id          serial primary key,
  name        text not null unique,
  created_at  timestamptz not null default now()
);
alter table public.teams enable row level security;
comment on table public.teams is 'Times comerciais (metas de time, RF-MET).';

-- Perfil 1:1 com auth.users. O papel aqui é a fonte da claim app_role do JWT.
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  full_name       text not null,
  role            app.user_role not null default 'leitura',
  team_id         int references public.teams (id) on delete set null,
  phone_e164      text,                                 -- para a Assistente de cobrança falar com a pessoa
  is_active       boolean not null default true,
  daily_digest_at time not null default '08:00',
  city_id         int,                                  -- cidade/carteira própria (sdr); FK após cities
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.profiles enable row level security;
create index if not exists profiles_team_idx on public.profiles (team_id);
comment on table public.profiles is 'Usuários internos do CRM (1:1 com auth.users); role alimenta a claim app_role.';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

-- Normaliza o telefone do perfil (mesma regra dos parceiros).
create or replace function app.profiles_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.phone_e164 := app.normalize_phone_br(new.phone_e164);
  return new;
end $$;
drop trigger if exists profiles_normalize on public.profiles;
create trigger profiles_normalize before insert or update of phone_e164 on public.profiles
  for each row execute function app.profiles_normalize();

-- ---------- quem pode entrar (SSO restrito, RF-ADM-01) ----------
-- allowed_users: lista nominal (e-mail -> papel). allowed_domains: domínio da empresa
-- com papel padrão. Quem não estiver em nenhuma das duas não consegue criar conta.
create table if not exists public.allowed_users (
  id          serial primary key,
  email       extensions.citext not null unique,
  role        app.user_role not null default 'leitura',
  note        text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.allowed_users enable row level security;
comment on table public.allowed_users is 'Lista nominal de e-mails autorizados a entrar no CRM e o papel de cada um (RF-ADM-01).';

create table if not exists public.allowed_domains (
  id            serial primary key,
  domain        extensions.citext not null unique,      -- ex.: komune.app.br
  default_role  app.user_role not null default 'leitura',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.allowed_domains enable row level security;
comment on table public.allowed_domains is 'Domínios de e-mail permitidos no SSO e o papel padrão de quem entra por eles.';

-- Trigger em auth.users: cria o profile com o papel autorizado ou bloqueia o cadastro.
-- Roda como supabase_auth_admin (dono de auth.users); security definer para escrever em public.
-- O RAISE aborta a transação do GoTrue => o usuário não é criado e o login falha.
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(coalesce(new.email, ''));
  v_role   app.user_role;
  v_name   text;
begin
  if v_email = '' then
    raise exception 'Cadastro sem e-mail não é permitido no CRM' using errcode = 'P0001';
  end if;

  -- Comparação por lower(): com search_path vazio o operador = do citext não é resolvido.
  select au.role into v_role
    from public.allowed_users au
   where lower(au.email::text) = v_email;

  if v_role is null then
    select ad.default_role into v_role
      from public.allowed_domains ad
     where ad.is_active
       and lower(ad.domain::text) = split_part(v_email, '@', 2);
  end if;

  if v_role is null then
    raise exception 'E-mail % não autorizado a acessar o KOMUNE CRM', v_email using errcode = 'P0001';
  end if;

  v_name := coalesce(
              nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
              nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
              split_part(v_email, '@', 1));

  insert into public.profiles (id, full_name, role)
  values (new.id, v_name, v_role)
  on conflict (id) do update set role = excluded.role, updated_at = now();

  return new;
end $$;
revoke all on function app.handle_new_auth_user() from public, anon, authenticated;
grant execute on function app.handle_new_auth_user() to supabase_auth_admin;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- Custom Access Token Hook (config.toml: [auth.hook.custom_access_token]):
-- injeta claims.app_metadata.app_role a partir de profiles.role. Usuário desativado
-- recebe erro 403 e não obtém token. Chamado pelo GoTrue como supabase_auth_admin.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims    jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_role      app.user_role;
  v_active    boolean;
  v_app_meta  jsonb;
begin
  select p.role, p.is_active into v_role, v_active
    from public.profiles p
   where p.id = (event ->> 'user_id')::uuid;

  -- Sem perfil no CRM não há token (RF-ADM-06 offboarding "no mesmo dia"): apagar o profile
  -- basta para tirar o acesso, mesmo que a linha em auth.users continue existindo.
  if not found then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Usuário sem perfil no KOMUNE CRM'));
  end if;

  if not v_active then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Usuário desativado no KOMUNE CRM'));
  end if;

  v_app_meta := coalesce(v_claims -> 'app_metadata', '{}'::jsonb)
                || jsonb_build_object('app_role', v_role::text);
  v_claims := jsonb_set(v_claims, '{app_metadata}', v_app_meta, true);

  return jsonb_set(event, '{claims}', v_claims, true);
end $$;
comment on function public.custom_access_token_hook(jsonb) is 'Hook do Supabase Auth: injeta app_metadata.app_role (profiles.role) no JWT; bloqueia usuário inativo e usuário sem perfil (403).';

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
-- Leitura de profiles pelo GoTrue (a função é definer, mas deixamos o grant explícito por clareza).
grant select on public.profiles to supabase_auth_admin;
drop policy if exists profiles_auth_admin_read on public.profiles;
create policy profiles_auth_admin_read on public.profiles
  for select to supabase_auth_admin using (true);

-- ---------- catálogos ----------
create table if not exists public.cities (
  id              serial primary key,
  name            text not null,
  state           char(2) not null,
  ibge_code       text,
  is_metro_natal  boolean not null default false,   -- Grande Natal (Natal, Parnamirim, S. G. do Amarante, Extremoz, Macaíba...)
  created_at      timestamptz not null default now(),
  unique (name, state)
);
alter table public.cities enable row level security;
comment on table public.cities is 'Cidades de atuação; is_metro_natal marca a Grande Natal (R09).';

alter table public.profiles
  drop constraint if exists profiles_city_id_fkey,
  add constraint profiles_city_id_fkey foreign key (city_id) references public.cities (id) on delete set null;
create index if not exists profiles_city_idx on public.profiles (city_id);

-- Taxonomia comercial da KOMUNE (16 categorias em 5 grupos + 3 de produtores, Apêndice F),
-- diferente da taxonomia do app (komune_category_key faz o mapeamento).
create table if not exists public.categories (
  id                   serial primary key,
  slug                 text not null unique,
  name                 text not null,
  "group"              text not null check ("group" in
                         ('alimentos_bebidas','infraestrutura','servicos','locais','recreacao','producao')),
  priority             smallint not null default 2 check (priority between 1 and 3),   -- P1/P2/P3 (R09 §E)
  position             int not null default 0,
  komune_category_key  text,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);
alter table public.categories enable row level security;
comment on table public.categories is 'Taxonomia comercial do CRM (Apêndice F); priority = onda P1..P3.';

-- Fontes de dados = registro das operações de tratamento (LGPD art. 37) + config do Radar.
create table if not exists public.sources (
  id                  serial primary key,
  slug                text not null unique,
  name                text not null,
  kind                app.source_kind not null,
  base_url            text,
  legal_basis         text not null default 'legitimo_interesse',   -- + dados manifestamente públicos (art. 7, §4)
  terms_notes         text,
  robots_ok           boolean,
  is_enabled          boolean not null default true,
  config              jsonb not null default '{}'::jsonb,           -- seletores, paginação, whitelist de campos
  rate_limit_seconds  numeric(5,2) not null default 3,              -- ≤ 1 req a cada N segundos (R03)
  created_at          timestamptz not null default now()
);
alter table public.sources enable row level security;
comment on table public.sources is 'Fontes/origens (RF-BAS-10): base legal, termos, robots e configuração do coletor.';

create table if not exists public.tags (
  id          serial primary key,
  name        text not null unique,
  color       text,
  created_at  timestamptz not null default now()
);
alter table public.tags enable row level security;

-- Feriados: nunca enviar em feriado (RF-CON-11) e cálculo de "D+1 útil".
create table if not exists public.holidays (
  id      serial primary key,
  date    date not null,
  name    text not null,
  scope   text not null default 'nacional' check (scope in ('nacional','estadual','municipal')),
  unique (date, scope)
);
alter table public.holidays enable row level security;
comment on table public.holidays is 'Feriados nacionais/estaduais (RN)/municipais (Natal); bloqueiam envios e contam no D+N útil.';

-- Motivos de perda (lista fechada, editável pelo gestor — PRD §5.3).
create table if not exists public.lost_reasons (
  id          serial primary key,
  slug        text not null unique,
  name        text not null,
  is_active   boolean not null default true,
  position    int not null default 0
);
alter table public.lost_reasons enable row level security;
comment on table public.lost_reasons is 'Motivos de perda (lista fechada, PRD §5.3). "Não respondeu" e "agora não" não são perda.';

-- ---------- dias úteis ----------
-- Próximo dia útil a partir de uma data (exclusive), pulando sábado, domingo e feriados
-- de qualquer escopo (o CRM atua só em Natal/RN). Usado no "Primeiro contato em D+1 útil".
create or replace function app.next_business_day(p_from date, p_days int default 1)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  d date := p_from;
  n int := 0;
begin
  while n < greatest(p_days, 1) loop
    d := d + 1;
    if extract(isodow from d) < 6
       and not exists (select 1 from public.holidays h where h.date = d) then
      n := n + 1;
    end if;
  end loop;
  return d;
end $$;
comment on function app.next_business_day(date, int) is 'Data do N-ésimo dia útil após p_from (pula fim de semana e feriados).';

grant execute on function app.next_business_day(date, int) to authenticated, service_role;
grant execute on function app.profiles_normalize() to authenticated, service_role;

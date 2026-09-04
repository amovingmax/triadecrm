-- =====================================================================
-- KOMUNE CRM — v0.1 — D1 — Fundamentos: extensões, fuso, schema privado,
-- tipos enumerados e funções utilitárias (RF-BAS-05, RF-BAS-14, RF-ADM-01).
-- Base: R05 §4 adaptado ao PRD (Apêndice D com as correções do R11).
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================

-- ---------- extensões ----------
-- pgmq, pg_net e postgis ficam para os dias em que forem usados (filas no D5/D6,
-- rotas no D7): criar extensão sem uso só aumenta a superfície e o tempo do reset.
create extension if not exists pgcrypto with schema extensions;   -- gen_random_uuid, digest (sha256)
create extension if not exists citext   with schema extensions;   -- e-mails sem diferenciar maiúsculas
create extension if not exists pg_trgm  with schema extensions;   -- similaridade de nomes (dedup por sugestão)
create extension if not exists unaccent with schema extensions;   -- nome sem acento para busca
create extension if not exists pg_cron;                           -- agendamentos (temperatura às 03:00, retenção)

-- Fuso único do produto (PRD §8 / CLAUDE.md): janelas, cadências, digests e relatórios.
-- Vale para novas sessões; a sessão desta migração continua em UTC até reconectar.
alter database postgres set timezone to 'America/Fortaleza';

-- ---------- schema privado ----------
-- `app` guarda tipos, funções e triggers internos. Não é exposto pela API
-- (config.toml: schemas = ["public", "graphql_public"]). `authenticated` precisa
-- de USAGE para que os tipos enum usados pelas tabelas públicas sejam legíveis
-- pelo PostgREST e para executar as funções chamadas pelas políticas de RLS.
create schema if not exists app;
revoke all on schema app from public;
revoke all on schema app from anon;
grant usage on schema app to authenticated, service_role;
comment on schema app is 'Funções, tipos e triggers internos do CRM (não exposto pela API).';

-- ---------- tipos enumerados (PRD Apêndice D, com correções do R11) ----------
-- create type não aceita "if not exists": o bloco captura duplicate_object.
do $$
begin
  create type app.org_kind as enum ('fornecedor','produtor','cerimonialista','espaco','empresa','outro');
exception when duplicate_object then null; end $$;

do $$
begin
  -- R11: acrescenta 'financeiro' (Dennis) e 'bot' (service role restrito por RLS).
  create type app.user_role as enum ('admin','gestor','sdr','embaixador','leitura','financeiro','bot');
exception when duplicate_object then null; end $$;

do $$
begin
  -- R11: 'cliente_ativo' para as etapas 3–6 do Funil 2 (PRD §5.6).
  create type app.temperature as enum ('frio','morno','quente','cliente','cliente_ativo');
exception when duplicate_object then null; end $$;

do $$
begin
  -- 'nurturing' = nutrição/dormente (PRD §5.3): não é perda.
  create type app.deal_status as enum ('open','won','lost','paused','nurturing');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.activity_type as enum ('call','visit','meeting','message','note','email','stage_change','system');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.task_status as enum ('todo','doing','done','cancelled');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.task_kind as enum ('call','visit','meeting','message','follow_up','other');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.channel as enum ('whatsapp','instagram','email','phone','presencial','other');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.msg_direction as enum ('in','out');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.msg_type as enum ('text','audio','image','video','document','template','interactive','reaction','system');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.msg_status as enum ('queued','sent','delivered','read','failed','received');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.consent_kind as enum ('contact_optin','contact_optout','data_use_authorized','photo_use_authorized',
                                        'data_use_revoked','access_request','erasure_request','erasure_done');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.prereg_status as enum ('pending','draft_created','link_sent','in_progress','completed',
                                         'published','rejected','expired');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.review_status as enum ('new','approved','rejected','merged','duplicate');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.source_kind as enum ('scrape','import','manual','api','referral');
exception when duplicate_object then null; end $$;

do $$
begin
  -- R11: 'doors_knocked' (1º contato enviado) e 'doors_opened' (respondeu) substituem 'first_contacts'.
  create type app.goal_metric as enum ('new_targets','doors_knocked','doors_opened','replies','meetings_booked',
                                       'meetings_done','visits_done','pre_registrations','published');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.goal_period as enum ('day','week','month');
exception when duplicate_object then null; end $$;

-- ---------- funções utilitárias ----------
-- Todas com search_path fixo (lint "function_search_path_mutable") e objetos
-- qualificados pelo schema.

-- Telefone brasileiro -> E.164 (+55DDDNÚMERO), regra RF-BAS-05:
--   1. só dígitos; 2. remove DDI 55 e o 0 de operadora; 3. sem DDD (8 ou 9 dígitos)
--   assume DDD 84; 4. celular antigo de 8 dígitos (começa em 6–9) ganha o 9;
--   5. fixo fica com 10 dígitos no total; 6. devolve NULL se não couber na regra.
create or replace function app.normalize_phone_br(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d = '' then
    return null;
  end if;

  -- DDI 55 (+55 84 ..., 0055 84 ...). Só quando sobra um número completo com DDD,
  -- para não confundir com o DDD 55 (RS) de um número já sem DDI.
  if left(d, 4) = '0055' and length(d) >= 14 then
    d := substr(d, 5);
  elsif left(d, 2) = '55' and length(d) >= 12 then
    d := substr(d, 3);
  end if;

  -- 0 de operadora / discagem nacional (0 84 99999 9999, 021 84 ...).
  if left(d, 1) = '0' and length(d) in (11, 12) then
    d := substr(d, 2);
  elsif left(d, 1) = '0' and length(d) in (13, 14) then   -- 0 + código de operadora (2 díg.) + DDD + número
    d := substr(d, 4);
  end if;

  -- Sem DDD: número local de Natal/Grande Natal (DDD 84).
  if length(d) in (8, 9) then
    d := '84' || d;
  end if;

  -- Celular antigo de 8 dígitos (6xxx-xxxx a 9xxx-xxxx) recebe o nono dígito.
  if length(d) = 10 and substr(d, 3, 1) between '6' and '9' then
    d := substr(d, 1, 2) || '9' || substr(d, 3);
  end if;

  -- Validação final: DDD sem zero, celular 11 dígitos começando em 9, fixo 10 dígitos começando em 2–5.
  if length(d) not in (10, 11) then
    return null;
  end if;
  if substr(d, 1, 1) = '0' or substr(d, 2, 1) = '0' then
    return null;
  end if;
  if length(d) = 11 and substr(d, 3, 1) <> '9' then
    return null;
  end if;
  if length(d) = 10 and substr(d, 3, 1) not between '2' and '5' then
    return null;
  end if;

  return '+55' || d;
end $$;
comment on function app.normalize_phone_br(text) is 'Telefone BR em qualquer formato -> E.164 (+55DDDNÚMERO); DDD 84 padrão; insere o 9 em celular antigo; NULL se inválido (RF-BAS-05).';

-- CNPJ: só dígitos, 14 posições. NULL quando não há 14 dígitos.
-- Observação: o CNPJ alfanumérico (Receita Federal, a partir de 07/2026) não é aceito
-- nesta versão — decisão registrada para revisão (ver CHANGELOG).
create or replace function app.normalize_cnpj(c text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when length(regexp_replace(coalesce(c, ''), '\D', '', 'g')) = 14
           then regexp_replace(c, '\D', '', 'g')
         end
$$;
comment on function app.normalize_cnpj(text) is 'CNPJ com 14 dígitos, sem máscara; NULL se não tiver 14 dígitos.';

-- Dígitos verificadores do CNPJ (módulo 11). Rejeita sequências repetidas (00000000000000 etc.).
create or replace function app.cnpj_is_valid(c text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := app.normalize_cnpj(c);
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int;
  dv1 int;
  dv2 int;
begin
  if d is null then
    return false;
  end if;
  if d ~ '^(\d)\1{13}$' then          -- todos os dígitos iguais
    return false;
  end if;

  s := 0;
  for i in 1..12 loop
    s := s + substr(d, i, 1)::int * w1[i];
  end loop;
  dv1 := s % 11;
  dv1 := case when dv1 < 2 then 0 else 11 - dv1 end;

  s := 0;
  for i in 1..13 loop
    s := s + substr(d, i, 1)::int * w2[i];
  end loop;
  dv2 := s % 11;
  dv2 := case when dv2 < 2 then 0 else 11 - dv2 end;

  return substr(d, 13, 1)::int = dv1 and substr(d, 14, 1)::int = dv2;
end $$;
comment on function app.cnpj_is_valid(text) is 'Valida os dígitos verificadores do CNPJ (módulo 11); rejeita sequências repetidas.';

-- @instagram: aceita URL (https://www.instagram.com/nome/?x=y), inclusive m./mobile., ou @nome;
-- devolve o handle minúsculo sem @, ou NULL se não bater com ^[a-z0-9._]{1,30}$.
--
-- Link de post, reel, story ou página de sistema NÃO é perfil: o primeiro segmento do caminho
-- ('p', 'reel', 'explore', 'accounts'...) seria gravado como handle, colidiria no índice único
-- organizations_instagram_uq (erro 23505 incompreensível para quem cadastra) e faria
-- find_org_matches apontar duas empresas sem relação como duplicata (RF-BAS-08). Esses
-- caminhos devolvem NULL — o Radar e as planilhas trazem exatamente esse tipo de link.
create or replace function app.normalize_instagram(h text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(trim(coalesce(h, '')));
  -- Rotas reservadas do Instagram (nenhuma é um perfil).
  v_reservadas constant text[] := array[
    'p','reel','reels','tv','stories','story','explore','accounts','direct','about','developer',
    'legal','privacy','terms','api','challenge','emails','session','oauth','graphql','ajax','static'];
begin
  if v = '' then
    return null;
  end if;
  v := regexp_replace(v, '^(https?://)?(www\.|m\.|mobile\.)?instagram\.com/', '');   -- URL -> caminho
  v := regexp_replace(v, '^@+', '');                                                -- @ inicial
  v := regexp_replace(v, '[/?#].*$', '');                                           -- barra final, query, âncora
  if v !~ '^[a-z0-9._]{1,30}$' then
    return null;
  end if;
  if v = any (v_reservadas) then
    return null;
  end if;
  return v;
end $$;
comment on function app.normalize_instagram(text) is '@instagram a partir de URL (inclusive m.instagram.com) ou @; minúsculo, sem @; NULL para link de post/reel/rota reservada ou handle inválido.';

-- Domínio do site (sem protocolo, credenciais, www, caminho ou porta), minúsculo.
-- Valida que o resultado é mesmo um hostname: planilhas trazem "sem site", "não tem", "-",
-- "só instagram", e esse lixo viraria chave de dedup 0,90 (RF-BAS-08) casando todo mundo
-- com todo mundo. Qualquer esquema é aceito (http, https, ftp...); ponto final de FQDN cai.
create or replace function app.website_domain(u text)
returns text
language sql
immutable
set search_path = ''
as $$
  with limpo as (
    select regexp_replace(                                        -- porta
             regexp_replace(                                      -- caminho, query, âncora
               regexp_replace(                                    -- usuário:senha@
                 regexp_replace(                                  -- esquema e www
                   lower(trim(coalesce(u, ''))),
                   '^([a-z][a-z0-9+.-]*:)?//', ''),
                 '^[^@/]+@', ''),
               '[/?#].*$', ''),
             ':\d+$', '') as d
  )
  select case
           when regexp_replace(d, '\.$', '') ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
             then regexp_replace(regexp_replace(d, '\.$', ''), '^www\.', '')
         end
    from limpo
$$;
comment on function app.website_domain(text) is 'Domínio do site (hostname validado) sem esquema/credenciais/www/caminho/porta; NULL para texto livre. Usado na dedup (RF-BAS-08).';

-- Hosts compartilhados: o domínio deles NÃO identifica a empresa (todo mundo tem um
-- instagram.com/... ou um wa.me/... no campo "site"), então não entram na dedup por domínio.
create or replace function app.is_shared_web_host(d text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(trim(d)), '') = any (array[
    'instagram.com','facebook.com','fb.com','m.facebook.com','linktr.ee','linkr.bio','beacons.ai',
    'wa.me','api.whatsapp.com','whatsapp.com','bit.ly','tinyurl.com','linkedin.com','youtube.com',
    'youtu.be','tiktok.com','x.com','twitter.com','sites.google.com','google.com','business.site',
    'wixsite.com','blogspot.com','wordpress.com','gmail.com','hotmail.com','outlook.com','yahoo.com'])
$$;
comment on function app.is_shared_web_host(text) is 'true para hosts compartilhados (redes sociais, encurtadores, construtores de site) que não servem como chave de dedup por domínio.';

-- Nome para busca e dedup: sem acento, minúsculo, espaços colapsados.
-- STABLE (não IMMUTABLE) porque unaccent depende do dicionário; por isso o valor é
-- materializado por trigger em organizations.search_name, e o índice trigram é na coluna.
create or replace function app.search_name(n text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(lower(extensions.unaccent(trim(regexp_replace(coalesce(n, ''), '\s+', ' ', 'g')))), '')
$$;
comment on function app.search_name(text) is 'lower(unaccent(nome)) com espaços colapsados, para trigram e prefixo.';

-- updated_at automático.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Papel do usuário, lido do JWT (claim injetada pelo Custom Access Token Hook a partir de
-- profiles.role — nunca de user_metadata). Sem claim válida => 'leitura' (menor privilégio).
create or replace function app.role()
returns app.user_role
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := auth.jwt() -> 'app_metadata' ->> 'app_role';
begin
  if v is null or v not in ('admin','gestor','sdr','embaixador','leitura','financeiro','bot') then
    return 'leitura'::app.user_role;
  end if;
  return v::app.user_role;
end $$;
comment on function app.role() is 'Papel do usuário autenticado (claim app_metadata.app_role do JWT); fallback leitura.';

-- Telefone mascarado para listagens (RF-BAS-14): mantém +55, DDD e os 2 últimos dígitos.
--   +5584999999912 -> '+55 84 •••••-••12'; +558432064212 -> '+55 84 ••••-••12'.
create or replace function app.mask_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p is null then null
           when p ~ '^\+55\d{11}$' then '+55 ' || substr(p, 4, 2) || ' •••••-••' || right(p, 2)
           when p ~ '^\+55\d{10}$' then '+55 ' || substr(p, 4, 2) || ' ••••-••' || right(p, 2)
           else '••••••'
         end
$$;
comment on function app.mask_phone(text) is 'Máscara de telefone E.164 para papéis sdr/embaixador (RF-BAS-14).';

-- SHA-256 em hexadecimal (lista de supressão por hash, RF-ADM-04).
create or replace function app.sha256_hex(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when t is null then null
              else encode(extensions.digest(convert_to(t, 'UTF8'), 'sha256'), 'hex') end
$$;
comment on function app.sha256_hex(text) is 'SHA-256 (hex) de um texto; usado na suppression_list.';

-- Quem pode executar: usuários autenticados (as políticas de RLS chamam app.role()) e o service role.
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;
grant execute on all functions in schema app to authenticated, service_role;

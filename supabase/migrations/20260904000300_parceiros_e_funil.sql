-- =====================================================================
-- KOMUNE CRM — v0.1 — D1 — Base de parceiros e funis
-- (RF-BAS-01..06, RF-BAS-08, RF-FUN-01..08; PRD §5.3–§5.5; Apêndice D; R05 §4 adaptado).
-- Decisões que desviam do R05 estão comentadas no ponto em que ocorrem.
-- =====================================================================

-- ---------- organizações (parceiros) ----------
create table if not exists public.organizations (
  id                          uuid primary key default gen_random_uuid(),
  kind                        app.org_kind not null default 'fornecedor',
  name                        text not null check (length(trim(name)) > 0),
  legal_name                  text,
  cnpj                        text,                       -- 14 dígitos (trigger normaliza e valida)
  phone_e164                  text,                       -- WhatsApp comercial principal (trigger normaliza)
  email                       extensions.citext,
  instagram_handle            text,                       -- sem @, minúsculo (trigger normaliza)
  website                     text,
  website_domain              text,                       -- derivado (trigger)
  place_id                    text,                       -- id do Google Places (RF-BAS-08: chave 0,98)
  city_id                     int references public.cities (id) on delete set null,
  neighborhood                text,
  address                     text,
  lat                         double precision,
  lng                         double precision,
  price_range                 text,                       -- ex.: '$$', 'R$ 2–5 mil'
  rating                      numeric(3,2) check (rating is null or rating between 0 and 5),
  reviews_count               int check (reviews_count is null or reviews_count >= 0),
  -- rating/reviews_count: apenas sinal numérico interno para pontuação (RF-RAD-04, Apêndice E SCR-02);
  -- nunca exibir como avaliação nem copiar textos de avaliações.
  description                 text,
  source_id                   int not null references public.sources (id),  -- origem obrigatória (RF-BAS-10)
  source_url                  text,
  collected_at                timestamptz not null default now(),
  collector                   text,                       -- quem/qual coletor trouxe o registro (proveniência)
  owner_id                    uuid references public.profiles (id) on delete set null,
  temperature                 app.temperature not null default 'frio',  -- espelho da maior temperatura dos negócios abertos
  temperature_override        smallint check (temperature_override between 1 and 3),   -- 1 frio · 2 morno · 3 quente
  temperature_override_reason text,
  temperature_override_by     uuid references public.profiles (id) on delete set null,
  temperature_override_at     timestamptz,
  is_natural_person           boolean not null default false,   -- MEI/autônomo: tratado como dado pessoal (RF-BAS-04)
  vip                         boolean not null default false,
  komune_supplier_id          uuid,                       -- id na plataforma Komune após pré-cadastro
  custom                      jsonb not null default '{}'::jsonb,
  search_name                 text,                       -- lower(unaccent(name)) — trigger
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,
  anonymized_at               timestamptz,
  constraint organizations_override_needs_reason
    check (temperature_override is null or length(trim(coalesce(temperature_override_reason, ''))) > 0),
  -- ADR-09: CPF, dados bancários e Pix não entram no CRM. Não há coluna para eles, mas `custom`
  -- recebe campos criados no ato da importação (RF-BAS-07) a partir do cabeçalho da planilha —
  -- e as planilhas do comercial têm essas colunas. O banco recusa em vez de confiar no app.
  constraint organizations_custom_sem_dados_sensiveis
    check (not (custom ?| array['cpf','CPF','pix','PIX','chave_pix','conta','conta_bancaria','agencia','banco','cartao']))
);
alter table public.organizations enable row level security;
comment on table public.organizations is 'Parceiro (fornecedor, produtor, cerimonialista, espaço, empresa) — entidade central (RF-BAS-01).';
comment on column public.organizations.custom is 'Campos personalizados criados na importação (RF-BAS-07); CPF/Pix/dados bancários são recusados por constraint (ADR-09).';
comment on column public.organizations.collected_at is 'Quando o dado foi coletado (proveniência obrigatória, RF-BAS-10).';
comment on column public.organizations.collector is 'Quem (pessoa) ou o quê (coletor) trouxe o registro; "sistema" quando não há sessão (RF-BAS-10).';
comment on column public.organizations.source_url is 'URL pública de onde o dado veio, quando existe (proveniência, RF-BAS-10 e §10.2).';
comment on column public.organizations.temperature_override is 'Override manual por estrelas (1 frio, 2 morno, 3 quente); vence a regra calculada e exige motivo (PRD §5.6).';
comment on column public.organizations.rating is 'Nota pública copiada apenas como número para pontuação interna; nunca exibir como avaliação.';
comment on column public.organizations.place_id is 'Identificador do Google Places (o único campo do Places que pode ser guardado sem prazo); 2ª chave de dedup (RF-BAS-08, 0,98).';
-- Sem photo_urls do R05: o Apêndice E (SCR-02) proíbe persistir fotos/URLs de imagem sem autorização.

-- Garante a coluna em bases criadas antes desta versão (a migração é reaplicável).
alter table public.organizations add column if not exists place_id text;

-- Chaves de dedup (RF-BAS-08): índices únicos parciais; registros soft-deleted não bloqueiam.
create unique index if not exists organizations_cnpj_uq      on public.organizations (cnpj)             where cnpj is not null and deleted_at is null;
create unique index if not exists organizations_phone_uq     on public.organizations (phone_e164)       where phone_e164 is not null and deleted_at is null;
create unique index if not exists organizations_instagram_uq on public.organizations (instagram_handle) where instagram_handle is not null and deleted_at is null;
create unique index if not exists organizations_place_uq     on public.organizations (place_id)         where place_id is not null and deleted_at is null;
create index if not exists organizations_domain_idx    on public.organizations (website_domain) where website_domain is not null;
create index if not exists organizations_search_trgm   on public.organizations using gin (search_name extensions.gin_trgm_ops);
create index if not exists organizations_city_kind_idx on public.organizations (city_id, kind) where deleted_at is null;
create index if not exists organizations_owner_idx     on public.organizations (owner_id);
create index if not exists organizations_source_idx    on public.organizations (source_id);
create index if not exists organizations_temp_idx      on public.organizations (temperature) where deleted_at is null;
create index if not exists organizations_override_by_idx on public.organizations (temperature_override_by);

-- Normalização por trigger (RF-BAS-05). Valor inválido em CNPJ/telefone/@ é rejeitado com
-- mensagem clara (a importação gera arquivo de erros; a UI valida antes com zod).
create or replace function app.organizations_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v text;
begin
  -- CNPJ
  if nullif(trim(coalesce(new.cnpj, '')), '') is null then
    new.cnpj := null;
  else
    v := app.normalize_cnpj(new.cnpj);
    if v is null or not app.cnpj_is_valid(v) then
      raise exception 'CNPJ inválido: %', new.cnpj using errcode = '23514';
    end if;
    new.cnpj := v;
  end if;

  -- Telefone principal
  if nullif(trim(coalesce(new.phone_e164, '')), '') is null then
    new.phone_e164 := null;
  else
    v := app.normalize_phone_br(new.phone_e164);
    if v is null then
      raise exception 'Telefone inválido: %', new.phone_e164 using errcode = '23514';
    end if;
    new.phone_e164 := v;
  end if;

  -- @instagram
  if nullif(trim(coalesce(new.instagram_handle, '')), '') is null then
    new.instagram_handle := null;
  else
    v := app.normalize_instagram(new.instagram_handle);
    if v is null then
      raise exception '@instagram inválido: %', new.instagram_handle using errcode = '23514';
    end if;
    new.instagram_handle := v;
  end if;

  new.name           := trim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.website_domain := app.website_domain(new.website);
  new.search_name    := app.search_name(new.name);
  new.neighborhood   := nullif(trim(coalesce(new.neighborhood, '')), '');
  -- place_id do Google Places: identificador opaco, guardado como veio (só sem espaços em branco).
  new.place_id       := nullif(trim(coalesce(new.place_id, '')), '');
  -- Proveniência obrigatória (RF-BAS-10): quem coletou. Sem valor informado, fica quem está
  -- logado; sem sessão (worker, cron, seed, importação), 'sistema'.
  new.collector      := coalesce(nullif(trim(coalesce(new.collector, '')), ''),
                                 (select pr.full_name from public.profiles pr where pr.id = auth.uid()),
                                 'sistema');

  -- Override manual exige motivo (constraint) e registra quem/quando.
  if tg_op = 'INSERT' or new.temperature_override is distinct from old.temperature_override then
    if new.temperature_override is null then
      new.temperature_override_reason := null;
      new.temperature_override_by := null;
      new.temperature_override_at := null;
    else
      new.temperature_override_by := coalesce(auth.uid(), new.temperature_override_by);
      new.temperature_override_at := now();
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;
drop trigger if exists organizations_normalize on public.organizations;
create trigger organizations_normalize before insert or update on public.organizations
  for each row execute function app.organizations_normalize();
-- RF-BAS-10 exige origem COM collected_at e collector: com o preenchimento acima, a coluna
-- pode ser obrigatória (importação e Radar não gravam mais sem proveniência).
alter table public.organizations alter column collector set not null;

-- Categorias (várias por organização, uma primária — RF-BAS-02).
create table if not exists public.organization_categories (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  category_id     int  not null references public.categories (id),
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  primary key (organization_id, category_id)
);
alter table public.organization_categories enable row level security;
comment on table public.organization_categories is 'Categorias do parceiro (RF-BAS-02); uma única primária por organização (índice parcial).';
create unique index if not exists organization_categories_primary_uq
  on public.organization_categories (organization_id) where is_primary;
create index if not exists organization_categories_category_idx on public.organization_categories (category_id);

create table if not exists public.organization_tags (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tag_id          int  not null references public.tags (id) on delete cascade,
  primary key (organization_id, tag_id)
);
alter table public.organization_tags enable row level security;
comment on table public.organization_tags is 'Etiquetas livres do parceiro (RF-BAS-01): fundador, VIP, indicação, lista-semente.';
create index if not exists organization_tags_tag_idx on public.organization_tags (tag_id);

-- ---------- pessoas (contatos) ----------
create table if not exists public.contacts (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null check (length(trim(full_name)) > 0),
  first_name         text,
  phone_e164         text,                                   -- WhatsApp pessoal (trigger normaliza)
  email              extensions.citext,
  instagram_handle   text,
  role_title         text,                                   -- dono, sócio, comercial, gerente
  is_decision_maker  boolean not null default false,
  preferred_channel  app.channel not null default 'whatsapp',
  do_not_contact     boolean not null default false,         -- mantido pelo trigger de consent_events
  source_id          int references public.sources (id),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  anonymized_at      timestamptz
);
alter table public.contacts enable row level security;
comment on table public.contacts is 'Pessoas ligadas a organizações (RF-BAS-03); do_not_contact vem dos eventos de consentimento.';
create unique index if not exists contacts_phone_uq on public.contacts (phone_e164) where phone_e164 is not null and deleted_at is null;
create index if not exists contacts_email_idx  on public.contacts (email) where email is not null;
create index if not exists contacts_source_idx on public.contacts (source_id);

create or replace function app.contacts_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v text;
begin
  if nullif(trim(coalesce(new.phone_e164, '')), '') is null then
    new.phone_e164 := null;
  else
    v := app.normalize_phone_br(new.phone_e164);
    if v is null then
      raise exception 'Telefone inválido: %', new.phone_e164 using errcode = '23514';
    end if;
    new.phone_e164 := v;
  end if;

  if nullif(trim(coalesce(new.instagram_handle, '')), '') is null then
    new.instagram_handle := null;
  else
    v := app.normalize_instagram(new.instagram_handle);
    if v is null then
      raise exception '@instagram inválido: %', new.instagram_handle using errcode = '23514';
    end if;
    new.instagram_handle := v;
  end if;

  new.full_name  := trim(regexp_replace(new.full_name, '\s+', ' ', 'g'));
  new.first_name := coalesce(nullif(trim(coalesce(new.first_name, '')), ''), split_part(new.full_name, ' ', 1));
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists contacts_normalize on public.contacts;
create trigger contacts_normalize before insert or update on public.contacts
  for each row execute function app.contacts_normalize();

create table if not exists public.organization_contacts (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id      uuid not null references public.contacts (id) on delete cascade,
  role            text,                                      -- papel nesta organização
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  primary key (organization_id, contact_id)
);
alter table public.organization_contacts enable row level security;
comment on table public.organization_contacts is 'Vínculo pessoa × organização (RF-BAS-03) com o papel dela ali; uma única pessoa primária por organização.';
create index if not exists organization_contacts_contact_idx on public.organization_contacts (contact_id);
create unique index if not exists organization_contacts_primary_uq
  on public.organization_contacts (organization_id) where is_primary;

-- ---------- funis ----------
create table if not exists public.pipelines (
  id          serial primary key,
  slug        text not null unique check (slug in ('fornecedor','ativacao','produtor')),
  name        text not null,
  kind        app.org_kind not null,                          -- tipo de organização que o funil atende
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.pipelines enable row level security;
comment on table public.pipelines is 'Funis: fornecedor (captação), ativacao (sucesso), produtor (produtor/cerimonialista) — PRD §5.';

create table if not exists public.stages (
  id               serial primary key,
  pipeline_id      int not null references public.pipelines (id) on delete cascade,
  slug             text not null,
  name             text not null,
  position         int not null,
  temperature      app.temperature not null default 'frio',  -- temperatura derivada da etapa (PRD §5.3/5.5)
  is_won           boolean not null default false,
  is_lost          boolean not null default false,
  is_dormant       boolean not null default false,           -- Nutrição/dormente: status 'nurturing' (PRD §5.3/§5.6)
  is_optout        boolean not null default false,           -- Opt-out por regra: perda SEM motivo da lista fechada
  is_terminal      boolean not null default false,           -- publicado, perdido, opt-out: não recebe cadência
  sla_hours        int,                                      -- máximo sem atividade antes de "parado"
  required_fields  jsonb not null default '[]'::jsonb,       -- campos obrigatórios para entrar (RF-FUN-04)
  automations      jsonb not null default '[]'::jsonb,       -- "ao entrar aqui: ..." (RF-FUN-05)
  created_at       timestamptz not null default now(),
  unique (pipeline_id, slug),
  unique (pipeline_id, position)
);
alter table public.stages enable row level security;
-- Garante as colunas em bases criadas antes desta versão (a migração é reaplicável).
alter table public.stages add column if not exists is_dormant boolean not null default false;
alter table public.stages add column if not exists is_optout  boolean not null default false;
comment on table public.stages is 'Etapas por funil com temperatura, SLA, campos obrigatórios e automações (RF-FUN-04/05).';
comment on column public.stages.required_fields is 'Campos exigidos para ENTRAR na etapa (RF-FUN-04), como [{"field","label",...}].';
comment on column public.stages.automations is '"Ao entrar aqui: ..." (RF-FUN-05) descrito como dados; o motor que executa chega no D5–D7.';
comment on column public.stages.sla_hours is 'Horas sem atividade até o negócio contar como parado (semáforo do kanban).';
comment on column public.stages.is_dormant is 'Etapa de nutrição/dormente: entrar nela põe o negócio em status ''nurturing'' e a temperatura em frio (PRD §5.6).';
comment on column public.stages.is_optout is 'Etapa de opt-out (perda por regra, PRD §5.3): é perda, mas NÃO exige motivo da lista fechada — o motivo é o próprio opt-out.';

-- ---------- negócios ----------
create table if not exists public.deals (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  pipeline_id          int not null references public.pipelines (id),
  stage_id             int not null references public.stages (id),
  status               app.deal_status not null default 'open',
  owner_id             uuid references public.profiles (id) on delete set null,
  primary_contact_id   uuid references public.contacts (id) on delete set null,
  source_id            int references public.sources (id),
  tier                 text check (tier in ('A+','A','B','C')),
  score                int check (score is null or score between 0 and 100),
  score_breakdown      jsonb,
  entered_stage_at     timestamptz not null default now(),
  last_activity_at     timestamptz,
  last_intent          text,                                 -- última intenção classificada (Apêndice C, minúsculo)
  last_intent_at       timestamptz,
  next_action          text,
  next_action_at       timestamptz,
  lost_reason_id       int references public.lost_reasons (id),
  paused_until         timestamptz,
  won_at               timestamptz,
  lost_at              timestamptz,
  ai_summary           text,
  ai_next_action       jsonb,
  temperature          app.temperature not null default 'frio',  -- calculada (migração 000400)
  stage_change_reason  text,                                 -- motivo da última mudança de etapa (copiado ao histórico)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (organization_id, pipeline_id),                     -- um negócio por organização por funil (RF-FUN-01)
  constraint deals_paused_needs_date  check (status <> 'paused' or paused_until is not null)      -- "pausado com data"
);
alter table public.deals enable row level security;
-- "Perdido exige motivo" (RF-FUN-04) NÃO pode ser um CHECK estático: o PRD §5.3 separa
-- "Perdido" (motivo da lista fechada) de "Opt-out" (perda por regra, imediata, sem motivo
-- escolhido por ninguém). Como um CHECK não enxerga stages, a regra passou para
-- app.deals_before_write(), que exige lost_reason_id só nas etapas de perda que não são
-- opt-out. A linha abaixo remove a constraint de bases criadas antes desta versão.
alter table public.deals drop constraint if exists deals_lost_needs_reason;
comment on table public.deals is 'Negócio = organização × funil; etapa, responsável, próxima ação, tier/score, temperatura calculada.';
comment on column public.deals.tier is 'Prioridade comercial do alvo (A+, A, B, C); A+ = indicação/contato pessoal (RF-BAS-15).';
comment on column public.deals.score is 'Pontuação 0–100 do Radar (RF-RAD-04); score_breakdown guarda o cálculo item a item.';
comment on column public.deals.score_breakdown is 'Como o score foi formado (jsonb), para a revisão humana entender a nota.';
comment on column public.deals.ai_next_action is 'Sugestão de próxima ação vinda da IA (jsonb), sempre revisada por gente (ADR-05).';
comment on column public.deals.last_intent is 'Última intenção classificada (Apêndice C, minúsculo); alimenta a regra de temperatura.';
create index if not exists deals_board_idx        on public.deals (pipeline_id, stage_id, owner_id) where status = 'open';
create index if not exists deals_next_action_idx  on public.deals (next_action_at) where status = 'open';
create index if not exists deals_stuck_idx        on public.deals (entered_stage_at) where status = 'open';
create index if not exists deals_org_idx          on public.deals (organization_id);
create index if not exists deals_owner_idx        on public.deals (owner_id);
create index if not exists deals_stage_idx        on public.deals (stage_id);
create index if not exists deals_contact_idx      on public.deals (primary_contact_id);
create index if not exists deals_source_idx       on public.deals (source_id);
create index if not exists deals_lost_reason_idx  on public.deals (lost_reason_id);

-- Histórico de etapas (RF-FUN-08): base do tempo médio por etapa. changed_by null = automação/IA.
create table if not exists public.deal_stage_history (
  id             bigserial primary key,
  deal_id        uuid not null references public.deals (id) on delete cascade,
  from_stage_id  int references public.stages (id),
  to_stage_id    int not null references public.stages (id),
  changed_by     uuid references public.profiles (id) on delete set null,
  reason         text,
  changed_at     timestamptz not null default now()
);
alter table public.deal_stage_history enable row level security;
comment on table public.deal_stage_history is 'Histórico de mudanças de etapa (RF-FUN-08): base do tempo médio por etapa; changed_by nulo = automação/sistema.';
create index if not exists deal_stage_history_deal_idx on public.deal_stage_history (deal_id, changed_at desc);
create index if not exists deal_stage_history_from_idx on public.deal_stage_history (from_stage_id);
create index if not exists deal_stage_history_to_idx   on public.deal_stage_history (to_stage_id);
create index if not exists deal_stage_history_by_idx   on public.deal_stage_history (changed_by);

-- BEFORE: coerência etapa × funil, reset de entered_stage_at, status derivado da etapa
-- (ganho / perda / nutrição), motivo de perda quando a etapa exige e carimbos won_at/lost_at.
-- (A temperatura é calculada por outro trigger, migração 000400.)
create or replace function app.deals_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s record;
begin
  select st.pipeline_id, st.is_won, st.is_lost, st.is_dormant, st.is_optout, st.name
    into s from public.stages st where st.id = new.stage_id;
  if s.pipeline_id is null then
    raise exception 'Etapa % não existe', new.stage_id using errcode = '23503';
  end if;
  if s.pipeline_id <> new.pipeline_id then
    raise exception 'A etapa % não pertence ao funil %', new.stage_id, new.pipeline_id using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    new.entered_stage_at := now();
    -- O motivo vale só se vier no mesmo comando da mudança de etapa (não herda o anterior).
    if new.stage_change_reason is not distinct from old.stage_change_reason then
      new.stage_change_reason := null;
    end if;
    if s.is_won then
      new.status := 'won';
    elsif s.is_lost then
      new.status := 'lost';
    elsif s.is_dormant then
      new.status := 'nurturing';                -- Nutrição/dormente é etapa E status (PRD §5.6: Frio)
    elsif old.status in ('won','lost','nurturing') then
      new.status := 'open';                     -- reabertura/saída da nutrição (PRD §5.3)
    end if;
  elsif tg_op = 'INSERT' then
    if s.is_won then new.status := 'won';
    elsif s.is_lost then new.status := 'lost';
    elsif s.is_dormant then new.status := 'nurturing';
    end if;
  end if;

  -- RF-FUN-04: perda exige motivo da lista fechada — exceto no opt-out, que é perda por regra
  -- (guardrail: imediato e nunca reabre) e não tem motivo a escolher. Sair da etapa de opt-out
  -- ou de perda limpa o motivo para não sobrar lixo no relatório de motivos de perda.
  if new.status = 'lost' and not coalesce(s.is_optout, false) and new.lost_reason_id is null then
    raise exception 'A etapa "%" exige um motivo de perda (RF-FUN-04)', s.name using errcode = '23514';
  end if;
  if new.status <> 'lost' or coalesce(s.is_optout, false) then
    new.lost_reason_id := null;
  end if;

  if new.status = 'won'  and new.won_at  is null then new.won_at  := now(); end if;
  if new.status = 'lost' and new.lost_at is null then new.lost_at := now(); end if;
  if new.status <> 'won'  then new.won_at  := null; end if;
  if new.status <> 'lost' then new.lost_at := null; end if;
  if new.status <> 'paused' then new.paused_until := null; end if;

  new.updated_at := now();
  return new;
end $$;
drop trigger if exists deals_before_write on public.deals;
create trigger deals_before_write before insert or update on public.deals
  for each row execute function app.deals_before_write();

-- AFTER: grava o histórico. Security definer porque o histórico é mantido pelo sistema
-- (sdr/embaixador não têm política de insert em deal_stage_history).
create or replace function app.deals_track_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    insert into public.deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by, reason)
    values (new.id,
            case when tg_op = 'UPDATE' then old.stage_id end,
            new.stage_id,
            auth.uid(),
            coalesce(new.stage_change_reason, current_setting('app.stage_reason', true)));
  end if;
  return new;
end $$;
drop trigger if exists deals_track_stage on public.deals;
create trigger deals_track_stage after insert or update of stage_id on public.deals
  for each row execute function app.deals_track_stage();

-- ---------- timeline e tarefas ----------
create table if not exists public.activities (
  id               uuid primary key default gen_random_uuid(),
  type             app.activity_type not null,
  organization_id  uuid references public.organizations (id) on delete cascade,
  contact_id       uuid references public.contacts (id) on delete set null,
  deal_id          uuid references public.deals (id) on delete set null,
  user_id          uuid references public.profiles (id) on delete set null,   -- null = sistema/IA
  author_kind      text not null default 'human' check (author_kind in ('human','bot_fixed','bot_ai','system')),  -- RF-BAS-06
  occurred_at      timestamptz not null default now(),
  duration_min     int,
  outcome          text,                       -- 'atendeu','nao_atendeu','interessado','sem_interesse','reagendou'
  body             text,
  channel          app.channel,
  message_id       uuid,                       -- FK para messages quando a tabela nascer (D5)
  metadata         jsonb not null default '{}'::jsonb,   -- {"first_contact": true, "door_opened": true, ...}
  created_at       timestamptz not null default now()
);
alter table public.activities enable row level security;
comment on table public.activities is 'Timeline unificada (RF-BAS-06); metadata.first_contact/door_opened alimentam as metas.';
comment on column public.activities.metadata is 'Marcações usadas pelas metas e relatórios: {"first_contact": true, "door_opened": true, ...}.';
comment on column public.activities.author_kind is 'Autor da linha do tempo: pessoa (human), robô fixo, robô de IA ou sistema (RF-BAS-06).';
create index if not exists activities_org_idx      on public.activities (organization_id, occurred_at desc);
create index if not exists activities_user_day_idx on public.activities (user_id, occurred_at desc);
create index if not exists activities_deal_idx     on public.activities (deal_id);
create index if not exists activities_contact_idx  on public.activities (contact_id);

-- Toda atividade atualiza deals.last_activity_at (recência para a regra de temperatura).
create or replace function app.activities_touch_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deal_id is not null and new.type <> 'system' then
    update public.deals d
       set last_activity_at = greatest(coalesce(d.last_activity_at, new.occurred_at), new.occurred_at)
     where d.id = new.deal_id;
  end if;
  return new;
end $$;
drop trigger if exists activities_touch_deal on public.activities;
create trigger activities_touch_deal after insert on public.activities
  for each row execute function app.activities_touch_deal();

create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  kind             app.task_kind not null default 'follow_up',
  status           app.task_status not null default 'todo',
  priority         smallint not null default 2 check (priority between 1 and 3),   -- 1 alta · 2 normal · 3 baixa
  due_at           timestamptz,
  assignee_id      uuid references public.profiles (id) on delete set null,
  organization_id  uuid references public.organizations (id) on delete cascade,
  deal_id          uuid references public.deals (id) on delete cascade,
  contact_id       uuid references public.contacts (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  origin           text not null default 'manual' check (origin in ('manual','cadence','ai','system')),
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.tasks enable row level security;
comment on table public.tasks is 'Tarefas da fila do dia (ligar, visitar, responder): origem manual, cadência, IA ou sistema.';
create index if not exists tasks_assignee_due_idx on public.tasks (assignee_id, due_at) where status in ('todo','doing');
create index if not exists tasks_org_idx      on public.tasks (organization_id);
create index if not exists tasks_deal_idx     on public.tasks (deal_id);
create index if not exists tasks_contact_idx  on public.tasks (contact_id);
create index if not exists tasks_creator_idx  on public.tasks (created_by);

create or replace function app.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function app.tasks_before_write();

-- ---------- modelos de mensagem e áudios (mínimo para a seed do Apêndice C / R08 §2) ----------
create table if not exists public.audio_assets (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,                    -- ex.: aeb-aud-1
  title         text not null,
  segment       text check (segment in ('AEB','INF','PRE','ESP','CER','FOR','GEN')),
  context       text,                                    -- quando usar (após "sim", pós-reunião...)
  storage_path  text,                                    -- bucket privado 'audios' (ogg/opus); null até gravar
  duration_sec  int,
  transcript    text,                                    -- roteiro/transcrição (R08 §2.x AUD)
  version       int not null default 1,
  recorded_by   uuid references public.profiles (id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.audio_assets enable row level security;
comment on table public.audio_assets is 'Biblioteca de áudios reais da Heloísa (ADR-09: nada de voz clonada).';
create index if not exists audio_assets_recorded_by_idx on public.audio_assets (recorded_by);

create table if not exists public.message_templates (
  id                  serial primary key,
  template_code       text not null unique,              -- SEG-TIPO-VAR, ex.: AEB-ABR-A, GEN-SYS-OPTOUT (R08 §0)
  name                text not null,
  channel             app.channel not null default 'whatsapp',
  category            text not null default 'service'
                        check (category in ('marketing','utility','authentication','service','internal')),
  segment             text check (segment in ('AEB','INF','PRE','ESP','CER','FOR','GEN')),
  kind                text,                              -- abertura, audio, objecao, cta, followup, sistema...
  variant             text check (variant in ('A','B')), -- teste A/B da abertura (RF-ADM-02)
  meta_template_name  text,                              -- nome aprovado na Meta (category ≠ service/internal)
  meta_status         text check (meta_status is null or meta_status in ('approved','pending','rejected')),
  language            text not null default 'pt_BR',
  body                text not null,                     -- com {{1}}, {{2}}... ou {nome}
  variables           jsonb not null default '[]'::jsonb,
  audio_asset_id      uuid references public.audio_assets (id) on delete set null,
  version             int not null default 1,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.message_templates enable row level security;
comment on table public.message_templates is 'Textos por segmento/variante (R08 §2, Apêndice C); template_code é a chave de negócio.';
create index if not exists message_templates_audio_idx on public.message_templates (audio_asset_id);

drop trigger if exists audio_assets_set_updated_at on public.audio_assets;
create trigger audio_assets_set_updated_at before update on public.audio_assets
  for each row execute function app.set_updated_at();
drop trigger if exists message_templates_set_updated_at on public.message_templates;
create trigger message_templates_set_updated_at before update on public.message_templates
  for each row execute function app.set_updated_at();

-- ---------- dedup: candidatos a duplicata (RF-BAS-08) ----------
-- Entrada (jsonb, tudo opcional): {cnpj, place_id, instagram_handle, phone_e164, website,
-- website_domain, name, city_id, neighborhood, category_id}. A ordem de confiança é a do
-- RF-BAS-08, devolvida como número para a revisão humana e a importação (atualizar/mesclar/pular)
-- poderem ordenar:
--   CNPJ 0,99 → place_id 0,98 → @instagram 0,97 → celular 0,95 → fixo + mesmo bairro 0,90
--   → domínio do site 0,90 → nome por trigram (≥ p_threshold, padrão 0,85) como SUGESTÃO.
-- Nada aqui funde registros: a decisão é sempre humana (RF-BAS-09).
--
-- Notas de implementação:
--   * celular × fixo: em E.164 br, celular tem 9 dígitos após o DDD (+55 + 2 + 9 = 14 caracteres)
--     e fixo tem 8 (13 caracteres). O fixo é fraco sozinho (recepção compartilhada, prédio
--     comercial), por isso só casa com o mesmo bairro, como manda o RF-BAS-08.
--   * domínio: hosts compartilhados (instagram.com, wa.me, linktr.ee...) ficam de fora
--     (app.is_shared_web_host), senão todo mundo que pôs a rede social no campo "site" vira
--     duplicata de todo mundo.
--   * nome: o limiar do PRD é 0,85 (o valor anterior, 0,6, enchia a revisão de falsos positivos —
--     em Natal 'Espaço Villa Verde' × 'Espaço Villa Vera' dá 0,75). Para não repetir o problema,
--     a sugestão por nome exige a mesma cidade quando city_id é informado e, quando bairro ou
--     categoria vêm junto, exige coincidir em um dos dois. p_threshold permite afrouxar em
--     telas de revisão (ex.: 0,7 na esteira do Radar com cidade + categoria iguais).
--   * "celular em mais de 3 registros → revisão" (RF-BAS-08) é regra da esteira
--     source_record → supplier_candidate (ADR-08), implementada com o Radar no D3/D4.
--
-- SECURITY DEFINER com checagem explícita de papel: a dedup precisa enxergar TODA a base
-- (inclusive organizações fora da carteira de quem captura), senão sdr e embaixador — que são
-- justamente quem faz captura em campo, revisão do Radar e importação — receberiam zero
-- candidatos e cadastrariam duplicatas. A função devolve só id, confiança e motivo: nenhuma
-- PII (nome, telefone, @) sai daqui; quem pode abrir a ficha continua sendo decidido pela RLS.
-- Papéis sem escrita (leitura/financeiro) e anon não executam.
-- Assinatura antiga (só jsonb) sai de cena: com o parâmetro opcional as duas conviveriam e
-- toda chamada de um argumento ficaria ambígua.
drop function if exists app.find_org_matches(jsonb);
create or replace function app.find_org_matches(n jsonb, p_threshold numeric default 0.85)
returns table (organization_id uuid, confidence numeric, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_jwt text := nullif(current_setting('request.jwt.claims', true), '');
  v_thr numeric := least(greatest(coalesce(p_threshold, 0.85), 0.1), 1.0);
begin
  -- Chamada vinda da API (sempre traz claims): exige papel que escreve na base de parceiros.
  -- Sem claims = service_role/workers/pg_cron/migração: passa.
  if v_jwt is not null and not app.can_write() then
    raise exception 'Papel % não consulta candidatos a duplicata', app.role() using errcode = '42501';
  end if;

  return query
  with k as (
    select app.normalize_cnpj(n ->> 'cnpj')                                    as cnpj,
           nullif(trim(coalesce(n ->> 'place_id', '')), '')                    as place_id,
           app.normalize_instagram(n ->> 'instagram_handle')                   as ig,
           app.normalize_phone_br(n ->> 'phone_e164')                          as phone,
           app.website_domain(coalesce(n ->> 'website_domain', n ->> 'website')) as domain,
           app.search_name(n ->> 'name')                                       as sname,
           nullif(n ->> 'city_id', '')::int                                    as city_id,
           app.search_name(n ->> 'neighborhood')                               as bairro,
           nullif(n ->> 'category_id', '')::int                                as category_id
  ),
  candidatos as (
    select o.id, 0.99::numeric as confidence, 'cnpj'::text as reason
      from public.organizations o, k
     where k.cnpj is not null and o.cnpj = k.cnpj and o.deleted_at is null
    union all
    select o.id, 0.98::numeric, 'place_id'
      from public.organizations o, k
     where k.place_id is not null and o.place_id = k.place_id and o.deleted_at is null
    union all
    select o.id, 0.97::numeric, 'instagram'
      from public.organizations o, k
     where k.ig is not null and o.instagram_handle = k.ig and o.deleted_at is null
    union all
    select o.id, 0.95::numeric, 'phone'
      from public.organizations o, k
     where k.phone is not null and length(k.phone) = 14              -- celular
       and o.phone_e164 = k.phone and o.deleted_at is null
    union all
    select o.id, 0.90::numeric, 'landline_neighborhood'
      from public.organizations o, k
     where k.phone is not null and length(k.phone) = 13              -- fixo
       and o.phone_e164 = k.phone and o.deleted_at is null
       and k.bairro is not null and app.search_name(o.neighborhood) = k.bairro
    union all
    select o.id, 0.90::numeric, 'domain'
      from public.organizations o, k
     where k.domain is not null and not app.is_shared_web_host(k.domain)
       and o.website_domain = k.domain and o.deleted_at is null
    union all
    select o.id, round(extensions.similarity(o.search_name, k.sname)::numeric, 3), 'name_trgm'
      from public.organizations o, k
     where k.sname is not null and o.deleted_at is null
       and extensions.similarity(o.search_name, k.sname) >= v_thr
       and (k.city_id is null or o.city_id = k.city_id)
       and (
             (k.bairro is null and k.category_id is null)
          or (k.bairro is not null and app.search_name(o.neighborhood) = k.bairro)
          or (k.category_id is not null and exists (
                select 1 from public.organization_categories oc
                 where oc.organization_id = o.id and oc.category_id = k.category_id))
           )
  )
  select c.id, c.confidence, c.reason
    from candidatos c
   order by c.confidence desc, c.reason, c.id;
end $$;
comment on function app.find_org_matches(jsonb, numeric) is
  'Candidatos a duplicata na ordem de confiança do RF-BAS-08: CNPJ 0,99 · place_id 0,98 · @instagram 0,97 · celular 0,95 · fixo+bairro 0,90 · domínio 0,90 · nome por trigram ≥ 0,85 (sugestão). Definer sem PII; só papéis que escrevem (admin/gestor/sdr/embaixador).';

grant execute on all functions in schema app to authenticated, service_role;

-- =====================================================================
-- KOMUNE CRM — v0.1 — D1 — Consentimento e supressão (RF-ADM-04, guardrail de opt-out),
-- auditoria (RF-ADM-03) e regra de temperatura calculada (PRD §5.6, Apêndice C).
-- =====================================================================

-- ---------- consentimento (append-only) ----------
create table if not exists public.consent_events (
  id                   uuid primary key default gen_random_uuid(),
  kind                 app.consent_kind not null,
  organization_id      uuid references public.organizations (id) on delete cascade,
  contact_id           uuid references public.contacts (id) on delete cascade,
  channel              app.channel,
  evidence_message_id  uuid,                      -- FK para messages quando a tabela nascer (D5)
  evidence_text        text,                      -- texto literal ("autorizo", "sair"...)
  evidence_url         text,                      -- print/arquivo no Storage privado
  occurred_at          timestamptz not null default now(),
  recorded_by          uuid references public.profiles (id) on delete set null,   -- null = automático (palavra-chave)
  created_at           timestamptz not null default now(),
  constraint consent_events_subject check (organization_id is not null or contact_id is not null)
);
alter table public.consent_events enable row level security;
comment on table public.consent_events is 'Opt-in/opt-out, autorização de dados/fotos, revogação, pedidos do titular. Append-only.';
create index if not exists consent_events_contact_idx on public.consent_events (contact_id, created_at desc);
create index if not exists consent_events_org_idx     on public.consent_events (organization_id, created_at desc);
create index if not exists consent_events_by_idx      on public.consent_events (recorded_by);

-- Ninguém altera nem apaga um evento de consentimento (nem pelo service role).
create or replace function app.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Tabela % é append-only: % não permitido', tg_table_name, tg_op using errcode = '42501';
end $$;
drop trigger if exists consent_events_append_only on public.consent_events;
create trigger consent_events_append_only before update or delete on public.consent_events
  for each row execute function app.forbid_change();

-- ---------- lista de supressão (hash) ----------
create table if not exists public.suppression_list (
  id               bigserial primary key,
  hash             text not null,                       -- sha256 do telefone E.164 / CNPJ (14 díg.) / @instagram
  kind             text not null check (kind in ('phone','cnpj','instagram')),
  reason           text,
  channel          app.channel,
  source_event_id  uuid references public.consent_events (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (hash, kind)
);
alter table public.suppression_list enable row level security;
comment on table public.suppression_list is 'Supressão permanente por hash (RF-ADM-04); consultada em todo envio e ingestão.';
create index if not exists suppression_list_event_idx on public.suppression_list (source_event_id);
create index if not exists suppression_list_by_idx    on public.suppression_list (created_by);

-- Está suprimido? Recebe valores brutos e normaliza antes de hashear.
create or replace function app.is_suppressed(p_phone text default null, p_cnpj text default null, p_instagram text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.suppression_list s
     where (p_phone     is not null and s.kind = 'phone'     and s.hash = app.sha256_hex(app.normalize_phone_br(p_phone)))
        or (p_cnpj      is not null and s.kind = 'cnpj'      and s.hash = app.sha256_hex(app.normalize_cnpj(p_cnpj)))
        or (p_instagram is not null and s.kind = 'instagram' and s.hash = app.sha256_hex(app.normalize_instagram(p_instagram)))
  )
$$;
comment on function app.is_suppressed(text, text, text) is 'true se telefone, CNPJ ou @ (normalizados) estiverem na suppression_list.';

-- Insere um hash na lista (idempotente).
create or replace function app.suppress(p_kind text, p_value text, p_reason text, p_channel app.channel, p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := case p_kind
              when 'phone'     then app.normalize_phone_br(p_value)
              when 'cnpj'      then app.normalize_cnpj(p_value)
              when 'instagram' then app.normalize_instagram(p_value)
            end;
begin
  if v is null then
    return;
  end if;
  insert into public.suppression_list (hash, kind, reason, channel, source_event_id, created_by)
  values (app.sha256_hex(v), p_kind, p_reason, p_channel, p_event_id, auth.uid())
  on conflict (hash, kind) do nothing;
end $$;

-- organizations.do_not_contact: espelho do opt-out no nível da organização.
alter table public.organizations add column if not exists do_not_contact boolean not null default false;
comment on column public.organizations.do_not_contact is 'Opt-out/eliminação registrado em consent_events; bloqueia qualquer envio.';
create index if not exists organizations_dnc_idx on public.organizations (id) where do_not_contact;

-- Aplica o evento: opt-out/eliminação => do_not_contact nas pessoas e organizações envolvidas
-- + hashes na suppression_list + negócios abertos movidos para a etapa de opt-out do funil.
-- Opt-in explícito só limpa a flag se o telefone não estiver suprimido (opt-out "nunca reabre"
-- automaticamente; reversão é ação manual do admin).
--
-- O funil precisa mostrar o opt-out (PRD §5.3): sem isso o cartão continuava em Contatado/Em
-- conversa, entrava na fila do dia e no needs_attention de alguém que não pode mais falar com
-- ele. A etapa é marcada com stages.is_optout, então é perda SEM motivo da lista fechada
-- (RF-FUN-04 vale só para "Perdido") e is_terminal garante que não recebe cadência.
-- O Funil 2 (ativação) não tem etapa de opt-out: lá o negócio é de um cliente já publicado e a
-- saída é tratada por churn; do_not_contact + suppression_list já bloqueiam qualquer envio.
create or replace function app.consent_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suppress boolean := new.kind in ('contact_optout','erasure_request','erasure_done');
  v_erasure  boolean := new.kind in ('erasure_request','erasure_done');
  v_reason   text := new.kind::text;
  c record;
  o record;
begin
  if v_suppress then
    -- pessoa
    if new.contact_id is not null then
      select * into c from public.contacts where id = new.contact_id;
      if found then
        update public.contacts set do_not_contact = true where id = c.id and not do_not_contact;
        perform app.suppress('phone', c.phone_e164, v_reason, new.channel, new.id);
        perform app.suppress('instagram', c.instagram_handle, v_reason, new.channel, new.id);
      end if;
    end if;

    -- organizações: a do evento + as da pessoa
    for o in
      select org.* from public.organizations org
       where org.id = new.organization_id
          or (new.contact_id is not null and org.id in
                (select oc.organization_id from public.organization_contacts oc where oc.contact_id = new.contact_id))
    loop
      update public.organizations set do_not_contact = true where id = o.id and not do_not_contact;
      perform app.suppress('phone', o.phone_e164, v_reason, new.channel, new.id);
      perform app.suppress('instagram', o.instagram_handle, v_reason, new.channel, new.id);
      if v_erasure then
        perform app.suppress('cnpj', o.cnpj, v_reason, new.channel, new.id);
      end if;

      -- Negócios ainda em andamento vão para a etapa de opt-out do próprio funil.
      update public.deals d
         set stage_id = st.id,
             stage_change_reason = 'Opt-out registrado (' || v_reason || ')'
        from public.stages st
       where d.organization_id = o.id
         and d.status in ('open','paused','nurturing')
         and st.pipeline_id = d.pipeline_id
         and st.is_optout
         and d.stage_id <> st.id;
    end loop;

  elsif new.kind = 'contact_optin' then
    if new.contact_id is not null then
      update public.contacts ct set do_not_contact = false
       where ct.id = new.contact_id and ct.do_not_contact
         and not app.is_suppressed(ct.phone_e164, null, ct.instagram_handle);
    end if;
    if new.organization_id is not null then
      update public.organizations org set do_not_contact = false
       where org.id = new.organization_id and org.do_not_contact
         and not app.is_suppressed(org.phone_e164, org.cnpj, org.instagram_handle);
    end if;
  end if;

  return new;
end $$;
drop trigger if exists consent_apply on public.consent_events;
create trigger consent_apply after insert on public.consent_events
  for each row execute function app.consent_apply();

-- recorded_by = quem está logado, sempre: um evento de consentimento é prova (LGPD art. 8º),
-- então o autor não pode ser informado pelo cliente. Só chamadas sem JWT (service_role,
-- workers, pg_cron, seed) podem gravar outro valor ou deixar null (= automático por palavra-chave).
create or replace function app.consent_events_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.recorded_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists consent_events_before_insert on public.consent_events;
create trigger consent_events_before_insert before insert on public.consent_events
  for each row execute function app.consent_events_before_insert();

-- ---------- auditoria (RF-ADM-03) ----------
create table if not exists public.audit_log (
  id          bigserial primary key,
  actor_id    uuid,                          -- auth.uid() ou null (service role / cron)
  actor_role  text,
  action      text not null,                 -- INSERT | UPDATE | DELETE
  table_name  text not null,
  row_id      text not null,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
alter table public.audit_log enable row level security;
comment on table public.audit_log is 'Quem alterou o quê (trigger app.audit); retenção 12 meses (RF-ADM-03).';
create index if not exists audit_log_row_idx   on public.audit_log (table_name, row_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);

create or replace function app.audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_uid uuid  := auth.uid();
  -- "Quem alterou o quê" (RF-ADM-03) só faz sentido se automação não se disfarçar de gente:
  -- app.role() devolve 'leitura' (menor privilégio, pensado para a RLS) sempre que não há claim,
  -- então worker, pg_cron e seed ficavam auditados como o papel que, por definição, não escreve.
  --   pessoa logada  -> o papel do JWT (admin, gestor, sdr, embaixador, leitura, financeiro)
  --   service_role   -> 'bot'     (RF-ADM-01: automações do CRM)
  --   sem JWT algum  -> 'sistema' (pg_cron, seed, migração, psql)
  v_role text := case
                   when v_uid is not null then app.role()::text
                   when auth.jwt() ->> 'role' = 'service_role' then 'bot'
                   when nullif(current_setting('request.jwt.claims', true), '') is not null
                     then coalesce(auth.jwt() ->> 'role', 'sistema')
                   else 'sistema'
                 end;
begin
  -- Não registra update sem mudança real (só updated_at), para não inflar o log.
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (v_uid,
          v_role,
          tg_op,
          tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id', '?'),
          v_old,
          v_new);
  return coalesce(new, old);
end $$;

drop trigger if exists audit_organizations  on public.organizations;
drop trigger if exists audit_contacts       on public.contacts;
drop trigger if exists audit_deals          on public.deals;
drop trigger if exists audit_consent_events on public.consent_events;
drop trigger if exists audit_profiles       on public.profiles;
drop trigger if exists audit_allowed_users  on public.allowed_users;
create trigger audit_organizations  after insert or update or delete on public.organizations  for each row execute function app.audit();
create trigger audit_contacts       after insert or update or delete on public.contacts       for each row execute function app.audit();
create trigger audit_deals          after insert or update or delete on public.deals          for each row execute function app.audit();
create trigger audit_consent_events after insert                     on public.consent_events for each row execute function app.audit();
create trigger audit_profiles       after insert or update or delete on public.profiles       for each row execute function app.audit();
create trigger audit_allowed_users  after insert or update or delete on public.allowed_users  for each row execute function app.audit();

-- Acesso a dados pessoais: revelação de telefone, exportação, visualização em massa.
create table if not exists public.pii_access_log (
  id           bigserial primary key,
  actor_id     uuid not null,
  actor_role   text,
  action       text not null check (action in ('reveal_phone','export_csv','bulk_view','view_contact_phone')),
  entity_type  text,                         -- 'organization' | 'contact'
  entity_id    uuid,
  scope        jsonb,                        -- filtros/ids em exportações e visualizações em massa
  created_at   timestamptz not null default now()
);
alter table public.pii_access_log enable row level security;
comment on table public.pii_access_log is 'Revelações de telefone, exportações e visualizações em massa (RF-ADM-03, RF-BAS-14).';
create index if not exists pii_access_log_actor_idx  on public.pii_access_log (actor_id, created_at desc);
create index if not exists pii_access_log_entity_idx on public.pii_access_log (entity_type, entity_id);

-- ---------- regra de temperatura (PRD §5.6) ----------
alter table public.deals add column if not exists needs_attention boolean not null default false;
comment on column public.deals.needs_attention is 'Alerta de esfriamento: morno > 7 dias ou quente > 5 dias sem contato (PRD §5.6).';
create index if not exists deals_attention_idx on public.deals (owner_id) where needs_attention and status = 'open';

-- Regra pura (testável): devolve temperatura e flag de alerta.
--   Override manual (1 frio · 2 morno · 3 quente) vence tudo.
--   Frio: etapa fria (1–2), nutrição/dormente, perdido, pausado.
--   Morno: respondeu/em conversa sem interesse declarado, último contato ≤ 7 d;
--          > 7 d mantém morno com alerta; > 14 d vira frio.
--   Quente: interesse declarado ou etapas 5–8 (temperatura da etapa = quente), último contato ≤ 5 d;
--          > 5 d alerta vermelho; > 14 d desce a morno.
--   Cliente / Cliente ativo: derivados da etapa do Funil 2.
create or replace function app.compute_temperature(
  p_stage_temperature app.temperature,
  p_last_intent       text,
  p_last_activity_at  timestamptz,
  p_override          smallint,
  p_status            app.deal_status,
  out temperature     app.temperature,
  out needs_attention boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_days   numeric := case when p_last_activity_at is null then 0
                           else extract(epoch from (now() - p_last_activity_at)) / 86400 end;
  v_intent text := lower(coalesce(p_last_intent, ''));
  v_hot    boolean := v_intent in ('interessado','pediu_taxa','pediu_taxa_preco','pediu_ligacao','autoriza_pre_cadastro',
                                   'agendamento_aceito','contraproposta','reagendar','pergunta_contratual');
  v_warm   boolean := v_intent in ('me_chama_depois','manda_material','ja_uso_outro','ambiguo','so_emoji','quer_saber_mais',
                                   'nao_trabalho_com_comissao','quem_e_voce','desconfianca','e_robo');
begin
  needs_attention := false;

  if p_override is not null then
    temperature := (case p_override when 1 then 'frio' when 2 then 'morno' else 'quente' end)::app.temperature;
    return;
  end if;

  if p_status in ('lost','paused','nurturing') then
    temperature := 'frio';
    return;
  end if;

  if p_stage_temperature in ('cliente','cliente_ativo') then
    temperature := p_stage_temperature;
    return;
  end if;

  if p_stage_temperature = 'quente' or v_hot then
    if v_days > 14 then
      temperature := 'morno';
      needs_attention := true;
    elsif v_days > 5 then
      temperature := 'quente';
      needs_attention := true;
    else
      temperature := 'quente';
    end if;
    return;
  end if;

  if p_stage_temperature = 'morno' or v_warm then
    if v_days > 14 then
      temperature := 'frio';
    elsif v_days > 7 then
      temperature := 'morno';
      needs_attention := true;
    else
      temperature := 'morno';
    end if;
    return;
  end if;

  temperature := 'frio';
end $$;
comment on function app.compute_temperature(app.temperature, text, timestamptz, smallint, app.deal_status) is
  'Regra de temperatura do PRD §5.6 (etapa × intenção × recência × override × status).';

-- BEFORE em deals: recalcula a temperatura do negócio a cada escrita.
-- SECURITY DEFINER porque precisa ler organizations.temperature_override: sdr e embaixador não
-- têm política de SELECT na tabela base (RF-BAS-14), e como invoker a consulta voltaria vazia —
-- o override manual de 1–3 estrelas (PRD §5.6, "vence a regra") era silenciosamente ignorado
-- em toda escrita feita por esses papéis. Mesmo padrão de deals_sync_org_temperature.
create or replace function app.deals_apply_temperature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage_temp app.temperature;
  v_override   smallint;
  r record;
begin
  select s.temperature into v_stage_temp from public.stages s where s.id = new.stage_id;
  select o.temperature_override into v_override from public.organizations o where o.id = new.organization_id;
  select * into r from app.compute_temperature(v_stage_temp, new.last_intent, new.last_activity_at, v_override, new.status);
  new.temperature := r.temperature;
  new.needs_attention := r.needs_attention;
  return new;
end $$;
drop trigger if exists deals_apply_temperature on public.deals;
-- Nome com prefixo "zz" para rodar depois de deals_before_write (triggers BEFORE disparam em ordem alfabética).
drop trigger if exists zz_deals_apply_temperature on public.deals;
create trigger zz_deals_apply_temperature before insert or update on public.deals
  for each row execute function app.deals_apply_temperature();

-- AFTER em deals: organizations.temperature = maior temperatura entre os negócios não perdidos.
create or replace function app.deals_sync_org_temperature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := coalesce(new.organization_id, old.organization_id);
  v_temp app.temperature;
begin
  select d.temperature into v_temp
    from public.deals d
   where d.organization_id = v_org and d.status <> 'lost'
   order by d.temperature desc
   limit 1;
  update public.organizations o
     set temperature = coalesce(v_temp, 'frio')
   where o.id = v_org and o.temperature is distinct from coalesce(v_temp, 'frio');
  return null;
end $$;
drop trigger if exists deals_sync_org_temperature on public.deals;
-- Dispara em qualquer update (um "update of coluna" só dispara quando a coluna é citada no SET).
create trigger deals_sync_org_temperature after insert or update or delete on public.deals
  for each row execute function app.deals_sync_org_temperature();

-- Override manual na organização => recalcula os negócios abertos dela.
-- Quando não há negócio não-perdido (organização recém-importada, ainda sem triagem, ou "VIP"
-- que o Rafael quer reaquecer), a ficha ainda precisa refletir as estrelas: aí a temperatura da
-- organização vem direto da regra pura. O CASE literal era text e a coluna é app.temperature —
-- sem o cast, QUALQUER update de temperature_override nessas organizações abortava com 42804.
create or replace function app.organizations_override_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_temp app.temperature;
begin
  if new.temperature_override is distinct from old.temperature_override then
    update public.deals d set updated_at = now()
     where d.organization_id = new.id and d.status <> 'lost';
    if not found then
      select r.temperature into v_temp
        from app.compute_temperature(null::app.temperature, null, null,
                                     new.temperature_override, 'open'::app.deal_status) r;
      update public.organizations o
         set temperature = v_temp
       where o.id = new.id and o.temperature is distinct from v_temp;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists organizations_override_changed on public.organizations;
create trigger organizations_override_changed after update of temperature_override on public.organizations
  for each row execute function app.organizations_override_changed();

-- Recalcula todos os negócios abertos (esfriamento por recência). Chamada pelo pg_cron.
create or replace function app.recompute_temperatures()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  with calc as (
    select d.id,
           (app.compute_temperature(s.temperature, d.last_intent, d.last_activity_at, o.temperature_override, d.status)).*
      from public.deals d
      join public.stages s on s.id = d.stage_id
      join public.organizations o on o.id = d.organization_id
     where d.status = 'open'
  )
  update public.deals d
     set temperature = c.temperature,
         needs_attention = c.needs_attention
    from calc c
   where d.id = c.id
     and (d.temperature is distinct from c.temperature or d.needs_attention is distinct from c.needs_attention);
  get diagnostics n = row_count;
  return n;
end $$;
comment on function app.recompute_temperatures() is 'Recalcula temperatura/alerta de todos os negócios abertos; devolve quantos mudaram.';
revoke execute on function app.recompute_temperatures() from public, anon, authenticated;
grant execute on function app.recompute_temperatures() to service_role;

-- Agenda às 03:00 America/Fortaleza = 06:00 UTC (cron.timezone padrão do pg_cron é GMT).
-- cron.schedule(nome, ...) é idempotente: reagendar com o mesmo nome atualiza o job.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('recompute_temperatures', '0 6 * * *', $cron$select app.recompute_temperatures()$cron$);
  end if;
end $$;

grant execute on function app.is_suppressed(text, text, text) to authenticated, service_role;
grant execute on function app.suppress(text, text, text, app.channel, uuid) to service_role;
revoke execute on function app.suppress(text, text, text, app.channel, uuid) from public, anon, authenticated;
grant execute on function app.compute_temperature(app.temperature, text, timestamptz, smallint, app.deal_status) to authenticated, service_role;

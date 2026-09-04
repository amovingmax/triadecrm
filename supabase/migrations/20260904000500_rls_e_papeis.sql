-- =====================================================================
-- KOMUNE CRM — v0.1 — D1 — RLS por papel, views com telefone mascarado e grants
-- (RF-ADM-01 papéis; RF-BAS-14 máscara + log de revelação; R05 §7).
--
-- Princípios:
--   * Toda tabela tem RLS; nada é exposto a `anon`; `service_role` (Edge Functions/workers) passa por cima.
--   * O papel vem de app.role() (claim do JWT). Nas políticas, `(select ...)` faz o planner
--     avaliar uma vez por consulta (initplan) em vez de por linha.
--   * sdr/embaixador NÃO leem organizations/contacts na tabela base (RF-BAS-14): leem e editam
--     pelas views organizations_view/contacts_view (telefone mascarado; INSTEAD OF triggers) e
--     revelam o número por RPC com registro em pii_access_log. Motivo técnico: RLS não
--     consegue esconder uma coluna por claim, e um UPDATE/INSERT ... RETURNING exige
--     política de SELECT — por isso as views são a superfície completa desses papéis.
-- =====================================================================

-- ---------- privilégios de tabela para os papéis da API ----------
-- A RLS restringe as LINHAS; o privilégio de tabela precisa existir para a API chegar nela.
-- O CLI local (2.109) NÃO concede select/insert/update/delete a authenticated/service_role nas
-- tabelas criadas por migração (a ACL padrão do papel postgres em public fica só com Dxtm),
-- então concedemos explicitamente e ajustamos o padrão para as próximas migrações.
-- anon fica de fora de tudo. Os revokes pontuais (append-only, logs) vêm depois desta seção.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges for role postgres in schema public grant usage, select on sequences to authenticated, service_role;
-- Funções novas não nascem executáveis por PUBLIC (cada RPC concede explicitamente).
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema app    revoke execute on functions from public;

-- ---------- funções de apoio (STABLE; usadas nas políticas) ----------
create or replace function app.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select app.role() = 'admin'::app.user_role
$$;
create or replace function app.is_manager()
returns boolean language sql stable set search_path = '' as $$
  select app.role() in ('admin'::app.user_role, 'gestor'::app.user_role)
$$;
-- Quem escreve na base de parceiros (leitura/financeiro nunca escrevem).
create or replace function app.can_write()
returns boolean language sql stable set search_path = '' as $$
  select app.role() in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role, 'embaixador'::app.user_role)
$$;
-- Visibilidade total do funil/atividades (embaixador fica de fora).
create or replace function app.sees_all()
returns boolean language sql stable set search_path = '' as $$
  select app.role() in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role,
                        'leitura'::app.user_role, 'financeiro'::app.user_role)
$$;
-- Leitura direta da tabela base de organizations/contacts (telefone completo).
create or replace function app.reads_base_pii()
returns boolean language sql stable set search_path = '' as $$
  select app.role() in ('admin'::app.user_role, 'gestor'::app.user_role, 'leitura'::app.user_role, 'financeiro'::app.user_role)
$$;
-- Organização "minha" para o embaixador: dona da organização ou de um negócio dela.
-- Definer para consultar deals/organizations sem depender das políticas do chamador.
create or replace function app.org_is_mine(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations o where o.id = p_org and o.owner_id = auth.uid())
      or exists (select 1 from public.deals d where d.organization_id = p_org and d.owner_id = auth.uid())
$$;
-- Pode editar a organização: admin/gestor ou dono.
create or replace function app.org_is_editable(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_manager()
      or exists (select 1 from public.organizations o where o.id = p_org and o.owner_id = auth.uid())
$$;
-- Organização visível para o papel atual (view, RPC de busca e tabelas-filha compartilham a regra).
create or replace function app.org_is_visible(p_org uuid)
returns boolean language sql stable set search_path = '' as $$
  select app.sees_all() or (app.role() = 'embaixador'::app.user_role and app.org_is_mine(p_org))
$$;
-- Pessoa visível para o papel atual: mesma regra da contacts_view (embaixador só as pessoas
-- das organizações da carteira; pessoa ainda sem organização fica visível a quem vê tudo).
-- Definer porque sdr/embaixador não leem organization_contacts/organizations na base.
create or replace function app.contact_is_visible(p_contact uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.sees_all()
      or (app.role() = 'embaixador'::app.user_role
          and exists (select 1 from public.organization_contacts oc
                       where oc.contact_id = p_contact and app.org_is_mine(oc.organization_id)))
$$;

-- ---------- catálogos: leitura para autenticados, escrita admin/gestor ----------
do $$
declare
  t text;
begin
  foreach t in array array['teams','cities','categories','sources','tags','holidays','lost_reasons',
                           'pipelines','stages','message_templates','audio_assets']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app.is_manager()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select app.is_manager())) with check ((select app.is_manager()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app.is_manager()))', t || '_delete', t);
  end loop;
end $$;

-- ---------- profiles ----------
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.is_manager()));
create policy profiles_insert on public.profiles for insert to authenticated
  with check ((select app.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select app.is_admin()))
  with check (id = (select auth.uid()) or (select app.is_admin()));
create policy profiles_delete on public.profiles for delete to authenticated
  using ((select app.is_admin()));

-- Quem não é admin só mexe no próprio perfil e nunca em papel/ativo/time.
create or replace function app.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.is_admin() and auth.uid() is not null then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.team_id is distinct from old.team_id then
      raise exception 'Só admin altera papel, status ou time de um perfil' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function app.profiles_guard();

-- Diretório do time para todo autenticado (nome/papel do responsável nos cartões e filtros),
-- sem expor telefone nem horário do digest. Lacuna do PRD preenchida aqui.
create or replace view public.team_directory
with (security_barrier = true, security_invoker = false) as
  select p.id, p.full_name, p.role, p.team_id, p.city_id, p.is_active
    from public.profiles p;
alter view public.team_directory owner to postgres;
comment on view public.team_directory is 'Nomes e papéis do time para todo usuário autenticado (sem PII).';

-- ---------- allowed_users / allowed_domains: só admin ----------
do $$
declare
  t text;
begin
  foreach t in array array['allowed_users','allowed_domains']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select app.is_admin()))', t || '_admin_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app.is_admin()))', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()))', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app.is_admin()))', t || '_admin_delete', t);
  end loop;
end $$;

-- ---------- organizations (tabela base) ----------
drop policy if exists organizations_select on public.organizations;
drop policy if exists organizations_insert on public.organizations;
drop policy if exists organizations_update on public.organizations;
drop policy if exists organizations_delete on public.organizations;
-- admin/gestor veem tudo (inclusive soft-deleted, para restaurar); leitura/financeiro só ativos.
create policy organizations_select on public.organizations for select to authenticated
  using ((select app.is_manager()) or ((select app.reads_base_pii()) and deleted_at is null));
-- Escrita na BASE só para admin/gestor. sdr e embaixador escrevem pela organizations_view
-- (INSTEAD OF security definer), que é a superfície completa deles: sem isso, um UPDATE sem
-- WHERE (PATCH sem filtro na API) atingia todas as linhas próprias e permitia justamente o que
-- a view proíbe — soft delete, do_not_contact = false (reabrir contato suprimido), temperature,
-- anonymized_at, komune_supplier_id —, e o INSERT direto aceitava owner_id de terceiro.
create policy organizations_insert on public.organizations for insert to authenticated
  with check ((select app.is_manager()));
create policy organizations_update on public.organizations for update to authenticated
  using ((select app.is_manager()))
  with check ((select app.is_manager()));
create policy organizations_delete on public.organizations for delete to authenticated
  using ((select app.is_admin()));

-- ---------- contacts (tabela base) ----------
drop policy if exists contacts_select on public.contacts;
drop policy if exists contacts_insert on public.contacts;
drop policy if exists contacts_update on public.contacts;
drop policy if exists contacts_delete on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
  using ((select app.is_manager()) or ((select app.reads_base_pii()) and deleted_at is null));
-- Mesma regra de organizations: sdr/embaixador escrevem pela contacts_view (INSTEAD OF definer).
create policy contacts_insert on public.contacts for insert to authenticated
  with check ((select app.is_manager()));
create policy contacts_update on public.contacts for update to authenticated
  using ((select app.is_manager()))
  with check ((select app.is_manager()));
create policy contacts_delete on public.contacts for delete to authenticated
  using ((select app.is_admin()));

-- ---------- tabelas-filha da organização ----------
do $$
declare
  t text;
begin
  foreach t in array array['organization_categories','organization_tags','organization_contacts']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select app.org_is_visible(organization_id)))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app.can_write()) and (select app.org_is_editable(organization_id)))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select app.can_write()) and (select app.org_is_editable(organization_id))) with check ((select app.can_write()) and (select app.org_is_editable(organization_id)))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app.can_write()) and (select app.org_is_editable(organization_id)))', t || '_delete', t);
  end loop;
end $$;

-- ---------- deals ----------
drop policy if exists deals_select on public.deals;
drop policy if exists deals_insert on public.deals;
drop policy if exists deals_update on public.deals;
drop policy if exists deals_delete on public.deals;
create policy deals_select on public.deals for select to authenticated
  using ((select app.sees_all())
         or ((select app.role()) = 'embaixador'::app.user_role
             and (owner_id = (select auth.uid()) or (select app.org_is_mine(organization_id)))));
-- Embaixador só abre/mantém negócio em organização de que ele é o responsável. Sem a checagem
-- de organização, bastava inserir um negócio (owner_id = eu) numa organização alheia para que
-- app.org_is_mine() passasse a considerá-la "minha" — e com ela vinham organizations_view,
-- contacts_view, os negócios de outras pessoas, a busca e o reveal_phone (escalada de privilégio).
create policy deals_insert on public.deals for insert to authenticated
  with check ((select app.can_write())
              and ((select app.role()) <> 'embaixador'::app.user_role
                   or (owner_id = (select auth.uid()) and (select app.org_is_editable(organization_id)))));
create policy deals_update on public.deals for update to authenticated
  using ((select app.is_manager()) or owner_id = (select auth.uid()))
  with check (((select app.is_manager()) or owner_id = (select auth.uid()))
              and ((select app.role()) <> 'embaixador'::app.user_role
                   or (select app.org_is_editable(organization_id))));
create policy deals_delete on public.deals for delete to authenticated
  using ((select app.is_admin()));

-- Histórico: mesma visibilidade do negócio; escrita só pelo trigger (definer).
drop policy if exists deal_stage_history_select on public.deal_stage_history;
create policy deal_stage_history_select on public.deal_stage_history for select to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_stage_history.deal_id));
revoke insert, update, delete on public.deal_stage_history from authenticated, anon;

-- ---------- activities ----------
drop policy if exists activities_select on public.activities;
drop policy if exists activities_insert on public.activities;
drop policy if exists activities_update on public.activities;
drop policy if exists activities_delete on public.activities;
create policy activities_select on public.activities for select to authenticated
  using ((select app.sees_all())
         or ((select app.role()) = 'embaixador'::app.user_role
             and (user_id = (select auth.uid()) or (select app.org_is_mine(organization_id)))));
-- A atividade precisa cair em organização/negócio que o autor enxerga: app.activities_touch_deal
-- é security definer e atualiza deals.last_activity_at, que alimenta temperatura e "precisa de
-- atenção" (PRD §5.6) — sem esta checagem um embaixador esquentava ou limpava o alerta de um
-- negócio alheio que a política de SELECT nem lhe mostra. O EXISTS em deals respeita a RLS de quem chama.
create policy activities_insert on public.activities for insert to authenticated
  with check ((select app.can_write())
              and ((select app.role()) <> 'embaixador'::app.user_role or user_id = (select auth.uid()))
              and (organization_id is null or (select app.org_is_visible(organization_id)))
              and (deal_id is null or exists (select 1 from public.deals d where d.id = activities.deal_id)));
create policy activities_update on public.activities for update to authenticated
  using ((select app.is_manager()) or user_id = (select auth.uid()))
  with check ((select app.is_manager()) or user_id = (select auth.uid()));
create policy activities_delete on public.activities for delete to authenticated
  using ((select app.is_admin()));

-- ---------- tasks ----------
drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using ((select app.sees_all())
         or assignee_id = (select auth.uid()) or created_by = (select auth.uid()));
create policy tasks_insert on public.tasks for insert to authenticated
  with check ((select app.can_write())
              and (organization_id is null or (select app.org_is_visible(organization_id)))
              and (deal_id is null or exists (select 1 from public.deals d where d.id = tasks.deal_id)));
create policy tasks_update on public.tasks for update to authenticated
  using ((select app.is_manager()) or assignee_id = (select auth.uid()) or created_by = (select auth.uid()))
  with check ((select app.is_manager()) or assignee_id = (select auth.uid()) or created_by = (select auth.uid()));
create policy tasks_delete on public.tasks for delete to authenticated
  using ((select app.is_manager()) or created_by = (select auth.uid()));

-- ---------- consent_events: append-only ----------
drop policy if exists consent_events_select on public.consent_events;
drop policy if exists consent_events_insert on public.consent_events;
create policy consent_events_select on public.consent_events for select to authenticated
  using ((select app.sees_all())
         or (organization_id is not null and (select app.org_is_mine(organization_id))));
-- Um evento de consentimento não é um registro qualquer: 'contact_optout'/'erasure_request'
-- disparam app.consent_apply (security definer), que marca do_not_contact e grava hashes na
-- suppression_list — cuja inserção manual é privativa do admin (RF-ADM-04) e cuja reversão é
-- manual; e 'data_use_authorized' é exatamente a evidência que libera o pré-cadastro na Komune.
-- Por isso: só papéis que escrevem (leitura/financeiro/bot nunca registram consentimento) e só
-- sobre organização/pessoa que o autor enxerga. Workers e webhooks continuam pelo service_role.
create policy consent_events_insert on public.consent_events for insert to authenticated
  with check ((select app.can_write())
              and (organization_id is null or (select app.org_is_visible(organization_id)))
              and (contact_id is null or (select app.contact_is_visible(contact_id))));
revoke update, delete on public.consent_events from authenticated, anon;

-- ---------- suppression_list ----------
drop policy if exists suppression_list_select on public.suppression_list;
drop policy if exists suppression_list_insert on public.suppression_list;
drop policy if exists suppression_list_delete on public.suppression_list;
create policy suppression_list_select on public.suppression_list for select to authenticated
  using ((select app.role()) in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role));
-- Inserção manual (RF-ADM-04) e reversão de opt-out: só admin; o trigger de consentimento é definer.
create policy suppression_list_insert on public.suppression_list for insert to authenticated
  with check ((select app.is_admin()));
create policy suppression_list_delete on public.suppression_list for delete to authenticated
  using ((select app.is_admin()));
revoke update on public.suppression_list from authenticated, anon;

-- ---------- logs ----------
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select app.is_admin()));
revoke insert, update, delete on public.audit_log from authenticated, anon;

drop policy if exists pii_access_log_select on public.pii_access_log;
create policy pii_access_log_select on public.pii_access_log for select to authenticated
  using ((select app.is_manager()));
revoke insert, update, delete on public.pii_access_log from authenticated, anon;

-- ---------- views com telefone mascarado (RF-BAS-14) ----------
-- security_invoker = false (dono postgres): a view aplica o filtro de linhas equivalente às
-- políticas e decide, pelo papel, se o telefone sai completo ou mascarado.
create or replace view public.organizations_view
with (security_barrier = true, security_invoker = false) as
  select o.id, o.kind, o.name, o.legal_name, o.cnpj,
         case when app.reads_base_pii() then o.phone_e164 else app.mask_phone(o.phone_e164) end as phone_e164,
         (not app.reads_base_pii()) as phone_is_masked,
         o.email, o.instagram_handle, o.website, o.website_domain,
         o.city_id, c.name as city_name, o.neighborhood, o.address, o.lat, o.lng,
         o.price_range, o.rating, o.reviews_count, o.description,
         o.source_id, o.source_url, o.collected_at, o.collector,
         o.owner_id, o.temperature, o.temperature_override, o.temperature_override_reason,
         o.temperature_override_by, o.temperature_override_at,
         o.is_natural_person, o.vip, o.do_not_contact, o.komune_supplier_id, o.custom, o.search_name,
         pc.category_id as primary_category_id, cat.name as primary_category_name,
         o.created_at, o.updated_at, o.deleted_at, o.anonymized_at
    from public.organizations o
    left join public.cities c on c.id = o.city_id
    left join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
    left join public.categories cat on cat.id = pc.category_id
   where o.deleted_at is null
     and app.org_is_visible(o.id);
alter view public.organizations_view owner to postgres;
comment on view public.organizations_view is 'Organizações com telefone mascarado para sdr/embaixador; superfície de leitura e edição desses papéis (RF-BAS-14).';

create or replace view public.contacts_view
with (security_barrier = true, security_invoker = false) as
  select ct.id, ct.full_name, ct.first_name,
         case when app.reads_base_pii() then ct.phone_e164 else app.mask_phone(ct.phone_e164) end as phone_e164,
         (not app.reads_base_pii()) as phone_is_masked,
         ct.email, ct.instagram_handle, ct.role_title, ct.is_decision_maker, ct.preferred_channel,
         ct.do_not_contact, ct.source_id, ct.notes, ct.created_at, ct.updated_at, ct.deleted_at, ct.anonymized_at
    from public.contacts ct
   where ct.deleted_at is null
     and (app.sees_all()
          or (app.role() = 'embaixador'::app.user_role
              and exists (select 1 from public.organization_contacts oc
                           where oc.contact_id = ct.id and app.org_is_mine(oc.organization_id))));
alter view public.contacts_view owner to postgres;
comment on view public.contacts_view is 'Pessoas com telefone mascarado para sdr/embaixador (RF-BAS-14).';

-- INSTEAD OF: edição pela view (sdr/embaixador não têm SELECT na base, então UPDATE/INSERT ... RETURNING
-- na tabela falhariam). Definer com as mesmas regras das políticas: admin/gestor ou dono.
-- Telefone: só grava quando o valor enviado difere do exibido (para sdr o exibido é a máscara).
create or replace function app.organizations_view_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not app.can_write() then
    raise exception 'Papel % não pode escrever em organizações', app.role() using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.owner_id is null or not app.is_manager() then
      new.owner_id := v_uid;
    end if;
    insert into public.organizations
      (kind, name, legal_name, cnpj, phone_e164, email, instagram_handle, website, city_id, neighborhood, address,
       lat, lng, price_range, rating, reviews_count, description, source_id, source_url, collected_at, collector,
       owner_id, temperature_override, temperature_override_reason, is_natural_person, vip, custom)
    values
      (coalesce(new.kind, 'fornecedor'), new.name, new.legal_name, new.cnpj, new.phone_e164, new.email, new.instagram_handle,
       new.website, new.city_id, new.neighborhood, new.address, new.lat, new.lng, new.price_range, new.rating,
       new.reviews_count, new.description, new.source_id, new.source_url, coalesce(new.collected_at, now()),
       coalesce(new.collector, 'manual'), new.owner_id, new.temperature_override, new.temperature_override_reason,
       coalesce(new.is_natural_person, false), coalesce(new.vip, false), coalesce(new.custom, '{}'::jsonb))
    returning id into new.id;
    -- RETURNING devolve a linha como a view a mostra (normalizada e mascarada conforme o papel).
    select * into new from public.organizations_view v where v.id = new.id;
    return new;
  end if;

  -- UPDATE
  if not (app.is_manager() or old.owner_id = v_uid) then
    raise exception 'Só o responsável, gestor ou admin edita esta organização' using errcode = '42501';
  end if;
  if new.owner_id is distinct from old.owner_id and not app.is_manager() then
    raise exception 'Só gestor ou admin transfere o responsável' using errcode = '42501';
  end if;

  update public.organizations o
     set kind = new.kind, name = new.name, legal_name = new.legal_name, cnpj = new.cnpj,
         phone_e164 = case when new.phone_e164 is distinct from old.phone_e164 then new.phone_e164 else o.phone_e164 end,
         email = new.email, instagram_handle = new.instagram_handle, website = new.website,
         city_id = new.city_id, neighborhood = new.neighborhood, address = new.address, lat = new.lat, lng = new.lng,
         price_range = new.price_range, rating = new.rating, reviews_count = new.reviews_count,
         description = new.description, source_id = new.source_id, source_url = new.source_url,
         collected_at = new.collected_at, collector = new.collector, owner_id = new.owner_id,
         temperature_override = new.temperature_override, temperature_override_reason = new.temperature_override_reason,
         is_natural_person = new.is_natural_person, vip = new.vip, komune_supplier_id = new.komune_supplier_id,
         custom = new.custom,
         deleted_at = case when app.is_manager() then new.deleted_at else o.deleted_at end
   where o.id = old.id;
  select * into new from public.organizations_view v where v.id = old.id;
  return new;
end $$;
drop trigger if exists organizations_view_write on public.organizations_view;
create trigger organizations_view_write instead of insert or update on public.organizations_view
  for each row execute function app.organizations_view_write();

create or replace function app.contacts_view_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_can boolean;
begin
  if not app.can_write() then
    raise exception 'Papel % não pode escrever em pessoas', app.role() using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    insert into public.contacts
      (full_name, first_name, phone_e164, email, instagram_handle, role_title, is_decision_maker,
       preferred_channel, source_id, notes)
    values
      (new.full_name, new.first_name, new.phone_e164, new.email, new.instagram_handle, new.role_title,
       coalesce(new.is_decision_maker, false), coalesce(new.preferred_channel, 'whatsapp'), new.source_id, new.notes)
    returning id into new.id;
    select * into new from public.contacts_view v where v.id = new.id;
    return new;
  end if;

  -- UPDATE: admin/gestor, ou dono de uma organização ligada à pessoa, ou pessoa ainda sem organização.
  v_can := app.is_manager()
        or exists (select 1 from public.organization_contacts oc
                    join public.organizations o on o.id = oc.organization_id
                   where oc.contact_id = old.id and o.owner_id = v_uid)
        or not exists (select 1 from public.organization_contacts oc where oc.contact_id = old.id);
  if not v_can then
    raise exception 'Só o responsável pela organização, gestor ou admin edita esta pessoa' using errcode = '42501';
  end if;

  update public.contacts ct
     set full_name = new.full_name, first_name = new.first_name,
         phone_e164 = case when new.phone_e164 is distinct from old.phone_e164 then new.phone_e164 else ct.phone_e164 end,
         email = new.email, instagram_handle = new.instagram_handle, role_title = new.role_title,
         is_decision_maker = new.is_decision_maker, preferred_channel = new.preferred_channel,
         source_id = new.source_id, notes = new.notes,
         deleted_at = case when app.is_manager() then new.deleted_at else ct.deleted_at end
   where ct.id = old.id;
  select * into new from public.contacts_view v where v.id = old.id;
  return new;
end $$;
drop trigger if exists contacts_view_write on public.contacts_view;
create trigger contacts_view_write instead of insert or update on public.contacts_view
  for each row execute function app.contacts_view_write();

-- ---------- revelação de telefone com log (RF-BAS-14, RF-ADM-03) ----------
create or replace function public.reveal_phone(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role app.user_role := app.role();
  v_phone text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if v_role = 'embaixador' and not app.org_is_mine(p_organization_id) then
    raise exception 'Organização fora da sua carteira' using errcode = '42501';
  end if;

  select o.phone_e164 into v_phone
    from public.organizations o
   where o.id = p_organization_id and o.deleted_at is null;
  if not found then
    raise exception 'Organização não encontrada' using errcode = 'P0002';
  end if;

  insert into public.pii_access_log (actor_id, actor_role, action, entity_type, entity_id)
  values (v_uid, v_role::text, 'reveal_phone', 'organization', p_organization_id);

  return v_phone;
end $$;
comment on function public.reveal_phone(uuid) is 'Devolve o telefone completo da organização e registra em pii_access_log (embaixador: só as suas).';

create or replace function public.reveal_contact_phone(p_contact_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role app.user_role := app.role();
  v_phone text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if v_role = 'embaixador' and not exists (
       select 1 from public.organization_contacts oc
        where oc.contact_id = p_contact_id and app.org_is_mine(oc.organization_id)) then
    raise exception 'Pessoa fora da sua carteira' using errcode = '42501';
  end if;

  select ct.phone_e164 into v_phone
    from public.contacts ct
   where ct.id = p_contact_id and ct.deleted_at is null;
  if not found then
    raise exception 'Pessoa não encontrada' using errcode = 'P0002';
  end if;

  insert into public.pii_access_log (actor_id, actor_role, action, entity_type, entity_id)
  values (v_uid, v_role::text, 'view_contact_phone', 'contact', p_contact_id);

  return v_phone;
end $$;
comment on function public.reveal_contact_phone(uuid) is 'Devolve o telefone completo da pessoa e registra em pii_access_log.';

-- ---------- grants ----------
-- anon: nada. Também nos privilégios padrão, para tabelas/funções futuras não nascerem expostas.
revoke all on schema public from anon;
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
revoke all on schema app from anon;

-- Funções públicas: nada para PUBLIC/anon; RPCs para authenticated e service_role.
revoke all on all functions in schema public from public;
grant execute on function public.reveal_phone(uuid) to authenticated, service_role;
grant execute on function public.reveal_contact_phone(uuid) to authenticated, service_role;
-- (o hook continua só com supabase_auth_admin — migração 000200)

-- Views: leitura para authenticated; escrita pela view para authenticated (o INSTEAD OF valida o papel).
grant select on public.team_directory to authenticated, service_role;
grant select, insert, update on public.organizations_view to authenticated, service_role;
grant select, insert, update on public.contacts_view to authenticated, service_role;

-- Schema app: usuários autenticados executam as funções de apoio das políticas.
grant usage on schema app to authenticated, service_role;
-- As funções do schema app nasceram (migração 000100) com o EXECUTE que o Postgres dá a PUBLIC:
-- tiramos antes de conceder, para que só authenticated/service_role executem (anon fica fora,
-- mesmo já não tendo USAGE no schema).
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.recompute_temperatures() from authenticated;
revoke execute on function app.suppress(text, text, text, app.channel, uuid) from authenticated;
-- Funções de gatilho não são superfície de API: várias são security definer (auditoria,
-- consentimento, temperatura, criação de perfil a partir de auth.users) e nenhuma precisa de
-- EXECUTE para o gatilho disparar — o Postgres as chama em nome do dono do gatilho.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke all on function %s from authenticated, anon, public', f.sig);
  end loop;
end $$;

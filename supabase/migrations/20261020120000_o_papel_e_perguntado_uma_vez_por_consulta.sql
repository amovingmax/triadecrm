-- =============================================================================
-- O papel é perguntado uma vez por consulta, e não uma vez por linha (20/10/2026)
-- =============================================================================
-- `organizations_view` é lida em dezoito lugares do CRM (a lista de Conversas, a
-- ficha, Prospectados, o Meu dia, os avisos...), e `contacts_view` em todo lugar
-- que mostra uma pessoa. As duas decidiam, PARA CADA LINHA, quem está perguntando:
-- `app.org_is_visible(o.id)` e `app.reads_base_pii()` chamam `app.role()`, que é
-- plpgsql (o planejador não a embute) e relê o JWT a cada chamada.
--
-- A regra é a MESMA, escrita para o Postgres responder "qual é o meu papel" uma
-- vez só: `(select app.sees_all())` e `(select app.reads_base_pii())` viram um
-- parâmetro calculado no início da consulta (initplan), como as políticas das
-- tabelas principais já fazem desde o D1. A única chamada por linha que sobra é a
-- do embaixador (`app.org_is_mine`), que depende mesmo da linha — e só roda para
-- ele, porque para quem vê tudo o `or` termina antes.
--
-- `app.org_is_visible(p)` é `app.sees_all() or (app.role() = 'embaixador' and
-- app.org_is_mine(p))` (20260904000500): o filtro abaixo é ela por extenso.
--
-- Medido no banco local com 5.000 parceiros, a consulta da lista de Conversas
-- (500 linhas por `updated_at`): gestor 72 ms → 1,7 ms; embaixador 388 → 39 ms;
-- as mesmas linhas e os mesmos telefones mascarados nos dois casos.
--
-- `create or replace view` com as mesmas colunas, na mesma ordem: as permissões,
-- o gatilho INSTEAD OF (`organizations_view_write`) e quem depende da view ficam.
-- Pode rodar de novo sem efeito.
-- =============================================================================

create or replace view public.organizations_view
with (security_barrier = true, security_invoker = false) as
  select o.id, o.kind, o.name, o.legal_name, o.cnpj,
         case when (select app.reads_base_pii()) then o.phone_e164 else app.mask_phone(o.phone_e164) end as phone_e164,
         (not (select app.reads_base_pii())) as phone_is_masked,
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
     and ((select app.sees_all())
          or ((select app.role()) = 'embaixador'::app.user_role and app.org_is_mine(o.id)));
alter view public.organizations_view owner to postgres;
comment on view public.organizations_view is 'Organizações com telefone mascarado para sdr/embaixador; superfície de leitura e edição desses papéis (RF-BAS-14). O papel é lido uma vez por consulta (20261020120000).';

create or replace view public.contacts_view
with (security_barrier = true, security_invoker = false) as
  select ct.id, ct.full_name, ct.first_name,
         case when (select app.reads_base_pii()) then ct.phone_e164 else app.mask_phone(ct.phone_e164) end as phone_e164,
         (not (select app.reads_base_pii())) as phone_is_masked,
         ct.email, ct.instagram_handle, ct.role_title, ct.is_decision_maker, ct.preferred_channel,
         ct.do_not_contact, ct.source_id, ct.notes, ct.created_at, ct.updated_at, ct.deleted_at, ct.anonymized_at
    from public.contacts ct
   where ct.deleted_at is null
     and ((select app.sees_all())
          or ((select app.role()) = 'embaixador'::app.user_role
              and exists (select 1 from public.organization_contacts oc
                           where oc.contact_id = ct.id and app.org_is_mine(oc.organization_id))));
alter view public.contacts_view owner to postgres;
comment on view public.contacts_view is 'Pessoas com telefone mascarado para sdr/embaixador (RF-BAS-14). O papel é lido uma vez por consulta (20261020120000).';

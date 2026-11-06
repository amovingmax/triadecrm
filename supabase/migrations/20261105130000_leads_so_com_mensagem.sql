-- =====================================================================
-- O lead do portal só entra no CRM quando a pessoa manda mensagem — só na Imova
-- (05/11/2026)
--
-- Decisão do usuário em 05/11: "os leads somente cheguem ao CRM quando enviarem
-- mensagem", e a conversa já chega com a etiqueta do anúncio e o código do
-- imóvel. Na 20261105100000 todo aviso do Grupo OLX (clicou no WhatsApp, viu o
-- telefone, mandou mensagem pelo chat...) virava ficha de Cliente na hora.
-- Agora:
--
--   1. O AVISO FICA GUARDADO SEM APARECER. O contato que o portal manda (nome,
--      telefone, e-mail) vai para `public.portal_lead_contatos`, que só a
--      gestão lê; o SDR vê o telefone mascarado e revela pelo botão, com
--      registro (`public.portal_lead_revelar_telefone`).
--   2. MANDOU MENSAGEM PELO WHATSAPP: a conversa do mesmo telefone, com uma
--      mensagem recebida depois do clique, é ligada ao lead NA LEITURA
--      (`public.portal_leads_na_lista`). A ficha é a que o WhatsApp já cria
--      (ficha automática); a etiqueta "Veio do anúncio X" aparece na conversa
--      e o lead entra na lista principal da aba Leads.
--   3. MANDOU MENSAGEM PELO PORTAL (chat, formulário, pedido de visita): é
--      lead na hora, e só ele ganha a ficha de Cliente que a 20261105100000
--      criava para todos.
--   4. CLICOU E NÃO CHAMOU (WhatsApp, "ver telefone", agendar, sem mensagem):
--      fica na seção "Clicaram e não chamaram", sem ficha e sem conversa.
--   5. NOVENTA DIAS: o contato que o portal mandou é apagado 90 dias depois do
--      aviso; o lead fica com o anúncio, o tipo e a data (a conta por anúncio
--      continua). A ligação à conversa é gravada antes, a cada 15 minutos
--      (`app.portal_leads_manter`), e a ficha ganha a atividade "Lead do portal".
--
-- A lista também ganha o que a aba pedia: a primeira mensagem da pessoa, quando
-- e quem do time respondeu primeiro, e a situação "respondido" sozinha quando o
-- time responde pela conversa.
--
-- ===========================================================================
-- O WHATSAPP NÃO É TOCADO
-- ===========================================================================
-- Nada aqui grava em `messages` ou `conversations`, enfileira envio ou cria
-- gatilho (nem chave estrangeira, que é gatilho por dentro) nessas tabelas: a
-- conversa e as mensagens são só LIDAS, pela lista e pela rotina de 15 minutos.
-- O casamento é pelo telefone já normalizado (`peer_phone_e164` passa por
-- `app.normalize_phone_br`, como o telefone do lead).
--
-- COMO DESFAZER (no banco da Imova): reaplicar a seção 3 (receber) e a 5 (lista)
-- da 20261105100000; `select cron.unschedule('portal_leads_manter')`; drop das
-- funções app.portal_leads_manter(), app.portal_lead_ligar_ficha(...),
-- app.portal_lead_mandou_mensagem(text[]), public.portal_lead_revelar_telefone(uuid);
-- drop table public.portal_lead_contatos; alter table public.portal_leads drop
-- column conversation_id, drop column contato_apagado_em.
-- =====================================================================

do $leads$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os leads dos portais são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. O contato que o portal mandou, à parte
-- =====================================================================
create table if not exists public.portal_lead_contatos (
  lead_id        uuid primary key references public.portal_leads (id) on delete cascade,
  nome           text check (char_length(nome) <= 120),
  telefone_e164  text check (telefone_e164 ~ '^\+\d{8,15}$'),
  email          text check (char_length(email) <= 254),
  criado_em      timestamptz not null default now()
);
create index if not exists portal_lead_contatos_telefone_idx
  on public.portal_lead_contatos (telefone_e164) where telefone_e164 is not null;
alter table public.portal_lead_contatos enable row level security;
drop policy if exists portal_lead_contatos_select on public.portal_lead_contatos;
-- Telefone inteiro é da gestão, como na tabela-base de organizations; o SDR lê
-- pela lista (mascarado) e revela pelo botão.
create policy portal_lead_contatos_select on public.portal_lead_contatos
  for select to authenticated using ((select app.admin_ou_gestor()));
revoke all on public.portal_lead_contatos from anon;
revoke insert, update, delete, truncate on public.portal_lead_contatos from authenticated;
grant select on public.portal_lead_contatos to authenticated;
comment on table public.portal_lead_contatos is
  'O nome, o telefone e o e-mail que o Grupo OLX mandou com o lead (05/11/2026, só na Imova). Só a gestão lê; apagados 90 dias depois do aviso (app.portal_leads_manter). Escrita só por public.grupozap_lead_receber.';

alter table public.portal_leads add column if not exists conversation_id uuid;
alter table public.portal_leads add column if not exists contato_apagado_em timestamptz;
comment on column public.portal_leads.conversation_id is
  'A conversa de WhatsApp em que a pessoa mandou mensagem depois do clique, gravada por app.portal_leads_manter (sem chave estrangeira: nada de gatilho em conversations). Antes disso a lista acha a conversa na leitura.';
comment on column public.portal_leads.contato_apagado_em is
  'Quando o contato que o portal mandou foi apagado (90 dias depois do aviso).';

-- Os tipos de contato em que a pessoa escreveu alguma coisa no próprio portal.
create or replace function app.portal_lead_mandou_mensagem(p_tipos text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_tipos && array['CONTACT_CHAT', 'CONTACT_FORM', 'VISIT_REQUEST']::text[], false)
$$;
comment on function app.portal_lead_mandou_mensagem(text[]) is
  'O lead escreveu pelo portal (chat, formulário ou pedido de visita)? Clique no WhatsApp, ver telefone e agendar não são mensagem.';
revoke all on function app.portal_lead_mandou_mensagem(text[]) from public, anon;
grant execute on function app.portal_lead_mandou_mensagem(text[]) to authenticated, service_role;

-- =====================================================================
-- 2. A ficha, só para quem mandou mensagem pelo portal
-- =====================================================================
-- O mesmo caminho da 20261105100000 (liga à ficha que já tem o telefone ou o
-- e-mail, ou cria a de Cliente), agora chamado só quando o lead escreveu.
create or replace function app.portal_lead_ligar_ficha(p_id uuid, p_tel text, p_email text,
                                                      p_nome text, p_trans text, p_texto text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_ficha text;
  v_fonte int;
  v_cat   int;
  v_pipe  int;
  v_etapa int;
  v_deal  uuid;
begin
  if p_tel is not null and app.is_suppressed(p_tel) then
    v_ficha := 'suprimida';
  elsif p_tel is null and p_email is null then
    v_ficha := 'sem_contato';
  else
    if p_tel is not null then
      select o.id into v_org from public.organizations o
       where o.phone_e164 = p_tel and o.deleted_at is null
       limit 1;
      if v_org is null then
        select oc.organization_id into v_org
          from public.contacts ct
          join public.organization_contacts oc on oc.contact_id = ct.id
          join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
         where ct.phone_e164 = p_tel and ct.deleted_at is null
         order by oc.is_primary desc
         limit 1;
      end if;
    end if;
    if v_org is null and p_email is not null then
      select o.id into v_org from public.organizations o
       where lower(o.email::text) = p_email and o.deleted_at is null
       order by o.created_at
       limit 1;
      if v_org is null then
        select oc.organization_id into v_org
          from public.contacts ct
          join public.organization_contacts oc on oc.contact_id = ct.id
          join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
         where lower(ct.email::text) = p_email and ct.deleted_at is null
         order by oc.is_primary desc
         limit 1;
      end if;
    end if;

    if v_org is not null and app.is_suppressed_target(v_org, null) then
      v_org := null;
      v_ficha := 'suprimida';
    elsif v_org is not null then
      v_ficha := 'ligada';
      update public.organizations o
         set phone_e164 = case when o.phone_e164 is null and p_tel is not null
                                    and not exists (select 1 from public.organizations y
                                                     where y.phone_e164 = p_tel and y.deleted_at is null)
                               then p_tel else o.phone_e164 end,
             email = coalesce(o.email, p_email)
       where o.id = v_org
         and ((o.phone_e164 is null and p_tel is not null) or (o.email is null and p_email is not null));
    else
      select s.id into v_fonte from public.sources s where s.slug = 'canal_pro';
      select ca.id into v_cat from public.categories ca
       where ca.slug = case when p_trans = 'RENT' then 'locatario' else 'comprador' end and ca.is_active;
      select p.id into v_pipe from public.pipelines p where p.slug = 'produtor';
      select st.id into v_etapa from public.stages st
       where st.pipeline_id = v_pipe and st.is_entry and st.retired_at is null
       order by st.position limit 1;
      if v_fonte is null or v_cat is null or v_etapa is null then
        v_ficha := 'catalogo_incompleto';
      else
        begin
          insert into public.organizations (kind, name, phone_e164, email, source_id, collected_at,
                                            collector, owner_id, is_natural_person)
          values ('produtor'::app.org_kind, coalesce(p_nome, 'Interessado do portal'), p_tel, p_email,
                  v_fonte, now(), 'leads do Canal Pro', null, true)
          returning id into v_org;
          insert into public.organization_categories (organization_id, category_id, is_primary)
          values (v_org, v_cat, true);
          insert into public.deals (organization_id, pipeline_id, stage_id, owner_id, source_id)
          values (v_org, v_pipe, v_etapa, null, v_fonte)
          returning id into v_deal;
          v_ficha := 'criada';
        exception when unique_violation then
          select o.id into v_org from public.organizations o
           where o.phone_e164 = p_tel and o.deleted_at is null
           limit 1;
          if v_org is null then
            -- Sem o detalhe do erro original: ele traz o telefone.
            raise exception 'ficha_nao_criada' using errcode = 'P0001';
          end if;
          v_deal := null;
          v_ficha := 'ligada';
        end;
      end if;
    end if;
  end if;

  if v_org is not null then
    insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
    values ('system', v_org, coalesce(v_deal, app.wa_negocio_da_ficha(v_org)), null, 'system', p_texto,
            jsonb_build_object('origin', 'portal_lead', 'portal_lead_id', p_id, 'ficha', v_ficha));
  end if;
  update public.portal_leads
     set organization_id = coalesce(v_org, organization_id),
         suprimido = suprimido or v_ficha = 'suprimida'
   where id = p_id;
  return v_ficha;
end $$;
comment on function app.portal_lead_ligar_ficha(uuid, text, text, text, text, text) is
  'Liga o lead do portal à ficha que já tem o telefone ou o e-mail, ou cria a ficha de Cliente (origem Portais). Só para quem mandou mensagem pelo portal; chamada por public.grupozap_lead_receber.';
revoke all on function app.portal_lead_ligar_ficha(uuid, text, text, text, text, text) from public, anon, authenticated;

-- =====================================================================
-- 3. Receber
-- =====================================================================
create or replace function public.grupozap_lead_receber(p_chave text, p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chave    text := btrim(coalesce(p_chave, ''));
  v_extra    jsonb;
  v_origem   text;
  v_mcmv     boolean;
  v_cod      text;
  v_cod_port text;
  v_tipo     text;
  v_legivel  text;
  v_temp     text;
  v_trans    text;
  v_lc       jsonb;
  v_certo    boolean;
  v_msg      text;
  v_link     text;
  v_quando   timestamptz;
  v_payload  jsonb;
  v_minimo   jsonb;
  v_anuncio  uuid;
  v_manual   uuid;
  v_trazido  uuid;
  v_an_sit   text;
  v_id       uuid;
  v_lead     public.portal_leads%rowtype;
  v_repetido boolean := false;
  v_tel      text;
  v_email    text;
  v_nome     text;
  v_supr     boolean;
  v_ficha    text;
  v_tipo_novo boolean := false;
  v_k        public.portal_lead_contatos%rowtype;
begin
  if v_chave = '' or char_length(v_chave) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'chave_invalida');
  end if;
  if jsonb_typeof(p_lead) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'lead_invalido');
  end if;
  v_extra := case when jsonb_typeof(p_lead -> 'extraData') = 'object' then p_lead -> 'extraData'
                  else '{}'::jsonb end;

  -- ---- O que o lead diz ----
  v_origem := left(nullif(btrim(p_lead ->> 'leadOrigin'), ''), 80);
  v_mcmv := coalesce(v_origem ~* 'mcmv', false)
            or coalesce(jsonb_typeof(v_extra -> 'mcmv') = 'object', false)
            or coalesce((v_extra -> 'mcmv') = 'true'::jsonb, false);
  v_cod := left(nullif(btrim(p_lead ->> 'clientListingId'), ''), 100);
  v_cod_port := left(nullif(btrim(p_lead ->> 'originListingId'), ''), 100);
  v_tipo := upper(btrim(v_extra ->> 'leadType'));
  if v_tipo !~ '^[A-Z_]{1,40}$' then
    v_tipo := null;
  end if;
  v_temp := left(nullif(btrim(p_lead ->> 'temperature'), ''), 20);
  v_trans := left(nullif(upper(btrim(p_lead ->> 'transactionType')), ''), 20);
  v_lc := v_extra -> 'leadCerto';
  v_certo := case jsonb_typeof(v_lc)
               when 'boolean' then v_lc = 'true'::jsonb
               when 'string' then lower(btrim(v_lc #>> '{}')) in ('true', '1', 'sim')
               when 'number' then (v_lc #>> '{}') = '1'
               else false end;
  v_msg := left(app.sem_cpf(p_lead ->> 'message'), 2000);
  v_link := btrim(v_extra ->> 'izi');
  if v_link !~* '^https?://[^\s]+$' or char_length(v_link) > 500 then
    v_link := null;
  end if;
  begin
    v_quando := nullif(btrim(p_lead ->> 'timestamp'), '')::timestamptz;
  exception when others then
    v_quando := null;
  end;

  -- O contato, que vai para `portal_lead_contatos` (e nunca para o payload).
  v_tel := coalesce(app.normalize_phone_br(nullif(coalesce(p_lead ->> 'ddd', '') || coalesce(p_lead ->> 'phone', ''), '')),
                    app.normalize_phone_br(p_lead ->> 'phone'),
                    app.normalize_phone_br(p_lead ->> 'phoneNumber'));
  v_email := lower(btrim(p_lead ->> 'email'));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    v_email := null;
  end if;
  v_nome := left(nullif(btrim(regexp_replace(coalesce(app.sem_cpf(p_lead ->> 'name'), ''), '\s+', ' ', 'g')), ''), 120);
  -- Telefone que pediu para sair: o lead fica marcado, sem contato nenhum.
  v_supr := v_tel is not null and app.is_suppressed(v_tel);

  -- O JSON sem nome, e-mail, telefone e mensagem, e sem a simulação do MCMV.
  v_payload := p_lead - array['name', 'email', 'ddd', 'phone', 'phoneNumber', 'message'];
  v_payload := v_payload - coalesce((select array_agg(k) from jsonb_object_keys(v_payload) k
                                      where k ~* '(cpf|cnpj)'), '{}'::text[]);
  if jsonb_typeof(v_payload -> 'extraData') = 'object' then
    v_extra := v_payload -> 'extraData';
    v_extra := v_extra - coalesce((select array_agg(k) from jsonb_object_keys(v_extra) k
                                    where k ~* '(cpf|cnpj)'), '{}'::text[]);
    if v_extra ? 'mcmv' then
      v_extra := (v_extra - 'mcmv') || jsonb_build_object('mcmv', 'omitido');
    end if;
    v_payload := jsonb_set(v_payload, '{extraData}', v_extra);
  end if;
  v_minimo := jsonb_strip_nulls(jsonb_build_object(
    'leadOrigin', v_origem, 'timestamp', p_lead ->> 'timestamp', 'originLeadId', v_chave,
    'originListingId', v_cod_port, 'clientListingId', v_cod, 'temperature', v_temp,
    'transactionType', v_trans,
    'extraData', jsonb_strip_nulls(jsonb_build_object('leadType', v_tipo, 'leadCerto', v_certo,
                                                      'mcmv', case when v_mcmv then 'omitido' end)),
    'resumido', true));
  if app.tem_cpf(v_payload::text) then
    begin
      v_payload := coalesce(app.sem_cpf(v_payload::text)::jsonb, v_minimo);
    exception when others then
      v_payload := v_minimo;
    end;
  end if;
  if octet_length(v_payload::text) > 20000 then
    v_payload := v_minimo;
  end if;

  -- ---- O anúncio: primeiro o do CRM, depois o do relatório do Canal Pro ----
  if v_cod is null then
    v_an_sit := 'sem_codigo';
  else
    select a.id into v_anuncio from public.anuncios a
     where a.codigo = v_cod and a.excluido_em is null;
    select m.id, m.anuncio_id into v_manual, v_trazido
      from public.anuncios_no_canal_pro m
     where m.codigo = v_cod;
    if v_anuncio is null and v_trazido is not null
       and exists (select 1 from public.anuncios a where a.id = v_trazido and a.excluido_em is null) then
      v_anuncio := v_trazido;
    end if;
    v_an_sit := case when v_anuncio is not null or v_manual is not null then 'encontrado'
                     else 'nao_encontrado' end;
  end if;

  -- ---- Uma vez só ----
  insert into public.portal_leads as l
    (origin_lead_id, origem_no_portal, client_listing_id, origin_listing_id, anuncio_id,
     anuncio_no_canal_pro_id, tipos, temperatura, transacao, lead_certo, mcmv, mensagem,
     link_historico, recebido_no_portal_em, payload, suprimido)
  values
    (v_chave, v_origem, v_cod, v_cod_port, v_anuncio, v_manual,
     case when v_tipo is null then '{}'::text[] else array[v_tipo] end,
     v_temp, v_trans, v_certo, v_mcmv, v_msg, v_link, v_quando, v_payload, v_supr)
  on conflict (origem, origin_lead_id) do nothing
  returning l.id into v_id;

  if v_id is null then
    select l.* into v_lead from public.portal_leads l
     where l.origem = 'grupo_olx' and l.origin_lead_id = v_chave
     for update;
    v_id := v_lead.id;
    v_cod := coalesce(v_cod, v_lead.client_listing_id);
    v_mcmv := v_mcmv or v_lead.mcmv;
    v_trans := coalesce(v_trans, v_lead.transacao);
    v_repetido := true;
  end if;

  v_legivel := coalesce(case v_tipo
                          when 'CLICK_WHATSAPP' then 'clicou no WhatsApp'
                          when 'PHONE_VIEW'     then 'viu o telefone'
                          when 'CONTACT_CHAT'   then 'mandou mensagem pelo chat'
                          when 'CONTACT_FORM'   then 'preencheu o formulário'
                          when 'VISIT_REQUEST'  then 'pediu uma visita'
                          when 'CLICK_SCHEDULE' then 'quis agendar uma visita'
                          else lower(replace(v_tipo, '_', ' ')) end,
                        'contato')
               || case when v_mcmv then ', Minha Casa Minha Vida' else '' end;

  -- ---- O contato que o portal mandou (o que faltava é completado) ----
  if v_repetido and (v_lead.suprimido or v_lead.contato_apagado_em is not null) then
    null;
  elsif v_supr then
    if v_repetido then
      update public.portal_leads set suprimido = true where id = v_id and not suprimido;
      delete from public.portal_lead_contatos where lead_id = v_id;
    end if;
  elsif v_tel is not null or v_email is not null or v_nome is not null then
    insert into public.portal_lead_contatos as k (lead_id, nome, telefone_e164, email)
    values (v_id, v_nome, v_tel, v_email)
    on conflict (lead_id) do update
      set nome          = coalesce(k.nome, excluded.nome),
          telefone_e164 = coalesce(k.telefone_e164, excluded.telefone_e164),
          email         = coalesce(k.email, excluded.email);
  end if;

  if v_repetido then
    if v_tipo is not null then
      update public.portal_leads
         set tipos = tipos || v_tipo
       where id = v_id and not (v_tipo = any (tipos)) and cardinality(tipos) < 20;
      v_tipo_novo := found;
    end if;
    if v_tipo_novo and v_lead.organization_id is not null then
      -- O tipo novo é contado na ficha que o lead já tem.
      insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
      values ('system', v_lead.organization_id, app.wa_negocio_da_ficha(v_lead.organization_id), null, 'system',
              format('Lead do portal: anúncio %s (%s)', coalesce(v_cod, 'sem código'), v_legivel),
              jsonb_build_object('origin', 'portal_lead', 'portal_lead_id', v_id, 'tipo', v_tipo,
                                 'repetido', true));
    elsif v_tipo_novo and v_lead.organization_id is null and not v_lead.suprimido and not v_supr
          and app.portal_lead_mandou_mensagem(array[v_tipo]) then
      -- Clicou antes, escreveu agora: só agora ganha a ficha.
      select k.* into v_k from public.portal_lead_contatos k where k.lead_id = v_id;
      perform app.portal_lead_ligar_ficha(v_id, v_k.telefone_e164, v_k.email, v_k.nome, v_trans,
                format('Lead do portal: anúncio %s (%s)', coalesce(v_cod, 'sem código'), v_legivel));
    end if;
    return jsonb_build_object('ok', true, 'duplicado', true, 'lead_id', v_id);
  end if;

  -- ---- A ficha: só para quem escreveu pelo portal ----
  if v_supr then
    v_ficha := 'suprimida';
  elsif app.portal_lead_mandou_mensagem(case when v_tipo is null then '{}'::text[] else array[v_tipo] end) then
    v_ficha := app.portal_lead_ligar_ficha(v_id, v_tel, v_email, v_nome, v_trans,
                 format('Lead do portal: anúncio %s (%s)', coalesce(v_cod, 'sem código'), v_legivel));
  else
    -- Clicou no WhatsApp, viu o telefone ou quis agendar: espera a mensagem.
    v_ficha := 'aguarda_mensagem';
  end if;

  return jsonb_build_object('ok', true, 'duplicado', false, 'lead_id', v_id,
                            'anuncio', v_an_sit, 'ficha', v_ficha);
end $$;
comment on function public.grupozap_lead_receber(text, jsonb) is
  'Recebe um lead do webhook do Grupo OLX (só a Edge Function grupozap-lead, com a chave de serviço). Idempotente pela chave (originLeadId); liga ao anúncio pelo código; guarda o contato à parte (portal_lead_contatos). Só quem escreveu pelo portal (chat, formulário, visita) ganha ficha na hora; quem clicou no WhatsApp entra quando a mensagem chega (portal_leads_na_lista). Telefone suprimido não guarda contato. Não envia nada.';
revoke all on function public.grupozap_lead_receber(text, jsonb) from public, anon, authenticated;
grant execute on function public.grupozap_lead_receber(text, jsonb) to service_role;

-- =====================================================================
-- 4. Revelar o telefone de quem ainda não tem ficha
-- =====================================================================
create or replace function public.portal_lead_revelar_telefone(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tel text;
begin
  if auth.uid() is null or not app.is_manager() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  select k.telefone_e164 into v_tel from public.portal_lead_contatos k where k.lead_id = p_id;
  if v_tel is null then
    return null;
  end if;
  insert into public.pii_access_log (actor_id, actor_role, action, entity_type, entity_id)
  values (auth.uid(), app.role()::text, 'reveal_phone', 'portal_lead', p_id);
  return v_tel;
end $$;
comment on function public.portal_lead_revelar_telefone(uuid) is
  'O telefone inteiro que o portal mandou com o lead, para quem ainda não tem ficha; registra em pii_access_log. Admin, gestor e SDR.';
revoke all on function public.portal_lead_revelar_telefone(uuid) from public, anon;
grant execute on function public.portal_lead_revelar_telefone(uuid) to authenticated;

-- =====================================================================
-- 5. A lista da tela
-- =====================================================================
-- Como `organizations_view`: roda com os direitos do dono (para mascarar o
-- telefone e achar a conversa pelo telefone, que o SDR não lê) e filtra quem
-- pode ver (`app.is_manager()`), com security_barrier.
--
-- grupo:      'mensagem' (mandou mensagem: WhatsApp ou portal) ou 'clicou'.
-- chegou_por: 'whatsapp', 'chat', 'formulario', 'visita' ou null.
-- situacao:   a registrada, mas "respondido" sozinha quando alguém do time
--             respondeu na conversa (`situacao_registrada` é a da tabela).
-- A lista de Anúncios passa a depender desta (a conta de leads): as duas saem e
-- voltam juntas, e nada mais depende delas.
drop view if exists public.anuncios_na_lista;
drop view if exists public.portal_leads_na_lista;
create view public.portal_leads_na_lista
with (security_barrier = true, security_invoker = false) as
with leads as (
  select l.*, k.nome as k_nome, k.telefone_e164 as k_tel, k.email as k_email,
         coalesce(l.recebido_no_portal_em, l.recebido_em) as clicou_em
    from public.portal_leads l
    left join public.portal_lead_contatos k on k.lead_id = l.id
   where (select app.is_manager())
),
candidatas as (
  -- A conversa já gravada, ou as do mesmo telefone (uma passada em conversations).
  select ld.id as lead_id, ld.clicou_em, ld.conversation_id as conversa
    from leads ld
   where ld.conversation_id is not null
  union all
  select ld.id, ld.clicou_em, c.id
    from leads ld
    join public.conversations c
      on c.peer_phone_e164 = ld.k_tel and c.channel = 'whatsapp'::app.channel
   where ld.conversation_id is null and ld.k_tel is not null
),
conv as (
  -- A primeira mensagem recebida depois do clique (10 minutos de folga para o relógio).
  select distinct on (ca.lead_id)
         ca.lead_id, ca.conversa as conversation_id, mi.id as primeira_id, mi.created_at as primeira_em
    from candidatas ca
    cross join lateral (
      select m.id, m.created_at
        from public.messages m
       where m.conversation_id = ca.conversa
         and m.direction = 'in'::app.msg_direction
         and m.created_at >= ca.clicou_em - interval '10 minutes'
       order by m.created_at
       limit 1) mi
   order by ca.lead_id, mi.created_at
)
select l.id, l.origem, l.origem_no_portal, l.origin_lead_id, l.client_listing_id, l.origin_listing_id,
       l.anuncio_id, l.anuncio_no_canal_pro_id,
       coalesce(l.organization_id, c.organization_id) as organization_id,
       l.tipos, l.temperatura, l.transacao, l.lead_certo, l.mcmv, l.mensagem, l.link_historico,
       l.recebido_no_portal_em, l.recebido_em,
       case when l.situacao in ('novo', 'em_atendimento') and r.created_at is not null then 'respondido'
            else l.situacao end as situacao,
       l.responsavel_id, l.motivo_descarte, l.situacao_em, l.situacao_por, l.suprimido,
       coalesce(o.name, l.k_nome) as ficha_nome,
       case when o.id is not null then o.phone_e164
            when (select app.reads_base_pii()) then l.k_tel
            else app.mask_phone(l.k_tel) end as phone_e164,
       case when o.id is not null then o.phone_is_masked
            else not (select app.reads_base_pii()) end as phone_is_masked,
       coalesce(o.email::text, l.k_email) as email,
       coalesce(a.codigo, m.codigo) as anuncio_codigo,
       coalesce(nullif(btrim(a.titulo), ''), m.titulo) as anuncio_titulo,
       coalesce(v.conversation_id,
                (select c2.id from public.conversations c2
                  where c2.organization_id = l.organization_id
                  order by c2.last_message_at desc nulls last, c2.created_at desc
                  limit 1)) as conversation_id,
       resp.full_name as responsavel_nome,
       -- Daqui para baixo, o que a 20261105130000 acrescentou.
       l.situacao as situacao_registrada,
       l.k_nome as nome_no_portal,
       case when v.conversation_id is not null or app.portal_lead_mandou_mensagem(l.tipos)
            then 'mensagem' else 'clicou' end as grupo,
       case when v.conversation_id is not null then 'whatsapp'
            when 'CONTACT_CHAT' = any (l.tipos) then 'chat'
            when 'CONTACT_FORM' = any (l.tipos) then 'formulario'
            when 'VISIT_REQUEST' = any (l.tipos) then 'visita' end as chegou_por,
       coalesce(v.primeira_em, l.clicou_em) as chegou_em,
       case when v.conversation_id is not null then left(pm.body, 280)
            when app.portal_lead_mandou_mensagem(l.tipos) then left(l.mensagem, 280) end as primeira_mensagem,
       case when v.conversation_id is not null then pm.type::text end as primeira_mensagem_tipo,
       coalesce(r.created_at, case when l.situacao = 'respondido' then l.situacao_em end) as respondido_em,
       coalesce(rp.full_name, case when l.situacao = 'respondido' then sp.full_name end) as respondido_por_nome,
       l.contato_apagado_em
  from leads l
  left join conv v on v.lead_id = l.id
  left join public.conversations c on c.id = v.conversation_id
  left join public.messages pm on pm.id = v.primeira_id
  left join lateral (
    select m.created_at, m.sent_by
      from public.messages m
     where m.conversation_id = v.conversation_id
       and m.direction = 'out'::app.msg_direction
       and m.author_kind = 'human'
       and m.status <> 'failed'::app.msg_status
       and m.created_at >= v.primeira_em
     order by m.created_at
     limit 1) r on v.conversation_id is not null
  left join public.profiles rp on rp.id = r.sent_by
  left join public.profiles sp on sp.id = l.situacao_por
  left join public.organizations_view o on o.id = coalesce(l.organization_id, c.organization_id)
  left join public.anuncios a on a.id = l.anuncio_id
  left join public.anuncios_no_canal_pro m on m.id = l.anuncio_no_canal_pro_id
  left join public.profiles resp on resp.id = l.responsavel_id;
comment on view public.portal_leads_na_lista is
  'A lista de leads dos portais (só admin, gestor e SDR): o lead, quem é (da ficha ou do que o portal mandou; telefone mascarado para quem não lê o inteiro), o anúncio, a conversa de WhatsApp do mesmo telefone com mensagem depois do clique, a primeira mensagem, a primeira resposta do time, e o grupo (mensagem ou clicou).';
revoke all on public.portal_leads_na_lista from anon;
grant select on public.portal_leads_na_lista to authenticated;

-- A conta da lista de Anúncios passa a ser só de quem mandou mensagem (sem os
-- descartados). Uma passada só na lista de leads, agrupada.
create view public.anuncios_na_lista
with (security_invoker = true) as
select a.id, a.codigo, a.situacao, a.titulo, a.tipo, a.negocio,
       a.preco_venda, a.preco_aluguel, a.periodo_aluguel,
       a.area_util, a.area_total, a.quartos, a.bairro, a.cidade, a.destaque,
       a.criado_em, a.updated_at, a.publicado_em, a.saiu_do_ar_em,
       a.excluido_em, a.motivo_exclusao, a.proprietario_id,
       (select count(*) from public.anuncio_fotos f where f.anuncio_id = a.id)::int as fotos,
       (select f.caminho from public.anuncio_fotos f
         where f.anuncio_id = a.id order by f.posicao, f.criada_em limit 1) as capa,
       app.anuncio_pendencias(a.id) as pendencias,
       o.name as proprietario_nome,
       criador.full_name as criado_por_nome,
       (select m.codigo from public.anuncios_no_canal_pro m where m.anuncio_id = a.id) as codigo_no_canal_pro,
       coalesce(pl.leads, 0)::int as leads
  from public.anuncios a
  left join public.organizations_view o on o.id = a.proprietario_id
  left join public.profiles criador on criador.id = a.criado_por
  left join (select v.anuncio_id, count(*) as leads
               from public.portal_leads_na_lista v
              where v.anuncio_id is not null and v.grupo = 'mensagem' and v.situacao <> 'descartado'
              group by v.anuncio_id) pl on pl.anuncio_id = a.id;
comment on view public.anuncios_na_lista is
  'A lista de Anúncios: cada anúncio com o número de fotos, a capa, o que falta para ir ao ar, o nome do proprietário e quantos leads dos portais mandaram mensagem (sem os descartados).';
revoke all on public.anuncios_na_lista from anon;
grant select on public.anuncios_na_lista to authenticated;

-- =====================================================================
-- 6. A cada 15 minutos: grava a conversa achada e apaga o contato velho
-- =====================================================================
create or replace function app.portal_leads_manter()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ligados  int;
  v_apagados int;
begin
  -- 1. A conversa achada fica gravada (a ficha também, se o lead não tinha), e a
  --    ficha ganha a atividade "Lead do portal".
  with candidatas as (
    select l.id as lead_id, l.organization_id as ficha_antes, l.client_listing_id, l.tipos, l.mcmv,
           c.id as conversa, c.organization_id,
           coalesce(l.recebido_no_portal_em, l.recebido_em) as clicou_em
      from public.portal_leads l
      join public.portal_lead_contatos k on k.lead_id = l.id
      join public.conversations c
        on c.peer_phone_e164 = k.telefone_e164 and c.channel = 'whatsapp'::app.channel
     where l.conversation_id is null and k.telefone_e164 is not null
  ), achadas as (
    select distinct on (ca.lead_id) ca.*
      from candidatas ca
      cross join lateral (
        select m.created_at
          from public.messages m
         where m.conversation_id = ca.conversa
           and m.direction = 'in'::app.msg_direction
           and m.created_at >= ca.clicou_em - interval '10 minutes'
         order by m.created_at
         limit 1) mi
     order by ca.lead_id, mi.created_at
  ), gravadas as (
    update public.portal_leads l
       set conversation_id = a.conversa,
           organization_id = coalesce(l.organization_id, a.organization_id)
      from achadas a
     where l.id = a.lead_id
    returning l.id, a.ficha_antes, l.organization_id, l.client_listing_id, l.tipos, l.mcmv
  ), atividades as (
    insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
    select 'system', g.organization_id, app.wa_negocio_da_ficha(g.organization_id), null, 'system',
           format('Lead do portal: anúncio %s (mandou mensagem pelo WhatsApp%s)',
                  coalesce(g.client_listing_id, 'sem código'),
                  case when g.mcmv then ', Minha Casa Minha Vida' else '' end),
           jsonb_build_object('origin', 'portal_lead', 'portal_lead_id', g.id, 'tipo', 'WHATSAPP_MENSAGEM')
      from gravadas g
     where g.ficha_antes is null and g.organization_id is not null
    returning 1
  )
  select count(*) into v_ligados from gravadas;

  -- 2. Noventa dias: o contato que o portal mandou sai; o lead fica para a conta.
  with velhos as (
    select l.id, (l.organization_id is null and l.conversation_id is null) as sem_ficha
      from public.portal_leads l
     where l.recebido_em < now() - interval '90 days'
       and l.contato_apagado_em is null
  ), sem_contato as (
    delete from public.portal_lead_contatos k
     using velhos v
     where k.lead_id = v.id
    returning k.lead_id
  )
  update public.portal_leads l
     set contato_apagado_em = now(),
         mensagem       = case when v.sem_ficha then null else l.mensagem end,
         link_historico = case when v.sem_ficha then null else l.link_historico end
    from velhos v
   where l.id = v.id;
  get diagnostics v_apagados = row_count;

  return jsonb_build_object('ligados', v_ligados, 'contatos_apagados', v_apagados);
end $$;
comment on function app.portal_leads_manter() is
  'A cada 15 minutos (pg_cron portal_leads_manter): grava a conversa de WhatsApp em que o lead mandou mensagem (e a atividade "Lead do portal" na ficha), e apaga o contato que o portal mandou 90 dias depois do aviso. Só lê messages e conversations.';
revoke all on function app.portal_leads_manter() from public, anon, authenticated;

  $ddl$;

  -- O agendamento fica fora do bloco de DDL, como nas outras rotinas.
  if exists (select 1 from cron.job where jobname = 'portal_leads_manter') then
    perform cron.unschedule('portal_leads_manter');
  end if;
  perform cron.schedule('portal_leads_manter', '*/15 * * * *', $cron$select app.portal_leads_manter()$cron$);
end $leads$;

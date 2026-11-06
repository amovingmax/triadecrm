-- =====================================================================
-- Os leads dos portais (ZAP, Viva Real e OLX) chegam ao CRM — só na Imova (05/11/2026)
--
-- Os anúncios já sobem pelo arquivo do Canal Pro (20261104150000). O outro
-- lado da integração é o contato: quem clica em "WhatsApp", vê o telefone,
-- manda mensagem ou pede visita num anúncio vira um LEAD que o Grupo OLX
-- entrega por webhook (POST com um JSON, um lead por requisição). A Edge
-- Function `grupozap-lead` confere o segredo e chama, com a chave de serviço,
-- `public.grupozap_lead_receber`. Daqui para a frente é com o banco:
--
--   1. O LEAD FICA ANOTADO UMA VEZ SÓ (`public.portal_leads`): a chave é o
--      originLeadId (ou o sha256 do corpo, quando ele falta). O mesmo lead
--      volta com outro tipo de contato (clicou no WhatsApp, depois pediu
--      visita): o tipo novo é somado, nada se duplica.
--   2. LIGADO AO ANÚNCIO pelo código que o CRM mandou (clientListingId = o
--      ListingID): primeiro os anúncios do CRM, depois os do relatório do
--      Canal Pro. A lista de Anúncios ganha a conta de leads de cada um.
--   3. LIGADO À FICHA: o telefone (com DDD; o 9 que faltar é posto) e depois o
--      e-mail procuram a ficha e a pessoa que a base já tem, como o cadastro
--      rápido e a ficha automática fazem; quem não está na base vira Cliente
--      (pessoa física, Comprador ou Locatário pelo tipo de negócio, funil
--      Clientes, origem "Portais (ZAP, Viva Real, OLX)"). A ficha que já
--      existia é só ligada: a origem e quem coletou ficam como estavam (o
--      telefone ou o e-mail que ela não tinha é completado, como a ficha
--      automática completa o número do WhatsApp). Telefone na lista de
--      supressão, ou ficha que pediu para não ser contatada, não ganha ficha
--      nem ligação: o lead fica marcado como suprimido.
--   4. A EQUIPE TRABALHA O LEAD: assumir (`public.portal_lead_assumir`) e mudar
--      a situação (`public.portal_lead_mudar`: em atendimento, respondido,
--      descartado com motivo), com auditoria.
--
-- ===========================================================================
-- O QUE NÃO FICA AQUI (LGPD, ADR-09)
-- ===========================================================================
-- Telefone e e-mail moram na ficha (tabela-base), e não em `portal_leads`: a
-- lista lê os dois de `organizations_view`, então o SDR vê o telefone
-- mascarado e revela pelo botão, como em todo o CRM. O `payload` guarda o JSON
-- como veio MENOS name, email, ddd, phone, phoneNumber e message (a mensagem
-- vai para `mensagem`, sem CPF), e MENOS `extraData.mcmv`: a simulação do Minha
-- Casa Minha Vida pode trazer CPF e CNPJ, e vira só o marcador "omitido".
-- Qualquer CPF que sobrar no JSON é apagado (`app.sem_cpf`).
--
-- ===========================================================================
-- SÓ DA IMOVA, E O WHATSAPP NÃO É TOCADO
-- ===========================================================================
-- No banco da KOMUNE esta migração não cria nada (o mesmo bloco dos anúncios).
-- Nada aqui grava mensagem, enfileira envio ou mexe em conversa: nenhum
-- gatilho entra em `messages` nem em `conversations`, e a lista só LÊ a
-- conversa mais recente da ficha, para o botão "Abrir conversa". Responder o
-- lead é gente do time, pela tela de sempre.
--
-- Ficaram de fora, de propósito: o dossiê da LGPD (`app.lgpd_dossie`) e a
-- retenção (`app.aplicar_retencao`) são funções inteiras das duas empresas, e
-- reescrevê-las aqui, só na Imova, as faria divergir. O dossiê já mostra a
-- ficha e as atividades "Lead do portal" (sem dado pessoal no texto); a
-- mensagem do lead ainda não entra nele nem tem prazo de retenção próprio.
--
-- COMO DESFAZER (no banco da Imova):
--   drop function if exists public.grupozap_lead_receber(text, jsonb),
--     public.portal_lead_assumir(uuid), public.portal_lead_mudar(uuid, text, text);
--   drop view if exists public.portal_leads_na_lista;
--   recriar public.anuncios_na_lista como está na 20261104150000 (sem `leads`:
--     drop view + create, porque a coluna sai);
--   drop table if exists public.portal_leads;
--   delete from public.sources where slug = 'canal_pro'
--     and not exists (select 1 from public.organizations o where o.source_id = sources.id)
--     and not exists (select 1 from public.deals d where d.source_id = sources.id);
-- =====================================================================

do $leads$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os leads dos portais são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. A origem das fichas que nascem de um lead
-- =====================================================================
-- Não é coletor do Radar (`collector.enabled` falso: o botão de coletar não a
-- oferece); quem escreve aqui é o webhook do Grupo OLX.
insert into public.sources (slug, name, kind, base_url, legal_basis, terms_notes, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values ('canal_pro', 'Portais (ZAP, Viva Real, OLX)', 'api', 'https://canalpro.grupozap.com',
        'legitimo_interesse',
        'A pessoa pediu contato num anúncio da Imova Imobiliária no ZAP, no Viva Real ou na OLX, e o Grupo OLX entregou o pedido pelo webhook de leads do Canal Pro. O dado veio dela mesma, num contato que ela iniciou.',
        null, 0.00, true,
        '{"collector": {"kind": "webhook", "phase": "mvp", "enabled": false}, "entrada_por_webhook": true}')
on conflict (slug) do nothing;

-- =====================================================================
-- 2. O lead
-- =====================================================================
create table if not exists public.portal_leads (
  id                       uuid primary key default gen_random_uuid(),
  -- De onde veio o webhook. Hoje só o Grupo OLX.
  origem                   text not null default 'grupo_olx' check (origem ~ '^[a-z_]{2,40}$'),
  -- A chave de idempotência: o originLeadId aparado, ou 'sha256:<hex do corpo>'.
  origin_lead_id           text not null check (char_length(origin_lead_id) between 1 and 200),
  -- O leadOrigin como veio ('Grupo OLX', 'MCMV_OLX').
  origem_no_portal         text check (char_length(origem_no_portal) <= 80),
  -- O ListingID que o CRM mandou (falta nos leads do MCMV) e o id do portal.
  client_listing_id        text check (char_length(client_listing_id) <= 100),
  origin_listing_id        text check (char_length(origin_listing_id) <= 100),
  anuncio_id               uuid references public.anuncios (id) on delete set null,
  anuncio_no_canal_pro_id  uuid references public.anuncios_no_canal_pro (id) on delete set null,
  organization_id          uuid references public.organizations (id) on delete set null,
  -- Os extraData.leadType vistos, na ordem em que chegaram (CLICK_WHATSAPP,
  -- PHONE_VIEW, CONTACT_CHAT, CONTACT_FORM, VISIT_REQUEST, CLICK_SCHEDULE).
  tipos                    text[] not null default '{}' check (cardinality(tipos) <= 20),
  -- 'Alta', 'Média', 'Baixa', como o portal escreve.
  temperatura              text check (char_length(temperatura) <= 20),
  -- 'SELL' ou 'RENT'.
  transacao                text check (char_length(transacao) <= 20),
  lead_certo               boolean not null default false,
  mcmv                     boolean not null default false,
  -- A mensagem do interessado, sem CPF.
  mensagem                 text check (char_length(mensagem) <= 2000),
  -- extraData.izi: o histórico do lead no portal.
  link_historico           text check (char_length(link_historico) <= 500),
  recebido_no_portal_em    timestamptz,
  recebido_em              timestamptz not null default now(),
  situacao                 text not null default 'novo'
                             check (situacao in ('novo', 'em_atendimento', 'respondido', 'descartado')),
  responsavel_id           uuid references public.profiles (id) on delete set null,
  motivo_descarte          text check (char_length(motivo_descarte) <= 300),
  situacao_em              timestamptz,
  situacao_por             uuid references public.profiles (id) on delete set null,
  -- Telefone na lista de supressão (ou ficha que pediu para não ser
  -- contatada): o lead fica, sem ficha.
  suprimido                boolean not null default false,
  -- O JSON como veio, sem dado pessoal (o cabeçalho desta migração diz o que sai).
  payload                  jsonb not null default '{}'::jsonb,
  unique (origem, origin_lead_id)
);
create index if not exists portal_leads_organization_idx on public.portal_leads (organization_id)
  where organization_id is not null;
create index if not exists portal_leads_anuncio_idx on public.portal_leads (anuncio_id)
  where anuncio_id is not null;
create index if not exists portal_leads_recebido_idx on public.portal_leads (recebido_em desc);
create index if not exists portal_leads_situacao_idx on public.portal_leads (situacao);
alter table public.portal_leads enable row level security;
drop policy if exists portal_leads_select on public.portal_leads;
create policy portal_leads_select on public.portal_leads
  for select to authenticated using ((select app.is_manager()));
-- Escrita só pelas funções: o webhook (service_role) e as duas da tela.
revoke all on public.portal_leads from anon;
revoke insert, update, delete, truncate on public.portal_leads from authenticated;
grant select on public.portal_leads to authenticated;
comment on table public.portal_leads is
  'Os leads que o Grupo OLX entrega pelo webhook do Canal Pro (ZAP, Viva Real, OLX), 05/11/2026, só na Imova. Sem telefone nem e-mail: eles moram na ficha. Escrita só por public.grupozap_lead_receber, public.portal_lead_assumir e public.portal_lead_mudar.';

-- =====================================================================
-- 3. Receber: o que a Edge Function `grupozap-lead` chama
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
  v_org_lead uuid;
  v_repetido boolean := false;
  v_tel      text;
  v_email    text;
  v_nome     text;
  v_org      uuid;
  v_ficha    text;
  v_fonte    int;
  v_cat      int;
  v_pipe     int;
  v_etapa    int;
  v_deal     uuid;
begin
  if v_chave = '' or char_length(v_chave) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'chave_invalida');
  end if;
  if jsonb_typeof(p_lead) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'lead_invalido');
  end if;
  v_extra := case when jsonb_typeof(p_lead -> 'extraData') = 'object' then p_lead -> 'extraData'
                  else '{}'::jsonb end;

  -- ---- O que o lead diz, sem dado pessoal ----
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
  -- leadCerto chega como booleano ou como texto ('true'/'false').
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
  -- O mínimo, para quando o JSON vier grande demais ou o CPF não sair limpo.
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
    -- O do relatório que foi trazido para o CRM aponta o anúncio do CRM, se ele não foi excluído.
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
     link_historico, recebido_no_portal_em, payload)
  values
    (v_chave, v_origem, v_cod, v_cod_port, v_anuncio, v_manual,
     case when v_tipo is null then '{}'::text[] else array[v_tipo] end,
     v_temp, v_trans, v_certo, v_mcmv, v_msg, v_link, v_quando, v_payload)
  on conflict (origem, origin_lead_id) do nothing
  returning l.id into v_id;

  -- O mesmo lead de novo: o que ele já tinha (código, MCMV, ficha) vale para o texto.
  if v_id is null then
    select l.id, l.organization_id, coalesce(v_cod, l.client_listing_id), v_mcmv or l.mcmv
      into v_id, v_org_lead, v_cod, v_mcmv
      from public.portal_leads l
     where l.origem = 'grupo_olx' and l.origin_lead_id = v_chave;
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

  if v_repetido then
    -- Só o tipo de contato novo é somado (e contado na ficha, sem dado pessoal).
    if v_tipo is not null then
      update public.portal_leads
         set tipos = tipos || v_tipo
       where id = v_id and not (v_tipo = any (tipos)) and cardinality(tipos) < 20;
      if found and v_org_lead is not null then
        insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
        values ('system', v_org_lead, app.wa_negocio_da_ficha(v_org_lead), null, 'system',
                format('Lead do portal: anúncio %s (%s)', coalesce(v_cod, 'sem código'), v_legivel),
                jsonb_build_object('origin', 'portal_lead', 'portal_lead_id', v_id, 'tipo', v_tipo,
                                   'repetido', true));
      end if;
    end if;
    return jsonb_build_object('ok', true, 'duplicado', true, 'lead_id', v_id);
  end if;

  -- ---- A ficha ----
  v_tel := coalesce(app.normalize_phone_br(nullif(coalesce(p_lead ->> 'ddd', '') || coalesce(p_lead ->> 'phone', ''), '')),
                    app.normalize_phone_br(p_lead ->> 'phone'),
                    app.normalize_phone_br(p_lead ->> 'phoneNumber'));
  v_email := lower(btrim(p_lead ->> 'email'));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    v_email := null;
  end if;

  if v_tel is not null and app.is_suppressed(v_tel) then
    v_ficha := 'suprimida';
  elsif v_tel is null and v_email is null then
    v_ficha := 'sem_contato';
  else
    -- O que a base já conhece — a ficha ou uma pessoa ligada a ela — é LIGADO,
    -- nunca duplicado (as regras de `quick_create_organization`).
    if v_tel is not null then
      select o.id into v_org from public.organizations o
       where o.phone_e164 = v_tel and o.deleted_at is null
       limit 1;
      if v_org is null then
        select oc.organization_id into v_org
          from public.contacts ct
          join public.organization_contacts oc on oc.contact_id = ct.id
          join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
         where ct.phone_e164 = v_tel and ct.deleted_at is null
         order by oc.is_primary desc
         limit 1;
      end if;
    end if;
    if v_org is null and v_email is not null then
      -- `email` é citext; com o search_path vazio a comparação é a de texto,
      -- então o minúsculo é dos dois lados.
      select o.id into v_org from public.organizations o
       where lower(o.email::text) = v_email and o.deleted_at is null
       order by o.created_at
       limit 1;
      if v_org is null then
        select oc.organization_id into v_org
          from public.contacts ct
          join public.organization_contacts oc on oc.contact_id = ct.id
          join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
         where lower(ct.email::text) = v_email and ct.deleted_at is null
         order by oc.is_primary desc
         limit 1;
      end if;
    end if;

    if v_org is not null and app.is_suppressed_target(v_org, null) then
      -- A ficha pediu para não ser contatada: o lead fica, sem ligação.
      v_org := null;
      v_ficha := 'suprimida';
    elsif v_org is not null then
      v_ficha := 'ligada';
      -- Só o que faltava: origem, quem coletou e o resto da ficha ficam.
      update public.organizations o
         set phone_e164 = case when o.phone_e164 is null and v_tel is not null
                                    and not exists (select 1 from public.organizations y
                                                     where y.phone_e164 = v_tel and y.deleted_at is null)
                               then v_tel else o.phone_e164 end,
             email = coalesce(o.email, v_email)
       where o.id = v_org
         and ((o.phone_e164 is null and v_tel is not null) or (o.email is null and v_email is not null));
    else
      select s.id into v_fonte from public.sources s where s.slug = 'canal_pro';
      select ca.id into v_cat from public.categories ca
       where ca.slug = case when v_trans = 'RENT' then 'locatario' else 'comprador' end and ca.is_active;
      select p.id into v_pipe from public.pipelines p where p.slug = 'produtor';
      select st.id into v_etapa from public.stages st
       where st.pipeline_id = v_pipe and st.is_entry and st.retired_at is null
       order by st.position limit 1;
      if v_fonte is null or v_cat is null or v_etapa is null then
        v_ficha := 'catalogo_incompleto';
      else
        v_nome := left(nullif(btrim(regexp_replace(coalesce(app.sem_cpf(p_lead ->> 'name'), ''), '\s+', ' ', 'g')), ''), 120);
        begin
          -- Pessoa física, como a ficha automática do cliente: quem pede
          -- contato num anúncio é, quase sempre, alguém procurando imóvel.
          insert into public.organizations (kind, name, phone_e164, email, source_id, collected_at,
                                            collector, owner_id, is_natural_person)
          values ('produtor'::app.org_kind, coalesce(v_nome, 'Interessado do portal'), v_tel, v_email,
                  v_fonte, now(), 'leads do Canal Pro', null, true)
          returning id into v_org;
          insert into public.organization_categories (organization_id, category_id, is_primary)
          values (v_org, v_cat, true);
          -- A próxima ação fica para a regra da ficha automática (20261104100000).
          insert into public.deals (organization_id, pipeline_id, stage_id, owner_id, source_id)
          values (v_org, v_pipe, v_etapa, null, v_fonte)
          returning id into v_deal;
          v_ficha := 'criada';
        exception when unique_violation then
          -- Outro lead do mesmo telefone criou a ficha neste instante: liga a ela.
          select o.id into v_org from public.organizations o
           where o.phone_e164 = v_tel and o.deleted_at is null
           limit 1;
          if v_org is null then
            -- Sem o detalhe do erro original: ele traz o telefone, e o texto do
            -- erro vai para o log da Edge Function. O lead volta e o Grupo OLX
            -- reenvia.
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
    values ('system', v_org, coalesce(v_deal, app.wa_negocio_da_ficha(v_org)), null, 'system',
            format('Lead do portal: anúncio %s (%s)', coalesce(v_cod, 'sem código'), v_legivel),
            jsonb_build_object('origin', 'portal_lead', 'portal_lead_id', v_id, 'ficha', v_ficha,
                               'tipo', v_tipo, 'anuncio_id', v_anuncio));
  end if;
  update public.portal_leads
     set organization_id = v_org, suprimido = (v_ficha = 'suprimida')
   where id = v_id;

  return jsonb_build_object('ok', true, 'duplicado', false, 'lead_id', v_id,
                            'anuncio', v_an_sit, 'ficha', v_ficha);
end $$;
comment on function public.grupozap_lead_receber(text, jsonb) is
  'Recebe um lead do webhook do Grupo OLX (só a Edge Function grupozap-lead, com a chave de serviço). Idempotente pela chave (originLeadId); liga o lead ao anúncio pelo código e à ficha pelo telefone ou e-mail, ou cria a ficha de Cliente com a origem Portais. Telefone suprimido não ganha ficha. Não envia nada.';
revoke all on function public.grupozap_lead_receber(text, jsonb) from public, anon, authenticated;
grant execute on function public.grupozap_lead_receber(text, jsonb) to service_role;

-- =====================================================================
-- 4. A equipe trabalha o lead
-- =====================================================================
create or replace function public.portal_lead_assumir(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
  v_depois text;
begin
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select l.situacao into v_antes from public.portal_leads l where l.id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  update public.portal_leads
     set responsavel_id = auth.uid(),
         situacao       = case when situacao = 'novo' then 'em_atendimento' else situacao end,
         situacao_em    = case when situacao = 'novo' then now() else situacao_em end,
         situacao_por   = case when situacao = 'novo' then auth.uid() else situacao_por end
   where id = p_id
  returning situacao into v_depois;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'portal_leads', p_id::text,
          jsonb_build_object('situacao', v_antes),
          jsonb_build_object('assumido', true, 'situacao', v_depois));
  return jsonb_build_object('ok', true, 'situacao', v_depois);
end $$;
comment on function public.portal_lead_assumir(uuid) is
  'Quem chama passa a responder pelo lead do portal; o lead novo vira "em atendimento". Admin, gestor e SDR.';
revoke all on function public.portal_lead_assumir(uuid) from public, anon;
grant execute on function public.portal_lead_assumir(uuid) to authenticated;

-- Descartar não é DELETE (CLAUDE.md, 07/10/2026): o lead fica, com o motivo.
create or replace function public.portal_lead_mudar(p_id uuid, p_situacao text, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes  text;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 300);
begin
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_situacao is null or p_situacao not in ('novo', 'em_atendimento', 'respondido', 'descartado') then
    return jsonb_build_object('ok', false, 'motivo', 'situacao_invalida');
  end if;
  if p_situacao = 'descartado' and char_length(coalesce(v_motivo, '')) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'sem_motivo');
  end if;
  select l.situacao into v_antes from public.portal_leads l where l.id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  update public.portal_leads
     set situacao        = p_situacao,
         motivo_descarte = case when p_situacao = 'descartado' then v_motivo end,
         situacao_em     = now(),
         situacao_por    = auth.uid(),
         -- Quem atende ou responde passa a responder pelo lead, se ninguém respondia.
         responsavel_id  = case when p_situacao in ('em_atendimento', 'respondido')
                                then coalesce(responsavel_id, auth.uid()) else responsavel_id end
   where id = p_id;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'portal_leads', p_id::text,
          jsonb_build_object('situacao', v_antes),
          jsonb_build_object('situacao', p_situacao,
                             'motivo_descarte', case when p_situacao = 'descartado' then v_motivo end));
  return jsonb_build_object('ok', true, 'situacao', p_situacao);
end $$;
comment on function public.portal_lead_mudar(uuid, text, text) is
  'Muda a situação do lead do portal (novo, em atendimento, respondido, descartado). Descartar pede motivo. Admin, gestor e SDR; fica na auditoria.';
revoke all on function public.portal_lead_mudar(uuid, text, text) from public, anon;
grant execute on function public.portal_lead_mudar(uuid, text, text) to authenticated;

-- =====================================================================
-- 5. A lista da tela
-- =====================================================================
-- Telefone e e-mail vêm de `organizations_view`: mascarados para o SDR, com
-- `phone_is_masked`, como em todo o CRM. A conversa é só lida.
create or replace view public.portal_leads_na_lista
with (security_invoker = true) as
select l.id, l.origem, l.origem_no_portal, l.origin_lead_id, l.client_listing_id, l.origin_listing_id,
       l.anuncio_id, l.anuncio_no_canal_pro_id, l.organization_id, l.tipos, l.temperatura,
       l.transacao, l.lead_certo, l.mcmv, l.mensagem, l.link_historico, l.recebido_no_portal_em,
       l.recebido_em, l.situacao, l.responsavel_id, l.motivo_descarte, l.situacao_em,
       l.situacao_por, l.suprimido,
       o.name as ficha_nome,
       o.phone_e164,
       o.phone_is_masked,
       o.email,
       coalesce(a.codigo, m.codigo) as anuncio_codigo,
       coalesce(nullif(btrim(a.titulo), ''), m.titulo) as anuncio_titulo,
       (select c.id from public.conversations c
         where c.organization_id = l.organization_id
         order by c.last_message_at desc nulls last, c.created_at desc
         limit 1) as conversation_id,
       r.full_name as responsavel_nome
  from public.portal_leads l
  left join public.organizations_view o on o.id = l.organization_id
  left join public.anuncios a on a.id = l.anuncio_id
  left join public.anuncios_no_canal_pro m on m.id = l.anuncio_no_canal_pro_id
  left join public.profiles r on r.id = l.responsavel_id;
comment on view public.portal_leads_na_lista is
  'A lista de leads dos portais: o lead, a ficha (nome, telefone e e-mail como organizations_view os mostra a quem lê), o anúncio, a conversa mais recente da ficha e quem responde pelo lead.';
revoke all on public.portal_leads_na_lista from anon;
grant select on public.portal_leads_na_lista to authenticated;

-- A lista de Anúncios ganha, no fim, quantos leads cada anúncio recebeu (os
-- descartados não contam). `create or replace view` só aceita coluna nova no fim.
create or replace view public.anuncios_na_lista
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
       (select count(*) from public.portal_leads l
         where l.anuncio_id = a.id and l.situacao <> 'descartado')::int as leads
  from public.anuncios a
  left join public.organizations_view o on o.id = a.proprietario_id
  left join public.profiles criador on criador.id = a.criado_por;
comment on view public.anuncios_na_lista is
  'A lista de Anúncios: cada anúncio com o número de fotos, a capa, o que falta para ir ao ar, o nome do proprietário e quantos leads dos portais recebeu (sem os descartados).';
revoke all on public.anuncios_na_lista from anon;
grant select on public.anuncios_na_lista to authenticated;

  $ddl$;
end $leads$;

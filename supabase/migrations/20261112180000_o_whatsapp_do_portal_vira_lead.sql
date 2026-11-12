-- =====================================================================
-- O WhatsApp que vem do portal vira lead do portal — só na Imova (12/11/2026)
--
-- A aba Anúncios → Leads mostrava 0 leads: `portal_leads` só era alimentada
-- pelo webhook do Grupo OLX (`grupozap-lead` → `public.grupozap_lead_receber`),
-- e o Grupo OLX ainda não manda lead para o CRM. Mas os leads dos portais JÁ
-- CHEGAM pelo WhatsApp do CRM: a pessoa toca em "WhatsApp" no anúncio do ZAP ou
-- do Viva Real e manda o texto pronto ("Olá! Tenho interesse em casa, ... que
-- encontrei no Zap: https://www.zapimoveis.com.br/imovel/...-id-123/. Código
-- da oferta: PT0001_IMOVA. Código do anúncio no Zap: 2812345678"). O canal de
-- chegada (20261109220000) já reconhece isso — `chegadas` com o canal
-- `anuncios` e o subcanal `portal_zap`/`portal_vivareal` — e nunca virava lead.
-- Agora:
--
--   1. TODA CHEGADA DE PORTAL VIRA UM LEAD, e um só: a chegada cujo canal que
--      vale (gente vence, depois regra ou IA) é Anúncios com o subcanal ZAP
--      Imóveis, Viva Real, OLX ou Canal Pro. Chave estável: `origem =
--      'whatsapp'` e `origin_lead_id = 'whatsapp:<id da chegada>'` (o mesmo
--      unique (origem, origin_lead_id) do webhook). O lead:
--        * tem o tipo próprio `WHATSAPP_DO_PORTAL` (e não CLICK_WHATSAPP, que é
--          o toque que o Grupo OLX avisa e cai em "Clicaram e não chamaram");
--        * entra em "Mandaram mensagem", com `escreveu_em` e `recebido_em` =
--          início da chegada (a primeira mensagem da pessoa); não tem
--          `recebido_no_portal_em`, porque o portal não avisou nada;
--        * liga ao anúncio pelo código do texto pronto ("Código da oferta: X",
--          "Código do anúncio: X"), primeiro como `grupozap_lead_receber` casa
--          o clientListingId (o código exato em `anuncios`, depois no relatório
--          do Canal Pro) e, sem achar, pelo mesmo código sem o sufixo
--          (`_IMOVA`), sem zeros à esquerda, sem caixa e sem pontuação
--          (`app.portal_codigo_chave`: "PT0001_IMOVA" = "PT0001", "BRISA MALL -
--          loja 2" = "Brisa Mall - Loja 02"); o número do anúncio no portal
--          ("Código do anúncio no Zap: 2812345678", ou o "-id-" do link) vai
--          para `origin_listing_id`, como o originListingId do webhook;
--        * diz de qual portal veio (`portal_leads.portal`: zap, vivareal, olx;
--          o webhook não diz, e fica nulo nele);
--        * liga à conversa (`conversation_id`, gravado na hora) e ao contato do
--          jeito dos outros: o telefone da conversa vai para
--          `portal_lead_contatos` (só a gestão lê; o SDR vê mascarado e revela
--          pelo botão), com o nome do perfil do WhatsApp; a ficha é a que a
--          conversa tem (a ficha automática do WhatsApp), e ganha a atividade
--          "Lead do portal". Telefone ou ficha que pediu para não ser
--          contatada: o lead fica, marcado como suprimido, sem contato nem
--          conversa — como o webhook faz.
--
--   2. QUANDO. Um gatilho em `chegadas` (depois de gravar, só quando o canal
--      Anúncios entra ou sai, ou o código muda) cria o lead na mesma hora em
--      que a etiqueta aparece. Ele engole qualquer erro (`raise warning`) e é
--      barato (lê a conversa pela chave e até 5 mensagens pelo índice da
--      conversa): a gravação da chegada nunca falha nem espera por causa do
--      lead. A rotina `portal_leads_do_whatsapp` (pg_cron, a cada 5 minutos)
--      refaz o que o gatilho não fez (erro engolido), liga a ficha que a ficha
--      automática criou depois e, nesta migração, preenche as chegadas antigas.
--
--   3. A CORREÇÃO DE GENTE. `public.chegada_marcar` para Anúncios com um
--      subcanal de portal cria o lead (pelo mesmo gatilho). Desmarcar (ou a IA
--      trocar uma regra fraca por outro canal): o lead que ninguém mexeu
--      (situação "novo", sem responsável) é ESCONDIDO da lista
--      (`escondido_em`, com o motivo), sem apagar nada; o que alguém já
--      assumiu, mudou ou descartou fica como está, porque alguém já agiu sobre
--      ele. Marcar portal de novo traz o escondido de volta.
--
--   4. SEM LEAD DOBRADO. Quando o Grupo OLX passar a mandar o CLICK_WHATSAPP da
--      mesma pessoa (mesmo telefone, ou a mesma conversa já gravada, com o
--      clique entre 24 h antes e 15 min depois do início da chegada — a janela
--      do comentário de `app.canal_sinal_do_portal`), os dois leads ficam no
--      banco e a LISTA mostra um só (`portal_leads_na_lista`): o que alguém já
--      mexeu; empatado, o que chegou primeiro; empatado, o do Grupo OLX. O que
--      fica mostra o portal do par. Juntar no banco pediria mexer em
--      `grupozap_lead_receber` (o caminho do webhook) e decidir qual apagar;
--      esconder na leitura não toca o webhook e vale nos dois sentidos (o
--      clique antes ou depois da mensagem). A conta da lista de Anúncios lê a
--      mesma lista, então não conta dobrado.
--
--   5. SEM AVISO DOBRADO. A mensagem de WhatsApp já avisa a equipe pelo aviso
--      de mensagem nova, na hora. O lead que nasce dela NÃO entra no aviso
--      "Lead novo dos portais" (`app.avisos_push_varrer_leads` passa a deixar
--      de fora `origem = 'whatsapp'`); o cartão do site (`vigia-de-leads.tsx`)
--      faz o mesmo filtro.
--
-- ===========================================================================
-- O WHATSAPP NÃO É TOCADO
-- ===========================================================================
-- Nenhum gatilho, índice ou escrita em `messages` ou `conversations`, e nenhuma
-- chave estrangeira de `portal_leads` para elas: a conversa e as mensagens são
-- só LIDAS. Nada envia mensagem nem enfileira envio. O gatilho novo é em
-- `chegadas`, que já é do canal de chegada (e a chave estrangeira nova aponta
-- para `chegadas`).
--
-- SÓ DA IMOVA, no padrão dos Anúncios e do canal de chegada: no banco da KOMUNE
-- esta migração não cria nada (só o aviso); num banco sem identidade (CI, db
-- reset) tudo é criado; mesmo criado, só cria lead com identidade "imova".
--
-- COMO DESFAZER (no banco da Imova):
--   select cron.unschedule('portal_leads_do_whatsapp');
--   drop trigger chegadas_lead_do_portal on public.chegadas;
--   drop trigger chegadas_lead_do_portal_ao_nascer on public.chegadas;
--   reaplicar a seção 5 (a lista) da 20261105130000 e a seção 3
--   (app.avisos_push_varrer_leads) da 20261111120000;
--   drop das funções app.portal_lead_da_chegada_gatilho(),
--   app.portal_leads_do_whatsapp(int), app.portal_lead_da_chegada(uuid),
--   app.portal_lead_anuncio_pelo_codigo(text), app.portal_codigo_no_texto(text),
--   app.portal_codigo_chave(text);
--   os leads com origem 'whatsapp' podem ficar (escondidos: update ... set
--   escondido_em = now() where origem = 'whatsapp') ou sair com as colunas
--   portal, chegada_id, escondido_em e motivo_escondido.
-- =====================================================================

do $whatsapp$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os leads dos portais são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. O que o lead do WhatsApp guarda a mais
-- =====================================================================
alter table public.portal_leads add column if not exists portal text
  check (portal in ('zap', 'vivareal', 'olx'));
alter table public.portal_leads add column if not exists chegada_id uuid
  references public.chegadas (id) on delete set null;
alter table public.portal_leads add column if not exists escondido_em timestamptz;
alter table public.portal_leads add column if not exists motivo_escondido text
  check (char_length(motivo_escondido) <= 300);
create index if not exists portal_leads_chegada_idx on public.portal_leads (chegada_id)
  where chegada_id is not null;
comment on column public.portal_leads.portal is
  'De qual portal o lead veio: zap, vivareal ou olx. Só o lead que nasce da conversa de WhatsApp sabe (o subcanal da chegada); o webhook do Grupo OLX não diz (12/11/2026).';
comment on column public.portal_leads.chegada_id is
  'A chegada de WhatsApp de que o lead nasceu (origem = whatsapp). Chave estrangeira para chegadas, nunca para conversations.';
comment on column public.portal_leads.escondido_em is
  'O lead do WhatsApp cuja chegada deixou de ser de portal (correção de gente ou a IA no lugar de uma regra fraca) e que ninguém tinha mexido sai da lista, sem apagar. Volta (nulo) se a chegada voltar a ser de portal.';
comment on column public.portal_leads.motivo_escondido is
  'Por que o lead saiu da lista ("A chegada passou a ser Placa").';

-- =====================================================================
-- 2. O código do anúncio no texto pronto, e o anúncio dele
-- =====================================================================
-- "Código da oferta: PT0001_IMOVA" (ZAP e Viva Real) ou "Código do anúncio:
-- BRISA MALL - loja 2". "Código do anúncio no Zap: 2812345678" é o número do
-- PORTAL (o originListingId), não o nosso: o ":" logo depois de "anúncio" o
-- deixa de fora. O código vai até o fim da linha, da frase (". ") ou do
-- próximo "Código". Diferente do `chegadas.codigo_do_anuncio`, aceita espaço e
-- acento, como o código do Canal Pro (decisão de 05/11).
create or replace function app.portal_codigo_no_texto(p_texto text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  v := substring(coalesce(p_texto, '')
                 from '(?i)c[oó]digo d[ao] (?:oferta|an[uú]ncio|im[oó]vel)\s*:\s*([^\n\r]+)');
  if v is null then
    return null;
  end if;
  v := regexp_replace(v, '\s+c[oó]digo\s.*$', '', 'i');
  v := regexp_replace(v, '\.\s.*$', '');
  v := btrim(regexp_replace(v, '[\s.,;:!?)"]+$', ''));
  v := regexp_replace(v, '\s+', ' ', 'g');
  if char_length(v) < 2 or char_length(v) > 100 then
    return null;
  end if;
  return v;
end $$;
comment on function app.portal_codigo_no_texto(text) is
  'O código do anúncio da Imova no texto pronto do portal ("Código da oferta: X", "Código do anúncio: X"), sem o número do portal ("Código do anúncio no Zap: N"). Nulo quando não há.';

-- A chave de comparação de um código: maiúsculo, sem acento, sem o sufixo do
-- sistema antigo ("_IMOVA"), sem pontuação nem espaço, sem zero à esquerda em
-- cada número. "PT0001_IMOVA" e "PT0001" dão "PT1"; "Brisa Mall - Loja 02" e
-- "BRISA MALL - loja 2" dão "BRISAMALLLOJA2".
create or replace function app.portal_codigo_chave(p_codigo text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(upper(extensions.unaccent(btrim(coalesce(p_codigo, '')))), '_[A-Z]+$', ''),
               '[^A-Z0-9]+', ' ', 'g'),
             '(^|[^0-9])0+([0-9])', '\1\2', 'g'),
           ' ', ''), '')
$$;
comment on function app.portal_codigo_chave(text) is
  'A chave para casar o código do texto pronto com o do anúncio: sem caixa, acento, sufixo (_IMOVA), pontuação e zeros à esquerda.';
-- Só as funções do banco usam as duas (pgTAP 09: anon não executa nada do app).
revoke all on function app.portal_codigo_no_texto(text) from public, anon, authenticated;
revoke all on function app.portal_codigo_chave(text) from public, anon, authenticated;

-- O anúncio do código, como `grupozap_lead_receber` casa o clientListingId:
-- primeiro o código exato nos anúncios do CRM, depois no relatório do Canal Pro
-- (o trazido para o CRM aponta o anúncio); sem achar, pela chave.
create or replace function app.portal_lead_anuncio_pelo_codigo(p_codigo text,
                                                              out anuncio_id uuid,
                                                              out anuncio_no_canal_pro_id uuid,
                                                              out negocio text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cod     text := nullif(btrim(coalesce(p_codigo, '')), '');
  v_chave   text := app.portal_codigo_chave(p_codigo);
  v_trazido uuid;
begin
  if v_cod is null then
    return;
  end if;
  select a.id into anuncio_id from public.anuncios a
   where a.codigo = v_cod and a.excluido_em is null;
  select m.id, m.anuncio_id into anuncio_no_canal_pro_id, v_trazido
    from public.anuncios_no_canal_pro m
   where m.codigo = v_cod;
  if anuncio_id is null and anuncio_no_canal_pro_id is null and v_chave is not null then
    select a.id into anuncio_id from public.anuncios a
     where a.excluido_em is null and app.portal_codigo_chave(a.codigo) = v_chave
     order by (a.situacao = 'no_ar') desc, a.updated_at desc
     limit 1;
    select m.id, m.anuncio_id into anuncio_no_canal_pro_id, v_trazido
      from public.anuncios_no_canal_pro m
     where app.portal_codigo_chave(m.codigo) = v_chave
     order by (m.anuncio_id is not null) desc, m.visto_em desc nulls last
     limit 1;
  end if;
  if anuncio_id is null and v_trazido is not null
     and exists (select 1 from public.anuncios a where a.id = v_trazido and a.excluido_em is null) then
    anuncio_id := v_trazido;
  end if;
  if anuncio_id is not null then
    select a.negocio into negocio from public.anuncios a where a.id = anuncio_id;
  end if;
end $$;
comment on function app.portal_lead_anuncio_pelo_codigo(text) is
  'O anúncio de um código: o exato em anuncios (vivo), depois em anuncios_no_canal_pro (o trazido aponta o do CRM), e sem achar pela chave de app.portal_codigo_chave. Devolve também o negócio (venda, aluguel).';
revoke all on function app.portal_lead_anuncio_pelo_codigo(text) from public, anon, authenticated;

-- =====================================================================
-- 3. A chegada vira lead
-- =====================================================================
-- Os subcanais de portal: ZAP, Viva Real, OLX e o Canal Pro sem dizer qual.
create or replace function app.portal_lead_da_chegada(p_chegada_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch          public.chegadas%rowtype;
  v_sub       text;
  v_portal    text;
  v_chave     text := 'whatsapp:' || p_chegada_id::text;
  v_lead      public.portal_leads%rowtype;
  cv          record;
  m           record;
  v_cod       text;
  v_cod_port  text;
  an          record;
  v_supr      boolean;
  v_trans     text;
  v_id        uuid;
  v_org       uuid;
  v_rotulo    text;
begin
  if (select i.empresa from app.identidade i) is distinct from 'imova' then
    return 'fora_da_imova';
  end if;
  select * into ch from public.chegadas c where c.id = p_chegada_id;
  if not found then
    return 'sem_chegada';
  end if;
  v_sub := case when ch.canal_marcado is not null then ch.subcanal_marcado else ch.subcanal_automatico end;
  select l.* into v_lead from public.portal_leads l
   where l.origem = 'whatsapp' and l.origin_lead_id = v_chave;

  -- ---- Não é (ou deixou de ser) de portal ----
  if ch.canal is distinct from 'anuncios'
     or v_sub is null or v_sub not in ('portal_zap', 'portal_vivareal', 'portal_olx', 'canal_pro') then
    if v_lead.id is null then
      return 'nao_e_portal';
    end if;
    if v_lead.escondido_em is not null then
      return 'ja_escondido';
    end if;
    -- Ninguém mexeu: sai da lista. Alguém já agiu: fica.
    if v_lead.situacao = 'novo' and v_lead.responsavel_id is null then
      update public.portal_leads l
         set escondido_em = now(),
             motivo_escondido = left('A chegada passou a ser '
                                     || coalesce(app.canal_rotulo(ch.canal), 'sem canal')
                                     || case when ch.canal_marcado is not null then ' (corrigida por gente)'
                                             else '' end, 300)
       where l.id = v_lead.id and l.escondido_em is null;
      return 'escondido';
    end if;
    return 'mantido';
  end if;

  v_portal := case v_sub when 'portal_zap' then 'zap' when 'portal_vivareal' then 'vivareal'
                         when 'portal_olx' then 'olx' end;

  -- ---- O código do anúncio e o número do portal, no texto da pessoa ----
  for m in
    select mm.body
      from public.messages mm
     where mm.conversation_id = ch.conversation_id
       and mm.direction = 'in'::app.msg_direction
       and mm.created_at >= ch.inicio_em
       and mm.created_at < ch.inicio_em + interval '24 hours'
       and mm.apagada_em is null
       and mm.body ~* '(c[oó]digo d[ao] |zapimoveis\.com\.br|vivareal\.com\.br)'
     order by mm.created_at, mm.id
     limit 5
  loop
    v_cod := coalesce(v_cod, app.portal_codigo_no_texto(m.body));
    v_cod_port := coalesce(v_cod_port,
      substring(m.body from '(?i)c[oó]digo do an[uú]ncio n[ao] (?:zap|viva ?real|olx)[^:\n]{0,20}:\s*([0-9A-Za-z_-]{3,40})'),
      substring(m.body from '(?i)(?:zapimoveis|vivareal)\.com\.br/[^\s]*-id-([0-9]{5,15})'));
  end loop;
  v_cod := left(coalesce(v_cod, ch.codigo_do_anuncio), 100);
  select * into an from app.portal_lead_anuncio_pelo_codigo(v_cod);
  v_trans := case an.negocio when 'venda' then 'SELL' when 'aluguel' then 'RENT' end;

  -- ---- Já existe: o portal acompanha a chegada, o código só completa ----
  if v_lead.id is not null then
    update public.portal_leads l
       set portal           = coalesce(v_portal, l.portal),
           escondido_em     = null,
           motivo_escondido = null,
           client_listing_id = coalesce(l.client_listing_id, v_cod),
           origin_listing_id = coalesce(l.origin_listing_id, left(v_cod_port, 100)),
           anuncio_id       = case when l.client_listing_id is null then an.anuncio_id else l.anuncio_id end,
           anuncio_no_canal_pro_id = case when l.client_listing_id is null then an.anuncio_no_canal_pro_id
                                          else l.anuncio_no_canal_pro_id end,
           transacao        = coalesce(l.transacao, v_trans)
     where l.id = v_lead.id
       and (l.portal is distinct from coalesce(v_portal, l.portal)
            or l.escondido_em is not null
            or (l.client_listing_id is null and v_cod is not null)
            or (l.origin_listing_id is null and v_cod_port is not null));
    return case when v_lead.escondido_em is not null then 'de_volta' else 'ja_existia' end;
  end if;

  -- ---- O lead novo ----
  select c.peer_phone_e164, c.peer_nome, c.organization_id, c.contact_id into cv
    from public.conversations c where c.id = ch.conversation_id;
  v_supr := (cv.peer_phone_e164 is not null and app.is_suppressed(cv.peer_phone_e164))
            or coalesce(app.is_suppressed_target(cv.organization_id, cv.contact_id), false);
  v_org := case when v_supr then null else cv.organization_id end;

  insert into public.portal_leads as l
    (origem, origin_lead_id, client_listing_id, origin_listing_id, anuncio_id, anuncio_no_canal_pro_id,
     organization_id, conversation_id, chegada_id, portal, tipos, transacao, recebido_em, escreveu_em,
     suprimido, payload)
  values
    ('whatsapp', v_chave, v_cod, left(v_cod_port, 100), an.anuncio_id, an.anuncio_no_canal_pro_id,
     v_org, case when v_supr then null else ch.conversation_id end, ch.id, v_portal,
     array['WHATSAPP_DO_PORTAL'], v_trans, ch.inicio_em, ch.inicio_em, v_supr,
     jsonb_strip_nulls(jsonb_build_object(
       'chegada_id', ch.id, 'subcanal', v_sub,
       'decidido_por', case when ch.canal_marcado is not null then 'gente' else ch.decidido_por end,
       'regra', case when ch.canal_marcado is null then ch.regra_slug end,
       'codigo_da_chegada', ch.codigo_do_anuncio)))
  on conflict (origem, origin_lead_id) do nothing
  returning l.id into v_id;
  if v_id is null then
    return 'ja_existia';
  end if;

  if not v_supr then
    insert into public.portal_lead_contatos (lead_id, nome, telefone_e164)
    values (v_id, left(nullif(btrim(regexp_replace(coalesce(cv.peer_nome, ''), '\s+', ' ', 'g')), ''), 120),
            cv.peer_phone_e164)
    on conflict (lead_id) do nothing;
  end if;

  if v_org is not null then
    v_rotulo := case v_portal when 'zap' then ' pelo ZAP Imóveis' when 'vivareal' then ' pelo Viva Real'
                              when 'olx' then ' pela OLX' else ' pelo portal' end;
    insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata, occurred_at)
    values ('system', v_org, app.wa_negocio_da_ficha(v_org), null, 'system',
            format('Lead do portal: anúncio %s (mandou mensagem no WhatsApp%s)', coalesce(v_cod, 'sem código'), v_rotulo),
            jsonb_build_object('origin', 'portal_lead', 'portal_lead_id', v_id, 'tipo', 'WHATSAPP_DO_PORTAL',
                               'chegada_id', ch.id),
            ch.inicio_em);
  end if;
  return 'criado';
end $$;
comment on function app.portal_lead_da_chegada(uuid) is
  'A chegada de WhatsApp de portal (Anúncios: ZAP, Viva Real, OLX, Canal Pro; gente vence) vira UM lead do portal (origem whatsapp, chave whatsapp:<chegada>), ligado ao anúncio pelo código do texto pronto, à conversa e ao telefone (portal_lead_contatos). Chegada que deixou de ser de portal esconde o lead que ninguém mexeu. Só na Imova. Só lê messages e conversations.';
revoke all on function app.portal_lead_da_chegada(uuid) from public, anon, authenticated;

-- O gatilho de `chegadas`: nunca deixa a chegada falhar por causa do lead.
create or replace function app.portal_lead_da_chegada_gatilho()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.portal_lead_da_chegada(new.id);
  exception when others then
    raise warning 'portal_lead_da_chegada(%): %', new.id, sqlerrm;
  end;
  return null;
end $$;
comment on function app.portal_lead_da_chegada_gatilho() is
  'Gatilho de public.chegadas (depois de gravar): chama app.portal_lead_da_chegada e engole qualquer erro, para a chegada nunca falhar por causa do lead.';
revoke all on function app.portal_lead_da_chegada_gatilho() from public, anon, authenticated;

drop trigger if exists chegadas_lead_do_portal on public.chegadas;
create trigger chegadas_lead_do_portal
  after update of canal_automatico, subcanal_automatico, canal_marcado, subcanal_marcado, codigo_do_anuncio
  on public.chegadas
  for each row
  when ((new.canal = 'anuncios' or old.canal = 'anuncios')
        and (new.canal_automatico, new.subcanal_automatico, new.canal_marcado, new.subcanal_marcado,
             new.codigo_do_anuncio)
            is distinct from
            (old.canal_automatico, old.subcanal_automatico, old.canal_marcado, old.subcanal_marcado,
             old.codigo_do_anuncio))
  execute function app.portal_lead_da_chegada_gatilho();
drop trigger if exists chegadas_lead_do_portal_ao_nascer on public.chegadas;
create trigger chegadas_lead_do_portal_ao_nascer
  after insert on public.chegadas
  for each row
  when (new.canal = 'anuncios')
  execute function app.portal_lead_da_chegada_gatilho();

-- =====================================================================
-- 4. A rotina: refaz o que o gatilho não fez e liga a ficha que veio depois
-- =====================================================================
create or replace function app.portal_leads_do_whatsapp(p_limite int default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_ret     text;
  n_criados int := 0;
  n_mudados int := 0;
  n_erros   int := 0;
  n_fichas  int := 0;
begin
  if (select i.empresa from app.identidade i) is distinct from 'imova' then
    return jsonb_build_object('ligada', false);
  end if;

  -- 1. A chegada de portal sem lead na lista (sem lead, ou com o lead
  --    escondido), e o lead na lista cuja chegada deixou de ser de portal.
  for v_id in
    select x.id from (
      select c.id
        from public.chegadas c
       where c.canal = 'anuncios'
         and (case when c.canal_marcado is not null then c.subcanal_marcado else c.subcanal_automatico end)
             in ('portal_zap', 'portal_vivareal', 'portal_olx', 'canal_pro')
         and not exists (select 1 from public.portal_leads l
                          where l.origem = 'whatsapp' and l.origin_lead_id = 'whatsapp:' || c.id::text
                            and l.escondido_em is null)
      union
      -- (só o que ninguém mexeu: o que alguém mexeu fica, e não precisa ser olhado de novo)
      select c.id
        from public.portal_leads l
        join public.chegadas c on c.id = l.chegada_id
       where l.origem = 'whatsapp' and l.escondido_em is null
         and l.situacao = 'novo' and l.responsavel_id is null
         and not (c.canal is not distinct from 'anuncios'
                  and (case when c.canal_marcado is not null then c.subcanal_marcado else c.subcanal_automatico end)
                      in ('portal_zap', 'portal_vivareal', 'portal_olx', 'canal_pro'))
    ) x
    limit greatest(coalesce(p_limite, 500), 1)
  loop
    begin
      v_ret := app.portal_lead_da_chegada(v_id);
      if v_ret = 'criado' then
        n_criados := n_criados + 1;
      elsif v_ret in ('escondido', 'de_volta') then
        n_mudados := n_mudados + 1;
      end if;
    exception when others then
      n_erros := n_erros + 1;
      raise warning 'portal_leads_do_whatsapp(%): %', v_id, sqlerrm;
    end;
  end loop;

  -- 2. A ficha que a ficha automática criou depois do lead: grava, com a
  --    atividade "Lead do portal" (como app.portal_leads_manter faz).
  with achadas as (
    select l.id, c.organization_id, l.client_listing_id, l.portal, l.escreveu_em, l.chegada_id
      from public.portal_leads l
      join public.conversations c on c.id = l.conversation_id
     where l.origem = 'whatsapp' and l.organization_id is null and not l.suprimido
       and c.organization_id is not null
       and not coalesce(app.is_suppressed_target(c.organization_id, null), false)
  ), gravadas as (
    update public.portal_leads l
       set organization_id = a.organization_id
      from achadas a
     where l.id = a.id and l.organization_id is null
    returning l.id, a.organization_id, a.client_listing_id, a.portal, a.escreveu_em, a.chegada_id
  ), atividades as (
    insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata, occurred_at)
    select 'system', g.organization_id, app.wa_negocio_da_ficha(g.organization_id), null, 'system',
           format('Lead do portal: anúncio %s (mandou mensagem no WhatsApp%s)',
                  coalesce(g.client_listing_id, 'sem código'),
                  case g.portal when 'zap' then ' pelo ZAP Imóveis' when 'vivareal' then ' pelo Viva Real'
                                when 'olx' then ' pela OLX' else ' pelo portal' end),
           jsonb_build_object('origin', 'portal_lead', 'portal_lead_id', g.id, 'tipo', 'WHATSAPP_DO_PORTAL',
                              'chegada_id', g.chegada_id),
           coalesce(g.escreveu_em, now())
      from gravadas g
    returning 1
  )
  select count(*) into n_fichas from gravadas;

  return jsonb_build_object('ligada', true, 'criados', n_criados, 'mudados', n_mudados,
                            'fichas', n_fichas, 'erros', n_erros);
end $$;
comment on function app.portal_leads_do_whatsapp(int) is
  'A cada 5 minutos (pg_cron portal_leads_do_whatsapp), só na Imova: cria o lead da chegada de portal que ainda não tem (o gatilho engoliu um erro, ou a chegada é de antes desta migração), esconde o que deixou de ser de portal, e grava a ficha que a ficha automática criou depois, com a atividade "Lead do portal". Só lê messages e conversations.';
revoke all on function app.portal_leads_do_whatsapp(int) from public, anon, authenticated;

-- =====================================================================
-- 5. A lista: o lead do WhatsApp, e o par com o webhook visto uma vez só
-- =====================================================================
-- A da 20261105130000, com quatro mudanças marcadas "12/11/2026": o escondido
-- fica de fora; o par (lead do WhatsApp × aviso do Grupo OLX da mesma pessoa)
-- aparece uma vez só; o lead do WhatsApp é "mensagem" e chega "pelo WhatsApp"
-- mesmo antes de a conversa ser achada; e a coluna `portal`, no fim.
create or replace view public.portal_leads_na_lista
with (security_barrier = true, security_invoker = false) as
with todos as (
  select l.*, k.nome as k_nome, k.telefone_e164 as k_tel, k.email as k_email,
         coalesce(l.recebido_no_portal_em, l.recebido_em) as clicou_em,
         (l.situacao <> 'novo' or l.responsavel_id is not null) as mexido
    from public.portal_leads l
    left join public.portal_lead_contatos k on k.lead_id = l.id
   where (select app.is_manager())
     -- 12/11/2026: o lead do WhatsApp cuja chegada deixou de ser de portal.
     and l.escondido_em is null
),
pares as (
  -- 12/11/2026: a mesma pessoa pelos dois caminhos. Fica o que alguém mexeu;
  -- empatado, o que chegou primeiro; empatado, o do Grupo OLX.
  select w.id as do_whatsapp, g.id as do_grupo_olx, w.portal,
         case when w.mexido <> g.mexido then w.mexido
              else w.recebido_em < g.recebido_em end as fica_o_do_whatsapp
    from todos w
    join todos g
      on g.origem = 'grupo_olx'
     and ((g.conversation_id is not null and g.conversation_id = w.conversation_id)
          or (g.k_tel is not null and g.k_tel = w.k_tel))
     and g.clicou_em >= w.escreveu_em - interval '24 hours'
     and g.clicou_em <= w.escreveu_em + interval '15 minutes'
   where w.origem = 'whatsapp'
),
leads as (
  select t.*,
         (select p.portal from pares p
           where p.do_grupo_olx = t.id and p.portal is not null
           order by p.portal limit 1) as portal_do_par
    from todos t
   where not exists (select 1 from pares p
                      where (p.do_whatsapp = t.id and not p.fica_o_do_whatsapp)
                         or (p.do_grupo_olx = t.id and p.fica_o_do_whatsapp))
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
       -- 12/11/2026: o lead do WhatsApp escreveu, mesmo antes de a conversa ser achada.
       case when v.conversation_id is not null or app.portal_lead_mandou_mensagem(l.tipos)
                 or l.origem = 'whatsapp'
            then 'mensagem' else 'clicou' end as grupo,
       case when v.conversation_id is not null or l.origem = 'whatsapp' then 'whatsapp'
            when 'CONTACT_CHAT' = any (l.tipos) then 'chat'
            when 'CONTACT_FORM' = any (l.tipos) then 'formulario'
            when 'VISIT_REQUEST' = any (l.tipos) then 'visita' end as chegou_por,
       coalesce(v.primeira_em, l.clicou_em) as chegou_em,
       case when v.conversation_id is not null then left(pm.body, 280)
            when app.portal_lead_mandou_mensagem(l.tipos) then left(l.mensagem, 280) end as primeira_mensagem,
       case when v.conversation_id is not null then pm.type::text end as primeira_mensagem_tipo,
       coalesce(r.created_at, case when l.situacao = 'respondido' then l.situacao_em end) as respondido_em,
       coalesce(rp.full_name, case when l.situacao = 'respondido' then sp.full_name end) as respondido_por_nome,
       l.contato_apagado_em,
       -- Daqui para baixo, o que a 20261112180000 acrescentou.
       coalesce(l.portal, l.portal_do_par) as portal
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
  'A lista de leads dos portais (só admin, gestor e SDR): o lead, quem é (da ficha ou do que o portal mandou; telefone mascarado para quem não lê o inteiro), o anúncio, a conversa de WhatsApp do mesmo telefone com mensagem depois do clique, a primeira mensagem, a primeira resposta do time, o grupo (mensagem ou clicou) e, desde 12/11/2026, o portal. O lead que nasce do WhatsApp (origem whatsapp) e o aviso do Grupo OLX da mesma pessoa aparecem uma vez só; o escondido não aparece.';
revoke all on public.portal_leads_na_lista from anon;
grant select on public.portal_leads_na_lista to authenticated;

-- =====================================================================
-- 6. O aviso no celular deixa de fora o lead do WhatsApp
-- =====================================================================
-- A da 20261111120000, com a linha marcada "12/11/2026": a mensagem de
-- WhatsApp já avisou todos que atendem pelo aviso de mensagem nova.
create or replace function app.avisos_push_varrer_leads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
  select q.pessoa, 'lead_portal', 'lead_portal:' || l.id || ':' || q.pessoa,
         left('Novo lead: '
              || coalesce(nullif(btrim(o.name), ''), nullif(btrim(k.nome), ''), 'alguém')
              || ' ' || case when 'VISIT_REQUEST' = any (l.tipos) then 'pediu uma visita'
                             when 'CONTACT_FORM' = any (l.tipos) then 'preencheu o formulário'
                             when 'CONTACT_CHAT' = any (l.tipos) then 'mandou mensagem pelo chat'
                             else 'escreveu pelo portal' end
              || coalesce(' · ' || l.client_listing_id, ''), 240),
         '/anuncios/leads?lead=' || l.id
    from public.portal_leads l
    left join public.organizations o on o.id = l.organization_id
    left join public.portal_lead_contatos k on k.lead_id = l.id
   cross join app.avisos_quem_atende() as q (pessoa)
   where l.escreveu_em > now() - interval '2 minutes'
     and not l.suprimido
     and l.situacao <> 'descartado'
     -- 12/11/2026: o lead que nasce da conversa de WhatsApp já avisou como mensagem.
     and l.origem <> 'whatsapp'
  on conflict (chave) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function app.avisos_push_varrer_leads() is
  'Põe na fila o aviso "Novo lead" para todos que atendem, quando um lead do portal acaba de escrever (portal_leads.escreveu_em). O lead que nasce da conversa de WhatsApp (origem whatsapp) fica de fora: a mensagem já avisou (12/11/2026). Chamada por app.avisos_push_rodar, só na Imova.';
revoke all on function app.avisos_push_varrer_leads() from public, anon, authenticated;

-- =====================================================================
-- 7. As chegadas que já existem também viram lead
-- =====================================================================
-- Só faz alguma coisa com identidade "imova" (no CI, sem identidade, nada).
select app.portal_leads_do_whatsapp(100000);

  $ddl$;

  -- O agendamento fica fora do bloco de DDL, como nas outras rotinas.
  if exists (select 1 from cron.job where jobname = 'portal_leads_do_whatsapp') then
    perform cron.unschedule('portal_leads_do_whatsapp');
  end if;
  perform cron.schedule('portal_leads_do_whatsapp', '*/5 * * * *',
                        $cron$select app.portal_leads_do_whatsapp()$cron$);
end $whatsapp$;

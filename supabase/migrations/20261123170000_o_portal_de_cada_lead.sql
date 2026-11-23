-- =====================================================================
-- O portal de cada lead, sempre que se sabe — Leads da Imova (23/11/2026)
--
-- Pedido do usuário: "Quando uma pessoa manda mensagem direto da OLX pelo
-- chat da própria OLX devemos ter o ícone da OLX com a mensagem 'Chegou pelo
-- chat da OLX'. Caso tenha aberto a OLX e enviado mensagem via WhatsApp pela
-- OLX, deve aparecer o ícone da OLX com a mensagem 'Chegou pelo WhatsApp'.
-- Sempre deve aparecer o ícone do portal em que ela enviou a mensagem."
--
-- O aviso do Grupo OLX (webhook `grupozap-lead`) NÃO diz de qual portal veio:
-- `leadOrigin` é sempre "Grupo OLX", e o `originListingId` é o mesmo número no
-- ZAP, no Viva Real e na OLX. A lista já sabia o portal do lead que nasce da
-- conversa de WhatsApp (o texto pronto do ZAP e do Viva Real, o link da OLX) e
-- passava esse portal ao aviso do Grupo OLX da mesma pessoa (o "par"). Faltavam
-- dois casos, os dois vistos em produção:
--
--   1. O CHAT É DA OLX. ZAP Imóveis e Viva Real têm botão de WhatsApp,
--      formulário ("Contatar") e "ver telefone"; só a OLX tem chat ("Mensagem"),
--      e ela não tem botão de WhatsApp (o clique de 06/11/2026, no desenho do
--      canal de chegada, §8.1). O `CONTACT_CHAT` é, então, a OLX: em produção,
--      os dois que chegaram (14/11 e 23/11, SA0012_IMOVA) trazem o texto do
--      chat da OLX ("[MENSAGEM DO CHAT]"). A coluna `portal` da lista passa a
--      dizer 'olx' para ele. Se um dia o ZAP ou o Viva Real ganharem chat, é
--      aqui que se volta.
--
--   2. NA OLX, O WHATSAPP VEM DEPOIS DE "VER TELEFONE". Sem botão de WhatsApp,
--      quem escreve no WhatsApp pela OLX toca em "Ligar" (o Grupo OLX avisa
--      PHONE_VIEW) e manda a mensagem. O par só se formava com CLICK_WHATSAPP,
--      então a mesma pessoa aparecia DUAS vezes: "WhatsApp pela OLX", sem
--      anúncio (o link da OLX não traz o nosso código), e "Pelo WhatsApp", com
--      o anúncio e sem portal (Kívia, 18/11/2026, SA0012_IMOVA: o aviso às
--      08:34:15, a mensagem às 08:34:25, mesmo telefone e mesma conversa). O
--      clique puro em "ver telefone" agora também forma par: continua só o
--      clique PURO (sem chat, formulário, visita nem mensagem do portal), da
--      mesma pessoa, na mesma janela de −24 h a +15 min, do mesmo anúncio
--      quando os dois têm um. O que fica na lista mostra o portal do par.
--
-- O que NÃO muda: nenhuma tabela, nenhum dado gravado, o webhook, o canal de
-- chegada, os avisos e a contagem do relatório (que lê `portal_leads`). As
-- colunas da view são as mesmas, na mesma ordem. Vale nas duas empresas (a da
-- KOMUNE não tem lead nenhum).
--
-- COMO DESFAZER: reaplicar a view `public.portal_leads_na_lista` da
-- 20261113130000 (seção 5), com o comentário dela.
-- =====================================================================

-- A da 20261113130000, com as duas mudanças marcadas "23/11/2026".
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
do_whatsapp as (
  select t.* from todos t where t.origem = 'whatsapp'
),
cliques as (
  select t.* from todos t
   where t.origem = 'grupo_olx'
     -- 23/11/2026: o "ver telefone" também (na OLX, o WhatsApp vem depois dele).
     and t.tipos && array['CLICK_WHATSAPP', 'PHONE_VIEW']::text[]
     and not app.portal_lead_mandou_mensagem(t.tipos)
),
mesma_pessoa as (
  select w.id as w_id, g.id as g_id
    from do_whatsapp w join cliques g on g.k_tel = w.k_tel
  union
  select w.id, g.id
    from do_whatsapp w join cliques g on g.conversation_id = w.conversation_id
),
casados as (
  -- O aviso vai para o lead do WhatsApp mais perto no tempo.
  select mp.w_id, mp.g_id,
         row_number() over (partition by mp.g_id
                            order by abs(extract(epoch from g.clicou_em - w.escreveu_em)), w.id) as n
    from mesma_pessoa mp
    join do_whatsapp w on w.id = mp.w_id
    join cliques g on g.id = mp.g_id
   where g.clicou_em >= w.escreveu_em - interval '24 hours'
     and g.clicou_em <= w.escreveu_em + interval '15 minutes'
     and ((w.anuncio_id is null and w.anuncio_no_canal_pro_id is null)
          or (g.anuncio_id is null and g.anuncio_no_canal_pro_id is null)
          or w.anuncio_id = g.anuncio_id
          or w.anuncio_no_canal_pro_id = g.anuncio_no_canal_pro_id)
),
grupos as (
  select c.w_id, c.g_id as lead_id from casados c where c.n = 1
  union
  select c.w_id, c.w_id from casados c where c.n = 1
),
ordem as (
  select gr.w_id, gr.lead_id,
         row_number() over (partition by gr.w_id
                            order by t.mexido desc, t.recebido_em, (t.origem = 'grupo_olx') desc, t.id) as pos
    from grupos gr
    join todos t on t.id = gr.lead_id
),
leads as (
  select t.*,
         -- O aviso do Grupo OLX que ficou no lugar do par mostra o portal do lead do WhatsApp.
         (select w.portal from ordem o join do_whatsapp w on w.id = o.w_id
           where o.lead_id = t.id and t.origem = 'grupo_olx'
           limit 1) as portal_do_par
    from todos t
   where not exists (select 1 from ordem o where o.lead_id = t.id and o.pos > 1)
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
       -- Daqui para baixo, o que a 20261113130000 acrescentou.
       -- 23/11/2026: o chat do portal é o chat da OLX (ZAP e Viva Real não têm chat).
       coalesce(l.portal, l.portal_do_par,
                case when 'CONTACT_CHAT' = any (l.tipos) then 'olx' end) as portal
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
  'A lista de leads dos portais (só admin, gestor e SDR): o lead, quem é (da ficha ou do que o portal mandou; telefone mascarado para quem não lê o inteiro), o anúncio, a conversa de WhatsApp do mesmo telefone com mensagem depois do clique, a primeira mensagem, a primeira resposta do time, o grupo (mensagem ou clicou) e o portal (o do lead do WhatsApp, o do par, ou a OLX para o chat, desde 23/11/2026). O lead que nasce do WhatsApp (origem whatsapp) e o aviso de clique puro do Grupo OLX da mesma pessoa (WhatsApp ou ver telefone, desde 23/11/2026) aparecem uma vez só; o escondido não aparece.';
revoke all on public.portal_leads_na_lista from anon;
grant select on public.portal_leads_na_lista to authenticated;

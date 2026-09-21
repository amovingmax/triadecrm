-- =====================================================================
-- Fase 5 — Campanhas: o público ganha o filtro por setor
--
-- Plano aprovado pelo Rafael em 21/09/2026: campanha numa tela só, com
-- segmentação por etiqueta (já existia no banco, faltava a tela) e por setor
-- (novo aqui). Recriada a partir da definição viva de `app.envio_publico`; o
-- que mudou está marcado com "NOVO".
-- =====================================================================
CREATE OR REPLACE FUNCTION app.envio_publico(p_filtro jsonb)
 RETURNS TABLE(organization_id uuid, nome text, tipo text, categoria text, cidade text, etapa text, responsavel text, temperatura text, situacao text, cadastrado_komune boolean, ultimo_envio timestamp with time zone, bloqueio text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  f        jsonb := coalesce(p_filtro, '{}'::jsonb);
  v_numero text  := app.wa_numero_padrao();
  v_sit    text[] := array(select jsonb_array_elements_text(f -> 'situacoes'));
  v_tipos  text[] := array(select jsonb_array_elements_text(f -> 'tipos'));
  v_funis  int[]  := array(select jsonb_array_elements_text(f -> 'funis')::int);
  v_etapas int[]  := array(select jsonb_array_elements_text(f -> 'etapas')::int);
  v_cats   int[]  := array(select jsonb_array_elements_text(f -> 'categorias')::int);
  v_cids   int[]  := array(select jsonb_array_elements_text(f -> 'cidades')::int);
  v_resp   uuid[] := array(select jsonb_array_elements_text(f -> 'responsaveis')::uuid);
  v_temps  text[] := array(select jsonb_array_elements_text(f -> 'temperaturas'));
  v_tags   int[]  := array(select jsonb_array_elements_text(f -> 'tags')::int);
  -- NOVO (Fase 5): o setor da conversa de WhatsApp do parceiro.
  v_setores int[] := array(select jsonb_array_elements_text(f -> 'setores')::int);
  v_dias   int    := nullif(f ->> 'sem_contato_ha_dias', '')::int;
  v_busca  text   := nullif(btrim(coalesce(f ->> 'busca', '')), '');
begin
  return query
  with base as (
    select o.*, d.telefone, d.contact_id as contato_id
      from public.organizations o
      cross join lateral app.wa_destino_da_ficha(o.id) d
     where o.deleted_at is null
       and o.anonymized_at is null
       and app.org_is_visible(o.id)
       and (cardinality(v_tipos) = 0 or o.kind::text = any (v_tipos))
       and (cardinality(v_cids)  = 0 or o.city_id = any (v_cids))
       and (cardinality(v_resp)  = 0 or o.owner_id = any (v_resp))
       and (cardinality(v_temps) = 0 or o.temperature::text = any (v_temps))
       and (v_busca is null or o.search_name like '%' || app.search_name(v_busca) || '%')
       and (cardinality(v_cats) = 0 or exists (
             select 1 from public.organization_categories oc
              where oc.organization_id = o.id and oc.category_id = any (v_cats)))
       and (cardinality(v_tags) = 0 or exists (
             select 1 from public.organization_tags ot
              where ot.organization_id = o.id and ot.tag_id = any (v_tags)))
       and ((cardinality(v_funis) = 0 and cardinality(v_etapas) = 0) or exists (
             select 1 from public.deals dl
              where dl.organization_id = o.id and dl.status = 'open'::app.deal_status
                and (cardinality(v_funis)  = 0 or dl.pipeline_id = any (v_funis))
                and (cardinality(v_etapas) = 0 or dl.stage_id = any (v_etapas))))
  ),
  com_conversa as (
    select b.*, c.id as conversa_id, c.last_inbound_at,
           app.janela_de_24h_aberta(c.id, now()) as janela,
           (select max(coalesce(m.sent_at, m.created_at)) from public.messages m
             where m.conversation_id = c.id and m.direction = 'out'::app.msg_direction
               and m.status <> 'failed'::app.msg_status) as ultimo_out
      from base b
      left join public.conversations c
        on c.channel = 'whatsapp'::app.channel and c.business_number = v_numero
       and c.peer_phone_e164 = b.telefone
     -- NOVO (Fase 5): quem ainda não tem conversa não tem setor, e sai do recorte.
     where cardinality(v_setores) = 0 or c.setor_id = any (v_setores)
  ),
  classificado as (
    select cc.*,
           case when cc.janela then 'janela_aberta'
                when cc.last_inbound_at is not null then 'ja_conversou'
                when cc.ultimo_out is not null then 'sem_resposta'
                else 'nunca_contatado' end as sit,
           (cc.komune_supplier_id is not null or exists (
              select 1 from public.pre_registrations pr
               where pr.organization_id = cc.id
                 and (pr.claimed_at is not null or pr.published))) as na_komune
      from com_conversa cc
  )
  select k.id, k.name, k.kind::text,
         (select c.name from public.organization_categories oc
            join public.categories c on c.id = oc.category_id
           where oc.organization_id = k.id order by oc.is_primary desc, oc.created_at limit 1),
         (select ci.name from public.cities ci where ci.id = k.city_id),
         (select s.name from public.deals dl join public.stages s on s.id = dl.stage_id
           where dl.organization_id = k.id and dl.status = 'open'::app.deal_status
           order by dl.updated_at desc limit 1),
         (select p.full_name from public.profiles p where p.id = k.owner_id),
         k.temperature::text,
         k.sit, k.na_komune, k.ultimo_out,
         case when k.telefone is null then 'sem_whatsapp'
              else app.wa_motivo_de_recusa(k.id, k.contato_id, k.telefone) end
    from classificado k
   where (cardinality(v_sit) = 0
          or k.sit = any (v_sit)
          or ('cadastrado_komune' = any (v_sit) and k.na_komune)
          -- "já conversou" inclui quem está com a janela aberta: ter a janela
          -- aberta é ter conversado há menos de 24 h.
          or ('ja_conversou' = any (v_sit) and k.sit = 'janela_aberta'))
     and (v_dias is null or k.ultimo_out is null or k.ultimo_out < now() - make_interval(days => v_dias))
   order by k.name
   limit 2000;
end $function$;

revoke all on function app.envio_publico(jsonb) from public, anon, authenticated;

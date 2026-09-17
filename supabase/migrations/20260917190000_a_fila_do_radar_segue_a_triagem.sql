-- =====================================================================
-- A fila do Radar passa a ser ordenada pela triagem
--
-- A pontuação existia desde a migração 20260917180000 e ninguém a via: a fila
-- devolvia `pontuacao` (sempre nula até ontem) e ordenava por data. Com 277
-- candidatos, ordenar por data é ordenar por acaso — o primeiro da lista é o
-- último que a fonte cuspiu, não o que vale mais o trabalho.
--
-- Duas mudanças, e as duas na MESMA função, copiada do banco com
-- `pg_get_functiondef` em vez de reescrita de memória (é uma função de 100
-- linhas com mascaramento de PII por papel, busca por CNPJ e detecção de
-- duplicata: reescrevê-la de cabeça é trocar uma dessas sem querer):
--
--   1. a saída ganha `faixa` (A+, A, B, C) ao lado da `pontuacao` que já existia;
--   2. a ordem passa a ser pontuação primeiro, data como desempate.
--
-- `nulls last` importa: candidato ainda não pontuado não vai para o topo por
-- acidente nem afunda para sempre — ele fica depois dos pontuados e antes de
-- ninguém. A repontuação (`radar_repontuar`) o alcança na volta seguinte.
--
-- A função é recriada com DROP porque o Postgres não deixa `create or replace`
-- mudar a lista de colunas devolvidas. Os grants vêm logo abaixo, e são os
-- mesmos de antes.
-- =====================================================================

drop function if exists public.radar_fila(text,int,int,text,boolean,int,int);

CREATE OR REPLACE FUNCTION public.radar_fila(p_status text DEFAULT 'novo'::text, p_source_id integer DEFAULT NULL::integer, p_category_id integer DEFAULT NULL::integer, p_q text DEFAULT NULL::text, p_so_marcados boolean DEFAULT false, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, nome text, status app.candidate_status, fonte_id integer, fonte text, fonte_tipo app.source_kind, source_url text, categoria_id integer, categoria text, tipo app.org_kind, cidade text, bairro text, telefone text, tem_telefone boolean, instagram text, site text, cnpj text, email text, observacao text, sinalizacoes text[], nao_contatar boolean, pontuacao smallint, faixa text, coletado_em timestamp with time zone, coletor text, criado_em timestamp with time zone, revisado_em timestamp with time zone, revisado_por text, motivo_da_revisao text, organizacao_id uuid, duplicatas jsonb, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_q      text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not app.can_write() then
    raise exception 'Papel % não trabalha a fila do Radar', app.role() using errcode = '42501';
  end if;

  return query
  with filtrada as (
    select c.*
      from public.supplier_candidates c
     where (p_status is null or p_status = 'todos' or c.status::text = p_status)
       and (p_source_id is null   or c.source_id = p_source_id)
       and (p_category_id is null or c.category_id = p_category_id)
       and (not coalesce(p_so_marcados, false) or cardinality(c.flags) > 0)
       and (v_q is null
            or c.search_name like '%' || app.search_name(v_q) || '%'
            or c.cnpj = app.normalize_cnpj(v_q)
            or c.phone_e164 = app.normalize_phone_br(v_q)
            or c.instagram_handle = app.normalize_instagram(v_q))
  ),
  contada as (select count(*) as n from filtrada),
  pagina as (
    select f.* from filtrada f
     order by (f.status = 'novo') desc, f.score desc nulls last, f.created_at desc
     limit v_limit offset v_offset
  )
  select p.id,
         p.name,
         p.status,
         s.id, s.name, s.kind,
         p.source_url,
         p.category_id, cat.name,
         p.kind,
         ci.name, p.neighborhood,
         -- Telefone segue a regra da base (RF-BAS-14): sdr e embaixador leem mascarado.
         case when p.phone_e164 is null then null
              when app.reads_base_pii() then p.phone_e164
              else app.mask_phone(p.phone_e164) end,
         p.phone_e164 is not null,
         p.instagram_handle,
         p.website_domain,
         p.cnpj,
         case when p.email is null then null
              when app.reads_base_pii() then p.email::text
              else '•••' end,
         p.notes,
         p.flags,
         p.do_not_contact,
         p.score,
         p.tier,
         p.collected_at,
         p.collector,
         p.created_at,
         p.reviewed_at,
         rev.full_name,
         p.review_reason,
         p.organization_id,
         coalesce((
           select jsonb_agg(d.*)
             from (
               -- UMA linha por ficha. app.find_org_matches devolve uma linha por REGRA
               -- que casou (a mesma empresa aparece por nome E por telefone), e três
               -- vezes a mesma ficha na tela não é "três suspeitas": é ruído que faz
               -- quem revisa reler para descobrir que é tudo a mesma coisa. Fica a
               -- regra de maior confiança, que é a que explica melhor o casamento.
               select u.organization_id, u.name, u.confidence, u.reason
                 from (
                   select distinct on (m.organization_id)
                          m.organization_id, o.name, m.confidence, m.reason
                     from app.find_org_matches(
                            jsonb_build_object(
                              'name', p.name, 'cnpj', p.cnpj, 'phone_e164', p.phone_e164,
                              'instagram_handle', p.instagram_handle, 'website', p.website_domain,
                              'place_id', p.place_id, 'city_id', p.city_id,
                              'neighborhood', p.neighborhood, 'category_id', p.category_id)) m
                     join public.organizations o
                       on o.id = m.organization_id and o.deleted_at is null
                    -- Só o que a pessoa já poderia abrir: a dedup não é atalho para
                    -- ver ficha de carteira alheia.
                    where app.org_is_visible(m.organization_id)
                    order by m.organization_id, m.confidence desc, m.reason
                 ) u
                order by u.confidence desc, u.name
                limit 3
             ) d
         ), '[]'::jsonb),
         contada.n
    from pagina p
    cross join contada
    join public.sources s on s.id = p.source_id
    left join public.categories cat on cat.id = p.category_id
    left join public.cities ci on ci.id = p.city_id
    left join public.profiles rev on rev.id = p.reviewed_by
   order by (p.status = 'novo') desc, p.score desc nulls last, p.created_at desc;
end $function$;


comment on function public.radar_fila(text,int,int,text,boolean,int,int) is
  'A fila de revisão do Radar (RF-RAD-11), ordenada pela triagem (RF-RAD-12): pontuação primeiro, data como desempate. Devolve pontuacao e faixa (A+, A, B, C). Telefone e e-mail saem mascarados para quem não lê PII da base.';

revoke all on function public.radar_fila(text,int,int,text,boolean,int,int) from public, anon;
grant execute on function public.radar_fila(text,int,int,text,boolean,int,int) to authenticated, service_role;

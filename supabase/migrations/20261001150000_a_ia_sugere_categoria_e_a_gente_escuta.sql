-- =====================================================================
-- A IA já sugere categoria, e a gente jogava fora
--
-- POR QUÊ (desenho de 25/09/2026, §2(c), item 10 da tabela de esforço; plano em
-- docs/superpowers/plans/2026-09-25-aprendizado-e-ia.md; decisão 2 do Rafael:
-- ligar DEPOIS que o de-para e a tela de resolver estivessem de pé — e estão).
--
-- O prompt `triagem-do-radar` já roda sobre esta fila, já recebe as 19
-- categorias e já devolve `categoriaSugerida`, com a regra no sistema: "só pode
-- ser uma das categorias que vieram na lista, ou nulo". O worker repassa o
-- objeto inteiro. E `public.ia_gravar_triagem` grava veredito, porquê e
-- confiança e DESCARTA a categoria. Só ela morre no caminho.
--
-- O que este arquivo conserta, e cada item é um defeito medido:
--
--  1. `app.ia_candidatos_para_triar` manda `'categoriaDaFonte', null` FIXO. O
--     texto existe em `public.source_record.category_source`, a uma junção de
--     distância — e é justamente o rótulo do Google que a IA precisa ler junto
--     do nome. Sem ele, o modelo responde sobre metade da pergunta.
--
--  2. `ia_categoria_id` e `ia_run_id` em `supplier_candidates`. A sugestão só
--     vira id quando o nome devolvido casa EXATO com o catálogo por
--     `app.chave_catalogo`: string parecida não vira categoria, porque
--     categoria errada nasce ficha no funil errado. E `ia_run_id` é o que faz a
--     ficha responder quem disse, com que modelo, quando e por quanto.
--
--  3. A chave da fila é do DIA (`'triar:' || data`), com limite 20. Não são
--     "8 lotes": são OITO DIAS — a segunda importação do mesmo dia enfileira
--     nada, em silêncio. A chave passa a ser da RODADA, e a função enfileira
--     quantas rodadas o que está esperando pedir.
--
-- O QUE NÃO MUDA, E É CONTRATO: nada escreve ficha sozinho (RF-RAD-11). A
-- sugestão chega pré-preenchida no diálogo, e quem confirma é gente. Quando a
-- IA erra, o custo é um clique a mais — não uma mensagem enviada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Onde a sugestão fica
-- ---------------------------------------------------------------------
alter table public.supplier_candidates
  add column if not exists ia_categoria_id int references public.categories (id) on delete set null,
  add column if not exists ia_run_id       bigint references public.ai_runs (id) on delete set null;
comment on column public.supplier_candidates.ia_categoria_id is
  'Categoria que a IA sugeriu, já casada com o catálogo por app.chave_catalogo — e só quando casou EXATO. É opinião: vai pré-preenchida no diálogo de aprovar e nunca cria ficha sozinha (RF-RAD-11).';
comment on column public.supplier_candidates.ia_run_id is
  'A chamada que produziu o veredito (public.ai_runs): quem disse, com que modelo, quando e por quanto. Sem ela a opinião da IA não tem de onde ser conferida.';


-- ---------------------------------------------------------------------
-- 2. O modelo passa a ler o rótulo da fonte
-- ---------------------------------------------------------------------
create or replace function app.ia_candidatos_para_triar(p_limite int default 30)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'oQueProcuramos',
      'Fornecedores de festa e casamento na Grande Natal: buffet, espaço, decoração, som e ' ||
      'iluminação, foto e vídeo de casamento, cerimonial, brinquedo, segurança, transporte de ' ||
      'convidado e lembrança. Não serve fotografia de formatura ou de recém-nascido, varejo, ' ||
      'consultório nem restaurante que só atende no salão.',
    'categorias', coalesce((select jsonb_agg(c.name order by c.position, c.name)
                              from public.categories c where c.is_active), '[]'::jsonb),
    'candidatos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id::text,
               'nome', x.name,
               -- MUDOU em 25/09/2026: era `null` FIXO, com o comentário de que
               -- o modelo só precisa do nome. Era verdade enquanto a única
               -- pergunta era "isto é fornecedor de evento?". Desde que a
               -- resposta de categoria passou a ser usada, o rótulo da fonte é
               -- metade da pergunta: "Loja de Presentes" + "PICMIMOS —
               -- Revelação de Fotos" é uma leitura diferente de cada um deles
               -- sozinho. A junção é a MESMA (source_id, external_id) por onde
               -- o candidato é encontrado em app.resolver_source_record.
               'categoriaDaFonte', x.categoria_da_fonte,
               'categoriaDoCrm', x.categoria,
               'cidade', x.cidade,
               'bairro', x.neighborhood) order by x.score desc nulls last)
        from (
          select c.id, c.name, c.neighborhood, c.score,
                 cat.name as categoria, cid.name as cidade,
                 (select sr.category_source
                    from public.source_record sr
                   where sr.source_id = c.source_id and sr.external_id = c.external_id
                     and nullif(trim(coalesce(sr.category_source, '')), '') is not null
                   order by sr.last_seen_at desc
                   limit 1) as categoria_da_fonte
            from public.supplier_candidates c
            left join public.categories cat on cat.id = c.category_id
            left join public.cities cid on cid.id = c.city_id
           where c.status = 'novo'::app.candidate_status
             and c.ia_analisado_em is null
           order by c.score desc nulls last, c.created_at
           limit least(greatest(coalesce(p_limite, 30), 1), 30)
        ) x), '[]'::jsonb));
$$;
comment on function app.ia_candidatos_para_triar(int) is
  'O lote de candidatos que a IA ainda não leu, do mais pontuado para o menos. Nome, o rótulo que a FONTE usou, a categoria que o CRM já casou e o lugar: telefone, e-mail e CNPJ não vão ao modelo porque ele não precisa deles (ADR-09).';
revoke all on function app.ia_candidatos_para_triar(int) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. A categoria para de morrer no caminho
-- ---------------------------------------------------------------------
create or replace function public.ia_gravar_triagem(p_vereditos jsonb, p_ai_run_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
begin
  if not app.e_o_worker() then
    raise exception 'Só o worker grava a triagem da IA' using errcode = '42501';
  end if;

  -- `ia_analisado_em` é gravado mesmo quando o veredito é "incerto": ele marca
  -- que a IA JÁ OLHOU. Sem isso o mesmo nome voltaria ao modelo toda semana,
  -- para receber o mesmo "não dá para saber" — e seria cobrado por isso.
  with entrada as (
    select (v ->> 'id')::uuid as id,
           v ->> 'veredito'   as veredito,
           v ->> 'porque'     as porque,
           (v ->> 'confianca')::numeric as confianca,
           -- SÓ O QUE CASA EXATO vira categoria. O modelo é instruído a usar
           -- uma das categorias da lista, mas instrução não é garantia: string
           -- parecida virando id é ficha no funil errado, e funil errado é
           -- meta errada, relatório de déficit errado e pitch errado.
           (select c.id from public.categories c
             where c.is_active
               and app.chave_catalogo(c.name)
                   = app.chave_catalogo(v ->> 'categoriaSugerida')
             limit 1) as categoria_id
      from jsonb_array_elements(coalesce(p_vereditos, '[]'::jsonb)) v
  )
  update public.supplier_candidates c
     set ia_veredito = e.veredito,
         ia_porque   = left(e.porque, 200),
         ia_confianca = least(1, greatest(0, e.confianca)),
         ia_categoria_id = e.categoria_id,
         ia_run_id   = p_ai_run_id,
         ia_analisado_em = now()
    from entrada e
   where c.id = e.id
     and e.veredito in ('sim', 'nao', 'incerto');

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'gravados', v_n);
end $$;
comment on function public.ia_gravar_triagem(jsonb, bigint) is
  'Grava o que a IA leu sobre cada candidato: veredito, porquê, confiança e — desde 25/09/2026 — a categoria sugerida (só quando o nome casa EXATO com o catálogo) e a chamada que a produziu. ia_analisado_em marca que a IA já olhou, inclusive quando disse "incerto": sem isso o mesmo nome voltaria ao modelo toda semana. Só o worker grava.';

-- A assinatura de UM argumento sai: as duas seriam ambíguas para o PostgREST.
drop function if exists public.ia_gravar_triagem(jsonb);
revoke all on function public.ia_gravar_triagem(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.ia_gravar_triagem(jsonb, bigint) to service_role;


-- ---------------------------------------------------------------------
-- 4. A chave da fila deixa de ser do DIA
-- ---------------------------------------------------------------------
-- `'triar:' || data` com limite 20 não são "8 lotes" para 155 candidatos: são
-- OITO DIAS. A segunda importação do mesmo dia enfileirava NADA, em silêncio —
-- e quem pedisse a leitura via a tela responder "ok" sem nada acontecer.
--
-- A chave passa a ser da RODADA (`'triar:<data>:<n>'`), e a função enfileira
-- quantas rodadas o que está esperando pedir, até um teto. O teto existe porque
-- o freio de orçamento é por mês e a conta é de quem clicou: 155 candidatos são
-- US$ 0,06, mas 5.000 seriam US$ 2,00 num clique.
CREATE OR REPLACE FUNCTION public.radar_triar_com_ia()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_quantos  int;
  v_rodadas  int;
  v_freio    jsonb;
  v_fila     jsonb;
  v_enfileir int := 0;
  i          int;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and not app.e_o_worker()
     and app.role() not in ('admin'::app.user_role, 'gestor'::app.user_role) then
    raise exception 'Papel % não pede a leitura da IA', app.role() using errcode = '42501';
  end if;

  select count(*)::int into v_quantos
    from public.supplier_candidates
   where status = 'novo'::app.candidate_status and ia_analisado_em is null;

  if v_quantos = 0 then
    return jsonb_build_object('ok', true, 'enfileirado', false, 'motivo', 'nada_para_ler');
  end if;

  -- O FREIO DO ORÇAMENTO, DITO ANTES E NÃO DEPOIS. Acima de 80% do teto só
  -- passam `classify_inbound` e `transcribe_audio` — a triagem não está na
  -- lista, e o trabalho seria enfileirado para morrer calado no worker. Quem
  -- clicou ficaria esperando um veredito que nunca vem. Agora a tela sabe.
  v_freio := app.ia_pode_gastar('triar_candidato');
  if not coalesce((v_freio ->> 'pode')::boolean, true) then
    return jsonb_build_object('ok', true, 'enfileirado', false,
                              'motivo', v_freio ->> 'motivo',
                              'gasto_usd', v_freio -> 'gasto_usd',
                              'teto_usd', v_freio -> 'teto_usd',
                              'esperando', v_quantos);
  end if;

  -- O lote é de 20, e o número é medido: com 30, a resposta do modelo gastou
  -- 1.875 tokens de saída e a segunda chamada estourou o teto, voltando com
  -- JSON cortado. Vinte cabe com folga.
  --
  -- Teto de 15 rodadas = 300 candidatos por pedido. Acima disso, quem quiser
  -- pede de novo — e aí é outra decisão, com a conta à vista.
  v_rodadas := least(ceil(v_quantos::numeric / 20)::int, 15);

  for i in 1..v_rodadas loop
    v_fila := app.ia_enfileirar('triar_candidato',
                jsonb_build_object('purpose', 'triar_candidato', 'limite', 20),
                'triar:'
                  || to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM-DD')
                  || ':' || i::text);
    if coalesce((v_fila ->> 'enfileirado')::boolean, false) then
      v_enfileir := v_enfileir + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'enfileirado', v_enfileir > 0,
                            'rodadas', v_enfileir, 'esperando', v_quantos);
end $function$;
comment on function public.radar_triar_com_ia() is
  'Pede a leitura da IA sobre a fila (RF-RAD-12). Enfileira uma rodada de 20 por vez, até 15 rodadas (300 candidatos) num pedido. A chave é da RODADA e não do dia: com a chave do dia, a segunda importação da mesma tarde enfileirava nada, em silêncio, e 155 candidatos levariam oito DIAS para serem lidos.';

-- ---------------------------------------------------------------------
-- 5. A fila entrega a sugestão, para o diálogo abrir já preenchido
-- ---------------------------------------------------------------------
-- Acrescentar coluna a um `returns table` exige drop + create.
drop function if exists public.radar_fila(text,int,int,text,boolean,int,int);

CREATE OR REPLACE FUNCTION public.radar_fila(p_status text DEFAULT 'novo'::text, p_source_id integer DEFAULT NULL::integer, p_category_id integer DEFAULT NULL::integer, p_q text DEFAULT NULL::text, p_so_marcados boolean DEFAULT false, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, nome text, status app.candidate_status, fonte_id integer, fonte text, fonte_tipo app.source_kind, source_url text, categoria_id integer, categoria text, categoria_na_fonte text, tipo app.org_kind, cidade text, bairro text, telefone text, tem_telefone boolean, instagram text, site text, cnpj text, email text, observacao text, sinalizacoes text[], nao_contatar boolean, pontuacao smallint, faixa text, ia_veredito text, ia_porque text, ia_categoria_id integer, ia_categoria text, coletado_em timestamp with time zone, coletor text, criado_em timestamp with time zone, revisado_em timestamp with time zone, revisado_por text, motivo_da_revisao text, organizacao_id uuid, duplicatas jsonb, total_count bigint)
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
         cs.category_source,
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
         p.ia_veredito,
         p.ia_porque,
         -- NOVO em 25/09/2026: a categoria que a IA sugeriu, já casada com o
         -- catálogo (só o que casou EXATO virou id). Ela não decide nada — vai
         -- pré-preenchida no diálogo, e quem confirma é gente (RF-RAD-11).
         p.ia_categoria_id,
         iacat.name,
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
    left join public.categories iacat on iacat.id = p.ia_categoria_id
    left join public.cities ci on ci.id = p.city_id
    left join public.profiles rev on rev.id = p.reviewed_by
    -- O texto que a FONTE usou. Um candidato pode ter VÁRIOS source_record — a
    -- chave única é (source_id, external_id) —, então um join comum
    -- multiplicaria as linhas da fila. `order by last_seen_at desc limit 1`
    -- entrega o mais recente, que é o que a pessoa acabou de importar.
    left join lateral (
      select sr.category_source
        from public.source_record sr
       where sr.candidate_id = p.id
         and sr.category_source is not null
       order by sr.last_seen_at desc
       limit 1
    ) cs on true
   order by (p.status = 'novo') desc, p.score desc nulls last, p.created_at desc;
end $function$;

comment on function public.radar_fila(text,int,int,text,boolean,int,int) is
  'A fila de revisão (RF-RAD-11), ordenada pela triagem (RF-RAD-12). Devolve pontuacao, faixa (A+..C), o veredito da IA sobre o nome — que é opinião, não decisão —, categoria_na_fonte (o texto que a FONTE usou, do source_record mais recente) e, desde 25/09/2026, a categoria que a IA sugeriu, já casada com o catálogo. Telefone e e-mail saem mascarados para quem não lê PII da base.';

revoke all on function public.radar_fila(text,int,int,text,boolean,int,int) from public, anon;
grant execute on function public.radar_fila(text,int,int,text,boolean,int,int) to authenticated, service_role;

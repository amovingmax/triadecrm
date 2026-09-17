-- =====================================================================
-- A metade que LÊ da triagem do Radar
--
-- `app.radar_pontuar` soma nota, avaliações, categoria e cidade. Ela ordena bem
-- e não sabe ler: "Fotografia Silva — Formaturas" e "Fotografia Silva —
-- Casamentos" têm a MESMA pontuação, e só um dos dois atende a KOMUNE.
--
-- Esta migração abre o lugar onde o veredito do modelo mora e a porta por onde o
-- trabalho é pedido.
--
-- =====================================================================
-- OPINIÃO, NÃO DECISÃO
-- =====================================================================
-- O veredito não aprova, não recusa e não tira ninguém da fila (RF-RAD-08). Ele
-- é uma coluna a mais na revisão — "a IA acha que não é fornecedor de evento, e
-- disse por quê" — e quem revisa discorda quando quiser. Por isso ele NÃO entra
-- na conta do `score`: misturar os dois faria a opinião do modelo mudar a ordem
-- sem que ninguém percebesse de onde veio a mudança.
-- =====================================================================

alter table public.supplier_candidates
  add column if not exists ia_veredito   text,
  add column if not exists ia_porque     text,
  add column if not exists ia_confianca  numeric(3,2),
  add column if not exists ia_analisado_em timestamptz;

alter table public.supplier_candidates drop constraint if exists supplier_candidates_ia_veredito_check;
alter table public.supplier_candidates add constraint supplier_candidates_ia_veredito_check
  check (ia_veredito is null or ia_veredito in ('sim', 'nao', 'incerto'));

alter table public.supplier_candidates drop constraint if exists supplier_candidates_ia_confianca_check;
alter table public.supplier_candidates add constraint supplier_candidates_ia_confianca_check
  check (ia_confianca is null or ia_confianca between 0 and 1);

comment on column public.supplier_candidates.ia_veredito is
  'O que a IA achou do NOME: sim, nao ou incerto (prompt triagem-do-radar@v1). Opinião, não decisão — não entra na conta do score e não tira ninguém da fila (RF-RAD-08).';

-- O propósito novo entra na lista de `ai_runs`, que é o que faz o custo desta
-- chamada aparecer no mesmo lugar dos outros.
alter table public.ai_runs drop constraint if exists ai_runs_purpose_check;
alter table public.ai_runs add constraint ai_runs_purpose_check
  check (purpose in ('transcribe_audio', 'summarize_call', 'draft_followup', 'classify_inbound',
                     'draft_reply', 'summarize_deal', 'next_action', 'digest',
                     'extract_listing', 'assistant',
                     'analisar_conversa', 'pulso_do_dia', 'perguntar_ao_crm',
                     'triar_candidato'));


-- ---------------------------------------------------------------------------
-- O que vai ao modelo
-- ---------------------------------------------------------------------------
-- Nome, categoria e lugar. Telefone, e-mail e CNPJ NÃO: o modelo não precisa
-- deles para responder "isto parece fornecedor de evento?", e o que não é
-- necessário não viaja (ADR-09).
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
               -- A categoria COMO A FONTE ESCREVEU mora em `source_record`, a
               -- uma junção de distância por (source_id, external_id). Não vale
               -- a junção para esta pergunta: o que o modelo lê é o NOME, e a
               -- categoria do catálogo já diz o que o CRM entendeu. Fica nulo, e
               -- o prompt aceita nulo porque esse é o caso comum.
               'categoriaDaFonte', null,
               'categoriaDoCrm', x.categoria,
               'cidade', x.cidade,
               'bairro', x.neighborhood) order by x.score desc nulls last)
        from (
          select c.id, c.name, c.neighborhood, c.score,
                 cat.name as categoria, cid.name as cidade
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
  'O lote de candidatos que a IA ainda não leu, do mais pontuado para o menos. Só nome, categoria e lugar: telefone, e-mail e CNPJ não vão ao modelo porque ele não precisa deles (ADR-09).';

revoke all on function app.ia_candidatos_para_triar(int) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- O que volta dele
-- ---------------------------------------------------------------------------
create or replace function public.ia_gravar_triagem(p_vereditos jsonb)
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
           (v ->> 'confianca')::numeric as confianca
      from jsonb_array_elements(coalesce(p_vereditos, '[]'::jsonb)) v
  )
  update public.supplier_candidates c
     set ia_veredito = e.veredito,
         ia_porque   = left(e.porque, 200),
         ia_confianca = least(1, greatest(0, e.confianca)),
         ia_analisado_em = now()
    from entrada e
   where c.id = e.id
     and e.veredito in ('sim', 'nao', 'incerto');

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'gravados', v_n);
end $$;

comment on function public.ia_gravar_triagem(jsonb) is
  'Grava o veredito da IA sobre cada candidato (prompt triagem-do-radar@v1). Só o worker. Marca ia_analisado_em inclusive no "incerto": ele diz que a IA já olhou, e é o que impede o mesmo nome de voltar ao modelo toda semana.';

revoke all on function public.ia_gravar_triagem(jsonb) from public, anon, authenticated;
grant execute on function public.ia_gravar_triagem(jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- A porta da tela: pedir a leitura
-- ---------------------------------------------------------------------------
create or replace function public.radar_triar_com_ia()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantos int;
  v_fila    jsonb;
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

  -- A chave é do DIA: pedir duas vezes na mesma tarde não gasta duas chamadas.
  -- O lote é de 20, e o número é medido: com 30, a resposta do modelo gastou
  -- 1.875 tokens de saída e a segunda chamada estourou o teto, voltando com JSON
  -- cortado. Vinte cabe com folga. Quem tiver mais espera o pedido seguinte, e
  -- isso é de propósito — 277 candidatos de uma vez seriam uma conta grande
  -- tomada por um clique.
  v_fila := app.ia_enfileirar('triar_candidato',
              jsonb_build_object('purpose', 'triar_candidato', 'limite', 20),
              'triar:' || to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM-DD'));

  return jsonb_build_object('ok', true, 'enfileirado', coalesce((v_fila ->> 'enfileirado')::boolean, false),
                            'esperando', v_quantos);
end $$;

comment on function public.radar_triar_com_ia() is
  'Pede ao worker-ai a leitura dos candidatos ainda não lidos (lote de 30, chave do dia). Admin e gestor. A IA opina sobre o nome; ela não aprova nem recusa (RF-RAD-08).';

revoke all on function public.radar_triar_com_ia() from public, anon;
grant execute on function public.radar_triar_com_ia() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- A casca pública: o worker só alcança `public`
-- ---------------------------------------------------------------------------
-- Mesmo motivo de `ia_pulso_entrada` e `ia_entrada_da_ficha`: o PostgREST expõe
-- só o schema `public`, e o schema `app` é privado de propósito. A casca não
-- decide nada — ela empresta o alcance.
create or replace function public.ia_triagem_entrada(p_limite int default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.ia_candidatos_para_triar(p_limite)
$$;

comment on function public.ia_triagem_entrada(int) is
  'Casca de app.ia_candidatos_para_triar para o worker-ai, que só alcança o schema public.';

revoke all on function public.ia_triagem_entrada(int) from public, anon, authenticated;
grant execute on function public.ia_triagem_entrada(int) to service_role;

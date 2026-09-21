-- =====================================================================
-- Radar: candidato de categoria prioritária quebrava a pontuação
--
-- `v_porque || 'categoria prioritária'` junta um text[] com um literal SEM
-- tipo, e o Postgres escolhe o operador array || array: tenta ler a frase como
-- um array e aborta com "malformed array literal". As outras frases passam
-- porque `format()` já devolve text.
--
-- Não disparava porque a lista de categorias prioritárias está vazia em
-- produção. Na primeira categoria marcada na tela do Radar, todo candidato
-- dela deixaria de entrar na fila (o gatilho que pontua na entrada aborta) e o
-- "repontuar" quebraria. Achado pelo `supabase db lint` em 22/09/2026.
--
-- Recriada a partir da migração 20260917180000; só a linha marcada com
-- "CORRIGIDO" mudou. Mesma assinatura: os privilégios continuam os mesmos.
-- =====================================================================
create or replace function app.radar_pontuar(p_cand public.supplier_candidates)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cfg      jsonb;
  v_pesos    jsonb;
  v_score    numeric := 0;
  -- O TETO É O QUE PODE PONTUAR, não a soma de todos os pesos.
  --
  -- Um peso que não pode discriminar ninguém não deve derrubar todo mundo: com
  -- `categorias_prioritarias` vazia (o estado de hoje), os 25 pontos da
  -- categoria não entram para candidato NENHUM, e somá-los ao teto faria o
  -- máximo possível ser 75. A faixa A+ ficaria inalcançável por configuração —
  -- uma régua cujo topo não existe.
  v_max      numeric := 0;
  v_porque   text[] := '{}';
  v_nota_min numeric;
  v_aval_min int;
  v_cidade   text;
begin
  select value into v_cfg from public.app_settings where key = 'radar.triagem';
  if v_cfg is null then
    return jsonb_build_object('score', null, 'tier', null, 'porque', '[]'::jsonb);
  end if;
  v_pesos    := coalesce(v_cfg -> 'pesos', '{}'::jsonb);
  v_nota_min := coalesce((v_cfg ->> 'nota_minima')::numeric, 4.0);
  v_aval_min := coalesce((v_cfg ->> 'avaliacoes_para_valer')::int, 10);

  -- Nota e avaliações sempre participam: a fonte ou as traz, ou não, e nos dois
  -- casos a ausência é informação sobre o candidato.
  v_max := coalesce((v_pesos ->> 'nota')::numeric, 0) + coalesce((v_pesos ->> 'avaliacoes')::numeric, 0);
  if jsonb_array_length(coalesce(v_cfg -> 'categorias_prioritarias', '[]'::jsonb)) > 0 then
    v_max := v_max + coalesce((v_pesos ->> 'categoria')::numeric, 0);
  end if;
  if jsonb_array_length(coalesce(v_cfg -> 'cidades_alvo', '[]'::jsonb)) > 0 then
    v_max := v_max + coalesce((v_pesos ->> 'cidade')::numeric, 0);
  end if;

  -- 1 · A nota da fonte. Só conta acima do mínimo, e cresce até o 5.
  if p_cand.rating is not null and p_cand.rating >= v_nota_min then
    v_score := v_score + coalesce((v_pesos ->> 'nota')::numeric, 0)
               * least(1, (p_cand.rating - v_nota_min) / greatest(0.1, 5 - v_nota_min) + 0.5);
    v_porque := v_porque || format('nota %s na fonte', trim(to_char(p_cand.rating, '9.9')));
  end if;

  -- 2 · Quantas avaliações. Vinte avaliações não valem o dobro de dez: satura.
  if coalesce(p_cand.reviews_count, 0) > 0 then
    v_score := v_score + coalesce((v_pesos ->> 'avaliacoes')::numeric, 0)
               * least(1, p_cand.reviews_count::numeric / greatest(1, v_aval_min));
    v_porque := v_porque || format('%s avaliações', p_cand.reviews_count);
  end if;

  -- 3 · Categoria que a operação elegeu como prioridade neste momento.
  if p_cand.category_id is not null
     and (v_cfg -> 'categorias_prioritarias') @> to_jsonb(p_cand.category_id) then
    v_score := v_score + coalesce((v_pesos ->> 'categoria')::numeric, 0);
    -- CORRIGIDO: o literal precisa de tipo, senão vira array || array.
    v_porque := v_porque || 'categoria prioritária'::text;
  end if;

  -- 4 · Cidade-alvo. A KOMUNE opera a Grande Natal; fornecedor de outra praça
  --     não é ruim, é para depois.
  select c.name into v_cidade from public.cities c where c.id = p_cand.city_id;
  if v_cidade is not null and (v_cfg -> 'cidades_alvo') @> to_jsonb(v_cidade) then
    v_score := v_score + coalesce((v_pesos ->> 'cidade')::numeric, 0);
    v_porque := v_porque || format('fica em %s', v_cidade);
  end if;

  -- A escala final é sempre 0-100, seja qual for a soma dos pesos que a tela
  -- configurou: assim o corte de A+ significa a mesma coisa depois de alguém
  -- mexer nos pesos.
  v_score := case when v_max > 0 then least(100, greatest(0, round(100 * v_score / v_max))) else 0 end;

  return jsonb_build_object(
    'score', v_score::int,
    'tier', case
              when v_score >= coalesce((v_cfg ->> 'corte_a_mais')::numeric, 85) then 'A+'
              when v_score >= coalesce((v_cfg ->> 'corte_a')::numeric, 65)      then 'A'
              when v_score >= coalesce((v_cfg ->> 'corte_b')::numeric, 35)      then 'B'
              else 'C'
            end,
    'porque', to_jsonb(v_porque));
end $$;

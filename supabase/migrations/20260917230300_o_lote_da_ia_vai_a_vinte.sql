-- =====================================================================
-- Conserto medido: o lote da IA vai de 30 para 20
--
-- A primeira chamada real gastou 1.875 tokens de saída com 30 candidatos
-- (ai_run 50). A segunda estourou o teto de 2.000 e voltou com JSON cortado no
-- meio — que o leitor recusa, e com razão: metade de um veredito é pior que
-- veredito nenhum.
--
-- Duas correções na mesma causa: o teto do prompt subiu para 3.000 (folga para o
-- pior caso) e o lote caiu para 20 aqui. Teto encostado é teto que volta a
-- estourar no dia em que um nome for longo.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.radar_triar_com_ia()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

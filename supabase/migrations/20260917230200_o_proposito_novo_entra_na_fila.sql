-- =====================================================================
-- Conserto: o propósito novo tinha DUAS listas para entrar, e eu só vi uma
--
-- `triar_candidato` entrou no CHECK de `ai_runs.purpose` (migração
-- 20260917230000) e o pedido continuou sendo recusado em produção com a frase
-- que o próprio CRM escreveu: "gasto que ninguém nomeou é gasto que ninguém
-- orçou". A lista existe em DOIS lugares — o CHECK da tabela e o `if` dentro de
-- `app.ia_enfileirar` —, e a segunda é a que barra ANTES de qualquer chamada.
--
-- Duplicação proposital do D5: o CHECK protege a gravação e o `if` protege a
-- FILA, que é onde o gasto nasce. Barrar só na gravação deixaria a chamada ao
-- modelo acontecer e o custo existir antes de alguém descobrir. Está certa a
-- duplicação; errado foi eu atualizar uma e não a outra.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.ia_enfileirar(p_purpose text, p_payload jsonb, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_purpose not in ('transcribe_audio', 'summarize_call', 'draft_followup', 'classify_inbound',
                       'draft_reply', 'summarize_deal', 'next_action', 'digest',
                       'extract_listing', 'assistant',
                       'analisar_conversa', 'pulso_do_dia', 'perguntar_ao_crm',
                       'triar_candidato') then
    raise exception 'Propósito % não existe em ai_runs.purpose: gasto que ninguém nomeou é gasto que ninguém orçou', p_purpose
      using errcode = '22023';
  end if;
  return app.esteira_enfileirar('ai_jobs',
                                jsonb_build_object('purpose', p_purpose) || coalesce(p_payload, '{}'::jsonb),
                                p_purpose || ':' || p_key);
end $function$;

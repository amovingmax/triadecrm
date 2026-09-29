-- =====================================================================
-- O "Tudo bem?" se edita na tela
--
-- Rafael, 29/09/2026: "coloque". Os textos da ausência e da introdução já se
-- mudavam em Ajustes → Atendimento; o "Tudo bem?", que nasceu há uma hora
-- (20261002230000), só por migração. Mensagem que o CRM manda em nome da casa
-- tem de ser editável por quem responde por ela.
--
-- Recriada a partir de 20261002200000 — a definição VIVA, com os cinco
-- interruptores e o ritmo do cumprimento. Ontem eu reconstruí uma função a
-- partir da PRIMEIRA definição dela e perdi uma regra inteira pelo caminho; o
-- pgTAP pegou, mas a lição é esta linha.
--
-- RF-ADM-02, RF-CON-06
-- =====================================================================

create or replace function public.atendimento_configurar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text := nullif(btrim(coalesce(p ->> 'texto_ausencia', '')), '');
  v_intro text := nullif(btrim(coalesce(p ->> 'texto_introducao', '')), '');
  v_ola   text := nullif(btrim(coalesce(p ->> 'texto_tudo_bem', '')), '');
  v_hora  int  := nullif(btrim(coalesce(p ->> 'cumprimento_por_hora', '')), '')::int;
  v_novo  jsonb := '{}'::jsonb;
  k       text;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  foreach k in array array['lead_automatico', 'distribuicao_automatica',
                           'ausencia_ativa', 'introducao_ativa',
                           'cumprimento_automatico'] loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'boolean' then
        return jsonb_build_object('ok', false, 'motivo', 'valor_invalido', 'campo', k);
      end if;
      v_novo := v_novo || jsonb_build_object(k, p -> k);
    end if;
  end loop;
  if v_hora is not null and (v_hora < 1 or v_hora > 60) then
    return jsonb_build_object('ok', false, 'motivo', 'valor_invalido',
                              'campo', 'cumprimento_por_hora');
  end if;
  if v_hora is not null then
    v_novo := v_novo || jsonb_build_object('cumprimento_por_hora', v_hora);
  end if;
  if v_texto is not null and length(v_texto) > 1000 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo_demais');
  end if;
  if v_intro is not null then
    if length(v_intro) > 1000 then
      return jsonb_build_object('ok', false, 'motivo', 'texto_longo_demais',
                                'campo', 'texto_introducao');
    end if;
    if position('{{' in v_intro) > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'introducao_com_variavel');
    end if;
  end if;
  -- MESMA REGRA DO "TUDO BEM?", e pelo mesmo motivo: `app.wa_bot_dizer` copia o
  -- corpo CRU para o fio, então um `{{nome}}` sairia literal no WhatsApp do
  -- fornecedor. O teto é menor de propósito — esta é a mensagem curta do meio,
  -- e um texto de mil caracteres aqui já não seria um "tudo bem".
  if v_ola is not null then
    if length(v_ola) > 200 then
      return jsonb_build_object('ok', false, 'motivo', 'texto_longo_demais',
                                'campo', 'texto_tudo_bem');
    end if;
    if position('{{' in v_ola) > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'tudo_bem_com_variavel');
    end if;
  end if;

  update public.app_settings set value = value || v_novo, updated_by = auth.uid()
   where key = 'atendimento';
  if v_texto is not null then
    update public.message_templates set body = v_texto where template_code = 'GEN-SYS-AUSENCIA';
  end if;
  if v_intro is not null then
    update public.message_templates set body = v_intro where template_code = 'GEN-SYS-INTRO';
  end if;
  if v_ola is not null then
    update public.message_templates set body = v_ola where template_code = 'GEN-SYS-TUDOBEM';
  end if;
  -- O lote que já está vivo aprende o ritmo novo agora, e não só no próximo que
  -- nascer: quem baixa de 6 para 2 está pisando no freio de um envio EM CURSO.
  if v_hora is not null then
    update public.envios_em_massa set por_hora = v_hora, atualizado_em = now()
     where continuo and status in ('agendado', 'enviando', 'pausado');
  end if;
  return jsonb_build_object('ok', true);
end $$;

comment on function public.atendimento_configurar(jsonb) is
  'Ajustes → Atendimento: os cinco interruptores (lead automático, distribuição, ausência, introdução e cumprimento automático do Google Maps), o ritmo do cumprimento (1 a 60 por hora, que também reajusta o lote em curso) e os TRÊS textos automáticos — ausência, "Tudo bem?" (teto de 200) e introdução (teto de 1000). Os dois últimos recusam variável porque o corpo deles é copiado cru para o fio (ADR-16).';

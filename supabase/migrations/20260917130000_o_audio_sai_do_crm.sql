-- =====================================================================
-- O áudio sai do CRM: o lote de envio passa a carregar o arquivo
--
-- Até aqui, áudio era só a BIBLIOTECA da Heloísa (R04 §6): sete registros de
-- catálogo, nenhum arquivo gravado, e `formaDoEnvio` recusando com
-- "audio_sem_arquivo". Quem atende escrevia, e ponto.
--
-- Agora quem atende pode gravar na hora, pela tela. O que muda no banco é uma
-- coisa só: o item do lote de saída passa a levar `media_path` e `media_mime` —
-- onde o arquivo está no balde privado. Sem isso o worker receberia uma mensagem
-- de áudio sem saber o que subir para a Meta.
--
-- O corpo abaixo é o da função EM PRODUÇÃO, copiado do banco e com duas linhas
-- acrescentadas. Reescrevê-la de memória seria trocar, sem querer, alguma das
-- recusas que ela faz no instante da entrega.
--
-- =====================================================================
-- O QUE NÃO MUDA, E É DE PROPÓSITO
-- =====================================================================
-- * **A policy de `messages`.** Ela já aceitava `type = 'audio'`: o que ela
--   recusa é `template`, que tem porta própria (`wa_enviar_modelo`).
-- * **A janela de 24 h.** Áudio não é modelo aprovado — fora da janela a Meta
--   recusa, e esta função já adia o que está fora dela. Não há exceção nova.
-- * **Supressão, tetos e janela de horário.** Continuam valendo igual, pela
--   mesma conferência de sempre.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.wa_proximos(p_qty integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_out       jsonb := '[]'::jsonb;
  v_recusados jsonb := '[]'::jsonb;
  v_motivo    text;
  v_pode      jsonb;
  m           record;
  msg         public.messages%rowtype;
  c           public.conversations%rowtype;
begin
  for m in select * from pgmq.read('wa_outbound', 120, least(greatest(coalesce(p_qty, 10), 1), 50)) loop
    select * into msg from public.messages where id = (m.message ->> 'message_id')::uuid;
    if not found or msg.status <> 'queued'::app.msg_status then
      perform pgmq.archive('wa_outbound', m.msg_id);
      continue;
    end if;
    select * into c from public.conversations where id = msg.conversation_id;

    -- ----- guardrail: o mundo muda entre a fila e a entrega -----
    v_motivo := null;
    v_pode   := null;
    if msg.optout_confirmation then
      -- Dispensa a supressão e a janela de 24 h. SÓ.
      v_pode := app.pode_enviar_confirmacao_optout(msg.conversation_id, now(), true);
    else
      v_motivo := app.wa_motivo_de_recusa(msg.organization_id, msg.contact_id, c.peer_phone_e164);
      if v_motivo is null then
        v_pode := app.pode_enviar(msg.conversation_id, msg.is_first_contact,
                                  msg.template_id is not null, now());
      end if;
    end if;

    if v_motivo is null and v_pode is not null
       and not coalesce((v_pode ->> 'pode')::boolean, false) then
      -- Janela fechada e teto estourado NÃO matam a mensagem: eles dizem
      -- "agora não". A mensagem volta para a fila com o `visibility
      -- timeout` esticado até a próxima abertura, e quem a mata é
      -- app.wa_expirar_fila, com prazo.
      if (v_pode ->> 'motivo') in ('contato_suprimido', 'numero_suprimido',
                                   'contato_apagado', 'organizacao_apagada') then
        v_motivo := v_pode ->> 'motivo';
      else
        perform pgmq.set_vt('wa_outbound', m.msg_id,
                            greatest(60, least(3600,
                              extract(epoch from coalesce((v_pode ->> 'quando')::timestamptz,
                                                          now() + interval '15 minutes') - now())::int)));
        v_recusados := v_recusados || jsonb_build_object('message_id', msg.id,
                                                         'motivo', v_pode ->> 'motivo',
                                                         'acao', 'adiado',
                                                         'quando', v_pode ->> 'quando');
        continue;
      end if;
    end if;

    if v_motivo is not null then
      update public.messages
         set status = 'failed'::app.msg_status,
             error_code = 'recusado_na_entrega',
             error_detail = v_motivo,
             failed_at = now()
       where id = msg.id;
      update public.message_drafts set status = 'descartado',
             discard_reason = 'recusado na entrega: ' || v_motivo
       where id = msg.draft_id and status in ('aprovado', 'enviado');
      perform pgmq.archive('wa_outbound', m.msg_id);
      v_recusados := v_recusados || jsonb_build_object('message_id', msg.id,
                                                       'motivo', v_motivo, 'acao', 'morto');
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'msg_id',          m.msg_id,
      'message_id',      msg.id,
      'conversation_id', msg.conversation_id,
      'business_number', c.business_number,
      'para',            c.peer_phone_e164,
      'tipo',            msg.type,
      'corpo',           msg.body,
      'template_id',     msg.template_id,
      'template_params', msg.template_params,
      'audio_asset_id',  msg.audio_asset_id,
      -- O arquivo que a tela gravou e guardou no balde privado `mensagens`. É
      -- por ele que o worker sobe o áudio para a Meta antes de mandar.
      'media_path',      msg.media_path,
      'media_mime',      msg.media_mime);
  end loop;

  return jsonb_build_object('itens', v_out, 'recusados', v_recusados);
end $function$;

-- =====================================================================
-- A foto e o vídeo saem do CRM: a legenda leva o nome de quem envia
--
-- Pedido de 16/10/2026: "implemente a ferramenta pra eu conseguir enviar
-- fotos e vídeos pelo CRM". O caminho é o do áudio gravado (20260917130000):
-- o arquivo sobe para o balde privado `mensagens`, a linha entra em
-- `messages` com `type` = image/video e `media_path`, e o worker-wa sobe o
-- arquivo para a Meta na hora da entrega.
--
-- Quase nada muda no banco, e isto é de propósito:
--   * A policy `messages_insert` já aceita image e video (ela recusa só o
--     que tem porta própria).
--   * O lote de saída já leva `media_path` e `media_mime` desde o áudio.
--   * O balde já aceita image/jpeg, image/png, video/mp4 e video/3gpp, até
--     20 MB (os tetos da Meta são 5 MB e 16 MB).
--   * A janela de 24 h, a supressão e os tetos valem igual: mídia livre não é
--     modelo aprovado, e fora da janela `wa_saida_proximos` a recusa.
--
-- O que muda é uma linha: a ASSINATURA. Desde 14/09/2026 todo texto livre
-- sai com `*Nome:*` em negrito na primeira linha, e a mídia ficava de fora
-- porque o áudio não tem texto. A foto e o vídeo têm — a legenda — e a regra
-- do time é "cada mensagem assinada com o primeiro nome de quem envia". Então
-- a legenda é assinada como o texto; foto sem legenda continua sem nada.
--
-- RF-CON-05, RF-CON-10, RF-CON-11
-- =====================================================================

create or replace function app.messages_nome_do_atendente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome  text;
  v_linha text;
begin
  if new.direction <> 'out'::app.msg_direction
     or new.origin <> 'crm'
     -- NOVO: a legenda da foto e do vídeo também (16/10/2026).
     or new.type not in ('text'::app.msg_type, 'image'::app.msg_type, 'video'::app.msg_type)
     or new.template_id is not null
     or new.optout_confirmation
     or new.author_kind not in ('human', 'bot_ai')
     or nullif(btrim(coalesce(new.body, '')), '') is null
     or coalesce(current_setting('app.voz', true), '') = 'marca'
     or not coalesce((select (s.value ->> 'assinar_com_nome')::boolean
                        from public.app_settings s where s.key = 'whatsapp.envio'), true) then
    return new;
  end if;

  v_nome := app.primeiro_nome(case when new.author_kind = 'bot_ai' then new.approved_by
                                   else new.sent_by end);
  if v_nome is null then
    return new;
  end if;

  v_linha := '*' || v_nome || ':*';
  if left(new.body, length(v_linha)) is distinct from v_linha then
    new.body := v_linha || E'\n' || new.body;
  end if;
  return new;
end $$;
comment on function app.messages_nome_do_atendente() is
  'Assina o texto livre de WhatsApp e a legenda da foto e do vídeo (desde 16/10/2026) com o primeiro nome de quem escreveu (ou aprovou, se veio da IA) em negrito na primeira linha. Dispara depois do messages_guard.';
revoke all on function app.messages_nome_do_atendente() from public, anon, authenticated;

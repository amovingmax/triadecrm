-- =====================================================================
-- "Correção:" em negrito
--
-- Pedido de 29/10/2026: "A única mudança que quero que aconteça é que a
-- palavra 'correção' esteja em negrito e não em itálico."
--
-- `public.mensagem_corrigir` (migração 20261027110000) mandava "_Correção:_",
-- que o WhatsApp mostra em itálico. Passa a mandar "*Correção:*", em negrito,
-- como o "*Nome:*" da assinatura logo acima. Nada mais muda: a correção
-- continua sendo uma mensagem nova respondendo à original, e a original que
-- ainda estava na fila continua sendo trocada pela certa. As correções que já
-- saíram em itálico ficam como estão; a tela reconhece os dois rótulos.
--
-- RF-CON-05
-- =====================================================================

create or replace function public.mensagem_corrigir(p_message_id uuid, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m      public.messages%rowtype;
  v_novo uuid;
  v_txt  text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  select * into m from public.messages where id = p_message_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_inexistente');
  end if;
  if not app.posso_mexer_na_conversa(m.conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if v_txt is null then
    return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
  end if;
  if m.direction <> 'out'::app.msg_direction or m.type <> 'text'::app.msg_type or m.author_kind <> 'human' then
    return jsonb_build_object('ok', false, 'motivo', 'so_texto_do_time');
  end if;
  -- Na fila ainda? Não precisa de correção: cancela e manda a certa. Os dois
  -- juntos ou nenhum: se a certa for recusada, a errada continua na fila.
  if m.status = 'queued'::app.msg_status then
    begin
      perform public.mensagem_apagar(m.id);
      insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
      values (m.conversation_id, 'out', 'text', 'queued', v_txt, 'human', auth.uid(), 'crm')
      returning id into v_novo;
    exception when insufficient_privilege or check_violation then
      return jsonb_build_object('ok', false, 'motivo', sqlerrm);
    end;
    return jsonb_build_object('ok', true, 'message_id', v_novo, 'substituiu', true);
  end if;
  if m.status = 'failed'::app.msg_status then
    return jsonb_build_object('ok', false, 'motivo', 'nao_saiu');
  end if;

  begin
    insert into public.messages (conversation_id, direction, type, status, body, author_kind,
                                 sent_by, origin, responde_a, corrige_a)
    -- NOVO: negrito (era '_Correção:_ ', itálico).
    values (m.conversation_id, 'out', 'text', 'queued', '*Correção:* ' || v_txt, 'human',
            auth.uid(), 'crm', m.id, m.id)
    returning id into v_novo;
  exception when insufficient_privilege or check_violation then
    return jsonb_build_object('ok', false, 'motivo', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'message_id', v_novo, 'substituiu', false);
end $$;
comment on function public.mensagem_corrigir(uuid, text) is
  'Corrige um texto que já saiu: a Cloud API não edita mensagem, então sai uma nova, "*Correção:* …" (em negrito), respondendo à original. Se a original ainda estava na fila, ela é cancelada e a certa vai no lugar.';
revoke all on function public.mensagem_corrigir(uuid, text) from public, anon;
grant execute on function public.mensagem_corrigir(uuid, text) to authenticated;

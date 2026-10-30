-- =====================================================================
-- O pedido de ligação que a Meta barrou pelo limite (RF-CON-18)
--
-- O teste real de 30/10/2026 mostrou o caso: um pedido feito fora do CRM gastou o limite de
-- 1 por dia, o pedido seguinte voltou com o erro 138009, e o botão ficaria liberado para
-- outra tentativa que também falharia. O pedido recusado com 138009 passa a segurar o botão
-- por 24 h. Ele não conta para o limite de 2 por semana, porque não chegou ao cliente.
-- =====================================================================

create or replace function app.wa_permissao_proximo_pedido(p_conversation_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_desde   timestamptz;
  v_ultimo  timestamptz;
  v_segundo timestamptz;
  v_prox    timestamptz;
begin
  select max(ch.atendida_em) into v_desde
    from public.wa_chamadas ch
   where ch.conversation_id = p_conversation_id and ch.atendida_em is not null;

  select max(m.created_at) into v_ultimo
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'out'::app.msg_direction
     and m.type = 'interactive'::app.msg_type
     and m.template_params ->> 'permissao_de_ligar' = 'true'
     and (m.status <> 'failed'::app.msg_status or m.error_code = '138009')
     and m.created_at > greatest(now() - interval '7 days', coalesce(v_desde, '-infinity'));
  if v_ultimo is null then
    return null;
  end if;

  select m.created_at into v_segundo
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'out'::app.msg_direction
     and m.type = 'interactive'::app.msg_type
     and m.template_params ->> 'permissao_de_ligar' = 'true'
     and m.status <> 'failed'::app.msg_status
     and m.created_at > greatest(now() - interval '7 days', coalesce(v_desde, '-infinity'))
   order by m.created_at desc
   offset 1 limit 1;

  v_prox := v_ultimo + interval '24 hours';
  if v_segundo is not null then
    v_prox := greatest(v_prox, v_segundo + interval '7 days');
  end if;
  return case when v_prox > now() then v_prox end;
end $$;
revoke all on function app.wa_permissao_proximo_pedido(uuid) from public, anon, authenticated;

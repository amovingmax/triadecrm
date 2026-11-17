-- =====================================================================
-- A IA volta a atender 24 h depois do time, só na Imova (17/11/2026)
--
-- Pedido do usuário: "Quero que a IA da Imova fique ligada para atender todos
-- os clientes que entrarem em contato". A IA já estava ligada, no modo
-- clientes, desde 17/11 às 14h04. Mas, quando alguém do time escrevia numa
-- conversa, ou quando a IA passava a conversa para a equipe, ela parava ali
-- PARA SEMPRE. Em 17/11, 22 das 27 conversas recentes estavam assim: se o
-- cliente voltasse a escrever, ninguém respondia sozinho.
--
-- Decidido com ele (pergunta de 17/11): a IA volta quando a mensagem do
-- cliente chega 24 h ou mais depois da última mensagem do time.
--
-- O QUE MUDA, só em `app.ia_atende` (o resto pergunta a ela: a fila, o
-- selo da conversa, a visita, o lembrete):
--   * "Agora" passa a ser a mensagem do cliente que espera resposta: a
--     última da conversa, quando é dele. Sem mensagem esperando, é o
--     momento atual (a tela mostra se a IA responderia a próxima).
--   * O time escreveu nas 24 h antes desse "agora", ou depois dele: a
--     conversa é do time e a IA fica quieta (como antes). Mensagem do time
--     mais velha que isso não conta mais.
--   * A IA passou a conversa para a equipe (`parada`, sem pessoa em
--     `mudou_por`): vale como mensagem do time no momento da passagem. Se a
--     equipe não respondeu e o cliente escreve 24 h depois, a IA volta.
--   * Uma pessoa apertou "Parar a IA" (`parada` com `mudou_por`): continua
--     parada até alguém religar. Essa é a decisão de gente, não vence.
--   * Robô pausado (freio do RF-CON-20 ou opt-out), conversa bloqueada,
--     chave desligada, modo treino: tudo igual.
--
-- Exemplo: o time responde segunda às 10h. O cliente escreve segunda às
-- 10h30: fica com o time (e a IA não responde essa mensagem nem depois). O
-- cliente escreve terça às 11h: a IA responde.
--
-- Na KOMUNE não faz nada: a IA que atende não existe lá.
--
-- COMO DESFAZER: reaplicar `app.ia_atende` da 20261110150000.
-- =====================================================================

do $volta$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é só da Imova: no banco da KOMUNE nada mudou.';
    return;
  end if;

  execute $ddl$
create or replace function app.ia_atende(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg     jsonb := app.ia_atendente_config();
  v_janela  constant interval := interval '24 hours';
  c         public.conversations%rowtype;
  a         public.ia_atendimento%rowtype;
  v_ultima  record;
  v_agora   timestamptz;
  v_desde   timestamptz;
begin
  if not coalesce((v_cfg ->> 'ligada')::boolean, false) then
    return false;
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.channel <> 'whatsapp'::app.channel or c.bloqueada_em is not null then
    return false;
  end if;
  -- O robô pausado (freio do RF-CON-20 ou opt-out): a porteira recusaria.
  if c.bot_paused then
    return false;
  end if;
  if c.id is distinct from app.ia_conversa_de_treino()
     and not app.ia_conversa_de_teste(c.id)
     and coalesce(v_cfg ->> 'modo', 'treino') <> 'clientes' then
    return false;
  end if;

  select * into a from public.ia_atendimento where conversation_id = p_conversation_id;
  -- Uma pessoa parou a IA aqui: fica parada até alguém religar.
  if a.estado = 'parada' and a.mudou_por is not null then
    return false;
  end if;

  -- "Agora": a mensagem do cliente que espera resposta (a última da conversa,
  -- quando é dele); sem ela, o momento atual.
  select m.direction, m.created_at into v_ultima
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
   order by m.created_at desc, m.id desc
   limit 1;
  v_agora := case when v_ultima.direction = 'in'::app.msg_direction then v_ultima.created_at
                  else now() end;

  -- A IA passou para a equipe há menos de 24 h desse "agora": é da equipe.
  if a.estado = 'parada' and a.mudou_em > v_agora - v_janela then
    return false;
  end if;

  -- O time escreveu nas 24 h antes desse "agora" (ou depois dele): é do time.
  -- Mensagem de antes de alguém ligar a IA aqui não conta.
  v_desde := greatest(coalesce(a.mudou_em, '-infinity'::timestamptz), v_agora - v_janela);
  if exists (select 1 from public.messages m
              where m.conversation_id = p_conversation_id
                and m.direction = 'out'::app.msg_direction
                and m.author_kind = 'human'
                and m.created_at > v_desde) then
    return false;
  end if;
  return true;
end $$;
comment on function app.ia_atende(uuid) is
  'A IA que atende (Imova) responde nesta conversa agora? Chave ligada, WhatsApp, não bloqueada, robô não pausado, do treino, de teste ou modo clientes; não parada por uma pessoa; e nem o time escreveu nem a IA passou para a equipe nas 24 h antes da mensagem do cliente que espera resposta (17/11/2026).';
revoke all on function app.ia_atende(uuid) from public, anon;
grant execute on function app.ia_atende(uuid) to authenticated, service_role;
  $ddl$;
end $volta$;

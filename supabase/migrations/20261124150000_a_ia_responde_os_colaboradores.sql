-- =====================================================================
-- A IA que atende responde os Parceiros Colaboradores (Imova, 24/11/2026)
--
-- Pedido do usuário, depois de ver a IA calada com o Janio (Parceiro com a
-- tag Colaborador desde 23/11): "A IA responde sim, Janio sim. Todos os
-- parceiros colaboradores a IA responde, os demais parceiros ela não fala".
--
-- Até aqui (20261123120000) qualquer marca em `public.consultoria` calava a
-- IA. Agora:
--   * tag `colaborador`: a IA responde, como responde um Cliente (as outras
--     regras continuam: time que escreveu nas últimas 24 h, "Parar a IA",
--     passagem para a equipe, robô pausado);
--   * tag `proprietario`, `inquilino` ou marca sem tag: a IA fica quieta,
--     quem responde é a equipe (como antes).
--
-- O QUE MUDA (só na Imova):
--   * `app.ia_atende`: o passo do Parceiro deixa passar a tag colaborador. O
--     resto é o corpo da 20261123120000, igual.
--   * `public.ia_conversa_estado`: `parceiro` passa a dizer "Parceiro que a
--     IA não atende". O Colaborador volta a ver os controles da IA na
--     conversa (a tela esconde tudo quando `parceiro` é verdadeiro), sem
--     publicar o site.
--
-- Na KOMUNE não faz nada: a IA que atende é só da Imova.
--
-- COMO DESFAZER: reaplicar `app.ia_atende` e `public.ia_conversa_estado` da
-- 20261123120000.
-- =====================================================================

do $imova$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é da Imova: nada muda no banco da KOMUNE.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 1. A IA responde o Colaborador; os outros Parceiros ficam com a equipe
  -- -------------------------------------------------------------------
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
  -- Parceiro (23/11/2026): quem já fechou com a Imova fala com a equipe.
  -- Menos o Colaborador (24/11/2026): esse a IA responde.
  if c.organization_id is not null and exists (
       select 1 from public.consultoria k
        where k.organization_id = c.organization_id
          and k.tipo is distinct from 'colaborador') then
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
  'A IA que atende (Imova) responde nesta conversa agora? Chave ligada, WhatsApp, não bloqueada, robô não pausado, ficha que não é Parceiro (23/11/2026) ou é Parceiro Colaborador (24/11/2026), do treino, de teste ou modo clientes; não parada por uma pessoa; e nem o time escreveu nem a IA passou para a equipe nas 24 h antes da mensagem do cliente que espera resposta (17/11/2026).';
revoke all on function app.ia_atende(uuid) from public, anon;
grant execute on function app.ia_atende(uuid) to authenticated, service_role;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 2. A tela: `parceiro` é o Parceiro que a IA não atende
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.ia_conversa_estado(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg      jsonb := app.ia_atendente_config();
  a          public.ia_atendimento%rowtype;
  v_pausou   boolean;
  v_parceiro boolean;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('existe', false);
  end if;
  select * into a from public.ia_atendimento where conversation_id = p_conversation_id;
  v_pausou := coalesce((select c.bot_paused from public.conversations c where c.id = p_conversation_id), false)
              and a.estado is distinct from 'parada';
  -- O Colaborador (24/11/2026) a IA atende: para a tela, é como um Cliente.
  v_parceiro := exists (select 1 from public.conversations c
                          join public.consultoria k on k.organization_id = c.organization_id
                         where c.id = p_conversation_id
                           and k.tipo is distinct from 'colaborador');
  return jsonb_build_object(
    'existe', true,
    'ligada', coalesce((v_cfg ->> 'ligada')::boolean, false),
    'modo', v_cfg ->> 'modo',
    'treino', p_conversation_id is not distinct from app.ia_conversa_de_treino(),
    'teste', app.ia_conversa_de_teste(p_conversation_id),
    'atende', app.ia_atende(p_conversation_id),
    'parceiro', v_parceiro,
    'estado', case when v_pausou then 'parada' else a.estado end,
    'motivo', case when v_parceiro
                   then 'É Parceiro: quem responde é a equipe. A IA responde Clientes e Colaboradores; para ela voltar, mude o perfil para Cliente ou a tag para Colaborador.'
                   when v_pausou
                   then 'O freio do WhatsApp pausou o robô nesta conversa (respostas rápidas ou repetidas demais, ou o cliente pediu para sair). Ligar a IA de novo tira a pausa.'
                   else a.motivo end,
    'mudou_em', a.mudou_em,
    'mudou_por', app.primeiro_nome(a.mudou_por),
    'passada_para', app.primeiro_nome(a.passada_para));
end $$;
revoke all on function public.ia_conversa_estado(uuid) from public, anon;
grant execute on function public.ia_conversa_estado(uuid) to authenticated;
  $ddl$;
end $imova$;

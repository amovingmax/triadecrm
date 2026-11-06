-- =====================================================================
-- A IA que atende e o teto de fala do robô — só na Imova (06/11/2026)
--
-- O que o ensaio com o Haiku 5.5 mostrou, no mesmo dia da publicação: a IA
-- que atende é `bot_ai`, e o teto de fala do robô (RF-CON-20, migração
-- 20260925180000) foi pensado para o robô da captação da KOMUNE, que manda a
-- primeira mensagem e insiste. Na IA que atende ele quebra a conversa:
--
--   * 6 falas por conversa em 24 h: na sétima resposta do dia a porteira
--     recusa, e o cliente fica sem retorno. Uma semana de treino com o Janio
--     passa disso no primeiro dia.
--   * pingue-pongue de 20 s: três respostas seguidas do cliente, cada uma
--     menos de 20 s depois da nossa, pausam o robô PARA SEMPRE naquela conversa
--     (nada tira `bot_paused` de volta). Numa conversa ao vivo, gente responde
--     "sim" e "pode ser" em menos de 20 s.
--
-- O QUE MUDA (só na Imova):
--   1. `app.wa_bot_falas` não conta as respostas da IA que atende (as que têm
--      linha em `ia_respostas`). Ela já tem o teto dela: 20 respostas por hora
--      numa conversa (`ia.atendente.teto_por_hora`), e só fala quando o cliente
--      fala. O fusível global (120 falas de robô por hora, somando todas as
--      conversas), a repetição e o pingue-pongue continuam valendo para ela.
--   2. Pingue-pongue: 8 s em vez de 20 (`whatsapp.robo_teto`). Outro robô
--      responde em 1 a 3 s; gente não lê e responde em menos de 8 s três
--      vezes seguidas.
--   3. Conversa com o robô pausado (pelo freio ou por opt-out): a IA não
--      atende (`app.ia_atende`), para não gastar chamada que a porteira vai
--      recusar, e a tela mostra "IA parada" com o motivo.
--   4. Ligar a IA numa conversa (ou escolhê-la para o treino) tira a pausa do
--      robô, MENOS quando o contato está suprimido, apagado ou pediu para sair
--      (`app.wa_motivo_de_recusa`): aí a pausa fica, e a porteira recusaria de
--      qualquer jeito.
--
-- Na KOMUNE não faz nada: o teto dela continua exatamente como está.
--
-- COMO DESFAZER: reaplicar `app.wa_bot_falas` da 20260925180000 e
-- `app.ia_atende`, `app.ia_atendente_mudar` e `public.ia_conversa_estado` da
-- 20261106170000; e
--   update public.app_settings
--      set value = jsonb_set(value, '{pingue_pongue_segundos}', '20')
--    where key = 'whatsapp.robo_teto';
-- =====================================================================

do $teto$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é só da Imova: o teto de fala da KOMUNE não mudou.';
    return;
  end if;

  execute $ddl$
create or replace function app.wa_bot_falas(p_conversation_id uuid, p_desde timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'out'::app.msg_direction
     and m.author_kind in ('bot_fixed', 'bot_ai')
     and m.status <> 'failed'::app.msg_status
     and not m.optout_confirmation
     and m.template_id is distinct from app.wa_modelo_humano()
     and coalesce(m.sent_at, m.created_at) >= p_desde
     -- A IA que atende (Imova, 06/11/2026) tem o teto dela (teto_por_hora).
     and not exists (select 1 from public.ia_respostas r where r.message_id = m.id)
$$;
comment on function app.wa_bot_falas(uuid, timestamptz) is
  'Quantas vezes o robô falou nesta conversa desde um instante. A despedida (GEN-SYS-HUMANO) e a confirmação de opt-out não contam: uma conversa no teto tem de poder se despedir e tem de poder confirmar a saída de quem pediu. Na Imova, desde 06/11/2026, as respostas da IA que atende também não contam: ela tem o teto dela (ia.atendente.teto_por_hora).';
revoke all on function app.wa_bot_falas(uuid, timestamptz) from public, anon;
grant execute on function app.wa_bot_falas(uuid, timestamptz) to authenticated, service_role;

create or replace function app.ia_atende(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb := app.ia_atendente_config();
  c       public.conversations%rowtype;
  a       public.ia_atendimento%rowtype;
  v_desde timestamptz;
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
  select * into a from public.ia_atendimento where conversation_id = p_conversation_id;
  if a.estado = 'parada' then
    return false;
  end if;
  if c.id is distinct from app.ia_conversa_de_treino()
     and coalesce(v_cfg ->> 'modo', 'treino') <> 'clientes' then
    return false;
  end if;
  v_desde := coalesce(a.mudou_em, '-infinity'::timestamptz);
  if exists (select 1 from public.messages m
              where m.conversation_id = p_conversation_id
                and m.direction = 'out'::app.msg_direction
                and m.author_kind = 'human'
                and m.created_at > v_desde) then
    return false;
  end if;
  return true;
end $$;
revoke all on function app.ia_atende(uuid) from public, anon;
grant execute on function app.ia_atende(uuid) to authenticated, service_role;

create or replace function app.ia_atendente_mudar(
  p_conversation_id uuid, p_estado text, p_motivo text, p_por uuid, p_para uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.conversations%rowtype;
begin
  insert into public.ia_atendimento (conversation_id, estado, motivo, passada_para, mudou_por, mudou_em)
  values (p_conversation_id, p_estado, left(nullif(btrim(coalesce(p_motivo, '')), ''), 300), p_para, p_por, now())
  on conflict (conversation_id) do update
    set estado = excluded.estado, motivo = excluded.motivo, passada_para = excluded.passada_para,
        mudou_por = excluded.mudou_por, mudou_em = excluded.mudou_em;

  -- Ligar a IA tira a pausa do robô, menos de quem não pode receber mensagem.
  if p_estado = 'atendendo' then
    select * into c from public.conversations where id = p_conversation_id;
    if found and c.bot_paused
       and app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164) is null then
      update public.conversations set bot_paused = false, updated_at = now() where id = c.id;
    end if;
  end if;
end $$;
revoke all on function app.ia_atendente_mudar(uuid, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.ia_conversa_estado(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := app.ia_atendente_config();
  a        public.ia_atendimento%rowtype;
  v_pausou boolean;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('existe', false);
  end if;
  select * into a from public.ia_atendimento where conversation_id = p_conversation_id;
  v_pausou := coalesce((select c.bot_paused from public.conversations c where c.id = p_conversation_id), false)
              and a.estado is distinct from 'parada';
  return jsonb_build_object(
    'existe', true,
    'ligada', coalesce((v_cfg ->> 'ligada')::boolean, false),
    'modo', v_cfg ->> 'modo',
    'treino', p_conversation_id is not distinct from app.ia_conversa_de_treino(),
    'atende', app.ia_atende(p_conversation_id),
    'estado', case when v_pausou then 'parada' else a.estado end,
    'motivo', case when v_pausou
                   then 'O freio do WhatsApp pausou o robô nesta conversa (respostas rápidas ou repetidas demais, ou o cliente pediu para sair). Ligar a IA de novo tira a pausa.'
                   else a.motivo end,
    'mudou_em', a.mudou_em,
    'mudou_por', app.primeiro_nome(a.mudou_por),
    'passada_para', app.primeiro_nome(a.passada_para));
end $$;
revoke all on function public.ia_conversa_estado(uuid) from public, anon;
grant execute on function public.ia_conversa_estado(uuid) to authenticated;
  $ddl$;

  update public.app_settings
     set value = jsonb_set(value, '{pingue_pongue_segundos}', '8'),
         description = description || ' Na Imova, pingue_pongue_segundos = 8 desde 06/11/2026 (a IA que atende conversa ao vivo; gente responde "sim" em menos de 20 s).'
   where key = 'whatsapp.robo_teto';
end $teto$;

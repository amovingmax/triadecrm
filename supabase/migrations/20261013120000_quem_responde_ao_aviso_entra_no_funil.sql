-- =====================================================================
-- Quem responde ao aviso de ligação entra no funil, e o interesse é qualificado
--
-- Pedido de 13/10/2026: "Quando o parceiro responder a mensagem e tiver
-- interesse em continuar a conversa, esse parceiro seja qualificado no nosso
-- funil." Decisões do mesmo dia, de quem pediu:
--   * QUALIFICADO = Respondeu + temperatura Quente. Sem etapa nova: o funil foi
--     enxugado em 07/10 ("a conversa inteira acontece em Respondeu"), e o PRD
--     §5.6 já chama de Quente quem declarou interesse;
--   * a IA SUGERE, uma pessoa CONFIRMA (ADR-05): nada fica Quente sozinho.
--
-- Três peças:
--
--   1. A RESPOSTA AO AVISO move para Respondeu. Hoje só a primeira mensagem da
--      conversa inteira move (`app.wa_resposta_no_funil`); quem já tinha
--      conversado antes e responde ao "Tentamos entrar em contato" não andava.
--      `app.wa_resposta_ao_aviso` cobre esse caso, com o mesmo registro
--      ("Respondeu", assinado por quem atende) e o mesmo "só para a frente, só
--      do começo". A primeira mensagem da conversa continua sendo da função de
--      antes — esta sai da frente para não registrar duas vezes.
--
--   2. A SUGESTÃO: a IA já lê cada mensagem recebida (`classify_inbound`, que
--      grava `conversations.ai_intent`). Quando a leitura é de interesse e a
--      conversa respondeu a um aviso, `public.qualificacao_sugerida` diz à tela
--      que vale qualificar. Não move nada.
--
--   3. O CLIQUE: `public.qualificar_pela_conversa` registra o desfecho novo
--      "Interessado" do WhatsApp pelo `registrar_contato` de sempre: Respondeu,
--      Quente, próxima ação "Marcar apresentação" hoje, em nome de quem clicou.
--      O mesmo desfecho fica no Registrar, para quem qualifica sem a IA.
--
-- O CAMINHO DO WHATSAPP NÃO MUDA: nenhuma destas funções grava mensagem de
-- saída nem mexe em conversa, janela, bot ou supressão. A peça 1 é um gatilho
-- de entrada e, como os outros, nunca derruba a gravação da mensagem recebida.
--
-- RF-FUN-01, RF-FUN-04, RF-CON-05, RF-CON-08, RF-MET-06 · ADR-05
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O desfecho "Interessado" no WhatsApp (o 8º da superfície, o teto do RF-MET-06)
-- ---------------------------------------------------------------------
insert into public.interaction_outcomes
  (slug, name, surfaces, position, is_active, cooldown_days, can_reactivate,
   next_action_kind, next_action_label, next_action_offset_days,
   target_stage_slug, sets_temperature, requires_lost_reason, counts_as)
values
  ('wa_interessado', 'Interessado', '{whatsapp}', 108, true, 0, true,
   'meeting', 'Marcar apresentação', 0, 'respondeu', 'quente', false, 'aberta')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- 2. O aviso que a conversa recebeu
-- ---------------------------------------------------------------------
-- A mensagem de aviso de ligação não atendida mais recente da conversa, enviada
-- até p_ate. Nula quando a conversa nunca recebeu aviso.
create or replace function app.aviso_da_conversa(p_conversation_id uuid, p_ate timestamptz default now())
returns public.messages
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
    from public.messages m
    join public.envios_em_massa_itens i on i.message_id = m.id
    join public.envios_em_massa e on e.id = i.envio_id
   where m.conversation_id = p_conversation_id
     and e.finalidade = 'ligacao_nao_atendida'
     and m.direction = 'out'::app.msg_direction
     and m.status <> 'failed'::app.msg_status
     and m.created_at <= p_ate
   order by m.created_at desc
   limit 1
$$;
revoke all on function app.aviso_da_conversa(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. A resposta ao aviso move para Respondeu
-- ---------------------------------------------------------------------
create or replace function app.wa_resposta_ao_aviso(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m        public.messages%rowtype;
  c        public.conversations%rowtype;
  a        public.messages%rowtype;
  v_deal   uuid;
  v_ativ   uuid;
  v_andou  boolean := false;
begin
  select * into m from public.messages where id = p_message_id;
  if not found or m.direction <> 'in'::app.msg_direction then
    return jsonb_build_object('registrado', false, 'motivo', 'nao_e_entrada');
  end if;
  select * into c from public.conversations where id = m.conversation_id;
  if c.organization_id is null then
    return jsonb_build_object('registrado', false, 'motivo', 'fora_da_base');
  end if;

  a := app.aviso_da_conversa(c.id, m.created_at);
  if a.id is null or a.created_at < m.created_at - interval '7 days' then
    return jsonb_build_object('registrado', false, 'motivo', 'sem_aviso_recente');
  end if;
  -- Só a PRIMEIRA resposta depois do aviso: as seguintes são a conversa.
  if exists (select 1 from public.messages x
              where x.conversation_id = c.id and x.direction = 'in'::app.msg_direction
                and x.id <> m.id and x.created_at > a.created_at and x.created_at <= m.created_at) then
    return jsonb_build_object('registrado', false, 'motivo', 'nao_e_a_primeira_depois_do_aviso');
  end if;
  -- A primeira mensagem da conversa inteira é de `app.wa_resposta_no_funil`.
  if not exists (select 1 from public.messages x
                  where x.conversation_id = c.id and x.direction = 'in'::app.msg_direction
                    and x.id <> m.id and x.created_at <= m.created_at) then
    return jsonb_build_object('registrado', false, 'motivo', 'primeira_da_conversa');
  end if;
  if exists (select 1 from public.activities x where x.message_id = m.id) then
    return jsonb_build_object('registrado', false, 'motivo', 'ja_registrado');
  end if;
  if app.is_suppressed_target(c.organization_id, c.contact_id) then
    return jsonb_build_object('registrado', false, 'motivo', 'contato_suprimido');
  end if;

  v_deal := app.wa_negocio_da_ficha(c.organization_id);

  insert into public.activities (type, channel, organization_id, contact_id, deal_id, user_id,
                                 author_kind, occurred_at, body, outcome_id, message_id, metadata)
  values ('message'::app.activity_type, 'whatsapp'::app.channel, c.organization_id, c.contact_id,
          v_deal, c.assignee_id, 'system', m.created_at,
          nullif(left(btrim(coalesce(m.body, m.transcript, '')), 280), ''),
          (select o.id from public.interaction_outcomes o where o.slug = 'wa_respondeu' and o.is_active),
          m.id,
          jsonb_build_object('com_quem', 'nao_informado', 'origem', 'resposta_ao_aviso_de_ligacao',
                             'aviso_message_id', a.id))
  returning id into v_ativ;

  if v_deal is not null then
    v_andou := app.wa_avancar_negocio(v_deal, 'respondeu',
                                      array['prospectado', 'identificado', 'contatado']);
  end if;
  return jsonb_build_object('registrado', true, 'activity_id', v_ativ, 'negocio_andou', v_andou);
end $$;
comment on function app.wa_resposta_ao_aviso(uuid) is
  'Primeira resposta depois de um aviso de ligação não atendida (até 7 dias), numa conversa que já tinha mensagem recebida antes: registra "Respondeu" e leva o negócio para Respondeu se ele estava em Prospectado, Identificado ou Contatado. A primeira mensagem da conversa é de app.wa_resposta_no_funil. Idempotente pela mensagem.';
revoke all on function app.wa_resposta_ao_aviso(uuid) from public, anon, authenticated;

create or replace function app.messages_resposta_ao_aviso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.wa_resposta_ao_aviso(new.id);
  exception when others then
    -- A mensagem que chegou vale mais que o registro dela no funil.
    raise warning 'wa_resposta_ao_aviso(%): %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function app.messages_resposta_ao_aviso() from public, anon, authenticated;

-- O nome põe este gatilho DEPOIS de `messages_resposta_no_funil` (a ordem dos
-- gatilhos AFTER é a alfabética).
drop trigger if exists messages_resposta_no_funil_aviso on public.messages;
create trigger messages_resposta_no_funil_aviso after insert on public.messages
  for each row when (new.direction = 'in'::app.msg_direction)
  execute function app.messages_resposta_ao_aviso();

-- ---------------------------------------------------------------------
-- 4. A sugestão de qualificar
-- ---------------------------------------------------------------------
-- As leituras da IA que contam como "quer continuar a conversa": as quentes do
-- R08 (intencoes.ts) mais "quer entender melhor" e "manda material".
create or replace function app.intencao_de_interesse(p_intencao text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select upper(coalesce(p_intencao, '')) in
    ('INTERESSADO', 'AUTORIZA_PRE_CADASTRO', 'QUER_SABER_MAIS', 'PEDIU_TAXA_PRECO',
     'PEDIU_LIGACAO', 'AGENDAMENTO_ACEITO', 'AGENDAMENTO_CONTRAPROPOSTA', 'REAGENDAR',
     'PERGUNTA_CONTRATUAL', 'MANDA_MATERIAL')
$$;
revoke all on function app.intencao_de_interesse(text) from public, anon, authenticated;

-- O miolo, sem checagem de quem pergunta (as duas portas públicas checam).
create or replace function app.qualificacao_da_conversa(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c       public.conversations%rowtype;
  a       public.messages%rowtype;
  d       public.deals%rowtype;
  v_etapa text;
  v_funil text;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.organization_id is null then
    return jsonb_build_object('sugerir', false, 'motivo', 'fora_da_base');
  end if;
  a := app.aviso_da_conversa(c.id);
  if a.id is null
     or not exists (select 1 from public.messages x
                     where x.conversation_id = c.id and x.direction = 'in'::app.msg_direction
                       and x.created_at > a.created_at) then
    return jsonb_build_object('sugerir', false, 'motivo', 'sem_resposta_ao_aviso');
  end if;
  if not app.intencao_de_interesse(c.ai_intent)
     or coalesce(c.ai_confidence, 1) < 0.7 then
    return jsonb_build_object('sugerir', false, 'motivo', 'ia_sem_interesse');
  end if;
  if app.is_suppressed_target(c.organization_id, c.contact_id) then
    return jsonb_build_object('sugerir', false, 'motivo', 'contato_suprimido');
  end if;

  select * into d from public.deals where id = app.wa_negocio_da_ficha(c.organization_id);
  if not found then
    return jsonb_build_object('sugerir', false, 'motivo', 'sem_negocio_aberto');
  end if;
  select s.slug, p.slug into v_etapa, v_funil
    from public.stages s join public.pipelines p on p.id = s.pipeline_id where s.id = d.stage_id;
  if v_funil not in ('fornecedor', 'produtor')
     or v_etapa not in ('prospectado', 'identificado', 'contatado', 'respondeu') then
    return jsonb_build_object('sugerir', false, 'motivo', 'etapa_adiante');
  end if;
  if d.temperature = 'quente'::app.temperature then
    return jsonb_build_object('sugerir', false, 'motivo', 'ja_quente');
  end if;
  if exists (select 1 from public.activities x
               join public.interaction_outcomes o on o.id = x.outcome_id
              where x.deal_id = d.id and o.slug = 'wa_interessado' and x.occurred_at >= a.created_at) then
    return jsonb_build_object('sugerir', false, 'motivo', 'ja_qualificado');
  end if;

  return jsonb_build_object('sugerir', true, 'intencao', upper(c.ai_intent),
                            'confianca', c.ai_confidence, 'deal_id', d.id,
                            'organization_id', c.organization_id, 'conversation_id', c.id,
                            'etapa', v_etapa);
end $$;
revoke all on function app.qualificacao_da_conversa(uuid) from public, anon, authenticated;

create or replace function public.qualificacao_sugerida(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  select organization_id into v_org from public.conversations where id = p_conversation_id;
  if v_org is null or not app.org_is_visible(v_org) or not app.can_write() then
    return jsonb_build_object('sugerir', false, 'motivo', 'sem_permissao');
  end if;
  return app.qualificacao_da_conversa(p_conversation_id);
end $$;
comment on function public.qualificacao_sugerida(uuid) is
  'A IA leu interesse na resposta a um aviso de ligação não atendida, e o negócio ainda não está Quente? Devolve {sugerir, intencao, confianca, deal_id, etapa} ou {sugerir:false, motivo}. Não move nada.';
revoke all on function public.qualificacao_sugerida(uuid) from public, anon;
grant execute on function public.qualificacao_sugerida(uuid) to authenticated;

-- Para o Meu dia: as organizações (visíveis a quem pergunta) com sugestão aberta.
create or replace function public.qualificacoes_sugeridas()
returns table (organization_id uuid, conversation_id uuid, intencao text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return;
  end if;
  return query
  select c.organization_id, c.id, upper(c.ai_intent)
    from public.conversations c
   where c.organization_id is not null
     and app.intencao_de_interesse(c.ai_intent)
     and c.last_inbound_at > now() - interval '14 days'
     and app.org_is_visible(c.organization_id)
     and (app.qualificacao_da_conversa(c.id) ->> 'sugerir')::boolean;
end $$;
comment on function public.qualificacoes_sugeridas() is
  'As conversas com sugestão de qualificar abertas (resposta a aviso de ligação, leitura de interesse da IA, negócio ainda não Quente), das organizações que quem pergunta enxerga. Para o selo do Meu dia.';
revoke all on function public.qualificacoes_sugeridas() from public, anon;
grant execute on function public.qualificacoes_sugeridas() to authenticated;

-- ---------------------------------------------------------------------
-- 5. O clique: qualificar
-- ---------------------------------------------------------------------
create or replace function public.qualificar_pela_conversa(p_conversation_id uuid, p_client_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sug  jsonb;
  v_org  uuid;
  v_ret  jsonb;
  v_rot  text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  select organization_id into v_org from public.conversations where id = p_conversation_id;
  if v_org is null or not app.org_is_visible(v_org) or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  v_sug := app.qualificacao_da_conversa(p_conversation_id);
  if not (v_sug ->> 'sugerir')::boolean then
    -- Idempotência: o segundo clique (ou a outra aba) encontra o trabalho feito.
    if v_sug ->> 'motivo' in ('ja_qualificado', 'ja_quente') then
      return jsonb_build_object('ok', true, 'ja_estava', true);
    end if;
    return jsonb_build_object('ok', false, 'motivo', v_sug ->> 'motivo');
  end if;

  v_rot := case v_sug ->> 'intencao'
             when 'INTERESSADO' then 'demonstrou interesse'
             when 'QUER_SABER_MAIS' then 'quer entender melhor'
             when 'PEDIU_LIGACAO' then 'pediu uma ligação'
             when 'PEDIU_TAXA_PRECO' then 'perguntou a taxa'
             when 'MANDA_MATERIAL' then 'pediu material por escrito'
             else 'mostrou interesse'
           end;

  v_ret := public.registrar_contato(
    p_client_key      => p_client_key,
    p_organization_id => v_org,
    p_outcome_id      => (select o.id from public.interaction_outcomes o
                           where o.slug = 'wa_interessado' and o.is_active),
    p_com_quem        => 'nao_informado',
    p_deal_id         => (v_sug ->> 'deal_id')::uuid,
    p_body            => format('Respondeu ao aviso de ligação e %s (leitura da IA, confirmada na conversa).', v_rot));

  return jsonb_build_object('ok', coalesce((v_ret ->> 'registrado')::boolean, false),
                            'motivo', v_ret ->> 'motivo', 'registro', v_ret);
end $$;
comment on function public.qualificar_pela_conversa(uuid, uuid) is
  'O "Qualificar" da conversa: confirma a sugestão da IA registrando o desfecho "Interessado" do WhatsApp (Respondeu, Quente, próxima ação "Marcar apresentação") em nome de quem clicou, pelo registrar_contato. Só com sugestão aberta; idempotente pela client_key e pelo "já qualificado".';
revoke all on function public.qualificar_pela_conversa(uuid, uuid) from public, anon;
grant execute on function public.qualificar_pela_conversa(uuid, uuid) to authenticated;

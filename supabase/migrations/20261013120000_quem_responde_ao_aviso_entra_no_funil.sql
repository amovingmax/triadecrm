-- =====================================================================
-- Quem responde ao aviso de ligação é qualificado no funil
--
-- Pedido de 13/10/2026: "Quando o parceiro responder a mensagem e tiver
-- interesse em continuar a conversa, esse parceiro seja qualificado no nosso
-- funil." Decisões do mesmo dia, de quem pediu:
--   * QUALIFICADO = Respondeu + temperatura Quente. Sem etapa nova: o funil foi
--     enxugado em 07/10 ("a conversa inteira acontece em Respondeu"), e o PRD
--     §5.6 já chama de Quente quem declarou interesse;
--   * NADA QUE GERE CUSTO: sem leitura da IA (que é paga por mensagem). Responder
--     ao "Tentamos entrar em contato" já é o sinal; a regra é do banco.
--
-- A primeira resposta depois do aviso (até 7 dias):
--   * fica registrada como "Respondeu" e leva o negócio para Respondeu, mesmo em
--     conversa que já existia (hoje só a primeira mensagem da conversa inteira
--     movia, por `app.wa_resposta_no_funil`, que continua dona desse caso);
--   * deixa o negócio QUENTE pela intenção declarada (`deals.last_intent =
--     'interessado'`), a mesma entrada que o `registrar_contato` usa para a regra
--     oficial de temperatura (`app.compute_temperature`, PRD §5.6);
--   * NÃO esquenta quem pede para sair (`app.wa_parece_optout`) nem quem recusa
--     com todas as letras (`app.recusa_clara`): esses ficam só com o registro.
--
-- O CAMINHO DO WHATSAPP NÃO MUDA: nenhuma destas funções grava mensagem de
-- saída nem mexe em conversa, janela, bot ou supressão. É um gatilho de entrada
-- e, como os outros, nunca derruba a gravação da mensagem recebida.
--
-- RF-FUN-01, RF-FUN-04, RF-CON-05, RF-CON-08
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O aviso que a conversa recebeu
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
-- 2. A recusa com todas as letras
-- ---------------------------------------------------------------------
-- Sem IA, o banco não sabe ler interesse; sabe reconhecer o "não" que não tem
-- outra leitura. Mesmo jeito de `app.wa_parece_optout` (minúsculas, sem acento,
-- sem pontuação). Quem recusa continua em Respondeu, porque respondeu; só não
-- vira Quente.
create or replace function app.recusa_clara(p_texto text)
returns boolean
language sql
stable
set search_path = ''
as $$
  with limpo as (
    select btrim(regexp_replace(
             regexp_replace(extensions.unaccent(lower(coalesce(p_texto, ''))), '[^a-z0-9\s]', ' ', 'g'),
             '\s+', ' ', 'g')) as t
  )
  select exists (
      select 1 from limpo where t = any (array['nao', 'nao obrigado', 'nao obrigada', 'nao valeu']))
      or exists (
      select 1 from limpo,
           unnest(array['nao tenho interesse', 'sem interesse', 'nao estou interessad',
                        'nao me interessa', 'nao interessa', 'nao preciso', 'nao quero',
                        'numero errado', 'engano', 'nao conheco', 'nao sou eu',
                        'nao trabalho mais', 'nao trabalho com']) f(frase)
       where position(f.frase in t) > 0)
$$;
comment on function app.recusa_clara(text) is
  'A mensagem é uma recusa sem outra leitura ("não tenho interesse", "número errado", "não, obrigado")? Usada para não deixar Quente quem respondeu ao aviso de ligação dizendo não.';
revoke all on function app.recusa_clara(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. A resposta ao aviso: Respondeu e Quente
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
  v_texto  text;
  v_deal   uuid;
  v_ativ   uuid;
  v_andou  boolean := false;
  v_etapa  text;
  v_funil  text;
  v_quente boolean := false;
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
  if app.is_suppressed_target(c.organization_id, c.contact_id) then
    return jsonb_build_object('registrado', false, 'motivo', 'contato_suprimido');
  end if;
  v_texto := coalesce(m.body, m.transcript, '');
  if app.wa_parece_optout(v_texto) then
    -- Quem cria a supressão é o worker; aqui só não se registra interesse.
    return jsonb_build_object('registrado', false, 'motivo', 'pediu_para_sair');
  end if;

  v_deal := app.wa_negocio_da_ficha(c.organization_id);

  -- O "Respondeu". Quando esta é a primeira mensagem da conversa inteira,
  -- `app.wa_resposta_no_funil` (gatilho anterior) já registrou e já moveu.
  if not exists (select 1 from public.activities x where x.message_id = m.id) then
    insert into public.activities (type, channel, organization_id, contact_id, deal_id, user_id,
                                   author_kind, occurred_at, body, outcome_id, message_id, metadata)
    values ('message'::app.activity_type, 'whatsapp'::app.channel, c.organization_id, c.contact_id,
            v_deal, c.assignee_id, 'system', m.created_at,
            nullif(left(btrim(v_texto), 280), ''),
            (select o.id from public.interaction_outcomes o where o.slug = 'wa_respondeu' and o.is_active),
            m.id,
            jsonb_build_object('com_quem', 'nao_informado', 'origem', 'resposta_ao_aviso_de_ligacao',
                               'aviso_message_id', a.id))
    returning id into v_ativ;
  end if;

  if v_deal is not null then
    v_andou := app.wa_avancar_negocio(v_deal, 'respondeu',
                                      array['prospectado', 'identificado', 'contatado']);

    -- O "qualificado": Quente pela intenção declarada, só no começo do funil de
    -- captação (quem já está em Reunião marcada em diante não é mexido).
    select s.slug, p.slug into v_etapa, v_funil
      from public.deals d
      join public.stages s on s.id = d.stage_id
      join public.pipelines p on p.id = d.pipeline_id
     where d.id = v_deal and d.status = 'open'::app.deal_status;
    if v_funil in ('fornecedor', 'produtor') and v_etapa = 'respondeu'
       and not app.recusa_clara(v_texto) then
      update public.deals
         set last_intent = 'interessado', last_intent_at = m.created_at, updated_at = now()
       where id = v_deal;
      select d.temperature = 'quente'::app.temperature into v_quente
        from public.deals d where d.id = v_deal;
    end if;
  end if;
  return jsonb_build_object('registrado', true, 'activity_id', v_ativ, 'negocio_andou', v_andou,
                            'qualificado', coalesce(v_quente, false));
end $$;
comment on function app.wa_resposta_ao_aviso(uuid) is
  'Primeira resposta depois de um aviso de ligação não atendida (até 7 dias): registra "Respondeu" (se a primeira mensagem da conversa já não o fez), leva o negócio para Respondeu e o deixa Quente pela intenção "interessado" (PRD §5.6). Pedido de saída ou recusa clara não esquentam. Sem IA, sem custo; idempotente pela mensagem.';
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


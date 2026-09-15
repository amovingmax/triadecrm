-- A conversa de quem não é ficha, e o funil que anda sozinho com o WhatsApp.
--
-- Três pendências do WhatsApp dentro do CRM (14/09/2026), fechadas juntas:
--
--   A. **O cliente não manda modelo por conta própria.** A policy `messages_insert`
--      aceitava `template_id` direto do navegador, o que pulava as travas de
--      `public.wa_enviar_modelo` (parâmetros, aprovação da Meta, nome de quem
--      envia). Modelo agora só sai pela RPC; a caixa de texto continua igual.
--   B. **Quem escreve de um número fora da base aparece, e vira ficha.** A conversa
--      nasce sem `organization_id` quando o número não é de ficha nenhuma, e a tela
--      Conversas, que é montada por ficha, simplesmente não a mostrava.
--      `public.vincular_conversa` liga a conversa a uma ficha que já existe;
--      `public.criar_ficha_da_conversa` cria a ficha pelo cadastro rápido (mesma
--      dedup, mesma supressão) com a origem nova "Chegou pelo WhatsApp".
--   C. **O funil anda com o WhatsApp.** Antes, mandar a primeira mensagem pelo CRM
--      não registrava contato nenhum e a resposta do parceiro não mexia no negócio:
--      a pessoa tinha de ir à `/registrar` repetir o que o sistema já sabia.
--        * primeira mensagem enviada pelo CRM → contato "Enviado, sem resposta"
--          (follow-up D+3 do catálogo) e o negócio sai da primeira etapa para
--          "Contatado";
--        * primeira resposta do parceiro → contato "Respondeu" e o negócio vai para
--          "Respondeu", se ainda estava antes dela.
--      Só anda PARA FRENTE e só a partir das etapas iniciais: negócio em conversa,
--      reunião ou perdido não é tocado. Nada disso barra a mensagem: se o registro
--      falhar, a mensagem sai (ou entra) do mesmo jeito, e o motivo fica no log.
--      Contato suprimido não ganha registro nenhum (RF-CON-18).


-- =====================================================================
-- A. Modelo só pela RPC
-- =====================================================================
alter policy messages_insert on public.messages
  with check (
    (select app.can_write())
    and origin = 'crm'
    and direction = 'out'::app.msg_direction
    and author_kind = any (array['human', 'bot_fixed'])
    and sent_by = (select auth.uid())
    and not optout_confirmation
    -- A: modelo tem porta própria (public.wa_enviar_modelo, security definer).
    and template_id is null
    and type <> 'template'::app.msg_type
    and exists (
      select 1 from public.conversations c
       where c.id = messages.conversation_id
         and ((select app.sees_all())
              or c.assignee_id = (select auth.uid())
              or ((select app.role()) = 'embaixador'::app.user_role
                  and c.organization_id is not null
                  and (select app.org_is_mine(c.organization_id))))));


-- =====================================================================
-- B. A origem de quem chega pelo WhatsApp
-- =====================================================================
insert into public.sources (slug, name, kind, base_url, legal_basis, terms_notes, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values ('whatsapp_entrada', 'Chegou pelo WhatsApp', 'manual', null, 'legitimo_interesse',
        'A pessoa escreveu para o número da KOMUNE e alguém do time criou a ficha a partir da conversa. O dado veio dela mesma, no contexto de um contato comercial que ela iniciou.',
        null, 0.00, true,
        '{"collector": {"kind": "manual", "phase": "mvp", "enabled": true}}')
on conflict (slug) do nothing;


-- =====================================================================
-- C. O funil que anda com o WhatsApp
-- =====================================================================
-- A etapa inicial de onde a mensagem pode tirar o negócio, e para onde ela vai.
create or replace function app.wa_avancar_negocio(p_deal_id uuid, p_para text, p_de text[])
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  d       public.deals%rowtype;
  v_atual text;
  v_alvo  int;
begin
  select * into d from public.deals where id = p_deal_id and status = 'open'::app.deal_status;
  if not found then
    return false;
  end if;
  select s.slug into v_atual from public.stages s where s.id = d.stage_id;
  if not (v_atual = any (p_de)) then
    return false;
  end if;
  select s.id into v_alvo from app.stage_for(d.pipeline_id, p_para) s;
  if v_alvo is null or v_alvo = d.stage_id then
    return false;
  end if;
  update public.deals set stage_id = v_alvo, updated_at = now() where id = d.id;
  return true;
end $$;
comment on function app.wa_avancar_negocio(uuid, text, text[]) is
  'Leva o negócio aberto para a etapa p_para (resolvida no funil dele) só quando ele está numa das etapas p_de. É o "só para a frente, só do começo" do WhatsApp que anda sozinho.';
revoke all on function app.wa_avancar_negocio(uuid, text, text[]) from public, anon, authenticated;

-- O negócio que a conversa mexe: o aberto da ficha, preferindo os de captação.
create or replace function app.wa_negocio_da_ficha(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
    from public.deals d
    join public.pipelines p on p.id = d.pipeline_id
   where d.organization_id = p_organization_id
     and d.status = 'open'::app.deal_status
   order by (p.slug in ('fornecedor', 'produtor')) desc,
            d.last_activity_at desc nulls last, d.created_at
   limit 1
$$;
revoke all on function app.wa_negocio_da_ficha(uuid) from public, anon, authenticated;

-- C.1 · A primeira resposta de uma conversa.
create or replace function app.wa_resposta_no_funil(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m        public.messages%rowtype;
  c        public.conversations%rowtype;
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
  -- Só a PRIMEIRA resposta: as seguintes são a conversa, não um marco do funil.
  if exists (select 1 from public.messages x
              where x.conversation_id = c.id and x.direction = 'in'::app.msg_direction
                and x.id <> m.id and x.created_at <= m.created_at) then
    return jsonb_build_object('registrado', false, 'motivo', 'nao_e_a_primeira');
  end if;
  if exists (select 1 from public.activities a where a.message_id = m.id) then
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
          jsonb_build_object('com_quem', 'nao_informado', 'origem', 'whatsapp_automatico'))
  returning id into v_ativ;

  if v_deal is not null then
    v_andou := app.wa_avancar_negocio(v_deal, 'respondeu',
                                      array['prospectado', 'identificado', 'contatado']);
  end if;
  return jsonb_build_object('registrado', true, 'activity_id', v_ativ, 'negocio_andou', v_andou);
end $$;
comment on function app.wa_resposta_no_funil(uuid) is
  'Primeira resposta do parceiro numa conversa de ficha: registra o contato "Respondeu" (assinado por quem atende a conversa) e leva o negócio para Respondeu se ele ainda estava em Prospectado, Identificado ou Contatado. Idempotente pela mensagem. Contato suprimido não é registrado.';
revoke all on function app.wa_resposta_no_funil(uuid) from public, anon, authenticated;

create or replace function app.messages_resposta_no_funil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.wa_resposta_no_funil(new.id);
  exception when others then
    -- A mensagem que chegou vale mais que o registro dela no funil.
    raise warning 'wa_resposta_no_funil(%): %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function app.messages_resposta_no_funil() from public, anon, authenticated;

drop trigger if exists messages_resposta_no_funil on public.messages;
create trigger messages_resposta_no_funil after insert on public.messages
  for each row when (new.direction = 'in'::app.msg_direction)
  execute function app.messages_resposta_no_funil();

-- C.2 · A primeira mensagem que sai pelo CRM (chamada de dentro de wa_enviar_modelo,
-- com a sessão de quem clicou: o contato é registrado em nome dela).
create or replace function app.wa_envio_no_funil(p_organization_id uuid, p_template_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg   jsonb;
  v_deal  uuid;
  v_andou boolean := false;
begin
  if app.is_suppressed_target(p_organization_id, null) then
    return jsonb_build_object('registrado', false, 'motivo', 'contato_suprimido');
  end if;
  v_deal := app.wa_negocio_da_ficha(p_organization_id);
  v_reg := public.registrar_contato(
    p_client_key      => gen_random_uuid(),
    p_organization_id => p_organization_id,
    p_outcome_id      => (select o.id from public.interaction_outcomes o
                           where o.slug = 'wa_sem_resposta' and o.is_active),
    p_deal_id         => v_deal,
    p_body            => 'Primeira mensagem pelo WhatsApp do CRM (' || p_template_code || ').');
  if v_deal is not null then
    v_andou := app.wa_avancar_negocio(v_deal, 'contatado', array['prospectado', 'identificado']);
  end if;
  return coalesce(v_reg, '{}'::jsonb) || jsonb_build_object('negocio_andou', v_andou);
end $$;
comment on function app.wa_envio_no_funil(uuid, text) is
  'Primeira mensagem de uma ficha enviada pelo CRM: registra "Enviado, sem resposta" (com o follow-up D+3 do catálogo) em nome de quem clicou e leva o negócio de Prospectado/Identificado para Contatado.';
revoke all on function app.wa_envio_no_funil(uuid, text) from public, anon, authenticated;


create or replace function public.wa_enviar_modelo(p_organization_id uuid,
                                                   p_template_id     int,
                                                   p_parametros      jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu       uuid := auth.uid();
  o          public.organizations%rowtype;
  t          public.message_templates%rowtype;
  v_numero   text := app.wa_numero_padrao();
  v_tel      text;
  v_ct       uuid;
  v_conv     uuid;
  v_msg      uuid;
  v_primeiro boolean;
  v_var      text;
  v_valor    text;
  v_params   jsonb := '{}'::jsonb;
  v_entrada  jsonb;
  v_faltando text[] := '{}'::text[];
  v_corpo    text;
begin
  -- Gente, não máquina: o envio é assinado por quem clicou (ADR-05).
  if v_eu is null or app.e_o_worker() or not app.can_write() then
    raise exception 'Sem permissão para enviar mensagem pelo WhatsApp' using errcode = '42501';
  end if;
  select * into o from public.organizations
   where id = p_organization_id and deleted_at is null;
  if not found or not app.org_is_visible(o.id) then
    raise exception 'Ficha não encontrada' using errcode = 'P0002';
  end if;

  if v_numero is null then
    raise exception 'Envio recusado: whatsapp_nao_configurado (RF-CON-01)' using errcode = '42501';
  end if;

  select d.telefone, d.contact_id into v_tel, v_ct from app.wa_destino_da_ficha(o.id) d;
  if v_tel is null then
    raise exception 'Envio recusado: ficha_sem_whatsapp' using errcode = '42501';
  end if;

  select * into t from public.message_templates
   where id = p_template_id and is_active and channel = 'whatsapp'::app.channel;
  if not found then
    raise exception 'Envio recusado: modelo_inexistente' using errcode = '42501';
  end if;
  -- As mensagens do sistema têm dono: a confirmação de opt-out é do
  -- `wa_optout_registrar`, e as outras não são para ser mandadas à mão.
  if t.template_code like 'GEN-SYS-%' then
    raise exception 'Envio recusado: modelo_de_sistema' using errcode = '42501';
  end if;

  -- `{{atendente}}` é sempre quem clicou, e quem chama não escolhe: um nome
  -- digitado ali seria alguém se apresentando como outra pessoa do time.
  v_entrada := coalesce(p_parametros, '{}'::jsonb)
               || jsonb_build_object('atendente', app.primeiro_nome(v_eu));

  -- Toda variável do corpo precisa de valor. Chave a mais é descartada: o que
  -- fica gravado é exatamente o que vai no fio.
  foreach v_var in array app.modelo_variaveis(t.body) loop
    v_valor := app.modelo_parametro_limpo(v_entrada ->> v_var);
    if v_valor is null then
      v_faltando := v_faltando || v_var;
    elsif length(v_valor) > 200 then
      raise exception 'Envio recusado: parametro_longo_demais (%)', v_var using errcode = '22023';
    else
      v_params := v_params || jsonb_build_object(v_var, v_valor);
    end if;
  end loop;
  if cardinality(v_faltando) > 0 then
    raise exception 'Envio recusado: modelo_sem_parametro (%)', array_to_string(v_faltando, ', ')
      using errcode = '22023';
  end if;
  v_corpo := app.modelo_renderizar(t.body, v_params);

  -- A conversa: uma por par (número da empresa × número da pessoa).
  select c.id into v_conv from public.conversations c
   where c.channel = 'whatsapp'::app.channel
     and c.business_number = v_numero and c.peer_phone_e164 = v_tel;
  if v_conv is null then
    insert into public.conversations (channel, business_number, peer_phone_e164,
                                      organization_id, contact_id, assignee_id, status)
    values ('whatsapp'::app.channel, v_numero, v_tel, o.id, v_ct,
            coalesce((select p.id from public.profiles p where p.id = o.owner_id and p.is_active), v_eu),
            'aguardando_parceiro')
    returning id into v_conv;
  else
    update public.conversations
       set organization_id = coalesce(organization_id, o.id),
           contact_id      = coalesce(contact_id, v_ct)
     where id = v_conv and (organization_id is null or contact_id is null);
  end if;

  -- Fora da janela de 24 h só vai modelo que a META aprovou. É a pergunta que
  -- `public.wa_saida_proximos` faz na saída; fazê-la aqui evita enfileirar uma
  -- mensagem que nasceria para morrer com `sem_modelo_aprovado`.
  if not app.janela_de_24h_aberta(v_conv, now())
     and not coalesce((app.wa_modelo_da_meta(t.id) ->> 'aprovado')::boolean, false) then
    raise exception 'Envio recusado: modelo_nao_aprovado_na_meta' using errcode = '42501';
  end if;

  -- O `messages_guard` confere supressão, janela de horário e tetos, e recusa
  -- com exceção — que desfaz também a conversa criada acima.
  insert into public.messages (conversation_id, direction, type, status, body,
                               template_id, template_params, author_kind, sent_by, origin)
  values (v_conv, 'out'::app.msg_direction, 'template'::app.msg_type, 'queued'::app.msg_status,
          v_corpo, t.id, v_params, 'human', v_eu, 'crm')
  returning id, is_first_contact into v_msg, v_primeiro;

  -- C.2: a primeira mensagem conta no funil. Falha aqui não barra o envio.
  if v_primeiro then
    begin
      perform app.wa_envio_no_funil(o.id, t.template_code);
    exception when others then
      raise warning 'wa_envio_no_funil(%): %', o.id, sqlerrm;
    end;
  end if;

  return jsonb_build_object('ok', true, 'conversation_id', v_conv, 'message_id', v_msg,
                            'primeiro_contato', v_primeiro, 'corpo', v_corpo);
end $$;
comment on function public.wa_enviar_modelo(uuid, int, jsonb) is
  'Envia um modelo de mensagem para o WhatsApp de uma ficha: acha ou cria a conversa, exige valor para toda variável, exige aprovação da Meta fora da janela de 24 h e enfileira a mensagem assinada por quem clicou. Supressão, horário e tetos são do messages_guard.';
revoke all on function public.wa_enviar_modelo(uuid, int, jsonb) from public, anon;
grant execute on function public.wa_enviar_modelo(uuid, int, jsonb) to authenticated;

-- =====================================================================
-- B. Ligar a conversa a uma ficha, ou criar a ficha a partir dela
-- =====================================================================
create or replace function public.vincular_conversa(p_conversation_id uuid, p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu   uuid := auth.uid();
  c      public.conversations%rowtype;
  o      public.organizations%rowtype;
  v_ct   uuid;
  v_resp uuid;
begin
  if v_eu is null or app.e_o_worker() or not app.can_write() then
    raise exception 'Sem permissão para ligar conversa a ficha' using errcode = '42501';
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or not (app.sees_all() or c.assignee_id = v_eu) then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;
  if c.organization_id is not null then
    return jsonb_build_object('ok', c.organization_id = p_organization_id,
                              'motivo', 'ja_vinculada', 'organization_id', c.organization_id);
  end if;
  select * into o from public.organizations where id = p_organization_id and deleted_at is null;
  if not found or not app.org_is_visible(o.id) then
    return jsonb_build_object('ok', false, 'motivo', 'ficha_inexistente');
  end if;

  -- A pessoa da ficha com este número, se houver.
  select ct.id into v_ct
    from public.organization_contacts oc
    join public.contacts ct on ct.id = oc.contact_id and ct.deleted_at is null
   where oc.organization_id = o.id and ct.phone_e164 = c.peer_phone_e164
   limit 1;

  update public.conversations
     set organization_id = o.id, contact_id = coalesce(contact_id, v_ct), updated_at = now()
   where id = c.id;
  update public.messages set organization_id = o.id
   where conversation_id = c.id and organization_id is null;

  -- Ficha sem telefone ganha o desta conversa: é para ele que a próxima mensagem vai.
  update public.organizations x
     set phone_e164 = c.peer_phone_e164
   where x.id = o.id and x.phone_e164 is null
     and not exists (select 1 from public.organizations y
                      where y.phone_e164 = c.peer_phone_e164 and y.deleted_at is null);

  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('system', o.id, app.wa_negocio_da_ficha(o.id), v_eu, 'system',
          'Conversa de WhatsApp de um número fora da base ligada a esta ficha',
          jsonb_build_object('origin', 'vincular_conversa', 'conversation_id', c.id));

  -- Se a pessoa já tinha escrito, a primeira resposta conta agora.
  select m.id into v_resp from public.messages m
   where m.conversation_id = c.id and m.direction = 'in'::app.msg_direction
   order by m.created_at limit 1;
  if v_resp is not null then
    begin
      perform app.wa_resposta_no_funil(v_resp);
    exception when others then
      raise warning 'wa_resposta_no_funil(%): %', v_resp, sqlerrm;
    end;
  end if;

  return jsonb_build_object('ok', true, 'organization_id', o.id);
end $$;
comment on function public.vincular_conversa(uuid, uuid) is
  'Liga uma conversa de WhatsApp de número fora da base a uma ficha visível: grava a ficha na conversa e nas mensagens, dá o telefone à ficha que não tinha, registra o evento e conta a primeira resposta no funil.';
revoke all on function public.vincular_conversa(uuid, uuid) from public, anon;
grant execute on function public.vincular_conversa(uuid, uuid) to authenticated;

create or replace function public.criar_ficha_da_conversa(p_conversation_id uuid,
                                                          p_nome            text,
                                                          p_category_id     int,
                                                          p_kind            app.org_kind default 'fornecedor')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu     uuid := auth.uid();
  c        public.conversations%rowtype;
  v_criada jsonb;
begin
  if v_eu is null or app.e_o_worker() or not app.can_write() then
    raise exception 'Sem permissão para criar ficha' using errcode = '42501';
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found or not (app.sees_all() or c.assignee_id = v_eu) then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;
  if c.organization_id is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_vinculada', 'organization_id', c.organization_id);
  end if;

  -- O cadastro rápido de sempre: dedup por telefone, supressão e funil pelo tipo.
  v_criada := public.quick_create_organization(
    p_nome, p_category_id, c.peer_phone_e164,
    (select s.id from public.sources s where s.slug = 'whatsapp_entrada'), p_kind);
  if not coalesce((v_criada ->> 'created')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', v_criada ->> 'reason',
                              'organization_id', v_criada ->> 'existing_id');
  end if;

  return public.vincular_conversa(c.id, (v_criada ->> 'organization_id')::uuid)
         || jsonb_build_object('criada', true);
end $$;
comment on function public.criar_ficha_da_conversa(uuid, text, int, app.org_kind) is
  'Cria a ficha de quem escreveu de um número fora da base (cadastro rápido, origem "Chegou pelo WhatsApp") e liga a conversa a ela. Número já de outra ficha volta com o id dela para a tela oferecer a ligação.';
revoke all on function public.criar_ficha_da_conversa(uuid, text, int, app.org_kind) from public, anon;
grant execute on function public.criar_ficha_da_conversa(uuid, text, int, app.org_kind) to authenticated;

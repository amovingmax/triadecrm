-- =====================================================================
-- Fora da janela de 24 h, só o cumprimento
--
-- Decisão do Rafael, 22/09/2026: "eu gosto da ideia de engessar a primeira
-- mensagem pra desbloquear as 24 horas livres, mas essa mensagem poderia ser
-- apenas bom dia, boa tarde e boa noite, e nada mais além disso". Até aqui,
-- dos 54 modelos que a Meta conhecia, só 3 tinham sido usados (6 mensagens).
--
-- O que fica em uso, entre os modelos da Meta (marketing e utilidade):
--   * os três cumprimentos (GEN-ABR-OLA-*): abrem a conversa, e o resto vai em
--     texto livre quando a pessoa responder;
--   * os quatro de depois da ligação (GEN-LIG-CONFIRMA, GEN-LIG-RESUMO-FOR,
--     GEN-LIG-RESUMO-PRO, GEN-FUP-LIG-V1): quem acabou de falar por telefone
--     espera o resumo e a confirmação na hora (escolha do Rafael no mesmo dia).
-- Os outros saem de uso, inclusive os 3 convites com botão das campanhas, que
-- ainda esperavam a Meta. NADA É APAGADO: `is_active = false` tira o modelo das
-- telas e do envio, e ele volta com um clique em Ajustes → Catálogos → Modelos.
--
-- Não mexe nos textos de dentro da janela (categoria `service`: objeções, CTAs,
-- roteiros de áudio) nem nos do sistema (GEN-SYS-*): não são modelos da Meta.
--
-- O mesmo corte está no fim dos modelos do `seed.sql`: sem ele, `db reset`
-- traria de volta, no banco local, o que produção tirou de uso.
--
-- A CAMPANHA ESCOLHE O CUMPRIMENTO NA HORA DE CADA ENVIO. Uma campanha leva
-- horas (20 por hora, das 8h às 17h45): o "Bom dia!" escolhido às 9h não pode
-- sair às 15h. `app.modelo_da_hora` troca um cumprimento pelo do período, no
-- relógio de Natal (`app.saudacao_do_momento`), e não mexe em modelo nenhum
-- além deles. `app.envio_montar` (a prévia e o corpo) e `app.envio_um` (o envio)
-- foram recriados a partir das definições vivas; só a linha marcada com
-- "NOVO" mudou em cada uma.
-- =====================================================================

update public.message_templates
   set is_active = false
 where channel = 'whatsapp'::app.channel
   and category in ('marketing', 'utility')
   and template_code not like 'GEN-SYS-%'
   and template_code not in ('GEN-ABR-OLA-MANHA', 'GEN-ABR-OLA-TARDE', 'GEN-ABR-OLA-NOITE',
                             'GEN-LIG-CONFIRMA', 'GEN-LIG-RESUMO-FOR', 'GEN-LIG-RESUMO-PRO',
                             'GEN-FUP-LIG-V1')
   and is_active;

comment on table public.message_templates is
  'Modelos de mensagem (RF-CON-02). Fora da janela de 24 h o CRM só abre conversa com o cumprimento solto (GEN-ABR-OLA-*: "Bom dia!", "Boa tarde!", "Boa noite!", escolhido pelo relógio de America/Fortaleza) e, depois de uma ligação, com os quatro GEN-LIG-*/GEN-FUP-LIG-V1 (decisão do Rafael, 22/09/2026). Os demais modelos da Meta estão fora de uso, não apagados. Os textos de categoria service são para dentro da janela e não passam pela Meta.';

-- ---------------------------------------------------------------------
-- O cumprimento do período
-- ---------------------------------------------------------------------
create or replace function app.modelo_da_hora(p_modelo_id int, p_quando timestamptz default now())
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select g.id
       from public.message_templates t
       join public.message_templates g
         on g.template_code = case app.saudacao_do_momento(p_quando)
                                when 'Bom dia'   then 'GEN-ABR-OLA-MANHA'
                                when 'Boa tarde' then 'GEN-ABR-OLA-TARDE'
                                else 'GEN-ABR-OLA-NOITE'
                              end
      where t.id = p_modelo_id
        and t.template_code like 'GEN-ABR-OLA-%'),
    p_modelo_id)
$$;

revoke all on function app.modelo_da_hora(int, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- A prévia e o corpo da campanha (definição viva de 20260921100000)
-- ---------------------------------------------------------------------
create or replace function app.envio_montar(p_tipo text, p_modelo_id int, p_texto text,
                                            p_variaveis jsonb, p_organization_id uuid,
                                            p_assinante uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base   text;
  v_campos jsonb := app.envio_campos_da_ficha(p_organization_id);
  v_conf   jsonb;
  v_var    text;
  v_valor  text;
  v_params jsonb := '{}'::jsonb;
  v_todos  jsonb;
begin
  if p_tipo = 'modelo' then
    -- NOVO: o cumprimento é o do período, não o escolhido na montagem.
    select t.body into v_base from public.message_templates t where t.id = app.modelo_da_hora(p_modelo_id);
  else
    v_base := p_texto;
  end if;
  if v_base is null then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_inexistente');
  end if;

  foreach v_var in array coalesce(app.modelo_variaveis(v_base), '{}'::text[]) loop
    continue when v_var in ('atendente', 'saudacao');
    v_conf := p_variaveis -> v_var;
    if v_conf is null then
      return jsonb_build_object('ok', false, 'motivo', 'variavel_sem_regra', 'variavel', v_var);
    end if;
    if v_conf ? 'fixo' then
      v_valor := app.modelo_parametro_limpo(v_conf ->> 'fixo');
    else
      v_valor := coalesce(app.modelo_parametro_limpo(v_campos ->> (v_conf ->> 'campo')),
                          app.modelo_parametro_limpo(v_conf ->> 'reserva'));
    end if;
    if v_valor is null then
      return jsonb_build_object('ok', false, 'motivo', 'sem_valor', 'variavel', v_var);
    end if;
    v_params := v_params || jsonb_build_object(v_var, v_valor);
  end loop;

  v_todos := v_params || jsonb_build_object('atendente', app.primeiro_nome(p_assinante),
                                            'saudacao', app.saudacao_do_momento());
  return jsonb_build_object('ok', true, 'parametros', v_params,
                            'corpo', app.modelo_renderizar(v_base, v_todos));
end $$;

-- ---------------------------------------------------------------------
-- O envio de um item (definição viva de 20260921110000)
-- ---------------------------------------------------------------------
create or replace function app.envio_um(p_envio public.envios_em_massa, p_item public.envios_em_massa_itens)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel  text;
  v_mont   jsonb;
  v_ret    jsonb;
  v_numero text := app.wa_numero_padrao();
  v_tel    text;
  v_ct     uuid;
  v_conv   uuid;
  v_msg    uuid;
begin
  select p.role::text into v_papel from public.profiles p
   where p.id = p_item.assinante_id and p.is_active;
  if v_papel is null or v_papel not in ('admin', 'gestor', 'sdr', 'embaixador') then
    return jsonb_build_object('ok', false, 'motivo', 'assinante_sem_permissao');
  end if;

  select d.telefone, d.contact_id into v_tel, v_ct from app.wa_destino_da_ficha(p_item.organization_id) d;
  if v_tel is null then
    return jsonb_build_object('ok', false, 'motivo', 'ficha_sem_whatsapp');
  end if;
  select c.id into v_conv from public.conversations c
   where c.channel = 'whatsapp'::app.channel and c.business_number = v_numero
     and c.peer_phone_e164 = v_tel;

  if v_conv is not null and exists (
       select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
        where m.conversation_id = v_conv and m.direction = 'out'::app.msg_direction
          and m.status <> 'failed'::app.msg_status
          and coalesce(m.sent_at, m.created_at) > now() - interval '72 hours'
          and (c.last_inbound_at is null or coalesce(m.sent_at, m.created_at) > c.last_inbound_at)) then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_recente_sem_resposta');
  end if;

  v_mont := app.envio_montar(p_envio.tipo, p_envio.modelo_id, p_envio.texto, p_envio.variaveis,
                             p_item.organization_id, p_item.assinante_id);
  if not (v_mont ->> 'ok')::boolean then
    return v_mont;
  end if;

  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', p_item.assinante_id, 'role', 'authenticated',
                                        'app_metadata', jsonb_build_object('app_role', v_papel))::text,
                     true);
  -- (20260921110000) A voz da marca vale até o fim desta volta do relógio.
  perform set_config('app.voz', case when p_envio.assinatura = 'marca' then 'marca' else '' end, true);

  if p_envio.tipo = 'modelo' then
    -- NOVO: o cumprimento é o do período em que ESTE item sai.
    v_ret := public.wa_enviar_modelo(p_item.organization_id, app.modelo_da_hora(p_envio.modelo_id),
                                     v_mont -> 'parametros');
    v_msg := (v_ret ->> 'message_id')::uuid;
  else
    if v_conv is null or not app.janela_de_24h_aberta(v_conv, now()) then
      return jsonb_build_object('ok', false, 'motivo', 'sem_janela_24h');
    end if;
    insert into public.messages (conversation_id, direction, type, status, body,
                                 author_kind, sent_by, origin)
    values (v_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'queued'::app.msg_status,
            v_mont ->> 'corpo', 'human', p_item.assinante_id, 'crm')
    returning id into v_msg;
  end if;
  return jsonb_build_object('ok', true, 'message_id', v_msg);
end $$;

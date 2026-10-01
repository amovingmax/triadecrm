-- =====================================================================
-- Responder quem não é parceiro
--
-- Rafael, 01/10/2026: "adeque o crm pra responder clientes normais, oq vem
-- 'fora da base' em conversas, vem pessoas q n são leads, e como unificamos o
-- wpp no crm, só conseguimos responder por ali".
--
-- Desde 14/09/2026 o número da KOMUNE vive só na Cloud API (sem Coexistence):
-- o celular não responde mais nada, e TUDO o que chega ao número chega ao CRM —
-- inclusive cliente da plataforma, curioso e gente que não é lead. Essas
-- conversas nascem sem ficha e caem na aba "Fora da base", que até hoje só
-- oferecia duas saídas: criar a ficha ou ligar a uma que já existe. Para
-- responder um cliente era preciso fazer dele um parceiro — e sujar o funil.
--
-- O QUE JÁ FUNCIONAVA, E NÃO MUDA: dentro da janela de 24 h, o texto livre de
-- uma pessoa já passava pela porteira sem ficha nenhuma. `messages_insert` não
-- exige `organization_id`, e `app.pode_enviar` libera resposta na janela
-- perguntando só a supressão do NÚMERO. Faltava a caixa na tela.
--
-- O QUE FALTAVA NO BANCO, e é o que esta migração cria: o caminho de FORA da
-- janela. Passadas 24 h desde a última mensagem da pessoa, só modelo aprovado
-- pela Meta atravessa — e `wa_preparar_envio`/`wa_enviar_modelo` partem de uma
-- FICHA (o telefone sai de `app.wa_destino_da_ficha`). Para o cliente que
-- escreveu na sexta à noite e é respondido na segunda, não havia como.
--
-- As duas funções novas são as mesmas duas, partindo da CONVERSA:
--   · `public.wa_preparar_envio_na_conversa` — o que barraria o envio agora e
--     quais modelos servem, no mesmo formato da versão por ficha (a tela usa a
--     mesma caixa para os dois);
--   · `public.wa_enviar_modelo_na_conversa` — enfileira o modelo, assinado por
--     quem clicou, e a porteira (`messages_guard`) confere o resto: supressão,
--     janela de horário, tetos.
--
-- O que elas NÃO fazem, de propósito:
--   · não servem para conversa COM ficha — essa tem o caminho dela, que ainda
--     conta o primeiro contato no funil (`app.wa_envio_no_funil`). Cliente não
--     é negócio, e não entra em funil nenhum;
--   · não furam a leitura: DEFINER é para poder gravar, não para enxergar o que
--     a política de `conversations` esconde. Quem não vê a conversa ouve
--     "Conversa não encontrada".
--
-- RF-CON-04 (responder rápido), RF-CON-10/11 (tetos e horário), RF-CON-18
-- (supressão) · ADR-05 (mensagem humana assinada) · ADR-06
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A prévia: o que barraria agora, e quais modelos servem
-- ---------------------------------------------------------------------
create or replace function public.wa_preparar_envio_na_conversa(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c           public.conversations%rowtype;
  v_eu        uuid := auth.uid();
  v_numero    text := app.wa_numero_padrao();
  v_nome      text;
  v_janela24  boolean := false;
  v_primeiro  boolean := true;
  v_ultima    timestamptz;
  v_motivo    text;
  v_quando    timestamptz;
  v_respondeu boolean;
  v_canal     jsonb;
  v_dia       date := (now() at time zone 'America/Fortaleza')::date;
  v_teto      int;
  v_usados    int;
begin
  if v_eu is null or not app.can_write() then
    raise exception 'Sem permissão para enviar mensagem pelo WhatsApp' using errcode = '42501';
  end if;

  select * into c from public.conversations where id = p_conversation_id;
  -- A mesma pergunta de `conversations_select` para conversa sem ficha: quem vê
  -- tudo, ou quem atende.
  if not found or not (app.sees_all() or c.assignee_id = v_eu) then
    raise exception 'Conversa não encontrada' using errcode = 'P0002';
  end if;
  if c.organization_id is not null then
    raise exception 'Envio recusado: conversa_tem_ficha — use wa_preparar_envio' using errcode = '22023';
  end if;

  -- O primeiro nome que a pessoa deixou no perfil do WhatsApp, para o `{{nome}}`.
  v_nome := nullif(split_part(btrim(coalesce(c.peer_nome, '')), ' ', 1), '');

  v_janela24 := app.janela_de_24h_aberta(c.id, now());
  select max(coalesce(m.sent_at, m.created_at)) into v_ultima
    from public.messages m
   where m.conversation_id = c.id
     and m.direction = 'out'::app.msg_direction
     and m.status <> 'failed'::app.msg_status
     and (c.last_inbound_at is null or coalesce(m.sent_at, m.created_at) > c.last_inbound_at);
  v_primeiro := c.last_inbound_at is null
                and not exists (select 1 from public.messages m
                                 where m.conversation_id = c.id
                                   and (m.direction = 'in'::app.msg_direction
                                        or m.status <> 'failed'::app.msg_status));

  -- O que barraria o envio agora, na ordem de `app.pode_enviar`.
  if v_numero is null then
    v_motivo := 'whatsapp_nao_configurado';
  else
    v_motivo := app.wa_motivo_de_recusa(null, c.contact_id, c.peer_phone_e164);
  end if;
  if v_motivo is null and not v_janela24 then
    -- Sem ficha, "já respondeu" é a própria conversa: quem caiu aqui escreveu.
    v_respondeu := c.last_inbound_at is not null;
    v_canal := app.janela_do_canal(c.channel, now(), v_respondeu);
    if not coalesce((v_canal ->> 'aberta')::boolean, false) then
      v_motivo := 'janela_' || coalesce(v_canal ->> 'motivo', 'fechada');
      v_quando := (v_canal ->> 'abre_em')::timestamptz;
    else
      v_teto   := least(app.teto_do_canal(c.channel, v_dia),
                        coalesce((app.wa_teto_da_meta(v_numero, now()) ->> 'teto_dia')::int,
                                 2147483647));
      v_usados := app.aberturas_do_dia(c.channel, v_dia, v_numero);
      if v_usados >= v_teto then
        v_motivo := 'teto_do_numero';
        v_quando := app.proxima_abertura_do_canal(v_dia, c.channel, v_respondeu);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'numero_configurado', v_numero is not null,
    'tem_whatsapp',       true,
    'conversa_id',        c.id,
    'janela_24h_aberta',  v_janela24,
    'primeiro_contato',   v_primeiro,
    'sem_resposta_desde', v_ultima,
    'bloqueio',           case when v_motivo is null then null
                               else jsonb_build_object('motivo', v_motivo, 'quando', v_quando) end,
    'teto',               case when v_teto is null then null
                               else jsonb_build_object('usados', v_usados, 'teto', v_teto) end,
    'segmento',           null,
    'valores',            jsonb_strip_nulls(jsonb_build_object(
                            'nome', v_nome,
                            'atendente', app.primeiro_nome(v_eu),
                            'saudacao', app.saudacao_do_momento())),
    'modelos',            coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'codigo', t.template_code, 'nome', t.name,
               'tipo', t.kind, 'variante', t.variant, 'segmento', t.segment,
               'corpo', t.body, 'variaveis', to_jsonb(app.modelo_variaveis(t.body)))
             order by case t.kind when 'abertura' then 0 when 'followup' then 1 else 2 end,
                      t.template_code)
        from public.message_templates t
       where t.is_active
         and t.channel = 'whatsapp'::app.channel
         and t.template_code not like 'GEN-SYS-%'
         and t.meta_status = 'approved'
         and nullif(btrim(coalesce(t.meta_template_name, '')), '') is not null), '[]'::jsonb),
    'modelos_esperando_meta', (
      select count(*)::int from public.message_templates t
       where t.is_active and t.channel = 'whatsapp'::app.channel
         and t.category in ('marketing', 'utility')
         and t.meta_status is distinct from 'approved'));
end $$;
comment on function public.wa_preparar_envio_na_conversa(uuid) is
  'A prévia do envio de modelo para uma conversa SEM ficha (cliente, curioso, quem não é lead): o que barraria agora e quais modelos servem, no mesmo formato de wa_preparar_envio. Conversa com ficha usa wa_preparar_envio.';
revoke all on function public.wa_preparar_envio_na_conversa(uuid) from public, anon;
grant execute on function public.wa_preparar_envio_na_conversa(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. O envio
-- ---------------------------------------------------------------------
create or replace function public.wa_enviar_modelo_na_conversa(
  p_conversation_id uuid,
  p_template_id     integer,
  p_parametros      jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu       uuid := auth.uid();
  c          public.conversations%rowtype;
  t          public.message_templates%rowtype;
  v_numero   text := app.wa_numero_padrao();
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

  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or not (app.sees_all() or c.assignee_id = v_eu) then
    raise exception 'Conversa não encontrada' using errcode = 'P0002';
  end if;
  if c.organization_id is not null then
    raise exception 'Envio recusado: conversa_tem_ficha — use wa_enviar_modelo' using errcode = '22023';
  end if;
  if c.channel <> 'whatsapp'::app.channel then
    raise exception 'Envio recusado: conversa_fora_do_whatsapp' using errcode = '22023';
  end if;
  if v_numero is null then
    raise exception 'Envio recusado: whatsapp_nao_configurado (RF-CON-01)' using errcode = '42501';
  end if;

  select * into t from public.message_templates
   where id = p_template_id and is_active and channel = 'whatsapp'::app.channel;
  if not found then
    raise exception 'Envio recusado: modelo_inexistente' using errcode = '42501';
  end if;
  if t.template_code like 'GEN-SYS-%' then
    raise exception 'Envio recusado: modelo_de_sistema' using errcode = '42501';
  end if;

  -- `{{atendente}}` é sempre quem clicou, e `{{saudacao}}` é a do relógio.
  v_entrada := coalesce(p_parametros, '{}'::jsonb)
               || jsonb_build_object('atendente', app.primeiro_nome(v_eu),
                                     'saudacao', app.saudacao_do_momento());
  foreach v_var in array app.modelo_variaveis(t.body) loop
    v_valor := app.modelo_parametro_limpo(v_entrada ->> v_var);
    if v_valor is null then
      v_faltando := v_faltando || v_var;
    elsif length(v_valor) > app.modelo_teto_da_variavel(v_var) then
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

  -- Fora da janela de 24 h só vai modelo que a META aprovou.
  if not app.janela_de_24h_aberta(c.id, now())
     and not coalesce((app.wa_modelo_da_meta(t.id) ->> 'aprovado')::boolean, false) then
    raise exception 'Envio recusado: modelo_nao_aprovado_na_meta' using errcode = '42501';
  end if;

  -- O `messages_guard` confere supressão do número, janela de horário e tetos.
  insert into public.messages (conversation_id, direction, type, status, body,
                               template_id, template_params, author_kind, sent_by, origin)
  values (c.id, 'out'::app.msg_direction, 'template'::app.msg_type, 'queued'::app.msg_status,
          v_corpo, t.id, v_params, 'human', v_eu, 'crm')
  returning id, is_first_contact into v_msg, v_primeiro;

  -- Sem `app.wa_envio_no_funil`: cliente não é negócio, e não entra em funil.
  return jsonb_build_object('ok', true, 'conversation_id', c.id, 'message_id', v_msg,
                            'primeiro_contato', v_primeiro, 'corpo', v_corpo);
end $$;
comment on function public.wa_enviar_modelo_na_conversa(uuid, integer, jsonb) is
  'Envia um modelo aprovado numa conversa SEM ficha (cliente, curioso, quem não é lead), assinado por quem clicou. É o caminho de fora da janela de 24 h; dentro dela, a pessoa escreve texto livre. Não mexe em funil nenhum. Conversa com ficha usa wa_enviar_modelo.';
revoke all on function public.wa_enviar_modelo_na_conversa(uuid, integer, jsonb) from public, anon;
grant execute on function public.wa_enviar_modelo_na_conversa(uuid, integer, jsonb) to authenticated;

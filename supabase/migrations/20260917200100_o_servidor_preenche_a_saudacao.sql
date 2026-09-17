-- =====================================================================
-- O servidor passa a preencher {{saudacao}}
--
-- O modelo `GEN-ABR-CUMPRIMENTO` (migração anterior) tem duas variáveis, e
-- nenhuma delas é para alguém digitar: `{{atendente}}` já era o primeiro nome de
-- quem clica, e `{{saudacao}}` vem do relógio de Natal.
--
-- Precisa entrar nos DOIS caminhos, e a razão de cada um é diferente:
--
--   · `wa_preparar_envio` alimenta a PRÉVIA. Sem a saudação ali, a tela mostra
--     um campo "Saudação" para a pessoa preencher — exatamente o formulário de
--     que o Rafael reclamou.
--   · `wa_enviar_modelo` alimenta o ENVIO. Sem a saudação ali, o envio falha com
--     "falta preencher: saudacao" no instante em que alguém aperta o botão.
--
-- As duas funções foram copiadas do banco com `pg_get_functiondef` e receberam
-- uma linha cada. São 137 e 123 linhas de guardrails (supressão, janela de 24 h,
-- teto do dia, recusa de modelo de sistema, pseudonimização): reescrevê-las de
-- memória é perder uma delas sem perceber.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.wa_preparar_envio(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o            public.organizations%rowtype;
  v_numero     text := app.wa_numero_padrao();
  v_tel        text;
  v_ct         uuid;
  v_nome       text;
  v_conv       uuid;
  v_janela24   boolean := false;
  v_primeiro   boolean := true;
  v_ultima     timestamptz;
  v_motivo     text;
  v_quando     timestamptz;
  v_respondeu  boolean;
  v_canal      jsonb;
  v_dia        date := (now() at time zone 'America/Fortaleza')::date;
  v_teto       int;
  v_usados     int;
  v_origem     text;
  v_categoria  text;
  v_segmento   text;
begin
  if auth.uid() is null or not app.can_write() then
    raise exception 'Sem permissão para enviar mensagem pelo WhatsApp' using errcode = '42501';
  end if;
  select * into o from public.organizations
   where id = p_organization_id and deleted_at is null;
  if not found or not app.org_is_visible(o.id) then
    raise exception 'Ficha não encontrada' using errcode = 'P0002';
  end if;

  select d.telefone, d.contact_id, d.primeiro_nome into v_tel, v_ct, v_nome
    from app.wa_destino_da_ficha(o.id) d;

  if v_numero is not null and v_tel is not null then
    select c.id into v_conv from public.conversations c
     where c.channel = 'whatsapp'::app.channel
       and c.business_number = v_numero
       and c.peer_phone_e164 = v_tel;
  end if;
  if v_conv is not null then
    v_janela24 := app.janela_de_24h_aberta(v_conv, now());
    -- A última mensagem nossa que não falhou e que a pessoa ainda não respondeu.
    -- É o que impede a tela de oferecer a segunda abertura um minuto depois da
    -- primeira: duas mensagens frias seguidas são o bloqueio que derruba a
    -- qualidade do número na Meta (R04 §2.1).
    select max(coalesce(m.sent_at, m.created_at)) into v_ultima
      from public.messages m join public.conversations c on c.id = m.conversation_id
     where m.conversation_id = v_conv
       and m.direction = 'out'::app.msg_direction
       and m.status <> 'failed'::app.msg_status
       and (c.last_inbound_at is null or coalesce(m.sent_at, m.created_at) > c.last_inbound_at);
    v_primeiro := not exists (select 1 from public.conversations c
                               where c.id = v_conv and c.last_inbound_at is not null)
                  and not exists (select 1 from public.messages m
                                   where m.conversation_id = v_conv
                                     and (m.direction = 'in'::app.msg_direction
                                          or m.status <> 'failed'::app.msg_status));
  end if;

  -- O que barraria o envio agora, na ordem de app.pode_enviar.
  if v_numero is null then
    v_motivo := 'whatsapp_nao_configurado';
  elsif v_tel is null then
    v_motivo := 'ficha_sem_whatsapp';
  else
    v_motivo := app.wa_motivo_de_recusa(o.id, v_ct, v_tel);
  end if;
  if v_motivo is null and not v_janela24 then
    v_respondeu := app.ja_respondeu(o.id);
    v_canal := app.janela_do_canal('whatsapp'::app.channel, now(), v_respondeu);
    if not coalesce((v_canal ->> 'aberta')::boolean, false) then
      v_motivo := 'janela_' || coalesce(v_canal ->> 'motivo', 'fechada');
      v_quando := (v_canal ->> 'abre_em')::timestamptz;
    elsif v_primeiro then
      v_teto   := app.teto_do_canal('whatsapp'::app.channel, v_dia);
      v_usados := app.primeiros_contatos_do_dia('whatsapp'::app.channel, v_dia, v_numero);
      if v_usados >= v_teto then
        v_motivo := 'teto_do_numero';
        v_quando := app.proxima_abertura_do_canal(v_dia, 'whatsapp'::app.channel, v_respondeu);
      end if;
    end if;
  end if;

  -- Sugestões de preenchimento. `origem` só quando a fonte é um lugar público
  -- que a pessoa reconheceria ("vi seu contato no Google Maps"); "Planilha
  -- (importação)" numa abertura é pior do que um campo vazio.
  select s.name into v_origem from public.sources s
   where s.id = o.source_id and s.kind in ('scrape'::app.source_kind, 'api'::app.source_kind);
  select lower(c.name) into v_categoria
    from public.organization_categories oc join public.categories c on c.id = oc.category_id
   where oc.organization_id = o.id
   order by oc.is_primary desc, oc.created_at limit 1;
  v_segmento := app.segmento_da_ficha(o.id);

  return jsonb_build_object(
    'numero_configurado', v_numero is not null,
    'tem_whatsapp',       v_tel is not null,
    'conversa_id',        v_conv,
    'janela_24h_aberta',  v_janela24,
    'primeiro_contato',   v_primeiro,
    'sem_resposta_desde', v_ultima,
    'bloqueio',           case when v_motivo is null then null
                               else jsonb_build_object('motivo', v_motivo, 'quando', v_quando) end,
    'teto',               case when v_teto is null then null
                               else jsonb_build_object('usados', v_usados, 'teto', v_teto) end,
    'segmento',           v_segmento,
    'valores',            jsonb_strip_nulls(jsonb_build_object(
                            'nome', v_nome, 'empresa', o.name,
                            'origem', v_origem, 'categoria', v_categoria,
                            'atendente', app.primeiro_nome(auth.uid()),
                            'saudacao', app.saudacao_do_momento())),
    'modelos',            coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'codigo', t.template_code, 'nome', t.name,
               'tipo', t.kind, 'variante', t.variant, 'segmento', t.segment,
               'corpo', t.body, 'variaveis', to_jsonb(app.modelo_variaveis(t.body)))
             order by (t.segment = v_segmento) desc nulls last,
                      case t.kind when 'abertura' then 0 when 'followup' then 1 else 2 end,
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
end $function$;

CREATE OR REPLACE FUNCTION public.wa_enviar_modelo(p_organization_id uuid, p_template_id integer, p_parametros jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
               || jsonb_build_object('atendente', app.primeiro_nome(v_eu),
                                     'saudacao', app.saudacao_do_momento());

  -- Toda variável do corpo precisa de valor. Chave a mais é descartada: o que
  -- fica gravado é exatamente o que vai no fio.
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
end $function$;


revoke all on function public.wa_preparar_envio(uuid) from public, anon;
grant execute on function public.wa_preparar_envio(uuid) to authenticated, service_role;
revoke all on function public.wa_enviar_modelo(uuid, integer, jsonb) from public, anon;
grant execute on function public.wa_enviar_modelo(uuid, integer, jsonb) to authenticated, service_role;

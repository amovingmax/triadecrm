-- =====================================================================
-- O nome que vem junto da mensagem para de ser jogado fora
--
-- Pedido do Rafael em 28/09/2026, olhando a tela de Conversas: "colocando o
-- nome do fornecedor ou produtor em vez do número".
--
-- O QUE ESTAVA ACONTECENDO, e não era problema de tela: a Meta manda o nome do
-- perfil de quem escreve em `value.contacts[].profile.name`, em TODA mensagem
-- recebida. O nosso extrator lia `wa_id` e `user_id` daquele mesmo objeto e
-- ignorava o `profile`. Sem nome, `app.lead_automatico` batizava a ficha de
-- "Contato do WhatsApp (11) 5128-5383" — e era isso que aparecia na lista.
-- Em produção, 193 conversas estavam assim.
--
-- É nome PÚBLICO de perfil, escolhido pela própria pessoa e enviado no mesmo
-- pacote da mensagem. Não é dado que fomos buscar: a origem da ficha continua
-- sendo `whatsapp_entrada` e a proveniência não muda.
--
-- O NOME É REAPRENDIDO a cada mensagem, porque a pessoa troca o dela quando
-- quer. Nome vazio nunca apaga o que já se sabia.
--
-- O QUE ISTO NÃO FAZ: não cria ficha para quem não tem, não mexe em dedup e não
-- renomeia as 193 fichas velhas de uma vez. Elas se corrigem na próxima
-- mensagem, e ficha que já tem nome de gente nunca é sobrescrita — quem batiza
-- é só o caminho de criação.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. A coluna
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists peer_nome text;
comment on column public.conversations.peer_nome is
  'O nome do perfil do WhatsApp de quem escreve, como a Meta o manda em contacts[].profile.name. Reaprendido a cada mensagem. Nulo enquanto ninguém escreveu (conversa que nós abrimos).';

-- ---------------------------------------------------------------------------
-- 2. As duas funções da entrada ganham o nome
-- ---------------------------------------------------------------------------
-- `drop` antes do `create`: acrescentar argumento com default cria SOBRECARGA,
-- e duas funções com o mesmo nome fazem o PostgREST responder "function is not
-- unique" na cara de quem manda mensagem.
drop function if exists public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text);
drop function if exists app.wa_registrar_entrada(text, text, text, app.msg_type, text, text, text, timestamptz, text);

CREATE OR REPLACE FUNCTION app.wa_registrar_entrada(p_wamid text, p_business_number text, p_peer_phone text, p_type app.msg_type DEFAULT 'text'::app.msg_type, p_body text DEFAULT NULL::text, p_media_id text DEFAULT NULL::text, p_media_mime text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT now(), p_peer_user_id text DEFAULT NULL::text, p_peer_nome text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_peer  text := nullif(trim(coalesce(app.normalize_phone_br(p_peer_phone), p_peer_phone, '')), '');
  v_num   text := coalesce(app.normalize_phone_br(p_business_number), p_business_number);
  v_bsuid text := nullif(trim(coalesce(p_peer_user_id, '')), '');
  v_nome  text := nullif(btrim(coalesce(p_peer_nome, '')), '');
  v_conv  uuid;
  v_org   uuid;
  v_ct    uuid;
  v_msg   uuid;
  v_novo  boolean := false;
  v_dlq   text;
  v_res   jsonb;
begin
  if nullif(trim(coalesce(p_wamid, '')), '') is null then
    raise exception 'Mensagem recebida sem wa_message_id não é idempotente (RF-CON-03)' using errcode = '22023';
  end if;

  -- Já conhecida? Sai antes de tocar em qualquer outra coisa.
  select m.id, m.conversation_id into v_msg, v_conv
    from public.messages m where m.wa_message_id = p_wamid;
  if found then
    return jsonb_build_object('novo', false, 'message_id', v_msg, 'conversation_id', v_conv,
                              'sem_telefone', false);
  end if;

  -- SEM TELEFONE (nome de usuário do WhatsApp). O BSUID é a única identidade.
  if v_peer is null then
    if v_bsuid is null then
      raise exception 'Mensagem recebida sem telefone e sem BSUID: não há de quem ela seja (RF-CON-03)'
        using errcode = '22023';
    end if;

    -- A conversa que já conhece este BSUID dá o telefone — e com ele volta
    -- tudo o que depende do telefone: supressão, opt-out, janela, resposta.
    select c.id, c.peer_phone_e164 into v_conv, v_peer
      from public.conversations c
     where c.channel = 'whatsapp'::app.channel
       and c.business_number = v_num and c.peer_user_id = v_bsuid
     order by c.last_message_at desc nulls last, c.created_at desc
     limit 1;

    if v_conv is null then
      -- Ninguém conhece. Não nasce fio sem telefone (o cabeçalho explica), e
      -- a mensagem também não some: vai para a dead-letter do WhatsApp, que é
      -- leitura humana, com o conteúdo inteiro para uma pessoa decidir. A
      -- chave é o wamid: a reentrega da Meta não abre um segundo aviso.
      select q.dlq into v_dlq from public.ingest_queues q where q.name = 'wa_inbound';
      v_res := app.esteira_enfileirar(
        coalesce(v_dlq, 'wa_dlq'),
        jsonb_build_object(
          'fila_de_origem', 'wa_inbound',
          'idempotency_key', p_wamid,
          'erro', 'mensagem_sem_telefone: a pessoa usa nome de usuário no WhatsApp e a Meta '
                  || 'mandou só o BSUID ' || v_bsuid || '; nenhuma conversa conhece esse BSUID. '
                  || 'Sem telefone não há como abrir o fio, suprimir ou responder pelo CRM.',
          'tentativas', 0,
          'em', now(),
          'mensagem', jsonb_build_object(
            'tipo', 'mensagem', 'wamid', p_wamid, 'numero_da_empresa', v_num,
            'de', null, 'de_user_id', v_bsuid,
            'tipo_da_mensagem', coalesce(p_type, 'text'::app.msg_type)::text,
            'texto', p_body, 'media_id', p_media_id, 'media_mime', p_media_mime,
            'ocorrido_em', coalesce(p_occurred_at, now()))),
        'wa_inbound:sem_telefone:' || p_wamid);
      return jsonb_build_object('novo', coalesce((v_res ->> 'enfileirado')::boolean, false),
                                'message_id', null, 'conversation_id', null,
                                'sem_telefone', true);
    end if;
  end if;

  if v_conv is null then
    select c.id into v_conv from public.conversations c
     where c.channel = 'whatsapp'::app.channel
       and c.business_number = v_num and c.peer_phone_e164 = v_peer;
  end if;

  if v_conv is null then
    -- De quem é este número? A ficha primeiro, a pessoa depois.
    select o.id into v_org from public.organizations o
     where o.phone_e164 = v_peer and o.deleted_at is null limit 1;
    select ct.id into v_ct from public.contacts ct
     where ct.phone_e164 = v_peer and ct.deleted_at is null limit 1;
    if v_org is null and v_ct is not null then
      select oc.organization_id into v_org from public.organization_contacts oc
       where oc.contact_id = v_ct limit 1;
    end if;

    insert into public.conversations (channel, business_number, peer_phone_e164, peer_user_id,
                                      peer_nome, organization_id, contact_id, status)
    values ('whatsapp'::app.channel, v_num, v_peer, v_bsuid, v_nome, v_org, v_ct, 'aguardando_nos')
    returning id into v_conv;
  elsif v_bsuid is not null then
    -- A conversa aprende (ou reaprende: a Meta gera BSUID novo quando a
    -- pessoa troca de número) o BSUID de quem escreveu.
    update public.conversations
       set peer_user_id = v_bsuid
     where id = v_conv and peer_user_id is distinct from v_bsuid;
  end if;

  -- O nome do perfil é reaprendido a cada mensagem: a pessoa troca o dela no
  -- WhatsApp quando quer, e o que vale é o último que ela mesma pôs. Só grava
  -- quando MUDOU e quando veio algo — nome vazio não apaga o que já se sabia.
  if v_nome is not null then
    update public.conversations
       set peer_nome = v_nome
     where id = v_conv and peer_nome is distinct from v_nome;
  end if;

  insert into public.messages (conversation_id, direction, type, status, wa_message_id,
                               body, media_id, media_mime, author_kind, origin, created_at)
  values (v_conv, 'in'::app.msg_direction, coalesce(p_type, 'text'::app.msg_type),
          'received'::app.msg_status, p_wamid, p_body, p_media_id, p_media_mime,
          'system', 'crm', coalesce(p_occurred_at, now()))
  on conflict (wa_message_id) where wa_message_id is not null do nothing
  returning id into v_msg;
  v_novo := v_msg is not null;

  if v_msg is null then
    select m.id into v_msg from public.messages m where m.wa_message_id = p_wamid;
  end if;

  return jsonb_build_object('novo', v_novo, 'message_id', v_msg, 'conversation_id', v_conv,
                            'sem_telefone', false);
end $function$;

CREATE OR REPLACE FUNCTION public.wa_entrada_registrar(p_wamid text, p_business_number text, p_peer_phone text, p_type text DEFAULT 'text'::text, p_body text DEFAULT NULL::text, p_media_id text DEFAULT NULL::text, p_media_mime text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT now(), p_peer_user_id text DEFAULT NULL::text, p_peer_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tipo app.msg_type;
begin
  begin
    v_tipo := coalesce(nullif(trim(coalesce(p_type, '')), ''), 'text')::app.msg_type;
  exception when others then
    -- Tipo que a Meta inventou e nós ainda não conhecemos entra como
    -- `system`: perder a mensagem porque o enum não acompanhou seria
    -- perder o que a pessoa escreveu por causa de uma coluna nossa.
    v_tipo := 'system'::app.msg_type;
  end;
  return app.wa_registrar_entrada(p_wamid, p_business_number, p_peer_phone, v_tipo,
                                  p_body, p_media_id, p_media_mime,
                                  coalesce(p_occurred_at, now()), p_peer_user_id, p_peer_name);
end $function$;

revoke all on function app.wa_registrar_entrada(text, text, text, app.msg_type, text, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function app.wa_registrar_entrada(text, text, text, app.msg_type, text, text, text, timestamptz, text, text) to service_role;
revoke all on function public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. A ficha automática nasce com o nome
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.lead_automatico(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c         public.conversations%rowtype;
  v_bot     jsonb := (select s.value from public.app_settings s where s.key = 'whatsapp.bot_de_entrada');
  v_intencao text;
  v_papel   text;
  v_antes   text := current_setting('request.jwt.claims', true);
  v_ret     jsonb;
  v_exist   uuid;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.organization_id is not null or c.channel <> 'whatsapp'::app.channel then
    return jsonb_build_object('criou', false, 'motivo', 'ja_tem_ficha');
  end if;
  if not coalesce((select (s.value ->> 'lead_automatico')::boolean from public.app_settings s
                    where s.key = 'atendimento'), false) then
    return jsonb_build_object('criou', false, 'motivo', 'desligado');
  end if;

  -- Com o menu automático ligado, espera a escolha — e só cria para quem quer
  -- ser parceiro, ou para quem respondeu com as próprias palavras.
  if coalesce((v_bot ->> 'ativo')::boolean, false) then
    if c.bot_estado is null or c.bot_estado = 'menu_enviado' then
      return jsonb_build_object('criou', false, 'motivo', 'esperando_o_menu');
    end if;
    if c.bot_estado = 'escolhido' then
      select o ->> 'intencao' into v_intencao
        from jsonb_array_elements(coalesce(v_bot -> 'opcoes', '[]'::jsonb)) o
       where o ->> 'chave' = c.bot_opcao;
      if coalesce(v_intencao, '') <> 'parceria' then
        return jsonb_build_object('criou', false, 'motivo', 'nao_e_parceiro');
      end if;
    end if;
  end if;

  select p.role::text into v_papel from public.profiles p
   where p.id = c.assignee_id and p.is_active;
  if v_papel is null or v_papel not in ('admin', 'gestor', 'sdr', 'embaixador') then
    return jsonb_build_object('criou', false, 'motivo', 'atendente_sem_permissao');
  end if;

  -- As mesmas regras do cadastro rápido (`quick_create_organization`): quem
  -- pediu para sair não entra, e número que a base já conhece — da ficha ou de
  -- uma pessoa ligada a ela — é LIGADO, nunca duplicado. A diferença é uma só:
  -- sem categoria, porque quem acabou de escrever "oi" ainda não disse o que faz.
  if app.is_suppressed(c.peer_phone_e164) then
    return jsonb_build_object('criou', false, 'motivo', 'telefone_suprimido');
  end if;
  select o.id into v_exist from public.organizations o
   where o.phone_e164 = c.peer_phone_e164 and o.deleted_at is null limit 1;
  if v_exist is null then
    select oc.organization_id into v_exist
      from public.contacts ct
      join public.organization_contacts oc on oc.contact_id = ct.id
      join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
     where ct.phone_e164 = c.peer_phone_e164 and ct.deleted_at is null
     order by oc.is_primary desc limit 1;
  end if;

  if v_exist is null then
    insert into public.organizations (kind, name, phone_e164, source_id, collected_at, collector, owner_id)
    values ('fornecedor'::app.org_kind,
            -- O nome que a pessoa pôs no perfil do WhatsApp, quando a Meta o
            -- mandou. Só cai no "Contato do WhatsApp <número>" quando não veio
            -- nome nenhum — que era o caso de TODAS as fichas até 28/09/2026,
            -- porque o webhook descartava o nome.
            coalesce(nullif(btrim(coalesce(c.peer_nome, '')), ''),
                     'Contato do WhatsApp ' || app.telefone_legivel(c.peer_phone_e164)),
            c.peer_phone_e164,
            (select s.id from public.sources s where s.slug = 'whatsapp_entrada'),
            now(), 'lead automático do WhatsApp', c.assignee_id)
    returning id into v_exist;
    -- Escreveu para a gente: o negócio nasce em "Respondeu", com a próxima ação
    -- de responder agora.
    insert into public.deals (organization_id, pipeline_id, stage_id, owner_id, source_id,
                              next_action, next_action_at)
    select v_exist, p.id, st.id, c.assignee_id,
           (select s.id from public.sources s where s.slug = 'whatsapp_entrada'),
           'Responder no WhatsApp', now()
      from public.pipelines p
      join public.stages st on st.pipeline_id = p.id and st.slug = 'respondeu'
     where p.slug = 'fornecedor';
    insert into public.activities (type, organization_id, user_id, author_kind, body, metadata)
    values ('system', v_exist, c.assignee_id, 'system',
            'Lead criado sozinho: escreveu pela primeira vez no WhatsApp',
            jsonb_build_object('origin', 'lead_automatico', 'conversation_id', c.id));
    v_ret := jsonb_build_object('criada', true);
  else
    v_ret := jsonb_build_object('ligou_a_existente', true);
  end if;

  -- Ligar a conversa à ficha é o mesmo "Ligar a uma ficha" da aba "Fora da
  -- base", feito por quem atende: ele carimba as mensagens e leva a resposta
  -- ao funil.
  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', c.assignee_id, 'role', 'authenticated',
                                        'app_metadata', jsonb_build_object('app_role', v_papel))::text,
                     true);
  begin
    v_ret := v_ret || public.vincular_conversa(c.id, v_exist);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_antes, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_antes, ''), true);

  return jsonb_build_object('criou', coalesce((v_ret ->> 'criada')::boolean, false)) || v_ret;
end $function$;

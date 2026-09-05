-- =====================================================================
-- TRIADE — 20260905000201 — A PONTE PÚBLICA DO WHATSAPP
-- (RF-CON-03 a RF-CON-11, RF-CON-19, RF-CON-22; ADR-03, ADR-04, ADR-06)
-- =====================================================================
--
-- POR QUE ESTE ARQUIVO EXISTE
-- ---------------------------------------------------------------------
-- A migração 20260905000200 construiu o cérebro do WhatsApp inteiro em
-- `app`: `wa_registrar_entrada`, `wa_proximos`, `wa_sucesso`, `wa_falha`,
-- `wa_enfileirar_envio`, `registrar_optout_de_contato`, `ia_enfileirar`.
-- Todas com `grant execute ... to service_role`.
--
-- E nenhuma delas é alcançável pelo worker nem pela Edge Function.
--
-- `supabase/config.toml` expõe na API apenas `schemas = ["public",
-- "graphql_public"]` — de propósito, e está escrito lá: "o schema `app`
-- fica privado: nada dele vira endpoint REST/GraphQL; o web e os workers
-- chegam a ele por RPC/views em `public`". O worker fala com o banco por
-- HTTPS/PostgREST com a chave de serviço (ADR-04), e a Edge Function
-- também. `grant` para `service_role` numa função de `app` é permissão
-- para uma porta que não existe.
--
-- A esteira de ingestão já tinha resolvido isso, e a solução dela é a que
-- este arquivo copia: `public.esteira_fila_ler`, `public.esteira_fila_
-- concluir`, `public.esteira_fila_falhar` e `public.esteira_fila_
-- enfileirar` são cascas de quatro linhas sobre `app.esteira_*`. É a
-- mesma forma aqui — casca `security invoker`, sem regra nenhuma dentro,
-- executável só por `service_role`.
--
-- REGRA DESTE ARQUIVO: nada de negócio nasce aqui. O que é decisão (quem
-- pode receber, qual o teto, se a janela está aberta, quanto custa) já
-- está em `app` e continua lá. O que nasce aqui é: (a) o transporte, e
-- (b) as três perguntas que a ponte precisa fazer e que ninguém tinha
-- feito ainda, cada uma marcada abaixo com "NOVO".
--
-- O QUE É NOVO, E POR QUÊ
-- ---------------------------------------------------------------------
--  1. `public.wa_webhook_receber` — a entrada da Meta em UMA transação:
--     a entrega crua em `webhook_deliveries` e os itens na fila
--     `wa_inbound`. Em uma transação porque a alternativa (a Edge
--     Function grava, depois enfileira) tem um instante em que a entrega
--     está registrada como recebida e nada foi enfileirado; e o registro
--     é justamente o que faz a reentrega da Meta ser ignorada. Ou seja:
--     a falha no meio perderia a mensagem em silêncio.
--
--  2. `public.wa_status_registrar` — a Meta avisa `sent`, `delivered`,
--     `read` e `failed` por webhook, e nada no banco sabia recebê-los.
--     Sem isto, toda mensagem enviada ficaria em `sent` para sempre e a
--     taxa de entrega do R08 §6.1 ("≥ 95%") não teria como ser medida.
--     O estado só ANDA para frente: um `delivered` que chega depois do
--     `read` (a Meta não garante ordem) não rebaixa a linha.
--
--  3. `public.wa_saida_proximos` — a pergunta que faltava, e é a regra
--     mais dura do R04 §2.1: FORA DA JANELA DE 24 H SÓ SAI TEMPLATE
--     APROVADO PELA META. `app.pode_enviar` já exige `template_id`, mas
--     `template_id` é uma linha da nossa tabela — não é aprovação da
--     Meta. Um modelo com `meta_status = 'pending'` passa por
--     `app.pode_enviar` e é recusado pela Graph API com erro 132001, o
--     que gastaria uma tentativa e sujaria a reputação do número.
--     Aqui a mensagem MORRE antes de sair, com o motivo por escrito na
--     linha (`sem_modelo_aprovado`), que é o que a tela lê.
--
--  4. `public.wa_optout_registrar` — o RF-CON-19 em uma transação:
--     supressão registrada ANTES de qualquer outra coisa e a confirmação
--     de uma linha enfileirada junto. Reusa `app.registrar_optout_de_
--     contato` (o caminho único do módulo de ligação, migração 001500) —
--     não existe um segundo. O que ele acrescenta é o caso que a ligação
--     não tem: uma conversa de WhatsApp pode chegar de um número que não
--     é ficha nenhuma, e aí não há `organization_id` para gravar em
--     `consent_events`. Nesse caso o número entra em `suppression_list`
--     por `app.suppress`, que é como o guardrail continua valendo.
--
--  5. O balde `mensagens` no Storage privado — áudio recebido precisa ser
--     baixado da Meta em ≤ 5 minutos (a URL dela expira) e guardado em
--     algum lugar antes de o worker-ai transcrever. Não havia balde
--     nenhum no projeto.
--
-- Idempotência de tudo: por `wa_message_id` (índice único parcial, já
-- existente) e por `ingest_dedup` (chave de idempotência da fila).
-- =====================================================================


-- =====================================================================
-- A. O BALDE DAS MÍDIAS RECEBIDAS
-- =====================================================================
-- Privado, sem política nenhuma em `storage.objects`: quem escreve e lê é
-- o worker com a chave de serviço, que ignora RLS. A tela, quando existir,
-- pede uma URL assinada ao servidor — nunca lê o balde direto. Balde
-- público para áudio de conversa seria vazamento por configuração.
--
-- 20 MB: o teto da Cloud API para áudio é 16 MB (R04 §2.1); a folga cobre
-- o cabeçalho do upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mensagens', 'mensagens', false, 20971520,
        array['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/aac',
              'image/jpeg', 'image/png', 'image/webp',
              'video/mp4', 'video/3gpp',
              'application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- =====================================================================
-- B. A ENTRADA DA META — uma transação, uma chave
-- =====================================================================
-- `p_itens` é o que a Edge Function extraiu do corpo da Meta: uma lista de
-- objetos, cada um com a sua `chave` de idempotência (o wamid, para
-- mensagem e eco; `status:<wamid>:<estado>` para recibo). A Edge Function
-- é ADAPTADOR: ela conhece o formato da Meta e mais nada. Quem decide o
-- que fazer com cada item é o worker, lendo a fila.
--
-- Por que a Edge Function extrai, e não esta função: o formato de
-- `entry[].changes[].value` é da Meta e muda com a versão da Graph API.
-- Um parser de JSON da Meta escrito em PL/pgSQL seria a peça mais frágil
-- do sistema no lugar mais caro de mexer.
create or replace function public.wa_webhook_receber(p_delivery_id text,
                                                     p_payload     jsonb,
                                                     p_itens       jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item        jsonb;
  v_chave       text;
  v_res         jsonb;
  v_enfileirados int := 0;
  v_repetidos    int := 0;
  v_duplicado    boolean := false;
begin
  if nullif(trim(coalesce(p_delivery_id, '')), '') is null then
    raise exception 'Entrega sem identificador não é idempotente' using errcode = '22023';
  end if;

  insert into public.webhook_deliveries (source, delivery_id, event, payload)
  values ('meta', left(trim(p_delivery_id), 200), 'whatsapp', coalesce(p_payload, '{}'::jsonb))
  on conflict (source, delivery_id) do nothing;
  if not found then
    v_duplicado := true;
  end if;

  -- A reentrega da mesma delivery devolve cedo: os itens dela já foram
  -- enfileirados na primeira vez, e `ingest_dedup` os recusaria de novo
  -- de qualquer jeito. Sair aqui é só não gastar as idas.
  if v_duplicado then
    return jsonb_build_object('duplicado', true, 'enfileirados', 0, 'repetidos', 0);
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_chave := nullif(trim(coalesce(v_item ->> 'chave', '')), '');
    if v_chave is null then
      continue;
    end if;
    v_res := app.esteira_enfileirar('wa_inbound', v_item, v_chave);
    if coalesce((v_res ->> 'enfileirado')::boolean, false) then
      v_enfileirados := v_enfileirados + 1;
    else
      v_repetidos := v_repetidos + 1;
    end if;
  end loop;

  update public.webhook_deliveries
     set processed_at = now(),
         result = jsonb_build_object('enfileirados', v_enfileirados, 'repetidos', v_repetidos)
   where source = 'meta' and delivery_id = left(trim(p_delivery_id), 200);

  return jsonb_build_object('duplicado', false,
                            'enfileirados', v_enfileirados,
                            'repetidos', v_repetidos);
end $$;
comment on function public.wa_webhook_receber(text, jsonb, jsonb) is
  'A entrada da Meta em uma transação (RF-CON-03): a entrega crua em webhook_deliveries e os itens já extraídos na fila wa_inbound. Idempotente duas vezes — pela delivery e, item a item, pela chave de idempotência da fila (o wamid). Reentrega devolve duplicado=true e não enfileira nada.';


-- ---------------------------------------------------------------------
-- B.1 As cascas de `app`
-- ---------------------------------------------------------------------
-- `p_type` entra como `text` e é convertido aqui: `app.msg_type` é um tipo
-- do schema privado e não pode aparecer na assinatura de uma função da
-- API — PostgREST não saberia serializá-lo, e expor o enum seria expor o
-- schema que o config.toml esconde.
create or replace function public.wa_entrada_registrar(p_wamid           text,
                                                       p_business_number text,
                                                       p_peer_phone      text,
                                                       p_type            text default 'text',
                                                       p_body            text default null,
                                                       p_media_id        text default null,
                                                       p_media_mime      text default null,
                                                       p_occurred_at     timestamptz default now())
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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
                                  coalesce(p_occurred_at, now()));
end $$;
comment on function public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz) is
  'Casca de app.wa_registrar_entrada para o worker, que só alcança o schema public. Tipo desconhecido da Meta vira "system" em vez de derrubar a mensagem.';


-- NOVO. O recibo de entrega da Meta.
--
-- Só anda para frente. A Meta entrega `sent`, `delivered` e `read` em
-- webhooks separados e NÃO garante a ordem; sem esta regra, um
-- `delivered` atrasado apagaria um `read` que já tinha chegado, e a
-- métrica de leitura ficaria menor do que a verdade.
--
-- `failed` é a exceção: ele vence qualquer estado anterior, porque uma
-- mensagem que a Meta devolveu com erro não foi entregue, tenha ela
-- passado por `sent` ou não.
create or replace function public.wa_status_registrar(p_wamid       text,
                                                      p_status      text,
                                                      p_ocorrido_em timestamptz default now(),
                                                      p_codigo      text default null,
                                                      p_detalhe     text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m        public.messages%rowtype;
  v_novo   app.msg_status;
  v_peso   constant jsonb := '{"queued":0,"sent":1,"delivered":2,"read":3,"failed":9,"received":0}'::jsonb;
  v_quando timestamptz := coalesce(p_ocorrido_em, now());
begin
  if nullif(trim(coalesce(p_wamid, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_wamid');
  end if;
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_desconhecido', 'estado', p_status);
  end if;
  v_novo := p_status::app.msg_status;

  select * into m from public.messages where wa_message_id = p_wamid;
  if not found then
    -- Recibo de uma mensagem que ainda não gravamos (o eco do celular pode
    -- chegar depois do recibo dele). Não é erro: a fila reentrega.
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_desconhecida');
  end if;
  if m.direction <> 'out'::app.msg_direction then
    return jsonb_build_object('ok', false, 'motivo', 'recibo_de_mensagem_recebida');
  end if;

  if (v_peso ->> p_status)::int <= (v_peso ->> m.status::text)::int then
    return jsonb_build_object('ok', true, 'motivo', 'estado_nao_retrocede',
                              'message_id', m.id, 'estado', m.status);
  end if;

  update public.messages
     set status       = v_novo,
         sent_at      = case when v_novo = 'sent'::app.msg_status then coalesce(sent_at, v_quando) else sent_at end,
         delivered_at = case when v_novo = 'delivered'::app.msg_status then coalesce(delivered_at, v_quando) else delivered_at end,
         read_at      = case when v_novo = 'read'::app.msg_status then coalesce(read_at, v_quando) else read_at end,
         failed_at    = case when v_novo = 'failed'::app.msg_status then coalesce(failed_at, v_quando) else failed_at end,
         error_code   = case when v_novo = 'failed'::app.msg_status
                             then coalesce(nullif(trim(coalesce(p_codigo, '')), ''), 'erro_meta')
                             else error_code end,
         error_detail = case when v_novo = 'failed'::app.msg_status
                             then left(coalesce(p_detalhe, ''), 2000) else error_detail end
   where id = m.id;

  return jsonb_build_object('ok', true, 'motivo', 'atualizado',
                            'message_id', m.id, 'estado', p_status);
end $$;
comment on function public.wa_status_registrar(text, text, timestamptz, text, text) is
  'Recibo de entrega da Meta (sent/delivered/read/failed) aplicado à mensagem pelo wamid. O estado só ANDA: a Meta não garante ordem entre os webhooks, e um delivered atrasado não pode apagar um read que já chegou. failed vence tudo — mensagem devolvida com erro não foi entregue.';


-- NOVO. O eco do Coexistence (R04 §2.1, `smb_message_echoes`).
--
-- A Heloísa manda o primeiro contato pelo celular e a Meta ecoa. Isso não
-- é um PEDIDO de envio: é o REGISTRO de um envio que já aconteceu, com o
-- polegar de uma pessoa. A seção E.3 da migração 000200 explica por que
-- ele entra sempre — e por que conta no teto. Aqui é só a porta.
create or replace function public.wa_eco_registrar(p_wamid           text,
                                                   p_business_number text,
                                                   p_peer_phone      text,
                                                   p_type            text default 'text',
                                                   p_body            text default null,
                                                   p_media_id        text default null,
                                                   p_media_mime      text default null,
                                                   p_occurred_at     timestamptz default now())
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_peer  text := coalesce(app.normalize_phone_br(p_peer_phone), p_peer_phone);
  v_num   text := coalesce(app.normalize_phone_br(p_business_number), p_business_number);
  v_tipo  app.msg_type;
  v_conv  uuid;
  v_org   uuid;
  v_ct    uuid;
  v_msg   uuid;
  v_quando timestamptz := coalesce(p_occurred_at, now());
begin
  if nullif(trim(coalesce(p_wamid, '')), '') is null then
    raise exception 'Eco sem wa_message_id não é idempotente (RF-CON-03)' using errcode = '22023';
  end if;

  select m.id, m.conversation_id into v_msg, v_conv
    from public.messages m where m.wa_message_id = p_wamid;
  if found then
    return jsonb_build_object('novo', false, 'message_id', v_msg, 'conversation_id', v_conv);
  end if;

  begin
    v_tipo := coalesce(nullif(trim(coalesce(p_type, '')), ''), 'text')::app.msg_type;
  exception when others then
    v_tipo := 'system'::app.msg_type;
  end;

  select c.id into v_conv from public.conversations c
   where c.channel = 'whatsapp'::app.channel
     and c.business_number = v_num and c.peer_phone_e164 = v_peer;

  if v_conv is null then
    select o.id into v_org from public.organizations o
     where o.phone_e164 = v_peer and o.deleted_at is null limit 1;
    select ct.id into v_ct from public.contacts ct
     where ct.phone_e164 = v_peer and ct.deleted_at is null limit 1;
    if v_org is null and v_ct is not null then
      select oc.organization_id into v_org from public.organization_contacts oc
       where oc.contact_id = v_ct limit 1;
    end if;
    insert into public.conversations (channel, business_number, peer_phone_e164,
                                      organization_id, contact_id, status)
    values ('whatsapp'::app.channel, v_num, v_peer, v_org, v_ct, 'aguardando_parceiro')
    returning id into v_conv;
  end if;

  insert into public.messages (conversation_id, direction, type, status, wa_message_id,
                               body, media_id, media_mime, author_kind, origin,
                               created_at, sent_at)
  values (v_conv, 'out'::app.msg_direction, v_tipo, 'sent'::app.msg_status, p_wamid,
          p_body, p_media_id, p_media_mime, 'human', 'echo', v_quando, v_quando)
  on conflict (wa_message_id) where wa_message_id is not null do nothing
  returning id into v_msg;

  if v_msg is null then
    select m.id into v_msg from public.messages m where m.wa_message_id = p_wamid;
    return jsonb_build_object('novo', false, 'message_id', v_msg, 'conversation_id', v_conv);
  end if;
  return jsonb_build_object('novo', true, 'message_id', v_msg, 'conversation_id', v_conv);
end $$;
comment on function public.wa_eco_registrar(text, text, text, text, text, text, text, timestamptz) is
  'Registra o eco do Coexistence: a mensagem que a pessoa mandou pelo celular e a Meta devolveu (R04 §2.1). É registro do que já aconteceu — entra sempre, não passa por porteira e conta no teto do número (migração 000200, seção E.3). Idempotente pelo wamid.';


-- =====================================================================
-- C. OPT-OUT — imediato, antes de qualquer outra coisa (RF-CON-19)
-- =====================================================================
-- O guardrail do CLAUDE.md: 'Opt-out por regra ("sair", "parar", "não
-- quero", "remover") → `do_not_contact` imediato e entrada na
-- `suppression_list`; nenhum envio a contato suprimido, em nenhum modo.'
--
-- Reuso, não caminho novo: quem grava é `app.registrar_optout_de_contato`
-- (migração 001500), que é o ÚNICO lugar do sistema que registra opt-out,
-- e que por gatilho já escreve `do_not_contact`, os hashes da
-- `suppression_list` e a etapa de opt-out no funil.
--
-- O que esta função acrescenta é o caso que a ligação não tem: uma
-- conversa de WhatsApp pode vir de um número que não é ficha nenhuma
-- (`organization_id` e `contact_id` nulos). `consent_events` exige um
-- alvo; sem ele, `registrar_optout_de_contato` devolve `sem_alvo` e o
-- pedido morreria em silêncio. Nesse caso o NÚMERO entra direto na
-- `suppression_list` por `app.suppress` — que é exatamente o hash que
-- `app.wa_motivo_de_recusa` consulta na segunda pergunta dela
-- ("numero_suprimido"). O guardrail continua valendo com ficha ou sem.
--
-- A confirmação de uma linha (`GEN-SYS-OPTOUT`, R08 §2.7) é enfileirada
-- na MESMA transação. É a única mensagem que atravessa a supressão, e a
-- migração 000200 já fez disso uma constraint: `optout_confirmation` com
-- índice único por conversa. Chamar duas vezes não manda duas.
create or replace function public.wa_optout_registrar(p_conversation_id uuid,
                                                      p_evidencia       text default null,
                                                      p_confirmar       boolean default true)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c          public.conversations%rowtype;
  v_opt      jsonb;
  v_registrado boolean := false;
  v_motivo   text;
  v_tpl      public.message_templates%rowtype;
  v_nome     text;
  v_corpo    text;
  v_msg      uuid;
  v_confirmada boolean := false;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;

  -- 1 · A supressão PRIMEIRO, sempre. Antes da confirmação, antes de
  --     qualquer atualização de conversa, antes de tudo.
  if c.organization_id is not null or c.contact_id is not null then
    v_opt := app.registrar_optout_de_contato(c.organization_id, c.contact_id,
                                             coalesce(nullif(trim(coalesce(p_evidencia, '')), ''),
                                                      'Pediu para não receber mais mensagens no WhatsApp.'),
                                             'whatsapp'::app.channel);
    v_registrado := coalesce((v_opt ->> 'registrado')::boolean, false);
    v_motivo     := v_opt ->> 'motivo';
  end if;

  -- 2 · O número, com ficha ou sem. `app.suppress` é idempotente
  --     (on conflict do nothing) e é o hash que app.wa_motivo_de_recusa lê.
  perform app.suppress('phone', c.peer_phone_e164,
                       coalesce(nullif(trim(coalesce(p_evidencia, '')), ''),
                                'Opt-out por regra no WhatsApp (RF-CON-19).'),
                       'whatsapp'::app.channel, null);
  if not v_registrado then
    v_registrado := true;
    v_motivo := coalesce(v_motivo, 'numero_suprimido_sem_ficha');
  end if;

  -- 3 · O robô cala nesta conversa. Não é o guardrail (o guardrail é a
  --     supressão), é higiene: nenhum rascunho novo nasce para um fio
  --     encerrado.
  update public.conversations
     set bot_paused = true, status = 'resolvida', updated_at = now()
   where id = c.id;

  -- 4 · A confirmação de uma linha (RF-CON-19). Texto FIXO: o gatilho de
  --     `messages` recusa `author_kind = 'bot_ai'` aqui, e com razão —
  --     confirmação de opt-out redigida por IA é a última mensagem que
  --     alguém quer ver improvisada.
  if p_confirmar then
    select * into v_tpl from public.message_templates
     where template_code = 'GEN-SYS-OPTOUT' and is_active limit 1;
    if found then
      select coalesce(nullif(trim(ct.first_name), ''), nullif(trim(ct.full_name), ''))
        into v_nome from public.contacts ct where ct.id = c.contact_id;
      -- Sem nome, a saudação vira vocativo vazio: tira-se a vírgula junto.
      v_corpo := case when v_nome is null
                      then replace(replace(v_tpl.body, ', {{nome}}', ''), '{{nome}}', '')
                      else replace(v_tpl.body, '{{nome}}', v_nome) end;
      begin
        insert into public.messages (conversation_id, direction, type, status, body,
                                     author_kind, origin, optout_confirmation, template_id)
        values (c.id, 'out'::app.msg_direction, 'text'::app.msg_type,
                'queued'::app.msg_status, trim(v_corpo), 'system', 'crm', true, v_tpl.id)
        returning id into v_msg;
        v_confirmada := true;
        perform app.wa_enfileirar_envio(v_msg);
      exception when unique_violation then
        -- O índice único por conversa: a confirmação já saiu uma vez.
        v_confirmada := false;
      end;
    end if;
  end if;

  return jsonb_build_object('ok', true,
                            'registrado', v_registrado,
                            'motivo', coalesce(v_motivo, 'registrado'),
                            'confirmacao_enfileirada', v_confirmada,
                            'message_id', v_msg);
end $$;
comment on function public.wa_optout_registrar(uuid, text, boolean) is
  'Opt-out por regra no WhatsApp (RF-CON-19, guardrail do CLAUDE.md), em uma transação: supressão PRIMEIRO — pelo caminho único app.registrar_optout_de_contato quando há ficha, e sempre também pelo número em app.suppress, que é o hash que app.wa_motivo_de_recusa consulta —, robô calado na conversa e a confirmação de UMA linha (GEN-SYS-OPTOUT) enfileirada. Chamar duas vezes não manda duas confirmações: o índice único parcial de messages é quem garante.';


-- =====================================================================
-- D. A SAÍDA
-- =====================================================================

-- Quem põe na fila o que a tela deixou em `queued`. `app.wa_enfileirar_
-- envio` existe desde 000200 e ninguém a chamava: a mensagem aprovada
-- ficava `queued` na tabela e nunca chegava a `wa_outbound`.
--
-- A varredura é do worker por escolha: gatilho de INSERT que enfileira
-- acopla a transação da tela à fila, e uma tela que trava porque a fila
-- travou é pior do que uma mensagem que sai 20 segundos depois.
create or replace function public.wa_saida_enfileirar_pendentes(p_qty int default 50)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m         record;
  v_res     jsonb;
  v_novos   int := 0;
  v_ja      int := 0;
begin
  for m in select id from public.messages
            where direction = 'out'::app.msg_direction
              and status = 'queued'::app.msg_status
            order by created_at
            limit least(greatest(coalesce(p_qty, 50), 1), 500) loop
    v_res := app.wa_enfileirar_envio(m.id);
    if coalesce((v_res ->> 'enfileirado')::boolean, false) then
      v_novos := v_novos + 1;
    else
      v_ja := v_ja + 1;
    end if;
  end loop;
  return jsonb_build_object('enfileirados', v_novos, 'ja_estavam', v_ja);
end $$;
comment on function public.wa_saida_enfileirar_pendentes(int) is
  'Põe em wa_outbound as mensagens que estão em queued e ainda não foram enfileiradas. Idempotente por ingest_dedup (a chave é o id da mensagem). Existe porque app.wa_enfileirar_envio não tinha quem a chamasse.';


-- O texto que a tela mostra para cada motivo de espera. Uma função só
-- porque a tela, o log e o relatório precisam dizer a mesma coisa.
create or replace function app.wa_motivo_legivel(p_motivo text, p_quando timestamptz default null)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_motivo
           when 'janela_fora_de_hora'  then 'Fora da janela de envio (RF-CON-11).'
           when 'janela_domingo'       then 'Domingo: nenhuma mensagem sai (RF-CON-11).'
           when 'janela_feriado'       then 'Feriado: nenhuma mensagem sai (RF-CON-11).'
           when 'janela_fechada'       then 'Fora da janela de envio (RF-CON-11).'
           when 'teto_do_numero'       then 'Teto de primeiros contatos do dia atingido neste número (RF-CON-10).'
           when 'teto_iniciadas_dia'   then 'Teto de 150 mensagens iniciadas pela empresa no dia (RF-CON-10).'
           when 'teto_iniciadas_hora'  then 'Teto de 60 mensagens iniciadas pela empresa na hora (RF-CON-10).'
           when 'sem_janela_e_sem_template'
             then 'Fora da janela de 24 h e sem modelo aprovado: a Meta só aceita template para iniciar conversa (R04 §2.1).'
           else coalesce(p_motivo, 'aguardando')
         end
      || case when p_quando is null then ''
              else ' Próxima tentativa a partir de ' ||
                   to_char(p_quando at time zone 'America/Fortaleza', 'DD/MM HH24:MI') || '.'
         end
$$;
comment on function app.wa_motivo_legivel(text, timestamptz) is
  'O motivo da espera em uma frase de pt-BR, com a próxima janela quando existe. Um lugar só para que a tela, o log e o relatório digam a mesma coisa.';


-- A REGRA DO R04 §2.1, isolada numa função para poder ser medida sozinha.
--
-- "Mensagem iniciada pela empresa exige template aprovado (marketing/utility/
-- authentication). Texto livre, áudio, imagem e documento só dentro da janela
-- de 24 h aberta por uma mensagem do contato."
--
-- `message_templates.template_code` é NOSSO código (GEN-FUP-LIG-V1);
-- `meta_template_name` é o nome do template DELES, e `meta_status` diz se a
-- Meta aprovou. Um modelo existe na nossa tabela muito antes de a Meta o
-- aprovar — hoje, de 126 modelos, nenhum está aprovado. Confundir os dois é
-- mandar 132001 para a Cloud API e gastar reputação do número com um erro que
-- era nosso.
create or replace function app.wa_modelo_da_meta(p_template_id int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when p_template_id is null then
             jsonb_build_object('aprovado', false, 'situacao', 'sem_modelo')
           when t.id is null then
             jsonb_build_object('aprovado', false, 'situacao', 'modelo_inexistente')
           when t.meta_status is distinct from 'approved' then
             jsonb_build_object('aprovado', false, 'situacao',
                                coalesce(t.meta_status, 'nao_enviado_a_meta'),
                                'codigo', t.template_code)
           when nullif(trim(coalesce(t.meta_template_name, '')), '') is null then
             jsonb_build_object('aprovado', false, 'situacao', 'aprovado_sem_nome_na_meta',
                                'codigo', t.template_code)
           else
             jsonb_build_object('aprovado', true, 'situacao', 'approved',
                                'codigo', t.template_code,
                                'nome_meta', t.meta_template_name,
                                'idioma', t.language,
                                'categoria', t.category)
         end
    from (select p_template_id as pedido) q
    left join public.message_templates t on t.id = p_template_id
$$;
comment on function app.wa_modelo_da_meta(int) is
  'O modelo está APROVADO PELA META? (R04 §2.1). Distingue o código nosso (template_code) do nome deles (meta_template_name) e devolve a situação por escrito: sem_modelo, modelo_inexistente, pending, rejected, nao_enviado_a_meta, aprovado_sem_nome_na_meta, approved. É a regra que decide se uma mensagem fora da janela de 24 h pode sair.';


-- NOVO, e é a regra do R04 §2.1 virando código:
-- FORA DA JANELA DE 24 H SÓ SAI TEMPLATE APROVADO PELA META.
--
-- `app.pode_enviar` já exige `template_id is not null` fora da janela. Mas
-- `template_id` aponta para uma linha da NOSSA tabela, e a nossa tabela
-- tem modelo com `meta_status = 'pending'` — hoje, quase todos. Sair com
-- um desses é receber 132001 da Graph API ("template name does not
-- exist"), gastar uma tentativa, e o pior: a mensagem fica `failed` com um
-- erro técnico da Meta em vez do motivo real, que é nosso.
--
-- Aqui ela não sai, MORRE antes com o motivo por escrito (`sem_modelo_
-- aprovado`) — que é o que a tela lê. "Se não houver modelo aprovado, não
-- sai nada e a tela diz por quê."
--
-- E o adiamento também vira texto: quando `app.wa_proximos` devolve um
-- item ADIADO (fora de janela de horário, teto do número, sem template),
-- o motivo é escrito em `error_detail` sem mexer no `status`. Uma mensagem
-- parada há três horas sem nenhuma explicação na linha é uma mensagem que
-- alguém vai reenviar à mão.
create or replace function public.wa_saida_proximos(p_qty int default 10)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bruto     jsonb;
  v_item      jsonb;
  v_out       jsonb := '[]'::jsonb;
  v_recusados jsonb;
  v_modelo    jsonb;
  v_precisa   boolean;
  v_mid       uuid;
  v_msgid     bigint;
  v_conv      uuid;
begin
  v_bruto     := app.wa_proximos(p_qty);
  v_recusados := coalesce(v_bruto -> 'recusados', '[]'::jsonb);

  -- O motivo do adiamento vira texto na linha, para a tela poder dizê-lo.
  for v_item in select * from jsonb_array_elements(v_recusados) loop
    if (v_item ->> 'acao') = 'adiado' and (v_item ->> 'message_id') is not null then
      update public.messages
         set error_detail = left(app.wa_motivo_legivel(v_item ->> 'motivo',
                                                       (v_item ->> 'quando')::timestamptz), 2000)
       where id = (v_item ->> 'message_id')::uuid
         and status = 'queued'::app.msg_status;
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(v_bruto -> 'itens', '[]'::jsonb)) loop
    v_mid   := (v_item ->> 'message_id')::uuid;
    v_conv  := (v_item ->> 'conversation_id')::uuid;
    v_msgid := (v_item ->> 'msg_id')::bigint;

    -- Fora da janela = iniciada pela empresa = template obrigatório.
    v_precisa := not app.janela_de_24h_aberta(v_conv, now());

    v_modelo := app.wa_modelo_da_meta((v_item ->> 'template_id')::int);

    if v_precisa and not coalesce((v_modelo ->> 'aprovado')::boolean, false) then
      update public.messages
         set status = 'failed'::app.msg_status,
             error_code = 'sem_modelo_aprovado',
             error_detail = case
               when (v_modelo ->> 'situacao') = 'sem_modelo' then
                 'Fora da janela de 24 h e sem modelo: a Meta só aceita template aprovado para iniciar conversa.'
               else
                 'Fora da janela de 24 h e o modelo ' || coalesce(v_modelo ->> 'codigo', '(sem código)') ||
                 ' ainda não está aprovado pela Meta (situação: ' ||
                 (v_modelo ->> 'situacao') || ').'
               end,
             failed_at = now()
       where id = v_mid and status = 'queued'::app.msg_status;
      update public.message_drafts
         set status = 'descartado',
             discard_reason = 'recusado na entrega: sem modelo aprovado pela Meta'
       where message_id = v_mid and status in ('aprovado', 'enviado');
      perform pgmq.archive('wa_outbound', v_msgid);
      v_recusados := v_recusados || jsonb_build_array(
        jsonb_build_object('message_id', v_mid, 'motivo', 'sem_modelo_aprovado', 'acao', 'morto'));
      continue;
    end if;

    v_out := v_out || jsonb_build_array(v_item || jsonb_build_object(
      'janela_aberta', not v_precisa,
      'modelo', case when coalesce((v_modelo ->> 'aprovado')::boolean, false)
                     then v_modelo - 'aprovado' - 'situacao' else null end));
  end loop;

  return jsonb_build_object('itens', v_out, 'recusados', v_recusados);
end $$;
comment on function public.wa_saida_proximos(int) is
  'O lote que o worker-wa envia. Chama app.wa_proximos (que reconfere supressão, janela e teto no instante da entrega) e acrescenta a pergunta que faltava: fora da janela de 24 h, o modelo tem de estar APROVADO PELA META (R04 §2.1). Sem modelo aprovado a mensagem morre aqui, com o motivo por escrito na linha — não sai para receber 132001 da Graph API. O motivo de cada adiamento também vira texto em error_detail.';


create or replace function public.wa_saida_sucesso(p_msg_id     bigint,
                                                   p_message_id uuid,
                                                   p_wamid      text,
                                                   p_custo      numeric default null,
                                                   p_categoria  text default null)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select app.wa_sucesso(p_msg_id, p_message_id, p_wamid, p_custo, p_categoria)
$$;
comment on function public.wa_saida_sucesso(bigint, uuid, text, numeric, text) is
  'Casca de app.wa_sucesso: a Graph API aceitou, o wamid volta para a linha e a mensagem sai da fila.';

create or replace function public.wa_saida_falha(p_msg_id     bigint,
                                                 p_message_id uuid,
                                                 p_erro       text,
                                                 p_codigo     text default 'erro_meta')
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.wa_falha(p_msg_id, p_message_id, p_erro, p_codigo)
$$;
comment on function public.wa_saida_falha(bigint, uuid, text, text) is
  'Casca de app.wa_falha: backoff exponencial até o teto da fila, e só então a mensagem vira failed com o motivo na linha.';


-- O erro DEFINITIVO da Meta: a mensagem não volta para a fila.
--
-- `app.wa_falha` aplica backoff e só encerra a mensagem quando o teto de
-- tentativas de `wa_outbound` (quatro) estoura. Isso está certo para "a Meta
-- está ocupada" e errado para "este número não tem WhatsApp": insistir quatro
-- vezes não muda o resultado, e insistir quatro vezes num envio fora da janela
-- de 24 h são quatro registros de "empresa insistindo" na conta que a Meta usa
-- para calcular o quality rating do número (R04 §4).
--
-- `graph.ts` sabe distinguir os dois pela tabela de erros da Cloud API. Quando
-- ele diz "definitivo", é esta função que fecha: motivo na linha, rascunho
-- descartado, chave de idempotência encerrada e mensagem fora da fila.
create or replace function public.wa_saida_falha_definitiva(p_msg_id     bigint,
                                                            p_message_id uuid,
                                                            p_erro       text,
                                                            p_codigo     text default 'erro_meta')
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n int;
begin
  update public.messages
     set status = 'failed'::app.msg_status,
         error_code = coalesce(nullif(trim(p_codigo), ''), 'erro_meta'),
         error_detail = left(coalesce(p_erro, ''), 2000),
         failed_at = now()
   where id = p_message_id and status = 'queued'::app.msg_status;
  get diagnostics n = row_count;

  update public.message_drafts
     set status = 'descartado',
         discard_reason = left('recusado pela Meta: ' || coalesce(p_erro, p_codigo), 500)
   where message_id = p_message_id and status in ('aprovado', 'enviado');

  perform app.esteira_concluir('wa_outbound', p_msg_id, p_message_id::text);
  return jsonb_build_object('acao', 'encerrado', 'mensagens', n);
end $$;
comment on function public.wa_saida_falha_definitiva(bigint, uuid, text, text) is
  'Encerra a mensagem cujo erro na Cloud API não melhora com repetição (número sem WhatsApp, template inexistente, fora da janela). Sem backoff: motivo na linha, rascunho descartado, chave de idempotência encerrada e mensagem fora da fila. O que é transitório continua indo por app.wa_falha.';


-- Mídia guardada: o worker baixou o áudio da Meta (a URL dela expira em 5
-- minutos) e o gravou no balde privado. Só o caminho entra na linha.
create or replace function public.wa_midia_registrar(p_message_id uuid, p_media_path text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n int;
begin
  update public.messages
     set media_path = nullif(trim(coalesce(p_media_path, '')), '')
   where id = p_message_id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end $$;
comment on function public.wa_midia_registrar(uuid, text) is
  'Grava o caminho da mídia já baixada da Meta e guardada no balde privado "mensagens". A URL de download da Meta expira em 5 minutos: quem baixa é o worker-wa, na hora.';


-- =====================================================================
-- E. A FILA DA IA — a casca que o worker-wa usa para pedir a transcrição
-- =====================================================================
-- O R13 mudou a ordem do que a IA faz: o fornecedor manda áudio mesmo
-- quando a gente escreve, e transcrever é a PRIMEIRA coisa. Quem percebe
-- que chegou áudio é o worker-wa; quem transcreve é o worker-ai. A ponte
-- entre os dois é esta fila.
create or replace function public.ia_fila_enfileirar(p_purpose text, p_payload jsonb, p_key text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.ia_enfileirar(p_purpose, p_payload, p_key)
$$;
comment on function public.ia_fila_enfileirar(text, jsonb, text) is
  'Casca de app.ia_enfileirar para quem só alcança o schema public. A chave de idempotência continua sendo "<propósito>:<chave>": a mesma mensagem transcrita duas vezes é dinheiro gasto duas vezes.';


-- =====================================================================
-- F. GRANTS — só o worker e as Edge Functions
-- =====================================================================
-- Nenhuma destas funções é para a tela. A tela aprova rascunho
-- (`public.aprovar_rascunho`), descarta (`public.descartar_rascunho`) e
-- insere a mensagem que uma pessoa digitou (policy de `messages`). Enviar,
-- registrar entrada, aplicar recibo e suprimir número é trabalho de
-- worker — e worker aqui é `service_role`.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.wa_webhook_receber(text, jsonb, jsonb)',
    'public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz)',
    'public.wa_status_registrar(text, text, timestamptz, text, text)',
    'public.wa_eco_registrar(text, text, text, text, text, text, text, timestamptz)',
    'public.wa_optout_registrar(uuid, text, boolean)',
    'public.wa_saida_enfileirar_pendentes(int)',
    'public.wa_saida_proximos(int)',
    'public.wa_saida_sucesso(bigint, uuid, text, numeric, text)',
    'public.wa_saida_falha(bigint, uuid, text, text)',
    'public.wa_saida_falha_definitiva(bigint, uuid, text, text)',
    'public.wa_midia_registrar(uuid, text)',
    'public.ia_fila_enfileirar(text, jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

revoke all on function app.wa_motivo_legivel(text, timestamptz) from public, anon;
grant execute on function app.wa_motivo_legivel(text, timestamptz) to authenticated, service_role;
revoke all on function app.wa_modelo_da_meta(int) from public, anon, authenticated;
grant execute on function app.wa_modelo_da_meta(int) to service_role;

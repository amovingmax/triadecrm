-- =====================================================================
-- O WhatsApp guarda o BSUID (RF-CON-03, RF-CON-19; ADR-03, ADR-04;
-- anexo R04 §3)
-- =====================================================================
--
-- A Meta está lançando NOMES DE USUÁRIO no WhatsApp e, junto, um
-- identificador novo: o "business-scoped user ID" (BSUID), único por pessoa
-- e por portfólio de empresa, no formato `BR.<alfanumérico>`.
-- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
--
--   · desde o começo de abril/2026 o BSUID vem em TODO webhook de `messages`:
--     `messages[].from_user_id`, `statuses[].recipient_user_id`,
--     `contacts[].user_id`;
--   · quem adota nome de usuário pode chegar SEM telefone (`from`, `wa_id` e
--     `recipient_id` omitidos) — a Meta só manda o número quando houve troca
--     de mensagem ou ligação com ele nos últimos 30 dias, ou quando ele está
--     no "contact book" da empresa;
--   · desde julho/2026 dá para ENVIAR para um BSUID (campo `recipient`).
--
-- Até aqui a Edge Function descartava a mensagem sem `from`
-- (`mensagem_sem_id_ou_numero`) e a conversa só existia por telefone
-- (`peer_phone_e164 NOT NULL`, chave única com o número da empresa). Esta
-- migração entrega três peças:
--
--   A. `conversations.peer_user_id`: a conversa aprende o BSUID de quem está
--      do outro lado — na mensagem recebida e no recibo de entrega.
--   B. SEM TELEFONE, A CONVERSA CONHECIDA OU A DEAD-LETTER. Mensagem que chega
--      só com o BSUID entra na conversa que já conhece aquele BSUID. Se nenhuma
--      conhece, NÃO nasce conversa sem telefone: vai para a `wa_dlq`, com nome,
--      e o dreno (`app.dlq_drenar`) a põe em `public.dead_letters` com tarefa
--      para o admin.
--   C. O recibo continua sendo aplicado pelo wamid; o BSUID só ensina a
--      conversa da mensagem.
--
-- POR QUE NÃO UMA CONVERSA "SÓ COM BSUID". `peer_phone_e164` é o que a
-- supressão, o opt-out (`app.suppress('phone', …)`), a saída
-- (`wa_saida_proximos.para`), o teto e a trava de identidade do fio leem.
-- Um fio sem telefone seria um fio em que um "SAIR" não tem como virar
-- supressão — o guardrail mais importante do produto quebraria justamente
-- para quem escreveu pedindo para sair. Afrouxar o NOT NULL é mudar isso
-- tudo junto, e é decisão de produto (enviar para BSUID), não conserto.
--
-- O QUE NÃO MUDA: o envio continua indo para o TELEFONE. Mandar para BSUID
-- fica para quando alguém decidir que o CRM fala com quem não mostrou o
-- número.
-- =====================================================================


-- =====================================================================
-- A. A COLUNA
-- =====================================================================
-- Texto livre com teto e sem espaço: o formato é da Meta (`BR.123…`, e o
-- "parent BSUID" `BR.ENT.123…`) e um CHECK apertado derrubaria a mensagem
-- no dia em que a Meta mudar o desenho. O que importa é não aceitar lixo.
alter table public.conversations
  add column if not exists peer_user_id text
    check (peer_user_id is null or (length(peer_user_id) between 3 and 200
                                    and peer_user_id !~ '\s'));
comment on column public.conversations.peer_user_id is
  'BSUID (business-scoped user ID) de quem está do outro lado, como a Meta mandou em from_user_id / recipient_user_id. Aprendido pelo worker na mensagem recebida e no recibo; é por ele que uma mensagem SEM telefone (pessoa com nome de usuário) acha a conversa. Não é identidade do fio: o fio continua sendo o telefone (migração 20260915120000).';

-- Não é único: uma pessoa cujo número foi normalizado de dois jeitos no
-- passado pode ter dois fios, e um índice único faria o recibo — que só
-- quer ensinar — derrubar o processamento da fila.
create index if not exists conversations_bsuid_idx
  on public.conversations (channel, business_number, peer_user_id)
  where peer_user_id is not null;


-- ---------------------------------------------------------------------
-- A.1 Quem escreve o BSUID é o worker
-- ---------------------------------------------------------------------
-- A policy `conversations_update` deixa gestor e responsável reescreverem a
-- linha. Com o BSUID isso seria um desvio: pôr o BSUID de B no fio de A faria
-- o "SAIR" de B (que chegou sem telefone) suprimir o telefone de A. Então o
-- BSUID só muda por quem não é sessão do navegador — o worker (`service_role`)
-- e as funções `security definer` do próprio banco.
--
-- `security invoker` DE PROPÓSITO: é o `current_user` de quem disparou o
-- gatilho que diz se a escrita veio da tela.
create or replace function app.conversations_bsuid_so_do_worker()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_antes text;
begin
  if tg_op = 'UPDATE' then
    v_antes := old.peer_user_id;
  end if;
  if current_user in ('authenticated', 'anon')
     and new.peer_user_id is distinct from v_antes then
    raise exception 'O BSUID da conversa é aprendido do webhook da Meta e não é editável pela tela (RF-CON-19)'
      using errcode = '42501';
  end if;
  return new;
end $$;
comment on function app.conversations_bsuid_so_do_worker() is
  'Tranca conversations.peer_user_id contra escrita da sessão do navegador: é por ele que mensagem sem telefone acha o fio, e trocá-lo desviaria um opt-out para o telefone de outra pessoa.';
revoke all on function app.conversations_bsuid_so_do_worker() from public, anon, authenticated;

drop trigger if exists conversations_bsuid_so_do_worker on public.conversations;
create trigger conversations_bsuid_so_do_worker before insert or update on public.conversations
  for each row execute function app.conversations_bsuid_so_do_worker();


-- =====================================================================
-- B. A MENSAGEM RECEBIDA — com telefone, só com BSUID, ou para a dead-letter
-- =====================================================================
-- A assinatura ganha `p_peer_user_id` no fim, com default: quem chama com
-- cinco ou oito argumentos posicionais (pgTAP, funções antigas) continua
-- chamando. A antiga sai antes, para não sobrar duas candidatas.
drop function if exists public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz);
drop function if exists app.wa_registrar_entrada(text, text, text, app.msg_type, text, text, text, timestamptz);

create or replace function app.wa_registrar_entrada(p_wamid           text,
                                                    p_business_number text,
                                                    p_peer_phone      text,
                                                    p_type            app.msg_type default 'text'::app.msg_type,
                                                    p_body            text default null,
                                                    p_media_id        text default null,
                                                    p_media_mime      text default null,
                                                    p_occurred_at     timestamptz default now(),
                                                    p_peer_user_id    text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_peer  text := nullif(trim(coalesce(app.normalize_phone_br(p_peer_phone), p_peer_phone, '')), '');
  v_num   text := coalesce(app.normalize_phone_br(p_business_number), p_business_number);
  v_bsuid text := nullif(trim(coalesce(p_peer_user_id, '')), '');
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
                                      organization_id, contact_id, status)
    values ('whatsapp'::app.channel, v_num, v_peer, v_bsuid, v_org, v_ct, 'aguardando_nos')
    returning id into v_conv;
  elsif v_bsuid is not null then
    -- A conversa aprende (ou reaprende: a Meta gera BSUID novo quando a
    -- pessoa troca de número) o BSUID de quem escreveu.
    update public.conversations
       set peer_user_id = v_bsuid
     where id = v_conv and peer_user_id is distinct from v_bsuid;
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
end $$;
comment on function app.wa_registrar_entrada(text, text, text, app.msg_type, text, text, text, timestamptz, text) is
  'Grava uma mensagem recebida da Meta e cria a conversa quando ela não existe (RF-CON-03). Idempotente pelo wamid. Mensagem de contato suprimido entra: é a prova do opt-out. Desde 20260915120000 guarda o BSUID na conversa e aceita mensagem SEM telefone: entra no fio que já conhece o BSUID ou, se nenhum conhece, vai para a wa_dlq (sem_telefone=true) — nunca nasce fio sem telefone, porque sem telefone não há supressão.';
revoke all on function app.wa_registrar_entrada(text, text, text, app.msg_type, text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function app.wa_registrar_entrada(text, text, text, app.msg_type, text, text, text, timestamptz, text)
  to service_role;


create or replace function public.wa_entrada_registrar(p_wamid           text,
                                                       p_business_number text,
                                                       p_peer_phone      text,
                                                       p_type            text default 'text',
                                                       p_body            text default null,
                                                       p_media_id        text default null,
                                                       p_media_mime      text default null,
                                                       p_occurred_at     timestamptz default now(),
                                                       p_peer_user_id    text default null)
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
                                  coalesce(p_occurred_at, now()), p_peer_user_id);
end $$;
comment on function public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text) is
  'Casca de app.wa_registrar_entrada para o worker, que só alcança o schema public. Tipo desconhecido da Meta vira "system" em vez de derrubar a mensagem. p_peer_user_id é o BSUID (from_user_id); p_peer_phone pode vir nulo quando a pessoa usa nome de usuário.';
revoke all on function public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text)
  to service_role;


-- =====================================================================
-- C. O RECIBO — pelo wamid, como sempre; o BSUID só ensina a conversa
-- =====================================================================
-- Sem esta peça, o fio que só teve mensagens NOSSAS (primeiro contato por
-- modelo, pessoa nunca respondeu) nunca aprenderia o BSUID — e é exatamente
-- esse fio que a primeira resposta sem telefone precisa achar. A Meta não
-- manda `user_id` na resposta do envio quando mandamos para o telefone; o
-- recibo (`recipient_user_id`) é o primeiro lugar em que ele aparece.
drop function if exists public.wa_status_registrar(text, text, timestamptz, text, text);

create or replace function public.wa_status_registrar(p_wamid       text,
                                                      p_status      text,
                                                      p_ocorrido_em timestamptz default now(),
                                                      p_codigo      text default null,
                                                      p_detalhe     text default null,
                                                      p_user_id     text default null)
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
  v_bsuid  text := nullif(trim(coalesce(p_user_id, '')), '');
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

  -- Antes da regra de "só anda para frente": um `delivered` atrasado não
  -- muda o estado, mas o BSUID que ele traz continua valendo.
  if v_bsuid is not null then
    update public.conversations c
       set peer_user_id = v_bsuid
     where c.id = m.conversation_id and c.peer_user_id is distinct from v_bsuid;
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
comment on function public.wa_status_registrar(text, text, timestamptz, text, text, text) is
  'Recibo de entrega da Meta (sent/delivered/read/failed) aplicado à mensagem pelo wamid. O estado só ANDA: a Meta não garante ordem entre os webhooks, e um delivered atrasado não pode apagar um read que já chegou. failed vence tudo. Desde 20260915120000, p_user_id (recipient_user_id) ensina o BSUID à conversa da mensagem.';
revoke all on function public.wa_status_registrar(text, text, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.wa_status_registrar(text, text, timestamptz, text, text, text)
  to service_role;

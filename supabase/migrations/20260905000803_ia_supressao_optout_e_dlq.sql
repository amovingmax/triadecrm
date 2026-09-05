-- =====================================================================
-- 20260905000803 — Os três que só mordem quando a IA e o WhatsApp ligarem
--
-- Nada aqui é feature. São três guardrails que hoje estão desligados por
-- acidente feliz — 0 modelos aprovados na Meta, worker `wa` nunca rodou,
-- ninguém enfileira `ai_jobs` sozinho — e que precisam estar fechados
-- ANTES de o canal subir, porque depois já custou dinheiro e já vazou dado.
--
--   A. (laudo §3.3) A IA chama, paga e manda dado de contato SUPRIMIDO.
--      O opt-out cancelava `tasks` e movia negócios, mas não tocava em
--      `ai_jobs`; e nenhuma das quatro tarefas do worker perguntava se o
--      alvo está suprimido. Duas peças: a pergunta (`app.ia_trabalho_
--      suprimido`, na forma de `public.proximo_da_fila` e de
--      `app.komune_proximos`) e a limpeza (`app.ia_cancelar_trabalhos`,
--      chamada de dentro do MESMO `app.consent_apply` que já cancela
--      tarefa).
--
--   B. (laudo §3.5) A confirmação de opt-out reenfileirada de 10 em 10
--      minutos, para sempre. `tentativas_falhas` já estava calculado na
--      view e ninguém o lia. Agora ele para em N e vira `acao_humana`.
--
--   C. (laudo §3.12n) `ai_dlq`, `wa_dlq`, `komune_dlq` e as outras
--      dead-letters sem ninguém que as drene. Passam a ser drenadas para
--      uma TABELA que gente lê, com uma tarefa por fila por dia.
--
-- Idempotente: `create or replace`, `create table if not exists`,
-- `on conflict do nothing`.
-- =====================================================================


-- =====================================================================
-- A. §3.3 — A IA NÃO TOCA EM CONTATO SUPRIMIDO
-- =====================================================================
-- O erro é o de sempre neste projeto — "checou na entrada, não reconferiu
-- na entrega" —, só que aqui ele custa duas coisas ao mesmo tempo: uma
-- chamada PAGA e o dado do contato saindo para a Anthropic. A prova que o
-- laudo registrou: três `draft_followup` terminando em dead-letter sem
-- produzir nada, com o contato já suprimido.
--
-- A resposta é a mesma que `public.proximo_da_fila` (módulo de ligação) e
-- `app.komune_proximos` (pré-cadastro) já dão: perguntar de novo, na hora
-- da entrega, e devolver a mensagem com um motivo NOMEADO — nunca
-- "fila vazia", nunca silêncio.

-- ---------------------------------------------------------------------
-- A.1 Um uuid que talvez não seja uuid
-- ---------------------------------------------------------------------
-- O payload da fila é `jsonb` e vem de fora (de SQL, do worker, de um
-- webhook). `(p ->> 'message_id')::uuid` numa string torta derruba a
-- transação inteira do `consent_apply` — ou seja, um payload malformado
-- na fila impediria alguém de ser suprimido. Isso não pode acontecer.
create or replace function app.uuid_seguro(p_valor text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_valor::uuid;
exception when others then
  return null;
end $$;
comment on function app.uuid_seguro(text) is
  'O uuid de um texto, ou null quando ele não é um uuid. Existe para que payload torto de fila não derrube a transação de quem só queria saber de quem é o trabalho.';
revoke all on function app.uuid_seguro(text) from public, anon;
grant execute on function app.uuid_seguro(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- A.2 De quem é este trabalho da fila da IA
-- ---------------------------------------------------------------------
-- Os quatro propósitos do worker apontam para o alvo por caminhos
-- diferentes (`message_id` nos dois de conversa, `attempt_id` nos dois de
-- ligação), e os seis restantes de `app.ia_enfileirar` trazem o alvo
-- direto. Um lugar só resolve todos — se amanhã nascer um propósito novo
-- que não caia em nenhum destes, ele devolve alvo nulo, e alvo nulo NÃO
-- é tratado como "pode": ver `app.ia_trabalho_suprimido`.
create or replace function app.ia_alvo_do_trabalho(p_payload jsonb)
returns table (organization_id uuid, contact_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org  uuid := app.uuid_seguro(p_payload ->> 'organization_id');
  v_ctt  uuid := app.uuid_seguro(p_payload ->> 'contact_id');
  v_id   uuid;
begin
  v_id := app.uuid_seguro(p_payload ->> 'message_id');
  if v_id is not null then
    select coalesce(v_org, m.organization_id, c.organization_id),
           coalesce(v_ctt, m.contact_id,      c.contact_id)
      into v_org, v_ctt
      from public.messages m
      left join public.conversations c on c.id = m.conversation_id
     where m.id = v_id;
  end if;

  v_id := app.uuid_seguro(p_payload ->> 'conversation_id');
  if v_id is not null then
    select coalesce(v_org, c.organization_id), coalesce(v_ctt, c.contact_id)
      into v_org, v_ctt
      from public.conversations c where c.id = v_id;
  end if;

  v_id := app.uuid_seguro(p_payload ->> 'attempt_id');
  if v_id is not null then
    select coalesce(v_org, a.organization_id), coalesce(v_ctt, a.contact_id)
      into v_org, v_ctt
      from public.call_attempts a where a.id = v_id;
  end if;

  v_id := app.uuid_seguro(p_payload ->> 'deal_id');
  if v_id is not null then
    select coalesce(v_org, d.organization_id), coalesce(v_ctt, d.primary_contact_id)
      into v_org, v_ctt
      from public.deals d where d.id = v_id;
  end if;

  v_id := app.uuid_seguro(p_payload ->> 'pre_registration_id');
  if v_id is not null then
    select coalesce(v_org, p.organization_id), coalesce(v_ctt, p.contact_id)
      into v_org, v_ctt
      from public.pre_registrations p where p.id = v_id;
  end if;

  organization_id := v_org;
  contact_id      := v_ctt;
  return next;
end $$;
comment on function app.ia_alvo_do_trabalho(jsonb) is
  'De quem é um trabalho da fila ai_jobs: resolve a organização e a pessoa a partir de message_id, conversation_id, attempt_id, deal_id, pre_registration_id ou do par explícito no payload. Devolve nulo quando o payload não aponta para ninguém — e nulo não é "pode".';
revoke all on function app.ia_alvo_do_trabalho(jsonb) from public, anon;
grant execute on function app.ia_alvo_do_trabalho(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- A.3 A pergunta, na forma das outras duas filas do produto
-- ---------------------------------------------------------------------
create or replace function app.ia_trabalho_suprimido(p_purpose text, p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select * into v from app.ia_alvo_do_trabalho(coalesce(p_payload, '{}'::jsonb));

  -- Alvo desconhecido NÃO é alvo liberado, mas também não é motivo para
  -- travar: o trabalho segue e o motivo fica escrito, porque o guardrail
  -- de entrega (o próprio worker, antes do POST) tem o vínculo em mãos.
  if v.organization_id is null and v.contact_id is null then
    return jsonb_build_object('suprimido', false, 'motivo', 'alvo_desconhecido',
                              'organization_id', null, 'contact_id', null,
                              'purpose', p_purpose);
  end if;

  if app.is_suppressed_target(v.organization_id, v.contact_id) then
    return jsonb_build_object('suprimido', true, 'motivo', 'contato_suprimido',
                              'organization_id', v.organization_id,
                              'contact_id', v.contact_id, 'purpose', p_purpose);
  end if;

  return jsonb_build_object('suprimido', false, 'motivo', null,
                            'organization_id', v.organization_id,
                            'contact_id', v.contact_id, 'purpose', p_purpose);
end $$;
comment on function app.ia_trabalho_suprimido(text, jsonb) is
  'O alvo deste trabalho da IA está suprimido? Mesma pergunta que public.proximo_da_fila faz ao entregar um item de ligação e que app.komune_proximos faz ao entregar um pré-cadastro (RF-CON-18). Motivo nomeado: contato_suprimido, alvo_desconhecido ou nulo.';
revoke all on function app.ia_trabalho_suprimido(text, jsonb) from public, anon;
grant execute on function app.ia_trabalho_suprimido(text, jsonb) to authenticated, service_role;

-- As duas bocas em `public`, porque o worker fala por HTTPS e o schema
-- `app` não é exposto ao PostgREST (mesma razão da 20260904001802).
create or replace function public.ia_alvo_suprimido(p_purpose text, p_payload jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app.ia_trabalho_suprimido(p_purpose, p_payload)
$$;
comment on function public.ia_alvo_suprimido(text, jsonb) is
  'Invólucro de app.ia_trabalho_suprimido para o worker-ai, que pergunta antes de montar qualquer chamada paga. Só service_role executa.';

create or replace function public.alvo_suprimido(p_organization_id uuid,
                                                 p_contact_id uuid default null)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app.is_suppressed_target(p_organization_id, p_contact_id)
$$;
comment on function public.alvo_suprimido(uuid, uuid) is
  'Invólucro de app.is_suppressed_target para quem fala com o banco por HTTPS. É a reconferência da ENTREGA: o worker-ai a chama depois de montar a entrada e ANTES do POST ao modelo, porque entre a leitura da fila e a chamada o mundo muda.';

revoke all on function public.ia_alvo_suprimido(text, jsonb) from public, anon, authenticated;
grant execute on function public.ia_alvo_suprimido(text, jsonb) to service_role;
revoke all on function public.alvo_suprimido(uuid, uuid) from public, anon;
grant execute on function public.alvo_suprimido(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- A.4 O opt-out limpa a fila da IA, no mesmo lugar em que cancela tarefa
-- ---------------------------------------------------------------------
-- Cancelar (e não deixar girar): a mensagem sai da fila e a chave de
-- idempotência é fechada com o motivo escrito, para ninguém reenfileirar
-- o mesmo trabalho depois. O arquivo do pgmq guarda o corpo; o histórico
-- não se perde, como não se perde no cancelamento de `tasks`.
create or replace function app.ia_cancelar_trabalhos(p_organization_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v record;
  n int := 0;
begin
  if p_organization_id is null then return 0; end if;
  if not exists (select 1 from pgmq.list_queues() lq where lq.queue_name = 'ai_jobs') then
    return 0;
  end if;

  for r in select q.msg_id, q.message from pgmq.q_ai_jobs q loop
    select * into v from app.ia_alvo_do_trabalho(coalesce(r.message, '{}'::jsonb));
    if v.organization_id is distinct from p_organization_id then
      continue;
    end if;
    perform pgmq.archive('ai_jobs', r.msg_id);
    update public.ingest_dedup
       set processed_at = now(),
           last_error   = 'cancelado: opt-out da organização (RF-CON-18)'
     where queue = 'ai_jobs' and msg_id = r.msg_id;
    n := n + 1;
  end loop;
  return n;
end $$;
comment on function app.ia_cancelar_trabalhos(uuid) is
  'Tira da fila ai_jobs todo trabalho cujo alvo é esta organização, e fecha a chave de idempotência com o motivo. Chamada por app.consent_apply no mesmo laço em que as tarefas abertas são canceladas: quem pediu para sair não vira chamada paga nem dado enviado à Anthropic.';
revoke all on function app.ia_cancelar_trabalhos(uuid) from public, anon, authenticated;
grant execute on function app.ia_cancelar_trabalhos(uuid) to service_role;

-- ---------------------------------------------------------------------
-- A.5 `app.consent_apply`: a mesma da 20260904001200, com UMA linha nova
-- ---------------------------------------------------------------------
-- A linha nova é `perform app.ia_cancelar_trabalhos(o.id)`, dentro do
-- laço das organizações, logo depois do cancelamento das tarefas. Nada
-- mais mudou — e o comentário da função passa a dizer as duas coisas.
create or replace function app.consent_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suppress boolean := new.kind in ('contact_optout','erasure_request','erasure_done');
  v_erasure  boolean := new.kind in ('erasure_request','erasure_done');
  v_reason   text := new.kind::text;
  c record;
  o record;
begin
  if v_suppress then
    -- pessoa
    if new.contact_id is not null then
      select * into c from public.contacts where id = new.contact_id;
      if found then
        update public.contacts set do_not_contact = true where id = c.id and not do_not_contact;
        perform app.suppress('phone', c.phone_e164, v_reason, new.channel, new.id);
        perform app.suppress('instagram', c.instagram_handle, v_reason, new.channel, new.id);
      end if;
    end if;

    -- organizações: a do evento + as da pessoa
    for o in
      select org.* from public.organizations org
       where org.id = new.organization_id
          or (new.contact_id is not null and org.id in
                (select oc.organization_id from public.organization_contacts oc where oc.contact_id = new.contact_id))
    loop
      update public.organizations set do_not_contact = true where id = o.id and not do_not_contact;
      perform app.suppress('phone', o.phone_e164, v_reason, new.channel, new.id);
      perform app.suppress('instagram', o.instagram_handle, v_reason, new.channel, new.id);
      if v_erasure then
        perform app.suppress('cnpj', o.cnpj, v_reason, new.channel, new.id);
      end if;

      -- Negócios ainda em andamento vão para a etapa de opt-out do próprio funil.
      update public.deals d
         set stage_id = st.id,
             stage_change_reason = 'Opt-out registrado (' || v_reason || ')'
        from public.stages st
       where d.organization_id = o.id
         and d.status in ('open','paused','nurturing')
         and st.pipeline_id = d.pipeline_id
         and st.is_optout
         and d.stage_id <> st.id;

      -- E o que já estava agendado sai da fila de quem quer que seja.
      update public.tasks t
         set status = 'cancelled'::app.task_status
       where t.organization_id = o.id
         and t.status in ('todo'::app.task_status, 'doing'::app.task_status);

      -- …inclusive o que estava agendado para a IA (laudo §3.3). Antes de
      -- 20260905000803 esta linha não existia, e uma chamada paga saía com
      -- o dado de quem tinha acabado de pedir para sair.
      perform app.ia_cancelar_trabalhos(o.id);
    end loop;

  elsif new.kind = 'contact_optin' then
    if new.contact_id is not null then
      update public.contacts ct set do_not_contact = false
       where ct.id = new.contact_id and ct.do_not_contact
         and not app.is_suppressed(ct.phone_e164, null, ct.instagram_handle);
    end if;
    if new.organization_id is not null then
      update public.organizations org set do_not_contact = false
       where org.id = new.organization_id and org.do_not_contact
         and not app.is_suppressed(org.phone_e164, org.cnpj, org.instagram_handle);
    end if;
  end if;

  return new;
end $$;
comment on function app.consent_apply() is
  'Aplica o evento de consentimento (RF-CON-18, RF-ADM-04): do_not_contact, hashes na suppression_list, negócios abertos para a etapa de opt-out do funil, cancelamento das tarefas abertas da organização e — desde 20260905000803 — cancelamento dos trabalhos dela na fila ai_jobs.';


-- =====================================================================
-- B. §3.5 — A CONFIRMAÇÃO DE OPT-OUT PARA DE SER REENFILEIRADA PARA SEMPRE
-- =====================================================================
-- MEDIDO NO BANCO LOCAL EM 05/09/2026, com o script em anexo ao PR:
-- conversa dentro da janela de 24 h, opt-out registrado, Graph API
-- falhando toda vez. Dez voltas de `app.wa_confirmacoes_reenfileirar` →
-- **10 confirmações enfileiradas** para a mesma pessoa e
-- `tentativas_falhas = 10` na view, calculado e ignorado. Sem teto e sem
-- espera crescente: no dia em que o número conectar, a fila descarrega
-- tudo que se acumulou.
--
-- CORREÇÃO AO LAUDO, com prova. O laudo escreve que o caso real de hoje é
-- "nenhum modelo aprovado na Meta". Não é: com o modelo não aprovado E a
-- janela de 24 h fechada, `app.wa_confirmacao_de_optout` devolve
-- `devida = false` e o laço não insere NADA — medido, 0 confirmações em
-- 10 voltas. O que dispara o acúmulo é a janela ABERTA (ou o modelo
-- aprovado) somada a um envio que falha: aí `devida` é true toda vez, o
-- índice parcial não segura (ele só conta confirmação viva) e nasce uma
-- linha nova a cada dez minutos. O defeito é o mesmo; o gatilho é outro,
-- e importa porque é o gatilho do DIA em que o canal ligar.
--
-- O conserto é o que o laudo pede, e nada além: ler o `tentativas_falhas`
-- que a própria view já calcula, parar em N e mandar o caso para
-- `acao_humana` em `wa_saude()`. Mais uma espera crescente entre as
-- tentativas, porque dez minutos fixos são dez minutos para sempre.

-- ---------------------------------------------------------------------
-- B.1 O teto e a espera, em um lugar só
-- ---------------------------------------------------------------------
-- Constantes em função (e não em tabela de configuração) pelo mesmo
-- motivo de `AUDIO_SEMPRE_HUMANO` no worker: afrouxar isto é decisão de
-- produto, não de operação, e tem de aparecer num diff revisado.
create or replace function app.wa_confirmacao_teto()
returns int language sql immutable set search_path = '' as $$ select 5 $$;
comment on function app.wa_confirmacao_teto() is
  'Quantas vezes o sistema tenta mandar a MESMA confirmação de opt-out antes de parar e chamar gente. Cinco: acima disso não é falha passageira, é canal quebrado — e o RF-CON-19 não é resolvido enfileirando a décima primeira.';

create or replace function app.wa_confirmacao_proxima_em(p_tentativas int,
                                                         p_ultima_falha timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  -- A PRIMEIRA falha não espera. É o caso que a migração 20260905000400 foi
  -- escrita para resolver — a confirmação que falhou e nunca era tentada de
  -- novo — e uma falha isolada costuma ser um soluço da Graph API, não um
  -- canal quebrado. A escalada começa da SEGUNDA em diante, que é quando ela
  -- deixa de ser soluço: 10 min, 20, 40, 80… com teto de 6 h.
  select case
           when coalesce(p_tentativas, 0) <= 1 or p_ultima_falha is null then null
           else p_ultima_falha
                + make_interval(mins => least(10 * (2 ^ least(p_tentativas - 2, 6))::int, 360))
         end
$$;
comment on function app.wa_confirmacao_proxima_em(int, timestamptz) is
  'Quando a próxima tentativa de confirmação de opt-out pode sair. A primeira falha não espera (é o conserto da 20260905000400, e uma falha isolada costuma ser soluço da Graph API); da segunda em diante a espera cresce — 10 min dobrando, teto de 6 h. Dez minutos fixos são dez minutos para sempre.';

revoke all on function app.wa_confirmacao_teto() from public, anon;
revoke all on function app.wa_confirmacao_proxima_em(int, timestamptz) from public, anon;
grant execute on function app.wa_confirmacao_teto() to authenticated, service_role;
grant execute on function app.wa_confirmacao_proxima_em(int, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- B.2 O laço passa a ler o que já estava calculado
-- ---------------------------------------------------------------------
create or replace function app.wa_confirmacoes_reenfileirar(p_qty int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_conf     jsonb;
  v_msg      uuid;
  v_feitas   int := 0;
  v_devendo  int := 0;
  v_esperando int := 0;
  v_esgotadas int := 0;
  v_teto     int := app.wa_confirmacao_teto();
  v_falhas   int;
  v_ultima   timestamptz;
begin
  for r in
    select c.id
      from public.conversations c
     where not exists (select 1 from public.messages m
                        where m.conversation_id = c.id
                          and m.optout_confirmation
                          and m.status <> 'failed'::app.msg_status)
       and (exists (select 1 from public.consent_events e
                     where e.kind = 'contact_optout'::app.consent_kind
                       and ((c.organization_id is not null and e.organization_id = c.organization_id)
                         or (c.contact_id is not null      and e.contact_id      = c.contact_id)))
            or app.is_suppressed(c.peer_phone_e164, null, null)
            or (c.organization_id is not null
                and app.is_suppressed_target(c.organization_id, c.contact_id)))
     order by c.last_inbound_at nulls last
     limit greatest(coalesce(p_qty, 50), 1)
  loop
    v_conf := app.wa_confirmacao_de_optout(r.id);
    if not coalesce((v_conf ->> 'devendo')::boolean, false) then
      continue;
    end if;
    v_devendo := v_devendo + 1;
    if not coalesce((v_conf ->> 'devida')::boolean, false) then
      continue;   -- ainda não dá; a dívida continua na view
    end if;

    -- O TETO (laudo §3.5). A conta é a mesma da view: confirmação desta
    -- conversa que morreu como `failed`.
    select count(*)::int, max(m.failed_at) into v_falhas, v_ultima
      from public.messages m
     where m.conversation_id = r.id
       and m.optout_confirmation
       and m.status = 'failed'::app.msg_status;

    if coalesce(v_falhas, 0) >= v_teto then
      v_esgotadas := v_esgotadas + 1;
      continue;   -- vira acao_humana em public.wa_saude()
    end if;
    if app.wa_confirmacao_proxima_em(v_falhas, v_ultima) > now() then
      v_esperando := v_esperando + 1;
      continue;   -- espera crescente
    end if;

    begin
      insert into public.messages (conversation_id, direction, type, status, body,
                                   author_kind, origin, template_id)
      values (r.id, 'out'::app.msg_direction, 'text'::app.msg_type,
              'queued'::app.msg_status, v_conf ->> 'corpo',
              'system', 'crm', (v_conf ->> 'template_id')::int)
      returning id into v_msg;
      perform app.wa_enfileirar_envio(v_msg);
      v_feitas := v_feitas + 1;
    exception when unique_violation or insufficient_privilege then
      -- Outra transação chegou antes, ou o estado mudou entre a pergunta e
      -- o insert (o gatilho refaz a mesma pergunta e recusa com 42501). A
      -- dívida continua na view; a próxima passada tenta.
      null;
    end;
  end loop;

  return jsonb_build_object('devendo', v_devendo, 'reenfileiradas', v_feitas,
                            'esperando_backoff', v_esperando,
                            'esgotadas', v_esgotadas, 'teto', v_teto);
end $$;
comment on function app.wa_confirmacoes_reenfileirar(int) is
  'Paga a dívida do RF-CON-19 quando ela volta a ser pagável — com TETO e espera crescente desde 20260905000803 (laudo §3.5). Antes disso, uma confirmação que falhava era reenfileirada de 10 em 10 min para sempre: medido, 10 confirmações para a mesma pessoa em 10 voltas do cron. Agora para em app.wa_confirmacao_teto() tentativas e o caso vira acao_humana em public.wa_saude().';
revoke all on function app.wa_confirmacoes_reenfileirar(int) from public, anon, authenticated;
grant execute on function app.wa_confirmacoes_reenfileirar(int) to service_role;

-- ---------------------------------------------------------------------
-- B.3 A view diz o que o laço passou a decidir
-- ---------------------------------------------------------------------
-- Duas colunas novas sobre o `tentativas_falhas` que já existia. Nada
-- mais mudou: o corpo é o da 20260905000400, letra por letra.
drop view if exists public.wa_confirmacoes_devidas;
create view public.wa_confirmacoes_devidas
with (security_barrier = true, security_invoker = false) as
with devedoras as (
  select c.id, c.organization_id, c.contact_id, c.assignee_id, c.last_inbound_at
    from public.conversations c
   where not exists (select 1 from public.messages m
                      where m.conversation_id = c.id
                        and m.optout_confirmation
                        and m.status <> 'failed'::app.msg_status)
     and (exists (select 1 from public.consent_events e
                   where e.kind = 'contact_optout'::app.consent_kind
                     and ((c.organization_id is not null and e.organization_id = c.organization_id)
                       or (c.contact_id is not null      and e.contact_id      = c.contact_id)))
          or app.is_suppressed(c.peer_phone_e164, null, null)
          or (c.organization_id is not null
              and app.is_suppressed_target(c.organization_id, c.contact_id)))
)
select d.id                                    as conversation_id,
       d.organization_id,
       d.contact_id,
       d.assignee_id,
       j.j ->> 'motivo'                        as motivo,
       coalesce((j.j ->> 'devida')::boolean, false) as pode_sair_agora,
       coalesce(f.tentativas, 0)               as tentativas_falhas,
       f.ultima_falha_em,
       f.ultimo_erro,
       coalesce(f.tentativas, 0) >= app.wa_confirmacao_teto() as esgotou_tentativas,
       app.wa_confirmacao_proxima_em(coalesce(f.tentativas, 0), f.ultima_falha_em)
                                               as proxima_tentativa_em,
       coalesce(p.pediu_em, d.last_inbound_at) as pediu_em
  from devedoras d
  cross join lateral (select app.wa_confirmacao_de_optout(d.id) as j) j
  left join lateral (
    select count(*)::int as tentativas, max(m.failed_at) as ultima_falha_em,
           (array_agg(m.error_code order by m.failed_at desc nulls last))[1] as ultimo_erro
      from public.messages m
     where m.conversation_id = d.id and m.optout_confirmation
       and m.status = 'failed'::app.msg_status) f on true
  left join lateral (
    select min(e.created_at) as pediu_em
      from public.consent_events e
     where e.kind = 'contact_optout'::app.consent_kind
       and ((d.organization_id is not null and e.organization_id = d.organization_id)
         or (d.contact_id is not null      and e.contact_id      = d.contact_id))) p on true
 where coalesce((j.j ->> 'devendo')::boolean, false)
   and ((select app.sees_all())
        or d.assignee_id = (select auth.uid())
        or ((select app.role()) = 'embaixador'::app.user_role
            and d.organization_id is not null
            and (select app.org_is_mine(d.organization_id))));
comment on view public.wa_confirmacoes_devidas is
  'A quem o sistema ainda deve a confirmação de opt-out do RF-CON-19: pedido registrado, nenhuma confirmação viva. "motivo" diz por que ela não saiu, "pode_sair_agora" diz se app.wa_confirmacoes_reenfileirar vai resolvê-la na próxima passada, e desde 20260905000803 "esgotou_tentativas" e "proxima_tentativa_em" dizem se ela ainda vai ser tentada sozinha ou se está esperando gente. Sem telefone e sem texto.';
revoke all on public.wa_confirmacoes_devidas from public, anon;
grant select on public.wa_confirmacoes_devidas to authenticated, service_role;


-- =====================================================================
-- C. §3.12n — AS DEAD-LETTERS PASSAM A TER DRENO
-- =====================================================================
-- A pergunta do laudo é justa: "decida o que drena e implemente, ou
-- explique por que uma dead-letter sem dreno é aceitável e o que a
-- substitui". A resposta é que ela NÃO é aceitável, e por um motivo que
-- não é de arrumação: uma fila `pgmq` é invisível para quem usa o
-- produto. `ingest_dlq`, `wa_dlq`, `ai_dlq`, `rotas_dlq` e `komune_dlq`
-- guardam exatamente o que alguém precisa ver — a mensagem que morreu —
-- num lugar onde ninguém olha, e que a retenção de 30 dias do arquivo do
-- pgmq acaba apagando.
--
-- Dreno NÃO é reprocessar. Reprocessar sozinho o que já falhou N vezes é
-- o laço que a esteira evitou de propósito ("um item que fica girando
-- para sempre é pior que um item que para"). O dreno é MUDAR DE LUGAR:
-- a mensagem morta sai da fila e vai para uma TABELA que gente lê, com
-- RLS, e uma tarefa por fila por dia chama essa gente. A fila volta a
-- zero; o conteúdo não se perde.
create table if not exists public.dead_letters (
  id              bigserial primary key,
  fila            text not null,
  fila_de_origem  text,
  msg_id          bigint,
  idempotency_key text,
  erro            text,
  tentativas      int,
  payload         jsonb not null default '{}'::jsonb,
  morreu_em       timestamptz not null default now(),
  drenada_em      timestamptz not null default now(),
  lida_em         timestamptz,
  lida_por        uuid references public.profiles (id) on delete set null,
  task_id         uuid references public.tasks (id) on delete set null
);
comment on table public.dead_letters is
  'O que morreu nas filas, num lugar que gente lê (laudo §3.12n). Drenada de ingest_dlq, wa_dlq, ai_dlq, rotas_dlq e komune_dlq por app.dlq_drenar. Não é fila: nada aqui é reprocessado sozinho — o que falhou além do teto precisa de decisão humana.';
create index if not exists dead_letters_abertas_idx
  on public.dead_letters (fila, morreu_em desc) where lida_em is null;

alter table public.dead_letters enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'dead_letters'
                    and policyname = 'dead_letters_select') then
    create policy dead_letters_select on public.dead_letters for select to authenticated
      using (app.is_manager());
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'dead_letters'
                    and policyname = 'dead_letters_update') then
    -- Só "eu li isto": a linha não é editável, é reconhecível.
    create policy dead_letters_update on public.dead_letters for update to authenticated
      using (app.is_manager()) with check (app.is_manager());
  end if;
end $$;
revoke all on public.dead_letters from public, anon;
grant select, update on public.dead_letters to authenticated;
grant all on public.dead_letters to service_role;
grant usage, select on sequence public.dead_letters_id_seq to service_role;

-- ---------------------------------------------------------------------
-- C.1 O dreno
-- ---------------------------------------------------------------------
create or replace function app.dlq_drenar(p_qty int default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila     text;
  -- Tipado, e não `record`: a leitura é por `pgmq.read`, que é função normal.
  -- Varrer `pgmq.q_<fila>` com `format()` seria SQL dinâmico, e SQL dinâmico
  -- com `record` é justamente o que o `supabase db lint` recusa ("record não
  -- atribuído") — com razão: o linter não tem como conferir o que ele devolve.
  r          pgmq.message_record;
  v_conta    jsonb := '{}'::jsonb;
  v_n        int;
  v_total    int := 0;
  v_admin    uuid;
  v_hoje     date := (now() at time zone 'America/Fortaleza')::date;
  v_task     uuid;
  v_corpo    jsonb;
begin
  select p.id into v_admin from public.profiles p
   where p.is_active and p.role = 'admin'::app.user_role
   order by p.created_at limit 1;

  for v_fila in
    select lq.queue_name from pgmq.list_queues() lq
     where lq.queue_name like '%\_dlq'
     order by lq.queue_name
  loop
    v_n := 0;
    -- `pgmq.read` põe um visibility timeout curto e devolve as visíveis; o
    -- `archive` logo abaixo as tira de vez. Se o dreno morrer no meio, o que
    -- sobrou volta a ficar visível em 30 s e a próxima passada o pega.
    for r in select * from pgmq.read(v_fila, 30, greatest(coalesce(p_qty, 100), 1))
    loop
      v_corpo := coalesce(r.message, '{}'::jsonb);
      insert into public.dead_letters
        (fila, fila_de_origem, msg_id, idempotency_key, erro, tentativas, payload, morreu_em)
      values (v_fila,
              v_corpo ->> 'fila_de_origem',
              case when (v_corpo ->> 'msg_id') ~ '^[0-9]+$'
                   then (v_corpo ->> 'msg_id')::bigint end,
              v_corpo ->> 'idempotency_key',
              left(coalesce(v_corpo ->> 'erro', v_corpo ->> 'error', ''), 2000),
              nullif(v_corpo ->> 'tentativas', '')::int,
              v_corpo,
              coalesce((v_corpo ->> 'em')::timestamptz, r.enqueued_at));
      perform pgmq.archive(v_fila, r.msg_id);
      v_n := v_n + 1;
    end loop;

    if v_n > 0 then
      v_conta := v_conta || jsonb_build_object(v_fila, v_n);
      v_total := v_total + v_n;

      -- Uma tarefa por fila por dia. Uma por MENSAGEM afogaria o "Meu dia"
      -- justamente no dia em que a fila explodiu, que é quando ele precisa
      -- estar legível.
      if v_admin is not null
         and not exists (select 1 from public.tasks t
                          where t.origin = 'system'
                            and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
                            and t.title like 'Dead-letter ' || v_fila || ' (' || v_hoje::text || ')%')
      then
        insert into public.tasks (title, kind, due_at, assignee_id, origin, priority)
        values ('Dead-letter ' || v_fila || ' (' || v_hoje::text || '): '
                || v_n || ' mensagem(ns) morreram e estão em public.dead_letters.',
                'other'::app.task_kind, now(), v_admin, 'system', 1)
        returning id into v_task;
        update public.dead_letters set task_id = v_task
         where fila = v_fila and task_id is null and lida_em is null;
      end if;
    end if;
  end loop;

  -- A linha já lida vira histórico e sai depois de 180 dias. O que ninguém
  -- leu NUNCA é apagado por aqui: apagar o que ninguém viu é o defeito de
  -- novo, com outra roupa.
  delete from public.dead_letters
   where lida_em is not null and lida_em < now() - interval '180 days';

  return jsonb_build_object('drenadas', v_total, 'por_fila', v_conta);
end $$;
comment on function app.dlq_drenar(int) is
  'Drena as dead-letters (ingest_dlq, wa_dlq, ai_dlq, rotas_dlq, komune_dlq) para public.dead_letters e abre uma tarefa por fila por dia. Dreno é mudar de lugar, nunca reprocessar: o que falhou além do teto precisa de decisão humana, e reenfileirar sozinho é o laço que a esteira evitou de propósito.';
revoke all on function app.dlq_drenar(int) from public, anon, authenticated;
grant execute on function app.dlq_drenar(int) to service_role;

create or replace function public.dlq_drenar(p_qty int default 100)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app.dlq_drenar(p_qty)
$$;
comment on function public.dlq_drenar(int) is
  'Invólucro de app.dlq_drenar para o worker e para o cron. Só service_role executa.';
revoke all on function public.dlq_drenar(int) from public, anon, authenticated;
grant execute on function public.dlq_drenar(int) to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- de 15 em 15 minutos: a dead-letter não é urgente, mas não pode ficar
    -- invisível até alguém lembrar dela.
    perform cron.schedule('dlq_drenar', '*/15 * * * *',
                          $cron$select app.dlq_drenar(100)$cron$);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- C.2 / B.4 — O painel diz as duas coisas novas
-- ---------------------------------------------------------------------
-- `public.wa_saude()` é a mesma da 20260905000400 com dois acréscimos, e
-- os dois são `acao_humana`: (1) as confirmações que esgotaram o teto do
-- §3.5, que agora PARAM e por isso precisam de alguém; (2) as mensagens
-- do WhatsApp que morreram e foram drenadas para `public.dead_letters`.
-- Um teto sem painel seria só uma forma mais silenciosa de não responder.
create or replace function public.wa_saude()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modelo    jsonb;
  v_tpl       int;
  v_devendo   int;
  v_bloqueada int;
  v_antiga    timestamptz;
  v_motivos   jsonb;
  v_acoes     jsonb := '[]'::jsonb;
  v_fila      record;
  v_workers   jsonb;
  v_esgotadas int;
  v_dlq       int;
begin
  -- `current_setting('role')` e não `current_user`: dentro de uma função
  -- `security definer` o `current_user` é o DONO (postgres), então o worker,
  -- que chega com `set role service_role`, seria recusado no próprio painel
  -- que existe para ele gritar.
  if not app.can_write()
     and coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'Papel % não lê a saúde do WhatsApp', app.role() using errcode = '42501';
  end if;

  select id into v_tpl from public.message_templates
   where template_code = 'GEN-SYS-OPTOUT' and is_active limit 1;
  v_modelo := app.wa_modelo_da_meta(v_tpl);

  -- A dívida do RF-CON-19, contada sobre o ESTADO e não sobre a view (o
  -- painel é do sistema inteiro; a view é do que cada um enxerga).
  with devedoras as (
    select c.id, c.organization_id, c.contact_id, c.last_inbound_at
      from public.conversations c
     where not exists (select 1 from public.messages m
                        where m.conversation_id = c.id and m.optout_confirmation
                          and m.status <> 'failed'::app.msg_status)
       and (exists (select 1 from public.consent_events e
                     where e.kind = 'contact_optout'::app.consent_kind
                       and ((c.organization_id is not null and e.organization_id = c.organization_id)
                         or (c.contact_id is not null      and e.contact_id      = c.contact_id)))
            or app.is_suppressed(c.peer_phone_e164, null, null)
            or (c.organization_id is not null
                and app.is_suppressed_target(c.organization_id, c.contact_id)))
  ), julgadas as (
    select coalesce(j.j ->> 'motivo', 'devida')  as motivo,
           coalesce(p.pediu_em, d.last_inbound_at) as pediu_em
      from devedoras d
      cross join lateral (select app.wa_confirmacao_de_optout(d.id) as j) j
      left join lateral (
        select min(e.created_at) as pediu_em
          from public.consent_events e
         where e.kind = 'contact_optout'::app.consent_kind
           and ((d.organization_id is not null and e.organization_id = d.organization_id)
             or (d.contact_id is not null      and e.contact_id      = d.contact_id))) p on true
     where coalesce((j.j ->> 'devendo')::boolean, false)
  )
  select count(*)::int,
         count(*) filter (where motivo = 'sem_modelo_aprovado_na_meta')::int,
         min(pediu_em),
         coalesce((select jsonb_object_agg(x.motivo, x.n)
                     from (select motivo, count(*)::int as n
                             from julgadas group by motivo) x), '{}'::jsonb)
    into v_devendo, v_bloqueada, v_antiga, v_motivos
    from julgadas;

  -- Quantas travaram no teto do laudo §3.5: o sistema DEVE a resposta e
  -- parou de tentar sozinho. É o caso que só sai daqui com gente.
  select count(*)::int into v_esgotadas
    from public.conversations c
   where not exists (select 1 from public.messages m
                      where m.conversation_id = c.id and m.optout_confirmation
                        and m.status <> 'failed'::app.msg_status)
     and (select count(*) from public.messages m
           where m.conversation_id = c.id and m.optout_confirmation
             and m.status = 'failed'::app.msg_status) >= app.wa_confirmacao_teto()
     and coalesce((app.wa_confirmacao_de_optout(c.id) ->> 'devendo')::boolean, false);

  select count(*)::int into v_dlq
    from public.dead_letters d where d.fila = 'wa_dlq' and d.lida_em is null;

  if not coalesce((v_modelo ->> 'aprovado')::boolean, false) then
    v_acoes := v_acoes || jsonb_build_array(jsonb_build_object(
      'o_que',  'Aprovar o modelo GEN-SYS-OPTOUT no Meta Business (categoria utility, pt_BR) e gravar meta_template_name e meta_status = approved em message_templates.',
      'quem',   'Luiz (Meta Business) · Matheus revisa',
      'porque', 'Fora da janela de 24 h a Meta só aceita template aprovado (R04 §2.1). Sem isso, quem pede para sair mais de 24 h depois da última mensagem NÃO recebe a confirmação do RF-CON-19 — o sistema fica devendo uma resposta a quem pediu silêncio.',
      'situacao_na_meta', v_modelo ->> 'situacao',
      'pessoas_esperando', coalesce(v_bloqueada, 0)));
  end if;
  if coalesce(v_devendo, 0) > 0 then
    v_acoes := v_acoes || jsonb_build_array(jsonb_build_object(
      'o_que',  'Conferir public.wa_confirmacoes_devidas: há gente que pediu para sair e ainda não recebeu a confirmação.',
      'quem',   'Heloísa · Bárbara',
      'porque', 'RF-CON-19 e o guardrail do CLAUDE.md: opt-out por regra confirma em uma linha. app.wa_confirmacoes_reenfileirar tenta sozinha de 10 em 10 min, mas só quando a confirmação voltar a ser possível.',
      'pessoas_esperando', v_devendo,
      'mais_antiga_em', v_antiga));
  end if;
  -- laudo §3.5: parou de tentar sozinho. Antes de 20260905000803 este caso
  -- não existia porque a confirmação era reenfileirada para sempre — o
  -- painel ficava calado e a fila crescia.
  if coalesce(v_esgotadas, 0) > 0 then
    v_acoes := v_acoes || jsonb_build_array(jsonb_build_object(
      'o_que',  'Destravar as confirmações de opt-out que esgotaram as tentativas: public.wa_confirmacoes_devidas where esgotou_tentativas. O sistema tentou ' || app.wa_confirmacao_teto() || ' vezes, todas falharam, e ele PAROU de tentar de propósito.',
      'quem',   'Luiz (número e Cloud API) · Heloísa confirma o desfecho',
      'porque', 'RF-CON-19: quem pediu para sair merece uma resposta, e enfileirar a décima primeira tentativa do mesmo envio quebrado não é resposta — é uma fila que descarrega tudo de uma vez no dia em que o canal voltar.',
      'pessoas_esperando', v_esgotadas));
  end if;
  -- laudo §3.12n: a dead-letter agora é lida por gente, e o painel diz quanta.
  if coalesce(v_dlq, 0) > 0 then
    v_acoes := v_acoes || jsonb_build_array(jsonb_build_object(
      'o_que',  'Ler public.dead_letters where fila = ''wa_dlq'' and lida_em is null: mensagens de WhatsApp que morreram além do teto de tentativas.',
      'quem',   'Matheus · Luiz',
      'porque', 'Dead-letter que ninguém drena é uma fila invisível: o arquivo do pgmq some em 30 dias e a mensagem morta some com ele. app.dlq_drenar move para uma tabela e abre uma tarefa; ler e marcar lida_em é humano de propósito.',
      'mensagens', v_dlq));
  end if;
  -- DECISÃO HUMANA PENDENTE de 20260905000400 (D1): o vocativo saiu.
  if exists (select 1 from public.message_templates
              where template_code = 'GEN-SYS-OPTOUT' and body like '%{{nome}}%') then
    v_acoes := v_acoes || jsonb_build_array(jsonb_build_object(
      'o_que',  'Decidir se o GEN-SYS-OPTOUT fica sem vocativo. O corpo semeado ainda traz {{nome}} (R08 §2.7 escreve "[Nome]"), mas a confirmação sai SEM ele desde 20260905000400: era a única fatia de texto livre, de origem não confiável, na única mensagem que sai sem aprovação humana.',
      'quem',   'Bárbara (modelos de mensagem) · Heloísa valida o tom',
      'porque', 'Medido contra 232 nomes reais de fornecedores de Natal, um vocativo seguro por construção preservaria 223 (96,1%). O que o derrubou não foi o nome: foi o parâmetro de template — fora da janela de 24 h a Meta recusa parâmetro vazio, então serviriam DOIS templates aprovados, e a frase que dispensa o ADR-05 ("um conteúdo possível") deixaria de ser verdade.',
      'como_voltar', 'vocativo seguro (primeiro token, só letras/apóstrofo/hífen, 2 a 20 caracteres) + um segundo template aprovado na Meta para o caso sem nome.'));
  end if;

  select * into v_fila from pgmq.metrics('wa_outbound');

  select coalesce(jsonb_agg(jsonb_build_object(
           'worker', h.worker, 'instancia', h.instance, 'status', h.status,
           'ultima_batida', h.last_beat_at,
           'vivo', (now() - h.last_beat_at) < interval '2 minutes')
           order by h.instance), '[]'::jsonb)
    into v_workers from public.worker_heartbeats h where h.worker = 'wa';

  return jsonb_build_object(
    'acao_humana', v_acoes,
    'confirmacoes_de_optout', jsonb_build_object(
      'devendo', coalesce(v_devendo, 0),
      'esgotaram_tentativas', coalesce(v_esgotadas, 0),
      'teto_de_tentativas', app.wa_confirmacao_teto(),
      'bloqueadas_por_modelo_nao_aprovado', coalesce(v_bloqueada, 0),
      'mais_antiga_em', v_antiga,
      'por_motivo', coalesce(v_motivos, '{}'::jsonb)),
    'modelo_gen_sys_optout', v_modelo,
    'modelos_aprovados_pela_meta', jsonb_build_object(
      'aprovados', (select count(*)::int from public.message_templates where meta_status = 'approved'),
      'total',     (select count(*)::int from public.message_templates)),
    'fila_de_saida', jsonb_build_object(
      'na_fila',   coalesce(v_fila.queue_length, 0),
      'visiveis',  coalesce(v_fila.queue_visible_length, 0),
      'mais_antigo_segundos', v_fila.oldest_msg_age_sec),
    'presas_na_fila', (select count(*)::int from public.messages
                        where status = 'queued'::app.msg_status
                          and direction = 'out'::app.msg_direction),
    'dead_letters_nao_lidas', coalesce(v_dlq, 0),
    'workers', v_workers);
end $$;
comment on function public.wa_saude() is
  'Painel do WhatsApp (o do Radar é public.esteira_saude). O primeiro campo é acao_humana: o que só uma pessoa pode destravar, com quem, por quê e quanta gente está esperando. Desde 20260905000803 ele também diz quantas confirmações de opt-out esgotaram o teto de tentativas (laudo §3.5) e quantas mensagens estão em public.dead_letters esperando leitura (laudo §3.12n).';
revoke all on function public.wa_saude() from public, anon;
grant execute on function public.wa_saude() to authenticated, service_role;

-- =====================================================================
-- O robô ganha teto de fala, detector de pingue-pongue e fusível
-- =====================================================================
-- POR QUE AGORA. O bot de entrada tem teto hoje: `app.wa_bot_de_entrada` fala
-- no máximo duas vezes e devolve `bot_ja_falou`. Esse teto morre na Fase 4,
-- quando o robô passar a responder por intenção. O que fica de pé depois dela
-- é este, e ele precisa existir ANTES — construir o freio depois do robô é
-- descobrir o laço em produção, com o cliente do outro lado.
--
-- OS QUATRO NÚMEROS, e por que cada um:
--   6 falas por conversa em 24 h — uma conversa real tem saudação, preço, link
--     do cadastro e mais duas idas. A sétima é sinal de que o robô não está
--     entendendo, e insistir é o que queima o número.
--   3 recebidas seguidas, cada uma menos de 20 s depois da nossa saída — gente
--     lê antes de responder. Três vezes em menos de 20 s é máquina.
--   3 últimas recebidas com o mesmo corpo — loop de outro robô ou
--     autoresponder; o nosso responderia para sempre.
--   120 mensagens de robô numa hora, somando todas as conversas — o fusível
--     pega o laço que não cabe numa conversa só.
--
-- Eles moram em `app_settings.whatsapp.robo_teto`: números de operação não
-- moram em código, e apertar um deles às 3h da manhã não pode exigir deploy.
--
-- CAMPANHA E CADÊNCIA NÃO ENTRAM NESTA CONTA. `app.envio_um` e
-- `public.wa_enviar_modelo` inserem `author_kind = 'human'`: elas são o dedo de
-- uma pessoa que clicou, e o teto delas é o do RF-CON-10, não este.
--
-- A ORDEM DE `app.wa_bot_freiar` IMPORTA: despedida → `bot_paused` → tarefa.
-- Invertida, o próprio guarda recusaria a despedida, e o fornecedor ficaria
-- falando sozinho com um robô que emudeceu sem dizer por quê.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Os quatro números
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('whatsapp.robo_teto',
   jsonb_build_object('falas_por_conversa', 6,
                      'janela_horas', 24,
                      'pingue_pongue_seguidas', 3,
                      'pingue_pongue_segundos', 20,
                      'repeticoes_iguais', 3,
                      'fusivel_por_hora', 120),
   'Teto de fala do robô no WhatsApp (RF-CON-20, Fase 3 do pivô). falas_por_conversa em janela_horas; pingue_pongue_* detecta máquina do outro lado; repeticoes_iguais pega autoresponder; fusivel_por_hora é o laço que não cabe numa conversa só. Campanha e cadência NÃO contam aqui: elas são author_kind = human.')
on conflict (key) do nothing;

create or replace function app.wa_robo_teto()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.value from public.app_settings s where s.key = 'whatsapp.robo_teto'),
                  jsonb_build_object('falas_por_conversa', 6, 'janela_horas', 24,
                                     'pingue_pongue_seguidas', 3, 'pingue_pongue_segundos', 20,
                                     'repeticoes_iguais', 3, 'fusivel_por_hora', 120))
$$;
revoke all on function app.wa_robo_teto() from public, anon;
grant execute on function app.wa_robo_teto() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. A despedida
-- ---------------------------------------------------------------------
-- No molde do `GEN-SYS-AUSENCIA` (20260922120000:114). `on conflict
-- (template_code) do nothing` porque a coluna é única desde 20260904000300.
insert into public.message_templates (template_code, name, channel, category, segment, kind,
                                      language, body, is_active, version)
values ('GEN-SYS-HUMANO', 'Vou chamar alguém (automática)', 'whatsapp', 'service', 'GEN', 'sistema',
        'pt_BR',
        'Vou chamar alguém do time para te responder.',
        true, 1)
on conflict (template_code) do nothing;

create or replace function app.wa_modelo_humano()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.message_templates t
   where t.template_code = 'GEN-SYS-HUMANO' and t.is_active
     and t.channel = 'whatsapp'::app.channel
$$;
revoke all on function app.wa_modelo_humano() from public, anon;
grant execute on function app.wa_modelo_humano() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Quantas vezes o robô falou
-- ---------------------------------------------------------------------
-- A DESPEDIDA NÃO CONTA. Se contasse, uma conversa no teto não poderia se
-- despedir — e o robô que emudece sem dizer por quê é pior que o robô que fala
-- uma vez a mais.
create or replace function app.wa_bot_falas(p_conversation_id uuid, p_desde timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'out'::app.msg_direction
     and m.author_kind in ('bot_fixed', 'bot_ai')
     and m.status <> 'failed'::app.msg_status
     and not m.optout_confirmation
     and m.template_id is distinct from app.wa_modelo_humano()
     and coalesce(m.sent_at, m.created_at) >= p_desde
$$;
comment on function app.wa_bot_falas(uuid, timestamptz) is
  'Quantas vezes o robô falou nesta conversa desde um instante. A despedida (GEN-SYS-HUMANO) e a confirmação de opt-out não contam: uma conversa no teto tem de poder se despedir e tem de poder confirmar a saída de quem pediu.';
revoke all on function app.wa_bot_falas(uuid, timestamptz) from public, anon;
grant execute on function app.wa_bot_falas(uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Pode falar? — PURA, não age
-- ---------------------------------------------------------------------
create or replace function app.wa_bot_pode_falar(p_conversation_id uuid,
                                                 p_quando timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.conversations%rowtype;
  v_cfg    jsonb := app.wa_robo_teto();
  v_quando timestamptz := coalesce(p_quando, now());
  v_desde  timestamptz;
  v_falas  int;
  v_fus    int;
  v_seg    int;
  v_rapidas int;
  v_iguais int;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('pode', false, 'motivo', 'conversa_inexistente');
  end if;

  -- (a) O FUSÍVEL GLOBAL, primeiro. Ele é o único que fala do sistema inteiro,
  --     e um laço que já pegou fogo não deve ser avaliado conversa a conversa.
  v_fus := coalesce((v_cfg ->> 'fusivel_por_hora')::int, 120);
  select count(*)::int into v_seg
    from public.messages m
   where m.direction = 'out'::app.msg_direction
     and m.author_kind in ('bot_fixed', 'bot_ai')
     and m.status <> 'failed'::app.msg_status
     and coalesce(m.sent_at, m.created_at) > v_quando - interval '1 hour';
  if v_seg >= v_fus then
    return jsonb_build_object('pode', false, 'motivo', 'fusivel_global',
                              'falas', v_seg, 'teto', v_fus);
  end if;

  -- (b) O robô já foi mandado calar nesta conversa.
  if c.bot_paused then
    return jsonb_build_object('pode', false, 'motivo', 'bot_pausado');
  end if;

  -- (c) O teto de falas na janela.
  v_desde := v_quando - make_interval(hours => coalesce((v_cfg ->> 'janela_horas')::int, 24));
  v_falas := app.wa_bot_falas(p_conversation_id, v_desde);
  if v_falas >= coalesce((v_cfg ->> 'falas_por_conversa')::int, 6) then
    return jsonb_build_object('pode', false, 'motivo', 'teto_de_falas',
                              'falas', v_falas,
                              'teto', coalesce((v_cfg ->> 'falas_por_conversa')::int, 6));
  end if;

  -- (d) Pingue-pongue: N recebidas seguidas, cada uma logo depois da nossa
  --     saída anterior. Gente lê antes de responder.
  select count(*)::int into v_rapidas
    from (
      select m.created_at,
             (select max(coalesce(o.sent_at, o.created_at))
                from public.messages o
               where o.conversation_id = p_conversation_id
                 and o.direction = 'out'::app.msg_direction
                 and o.status <> 'failed'::app.msg_status
                 and coalesce(o.sent_at, o.created_at) < m.created_at) as nossa
        from public.messages m
       where m.conversation_id = p_conversation_id
         and m.direction = 'in'::app.msg_direction
         and m.created_at <= v_quando
       order by m.created_at desc
       limit coalesce((v_cfg ->> 'pingue_pongue_seguidas')::int, 3)) u
   where u.nossa is not null
     and u.created_at - u.nossa
         < make_interval(secs => coalesce((v_cfg ->> 'pingue_pongue_segundos')::int, 20));
  if v_rapidas >= coalesce((v_cfg ->> 'pingue_pongue_seguidas')::int, 3) then
    return jsonb_build_object('pode', false, 'motivo', 'pingue_pongue', 'seguidas', v_rapidas);
  end if;

  -- (e) Repetição: as N últimas recebidas com o mesmo corpo. Autoresponder.
  select count(distinct lower(btrim(coalesce(u.body, ''))))::int into v_iguais
    from (select m.body
            from public.messages m
           where m.conversation_id = p_conversation_id
             and m.direction = 'in'::app.msg_direction
             and m.created_at <= v_quando
             and coalesce(btrim(m.body), '') <> ''
           order by m.created_at desc
           limit coalesce((v_cfg ->> 'repeticoes_iguais')::int, 3)) u;
  if v_iguais = 1
     and (select count(*)::int
            from (select 1 from public.messages m
                   where m.conversation_id = p_conversation_id
                     and m.direction = 'in'::app.msg_direction
                     and m.created_at <= v_quando
                     and coalesce(btrim(m.body), '') <> ''
                   order by m.created_at desc
                   limit coalesce((v_cfg ->> 'repeticoes_iguais')::int, 3)) z)
         >= coalesce((v_cfg ->> 'repeticoes_iguais')::int, 3) then
    return jsonb_build_object('pode', false, 'motivo', 'repeticao');
  end if;

  return jsonb_build_object('pode', true, 'motivo', null, 'falas', v_falas);
end $$;
comment on function app.wa_bot_pode_falar(uuid, timestamptz) is
  'Diz se o robô ainda pode falar nesta conversa: fusível global da última hora, bot pausado, teto de falas na janela, pingue-pongue e repetição. PURA — não muda nada. Quem age é app.wa_bot_freiar.';
revoke all on function app.wa_bot_pode_falar(uuid, timestamptz) from public, anon;
grant execute on function app.wa_bot_pode_falar(uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Freiar — e a ordem importa
-- ---------------------------------------------------------------------
create or replace function app.wa_bot_freiar(p_conversation_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c      public.conversations%rowtype;
  v_tpl  int := app.wa_modelo_humano();
  v_msg  uuid;
  v_task uuid;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('freiou', false, 'motivo', 'conversa_inexistente');
  end if;

  -- (1) A DESPEDIDA PRIMEIRO. Depois de `bot_paused` o próprio guarda a
  --     recusaria, e o fornecedor ficaria falando sozinho com um robô que
  --     emudeceu sem dizer por quê. Idempotente pela regra de 12 h por modelo
  --     que `app.ausencia_responder` já usa.
  if v_tpl is not null
     and not exists (select 1 from public.messages m
                      where m.conversation_id = c.id
                        and m.template_id = v_tpl
                        and m.created_at > now() - interval '12 hours') then
    begin
      v_msg := app.wa_bot_dizer(c.id, 'GEN-SYS-HUMANO');
    exception when others then
      raise warning 'wa_bot_freiar: a despedida não saiu (%): %', c.id, sqlerrm;
    end;
  end if;

  -- (2) Agora sim o robô cala.
  update public.conversations
     set bot_paused = true, status = 'aguardando_nos', updated_at = now()
   where id = c.id;

  -- (3) E alguém aparece. Sem tarefa, o freio é um silêncio.
  insert into public.tasks (title, kind, priority, due_at, assignee_id, organization_id,
                            contact_id, created_by, origin)
  values ('O robô parou nesta conversa (' || coalesce(p_motivo, 'sem motivo') || ') — responda à mão',
          'message'::app.task_kind, 1, now(), c.assignee_id, c.organization_id, c.contact_id,
          null, 'system')
  returning id into v_task;

  -- O fusível global é do SISTEMA, não da conversa: ele fica gravado na linha
  -- que `public.wa_bot_ligar` já conhece, para religar ser um gesto só.
  if p_motivo = 'fusivel_global' then
    update public.app_settings
       set value = jsonb_set(value, '{freio}',
                     jsonb_build_object('parado_em', to_jsonb(now()), 'motivo', to_jsonb(p_motivo))),
           updated_at = now()
     where key = 'whatsapp.bot_de_entrada';
  end if;

  return jsonb_build_object('freiou', true, 'motivo', p_motivo,
                            'message_id', v_msg, 'task_id', v_task);
end $$;
comment on function app.wa_bot_freiar(uuid, text) is
  'Para o robô numa conversa, nesta ordem: despedida (GEN-SYS-HUMANO) → bot_paused e aguardando_nos → tarefa para quem responde. A ordem importa: invertida, o próprio guarda recusaria a despedida. No fusível global grava também app_settings.whatsapp.bot_de_entrada.freio.';
revoke all on function app.wa_bot_freiar(uuid, text) from public, anon, authenticated;
grant execute on function app.wa_bot_freiar(uuid, text) to service_role;


-- ---------------------------------------------------------------------
-- 6. O gatilho que freia quando a máquina do outro lado aparece
-- ---------------------------------------------------------------------
-- Pingue-pongue, repetição e fusível não são descobertos na hora de FALAR:
-- eles se veem quando a mensagem CHEGA. O gatilho roda antes de
-- `messages_bot_de_entrada` e de `messages_after_write` — o nome começa com
-- `a_`, e `_` (0x5F) ordena antes de `f` de `after_write` —, para que o bot de
-- entrada já encontre a conversa pausada em vez de falar e ser recusado.
--
-- Embrulhado em `begin ... exception when others then raise warning`, como os
-- vizinhos: a mensagem que chegou vale mais que o freio dela.
--
-- O TETO DE FALAS NÃO FREIA AQUI, de propósito. Ele é o guarda que recusa a
-- sétima fala; freiar a conversa inteira só porque o robô já falou seis vezes
-- roubaria a última resposta que ainda seria útil.
create or replace function app.messages_freio_do_robo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bot jsonb;
begin
  begin
    v_bot := app.wa_bot_pode_falar(new.conversation_id, coalesce(new.created_at, now()));
    if not coalesce((v_bot ->> 'pode')::boolean, false)
       and (v_bot ->> 'motivo') in ('pingue_pongue', 'repeticao', 'fusivel_global') then
      perform app.wa_bot_freiar(new.conversation_id, v_bot ->> 'motivo');
    end if;
  exception when others then
    raise warning 'messages_freio_do_robo(%): %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function app.messages_freio_do_robo() from public, anon, authenticated;

drop trigger if exists messages_a_freio_do_robo on public.messages;
create trigger messages_a_freio_do_robo after insert on public.messages
  for each row when (new.direction = 'in'::app.msg_direction)
  execute function app.messages_freio_do_robo();

-- ---------------------------------------------------------------------
-- 7. O guarda conta as falas do robô
-- ---------------------------------------------------------------------
-- A versão viva (20260916130000) é copiada do banco com `pg_get_functiondef` e
-- recebe UMA declaração e UM bloco. São 247 linhas de guardrails, e é o arquivo
-- mais conferido do projeto: reescrevê-lo de memória seria perder um deles sem
-- perceber.
CREATE OR REPLACE FUNCTION app.messages_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c        public.conversations%rowtype;
  d        public.message_drafts%rowtype;
  v_motivo text;
  v_pode   jsonb;
  v_conf   jsonb;
  v_mconf  text;
  v_corpo  text;
  v_tpl    int;
  v_bot    jsonb;
begin
  select * into c from public.conversations where id = new.conversation_id;
  if not found then
    raise exception 'Mensagem sem conversa' using errcode = '23503';
  end if;
  new.organization_id := coalesce(new.organization_id, c.organization_id);
  new.contact_id      := coalesce(new.contact_id, c.contact_id);

  -- ----------------------------------------------------------------
  -- RECEBIDA: entra sempre, inclusive de quem está suprimido.
  -- A mensagem em que alguém escreve "SAIR" é a prova do opt-out. Barrá-la
  -- por causa do opt-out que ela mesma criou seria apagar o consentimento
  -- no instante em que ele é dado.
  -- ----------------------------------------------------------------
  if new.direction = 'in'::app.msg_direction then
    new.optout_confirmation := false;   -- confirmação é coisa de saída
    return new;
  end if;

  -- ----------------------------------------------------------------
  -- ENVIADA
  -- ----------------------------------------------------------------
  if tg_op = 'INSERT' then

    -- ================================================================
    -- (0) A CONFIRMAÇÃO DE OPT-OUT (RF-CON-19) — DERIVADA, NÃO DECLARADA
    -- ================================================================
    -- A pergunta não é "quem insere quer a exceção?", é "o ESTADO deve
    -- esta confirmação, e esta linha tem a FORMA dela?". Quem responde é
    -- o banco. Recusar em vez de ignorar em silêncio é de propósito: o
    -- motivo é nomeado no ponto em que a falha foi cometida e vai para o
    -- `audit_log` junto com a exceção.
    if new.author_kind = 'system' or new.optout_confirmation then
      v_conf  := app.wa_confirmacao_de_optout(new.conversation_id);
      v_mconf := v_conf ->> 'motivo';
      v_corpo := v_conf ->> 'corpo';
      v_tpl   := (v_conf ->> 'template_id')::int;

      if v_mconf is null then
        if new.author_kind <> 'system' then
          -- Confirmação é do SISTEMA. Uma pessoa que quer se despedir
          -- escreve a mensagem dela, que passa pela porteira inteira — e,
          -- para quem está suprimido, não passa.
          v_mconf := 'confirmacao_nao_e_de_pessoa';
        elsif new.origin <> 'crm' then
          v_mconf := 'confirmacao_nao_e_eco_nem_importacao';
        elsif new.draft_id is not null then
          -- Nada redigido entra aqui, nem rascunho APROVADO: o que a
          -- pessoa aprovou não é o texto fixo — e se fosse, não precisaria
          -- de aprovação.
          v_mconf := 'confirmacao_nao_nasce_de_rascunho';
        elsif new.type <> 'text'::app.msg_type then
          v_mconf := 'confirmacao_e_texto';
        elsif new.template_id is distinct from v_tpl then
          v_mconf := 'modelo_nao_e_o_gen_sys_optout';
        elsif new.body is not null and btrim(new.body) is distinct from v_corpo then
          -- O CORPO TEM DE SER O TEXTO FIXO.
          v_mconf := 'texto_diferente_do_modelo_fixo';
        elsif coalesce(new.template_params, '[]'::jsonb) <> '[]'::jsonb then
          -- D1: a confirmação não tem parâmetro NENHUM desde
          -- 20260905000400. Fora da janela de 24 h o que vai no fio é o
          -- template com `template_params` — um parâmetro aqui seria a
          -- mesma fatia de texto livre que o vocativo era, na mesma
          -- mensagem que ninguém revisa.
          v_mconf := 'confirmacao_nao_tem_parametro';
        end if;
      end if;

      if new.optout_confirmation and v_mconf is not null then
        raise exception 'Envio recusado: % — optout_confirmation é derivada do estado pelo banco, nunca declarada por quem insere (RF-CON-19, ADR-05)',
          v_mconf using errcode = '42501';
      end if;
      new.optout_confirmation := (v_mconf is null);
    else
      new.optout_confirmation := false;
    end if;

    if new.optout_confirmation then
      -- O texto é do banco, ponto: quem insere pode mandar o mesmo texto
      -- ou mandar nada, e nos dois casos o que fica gravado é este.
      new.body            := v_corpo;
      new.template_params := '[]'::jsonb;   -- sem vocativo, sem parâmetro (D1)
      new.is_first_contact := false;        -- confirmação nunca é primeiro contato
      -- Honesto: fora da janela de 24 h ela É iniciada pela empresa, e por
      -- isso CONTA nos tetos de volume.
      new.business_initiated := not app.janela_de_24h_aberta(c.id, coalesce(new.sent_at, now()));

      -- A janela de horário e os tetos NÃO são conferidos AGORA, e isso é
      -- deliberado: `public.wa_optout_registrar` grava a supressão e
      -- enfileira a confirmação na MESMA transação, então uma exceção aqui
      -- abortaria o próprio opt-out — quem escreveu "SAIR" às 3h de
      -- domingo ficaria sem supressão nenhuma. Enfileirar não é enviar.
      return new;
    end if;

    -- ================================================================
    -- (0b) O TETO DE FALA DO ROBÔ (RF-CON-20, Fase 3 do pivô)
    -- ================================================================
    -- APERTO, e o único desta fase no guarda. Neste ponto a confirmação de
    -- opt-out já saiu pelo `return new` acima, e `author_kind = 'system'` que
    -- NÃO é confirmação válida é recusado no `else` de (2) — então este bloco
    -- só vê robô de verdade.
    --
    -- A despedida (`GEN-SYS-HUMANO`) é a única exceção, e ela é o motivo de o
    -- bloco existir: sem ela, uma conversa no teto emudeceria sem dizer por
    -- quê, e o fornecedor ficaria falando sozinho.
    --
    -- `new.created_at` vale aqui: o `default now()` da coluna é aplicado antes
    -- de o gatilho BEFORE rodar.
    if new.author_kind in ('bot_fixed', 'bot_ai')
       and new.template_id is distinct from app.wa_modelo_humano() then
      v_bot := app.wa_bot_pode_falar(new.conversation_id, coalesce(new.created_at, now()));
      if not coalesce((v_bot ->> 'pode')::boolean, false) then
        raise exception 'Envio recusado: o robô já falou o bastante nesta conversa (%) — RF-CON-20',
          v_bot ->> 'motivo' using errcode = '42501';
      end if;
    end if;

    -- (1) Eco do celular: registro do que já aconteceu.
    if new.origin = 'echo' then
      if new.author_kind = 'bot_ai' then
        raise exception 'Eco do celular é mensagem de gente: author_kind bot_ai não faz sentido aqui'
          using errcode = '23514';
      end if;
      new.business_initiated := not app.janela_de_24h_aberta(c.id, coalesce(new.sent_at, now()));
      return new;
    end if;

    -- (2) HUMAN-IN-THE-LOOP (ADR-05, RF-CON-22).
    if new.author_kind = 'bot_ai' then
      if new.draft_id is null then
        raise exception 'Mensagem redigida por IA exige rascunho aprovado por uma pessoa (ADR-05, RF-CON-22)'
          using errcode = '42501';
      end if;
      select * into d from public.message_drafts where id = new.draft_id;
      if not found or d.status not in ('aprovado', 'enviado') then
        raise exception 'O rascunho % não está aprovado (status %): nada sai sozinho (ADR-05)',
          new.draft_id, coalesce(d.status, 'inexistente') using errcode = '42501';
      end if;
      if d.reviewed_by is null then
        raise exception 'Rascunho aprovado sem quem aprovou não é aprovação (RF-ADM-03)' using errcode = '42501';
      end if;
      if d.organization_id is distinct from new.organization_id then
        raise exception 'O rascunho aprovado é de outra ficha' using errcode = '42501';
      end if;
      if new.body is distinct from d.final_body then
        raise exception 'O corpo da mensagem tem de ser exatamente o texto aprovado (final_body do rascunho)'
          using errcode = '42501';
      end if;
      new.approved_by := d.reviewed_by;
    elsif new.author_kind = 'bot_fixed' then
      if new.template_id is null and new.cadence_touch_id is null then
        raise exception 'Texto fixo do robô sai por modelo aprovado ou por toque de cadência (RF-CON-22)'
          using errcode = '42501';
      end if;
    elsif new.author_kind = 'human' then
      if new.sent_by is null then
        raise exception 'Mensagem humana sem autor não é humana' using errcode = '23502';
      end if;
    else
      raise exception 'Envio recusado: % — mensagem de saída com author_kind "system" só existe como confirmação de opt-out (RF-CON-19)',
        coalesce(v_mconf, 'sem_pedido_de_optout') using errcode = '42501';
    end if;

    -- (3) A porteira: supressão, janela de 24 h, template obrigatório fora
    --     dela, janela de horário (domingo e feriado), tetos.
    new.business_initiated := not app.janela_de_24h_aberta(c.id, now());
    v_pode := app.pode_enviar(new.conversation_id, new.is_first_contact,
                              new.template_id is not null, now());
    if not coalesce((v_pode ->> 'pode')::boolean, false) then
      raise exception 'Envio recusado: % (RF-CON-10, RF-CON-11, RF-CON-18)', v_pode ->> 'motivo'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- ----------------------------------------------------------------
  -- UPDATE — O CAMINHO ATÉ O FIO É IMUTÁVEL (D2)
  -- ----------------------------------------------------------------
  -- A lista da 000300 foi feita olhando UMA COLUNA. Esta é feita olhando o
  -- payload de `app.wa_proximos`: se o worker lê o campo para montar a
  -- chamada da Graph API, ou para decidir sob quais regras ela sai, ele não
  -- muda depois do insert. Mensagem é registro do que aconteceu.
  --
  --   conversation_id · direction · body (só vai a NULL, pela retenção do
  --   PRD §10.6) · draft_id · wa_message_id — já estavam;
  --   optout_confirmation — entrou na 000300;
  --   type · template_id · template_params · audio_asset_id — O QUE VAI NO
  --     FIO. Era por aqui que o gestor trocava GEN-SYS-OPTOUT por
  --     GEN-SYS-QUEM-SOMOS numa confirmação já enfileirada, levando junto a
  --     dispensa da supressão;
  --   origin — PORTEIA a reconferência da entrega (`and new.origin='crm'`):
  --     mudá-lo para 'echo' fazia a mensagem sair sem reconferência nenhuma;
  --   author_kind — escolhe o ramo do gatilho no insert; mudá-lo depois
  --     desmente o que foi conferido;
  --   organization_id · contact_id — o ALVO de app.wa_motivo_de_recusa na
  --     entrega: trocá-los é trocar de quem se pergunta "está suprimido?";
  --   is_first_contact · business_initiated — os tetos do RF-CON-10.
  if new.conversation_id  is distinct from old.conversation_id
     or new.direction     is distinct from old.direction
     or (new.body is distinct from old.body and new.body is not null)
     or new.draft_id      is distinct from old.draft_id
     or new.optout_confirmation is distinct from old.optout_confirmation
     or new.type          is distinct from old.type
     or new.template_id   is distinct from old.template_id
     or new.template_params is distinct from old.template_params
     or new.audio_asset_id  is distinct from old.audio_asset_id
     or new.origin        is distinct from old.origin
     or new.author_kind   is distinct from old.author_kind
     -- A ficha PODE ser preenchida depois, e só para preencher: `public.vincular_conversa`
     -- liga a conversa de um número fora da base a uma ficha e carimba as mensagens que
     -- já estavam lá (migração 20260915130000). De null para a ficha DA CONVERSA passa;
     -- trocar de alvo continua proibido, que é o que esta regra existe para impedir.
     or (new.organization_id is distinct from old.organization_id
         and not (old.organization_id is null
                  and new.organization_id is not distinct from c.organization_id))
     or (new.contact_id is distinct from old.contact_id
         and not (old.contact_id is null
                  and new.contact_id is not distinct from c.contact_id))
     or new.is_first_contact   is distinct from old.is_first_contact
     or new.business_initiated is distinct from old.business_initiated
     or (old.wa_message_id is not null and new.wa_message_id is distinct from old.wa_message_id) then
    raise exception 'Mensagem é registro do que aconteceu: o que vai no fio (tipo, corpo, modelo, parâmetros, áudio) e o que decide como ele vai (origem, autoria, ficha, primeiro contato, iniciada pela empresa, confirmação de opt-out, wamid) não mudam depois do insert'
      using errcode = '42501';
  end if;

  -- A RECONFERÊNCIA DA ENTREGA: aprovado às 9h não é permissão para as 9h40.
  if old.status = 'queued'::app.msg_status and new.status = 'sent'::app.msg_status
     and new.origin = 'crm' then
    if new.optout_confirmation then
      -- A confirmação não morre de supressão (dispensa 1) nem de janela de
      -- 24 h (dispensa 2) — mas a hora ela respeita. `p_com_teto => false`
      -- por aritmética: neste ponto a própria linha JÁ está contada em
      -- `app.iniciadas_pela_empresa`.
      v_pode := app.pode_enviar_confirmacao_optout(new.conversation_id, now(), false);
      if not coalesce((v_pode ->> 'pode')::boolean, false) then
        raise exception 'Entrega recusada na saída: % — a confirmação de opt-out dispensa a supressão, não a janela de horário (RF-CON-11)',
          v_pode ->> 'motivo' using errcode = '42501';
      end if;
    else
      v_motivo := app.wa_motivo_de_recusa(new.organization_id, new.contact_id, c.peer_phone_e164);
      if v_motivo is not null then
        raise exception 'Entrega recusada na saída: % — a fila não é permissão, é intenção', v_motivo
          using errcode = '42501';
      end if;
    end if;
    new.sent_at := coalesce(new.sent_at, now());
  end if;

  if new.status = 'delivered'::app.msg_status then new.delivered_at := coalesce(new.delivered_at, now()); end if;
  if new.status = 'read'::app.msg_status      then new.read_at      := coalesce(new.read_at, now());      end if;
  if new.status = 'failed'::app.msg_status    then new.failed_at    := coalesce(new.failed_at, now());    end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------
-- 8. Religar apaga o freio, no mesmo gesto
-- ---------------------------------------------------------------------
-- O fusível grava `freio` na MESMA linha que `wa_bot_ligar` já escreve. Ligar
-- sem apagar o freio faria o gestor clicar em "ligar" e o robô continuar mudo,
-- sem nada na tela explicando por quê.
create or replace function public.wa_bot_ligar(p_ativo boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_valor jsonb;
begin
  if auth.uid() is null or not app.is_manager() then
    raise exception 'Só gestor liga e desliga o bot de entrada' using errcode = '42501';
  end if;
  update public.app_settings
     set value = case when coalesce(p_ativo, false)
                      then jsonb_set(value, '{ativo}', 'true'::jsonb) - 'freio'
                      else jsonb_set(value, '{ativo}', 'false'::jsonb)
                 end,
         updated_at = now()
   where key = 'whatsapp.bot_de_entrada'
  returning value into v_valor;
  return coalesce(v_valor, '{}'::jsonb);
end $$;
comment on function public.wa_bot_ligar(boolean) is
  'Liga ou desliga o bot de entrada do WhatsApp (app_settings.whatsapp.bot_de_entrada). Ligar apaga também o freio do fusível global, no mesmo gesto: ligar e continuar mudo seria pior que continuar desligado. Só gestor e admin.';
revoke all on function public.wa_bot_ligar(boolean) from public, anon;
grant execute on function public.wa_bot_ligar(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Os três freios numa pergunta só
-- ---------------------------------------------------------------------
-- Com quatro freios novos, "está tudo bem?" deixa de ser uma pergunta que
-- alguém responde olhando três telas.
create or replace function public.wa_freios_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dia    date := (now() at time zone 'America/Fortaleza')::date;
  v_numero text := app.wa_numero_padrao();
  v_meta   jsonb;
  v_bot    jsonb;
  v_falas  int;
begin
  if auth.uid() is null
     or app.role() not in ('admin'::app.user_role, 'gestor'::app.user_role,
                           'financeiro'::app.user_role) then
    raise exception 'Sem permissão para ver os freios do atendimento' using errcode = '42501';
  end if;
  v_meta := app.wa_teto_da_meta(v_numero, now());
  select s.value into v_bot from public.app_settings s where s.key = 'whatsapp.bot_de_entrada';
  select count(*)::int into v_falas
    from public.messages m
   where m.direction = 'out'::app.msg_direction
     and m.author_kind in ('bot_fixed', 'bot_ai')
     and m.status <> 'failed'::app.msg_status
     and coalesce(m.sent_at, m.created_at) > now() - interval '1 hour';

  return jsonb_build_object(
    'orcamento',  app.ai_gasto_do_mes(null)
                  || jsonb_build_object('propositos_parados',
                                        to_jsonb(app.ia_gasto_bloqueado_para()),
                                        'adiados',
                                        (select count(*)::int from public.ia_trabalho_adiado a
                                          where a.retomado_em is null)),
    'numero',     v_meta || jsonb_build_object(
                    'teto_nosso', app.teto_do_canal('whatsapp'::app.channel, v_dia),
                    'usados', app.aberturas_do_dia('whatsapp'::app.channel, v_dia, v_numero)),
    'robo',       app.wa_robo_teto()
                  || jsonb_build_object('falas_na_ultima_hora', v_falas,
                                        'ativo', coalesce((v_bot ->> 'ativo')::boolean, false),
                                        'freio', v_bot -> 'freio'));
end $$;
comment on function public.wa_freios_status() is
  'Os três freios da Fase 3 numa pergunta só: o orçamento de IA (com o que está parado e o que ficou devendo), o número na Meta (teto nosso, teto dela e quem manda hoje) e o teto de fala do robô. Para admin, gestor e financeiro.';
revoke all on function public.wa_freios_status() from public, anon;
grant execute on function public.wa_freios_status() to authenticated, service_role;

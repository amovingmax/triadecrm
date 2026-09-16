-- A ficha entra nas mensagens que já estavam gravadas.
--
-- `public.vincular_conversa` (16/09/2026) liga a conversa de um número fora da base a
-- uma ficha e carimba as mensagens dela. Isso funcionava enquanto a conversa só tinha
-- mensagem RECEBIDA — que o `messages_guard` deixa passar antes da regra de imutabilidade.
-- Com o bot de entrada existe mensagem ENVIADA antes do vínculo (o menu), e o carimbo
-- passou a bater na trava do D2: "mensagem é registro do que aconteceu".
--
-- A trava continua de pé para o que ela protege: trocar o ALVO de uma mensagem já
-- gravada (era da ficha A, vira da ficha B) segue recusado. O que passa a ser permitido
-- é o preenchimento — de null para a ficha da própria conversa.

create or replace function app.messages_guard()
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
end $function$



-- =====================================================================
-- Cliente não recebe resposta automática
--
-- Rafael, 01/10/2026: "tire a resposta automatica quando a conversa vier de
-- clientes". Conversa de cliente é a conversa SEM FICHA — quem escreveu para o
-- número da KOMUNE e não é parceiro, e que desde a migração 20261003100000 é
-- respondido por gente na aba Clientes.
--
-- Três automações falavam com essas pessoas, e as três se calam para elas:
--   1. o MENU de entrada ("responda com o número: 1 - Quero ser fornecedor...")
--      e a resposta à escolha — `app.wa_bot_de_entrada`;
--   2. o AVISO de fora do horário — `app.ausencia_responder`;
--   3. a APRESENTAÇÃO ("Tudo bem?" e o texto da Komune) — `app.wa_introduzir`.
--      Ela só falava com quem respondia ao cumprimento, que até hoje só ia para
--      parceiro; desde a aba Clientes o "Bom dia!" também reabre conversa de
--      cliente, e a apresentação de captação não pode ir atrás dele.
--
-- Para parceiro (conversa COM ficha) nada muda: o menu, o aviso e a
-- apresentação continuam valendo nas mesmas condições.
--
-- Efeito colateral, e é o que se quer: com o menu calado para quem não é
-- parceiro, o `app.lead_automatico` fica esperando uma escolha que não vem —
-- então, com o menu ligado, quem escreve não vira parceiro sozinho. Cliente
-- vira parceiro só pelo botão "Virar parceiro", por decisão de uma pessoa.
--
-- Cada função é refeita a partir da sua ÚLTIMA definição (a do banco), com uma
-- condição a mais logo depois de ler a conversa — e nada mais.
--
-- RF-CON-04 · ADR-05 (gente no meio)
-- =====================================================================

CREATE OR REPLACE FUNCTION app.wa_bot_de_entrada(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m        public.messages%rowtype;
  c        public.conversations%rowtype;
  v_cfg    jsonb := app.wa_bot_config();
  v_op     jsonb;
  v_msg    uuid;
begin
  if not coalesce((v_cfg ->> 'ativo')::boolean, false) then
    return jsonb_build_object('agiu', false, 'motivo', 'bot_desligado');
  end if;
  select * into m from public.messages where id = p_message_id;
  if not found or m.direction <> 'in'::app.msg_direction then
    return jsonb_build_object('agiu', false, 'motivo', 'nao_e_entrada');
  end if;
  select * into c from public.conversations where id = m.conversation_id;
  -- CLIENTE NÃO RECEBE MENU (01/10/2026). Conversa sem ficha é de quem não é
  -- parceiro — cliente da plataforma, curioso. Ela é respondida por gente, na
  -- aba Clientes, e o menu de "1 a 4" não passa na frente.
  if c.organization_id is null then
    return jsonb_build_object('agiu', false, 'motivo', 'conversa_de_cliente');
  end if;
  if c.bot_paused then
    return jsonb_build_object('agiu', false, 'motivo', 'bot_pausado');
  end if;
  -- Quem pediu para sair recebe a confirmação do RF-CON-19, não um menu.
  if app.wa_parece_optout(coalesce(m.body, '')) then
    return jsonb_build_object('agiu', false, 'motivo', 'parece_optout');
  end if;
  if app.is_suppressed_target(c.organization_id, c.contact_id) then
    return jsonb_build_object('agiu', false, 'motivo', 'contato_suprimido');
  end if;

  -- ----- primeira mensagem da conversa -----
  if c.bot_estado is null then
    -- Nós é que começamos? Então tem gente falando com ela: o bot não entra.
    if exists (select 1 from public.messages x
                where x.conversation_id = c.id
                  and x.direction = 'out'::app.msg_direction
                  and x.created_at <= m.created_at) then
      update public.conversations set bot_estado = 'conversa_humana', updated_at = now()
       where id = c.id;
      return jsonb_build_object('agiu', false, 'motivo', 'conversa_humana');
    end if;
    v_msg := app.wa_bot_dizer(c.id, coalesce(v_cfg ->> 'modelo_do_menu', 'GEN-SYS-MENU'));
    update public.conversations set bot_estado = 'menu_enviado', updated_at = now() where id = c.id;
    return jsonb_build_object('agiu', true, 'o_que', 'menu', 'message_id', v_msg);
  end if;

  -- ----- a escolha -----
  if c.bot_estado = 'menu_enviado' then
    v_op := app.wa_bot_escolha(coalesce(m.body, ''));
    if v_op is null then
      -- Escreveu com as palavras dela: o robô sai da frente e a conversa é de gente.
      update public.conversations set bot_estado = 'sem_escolha', updated_at = now() where id = c.id;
      return jsonb_build_object('agiu', false, 'motivo', 'sem_escolha');
    end if;
    v_msg := app.wa_bot_dizer(c.id, v_op ->> 'modelo');
    update public.conversations
       set bot_estado = 'escolhido',
           bot_opcao  = v_op ->> 'chave',
           ai_intent  = coalesce(v_op ->> 'intencao', ai_intent),
           updated_at = now()
     where id = c.id;

    -- A tarefa é o que faz alguém aparecer: sem ela, a escolha morre no fio.
    insert into public.tasks (title, kind, priority, due_at, assignee_id, organization_id,
                              contact_id, created_by, origin)
    values (coalesce(v_op ->> 'tarefa', 'Responder no WhatsApp') || ' — ' || coalesce(v_op ->> 'rotulo', ''),
            'message'::app.task_kind, 1, now(), c.assignee_id, c.organization_id, c.contact_id,
            null, 'system');
    return jsonb_build_object('agiu', true, 'o_que', 'resposta', 'opcao', v_op ->> 'chave',
                              'message_id', v_msg);
  end if;

  return jsonb_build_object('agiu', false, 'motivo', 'bot_ja_falou');
end $function$;

CREATE OR REPLACE FUNCTION app.ausencia_responder(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.messages%rowtype;
  c public.conversations%rowtype;
  v_tpl int := (select t.id from public.message_templates t where t.template_code = 'GEN-SYS-AUSENCIA' and t.is_active);
  v_msg uuid;
begin
  select * into m from public.messages where id = p_message_id;
  if not found or m.direction <> 'in'::app.msg_direction then
    return jsonb_build_object('respondeu', false, 'motivo', 'nao_e_entrada');
  end if;
  if not app.atendimento_liga('ausencia_ativa') or v_tpl is null then
    return jsonb_build_object('respondeu', false, 'motivo', 'desligada');
  end if;
  select * into c from public.conversations where id = m.conversation_id;
  -- CLIENTE NÃO RECEBE AVISO (01/10/2026): a mesma regra do menu. Vem antes
  -- da hora de propósito, para a resposta não depender do relógio.
  if c.organization_id is null then
    return jsonb_build_object('respondeu', false, 'motivo', 'conversa_de_cliente');
  end if;
  if coalesce((app.janela_do_canal(c.channel, now(), true) ->> 'aberta')::boolean, false) then
    return jsonb_build_object('respondeu', false, 'motivo', 'dentro_do_horario');
  end if;
  if app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164) is not null
     or app.wa_parece_optout(coalesce(m.body, '')) then
    return jsonb_build_object('respondeu', false, 'motivo', 'contato_suprimido');
  end if;
  -- Nunca por cima de outra resposta automática da mesma chegada (o menu).
  if exists (select 1 from public.messages x
              where x.conversation_id = c.id and x.direction = 'out'::app.msg_direction
                and x.created_at >= m.created_at) then
    return jsonb_build_object('respondeu', false, 'motivo', 'ja_respondida');
  end if;
  if exists (select 1 from public.messages x
              where x.conversation_id = c.id and x.template_id = v_tpl
                and x.created_at > now() - interval '12 hours') then
    return jsonb_build_object('respondeu', false, 'motivo', 'ja_avisou');
  end if;

  v_msg := app.wa_bot_dizer(c.id, 'GEN-SYS-AUSENCIA');
  return jsonb_build_object('respondeu', v_msg is not null, 'message_id', v_msg);
end $function$;

CREATE OR REPLACE FUNCTION app.wa_introduzir(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m       public.messages%rowtype;
  c       public.conversations%rowtype;
  v_trava uuid;
  v_msg   uuid;
  v_ola   uuid;
begin
  if not app.atendimento_liga('introducao_ativa') then
    return jsonb_build_object('introduziu', false, 'motivo', 'desligada');
  end if;
  if app.wa_modelo_introducao() is null then
    return jsonb_build_object('introduziu', false, 'motivo', 'sem_modelo');
  end if;

  select * into m from public.messages where id = p_message_id;
  if not found or m.direction <> 'in'::app.msg_direction
     or m.type <> 'text'::app.msg_type
     or nullif(btrim(coalesce(m.body, '')), '') is null then
    -- Áudio, imagem e mídia não abrem a introdução: o áudio tem caminho próprio
    -- (RF-CON-27) e o toque de botão tem `app.envio_resposta_ao_botao`.
    return jsonb_build_object('introduziu', false, 'motivo', 'nao_e_texto_de_entrada');
  end if;

  select * into c from public.conversations where id = m.conversation_id;
  -- CLIENTE NÃO RECEBE APRESENTAÇÃO (01/10/2026). A apresentação é o texto de
  -- captação de fornecedor; para quem não é parceiro ela não faz sentido. Sem
  -- esta linha, o cliente que respondesse ao "Bom dia!" mandado pela aba
  -- Clientes (fora da janela de 24 h) ganharia o "Tudo bem?" e o pitch.
  if c.organization_id is null then
    return jsonb_build_object('introduziu', false, 'motivo', 'conversa_de_cliente');
  end if;
  if c.bot_paused then
    return jsonb_build_object('introduziu', false, 'motivo', 'bot_pausado');
  end if;
  -- Quem se despede não recebe apresentação. Espelho de `app.wa_parece_optout`
  -- (20260916110000), e ele é necessário AQUI: quando este gatilho roda, o
  -- worker ainda não gravou a supressão (entrada.ts vem depois do insert).
  if app.wa_parece_optout(coalesce(m.body, '')) then
    return jsonb_build_object('introduziu', false, 'motivo', 'parece_optout');
  end if;
  if app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164) is not null then
    return jsonb_build_object('introduziu', false, 'motivo', 'contato_suprimido');
  end if;

  -- (0) NOVO (28/09/2026): A JANELA DE 24 H, PERGUNTADA E NÃO PRESUMIDA.
  --     A introdução é resposta livre dentro da janela que o fornecedor abriu.
  --     Fora dela ela viraria template iniciado pela empresa — cobrado, contado
  --     nos tetos e recusado pela Meta, porque `GEN-SYS-INTRO` não é aprovado.
  --     Acontece quando a entrada chega com carimbo velho (webhook represado,
  --     worker que voltou depois de uma queda). Antes do carimbo de
  --     `introducao_em` de propósito: a conversa fica intocada e quem voltar a
  --     escrever dentro da janela continua tendo direito à apresentação.
  if not app.janela_de_24h_aberta(c.id, now()) then
    return jsonb_build_object('introduziu', false, 'motivo', 'fora_da_janela_de_24h');
  end if;

  -- (0b) DENTRO DO HORÁRIO, E SÓ. Fora dele quem responde é a ausência, e ela se
  --     calaria diante da introdução (20260922120000). Uma apresentação
  --     comercial às 22h40 de domingo, sem ninguém para continuar, é pior que o
  --     silêncio que ela veio resolver. `p_respondeu => true` porque, por
  --     definição, esta pessoa acabou de escrever.
  if not coalesce((app.janela_do_canal(c.channel, now(), true) ->> 'aberta')::boolean, false) then
    return jsonb_build_object('introduziu', false, 'motivo', 'fora_do_horario');
  end if;

  -- (1) TODO ENVIO NOSSO FOI CUMPRIMENTO, e houve pelo menos um.
  if not app.wa_so_o_cumprimento_saiu(c.id, m.created_at) then
    return jsonb_build_object('introduziu', false, 'motivo', 'a_conversa_ja_tem_dono');
  end if;

  -- (2) NINGUÉM RESPONDEU A ESTA ENTRADA — nem gente, nem outro automatismo.
  --     Mesma pergunta que `app.ausencia_responder` faz. É o que impede a
  --     introdução de falar por cima do menu, do link do botão, da despedida do
  --     freio ou de um atendente que abriu a caixa no mesmo minuto, sem precisar
  --     nomear nenhum dos quatro. `>=` e não `>`: dentro de uma transação
  --     `now()` é constante, então a saída de um gatilho vizinho carrega o MESMO
  --     created_at da entrada que a provocou.
  if exists (select 1 from public.messages x
              where x.conversation_id = c.id
                and x.direction = 'out'::app.msg_direction
                and x.created_at >= m.created_at) then
    return jsonb_build_object('introduziu', false, 'motivo', 'ja_respondida');
  end if;

  -- (3) UMA POR CONVERSA. O `where introducao_em is null` é a tranca: duas
  --     entradas no mesmo instante são duas transações, e o lock desta linha
  --     serializa as duas. A segunda vê o carimbo e volta.
  update public.conversations
     set introducao_em = now(), updated_at = now()
   where id = c.id and introducao_em is null
  returning id into v_trava;
  if v_trava is null then
    return jsonb_build_object('introduziu', false, 'motivo', 'ja_introduzida');
  end if;

  -- O "TUDO BEM?" VEM PRIMEIRO (29/09/2026). As duas nascem na mesma
  -- transação; o que as separa no tempo é o atraso de cada uma
  -- (`app.wa_atraso_do_envio`): 3 a 6 s para esta, 15 a 20 s para a
  -- introdução. Falhar aqui NÃO cancela a introdução — se o modelo do "tudo
  -- bem" sumir, o que não pode faltar é a apresentação.
  v_ola := app.wa_bot_dizer(c.id, 'GEN-SYS-TUDOBEM');

  v_msg := app.wa_bot_dizer(c.id, 'GEN-SYS-INTRO');
  if v_msg is null then
    -- `wa_bot_dizer` devolve NULL (com warning) quando o modelo sumiu ou foi
    -- desativado entre a conferência e o envio. Devolver o carimbo, senão a
    -- conversa fica marcada como introduzida sem nunca ter sido. (Quando o
    -- `messages_guard` RECUSA, ele levanta exceção e a subtransação do gatilho
    -- desfaz este update junto — outro caminho, mesmo desfecho.)
    update public.conversations set introducao_em = null where id = c.id;
    return jsonb_build_object('introduziu', false, 'motivo', 'modelo_sumiu');
  end if;
  return jsonb_build_object('introduziu', true, 'message_id', v_msg,
                            'tudo_bem_id', v_ola);
end $function$;

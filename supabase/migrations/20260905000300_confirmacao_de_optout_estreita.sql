-- =====================================================================
-- TRIADE — 20260905000300 — A CONFIRMAÇÃO DE OPT-OUT DEIXA DE SER UMA
-- PORTA DE SERVIÇO (RF-CON-19, RF-CON-10, RF-CON-11, RF-CON-22; ADR-05)
--
-- O QUE ESTAVA ERRADO
-- ---------------------------------------------------------------------
-- A migração 000200 tratou a confirmação do RF-CON-19 como uma EXCEÇÃO
-- DECLARADA: `messages.optout_confirmation` era um booleano que quem
-- insere escrevia, e `app.messages_guard` saía da função no primeiro
-- `if` que o lia:
--
--     if new.optout_confirmation then
--       ... ; return new;      -- nada abaixo daqui roda
--     end if;
--
-- Abaixo daquele `return` ficavam, nesta ordem: o human-in-the-loop do
-- ADR-05 (rascunho aprovado, `reviewed_by`, corpo igual ao `final_body`),
-- a supressão, a janela de 24 h, a janela de horário do RF-CON-11,
-- domingo, feriado e os tetos do RF-CON-10. `app.wa_proximos` repetia a
-- isenção (`when msg.optout_confirmation then null`) e a reconferência do
-- UPDATE também (`and not new.optout_confirmation`).
--
-- Três defeitos, e o terceiro é o que transforma os outros dois em furo:
--
--   1. LARGA. Dispensava tudo, quando só precisava dispensar duas coisas.
--   2. NÃO VERIFICADA. Nada conferia que o corpo fosse o texto fixo do
--      GEN-SYS-OPTOUT, nem que o destinatário tivesse DE FATO pedido
--      para sair.
--   3. LIGADA PELO CLIENTE. A policy `messages_insert` não mencionava a
--      coluna, e é por `insert` direto em `public.messages` que a tela
--      responde. Bastava mandar `optout_confirmation = true` junto.
--
-- A prova, colhida na conferência adversarial com o worker de verdade:
-- o MESMO texto livre, para o MESMO número suprimido, sem a flag dava
-- `Envio recusado: contato_suprimido`; COM a flag entrava, o worker o
-- lia da fila e a Graph API recebia
--     {"to":"+55849…","text":{"body":"texto livre, nenhuma pessoa aprovou,
--      e o número está suprimido."}}
--
-- A EXCEÇÃO CONTINUA EXISTINDO, PORQUE O MOTIVO DELA É LEGÍTIMO
-- ---------------------------------------------------------------------
-- Quem pede para sair merece saber que saiu. Essa confirmação precisa
-- atravessar a supressão — que ela mesma acabou de criar — e precisa
-- atravessar a janela de 24 h. O erro nunca foi ter a exceção. Foi ela
-- ser larga, não verificada, e ligada por um campo que o cliente escreve.
--
-- O QUE ESTA MIGRAÇÃO FAZ, EM UMA LINHA CADA
-- ---------------------------------------------------------------------
--   A. `optout_confirmation` vira coluna DERIVADA. Quem decide que uma
--      linha é a confirmação é o banco, olhando o estado: existe pedido
--      de opt-out registrado para aquele contato e ele ainda não foi
--      confirmado. Quem insere não liga a exceção — e se tentar, é
--      RECUSADO com o motivo nomeado (não ignorado: veja A.3).
--   B. O CORPO é o texto fixo do GEN-SYS-OPTOUT, montado pelo banco. A
--      única variável ({{nome}}) vem de `contacts`, uma COLUNA, nunca do
--      corpo mandado por quem insere. Corpo diferente é recusado.
--   C. A dispensa é item a item, e cada item tem o porquê escrito ao
--      lado. Dispensa a supressão e a janela de 24 h. NÃO dispensa a
--      janela de horário, domingo, feriado nem os tetos de volume.
--   D. UMA VEZ SÓ deixa de depender só do índice único: a segunda
--      tentativa é recusada ANTES, com o motivo `confirmacao_ja_enviada`
--      (o índice fica como a segunda fechadura, para corrida).
--   E. `app.wa_proximos` e a reconferência do UPDATE param de repetir a
--      isenção larga e passam a usar a porteira estreita.
--   F. A policy `messages_insert` passa a dizer, por escrito, que a tela
--      nunca escreve essa coluna.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- =====================================================================
-- A. O ESTADO DECIDE — `app.wa_confirmacao_de_optout`
-- =====================================================================
-- Uma função só, porque três lugares precisam responder EXATAMENTE a
-- mesma pergunta e responder junto: o gatilho de `messages` (que recusa),
-- `public.wa_optout_registrar` (que insere) e o pgTAP (que prova). Dois
-- critérios parecidos em dois lugares é como o furo nasceu.
--
-- Devolve {devida, motivo, template_id, corpo, nome}:
--   · devida = true  → o estado DEVE esta confirmação agora.
--   · devida = false → `motivo` diz por que não, com nome próprio. O nome
--     importa: ele vai para a exceção e de lá para a tela.
--
-- O QUE CONTA COMO "PEDIDO DE OPT-OUT REGISTRADO"
-- ---------------------------------------------------------------------
-- Três formas, e todas são estado GRAVADO, nunca intenção de quem chama:
--   1. o número da conversa está na `suppression_list` (é o que
--      `public.wa_optout_registrar` sempre escreve, com ficha ou sem);
--   2. a ficha/pessoa da conversa está suprimida
--      (`app.is_suppressed_target`: do_not_contact + os três hashes);
--   3. existe `consent_events.kind = 'contact_optout'` para a ficha ou
--      para a pessoa — o caso do opt-out registrado na LIGAÇÃO, que não
--      passa por esta conversa mas vale para ela.
--
-- Repare no que NÃO conta: nada que venha no `insert`.
create or replace function app.wa_confirmacao_de_optout(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c       public.conversations%rowtype;
  t       public.message_templates%rowtype;
  v_nome  text;
  v_corpo text;
  v_pedido boolean;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('devida', false, 'motivo', 'conversa_inexistente');
  end if;

  -- 1 · Alguém pediu para sair? Estado gravado, nas três formas.
  v_pedido := (c.peer_phone_e164 is not null
               and app.is_suppressed(c.peer_phone_e164, null, null))
           or (c.organization_id is not null
               and app.is_suppressed_target(c.organization_id, c.contact_id))
           or exists (select 1
                        from public.consent_events e
                       where e.kind = 'contact_optout'::app.consent_kind
                         and ((c.organization_id is not null and e.organization_id = c.organization_id)
                           or (c.contact_id is not null      and e.contact_id      = c.contact_id)));
  if not v_pedido then
    return jsonb_build_object('devida', false, 'motivo', 'sem_pedido_de_optout');
  end if;

  -- 2 · E ainda não foi confirmado. Esta é a metade "e ainda não" do
  --     critério, e é ela que faz "uma vez só" ser uma pergunta de estado
  --     em vez de um erro de índice único no fim do caminho.
  if exists (select 1 from public.messages m
              where m.conversation_id = c.id and m.optout_confirmation) then
    return jsonb_build_object('devida', false, 'motivo', 'confirmacao_ja_enviada');
  end if;

  -- 3 · O texto fixo. Sem o modelo, não há confirmação — e a resposta é
  --     "não devida", não "manda o que quiser".
  select * into t from public.message_templates
   where template_code = 'GEN-SYS-OPTOUT' and is_active limit 1;
  if not found then
    return jsonb_build_object('devida', false, 'motivo', 'sem_modelo_gen_sys_optout');
  end if;

  -- A ÚNICA VARIÁVEL DO TEXTO VEM DE COLUNA. `contacts.first_name` (ou o
  -- `full_name`), lido aqui — nunca o `{{nome}}` que quem insere teria
  -- resolvido lá fora. Sem nome no cadastro, a saudação viraria vocativo
  -- vazio ("Entendido, . Não vou…"): tira-se a vírgula junto.
  select coalesce(nullif(trim(ct.first_name), ''), nullif(trim(ct.full_name), ''))
    into v_nome from public.contacts ct where ct.id = c.contact_id;
  v_corpo := trim(case when v_nome is null
                       then replace(replace(t.body, ', {{nome}}', ''), '{{nome}}', '')
                       else replace(t.body, '{{nome}}', v_nome) end);

  return jsonb_build_object('devida', true, 'motivo', null,
                            'template_id', t.id, 'corpo', v_corpo, 'nome', v_nome);
end $$;
comment on function app.wa_confirmacao_de_optout(uuid) is
  'O ESTADO decide se esta conversa deve a confirmação de opt-out do RF-CON-19: existe pedido de opt-out registrado (suppression_list do número, supressão da ficha/pessoa, ou consent_events contact_optout) E ele ainda não foi confirmado. Devolve também o texto FIXO do GEN-SYS-OPTOUT já montado, com o {{nome}} lido de contacts — uma coluna, nunca o corpo mandado por quem insere. Motivos possíveis: conversa_inexistente, sem_pedido_de_optout, confirmacao_ja_enviada, sem_modelo_gen_sys_optout.';


-- =====================================================================
-- B. A PORTEIRA ESTREITA — o que a exceção NÃO dispensa
-- =====================================================================
-- `app.pode_enviar` é a porteira inteira, e ela começa pela supressão —
-- que é exatamente o que a confirmação precisa atravessar. Esta é a mesma
-- porteira SEM as duas perguntas que a confirmação dispensa, e com todas
-- as outras no lugar. Escrever a lista de dispensas como uma função
-- separada (em vez de um `if` dentro de `pode_enviar`) é de propósito: a
-- dispensa fica legível, testável sozinha e impossível de crescer por
-- distração.
--
-- DISPENSA 1 — A SUPRESSÃO (`app.wa_motivo_de_recusa` inteira).
--   Por quê: a supressão que barraria esta mensagem foi criada POR ELA,
--   dois passos antes, na mesma transação. Recusá-la seria não confirmar
--   nunca o opt-out de ninguém. Os quatro motivos dessa função são, aqui,
--   ou o próprio opt-out (contato_suprimido, numero_suprimido,
--   contato_apagado — `do_not_contact` é o que o opt-out acabou de
--   escrever) ou uma ficha apagada — e ficha apagada não desfaz o pedido
--   de quem escreveu "SAIR" naquele número.
--
-- DISPENSA 2 — A JANELA DE 24 H.
--   Por quê: o opt-out pode ter sido registrado numa LIGAÇÃO, num
--   formulário, ou dias depois da última mensagem. A confirmação tem de
--   sair mesmo com a janela fechada. Ela não dispensa a exigência de
--   TEMPLATE fora da janela — e não precisa: ela É um template
--   (GEN-SYS-OPTOUT), e `public.wa_saida_proximos` continua exigindo que
--   a Meta o tenha aprovado antes de sair fora da janela (R04 §2.1).
--
-- NÃO DISPENSA — A JANELA DE HORÁRIO DO RF-CON-11, DOMINGO E FERIADO.
--   Por quê: confirmação de opt-out às 3h da manhã de domingo não é
--   respeito, é mais uma mensagem fora de hora para quem acabou de pedir
--   silêncio. Ninguém está esperando essa linha de madrugada. Ela espera
--   a janela abrir — e ESPERAR não é morrer: o dreno adia, não mata.
--
-- NÃO DISPENSA — OS TETOS DE VOLUME DO RF-CON-10 (150/dia, 60/hora).
--   Por quê: o teto protege o quality rating do NÚMERO, e o número não
--   distingue confirmação de convite. Se o número já estourou a hora,
--   esta linha espera a próxima como qualquer outra.
--
-- NÃO DISPENSA — O TETO DE PRIMEIROS CONTATOS.
--   Por quê: não precisa dispensar o que não a alcança. Confirmação de
--   opt-out nunca é primeiro contato — o gatilho força
--   `is_first_contact = false`.
--
-- NÃO DISPENSA — O HUMAN-IN-THE-LOOP, ELA O SUBSTITUI POR ALGO MAIS DURO.
--   O RF-CON-22 isenta de aprovação as "confirmações determinísticas,
--   opt-out e templates de cadência", e o fluxo real não tem gente ali:
--   quem dispara é a regra determinística do worker (`optout.ts`), sem
--   modelo nenhum, em < 5 min do "SAIR" — pedir aprovação humana seria
--   deixar quem pediu silêncio esperando a Heloísa acordar. O que
--   substitui a aprovação é mais forte do que ela: o texto não é livre.
--   É UM texto, montado pelo banco, e qualquer outro é recusado. Não há o
--   que aprovar em uma mensagem que só pode ter um conteúdo possível.
create or replace function app.pode_enviar_confirmacao_optout(p_conversation_id uuid,
                                                              p_quando timestamptz default now(),
                                                              p_com_teto boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c           public.conversations%rowtype;
  v_quando    timestamptz := coalesce(p_quando, now());
  v_dia       date;
  v_janela    jsonb;
  v_respondeu boolean;
  v_cfg       jsonb;
  v_td        int;
  v_th        int;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('pode', false, 'motivo', 'conversa_inexistente', 'quando', null);
  end if;

  -- Janela de horário (RF-CON-11). `app.janela_do_canal` já trata domingo
  -- e feriado e devolve a próxima abertura em America/Fortaleza.
  v_respondeu := c.organization_id is not null and app.ja_respondeu(c.organization_id);
  v_janela := app.janela_do_canal(c.channel, v_quando, v_respondeu);
  if not coalesce((v_janela ->> 'aberta')::boolean, false) then
    return jsonb_build_object('pode', false,
                              'motivo', 'janela_' || coalesce(v_janela ->> 'motivo', 'fechada'),
                              'quando', (v_janela ->> 'abre_em')::timestamptz);
  end if;

  -- Tetos de volume (RF-CON-10). `p_com_teto = false` só na reconferência
  -- do UPDATE, e o motivo está escrito lá.
  if p_com_teto then
    v_dia := (v_quando at time zone 'America/Fortaleza')::date;
    select s.value into v_cfg from public.app_settings s where s.key = 'whatsapp.envio';
    v_td := coalesce((v_cfg ->> 'teto_iniciadas_dia')::int, 150);
    v_th := coalesce((v_cfg ->> 'teto_iniciadas_hora')::int, 60);
    if app.iniciadas_pela_empresa(c.business_number,
                                  (v_dia::timestamp at time zone 'America/Fortaleza'),
                                  ((v_dia + 1)::timestamp at time zone 'America/Fortaleza')) >= v_td then
      return jsonb_build_object('pode', false, 'motivo', 'teto_iniciadas_dia',
                                'quando', app.proxima_abertura_do_canal(v_dia, c.channel, v_respondeu));
    end if;
    if app.iniciadas_pela_empresa(c.business_number, v_quando - interval '1 hour', v_quando) >= v_th then
      return jsonb_build_object('pode', false, 'motivo', 'teto_iniciadas_hora',
                                'quando', v_quando + interval '1 hour');
    end if;
  end if;

  return jsonb_build_object('pode', true, 'motivo', null, 'quando', v_quando);
end $$;
comment on function app.pode_enviar_confirmacao_optout(uuid, timestamptz, boolean) is
  'A porteira da confirmação de opt-out (RF-CON-19): app.pode_enviar SEM as duas perguntas que a confirmação dispensa — a supressão (que ela mesma criou) e a janela de 24 h — e COM todas as outras. Janela de horário, domingo e feriado do RF-CON-11 e os tetos de volume do RF-CON-10 continuam valendo: confirmação de opt-out às 3h de domingo não é respeito, é mais uma mensagem fora de hora. Os motivos que devolve dizem "agora não", nunca "nunca mais" — por isso o dreno ADIA o que ela recusa.';


-- =====================================================================
-- C. O GATILHO — a exceção deixa de ser um `return new` no topo
-- =====================================================================
create or replace function app.messages_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    -- Antes: `if new.optout_confirmation then ... return new; end if;` —
    -- um campo do cliente pulando a função inteira. Agora a pergunta é
    -- outra: "o ESTADO deve esta confirmação, e esta linha tem a FORMA
    -- dela?". Quem responde é o banco.
    --
    -- POR QUE RECUSAR, E NÃO IGNORAR, A FLAG DE QUEM INSERE
    -- Ignorar em silêncio seria o pior dos dois mundos: a linha seguiria
    -- pelo caminho comum e morreria com `contato_suprimido` — um motivo
    -- verdadeiro mas que não descreve o erro cometido —, e a tentativa de
    -- ligar a exceção não deixaria rastro nenhum. Recusar nomeia a falha
    -- no ponto em que ela foi cometida, escreve o motivo no `audit_log`
    -- junto com a exceção, e não deixa ninguém acreditar que mandou uma
    -- confirmação que nunca existiu.
    --
    -- O `if` de fora é só custo: a derivação só pode dar verdadeiro para
    -- `author_kind = 'system'`, então as mensagens comuns não pagam por
    -- ela. Quem declara a flag paga — e paga para receber o motivo certo.
    if new.author_kind = 'system' or new.optout_confirmation then
      v_conf  := app.wa_confirmacao_de_optout(new.conversation_id);
      v_mconf := v_conf ->> 'motivo';
      v_corpo := v_conf ->> 'corpo';
      v_tpl   := (v_conf ->> 'template_id')::int;

      -- O estado deve? Se sim, a linha tem a forma? Item a item, para o
      -- motivo que sai na exceção ser o motivo de verdade.
      if v_mconf is null then
        if new.author_kind <> 'system' then
          -- Confirmação é do SISTEMA. Uma pessoa que quer se despedir
          -- escreve a mensagem dela, que passa pela porteira inteira —
          -- e, para quem está suprimido, não passa. É esse o caminho que
          -- o ataque tomou emprestado com `author_kind = 'human'`.
          v_mconf := 'confirmacao_nao_e_de_pessoa';
        elsif new.origin <> 'crm' then
          v_mconf := 'confirmacao_nao_e_eco_nem_importacao';
        elsif new.draft_id is not null then
          -- Nada redigido entra aqui. `bot_ai` já era recusado; rascunho
          -- APROVADO também é, porque o que a pessoa aprovou não é o
          -- texto fixo — e se fosse, não precisaria de aprovação.
          v_mconf := 'confirmacao_nao_nasce_de_rascunho';
        elsif new.type <> 'text'::app.msg_type then
          v_mconf := 'confirmacao_e_texto';
        elsif new.template_id is distinct from v_tpl then
          v_mconf := 'modelo_nao_e_o_gen_sys_optout';
        elsif new.body is not null and btrim(new.body) is distinct from v_corpo then
          -- O CORPO TEM DE SER O TEXTO FIXO. Esta é a linha que teria
          -- barrado o ataque mesmo se todo o resto tivesse falhado.
          v_mconf := 'texto_diferente_do_modelo_fixo';
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
      -- O texto é do banco, ponto. `v_corpo` foi montado a partir do
      -- GEN-SYS-OPTOUT com o {{nome}} lido de `contacts`; quem insere
      -- pode mandar o mesmo texto ou mandar nada, e nos dois casos o que
      -- fica gravado é este. Vale também para `template_params`: fora da
      -- janela de 24 h o parâmetro do template é o nome, e ele vem da
      -- mesma coluna, não do que veio no insert.
      new.body            := v_corpo;
      new.template_params := jsonb_build_array(coalesce(v_conf ->> 'nome', ''));
      new.is_first_contact := false;   -- confirmação nunca é primeiro contato
      -- Honesto: fora da janela de 24 h ela É iniciada pela empresa, e
      -- por isso CONTA nos tetos de volume. Marcar `false` como a 000200
      -- fazia era esconder do teto uma mensagem que a Meta cobra.
      new.business_initiated := not app.janela_de_24h_aberta(c.id, coalesce(new.sent_at, now()));

      -- E aqui ela entra na fila. As dispensas e as não-dispensas estão
      -- em app.pode_enviar_confirmacao_optout; a janela de horário e os
      -- tetos NÃO são conferidos AGORA, e isso é deliberado:
      -- `public.wa_optout_registrar` grava a supressão e enfileira a
      -- confirmação na MESMA transação, então uma exceção aqui abortaria
      -- o próprio opt-out — quem escreveu "SAIR" às 3h de domingo ficaria
      -- sem supressão nenhuma. Enfileirar não é enviar. Quem confere a
      -- hora é o dreno (`app.wa_proximos`), que ADIA até a janela abrir,
      -- e a reconferência do UPDATE, que recusa a entrega fora dela.
      return new;
    end if;

    -- (1) Eco do celular: registro do que já aconteceu. Entra, conta no
    --     teto, não passa por porteira. Veja E.3 da 000200.
    if new.origin = 'echo' then
      if new.author_kind = 'bot_ai' then
        raise exception 'Eco do celular é mensagem de gente: author_kind bot_ai não faz sentido aqui'
          using errcode = '23514';
      end if;
      new.business_initiated := not app.janela_de_24h_aberta(c.id, coalesce(new.sent_at, now()));
      return new;
    end if;

    -- (2) HUMAN-IN-THE-LOOP (ADR-05, RF-CON-22). Esta é a linha que faz o
    --     "nada sai sozinho" ser verdade no banco.
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
      -- O corpo enviado é o que a PESSOA aprovou, não o que a IA propôs.
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
      -- `author_kind = 'system'` que chegou até aqui é uma confirmação que
      -- o estado NÃO devia, ou que não tinha a forma dela. O motivo já foi
      -- apurado em (0): dizê-lo é melhor do que a frase genérica de antes.
      -- 42501, e não o 23514 de antes, para ficar na mesma família de
      -- "Envio recusado: <motivo>" que a tela lê em
      -- `fraseDaRecusaDoEnvio`: o que houve aqui foi uma recusa de envio,
      -- não uma violação de formato.
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
  -- UPDATE
  -- ----------------------------------------------------------------
  -- `body` só pode ir a NULL, e quem o faz é a retenção dos 12 meses
  -- (PRD §10.6). Reescrever o texto de uma mensagem já enviada seria
  -- reescrever o que a pessoa leu.
  --
  -- E `optout_confirmation` entra nesta lista, que é onde ela sempre devia
  -- ter estado: sem isso, bastava inserir uma mensagem inocente e ligar a
  -- flag no `update` seguinte para queimar o índice único da conversa e
  -- impedir que a confirmação de verdade saísse.
  if new.conversation_id is distinct from old.conversation_id
     or new.direction is distinct from old.direction
     or (new.body is distinct from old.body and new.body is not null)
     or new.draft_id is distinct from old.draft_id
     or new.optout_confirmation is distinct from old.optout_confirmation
     or (old.wa_message_id is not null and new.wa_message_id is distinct from old.wa_message_id) then
    raise exception 'Mensagem é registro do que aconteceu: conversa, sentido, corpo, rascunho, confirmação de opt-out e wamid não mudam'
      using errcode = '42501';
  end if;

  -- A RECONFERÊNCIA DA ENTREGA. Aqui está a lição do dreno: aprovado às 9h
  -- não é permissão para as 9h40.
  if old.status = 'queued'::app.msg_status and new.status = 'sent'::app.msg_status
     and new.origin = 'crm' then
    if new.optout_confirmation then
      -- A confirmação não morre de supressão (dispensa 1) nem de janela de
      -- 24 h (dispensa 2) — mas a hora ela respeita, e às 9h40 pode ser
      -- domingo. `p_com_teto => false` aqui, e por um motivo aritmético:
      -- neste ponto a própria linha JÁ está contada em
      -- `app.iniciadas_pela_empresa` (ela existe, está `queued` e é
      -- `business_initiated`), então reconferir o teto recusaria a
      -- mensagem que o próprio número já contou. Teto é forma de moldar a
      -- FILA, e quem molda a fila é o dreno.
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
end $$;
comment on function app.messages_guard() is
  'A parede da tabela messages. Desde 20260905000300 a confirmação de opt-out (RF-CON-19) deixou de ser um "return new" no topo: optout_confirmation é DERIVADA do estado (app.wa_confirmacao_de_optout) e recusada quando declarada por quem insere, o corpo é o texto fixo do GEN-SYS-OPTOUT montado pelo banco, e a exceção dispensa só a supressão e a janela de 24 h — janela de horário, domingo, feriado e tetos continuam valendo, no dreno e na entrega.';

drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before insert or update on public.messages
  for each row execute function app.messages_guard();


-- =====================================================================
-- D. A POLICY DIZ, POR ESCRITO, QUE A TELA NÃO ESCREVE ESSA COLUNA
-- =====================================================================
-- O gatilho já basta. Esta linha existe porque a policy é o primeiro
-- lugar onde alguém procura "o que a tela pode escrever", e a coluna que
-- abriu o furo não era mencionada ali. Defesa em profundidade e, mais do
-- que isso, documentação no lugar certo: quem lê a policy agora vê que
-- confirmação de opt-out não é coisa de tela.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check ((select app.can_write())
              and origin = 'crm'
              and direction = 'out'::app.msg_direction
              and author_kind in ('human', 'bot_fixed')
              and sent_by = (select auth.uid())
              -- Quem confirma opt-out é o sistema, pelo caminho
              -- public.wa_optout_registrar. A tela nunca (RF-CON-19).
              and not optout_confirmation
              and exists (select 1 from public.conversations c
                           where c.id = messages.conversation_id
                             and ((select app.sees_all())
                                  or c.assignee_id = (select auth.uid())
                                  or ((select app.role()) = 'embaixador'::app.user_role
                                      and c.organization_id is not null
                                      and (select app.org_is_mine(c.organization_id))))));


-- =====================================================================
-- E. O DRENO PARA DE REPETIR A ISENÇÃO LARGA
-- =====================================================================
-- Era: `case when msg.optout_confirmation then null else ... end` — a
-- mesma isenção total, escrita uma segunda vez. Agora a confirmação passa
-- pela porteira estreita, e o que ela recusa ("janela_domingo",
-- "teto_iniciadas_hora") já cai no ramo que ADIA. Nenhum desses motivos
-- está na lista de "morre", e é assim que tem de ser: a confirmação
-- espera a segunda-feira, não desiste dela.
create or replace function app.wa_proximos(p_qty int default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out       jsonb := '[]'::jsonb;
  v_recusados jsonb := '[]'::jsonb;
  v_motivo    text;
  v_pode      jsonb;
  m           record;
  msg         public.messages%rowtype;
  c           public.conversations%rowtype;
begin
  for m in select * from pgmq.read('wa_outbound', 120, least(greatest(coalesce(p_qty, 10), 1), 50)) loop
    select * into msg from public.messages where id = (m.message ->> 'message_id')::uuid;
    if not found or msg.status <> 'queued'::app.msg_status then
      perform pgmq.archive('wa_outbound', m.msg_id);
      continue;
    end if;
    select * into c from public.conversations where id = msg.conversation_id;

    -- ----- guardrail: o mundo muda entre a fila e a entrega -----
    v_motivo := null;
    v_pode   := null;
    if msg.optout_confirmation then
      -- Dispensa a supressão e a janela de 24 h. SÓ.
      v_pode := app.pode_enviar_confirmacao_optout(msg.conversation_id, now(), true);
    else
      v_motivo := app.wa_motivo_de_recusa(msg.organization_id, msg.contact_id, c.peer_phone_e164);
      if v_motivo is null then
        v_pode := app.pode_enviar(msg.conversation_id, msg.is_first_contact,
                                  msg.template_id is not null, now());
      end if;
    end if;

    if v_motivo is null and v_pode is not null
       and not coalesce((v_pode ->> 'pode')::boolean, false) then
      -- Janela fechada e teto estourado NÃO matam a mensagem: eles dizem
      -- "agora não". A mensagem volta para a fila com o `visibility
      -- timeout` esticado até a próxima abertura, e quem a mata é
      -- app.wa_expirar_fila, com prazo.
      if (v_pode ->> 'motivo') in ('contato_suprimido', 'numero_suprimido',
                                   'contato_apagado', 'organizacao_apagada') then
        v_motivo := v_pode ->> 'motivo';
      else
        perform pgmq.set_vt('wa_outbound', m.msg_id,
                            greatest(60, least(3600,
                              extract(epoch from coalesce((v_pode ->> 'quando')::timestamptz,
                                                          now() + interval '15 minutes') - now())::int)));
        v_recusados := v_recusados || jsonb_build_object('message_id', msg.id,
                                                         'motivo', v_pode ->> 'motivo',
                                                         'acao', 'adiado',
                                                         'quando', v_pode ->> 'quando');
        continue;
      end if;
    end if;

    if v_motivo is not null then
      update public.messages
         set status = 'failed'::app.msg_status,
             error_code = 'recusado_na_entrega',
             error_detail = v_motivo,
             failed_at = now()
       where id = msg.id;
      update public.message_drafts set status = 'descartado',
             discard_reason = 'recusado na entrega: ' || v_motivo
       where id = msg.draft_id and status in ('aprovado', 'enviado');
      perform pgmq.archive('wa_outbound', m.msg_id);
      v_recusados := v_recusados || jsonb_build_object('message_id', msg.id,
                                                       'motivo', v_motivo, 'acao', 'morto');
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'msg_id',          m.msg_id,
      'message_id',      msg.id,
      'conversation_id', msg.conversation_id,
      'business_number', c.business_number,
      'para',            c.peer_phone_e164,
      'tipo',            msg.type,
      'corpo',           msg.body,
      'template_id',     msg.template_id,
      'template_params', msg.template_params,
      'audio_asset_id',  msg.audio_asset_id);
  end loop;

  return jsonb_build_object('itens', v_out, 'recusados', v_recusados);
end $$;
comment on function app.wa_proximos(int) is
  'Lote de mensagens para o worker-wa enviar pela Cloud API (ADR-06). RECONFERE cada item no instante da entrega: o que ficou suprimido, apagado ou sem ficha MORRE; o que só está fora de janela ou no teto é ADIADO. Desde 20260905000300 a confirmação de opt-out não é mais isenta aqui — ela passa por app.pode_enviar_confirmacao_optout, que dispensa a supressão e a janela de 24 h e mantém a janela de horário, domingo, feriado e os tetos; como nenhum desses motivos mata, ela espera a janela abrir.';


-- =====================================================================
-- F. A CONFIRMAÇÃO NÃO PODE EXPIRAR POR ESPERAR A SEGUNDA-FEIRA
-- =====================================================================
-- Consequência direta de C: agora que a confirmação respeita domingo e
-- feriado, ela pode ficar legitimamente parada por mais de 12 h — um
-- "SAIR" no sábado à noite espera a janela de segunda. Com o prazo único
-- de 12 h, `app.wa_expirar_fila` a mataria calada, e quem pediu para sair
-- nunca receberia a confirmação que a LGPD e o RF-CON-19 prometem.
--
-- 96 h cobre o pior caso real: sexta à noite + sábado + domingo + feriado
-- de segunda, com a janela abrindo na terça de manhã.
drop function if exists app.wa_expirar_fila(int);
create or replace function app.wa_expirar_fila(p_horas int default 12,
                                               p_horas_confirmacao int default 96)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
  k int;
begin
  update public.messages
     set status = 'failed'::app.msg_status,
         error_code = 'expirou_na_fila',
         error_detail = 'esperou mais de ' || p_horas || ' h por janela, teto ou worker desligado',
         failed_at = now()
   where status = 'queued'::app.msg_status
     and not optout_confirmation
     and created_at < now() - make_interval(hours => greatest(coalesce(p_horas, 12), 1));
  get diagnostics n = row_count;

  update public.messages
     set status = 'failed'::app.msg_status,
         error_code = 'expirou_na_fila',
         error_detail = 'confirmação de opt-out esperou mais de ' || p_horas_confirmacao ||
                        ' h por janela de horário: veja se o worker-wa está ligado (RF-CON-19)',
         failed_at = now()
   where status = 'queued'::app.msg_status
     and optout_confirmation
     and created_at < now() - make_interval(hours => greatest(coalesce(p_horas_confirmacao, 96), 1));
  get diagnostics k = row_count;

  return jsonb_build_object('expiradas', n + k, 'confirmacoes_expiradas', k);
end $$;
comment on function app.wa_expirar_fila(int, int) is
  'Mata o que apodreceu na fila de saída. Dois prazos: 12 h para mensagem comum e 96 h para a confirmação de opt-out — que desde 20260905000300 respeita domingo e feriado e por isso pode esperar legitimamente de sexta à noite até terça de manhã. Prazo único aqui mataria calada a confirmação que o RF-CON-19 promete.';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- `cron.schedule` com o mesmo nome reescreve o comando do job que já
    -- existe: é o mesmo lugar, com os dois prazos agora.
    perform cron.schedule('wa_expirar_fila', '7 * * * *',
                          $cron$select app.wa_expirar_fila(12, 96)$cron$);
  end if;
end $$;


-- =====================================================================
-- G. `public.wa_optout_registrar` PERGUNTA ANTES DE INSERIR
-- =====================================================================
-- Duas mudanças, e nenhuma delas muda o contrato de fora:
--
--   · o corpo deixa de ser montado aqui e passa a vir de
--     `app.wa_confirmacao_de_optout` — o MESMO texto que o gatilho vai
--     exigir. Duas montagens do mesmo texto em dois arquivos é como um
--     "corpo diferente do modelo fixo" nasce por distração.
--   · a segunda chamada é respondida por ESTADO ("confirmacao_ja_enviada")
--     em vez de por exceção de índice único capturada. O índice fica —
--     ele é quem segura DUAS transações simultâneas, que nenhuma pergunta
--     de estado segura —, mas deixa de ser o caminho normal.
create or replace function public.wa_optout_registrar(p_conversation_id uuid,
                                                      p_evidencia       text default null,
                                                      p_confirmar       boolean default true)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c            public.conversations%rowtype;
  v_opt        jsonb;
  v_registrado boolean := false;
  v_motivo     text;
  v_conf       jsonb;
  v_msg        uuid;
  v_confirmada boolean := false;
  v_pq         text;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;

  -- 1 · A supressão PRIMEIRO, sempre. Antes da confirmação, antes de
  --     qualquer atualização de conversa, antes de tudo. E é ela que faz
  --     `app.wa_confirmacao_de_optout` passar a dizer "devida": o estado
  --     tem de existir antes de a confirmação ser possível.
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

  -- 4 · A confirmação de uma linha (RF-CON-19). Nem o texto nem a decisão
  --     são desta função: ela pergunta, e o banco responde.
  if p_confirmar then
    v_conf := app.wa_confirmacao_de_optout(c.id);
    v_pq   := v_conf ->> 'motivo';
    if coalesce((v_conf ->> 'devida')::boolean, false) then
      begin
        insert into public.messages (conversation_id, direction, type, status, body,
                                     author_kind, origin, template_id)
        values (c.id, 'out'::app.msg_direction, 'text'::app.msg_type,
                'queued'::app.msg_status, v_conf ->> 'corpo',
                'system', 'crm', (v_conf ->> 'template_id')::int)
        returning id into v_msg;
        v_confirmada := true;
        perform app.wa_enfileirar_envio(v_msg);
      exception when unique_violation then
        -- A corrida: duas transações perguntaram junto e as duas ouviram
        -- "devida". O índice único por conversa é quem decide.
        v_confirmada := false;
        v_pq := 'confirmacao_ja_enviada';
      end;
    end if;
  end if;

  return jsonb_build_object('ok', true,
                            'registrado', v_registrado,
                            'motivo', coalesce(v_motivo, 'registrado'),
                            'confirmacao_enfileirada', v_confirmada,
                            'confirmacao_motivo', case when v_confirmada then null else v_pq end,
                            'message_id', v_msg);
end $$;
comment on function public.wa_optout_registrar(uuid, text, boolean) is
  'Opt-out por regra no WhatsApp (RF-CON-19, guardrail do CLAUDE.md), em uma transação: supressão PRIMEIRO — app.registrar_optout_de_contato quando há ficha, e sempre também o número em app.suppress —, robô calado e a confirmação de UMA linha enfileirada. Desde 20260905000300 ela não monta mais o texto nem declara optout_confirmation: pergunta a app.wa_confirmacao_de_optout, que devolve se é devida e qual é o texto fixo; o gatilho de messages deriva a coluna do mesmo estado. Chamar duas vezes devolve confirmacao_motivo = confirmacao_ja_enviada.';


-- =====================================================================
-- H. GRANTS — nada disto é para a tela
-- =====================================================================
revoke all on function app.wa_confirmacao_de_optout(uuid)                             from public, anon, authenticated;
revoke all on function app.pode_enviar_confirmacao_optout(uuid, timestamptz, boolean) from public, anon, authenticated;
revoke all on function app.wa_expirar_fila(int, int)                                  from public, anon, authenticated;
grant execute on function app.wa_confirmacao_de_optout(uuid)                             to service_role;
grant execute on function app.pode_enviar_confirmacao_optout(uuid, timestamptz, boolean) to service_role;
grant execute on function app.wa_expirar_fila(int, int)                                  to service_role;

revoke all on function public.wa_optout_registrar(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.wa_optout_registrar(uuid, text, boolean) to service_role;

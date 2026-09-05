-- =====================================================================
-- TRIADE — 20260905000400 — OS TRÊS RESÍDUOS DA CONFIRMAÇÃO DE OPT-OUT
-- (RF-CON-19, RF-CON-10, RF-CON-11, RF-CON-22; ADR-05, ADR-06)
--
-- A 20260905000300 tirou a confirmação do RF-CON-19 da porta de serviço:
-- `optout_confirmation` virou DERIVADA do estado, o corpo passou a ser o
-- texto do GEN-SYS-OPTOUT montado pelo banco, e a dispensa encolheu para
-- duas coisas (supressão e janela de 24 h). A conferência adversarial
-- seguinte achou três buracos que sobraram, e todos os três têm a mesma
-- raiz: a migração olhou para UMA COLUNA (`optout_confirmation`) quando
-- devia ter olhado para O CAMINHO — do estado até o que a Graph API
-- recebe.
--
-- ---------------------------------------------------------------------
-- D1 · O "TEXTO FIXO" TINHA TEXTO LIVRE DENTRO
-- ---------------------------------------------------------------------
-- `app.wa_confirmacao_de_optout` montava o corpo com `{{nome}}` vindo de
-- `contacts.first_name`. `contacts` só exige `length(trim(full_name)) > 0`
-- e o gatilho de 20260904000300 deriva
-- `first_name := split_part(full_name, ' ', 1)` — uma URL não tem espaço,
-- então atravessa inteira. Com o nome colhido pelo Radar numa fonte
-- pública, sem nenhum usuário do CRM envolvido, o banco OBRIGAVA a sair:
--
--   Entendido, Marcos.SUA-CONTA-SERA-CANCELADA-ACESSE-http://mal.invalido/x.
--   Não vou mais te mandar mensagem. Obrigada pelo retorno e sucesso nos eventos.
--
-- para um número SUPRIMIDO, sem rascunho, sem `reviewed_by`, sem ninguém
-- ler. E isso derrubava a justificativa que a própria 000300 escreveu para
-- dispensar o ADR-05 — "não há o que aprovar em uma mensagem que só pode
-- ter um conteúdo possível": com `{{nome}}` ela tem uma FORMA possível,
-- não um CONTEÚDO possível.
--
-- O QUE FOI DECIDIDO, E POR QUÊ: O VOCATIVO SAI.
--
-- A alternativa era um vocativo seguro por construção — primeiro token,
-- só letras (com acento, apóstrofo e hífen), 2 a 20 caracteres, caindo no
-- texto sem vocativo quando não passasse. Ela foi escrita e MEDIDA contra
-- 232 nomes reais de fornecedores de Natal (lista-semente do R09 +
-- fixture da planilha-ponte; `organizations` e `contacts` estão vazias no
-- banco local):
--
--   232 nomes · 223 mantêm o vocativo (96,1%) · 9 perdem (3,9%)
--   e os 9 são todos razão social, não gente: "Cerimoniais.com", "D&R",
--   "i9", "L & D", "O Chef Eventos", "Parnamirim: Art's", "Z2", "Motta's;",
--   "3652 Natal". Nenhum primeiro nome de pessoa se perde:
--   Josy→Josy · Anne Vieira→Anne · José Carlos→José · Jôsy Buffet→Jôsy
--   Jô→Jô · D'Ávila→D'Ávila · Ana-Maria→Ana-Maria
--   e o ataque cai: Marcos.SUA-CONTA-…http://…→(sem vocativo).
--
-- Ou seja: a regra segura é BARATA EM NOMES. Ela não é barata em
-- MECANISMO, e foi por isso que perdeu:
--
--   1. Fora da janela de 24 h o que vai no fio não é o corpo, é o TEMPLATE
--      da Meta com `template_params`. Vocativo = um parâmetro = mais uma
--      coluna mutável no fio da única mensagem que ninguém lê antes de
--      sair (ver D2, que é exatamente esse defeito).
--   2. A Meta recusa parâmetro vazio. Nos ~4% sem vocativo o parâmetro
--      seria `""` e a confirmação morreria na Graph API — para servir os
--      dois casos seriam DOIS templates aprovados na Meta, dois textos,
--      duas aprovações e duas maneiras de errar, na mensagem que sai sem
--      revisão humana.
--   3. Sem parâmetro, a frase da 000300 deixa de ser retórica e vira
--      verdade verificável: a confirmação passa a ter UM conteúdo
--      possível, e é isso que substitui a aprovação humana do ADR-05.
--
-- O que se compra com o vocativo é uma palavra de calor numa despedida
-- para quem acabou de pedir silêncio. O que se paga é uma variável no
-- único texto do sistema que ninguém revisa. Não compensa.
--
-- DECISÃO HUMANA PENDENTE (Bárbara / Heloísa): o R08 §2.7 escreve o
-- GEN-SYS-OPTOUT com "[Nome]". Esta migração NÃO reescreve `seed.sql`
-- (o corpo semeado continua com `{{nome}}`): quem tira o vocativo é a
-- DERIVAÇÃO, em `app.corpo_fixo_de_optout`, que funciona com ou sem o
-- placeholder e sobrevive a `supabase db reset`. Se Bárbara quiser o nome
-- de volta, o caminho é o vocativo seguro medido acima MAIS um segundo
-- template aprovado na Meta para o caso sem nome — e aí volta-se a
-- discutir o ADR-05. A pendência está em `public.wa_saude()`.
--
-- ---------------------------------------------------------------------
-- D2 · TEMPLATE MUTÁVEL NUMA CONFIRMAÇÃO JÁ ENFILEIRADA
-- ---------------------------------------------------------------------
-- A lista de imutáveis do UPDATE ganhou `optout_confirmation` e esqueceu a
-- vizinhança. Como gestor, sobre a confirmação `queued`:
--
--   update public.messages set template_id = <GEN-SYS-QUEM-SOMOS>,
--          template_params = '["INJETADO PELO GESTOR"]' where id = …;
--   -- ENTROU (1 linha)
--
-- e o worker mandaria, ao número SUPRIMIDO, o modelo GEN-SYS-QUEM-SOMOS
-- com o parâmetro do gestor. A confirmação carrega a dispensa da
-- supressão; trocado o modelo, a dispensa vai junto.
--
-- E a varredura da vizinhança achou um pior, que nem estava em `messages`:
--
--   update public.conversations set peer_phone_e164 = '+5584911112222'
--    where id = <conversa com confirmação queued>;   -- ENTROU (1 linha)
--
-- O DESTINO. Um gestor podia redirecionar para outro número a única
-- mensagem que atravessa a lista de supressão.
--
-- A REGRA, escrita como regra e não como lista de exceções: TUDO O QUE O
-- WORKER LÊ PARA MONTAR A CHAMADA DA GRAPH API É IMUTÁVEL DEPOIS DO
-- INSERT. O payload de `app.wa_proximos` é a definição de "o fio":
--
--   business_number ← conversations.business_number   (agora imutável)
--   para            ← conversations.peer_phone_e164   (agora imutável)
--   tipo            ← messages.type                   (agora imutável)
--   corpo           ← messages.body                   (já era, só vai a NULL)
--   template_id     ← messages.template_id            (agora imutável)
--   template_params ← messages.template_params        (agora imutável)
--   audio_asset_id  ← messages.audio_asset_id         (agora imutável)
--
-- mais o que decide SE vai e sob QUAIS regras: `origin` (que porteia a
-- reconferência da entrega — `and new.origin = 'crm'`), `author_kind`
-- (que escolhe o ramo do gatilho), `organization_id`/`contact_id` (o alvo
-- de `app.wa_motivo_de_recusa`) e `is_first_contact`/`business_initiated`
-- (os tetos do RF-CON-10).
--
-- Vale para TODA mensagem, não só para a confirmação: mensagem é registro
-- do que aconteceu. Nenhum caminho legítimo mexia nesses campos depois do
-- insert — `app.wa_sucesso`, `app.wa_falha`, `public.wa_status_registrar`,
-- `app.wa_expirar_fila`, `public.wa_midia_registrar` e a retenção do
-- PRD §10.6 tocam em status, wamid, custo, erro, mídia e `body → NULL`.
--
-- ---------------------------------------------------------------------
-- D3 · CONFIRMAÇÃO QUE FALHA NUNCA MAIS É TENTADA
-- ---------------------------------------------------------------------
-- `app.wa_confirmacao_de_optout` passo 2 contava
-- `exists (… optout_confirmation)` SEM FILTRAR STATUS: uma confirmação
-- `failed` respondia "confirmacao_ja_enviada" para sempre. E hoje
-- `message_templates` tem 0 de 126 com `meta_status = 'approved'`, então
-- TODA confirmação fora da janela de 24 h morre em
-- `public.wa_saida_proximos` com `sem_modelo_aprovado`. Somando os dois:
-- quem liga pedindo para sair três dias depois da última mensagem NUNCA
-- recebe a confirmação, e o sistema jamais tenta de novo — que é
-- literalmente "pediu para sair e ficou sem resposta".
--
-- MORRER CALADO OU DEIXAR REGISTRO? Registro, e em três camadas:
--
--   1. `failed` deixa de contar como "já enviada" — e o índice único da
--      conversa passa a valer só para confirmação VIVA. A dívida reabre.
--   2. A confirmação que não PODE sair não é mais criada para morrer:
--      `app.wa_confirmacao_de_optout` devolve `sem_modelo_aprovado_na_meta`
--      quando a janela está fechada e a Meta não aprovou o GEN-SYS-OPTOUT.
--      Não se queima uma linha, uma vaga na fila e um `failed` por uma
--      mensagem que já se sabe que a Graph API recusa. Mas o estado passa
--      a dizer `devendo = true`, e é essa a diferença entre morrer calado
--      e ficar devendo por escrito.
--   3. `app.wa_confirmacoes_reenfileirar` (pg_cron, de 10 em 10 min)
--      reenfileira sozinha toda dívida que voltar a ser possível — a
--      janela reabriu porque a pessoa escreveu, ou a Meta aprovou o
--      GEN-SYS-OPTOUT. Ninguém precisa lembrar.
--
-- E A AÇÃO HUMANA FICA VISÍVEL, não num comentário:
--   · `public.wa_confirmacoes_devidas` — a lista, linha a linha, com desde
--     quando e por quê, sujeita à mesma visibilidade do inbox.
--   · `public.wa_saude()` — o painel do WhatsApp, com o campo
--     `acao_humana`, que hoje diz: aprovar o GEN-SYS-OPTOUT no Meta
--     Business (Luiz/Matheus), sem o que ninguém que peça para sair fora
--     da janela de 24 h recebe resposta.
--   · o worker-wa grita esse mesmo campo no log, a cada 15 min de ociosidade.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- =====================================================================
-- A. D1 — O TEXTO FIXO PASSA A SER FIXO DE VERDADE
-- =====================================================================
-- Uma função só, `immutable`, para poder ser medida sozinha no pgTAP e
-- para que exista UM lugar onde o texto da confirmação nasce.
--
-- Ela faz duas coisas e nenhuma a mais:
--   1. TIRA O VOCATIVO. `{{nome}}` some com a pontuação que o acompanha
--      ("Entendido, {{nome}}. Não…" → "Entendido. Não…"), e o caso
--      "Tranquilo, {{nome}}, obrigada" perde só uma vírgula.
--   2. FALHA FECHADA. Se sobrar QUALQUER `{{…}}` depois disso, devolve
--      NULL. Uma variável não resolvida é texto livre esperando alguém
--      preencher — e o chamador tem de tratar isso como "não há
--      confirmação para mandar", nunca como "manda assim mesmo".
create or replace function app.corpo_fixo_de_optout(p_body text)
returns text
language sql
immutable
set search_path = ''
as $$
  with sem_vocativo as (
    select btrim(regexp_replace(
             regexp_replace(
               -- ", {{nome}}," entre duas vírgulas vira uma vírgula só;
               -- nos outros casos a vírgula vizinha sai junto com o nome.
               regexp_replace(coalesce(p_body, ''),
                              '\s*,\s*\{\{\s*nome\s*\}\}\s*,\s*', ', ', 'g'),
               '\s*,?\s*\{\{\s*nome\s*\}\}\s*,?\s*', ' ', 'g'),
             '\s+', ' ', 'g')) as t
  )
  select case when t = '' or t like '%{{%' then null
              else btrim(regexp_replace(t, '\s+([.,;:!?])', '\1', 'g')) end
    from sem_vocativo
$$;
comment on function app.corpo_fixo_de_optout(text) is
  'O texto da confirmação de opt-out (RF-CON-19) a partir do corpo do GEN-SYS-OPTOUT: tira o vocativo {{nome}} com a pontuação junto e devolve NULL se sobrar qualquer outra variável. O vocativo saiu em 20260905000400: era a única fatia de texto livre — de origem não confiável, vinda de contacts.first_name derivado do full_name colhido pelo Radar — na única mensagem do sistema que sai sem aprovação humana. Sem ele a confirmação tem UM conteúdo possível, que é o que substitui o ADR-05 aqui.';


-- =====================================================================
-- B. D1 + D3 — O ESTADO DECIDE, E AGORA DISTINGUE "JÁ PAGUEI" DE "DEVO"
-- =====================================================================
-- Muda em relação à 000300:
--   · o corpo vem de `app.corpo_fixo_de_optout` (sem vocativo, sem
--     variável), e `nome` sai do retorno — não há mais parâmetro nenhum;
--   · "já enviada" para de contar confirmação `failed` (D3);
--   · novo motivo `sem_modelo_aprovado_na_meta`: fora da janela de 24 h,
--     sem o GEN-SYS-OPTOUT aprovado pela Meta a confirmação não tem como
--     sair (R04 §2.1) — e criar a linha só para `wa_saida_proximos` matá-la
--     não é registro, é lixo;
--   · novo campo `devendo`: TRUE quando existe pedido de opt-out
--     registrado e nenhuma confirmação viva, INDEPENDENTE de poder sair
--     agora. É a diferença entre morrer calado e ficar devendo por escrito.
--
-- `devida` continua sendo "pode nascer agora"; `devendo` é "o sistema deve
-- uma resposta a quem pediu para sair". Só `devida` autoriza o insert.
create or replace function app.wa_confirmacao_de_optout(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.conversations%rowtype;
  t        public.message_templates%rowtype;
  v_corpo  text;
  v_pedido boolean;
  v_modelo jsonb;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('devida', false, 'devendo', false, 'motivo', 'conversa_inexistente');
  end if;

  -- 1 · Alguém pediu para sair? Estado GRAVADO, nas três formas, nunca
  --     intenção de quem chama.
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
    return jsonb_build_object('devida', false, 'devendo', false, 'motivo', 'sem_pedido_de_optout');
  end if;

  -- 2 · E ainda não foi confirmado — POR UMA CONFIRMAÇÃO VIVA (D3).
  --     `failed` é justamente a que NÃO chegou: contá-la como "já enviada"
  --     é responder "já respondi" a quem nunca foi respondido.
  if exists (select 1 from public.messages m
              where m.conversation_id = c.id
                and m.optout_confirmation
                and m.status <> 'failed'::app.msg_status) then
    return jsonb_build_object('devida', false, 'devendo', false, 'motivo', 'confirmacao_ja_enviada');
  end if;

  -- Daqui para baixo o sistema DEVE a confirmação. O que vier a seguir
  -- decide apenas se ela pode nascer AGORA.
  select * into t from public.message_templates
   where template_code = 'GEN-SYS-OPTOUT' and is_active limit 1;
  if not found then
    return jsonb_build_object('devida', false, 'devendo', true,
                              'motivo', 'sem_modelo_gen_sys_optout');
  end if;

  -- 3 · O texto fixo, sem vocativo e sem nenhuma variável (D1).
  v_corpo := app.corpo_fixo_de_optout(t.body);
  if v_corpo is null then
    -- Alguém pôs uma variável nova no GEN-SYS-OPTOUT. Falha fechada: a
    -- confirmação para de sair até o modelo voltar a ser um texto só.
    return jsonb_build_object('devida', false, 'devendo', true,
                              'motivo', 'modelo_com_variavel_nao_suportada');
  end if;

  -- 4 · Fora da janela de 24 h só sai template APROVADO PELA META
  --     (R04 §2.1). Sem aprovação a linha morreria em
  --     public.wa_saida_proximos com `sem_modelo_aprovado`; melhor não
  --     nascer e ficar devendo por escrito, que é o que `devendo` diz.
  if not app.janela_de_24h_aberta(c.id, now()) then
    v_modelo := app.wa_modelo_da_meta(t.id);
    if not coalesce((v_modelo ->> 'aprovado')::boolean, false) then
      return jsonb_build_object('devida', false, 'devendo', true,
                                'motivo', 'sem_modelo_aprovado_na_meta',
                                'situacao_na_meta', v_modelo ->> 'situacao');
    end if;
  end if;

  return jsonb_build_object('devida', true, 'devendo', true, 'motivo', null,
                            'template_id', t.id, 'corpo', v_corpo);
end $$;
comment on function app.wa_confirmacao_de_optout(uuid) is
  'O ESTADO decide se esta conversa deve a confirmação de opt-out do RF-CON-19: existe pedido de opt-out registrado (suppression_list do número, supressão da ficha/pessoa, ou consent_events contact_optout) E não há confirmação VIVA (desde 20260905000400 uma confirmação failed não conta: era ela que fazia "pediu para sair e ficou sem resposta"). Devolve o texto FIXO do GEN-SYS-OPTOUT montado por app.corpo_fixo_de_optout — sem vocativo e sem nenhuma variável, portanto sem parâmetro de template. "devida" é "pode nascer agora"; "devendo" é "o sistema deve uma resposta", e continua verdadeiro quando o motivo é sem_modelo_gen_sys_optout, modelo_com_variavel_nao_suportada ou sem_modelo_aprovado_na_meta. Motivos: conversa_inexistente, sem_pedido_de_optout, confirmacao_ja_enviada, sem_modelo_gen_sys_optout, modelo_com_variavel_nao_suportada, sem_modelo_aprovado_na_meta.';


-- =====================================================================
-- C. D3 — "UMA SÓ" PASSA A SIGNIFICAR "UMA VIVA"
-- =====================================================================
-- O índice único da 000200 tratava qualquer confirmação, viva ou morta,
-- como a confirmação daquela conversa. Era a segunda fechadura do mesmo
-- erro do passo 2: uma tentativa que falhou trancava a conversa para
-- sempre. Agora ele guarda o que devia guardar — que não saiam DUAS
-- confirmações vivas —, e continua sendo a fechadura da corrida entre
-- duas transações simultâneas.
drop index if exists public.messages_uma_confirmacao_de_optout;
create unique index if not exists messages_uma_confirmacao_de_optout
  on public.messages (conversation_id)
  where optout_confirmation and status <> 'failed'::app.msg_status;
comment on index public.messages_uma_confirmacao_de_optout is
  'Uma confirmação de opt-out VIVA por conversa (RF-CON-19). Desde 20260905000400 a que falhou não ocupa o lugar: se ela não chegou, a dívida continua e app.wa_confirmacoes_reenfileirar tenta de novo.';


-- =====================================================================
-- D. D1 + D2 — O GATILHO DE `messages`
-- =====================================================================
-- Duas mudanças, e nada mais:
--   · (0) a confirmação não tem mais parâmetro: `template_params` é `[]`,
--     e declará-la com parâmetro é recusado por nome
--     (`confirmacao_nao_tem_parametro`);
--   · UPDATE: a lista de imutáveis deixa de ser uma lista de colunas
--     lembradas uma a uma e passa a ser O CAMINHO ATÉ O FIO (D2).
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
     or new.organization_id is distinct from old.organization_id
     or new.contact_id    is distinct from old.contact_id
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
end $$;
comment on function app.messages_guard() is
  'A parede da tabela messages. optout_confirmation é DERIVADA do estado (app.wa_confirmacao_de_optout) e recusada quando declarada por quem insere; o corpo é o texto fixo do GEN-SYS-OPTOUT, sem vocativo e sem parâmetro desde 20260905000400; a exceção dispensa só a supressão e a janela de 24 h. E no UPDATE a lista de imutáveis deixou de ser uma lista de colunas para ser O CAMINHO ATÉ O FIO: tudo o que o worker lê para montar a chamada da Graph API (tipo, corpo, modelo, parâmetros, áudio) e tudo o que decide como ela sai (origem, autoria, ficha, primeiro contato, iniciada pela empresa) é imutável depois do insert.';

drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before insert or update on public.messages
  for each row execute function app.messages_guard();


-- =====================================================================
-- E. D2 — O DESTINO TAMBÉM É O FIO
-- =====================================================================
-- O pior caso da varredura não estava em `messages`: `para` e
-- `business_number` do payload de `app.wa_proximos` vêm de
-- `conversations`, e a policy `conversations_update` deixa qualquer gestor
-- (ou o responsável pela conversa) reescrevê-los. Com uma confirmação de
-- opt-out `queued`, isso redirecionava para outro número a única mensagem
-- do sistema que atravessa a lista de supressão.
--
-- Os três campos são a IDENTIDADE do fio — a chave única
-- (channel, business_number, peer_phone_e164) já dizia isso, mas chave
-- única impede colisão, não troca. Nenhum caminho legítimo os altera:
-- `public.wa_entrada_registrar` faz `on conflict … do update` nos campos
-- de estado (última entrada, janela, contadores), nunca na chave.
create or replace function app.conversations_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dono uuid;
begin
  new.peer_phone_e164 := coalesce(app.normalize_phone_br(new.peer_phone_e164), new.peer_phone_e164);
  new.business_number := coalesce(app.normalize_phone_br(new.business_number), new.business_number);

  -- RF-CON-04: "mensagem não pode cair num grupo onde ninguém vê".
  if new.assignee_id is null then
    select o.owner_id into v_dono
      from public.organizations o where o.id = new.organization_id and o.owner_id is not null;
    if v_dono is null then
      select nullif(s.value ->> 'profile_id', '')::uuid into v_dono
        from public.app_settings s where s.key = 'inbox.responsavel_padrao';
    end if;
    if v_dono is not null and not exists (select 1 from public.profiles p where p.id = v_dono and p.is_active) then
      v_dono := null;
    end if;
    if v_dono is null then
      select p.id into v_dono
        from public.profiles p
       where p.is_active and p.role in ('admin'::app.user_role, 'gestor'::app.user_role,
                                        'sdr'::app.user_role)
       order by case p.role when 'admin'::app.user_role then 0
                            when 'gestor'::app.user_role then 1 else 2 end, p.created_at
       limit 1;
    end if;
    if v_dono is null then
      raise exception 'Conversa sem dono é impossível (RF-CON-04) e não há ninguém ativo para assumir esta'
        using errcode = '23502';
    end if;
    new.assignee_id := v_dono;
  end if;

  -- A janela é consequência de a pessoa ter escrito, nunca um campo que
  -- alguém estende. Recalculada em todo insert e todo update.
  new.window_expires_at := new.last_inbound_at + interval '24 hours';

  if tg_op = 'UPDATE' then
    -- QUEM É O FIO NÃO MUDA (D2 de 20260905000400). O canal, o número da
    -- empresa e o número da pessoa são o destino do que já está enfileirado.
    if new.channel is distinct from old.channel
       or new.business_number is distinct from old.business_number
       or new.peer_phone_e164 is distinct from old.peer_phone_e164 then
      raise exception 'A conversa é o fio com uma pessoa: canal, número da empresa e número do contato não mudam — mensagem enfileirada já tem esse destino (RF-CON-19)'
        using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
comment on function app.conversations_before_write() is
  'Normaliza os números, garante dono (RF-CON-04) e recalcula a janela de 24 h a partir da última entrada. Desde 20260905000400 também tranca a identidade do fio: canal, business_number e peer_phone_e164 não mudam no UPDATE — eram o destino mutável de mensagens já enfileiradas, inclusive da confirmação de opt-out, que é a única que atravessa a lista de supressão.';

drop trigger if exists conversations_before_write on public.conversations;
create trigger conversations_before_write before insert or update on public.conversations
  for each row execute function app.conversations_before_write();


-- =====================================================================
-- F. D1 — `public.wa_optout_registrar` deixa de mandar o nome
-- =====================================================================
-- O insert não escreve mais `template_params` (o gatilho força `[]`), e o
-- retorno ganha `confirmacao_devendo`: a tela precisa saber a diferença
-- entre "já respondi" e "não consegui responder".
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

  -- 1 · A supressão PRIMEIRO, sempre — e é ela que faz
  --     `app.wa_confirmacao_de_optout` passar a dizer "devida".
  if c.organization_id is not null or c.contact_id is not null then
    v_opt := app.registrar_optout_de_contato(c.organization_id, c.contact_id,
                                             coalesce(nullif(trim(coalesce(p_evidencia, '')), ''),
                                                      'Pediu para não receber mais mensagens no WhatsApp.'),
                                             'whatsapp'::app.channel);
    v_registrado := coalesce((v_opt ->> 'registrado')::boolean, false);
    v_motivo     := v_opt ->> 'motivo';
  end if;

  -- 2 · O número, com ficha ou sem.
  perform app.suppress('phone', c.peer_phone_e164,
                       coalesce(nullif(trim(coalesce(p_evidencia, '')), ''),
                                'Opt-out por regra no WhatsApp (RF-CON-19).'),
                       'whatsapp'::app.channel, null);
  if not v_registrado then
    v_registrado := true;
    v_motivo := coalesce(v_motivo, 'numero_suprimido_sem_ficha');
  end if;

  -- 3 · O robô cala nesta conversa.
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
                            'confirmacao_devendo',
                              coalesce((v_conf ->> 'devendo')::boolean, false) and not v_confirmada,
                            'message_id', v_msg);
end $$;
comment on function public.wa_optout_registrar(uuid, text, boolean) is
  'Opt-out por regra no WhatsApp (RF-CON-19, guardrail do CLAUDE.md), em uma transação: supressão PRIMEIRO, robô calado e a confirmação de UMA linha enfileirada. Não monta o texto nem declara optout_confirmation: pergunta a app.wa_confirmacao_de_optout. Desde 20260905000400 devolve também confirmacao_devendo = true quando o sistema deve a resposta e não conseguiu mandá-la agora (sem modelo aprovado na Meta, por exemplo) — a dívida aparece em public.wa_confirmacoes_devidas e é reenfileirada sozinha por app.wa_confirmacoes_reenfileirar.';


-- =====================================================================
-- G. D3 — A DÍVIDA FICA VISÍVEL, LINHA A LINHA
-- =====================================================================
-- `security_invoker = false` com o filtro de linhas escrito à mão, pelo
-- mesmo motivo das views de 20260904000500: `app.wa_confirmacao_de_optout`
-- é `security definer` e revogada de `authenticated` — e tem de continuar
-- sendo. A view empresta a resposta dela sob a MESMA visibilidade da
-- policy `conversations_select`.
--
-- Sem telefone e sem o texto: a lista responde "a quem devemos e desde
-- quando", não "quem pediu para sair" com o contato ao lado.
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
  'A quem o sistema ainda deve a confirmação de opt-out do RF-CON-19: pedido registrado, nenhuma confirmação viva. "motivo" diz por que ela não saiu (sem_modelo_aprovado_na_meta é o caso de hoje, com 0 de 126 modelos aprovados pela Meta) e "pode_sair_agora" diz se app.wa_confirmacoes_reenfileirar vai resolvê-la na próxima passada. Sem telefone e sem texto: a pergunta aqui é "a quem devemos e desde quando".';
revoke all on public.wa_confirmacoes_devidas from public, anon;
grant select on public.wa_confirmacoes_devidas to authenticated, service_role;


-- =====================================================================
-- H. D3 — E A DÍVIDA É PAGA SOZINHA QUANDO VOLTAR A SER POSSÍVEL
-- =====================================================================
-- Sem isto o conserto do passo 2 seria só honestidade contábil: o banco
-- passaria a admitir que deve e continuaria sem pagar. A regra é estreita
-- de propósito — só insere o que `app.wa_confirmacao_de_optout` disser
-- `devida`, que é a mesma pergunta que o gatilho vai refazer. Enquanto o
-- GEN-SYS-OPTOUT não estiver aprovado na Meta e a janela estiver fechada,
-- ela não cria nada: não se enfileira o que já se sabe que a Graph API
-- recusa. Quando a aprovação chegar (ou quando a pessoa escrever de novo,
-- reabrindo a janela), a próxima passada manda.
create or replace function app.wa_confirmacoes_reenfileirar(p_qty int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         record;
  v_conf    jsonb;
  v_msg     uuid;
  v_feitas  int := 0;
  v_devendo int := 0;
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

  return jsonb_build_object('devendo', v_devendo, 'reenfileiradas', v_feitas);
end $$;
comment on function app.wa_confirmacoes_reenfileirar(int) is
  'Paga a dívida do RF-CON-19 quando ela volta a ser pagável: para cada conversa que deve a confirmação de opt-out e cujo estado agora diz "devida" (janela de 24 h reaberta, ou GEN-SYS-OPTOUT aprovado na Meta), insere e enfileira a confirmação. Antes de 20260905000400 uma confirmação que falhava nunca era tentada de novo — e como nenhum modelo está aprovado na Meta, toda confirmação fora da janela falhava: quem pedia para sair três dias depois da última mensagem nunca era respondido.';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('wa_confirmacoes_reenfileirar', '*/10 * * * *',
                          $cron$select app.wa_confirmacoes_reenfileirar(50)$cron$);
  end if;
end $$;


-- =====================================================================
-- I. D3 — O PAINEL DO WHATSAPP, COM A AÇÃO HUMANA POR ESCRITO
-- =====================================================================
-- `public.esteira_saude()` é o painel do RADAR e diz, no próprio comentário,
-- que as filas do WhatsApp ficam de fora de propósito — "painel que mostra o
-- que não é dele é painel que ninguém confere". Então este é o do WhatsApp.
--
-- `acao_humana` é o campo que existe para não deixar a pendência num
-- comentário de migração: enquanto o GEN-SYS-OPTOUT não estiver aprovado no
-- Meta Business, ele diz isso com nome, motivo e quantas pessoas estão
-- esperando. O worker-wa repete a mesma frase no log (saida.ts).
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
    'workers', v_workers);
end $$;
comment on function public.wa_saude() is
  'Painel do WhatsApp (o do Radar é public.esteira_saude, e cada um mostra só o que é seu). O primeiro campo é acao_humana: o que só uma pessoa pode destravar, com quem, por quê e quanta gente está esperando. Hoje ele diz que o GEN-SYS-OPTOUT não está aprovado no Meta Business — e enquanto não estiver, ninguém que peça para sair fora da janela de 24 h recebe a confirmação do RF-CON-19.';


-- =====================================================================
-- J. GRANTS — nada disto é para anon, e quase nada é para a tela
-- =====================================================================
revoke all on function app.corpo_fixo_de_optout(text)            from public, anon, authenticated;
revoke all on function app.wa_confirmacao_de_optout(uuid)        from public, anon, authenticated;
revoke all on function app.wa_confirmacoes_reenfileirar(int)     from public, anon, authenticated;
grant execute on function app.corpo_fixo_de_optout(text)         to service_role;
grant execute on function app.wa_confirmacao_de_optout(uuid)     to service_role;
grant execute on function app.wa_confirmacoes_reenfileirar(int)  to service_role;

revoke all on function public.wa_optout_registrar(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.wa_optout_registrar(uuid, text, boolean) to service_role;

revoke all on function public.wa_saude() from public, anon;
grant execute on function public.wa_saude() to authenticated, service_role;

-- =====================================================================
-- A introdução só fala dentro da janela de 24 h
-- =====================================================================
-- O QUE ESTAVA ERRADO. A 20261002090000 promete, no próprio cabeçalho, que a
-- introdução sai "dentro da janela de 24 h" — e não confere isso em lugar
-- nenhum. A promessa se apoiava num raciocínio que quase sempre vale: o gatilho
-- só dispara com mensagem RECEBIDA, e mensagem recebida abre a janela.
--
-- "Quase sempre" não é sempre. `app.messages_after_write` grava
-- `last_inbound_at = new.created_at`, e `public.wa_entrada_registrar` recebe o
-- carimbo da Meta em `p_quando` — o instante em que o fornecedor escreveu, não
-- o instante em que a gente soube. Depois de uma queda do worker, de uma fila
-- represada ou de um reenvio do webhook, chega uma entrada de 30 h atrás: ela
-- é gravada, `window_expires_at` nasce JÁ VENCIDA, e a introdução dispara
-- assim mesmo.
--
-- O QUE ACONTECIA ENTÃO, medido no banco local antes desta migração:
--   janela_de_24h_aberta = false · introduções = 1 · business_initiated = TRUE
--
-- Ou seja: a apresentação saía como mensagem INICIADA PELA EMPRESA. Três
-- consequências, e nenhuma é cosmética.
--   1. `app.pode_enviar` passo 3 só pergunta se a linha TEM template
--      (`p_tem_template`), nunca se o template está aprovado. `GEN-SYS-INTRO`
--      nasceu com `meta_status` vazio — nunca foi submetido à Meta. O que sai
--      pelo fio é uma chamada de template que a Graph API recusa.
--   2. Ela consome um slot dos tetos do RF-CON-10 (`teto_do_numero`,
--      `teto_iniciadas_dia`, `teto_iniciadas_hora`) — tetos que existem para
--      proteger o aquecimento do número, gastos numa mensagem que não chega.
--   3. É cobrada como conversa iniciada pela empresa, e a introdução foi
--      desenhada para ser de graça ("texto livre, de graça, sem template").
--
-- A CORREÇÃO É UMA PERGUNTA, e ela é feita ANTES do carimbo de `introducao_em`:
-- recusar aqui deixa a conversa intocada, e o fornecedor que escreveu há 30 h
-- continua elegível à introdução se voltar a escrever dentro da janela.
--
-- POR QUE NÃO BASTAVA CONFIAR NA PORTEIRA. `app.messages_guard` chama
-- `app.pode_enviar`, que no passo 3 DEIXA PASSAR quem tem template: é a regra
-- certa para a campanha, que manda `GEN-ABR-OLA-*` aprovado de propósito. A
-- introdução não é campanha — ela é resposta. Quem sabe disso é ela, não a
-- porteira, e por isso a pergunta mora aqui.
--
-- Nada mais muda: a função é recriada a partir da definição viva da
-- 20261002090000, com um bloco novo marcado `-- NOVO`.
-- =====================================================================

create or replace function app.wa_introduzir(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       public.messages%rowtype;
  c       public.conversations%rowtype;
  v_trava uuid;
  v_msg   uuid;
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
  return jsonb_build_object('introduziu', true, 'message_id', v_msg);
end $$;
comment on function app.wa_introduzir(uuid) is
  'A introdução automática (ADR-16): quando chega a primeira mensagem de texto do lead numa conversa em que tudo o que saiu foi cumprimento, apresenta a Komune UMA vez, sem nome, DENTRO da janela de 24 h (conferida desde 28/09/2026, não presumida) e dentro do horário. Opt-out, contato suprimido, bot pausado, janela vencida, fora do horário, conversa que já tem dono e resposta de qualquer outro automatismo passam batido.';
revoke all on function app.wa_introduzir(uuid) from public, anon, authenticated;

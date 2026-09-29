-- =====================================================================
-- O "Tudo bem?" vem antes da introdução
--
-- Rafael, 29/09/2026: "vamos precisar mudar a resposta, pra humanizar mais,
-- pois ficou estranho, depois que a pessoa responder, o robo mandará um tudo
-- bem? e depois a introdução após uns 15 a 20 segundos".
--
-- O que estava estranho: a pessoa respondia "Boa tarde!" com um "oi" e levava
-- de volta, oito segundos depois, cinco linhas de proposta comercial. Ninguém
-- conversa assim. Uma pessoa responde o cumprimento, pergunta como vai, e só
-- então diz ao que veio.
--
-- Então a sequência passa a ser três tempos:
--
--   1. "Boa tarde!"            — quando a ficha é aprovada no Radar
--   2. "Tudo bem?"             — 3 a 6 s depois de a pessoa responder
--   3. a introdução            — 15 a 20 s depois disso
--
-- Os dois atrasos são sorteados e vêm de `app_settings`, como o primeiro já
-- vinha: quem muda é o gestor, sem deploy.
--
-- ===========================================================================
-- POR QUE O ATRASO DO "TUDO BEM?" NÃO É ZERO
-- ===========================================================================
-- Porque a resposta instantânea é o que denuncia máquina. Três a seis segundos
-- é o tempo de alguém ver a notificação e digitar duas palavras. É a mesma
-- razão da migração 20261002140000, aplicada ao passo novo.
--
-- E o 15 a 20 da introdução conta a partir de quando ELA nasce, que é o mesmo
-- instante em que o "Tudo bem?" nasce (as duas são gravadas na mesma
-- transação). Na prática: a pessoa responde, o "Tudo bem?" chega em ~5 s, e a
-- introdução ~12 s depois dele.
--
-- RF-CON-06, RF-CON-20 · ADR-05, ADR-16
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O modelo
-- ---------------------------------------------------------------------
-- `service` e sem variável, como a introdução: ele é copiado CRU para o fio
-- (`app.wa_bot_dizer`), então um `{{nome}}` aqui sairia literal.
insert into public.message_templates (template_code, name, channel, category, segment, kind,
                                      language, body, variables, is_active, version)
values ('GEN-SYS-TUDOBEM', 'Tudo bem? (antes da introdução)', 'whatsapp', 'service', 'GEN',
        'sistema', 'pt_BR', 'Tudo bem?', '[]'::jsonb, true, 1)
on conflict (template_code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Os dois atrasos
-- ---------------------------------------------------------------------
update public.app_settings
   set value = value
             || jsonb_build_object('introducao_atraso_s', jsonb_build_object('min', 15, 'max', 20))
             || case when value ? 'tudo_bem_atraso_s' then '{}'::jsonb
                     else jsonb_build_object('tudo_bem_atraso_s',
                                             jsonb_build_object('min', 3, 'max', 6)) end
 where key = 'atendimento';

create or replace function app.wa_atraso_do_envio(p_message_id uuid)
returns integer
language plpgsql
-- VOLATILE, e não `stable`: a função SORTEIA, e `stable` enxerga o banco do
-- começo da instrução — não veria a mensagem recém-inserida. (20261002140000)
volatile
security definer
set search_path = ''
as $$
declare
  m        public.messages%rowtype;
  v_codigo text;
  v_chave  text;
  v_cfg    jsonb;
  v_min    int;
  v_max    int;
  v_alvo   int;
  v_passou int;
begin
  select * into m from public.messages where id = p_message_id;
  if not found or m.template_id is null then
    return 0;
  end if;

  select t.template_code into v_codigo from public.message_templates t where t.id = m.template_id;
  v_chave := case v_codigo
               when 'GEN-SYS-INTRO'   then 'introducao_atraso_s'
               when 'GEN-SYS-TUDOBEM' then 'tudo_bem_atraso_s'
             end;
  -- Todo o resto sai sem atraso: cumprimento de campanha, texto de gente,
  -- confirmação de opt-out. Segurar resposta humana seria mentira ao contrário.
  if v_chave is null then
    return 0;
  end if;

  v_cfg := coalesce((select value -> v_chave from public.app_settings where key = 'atendimento'),
                    '{}'::jsonb);
  v_min := greatest(coalesce((v_cfg ->> 'min')::int, 0), 0);
  v_max := greatest(coalesce((v_cfg ->> 'max')::int, 0), v_min);
  if v_max = 0 then
    return 0;
  end if;

  v_alvo   := v_min + floor(random() * (v_max - v_min + 1))::int;
  -- O que já passou desde que a mensagem nasceu: o que o lead sente é o tempo
  -- total, não o tempo de fila.
  v_passou := floor(extract(epoch from (now() - m.created_at)))::int;
  return greatest(v_alvo - v_passou, 0);
end $$;
comment on function app.wa_atraso_do_envio(uuid) is
  'Segundos a segurar esta mensagem na fila. Duas esperam: GEN-SYS-TUDOBEM (atendimento.tudo_bem_atraso_s, 3 a 6 s) e GEN-SYS-INTRO (atendimento.introducao_atraso_s, 15 a 20 s desde 29/09/2026). O sorteio desconta o tempo que já passou desde que a mensagem nasceu. Todo o resto sai sem atraso.';


-- ---------------------------------------------------------------------
-- 3. O gatilho manda as duas
-- ---------------------------------------------------------------------
-- Recriada a partir de 20261002130000 — a definição VIVA, e não a de
-- 20261002090000, que é a primeira e não tem a checagem da janela de 24 h.
-- (Copiei da errada na primeira tentativa e o arquivo 83 pegou na hora: a
-- introdução voltou a sair com a janela vencida. É para isso que ele existe.)
--
-- Muda UM bloco: o envio, que passa a ser "Tudo bem?" e depois a introdução.
-- Todas as recusas de cima — opt-out, contato suprimido, bot pausado, fora do
-- horário, fora da janela de 24 h, conversa que já tem dono, resposta de outro
-- automatismo, uma por conversa — ficam exatamente como estavam.
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
end $$;

comment on function app.wa_introduzir(uuid) is
  'A conversa automática (ADR-16): quando chega a primeira mensagem de texto do lead numa conversa em que tudo o que saiu foi cumprimento, manda "Tudo bem?" e, logo atrás, a apresentação da Komune — UMA vez, sem nome, dentro da janela de 24 h e dentro do horário. O que separa as duas no tempo é app.wa_atraso_do_envio (3 a 6 s e 15 a 20 s). Opt-out, contato suprimido, bot pausado, fora do horário, fora da janela de 24 h, conversa que já tem dono e resposta de qualquer outro automatismo passam batido.';

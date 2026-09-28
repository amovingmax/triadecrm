-- =====================================================================
-- A introdução: o robô abre a conversa, e só abre
-- =====================================================================
-- POR QUE AGORA. Rafael recusou o desenho da IA conversando em 28/09/2026:
-- "Achei as respostas muito ruins. Os contatos iniciais eu achei bom, mas o
-- desenvolver e a tag com conteúdo por IA, eu não quero que isso aconteça."
-- O que sobrevive é o começo. A campanha manda o cumprimento ("Bom dia!") e,
-- se o lead responder QUALQUER coisa, uma segunda mensagem — a introdução —
-- sai sozinha, dentro da janela de 24 h, em texto fixo e SEM NOME. Dali em
-- diante quem fala é gente, sempre (ADR-16, emenda de 28/09/2026).
--
-- O BURACO QUE ISTO TAPA. Desde 22/09 a campanha abre com o cumprimento solto
-- (20260922160000). Isso é uma saída na conversa, então `app.wa_bot_de_entrada`
-- marca `bot_estado = 'conversa_humana'` (20260916110000) e nunca manda o menu.
-- Quem responde "Bom dia!" hoje fica MUDO até alguém abrir a caixa — e é o
-- nosso maior volume.
--
-- SEM NOME É ESTRUTURAL, NÃO É DISCIPLINA. A introdução sai por
-- `app.wa_bot_dizer` (20260916110000), que insere `bot_fixed` com `template_id`
-- copiando o corpo cru. `app.messages_nome_do_atendente` (20260921110000) pula
-- exatamente essas duas condições, então nenhum "*Fulano:*" entra na frente. E
-- corpo cru quer dizer: NENHUMA VARIÁVEL. Um `{{nome}}` sairia literal no fio.
--
-- O QUE MUDA NA PORTEIRA: NADA, e o `app.messages_guard` NÃO É TOCADO aqui.
-- `app.pode_enviar` passo 2 (20260925170000) devolve `pode=true` para resposta
-- dentro da janela de 24 h. MAS os passos 1 e 1.5 vêm ANTES do 2 e continuam
-- valendo: contato suprimido, `conta_banida` e `meta_restringiu_entrada`
-- recusam a introdução como recusam qualquer coisa. Quando isso acontece o
-- guarda levanta exceção, o bloco `exception` do gatilho desfaz a subtransação
-- inteira (inclusive o carimbo de `introducao_em`), e a introdução é tentada de
-- novo na próxima entrada do lead. É o comportamento certo, e está escrito
-- porque não é óbvio.
--
-- O ÚNICO FREIO NOVO que a alcança é o teto de fala do robô (20260925180000),
-- e numa conversa em que o robô nunca falou isso é 1 de 6.
--
-- DENTRO DO HORÁRIO, E SÓ. Decisão consciente: `app.ausencia_responder`
-- (20260922120000) se cala diante de QUALQUER saída com
-- `created_at >= m.created_at`. Se a introdução saísse fora do horário, ela não
-- conviveria com a ausência — ela a CANCELARIA, e o lead que escreve 22h40 de
-- domingo receberia "posso te explicar em dois minutos?" sem ninguém para
-- responder. Enquanto o Rafael não decidir o contrário, a introdução respeita
-- `app.janela_do_canal` e fora dele quem fala é a ausência.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O modelo
-- ---------------------------------------------------------------------
-- TRÊS DECISÕES DE TEXTO, e nenhuma é estilo:
--   (1) NÃO diz "sem mensalidade". `packages/prompts/src/nucleo/base-conhecimento.ts`
--       registra em 08/09/2026 que a frase é FALSA (existe taxa mensal do
--       escrow, em revisão). O texto abaixo é o fato `taxa` da base, palavra
--       por palavra.
--   (2) "8%" e "komune.app.br" estão em VALORES_AUTORIZADOS e URLS_PERMITIDAS.
--   (3) A ORIGEM É GENÉRICA porque o corpo é copiado CRU: nomear a fonte por
--       ficha exigiria variável. Quem perguntar "onde pegou meu número?" recebe
--       GEN-SYS-QUEM-SOMOS, que tem {{origem}}, {{source_url}}, a base legal e
--       o e-mail do encarregado, e que é mandada POR GENTE (R06 C.3).
insert into public.message_templates (template_code, name, channel, category, segment, kind,
                                      language, body, variables, is_active, version)
values ('GEN-SYS-INTRO', 'Introdução automática (2ª mensagem)', 'whatsapp', 'service', 'GEN',
        'sistema', 'pt_BR',
'Oi! Aqui é da Komune, o aplicativo de eventos de Natal: quem vai dar uma festa monta o evento e contrata os fornecedores da cidade num lugar só.
Encontrei o contato do seu negócio numa busca pública de fornecedores de eventos aqui de Natal, e queria te convidar para a nossa rede de fornecedores fundadores — sem adesão, sem fidelidade e sem multa: a Komune fica com 8% só do evento que você fechar pela plataforma.
Posso te explicar em dois minutos como funciona?
Se não for o momento, é só responder SAIR que a gente não te procura mais. Como usamos seus dados: komune.app.br/privacidade',
        '[]'::jsonb, true, 1)
on conflict (template_code) do nothing;

-- ---------------------------------------------------------------------
-- 2. A chave que desliga sem deploy
-- ---------------------------------------------------------------------
-- Lida por `app.atendimento_liga('introducao_ativa')` (20260922120000), que
-- devolve `false` para chave ausente — por isso a chave TEM de existir, senão o
-- gestor não consegue ligá-la pela tela. `app.app_settings_validate` só
-- constrange `cadencia.tetos` e `ia.orcamento`, então a chave nova entra livre.
update public.app_settings
   set value = value || case when value ? 'introducao_ativa' then '{}'::jsonb
                             else '{"introducao_ativa": true}'::jsonb end
 where key = 'atendimento';

-- ---------------------------------------------------------------------
-- 3. As duas leituras
-- ---------------------------------------------------------------------
-- Os cumprimentos, sem filtro de `is_active` de propósito: um cumprimento
-- desativado amanhã tem de continuar sendo RECONHECIDO na conversa que ele
-- abriu ontem. Reconhecer não é enviar.
create or replace function app.wa_modelos_de_cumprimento()
returns int[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.id), '{}'::int[])
    from public.message_templates t
   where t.channel = 'whatsapp'::app.channel
     and t.template_code in ('GEN-ABR-OLA-MANHA', 'GEN-ABR-OLA-TARDE', 'GEN-ABR-OLA-NOITE')
$$;
comment on function app.wa_modelos_de_cumprimento() is
  'Os ids dos três cumprimentos da campanha (GEN-ABR-OLA-*). Sem filtro de is_active: reconhecer um cumprimento antigo na conversa que ele abriu não é enviá-lo de novo.';
revoke all on function app.wa_modelos_de_cumprimento() from public, anon;
grant execute on function app.wa_modelos_de_cumprimento() to authenticated, service_role;

-- No molde de `app.wa_modelo_humano` (20260925180000).
create or replace function app.wa_modelo_introducao()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.message_templates t
   where t.template_code = 'GEN-SYS-INTRO' and t.is_active
     and t.channel = 'whatsapp'::app.channel
$$;
comment on function app.wa_modelo_introducao() is
  'O id do modelo da introdução automática (ADR-16), ou null quando o gestor a desativa pelo catálogo.';
revoke all on function app.wa_modelo_introducao() from public, anon;
grant execute on function app.wa_modelo_introducao() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. A trava de uma por conversa
-- ---------------------------------------------------------------------
alter table public.conversations add column if not exists introducao_em timestamptz;
comment on column public.conversations.introducao_em is
  'Quando a introdução automática saiu nesta conversa (ADR-16). Uma por conversa, para sempre: o `where introducao_em is null` do update é a tranca que serializa duas entradas no mesmo instante.';

-- ---------------------------------------------------------------------
-- 5. A função pura
-- ---------------------------------------------------------------------
-- PURA: não escreve, e responde uma pergunta só.
--
-- `>= 1`, NÃO `= 1`. A pergunta é "TUDO o que saiu foi cumprimento?", não "saiu
-- um?". A campanha de recontato existe (20260925170000 fala em 3.000 fichas já
-- tocadas): um fornecedor que levou "Bom dia!" em duas levas tem DUAS saídas, as
-- duas cumprimentos, e é justamente ele que merece a apresentação quando enfim
-- responde. O `>= 1` continua excluindo a conversa que o lead começou (zero
-- saídas), que é caso do menu, não da introdução.
--
-- O `coalesce` externo existe porque `bool_and` sobre um `template_id` nulo
-- devolve NULL, e NULL aqui deixaria a introdução sair numa conversa em que
-- gente já escreveu texto livre.
create or replace function app.wa_so_o_cumprimento_saiu(p_conversation_id uuid,
                                                        p_ate timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(count(*) >= 1
                  and bool_and(m.template_id = any (app.wa_modelos_de_cumprimento())), false)
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'out'::app.msg_direction
     and m.status <> 'failed'::app.msg_status
     and m.created_at <= p_ate
$$;
comment on function app.wa_so_o_cumprimento_saiu(uuid, timestamptz) is
  'Todo envio nosso nesta conversa até um instante foi cumprimento (GEN-ABR-OLA-*), e houve pelo menos um? É a pergunta que decide se a introdução automática entra. Qualquer saída que não seja cumprimento quer dizer que a conversa já tem dono; nenhuma saída quer dizer que foi o lead que começou.';
revoke all on function app.wa_so_o_cumprimento_saiu(uuid, timestamptz) from public, anon;
grant execute on function app.wa_so_o_cumprimento_saiu(uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. A função que age
-- ---------------------------------------------------------------------
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

  -- (0) DENTRO DO HORÁRIO, E SÓ. Fora dele quem responde é a ausência, e ela se
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
  'A introdução automática (ADR-16): quando chega a primeira mensagem de texto do lead numa conversa em que tudo o que saiu foi cumprimento, apresenta a Komune UMA vez, sem nome, dentro da janela de 24 h e dentro do horário. Opt-out, contato suprimido, bot pausado, fora do horário, conversa que já tem dono e resposta de qualquer outro automatismo passam batido.';
revoke all on function app.wa_introduzir(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. O gatilho, e o lugar dele na fila
-- ---------------------------------------------------------------------
create or replace function app.messages_introducao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.wa_introduzir(new.id);
  exception when others then
    -- A mensagem que chegou vale mais que a resposta automática dela. Mesma
    -- escolha de `messages_bot_de_entrada` e `messages_x_ausencia`. O rollback
    -- da subtransação desfaz o carimbo de `introducao_em` junto, e a introdução
    -- é tentada de novo na próxima entrada do lead.
    raise warning 'wa_introduzir(%): %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function app.messages_introducao() from public, anon, authenticated;

-- O `s` é escolhido, não sorteado. Gatilhos AFTER disparam em ordem de nome:
--   a_freio_do_robo     → pingue-pongue e fusível; pode pausar a conversa, e a
--                          introdução vê `bot_paused` e a despedida.
--   after_write         → escreve `last_inbound_at`; o UPDATE dele dispara
--                          `app.conversations_before_write`, que é QUEM recalcula
--                          `window_expires_at` (20260905000400). A janela de
--                          24 h depende dessa cadeia, então ela vem antes.
--   bot_de_entrada, resposta_ao_botao → os dois que PODEM responder. Vêm antes,
--                          e a regra (2) da função os enxerga.
--   s_introducao          ← aqui
--   x_ausencia          → vê a introdução pelo próprio `exists` dele. Com a
--                          regra (0) a introdução não sai fora do horário, então
--                          na prática os dois nunca disputam a mesma entrada.
--   zz_lead_automatico  → continua por último, criando a ficha.
drop trigger if exists messages_s_introducao on public.messages;
create trigger messages_s_introducao
  after insert on public.messages
  for each row when (new.direction = 'in'::app.msg_direction)
  execute function app.messages_introducao();

-- O comentário de `20260922110000` cita a ordem dos gatilhos pelo nome e passa
-- a estar incompleto. Migração não edita arquivo antigo: o texto novo vai aqui.
comment on function app.messages_lead_automatico() is
  'Cria a ficha do desconhecido que escreveu (RF-CON-24). É o ÚLTIMO dos gatilhos de entrada de public.messages, que disparam em ordem de nome: a_freio_do_robo (freio), after_write (last_inbound_at, e por ele a janela de 24 h), bot_de_entrada (menu), ia_pendente, quem_responde_atende, resposta_ao_botao, resposta_no_funil, s_introducao (a introdução automática, ADR-16), x_ausencia (fora do horário) e zz_lead_automatico.';

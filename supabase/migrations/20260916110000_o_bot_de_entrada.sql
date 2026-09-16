-- O bot de entrada: quem escreve para a Komune é recebido na hora e vai para a
-- pessoa certa.
--
-- Pedido do Rafael em 16/09/2026: "toda vez que alguém entra em contato conosco,
-- que tenha um bot inicial, que a pessoa vai poder pré-selecionar, e de acordo com
-- essa pré-seleção, com cada nicho — um é pagamento, dois é comercial e por aí vai —
-- só que com o contexto do nosso CRM e contexto da Komune".
--
-- COMO ISSO CABE NAS REGRAS QUE JÁ EXISTEM
--
--   * Só responde quem escreveu PRIMEIRO. A janela de 24 h abre com a mensagem
--     recebida, então a resposta é texto livre para a Meta — e continua sendo texto
--     FIXO para nós: o menu e as quatro respostas são modelos de serviço
--     (`GEN-SYS-MENU*`), não texto inventado por IA (ADR-05, RF-CON-22). Por isso
--     saem como `bot_fixed` com `template_id`, que é o que o `messages_guard` exige.
--   * Conversa que a gente começou não recebe menu: quem já estava falando com uma
--     pessoa do time não pode ser jogado num robô no meio do assunto.
--   * Quem escreve pedindo para sair não recebe menu: a mensagem dele é o opt-out, e
--     quem responde é a confirmação do RF-CON-19.
--   * A escolha fica gravada na conversa (`bot_estado`, `bot_opcao`, `ai_intent`),
--     abre TAREFA para quem atende e não se repete: o bot fala no máximo duas vezes
--     (o menu e a resposta da opção). Depois disso é gente.
--
-- O que cada opção responde e para onde vai está em `app_settings`
-- (`whatsapp.bot_de_entrada`), não no código: mudar o texto de uma opção é um
-- `update` do gestor, não um deploy.

-- =====================================================================
-- A. O estado do bot na conversa
-- =====================================================================
alter table public.conversations
  add column if not exists bot_estado text
    check (bot_estado is null or bot_estado in ('menu_enviado', 'escolhido', 'sem_escolha', 'conversa_humana')),
  add column if not exists bot_opcao text;

comment on column public.conversations.bot_estado is
  'Onde o bot de entrada parou nesta conversa: menu_enviado (esperando a escolha), escolhido (respondeu e virou tarefa), sem_escolha (a pessoa escreveu outra coisa — é gente que responde) ou conversa_humana (nós começamos, o bot não entra).';
comment on column public.conversations.bot_opcao is
  'A opção do menu que a pessoa escolheu (1..n), como está em app_settings.whatsapp.bot_de_entrada.';


-- =====================================================================
-- B. Os textos (modelos de serviço: não passam pela Meta)
-- =====================================================================
insert into public.message_templates
  (template_code, name, channel, category, segment, kind, language, body, variables)
values
  ('GEN-SYS-MENU', 'Bot de entrada — menu', 'whatsapp', 'service', 'GEN', 'sistema', 'pt_BR',
   'Oi! Aqui é a Komune, o aplicativo de eventos de Natal: quem vai dar uma festa monta o evento e contrata os fornecedores da cidade num lugar só.
Para eu te levar para a pessoa certa, responda com o número:
1 - Quero ser fornecedor ou parceiro
2 - Quero organizar um evento
3 - Pagamentos e financeiro
4 - Já sou parceiro e preciso de ajuda
Se preferir, escreva com suas palavras que alguém do time responde.',
   '[]'::jsonb),
  ('GEN-SYS-MENU-1', 'Bot de entrada — fornecedor ou parceiro', 'whatsapp', 'service', 'GEN', 'sistema', 'pt_BR',
   'Boa! Estar na Komune é de graça: não tem mensalidade nem adesão, e só existe custo quando vocês fecham um serviço pela plataforma.
Já estou chamando alguém do time para te explicar em 20 minutos, por vídeo ou pessoalmente.
Enquanto isso, me conta: qual é o nome do seu negócio e o que vocês fazem?',
   '[]'::jsonb),
  ('GEN-SYS-MENU-2', 'Bot de entrada — quero organizar um evento', 'whatsapp', 'service', 'GEN', 'sistema', 'pt_BR',
   'Que bom! Na Komune você monta o evento e contrata os fornecedores da cidade num lugar só, com preço e avaliação na tela: komune.app.br
Me conta que tipo de evento é e para quando, que eu te ajudo a achar quem atende.',
   '[]'::jsonb),
  ('GEN-SYS-MENU-3', 'Bot de entrada — pagamentos e financeiro', 'whatsapp', 'service', 'GEN', 'sistema', 'pt_BR',
   'Certo, isso é com o nosso financeiro e eu já estou avisando.
Para adiantar, me diz em uma frase o que você precisa (repasse, nota fiscal, cobrança) e o nome do seu negócio.',
   '[]'::jsonb),
  ('GEN-SYS-MENU-4', 'Bot de entrada — já sou parceiro e preciso de ajuda', 'whatsapp', 'service', 'GEN', 'sistema', 'pt_BR',
   'Estou aqui. Me conta o que está acontecendo — perfil, pedido de orçamento, pagamento ou outra coisa — que eu levo para a pessoa certa agora.',
   '[]'::jsonb)
on conflict (template_code) do nothing;

insert into public.app_settings (key, value, description)
values ('whatsapp.bot_de_entrada', $j${
  "ativo": true,
  "modelo_do_menu": "GEN-SYS-MENU",
  "opcoes": [
    {"chave": "1", "rotulo": "Quero ser fornecedor ou parceiro", "intencao": "parceria",
     "modelo": "GEN-SYS-MENU-1", "tarefa": "Fornecedor novo escreveu no WhatsApp",
     "palavras": ["fornecedor", "parceiro", "parceria", "anunciar", "divulgar", "cadastrar meu"]},
    {"chave": "2", "rotulo": "Quero organizar um evento", "intencao": "cliente",
     "modelo": "GEN-SYS-MENU-2", "tarefa": "Cliente quer organizar evento",
     "palavras": ["organizar", "meu evento", "festa", "aniversario", "aniversário", "casamento", "orcamento", "orçamento"]},
    {"chave": "3", "rotulo": "Pagamentos e financeiro", "intencao": "financeiro",
     "modelo": "GEN-SYS-MENU-3", "tarefa": "Assunto financeiro no WhatsApp",
     "palavras": ["pagamento", "pagar", "repasse", "nota fiscal", "cobranca", "cobrança", "financeiro", "pix"]},
    {"chave": "4", "rotulo": "Já sou parceiro e preciso de ajuda", "intencao": "suporte",
     "modelo": "GEN-SYS-MENU-4", "tarefa": "Parceiro pedindo ajuda no WhatsApp",
     "palavras": ["ajuda", "suporte", "problema", "nao consigo", "não consigo", "erro", "perfil"]}
  ]
}$j$::jsonb, 'Bot de entrada do WhatsApp: menu, opções, textos e o que cada escolha vira no CRM (migração 20260916110000).')
on conflict (key) do nothing;


-- =====================================================================
-- C. As regras
-- =====================================================================
create or replace function app.wa_bot_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.app_settings where key = 'whatsapp.bot_de_entrada'),
                  '{"ativo": false}'::jsonb)
$$;
revoke all on function app.wa_bot_config() from public, anon, authenticated;

-- "SAIR", "parar", "não quero": a mensagem é um opt-out, e quem responde é a
-- confirmação do RF-CON-19. O bot cala a boca. As palavras são as do CLAUDE.md, e
-- ficam também em apps/workers/src/whatsapp/optout.ts — a duplicação é consciente:
-- aqui ela só EVITA uma resposta; lá ela CRIA a supressão.
create or replace function app.wa_parece_optout(p_texto text)
returns boolean
language sql
stable
set search_path = ''
as $$
  with limpo as (
    select btrim(regexp_replace(
             regexp_replace(extensions.unaccent(lower(coalesce(p_texto, ''))), '[^a-z0-9\s]', ' ', 'g'),
             '\s+', ' ', 'g')) as t
  )
  -- Regra 1: a mensagem INTEIRA é uma palavra de encerrar ("para" sozinho é
  -- imperativo; "para quinta" é preposição).
  select exists (
      select 1 from limpo
       where t = any (array['sair','sai','saia','parar','pare','para','para com isso','remover','remove',
                            'remova','cancelar','cancela','descadastrar','descadastre','bloquear','stop',
                            'unsubscribe','chega','ja chega','nao quero','nao quero mais']))
      -- Regra 2: frase sem outra leitura, em qualquer lugar do texto.
      or exists (
      select 1 from limpo,
           unnest(array['nao quero receber','nao quero mais receber','nao quero mais mensagem',
                        'nao me mande mais','nao me manda mais','nao mande mais','nao manda mais',
                        'nao envie mais','nao envia mais','nao me procure','nao me procura mais',
                        'nao me perturbe','nao insista','nao me chame mais','nao me chama mais',
                        'nao me ligue mais','nao me liga mais','para de mandar','para de me mandar',
                        'pare de mandar','pare de me mandar','parar de receber','pode parar',
                        'me tira da lista','me tire da lista','tira da lista','tire da lista',
                        'sair da lista','remover da lista','descadastrar']) f(frase)
       where position(f.frase in t) > 0)
$$;
comment on function app.wa_parece_optout(text) is
  'A mensagem parece pedido de opt-out? Espelho em SQL das duas regras de apps/workers/src/whatsapp/optout.ts: a palavra SOZINHA, ou a frase inequívoca em qualquer lugar do texto. Aqui ela só evita que o bot responda um menu a quem está se despedindo; quem cria a supressão continua sendo o worker.';
revoke all on function app.wa_parece_optout(text) from public, anon;
grant execute on function app.wa_parece_optout(text) to authenticated, service_role;

-- A opção que a pessoa escolheu: o número solto ("2", "opção 2", "2️⃣") ou uma
-- palavra da lista da opção. Sem certeza, devolve null — e aí quem responde é gente.
create or replace function app.wa_bot_escolha(p_texto text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limpo text := extensions.unaccent(lower(btrim(coalesce(p_texto, ''))));
  v_num   text := (regexp_match(v_limpo, '^[^0-9]{0,12}([1-9])[^0-9]{0,12}$'))[1];
  v_op    jsonb;
  v_palavra text;
begin
  if v_limpo = '' then
    return null;
  end if;
  for v_op in select o from jsonb_array_elements(app.wa_bot_config() -> 'opcoes') o loop
    if v_num is not null and v_op ->> 'chave' = v_num then
      return v_op;
    end if;
  end loop;
  -- Só por palavra quando a frase é curta: "quero saber quanto custa para o meu
  -- casamento de 200 pessoas" não é escolha de menu, é assunto para gente.
  if length(v_limpo) <= 60 then
    for v_op in select o from jsonb_array_elements(app.wa_bot_config() -> 'opcoes') o loop
      for v_palavra in select p from jsonb_array_elements_text(coalesce(v_op -> 'palavras', '[]'::jsonb)) p loop
        if position(extensions.unaccent(lower(v_palavra)) in v_limpo) > 0 then
          return v_op;
        end if;
      end loop;
    end loop;
  end if;
  return null;
end $$;
revoke all on function app.wa_bot_escolha(text) from public, anon, authenticated;

-- A mensagem fixa que o bot manda. Sai como bot_fixed com template_id, que é o que
-- o messages_guard exige de texto de robô (RF-CON-22).
create or replace function app.wa_bot_dizer(p_conversation_id uuid, p_codigo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t      public.message_templates%rowtype;
  v_msg  uuid;
begin
  select * into t from public.message_templates
   where template_code = p_codigo and is_active and channel = 'whatsapp'::app.channel;
  if not found then
    raise warning 'bot de entrada: modelo % não existe', p_codigo;
    return null;
  end if;
  insert into public.messages (conversation_id, direction, type, status, body,
                               template_id, author_kind, origin)
  values (p_conversation_id, 'out'::app.msg_direction, 'text'::app.msg_type,
          'queued'::app.msg_status, t.body, t.id, 'bot_fixed', 'crm')
  returning id into v_msg;
  return v_msg;
end $$;
revoke all on function app.wa_bot_dizer(uuid, text) from public, anon, authenticated;

create or replace function app.wa_bot_de_entrada(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
end $$;
comment on function app.wa_bot_de_entrada(uuid) is
  'O bot de entrada do WhatsApp: responde com o menu a quem escreve primeiro, e com o texto da opção escolhida — abrindo tarefa e marcando a intenção na conversa. Fala no máximo duas vezes por conversa; opt-out, contato suprimido, conversa que nós começamos e bot pausado passam batido.';
revoke all on function app.wa_bot_de_entrada(uuid) from public, anon, authenticated;

create or replace function app.messages_bot_de_entrada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.wa_bot_de_entrada(new.id);
  exception when others then
    -- A mensagem que chegou vale mais que a resposta automática dela.
    raise warning 'wa_bot_de_entrada(%): %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function app.messages_bot_de_entrada() from public, anon, authenticated;

drop trigger if exists messages_bot_de_entrada on public.messages;
create trigger messages_bot_de_entrada after insert on public.messages
  for each row when (new.direction = 'in'::app.msg_direction)
  execute function app.messages_bot_de_entrada();

-- Ligar e desligar sem deploy, e sem abrir o SQL para quem não é gestor.
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
     set value = jsonb_set(value, '{ativo}', to_jsonb(coalesce(p_ativo, false))), updated_at = now()
   where key = 'whatsapp.bot_de_entrada'
  returning value into v_valor;
  return coalesce(v_valor, '{}'::jsonb);
end $$;
comment on function public.wa_bot_ligar(boolean) is
  'Liga ou desliga o bot de entrada do WhatsApp (app_settings.whatsapp.bot_de_entrada). Só gestor e admin.';
revoke all on function public.wa_bot_ligar(boolean) from public, anon;
grant execute on function public.wa_bot_ligar(boolean) to authenticated;

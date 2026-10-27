-- =====================================================================
-- O WhatsApp inteiro dentro do CRM
--
-- Pedido do Rafael em 27/10/2026: "quero todas as funcionalidades do wpp no
-- nosso CRM, criar grupo, apagar mensagem e etc". E, quando ouviu o que a
-- Meta não deixa: "mas eu quero tudo isso".
--
-- O que a Cloud API oficial deixa fazer (conferido na documentação da Meta em
-- 27/10/2026) entra de verdade; o que ela não deixa entra do jeito mais perto
-- possível, e a tela diz a diferença:
--
--   * RESPONDER CITANDO, REAGIR, MARCAR COMO LIDA, "DIGITANDO…": a API tem.
--   * DOCUMENTO, FIGURINHA, LOCALIZAÇÃO, PEDIR LOCALIZAÇÃO, CARTÃO DE
--     CONTATO, BOTÕES E LISTA: a API tem.
--   * BLOQUEAR: a API tem, mas só para quem escreveu nas últimas 24 h. O CRM
--     bloqueia na hora do lado dele (nada sai para o número) e pede o
--     bloqueio à Meta; se a Meta recusar, a tela diz por quê.
--   * GRUPOS: a API tem desde 06/10/2025, para conta oficial (OBA, o selo da
--     Meta), até 8 pessoas, entrada só por link de convite.
--   * APAGAR PARA TODOS e EDITAR: a API NÃO tem. Apagar some com a mensagem
--     do CRM (fica registrado quem e quando; o contato continua vendo);
--     mensagem ainda na fila é cancelada de verdade, antes de sair. Editar
--     manda uma correção respondendo à original.
--   * O CONTATO APAGOU OU EDITOU: a Meta só avisa quem está no Coexistence;
--     número só na Cloud API recebe "editou" sem o texto novo. Os dois
--     formatos são tratados.
--
-- Este arquivo é o banco disso tudo. O webhook (`wa-webhook/extrair.ts`), o
-- worker (`apps/workers/src/whatsapp`) e a tela (`components/conversas`,
-- `components/grupos`) mudam junto.
--
-- REGRA QUE NÃO MUDA: a porteira de `messages` (`app.messages_guard`) continua
-- valendo para tudo o que sai — supressão, janela de 24 h, tetos, horário. A
-- reação, a localização e o documento passam por ela como o texto passa.
--
-- RF-CON-03, RF-CON-05, RF-CON-10, RF-CON-11, RF-CON-19, RF-ADM-03
-- =====================================================================


-- =====================================================================
-- §1 · A mensagem ganha o que o WhatsApp tem
-- =====================================================================

alter table public.messages
  -- Responder citando (a "seta" do WhatsApp). O wamid fica junto porque a
  -- mensagem citada pode não estar no CRM (anterior à importação, ou de outra
  -- conversa), e a Meta manda só o id.
  add column if not exists responde_a       uuid references public.messages(id) on delete set null,
  add column if not exists responde_a_wamid text,
  -- A reação aponta para a mensagem reagida. Sem isto ela era uma mensagem
  -- solta com um emoji, no meio do fio.
  add column if not exists reage_a          uuid references public.messages(id) on delete set null,
  add column if not exists reage_a_wamid    text,
  -- A correção (o "editar" possível): uma mensagem nova que responde à errada.
  add column if not exists corrige_a        uuid references public.messages(id) on delete set null,
  -- Encaminhada: de qual mensagem do CRM (saída) ou se a Meta disse que veio
  -- encaminhada (entrada).
  add column if not exists encaminhada_de   uuid references public.messages(id) on delete set null,
  add column if not exists encaminhada      boolean not null default false,
  -- O que não é texto nem arquivo: localização, contatos, botões, lista, a
  -- opção escolhida, o anúncio de onde a pessoa veio, o erro da Meta.
  add column if not exists conteudo         jsonb,
  -- O nome do arquivo do documento ("cardapio.pdf"): é ele que a pessoa vê.
  add column if not exists media_nome       text,
  -- Apagada NO CRM. Não é DELETE (regra de 07/10/2026): a linha fica, o fio
  -- mostra "mensagem apagada" e o `audit_log` guarda quem foi.
  add column if not exists apagada_em       timestamptz,
  add column if not exists apagada_por      uuid references public.profiles(id) on delete set null,
  -- O contato apagou ("apagar para todos") ou editou a mensagem dele.
  add column if not exists apagada_pelo_contato_em timestamptz,
  add column if not exists editada_pelo_contato_em timestamptz,
  -- A mensagem de voz foi OUVIDA (recibo `played`, desde 17/03/2026).
  add column if not exists ouvida_em        timestamptz;

alter table public.messages
  drop constraint if exists messages_media_nome_check,
  add constraint messages_media_nome_check check (media_nome is null or length(media_nome) between 1 and 240),
  drop constraint if exists messages_conteudo_e_objeto,
  add constraint messages_conteudo_e_objeto check (conteudo is null or jsonb_typeof(conteudo) = 'object');

create index if not exists messages_reage_a_idx on public.messages (reage_a) where reage_a is not null;
create index if not exists messages_responde_a_idx on public.messages (responde_a) where responde_a is not null;
create index if not exists messages_corrige_a_idx on public.messages (corrige_a) where corrige_a is not null;
-- A busca pelo texto das mensagens (a lupa do WhatsApp). Trigrama porque a
-- busca é "contém", não "começa com".
create index if not exists messages_corpo_trgm on public.messages
  using gin (body extensions.gin_trgm_ops) where body is not null;

-- O que já tinha chegado como `system` por falta de nome no enum.
update public.messages
   set type = 'location'::app.msg_type, tipo_na_meta = null
 where type = 'system'::app.msg_type and tipo_na_meta = 'location' and direction = 'in'::app.msg_direction;
update public.messages
   set type = 'contacts'::app.msg_type, tipo_na_meta = null
 where type = 'system'::app.msg_type and tipo_na_meta = 'contacts' and direction = 'in'::app.msg_direction;


-- ---------------------------------------------------------------------
-- A forma de cada tipo novo, e o que não muda depois de sair
-- ---------------------------------------------------------------------
-- A porteira (`app.messages_guard`) pergunta "pode sair?". Este gatilho
-- pergunta "isto é uma mensagem que a Meta aceita?" — botão com título de 30
-- letras, lista com 11 opções e localização sem latitude morreriam na Meta
-- com um 100 genérico. Aqui morrem antes, com a frase certa.
--
-- E guarda o que o worker lê para montar a chamada (a resposta citada, o alvo
-- da reação, o conteúdo): mensagem é registro do que aconteceu, a mesma regra
-- do D2 em `messages_guard`.
create or replace function app.messages_forma()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c        public.conversations%rowtype;
  v_alvo   public.messages%rowtype;
  v_int    jsonb;
  v_lat    numeric;
  v_lng    numeric;
  v_item   jsonb;
  v_n      int;
begin
  if tg_op = 'UPDATE' then
    if old.direction = 'out'::app.msg_direction
       and (new.responde_a     is distinct from old.responde_a
            or new.reage_a     is distinct from old.reage_a
            or new.corrige_a   is distinct from old.corrige_a
            or new.encaminhada_de is distinct from old.encaminhada_de
            or new.conteudo    is distinct from old.conteudo
            or new.media_nome  is distinct from old.media_nome) then
      raise exception 'Mensagem é registro do que aconteceu: a resposta citada, o alvo da reação, o conteúdo e o nome do arquivo não mudam depois do insert'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.direction <> 'out'::app.msg_direction or new.origin <> 'crm' then
    return new;
  end if;

  select * into c from public.conversations where id = new.conversation_id;

  -- Bloqueada no CRM: nada sai para o número, nem resposta.
  if c.bloqueada_em is not null then
    raise exception 'Envio recusado: conversa_bloqueada — desbloqueie o contato para voltar a mandar mensagem'
      using errcode = '42501';
  end if;

  -- O arquivo é desta conversa (a pasta dela no balde) ou de uma mensagem que
  -- quem envia já enxerga — o encaminhar e a figurinha recebida reaproveitam o
  -- arquivo. Sem isto, o caminho de qualquer mídia do balde viraria envio. A
  -- conferência é de quem está na tela; o banco e o worker não passam por ela.
  if new.media_path is not null and auth.uid() is not null
     and new.media_path not like new.conversation_id::text || '/%'
     and not exists (select 1 from public.messages m
                      where m.media_path = new.media_path
                        and app.conversa_visivel(m.conversation_id)) then
    raise exception 'Envio recusado: o arquivo não é desta conversa' using errcode = '42501';
  end if;

  -- O que é citado, corrigido ou reagido é DESTA conversa.
  if new.responde_a is not null and not exists (
       select 1 from public.messages m where m.id = new.responde_a and m.conversation_id = new.conversation_id) then
    raise exception 'Envio recusado: a mensagem citada é de outra conversa' using errcode = '23514';
  end if;

  if new.corrige_a is not null then
    select * into v_alvo from public.messages where id = new.corrige_a;
    if not found or v_alvo.conversation_id <> new.conversation_id
       or v_alvo.direction <> 'out'::app.msg_direction or v_alvo.author_kind <> 'human'
       or v_alvo.type <> 'text'::app.msg_type or new.type <> 'text'::app.msg_type then
      raise exception 'Envio recusado: só se corrige texto que uma pessoa mandou, nesta conversa'
        using errcode = '23514';
    end if;
  end if;

  if new.type = 'reaction'::app.msg_type then
    if new.reage_a is null then
      raise exception 'Envio recusado: reação sem a mensagem reagida' using errcode = '23514';
    end if;
    select * into v_alvo from public.messages where id = new.reage_a;
    if not found or v_alvo.conversation_id <> new.conversation_id
       or v_alvo.type = 'reaction'::app.msg_type then
      raise exception 'Envio recusado: reage-se a uma mensagem desta conversa, e não a outra reação'
        using errcode = '23514';
    end if;
    -- Corpo nulo = tirar a reação (a Meta pede emoji vazio).
    if new.body is not null and (length(btrim(new.body)) = 0 or length(new.body) > 16) then
      raise exception 'Envio recusado: a reação é um emoji só' using errcode = '23514';
    end if;
  elsif new.type = 'location'::app.msg_type then
    begin
      v_lat := (new.conteudo ->> 'latitude')::numeric;
      v_lng := (new.conteudo ->> 'longitude')::numeric;
    exception when others then
      v_lat := null;
    end;
    if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      raise exception 'Envio recusado: localização precisa de latitude e longitude válidas' using errcode = '23514';
    end if;
  elsif new.type = 'contacts'::app.msg_type then
    if coalesce(jsonb_typeof(new.conteudo -> 'contatos'), '') <> 'array'
       or jsonb_array_length(new.conteudo -> 'contatos') not between 1 and 10 then
      raise exception 'Envio recusado: o cartão leva de 1 a 10 contatos' using errcode = '23514';
    end if;
    for v_item in select * from jsonb_array_elements(new.conteudo -> 'contatos') loop
      if nullif(btrim(coalesce(v_item ->> 'nome', '')), '') is null
         or coalesce(jsonb_typeof(v_item -> 'telefones'), '') <> 'array'
         or jsonb_array_length(v_item -> 'telefones') = 0 then
        raise exception 'Envio recusado: cada contato do cartão precisa de nome e telefone' using errcode = '23514';
      end if;
    end loop;
  elsif new.type = 'document'::app.msg_type then
    if nullif(btrim(coalesce(new.media_path, '')), '') is null then
      raise exception 'Envio recusado: documento sem arquivo' using errcode = '23514';
    end if;
    new.media_nome := coalesce(nullif(btrim(coalesce(new.media_nome, '')), ''), 'documento');
  elsif new.type = 'interactive'::app.msg_type and new.conteudo is not null then
    -- O botão de link automático do envio em massa (`envio_resposta_ao_botao`)
    -- tem a forma dele, em `template_params`, e não traz `conteudo`; aqui só o
    -- que uma pessoa monta na tela.
    v_int := new.conteudo -> 'interativo';
    if nullif(btrim(coalesce(new.body, '')), '') is null or length(new.body) > 1024 then
      raise exception 'Envio recusado: a pergunta dos botões precisa de texto (até 1.024 caracteres)'
        using errcode = '23514';
    end if;
    if (v_int ->> 'tipo') = 'botoes' then
      v_n := coalesce(jsonb_array_length(case when jsonb_typeof(v_int -> 'botoes') = 'array'
                                              then v_int -> 'botoes' end), 0);
      if v_n not between 1 and 3
         or exists (select 1 from jsonb_array_elements_text(v_int -> 'botoes') b
                     where length(btrim(b)) not between 1 and 20)
         or (select count(distinct lower(btrim(b))) from jsonb_array_elements_text(v_int -> 'botoes') b) <> v_n then
        raise exception 'Envio recusado: de 1 a 3 botões, cada um com até 20 letras e sem repetir'
          using errcode = '23514';
      end if;
    elsif (v_int ->> 'tipo') = 'lista' then
      v_n := coalesce(jsonb_array_length(case when jsonb_typeof(v_int -> 'itens') = 'array'
                                              then v_int -> 'itens' end), 0);
      if length(btrim(coalesce(v_int ->> 'botao', ''))) not between 1 and 20
         or v_n not between 1 and 10
         or exists (select 1 from jsonb_array_elements(v_int -> 'itens') i
                     where length(btrim(coalesce(i ->> 'titulo', ''))) not between 1 and 24
                        or length(coalesce(i ->> 'descricao', '')) > 72) then
        raise exception 'Envio recusado: a lista leva um botão de até 20 letras e de 1 a 10 opções (título até 24, descrição até 72)'
          using errcode = '23514';
      end if;
    elsif (v_int ->> 'tipo') <> 'pedir_localizacao' or v_int is null then
      raise exception 'Envio recusado: mensagem interativa é de botões, de lista ou de pedir localização'
        using errcode = '23514';
    end if;
  end if;

  -- Figurinha é imagem webp; a Meta recusa qualquer outra.
  if new.tipo_na_meta = 'sticker' and (new.type <> 'image'::app.msg_type or new.media_mime is distinct from 'image/webp') then
    raise exception 'Envio recusado: figurinha é imagem webp' using errcode = '23514';
  end if;

  return new;
end $$;
comment on function app.messages_forma() is
  'A forma dos tipos de mensagem do WhatsApp completo (27/10/2026): reação com alvo, localização válida, cartão de contato, botões e lista dentro dos limites da Meta, documento com arquivo, figurinha webp, conversa bloqueada. E o que o worker lê para montar a chamada não muda depois do insert.';
revoke all on function app.messages_forma() from public, anon, authenticated;

drop trigger if exists messages_forma on public.messages;
create trigger messages_forma
  before insert or update on public.messages
  for each row execute function app.messages_forma();


-- =====================================================================
-- §2 · A assinatura também no documento e na pergunta com botões
-- =====================================================================
create or replace function app.messages_nome_do_atendente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome  text;
  v_linha text;
begin
  if new.direction <> 'out'::app.msg_direction
     or new.origin <> 'crm'
     -- A legenda da foto e do vídeo (16/10/2026); a do documento e a pergunta
     -- dos botões e da lista (27/10/2026). Reação, figurinha, localização e
     -- contato não têm texto onde assinar.
     or new.type not in ('text'::app.msg_type, 'image'::app.msg_type, 'video'::app.msg_type,
                         'document'::app.msg_type, 'interactive'::app.msg_type)
     -- O botão de link automático do envio em massa sai sem assinatura, como
     -- sempre saiu: só a pergunta que uma pessoa monta (com `conteudo`) assina.
     or (new.type = 'interactive'::app.msg_type and new.conteudo is null)
     or new.template_id is not null
     or new.optout_confirmation
     or new.author_kind not in ('human', 'bot_ai')
     or nullif(btrim(coalesce(new.body, '')), '') is null
     or coalesce(current_setting('app.voz', true), '') = 'marca'
     or not coalesce((select (s.value ->> 'assinar_com_nome')::boolean
                        from public.app_settings s where s.key = 'whatsapp.envio'), true) then
    return new;
  end if;

  v_nome := app.primeiro_nome(case when new.author_kind = 'bot_ai' then new.approved_by
                                   else new.sent_by end);
  if v_nome is null then
    return new;
  end if;

  v_linha := '*' || v_nome || ':*';
  if left(new.body, length(v_linha)) is distinct from v_linha then
    new.body := v_linha || E'\n' || new.body;
  end if;
  return new;
end $$;
comment on function app.messages_nome_do_atendente() is
  'Assina o texto livre de WhatsApp, a legenda da foto, do vídeo e do documento e a pergunta dos botões com o primeiro nome de quem escreveu (ou aprovou, se veio da IA) em negrito na primeira linha. Dispara depois do messages_guard.';
revoke all on function app.messages_nome_do_atendente() from public, anon, authenticated;

-- O texto sem a assinatura `*Nome:*` da primeira linha (para encaminhar).
create or replace function app.sem_assinatura(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(coalesce(p_texto, ''), '^\*[^*\n]{1,60}:\*\n', '')), '')
$$;
revoke all on function app.sem_assinatura(text) from public, anon;
grant execute on function app.sem_assinatura(text) to authenticated, service_role;


-- =====================================================================
-- §3 · A conversa: bloquear, fixar, silenciar, favoritar
-- =====================================================================

alter table public.conversations
  add column if not exists bloqueada_em     timestamptz,
  add column if not exists bloqueada_por    uuid references public.profiles(id) on delete set null,
  -- O bloqueio do CRM vale na hora. O da Meta é pedido ao worker e pode não
  -- vir (ela só bloqueia quem escreveu nas últimas 24 h): `falhou` com o erro.
  add column if not exists bloqueio_na_meta text,
  add column if not exists bloqueio_erro    text;

alter table public.conversations
  drop constraint if exists conversations_bloqueio_na_meta_check,
  add constraint conversations_bloqueio_na_meta_check
    check (bloqueio_na_meta is null or bloqueio_na_meta in ('pedido', 'feito', 'falhou'));

-- Fixar e silenciar são de CADA PESSOA: o que a Ana fixou não sobe na lista
-- do Janio. (O "por ler" continua sendo da conversa, como sempre foi.)
create table if not exists public.conversa_preferencias (
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  fixada_em       timestamptz,
  silenciada_ate  timestamptz,
  atualizada_em   timestamptz not null default now(),
  primary key (profile_id, conversation_id)
);
alter table public.conversa_preferencias enable row level security;
drop policy if exists conversa_preferencias_select on public.conversa_preferencias;
create policy conversa_preferencias_select on public.conversa_preferencias
  for select to authenticated using (profile_id = (select auth.uid()));
comment on table public.conversa_preferencias is
  'Fixar e silenciar conversa, por pessoa (27/10/2026). Escrita só por public.conversa_fixar e public.conversa_silenciar.';

-- A estrela do WhatsApp, também por pessoa.
create table if not exists public.mensagens_favoritas (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  criada_em  timestamptz not null default now(),
  primary key (profile_id, message_id)
);
create index if not exists mensagens_favoritas_mensagem_idx on public.mensagens_favoritas (message_id);
alter table public.mensagens_favoritas enable row level security;
drop policy if exists mensagens_favoritas_select on public.mensagens_favoritas;
create policy mensagens_favoritas_select on public.mensagens_favoritas
  for select to authenticated using (profile_id = (select auth.uid()));
comment on table public.mensagens_favoritas is
  'Mensagens com estrela, por pessoa (27/10/2026). Escrita só por public.mensagem_favoritar.';


-- =====================================================================
-- §4 · A fila de ações: o que vai para a Meta e não é mensagem
-- =====================================================================
-- Marcar como lida, "digitando…", bloquear, os grupos e o perfil da empresa
-- são chamadas à Graph API que só o worker-wa pode fazer (o token da Meta mora
-- só com ele, no Fly). A tela pede; o worker faz na próxima volta do laço (5 s
-- parado); o resultado volta para o banco. Tudo o que tem efeito no banco é
-- aplicado por `app.wa_acao_efeito`, numa transação com a conclusão.
create table if not exists public.wa_acoes (
  id              bigint generated always as identity primary key,
  tipo            text not null,
  conversation_id uuid references public.conversations(id) on delete cascade,
  grupo_id        uuid,
  dados           jsonb not null default '{}'::jsonb,
  estado          text not null default 'pendente',
  tentativas      int not null default 0,
  chave           text,
  resultado       jsonb,
  erro            text,
  erro_codigo     text,
  pedida_por      uuid references public.profiles(id) on delete set null,
  pedida_em       timestamptz not null default now(),
  proxima_em      timestamptz not null default now(),
  comecada_em     timestamptz,
  feita_em        timestamptz,
  constraint wa_acoes_tipo_check check (tipo in (
    'ler', 'digitando', 'bloquear', 'desbloquear',
    'grupo_criar', 'grupo_atualizar', 'grupo_apagar', 'grupo_convite', 'grupo_novo_convite',
    'grupo_pedidos', 'grupo_aprovar', 'grupo_recusar', 'grupo_remover', 'grupo_sincronizar',
    'grupo_enviar', 'grupo_fixar', 'perfil_ler', 'perfil_salvar')),
  constraint wa_acoes_estado_check check (estado in ('pendente', 'fazendo', 'feita', 'falhou', 'descartada'))
);
create unique index if not exists wa_acoes_chave_uq on public.wa_acoes (chave) where chave is not null;
create index if not exists wa_acoes_fila_idx on public.wa_acoes (proxima_em) where estado in ('pendente', 'fazendo');
create index if not exists wa_acoes_grupo_idx on public.wa_acoes (grupo_id, pedida_em desc) where grupo_id is not null;
alter table public.wa_acoes enable row level security;
drop policy if exists wa_acoes_select on public.wa_acoes;
create policy wa_acoes_select on public.wa_acoes
  for select to authenticated using ((select app.sees_all()));
comment on table public.wa_acoes is
  'Chamadas à Graph API que não são mensagem (ler, digitando, bloquear, grupos, perfil), pedidas pela tela e feitas pelo worker-wa (27/10/2026).';

-- Quem pode mexer numa conversa: o mesmo recorte de `conversations_select`.
create or replace function app.posso_mexer_na_conversa(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and app.can_write() and app.conversa_visivel(p_conversation_id)
$$;
revoke all on function app.posso_mexer_na_conversa(uuid) from public, anon;

-- A última mensagem RECEBIDA da conversa: é ela que se marca como lida e é
-- sobre ela que o "digitando…" aparece (a Meta exige o id de uma recebida).
create or replace function app.wa_ultima_recebida(p_conversation_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.wa_message_id from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'in'::app.msg_direction
     and m.wa_message_id is not null
     -- A que o contato apagou não existe mais do lado dele.
     and m.apagada_pelo_contato_em is null
     and m.created_at > now() - interval '30 days'
   order by m.created_at desc
   limit 1
$$;
revoke all on function app.wa_ultima_recebida(uuid) from public, anon, authenticated;

-- Uma opção de `whatsapp.envio` que é ligada por padrão.
create or replace function app.wa_opcao(p_chave text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value ->> p_chave)::boolean
                     from public.app_settings s where s.key = 'whatsapp.envio'), true)
$$;
revoke all on function app.wa_opcao(text) from public, anon, authenticated;


-- =====================================================================
-- §5 · O que a tela pede
-- =====================================================================

-- ---------------------------------------------------------------------
-- Apagar: cancela o que está na fila; esconde o resto (só no CRM)
-- ---------------------------------------------------------------------
create or replace function public.mensagem_apagar(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_message_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_inexistente');
  end if;
  if not app.posso_mexer_na_conversa(m.conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- Ainda na fila: dá para apagar DE VERDADE — ela não sai. O worker confere
  -- de novo antes de mandar (`wa_saida_ainda_vale`), e quem tira da fila
  -- (`app.wa_proximos`) arquiva o que não está mais `queued`.
  if m.direction = 'out'::app.msg_direction and m.status = 'queued'::app.msg_status then
    update public.messages
       set status       = 'failed'::app.msg_status,
           error_code   = 'cancelada',
           error_detail = 'Cancelada por ' || coalesce(app.primeiro_nome(auth.uid()), 'alguém do time')
                          || ' antes de sair: o contato não recebeu.',
           failed_at    = now(),
           apagada_em   = now(),
           apagada_por  = auth.uid()
     where id = m.id and status = 'queued'::app.msg_status;
    if found then
      return jsonb_build_object('ok', true, 'cancelada', true);
    end if;
    -- Saiu entre a leitura e o update: cai no "apagar só no CRM".
  end if;

  update public.messages
     set apagada_em = now(), apagada_por = auth.uid()
   where id = m.id and apagada_em is null;
  return jsonb_build_object('ok', true, 'cancelada', false);
end $$;
comment on function public.mensagem_apagar(uuid) is
  'Apaga a mensagem no CRM (fica a linha, com quem e quando). Se ainda estava na fila, cancela o envio de verdade. A Cloud API não tem "apagar para todos": o que já saiu continua no celular do contato.';
revoke all on function public.mensagem_apagar(uuid) from public, anon;
grant execute on function public.mensagem_apagar(uuid) to authenticated;

create or replace function public.mensagem_restaurar(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_message_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_inexistente');
  end if;
  if not app.posso_mexer_na_conversa(m.conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  -- O envio cancelado não volta para a fila: desfazer é mandar de novo.
  update public.messages set apagada_em = null, apagada_por = null
   where id = m.id and apagada_em is not null;
  return jsonb_build_object('ok', true, 'cancelada', m.error_code = 'cancelada');
end $$;
revoke all on function public.mensagem_restaurar(uuid) from public, anon;
grant execute on function public.mensagem_restaurar(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Corrigir (o "editar" que a API permite)
-- ---------------------------------------------------------------------
create or replace function public.mensagem_corrigir(p_message_id uuid, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m      public.messages%rowtype;
  v_novo uuid;
  v_txt  text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  select * into m from public.messages where id = p_message_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_inexistente');
  end if;
  if not app.posso_mexer_na_conversa(m.conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if v_txt is null then
    return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
  end if;
  if m.direction <> 'out'::app.msg_direction or m.type <> 'text'::app.msg_type or m.author_kind <> 'human' then
    return jsonb_build_object('ok', false, 'motivo', 'so_texto_do_time');
  end if;
  -- Na fila ainda? Não precisa de correção: cancela e manda a certa. Os dois
  -- juntos ou nenhum: se a certa for recusada, a errada continua na fila.
  if m.status = 'queued'::app.msg_status then
    begin
      perform public.mensagem_apagar(m.id);
      insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
      values (m.conversation_id, 'out', 'text', 'queued', v_txt, 'human', auth.uid(), 'crm')
      returning id into v_novo;
    exception when insufficient_privilege or check_violation then
      return jsonb_build_object('ok', false, 'motivo', sqlerrm);
    end;
    return jsonb_build_object('ok', true, 'message_id', v_novo, 'substituiu', true);
  end if;
  if m.status = 'failed'::app.msg_status then
    return jsonb_build_object('ok', false, 'motivo', 'nao_saiu');
  end if;

  begin
    insert into public.messages (conversation_id, direction, type, status, body, author_kind,
                                 sent_by, origin, responde_a, corrige_a)
    values (m.conversation_id, 'out', 'text', 'queued', '_Correção:_ ' || v_txt, 'human',
            auth.uid(), 'crm', m.id, m.id)
    returning id into v_novo;
  exception when insufficient_privilege or check_violation then
    return jsonb_build_object('ok', false, 'motivo', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'message_id', v_novo, 'substituiu', false);
end $$;
comment on function public.mensagem_corrigir(uuid, text) is
  'Corrige um texto que já saiu: a Cloud API não edita mensagem, então sai uma nova, "Correção: …", respondendo à original. Se a original ainda estava na fila, ela é cancelada e a certa vai no lugar.';
revoke all on function public.mensagem_corrigir(uuid, text) from public, anon;
grant execute on function public.mensagem_corrigir(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Reagir
-- ---------------------------------------------------------------------
create or replace function public.mensagem_reagir(p_message_id uuid, p_emoji text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m      public.messages%rowtype;
  v_novo uuid;
begin
  select * into m from public.messages where id = p_message_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_inexistente');
  end if;
  if not app.posso_mexer_na_conversa(m.conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if m.wa_message_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_sem_id_na_meta');
  end if;
  begin
    insert into public.messages (conversation_id, direction, type, status, body, author_kind,
                                 sent_by, origin, reage_a)
    values (m.conversation_id, 'out', 'reaction', 'queued', nullif(btrim(coalesce(p_emoji, '')), ''),
            'human', auth.uid(), 'crm', m.id)
    returning id into v_novo;
  exception when insufficient_privilege or check_violation then
    return jsonb_build_object('ok', false, 'motivo', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'message_id', v_novo);
end $$;
comment on function public.mensagem_reagir(uuid, text) is
  'Reage a uma mensagem com um emoji (emoji vazio tira a reação). Passa pela porteira: só dentro da janela de 24 h.';
revoke all on function public.mensagem_reagir(uuid, text) from public, anon;
grant execute on function public.mensagem_reagir(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Encaminhar
-- ---------------------------------------------------------------------
create or replace function public.mensagem_encaminhar(p_message_id uuid, p_conversas uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m        public.messages%rowtype;
  v_conv   uuid;
  v_novo   uuid;
  v_tipo   app.msg_type;
  v_corpo  text;
  v_out    jsonb := '[]'::jsonb;
begin
  select * into m from public.messages where id = p_message_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_inexistente');
  end if;
  if not app.posso_mexer_na_conversa(m.conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if coalesce(array_length(p_conversas, 1), 0) = 0 or array_length(p_conversas, 1) > 5 then
    -- O WhatsApp limita a 5 conversas por vez, e o CRM também: é o que
    -- separa encaminhar de disparo em massa.
    return jsonb_build_object('ok', false, 'motivo', 'de_1_a_5_conversas');
  end if;
  if m.type in ('reaction'::app.msg_type, 'system'::app.msg_type) or m.apagada_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'nao_se_encaminha');
  end if;

  -- Modelo, botão respondido e pergunta com botões viram o texto deles.
  v_tipo := case when m.type in ('template'::app.msg_type, 'interactive'::app.msg_type)
                 then 'text'::app.msg_type else m.type end;
  v_corpo := app.sem_assinatura(m.body);
  if v_tipo in ('audio'::app.msg_type, 'image'::app.msg_type, 'video'::app.msg_type, 'document'::app.msg_type)
     and m.media_path is null then
    return jsonb_build_object('ok', false, 'motivo', 'arquivo_ausente');
  end if;
  if v_tipo = 'text'::app.msg_type and v_corpo is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_texto');
  end if;

  foreach v_conv in array p_conversas loop
    if not app.posso_mexer_na_conversa(v_conv) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('conversation_id', v_conv, 'ok', false,
                                                             'motivo', 'sem_permissao'));
      continue;
    end if;
    begin
      insert into public.messages (conversation_id, direction, type, status, body, media_path,
                                   media_mime, media_nome, tipo_na_meta, conteudo, author_kind,
                                   sent_by, origin, encaminhada, encaminhada_de)
      values (v_conv, 'out', v_tipo, 'queued', v_corpo, m.media_path, m.media_mime, m.media_nome,
              case when m.tipo_na_meta = 'sticker' then 'sticker' end,
              case when v_tipo in ('location'::app.msg_type, 'contacts'::app.msg_type) then m.conteudo end,
              'human', auth.uid(), 'crm', true, m.id)
      returning id into v_novo;
      v_out := v_out || jsonb_build_array(jsonb_build_object('conversation_id', v_conv, 'ok', true,
                                                             'message_id', v_novo));
    exception when insufficient_privilege or check_violation then
      v_out := v_out || jsonb_build_array(jsonb_build_object('conversation_id', v_conv, 'ok', false,
                                                             'motivo', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('ok', true, 'resultados', v_out);
end $$;
comment on function public.mensagem_encaminhar(uuid, uuid[]) is
  'Encaminha uma mensagem para até 5 conversas. Cada envio passa pela porteira da conversa de destino (janela de 24 h, supressão, tetos); o resultado diz qual saiu e qual não.';
revoke all on function public.mensagem_encaminhar(uuid, uuid[]) from public, anon;
grant execute on function public.mensagem_encaminhar(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Estrela
-- ---------------------------------------------------------------------
create or replace function public.mensagem_favoritar(p_message_id uuid, p_favorita boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv uuid;
begin
  select conversation_id into v_conv from public.messages where id = p_message_id;
  if v_conv is null or auth.uid() is null or not app.conversa_visivel(v_conv) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_favorita then
    insert into public.mensagens_favoritas (profile_id, message_id)
    values (auth.uid(), p_message_id) on conflict do nothing;
  else
    delete from public.mensagens_favoritas where profile_id = auth.uid() and message_id = p_message_id;
  end if;
  return jsonb_build_object('ok', true, 'favorita', p_favorita);
end $$;
revoke all on function public.mensagem_favoritar(uuid, boolean) from public, anon;
grant execute on function public.mensagem_favoritar(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Fixar, silenciar, marcar como não lida
-- ---------------------------------------------------------------------
create or replace function public.conversa_fixar(p_conversation_id uuid, p_fixar boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.conversa_visivel(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  -- Três, como no WhatsApp: fixar tudo é não fixar nada.
  if p_fixar and (select count(*) from public.conversa_preferencias p
                   where p.profile_id = auth.uid() and p.fixada_em is not null
                     and p.conversation_id <> p_conversation_id) >= 3 then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_tres_fixadas');
  end if;
  insert into public.conversa_preferencias (profile_id, conversation_id, fixada_em)
  values (auth.uid(), p_conversation_id, case when p_fixar then now() end)
  on conflict (profile_id, conversation_id) do update
     set fixada_em = case when p_fixar then coalesce(public.conversa_preferencias.fixada_em, now()) end,
         atualizada_em = now();
  return jsonb_build_object('ok', true, 'fixada', p_fixar);
end $$;
revoke all on function public.conversa_fixar(uuid, boolean) from public, anon;
grant execute on function public.conversa_fixar(uuid, boolean) to authenticated;

create or replace function public.conversa_silenciar(p_conversation_id uuid, p_ate timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.conversa_visivel(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  insert into public.conversa_preferencias (profile_id, conversation_id, silenciada_ate)
  values (auth.uid(), p_conversation_id, p_ate)
  on conflict (profile_id, conversation_id) do update
     set silenciada_ate = p_ate, atualizada_em = now();
  return jsonb_build_object('ok', true, 'silenciada_ate', p_ate);
end $$;
comment on function public.conversa_silenciar(uuid, timestamptz) is
  'Silencia a conversa para quem pediu até a data (nulo tira; ''infinity'' é para sempre): ela sai do número do menu dessa pessoa e ganha o ícone de silenciada. O aviso por e-mail, que vai para a lista do time, continua.';
revoke all on function public.conversa_silenciar(uuid, timestamptz) from public, anon;
grant execute on function public.conversa_silenciar(uuid, timestamptz) to authenticated;

create or replace function public.conversa_marcar_nao_lida(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.posso_mexer_na_conversa(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.conversations set unread_count = greatest(unread_count, 1), updated_at = now()
   where id = p_conversation_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.conversa_marcar_nao_lida(uuid) from public, anon;
grant execute on function public.conversa_marcar_nao_lida(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Marcar como lida, agora também para o contato (os dois tracinhos azuis)
-- ---------------------------------------------------------------------
create or replace function public.conversa_marcar_lida(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wamid text;
begin
  -- `leitura` e `financeiro` enxergam tudo e não escrevem: quem só observa não
  -- apaga o sinal de quem atende.
  if auth.uid() is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  perform 1 from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;
  if not app.conversa_visivel(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  update public.conversations
     set unread_count = 0
   where id = p_conversation_id and unread_count > 0;

  -- NOVO (27/10/2026): o contato vê os tracinhos azuis, como no WhatsApp. Uma
  -- vez por mensagem (a chave), e só se a opção não foi desligada em Ajustes.
  if app.wa_opcao('confirmar_leitura') then
    v_wamid := app.wa_ultima_recebida(p_conversation_id);
    if v_wamid is not null then
      insert into public.wa_acoes (tipo, conversation_id, dados, chave, pedida_por)
      values ('ler', p_conversation_id, jsonb_build_object('wamid', v_wamid), 'ler:' || v_wamid, auth.uid())
      on conflict (chave) where chave is not null do nothing;
    end if;
  end if;

  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.conversa_marcar_lida(uuid) from public, anon;
grant execute on function public.conversa_marcar_lida(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- "Digitando…"
-- ---------------------------------------------------------------------
create or replace function public.conversa_digitando(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wamid text;
begin
  if not app.posso_mexer_na_conversa(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not app.wa_opcao('mostrar_digitando') then
    return jsonb_build_object('ok', false, 'motivo', 'desligado');
  end if;
  -- A Meta mostra os três pontinhos só para quem escreveu (e por 25 s): fora
  -- da janela não há a quem responder agora.
  if not app.janela_de_24h_aberta(p_conversation_id, now()) then
    return jsonb_build_object('ok', false, 'motivo', 'janela_fechada');
  end if;
  v_wamid := app.wa_ultima_recebida(p_conversation_id);
  if v_wamid is null then
    return jsonb_build_object('ok', false, 'motivo', 'nada_recebido');
  end if;
  -- Um pedido a cada 20 s por conversa, quem quer que esteja digitando.
  insert into public.wa_acoes (tipo, conversation_id, dados, chave, pedida_por)
  values ('digitando', p_conversation_id, jsonb_build_object('wamid', v_wamid),
          'digitando:' || p_conversation_id || ':' || (extract(epoch from now())::bigint / 20), auth.uid())
  on conflict (chave) where chave is not null do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.conversa_digitando(uuid) from public, anon;
grant execute on function public.conversa_digitando(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Bloquear e desbloquear
-- ---------------------------------------------------------------------
create or replace function public.conversa_bloquear(p_conversation_id uuid, p_bloquear boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations%rowtype;
begin
  if not app.posso_mexer_na_conversa(p_conversation_id) or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into c from public.conversations where id = p_conversation_id;

  if p_bloquear then
    if c.bloqueada_em is not null then
      return jsonb_build_object('ok', true, 'bloqueada', true);
    end if;
    update public.conversations
       set bloqueada_em = now(), bloqueada_por = auth.uid(),
           bloqueio_na_meta = 'pedido', bloqueio_erro = null, updated_at = now()
     where id = c.id;
    -- O que estava na fila para este número não sai mais.
    update public.messages
       set status = 'failed'::app.msg_status, error_code = 'conversa_bloqueada',
           error_detail = 'O contato foi bloqueado antes de a mensagem sair.', failed_at = now()
     where conversation_id = c.id and direction = 'out'::app.msg_direction
       and status = 'queued'::app.msg_status;
    insert into public.wa_acoes (tipo, conversation_id, dados, pedida_por)
    values ('bloquear', c.id, jsonb_build_object('para', c.peer_phone_e164), auth.uid());
  else
    if c.bloqueada_em is null then
      return jsonb_build_object('ok', true, 'bloqueada', false);
    end if;
    update public.conversations
       set bloqueada_em = null, bloqueada_por = null, bloqueio_na_meta = null,
           bloqueio_erro = null, updated_at = now()
     where id = c.id;
    -- Desbloquear na Meta só se ela chegou a bloquear (ou pode ter chegado).
    if c.bloqueio_na_meta is distinct from 'falhou' then
      insert into public.wa_acoes (tipo, conversation_id, dados, pedida_por)
      values ('desbloquear', c.id, jsonb_build_object('para', c.peer_phone_e164), auth.uid());
    end if;
  end if;
  return jsonb_build_object('ok', true, 'bloqueada', p_bloquear);
end $$;
comment on function public.conversa_bloquear(uuid, boolean) is
  'Bloqueia o contato: no CRM vale na hora (nada sai, a fila do número é cancelada) e o pedido vai à Meta pelo worker, que só bloqueia quem escreveu nas últimas 24 h. Admin, gestor e SDR. Não é opt-out: a supressão da LGPD é outra coisa e não é mexida aqui.';
revoke all on function public.conversa_bloquear(uuid, boolean) from public, anon;
grant execute on function public.conversa_bloquear(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- A lupa: procurar pelo texto das mensagens
-- ---------------------------------------------------------------------
-- `security invoker`: a RLS de `messages` recorta o que cada um vê, sem
-- reescrever a regra aqui.
create or replace function public.conversas_buscar(p_texto text, p_limite int default 40)
returns table (conversation_id uuid, message_id uuid, trecho text, direction app.msg_direction, created_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select m.conversation_id, m.id,
         left(app.sem_assinatura(m.body), 160), m.direction, m.created_at
    from public.messages m
   where length(btrim(coalesce(p_texto, ''))) >= 2
     and m.body ilike '%' || replace(replace(replace(btrim(p_texto), '\', '\\'), '%', '\%'), '_', '\_') || '%'
     -- O índice acha no corpo inteiro; a assinatura "*Nome:*" não conta.
     and app.sem_assinatura(m.body) ilike '%' || replace(replace(replace(btrim(p_texto), '\', '\\'), '%', '\%'), '_', '\_') || '%'
     and m.apagada_em is null
     and m.type <> 'reaction'::app.msg_type
   order by m.created_at desc
   limit least(greatest(coalesce(p_limite, 40), 1), 100)
$$;
revoke all on function public.conversas_buscar(text, int) from public, anon;
grant execute on function public.conversas_buscar(text, int) to authenticated;


-- =====================================================================
-- §6 · O que chega: resposta citada, reação, localização, contato, botão
-- =====================================================================
-- O adaptador (`extrair.ts`) manda o que a Meta disse além do corpo num
-- `p_extra`. O registro da mensagem continua o de sempre — os gatilhos de
-- entrada (opt-out, robô, funil, lead) não mudam — e o extra é gravado em
-- seguida, na mesma transação.
create or replace function app.wa_entrada_completar(p_message_id uuid, p_extra jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resp  text := nullif(btrim(coalesce(p_extra ->> 'responde_a_wamid', '')), '');
  v_reage text := nullif(btrim(coalesce(p_extra ->> 'reage_a_wamid', '')), '');
  v_cont  jsonb := case when jsonb_typeof(p_extra -> 'conteudo') = 'object'
                             and p_extra -> 'conteudo' <> '{}'::jsonb
                        then p_extra -> 'conteudo' end;
begin
  if p_message_id is null or p_extra is null or jsonb_typeof(p_extra) <> 'object' then
    return;
  end if;
  update public.messages m
     set responde_a_wamid = coalesce(m.responde_a_wamid, v_resp),
         responde_a = coalesce(m.responde_a, (select r.id from public.messages r
                                               where v_resp is not null and r.wa_message_id = v_resp
                                                 and r.conversation_id = m.conversation_id)),
         reage_a_wamid = coalesce(m.reage_a_wamid, v_reage),
         reage_a = coalesce(m.reage_a, (select r.id from public.messages r
                                         where v_reage is not null and r.wa_message_id = v_reage
                                           and r.conversation_id = m.conversation_id)),
         encaminhada = m.encaminhada or coalesce((p_extra ->> 'encaminhada')::boolean, false),
         media_nome = coalesce(m.media_nome, left(nullif(btrim(coalesce(p_extra ->> 'media_nome', '')), ''), 240)),
         conteudo = case when v_cont is null then m.conteudo else coalesce(m.conteudo, '{}'::jsonb) || v_cont end
   where m.id = p_message_id;
end $$;
revoke all on function app.wa_entrada_completar(uuid, jsonb) from public, anon, authenticated;
grant execute on function app.wa_entrada_completar(uuid, jsonb) to service_role;

drop function if exists public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text, text);
create or replace function public.wa_entrada_registrar(
  p_wamid text, p_business_number text, p_peer_phone text, p_type text default 'text',
  p_body text default null, p_media_id text default null, p_media_mime text default null,
  p_occurred_at timestamptz default now(), p_peer_user_id text default null,
  p_peer_name text default null, p_extra jsonb default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_bruto text := lower(nullif(trim(coalesce(p_type, '')), ''));
  v_tipo  app.msg_type := app.wa_tipo_da_meta(p_type);
  v_ret   jsonb;
begin
  v_ret := app.wa_registrar_entrada(p_wamid, p_business_number, p_peer_phone, v_tipo,
                                    p_body, p_media_id, p_media_mime,
                                    coalesce(p_occurred_at, now()), p_peer_user_id, p_peer_name);
  if v_bruto is not null and v_bruto <> v_tipo::text and (v_ret ->> 'message_id') is not null then
    update public.messages
       set tipo_na_meta = left(v_bruto, 40)
     where id = (v_ret ->> 'message_id')::uuid
       and tipo_na_meta is null;
  end if;
  -- NOVO (27/10/2026): a resposta citada, a reação, a localização, o cartão,
  -- o botão escolhido, o nome do documento.
  if (v_ret ->> 'message_id') is not null then
    perform app.wa_entrada_completar((v_ret ->> 'message_id')::uuid, p_extra);
  end if;
  return v_ret;
end $$;
revoke all on function public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text, text, jsonb)
  to service_role;

-- O contato apagou ou editou uma mensagem dele (formato do Coexistence; um
-- número só na Cloud API recebe a edição como `unsupported`, sem o texto
-- novo, e ela entra como mensagem de sistema). Não vira linha nova no fio: a
-- mensagem original é que muda.
create or replace function public.wa_entrada_evento(
  p_tipo text, p_alvo_wamid text, p_ocorrido_em timestamptz default now(), p_dados jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  m       public.messages%rowtype;
  v_texto text := nullif(btrim(coalesce(p_dados ->> 'texto', '')), '');
begin
  select * into m from public.messages
   where wa_message_id = p_alvo_wamid and direction = 'in'::app.msg_direction;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_desconhecida');
  end if;
  if p_tipo = 'revoke' then
    update public.messages
       set apagada_pelo_contato_em = coalesce(apagada_pelo_contato_em, coalesce(p_ocorrido_em, now()))
     where id = m.id;
  elsif p_tipo = 'edit' then
    update public.messages
       set conteudo = coalesce(conteudo, '{}'::jsonb)
                      || jsonb_build_object('versoes', coalesce(conteudo -> 'versoes', '[]'::jsonb)
                                                       || jsonb_build_array(to_jsonb(body))),
           body = coalesce(v_texto, body),
           editada_pelo_contato_em = coalesce(p_ocorrido_em, now())
     where id = m.id;
  else
    return jsonb_build_object('ok', false, 'motivo', 'evento_desconhecido');
  end if;
  return jsonb_build_object('ok', true, 'message_id', m.id, 'conversation_id', m.conversation_id);
end $$;
revoke all on function public.wa_entrada_evento(text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.wa_entrada_evento(text, text, timestamptz, jsonb) to service_role;

-- A mensagem de voz foi ouvida (recibo `played`). Ouvida é lida.
create or replace function public.wa_recibo_ouvido(p_wamid text, p_ocorrido_em timestamptz default now())
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  update public.messages
     set ouvida_em = coalesce(ouvida_em, coalesce(p_ocorrido_em, now())),
         read_at   = coalesce(read_at, coalesce(p_ocorrido_em, now())),
         status    = case when status in ('sent'::app.msg_status, 'delivered'::app.msg_status)
                          then 'read'::app.msg_status else status end
   where wa_message_id = p_wamid and direction = 'out'::app.msg_direction;
  if found then
    return jsonb_build_object('ok', true);
  end if;
  update public.wa_grupo_mensagens set read_at = coalesce(read_at, coalesce(p_ocorrido_em, now()))
   where wa_message_id = p_wamid and direction = 'out'::app.msg_direction;
  return jsonb_build_object('ok', found, 'motivo', case when found then null else 'mensagem_desconhecida' end);
end $$;
revoke all on function public.wa_recibo_ouvido(text, timestamptz) from public, anon, authenticated;
grant execute on function public.wa_recibo_ouvido(text, timestamptz) to service_role;


-- =====================================================================
-- §7 · O que sai: o lote leva o que a Meta precisa para cada tipo novo
-- =====================================================================
create or replace function public.wa_saida_proximos(p_qty integer default 10)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_bruto     jsonb;
  v_item      jsonb;
  v_out       jsonb := '[]'::jsonb;
  v_recusados jsonb;
  v_modelo    jsonb;
  v_precisa   boolean;
  v_mid       uuid;
  v_msgid     bigint;
  v_conv      uuid;
  v_extra     jsonb;
begin
  v_bruto     := app.wa_proximos(p_qty);
  v_recusados := coalesce(v_bruto -> 'recusados', '[]'::jsonb);

  for v_item in select * from jsonb_array_elements(v_recusados) loop
    if (v_item ->> 'acao') = 'adiado' and (v_item ->> 'message_id') is not null then
      update public.messages
         set error_detail = left(app.wa_motivo_legivel(v_item ->> 'motivo',
                                                       (v_item ->> 'quando')::timestamptz), 2000)
       where id = (v_item ->> 'message_id')::uuid
         and status = 'queued'::app.msg_status;
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(v_bruto -> 'itens', '[]'::jsonb)) loop
    v_mid   := (v_item ->> 'message_id')::uuid;
    v_conv  := (v_item ->> 'conversation_id')::uuid;
    v_msgid := (v_item ->> 'msg_id')::bigint;

    -- NOVO (27/10/2026): bloqueada no meio do caminho não sai.
    if exists (select 1 from public.conversations c where c.id = v_conv and c.bloqueada_em is not null) then
      update public.messages
         set status = 'failed'::app.msg_status, error_code = 'conversa_bloqueada',
             error_detail = 'O contato foi bloqueado antes de a mensagem sair.', failed_at = now()
       where id = v_mid and status = 'queued'::app.msg_status;
      perform pgmq.archive('wa_outbound', v_msgid);
      v_recusados := v_recusados || jsonb_build_array(
        jsonb_build_object('message_id', v_mid, 'motivo', 'conversa_bloqueada', 'acao', 'morto'));
      continue;
    end if;

    v_precisa := not app.janela_de_24h_aberta(v_conv, now());

    v_modelo := app.wa_modelo_da_meta((v_item ->> 'template_id')::int);

    if v_precisa and not coalesce((v_modelo ->> 'aprovado')::boolean, false) then
      update public.messages
         set status = 'failed'::app.msg_status,
             error_code = 'sem_modelo_aprovado',
             error_detail = case
               when (v_modelo ->> 'situacao') = 'sem_modelo' then
                 'Fora da janela de 24 h e sem modelo: a Meta só aceita template aprovado para iniciar conversa.'
               else
                 'Fora da janela de 24 h e o modelo ' || coalesce(v_modelo ->> 'codigo', '(sem código)') ||
                 ' ainda não está aprovado pela Meta (situação: ' ||
                 (v_modelo ->> 'situacao') || ').'
               end,
             failed_at = now()
       where id = v_mid and status = 'queued'::app.msg_status;
      update public.message_drafts
         set status = 'descartado',
             discard_reason = 'recusado na entrega: sem modelo aprovado pela Meta'
       where message_id = v_mid and status in ('aprovado', 'enviado');
      perform pgmq.archive('wa_outbound', v_msgid);
      v_recusados := v_recusados || jsonb_build_array(
        jsonb_build_object('message_id', v_mid, 'motivo', 'sem_modelo_aprovado', 'acao', 'morto'));
      continue;
    end if;

    -- NOVO (27/10/2026): a resposta citada, o alvo da reação, o conteúdo
    -- (localização, contatos, botões), o nome do documento e a figurinha.
    select jsonb_build_object(
             'responde_a_wamid', coalesce(r.wa_message_id, m.responde_a_wamid),
             'reage_a_wamid',    coalesce(t.wa_message_id, m.reage_a_wamid),
             'conteudo',         m.conteudo,
             'media_nome',       m.media_nome,
             'tipo_na_meta',     m.tipo_na_meta)
      into v_extra
      from public.messages m
      left join public.messages r on r.id = m.responde_a
      left join public.messages t on t.id = m.reage_a
     where m.id = v_mid;

    v_out := v_out || jsonb_build_array(v_item || coalesce(v_extra, '{}'::jsonb) || jsonb_build_object(
      'janela_aberta', not v_precisa,
      'modelo', case when coalesce((v_modelo ->> 'aprovado')::boolean, false)
                     then v_modelo - 'aprovado' - 'situacao' else null end,
      'botoes', coalesce((select t.botoes from public.message_templates t
                           where t.id = (v_item ->> 'template_id')::int), '[]'::jsonb),
      'link_codigo', coalesce((select x.codigo from public.envios_em_massa_itens x
                                where x.message_id = v_mid), 'crm')));
  end loop;

  return jsonb_build_object('itens', v_out, 'recusados', v_recusados);
end $$;
revoke all on function public.wa_saida_proximos(integer) from public, anon, authenticated;
grant execute on function public.wa_saida_proximos(integer) to service_role;

-- A última pergunta antes de mandar: ninguém cancelou nesse meio-tempo? O
-- intervalo entre aberturas pode passar de 3 minutos com o item já fora da
-- fila; é nesse tempo que o "apagar" de quem se arrependeu tem de valer.
create or replace function public.wa_saida_ainda_vale(p_message_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.messages m
                  where m.id = p_message_id and m.status = 'queued'::app.msg_status
                    and m.apagada_em is null)
$$;
revoke all on function public.wa_saida_ainda_vale(uuid) from public, anon, authenticated;
grant execute on function public.wa_saida_ainda_vale(uuid) to service_role;

-- Saiu mesmo depois do cancelamento (a corrida de milissegundos entre a
-- última pergunta e a Meta): o registro diz a verdade — saiu.
create or replace function app.wa_sucesso(p_msg_id bigint, p_message_id uuid, p_wamid text,
                                          p_custo numeric default null, p_categoria text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages
     set status = 'sent'::app.msg_status,
         wa_message_id = coalesce(wa_message_id, p_wamid),
         sent_at = coalesce(sent_at, now()),
         cost_usd = coalesce(p_custo, cost_usd),
         billable_category = coalesce(p_categoria, billable_category),
         error_code   = case when status = 'failed'::app.msg_status then null else error_code end,
         error_detail = case when status = 'failed'::app.msg_status then null else error_detail end,
         failed_at    = case when status = 'failed'::app.msg_status then null else failed_at end,
         apagada_em   = case when status = 'failed'::app.msg_status then null else apagada_em end,
         apagada_por  = case when status = 'failed'::app.msg_status then null else apagada_por end
   where id = p_message_id
     and (status = 'queued'::app.msg_status
          or (status = 'failed'::app.msg_status and error_code = 'cancelada'));
  return pgmq.archive('wa_outbound', p_msg_id);
end $$;
revoke all on function app.wa_sucesso(bigint, uuid, text, numeric, text) from public, anon, authenticated;


-- =====================================================================
-- §8 · Grupos
-- =====================================================================
-- A API de grupos (06/10/2025) só funciona para conta oficial da Meta (OBA,
-- o selo verde), cria grupos de até 8 pessoas contando o próprio número, e
-- ninguém é posto dentro: entra quem tocar no link de convite (e, com
-- aprovação ligada, quem o time aprovar). O grupo é DO NÚMERO da empresa: só
-- existe o que foi criado pela API.
--
-- Moram fora de `conversations` e `messages` de propósito: o fio 1:1 tem
-- telefone de um contato, opt-out, funil, robô, lead e janela por pessoa —
-- nada disso é de um grupo, e cada gatilho de `messages` teria de aprender a
-- pular grupo. Aqui o grupo tem a janela dele (qualquer pessoa que escreve
-- abre 24 h para o grupo todo) e o resto é o mesmo vocabulário.

create table if not exists public.wa_grupos (
  id               uuid primary key default gen_random_uuid(),
  business_number  text not null check (business_number ~ '^\+[1-9][0-9]{7,14}$'),
  group_id         text unique,
  pedido_id        text,
  assunto          text not null check (length(btrim(assunto)) between 1 and 128),
  descricao        text check (descricao is null or length(descricao) <= 2048),
  aprovacao        text not null default 'approval_required'
                     check (aprovacao in ('auto_approve', 'approval_required')),
  link_convite     text,
  foto_path        text,
  estado           text not null default 'criando'
                     check (estado in ('criando', 'ativo', 'suspenso', 'apagado', 'falhou')),
  erro             text,
  organization_id  uuid references public.organizations(id) on delete set null,
  criado_por       uuid references public.profiles(id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  apagado_em       timestamptz,
  last_message_at  timestamptz,
  last_inbound_at  timestamptz,
  unread_count     int not null default 0 check (unread_count >= 0),
  participantes_total int
);
create index if not exists wa_grupos_lista_idx on public.wa_grupos (last_message_at desc nulls last)
  where estado <> 'apagado';

create table if not exists public.wa_grupo_participantes (
  grupo_id  uuid not null references public.wa_grupos(id) on delete cascade,
  wa_id     text not null,
  nome      text,
  entrou_em timestamptz,
  saiu_em   timestamptz,
  primary key (grupo_id, wa_id)
);

create table if not exists public.wa_grupo_pedidos (
  grupo_id     uuid not null references public.wa_grupos(id) on delete cascade,
  pedido_id    text not null,
  wa_id        text,
  criado_em    timestamptz not null default now(),
  decisao      text check (decisao is null or decisao in ('aprovado', 'recusado', 'cancelado')),
  decidido_por uuid references public.profiles(id) on delete set null,
  decidido_em  timestamptz,
  primary key (grupo_id, pedido_id)
);

create table if not exists public.wa_grupo_mensagens (
  id            uuid primary key default gen_random_uuid(),
  grupo_id      uuid not null references public.wa_grupos(id) on delete cascade,
  direction     app.msg_direction not null,
  type          app.msg_type not null default 'text',
  tipo_na_meta  text,
  status        app.msg_status not null,
  wa_message_id text unique,
  de_wa_id      text,
  de_nome       text,
  sent_by       uuid references public.profiles(id) on delete set null,
  body          text check (body is null or not app.tem_cpf(body)),
  media_path    text,
  media_mime    text,
  media_id      text,
  media_nome    text check (media_nome is null or length(media_nome) between 1 and 240),
  conteudo      jsonb check (conteudo is null or jsonb_typeof(conteudo) = 'object'),
  responde_a    uuid references public.wa_grupo_mensagens(id) on delete set null,
  responde_a_wamid text,
  reage_a       uuid references public.wa_grupo_mensagens(id) on delete set null,
  reage_a_wamid text,
  error_code    text,
  error_detail  text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz,
  failed_at     timestamptz,
  apagada_em    timestamptz,
  apagada_por   uuid references public.profiles(id) on delete set null,
  fixada_ate    timestamptz
);
create index if not exists wa_grupo_mensagens_fio_idx on public.wa_grupo_mensagens (grupo_id, created_at);
create index if not exists wa_grupo_mensagens_midia_idx on public.wa_grupo_mensagens (created_at desc)
  where direction = 'in'::app.msg_direction and media_id is not null and media_path is null;

alter table public.wa_grupos enable row level security;
alter table public.wa_grupo_participantes enable row level security;
alter table public.wa_grupo_pedidos enable row level security;
alter table public.wa_grupo_mensagens enable row level security;

-- Ler: quem vê todas as conversas. Escrever: só pelas funções abaixo.
drop policy if exists wa_grupos_select on public.wa_grupos;
create policy wa_grupos_select on public.wa_grupos
  for select to authenticated using ((select app.sees_all()));
drop policy if exists wa_grupo_participantes_select on public.wa_grupo_participantes;
create policy wa_grupo_participantes_select on public.wa_grupo_participantes
  for select to authenticated using ((select app.sees_all()));
drop policy if exists wa_grupo_pedidos_select on public.wa_grupo_pedidos;
create policy wa_grupo_pedidos_select on public.wa_grupo_pedidos
  for select to authenticated using ((select app.sees_all()));
drop policy if exists wa_grupo_mensagens_select on public.wa_grupo_mensagens;
create policy wa_grupo_mensagens_select on public.wa_grupo_mensagens
  for select to authenticated using ((select app.sees_all()));

alter table public.wa_acoes
  drop constraint if exists wa_acoes_grupo_id_fkey,
  add constraint wa_acoes_grupo_id_fkey foreign key (grupo_id) references public.wa_grupos(id) on delete cascade;

drop trigger if exists audit_wa_grupos on public.wa_grupos;
create trigger audit_wa_grupos after insert or delete or update on public.wa_grupos
  for each row execute function app.audit();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and tablename = 'wa_grupos') then
      alter publication supabase_realtime add table public.wa_grupos;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and tablename = 'wa_grupo_mensagens') then
      alter publication supabase_realtime add table public.wa_grupo_mensagens;
    end if;
  end if;
end $$;

comment on table public.wa_grupos is
  'Grupos de WhatsApp criados pela API de grupos da Meta (27/10/2026). Só conta oficial (OBA), até 8 pessoas, entrada por link. Escrita só pelas funções grupo_* e pelo worker-wa.';

-- O número dos grupos: o padrão do envio, ou o da conversa mais recente.
create or replace function app.wa_numero_dos_grupos()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.wa_numero_padrao(),
                  (select c.business_number from public.conversations c
                    order by c.last_message_at desc nulls last limit 1))
$$;
revoke all on function app.wa_numero_dos_grupos() from public, anon, authenticated;
grant execute on function app.wa_numero_dos_grupos() to service_role;

create or replace function app.grupo_pedir(p_grupo_id uuid, p_tipo text, p_dados jsonb default '{}'::jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.wa_acoes (tipo, grupo_id, dados, pedida_por)
  values (p_tipo, p_grupo_id, coalesce(p_dados, '{}'::jsonb), auth.uid())
  returning id
$$;
revoke all on function app.grupo_pedir(uuid, text, jsonb) from public, anon, authenticated;

-- A janela do grupo: alguém do grupo escreveu nas últimas 24 h.
create or replace function app.grupo_janela_aberta(p_grupo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.wa_grupos g
                  where g.id = p_grupo_id and g.last_inbound_at > now() - interval '24 hours')
$$;
revoke all on function app.grupo_janela_aberta(uuid) from public, anon;
grant execute on function app.grupo_janela_aberta(uuid) to authenticated;

create or replace function app.grupo_posso()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null and app.is_manager()
$$;
revoke all on function app.grupo_posso() from public, anon;

create or replace function public.grupo_criar(p_assunto text, p_descricao text default null,
                                              p_aprovacao text default 'approval_required',
                                              p_organization_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_numero text := app.wa_numero_dos_grupos();
  v_ass    text := nullif(btrim(coalesce(p_assunto, '')), '');
  v_desc   text := nullif(btrim(coalesce(p_descricao, '')), '');
begin
  if not app.grupo_posso() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if v_ass is null or length(v_ass) > 128 then
    return jsonb_build_object('ok', false, 'motivo', 'nome_de_1_a_128_letras');
  end if;
  if v_desc is not null and length(v_desc) > 2048 then
    return jsonb_build_object('ok', false, 'motivo', 'descricao_longa_demais');
  end if;
  if v_numero is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_numero_do_whatsapp');
  end if;
  insert into public.wa_grupos (business_number, assunto, descricao, aprovacao, organization_id, criado_por)
  values (v_numero, v_ass, v_desc,
          case when p_aprovacao = 'auto_approve' then 'auto_approve' else 'approval_required' end,
          p_organization_id, auth.uid())
  returning id into v_id;
  perform app.grupo_pedir(v_id, 'grupo_criar',
                          jsonb_build_object('assunto', v_ass, 'descricao', v_desc,
                                             'aprovacao', case when p_aprovacao = 'auto_approve'
                                                               then 'auto_approve' else 'approval_required' end));
  return jsonb_build_object('ok', true, 'grupo_id', v_id);
end $$;
revoke all on function public.grupo_criar(text, text, text, uuid) from public, anon;
grant execute on function public.grupo_criar(text, text, text, uuid) to authenticated;

create or replace function public.grupo_atualizar(p_grupo_id uuid, p_assunto text default null,
                                                  p_descricao text default null, p_foto_path text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g      public.wa_grupos%rowtype;
  v_ass  text := nullif(btrim(coalesce(p_assunto, '')), '');
  v_dados jsonb := '{}'::jsonb;
begin
  if not app.grupo_posso() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into g from public.wa_grupos where id = p_grupo_id;
  if not found or g.estado not in ('ativo') or g.group_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'grupo_nao_esta_ativo');
  end if;
  if v_ass is not null then
    if length(v_ass) > 128 then
      return jsonb_build_object('ok', false, 'motivo', 'nome_de_1_a_128_letras');
    end if;
    v_dados := v_dados || jsonb_build_object('assunto', v_ass);
  end if;
  if p_descricao is not null then
    if length(p_descricao) > 2048 then
      return jsonb_build_object('ok', false, 'motivo', 'descricao_longa_demais');
    end if;
    v_dados := v_dados || jsonb_build_object('descricao', btrim(p_descricao));
  end if;
  if nullif(btrim(coalesce(p_foto_path, '')), '') is not null then
    -- Só a foto que subiu para a pasta DESTE grupo: o worker manda à Meta o
    -- que estiver no caminho, e o balde guarda as mídias de todas as conversas.
    if p_foto_path not like 'grupos/' || g.id || '/%' then
      return jsonb_build_object('ok', false, 'motivo', 'arquivo_de_outro_lugar');
    end if;
    v_dados := v_dados || jsonb_build_object('foto_path', p_foto_path);
  end if;
  if v_dados = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'motivo', 'nada_mudou');
  end if;
  perform app.grupo_pedir(g.id, 'grupo_atualizar', v_dados);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.grupo_atualizar(uuid, text, text, text) from public, anon;
grant execute on function public.grupo_atualizar(uuid, text, text, text) to authenticated;

create or replace function public.grupo_apagar(p_grupo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.wa_grupos%rowtype;
begin
  if not app.grupo_posso() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into g from public.wa_grupos where id = p_grupo_id;
  if not found or g.estado = 'apagado' then
    return jsonb_build_object('ok', false, 'motivo', 'grupo_inexistente');
  end if;
  -- Grupo que a Meta nunca criou não precisa de pedido: some do CRM.
  if g.group_id is null then
    update public.wa_grupos set estado = 'apagado', apagado_em = now(), atualizado_em = now() where id = g.id;
    return jsonb_build_object('ok', true);
  end if;
  perform app.grupo_pedir(g.id, 'grupo_apagar', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
comment on function public.grupo_apagar(uuid) is
  'Apaga o grupo na Meta: todo mundo sai, inclusive a empresa. No CRM o grupo fica, com as mensagens, marcado como apagado.';
revoke all on function public.grupo_apagar(uuid) from public, anon;
grant execute on function public.grupo_apagar(uuid) to authenticated;

create or replace function public.grupo_novo_link(p_grupo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.grupo_posso() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from public.wa_grupos where id = p_grupo_id and estado = 'ativo' and group_id is not null) then
    return jsonb_build_object('ok', false, 'motivo', 'grupo_nao_esta_ativo');
  end if;
  perform app.grupo_pedir(p_grupo_id, 'grupo_novo_convite', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
comment on function public.grupo_novo_link(uuid) is
  'Troca o link de convite do grupo: o antigo para de funcionar na hora.';
revoke all on function public.grupo_novo_link(uuid) from public, anon;
grant execute on function public.grupo_novo_link(uuid) to authenticated;

create or replace function public.grupo_sincronizar(p_grupo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.wa_grupos%rowtype;
begin
  if not app.grupo_posso() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into g from public.wa_grupos where id = p_grupo_id;
  if not found or g.group_id is null or g.estado = 'apagado' then
    return jsonb_build_object('ok', false, 'motivo', 'grupo_nao_esta_ativo');
  end if;
  perform app.grupo_pedir(g.id, 'grupo_sincronizar', '{}'::jsonb);
  if g.link_convite is null then
    perform app.grupo_pedir(g.id, 'grupo_convite', '{}'::jsonb);
  end if;
  if g.aprovacao = 'approval_required' then
    perform app.grupo_pedir(g.id, 'grupo_pedidos', '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.grupo_sincronizar(uuid) from public, anon;
grant execute on function public.grupo_sincronizar(uuid) to authenticated;

-- Mandar o convite numa conversa 1:1: é como a Meta quer que se convide.
create or replace function public.grupo_convidar(p_grupo_id uuid, p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g      public.wa_grupos%rowtype;
  v_novo uuid;
begin
  if not app.grupo_posso() or not app.posso_mexer_na_conversa(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into g from public.wa_grupos where id = p_grupo_id;
  if not found or g.estado <> 'ativo' or g.link_convite is null then
    return jsonb_build_object('ok', false, 'motivo', 'grupo_sem_link');
  end if;
  begin
    insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
    values (p_conversation_id, 'out', 'text', 'queued',
            'Entre no grupo "' || g.assunto || '" do WhatsApp: ' || g.link_convite,
            'human', auth.uid(), 'crm')
    returning id into v_novo;
  exception when insufficient_privilege or check_violation then
    return jsonb_build_object('ok', false, 'motivo', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'message_id', v_novo);
end $$;
revoke all on function public.grupo_convidar(uuid, uuid) from public, anon;
grant execute on function public.grupo_convidar(uuid, uuid) to authenticated;

create or replace function public.grupo_decidir(p_grupo_id uuid, p_pedidos text[], p_aprovar boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.grupo_posso() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if coalesce(array_length(p_pedidos, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'nenhum_pedido');
  end if;
  if not exists (select 1 from public.wa_grupos where id = p_grupo_id and estado = 'ativo') then
    return jsonb_build_object('ok', false, 'motivo', 'grupo_nao_esta_ativo');
  end if;
  perform app.grupo_pedir(p_grupo_id, case when p_aprovar then 'grupo_aprovar' else 'grupo_recusar' end,
                          jsonb_build_object('pedidos', to_jsonb(p_pedidos)));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.grupo_decidir(uuid, text[], boolean) from public, anon;
grant execute on function public.grupo_decidir(uuid, text[], boolean) to authenticated;

create or replace function public.grupo_remover(p_grupo_id uuid, p_wa_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.grupo_posso() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if coalesce(array_length(p_wa_ids, 1), 0) not between 1 and 8 then
    return jsonb_build_object('ok', false, 'motivo', 'de_1_a_8_pessoas');
  end if;
  if not exists (select 1 from public.wa_grupos where id = p_grupo_id and estado = 'ativo') then
    return jsonb_build_object('ok', false, 'motivo', 'grupo_nao_esta_ativo');
  end if;
  perform app.grupo_pedir(p_grupo_id, 'grupo_remover', jsonb_build_object('wa_ids', to_jsonb(p_wa_ids)));
  return jsonb_build_object('ok', true);
end $$;
comment on function public.grupo_remover(uuid, text[]) is
  'Tira pessoas do grupo. Quem é tirado não volta pelo link (regra da Meta).';
revoke all on function public.grupo_remover(uuid, text[]) from public, anon;
grant execute on function public.grupo_remover(uuid, text[]) to authenticated;

create or replace function public.grupo_enviar(
  p_grupo_id uuid, p_tipo text default 'text', p_texto text default null,
  p_media_path text default null, p_media_mime text default null, p_media_nome text default null,
  p_responde_a uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g       public.wa_grupos%rowtype;
  v_tipo  app.msg_type;
  v_corpo text := nullif(btrim(coalesce(p_texto, '')), '');
  v_nome  text;
  v_id    uuid;
begin
  if not app.grupo_posso() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into g from public.wa_grupos where id = p_grupo_id;
  if not found or g.estado <> 'ativo' or g.group_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'grupo_nao_esta_ativo');
  end if;
  -- Grupo aceita texto e mídia (a Meta não leva botões, lista, localização
  -- nem contato para grupo).
  if p_tipo not in ('text', 'image', 'video', 'audio', 'document') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_nao_vai_para_grupo');
  end if;
  v_tipo := p_tipo::app.msg_type;
  if v_tipo = 'text'::app.msg_type and v_corpo is null then
    return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
  end if;
  if v_tipo <> 'text'::app.msg_type and nullif(btrim(coalesce(p_media_path, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_arquivo');
  end if;
  -- O arquivo é o que subiu para a pasta deste grupo, e nenhum outro do balde.
  if v_tipo <> 'text'::app.msg_type and p_media_path not like 'grupos/' || g.id || '/%' then
    return jsonb_build_object('ok', false, 'motivo', 'arquivo_de_outro_lugar');
  end if;
  if v_corpo is not null and app.tem_cpf(v_corpo) then
    return jsonb_build_object('ok', false, 'motivo', 'tem_cpf');
  end if;
  -- A janela do grupo: alguém escreveu nas últimas 24 h. Fora dela, a Meta
  -- só aceita modelo aprovado, e modelo de grupo não é desta entrega.
  if not app.grupo_janela_aberta(g.id) then
    return jsonb_build_object('ok', false, 'motivo', 'janela_do_grupo_fechada');
  end if;
  if p_responde_a is not null and not exists (
       select 1 from public.wa_grupo_mensagens m where m.id = p_responde_a and m.grupo_id = g.id) then
    return jsonb_build_object('ok', false, 'motivo', 'citada_de_outro_grupo');
  end if;

  -- A assinatura de sempre: "*Ana:*" na primeira linha.
  v_nome := app.primeiro_nome(auth.uid());
  if v_corpo is not null and v_nome is not null and v_tipo <> 'audio'::app.msg_type
     and coalesce((select (s.value ->> 'assinar_com_nome')::boolean
                     from public.app_settings s where s.key = 'whatsapp.envio'), true) then
    v_corpo := '*' || v_nome || ':*' || E'\n' || v_corpo;
  end if;

  insert into public.wa_grupo_mensagens (grupo_id, direction, type, status, sent_by, body,
                                         media_path, media_mime, media_nome, responde_a)
  values (g.id, 'out', v_tipo, 'queued', auth.uid(), v_corpo, p_media_path, p_media_mime,
          case when v_tipo = 'document'::app.msg_type
               then coalesce(nullif(btrim(coalesce(p_media_nome, '')), ''), 'documento') end,
          p_responde_a)
  returning id into v_id;
  update public.wa_grupos set last_message_at = now(), atualizado_em = now() where id = g.id;
  perform app.grupo_pedir(g.id, 'grupo_enviar', jsonb_build_object('mensagem_id', v_id));
  return jsonb_build_object('ok', true, 'mensagem_id', v_id);
end $$;
revoke all on function public.grupo_enviar(uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.grupo_enviar(uuid, text, text, text, text, text, uuid) to authenticated;

create or replace function public.grupo_apagar_mensagem(p_mensagem_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.grupo_posso() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.wa_grupo_mensagens set apagada_em = now(), apagada_por = auth.uid()
   where id = p_mensagem_id and apagada_em is null;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.grupo_apagar_mensagem(uuid) from public, anon;
grant execute on function public.grupo_apagar_mensagem(uuid) to authenticated;

-- Fixar no grupo (até 3, por 1 a 30 dias). `p_dias` nulo desafixa.
create or replace function public.grupo_fixar_mensagem(p_mensagem_id uuid, p_dias int default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.wa_grupo_mensagens%rowtype;
begin
  if not app.grupo_posso() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into m from public.wa_grupo_mensagens where id = p_mensagem_id;
  if not found or m.wa_message_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_sem_id_na_meta');
  end if;
  if p_dias is not null and p_dias not between 1 and 30 then
    return jsonb_build_object('ok', false, 'motivo', 'de_1_a_30_dias');
  end if;
  perform app.grupo_pedir(m.grupo_id, 'grupo_fixar',
                          jsonb_build_object('mensagem_id', m.id, 'wamid', m.wa_message_id, 'dias', p_dias));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.grupo_fixar_mensagem(uuid, int) from public, anon;
grant execute on function public.grupo_fixar_mensagem(uuid, int) to authenticated;

create or replace function public.grupo_marcar_lido(p_grupo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wamid text;
begin
  if not app.grupo_posso() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.wa_grupos set unread_count = 0 where id = p_grupo_id and unread_count > 0;
  if app.wa_opcao('confirmar_leitura') then
    select m.wa_message_id into v_wamid from public.wa_grupo_mensagens m
     where m.grupo_id = p_grupo_id and m.direction = 'in'::app.msg_direction
       and m.wa_message_id is not null and m.type <> 'system'::app.msg_type
     order by m.created_at desc limit 1;
    if v_wamid is not null then
      insert into public.wa_acoes (tipo, grupo_id, dados, chave, pedida_por)
      values ('ler', p_grupo_id, jsonb_build_object('wamid', v_wamid), 'ler:' || v_wamid, auth.uid())
      on conflict (chave) where chave is not null do nothing;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.grupo_marcar_lido(uuid) from public, anon;
grant execute on function public.grupo_marcar_lido(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- O que chega dos grupos (worker)
-- ---------------------------------------------------------------------
-- Uma linha de sistema no fio do grupo ("Maria entrou pelo link").
create or replace function app.grupo_linha_de_sistema(p_grupo_id uuid, p_evento text, p_wa_id text,
                                                      p_quando timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.wa_grupo_mensagens (grupo_id, direction, type, status, de_wa_id, de_nome, conteudo, created_at)
  select p_grupo_id, 'in', 'system', 'received', p_wa_id,
         (select p.nome from public.wa_grupo_participantes p where p.grupo_id = p_grupo_id and p.wa_id = p_wa_id),
         jsonb_build_object('evento', p_evento), coalesce(p_quando, now())
$$;
revoke all on function app.grupo_linha_de_sistema(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function app.grupo_linha_de_sistema(uuid, text, text, timestamptz) to service_role;

create or replace function public.wa_grupo_entrada_registrar(
  p_wamid text, p_business_number text, p_group_id text, p_de text, p_de_nome text,
  p_type text default 'text', p_body text default null, p_media_id text default null,
  p_media_mime text default null, p_occurred_at timestamptz default now(), p_extra jsonb default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_grupo uuid;
  v_msg   uuid;
  v_bruto text := lower(nullif(btrim(coalesce(p_type, '')), ''));
  v_tipo  app.msg_type := app.wa_tipo_da_meta(p_type);
  v_quando timestamptz := coalesce(p_occurred_at, now());
  v_wa    text := nullif(regexp_replace(coalesce(p_de, ''), '\D', '', 'g'), '');
  v_resp  text := nullif(btrim(coalesce(p_extra ->> 'responde_a_wamid', '')), '');
  v_reage text := nullif(btrim(coalesce(p_extra ->> 'reage_a_wamid', '')), '');
begin
  select m.id, m.grupo_id into v_msg, v_grupo from public.wa_grupo_mensagens m where m.wa_message_id = p_wamid;
  if found then
    return jsonb_build_object('novo', false, 'message_id', v_msg, 'grupo_id', v_grupo);
  end if;

  select g.id into v_grupo from public.wa_grupos g where g.group_id = p_group_id;
  if v_grupo is null then
    -- Grupo criado pela API fora do CRM (ou antes desta tabela): nasce com
    -- nome provisório; a sincronização traz o nome de verdade.
    insert into public.wa_grupos (business_number, group_id, assunto, estado)
    values (coalesce(app.normalize_phone_br(p_business_number), p_business_number), p_group_id,
            'Grupo do WhatsApp', 'ativo')
    returning id into v_grupo;
    insert into public.wa_acoes (tipo, grupo_id) values ('grupo_sincronizar', v_grupo);
  end if;

  if v_wa is not null then
    insert into public.wa_grupo_participantes (grupo_id, wa_id, nome, entrou_em)
    values (v_grupo, v_wa, nullif(btrim(coalesce(p_de_nome, '')), ''), v_quando)
    on conflict (grupo_id, wa_id) do update
       set nome = coalesce(excluded.nome, public.wa_grupo_participantes.nome),
           saiu_em = null;
  end if;

  insert into public.wa_grupo_mensagens (grupo_id, direction, type, tipo_na_meta, status, wa_message_id,
                                         de_wa_id, de_nome, body, media_id, media_mime, media_nome,
                                         conteudo, responde_a_wamid, responde_a, reage_a_wamid, reage_a,
                                         created_at)
  values (v_grupo, 'in', v_tipo, case when v_bruto is distinct from v_tipo::text then left(v_bruto, 40) end,
          'received', p_wamid, v_wa, nullif(btrim(coalesce(p_de_nome, '')), ''),
          case when p_body is not null and app.tem_cpf(p_body) then null else p_body end,
          p_media_id, p_media_mime,
          left(nullif(btrim(coalesce(p_extra ->> 'media_nome', '')), ''), 240),
          case when jsonb_typeof(p_extra -> 'conteudo') = 'object' and p_extra -> 'conteudo' <> '{}'::jsonb
               then p_extra -> 'conteudo' end,
          v_resp, (select r.id from public.wa_grupo_mensagens r where v_resp is not null and r.wa_message_id = v_resp),
          v_reage, (select r.id from public.wa_grupo_mensagens r where v_reage is not null and r.wa_message_id = v_reage),
          v_quando)
  on conflict (wa_message_id) do nothing
  returning id into v_msg;

  if v_msg is not null then
    update public.wa_grupos
       set last_inbound_at = greatest(coalesce(last_inbound_at, v_quando), v_quando),
           last_message_at = greatest(coalesce(last_message_at, v_quando), v_quando),
           unread_count = unread_count + case when v_tipo = 'reaction'::app.msg_type then 0 else 1 end,
           atualizado_em = now()
     where id = v_grupo;
  end if;
  return jsonb_build_object('novo', v_msg is not null, 'message_id', v_msg, 'grupo_id', v_grupo);
end $$;
revoke all on function public.wa_grupo_entrada_registrar(text, text, text, text, text, text, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.wa_grupo_entrada_registrar(text, text, text, text, text, text, text, text, text, timestamptz, jsonb)
  to service_role;

create or replace function public.wa_grupo_midia_registrar(p_message_id uuid, p_media_path text)
returns boolean
language sql
set search_path = ''
as $$
  update public.wa_grupo_mensagens set media_path = p_media_path
   where id = p_message_id and media_path is null
  returning true
$$;
revoke all on function public.wa_grupo_midia_registrar(uuid, text) from public, anon, authenticated;
grant execute on function public.wa_grupo_midia_registrar(uuid, text) to service_role;

create or replace function public.wa_grupo_status_registrar(p_wamid text, p_status text,
                                                            p_ocorrido_em timestamptz default now(),
                                                            p_codigo text default null, p_detalhe text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  m        public.wa_grupo_mensagens%rowtype;
  v_peso   constant jsonb := '{"queued":0,"sent":1,"delivered":2,"read":3,"failed":9,"received":0}'::jsonb;
  v_quando timestamptz := coalesce(p_ocorrido_em, now());
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_desconhecido');
  end if;
  select * into m from public.wa_grupo_mensagens where wa_message_id = p_wamid;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_desconhecida');
  end if;
  -- Em grupo, `delivered` e `read` chegam de cada pessoa: o primeiro vale.
  if (v_peso ->> p_status)::int <= (v_peso ->> m.status::text)::int then
    return jsonb_build_object('ok', true, 'motivo', 'estado_nao_retrocede');
  end if;
  update public.wa_grupo_mensagens
     set status       = p_status::app.msg_status,
         sent_at      = case when p_status = 'sent' then coalesce(sent_at, v_quando) else sent_at end,
         delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, v_quando) else delivered_at end,
         read_at      = case when p_status = 'read' then coalesce(read_at, v_quando) else read_at end,
         failed_at    = case when p_status = 'failed' then coalesce(failed_at, v_quando) else failed_at end,
         error_code   = case when p_status = 'failed' then coalesce(nullif(btrim(coalesce(p_codigo, '')), ''), 'erro_meta') else error_code end,
         error_detail = case when p_status = 'failed' then left(coalesce(p_detalhe, ''), 2000) else error_detail end
   where id = m.id;
  return jsonb_build_object('ok', true, 'message_id', m.id);
end $$;
revoke all on function public.wa_grupo_status_registrar(text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.wa_grupo_status_registrar(text, text, timestamptz, text, text) to service_role;

-- Os quatro webhooks de grupo, já traduzidos pelo adaptador para um item só:
-- { campo, tipo, group_id, request_id, subject, invite_link,
--   join_approval_mode, join_request_id, wa_id, added[], removed[],
--   settings{assunto, descricao, foto}, errors[], ocorrido_em }
create or replace function public.wa_grupo_evento_registrar(p_item jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tipo    text := p_item ->> 'tipo';
  v_gid     text := p_item ->> 'group_id';
  v_quando  timestamptz := coalesce((p_item ->> 'ocorrido_em')::timestamptz, now());
  v_grupo   uuid;
  v_erro    text := nullif(left(coalesce(p_item #>> '{errors,0,message}', p_item #>> '{errors,0,title}', ''), 500), '');
  v_p       jsonb;
  v_wa      text;
begin
  select g.id into v_grupo from public.wa_grupos g where g.group_id = v_gid;

  if v_tipo = 'group_create' then
    if v_grupo is null then
      select g.id into v_grupo from public.wa_grupos g
       where g.estado = 'criando'
         and ((p_item ->> 'request_id') is not null and g.pedido_id = p_item ->> 'request_id'
              or g.assunto = p_item ->> 'subject')
       order by (g.pedido_id = p_item ->> 'request_id') desc nulls last, g.criado_em desc
       limit 1;
    end if;
    if v_grupo is null then
      if v_gid is null then
        return jsonb_build_object('ok', false, 'motivo', 'grupo_desconhecido');
      end if;
      insert into public.wa_grupos (business_number, group_id, assunto, estado)
      values (coalesce(app.normalize_phone_br(p_item ->> 'numero'), app.wa_numero_dos_grupos()), v_gid,
              coalesce(nullif(p_item ->> 'subject', ''), 'Grupo do WhatsApp'), 'ativo')
      returning id into v_grupo;
    end if;
    if v_erro is not null and v_gid is null then
      update public.wa_grupos set estado = 'falhou', erro = v_erro, atualizado_em = now() where id = v_grupo;
    else
      update public.wa_grupos
         set group_id = coalesce(group_id, v_gid),
             estado = 'ativo', erro = null,
             link_convite = coalesce(nullif(p_item ->> 'invite_link', ''), link_convite),
             aprovacao = coalesce(nullif(p_item ->> 'join_approval_mode', ''), aprovacao),
             atualizado_em = now()
       where id = v_grupo;
    end if;
  elsif v_grupo is null then
    return jsonb_build_object('ok', false, 'motivo', 'grupo_desconhecido');
  elsif v_tipo = 'group_delete' then
    if v_erro is not null then
      update public.wa_grupos set erro = v_erro, atualizado_em = now() where id = v_grupo;
    else
      update public.wa_grupos set estado = 'apagado', apagado_em = coalesce(apagado_em, v_quando),
             atualizado_em = now() where id = v_grupo;
    end if;
  elsif v_tipo = 'group_participants_add' then
    for v_p in select * from jsonb_array_elements(coalesce(p_item -> 'added', '[]'::jsonb)) loop
      v_wa := nullif(regexp_replace(coalesce(v_p ->> 'wa_id', v_p ->> 'input', ''), '\D', '', 'g'), '');
      continue when v_wa is null;
      insert into public.wa_grupo_participantes (grupo_id, wa_id, entrou_em)
      values (v_grupo, v_wa, v_quando)
      on conflict (grupo_id, wa_id) do update set entrou_em = excluded.entrou_em, saiu_em = null;
      perform app.grupo_linha_de_sistema(v_grupo, 'entrou', v_wa, v_quando);
    end loop;
    if (p_item ->> 'join_request_id') is not null then
      update public.wa_grupo_pedidos set decisao = coalesce(decisao, 'aprovado'), decidido_em = coalesce(decidido_em, v_quando)
       where grupo_id = v_grupo and pedido_id = p_item ->> 'join_request_id';
    end if;
  elsif v_tipo = 'group_participants_remove' then
    for v_p in select * from jsonb_array_elements(coalesce(p_item -> 'removed', '[]'::jsonb)) loop
      v_wa := nullif(regexp_replace(coalesce(v_p ->> 'wa_id', v_p ->> 'input', ''), '\D', '', 'g'), '');
      continue when v_wa is null;
      update public.wa_grupo_participantes set saiu_em = v_quando where grupo_id = v_grupo and wa_id = v_wa;
      perform app.grupo_linha_de_sistema(v_grupo,
                                         case when p_item ->> 'initiated_by' = 'participant' then 'saiu' else 'removido' end,
                                         v_wa, v_quando);
    end loop;
  elsif v_tipo = 'group_join_request_created' then
    insert into public.wa_grupo_pedidos (grupo_id, pedido_id, wa_id, criado_em)
    values (v_grupo, p_item ->> 'join_request_id',
            nullif(regexp_replace(coalesce(p_item ->> 'wa_id', ''), '\D', '', 'g'), ''), v_quando)
    on conflict (grupo_id, pedido_id) do nothing;
  elsif v_tipo = 'group_join_request_revoked' then
    update public.wa_grupo_pedidos set decisao = 'cancelado', decidido_em = v_quando
     where grupo_id = v_grupo and pedido_id = p_item ->> 'join_request_id' and decisao is null;
  elsif v_tipo = 'group_settings_update' then
    update public.wa_grupos
       set assunto = case when (p_item #>> '{settings,assunto,ok}')::boolean
                          then coalesce(nullif(p_item #>> '{settings,assunto,texto}', ''), assunto) else assunto end,
           descricao = case when (p_item #>> '{settings,descricao,ok}')::boolean
                            then p_item #>> '{settings,descricao,texto}' else descricao end,
           erro = coalesce(v_erro,
                           case when (p_item #>> '{settings,assunto,ok}')::boolean is false
                                  or (p_item #>> '{settings,descricao,ok}')::boolean is false
                                  or (p_item #>> '{settings,foto,ok}')::boolean is false
                                then 'A Meta não aceitou parte da mudança do grupo.' end),
           atualizado_em = now()
     where id = v_grupo;
  elsif v_tipo = 'group_suspend' then
    update public.wa_grupos set estado = 'suspenso', atualizado_em = now() where id = v_grupo;
  elsif v_tipo = 'group_suspend_cleared' then
    update public.wa_grupos set estado = 'ativo', atualizado_em = now() where id = v_grupo and estado = 'suspenso';
  else
    return jsonb_build_object('ok', false, 'motivo', 'evento_desconhecido', 'tipo', v_tipo);
  end if;
  -- Todo evento mexe no grupo: é o `wa_grupos` que a tela escuta pelo Realtime,
  -- e o pedido para entrar ou a pessoa que saiu têm de aparecer na hora.
  update public.wa_grupos set atualizado_em = now() where id = v_grupo;
  return jsonb_build_object('ok', true, 'grupo_id', v_grupo);
end $$;
revoke all on function public.wa_grupo_evento_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.wa_grupo_evento_registrar(jsonb) to service_role;


-- =====================================================================
-- §9 · O perfil da empresa no WhatsApp (o "Sobre", o endereço, o site)
-- =====================================================================
-- Fica em `app_settings['whatsapp.perfil']`, escrito pelo worker depois de
-- ler da Meta. Editar é só do admin (Ajustes).
create or replace function public.wa_perfil_ler()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  insert into public.wa_acoes (tipo, dados, pedida_por) values ('perfil_ler', '{}'::jsonb, auth.uid());
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.wa_perfil_ler() from public, anon;
grant execute on function public.wa_perfil_ler() to authenticated;

create or replace function public.wa_perfil_salvar(p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb;
  v_sites jsonb;
begin
  if auth.uid() is null or not app.is_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if jsonb_typeof(p_dados) <> 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;
  -- Os tetos são os da Meta.
  if p_dados ? 'about' then
    if length(coalesce(p_dados ->> 'about', '')) not between 1 and 139 then
      return jsonb_build_object('ok', false, 'motivo', 'recado_de_1_a_139_letras');
    end if;
    v := v || jsonb_build_object('about', p_dados ->> 'about');
  end if;
  if p_dados ? 'address' then
    if length(coalesce(p_dados ->> 'address', '')) > 256 then
      return jsonb_build_object('ok', false, 'motivo', 'endereco_longo_demais');
    end if;
    v := v || jsonb_build_object('address', coalesce(p_dados ->> 'address', ''));
  end if;
  if p_dados ? 'description' then
    if length(coalesce(p_dados ->> 'description', '')) > 512 then
      return jsonb_build_object('ok', false, 'motivo', 'descricao_longa_demais');
    end if;
    v := v || jsonb_build_object('description', coalesce(p_dados ->> 'description', ''));
  end if;
  if p_dados ? 'email' then
    if length(coalesce(p_dados ->> 'email', '')) > 128 then
      return jsonb_build_object('ok', false, 'motivo', 'email_longo_demais');
    end if;
    v := v || jsonb_build_object('email', coalesce(p_dados ->> 'email', ''));
  end if;
  if p_dados ? 'websites' then
    v_sites := case when jsonb_typeof(p_dados -> 'websites') = 'array' then p_dados -> 'websites' else '[]'::jsonb end;
    if jsonb_array_length(v_sites) > 2
       or exists (select 1 from jsonb_array_elements_text(v_sites) s
                   where length(s) > 256 or s !~ '^https?://') then
      return jsonb_build_object('ok', false, 'motivo', 'ate_2_sites_com_http');
    end if;
    v := v || jsonb_build_object('websites', v_sites);
  end if;
  if p_dados ? 'vertical' then
    v := v || jsonb_build_object('vertical', upper(left(coalesce(p_dados ->> 'vertical', 'OTHER'), 40)));
  end if;
  if nullif(btrim(coalesce(p_dados ->> 'foto_path', '')), '') is not null then
    -- Só o que subiu para a pasta do perfil (a rota de foto do perfil).
    if (p_dados ->> 'foto_path') not like 'perfil/%' then
      return jsonb_build_object('ok', false, 'motivo', 'arquivo_de_outro_lugar');
    end if;
    v := v || jsonb_build_object('foto_path', p_dados ->> 'foto_path');
  end if;
  if v = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'motivo', 'nada_mudou');
  end if;
  insert into public.wa_acoes (tipo, dados, pedida_por) values ('perfil_salvar', v, auth.uid());
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.wa_perfil_salvar(jsonb) from public, anon;
grant execute on function public.wa_perfil_salvar(jsonb) to authenticated;


-- =====================================================================
-- §10 · O worker: tirar ações da fila, concluir, falhar
-- =====================================================================
create or replace function public.wa_acoes_proximas(p_qty int default 20)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  -- "Digitando…" que esperou mais de 20 s não serve para nada: os pontinhos
  -- duram 25 s e a pessoa pode já ter mandado a mensagem.
  update public.wa_acoes set estado = 'descartada', feita_em = now(), erro = 'passou_da_hora'
   where tipo = 'digitando' and estado = 'pendente' and pedida_em < now() - interval '20 seconds';

  with escolhidas as (
    select a.id from public.wa_acoes a
     where (a.estado = 'pendente' and a.proxima_em <= now())
        or (a.estado = 'fazendo' and a.comecada_em < now() - interval '2 minutes')
     order by (a.tipo in ('digitando', 'ler')) desc, a.pedida_em
     limit least(greatest(coalesce(p_qty, 20), 1), 50)
     for update skip locked
  ), marcadas as (
    update public.wa_acoes a
       set estado = 'fazendo', tentativas = a.tentativas + 1, comecada_em = now()
      from escolhidas e
     where a.id = e.id
    returning a.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id,
           'tipo', x.tipo,
           'tentativa', x.tentativas,
           'dados', x.dados,
           'conversation_id', x.conversation_id,
           'para', c.peer_phone_e164,
           'grupo_id', x.grupo_id,
           'group_id', g.group_id,
           'mensagem', case when x.tipo = 'grupo_enviar' then (
              select jsonb_build_object('id', m.id, 'type', m.type, 'body', m.body,
                                        'media_path', m.media_path, 'media_mime', m.media_mime,
                                        'media_nome', m.media_nome,
                                        'responde_a_wamid', r.wa_message_id,
                                        'ainda_vale', m.status = 'queued'::app.msg_status and m.apagada_em is null)
                from public.wa_grupo_mensagens m
                left join public.wa_grupo_mensagens r on r.id = m.responde_a
               where m.id = (x.dados ->> 'mensagem_id')::uuid) end)
         order by x.pedida_em), '[]'::jsonb)
    into v_out
    from marcadas x
    left join public.conversations c on c.id = x.conversation_id
    left join public.wa_grupos g on g.id = x.grupo_id;
  return v_out;
end $$;
revoke all on function public.wa_acoes_proximas(int) from public, anon, authenticated;
grant execute on function public.wa_acoes_proximas(int) to service_role;

-- O que cada ação muda no banco quando dá certo (p_ok) ou de vez errado.
create or replace function app.wa_acao_efeito(a public.wa_acoes, p_ok boolean, p_resultado jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r jsonb := coalesce(p_resultado, '{}'::jsonb);
  v_p jsonb;
begin
  if a.tipo = 'bloquear' then
    update public.conversations
       set bloqueio_na_meta = case when p_ok then 'feito' else 'falhou' end,
           bloqueio_erro = case when p_ok then null else left(coalesce(a.erro, 'A Meta não bloqueou.'), 500) end
     where id = a.conversation_id and bloqueada_em is not null;

  elsif a.tipo = 'grupo_criar' then
    if p_ok then
      update public.wa_grupos
         set pedido_id = coalesce(v_r ->> 'request_id', pedido_id),
             group_id  = coalesce(group_id, v_r ->> 'id'),
             estado    = case when coalesce(group_id, v_r ->> 'id') is not null then 'ativo' else estado end,
             atualizado_em = now()
       where id = a.grupo_id;
    else
      update public.wa_grupos set estado = 'falhou', erro = left(coalesce(a.erro, 'A Meta não criou o grupo.'), 500),
             atualizado_em = now()
       where id = a.grupo_id and estado = 'criando';
    end if;

  elsif a.tipo in ('grupo_convite', 'grupo_novo_convite') and p_ok then
    update public.wa_grupos set link_convite = coalesce(v_r ->> 'invite_link', link_convite), atualizado_em = now()
     where id = a.grupo_id;

  elsif a.tipo = 'grupo_atualizar' and p_ok then
    update public.wa_grupos
       set assunto   = coalesce(a.dados ->> 'assunto', assunto),
           descricao = case when a.dados ? 'descricao' then a.dados ->> 'descricao' else descricao end,
           foto_path = coalesce(a.dados ->> 'foto_path', foto_path),
           erro = null, atualizado_em = now()
     where id = a.grupo_id;

  elsif a.tipo = 'grupo_apagar' and p_ok then
    update public.wa_grupos set estado = 'apagado', apagado_em = coalesce(apagado_em, now()), atualizado_em = now()
     where id = a.grupo_id;

  elsif a.tipo = 'grupo_sincronizar' and p_ok then
    update public.wa_grupos
       set assunto   = coalesce(nullif(v_r ->> 'subject', ''), assunto),
           descricao = coalesce(v_r ->> 'description', descricao),
           aprovacao = coalesce(nullif(v_r ->> 'join_approval_mode', ''), aprovacao),
           participantes_total = coalesce((v_r ->> 'total_participant_count')::int, participantes_total),
           estado    = case when (v_r ->> 'suspended')::boolean then 'suspenso'
                            when estado = 'suspenso' then 'ativo' else estado end,
           atualizado_em = now()
     where id = a.grupo_id;
    if jsonb_typeof(v_r -> 'participants') = 'array' then
      -- Quem a Meta diz que está, está; quem não aparece, saiu.
      update public.wa_grupo_participantes p set saiu_em = coalesce(p.saiu_em, now())
       where p.grupo_id = a.grupo_id and p.saiu_em is null
         and not exists (select 1 from jsonb_array_elements(v_r -> 'participants') x where x ->> 'wa_id' = p.wa_id);
      insert into public.wa_grupo_participantes (grupo_id, wa_id, entrou_em)
      select a.grupo_id, x ->> 'wa_id', now()
        from jsonb_array_elements(v_r -> 'participants') x
       where nullif(x ->> 'wa_id', '') is not null
      on conflict (grupo_id, wa_id) do update set saiu_em = null;
    end if;

  elsif a.tipo = 'grupo_pedidos' and p_ok then
    for v_p in select * from jsonb_array_elements(coalesce(v_r -> 'data', '[]'::jsonb)) loop
      insert into public.wa_grupo_pedidos (grupo_id, pedido_id, wa_id, criado_em)
      values (a.grupo_id, v_p ->> 'join_request_id', v_p ->> 'wa_id',
              coalesce(to_timestamp((v_p ->> 'creation_timestamp')::double precision), now()))
      on conflict (grupo_id, pedido_id) do nothing;
    end loop;

  elsif a.tipo in ('grupo_aprovar', 'grupo_recusar') and p_ok then
    update public.wa_grupo_pedidos
       set decisao = case when a.tipo = 'grupo_aprovar' then 'aprovado' else 'recusado' end,
           decidido_por = a.pedida_por, decidido_em = now()
     where grupo_id = a.grupo_id
       and pedido_id in (select jsonb_array_elements_text(
                           coalesce(v_r -> case when a.tipo = 'grupo_aprovar' then 'approved_join_requests'
                                                else 'rejected_join_requests' end,
                                    a.dados -> 'pedidos')));

  elsif a.tipo = 'grupo_enviar' then
    if p_ok then
      update public.wa_grupo_mensagens
         set status = 'sent', wa_message_id = coalesce(wa_message_id, v_r ->> 'wamid'), sent_at = coalesce(sent_at, now())
       where id = (a.dados ->> 'mensagem_id')::uuid and status = 'queued';
    else
      update public.wa_grupo_mensagens
         set status = 'failed', error_code = coalesce(a.erro_codigo, 'erro_meta'),
             error_detail = left(coalesce(a.erro, ''), 2000), failed_at = now()
       where id = (a.dados ->> 'mensagem_id')::uuid and status = 'queued';
    end if;

  elsif a.tipo = 'grupo_fixar' and p_ok then
    update public.wa_grupo_mensagens
       set fixada_ate = case when (a.dados ->> 'dias') is null then null
                             else now() + make_interval(days => (a.dados ->> 'dias')::int) end
     where id = (a.dados ->> 'mensagem_id')::uuid;

  elsif a.tipo in ('perfil_ler', 'perfil_salvar') and p_ok and jsonb_typeof(v_r -> 'perfil') = 'object' then
    insert into public.app_settings (key, value, description, updated_by)
    values ('whatsapp.perfil', (v_r -> 'perfil') || jsonb_build_object('lido_em', now()),
            'O perfil da empresa no WhatsApp, como a Meta devolveu (lido pelo worker-wa).', a.pedida_por)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  end if;
end $$;
revoke all on function app.wa_acao_efeito(public.wa_acoes, boolean, jsonb) from public, anon, authenticated;
grant execute on function app.wa_acao_efeito(public.wa_acoes, boolean, jsonb) to service_role;

create or replace function public.wa_acao_concluir(p_id bigint, p_resultado jsonb default '{}'::jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  a public.wa_acoes%rowtype;
begin
  update public.wa_acoes
     set estado = 'feita', resultado = coalesce(p_resultado, '{}'::jsonb), feita_em = now(),
         erro = null, erro_codigo = null
   where id = p_id and estado = 'fazendo'
  returning * into a;
  if not found then
    return false;
  end if;
  perform app.wa_acao_efeito(a, true, p_resultado);
  return true;
end $$;
revoke all on function public.wa_acao_concluir(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.wa_acao_concluir(bigint, jsonb) to service_role;

create or replace function public.wa_acao_falhar(p_id bigint, p_codigo text, p_erro text, p_retentar boolean default false)
returns text
language plpgsql
set search_path = ''
as $$
declare
  a public.wa_acoes%rowtype;
begin
  select * into a from public.wa_acoes where id = p_id and estado = 'fazendo' for update;
  if not found then
    return 'desconhecida';
  end if;
  -- "Digitando…" e "lida" não se repetem: atrasados, não servem para nada.
  if p_retentar and a.tentativas < 5 and a.tipo not in ('digitando') then
    update public.wa_acoes
       set estado = 'pendente', erro = left(p_erro, 1000), erro_codigo = left(p_codigo, 60),
           proxima_em = now() + make_interval(secs => 15 * power(2, a.tentativas - 1))
     where id = p_id;
    return 'reagendada';
  end if;
  update public.wa_acoes
     set estado = 'falhou', erro = left(p_erro, 1000), erro_codigo = left(p_codigo, 60), feita_em = now()
   where id = p_id
  returning * into a;
  perform app.wa_acao_efeito(a, false, null);
  return 'falhou';
end $$;
revoke all on function public.wa_acao_falhar(bigint, text, text, boolean) from public, anon, authenticated;
grant execute on function public.wa_acao_falhar(bigint, text, text, boolean) to service_role;


-- =====================================================================
-- §11 · O balde aceita documento de verdade
-- =====================================================================
-- Até aqui só PDF entrava: a planilha e o .docx que o parceiro mandava eram
-- recusados pelo balde e ficavam "arquivo ausente". Entram os tipos de
-- documento que a Meta manda e aceita, mais o genérico (`octet-stream`, que o
-- worker usa para o que não tem tipo conhecido). 50 MB: a Meta aceita até
-- 100 MB, mas o worker-wa (512 MB de memória) segura o arquivo inteiro.
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array[
         'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/aac', 'audio/webm',
         'video/webm', 'video/mp4', 'video/3gpp',
         'image/jpeg', 'image/png', 'image/webp', 'image/gif',
         'application/pdf', 'text/plain', 'text/csv',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'application/vnd.oasis.opendocument.text',
         'application/vnd.oasis.opendocument.spreadsheet',
         'application/zip', 'application/octet-stream']
 where id = 'mensagens';

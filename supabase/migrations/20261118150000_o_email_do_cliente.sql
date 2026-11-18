-- =====================================================================
-- O e-mail do cliente (17/11/2026)
--
-- Pedido do usuário, sobre a Imova: "Precisamos criar um campo de email para
-- cada cliente/usuário, e caso seja fornecido a informação devemos colocar esse
-- email que foi fornecido à ficha dele" e "devemos treinar a IA para pedir o
-- email das pessoas caso elas queiram receber mais ofertas e promoções".
--
-- A ficha já tinha a coluna (`organizations.email`, citext) e a folha de editar
-- já tinha o campo. O que faltava era o e-mail CHEGAR à ficha quando o cliente o
-- escreve, e um lugar para guardar se ele quer receber ofertas por e-mail.
--
-- O que muda:
--
--   1. O E-MAIL QUE O CLIENTE ESCREVE VAI PARA A FICHA. Um gatilho AFTER INSERT
--      em `messages` (`messages_zzz_email_na_ficha`, depois do lead automático,
--      que é o `zz` e pode criar a ficha) acha o primeiro e-mail da mensagem
--      recebida (`app.email_achado`) e:
--        * ficha sem e-mail: grava;
--        * ficha com um e-mail que veio da própria conversa (o cliente
--          corrigindo): troca pelo novo;
--        * ficha com um e-mail que a equipe digitou ou que veio de importação:
--          NÃO troca. Fica uma anotação na linha do tempo com o e-mail novo,
--          para a equipe decidir em "Editar".
--      Toda vez deixa uma atividade `system` (que não conta como contato) com o
--      e-mail, o anterior e se gravou. É ela que diz depois se o e-mail da
--      ficha "veio da conversa". Conversa sem ficha: nada é gravado.
--      Vale nas duas empresas: na KOMUNE, o suporte do aplicativo também recebe
--      o e-mail da conta do usuário pela conversa.
--      O gatilho nunca derruba a mensagem: qualquer erro vira WARNING (lição do
--      CPF de 13/11, quando um erro no INSERT mandava a mensagem para a DLQ).
--
--   2. "QUERO RECEBER OFERTAS POR E-MAIL" TEM TABELA PRÓPRIA
--      (`public.ofertas_por_email`): sim ou não, quem registrou (a IA, a equipe
--      ou um formulário), a conversa e a mensagem que provam. Não é
--      `consent_events` de propósito: lá, `contact_optout` suprime o contato
--      INTEIRO (`app.consent_apply` põe `do_not_contact`, a supressão e tira os
--      negócios do funil), e quem diz "não quero ofertas por e-mail" continua
--      querendo ser atendido pelo WhatsApp. Só se acrescenta (a linha mais
--      nova vale); `app.ofertas_por_email_situacao` diz a situação de uma ficha.
--
--   3. A IA SABE SE JÁ TEM E-MAIL E SE JÁ PERGUNTOU. A entrada do worker
--      (`public.ia_entrada_do_atendente`) ganha `email`: {na_ficha, ofertas
--      ("aceitou" | "recusou" | null), ofertas_em}. Nunca o endereço: a IA não
--      lê e-mail (CLAUDE.md, pseudonimização). A resposta do cliente ao convite
--      chega por `public.ia_atendente_ofertas_por_email` (só o worker).
--
--   4. O DOSSIÊ DA LGPD (`app.lgpd_dossie`) ganha `ofertas_por_email`, como a
--      casca do Calendly (20261112161000): a definição de antes vira
--      `app.lgpd_dossie_sem_ofertas_por_email`.
--
-- COMO DESFAZER:
--   drop trigger messages_zzz_email_na_ficha on public.messages;
--   drop function app.messages_email_na_ficha(), app.email_achado(text),
--     public.ia_atendente_ofertas_por_email(uuid, uuid, boolean),
--     app.ia_email_do_cliente(uuid), app.lgpd_ofertas_por_email(uuid);
--   drop function app.lgpd_dossie(uuid);
--   alter function app.lgpd_dossie_sem_ofertas_por_email(uuid) rename to lgpd_dossie;
--   reaplicar public.ia_entrada_do_atendente sem a chave 'email';
--   drop function app.ofertas_por_email_situacao(uuid); drop table public.ofertas_por_email.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. Achar o e-mail num texto
-- ---------------------------------------------------------------------------
create or replace function app.email_achado(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- O primeiro endereço com domínio e terminação de letras (".com", ".com.br").
  -- "@imova" sozinho (um @ do Instagram) não é e-mail. O ponto final da frase
  -- fica de fora porque a terminação só aceita letras.
  select nullif(btrim(lower((regexp_match(
           coalesce(t, ''),
           '([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})'))[1]), '.'), '')
$$;
comment on function app.email_achado(text) is
  'O primeiro e-mail de um texto, em minúsculas, ou null. Usado pelo gatilho que leva à ficha o e-mail que o cliente escreve (20261118150000).';
revoke all on function app.email_achado(text) from public, anon;
grant execute on function app.email_achado(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Ofertas por e-mail: sim ou não, com a prova
-- ---------------------------------------------------------------------------
create table if not exists public.ofertas_por_email (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aceita          boolean not null,
  origem          text not null check (origem in ('ia', 'equipe', 'formulario')),
  -- A prova: a conversa e a mensagem do cliente. Sem chave estrangeira, como a
  -- `evidence_message_id` de `consent_events`: a retenção apaga mensagens e a
  -- decisão do titular precisa continuar existindo.
  conversation_id uuid,
  message_id      uuid,
  registrado_por  uuid references public.profiles(id) on delete set null,
  ocorrido_em     timestamptz not null default clock_timestamp()
);
comment on table public.ofertas_por_email is
  'Se a ficha quer receber ofertas e novidades por e-mail (17/11/2026). Só se acrescenta: a linha mais nova vale. Separada de consent_events porque o opt-out de lá suprime o contato inteiro, e o "não" daqui vale só para o e-mail.';
create index if not exists ofertas_por_email_org_idx
  on public.ofertas_por_email (organization_id, ocorrido_em desc);

alter table public.ofertas_por_email enable row level security;
drop policy if exists ofertas_por_email_select on public.ofertas_por_email;
create policy ofertas_por_email_select on public.ofertas_por_email
  for select to authenticated
  using ((select app.is_manager()));
revoke all on public.ofertas_por_email from anon, authenticated, service_role;
grant select on public.ofertas_por_email to authenticated, service_role;

-- A decisão registrada não muda: uma nova decisão é uma linha nova.
drop trigger if exists ofertas_por_email_so_acrescenta on public.ofertas_por_email;
create trigger ofertas_por_email_so_acrescenta
  before update on public.ofertas_por_email
  for each row execute function app.forbid_change();

create or replace function app.ofertas_por_email_situacao(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object('aceita', f.aceita, 'origem', f.origem, 'em', f.ocorrido_em)
      from public.ofertas_por_email f
     where f.organization_id = p_organization_id
     order by f.ocorrido_em desc, f.id desc
     limit 1), jsonb_build_object('aceita', null, 'origem', null, 'em', null))
$$;
comment on function app.ofertas_por_email_situacao(uuid) is
  'A decisão mais nova da ficha sobre ofertas por e-mail: {aceita (true, false ou null = nunca respondeu), origem, em}.';
revoke all on function app.ofertas_por_email_situacao(uuid) from public, anon, authenticated;
grant execute on function app.ofertas_por_email_situacao(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. O e-mail que o cliente escreve vai para a ficha
-- ---------------------------------------------------------------------------
create or replace function app.messages_email_na_ficha()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email       text;
  v_org         uuid;
  v_contato     uuid;
  v_atual       text;
  v_da_conversa boolean;
begin
  v_email := app.email_achado(new.body);
  if v_email is null or length(v_email) > 254 then
    return null;
  end if;

  select coalesce(new.organization_id, c.organization_id), coalesce(new.contact_id, c.contact_id)
    into v_org, v_contato
    from public.conversations c
   where c.id = new.conversation_id;
  if v_org is null then
    return null;   -- conversa sem ficha: o e-mail fica só na mensagem
  end if;

  select o.email::text into v_atual
    from public.organizations o
   where o.id = v_org and o.deleted_at is null and o.anonymized_at is null
     for update;
  if not found then
    return null;
  end if;
  if v_atual is not null and lower(v_atual) = v_email then
    return null;   -- já é este
  end if;

  -- O e-mail de agora veio da própria conversa? Então o cliente está corrigindo.
  v_da_conversa := v_atual is null or exists (
    select 1
      from public.activities a
     where a.organization_id = v_org
       and a.type = 'system'
       and a.metadata ->> 'origin' = 'conversa'
       and a.metadata ->> 'campo' = 'email'
       and lower(a.metadata ->> 'email') = lower(v_atual));

  if v_da_conversa then
    update public.organizations set email = v_email where id = v_org;
  end if;

  -- A pessoa da conversa (na KOMUNE, o contato do fornecedor) ganha o e-mail
  -- quando ainda não tem nenhum.
  if v_contato is not null then
    update public.contacts ct set email = v_email
     where ct.id = v_contato and ct.email is null and ct.deleted_at is null;
  end if;

  insert into public.activities (type, organization_id, author_kind, channel, message_id, body, metadata)
  values ('system', v_org, 'system', 'whatsapp', new.id,
          case
            when v_atual is null then 'E-mail anotado pela conversa: ' || v_email
            when v_da_conversa then 'E-mail trocado pela conversa: ' || v_atual || ' → ' || v_email
            else 'O cliente mandou outro e-mail pela conversa (' || v_email || '). A ficha continua com '
                 || v_atual || '; se for o caso, troque em Editar.'
          end,
          jsonb_build_object('origin', 'conversa', 'campo', 'email', 'email', v_email,
                             'anterior', v_atual, 'gravado', v_da_conversa));
  return null;
exception when others then
  -- O e-mail é um extra. Um erro aqui nunca pode recusar a mensagem recebida.
  raise warning 'messages_email_na_ficha (mensagem %): %', new.id, sqlerrm;
  return null;
end $$;
comment on function app.messages_email_na_ficha() is
  'Leva à ficha o e-mail que o cliente escreve na conversa (17/11/2026): grava se a ficha não tem, troca se o de agora também veio da conversa, e só anota se a equipe digitou outro. Nunca recusa a mensagem.';
revoke all on function app.messages_email_na_ficha() from public, anon, authenticated;

drop trigger if exists messages_zzz_email_na_ficha on public.messages;
create trigger messages_zzz_email_na_ficha
  after insert on public.messages
  for each row
  when (new.direction = 'in'::app.msg_direction and new.body is not null and strpos(new.body, '@') > 0)
  execute function app.messages_email_na_ficha();

-- ---------------------------------------------------------------------------
-- 4. A IA: o que ela sabe do e-mail, e a resposta ao convite
-- ---------------------------------------------------------------------------
create or replace function app.ia_email_do_cliente(p_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'na_ficha', coalesce(o.email is not null, false),
           'ofertas', case (s.v ->> 'aceita')::boolean when true then 'aceitou' when false then 'recusou' end,
           'ofertas_em', to_char(((s.v ->> 'em')::timestamptz) at time zone 'America/Fortaleza', 'YYYY-MM-DD'))
    from public.conversations c
    left join public.organizations o on o.id = c.organization_id
    cross join lateral (select app.ofertas_por_email_situacao(c.organization_id) as v) s
   where c.id = p_conversation_id
$$;
comment on function app.ia_email_do_cliente(uuid) is
  'O que a IA que atende sabe do e-mail do cliente (17/11/2026): se a ficha tem e-mail (nunca o endereço) e se ele já aceitou ou recusou ofertas por e-mail.';
revoke all on function app.ia_email_do_cliente(uuid) from public, anon, authenticated;
grant execute on function app.ia_email_do_cliente(uuid) to service_role;

create or replace function public.ia_atendente_ofertas_por_email(
  p_conversation_id uuid,
  p_message_id      uuid,
  p_aceita          boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_antes boolean;
begin
  if p_aceita is null then
    raise exception 'ia_atendente_ofertas_por_email: p_aceita não pode ser nulo';
  end if;
  select c.organization_id into v_org from public.conversations c where c.id = p_conversation_id;
  if v_org is null then
    return jsonb_build_object('ok', true, 'gravado', false, 'motivo', 'sem_ficha');
  end if;
  v_antes := (app.ofertas_por_email_situacao(v_org) ->> 'aceita')::boolean;
  if v_antes is not distinct from p_aceita then
    return jsonb_build_object('ok', true, 'gravado', false, 'motivo', 'ja_estava');
  end if;
  insert into public.ofertas_por_email (organization_id, aceita, origem, conversation_id, message_id)
  values (v_org, p_aceita, 'ia', p_conversation_id, p_message_id);
  return jsonb_build_object('ok', true, 'gravado', true, 'aceita', p_aceita);
end $$;
comment on function public.ia_atendente_ofertas_por_email(uuid, uuid, boolean) is
  'Porta do worker de IA (17/11/2026): o cliente respondeu ao convite para receber ofertas por e-mail (sim ou não), com a mensagem dele como prova. Idempotente.';
revoke all on function public.ia_atendente_ofertas_por_email(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.ia_atendente_ofertas_por_email(uuid, uuid, boolean) to service_role;

-- A entrada do worker ganha `email`, depois dos convites da agenda.
do $migr$
declare
  v_def   text;
  v_ancora text := $a$'convites_da_agenda', app.ia_convites_da_agenda(c.id));$a$;
  v_vezes int;
begin
  -- Banco sem a IA que atende (a KOMUNE em produção: a 20261106170000 não cria
  -- nada lá): não há entrada do worker para ganhar a chave. Achado no ensaio em
  -- produção de 18/11/2026, com a transação desfeita.
  if to_regprocedure('public.ia_entrada_do_atendente(uuid)') is null then
    return;
  end if;
  v_def := pg_get_functiondef('public.ia_entrada_do_atendente(uuid)'::regprocedure);
  if position('app.ia_email_do_cliente' in v_def) > 0 then
    return;
  end if;
  v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  if v_vezes = 0 then
    -- Banco sem os convites da agenda (20261112160000): a chave entra depois das mensagens.
    v_ancora := $a$'mensagens', v_msgs);$a$;
    v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  end if;
  if v_vezes <> 1 then
    raise exception 'public.ia_entrada_do_atendente não termina nos convites da agenda nem nas mensagens exatamente uma vez (achei %): nada foi trocado.', v_vezes;
  end if;
  execute replace(v_def, v_ancora,
    replace(v_ancora, ');', ',') || $a$
    -- O e-mail (20261118150000): se a ficha tem e-mail e se ele já respondeu
    -- ao convite de ofertas por e-mail. Nunca o endereço.
    'email', app.ia_email_do_cliente(c.id));$a$);
end $migr$;
do $migr$
begin
  if to_regprocedure('public.ia_entrada_do_atendente(uuid)') is not null then
    comment on function public.ia_entrada_do_atendente(uuid) is
  'Porta do worker de IA: o que a IA que atende lê de uma conversa (Imova): as 40 mensagens mais recentes, o cliente (ficha, etapa, perfil, visitas, canal de chegada), os horários livres de visita, se é a conversa do treino, convites_da_agenda (11/11/2026) e email (17/11/2026: na_ficha, ofertas, ofertas_em; nunca o endereço).';
  end if;
end $migr$;

-- ---------------------------------------------------------------------------
-- 5. O dossiê da LGPD
-- ---------------------------------------------------------------------------
create or replace function app.lgpd_ofertas_por_email(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'aceita', f.aceita,
           'origem', f.origem,
           'em', f.ocorrido_em) order by f.ocorrido_em), '[]'::jsonb)
    from public.ofertas_por_email f
   where f.organization_id = p_organization_id
$$;
comment on function app.lgpd_ofertas_por_email(uuid) is
  'O histórico de "quero / não quero ofertas por e-mail" do titular, para o dossiê da LGPD (20261118150000).';
revoke all on function app.lgpd_ofertas_por_email(uuid) from public, anon, authenticated;

do $migr$
begin
  if to_regprocedure('app.lgpd_dossie_sem_ofertas_por_email(uuid)') is null then
    execute 'alter function app.lgpd_dossie(uuid) rename to lgpd_dossie_sem_ofertas_por_email';
  end if;
end $migr$;

create or replace function app.lgpd_dossie(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := app.lgpd_dossie_sem_ofertas_por_email(p_organization_id);
begin
  if not coalesce((v ->> 'ok')::boolean, false) then
    return v;
  end if;
  return v || jsonb_build_object('ofertas_por_email', app.lgpd_ofertas_por_email(p_organization_id));
end $$;
comment on function app.lgpd_dossie(uuid) is
  'Dossiê do art. 18 (I/II) e art. 9º: a definição de antes (app.lgpd_dossie_sem_ofertas_por_email) mais o histórico de ofertas por e-mail (20261118150000). Interna: quem chama é exportar_lgpd ou exportar_lgpd_por_token.';
comment on function app.lgpd_dossie_sem_ofertas_por_email(uuid) is
  'O dossiê da LGPD como era antes de 20261118150000. Chamado só pela casca app.lgpd_dossie, que acrescenta as ofertas por e-mail.';
revoke all on function app.lgpd_dossie(uuid) from public, anon, authenticated;
grant execute on function app.lgpd_dossie(uuid) to service_role;
revoke all on function app.lgpd_dossie_sem_ofertas_por_email(uuid) from public, anon, authenticated;

-- =====================================================================
-- 20260908180000 — A agenda do Google entra no CRM (RF-AGE-02, RF-AGE-04)
--
-- Era o último item do PRD sem uma linha escrita. Até aqui, uma reunião marcada
-- vivia só dentro do Tríade: ninguém do outro lado recebia convite, não havia
-- link do Meet e nenhum lembrete tocava. Alguém repetia o compromisso à mão na
-- própria agenda, e o fornecedor descobria a reunião pelo WhatsApp — quando
-- descobria.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRAÇÃO GUARDA, E ONDE
-- ---------------------------------------------------------------------------
-- Duas coisas de naturezas opostas, e é por isso que são duas tabelas em dois
-- schemas:
--
--   `app.agendas_do_google`   a LIGAÇÃO da pessoa com a conta Google dela. O que
--                             ela guarda é uma credencial de longa duração
--                             (refresh token) que abre a agenda de alguém. Mora
--                             no schema `app`, que o PostgREST não expõe
--                             (config.toml: schemas = public, graphql_public),
--                             então o navegador não alcança essa tabela por
--                             nenhum caminho — nem com a chave certa. E o token
--                             em si nem fica na linha: fica no Vault, e a linha
--                             guarda só o id do segredo.
--
--   `public.compromissos_no_google`   o RESULTADO de um evento criado: id do
--                             evento, link do Meet, endereço da agenda. Isso é
--                             dado de trabalho — a tela precisa mostrar o link
--                             do Meet no cartão da reunião —, então mora em
--                             `public`, com RLS que segue a visibilidade da
--                             tarefa.
--
-- Separar as duas é o ponto do desenho. Uma tabela só, em `public`, colocaria o
-- refresh token a uma política de RLS mal escrita de distância do navegador.
--
-- ---------------------------------------------------------------------------
-- POR QUE O TOKEN VAI PARA O VAULT E NÃO PARA UMA COLUNA text
-- ---------------------------------------------------------------------------
-- O CLAUDE.md fecha isso ("segredos só em .env e no Vault"), e a razão prática
-- é o backup: um dump do banco com refresh tokens em texto puro é um arquivo que
-- abre a agenda de seis pessoas. No Vault ele sai cifrado, e a chave não está no
-- dump.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRAÇÃO NÃO FAZ
-- ---------------------------------------------------------------------------
-- Não fala com o Google. Quem faz a chamada HTTP é o servidor do Next
-- (`/api/agenda/*`), porque só ele tem o `client_secret` do OAuth — e porque
-- trocar refresh token por access token é uma chamada que pode demorar e falhar,
-- e isso não pode acontecer dentro de uma transação do banco.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 1. A ligação da pessoa com a agenda dela
-- ---------------------------------------------------------------------------

create table if not exists app.agendas_do_google (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  -- Id do segredo no Vault. O refresh token NUNCA aparece nesta tabela.
  segredo_id     uuid not null,
  -- Qual conta Google foi conectada. Pode ser diferente do e-mail de login: a
  -- pessoa entra com um Gmail e conecta a agenda de outro, e a tela precisa
  -- dizer qual é, senão o evento aparece numa agenda que ela não olha.
  email_google   text not null check (length(trim(email_google)) > 0),
  escopos        text[] not null default '{}',
  conectada_em   timestamptz not null default now(),
  -- Preenchido quando a pessoa desconecta ou quando o Google recusa o token
  -- (senha trocada, acesso revogado no painel do Google, app removido).
  revogada_em    timestamptz,
  ultimo_erro    text,
  ultimo_erro_em timestamptz
);

comment on table app.agendas_do_google is
  'Ligação de uma pessoa do CRM com a agenda Google dela. Vive no schema app, que o PostgREST não expõe; o refresh token fica no Vault e aqui só o id do segredo.';
comment on column app.agendas_do_google.segredo_id is
  'vault.secrets.id do refresh token. Ler exige service_role ou uma função definer — nunca o navegador.';
comment on column app.agendas_do_google.revogada_em is
  'Quando a ligação deixou de valer: a pessoa desconectou, ou o Google recusou o token. Linha revogada não é apagada, para a tela poder dizer "reconecte" em vez de "nunca conectou".';

alter table app.agendas_do_google enable row level security;
-- Sem política nenhuma, de propósito: RLS ligada e zero policies quer dizer que
-- nenhum papel do PostgREST lê ou escreve. Quem toca aqui é `service_role` (que
-- ignora RLS) e as funções `security definer` logo abaixo.
revoke all on app.agendas_do_google from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. O evento criado no Google, ligado à tarefa que o originou
-- ---------------------------------------------------------------------------
-- Um compromisso do CRM é uma linha de `public.tasks` (kind `meeting` ou
-- `visit`). O evento no Google é um espelho dela, e a chave é a tarefa: se a
-- tarefa some, o espelho some junto.

create table if not exists public.compromissos_no_google (
  task_id         uuid primary key references public.tasks (id) on delete cascade,
  evento_id       text not null,
  agenda_id       text not null default 'primary',
  -- Link do Meet, quando o Google criou a sala. Nulo é normal: visita presencial
  -- não tem sala, e conta Google sem permissão de conferência também não.
  meet_url        text,
  -- Endereço do evento no Google Agenda, para o "abrir no Google" do cartão.
  link_html       text,
  -- Quem mandou criar. Não é dono do evento no Google (dono é a conta conectada),
  -- é quem apertou o botão aqui — o que a auditoria precisa saber.
  criado_por      uuid references public.profiles (id) on delete set null,
  criado_em       timestamptz not null default now(),
  sincronizado_em timestamptz not null default now()
);

comment on table public.compromissos_no_google is
  'O evento do Google Agenda que espelha uma tarefa de reunião ou visita do CRM. Uma tarefa tem no máximo um evento; apagar a tarefa apaga o espelho.';
comment on column public.compromissos_no_google.meet_url is
  'Sala do Meet, quando o Google criou uma. Nulo é normal: visita presencial não tem sala.';

create index if not exists compromissos_no_google_evento_idx
  on public.compromissos_no_google (evento_id);

alter table public.compromissos_no_google enable row level security;

-- A visibilidade do espelho é a visibilidade da tarefa: quem enxerga a reunião
-- na agenda enxerga o link do Meet dela. Nada de política própria — duplicar a
-- regra de acesso é como as duas versões divergem.
drop policy if exists compromissos_no_google_leitura on public.compromissos_no_google;
create policy compromissos_no_google_leitura on public.compromissos_no_google
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

-- Escrita só pelo servidor: quem grava é a rota do Next depois que o Google
-- respondeu. Uma pessoa não inventa um evento que não existe lá.
grant select on public.compromissos_no_google to authenticated;
revoke insert, update, delete on public.compromissos_no_google from authenticated;


-- ---------------------------------------------------------------------------
-- 3. Guardar e ler a ligação
-- ---------------------------------------------------------------------------

-- Chamada pelo servidor do Next logo depois do consentimento no Google.
-- Reconectar é o caminho normal, não a exceção: o Google só devolve refresh
-- token com `prompt=consent`, e a pessoa reconecta sempre que troca de conta ou
-- revoga o acesso. Por isso é upsert, e o segredo antigo é ATUALIZADO no lugar —
-- criar um novo a cada reconexão deixaria lixo cifrado acumulando no Vault.
create or replace function app.agenda_google_guardar(
  p_user_id       uuid,
  p_refresh_token text,
  p_email_google  text,
  p_escopos       text[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_atual uuid;
  v_nome  text := 'agenda_google:' || p_user_id::text;
begin
  if nullif(trim(coalesce(p_refresh_token, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_refresh_token');
  end if;
  if nullif(trim(coalesce(p_email_google, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_email');
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    return jsonb_build_object('ok', false, 'motivo', 'pessoa_inexistente');
  end if;

  select segredo_id into v_atual from app.agendas_do_google where user_id = p_user_id;

  if v_atual is null then
    v_atual := vault.create_secret(p_refresh_token, v_nome,
                                   'Refresh token da agenda Google de uma pessoa do CRM.');
  else
    perform vault.update_secret(v_atual, p_refresh_token);
  end if;

  insert into app.agendas_do_google
         (user_id, segredo_id, email_google, escopos, conectada_em, revogada_em,
          ultimo_erro, ultimo_erro_em)
  values (p_user_id, v_atual, lower(trim(p_email_google)), coalesce(p_escopos, '{}'), now(),
          null, null, null)
  on conflict (user_id) do update
     set segredo_id     = excluded.segredo_id,
         email_google   = excluded.email_google,
         escopos        = excluded.escopos,
         conectada_em   = now(),
         revogada_em    = null,
         ultimo_erro    = null,
         ultimo_erro_em = null;

  return jsonb_build_object('ok', true, 'email', lower(trim(p_email_google)));
end
$$;

comment on function app.agenda_google_guardar(uuid, text, text, text[]) is
  'Guarda (ou renova) o refresh token da agenda Google de uma pessoa. O token vai para o Vault; a tabela fica com o id do segredo. Reconectar reaproveita o segredo em vez de criar outro.';

revoke all on function app.agenda_google_guardar(uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function app.agenda_google_guardar(uuid, text, text, text[]) to service_role;


-- O refresh token em claro, para a rota do servidor trocar por access token.
-- Só `service_role`: é a função mais sensível deste arquivo.
create or replace function app.agenda_google_token(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
    from app.agendas_do_google a
    join vault.decrypted_secrets s on s.id = a.segredo_id
   where a.user_id = p_user_id
     and a.revogada_em is null
$$;

comment on function app.agenda_google_token(uuid) is
  'O refresh token em claro de uma ligação ativa. Só service_role executa; é a única porta para o segredo.';

revoke all on function app.agenda_google_token(uuid) from public, anon, authenticated;
grant execute on function app.agenda_google_token(uuid) to service_role;


-- O que a TELA pode saber: se está conectada, com qual conta e desde quando.
-- Nunca o token. Cada pessoa vê só a própria ligação.
create or replace function public.agenda_google_estado()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
              'conectada',   a.revogada_em is null,
              'email',       a.email_google,
              'desde',       a.conectada_em,
              'revogada_em', a.revogada_em,
              'ultimo_erro', a.ultimo_erro)
       from app.agendas_do_google a
      where a.user_id = auth.uid()),
    jsonb_build_object('conectada', false))
$$;

comment on function public.agenda_google_estado() is
  'Estado da ligação da PRÓPRIA pessoa com a agenda Google: conectada, com que conta e desde quando. Nunca devolve o token.';

revoke all on function public.agenda_google_estado() from public, anon;
grant execute on function public.agenda_google_estado() to authenticated, service_role;


-- Desconectar. Marca a linha e apaga o segredo do Vault: guardar um refresh
-- token que a pessoa pediu para revogar é exatamente o que ela quis evitar.
create or replace function public.agenda_google_desconectar()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_segredo uuid;
begin
  v_id := auth.uid();
  if v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;

  select segredo_id into v_segredo from app.agendas_do_google where user_id = v_id;
  if v_segredo is null then
    return jsonb_build_object('ok', false, 'motivo', 'nao_conectada');
  end if;

  update app.agendas_do_google
     set revogada_em = now(), ultimo_erro = null, ultimo_erro_em = null
   where user_id = v_id;
  delete from vault.secrets where id = v_segredo;

  -- A linha fica, sem segredo: é o que deixa a tela dizer "reconecte" em vez de
  -- "nunca conectou", e guarda quando a ligação existiu.
  return jsonb_build_object('ok', true);
end
$$;

comment on function public.agenda_google_desconectar() is
  'Desconecta a agenda Google da própria pessoa: marca a ligação como revogada e APAGA o refresh token do Vault. A linha sobrevive, para a tela oferecer reconectar.';

revoke all on function public.agenda_google_desconectar() from public, anon;
grant execute on function public.agenda_google_desconectar() to authenticated, service_role;


-- Registrar que o Google recusou. Chamada pelo servidor quando a troca do
-- refresh token falha: sem isto, a pessoa continuaria vendo "conectada" e
-- clicando num botão que erra toda vez.
create or replace function app.agenda_google_falhou(p_user_id uuid, p_erro text, p_revogar boolean)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update app.agendas_do_google
     set ultimo_erro    = left(coalesce(p_erro, 'erro desconhecido'), 500),
         ultimo_erro_em = now(),
         revogada_em    = case when p_revogar then coalesce(revogada_em, now()) else revogada_em end
   where user_id = p_user_id
$$;

comment on function app.agenda_google_falhou(uuid, text, boolean) is
  'Anota que o Google recusou o token desta pessoa. Com p_revogar, marca a ligação como revogada — usado quando o erro é invalid_grant, que não se resolve tentando de novo.';

revoke all on function app.agenda_google_falhou(uuid, text, boolean) from public, anon, authenticated;
grant execute on function app.agenda_google_falhou(uuid, text, boolean) to service_role;


-- ---------------------------------------------------------------------------
-- 4. Gravar o evento criado
-- ---------------------------------------------------------------------------

create or replace function app.compromisso_do_google_gravar(
  p_task_id   uuid,
  p_evento_id text,
  p_agenda_id text,
  p_meet_url  text,
  p_link_html text,
  p_criado_por uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.tasks t where t.id = p_task_id) then
    return jsonb_build_object('ok', false, 'motivo', 'tarefa_inexistente');
  end if;

  insert into public.compromissos_no_google
         (task_id, evento_id, agenda_id, meet_url, link_html, criado_por, sincronizado_em)
  values (p_task_id, p_evento_id, coalesce(nullif(trim(p_agenda_id), ''), 'primary'),
          nullif(trim(coalesce(p_meet_url, '')), ''),
          nullif(trim(coalesce(p_link_html, '')), ''),
          p_criado_por, now())
  on conflict (task_id) do update
     set evento_id       = excluded.evento_id,
         agenda_id       = excluded.agenda_id,
         meet_url        = excluded.meet_url,
         link_html       = excluded.link_html,
         sincronizado_em = now();

  return jsonb_build_object('ok', true, 'task_id', p_task_id);
end
$$;

comment on function app.compromisso_do_google_gravar(uuid, text, text, text, text, uuid) is
  'Grava (ou atualiza) o espelho de um evento do Google Agenda para uma tarefa do CRM. Chamada pelo servidor depois que o Google respondeu.';

revoke all on function app.compromisso_do_google_gravar(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function app.compromisso_do_google_gravar(uuid, text, text, text, text, uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 5. O que a agenda precisa saber para montar um evento
-- ---------------------------------------------------------------------------
-- Uma consulta só, do lado do servidor, com tudo que o evento pede: quando,
-- quanto dura, com quem, onde, e se já existe espelho. Deixar a rota do Next
-- montar isso com três consultas separadas seria três chances de a reunião ser
-- criada com o nome de um parceiro e o e-mail de outro.

create or replace function app.agenda_dados_do_evento(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'task_id',      t.id,
    'titulo',       t.title,
    'tipo',         t.kind::text,
    'quando',       t.due_at,
    'responsavel',  t.assignee_id,
    'parceiro',     o.name,
    'bairro',       o.neighborhood,
    'cidade',       c.name,
    -- E-mail do contato principal, para o convite. Nulo é normal e não impede
    -- nada: o evento nasce só com a pessoa do CRM, e o fornecedor recebe o link
    -- pelo WhatsApp ou pela ligação, como já acontece hoje.
    'convidado',    (select ct.email
                       from public.organization_contacts oc
                       join public.contacts ct on ct.id = oc.contact_id
                      where oc.organization_id = o.id and oc.is_primary
                        and ct.email is not null and not ct.do_not_contact
                      limit 1),
    'ja_tem_evento', exists (select 1 from public.compromissos_no_google g where g.task_id = t.id)
  )
  from public.tasks t
  left join public.organizations o on o.id = t.organization_id
  left join public.cities c on c.id = o.city_id
  where t.id = p_task_id
$$;

comment on function app.agenda_dados_do_evento(uuid) is
  'Tudo que a rota do servidor precisa para montar um evento do Google a partir de uma tarefa do CRM, numa consulta só. Só service_role executa.';

revoke all on function app.agenda_dados_do_evento(uuid) from public, anon, authenticated;
grant execute on function app.agenda_dados_do_evento(uuid) to service_role;

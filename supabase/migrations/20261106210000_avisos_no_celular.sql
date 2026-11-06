-- =============================================================================
-- AVISOS NO CELULAR (push do app do Tríade) — 06/11/2026
-- =============================================================================
-- Pedido do usuário ("Eu preciso receber pushs nesse app", 05/11/2026). O catálogo
-- foi fechado na entrevista de 06/11/2026: cada empresa tem os seus avisos, e alguns
-- são comuns. O app recebe os das duas, qualquer que seja a empresa aberta, e o título
-- de cada aviso é o nome da empresa.
--
--   COMUNS            mensagem nova · conversa transferida · compromisso marcado por
--                     outra pessoa · lembrete 30 min antes · resumo das 8h ·
--                     resposta atrasada (24 h)
--   SÓ KOMUNE         lote para ligar · reunião marcada pelo robô · parceiro publicado
--   SÓ IMOVA          cliente ligando pelo WhatsApp (enquanto toca) · ligação perdida
--                     (lead novo dos portais e anúncio com problema entram com o ramo
--                     dos Anúncios, que ainda não está na main)
--
-- Na tela de bloqueio vai o NOME, nunca o conteúdo da mensagem. Das 8h às 20h
-- (Fortaleza) o aviso toca; fora, chega sem som, menos o lembrete. Cada pessoa liga e
-- desliga cada tipo para si (`public.avisos_definir`); silenciar uma conversa continua
-- valendo para os avisos dela.
--
-- O WHATSAPP NÃO É TOCADO. Nada aqui é gatilho em `messages`, `conversations` ou nas
-- funções de envio e entrada: uma rotina do pg_cron, a cada 10 segundos, LÊ o que já
-- foi gravado e põe os avisos numa fila própria. Se ela falhar, a mensagem já entrou e
-- o atendimento segue igual. Nada vai à Meta, nada custa.
--
-- O ENVIO é pelo serviço de push do Expo (grátis), direto do banco com o pg_net, como
-- `app.komune_push_disparar` faz com a Edge Function. A resposta do Expo é lida na
-- rodada seguinte: aparelho de onde o app saiu é esquecido.
--
-- Chave geral: `app_settings['avisos.push'].ativo = false` desliga tudo sem deploy.
-- =============================================================================

create extension if not exists pg_net;

-- -----------------------------------------------------------------------------
-- A. OS APARELHOS
-- -----------------------------------------------------------------------------
create table if not exists public.aparelhos_push (
  -- O endereço de push do Expo para este app neste aparelho.
  token         text primary key
                  check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$'),
  pessoa_id     uuid not null references public.profiles (id) on delete cascade,
  plataforma    text not null check (plataforma in ('ios', 'android')),
  -- Quem registrou foi o site desta empresa: é o nome que vai no título do aviso e a
  -- empresa que o app abre ao tocar.
  empresa       text not null check (empresa ~ '^[a-z]{2,20}$'),
  empresa_nome  text not null check (length(empresa_nome) between 1 and 60),
  criado_em     timestamptz not null default now(),
  visto_em      timestamptz not null default now()
);
create index if not exists aparelhos_push_pessoa on public.aparelhos_push (pessoa_id);
alter table public.aparelhos_push enable row level security;
-- Sem política: ninguém lê nem grava direto. Só as funções abaixo.
revoke all on public.aparelhos_push from anon, authenticated;
comment on table public.aparelhos_push is
  'Aparelhos com o app do Tríade que recebem aviso (push), um por endereço do Expo. Gravado só por public.aparelho_registrar e apagado por public.aparelho_remover ou quando o Expo diz que o app saiu do aparelho.';

create or replace function public.aparelho_registrar(
  p_token text, p_plataforma text, p_empresa text, p_empresa_nome text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sem sessão' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active) then
    raise exception 'perfil inativo' using errcode = '42501';
  end if;
  -- O mesmo aparelho, outra pessoa logada: o aviso passa a ser de quem está no app.
  insert into public.aparelhos_push (token, pessoa_id, plataforma, empresa, empresa_nome)
  values (p_token, auth.uid(), p_plataforma, p_empresa, p_empresa_nome)
  on conflict (token) do update
     set pessoa_id = excluded.pessoa_id,
         plataforma = excluded.plataforma,
         empresa = excluded.empresa,
         empresa_nome = excluded.empresa_nome,
         visto_em = now();
end $$;
comment on function public.aparelho_registrar(text, text, text, text) is
  'O app avisa: este aparelho recebe os avisos de quem está logado. Chamada pelo site (/api/aparelhos) com a sessão da pessoa.';

create or replace function public.aparelho_remover(p_token text) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.aparelhos_push where token = p_token and pessoa_id = auth.uid();
$$;
comment on function public.aparelho_remover(text) is
  'Ao sair da conta no app, o aparelho deixa de receber os avisos daquela pessoa.';

-- O mesmo aparelho levado de uma empresa à outra (06/11/2026): quem tem acesso às duas
-- recebe os avisos das duas, qualquer que seja a empresa aberta no app. Quem chama é o
-- servidor da outra empresa (`/api/empresas/aparelho`, pedido assinado), com a chave de
-- serviço: só registra para quem entra NESTA empresa pela regra do próprio banco.
create or replace function public.aparelho_registrar_por_email(
  p_email text, p_token text, p_plataforma text, p_empresa text, p_empresa_nome text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pessoa uuid;
begin
  if not public.email_entra_no_crm(p_email) then
    return false;
  end if;
  select p.id into v_pessoa
    from public.profiles p join auth.users u on u.id = p.id
   where lower(u.email) = lower(trim(p_email)) and p.is_active
   limit 1;
  if v_pessoa is null then
    return false;
  end if;
  insert into public.aparelhos_push (token, pessoa_id, plataforma, empresa, empresa_nome)
  values (p_token, v_pessoa, p_plataforma, p_empresa, p_empresa_nome)
  on conflict (token) do update
     set pessoa_id = excluded.pessoa_id,
         plataforma = excluded.plataforma,
         empresa = excluded.empresa,
         empresa_nome = excluded.empresa_nome,
         visto_em = now();
  return true;
end $$;

create or replace function public.aparelho_remover_por_email(p_email text, p_token text) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.aparelhos_push a
   using auth.users u
   where a.token = p_token and u.id = a.pessoa_id and lower(u.email) = lower(trim(p_email));
$$;

revoke all on function public.aparelho_registrar_por_email(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.aparelho_remover_por_email(text, text) from public, anon, authenticated;
grant execute on function public.aparelho_registrar_por_email(text, text, text, text, text) to service_role;
grant execute on function public.aparelho_remover_por_email(text, text) to service_role;

revoke all on function public.aparelho_registrar(text, text, text, text) from public, anon;
revoke all on function public.aparelho_remover(text) from public, anon;
grant execute on function public.aparelho_registrar(text, text, text, text) to authenticated;
grant execute on function public.aparelho_remover(text) to authenticated;

-- -----------------------------------------------------------------------------
-- B. O CATÁLOGO DE CADA EMPRESA, E O QUE CADA PESSOA DESLIGOU
-- -----------------------------------------------------------------------------
-- A empresa deste banco vem de `app.identidade` (komune ou imova).
create or replace function app.avisos_catalogo()
returns table (tipo text, nome text, descricao text, ordem integer)
language sql stable
set search_path = ''
as $$
  select v.tipo, v.nome, v.descricao, v.ordem
    from (values
      ('mensagem',        'Mensagem nova',              'Quando um cliente ou parceiro escreve no WhatsApp.',            1, null),
      ('transferencia',   'Conversa transferida',       'Quando alguém passa uma conversa para você.',                   2, null),
      ('compromisso',     'Compromisso marcado',        'Quando alguém marca uma reunião ou visita para você.',          3, null),
      ('lembrete',        'Lembrete de compromisso',    '30 minutos antes de cada reunião ou visita sua.',               4, null),
      ('atrasada',        'Resposta atrasada',          'Quando uma conversa espera a nossa resposta há 24 horas.',      5, null),
      ('resumo',          'Resumo das 8h',              'Um aviso por manhã com o que espera você no dia.',              6, null),
      ('lote',            'Lote para ligar',            'Quando a gestão monta ou passa um lote de ligações para você.', 7, 'komune'),
      ('reuniao_robo',    'Reunião marcada pelo robô',  'Quando o robô marca uma reunião com um parceiro seu.',          8, 'komune'),
      ('publicado',       'Parceiro publicado',         'Quando um parceiro seu é publicado na Komune.',                 9, 'komune'),
      ('ligando',         'Cliente ligando',            'Na hora em que um cliente liga pelo WhatsApp, enquanto toca.', 10, 'imova'),
      ('ligacao_perdida', 'Ligação perdida',            'Quando um cliente liga pelo WhatsApp e ninguém atende.',       11, 'imova')
    ) as v (tipo, nome, descricao, ordem, empresa)
   where v.empresa is null or v.empresa = (select i.empresa from app.identidade i limit 1);
$$;
comment on function app.avisos_catalogo() is
  'Os avisos no celular desta empresa (entrevista de 06/11/2026): os comuns e os só dela.';

create table if not exists public.avisos_desligados (
  pessoa_id    uuid not null references public.profiles (id) on delete cascade,
  tipo         text not null,
  desligado_em timestamptz not null default now(),
  primary key (pessoa_id, tipo)
);
alter table public.avisos_desligados enable row level security;
revoke all on public.avisos_desligados from anon, authenticated;
comment on table public.avisos_desligados is
  'Os tipos de aviso no celular que cada pessoa desligou para si. Sem linha, o aviso está ligado.';

create or replace function public.avisos_meus()
returns table (tipo text, nome text, descricao text, ligado boolean)
language sql stable
security definer
set search_path = ''
as $$
  select c.tipo, c.nome, c.descricao,
         not exists (select 1 from public.avisos_desligados d
                      where d.pessoa_id = auth.uid() and d.tipo = c.tipo)
    from app.avisos_catalogo() c
   where auth.uid() is not null
   order by c.ordem;
$$;
comment on function public.avisos_meus() is
  'A tela "Avisos no celular": os avisos desta empresa e quais a pessoa logada deixou ligados.';

create or replace function public.avisos_definir(p_tipo text, p_ligado boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sem sessão' using errcode = '42501';
  end if;
  if not exists (select 1 from app.avisos_catalogo() c where c.tipo = p_tipo) then
    raise exception 'aviso desconhecido: %', p_tipo using errcode = '22023';
  end if;
  if p_ligado then
    delete from public.avisos_desligados where pessoa_id = auth.uid() and tipo = p_tipo;
  else
    insert into public.avisos_desligados (pessoa_id, tipo) values (auth.uid(), p_tipo)
    on conflict do nothing;
  end if;
end $$;
comment on function public.avisos_definir(text, boolean) is
  'Liga ou desliga, para a pessoa logada, um tipo de aviso no celular.';

revoke all on function public.avisos_meus() from public, anon;
revoke all on function public.avisos_definir(text, boolean) from public, anon;
grant execute on function public.avisos_meus() to authenticated;
grant execute on function public.avisos_definir(text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- C. A FILA DE AVISOS
-- -----------------------------------------------------------------------------
create table if not exists app.push_fila (
  id          bigint generated always as identity primary key,
  pessoa_id   uuid not null references public.profiles (id) on delete cascade,
  tipo        text not null check (tipo in ('mensagem', 'transferencia', 'compromisso',
                                            'lembrete', 'atrasada', 'resumo', 'lote',
                                            'reuniao_robo', 'publicado', 'ligando',
                                            'ligacao_perdida')),
  -- Idempotência: o mesmo fato nunca vira dois avisos para a mesma pessoa.
  chave       text not null unique,
  corpo       text not null check (length(corpo) between 1 and 240),
  -- A tela que o toque abre, dentro da empresa deste banco.
  caminho     text not null check (caminho ~ '^/[A-Za-z0-9/_?=&-]*$'),
  -- Para o aviso de mensagem não repetir a cada mensagem seguida da mesma conversa.
  conversa_id uuid,
  criado_em   timestamptz not null default now(),
  enviado_em  timestamptz,
  resultado   text
);
create index if not exists push_fila_pendentes on app.push_fila (id) where enviado_em is null;
create index if not exists push_fila_conversa on app.push_fila (conversa_id, pessoa_id, criado_em)
  where conversa_id is not null;
alter table app.push_fila enable row level security;
revoke all on app.push_fila from anon, authenticated;
comment on table app.push_fila is
  'Avisos (push) a mandar para o app. Preenchida por app.avisos_push_varrer e app.avisos_push_resumo, esvaziada por app.avisos_push_enviar.';

-- O que foi mandado ao Expo em cada pedido, na ordem: a resposta vem na mesma ordem.
create table if not exists app.push_envios (
  pedido_id    bigint primary key,
  tokens       text[] not null,
  enviado_em   timestamptz not null default now(),
  conferido_em timestamptz
);
alter table app.push_envios enable row level security;
revoke all on app.push_envios from anon, authenticated;

-- -----------------------------------------------------------------------------
-- D. QUEM RECEBE, E O NOME QUE VAI NO AVISO
-- -----------------------------------------------------------------------------
create or replace function app.avisos_push_ligados() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((
    select (s.value ->> 'ativo')::boolean from public.app_settings s where s.key = 'avisos.push'
  ), true);
$$;

create or replace function app.avisos_empresa() returns text
language sql stable
set search_path = ''
as $$
  select i.empresa from app.identidade i limit 1;
$$;

-- Quem atende: ativos com papel de atendimento (admin, gestor e sdr), a mesma lista do
-- aviso do navegador (`recebeAvisos`, em components/avisos/regra.ts).
create or replace function app.avisos_quem_atende() returns setof uuid
language sql stable
security definer
set search_path = ''
as $$
  select t.id from public.team_directory t
   where t.is_active and t.role in ('admin', 'gestor', 'sdr');
$$;

-- Quem recebe o aviso de uma conversa.
--   p_regra_do_computador = true (mensagem nova): a regra do aviso do navegador. A
--     conversa de PARCEIRO em que alguém do time já escreveu, com responsável que
--     atende, é só dele; o resto (cliente, ou parceiro sem resposta) é de todos.
--   false (resposta atrasada, ligação perdida): quem atende a conversa; sem dono que
--     atenda, todos.
-- Quem silenciou a conversa fica de fora nos dois casos.
create or replace function app.avisos_destino_da_conversa(p_conversa uuid, p_regra_do_computador boolean)
returns setof uuid
language sql stable
security definer
set search_path = ''
as $$
  with c as (
    select cv.organization_id, cv.assignee_id from public.conversations cv where cv.id = p_conversa
  ),
  atende as (select q.id from app.avisos_quem_atende() as q (id)),
  dono as (
    select c.assignee_id as id
      from c
     where c.assignee_id in (select id from atende)
       and (not p_regra_do_computador or (
             c.organization_id is not null
             and exists (select 1 from public.messages m
                          where m.conversation_id = p_conversa
                            and m.direction = 'out' and m.origin = 'crm'
                            and m.author_kind in ('human', 'bot_ai')
                            and m.type <> 'template' and m.status <> 'failed')))
  ),
  todos as (
    select id from dono
    union all
    select a.id from atende a where not exists (select 1 from dono)
  )
  select t.id from todos t
   where not exists (select 1 from public.conversa_preferencias cp
                      where cp.profile_id = t.id and cp.conversation_id = p_conversa
                        and cp.silenciada_ate > now());
$$;

-- O primeiro nome vem de `app.primeiro_nome` (14/09/2026), o mesmo da assinatura das
-- mensagens; sem nome, "Alguém".

-- O nome da conversa: a ficha, senão o nome do perfil do WhatsApp. Nunca o telefone,
-- que na tela de bloqueio seria dado pessoal à vista.
create or replace function app.nome_da_conversa(p_conversa uuid) returns text
language sql stable
set search_path = ''
as $$
  select left(coalesce(nullif(trim(o.name), ''), nullif(trim(c.peer_nome), ''), 'um contato'), 60)
    from public.conversations c
    left join public.organizations o on o.id = c.organization_id
   where c.id = p_conversa;
$$;

create or replace function app.caminho_da_conversa(p_conversa uuid) returns text
language sql stable
set search_path = ''
as $$
  select case when c.organization_id is not null
              then '/conversas?org=' || c.organization_id
              else '/conversas?cliente=' || c.id end
    from public.conversations c where c.id = p_conversa;
$$;

-- "dd/mm às HH:MM" e "HH:MM", no fuso de Fortaleza.
create or replace function app.avisos_quando(p_em timestamptz, p_com_dia boolean) returns text
language sql immutable
set search_path = ''
as $$
  select case when p_com_dia
              then to_char(p_em at time zone 'America/Fortaleza', 'DD/MM "às" HH24:MI')
              else to_char(p_em at time zone 'America/Fortaleza', 'HH24:MI') end;
$$;

-- "1 conversa espera" / "3 conversas esperam": o plural do português, sem gambiarra na tela.
create or replace function app.avisos_contar(p_n bigint, p_um text, p_varios text) returns text
language sql immutable
set search_path = ''
as $$
  select case when p_n = 1 then '1 ' || p_um else p_n || ' ' || p_varios end;
$$;

-- -----------------------------------------------------------------------------
-- E. A VARREDURA: o que aconteceu há pouco e ainda não virou aviso
-- -----------------------------------------------------------------------------
-- Olhar uns minutos para trás a cada 10 segundos cobre a transação que gravou com um
-- horário anterior e só apareceu depois; a `chave` única impede o aviso dobrado. Cada
-- aviso tem o seu bloco: um que falhe não impede os outros.
create or replace function app.avisos_push_varrer() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa text := app.avisos_empresa();
  v_novos   integer := 0;
  v_n       integer;
begin
  -- 1. Mensagem nova (as duas empresas), pela regra do aviso do navegador.
  begin
    insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho, conversa_id)
    select d.pessoa, 'mensagem',
           'mensagem:' || c.id || ':' || d.pessoa || ':' || extract(epoch from c.last_inbound_at)::bigint,
           'Nova mensagem de ' || app.nome_da_conversa(c.id),
           app.caminho_da_conversa(c.id), c.id
      from public.conversations c
     cross join lateral app.avisos_destino_da_conversa(c.id, true) as d (pessoa)
     where c.last_inbound_at > now() - interval '2 minutes'
       -- Várias mensagens seguidas da mesma conversa: um aviso por minuto, não um por balão.
       and not exists (select 1 from app.push_fila f
                        where f.conversa_id = c.id and f.pessoa_id = d.pessoa
                          and f.tipo = 'mensagem' and f.criado_em > now() - interval '1 minute')
    on conflict (chave) do nothing;
    get diagnostics v_n = row_count; v_novos := v_novos + v_n;
  exception when others then raise warning 'avisos: mensagem: %', sqlerrm;
  end;

  -- 2. Conversa transferida para a pessoa, por outra (as duas).
  begin
    insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho, conversa_id)
    select t.para_pessoa, 'transferencia', 'transferencia:' || t.id,
           left(coalesce(app.primeiro_nome(t.feita_por), 'Alguém') || ' passou a conversa com '
                || app.nome_da_conversa(t.conversation_id) || ' para você', 240),
           app.caminho_da_conversa(t.conversation_id), t.conversation_id
      from public.conversa_transferencias t
      join public.profiles p on p.id = t.para_pessoa and p.is_active
     where t.feita_em > now() - interval '2 minutes'
       and t.para_pessoa is not null and t.para_pessoa <> t.feita_por
    on conflict (chave) do nothing;
    get diagnostics v_n = row_count; v_novos := v_novos + v_n;
  exception when others then raise warning 'avisos: transferencia: %', sqlerrm;
  end;

  -- 3. Compromisso marcado para a pessoa por outra (o aviso que a agenda já grava).
  begin
    insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
    select a.dono_id, 'compromisso', 'compromisso:' || a.id,
           left(coalesce(app.primeiro_nome(a.marcado_por), 'Alguém') || ' marcou para você: '
                || a.titulo || ', ' || app.avisos_quando(a.quando, true), 240),
           '/agenda'
      from public.agenda_avisos a
      join public.profiles p on p.id = a.dono_id and p.is_active
     where a.criado_em > now() - interval '2 minutes'
       and a.dono_id <> a.marcado_por
    on conflict (chave) do nothing;
    get diagnostics v_n = row_count; v_novos := v_novos + v_n;
  exception when others then raise warning 'avisos: compromisso: %', sqlerrm;
  end;

  -- 4. Lembrete 30 minutos antes: reuniões e visitas de cada pessoa. O horário entra na
  --    chave: remarcou, o lembrete do horário novo sai de novo.
  begin
    insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
    select r.dono_id, 'lembrete',
           'lembrete:reuniao:' || r.id || ':' || extract(epoch from r.inicio)::bigint,
           left('Daqui a 30 min: ' || r.titulo || ', às ' || app.avisos_quando(r.inicio, false), 240),
           '/agenda'
      from public.reunioes r
      join public.profiles p on p.id = r.dono_id and p.is_active
     where r.estado in ('a_confirmar', 'marcada', 'confirmada')
       and r.inicio > now() + interval '20 minutes'
       and r.inicio <= now() + interval '30 minutes'
    on conflict (chave) do nothing;
    get diagnostics v_n = row_count; v_novos := v_novos + v_n;

    insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
    select t.assignee_id, 'lembrete',
           'lembrete:tarefa:' || t.id || ':' || extract(epoch from t.due_at)::bigint,
           left('Daqui a 30 min: ' || t.title || ', às ' || app.avisos_quando(t.due_at, false), 240),
           '/agenda'
      from public.tasks t
      join public.profiles p on p.id = t.assignee_id and p.is_active
     where t.kind in ('meeting', 'visit')
       and t.status in ('todo', 'doing')
       and t.due_at > now() + interval '20 minutes'
       and t.due_at <= now() + interval '30 minutes'
       -- A reunião que também é tarefa já teve o lembrete pela reunião.
       and not exists (select 1 from public.reunioes r where r.task_id = t.id)
    on conflict (chave) do nothing;
    get diagnostics v_n = row_count; v_novos := v_novos + v_n;
  exception when others then raise warning 'avisos: lembrete: %', sqlerrm;
  end;

  -- 5. Resposta atrasada (as duas): a última palavra é do cliente há 24 h e ninguém do
  --    time respondeu depois. Uma vez por espera (a chave leva a última entrada).
  begin
    insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho, conversa_id)
    select d.pessoa, 'atrasada',
           'atrasada:' || c.id || ':' || d.pessoa || ':' || extract(epoch from c.last_inbound_at)::bigint,
           left(app.nome_da_conversa(c.id) || ' espera resposta há 24 h', 240),
           app.caminho_da_conversa(c.id), c.id
      from public.conversations c
     cross join lateral app.avisos_destino_da_conversa(c.id, false) as d (pessoa)
     where c.last_inbound_at <= now() - interval '24 hours'
       and c.last_inbound_at > now() - interval '24 hours 15 minutes'
       and c.arquivada_em is null
       and not exists (select 1 from public.messages m
                        where m.conversation_id = c.id
                          and m.direction = 'out' and m.origin = 'crm'
                          and m.author_kind in ('human', 'bot_ai')
                          and m.type <> 'template' and m.status <> 'failed'
                          and m.created_at > c.last_inbound_at)
    on conflict (chave) do nothing;
    get diagnostics v_n = row_count; v_novos := v_novos + v_n;
  exception when others then raise warning 'avisos: atrasada: %', sqlerrm;
  end;

  if v_empresa = 'komune' then
    -- 6. Lote para ligar: montado para a pessoa, ou passado a ela, por outra. Quem fez
    --    está no audit_log do gatilho de call_batches.
    begin
      insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
      select (l.new_data ->> 'owner_id')::uuid, 'lote', 'lote:' || l.id,
             left(coalesce(app.primeiro_nome(l.actor_id), 'Alguém')
                  || case when l.action = 'INSERT' then ' montou ' else ' passou ' end
                  || case when coalesce(b.total, 0) > 0
                          then 'um lote de ' || app.avisos_contar(b.total, 'ligação', 'ligações')
                          else 'um lote de ligações' end
                  || ' para você', 240),
             '/ligar'
        from public.audit_log l
        join public.call_batches b on b.id::text = l.row_id::text
        join public.profiles p on p.id = (l.new_data ->> 'owner_id')::uuid and p.is_active
       where l.table_name = 'call_batches'
         and l.created_at > now() - interval '2 minutes'
         and l.action in ('INSERT', 'UPDATE')
         and (l.action = 'INSERT' or (l.old_data ->> 'owner_id') is distinct from (l.new_data ->> 'owner_id'))
         and l.actor_id is distinct from (l.new_data ->> 'owner_id')::uuid
         and b.deleted_at is null
      on conflict (chave) do nothing;
      get diagnostics v_n = row_count; v_novos := v_novos + v_n;
    exception when others then raise warning 'avisos: lote: %', sqlerrm;
    end;

    -- 7. Reunião marcada pelo robô com um parceiro: avisa o dono da reunião.
    begin
      insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
      select r.dono_id, 'reuniao_robo', 'reuniao_robo:' || r.id,
             left('Reunião marcada com ' || coalesce(nullif(trim(o.name), ''), r.titulo) || ': '
                  || app.avisos_quando(r.inicio, true), 240),
             '/agenda'
        from public.reunioes r
        join public.profiles p on p.id = r.dono_id and p.is_active
        left join public.organizations o on o.id = r.organization_id
       where r.marcada_por = 'robo'
         and r.criada_em > now() - interval '2 minutes'
      on conflict (chave) do nothing;
      get diagnostics v_n = row_count; v_novos := v_novos + v_n;
    exception when others then raise warning 'avisos: reuniao_robo: %', sqlerrm;
    end;

    -- 8. Parceiro publicado na Komune: o responsável pelo negócio; sem ele (ou fora do
    --    time), admin e gestor.
    begin
      insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
      select q.pessoa, 'publicado', 'publicado:' || e.id || ':' || q.pessoa,
             left(coalesce(nullif(trim(o.name), ''), 'Um parceiro') || ' foi publicado na Komune', 240),
             '/parceiros/' || e.organization_id
        from public.pre_registration_events e
        join public.organizations o on o.id = e.organization_id
        cross join lateral (
          with dono as (
            select d.owner_id as pessoa
              from public.deals d
             where d.organization_id = e.organization_id
               and d.owner_id in (select a.id from app.avisos_quem_atende() as a (id))
             order by d.updated_at desc
             limit 1
          )
          select pessoa from dono
          union all
          select t.id from public.team_directory t
           where t.is_active and t.role in ('admin', 'gestor')
             and not exists (select 1 from dono)
        ) as q
       where e.event = 'published'
         and e.created_at > now() - interval '2 minutes'
      on conflict (chave) do nothing;
      get diagnostics v_n = row_count; v_novos := v_novos + v_n;
    exception when others then raise warning 'avisos: publicado: %', sqlerrm;
    end;
  end if;

  if v_empresa = 'imova' then
    -- 9. Cliente ligando pelo WhatsApp (pedido de 06/11/2026): enquanto a ligação toca,
    --    para todos que atendem, como a ligação toca no navegador de todos. O toque abre
    --    a conversa, e o CRM aberto mostra a ligação para atender. Só a ligação que
    --    começou há menos de 1 minuto: depois disso o aviso chegaria com ela acabada.
    begin
      insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho, conversa_id)
      select q.pessoa, 'ligando', 'ligando:' || w.id || ':' || q.pessoa,
             left(app.nome_da_conversa(w.conversation_id), 60) || ' está ligando pelo WhatsApp',
             app.caminho_da_conversa(w.conversation_id), w.conversation_id
        from public.wa_chamadas w
       cross join app.avisos_quem_atende() as q (pessoa)
       where w.direcao = 'recebida'
         and w.estado = 'tocando'
         and w.tocou_em > now() - interval '1 minute'
         and not exists (select 1 from public.conversa_preferencias cp
                          where cp.profile_id = q.pessoa
                            and cp.conversation_id = w.conversation_id
                            and cp.silenciada_ate > now())
      on conflict (chave) do nothing;
      get diagnostics v_n = row_count; v_novos := v_novos + v_n;
    exception when others then raise warning 'avisos: ligando: %', sqlerrm;
    end;

    -- 10. Ligação perdida pelo WhatsApp: o cliente ligou e ninguém atendeu.
    begin
      insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho, conversa_id)
      select d.pessoa, 'ligacao_perdida', 'ligacao_perdida:' || w.id || ':' || d.pessoa,
             'Ligação perdida de ' || app.nome_da_conversa(w.conversation_id),
             app.caminho_da_conversa(w.conversation_id), w.conversation_id
        from public.wa_chamadas w
       cross join lateral app.avisos_destino_da_conversa(w.conversation_id, false) as d (pessoa)
       where w.direcao = 'recebida'
         and w.estado = 'perdida'
         and w.conversation_id is not null
         and coalesce(w.encerrada_em, w.tocou_em) > now() - interval '2 minutes'
      on conflict (chave) do nothing;
      get diagnostics v_n = row_count; v_novos := v_novos + v_n;
    exception when others then raise warning 'avisos: ligacao_perdida: %', sqlerrm;
    end;
  end if;

  return v_novos;
end $$;
comment on function app.avisos_push_varrer() is
  'Põe na fila os avisos do que aconteceu há pouco (os comuns e os desta empresa) e os lembretes de 30 min. Só lê: nenhum gatilho em messages ou conversations.';

-- -----------------------------------------------------------------------------
-- F. O RESUMO DAS 8H (segunda a sábado)
-- -----------------------------------------------------------------------------
-- KOMUNE: conversas esperando resposta e compromissos do dia.
-- Imova: o mesmo, mais as ligações perdidas desde ontem (e os leads novos, quando o
-- ramo dos Anúncios entrar). Sem nada a dizer, não sai aviso.
create or replace function app.avisos_push_resumo() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa  text := app.avisos_empresa();
  v_hoje     date := (now() at time zone 'America/Fortaleza')::date;
  v_perdidas bigint := 0;
  v_pessoa   uuid;
  v_conversas bigint;
  v_compromissos bigint;
  v_primeiro timestamptz;
  v_so_visitas boolean;
  v_partes   text[];
  v_palavra  text;
  v_texto    text;
  v_novos    integer := 0;
begin
  if not app.avisos_push_ligados() then
    return 0;
  end if;
  if v_empresa = 'imova' then
    select count(*) into v_perdidas from public.wa_chamadas w
     where w.direcao = 'recebida' and w.estado = 'perdida'
       and coalesce(w.encerrada_em, w.tocou_em) > now() - interval '24 hours';
  end if;

  for v_pessoa in select q.id from app.avisos_quem_atende() as q (id) loop
    begin
      select count(*) into v_conversas from app.conversas_esperando_gente(v_pessoa);

      select count(*), min(x.em), coalesce(bool_and(x.visita), false)
        into v_compromissos, v_primeiro, v_so_visitas
        from (
          select r.inicio as em, false as visita
            from public.reunioes r
           where r.dono_id = v_pessoa
             and r.estado in ('a_confirmar', 'marcada', 'confirmada')
             and (r.inicio at time zone 'America/Fortaleza')::date = v_hoje
          union all
          select t.due_at, t.kind = 'visit'
            from public.tasks t
           where t.assignee_id = v_pessoa
             and t.kind in ('meeting', 'visit') and t.status in ('todo', 'doing')
             and (t.due_at at time zone 'America/Fortaleza')::date = v_hoje
             and not exists (select 1 from public.reunioes r where r.task_id = t.id)
        ) as x;

      v_partes := array[]::text[];
      if v_conversas > 0 then
        v_partes := v_partes || app.avisos_contar(v_conversas, 'conversa espera resposta',
                                                  'conversas esperam resposta');
      end if;
      if v_compromissos > 0 then
        -- Na Imova, um dia só de visitas fala em visitas (a visita ao imóvel).
        if v_empresa = 'imova' and v_so_visitas then
          v_palavra := case when v_compromissos = 1
                            then 'visita hoje, às ' || app.avisos_quando(v_primeiro, false)
                            else 'visitas hoje (a 1ª às ' || app.avisos_quando(v_primeiro, false) || ')' end;
        else
          v_palavra := case when v_compromissos = 1
                            then 'compromisso hoje, às ' || app.avisos_quando(v_primeiro, false)
                            else 'compromissos hoje (o 1º às ' || app.avisos_quando(v_primeiro, false) || ')' end;
        end if;
        v_partes := v_partes || (case when v_empresa = 'komune' then 'você tem ' else '' end
                                 || v_compromissos || ' ' || v_palavra);
      end if;
      if v_perdidas > 0 then
        v_partes := v_partes || app.avisos_contar(v_perdidas, 'ligação perdida desde ontem',
                                                  'ligações perdidas desde ontem');
      end if;

      continue when cardinality(v_partes) = 0;

      v_texto := 'Bom dia! ' || case
        when cardinality(v_partes) = 1 then v_partes[1]
        else array_to_string(v_partes[1:cardinality(v_partes) - 1], ', ')
             || ' e ' || v_partes[cardinality(v_partes)] end;

      insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
      values (v_pessoa, 'resumo', 'resumo:' || v_pessoa || ':' || v_hoje, left(v_texto, 240), '/meu-dia')
      on conflict (chave) do nothing;
      v_novos := v_novos + 1;
    exception when others then raise warning 'avisos: resumo de %: %', v_pessoa, sqlerrm;
    end;
  end loop;
  return v_novos;
end $$;
comment on function app.avisos_push_resumo() is
  'O resumo das 8h de cada pessoa que atende (segunda a sábado), com o que importa em cada empresa. Sem nada a dizer, não sai aviso.';

-- -----------------------------------------------------------------------------
-- G. O ENVIO AO EXPO, e a leitura da resposta
-- -----------------------------------------------------------------------------
create or replace function app.avisos_push_enviar() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mensagens jsonb;
  v_tokens    text[];
  v_ids       bigint[];
  v_pedido    bigint;
  -- Das 8h às 20h, em Fortaleza, o aviso toca; fora, chega sem som (menos o lembrete).
  v_com_som   boolean := extract(hour from now() at time zone 'America/Fortaleza') between 8 and 19;
begin
  -- Aviso velho não sai: o celular avisando 20 minutos depois só atrapalha.
  update app.push_fila set enviado_em = now(), resultado = 'vencido'
   where enviado_em is null
     and (criado_em < now() - interval '10 minutes'
          -- "Está ligando" depois de 1 minuto já não é verdade.
          or (tipo = 'ligando' and criado_em < now() - interval '1 minute'));
  -- O que a pessoa desligou para si.
  update app.push_fila f set enviado_em = now(), resultado = 'desligado'
   where f.enviado_em is null
     and exists (select 1 from public.avisos_desligados d
                  where d.pessoa_id = f.pessoa_id and d.tipo = f.tipo);
  -- Quem não tem aparelho: nada a mandar.
  update app.push_fila f set enviado_em = now(), resultado = 'sem_aparelho'
   where f.enviado_em is null
     and not exists (select 1 from public.aparelhos_push a where a.pessoa_id = f.pessoa_id);

  -- Até 100 por pedido, o teto do Expo.
  with lote as (
    select f.id, f.tipo, f.corpo, f.caminho, a.token, a.empresa, a.empresa_nome
      from app.push_fila f
      join public.aparelhos_push a on a.pessoa_id = f.pessoa_id
     where f.enviado_em is null
     order by f.id
     limit 100
  )
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'to', l.token,
           'title', l.empresa_nome,
           'body', l.corpo,
           'sound', case when v_com_som or l.tipo = 'lembrete' then 'default' end,
           'priority', 'high',
           -- O celular desligado não recebe "está ligando" quando volta: só no primeiro minuto.
           'ttl', case when l.tipo = 'ligando' then 60 end,
           'data', jsonb_build_object('empresa', l.empresa, 'caminho', l.caminho, 'tipo', l.tipo)
         )) order by l.id, l.token),
         array_agg(l.token order by l.id, l.token),
         array_agg(distinct l.id)
    into v_mensagens, v_tokens, v_ids
    from lote l;

  if v_mensagens is null then
    return 0;
  end if;

  select net.http_post(
           url := 'https://exp.host/--/api/v2/push/send',
           headers := jsonb_build_object('Content-Type', 'application/json',
                                         'Accept', 'application/json'),
           body := v_mensagens,
           timeout_milliseconds := 15000)
    into v_pedido;

  insert into app.push_envios (pedido_id, tokens) values (v_pedido, v_tokens);
  update app.push_fila set enviado_em = now(), resultado = 'enviado'
   where id = any (v_ids);
  return jsonb_array_length(v_mensagens);
end $$;

-- A resposta do Expo vem em `data`, na ordem do que foi mandado. "DeviceNotRegistered"
-- é o app apagado do aparelho: o endereço é esquecido e não recebe mais nada.
create or replace function app.avisos_push_conferir() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_envio    record;
  v_corpo    jsonb;
  v_apagados integer := 0;
  v_i        integer;
begin
  for v_envio in
    select e.pedido_id, e.tokens, r.status_code, r.content
      from app.push_envios e
      join net._http_response r on r.id = e.pedido_id
     where e.conferido_em is null
  loop
    begin
      v_corpo := v_envio.content::jsonb;
    exception when others then
      v_corpo := null;
    end;
    if v_corpo ? 'data' and jsonb_typeof(v_corpo -> 'data') = 'array' then
      for v_i in 0 .. jsonb_array_length(v_corpo -> 'data') - 1 loop
        if (v_corpo -> 'data' -> v_i -> 'details' ->> 'error') = 'DeviceNotRegistered' then
          delete from public.aparelhos_push where token = v_envio.tokens[v_i + 1];
          v_apagados := v_apagados + 1;
        end if;
      end loop;
    end if;
    update app.push_envios set conferido_em = now() where pedido_id = v_envio.pedido_id;
  end loop;
  -- O pedido que nunca respondeu não fica pendurado para sempre.
  update app.push_envios set conferido_em = now()
   where conferido_em is null and enviado_em < now() - interval '1 hour';
  return v_apagados;
end $$;

-- A rodada do pg_cron. Cada passo tem o seu tratamento de erro: um problema no envio
-- não impede a varredura da próxima rodada, e nenhum erro sai daqui.
create or replace function app.avisos_push_rodar() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novos    integer := 0;
  v_enviados integer := 0;
  v_apagados integer := 0;
begin
  if not app.avisos_push_ligados() then
    return jsonb_build_object('ligado', false);
  end if;
  begin v_apagados := app.avisos_push_conferir();
  exception when others then raise warning 'avisos_push_conferir: %', sqlerrm; end;
  begin v_novos := app.avisos_push_varrer();
  exception when others then raise warning 'avisos_push_varrer: %', sqlerrm; end;
  begin v_enviados := app.avisos_push_enviar();
  exception when others then raise warning 'avisos_push_enviar: %', sqlerrm; end;
  -- A fila e os envios guardam uma semana: é registro de aviso, não histórico.
  delete from app.push_fila where criado_em < now() - interval '7 days';
  delete from app.push_envios where enviado_em < now() - interval '7 days';
  return jsonb_build_object('ligado', true, 'novos', v_novos, 'enviados', v_enviados,
                            'aparelhos_esquecidos', v_apagados);
end $$;
comment on function app.avisos_push_rodar() is
  'A rodada dos avisos no celular, a cada 10 segundos pelo pg_cron: confere as respostas do Expo, varre o que aconteceu e manda o que estiver na fila.';

revoke all on function app.avisos_catalogo() from public, anon, authenticated;
revoke all on function app.avisos_push_ligados() from public, anon, authenticated;
revoke all on function app.avisos_empresa() from public, anon, authenticated;
revoke all on function app.avisos_quem_atende() from public, anon, authenticated;
revoke all on function app.avisos_destino_da_conversa(uuid, boolean) from public, anon, authenticated;
revoke all on function app.nome_da_conversa(uuid) from public, anon, authenticated;
revoke all on function app.caminho_da_conversa(uuid) from public, anon, authenticated;
revoke all on function app.avisos_quando(timestamptz, boolean) from public, anon, authenticated;
revoke all on function app.avisos_contar(bigint, text, text) from public, anon, authenticated;
revoke all on function app.avisos_push_varrer() from public, anon, authenticated;
revoke all on function app.avisos_push_resumo() from public, anon, authenticated;
revoke all on function app.avisos_push_enviar() from public, anon, authenticated;
revoke all on function app.avisos_push_conferir() from public, anon, authenticated;
revoke all on function app.avisos_push_rodar() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('avisos_push', '10 seconds', $cron$select app.avisos_push_rodar()$cron$);
    -- 8h em Fortaleza (UTC-3, sem horário de verão) = 11h UTC, de segunda a sábado.
    perform cron.schedule('avisos_push_resumo', '0 11 * * 1-6', $cron$select app.avisos_push_resumo()$cron$);
  end if;
end $$;

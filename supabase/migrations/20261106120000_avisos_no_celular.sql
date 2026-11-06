-- =============================================================================
-- AVISOS NO CELULAR (push do app do Tríade) — 06/11/2026
-- =============================================================================
-- Pedido do usuário ("Eu preciso receber pushs nesse app", 05/11/2026), com três
-- avisos e um texto decididos por ele:
--   · mensagem nova de cliente ou parceiro no WhatsApp;
--   · conversa transferida para a pessoa;
--   · compromisso marcado para ela por outra pessoa, e o lembrete 30 min antes.
-- Na tela de bloqueio vai o NOME, nunca o conteúdo da mensagem.
--
-- O WHATSAPP NÃO É TOCADO. Nada aqui é gatilho em `messages`, `conversations` ou
-- nas funções de envio e entrada: uma rotina do pg_cron, a cada 10 segundos, LÊ o
-- que já foi gravado (a última entrada da conversa, as transferências, os avisos da
-- agenda e os compromissos) e põe os avisos numa fila própria. Se esta rotina falhar,
-- a mensagem já entrou e o atendimento segue igual. Nada vai à Meta, nada custa.
--
-- QUEM RECEBE O AVISO DE MENSAGEM é a regra do aviso do navegador
-- (`apps/web/src/components/avisos/regra.ts`), repetida aqui:
--   · conversa de parceiro em que alguém do time já escreveu, com responsável ativo
--     que atende → só o responsável;
--   · senão (parceiro que ninguém respondeu, ou cliente, que é de todos) → todos os
--     ativos que atendem (admin, gestor e sdr);
--   · quem silenciou a conversa não recebe.
--
-- O ENVIO é pelo serviço de push do Expo (grátis), direto do banco com o pg_net, como
-- o `app.komune_push_disparar` já faz com a Edge Function. A resposta do Expo é lida
-- na rodada seguinte: aparelho que saiu do ar (app apagado) é esquecido.
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
  -- Quem registrou foi o site desta empresa: é o nome que vai no título do aviso, e a
  -- empresa que o app abre ao tocar (cada empresa tem banco próprio, e só o site sabe
  -- quem é).
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

revoke all on function public.aparelho_registrar(text, text, text, text) from public, anon;
revoke all on function public.aparelho_remover(text) from public, anon;
grant execute on function public.aparelho_registrar(text, text, text, text) to authenticated;
grant execute on function public.aparelho_remover(text) to authenticated;

-- -----------------------------------------------------------------------------
-- B. A FILA DE AVISOS
-- -----------------------------------------------------------------------------
create table if not exists app.push_fila (
  id          bigint generated always as identity primary key,
  pessoa_id   uuid not null references public.profiles (id) on delete cascade,
  tipo        text not null check (tipo in ('mensagem', 'transferencia', 'compromisso', 'lembrete')),
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
  'Avisos (push) a mandar para o app. Preenchida por app.avisos_push_varrer, esvaziada por app.avisos_push_enviar.';

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
-- C. QUEM ATENDE, E O NOME QUE VAI NO AVISO
-- -----------------------------------------------------------------------------
create or replace function app.avisos_push_ligados() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((
    select (s.value ->> 'ativo')::boolean from public.app_settings s where s.key = 'avisos.push'
  ), true);
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

-- -----------------------------------------------------------------------------
-- D. A VARREDURA: o que aconteceu nos últimos 2 minutos e ainda não virou aviso
-- -----------------------------------------------------------------------------
-- Olhar 2 minutos para trás a cada 10 segundos cobre a transação que gravou com um
-- horário anterior e só apareceu depois; a `chave` única impede o aviso dobrado.
create or replace function app.avisos_push_varrer() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novos integer := 0;
  v_n     integer;
begin
  -- 1. Mensagem nova (a mesma regra do aviso do navegador).
  with atendem as (
    select t.id from public.team_directory t
     where t.is_active and t.role in ('admin', 'gestor', 'sdr')
  ),
  chegaram as (
    select c.id, c.organization_id, c.assignee_id, c.last_inbound_at,
           exists (
             select 1 from public.messages m
              where m.conversation_id = c.id
                and m.direction = 'out' and m.origin = 'crm'
                and m.author_kind in ('human', 'bot_ai')
                and m.type <> 'template' and m.status <> 'failed'
           ) as alguem_escreveu
      from public.conversations c
     where c.last_inbound_at > now() - interval '2 minutes'
  ),
  destinos as (
    select ch.id as conversa_id, ch.last_inbound_at, a.id as pessoa_id
      from chegaram ch
      join atendem a
        on case
             when ch.organization_id is not null and ch.alguem_escreveu
                  and ch.assignee_id in (select id from atendem)
             then a.id = ch.assignee_id
             else true
           end
  )
  insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho, conversa_id)
  select d.pessoa_id, 'mensagem',
         'mensagem:' || d.conversa_id || ':' || d.pessoa_id || ':'
           || extract(epoch from d.last_inbound_at)::bigint,
         'Nova mensagem de ' || app.nome_da_conversa(d.conversa_id),
         app.caminho_da_conversa(d.conversa_id),
         d.conversa_id
    from destinos d
   where not exists (
           select 1 from public.conversa_preferencias cp
            where cp.profile_id = d.pessoa_id and cp.conversation_id = d.conversa_id
              and cp.silenciada_ate > now()
         )
     -- Várias mensagens seguidas da mesma conversa: um aviso por minuto, não um por balão.
     and not exists (
           select 1 from app.push_fila f
            where f.conversa_id = d.conversa_id and f.pessoa_id = d.pessoa_id
              and f.tipo = 'mensagem' and f.criado_em > now() - interval '1 minute'
         )
  on conflict (chave) do nothing;
  get diagnostics v_n = row_count; v_novos := v_novos + v_n;

  -- 2. Conversa transferida para a pessoa (por outra pessoa).
  insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho, conversa_id)
  select t.para_pessoa, 'transferencia', 'transferencia:' || t.id,
         left(coalesce(app.primeiro_nome(t.feita_por), 'Alguém') || ' passou a conversa com '
              || app.nome_da_conversa(t.conversation_id) || ' para você', 240),
         app.caminho_da_conversa(t.conversation_id),
         t.conversation_id
    from public.conversa_transferencias t
    join public.profiles p on p.id = t.para_pessoa and p.is_active
   where t.feita_em > now() - interval '2 minutes'
     and t.para_pessoa is not null and t.para_pessoa <> t.feita_por
  on conflict (chave) do nothing;
  get diagnostics v_n = row_count; v_novos := v_novos + v_n;

  -- 3. Compromisso marcado para a pessoa por outra (o aviso que a agenda já grava).
  insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
  select a.dono_id, 'compromisso', 'compromisso:' || a.id,
         left(coalesce(app.primeiro_nome(a.marcado_por), 'Alguém') || ' marcou para você: ' || a.titulo || ', '
              || to_char(a.quando at time zone 'America/Fortaleza', 'DD/MM "às" HH24:MI'), 240),
         '/agenda'
    from public.agenda_avisos a
    join public.profiles p on p.id = a.dono_id and p.is_active
   where a.criado_em > now() - interval '2 minutes'
     and a.dono_id <> a.marcado_por
  on conflict (chave) do nothing;
  get diagnostics v_n = row_count; v_novos := v_novos + v_n;

  -- 4. Lembrete 30 minutos antes: reuniões e visitas de cada pessoa. O horário entra
  --    na chave: remarcou, o lembrete do horário novo sai de novo.
  insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
  select r.dono_id, 'lembrete',
         'lembrete:reuniao:' || r.id || ':' || extract(epoch from r.inicio)::bigint,
         left('Daqui a 30 min: ' || r.titulo || ', às '
              || to_char(r.inicio at time zone 'America/Fortaleza', 'HH24:MI'), 240),
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
         left('Daqui a 30 min: ' || t.title || ', às '
              || to_char(t.due_at at time zone 'America/Fortaleza', 'HH24:MI'), 240),
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

  return v_novos;
end $$;
comment on function app.avisos_push_varrer() is
  'Põe na fila os avisos do que aconteceu nos últimos 2 minutos (mensagem, transferência, compromisso) e os lembretes de 30 min. Só lê: nenhum gatilho em messages ou conversations.';

-- -----------------------------------------------------------------------------
-- E. O ENVIO AO EXPO, e a leitura da resposta
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
begin
  -- Aviso velho não sai: o celular avisando 20 minutos depois só atrapalha.
  update app.push_fila set enviado_em = now(), resultado = 'vencido'
   where enviado_em is null and criado_em < now() - interval '10 minutes';
  -- Quem não tem aparelho: nada a mandar.
  update app.push_fila f set enviado_em = now(), resultado = 'sem_aparelho'
   where f.enviado_em is null
     and not exists (select 1 from public.aparelhos_push a where a.pessoa_id = f.pessoa_id);

  -- Até 100 por pedido, o teto do Expo.
  with lote as (
    select f.id, f.corpo, f.caminho, a.token, a.empresa, a.empresa_nome
      from app.push_fila f
      join public.aparelhos_push a on a.pessoa_id = f.pessoa_id
     where f.enviado_em is null
     order by f.id
     limit 100
  )
  select jsonb_agg(jsonb_build_object(
           'to', l.token,
           'title', l.empresa_nome,
           'body', l.corpo,
           'sound', 'default',
           'priority', 'high',
           'data', jsonb_build_object('empresa', l.empresa, 'caminho', l.caminho)
         ) order by l.id, l.token),
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

revoke all on function app.avisos_push_ligados() from public, anon, authenticated;
revoke all on function app.nome_da_conversa(uuid) from public, anon, authenticated;
revoke all on function app.caminho_da_conversa(uuid) from public, anon, authenticated;
revoke all on function app.avisos_push_varrer() from public, anon, authenticated;
revoke all on function app.avisos_push_enviar() from public, anon, authenticated;
revoke all on function app.avisos_push_conferir() from public, anon, authenticated;
revoke all on function app.avisos_push_rodar() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('avisos_push', '10 seconds', $cron$select app.avisos_push_rodar()$cron$);
  end if;
end $$;

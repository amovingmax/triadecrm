-- ===========================================================================
-- TRÍADE — a ligação sai pelo navegador (R13 §3.4; RF-CON-11, RF-CON-18,
--          RF-BAS-14, RF-FUN-12, RF-MET-01)
--
-- O módulo de ligação nasceu com o adaptador `manual`: "Ligar" abre o `tel:` do
-- aparelho e quem sabe o que aconteceu na linha é quem está com o fone. Esta
-- migração é o lado do banco do segundo adaptador: a chamada sai do navegador
-- (WebRTC), passa pelo provedor e toca no telefone do parceiro como ligação comum.
--
-- O QUE NÃO MUDA, e é o ponto: desfecho, etapa, temperatura, próxima ação, meta
-- e linha do tempo continuam saindo de `tabular_chamada` e `registrar_contato`.
-- Nada aqui cria um segundo registro comercial de ligação. O que nasce é só o
-- registro TÉCNICO que o modo manual não tinha como ter: o que o provedor disse
-- que aconteceu na linha, e quando.
--
--   1. `public.voice_calls`        — uma chamada feita pelo provedor: quem, para
--      qual parceiro, o estado da linha, os horários e a duração medida por ele.
--      Liga-se à tentativa do lote (`attempt_id`) ou fica avulsa (botão "Ligar"
--      da ficha) e ganha a atividade na tabulação.
--   2. `public.voice_call_events`  — cada aviso do provedor, uma vez só. É o
--      registro de diagnóstico E a chave de idempotência: o mesmo aviso entregue
--      duas vezes não muda nada na segunda.
--   3. `public.voz_abrir_ligacao`  — a porta de quem liga. É aqui que valem as
--      MESMAS travas do modo manual: papel que escreve, janela de horário
--      (`app.call_window`), parceiro suprimido (`app.is_suppressed_target`), e
--      uma só ligação em curso por pessoa (índice único, não `if`).
--   4. `public.voz_twiml_autorizar` e `public.voz_registrar_evento` — as duas
--      portas do provedor, só para `service_role` (Edge Functions `voz-twiml` e
--      `voz-status`, que conferem a assinatura antes de chegar aqui).
--   5. `app.voz_fechar_orfas`      — toda tentativa vira atividade, mesmo a que
--      ninguém tabulou (aba fechada): em 30 minutos ela entra na linha do tempo
--      como ligação com desfecho pendente.
--
-- O NÚMERO NUNCA VEM DA TELA. A tela manda o parceiro (ou a tentativa do lote);
-- quem escolhe o número é esta migração, lendo a ficha ou a reserva do lote. E o
-- número não VOLTA para a tela: quem disca é o provedor, então ligar pela ficha
-- não revela o telefone a quem o vê mascarado. `to_number` e `from_number` não
-- têm SELECT para `authenticated` (o SELECT é concedido coluna a coluna, como em
-- `call_batch_items.phone_e164`).
--
-- DESLIGADA POR PADRÃO. `app_settings['voz.telefonia'].ativa` nasce `false`:
-- aplicar esta migração não muda nada na tela nem gasta um centavo. Liga-se
-- depois de a conta do provedor existir (docs/operacao/telefonia-twilio.md).
--
-- GRAVAÇÃO: `recording_enabled` nasce `false` e nada aqui a liga. Gravar voz é
-- tratamento novo de dado pessoal e depende de decisão do Dennis (R06).
--
-- Idempotente: pode ser reaplicada.
--
-- COMO DESFAZER (nesta ordem):
--   select cron.unschedule('voz_fechar_orfas');
--   drop function if exists app.voz_fechar_orfas();
--   drop function if exists public.voz_vincular_atividade(uuid, uuid);
--   drop function if exists public.voz_encerrar_ligacao(uuid, text, boolean);
--   drop function if exists public.voz_registrar_evento(uuid, text, text, text, int, text, timestamptz);
--   drop function if exists public.voz_twiml_autorizar(uuid, text, text, text);
--   drop function if exists public.voz_abrir_ligacao(uuid, uuid);
--   drop function if exists public.voz_pode_ligar();
--   drop function if exists app.voz_ativa();
--   drop table if exists public.voice_call_events;
--   drop table if exists public.voice_calls;
--   drop type  if exists app.voice_call_status;
--   delete from public.app_settings where key = 'voz.telefonia';
-- Nenhuma tabela existente é alterada, então desfazer não perde dado anterior.
-- ===========================================================================


-- ===========================================================================
-- 1. O estado da linha
-- ===========================================================================
do $$
begin
  create type app.voice_call_status as enum
    ('preparando','chamando','tocando','em_ligacao',
     'finalizada','nao_atendida','ocupado','falha','cancelada');
exception when duplicate_object then null; end $$;


-- ===========================================================================
-- 2. A chave geral
-- ===========================================================================
insert into public.app_settings (key, value, description)
values ('voz.telefonia', '{"ativa": false}'::jsonb,
        'Ligação pelo navegador (softphone). "ativa": true mostra o botão Ligar e libera as chamadas pelo provedor; false mantém o modo manual (tel:).')
on conflict (key) do nothing;

create or replace function app.voz_ativa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value ->> 'ativa')::boolean
                     from public.app_settings s where s.key = 'voz.telefonia'), false)
$$;
comment on function app.voz_ativa() is
  'true quando a ligação pelo navegador está ligada em app_settings[voz.telefonia]. Sem a linha, ou com valor ilegível, é false: a telefonia nunca liga por omissão.';
revoke all on function app.voz_ativa() from public, anon;
grant execute on function app.voz_ativa() to authenticated, service_role;


-- A Edge Function `voz-token` pergunta aqui antes de emitir a credencial do
-- softphone: a identidade sai do JWT que o PostgREST conferiu, nunca de um campo
-- que a tela mandou.
create or replace function public.voz_pode_ligar()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not app.voz_ativa() then
    return jsonb_build_object('ok', false, 'motivo', 'telefonia_desligada');
  end if;
  return jsonb_build_object('ok', true, 'identidade', 'crm_' || v_uid::text);
end $$;
comment on function public.voz_pode_ligar() is
  'Quem está logado pode usar o softphone? Devolve a identidade (crm_<user_id>) que vai na credencial do provedor, ou o motivo da recusa (sem_permissao, telefonia_desligada).';
revoke all on function public.voz_pode_ligar() from public, anon;
grant execute on function public.voz_pode_ligar() to authenticated;


-- ===========================================================================
-- 3. A chamada do provedor
-- ===========================================================================
create table if not exists public.voice_calls (
  id                   uuid primary key default gen_random_uuid(),
  provedor             app.call_provider not null,
  provider_call_sid    text,
  provider_parent_sid  text,
  attempt_id           uuid references public.call_attempts (id) on delete set null,
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  contact_id           uuid references public.contacts (id) on delete set null,
  user_id              uuid not null references public.profiles (id) on delete cascade,
  direction            text not null default 'outbound' check (direction in ('outbound')),
  from_number          text,
  to_number            text not null check (to_number ~ '^\+[1-9][0-9]{7,14}$'),
  status               app.voice_call_status not null default 'preparando',
  iniciada_em          timestamptz not null default now(),
  tocou_em             timestamptz,
  atendida_em          timestamptz,
  encerrada_em         timestamptz,
  duracao_seg          int check (duracao_seg is null or duracao_seg between 0 and 14400),
  error_code           text check (error_code is null or length(error_code) <= 80),
  encerrada_por        text check (encerrada_por is null or encerrada_por in ('provedor','operador','sistema')),
  recording_enabled    boolean not null default false,
  recording_url        text,
  activity_id          uuid references public.activities (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.voice_calls enable row level security;
comment on table public.voice_calls is
  'Uma chamada feita por provedor de telefonia a partir do navegador: o registro TÉCNICO da linha (estado, horários, duração). O registro comercial continua em call_attempts/activities. attempt_id liga à tentativa do lote; sem ele a chamada é avulsa (botão Ligar da ficha).';
comment on column public.voice_calls.provider_call_sid is
  'Identificador da perna que toca no telefone do parceiro (no Twilio, o CallSid filho do <Dial>).';
comment on column public.voice_calls.provider_parent_sid is
  'Identificador da perna do navegador. É o que amarra o aviso de estado à chamada que o pediu.';
comment on column public.voice_calls.to_number is
  'O número discado, escolhido pelo banco (ficha ou reserva do lote), nunca pela tela. Não legível por authenticated: o SELECT é concedido coluna a coluna (RF-BAS-14).';
comment on column public.voice_calls.error_code is
  'Código técnico da falha (do provedor ou do navegador). Fica aqui para diagnóstico; a tela mostra frase, nunca o código.';
comment on column public.voice_calls.encerrada_por is
  'Quem deu a chamada por encerrada: o aviso do provedor (a palavra final), o navegador de quem ligou, ou a limpeza automática.';
comment on column public.voice_calls.recording_enabled is
  'Nasce false e nada a liga: gravação de voz depende de base legal e regra de retenção ainda não decididas (R06).';

-- UMA LIGAÇÃO EM CURSO POR PESSOA. Índice, e não `if`: dois cliques no mesmo
-- milissegundo passam por qualquer `if`, e não passam por aqui.
create unique index if not exists voice_calls_uma_por_pessoa_uq
  on public.voice_calls (user_id)
  where status in ('preparando'::app.voice_call_status, 'chamando'::app.voice_call_status,
                   'tocando'::app.voice_call_status,    'em_ligacao'::app.voice_call_status);
create unique index if not exists voice_calls_sid_uq
  on public.voice_calls (provedor, provider_call_sid) where provider_call_sid is not null;
create index if not exists voice_calls_parent_idx  on public.voice_calls (provider_parent_sid);
create index if not exists voice_calls_org_idx     on public.voice_calls (organization_id, iniciada_em desc);
create index if not exists voice_calls_user_idx    on public.voice_calls (user_id, iniciada_em desc);
create index if not exists voice_calls_attempt_idx on public.voice_calls (attempt_id);
create index if not exists voice_calls_orfas_idx   on public.voice_calls (encerrada_em)
  where activity_id is null and attempt_id is null;

drop trigger if exists voice_calls_set_updated_at on public.voice_calls;
create trigger voice_calls_set_updated_at before update on public.voice_calls
  for each row execute function app.set_updated_at();

-- Ninguém escreve aqui pela tabela: abrir, avançar e fechar passam pelas funções
-- abaixo. A leitura é de quem ligou e de quem gere.
drop policy if exists voice_calls_select on public.voice_calls;
create policy voice_calls_select on public.voice_calls for select to authenticated
  using ((select app.is_manager()) or user_id = (select auth.uid()));

revoke all on public.voice_calls from anon, authenticated;
grant select (id, provedor, attempt_id, organization_id, contact_id, user_id, direction, status,
              iniciada_em, tocou_em, atendida_em, encerrada_em, duracao_seg, error_code,
              encerrada_por, recording_enabled, activity_id, created_at, updated_at)
  on public.voice_calls to authenticated;
grant select, insert, update, delete on public.voice_calls to service_role;


-- ===========================================================================
-- 4. Os avisos do provedor — diagnóstico e idempotência
-- ===========================================================================
create table if not exists public.voice_call_events (
  id                 bigint generated always as identity primary key,
  call_id            uuid not null references public.voice_calls (id) on delete cascade,
  provider_call_sid  text not null,
  event              text not null,
  event_at           timestamptz,
  error_code         text,
  received_at        timestamptz not null default now(),
  unique (call_id, provider_call_sid, event)
);
alter table public.voice_call_events enable row level security;
comment on table public.voice_call_events is
  'Cada aviso de estado que o provedor mandou, uma vez só por (chamada, perna, estado). O aviso repetido esbarra na chave única e não muda nada. Sem telefone, sem token: só ids, estado, hora e código de erro.';

drop policy if exists voice_call_events_select on public.voice_call_events;
create policy voice_call_events_select on public.voice_call_events for select to authenticated
  using ((select app.is_manager()));

revoke all on public.voice_call_events from anon, authenticated;
grant select on public.voice_call_events to authenticated;
grant select, insert, update, delete on public.voice_call_events to service_role;


-- ===========================================================================
-- 5. Abrir a ligação — a porta de quem liga
-- ===========================================================================
-- SECURITY DEFINER pelo telefone: quem vê o número mascarado também liga, e é
-- esta função que o lê. Ela devolve o id da chamada e NADA do número.
--
-- Dois jeitos de entrar, e nunca os dois:
--   * `p_attempt_id`      — a tentativa do lote, já aberta por `iniciar_chamada`
--     (que já conferiu reserva, janela, supressão e teto, e já registrou a
--     revelação). O número é o da reserva: o que foi reservado é o que é discado.
--   * `p_organization_id` — ligação avulsa, da ficha. O número é o da ficha.
create or replace function public.voz_abrir_ligacao(
  p_organization_id uuid default null,
  p_attempt_id      uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    app.user_role;
  a         public.call_attempts%rowtype;
  v_org     uuid;
  v_ct      uuid;
  v_fone    text;
  v_janela  jsonb;
  v_aberta  uuid;
  v_id      uuid;
  v_inicio  timestamptz;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_role := app.role();
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not app.voz_ativa() then
    return jsonb_build_object('ok', false, 'motivo', 'telefonia_desligada');
  end if;

  -- Chamada que morreu sem aviso não pode prender a pessoa: a que nunca chegou
  -- ao provedor em 2 minutos (aba fechada, microfone negado) e a que passou do
  -- limite de duração do provedor sem ninguém avisar o fim.
  update public.voice_calls c
     set status = 'falha'::app.voice_call_status,
         error_code = coalesce(c.error_code, 'sem_retorno'),
         encerrada_em = now(), encerrada_por = 'sistema'
   where c.user_id = v_uid
     and (   (c.status = 'preparando'::app.voice_call_status
              and c.created_at < now() - interval '2 minutes')
          or (c.status in ('chamando'::app.voice_call_status, 'tocando'::app.voice_call_status,
                           'em_ligacao'::app.voice_call_status)
              and c.updated_at < now() - interval '4 hours'));

  select c.id into v_aberta
    from public.voice_calls c
   where c.user_id = v_uid
     and c.status in ('preparando'::app.voice_call_status, 'chamando'::app.voice_call_status,
                      'tocando'::app.voice_call_status,    'em_ligacao'::app.voice_call_status)
   limit 1;
  if v_aberta is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_em_ligacao', 'ligacao_id', v_aberta);
  end if;

  if p_attempt_id is not null then
    select * into a from public.call_attempts x where x.id = p_attempt_id;
    if not found or a.user_id <> v_uid or a.encerrada_em is not null then
      return jsonb_build_object('ok', false, 'motivo', 'chamada_ja_encerrada');
    end if;
    select i.phone_e164 into v_fone from public.call_batch_items i where i.id = a.item_id;
    v_org := a.organization_id;
    v_ct  := a.contact_id;
  else
    if p_organization_id is null or not app.org_is_visible(p_organization_id) then
      return jsonb_build_object('ok', false, 'motivo', 'parceiro_inexistente');
    end if;
    select o.id, o.phone_e164 into v_org, v_fone
      from public.organizations o
     where o.id = p_organization_id and o.deleted_at is null;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'parceiro_inexistente');
    end if;
  end if;

  if nullif(trim(coalesce(v_fone, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_telefone');
  end if;
  -- Só Brasil. Número de fora não é erro de digitação que valha uma tarifa
  -- internacional: é o jeito clássico de alguém gastar a conta dos outros.
  if v_fone !~ '^\+55[1-9][0-9]{9,10}$' then
    return jsonb_build_object('ok', false, 'motivo', 'numero_invalido');
  end if;

  v_janela := app.call_window(now());
  if not (v_janela ->> 'aberta')::boolean then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_janela',
                              'detalhe', v_janela ->> 'motivo', 'abre_em', v_janela -> 'abre_em');
  end if;
  if app.is_suppressed_target(v_org, v_ct) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido');
  end if;

  begin
    insert into public.voice_calls
      (provedor, attempt_id, organization_id, contact_id, user_id, to_number)
    values
      ('twilio'::app.call_provider, a.id, v_org, v_ct, v_uid, v_fone)
    returning id, iniciada_em into v_id, v_inicio;
  exception when unique_violation then
    -- O segundo clique chegou junto com o primeiro.
    return jsonb_build_object('ok', false, 'motivo', 'ja_em_ligacao', 'ligacao_id', null);
  end;

  -- A ligação avulsa USA o telefone sem mostrá-lo. Fica registrada como acesso
  -- ao dado, com a marca de que o número não foi exibido. (No lote, quem já
  -- registrou foi `iniciar_chamada`.)
  if p_attempt_id is null then
    insert into public.pii_access_log (actor_id, actor_role, action, entity_type, entity_id, scope)
    values (v_uid, v_role::text, 'reveal_phone', 'organization', v_org,
            jsonb_build_object('origem', 'voz_abrir_ligacao', 'voice_call_id', v_id,
                               'numero_exibido', false));
  end if;

  return jsonb_build_object(
    'ok', true,
    'ligacao', jsonb_build_object('id', v_id, 'iniciada_em', v_inicio, 'attempt_id', a.id));
end $$;
comment on function public.voz_abrir_ligacao(uuid, uuid) is
  'Abre uma chamada pelo provedor de telefonia (voice_calls) para a tentativa do lote (p_attempt_id) ou para a ficha (p_organization_id). O número é escolhido aqui e não volta para a tela. Recusa com motivo nomeado: sem_permissao, telefonia_desligada, ja_em_ligacao, chamada_ja_encerrada, parceiro_inexistente, sem_telefone, numero_invalido, fora_da_janela, contato_suprimido.';
revoke all on function public.voz_abrir_ligacao(uuid, uuid) from public, anon;
grant execute on function public.voz_abrir_ligacao(uuid, uuid) to authenticated;


-- ===========================================================================
-- 6. O provedor pergunta para quem discar (Edge Function `voz-twiml`)
-- ===========================================================================
-- Chega aqui depois de a assinatura do provedor ter sido conferida. As travas são
-- refeitas, porque entre abrir e discar pode virar as 20h ou chegar um opt-out.
create or replace function public.voz_twiml_autorizar(
  p_call_id     uuid,
  p_identidade  text,
  p_parent_sid  text,
  p_origem      text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c        public.voice_calls%rowtype;
  v_recusa text;
begin
  if not app.e_o_worker() then
    raise exception 'Só o serviço autoriza a discagem' using errcode = '42501';
  end if;

  select * into c from public.voice_calls x where x.id = p_call_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_desconhecida');
  end if;
  if p_identidade is distinct from ('crm_' || c.user_id::text) then
    return jsonb_build_object('ok', false, 'motivo', 'identidade_nao_confere');
  end if;

  -- O provedor repete o pedido quando não ouve a resposta: a mesma perna recebe
  -- a mesma resposta, sem abrir nada de novo.
  if c.provider_parent_sid is not null and c.provider_parent_sid = p_parent_sid
     and c.status in ('chamando'::app.voice_call_status, 'tocando'::app.voice_call_status,
                      'em_ligacao'::app.voice_call_status) then
    return jsonb_build_object('ok', true, 'repetido', true, 'para', c.to_number);
  end if;

  if c.status <> 'preparando'::app.voice_call_status
     or c.created_at < now() - interval '2 minutes' then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_expirada');
  end if;

  v_recusa := case
                when not app.voz_ativa() then 'telefonia_desligada'
                when not (app.call_window(now()) ->> 'aberta')::boolean then 'fora_da_janela'
                when app.is_suppressed_target(c.organization_id, c.contact_id) then 'contato_suprimido'
              end;
  if v_recusa is not null then
    update public.voice_calls x
       set status = 'falha'::app.voice_call_status, error_code = v_recusa,
           provider_parent_sid = p_parent_sid, encerrada_em = now(), encerrada_por = 'sistema'
     where x.id = c.id;
    return jsonb_build_object('ok', false, 'motivo', v_recusa);
  end if;

  update public.voice_calls x
     set status = 'chamando'::app.voice_call_status,
         provider_parent_sid = p_parent_sid,
         from_number = nullif(trim(coalesce(p_origem, '')), '')
   where x.id = c.id;
  return jsonb_build_object('ok', true, 'repetido', false, 'para', c.to_number);
end $$;
comment on function public.voz_twiml_autorizar(uuid, text, text, text) is
  'Porta do provedor (service_role): confere que a chamada existe, é de quem a pediu (identidade crm_<user_id>), ainda está em preparo e continua dentro das travas (chave geral, janela, supressão), e só então devolve o número a discar. Idempotente para a mesma perna.';
revoke all on function public.voz_twiml_autorizar(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.voz_twiml_autorizar(uuid, text, text, text) to service_role;


-- ===========================================================================
-- 7. O provedor avisa o que aconteceu (Edge Function `voz-status`)
-- ===========================================================================
-- O estado só anda para a frente: um "tocando" que chega atrasado, depois do
-- "atendida", não desfaz nada. Os horários entram com coalesce pelo mesmo motivo.
-- A única volta permitida é a do provedor por cima do navegador: se a tela deu a
-- chamada por encerrada antes de o aviso chegar, o que vale é o que o provedor
-- mediu.
create or replace function public.voz_registrar_evento(
  p_call_id     uuid,
  p_call_sid    text,
  p_parent_sid  text,
  p_estado      text,
  p_duracao_seg int         default null,
  p_error_code  text        default null,
  p_em          timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c         public.voice_calls%rowtype;
  v_em      timestamptz := coalesce(p_em, now());
  v_novo    app.voice_call_status;
  v_final   boolean;
  v_avanca  boolean;
  v_dur     int := least(greatest(coalesce(p_duracao_seg, 0), 0), 14400);
  v_linhas  int;
begin
  if not app.e_o_worker() then
    raise exception 'Só o serviço registra aviso do provedor' using errcode = '42501';
  end if;

  v_novo := case p_estado
              when 'initiated'   then 'chamando'
              when 'ringing'     then 'tocando'
              when 'in-progress' then 'em_ligacao'
              when 'answered'    then 'em_ligacao'
              when 'completed'   then 'finalizada'
              when 'no-answer'   then 'nao_atendida'
              when 'busy'        then 'ocupado'
              when 'failed'      then 'falha'
              when 'canceled'    then 'cancelada'
            end::app.voice_call_status;
  if v_novo is null or nullif(trim(coalesce(p_call_sid, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'evento_desconhecido');
  end if;

  select * into c from public.voice_calls x where x.id = p_call_id for update;
  if not found or c.provider_parent_sid is null
     or c.provider_parent_sid is distinct from p_parent_sid then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_desconhecida');
  end if;

  insert into public.voice_call_events (call_id, provider_call_sid, event, event_at, error_code)
  values (c.id, p_call_sid, p_estado, v_em, left(p_error_code, 80))
  on conflict (call_id, provider_call_sid, event) do nothing;
  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    return jsonb_build_object('ok', true, 'repetido', true, 'status', c.status);
  end if;

  v_final  := v_novo in ('finalizada'::app.voice_call_status, 'nao_atendida'::app.voice_call_status,
                         'ocupado'::app.voice_call_status,    'falha'::app.voice_call_status,
                         'cancelada'::app.voice_call_status);
  v_avanca := case
                when c.status in ('preparando'::app.voice_call_status, 'chamando'::app.voice_call_status,
                                  'tocando'::app.voice_call_status,    'em_ligacao'::app.voice_call_status)
                  then v_final or v_novo > c.status
                else v_final and c.encerrada_por is distinct from 'provedor'
              end;

  update public.voice_calls x
     set provider_call_sid = coalesce(x.provider_call_sid, p_call_sid),
         status        = case when v_avanca then v_novo else x.status end,
         tocou_em      = case when p_estado = 'ringing' then coalesce(x.tocou_em, v_em) else x.tocou_em end,
         atendida_em   = case
                           when v_novo = 'em_ligacao'::app.voice_call_status then coalesce(x.atendida_em, v_em)
                           when v_novo = 'finalizada'::app.voice_call_status
                             then coalesce(x.atendida_em, v_em - make_interval(secs => v_dur))
                           else x.atendida_em
                         end,
         encerrada_em  = case when v_final and v_avanca then v_em else x.encerrada_em end,
         encerrada_por = case when v_final and v_avanca then 'provedor' else x.encerrada_por end,
         duracao_seg   = case when v_final and v_avanca
                              then case when v_novo = 'finalizada'::app.voice_call_status then v_dur else 0 end
                              else x.duracao_seg end,
         error_code    = case when v_final and v_avanca
                              then coalesce(left(p_error_code, 80), case when v_novo = 'finalizada'::app.voice_call_status
                                                                         then null else x.error_code end)
                              else x.error_code end
   where x.id = c.id
  returning * into c;

  return jsonb_build_object('ok', true, 'repetido', false, 'status', c.status);
end $$;
comment on function public.voz_registrar_evento(uuid, text, text, text, int, text, timestamptz) is
  'Porta do provedor (service_role): grava o aviso de estado uma vez só (voice_call_events) e avança voice_calls. Idempotente por (chamada, perna, estado); o estado nunca volta, e o aviso final do provedor vale por cima do encerramento feito pela tela.';
revoke all on function public.voz_registrar_evento(uuid, text, text, text, int, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.voz_registrar_evento(uuid, text, text, text, int, text, timestamptz)
  to service_role;


-- ===========================================================================
-- 8. A tela avisa que acabou (ou que nem começou)
-- ===========================================================================
-- Serve a três casos: microfone negado depois de a chamada ter sido aberta, erro
-- do navegador antes de o provedor saber da chamada, e a pessoa que desligou —
-- para a trava de "uma ligação por vez" soltar na hora, sem esperar o aviso.
create or replace function public.voz_encerrar_ligacao(
  p_call_id  uuid,
  p_codigo   text    default null,
  p_falha    boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c     public.voice_calls%rowtype;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  select * into c from public.voice_calls x where x.id = p_call_id for update;
  if not found or c.user_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_desconhecida');
  end if;
  if c.status not in ('preparando'::app.voice_call_status, 'chamando'::app.voice_call_status,
                      'tocando'::app.voice_call_status,    'em_ligacao'::app.voice_call_status) then
    return jsonb_build_object('ok', true, 'repetido', true, 'status', c.status);
  end if;

  update public.voice_calls x
     set status = case
                    when coalesce(p_falha, false)                       then 'falha'
                    when x.status = 'em_ligacao'::app.voice_call_status then 'finalizada'
                    else 'cancelada'
                  end::app.voice_call_status,
         error_code    = coalesce(left(nullif(trim(coalesce(p_codigo, '')), ''), 80), x.error_code),
         encerrada_em  = now(),
         encerrada_por = 'operador',
         duracao_seg   = case when x.atendida_em is not null
                              then least(greatest(extract(epoch from now() - x.atendida_em)::int, 0), 14400)
                              else 0 end
   where x.id = c.id
  returning * into c;
  return jsonb_build_object('ok', true, 'repetido', false, 'status', c.status);
end $$;
comment on function public.voz_encerrar_ligacao(uuid, text, boolean) is
  'Quem ligou dá a própria chamada por encerrada (desligou, cancelou ou o navegador falhou), para a trava de uma ligação por vez soltar na hora. O aviso final do provedor, quando chegar, vale por cima.';
revoke all on function public.voz_encerrar_ligacao(uuid, text, boolean) from public, anon;
grant execute on function public.voz_encerrar_ligacao(uuid, text, boolean) to authenticated;


-- ===========================================================================
-- 9. A tabulação encontra a chamada
-- ===========================================================================
create or replace function public.voz_vincular_atividade(p_call_id uuid, p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c     public.voice_calls%rowtype;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  select * into c from public.voice_calls x where x.id = p_call_id for update;
  if not found or c.user_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_desconhecida');
  end if;
  if c.activity_id is not null then
    return jsonb_build_object('ok', c.activity_id = p_activity_id, 'repetido', true);
  end if;
  if not exists (select 1 from public.activities t
                  where t.id = p_activity_id
                    and t.user_id = v_uid
                    and t.organization_id = c.organization_id
                    and t.type = 'call'::app.activity_type) then
    return jsonb_build_object('ok', false, 'motivo', 'atividade_nao_confere');
  end if;
  update public.voice_calls x set activity_id = p_activity_id where x.id = c.id;
  return jsonb_build_object('ok', true, 'repetido', false);
end $$;
comment on function public.voz_vincular_atividade(uuid, uuid) is
  'Liga a chamada do provedor à atividade que a tabulação criou (mesma pessoa, mesmo parceiro, tipo ligação). Depois disso a limpeza automática não cria atividade para ela.';
revoke all on function public.voz_vincular_atividade(uuid, uuid) from public, anon;
grant execute on function public.voz_vincular_atividade(uuid, uuid) to authenticated;


-- ===========================================================================
-- 10. Toda tentativa vira atividade
-- ===========================================================================
-- A ligação avulsa que ninguém tabulou (aba fechada, celular sem bateria)
-- aconteceu mesmo assim. Em 30 minutos ela entra na linha do tempo como ligação
-- sem desfecho — o gatilho `activities_apply_outcome` marca `outcome_pending`, e
-- quem cobra o desfecho é a rotina que já existe (RF-MET-04).
--
-- A do LOTE não entra aqui: a tentativa aberta e a reserva do item já têm dono
-- (`tabular_chamada` e `app.expirar_reservas`).
create or replace function app.voz_fechar_orfas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c        record;
  v_act    uuid;
  v_feitas int := 0;
begin
  update public.voice_calls x
     set status = 'falha'::app.voice_call_status,
         error_code = coalesce(x.error_code, 'sem_retorno'),
         encerrada_em = now(), encerrada_por = 'sistema'
   where (x.status = 'preparando'::app.voice_call_status and x.created_at < now() - interval '5 minutes')
      or (x.status in ('chamando'::app.voice_call_status, 'tocando'::app.voice_call_status,
                       'em_ligacao'::app.voice_call_status)
          and x.updated_at < now() - interval '4 hours');

  for c in
    select x.* from public.voice_calls x
     where x.attempt_id is null and x.activity_id is null
       and x.encerrada_em is not null and x.encerrada_em < now() - interval '30 minutes'
       -- Chamada que nem chegou ao provedor não tocou em telefone nenhum.
       and x.provider_parent_sid is not null
     order by x.encerrada_em
     limit 200
     for update skip locked
  loop
    insert into public.activities
      (type, organization_id, contact_id, user_id, author_kind, occurred_at, duration_min, channel, metadata)
    values
      ('call'::app.activity_type, c.organization_id, c.contact_id, c.user_id, 'human', c.iniciada_em,
       nullif(round(coalesce(c.duracao_seg, 0) / 60.0)::int, 0), 'phone'::app.channel,
       jsonb_build_object('voice_call_id', c.id, 'linha', c.status::text, 'sem_tabulacao', true))
    returning id into v_act;
    update public.voice_calls x set activity_id = v_act where x.id = c.id;
    v_feitas := v_feitas + 1;
  end loop;
  return v_feitas;
end $$;
comment on function app.voz_fechar_orfas() is
  'pg_cron, a cada 10 min: dá por falha a chamada do provedor que morreu sem aviso e cria a atividade (ligação, desfecho pendente) da chamada avulsa encerrada há mais de 30 min que ninguém tabulou. Devolve quantas atividades criou.';
revoke all on function app.voz_fechar_orfas() from public, anon, authenticated;
grant execute on function app.voz_fechar_orfas() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('voz_fechar_orfas', '*/10 * * * *', $cron$select app.voz_fechar_orfas()$cron$);
  end if;
end $$;

notify pgrst, 'reload schema';

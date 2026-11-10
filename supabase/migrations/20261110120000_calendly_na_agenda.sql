-- =====================================================================
-- O Calendly marca na Agenda do CRM, sem dois no mesmo horário, só na Imova
-- (10/11/2026)
--
-- Pedido do usuário: "Assim que alguém quiser marcar uma reunião ou visita, a
-- pessoa entra no link e vê a disponibilidade da nossa agenda e solicita uma
-- reunião de acordo com os horários disponíveis. Assim que esse horário for
-- agendado deve chegar no CRM da Imova um aviso dizendo sobre a reunião ou
-- visita e informando também na agenda." E depois: "Caso um cliente queira
-- escolher uma data e horário que já foi selecionado e agendado, deve-se
-- mostrar indisponível [...]. Somente deve ser possível se o desmarcarmos o
-- cliente que já tinha feito o agendamento de origem. Duas pessoas não podem
-- estar dentro do mesmo horário da agenda."
--
-- Decisões do usuário (10/11/2026): o Calendly fica, e o CRM ESPELHA a agenda
-- num Google Agenda ligado a ele (só "Ocupado", sem nome de cliente), para o
-- Calendly esconder o horário que o CRM já ocupou; e, se mesmo assim chegar um
-- agendamento em horário ocupado, o CRM CANCELA O NOVO no Calendly.
--
-- QUATRO CAMINHOS, TODOS COM O BANCO DECIDINDO (ADR-03):
--
--   1. CHEGOU UM AGENDAMENTO (Edge Function `calendly-webhook` →
--      `public.calendly_receber`, numa transação):
--      · uma vez só, pela URI do convidado (`calendly_agendamentos`);
--      · a ficha pelo telefone e depois pelo e-mail (as regras do lead do
--        portal), ou uma de Cliente com a origem Calendly; ficha suprimida não
--        ganha compromisso (`suprimido`);
--      · o dono: a pessoa com o e-mail do anfitrião; senão
--        `app_settings['calendly'].dono_email`; senão o admin mais antigo;
--      · HORÁRIO LIVRE: reunião vira `reunioes` (marcada_por = 'calendly') com
--        a tarefa-eco e o e-mail ao dono; visita vira tarefa `visit`; o negócio
--        anda para a etapa que pede data; aviso na Agenda (`agenda_avisos`),
--        push e nota na ficha;
--      · HORÁRIO OCUPADO: nada entra na agenda. O agendamento fica `recusado`,
--        a ficha ganha a nota, quem atende ganha o push, e o pedido de
--        cancelamento fica pendente para o Calendly (caminho 3).
--   2. O CLIENTE CANCELOU OU REMARCOU no Calendly: a reunião é cancelada pela
--      porta da tela (`app.reuniao_cancelar_interno`, com o e-mail), a tarefa
--      vira `cancelled`, nota e push. Remarcou: o velho fecha como remarcado e
--      o novo nasce com `remarcada_de`, em qualquer ordem de chegada.
--   3. O CRM CANCELA NO CALENDLY (`imova-worker-wa`, pela API do Calendly):
--      o agendamento recusado, e o que a equipe desmarcou ou remarcou pelo CRM.
--      É o que devolve o horário ao Calendly e avisa o cliente por e-mail.
--      `public.calendly_cancelamentos_pendentes` diz o que falta.
--   4. O CRM ESPELHA A AGENDA NO GOOGLE (`imova-worker-wa`, pela API do Google
--      com uma conta de serviço): cada compromisso de quem atende pelo
--      Calendly que NÃO veio do Calendly vira um bloco "Ocupado" no Google
--      Agenda que o Calendly confere. `public.agenda_espelho_pendencias` diz o
--      que gravar e o que apagar; o id do evento no Google sai do id do
--      compromisso, então gravar duas vezes não duplica.
--
-- "OCUPADO" TEM UMA DEFINIÇÃO SÓ (`app.agenda_ocupada`), usada para recusar o
-- agendamento e para o espelho: reunião viva, visita aberta e reunião com hora
-- combinada (etapa que pede `meeting_at`, a régua de `naturezaDoCompromisso`).
-- A tarefa "a marcar" (apresentação ainda sem data, que nasce às 9h pela régua)
-- não ocupa horário: recusar um cliente por causa dela seria perder o cliente
-- por um lembrete.
--
-- ===========================================================================
-- O QUE MUDA NAS DUAS EMPRESAS (parte A, só acrescenta)
-- ===========================================================================
-- A tela da Agenda é uma só para as duas, então o aviso precisa da mesma forma
-- nos dois bancos: `agenda_avisos` ganha `origem` (padrão 'equipe') e
-- `detalhe`, e `marcado_por` passa a aceitar nulo quando a origem é o Calendly.
-- `reunioes.marcada_por` e `tasks.origin` passam a aceitar 'calendly'. Nada do
-- que existe muda de valor; todo código que lê `marcada_por` compara com
-- 'robo', e a varredura do push já descarta aviso sem `marcado_por`.
-- E uma correção de defeito que já existia: a grade de horários livres
-- (`app.reuniao_horarios_livres`) passa a contar a duração da visita, e não só
-- o minuto em que ela começa — antes, dava para marcar reunião por cima dela.
--
-- ===========================================================================
-- O QUE NÃO ACONTECE
-- ===========================================================================
-- Nada vai ao WhatsApp: nenhuma linha em `messages`, `conversations`, `wa_acoes`
-- ou nas filas de envio. O Google recebe só início, fim e "Ocupado": nem nome,
-- nem telefone, nem endereço. O dossiê da LGPD e a retenção não leem as tabelas
-- novas (o mesmo recorte dos leads dos portais).
--
-- COMO DESFAZER (no banco da Imova; a parte A pode ficar):
--   drop function if exists public.calendly_receber(jsonb),
--     public.calendly_cancelamentos_pendentes(int), public.calendly_cancelamento_feito(uuid),
--     public.calendly_cancelamento_falhou(uuid, text, boolean),
--     public.agenda_espelho_pendencias(int), public.agenda_espelho_gravado(uuid, timestamptz, timestamptz),
--     public.agenda_espelho_apagado(uuid), public.agenda_espelho_falhou(uuid, timestamptz, timestamptz, text),
--     app.calendly_config(), app.calendly_pessoa_da_agenda(), app.calendly_dono(text),
--     app.calendly_ficha(text, text, text), app.agenda_ocupada(uuid, timestamptz, timestamptz),
--     app.calendly_conflitos(uuid, timestamptz, timestamptz), app.calendly_andar_etapa(uuid, timestamptz),
--     app.calendly_lado_crm_fechado(public.calendly_agendamentos), app.calendly_fechar(uuid, text, text);
--   drop table if exists app.agenda_espelho, public.calendly_agendamentos;
--   delete from public.sources where slug = 'calendly'
--     and not exists (select 1 from public.organizations o where o.source_id = sources.id)
--     and not exists (select 1 from public.deals d where d.source_id = sources.id);
--   Os blocos "Ocupado — CRM Imova" que já estão no Google Agenda ficam lá:
--   apague-os pelo próprio Google Agenda (todos têm esse título).
-- =====================================================================

-- =====================================================================
-- A. NAS DUAS EMPRESAS
-- =====================================================================

-- A reunião que o cliente marcou sozinho, pelo link.
alter table public.reunioes drop constraint if exists reunioes_marcada_por_check;
alter table public.reunioes add constraint reunioes_marcada_por_check
  check (marcada_por in ('robo', 'pessoa', 'calendly'));
alter table public.reunioes drop constraint if exists reunioes_robo_chk;
alter table public.reunioes add constraint reunioes_robo_chk check (
  (marcada_por = 'robo' and conversation_id is not null) or marcada_por in ('pessoa', 'calendly'));

-- A tarefa que nasce de um agendamento do Calendly (a visita, o eco da reunião).
alter table public.tasks drop constraint if exists tasks_origin_check;
alter table public.tasks add constraint tasks_origin_check
  check (origin in ('manual', 'cadence', 'ai', 'system', 'calendly'));

-- O aviso sem pessoa que marcou: quem marcou foi o cliente, pelo Calendly.
alter table public.agenda_avisos alter column marcado_por drop not null;
alter table public.agenda_avisos add column if not exists origem text not null default 'equipe';
alter table public.agenda_avisos add column if not exists detalhe text;
alter table public.agenda_avisos drop constraint if exists agenda_avisos_origem_chk;
alter table public.agenda_avisos add constraint agenda_avisos_origem_chk check (
  (origem = 'equipe' and marcado_por is not null) or (origem = 'calendly' and marcado_por is null));
alter table public.agenda_avisos drop constraint if exists agenda_avisos_detalhe_chk;
alter table public.agenda_avisos add constraint agenda_avisos_detalhe_chk
  check (detalhe is null or char_length(detalhe) between 1 and 300);

comment on column public.agenda_avisos.origem is
  'Quem pôs o compromisso na agenda: ''equipe'' (gestor ou admin, `marcado_por` preenchido) ou ''calendly'' (o cliente, pelo link; `marcado_por` nulo).';
comment on column public.agenda_avisos.detalhe is
  'Uma frase a mais para quem recebe (hoje: de quando o cliente remarcou). Nulo quando não há o que dizer.';

-- A grade de horários livres conta a DURAÇÃO da tarefa de campo (10/11/2026).
--
-- Defeito que já existia, achado ao conferir a Agenda com o Calendly: a grade
-- (`app.reuniao_horarios_livres`, que a `reuniao_gravar` usa para aceitar ou
-- recusar uma reunião) tratava a visita como um ponto no tempo. A visita das
-- 10h00 (que dura 45 min) só bloqueava o horário que CONTÉM 10h00; a reunião
-- das 10h20 aparecia livre e era aceita, por cima da visita. Com o Calendly
-- isso viraria duas pessoas no mesmo horário. Agora a tarefa ocupa
-- [começo, começo + duração padrão), como na `visita_marcar`. O corpo é o de
-- 20260930110000, com só essa condição (e a duração da visita) trocada; vale
-- nas duas empresas, e só tira da grade horário que já estava ocupado.
create or replace function app.reuniao_horarios_livres(
  p_dono uuid, p_de date, p_ate date, p_limite int default 3)
returns table (inicio timestamptz, fim timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  c            jsonb := app.reuniao_config();
  v_ini        time  := coalesce((c #>> '{janela,inicio}')::time, time '09:30');
  v_fim        time  := coalesce((c #>> '{janela,fim}')::time,    time '17:20');
  v_dur        int   := coalesce((c ->> 'duracao_min')::int, 40);
  v_dur_visita int   := coalesce((c ->> 'duracao_visita_min')::int, 45);
  v_int        int   := coalesce((c ->> 'intervalo_min')::int, 10);
  v_pausa_de   time  := (c #>> '{pausa,de}')::time;
  v_pausa_ate  time  := (c #>> '{pausa,ate}')::time;
  v_antec      int   := coalesce((c ->> 'antecedencia_min_horas')::int, 3);
  v_horizonte  int   := coalesce((c ->> 'horizonte_dias_uteis')::int, 10);
  v_teto       int   := coalesce((c ->> 'max_por_dia_por_pessoa')::int, 4);
  v_hoje       date  := (now() at time zone 'America/Fortaleza')::date;
  v_ultimo     date  := app.next_business_day(v_hoje, v_horizonte);
  v_rota_de    time  := coalesce((select (s.value #>> '{janela,inicio}')::time
                                    from public.app_settings s where s.key = 'rotas.planejador'),
                                 time '14:00');
  v_rota_ate   time  := coalesce((select (s.value #>> '{janela,fim}')::time
                                    from public.app_settings s where s.key = 'rotas.planejador'),
                                 time '18:00');
  v_passos     int   := 1 + (extract(epoch from (v_fim - v_ini)) / 60)::int / (v_dur + v_int);
begin
  return query
  with dias as (
    select d::date as dia
      from generate_series(greatest(p_de, v_hoje), least(p_ate, v_ultimo), interval '1 day') d
     where app.eh_dia_util(d::date)
  ),
  candidatos as (
    select dias.dia,
           ((dias.dia + v_ini) at time zone 'America/Fortaleza')
             + make_interval(mins => passo * (v_dur + v_int)) as ini
      from dias, generate_series(0, v_passos) passo
  ),
  janelados as (
    select c2.dia, c2.ini, c2.ini + make_interval(mins => v_dur) as f from candidatos c2
  )
  select j.ini, j.f
    from janelados j
   where (j.f at time zone 'America/Fortaleza')::time <= v_fim
     and j.ini >= now() + make_interval(hours => v_antec)
     and not (v_pausa_de is not null and v_pausa_ate is not null
              and tstzrange(j.ini, j.f, '[)') && tstzrange(
                    (j.dia + v_pausa_de)  at time zone 'America/Fortaleza',
                    (j.dia + v_pausa_ate) at time zone 'America/Fortaleza', '[)'))
     and not (exists (select 1 from public.route_plans rp
                       where rp.assignee_id = p_dono and rp.plan_date = j.dia
                         and rp.status in ('enfileirada'::app.route_status,
                                           'pronta'::app.route_status))
              and tstzrange(j.ini, j.f, '[)') && tstzrange(
                    (j.dia + v_rota_de)  at time zone 'America/Fortaleza',
                    (j.dia + v_rota_ate) at time zone 'America/Fortaleza', '[)'))
     and not exists (select 1 from public.reunioes r
                      where r.dono_id = p_dono
                        and r.estado in ('a_confirmar','marcada','confirmada')
                        and r.durante && tstzrange(j.ini, j.f, '[)'))
     and not exists (select 1 from public.tasks t
                      where t.assignee_id = p_dono
                        and t.kind   in ('meeting'::app.task_kind, 'visit'::app.task_kind)
                        and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
                        -- A tarefa ocupa a duração dela, não só o minuto do começo
                        -- (a régua de `visita_marcar` e de `app.agenda_ocupada`).
                        and t.due_at < j.f
                        and t.due_at + make_interval(mins => case when t.kind = 'visit'::app.task_kind
                                                                  then v_dur_visita else v_dur end) > j.ini
                        and not exists (select 1 from public.reunioes r2 where r2.task_id = t.id))
     and (select count(*) from public.reunioes r3
           where r3.dono_id = p_dono
             and r3.estado in ('a_confirmar','marcada','confirmada')
             and (r3.inicio at time zone 'America/Fortaleza')::date = j.dia) < v_teto
   order by j.ini
   limit greatest(coalesce(p_limite, 3), 1);
end $$;


-- =====================================================================
-- B. SÓ NA IMOVA
-- =====================================================================
do $calendly$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O Calendly é só da Imova: no banco da KOMUNE só entrou a parte A.';
    return;
  end if;
  execute $ddl$

-- ---------------------------------------------------------------------
-- B1. A origem das fichas que nascem de um agendamento
-- ---------------------------------------------------------------------
-- Não é coletor do Radar (`collector.enabled` falso); quem escreve aqui é o
-- webhook do Calendly.
insert into public.sources (slug, name, kind, base_url, legal_basis, terms_notes, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values ('calendly', 'Calendly', 'api', 'https://calendly.com',
        'legitimo_interesse',
        'A pessoa abriu o link de agendamento da Imova Imobiliária no Calendly e marcou ela mesma uma reunião ou visita. O dado veio dela, num contato que ela iniciou.',
        null, 0.00, true,
        '{"collector": {"kind": "webhook", "phase": "mvp", "enabled": false}, "entrada_por_webhook": true}')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- B2. O agendamento
-- ---------------------------------------------------------------------
create table if not exists public.calendly_agendamentos (
  id                  uuid primary key default gen_random_uuid(),
  -- A URI do convidado no Calendly: um agendamento, uma linha. Remarcar no
  -- Calendly cria um convidado novo (com a URI do velho em `old_invitee`).
  convidado_uri       text not null unique check (char_length(convidado_uri) between 10 and 300),
  evento_uri          text not null check (char_length(evento_uri) between 10 and 300),
  -- agendado: está na agenda · recusado: chegou em horário ocupado e não entrou
  -- cancelado / remarcado: fechado · suprimido: ficha que pediu para não ser
  -- contatada · sem_dono: ninguém ativo no CRM para receber.
  situacao            text not null check (situacao in ('agendado', 'recusado', 'cancelado',
                                                        'remarcado', 'suprimido', 'sem_dono')),
  natureza            text check (natureza in ('reuniao', 'visita')),
  tipo_de_evento      text check (char_length(tipo_de_evento) <= 200),
  inicio              timestamptz,
  fim                 timestamptz,
  formato             text check (formato in ('online', 'presencial')),
  link                text check (char_length(link) <= 1000),
  local               text check (char_length(local) <= 500),
  dono_id             uuid references public.profiles (id) on delete set null,
  organization_id     uuid references public.organizations (id) on delete set null,
  deal_id             uuid references public.deals (id) on delete set null,
  reuniao_id          uuid references public.reunioes (id) on delete set null,
  task_id             uuid references public.tasks (id) on delete set null,
  aviso_id            uuid references public.agenda_avisos (id) on delete set null,
  -- O que já ocupava o horário quando o agendamento chegou (tipo, título, início).
  conflitos           jsonb not null default '[]'::jsonb check (jsonb_typeof(conflitos) = 'array'),
  -- As perguntas do Calendly e o que a pessoa respondeu, MENOS a de telefone
  -- (ele mora na ficha) e sem CPF.
  respostas           jsonb not null default '[]'::jsonb check (jsonb_typeof(respostas) = 'array'),
  ficha               text check (ficha in ('ligada', 'criada', 'suprimida', 'catalogo_incompleto')),
  remarcado_de        uuid references public.calendly_agendamentos (id) on delete set null,
  -- Os links do Calendly para cancelar e remarcar em nome do cliente. Quem tem
  -- o link cancela: só a gestão e o dono leem (RLS abaixo).
  link_cancelar       text check (char_length(link_cancelar) <= 500),
  link_remarcar       text check (char_length(link_remarcar) <= 500),
  cancelado_em        timestamptz,
  cancelado_por       text check (cancelado_por in ('convidado', 'anfitriao')),
  motivo_cancelamento text check (char_length(motivo_cancelamento) <= 500),
  -- O CRM pedindo ao Calendly que cancele (caminho 3): quando conseguiu, e as
  -- tentativas, com espera crescente, quando o Calendly não respondeu.
  cancelado_no_calendly_em timestamptz,
  cancelar_tentativas int not null default 0 check (cancelar_tentativas between 0 and 8),
  cancelar_depois_de  timestamptz,
  cancelar_erro       text check (char_length(cancelar_erro) <= 500),
  recebido_em         timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index if not exists calendly_agendamentos_dono_idx   on public.calendly_agendamentos (dono_id, inicio);
create index if not exists calendly_agendamentos_org_idx    on public.calendly_agendamentos (organization_id);
create index if not exists calendly_agendamentos_task_idx   on public.calendly_agendamentos (task_id);
create index if not exists calendly_agendamentos_evento_idx on public.calendly_agendamentos (evento_uri);
create index if not exists calendly_agendamentos_cancelar_idx on public.calendly_agendamentos (recebido_em)
  where cancelado_no_calendly_em is null and situacao in ('agendado', 'recusado');

comment on table public.calendly_agendamentos is
  'Cada agendamento que o Calendly avisou (convidado criado ou cancelado), uma linha por convidado. Gravada só pelas funções do Calendly. Liga o agendamento à ficha, à reunião ou visita da Agenda e ao aviso de quem atende, e guarda o pedido de cancelamento que o CRM faz ao Calendly.';

alter table public.calendly_agendamentos enable row level security;
drop policy if exists calendly_agendamentos_select on public.calendly_agendamentos;
create policy calendly_agendamentos_select on public.calendly_agendamentos
  for select to authenticated
  using ((select app.is_manager()) or dono_id = (select auth.uid()));
grant select on public.calendly_agendamentos to authenticated;
revoke insert, update, delete on public.calendly_agendamentos from authenticated, anon;
grant select, insert, update, delete on public.calendly_agendamentos to service_role;

drop trigger if exists calendly_agendamentos_audit on public.calendly_agendamentos;
create trigger calendly_agendamentos_audit after insert or update or delete on public.calendly_agendamentos
  for each row execute function app.audit();

-- ---------------------------------------------------------------------
-- B3. A configuração, a agenda do Calendly e quem atende
-- ---------------------------------------------------------------------
create or replace function app.calendly_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select '{"dono_email": null, "google_agenda_id": null}'::jsonb
         || coalesce((select s.value from public.app_settings s where s.key = 'calendly'), '{}'::jsonb)
$$;
comment on function app.calendly_config() is
  'app_settings[calendly] com os padrões por baixo: dono_email (no CRM, quem atende pelo Calendly) e google_agenda_id (o Google Agenda que o Calendly confere e que o CRM espelha).';

create or replace function app.calendly_pessoa_da_agenda()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.id from public.profiles p join auth.users u on u.id = p.id
      where p.is_active
        and lower(u.email::text) = lower(btrim(app.calendly_config() ->> 'dono_email'))
      limit 1),
    -- Sem configuração: quem recebeu o último agendamento.
    (select a.dono_id from public.calendly_agendamentos a
       join public.profiles p on p.id = a.dono_id and p.is_active
      order by a.recebido_em desc
      limit 1))
$$;
comment on function app.calendly_pessoa_da_agenda() is
  'De quem é a agenda que o Calendly oferece: a pessoa de app_settings[calendly].dono_email; senão quem recebeu o último agendamento. É a agenda que o CRM espelha no Google.';

create or replace function app.calendly_dono(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    -- A pessoa do CRM com o e-mail do anfitrião no Calendly.
    (select p.id from public.profiles p join auth.users u on u.id = p.id
      where p.is_active and lower(u.email::text) = lower(btrim(p_email))
      limit 1),
    -- A pessoa escolhida em Ajustes (`app_settings['calendly'].dono_email`).
    (select p.id from public.profiles p join auth.users u on u.id = p.id
      where p.is_active
        and lower(u.email::text) = lower(btrim(app.calendly_config() ->> 'dono_email'))
      limit 1),
    -- O admin mais antigo: um agendamento não fica sem agenda.
    (select p.id from public.profiles p
      where p.is_active and p.role = 'admin'::app.user_role
      order by p.created_at
      limit 1))
$$;
comment on function app.calendly_dono(text) is
  'A agenda em que entra um agendamento do Calendly: a pessoa com o e-mail do anfitrião; senão app_settings[calendly].dono_email; senão o admin ativo mais antigo.';

-- ---------------------------------------------------------------------
-- B4. A ficha (as regras de `public.grupozap_lead_receber`)
-- ---------------------------------------------------------------------
create or replace function app.calendly_ficha(p_nome text, p_email text, p_telefone text,
                                              out organizacao uuid, out negocio uuid, out ficha text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tel   text := app.normalize_phone_br(p_telefone);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nome  text;
  v_fonte int;  v_cat int;  v_pipe int;  v_etapa int;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    v_email := null;
  end if;

  if v_tel is not null and app.is_suppressed(v_tel) then
    ficha := 'suprimida';
    return;
  end if;

  -- O que a base já conhece é LIGADO, nunca duplicado.
  if v_tel is not null then
    select o.id into organizacao from public.organizations o
     where o.phone_e164 = v_tel and o.deleted_at is null
     limit 1;
    if organizacao is null then
      select oc.organization_id into organizacao
        from public.contacts ct
        join public.organization_contacts oc on oc.contact_id = ct.id
        join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
       where ct.phone_e164 = v_tel and ct.deleted_at is null
       order by oc.is_primary desc
       limit 1;
    end if;
  end if;
  if organizacao is null and v_email is not null then
    select o.id into organizacao from public.organizations o
     where lower(o.email::text) = v_email and o.deleted_at is null
     order by o.created_at
     limit 1;
    if organizacao is null then
      select oc.organization_id into organizacao
        from public.contacts ct
        join public.organization_contacts oc on oc.contact_id = ct.id
        join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
       where lower(ct.email::text) = v_email and ct.deleted_at is null
       order by oc.is_primary desc
       limit 1;
    end if;
  end if;

  if organizacao is not null and app.is_suppressed_target(organizacao, null) then
    organizacao := null;
    ficha := 'suprimida';
    return;
  end if;

  if organizacao is not null then
    ficha := 'ligada';
    -- Só o que faltava: o telefone ou o e-mail que a ficha não tinha.
    update public.organizations o
       set phone_e164 = case when o.phone_e164 is null and v_tel is not null
                                  and not exists (select 1 from public.organizations y
                                                   where y.phone_e164 = v_tel and y.deleted_at is null)
                             then v_tel else o.phone_e164 end,
           email = coalesce(o.email, v_email)
     where o.id = organizacao
       and ((o.phone_e164 is null and v_tel is not null) or (o.email is null and v_email is not null));
    negocio := app.wa_negocio_da_ficha(organizacao);
    return;
  end if;

  -- Quem não está na base vira Cliente, como a ficha automática do WhatsApp.
  select s.id into v_fonte from public.sources s where s.slug = 'calendly';
  select ca.id into v_cat from public.categories ca
   where ca.slug = coalesce(app.ficha_automatica_config() ->> 'categoria', 'comprador') and ca.is_active;
  select p.id into v_pipe from public.pipelines p where p.slug = 'produtor';
  select st.id into v_etapa from public.stages st
   where st.pipeline_id = v_pipe and st.is_entry and st.retired_at is null
   order by st.position limit 1;
  if v_fonte is null or v_cat is null or v_etapa is null then
    ficha := 'catalogo_incompleto';
    return;
  end if;

  v_nome := left(nullif(btrim(regexp_replace(coalesce(app.sem_cpf(p_nome), ''), '\s+', ' ', 'g')), ''), 120);
  begin
    insert into public.organizations (kind, name, phone_e164, email, source_id, collected_at,
                                      collector, owner_id, is_natural_person)
    values ('produtor'::app.org_kind, coalesce(v_nome, 'Agendamento pelo Calendly'), v_tel, v_email,
            v_fonte, now(), 'agendamento pelo Calendly', null, true)
    returning id into organizacao;
    insert into public.organization_categories (organization_id, category_id, is_primary)
    values (organizacao, v_cat, true);
    insert into public.deals (organization_id, pipeline_id, stage_id, owner_id, source_id)
    values (organizacao, v_pipe, v_etapa, null, v_fonte)
    returning id into negocio;
    ficha := 'criada';
  exception when unique_violation then
    -- Outro aviso do mesmo telefone criou a ficha neste instante: liga a ela.
    select o.id into organizacao from public.organizations o
     where o.phone_e164 = v_tel and o.deleted_at is null
     limit 1;
    if organizacao is null then
      -- Sem o detalhe do erro: ele traz o telefone. O Calendly reenvia.
      raise exception 'ficha_nao_criada' using errcode = 'P0001';
    end if;
    negocio := app.wa_negocio_da_ficha(organizacao);
    ficha := 'ligada';
  end;
end $$;
comment on function app.calendly_ficha(text, text, text) is
  'Acha a ficha de quem agendou pelo Calendly (telefone, depois e-mail, como o lead do portal) ou cria a de Cliente com a origem Calendly. Ficha suprimida devolve ficha = suprimida e organizacao nula.';

-- ---------------------------------------------------------------------
-- B5. O que ocupa a agenda de uma pessoa: uma régua só
-- ---------------------------------------------------------------------
create or replace function app.agenda_ocupada(p_pessoa uuid, p_de timestamptz, p_ate timestamptz)
returns table (item_id uuid, tipo text, titulo text, inicio timestamptz, fim timestamptz, origem text)
language sql
stable
security definer
set search_path = ''
as $$
  -- Reunião viva, com o fim de verdade. A chave é a tarefa-eco (o que a
  -- Agenda desenha); sem eco, a própria reunião.
  select coalesce(r.task_id, r.id), 'reuniao', r.titulo, r.inicio, r.fim,
         case when r.marcada_por = 'calendly' then 'calendly' else 'crm' end
    from public.reunioes r
   where r.dono_id = p_pessoa
     and r.estado in ('a_confirmar', 'marcada', 'confirmada')
     and r.durante && tstzrange(p_de, p_ate, '[)')
  union all
  -- Visita aberta, e reunião sem objeto mas com hora combinada (etapa que pede
  -- `meeting_at`). A tarefa não tem fim: vale a duração padrão de cada uma. A
  -- reunião "a marcar" não ocupa horário.
  select t.id,
         case when t.kind = 'visit' then 'visita' else 'reuniao' end,
         t.title, t.due_at, t.due_at + x.duracao,
         case when t.origin = 'calendly' then 'calendly' else 'crm' end
    from public.tasks t
    cross join lateral (select make_interval(mins => case when t.kind = 'visit'
             then coalesce((app.reuniao_config() ->> 'duracao_visita_min')::int, 45)
             else coalesce((app.reuniao_config() ->> 'duracao_min')::int, 40) end) as duracao) x
    left join public.deals d on d.id = t.deal_id
   where t.assignee_id = p_pessoa
     and t.kind in ('meeting'::app.task_kind, 'visit'::app.task_kind)
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     and t.due_at is not null
     and t.due_at < p_ate
     and t.due_at + x.duracao > p_de
     and not exists (select 1 from public.reunioes r2
                      where r2.task_id = t.id and r2.estado in ('a_confirmar', 'marcada', 'confirmada'))
     and (t.kind = 'visit'::app.task_kind
          or exists (select 1 from public.stages st
                      where st.id = d.stage_id
                        and exists (select 1 from jsonb_array_elements(coalesce(st.required_fields, '[]'::jsonb)) e
                                     where e.value ->> 'field' = 'meeting_at')))
$$;
comment on function app.agenda_ocupada(uuid, timestamptz, timestamptz) is
  'Os compromissos que ocupam a agenda de uma pessoa entre p_de e p_ate: reunião viva, visita aberta e reunião com hora combinada. A reunião "a marcar" não ocupa. Usada para recusar agendamento do Calendly e para o espelho no Google.';

create or replace function app.calendly_conflitos(p_dono uuid, p_inicio timestamptz, p_fim timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tipo', o.tipo, 'titulo', o.titulo, 'inicio', o.inicio)
                            order by o.inicio), '[]'::jsonb)
    from app.agenda_ocupada(p_dono, p_inicio, p_fim) o
$$;

-- ---------------------------------------------------------------------
-- B6. O negócio anda para a etapa que pede data (a regra da `reuniao_gravar`)
-- ---------------------------------------------------------------------
create or replace function app.calendly_andar_etapa(p_deal uuid, p_inicio timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deal public.deals%rowtype;
  v_pos int;  v_etapa int;
begin
  select * into v_deal from public.deals where id = p_deal;
  if v_deal.id is null then return; end if;
  select st0.position into v_pos from public.stages st0 where st0.id = v_deal.stage_id;
  select st.id into v_etapa from public.stages st
   where st.pipeline_id = v_deal.pipeline_id
     and st.position > coalesce(v_pos, -1)
     and st.retired_at is null
     and exists (select 1 from jsonb_array_elements(coalesce(st.required_fields, '[]'::jsonb)) e
                  where e.value ->> 'field' = 'meeting_at')
   order by st.position limit 1;
  if v_etapa is not null then
    update public.deals
       set stage_id = v_etapa, next_action_at = p_inicio,
           stage_change_reason = 'Agendado pelo Calendly'
     where id = v_deal.id;
  else
    -- Já está na etapa de data marcada, ou além dela: só a próxima ação muda.
    update public.deals set next_action_at = p_inicio where id = v_deal.id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- B7. Fechar um agendamento
-- ---------------------------------------------------------------------
-- O compromisso que o agendamento pôs na agenda já saiu dela pelo CRM
-- (cancelado, remarcado, excluído)?
create or replace function app.calendly_lado_crm_fechado(a public.calendly_agendamentos)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when a.reuniao_id is not null then
      coalesce((select r.estado not in ('a_confirmar', 'marcada', 'confirmada')
                  from public.reunioes r where r.id = a.reuniao_id), true)
    when a.task_id is not null then
      coalesce((select t.status = 'cancelled'::app.task_status
                  from public.tasks t where t.id = a.task_id), true)
    else false end
$$;

-- Cancelado ou remarcado NO CALENDLY: tira da agenda do CRM.
create or replace function app.calendly_fechar(p_id uuid, p_situacao text, p_motivo text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.calendly_agendamentos%rowtype;
begin
  if p_situacao not in ('cancelado', 'remarcado') then
    raise exception 'situacao_invalida' using errcode = '22023';
  end if;
  select * into a from public.calendly_agendamentos where id = p_id for update;
  if a.id is null or a.situacao <> 'agendado' then
    return false;
  end if;

  if a.reuniao_id is not null then
    if p_situacao = 'remarcado' then
      -- O horário novo chega (ou já chegou) como outro agendamento, com
      -- `remarcada_de` apontando para esta reunião.
      update public.reunioes
         set estado = 'remarcada', atualizada_em = now()
       where id = a.reuniao_id and estado in ('a_confirmar', 'marcada', 'confirmada');
    else
      -- A porta da tela: cancela a reunião e a tarefa, e manda o e-mail ao
      -- dono. Reunião que a equipe já tinha cancelado fica como está.
      perform app.reuniao_cancelar_interno(a.reuniao_id,
                coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Cancelada pelo cliente no Calendly'));
    end if;
  end if;
  if a.task_id is not null then
    update public.tasks set status = 'cancelled'::app.task_status
     where id = a.task_id and status in ('todo'::app.task_status, 'doing'::app.task_status);
  end if;

  -- O Calendly já sabe: não há o que pedir a ele (caminho 3).
  update public.calendly_agendamentos
     set situacao = p_situacao, cancelado_em = coalesce(cancelado_em, now()),
         cancelado_no_calendly_em = coalesce(cancelado_no_calendly_em, now()), atualizado_em = now()
   where id = p_id;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- B8. A porta do webhook
-- ---------------------------------------------------------------------
create or replace function public.calendly_receber(p_evento jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tipo     text := p_evento ->> 'evento';
  v_uri      text := left(nullif(btrim(coalesce(p_evento ->> 'convidado_uri', '')), ''), 300);
  v_ev_uri   text := left(nullif(btrim(coalesce(p_evento ->> 'evento_uri', '')), ''), 300);
  v_ant_uri  text := left(nullif(btrim(coalesce(p_evento ->> 'convidado_anterior_uri', '')), ''), 300);
  v_ag       public.calendly_agendamentos%rowtype;
  v_ant      public.calendly_agendamentos%rowtype;
  v_inicio   timestamptz;
  v_fim      timestamptz;
  v_natureza text;
  v_formato  text;
  v_local    text;
  v_link     text;
  v_tipo_ev  text;
  v_resp     jsonb;
  v_resp_txt text;
  v_dono     uuid;
  v_org      uuid;
  v_deal     uuid;
  v_ficha    text;
  v_nome     text;
  v_titulo   text;
  v_conf     jsonb;
  v_situacao text;
  v_reuniao  uuid;
  v_task     uuid;
  v_aviso    uuid;
  v_id       uuid;
  v_detalhe  text;
  v_canc_por text;
  v_motivo   text;
  v_reu_ant  uuid;
  v_pela_casa boolean;
begin
  if v_tipo is null or v_tipo not in ('invitee.created', 'invitee.canceled') then
    return jsonb_build_object('ok', true, 'ignorado', true, 'motivo', 'evento_nao_tratado');
  end if;
  if v_uri is null or v_ev_uri is null or char_length(v_uri) < 10 or char_length(v_ev_uri) < 10 then
    return jsonb_build_object('ok', false, 'motivo', 'sem_uri');
  end if;

  -- Avisos do mesmo convidado, um de cada vez: o Calendly pode entregar o mesmo
  -- aviso duas vezes ao mesmo tempo.
  perform pg_advisory_xact_lock(hashtextextended('calendly:' || v_uri, 0));
  select * into v_ag from public.calendly_agendamentos where convidado_uri = v_uri;

  -- O que vem nos dois tipos de aviso.
  begin
    v_inicio := (p_evento ->> 'inicio')::timestamptz;
    v_fim    := (p_evento ->> 'fim')::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'horario_invalido');
  end;
  v_natureza := case when p_evento ->> 'natureza' = 'visita' then 'visita' else 'reuniao' end;
  v_tipo_ev  := left(nullif(btrim(coalesce(p_evento ->> 'tipo_de_evento', '')), ''), 200);

  -- =================================================================
  -- CANCELADO (ou a primeira metade de uma remarcação)
  -- =================================================================
  if v_tipo = 'invitee.canceled' then
    v_situacao := case when coalesce((p_evento ->> 'remarcado')::boolean, false)
                       then 'remarcado' else 'cancelado' end;
    v_canc_por := case p_evento -> 'cancelamento' ->> 'por'
                    when 'convidado' then 'convidado' when 'anfitriao' then 'anfitriao' end;
    v_motivo   := left(nullif(btrim(coalesce(app.sem_cpf(p_evento -> 'cancelamento' ->> 'motivo'), '')), ''), 500);

    if v_ag.id is null then
      -- O cancelamento chegou antes do agendamento, ou o agendamento é de antes
      -- da integração: fica anotado, e o agendamento que chegar depois é ignorado.
      insert into public.calendly_agendamentos
        (convidado_uri, evento_uri, situacao, natureza, tipo_de_evento, inicio, fim,
         cancelado_em, cancelado_por, motivo_cancelamento, cancelado_no_calendly_em)
      values (v_uri, v_ev_uri, v_situacao, v_natureza, v_tipo_ev, v_inicio, v_fim,
              now(), v_canc_por, v_motivo, now())
      returning id into v_id;
      return jsonb_build_object('ok', true, 'duplicado', false, 'agendamento_id', v_id,
                                'situacao', v_situacao, 'sem_agendamento', true);
    end if;

    -- Já fechado, ou recusado (é o CRM confirmando o cancelamento que pediu).
    if v_ag.situacao in ('cancelado', 'remarcado', 'recusado') then
      update public.calendly_agendamentos
         set cancelado_no_calendly_em = coalesce(cancelado_no_calendly_em, now()),
             cancelado_em = coalesce(cancelado_em, now()), atualizado_em = now()
       where id = v_ag.id and cancelado_no_calendly_em is null;
      return jsonb_build_object('ok', true, 'duplicado', true, 'agendamento_id', v_ag.id,
                                'situacao', v_ag.situacao);
    end if;

    -- A equipe já tinha tirado da agenda pelo CRM, e o CRM pediu ao Calendly que
    -- cancelasse: o aviso que volta é a confirmação, sem nota nem push.
    v_pela_casa := v_ag.situacao = 'agendado' and app.calendly_lado_crm_fechado(v_ag);

    if v_ag.situacao = 'agendado' and not v_pela_casa then
      perform app.calendly_fechar(v_ag.id, v_situacao, v_motivo);
    else
      -- suprimido / sem_dono / desmarcado pelo CRM: nada a tirar da agenda.
      update public.calendly_agendamentos
         set situacao = case when situacao = 'agendado' then 'cancelado' else v_situacao end,
             cancelado_em = coalesce(cancelado_em, now()),
             cancelado_no_calendly_em = coalesce(cancelado_no_calendly_em, now()), atualizado_em = now()
       where id = v_ag.id;
    end if;
    update public.calendly_agendamentos
       set cancelado_por = coalesce(v_canc_por, cancelado_por),
           motivo_cancelamento = coalesce(v_motivo, motivo_cancelamento), atualizado_em = now()
     where id = v_ag.id;

    -- O cancelamento do cliente (não a remarcação, que se anuncia pelo novo, nem a
    -- confirmação do que o CRM pediu) é contado na ficha e a quem atende.
    if v_situacao = 'cancelado' and v_ag.situacao = 'agendado' and not v_pela_casa then
      v_titulo := coalesce((select t.title from public.tasks t where t.id = v_ag.task_id),
                           case when v_ag.natureza = 'visita' then 'Visita' else 'Reunião' end);
      if v_ag.organization_id is not null then
        insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
        values ('system', v_ag.organization_id, v_ag.deal_id, null, 'system',
                left(format('%s cancelada pelo %s no Calendly (era %s).%s',
                            case when v_ag.natureza = 'visita' then 'Visita' else 'Reunião' end,
                            case when v_canc_por = 'anfitriao' then 'anfitrião' else 'cliente' end,
                            app.avisos_quando(v_ag.inicio, true),
                            case when v_motivo is not null then ' Motivo: ' || v_motivo else '' end), 2000),
                jsonb_build_object('origin', 'calendly', 'calendly_agendamento_id', v_ag.id,
                                   'situacao', 'cancelado'));
      end if;
      if v_ag.dono_id is not null then
        begin
          insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
          values (v_ag.dono_id, 'compromisso', 'calendly:cancelado:' || v_ag.id,
                  left('Cancelado pelo Calendly: ' || v_titulo || ', '
                       || app.avisos_quando(v_ag.inicio, true), 240),
                  '/agenda?dia=' || to_char(v_ag.inicio at time zone 'America/Fortaleza', 'YYYY-MM-DD'))
          on conflict (chave) do nothing;
        exception when others then
          raise warning 'calendly: push do cancelamento: %', sqlerrm;
        end;
      end if;
    end if;

    return jsonb_build_object('ok', true, 'duplicado', false, 'agendamento_id', v_ag.id,
                              'situacao', case when v_pela_casa then 'cancelado' else v_situacao end);
  end if;

  -- =================================================================
  -- AGENDADO
  -- =================================================================
  if v_ag.id is not null then
    return jsonb_build_object('ok', true, 'duplicado', true, 'agendamento_id', v_ag.id,
                              'situacao', v_ag.situacao);
  end if;
  if v_inicio is null or v_fim is null or v_fim <= v_inicio then
    return jsonb_build_object('ok', false, 'motivo', 'horario_invalido');
  end if;

  -- Onde. Visita é sempre presencial; reunião presencial sem endereço fica com
  -- o lugar a combinar (a trava `reunioes_lugar_chk` pede um texto).
  v_local := left(nullif(btrim(coalesce(app.sem_cpf(p_evento ->> 'local'), '')), ''), 500);
  v_link  := case when (p_evento ->> 'link') ~ '^https://' then left(p_evento ->> 'link', 1000) end;
  v_formato := case when v_natureza = 'visita' then 'presencial'
                    when p_evento ->> 'formato' = 'presencial' then 'presencial'
                    else 'online' end;
  if v_formato = 'presencial' then
    v_link := null;
    v_local := coalesce(v_local, 'Local a combinar (o Calendly não informou)');
  else
    v_local := null;
  end if;

  -- As respostas, sem CPF e com teto.
  select coalesce(jsonb_agg(jsonb_build_object(
           'pergunta', left(app.sem_cpf(e.value ->> 'pergunta'), 300),
           'resposta', left(app.sem_cpf(e.value ->> 'resposta'), 500))), '[]'::jsonb)
    into v_resp
    from (select value from jsonb_array_elements(
            case when jsonb_typeof(p_evento -> 'respostas') = 'array' then p_evento -> 'respostas'
                 else '[]'::jsonb end) limit 20) e
   where nullif(btrim(coalesce(e.value ->> 'resposta', '')), '') is not null;
  select string_agg((r.value ->> 'pergunta') || ': ' || (r.value ->> 'resposta'), ' · ')
    into v_resp_txt from jsonb_array_elements(v_resp) r;

  -- A remarcação: o agendamento velho fecha antes de o novo ocupar o horário
  -- (senão o novo bateria com o velho na conta do conflito).
  if v_ant_uri is not null then
    select * into v_ant from public.calendly_agendamentos where convidado_uri = v_ant_uri;
    if v_ant.id is not null then
      perform app.calendly_fechar(v_ant.id, 'remarcado', null);
      v_reu_ant := v_ant.reuniao_id;
    end if;
  end if;

  v_dono := app.calendly_dono(p_evento ->> 'anfitriao_email');
  select f.organizacao, f.negocio, f.ficha into v_org, v_deal, v_ficha
    from app.calendly_ficha(p_evento ->> 'nome', p_evento ->> 'email', p_evento ->> 'telefone') f;

  if v_dono is null or v_org is null then
    v_situacao := case when v_dono is null then 'sem_dono' else 'suprimido' end;
    insert into public.calendly_agendamentos
      (convidado_uri, evento_uri, situacao, natureza, tipo_de_evento, inicio, fim, formato, link, local,
       dono_id, respostas, ficha, remarcado_de, link_cancelar, link_remarcar)
    values (v_uri, v_ev_uri, v_situacao, v_natureza, v_tipo_ev, v_inicio, v_fim, v_formato, v_link, v_local,
            v_dono, v_resp, v_ficha, v_ant.id,
            left(p_evento ->> 'link_cancelar', 500), left(p_evento ->> 'link_remarcar', 500))
    returning id into v_id;
    return jsonb_build_object('ok', true, 'duplicado', false, 'agendamento_id', v_id,
                              'situacao', v_situacao, 'ficha', v_ficha);
  end if;

  select o.name into v_nome from public.organizations o where o.id = v_org;
  v_titulo := case when v_natureza = 'visita' then 'Visita: ' || coalesce(v_nome, 'cliente')
                   else 'Reunião com ' || coalesce(v_nome, 'cliente') end;

  -- Serializa por (pessoa, dia), como a `reuniao_gravar`: dois agendamentos no
  -- mesmo instante enxergam um ao outro na conta do conflito.
  perform pg_advisory_xact_lock(hashtextextended(
            v_dono::text || ((v_inicio at time zone 'America/Fortaleza')::date)::text, 0));
  v_conf := app.calendly_conflitos(v_dono, v_inicio, v_fim);
  v_situacao := case when jsonb_array_length(v_conf) > 0 then 'recusado' else 'agendado' end;

  if v_natureza = 'reuniao' and v_situacao = 'agendado' then
    begin
      insert into public.reunioes (organization_id, deal_id, contact_id, dono_id, titulo, formato,
                                   inicio, fim, link, local, estado, marcada_por, observacao, remarcada_de)
      values (v_org, v_deal, null, v_dono, v_titulo, v_formato, v_inicio, v_fim, v_link, v_local,
              'marcada', 'calendly',
              left('Agendada pelo cliente no Calendly' || coalesce(' (' || v_tipo_ev || ')', '') || '.'
                   || coalesce(' ' || v_resp_txt, ''), 2000),
              v_reu_ant)
      returning id into v_reuniao;
    exception when exclusion_violation then
      -- Outra reunião entrou no horário entre a conta e o insert.
      v_conf := app.calendly_conflitos(v_dono, v_inicio, v_fim);
      v_situacao := 'recusado';
    end;
  end if;

  -- -----------------------------------------------------------------
  -- Horário ocupado: duas pessoas não ficam no mesmo horário. Nada entra na
  -- agenda; o Calendly cancela e pede ao cliente outro horário (caminho 3).
  -- -----------------------------------------------------------------
  if v_situacao = 'recusado' then
    insert into public.calendly_agendamentos
      (convidado_uri, evento_uri, situacao, natureza, tipo_de_evento, inicio, fim, formato, link, local,
       dono_id, organization_id, deal_id, conflitos, respostas, ficha, remarcado_de,
       link_cancelar, link_remarcar)
    values (v_uri, v_ev_uri, 'recusado', v_natureza, v_tipo_ev, v_inicio, v_fim, v_formato, v_link, v_local,
            v_dono, v_org, v_deal, v_conf, v_resp, v_ficha, v_ant.id,
            left(p_evento ->> 'link_cancelar', 500), left(p_evento ->> 'link_remarcar', 500))
    returning id into v_id;

    insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
    values ('system', v_org, v_deal, null, 'system',
            left(format('Tentou agendar %s pelo Calendly para %s, mas o horário já estava ocupado (%s às %s). O Calendly cancela e pede ao cliente outro horário.%s',
                        case when v_natureza = 'visita' then 'uma visita' else 'uma reunião' end,
                        app.avisos_quando(v_inicio, true),
                        coalesce(v_conf -> 0 ->> 'titulo', 'outro compromisso'),
                        to_char((v_conf -> 0 ->> 'inicio')::timestamptz at time zone 'America/Fortaleza', 'HH24"h"MI'),
                        coalesce(' Respostas: ' || v_resp_txt, '')), 2000),
            jsonb_build_object('origin', 'calendly', 'calendly_agendamento_id', v_id,
                               'situacao', 'recusado', 'ficha', v_ficha, 'natureza', v_natureza));
    begin
      insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
      values (v_dono, 'compromisso', 'calendly:recusado:' || v_id,
              left('Pelo Calendly: ' || coalesce(v_nome, 'um cliente') || ' tentou marcar '
                   || app.avisos_quando(v_inicio, true)
                   || ', mas o horário já estava ocupado. O Calendly vai pedir outro horário.', 240),
              '/parceiros/' || v_org::text)
      on conflict (chave) do nothing;
    exception when others then
      raise warning 'calendly: push do recusado: %', sqlerrm;
    end;

    return jsonb_build_object('ok', true, 'duplicado', false, 'agendamento_id', v_id,
                              'situacao', 'recusado', 'natureza', v_natureza, 'ficha', v_ficha,
                              'conflitos', jsonb_array_length(v_conf));
  end if;

  -- -----------------------------------------------------------------
  -- Horário livre: entra na agenda.
  -- -----------------------------------------------------------------
  insert into public.tasks (title, kind, status, priority, due_at, assignee_id,
                            organization_id, deal_id, origin)
  values (v_titulo,
          case when v_natureza = 'visita' then 'visit'::app.task_kind else 'meeting'::app.task_kind end,
          'todo'::app.task_status, 2, v_inicio, v_dono, v_org, v_deal, 'calendly')
  returning id into v_task;

  if v_reuniao is not null then
    update public.reunioes set task_id = v_task, atualizada_em = now() where id = v_reuniao;
    perform app.esteira_enfileirar('reuniao_avisos',
              jsonb_build_object('reuniao_id', v_reuniao,
                                 'motivo', case when v_reu_ant is not null then 'remarcada' else 'marcada' end,
                                 'chave', 'reuniao:' || v_reuniao::text || ':marcada'),
              'reuniao:' || v_reuniao::text || ':marcada');
  end if;

  if v_deal is not null then
    perform app.calendly_andar_etapa(v_deal, v_inicio);
  end if;

  -- A frase a mais do aviso: de quando veio a remarcação.
  v_detalhe := case when v_ant.id is not null and v_ant.inicio is not null
                    then left('O cliente remarcou (era ' || app.avisos_quando(v_ant.inicio, true) || ').', 300) end;

  insert into public.agenda_avisos (dono_id, marcado_por, origem, tipo, task_id, reuniao_id,
                                    titulo, quando, detalhe)
  values (v_dono, null, 'calendly', v_natureza, v_task, v_reuniao, v_titulo, v_inicio, v_detalhe)
  returning id into v_aviso;

  -- O push do celular, com a chave que a varredura usaria (ela não pega aviso
  -- sem `marcado_por`). Falhar aqui não derruba o agendamento.
  begin
    insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
    values (v_dono, 'compromisso', 'compromisso:' || v_aviso,
            left('Pelo Calendly: ' || v_titulo || ', ' || app.avisos_quando(v_inicio, true), 240),
            '/agenda?dia=' || to_char(v_inicio at time zone 'America/Fortaleza', 'YYYY-MM-DD'))
    on conflict (chave) do nothing;
  exception when others then
    raise warning 'calendly: push do agendamento: %', sqlerrm;
  end;

  insert into public.calendly_agendamentos
    (convidado_uri, evento_uri, situacao, natureza, tipo_de_evento, inicio, fim, formato, link, local,
     dono_id, organization_id, deal_id, reuniao_id, task_id, aviso_id, conflitos, respostas, ficha,
     remarcado_de, link_cancelar, link_remarcar)
  values (v_uri, v_ev_uri, 'agendado', v_natureza, v_tipo_ev, v_inicio, v_fim, v_formato, v_link, v_local,
          v_dono, v_org, v_deal, v_reuniao, v_task, v_aviso, '[]'::jsonb, v_resp, v_ficha,
          v_ant.id, left(p_evento ->> 'link_cancelar', 500), left(p_evento ->> 'link_remarcar', 500))
  returning id into v_id;

  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('system', v_org, v_deal, null, 'system',
          left(format('%s pelo cliente no Calendly para %s%s.%s',
                      case when v_natureza = 'visita' then 'Visita agendada' else 'Reunião agendada' end,
                      app.avisos_quando(v_inicio, true),
                      coalesce(' (' || v_tipo_ev || ')', ''),
                      coalesce(' Respostas: ' || v_resp_txt, '')), 2000),
          jsonb_build_object('origin', 'calendly', 'calendly_agendamento_id', v_id,
                             'situacao', 'agendado', 'ficha', v_ficha, 'natureza', v_natureza));

  return jsonb_build_object('ok', true, 'duplicado', false, 'agendamento_id', v_id,
                            'situacao', 'agendado', 'natureza', v_natureza, 'ficha', v_ficha,
                            'reuniao_id', v_reuniao, 'task_id', v_task, 'aviso_id', v_aviso,
                            'conflitos', 0);
end $$;
comment on function public.calendly_receber(jsonb) is
  'Recebe um aviso do Calendly (só a Edge Function calendly-webhook, com a chave de serviço), já resumido por ela. Idempotente pela URI do convidado. Agendado em horário livre: liga ou cria a ficha, põe a reunião ou visita na agenda do anfitrião, avisa (agenda_avisos e push) e anota na ficha. Em horário ocupado: não entra na agenda (recusado) e o cancelamento fica pendente para o Calendly. Cancelado: tira da agenda e avisa. Não envia nada pelo WhatsApp.';

-- ---------------------------------------------------------------------
-- B9. O CRM cancela no Calendly (feito por `imova-worker-wa`)
-- ---------------------------------------------------------------------
create or replace function public.calendly_cancelamentos_pendentes(p_limite int default 10)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'evento_uri', x.evento_uri, 'motivo', x.motivo)
                            order by x.recebido_em), '[]'::jsonb)
    from (
      select a.id, a.evento_uri, a.recebido_em,
             case
               when a.situacao = 'recusado' then
                 'Este horário acabou de ser ocupado na agenda da Imova Imobiliária. Por favor, escolha outro horário pelo mesmo link.'
               when exists (select 1 from public.reunioes r where r.id = a.reuniao_id and r.estado = 'remarcada') then
                 'A Imova Imobiliária remarcou este compromisso e vai combinar o novo horário com você.'
               else
                 'A Imova Imobiliária precisou cancelar este compromisso e vai falar com você.'
             end as motivo
        from public.calendly_agendamentos a
       where a.cancelado_no_calendly_em is null
         and a.cancelar_tentativas < 8
         and (a.cancelar_depois_de is null or a.cancelar_depois_de <= now())
         -- O Calendly não cancela o que já passou.
         and (a.inicio is null or a.inicio > now())
         and (a.situacao = 'recusado'
              or (a.situacao = 'agendado' and app.calendly_lado_crm_fechado(a)))
       order by a.recebido_em
       limit greatest(1, least(coalesce(p_limite, 10), 50))
    ) x
$$;
comment on function public.calendly_cancelamentos_pendentes(int) is
  'O que o CRM ainda precisa cancelar no Calendly: o agendamento recusado (horário ocupado) e o que a equipe desmarcou ou remarcou pelo CRM. Lido pelo imova-worker-wa, que chama a API do Calendly e responde com calendly_cancelamento_feito ou _falhou.';

create or replace function public.calendly_cancelamento_feito(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.calendly_agendamentos
     set cancelado_no_calendly_em = now(), cancelar_erro = null, cancelar_depois_de = null,
         situacao = case when situacao = 'agendado' then 'cancelado' else situacao end,
         cancelado_em = coalesce(cancelado_em, now()),
         cancelado_por = coalesce(cancelado_por, 'anfitriao'),
         atualizado_em = now()
   where id = p_id and cancelado_no_calendly_em is null;
  return found;
end $$;

-- Espera crescente: 1, 2, 4, 8… minutos, até uma hora; oito tentativas e para.
-- `p_definitivo` (o Calendly disse que não dá, ex.: evento que não existe mais)
-- para de uma vez, com o erro guardado para a gestão ver.
create or replace function public.calendly_cancelamento_falhou(p_id uuid, p_erro text, p_definitivo boolean default false)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.calendly_agendamentos
     set cancelar_tentativas = case when coalesce(p_definitivo, false) then 8
                                    else least(cancelar_tentativas + 1, 8) end,
         cancelar_depois_de = now() + make_interval(mins => least(60, (2 ^ least(cancelar_tentativas, 6))::int)),
         cancelar_erro = left(coalesce(nullif(btrim(p_erro), ''), 'erro sem descrição'), 500),
         atualizado_em = now()
   where id = p_id and cancelado_no_calendly_em is null;
  return found;
end $$;

-- ---------------------------------------------------------------------
-- B10. O espelho no Google Agenda (feito por `imova-worker-wa`)
-- ---------------------------------------------------------------------
create table if not exists app.agenda_espelho (
  -- O compromisso (a tarefa-eco, ou a reunião sem eco). O id do evento no Google
  -- é este uuid sem hífens: base32hex válido, e o mesmo a cada tentativa.
  item_id     uuid primary key,
  inicio      timestamptz not null,
  fim         timestamptz not null,
  -- Nulo enquanto o Google não confirmou a gravação.
  gravado_em  timestamptz,
  tentativas  int not null default 0 check (tentativas >= 0),
  depois_de   timestamptz,
  erro        text check (char_length(erro) <= 500)
);
alter table app.agenda_espelho enable row level security;
revoke all on app.agenda_espelho from anon, authenticated;
comment on table app.agenda_espelho is
  'O que o CRM gravou como "Ocupado" no Google Agenda que o Calendly confere. Escrita só pelas funções agenda_espelho_*; o worker nunca toca nela direto.';

create or replace function public.agenda_espelho_pendencias(p_limite int default 20)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cal    text := nullif(btrim(coalesce(app.calendly_config() ->> 'google_agenda_id', '')), '');
  v_pessoa uuid := app.calendly_pessoa_da_agenda();
  v_lim    int  := greatest(1, least(coalesce(p_limite, 20), 100));
  v_gravar jsonb;
  v_apagar jsonb;
begin
  if v_cal is null then
    return jsonb_build_object('ligado', false, 'motivo', 'sem_google_agenda_id');
  end if;
  -- O que já passou sai da conta sem ir ao Google: o bloco antigo fica lá como
  -- história e não ocupa nada que alguém ainda possa marcar.
  delete from app.agenda_espelho where fim < now() - interval '1 day';

  with desejado as (
    select o.item_id, o.inicio, o.fim
      from app.agenda_ocupada(v_pessoa, now(), now() + interval '120 days') o
     where v_pessoa is not null and o.origem <> 'calendly'
  ),
  gravar as (
    select d.item_id, d.inicio, d.fim
      from desejado d
      left join app.agenda_espelho e on e.item_id = d.item_id
     where (e.item_id is null or e.gravado_em is null or e.inicio <> d.inicio or e.fim <> d.fim)
       and (e.depois_de is null or e.depois_de <= now())
     order by d.inicio
     limit v_lim
  )
  select coalesce(jsonb_agg(jsonb_build_object('item_id', g.item_id,
                                               'evento_id', replace(g.item_id::text, '-', ''),
                                               'inicio', g.inicio, 'fim', g.fim) order by g.inicio), '[]'::jsonb)
    into v_gravar from gravar g;

  with desejado as (
    select o.item_id
      from app.agenda_ocupada(v_pessoa, now(), now() + interval '120 days') o
     where v_pessoa is not null and o.origem <> 'calendly'
  )
  select coalesce(jsonb_agg(jsonb_build_object('item_id', e.item_id,
                                               'evento_id', replace(e.item_id::text, '-', ''))), '[]'::jsonb)
    into v_apagar
    from (select e2.item_id from app.agenda_espelho e2
           where not exists (select 1 from desejado d where d.item_id = e2.item_id)
             and (e2.depois_de is null or e2.depois_de <= now())
           limit v_lim) e;

  return jsonb_build_object('ligado', true, 'calendario', v_cal, 'gravar', v_gravar, 'apagar', v_apagar);
end $$;
comment on function public.agenda_espelho_pendencias(int) is
  'O que falta no Google Agenda que o Calendly confere: os compromissos da agenda do Calendly (app.calendly_pessoa_da_agenda) que não vieram do Calendly, para gravar ou mudar, e os que saíram, para apagar. Desligado sem app_settings[calendly].google_agenda_id.';

create or replace function public.agenda_espelho_gravado(p_item uuid, p_inicio timestamptz, p_fim timestamptz)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into app.agenda_espelho (item_id, inicio, fim, gravado_em, tentativas, depois_de, erro)
  values (p_item, p_inicio, p_fim, now(), 0, null, null)
  on conflict (item_id) do update
     set inicio = excluded.inicio, fim = excluded.fim, gravado_em = now(),
         tentativas = 0, depois_de = null, erro = null
$$;

create or replace function public.agenda_espelho_apagado(p_item uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from app.agenda_espelho where item_id = p_item
$$;

create or replace function public.agenda_espelho_falhou(p_item uuid, p_inicio timestamptz, p_fim timestamptz, p_erro text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into app.agenda_espelho (item_id, inicio, fim, gravado_em, tentativas, depois_de, erro)
  values (p_item, coalesce(p_inicio, now()), coalesce(p_fim, now()), null, 1,
          now() + interval '1 minute', left(coalesce(nullif(btrim(p_erro), ''), 'erro sem descrição'), 500))
  on conflict (item_id) do update
     set tentativas = app.agenda_espelho.tentativas + 1,
         depois_de = now() + make_interval(mins => least(60, (2 ^ least(app.agenda_espelho.tentativas, 6))::int)),
         erro = excluded.erro
$$;

revoke all on function app.calendly_config() from public, anon, authenticated;
revoke all on function app.calendly_pessoa_da_agenda() from public, anon, authenticated;
revoke all on function app.calendly_dono(text) from public, anon, authenticated;
revoke all on function app.calendly_ficha(text, text, text) from public, anon, authenticated;
revoke all on function app.agenda_ocupada(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app.calendly_conflitos(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app.calendly_andar_etapa(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.calendly_lado_crm_fechado(public.calendly_agendamentos) from public, anon, authenticated;
revoke all on function app.calendly_fechar(uuid, text, text) from public, anon, authenticated;
revoke all on function public.calendly_receber(jsonb) from public, anon, authenticated;
revoke all on function public.calendly_cancelamentos_pendentes(int) from public, anon, authenticated;
revoke all on function public.calendly_cancelamento_feito(uuid) from public, anon, authenticated;
revoke all on function public.calendly_cancelamento_falhou(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.agenda_espelho_pendencias(int) from public, anon, authenticated;
revoke all on function public.agenda_espelho_gravado(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.agenda_espelho_apagado(uuid) from public, anon, authenticated;
revoke all on function public.agenda_espelho_falhou(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.calendly_receber(jsonb) to service_role;
grant execute on function public.calendly_cancelamentos_pendentes(int) to service_role;
grant execute on function public.calendly_cancelamento_feito(uuid) to service_role;
grant execute on function public.calendly_cancelamento_falhou(uuid, text, boolean) to service_role;
grant execute on function public.agenda_espelho_pendencias(int) to service_role;
grant execute on function public.agenda_espelho_gravado(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.agenda_espelho_apagado(uuid) to service_role;
grant execute on function public.agenda_espelho_falhou(uuid, timestamptz, timestamptz, text) to service_role;

  $ddl$;
end $calendly$;

-- =====================================================================
-- A REUNIÃO VIRA OBJETO DO BANCO (ADR-15 — decisão de Rafael, 25/09/2026)
--
-- POR QUÊ: o CRM não tem reunião. Tem `public.tasks` com prazo, e é outra
-- coisa: sem fim, sem lugar, sem lista de presença, e com `app.task_status`
-- que não sabe dizer "remarcada" nem "não compareceu". E não dá para pôr
-- trava de colisão em `tasks`: as nove "Marcar apresentação" de terça nascem
-- todas às 09:00 pela régua do RF-MET-06 e recusariam umas às outras. A
-- tabela que precisa proibir sobreposição é a tabela onde sobreposição é
-- erro. Em `tasks` ela é o dia normal.
--
-- O QUE MUDA DE LUGAR: disponibilidade, grade, feriado, rota e teto diário
-- passam a ser calculados em SQL. O Google Agenda sai inteiro na migração
-- irmã (20260930120000) — e só DEPOIS de o Rafael cancelar os eventos
-- futuros, que é a única ordem que não pode inverter.
--
-- `tasks` continua exatamente como está, e ganha uma linha-eco por reunião:
-- quatro lugares já contam `kind in ('meeting','visit')` (o pulso do dia,
-- o dreno duas vezes, a tela das cadências) e passariam a mentir por omissão
-- no dia seguinte se a reunião existisse só na tabela nova.
--
-- ORDEM DENTRO DESTE ARQUIVO: a fila `reuniao_avisos` nasce ANTES de
-- `app.reuniao_gravar`, que a usa. `app.esteira_enfileirar` levanta exceção
-- em fila que não está no catálogo (20260904001600:1533) — e a exceção não
-- derruba só o aviso, derruba a transação inteira de quem marcou.
-- =====================================================================

-- Só `btree_gist` dá a classe de operadores que deixa `uuid with =` conviver
-- com `tstzrange with &&` no mesmo índice GiST. Entra em `extensions`, como
-- `postgis` entrou em 20260905000600:114.
create extension if not exists btree_gist with schema extensions;

-- =====================================================================
-- A. A TABELA
-- =====================================================================
create table if not exists public.reunioes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  deal_id          uuid references public.deals (id)         on delete set null,
  conversation_id  uuid references public.conversations (id) on delete set null,
  contact_id       uuid references public.contacts (id)      on delete set null,
  -- Quem ATENDE. É dele a agenda que fica ocupada, e é ele quem recebe o
  -- e-mail. `restrict`: reunião sem dono não é compromisso. Desligar gente é
  -- `is_active = false` (decisão do D1); apagar o perfil exige cancelar ou
  -- transferir as reuniões vivas antes, e é assim de propósito.
  dono_id          uuid not null references public.profiles (id) on delete restrict,
  titulo           text not null,
  formato          text not null default 'online' check (formato in ('online','presencial')),
  inicio           timestamptz not null,
  fim              timestamptz not null,
  -- Coluna GERADA, e não calculada na consulta: a restrição de exclusão
  -- precisa de um valor indexável, e o construtor de três argumentos
  -- `tstzrange(timestamptz, timestamptz, text)` é imutável.
  durante          tstzrange generated always as (tstzrange(inicio, fim, '[)')) stored,
  link             text,                 -- sala, quando online
  local            text,                 -- endereço, quando presencial
  estado           text not null default 'marcada'
                     check (estado in ('a_confirmar','marcada','confirmada','realizada',
                                       'nao_compareceu','cancelada','remarcada')),
  marcada_por      text not null check (marcada_por in ('robo','pessoa')),
  marcada_por_id   uuid references public.profiles (id) on delete set null,
  confirmada_em    timestamptz,
  confirmada_por   uuid references public.profiles (id) on delete set null,
  remarcada_de     uuid references public.reunioes (id) on delete set null,
  -- O espelho em `tasks`. A tabela nova é a verdade; a tarefa é o eco que o
  -- resto do sistema já sabe ler. A tela ENRIQUECE a tarefa com a reunião.
  task_id          uuid references public.tasks (id) on delete set null,
  aviso_enviado_em timestamptz,
  lembrete_em      timestamptz,
  observacao       text,
  criada_em        timestamptz not null default now(),
  atualizada_em    timestamptz not null default now(),
  constraint reunioes_intervalo_chk check (fim > inicio),
  constraint reunioes_lugar_chk check (
    (formato = 'online'     and link  is not null) or
    (formato = 'presencial' and local is not null)),
  -- CORREÇÃO da emenda: a versão dela exigia `marcada_por_id is not null`
  -- para 'pessoa'. Com `on delete set null` na FK, apagar um perfil dispara
  -- um UPDATE nesta linha, o CHECK é reavaliado e o DELETE do perfil falha.
  -- O CHECK cobra só o que sobrevive ao `set null`; quem preenche
  -- `marcada_por_id` é `app.reuniao_gravar`.
  constraint reunioes_robo_chk check (
    (marcada_por = 'robo' and conversation_id is not null) or marcada_por = 'pessoa'),
  -- A TRAVA. Duas reuniões VIVAS da mesma pessoa não se sobrepõem. No banco,
  -- não no worker: `select` que pergunta "está livre?" seguido de `insert` é
  -- janela de corrida em qualquer linguagem. Isto não é checagem, é o índice
  -- recusando escrever — e não existe caminho que o contorne, nem por worker
  -- novo, nem por Edge Function, nem por alguém no SQL Editor.
  -- `[)` de propósito: encostar não é sobrepor. A reunião que termina 11h00
  -- deixa a de 11h10 entrar, e deixaria até a de 11h00 em ponto.
  constraint reunioes_sem_colisao exclude using gist (
    dono_id extensions.gist_uuid_ops with =, durante with &&)
    where (estado in ('a_confirmar','marcada','confirmada'))
);

comment on table public.reunioes is
  'Reunião marcada (ADR-15): começo, fim, formato, lugar, estado e dono, com trava de sobreposição no banco. É a fonte da verdade da Agenda; a `tasks` de mesmo horário é eco.';
comment on column public.reunioes.durante is
  'Intervalo gerado [inicio, fim). Existe para a restrição de exclusão ter um valor indexável.';
comment on column public.reunioes.link is
  'Sala CONGELADA no momento da escrita, e nunca lida de `profiles` ao desenhar: `profiles_select` é `id = auth.uid() or is_manager()`, e o cartão do colega apareceria sem sala. Trocar a sala em Ajustes não retroage.';

create index if not exists reunioes_dono_inicio_idx on public.reunioes (dono_id, inicio);
create index if not exists reunioes_org_idx         on public.reunioes (organization_id);
create index if not exists reunioes_conversa_idx    on public.reunioes (conversation_id);
create index if not exists reunioes_task_idx        on public.reunioes (task_id);
create index if not exists reunioes_sem_aviso_idx   on public.reunioes (inicio)
  where aviso_enviado_em is null and estado in ('a_confirmar','marcada','confirmada');

-- ---------------------------------------------------------------------
-- RLS, grants e auditoria
-- ---------------------------------------------------------------------
alter table public.reunioes enable row level security;

-- A mesma régua de `organizations_view` (20260904000500:70) — e mais o dono.
-- CORREÇÃO: só `org_is_visible` esconderia do `embaixador` a reunião em que
-- ELE atende, quando a ficha é da carteira de outro: `app.org_is_mine` exige
-- ser dono da organização ou de um negócio dela (:58-62). Agenda que some
-- para quem vai à reunião é pior do que agenda que mostra demais.
drop policy if exists reunioes_select on public.reunioes;
create policy reunioes_select on public.reunioes for select to authenticated
  using ((select app.org_is_visible(organization_id)) or dono_id = (select auth.uid()));

grant select on public.reunioes to authenticated;
revoke insert, update, delete on public.reunioes from authenticated;
grant select, insert, update, delete on public.reunioes to service_role;

-- `atualizada_em` não é `updated_at`, e `app.audit()` só pula UPDATE sem
-- mudança comparando `- 'updated_at'` (20260904000400:241): TODO update em
-- `reunioes` audita. Numa tabela de <= 20 linhas/dia é preço barato, e é a
-- favor da regra.
drop trigger if exists reunioes_audit on public.reunioes;
create trigger reunioes_audit after insert or update or delete on public.reunioes
  for each row execute function app.audit();

-- =====================================================================
-- B. A FILA DO AVISO — nasce ANTES de `app.reuniao_gravar`, que a usa
--
-- `app.esteira_enfileirar` levanta exceção quando a fila não está no
-- catálogo (20260904001600:1533), e a exceção não derruba só o aviso:
-- derruba a transação inteira de quem marcou a reunião.
-- =====================================================================
insert into public.ingest_queues (name, visibility_seconds, max_attempts, description, worker) values
  ('reuniao_avisos_dlq', 3600, 1,
   'Dead-letter do aviso de reunião: o que falhou cinco vezes, para alguém ver. Ninguém consome automaticamente.', 'wa'),
  ('reuniao_avisos', 120, 5,
   'Aviso por e-mail de reunião marcada, cancelada ou remarcada (ADR-15). Dois minutos cabem a chamada ao Resend.', 'wa')
on conflict (name) do update
  set visibility_seconds = excluded.visibility_seconds,
      max_attempts       = excluded.max_attempts,
      description        = excluded.description,
      worker             = excluded.worker;
update public.ingest_queues set dlq = 'reuniao_avisos_dlq' where name = 'reuniao_avisos';

do $$
declare
  q text;
begin
  foreach q in array array['reuniao_avisos', 'reuniao_avisos_dlq'] loop
    if not exists (select 1 from pgmq.list_queues() lq where lq.queue_name = q) then
      perform pgmq.create(q);
    end if;
  end loop;
end $$;

-- =====================================================================
-- C. DIA ÚTIL — uma regra, dois usos (ADR-03)
--
-- A régua de dia útil estava escrita DENTRO de `app.next_business_day`
-- (20260904000200:277-278); a grade de reuniões precisa da mesma, e regra
-- repetida é regra que diverge.
-- =====================================================================
create or replace function app.eh_dia_util(p_dia date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(isodow from p_dia) < 6
     and not exists (select 1 from public.holidays h where h.date = p_dia)
$$;
comment on function app.eh_dia_util(date) is
  'Dia útil em Natal: segunda a sexta, fora de feriado de qualquer escopo.';

create or replace function app.next_business_day(p_from date, p_days int default 1)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  d date := p_from;
  n int := 0;
begin
  while n < greatest(p_days, 1) loop
    d := d + 1;
    if app.eh_dia_util(d) then n := n + 1; end if;
  end loop;
  return d;
end $$;

revoke all on function app.eh_dia_util(date) from public, anon;
grant execute on function app.eh_dia_util(date) to authenticated, service_role;

-- =====================================================================
-- D. A GRADE, em app_settings — o gestor muda sem deploy
--
-- Reunião de 40 min com 10 de intervalo (ciclo de 50). Saindo das 9h30, os
-- começos são 9h30 · 10h20 · 11h10 · 12h00 · 12h50 · 13h40 · 14h30 · 15h20
-- · 16h10. O de 17h00 fica de fora porque terminaria 17h40; os 30 minutos
-- entre 16h50 e 17h20 são a folga que absorve a reunião que passa da hora.
--
-- Os 40: o RF-AGE-01 pedia 30 e a rota /api/agenda/evento usava 45. Fica 40
-- porque é o único valor que fecha grade limpa dentro da janela do Rafael, e
-- porque 30 com 10 de intervalo dá 11 reuniões num dia — número que só
-- existe no papel.
--
-- ALMOÇO: nenhum, por ora. A janela veio com precisão de minuto; abrir um
-- buraco de meio-dia que ninguém pediu seria decidir pelo Rafael. O campo
-- existe para `{"de":"12:00","ate":"13:30"}` num update de uma linha.
--
-- TETO 4 por dia por pessoa. O RF-AGE-01 fala em 4 por MANHÃ e 4 por TARDE;
-- aqui a grade atravessa os dois turnos, então 4 por dia é mais apertado —
-- de propósito. Robô que enche o dia de alguém com nove reuniões é robô que
-- a equipe desliga na segunda semana.
--
-- RAMPA (pedido do Rafael, 25/09): na primeira semana alguém confirma com um
-- clique antes de o fornecedor ver o horário. É uma chave com DATA DE SAÍDA
-- escrita, não um passo manual eterno: passada a data, o clique some sozinho.
-- A data conta do dia em que ESTA migração rodou — data literal faria a
-- rampa nascer vencida em todo banco criado depois dela, e deixaria o pgTAP
-- vermelho sozinho no dia seguinte ao prazo.
-- Correção numa reunião do robô (cancelar ou remarcar) empurra a data em
-- `dias` — "passada a semana SEM CORREÇÃO".
-- =====================================================================
insert into public.app_settings (key, value, description) values
  ('agenda.reunioes',
   jsonb_build_object(
     'janela',                 jsonb_build_object('inicio', '09:30', 'fim', '17:20'),
     'duracao_min',            40,
     'intervalo_min',          10,
     'pausa',                  null,
     'antecedencia_min_horas', 3,
     'horizonte_dias_uteis',   10,
     'max_por_dia_por_pessoa', 4,
     'sala_padrao',            null,
     'rampa', jsonb_build_object(
       'ate',  (((now() at time zone 'America/Fortaleza')::date + 7)::text),
       'dias', 7)),
   'Grade de reuniões do CRM (ADR-15, RF-AGE-01): janela, duração, intervalo, pausa, antecedência mínima, horizonte, teto por pessoa por dia, sala padrão e a rampa de confirmação humana com data de saída.')
on conflict (key) do nothing;

-- A sala. Sem Google, sem Meet: cada pessoa cola o link permanente da sala
-- dela. `profiles_update` já deixa cada um editar a própria linha e
-- `app.profiles_guard` só protege papel, status e time — nada de migração de
-- permissão. Nulo aqui vale `agenda.reunioes.sala_padrao`; os dois nulos e
-- `reuniao_marcar` recusa com `sem_sala`. Melhor o robô dizer "já te
-- confirmo" do que marcar uma reunião sem onde acontecer.
alter table public.profiles add column if not exists sala_url text;
do $$ begin
  alter table public.profiles add constraint profiles_sala_url_chk
    check (sala_url is null or sala_url ~* '^https://[^[:space:]]+$');
exception when duplicate_object then null; end $$;
comment on column public.profiles.sala_url is
  'Link permanente da sala de reunião desta pessoa (ADR-15). Congelado em reunioes.link no momento da escrita.';

-- =====================================================================
-- E. DISPONIBILIDADE
-- =====================================================================
create or replace function app.reuniao_config()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce((select s.value from public.app_settings s where s.key = 'agenda.reunioes'),
                  '{}'::jsonb)
$$;

-- ---------------------------------------------------------------------
-- Um horário é cortado por seis motivos, nesta ordem — e a ordem é a de
-- quem pergunta "por que não me ofereceram as 14h?".
--   1. não é dia útil          (app.eh_dia_util)
--   2. cedo demais             (< now() + antecedencia_min_horas)
--   3. longe demais            (> next_business_day(hoje, horizonte))
--   4. colide com outra reunião VIVA do mesmo dono
--   5. colide com a rota da tarde — a JANELA INTEIRA de rotas.planejador,
--      não parada a parada: `route_stops` guarda `seconds_from_prev` mas não
--      quanto dura cada visita, e calcular o fim da rota seria inventar
--      número. O efeito prático é o desenho do próprio RF-AGE-01:
--      apresentação de manhã, visita à tarde.
--   6. colide com tarefa de campo (`meeting`/`visit` aberta do mesmo dono).
--      Aqui o intervalo é o dado pobre, então `due_at` é tratado como PONTO
--      e corta o horário que o contém. Menos horários oferecidos, nenhuma
--      promessa falsa. A tarefa-eco da própria reunião é descontada.
--      É TAMBÉM o que segura a outra porta que ninguém fechou nesta fase: o
--      desfecho `lig_reuniao_marcada` da tela de ligação continua criando
--      `meeting` sem linha em `reunioes`, e este motivo 6 impede o robô de
--      oferecer por cima dela.
-- E, por último, o teto de `max_por_dia_por_pessoa`.
--
-- TODA referência a coluna vai QUALIFICADA: `inicio` e `fim` são parâmetros
-- de saída desta função e sombreariam colunas de mesmo nome.
-- ---------------------------------------------------------------------
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
                        and t.due_at >= j.ini and t.due_at < j.f
                        and not exists (select 1 from public.reunioes r2 where r2.task_id = t.id))
     and (select count(*) from public.reunioes r3
           where r3.dono_id = p_dono
             and r3.estado in ('a_confirmar','marcada','confirmada')
             and (r3.inicio at time zone 'America/Fortaleza')::date = j.dia) < v_teto
   order by j.ini
   limit greatest(coalesce(p_limite, 3), 1);
end $$;

-- O MODELO NUNCA FAZ CONTA DE DATA. Ele recebe a frase pronta e copia. Data
-- calculada por modelo de linguagem é o erro que só aparece quando o parceiro
-- não vem. Meses e dias em array, e não `TMDay`/`TMMonth`: aqueles dependem
-- de `lc_time`, que não é nosso.
create or replace function app.reuniao_por_extenso(p_inicio timestamptz)
returns text language sql stable set search_path = '' as $$
  with l as (select p_inicio at time zone 'America/Fortaleza' as q)
  select (array['segunda-feira','terça-feira','quarta-feira','quinta-feira',
                'sexta-feira','sábado','domingo'])[extract(isodow from l.q)::int]
      || ', ' || case when extract(day from l.q)::int = 1 then '1º'
                      else extract(day from l.q)::int::text end
      || ' de ' || (array['janeiro','fevereiro','março','abril','maio','junho','julho',
                          'agosto','setembro','outubro','novembro','dezembro'])
                     [extract(month from l.q)::int]
      || ', às ' || to_char(l.q, 'HH24') || 'h' || to_char(l.q, 'MI')
    from l
$$;

create or replace function app.reuniao_opcoes(p_dono uuid, p_limite int default 3)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'inicio', h.inicio, 'fim', h.fim,
           'quando_por_extenso', app.reuniao_por_extenso(h.inicio)) order by h.inicio),
         '[]'::jsonb)
    from app.reuniao_horarios_livres(
           p_dono,
           (now() at time zone 'America/Fortaleza')::date,
           app.next_business_day((now() at time zone 'America/Fortaleza')::date,
             coalesce((app.reuniao_config() ->> 'horizonte_dias_uteis')::int, 10)),
           greatest(coalesce(p_limite, 3), 1)) h
$$;

revoke all on function app.reuniao_config()                                   from public, anon;
revoke all on function app.reuniao_horarios_livres(uuid, date, date, int)     from public, anon;
revoke all on function app.reuniao_por_extenso(timestamptz)                   from public, anon;
revoke all on function app.reuniao_opcoes(uuid, int)                          from public, anon;
grant execute on function app.reuniao_config()                                to authenticated, service_role;
grant execute on function app.reuniao_horarios_livres(uuid, date, date, int)  to authenticated, service_role;
grant execute on function app.reuniao_por_extenso(timestamptz)                to authenticated, service_role;
grant execute on function app.reuniao_opcoes(uuid, int)                       to authenticated, service_role;

-- =====================================================================
-- F. A RAMPA
--
-- Pedido do Rafael em 25/09: na primeira semana alguém confirma com um
-- clique antes de o fornecedor ver o horário; passada a semana sem
-- correção, o clique sai sozinho.
-- =====================================================================
create or replace function app.reuniao_rampa_ativa()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((app.reuniao_config() #>> '{rampa,ate}')::date
                    >= (now() at time zone 'America/Fortaleza')::date, false)
$$;

-- "Passada a semana SEM CORREÇÃO." Cancelar ou remarcar uma reunião do robô
-- é a correção: empurra a data de saída em `dias`. Depois do fim, não
-- ressuscita — senão a rampa nunca acaba e vira o passo manual eterno que o
-- Rafael recusou.
create or replace function app.reuniao_rampa_adiar()
returns date language plpgsql volatile security definer set search_path = '' as $$
declare
  v_dias int  := coalesce((app.reuniao_config() #>> '{rampa,dias}')::int, 7);
  v_novo date := (now() at time zone 'America/Fortaleza')::date + v_dias;
begin
  if not app.reuniao_rampa_ativa() then return null; end if;
  update public.app_settings
     set value = jsonb_set(value, '{rampa,ate}', to_jsonb(v_novo::text), true)
   where key = 'agenda.reunioes'
     and (value #>> '{rampa,ate}')::date < v_novo;
  return v_novo;
end $$;

revoke all on function app.reuniao_rampa_ativa()  from public, anon;
revoke all on function app.reuniao_rampa_adiar()  from public, anon, authenticated;
grant execute on function app.reuniao_rampa_ativa() to authenticated, service_role;
grant execute on function app.reuniao_rampa_adiar() to service_role;

-- =====================================================================
-- G. O CORPO ÚNICO. As portas públicas chamam esta função.
--
-- O QUE DERRUBA A FUNÇÃO SE FOR ESQUECIDO:
-- `app.deals_before_write` (20260905000800:110) cobra `stages.required_fields`
-- em QUALQUER update de etapa, não só no `move_deal` — foi escrito assim de
-- propósito, "para que um UPDATE direto não burle o que o move_deal cobra".
-- Ele cobra DUAS formas de spec: `consent_kind` e `type = 'timestamptz'`.
-- `reuniao_marcada` declara `meeting_at` (timestamptz) e `meeting_format`
-- (enum) — o enum NÃO é cobrado pelo gatilho, e por isso `next_action_at =
-- p_inicio` no mesmo comando BASTA. Sem essa linha, 23514 em homologação.
--
-- E NÃO por `public.move_deal`, que exige `auth.uid()` e o robô roda como
-- `service_role`: é função em `app` escrevendo `public.deals` com autoria de
-- sistema, o precedente que a §7.8 fixou para o webhook da Komune. O
-- histórico sai de graça pelo gatilho `app.deals_track_stage`.
--
-- SÓ PARA A FRENTE. A busca da etapa cobra `position` maior que a atual:
-- parceiro já em `apresentacao_realizada` que marca uma segunda reunião não
-- volta para `reuniao_marcada`, e negócio ganho não é reaberto pelo gatilho
-- (`old.status in ('won','lost','nurturing') -> 'open'`).
-- =====================================================================
create or replace function app.reuniao_gravar(
  p_conversation_id uuid, p_deal_id uuid, p_inicio timestamptz,
  p_formato text, p_local text, p_observacao text,
  p_por text, p_por_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c        jsonb := app.reuniao_config();
  v_dur    int   := coalesce((c ->> 'duracao_min')::int, 40);
  v_conv   public.conversations%rowtype;
  v_deal   public.deals%rowtype;
  v_org    uuid;  v_dono uuid;  v_contato uuid;  v_nome text;
  v_fim    timestamptz := p_inicio + make_interval(mins => v_dur);
  v_dia    date;  v_sala text;  v_estado text;
  v_id     uuid;  v_task uuid;  v_etapa int;  v_pos int;  v_titulo text;
begin
  if p_formato not in ('online','presencial') then
    return jsonb_build_object('ok', false, 'motivo', 'formato_invalido');
  end if;

  if p_conversation_id is not null then
    select * into v_conv from public.conversations where id = p_conversation_id;
    if v_conv.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_existe'); end if;
    -- `conversations.organization_id` é NULÁVEL e "conversa fora da base" é
    -- estado real e comum (tem migração própria e aba própria na tela).
    if v_conv.organization_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'sem_ficha'); end if;
    v_org := v_conv.organization_id;  v_contato := v_conv.contact_id;
    if v_conv.deal_id is not null then
      select * into v_deal from public.deals where id = v_conv.deal_id; end if;
  elsif p_deal_id is not null then
    select * into v_deal from public.deals where id = p_deal_id;
    if v_deal.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'negocio_nao_existe'); end if;
    v_org := v_deal.organization_id;
  else
    return jsonb_build_object('ok', false, 'motivo', 'sem_alvo');
  end if;

  -- Guardrail antes de tudo: marcar reunião para quem acabou de pedir para
  -- sair é pior do que responder.
  if exists (select 1 from public.organizations o
              where o.id = v_org and o.do_not_contact) then
    return jsonb_build_object('ok', false, 'motivo', 'suprimido');
  end if;

  -- `deals.owner_id` quando há negócio; senão `conversations.assignee_id`,
  -- que é NOT NULL. O robô NÃO procura horário na agenda de outra pessoa:
  -- trocar de dono em silêncio para achar vaga é o jeito de a carteira virar
  -- rodízio.
  v_dono := coalesce(v_deal.owner_id, v_conv.assignee_id);
  if v_dono is null then return jsonb_build_object('ok', false, 'motivo', 'sem_dono'); end if;

  if p_formato = 'online' then
    select p.sala_url into v_sala from public.profiles p where p.id = v_dono;
    v_sala := coalesce(nullif(btrim(coalesce(v_sala, '')), ''),
                       nullif(btrim(coalesce(c ->> 'sala_padrao', '')), ''));
    if v_sala is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sala'); end if;
  elsif nullif(btrim(coalesce(p_local, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_lugar');
  end if;

  -- Serializa por (pessoa, dia). Isto protege as regras MOLES — o teto de 4,
  -- a rota, os feriados: dois `select` concorrentes passariam os dois pelo
  -- teto. Com o lock, o segundo espera e vê o primeiro.
  v_dia := (p_inicio at time zone 'America/Fortaleza')::date;
  perform pg_advisory_xact_lock(hashtextextended(v_dono::text || v_dia::text, 0));

  -- Entre a oferta e o aceite o parceiro demora — às vezes horas.
  if not exists (select 1 from app.reuniao_horarios_livres(v_dono, v_dia, v_dia, 50) h
                  where h.inicio = p_inicio) then
    return jsonb_build_object('ok', false, 'motivo', 'horario_indisponivel',
             'alternativas', app.reuniao_opcoes(v_dono, 3));
  end if;

  v_estado := case when p_por = 'robo' and app.reuniao_rampa_ativa()
                   then 'a_confirmar' else 'marcada' end;
  select o.name into v_nome from public.organizations o where o.id = v_org;
  v_titulo := 'Reunião com ' || coalesce(v_nome, 'parceiro');

  -- A TRAVA DURA. 23P01 = exclusion_violation. Ela é o último recurso: o
  -- caminho normal já foi barrado acima. Quem chega aqui é outra transação
  -- que comitou entre o advisory lock e o insert — cenário de dois workers.
  begin
    insert into public.reunioes (organization_id, deal_id, conversation_id, contact_id,
                                 dono_id, titulo, formato, inicio, fim, link, local,
                                 estado, marcada_por, marcada_por_id, observacao)
    values (v_org, v_deal.id, p_conversation_id, v_contato, v_dono, v_titulo, p_formato,
            p_inicio, v_fim,
            case when p_formato = 'online'     then v_sala end,
            case when p_formato = 'presencial' then btrim(p_local) end,
            v_estado, p_por, p_por_id, nullif(btrim(coalesce(p_observacao, '')), ''))
    returning id into v_id;
  exception when exclusion_violation then
    -- As alternativas vêm no MESMO retorno: o robô responde "esse acabou de
    -- ser ocupado — consigo às 11h10 ou às 14h30", sem segunda ida ao banco e
    -- sem o modelo inventar a recuperação.
    return jsonb_build_object('ok', false, 'motivo', 'horario_tomado',
             'alternativas', app.reuniao_opcoes(v_dono, 3));
  end;

  insert into public.tasks (title, kind, status, priority, due_at, assignee_id,
                            organization_id, deal_id, contact_id, origin)
  values (v_titulo, 'meeting'::app.task_kind, 'todo'::app.task_status, 2, p_inicio,
          v_dono, v_org, v_deal.id, v_contato,
          case when p_por = 'robo' then 'ai' else 'manual' end)
  returning id into v_task;
  update public.reunioes set task_id = v_task, atualizada_em = now() where id = v_id;

  -- Conversa sem negócio PULA este passo, em vez de falhar.
  if v_deal.id is not null then
    select st0.position into v_pos from public.stages st0 where st0.id = v_deal.stage_id;
    select st.id into v_etapa from public.stages st
     where st.pipeline_id = v_deal.pipeline_id
       and st.position > coalesce(v_pos, -1)
       and exists (select 1 from jsonb_array_elements(coalesce(st.required_fields,'[]'::jsonb)) e
                    where e.value ->> 'field' = 'meeting_at')
     order by st.position limit 1;
    if v_etapa is not null then
      update public.deals
         set stage_id = v_etapa, next_action_at = p_inicio,
             stage_change_reason = 'Reunião marcada'
       where id = v_deal.id;
    else
      -- Já está na etapa de reunião, ou além dela. A etapa não muda; a
      -- próxima ação, sim — é esta reunião.
      update public.deals set next_action_at = p_inicio where id = v_deal.id;
    end if;
  end if;

  -- O aviso, NA MESMA TRANSAÇÃO: é o que garante que não existe reunião
  -- marcada sem aviso pendente. A fila nasceu na seção B deste arquivo,
  -- antes desta função, porque `app.esteira_enfileirar` levanta exceção em
  -- fila que não está no catálogo — e a exceção derrubaria a transação
  -- inteira de quem marcou.
  perform app.esteira_enfileirar('reuniao_avisos',
            jsonb_build_object('reuniao_id', v_id, 'motivo', 'marcada',
                               'chave', 'reuniao:' || v_id::text || ':marcada'),
            'reuniao:' || v_id::text || ':marcada');

  return jsonb_build_object(
    'ok', true, 'reuniao_id', v_id, 'inicio', p_inicio, 'fim', v_fim,
    'estado', v_estado, 'precisa_confirmacao', v_estado = 'a_confirmar',
    'formato', p_formato,
    'link',  case when p_formato = 'online'     then v_sala end,
    'local', case when p_formato = 'presencial' then btrim(p_local) end,
    'quando_por_extenso', app.reuniao_por_extenso(p_inicio));
end $$;

revoke all on function app.reuniao_gravar(uuid,uuid,timestamptz,text,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function app.reuniao_gravar(uuid,uuid,timestamptz,text,text,text,text,uuid)
  to service_role;

-- =====================================================================
-- H. AS PORTAS
--
-- Duas ferramentas para a IA, e a segunda é a única que escreve.
-- =====================================================================
create or replace function public.reuniao_horarios(p_conversation_id uuid, p_limite int default 3)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_conv public.conversations%rowtype; v_dono uuid;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_existe'); end if;
  if v_conv.organization_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_ficha'); end if;
  select coalesce(d.owner_id, c.assignee_id) into v_dono
    from public.conversations c left join public.deals d on d.id = c.deal_id
   where c.id = p_conversation_id;
  return jsonb_build_object('ok', true, 'dono_id', v_dono,
                            'opcoes', app.reuniao_opcoes(v_dono, p_limite));
end $$;

-- Quando `auth.uid()` é nulo é o robô.
create or replace function public.reuniao_marcar(
  p_conversation_id uuid, p_inicio timestamptz,
  p_formato text default 'online', p_observacao text default null)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select app.reuniao_gravar(p_conversation_id, null, p_inicio, p_formato, null, p_observacao,
                            case when auth.uid() is null then 'robo' else 'pessoa' end,
                            auth.uid())
$$;

-- A irmã dela: é por aqui que UMA PESSOA marca pela tela, porque a maior
-- parte dos negócios do funil não tem conversa de WhatsApp nenhuma — sem ela
-- o botão "Marcar" da Agenda não teria como existir.
create or replace function public.reuniao_marcar_pelo_negocio(
  p_deal_id uuid, p_inicio timestamptz, p_formato text default 'online',
  p_local text default null, p_observacao text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  if auth.uid() is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  select d.organization_id into v_org from public.deals d where d.id = p_deal_id;
  if v_org is null or not app.org_is_visible(v_org) then
    return jsonb_build_object('ok', false, 'motivo', 'negocio_invisivel'); end if;
  return app.reuniao_gravar(null, p_deal_id, p_inicio, p_formato, p_local, p_observacao,
                            'pessoa', auth.uid());
end $$;

-- A tira de "livres hoje" da tela, e a folha de remarcar: pessoa e robô
-- escolhem da MESMA grade — senão a pessoa marca por cima da rota e a grade
-- vira ficção.
create or replace function public.reuniao_livres(p_dia date, p_dono uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_dono uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sessao'); end if;
  v_dono := coalesce(p_dono, auth.uid());
  if v_dono <> auth.uid() and not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  return jsonb_build_object('ok', true, 'dia', p_dia,
    'horarios', coalesce((select jsonb_agg(jsonb_build_object(
        'inicio', h.inicio, 'fim', h.fim,
        'quando_por_extenso', app.reuniao_por_extenso(h.inicio)) order by h.inicio)
      from app.reuniao_horarios_livres(v_dono, p_dia, p_dia, 50) h), '[]'::jsonb));
end $$;

-- Os dois `revoke … from service_role` são de propósito: ambas as funções
-- começam recusando quando `auth.uid()` é nulo, que é exatamente o estado do
-- robô. Manter o grant é anunciar uma porta que devolve `sem_permissao` para
-- quem a tem. O robô entra por `reuniao_horarios` e `reuniao_marcar`, e é só
-- isso que a Fase 4 recebe.
revoke all on function public.reuniao_horarios(uuid, int)                          from public, anon, authenticated;
grant  execute on function public.reuniao_horarios(uuid, int)                      to service_role;
revoke all on function public.reuniao_marcar(uuid, timestamptz, text, text)        from public, anon, authenticated;
grant  execute on function public.reuniao_marcar(uuid, timestamptz, text, text)    to service_role;
revoke all on function public.reuniao_marcar_pelo_negocio(uuid, timestamptz, text, text, text) from public, anon, service_role;
grant  execute on function public.reuniao_marcar_pelo_negocio(uuid, timestamptz, text, text, text) to authenticated;
revoke all on function public.reuniao_livres(date, uuid)                           from public, anon, service_role;
grant  execute on function public.reuniao_livres(date, uuid)                       to authenticated;

-- =====================================================================
-- I. CONFIRMAR, CANCELAR, REMARCAR E FECHAR — tudo de gente nesta fase
-- =====================================================================
create or replace function app.reuniao_pode_mexer(r public.reunioes)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and app.can_write()
     and (app.org_is_visible(r.organization_id) or r.dono_id = auth.uid())
$$;

create or replace function public.reuniao_confirmar(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.reunioes%rowtype;
begin
  select * into r from public.reunioes where id = p_id;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'nao_existe'); end if;
  if not app.reuniao_pode_mexer(r) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  if r.estado <> 'a_confirmar' then
    return jsonb_build_object('ok', false, 'motivo', 'nao_esta_a_confirmar', 'estado', r.estado); end if;
  update public.reunioes
     set estado = 'marcada', confirmada_em = now(), confirmada_por = auth.uid(),
         atualizada_em = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'estado', 'marcada',
    'quando_por_extenso', app.reuniao_por_extenso(r.inicio),
    'link', r.link, 'local', r.local);
end $$;

create or replace function public.reuniao_cancelar(p_id uuid, p_motivo text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.reunioes%rowtype;
begin
  select * into r from public.reunioes where id = p_id;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'nao_existe'); end if;
  if not app.reuniao_pode_mexer(r) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  if r.estado not in ('a_confirmar','marcada','confirmada') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_invalido', 'estado', r.estado); end if;
  update public.reunioes
     set estado = 'cancelada', atualizada_em = now(),
         observacao = coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), observacao)
   where id = p_id;
  update public.tasks set status = 'cancelled'::app.task_status where id = r.task_id;
  if r.marcada_por = 'robo' then perform app.reuniao_rampa_adiar(); end if;
  perform app.esteira_enfileirar('reuniao_avisos',
    jsonb_build_object('reuniao_id', p_id, 'motivo', 'cancelada',
                       'chave', 'reuniao:' || p_id::text || ':cancelada'),
    'reuniao:' || p_id::text || ':cancelada');
  return jsonb_build_object('ok', true, 'estado', 'cancelada');
end $$;

-- Remarcar NÃO altera a linha: marca a antiga como `remarcada`, cria a nova
-- com `remarcada_de` apontando para ela, e enfileira o aviso de novo.
-- A antiga SAI DO CAMINHO antes de a nova entrar — senão a trava GiST recusa
-- remarcar para um horário que encoste no próprio horário velho. O bloco
-- `exception` existe para que a falha desfaça o flip e devolva o motivo, em
-- vez de derrubar a transação de quem chamou.
create or replace function public.reuniao_remarcar(p_id uuid, p_novo_inicio timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.reunioes%rowtype; v_nova jsonb; v_motivo text;
begin
  select * into r from public.reunioes where id = p_id;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'nao_existe'); end if;
  if not app.reuniao_pode_mexer(r) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  if r.estado not in ('a_confirmar','marcada','confirmada') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_invalido', 'estado', r.estado); end if;
  begin
    update public.reunioes set estado = 'remarcada', atualizada_em = now() where id = p_id;
    update public.tasks set status = 'cancelled'::app.task_status where id = r.task_id;
    -- `marcada_por = 'pessoa'` sem case: só gente chega aqui (a função recusa
    -- sem `auth.uid()`, e o robô não tem grant). Ramo de robô aqui seria
    -- código morto a fingir que existe caminho.
    v_nova := app.reuniao_gravar(r.conversation_id, r.deal_id, p_novo_inicio, r.formato,
                                 r.local, r.observacao, 'pessoa', auth.uid());
    if coalesce((v_nova ->> 'ok')::boolean, false) is not true then
      raise exception '%', coalesce(v_nova ->> 'motivo', 'falhou') using errcode = 'P0001';
    end if;
    update public.reunioes set remarcada_de = p_id, atualizada_em = now()
     where id = (v_nova ->> 'reuniao_id')::uuid;
  exception when sqlstate 'P0001' then
    v_motivo := sqlerrm;
    return jsonb_build_object('ok', false, 'motivo', v_motivo,
             'alternativas', app.reuniao_opcoes(r.dono_id, 3));
  end;
  if r.marcada_por = 'robo' then perform app.reuniao_rampa_adiar(); end if;
  return v_nova || jsonb_build_object('remarcada_de', p_id);
end $$;

-- ---------------------------------------------------------------------
-- O DESFECHO
--
-- Sem ele, `realizada` e `nao_compareceu` são estados que o CHECK aceita e
-- que NINGUÉM nunca escreve. A tela fecha a `tasks` e a linha em `reunioes`
-- fica `marcada` para sempre: segurando o horário na restrição de exclusão,
-- contando no teto de 4 do dia, e aparecendo na Agenda como compromisso vivo
-- de uma semana atrás.
-- ---------------------------------------------------------------------
create or replace function public.reuniao_desfecho(p_id uuid, p_estado text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.reunioes%rowtype;
begin
  if p_estado not in ('realizada','nao_compareceu') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_invalido'); end if;
  select * into r from public.reunioes where id = p_id;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'nao_existe'); end if;
  if not app.reuniao_pode_mexer(r) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  if r.estado not in ('a_confirmar','marcada','confirmada') then
    return jsonb_build_object('ok', false, 'motivo', 'ja_fechada', 'estado', r.estado); end if;
  update public.reunioes set estado = p_estado, atualizada_em = now() where id = p_id;
  return jsonb_build_object('ok', true, 'estado', p_estado);
end $$;

revoke all on function app.reuniao_pode_mexer(public.reunioes)          from public, anon;
grant  execute on function app.reuniao_pode_mexer(public.reunioes)      to authenticated, service_role;
revoke all on function public.reuniao_confirmar(uuid)                   from public, anon, service_role;
revoke all on function public.reuniao_cancelar(uuid, text)              from public, anon, service_role;
revoke all on function public.reuniao_remarcar(uuid, timestamptz)       from public, anon, service_role;
revoke all on function public.reuniao_desfecho(uuid, text)              from public, anon, service_role;
grant  execute on function public.reuniao_confirmar(uuid)               to authenticated;
grant  execute on function public.reuniao_cancelar(uuid, text)          to authenticated;
grant  execute on function public.reuniao_remarcar(uuid, timestamptz)   to authenticated;
grant  execute on function public.reuniao_desfecho(uuid, text)          to authenticated;

-- =====================================================================
-- J. O E-MAIL DO DONO
-- =====================================================================
-- `public.profiles` não tem coluna de e-mail; ele está em `auth.users`.
create or replace function app.email_de(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select u.email::text from auth.users u where u.id = p_user_id
$$;
revoke all on function app.email_de(uuid) from public, anon, authenticated;
grant execute on function app.email_de(uuid) to service_role;

-- O consumidor, no molde de `public.rota_proximas`. NÃO vai o telefone do
-- parceiro: e-mail é caixa fora da RLS, e telefone completo lá é PII
-- exportada sem `pii_access_log` (RF-BAS-14).
create or replace function public.reuniao_avisos_proximos(p_qty int default 5)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_msgs jsonb; v_msg jsonb; v_saida jsonb := '[]'::jsonb; r public.reunioes%rowtype;
begin
  v_msgs := public.esteira_fila_ler('reuniao_avisos', least(greatest(coalesce(p_qty,1),1), 20));
  for v_msg in select * from jsonb_array_elements(v_msgs) loop
    select * into r from public.reunioes where id = (v_msg -> 'mensagem' ->> 'reuniao_id')::uuid;
    if r.id is null then
      perform public.esteira_fila_concluir('reuniao_avisos',
        (v_msg ->> 'msg_id')::bigint, v_msg -> 'mensagem' ->> 'chave');
      continue;
    end if;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object(
      'msg_id', (v_msg ->> 'msg_id')::bigint,
      'chave',  v_msg -> 'mensagem' ->> 'chave',
      'motivo', v_msg -> 'mensagem' ->> 'motivo',
      'reuniao_id', r.id, 'organization_id', r.organization_id,
      'conversation_id', r.conversation_id,
      'parceiro', (select o.name from public.organizations o where o.id = r.organization_id),
      'quando_por_extenso', app.reuniao_por_extenso(r.inicio),
      'quando_curto', to_char(r.inicio at time zone 'America/Fortaleza', 'DD/MM')
                      || ', ' || to_char(r.inicio at time zone 'America/Fortaleza', 'HH24"h"MI'),
      'formato', r.formato, 'link', r.link, 'local', r.local, 'estado', r.estado,
      'marcada_pelo_robo', r.marcada_por = 'robo',
      'atende', (select t.full_name from public.team_directory t where t.id = r.dono_id),
      'email_do_dono', app.email_de(r.dono_id)));
  end loop;
  return v_saida;
end $$;

create or replace function public.reuniao_aviso_enviado(p_reuniao_id uuid)
returns boolean language sql volatile security definer set search_path = '' as $$
  update public.reunioes set aviso_enviado_em = now(), atualizada_em = now()
   where id = p_reuniao_id returning true
$$;

revoke all on function public.reuniao_avisos_proximos(int)   from public, anon, authenticated;
revoke all on function public.reuniao_aviso_enviado(uuid)    from public, anon, authenticated;
grant  execute on function public.reuniao_avisos_proximos(int) to service_role;
grant  execute on function public.reuniao_aviso_enviado(uuid)  to service_role;

-- =====================================================================
-- K. O LEMBRETE DA VÉSPERA
--
-- O lembrete AO LEAD não entra nesta fase, e a razão está no banco:
-- `GEN-AGD-24H-MEET` e `GEN-AGD-24H-VISITA` têm `meta_status = 'pending'`
-- em supabase/seed.sql. Na véspera a janela de 24 h provavelmente já fechou,
-- e `app.pode_enviar` recusa texto livre fora dela — corretamente. Aprovação
-- de template é prazo da Meta, não nosso.
--
-- O que entra no lugar, e é barato: uma tarefa `priority = 1` do dono.
-- SEM tabela temporária: `create temp table ... on commit drop` com um
-- `delete from` depois é código morto (ela não sobrevive ao commit), e
-- referenciá-la sem qualificar dentro de `search_path = ''` é apostar numa
-- resolução implícita de `pg_temp` que não precisa existir. Um CTE que
-- escreve resolve as duas escritas numa instrução só.
-- =====================================================================
create or replace function app.reuniao_lembretes_da_vespera()
returns int language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  with alvo as (
    select r.id, r.inicio, r.dono_id, r.organization_id, r.deal_id, r.contact_id
      from public.reunioes r
     where r.estado in ('a_confirmar','marcada','confirmada')
       and r.lembrete_em is null
       and (r.inicio at time zone 'America/Fortaleza')::date
           = (now() at time zone 'America/Fortaleza')::date + 1
  ),
  marcadas as (
    update public.reunioes r set lembrete_em = now(), atualizada_em = now()
      from alvo a where r.id = a.id
     returning r.id
  )
  insert into public.tasks (title, kind, status, priority, due_at, assignee_id,
                            organization_id, deal_id, contact_id, origin)
  select 'Confirmar amanhã '
         || to_char(a.inicio at time zone 'America/Fortaleza', 'HH24"h"MI')
         || ' com ' || coalesce(o.name, 'parceiro'),
         'message'::app.task_kind, 'todo'::app.task_status, 1,
         now(),
         a.dono_id, a.organization_id, a.deal_id, a.contact_id, 'system'
    from alvo a
    join public.organizations o on o.id = a.organization_id
   where exists (select 1 from marcadas m where m.id = a.id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function app.reuniao_lembretes_da_vespera() from public, anon, authenticated;
grant execute on function app.reuniao_lembretes_da_vespera() to service_role;

-- 20:00 UTC = 17:00 em Fortaleza. O `cron.timezone` do pg_cron é GMT e todo
-- horário deste repositório soma 3 h (20260904001700:2633-2635).
-- `due_at = now()`: a tarefa nasce para ser feita agora, e não com prazo às
-- 17:00 de um dia que já são 17:00 — tarefa que nasce vencida é tarefa que
-- ninguém confia.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('reuniao_lembrete_vespera', '0 20 * * *',
                          $cron$select app.reuniao_lembretes_da_vespera()$cron$);
  end if;
end $$;

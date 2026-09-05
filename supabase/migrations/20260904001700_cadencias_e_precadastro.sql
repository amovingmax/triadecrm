-- =====================================================================
-- TRIADE — v0.1 — D6/D9 — Cadências, régua de silêncio e pré-cadastro
-- (RF-CON-10..18, RF-FUN-13, RF-MET-04, RF-PRE-01..16; PRD §5, §7.4, §7.6,
--  §10.6; anexos R06, R07, R08, R10, R13.)
--
-- Os três princípios que este arquivo transforma em regra de banco
--   1. O CANAL É ATRIBUTO DO PASSO, não do lote (R13 §7). Uma cadência é uma
--      sequência de toques; cada toque tem canal, atraso e condição próprios.
--      Com a virada de 04/09 (Matheus), o passo 1 é LIGAÇÃO e o WhatsApp virou
--      apoio: retomar quem não atendeu, mandar o link, confirmar reunião.
--   2. A CADÊNCIA NÃO ENVIA NADA — ela agenda trabalho. Todo toque vira uma
--      linha em `public.tasks` (origin = 'cadence') e quem executa é gente
--      (ADR-05). O único automatismo é decidir O QUE entra na fila e QUANDO.
--      Não existe neste arquivo nenhum caminho que dispare mensagem, e nenhum
--      job que crie toque só porque "passou o prazo" — o vencido fica vencido
--      no Meu dia (RF-MET-04).
--   3. UM TOQUE PENDENTE POR CONTATO, EM QUALQUER CANAL. É regra dura de banco
--      (dois índices únicos parciais + gatilho), não disciplina de tela. O
--      próximo toque só nasce quando o anterior é resolvido (feito ou pulado),
--      e é isso que torna impossível a fila se auto-alimentar.
--
-- O que esta migração ENTREGA
--   A. Configuração operável: `public.app_settings` (tetos por canal) e
--      `public.channel_windows` (janelas por canal e dia da semana, com o TETO
--      LEGAL do R06 §3.4 escrito como CHECK — o banco recusa configurar fora).
--   B. `app.pode_tocar(...)` — a função porteira. Sete checagens em ordem, a
--      primeira que falha manda. Supressão e desfecho não-reativável ENCERRAM;
--      cooldown, janela, feriado e teto ADIAM. Cooldown é FILTRO DE ENTRADA,
--      nunca gatilho de reenvio (RF-FUN-13).
--   C. `cadences`, `cadence_steps`, `cadence_enrollments`, `cadence_touches` —
--      o toque como entidade ACIMA da atividade. Chamada, atividade e
--      tabulação continuam exatamente como estão: o toque entra por cima e se
--      RESOLVE quando a atividade acontece.
--   D. As cinco cadências do contrato, em seed: `voz_primeiro`,
--      `retomar_conversa`, `pos_autorizacao`, `completar_cadastro`,
--      `reativacao`.
--   E. A régua de silêncio como jobs `pg_cron` no fuso America/Fortaleza, que
--      não fazem nada em domingo nem feriado (`public.holidays`).
--   F. Pré-cadastro: `pre_registrations` (rascunho), `pre_registration_events`
--      (log append-only do R10 §5.2), `pre_registration_acceptances` (aceite
--      com prova completa: carimbo, IP, user-agent, versão e hash do termo).
--      Token de reivindicação guardado só como hash, validade de 7 dias,
--      reenvio invalida o anterior. `published = false` por padrão e imposto:
--      anon não lê a tabela e o banco recusa publicar sem aceite provado.
--      Não reivindicado em 30 dias, com 1 lembrete → apaga os dados
--      pré-preenchidos; o lead no CRM PERMANECE (R06 §D, item 9 do sumário).
--   G. O guardrail do CLAUDE.md em gatilho: nenhuma cadência, nenhum toque e
--      nenhuma tarefa DE CONTATO nasce para alvo suprimido. Vale no banco, por
--      psql, com a chave que for.
--
-- O que esta migração NÃO faz (e por quê)
--   * Não envia mensagem, não fala com a Meta e não fala com a Komune. As Edge
--     Functions (`komune-push`, `komune-webhook`, `claim-link`, `export-lgpd`)
--     são outro arquivo; aqui ficam só os contratos de dados que elas usam.
--   * Não implementa modo automático (RF-CON-09): está fora do MVP e atrás de
--     feature flag desligada (ADR-05).
--   * Não guarda CPF, CNPJ de faturamento, Pix nem dado bancário (ADR-09,
--     RF-PRE-04) — há CHECK recusando essas chaves no rascunho.
--   * Não conta, no teto do canal, os envios feitos fora da cadência (a fila
--     assistida do RF-CON-08 ainda não existe). Está marcado no comentário da
--     função para somar quando aquele módulo entrar.
--
-- DIVERGÊNCIA CONHECIDA, REGISTRADA: o R10 §5.1 propõe CRM e plataforma no
-- mesmo projeto Supabase com views compartilhadas. Superado pelo ADR-02
-- (projeto separado, integração só por contrato). Vale o ADR: nada aqui lê ou
-- escreve no banco do app da Komune.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 0. Tipos
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'app' and t.typname = 'cadence_status') then
    create type app.cadence_status as enum ('ativa', 'pausada', 'concluida', 'encerrada');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'app' and t.typname = 'touch_status') then
    create type app.touch_status as enum ('pendente', 'feito', 'pulado', 'cancelado');
  end if;
end $$;


-- ===========================================================================
-- A. CONFIGURAÇÃO OPERÁVEL — tetos e janelas
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A.1 `public.app_settings` — parâmetros que o gestor muda sem deploy
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key check (key ~ '^[a-z0-9_.]+$'),
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);
comment on table public.app_settings is
  'Parâmetros operáveis do CRM (tetos de canal, datas de referência). Escrita só por gestor/admin, auditada.';

-- O teto duro do RF-CON-10 é lei, não sugestão: nenhuma configuração pode
-- passar dele, e o banco recusa a gravação — não a tela.
create or replace function app.app_settings_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c    text;
  duro int;
  v    int;
begin
  if new.key = 'cadencia.tetos' then
    if (new.value ->> 'inicio') is null then
      raise exception 'cadencia.tetos precisa de "inicio" (data de referência das semanas de aquecimento).'
        using errcode = '23514';
    end if;
    perform (new.value ->> 'inicio')::date;
    foreach c in array array['whatsapp', 'instagram', 'phone', 'presencial'] loop
      if new.value ? c then
        duro := coalesce((new.value -> c ->> 'teto_duro')::int, 0);
        if duro <= 0 then
          raise exception 'Canal % precisa de "teto_duro" positivo (RF-CON-10).', c using errcode = '23514';
        end if;
        foreach v in array array(select x.value::int
                                   from jsonb_each_text(new.value -> c) x
                                  where x.key <> 'teto_duro'
                                    and x.value ~ '^[0-9]+$') loop
          if v > duro then
            raise exception 'Teto de % (%) acima do teto duro do canal (%). RF-CON-10 não é negociável.',
              c, v, duro using errcode = '23514';
          end if;
        end loop;
      end if;
    end loop;
  end if;
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists app_settings_validate on public.app_settings;
create trigger app_settings_validate
  before insert or update on public.app_settings
  for each row execute function app.app_settings_validate();

drop trigger if exists audit_app_settings on public.app_settings;
create trigger audit_app_settings
  after insert or update or delete on public.app_settings
  for each row execute function app.audit();

alter table public.app_settings enable row level security;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated using (true);

drop policy if exists app_settings_insert on public.app_settings;
create policy app_settings_insert on public.app_settings
  for insert to authenticated with check ((select app.is_manager()));

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
  for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

drop policy if exists app_settings_delete on public.app_settings;
create policy app_settings_delete on public.app_settings
  for delete to authenticated using ((select app.is_admin()));

-- Semana 1 ≤ 20 primeiros contatos/dia, semana 2 ≤ 35, daí em diante 40–60,
-- teto duro 100 (RF-CON-10). `inicio` é a data em que o Número 1 começou a
-- aquecer; as semanas são contadas a partir dela.
insert into public.app_settings (key, value, description) values
  ('cadencia.tetos',
   jsonb_build_object(
     'inicio',     '2026-09-04',
     'whatsapp',   jsonb_build_object('semana1', 20, 'semana2', 35, 'depois', 45, 'teto_duro', 100),
     'instagram',  jsonb_build_object('padrao', 15, 'teto_duro', 30),
     'phone',      jsonb_build_object('padrao', 60, 'teto_duro', 120),
     'presencial', jsonb_build_object('padrao', 12, 'teto_duro', 20)),
   'Tetos de toques por canal e por dia (RF-CON-10). "inicio" é o marco do aquecimento do Número 1.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- A.2 `public.channel_windows` — janela de envio proativo por canal (RF-CON-11)
-- ---------------------------------------------------------------------------
-- `phone` NÃO entra aqui de propósito: a janela da ligação já existe e é
-- `app.call_window` / `app.call_window_hours` (seg–sex 09–20, sáb 10–13,
-- domingo e feriado bloqueados). Duas fontes de verdade para o mesmo horário
-- seria o começo do primeiro bug de conformidade.
create table if not exists public.channel_windows (
  id             serial primary key,
  channel        app.channel not null,
  dow            smallint not null check (dow between 0 and 6),
  "position"     smallint not null default 1 check ("position" between 1 and 3),
  de             numeric(4,2) not null,
  ate            numeric(4,2) not null,
  requires_reply boolean not null default false,
  note           text,
  unique (channel, dow, "position"),
  constraint channel_windows_ordem check (de >= 0 and ate <= 24 and de < ate),
  constraint channel_windows_canal check (channel in ('whatsapp', 'instagram', 'presencial')),
  -- TETO LEGAL (R06 §3.4 e RF-CON-11): seg–sex 08:00–19:00, sáb 09:00–13:00,
  -- domingo nunca. Feriado é bloqueado em tempo de execução pela `holidays`.
  constraint channel_windows_teto_legal check (
    dow <> 0
    and ((dow between 1 and 5 and de >= 8 and ate <= 19)
         or (dow = 6 and de >= 9 and ate <= 13)))
);
comment on table public.channel_windows is
  'Janela de contato proativo por canal e dia da semana (RF-CON-11). O CHECK channel_windows_teto_legal recusa configurar fora do teto do R06 §3.4. Ligação não está aqui: usa app.call_window.';
comment on column public.channel_windows.requires_reply is
  'Janela que só vale para quem JÁ respondeu alguma vez (o sábado do WhatsApp, RF-CON-11).';

drop trigger if exists audit_channel_windows on public.channel_windows;
create trigger audit_channel_windows
  after insert or update or delete on public.channel_windows
  for each row execute function app.audit();

alter table public.channel_windows enable row level security;

drop policy if exists channel_windows_select on public.channel_windows;
create policy channel_windows_select on public.channel_windows
  for select to authenticated using (true);

drop policy if exists channel_windows_insert on public.channel_windows;
create policy channel_windows_insert on public.channel_windows
  for insert to authenticated with check ((select app.is_manager()));

drop policy if exists channel_windows_update on public.channel_windows;
create policy channel_windows_update on public.channel_windows
  for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

drop policy if exists channel_windows_delete on public.channel_windows;
create policy channel_windows_delete on public.channel_windows
  for delete to authenticated using ((select app.is_manager()));

insert into public.channel_windows (channel, dow, "position", de, ate, requires_reply, note)
select w.canal::app.channel, w.dow, w.pos, w.de, w.ate, w.resp, w.nota
  from (values
    -- WhatsApp: seg–sex 09–12 e 14–18 (pico 09:00–11:30); sáb 10–12 só para
    -- quem já respondeu (RF-CON-11).
    ('whatsapp',   1, 1,  9::numeric, 12::numeric, false, 'Manhã, pico 09:00–11:30'),
    ('whatsapp',   1, 2, 14::numeric, 18::numeric, false, 'Tarde'),
    ('whatsapp',   2, 1,  9::numeric, 12::numeric, false, 'Manhã, pico 09:00–11:30'),
    ('whatsapp',   2, 2, 14::numeric, 18::numeric, false, 'Tarde'),
    ('whatsapp',   3, 1,  9::numeric, 12::numeric, false, 'Manhã, pico 09:00–11:30'),
    ('whatsapp',   3, 2, 14::numeric, 18::numeric, false, 'Tarde'),
    ('whatsapp',   4, 1,  9::numeric, 12::numeric, false, 'Manhã, pico 09:00–11:30'),
    ('whatsapp',   4, 2, 14::numeric, 18::numeric, false, 'Tarde'),
    ('whatsapp',   5, 1,  9::numeric, 12::numeric, false, 'Manhã, pico 09:00–11:30'),
    ('whatsapp',   5, 2, 14::numeric, 18::numeric, false, 'Tarde'),
    ('whatsapp',   6, 1, 10::numeric, 12::numeric, true,  'Sábado: só follow-up de quem já respondeu'),
    -- Instagram: mesma janela do WhatsApp (contrato de cadências).
    ('instagram',  1, 1,  9::numeric, 12::numeric, false, null),
    ('instagram',  1, 2, 14::numeric, 18::numeric, false, null),
    ('instagram',  2, 1,  9::numeric, 12::numeric, false, null),
    ('instagram',  2, 2, 14::numeric, 18::numeric, false, null),
    ('instagram',  3, 1,  9::numeric, 12::numeric, false, null),
    ('instagram',  3, 2, 14::numeric, 18::numeric, false, null),
    ('instagram',  4, 1,  9::numeric, 12::numeric, false, null),
    ('instagram',  4, 2, 14::numeric, 18::numeric, false, null),
    ('instagram',  5, 1,  9::numeric, 12::numeric, false, null),
    ('instagram',  5, 2, 14::numeric, 18::numeric, false, null),
    ('instagram',  6, 1, 10::numeric, 12::numeric, true,  'Sábado: só quem já respondeu'),
    -- Presencial: a rota da tarde (RF-CON-13, R07).
    ('presencial', 1, 1, 14::numeric, 18::numeric, false, 'Rota da tarde'),
    ('presencial', 2, 1, 14::numeric, 18::numeric, false, 'Rota da tarde'),
    ('presencial', 3, 1, 14::numeric, 18::numeric, false, 'Rota da tarde'),
    ('presencial', 4, 1, 14::numeric, 18::numeric, false, 'Rota da tarde'),
    ('presencial', 5, 1, 14::numeric, 18::numeric, false, 'Rota da tarde')
  ) as w(canal, dow, pos, de, ate, resp, nota)
 where not exists (select 1 from public.channel_windows c
                    where c.channel = w.canal::app.channel and c.dow = w.dow and c."position" = w.pos);


-- ---------------------------------------------------------------------------
-- A.3 Dia útil de operação e janela por canal
-- ---------------------------------------------------------------------------
create or replace function app.dia_util_de_operacao(p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(dow from p_at at time zone 'America/Fortaleza')::int <> 0
     and not exists (select 1 from public.holidays h
                      where h.date = (p_at at time zone 'America/Fortaleza')::date)
$$;
comment on function app.dia_util_de_operacao(timestamptz) is
  'Domingo e feriado (nacional, RN, Natal) não são dia de operação. Fuso America/Fortaleza.';

-- Já respondeu alguma vez? É o que libera o sábado do WhatsApp (RF-CON-11).
-- "Porta aberta" no catálogo de desfechos é exatamente "a pessoa interagiu".
create or replace function app.ja_respondeu(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1
                   from public.activities a
                   join public.interaction_outcomes o on o.id = a.outcome_id
                  where a.organization_id = p_organization_id
                    and o.counts_as = 'aberta'::app.door_kind)
$$;

create or replace function app.proxima_abertura_do_canal(p_dia date, p_channel app.channel,
                                                         p_respondeu boolean default false)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_dia date;
  v_de  numeric;
begin
  -- 30 dias de teto pelo mesmo motivo de app.proxima_abertura: com a `holidays`
  -- real é impossível não achar, e é melhor que um laço infinito.
  for i in 1..30 loop
    v_dia := p_dia + i;
    if exists (select 1 from public.holidays h where h.date = v_dia) then
      continue;
    end if;
    select min(w.de) into v_de
      from public.channel_windows w
     where w.channel = p_channel
       and w.dow = extract(dow from v_dia)::int
       and (p_respondeu or not w.requires_reply);
    if v_de is not null then
      return app.instante_local(v_dia, v_de);
    end if;
  end loop;
  return null;
end $$;

create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local   timestamp := p_at at time zone 'America/Fortaleza';
  v_dia     date      := v_local::date;
  v_dow     int       := extract(dow from v_local)::int;
  v_hora    numeric   := extract(hour from v_local) + extract(minute from v_local) / 60.0;
  v_feriado boolean   := exists (select 1 from public.holidays h where h.date = v_dia);
  v_ate     numeric;
  v_de      numeric;
  v_tem_dia boolean;
  v_motivo  text;
begin
  -- Ligação tem janela própria, anterior a este arquivo. Reusa, não duplica.
  if p_channel = 'phone'::app.channel then
    return app.call_window(p_at);
  end if;
  -- Canal sem janela configurada (email, other): não é canal de cadência.
  if not exists (select 1 from public.channel_windows w where w.channel = p_channel) then
    return jsonb_build_object('aberta', false, 'motivo', 'canal_sem_janela',
                              'abre_em', null, 'fecha_em', null);
  end if;

  if not v_feriado then
    -- Está dentro de alguma faixa de hoje?
    select w.ate into v_ate
      from public.channel_windows w
     where w.channel = p_channel and w.dow = v_dow
       and (p_respondeu or not w.requires_reply)
       and v_hora >= w.de and v_hora < w.ate
     order by w."position"
     limit 1;
    if v_ate is not null then
      return jsonb_build_object('aberta', true, 'motivo', null,
                                'abre_em', null,
                                'fecha_em', app.instante_local(v_dia, v_ate));
    end if;
    -- Hoje ainda abre mais tarde? (o intervalo do almoço e o "cedo demais")
    select min(w.de) into v_de
      from public.channel_windows w
     where w.channel = p_channel and w.dow = v_dow
       and (p_respondeu or not w.requires_reply)
       and w.de > v_hora;
    if v_de is not null then
      return jsonb_build_object('aberta', false, 'motivo', 'antes_da_abertura',
                                'abre_em', app.instante_local(v_dia, v_de),
                                'fecha_em', null);
    end if;
  end if;

  v_tem_dia := exists (select 1 from public.channel_windows w
                        where w.channel = p_channel and w.dow = v_dow
                          and (p_respondeu or not w.requires_reply));
  v_motivo := case
                when v_feriado     then 'feriado'
                when v_dow = 0     then 'domingo'
                when not v_tem_dia then 'dia_sem_janela'
                else                    'depois_do_fechamento'
              end;
  return jsonb_build_object('aberta', false, 'motivo', v_motivo,
                            'abre_em', app.proxima_abertura_do_canal(v_dia, p_channel, p_respondeu),
                            'fecha_em', null);
end $$;
comment on function app.janela_do_canal(app.channel, timestamptz, boolean) is
  'Janela de contato proativo do canal no instante dado (RF-CON-11), no fuso America/Fortaleza. Mesmo formato de app.call_window: {aberta, motivo, abre_em, fecha_em}. Nunca antecipa: quando fechada, devolve a PRÓXIMA abertura. `phone` delega para app.call_window.';


-- ---------------------------------------------------------------------------
-- A.4 Teto do canal no dia (RF-CON-10)
-- ---------------------------------------------------------------------------
create or replace function app.teto_do_canal(p_channel app.channel, p_dia date)
returns int
language plpgsql
stable
set search_path = ''
as $$
declare
  v      jsonb;
  v_ini  date;
  v_sem  int;
  v_teto int;
  v_duro int;
  v_key  text := p_channel::text;
begin
  select s.value into v from public.app_settings s where s.key = 'cadencia.tetos';
  if v is null or not (v ? v_key) then
    return 2147483647;   -- canal sem teto configurado não bloqueia ninguém
  end if;
  v_duro := coalesce((v -> v_key ->> 'teto_duro')::int, 2147483647);

  if p_channel = 'whatsapp'::app.channel then
    v_ini := (v ->> 'inicio')::date;
    v_sem := greatest(floor((p_dia - v_ini) / 7.0)::int, 0);
    v_teto := case v_sem
                when 0 then coalesce((v -> v_key ->> 'semana1')::int, 20)
                when 1 then coalesce((v -> v_key ->> 'semana2')::int, 35)
                else        coalesce((v -> v_key ->> 'depois')::int, 45)
              end;
  else
    v_teto := coalesce((v -> v_key ->> 'padrao')::int, 2147483647);
  end if;
  return least(v_teto, v_duro);
end $$;
comment on function app.teto_do_canal(app.channel, date) is
  'Teto de toques do canal naquele dia (RF-CON-10). WhatsApp sobe por semana de aquecimento a partir de app_settings->cadencia.tetos->inicio, sempre limitado pelo teto duro.';

-- plpgsql, e não sql, de propósito: esta função nasce ANTES de
-- `public.cadence_touches` no arquivo (a porteira precisa dela) e o plpgsql
-- resolve o nome só na execução.
create or replace function app.toques_do_dia(p_channel app.channel, p_dia date)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n int;
begin
  -- Conta os toques de cadência AGENDADOS ou FEITOS naquele dia naquele canal.
  -- Toque pulado e cancelado não consomem teto: não houve contato.
  -- NOTA para quando a fila assistida do RF-CON-08 existir: os envios feitos
  -- FORA da cadência precisarão ser somados aqui, porque o teto do RF-CON-10 é
  -- do NÚMERO, não da cadência.
  select count(*)::int into n
    from public.cadence_touches t
   where t.channel = p_channel
     and t.status in ('pendente'::app.touch_status, 'feito'::app.touch_status)
     and (t.due_at at time zone 'America/Fortaleza')::date = p_dia;
  return n;
end $$;


-- ===========================================================================
-- B. A FUNÇÃO PORTEIRA
-- ===========================================================================
create or replace function app.pode_tocar(p_org uuid,
                                          p_contact uuid,
                                          p_channel app.channel,
                                          p_quando timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quando    timestamptz := coalesce(p_quando, now());
  v_cooldown  timestamptz;
  v_ultima    timestamptz;
  v_reativa   boolean;
  v_reaberto  boolean;
  v_respondeu boolean;
  v_janela    jsonb;
  v_dia       date;
  v_teto      int;
  v_usados    int;
  v_prox      date;
begin
  -- 1 · Supressão. Não adia, não reagenda: ENCERRA. É o guardrail do CLAUDE.md
  --     e vale em qualquer canal e em qualquer modo.
  if app.is_suppressed_target(p_org, p_contact) then
    return jsonb_build_object('pode', false, 'quando', null, 'motivo', 'suprimido');
  end if;

  -- 2 · Cooldown (RF-FUN-13): piso de espera lido do catálogo de desfechos.
  --     É FILTRO DE ENTRADA — quando vencer, o alvo volta a ser elegível; ele
  --     nunca dispara nada por conta própria. Usa o MÁXIMO sobre todas as
  --     atividades, não só a última: um "sem interesse" de 90 dias não pode ser
  --     apagado por um "não atendeu" de 1 dia registrado depois.
  select max(a.occurred_at + make_interval(days => o.cooldown_days))
    into v_cooldown
    from public.activities a
    join public.interaction_outcomes o on o.id = a.outcome_id
    left join public.deals d on d.id = a.deal_id
   where coalesce(a.organization_id, d.organization_id) = p_org;
  if v_cooldown is not null and v_quando < v_cooldown then
    return jsonb_build_object('pode', false, 'quando', v_cooldown, 'motivo', 'cooldown');
  end if;

  -- 3 · Último desfecho não reativável → encerra. Só volta por decisão humana
  --     registrada com motivo (é a mesma leitura de v_contact_cooldown:
  --     alguém tirou o negócio da etapa de perda, com motivo, depois daquilo).
  select o.can_reactivate, a.occurred_at
    into v_reativa, v_ultima
    from public.activities a
    join public.interaction_outcomes o on o.id = a.outcome_id
    left join public.deals d on d.id = a.deal_id
   where coalesce(a.organization_id, d.organization_id) = p_org
   order by a.occurred_at desc, a.created_at desc, a.id desc
   limit 1;
  if v_reativa is not null and not v_reativa then
    v_reaberto := exists (
      select 1
        from public.deal_stage_history h
        join public.deals  dd on dd.id = h.deal_id
        join public.stages sd on sd.id = h.from_stage_id
        join public.stages sp on sp.id = h.to_stage_id
       where dd.organization_id = p_org
         and h.changed_at > v_ultima
         and h.changed_by is not null
         and h.reason is not null
         and sd.is_lost and not sd.is_optout and not sp.is_lost);
    if not v_reaberto then
      return jsonb_build_object('pode', false, 'quando', null, 'motivo', 'nao_reativavel');
    end if;
  end if;

  -- 4 · Janela do canal, em America/Fortaleza, empurrando para a PRÓXIMA
  --     abertura (nunca antecipando). 5 · Domingo e feriado já saem daqui,
  --     porque `app.call_window` e `app.janela_do_canal` os bloqueiam e devolvem
  --     `abre_em` pela próxima abertura.
  v_respondeu := app.ja_respondeu(p_org);
  v_janela := app.janela_do_canal(p_channel, v_quando, v_respondeu);
  if not coalesce((v_janela ->> 'aberta')::boolean, false) then
    return jsonb_build_object('pode', false,
                              'quando', (v_janela ->> 'abre_em')::timestamptz,
                              'motivo', 'janela_' || coalesce(v_janela ->> 'motivo', 'fechada'));
  end if;

  -- 6 · Teto do canal no dia (RF-CON-10). O excedente ATRASA, nunca duplica.
  v_dia    := (v_quando at time zone 'America/Fortaleza')::date;
  v_teto   := app.teto_do_canal(p_channel, v_dia);
  v_usados := app.toques_do_dia(p_channel, v_dia);
  if v_usados >= v_teto then
    v_prox := app.next_business_day(v_dia, 1);
    return jsonb_build_object(
      'pode', false,
      'quando', coalesce(
        case when p_channel = 'phone'::app.channel
             then app.proxima_abertura(v_dia)
             else app.proxima_abertura_do_canal(v_dia, p_channel, v_respondeu) end,
        (v_prox + time '09:00') at time zone 'America/Fortaleza'),
      'motivo', 'teto_do_canal');
  end if;

  -- 7 · A condição do passo e os tiers NÃO cabem aqui: esta função não conhece
  --     passo. Quem os avalia — e marca o toque como `pulado` — é
  --     `app.abrir_proximo_toque`, logo antes de chamar esta porteira.
  return jsonb_build_object('pode', true, 'quando', v_quando, 'motivo', null);
end $$;
comment on function app.pode_tocar(uuid, uuid, app.channel, timestamptz) is
  'A porteira das cadências. Devolve {pode, quando, motivo}. Ordem: supressão (encerra) → cooldown (adia) → não reativável (encerra) → janela do canal (adia) → feriado/domingo (adia) → teto do canal (adia). Motivo "suprimido" e "nao_reativavel" vêm com quando = null: quem chama tem de ENCERRAR a matrícula, não reagendar.';


-- ===========================================================================
-- C. CADÊNCIAS, PASSOS, MATRÍCULAS E TOQUES
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- C.1 Cadências e passos
-- ---------------------------------------------------------------------------
create table if not exists public.cadences (
  id                     serial primary key,
  slug                   text not null unique check (slug ~ '^[a-z0-9_]+$'),
  name                   text not null check (length(trim(name)) between 3 and 60),
  pipeline_slug          text not null default 'fornecedor',
  is_active              boolean not null default true,
  max_touches            smallint not null default 5 check (max_touches between 1 and 12),
  limite_dias            smallint not null default 14 check (limite_dias between 1 and 180),
  end_stage_slug         text check (end_stage_slug is null or end_stage_slug ~ '^[a-z0-9_]+$'),
  requires_gancho        boolean not null default false,
  requires_authorization boolean not null default false,
  entry_note             text,
  description            text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
comment on table public.cadences is
  'Sequência de toques (RF-CON-13..17). A cadência não envia nada: ela agenda tarefas para gente executar (ADR-05).';
comment on column public.cadences.limite_dias is
  'Dias corridos desde a matrícula até o encerramento por silêncio (D+14 na régua padrão, RF-CON-13).';
comment on column public.cadences.end_stage_slug is
  'Etapa para onde o negócio vai quando a cadência encerra por silêncio — SEM mandar nada.';
comment on column public.cadences.requires_gancho is
  'Reativação (RF-CON-15) não nasce sozinha: exige gancho preenchido por gente. O banco recusa matrícula sem ele.';
comment on column public.cadences.requires_authorization is
  'Onboarding (RF-CON-16) exige consent_events.kind = data_use_authorized vigente. O banco recusa matrícula sem ela.';

create table if not exists public.cadence_steps (
  id                serial primary key,
  cadence_id        int not null references public.cadences(id) on delete cascade,
  "position"        smallint not null check ("position" between 1 and 12),
  channel           app.channel not null,
  task_kind         app.task_kind not null,
  delay_days        smallint not null default 0 check (delay_days between 0 and 120),
  delay_from        text not null default 'passo_anterior'
                      check (delay_from in ('matricula', 'passo_anterior', 'data_combinada')),
  title             text not null check (length(trim(title)) between 3 and 120),
  template_code     text references public.message_templates(template_code) on update cascade,
  audio_slug        text references public.audio_assets(slug) on update cascade,
  condition         jsonb not null default '{}'::jsonb,
  tiers             text[] not null default '{}'::text[],
  window_hint       text,
  is_last_automatic boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (cadence_id, "position"),
  constraint cadence_steps_tiers check (tiers <@ array['A+', 'A', 'B', 'C']::text[]),
  -- R06 WA-13: áudio só no WhatsApp, e nunca sem o texto que o resume.
  constraint cadence_steps_audio check (
    audio_slug is null or (channel = 'whatsapp'::app.channel and template_code is not null))
);
comment on table public.cadence_steps is
  'Um toque da cadência. O CANAL É ATRIBUTO DO PASSO (R13 §7): é isto que deixa a ligação vir primeiro e o WhatsApp virar apoio.';
comment on column public.cadence_steps.condition is
  'Condição de execução, vocabulário fechado validado por gatilho. Não bate → o toque nasce PULADO e a cadência avança.';
comment on column public.cadence_steps.delay_from is
  'matricula = D+n desde a matrícula; passo_anterior = D+n desde o toque anterior resolvido; data_combinada = lê deals.next_action_at.';

-- Vocabulário fechado da condição. Chave desconhecida é erro de migração, não
-- silêncio em produção.
create or replace function app.cadence_steps_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k         text;
  v_perm    text[] := array['tem_telefone', 'tem_instagram', 'bairro_geocodificado',
                            'ultimo_desfecho_em', 'sem_resposta', 'claim_link_aberto',
                            'reivindicado', 'tem_gancho'];
  v_ant_aud text;
begin
  if jsonb_typeof(new.condition) <> 'object' then
    raise exception 'cadence_steps.condition tem de ser objeto JSON.' using errcode = '23514';
  end if;
  for k in select jsonb_object_keys(new.condition) loop
    if not (k = any (v_perm)) then
      raise exception 'Condição desconhecida "%" no passo % (permitidas: %).',
        k, new."position", array_to_string(v_perm, ', ') using errcode = '23514';
    end if;
  end loop;
  if new.condition ? 'ultimo_desfecho_em' then
    if jsonb_typeof(new.condition -> 'ultimo_desfecho_em') <> 'array' then
      raise exception 'ultimo_desfecho_em tem de ser lista de slugs de desfecho.' using errcode = '23514';
    end if;
    if exists (select 1
                 from jsonb_array_elements_text(new.condition -> 'ultimo_desfecho_em') s
                where not exists (select 1 from public.interaction_outcomes o where o.slug = s)) then
      raise exception 'ultimo_desfecho_em cita desfecho que não existe no catálogo.' using errcode = '23503';
    end if;
  end if;
  -- Nunca dois áudios seguidos (RF-CON-24).
  if new.audio_slug is not null then
    select s.audio_slug into v_ant_aud
      from public.cadence_steps s
     where s.cadence_id = new.cadence_id and s."position" = new."position" - 1;
    if v_ant_aud is not null then
      raise exception 'Dois áudios seguidos na cadência % (passos % e %). RF-CON-24 proíbe.',
        new.cadence_id, new."position" - 1, new."position" using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cadence_steps_validate on public.cadence_steps;
create trigger cadence_steps_validate
  before insert or update on public.cadence_steps
  for each row execute function app.cadence_steps_validate();

drop trigger if exists cadences_set_updated_at on public.cadences;
create trigger cadences_set_updated_at
  before update on public.cadences
  for each row execute function app.set_updated_at();

drop trigger if exists audit_cadences on public.cadences;
create trigger audit_cadences
  after insert or update or delete on public.cadences
  for each row execute function app.audit();

drop trigger if exists audit_cadence_steps on public.cadence_steps;
create trigger audit_cadence_steps
  after insert or update or delete on public.cadence_steps
  for each row execute function app.audit();


-- ---------------------------------------------------------------------------
-- C.2 Matrículas e toques
-- ---------------------------------------------------------------------------
create table if not exists public.cadence_enrollments (
  id               uuid primary key default gen_random_uuid(),
  cadence_id       int  not null references public.cadences(id),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  deal_id          uuid references public.deals(id) on delete set null,
  contact_id       uuid references public.contacts(id) on delete set null,
  assignee_id      uuid references public.profiles(id) on delete set null,
  status           app.cadence_status not null default 'ativa',
  current_position smallint not null default 0 check (current_position between 0 and 12),
  next_due_at      timestamptz,
  gancho           text,
  enrolled_at      timestamptz not null default now(),
  ended_at         timestamptz,
  end_reason       text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint cadence_enrollments_fim check (
    (status in ('ativa', 'pausada') and ended_at is null)
    or (status in ('concluida', 'encerrada') and ended_at is not null
        and length(trim(coalesce(end_reason, ''))) > 0))
);
comment on table public.cadence_enrollments is
  'Uma organização em uma cadência. Índice único parcial garante NO MÁXIMO UMA matrícula ativa por organização.';

-- Uma cadência ativa por organização — regra dura, declarativa.
create unique index if not exists cadence_enrollments_uma_ativa
  on public.cadence_enrollments (organization_id)
  where status = 'ativa';
create index if not exists cadence_enrollments_due_idx
  on public.cadence_enrollments (next_due_at)
  where status = 'ativa';
create index if not exists cadence_enrollments_org_idx
  on public.cadence_enrollments (organization_id, status);
create index if not exists cadence_enrollments_assignee_idx
  on public.cadence_enrollments (assignee_id);
create index if not exists cadence_enrollments_cadence_idx
  on public.cadence_enrollments (cadence_id);
create index if not exists cadence_enrollments_deal_idx
  on public.cadence_enrollments (deal_id);
create index if not exists cadence_enrollments_contact_idx
  on public.cadence_enrollments (contact_id);
create index if not exists cadence_enrollments_created_by_idx
  on public.cadence_enrollments (created_by);

create table if not exists public.cadence_touches (
  id              uuid primary key default gen_random_uuid(),
  enrollment_id   uuid not null references public.cadence_enrollments(id) on delete cascade,
  step_id         int  not null references public.cadence_steps(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  channel         app.channel not null,
  "position"      smallint not null,
  task_id         uuid references public.tasks(id) on delete set null,
  activity_id     uuid references public.activities(id) on delete set null,
  status          app.touch_status not null default 'pendente',
  due_at          timestamptz not null,
  done_at         timestamptz,
  skip_reason     text,
  created_at      timestamptz not null default now(),
  constraint cadence_touches_pendente_sem_fecho check (
    status <> 'pendente'::app.touch_status or (done_at is null and activity_id is null)),
  constraint cadence_touches_pulado_com_motivo check (
    status <> 'pulado'::app.touch_status or length(trim(coalesce(skip_reason, ''))) > 0)
);
comment on table public.cadence_touches is
  'O toque: a entidade que fica ACIMA da atividade. Chamada e atividade seguem como estão; o toque se resolve quando elas acontecem.';

-- AS DUAS REGRAS DURAS, declarativas:
--   um pendente por matrícula …
create unique index if not exists cadence_touches_um_pendente
  on public.cadence_touches (enrollment_id)
  where status = 'pendente';
--   … e um pendente por ORGANIZAÇÃO, em qualquer canal e em qualquer matrícula.
--   É esta segunda que fecha o buraco entre matrículas e torna impossível a
--   fila se auto-alimentar.
create unique index if not exists cadence_touches_um_pendente_por_org
  on public.cadence_touches (organization_id)
  where status = 'pendente';
create index if not exists cadence_touches_due_idx
  on public.cadence_touches (due_at) where status = 'pendente';
create index if not exists cadence_touches_task_idx  on public.cadence_touches (task_id);
create index if not exists cadence_touches_step_idx  on public.cadence_touches (step_id);
create index if not exists cadence_touches_act_idx   on public.cadence_touches (activity_id);
create index if not exists cadence_touches_canal_idx
  on public.cadence_touches (channel, due_at);

drop trigger if exists cadence_enrollments_set_updated_at on public.cadence_enrollments;
create trigger cadence_enrollments_set_updated_at
  before update on public.cadence_enrollments
  for each row execute function app.set_updated_at();

drop trigger if exists audit_cadence_enrollments on public.cadence_enrollments;
create trigger audit_cadence_enrollments
  after insert or update or delete on public.cadence_enrollments
  for each row execute function app.audit();

drop trigger if exists audit_cadence_touches on public.cadence_touches;
create trigger audit_cadence_touches
  after insert or update or delete on public.cadence_touches
  for each row execute function app.audit();


-- ---------------------------------------------------------------------------
-- C.3 Os gatilhos-guarda (o guardrail que vale por psql)
-- ---------------------------------------------------------------------------
create or replace function app.cadence_enrollments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c public.cadences%rowtype;
begin
  select * into c from public.cadences where id = new.cadence_id;
  if not found then
    raise exception 'Cadência % não existe.', new.cadence_id using errcode = '23503';
  end if;

  if tg_op = 'INSERT' or new.status = 'ativa'::app.cadence_status then
    -- Guardrail do CLAUDE.md: nenhuma cadência nasce nem revive para alvo suprimido.
    if app.is_suppressed_target(new.organization_id, new.contact_id) then
      raise exception 'Contato suprimido: nenhuma cadência entra aqui (do_not_contact / suppression_list).'
        using errcode = '42501';
    end if;
    -- Reativação exige gancho de gente (RF-CON-15).
    if c.requires_gancho and length(trim(coalesce(new.gancho, ''))) = 0 then
      raise exception 'A cadência % exige gancho preenchido por gente (RF-CON-15).', c.slug
        using errcode = '23514';
    end if;
    -- Onboarding exige autorização registrada (RF-PRE-06, guardrail do CLAUDE.md).
    if c.requires_authorization and not app.tem_autorizacao_vigente(new.organization_id) then
      raise exception 'A cadência % exige consent_events.data_use_authorized vigente (RF-PRE-06).', c.slug
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Autorização vigente = existe `data_use_authorized` e não veio revogação depois.
create or replace function app.tem_autorizacao_vigente(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.consent_events e
     where e.organization_id = p_organization_id
       and e.kind = 'data_use_authorized'::app.consent_kind
       and not exists (
         select 1 from public.consent_events r
          where r.organization_id = p_organization_id
            and r.kind in ('data_use_revoked'::app.consent_kind,
                           'erasure_request'::app.consent_kind,
                           'erasure_done'::app.consent_kind)
            and r.occurred_at > e.occurred_at))
$$;
comment on function app.tem_autorizacao_vigente(uuid) is
  'Autorização de uso de dados registrada e não revogada depois (RF-PRE-06). Pré-requisito do pré-cadastro e da cadência de onboarding.';

drop trigger if exists cadence_enrollments_guard on public.cadence_enrollments;
create trigger cadence_enrollments_guard
  before insert or update on public.cadence_enrollments
  for each row execute function app.cadence_enrollments_guard();


create or replace function app.cadence_touches_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  e public.cadence_enrollments%rowtype;
begin
  select * into e from public.cadence_enrollments where id = new.enrollment_id;
  if not found then
    raise exception 'Matrícula % não existe.', new.enrollment_id using errcode = '23503';
  end if;
  if new.organization_id is distinct from e.organization_id then
    raise exception 'O toque tem de ser da mesma organização da matrícula.' using errcode = '23514';
  end if;

  if new.status = 'pendente'::app.touch_status then
    -- Guardrail: toque pendente nunca nasce para alvo suprimido.
    if app.is_suppressed_target(new.organization_id, new.contact_id) then
      raise exception 'Contato suprimido: nenhum toque pendente nasce para ele.' using errcode = '42501';
    end if;
    if e.status <> 'ativa'::app.cadence_status then
      raise exception 'Matrícula % não está ativa: não cria toque pendente.', e.id using errcode = '23514';
    end if;
    -- A regra dura, também em gatilho (mensagem legível; o índice único é a
    -- garantia). Vale ENTRE matrículas: um toque pendente por contato, em
    -- qualquer canal.
    if exists (select 1
                 from public.cadence_touches t
                where t.organization_id = new.organization_id
                  and t.status = 'pendente'::app.touch_status
                  and (tg_op = 'INSERT' or t.id <> new.id)) then
      raise exception 'Já existe toque pendente para esta organização. Um toque por vez, em qualquer canal.'
        using errcode = '23505';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cadence_touches_guard on public.cadence_touches;
create trigger cadence_touches_guard
  before insert or update on public.cadence_touches
  for each row execute function app.cadence_touches_guard();


-- ---------------------------------------------------------------------------
-- C.4 Guardrail nas tarefas: nenhuma tarefa DE CONTATO para alvo suprimido
-- ---------------------------------------------------------------------------
-- Vale para toda tarefa, venha da cadência, do registro de contato, da tela ou
-- do psql. Só `other` escapa, porque é onde moram as tarefas de LGPD (responder
-- titular, apagar dado) que PRECISAM existir justamente para quem foi suprimido.
create or replace function app.tasks_guard_suppressed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_abre boolean;
begin
  if new.status not in ('todo'::app.task_status, 'doing'::app.task_status) then
    return new;
  end if;
  if new.kind = 'other'::app.task_kind then
    return new;
  end if;
  if new.organization_id is null and new.contact_id is null then
    return new;
  end if;
  -- Em UPDATE só interessa quando a tarefa está sendo (re)aberta ou apontada
  -- para outro alvo: fechar, cancelar e mexer no título de uma tarefa antiga
  -- não pode travar (o app.consent_apply cancela em massa no opt-out).
  v_abre := tg_op = 'INSERT'
            or old.status not in ('todo'::app.task_status, 'doing'::app.task_status)
            or new.organization_id is distinct from old.organization_id
            or new.contact_id      is distinct from old.contact_id;
  if not v_abre then
    return new;
  end if;
  if app.is_suppressed_target(new.organization_id, new.contact_id) then
    raise exception 'Contato suprimido: nenhuma tarefa de contato nasce ou reabre para ele (CLAUDE.md, RF-CON-18).'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- `zz_` no nome para rodar DEPOIS de app.tasks_before_write (gatilhos disparam
-- em ordem alfabética), que é quem normaliza status e completed_at.
drop trigger if exists zz_tasks_guard_suppressed on public.tasks;
create trigger zz_tasks_guard_suppressed
  before insert or update on public.tasks
  for each row execute function app.tasks_guard_suppressed();


-- ---------------------------------------------------------------------------
-- C.5 Condição do passo
-- ---------------------------------------------------------------------------
create or replace function app.condicao_do_passo(p_step_id int, p_enrollment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s        public.cadence_steps%rowtype;
  e        public.cadence_enrollments%rowtype;
  o        public.organizations%rowtype;
  v_tier   text;
  v_ult    text;
  -- Sem %ROWTYPE de pre_registrations: esta função nasce ANTES daquela tabela
  -- no arquivo, e o plpgsql valida declaração na criação.
  v_aberto timestamptz;
  v_claim  timestamptz;
  v_falha  text;
begin
  select * into s from public.cadence_steps       where id = p_step_id;
  select * into e from public.cadence_enrollments where id = p_enrollment_id;
  select * into o from public.organizations       where id = e.organization_id;

  if cardinality(s.tiers) > 0 then
    select d.tier into v_tier from public.deals d
     where d.id = e.deal_id
        or (e.deal_id is null and d.organization_id = e.organization_id and d.status = 'open')
     order by d.created_at limit 1;
    if v_tier is null or not (v_tier = any (s.tiers)) then
      v_falha := 'tier';
    end if;
  end if;

  if v_falha is null and s.condition ? 'tem_telefone'
     and (o.phone_e164 is not null) <> (s.condition ->> 'tem_telefone')::boolean then
    v_falha := 'tem_telefone';
  end if;
  if v_falha is null and s.condition ? 'tem_instagram'
     and (o.instagram_handle is not null) <> (s.condition ->> 'tem_instagram')::boolean then
    v_falha := 'tem_instagram';
  end if;
  if v_falha is null and s.condition ? 'bairro_geocodificado'
     and (o.lat is not null and o.lng is not null) <> (s.condition ->> 'bairro_geocodificado')::boolean then
    v_falha := 'bairro_geocodificado';
  end if;
  if v_falha is null and s.condition ? 'sem_resposta'
     and (not app.ja_respondeu(e.organization_id)) <> (s.condition ->> 'sem_resposta')::boolean then
    v_falha := 'sem_resposta';
  end if;
  if v_falha is null and s.condition ? 'tem_gancho'
     and (length(trim(coalesce(e.gancho, ''))) > 0) <> (s.condition ->> 'tem_gancho')::boolean then
    v_falha := 'tem_gancho';
  end if;
  if v_falha is null and s.condition ? 'ultimo_desfecho_em' then
    select oc.slug into v_ult
      from public.activities a
      join public.interaction_outcomes oc on oc.id = a.outcome_id
     where a.organization_id = e.organization_id
     order by a.occurred_at desc, a.created_at desc, a.id desc
     limit 1;
    if v_ult is null
       or not exists (select 1 from jsonb_array_elements_text(s.condition -> 'ultimo_desfecho_em') x
                       where x = v_ult) then
      v_falha := 'ultimo_desfecho_em';
    end if;
  end if;
  if v_falha is null and (s.condition ? 'claim_link_aberto' or s.condition ? 'reivindicado') then
    execute 'select p.claim_link_opened_at, p.claimed_at from public.pre_registrations p'
            || ' where p.organization_id = $1'
      into v_aberto, v_claim using e.organization_id;
    if s.condition ? 'claim_link_aberto'
       and (v_aberto is not null) <> (s.condition ->> 'claim_link_aberto')::boolean then
      v_falha := 'claim_link_aberto';
    elsif s.condition ? 'reivindicado'
       and (v_claim is not null) <> (s.condition ->> 'reivindicado')::boolean then
      v_falha := 'reivindicado';
    end if;
  end if;

  return jsonb_build_object('bate', v_falha is null, 'motivo', v_falha);
end $$;


-- ---------------------------------------------------------------------------
-- C.6 Encerrar (uso interno) e o motor
-- ---------------------------------------------------------------------------
create or replace function app.encerrar_matricula(p_enrollment uuid, p_motivo text,
                                                  p_status app.cadence_status default 'encerrada')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Cancela o toque pendente ANTES de mexer na tarefa: assim o gatilho
  -- zz_cadence_on_task não tem mais o que resolver e não há corrida.
  update public.cadence_touches t
     set status = 'cancelado'::app.touch_status
   where t.enrollment_id = p_enrollment
     and t.status = 'pendente'::app.touch_status;

  update public.tasks tk
     set status = 'cancelled'::app.task_status
    from public.cadence_touches t
   where t.enrollment_id = p_enrollment
     and t.task_id = tk.id
     and tk.status in ('todo'::app.task_status, 'doing'::app.task_status);

  update public.cadence_enrollments e
     set status      = p_status,
         ended_at    = now(),
         end_reason  = left(coalesce(nullif(trim(p_motivo), ''), 'sem_motivo'), 200),
         next_due_at = null
   where e.id = p_enrollment
     and e.status in ('ativa'::app.cadence_status, 'pausada'::app.cadence_status);
end $$;

-- O motor. Abre o PRÓXIMO toque de uma matrícula — e só isso. Nunca envia,
-- nunca cria dois, nunca cria um se o anterior segue pendente.
create or replace function app.abrir_proximo_toque(p_enrollment uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e         public.cadence_enrollments%rowtype;
  c         public.cadences%rowtype;
  s         public.cadence_steps%rowtype;
  v_pos     smallint;
  v_base    timestamptz;
  v_due     timestamptz;
  v_cond    jsonb;
  v_p       jsonb;
  v_task    uuid;
  v_touch   uuid;
  v_dono    uuid;
  v_deal    public.deals%rowtype;
begin
  select * into e from public.cadence_enrollments where id = p_enrollment for update;
  if not found or e.status <> 'ativa'::app.cadence_status then
    return jsonb_build_object('acao', 'nada', 'motivo', 'matricula_inativa');
  end if;
  select * into c from public.cadences where id = e.cadence_id;

  -- Um toque pendente já é o trabalho desta matrícula. Nada nasce por cima.
  if exists (select 1 from public.cadence_touches t
              where t.enrollment_id = e.id and t.status = 'pendente'::app.touch_status) then
    return jsonb_build_object('acao', 'nada', 'motivo', 'toque_pendente');
  end if;
  -- Nem por cima de toque pendente de OUTRA matrícula da mesma organização.
  if exists (select 1 from public.cadence_touches t
              where t.organization_id = e.organization_id
                and t.status = 'pendente'::app.touch_status) then
    return jsonb_build_object('acao', 'nada', 'motivo', 'toque_pendente_na_organizacao');
  end if;

  -- Silêncio: passou o limite da cadência → encerra e move, SEM mandar nada.
  if now() > e.enrolled_at + make_interval(days => c.limite_dias) then
    perform app.encerrar_por_silencio(e.id);
    return jsonb_build_object('acao', 'encerrada', 'motivo', 'silencio');
  end if;

  v_pos := e.current_position;
  -- Até 12 voltas: cada uma ou pula um passo que não bate, ou decide e sai.
  for i in 1..12 loop
    v_pos := (v_pos + 1)::smallint;
    select * into s from public.cadence_steps
     where cadence_id = e.cadence_id and "position" = v_pos;
    if not found then
      perform app.encerrar_matricula(e.id, 'fim_da_cadencia', 'concluida'::app.cadence_status);
      return jsonb_build_object('acao', 'concluida', 'motivo', 'fim_da_cadencia');
    end if;
    if v_pos > c.max_touches then
      perform app.encerrar_matricula(e.id, 'max_toques', 'concluida'::app.cadence_status);
      return jsonb_build_object('acao', 'concluida', 'motivo', 'max_toques');
    end if;

    -- Quando o toque vence.
    v_base := case s.delay_from
                when 'matricula' then e.enrolled_at
                when 'data_combinada' then coalesce(
                  (select d.next_action_at from public.deals d
                    where d.id = e.deal_id
                       or (e.deal_id is null and d.organization_id = e.organization_id
                           and d.status = 'open')
                    order by d.created_at limit 1),
                  e.enrolled_at)
                else coalesce(
                  (select coalesce(t.done_at, t.due_at) from public.cadence_touches t
                    where t.enrollment_id = e.id and t.status <> 'cancelado'::app.touch_status
                    order by t."position" desc limit 1),
                  e.enrolled_at)
              end;
    v_due := v_base + make_interval(days => s.delay_days);

    if v_due > now() then
      update public.cadence_enrollments set next_due_at = v_due where id = e.id;
      return jsonb_build_object('acao', 'agendado', 'quando', v_due, 'passo', v_pos);
    end if;

    -- Condição e tiers: não bate → PULA (o toque fica registrado como pulado) e
    -- a cadência avança na mesma volta.
    v_cond := app.condicao_do_passo(s.id, e.id);
    if not (v_cond ->> 'bate')::boolean then
      insert into public.cadence_touches
        (enrollment_id, step_id, organization_id, contact_id, channel, "position",
         status, due_at, done_at, skip_reason)
      values (e.id, s.id, e.organization_id, e.contact_id, s.channel, v_pos,
              'pulado'::app.touch_status, v_due, now(),
              'condicao:' || coalesce(v_cond ->> 'motivo', 'nao_bate'));
      update public.cadence_enrollments set current_position = v_pos where id = e.id;
      continue;
    end if;

    -- A porteira.
    v_p := app.pode_tocar(e.organization_id, e.contact_id, s.channel, greatest(v_due, now()));
    if not (v_p ->> 'pode')::boolean then
      if (v_p ->> 'motivo') in ('suprimido', 'nao_reativavel') then
        perform app.encerrar_matricula(e.id, v_p ->> 'motivo');
        return jsonb_build_object('acao', 'encerrada', 'motivo', v_p ->> 'motivo');
      end if;
      if (v_p ->> 'quando') is null then
        perform app.encerrar_matricula(e.id, 'sem_janela:' || coalesce(v_p ->> 'motivo', '?'));
        return jsonb_build_object('acao', 'encerrada', 'motivo', 'sem_janela');
      end if;
      update public.cadence_enrollments
         set next_due_at = (v_p ->> 'quando')::timestamptz
       where id = e.id;
      return jsonb_build_object('acao', 'adiado', 'quando', (v_p ->> 'quando')::timestamptz,
                                'motivo', v_p ->> 'motivo', 'passo', v_pos);
    end if;

    -- Passou. Nasce UMA tarefa (é o trabalho de gente) e UM toque (é o registro
    -- do compromisso). Nada é enviado aqui.
    select d.* into v_deal from public.deals d
     where d.id = e.deal_id
        or (e.deal_id is null and d.organization_id = e.organization_id and d.status = 'open')
     order by d.created_at limit 1;
    v_dono := coalesce(e.assignee_id, v_deal.owner_id,
                       (select o.owner_id from public.organizations o where o.id = e.organization_id));

    insert into public.tasks (title, kind, due_at, assignee_id, organization_id,
                              deal_id, contact_id, origin, priority)
    values (left(s.title, 200), s.task_kind, (v_p ->> 'quando')::timestamptz, v_dono,
            e.organization_id, v_deal.id, e.contact_id, 'cadence',
            case when s.channel = 'phone'::app.channel then 1 else 2 end)
    returning id into v_task;

    insert into public.cadence_touches
      (enrollment_id, step_id, organization_id, contact_id, channel, "position",
       task_id, status, due_at)
    values (e.id, s.id, e.organization_id, e.contact_id, s.channel, v_pos,
            v_task, 'pendente'::app.touch_status, (v_p ->> 'quando')::timestamptz)
    returning id into v_touch;

    update public.cadence_enrollments
       set current_position = v_pos, next_due_at = null
     where id = e.id;

    return jsonb_build_object('acao', 'toque_criado', 'toque', v_touch, 'task_id', v_task,
                              'passo', v_pos, 'canal', s.channel::text,
                              'quando', (v_p ->> 'quando')::timestamptz);
  end loop;

  perform app.encerrar_matricula(e.id, 'passos_esgotados', 'concluida'::app.cadence_status);
  return jsonb_build_object('acao', 'concluida', 'motivo', 'passos_esgotados');
end $$;
comment on function app.abrir_proximo_toque(uuid) is
  'O motor da cadência: abre o PRÓXIMO toque de uma matrícula. Nunca envia nada, nunca cria dois e nunca cria um enquanto o anterior estiver pendente.';


-- Encerrar por silêncio: D+14 sem resposta → nutrição, SEM mandar nada
-- (RF-CON-13). A flag de sessão evita que o gatilho de mudança de etapa
-- interprete o nosso próprio movimento como "mudança manual".
create or replace function app.encerrar_por_silencio(p_enrollment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e      public.cadence_enrollments%rowtype;
  c      public.cadences%rowtype;
  v_deal public.deals%rowtype;
  v_st   public.stages%rowtype;
begin
  select * into e from public.cadence_enrollments where id = p_enrollment;
  if not found then
    return;
  end if;
  select * into c from public.cadences where id = e.cadence_id;

  perform set_config('app.cadencia', 'on', true);
  perform app.encerrar_matricula(e.id, 'silencio');

  if c.end_stage_slug is not null then
    select d.* into v_deal from public.deals d
     where d.id = e.deal_id
        or (e.deal_id is null and d.organization_id = e.organization_id and d.status = 'open')
     order by d.created_at limit 1;
    if v_deal.id is not null then
      select * into v_st from app.stage_for(v_deal.pipeline_id, c.end_stage_slug);
      if found and v_st.id <> v_deal.stage_id then
        update public.deals d
           set stage_id = v_st.id,
               stage_change_reason = 'Cadência ' || c.slug || ' encerrada por silêncio (RF-CON-13)'
         where d.id = v_deal.id;
      end if;
    end if;
  end if;
  perform set_config('app.cadencia', 'off', true);
end $$;


-- ---------------------------------------------------------------------------
-- C.7 Resolução do toque: as pontes com o que já existe
-- ---------------------------------------------------------------------------
-- A atividade acontece → o toque se resolve. E, se a atividade foi RESPOSTA
-- (porta aberta), desfecho não reativável ou opt-out, a cadência PARA
-- (RF-CON-18).
create or replace function app.cadence_on_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enr    uuid;
  v_org    uuid;
  o        public.interaction_outcomes%rowtype;
  v_parar  text;
begin
  v_org := new.organization_id;
  if v_org is null and new.deal_id is not null then
    select d.organization_id into v_org from public.deals d where d.id = new.deal_id;
  end if;
  if v_org is null then
    return new;
  end if;

  update public.cadence_touches t
     set status      = 'feito'::app.touch_status,
         done_at     = new.occurred_at,
         activity_id = new.id
   where t.organization_id = v_org
     and t.status = 'pendente'::app.touch_status
  returning t.enrollment_id into v_enr;

  if new.outcome_id is not null then
    select * into o from public.interaction_outcomes where id = new.outcome_id;
    v_parar := case
                 when o.counts_as = 'aberta'::app.door_kind then 'resposta'
                 when not o.can_reactivate                  then 'nao_reativavel'
                 else null
               end;
  end if;

  if v_parar is not null then
    -- Para TODA cadência ativa da organização, não só a do toque: a resposta é
    -- do parceiro, não da campanha (RF-CON-18).
    perform app.encerrar_matricula(en.id, v_parar)
       from public.cadence_enrollments en
      where en.organization_id = v_org
        and en.status = 'ativa'::app.cadence_status;
  elsif v_enr is not null then
    update public.cadence_enrollments set next_due_at = now() where id = v_enr;
  end if;
  return new;
end $$;

drop trigger if exists zz_cadence_on_activity on public.activities;
create trigger zz_cadence_on_activity
  after insert on public.activities
  for each row execute function app.cadence_on_activity();


-- A tarefa foi concluída ou cancelada → o toque se resolve. É a porta para quem
-- trabalha pelo "Meu dia" sem passar pelo registro de contato.
create or replace function app.cadence_on_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enr uuid;
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status = 'done'::app.task_status then
    update public.cadence_touches t
       set status = 'feito'::app.touch_status, done_at = coalesce(new.completed_at, now())
     where t.task_id = new.id and t.status = 'pendente'::app.touch_status
    returning t.enrollment_id into v_enr;
  elsif new.status = 'cancelled'::app.task_status then
    update public.cadence_touches t
       set status = 'pulado'::app.touch_status, done_at = now(),
           skip_reason = 'tarefa_cancelada'
     where t.task_id = new.id and t.status = 'pendente'::app.touch_status
    returning t.enrollment_id into v_enr;
  end if;
  if v_enr is not null then
    update public.cadence_enrollments set next_due_at = now()
     where id = v_enr and status = 'ativa'::app.cadence_status;
  end if;
  return new;
end $$;

drop trigger if exists zz_cadence_on_task on public.tasks;
create trigger zz_cadence_on_task
  after update of status on public.tasks
  for each row execute function app.cadence_on_task();


-- Mudança de etapa para a cadência (RF-CON-18). A flag `app.cadencia` marca os
-- movimentos que a PRÓPRIA cadência fez, para não se encerrar sozinha.
create or replace function app.cadence_on_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('app.cadencia', true), ''), 'off') = 'on' then
    return new;
  end if;
  if new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  perform app.encerrar_matricula(en.id, 'mudanca_de_etapa')
     from public.cadence_enrollments en
    where en.organization_id = new.organization_id
      and en.status = 'ativa'::app.cadence_status;
  return new;
end $$;

drop trigger if exists zz_cadence_on_stage on public.deals;
create trigger zz_cadence_on_stage
  after update of stage_id on public.deals
  for each row execute function app.cadence_on_stage();


-- Opt-out e pedido de exclusão param tudo, em qualquer canal e qualquer modo.
create or replace function app.cadence_on_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind not in ('contact_optout'::app.consent_kind,
                      'data_use_revoked'::app.consent_kind,
                      'erasure_request'::app.consent_kind,
                      'erasure_done'::app.consent_kind) then
    return new;
  end if;
  perform app.encerrar_matricula(en.id, new.kind::text)
     from public.cadence_enrollments en
    where en.status = 'ativa'::app.cadence_status
      and (en.organization_id = new.organization_id
           or (new.contact_id is not null and en.contact_id = new.contact_id)
           or (new.contact_id is not null and en.organization_id in
                 (select oc.organization_id from public.organization_contacts oc
                   where oc.contact_id = new.contact_id)));
  return new;
end $$;

-- `zz_` para rodar depois de `consent_apply`, que é quem marca do_not_contact.
drop trigger if exists zz_cadence_on_consent on public.consent_events;
create trigger zz_cadence_on_consent
  after insert on public.consent_events
  for each row execute function app.cadence_on_consent();


-- ---------------------------------------------------------------------------
-- C.8 RPCs de cadência (SECURITY DEFINER com checagem explícita de papel)
-- ---------------------------------------------------------------------------
create or replace function public.matricular_em_cadencia(p_organization_id uuid,
                                                         p_cadence_slug text,
                                                         p_gancho text default null,
                                                         p_deal_id uuid default null,
                                                         p_assignee_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_papel app.user_role := app.role();
  c       public.cadences%rowtype;
  v_deal  public.deals%rowtype;
  v_enr   uuid;
  v_res   jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if v_papel not in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into c from public.cadences where slug = p_cadence_slug and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'cadencia_inexistente');
  end if;
  if not exists (select 1 from public.organizations o
                  where o.id = p_organization_id and o.deleted_at is null) then
    return jsonb_build_object('ok', false, 'motivo', 'organizacao_inexistente');
  end if;
  if not app.org_is_visible(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- Os guardrails devolvem recusa legível em vez de estourar exceção, porque
  -- quem chama é uma tela. O gatilho continua sendo a garantia.
  if app.is_suppressed_target(p_organization_id, null) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido');
  end if;
  if c.requires_gancho and length(trim(coalesce(p_gancho, ''))) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'gancho_obrigatorio');
  end if;
  if c.requires_authorization and not app.tem_autorizacao_vigente(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_autorizacao');
  end if;
  if exists (select 1 from public.cadence_enrollments e
              where e.organization_id = p_organization_id
                and e.status = 'ativa'::app.cadence_status) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_cadencia_ativa');
  end if;
  if exists (select 1 from public.cadence_touches t
              where t.organization_id = p_organization_id
                and t.status = 'pendente'::app.touch_status) then
    return jsonb_build_object('ok', false, 'motivo', 'toque_pendente');
  end if;

  select d.* into v_deal from public.deals d
   where d.id = p_deal_id
      or (p_deal_id is null and d.organization_id = p_organization_id and d.status = 'open')
   order by d.created_at limit 1;

  insert into public.cadence_enrollments
    (cadence_id, organization_id, deal_id, contact_id, assignee_id, gancho,
     next_due_at, created_by)
  values (c.id, p_organization_id, v_deal.id, v_deal.primary_contact_id,
          coalesce(p_assignee_id, v_deal.owner_id, v_uid),
          nullif(trim(coalesce(p_gancho, '')), ''), now(), v_uid)
  returning id into v_enr;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, v_papel::text, 'MATRICULAR', 'cadence_enrollments', v_enr::text,
          jsonb_build_object('cadencia', c.slug, 'organizacao', p_organization_id,
                             'gancho', p_gancho));

  v_res := app.abrir_proximo_toque(v_enr);
  return jsonb_build_object('ok', true, 'enrollment_id', v_enr, 'cadencia', c.slug,
                            'primeiro_toque', v_res);
end $$;
comment on function public.matricular_em_cadencia(uuid, text, text, uuid, uuid) is
  'Matricula uma organização numa cadência. Recusa alvo suprimido, reativação sem gancho e onboarding sem autorização registrada. Auditada.';

create or replace function public.encerrar_cadencia(p_enrollment_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_papel app.user_role := app.role();
  e       public.cadence_enrollments%rowtype;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if v_papel not in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;
  select * into e from public.cadence_enrollments where id = p_enrollment_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'matricula_inexistente');
  end if;
  if not app.org_is_visible(e.organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if e.status not in ('ativa'::app.cadence_status, 'pausada'::app.cadence_status) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_encerrada');
  end if;

  perform app.encerrar_matricula(e.id, trim(p_motivo));

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, v_papel::text, 'ENCERRAR_CADENCIA', 'cadence_enrollments', e.id::text,
          jsonb_build_object('motivo', trim(p_motivo)));

  return jsonb_build_object('ok', true, 'enrollment_id', e.id);
end $$;

-- O que a ficha do parceiro mostra.
create or replace function public.cadencia_do_parceiro(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_res jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.org_is_visible(p_organization_id) then
    raise exception 'Sem permissão para esta organização' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'matricula', case when e.id is null then null else jsonb_build_object(
             'id', e.id, 'cadencia', c.slug, 'nome', c.name, 'status', e.status,
             'passo_atual', e.current_position, 'proximo_em', e.next_due_at,
             'gancho', e.gancho, 'matriculada_em', e.enrolled_at,
             'limite_dias', c.limite_dias, 'encerrada_em', e.ended_at,
             'motivo_do_fim', e.end_reason) end,
           'toques', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', t.id, 'passo', t."position", 'canal', t.channel,
                      'titulo', s.title, 'status', t.status, 'quando', t.due_at,
                      'feito_em', t.done_at, 'motivo_do_pulo', t.skip_reason,
                      'task_id', t.task_id, 'template', s.template_code,
                      'audio', s.audio_slug)
                      order by t."position")
               from public.cadence_touches t
               join public.cadence_steps s on s.id = t.step_id
              where t.enrollment_id = e.id), '[]'::jsonb))
    into v_res
    from public.cadence_enrollments e
    join public.cadences c on c.id = e.cadence_id
   where e.organization_id = p_organization_id
   order by (e.status = 'ativa'::app.cadence_status) desc, e.enrolled_at desc
   limit 1;

  return coalesce(v_res, jsonb_build_object('matricula', null, 'toques', '[]'::jsonb));
end $$;


-- ---------------------------------------------------------------------------
-- C.9 RLS das cadências
-- ---------------------------------------------------------------------------
alter table public.cadences           enable row level security;
alter table public.cadence_steps      enable row level security;
alter table public.cadence_enrollments enable row level security;
alter table public.cadence_touches    enable row level security;

drop policy if exists cadences_select on public.cadences;
create policy cadences_select on public.cadences
  for select to authenticated using (true);
drop policy if exists cadences_insert on public.cadences;
create policy cadences_insert on public.cadences
  for insert to authenticated with check ((select app.is_manager()));
drop policy if exists cadences_update on public.cadences;
create policy cadences_update on public.cadences
  for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));
drop policy if exists cadences_delete on public.cadences;
create policy cadences_delete on public.cadences
  for delete to authenticated using ((select app.is_admin()));

drop policy if exists cadence_steps_select on public.cadence_steps;
create policy cadence_steps_select on public.cadence_steps
  for select to authenticated using (true);
drop policy if exists cadence_steps_insert on public.cadence_steps;
create policy cadence_steps_insert on public.cadence_steps
  for insert to authenticated with check ((select app.is_manager()));
drop policy if exists cadence_steps_update on public.cadence_steps;
create policy cadence_steps_update on public.cadence_steps
  for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));
drop policy if exists cadence_steps_delete on public.cadence_steps;
create policy cadence_steps_delete on public.cadence_steps
  for delete to authenticated using ((select app.is_manager()));

-- Matrícula e toque seguem a visibilidade da organização: `embaixador` só vê a
-- carteira dele; escrita direta é de gestor/admin, porque o caminho normal são
-- as RPCs (definer).
drop policy if exists cadence_enrollments_select on public.cadence_enrollments;
create policy cadence_enrollments_select on public.cadence_enrollments
  for select to authenticated using ((select app.org_is_visible(organization_id)));
drop policy if exists cadence_enrollments_insert on public.cadence_enrollments;
create policy cadence_enrollments_insert on public.cadence_enrollments
  for insert to authenticated with check ((select app.is_manager()));
drop policy if exists cadence_enrollments_update on public.cadence_enrollments;
create policy cadence_enrollments_update on public.cadence_enrollments
  for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));
drop policy if exists cadence_enrollments_delete on public.cadence_enrollments;
create policy cadence_enrollments_delete on public.cadence_enrollments
  for delete to authenticated using ((select app.is_admin()));

drop policy if exists cadence_touches_select on public.cadence_touches;
create policy cadence_touches_select on public.cadence_touches
  for select to authenticated using ((select app.org_is_visible(organization_id)));
drop policy if exists cadence_touches_insert on public.cadence_touches;
create policy cadence_touches_insert on public.cadence_touches
  for insert to authenticated with check ((select app.is_manager()));
drop policy if exists cadence_touches_update on public.cadence_touches;
create policy cadence_touches_update on public.cadence_touches
  for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));
drop policy if exists cadence_touches_delete on public.cadence_touches;
create policy cadence_touches_delete on public.cadence_touches
  for delete to authenticated using ((select app.is_admin()));


-- ===========================================================================
-- D. AS CINCO CADÊNCIAS (seed)
-- ===========================================================================

-- Dois modelos que as cadências novas exigem e que ainda não existiam.
-- GEN-FUP-LIG-V1 carrega o conteúdo obrigatório do RF-CON-12 (nome real +
-- Komune + finalidade + origem do contato + aviso de privacidade + saída fácil).
insert into public.message_templates
  (template_code, name, channel, category, segment, kind, language, body, variables)
values
  ('GEN-FUP-LIG-V1', 'Tentei te ligar — follow-up de voz', 'whatsapp', 'utility', 'GEN',
   'followup', 'pt_BR',
   'Oi, {{nome}}! Aqui é a Heloísa, da Komune, app de eventos de Natal. Tentei te ligar hoje e não consegui falar com você. Cheguei no contato de {{empresa}} pelo {{origem}} e queria só te apresentar a rede de fornecedores: sem mensalidade, você paga uma taxa quando fecha. Se preferir, me diz o melhor horário que eu ligo. Se não for o momento, é só responder SAIR. Como usamos seus dados: komune.app/privacidade',
   '["empresa", "nome", "origem"]'::jsonb),
  ('PRE-LINK-V1', 'Link de reivindicação do pré-cadastro', 'whatsapp', 'utility', 'GEN',
   'onboarding', 'pt_BR',
   '{{nome}}, preparei um rascunho do perfil de {{empresa}} na Komune com informações públicas do {{origem}}. Ninguém vê esse rascunho além de você — ele só entra no ar depois que você revisar, colocar suas fotos e aceitar os termos. O link é pessoal e vale por 7 dias: {{link}}. Se não quiser perfil, dá para pedir a remoção na própria página, sem login. Dúvidas sobre dados: komune.app/privacidade',
   '["empresa", "link", "nome", "origem"]'::jsonb)
on conflict (template_code) do nothing;

-- O áudio do D+3 do onboarding. Nasce sem arquivo: é a Heloísa que grava.
insert into public.audio_assets (slug, title, segment, context, is_active)
values ('gen-onb-ajuda-1', 'Onboarding — quer que eu termine por você? (20 s)', 'GEN',
        'Cadência pos_autorizacao, passo D+3. A GRAVAR pela Heloísa. Sempre acompanhado do texto-resumo (R06 WA-13).',
        true)
on conflict (slug) do nothing;

-- As cadências.
insert into public.cadences
  (slug, name, pipeline_slug, max_touches, limite_dias, end_stage_slug,
   requires_gancho, requires_authorization, entry_note, description)
values
  ('voz_primeiro', 'Primeiro contato por voz', 'fornecedor', 5, 14, 'nutricao', false, false,
   'Negócio em Prospectado ou Contatado, organização com telefone, não suprimida.',
   'A cadência-padrão da operação depois da virada de 04/09: ligação primeiro, WhatsApp como apoio (R13). Uma única mensagem iniciada por nós, e ela cabe folgado na régua 1+1 do RF-CON-13 porque a abertura foi por voz.'),
  ('retomar_conversa', 'Retomar morno parado', 'fornecedor', 3, 14, 'nutricao', false, false,
   'Entra por desfecho: lig_atendeu_retorna, reu_objecao, wa_respondeu sem próximo passo.',
   'RF-CON-14. Cada toque com motivo novo; nunca dois no mesmo dia — garantido pela regra de um pendente.'),
  ('pos_autorizacao', 'Onboarding até reivindicar', 'fornecedor', 5, 30, null, false, true,
   'Etapa Autorizou E consent_events.data_use_authorized vigente. Sem essa linha o banco recusa.',
   'RF-CON-16. Termina em `claimed`, que abre a cadência completar_cadastro.'),
  ('completar_cadastro', 'Do claim à publicação', 'ativacao', 4, 21, null, false, false,
   'Etapa Cadastro em andamento com claimed_at preenchido.',
   'RF-CON-16, segunda metade. Cada toque cita o campo específico que falta, lido de pre_registrations.completeness_breakdown. Depois de D+14 vira tarefa humana e visita, sem cadência.'),
  ('reativacao', 'Reativação com gancho', 'fornecedor', 2, 90, 'nutricao', true, false,
   'NÃO nasce sozinha: exige gancho preenchido por gente (lead real, Research Request, evento próprio, case autorizado, sazonalidade).',
   'RF-CON-15. Um toque por ciclo (D+30/D+60); dois ciclos sem resposta encerram. Nunca para "não" firme, perdido, opt-out ou desfecho não reativável — a porteira barra.')
on conflict (slug) do nothing;

-- Os passos.
insert into public.cadence_steps
  (cadence_id, "position", channel, task_kind, delay_days, delay_from, title,
   template_code, audio_slug, condition, tiers, window_hint, is_last_automatic)
select c.id, p.pos, p.canal::app.channel, p.tarefa::app.task_kind, p.dias, p.de, p.titulo,
       p.template, p.audio, p.cond::jsonb, p.tiers::text[], p.dica, p.ultimo
  from (values
    -- A · voz_primeiro
    ('voz_primeiro', 1::smallint, 'phone', 'call', 0::smallint, 'matricula',
     'Ligar: primeiro contato', null, null, '{"tem_telefone": true}', '{}',
     'Roteiro em árvore por organizations.kind; aviso de origem no primeiro nó', false),
    ('voz_primeiro', 2, 'phone', 'call', 1, 'passo_anterior',
     'Ligar de novo — 2ª e última tentativa', null, null,
     '{"ultimo_desfecho_em": ["lig_nao_atendeu", "lig_caixa_postal"]}', '{}',
     'Se atendeu, a cadência encerra e quem manda é o desfecho', false),
    ('voz_primeiro', 3, 'whatsapp', 'message', 3, 'passo_anterior',
     'Mandar "tentei te ligar" (assistido)', 'GEN-FUP-LIG-V1', null,
     '{"tem_telefone": true, "sem_resposta": true}', '{}',
     'A ÚNICA mensagem iniciada por nós nesta cadência (RF-CON-12, RF-CON-13)', false),
    ('voz_primeiro', 4, 'instagram', 'message', 7, 'matricula',
     'DM no Instagram', null, null, '{"tem_instagram": true}', '{A+,A}', null, false),
    ('voz_primeiro', 5, 'presencial', 'visit', 7, 'matricula',
     'Visita na rota da zona', null, null, '{"bairro_geocodificado": true}', '{A+,A}',
     'D+7 a D+10, na zona da rota do dia', true),

    -- B · retomar_conversa
    ('retomar_conversa', 1, 'phone', 'call', 0, 'data_combinada',
     'Ligar na data que ele pediu', null, null, '{}', '{}',
     'Item nº 1 do digest das 07:30 (RF-MET-04)', false),
    ('retomar_conversa', 2, 'whatsapp', 'message', 2, 'passo_anterior',
     'Retomar com motivo novo', 'GEN-FUP-D3-V1', null, '{}', '{}',
     'Só dentro da janela de 24 h; fora dela vira ligação, não modelo pago', false),
    ('retomar_conversa', 3, 'phone', 'call', 7, 'passo_anterior',
     'Última tentativa', null, null, '{}', '{}', null, true),

    -- C · pos_autorizacao
    ('pos_autorizacao', 1, 'whatsapp', 'message', 0, 'matricula',
     'Enviar o link de reivindicação', 'PRE-LINK-V1', null, '{}', '{}',
     'Aviso do R06 §C.4: rascunho privado, criado de dados públicos, expira, sem login para recusar', false),
    ('pos_autorizacao', 2, 'whatsapp', 'message', 1, 'matricula',
     'Lembrete do link', 'GEN-ONB-D1-NAO-ABRIU', null, '{"claim_link_aberto": false}', '{}',
     null, false),
    ('pos_autorizacao', 3, 'whatsapp', 'message', 3, 'matricula',
     'Áudio da Heloísa: quer que eu termine por você?', 'GEN-ONB-D7', 'gen-onb-ajuda-1',
     '{"reivindicado": false}', '{}', 'Áudio sempre com texto-resumo (R06 WA-13)', false),
    ('pos_autorizacao', 4, 'phone', 'call', 7, 'matricula',
     'Ligar e terminar em 5 minutos — e regenerar o link', null, null,
     '{"reivindicado": false}', '{}', 'O token expira em 7 dias; regenerar invalida o anterior', false),
    ('pos_autorizacao', 5, 'whatsapp', 'message', 20, 'matricula',
     'Aviso final antes de o rascunho ser apagado em D+30', 'GEN-ONB-D14', null,
     '{"reivindicado": false}', '{}', null, true),

    -- D · completar_cadastro
    ('completar_cadastro', 1, 'whatsapp', 'message', 1, 'matricula',
     'Falta pouco: citar o campo que falta', 'GEN-ONB-D1', null, '{}', '{}',
     'O campo sai de pre_registrations.completeness_breakdown', false),
    ('completar_cadastro', 2, 'whatsapp', 'message', 3, 'matricula',
     'Falta só um campo — oferecer terminar por ligação', 'GEN-ONB-D3', null, '{}', '{}',
     null, false),
    ('completar_cadastro', 3, 'whatsapp', 'message', 7, 'matricula',
     'Perfil 90% pronto e parado', 'GEN-ONB-D7', null, '{}', '{}', null, false),
    ('completar_cadastro', 4, 'whatsapp', 'message', 14, 'matricula',
     'Última lembrança automática', 'GEN-ONB-D14', null, '{}', '{}',
     'Depois disto vira tarefa humana e visita, sem cadência', true),

    -- E · reativacao
    ('reativacao', 1, 'whatsapp', 'message', 30, 'matricula',
     'Reativar com o gancho registrado', 'GEN-REA-60-V1', null, '{"tem_gancho": true}', '{}',
     null, false),
    ('reativacao', 2, 'whatsapp', 'message', 60, 'matricula',
     'Segundo e último ciclo', 'GEN-REA-60-V2', null, '{"tem_gancho": true}', '{}',
     'Dois ciclos sem resposta → não reativar automaticamente', true)
  ) as p(cad, pos, canal, tarefa, dias, de, titulo, template, audio, cond, tiers, dica, ultimo)
  join public.cadences c on c.slug = p.cad
 where not exists (select 1 from public.cadence_steps s
                    where s.cadence_id = c.id and s."position" = p.pos);


-- ===========================================================================
-- E. A RÉGUA DE SILÊNCIO COMO JOBS (pg_cron)
-- ===========================================================================
-- Nenhum destes jobs envia mensagem e nenhum cria toque por vencimento: eles
-- só perguntam ao motor "esta matrícula já pode dar o próximo passo?" e
-- encerram o que passou do limite.

create or replace function app.cadencias_agendar()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  n int := 0;
begin
  -- Domingo e feriado: não roda. A porteira já adiaria tudo, mas não custa
  -- nada dizer no lugar certo que o dia não é de operação.
  if not app.dia_util_de_operacao() then
    return 0;
  end if;
  for e in
    select en.id
      from public.cadence_enrollments en
     where en.status = 'ativa'::app.cadence_status
       and coalesce(en.next_due_at, en.enrolled_at) <= now()
       and not exists (select 1 from public.cadence_touches t
                        where t.organization_id = en.organization_id
                          and t.status = 'pendente'::app.touch_status)
     order by coalesce(en.next_due_at, en.enrolled_at)
     limit 500
  loop
    perform app.abrir_proximo_toque(e.id);
    n := n + 1;
  end loop;
  return n;
end $$;
comment on function app.cadencias_agendar() is
  'Régua de silêncio, parte 1: pergunta ao motor se cada matrícula ativa já pode dar o próximo passo. Não envia nada. Não roda em domingo nem feriado.';

create or replace function app.cadencias_encerrar_silencio()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  n int := 0;
begin
  if not app.dia_util_de_operacao() then
    return 0;
  end if;
  for e in
    select en.id
      from public.cadence_enrollments en
      join public.cadences c on c.id = en.cadence_id
     where en.status = 'ativa'::app.cadence_status
       and now() > en.enrolled_at + make_interval(days => c.limite_dias)
  loop
    perform app.encerrar_por_silencio(e.id);
    n := n + 1;
  end loop;
  return n;
end $$;
comment on function app.cadencias_encerrar_silencio() is
  'Régua de silêncio, parte 2: D+14 sem resposta encerra a cadência e move o negócio para nutrição — SEM mandar nada (RF-CON-13).';


-- ===========================================================================
-- F. PRÉ-CADASTRO
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- F.1 O rascunho
-- ---------------------------------------------------------------------------
-- Só dados factuais entram no rascunho (RF-PRE-03, R06 §4.1(2)). A whitelist é
-- CHECK, não convenção: campo fora da lista não grava.
create or replace function app.prefilled_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null
      or (jsonb_typeof(p) = 'object'
          and not exists (
            select 1 from jsonb_object_keys(p) k
             where k not in ('nome_exibicao', 'categorias', 'subnichos', 'cidade',
                             'bairro', 'area_atendimento', 'faixa_preco', 'instagram',
                             'site', 'telefone_comercial', 'descricao_neutra',
                             'anos_de_mercado', 'fotos_publicas_encontradas')))
$$;
comment on function app.prefilled_ok(jsonb) is
  'Whitelist do pré-preenchimento (RF-PRE-03): só o factual. Foto, texto de terceiro, avaliação e preço copiado não entram.';

create table if not exists public.pre_registrations (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null unique references public.organizations(id) on delete cascade,
  deal_id                uuid references public.deals(id) on delete set null,
  contact_id             uuid references public.contacts(id) on delete set null,
  komune_supplier_id     uuid,
  status                 app.prereg_status not null default 'pending',
  published              boolean not null default false,
  prefilled              jsonb not null default '{}'::jsonb,
  source_label           text,
  source_url             text,
  photos_found_count     int check (photos_found_count is null or photos_found_count >= 0),
  completeness_score     smallint check (completeness_score is null
                                         or completeness_score between 0 and 100),
  completeness_breakdown jsonb not null default '{}'::jsonb,
  claim_token_hash       text check (claim_token_hash is null or claim_token_hash ~ '^[0-9a-f]{64}$'),
  claim_token_issued_at  timestamptz,
  claim_token_expires_at timestamptz,
  claim_token_version    smallint not null default 0,
  claim_link_sent_at     timestamptz,
  claim_link_opened_at   timestamptz,
  claimed_at             timestamptz,
  claimed_channel        text check (claimed_channel is null or
                            claimed_channel in ('whatsapp', 'sms', 'email', 'cs_manual')),
  refused_at             timestamptz,
  refused_reason         text,
  expires_at             timestamptz not null default now() + interval '30 days',
  reminded_at            timestamptz,
  purge_after            timestamptz,
  purged_at              timestamptz,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- ADR-09 / RF-PRE-04: sem CPF, CNPJ de faturamento, Pix ou dado bancário.
  constraint pre_registrations_sem_dado_sensivel check (
    not prefilled ?| array['cpf', 'CPF', 'pix', 'PIX', 'chave_pix', 'conta',
                           'conta_bancaria', 'agencia', 'banco', 'cartao',
                           'cnpj_faturamento']),
  constraint pre_registrations_prefilled_whitelist check (app.prefilled_ok(prefilled)),
  -- Token sem validade é token eterno.
  constraint pre_registrations_token_com_prazo check (
    (claim_token_hash is null) = (claim_token_expires_at is null)),
  constraint pre_registrations_recusa_com_motivo check (
    refused_at is null or length(trim(coalesce(refused_reason, ''))) > 0)
);
comment on table public.pre_registrations is
  'Rascunho do perfil na Komune (RF-PRE-02/03/07/12). Nasce published=false e invisível; anon não tem grant nenhum nesta tabela. O token só existe como hash.';
comment on column public.pre_registrations.published is
  'Espelho do estado na plataforma. O gatilho pre_registrations_guard recusa published=true sem reivindicação E aceite com prova (RF-PRE-02).';
comment on column public.pre_registrations.expires_at is
  'Rascunho não reivindicado em 30 dias é apagado (R06 §D e item 9). O lead no CRM permanece.';

create index if not exists pre_registrations_status_idx  on public.pre_registrations (status);
create index if not exists pre_registrations_expira_idx  on public.pre_registrations (expires_at)
  where claimed_at is null and purged_at is null;
create index if not exists pre_registrations_token_idx   on public.pre_registrations (claim_token_hash)
  where claim_token_hash is not null;
create index if not exists pre_registrations_deal_idx    on public.pre_registrations (deal_id);
create index if not exists pre_registrations_contact_idx on public.pre_registrations (contact_id);
create index if not exists pre_registrations_by_idx      on public.pre_registrations (created_by);


-- ---------------------------------------------------------------------------
-- F.2 O log de eventos (R10 §5.2), append-only
-- ---------------------------------------------------------------------------
create table if not exists public.pre_registration_events (
  id                  bigserial primary key,
  pre_registration_id uuid not null references public.pre_registrations(id) on delete cascade,
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  event               text not null check (event in (
    'pre_registration_created', 'contacted', 'replied',
    'authorization_requested', 'authorization_granted', 'authorization_denied',
    'claim_link_sent', 'claim_link_revoked', 'claim_link_opened', 'claim_refused',
    'claimed', 'terms_accepted', 'data_authorization_granted',
    'profile_reviewed', 'profile_50', 'photos_added', 'wallet_ready',
    'publish_requested', 'returned', 'published', 'profile_100',
    'documents_submitted', 'verified', 'verification_rejected',
    'first_view', 'first_lead', 'first_response', 'first_proposal', 'first_deal',
    'paused', 'unpublished', 'feedback_collected',
    'expiry_reminder_sent', 'pre_registration_purged')),
  payload             jsonb not null default '{}'::jsonb,
  actor               text not null default 'system'
                        check (actor in ('supplier', 'cs', 'system', 'bot', 'komune')),
  actor_id            uuid references public.profiles(id) on delete set null,
  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  constraint pre_registration_events_sem_dado_sensivel check (
    not payload ?| array['cpf', 'CPF', 'pix', 'PIX', 'chave_pix', 'conta_bancaria',
                         'agencia', 'banco', 'cartao', 'claim_token', 'token'])
);
comment on table public.pre_registration_events is
  'Linha do tempo de onboarding (R10 §5.2, RF-PRE-13/16). Append-only. O token nunca entra no payload — há CHECK.';

create index if not exists pre_registration_events_pre_idx
  on public.pre_registration_events (pre_registration_id, occurred_at desc);
create index if not exists pre_registration_events_org_idx
  on public.pre_registration_events (organization_id, occurred_at desc);
create index if not exists pre_registration_events_actor_idx
  on public.pre_registration_events (actor_id);

drop trigger if exists pre_registration_events_append_only on public.pre_registration_events;
create trigger pre_registration_events_append_only
  before update or delete on public.pre_registration_events
  for each row execute function app.forbid_change();


-- ---------------------------------------------------------------------------
-- F.3 O aceite com prova (LGPD art. 8º §2º — o ônus da prova é do controlador)
-- ---------------------------------------------------------------------------
create table if not exists public.pre_registration_acceptances (
  id                      uuid primary key default gen_random_uuid(),
  pre_registration_id     uuid not null references public.pre_registrations(id) on delete cascade,
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  terms_version           text not null check (length(trim(terms_version)) between 1 and 40),
  terms_hash              text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  terms_accepted          boolean not null check (terms_accepted),
  data_authorization      boolean not null check (data_authorization),
  marketing_optin         boolean not null default false,
  photo_import_authorized boolean not null default false,
  accepted_at             timestamptz not null default now(),
  ip                      inet not null,
  user_agent              text not null check (length(trim(user_agent)) between 5 and 400),
  auth_method             text not null check (auth_method in
                            ('claim_link', 'otp_whatsapp', 'otp_sms', 'email_code', 'cs_manual')),
  who_accepted            text not null check (length(trim(who_accepted)) between 2 and 120),
  consent_event_id        uuid references public.consent_events(id) on delete set null,
  created_at              timestamptz not null default now()
);
comment on table public.pre_registration_acceptances is
  'Prova do aceite (R06 PRE-06/07): carimbo, IP, user-agent, versão e hash do termo, método de autenticação e quem aceitou. Todas as colunas são NOT NULL de propósito — aceite sem prova completa não é aceite. Append-only.';

create index if not exists pre_registration_acceptances_pre_idx
  on public.pre_registration_acceptances (pre_registration_id, accepted_at desc);
create index if not exists pre_registration_acceptances_org_idx
  on public.pre_registration_acceptances (organization_id);
create index if not exists pre_registration_acceptances_consent_idx
  on public.pre_registration_acceptances (consent_event_id);

drop trigger if exists pre_registration_acceptances_append_only on public.pre_registration_acceptances;
create trigger pre_registration_acceptances_append_only
  before update or delete on public.pre_registration_acceptances
  for each row execute function app.forbid_change();


-- ---------------------------------------------------------------------------
-- F.4 Guardas do rascunho
-- ---------------------------------------------------------------------------
create or replace function app.pre_registrations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- "published = false" não é default: é regra. Só publica quem reivindicou E
  -- aceitou com prova (RF-PRE-02, R06 §4.1(1)).
  if new.published then
    if new.claimed_at is null then
      raise exception 'Rascunho não reivindicado não pode ser publicado (RF-PRE-02).'
        using errcode = '42501';
    end if;
    if not exists (select 1 from public.pre_registration_acceptances a
                    where a.pre_registration_id = new.id
                      and a.terms_accepted and a.data_authorization) then
      raise exception 'Publicação exige aceite dos termos com prova registrada (LGPD art. 8º §2º).'
        using errcode = '42501';
    end if;
    if new.purged_at is not null then
      raise exception 'Rascunho apagado não volta a ser publicado.' using errcode = '42501';
    end if;
  end if;

  -- Nenhum rascunho nasce, e nenhum token é emitido, para alvo suprimido.
  if tg_op = 'INSERT' and app.is_suppressed_target(new.organization_id, new.contact_id) then
    raise exception 'Contato suprimido: nenhum pré-cadastro nasce para ele.' using errcode = '42501';
  end if;
  if new.claim_token_hash is not null
     and (tg_op = 'INSERT' or new.claim_token_hash is distinct from old.claim_token_hash)
     and app.is_suppressed_target(new.organization_id, new.contact_id) then
    raise exception 'Contato suprimido: nenhum link de reivindicação é emitido para ele.'
      using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists pre_registrations_guard on public.pre_registrations;
create trigger pre_registrations_guard
  before insert or update on public.pre_registrations
  for each row execute function app.pre_registrations_guard();

drop trigger if exists audit_pre_registrations on public.pre_registrations;
create trigger audit_pre_registrations
  after insert or update or delete on public.pre_registrations
  for each row execute function app.audit();

drop trigger if exists audit_pre_registration_acceptances on public.pre_registration_acceptances;
create trigger audit_pre_registration_acceptances
  after insert on public.pre_registration_acceptances
  for each row execute function app.audit();


-- ---------------------------------------------------------------------------
-- F.5 RLS do pré-cadastro
-- ---------------------------------------------------------------------------
alter table public.pre_registrations            enable row level security;
alter table public.pre_registration_events      enable row level security;
alter table public.pre_registration_acceptances enable row level security;

-- Nenhuma política para `anon`: o rascunho não é público, e não é a tela que
-- garante isso. O acesso do fornecedor à própria prévia passa por
-- `public.abrir_reivindicacao(token)`, que é definer e devolve UMA linha.
drop policy if exists pre_registrations_select on public.pre_registrations;
create policy pre_registrations_select on public.pre_registrations
  for select to authenticated using ((select app.org_is_visible(organization_id)));
drop policy if exists pre_registrations_insert on public.pre_registrations;
create policy pre_registrations_insert on public.pre_registrations
  for insert to authenticated
  with check ((select app.can_write()) and (select app.org_is_visible(organization_id)));
drop policy if exists pre_registrations_update on public.pre_registrations;
create policy pre_registrations_update on public.pre_registrations
  for update to authenticated
  using ((select app.can_write()) and (select app.org_is_visible(organization_id)))
  with check ((select app.can_write()) and (select app.org_is_visible(organization_id)));
drop policy if exists pre_registrations_delete on public.pre_registrations;
create policy pre_registrations_delete on public.pre_registrations
  for delete to authenticated using ((select app.is_admin()));

drop policy if exists pre_registration_events_select on public.pre_registration_events;
create policy pre_registration_events_select on public.pre_registration_events
  for select to authenticated using ((select app.org_is_visible(organization_id)));
drop policy if exists pre_registration_events_insert on public.pre_registration_events;
create policy pre_registration_events_insert on public.pre_registration_events
  for insert to authenticated
  with check ((select app.can_write()) and (select app.org_is_visible(organization_id)));

-- O aceite guarda IP e user-agent: é prova, e prova é dado pessoal. Só gestor.
drop policy if exists pre_registration_acceptances_select on public.pre_registration_acceptances;
create policy pre_registration_acceptances_select on public.pre_registration_acceptances
  for select to authenticated using ((select app.is_manager()));
drop policy if exists pre_registration_acceptances_insert on public.pre_registration_acceptances;
create policy pre_registration_acceptances_insert on public.pre_registration_acceptances
  for insert to authenticated with check ((select app.is_manager()));


-- ---------------------------------------------------------------------------
-- F.6 RPCs do pré-cadastro
-- ---------------------------------------------------------------------------
create or replace function public.criar_pre_cadastro(p_organization_id uuid,
                                                     p_prefilled jsonb default '{}'::jsonb,
                                                     p_source_label text default null,
                                                     p_source_url text default null,
                                                     p_photos_found int default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_deal public.deals%rowtype;
  v_id   uuid;
  v_novo boolean := false;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() or not app.org_is_visible(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from public.organizations o
                  where o.id = p_organization_id and o.deleted_at is null) then
    return jsonb_build_object('ok', false, 'motivo', 'organizacao_inexistente');
  end if;
  if app.is_suppressed_target(p_organization_id, null) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido');
  end if;
  if not app.prefilled_ok(p_prefilled) then
    return jsonb_build_object('ok', false, 'motivo', 'campo_fora_da_whitelist');
  end if;

  select d.* into v_deal from public.deals d
   where d.organization_id = p_organization_id and d.status = 'open'
   order by d.created_at limit 1;

  select pr.id into v_id from public.pre_registrations pr
   where pr.organization_id = p_organization_id;

  if v_id is null then
    insert into public.pre_registrations
      (organization_id, deal_id, contact_id, prefilled, source_label, source_url,
       photos_found_count, status, created_by)
    values (p_organization_id, v_deal.id, v_deal.primary_contact_id,
            coalesce(p_prefilled, '{}'::jsonb), p_source_label, p_source_url,
            p_photos_found, 'draft_created'::app.prereg_status, v_uid)
    returning id into v_id;
    v_novo := true;
  else
    update public.pre_registrations pr
       set prefilled          = coalesce(p_prefilled, pr.prefilled),
           source_label       = coalesce(p_source_label, pr.source_label),
           source_url         = coalesce(p_source_url, pr.source_url),
           photos_found_count = coalesce(p_photos_found, pr.photos_found_count),
           deal_id            = coalesce(pr.deal_id, v_deal.id),
           contact_id         = coalesce(pr.contact_id, v_deal.primary_contact_id)
     where pr.id = v_id;
  end if;

  insert into public.pre_registration_events
    (pre_registration_id, organization_id, event, payload, actor, actor_id)
  values (v_id, p_organization_id, 'pre_registration_created',
          jsonb_build_object('source_label', p_source_label, 'source_url', p_source_url,
                             'campos', (select coalesce(jsonb_agg(k), '[]'::jsonb)
                                          from jsonb_object_keys(coalesce(p_prefilled, '{}'::jsonb)) k),
                             'fotos_publicas', p_photos_found),
          'cs', v_uid);

  return jsonb_build_object('ok', true, 'pre_registration_id', v_id, 'novo', v_novo);
end $$;
comment on function public.criar_pre_cadastro(uuid, jsonb, text, text, int) is
  'Cria ou atualiza o rascunho (RF-PRE-05). Só dados factuais (whitelist), nunca para alvo suprimido, e sem link — o link é outra função e exige autorização.';


create or replace function public.gerar_link_de_reivindicacao(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_papel app.user_role := app.role();
  pr      public.pre_registrations%rowtype;
  v_tok   text;
  v_exp   timestamptz := now() + interval '7 days';
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() or not app.org_is_visible(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if app.is_suppressed_target(p_organization_id, null) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido');
  end if;
  -- O guardrail do CLAUDE.md: nada de pré-cadastro na Komune sem autorização
  -- registrada em consent_events. O link É o pré-cadastro chegando na pessoa.
  if not app.tem_autorizacao_vigente(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_autorizacao');
  end if;

  select * into pr from public.pre_registrations where organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sem_pre_cadastro');
  end if;
  if pr.purged_at is not null or pr.refused_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'rascunho_encerrado');
  end if;
  if pr.claimed_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_reivindicado');
  end if;

  -- 32 bytes de aleatoriedade, guardados só como sha256. Reenvio invalida o
  -- anterior por construção: só existe UM hash por rascunho (RF-PRE-07).
  v_tok := encode(extensions.gen_random_bytes(32), 'hex');

  update public.pre_registrations
     set claim_token_hash       = app.sha256_hex(v_tok),
         claim_token_issued_at  = now(),
         claim_token_expires_at = v_exp,
         claim_token_version    = claim_token_version + 1,
         claim_link_sent_at     = now(),
         claim_link_opened_at   = null,
         status                 = 'link_sent'::app.prereg_status
   where id = pr.id;

  if pr.claim_token_hash is not null then
    insert into public.pre_registration_events
      (pre_registration_id, organization_id, event, payload, actor, actor_id)
    values (pr.id, p_organization_id, 'claim_link_revoked',
            jsonb_build_object('versao_anterior', pr.claim_token_version), 'cs', v_uid);
  end if;

  insert into public.pre_registration_events
    (pre_registration_id, organization_id, event, payload, actor, actor_id)
  values (pr.id, p_organization_id, 'claim_link_sent',
          jsonb_build_object('expira_em', v_exp, 'versao', pr.claim_token_version + 1), 'cs', v_uid);

  -- Gerar o link é revelar um caminho de acesso ao rascunho: auditado como tal.
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, v_papel::text, 'GERAR_CLAIM_LINK', 'pre_registrations', pr.id::text,
          jsonb_build_object('organizacao', p_organization_id, 'expira_em', v_exp));

  return jsonb_build_object('ok', true, 'token', v_tok,
                            'url', 'https://parceiros.komune.app/c/' || v_tok,
                            'expira_em', v_exp,
                            'versao', pr.claim_token_version + 1);
end $$;
comment on function public.gerar_link_de_reivindicacao(uuid) is
  'Emite o link de reivindicação (RF-PRE-07): 32 bytes aleatórios, guardados só como hash, validade de 7 dias, reenvio invalida o anterior. Exige autorização registrada em consent_events. O token em claro sai APENAS neste retorno.';


-- A página pública. Devolve o rascunho de quem tem o token, e nada mais.
create or replace function public.abrir_reivindicacao(p_token text,
                                                      p_user_agent text default null,
                                                      p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr  public.pre_registrations%rowtype;
  o   public.organizations%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;
  select * into pr from public.pre_registrations
   where claim_token_hash = app.sha256_hex(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;
  if pr.purged_at is not null or pr.refused_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'rascunho_encerrado');
  end if;
  if pr.claim_token_expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'token_expirado');
  end if;

  select * into o from public.organizations where id = pr.organization_id;

  if pr.claim_link_opened_at is null then
    update public.pre_registrations
       set claim_link_opened_at = now(),
           status = case when status = 'link_sent'::app.prereg_status
                         then 'in_progress'::app.prereg_status else status end
     where id = pr.id;
    insert into public.pre_registration_events
      (pre_registration_id, organization_id, event, payload, actor)
    values (pr.id, pr.organization_id, 'claim_link_opened',
            jsonb_build_object('user_agent', left(coalesce(p_user_agent, ''), 400),
                               'ip_hash', case when p_ip is null then null
                                               else app.sha256_hex(p_ip) end),
            'supplier');
  end if;

  return jsonb_build_object(
    'ok', true,
    'nome', o.name,
    'rascunho', pr.prefilled,
    'origem', pr.source_label,
    'fotos_publicas', pr.photos_found_count,
    'criado_em', pr.created_at,
    'expira_em', pr.expires_at,
    'reivindicado', pr.claimed_at is not null,
    'aviso', 'Rascunho privado — não publicado. Criado a partir de dados públicos'
             || coalesce(' (' || pr.source_label || ')', '')
             || '. Ninguém vê além de você. Apagado automaticamente em 30 dias, ou na hora se você pedir.');
end $$;
comment on function public.abrir_reivindicacao(text, text, text) is
  'Tela T1 (RF-PRE-08). Devolve o rascunho de quem tem o token e registra claim_link_opened. Guarda só o HASH do IP. Não expõe telefone nem qualquer outro alvo.';


create or replace function public.aceitar_reivindicacao(p_token text,
                                                        p_terms_version text,
                                                        p_terms_hash text,
                                                        p_ip text,
                                                        p_user_agent text,
                                                        p_who_accepted text,
                                                        p_auth_method text default 'claim_link',
                                                        p_marketing_optin boolean default false,
                                                        p_photo_import boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr        public.pre_registrations%rowtype;
  v_consent uuid;
  v_ac      uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;
  select * into pr from public.pre_registrations
   where claim_token_hash = app.sha256_hex(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;
  if pr.purged_at is not null or pr.refused_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'rascunho_encerrado');
  end if;
  if pr.claim_token_expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'token_expirado');
  end if;
  -- Prova incompleta não é aceite (LGPD art. 8º §2º). Recusa legível aqui; os
  -- NOT NULL e os CHECK da tabela são a garantia por baixo.
  if coalesce(trim(p_terms_version), '') = ''
     or coalesce(p_terms_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(trim(p_ip), '') = ''
     or length(trim(coalesce(p_user_agent, ''))) < 5
     or length(trim(coalesce(p_who_accepted, ''))) < 2 then
    return jsonb_build_object('ok', false, 'motivo', 'prova_incompleta');
  end if;

  -- A autorização de uso de dados vira consent_events, que é o registro que o
  -- resto do CRM consulta.
  insert into public.consent_events
    (kind, organization_id, contact_id, channel, evidence_text, occurred_at)
  values ('data_use_authorized'::app.consent_kind, pr.organization_id, pr.contact_id,
          'whatsapp'::app.channel,
          'Aceite na página de reivindicação, termo ' || trim(p_terms_version)
            || ' (hash ' || left(p_terms_hash, 12) || '…), método ' || p_auth_method,
          now())
  returning id into v_consent;

  insert into public.pre_registration_acceptances
    (pre_registration_id, organization_id, terms_version, terms_hash, terms_accepted,
     data_authorization, marketing_optin, photo_import_authorized, ip, user_agent,
     auth_method, who_accepted, consent_event_id)
  values (pr.id, pr.organization_id, trim(p_terms_version), p_terms_hash, true,
          true, coalesce(p_marketing_optin, false), coalesce(p_photo_import, false),
          trim(p_ip)::inet, trim(p_user_agent), p_auth_method, trim(p_who_accepted), v_consent)
  returning id into v_ac;

  if coalesce(p_marketing_optin, false) then
    insert into public.consent_events
      (kind, organization_id, contact_id, channel, evidence_text, occurred_at)
    values ('contact_optin'::app.consent_kind, pr.organization_id, pr.contact_id,
            'whatsapp'::app.channel, 'Caixa opcional de marketing na página de reivindicação', now());
  end if;
  if coalesce(p_photo_import, false) then
    insert into public.consent_events
      (kind, organization_id, contact_id, channel, evidence_text, occurred_at)
    values ('photo_use_authorized'::app.consent_kind, pr.organization_id, pr.contact_id,
            'whatsapp'::app.channel,
            'Autorização de importação das fotos públicas, com declaração de titularidade', now());
  end if;

  -- Reivindicado: o token morre aqui. Quem volta, volta pela conta da Komune.
  update public.pre_registrations
     set claimed_at             = now(),
         claimed_channel        = 'whatsapp',
         status                 = 'in_progress'::app.prereg_status,
         claim_token_hash       = null,
         claim_token_expires_at = null
   where id = pr.id;

  insert into public.pre_registration_events
    (pre_registration_id, organization_id, event, payload, actor)
  values
    (pr.id, pr.organization_id, 'claimed',
     jsonb_build_object('auth_method', p_auth_method), 'supplier'),
    (pr.id, pr.organization_id, 'terms_accepted',
     jsonb_build_object('terms_version', trim(p_terms_version),
                        'marketing_optin', coalesce(p_marketing_optin, false)), 'supplier'),
    (pr.id, pr.organization_id, 'data_authorization_granted',
     jsonb_build_object('photo_import', coalesce(p_photo_import, false)), 'supplier');

  return jsonb_build_object('ok', true, 'acceptance_id', v_ac,
                            'pre_registration_id', pr.id,
                            'consent_event_id', v_consent);
end $$;
comment on function public.aceitar_reivindicacao(text, text, text, text, text, text, text, boolean, boolean) is
  'Tela T3 (RF-PRE-08, R06 PRE-06/07). Só grava com prova completa: versão e hash do termo, IP, user-agent, método e quem aceitou. As três caixas são separadas; marketing é opcional e vira consent_events próprio.';


create or replace function public.recusar_reivindicacao(p_token text, p_motivo text default 'nao_quero')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.pre_registrations%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;
  if coalesce(p_motivo, '') not in ('nao_e_meu', 'nao_quero') then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_invalido');
  end if;
  select * into pr from public.pre_registrations
   where claim_token_hash = app.sha256_hex(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;
  if pr.purged_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'rascunho_encerrado');
  end if;

  update public.pre_registrations
     set refused_at             = now(),
         refused_reason         = p_motivo,
         status                 = 'rejected'::app.prereg_status,
         claim_token_hash       = null,
         claim_token_expires_at = null,
         purge_after            = now() + interval '48 hours'
   where id = pr.id;

  insert into public.pre_registration_events
    (pre_registration_id, organization_id, event, payload, actor)
  values (pr.id, pr.organization_id, 'claim_refused',
          jsonb_build_object('motivo', p_motivo, 'apaga_em', now() + interval '48 hours'), 'supplier'),
         (pr.id, pr.organization_id, 'authorization_denied',
          jsonb_build_object('motivo', p_motivo), 'supplier');

  -- "Não quero perfil" é oposição (LGPD art. 18 §2º). O consent_events dispara
  -- o app.consent_apply, que suprime, move o negócio para opt-out e cancela as
  -- tarefas abertas — e o nosso gatilho encerra as cadências.
  insert into public.consent_events
    (kind, organization_id, contact_id, channel, evidence_text, occurred_at)
  values ('erasure_request'::app.consent_kind, pr.organization_id, pr.contact_id,
          'whatsapp'::app.channel,
          'Recusa na página de reivindicação, sem login: ' || p_motivo, now());

  return jsonb_build_object('ok', true, 'apaga_em', now() + interval '48 hours');
end $$;
comment on function public.recusar_reivindicacao(text, text) is
  'Botão "não é meu / não quero perfil", sem login (R06 PRE-09). Apaga o rascunho em ≤ 48 h e registra a oposição, que suprime o contato.';


-- Estado do pré-cadastro para a ficha do parceiro (RF-PRE-16).
create or replace function public.pre_cadastro_do_parceiro(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pr    public.pre_registrations%rowtype;
  v_res jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.org_is_visible(p_organization_id) then
    raise exception 'Sem permissão para esta organização' using errcode = '42501';
  end if;
  select * into pr from public.pre_registrations where organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('existe', false,
                              'tem_autorizacao', app.tem_autorizacao_vigente(p_organization_id));
  end if;

  select jsonb_build_object(
           'existe', true,
           'id', pr.id,
           'status', pr.status,
           'publicado', pr.published,
           'rascunho', pr.prefilled,
           'origem', pr.source_label,
           'fotos_publicas', pr.photos_found_count,
           'completude', pr.completeness_score,
           'falta', pr.completeness_breakdown,
           'tem_autorizacao', app.tem_autorizacao_vigente(p_organization_id),
           -- O token nunca sai daqui: só o que dá para dizer sobre ele.
           'link_ativo', pr.claim_token_hash is not null and pr.claim_token_expires_at > now(),
           'link_expira_em', pr.claim_token_expires_at,
           'link_enviado_em', pr.claim_link_sent_at,
           'link_aberto_em', pr.claim_link_opened_at,
           'reivindicado_em', pr.claimed_at,
           'recusado_em', pr.refused_at,
           'expira_em', pr.expires_at,
           'apagado_em', pr.purged_at,
           'linha_do_tempo', coalesce((
             select jsonb_agg(jsonb_build_object('evento', e.event, 'quando', e.occurred_at,
                                                 'quem', e.actor, 'detalhe', e.payload)
                              order by e.occurred_at, e.id)
               from public.pre_registration_events e
              where e.pre_registration_id = pr.id), '[]'::jsonb))
    into v_res;
  return v_res;
end $$;


-- ---------------------------------------------------------------------------
-- F.7 Retenção do pré-cadastro (R06 §D e item 9; PRD §10.6)
-- ---------------------------------------------------------------------------
create or replace function app.precadastros_lembrete()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr record;
  n  int := 0;
begin
  if not app.dia_util_de_operacao() then
    return 0;
  end if;
  for pr in
    select p.*, o.owner_id
      from public.pre_registrations p
      join public.organizations o on o.id = p.organization_id
     where p.claimed_at is null
       and p.refused_at is null
       and p.purged_at is null
       and p.reminded_at is null
       and p.claim_link_sent_at is not null
       -- D+20 do rascunho: dez dias antes da expiração (RF-PRE-12).
       and now() >= p.expires_at - interval '10 days'
       and not app.is_suppressed_target(p.organization_id, p.contact_id)
  loop
    -- É TAREFA, não envio: quem escreve é gente (ADR-05).
    insert into public.tasks (title, kind, due_at, assignee_id, organization_id,
                              deal_id, contact_id, origin, priority)
    values ('Aviso final: o rascunho é apagado em '
              || to_char(pr.expires_at at time zone 'America/Fortaleza', 'DD/MM'),
            'message'::app.task_kind,
            app.instante_local((now() at time zone 'America/Fortaleza')::date, 9),
            pr.owner_id, pr.organization_id, pr.deal_id, pr.contact_id, 'system', 1);

    update public.pre_registrations set reminded_at = now() where id = pr.id;
    insert into public.pre_registration_events
      (pre_registration_id, organization_id, event, payload, actor)
    values (pr.id, pr.organization_id, 'expiry_reminder_sent',
            jsonb_build_object('expira_em', pr.expires_at), 'system');
    n := n + 1;
  end loop;
  return n;
end $$;
comment on function app.precadastros_lembrete() is
  'O ÚNICO lembrete antes da expiração (R06 item 9): abre uma tarefa humana em D+20. Não envia nada e não toca alvo suprimido.';

create or replace function app.precadastros_expirar()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr record;
  n  int := 0;
begin
  for pr in
    select p.*
      from public.pre_registrations p
     where p.purged_at is null
       and p.claimed_at is null
       and (
         -- pedido de remoção na página: 48 h, sempre
         (p.purge_after is not null and p.purge_after <= now())
         -- ou 30 dias sem reivindicar, com o lembrete já dado (e, se por algum
         -- motivo o lembrete não saiu, 2 dias de tolerância depois do prazo:
         -- retenção indefinida é o erro do caso KASPR, e não vamos repeti-lo)
         or (p.expires_at <= now()
             and (p.reminded_at is not null or now() > p.expires_at + interval '2 days')))
  loop
    update public.pre_registrations
       set prefilled              = '{}'::jsonb,
           completeness_breakdown = '{}'::jsonb,
           completeness_score     = null,
           photos_found_count     = null,
           claim_token_hash       = null,
           claim_token_expires_at = null,
           purged_at              = now(),
           status                 = 'expired'::app.prereg_status
     where id = pr.id;

    insert into public.pre_registration_events
      (pre_registration_id, organization_id, event, payload, actor)
    values (pr.id, pr.organization_id, 'pre_registration_purged',
            jsonb_build_object('motivo', case when pr.purge_after is not null
                                              then 'pedido_do_titular' else 'expiracao_30_dias' end,
                               'campos_apagados',
                               (select coalesce(jsonb_agg(k), '[]'::jsonb)
                                  from jsonb_object_keys(pr.prefilled) k)),
            'system');
    n := n + 1;
  end loop;
  return n;
end $$;
comment on function app.precadastros_expirar() is
  'Apaga os dados PRÉ-PREENCHIDOS do rascunho não reivindicado em 30 dias (com 1 lembrete) ou 48 h após pedido do titular. O LEAD NO CRM PERMANECE — R06 item 9 e §D, PRD §10.6.';


-- ===========================================================================
-- G. AGENDAMENTO (pg_cron) — America/Fortaleza = UTC−3
-- ===========================================================================
-- cron.timezone padrão do pg_cron é GMT; os horários abaixo somam 3 h.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- A cada 15 min: pergunta ao motor quem já pode dar o próximo passo.
    -- A própria função não faz nada em domingo nem feriado.
    perform cron.schedule('cadencias_agendar', '*/15 * * * *',
                          $cron$select app.cadencias_agendar()$cron$);
    -- 07:00 Fortaleza — antes do digest, para o Meu dia já sair limpo.
    perform cron.schedule('cadencias_encerrar_silencio', '0 10 * * *',
                          $cron$select app.cadencias_encerrar_silencio()$cron$);
    -- 08:00 Fortaleza — o lembrete único do rascunho a expirar.
    perform cron.schedule('precadastros_lembrete', '0 11 * * *',
                          $cron$select app.precadastros_lembrete()$cron$);
    -- 03:30 Fortaleza — retenção roda de madrugada, todo dia, feriado inclusive:
    -- apagar dado no prazo é obrigação, não trabalho comercial.
    perform cron.schedule('precadastros_expirar', '30 6 * * *',
                          $cron$select app.precadastros_expirar()$cron$);
  end if;
end $$;


-- ===========================================================================
-- H. GRANTS
-- ===========================================================================
grant select on public.app_settings, public.channel_windows, public.cadences,
                public.cadence_steps to authenticated;
grant insert, update, delete on public.app_settings, public.channel_windows,
                public.cadences, public.cadence_steps to authenticated;
grant select, insert, update, delete on public.cadence_enrollments, public.cadence_touches
  to authenticated;
grant select, insert, update, delete on public.pre_registrations to authenticated;
grant select, insert on public.pre_registration_events, public.pre_registration_acceptances
  to authenticated;
grant usage, select on sequence public.pre_registration_events_id_seq to authenticated;
grant usage, select on sequence public.channel_windows_id_seq to authenticated;
grant usage, select on sequence public.cadences_id_seq to authenticated;
grant usage, select on sequence public.cadence_steps_id_seq to authenticated;

-- Funções internas: ninguém de fora chama.
revoke all on function app.app_settings_validate()        from public, anon, authenticated;
revoke all on function app.cadence_steps_validate()       from public, anon, authenticated;
revoke all on function app.cadence_enrollments_guard()    from public, anon, authenticated;
revoke all on function app.cadence_touches_guard()        from public, anon, authenticated;
revoke all on function app.tasks_guard_suppressed()       from public, anon, authenticated;
revoke all on function app.pre_registrations_guard()      from public, anon, authenticated;
revoke all on function app.cadence_on_activity()          from public, anon, authenticated;
revoke all on function app.cadence_on_task()              from public, anon, authenticated;
revoke all on function app.cadence_on_stage()             from public, anon, authenticated;
revoke all on function app.cadence_on_consent()           from public, anon, authenticated;

revoke all on function app.abrir_proximo_toque(uuid)                      from public, anon, authenticated;
revoke all on function app.encerrar_matricula(uuid, text, app.cadence_status) from public, anon, authenticated;
revoke all on function app.encerrar_por_silencio(uuid)                    from public, anon, authenticated;
revoke all on function app.cadencias_agendar()                            from public, anon, authenticated;
revoke all on function app.cadencias_encerrar_silencio()                  from public, anon, authenticated;
revoke all on function app.precadastros_lembrete()                        from public, anon, authenticated;
revoke all on function app.precadastros_expirar()                         from public, anon, authenticated;
grant execute on function app.abrir_proximo_toque(uuid)                   to service_role;
grant execute on function app.cadencias_agendar()                         to service_role;
grant execute on function app.cadencias_encerrar_silencio()               to service_role;
grant execute on function app.precadastros_lembrete()                     to service_role;
grant execute on function app.precadastros_expirar()                      to service_role;

-- Leitura de regra: a tela precisa saber por que um toque foi adiado.
revoke all on function app.pode_tocar(uuid, uuid, app.channel, timestamptz) from public, anon;
revoke all on function app.janela_do_canal(app.channel, timestamptz, boolean) from public, anon;
revoke all on function app.proxima_abertura_do_canal(date, app.channel, boolean) from public, anon;
revoke all on function app.teto_do_canal(app.channel, date)               from public, anon;
revoke all on function app.toques_do_dia(app.channel, date)               from public, anon;
revoke all on function app.dia_util_de_operacao(timestamptz)              from public, anon;
revoke all on function app.ja_respondeu(uuid)                             from public, anon;
revoke all on function app.tem_autorizacao_vigente(uuid)                  from public, anon;
revoke all on function app.condicao_do_passo(int, uuid)                   from public, anon;
revoke all on function app.prefilled_ok(jsonb)                            from public, anon;
grant execute on function app.pode_tocar(uuid, uuid, app.channel, timestamptz) to authenticated, service_role;
grant execute on function app.janela_do_canal(app.channel, timestamptz, boolean) to authenticated, service_role;
grant execute on function app.proxima_abertura_do_canal(date, app.channel, boolean) to authenticated, service_role;
grant execute on function app.teto_do_canal(app.channel, date)            to authenticated, service_role;
grant execute on function app.toques_do_dia(app.channel, date)            to authenticated, service_role;
grant execute on function app.dia_util_de_operacao(timestamptz)           to authenticated, service_role;
grant execute on function app.ja_respondeu(uuid)                          to authenticated, service_role;
grant execute on function app.tem_autorizacao_vigente(uuid)               to authenticated, service_role;
grant execute on function app.condicao_do_passo(int, uuid)                to authenticated, service_role;
grant execute on function app.prefilled_ok(jsonb)                         to authenticated, service_role;

revoke all on function public.matricular_em_cadencia(uuid, text, text, uuid, uuid) from public, anon;
revoke all on function public.encerrar_cadencia(uuid, text)               from public, anon;
revoke all on function public.cadencia_do_parceiro(uuid)                  from public, anon;
revoke all on function public.criar_pre_cadastro(uuid, jsonb, text, text, int) from public, anon;
revoke all on function public.gerar_link_de_reivindicacao(uuid)           from public, anon;
revoke all on function public.pre_cadastro_do_parceiro(uuid)              from public, anon;
grant execute on function public.matricular_em_cadencia(uuid, text, text, uuid, uuid) to authenticated;
grant execute on function public.encerrar_cadencia(uuid, text)            to authenticated;
grant execute on function public.cadencia_do_parceiro(uuid)               to authenticated;
grant execute on function public.criar_pre_cadastro(uuid, jsonb, text, text, int) to authenticated;
grant execute on function public.gerar_link_de_reivindicacao(uuid)        to authenticated;
grant execute on function public.pre_cadastro_do_parceiro(uuid)           to authenticated;

-- As três da página pública: `anon` só executa isto, e nada mais. Não há grant
-- de tabela para anon em lugar nenhum deste arquivo.
revoke all on function public.abrir_reivindicacao(text, text, text)       from public;
revoke all on function public.aceitar_reivindicacao(text, text, text, text, text, text, text, boolean, boolean)
  from public;
revoke all on function public.recusar_reivindicacao(text, text)           from public;
grant execute on function public.abrir_reivindicacao(text, text, text)    to anon, authenticated, service_role;
grant execute on function public.aceitar_reivindicacao(text, text, text, text, text, text, text, boolean, boolean)
  to anon, authenticated, service_role;
grant execute on function public.recusar_reivindicacao(text, text)        to anon, authenticated, service_role;

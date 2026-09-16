-- CRM Inteligente, Fase 1: a fundação da ficha por conversa.
--
-- GATE 0 aprovado em 16/09/2026 (docs/ia/GATE-0-crm-inteligente.md). Esta migração
-- cria SÓ o chão: tabelas, bandeiras, o debounce e os dois propósitos novos de IA.
-- Nenhuma análise roda ainda — a Fase 2 é que liga o modelo.
--
-- O QUE ESTA MIGRAÇÃO NÃO CRIA, DE PROPÓSITO
--
--   * fila de IA          já existe (`pgmq.ai_jobs` + `ai_dlq`, `app.ia_enfileirar`);
--   * contabilidade       já existe (`ai_runs`, `ai_model_prices`, `ai_budget_alerts`);
--   * configuração        já existe (`app_settings`, por chave, com RLS);
--   * rascunho com gente  já existe (`message_drafts`, ADR-05);
--   * histórico de temperatura  não nasce: a temperatura continua sendo a do banco
--     (`app.compute_temperature`, PRD §5.6), com CINCO faixas, e a ficha passa a ser
--     mais um insumo dela na Fase 2 — não um segundo sistema competindo com ela
--     (conflito 4.2 do GATE 0, decidido pelo Rafael).
--
-- O que nasce aqui:
--   A. `ficha_da_conversa`        — o dossiê 1:1 com a conversa.
--   B. `compromissos_da_conversa` — quem prometeu o quê, para quando.
--   C. `pulso_do_dia`             — o resumo diário (o nome "Radar" já é do módulo de
--                                   coleta; conflito 4.1 do GATE 0).
--   D. `sugestoes_de_campo`       — o que a IA propõe preencher, para uma pessoa aceitar.
--   E. `feedback_da_ia`           — 👍/👎 e correção, que é o que calibra.
--   F. O DEBOUNCE: a conversa fica "pendente" quando chega mensagem, e um cron
--      enfileira quem parou de falar.
--   G. As bandeiras por módulo e os dois propósitos novos.

-- =====================================================================
-- A. A ficha da conversa
-- =====================================================================
create table if not exists public.ficha_da_conversa (
  conversation_id   uuid primary key references public.conversations (id) on delete cascade,
  organization_id   uuid references public.organizations (id) on delete cascade,

  -- O que o modelo leu. Tudo pode ser null: conversa de duas mensagens não tem dossiê.
  resumo            text check (resumo is null or length(resumo) <= 600),
  intencao          text,
  score_intencao    smallint check (score_intencao is null or score_intencao between 0 and 100),
  motivo            text check (motivo is null or length(motivo) <= 280),
  sentimento        text check (sentimento is null or sentimento in ('positivo', 'neutro', 'negativo')),
  -- [{tipo, polaridade, forca, message_id, trecho}] — cada sinal aponta para a mensagem
  -- que o prova. É isto que responde "por que quente?" sem o modelo precisar ser crido.
  sinais            jsonb not null default '[]'::jsonb check (jsonb_typeof(sinais) = 'array'),
  objecoes          text[] not null default '{}',
  alertas           text[] not null default '{}',
  -- Os campos do CRM que a conversa revelou, no vocabulário real das nossas tabelas.
  dados_extraidos   jsonb not null default '{}'::jsonb,
  proxima_acao      text,
  proxima_acao_em   timestamptz,
  confianca         numeric(4, 3) check (confianca is null or confianca between 0 and 1),
  dados_insuficientes boolean not null default true,

  -- A contabilidade da análise.
  ultima_mensagem_analisada uuid references public.messages (id) on delete set null,
  analisada_em      timestamptz,
  analises_incrementais int not null default 0,
  analise_completa_em timestamptz,
  prompt_version    text,
  ai_run_id         bigint references public.ai_runs (id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.ficha_da_conversa is
  'O dossiê que a IA mantém de cada conversa de WhatsApp (CRM Inteligente, Fase 1): resumo, intenção, score, sinais com a mensagem que os prova, dados extraídos e próxima ação. Um por conversa. A IA lê e sugere; quem decide e quem fala com o parceiro é gente (ADR-05).';
comment on column public.ficha_da_conversa.sinais is
  'Os sinais que sustentam o score, cada um com o message_id que o prova. O código descarta sinal cujo message_id não exista na conversa: o modelo não inventa evidência.';
comment on column public.ficha_da_conversa.score_intencao is
  'O quanto a conversa indica intenção de fechar (0-100, rubrica do prompt). NÃO é a temperatura: a temperatura continua saindo de app.compute_temperature, que passa a ler este número na Fase 2.';

create index if not exists ficha_da_conversa_org_idx on public.ficha_da_conversa (organization_id);
create index if not exists ficha_da_conversa_score_idx on public.ficha_da_conversa (score_intencao desc nulls last);
create index if not exists ficha_da_conversa_analisada_idx on public.ficha_da_conversa (analisada_em desc nulls last);

-- =====================================================================
-- B. Os compromissos
-- =====================================================================
create table if not exists public.compromissos_da_conversa (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations (id) on delete cascade,
  organization_id   uuid references public.organizations (id) on delete cascade,
  quem              text not null check (quem in ('equipe', 'parceiro')),
  o_que             text not null check (length(o_que) between 1 and 280),
  prazo             timestamptz,
  message_id        uuid references public.messages (id) on delete set null,
  status            text not null default 'aberto'
                    check (status in ('aberto', 'cumprido', 'vencido', 'cancelado')),
  cumprido_message_id uuid references public.messages (id) on delete set null,
  cumprido_em       timestamptz,
  task_id           uuid references public.tasks (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.compromissos_da_conversa is
  'Promessas com dono e prazo achadas na conversa ("te mando o orçamento amanhã"). Vencido é o que tem prazo passado e nenhuma mensagem que o cumpra — é o que o Pulso do dia cobra.';

create index if not exists compromissos_conversa_idx on public.compromissos_da_conversa (conversation_id);
create index if not exists compromissos_abertos_idx on public.compromissos_da_conversa (prazo)
  where status = 'aberto';

-- =====================================================================
-- C. O Pulso do dia
-- =====================================================================
create table if not exists public.pulso_do_dia (
  id            uuid primary key default gen_random_uuid(),
  dia           date not null,
  escopo        text not null check (escopo in ('equipe', 'pessoa')),
  user_id       uuid references public.profiles (id) on delete cascade,
  -- Os números vêm de SQL, não do modelo: a IA escreve o texto, nunca a conta.
  metricas      jsonb not null default '{}'::jsonb,
  conteudo      jsonb not null default '{}'::jsonb,
  texto         text,
  versao        int not null default 1,
  ai_run_id     bigint references public.ai_runs (id) on delete set null,
  entregue_em   timestamptz,
  canais        text[] not null default '{}',
  created_at    timestamptz not null default now()
);

comment on table public.pulso_do_dia is
  'O resumo diário do que aconteceu nas conversas (18h30, America/Fortaleza). Chama-se Pulso porque "Radar" já é o módulo de coleta em fontes públicas (GATE 0, conflito 4.1). Um por dia e escopo; regerar cria versão nova.';

create unique index if not exists pulso_do_dia_unico
  on public.pulso_do_dia (dia, escopo, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), versao);

-- =====================================================================
-- D. As sugestões de campo
-- =====================================================================
create table if not exists public.sugestoes_de_campo (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  entidade        text not null check (entidade in ('organization', 'contact', 'deal')),
  entidade_id     uuid not null,
  campo           text not null,
  valor           text not null check (length(valor) <= 500),
  confianca       numeric(4, 3) not null check (confianca between 0 and 1),
  message_id      uuid references public.messages (id) on delete set null,
  status          text not null default 'pendente'
                  check (status in ('pendente', 'aplicada', 'ignorada')),
  decidido_por    uuid references public.profiles (id) on delete set null,
  decidido_em     timestamptz,
  created_at      timestamptz not null default now()
);

comment on table public.sugestoes_de_campo is
  'O que a conversa revelou e a IA propõe gravar no CRM. Nada é aplicado sozinho: o preenchimento automático nasce desligado, e quando ligar só toca campo VAZIO e nunca por cima do que uma pessoa preencheu (field_provenance).';

create index if not exists sugestoes_pendentes_idx on public.sugestoes_de_campo (entidade, entidade_id)
  where status = 'pendente';

-- =====================================================================
-- E. O feedback (é o que calibra)
-- =====================================================================
create table if not exists public.feedback_da_ia (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations (id) on delete cascade,
  user_id         uuid references public.profiles (id) on delete set null,
  tipo            text not null check (tipo in ('util', 'inutil', 'correcao_de_temperatura', 'correcao_de_intencao')),
  valor_da_ia     text,
  valor_humano    text,
  comentario      text check (comentario is null or length(comentario) <= 500),
  prompt_version  text,
  created_at      timestamptz not null default now()
);

comment on table public.feedback_da_ia is
  'O 👍/👎 e a correção de quem usa. Sem isto não há calibração: o gabarito da Fase 2 sai daqui e das conversas rotuladas pelo time.';

-- =====================================================================
-- RLS — a mesma visibilidade da conversa, sempre
-- =====================================================================
-- Quem enxerga a conversa enxerga a ficha dela. A regra é a de `conversations_select`
-- (GATE 0, conflito 4.5): admin, gestor, sdr, leitura e financeiro veem tudo; embaixador
-- vê a carteira dele. Não existe "cada um só o seu" nesta casa — a captação é do time.
alter table public.ficha_da_conversa        enable row level security;
alter table public.compromissos_da_conversa enable row level security;
alter table public.pulso_do_dia             enable row level security;
alter table public.sugestoes_de_campo       enable row level security;
alter table public.feedback_da_ia           enable row level security;

create or replace function app.conversa_visivel(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
     where c.id = p_conversation_id
       and (app.sees_all()
            or c.assignee_id = auth.uid()
            or (app.role() = 'embaixador'::app.user_role
                and c.organization_id is not null
                and app.org_is_mine(c.organization_id))))
$$;
comment on function app.conversa_visivel(uuid) is
  'Esta conversa é visível para quem está perguntando? Cópia da política conversations_select, para as tabelas da IA lerem a mesma regra em vez de reescrevê-la.';
revoke all on function app.conversa_visivel(uuid) from public, anon;
grant execute on function app.conversa_visivel(uuid) to authenticated, service_role;

drop policy if exists ficha_da_conversa_select on public.ficha_da_conversa;
create policy ficha_da_conversa_select on public.ficha_da_conversa for select to authenticated
  using ((select app.conversa_visivel(conversation_id)));

drop policy if exists compromissos_select on public.compromissos_da_conversa;
create policy compromissos_select on public.compromissos_da_conversa for select to authenticated
  using ((select app.conversa_visivel(conversation_id)));
-- Marcar um compromisso como cumprido ou cancelado é trabalho de gente que atende.
drop policy if exists compromissos_update on public.compromissos_da_conversa;
create policy compromissos_update on public.compromissos_da_conversa for update to authenticated
  using ((select app.can_write()) and (select app.conversa_visivel(conversation_id)))
  with check ((select app.can_write()) and (select app.conversa_visivel(conversation_id)));

drop policy if exists pulso_select on public.pulso_do_dia;
create policy pulso_select on public.pulso_do_dia for select to authenticated
  using (escopo = 'equipe' and (select app.sees_all()) or user_id = (select auth.uid()));

drop policy if exists sugestoes_select on public.sugestoes_de_campo;
create policy sugestoes_select on public.sugestoes_de_campo for select to authenticated
  using (organization_id is null or (select app.org_is_visible(organization_id)));
drop policy if exists sugestoes_update on public.sugestoes_de_campo;
create policy sugestoes_update on public.sugestoes_de_campo for update to authenticated
  using ((select app.can_write()) and (organization_id is null or (select app.org_is_visible(organization_id))))
  with check ((select app.can_write()));

drop policy if exists feedback_select on public.feedback_da_ia;
create policy feedback_select on public.feedback_da_ia for select to authenticated
  using ((select app.conversa_visivel(conversation_id)));
drop policy if exists feedback_insert on public.feedback_da_ia;
create policy feedback_insert on public.feedback_da_ia for insert to authenticated
  with check ((select app.can_write()) and user_id = (select auth.uid())
              and (select app.conversa_visivel(conversation_id)));

-- Escrita das outras é do worker (service_role, que ignora RLS): a ficha é do modelo,
-- não de quem está com o CRM aberto.
grant select on public.ficha_da_conversa, public.compromissos_da_conversa,
                public.pulso_do_dia, public.sugestoes_de_campo, public.feedback_da_ia
  to authenticated;
grant update (status, cumprido_em, cumprido_message_id, updated_at)
  on public.compromissos_da_conversa to authenticated;
grant update (status, decidido_por, decidido_em) on public.sugestoes_de_campo to authenticated;
grant insert on public.feedback_da_ia to authenticated;

-- =====================================================================
-- F. O DEBOUNCE: quando a conversa fica pronta para ser analisada
-- =====================================================================
-- A regra da spec: analisar quando a conversa ficar 10 min sem mensagem nova, e no
-- máximo a cada 30 min em conversa contínua. Os dois números ficam em `app_settings`.
--
-- O gatilho não enfileira nada: ele só CARIMBA a conversa. Quem enfileira é o cron, que
-- vê o relógio — analisar no instante da mensagem seria analisar no meio da frase.
alter table public.conversations
  add column if not exists ia_pendente_desde timestamptz,
  add column if not exists ia_analisada_em   timestamptz;

comment on column public.conversations.ia_pendente_desde is
  'Quando chegou a mensagem que ainda não entrou em nenhuma análise. Null = a ficha está em dia.';

create or replace function app.ia_marcar_conversa_pendente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
     set ia_pendente_desde = coalesce(ia_pendente_desde, new.created_at),
         updated_at = now()
   where id = new.conversation_id;
  return null;
end $$;
revoke all on function app.ia_marcar_conversa_pendente() from public, anon, authenticated;

drop trigger if exists messages_ia_pendente on public.messages;
create trigger messages_ia_pendente after insert on public.messages
  for each row execute function app.ia_marcar_conversa_pendente();

-- As conversas maduras para análise, na ordem de quem esperou mais.
create or replace function app.ia_conversas_para_analisar(p_limite int default 20)
returns table (conversation_id uuid, pendente_desde timestamptz, mensagens_novas int)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select coalesce((value -> 'ficha' ->> 'debounce_min')::int, 10) as debounce_min,
           coalesce((value -> 'ficha' ->> 'teto_min')::int, 30)     as teto_min,
           coalesce(value -> 'ficha' -> 'numeros_internos', '[]'::jsonb) as internos,
           coalesce((value -> 'modulos' ->> 'ficha')::boolean, false)    as ligado
      from public.app_settings where key = 'ia.crm_inteligente'
  )
  select c.id, c.ia_pendente_desde,
         (select count(*)::int from public.messages m
           where m.conversation_id = c.id
             and (c.ia_analisada_em is null or m.created_at > c.ia_analisada_em))
    from public.conversations c, cfg
   where cfg.ligado
     and c.ia_pendente_desde is not null
     -- parou de falar há tempo suficiente...
     and (c.last_message_at <= now() - make_interval(mins => cfg.debounce_min)
          -- ...ou está numa conversa contínua e já passou do teto sem análise.
          or c.ia_pendente_desde <= now() - make_interval(mins => cfg.teto_min))
     -- número do próprio time não vira ficha.
     and not (cfg.internos ? c.peer_phone_e164)
   order by c.ia_pendente_desde
   limit greatest(1, least(p_limite, 100))
$$;
comment on function app.ia_conversas_para_analisar(int) is
  'As conversas que pararam de falar há tempo suficiente (debounce) ou que passaram do teto em conversa contínua. Respeita a bandeira do módulo e a lista de números internos.';
revoke all on function app.ia_conversas_para_analisar(int) from public, anon, authenticated;

create or replace function app.ia_enfileirar_analises(p_limite int default 20)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversa uuid;
  v_quantas  int := 0;
  v_res      jsonb;
begin
  for v_conversa in select conversation_id from app.ia_conversas_para_analisar(p_limite) loop
    -- A chave é a conversa MAIS a última mensagem dela: a mesma janela nunca é
    -- analisada duas vezes, e a janela seguinte tem chave nova (`ingest_dedup`).
    v_res := app.ia_enfileirar(
      'analisar_conversa',
      jsonb_build_object('conversation_id', v_conversa),
      -- A janela é identificada por QUANTAS mensagens a conversa tem e pela hora da
      -- última. Só a hora não bastava: duas mensagens no mesmo segundo (ou na mesma
      -- transação, onde now() não anda) davam a mesma chave, e a segunda janela
      -- nunca era analisada.
      v_conversa::text || ':' ||
        coalesce((select count(*)::text || '@' || max(m.created_at)::text
                    from public.messages m where m.conversation_id = v_conversa), 'vazia'));
    if coalesce((v_res ->> 'enfileirado')::boolean, false) then
      v_quantas := v_quantas + 1;
    end if;
  end loop;
  return v_quantas;
end $$;
comment on function app.ia_enfileirar_analises(int) is
  'Põe na fila de IA as conversas maduras. Idempotente pela chave conversa:última-mensagem — repetir a passada não paga o modelo duas vezes pela mesma janela.';
revoke all on function app.ia_enfileirar_analises(int) from public, anon, authenticated;
grant execute on function app.ia_enfileirar_analises(int) to service_role;

-- =====================================================================
-- G. Os propósitos novos e as bandeiras
-- =====================================================================
-- Os dois propósitos novos entram nas MESMAS duas listas que já existem: o `check` de
-- `ai_runs` e a porteira de `app.ia_enfileirar`. O resto da função fica como está —
-- ela já é idempotente por `app.esteira_enfileirar`, e reescrevê-la aqui seria criar um
-- segundo dedup para o mesmo trabalho.
alter table public.ai_runs drop constraint if exists ai_runs_purpose_check;
alter table public.ai_runs add constraint ai_runs_purpose_check
  check (purpose in ('transcribe_audio', 'summarize_call', 'draft_followup', 'classify_inbound',
                     'draft_reply', 'summarize_deal', 'next_action', 'digest',
                     'extract_listing', 'assistant',
                     'analisar_conversa', 'pulso_do_dia', 'perguntar_ao_crm'));

create or replace function app.ia_enfileirar(p_purpose text, p_payload jsonb, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_purpose not in ('transcribe_audio', 'summarize_call', 'draft_followup', 'classify_inbound',
                       'draft_reply', 'summarize_deal', 'next_action', 'digest',
                       'extract_listing', 'assistant',
                       'analisar_conversa', 'pulso_do_dia', 'perguntar_ao_crm') then
    raise exception 'Propósito % não existe em ai_runs.purpose: gasto que ninguém nomeou é gasto que ninguém orçou', p_purpose
      using errcode = '22023';
  end if;
  return app.esteira_enfileirar('ai_jobs',
                                jsonb_build_object('purpose', p_purpose) || coalesce(p_payload, '{}'::jsonb),
                                p_purpose || ':' || p_key);
end $$;
comment on function app.ia_enfileirar(text, jsonb, text) is
  'Põe um trabalho na fila do worker-ai. A chave de idempotência é "<propósito>:<chave>" — a mesma mensagem classificada duas vezes é dinheiro gasto duas vezes. Desde 17/09/2026 aceita analisar_conversa, pulso_do_dia e perguntar_ao_crm (CRM Inteligente).';


-- As bandeiras e os números do módulo. Tudo desligado: a Fase 1 é fundação, e ninguém
-- paga modelo por engano antes de a Fase 2 existir e ser calibrada.
insert into public.app_settings (key, value, description)
values ('ia.crm_inteligente', $j${
  "modulos": {
    "ficha": false,
    "pulso": false,
    "pergunte_ao_crm": false,
    "sugestoes_de_campo": false,
    "preenchimento_automatico": false
  },
  "ficha": {
    "debounce_min": 10,
    "teto_min": 30,
    "reanalise_a_cada": 20,
    "reanalise_dias": 7,
    "numeros_internos": []
  },
  "pulso": {
    "hora": "18:30",
    "canais": ["app", "email"]
  },
  "transcricao": {
    "provedor": "groq",
    "modelo": "whisper-large-v3-turbo",
    "duracao_maxima_seg": 600
  }
}$j$::jsonb,
  'CRM Inteligente (GATE 0 aprovado em 16/09/2026): bandeira por módulo, debounce da ficha, horário e canais do Pulso do dia e provedor de transcrição. Tudo nasce desligado — a Fase 1 é fundação.')
on conflict (key) do nothing;

-- O cron que enfileira. Ele roda mesmo com o módulo desligado, e não faz nada:
-- `ia_conversas_para_analisar` devolve vazio. Assim ligar o módulo é um update, não
-- um deploy.
do $$
begin
  perform cron.schedule('ia_enfileirar_analises', '*/5 * * * *',
                        $cron$select app.ia_enfileirar_analises(20)$cron$);
exception when others then
  raise notice 'cron.schedule ia_enfileirar_analises: %', sqlerrm;
end $$;

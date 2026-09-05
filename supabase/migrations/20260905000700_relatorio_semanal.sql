-- =====================================================================
-- TRIADE — v0.1 — D9 — O relatório de segunda (RF-REL-09; PRD §7.8;
-- anexo R07 §4 "Relatório de segunda-feira 08:00" e §6).
--
-- O QUE ESTA MIGRAÇÃO ENTREGA
--   1. `public.weekly_reports` — o relatório da semana GUARDADO: os fatos em
--      jsonb e o texto pronto para ler. Uma linha por semana, chaveada pela
--      segunda-feira.
--   2. `app.relatorio_semanal_numeros(de, ate)` — os números de UM intervalo.
--      A mesma função calcula a semana e a semana anterior, que é o que impede
--      a comparação de comparar coisas diferentes.
--   3. `app.relatorio_semanal_fatos(segunda)` — o JSON de fatos: números com
--      rótulo, o que avançou, o que esfriou, a base de hoje, o que merece
--      atenção e do que o relatório ainda depende.
--   4. `app.relatorio_semanal_texto(fatos)` — o texto em português, escrito
--      para ser lido no celular: frase curta, o número e o que ele quer dizer.
--   5. `public.relatorio_semanal_gerar(segunda)` — gera e guarda (idempotente).
--   6. `app.relatorio_semanal_cron()` + `pg_cron` na segunda 08:00 de Fortaleza.
--   7. `public.relatorio_semanal(segunda)` e `public.relatorios_semanais(n)` —
--      a leitura da tela.
--
-- O QUE ELA NÃO FAZ, E POR QUÊ
--   * NÃO ENTREGA. O R07 pede o resumo no WhatsApp do grupo de growth e os
--     arquivos anexados. O grupo não existe como canal do CRM (o inbox fala
--     com FORNECEDOR, um a um, e o número da Heloísa não manda em grupo), e
--     não há canal de e-mail. Então o job GERA e GUARDA; a tela mostra e diz,
--     por escrito, que a entrega automática chega quando o canal existir.
--     Inventar um envio que não sai seria pior do que não ter envio.
--   * NÃO NARRA COM IA. O RF-REL-01 diz "IA só narra", e o ADR-10 põe o
--     Sonnet 5 nesse lugar. O texto aqui é determinístico: sai dos mesmos
--     fatos, sempre igual, e é testável por pgTAP. Quando a narração entrar,
--     ela recebe `fatos` e substitui `texto` — o contrato já está pronto e o
--     texto determinístico continua sendo o que sai quando o modelo falha.
--   * NÃO INVENTA TENDÊNCIA. Com duas pessoas e poucas semanas de operação,
--     quase todo número é zero, um ou dois. A função só afirma direção
--     ("subiu", "caiu") quando as DUAS semanas têm base suficiente
--     (`COMPARAVEL_MINIMO`); abaixo disso ela imprime os dois números e diz
--     que não dá para tirar tendência.
--   * NÃO COMPARA PESSOAS. São duas (Matheus e Heloísa). Ranking entre elas
--     não muda decisão nenhuma e o RF-MET-09/RF-AST-06 o proíbem. A comparação
--     que serve é com a semana anterior, e é a única que este relatório faz.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 1. O relatório guardado
-- ---------------------------------------------------------------------------
create table if not exists public.weekly_reports (
  semana_inicio date primary key,
  semana_fim    date        not null,
  parcial       boolean     not null default false,
  fatos         jsonb       not null,
  texto         text        not null,
  gerado_em     timestamptz not null default now(),
  gerado_por    text        not null default 'cron',
  gerado_por_id uuid references public.profiles (id) on delete set null,
  constraint weekly_reports_semana_fecha check (semana_fim = semana_inicio + 6),
  constraint weekly_reports_origem_conhecida check (gerado_por in ('cron', 'manual'))
);
alter table public.weekly_reports enable row level security;

comment on table public.weekly_reports is
  'O relatório de segunda (RF-REL-09), uma linha por semana, chaveada pela segunda-feira em America/Fortaleza. Guarda os FATOS (jsonb, auditáveis) e o TEXTO pronto para ler. Não guarda agregado que a tela possa recalcular: guarda o que foi dito, para que o relatório de uma semana continue dizendo o que disse mesmo quando o dado de trás mudar.';
comment on column public.weekly_reports.parcial is
  'true quando a semana ainda não terminou no momento da geração. O texto avisa: meia semana comparada com uma semana inteira é comparação torta.';
comment on column public.weekly_reports.fatos is
  'JSON de fatos (versão 1): semana, anterior, números com rótulo e marca de proxy, o que avançou, o que esfriou, a base por temperatura, o que merece atenção e as dependências não ligadas. É a entrada da narração por IA quando ela existir (RF-REL-01, ADR-10).';
comment on column public.weekly_reports.gerado_por is
  'cron (segunda 08:00, America/Fortaleza) ou manual (alguém pediu de novo na tela).';

create index if not exists weekly_reports_gerado_em_idx on public.weekly_reports (gerado_em desc);

-- Leitura pelo mesmo critério dos outros relatórios (app.sees_all): admin,
-- gestor, sdr, leitura e financeiro. Embaixador enxerga a própria carteira
-- (RF-ADM-01) e um relatório do time inteiro não é a carteira dele.
--
-- Não há política de INSERT, UPDATE ou DELETE: quem escreve é a função definer.
-- Relatório que alguém pode reescrever pela API não é registro, é rascunho.
drop policy if exists weekly_reports_select on public.weekly_reports;
create policy weekly_reports_select on public.weekly_reports for select to authenticated
  using ((select app.sees_all()));

-- `alter default privileges` da migração 000500 dá insert/update/delete em toda
-- tabela nova de `public` a `authenticated`. Aqui isso é retirado no braço: sem
-- política de escrita a RLS já barraria (a linha some do `using`), mas um
-- relatório que só não é reescrito porque falta política depende de a política
-- nunca ser afrouxada. Sem o privilégio, o banco recusa antes de olhar a RLS.
grant  select on public.weekly_reports to authenticated, service_role;
revoke insert, update, delete, truncate on public.weekly_reports from authenticated;
revoke all on public.weekly_reports from anon;


-- ---------------------------------------------------------------------------
-- 2. Utilitários de escrita em português
-- ---------------------------------------------------------------------------
-- Ficam em `app` porque só o texto do relatório os usa. São puros: mesma
-- entrada, mesma saída, sem tocar em tabela nenhuma.

create or replace function app.numero_pt(p_valor numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_valor is null then '—'
           else pg_catalog.regexp_replace(
                  pg_catalog.btrim(pg_catalog.to_char(pg_catalog.round(p_valor), 'FM999999999')),
                  '(\d)(?=(\d{3})+$)', '\1.', 'g')
         end
$$;
comment on function app.numero_pt(numeric) is
  'Inteiro com ponto de milhar do português (1.234). Nulo vira travessão. Não depende de lc_numeric.';

create or replace function app.percentual_pt(p_valor numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_valor is null then '—'
           else pg_catalog.replace(
                  pg_catalog.to_char(pg_catalog.round(p_valor, 1), 'FM990.0'), '.', ',') || '%'
         end
$$;
comment on function app.percentual_pt(numeric) is
  'Percentual com vírgula decimal (28,0%). Nulo vira travessão: sem denominador não há taxa.';

create or replace function app.plural_pt(p_n numeric, p_um text, p_muitos text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_n = 1 then p_um else p_muitos end
$$;
comment on function app.plural_pt(numeric, text, text) is
  'Escolhe singular ou plural. Um só lugar para a concordância do relatório.';

create or replace function app.data_pt(p_data date)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.to_char(p_data, 'DD/MM')
$$;
comment on function app.data_pt(date) is 'Dia e mês (07/09), que é como se fala de uma semana.';


-- ---------------------------------------------------------------------------
-- 3. O catálogo dos números
-- ---------------------------------------------------------------------------
-- O rótulo, a definição e a marca de PROXY moram no banco, não na tela. É o que
-- garante que o CSV, o XLSX, o texto do WhatsApp (quando houver) e a tela digam
-- a mesma coisa sobre o mesmo número — e que "publicados" apareça marcado como
-- proxy do funil em todos eles, do mesmo jeito que as outras telas já fazem.
create or replace function app.relatorio_semanal_catalogo()
returns table (ordem int, chave text, rotulo text, ajuda text, proxy boolean)
language sql
immutable
set search_path = ''
as $$
  values
    (1,  'alvos_novos',         'Alvos novos na base',
         'Organizações criadas na semana, por qualquer caminho da esteira (planilha, Radar, cadastro manual).', false),
    (2,  'portas_batidas',      'Contatos (portas batidas)',
         'Tentativas de contato que contam pela regra do RF-MET-01: no máximo uma por alvo por dia.', false),
    (3,  'portas_abertas',      'Portas abertas',
         'Contatos em que o outro lado respondeu, no máximo um por alvo a cada 30 dias (RF-MET-01).', false),
    (4,  'ligacoes',            'Ligações',
         'Atividades registradas como ligação, com ou sem resposta.', false),
    (5,  'visitas',             'Visitas',
         'Atividades registradas como visita presencial.', false),
    (6,  'mensagens',           'Mensagens',
         'Atividades registradas como mensagem (WhatsApp, DM), enviadas ou recebidas.', false),
    (7,  'reunioes_marcadas',   'Reuniões marcadas',
         'Negócios que entraram em Reunião marcada ou Demonstração marcada na semana.', false),
    (8,  'reunioes_realizadas', 'Reuniões realizadas',
         'Atividades de reunião registradas na semana, sem os no-show.', false),
    (9,  'autorizacoes',        'Autorizações registradas',
         'Negócios que entraram em Autorizou ou Parceria aceita. É o que a LGPD exige antes do pré-cadastro (RF-PRE-01).', false),
    (10, 'cadastros_iniciados', 'Cadastros iniciados',
         'Negócios que entraram em Cadastro em andamento. PROXY do funil: a verdade do cadastro está na plataforma Komune, cuja integração ainda não está ligada.', true),
    (11, 'publicados',          'Publicados',
         'Negócios ganhos no funil de fornecedor. PROXY do funil: quem sabe se o perfil está publicado é a plataforma Komune, e a integração ainda não está ligada.', true),
    (12, 'avancos',             'Avanços de etapa',
         'Mudanças de etapa que subiram na linha do funil. Perda, opt-out e nutrição não contam como avanço.', false),
    (13, 'esfriaram',           'Esfriaram',
         'Mudanças de etapa para Perdido, Opt-out ou Nutrição.', false),
    (14, 'optouts',             'Pedidos de não contatar',
         'Opt-outs registrados em consent_events. Cada um vira supressão imediata, em qualquer modo (guardrail do CLAUDE.md).', false),
    (15, 'tarefas_com_prazo',   'Próximas ações com prazo',
         'Tarefas cujo prazo caía na semana, canceladas fora. É o denominador do prazo (RF-REL-10).', false),
    (16, 'tarefas_no_prazo',    'Próximas ações no prazo',
         'Tarefas concluídas até o prazo. Aberta e vencida conta como atrasada (RF-REL-10).', false)
$$;
comment on function app.relatorio_semanal_catalogo() is
  'Rótulo, definição e marca de proxy de cada número do relatório de segunda. Fonte única para a tela, o CSV, o XLSX e o texto.';


-- ---------------------------------------------------------------------------
-- 4. Os números de um intervalo
-- ---------------------------------------------------------------------------
-- Uma função só, chamada duas vezes (semana e semana anterior). Se a semana
-- passada fosse calculada por outra consulta, a comparação compararia duas
-- definições — que é o jeito clássico de um relatório mentir sem errar conta.
create or replace function app.relatorio_semanal_numeros(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_de   timestamptz := (p_de::timestamp) at time zone 'America/Fortaleza';
  v_fim  timestamptz := ((p_ate + 1)::timestamp) at time zone 'America/Fortaleza';
  v_out  jsonb;
begin
  select pg_catalog.jsonb_build_object(
           'alvos_novos',         al.n,
           'portas_batidas',      po.batidas,
           'portas_abertas',      po.abertas,
           'ligacoes',            po.ligacoes,
           'visitas',             po.visitas,
           'mensagens',           po.mensagens,
           'reunioes_realizadas', po.reunioes,
           'reunioes_marcadas',   mo.marcadas,
           'autorizacoes',        mo.autorizacoes,
           'cadastros_iniciados', mo.cadastros,
           'publicados',          mo.publicados,
           'avancos',             mo.avancos,
           'esfriaram',           mo.esfriaram,
           'optouts',             ct.optouts,
           'tarefas_com_prazo',   tf.com_prazo,
           'tarefas_no_prazo',    tf.no_prazo)
    into v_out
    from (select
            count(*) filter (where pc.batida_conta)::int as batidas,
            count(*) filter (where pc.aberta_conta)::int as abertas,
            count(*) filter (where pc.type = 'call'::app.activity_type)::int    as ligacoes,
            count(*) filter (where pc.type = 'visit'::app.activity_type)::int   as visitas,
            count(*) filter (where pc.type = 'message'::app.activity_type)::int as mensagens,
            count(*) filter (where pc.type = 'meeting'::app.activity_type
                               and coalesce(pc.desfecho, '') <> 'reu_no_show')::int as reunioes
            from app.portas_contadas pc
           where pc.occurred_at >= v_de and pc.occurred_at < v_fim) po,
         -- `sa` é a etapa DE ONDE saiu. Sem ela a linha é o nascimento do
         -- negócio, e nascer não é avançar.
         (select
            count(*) filter (where s.slug in ('reuniao_marcada', 'demonstracao_marcada'))::int as marcadas,
            count(*) filter (where s.slug in ('autorizou', 'parceria_aceita'))::int            as autorizacoes,
            count(*) filter (where s.slug = 'cadastro_em_andamento')::int                      as cadastros,
            count(*) filter (where s.is_won and pl.slug = 'fornecedor')::int                   as publicados,
            count(*) filter (where sa.position is not null and s.position > sa.position
                               and not s.is_lost and not s.is_dormant)::int                    as avancos,
            count(*) filter (where s.is_lost or s.is_dormant)::int                             as esfriaram
            from public.deal_stage_history h
            join public.stages    s  on s.id  = h.to_stage_id
            join public.pipelines pl on pl.id = s.pipeline_id
            join public.deals     d  on d.id  = h.deal_id
            join public.organizations o on o.id = d.organization_id and o.deleted_at is null
            left join public.stages sa on sa.id = h.from_stage_id
           where h.changed_at >= v_de and h.changed_at < v_fim) mo,
         (select count(*)::int as n
            from public.organizations o
           where o.deleted_at is null
             and o.created_at >= v_de and o.created_at < v_fim) al,
         (select count(*)::int as optouts
            from public.consent_events ce
           where ce.kind = 'contact_optout'::app.consent_kind
             and ce.occurred_at >= v_de and ce.occurred_at < v_fim) ct,
         -- RF-REL-10, a única fórmula de prazo do sistema, com o mesmo recorte
         -- de public.relatorio_por_responsavel: denominador = tarefas com prazo
         -- na semana; numerador = concluídas até o prazo.
         (select count(*)::int as com_prazo,
                 count(*) filter (where t.completed_at is not null
                                    and t.completed_at <= t.due_at)::int as no_prazo
            from public.tasks t
           where t.due_at is not null
             and t.status <> 'cancelled'::app.task_status
             and t.due_at >= v_de and t.due_at < v_fim) tf;

  return v_out;
end $$;
comment on function app.relatorio_semanal_numeros(date, date) is
  'Os 16 números do relatório de segunda para o intervalo fechado [p_de, p_ate], em America/Fortaleza. A mesma função calcula a semana e a semana anterior, para que a comparação compare a mesma definição.';


-- ---------------------------------------------------------------------------
-- 5. Os fatos da semana
-- ---------------------------------------------------------------------------
-- Quantas unidades os dois lados precisam ter para que uma DIREÇÃO possa ser
-- afirmada. Abaixo disso o relatório imprime os dois números e cala a boca
-- sobre tendência: 2 contra 1 não é alta de 100%, é duas semanas fracas.
create or replace function app.relatorio_semanal_comparavel_minimo()
returns int
language sql
immutable
set search_path = ''
as $$ select 5 $$;
comment on function app.relatorio_semanal_comparavel_minimo() is
  'Base mínima nos DOIS lados para o relatório afirmar direção (subiu/caiu). Abaixo disso, só os dois números.';

create or replace function app.relatorio_semanal_fatos(p_semana_inicio date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hoje      date := (pg_catalog.now() at time zone 'America/Fortaleza')::date;
  v_ini       date := (pg_catalog.date_trunc('week', p_semana_inicio::timestamp))::date;
  v_fim       date := v_ini + 6;
  v_ant_ini   date := v_ini - 7;
  v_ant_fim   date := v_ini - 1;
  v_min       int  := app.relatorio_semanal_comparavel_minimo();
  v_agora     jsonb;
  v_antes     jsonb;
  v_numeros   jsonb;
  v_avancos   jsonb;
  v_esfriou   jsonb;
  v_base      jsonb;
  v_atencao   jsonb;
  v_candidatas jsonb;
  v_semanas   int;
  v_fatos     jsonb;
begin
  v_agora := app.relatorio_semanal_numeros(v_ini, v_fim);
  v_antes := app.relatorio_semanal_numeros(v_ant_ini, v_ant_fim);

  -- 5.1 Números com rótulo, delta e a marca de "dá para comparar?".
  select pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'chave',      c.chave,
             'rotulo',     c.rotulo,
             'ajuda',      c.ajuda,
             'proxy',      c.proxy,
             'semana',     (v_agora ->> c.chave)::int,
             'anterior',   (v_antes ->> c.chave)::int,
             'delta',      (v_agora ->> c.chave)::int - (v_antes ->> c.chave)::int,
             'comparavel', ((v_agora ->> c.chave)::int >= v_min
                            and (v_antes ->> c.chave)::int >= v_min))
           order by c.ordem)
    into v_numeros
    from app.relatorio_semanal_catalogo() c;

  -- 5.2 O que avançou, por etapa de destino.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.n desc, x.etapa),
                  '[]'::jsonb)
    into v_avancos
    from (select s.name as etapa, pl.name as funil, count(*)::int as n
            from public.deal_stage_history h
            join public.stages    s  on s.id  = h.to_stage_id
            join public.stages    sa on sa.id = h.from_stage_id
            join public.pipelines pl on pl.id = s.pipeline_id
            join public.deals     d  on d.id  = h.deal_id
            join public.organizations o on o.id = d.organization_id and o.deleted_at is null
           where h.changed_at >= (v_ini::timestamp) at time zone 'America/Fortaleza'
             and h.changed_at <  ((v_fim + 1)::timestamp) at time zone 'America/Fortaleza'
             and s.position > sa.position
             and not s.is_lost and not s.is_dormant
           group by s.name, pl.name) x;

  -- 5.3 O que esfriou, por etapa de destino.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.n desc, x.etapa),
                  '[]'::jsonb)
    into v_esfriou
    from (select s.name as etapa, pl.name as funil, count(*)::int as n
            from public.deal_stage_history h
            join public.stages    s  on s.id  = h.to_stage_id
            join public.pipelines pl on pl.id = s.pipeline_id
            join public.deals     d  on d.id  = h.deal_id
            join public.organizations o on o.id = d.organization_id and o.deleted_at is null
           where h.changed_at >= (v_ini::timestamp) at time zone 'America/Fortaleza'
             and h.changed_at <  ((v_fim + 1)::timestamp) at time zone 'America/Fortaleza'
             and (s.is_lost or s.is_dormant)
           group by s.name, pl.name) x;

  -- 5.4 A base de HOJE por temperatura (foto de agora, não da semana — e o
  -- texto diz isso). Toda faixa da escala aparece, inclusive com zero.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.ordem), '[]'::jsonb)
    into v_base
    from (select t.temperatura,
                 t.ordem,
                 (select count(*)::int from public.organizations o
                   where o.deleted_at is null and o.temperature = t.temperatura) as organizacoes
            from (values ('frio'::app.temperature, 1), ('morno', 2), ('quente', 3),
                         ('cliente', 4), ('cliente_ativo', 5)) t(temperatura, ordem)) x;

  -- 5.5 Quantas semanas civis já tiveram QUALQUER registro humano. É o que
  -- autoriza (ou não) a palavra "tendência" no texto.
  select count(distinct pg_catalog.date_trunc('week',
                (a.occurred_at at time zone 'America/Fortaleza')))::int
    into v_semanas
    from public.activities a
   where a.type <> 'system'::app.activity_type;

  -- 5.6 O que merece atenção: regras com peso, as três primeiras que dispararem.
  --
  -- Só entra o que tem número maior que zero. Quando menos de três disparam, a
  -- lista sai menor — encher com item inventado é exatamente o que a casa não
  -- faz. Nenhuma regra devolve nome, telefone ou e-mail: o relatório é
  -- contagem, e revelar contato tem caminho próprio e auditado (pii_access_log).
  --
  -- GUARDRAIL: as três regras que são CHAMADO PARA AGIR (quente parado, sem
  -- próxima ação, respondeu e ninguém voltou) excluem quem pediu para não ser
  -- contatado. Cobrar retorno de um alvo suprimido é convidar ao toque proibido,
  -- e o relatório não faz esse convite nem em número agregado.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(y) order by y.peso desc, y.chave),
                  '[]'::jsonb)
    into v_candidatas
    from (select x.chave, x.titulo, x.texto, x.numero, x.peso
            from (
              select 'sem_registro' as chave,
                     'A semana não teve contato nenhum' as titulo,
                     'Nenhuma porta batida entrou no sistema entre '
                       || app.data_pt(v_ini) || ' e ' || app.data_pt(v_fim)
                       || '. Ou ninguém falou com ninguém, ou o que foi falado não foi registrado — e os dois casos precisam de resposta.' as texto,
                     1 as numero,
                     100 as peso
               where (v_agora ->> 'portas_batidas')::int = 0

              union all
              select 'optouts',
                     app.numero_pt((v_agora ->> 'optouts')::int) || ' '
                       || app.plural_pt((v_agora ->> 'optouts')::int,
                                        'pedido para não contatar', 'pedidos para não contatar'),
                     'Cada um já virou supressão imediata. Vale olhar por qual canal e em que momento da conversa vieram, porque opt-out em série é sintoma de abordagem, não de azar.',
                     (v_agora ->> 'optouts')::int,
                     95
               where (v_agora ->> 'optouts')::int > 0

              union all
              select 'quentes_parados',
                     app.numero_pt(q.n) || ' ' || app.plural_pt(q.n, 'negócio quente parado',
                                                                'negócios quentes parados'),
                     'Passaram do prazo da própria etapa sem atividade nova. É o estoque mais caro do funil: chegou perto e está esfriando sozinho.',
                     q.n, 90
                from (select count(*)::int as n
                        from public.deals d
                        join public.organizations o on o.id = d.organization_id
                                                   and o.deleted_at is null
                                                   and not o.do_not_contact
                        join public.stages st on st.id = d.stage_id
                       where d.status = 'open'::app.deal_status
                         and st.temperature = 'quente'::app.temperature
                         and st.sla_hours is not null
                         and coalesce(d.last_activity_at, d.entered_stage_at)
                             < pg_catalog.now() - pg_catalog.make_interval(hours => st.sla_hours)) q
               where q.n > 0

              union all
              select 'portas_sem_retorno',
                     app.numero_pt(r.n) || ' ' || app.plural_pt(r.n,
                       'alvo respondeu e ninguém voltou', 'alvos responderam e ninguém voltou'),
                     'Responder é a parte difícil da semana; deixar esfriar depois disso é desperdício puro. A conta é por ALVO, e não por porta: quem respondeu duas vezes continua sendo uma pessoa só esperando.',
                     r.n, 85
                from (select count(*)::int as n
                        from (select pc.organization_id, max(pc.occurred_at) as ultima
                                from app.portas_contadas pc
                                join public.organizations o on o.id = pc.organization_id
                                                          and o.deleted_at is null
                                                          and not o.do_not_contact
                               where pc.aberta_conta
                                 and pc.occurred_at >= (v_ini::timestamp) at time zone 'America/Fortaleza'
                                 and pc.occurred_at <  ((v_fim + 1)::timestamp) at time zone 'America/Fortaleza'
                               group by pc.organization_id) ab
                       where not exists (select 1 from app.portas p2
                                          where p2.organization_id = ab.organization_id
                                            and p2.occurred_at > ab.ultima)) r
               where r.n > 0

              union all
              select 'tarefas_vencidas',
                     app.numero_pt(t.n) || ' ' || app.plural_pt(t.n, 'próxima ação vencida em aberto',
                                                                'próximas ações vencidas em aberto'),
                     'O prazo passou e a tarefa continua de pé. Pela fórmula do RF-REL-10 elas já contam como atrasadas.',
                     t.n, 80
                from (select count(*)::int as n
                        from public.tasks t
                       where t.status in ('todo'::app.task_status, 'doing'::app.task_status)
                         and t.due_at is not null and t.due_at < pg_catalog.now()) t
               where t.n > 0

              union all
              select 'sem_proxima_acao',
                     app.numero_pt(n.n) || ' ' || app.plural_pt(n.n, 'negócio aberto sem próxima ação',
                                                                'negócios abertos sem próxima ação'),
                     'Negócio sem próxima ação marcada não aparece em fila nenhuma e some da rotina. É o vazamento mais silencioso do funil.',
                     n.n, 70
                from (select count(*)::int as n
                        from public.deals d
                        join public.organizations o on o.id = d.organization_id
                                                   and o.deleted_at is null
                                                   and not o.do_not_contact
                        join public.stages st on st.id = d.stage_id
                       where d.status = 'open'::app.deal_status
                         and d.next_action_at is null
                         and not st.is_terminal) n
               where n.n > 0

              union all
              select 'sem_telefone',
                     app.numero_pt(s.sem) || ' de ' || app.numero_pt(s.total)
                       || ' alvos da base sem telefone',
                     'Sem telefone não há porta para bater: '
                       || app.percentual_pt(case when s.total > 0 then s.sem * 100.0 / s.total end)
                       || ' da base só dá para trabalhar depois de enriquecer o contato.',
                     s.sem, 60
                from (select count(*)::int as total,
                             count(*) filter (where o.phone_e164 is null)::int as sem
                        from public.organizations o
                       where o.deleted_at is null and not o.do_not_contact) s
               where s.sem > 0

              union all
              select 'categorias_sem_publicado',
                     app.numero_pt(c.n) || ' ' || app.plural_pt(c.n, 'categoria com alvo e sem ninguém publicado',
                                                                'categorias com alvo e sem ninguém publicado'),
                     'Têm alvo na base e nenhum fornecedor publicado. São as categorias que a meta de densidade do RF-REL-03 cobra primeiro.',
                     c.n, 55
                from (select count(*)::int as n
                        from public.categories ct
                       where ct.is_active
                         and exists (select 1 from public.organization_categories oc
                                       join public.organizations o on o.id = oc.organization_id
                                      where oc.category_id = ct.id and o.deleted_at is null)
                         and not exists (select 1 from public.organization_categories oc
                                           join public.deals d on d.organization_id = oc.organization_id
                                           join public.stages s on s.id = d.stage_id
                                          where oc.category_id = ct.id and s.is_won)) c
               where c.n > 0
            ) x
           order by x.peso desc, x.chave) y;

  -- A tela e o texto mostram TRÊS. As demais ficam guardadas em `atencao_todas`:
  -- quem lê o relatório na segunda não aguenta uma lista de oito, mas quem for
  -- auditar a semana depois precisa saber o que mais havia disparado.
  select coalesce(pg_catalog.jsonb_agg(t.valor order by t.pos), '[]'::jsonb)
    into v_atencao
    from pg_catalog.jsonb_array_elements(v_candidatas) with ordinality as t(valor, pos)
   where t.pos <= 3;

  v_fatos := pg_catalog.jsonb_build_object(
    'versao', 1,
    'semana', pg_catalog.jsonb_build_object(
                'inicio', v_ini, 'fim', v_fim,
                'rotulo', app.data_pt(v_ini) || ' a ' || app.data_pt(v_fim),
                'parcial', v_fim >= v_hoje,
                'dias_uteis', app.business_days(v_ini, least(v_fim, v_hoje))),
    'anterior', pg_catalog.jsonb_build_object(
                'inicio', v_ant_ini, 'fim', v_ant_fim,
                'rotulo', app.data_pt(v_ant_ini) || ' a ' || app.data_pt(v_ant_fim)),
    'gerado_em', pg_catalog.to_char(pg_catalog.now() at time zone 'America/Fortaleza',
                                    'DD/MM/YYYY') || ' às '
                 || pg_catalog.to_char(pg_catalog.now() at time zone 'America/Fortaleza', 'HH24:MI'),
    'comparavel_minimo', v_min,
    'semanas_com_registro', v_semanas,
    'cedo', v_semanas < 3,
    'numeros', v_numeros,
    'avancos', v_avancos,
    'esfriaram', v_esfriou,
    'base', v_base,
    'atencao', v_atencao,
    'atencao_todas', v_candidatas,
    'dependencias', pg_catalog.jsonb_build_array(
      'A entrega automática (resumo no grupo de growth, e-mail ou arquivo anexo) depende de um canal que o CRM ainda não tem: o inbox fala com fornecedor, um a um, e não há canal de e-mail. Enquanto isso o relatório é gerado na segunda, guardado e mostrado aqui.',
      'Cadastros iniciados e publicados saem do FUNIL, não da plataforma Komune. A integração (Edge Function crm-pre-registration + webhook de status) ainda não está ligada, então os dois são proxy declarado.',
      'A narração por IA (RF-REL-01, ADR-10) ainda não entrou: este texto é montado por regra a partir dos mesmos fatos, sempre igual.'));

  return v_fatos;
end $$;
comment on function app.relatorio_semanal_fatos(date) is
  'O JSON de fatos da semana que contém p_semana_inicio (normalizada para a segunda): números com rótulo e delta, o que avançou, o que esfriou, a base por temperatura, até três coisas que merecem atenção e as dependências não ligadas. É a entrada do texto e, quando existir, da narração por IA.';


-- ---------------------------------------------------------------------------
-- 6. As três frases que o texto repete
-- ---------------------------------------------------------------------------

-- A comparação com a semana anterior, e SÓ ela: com duas pessoas na operação,
-- comparar uma com a outra não muda decisão nenhuma (e o RF-MET-09 proíbe).
-- A palavra de direção ("a mais", "a menos") só aparece quando os dois lados
-- têm base; abaixo disso saem os dois números e a ressalva.
create or replace function app.frase_variacao_semanal(p_numero jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when (p_numero ->> 'semana')::int = 0 and (p_numero ->> 'anterior')::int = 0
      then 'Zero nas duas semanas.'
    when (p_numero ->> 'comparavel')::boolean and (p_numero ->> 'delta')::int > 0
      then app.numero_pt((p_numero ->> 'delta')::int) || ' a mais que na semana passada ('
           || app.numero_pt((p_numero ->> 'anterior')::int) || ').'
    when (p_numero ->> 'comparavel')::boolean and (p_numero ->> 'delta')::int < 0
      then app.numero_pt(-(p_numero ->> 'delta')::int) || ' a menos que na semana passada ('
           || app.numero_pt((p_numero ->> 'anterior')::int) || ').'
    when (p_numero ->> 'comparavel')::boolean
      then 'O mesmo da semana passada.'
    else 'Na semana passada, ' || app.numero_pt((p_numero ->> 'anterior')::int)
         || '. Com esta base ainda não dá para chamar de tendência.'
  end
$$;
comment on function app.frase_variacao_semanal(jsonb) is
  'A frase de comparação com a semana anterior de UM número do relatório. Só afirma direção quando os dois lados passam do mínimo comparável; senão imprime os dois números e diz que não dá para tirar tendência de dois pontos pequenos.';

-- "4 para Contatado, 2 para Respondeu e 1 para Reunião marcada"
create or replace function app.lista_de_etapas(p_lista jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  -- A última vírgula vira " e ": é como se fala, e o relatório é para ser lido.
  select coalesce(
           pg_catalog.regexp_replace(
             pg_catalog.string_agg(t.frase, ', ' order by t.ordem), ', ([^,]*)$', ' e \1'),
           'nenhuma etapa')
    from (select (x ->> 'n')::int || ' para ' || (x ->> 'etapa') as frase,
                 pg_catalog.row_number() over () as ordem
            from pg_catalog.jsonb_array_elements(p_lista) x) t
$$;
comment on function app.lista_de_etapas(jsonb) is
  'Enumera "N para <etapa>" na ordem em que os fatos vieram (a etapa com mais movimento primeiro).';

-- "100 organizações: 100 frias, 0 mornas, 0 quentes, 0 clientes"
create or replace function app.lista_da_base(p_base jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select app.numero_pt(pg_catalog.sum((x ->> 'organizacoes')::int))
         || ' ' || app.plural_pt(pg_catalog.sum((x ->> 'organizacoes')::int),
                                 'organização na base', 'organizações na base')
         || ': '
         || pg_catalog.string_agg(
              app.numero_pt((x ->> 'organizacoes')::int) || ' '
              || case x ->> 'temperatura'
                   when 'frio'          then app.plural_pt((x ->> 'organizacoes')::int, 'fria', 'frias')
                   when 'morno'         then app.plural_pt((x ->> 'organizacoes')::int, 'morna', 'mornas')
                   when 'quente'        then app.plural_pt((x ->> 'organizacoes')::int, 'quente', 'quentes')
                   when 'cliente'       then app.plural_pt((x ->> 'organizacoes')::int, 'cliente', 'clientes')
                   else                      app.plural_pt((x ->> 'organizacoes')::int,
                                                           'cliente ativo', 'clientes ativos')
                 end,
              ', ' order by (x ->> 'ordem')::int)
    from pg_catalog.jsonb_array_elements(p_base) x
$$;
comment on function app.lista_da_base(jsonb) is
  'A base de hoje em uma frase, na ordem da escala térmica. Toda faixa aparece, inclusive a que está em zero.';


-- ---------------------------------------------------------------------------
-- 7. O texto, escrito para ser lido no celular
-- ---------------------------------------------------------------------------
-- Regra de escrita: frase curta, o número e o que ele quer dizer. Sem tabela,
-- sem painel, sem "KPI". Quem lê é o Rafael, de pé, no domingo à noite ou na
-- segunda de manhã, e o que ele precisa saber cabe em uma tela e meia.
create or replace function app.relatorio_semanal_texto(p_fatos jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_l      text[] := array[]::text[];
  v_n      jsonb;
  v_item   jsonb;
  v_i      int := 0;
  v_batidas int; v_abertas int; v_marcadas int; v_realizadas int;
  v_alvos  int; v_cad int; v_pub int; v_avc int; v_esf int;
  v_prazo_den int; v_prazo_num int;
begin
  -- `numeros` vira um mapa chave -> objeto, para o texto não varrer o array
  -- oito vezes.
  select pg_catalog.jsonb_object_agg(x ->> 'chave', x)
    into v_n
    from pg_catalog.jsonb_array_elements(p_fatos -> 'numeros') x;

  v_batidas    := (v_n -> 'portas_batidas'      ->> 'semana')::int;
  v_abertas    := (v_n -> 'portas_abertas'      ->> 'semana')::int;
  v_marcadas   := (v_n -> 'reunioes_marcadas'   ->> 'semana')::int;
  v_realizadas := (v_n -> 'reunioes_realizadas' ->> 'semana')::int;
  v_alvos      := (v_n -> 'alvos_novos'         ->> 'semana')::int;
  v_cad        := (v_n -> 'cadastros_iniciados' ->> 'semana')::int;
  v_pub        := (v_n -> 'publicados'          ->> 'semana')::int;
  v_avc        := (v_n -> 'avancos'             ->> 'semana')::int;
  v_esf        := (v_n -> 'esfriaram'           ->> 'semana')::int;
  v_prazo_den  := (v_n -> 'tarefas_com_prazo'   ->> 'semana')::int;
  v_prazo_num  := (v_n -> 'tarefas_no_prazo'    ->> 'semana')::int;

  -- Cabeçalho -------------------------------------------------------------
  v_l := v_l || ('TRÍADE — a semana de ' || (p_fatos -> 'semana' ->> 'rotulo'));
  v_l := v_l || ('Gerado em ' || (p_fatos ->> 'gerado_em') || ', horário de Natal.');

  if (p_fatos -> 'semana' ->> 'parcial')::boolean then
    v_l := v_l || ''::text;
    v_l := v_l || 'Atenção: a semana ainda não acabou. Meia semana comparada com uma semana inteira dá diferença que não existe.'::text;
  end if;

  if (p_fatos ->> 'cedo')::boolean then
    v_l := v_l || ''::text;
    v_l := v_l || (case
                     when (p_fatos ->> 'semanas_com_registro')::int = 0
                       then 'É cedo. Nenhuma semana teve contato registrado ainda'
                     else 'É cedo. A operação tem '
                          || app.numero_pt((p_fatos ->> 'semanas_com_registro')::int) || ' '
                          || app.plural_pt((p_fatos ->> 'semanas_com_registro')::int,
                                           'semana com contato registrado',
                                           'semanas com contato registrado')
                   end
                   || ' — o que vem abaixo é o que aconteceu, não tendência. Zero aqui costuma querer dizer "ainda não", e não "não funciona".');
  end if;

  -- O topo ----------------------------------------------------------------
  v_l := v_l || ''::text;
  v_l := v_l || 'O TOPO'::text;
  v_l := v_l || ('· Contatos: ' || app.numero_pt(v_batidas) || '. '
                 || app.frase_variacao_semanal(v_n -> 'portas_batidas'));
  v_l := v_l || ('· Portas abertas: ' || app.numero_pt(v_abertas) || '. '
                 || case
                      when v_batidas = 0 then 'Sem contato não há resposta. '
                      else 'Responderam ' || app.percentual_pt(v_abertas * 100.0 / v_batidas)
                           || ' de quem foi procurado. '
                    end
                 || app.frase_variacao_semanal(v_n -> 'portas_abertas'));
  v_l := v_l || ('· Reuniões: ' || app.numero_pt(v_marcadas) || ' '
                 || app.plural_pt(v_marcadas, 'marcada', 'marcadas') || ' e '
                 || app.numero_pt(v_realizadas) || ' '
                 || app.plural_pt(v_realizadas, 'realizada', 'realizadas') || '. '
                 || case
                      when v_marcadas = 0 and v_realizadas = 0
                        then 'Nenhuma das duas coisas aconteceu.'
                      when v_marcadas > 0 and v_realizadas = 0
                        then 'Marcou e não sentou: o próximo relatório dirá se elas aconteceram.'
                      else 'A conta de marcada para realizada nunca fecha na mesma semana.'
                    end);
  v_l := v_l || ('· Alvos novos na base: ' || app.numero_pt(v_alvos) || '. '
                 || app.frase_variacao_semanal(v_n -> 'alvos_novos'));

  -- O funil ---------------------------------------------------------------
  v_l := v_l || ''::text;
  v_l := v_l || 'O FUNIL'::text;
  if v_avc = 0 then
    v_l := v_l || '· Nada avançou de etapa nesta semana.'::text;
  else
    v_l := v_l || ('· ' || app.numero_pt(v_avc) || ' '
                   || app.plural_pt(v_avc, 'avanço de etapa', 'avanços de etapa') || ': '
                   || app.lista_de_etapas(p_fatos -> 'avancos') || '.');
  end if;

  if v_esf = 0 then
    v_l := v_l || '· Nada esfriou: nenhum negócio foi para perdido, opt-out ou nutrição.'::text;
  else
    v_l := v_l || ('· ' || app.numero_pt(v_esf) || ' '
                   || app.plural_pt(v_esf, 'negócio esfriou', 'negócios esfriaram') || ': '
                   || app.lista_de_etapas(p_fatos -> 'esfriaram') || '.');
  end if;

  v_l := v_l || ('· Cadastros iniciados: ' || app.numero_pt(v_cad)
                 || ' · publicados: ' || app.numero_pt(v_pub)
                 || '. Os dois saem do funil, não da plataforma Komune: a integração ainda não está ligada, então são proxy.');

  if v_prazo_den = 0 then
    v_l := v_l || '· Próximas ações com prazo na semana: nenhuma. Sem tarefa com prazo não há o que medir de pontualidade.'::text;
  else
    v_l := v_l || ('· Próximas ações no prazo: ' || app.numero_pt(v_prazo_num) || ' de '
                   || app.numero_pt(v_prazo_den) || ' ('
                   || app.percentual_pt(v_prazo_num * 100.0 / v_prazo_den)
                   || '). Vencida e ainda aberta conta como atrasada.');
  end if;

  -- A base ----------------------------------------------------------------
  v_l := v_l || ''::text;
  v_l := v_l || 'A BASE HOJE (foto de agora, não da semana)'::text;
  v_l := v_l || ('· ' || app.lista_da_base(p_fatos -> 'base') || '.');

  -- Atenção ---------------------------------------------------------------
  v_l := v_l || ''::text;
  if pg_catalog.jsonb_array_length(p_fatos -> 'atencao') = 0 then
    v_l := v_l || 'O QUE MERECE ATENÇÃO'::text;
    v_l := v_l || '· Nenhuma das regras de alerta disparou nesta semana. Com uma base deste tamanho isso quer dizer pouco movimento, e não operação saudável.'::text;
  else
    v_l := v_l || ('O QUE MERECE ATENÇÃO ('
                   || app.numero_pt(pg_catalog.jsonb_array_length(p_fatos -> 'atencao'))
                   || ' de até 3)');
    for v_item in select x from pg_catalog.jsonb_array_elements(p_fatos -> 'atencao') x loop
      v_i := v_i + 1;
      v_l := v_l || (v_i::text || '. ' || (v_item ->> 'titulo') || '. ' || (v_item ->> 'texto'));
    end loop;
  end if;

  -- Dependências ----------------------------------------------------------
  v_l := v_l || ''::text;
  v_l := v_l || 'O QUE ESTE RELATÓRIO AINDA NÃO SABE'::text;
  for v_item in select x from pg_catalog.jsonb_array_elements(p_fatos -> 'dependencias') x loop
    v_l := v_l || ('· ' || (v_item #>> '{}'));
  end loop;

  return pg_catalog.array_to_string(v_l, pg_catalog.chr(10));
end $$;
comment on function app.relatorio_semanal_texto(jsonb) is
  'O relatório da semana em texto corrido, pronto para ler no celular (RF-REL-09). Determinístico: dos mesmos fatos sai sempre o mesmo texto. Quando a narração por IA entrar (ADR-10), ela recebe os mesmos fatos e este texto vira o fallback.';


-- ---------------------------------------------------------------------------
-- 8. Gerar e guardar
-- ---------------------------------------------------------------------------
-- O trabalho, sem checagem de papel: quem chama é o cron (sem auth.uid()) ou a
-- função pública abaixo, que já conferiu quem é. Uma linha por semana:
-- reaplicar reescreve os fatos e o texto e marca quem pediu.
create or replace function app.relatorio_semanal_gravar(
  p_semana_inicio date,
  p_por           text,
  p_por_id        uuid default null)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ini   date := (pg_catalog.date_trunc('week', p_semana_inicio::timestamp))::date;
  v_fatos jsonb;
begin
  v_fatos := app.relatorio_semanal_fatos(v_ini);

  insert into public.weekly_reports
         (semana_inicio, semana_fim, parcial, fatos, texto, gerado_em, gerado_por, gerado_por_id)
  values (v_ini, v_ini + 6, (v_fatos -> 'semana' ->> 'parcial')::boolean,
          v_fatos, app.relatorio_semanal_texto(v_fatos), pg_catalog.now(), p_por, p_por_id)
  on conflict (semana_inicio) do update
     set semana_fim    = excluded.semana_fim,
         parcial       = excluded.parcial,
         fatos         = excluded.fatos,
         texto         = excluded.texto,
         gerado_em     = excluded.gerado_em,
         gerado_por    = excluded.gerado_por,
         gerado_por_id = excluded.gerado_por_id;

  return v_ini;
end $$;
comment on function app.relatorio_semanal_gravar(date, text, uuid) is
  'Monta os fatos e o texto da semana e grava (uma linha por semana, reaplicável). Não confere papel: quem chama é o cron ou a função pública, que já conferiu.';

-- A porta da tela: gerar agora a semana pedida (padrão: a que acabou).
create or replace function public.relatorio_semanal_gerar(p_semana_inicio date default null)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (pg_catalog.now() at time zone 'America/Fortaleza')::date;
  v_ini  date;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;

  -- Sem parâmetro, a semana que acabou: é o relatório de segunda.
  v_ini := (pg_catalog.date_trunc('week',
             coalesce(p_semana_inicio, v_hoje - 7)::timestamp))::date;

  if v_ini > v_hoje then
    raise exception 'A semana de % ainda não começou', v_ini using errcode = '22007';
  end if;

  return app.relatorio_semanal_gravar(v_ini, 'manual', auth.uid());
end $$;
comment on function public.relatorio_semanal_gerar(date) is
  'Gera e guarda o relatório de uma semana (RF-REL-09). Sem parâmetro, a semana que acabou. Só para quem enxerga os relatórios (app.sees_all); reaplicar sobrescreve, porque o texto sai sempre dos mesmos fatos.';

-- O que o pg_cron chama na segunda de manhã.
create or replace function app.relatorio_semanal_cron()
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (pg_catalog.now() at time zone 'America/Fortaleza')::date;
begin
  -- A semana que acabou ontem. Rodando na segunda, `v_hoje - 7` cai na segunda
  -- anterior; rodando em qualquer outro dia (reexecução manual do job), cai na
  -- mesma semana fechada, e não na que está em curso.
  return app.relatorio_semanal_gravar(
           (pg_catalog.date_trunc('week', (v_hoje - 7)::timestamp))::date, 'cron', null);
end $$;
comment on function app.relatorio_semanal_cron() is
  'O que o pg_cron roda na segunda 08:00 (America/Fortaleza): gera e guarda o relatório da semana que acabou. Não envia nada — não existe canal de entrega ainda, e a tela diz isso.';


-- ---------------------------------------------------------------------------
-- 9. A leitura da tela
-- ---------------------------------------------------------------------------
create or replace function public.relatorio_semanal(p_semana_inicio date default null)
returns table (
  semana_inicio date,
  semana_fim    date,
  rotulo        text,
  parcial       boolean,
  texto         text,
  fatos         jsonb,
  gerado_em     timestamptz,
  gerado_por    text,
  gerado_por_nome text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;

  return query
  select r.semana_inicio, r.semana_fim,
         app.data_pt(r.semana_inicio) || ' a ' || app.data_pt(r.semana_fim),
         r.parcial, r.texto, r.fatos, r.gerado_em, r.gerado_por, p.full_name
    from public.weekly_reports r
    left join public.profiles p on p.id = r.gerado_por_id
   where p_semana_inicio is null
      or r.semana_inicio = (pg_catalog.date_trunc('week', p_semana_inicio::timestamp))::date
   -- Sem parâmetro, a tela abre na semana FECHADA mais recente, e não na que está
   -- em curso: o relatório de segunda é sobre a semana que acabou, e abrir num
   -- meio de semana faria o primeiro número que alguém vê ser meia semana.
   order by r.parcial, r.semana_inicio desc
   limit 1;
end $$;
comment on function public.relatorio_semanal(date) is
  'O relatório guardado de uma semana (RF-REL-09). Sem parâmetro, a semana FECHADA mais recente (uma semana em curso só aparece se for a única guardada). Zero linhas quer dizer "esta semana ainda não foi gerada" — e a tela oferece gerar, em vez de desenhar uma tela vazia sem explicação.';

create or replace function public.relatorios_semanais(p_semanas int default 8)
returns table (
  semana_inicio date,
  semana_fim    date,
  rotulo        text,
  parcial       boolean,
  gerado        boolean,
  gerado_em     timestamptz,
  gerado_por    text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje    date := (pg_catalog.now() at time zone 'America/Fortaleza')::date;
  v_atual   date := (pg_catalog.date_trunc('week', v_hoje::timestamp))::date;
  v_quantas int  := least(greatest(coalesce(p_semanas, 8), 1), 52);
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;

  -- As últimas N semanas civis, geradas ou não. A semana que ainda não foi
  -- gerada precisa aparecer na lista: é a diferença entre "não houve nada" e
  -- "ninguém gerou ainda", e as duas coisas pedem resposta diferente.
  return query
  select s.ini, s.ini + 6,
         app.data_pt(s.ini) || ' a ' || app.data_pt(s.ini + 6),
         (s.ini + 6) >= v_hoje,
         r.semana_inicio is not null,
         r.gerado_em, r.gerado_por
    from (select (v_atual - (g.i * 7))::date as ini
            from pg_catalog.generate_series(0, v_quantas - 1) g(i)) s
    left join public.weekly_reports r on r.semana_inicio = s.ini
   order by s.ini desc;
end $$;
comment on function public.relatorios_semanais(int) is
  'As últimas semanas civis (America/Fortaleza), com a marca de gerada ou não. É o seletor da tela e a prova de que uma segunda passou em branco.';


-- ---------------------------------------------------------------------------
-- 10. Agendamento (pg_cron) — America/Fortaleza = UTC−3
-- ---------------------------------------------------------------------------
-- `cron.timezone` do pg_cron é GMT; o horário abaixo soma 3 h.
-- `cron.schedule` com o mesmo nome reescreve o job que já existe: reaplicar a
-- migração não duplica agendamento.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- Segunda-feira, 08:00 em Natal. É o horário do ritual de growth (R07 §4),
    -- e o relatório precisa estar de pé antes de a reunião começar.
    perform cron.schedule('relatorio_semanal', '0 11 * * 1',
                          $cron$select app.relatorio_semanal_cron()$cron$);
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 11. Privilégios
-- ---------------------------------------------------------------------------
-- As funções de `app` não são superfície de API: quem as chama é o cron e as
-- funções definer de `public`. `authenticated` tem USAGE em `app` (migração
-- 000100), então revogar é obrigatório, não decorativo — `relatorio_semanal_*`
-- lê `app.portas_contadas`, que traz o alvo de toda atividade.
revoke all on function app.relatorio_semanal_numeros(date, date)   from public, anon, authenticated;
revoke all on function app.relatorio_semanal_fatos(date)           from public, anon, authenticated;
revoke all on function app.relatorio_semanal_texto(jsonb)          from public, anon, authenticated;
revoke all on function app.relatorio_semanal_gravar(date, text, uuid) from public, anon, authenticated;
revoke all on function app.relatorio_semanal_cron()                from public, anon, authenticated;

-- Utilitários de escrita e o catálogo são inofensivos (não leem tabela), mas
-- também não têm por que ser API.
revoke all on function app.numero_pt(numeric)                      from public, anon, authenticated;
revoke all on function app.percentual_pt(numeric)                  from public, anon, authenticated;
revoke all on function app.plural_pt(numeric, text, text)          from public, anon, authenticated;
revoke all on function app.data_pt(date)                           from public, anon, authenticated;
revoke all on function app.frase_variacao_semanal(jsonb)           from public, anon, authenticated;
revoke all on function app.lista_de_etapas(jsonb)                  from public, anon, authenticated;
revoke all on function app.lista_da_base(jsonb)                    from public, anon, authenticated;
revoke all on function app.relatorio_semanal_comparavel_minimo()   from public, anon, authenticated;

-- O catálogo dos números é a única coisa de `app` que a tela precisa ler para
-- desenhar o cabeçalho da tabela e a marca de proxy, mas ela já o recebe dentro
-- de `fatos`. Fica revogado também: uma porta a menos.
revoke all on function app.relatorio_semanal_catalogo()            from public, anon, authenticated;

revoke all on function public.relatorio_semanal_gerar(date)        from public, anon;
revoke all on function public.relatorio_semanal(date)              from public, anon;
revoke all on function public.relatorios_semanais(int)             from public, anon;

grant execute on function public.relatorio_semanal_gerar(date)     to authenticated, service_role;
grant execute on function public.relatorio_semanal(date)           to authenticated, service_role;
grant execute on function public.relatorios_semanais(int)          to authenticated, service_role;

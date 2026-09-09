-- =====================================================================
-- TRIADE — "Respostas recebidas" para de ser promessa e vira número
-- Corrige public.goal_progress (criada em 20260904001400_metas_e_relatorios.sql).
--
-- O DEFEITO
-- ---------------------------------------------------------------------
-- `public.goal_progress` devolve, por métrica, um par (`mensuravel`, `fonte`):
-- o segundo é uma frase em português que a tela de Metas IMPRIME, palavra por
-- palavra, em "Como cada número é contado" e no rodapé da folha de definição
-- de meta. Para `replies` a frase gravada era:
--
--     'Ainda não é medível: depende do inbox de WhatsApp (D5);
--      a tabela de mensagens não existe'
--
-- Duas afirmações, as duas falsas desde 20260905000200_ia_e_whatsapp.sql:
-- `public.messages` existe, e recebe — `app.wa_registrar_entrada` grava toda
-- mensagem que a Meta entrega, com o wamid como idempotência. E "D5" é dia de
-- cronograma interno: quem lê a tela não tem calendário do projeto na cabeça,
-- e a data já passou de qualquer forma.
--
-- A frase não era só feia. `mensuravel = false` faz a folha de meta esconder a
-- métrica do seletor (ela só oferece o que o banco sabe medir), então o gestor
-- que quisesse combinar "10 respostas nesta semana" não tinha onde clicar: a
-- opção não existia na tela, por causa de uma frase desatualizada no banco.
--
-- O CONSERTO
-- ---------------------------------------------------------------------
-- `replies` passa a ser contada, e a frase passa a descrever a contagem. As
-- quatro decisões da regra, porque nenhuma delas é óbvia:
--
--  1. DE QUEM É A RESPOSTA — de quem responde pela conversa
--     (`conversations.assignee_id`). É `not null` na tabela e garantido por
--     `app.conversations_before_write` ("conversa sem dono é impossível",
--     RF-CON-04), então toda resposta tem dono, sempre. A alternativa —
--     creditar quem mandou a última mensagem de saída — tem buraco:
--     `messages.sent_by` só é exigido de `author_kind = 'human'`; template de
--     cadência sai como `bot_fixed`, sem autor, e a resposta a ele ficaria
--     sem dono nenhum.
--
--  2. O QUE É RESPOSTA — mensagem recebida em fio onde a KOMUNE JÁ ESCREVEU, e
--     escreveu de verdade (`sent_at is not null`). Mensagem `queued` não saiu
--     e `failed` não chegou; contar "resposta" a uma delas seria contar
--     resposta a uma mensagem que nunca existiu para o outro lado. O preço
--     está declarado e é o lado certo de errar (mesmo argumento de
--     `app.portas_contadas`): quem responde no WhatsApp a uma LIGAÇÃO ou a uma
--     visita não entra aqui — aquilo é porta aberta, e já é contado como tal.
--
--  3. TETO — no máximo uma por conversa por dia, o mesmo formato antimanipulação
--     de `doors_knocked`. Sem ele, um parceiro animado que mandasse doze
--     mensagens seguidas viraria doze "respostas recebidas" e a meta do dia
--     fecharia sozinha.
--
--  4. QUEM PEDIU PARA SAIR CONTA. A mensagem em que alguém escreve "SAIR" é
--     resposta recebida: a métrica é volume de retorno, não de retorno bom.
--     Descontá-la depois seria pior — a supressão é gravada DEPOIS da
--     mensagem, e período fechado que muda de número quando ninguém mexeu
--     nele é número em que ninguém confia.
--
-- DE CARONA, O MESMO DEFEITO EM OUTRAS DUAS FRASES
-- ---------------------------------------------------------------------
-- "activities com desfecho do catálogo (RF-FUN-12)" e "exceto desfecho de
-- no-show (RF-MET-01)" também são impressas na tela, e sigla de requisito na
-- tela é o mesmo problema do "D5": jargão de quem escreveu o PRD, oferecido a
-- quem está com o celular na mão. As siglas saem das frases; a regra que elas
-- descrevem não muda em nada.
--
-- ÍNDICE NOVO? NÃO
-- ---------------------------------------------------------------------
-- A contagem anda por `messages_conv_idx (conversation_id, created_at)` e por
-- uma varredura de `conversations` pelo responsável, que não tem índice próprio.
-- Fica assim pelo mesmo motivo que a migração original não materializou nada: o
-- inbox do MVP tem centenas de fios, não milhões, e índice antes de existir
-- problema de leitura é peso sem contrapartida. Se `conversations` crescer, o
-- lugar do índice é a migração do módulo de WhatsApp, junto dos outros dela.
--
-- Nada mais desta função muda: mesma assinatura, mesmas colunas, mesmo
-- controle de acesso (definer, com a guarda "só gestor ou admin lê a meta de
-- outra pessoa"). Reaplicável: é `create or replace` sobre a mesma assinatura.
-- =====================================================================

create or replace function public.goal_progress(
  p_user_id uuid            default null,
  p_period  app.goal_period default 'day',
  p_ref     date            default null)
returns table (
  pessoa_id             uuid,
  pessoa_nome           text,
  metrica               text,
  metrica_rotulo        text,
  periodo               app.goal_period,
  periodo_inicio        date,
  periodo_fim           date,
  meta                  int,
  realizado             int,
  percentual            numeric,
  dias_uteis_total      int,
  dias_uteis_decorridos int,
  ritmo_necessario      numeric,
  mensuravel            boolean,
  fonte                 text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_alvo      uuid;
  v_periodo   app.goal_period := coalesce(p_period, 'day'::app.goal_period);
  v_hoje      date := (now() at time zone 'America/Fortaleza')::date;
  v_ini       date;
  v_fim       date;
  v_de        timestamptz;
  v_ate       timestamptz;
  v_total     int;
  v_decorrido int;
  v_restante  int;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_alvo := coalesce(p_user_id, v_uid);
  if v_alvo <> v_uid and not app.is_manager() then
    raise exception 'Só gestor ou admin lê a meta de outra pessoa' using errcode = '42501';
  end if;

  select b.period_start, b.period_end into v_ini, v_fim
    from app.goal_bounds(v_periodo, coalesce(p_ref, v_hoje)) b;
  v_de  := (v_ini::timestamp) at time zone 'America/Fortaleza';
  v_ate := ((v_fim + 1)::timestamp) at time zone 'America/Fortaleza';

  v_total     := app.business_days(v_ini, v_fim);
  v_decorrido := app.business_days(v_ini, least(v_fim, v_hoje));
  v_restante  := app.business_days(greatest(v_ini, v_hoje), v_fim);

  return query
  with catalogo (metric, rotulo, pode_medir, fonte, ordem) as (
    values
      ('doors_knocked',     'Portas batidas',      true,
       'activities com desfecho do catálogo; máx. 1 por alvo por dia', 1),
      ('doors_opened',      'Portas abertas',      true,
       'activities cujo desfecho vale porta aberta e com quem se falou é decisor ou influenciador; máx. 1 por alvo a cada 30 dias', 2),
      ('calls_made',        'Ligações',            true,
       'activities.type = call (com ou sem desfecho registrado)', 3),
      ('meetings_booked',   'Reuniões marcadas',   true,
       'deal_stage_history: entradas nas etapas "Reunião marcada" e "Demonstração marcada"', 4),
      ('meetings_done',     'Reuniões realizadas', true,
       'activities.type = meeting, exceto desfecho de no-show', 5),
      ('visits_done',       'Visitas',             true,
       'activities.type = visit', 6),
      ('new_targets',       'Alvos novos',         true,
       'organizations criadas no período com a pessoa como responsável', 7),
      ('pre_registrations', 'Cadastros iniciados', true,
       'PROXY: entradas na etapa "Cadastro em andamento". A fonte da verdade é a plataforma Komune, cuja integração ainda não está ligada', 8),
      ('published',         'Publicados',          true,
       'PROXY: entradas na etapa de ganho do funil de captação. A fonte da verdade é a plataforma Komune, cuja integração ainda não está ligada', 9),
      ('replies',           'Respostas recebidas', true,
       'mensagens recebidas nas conversas sob responsabilidade da pessoa, depois de a Komune ter escrito no fio; máx. 1 por conversa por dia', 10)
  ),
  feito as (
    select c.metric,
           (case c.metric
              when 'doors_knocked' then
                (select count(*) from app.portas_contadas pc
                  where pc.user_id = v_alvo and pc.batida_conta
                    and pc.occurred_at >= v_de and pc.occurred_at < v_ate)
              when 'doors_opened' then
                (select count(*) from app.portas_contadas pc
                  where pc.user_id = v_alvo and pc.aberta_conta
                    and pc.occurred_at >= v_de and pc.occurred_at < v_ate)
              when 'calls_made' then
                (select count(*) from app.portas p
                  where p.user_id = v_alvo and p.type = 'call'::app.activity_type
                    and p.occurred_at >= v_de and p.occurred_at < v_ate)
              when 'meetings_booked' then
                (select count(*) from public.deal_stage_history h
                   join public.stages s on s.id = h.to_stage_id
                   join public.deals  d on d.id = h.deal_id
                  where s.slug in ('reuniao_marcada', 'demonstracao_marcada')
                    and coalesce(h.changed_by, d.owner_id) = v_alvo
                    and h.changed_at >= v_de and h.changed_at < v_ate)
              when 'meetings_done' then
                (select count(*) from app.portas p
                  where p.user_id = v_alvo and p.type = 'meeting'::app.activity_type
                    and coalesce(p.desfecho, '') <> 'reu_no_show'
                    and p.occurred_at >= v_de and p.occurred_at < v_ate)
              when 'visits_done' then
                (select count(*) from app.portas p
                  where p.user_id = v_alvo and p.type = 'visit'::app.activity_type
                    and p.occurred_at >= v_de and p.occurred_at < v_ate)
              when 'new_targets' then
                (select count(*) from public.organizations o
                  where o.owner_id = v_alvo and o.deleted_at is null
                    and o.created_at >= v_de and o.created_at < v_ate)
              when 'pre_registrations' then
                (select count(*) from public.deal_stage_history h
                   join public.stages s on s.id = h.to_stage_id
                   join public.deals  d on d.id = h.deal_id
                  where s.slug = 'cadastro_em_andamento'
                    and coalesce(h.changed_by, d.owner_id) = v_alvo
                    and h.changed_at >= v_de and h.changed_at < v_ate)
              when 'published' then
                (select count(*) from public.deal_stage_history h
                   join public.stages    s  on s.id  = h.to_stage_id
                   join public.pipelines pl on pl.id = s.pipeline_id
                   join public.deals     d  on d.id  = h.deal_id
                  where s.is_won and pl.slug = 'fornecedor'
                    and coalesce(h.changed_by, d.owner_id) = v_alvo
                    and h.changed_at >= v_de and h.changed_at < v_ate)
              -- O dia é o de Natal, e não o do UTC: uma resposta das 22h de
              -- terça é resposta de terça para quem trabalha aqui. Sem o
              -- `at time zone`, ela cairia na quarta e o teto diário
              -- deduplicaria o dia errado.
              -- `cv` e `ms`, e não `c` e `o`: `c` já é o catálogo no escopo de fora e
              -- `o` é a organização nos outros ramos. Sombra de alias em consulta
              -- aninhada é o tipo de erro que compila e devolve outro número.
              when 'replies' then
                (select count(*)
                   from (select distinct
                                m.conversation_id,
                                (m.created_at at time zone 'America/Fortaleza')::date as dia
                           from public.messages m
                           join public.conversations cv on cv.id = m.conversation_id
                          where cv.assignee_id = v_alvo
                            and m.direction = 'in'::app.msg_direction
                            and m.created_at >= v_de and m.created_at < v_ate
                            and exists (select 1
                                          from public.messages ms
                                         where ms.conversation_id = m.conversation_id
                                           and ms.direction = 'out'::app.msg_direction
                                           and ms.sent_at is not null
                                           and ms.sent_at < m.created_at)) r)
            end)::int as valor
      from catalogo c
     where c.pode_medir
  )
  select v_alvo,
         (select td.full_name from public.team_directory td where td.id = v_alvo),
         c.metric,
         c.rotulo,
         v_periodo,
         v_ini,
         v_fim,
         g.target,
         f.valor,
         case when g.target is not null and g.target > 0 and f.valor is not null
              then round(f.valor * 100.0 / g.target, 1) end,
         v_total,
         v_decorrido,
         -- Ritmo necessário: quanto falta dividido pelos dias úteis que restam.
         case when g.target is not null and v_restante > 0 and coalesce(f.valor, 0) < g.target
              then round((g.target - coalesce(f.valor, 0))::numeric / v_restante, 2) end,
         c.pode_medir,
         c.fonte
    from catalogo c
    left join feito f on f.metric = c.metric
    left join public.goals g
           on g.user_id = v_alvo
          and g.metric::text = c.metric
          and g.period = v_periodo
          and g.period_start = v_ini
   order by c.ordem;
end $$;

comment on function public.goal_progress(uuid, app.goal_period, date) is
  'Meta × realizado de uma pessoa num período (RF-MET-02): uma linha por métrica, com meta (nula quando não definida), realizado, percentual, dias úteis e ritmo necessário. Desde 20260909170000 as dez métricas são mensuráveis: `replies` conta mensagens recebidas em conversas sob responsabilidade da pessoa, depois de uma saída efetivamente enviada, com teto de uma por conversa por dia. `pre_registrations` e `published` continuam PROXY declarado. Definer: a pessoa lê a própria; gestor e admin leem a de qualquer um.';

-- `create or replace` preserva os privilégios; repetidos aqui para o arquivo
-- valer sozinho se alguém aplicá-lo sobre uma função recriada à mão.
revoke all on function public.goal_progress(uuid, app.goal_period, date) from public, anon;
grant execute on function public.goal_progress(uuid, app.goal_period, date) to authenticated, service_role;

-- =====================================================================
-- Quem respondeu entra no Meu dia, no topo
--
-- POR QUE
-- Rafael, 28/09/2026, depois de ver a introdução automática subir: "como o
-- atendente saberá que é pra alguém assumir a conversa?". Não saberia. O fluxo
-- que existe hoje é: a campanha manda "Bom dia!", o lead responde,
-- `app.wa_resposta_no_funil` leva o negócio para "Respondeu", a introdução sai
-- sozinha 8 a 14 s depois (ADR-16) — e daí em diante quem fala tem de ser gente.
-- Só que `public.meu_dia`, a fila em que o time começa o dia, é feita de TAREFA
-- e de NEGÓCIO e não lê `conversations`. A conversa fica sem tarefa e SEM DONO
-- de propósito (é ela sem saída nossa que deixa a introdução sair: a recusa
-- `a_conversa_ja_tem_dono` de `app.wa_introduzir`), e o único aviso é um badge
-- de não lida numa tela que ninguém precisa abrir. Disparar muito e atender só
-- quem responde — que é o plano — quebra exatamente aí.
--
-- Entre três saídas (pôr no Meu dia; distribuir e criar tarefa; notificar no
-- navegador), o Rafael escolheu a primeira: a conversa que respondeu entra na
-- fila do dia, no topo, sem precisar de dono. As outras duas ficam para quando
-- se souber quem atende o quê — e este item é justamente o que produz o número
-- para decidir.
--
-- A PERGUNTA NÃO É SOBRE `status`, É SOBRE MENSAGEM
-- `conversations.status` NÃO É MANTIDO. Na entrada, `app.messages_after_write`
-- faz apenas `case when status = 'resolvida' then 'aguardando_nos' else status
-- end`: a conversa de campanha nasce 'aguardando_parceiro'
-- (`public.wa_enviar_modelo`) e continua 'aguardando_parceiro' depois que o lead
-- responde. A aba "Responderam", que perguntava pelo status, estava vazia justo
-- para o maior volume que o CRM tem. Por isso a definição abaixo pergunta pela
-- última MENSAGEM: a última palavra é do lead?
--
-- TRÊS RECORTES, CADA UM COM O SEU MOTIVO
--   * A INTRODUÇÃO NÃO É ATROPELADA, e sem regra própria: a mensagem dela nasce
--     na mesma transação da entrada, e `app.messages_after_write` grava
--     `last_outbound_at` junto — o atraso de 8 a 14 s é só do envio. A
--     comparação é ESTRITA (`<`), a mesma leitura do `>=` da regra (2) de
--     `app.wa_introduzir`. A conversa volta quando o lead responder À
--     INTRODUÇÃO, que é quando gente precisa falar.
--   * A AUSÊNCIA (`GEN-SYS-AUSENCIA`) NÃO CONTA COMO RESPOSTA: ela avisa que
--     estamos fora do horário e não cria tarefa nenhuma. Se contasse, quem
--     escreve às 21h40 sumia e ninguém o via de manhã.
--   * SAÍDA PRESA EM `queued` HÁ MAIS DE 15 MIN NÃO CONTA COMO RESPOSTA:
--     mensagem que não saiu não respondeu ninguém. Com o worker parado, contar o
--     queued esconderia o lead para sempre — este mesmo buraco com outro nome.
--
-- E POR QUE A SUPRESSÃO PASSA A SER `app.wa_motivo_de_recusa`
-- O resto do Meu dia usa `app.is_suppressed_target(org, contato)`, e ele devolve
-- `false` quando os dois são nulos — que é exatamente a conversa de quem escreveu
-- de FORA DA BASE, a que esta fila estreou. Quem pediu SAIR e não tem ficha
-- entraria na lista. Quem enxerga o TELEFONE é `app.wa_motivo_de_recusa`, pelo
-- ramo `numero_suprimido`, e de quebra ele pega ficha e contato apagados. É o
-- guardrail do CLAUDE.md: nenhum envio a contato suprimido, em nenhum modo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O modelo da ausência, para poder reconhecê-lo
-- ---------------------------------------------------------------------
-- No molde de `app.wa_modelo_introducao` (20261002090000), e sem filtro de
-- `is_active` pelo mesmo motivo de `app.wa_modelos_de_cumprimento`: reconhecer
-- um aviso já enviado não é enviá-lo de novo.
create or replace function app.wa_modelo_ausencia()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.message_templates t
   where t.template_code = 'GEN-SYS-AUSENCIA'
     and t.channel = 'whatsapp'::app.channel
$$;
comment on function app.wa_modelo_ausencia() is
  'O id do aviso de fora do horário (GEN-SYS-AUSENCIA). Sem filtro de is_active: reconhecer um aviso já enviado não é enviá-lo. Existe porque a ausência é a única saída nossa que NÃO conta como resposta em app.conversas_esperando_gente.';
revoke all on function app.wa_modelo_ausencia() from public, anon, authenticated;
grant execute on function app.wa_modelo_ausencia() to service_role;

-- ---------------------------------------------------------------------
-- 2. A definição única de "respondeu e ninguém assumiu"
-- ---------------------------------------------------------------------
create or replace function app.conversas_esperando_gente(p_de_quem uuid default null)
returns table (conversation_id uuid, de_quem uuid, organization_id uuid, deal_id uuid,
               desde timestamptz, janela_expira_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  -- UMA LINHA POR FICHA. Uma organização pode ter dois fios (dois telefones, ou
  -- WhatsApp e Instagram) e os dois devolvem o MESMO deal_id: sem o distinct on,
  -- a tela renderiza duas linhas idênticas com a mesma chave de React. Fica a
  -- que espera há mais tempo. A deduplicação é DENTRO de cada pessoa, porque o
  -- WHERE roda antes do DISTINCT ON.
  select distinct on (q.de_quem, coalesce(q.organization_id, q.conversation_id))
         q.conversation_id, q.de_quem, q.organization_id, q.deal_id, q.desde, q.janela_expira_em
    from (
      select c.id as conversation_id,
             -- DE QUEM É O ITEM. Nada é escrito: é o assignee_id que a conversa
             -- JÁ tem (o "Atendendo" da tela de Conversas), com o mesmo coalesce
             -- que public.wa_enviar_modelo usa no nascimento. Perfil desativado
             -- cai para quem o setor indica — senão a conversa de quem saiu da
             -- empresa some, que é esta migração com outro nome.
             coalesce((select p.id from public.profiles p
                        where p.id = c.assignee_id and p.is_active),
                      app.setor_quem_recebe(c.setor_id)) as de_quem,
             c.organization_id,
             coalesce(c.deal_id, app.wa_negocio_da_ficha(c.organization_id)) as deal_id,
             c.last_inbound_at   as desde,
             c.window_expires_at as janela_expira_em
        from public.conversations c
       where c.last_inbound_at is not null
         and c.status <> 'resolvida'
         and (c.snoozed_until is null or c.snoozed_until <= now())
         -- PRÉ-FILTRO BARATO, e ele é a diferença entre abrir o Meu dia e varrer
         -- a base. Esta função é `security definer`, e o planejador NÃO faz
         -- inline de função SQL definer: sem esta linha, o `de_quem = v_alvo` de
         -- public.meu_dia só valeria DEPOIS de avaliar wa_motivo_de_recusa,
         -- setor_quem_recebe e wa_negocio_da_ficha para toda conversa do banco.
         -- É um superconjunto (o coalesce exato é conferido no WHERE de fora),
         -- e usa conversations_esperando_idx no caso comum.
         and (p_de_quem is null
              or c.assignee_id = p_de_quem
              or not exists (select 1 from public.profiles p
                              where p.id = c.assignee_id and p.is_active))
         -- A ÚLTIMA PALAVRA É DO LEAD. As duas primeiras linhas respondem quase
         -- tudo e são baratas; o `not exists` só roda no caso ambíguo.
         --
         -- `<` ESTRITO, e é a trava que impede a pessoa de atropelar o robô: a
         -- introdução demora 8 a 14 s para SAIR, mas a linha dela nasce na mesma
         -- transação da entrada e app.messages_after_write grava last_outbound_at
         -- junto. Em teste os dois carimbos ficam iguais (wa_entrada_registrar
         -- usa now()); em produção o carimbo da Meta é ANTERIOR, então a saída
         -- fica maior. Nos dois casos a conversa fica de fora, que é a mesma
         -- leitura do `>=` da regra (2) de app.wa_introduzir.
         and (c.last_outbound_at is null
              or c.last_outbound_at < c.last_inbound_at
              or not exists (
                   select 1 from public.messages x
                    where x.conversation_id = c.id
                      and x.direction = 'out'::app.msg_direction
                      and x.status <> 'failed'::app.msg_status
                      and x.created_at >= c.last_inbound_at
                      -- A AUSÊNCIA NÃO É RESPOSTA: app.ausencia_responder avisa
                      -- que estamos fora do horário e não cria tarefa nenhuma. Se
                      -- contasse, quem escreve 21h40 sumia e ninguém o via de
                      -- manhã. Os dois coalesce com sentinelas DIFERENTES são
                      -- necessários: sem eles, num banco sem o modelo da ausência,
                      -- texto livre de gente (template_id nulo) deixaria de contar.
                      and coalesce(x.template_id, -1) <> coalesce(app.wa_modelo_ausencia(), -2)
                      -- MENSAGEM QUE NÃO SAIU NÃO RESPONDEU NINGUÉM. A linha nasce
                      -- 'queued' e só vira 'sent' quando o worker entrega. Com o
                      -- worker parado, contar o queued esconderia o lead PARA
                      -- SEMPRE — o buraco desta migração com outro nome. Os 15 min
                      -- cobrem com folga os 8 a 14 s da introdução.
                      and (x.status <> 'queued'::app.msg_status
                           or x.created_at > now() - interval '15 minutes')))
         -- SUPRESSÃO PELO TELEFONE, e não só pela ficha. app.is_suppressed_target
         -- devolve false quando organização e contato são nulos, que é exatamente
         -- a conversa de fora da base — e é ela que esta fila estreou. Quem vê o
         -- número é wa_motivo_de_recusa ('numero_suprimido'), que de quebra pega
         -- ficha e contato apagados.
         and app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164) is null
    ) q
   where p_de_quem is null or q.de_quem = p_de_quem
   order by q.de_quem, coalesce(q.organization_id, q.conversation_id), q.desde
$$;
comment on function app.conversas_esperando_gente(uuid) is
  'As conversas em que a última palavra é do lead e ninguém falou desde então, com a pessoa a quem cada uma já está endereçada (conversations.assignee_id, ou quem o setor indica quando esse perfil foi desativado). Uma linha por ficha. É a definição ÚNICA de "respondeu e ninguém assumiu": public.meu_dia a usa e a tela de Conversas faz a mesma pergunta em TypeScript. NÃO pergunta por conversations.status, que não é mantido (app.messages_after_write só o troca quando era resolvida). A introdução automática não é atropelada porque a mensagem dela nasce junto com a entrada: a comparação é estrita. Não contam como resposta a ausência (GEN-SYS-AUSENCIA) nem a saída presa em queued há mais de 15 min. p_de_quem filtra ANTES das funções caras, porque definer não faz inline.';
revoke all on function app.conversas_esperando_gente(uuid) from public, anon, authenticated;
-- SEM grant a authenticated: a função é definer e ignora a RLS de conversations,
-- que só deixa o sdr ver o próprio fio. Quem a chama é public.meu_dia, que já é
-- definer e já confere quem pode ler a fila de quem.
grant execute on function app.conversas_esperando_gente(uuid) to service_role;

-- O índice que o pré-filtro usa. Parcial porque conversa sem entrada nenhuma
-- (a que só levou cumprimento) nunca é resposta de ninguém.
create index if not exists conversations_esperando_idx
  on public.conversations (assignee_id, last_inbound_at)
  where last_inbound_at is not null;

-- ---------------------------------------------------------------------
-- 3. A fila do dia ganha o bloco 0
-- ---------------------------------------------------------------------
-- Recriada inteira a partir da definição viva (20260905000100), no estilo das
-- migrações que já a tocaram: tudo idêntico, com um `declare` novo, um CTE novo
-- e um ramo novo como PRIMEIRO do `union all`.

create or replace function public.meu_dia(
  p_user_id uuid default null,
  p_limite  int  default 60)
returns table (
  prioridade      int,
  tipo            text,
  motivo          text,
  titulo          text,
  quando          timestamptz,
  atraso_horas    numeric,
  task_id         uuid,
  activity_id     uuid,
  deal_id         uuid,
  organization_id uuid,
  organizacao     text,
  bairro          text,
  categoria       text,
  temperatura     app.temperature,
  funil           text,
  etapa           text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_alvo   uuid;
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_limite int  := least(greatest(coalesce(p_limite, 60), 1), 300);
  -- TETO DO BLOCO 0. A fila da tela tem 60 linhas (LIMITE_DA_FILA) e o order by
  -- começa pela prioridade: sem teto, um dia de 200 respostas empurraria para
  -- fora do limite TODA reunião, tarefa vencida e negócio parado. O Meu dia
  -- deixaria de ser o Meu dia no dia em que mais precisa ser. Entram as 15 mais
  -- antigas; o resto continua na aba Responderam, e o rodapé da tela diz isso.
  v_teto_conversas int := 15;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_alvo := coalesce(p_user_id, v_uid);
  if v_alvo <> v_uid and not app.is_manager() then
    raise exception 'Só gestor ou admin lê a fila de outra pessoa' using errcode = '42501';
  end if;

  return query
  with conversas as (
    select e.* from app.conversas_esperando_gente(v_alvo) e
     order by e.desde
     limit v_teto_conversas
  ),
  tarefas as (
    select t.id, t.title, t.kind, t.due_at, t.deal_id, t.organization_id,
           o.name         as organizacao,
           o.neighborhood as bairro,
           cat.name       as categoria,
           d.temperature  as temperatura,
           pl.name        as funil,
           st.name        as etapa
      from public.tasks t
      left join public.organizations o on o.id = t.organization_id
      left join public.deals     d  on d.id  = t.deal_id
      left join public.stages    st on st.id = d.stage_id
      left join public.pipelines pl on pl.id = d.pipeline_id
      left join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
      left join public.categories cat on cat.id = pc.category_id
     where t.assignee_id = v_alvo
       and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
       and (o.id is null or o.deleted_at is null)
       -- Reconferência na ENTREGA (a mesma de public.proximo_da_fila): a tarefa
       -- nasceu com app.tasks_guard_suppressed dizendo que podia, e nasce dias
       -- antes de ser trabalhada. `o.do_not_contact` sozinho não via nem a
       -- pessoa (contato que pediu para sair numa ficha cujo dono não pediu)
       -- nem a lista de supressão (a ficha irmã com o MESMO telefone, que
       -- continua com do_not_contact = false). `app.is_suppressed_target` vê.
       and not app.is_suppressed_target(t.organization_id, t.contact_id)
  ),
  negocios as (
    select c.deal_id, c.organization_id, c.organization_name, c.next_action_at,
           (c.card ->> 'temperature')::app.temperature as temperatura,
           coalesce((c.card ->> 'is_rotting')::boolean, false) as parado,
           coalesce((c.card ->> 'days_in_stage')::int, 0)      as dias_na_etapa,
           c.card ->> 'neighborhood'      as bairro,
           c.card ->> 'primary_category'  as categoria,
           c.card ->> 'next_action'       as proxima_acao,
           (c.card ->> 'days_since_contact')::int as dias_sem_contato,
           pl.name       as funil,
           st.name       as etapa,
           st.sla_hours
      from app.deal_cards c
      join public.deals         d  on d.id  = c.deal_id
      join public.organizations o  on o.id  = c.organization_id
      join public.stages        st on st.id = c.stage_id
      join public.pipelines     pl on pl.id = c.pipeline_id
     where c.owner_id = v_alvo
       and c.org_deleted_at is null
       and d.status = 'open'::app.deal_status
       and not app.is_suppressed_target(o.id, d.primary_contact_id)
       and not st.is_terminal
       -- Negócio com tarefa aberta JÁ está na fila como tarefa: a próxima ação do
       -- negócio e a tarefa são o mesmo compromisso (o registrar_contato cria as
       -- duas juntas). Repetir a empresa em duas linhas transforma a fila do dia
       -- numa lista de coisas que parecem duas e são uma.
       and not exists (select 1 from public.tasks t2
                        where t2.deal_id = c.deal_id
                          and t2.status in ('todo'::app.task_status, 'doing'::app.task_status))
  ),
  itens as (
    -- 0 · alguém respondeu no WhatsApp e ninguém falou com essa pessoa desde
    -- então. NO TOPO, e não no meio, porque é o único item da fila cujo relógio
    -- é de OUTRA pessoa: a janela de 24 h fecha (depois dela só sai modelo
    -- aprovado, RF-CON-18) e o lead está com o telefone na mão agora. Tudo o
    -- mais aqui é compromisso que NÓS marcamos, e adiar custa a nós.
    --
    -- DE QUEM É: de conversations.assignee_id, o "Atendendo" da tela de
    -- Conversas — que NÃO é o owner_id do bloco de negócios logo abaixo, o
    -- "Responsável". São dois laços diferentes com a mesma pessoa, e a tela de
    -- Conversas já os separa por nome. Ler não escreve: a conversa continua sem
    -- saída nossa que não seja cumprimento, e a introdução continua podendo sair.
    --
    -- SEM DEDUP CONTRA TAREFA OU NEGÓCIO, e é escolha. O bloco de negócios
    -- deduplica contra tarefa porque a próxima ação e a tarefa SÃO o mesmo
    -- compromisso (o registrar_contato cria as duas juntas). Uma mensagem
    -- esperando e uma tarefa não nascem juntas e não são a mesma promessa — a
    -- mensagem tem um relógio de 24 h que a tarefa não tem. Esconder a urgente
    -- atrás da agendada seria o defeito que esta migração veio consertar.
    select 0, 'conversa_esperando'::text,
           (case
              when e.janela_expira_em is null
                then 'Respondeu e ninguém falou com ele desde então'
              when e.janela_expira_em <= now()
                then 'A janela de 24 h fechou: daqui só sai modelo aprovado'
              else 'A janela de 24 h fecha em '
                   || greatest(1, round(extract(epoch from (e.janela_expira_em - now())) / 3600.0))
                   || ' h'
            end)::text,
           -- O título diz O QUE FAZER, no infinitivo, como toda tarefa do CRM
           -- ("Ligar D+1") — e não o estado interno ("aguardando nós"). Quem
           -- escreveu de fora da base não tem nome para a linha de cima, então o
           -- título carrega a identificação.
           (case when o.id is null then 'Responder quem escreveu de fora da base'
                 else 'Responder no WhatsApp' end)::text,
           e.desde,
           round(extract(epoch from (now() - e.desde)) / 3600.0, 1),
           null::uuid, null::uuid, e.deal_id, e.organization_id,
           o.name, o.neighborhood, cat.name, d.temperature, pl.name, st.name
      from conversas e
      left join public.organizations o on o.id = e.organization_id
      left join public.deals     d  on d.id  = e.deal_id
      left join public.stages    st on st.id = d.stage_id
      left join public.pipelines pl on pl.id = d.pipeline_id
      left join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
      left join public.categories cat on cat.id = pc.category_id
     where o.id is null or o.deleted_at is null

    union all
    -- 1 · reunião ou visita nas próximas 3 h
    select 1, 'reuniao_proxima'::text,
           'Reunião ou visita em menos de 3 h'::text,
           t.title, t.due_at, null::numeric,
           t.id, null::uuid, t.deal_id, t.organization_id,
           t.organizacao, t.bairro, t.categoria, t.temperatura, t.funil, t.etapa
      from tarefas t
     where t.kind in ('meeting'::app.task_kind, 'visit'::app.task_kind)
       and t.due_at is not null
       and t.due_at >= now() and t.due_at < now() + interval '3 hours'

    union all
    -- 2 · interação registrada sem resultado (o gatilho do catálogo marcou)
    select 2, 'desfecho_pendente',
           'Registrada sem resultado: falta dizer o que aconteceu',
           coalesce(o.name, 'Interação sem alvo'),
           a.occurred_at,
           round(extract(epoch from (now() - a.occurred_at)) / 3600.0, 1),
           null::uuid, a.id, a.deal_id, coalesce(a.organization_id, d.organization_id),
           o.name, o.neighborhood, cat.name, d.temperature, pl.name, st.name
      from public.activities a
      left join public.deals         d  on d.id  = a.deal_id
      left join public.organizations o  on o.id  = coalesce(a.organization_id, d.organization_id)
      left join public.stages        st on st.id = d.stage_id
      left join public.pipelines     pl on pl.id = d.pipeline_id
      left join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
      left join public.categories cat on cat.id = pc.category_id
     where a.user_id = v_alvo
       and coalesce((a.metadata ->> 'outcome_pending')::boolean, false)
       and a.occurred_at < now()
       and a.occurred_at > now() - interval '30 days'
       and (o.id is null or o.deleted_at is null)

    union all
    -- 3 / 5 / 9 · tarefas por prazo
    select case
             when t.due_at is null then 9
             when t.due_at < now() then 3
             when (t.due_at at time zone 'America/Fortaleza')::date = v_hoje then 5
             else 9
           end,
           case
             when t.due_at is null then 'tarefa_sem_data'
             when t.due_at < now() then 'tarefa_atrasada'
             when (t.due_at at time zone 'America/Fortaleza')::date = v_hoje then 'tarefa_hoje'
             else 'tarefa_futura'
           end,
           case
             when t.due_at is null then 'Tarefa sem prazo'
             when t.due_at < now() - interval '2 days' then 'Tarefa vencida há '
                  || (v_hoje - (t.due_at at time zone 'America/Fortaleza')::date) || ' dia(s)'
             when t.due_at < now() then 'Tarefa vencida há '
                  || round(extract(epoch from (now() - t.due_at)) / 3600.0) || ' h'
             when (t.due_at at time zone 'America/Fortaleza')::date = v_hoje then 'Tarefa para hoje'
             else 'Tarefa agendada'
           end,
           t.title, t.due_at,
           case when t.due_at < now()
                then round(extract(epoch from (now() - t.due_at)) / 3600.0, 1) end,
           t.id, null::uuid, t.deal_id, t.organization_id,
           t.organizacao, t.bairro, t.categoria, t.temperatura, t.funil, t.etapa
      from tarefas t
     where not (t.kind in ('meeting'::app.task_kind, 'visit'::app.task_kind)
                and t.due_at is not null
                and t.due_at >= now() and t.due_at < now() + interval '3 hours')

    union all
    -- 4 / 6 / 7 / 8 · o negócio entra uma vez só, pelo motivo mais urgente
    select case
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date < v_hoje then 4
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date = v_hoje then 6
             when n.next_action_at is null then 7
             else 8
           end,
           case
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date < v_hoje then 'proxima_acao_atrasada'
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date = v_hoje then 'proxima_acao_hoje'
             when n.next_action_at is null then 'sem_proxima_acao'
             else 'negocio_parado'
           end,
           case
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date < v_hoje
               then 'Próxima ação vencida há '
                    || (v_hoje - (n.next_action_at at time zone 'America/Fortaleza')::date) || ' dia(s)'
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date = v_hoje
               then 'Próxima ação para hoje'
             when n.next_action_at is null
               then 'Negócio aberto sem próxima ação, na etapa ' || n.etapa
             when n.dias_sem_contato is null
               then 'Sem nenhum contato registrado, há ' || n.dias_na_etapa
                    || ' dia(s) na etapa ' || n.etapa
                    || ' (SLA ' || coalesce(n.sla_hours::text, '—') || ' h)'
             else 'Sem contato há ' || n.dias_sem_contato || ' dia(s) na etapa ' || n.etapa
                  || ' (SLA ' || coalesce(n.sla_hours::text, '—') || ' h)'
           end,
           coalesce(n.proxima_acao, n.organization_name),
           n.next_action_at,
           case when n.next_action_at is not null and n.next_action_at < now()
                then round(extract(epoch from (now() - n.next_action_at)) / 3600.0, 1) end,
           null::uuid, null::uuid, n.deal_id, n.organization_id,
           n.organization_name, n.bairro, n.categoria, n.temperatura, n.funil, n.etapa
      from negocios n
     where (n.next_action_at is not null
            and (n.next_action_at at time zone 'America/Fortaleza')::date <= v_hoje)
        or n.next_action_at is null
        or n.parado
  )
  select i.*
    from itens i (prioridade, tipo, motivo, titulo, quando, atraso_horas, task_id, activity_id,
                  deal_id, organization_id, organizacao, bairro, categoria, temperatura, funil, etapa)
   order by i.prioridade,
            case i.temperatura
              when 'quente'::app.temperature        then 4
              when 'cliente_ativo'::app.temperature then 3
              when 'cliente'::app.temperature       then 3
              when 'morno'::app.temperature         then 2
              else 1
            end desc,
            i.quando nulls last,
            i.organizacao
   limit v_limite;
end $$;
comment on function public.meu_dia(uuid, int) is
  'Fila do dia de uma pessoa (RF-MET-03/04), já ordenada por urgência: quem respondeu no WhatsApp e ainda espera (no topo — é o único item cujo relógio é de outra pessoa, e a janela de 24 h fecha; no máximo 15 por dia, para não afogar o resto da fila), reunião em menos de 3 h, interação sem resultado, tarefa vencida, próxima ação vencida, tarefa e próxima ação de hoje, negócio sem próxima ação, negócio parado além do SLA e tarefa futura. Cada negócio entra uma vez só. DOIS LAÇOS DE POSSE convivem de propósito: o bloco de negócios é de app.deal_cards.owner_id (o "Responsável") e o das conversas é de conversations.assignee_id (o "Atendendo"), a mesma distinção que a tela de Conversas faz. Alvo suprimido NA HORA DA LEITURA fica de fora (app.is_suppressed_target nos blocos antigos; app.wa_motivo_de_recusa no das conversas, que é o único que enxerga o TELEFONE de quem escreveu sem ficha) - exceto o item "registrada sem resultado", que é tabular o que já aconteceu. A função NÃO ESCREVE NADA: em especial, não dá dono a conversa nenhuma, porque é a conversa sem saída nossa que deixa a introdução automática sair. Definer: a pessoa lê a própria fila; gestor e admin leem a de qualquer um.';

revoke all on function public.meu_dia(uuid, int) from public, anon;
grant execute on function public.meu_dia(uuid, int) to authenticated, service_role;

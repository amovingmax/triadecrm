-- =====================================================================
-- A fila de quem respondeu passa a ser de quem abrir
--
-- POR QUE
-- Rafael, 28/09/2026: "estamos com operadores reduzidos que nem logam às vezes".
-- A fila que subiu ontem (20261002150000) é filtrada por `assignee_id`, e a
-- 20261002170000 acabou de desligar a distribuição — o dono passou a ser quase
-- sempre o mesmo perfil, pelo fallback do `conversations_before_write`. As duas
-- coisas juntas fazem o pior dos mundos: a resposta do lead fica atrás de um
-- nome, e o nome não abre o CRM. Este é o conserto que impede a 20261002170000
-- de piorar a vida, e por isso as duas sobem na mesma rodada.
--
-- QUEM PODE ATENDER, E POR QUE O CRITÉRIO NÃO É UMA LISTA ESCOLHIDA A DEDO
-- Responder é `insert` em `public.messages`. A política `messages_insert`
-- (20260905000200:1691-1704) exige `app.can_write()` E que a conversa passe no
-- mesmo recorte de `conversations_select` (:720). Então a pergunta "quem pode
-- atender" já tem resposta no banco, e ela é:
--
--   * admin, gestor, sdr → `app.sees_all()` (20260904000500:46) os deixa LER
--     toda conversa, e `can_write()` os deixa RESPONDER. Fila inteira.
--     (O `sdr` NÃO tem RLS estreita em `conversations`; quem é estreito é o
--     embaixador. Vale dizer, porque a suposição contrária é fácil de fazer.)
--   * embaixador → `can_write()` é verdadeiro, mas a leitura dele é estreita.
--     Continua recebendo `conversas_esperando_gente(v_alvo)`: as conversas
--     ENDEREÇADAS A ELE. Isso NÃO é "a carteira dele" — uma conversa de uma
--     ficha da carteira, endereçada a outra pessoa, não entra. É o que a função
--     faz hoje, é o que ela passa a fazer, e a asserção 4 do teste 90 mede os
--     dois casos. Alargar para a carteira exigiria um segundo recorte dentro da
--     função e ninguém pediu isso.
--   * leitura, financeiro → `can_write()` é FALSO. Pôr item na fila de quem o
--     banco vai recusar é mandar trabalhar e depois dizer não.
--
-- O PAPEL QUE DECIDE É O DE QUEM A FILA É, NÃO O DE QUEM PERGUNTA
-- `public.meu_dia` aceita `p_user_id`: o gestor abre a fila de outra pessoa. Se
-- o recorte saísse do papel de quem chama, o gestor que abrisse a fila de um
-- embaixador veria a fila inteira rotulada com o nome dele. O papel lido é o do
-- ALVO.
--
-- O QUE EVITA DUAS PESSOAS NA MESMA CONVERSA: O QUE JÁ EXISTE
-- Nada de reserva nem de lock — complexidade que o time de hoje não precisa.
-- `conversas_esperando_gente` exige que a última palavra seja do lead; quem
-- responde vira a última palavra nossa e a conversa sai da fila DE TODO MUNDO,
-- no mesmo instante. `app.messages_quem_responde_atende` (20260914100000) já
-- passa o atendimento para quem falou. Medido na asserção 6 do teste 90.
--
-- O DEFEITO QUE SÓ APARECE AGORA
-- `distinct on (q.de_quem, coalesce(org, conversa))` deduplicava DENTRO de cada
-- pessoa, porque o `where p_de_quem` roda antes do `distinct on`. Sem filtro,
-- dois fios da mesma ficha com atendentes diferentes renderiam duas linhas — a
-- mesma chave de React duas vezes, que é justo o que o `distinct on` veio
-- impedir. Tirar `de_quem` da chave conserta, e não muda nada no caso filtrado:
-- com um `p_de_quem`, `de_quem` é constante.
--
-- O QUE A LINHA PASSA A DIZER
-- Coluna nova `atendente` em `public.meu_dia`: o primeiro nome de quem a
-- conversa aponta, e NULL quando é minha. O dono continua existindo, continua no
-- cabeçalho da conversa ("Atendendo") e `public.assumir_conversa`
-- (20260914100000) continua sendo o jeito de dizer "deixa comigo". Esconder de
-- quem é seria mentir por omissão; repetir "endereçada a mim" em toda linha da
-- minha própria fila seria um rótulo que a pessoa aprende a não ler.
--
-- O CUSTO, MEDIDO E NÃO SUPOSTO
-- A chamada SEM filtro é a que a 20261002150000:88-96 mediu em 912 ms com 3.000
-- conversas esperando, e ela deixa de ser de uma pessoa para ser de todo
-- admin/gestor/sdr, em toda abertura do Meu dia. O número desta rodada está no
-- CHANGELOG. Nenhum índice novo: a 20261002150000:201-210 já mediu que o
-- pré-filtro não tem caminho de índice (o segundo ramo do OR é "o perfil do dono
-- foi desativado"), e índice que ninguém usa é reescrito em toda mensagem.
--
-- RF-CON-04, RF-MET-03/04 · ADR-17
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A definição de "respondeu e ninguém assumiu" deduplica por FICHA
-- ---------------------------------------------------------------------
-- Recriada inteira a partir da definição viva (20261002150000:80-192). Mudam
-- duas linhas: a chave do `distinct on` e a do `order by`.
create or replace function app.conversas_esperando_gente(p_de_quem uuid default null)
returns table (conversation_id uuid, de_quem uuid, organization_id uuid, deal_id uuid,
               desde timestamptz, janela_expira_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  -- QUEM O SETOR INDICA, RESOLVIDO UMA VEZ POR SETOR E NÃO POR CONVERSA.
  -- `app.setor_quem_recebe` conta as conversas abertas de cada membro do setor
  -- para achar o menos carregado, e por linha ela é a conta mais cara desta
  -- função: medido em 28/09/2026, com um perfil desativado e 3.000 conversas
  -- esperando, são 386 ms dos 912 ms da chamada inteira. `materialized` porque
  -- sem ele o planejador pode embutir o CTE e trazer a chamada de volta para
  -- dentro do laço.
  with quem_recebe as materialized (
    select s.id as setor_id, app.setor_quem_recebe(s.id) as quem from public.setores s
  ),
  -- O PRÉ-FILTRO BARATO, NUM CTE MATERIALIZADO — e o `materialized` é o ponto.
  -- `where` não é ordem de execução: o planejador ordena os filtros pelo custo
  -- que ELE estima, e estimava `app.wa_motivo_de_recusa` (função definer, custo
  -- padrão) como mais barata que este OR com subplano — 236 ms para devolver
  -- zero linha. Com a cerca, as quatro linhas abaixo varrem a tabela em 0,3 ms.
  --
  -- O recorte é um SUPERCONJUNTO: `p_de_quem` só vale de verdade no WHERE de
  -- fora, depois do coalesce, porque conversa de perfil desativado cai para quem
  -- o setor indica e só então se sabe de quem ela é. Com `p_de_quem` nulo (a
  -- chamada de admin/gestor/sdr, desde 28/09/2026) o OR inteiro some e o CTE
  -- passa a ser a varredura de todas as conversas vivas — é este o custo que o
  -- cabeçalho manda vigiar.
  candidatas as materialized (
    select c.id, c.assignee_id, c.setor_id, c.organization_id, c.contact_id,
           c.peer_phone_e164, c.deal_id,
           c.last_inbound_at, c.last_outbound_at, c.window_expires_at
      from public.conversations c
     where c.last_inbound_at is not null
       and c.status <> 'resolvida'
       and (c.snoozed_until is null or c.snoozed_until <= now())
       and (p_de_quem is null
            or c.assignee_id = p_de_quem
            or not exists (select 1 from public.profiles p
                            where p.id = c.assignee_id and p.is_active))
  )
  -- UMA LINHA POR FICHA, E AGORA POR FICHA DE VERDADE. Uma organização pode ter
  -- dois fios (dois telefones, ou WhatsApp e Instagram) e os dois devolvem o
  -- MESMO deal_id: sem o distinct on, a tela renderiza duas linhas idênticas com
  -- a mesma chave de React.
  --
  -- MUDOU EM 28/09/2026 (ADR-17): `de_quem` SAIU da chave. Enquanto a função só
  -- era chamada com filtro, deduplicar dentro de cada pessoa dava no mesmo —
  -- `de_quem` era constante. Sem filtro não é: dois fios da mesma ficha
  -- endereçados a pessoas diferentes voltariam a render duas linhas, que é
  -- exatamente o que o distinct on veio impedir. Fica a que espera há mais tempo.
  select distinct on (coalesce(q.organization_id, q.conversation_id))
         q.conversation_id, q.de_quem, q.organization_id, q.deal_id, q.desde, q.janela_expira_em
    from (
      select c.id as conversation_id,
             -- DE QUEM É O ITEM. Nada é escrito: é o assignee_id que a conversa
             -- JÁ tem (o "Atendendo" da tela de Conversas), com o mesmo coalesce
             -- que public.wa_enviar_modelo usa no nascimento. Perfil desativado
             -- cai para quem o setor indica — senão a conversa de quem saiu da
             -- empresa some, que é a 20261002150000 com outro nome.
             coalesce((select p.id from public.profiles p
                        where p.id = c.assignee_id and p.is_active),
                      sa.quem) as de_quem,
             c.organization_id,
             coalesce(c.deal_id, app.wa_negocio_da_ficha(c.organization_id)) as deal_id,
             c.last_inbound_at   as desde,
             c.window_expires_at as janela_expira_em
        from candidatas c
        left join quem_recebe sa on sa.setor_id = c.setor_id
       -- A ÚLTIMA PALAVRA É DO LEAD. As duas primeiras linhas respondem quase
       -- tudo e são baratas; o `not exists` só roda no caso ambíguo.
       --
       -- `<` ESTRITO, e é a trava que impede a pessoa de atropelar o robô: a
       -- introdução demora 8 a 14 s para SAIR, mas a linha dela nasce na mesma
       -- transação da entrada e app.messages_after_write grava last_outbound_at
       -- junto. Em teste os dois carimbos ficam iguais; em produção o carimbo da
       -- Meta é ANTERIOR. Nos dois casos a conversa fica de fora, que é a mesma
       -- leitura do `>=` da regra (2) de app.wa_introduzir.
       where (c.last_outbound_at is null
              or c.last_outbound_at < c.last_inbound_at
              or not exists (
                   select 1 from public.messages x
                    where x.conversation_id = c.id
                      and x.direction = 'out'::app.msg_direction
                      and x.status <> 'failed'::app.msg_status
                      and x.created_at >= c.last_inbound_at
                      -- A AUSÊNCIA NÃO É RESPOSTA: ela avisa que estamos fora do
                      -- horário e não cria tarefa nenhuma. Se contasse, quem
                      -- escreve às 21h40 sumia e ninguém o via de manhã. Os dois
                      -- coalesce com sentinelas DIFERENTES são necessários: sem
                      -- eles, num banco sem o modelo da ausência, texto livre de
                      -- gente (template_id nulo) deixaria de contar.
                      and coalesce(x.template_id, -1) <> coalesce(app.wa_modelo_ausencia(), -2)
                      -- MENSAGEM QUE NÃO SAIU NÃO RESPONDEU NINGUÉM. Com o
                      -- worker parado, contar o queued esconderia o lead PARA
                      -- SEMPRE. Os 15 min cobrem com folga os 8 a 14 s da
                      -- introdução.
                      and (x.status <> 'queued'::app.msg_status
                           or x.created_at > now() - interval '15 minutes')))
         -- SUPRESSÃO PELO TELEFONE, e não só pela ficha. app.is_suppressed_target
         -- devolve false quando organização e contato são nulos, que é exatamente
         -- a conversa de fora da base. Quem vê o número é wa_motivo_de_recusa.
         and app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164) is null
    ) q
   where p_de_quem is null or q.de_quem = p_de_quem
   order by coalesce(q.organization_id, q.conversation_id), q.desde
$$;
comment on function app.conversas_esperando_gente(uuid) is
  'As conversas em que a última palavra é do lead e ninguém falou desde então, com a pessoa a quem cada uma já está endereçada (conversations.assignee_id, ou quem o setor indica quando esse perfil foi desativado). UMA LINHA POR FICHA, e desde 28/09/2026 (ADR-17) a deduplicação é por ficha de verdade: de_quem saiu da chave do distinct on, porque sem p_de_quem dois fios da mesma ficha endereçados a pessoas diferentes voltariam a render duas linhas. É a definição ÚNICA de "respondeu e ninguém assumiu": public.meu_dia a usa — SEM filtro para admin, gestor e sdr, com filtro para o embaixador — e a tela de Conversas faz a mesma pergunta em TypeScript. NÃO pergunta por conversations.status, que não é mantido. A introdução automática não é atropelada porque a mensagem dela nasce junto com a entrada: a comparação é estrita. Não contam como resposta a ausência (GEN-SYS-AUSENCIA) nem a saída presa em queued há mais de 15 min. p_de_quem filtra ANTES das funções caras, porque definer não faz inline.';
-- GRANTS: nenhum muda. A função segue sem grant a `authenticated` — ela é definer
-- e ignora a RLS de conversations. Quem a chama é public.meu_dia, que já é
-- definer e já confere quem lê a fila de quem. Os testes a chamam direto porque
-- pgTAP roda como superusuário.
revoke all on function app.conversas_esperando_gente(uuid) from public, anon, authenticated;
grant execute on function app.conversas_esperando_gente(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 2. A fila do dia ganha a coluna `atendente` e o recorte por papel
-- ---------------------------------------------------------------------
-- A coluna nova muda o TIPO DE RETORNO, e `create or replace` não faz isso:
-- `drop` + `create`, com os grants refeitos no fim. É o que a 20260904001400:269
-- já fez pelo mesmo motivo.
--
-- O DROP É SEGURO: o único chamador em SQL é `20260904001890:400`,
-- `from (select * from public.meu_dia(v_alvo, 60)) f`, que lê as colunas POR
-- NOME dentro de um jsonb_build_object — coluna a mais não o afeta — e não há
-- dependência registrada (view, índice ou coluna gerada) sobre a função.
drop function if exists public.meu_dia(uuid, int);

create function public.meu_dia(
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
  etapa           text,
  -- NOVO (ADR-17): o primeiro nome de quem a conversa aponta, e NULL quando ela
  -- já é minha. Só o bloco 0 a preenche; nula em toda outra linha, porque lá a
  -- pergunta não existe — tarefa e negócio da minha fila já são meus por
  -- definição.
  atendente       text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_alvo   uuid;
  -- NOVO: o papel de QUEM A FILA É, e não de quem pergunta. O gestor que abre a
  -- fila de um embaixador tem de ver a fila do embaixador, com o recorte dele.
  v_papel  app.user_role;
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_limite int  := least(greatest(coalesce(p_limite, 60), 1), 300);
  -- TETO DO BLOCO 0. A fila da tela tem 60 linhas (LIMITE_DA_FILA) e o order by
  -- começa pela prioridade: sem teto, um dia de 200 respostas empurraria para
  -- fora do limite TODA reunião, tarefa vencida e negócio parado. Entram as 15
  -- mais antigas; o resto continua na aba Responderam, e o rodapé da tela diz
  -- isso. Desde 28/09/2026 as 15 são as mais antigas DE TODO MUNDO, e não as
  -- minhas — é o que faz a resposta de um lead deixar de depender de uma pessoa
  -- abrir o CRM.
  v_teto_conversas int := 15;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_alvo := coalesce(p_user_id, v_uid);
  if v_alvo <> v_uid and not app.is_manager() then
    raise exception 'Só gestor ou admin lê a fila de outra pessoa' using errcode = '42501';
  end if;
  select p.role into v_papel from public.profiles p where p.id = v_alvo and p.is_active;

  return query
  with conversas as (
    -- QUEM PODE ATENDER VÊ A FILA INTEIRA. O critério é o do banco, não uma
    -- lista de gosto: responder é insert em public.messages, e messages_insert
    -- exige app.can_write() E o recorte de conversations_select. admin, gestor e
    -- sdr passam nos dois por app.sees_all(); o embaixador passa só nas conversas
    -- endereçadas a ele; leitura e financeiro não podem escrever, e por isso não
    -- recebem o item — mandar trabalhar e depois recusar é pior que não mandar.
    select e.*
      from app.conversas_esperando_gente(
             case when v_papel in ('admin'::app.user_role, 'gestor'::app.user_role,
                                   'sdr'::app.user_role)
                  then null::uuid else v_alvo end) e
     where v_papel in ('admin'::app.user_role, 'gestor'::app.user_role,
                       'sdr'::app.user_role, 'embaixador'::app.user_role)
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
       -- pessoa nem a lista de supressão. `app.is_suppressed_target` vê.
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
    -- "Responsável". Desde 28/09/2026 o item aparece para quem PUDER atender,
    -- e não só para essa pessoa: a coluna `atendente` diz para quem ele aponta.
    -- Ler não escreve: a conversa continua sem saída nossa que não seja
    -- cumprimento, e a introdução continua podendo sair.
    --
    -- SEM DEDUP CONTRA TAREFA OU NEGÓCIO, e é escolha. Uma mensagem esperando e
    -- uma tarefa não nascem juntas e não são a mesma promessa — a mensagem tem
    -- um relógio de 24 h que a tarefa não tem.
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
           (case when o.id is null then 'Responder quem escreveu de fora da base'
                 else 'Responder no WhatsApp' end)::text,
           e.desde,
           round(extract(epoch from (now() - e.desde)) / 3600.0, 1),
           null::uuid, null::uuid, e.deal_id, e.organization_id,
           o.name, o.neighborhood, cat.name, d.temperature, pl.name, st.name,
           -- O nome só quando ACRESCENTA. "Endereçada a mim" em toda linha da
           -- minha própria fila é um rótulo que a pessoa aprende a não ler.
           case when e.de_quem is distinct from v_alvo
                then app.primeiro_nome(e.de_quem) end
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
           t.organizacao, t.bairro, t.categoria, t.temperatura, t.funil, t.etapa,
           null::text
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
           o.name, o.neighborhood, cat.name, d.temperature, pl.name, st.name,
           null::text
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
           t.organizacao, t.bairro, t.categoria, t.temperatura, t.funil, t.etapa,
           null::text
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
           n.organization_name, n.bairro, n.categoria, n.temperatura, n.funil, n.etapa,
           null::text
      from negocios n
     where (n.next_action_at is not null
            and (n.next_action_at at time zone 'America/Fortaleza')::date <= v_hoje)
        or n.next_action_at is null
        or n.parado
  )
  select i.*
    from itens i (prioridade, tipo, motivo, titulo, quando, atraso_horas, task_id, activity_id,
                  deal_id, organization_id, organizacao, bairro, categoria, temperatura, funil,
                  etapa, atendente)
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
  'Fila do dia de uma pessoa (RF-MET-03/04), já ordenada por urgência: quem respondeu no WhatsApp e ainda espera (no topo — é o único item cujo relógio é de outra pessoa, e a janela de 24 h fecha; no máximo 15 por dia, para não afogar o resto da fila), reunião em menos de 3 h, interação sem resultado, tarefa vencida, próxima ação vencida, tarefa e próxima ação de hoje, negócio sem próxima ação, negócio parado além do SLA e tarefa futura. Cada negócio entra uma vez só. DESDE 28/09/2026 (ADR-17) o bloco das conversas NÃO é filtrado por dono para quem pode atender: admin, gestor e sdr recebem a fila inteira (app.sees_all já os deixa ler toda conversa e messages_insert já os deixa responder), o embaixador recebe só as conversas endereçadas a ele, e leitura e financeiro não recebem nenhuma, porque app.can_write() é falso para eles e o banco recusaria a resposta. O papel que decide é o do ALVO, não o de quem chama. A coluna `atendente` diz o primeiro nome de quem a conversa aponta, e é nula quando é a própria pessoa — o dono continua existindo e continua no cabeçalho da conversa. Duas pessoas não se atropelam sem lock nenhum: quem responde vira a última palavra nossa e a conversa sai da fila de todos. DOIS LAÇOS DE POSSE convivem de propósito: o bloco de negócios é de app.deal_cards.owner_id (o "Responsável") e o das conversas é de conversations.assignee_id (o "Atendendo"). Alvo suprimido NA HORA DA LEITURA fica de fora (app.is_suppressed_target nos blocos antigos; app.wa_motivo_de_recusa no das conversas, que é o único que enxerga o TELEFONE de quem escreveu sem ficha) - exceto o item "registrada sem resultado", que é tabular o que já aconteceu. A função NÃO ESCREVE NADA: em especial, não dá dono a conversa nenhuma, porque é a conversa sem saída nossa que deixa a introdução automática sair. Definer: a pessoa lê a própria fila; gestor e admin leem a de qualquer um.';

revoke all on function public.meu_dia(uuid, int) from public, anon;
grant execute on function public.meu_dia(uuid, int) to authenticated, service_role;

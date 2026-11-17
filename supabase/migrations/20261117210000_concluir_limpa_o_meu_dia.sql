-- =====================================================================
-- Concluir a conversa limpa o Meu dia (17/11/2026)
--
-- Pedido do usuário: "Assim que concluirmos conversa com cliente não pode haver
-- nada desse cliente na aba de 'meu dia', as tarefas associadas a ele devem ser
-- concluídas e não mostradas como pendente".
--
-- ===========================================================================
-- O QUE ACONTECIA
-- ===========================================================================
-- Concluir (20261104120000) tirava do Meu dia só o item "Responder no
-- WhatsApp". O resto do cliente ficava:
--   * as TAREFAS dele continuavam abertas ("Follow-up D+3", "Reengajar", o
--     aviso da IA), e vencidas;
--   * sem tarefa aberta, o NEGÓCIO dele subia sozinho ("Próxima ação vencida",
--     "Negócio parado", "sem próxima ação"), porque a `meu_dia` só esconde o
--     negócio que já tem tarefa;
--   * o sistema CONTINUAVA CRIANDO tarefa para ele. Na Imova, em 17/11/2026,
--     eram 17 tarefas abertas de clientes concluídos, e 6 delas ("Reengajar:
--     … está morno há 7 dias") nasceram DEPOIS da conclusão.
--
-- ===========================================================================
-- O QUE MUDA
-- ===========================================================================
-- 1. CONCLUIR FECHA AS TAREFAS DO CLIENTE. `public.conversa_arquivar`, ao
--    concluir, marca como feitas (`done`) as tarefas abertas da ficha e anota
--    em `tasks.concluida_com_conversa` qual conclusão as fechou. Só quando o
--    cliente fica concluído de verdade: se a mesma ficha tiver outra conversa
--    aberta, a conversa com ele continua e nada é fechado.
--
-- 2. O COMPROMISSO MARCADO FICA. Visita e reunião com data daqui para frente
--    não são pendência, são hora combinada com o cliente: continuam na Agenda
--    e em "Próximos dias". Marcar como feita uma visita que ainda não
--    aconteceu mentiria na Agenda. A visita ou reunião que já passou e ficou
--    aberta é fechada como as outras.
--
-- 3. O QUE O SISTEMA CRIA SOZINHO PARA CLIENTE CONCLUÍDO JÁ NASCE FEITO.
--    Gatilho `tasks_a_nasce_concluida`, antes do insert: tarefa sem pessoa
--    por trás (`auth.uid()` e `created_by` nulos: relógio, worker de IA,
--    webhook) para uma ficha concluída entra como `done`, marcada como as do
--    item 1. Um gatilho só, e não um remendo em cada uma das ~25 funções que
--    criam tarefa. Tarefa criada por uma PESSOA (pela tela ou pela API, que
--    age como a pessoa) nasce aberta: alguém decidiu que há o que fazer.
--    Visita e reunião nunca nascem feitas (o Calendly marca visita sem
--    pessoa, e ela vai acontecer).
--
-- 4. A `meu_dia` NÃO MOSTRA O NEGÓCIO DE CLIENTE CONCLUÍDO, nem o registro
--    "sem resultado" anterior à conclusão. O registro feito depois (alguém
--    ligou para ele depois de concluir) aparece.
--
-- 5. "DESFAZER" E "REABRIR" DEVOLVEM AS TAREFAS. Reabrir pela tela desfaz a
--    conclusão inteira: as tarefas que ESTA conclusão fechou voltam a abertas
--    (menos as de quem pediu para sair, que a trava da supressão não deixa
--    reabrir). Quando o CLIENTE escreve de novo, a conversa volta (gatilho
--    `messages_desarquiva`) mas as tarefas antigas não: o item novo é
--    "Responder no WhatsApp", e o follow-up velho já não vale.
--
-- O QUE NÃO MUDA: o "Feito hoje" (é história, não pendência), os relatórios
-- (nenhum conta visita pela tarefa feita) e o WhatsApp (nada é enviado).
--
-- ===========================================================================
-- "CLIENTE CONCLUÍDO", NUMA DEFINIÇÃO SÓ
-- ===========================================================================
-- `app.cliente_concluido_em(org)`: a ficha tem conversa, TODAS estão
-- concluídas e nenhuma recebeu, depois da conclusão, mensagem que a traria de
-- volta (do cliente, ou de uma pessoa do time). A terceira condição parece
-- redundante com o gatilho `messages_desarquiva`, e não é: gatilhos AFTER
-- rodam em ordem alfabética, e uma tarefa criada no meio do insert da
-- mensagem do cliente (antes do `messages_desarquiva`) veria a conversa ainda
-- concluída e nasceria feita. Com a terceira condição, a mensagem que acabou
-- de entrar já conta. Vale nas duas empresas, como o Concluir
-- (`app.concluir_ligado`).
--
-- O que já estava preso nos bancos é fechado no fim desta migração, com a
-- mesma marca: "Reabrir" devolve também essas.
--
-- RF-CON-04, RF-MET-03/04
--
-- COMO DESFAZER:
--   drop trigger if exists tasks_a_nasce_concluida on public.tasks;
--   drop function if exists app.tasks_nasce_concluida();
--   reaplicar `public.conversa_arquivar` de 20261002250000 e `public.meu_dia`
--   de 20261002180000;
--   (para devolver o que foi fechado:
--    update public.tasks set status = 'todo', concluida_com_conversa = null
--     where concluida_com_conversa is not null and status = 'done';)
--   drop function if exists app.concluir_fecha_tarefas(uuid);
--   drop function if exists app.cliente_concluido_em(uuid);
--   alter table public.tasks drop column if exists concluida_com_conversa;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A marca: qual conclusão fechou a tarefa
-- ---------------------------------------------------------------------
alter table public.tasks
  add column if not exists concluida_com_conversa uuid
    references public.conversations (id) on delete set null;
comment on column public.tasks.concluida_com_conversa is
  'A conversa cuja conclusão fechou esta tarefa (17/11/2026): fechada ao concluir, ou nascida feita porque o cliente estava concluído. Reabrir a conversa pela tela devolve as tarefas desta conclusão. Nula em toda tarefa fechada por gente.';
create index if not exists tasks_concluida_com_conversa
  on public.tasks (concluida_com_conversa)
  where concluida_com_conversa is not null;

-- ---------------------------------------------------------------------
-- 2. Cliente concluído: desde quando (nulo = não está)
-- ---------------------------------------------------------------------
create or replace function app.cliente_concluido_em(p_org uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  with conversas as (
    select c.id, c.arquivada_em
      from public.conversations c
     where p_org is not null
       and c.organization_id = p_org
  )
  select max(k.arquivada_em)
    from conversas k
   where app.concluir_ligado()
  having count(*) > 0
     and bool_and(k.arquivada_em is not null)
     -- A mensagem que traz a conversa de volta já conta, mesmo antes de o
     -- gatilho `messages_desarquiva` rodar (ver o cabeçalho).
     and not exists (
           select 1
             from conversas k2
             join public.messages m on m.conversation_id = k2.id
            where m.created_at > k2.arquivada_em
              and (m.direction = 'in'::app.msg_direction
                   or (m.direction = 'out'::app.msg_direction and m.author_kind = 'human')))
$$;
comment on function app.cliente_concluido_em(uuid) is
  'Desde quando o cliente (a ficha) está concluído, ou nulo se não está (17/11/2026): tem conversa, todas concluídas, e nenhuma recebeu depois da conclusão mensagem do cliente ou de uma pessoa do time (a que a traria de volta). Só onde o Concluir vale (app.concluir_ligado). É a definição única usada ao concluir, no gatilho tasks_a_nasce_concluida e na public.meu_dia.';
revoke all on function app.cliente_concluido_em(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Fechar as tarefas de um cliente que acabou de ser concluído
-- ---------------------------------------------------------------------
-- Devolve quantas fechou, para a tela dizer. Zero quando a conversa não tem
-- ficha ou quando a ficha ainda tem outra conversa aberta.
create or replace function app.concluir_fecha_tarefas(p_conversation_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  n     int := 0;
begin
  select c.organization_id into v_org
    from public.conversations c
   where c.id = p_conversation_id;
  if v_org is null or app.cliente_concluido_em(v_org) is null then
    return 0;
  end if;

  update public.tasks t
     set status = 'done'::app.task_status,
         concluida_com_conversa = p_conversation_id
   where t.organization_id = v_org
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     -- O compromisso marcado daqui para frente fica (ver o cabeçalho).
     and not (t.kind in ('visit'::app.task_kind, 'meeting'::app.task_kind)
              and t.due_at is not null and t.due_at >= now());
  get diagnostics n = row_count;
  return n;
end $$;
comment on function app.concluir_fecha_tarefas(uuid) is
  'Ao concluir a conversa (17/11/2026), marca como feitas as tarefas abertas da ficha, menos visita e reunião com data daqui para frente, e anota a conversa em tasks.concluida_com_conversa. Só se o cliente ficou concluído (app.cliente_concluido_em). Devolve quantas fechou.';
revoke all on function app.concluir_fecha_tarefas(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. A tarefa automática de cliente concluído já nasce feita
-- ---------------------------------------------------------------------
-- `tasks_a_…` no nome para rodar ANTES de `tasks_before_write` (gatilhos BEFORE
-- disparam em ordem alfabética): ela é quem carimba `completed_at` no `done`, e
-- a trava da supressão (`zz_tasks_guard_suppressed`) deixa passar o que já
-- nasce fechado.
create or replace function app.tasks_nasce_concluida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversa uuid;
begin
  if new.status not in ('todo'::app.task_status, 'doing'::app.task_status)
     or new.organization_id is null
     -- Uma pessoa pediu (tela, API que age como ela, ou quem a criou por ela).
     or auth.uid() is not null
     or new.created_by is not null
     -- Compromisso marcado vai acontecer, mesmo marcado pelo Calendly.
     or new.kind in ('visit'::app.task_kind, 'meeting'::app.task_kind)
     or new.origin = 'calendly' then
    return new;
  end if;
  if app.cliente_concluido_em(new.organization_id) is null then
    return new;
  end if;

  select c.id into v_conversa
    from public.conversations c
   where c.organization_id = new.organization_id
   order by c.arquivada_em desc nulls last
   limit 1;
  new.status := 'done'::app.task_status;
  new.completed_at := now();
  new.concluida_com_conversa := v_conversa;
  return new;
end $$;
comment on function app.tasks_nasce_concluida() is
  'A tarefa que o sistema cria sozinho (sem auth.uid() nem created_by) para cliente concluído nasce feita (17/11/2026), marcada em concluida_com_conversa. Visita e reunião, nunca. Tarefa de pessoa nasce aberta.';
revoke all on function app.tasks_nasce_concluida() from public, anon, authenticated;

drop trigger if exists tasks_a_nasce_concluida on public.tasks;
create trigger tasks_a_nasce_concluida
  before insert on public.tasks
  for each row execute function app.tasks_nasce_concluida();

-- ---------------------------------------------------------------------
-- 5. Concluir fecha as tarefas; reabrir pela tela as devolve
-- ---------------------------------------------------------------------
-- O corpo é o de 20261002250000, com o bloco das tarefas depois do update e
-- duas chaves novas na resposta (`tarefas_concluidas`, `tarefas_devolvidas`).
create or replace function public.conversa_arquivar(p_conversation_id uuid,
                                                    p_arquivar boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c            public.conversations%rowtype;
  v_fechadas   int := 0;
  v_devolvidas int := 0;
begin
  if auth.uid() is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;
  -- O MESMO recorte de `conversations_select`: definer é para poder gravar sem
  -- depender da política de update (que hoje é do dono ou de gestor), não para
  -- deixar alguém arquivar conversa que não enxerga.
  if not (app.sees_all()
          or c.assignee_id = auth.uid()
          or (app.role() = 'embaixador'::app.user_role
              and c.organization_id is not null
              and app.org_is_mine(c.organization_id))) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  update public.conversations
     set arquivada_em  = case when p_arquivar then now() else null end,
         arquivada_por = case when p_arquivar then auth.uid() else null end,
         updated_at    = now()
   where id = p_conversation_id;

  if app.concluir_ligado() then
    if p_arquivar then
      v_fechadas := app.concluir_fecha_tarefas(p_conversation_id);
    elsif c.arquivada_em is not null then
      -- Reabrir desfaz ESTA conclusão: volta o que ela fechou (inclusive o que
      -- nasceu feito enquanto ela valia), e nada de conclusões antigas. Quem
      -- pediu para sair fica de fora: a trava da supressão não deixa reabrir.
      update public.tasks t
         set status = 'todo'::app.task_status,
             concluida_com_conversa = null
       where t.concluida_com_conversa = p_conversation_id
         and t.status = 'done'::app.task_status
         and t.completed_at >= c.arquivada_em
         and (t.kind = 'other'::app.task_kind
              or not app.is_suppressed_target(t.organization_id, t.contact_id));
      get diagnostics v_devolvidas = row_count;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'arquivada', p_arquivar,
                            'tarefas_concluidas', v_fechadas,
                            'tarefas_devolvidas', v_devolvidas);
end $$;
comment on function public.conversa_arquivar(uuid, boolean) is
  'Conclui (arquiva) a conversa, ou traz de volta. Não apaga nada — o fio inteiro continua e mensagem nova do parceiro desarquiva sozinha. Desde 17/11/2026, concluir fecha as tarefas abertas do cliente (menos visita e reunião marcadas daqui para frente) e reabrir pela tela as devolve; a resposta diz quantas (tarefas_concluidas, tarefas_devolvidas). Qualquer pessoa que escreve pode, sobre conversa que ela enxerga; o rastro fica no audit_log do gatilho da tabela.';
revoke all on function public.conversa_arquivar(uuid, boolean) from public, anon;
grant execute on function public.conversa_arquivar(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 6. A fila do dia sem o negócio de cliente concluído
-- ---------------------------------------------------------------------
-- O corpo é o de 20261002180000, com DUAS condições a mais: no CTE `negocios`
-- e no bloco 2 ("registrada sem resultado"). As tarefas não precisam de
-- filtro: as do cliente concluído foram fechadas, e a que estiver aberta foi
-- criada por uma pessoa depois de concluir, ou é compromisso marcado.
-- `create or replace`: a assinatura e as colunas são as mesmas.

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
       -- CLIENTE CONCLUÍDO NÃO TEM NEGÓCIO NA FILA (17/11/2026). Sem esta linha,
       -- fechar as tarefas dele ao concluir faria o negócio subir no lugar delas
       -- ("próxima ação vencida", "parado"). Ele volta quando a conversa volta.
       and app.cliente_concluido_em(o.id) is null
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
       -- O registro de antes da conclusão sai com o cliente concluído
       -- (17/11/2026); o feito depois dela (alguém ligou mesmo assim) fica.
       and (o.id is null
            or a.occurred_at > coalesce(app.cliente_concluido_em(o.id), '-infinity'::timestamptz))

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
  'Fila do dia de uma pessoa (RF-MET-03/04), já ordenada por urgência: quem respondeu no WhatsApp e ainda espera (no topo — é o único item cujo relógio é de outra pessoa, e a janela de 24 h fecha; no máximo 15 por dia, para não afogar o resto da fila), reunião em menos de 3 h, interação sem resultado, tarefa vencida, próxima ação vencida, tarefa e próxima ação de hoje, negócio sem próxima ação, negócio parado além do SLA e tarefa futura. Cada negócio entra uma vez só. DESDE 28/09/2026 (ADR-17) o bloco das conversas NÃO é filtrado por dono para quem pode atender: admin, gestor e sdr recebem a fila inteira (app.sees_all já os deixa ler toda conversa e messages_insert já os deixa responder), o embaixador recebe só as conversas endereçadas a ele, e leitura e financeiro não recebem nenhuma, porque app.can_write() é falso para eles e o banco recusaria a resposta. O papel que decide é o do ALVO, não o de quem chama. A coluna `atendente` diz o primeiro nome de quem a conversa aponta, e é nula quando é a própria pessoa — o dono continua existindo e continua no cabeçalho da conversa. Duas pessoas não se atropelam sem lock nenhum: quem responde vira a última palavra nossa e a conversa sai da fila de todos. DOIS LAÇOS DE POSSE convivem de propósito: o bloco de negócios é de app.deal_cards.owner_id (o "Responsável") e o das conversas é de conversations.assignee_id (o "Atendendo"). Alvo suprimido NA HORA DA LEITURA fica de fora (app.is_suppressed_target nos blocos antigos; app.wa_motivo_de_recusa no das conversas, que é o único que enxerga o TELEFONE de quem escreveu sem ficha) - exceto o item "registrada sem resultado", que é tabular o que já aconteceu. A função NÃO ESCREVE NADA: em especial, não dá dono a conversa nenhuma, porque é a conversa sem saída nossa que deixa a introdução automática sair. DESDE 17/11/2026, cliente concluído (app.cliente_concluido_em) não tem negócio na fila, nem registro sem resultado anterior à conclusão; as tarefas dele foram fechadas ao concluir (public.conversa_arquivar). Definer: a pessoa lê a própria fila; gestor e admin leem a de qualquer um.';

revoke all on function public.meu_dia(uuid, int) from public, anon;
grant execute on function public.meu_dia(uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. O que já estava preso: fechar agora, com a mesma marca
-- ---------------------------------------------------------------------
-- Cliente concluído hoje, com tarefa aberta: fecha como se tivesse concluído
-- agora (o compromisso marcado à frente fica), menos a que uma PESSOA criou
-- depois da conclusão, que o gatilho do item 4 também deixaria aberta. A marca
-- é a conversa concluída mais recente da ficha, e "Reabrir" nela devolve estas
-- também. Ficha excluída fica de fora: a exclusão já cuidou das tarefas dela.
do $$
declare
  n int;
begin
  with concluidos as (
    select distinct on (c.organization_id) c.organization_id, c.id as conversa,
           app.cliente_concluido_em(c.organization_id) as desde
      from public.conversations c
      join public.organizations o on o.id = c.organization_id
     where c.arquivada_em is not null
       and o.deleted_at is null
       and app.cliente_concluido_em(c.organization_id) is not null
     order by c.organization_id, c.arquivada_em desc
  )
  update public.tasks t
     set status = 'done'::app.task_status,
         concluida_com_conversa = k.conversa
    from concluidos k
   where t.organization_id = k.organization_id
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     and not (t.kind in ('visit'::app.task_kind, 'meeting'::app.task_kind)
              and t.due_at is not null and t.due_at >= now())
     and not (t.created_by is not null and t.created_at > k.desde);
  get diagnostics n = row_count;
  raise notice 'Concluir limpa o Meu dia: % tarefa(s) de cliente concluído fechada(s) agora.', n;
end $$;

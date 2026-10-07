-- =====================================================================
-- Excluir sem apagar
--
-- Pedido do Rafael em 07/10/2026: "trabalhe bem sobre as funcionalidades de
-- exclusão. Em várias abas não tem isso — como excluir uma agenda, excluir
-- algum parceiro".
--
-- O levantamento mostrou o tamanho do buraco: a ficha do parceiro não tinha
-- como sair da base (a coluna `organizations.deleted_at` existe desde o D1, e
-- TODA leitura já a respeita — lista, quadro, Meu dia, lotes, envios —, mas
-- nenhuma função a escrevia), e na Agenda só a reunião tinha "cancelar": visita
-- e compromisso sem reunião ficavam lá para sempre, pedindo desfecho.
--
-- ===========================================================================
-- POR QUE "EXCLUIR" NÃO É `DELETE`
-- ===========================================================================
-- Apagar a linha de um parceiro não é só perigoso, é IMPOSSÍVEL para quase todo
-- mundo que já foi tocado: `consent_events` é append-only e cascateia a partir
-- da ficha (um opt-out basta para o DELETE estourar), `pre_registration_events`
-- idem, e `envios_em_massa_itens` aponta para ela sem `on delete`. E onde é
-- possível, leva junto mensagens, ligações e reuniões — o histórico que explica
-- por que aquele telefone não deve ser procurado de novo.
--
-- Então excluir é TIRAR DE CIRCULAÇÃO, de um jeito que dá para desfazer:
--
--   · a ficha some de Prospectados, do funil, dos lotes, de Conversas e do Meu
--     dia (é o `deleted_at` que as leituras já filtram);
--   · o que estava PENDENTE dela é encerrado na mesma transação — tarefas,
--     reuniões marcadas (com o aviso ao time), a vaga na fila do bom-dia e as
--     cadências —, para ninguém ligar, visitar ou escrever para quem saiu;
--   · a conversa é desligada da ficha e arquivada. Sem isso, se a pessoa
--     escrevesse de novo a mensagem cairia num fio preso a uma ficha que
--     nenhuma tela mostra: `app.wa_registrar_entrada` acha o fio pelo número e
--     não confere se a ficha dele ainda existe. Desligada, a mensagem nova
--     aparece em "Fora da base", que é exatamente o que ela é;
--   · o histórico fica inteiro, e `public.parceiro_restaurar` devolve a ficha.
--
-- O que excluir NÃO faz, de propósito:
--   · não tira ninguém da `suppression_list`: quem pediu para sair continua
--     fora, mesmo que o número volte numa planilha;
--   · não é a eliminação da LGPD (PRD §10.6): os dados continuam no banco. O
--     pedido de titular é outro fluxo (`consent_events.erasure_request`).
--
-- E quem NÃO se exclui por aqui: quem já é cliente (negócio ganho, cadastro
-- concluído ou publicado na Komune) e quem tem pré-cadastro em andamento — o
-- rascunho está do lado de lá, e sumir com a ficha deixaria um link de
-- reivindicação vivo apontando para ninguém.
--
-- ===========================================================================
-- A AGENDA
-- ===========================================================================
-- `public.tarefa_excluir` serve à Agenda (visita, compromisso sem reunião) e
-- aos "Próximos passos" da ficha. Para quem usa é "excluir"; no banco a tarefa
-- fica como `cancelled`, que as duas telas já não mostram — sem mexer em
-- consulta nenhuma. Quando a tarefa é o eco de uma reunião viva, a função
-- CANCELA A REUNIÃO (`public.reuniao_cancelar`): apagar só o eco deixaria a
-- reunião segurando o horário na trava de colisão.
--
-- RF-BAS-10, RF-AGE-05, RF-ADM-03
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Quem excluiu, e por quê
-- ---------------------------------------------------------------------
alter table public.organizations
  add column if not exists deleted_by     uuid references public.profiles (id) on delete set null,
  add column if not exists deleted_reason text;

comment on column public.organizations.deleted_by is
  'Quem excluiu a ficha (public.parceiro_excluir). Nulo enquanto ela está na base.';
comment on column public.organizations.deleted_reason is
  'O motivo que quem excluiu escreveu. É o que a lista de Excluídos mostra para decidir se restaura.';

create index if not exists organizations_excluidas_idx
  on public.organizations (deleted_at desc) where deleted_at is not null;


-- ---------------------------------------------------------------------
-- 2 · Excluir um parceiro
-- ---------------------------------------------------------------------
create or replace function public.parceiro_excluir(p_organization_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_motivo    text := nullif(btrim(coalesce(p_motivo, '')), '');
  o           public.organizations%rowtype;
  r           record;
  n_reunioes  int := 0;
  n_tarefas   int := 0;
  n_envios    int := 0;
  n_conversas int := 0;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  -- Só quem cuida da base (pivô de 06/10/2026): admin e gestor.
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into o from public.organizations where id = p_organization_id for update;
  if not found or o.deleted_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;

  -- Cliente não se exclui por aqui: o cadastro dele mora na Komune.
  if o.komune_supplier_id is not null
     or exists (select 1 from public.deals d
                 where d.organization_id = o.id and d.status = 'won'::app.deal_status)
     or exists (select 1 from public.pre_registrations pr
                 where pr.organization_id = o.id
                   and pr.status in ('completed'::app.prereg_status, 'published'::app.prereg_status)) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_e_cliente');
  end if;
  -- Nem quem está com o rascunho aberto do lado de lá.
  if exists (select 1 from public.pre_registrations pr
              where pr.organization_id = o.id
                and pr.status in ('pending'::app.prereg_status, 'draft_created'::app.prereg_status,
                                  'link_sent'::app.prereg_status, 'in_progress'::app.prereg_status)) then
    return jsonb_build_object('ok', false, 'motivo', 'pre_cadastro_em_andamento');
  end if;

  -- ----- o que estava pendente -----
  -- Reuniões vivas primeiro, e pelo caminho de sempre: `reuniao_cancelar` solta
  -- o horário, cancela a tarefa-eco e avisa o time. A ficha ainda está visível
  -- aqui, então a permissão dela passa.
  for r in select re.id from public.reunioes re
            where re.organization_id = o.id
              and re.estado in ('a_confirmar', 'marcada', 'confirmada')
  loop
    perform public.reuniao_cancelar(r.id, 'Parceiro excluído: ' || v_motivo);
    n_reunioes := n_reunioes + 1;
  end loop;

  -- As cadências antes das tarefas: encerrar a matrícula cancela o toque e a
  -- tarefa dele na ordem que o gatilho `zz_cadence_on_task` espera.
  perform app.encerrar_matricula(en.id, 'parceiro_excluido')
     from public.cadence_enrollments en
    where en.organization_id = o.id
      and en.status in ('ativa'::app.cadence_status, 'pausada'::app.cadence_status);

  update public.tasks t
     set status = 'cancelled'::app.task_status
   where t.organization_id = o.id
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status);
  get diagnostics n_tarefas = row_count;

  -- Negócio aberto fica sem próxima ação: as tarefas foram canceladas, e uma
  -- ficha restaurada com "ligar dia 3" sem tarefa nenhuma por trás mentiria.
  -- Ela volta no balde "sem próxima ação" do Meu dia, que é onde alguém decide.
  update public.deals d
     set next_action = null, next_action_at = null
   where d.organization_id = o.id
     and d.status in ('open'::app.deal_status, 'paused'::app.deal_status)
     and (d.next_action is not null or d.next_action_at is not null);

  -- A vaga na fila do bom-dia (e de qualquer envio agendado).
  update public.envios_em_massa_itens i
     set status = 'cancelada', motivo = 'parceiro_excluido', processado_em = now()
   where i.organization_id = o.id and i.status = 'pendente';
  get diagnostics n_envios = row_count;

  -- A conversa sai da ficha e vai para o arquivo. Se a pessoa escrever de novo,
  -- `app.messages_desarquiva` a traz de volta — em "Fora da base".
  update public.conversations c
     set organization_id = null,
         deal_id         = null,
         arquivada_em    = coalesce(c.arquivada_em, now()),
         arquivada_por   = coalesce(c.arquivada_por, v_uid)
   where c.organization_id = o.id;
  get diagnostics n_conversas = row_count;

  -- Os lotes de ligação NÃO são tocados aqui: `proximo_da_fila` já devolve o
  -- item de ficha excluída na hora em que ele chegaria à vez (guardrail de
  -- 20260904001300), e `app.call_candidates` não a põe em lote novo.

  update public.organizations
     set deleted_at = now(), deleted_by = v_uid, deleted_reason = left(v_motivo, 500)
   where id = o.id;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (v_uid, app.role()::text, 'EXCLUIR_PARCEIRO', 'organizations', o.id::text,
          jsonb_build_object('name', o.name, 'kind', o.kind),
          jsonb_build_object('motivo', v_motivo, 'reunioes_canceladas', n_reunioes,
                             'tarefas_canceladas', n_tarefas, 'envios_cancelados', n_envios,
                             'conversas_desligadas', n_conversas));

  return jsonb_build_object('ok', true, 'nome', o.name,
                            'reunioes_canceladas', n_reunioes, 'tarefas_canceladas', n_tarefas,
                            'envios_cancelados', n_envios, 'conversas_desligadas', n_conversas);
end $$;
comment on function public.parceiro_excluir(uuid, text) is
  'Tira um parceiro de circulação sem apagar nada (organizations.deleted_at): cancela reuniões, tarefas, cadências e a vaga na fila de envios, desliga e arquiva a conversa, e grava quem excluiu e por quê. Só admin e gestor. Recusa cliente (ja_e_cliente) e quem tem pré-cadastro aberto (pre_cadastro_em_andamento). Desfaz-se com public.parceiro_restaurar.';
revoke all on function public.parceiro_excluir(uuid, text) from public, anon;
grant execute on function public.parceiro_excluir(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3 · Restaurar
-- ---------------------------------------------------------------------
-- Volta a ficha, o negócio (na etapa em que estava) e a conversa. O que foi
-- CANCELADO na exclusão não volta: reunião cancelada avisou gente, e tarefa
-- cancelada tinha data que pode já ter passado.
--
-- O único jeito de falhar com a ficha íntegra é alguém ter recadastrado o
-- mesmo parceiro enquanto ela estava fora — os índices únicos de CNPJ,
-- telefone, @ e place_id ignoram quem está excluído, justamente para permitir
-- isso. Aí a recusa diz QUAL ficha está no lugar, em vez de estourar em 23505.
create or replace function public.parceiro_restaurar(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  o           public.organizations%rowtype;
  v_outra     record;
  n_conversas int := 0;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into o from public.organizations where id = p_organization_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if o.deleted_at is null then
    return jsonb_build_object('ok', true, 'ja_estava', true, 'nome', o.name);
  end if;
  if o.anonymized_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'anonimizado');
  end if;

  select x.id, x.name,
         case when o.phone_e164 is not null and x.phone_e164 = o.phone_e164 then 'telefone'
              when o.cnpj is not null and x.cnpj = o.cnpj then 'cnpj'
              when o.instagram_handle is not null and x.instagram_handle = o.instagram_handle then 'instagram'
              else 'google_maps' end as campo
    into v_outra
    from public.organizations x
   where x.deleted_at is null and x.id <> o.id
     and ((o.phone_e164 is not null and x.phone_e164 = o.phone_e164)
       or (o.cnpj is not null and x.cnpj = o.cnpj)
       or (o.instagram_handle is not null and x.instagram_handle = o.instagram_handle)
       or (o.place_id is not null and x.place_id = o.place_id))
   limit 1;
  if found then
    return jsonb_build_object('ok', false, 'motivo', 'duplicado', 'campo', v_outra.campo,
                              'organization_id', v_outra.id, 'nome', v_outra.name);
  end if;

  update public.organizations
     set deleted_at = null, deleted_by = null, deleted_reason = null
   where id = o.id;

  -- A conversa que era dela: a que continua sem ficha e cujas mensagens ainda
  -- carregam o id desta (a exclusão desligou o fio, não as mensagens). Se no
  -- meio-tempo alguém a ligou a outra ficha, ela fica onde está.
  update public.conversations c
     set organization_id = o.id,
         deal_id = app.wa_negocio_da_ficha(o.id)
   where c.organization_id is null
     and exists (select 1 from public.messages m
                  where m.conversation_id = c.id and m.organization_id = o.id);
  get diagnostics n_conversas = row_count;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (v_uid, app.role()::text, 'RESTAURAR_PARCEIRO', 'organizations', o.id::text,
          jsonb_build_object('excluido_em', o.deleted_at, 'excluido_por', o.deleted_by,
                             'motivo', o.deleted_reason),
          jsonb_build_object('name', o.name, 'conversas_religadas', n_conversas));

  return jsonb_build_object('ok', true, 'nome', o.name, 'conversas_religadas', n_conversas);
end $$;
comment on function public.parceiro_restaurar(uuid) is
  'Devolve à base uma ficha excluída por public.parceiro_excluir: a ficha, o negócio na etapa em que estava e a conversa. Tarefas e reuniões canceladas na exclusão não voltam. Recusa com motivo "duplicado" (e diz qual ficha) quando o mesmo telefone, CNPJ, @ ou lugar do Google já foi recadastrado. Só admin e gestor.';
revoke all on function public.parceiro_restaurar(uuid) from public, anon;
grant execute on function public.parceiro_restaurar(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 4 · A lista de excluídos
-- ---------------------------------------------------------------------
-- RPC, e não `select` na tabela: a política `organizations_select` já deixa
-- admin e gestor lerem ficha excluída "para restaurar", mas a tela precisa do
-- nome de quem excluiu e da categoria, e não precisa de telefone nenhum.
create or replace function public.parceiros_excluidos(p_q text default null, p_limite int default 100)
returns table (
  id            uuid,
  nome          text,
  tipo          app.org_kind,
  categoria     text,
  cidade        text,
  bairro        text,
  excluido_em   timestamptz,
  excluido_por  text,
  motivo        text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_nome text := app.search_name(nullif(btrim(coalesce(p_q, '')), ''));
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.is_manager() then
    raise exception 'Só admin e gestor veem os parceiros excluídos' using errcode = '42501';
  end if;

  return query
  select o.id, o.name, o.kind,
         (select c.name from public.organization_categories oc
            join public.categories c on c.id = oc.category_id
           where oc.organization_id = o.id and oc.is_primary limit 1),
         (select ci.name from public.cities ci where ci.id = o.city_id),
         o.neighborhood,
         o.deleted_at,
         (select p.full_name from public.profiles p where p.id = o.deleted_by),
         o.deleted_reason
    from public.organizations o
   where o.deleted_at is not null
     and o.anonymized_at is null
     and (v_nome is null or o.search_name like '%' || v_nome || '%')
   order by o.deleted_at desc
   limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;
comment on function public.parceiros_excluidos(text, int) is
  'Fichas excluídas (organizations.deleted_at), da mais recente para a mais antiga, com quem excluiu e o motivo. Sem telefone. Só admin e gestor.';
revoke all on function public.parceiros_excluidos(text, int) from public, anon;
grant execute on function public.parceiros_excluidos(text, int) to authenticated;


-- ---------------------------------------------------------------------
-- 5 · Excluir um compromisso ou uma próxima ação
-- ---------------------------------------------------------------------
create or replace function public.tarefa_excluir(p_task_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  t        public.tasks%rowtype;
  v_reu    uuid;
  v_ret    jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into t from public.tasks where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrada');
  end if;
  -- A mesma régua da política `tasks_update`: gestão, quem faz ou quem criou.
  if not (app.is_manager() or t.assignee_id = v_uid or t.created_by = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if t.status = 'cancelled'::app.task_status then
    return jsonb_build_object('ok', true, 'ja_estava', true);
  end if;
  if t.status = 'done'::app.task_status then
    return jsonb_build_object('ok', false, 'motivo', 'ja_concluida');
  end if;

  -- Eco de uma reunião viva: quem sai é a REUNIÃO, pelo caminho dela (solta o
  -- horário, cancela este eco e avisa o time).
  select re.id into v_reu from public.reunioes re
   where re.task_id = t.id and re.estado in ('a_confirmar', 'marcada', 'confirmada')
   limit 1;
  if v_reu is not null then
    v_ret := public.reuniao_cancelar(v_reu, v_motivo);
    return v_ret || jsonb_build_object('era_reuniao', true);
  end if;

  update public.tasks set status = 'cancelled'::app.task_status where id = t.id;

  -- A cópia da próxima ação no negócio (o que o cartão do funil e a lista
  -- mostram). Só quando ESTA tarefa era a espelhada: há negócio que nasce com
  -- "Primeiro contato" escrito e sem tarefa nenhuma, e esse não é para mexer.
  if t.deal_id is not null and t.due_at is not null then
    update public.deals d
       set next_action    = x.title,
           next_action_at = x.due_at
      from (select (select left(o.title, 200) from public.tasks o
                     where o.deal_id = t.deal_id and o.due_at is not null
                       and o.status in ('todo'::app.task_status, 'doing'::app.task_status)
                     order by o.due_at limit 1) as title,
                   (select o.due_at from public.tasks o
                     where o.deal_id = t.deal_id and o.due_at is not null
                       and o.status in ('todo'::app.task_status, 'doing'::app.task_status)
                     order by o.due_at limit 1) as due_at) x
     where d.id = t.deal_id
       and d.next_action_at = t.due_at;
  end if;

  -- A parada da rota do dia, quando a visita excluída estava nela.
  delete from public.route_stops s where s.task_id = t.id;

  -- `tasks` não tem gatilho de auditoria: a linha é escrita aqui.
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (v_uid, app.role()::text, 'EXCLUIR_COMPROMISSO', 'tasks', t.id::text,
          jsonb_build_object('title', t.title, 'kind', t.kind, 'due_at', t.due_at,
                             'assignee_id', t.assignee_id, 'organization_id', t.organization_id,
                             'deal_id', t.deal_id),
          jsonb_build_object('motivo', v_motivo));

  return jsonb_build_object('ok', true, 'era_reuniao', false);
end $$;
comment on function public.tarefa_excluir(uuid, text) is
  'Tira da Agenda e dos próximos passos uma tarefa que não vai acontecer (visita, compromisso, follow-up): a tarefa vira cancelled, a próxima ação do negócio passa para a seguinte, a parada sai da rota e a exclusão fica no audit_log. Quando a tarefa é o eco de uma reunião viva, cancela a reunião (public.reuniao_cancelar). Gestão, quem faz ou quem criou.';
revoke all on function public.tarefa_excluir(uuid, text) from public, anon;
grant execute on function public.tarefa_excluir(uuid, text) to authenticated;

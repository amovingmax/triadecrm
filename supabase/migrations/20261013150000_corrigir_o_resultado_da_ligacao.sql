-- =====================================================================
-- Corrigir o resultado de uma ligação
--
-- Pedido de 13/10/2026 (pendência de 07/10 no CHANGELOG, "o que continua sem
-- excluir", item 1): depois que o recibo fecha, o resultado lançado errado
-- não tinha conserto. Num CRM cuja proposta é "um relatório exato sobre tudo
-- que ocorreu para cada pessoa que ligou nesse dia", um "Não atendeu" marcado
-- no lugar de "Interessado" fica errado para sempre — no relatório, no funil e
-- na fila de recontato.
--
-- O DESENHO: ESTORNAR E LANÇAR DE NOVO, NUMA TRANSAÇÃO SÓ
--
-- `public.ligacao_corrigir` não edita o registro antigo campo a campo. Ela:
--
--   1. ESTORNA o que o resultado errado mexeu: a etapa volta para onde estava
--      (se o negócio ainda está onde o registro o pôs), a próxima ação que ele
--      criou é cancelada, a intenção que ele declarou sai. A janela de
--      recontato e as "portas" saem sozinhas, porque moram no desfecho.
--   2. LANÇA o resultado certo pelo caminho de sempre, `registrar_contato`,
--      na hora em que a ligação aconteceu. Etapa, temperatura, próxima ação e
--      recontato do resultado novo nascem da MESMA regra de qualquer registro:
--      não há uma segunda cópia da regra para manter.
--   3. DEIXA RASTRO: o registro antigo não é apagado. Ele vira uma nota do
--      sistema na ficha ("Resultado corrigido: era X, passou a Y. Motivo: …"),
--      e a correção entra na auditoria como CORRIGIR_RESULTADO.
--
-- A ligação continua sendo de quem ligou: quando a gestão corrige o registro
-- de outra pessoa, o registro novo, a tarefa e o negócio assumido ficam no
-- nome de quem fez a ligação, e o relatório do dia dela muda de coluna, não de
-- dono.
--
-- QUEM CORRIGE
--   · quem ligou, enquanto for o mesmo dia (America/Fortaleza): admin, gestor
--     ou SDR. Corrigir o próprio engano não pode depender de chamar alguém.
--   · admin e gestor, qualquer ligação, de qualquer dia.
--
-- O QUE NÃO SE CORRIGE POR AQUI (e a recusa diz o caminho)
--   · ligação que ainda não tem resultado: tabula-se na tela de ligar;
--   · resultado "Reunião marcada", de ida ou de volta: reunião tem data, sala
--     e convite — marca-se e cancela-se pela Agenda;
--   · pedido de "não ligar": a supressão NUNCA é desfeita por esta função
--     (guardrail de opt-out). Corrigir o resultado não devolve o contato à
--     lista de quem pode ser contatado.
--
-- NENHUMA MENSAGEM SAI POR CAUSA DE UMA CORREÇÃO. O gatilho do aviso de
-- ligação não atendida só dispara quando o resultado sai de vazio; aqui ele
-- sai de um resultado para outro. Na direção contrária, corrigir "Não atendeu"
-- para "atendeu" tira da fila o aviso que ainda não saiu.
--
-- RF-FUN-12, RF-FUN-13, RF-MET-01, RF-REL-01, RF-ADM-03
-- =====================================================================

create or replace function public.ligacao_corrigir(
  p_client_key     uuid,
  p_attempt_id     uuid,
  p_resultado      app.call_result,
  p_outcome_id     int  default null,
  p_motivo         text default null,
  p_observacao     text default null,
  p_lost_reason_id int  default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_hoje       date := (now() at time zone 'America/Fortaleza')::date;
  v_motivo     text := nullif(btrim(coalesce(p_motivo, '')), '');
  a            public.call_attempts%rowtype;
  act          public.activities%rowtype;
  o_old        public.interaction_outcomes%rowtype;
  o            public.interaction_outcomes%rowtype;
  b            public.call_batches%rowtype;
  it           public.call_batch_items%rowtype;
  d            public.deals%rowtype;
  h            public.deal_stage_history%rowtype;
  v_slug       text;
  v_quem       text;
  v_reg        jsonb;
  v_nova       uuid;
  v_task       uuid;
  v_etapa      text := 'nao_mexeu';   -- nao_mexeu | voltou | ja_tinha_andado | nao_voltou
  v_tarefas    int  := 0;
  v_aviso      boolean := false;
  v_volta      boolean;
  v_nome_antes text;
  v_recusa     text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_client_key is null or p_resultado is null then
    return jsonb_build_object('ok', false, 'motivo', 'resultado_invalido');
  end if;

  select * into a from public.call_attempts where id = p_attempt_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_inexistente');
  end if;
  if not (app.is_manager() or a.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'de_outra_pessoa');
  end if;
  -- O clique repetido (ou a rede que caiu depois de gravar) devolve a mesma resposta.
  if a.client_key is not null and a.client_key = p_client_key then
    return jsonb_build_object('ok', true, 'repetido', true, 'attempt_id', a.id,
                              'activity_id', a.activity_id);
  end if;
  if not app.is_manager()
     and (a.iniciada_em at time zone 'America/Fortaleza')::date <> v_hoje then
    return jsonb_build_object('ok', false, 'motivo', 'de_outro_dia');
  end if;
  if a.resultado is null or a.activity_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_resultado');
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;

  -- Os dois eixos, com a mesma coerência que `tabular_chamada` exige.
  if p_resultado = 'atendida_humano'::app.call_result then
    select * into o from public.interaction_outcomes
     where id = p_outcome_id and is_active
       and 'ligacao'::app.interaction_surface = any (surfaces) and requires_answer;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'resultado_invalido');
    end if;
  else
    if p_outcome_id is not null then
      return jsonb_build_object('ok', false, 'motivo', 'resultado_invalido');
    end if;
    v_slug := app.outcome_for_call_result(p_resultado);
    select * into o from public.interaction_outcomes where slug = v_slug and is_active;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'resultado_invalido');
    end if;
  end if;

  select * into act from public.activities where id = a.activity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sem_resultado');
  end if;
  select * into o_old from public.interaction_outcomes where id = act.outcome_id;

  if o.slug = 'lig_reuniao_marcada' then
    return jsonb_build_object('ok', false, 'motivo', 'reuniao_pela_agenda');
  end if;
  if o_old.slug = 'lig_reuniao_marcada' then
    return jsonb_build_object('ok', false, 'motivo', 'tem_reuniao');
  end if;
  if a.resultado = p_resultado and o_old.id is not distinct from o.id then
    return jsonb_build_object('ok', false, 'motivo', 'mesmo_resultado');
  end if;
  if o.requires_lost_reason
     and not exists (select 1 from public.lost_reasons lr
                      where lr.id = p_lost_reason_id and lr.is_active) then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_de_perda_obrigatorio');
  end if;

  v_nome_antes := case when a.resultado = 'atendida_humano'::app.call_result
                       then coalesce(o_old.name, 'Atendeu')
                       else coalesce(o_old.name, a.resultado::text) end;
  select p.full_name into v_quem from public.profiles p where p.id = v_uid;

  -- Tudo o que vem a seguir vale junto ou não vale: se o lançamento novo for
  -- recusado, o estorno é desfeito com ele (o bloco é uma subtransação).
  begin
    -- -----------------------------------------------------------------
    -- 1. Estorno
    -- -----------------------------------------------------------------
    if act.deal_id is not null then
      select * into d from public.deals where id = act.deal_id for update;

      -- A mudança de etapa que ESTE registro fez nasceu na mesma transação que
      -- ele: `now()` é o relógio da transação, então as duas linhas têm
      -- exatamente a mesma hora.
      select * into h from public.deal_stage_history x
       where x.deal_id = act.deal_id and x.changed_at = act.created_at
       order by x.id desc limit 1;
      if found and h.from_stage_id is not null then
        if d.stage_id = h.to_stage_id then
          begin
            update public.deals x
               set stage_id = h.from_stage_id,
                   stage_change_reason = 'Resultado da ligação corrigido: era "' || v_nome_antes || '"'
             where x.id = d.id;
            v_etapa := 'voltou';
          exception when others then
            -- Etapa aposentada, ou etapa que exige um dado que o negócio já não tem.
            v_etapa := 'nao_voltou';
          end;
        else
          v_etapa := 'ja_tinha_andado';
        end if;
      end if;

      with canceladas as (
        update public.tasks t
           set status = 'cancelled'::app.task_status
         where t.deal_id = act.deal_id
           and t.created_at = act.created_at
           and t.origin = 'system'
           and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
        returning t.title, t.due_at)
      select count(*)::int into v_tarefas from canceladas;

      update public.deals x
         set last_intent = null, last_intent_at = null
       where x.id = act.deal_id and x.last_intent_at = act.occurred_at;
    end if;

    -- O aviso de "tentamos falar com você" não faz sentido para quem atendeu.
    if a.resultado in ('nao_atendeu'::app.call_result, 'caixa_postal'::app.call_result,
                       'ocupado'::app.call_result)
       and p_resultado = 'atendida_humano'::app.call_result then
      begin
        v_aviso := coalesce((public.aviso_ligacao_cancelar(a.id) ->> 'ok')::boolean, false);
      exception when others then
        v_aviso := false;
      end;
    end if;

    -- -----------------------------------------------------------------
    -- 2. O registro antigo vira nota do sistema (rastro, e não contagem)
    -- -----------------------------------------------------------------
    update public.activities x
       set type        = 'system'::app.activity_type,
           author_kind = 'system',
           outcome_id  = null,
           body        = 'Resultado da ligação corrigido por ' || coalesce(v_quem, 'alguém do time')
                         || ': era "' || v_nome_antes || '", passou a "' || o.name || '". Motivo: '
                         || v_motivo,
           metadata    = coalesce(x.metadata, '{}'::jsonb)
                         || jsonb_build_object('corrigido', jsonb_build_object(
                              'em', now(), 'por', v_uid, 'motivo', v_motivo,
                              'desfecho_antes', o_old.slug, 'resultado_antes', a.resultado::text,
                              'observacao_antes', act.body))
     where x.id = act.id;

    -- -----------------------------------------------------------------
    -- 3. O resultado certo, pelo caminho de sempre
    -- -----------------------------------------------------------------
    v_reg := public.registrar_contato(
               p_client_key      => p_client_key,
               p_organization_id => a.organization_id,
               p_outcome_id      => o.id,
               p_com_quem        => coalesce(act.metadata ->> 'com_quem', 'nao_informado'),
               p_deal_id         => act.deal_id,
               p_occurred_at     => act.occurred_at,
               p_body            => coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), act.body),
               p_duration_min    => act.duration_min,
               p_lost_reason_id  => p_lost_reason_id);
    if not coalesce((v_reg ->> 'registrado')::boolean, false) then
      raise exception using errcode = 'KC001', message = coalesce(v_reg ->> 'motivo', 'resultado_invalido');
    end if;
    v_nova := (v_reg ->> 'activity_id')::uuid;
    v_task := nullif(v_reg ->> 'task_id', '')::uuid;

    -- A ligação é de quem ligou, mesmo quando outra pessoa corrige.
    update public.activities x
       set user_id  = a.user_id,
           metadata = coalesce(x.metadata, '{}'::jsonb)
                      || jsonb_build_object('corrige', act.id::text)
     where x.id = v_nova;
    if a.user_id is distinct from v_uid then
      update public.tasks t set assignee_id = a.user_id
       where t.id = v_task and t.assignee_id = v_uid;
      if coalesce((v_reg ->> 'assumiu_negocio')::boolean, false) then
        update public.deals x set owner_id = a.user_id
         where x.id = (v_reg ->> 'deal_id')::uuid and x.owner_id = v_uid;
      end if;
    end if;

    -- A próxima ação do negócio não pode apontar para uma tarefa cancelada.
    if v_tarefas > 0 and act.deal_id is not null then
      update public.deals x
         set next_action    = prox.title,
             next_action_at = prox.due_at
        from (select (select t.title from public.tasks t
                       where t.deal_id = act.deal_id
                         and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
                         and t.due_at is not null
                       order by t.due_at limit 1) as title,
                     (select t.due_at from public.tasks t
                       where t.deal_id = act.deal_id
                         and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
                         and t.due_at is not null
                       order by t.due_at limit 1) as due_at) prox
       where x.id = act.deal_id
         and x.status = 'open'::app.deal_status
         and not exists (select 1 from public.tasks t
                          where t.deal_id = x.id
                            and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
                            and t.due_at = x.next_action_at);
    end if;

    -- -----------------------------------------------------------------
    -- 4. A tentativa, que é a linha que o relatório do dia lê
    -- -----------------------------------------------------------------
    update public.call_attempts x
       set resultado   = p_resultado,
           outcome_id  = case when p_resultado = 'atendida_humano'::app.call_result then o.id end,
           atendida_em = case when p_resultado = 'atendida_humano'::app.call_result
                              then coalesce(x.atendida_em, x.encerrada_em, x.iniciada_em)
                              else x.atendida_em end,
           activity_id = v_nova,
           client_key  = p_client_key
     where x.id = a.id;

    update public.voice_calls vc set activity_id = v_nova where vc.activity_id = act.id;

    -- -----------------------------------------------------------------
    -- 5. O lugar do contato na fila do lote, pela regra da tabulação
    -- -----------------------------------------------------------------
    select * into b  from public.call_batches where id = a.batch_id;
    select * into it from public.call_batch_items where id = a.item_id for update;
    if b.status <> 'encerrado'::app.call_batch_status
       and it.status in ('fila'::app.call_item_status, 'concluido'::app.call_item_status) then
      v_volta := o.can_reactivate
                 and o.next_action_kind = 'call'::app.task_kind
                 and it.attempts < b.max_attempts
                 and not app.is_suppressed_target(it.organization_id, it.contact_id)
                 and b.ends_on >= v_hoje;
      update public.call_batch_items x
         set status       = case when v_volta then 'fila'::app.call_item_status
                                 else 'concluido'::app.call_item_status end,
             scheduled_at = case when v_volta
                                 then coalesce(x.scheduled_at,
                                               now() + make_interval(hours => b.min_hours_between_attempts))
                            end
       where x.id = it.id;
    end if;
  exception when sqlstate 'KC001' then
    v_recusa := sqlerrm;
  end;

  if v_recusa is not null then
    return jsonb_build_object('ok', false,
      'motivo', case when v_recusa in ('motivo_de_perda_obrigatorio', 'sem_permissao')
                     then v_recusa else 'resultado_invalido' end,
      'detalhe', v_recusa);
  end if;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (v_uid, app.role()::text, 'CORRIGIR_RESULTADO', 'call_attempts', a.id::text,
          jsonb_build_object('resultado', a.resultado::text, 'desfecho', o_old.slug,
                             'activity_id', act.id),
          jsonb_build_object('resultado', p_resultado::text, 'desfecho', o.slug,
                             'activity_id', v_nova, 'motivo', v_motivo,
                             'de_quem', a.user_id, 'etapa', v_etapa,
                             'tarefas_canceladas', v_tarefas, 'aviso_cancelado', v_aviso));

  return jsonb_build_object(
    'ok',                 true,
    'repetido',           false,
    'attempt_id',         a.id,
    'activity_id',        v_nova,
    'era',                v_nome_antes,
    'ficou',              o.name,
    'etapa',              v_etapa,
    'etapa_antes',        v_reg ->> 'etapa_antes',
    'etapa_depois',       v_reg ->> 'etapa_depois',
    'tarefas_canceladas', v_tarefas,
    'aviso_cancelado',    v_aviso,
    'proxima_acao_em',    v_reg -> 'proxima_acao_em',
    'proxima_acao_titulo',v_reg -> 'proxima_acao_titulo');
end $$;

comment on function public.ligacao_corrigir(uuid, uuid, app.call_result, int, text, text, int) is
  'Corrige o resultado de uma ligação já tabulada: estorna o que o resultado errado mexeu (etapa, próxima ação, intenção, aviso na fila), transforma o registro antigo em nota do sistema e lança o resultado certo por registrar_contato, na hora da ligação e no nome de quem ligou. Quem ligou corrige no mesmo dia; admin e gestor, sempre. Não mexe em reunião marcada nem desfaz pedido de não ligar. Auditado como CORRIGIR_RESULTADO.';
revoke all on function public.ligacao_corrigir(uuid, uuid, app.call_result, int, text, text, int) from public, anon;
grant execute on function public.ligacao_corrigir(uuid, uuid, app.call_result, int, text, text, int) to authenticated;

notify pgrst, 'reload schema';

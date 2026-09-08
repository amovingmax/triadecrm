-- =====================================================================
-- A tabulação da ligação enfileira o resumo (RF-CON-20, RF-CON-24;
-- ADR-03, ADR-04, ADR-05, ADR-10, ADR-11; R13 §3.2)
--
-- O pendente estava escrito no CHANGELOG desde o D10, com todas as letras:
-- "Ninguém enfileira `ai_jobs` sozinho ainda... a tabulação da ligação
-- deveria enfileirar `summarize_call`". O worker-wa já enfileira os dois
-- trabalhos de conversa (`transcribe_audio` e `classify_inbound`); os dois
-- de ligação não tinham gatilho nenhum. E como `draft_followup` nasce de
-- dentro do `summarize_call` (apps/workers/src/ia/tarefas.ts), a falta de
-- UMA linha deixava DOIS dos quatro prompts — com evals, custo medido e
-- validador de promessas — prontos e inertes.
--
-- Duas peças:
--
--   A. `app.ia_enfileirar_resumo(attempt)` — uma porta ESTREITA. A larga
--      (`app.ia_enfileirar`) aceita qualquer propósito e qualquer payload,
--      e por isso continua fora do alcance de `authenticated`: gasto que
--      ninguém nomeou é gasto que ninguém orçou. Esta aqui só sabe pedir o
--      resumo de UMA tentativa, e faz as cinco perguntas antes de pedir.
--
--   B. `public.tabular_chamada` chama a porta estreita e DIZ no retorno o
--      que aconteceu. Enfileirar em silêncio seria a mesma coisa que não
--      enfileirar: ninguém saberia por que o resumo não apareceu na ficha.
--
-- Por que aqui dentro, e não na tela: quem sabe que a conversa terminou é
-- esta função, e o gasto tem de nascer na MESMA transação da tabulação —
-- se ela voltar atrás, a chamada paga volta junto. A tela chamando a fila
-- depois seria uma segunda fonte da verdade sobre "esta ligação acabou",
-- que é exatamente o defeito que o laudo §3.2 achou no piso de recontato.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. A porta estreita
-- ---------------------------------------------------------------------
-- As cinco perguntas são as MESMAS que `resumirLigacao` faz do outro lado
-- da fila, e isso é de propósito: o que o worker recusaria não deve custar
-- uma volta de fila para ouvir "não". A quinta (supressão) é a que também
-- existe no worker, duas vezes — na leitura e outra vez antes do POST —
-- porque entre a fila e a chamada o mundo muda (RF-CON-18).
--
-- Toda recusa devolve MOTIVO NOMEADO. "Não enfileirou" sem motivo é
-- silêncio, e silêncio é o que fez este pendente durar um dia inteiro.
create or replace function app.ia_enfileirar_resumo(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a       public.call_attempts%rowtype;
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_res   jsonb;
begin
  select * into a from public.call_attempts where id = p_attempt_id;
  if not found then
    return jsonb_build_object('enfileirado', false, 'motivo', 'tentativa_inexistente');
  end if;

  -- Quem chega pela tela é `authenticated`: `public.tabular_chamada` é
  -- SECURITY INVOKER e não alcançaria a porta larga. Então a estreita repete
  -- a pergunta que a tabulação já fez — é dinheiro, e dinheiro tem dono.
  -- `auth.uid()` nulo é o worker (service_role), que já provou quem é no JWT.
  if v_uid is not null then
    if not app.can_write() then
      return jsonb_build_object('enfileirado', false, 'motivo', 'sem_permissao');
    end if;
    select b.owner_id into v_owner from public.call_batches b where b.id = a.batch_id;
    if not (app.is_manager() or v_owner = v_uid) then
      return jsonb_build_object('enfileirado', false, 'motivo', 'sem_permissao');
    end if;
  end if;

  -- 1. a chamada terminou?
  if a.encerrada_em is null then
    return jsonb_build_object('enfileirado', false, 'motivo', 'tentativa_aberta');
  end if;

  -- 2. alguém atendeu? Sem atendimento não há conversa a resumir, e
  --    `lig_nao_atendeu` é tabulação automática, sem texto e sem modelo — é a
  --    premissa de custo do CHAMADAS_POR_MES em packages/prompts.
  if a.resultado is distinct from 'atendida_humano'::app.call_result then
    return jsonb_build_object('enfileirado', false, 'motivo', 'sem_atendimento');
  end if;

  -- 3. o roteiro foi percorrido? É o `caminho_vazio` que o worker recusa.
  if coalesce(array_length(a.caminho_script, 1), 0) = 0 then
    return jsonb_build_object('enfileirado', false, 'motivo', 'caminho_vazio');
  end if;

  -- 4. tem atividade? É onde o resumo vai ser lido (activities.metadata).
  if a.activity_id is null then
    return jsonb_build_object('enfileirado', false, 'motivo', 'sem_atividade');
  end if;

  -- 5. o alvo pediu para sair? (RF-CON-18)
  if app.is_suppressed_target(a.organization_id, a.contact_id) then
    return jsonb_build_object('enfileirado', false, 'motivo', 'contato_suprimido');
  end if;

  -- A chave de idempotência viaja DENTRO do payload e TAMBÉM como chave da
  -- esteira: sem ela no payload o worker não sabe qual mensagem concluir
  -- (apps/workers/src/ia/fila.ts). É o mesmo `attempt:<uuid>` que o próprio
  -- worker usa ao enfileirar o `draft_followup` no fim do resumo.
  v_res := app.ia_enfileirar(
             'summarize_call',
             jsonb_build_object('attempt_id', a.id, 'chave', 'attempt:' || a.id),
             'attempt:' || a.id);
  return jsonb_build_object('motivo', null) || v_res;
end $$;
comment on function app.ia_enfileirar_resumo(uuid) is
  'Põe o resumo de UMA tentativa de ligação na fila do worker-ai (RF-CON-20). É a porta estreita: app.ia_enfileirar aceita qualquer propósito e qualquer payload e continua fora do alcance de authenticated. Recusa com motivo nomeado — tentativa_inexistente, sem_permissao, tentativa_aberta, sem_atendimento, caminho_vazio, sem_atividade, contato_suprimido — que são as mesmas perguntas que resumirLigacao faz do outro lado da fila: o que o worker recusaria não deve custar uma volta de fila.';
revoke all on function app.ia_enfileirar_resumo(uuid) from public, anon;
grant execute on function app.ia_enfileirar_resumo(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- B. A tabulação passa a chamar a porta
-- ---------------------------------------------------------------------
-- Recriada inteira (era a versão da 20260905000801). A diferença são três
-- trechos: a declaração de `v_resumo`, a chamada logo depois de a tentativa
-- e o item estarem fechados, e duas chaves novas no retorno.
create or replace function public.tabular_chamada(
  p_client_key            uuid,
  p_chamada_id            uuid,
  p_item_id               uuid,
  p_resultado             app.call_result,
  p_com_quem              text        default 'nao_informado',
  p_outcome_id            int         default null,
  p_caminho_script        text[]      default '{}',
  p_duracao_seg           int         default 0,
  p_observacao            text        default null,
  p_capturas              jsonb       default '{}'::jsonb,
  p_agendar_para          timestamptz default null,
  p_lost_reason_id        int         default null,
  p_reuniao_em            timestamptz default null,
  p_reuniao_formato       text        default null,
  p_pediu_para_nao_ligar  boolean     default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  a           public.call_attempts%rowtype;
  b           public.call_batches%rowtype;
  o           public.interaction_outcomes%rowtype;
  -- O item é lido COLUNA A COLUNA, e não com %rowtype, porque esta função é
  -- SECURITY INVOKER e `call_batch_items.phone_e164` não é legível por sdr
  -- (RF-BAS-14, seção 9). `select *` aqui seria "permission denied for column",
  -- e contorná-lo com definer daria a esta função mais poder do que quem a chama.
  v_item_org  uuid;
  v_item_ct   uuid;
  v_item_deal uuid;
  v_item_st   app.call_item_status;
  v_item_tent int;
  v_slug      text;
  v_reg       jsonb;
  v_motivo    text;
  v_supr      boolean;
  v_volta     boolean := false;
  v_status    app.call_item_status;
  v_agenda    timestamptz;
  v_restam    int;
  v_activity  uuid;
  v_task      uuid;
  v_optout    boolean := coalesce(p_pediu_para_nao_ligar, false);
  v_opt       jsonb;
  v_resumo    jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('tabulado', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;

  -- As três recusas abaixo são anteriores a saber QUEM é o alvo: sem organização
  -- não há opt-out a registrar, e inventar um alvo seria pior do que não registrar.
  select * into a from public.call_attempts where id = p_chamada_id;
  if not found then
    return jsonb_build_object('tabulado', false, 'motivo', 'chamada_ja_encerrada',
                              'detalhe', 'chamada_inexistente');
  end if;
  if a.item_id <> p_item_id then
    return jsonb_build_object('tabulado', false, 'motivo', 'item_de_outro_dono',
                              'detalhe', 'chamada_de_outro_item');
  end if;

  select x.organization_id, x.contact_id, x.deal_id, x.status, x.attempts
    into v_item_org, v_item_ct, v_item_deal, v_item_st, v_item_tent
    from public.call_batch_items x where x.id = a.item_id;
  select * into b from public.call_batches b2 where b2.id = a.batch_id;
  if not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('tabulado', false, 'motivo', 'item_de_outro_dono', 'detalhe', null);
  end if;

  -- ----- daqui para baixo, nenhuma recusa engole o pedido de opt-out (D6) -----
  if b.status = 'encerrado'::app.call_batch_status then
    return app.recusa_de_tabulacao('lote_encerrado', null,
                                   v_optout, v_item_org, v_item_ct, p_observacao);
  end if;

  -- ----- idempotência: a fila offline reenvia -----
  if a.encerrada_em is not null then
    if a.client_key is not null and a.client_key = p_client_key then
      if v_optout then
        v_opt := app.registrar_optout_de_contato(v_item_org, v_item_ct, p_observacao,
                                                 'phone'::app.channel);
      end if;
      v_restam := app.itens_restantes_do_lote(b.id);
      return jsonb_build_object(
        'tabulado', true, 'repetido', true,
        'attempt_id', a.id, 'activity_id', a.activity_id,
        'item_status', v_item_st, 'volta_para_fila', v_item_st = 'fila'::app.call_item_status,
        'tentativas', v_item_tent,
        'proxima_acao_em', null, 'proxima_acao_titulo', null,
        'restantes', v_restam,
        'optout_registrado', coalesce((v_opt ->> 'registrado')::boolean, false));
    end if;
    return app.recusa_de_tabulacao('chamada_ja_encerrada', null,
                                   v_optout, v_item_org, v_item_ct, p_observacao);
  end if;

  -- ----- os dois eixos (R13 §3.3): sem atendimento não existe resultado comercial -----
  if p_resultado = 'atendida_humano'::app.call_result then
    if p_outcome_id is null then
      return app.recusa_de_tabulacao('eixos_incoerentes', 'atendeu_sem_desfecho',
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
    select * into o from public.interaction_outcomes
     where id = p_outcome_id and is_active
       and 'ligacao'::app.interaction_surface = any (surfaces);
    if not found then
      return app.recusa_de_tabulacao('desfecho_invalido', null,
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
    if not o.requires_answer then
      return app.recusa_de_tabulacao('eixos_incoerentes', o.slug,
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
  else
    if p_outcome_id is not null then
      return app.recusa_de_tabulacao('eixos_incoerentes', 'sem_atendimento_com_desfecho',
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
    v_slug := app.outcome_for_call_result(p_resultado);
    select * into o from public.interaction_outcomes where slug = v_slug and is_active;
    if not found then
      return app.recusa_de_tabulacao('desfecho_invalido', v_slug,
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
  end if;

  -- ----- a consequência sai de registrar_contato, não daqui -----
  v_reg := public.registrar_contato(
             p_client_key             => p_client_key,
             p_organization_id        => v_item_org,
             p_outcome_id             => o.id,
             p_com_quem               => p_com_quem,
             p_deal_id                => v_item_deal,
             p_occurred_at            => now(),
             p_body                   => p_observacao,
             p_duration_min           => nullif(round(coalesce(p_duracao_seg, 0) / 60.0)::int, 0),
             p_lost_reason_id         => p_lost_reason_id,
             p_meeting_at             => p_reuniao_em,
             p_meeting_format         => p_reuniao_formato,
             p_next_action_at         => p_agendar_para);

  if not (v_reg ->> 'registrado')::boolean then
    v_motivo := case v_reg ->> 'motivo'
                  when 'motivo_de_perda_obrigatorio' then 'motivo_de_perda_obrigatorio'
                  when 'reuniao_sem_data'            then 'reuniao_sem_data'
                  when 'sem_permissao'               then 'sem_permissao'
                  else 'desfecho_invalido'
                end;
    -- ESTA é a linha do defeito D6: a recusa mais comum da tabulação — "Sem
    -- interesse" sem motivo de perda, que é o próprio caminho do nó fim_optout —
    -- devolvia o não e descartava o pedido de opt-out junto.
    return app.recusa_de_tabulacao(v_motivo, v_reg ->> 'motivo',
                                   v_optout, v_item_org, v_item_ct, p_observacao);
  end if;
  v_activity := nullif(v_reg ->> 'activity_id', '')::uuid;
  v_task     := nullif(v_reg ->> 'task_id', '')::uuid;
  v_supr     := coalesce((v_reg ->> 'contato_suprimido')::boolean, false);

  -- ----- "não me ligue mais" (RF-CON-18) -----
  -- Depois do desfecho, e não no lugar dele: a atividade é a prova de que o pedido
  -- existiu, e app.consent_apply é quem marca do_not_contact, semeia a
  -- suppression_list, cancela as tarefas abertas e leva o negócio para a etapa de
  -- opt-out — que é a última palavra sobre a etapa, e por isso vem por último.
  if v_optout then
    v_opt  := app.registrar_optout_de_contato(v_item_org, v_item_ct, p_observacao,
                                              'phone'::app.channel);
    v_supr := v_supr or coalesce((v_opt ->> 'registrado')::boolean, false);
  end if;

  -- ----- fecha a tentativa -----
  update public.call_attempts x
     set encerrada_em   = now(),
         atendida_em    = case when p_resultado = 'atendida_humano'::app.call_result
                               then coalesce(x.atendida_em, now()) else x.atendida_em end,
         duracao_seg    = greatest(coalesce(p_duracao_seg, 0), 0),
         resultado      = p_resultado,
         outcome_id     = case when p_resultado = 'atendida_humano'::app.call_result then o.id end,
         activity_id    = v_activity,
         caminho_script = coalesce(p_caminho_script, '{}'),
         capturas       = coalesce(p_capturas, '{}'::jsonb),
         client_key     = p_client_key
   where x.id = a.id
  returning * into a;

  -- ----- o item volta para a fila? -----
  -- Quem decide é o CATÁLOGO, não a tela: desfecho cuja próxima ação é ligar de
  -- novo (`next_action_kind = 'call'`) e que não bloqueia o alvo (`can_reactivate`)
  -- pede outra tentativa. É o que cobre "não atendeu", "caixa postal" e "atendeu,
  -- retorna depois"; "número errado" (outra ação), "interessado", "agora não",
  -- "sem interesse" e "reunião marcada" encerram o item.
  v_volta := o.can_reactivate
             and o.next_action_kind = 'call'::app.task_kind
             and v_item_tent < b.max_attempts
             and not v_supr
             and b.ends_on >= (now() at time zone 'America/Fortaleza')::date;

  if v_volta then
    v_agenda := coalesce(p_agendar_para,
                         now() + make_interval(hours => b.min_hours_between_attempts));
    v_status := 'fila'::app.call_item_status;
  else
    v_agenda := null;
    v_status := case when v_supr then 'devolvido'::app.call_item_status
                     else 'concluido'::app.call_item_status end;
  end if;

  update public.call_batch_items x
     set status         = v_status,
         scheduled_at   = v_agenda,
         reserved_until = null,
         reserved_by    = null,
         note           = coalesce(nullif(trim(coalesce(p_observacao, '')), ''), x.note)
   where x.id = a.item_id
  returning x.status, x.attempts into v_item_st, v_item_tent;

  -- §3.12b: a tarefa de ligar de novo diz em qual tentativa do lote está.
  -- `v_item_tent` já é o número de tentativas FEITAS (a chamada de agora conta).
  if o.next_action_kind = 'call'::app.task_kind then
    perform app.titulo_da_tentativa(v_task, o.next_action_label, v_item_tent, b.max_attempts);
  end if;

  -- ----- o resumo da ligação entra na fila da IA (R13 §3.2; RF-CON-20) -----
  -- Aqui, e não na tela: quem sabe que a conversa terminou é esta função, e o
  -- gasto tem de nascer DENTRO da mesma transação da tabulação — se ela voltar
  -- atrás, a chamada paga volta junto. A porta é estreita de propósito
  -- (`app.ia_enfileirar_resumo`) e refaz sozinha todas as perguntas, inclusive
  -- a da supressão, que a esta altura já conhece o opt-out registrado acima.
  v_resumo := app.ia_enfileirar_resumo(a.id);

  -- §3.12e: "restantes" não conta quem foi suprimido no meio do lote.
  v_restam := app.itens_restantes_do_lote(b.id);

  return jsonb_build_object(
    'tabulado',            true,
    'repetido',            coalesce((v_reg ->> 'repetido')::boolean, false),
    'attempt_id',          a.id,
    'activity_id',         v_activity,
    'item_status',         v_item_st,
    'volta_para_fila',     v_volta,
    'tentativas',          v_item_tent,
    'proxima_acao_em',     v_reg -> 'proxima_acao_em',
    'proxima_acao_titulo', v_reg -> 'proxima_acao_titulo',
    'restantes',           v_restam,
    'outcome_slug',        o.slug,
    'contato_suprimido',   v_supr,
    'optout_registrado',   coalesce((v_opt ->> 'registrado')::boolean, false),
    'resumo_enfileirado',  coalesce((v_resumo ->> 'enfileirado')::boolean, false),
    'resumo_motivo',       v_resumo ->> 'motivo',
    'registro',            v_reg);
end $$;
comment on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                           text, jsonb, timestamptz, int, timestamptz, text, boolean) is
  'Fecha a tentativa de ligação com os dois eixos do R13 §3.3 e delega TODA a consequência comercial a public.registrar_contato (etapa, temperatura, próxima ação, cooldown, guardrail de supressão). Devolve o item à fila quando o desfecho do catálogo pede nova tentativa, e escreve na tarefa em QUAL tentativa do lote ela está (§3.12b). "restantes" não conta contato suprimido (§3.12e). Idempotente pela chave do cliente. O pedido de "não me ligue mais" (p_pediu_para_nao_ligar) é registrado em QUALQUER desfecho e TAMBÉM em toda recusa posterior à autorização (D6, RF-CON-18): recusa nunca descarta opt-out. Recusa prevista volta como {tabulado:false, motivo, optout_registrado}. Ao fechar a tentativa, enfileira o resumo da ligação pela porta estreita app.ia_enfileirar_resumo (RF-CON-20) e devolve resumo_enfileirado/resumo_motivo: a chamada paga nasce na MESMA transação da tabulação, e nunca para quem acabou de pedir para sair.';
revoke all on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                              text, jsonb, timestamptz, int, timestamptz, text, boolean)
  from public, anon;
grant execute on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                                 text, jsonb, timestamptz, int, timestamptz, text, boolean)
  to authenticated, service_role;



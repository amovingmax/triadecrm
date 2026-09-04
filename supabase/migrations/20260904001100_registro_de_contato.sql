-- ===========================================================================
-- Registro de contato: a entrada que faltava para a temperatura existir.
--
-- Requisitos: RF-MET-06 (registrar um contato em menos de 20 s), RF-FUN-03/04
-- (próxima ação e motivo de perda), RF-FUN-12/13 (catálogo de desfechos e janela
-- de recontato), RF-MET-01 (porta aberta exige com quem se falou), RF-CON-18
-- (opt-out). PRD §5.6 e docs/design/spec-desfechos-de-interacao.md.
--
-- O PROBLEMA
-- ----------
-- A base tem 100 organizações reais e todas aparecem "Frio, sem contato". Não é
-- defeito de `app.compute_temperature`: é falta de entrada. A regra lê ETAPA,
-- INTENÇÃO, RECÊNCIA e STATUS, e uma atividade solta só move a recência
-- (`app.activities_touch_deal` toca `deals.last_activity_at` e nada mais). Quem
-- move etapa é `public.move_deal` (migração 20260904000900), que também assume o
-- negócio sem dono para quem move — e é esse claim que, na sequência, deixa o
-- `update deals set last_intent` passar na política `deals_update`.
--
-- O QUE ESTA FUNÇÃO É
-- -------------------
-- Uma casca fina e SECURITY INVOKER. Ela não tem regra própria de temperatura, de
-- etapa nem de porta: grava a atividade sob a RLS que já existe, delega o lado do
-- negócio ao `move_deal`, escreve a intenção que o catálogo declara e devolve tudo
-- numa resposta só. Existe pela TRANSAÇÃO e pela IDA E VOLTA ÚNICA — na calçada,
-- duas chamadas são dois lugares onde o registro morre pela metade —, não por
-- regra nova. Tudo o que ela decide já estava decidido em
-- `public.interaction_outcomes`.
--
-- Recusa prevista NÃO é exceção: volta como `{registrado:false, motivo}` para a
-- tela virar frase em português. Erro de programa continua sendo exceção.
-- ===========================================================================

-- ---------- idempotência do registro (a fila offline reenvia) ----------
-- A tela grava na calçada, e a calçada tem sombra de sinal: o envio fica numa fila
-- e é reenviado quando a rede volta. A chave de idempotência vem do cliente
-- (`crypto.randomUUID`) e o índice é quem garante que reenviar não duplica.
create unique index if not exists activities_client_key_idx
  on public.activities ((metadata ->> 'client_key'))
  where metadata ? 'client_key';

comment on index public.activities_client_key_idx is
  'Chave de idempotência de public.registrar_contato: o reenvio da fila offline não duplica a atividade.';

-- ---------- registrar_contato ----------
create or replace function public.registrar_contato(
  p_client_key             uuid,
  p_organization_id        uuid,
  p_outcome_id             int,
  p_com_quem               text          default 'nao_informado',
  p_deal_id                uuid          default null,
  p_expected_stage_id      int           default null,
  p_occurred_at            timestamptz   default now(),
  p_body                   text          default null,
  p_duration_min           int           default null,
  p_lost_reason_id         int           default null,
  p_meeting_at             timestamptz   default null,
  p_meeting_format         text          default null,
  p_authorization_evidence text          default null,
  p_next_action_kind       app.task_kind default null,
  p_next_action_title      text          default null,
  p_next_action_at         timestamptz   default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid          uuid := auth.uid();
  o              public.interaction_outcomes%rowtype;
  v_surface      app.interaction_surface;
  v_type         app.activity_type;
  v_channel      app.channel;
  v_com_quem     text := coalesce(nullif(trim(p_com_quem), ''), 'nao_informado');
  v_occurred     timestamptz := coalesce(p_occurred_at, now());
  v_deal         public.deals%rowtype;
  v_temp_antes   app.temperature;
  v_etapa_antes  text;
  v_activity     uuid;
  v_meta         jsonb;
  v_repetido     boolean := false;
  v_stage_id     int;
  v_stage        public.stages%rowtype;
  v_fields       jsonb := '{}'::jsonb;
  v_next         jsonb;
  v_na_kind      app.task_kind;
  v_na_title     text;
  v_na_at        timestamptz;
  v_move         jsonb;
  v_aplicada     boolean := false;
  v_recusa       text;
  v_claim        boolean := false;
  v_task         uuid;
  v_intent       text;
  v_espera       int;
  v_dia          date;
  v_temp_alvo    app.temperature;
  v_cooldown     timestamptz;
  v_etapa_depois text;
  v_temp_depois  app.temperature;
  v_atencao      boolean := false;
  v_hoje         date := (now() at time zone 'America/Fortaleza')::date;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('registrado', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;
  if v_com_quem not in ('decisor', 'influenciador', 'funcionario', 'ninguem', 'nao_informado') then
    v_com_quem := 'nao_informado';
  end if;

  -- ----- o desfecho manda -----
  select * into o from public.interaction_outcomes where id = p_outcome_id and is_active;
  if not found then
    return jsonb_build_object('registrado', false, 'motivo', 'desfecho_invalido', 'detalhe', null);
  end if;

  -- O par (tipo, canal) sai do CATÁLOGO, não do pedido: a tela escolhe o desfecho e
  -- o desfecho já sabe em que superfície vive. Mandar o par pela rede seria pedir à
  -- interface que acertasse a combinação que `app.activities_apply_outcome`
  -- revalida. Os 34 desfechos da seed têm exatamente uma superfície; se um dia um
  -- tiver duas, a derivação deixa de ser determinística e a recusa diz isso.
  if cardinality(o.surfaces) <> 1 then
    return jsonb_build_object('registrado', false, 'motivo', 'desfecho_fora_da_superficie',
                              'detalhe', o.slug);
  end if;
  v_surface := o.surfaces[1];
  select t.tipo, t.canal into v_type, v_channel
    from (values
      ('whatsapp',     'message'::app.activity_type, 'whatsapp'::app.channel),
      ('ligacao',      'call'::app.activity_type,    'phone'::app.channel),
      ('visita',       'visit'::app.activity_type,   'presencial'::app.channel),
      ('reuniao',      'meeting'::app.activity_type, 'presencial'::app.channel),
      ('instagram_dm', 'message'::app.activity_type, 'instagram'::app.channel)
    ) as t(superficie, tipo, canal)
   where t.superficie = v_surface::text;
  if v_type is null then
    return jsonb_build_object('registrado', false, 'motivo', 'desfecho_fora_da_superficie',
                              'detalhe', v_surface::text);
  end if;

  -- ----- o que o desfecho exige antes de qualquer escrita -----
  if o.requires_lost_reason and p_lost_reason_id is null then
    return jsonb_build_object('registrado', false, 'motivo', 'motivo_de_perda_obrigatorio',
                              'detalhe', null);
  end if;
  if o.slug in ('lig_reuniao_marcada', 'reu_reagendada') and p_meeting_at is null then
    return jsonb_build_object('registrado', false, 'motivo', 'reuniao_sem_data', 'detalhe', null);
  end if;
  if o.slug = 'reu_autorizou'
     and nullif(trim(coalesce(p_authorization_evidence, '')), '') is null then
    return jsonb_build_object('registrado', false, 'motivo', 'autorizacao_sem_evidencia',
                              'detalhe', null);
  end if;

  -- ----- o parceiro -----
  -- organizations_view em vez da tabela: a política organizations_select é
  -- `is_manager() or reads_base_pii()`, e sdr não é nenhum dos dois. A view aplica
  -- app.org_is_visible, que é a visibilidade que vale para este papel.
  if not exists (select 1 from public.organizations_view v where v.id = p_organization_id) then
    return jsonb_build_object('registrado', false, 'motivo', 'organizacao_inexistente',
                              'detalhe', null);
  end if;

  -- ----- o negócio -----
  -- Sem `p_deal_id`, escolhe o negócio aberto da organização, preferindo o funil que
  -- tem a etapa de destino do desfecho (metade da base é `produtor`, e 5 dos 9
  -- destinos do catálogo não existem nesse funil).
  if p_deal_id is not null then
    select d.* into v_deal from public.deals d where d.id = p_deal_id;
  else
    select d.* into v_deal
      from public.deals d
     where d.organization_id = p_organization_id
       and d.status = 'open'::app.deal_status
     order by (o.target_stage_slug is not null
               and exists (select 1 from public.stages s
                            where s.pipeline_id = d.pipeline_id
                              and s.slug = o.target_stage_slug)) desc,
              d.last_activity_at desc nulls last,
              d.created_at
     limit 1;
  end if;
  if found then
    v_temp_antes  := v_deal.temperature;
    select s.name into v_etapa_antes from public.stages s where s.id = v_deal.stage_id;
  end if;

  -- ----- a atividade (RF-MET-06) -----
  -- Só `com_quem` e `client_key` vão no metadata pela mão: `outcome_slug`,
  -- `door_opened`, `door_knocked` e `cooldown_until` quem escreve é o gatilho
  -- `app.activities_apply_outcome`, e `deals.last_activity_at` é o
  -- `app.activities_touch_deal`.
  begin
    insert into public.activities
      (type, channel, organization_id, contact_id, deal_id, user_id, occurred_at,
       duration_min, body, outcome_id, metadata)
    values
      (v_type, v_channel, p_organization_id, v_deal.primary_contact_id, v_deal.id, v_uid,
       v_occurred,
       case when v_type = 'meeting'::app.activity_type then p_duration_min end,
       nullif(trim(coalesce(p_body, '')), ''),
       o.id,
       jsonb_build_object('com_quem', v_com_quem, 'client_key', p_client_key::text))
    returning id, metadata into v_activity, v_meta;
  exception when unique_violation then
    -- Reenvio da fila offline: a atividade já está gravada. Devolve o estado de
    -- agora, sem duplicar nada e sem mexer no negócio de novo.
    v_repetido := true;
    select a.id, a.metadata into v_activity, v_meta
      from public.activities a
     where a.metadata ->> 'client_key' = p_client_key::text;
  end;

  -- ----- o lado do negócio -----
  if not v_repetido and v_deal.id is not null then

    -- A próxima ação sai do catálogo quando o pedido não a trouxe. A régua é a do
    -- RF-MET-06 aplicada à temperatura resultante (D+1 quente, D+3 morno, D+7 frio),
    -- em dias CORRIDOS (a mesma unidade de cooldown_days), pousando no próximo dia
    -- útil às 09:00 de Fortaleza. Espelha `prazoSugerido` em components/registro/tipos.ts;
    -- na prática a tela sempre manda o valor já calculado e isto é a rede de segurança.
    v_na_kind  := coalesce(p_next_action_kind, o.next_action_kind);
    v_na_title := nullif(trim(coalesce(p_next_action_title, o.next_action_label, '')), '');
    v_na_at    := p_next_action_at;
    if o.next_action_kind is not null and v_na_at is null then
      v_temp_alvo := coalesce(
        o.sets_temperature,
        (select s.temperature from public.stages s
          where s.pipeline_id = v_deal.pipeline_id and s.slug = o.target_stage_slug),
        v_temp_antes, 'frio'::app.temperature);
      v_espera := coalesce(o.next_action_offset_days,
                           case v_temp_alvo when 'quente' then 1 when 'morno' then 3 else 7 end);
      if v_espera = 0 then
        v_na_at := v_occurred + interval '15 minutes';
      else
        v_dia := (v_occurred at time zone 'America/Fortaleza')::date + v_espera;
        for i in 1..14 loop
          exit when extract(isodow from v_dia) < 6
                    and not exists (select 1 from public.holidays h where h.date = v_dia);
          v_dia := v_dia + 1;
        end loop;
        v_na_at := (v_dia + time '09:00') at time zone 'America/Fortaleza';
      end if;
    end if;
    if v_na_at is not null and v_na_title is not null then
      v_next := jsonb_build_object('kind', v_na_kind::text, 'label', v_na_title,
                                   'at', v_na_at);
    end if;

    -- Etapa: só quando o catálogo declara um destino E esse destino existe no funil
    -- deste negócio. `etapa_fora_do_funil` é recusa honesta, não erro: o registro de
    -- campo já está gravado e o funil `produtor` simplesmente não tem essa coluna.
    if o.target_stage_slug is not null then
      select s.* into v_stage
        from public.stages s
       where s.pipeline_id = v_deal.pipeline_id and s.slug = o.target_stage_slug;
      if not found then
        v_recusa := 'etapa_fora_do_funil';
      else
        v_stage_id := v_stage.id;
        if p_lost_reason_id is not null then
          v_fields := v_fields || jsonb_build_object('lost_reason_id', p_lost_reason_id);
        end if;
        if p_meeting_at is not null then
          v_fields := v_fields || jsonb_build_object('meeting_at', p_meeting_at);
        end if;
        if p_meeting_format is not null then
          v_fields := v_fields || jsonb_build_object('meeting_format', p_meeting_format);
        end if;
        if p_authorization_evidence is not null then
          v_fields := v_fields
                      || jsonb_build_object('authorization_evidence', p_authorization_evidence);
        end if;

        v_move := public.move_deal(v_deal.id, v_stage_id, p_expected_stage_id,
                                   o.name || ' (' || v_surface::text || ')', v_fields, v_next);
        if (v_move ->> 'ok')::boolean then
          v_aplicada := true;
          v_claim    := coalesce((v_move ->> 'claimed')::boolean, false);
          v_task     := nullif(v_move ->> 'task_id', '')::uuid;
        else
          v_recusa := case v_move ->> 'reason'
                        when 'negocio_nao_encontrado' then 'etapa_fora_do_funil'
                        when 'etapa_de_outro_funil'   then 'etapa_fora_do_funil'
                        else v_move ->> 'reason'
                      end;
        end if;
      end if;
    end if;

    -- Tarefa da próxima ação quando o `move_deal` não a criou (desfecho sem etapa de
    -- destino, ou etapa recusada). RF-FUN-03 não deixa negócio aberto sem próxima ação,
    -- e "não atendeu" precisa deixar a ligação de amanhã na fila dela.
    if v_task is null and v_na_at is not null and v_na_title is not null then
      insert into public.tasks (title, kind, due_at, assignee_id, organization_id,
                                deal_id, contact_id, created_by, origin)
      values (left(v_na_title, 200), coalesce(v_na_kind, 'follow_up'::app.task_kind), v_na_at,
              coalesce(v_deal.owner_id, v_uid), p_organization_id, v_deal.id,
              v_deal.primary_contact_id, v_uid, 'system')
      returning id into v_task;

      -- `deals.next_action` é a cópia denormalizada que o cartão do kanban e a lista
      -- de parceiros mostram; quando quem cria a tarefa é o `move_deal`, ele já a
      -- sincroniza. Aqui a tarefa nasceu fora dele, então a cópia é atualizada à mão —
      -- e só quando a nova ação é a MAIS PRÓXIMA, que é a que interessa a quem olha o
      -- cartão. Passa pela RLS como qualquer update: em negócio sem dono não acha
      -- linha, e aí a tarefa continua valendo (ela é da pessoa, não do cartão).
      update public.deals d
         set next_action    = left(v_na_title, 200),
             next_action_at = v_na_at
       where d.id = v_deal.id
         and (d.next_action_at is null
              or d.next_action_at > v_na_at
              or (d.next_action_at at time zone 'America/Fortaleza')::date < v_hoje);
    end if;

    -- Intenção: a outra entrada que `app.compute_temperature` lê (o ramo v_hot/v_warm).
    -- O catálogo declara `sets_temperature` em três desfechos que a etapa sozinha não
    -- explicaria (`lig_interessado` e `vis_decisor_interessado` levam a `em_conversa`,
    -- que é morno, mas valem quente; `lig_atendeu_retorna` não tem etapa e vale morno).
    -- Escrever a intenção é como esse "quente" chega à regra oficial sem reimplementá-la.
    -- Depois do move_deal DE PROPÓSITO: é o claim dele que faz este update passar em
    -- `deals_update` num negócio que estava sem dono. Sem claim, o update não acha linha
    -- e a temperatura fica na do estágio — o resultado devolvido diz a verdade.
    if o.sets_temperature is not null then
      v_intent := case o.sets_temperature
                    when 'quente' then 'interessado'
                    when 'morno'  then 'quer_saber_mais'
                    else 'agora_nao'
                  end;
      update public.deals d
         set last_intent = v_intent, last_intent_at = v_occurred
       where d.id = v_deal.id;
    end if;
  end if;

  -- ----- estado depois (a autoridade é o banco, nunca a previsão da tela) -----
  if v_deal.id is not null then
    select s.name, d.temperature, d.needs_attention
      into v_etapa_depois, v_temp_depois, v_atencao
      from public.deals d join public.stages s on s.id = d.stage_id
     where d.id = v_deal.id;
    select c.cooldown_until into v_cooldown
      from public.v_contact_cooldown c where c.organization_id = p_organization_id;
    select t.due_at, t.title into v_na_at, v_na_title
      from public.tasks t where t.id = v_task;
  end if;

  return jsonb_build_object(
    'registrado',         true,
    'repetido',           v_repetido,
    'activity_id',        v_activity,
    'deal_id',            v_deal.id,
    'task_id',            v_task,
    'outcome_slug',       o.slug,
    'etapa_antes',        v_etapa_antes,
    'etapa_depois',       v_etapa_depois,
    'etapa_aplicada',     v_aplicada,
    'etapa_recusa',       v_recusa,
    'assumiu_negocio',    v_claim,
    'temperatura_antes',  v_temp_antes,
    'temperatura_depois', v_temp_depois,
    'precisa_atencao',    coalesce(v_atencao, false),
    'porta_aberta',       coalesce((v_meta ->> 'door_opened')::boolean, false),
    'porta_batida',       coalesce((v_meta ->> 'door_knocked')::boolean, false),
    'cooldown_ate',       v_cooldown,
    'proxima_acao_em',    case when v_task is not null then v_na_at end,
    'proxima_acao_titulo',case when v_task is not null then v_na_title end,
    'sem_negocio',        v_deal.id is null);
end $$;

comment on function public.registrar_contato(uuid, uuid, int, text, uuid, int, timestamptz, text,
                                             int, int, timestamptz, text, text, app.task_kind,
                                             text, timestamptz) is
  'Registra um contato em uma chamada (RF-MET-06): grava a atividade com o desfecho do catálogo (RF-FUN-12), delega a etapa ao public.move_deal (RF-FUN-03/04), cria a tarefa da próxima ação e escreve a intenção declarada pelo desfecho, para app.compute_temperature reagir. Idempotente pela chave do cliente. Recusa prevista volta como {registrado:false, motivo}.';

revoke all on function public.registrar_contato(uuid, uuid, int, text, uuid, int, timestamptz, text,
                                                int, int, timestamptz, text, text, app.task_kind,
                                                text, timestamptz) from public, anon;
grant execute on function public.registrar_contato(uuid, uuid, int, text, uuid, int, timestamptz, text,
                                                   int, int, timestamptz, text, text, app.task_kind,
                                                   text, timestamptz) to authenticated, service_role;

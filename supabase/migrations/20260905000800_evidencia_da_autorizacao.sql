-- =====================================================================
-- A evidência da autorização deixa de ser jogada fora, e os campos
-- obrigatórios da etapa passam a ser do BANCO (laudo §3.1, §3.9, §3.12i)
--
-- Três defeitos da mesma família, todos em torno de `stages.required_fields`:
--
-- §3.1 [alta] — A etapa "Autorizou" do funil fornecedor declara
--   `authorization_evidence` com `consent_kind = data_use_authorized`; a etapa
--   "Parceria aceita" do funil produtor (que é onde `app.stage_for` resolve o
--   desfecho "Realizada, autorizou" — ver `stage_equivalences` da migração
--   20260904001200) declarava lista VAZIA. Como a evidência só vira
--   `consent_events` quando a etapa de destino declara `consent_kind`, a
--   Heloísa colhia o "autorizo" de uma cerimonialista, digitava a frase literal
--   numa tela que EXIGE o campo (`registrar_contato` recusa `reu_autorizou` sem
--   evidência) e a prova era descartada em silêncio. Depois o pré-cadastro
--   recusava com `sem_autorizacao` sem dizer que a prova nunca existiu. Pega
--   metade da base (produtores, cerimonialistas e assessorias).
--   O conserto é de catálogo, e está aqui e na `seed.sql`.
--
-- §3.9 [média] — `stages.required_fields` era lido pela tela e pelo `move_deal`,
--   mas não pelo gatilho: um `PATCH` direto no PostgREST (que `authenticated`
--   pode fazer, RLS diz QUEM escreve, não o que é linha válida) punha o cartão
--   em "Reunião marcada" sem data e em "Autorizou" sem prova nenhuma. A leitura
--   passa para dentro de `app.deals_before_write`, ao lado do `lost_reason_id`
--   que já morava lá.
--
-- §3.12i — o rótulo do campo dizia "…registrada em consent_events" e essa frase
--   chegava à Heloísa como "Preencha: evidência da autorização (texto literal,
--   data e canal) registrada em consent_events." (`folha-mover.tsx:271` e
--   `use-quadro.ts:106` imprimem `required_fields[].label` cru). Rótulo em
--   português de gente.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 1. O catálogo (o mesmo texto que a `seed.sql` passa a trazer)
-- ---------------------------------------------------------------------------
-- Vive aqui além da seed porque a seed não roda sozinha em base de pé: sem esta
-- parte, um banco existente continuaria descartando a autorização do produtor.
-- O `update` é idempotente e escreve exatamente o que a seed escreve.

-- 1a. "Autorizou" (funil fornecedor): mesmo campo, rótulo sem jargão (§3.12i).
update public.stages s
   set required_fields = $j$[
        {"field":"authorization_evidence",
         "label":"O que ele autorizou, com as palavras dele (a frase, a data e por onde veio)",
         "consent_kind":"data_use_authorized"}]$j$::jsonb
  from public.pipelines p
 where p.id = s.pipeline_id and p.slug = 'fornecedor' and s.slug = 'autorizou';

-- 1b. "Parceria aceita" (funil produtor): passa a declarar o MESMO consent_kind,
--     e é isto que faz a evidência virar prova (§3.1).
--
--     `"required": false` não é frouxidão, é o que esta etapa é: "Parceria
--     aceita" é o destino de DOIS slugs canônicos ao mesmo tempo — `autorizou`
--     (o sim registrado, que traz a evidência) e `cadastro_em_andamento` (o
--     desfecho "Cadastro iniciado na hora" de uma visita, que não coleta frase
--     nenhuma, nem na tela nem na RPC). Exigir a frase aqui deixaria a Heloísa
--     sem conseguir registrar "cadastro iniciado na hora" num produtor —
--     recusa `campos_obrigatorios` num chip que não tem onde digitar. Então a
--     regra é: quando a evidência vier, ela VIRA PROVA; quando não vier, a
--     etapa não é barrada por isso.
--
--     O guardrail que protege o parceiro continua inteiro e em outro lugar:
--     `gerar_link_de_reivindicacao`, `komune_push`, a cadência `pos_autorizacao`
--     (`requires_authorization`) e o dreno do outbox recusam com
--     `sem_autorizacao` sem `consent_events.data_use_authorized` vigente.
--
--     PENDENTE DE DECISÃO HUMANA (Rafael/Heloísa): tornar o campo exigido aqui
--     depende de "Cadastro iniciado na hora" passar a colher a evidência
--     também — hoje `registrar_contato` só a exige em `reu_autorizou` e a tela
--     de /registrar só a pede nesse chip.
update public.stages s
   set required_fields = $j$[
        {"field":"authorization_evidence",
         "label":"O que ele autorizou, com as palavras dele (a frase, a data e por onde veio)",
         "consent_kind":"data_use_authorized",
         "required":false}]$j$::jsonb
  from public.pipelines p
 where p.id = s.pipeline_id and p.slug = 'produtor' and s.slug = 'parceria_aceita';


-- ---------------------------------------------------------------------------
-- 2. Os campos obrigatórios da etapa passam a ser do banco (§3.9)
-- ---------------------------------------------------------------------------
-- O que muda: além do motivo de perda, o gatilho passa a LER
-- `stages.required_fields` da etapa de destino e a recusar a entrada quando a
-- consequência declarada não existe na linha. O gatilho não vê `p_fields` (isso
-- é do `move_deal`), então ele cobra o EFEITO, que é o que sobrevive a um
-- `PATCH`:
--
--   * spec com `consent_kind`  → tem de haver autorização vigente da
--     organização (`app.tem_autorizacao_vigente`). É por isso que o `move_deal`
--     abaixo grava `consent_events` ANTES do `update`: a prova precisa existir
--     no instante em que o cartão entra na etapa.
--   * spec `type = 'timestamptz'` (na seed, `meeting_at`) → o negócio tem de
--     sair com `next_action_at` preenchido. É o contrato que o `move_deal` já
--     cumpre (a data da reunião VIRA a próxima ação e a tarefa `meeting`), e é
--     a única marca que a data combinada deixa em `deals`.
--   * spec `lost_reason_id` / `table = lost_reasons` → já era coberto pela
--     regra de perda logo abaixo, que vale até para etapa mal configurada.
--   * `"required": false` → declarado só para ser gravado quando vier; não barra.
--
-- O que NÃO é coberto, dito de frente: `meeting_format` (enum) não deixa marca
-- em `deals` e não tem como ser conferido a partir da linha; e a regra vale na
-- MUDANÇA de etapa (`UPDATE`), não na criação do negócio. Criar negócio já
-- dentro de uma etapa adiantada é o que as fixtures e a esteira de ingestão
-- fazem (a esteira só cria em `prospectado`/`identificado`), e cobrar ali
-- quebraria a montagem de estado sem fechar nenhum caminho de produto.
create or replace function app.deals_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s      record;
  v_spec jsonb;
begin
  select st.pipeline_id, st.is_won, st.is_lost, st.is_dormant, st.is_optout, st.name,
         st.required_fields
    into s from public.stages st where st.id = new.stage_id;
  if s.pipeline_id is null then
    raise exception 'Etapa % não existe', new.stage_id using errcode = '23503';
  end if;
  if s.pipeline_id <> new.pipeline_id then
    raise exception 'A etapa % não pertence ao funil %', new.stage_id, new.pipeline_id using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    new.entered_stage_at := now();
    -- O motivo vale só se vier no mesmo comando da mudança de etapa (não herda o anterior).
    if new.stage_change_reason is not distinct from old.stage_change_reason then
      new.stage_change_reason := null;
    end if;
    if s.is_won then
      new.status := 'won';
    elsif s.is_lost then
      new.status := 'lost';
    elsif s.is_dormant then
      new.status := 'nurturing';                -- Nutrição/dormente é etapa E status (PRD §5.6: Frio)
    elsif old.status in ('won','lost','nurturing') then
      new.status := 'open';                     -- reabertura/saída da nutrição (PRD §5.3)
    end if;

    -- RF-FUN-04 no banco (§3.9): a etapa cobra o que declarou, venha o comando
    -- do `move_deal` ou de um `PATCH` direto no PostgREST.
    for v_spec in select e.value from jsonb_array_elements(coalesce(s.required_fields, '[]'::jsonb)) e loop
      if coalesce((v_spec ->> 'required')::boolean, true) is not true then
        continue;
      end if;
      if v_spec ? 'consent_kind' then
        if not app.tem_autorizacao_vigente(new.organization_id) then
          raise exception
            'A etapa "%" exige autorização registrada em consent_events antes de entrar (RF-FUN-04, RF-PRE-06)',
            s.name using errcode = '23514';
        end if;
      elsif coalesce(v_spec ->> 'type', '') = 'timestamptz'
            and new.next_action_at is null then
        raise exception 'A etapa "%" exige % — e ela vira a próxima ação do negócio (RF-FUN-04)',
          s.name, coalesce(v_spec ->> 'label', v_spec ->> 'field') using errcode = '23514';
      end if;
    end loop;
  elsif tg_op = 'INSERT' then
    if s.is_won then new.status := 'won';
    elsif s.is_lost then new.status := 'lost';
    elsif s.is_dormant then new.status := 'nurturing';
    end if;
  end if;

  -- RF-FUN-04: perda exige motivo da lista fechada — exceto no opt-out, que é perda por regra
  -- (guardrail: imediato e nunca reabre) e não tem motivo a escolher. Sair da etapa de opt-out
  -- ou de perda limpa o motivo para não sobrar lixo no relatório de motivos de perda.
  if new.status = 'lost' and not coalesce(s.is_optout, false) and new.lost_reason_id is null then
    raise exception 'A etapa "%" exige um motivo de perda (RF-FUN-04)', s.name using errcode = '23514';
  end if;
  if new.status <> 'lost' or coalesce(s.is_optout, false) then
    new.lost_reason_id := null;
  end if;

  if new.status = 'won'  and new.won_at  is null then new.won_at  := now(); end if;
  if new.status = 'lost' and new.lost_at is null then new.lost_at := now(); end if;
  if new.status <> 'won'  then new.won_at  := null; end if;
  if new.status <> 'lost' then new.lost_at := null; end if;
  if new.status <> 'paused' then new.paused_until := null; end if;

  new.updated_at := now();
  return new;
end $$;
comment on function app.deals_before_write() is
  'Coerência etapa × funil, status derivado da etapa, carimbos, motivo de perda E os campos obrigatórios da etapa (RF-FUN-04): na mudança de etapa o gatilho lê stages.required_fields e cobra a consequência declarada (autorização em consent_events; data da reunião como próxima ação), para que um UPDATE direto não burle o que o move_deal cobra.';


-- ---------------------------------------------------------------------------
-- 3. `move_deal`: a prova antes do movimento, e `"required": false` no catálogo
-- ---------------------------------------------------------------------------
-- Cópia da migração 20260904000900 com DUAS mudanças, marcadas no corpo:
--   a) a spec de campo obrigatório aceita `"required": false` — declarada para
--      virar prova quando vier, sem barrar a entrada na etapa (§3.1);
--   b) o `insert` em `consent_events` sai de depois do `update` para ANTES dele,
--      porque agora é o gatilho quem cobra a autorização na entrada (§3.9).
create or replace function public.move_deal(
  p_deal_id           uuid,
  p_to_stage_id       int,
  p_expected_stage_id int   default null,
  p_reason            text  default null,
  p_fields            jsonb default '{}'::jsonb,
  p_next_action       jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid            uuid := auth.uid();
  v_role           app.user_role;
  v_deal           public.deals%rowtype;
  v_stage          public.stages%rowtype;
  v_org_deleted    timestamptz;
  v_saida          boolean;
  v_claim          boolean := false;
  v_reason         text := nullif(trim(coalesce(p_reason, '')), '');
  v_fields         jsonb := coalesce(p_fields, '{}'::jsonb);
  v_missing        jsonb := '[]'::jsonb;
  v_consents       jsonb := '[]'::jsonb;
  v_spec           jsonb;
  v_key            text;
  v_val            jsonb;
  v_txt            text;
  v_type           text;
  v_required       boolean;
  v_ts             timestamptz;
  v_lost           int;
  v_consent_kind   app.consent_kind;
  v_meeting_at     timestamptz;
  v_meeting_format text;
  v_na_kind        app.task_kind;
  v_na_label       text;
  v_na_at          timestamptz;
  v_hoje           date := (now() at time zone 'America/Fortaleza')::date;
  v_prev_reason    text;
  v_task           uuid;
  v_card           jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_role := app.role();

  -- Papéis sem escrita (leitura, financeiro) param aqui, como na política deals_update.
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;

  select d.* into v_deal from public.deals d where d.id = p_deal_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'negocio_nao_encontrado');
  end if;

  -- Organização apagada (soft delete) não se trabalha.
  select o.deleted_at into v_org_deleted
    from public.organizations o where o.id = v_deal.organization_id;
  if v_org_deleted is not null then
    return jsonb_build_object('ok', false, 'reason', 'negocio_nao_encontrado');
  end if;

  -- Visibilidade: cópia literal da política deals_select.
  if not (app.sees_all()
          or (v_role = 'embaixador'::app.user_role
              and (v_deal.owner_id = v_uid or app.org_is_mine(v_deal.organization_id)))) then
    return jsonb_build_object('ok', false, 'reason', 'negocio_nao_encontrado');
  end if;

  -- Escrita: cópia da política deals_update (is_manager ou dono), mais a única
  -- ampliação desta migração, escrita e restrita: negócio SEM DONO é do bolo comum
  -- e quem o move o assume. Negócio com outro dono continua fora de alcance.
  v_claim := v_deal.owner_id is null;
  if not (app.is_manager() or v_deal.owner_id = v_uid or v_claim) then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  -- E o WITH CHECK da mesma política: embaixador só mexe em organização dele.
  if v_role = 'embaixador'::app.user_role and not app.org_is_editable(v_deal.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;

  select s.* into v_stage from public.stages s where s.id = p_to_stage_id;
  if not found or v_stage.pipeline_id <> v_deal.pipeline_id then
    return jsonb_build_object('ok', false, 'reason', 'etapa_de_outro_funil');
  end if;

  -- Duas pessoas arrastando o mesmo cartão: quem chegou depois recebe a etapa real.
  if p_expected_stage_id is not null and p_expected_stage_id <> v_deal.stage_id then
    return jsonb_build_object('ok', false, 'reason', 'etapa_mudou',
                              'current_stage_id', v_deal.stage_id);
  end if;
  if p_to_stage_id = v_deal.stage_id then
    return jsonb_build_object('ok', false, 'reason', 'etapa_igual');
  end if;

  v_saida := v_stage.is_won or v_stage.is_lost or v_stage.is_dormant or v_stage.is_terminal;

  -- ----- campos obrigatórios da etapa (RF-FUN-04) -----
  -- Dirigido por dados: a regra é o que está em stages.required_fields, então um
  -- campo novo no catálogo passa a ser exigido sem uma linha de código nova.
  for v_spec in select e.value from jsonb_array_elements(v_stage.required_fields) e loop
    v_key  := v_spec ->> 'field';
    v_type := coalesce(v_spec ->> 'type', '');
    -- `"required": false` (seed: a evidência em "Parceria aceita") = o campo é
    -- declarado para VIRAR PROVA quando vier, não para barrar a entrada na etapa.
    v_required := coalesce((v_spec ->> 'required')::boolean, true);
    v_val  := v_fields -> v_key;
    v_txt  := case
                when v_val is null or jsonb_typeof(v_val) = 'null' then null
                when jsonb_typeof(v_val) = 'string' then nullif(trim(v_val #>> '{}'), '')
                else v_val #>> '{}'
              end;

    -- Motivo de perda: lista fechada (lost_reasons), recusa com nome próprio.
    if v_key = 'lost_reason_id' or coalesce(v_spec ->> 'table', '') = 'lost_reasons' then
      begin
        v_lost := v_txt::int;
      exception when invalid_text_representation then
        v_lost := null;
      end;
      if v_lost is null
         or not exists (select 1 from public.lost_reasons lr where lr.id = v_lost and lr.is_active) then
        return jsonb_build_object('ok', false, 'reason', 'motivo_de_perda_invalido');
      end if;
      continue;
    end if;

    if v_txt is null then
      if v_required then
        v_missing := v_missing || jsonb_build_array(v_spec);
      end if;
      continue;
    end if;

    if v_type = 'timestamptz' then
      begin
        v_ts := v_txt::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        v_ts := null;
      end;
      if v_ts is null then
        v_missing := v_missing || jsonb_build_array(v_spec);
        continue;
      end if;
      if v_key = 'meeting_at' then
        v_meeting_at := v_ts;
      end if;
    elsif v_type = 'enum' then
      if not exists (select 1
                       from jsonb_array_elements_text(coalesce(v_spec -> 'options', '[]'::jsonb)) o
                      where o.value = v_txt) then
        v_missing := v_missing || jsonb_build_array(v_spec);
        continue;
      end if;
      if v_key = 'meeting_format' then
        v_meeting_format := v_txt;
      end if;
    end if;

    -- Campo que é prova de consentimento (na seed: a evidência da autorização da
    -- etapa "Autorizou") vira linha em consent_events — guardrail do CLAUDE.md:
    -- pré-cadastro só depois de autorização registrada. Gravado DEPOIS de todas as
    -- validações, para não sobrar prova de um movimento que foi recusado.
    if v_spec ? 'consent_kind' then
      begin
        v_consent_kind := (v_spec ->> 'consent_kind')::app.consent_kind;
      exception when invalid_text_representation then
        raise exception 'Etapa "%": consent_kind "%" não existe em app.consent_kind',
          v_stage.name, v_spec ->> 'consent_kind' using errcode = '22P02';
      end;
      v_consents := v_consents || jsonb_build_array(
        jsonb_build_object('kind', v_consent_kind::text, 'text', v_txt));
    end if;
  end loop;

  if jsonb_array_length(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'campos_obrigatorios', 'missing', v_missing);
  end if;

  -- Perda exige motivo mesmo que a etapa esteja mal configurada no catálogo (sem a
  -- linha `lost_reason_id` em required_fields): é o guardrail do RF-FUN-04 e o que
  -- impede o relatório de motivos de perda de nascer furado. Opt-out é perda POR
  -- REGRA e não tem motivo a escolher (PRD §5.3).
  if v_stage.is_lost and not v_stage.is_optout and v_lost is null then
    begin
      v_lost := nullif(trim(coalesce(v_fields ->> 'lost_reason_id', '')), '')::int;
    exception when invalid_text_representation then
      v_lost := null;
    end;
    if v_lost is null
       or not exists (select 1 from public.lost_reasons lr where lr.id = v_lost and lr.is_active) then
      return jsonb_build_object('ok', false, 'reason', 'motivo_de_perda_invalido');
    end if;
  end if;

  -- ----- próxima ação (RF-FUN-03) -----
  if p_next_action is not null and jsonb_typeof(p_next_action) = 'object' then
    v_na_label := nullif(trim(regexp_replace(coalesce(p_next_action ->> 'label', ''), '\s+', ' ', 'g')), '');
    v_na_kind  := coalesce(nullif(p_next_action ->> 'kind', ''), 'follow_up')::app.task_kind;
    begin
      v_na_at := (p_next_action ->> 'at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      v_na_at := null;
    end;
    if v_na_label is null or v_na_at is null then
      return jsonb_build_object('ok', false, 'reason', 'proxima_acao_obrigatoria');
    end if;
    if (v_na_at at time zone 'America/Fortaleza')::date < v_hoje then
      return jsonb_build_object('ok', false, 'reason', 'proxima_acao_no_passado');
    end if;
  end if;

  -- A reunião/demonstração marcada É a próxima ação quando nenhuma outra veio no
  -- pedido. É a solução do contrato para required_fields pedir meeting_at/
  -- meeting_format sem que exista coluna de reunião em deals (agenda é D7):
  -- a data vira deals.next_action_at e uma tarefa kind = 'meeting'.
  if v_na_at is null and v_meeting_at is not null then
    v_na_at    := v_meeting_at;
    v_na_kind  := 'meeting'::app.task_kind;
    v_na_label := v_stage.name
                  || coalesce(' — formato: ' || v_meeting_format, '');
    if (v_na_at at time zone 'America/Fortaleza')::date < v_hoje then
      return jsonb_build_object('ok', false, 'reason', 'proxima_acao_no_passado');
    end if;
  end if;

  -- Etapa de trabalho exige próxima ação FUTURA depois do movimento. Etapa de saída
  -- (ganho, perda, opt-out, nutrição) dispensa: a justificativa é a própria etapa.
  -- Uma próxima ação futura que o negócio JÁ tem satisfaz a regra — o requisito é
  -- "negócio aberto sem próxima ação futura é destacado" (RF-FUN-03), não "digite
  -- de novo o que já está marcado".
  if not v_saida and v_na_at is null
     and not (v_deal.next_action_at is not null
              and nullif(trim(coalesce(v_deal.next_action, '')), '') is not null
              and (v_deal.next_action_at at time zone 'America/Fortaleza')::date >= v_hoje) then
    return jsonb_build_object('ok', false, 'reason', 'proxima_acao_obrigatoria');
  end if;

  -- ----- escrita -----
  -- O motivo viaja no MESMO comando da mudança de etapa, para o gatilho
  -- app.deals_track_stage copiá-lo ao histórico (RF-FUN-08). O GUC app.stage_reason
  -- é a rede de segurança do único caso em que deals_before_write zera a coluna:
  -- quando o motivo é idêntico ao da mudança anterior.
  if v_reason is not null then
    v_prev_reason := current_setting('app.stage_reason', true);
    perform set_config('app.stage_reason', v_reason, true);
  end if;

  -- Provas de consentimento (append-only; o gatilho consent_apply cuida do resto).
  --
  -- ANTES do `update`, e não depois (laudo §3.9): a partir desta migração
  -- `app.deals_before_write` cobra, na entrada de uma etapa que declara
  -- `consent_kind`, que exista autorização vigente da organização. A prova tem
  -- de estar gravada no instante em que o cartão entra na etapa. Nenhuma recusa
  -- esperada acontece daqui para baixo (todas já retornaram `{ok:false}`), e
  -- qualquer exceção a partir daqui desfaz esta linha junto com o movimento.
  for v_spec in select e.value from jsonb_array_elements(v_consents) e loop
    insert into public.consent_events (kind, organization_id, contact_id, evidence_text)
    values ((v_spec ->> 'kind')::app.consent_kind, v_deal.organization_id,
            v_deal.primary_contact_id, v_spec ->> 'text');
  end loop;

  update public.deals d
     set stage_id            = p_to_stage_id,
         stage_change_reason = v_reason,
         owner_id            = case when v_claim then v_uid else d.owner_id end,
         lost_reason_id      = case when v_stage.is_lost and not v_stage.is_optout
                                    then v_lost else d.lost_reason_id end,
         next_action         = case when v_na_label is not null then v_na_label
                                    when v_saida then null
                                    else d.next_action end,
         next_action_at      = case when v_na_at is not null then v_na_at
                                    when v_saida then null
                                    else d.next_action_at end
   where d.id = p_deal_id;

  if v_reason is not null then
    perform set_config('app.stage_reason', coalesce(v_prev_reason, ''), true);
  end if;

  -- Tarefa da próxima ação, para o dono do negócio (o novo dono, quando houve claim).
  if v_na_at is not null then
    insert into public.tasks (title, kind, due_at, assignee_id, organization_id,
                              deal_id, contact_id, created_by, origin)
    values (left(v_na_label, 200), v_na_kind, v_na_at, coalesce(v_deal.owner_id, v_uid),
            v_deal.organization_id, p_deal_id, v_deal.primary_contact_id, v_uid, 'system')
    returning id into v_task;
  end if;

  -- Reunião marcada além da próxima ação (o pedido trouxe as duas coisas): o
  -- compromisso também vira tarefa, senão a data combinada não existe em lugar nenhum.
  if v_meeting_at is not null and (v_na_kind is distinct from 'meeting'::app.task_kind
                                   or v_na_at is distinct from v_meeting_at) then
    insert into public.tasks (title, kind, due_at, assignee_id, organization_id,
                              deal_id, contact_id, created_by, origin)
    values (left(v_stage.name || coalesce(' — formato: ' || v_meeting_format, ''), 200),
            'meeting'::app.task_kind, v_meeting_at, coalesce(v_deal.owner_id, v_uid),
            v_deal.organization_id, p_deal_id, v_deal.primary_contact_id, v_uid, 'system');
  end if;

  -- Guardrail de opt-out (CLAUDE.md, RF-ADM-04): arrastar um cartão para a etapa
  -- "Opt-out / não contatar" É um opt-out. Sem esta linha o cartão mudava de coluna
  -- e o número continuava contatável — do_not_contact e suppression_list só existem
  -- a partir de consent_events. Não é o motor de automação de etapa (RF-FUN-05, que
  -- fica para D5–D7): é a única consequência que não pode esperar por ele.
  -- O gatilho app.consent_apply faz o resto (flag, hashes e os outros negócios da
  -- organização); este negócio já está na etapa e não é movido de novo.
  if v_stage.is_optout then
    insert into public.consent_events (kind, organization_id, contact_id, evidence_text)
    values ('contact_optout'::app.consent_kind, v_deal.organization_id, v_deal.primary_contact_id,
            coalesce(v_reason, 'Movido para a etapa "' || v_stage.name || '" no funil'));
  end if;

  select c.card into v_card from app.deal_cards c where c.deal_id = p_deal_id;

  return jsonb_build_object(
           'ok',            true,
           'card',          v_card,
           'from_stage_id', v_deal.stage_id,
           'to_stage_id',   p_to_stage_id,
           'claimed',       v_claim,
           'task_id',       v_task);
end $$;
comment on function public.move_deal(uuid, int, int, text, jsonb, jsonb) is
  'Move um negócio de etapa com as validações do RF-FUN-03/04 no banco (próxima ação, campos obrigatórios da etapa, motivo de perda da lista fechada), grava a prova de consentimento ANTES do movimento (o gatilho deals_before_write a exige na entrada), grava deal_stage_history (RF-FUN-08) e audit_log pelos gatilhos, e assume negócio sem dono para quem move. Recusa esperada volta como {ok:false, reason}.';

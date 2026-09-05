-- =====================================================================
-- TRIADE — v0.1 — D6/D9 — Correção: UM TOQUE PENDENTE POR PESSOA
-- (fecha o furo encontrado ao escrever supabase/tests/17_cadencias_e_precadastro.sql)
--
-- O QUE ESTAVA FURADO
--   A migração 20260904001700 promete, no cabeçalho e em comentário de tabela,
--   "UM TOQUE PENDENTE POR CONTATO, EM QUALQUER CANAL … regra dura de banco
--   (dois índices únicos parciais + gatilho)". Os dois índices são
--   `cadence_touches_um_pendente` (por matrícula) e
--   `cadence_touches_um_pendente_por_org` (por ORGANIZAÇÃO). Nenhum é por
--   CONTATO.
--
--   Em Natal isso não é hipótese de laboratório: `public.contacts` tem índice
--   único por telefone e `public.organization_contacts` é muitos-para-muitos —
--   a mesma sócia aparece como contato do buffet E da locadora de mesas, que
--   são duas organizações. Provado por psql, com as próprias RPCs e sem
--   contornar nada:
--
--     matricular_em_cadencia(buffet,  'voz_primeiro') → ok
--     matricular_em_cadencia(mesas,   'voz_primeiro') → ok
--     select contact_id, channel, status from cadence_touches …
--       → duas linhas 'pendente' para o MESMO contact_id
--
--   Resultado prático: a Heloísa recebe no Meu dia duas tarefas de ligação para
--   o mesmo telefone no mesmo dia. É exatamente o dano que a regra existe para
--   impedir, e é pior que a duplicata dentro de uma organização, porque quem
--   atende não faz ideia de que são "dois cadastros".
--
-- O QUE ESTA MIGRAÇÃO FAZ (o guardrail só pode ficar mais forte)
--   1. `cadence_touches_um_pendente_por_contato`: terceiro índice único
--      parcial, agora por `contact_id`. É a garantia; vale por psql, com a
--      chave que for.
--   2. `app.cadence_touches_guard` passa a recusar o toque pendente com
--      mensagem legível quando a MESMA PESSOA já tem um toque pendente em
--      qualquer outra organização, matrícula ou canal.
--   3. `app.abrir_proximo_toque` ganha a mesma checagem ANTES do insert e sai
--      com `{'acao':'nada','motivo':'toque_pendente_no_contato'}`. Sem isto o
--      motor estouraria a exceção do item 2 dentro do laço da régua e abortaria
--      a transação inteira do `cadencias_agendar` — um contato duplicado
--      derrubaria a fila do dia toda.
--   4. `app.cadencias_agendar` exclui do lote quem já tem toque pendente na
--      pessoa, pelo mesmo motivo.
--   5. `public.matricular_em_cadencia` devolve `toque_pendente_no_contato` como
--      recusa legível (quem chama é uma tela), do mesmo jeito que já devolvia
--      `toque_pendente` para a organização.
--   6. `app.tem_autorizacao_vigente` comparava a revogação com a autorização
--      por `>` estrito. Duas linhas de `consent_events` gravadas na MESMA
--      transação recebem o mesmo `occurred_at` (`now()` não anda dentro de uma
--      transação), e o empate valia como "ainda autorizado" — isto é, a
--      revogação simplesmente não contava. Agora é `>=`: no empate, o silêncio
--      ganha. É a única direção admissível num guardrail de LGPD.
--   7. Brinde do mesmo achado: `pre_registration_events` e
--      `pre_registration_acceptances` guardavam `organization_id` livre, sem
--      amarração com o rascunho. Uma prova de aceite arquivada sob a
--      organização errada some da RLS de quem deveria vê-la (e aparece para
--      quem não deveria). Agora um gatilho força a coluna a ser a do
--      `pre_registration_id`.
--
-- O que NÃO muda: nada é enviado, nenhuma tarefa nasce sozinha, nenhuma regra
-- afrouxa. Só se acrescenta recusa.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 1. A pergunta, em um lugar só
-- ---------------------------------------------------------------------------
create or replace function app.tem_toque_pendente(p_org uuid, p_contact uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cadence_touches t
     where t.status = 'pendente'::app.touch_status
       and (t.organization_id = p_org
            or (p_contact is not null and t.contact_id = p_contact)))
$$;
comment on function app.tem_toque_pendente(uuid, uuid) is
  'Já existe toque pendente para esta organização OU para esta PESSOA (em qualquer outra organização, matrícula e canal)? A pergunta que o motor, a régua e a RPC fazem antes de abrir trabalho novo.';


-- ---------------------------------------------------------------------------
-- 2. O terceiro índice: um pendente por PESSOA
-- ---------------------------------------------------------------------------
-- Se houver duplicata herdada (não há em nenhum ambiente hoje: a tabela nasceu
-- nesta leva), o índice falha ao criar e a migração para — que é o
-- comportamento certo: alguém tem de olhar antes de a regra valer.
create unique index if not exists cadence_touches_um_pendente_por_contato
  on public.cadence_touches (contact_id)
  where status = 'pendente' and contact_id is not null;


-- ---------------------------------------------------------------------------
-- 3. O gatilho-guarda, com a pessoa dentro
-- ---------------------------------------------------------------------------
create or replace function app.cadence_touches_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  e public.cadence_enrollments%rowtype;
begin
  select * into e from public.cadence_enrollments where id = new.enrollment_id;
  if not found then
    raise exception 'Matrícula % não existe.', new.enrollment_id using errcode = '23503';
  end if;
  if new.organization_id is distinct from e.organization_id then
    raise exception 'O toque tem de ser da mesma organização da matrícula.' using errcode = '23514';
  end if;

  if new.status = 'pendente'::app.touch_status then
    -- Guardrail: toque pendente nunca nasce para alvo suprimido.
    if app.is_suppressed_target(new.organization_id, new.contact_id) then
      raise exception 'Contato suprimido: nenhum toque pendente nasce para ele.' using errcode = '42501';
    end if;
    if e.status <> 'ativa'::app.cadence_status then
      raise exception 'Matrícula % não está ativa: não cria toque pendente.', e.id using errcode = '23514';
    end if;
    -- A regra dura, também em gatilho (mensagem legível; os índices únicos são
    -- a garantia). Vale ENTRE matrículas: um toque pendente por organização …
    if exists (select 1
                 from public.cadence_touches t
                where t.organization_id = new.organization_id
                  and t.status = 'pendente'::app.touch_status
                  and (tg_op = 'INSERT' or t.id <> new.id)) then
      raise exception 'Já existe toque pendente para esta organização. Um toque por vez, em qualquer canal.'
        using errcode = '23505';
    end if;
    -- … e um toque pendente por PESSOA, mesmo que as organizações sejam duas.
    -- A sócia do buffet que também é sócia da locadora é UMA pessoa, e recebe
    -- UMA ligação por vez.
    if new.contact_id is not null
       and exists (select 1
                     from public.cadence_touches t
                    where t.contact_id = new.contact_id
                      and t.status = 'pendente'::app.touch_status
                      and (tg_op = 'INSERT' or t.id <> new.id)) then
      raise exception 'Já existe toque pendente para esta PESSOA em outra organização. Um toque por vez, em qualquer canal.'
        using errcode = '23505';
    end if;
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------------
-- 4. O motor pergunta pela pessoa, não só pela organização
-- ---------------------------------------------------------------------------
-- Cópia fiel de 20260904001700 §C.6, com UMA mudança: as duas checagens de
-- "já tem toque pendente" viram `app.tem_toque_pendente(org, contato)`.
create or replace function app.abrir_proximo_toque(p_enrollment uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e         public.cadence_enrollments%rowtype;
  c         public.cadences%rowtype;
  s         public.cadence_steps%rowtype;
  v_pos     smallint;
  v_base    timestamptz;
  v_due     timestamptz;
  v_cond    jsonb;
  v_p       jsonb;
  v_task    uuid;
  v_touch   uuid;
  v_dono    uuid;
  v_deal    public.deals%rowtype;
begin
  select * into e from public.cadence_enrollments where id = p_enrollment for update;
  if not found or e.status <> 'ativa'::app.cadence_status then
    return jsonb_build_object('acao', 'nada', 'motivo', 'matricula_inativa');
  end if;
  select * into c from public.cadences where id = e.cadence_id;

  -- Um toque pendente já é o trabalho desta matrícula. Nada nasce por cima.
  if exists (select 1 from public.cadence_touches t
              where t.enrollment_id = e.id and t.status = 'pendente'::app.touch_status) then
    return jsonb_build_object('acao', 'nada', 'motivo', 'toque_pendente');
  end if;
  -- Nem por cima de toque pendente de OUTRA matrícula da mesma organização.
  if exists (select 1 from public.cadence_touches t
              where t.organization_id = e.organization_id
                and t.status = 'pendente'::app.touch_status) then
    return jsonb_build_object('acao', 'nada', 'motivo', 'toque_pendente_na_organizacao');
  end if;
  -- Nem por cima de toque pendente da mesma PESSOA em outra organização.
  if e.contact_id is not null
     and exists (select 1 from public.cadence_touches t
                  where t.contact_id = e.contact_id
                    and t.status = 'pendente'::app.touch_status) then
    return jsonb_build_object('acao', 'nada', 'motivo', 'toque_pendente_no_contato');
  end if;

  -- Silêncio: passou o limite da cadência → encerra e move, SEM mandar nada.
  if now() > e.enrolled_at + make_interval(days => c.limite_dias) then
    perform app.encerrar_por_silencio(e.id);
    return jsonb_build_object('acao', 'encerrada', 'motivo', 'silencio');
  end if;

  v_pos := e.current_position;
  -- Até 12 voltas: cada uma ou pula um passo que não bate, ou decide e sai.
  for i in 1..12 loop
    v_pos := (v_pos + 1)::smallint;
    select * into s from public.cadence_steps
     where cadence_id = e.cadence_id and "position" = v_pos;
    if not found then
      perform app.encerrar_matricula(e.id, 'fim_da_cadencia', 'concluida'::app.cadence_status);
      return jsonb_build_object('acao', 'concluida', 'motivo', 'fim_da_cadencia');
    end if;
    if v_pos > c.max_touches then
      perform app.encerrar_matricula(e.id, 'max_toques', 'concluida'::app.cadence_status);
      return jsonb_build_object('acao', 'concluida', 'motivo', 'max_toques');
    end if;

    -- Quando o toque vence.
    v_base := case s.delay_from
                when 'matricula' then e.enrolled_at
                when 'data_combinada' then coalesce(
                  (select d.next_action_at from public.deals d
                    where d.id = e.deal_id
                       or (e.deal_id is null and d.organization_id = e.organization_id
                           and d.status = 'open')
                    order by d.created_at limit 1),
                  e.enrolled_at)
                else coalesce(
                  (select coalesce(t.done_at, t.due_at) from public.cadence_touches t
                    where t.enrollment_id = e.id and t.status <> 'cancelado'::app.touch_status
                    order by t."position" desc limit 1),
                  e.enrolled_at)
              end;
    v_due := v_base + make_interval(days => s.delay_days);

    if v_due > now() then
      update public.cadence_enrollments set next_due_at = v_due where id = e.id;
      return jsonb_build_object('acao', 'agendado', 'quando', v_due, 'passo', v_pos);
    end if;

    -- Condição e tiers: não bate → PULA (o toque fica registrado como pulado) e
    -- a cadência avança na mesma volta.
    v_cond := app.condicao_do_passo(s.id, e.id);
    if not (v_cond ->> 'bate')::boolean then
      insert into public.cadence_touches
        (enrollment_id, step_id, organization_id, contact_id, channel, "position",
         status, due_at, done_at, skip_reason)
      values (e.id, s.id, e.organization_id, e.contact_id, s.channel, v_pos,
              'pulado'::app.touch_status, v_due, now(),
              'condicao:' || coalesce(v_cond ->> 'motivo', 'nao_bate'));
      update public.cadence_enrollments set current_position = v_pos where id = e.id;
      continue;
    end if;

    -- A porteira.
    v_p := app.pode_tocar(e.organization_id, e.contact_id, s.channel, greatest(v_due, now()));
    if not (v_p ->> 'pode')::boolean then
      if (v_p ->> 'motivo') in ('suprimido', 'nao_reativavel') then
        perform app.encerrar_matricula(e.id, v_p ->> 'motivo');
        return jsonb_build_object('acao', 'encerrada', 'motivo', v_p ->> 'motivo');
      end if;
      if (v_p ->> 'quando') is null then
        perform app.encerrar_matricula(e.id, 'sem_janela:' || coalesce(v_p ->> 'motivo', '?'));
        return jsonb_build_object('acao', 'encerrada', 'motivo', 'sem_janela');
      end if;
      update public.cadence_enrollments
         set next_due_at = (v_p ->> 'quando')::timestamptz
       where id = e.id;
      return jsonb_build_object('acao', 'adiado', 'quando', (v_p ->> 'quando')::timestamptz,
                                'motivo', v_p ->> 'motivo', 'passo', v_pos);
    end if;

    -- Passou. Nasce UMA tarefa (é o trabalho de gente) e UM toque (é o registro
    -- do compromisso). Nada é enviado aqui.
    select d.* into v_deal from public.deals d
     where d.id = e.deal_id
        or (e.deal_id is null and d.organization_id = e.organization_id and d.status = 'open')
     order by d.created_at limit 1;
    v_dono := coalesce(e.assignee_id, v_deal.owner_id,
                       (select o.owner_id from public.organizations o where o.id = e.organization_id));

    insert into public.tasks (title, kind, due_at, assignee_id, organization_id,
                              deal_id, contact_id, origin, priority)
    values (left(s.title, 200), s.task_kind, (v_p ->> 'quando')::timestamptz, v_dono,
            e.organization_id, v_deal.id, e.contact_id, 'cadence',
            case when s.channel = 'phone'::app.channel then 1 else 2 end)
    returning id into v_task;

    insert into public.cadence_touches
      (enrollment_id, step_id, organization_id, contact_id, channel, "position",
       task_id, status, due_at)
    values (e.id, s.id, e.organization_id, e.contact_id, s.channel, v_pos,
            v_task, 'pendente'::app.touch_status, (v_p ->> 'quando')::timestamptz)
    returning id into v_touch;

    update public.cadence_enrollments
       set current_position = v_pos, next_due_at = null
     where id = e.id;

    return jsonb_build_object('acao', 'toque_criado', 'toque', v_touch, 'task_id', v_task,
                              'passo', v_pos, 'canal', s.channel::text,
                              'quando', (v_p ->> 'quando')::timestamptz);
  end loop;

  perform app.encerrar_matricula(e.id, 'passos_esgotados', 'concluida'::app.cadence_status);
  return jsonb_build_object('acao', 'concluida', 'motivo', 'passos_esgotados');
end $$;
comment on function app.abrir_proximo_toque(uuid) is
  'O motor da cadência: abre o PRÓXIMO toque de uma matrícula. Nunca envia nada, nunca cria dois e nunca cria um enquanto houver outro pendente — na matrícula, na organização ou na PESSOA.';


-- ---------------------------------------------------------------------------
-- 5. A régua também pergunta pela pessoa
-- ---------------------------------------------------------------------------
create or replace function app.cadencias_agendar()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  n int := 0;
begin
  -- Domingo e feriado: não roda. A porteira já adiaria tudo, mas não custa
  -- nada dizer no lugar certo que o dia não é de operação.
  if not app.dia_util_de_operacao() then
    return 0;
  end if;
  for e in
    select en.id
      from public.cadence_enrollments en
     where en.status = 'ativa'::app.cadence_status
       and coalesce(en.next_due_at, en.enrolled_at) <= now()
       and not app.tem_toque_pendente(en.organization_id, en.contact_id)
     order by coalesce(en.next_due_at, en.enrolled_at)
     limit 500
  loop
    perform app.abrir_proximo_toque(e.id);
    n := n + 1;
  end loop;
  return n;
end $$;
comment on function app.cadencias_agendar() is
  'Régua de silêncio, parte 1: pergunta ao motor se cada matrícula ativa já pode dar o próximo passo. Não envia nada. Não roda em domingo nem feriado. Pula quem já tem toque pendente na organização ou na pessoa.';


-- ---------------------------------------------------------------------------
-- 6. A RPC recusa legível
-- ---------------------------------------------------------------------------
create or replace function public.matricular_em_cadencia(p_organization_id uuid,
                                                         p_cadence_slug text,
                                                         p_gancho text default null,
                                                         p_deal_id uuid default null,
                                                         p_assignee_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_papel   app.user_role := app.role();
  c         public.cadences%rowtype;
  v_deal    public.deals%rowtype;
  v_contato uuid;
  v_enr     uuid;
  v_res     jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if v_papel not in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into c from public.cadences where slug = p_cadence_slug and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'cadencia_inexistente');
  end if;
  if not exists (select 1 from public.organizations o
                  where o.id = p_organization_id and o.deleted_at is null) then
    return jsonb_build_object('ok', false, 'motivo', 'organizacao_inexistente');
  end if;
  if not app.org_is_visible(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- Os guardrails devolvem recusa legível em vez de estourar exceção, porque
  -- quem chama é uma tela. O gatilho continua sendo a garantia.
  if app.is_suppressed_target(p_organization_id, null) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido');
  end if;
  if c.requires_gancho and length(trim(coalesce(p_gancho, ''))) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'gancho_obrigatorio');
  end if;
  if c.requires_authorization and not app.tem_autorizacao_vigente(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_autorizacao');
  end if;
  if exists (select 1 from public.cadence_enrollments e
              where e.organization_id = p_organization_id
                and e.status = 'ativa'::app.cadence_status) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_cadencia_ativa');
  end if;
  if exists (select 1 from public.cadence_touches t
              where t.organization_id = p_organization_id
                and t.status = 'pendente'::app.touch_status) then
    return jsonb_build_object('ok', false, 'motivo', 'toque_pendente');
  end if;

  select d.* into v_deal from public.deals d
   where d.id = p_deal_id
      or (p_deal_id is null and d.organization_id = p_organization_id and d.status = 'open')
   order by d.created_at limit 1;
  v_contato := v_deal.primary_contact_id;

  -- A mesma PESSOA, em outra organização, já com toque pendente: recusa
  -- legível em vez de deixar o gatilho estourar.
  if v_contato is not null
     and exists (select 1 from public.cadence_touches t
                  where t.contact_id = v_contato
                    and t.status = 'pendente'::app.touch_status) then
    return jsonb_build_object('ok', false, 'motivo', 'toque_pendente_no_contato');
  end if;
  if app.is_suppressed_target(p_organization_id, v_contato) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido');
  end if;

  insert into public.cadence_enrollments
    (cadence_id, organization_id, deal_id, contact_id, assignee_id, gancho,
     next_due_at, created_by)
  values (c.id, p_organization_id, v_deal.id, v_contato,
          coalesce(p_assignee_id, v_deal.owner_id, v_uid),
          nullif(trim(coalesce(p_gancho, '')), ''), now(), v_uid)
  returning id into v_enr;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, v_papel::text, 'MATRICULAR', 'cadence_enrollments', v_enr::text,
          jsonb_build_object('cadencia', c.slug, 'organizacao', p_organization_id,
                             'gancho', p_gancho));

  v_res := app.abrir_proximo_toque(v_enr);
  return jsonb_build_object('ok', true, 'enrollment_id', v_enr, 'cadencia', c.slug,
                            'primeiro_toque', v_res);
end $$;
comment on function public.matricular_em_cadencia(uuid, text, text, uuid, uuid) is
  'Matricula uma organização numa cadência. Recusa alvo suprimido, reativação sem gancho, onboarding sem autorização registrada e pessoa que já tem toque pendente em outra organização. Auditada.';


-- ---------------------------------------------------------------------------
-- 7. No empate de carimbo, a revogação ganha
-- ---------------------------------------------------------------------------
-- `now()` não anda dentro de uma transação: duas linhas de `consent_events`
-- gravadas juntas saem com o mesmo `occurred_at`. Com `>` estrito, a revogação
-- gravada no mesmo instante da autorização não contava e a organização seguia
-- "autorizada" — abrindo link de reivindicação e cadência de onboarding para
-- quem acabou de dizer não. `>=` fecha isso, e erra para o lado certo.
create or replace function app.tem_autorizacao_vigente(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.consent_events e
     where e.organization_id = p_organization_id
       and e.kind = 'data_use_authorized'::app.consent_kind
       and not exists (
         select 1 from public.consent_events r
          where r.organization_id = p_organization_id
            and r.kind in ('data_use_revoked'::app.consent_kind,
                           'erasure_request'::app.consent_kind,
                           'erasure_done'::app.consent_kind)
            and r.occurred_at >= e.occurred_at))
$$;
comment on function app.tem_autorizacao_vigente(uuid) is
  'Autorização de uso de dados registrada e não revogada depois (RF-PRE-06). No empate de carimbo, vale a revogação. Pré-requisito do pré-cadastro e da cadência de onboarding.';


-- ---------------------------------------------------------------------------
-- 8. A prova fica arquivada sob a organização certa
-- ---------------------------------------------------------------------------
-- `pre_registration_events.organization_id` e
-- `pre_registration_acceptances.organization_id` mandam na RLS
-- (`app.org_is_visible`). Se a coluna puder divergir do rascunho, a prova de um
-- aceite some da carteira de quem deveria vê-la — e aparece na de quem não
-- deveria. Não é opinião de quem escreve: é a coluna que a política lê.
create or replace function app.pre_registration_filho_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select p.organization_id into v_org
    from public.pre_registrations p where p.id = new.pre_registration_id;
  if not found then
    raise exception 'Pré-cadastro % não existe.', new.pre_registration_id using errcode = '23503';
  end if;
  if new.organization_id is distinct from v_org then
    raise exception 'A organização (%) não é a do pré-cadastro (%). A prova é arquivada onde a RLS a procura.',
      new.organization_id, v_org using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists pre_registration_events_org on public.pre_registration_events;
create trigger pre_registration_events_org
  before insert on public.pre_registration_events
  for each row execute function app.pre_registration_filho_org();

drop trigger if exists pre_registration_acceptances_org on public.pre_registration_acceptances;
create trigger pre_registration_acceptances_org
  before insert on public.pre_registration_acceptances
  for each row execute function app.pre_registration_filho_org();


-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
revoke all on function app.pre_registration_filho_org()    from public, anon, authenticated;
revoke all on function app.tem_toque_pendente(uuid, uuid)  from public, anon;
grant execute on function app.tem_toque_pendente(uuid, uuid) to authenticated, service_role;

-- =====================================================================
-- Marcar para si, ou para quem se acompanha (RF-AGE-01, RF-AGE-05)
--
-- O QUE MUDA
--   Até aqui a reunião marcada por uma PESSOA seguia a regra do robô: o dono
--   era sempre `deals.owner_id`. O gestor que marcava uma reunião num parceiro
--   da carteira da SDR a mandava para a agenda da SDR, e não tinha como marcar
--   para si mesmo. A regra passa a ser:
--
--   · o compromisso nasce na agenda de QUEM MARCA;
--   · gestor e admin podem escolher, de propósito, alguém que ACOMPANHAM
--     (`app.acompanha`, espelho de `apps/web/src/lib/auth/hierarquia.ts`):
--     o admin acompanha gestor, SDR e embaixador; o gestor, SDR e embaixador;
--   · o banco confere se a pessoa está livre no horário. Reunião, pela MESMA
--     grade de sempre (`app.reuniao_horarios_livres`: outras reuniões, rota,
--     tarefas de campo, teto do dia). Visita, pela nova `public.visita_marcar`,
--     que recusa sobreposição com reunião viva ou com outra tarefa de campo;
--   · quem recebe um compromisso marcado por outra pessoa é avisada:
--     `public.agenda_avisos`, que a Agenda e o Meu dia mostram até ela dizer
--     que viu. A reunião continua mandando, além disso, o e-mail de sempre para
--     o dono (RF-AGE-05) — nada muda no worker que envia.
--
-- O QUE NÃO MUDA — O ROBÔ
--   `app.reuniao_gravar` ganha uma irmã de 9 argumentos (`p_dono`), que passa
--   a ter o corpo. A de 8 argumentos, a única que `public.reuniao_marcar` (o
--   robô) chama, vira uma linha que repassa com `p_dono = null` — e com `null`
--   o `coalesce` cai exatamente na regra antiga. O corpo é o de 20260930110000,
--   copiado sem outra alteração. `tests/94_marcar_para_a_equipe.sql` prova que
--   a reunião do robô continua caindo no dono do negócio, e que nenhuma ação
--   nova gera mensagem de WhatsApp.
--
-- O QUE MUDA DE CARONA — O REMARCAR
--   `public.reuniao_remarcar` passa a manter `r.dono_id` enquanto essa pessoa
--   estiver ativa (inativa: volta ao dono do negócio, como antes). Antes ele
--   recalculava o dono pelo negócio: a reunião que o gestor marcou para si iria
--   para a agenda do dono do negócio na primeira remarcação. E quando quem
--   remarca não é o dono, o dono ganha aviso da nova hora.
--
-- `public.reuniao_marcar_pelo_negocio` fica como está (dono = dono do
-- negócio): nenhuma tela a chama mais, mas apagar porta é outra conversa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. QUEM ACOMPANHA QUEM
-- ---------------------------------------------------------------------
create or replace function app.acompanha(p_alvo uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_alvo and p.is_active and p.id <> auth.uid()
       and (
         (app.role() = 'admin'::app.user_role
            and p.role in ('gestor'::app.user_role, 'sdr'::app.user_role, 'embaixador'::app.user_role))
         or
         (app.role() = 'gestor'::app.user_role
            and p.role in ('sdr'::app.user_role, 'embaixador'::app.user_role))
       ))
$$;

-- A agenda em que QUEM ESTÁ LOGADO pode pôr um compromisso: a própria, ou a de
-- quem ela acompanha.
create or replace function app.pode_marcar_para(p_alvo uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and app.can_write()
     and (p_alvo = auth.uid() or app.acompanha(p_alvo))
$$;

revoke all on function app.acompanha(uuid)        from public, anon;
revoke all on function app.pode_marcar_para(uuid) from public, anon;
grant execute on function app.acompanha(uuid)        to authenticated, service_role;
grant execute on function app.pode_marcar_para(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- B. O AVISO DE QUEM RECEBEU
-- ---------------------------------------------------------------------
create table if not exists public.agenda_avisos (
  id           uuid primary key default gen_random_uuid(),
  -- Quem recebeu o compromisso: é a ela que o aviso aparece.
  dono_id      uuid not null references public.profiles (id) on delete cascade,
  -- Quem marcou. `restrict` pela mesma razão de `reunioes.dono_id`: desligar
  -- gente é `is_active = false`, não `delete`.
  marcado_por  uuid not null references public.profiles (id) on delete restrict,
  tipo         text not null check (tipo in ('reuniao', 'visita')),
  task_id      uuid references public.tasks (id) on delete cascade,
  reuniao_id   uuid references public.reunioes (id) on delete cascade,
  -- Copiados na hora: o aviso diz o que foi marcado, mesmo que a tarefa mude
  -- ou que a RLS de quem lê não enxergue a ficha.
  titulo       text not null,
  quando       timestamptz not null,
  criado_em    timestamptz not null default now(),
  visto_em     timestamptz,
  constraint agenda_avisos_outra_pessoa_chk check (dono_id <> marcado_por),
  constraint agenda_avisos_alvo_chk check (task_id is not null or reuniao_id is not null)
);

create index if not exists agenda_avisos_dono_nao_vistos_idx
  on public.agenda_avisos (dono_id, criado_em desc) where visto_em is null;

alter table public.agenda_avisos enable row level security;

-- Quem recebeu lê os seus; quem marcou lê os que mandou (é como sabe que a
-- outra pessoa já viu). Nenhum papel escreve direto: nasce pelas funções de
-- marcar, e o "vi" é `public.agenda_avisos_vistos`.
drop policy if exists agenda_avisos_select on public.agenda_avisos;
create policy agenda_avisos_select on public.agenda_avisos
  for select to authenticated
  using (dono_id = (select auth.uid()) or marcado_por = (select auth.uid()));

grant select on public.agenda_avisos to authenticated;
revoke insert, update, delete on public.agenda_avisos from authenticated, anon;
grant select, insert, update, delete on public.agenda_avisos to service_role;

create or replace function public.agenda_avisos_vistos(p_ids uuid[] default null)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  if auth.uid() is null then return 0; end if;
  update public.agenda_avisos
     set visto_em = now()
   where dono_id = auth.uid() and visto_em is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.agenda_avisos_vistos(uuid[]) from public, anon, service_role;
grant execute on function public.agenda_avisos_vistos(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- C. A GRAVAÇÃO COM DONO ESCOLHIDO
-- ---------------------------------------------------------------------
create or replace function app.reuniao_gravar(
  p_conversation_id uuid, p_deal_id uuid, p_inicio timestamptz,
  p_formato text, p_local text, p_observacao text,
  p_por text, p_por_id uuid, p_dono uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c        jsonb := app.reuniao_config();
  v_dur    int   := coalesce((c ->> 'duracao_min')::int, 40);
  v_conv   public.conversations%rowtype;
  v_deal   public.deals%rowtype;
  v_org    uuid;  v_dono uuid;  v_contato uuid;  v_nome text;
  v_fim    timestamptz := p_inicio + make_interval(mins => v_dur);
  v_dia    date;  v_sala text;  v_estado text;
  v_id     uuid;  v_task uuid;  v_etapa int;  v_pos int;  v_titulo text;
begin
  if p_formato not in ('online','presencial') then
    return jsonb_build_object('ok', false, 'motivo', 'formato_invalido');
  end if;

  if p_conversation_id is not null then
    select * into v_conv from public.conversations where id = p_conversation_id;
    if v_conv.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_existe'); end if;
    -- `conversations.organization_id` é NULÁVEL e "conversa fora da base" é
    -- estado real e comum (tem migração própria e aba própria na tela).
    if v_conv.organization_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'sem_ficha'); end if;
    v_org := v_conv.organization_id;  v_contato := v_conv.contact_id;
    if v_conv.deal_id is not null then
      select * into v_deal from public.deals where id = v_conv.deal_id; end if;
  elsif p_deal_id is not null then
    select * into v_deal from public.deals where id = p_deal_id;
    if v_deal.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'negocio_nao_existe'); end if;
    v_org := v_deal.organization_id;
  else
    return jsonb_build_object('ok', false, 'motivo', 'sem_alvo');
  end if;

  -- Guardrail antes de tudo: marcar reunião para quem acabou de pedir para
  -- sair é pior do que responder.
  --
  -- E o árbitro é `app.is_suppressed_target`, o MESMO que `app.pode_tocar` usa
  -- na ordem 1 — não um `organizations.do_not_contact` escrito de novo aqui.
  -- Ler só aquela coluna deixava de fora os outros dois caminhos do opt-out: o
  -- contato que pediu para sair (`contacts.do_not_contact`) e o telefone que
  -- caiu na `suppression_list` pela regra de palavras. Nesses dois a reunião
  -- não chegava a existir — o gatilho `app.tasks_guard_suppressed` derrubava a
  -- transação na `tasks`-eco —, mas derrubava LEVANTANDO EXCEÇÃO: o robô
  -- recebia um 500 do PostgREST em vez de `motivo = 'suprimido'`, e a tela
  -- dizia "não deu para falar com o servidor" a quem pediu para sair. Uma
  -- regra, um lugar (ADR-03), e a recusa na língua que quem chama entende.
  if app.is_suppressed_target(v_org, v_contato) then
    return jsonb_build_object('ok', false, 'motivo', 'suprimido');
  end if;

  -- `p_dono` quando QUEM MARCA escolheu a agenda (a tela: a própria pessoa, ou
  -- alguém que ela acompanha — quem confere é `public.reuniao_marcar_na_agenda`).
  -- Sem ele, como sempre: `deals.owner_id` quando há negócio; senão
  -- `conversations.assignee_id`, que é NOT NULL. O robô chega aqui SEMPRE sem
  -- `p_dono` (pela versão de 8 argumentos): ele NÃO procura horário na agenda de
  -- outra pessoa — trocar de dono em silêncio para achar vaga é o jeito de a
  -- carteira virar rodízio.
  v_dono := coalesce(p_dono, v_deal.owner_id, v_conv.assignee_id);
  if v_dono is null then return jsonb_build_object('ok', false, 'motivo', 'sem_dono'); end if;

  if p_formato = 'online' then
    select p.sala_url into v_sala from public.profiles p where p.id = v_dono;
    v_sala := coalesce(nullif(btrim(coalesce(v_sala, '')), ''),
                       nullif(btrim(coalesce(c ->> 'sala_padrao', '')), ''));
    if v_sala is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sala'); end if;
  elsif nullif(btrim(coalesce(p_local, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_lugar');
  end if;

  -- Serializa por (pessoa, dia). Isto protege as regras MOLES — o teto de 4,
  -- a rota, os feriados: dois `select` concorrentes passariam os dois pelo
  -- teto. Com o lock, o segundo espera e vê o primeiro.
  v_dia := (p_inicio at time zone 'America/Fortaleza')::date;
  perform pg_advisory_xact_lock(hashtextextended(v_dono::text || v_dia::text, 0));

  -- Entre a oferta e o aceite o parceiro demora — às vezes horas.
  if not exists (select 1 from app.reuniao_horarios_livres(v_dono, v_dia, v_dia, 50) h
                  where h.inicio = p_inicio) then
    return jsonb_build_object('ok', false, 'motivo', 'horario_indisponivel',
             'alternativas', app.reuniao_opcoes(v_dono, 3));
  end if;

  v_estado := case when p_por = 'robo' and app.reuniao_rampa_ativa()
                   then 'a_confirmar' else 'marcada' end;
  select o.name into v_nome from public.organizations o where o.id = v_org;
  v_titulo := 'Reunião com ' || coalesce(v_nome, 'parceiro');

  -- A TRAVA DURA. 23P01 = exclusion_violation. Ela é o último recurso: o
  -- caminho normal já foi barrado acima. Quem chega aqui é outra transação
  -- que comitou entre o advisory lock e o insert — cenário de dois workers.
  begin
    insert into public.reunioes (organization_id, deal_id, conversation_id, contact_id,
                                 dono_id, titulo, formato, inicio, fim, link, local,
                                 estado, marcada_por, marcada_por_id, observacao)
    values (v_org, v_deal.id, p_conversation_id, v_contato, v_dono, v_titulo, p_formato,
            p_inicio, v_fim,
            case when p_formato = 'online'     then v_sala end,
            case when p_formato = 'presencial' then btrim(p_local) end,
            v_estado, p_por, p_por_id, nullif(btrim(coalesce(p_observacao, '')), ''))
    returning id into v_id;
  exception when exclusion_violation then
    -- As alternativas vêm no MESMO retorno: o robô responde "esse acabou de
    -- ser ocupado — consigo às 11h10 ou às 14h30", sem segunda ida ao banco e
    -- sem o modelo inventar a recuperação.
    return jsonb_build_object('ok', false, 'motivo', 'horario_tomado',
             'alternativas', app.reuniao_opcoes(v_dono, 3));
  end;

  insert into public.tasks (title, kind, status, priority, due_at, assignee_id,
                            organization_id, deal_id, contact_id, origin)
  values (v_titulo, 'meeting'::app.task_kind, 'todo'::app.task_status, 2, p_inicio,
          v_dono, v_org, v_deal.id, v_contato,
          case when p_por = 'robo' then 'ai' else 'manual' end)
  returning id into v_task;
  update public.reunioes set task_id = v_task, atualizada_em = now() where id = v_id;

  -- Conversa sem negócio PULA este passo, em vez de falhar.
  if v_deal.id is not null then
    select st0.position into v_pos from public.stages st0 where st0.id = v_deal.stage_id;
    select st.id into v_etapa from public.stages st
     where st.pipeline_id = v_deal.pipeline_id
       and st.position > coalesce(v_pos, -1)
       and exists (select 1 from jsonb_array_elements(coalesce(st.required_fields,'[]'::jsonb)) e
                    where e.value ->> 'field' = 'meeting_at')
     order by st.position limit 1;
    if v_etapa is not null then
      update public.deals
         set stage_id = v_etapa, next_action_at = p_inicio,
             stage_change_reason = 'Reunião marcada'
       where id = v_deal.id;
    else
      -- Já está na etapa de reunião, ou além dela. A etapa não muda; a
      -- próxima ação, sim — é esta reunião.
      update public.deals set next_action_at = p_inicio where id = v_deal.id;
    end if;
  end if;

  -- O aviso, NA MESMA TRANSAÇÃO: é o que garante que não existe reunião
  -- marcada sem aviso pendente. A fila nasceu na seção B deste arquivo,
  -- antes desta função, porque `app.esteira_enfileirar` levanta exceção em
  -- fila que não está no catálogo — e a exceção derrubaria a transação
  -- inteira de quem marcou.
  perform app.esteira_enfileirar('reuniao_avisos',
            jsonb_build_object('reuniao_id', v_id, 'motivo', 'marcada',
                               'chave', 'reuniao:' || v_id::text || ':marcada'),
            'reuniao:' || v_id::text || ':marcada');

  return jsonb_build_object(
    'ok', true, 'reuniao_id', v_id, 'inicio', p_inicio, 'fim', v_fim,
    'estado', v_estado, 'precisa_confirmacao', v_estado = 'a_confirmar',
    'formato', p_formato,
    'link',  case when p_formato = 'online'     then v_sala end,
    'local', case when p_formato = 'presencial' then btrim(p_local) end,
    'quando_por_extenso', app.reuniao_por_extenso(p_inicio));
end $$;
revoke all on function app.reuniao_gravar(uuid,uuid,timestamptz,text,text,text,text,uuid,uuid)
  from public, anon, authenticated;
grant execute on function app.reuniao_gravar(uuid,uuid,timestamptz,text,text,text,text,uuid,uuid)
  to service_role;

-- A de 8 argumentos, a do robô: só repassa, sem dono escolhido. Mesmos grants
-- de antes (o `create or replace` os mantém).
create or replace function app.reuniao_gravar(
  p_conversation_id uuid, p_deal_id uuid, p_inicio timestamptz,
  p_formato text, p_local text, p_observacao text,
  p_por text, p_por_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select app.reuniao_gravar(p_conversation_id, p_deal_id, p_inicio, p_formato, p_local,
                            p_observacao, p_por, p_por_id, null::uuid)
$$;

-- ---------------------------------------------------------------------
-- D. AS PORTAS DA TELA
-- ---------------------------------------------------------------------
create or replace function public.reuniao_marcar_na_agenda(
  p_deal_id uuid, p_inicio timestamptz, p_formato text default 'online',
  p_local text default null, p_observacao text default null, p_dono uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_dono uuid; v_r jsonb;
begin
  if auth.uid() is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  v_dono := coalesce(p_dono, auth.uid());
  if not app.pode_marcar_para(v_dono) then
    return jsonb_build_object('ok', false, 'motivo', 'nao_acompanha'); end if;
  select d.organization_id into v_org from public.deals d where d.id = p_deal_id;
  if v_org is null or not app.org_is_visible(v_org) then
    return jsonb_build_object('ok', false, 'motivo', 'negocio_invisivel'); end if;

  v_r := app.reuniao_gravar(null, p_deal_id, p_inicio, p_formato, p_local, p_observacao,
                            'pessoa', auth.uid(), v_dono);

  if coalesce((v_r ->> 'ok')::boolean, false) and v_dono <> auth.uid() then
    insert into public.agenda_avisos (dono_id, marcado_por, tipo, task_id, reuniao_id, titulo, quando)
    select v_dono, auth.uid(), 'reuniao', r.task_id, r.id, r.titulo, r.inicio
      from public.reunioes r where r.id = (v_r ->> 'reuniao_id')::uuid;
  end if;
  return v_r || jsonb_build_object('dono_id', v_dono);
end $$;

revoke all on function public.reuniao_marcar_na_agenda(uuid, timestamptz, text, text, text, uuid)
  from public, anon, service_role;
grant execute on function public.reuniao_marcar_na_agenda(uuid, timestamptz, text, text, text, uuid)
  to authenticated;

-- Visita: não é reunião (sem sala, sem trava GiST, sem e-mail), mas também não
-- pode cair em cima de outro compromisso de quem vai, nem em sábado, domingo ou
-- feriado. Ocupa
-- `agenda.reunioes.duracao_visita_min` (padrão 45) a partir da hora marcada.
-- Serializa pelo MESMO advisory lock de (pessoa, dia) de `app.reuniao_gravar`:
-- uma reunião e uma visita marcadas ao mesmo tempo não passam as duas.
create or replace function public.visita_marcar(
  p_organization_id uuid, p_inicio timestamptz,
  p_deal_id uuid default null, p_dono uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_dono uuid; v_dur int; v_fim timestamptz; v_dia date; v_nome text;
  v_conflitos jsonb; v_task uuid; v_titulo text;
begin
  if auth.uid() is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  v_dono := coalesce(p_dono, auth.uid());
  if not app.pode_marcar_para(v_dono) then
    return jsonb_build_object('ok', false, 'motivo', 'nao_acompanha'); end if;
  if not app.org_is_visible(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'negocio_invisivel'); end if;
  if p_deal_id is not null and not exists (
       select 1 from public.deals d
        where d.id = p_deal_id and d.organization_id = p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'negocio_nao_existe'); end if;
  if app.is_suppressed_target(p_organization_id, null) then
    return jsonb_build_object('ok', false, 'motivo', 'suprimido'); end if;
  if p_inicio < now() then
    return jsonb_build_object('ok', false, 'motivo', 'no_passado'); end if;

  -- Sábado, domingo e feriado: nunca (decisão do usuário, 30/09/2026). O árbitro
  -- é `app.eh_dia_util`, o MESMO que a grade da reunião usa — não uma lista de
  -- dias escrita de novo aqui.
  v_dia := (p_inicio at time zone 'America/Fortaleza')::date;
  if not app.eh_dia_util(v_dia) then
    return jsonb_build_object('ok', false, 'motivo', 'dia_nao_util'); end if;

  v_dur := coalesce((app.reuniao_config() ->> 'duracao_visita_min')::int, 45);
  v_fim := p_inicio + make_interval(mins => v_dur);
  perform pg_advisory_xact_lock(hashtextextended(v_dono::text || v_dia::text, 0));

  select coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'titulo', x.titulo,
                                               'inicio', x.inicio) order by x.inicio), '[]'::jsonb)
    into v_conflitos
    from (
      select 'reuniao' as tipo, r.titulo, r.inicio
        from public.reunioes r
       where r.dono_id = v_dono
         and r.estado in ('a_confirmar', 'marcada', 'confirmada')
         and r.durante && tstzrange(p_inicio, v_fim, '[)')
      union all
      -- Tarefa de campo aberta que não é o eco de uma reunião viva (essa já
      -- entrou acima, com o fim de verdade).
      select case when t.kind = 'visit' then 'visita' else 'reuniao' end, t.title, t.due_at
        from public.tasks t
       where t.assignee_id = v_dono
         and t.kind in ('meeting'::app.task_kind, 'visit'::app.task_kind)
         and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
         and t.due_at > p_inicio - make_interval(mins => v_dur)
         and t.due_at < v_fim
         and not exists (select 1 from public.reunioes r2
                          where r2.task_id = t.id
                            and r2.estado in ('a_confirmar', 'marcada', 'confirmada'))
    ) x;

  if jsonb_array_length(v_conflitos) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'horario_ocupado', 'conflitos', v_conflitos);
  end if;

  select o.name into v_nome from public.organizations o where o.id = p_organization_id;
  v_titulo := 'Visita: ' || coalesce(v_nome, 'parceiro');
  insert into public.tasks (title, kind, status, priority, due_at, assignee_id, created_by,
                            organization_id, deal_id, origin)
  values (v_titulo, 'visit'::app.task_kind, 'todo'::app.task_status, 2, p_inicio, v_dono,
          auth.uid(), p_organization_id, p_deal_id, 'manual')
  returning id into v_task;

  if v_dono <> auth.uid() then
    insert into public.agenda_avisos (dono_id, marcado_por, tipo, task_id, titulo, quando)
    values (v_dono, auth.uid(), 'visita', v_task, v_titulo, p_inicio);
  end if;

  return jsonb_build_object('ok', true, 'task_id', v_task, 'dono_id', v_dono,
                            'inicio', p_inicio, 'fim', v_fim);
end $$;

revoke all on function public.visita_marcar(uuid, timestamptz, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.visita_marcar(uuid, timestamptz, uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- E. O REMARCAR MANTÉM A AGENDA
-- ---------------------------------------------------------------------
create or replace function public.reuniao_remarcar(p_id uuid, p_novo_inicio timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.reunioes%rowtype; v_nova jsonb; v_motivo text;
begin
  select * into r from public.reunioes where id = p_id;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'nao_existe'); end if;
  if not app.reuniao_pode_mexer(r) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  if r.estado not in ('a_confirmar','marcada','confirmada') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_invalido', 'estado', r.estado); end if;
  begin
    update public.reunioes set estado = 'remarcada', atualizada_em = now() where id = p_id;
    update public.tasks set status = 'cancelled'::app.task_status where id = r.task_id;
    -- `marcada_por = 'pessoa'` sem case: só gente chega aqui (a função recusa
    -- sem `auth.uid()`, e o robô não tem grant). Ramo de robô aqui seria
    -- código morto a fingir que existe caminho.
    -- `r.dono_id`: remarcar muda a HORA, não a agenda. Sem ele o dono seria
    -- recalculado pelo negócio, e a reunião que o gestor marcou para si mesmo
    -- iria parar na agenda do dono do negócio na primeira remarcação. A exceção é
    -- quem saiu do time (`is_active = false`): aí `null`, e a reunião volta a
    -- seguir o dono do negócio, como antes — reunião nova na agenda de quem não
    -- trabalha mais aqui ninguém atende.
    v_nova := app.reuniao_gravar(r.conversation_id, r.deal_id, p_novo_inicio, r.formato,
                                 r.local, r.observacao, 'pessoa', auth.uid(),
                                 (select p.id from public.profiles p
                                   where p.id = r.dono_id and p.is_active));
    if coalesce((v_nova ->> 'ok')::boolean, false) is not true then
      raise exception '%', coalesce(v_nova ->> 'motivo', 'falhou') using errcode = 'P0001';
    end if;
    update public.reunioes set remarcada_de = p_id, atualizada_em = now()
     where id = (v_nova ->> 'reuniao_id')::uuid;
  exception when sqlstate 'P0001' then
    v_motivo := sqlerrm;
    return jsonb_build_object('ok', false, 'motivo', v_motivo,
             'alternativas', app.reuniao_opcoes(r.dono_id, 3));
  end;
  if r.marcada_por = 'robo' then perform app.reuniao_rampa_adiar(); end if;
  -- Outra pessoa mexeu na agenda do dono: ele ganha o aviso da nova hora (o da
  -- hora velha some sozinho na tela, porque a reunião dele virou `remarcada`).
  insert into public.agenda_avisos (dono_id, marcado_por, tipo, task_id, reuniao_id, titulo, quando)
  select n.dono_id, auth.uid(), 'reuniao', n.task_id, n.id, n.titulo, n.inicio
    from public.reunioes n
   where n.id = (v_nova ->> 'reuniao_id')::uuid and n.dono_id <> auth.uid();
  return v_nova || jsonb_build_object('remarcada_de', p_id);
end $$;

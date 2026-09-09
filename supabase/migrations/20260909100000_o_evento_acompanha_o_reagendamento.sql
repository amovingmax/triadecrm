-- =====================================================================
-- 20260909100000 — O evento acompanha o reagendamento
--
-- Buraco na entrega de ontem (20260908180000), encontrado ao reler o caminho de
-- "Reagendar": **o evento no Google ficava no horário velho**.
--
-- O motivo está em `move_deal`. Reagendar não altera a tarefa da reunião: ela é
-- FECHADA (`status = 'done'`, por `concluirCompromisso`) e uma tarefa NOVA é
-- inserida com a nova data. O espelho em `compromissos_no_google` é chaveado por
-- `task_id`, então ele continuava apontando para a tarefa velha, e a tarefa nova
-- nascia sem evento.
--
-- O resultado prático era o pior possível: o fornecedor tinha, na agenda dele, um
-- convite para um horário que não valia mais, e ninguém do lado da Komune veria
-- isso — a reunião nova estava certa no CRM.
--
-- ---------------------------------------------------------------------------
-- POR QUE REMANEJAR O ESPELHO, E NÃO APAGAR E CRIAR OUTRO
-- ---------------------------------------------------------------------------
-- Porque o Google tem semântica própria para isto. Alterar o evento existente
-- (PATCH) faz ele avisar o convidado de que a reunião FOI REMARCADA, mantendo o
-- histórico e a mesma sala do Meet. Apagar e criar manda um cancelamento seguido
-- de um convite novo — duas notificações, dois links, e a impressão de que a
-- reunião caiu.
--
-- Então o evento continua o mesmo lá; aqui, o espelho MUDA DE DONO: sai da tarefa
-- fechada e passa para a tarefa nova.
--
-- ---------------------------------------------------------------------------
-- COMO A TAREFA NOVA É ENCONTRADA
-- ---------------------------------------------------------------------------
-- `move_deal` insere a tarefa da reunião sem devolver o id dela (só o id da
-- próxima ação sai na resposta), então o servidor não tem como recebê-lo do
-- cliente. A busca é por (mesmo negócio, kind `meeting`, `due_at` exatamente no
-- horário combinado, ainda aberta) — que é a linha que o próprio `move_deal`
-- acabou de escrever com esses quatro valores.
--
-- Se essa busca não achar nada, a função RECUSA e não mexe em nada: mover o
-- espelho para a tarefa errada seria pior que deixá-lo na tarefa fechada, porque
-- aí a reunião certa mostraria o link de outra.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 1. Ler o espelho (o servidor precisa do id do evento antes de falar com o Google)
-- ---------------------------------------------------------------------------

create or replace function app.compromisso_do_google_ler(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'task_id',   g.task_id,
    'evento_id', g.evento_id,
    'agenda_id', g.agenda_id,
    'meet_url',  g.meet_url,
    'link_html', g.link_html,
    -- Quem CRIOU o evento é dono dele no Google. Quem reagenda pode ser outra
    -- pessoa, e nesse caso o token que serve é o de quem criou — não o de quem
    -- está clicando agora.
    'criado_por', g.criado_por
  )
  from public.compromissos_no_google g
  where g.task_id = p_task_id
$$;

comment on function app.compromisso_do_google_ler(uuid) is
  'O espelho de uma tarefa: id do evento, agenda, links e QUEM criou (dono do evento no Google, cujo token é o que serve para alterá-lo). Só service_role.';

revoke all on function app.compromisso_do_google_ler(uuid) from public, anon, authenticated;
grant execute on function app.compromisso_do_google_ler(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 2. Passar o espelho para a tarefa nova
-- ---------------------------------------------------------------------------

create or replace function app.compromisso_do_google_remanejar(
  p_task_antiga  uuid,
  p_novo_horario timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deal  uuid;
  v_nova  uuid;
begin
  if not exists (select 1 from public.compromissos_no_google g where g.task_id = p_task_antiga) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_espelho');
  end if;

  select t.deal_id into v_deal from public.tasks t where t.id = p_task_antiga;
  if v_deal is null then
    -- Tarefa sem negócio não passa por `move_deal`, e portanto não gera a tarefa
    -- nova que esta função procura.
    return jsonb_build_object('ok', false, 'motivo', 'sem_negocio');
  end if;

  select t.id into v_nova
    from public.tasks t
   where t.deal_id = v_deal
     and t.kind = 'meeting'::app.task_kind
     and t.due_at = p_novo_horario
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     and t.id <> p_task_antiga
   order by t.created_at desc
   limit 1;

  if v_nova is null then
    return jsonb_build_object('ok', false, 'motivo', 'tarefa_nova_nao_encontrada');
  end if;

  -- A tarefa nova pode já ter espelho próprio (alguém clicou "Pôr na agenda"
  -- antes de o remanejamento acontecer). Nesse caso existem DOIS eventos no
  -- Google, e quem resolve isso é uma pessoa olhando a agenda — não uma função
  -- escolhendo qual apagar.
  if exists (select 1 from public.compromissos_no_google g where g.task_id = v_nova) then
    return jsonb_build_object('ok', false, 'motivo', 'tarefa_nova_ja_tem_evento',
                              'task_id', v_nova);
  end if;

  update public.compromissos_no_google
     set task_id = v_nova, sincronizado_em = now()
   where task_id = p_task_antiga;

  return jsonb_build_object('ok', true, 'task_id', v_nova);
end
$$;

comment on function app.compromisso_do_google_remanejar(uuid, timestamptz) is
  'Passa o espelho do Google da tarefa de reunião fechada para a tarefa nova criada pelo reagendamento. Recusa (sem mexer em nada) quando a tarefa nova não é encontrada ou já tem evento próprio.';

revoke all on function app.compromisso_do_google_remanejar(uuid, timestamptz) from public, anon, authenticated;
grant execute on function app.compromisso_do_google_remanejar(uuid, timestamptz) to service_role;


-- ---------------------------------------------------------------------------
-- 3. Esquecer o espelho
-- ---------------------------------------------------------------------------
-- Usada depois que o evento foi apagado no Google. Só apaga a LINHA: quem apaga
-- o evento lá é o servidor, antes de chamar isto.

create or replace function app.compromisso_do_google_esquecer(p_task_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_n int;
begin
  delete from public.compromissos_no_google where task_id = p_task_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0, 'motivo',
                            case when v_n > 0 then null else 'sem_espelho' end);
end
$$;

comment on function app.compromisso_do_google_esquecer(uuid) is
  'Apaga o espelho de uma tarefa depois que o evento saiu do Google. Só a linha daqui — quem apaga lá é o servidor.';

revoke all on function app.compromisso_do_google_esquecer(uuid) from public, anon, authenticated;
grant execute on function app.compromisso_do_google_esquecer(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 4. O token de QUEM CRIOU o evento
-- ---------------------------------------------------------------------------
-- `agenda_google_token` devolve o token de uma pessoa. Alterar ou apagar um
-- evento exige o token de quem é DONO dele no Google, que é quem o criou — e não
-- necessariamente quem está clicando. Sem esta distinção, a Heloísa reagendando
-- uma reunião que a Bárbara criou receberia 404 do Google: o evento não está na
-- agenda dela.

create or replace function app.agenda_google_token_do_evento(p_task_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
    from public.compromissos_no_google g
    join app.agendas_do_google a on a.user_id = g.criado_por
    join vault.decrypted_secrets s on s.id = a.segredo_id
   where g.task_id = p_task_id
     and a.revogada_em is null
$$;

comment on function app.agenda_google_token_do_evento(uuid) is
  'O refresh token de quem CRIOU o evento desta tarefa — o dono dele no Google. Quem reagenda pode ser outra pessoa, e o token dela não alcança um evento que não está na agenda dela.';

revoke all on function app.agenda_google_token_do_evento(uuid) from public, anon, authenticated;
grant execute on function app.agenda_google_token_do_evento(uuid) to service_role;

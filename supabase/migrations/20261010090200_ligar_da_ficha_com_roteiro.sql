-- ===========================================================================
-- TRÍADE — ligar da ficha, com o roteiro (R13 §3.1 a §3.4; RF-CON-11, RF-CON-18)
--
-- Pedido do Rafael em 06/10/2026: a ligação feita pela ficha tem de seguir o MESMO
-- padrão da ligação do lote — a fala na tela, as respostas do parceiro como botões,
-- a próxima pergunta, a tabulação no fim. "Exatamente como funciona hoje."
--
-- O jeito de ser exatamente igual é ser a mesma coisa. O botão "Ligar" da ficha
-- monta um LOTE DE UM CONTATO e abre a tela de ligar que já existe: o roteiro, o
-- caminho percorrido, a tabulação em dois eixos, o recibo e o resumo da IA são os
-- do módulo, sem uma segunda versão de nada.
--
--   1. `call_batches.avulso`        — marca o lote de um contato nascido da ficha,
--      para ele não aparecer na lista de lotes nem ser confundido com um turno.
--   2. `public.montar_lote_avulso`  — monta (ou reaproveita) esse lote, com as
--      mesmas travas: papel, janela, supressão, e a RESERVA — parceiro que está no
--      lote de outra pessoa não é ligado por fora dele.
--   3. `app.encerrar_lotes_avulsos` — fecha o lote avulso que terminou ou foi
--      abandonado, para a reserva não prender o parceiro.
--
-- O que NÃO vale aqui, de propósito: a janela de recontato (cooldown) e o filtro de
-- temperatura do lote de turno. Quem abre a ficha e decide ligar já escolheu para
-- quem ligar; é o mesmo critério da tela Registrar, que também não os aplica.
--
-- Idempotente: pode ser reaplicada.
--
-- COMO DESFAZER:
--   select cron.unschedule('encerrar_lotes_avulsos');
--   drop function if exists app.encerrar_lotes_avulsos();
--   drop function if exists public.montar_lote_avulso(uuid);
--   update public.call_batches set status = 'encerrado' where avulso and status <> 'encerrado';
--   alter table public.call_batches drop column if exists avulso;
-- ===========================================================================

alter table public.call_batches
  add column if not exists avulso boolean not null default false;
comment on column public.call_batches.avulso is
  'true no lote de UM contato montado pelo botão Ligar da ficha (public.montar_lote_avulso). Usa a tela, o roteiro e a tabulação do módulo; fica fora da lista de lotes.';
create index if not exists call_batches_avulsos_idx
  on public.call_batches (created_at) where avulso and status = 'ativo'::app.call_batch_status;


create or replace function public.montar_lote_avulso(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_org    public.organizations%rowtype;
  v_janela jsonb;
  r        record;
  d        public.deals%rowtype;
  s        public.call_scripts%rowtype;
  v_lote   uuid;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  if p_organization_id is null or not app.org_is_visible(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'parceiro_inexistente');
  end if;
  select * into v_org from public.organizations o
   where o.id = p_organization_id and o.deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'parceiro_inexistente');
  end if;
  if nullif(trim(coalesce(v_org.phone_e164, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_telefone');
  end if;
  if v_org.phone_e164 !~ '^\+55[1-9][0-9]{9,10}$' then
    return jsonb_build_object('ok', false, 'motivo', 'numero_invalido');
  end if;
  if v_org.do_not_contact or app.is_suppressed_target(v_org.id, null) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido');
  end if;

  v_janela := app.call_window(now());
  if not (v_janela ->> 'aberta')::boolean then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_janela',
                              'detalhe', v_janela ->> 'motivo', 'abre_em', v_janela -> 'abre_em');
  end if;

  -- ----- a reserva (R13 §3.1): por organização OU por linha telefônica -----
  for r in
    select i.id as item_id, i.attempts, b.id as batch_id, b.nome, b.owner_id, b.avulso,
           b.status, b.starts_on, b.ends_on
      from public.call_batch_items i
      join public.call_batches b on b.id = i.batch_id
     where i.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status)
       and (i.organization_id = v_org.id or i.phone_e164 = v_org.phone_e164)
     for update of i
  loop
    if r.owner_id <> v_uid then
      return jsonb_build_object(
        'ok', false, 'motivo', 'reservado_em_outro_lote',
        'dono', (select p.full_name from public.profiles p where p.id = r.owner_id));
    end if;
    if not r.avulso then
      -- Está num lote de turno DELA: é por lá que se liga, na ordem da fila.
      return jsonb_build_object('ok', false, 'motivo', 'ja_no_seu_lote',
                                'lote_id', r.batch_id, 'lote_nome', r.nome);
    end if;
    -- Lote avulso dela mesma, ainda inteiro: é o segundo clique, ou a volta à ficha.
    if r.status = 'ativo'::app.call_batch_status and r.attempts = 0
       and v_hoje between r.starts_on and r.ends_on then
      return jsonb_build_object('ok', true, 'lote_id', r.batch_id, 'reaproveitado', true);
    end if;
    -- Lote avulso que ficou para trás (ligou e não tabulou, ou é de ontem): fecha,
    -- o que devolve o item e solta a reserva, e segue para montar outro.
    update public.call_batches b set status = 'encerrado'::app.call_batch_status
     where b.id = r.batch_id;
  end loop;

  -- ----- o funil e o roteiro -----
  select * into d from public.deals x
   where x.organization_id = v_org.id and x.status = 'open'::app.deal_status
   order by x.last_activity_at desc nulls last, x.created_at desc
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sem_negocio_aberto');
  end if;

  select * into s from public.call_scripts x
   where x.is_published
   order by x.created_at desc, x.versao desc
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'roteiro_invalido');
  end if;

  begin
    insert into public.call_batches
      (nome, owner_id, status, pipeline_id, temperature_origin, script_id, script_version,
       order_mode, max_attempts, min_hours_between_attempts, starts_on, ends_on, avulso)
    values
      (left('Ligação · ' || v_org.name, 60), v_uid, 'ativo', d.pipeline_id,
       coalesce(d.temperature, 'frio'::app.temperature), s.id, s.versao,
       'prioridade', 1, 20, v_hoje, v_hoje, true)
    returning id into v_lote;

    insert into public.call_batch_items
      (batch_id, organization_id, contact_id, phone_e164, deal_id, stage_id, position)
    values
      (v_lote, v_org.id, d.primary_contact_id, v_org.phone_e164, d.id, d.stage_id, 1);
  exception when unique_violation then
    -- Alguém reservou este parceiro entre a conferência e o insert. Se foi ELA
    -- mesma (dois cliques, duas abas), a resposta é o lote que venceu a corrida.
    select b.id into v_lote
      from public.call_batch_items i
      join public.call_batches b on b.id = i.batch_id
     where i.organization_id = v_org.id
       and i.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status)
       and b.avulso and b.owner_id = v_uid and b.status = 'ativo'::app.call_batch_status
     limit 1;
    if v_lote is not null then
      return jsonb_build_object('ok', true, 'lote_id', v_lote, 'reaproveitado', true);
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'reservado_em_outro_lote', 'dono', null);
  end;

  return jsonb_build_object('ok', true, 'lote_id', v_lote, 'reaproveitado', false);
end $$;
comment on function public.montar_lote_avulso(uuid) is
  'Botão Ligar da ficha: monta (ou reaproveita) um lote de UM contato para o parceiro e devolve o id, para a tela de ligar do módulo abrir com o roteiro. Mesmas travas do módulo (papel, janela, supressão, reserva por organização e por linha). Recusa com motivo nomeado: sem_permissao, parceiro_inexistente, sem_telefone, numero_invalido, contato_suprimido, fora_da_janela, reservado_em_outro_lote, ja_no_seu_lote, sem_negocio_aberto, roteiro_invalido.';
revoke all on function public.montar_lote_avulso(uuid) from public, anon;
grant execute on function public.montar_lote_avulso(uuid) to authenticated;


-- O lote avulso é de uma ligação só. Terminou (nada pendente), venceu (é de ontem)
-- ou foi abandonado (duas horas sem ninguém com o contato em mãos): fecha. Fechar
-- devolve o item e solta a reserva (`app.call_batches_on_close`), e o parceiro
-- volta a poder entrar no lote de qualquer pessoa.
create or replace function app.encerrar_lotes_avulsos()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_n    int;
begin
  update public.call_batches b
     set status = 'encerrado'::app.call_batch_status
   where b.avulso
     and b.status = 'ativo'::app.call_batch_status
     and (   b.ends_on < v_hoje
          or not exists (select 1 from public.call_batch_items i
                          where i.batch_id = b.id
                            and i.status in ('fila'::app.call_item_status,
                                             'em_andamento'::app.call_item_status))
          or (b.created_at < now() - interval '2 hours'
              and not exists (select 1 from public.call_batch_items i
                               where i.batch_id = b.id
                                 and i.status = 'em_andamento'::app.call_item_status
                                 and i.reserved_until > now())));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function app.encerrar_lotes_avulsos() is
  'pg_cron, a cada 10 min: encerra o lote avulso (ligação da ficha) que terminou, venceu ou foi abandonado há mais de 2 h, soltando a reserva do parceiro. Devolve quantos fechou.';
revoke all on function app.encerrar_lotes_avulsos() from public, anon, authenticated;
grant execute on function app.encerrar_lotes_avulsos() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('encerrar_lotes_avulsos', '*/10 * * * *',
                          $cron$select app.encerrar_lotes_avulsos()$cron$);
  end if;
end $$;

notify pgrst, 'reload schema';

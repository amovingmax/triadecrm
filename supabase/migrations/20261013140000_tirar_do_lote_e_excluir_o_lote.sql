-- =====================================================================
-- Tirar um contato do lote, e excluir o lote
--
-- Pedido de 13/10/2026 (pendência de 07/10 no CHANGELOG, "o que continua sem
-- excluir", item 2): até aqui um lote só se encerrava. Quem entrou nele por
-- engano ficava lá até alguém ligar, e o lote montado errado ficava na lista
-- para sempre.
--
-- TRÊS FUNÇÕES, todas da gestão (admin e gestor), que é quem monta o lote
-- desde o pivô de 06/10:
--
--   public.lote_contatos(lote)        quem está no lote e em que pé cada um está
--   public.lote_tirar_contato(item)   tira da fila UM contato que ainda não foi ligado
--   public.lote_excluir(lote, motivo) tira o lote da lista
--
-- EXCLUIR NÃO É DELETE (regra de 07/10). O lote excluído ganha `deleted_at`,
-- é encerrado — o gatilho `call_batches_on_close` devolve à base quem ainda
-- estava na fila — e some da tela de Lotes. As ligações que já foram feitas
-- nele NÃO somem: `call_attempts` fica inteiro, e o relatório do dia por
-- pessoa (`public.ligacoes_do_dia`) continua contando cada uma. Um relatório
-- exato não pode perder ligação porque alguém arrumou a lista de lotes.
--
-- NADA AQUI MUDA QUEM LIGA: `iniciar_chamada`, `tabular_chamada` e a
-- telefonia continuam abertos a admin, gestor e SDR.
--
-- RF-BAS-10, RF-ADM-03, R13 §3.1
-- =====================================================================

alter table public.call_batches
  add column if not exists deleted_at    timestamptz,
  add column if not exists deleted_by    uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text;

comment on column public.call_batches.deleted_at is
  'Quando o lote foi excluído pela gestão (public.lote_excluir). O lote some da tela de Lotes; as ligações feitas nele continuam em call_attempts e nos relatórios.';

create index if not exists call_batches_vivos_idx
  on public.call_batches (created_at desc) where deleted_at is null;


-- ---------------------------------------------------------------------
-- Quem está no lote
-- ---------------------------------------------------------------------
create or replace function public.lote_contatos(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  b     public.call_batches%rowtype;
  v_ret jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  select * into b from public.call_batches where id = p_batch_id;
  if not found or not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'lote_inexistente');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id',     i.id,
           'organizacao_id', i.organization_id,
           'nome',        o.name,
           'status',      i.status,
           'tentativas',  i.attempts,
           'ultimo_resultado', u.resultado,
           'ultimo_desfecho',  u.desfecho)
           order by (i.status = 'fila'::app.call_item_status) desc, i.position, i.id), '[]'::jsonb)
    into v_ret
    from public.call_batch_items i
    join public.organizations o on o.id = i.organization_id
    left join lateral (
      select a.resultado, io.name as desfecho
        from public.call_attempts a
        left join public.interaction_outcomes io on io.id = a.outcome_id
       where a.item_id = i.id and a.resultado is not null
       order by a.iniciada_em desc
       limit 1) u on true
   where i.batch_id = p_batch_id;

  return jsonb_build_object('ok', true, 'lote', b.nome, 'contatos', v_ret);
end $$;

comment on function public.lote_contatos(uuid) is
  'Os contatos de um lote, com a situação de cada um na fila e o último resultado. Para a gestão e para quem é dono do lote. Não devolve telefone.';
revoke all on function public.lote_contatos(uuid) from public, anon;
grant execute on function public.lote_contatos(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- Tirar um contato do lote
-- ---------------------------------------------------------------------
create or replace function public.lote_tirar_contato(p_item_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  i        public.call_batch_items%rowtype;
  b        public.call_batches%rowtype;
  v_nome   text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into i from public.call_batch_items where id = p_item_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'item_inexistente');
  end if;
  select * into b from public.call_batches where id = i.batch_id;
  if b.status = 'encerrado'::app.call_batch_status then
    return jsonb_build_object('ok', false, 'motivo', 'lote_encerrado');
  end if;
  -- Quem está com a ligação aberta sai pela tela de ligar (devolver ou tabular);
  -- tirar por fora deixaria a pessoa falando com um contato que o lote já não tem.
  if i.status = 'em_andamento'::app.call_item_status then
    return jsonb_build_object('ok', false, 'motivo', 'em_ligacao');
  end if;
  -- Quem já foi ligado e concluído é história do lote, não fila.
  if i.status <> 'fila'::app.call_item_status then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_fila');
  end if;

  update public.call_batch_items x
     set status = 'devolvido'::app.call_item_status,
         scheduled_at = null,
         reserved_until = null,
         reserved_by = null,
         note = coalesce(v_motivo, x.note)
   where x.id = i.id;

  select o.name into v_nome from public.organizations o where o.id = i.organization_id;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, app.role()::text, 'TIRAR_DO_LOTE', 'call_batch_items', i.id::text,
          jsonb_build_object('batch_id', i.batch_id, 'organization_id', i.organization_id,
                             'motivo', v_motivo));

  return jsonb_build_object('ok', true, 'nome', v_nome, 'lote', b.nome,
                            'restantes', app.itens_restantes_do_lote(b.id));
end $$;

comment on function public.lote_tirar_contato(uuid, text) is
  'Tira da fila de um lote aberto um contato que ainda espera ligação: ele volta para a base e pode entrar em outro lote. Só admin e gestor. Contato em ligação ou já concluído não sai por aqui. Auditado como TIRAR_DO_LOTE.';
revoke all on function public.lote_tirar_contato(uuid, text) from public, anon;
grant execute on function public.lote_tirar_contato(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Excluir o lote
-- ---------------------------------------------------------------------
create or replace function public.lote_excluir(p_batch_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  b           public.call_batches%rowtype;
  v_motivo    text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_na_fila   int;
  v_ligacoes  int;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;

  select * into b from public.call_batches where id = p_batch_id for update;
  if not found or b.deleted_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'lote_inexistente');
  end if;
  -- Alguém falando agora: excluir fecharia a tentativa dela sem resultado.
  if exists (select 1 from public.call_batch_items i
              where i.batch_id = b.id
                and i.status = 'em_andamento'::app.call_item_status
                and i.reserved_until > now()) then
    return jsonb_build_object('ok', false, 'motivo', 'em_ligacao');
  end if;

  select count(*)::int into v_na_fila
    from public.call_batch_items i
   where i.batch_id = b.id
     and i.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status);
  select count(*)::int into v_ligacoes
    from public.call_attempts a where a.batch_id = b.id and a.resultado is not null;

  -- Encerrar primeiro: é o gatilho `call_batches_on_close` que devolve a fila.
  update public.call_batches x
     set status        = 'encerrado'::app.call_batch_status,
         deleted_at    = now(),
         deleted_by    = v_uid,
         delete_reason = v_motivo
   where x.id = b.id;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, app.role()::text, 'EXCLUIR_LOTE', 'call_batches', b.id::text,
          jsonb_build_object('nome', b.nome, 'motivo', v_motivo,
                             'devolvidos', v_na_fila, 'ligacoes_feitas', v_ligacoes));

  return jsonb_build_object('ok', true, 'nome', b.nome,
                            'devolvidos', v_na_fila, 'ligacoes_feitas', v_ligacoes);
end $$;

comment on function public.lote_excluir(uuid, text) is
  'Exclui um lote da tela de Lotes, com motivo: marca deleted_at, encerra e devolve à base quem estava na fila. Não apaga linha: as ligações feitas continuam em call_attempts e no relatório do dia. Só admin e gestor. Recusa enquanto alguém está em ligação no lote. Auditado como EXCLUIR_LOTE.';
revoke all on function public.lote_excluir(uuid, text) from public, anon;
grant execute on function public.lote_excluir(uuid, text) to authenticated;

notify pgrst, 'reload schema';

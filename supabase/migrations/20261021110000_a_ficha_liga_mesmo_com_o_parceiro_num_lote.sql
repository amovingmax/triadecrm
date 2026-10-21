-- ===========================================================================
-- TRÍADE — a ficha liga, mesmo com o parceiro num lote (21/10/2026; R13 §3.1)
--
-- Pedido do usuário: "deve ser permitido que eu consiga ligar para o fornecedor
-- pela própria ficha dele [...] como eu já estava conseguindo fazer", no PC e no
-- celular. O "Ligar" da ficha recusava quase sempre: o parceiro na fila de um lote
-- (de quem clicou ou de outra pessoa) era "Já está no seu lote, ligue por lá" ou
-- "Em outro lote". Com a base inteira distribuída em lotes, a ficha não ligava.
--
-- Agora, se o parceiro está ESPERANDO na fila de um lote, a ligação pela ficha o
-- tira daquela fila (como `lote_tirar_contato`, com nota e `audit_log`) e liga na
-- hora, no lote avulso de sempre. A resposta diz de que lote ele saiu, para a tela
-- avisar. A reserva (R13 §3.1) continua no que ela protege — duas pessoas na mesma
-- ligação: se alguém está com o parceiro na tela de ligar agora (item
-- `em_andamento`, ou o lote avulso que outra pessoa acabou de abrir pela ficha), a
-- recusa é `em_ligacao_agora`, com o nome de quem está.
--
-- Tirar da fila de OUTRA pessoa é poder da gestão (`app.is_manager()`: admin,
-- gestor e, desde 21/10/2026, SDR); da própria fila, quem liga tira. O embaixador,
-- papel antigo, continua recebendo `reservado_em_outro_lote`.
--
-- O contato tirado não volta ao lote depois da ligação: a ligação conta para quem
-- ligou (`ligacoes_do_dia`), e o lote de origem fica com um a menos na fila.
--
-- Idempotente: pode ser reaplicada.
--
-- COMO DESFAZER: reaplicar `public.montar_lote_avulso` de
-- 20261010090200_ligar_da_ficha_com_roteiro.sql.
-- ===========================================================================

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
  v_quem   text;
  v_tirado jsonb;
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
    select i.id as item_id, i.status as item_status, i.attempts, i.reserved_by,
           b.id as batch_id, b.nome, b.owner_id, b.avulso,
           b.status, b.starts_on, b.ends_on
      from public.call_batch_items i
      join public.call_batches b on b.id = i.batch_id
     where i.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status)
       and (i.organization_id = v_org.id or i.phone_e164 = v_org.phone_e164)
     for update of i
  loop
    -- O lote avulso de quem clicou: é o segundo clique, ou a volta à ficha.
    if r.avulso and r.owner_id = v_uid then
      if r.status = 'ativo'::app.call_batch_status and r.attempts = 0
         and v_hoje between r.starts_on and r.ends_on then
        return jsonb_build_object('ok', true, 'lote_id', r.batch_id, 'reaproveitado', true);
      end if;
      -- Ficou para trás (ligou e não tabulou, ou é de ontem): fecha, o que devolve o
      -- item e solta a reserva, e segue para montar outro.
      update public.call_batches b set status = 'encerrado'::app.call_batch_status
       where b.id = r.batch_id;
      continue;
    end if;

    -- Alguém está com o parceiro na tela de ligar agora: a ligação em curso, ou o
    -- lote avulso que outra pessoa acabou de abrir pela ficha. Duas pessoas na mesma
    -- ligação é o que a reserva existe para impedir.
    if r.item_status = 'em_andamento'::app.call_item_status
       or (r.avulso and r.status = 'ativo'::app.call_batch_status and r.attempts = 0
           and v_hoje between r.starts_on and r.ends_on) then
      select p.full_name into v_quem from public.profiles p
       where p.id = coalesce(r.reserved_by, r.owner_id);
      return jsonb_build_object('ok', false, 'motivo', 'em_ligacao_agora',
                                'dono', v_quem,
                                'e_voce', coalesce(r.reserved_by, r.owner_id) = v_uid);
    end if;

    -- Esperando na fila de um lote. Da própria fila, quem liga tira; da fila de
    -- outra pessoa, só quem tem o poder da gestão.
    if r.owner_id <> v_uid and not app.is_manager() then
      return jsonb_build_object(
        'ok', false, 'motivo', 'reservado_em_outro_lote',
        'dono', (select p.full_name from public.profiles p where p.id = r.owner_id));
    end if;

    select p.full_name into v_quem from public.profiles p where p.id = v_uid;
    update public.call_batch_items x
       set status = 'devolvido'::app.call_item_status,
           scheduled_at = null,
           reserved_until = null,
           reserved_by = null,
           note = left('Saiu da fila para a ligação pela ficha'
                       || coalesce(', de ' || v_quem, '') || '.', 300)
     where x.id = r.item_id;
    insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
    values (v_uid, app.role()::text, 'TIRAR_DO_LOTE', 'call_batch_items', r.item_id::text,
            jsonb_build_object('batch_id', r.batch_id, 'organization_id', v_org.id,
                               'motivo', 'ligação pela ficha'));
    if v_tirado is null and not r.avulso then
      v_tirado := jsonb_build_object(
        'lote_nome', r.nome,
        'dono', (select p.full_name from public.profiles p where p.id = r.owner_id),
        'e_seu', r.owner_id = v_uid);
    end if;
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
    return jsonb_build_object('ok', false, 'motivo', 'em_ligacao_agora', 'dono', null,
                              'e_voce', false);
  end;

  return jsonb_build_object('ok', true, 'lote_id', v_lote, 'reaproveitado', false,
                            'tirado_de', v_tirado);
end $$;
comment on function public.montar_lote_avulso(uuid) is
  'Botão Ligar da ficha: monta (ou reaproveita) um lote de UM contato para o parceiro e devolve o id, para a tela de ligar do módulo abrir com o roteiro. Se o parceiro espera na fila de um lote, sai dela para esta ligação (tirado_de diz de qual); da fila de outra pessoa, só com app.is_manager(). Recusa com motivo nomeado: sem_permissao, parceiro_inexistente, sem_telefone, numero_invalido, contato_suprimido, fora_da_janela, em_ligacao_agora (alguém está com ele na tela de ligar), reservado_em_outro_lote (papel sem poder de gestão), sem_negocio_aberto, roteiro_invalido.';
revoke all on function public.montar_lote_avulso(uuid) from public, anon;
grant execute on function public.montar_lote_avulso(uuid) to authenticated;

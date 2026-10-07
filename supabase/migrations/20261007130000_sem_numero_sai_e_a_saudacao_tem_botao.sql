-- =====================================================================
-- Quem não tem número sai de Prospectados, e a saudação ganha botão
--
-- Pedido do Rafael em 07/10/2026: "quero que você limpe dos prospectados
-- todos os contatos que tiverem sem número, e facilite naquela tela de
-- prospectados um botão que envie de forma mais fácil a saudação inicial
-- 'Boa tarde...'".
--
-- ===========================================================================
-- A LIMPEZA
-- ===========================================================================
-- "Sem número" é: sem telefone na ficha, sem telefone em pessoa de contato
-- (a mesma conta de `app.wa_destino_da_ficha`, que é por onde a mensagem
-- sairia) e sem conversa de WhatsApp. Quem tem conversa tem número, mesmo que
-- a ficha não o carregue.
--
-- A limpeza é a EXCLUSÃO de 07/10 (20261007110000), não um DELETE: a ficha sai
-- de Prospectados, do funil, dos lotes e do Meu dia; o pendente dela é
-- encerrado; o histórico fica; e cada uma aparece em Prospectados → Excluídos
-- com o motivo, de onde se restaura. Cliente e quem tem pré-cadastro aberto
-- ficam, pela mesma regra da exclusão manual.
--
-- Para a limpeza rodar sem sessão de usuário (é a migração quem roda), a
-- exclusão ganha uma versão interna, `app.parceiro_excluir_interno`, e o
-- cancelamento de reunião idem (`app.reuniao_cancelar_interno`). As funções
-- públicas continuam com a mesma assinatura e a mesma conferência de papel;
-- só passam a chamar as internas.
--
-- ===========================================================================
-- O BOTÃO DA SAUDAÇÃO
-- ===========================================================================
-- Até aqui a saudação ("Bom dia!", "Boa tarde!" ou "Boa noite!", pela hora do
-- envio — `app.modelo_da_hora`) só entrava na fila no instante da aprovação,
-- pelo botão "Aprovar e mandar mensagem" da Revisão. Quem foi aprovado sem
-- mensagem e está em Prospectados não tinha como recebê-la.
--
-- `public.saudacao_enfileirar(ids)` põe as fichas escolhidas na MESMA fila
-- contínua (`app.cumprimento_lote`): mesmo ritmo por hora, mesmo horário, mesmo
-- teto do dia, mesma porteira na hora de sair (`app.envio_um`). Antes de
-- enfileirar ela já separa quem não deve receber, e diz por quê:
--   sem_whatsapp · nao_contatar · ja_conversou · ja_na_fila · ja_recebeu ·
--   nao_encontrado.
-- O interruptor "saudação" de Ajustes continua sendo o disjuntor geral:
-- desligado, nada entra na fila, com ou sem botão.
--
-- `public.saudacao_desfazer(ids)` tira da fila o que ainda não saiu — é o
-- "Desfazer" do aviso de depois do clique.
--
-- RF-BAS-10, RF-CON-02, RF-CON-11
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Cancelar reunião, sem a conferência de quem pede
-- ---------------------------------------------------------------------
-- O corpo de `public.reuniao_cancelar` (20260930110000) depois da conferência
-- de permissão, inteiro e sem mudança.
create or replace function app.reuniao_cancelar_interno(p_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.reunioes%rowtype;
begin
  select * into r from public.reunioes where id = p_id;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'nao_existe'); end if;
  if r.estado not in ('a_confirmar','marcada','confirmada') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_invalido', 'estado', r.estado); end if;
  update public.reunioes
     set estado = 'cancelada', atualizada_em = now(),
         observacao = coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), observacao)
   where id = p_id;
  update public.tasks set status = 'cancelled'::app.task_status where id = r.task_id;
  if r.marcada_por = 'robo' then perform app.reuniao_rampa_adiar(); end if;
  perform app.esteira_enfileirar('reuniao_avisos',
    jsonb_build_object('reuniao_id', p_id, 'motivo', 'cancelada',
                       'chave', 'reuniao:' || p_id::text || ':cancelada'),
    'reuniao:' || p_id::text || ':cancelada');
  return jsonb_build_object('ok', true, 'estado', 'cancelada');
end $$;
comment on function app.reuniao_cancelar_interno(uuid, text) is
  'Cancela uma reunião viva (solta o horário, cancela a tarefa-eco, avisa o time) sem conferir quem pede. Quem confere é public.reuniao_cancelar; esta serve a quem já conferiu, como a exclusão de parceiro.';
revoke all on function app.reuniao_cancelar_interno(uuid, text) from public, anon, authenticated;

create or replace function public.reuniao_cancelar(p_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.reunioes%rowtype;
begin
  select * into r from public.reunioes where id = p_id;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'nao_existe'); end if;
  if not app.reuniao_pode_mexer(r) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  return app.reuniao_cancelar_interno(p_id, p_motivo);
end $$;


-- ---------------------------------------------------------------------
-- 2 · Excluir parceiro, em duas camadas
-- ---------------------------------------------------------------------
-- O corpo de `public.parceiro_excluir` (20261007110000) a partir da leitura da
-- ficha, com duas trocas: a reunião sai por `app.reuniao_cancelar_interno`, e
-- quem excluiu é `p_por` (nulo = o sistema, que é como a limpeza assina).
create or replace function app.parceiro_excluir_interno(p_organization_id uuid, p_motivo text, p_por uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo    text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_papel     text := case when p_por is null then 'sistema' else app.role()::text end;
  o           public.organizations%rowtype;
  r           record;
  n_reunioes  int := 0;
  n_tarefas   int := 0;
  n_envios    int := 0;
  n_conversas int := 0;
begin
  select * into o from public.organizations where id = p_organization_id for update;
  if not found or o.deleted_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;

  -- Cliente não se exclui por aqui: o cadastro dele mora na Komune.
  if o.komune_supplier_id is not null
     or exists (select 1 from public.deals d
                 where d.organization_id = o.id and d.status = 'won'::app.deal_status)
     or exists (select 1 from public.pre_registrations pr
                 where pr.organization_id = o.id
                   and pr.status in ('completed'::app.prereg_status, 'published'::app.prereg_status)) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_e_cliente');
  end if;
  -- Nem quem está com o rascunho aberto do lado de lá.
  if exists (select 1 from public.pre_registrations pr
              where pr.organization_id = o.id
                and pr.status in ('pending'::app.prereg_status, 'draft_created'::app.prereg_status,
                                  'link_sent'::app.prereg_status, 'in_progress'::app.prereg_status)) then
    return jsonb_build_object('ok', false, 'motivo', 'pre_cadastro_em_andamento');
  end if;

  for r in select re.id from public.reunioes re
            where re.organization_id = o.id
              and re.estado in ('a_confirmar', 'marcada', 'confirmada')
  loop
    perform app.reuniao_cancelar_interno(r.id, 'Parceiro excluído: ' || v_motivo);
    n_reunioes := n_reunioes + 1;
  end loop;

  perform app.encerrar_matricula(en.id, 'parceiro_excluido')
     from public.cadence_enrollments en
    where en.organization_id = o.id
      and en.status in ('ativa'::app.cadence_status, 'pausada'::app.cadence_status);

  update public.tasks t
     set status = 'cancelled'::app.task_status
   where t.organization_id = o.id
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status);
  get diagnostics n_tarefas = row_count;

  update public.deals d
     set next_action = null, next_action_at = null
   where d.organization_id = o.id
     and d.status in ('open'::app.deal_status, 'paused'::app.deal_status)
     and (d.next_action is not null or d.next_action_at is not null);

  update public.envios_em_massa_itens i
     set status = 'cancelada', motivo = 'parceiro_excluido', processado_em = now()
   where i.organization_id = o.id and i.status = 'pendente';
  get diagnostics n_envios = row_count;

  update public.conversations c
     set organization_id = null,
         deal_id         = null,
         arquivada_em    = coalesce(c.arquivada_em, now()),
         arquivada_por   = coalesce(c.arquivada_por, p_por)
   where c.organization_id = o.id;
  get diagnostics n_conversas = row_count;

  update public.organizations
     set deleted_at = now(), deleted_by = p_por, deleted_reason = left(v_motivo, 500)
   where id = o.id;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (p_por, v_papel, 'EXCLUIR_PARCEIRO', 'organizations', o.id::text,
          jsonb_build_object('name', o.name, 'kind', o.kind),
          jsonb_build_object('motivo', v_motivo, 'reunioes_canceladas', n_reunioes,
                             'tarefas_canceladas', n_tarefas, 'envios_cancelados', n_envios,
                             'conversas_desligadas', n_conversas));

  return jsonb_build_object('ok', true, 'nome', o.name,
                            'reunioes_canceladas', n_reunioes, 'tarefas_canceladas', n_tarefas,
                            'envios_cancelados', n_envios, 'conversas_desligadas', n_conversas);
end $$;
comment on function app.parceiro_excluir_interno(uuid, text, uuid) is
  'O corpo da exclusão de parceiro, sem conferir quem pede: tira de circulação (deleted_at), encerra o pendente e grava quem (p_por; nulo = sistema) e por quê. Recusa cliente e pré-cadastro aberto. Quem confere o papel é public.parceiro_excluir.';
revoke all on function app.parceiro_excluir_interno(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.parceiro_excluir(p_organization_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  -- Só quem cuida da base (pivô de 06/10/2026): admin e gestor.
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  return app.parceiro_excluir_interno(p_organization_id, p_motivo, auth.uid());
end $$;


-- ---------------------------------------------------------------------
-- 3 · A saudação pelo botão
-- ---------------------------------------------------------------------
create or replace function public.saudacao_enfileirar(p_organization_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_ids       uuid[];
  v_lote      uuid;
  v_id        uuid;
  v_tel       text;
  v_ct        uuid;
  v_motivo    text;
  v_item      public.envios_em_massa_itens%rowtype;
  v_pos       int;
  v_entraram  int := 0;
  v_na_frente int;
  v_recusas   jsonb := '{}'::jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  -- Prospectados é de quem cuida da base: admin e gestor.
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  v_ids := array(select distinct x from unnest(coalesce(p_organization_ids, '{}'::uuid[])) x
                  where x is not null);
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'nada_escolhido');
  end if;
  -- Uma página da lista tem 50. Duzentos é folga, e um teto: ninguém dispara a
  -- base inteira com um clique.
  if cardinality(v_ids) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'muitos_de_uma_vez');
  end if;

  -- O disjuntor geral (Ajustes → Atendimento).
  if not app.atendimento_liga('cumprimento_automatico') then
    return jsonb_build_object('ok', false, 'motivo', 'saudacao_desligada');
  end if;
  v_lote := app.cumprimento_lote();
  if v_lote is null then
    return jsonb_build_object('ok', false, 'motivo', 'fila_pausada');
  end if;

  -- Duas pessoas clicando ao mesmo tempo não disputam a mesma posição.
  perform pg_advisory_xact_lock(hashtextextended('saudacao:' || v_lote::text, 0));
  select count(*)::int into v_na_frente
    from public.envios_em_massa_itens i where i.envio_id = v_lote and i.status = 'pendente';

  foreach v_id in array v_ids loop
    v_motivo := null;
    if not exists (select 1 from public.organizations o where o.id = v_id and o.deleted_at is null) then
      v_motivo := 'nao_encontrado';
    else
      select d.telefone, d.contact_id into v_tel, v_ct from app.wa_destino_da_ficha(v_id) d;
      if app.wa_motivo_de_recusa(v_id, v_ct, v_tel) is not null then
        v_motivo := 'nao_contatar';
      -- Saudação é para quem ainda não falou com a gente. Com conversa, o
      -- caminho é a conversa — e isso vem antes de "sem WhatsApp": a ficha
      -- sem número que tem conversa tem número, só que no fio.
      elsif exists (select 1 from public.messages m
                      join public.conversations c on c.id = m.conversation_id
                     where (c.organization_id = v_id or c.peer_phone_e164 = v_tel)
                       and m.status <> 'failed'::app.msg_status) then
        v_motivo := 'ja_conversou';
      elsif v_tel is null then
        v_motivo := 'sem_whatsapp';
      else
        select * into v_item from public.envios_em_massa_itens i
         where i.envio_id = v_lote and i.organization_id = v_id;
        if found and v_item.status = 'pendente' then
          v_motivo := 'ja_na_fila';
        elsif found and v_item.status = 'enviada' then
          v_motivo := 'ja_recebeu';
        else
          select coalesce(max(i.posicao), 0) + 1 into v_pos
            from public.envios_em_massa_itens i where i.envio_id = v_lote;
          -- `select ... into` sem linha deixa o registro todo nulo: `id` diz se havia.
          if v_item.id is not null then
            -- Pulada ou cancelada antes (desfeita, excluída e restaurada): volta.
            update public.envios_em_massa_itens
               set status = 'pendente', posicao = v_pos, motivo = null,
                   processado_em = null, message_id = null
             where id = v_item.id;
          else
            insert into public.envios_em_massa_itens (envio_id, posicao, organization_id, assinante_id)
            values (v_lote, v_pos, v_id, null);
          end if;
          v_entraram := v_entraram + 1;
        end if;
      end if;
    end if;

    if v_motivo is not null then
      v_recusas := v_recusas || jsonb_build_object(
        v_motivo, coalesce((v_recusas ->> v_motivo)::int, 0) + 1);
    end if;
  end loop;

  -- A fila estava ociosa (lote contínuo "em dia" volta a olhar a cada 10 min):
  -- quem acabou de pedir não espera a volta.
  if v_entraram > 0 then
    update public.envios_em_massa
       set proximo_em = least(proximo_em, now())
     where id = v_lote and status = 'agendado';
  end if;

  -- `envios_em_massa_itens` não tem gatilho de auditoria: quem pediu fica aqui.
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, app.role()::text, 'PEDIR_SAUDACAO', 'envios_em_massa', v_lote::text,
          jsonb_build_object('pedidos', cardinality(v_ids), 'entraram', v_entraram,
                             'recusas', v_recusas, 'organizacoes', to_jsonb(v_ids)));

  return jsonb_build_object(
    'ok', true,
    'na_fila', v_entraram,
    'recusados', v_recusas,
    'na_frente', v_na_frente,
    'por_hora', (select e.por_hora from public.envios_em_massa e where e.id = v_lote));
end $$;
comment on function public.saudacao_enfileirar(uuid[]) is
  'O botão de saudação de Prospectados: põe as fichas na fila contínua da saudação ("Bom dia!/Boa tarde!" pela hora do envio), com o ritmo, o horário e a porteira de sempre. Pula, e conta por motivo, quem não tem WhatsApp, pediu para não ser contatado, já conversou, já está na fila ou já recebeu. Respeita o interruptor de Ajustes. Admin e gestor; até 200 por vez.';
revoke all on function public.saudacao_enfileirar(uuid[]) from public, anon;
grant execute on function public.saudacao_enfileirar(uuid[]) to authenticated;

create or replace function public.saudacao_desfazer(p_organization_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- Só o que ainda não saiu. A mensagem que já foi não volta.
  update public.envios_em_massa_itens i
     set status = 'cancelada', motivo = 'desfeito', processado_em = now()
    from public.envios_em_massa e
   where e.id = i.envio_id and e.continuo
     and i.status = 'pendente'
     and i.organization_id = any (coalesce(p_organization_ids, '{}'::uuid[]));
  get diagnostics v_n = row_count;

  if v_n > 0 then
    insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
    values (v_uid, app.role()::text, 'DESFAZER_SAUDACAO', 'envios_em_massa_itens', 'fila-da-saudacao',
            jsonb_build_object('tiradas', v_n, 'organizacoes', to_jsonb(p_organization_ids)));
  end if;
  return jsonb_build_object('ok', true, 'tiradas', v_n);
end $$;
comment on function public.saudacao_desfazer(uuid[]) is
  'O "Desfazer" do botão de saudação: tira da fila contínua o que destas fichas ainda não saiu. Admin e gestor.';
revoke all on function public.saudacao_desfazer(uuid[]) from public, anon;
grant execute on function public.saudacao_desfazer(uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- 4 · A limpeza: quem não tem número sai de Prospectados
-- ---------------------------------------------------------------------
-- Uma função, e não um bloco solto, para o pgTAP exercitar o mesmo código que
-- roda em produção. Sem `grant`: só a migração (e quem já é dono do banco) a
-- chama. Devolve quantas saíram e, por motivo, quantas ficaram.
create or replace function app.limpar_sem_numero(p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v       jsonb;
  n_saiu  int := 0;
  v_ficou jsonb := '{}'::jsonb;
begin
  for r in
    select o.id
      from public.organizations o
     where o.deleted_at is null
       and o.anonymized_at is null
       and (select d.telefone from app.wa_destino_da_ficha(o.id) d) is null
       and not exists (select 1 from public.conversations c where c.organization_id = o.id)
     order by o.created_at
  loop
    v := app.parceiro_excluir_interno(r.id, p_motivo, null);
    if (v ->> 'ok')::boolean then
      n_saiu := n_saiu + 1;
    else
      v_ficou := v_ficou || jsonb_build_object(
        v ->> 'motivo', coalesce((v_ficou ->> (v ->> 'motivo'))::int, 0) + 1);
    end if;
  end loop;
  return jsonb_build_object('excluidas', n_saiu, 'ficaram', v_ficou);
end $$;
comment on function app.limpar_sem_numero(text) is
  'Exclui (app.parceiro_excluir_interno, assinado pelo sistema) toda ficha sem telefone na ficha, sem telefone em pessoa de contato e sem conversa. Cliente e pré-cadastro aberto ficam. Rodada pela migração de 07/10/2026.';
revoke all on function app.limpar_sem_numero(text) from public, anon, authenticated;

-- Banco novo não tem ficha nenhuma aqui, e a chamada não faz nada.
do $$
declare
  v jsonb := app.limpar_sem_numero(
               'Sem telefone nem WhatsApp: saiu na limpeza de Prospectados de 07/10/2026');
begin
  raise notice 'limpeza de Prospectados: % ficha(s) sem número excluída(s); ficaram, por motivo: %',
    v ->> 'excluidas', v -> 'ficaram';
end $$;

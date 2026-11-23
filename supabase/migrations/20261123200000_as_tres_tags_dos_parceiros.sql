-- =====================================================================
-- As três tags dos Parceiros da Imova (23/11/2026)
--
-- Pedido do usuário: "Quero conseguir filtrar e categorizar todas as pessoas
-- que tenho contato no CRM da Imova. Hoje lá dentro eu tenho contatos que são
-- parceiros e devem ser divididos entre: Proprietário, Colaborador, Inquilino.
-- Essas são as tags que os parceiros devem ter. Já os clientes devem ter a
-- placa de prospecção (que já possuem)."
--
-- Clientes e Parceiros (20261123120000, mesmo dia) guardava o tipo da parceria
-- em `public.consultoria.tipo`, com quatro valores (inquilino, proprietario,
-- comprador, outro) e opcional no botão de Prospectados. Agora:
--
--   * os valores são TRÊS: proprietario, colaborador, inquilino. Comprador e
--     Outro saem (em produção, em 23/11/2026, ninguém era Parceiro: nada a
--     converter). Se alguma linha ainda tiver um dos dois, ela fica SEM TAG
--     (nula), e a tela mostra "Sem tag" para alguém escolher;
--   * todo Parceiro novo tem tag. `public.parceiro_mudar` passa a exigir;
--     `public.consultoria_marcar` (o botão de Prospectados) deixa de pôr a
--     marca sem tag na Imova: quem põe vários de uma vez com a tag é a nova
--     `public.parceiros_marcar`. Tirar a marca (voltar para Clientes) continua
--     pelas duas de antes;
--   * os Clientes não mudam: a placa deles é o canal de chegada (Placa,
--     Anúncios, Redes sociais...), que já tem filtro em Conversas.
--
-- Na KOMUNE só a regra da coluna muda (lá a coluna é sempre nula).
--
-- COMO DESFAZER: reaplicar a regra `consultoria_tipo_valido` e
-- `public.parceiro_mudar` da 20261123120000 e `public.consultoria_marcar` da
-- 20261014100000; `drop function public.parceiros_marcar(uuid[], text)`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. As três tags (nas duas empresas)
-- ---------------------------------------------------------------------
alter table public.consultoria drop constraint if exists consultoria_tipo_valido;

update public.consultoria set tipo = null where tipo in ('comprador', 'outro');

alter table public.consultoria
  add constraint consultoria_tipo_valido
  check (tipo is null or tipo in ('proprietario', 'colaborador', 'inquilino'));

comment on column public.consultoria.tipo is
  'A tag do Parceiro (Imova): proprietario, colaborador ou inquilino (23/11/2026; antes havia comprador e outro). Nulo = sem tag (marca de antes de 23/11, ou a KOMUNE).';

do $imova$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'As tags dos Parceiros são da Imova: no banco da KOMUNE só a regra da coluna mudou.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 2. Mudar o perfil de uma ficha: a tag passa a ser obrigatória
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.parceiro_mudar(
  p_organization_id uuid,
  p_parceiro        boolean,
  p_tipo            text default null,
  p_anuncio_id      uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_antes public.consultoria%rowtype;
  v_era   boolean;
  v_tipo  text := nullif(btrim(coalesce(p_tipo, '')), '');
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_organization_id is null or not exists (
       select 1 from public.organizations o
        where o.id = p_organization_id and o.deleted_at is null) then
    return jsonb_build_object('ok', false, 'motivo', 'ficha_inexistente');
  end if;

  select * into v_antes from public.consultoria where organization_id = p_organization_id;
  v_era := found;

  if not coalesce(p_parceiro, true) then
    -- Voltar para Clientes: a linha sai. Quem já era Cliente fica como está.
    if not v_era then
      return jsonb_build_object('ok', true, 'mudou', false, 'perfil', 'cliente');
    end if;
    delete from public.consultoria where organization_id = p_organization_id;
    insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data)
    values (v_uid, app.role()::text, 'VOLTOU_PARA_CLIENTES', 'consultoria',
            p_organization_id::text, to_jsonb(v_antes));
    return jsonb_build_object('ok', true, 'mudou', true, 'perfil', 'cliente');
  end if;

  -- Todo Parceiro tem uma das três tags (23/11/2026).
  if v_tipo is null then
    return jsonb_build_object('ok', false, 'motivo', 'falta_a_tag');
  end if;
  if v_tipo not in ('proprietario', 'colaborador', 'inquilino') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;
  if p_anuncio_id is not null and not exists (
       select 1 from public.anuncios a where a.id = p_anuncio_id and a.excluido_em is null) then
    return jsonb_build_object('ok', false, 'motivo', 'anuncio_invalido');
  end if;

  -- Virar Parceiro, ou corrigir a tag e o imóvel de quem já é: "desde" e
  -- "por" ficam os da primeira vez.
  insert into public.consultoria (organization_id, por, tipo, anuncio_id)
  values (p_organization_id, v_uid, v_tipo, p_anuncio_id)
  on conflict (organization_id) do update
     set tipo = excluded.tipo,
         anuncio_id = excluded.anuncio_id;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (v_uid, app.role()::text,
          case when v_era then 'PARCERIA_CORRIGIDA' else 'VIROU_PARCEIRO' end,
          'consultoria', p_organization_id::text,
          case when v_era then to_jsonb(v_antes) end,
          jsonb_build_object('tipo', v_tipo, 'anuncio_id', p_anuncio_id));
  return jsonb_build_object('ok', true, 'mudou', true, 'perfil', 'parceiro', 'era_parceiro', v_era);
end $$;
comment on function public.parceiro_mudar(uuid, boolean, text, uuid) is
  'Imova: muda o perfil de uma ficha nas Conversas. p_parceiro = true põe (ou corrige) a marca de Parceiro em public.consultoria com a tag (proprietario, colaborador ou inquilino, obrigatória desde 23/11/2026) e o anúncio; false volta para Clientes. Admin, gestor e SDR (app.is_manager); auditado. Não mexe em etapa nem em relatório.';
revoke all on function public.parceiro_mudar(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.parceiro_mudar(uuid, boolean, text, uuid) to authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 3. Vários de uma vez, com a tag (o botão de Prospectados)
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.parceiros_marcar(p_organization_ids uuid[], p_tipo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_ids  uuid[];
  v_tipo text := nullif(btrim(coalesce(p_tipo, '')), '');
  v_n    int := 0;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if v_tipo is null then
    return jsonb_build_object('ok', false, 'motivo', 'falta_a_tag');
  end if;
  if v_tipo not in ('proprietario', 'colaborador', 'inquilino') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;
  v_ids := array(select distinct x from unnest(coalesce(p_organization_ids, '{}'::uuid[])) x
                  where x is not null);
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'nada_escolhido');
  end if;
  if cardinality(v_ids) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'muitos_de_uma_vez');
  end if;

  -- Quem não era Parceiro vira, com a tag; quem já era fica com a tag nova (o
  -- imóvel, "desde" e "por" ficam). Quem já tinha essa tag não conta.
  insert into public.consultoria (organization_id, por, tipo)
  select o.id, v_uid, v_tipo from public.organizations o
   where o.id = any (v_ids) and o.deleted_at is null
  on conflict (organization_id) do update
     set tipo = excluded.tipo
   where public.consultoria.tipo is distinct from excluded.tipo;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
    values (v_uid, app.role()::text, 'PARCEIROS_MARCADOS', 'consultoria', 'consultoria',
            jsonb_build_object('quantos', v_n, 'tipo', v_tipo, 'organizacoes', to_jsonb(v_ids)));
  end if;
  return jsonb_build_object('ok', true, 'mudaram', v_n);
end $$;
comment on function public.parceiros_marcar(uuid[], text) is
  'Imova, 23/11/2026: põe vários contatos em Parceiros com a mesma tag (proprietario, colaborador ou inquilino), ou troca a tag de quem já é. Admin, gestor e SDR; até 200 por vez; auditado. Voltar para Clientes é public.consultoria_marcar(ids, false).';
revoke all on function public.parceiros_marcar(uuid[], text) from public, anon;
grant execute on function public.parceiros_marcar(uuid[], text) to authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 4. O botão antigo não põe mais Parceiro sem tag (tirar continua)
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.consultoria_marcar(p_organization_ids uuid[], p_sim boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_ids  uuid[];
  v_n    int := 0;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  -- Na Imova, todo Parceiro tem tag (23/11/2026): pôr é com public.parceiros_marcar.
  if coalesce(p_sim, true) then
    return jsonb_build_object('ok', false, 'motivo', 'falta_a_tag');
  end if;
  v_ids := array(select distinct x from unnest(coalesce(p_organization_ids, '{}'::uuid[])) x
                  where x is not null);
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'nada_escolhido');
  end if;
  if cardinality(v_ids) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'muitos_de_uma_vez');
  end if;

  delete from public.consultoria c where c.organization_id = any (v_ids);
  get diagnostics v_n = row_count;

  if v_n > 0 then
    insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
    values (v_uid, app.role()::text, 'TIRAR_DA_CONSULTORIA', 'consultoria', 'consultoria',
            jsonb_build_object('quantos', v_n, 'organizacoes', to_jsonb(v_ids)));
  end if;
  return jsonb_build_object('ok', true, 'mudaram', v_n);
end $$;
comment on function public.consultoria_marcar(uuid[], boolean) is
  'Imova: tira contatos de Parceiros (p_sim = false), de volta para Clientes. Pôr em Parceiros pede a tag desde 23/11/2026: public.parceiros_marcar (vários) ou public.parceiro_mudar (um). Admin, gestor e SDR; até 200 por vez; auditado.';
revoke all on function public.consultoria_marcar(uuid[], boolean) from public, anon;
grant execute on function public.consultoria_marcar(uuid[], boolean) to authenticated;
  $ddl$;
end $imova$;

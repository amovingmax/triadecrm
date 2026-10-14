-- =====================================================================
-- O funil recomeça, e a Consultoria ganha botão
--
-- Pedido de 14/10/2026, com o print do quadro (120 negócios em Captação de
-- fornecedor, 90 em Respondeu, quase todos "Parado há 5d"): "limpe esses
-- funis, deixe a opção de selecionar em que etapa do funil o lead está na aba
-- de conversas e na aba de prospectados, coloque um botão que eu consiga
-- direcionar leads em prospectados para a aba de consultorias em conversas,
-- não sei como isso tá funcionando".
--
-- Perguntado o que "limpar" queria dizer, a resposta foi as quatro coisas, e
-- é o que esta migração faz, nesta ordem:
--
--   1. SÓ O VISUAL — "Respondeu" deixa de contar como parado depois de 1 hora.
--      O SLA era o "responda em 15 minutos" do PRD guardado como 1 h por
--      granularidade, e com o bom-dia e o aviso de ligação trazendo dezenas de
--      respostas por dia, a coluna inteira nascia vermelha. Passa a 24 h.
--   2. AS FICHAS DE TESTE saem, pela exclusão de sempre (dá para restaurar):
--      "Matheus Rondon" e toda ficha com a palavra "teste" no nome.
--   3. O QUADRO ESVAZIA: todo negócio ABERTO dos dois funis de captação volta à
--      etapa de entrada (Prospectado / Identificado) e sai do quadro; mora em
--      Prospectados até alguém dizer em que etapa ele está — com o seletor
--      novo, em Prospectados ou em Conversas. Ganho, perdido, opt-out e
--      nutrição ficam onde estão: são decisões, não fila. O histórico de cada
--      negócio guarda o movimento, com o motivo.
--
-- E a CONSULTORIA (a aba de pós-venda em Conversas): até aqui só entrava nela
-- quem tinha negócio ganho ou etapa de cliente — na prática, "Publicado
-- (ganho)" no funil de fornecedor. A escolha foi uma MARCA PRÓPRIA:
-- `public.consultoria`, uma linha por parceiro, posta e tirada por botão
-- (`public.consultoria_marcar`). Não mexe na etapa e não conta como publicado
-- nos relatórios e nas metas.
--
-- RF-FUN-01, RF-FUN-02, RF-FUN-08, RF-BAS-10, RF-CON-05
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · "Respondeu" para de nascer vermelho
-- ---------------------------------------------------------------------
update public.stages s
   set sla_hours = 24
  from public.pipelines p
 where p.id = s.pipeline_id
   and p.slug in ('fornecedor', 'produtor')
   and s.slug = 'respondeu'
   and s.sla_hours is distinct from 24;


-- ---------------------------------------------------------------------
-- 2 · A Consultoria como marca
-- ---------------------------------------------------------------------
create table if not exists public.consultoria (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  desde           timestamptz not null default now(),
  por             uuid references public.profiles (id) on delete set null
);
alter table public.consultoria enable row level security;
comment on table public.consultoria is
  'Quem está na aba Consultoria de Conversas por decisão de alguém (14/10/2026), além de quem tem negócio ganho. Uma linha por parceiro; quem põe e tira é public.consultoria_marcar. Não mexe em etapa nem em relatório.';

-- Leitura: quem vê Conversas e Prospectados (a gestão). Escrita só pela função.
drop policy if exists consultoria_select on public.consultoria;
create policy consultoria_select on public.consultoria
  for select to authenticated using ((select app.is_manager()));

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
  v_ids := array(select distinct x from unnest(coalesce(p_organization_ids, '{}'::uuid[])) x
                  where x is not null);
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'nada_escolhido');
  end if;
  if cardinality(v_ids) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'muitos_de_uma_vez');
  end if;

  if coalesce(p_sim, true) then
    insert into public.consultoria (organization_id, por)
    select o.id, v_uid from public.organizations o
     where o.id = any (v_ids) and o.deleted_at is null
    on conflict (organization_id) do nothing;
  else
    delete from public.consultoria c where c.organization_id = any (v_ids);
  end if;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
    values (v_uid, app.role()::text,
            case when coalesce(p_sim, true) then 'MANDAR_PARA_CONSULTORIA' else 'TIRAR_DA_CONSULTORIA' end,
            'consultoria', 'consultoria',
            jsonb_build_object('quantos', v_n, 'organizacoes', to_jsonb(v_ids)));
  end if;
  return jsonb_build_object('ok', true, 'mudaram', v_n);
end $$;
comment on function public.consultoria_marcar(uuid[], boolean) is
  'Põe (p_sim) ou tira parceiros da aba Consultoria de Conversas. Não mexe na etapa do funil. Admin e gestor; até 200 por vez; auditado.';
revoke all on function public.consultoria_marcar(uuid[], boolean) from public, anon;
grant execute on function public.consultoria_marcar(uuid[], boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 3 · As fichas de teste
-- ---------------------------------------------------------------------
-- Pela exclusão interna (20261007130000), assinada pelo sistema: a ficha sai de
-- circulação e aparece em Prospectados → Excluídos com o motivo.
create or replace function app.limpar_fichas_de_teste(p_motivo text)
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
    select o.id from public.organizations o
     where o.deleted_at is null
       and o.anonymized_at is null
       -- `search_name` é o nome sem acento e em minúsculas (app.search_name).
       and (o.search_name = 'matheus rondon'
            or o.search_name ~ '(^|[^a-z])teste([^a-z]|$)')
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
comment on function app.limpar_fichas_de_teste(text) is
  'Exclui (reversível) as fichas de teste: "Matheus Rondon" e toda ficha com a palavra "teste" no nome. Rodada pela migração de 14/10/2026.';
revoke all on function app.limpar_fichas_de_teste(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4 · O quadro esvazia
-- ---------------------------------------------------------------------
create or replace function app.esvaziar_quadro(p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_por_etapa jsonb;
  v_n         int := 0;
begin
  -- Contado antes, para o recibo dizer de onde saiu cada um.
  select coalesce(jsonb_object_agg(x.etapa, x.n), '{}'::jsonb) into v_por_etapa
    from (select p.slug || '/' || s.slug as etapa, count(*)::int as n
            from public.deals d
            join public.stages s on s.id = d.stage_id
            join public.pipelines p on p.id = d.pipeline_id
            join public.organizations o on o.id = d.organization_id and o.deleted_at is null
           where d.status = 'open'::app.deal_status
             and p.slug in ('fornecedor', 'produtor')
             and not s.is_entry
           group by 1) x;

  update public.deals d
     set stage_id = e.id,
         stage_change_reason = left(p_motivo, 300)
    from public.stages s, public.pipelines p, public.stages e, public.organizations o
   where s.id = d.stage_id
     and p.id = d.pipeline_id
     and e.pipeline_id = d.pipeline_id and e.is_entry
     and o.id = d.organization_id and o.deleted_at is null
     and d.status = 'open'::app.deal_status
     and p.slug in ('fornecedor', 'produtor')
     and not s.is_entry;
  get diagnostics v_n = row_count;

  return jsonb_build_object('voltaram', v_n, 'de_onde', v_por_etapa);
end $$;
comment on function app.esvaziar_quadro(text) is
  'Leva todo negócio ABERTO dos funis de captação de volta à etapa de entrada (Prospectado/Identificado), com o motivo no histórico. Ganho, perdido, opt-out e nutrição não são tocados. Rodada pela migração de 14/10/2026.';
revoke all on function app.esvaziar_quadro(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 5 · A limpeza, agora
-- ---------------------------------------------------------------------
-- Banco novo não tem ficha nem negócio aqui, e as duas chamadas não fazem nada.
do $$
declare
  v_testes jsonb := app.limpar_fichas_de_teste(
                      'Ficha de teste: saiu na limpeza dos funis de 14/10/2026');
  v_quadro jsonb := app.esvaziar_quadro(
                      'Quadro esvaziado na limpeza dos funis de 14/10/2026: volta a Prospectados até alguém dizer a etapa');
begin
  raise notice 'limpeza dos funis: % ficha(s) de teste excluída(s) (ficaram: %); % negócio(s) de volta a Prospectados, vindos de %',
    v_testes ->> 'excluidas', v_testes -> 'ficaram', v_quadro ->> 'voltaram', v_quadro -> 'de_onde';
end $$;

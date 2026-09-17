-- =====================================================================
-- Conserto: `radar_repontuar` e `radar_agendar_coleta` recusavam o worker
--
-- Escrevi as duas checando `app.role() not in ('admin','gestor')`, com um `if`
-- antes para "deixar passar quem não tem JWT". O raciocínio tinha um furo que só
-- aparece em produção: o service_role TEM JWT. O PostgREST põe a claim `role`, e
-- `app.role()` — que lê `app_metadata.app_role`, uma claim de PESSOA — não acha
-- nada e devolve `leitura`. Resultado: o worker e qualquer chamada de serviço
-- eram barrados pela própria função que existe para servi-los.
--
-- O sintoma foi imediato e mudo: repontuar os 277 candidatos do Radar em
-- produção devolveu "Papel leitura não repontua o Radar".
--
-- O CRM já tinha a resposta desde o D4 — `app.e_o_worker()`, que lê a claim
-- `role` do JWT e existe com este comentário: "em security definer o
-- current_user já é o dono da função". Era ela que eu devia ter usado.
-- =====================================================================

create or replace function public.radar_repontuar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
begin
  if not app.e_o_worker()
     and app.role() not in ('admin'::app.user_role, 'gestor'::app.user_role) then
    raise exception 'Papel % não repontua o Radar', app.role() using errcode = '42501';
  end if;

  with conta as (
    select c.id, app.radar_pontuar(c.*) as p
      from public.supplier_candidates c
     where c.status = 'novo'::app.candidate_status
  )
  update public.supplier_candidates c
     set score = (conta.p ->> 'score')::smallint,
         tier  = conta.p ->> 'tier'
    from conta
   where c.id = conta.id;

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'candidatos', v_n);
end $$;

comment on function public.radar_repontuar() is
  'Recalcula score e tier de todos os candidatos esperando revisão, com os pesos atuais de radar.triagem. Chamada pela tela quando alguém muda os pesos, e pelo worker depois de cada coleta. Admin, gestor e service_role.';

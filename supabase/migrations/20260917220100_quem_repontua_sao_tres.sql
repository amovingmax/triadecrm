-- =====================================================================
-- Conserto do conserto: quem repontua o Radar são TRÊS, não dois
--
-- A migração anterior consertou o worker (que era barrado pela própria função
-- que existe para servi-lo) e, no mesmo movimento, quebrou o terceiro caso: quem
-- chama SEM JWT nenhum — `psql`, uma migração, o `pg_cron`. Para esses,
-- `app.e_o_worker()` é falso (não há claim `role`) e `app.role()` devolve
-- `leitura`, então a função passou a recusar o próprio banco.
--
-- Quem pegou foi o pgTAP 55, que chama `radar_repontuar` fora de qualquer papel
-- — e é assim que ele deve chamar, porque testar a regra de papel exige poder
-- rodar sem papel.
--
-- Os três casos, agora explícitos na ordem em que a pergunta se faz:
--   1. não há JWT   → é o banco falando com ele mesmo (migração, cron, psql);
--   2. é o worker   → service_role, pela claim que o PostgREST põe;
--   3. é gente      → admin ou gestor, porque mexer na ordem da fila muda o
--                     trabalho de todo mundo.
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
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and not app.e_o_worker()
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

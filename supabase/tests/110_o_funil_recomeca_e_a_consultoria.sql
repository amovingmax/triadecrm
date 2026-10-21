-- =====================================================================
-- pgTAP — O funil recomeça, e a Consultoria ganha botão (migração 20261014100000)
--
--   1. "Respondeu" só fica parado depois de 24 h, nos dois funis;
--   2. as fichas de teste saem pela exclusão de sempre (reversível);
--   3. o quadro esvazia: todo negócio ABERTO volta à etapa de entrada, com o
--      motivo no histórico; ganho, perdido e nutrição ficam;
--   4. a Consultoria é uma marca: põe, tira, não mexe na etapa, só a gestão
--      marca, e quem vê a base (o SDR também, desde 20/10/2026) lê.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(22);

create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000011001'::uuid $$;
create function pg_temp.ana() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000011002'::uuid $$;
create function pg_temp.org(p text) returns uuid language sql immutable as $$
  select ('c0000000-0000-4000-8000-0000000110' || p)::uuid
$$;
create function pg_temp.neg(p text) returns uuid language sql immutable as $$
  select ('e0000000-0000-4000-8000-0000000110' || p)::uuid
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_slug
$$;
create function pg_temp.etapa_de(p text) returns text language sql security definer set search_path = '' as $$
  select s.slug from public.deals d join public.stages s on s.id = d.stage_id
   where d.id = ('e0000000-0000-4000-8000-0000000110' || p)::uuid
$$;

insert into public.allowed_users (email, role, note) values
  ('f110.g@teste.local', 'gestor', 'pgTAP 110'), ('f110.a@teste.local', 'sdr', 'pgTAP 110');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gil(), 'f110.g@teste.local', '{"full_name":"Gil Gestor"}'),
  (pg_temp.ana(), 'f110.a@teste.local', '{"full_name":"Ana Freela"}');

--   01 Respondeu   02 Reunião marcada (com data)   03 Contatado, produtor
--   04 Publicado (ganho)   05 Perdido   06 Nutrição   07 Prospectado
--   08 "Buffet Teste da Ana" (teste)   09 "Matheus Rondon" (teste)   10 "Contestação Eventos" (não é teste)
insert into public.organizations (id, name, phone_e164, source_id, owner_id)
select pg_temp.org(x.n), x.nome, '+55849991100' || x.n,
       (select id from public.sources where slug = 'captura_campo'), pg_temp.gil()
  from (values ('01', 'F110 Respondeu'), ('02', 'F110 Reuniao'), ('03', 'F110 Produtor'),
               ('04', 'F110 Ganho'), ('05', 'F110 Perdido'), ('06', 'F110 Nutricao'),
               ('07', 'F110 Prospectado'), ('08', 'Buffet Teste da Ana'), ('09', 'Matheus Rondon'),
               ('10', 'Contestação Eventos')) x(n, nome);
insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id, lost_reason_id, next_action_at)
select pg_temp.neg(x.n), pg_temp.org(x.n), (select id from public.pipelines where slug = x.funil),
       pg_temp.etapa(x.funil, x.etapa), pg_temp.gil(),
       case when x.etapa = 'perdido' then (select min(id) from public.lost_reasons) end,
       case when x.etapa = 'reuniao_marcada' then now() + interval '2 days' end
  from (values ('01', 'fornecedor', 'respondeu'), ('02', 'fornecedor', 'reuniao_marcada'),
               ('03', 'produtor', 'contatado'), ('04', 'fornecedor', 'publicado'),
               ('05', 'fornecedor', 'perdido'), ('06', 'fornecedor', 'nutricao'),
               ('07', 'fornecedor', 'prospectado'), ('08', 'fornecedor', 'respondeu'),
               ('09', 'fornecedor', 'contatado'), ('10', 'fornecedor', 'respondeu')) x(n, funil, etapa);

-- =====================================================================
-- 1. O prazo de Respondeu
-- =====================================================================
select is((select count(*)::int from public.stages s join public.pipelines p on p.id = s.pipeline_id
            where s.slug = 'respondeu' and p.slug in ('fornecedor', 'produtor') and s.sla_hours = 24),
  2, 'Respondeu só conta como parado depois de 24 h, nos dois funis');

-- =====================================================================
-- 2. As fichas de teste
-- =====================================================================
create temp table t110 as select app.limpar_fichas_de_teste('pgTAP: teste') as v;
select is((select deleted_at is not null from public.organizations where id = pg_temp.org('08')), true,
  '"teste" no nome: sai');
select is((select deleted_at is not null from public.organizations where id = pg_temp.org('09')), true,
  '"Matheus Rondon": sai');
select is((select deleted_at is not null from public.organizations where id = pg_temp.org('10')), false,
  '"Contestação" não é "teste": fica');
select is((select deleted_reason from public.organizations where id = pg_temp.org('08')), 'pgTAP: teste',
  'e quem saiu guarda o motivo (aparece em Excluídos)');

-- =====================================================================
-- 3. O quadro esvazia
-- =====================================================================
create temp table q110 as select app.esvaziar_quadro('pgTAP: quadro esvaziado') as v;
select is(pg_temp.etapa_de('01'), 'prospectado', 'Respondeu volta para Prospectado');
select is(pg_temp.etapa_de('02'), 'prospectado', 'Reunião marcada também volta');
select is(pg_temp.etapa_de('03'), 'identificado', 'no funil produtor, a volta é para Identificado');
select is(pg_temp.etapa_de('10'), 'prospectado', 'e a ficha que não era teste também volta');
select is(pg_temp.etapa_de('04'), 'publicado', 'ganho fica onde está');
select is(pg_temp.etapa_de('05'), 'perdido', 'perdido fica');
select is(pg_temp.etapa_de('06'), 'nutricao', 'nutrição fica');
select is(pg_temp.etapa_de('08'), 'respondeu', 'a ficha excluída não é mexida');
select is((select h.reason from public.deal_stage_history h where h.deal_id = pg_temp.neg('01')
            order by h.id desc limit 1), 'pgTAP: quadro esvaziado',
  'o histórico do negócio guarda o motivo');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is((select count(*)::int from jsonb_array_elements(public.pipeline_board(
             (select id from public.pipelines where slug = 'fornecedor'), false, null, 'f110') -> 'stages') s,
                jsonb_array_elements(s -> 'cards') c
            where c ->> 'organization_name' like 'F110 R%'),
  0, 'quem voltou some do quadro (mora em Prospectados)');

-- =====================================================================
-- 4. A Consultoria
-- =====================================================================
select is((public.consultoria_marcar(array[pg_temp.org('01'), pg_temp.org('07')], true) ->> 'mudaram')::int, 2,
  'a gestão manda dois para a Consultoria');
select is(pg_temp.etapa_de('01'), 'prospectado', 'sem mexer na etapa');
select is((public.consultoria_marcar(array[pg_temp.org('01')], true) ->> 'mudaram')::int, 0,
  'mandar de novo não duplica');
select is((public.consultoria_marcar(array[pg_temp.org('07')], false) ->> 'mudaram')::int, 1,
  'e tira de volta');
select pg_temp.entrar(pg_temp.ana(), 'sdr');
select is(public.consultoria_marcar(array[pg_temp.org('01')], false) ->> 'motivo', 'sem_permissao',
  'quem liga não mexe na Consultoria');
-- 20261020200000: o SDR voltou a ver Conversas, e a aba Consultoria lê a tabela.
select is((select count(*)::int from public.consultoria where organization_id = pg_temp.org('01')), 1,
  'mas o SDR LÊ a marca (a aba Consultoria de Conversas não vem vazia para ele)');
select pg_temp.sair();
select pg_temp.entrar(gen_random_uuid(), 'embaixador');
select is((select count(*)::int from public.consultoria), 0,
  'quem não vê a base não lê a marca');
select pg_temp.sair();

select * from finish();
rollback;

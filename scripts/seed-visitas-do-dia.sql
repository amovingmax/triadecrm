-- =====================================================================
-- TRIADE — carga de DESENVOLVIMENTO: as visitas de uma tarde.
--
-- Para que serve: exercitar e fotografar a rota da tarde (RF-ROT-03) com
-- tarefas de visita de verdade sobre as 100 organizações reais do R09. A
-- base do CRM não tem tarefa nenhuma hoje (`select count(*) from tasks` = 0),
-- e sem visita não há rota para montar.
--
-- NÃO É SEED DE PRODUTO. A seed oficial é `supabase/seed.sql`. Esta carga é
-- local, reaplicável, e apaga só o que ela mesma criou: as tarefas nascem com
-- id determinístico no prefixo `d0000000-...-e0NN`, que é a marca de limpeza.
-- (`tasks.origin` não serve de marca: o CHECK da tabela só aceita manual,
-- cadence, ai e system, e afrouxá-lo para caber um seed seria trocar uma
-- regra do produto por conveniência de desenvolvimento.)
--
-- O que monta, de propósito, é um dia com os quatro casos que a tela precisa
-- saber desenhar:
--   · visitas em bairros diferentes de Natal, com coordenada de bairro;
--   · uma visita numa ficha SUPRIMIDA depois de a tarefa nascer — o caso que
--     o dreno da Komune deixou passar (20260905000100) e que a rota reconfere;
--   · uma visita numa organização com precisão só de cidade (RF-ROT-01);
--   · uma visita numa ficha APAGADA depois de a tarefa nascer.
-- As três últimas TÊM de ficar fora da rota, e a tela tem de dizer por quê.
--
-- Uso:
--   docker exec -i supabase_db_komune-crm psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < scripts/seed-visitas-do-dia.sql
-- =====================================================================
set client_encoding = 'UTF8';
set timezone = 'America/Fortaleza';

begin;

-- ---------------------------------------------------------------------
-- 1. Limpeza do que esta carga criou antes
-- ---------------------------------------------------------------------
delete from public.route_stops s
 using public.route_plans p where p.id = s.plan_id
   and p.plan_date = (now() at time zone 'America/Fortaleza')::date;
delete from public.route_plans
 where plan_date = (now() at time zone 'America/Fortaleza')::date;
delete from public.tasks
 where id::text like 'd0000000-0000-4000-8000-00000000e0%';
delete from public.suppression_list where reason = 'seed-visitas-dia';
update public.organizations set do_not_contact = false, deleted_at = null
 where custom ? 'seed_visitas_dia';
update public.organizations set custom = custom - 'seed_visitas_dia'
 where custom ? 'seed_visitas_dia';

-- ---------------------------------------------------------------------
-- 2. As pessoas de desenvolvimento (mesmo bloco do seed-dev-5k.sql)
--    Sem senha nem identidade OAuth: quem entra de verdade é o usuário que
--    `apps/web/scripts/sessao-dev.mjs` prepara pela API de admin.
-- ---------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email, '', now(),
  now(), now(), '{"provider":"google","providers":["google"]}'::jsonb,
  jsonb_build_object('full_name', u.nome),
  '', '', '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000d01'::uuid, 'heloisa.dev@komune.app.br', 'Heloísa Cavalcanti'),
  ('d0000000-0000-4000-8000-000000000d03'::uuid, 'matheus.dev@komune.app.br',  'Matheus Rondon')
) as u(id, email, nome)
where not exists (select 1 from auth.users a where a.email = u.email);

-- ---------------------------------------------------------------------
-- 3. As visitas da tarde, em bairros diferentes
--
-- Uma por bairro, na ordem de horário que a agenda mostraria — que NÃO é a
-- ordem de menor tempo de carro. É isso que a rota existe para arrumar.
-- ---------------------------------------------------------------------
create temporary table _visita (
  bairro text primary key, hora time, titulo text) on commit drop;

insert into _visita values
  ('Ponta Negra',    '14:00', 'Visita: apresentar a Komune'),
  ('Potengi',        '14:30', 'Visita: apresentar a Komune'),
  ('Capim Macio',    '15:00', 'Visita: retomar conversa'),
  ('Tirol',          '15:30', 'Visita: apresentar a Komune'),
  ('Alecrim',        '16:00', 'Visita: levar material'),
  ('Lagoa Nova',     '16:30', 'Visita: apresentar a Komune'),
  ('Candelária',     '17:00', 'Visita: retomar conversa');

-- Uma organização por bairro: a primeira em ordem de nome, para a carga ser
-- determinística entre máquinas.
create temporary table _alvo (bairro text primary key, org uuid, hora time, titulo text)
  on commit drop;
insert into _alvo
select v.bairro, o.id, v.hora, v.titulo
  from _visita v
  join lateral (
    select id from public.organizations
     where deleted_at is null and neighborhood = v.bairro
     order by name limit 1
  ) o on true;

insert into public.tasks (id, title, kind, status, priority, due_at, assignee_id,
                          organization_id, deal_id, created_by, origin)
select ('d0000000-0000-4000-8000-00000000e0' ||
        lpad((row_number() over (order by a.hora))::text, 2, '0'))::uuid,
       a.titulo, 'visit'::app.task_kind, 'todo'::app.task_status, 2,
       ((now() at time zone 'America/Fortaleza')::date + a.hora)
         at time zone 'America/Fortaleza',
       'd0000000-0000-4000-8000-000000000d01'::uuid,
       a.org, d.id,
       'd0000000-0000-4000-8000-000000000d01'::uuid,
       'manual'
  from _alvo a
  left join lateral (
    select id from public.deals where organization_id = a.org
     order by created_at limit 1
  ) d on true;

-- Uma visita numa organização sem bairro (precisão só de cidade, RF-ROT-01).
insert into public.tasks (id, title, kind, status, priority, due_at, assignee_id,
                          organization_id, deal_id, created_by, origin)
select 'd0000000-0000-4000-8000-00000000e099'::uuid,
       'Visita: confirmar endereço', 'visit'::app.task_kind, 'todo'::app.task_status, 2,
       ((now() at time zone 'America/Fortaleza')::date + time '17:30')
         at time zone 'America/Fortaleza',
       'd0000000-0000-4000-8000-000000000d01'::uuid,
       o.id, d.id,
       'd0000000-0000-4000-8000-000000000d01'::uuid,
       'manual'
  from (select id from public.organizations
         where deleted_at is null and geo_precision = 'cidade'::app.geo_precision
         order by name limit 1) o
  left join lateral (select id from public.deals where organization_id = o.id
                      order by created_at limit 1) d on true;

-- ---------------------------------------------------------------------
-- 4. O mundo muda DEPOIS de as tarefas nascerem
--
-- É a linha do tempo do 20260905000100: a tarefa nasceu válida, e entre a
-- criação e a tarde a pessoa pediu para sair e outra ficha foi apagada.
-- Nenhuma das duas pode entrar na rota.
-- ---------------------------------------------------------------------
-- 4.1 pediu para sair (Alecrim)
--
-- Só pela `suppression_list`, e de propósito: `organizations.do_not_contact`
-- continua FALSE nessa ficha. É o caso difícil — o telefone está na lista de
-- supressão e a ficha não sabe disso —, e é exatamente o que
-- `app.is_suppressed_target` enxerga e um `where not do_not_contact` não
-- enxergaria.
select app.suppress('phone', o.phone_e164, 'seed-visitas-dia', null, null)
  from public.organizations o
 where o.id = (select org from _alvo where bairro = 'Alecrim')
   and o.phone_e164 is not null;

-- 4.2 ficha apagada (Candelária)
update public.organizations
   set deleted_at = now(),
       custom = custom || '{"seed_visitas_dia": true}'::jsonb
 where id = (select org from _alvo where bairro = 'Candelária');

commit;

-- Conferência: o que a rota vai ver.
select o.neighborhood as bairro, o.geo_precision as precisao,
       t.due_at::time as hora, o.do_not_contact, o.deleted_at is not null as apagada
  from public.tasks t
  join public.organizations o on o.id = t.organization_id
 where t.id::text like 'd0000000-0000-4000-8000-00000000e0%'
 order by t.due_at;

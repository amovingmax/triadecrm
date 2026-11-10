-- =====================================================================
-- pgTAP — O Calendly marca na Agenda do CRM, sem dois no mesmo horário, só na
-- Imova (migração 20261110120000)
--
-- Prova:
--   1. SÓ O SERVIÇO CHAMA: anon e authenticated não executam as funções;
--   2. REUNIÃO NOVA: ficha de Cliente com a origem Calendly, reunião
--      `marcada_por = 'calendly'` na agenda do anfitrião, tarefa-eco, aviso na
--      Agenda (sem pessoa que marcou), push, e-mail, nota na ficha, o negócio
--      na etapa que pede data, e as respostas sem CPF;
--   3. UMA VEZ SÓ: o mesmo aviso reenviado não duplica nada;
--   4. VISITA de quem já está na base: a ficha é ligada, nasce a visita;
--   5. HORÁRIO OCUPADO: duas pessoas não ficam no mesmo horário. O novo não
--      entra na agenda, fica recusado, com nota e push, e o cancelamento fica
--      pendente para o Calendly; feito, sai da lista; o aviso de volta do
--      Calendly não faz nada; a falha espera e, definitiva, para;
--   6. A TAREFA "A MARCAR" (sem hora combinada) não ocupa horário;
--   7. O CLIENTE CANCELOU no Calendly: reunião e tarefa saem, com e-mail, nota
--      e push; o cancelamento repetido não faz nada;
--   8. A EQUIPE DESMARCOU PELO CRM: o cancelamento fica pendente para o
--      Calendly, e a confirmação que volta não gera nota nem push;
--   9. REMARCOU no Calendly: o velho fecha como remarcado e o novo nasce com
--      `remarcada_de`;
--  10. O CANCELAMENTO QUE CHEGA ANTES do agendamento segura o agendamento;
--  11. FICHA SUPRIMIDA não ganha compromisso;
--  12. O DONO pela configuração quando o anfitrião não é do CRM;
--  13. O ESPELHO NO GOOGLE: só o que não veio do Calendly, gravar, mudar,
--      apagar, falhar e esperar, e desligado sem agenda configurada;
--  14. A GRADE DE HORÁRIOS LIVRES do CRM conta os 45 minutos da visita (o
--      defeito que deixava marcar reunião por cima dela);
--  15. QUEM LÊ e quem escreve; o WhatsApp não é tocado.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(74);

insert into public.allowed_users (email, role, note) values
  ('a142.anfitriao@teste.local', 'gestor', 'pgTAP Calendly'),
  ('a142.s@teste.local', 'sdr', 'pgTAP Calendly');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000014201'::uuid, 'a142.anfitriao@teste.local', '{"full_name":"Ana Anfitriã"}'),
  ('a0000000-0000-4000-8000-000000014202'::uuid, 'a142.s@teste.local', '{"full_name":"Sara SDR"}');

-- A categoria da ficha automática da Imova (o banco do CI tem o seed da KOMUNE).
insert into public.categories (slug, name, "group", priority, position, komune_category_key, is_active)
values ('comprador', 'Comprador', 'producao', 1, 900, null, true)
on conflict (slug) do update set is_active = true;

-- Começa sem configuração do Calendly, venha o banco como vier.
delete from public.app_settings where key = 'calendly';

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

create function pg_temp.anfitria() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000014201'::uuid $$;
create function pg_temp.sdr() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000014202'::uuid $$;

-- 10h de Natal, daqui a cinco dias: longe de qualquer compromisso de verdade
-- da anfitriã (ela nasceu agora).
create function pg_temp.base() returns timestamptz language sql as
  $$ select date_trunc('day', now()) + interval '5 days' + interval '13 hours' $$;

create function pg_temp.uri(p text) returns text language sql as
  $$ select 'https://api.calendly.com/scheduled_events/EV142' || p || '/invitees/IN142' || p $$;

-- O objeto que a Edge Function monta, com o que cada caso troca por cima.
create function pg_temp.ev(p_tipo text, p text, p_inicio timestamptz, p_min int,
                           p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'evento', p_tipo,
    'convidado_uri', pg_temp.uri(p),
    'evento_uri', 'https://api.calendly.com/scheduled_events/EV142' || p,
    'nome', 'Cliente ' || p,
    'email', 'c142' || lower(p) || '@cliente.local',
    'telefone', null,
    'inicio', p_inicio,
    'fim', p_inicio + make_interval(mins => p_min),
    'tipo_de_evento', 'Reunião de 30 minutos',
    'natureza', 'reuniao',
    'formato', 'online',
    'local', null,
    'link', 'https://meet.google.com/abc-defg-hij',
    'anfitriao_email', 'A142.Anfitriao@teste.local',
    'respostas', '[]'::jsonb,
    'remarcado', false,
    'convidado_anterior_uri', null,
    'cancelamento', null,
    'link_cancelar', 'https://calendly.com/cancellations/IN142' || p,
    'link_remarcar', 'https://calendly.com/reschedulings/IN142' || p) || p_extra
$$;

create temp table t142(chave text primary key, r jsonb);
create function pg_temp.r(p text) returns jsonb language sql as
  $$ select r from t142 where chave = p $$;
-- O webhook: a função é chamada como a Edge Function a chama, com a service_role.
create function pg_temp.receber(p text, p_ev jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  execute 'set local role service_role';
  v := public.calendly_receber(p_ev);
  execute 'reset role';
  insert into t142 values (p, v);
  return v;
end $$;
create function pg_temp.ag(p text) returns public.calendly_agendamentos language sql as
  $$ select * from public.calendly_agendamentos where convidado_uri = pg_temp.uri(p) $$;
-- O que o worker leria para cancelar no Calendly.
create function pg_temp.pendente(p text) returns text language sql as $$
  select c ->> 'motivo' from jsonb_array_elements(public.calendly_cancelamentos_pendentes(50)) c
   where (c ->> 'id')::uuid = (pg_temp.ag(p)).id
$$;

create temp table t142_antes as select count(*) as mensagens from public.messages;

-- ---------------------------------------------------------------------
-- 1. Só o serviço chama
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.calendly_receber(jsonb)', 'execute'),
          'anon não chama calendly_receber');
select ok(not has_function_privilege('authenticated', 'public.calendly_receber(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.calendly_cancelamentos_pendentes(int)', 'execute')
          and not has_function_privilege('authenticated', 'public.calendly_cancelamento_feito(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.agenda_espelho_pendencias(int)', 'execute')
          and not has_function_privilege('authenticated', 'public.agenda_espelho_gravado(uuid, timestamptz, timestamptz)', 'execute'),
          'authenticated não chama nenhuma das funções do Calendly e do espelho');
select ok(has_function_privilege('service_role', 'public.calendly_receber(jsonb)', 'execute')
          and has_function_privilege('service_role', 'public.calendly_cancelamentos_pendentes(int)', 'execute')
          and has_function_privilege('service_role', 'public.agenda_espelho_pendencias(int)', 'execute'),
          'service_role (a Edge Function e o worker) chama');
-- O `safeupdate` da API recusa UPDATE e DELETE sem WHERE (ver o 123).
select is(
  (select count(*)::int
     from pg_proc p
    cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
    where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
      and (p.proname like 'calendly%' or p.proname like 'agenda_espelho%' or p.proname = 'agenda_ocupada')
      and comando ~* '(^|\n)\s*(update|delete)\s'
      and comando !~* '\swhere\s'),
  0, 'nenhuma função do Calendly ou do espelho tem UPDATE ou DELETE sem WHERE');

-- ---------------------------------------------------------------------
-- 2. Reunião nova, de quem não está na base
-- ---------------------------------------------------------------------
select pg_temp.receber('A', pg_temp.ev('invitee.created', 'A', pg_temp.base(), 30, jsonb_build_object(
  'telefone', '+5584988881422',
  'respostas', jsonb_build_array(
    jsonb_build_object('pergunta', 'Assunto', 'resposta', 'Vender meu apartamento, CPF 123.456.789-09')))));

select is(pg_temp.r('A') ->> 'situacao', 'agendado', 'horário livre: agendado');
select is(pg_temp.r('A') ->> 'ficha', 'criada', 'quem não está na base ganha ficha');
select is((select count(*)::int from public.organizations o join public.sources s on s.id = o.source_id
            where s.slug = 'calendly' and o.phone_e164 = '+5584988881422'
              and o.kind = 'produtor' and o.is_natural_person and o.email = 'c142a@cliente.local'),
          1, 'a ficha nova é Cliente, pessoa física, com a origem Calendly, telefone e e-mail');
select is((select c.slug from public.organization_categories oc join public.categories c on c.id = oc.category_id
            where oc.organization_id = (pg_temp.ag('A')).organization_id and oc.is_primary),
          'comprador', 'a categoria é a da ficha automática');
select is((select r.marcada_por || '/' || r.estado || '/' || r.formato || '/' || r.link
             from public.reunioes r where r.id = (pg_temp.r('A') ->> 'reuniao_id')::uuid),
          'calendly/marcada/online/https://meet.google.com/abc-defg-hij',
          'a reunião é do Calendly, marcada, on-line, com a sala do Calendly');
select is((select r.dono_id from public.reunioes r where r.id = (pg_temp.r('A') ->> 'reuniao_id')::uuid),
          pg_temp.anfitria(), 'na agenda da anfitriã (o e-mail não diferencia maiúsculas)');
select is((select r.fim - r.inicio from public.reunioes r where r.id = (pg_temp.r('A') ->> 'reuniao_id')::uuid),
          interval '30 minutes', 'o fim é o do Calendly, não a duração padrão do CRM');
select is((select t.kind::text || '/' || t.origin || '/' || (t.assignee_id = pg_temp.anfitria())::text
             from public.tasks t join public.reunioes r on r.task_id = t.id
            where r.id = (pg_temp.r('A') ->> 'reuniao_id')::uuid),
          'meeting/calendly/true', 'a tarefa-eco é de reunião, com a origem Calendly, da anfitriã');
select is((select a.origem || '/' || coalesce(a.marcado_por::text, 'ninguém') || '/' || a.tipo
                  || '/' || coalesce(a.detalhe, 'sem detalhe')
             from public.agenda_avisos a where a.id = (pg_temp.r('A') ->> 'aviso_id')::uuid),
          'calendly/ninguém/reuniao/sem detalhe', 'o aviso na Agenda é do Calendly, sem pessoa que marcou');
select ok(exists (select 1 from app.push_fila f
                   where f.chave = 'compromisso:' || (pg_temp.r('A') ->> 'aviso_id')
                     and f.pessoa_id = pg_temp.anfitria() and f.tipo = 'compromisso'
                     and f.corpo like 'Pelo Calendly: Reunião com Cliente A, %'),
          'o push do celular vai para a anfitriã');
select ok(exists (select 1 from pgmq.q_reuniao_avisos q
                   where q.message ->> 'reuniao_id' = pg_temp.r('A') ->> 'reuniao_id'
                     and q.message ->> 'motivo' = 'marcada'),
          'o e-mail de reunião marcada entra na fila');
select ok(exists (select 1 from public.activities a
                   where a.organization_id = (pg_temp.ag('A')).organization_id and a.type = 'system'
                     and a.body like 'Reunião agendada pelo cliente no Calendly para %'),
          'a ficha ganha a nota do agendamento');
select ok((pg_temp.ag('A')).respostas::text like '%Vender meu apartamento%'
          and (pg_temp.ag('A')).respostas::text not like '%123.456.789-09%',
          'as respostas ficam, sem o CPF');
select is((select d.stage_id from public.deals d where d.id = (pg_temp.ag('A')).deal_id),
          coalesce(
            (select st.id from public.stages st join public.pipelines p on p.id = st.pipeline_id
              where p.slug = 'produtor' and st.retired_at is null and not st.is_entry
                and exists (select 1 from jsonb_array_elements(coalesce(st.required_fields, '[]'::jsonb)) e
                             where e.value ->> 'field' = 'meeting_at')
              order by st.position limit 1),
            (select st.id from public.stages st join public.pipelines p on p.id = st.pipeline_id
              where p.slug = 'produtor' and st.is_entry order by st.position limit 1)),
          'o negócio anda para a etapa que pede data');
select is(pg_temp.pendente('A'), null, 'o agendamento que entrou não tem nada a cancelar no Calendly');

-- ---------------------------------------------------------------------
-- 3. Uma vez só
-- ---------------------------------------------------------------------
select pg_temp.receber('A2', pg_temp.ev('invitee.created', 'A', pg_temp.base(), 30,
                                        jsonb_build_object('telefone', '+5584988881422')));
select is(pg_temp.r('A2') ->> 'duplicado', 'true', 'o mesmo aviso reenviado é duplicado');
select is((select count(*)::int from public.tasks t
            where t.organization_id = (pg_temp.ag('A')).organization_id and t.origin = 'calendly'),
          1, 'e não cria outra tarefa');

-- ---------------------------------------------------------------------
-- 4. Visita de quem já está na base (pelo telefone)
-- ---------------------------------------------------------------------
insert into public.organizations (kind, name, phone_e164, source_id, collector)
select 'fornecedor', 'Proprietária C 142', '+5584977761422', s.id, 'pgTAP'
  from public.sources s order by s.id limit 1;
select pg_temp.receber('C', pg_temp.ev('invitee.created', 'C', pg_temp.base() + interval '3 hours', 45,
  jsonb_build_object('natureza', 'visita', 'formato', 'presencial', 'link', null,
                     'local', 'Rua das Dunas, 142', 'telefone', '84 97776-1422',
                     'tipo_de_evento', 'Visita ao imóvel')));
select is(pg_temp.r('C') ->> 'ficha', 'ligada', 'a ficha que tem o telefone é ligada');
select is((select count(*)::int from public.organizations o where o.phone_e164 = '+5584977761422'),
          1, 'e não é duplicada');
select is((select t.kind::text || '/' || t.origin from public.tasks t where t.id = (pg_temp.r('C') ->> 'task_id')::uuid),
          'visit/calendly', 'a visita é uma tarefa de visita com a origem Calendly');
select ok(pg_temp.r('C') ->> 'reuniao_id' is null
          and (select a.tipo from public.agenda_avisos a where a.id = (pg_temp.r('C') ->> 'aviso_id')::uuid) = 'visita',
          'visita não vira reunião, e o aviso é de visita');
select is((select o.collector from public.organizations o where o.phone_e164 = '+5584977761422'),
          'pgTAP', 'a ficha que já existia continua com a origem dela');

-- ---------------------------------------------------------------------
-- 5. Horário ocupado: outra reunião em cima da reunião A
-- ---------------------------------------------------------------------
select pg_temp.receber('D', pg_temp.ev('invitee.created', 'D', pg_temp.base() + interval '15 minutes', 30));
select is(pg_temp.r('D') ->> 'situacao', 'recusado', 'o horário ocupado é recusado');
select ok(pg_temp.r('D') ->> 'reuniao_id' is null and pg_temp.r('D') ->> 'task_id' is null
          and pg_temp.r('D') ->> 'aviso_id' is null
          and not exists (select 1 from public.tasks t where t.organization_id = (pg_temp.ag('D')).organization_id),
          'nada entra na agenda: nem reunião, nem tarefa, nem aviso');
select ok(exists (select 1 from public.activities a
                   where a.organization_id = (pg_temp.ag('D')).organization_id
                     and a.body like 'Tentou agendar uma reunião pelo Calendly para %, mas o horário já estava ocupado (Reunião com Cliente A às %'),
          'a ficha do cliente ganha a nota da tentativa, com o que ocupava o horário');
select ok(exists (select 1 from app.push_fila f
                   where f.chave = 'calendly:recusado:' || (pg_temp.ag('D')).id
                     and f.pessoa_id = pg_temp.anfitria()
                     and f.corpo like 'Pelo Calendly: Cliente D tentou marcar %, mas o horário já estava ocupado.%'),
          'quem atende ganha o push da tentativa');
select ok(pg_temp.pendente('D') like 'Este horário acabou de ser ocupado na agenda da Imova Imobiliária.%',
          'o cancelamento fica pendente para o Calendly, com o recado ao cliente');
select is(
  (select r.estado from public.reunioes r where r.id = (pg_temp.r('A') ->> 'reuniao_id')::uuid),
  'marcada', 'a reunião de quem chegou primeiro continua de pé');
select public.calendly_cancelamento_feito((pg_temp.ag('D')).id);
select ok(pg_temp.pendente('D') is null and (pg_temp.ag('D')).cancelado_no_calendly_em is not null,
          'feito pelo worker, sai da lista');
select pg_temp.receber('D-cancelada', pg_temp.ev('invitee.canceled', 'D', pg_temp.base() + interval '15 minutes', 30,
  jsonb_build_object('cancelamento', jsonb_build_object('por', 'anfitriao', 'motivo', 'Horário ocupado'))));
select ok(pg_temp.r('D-cancelada') ->> 'duplicado' = 'true'
          and not exists (select 1 from app.push_fila f where f.chave = 'calendly:cancelado:' || (pg_temp.ag('D')).id),
          'o aviso que o Calendly devolve depois não faz nada');

-- A falha espera; a definitiva para.
select pg_temp.receber('E', pg_temp.ev('invitee.created', 'E', pg_temp.base() + interval '10 minutes', 30));
select public.calendly_cancelamento_falhou((pg_temp.ag('E')).id, 'Calendly 503');
select ok(pg_temp.pendente('E') is null
          and (pg_temp.ag('E')).cancelar_tentativas = 1
          and (pg_temp.ag('E')).cancelar_depois_de > now()
          and (pg_temp.ag('E')).cancelar_erro = 'Calendly 503',
          'falhou: sai da lista por um tempo, com o erro e a tentativa contados');
update public.calendly_agendamentos set cancelar_depois_de = now() - interval '1 second'
 where id = (pg_temp.ag('E')).id;
select ok(pg_temp.pendente('E') is not null, 'passada a espera, volta para a lista');
select public.calendly_cancelamento_falhou((pg_temp.ag('E')).id, 'evento não existe', true);
select is((pg_temp.ag('E')).cancelar_tentativas, 8, 'a falha definitiva para de tentar');
update public.calendly_agendamentos set cancelar_depois_de = null where id = (pg_temp.ag('E')).id;
select is(pg_temp.pendente('E'), null, 'e não volta mais para a lista');

-- ---------------------------------------------------------------------
-- 6. A tarefa "a marcar" não ocupa horário
-- ---------------------------------------------------------------------
-- Uma "Marcar apresentação" às 10h de outro dia, num negócio na etapa de
-- entrada (sem hora combinada).
insert into public.tasks (title, kind, status, priority, due_at, assignee_id, organization_id, deal_id, origin)
select 'Marcar apresentação', 'meeting', 'todo', 2, pg_temp.base() + interval '2 days',
       pg_temp.anfitria(), d.organization_id, d.id, 'system'
  from public.deals d where d.id = (pg_temp.ag('A')).deal_id;
update public.deals d
   set stage_id = (select st.id from public.stages st where st.pipeline_id = d.pipeline_id and st.is_entry
                    order by st.position limit 1)
 where d.id = (pg_temp.ag('A')).deal_id;
select pg_temp.receber('F', pg_temp.ev('invitee.created', 'F', pg_temp.base() + interval '2 days', 30));
select is(pg_temp.r('F') ->> 'situacao', 'agendado',
          'o lembrete de marcar apresentação, sem hora combinada, não recusa o cliente');

-- ---------------------------------------------------------------------
-- 7. O cliente cancelou no Calendly
-- ---------------------------------------------------------------------
select pg_temp.receber('A-cancelada', pg_temp.ev('invitee.canceled', 'A', pg_temp.base(), 30,
  jsonb_build_object('cancelamento', jsonb_build_object('por', 'convidado', 'motivo', 'Viajei'))));
select is(pg_temp.r('A-cancelada') ->> 'situacao', 'cancelado', 'o cancelamento é recebido');
select is((select r.estado from public.reunioes r where r.id = (pg_temp.r('A') ->> 'reuniao_id')::uuid),
          'cancelada', 'a reunião é cancelada');
select is((select t.status::text from public.tasks t where t.id = (pg_temp.r('A') ->> 'task_id')::uuid),
          'cancelled', 'a tarefa-eco também');
select ok(exists (select 1 from pgmq.q_reuniao_avisos q
                   where q.message ->> 'reuniao_id' = pg_temp.r('A') ->> 'reuniao_id'
                     and q.message ->> 'motivo' = 'cancelada'),
          'o e-mail de cancelamento entra na fila');
select ok(exists (select 1 from app.push_fila f
                   where f.chave = 'calendly:cancelado:' || (pg_temp.ag('A')).id
                     and f.corpo like 'Cancelado pelo Calendly: Reunião com Cliente A, %')
          and exists (select 1 from public.activities a
                       where a.organization_id = (pg_temp.ag('A')).organization_id
                         and a.body like 'Reunião cancelada pelo cliente no Calendly %Motivo: Viajei'),
          'push à anfitriã e nota na ficha, com o motivo');
select is(pg_temp.pendente('A'), null, 'o Calendly já sabe: nada a pedir a ele');
select pg_temp.receber('A-cancelada-2', pg_temp.ev('invitee.canceled', 'A', pg_temp.base(), 30));
select is(pg_temp.r('A-cancelada-2') ->> 'duplicado', 'true', 'o cancelamento repetido não faz nada');

-- ---------------------------------------------------------------------
-- 8. A equipe desmarcou pelo CRM (a visita C)
-- ---------------------------------------------------------------------
update public.tasks set status = 'cancelled' where id = (pg_temp.r('C') ->> 'task_id')::uuid;
select ok(pg_temp.pendente('C') like 'A Imova Imobiliária precisou cancelar este compromisso%',
          'desmarcada pelo CRM, o cancelamento fica pendente para o Calendly (o horário volta a ficar livre lá)');
select pg_temp.receber('C-cancelada', pg_temp.ev('invitee.canceled', 'C', pg_temp.base() + interval '3 hours', 45,
  jsonb_build_object('natureza', 'visita', 'cancelamento', jsonb_build_object('por', 'anfitriao', 'motivo', null))));
select ok((pg_temp.ag('C')).situacao = 'cancelado' and pg_temp.pendente('C') is null
          and not exists (select 1 from app.push_fila f where f.chave = 'calendly:cancelado:' || (pg_temp.ag('C')).id)
          and not exists (select 1 from public.activities a
                           where a.organization_id = (pg_temp.ag('C')).organization_id
                             and a.body like 'Visita cancelada%'),
          'a confirmação do Calendly fecha o agendamento, sem nota nem push');

-- ---------------------------------------------------------------------
-- 9. Remarcou no Calendly: G vira H
-- ---------------------------------------------------------------------
select pg_temp.receber('G', pg_temp.ev('invitee.created', 'G', pg_temp.base() + interval '1 day', 30));
select pg_temp.receber('H', pg_temp.ev('invitee.created', 'H', pg_temp.base() + interval '1 day 2 hours', 30,
  jsonb_build_object('email', 'c142g@cliente.local', 'convidado_anterior_uri', pg_temp.uri('G'))));
select is((select r.estado from public.reunioes r where r.id = (pg_temp.r('G') ->> 'reuniao_id')::uuid)
          || '/' || (pg_temp.ag('G')).situacao,
          'remarcada/remarcado', 'a reunião velha fecha como remarcada');
select is((select r.remarcada_de from public.reunioes r where r.id = (pg_temp.r('H') ->> 'reuniao_id')::uuid),
          (pg_temp.r('G') ->> 'reuniao_id')::uuid, 'a nova aponta para a velha (o selo Reagendada)');
select ok((select a.detalhe from public.agenda_avisos a where a.id = (pg_temp.r('H') ->> 'aviso_id')::uuid)
            like 'O cliente remarcou (era %).',
          'o aviso diz de quando foi remarcado');
select ok(exists (select 1 from pgmq.q_reuniao_avisos q
                   where q.message ->> 'reuniao_id' = pg_temp.r('H') ->> 'reuniao_id'
                     and q.message ->> 'motivo' = 'remarcada')
          and pg_temp.pendente('G') is null,
          'o e-mail é de reunião remarcada, e não há o que cancelar no Calendly');
select pg_temp.receber('G-cancelada', pg_temp.ev('invitee.canceled', 'G', pg_temp.base() + interval '1 day', 30,
                                                 jsonb_build_object('remarcado', true)));
select is(pg_temp.r('G-cancelada') ->> 'duplicado', 'true',
          'a metade "cancelado" da remarcação, chegando depois, não faz nada');

-- ---------------------------------------------------------------------
-- 10. O cancelamento que chega antes do agendamento
-- ---------------------------------------------------------------------
select pg_temp.receber('I-cancelada', pg_temp.ev('invitee.canceled', 'I', pg_temp.base() + interval '2 days 4 hours', 30));
select is(pg_temp.r('I-cancelada') ->> 'sem_agendamento', 'true', 'o cancelamento sem agendamento fica anotado');
select pg_temp.receber('I', pg_temp.ev('invitee.created', 'I', pg_temp.base() + interval '2 days 4 hours', 30));
select ok(pg_temp.r('I') ->> 'duplicado' = 'true'
          and not exists (select 1 from public.organizations o where o.email = 'c142i@cliente.local'),
          'e o agendamento que chega depois não entra na agenda nem cria ficha');

-- ---------------------------------------------------------------------
-- 11. Ficha suprimida
-- ---------------------------------------------------------------------
insert into public.organizations (kind, name, email, source_id, collector, do_not_contact)
select 'produtor', 'Cliente J 142', 'c142j@cliente.local', s.id, 'pgTAP', true
  from public.sources s order by s.id limit 1;
select pg_temp.receber('J', pg_temp.ev('invitee.created', 'J', pg_temp.base() + interval '3 days', 30));
select ok(pg_temp.r('J') ->> 'situacao' = 'suprimido' and pg_temp.r('J') ->> 'task_id' is null
          and (pg_temp.ag('J')).organization_id is null,
          'quem pediu para não ser contatado não ganha compromisso');

-- ---------------------------------------------------------------------
-- 12. O dono pela configuração
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values ('calendly', '{"dono_email": "a142.s@teste.local"}')
on conflict (key) do update set value = excluded.value;
select pg_temp.receber('K', pg_temp.ev('invitee.created', 'K', pg_temp.base() + interval '4 days', 30,
                                       jsonb_build_object('anfitriao_email', 'ninguem@fora.local')));
select is((pg_temp.ag('K')).dono_id, pg_temp.sdr(),
          'anfitrião que não é do CRM: vale o e-mail de app_settings[calendly]');

-- ---------------------------------------------------------------------
-- 13. O espelho no Google
-- ---------------------------------------------------------------------
update public.app_settings set value = '{"dono_email": "a142.anfitriao@teste.local"}' where key = 'calendly';
select is(public.agenda_espelho_pendencias(50) ->> 'ligado', 'false',
          'sem google_agenda_id, o espelho fica desligado');

update public.app_settings
   set value = '{"dono_email": "a142.anfitriao@teste.local", "google_agenda_id": "agenda142@group.calendar.google.com"}'
 where key = 'calendly';
-- Uma visita marcada pela equipe, no CRM, na agenda da anfitriã.
create temp table t142_v (id uuid);
with x as (
  insert into public.tasks (title, kind, status, priority, due_at, assignee_id, organization_id, origin)
  select 'Visita: Proprietária C 142', 'visit', 'todo', 2, pg_temp.base() + interval '6 hours',
         pg_temp.anfitria(), o.id, 'manual'
    from public.organizations o where o.phone_e164 = '+5584977761422'
  returning id)
insert into t142_v select id from x;
create function pg_temp.gravar() returns jsonb language sql as
  $$ select public.agenda_espelho_pendencias(50) -> 'gravar' $$;
create function pg_temp.na_lista(p_lista jsonb, p_id uuid) returns boolean language sql as
  $$ select exists (select 1 from jsonb_array_elements(p_lista) g where (g ->> 'item_id')::uuid = p_id) $$;

select is(public.agenda_espelho_pendencias(50) ->> 'calendario', 'agenda142@group.calendar.google.com',
          'ligado, com o calendário configurado');
select ok(pg_temp.na_lista(pg_temp.gravar(), (select id from t142_v))
          and (select g ->> 'evento_id' from jsonb_array_elements(pg_temp.gravar()) g
                where (g ->> 'item_id')::uuid = (select id from t142_v)) = replace((select id from t142_v)::text, '-', ''),
          'a visita da equipe vai para o Google, com o id do evento tirado do id dela');
select ok(not pg_temp.na_lista(pg_temp.gravar(), (pg_temp.r('H') ->> 'task_id')::uuid)
          and not pg_temp.na_lista(pg_temp.gravar(), (pg_temp.r('F') ->> 'task_id')::uuid),
          'o que veio do Calendly não vai para o Google (o Calendly já bloqueia o que é dele)');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.gravar()) g
                       where (g ->> 'item_id')::uuid in (select t.id from public.tasks t where t.title = 'Marcar apresentação')),
          'nem a tarefa "a marcar"');
select public.agenda_espelho_gravado((select id from t142_v), pg_temp.base() + interval '6 hours',
                                     pg_temp.base() + interval '6 hours 45 minutes');
select ok(not pg_temp.na_lista(pg_temp.gravar(), (select id from t142_v)), 'gravada, sai da lista');
update public.tasks set due_at = pg_temp.base() + interval '7 hours' where id = (select id from t142_v);
select ok(pg_temp.na_lista(pg_temp.gravar(), (select id from t142_v)), 'mudou de horário, volta para gravar de novo');
update public.tasks set status = 'cancelled' where id = (select id from t142_v);
select ok(pg_temp.na_lista(public.agenda_espelho_pendencias(50) -> 'apagar', (select id from t142_v))
          and not pg_temp.na_lista(pg_temp.gravar(), (select id from t142_v)),
          'cancelada, vai para apagar do Google');
select public.agenda_espelho_apagado((select id from t142_v));
select ok(not pg_temp.na_lista(public.agenda_espelho_pendencias(50) -> 'apagar', (select id from t142_v)),
          'apagada, sai da lista');
update public.tasks set status = 'todo' where id = (select id from t142_v);
select public.agenda_espelho_falhou((select id from t142_v), pg_temp.base() + interval '7 hours',
                                    pg_temp.base() + interval '7 hours 45 minutes', 'Google 500');
select ok(not pg_temp.na_lista(pg_temp.gravar(), (select id from t142_v)),
          'o Google falhou: espera antes de tentar de novo');

-- ---------------------------------------------------------------------
-- 14. A grade de horários livres conta a duração da visita
-- ---------------------------------------------------------------------
-- Na agenda da SDR, três dias úteis à frente (longe dos agendamentos acima):
-- uma visita às 10h00, que dura 45 min. A grade anda de 50 em 50 min a partir
-- de 9h30: 9h30, 10h20, 11h10… A das 10h20 encosta na visita e não pode sair.
create function pg_temp.d10(p_hora time) returns timestamptz language sql as
  $$ select (app.next_business_day((now() at time zone 'America/Fortaleza')::date, 3) + p_hora)
            at time zone 'America/Fortaleza' $$;
insert into public.tasks (title, kind, status, priority, due_at, assignee_id, organization_id, origin)
select 'Visita: grade 142', 'visit', 'todo', 2, pg_temp.d10('10:00'), pg_temp.sdr(), o.id, 'manual'
  from public.organizations o where o.phone_e164 = '+5584977761422';
create function pg_temp.grade() returns setof timestamptz language sql as $$
  select h.inicio from app.reuniao_horarios_livres(
           pg_temp.sdr(),
           app.next_business_day((now() at time zone 'America/Fortaleza')::date, 3),
           app.next_business_day((now() at time zone 'America/Fortaleza')::date, 3), 50) h
$$;
select ok(not exists (select 1 from pg_temp.grade() i
                       where i < pg_temp.d10('10:45')
                         and i + make_interval(mins => coalesce((app.reuniao_config() ->> 'duracao_min')::int, 40))
                             > pg_temp.d10('10:00')),
          'a grade não oferece horário em cima dos 45 minutos da visita (nem o das 10h20)');
select ok(exists (select 1 from pg_temp.grade() i where i >= pg_temp.d10('10:45')),
          'e continua oferecendo o resto do dia');

-- ---------------------------------------------------------------------
-- 15. Quem lê, quem escreve, e o WhatsApp
-- ---------------------------------------------------------------------
select is(public.calendly_receber(jsonb_build_object('evento', 'invitee_no_show.created',
                                                     'convidado_uri', pg_temp.uri('A'))) ->> 'ignorado',
          'true', 'outros avisos do Calendly são ignorados');

select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select ok((select count(*) from public.calendly_agendamentos where convidado_uri like '%IN142%') >= 10,
          'a equipe lê os agendamentos');
select throws_ok(
  $$ insert into public.calendly_agendamentos (convidado_uri, evento_uri, situacao)
     values ('https://x.local/invitees/1', 'https://x.local/events/1', 'agendado') $$,
  '42501', null, 'ninguém escreve direto na tabela');
select throws_ok(
  $$ select public.calendly_receber('{}'::jsonb) $$,
  '42501', null, 'nem chama a função pela sessão');
select pg_temp.sair();

select is((select count(*) from public.messages), (select mensagens from t142_antes),
          'nenhuma mensagem de WhatsApp nasce de um agendamento');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — A visita que chega pelo Calendly fica protegida (migração
-- 20261111204000), só na Imova
--
-- Prova:
--   1. SÓ NA IMOVA: na KOMUNE as funções e as colunas novas não existem;
--   2. FERIADO E FIM DE SEMANA: o agendamento num feriado (um feriado de teste
--      e o 20/11), num sábado ou num domingo é recusado pelo caminho do horário
--      ocupado, com a nota e o push dizendo "feriado"/"sábado"/"domingo", e o
--      cancelamento fica pendente com o recado do dia; o dia útil entra; o
--      horário ocupado continua dizendo "ocupado";
--   3. QUEM ATENDE: sem escolha, igual a antes (o anfitrião); com a escolha,
--      ela vale antes do anfitrião, e a agenda do espelho é a mesma pessoa; o
--      e-mail que não é de ninguém ativo volta ao anfitrião; o campo é só do
--      admin, só aceita quem atende, e não mexe no google_agenda_id;
--   4. O RESPONSÁVEL: a ficha e o negócio novos nascem com quem atende; a ficha
--      sem responsável ganha um; a que já tem continua com o dela;
--   5. O ENDEREÇO DA VISITA: pela resposta do cliente (com o evento no Meet),
--      pelo código do anúncio (com o código citado, com e sem o sufixo antigo);
--      código que não é de anúncio nenhum fica "a combinar"; a reunião on-line
--      não ganha endereço;
--   6. O CANCELAMENTO QUE FALHOU DE VEZ aparece ao dono e ao admin (e não a
--      outra pessoa), sai ao ser marcado como resolvido (só dono ou admin) e
--      quando o Calendly confirma o cancelamento;
--   7. QUEM CHAMA O QUÊ, nenhum UPDATE ou DELETE sem WHERE, e o WhatsApp não é
--      tocado.
--
-- O MESMO ARQUIVO RODA NOS DOIS BANCOS. As partes da Imova moram em funções
-- plpgsql (`pg_temp.parte_*`), cujo corpo só é resolvido quando roda; no banco
-- da KOMUNE, onde não há nada do Calendly, cada parte sai como SKIP e só a
-- parte 1 prova alguma coisa.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(62);

insert into public.allowed_users (email, role, note) values
  ('a154.anfitriao@teste.local', 'gestor', 'pgTAP 154'),
  ('a154.corretor@teste.local', 'sdr', 'pgTAP 154'),
  ('a154.admin@teste.local', 'admin', 'pgTAP 154'),
  ('a154.outro@teste.local', 'sdr', 'pgTAP 154'),
  ('a154.leitura@teste.local', 'leitura', 'pgTAP 154');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000015401'::uuid, 'a154.anfitriao@teste.local', '{"full_name":"Ana Anfitriã 154"}'),
  ('a0000000-0000-4000-8000-000000015402'::uuid, 'a154.corretor@teste.local', '{"full_name":"Caio Corretor 154"}'),
  ('a0000000-0000-4000-8000-000000015403'::uuid, 'a154.admin@teste.local', '{"full_name":"Adm 154"}'),
  ('a0000000-0000-4000-8000-000000015404'::uuid, 'a154.outro@teste.local', '{"full_name":"Olga Outra 154"}'),
  ('a0000000-0000-4000-8000-000000015405'::uuid, 'a154.leitura@teste.local', '{"full_name":"Lia Leitura 154"}');

-- A categoria da ficha automática da Imova (o banco do CI tem o seed da KOMUNE).
insert into public.categories (slug, name, "group", priority, position, komune_category_key, is_active)
values ('comprador', 'Comprador', 'producao', 1, 900, null, true)
on conflict (slug) do update set is_active = true;

create function pg_temp.na_komune() returns boolean language sql stable as
  $$ select coalesce((select i.empresa from app.identidade i) = 'komune', false) $$;

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
  $$ select 'a0000000-0000-4000-8000-000000015401'::uuid $$;
create function pg_temp.corretor() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000015402'::uuid $$;
create function pg_temp.admin() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000015403'::uuid $$;
create function pg_temp.outro() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000015404'::uuid $$;
create function pg_temp.leitura() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000015405'::uuid $$;

-- Os dias, a partir de hoje, para o arquivo não envelhecer: um dia útil uns oito
-- dias úteis à frente (onde tudo o que entra cabe), um feriado de teste depois
-- dele, e um fim de semana sem feriado. O 20/11/2026 é provado à parte, pelo
-- texto, porque é o caso que o usuário apontou.
create temp table t154_dia as
  select app.next_business_day((now() at time zone 'America/Fortaleza')::date, 8) as util;
alter table t154_dia add column feriado date, add column sabado date;
update t154_dia
   set feriado = (select d::date from generate_series(util + 7, util + 150, interval '1 day') d
                   where app.eh_dia_util(d::date) order by d limit 1),
       sabado  = (select d::date from generate_series(util + 1, util + 150, interval '1 day') d
                   where extract(isodow from d) = 6
                     and not exists (select 1 from public.holidays h where h.date in (d::date, d::date + 1))
                   order by d limit 1)
 where true;
insert into public.holidays (date, name, scope)
select feriado, 'Feriado de teste 154', 'municipal' from t154_dia;
insert into public.holidays (date, name, scope)
values ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional')
on conflict (date, scope) do nothing;

create function pg_temp.em(p_dia date, p_hora time) returns timestamptz language sql as
  $$ select (p_dia + p_hora) at time zone 'America/Fortaleza' $$;
create function pg_temp.util(p_hora time) returns timestamptz language sql as
  $$ select pg_temp.em((select util from t154_dia), p_hora) $$;

create function pg_temp.uri(p text) returns text language sql as
  $$ select 'https://api.calendly.com/scheduled_events/EV154' || p || '/invitees/IN154' || p $$;

-- O objeto que a Edge Function monta (o 142 tem o mesmo), com o que cada caso
-- troca por cima. O anfitrião é sempre a anfitriã: na Imova a conta do
-- Calendly é de uma pessoa só.
create function pg_temp.ev(p_tipo text, p text, p_inicio timestamptz, p_min int,
                           p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'evento', p_tipo,
    'convidado_uri', pg_temp.uri(p),
    'evento_uri', 'https://api.calendly.com/scheduled_events/EV154' || p,
    'nome', 'Cliente ' || p,
    'email', 'c154' || lower(p) || '@cliente.local',
    'telefone', null,
    'inicio', p_inicio,
    'fim', p_inicio + make_interval(mins => p_min),
    'tipo_de_evento', 'Agendamento Imova',
    'natureza', 'reuniao',
    'formato', 'online',
    'local', null,
    'link', 'https://meet.google.com/abc-defg-154',
    'anfitriao_email', 'A154.Anfitriao@teste.local',
    'respostas', '[]'::jsonb,
    'remarcado', false,
    'convidado_anterior_uri', null,
    'cancelamento', null,
    'link_cancelar', 'https://calendly.com/cancellations/IN154' || p,
    'link_remarcar', 'https://calendly.com/reschedulings/IN154' || p) || p_extra
$$;
-- A visita com o local do evento em Google Meet (o caso real de 10/11/2026).
create function pg_temp.visita(p_respostas jsonb default '[]'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('natureza', 'visita', 'formato', 'online',
                            'link', 'https://meet.google.com/abc-defg-154', 'local', null,
                            'respostas', p_respostas)
$$;

create temp table t154(chave text primary key, r jsonb);
create function pg_temp.r(p text) returns jsonb language sql as
  $$ select r from t154 where chave = p $$;
-- O webhook: a função é chamada como a Edge Function a chama, com a service_role.
create function pg_temp.receber(p text, p_ev jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  execute 'set local role service_role';
  v := public.calendly_receber(p_ev);
  execute 'reset role';
  insert into t154 values (p, v);
  return v;
end $$;
-- O agendamento inteiro, em jsonb (a tabela não existe na KOMUNE).
create function pg_temp.ag(p text) returns jsonb language plpgsql as $$
begin
  return (select to_jsonb(a) from public.calendly_agendamentos a where a.convidado_uri = pg_temp.uri(p));
end $$;
create function pg_temp.ag_id(p text) returns uuid language sql as
  $$ select (pg_temp.ag(p) ->> 'id')::uuid $$;
create function pg_temp.org(p text) returns uuid language sql as
  $$ select (pg_temp.ag(p) ->> 'organization_id')::uuid $$;
-- O recado que o worker mandaria ao Calendly.
create function pg_temp.pendente(p text) returns text language plpgsql as $$
begin
  return (select c ->> 'motivo' from jsonb_array_elements(public.calendly_cancelamentos_pendentes(50)) c
           where (c ->> 'id')::uuid = pg_temp.ag_id(p));
end $$;
-- A nota do sistema na ficha.
create function pg_temp.nota(p text) returns text language sql as $$
  select string_agg(a.body, ' | ') from public.activities a
   where a.organization_id = pg_temp.org(p) and a.type = 'system'
     and a.metadata ->> 'calendly_agendamento_id' = pg_temp.ag(p) ->> 'id'
$$;
-- O aviso do cancelamento que falhou, na sessão de quem está entrando.
create function pg_temp.falhas() returns setof uuid language plpgsql as $$
begin
  return query select f.id from public.calendly_cancelamentos_que_falharam() f;
end $$;

create temp table t154_antes as select count(*) as mensagens from public.messages;

-- ---------------------------------------------------------------------
-- 1. Só na Imova (prova nos dois bancos)
-- ---------------------------------------------------------------------
select is(to_regprocedure('public.calendly_quem_atende()') is not null
          and to_regprocedure('public.calendly_quem_atende_gravar(uuid)') is not null
          and to_regprocedure('public.calendly_cancelamentos_que_falharam()') is not null
          and to_regprocedure('public.calendly_cancelamento_resolvido(uuid)') is not null
          and to_regprocedure('app.calendly_pessoa_escolhida()') is not null
          and to_regprocedure('app.calendly_local_da_visita(jsonb)') is not null
          and to_regprocedure('app.calendly_ficha(text, text, text, uuid)') is not null,
          not pg_temp.na_komune(),
          'as funções novas existem na Imova, e não na KOMUNE');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'calendly_agendamentos'
              and column_name in ('motivo_recusa', 'anuncio_id', 'cancelar_resolvido_em',
                                  'cancelar_resolvido_por')),
          case when pg_temp.na_komune() then 0 else 4 end,
          'as colunas novas do agendamento também (na KOMUNE não há agendamento do Calendly)');
select ok(to_regprocedure('app.calendly_ficha(text, text, text)') is null,
          'a ficha do Calendly sem o responsável saiu (na KOMUNE nunca existiu)');
select ok(not app.eh_dia_util((select feriado from t154_dia)) and not app.eh_dia_util(date '2026-11-20')
          and not app.eh_dia_util((select sabado from t154_dia))
          and not app.eh_dia_util((select sabado + 1 from t154_dia))
          and app.eh_dia_util((select util from t154_dia)),
          'a régua do dia útil é a de sempre (feriado de teste, 20/11, sábado, domingo e o dia útil)');

-- ---------------------------------------------------------------------
-- 2. Feriado e fim de semana (sem escolha de quem atende: vai à anfitriã)
-- ---------------------------------------------------------------------
create function pg_temp.parte_feriado() returns setof text language plpgsql as $parte$
declare
  v_fer text := to_char((select feriado from t154_dia), 'DD/MM');
  v_sab text := to_char((select sabado from t154_dia), 'DD/MM');
  v_dom text := to_char((select sabado + 1 from t154_dia), 'DD/MM');
begin
  if pg_temp.na_komune() then
    return next skip('O Calendly é só da Imova', 12);
    return;
  end if;

  delete from public.app_settings where key = 'calendly';
  insert into public.app_settings (key, value)
  values ('calendly', '{"google_agenda_id": "agenda154@group.calendar.google.com"}');

  perform pg_temp.receber('F1', pg_temp.ev('invitee.created', 'F1',
            pg_temp.em((select feriado from t154_dia), '10:00'), 45,
            pg_temp.visita() || '{"telefone": "+5584988871540"}'));
  return next is(pg_temp.r('F1') ->> 'situacao' || '/' || (pg_temp.r('F1') ->> 'recusa'),
                 'recusado/dia_nao_util', 'feriado: recusado, por dia que não é útil');
  return next ok(pg_temp.r('F1') ->> 'task_id' is null and pg_temp.r('F1') ->> 'aviso_id' is null
                 and not exists (select 1 from public.tasks t where t.organization_id = pg_temp.org('F1'))
                 and not exists (select 1 from public.agenda_avisos a where a.titulo like '%Cliente F1%'),
                 'nada entra na agenda: nem tarefa, nem aviso');
  return next ok(pg_temp.nota('F1') like 'Tentou agendar uma visita pelo Calendly para % (Feriado de teste 154). O Calendly marcou num feriado ('
                                         || v_fer || '); o CRM pediu o cancelamento%'
                 and pg_temp.nota('F1') not like '%ocupado%',
                 'a nota diz que é feriado, e não "horário ocupado"');
  return next ok(exists (select 1 from app.push_fila f
                          where f.chave = 'calendly:recusado:' || pg_temp.ag_id('F1')
                            and f.pessoa_id = pg_temp.anfitria() and f.tipo = 'compromisso'
                            and f.corpo like 'Pelo Calendly: Cliente F1 tentou marcar %. O Calendly marcou num feriado ('
                                             || v_fer || '); o CRM pediu o cancelamento.'),
                 'o push é o do caminho do recusado (tipo compromisso), com o feriado');
  return next ok(pg_temp.pendente('F1') like 'Este dia é feriado e a Imova Imobiliária não atende.%',
                 'o cancelamento fica pendente para o Calendly, com o recado do feriado ao cliente');

  -- O caso do usuário: 20/11/2026, sexta-feira e feriado.
  perform pg_temp.receber('F2', pg_temp.ev('invitee.created', 'F2', pg_temp.em('2026-11-20', '10:00'), 30));
  return next ok(pg_temp.r('F2') ->> 'situacao' = 'recusado' and pg_temp.r('F2') ->> 'reuniao_id' is null
                 and pg_temp.nota('F2') like '%O Calendly marcou num feriado (20/11); o CRM pediu o cancelamento%',
                 '20/11: a reunião é recusada, e a nota diz "O Calendly marcou num feriado (20/11); o CRM pediu o cancelamento"');

  perform pg_temp.receber('S1', pg_temp.ev('invitee.created', 'S1',
            pg_temp.em((select sabado from t154_dia), '10:00'), 45, pg_temp.visita()));
  return next ok(pg_temp.r('S1') ->> 'recusa' = 'dia_nao_util'
                 and exists (select 1 from app.push_fila f
                              where f.chave = 'calendly:recusado:' || pg_temp.ag_id('S1')
                                and f.corpo like '%O Calendly marcou num sábado (' || v_sab || '); o CRM pediu o cancelamento.'),
                 'sábado: recusado, e o push diz que foi num sábado');
  return next ok(pg_temp.pendente('S1') like 'A Imova Imobiliária não atende aos sábados e domingos.%',
                 'com o recado do fim de semana ao cliente');
  perform pg_temp.receber('S2', pg_temp.ev('invitee.created', 'S2',
            pg_temp.em((select sabado + 1 from t154_dia), '15:00'), 30));
  return next ok(pg_temp.r('S2') ->> 'situacao' = 'recusado'
                 and pg_temp.nota('S2') like '%O Calendly marcou num domingo (' || v_dom || ')%',
                 'domingo: recusado, e a nota diz que foi num domingo');

  -- Dia útil entra; o horário ocupado continua sendo "ocupado".
  perform pg_temp.receber('U1', pg_temp.ev('invitee.created', 'U1', pg_temp.util('09:30'), 45,
            pg_temp.visita('[{"pergunta": "Endereço ou código do imóvel", "resposta": "Rua Um, 154"}]')));
  return next is(pg_temp.r('U1') ->> 'situacao', 'agendado', 'dia útil e horário livre: agendado');
  perform pg_temp.receber('U2', pg_temp.ev('invitee.created', 'U2', pg_temp.util('09:45'), 30));
  return next ok(pg_temp.r('U2') ->> 'recusa' = 'ocupado'
                 and pg_temp.nota('U2') like '%mas o horário já estava ocupado (Visita: Cliente U1 às%'
                 and pg_temp.pendente('U2') like 'Este horário acabou de ser ocupado na agenda da Imova Imobiliária.%',
                 'horário ocupado continua recusado como ocupado, com o recado de sempre');
  return next is((select count(*)::int from public.calendly_agendamentos
                   where convidado_uri like '%IN154%' and situacao = 'recusado' and motivo_recusa is null),
                 0, 'todo recusado diz por quê');
end $parte$;
select * from pg_temp.parte_feriado();

-- ---------------------------------------------------------------------
-- 3. Quem atende
-- ---------------------------------------------------------------------
create function pg_temp.parte_dono() returns setof text language plpgsql as $parte$
declare
  v jsonb;
begin
  if pg_temp.na_komune() then
    return next skip('O Calendly é só da Imova', 13);
    return;
  end if;

  return next is((pg_temp.ag('U1') ->> 'dono_id')::uuid, pg_temp.anfitria(),
                 'sem escolha, igual a antes: entra na agenda do anfitrião');
  return next is(app.calendly_pessoa_da_agenda(), pg_temp.anfitria(),
                 'e a agenda que o espelho copia é a dela (quem recebeu o último)');

  perform pg_temp.entrar(pg_temp.corretor(), 'sdr');
  return next throws_ok('select public.calendly_quem_atende()', '42501', null,
                        'o SDR não lê o campo "Quem atende"');
  perform pg_temp.sair();
  perform pg_temp.entrar(pg_temp.anfitria(), 'gestor');
  return next throws_ok(format('select public.calendly_quem_atende_gravar(%L::uuid)', pg_temp.anfitria()),
                        '42501', null, 'nem o gestor grava: o campo é do admin');
  perform pg_temp.sair();

  perform pg_temp.entrar(pg_temp.admin(), 'admin');
  v := public.calendly_quem_atende_gravar(pg_temp.corretor());
  return next is((v ->> 'pessoa_id')::uuid, pg_temp.corretor(), 'o admin escolhe o corretor');
  return next ok(exists (select 1 from jsonb_array_elements(public.calendly_quem_atende() -> 'pessoas') p
                          where (p ->> 'id')::uuid = pg_temp.corretor())
                 and exists (select 1 from jsonb_array_elements(public.calendly_quem_atende() -> 'pessoas') p
                              where (p ->> 'id')::uuid = pg_temp.anfitria())
                 and not exists (select 1 from jsonb_array_elements(public.calendly_quem_atende() -> 'pessoas') p
                                  where (p ->> 'id')::uuid = pg_temp.leitura()),
                 'a lista tem quem atende (admin, gestor e SDR ativos), e não o papel de leitura');
  return next throws_ok(format('select public.calendly_quem_atende_gravar(%L::uuid)', pg_temp.leitura()),
                        '22023', null, 'quem não atende não pode ser escolhido');
  perform pg_temp.sair();
  return next ok((select s.value ->> 'dono_email' = 'a154.corretor@teste.local'
                         and s.value ->> 'google_agenda_id' = 'agenda154@group.calendar.google.com'
                    from public.app_settings s where s.key = 'calendly'),
                 'grava o e-mail em app_settings[calendly] e não mexe no google_agenda_id');

  perform pg_temp.receber('U3', pg_temp.ev('invitee.created', 'U3', pg_temp.util('11:00'), 30));
  return next is((pg_temp.ag('U3') ->> 'dono_id')::uuid, pg_temp.corretor(),
                 'com a escolha, ela vale antes do anfitrião');
  return next is(app.calendly_pessoa_da_agenda(), pg_temp.corretor(),
                 'e o espelho copia a agenda da mesma pessoa');

  update public.app_settings set value = value || '{"dono_email": "ninguem154@fora.local"}' where key = 'calendly';
  perform pg_temp.entrar(pg_temp.admin(), 'admin');
  v := public.calendly_quem_atende();
  perform pg_temp.sair();
  return next ok(app.calendly_dono('A154.Anfitriao@teste.local') = pg_temp.anfitria()
                 and v ->> 'pessoa_id' is null and v ->> 'email_sem_pessoa' = 'ninguem154@fora.local',
                 'e-mail que não é de ninguém ativo: volta ao anfitrião, e o campo avisa');

  perform pg_temp.entrar(pg_temp.admin(), 'admin');
  v := public.calendly_quem_atende_gravar(null);
  perform pg_temp.sair();
  return next ok(v ->> 'pessoa_id' is null
                 and (select s.value ->> 'dono_email' from public.app_settings s where s.key = 'calendly') is null
                 and app.calendly_dono('a154.anfitriao@teste.local') = pg_temp.anfitria(),
                 'sem escolha de novo: o anfitrião');

  -- O resto do arquivo atende com o corretor escolhido.
  perform pg_temp.entrar(pg_temp.admin(), 'admin');
  perform public.calendly_quem_atende_gravar(pg_temp.corretor());
  perform pg_temp.sair();
  return next is(app.calendly_dono('a154.anfitriao@teste.local'), pg_temp.corretor(),
                 'escolhido de novo, vale de novo');
end $parte$;
select * from pg_temp.parte_dono();

-- ---------------------------------------------------------------------
-- 4. O responsável da ficha e do negócio
-- ---------------------------------------------------------------------
create function pg_temp.parte_responsavel() returns setof text language plpgsql as $parte$
declare
  v_pipe int := (select p.id from public.pipelines p where p.slug = 'produtor');
  v_etapa int := (select st.id from public.stages st
                   where st.pipeline_id = (select p.id from public.pipelines p where p.slug = 'produtor')
                     and st.is_entry order by st.position limit 1);
  v_x uuid;
  v_y uuid;
begin
  if pg_temp.na_komune() then
    return next skip('O Calendly é só da Imova', 5);
    return;
  end if;

  return next ok((select o.owner_id from public.organizations o where o.id = pg_temp.org('U1')) = pg_temp.anfitria()
                 and (select d.owner_id from public.deals d
                       where d.id = (pg_temp.ag('U1') ->> 'deal_id')::uuid) = pg_temp.anfitria(),
                 'a ficha e o negócio novos nascem com quem atende (sem escolha, a anfitriã)');
  return next ok((select o.owner_id from public.organizations o where o.id = pg_temp.org('U3')) = pg_temp.corretor()
                 and (select d.owner_id from public.deals d
                       where d.id = (pg_temp.ag('U3') ->> 'deal_id')::uuid) = pg_temp.corretor(),
                 'com a escolha, com a pessoa escolhida');
  return next is((select o.owner_id from public.organizations o where o.id = pg_temp.org('F1')),
                 pg_temp.anfitria(),
                 'mesmo recusada (feriado), a ficha nova fica com quem atende: é quem recebe o push');

  -- Uma ficha que já tem responsável (o admin), e uma que não tem, as duas
  -- com o negócio aberto.
  insert into public.organizations (kind, name, phone_e164, source_id, collector, owner_id)
  select 'produtor', 'Cliente X 154', '+5584988871541', s.id, 'pgTAP', pg_temp.admin()
    from public.sources s order by s.id limit 1
  returning id into v_x;
  insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
  values (v_x, v_pipe, v_etapa, pg_temp.admin());
  insert into public.organizations (kind, name, phone_e164, source_id, collector)
  select 'produtor', 'Cliente Y 154', '+5584988871542', s.id, 'pgTAP'
    from public.sources s order by s.id limit 1
  returning id into v_y;
  insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
  values (v_y, v_pipe, v_etapa, null);

  perform pg_temp.receber('X', pg_temp.ev('invitee.created', 'X', pg_temp.util('13:00'), 30,
                                          '{"telefone": "84 98887-1541"}'));
  return next ok(pg_temp.r('X') ->> 'ficha' = 'ligada'
                 and (select o.owner_id from public.organizations o where o.id = v_x) = pg_temp.admin()
                 and (select d.owner_id from public.deals d where d.organization_id = v_x) = pg_temp.admin(),
                 'a ficha que já tem responsável continua com o dela (e o negócio também)');
  perform pg_temp.receber('Y', pg_temp.ev('invitee.created', 'Y', pg_temp.util('14:00'), 30,
                                          '{"telefone": "+5584988871542"}'));
  return next ok(pg_temp.r('Y') ->> 'ficha' = 'ligada'
                 and (select o.owner_id from public.organizations o where o.id = v_y) = pg_temp.corretor()
                 and (select d.owner_id from public.deals d where d.organization_id = v_y) = pg_temp.corretor(),
                 'a ficha sem responsável ganha quem atende, e o negócio dela também');
end $parte$;
select * from pg_temp.parte_responsavel();

-- ---------------------------------------------------------------------
-- 5. O endereço da visita
-- ---------------------------------------------------------------------
create function pg_temp.parte_endereco() returns setof text language plpgsql as $parte$
declare
  v_im uuid;
  v_sa uuid;
begin
  if pg_temp.na_komune() then
    return next skip('O Calendly é só da Imova', 9);
    return;
  end if;

  -- A pergunta do protótipo, com o evento em Google Meet.
  perform pg_temp.receber('E1', pg_temp.ev('invitee.created', 'E1', pg_temp.util('15:00'), 45, pg_temp.visita(
    '[{"pergunta": "O que você quer marcar?", "resposta": "Visita a um imóvel"},
      {"pergunta": "Endereço ou código do imóvel", "resposta": "Rua das Dunas, 154 - Ponta Negra"}]')));
  return next is(pg_temp.ag('E1') ->> 'local', 'Rua das Dunas, 154 - Ponta Negra',
                 'o endereço que o cliente escreveu é o local da visita (e não "a combinar")');
  return next ok(pg_temp.ag('E1') ->> 'formato' = 'presencial' and pg_temp.ag('E1') ->> 'link' is null,
                 'visita é presencial, sem a sala do Meet');

  -- Dois anúncios: um com o código novo e um com o sufixo do sistema antigo.
  insert into public.anuncios (codigo, situacao, titulo, endereco, numero, bairro, cidade, estado)
  values ('IM9154', 'no_ar', 'Apartamento 154', 'Rua Teste 154', '10', 'Ponta Negra', 'Natal', 'RN')
  returning id into v_im;
  insert into public.anuncios (codigo, situacao, titulo, endereco, numero, complemento, bairro, cidade)
  values ('SA9155_IMOVA', 'rascunho', 'Sala 155', 'Avenida 155, 900', '900', 'Sala 3', 'Lagoa Nova', 'Natal')
  returning id into v_sa;

  perform pg_temp.receber('E2', pg_temp.ev('invitee.created', 'E2', pg_temp.util('16:00'), 45, pg_temp.visita(
    '[{"pergunta": "Endereço ou código do imóvel", "resposta": "IM9154"}]')));
  return next is(pg_temp.ag('E2') ->> 'local', 'Rua Teste 154, 10, Ponta Negra, Natal (anúncio IM9154)',
                 'o código do anúncio vira o endereço dele, com o código citado');
  return next is((pg_temp.ag('E2') ->> 'anuncio_id')::uuid, v_im, 'e o agendamento guarda o anúncio');
  return next ok((select t.kind::text from public.tasks t where t.id = (pg_temp.r('E2') ->> 'task_id')::uuid) = 'visit',
                 'a visita entra na agenda');

  perform pg_temp.receber('E3', pg_temp.ev('invitee.created', 'E3', pg_temp.util('17:00'), 45, pg_temp.visita(
    '[{"pergunta": "Qual o código do imóvel?", "resposta": "Quero ver o sa 9155, por favor"}]')));
  return next is(pg_temp.ag('E3') ->> 'local',
                 'Avenida 155, 900, Sala 3, Lagoa Nova, Natal (anúncio SA9155_IMOVA)',
                 'o código no meio da frase, sem os zeros e sem o sufixo, também acha o anúncio');

  perform pg_temp.receber('E4', pg_temp.ev('invitee.created', 'E4', pg_temp.util('17:50'), 45, pg_temp.visita(
    '[{"pergunta": "Endereço ou código do imóvel", "resposta": "IM9999"}]')));
  return next is(pg_temp.ag('E4') ->> 'local', 'Local a combinar (o Calendly não informou)',
                 'código que não é de anúncio nenhum: o lugar fica a combinar');

  perform pg_temp.receber('E5', pg_temp.ev('invitee.created', 'E5', pg_temp.util('10:30'), 30, jsonb_build_object(
    'respostas', '[{"pergunta": "Endereço ou código do imóvel", "resposta": "Rua das Dunas, 154"}]'::jsonb)));
  return next ok(pg_temp.ag('E5') ->> 'natureza' = 'reuniao' and pg_temp.ag('E5') ->> 'local' is null
                 and (select r.local from public.reunioes r where r.id = (pg_temp.r('E5') ->> 'reuniao_id')::uuid) is null,
                 'a reunião on-line não ganha endereço');

  return next ok((pg_temp.ag('E1') ->> 'respostas') like '%Rua das Dunas, 154 - Ponta Negra%',
                 'a resposta continua guardada com as outras');
end $parte$;
select * from pg_temp.parte_endereco();

-- ---------------------------------------------------------------------
-- 6. O cancelamento que falhou de vez
-- ---------------------------------------------------------------------
create function pg_temp.parte_falhas() returns setof text language plpgsql as $parte$
declare
  v_f1 uuid;
  v_s1 uuid;
  v_s2 uuid;
  v_linha record;
begin
  if pg_temp.na_komune() then
    return next skip('O Calendly é só da Imova', 10);
    return;
  end if;
  v_f1 := pg_temp.ag_id('F1');
  v_s1 := pg_temp.ag_id('S1');
  v_s2 := pg_temp.ag_id('S2');

  -- O worker tentou: o F1 o Calendly recusou de vez (token errado), o S1
  -- falhou uma vez só (ainda vai tentar), o S2 esgotou as oito.
  perform public.calendly_cancelamento_falhou(v_f1, 'Calendly 401: Unauthenticated', true);
  perform public.calendly_cancelamento_falhou(v_s1, 'Calendly 503');
  update public.calendly_agendamentos set cancelar_tentativas = 7 where id = v_s2;
  perform public.calendly_cancelamento_falhou(v_s2, 'Calendly 500');

  perform pg_temp.entrar(pg_temp.anfitria(), 'gestor');
  return next ok(v_f1 in (select pg_temp.falhas()) and v_s2 in (select pg_temp.falhas())
                 and v_s1 not in (select pg_temp.falhas()),
                 'o dono vê o que esgotou as tentativas (ou foi recusado de vez), e não o que ainda vai tentar');
  select * into v_linha from public.calendly_cancelamentos_que_falharam() f where f.id = v_f1;
  return next ok(v_linha.cliente = 'Cliente F1' and v_linha.natureza = 'visita'
                 and v_linha.erro = 'Calendly 401: Unauthenticated'
                 and v_linha.dono_id = pg_temp.anfitria() and v_linha.inicio is not null,
                 'com o nome do cliente, o dia, o dono e o erro, para a frase do aviso');
  perform pg_temp.sair();

  perform pg_temp.entrar(pg_temp.admin(), 'admin');
  return next ok(v_f1 in (select pg_temp.falhas()), 'o admin vê o de todo mundo');
  perform pg_temp.sair();

  perform pg_temp.entrar(pg_temp.outro(), 'sdr');
  return next ok(v_f1 not in (select pg_temp.falhas()), 'outra pessoa não vê');
  return next throws_ok(format('select public.calendly_cancelamento_resolvido(%L::uuid)', v_f1),
                        '42501', null, 'nem marca como resolvido');
  perform pg_temp.sair();

  perform pg_temp.entrar(pg_temp.anfitria(), 'gestor');
  return next ok(public.calendly_cancelamento_resolvido(v_f1), 'o dono marca como resolvido');
  return next ok(v_f1 not in (select pg_temp.falhas()) and not public.calendly_cancelamento_resolvido(v_f1),
                 'e o aviso sai (marcar de novo não faz nada)');
  perform pg_temp.sair();
  return next is((select a.cancelar_resolvido_por from public.calendly_agendamentos a where a.id = v_f1),
                 pg_temp.anfitria(), 'fica registrado quem resolveu');

  -- Alguém cancelou o S2 no Calendly: o aviso que o Calendly manda tira da lista.
  perform pg_temp.receber('S2-cancelada', pg_temp.ev('invitee.canceled', 'S2',
            pg_temp.em((select sabado + 1 from t154_dia), '15:00'), 30,
            '{"cancelamento": {"por": "anfitriao", "motivo": null}}'));
  perform pg_temp.entrar(pg_temp.admin(), 'admin');
  return next ok(v_s2 not in (select pg_temp.falhas()),
                 'quando o Calendly confirma o cancelamento, o aviso sai sozinho');
  perform pg_temp.sair();
  return next is(pg_temp.pendente('F1'), null, 'e o que esgotou não volta para a fila do worker');
end $parte$;
select * from pg_temp.parte_falhas();

-- ---------------------------------------------------------------------
-- 7. Quem chama o quê, e o WhatsApp
-- ---------------------------------------------------------------------
create function pg_temp.parte_privilegios() returns setof text language plpgsql as $parte$
declare
  v_s1 uuid;
begin
  if pg_temp.na_komune() then
    return next skip('O Calendly é só da Imova', 9);
    return;
  end if;
  v_s1 := pg_temp.ag_id('S1');

  return next ok(not has_function_privilege('anon', 'public.calendly_quem_atende()', 'execute')
                 and not has_function_privilege('anon', 'public.calendly_quem_atende_gravar(uuid)', 'execute')
                 and not has_function_privilege('anon', 'public.calendly_cancelamentos_que_falharam()', 'execute')
                 and not has_function_privilege('anon', 'public.calendly_cancelamento_resolvido(uuid)', 'execute'),
                 'anon não chama nenhuma das funções novas');
  return next ok(has_function_privilege('authenticated', 'public.calendly_quem_atende()', 'execute')
                 and has_function_privilege('authenticated', 'public.calendly_quem_atende_gravar(uuid)', 'execute')
                 and has_function_privilege('authenticated', 'public.calendly_cancelamentos_que_falharam()', 'execute')
                 and has_function_privilege('authenticated', 'public.calendly_cancelamento_resolvido(uuid)', 'execute'),
                 'a sessão chama as quatro da tela (e cada uma confere o papel por dentro)');
  return next ok(not has_function_privilege('authenticated', 'public.calendly_receber(jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'public.calendly_cancelamentos_pendentes(int)', 'execute')
                 and not has_function_privilege('authenticated', 'app.calendly_ficha(text, text, text, uuid)', 'execute')
                 and not has_function_privilege('authenticated', 'app.calendly_local_da_visita(jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'app.calendly_codigo_do_anuncio(text)', 'execute')
                 and not has_function_privilege('authenticated', 'app.calendly_pessoa_escolhida()', 'execute'),
                 'a sessão não chama a porta do webhook, a fila do worker nem as funções de dentro');
  return next ok(has_function_privilege('service_role', 'public.calendly_receber(jsonb)', 'execute')
                 and has_function_privilege('service_role', 'public.calendly_cancelamentos_pendentes(int)', 'execute'),
                 'a Edge Function e o worker continuam chamando');
  return next ok(not has_function_privilege('anon', 'public.calendly_receber(jsonb)', 'execute'),
                 'anon não chama calendly_receber');
  return next is((select p.prosecdef from pg_proc p where p.oid = 'public.calendly_cancelamentos_que_falharam()'::regprocedure)
                 and (select p.prosecdef from pg_proc p where p.oid = 'public.calendly_quem_atende_gravar(uuid)'::regprocedure),
                 true, 'as funções da tela rodam como dono (a tabela e app_settings não abrem para a sessão)');

  perform pg_temp.entrar(pg_temp.anfitria(), 'gestor');
  return next throws_ok(format('update public.calendly_agendamentos set cancelar_resolvido_em = now() where id = %L::uuid',
                               v_s1),
                        '42501', null, 'ninguém marca resolvido direto na tabela: só pela função');
  perform pg_temp.sair();

  -- O `safeupdate` da API recusa UPDATE e DELETE sem WHERE (ver o 123).
  return next is(
    (select count(*)::int
       from pg_proc p
      cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
      where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
        and p.proname like 'calendly%'
        and comando ~* '(^|\n)\s*(update|delete)\s'
        and comando !~* '\swhere\s'),
    0, 'nenhuma função do Calendly tem UPDATE ou DELETE sem WHERE');
  return next is((select count(*) from public.messages), (select mensagens from t154_antes),
                 'nenhuma mensagem de WhatsApp nasce de nada disto');
end $parte$;
select * from pg_temp.parte_privilegios();

select * from finish();
rollback;

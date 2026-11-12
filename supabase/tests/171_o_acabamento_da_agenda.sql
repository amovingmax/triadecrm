-- =====================================================================
-- pgTAP — O acabamento da Agenda (migração 20261111211000), só na Imova
--
-- Prova:
--   1. SÓ NA IMOVA: na KOMUNE as funções, o gatilho e a casca do dossiê não
--      existem, e o dossiê dela continua sem o Calendly;
--   2. A AGENDA DO LINK: quem atende o Calendly e se o espelho está ligado, só
--      para quem está logado, sem mexer na configuração;
--   3. O DOSSIÊ: a casca conserva tudo o que a definição de antes devolve (o que
--      outras migrações puseram nela, como o convite da agenda, fica igual) e
--      acrescenta os agendamentos do titular, sem links, URIs nem conflitos; a
--      frase da retenção ganha a do Calendly; o pedido pela porta de sempre
--      (`exportar_lgpd`) traz a parte nova; a base não chama a casca;
--   4. A RETENÇÃO: 2 anos depois da data marcada (ou da última mudança), com
--      relatório em `retention_runs` e o agendamento no pg_cron;
--   5. A EXCLUSÃO A PEDIDO: o pedido de eliminação da ficha, ou da pessoa ligada
--      a ela, anonimiza os agendamentos dela e não os dos outros; opt-out não é
--      eliminação;
--   6. QUEM CHAMA O QUÊ.
--
-- O MESMO ARQUIVO RODA NOS DOIS BANCOS, como o 154: as partes da Imova moram em
-- funções plpgsql (`pg_temp.parte_*`), cujo corpo só é resolvido quando roda; no
-- banco da KOMUNE elas saem como SKIP e só a parte 1 prova alguma coisa.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(34);

insert into public.allowed_users (email, role, note) values
  ('a158.atende@teste.local', 'gestor', 'pgTAP 158'),
  ('a158.sdr@teste.local', 'sdr', 'pgTAP 158');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000015801'::uuid, 'a158.atende@teste.local', '{"full_name":"Ana Atende 158"}'),
  ('a0000000-0000-4000-8000-000000015802'::uuid, 'a158.sdr@teste.local', '{"full_name":"Saulo SDR 158"}');

create function pg_temp.na_komune() returns boolean language sql stable as
  $$ select coalesce((select i.empresa from app.identidade i) = 'komune', false) $$;
create function pg_temp.atende() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000015801'::uuid $$;
create function pg_temp.sdr() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000015802'::uuid $$;

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

-- Três fichas (as duas empresas têm `organizations`): a do titular, a de outra
-- pessoa, e a que o pedido alcança pela pessoa ligada a ela.
create temp table t158_org (chave text primary key, id uuid);
with novas as (
  insert into public.organizations (kind, name, source_id, collector)
  select 'produtor', 'Cliente ' || v.chave || ' 158',
         (select s.id from public.sources s order by s.id limit 1), 'pgTAP 158'
    from (values ('titular'), ('outra'), ('pela_pessoa')) v(chave)
  returning id, name)
insert into t158_org
select regexp_replace(name, '^Cliente (.*) 158$', '\1'), id from novas;
grant select on t158_org to authenticated;
create function pg_temp.org(p text) returns uuid language sql as
  $$ select id from t158_org where chave = p $$;

-- ---------------------------------------------------------------------
-- 1. Só na Imova (prova nos dois bancos)
-- ---------------------------------------------------------------------
select is(to_regprocedure('public.calendly_agenda_do_link()') is not null
          and to_regprocedure('app.calendly_aplicar_retencao()') is not null
          and to_regprocedure('app.calendly_eliminar_do_titular()') is not null
          and to_regprocedure('app.lgpd_dossie_sem_o_calendly(uuid)') is not null,
          not pg_temp.na_komune(),
          'as funções novas e a base do dossiê existem na Imova, e não na KOMUNE');
select is(exists (select 1 from pg_trigger t
                   where t.tgrelid = 'public.consent_events'::regclass
                     and t.tgname = 'consent_events_calendly_eliminar'),
          not pg_temp.na_komune(),
          'o gatilho da exclusão a pedido existe só na Imova');
select ok(to_regprocedure('app.lgpd_dossie(uuid)') is not null,
          'o dossiê continua com o nome de sempre nas duas empresas');
select is(app.lgpd_dossie(pg_temp.org('titular')) ? 'agendamentos_do_calendly',
          not pg_temp.na_komune(),
          'o dossiê traz os agendamentos do Calendly na Imova; o da KOMUNE fica como era');

-- ---------------------------------------------------------------------
-- 2. A agenda que o link oferece
-- ---------------------------------------------------------------------
create function pg_temp.parte_agenda_do_link() returns setof text language plpgsql as $parte$
declare
  v jsonb;
  v_antes jsonb;
begin
  if pg_temp.na_komune() then
    return next skip('O Calendly é só da Imova', 6);
    return;
  end if;

  -- Quem atende é a Ana; o espelho ainda sem o id da agenda.
  insert into public.app_settings (key, value, description)
  values ('calendly', jsonb_build_object('dono_email', 'a158.atende@teste.local',
                                         'google_agenda_id', null), 'pgTAP 158')
  on conflict (key) do update set value = excluded.value;

  return next throws_ok($$ select public.calendly_agenda_do_link() $$, '42501', null,
                        'sem login, a função recusa');

  perform pg_temp.entrar(pg_temp.sdr(), 'sdr');
  v := public.calendly_agenda_do_link();
  perform pg_temp.sair();
  return next is(v ->> 'pessoa_id', pg_temp.atende()::text,
                 'a agenda do link é a de quem atende o Calendly (a mesma do espelho)');
  return next is(v -> 'espelho_ligado', 'false'::jsonb,
                 'sem google_agenda_id, o espelho está desligado');

  update public.app_settings
     set value = value || jsonb_build_object('google_agenda_id', 'agenda-158@group.calendar.google.com')
   where key = 'calendly';
  select s.value into v_antes from public.app_settings s where s.key = 'calendly';
  perform pg_temp.entrar(pg_temp.sdr(), 'sdr');
  v := public.calendly_agenda_do_link();
  perform pg_temp.sair();
  return next is(v -> 'espelho_ligado', 'true'::jsonb,
                 'com o id da agenda gravado, o espelho está ligado');
  return next is((select s.value from public.app_settings s where s.key = 'calendly'), v_antes,
                 'ler a agenda do link não mexe na configuração do Calendly');
  return next ok(v ?& array['pessoa_id', 'espelho_ligado'] and
                 (select count(*) from jsonb_object_keys(v)) = 2,
                 'a resposta só diz quem e se o espelho está ligado (nada do id da agenda nem e-mail)');
end $parte$;
select * from pg_temp.parte_agenda_do_link();

-- ---------------------------------------------------------------------
-- 3. O dossiê da LGPD
-- ---------------------------------------------------------------------
create function pg_temp.parte_dossie() returns setof text language plpgsql as $parte$
declare
  v jsonb;
  v_base jsonb;
  v_item jsonb;
begin
  if pg_temp.na_komune() then
    return next skip('O Calendly é só da Imova', 9);
    return;
  end if;

  insert into public.calendly_agendamentos
    (convidado_uri, evento_uri, situacao, natureza, inicio, fim, formato, local, respostas,
     organization_id, link_cancelar, link_remarcar, conflitos, recebido_em)
  values
    ('https://api.calendly.com/scheduled_events/EV158A/invitees/IN158A',
     'https://api.calendly.com/scheduled_events/EV158A', 'agendado', 'visita',
     now() + interval '3 days', now() + interval '3 days 45 minutes', 'presencial',
     'Rua das Dunas, 158, Ponta Negra',
     '[{"pergunta": "Endereço ou código do imóvel", "resposta": "Rua das Dunas, 158"}]'::jsonb,
     pg_temp.org('titular'), 'https://calendly.com/cancellations/IN158A',
     'https://calendly.com/reschedulings/IN158A',
     '[{"tipo": "visita", "titulo": "Visita: outra pessoa", "inicio": "2026-11-20T12:00:00Z"}]'::jsonb,
     now() - interval '1 day'),
    ('https://api.calendly.com/scheduled_events/EV158B/invitees/IN158B',
     'https://api.calendly.com/scheduled_events/EV158B', 'cancelado', 'reuniao',
     now() - interval '2 days', now() - interval '2 days' + interval '45 minutes', 'online', null,
     '[]'::jsonb, pg_temp.org('titular'), null, null, '[]'::jsonb, now() - interval '5 days'),
    ('https://api.calendly.com/scheduled_events/EV158C/invitees/IN158C',
     'https://api.calendly.com/scheduled_events/EV158C', 'agendado', 'reuniao',
     now() + interval '4 days', now() + interval '4 days 45 minutes', 'online', null,
     '[]'::jsonb, pg_temp.org('outra'), null, null, '[]'::jsonb, now());

  v := app.lgpd_dossie(pg_temp.org('titular'));
  v_base := app.lgpd_dossie_sem_o_calendly(pg_temp.org('titular'));

  return next is(v - 'agendamentos_do_calendly' - 'retencao', v_base - 'retencao',
                 'a casca conserva tudo o que a definição de antes devolve (inclusive o que outra migração pôs nela)');
  return next is(v ->> 'retencao',
                 (v_base ->> 'retencao') || ' Os agendamentos feitos pelo Calendly ficam 2 anos depois da data marcada.',
                 'a frase da retenção ganha a do Calendly, depois da de antes');
  return next is(jsonb_array_length(v -> 'agendamentos_do_calendly'), 2,
                 'os dois agendamentos do titular, e não o de outra ficha');
  select e into v_item from jsonb_array_elements(v -> 'agendamentos_do_calendly') e
   where e ->> 'tipo' = 'visita';
  return next ok(v_item ->> 'local' = 'Rua das Dunas, 158, Ponta Negra'
                 and v_item -> 'respostas' -> 0 ->> 'resposta' = 'Rua das Dunas, 158'
                 and v_item ->> 'tipo' = 'visita' and v_item ->> 'situacao' = 'agendado',
                 'o agendamento traz o local, as respostas, o tipo e a situação');
  return next ok(not (v_item ?| array['link_cancelar', 'link_remarcar', 'convidado_uri',
                                      'evento_uri', 'conflitos', 'dono_id'])
                 and position('calendly.com/cancellations' in v::text) = 0
                 and position('outra pessoa' in v::text) = 0,
                 'sem os links de cancelar e remarcar, sem as URIs e sem os compromissos de outras pessoas');
  return next is(app.lgpd_dossie('00000000-0000-4000-8000-000000000158'::uuid),
                 app.lgpd_dossie_sem_o_calendly('00000000-0000-4000-8000-000000000158'::uuid),
                 'ficha que não existe: a mesma recusa de antes');
  return next ok(position('agendamentos_do_calendly' in
                          pg_get_functiondef('app.lgpd_dossie_sem_o_calendly(uuid)'::regprocedure)) = 0,
                 'a base é a definição de antes, e não a casca (a troca de nome foi uma vez só)');

  perform pg_temp.entrar(pg_temp.atende(), 'gestor');
  v := public.exportar_lgpd(pg_temp.org('titular'), 'pgTAP 158');
  perform pg_temp.sair();
  return next is(jsonb_array_length(v -> 'agendamentos_do_calendly'), 2,
                 'o pedido pela porta de sempre (exportar_lgpd) traz os agendamentos');
  return next ok(not has_function_privilege('authenticated', 'app.lgpd_dossie(uuid)', 'execute')
                 and not has_function_privilege('anon', 'app.lgpd_dossie(uuid)', 'execute')
                 and not has_function_privilege('authenticated', 'app.lgpd_dossie_sem_o_calendly(uuid)', 'execute')
                 and has_function_privilege('service_role', 'app.lgpd_dossie(uuid)', 'execute'),
                 'a casca e a base seguem só para o servidor, como o dossiê sempre foi');
end $parte$;
select * from pg_temp.parte_dossie();

-- ---------------------------------------------------------------------
-- 4. A retenção
-- ---------------------------------------------------------------------
create function pg_temp.parte_retencao() returns setof text language plpgsql as $parte$
declare
  v jsonb;
  v_runs int := (select count(*) from public.retention_runs);
begin
  if pg_temp.na_komune() then
    return next skip('O Calendly é só da Imova', 6);
    return;
  end if;

  insert into public.calendly_agendamentos
    (convidado_uri, evento_uri, situacao, natureza, inicio, fim, respostas, organization_id,
     recebido_em, atualizado_em)
  values
    -- Marcado para 3 anos atrás, sem mudança desde então: sai.
    ('https://api.calendly.com/scheduled_events/EV158V/invitees/IN158V',
     'https://api.calendly.com/scheduled_events/EV158V', 'agendado', 'visita',
     now() - interval '3 years', now() - interval '3 years' + interval '45 minutes',
     '[{"pergunta": "x", "resposta": "velho"}]'::jsonb, pg_temp.org('titular'),
     now() - interval '3 years 1 day', now() - interval '3 years'),
    -- Marcado há 3 anos, mas mudou há um mês (o cancelamento chegou agora): fica.
    ('https://api.calendly.com/scheduled_events/EV158M/invitees/IN158M',
     'https://api.calendly.com/scheduled_events/EV158M', 'cancelado', 'reuniao',
     now() - interval '3 years', now() - interval '3 years' + interval '45 minutes',
     '[]'::jsonb, pg_temp.org('titular'), now() - interval '3 years 1 day', now() - interval '1 month'),
    -- Recebido há 3 anos para daqui a uma semana (agendamento muito antecipado): fica.
    ('https://api.calendly.com/scheduled_events/EV158F/invitees/IN158F',
     'https://api.calendly.com/scheduled_events/EV158F', 'agendado', 'reuniao',
     now() + interval '7 days', now() + interval '7 days 45 minutes',
     '[]'::jsonb, pg_temp.org('titular'), now() - interval '3 years', now() - interval '3 years'),
    -- Um ano e onze meses: ainda dentro dos 2 anos.
    ('https://api.calendly.com/scheduled_events/EV158R/invitees/IN158R',
     'https://api.calendly.com/scheduled_events/EV158R', 'agendado', 'visita',
     now() - interval '23 months', now() - interval '23 months' + interval '45 minutes',
     '[]'::jsonb, pg_temp.org('titular'), now() - interval '23 months', now() - interval '23 months');

  v := app.calendly_aplicar_retencao();
  return next ok(not exists (select 1 from public.calendly_agendamentos
                              where convidado_uri like '%IN158V'),
                 'o agendamento de 3 anos atrás, sem mudança, sai');
  return next is((select count(*)::int from public.calendly_agendamentos
                   where convidado_uri ~ 'IN158(M|F|R)$'), 3,
                 'ficam o que mudou há pouco, o marcado para a frente e o de menos de 2 anos');
  return next ok((v ->> 'calendly_agendamentos')::int >= 1,
                 'a faxina conta quantos saíram');
  return next is((select count(*)::int from public.retention_runs), v_runs + 1,
                 'e deixa o relatório em retention_runs, como a faxina geral');
  return next is((app.calendly_aplicar_retencao() ->> 'calendly_agendamentos')::int, 0,
                 'rodar de novo não apaga mais nada');
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    return next is((select count(*)::int from cron.job where jobname = 'calendly_retencao'
                       and command like '%app.calendly_aplicar_retencao()%'), 1,
                   'a faxina do Calendly está no pg_cron, uma vez');
  else
    return next skip('banco sem pg_cron', 1);
  end if;
end $parte$;
select * from pg_temp.parte_retencao();

-- ---------------------------------------------------------------------
-- 5. A exclusão a pedido
-- ---------------------------------------------------------------------
create function pg_temp.parte_exclusao() returns setof text language plpgsql as $parte$
declare
  v_contato uuid;
  v_ag jsonb;
begin
  if pg_temp.na_komune() then
    return next skip('O Calendly é só da Imova', 5);
    return;
  end if;

  -- Opt-out não é eliminação: o agendamento fica como estava.
  insert into public.consent_events (kind, organization_id, channel, evidence_text)
  values ('contact_optout'::app.consent_kind, pg_temp.org('titular'), 'whatsapp'::app.channel,
          'pgTAP 158: sair');
  return next ok(exists (select 1 from public.calendly_agendamentos
                          where convidado_uri like '%IN158A' and local is not null
                            and respostas <> '[]'::jsonb and link_cancelar is not null),
                 'o opt-out não apaga nada do agendamento');

  insert into public.consent_events (kind, organization_id, channel, evidence_text)
  values ('erasure_request'::app.consent_kind, pg_temp.org('titular'), 'email'::app.channel,
          'pgTAP 158: apaguem meus dados');
  select to_jsonb(a) into v_ag from public.calendly_agendamentos a
   where a.convidado_uri like '%IN158A';
  return next ok(v_ag -> 'respostas' = '[]'::jsonb and v_ag ->> 'local' is null
                 and v_ag ->> 'link' is null and v_ag ->> 'link_cancelar' is null
                 and v_ag ->> 'link_remarcar' is null and v_ag ->> 'motivo_cancelamento' is null,
                 'o pedido de eliminação apaga as respostas, o local, a sala, os links e o motivo');
  return next ok(v_ag ->> 'situacao' = 'agendado' and v_ag ->> 'inicio' is not null
                 and v_ag ->> 'evento_uri' like '%EV158A',
                 'e conserva a data, a situação e as URIs (para o CRM ainda poder cancelar no Calendly)');
  return next ok(not exists (select 1 from public.calendly_agendamentos
                              where organization_id = pg_temp.org('titular')
                                and (respostas <> '[]'::jsonb or local is not null)),
                 'todos os agendamentos do titular, e não só um');

  -- O pedido chega pela pessoa (o contato), e não pela ficha.
  insert into public.contacts (full_name) values ('Pessoa 158') returning id into v_contato;
  insert into public.organization_contacts (organization_id, contact_id)
  values (pg_temp.org('pela_pessoa'), v_contato);
  insert into public.calendly_agendamentos
    (convidado_uri, evento_uri, situacao, natureza, inicio, fim, local, respostas, organization_id)
  values ('https://api.calendly.com/scheduled_events/EV158P/invitees/IN158P',
          'https://api.calendly.com/scheduled_events/EV158P', 'agendado', 'visita',
          now() + interval '5 days', now() + interval '5 days 45 minutes', 'Av. 158',
          '[{"pergunta": "x", "resposta": "y"}]'::jsonb, pg_temp.org('pela_pessoa'));
  insert into public.consent_events (kind, contact_id, channel, evidence_text)
  values ('erasure_done'::app.consent_kind, v_contato, 'email'::app.channel, 'pgTAP 158');
  return next ok(exists (select 1 from public.calendly_agendamentos
                          where convidado_uri like '%IN158P' and local is null
                            and respostas = '[]'::jsonb)
                 and exists (select 1 from public.calendly_agendamentos
                              where convidado_uri like '%IN158C'
                                and organization_id = pg_temp.org('outra')),
                 'o pedido pela pessoa alcança a ficha ligada a ela, e a ficha de outro titular fica');
end $parte$;
select * from pg_temp.parte_exclusao();

-- ---------------------------------------------------------------------
-- 6. Quem chama o quê
-- ---------------------------------------------------------------------
create function pg_temp.parte_privilegios() returns setof text language plpgsql as $parte$
begin
  if pg_temp.na_komune() then
    return next skip('O Calendly é só da Imova', 4);
    return;
  end if;
  return next ok(has_function_privilege('authenticated', 'public.calendly_agenda_do_link()', 'execute')
                 and not has_function_privilege('anon', 'public.calendly_agenda_do_link()', 'execute'),
                 'a agenda do link é de quem está logado, e não de anon');
  return next ok(not has_function_privilege('authenticated', 'app.calendly_aplicar_retencao()', 'execute')
                 and not has_function_privilege('anon', 'app.calendly_aplicar_retencao()', 'execute')
                 and has_function_privilege('service_role', 'app.calendly_aplicar_retencao()', 'execute'),
                 'a faxina é do servidor');
  return next ok(not has_function_privilege('authenticated', 'app.calendly_eliminar_do_titular()', 'execute')
                 and not has_function_privilege('anon', 'app.calendly_eliminar_do_titular()', 'execute'),
                 'a função do gatilho não é chamada por ninguém de fora');
  return next (select ok(p.prosecdef and p.proconfig @> array['search_path=""'],
                         'a agenda do link é security definer com search_path vazio')
                 from pg_proc p where p.oid = 'public.calendly_agenda_do_link()'::regprocedure);
end $parte$;
select * from pg_temp.parte_privilegios();

select * from finish();
rollback;

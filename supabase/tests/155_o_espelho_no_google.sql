-- =====================================================================
-- pgTAP — O espelho no Google sai do silêncio e leva os feriados, só na
-- Imova (migração 20261111205000)
--
-- O gargalo: o que a equipe marca no CRM continua livre no Calendly, e o
-- Calendly oferece os feriados. Este arquivo prova:
--
--   1. QUEM CHAMA: a lista e as respostas do worker continuam só do serviço;
--      o estado é de quem está logado, e o banco recusa quem não é admin nem
--      gestor; as funções internas não são de fora; nenhuma tem UPDATE ou
--      DELETE sem WHERE;
--   2. DESLIGADO: sem google_agenda_id o estado diz isso, e a passada do
--      worker já aparece ("o worker está passando");
--   3. OS FERIADOS NA LISTA: um bloco de dia inteiro por data dos próximos 12
--      meses (dois feriados na mesma data são um bloco só), com o id estável
--      tirado da data, de meia-noite a meia-noite em Natal; o passado e o que
--      está além de 12 meses ficam fora; o compromisso continua indo;
--   4. GRAVAR DE NOVO NÃO DUPLICA: gravado sai da lista, a linha é uma só e
--      sabe que é feriado;
--   5. FERIADO APAGADO OU TROCADO DE DATA tira o bloco (vai para apagar), e a
--      data nova entra;
--   6. O ESTADO: pendentes, gravados, feriados, com erro e o último erro com
--      "desde"; o acerto limpa o erro e o último erro fica como história; o
--      worker parado aparece; de quem é a agenda;
--   7. NA KOMUNE NADA ENTRA (no contêiner da KOMUNE; no da Imova, pulado).
--
-- O mesmo arquivo roda nos dois bancos: no da KOMUNE a migração não cria
-- nada, então a parte da Imova é pulada e a da KOMUNE prova que nada entrou;
-- no da Imova (e no CI, onde a migração roda inteira), o contrário.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(46);

create function pg_temp.na_imova() returns boolean language sql as
  $$ select to_regprocedure('public.agenda_espelho_estado()') is not null $$;

-- ---------------------------------------------------------------------
-- 7. Na KOMUNE nada entra
-- ---------------------------------------------------------------------
create function pg_temp.parte_komune() returns setof text language plpgsql as $$
begin
  if pg_temp.na_imova() then
    return next skip('este banco tem o espelho (Imova ou CI): a parte da KOMUNE roda no banco da KOMUNE', 4);
    return;
  end if;
  return next is((select i.empresa from app.identidade i), 'komune', 'o banco é da KOMUNE');
  return next ok(to_regprocedure('public.agenda_espelho_estado()') is null,
                 'na KOMUNE não há o estado do espelho');
  return next ok(to_regclass('app.agenda_espelho_situacao') is null
                 and to_regprocedure('app.agenda_espelho_desejado(uuid)') is null
                 and to_regprocedure('app.agenda_espelho_id_do_feriado(date)') is null,
                 'nem a situação, nem a régua do desejado, nem o id do feriado');
  return next ok(not exists (select 1 from information_schema.columns
                              where table_schema = 'app' and table_name = 'agenda_espelho'
                                and column_name in ('tipo', 'erro_em', 'erro_desde')),
                 'e a tabela do espelho (se existir) não ganhou colunas');
end $$;

select * from pg_temp.parte_komune();

-- ---------------------------------------------------------------------
-- A parte da Imova
-- ---------------------------------------------------------------------
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

create function pg_temp.admin() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000015501'::uuid $$;
create function pg_temp.gestora() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000015502'::uuid $$;
create function pg_temp.sdr() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000015503'::uuid $$;
create function pg_temp.hoje() returns date language sql as
  $$ select (now() at time zone 'America/Fortaleza')::date $$;
-- Os feriados do teste, longe do que o banco tiver de verdade.
create function pg_temp.f1() returns date language sql as $$ select pg_temp.hoje() + 10 $$;
create function pg_temp.f2() returns date language sql as $$ select pg_temp.hoje() + 20 $$;
create function pg_temp.f2_nova() returns date language sql as $$ select pg_temp.hoje() + 22 $$;
create function pg_temp.f_borda() returns date language sql as
  $$ select (pg_temp.hoje() + interval '12 months' - interval '1 day')::date $$;
create function pg_temp.f_longe() returns date language sql as
  $$ select (pg_temp.hoje() + interval '13 months')::date $$;

-- Em plpgsql, e não em sql: no banco da KOMUNE a função não existe, e o
-- corpo em sql seria conferido já ao criar.
create function pg_temp.lista(p_chave text) returns jsonb language plpgsql as
  $$ begin return public.agenda_espelho_pendencias(100) -> p_chave; end $$;
create function pg_temp.item(p_chave text, p_id uuid) returns jsonb language sql as $$
  select g from jsonb_array_elements(pg_temp.lista(p_chave)) g where (g ->> 'item_id')::uuid = p_id
$$;
create function pg_temp.estado() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.entrar(pg_temp.admin(), 'admin');
  v := public.agenda_espelho_estado();
  perform pg_temp.sair();
  return v;
end $$;

create function pg_temp.parte_imova() returns setof text language plpgsql as $$
declare
  v_visita uuid;
  v_h1     uuid;
  v_h2     uuid;
  v_h2n    uuid;
  v_e      jsonb;
  v_msgs   bigint := (select count(*) from public.messages);
  v_acoes  bigint := (select count(*) from public.wa_acoes);
begin
  if not pg_temp.na_imova() then
    return next skip('o espelho no Google é só da Imova: este banco é da KOMUNE', 42);
    return;
  end if;

  insert into public.allowed_users (email, role, note) values
    ('a155.admin@teste.local', 'admin', 'pgTAP espelho no Google'),
    ('a155.gestora@teste.local', 'gestor', 'pgTAP espelho no Google'),
    ('a155.sdr@teste.local', 'sdr', 'pgTAP espelho no Google');
  insert into auth.users (id, email, raw_user_meta_data) values
    (pg_temp.admin(), 'a155.admin@teste.local', '{"full_name":"Ari Admin"}'),
    (pg_temp.gestora(), 'a155.gestora@teste.local', '{"full_name":"Gina Gestora"}'),
    (pg_temp.sdr(), 'a155.sdr@teste.local', '{"full_name":"Sol SDR"}');

  -- Começa limpo, venha o banco como vier: sem configuração, sem nada no
  -- espelho e só com os feriados do teste.
  delete from public.app_settings where key = 'calendly';
  delete from app.agenda_espelho where item_id is not null;
  delete from app.agenda_espelho_situacao where unica;
  delete from public.holidays where id is not null;
  insert into public.holidays (date, name, scope) values
    (pg_temp.f1(), 'Feriado 155 nacional', 'nacional'),
    (pg_temp.f1(), 'Feriado 155 municipal', 'municipal'),
    (pg_temp.f2(), 'Feriado 155 que muda de data', 'nacional'),
    (pg_temp.hoje() - 3, 'Feriado 155 que já passou', 'nacional'),
    (pg_temp.f_borda(), 'Feriado 155 na borda dos 12 meses', 'nacional'),
    (pg_temp.f_longe(), 'Feriado 155 longe demais', 'nacional');
  insert into public.app_settings (key, value)
  values ('calendly', '{"dono_email": "a155.gestora@teste.local"}');

  -- Uma visita marcada pela equipe na agenda da gestora (quem atende pelo Calendly).
  insert into public.tasks (title, kind, status, priority, due_at, assignee_id, origin)
  values ('Visita 155', 'visit', 'todo', 2,
          ((pg_temp.hoje() + 5) + time '10:00') at time zone 'America/Fortaleza',
          pg_temp.gestora(), 'manual')
  returning id into v_visita;

  v_h1 := app.agenda_espelho_id_do_feriado(pg_temp.f1());
  v_h2 := app.agenda_espelho_id_do_feriado(pg_temp.f2());
  v_h2n := app.agenda_espelho_id_do_feriado(pg_temp.f2_nova());

  -- -------------------------------------------------------------------
  -- 1. Quem chama
  -- -------------------------------------------------------------------
  return next ok(has_function_privilege('authenticated', 'public.agenda_espelho_estado()', 'execute')
                 and not has_function_privilege('anon', 'public.agenda_espelho_estado()', 'execute'),
                 'o estado é de quem está logado (o banco confere o papel), e não de anônimo');
  return next ok(not has_function_privilege('authenticated', 'public.agenda_espelho_pendencias(int)', 'execute')
                 and not has_function_privilege('authenticated', 'public.agenda_espelho_gravado(uuid, timestamptz, timestamptz)', 'execute')
                 and not has_function_privilege('authenticated', 'public.agenda_espelho_apagado(uuid)', 'execute')
                 and not has_function_privilege('authenticated', 'public.agenda_espelho_falhou(uuid, timestamptz, timestamptz, text)', 'execute')
                 and not has_function_privilege('anon', 'public.agenda_espelho_pendencias(int)', 'execute'),
                 'a lista e as respostas do worker continuam fora do alcance de quem está logado');
  return next ok(has_function_privilege('service_role', 'public.agenda_espelho_pendencias(int)', 'execute')
                 and has_function_privilege('service_role', 'public.agenda_espelho_gravado(uuid, timestamptz, timestamptz)', 'execute')
                 and has_function_privilege('service_role', 'public.agenda_espelho_falhou(uuid, timestamptz, timestamptz, text)', 'execute'),
                 'o worker (service_role) chama a lista e responde');
  return next ok(not has_function_privilege('authenticated', 'app.agenda_espelho_desejado(uuid)', 'execute')
                 and not has_function_privilege('authenticated', 'app.agenda_espelho_situacao_marcar(text, text)', 'execute')
                 and not has_function_privilege('anon', 'app.agenda_espelho_id_do_feriado(date)', 'execute'),
                 'as funções internas não são de fora');
  return next is(
    (select count(*)::int
       from pg_proc p
      cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
      where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
        and p.proname like 'agenda_espelho%'
        and comando ~* '(^|\n)\s*(update|delete)\s'
        and comando !~* '\swhere\s'),
    0, 'nenhuma função do espelho tem UPDATE ou DELETE sem WHERE');

  perform pg_temp.entrar(pg_temp.sdr(), 'sdr');
  return next throws_ok('select public.agenda_espelho_estado()', '42501', null,
                        'o SDR não vê o estado do espelho (é de Ajustes)');
  perform pg_temp.sair();
  perform pg_temp.entrar(pg_temp.gestora(), 'gestor');
  return next lives_ok('select public.agenda_espelho_estado()', 'a gestora vê');
  perform pg_temp.sair();

  -- -------------------------------------------------------------------
  -- 2. Desligado
  -- -------------------------------------------------------------------
  v_e := pg_temp.estado();
  return next ok((v_e ->> 'google_agenda_id_preenchido')::boolean = false
                 and (v_e ->> 'ligado')::boolean = false
                 and (v_e ->> 'worker_passando')::boolean = false
                 and v_e -> 'worker_passou_em' = 'null'::jsonb,
                 'sem google_agenda_id e sem o worker: desligado, e o worker nunca passou');
  return next is((v_e ->> 'pendentes')::int, 4,
                 'desligado, tudo está pendente: a visita e os três feriados que valem');
  return next is(public.agenda_espelho_pendencias(100) ->> 'motivo', 'sem_google_agenda_id',
                 'a lista do worker diz por que está desligado');
  v_e := pg_temp.estado();
  return next ok((v_e ->> 'worker_passando')::boolean and (v_e ->> 'worker_passou_em') is not null
                 and not (v_e ->> 'ligado')::boolean,
                 'a passada do worker aparece no estado, mesmo desligado');
  return next is(v_e -> 'pessoa' ->> 'nome', 'Gina Gestora',
                 'o estado diz de quem é a agenda espelhada');

  -- -------------------------------------------------------------------
  -- 3. Os feriados na lista
  -- -------------------------------------------------------------------
  update public.app_settings
     set value = value || '{"google_agenda_id": "agenda155@group.calendar.google.com"}'
   where key = 'calendly';
  return next is(public.agenda_espelho_pendencias(100) ->> 'calendario', 'agenda155@group.calendar.google.com',
                 'com o id, ligado');
  return next is((select count(*)::int from jsonb_array_elements(pg_temp.lista('gravar')) g
                   where g ->> 'tipo' = 'feriado' and g ->> 'dia' = to_char(pg_temp.f1(), 'YYYY-MM-DD')),
                 1, 'dois feriados na mesma data são um bloco só');
  v_e := pg_temp.item('gravar', v_h1);
  return next ok(v_e ->> 'tipo' = 'feriado'
                 and v_e ->> 'dia' = to_char(pg_temp.f1(), 'YYYY-MM-DD')
                 and v_e ->> 'ate' = to_char(pg_temp.f1() + 1, 'YYYY-MM-DD'),
                 'o feriado vai como dia inteiro: o dia e o seguinte (fim exclusivo)');
  return next ok((v_e ->> 'inicio')::timestamptz = (pg_temp.f1() + time '00:00') at time zone 'America/Fortaleza'
                 and (v_e ->> 'fim')::timestamptz = (pg_temp.f1() + 1 + time '00:00') at time zone 'America/Fortaleza',
                 'de meia-noite a meia-noite em Natal (o worker antigo grava isso, e também bloqueia)');
  return next ok(v_e ->> 'evento_id' = replace(v_h1::text, '-', '')
                 and v_e ->> 'evento_id' ~ '^[0-9a-v]{5,}$' and char_length(v_e ->> 'evento_id') <= 1024,
                 'o id do evento sai da data e é válido para o Google (base32hex)');
  return next ok(app.agenda_espelho_id_do_feriado(pg_temp.f1()) = v_h1
                 and app.agenda_espelho_id_do_feriado(pg_temp.f1()) <> app.agenda_espelho_id_do_feriado(pg_temp.f2()),
                 'o id é estável por data, e um por data');
  return next ok(pg_temp.item('gravar', app.agenda_espelho_id_do_feriado(pg_temp.f_borda())) is not null,
                 'o feriado na borda dos 12 meses entra');
  return next ok(pg_temp.item('gravar', app.agenda_espelho_id_do_feriado(pg_temp.hoje() - 3)) is null
                 and pg_temp.item('gravar', app.agenda_espelho_id_do_feriado(pg_temp.f_longe())) is null,
                 'o que já passou e o que está além de 12 meses ficam fora');
  v_e := pg_temp.item('gravar', v_visita);
  return next ok(v_e ->> 'tipo' = 'compromisso' and not (v_e ? 'dia')
                 and v_e ->> 'evento_id' = replace(v_visita::text, '-', ''),
                 'a visita da equipe continua indo, com hora, como antes');

  -- -------------------------------------------------------------------
  -- 4. Gravar de novo não duplica
  -- -------------------------------------------------------------------
  perform public.agenda_espelho_gravado(v_h1, (pg_temp.f1() + time '00:00') at time zone 'America/Fortaleza',
                                        (pg_temp.f1() + 1 + time '00:00') at time zone 'America/Fortaleza');
  return next ok(pg_temp.item('gravar', v_h1) is null, 'gravado, o feriado sai da lista');
  perform public.agenda_espelho_gravado(v_h1, (pg_temp.f1() + time '00:00') at time zone 'America/Fortaleza',
                                        (pg_temp.f1() + 1 + time '00:00') at time zone 'America/Fortaleza');
  return next is((select count(*)::int from app.agenda_espelho where item_id = v_h1), 1,
                 'gravar duas vezes não duplica a linha');
  return next is((select tipo from app.agenda_espelho where item_id = v_h1), 'feriado',
                 'a linha sabe que é feriado (pelo id que sai da data)');
  perform public.agenda_espelho_gravado(v_visita, ((pg_temp.hoje() + 5) + time '10:00') at time zone 'America/Fortaleza',
                                        ((pg_temp.hoje() + 5) + time '10:45') at time zone 'America/Fortaleza');
  return next is((select tipo from app.agenda_espelho where item_id = v_visita), 'compromisso',
                 'e a visita, que é compromisso');
  perform public.agenda_espelho_gravado(v_h2, (pg_temp.f2() + time '00:00') at time zone 'America/Fortaleza',
                                        (pg_temp.f2() + 1 + time '00:00') at time zone 'America/Fortaleza');

  -- -------------------------------------------------------------------
  -- 6. O estado, ligado
  -- -------------------------------------------------------------------
  v_e := pg_temp.estado();
  return next ok((v_e ->> 'ligado')::boolean and (v_e ->> 'google_agenda_id_preenchido')::boolean
                 and v_e ->> 'google_agenda_id' = 'agenda155@group.calendar.google.com',
                 'ligado: o id preenchido e o worker passando');
  return next ok((v_e ->> 'gravados')::int = 1 and (v_e ->> 'feriados')::int = 2
                 and (v_e ->> 'pendentes')::int = 1 and (v_e ->> 'com_erro')::int = 0,
                 'uma visita e dois feriados copiados; falta o feriado da borda');
  return next ok((v_e ->> 'ultimo_gravado_em') is not null and v_e -> 'ultimo_erro' = 'null'::jsonb,
                 'o último gravado tem data, e não há erro');

  -- -------------------------------------------------------------------
  -- 5. Feriado apagado ou trocado de data
  -- -------------------------------------------------------------------
  delete from public.holidays where date = pg_temp.f1();
  return next ok(pg_temp.item('apagar', v_h1) is not null and pg_temp.item('gravar', v_h1) is null,
                 'feriado apagado: o bloco vai para apagar');
  update public.holidays set date = pg_temp.f2_nova() where date = pg_temp.f2();
  return next ok(pg_temp.item('apagar', v_h2) is not null and pg_temp.item('gravar', v_h2n) is not null,
                 'feriado trocado de data: o bloco velho sai e o da data nova entra');
  perform public.agenda_espelho_apagado(v_h1);
  perform public.agenda_espelho_apagado(v_h2);
  return next ok(pg_temp.item('apagar', v_h1) is null and pg_temp.item('apagar', v_h2) is null
                 and not exists (select 1 from app.agenda_espelho where item_id in (v_h1, v_h2)),
                 'apagados, saem da lista e da tabela');
  insert into public.holidays (date, name, scope) values (pg_temp.f1(), 'Feriado 155 de volta', 'nacional');
  return next ok(pg_temp.item('gravar', v_h1) ->> 'evento_id' = replace(v_h1::text, '-', ''),
                 'o feriado que volta usa o mesmo id (o Google restaura o evento, sem duplicar)');

  -- -------------------------------------------------------------------
  -- 6. O estado com erro, e o acerto
  -- -------------------------------------------------------------------
  perform public.agenda_espelho_falhou(v_h2n, (pg_temp.f2_nova() + time '00:00') at time zone 'America/Fortaleza',
                                       (pg_temp.f2_nova() + 1 + time '00:00') at time zone 'America/Fortaleza',
                                       'Google 403: You need to have writer access to this calendar.');
  return next ok((select tipo = 'feriado' and erro_desde is not null and erro_em is not null
                    from app.agenda_espelho where item_id = v_h2n),
                 'a falha do feriado guarda o tipo, quando errou e desde quando');
  return next ok(pg_temp.item('gravar', v_h2n) is null, 'e espera antes de tentar de novo');
  -- Uma falha antiga: o "desde" não anda quando ela se repete.
  update app.agenda_espelho set erro_desde = now() - interval '2 hours', depois_de = null
   where item_id = v_h2n;
  perform public.agenda_espelho_falhou(v_h2n, null, null, 'Google 403: Forbidden');
  return next is((select erro_desde from app.agenda_espelho where item_id = v_h2n), now() - interval '2 hours',
                 'a falha repetida mantém o "desde" da primeira');
  v_e := pg_temp.estado();
  return next ok((v_e ->> 'com_erro')::int = 1
                 and v_e -> 'ultimo_erro' ->> 'erro' = 'Google 403: Forbidden'
                 and (v_e -> 'ultimo_erro' ->> 'desde')::timestamptz = now() - interval '2 hours'
                 and (v_e -> 'ultimo_erro' ->> 'ativo')::boolean,
                 'o estado diz o erro, desde quando, e que ainda está de pé');
  perform public.agenda_espelho_gravado(v_h2n, (pg_temp.f2_nova() + time '00:00') at time zone 'America/Fortaleza',
                                        (pg_temp.f2_nova() + 1 + time '00:00') at time zone 'America/Fortaleza');
  return next ok((select erro is null and erro_em is null and erro_desde is null and tipo = 'feriado'
                    from app.agenda_espelho where item_id = v_h2n),
                 'o acerto limpa o erro do item');
  v_e := pg_temp.estado();
  return next ok((v_e ->> 'com_erro')::int = 0
                 and v_e -> 'ultimo_erro' ->> 'erro' = 'Google 403: Forbidden'
                 and not (v_e -> 'ultimo_erro' ->> 'ativo')::boolean,
                 'sem erro de pé, o último erro fica como história');

  -- O worker parou (a chave saiu do Fly, ou o worker caiu).
  update app.agenda_espelho_situacao set passou_em = now() - interval '10 minutes' where unica;
  v_e := pg_temp.estado();
  return next ok(not (v_e ->> 'worker_passando')::boolean and not (v_e ->> 'ligado')::boolean
                 and (v_e ->> 'google_agenda_id_preenchido')::boolean,
                 'o worker parado aparece: o id está lá, mas o espelho não está ligado');
  perform public.agenda_espelho_pendencias(1);
  return next ok((pg_temp.estado() ->> 'worker_passando')::boolean, 'e volta quando ele passa');
  -- Até uma vez por minuto, a passada não reescreve a linha.
  update app.agenda_espelho_situacao set passou_em = now() - interval '30 seconds' where unica;
  perform public.agenda_espelho_pendencias(1);
  return next is((select passou_em from app.agenda_espelho_situacao where unica), now() - interval '30 seconds',
                 'a passada grava no máximo uma vez por minuto');

  -- O WhatsApp não é tocado.
  return next ok((select count(*) from public.messages) = v_msgs
                 and (select count(*) from public.wa_acoes) = v_acoes,
                 'nada vai ao WhatsApp');
end $$;

select * from pg_temp.parte_imova();

select * from finish();
rollback;

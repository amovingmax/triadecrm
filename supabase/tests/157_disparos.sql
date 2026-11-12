-- =====================================================================
-- pgTAP — Disparos: o limite do dia é o da Meta (migração 20261112100000)
--
-- "Temos 2k de mensagens disponíveis para envio em massa por dia" e "eu não
-- quero que a quantidade seja determinada" (12/11/2026).
--
-- O que este arquivo prova:
--   1. O TETO DO NÚMERO, passado o aquecimento, é o da Meta: 2.000 com nota
--      verde, metade com amarela, zero com vermelha. Sem notícia da Meta,
--      volta o `depois` de antes. Nas duas primeiras semanas, o aquecimento.
--   2. A PORTEIRA não segura mais em 150 por dia nem em 60 por hora quando a
--      Meta disse o limite; sem notícia dela, os 150 continuam valendo.
--   3. O DISPARO vai até 300 por hora, e acima de 60 o relógio manda mais de
--      uma por volta; até 60, continua mandando uma.
--   4. A COTA de hoje diz quanto sobra e quanto está na fila.
--   5. A FRASE do teto não fala mais em "150".
--   6. SÓ NA KOMUNE: tudo isso depende da chave `whatsapp.envio.teto_da_meta`,
--      que a migração liga só no banco da KOMUNE. Desligada (a Imova), os
--      limites são os de antes, mesmo com a Meta dando 2.000.
--
-- ESCOPO: números, fichas e dias próprios deste arquivo. Roda em transação e
-- desfaz tudo.
-- =====================================================================
begin;
select plan(24);

create function pg_temp.num() returns text language sql immutable as $$
  select '+5584900000157'::text
$$;
-- Um segundo número, de quem a Meta nunca disse nada.
create function pg_temp.num2() returns text language sql immutable as $$
  select '+5584900000257'::text
$$;
-- Quarta-feira, 4/11/2026, 10h: dia útil, janela aberta.
create function pg_temp.quando() returns timestamptz language sql immutable as $$
  select (timestamp '2026-11-04 10:00') at time zone 'America/Fortaleza'
$$;
create function pg_temp.hoje() returns date language sql stable as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;

create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.entrar_worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.gestor() returns uuid language sql as $$
  select 'a0000000-0000-4000-8000-000000015701'::uuid
$$;
create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-0000001570' || p_n)::uuid
$$;
create function pg_temp.modelo() returns int language sql as $$
  select id from public.message_templates where template_code = 'AEB-ABR-A'
$$;
create function pg_temp.regras() returns jsonb language sql as $$
  select jsonb_object_agg(v, case when v = 'nome'
                                  then '{"campo":"nome","reserva":"tudo bem"}'::jsonb
                                  else jsonb_build_object('fixo', 'X-' || v) end)
    from unnest(app.modelo_variaveis((select body from public.message_templates
                                       where template_code = 'AEB-ABR-A'))) v
   where v not in ('atendente', 'saudacao')
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert, update on pg_temp.r to authenticated;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;
create function pg_temp.envio(p_id uuid) returns public.envios_em_massa
language sql security definer set search_path = '' as $$
  select * from public.envios_em_massa where id = p_id
$$;
grant execute on function pg_temp.envio(uuid) to authenticated;

-- A janela de horário sempre aberta para o relógio (que roda no `now()` de
-- verdade): o que se testa aqui é o teto e o ritmo, não o horário.
create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                            'fecha_em', now() + interval '4 hours')
$$;

-- Sem a chave, desligada: é o padrão de todo banco em que a migração não a
-- ligou (a Imova; e o banco local, onde o seed grava a identidade depois das
-- migrações).
update public.app_settings set value = value - 'teto_da_meta' where key = 'whatsapp.envio';
select is(app.wa_teto_segue_a_meta(), false, 'sem a chave teto_da_meta, o teto não segue a Meta');
-- Daqui em diante, este arquivo prova a KOMUNE: chave ligada.
update public.app_settings set value = value || '{"teto_da_meta": true}'::jsonb
 where key = 'whatsapp.envio';

insert into public.allowed_users (email, role, note) values
  ('d157.gestor@teste.local', 'gestor', 'pgTAP 157 disparos');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gestor(), 'd157.gestor@teste.local', '{"full_name":"Dora Disparo"}');

update public.app_settings
   set value = jsonb_set(value, '{numero_padrao}', to_jsonb(pg_temp.num())) where key = 'whatsapp.envio';
-- Aquecimento terminado há muito tempo, e o `depois` de fábrica (45).
update public.app_settings
   set value = jsonb_set(jsonb_set(value, '{inicio}', '"2026-01-01"'), '{whatsapp,depois}', '45')
 where key = 'cadencia.tetos';
update public.message_templates
   set meta_status = 'approved', meta_template_name = 'aeb_abr_a_v1', is_active = true
 where template_code = 'AEB-ABR-A';

insert into public.organizations (id, name, phone_e164, source_id)
select pg_temp.org(lpad(n::text, 2, '0')), 'D157 Disparo ' || n, '+55849000157' || lpad(n::text, 2, '0'),
       (select id from public.sources where slug = 'planilha')
  from generate_series(1, 9) n;

-- =====================================================================
-- 1. O teto do número
-- =====================================================================
select is(app.teto_do_canal('whatsapp'::app.channel, pg_temp.hoje()), 45,
  'sem notícia da Meta, passado o aquecimento, vale o `depois` de antes');

insert into public.wa_saude_numero (numero, origem, campo, qualidade, limite_atual, ocorrido_em)
values (pg_temp.num(), 'graph', 'phone_number', 'GREEN', 'TIER_2K',
        (timestamp '2026-11-01 08:00') at time zone 'America/Fortaleza');
select is(app.teto_do_canal('whatsapp'::app.channel, pg_temp.hoje()), 2000,
  'com a Meta dando 2.000 e nota verde, o teto do número é 2.000');

update public.app_settings set value = jsonb_set(value, '{inicio}', to_jsonb(pg_temp.hoje()::text))
 where key = 'cadencia.tetos';
select is(app.teto_do_canal('whatsapp'::app.channel, pg_temp.hoje()), 20,
  'número novo: a primeira semana de aquecimento continua em 20, mesmo com a Meta dando 2.000');
update public.app_settings set value = jsonb_set(value, '{inicio}', '"2026-01-01"')
 where key = 'cadencia.tetos';

-- =====================================================================
-- 2. A porteira
-- =====================================================================
insert into public.conversations (id, business_number, peer_phone_e164) values
  ('c0000000-0000-4000-8000-0000015700a1', pg_temp.num(),  '+5584911157001'),  -- a nova
  ('c0000000-0000-4000-8000-0000015700a2', pg_temp.num(),  '+5584911157002'),  -- o volume do dia
  ('c0000000-0000-4000-8000-0000015700b1', pg_temp.num2(), '+5584911157003'),  -- a nova, no número 2
  ('c0000000-0000-4000-8000-0000015700b2', pg_temp.num2(), '+5584911157004');  -- o volume, no número 2

-- 150 mensagens iniciadas pela empresa entre 8h e 8h59, em cada número. Entram
-- como eco: registro do que já saiu, que não passa pela porteira mas gasta o dia.
create function pg_temp.gastar(p_conv uuid, p_qtd int, p_de timestamp, p_sufixo text) returns void
language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, origin,
                               wa_message_id, business_initiated, is_first_contact,
                               created_at, sent_at)
  select p_conv, 'out'::app.msg_direction, 'template'::app.msg_type, 'sent'::app.msg_status,
         'Bom dia!', 'echo', 'wamid.PGTAP157.' || p_sufixo || '.' || n, true, false,
         (p_de at time zone 'America/Fortaleza') + make_interval(secs => n * 20),
         (p_de at time zone 'America/Fortaleza') + make_interval(secs => n * 20)
    from generate_series(1, p_qtd) n
$$;
select pg_temp.entrar_worker();
select pg_temp.gastar('c0000000-0000-4000-8000-0000015700a2', 150, timestamp '2026-11-04 08:00', 'A');
select pg_temp.gastar('c0000000-0000-4000-8000-0000015700b2', 150, timestamp '2026-11-04 08:00', 'B');
select pg_temp.sair();

select is(app.pode_enviar('c0000000-0000-4000-8000-0000015700a1', true, true, pg_temp.quando()) ->> 'pode',
  'true', 'com a Meta dando 2.000, a 151ª abertura do dia passa (antes parava em 150)');
select is(app.pode_enviar('c0000000-0000-4000-8000-0000015700b1', true, true, pg_temp.quando()) ->> 'motivo',
  'teto_iniciadas_dia', 'no número de quem a Meta nunca disse nada, os 150 por dia continuam valendo');

-- 61 na última hora: o teto da hora cresce com o do dia (2.000 / 8 = 250).
select pg_temp.entrar_worker();
select pg_temp.gastar('c0000000-0000-4000-8000-0000015700a2', 61, timestamp '2026-11-04 09:30', 'H');
select pg_temp.sair();
select is(app.pode_enviar('c0000000-0000-4000-8000-0000015700a1', true, true, pg_temp.quando()) ->> 'pode',
  'true', '61 na última hora não seguram mais: com 2.000 por dia, a hora vai a 250');

-- A Imova: a chave desligada, e tudo como antes, mesmo com a Meta dando 2.000.
update public.app_settings set value = value || '{"teto_da_meta": false}'::jsonb
 where key = 'whatsapp.envio';
select is(app.teto_do_canal('whatsapp'::app.channel, pg_temp.hoje()), 45,
  'chave desligada: passado o aquecimento, o teto continua o `depois` (45)');
select is(app.pode_enviar('c0000000-0000-4000-8000-0000015700a1', true, true, pg_temp.quando()) ->> 'motivo',
  'teto_do_numero', 'chave desligada: as 211 aberturas do dia param no teto de antes');
update public.app_settings set value = value || '{"teto_da_meta": true}'::jsonb
 where key = 'whatsapp.envio';
select is(app.teto_do_canal('whatsapp'::app.channel, pg_temp.hoje()), 2000,
  'e religada, volta a seguir a Meta');

-- A nota dobra o teto: amarela é metade, vermelha é zero.
insert into public.wa_saude_numero (numero, origem, campo, qualidade, ocorrido_em)
values (pg_temp.num(), 'webhook', 'phone_number_quality_update', 'YELLOW',
        (timestamp '2026-11-02 08:00') at time zone 'America/Fortaleza');
select is(app.teto_do_canal('whatsapp'::app.channel, pg_temp.hoje()), 1000,
  'nota amarela: o teto cai para a metade');
insert into public.wa_saude_numero (numero, origem, campo, qualidade, ocorrido_em)
values (pg_temp.num(), 'webhook', 'phone_number_quality_update', 'RED',
        (timestamp '2026-11-03 08:00') at time zone 'America/Fortaleza');
select is(app.teto_do_canal('whatsapp'::app.channel, pg_temp.hoje()), 0,
  'nota vermelha: o teto é zero');
select is(app.pode_enviar('c0000000-0000-4000-8000-0000015700a1', true, true, pg_temp.quando()) ->> 'motivo',
  'qualidade_vermelha', 'e com nota vermelha nada que a empresa começa sai');
insert into public.wa_saude_numero (numero, origem, campo, qualidade, ocorrido_em)
values (pg_temp.num(), 'webhook', 'phone_number_quality_update', 'GREEN',
        (timestamp '2026-11-03 12:00') at time zone 'America/Fortaleza');

-- =====================================================================
-- 3. O ritmo do disparo
-- =====================================================================
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is(public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'Rápido demais', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo(),
  'variaveis', pg_temp.regras(), 'assinatura', 'eu', 'por_hora', 301,
  'organizacoes', jsonb_build_array(pg_temp.org('01')))) ->> 'motivo', 'ritmo_invalido',
  'acima de 300 por hora o disparo não nasce');

-- Até 60 por hora: uma por volta, como sempre.
insert into pg_temp.r values ('lento', public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'Uma por minuto', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo(),
  'variaveis', pg_temp.regras(), 'assinatura', 'eu', 'por_hora', 60,
  'organizacoes', jsonb_build_array(pg_temp.org('01'), pg_temp.org('02')))));
select pg_temp.sair();
update public.envios_em_massa set proximo_em = now() - interval '5 minutes'
 where id = (pg_temp.v('lento') ->> 'id')::uuid;
select is(app.envios_em_massa_rodar(), 1, '60 por hora, mesmo atrasado: a volta manda UMA');
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is(public.envio_em_massa_mudar((pg_temp.v('lento') ->> 'id')::uuid, 'cancelar') ->> 'ok', 'true',
  'o lento sai do caminho');

-- 240 por hora: um a cada 15 s, e a volta do relógio é de 1 min.
insert into pg_temp.r values ('rapido', public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'Quatro por minuto', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo(),
  'variaveis', pg_temp.regras(), 'assinatura', 'eu', 'por_hora', 240,
  'organizacoes', jsonb_build_array(pg_temp.org('03'), pg_temp.org('04'), pg_temp.org('05'),
                                    pg_temp.org('06'), pg_temp.org('07'), pg_temp.org('08'),
                                    pg_temp.org('09')))));
select is((pg_temp.v('rapido') ->> 'itens')::int, 7, '240 por hora já é ritmo aceito');
select pg_temp.sair();

update public.envios_em_massa set proximo_em = now() - interval '5 minutes'
 where id = (pg_temp.v('rapido') ->> 'id')::uuid;
insert into pg_temp.r values ('volta', to_jsonb(app.envios_em_massa_rodar()));
-- O passo começa 1 min atrás (nunca mais que isso) e anda de 10,5 a 19,5 s:
-- cabem de 4 a 6 nesta volta, nunca o atraso inteiro de 5 min.
select ok((pg_temp.v('volta'))::int between 4 and 6,
  format('acima de 60 por hora a volta manda quantas couberem no minuto (mandou %s)', pg_temp.v('volta')));
select is((select count(*)::int from public.envios_em_massa_itens
            where envio_id = (pg_temp.v('rapido') ->> 'id')::uuid and status = 'enviada'
              and message_id is not null),
          (pg_temp.v('volta'))::int, 'cada uma saiu pela porteira, com a mensagem na fila do worker');
select ok((pg_temp.envio((pg_temp.v('rapido') ->> 'id')::uuid)).proximo_em > now(),
  'e a próxima fica para depois de agora');

-- =====================================================================
-- 4. A cota de hoje
-- =====================================================================
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into pg_temp.r values ('cota', public.envio_em_massa_teto());
select pg_temp.sair();
select is(pg_temp.v('cota') ->> 'quem_manda', 'meta', 'passado o aquecimento, quem manda é a Meta');
select is((pg_temp.v('cota') ->> 'sobra')::int,
          (pg_temp.v('cota') ->> 'teto')::int - (pg_temp.v('cota') ->> 'usados')::int,
  'a sobra é o teto menos o que a empresa já abriu hoje');
select is((pg_temp.v('cota') ->> 'na_fila')::int, 7 - (pg_temp.v('volta'))::int,
  'na fila: o que o disparo em curso ainda vai mandar');

-- =====================================================================
-- 5. A frase
-- =====================================================================
select ok(position('150' in app.wa_motivo_legivel('teto_iniciadas_dia')) = 0,
  'a frase do teto do dia não fala mais em 150: o teto agora é o da Meta');

select * from finish();
rollback;

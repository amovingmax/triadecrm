-- =====================================================================
-- pgTAP — Envios em massa (migração 20260921100000_envios_em_massa.sql)
--
-- "Seria pra tudo, dependendo da situação que eu escolher, e precisa ser
-- amplamente personalizável" (Rafael, 21/09/2026).
--
-- O que este arquivo prova:
--   1. SÓ ADMIN E GESTOR montam lote, e só eles leem os lotes.
--   2. O PÚBLICO diz a situação de cada ficha e por que alguém ficaria de fora.
--   3. CRIAR recusa o que não pode dar certo: variável sem regra, modelo que a
--      Meta não aprovou, público vazio.
--   4. A PRÉVIA mostra a mensagem de cada pessoa, com o nome dela ou a reserva.
--   5. O RELÓGIO manda UMA por volta, assinada por quem foi escolhido, pela
--      porteira de sempre; o suprimido é pulado com o motivo; o ritmo empurra
--      a próxima para depois.
--   6. TETO É ESPERA, não pulo: o item fica, o lote dorme.
--   7. A CORTESIA: quem recebeu mensagem nossa sem responder há menos de 72 h
--      fica de fora.
--   8. TEXTO LIVRE só para quem está com a janela de 24 h aberta.
--   9. A PARADA AUTOMÁTICA: 3 saídas acima de 2% param o lote.
--  10. PAUSAR, RETOMAR, CANCELAR.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(38);

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
create function pg_temp.gestor() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-00000000e571'::uuid $$;
create function pg_temp.sdr()    returns uuid language sql as $$ select 'a0000000-0000-4000-8000-00000000e572'::uuid $$;
create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-00000000e5' || p_n)::uuid
$$;
create function pg_temp.modelo() returns int language sql as $$
  select id from public.message_templates where template_code = 'AEB-ABR-A'
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert, update on pg_temp.r to authenticated;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;
-- Regras de variável: "nome" vem da ficha, com reserva; o resto é fixo.
create function pg_temp.regras() returns jsonb language sql as $$
  select jsonb_object_agg(v, case when v = 'nome'
                                  then '{"campo":"nome","reserva":"tudo bem"}'::jsonb
                                  else jsonb_build_object('fixo', 'X-' || v) end)
    from unnest(app.modelo_variaveis((select body from public.message_templates
                                       where template_code = 'AEB-ABR-A'))) v
   where v not in ('atendente', 'saudacao')
$$;
create function pg_temp.item(p_envio uuid, p_org uuid) returns public.envios_em_massa_itens
language sql security definer set search_path = '' as $$
  select * from public.envios_em_massa_itens where envio_id = p_envio and organization_id = p_org
$$;
create function pg_temp.envio(p_id uuid) returns public.envios_em_massa
language sql security definer set search_path = '' as $$
  select * from public.envios_em_massa where id = p_id
$$;
grant execute on function pg_temp.item(uuid, uuid), pg_temp.envio(uuid) to authenticated;

-- A janela de horário sempre aberta: o que se testa aqui é o lote.
create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                            'fecha_em', now() + interval '4 hours')
$$;

insert into public.allowed_users (email, role, note) values
  ('e57.gestor@teste.local', 'gestor', 'pgTAP envios em massa'),
  ('e57.sdr@teste.local',    'sdr',    'pgTAP envios em massa');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gestor(), 'e57.gestor@teste.local', '{"full_name":"Gilda Gestora"}'),
  (pg_temp.sdr(),    'e57.sdr@teste.local',    '{"full_name":"Saulo Sdr"}');

update public.app_settings
   set value = jsonb_set(value, '{numero_padrao}', '"+5584999995700"') where key = 'whatsapp.envio';
update public.app_settings
   set value = jsonb_set(jsonb_set(value, '{inicio}', '"2026-01-01"'), '{whatsapp,depois}', '100')
 where key = 'cadencia.tetos';
update public.message_templates
   set meta_status = 'approved', meta_template_name = 'aeb_abr_a_v1'
 where template_code = 'AEB-ABR-A';
update public.message_templates
   set meta_status = 'pending', meta_template_name = null
 where template_code = 'GEN-FUP-D3-V1';

-- 01 com pessoa (nome Mariana) · 02 sem pessoa (usa a reserva) · 03 pediu para
-- sair · 04 sem WhatsApp · 05 a 09 para a parada automática
insert into public.organizations (id, name, phone_e164, owner_id, source_id)
select x.id, x.nome, x.tel, x.dono, (select id from public.sources where slug = 'planilha')
  from (values
  (pg_temp.org('01'), 'E57 Buffet Mariana',  '+5584999995701', pg_temp.sdr()),
  (pg_temp.org('02'), 'E57 Doces Sem Pessoa', '+5584999995702', null),
  (pg_temp.org('03'), 'E57 Pediu Para Sair',  '+5584999995703', null),
  (pg_temp.org('04'), 'E57 Sem Whats',        null,              null),
  (pg_temp.org('05'), 'E57 Parada 5', '+5584999995705', null),
  (pg_temp.org('06'), 'E57 Parada 6', '+5584999995706', null),
  (pg_temp.org('07'), 'E57 Parada 7', '+5584999995707', null),
  (pg_temp.org('08'), 'E57 Parada 8', '+5584999995708', null)) x(id, nome, tel, dono);
update public.organizations set do_not_contact = true where id = pg_temp.org('03');
insert into public.contacts (id, full_name, phone_e164) values
  ('b0000000-0000-4000-8000-00000000e571', 'Mariana Souza', '+5584999995701');
insert into public.organization_contacts (organization_id, contact_id, is_primary) values
  (pg_temp.org('01'), 'b0000000-0000-4000-8000-00000000e571', true);

-- =====================================================================
-- 1. Quem monta
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is(public.envio_em_massa_criar(jsonb_build_object('nome', 'x')) ->> 'motivo', 'sem_permissao',
  'SDR não monta lote: um lote mal feito derruba o número de todo mundo');
select throws_ok($$ select * from public.envio_em_massa_publico('{}') $$, '42501', NULL,
  'nem consulta o público');
select pg_temp.sair();

-- =====================================================================
-- 2. O público
-- =====================================================================
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into pg_temp.r
select 'pub_' || right(p ->> 'organization_id', 2), p
  from public.envio_em_massa_publico('{"busca":"E57"}') p;
select is(pg_temp.v('pub_01') ->> 'situacao', 'nunca_contatado', 'ficha sem mensagem nenhuma: nunca contatado');
select is(pg_temp.v('pub_01') ->> 'bloqueio', null, 'e nada a barra');
select is(pg_temp.v('pub_03') ->> 'bloqueio', 'contato_suprimido', 'quem pediu para sair aparece, com o motivo de ficar de fora');
select is(pg_temp.v('pub_04') ->> 'bloqueio', 'sem_whatsapp', 'ficha sem número também diz por quê');
select is((select count(*)::int from public.envio_em_massa_publico('{"busca":"E57","situacoes":["ja_conversou"]}')), 0,
  'filtrar por "já conversou" não traz quem nunca falou com a gente');

-- =====================================================================
-- 3. Criar recusa o que não pode dar certo
-- =====================================================================
select is(public.envio_em_massa_criar(jsonb_build_object(
            'nome', 'Sem regra', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo(),
            'variaveis', '{}'::jsonb, 'organizacoes', jsonb_build_array(pg_temp.org('01')))) ->> 'motivo',
  'variavel_sem_regra', 'toda variável precisa dizer de onde vem o valor');
select is(public.envio_em_massa_criar(jsonb_build_object(
            'nome', 'Não aprovado', 'tipo', 'modelo',
            'modelo_id', (select id from public.message_templates where template_code = 'GEN-FUP-D3-V1'),
            'organizacoes', jsonb_build_array(pg_temp.org('01')))) ->> 'motivo',
  'modelo_nao_aprovado_na_meta', 'modelo que a Meta não aprovou não entra em lote');
select is(public.envio_em_massa_criar(jsonb_build_object(
            'nome', 'Vazio', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo(),
            'variaveis', pg_temp.regras(), 'organizacoes', '[]'::jsonb)) ->> 'motivo',
  'publico_vazio', 'lote sem ninguém não existe');

-- =====================================================================
-- 4. A prévia
-- =====================================================================
insert into pg_temp.r values ('previa', public.envio_em_massa_previa(
  jsonb_build_object('tipo', 'modelo', 'modelo_id', pg_temp.modelo(), 'variaveis', pg_temp.regras(),
                     'assinatura', 'responsavel'),
  array[pg_temp.org('01'), pg_temp.org('02')]));
select ok(pg_temp.v('previa') #>> '{itens,0,corpo}' like '%Mariana%',
  'a prévia usa o nome da pessoa da ficha');
select ok(pg_temp.v('previa') #>> '{itens,1,corpo}' like '%tudo bem%',
  'e a reserva quando a ficha não tem pessoa');
select is(pg_temp.v('previa') #>> '{itens,0,assinante}', 'Saulo',
  '"responsável" assina com o dono da ficha');
select is(pg_temp.v('previa') #>> '{itens,1,assinante}', 'Gilda',
  'e, sem dono, com quem montou o lote');

-- =====================================================================
-- 5. O relógio
-- =====================================================================
insert into pg_temp.r values ('criar', public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'Abertura buffets', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo(),
  'variaveis', pg_temp.regras(), 'assinatura', 'eu', 'por_hora', 12,
  'organizacoes', jsonb_build_array(pg_temp.org('01'), pg_temp.org('03'), pg_temp.org('02')))));
select is((pg_temp.v('criar') ->> 'itens')::int, 3, 'o lote nasce com um item por ficha');
select pg_temp.sair();

select is(app.envios_em_massa_rodar(), 1, 'uma volta do relógio manda UMA mensagem');
select is((pg_temp.item((pg_temp.v('criar') ->> 'id')::uuid, pg_temp.org('01'))).status, 'enviada',
  'a primeira ficha foi enviada');
select ok(exists (select 1 from public.messages m
                   where m.id = (pg_temp.item((pg_temp.v('criar') ->> 'id')::uuid, pg_temp.org('01'))).message_id
                     and m.sent_by = pg_temp.gestor() and m.author_kind = 'human'
                     and m.template_id = pg_temp.modelo() and m.status = 'queued'),
  'pela porteira de sempre: mensagem humana, assinada por quem foi escolhido, na fila do worker');
select ok((pg_temp.envio((pg_temp.v('criar') ->> 'id')::uuid)).proximo_em >= now() + interval '3 minutes',
  '12 por hora: a próxima fica para daqui a uns 5 minutos (nunca menos de 70% disso)');
select is(app.envios_em_massa_rodar(), 0, 'antes da hora, o relógio não manda nada');
select is(current_setting('request.jwt.claims', true), '', 'e o crachá do assinante foi devolvido');

update public.envios_em_massa set proximo_em = now() where id = (pg_temp.v('criar') ->> 'id')::uuid;
select is(app.envios_em_massa_rodar(), 1, 'na hora, manda a próxima que pode');
select is((pg_temp.item((pg_temp.v('criar') ->> 'id')::uuid, pg_temp.org('03'))).motivo, 'contato_suprimido',
  'quem pediu para sair é pulado, com o motivo gravado');
select is((pg_temp.item((pg_temp.v('criar') ->> 'id')::uuid, pg_temp.org('02'))).status, 'enviada',
  'e o pulo não gasta a vez: a ficha seguinte sai na mesma volta');

update public.envios_em_massa set proximo_em = now() where id = (pg_temp.v('criar') ->> 'id')::uuid;
select app.envios_em_massa_rodar();
select is((pg_temp.envio((pg_temp.v('criar') ->> 'id')::uuid)).status, 'concluido',
  'sem pendente, o lote termina');

-- =====================================================================
-- 6. Teto é espera
-- =====================================================================
update public.app_settings set value = jsonb_set(value, '{whatsapp,depois}', '2')
 where key = 'cadencia.tetos';
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into pg_temp.r values ('teto', public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'Teto', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo(), 'variaveis', pg_temp.regras(),
  'organizacoes', jsonb_build_array(pg_temp.org('05')))));
select pg_temp.sair();
select app.envios_em_massa_rodar();
select is((pg_temp.item((pg_temp.v('teto') ->> 'id')::uuid, pg_temp.org('05'))).status, 'pendente',
  'bateu no teto do dia: o item NÃO é pulado, espera');
select ok((pg_temp.envio((pg_temp.v('teto') ->> 'id')::uuid)).proximo_em > now(),
  'e o lote dorme até a próxima abertura');
update public.app_settings set value = jsonb_set(value, '{whatsapp,depois}', '100')
 where key = 'cadencia.tetos';

-- =====================================================================
-- 7. A cortesia das 72 h
-- =====================================================================
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into pg_temp.r values ('de_novo', public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'De novo', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo(), 'variaveis', pg_temp.regras(),
  'organizacoes', jsonb_build_array(pg_temp.org('01')))));
select pg_temp.sair();
select app.envios_em_massa_rodar();
select is((pg_temp.item((pg_temp.v('de_novo') ->> 'id')::uuid, pg_temp.org('01'))).motivo,
  'mensagem_recente_sem_resposta', 'quem recebeu mensagem nossa e não respondeu há menos de 72 h fica de fora');

-- =====================================================================
-- 8. Texto livre só com a janela aberta
-- =====================================================================
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into pg_temp.r values ('texto', public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'Texto', 'tipo', 'texto', 'texto', 'Oi {{nome}}, novidade!',
  'variaveis', '{"nome":{"campo":"nome","reserva":"tudo bem"}}'::jsonb,
  'organizacoes', jsonb_build_array(pg_temp.org('06')))));
select pg_temp.sair();
select app.envios_em_massa_rodar();
select is((pg_temp.item((pg_temp.v('texto') ->> 'id')::uuid, pg_temp.org('06'))).motivo, 'sem_janela_24h',
  'texto livre para quem não falou com a gente nas últimas 24 h é pulado — a Meta recusaria');

-- =====================================================================
-- 9. A parada automática
-- =====================================================================
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into pg_temp.r values ('parada', public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'Parada', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo(), 'variaveis', pg_temp.regras(),
  'por_hora', 60,
  'organizacoes', jsonb_build_array(pg_temp.org('05'), pg_temp.org('07'), pg_temp.org('08'), pg_temp.org('06')))));
select pg_temp.sair();
do $$
begin
  for i in 1..3 loop
    update public.envios_em_massa set proximo_em = now()
     where id = (pg_temp.v('parada') ->> 'id')::uuid;
    perform app.envios_em_massa_rodar();
  end loop;
end $$;
update public.organizations set do_not_contact = true
 where id in (pg_temp.org('05'), pg_temp.org('07'), pg_temp.org('08'));
update public.envios_em_massa set proximo_em = now() where id = (pg_temp.v('parada') ->> 'id')::uuid;
select app.envios_em_massa_rodar();
select is((pg_temp.envio((pg_temp.v('parada') ->> 'id')::uuid)).status, 'parado',
  '3 de 3 pediram para sair: o lote para sozinho');
select is((pg_temp.item((pg_temp.v('parada') ->> 'id')::uuid, pg_temp.org('06'))).status, 'pendente',
  'e quem ainda não recebeu fica esperando uma pessoa decidir');

-- =====================================================================
-- 10. Pausar, retomar, cancelar
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is(public.envio_em_massa_mudar((pg_temp.v('parada') ->> 'id')::uuid, 'retomar') ->> 'motivo',
  'sem_permissao', 'SDR não retoma lote parado');
select is((select count(*)::int from public.envios_em_massa), 0, 'e não enxerga lote nenhum');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is(public.envio_em_massa_mudar((pg_temp.v('parada') ->> 'id')::uuid, 'retomar') ->> 'ok', 'true',
  'gestor retoma o lote parado');
select is(public.envio_em_massa_mudar((pg_temp.v('parada') ->> 'id')::uuid, 'pausar') ->> 'ok', 'true',
  'e pausa');
select is(public.envio_em_massa_mudar((pg_temp.v('parada') ->> 'id')::uuid, 'cancelar') ->> 'ok', 'true',
  'e cancela');
select is((pg_temp.item((pg_temp.v('parada') ->> 'id')::uuid, pg_temp.org('06'))).status, 'cancelada',
  'cancelar tira da fila quem ainda não recebeu');
select is(public.envio_em_massa_mudar((pg_temp.v('parada') ->> 'id')::uuid, 'retomar') ->> 'motivo',
  'acao_invalida_no_estado', 'lote cancelado não volta');
select pg_temp.sair();

select * from finish();
rollback;

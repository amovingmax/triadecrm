-- =====================================================================
-- pgTAP — Disparos: cadastrar quem recebe e ver a lista como ela é
-- (migração 20261112170000_disparo_cadastra_contatos.sql)
--
-- "Quero que na tela de disparo, eu consiga com mais clareza, cadastrar
-- contatos, ver a mensagem clara que vai ser enviada" (12/11/2026).
--
-- O que este arquivo prova:
--   1. QUEM PODE: admin, gestor e SDR; embaixador e leitura recebem
--      "sem_permissao" nas duas funções.
--   2. A LISTA precisa ser uma lista de 1 a 500 pessoas.
--   3. CADA LINHA diz o que aconteceu: novo, repetido, telefone_invalido
--      (inclusive CPF no lugar do telefone), nome_obrigatorio, ja_estava (pela
--      ficha e pela pessoa, só quando a mensagem da ficha vai para o número
--      digitado), numero_de_outra_pessoa (o WhatsApp da ficha é outro),
--      pediu_para_sair (supressão, ficha que pediu, pessoa que pediu) e
--      telefone_de_outra_ficha.
--   4. O NOVO nasce inteiro: ficha de fornecedor com a pessoa principal, o
--      negócio na etapa de entrada e a atividade; sem empresa, a ficha leva o
--      nome da pessoa; a pessoa reaproveitada fica com o nome digitado; nenhum
--      bom-dia entra na fila.
--   5. A LISTA "QUEM RECEBE" volta na ordem pedida, sem excluídas nem
--      repetidas, com o telefone inteiro para o gestor e mascarado para o SDR,
--      o bloqueio (inclusive a conversa bloqueada no CRM), a janela de 24 h e
--      o aviso da cortesia de 72 h.
--   6. A COTA DE HOJE diz se a janela de envio está aberta e, fechada, quando
--      abre.
--
-- ESCOPO: números (+55 84 98816-xxxx), fichas e pessoas próprias deste
-- arquivo. Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(70);

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
create function pg_temp.gestor() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000016001'::uuid $$;
create function pg_temp.sdr()    returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000016002'::uuid $$;
create function pg_temp.embaixador() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000016003'::uuid $$;
create function pg_temp.leitura() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000016004'::uuid $$;
create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-0000001600' || p_n)::uuid
$$;
create function pg_temp.pessoa(p_n text) returns uuid language sql as $$
  select ('b0000000-0000-4000-8000-0000001600' || p_n)::uuid
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert, update on pg_temp.r to authenticated;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;
-- A linha n (1…) do último cadastro guardado em `p_chave`.
create function pg_temp.linha(p_chave text, p_n int) returns jsonb language sql as $$
  select x from jsonb_array_elements(pg_temp.v(p_chave) -> 'itens') x
   where (x ->> 'linha')::int = p_n
$$;
-- A pessoa de `p_org` na lista guardada em `p_chave`.
create function pg_temp.pessoa_na_lista(p_chave text, p_org uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(pg_temp.v(p_chave) -> 'pessoas') x
   where x ->> 'organization_id' = p_org::text
$$;

insert into public.allowed_users (email, role, note) values
  ('d160.gestor@teste.local',     'gestor',     'pgTAP 160 disparo cadastra contatos'),
  ('d160.sdr@teste.local',        'sdr',        'pgTAP 160 disparo cadastra contatos'),
  ('d160.embaixador@teste.local', 'embaixador', 'pgTAP 160 disparo cadastra contatos'),
  ('d160.leitura@teste.local',    'leitura',    'pgTAP 160 disparo cadastra contatos');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gestor(),     'd160.gestor@teste.local',     '{"full_name":"Gilda Gestora"}'),
  (pg_temp.sdr(),        'd160.sdr@teste.local',        '{"full_name":"Saulo Sdr"}'),
  (pg_temp.embaixador(), 'd160.embaixador@teste.local', '{"full_name":"Elias Embaixador"}'),
  (pg_temp.leitura(),    'd160.leitura@teste.local',    '{"full_name":"Lia Leitura"}');

update public.app_settings
   set value = jsonb_set(value, '{numero_padrao}', '"+5584900000160"') where key = 'whatsapp.envio';
-- O bom-dia ligado, para provar que cadastrar pelo disparo não o põe na fila.
update public.app_settings
   set value = jsonb_set(value, '{cumprimento_automatico}', 'true') where key = 'atendimento';

-- 01 a ficha que já existe · 02 a ficha com WhatsApp próprio (...0002) e uma
-- PESSOA com outro número (...0003) · 04 pediu para sair · 05 sem WhatsApp ·
-- 06 excluída, com uma pessoa que ficou sem ficha (...0007) · 08 excluída, com
-- uma pessoa que pediu para sair (...0008) · 09 sem número próprio: o WhatsApp
-- dela é o da pessoa principal (...0009)
insert into public.organizations (id, name, phone_e164, source_id)
select x.id, x.nome, x.tel, (select id from public.sources where slug = 'planilha')
  from (values
  (pg_temp.org('01'), 'D160 Buffet Existente', '+5584988160001'),
  (pg_temp.org('02'), 'D160 Doces da Paula',   '+5584988160002'),
  (pg_temp.org('04'), 'D160 Pediu Para Sair',  '+5584988160004'),
  (pg_temp.org('05'), 'D160 Sem Whats',        null),
  (pg_temp.org('06'), 'D160 Excluída',         '+5584988160006'),
  (pg_temp.org('08'), 'D160 Excluída Saiu',    null),
  (pg_temp.org('09'), 'D160 Sem Número Próprio', null)) x(id, nome, tel);
update public.organizations set do_not_contact = true where id = pg_temp.org('04');
insert into public.contacts (id, full_name, first_name, phone_e164, do_not_contact) values
  (pg_temp.pessoa('03'), 'Paula Pessoa',     null,     '+5584988160003', false),
  (pg_temp.pessoa('07'), 'Ana Antiga',       'Aninha', '+5584988160007', false),
  (pg_temp.pessoa('08'), 'Bia Saiu',         null,     '+5584988160008', true),
  (pg_temp.pessoa('09'), 'Rita Responsável', null,     '+5584988160009', false);
insert into public.organization_contacts (organization_id, contact_id, is_primary) values
  (pg_temp.org('02'), pg_temp.pessoa('03'), true),
  (pg_temp.org('06'), pg_temp.pessoa('07'), true),
  (pg_temp.org('08'), pg_temp.pessoa('08'), true),
  (pg_temp.org('09'), pg_temp.pessoa('09'), true);
update public.organizations set deleted_at = now(), deleted_reason = 'pgTAP 160'
 where id in (pg_temp.org('06'), pg_temp.org('08'));
insert into public.organization_categories (organization_id, category_id, is_primary)
values (pg_temp.org('01'), (select id from public.categories where slug = 'bar_drinks_chopp'), true);
-- Um número na lista de supressão, sem ficha nenhuma.
select app.suppress('phone', '+5584988160005', 'pgTAP 160', null::app.channel, null::uuid);

-- =====================================================================
-- 1. Quem pode
-- =====================================================================
select pg_temp.entrar(pg_temp.embaixador(), 'embaixador');
select is(public.disparo_adicionar_contatos('[{"nome":"X","telefone":"84988160099"}]') ->> 'motivo',
  'sem_permissao', 'embaixador não cadastra pelo disparo');
select is(public.disparo_pessoas(array[pg_temp.org('01')]) ->> 'motivo',
  'sem_permissao', 'nem vê a lista de quem recebe');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.leitura(), 'leitura');
select is(public.disparo_adicionar_contatos('[{"nome":"X","telefone":"84988160099"}]') ->> 'motivo',
  'sem_permissao', 'leitura não cadastra pelo disparo');
select is(public.disparo_pessoas(array[pg_temp.org('01')]) ->> 'motivo',
  'sem_permissao', 'nem vê a lista de quem recebe');
select pg_temp.sair();

select is((select count(*)::int from public.organizations where phone_e164 = '+5584988160099'), 0,
  'e a recusa não deixou ficha nenhuma');

-- =====================================================================
-- 2. A lista
-- =====================================================================
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is(public.disparo_adicionar_contatos('[]') ->> 'motivo', 'lista_invalida', 'lista vazia não serve');
select is(public.disparo_adicionar_contatos(null) ->> 'motivo', 'lista_invalida', 'nem nula');
select is(public.disparo_adicionar_contatos('{"nome":"X","telefone":"84988160099"}') ->> 'motivo',
  'lista_invalida', 'uma pessoa solta, fora de lista, também não');
select is(public.disparo_adicionar_contatos(
            (select jsonb_agg(jsonb_build_object('nome', 'P' || n, 'telefone', '8498816' || lpad(n::text, 4, '0')))
               from generate_series(1, 501) n)) ->> 'motivo',
  'lista_invalida', 'mais de 500 de uma vez, não');

-- =====================================================================
-- 3. Cada linha diz o que aconteceu
-- =====================================================================
insert into pg_temp.r values ('lote', public.disparo_adicionar_contatos(jsonb_build_array(
  jsonb_build_object('nome', 'Mariana Souza', 'telefone', '(84) 98816-0101', 'empresa', 'D160 Buffet Sabor Potiguar'),
  jsonb_build_object('nome', 'João Batista',  'telefone', '84 98816-0102'),
  jsonb_build_object('nome', 'Mari de novo',  'telefone', '+55 84 98816-0101'),
  jsonb_build_object('nome', 'Fulano',        'telefone', '123'),
  jsonb_build_object('nome', '   ',           'telefone', '84988160106'),
  jsonb_build_object('nome', 'Quem já estava', 'telefone', '84988160001'),
  jsonb_build_object('nome', 'Paula',         'telefone', '84988160003'),
  jsonb_build_object('nome', 'Pediu na ficha', 'telefone', '84988160004'),
  jsonb_build_object('nome', 'Suprimido',     'telefone', '84988160005'),
  jsonb_build_object('nome', 'Agora com nome', 'telefone', '84988160106', 'empresa', '  '),
  jsonb_build_object('nome', 'Carla Nova',    'telefone', '84988160007'),
  jsonb_build_object('nome', 'Bia de novo',   'telefone', '84988160008'),
  jsonb_build_object('nome', 'Rita',          'telefone', '84988160009'),
  jsonb_build_object('nome', 'Cris do CPF',   'telefone', '849.881.601-40'))));
select pg_temp.sair();

select is(pg_temp.v('lote') ->> 'ok', 'true', 'o cadastro em lote responde ok');
select is(jsonb_array_length(pg_temp.v('lote') -> 'itens'), 14, 'uma resposta por linha');
select is(pg_temp.linha('lote', 1) ->> 'status', 'novo', 'linha 1: pessoa nova com empresa → ficha nova');
select is(pg_temp.linha('lote', 2) ->> 'status', 'novo', 'linha 2: pessoa nova sem empresa → ficha nova');
select is(pg_temp.linha('lote', 3) ->> 'status', 'repetido', 'linha 3: o mesmo número da linha 1, escrito de outro jeito → repetido');
select is(pg_temp.linha('lote', 3) ->> 'organization_id', null, 'e o repetido não devolve ficha');
select is(pg_temp.linha('lote', 4) ->> 'status', 'telefone_invalido', 'linha 4: "123" não é telefone');
select is(pg_temp.linha('lote', 5) ->> 'status', 'nome_obrigatorio', 'linha 5: nome em branco');
select is(pg_temp.linha('lote', 6) ->> 'status', 'ja_estava', 'linha 6: o número já é de uma ficha → já estava');
select is(pg_temp.linha('lote', 6) ->> 'organization_id', pg_temp.org('01')::text, 'e devolve a ficha que já existia');
select is(pg_temp.linha('lote', 6) ->> 'ficha', 'D160 Buffet Existente', 'com o nome dela, para a tela dizer qual é');
select is(pg_temp.linha('lote', 7) ->> 'status', 'numero_de_outra_pessoa',
  'linha 7: o número é de uma pessoa da ficha, mas o WhatsApp da ficha é outro → recusado');
select is(pg_temp.linha('lote', 7) ->> 'organization_id', null,
  'sem devolver a ficha: no disparo, a mensagem iria para um número que ninguém digitou');
select is(pg_temp.linha('lote', 7) ->> 'ficha', 'D160 Doces da Paula', 'mas dizendo qual é a ficha');
select is(pg_temp.linha('lote', 13) ->> 'status', 'ja_estava',
  'linha 13: o número é da pessoa principal e é o WhatsApp da ficha → já estava');
select is(pg_temp.linha('lote', 13) ->> 'organization_id', pg_temp.org('09')::text, 'e devolve a ficha da pessoa');
select is(pg_temp.linha('lote', 13) ->> 'ficha', 'D160 Sem Número Próprio', 'com o nome dela');
select is(pg_temp.linha('lote', 14) ->> 'status', 'telefone_invalido',
  'linha 14: CPF no lugar do telefone é telefone inválido, mesmo que os dígitos passem por celular');
select is(pg_temp.linha('lote', 8) ->> 'status', 'pediu_para_sair', 'linha 8: a ficha pediu para não ser contatada');
select is(pg_temp.linha('lote', 9) ->> 'status', 'pediu_para_sair', 'linha 9: o número está na lista de supressão');
select is(pg_temp.linha('lote', 9) ->> 'organization_id', null, 'e quem pediu para sair não devolve ficha');
select is(pg_temp.linha('lote', 10) ->> 'status', 'novo',
  'linha 10: a linha 5 (sem nome) não gastou o número; com nome, vale');
select is(pg_temp.linha('lote', 11) ->> 'status', 'novo',
  'linha 11: a pessoa cuja ficha foi excluída ganha ficha nova');
select is(pg_temp.linha('lote', 12) ->> 'status', 'pediu_para_sair',
  'linha 12: a pessoa sem ficha que pediu para sair continua de fora');
select is(array[(pg_temp.v('lote') ->> 'novos')::int, (pg_temp.v('lote') ->> 'ja_estavam')::int,
                (pg_temp.v('lote') ->> 'recusados')::int],
          array[4, 2, 8], 'a conta: 4 novas, 2 já estavam, 8 recusadas');
select is(pg_temp.linha('lote', 1) ->> 'nome', 'Mariana Souza', 'a resposta repete o nome');
select is(pg_temp.linha('lote', 1) ->> 'empresa', 'D160 Buffet Sabor Potiguar', 'e a empresa');

insert into pg_temp.r values
  ('nova1', jsonb_build_object('id', pg_temp.linha('lote', 1) ->> 'organization_id')),
  ('nova2', jsonb_build_object('id', pg_temp.linha('lote', 2) ->> 'organization_id')),
  ('nova10', jsonb_build_object('id', pg_temp.linha('lote', 10) ->> 'organization_id')),
  ('nova11', jsonb_build_object('id', pg_temp.linha('lote', 11) ->> 'organization_id'));
create function pg_temp.nova(p_n text) returns uuid language sql as $$
  select (pg_temp.v('nova' || p_n) ->> 'id')::uuid
$$;

-- =====================================================================
-- 4. O novo nasce inteiro
-- =====================================================================
select ok(exists (select 1 from public.organizations o
                   where o.id = pg_temp.nova('1')
                     and o.name = 'D160 Buffet Sabor Potiguar'
                     and o.kind = 'fornecedor'::app.org_kind
                     and o.phone_e164 = '+5584988160101'
                     and o.owner_id = pg_temp.gestor()
                     and o.collector = 'Gilda Gestora'
                     and o.source_id = (select id from public.sources where slug = 'contato_pessoal')
                     and o.deleted_at is null),
  'a ficha nova: fornecedor, com a empresa como nome, o WhatsApp, quem pediu como dono e a origem "contato pessoal"');
select ok(exists (select 1 from public.organization_contacts oc
                    join public.contacts c on c.id = oc.contact_id
                   where oc.organization_id = pg_temp.nova('1') and oc.is_primary
                     and c.full_name = 'Mariana Souza' and c.phone_e164 = '+5584988160101'),
  'com a pessoa digitada como principal, com o mesmo WhatsApp');
select is((select d.primeiro_nome from app.wa_destino_da_ficha(pg_temp.nova('1')) d), 'Mariana',
  'e é o nome dela que a mensagem vai usar');
select ok(exists (select 1 from public.deals dl
                    join public.stages st on st.id = dl.stage_id
                    join public.pipelines p on p.id = dl.pipeline_id
                   where dl.organization_id = pg_temp.nova('1')
                     and p.slug = 'fornecedor' and st.is_entry and st.retired_at is null
                     and dl.status = 'open'::app.deal_status
                     and dl.owner_id = pg_temp.gestor()
                     and dl.primary_contact_id = (select oc.contact_id from public.organization_contacts oc
                                                   where oc.organization_id = pg_temp.nova('1') and oc.is_primary)),
  'o negócio nasce no funil de fornecedor, na etapa de entrada, com a pessoa');
select ok(exists (select 1 from public.activities a
                   where a.organization_id = pg_temp.nova('1')
                     and a.type = 'system' and a.author_kind = 'system'
                     and a.body = 'Parceiro criado pelo disparo'
                     and a.user_id = pg_temp.gestor()
                     and a.metadata ->> 'origin' = 'disparo'),
  'e a atividade conta que a ficha veio do disparo');
select is((select o.name from public.organizations o where o.id = pg_temp.nova('2')), 'João Batista',
  'sem empresa, a ficha leva o nome da pessoa');
select is((select o.name from public.organizations o where o.id = pg_temp.nova('10')), 'Agora com nome',
  'empresa em branco é o mesmo que sem empresa');
select ok(exists (select 1 from public.organization_contacts oc
                   where oc.organization_id = pg_temp.nova('11') and oc.is_primary
                     and oc.contact_id = pg_temp.pessoa('07')),
  'a pessoa que ficou sem ficha é reaproveitada (um telefone, uma pessoa), não duplicada');
select is((select array[c.full_name, c.first_name] from public.contacts c where c.id = pg_temp.pessoa('07')),
          array['Carla Nova', 'Carla'], 'e passa a ter o nome digitado, com o primeiro nome tirado dele');
select is((select d.primeiro_nome from app.wa_destino_da_ficha(pg_temp.nova('11')) d), 'Carla',
  '"Carla" digitada não vira "Ana" (nem "Aninha") na mensagem');
select is((select a.metadata ->> 'nome_anterior' from public.activities a
            where a.organization_id = pg_temp.nova('11') and a.metadata ->> 'origin' = 'disparo'),
  'Ana Antiga', 'o nome antigo fica guardado na atividade');
select is((select count(*)::int from public.envios_em_massa_itens i
            where i.organization_id in (pg_temp.nova('1'), pg_temp.nova('2'), pg_temp.nova('10'), pg_temp.nova('11'))),
  0, 'cadastrar pelo disparo não põe ninguém na fila do bom-dia');

-- O SDR também cadastra, e a ficha fica com ele.
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
insert into pg_temp.r values ('sdr', public.disparo_adicionar_contatos(
  '[{"nome":"Sara do SDR","telefone":"84988160111"}]'));
select pg_temp.sair();
select is(pg_temp.linha('sdr', 1) ->> 'status', 'novo', 'o SDR cadastra pelo disparo');
select is((select o.owner_id from public.organizations o
            where o.id = (pg_temp.linha('sdr', 1) ->> 'organization_id')::uuid), pg_temp.sdr(),
  'e a ficha nasce dele');

-- telefone_de_outra_ficha: hoje toda a gestão enxerga a base inteira, então o
-- caso só aparece se a visibilidade mudar. A troca vale só nesta transação.
create or replace function app.org_is_visible(p_org uuid)
returns boolean language sql stable set search_path = '' as $$
  select (app.sees_all() or (app.role() = 'embaixador'::app.user_role and app.org_is_mine(p_org)))
     and p_org <> 'c0000000-0000-4000-8000-000000160001'::uuid
$$;
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into pg_temp.r values ('outra', public.disparo_adicionar_contatos(
  '[{"nome":"Quem não enxerga","telefone":"84988160001"}]'));
insert into pg_temp.r values ('invisivel', public.disparo_pessoas(array[pg_temp.org('01'), pg_temp.org('02')]));
select pg_temp.sair();
select is(pg_temp.linha('outra', 1) ->> 'status', 'telefone_de_outra_ficha',
  'o número é de uma ficha que quem pede não enxerga → de outra ficha');
select is(pg_temp.linha('outra', 1) ->> 'organization_id', null, 'sem entregar o id dela');
select is(pg_temp.linha('outra', 1) ->> 'ficha', null, 'nem o nome');
select is(jsonb_array_length(pg_temp.v('invisivel') -> 'pessoas'), 1, 'e a ficha invisível some da lista');
create or replace function app.org_is_visible(p_org uuid)
returns boolean language sql stable set search_path = '' as $$
  select app.sees_all() or (app.role() = 'embaixador'::app.user_role and app.org_is_mine(p_org))
$$;

-- =====================================================================
-- 5. A lista "Quem recebe"
-- =====================================================================
-- 01 respondeu há 1 h: janela aberta · nova 2 recebeu mensagem nossa há 1 h
-- e não respondeu: o disparo vai pular.
insert into public.conversations (id, business_number, peer_phone_e164, last_inbound_at, window_expires_at) values
  ('c0000000-0000-4000-8000-0000001600a1', '+5584900000160', '+5584988160001',
   now() - interval '1 hour', now() + interval '23 hours');
insert into public.conversations (id, business_number, peer_phone_e164) values
  ('c0000000-0000-4000-8000-0000001600a2', '+5584900000160', '+5584988160102');
-- nova 10: a conversa foi bloqueada no CRM (public.conversa_bloquear, 27/10).
insert into public.conversations (id, business_number, peer_phone_e164, bloqueada_em, bloqueada_por) values
  ('c0000000-0000-4000-8000-0000001600a3', '+5584900000160', '+5584988160106', now(), pg_temp.gestor());
select pg_temp.entrar_worker();
insert into public.messages (conversation_id, direction, type, status, body, origin,
                             wa_message_id, business_initiated, is_first_contact, created_at, sent_at)
values ('c0000000-0000-4000-8000-0000001600a2', 'out'::app.msg_direction, 'template'::app.msg_type,
        'sent'::app.msg_status, 'Bom dia!', 'echo', 'wamid.PGTAP160.1', true, true,
        now() - interval '1 hour', now() - interval '1 hour');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into pg_temp.r values ('lista', public.disparo_pessoas(array[
  pg_temp.nova('2'), pg_temp.org('01'), pg_temp.org('05'), pg_temp.org('04'),
  pg_temp.org('06'), pg_temp.nova('1'), pg_temp.org('01'), pg_temp.nova('10')]));
insert into pg_temp.r values ('vazia', public.disparo_pessoas('{}'::uuid[]));
insert into pg_temp.r values ('grande', public.disparo_pessoas(
  array(select gen_random_uuid() from generate_series(1, 2001))));
select pg_temp.sair();

select is(pg_temp.v('lista') ->> 'ok', 'true', 'a lista responde ok');
select is(array(select (x ->> 'organization_id')::uuid
                  from jsonb_array_elements(pg_temp.v('lista') -> 'pessoas') with ordinality as t(x, n)
                 order by t.n),
          array[pg_temp.nova('2'), pg_temp.org('01'), pg_temp.org('05'), pg_temp.org('04'), pg_temp.nova('1'),
                pg_temp.nova('10')],
  'na ordem pedida, sem a ficha excluída e sem repetir quem veio duas vezes');
select is(pg_temp.pessoa_na_lista('lista', pg_temp.nova('1')) - 'organization_id',
          jsonb_build_object('empresa', 'D160 Buffet Sabor Potiguar', 'nome', 'Mariana Souza',
                             'primeiro_nome', 'Mariana', 'telefone', '+5584988160101',
                             'categoria', null, 'bloqueio', null, 'janela_aberta', false, 'aviso', null),
  'a ficha nova: empresa, pessoa, primeiro nome e o WhatsApp inteiro para o gestor; nada a impede');
select is(pg_temp.pessoa_na_lista('lista', pg_temp.org('01')) ->> 'categoria', 'Bar, drinks, chopp',
  'a categoria principal da ficha');
select is(pg_temp.pessoa_na_lista('lista', pg_temp.org('01')) ->> 'janela_aberta', 'true',
  'quem respondeu há 1 h está com a janela de 24 h aberta');
select is(pg_temp.pessoa_na_lista('lista', pg_temp.nova('2')) ->> 'aviso', 'mensagem_recente_sem_resposta',
  'quem recebeu mensagem nossa há 1 h e não respondeu: o disparo vai pular');
select is(pg_temp.pessoa_na_lista('lista', pg_temp.org('05')) ->> 'bloqueio', 'sem_whatsapp',
  'a ficha sem número diz por que não recebe');
select is(pg_temp.pessoa_na_lista('lista', pg_temp.org('04')) ->> 'bloqueio', 'contato_suprimido',
  'e a que pediu para sair também');
select is(pg_temp.pessoa_na_lista('lista', pg_temp.nova('10')) ->> 'bloqueio', 'conversa_bloqueada',
  'a conversa bloqueada no CRM também barra (a porteira pula com esse motivo)');
select is(pg_temp.v('vazia'), '{"ok": true, "pessoas": []}'::jsonb, 'lista vazia: ninguém, sem erro');
select is(pg_temp.v('grande') ->> 'motivo', 'lista_invalida', 'mais de 2.000 de uma vez, não');

select pg_temp.entrar(pg_temp.sdr(), 'sdr');
insert into pg_temp.r values ('lista_sdr', public.disparo_pessoas(array[pg_temp.nova('1')]));
select pg_temp.sair();
select is(pg_temp.pessoa_na_lista('lista_sdr', pg_temp.nova('1')) ->> 'telefone', '+55 84 •••••-••01',
  'o SDR vê a lista com o telefone mascarado');

-- =====================================================================
-- 6. A cota de hoje diz se a janela de envio está aberta
-- =====================================================================
-- O relógio de verdade decide a janela; aqui ela é fixada, fechada e aberta,
-- só nesta transação.
create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', false, 'motivo', 'fora_do_horario',
                            'abre_em', (timestamp '2026-11-13 08:00') at time zone 'America/Fortaleza',
                            'fecha_em', null)
$$;
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into pg_temp.r values ('teto_fechada', public.envio_em_massa_teto());
select pg_temp.sair();
select is(pg_temp.v('teto_fechada') ->> 'janela_aberta', 'false', 'fora do horário, a cota diz que a janela está fechada');
select is((pg_temp.v('teto_fechada') ->> 'abre_em')::timestamptz,
          (timestamp '2026-11-13 08:00') at time zone 'America/Fortaleza',
  'e quando a próxima mensagem pode sair');
select ok(pg_temp.v('teto_fechada') ?& array['teto', 'usados', 'sobra', 'na_fila', 'quem_manda'],
  'sem perder o que já dizia');

create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                            'fecha_em', now() + interval '4 hours')
$$;
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into pg_temp.r values ('teto_aberta', public.envio_em_massa_teto());
select pg_temp.sair();
select is(array[pg_temp.v('teto_aberta') ->> 'janela_aberta', pg_temp.v('teto_aberta') ->> 'abre_em'],
          array['true', null], 'no horário, a janela está aberta e não há "abre às"');

select * from finish();
rollback;

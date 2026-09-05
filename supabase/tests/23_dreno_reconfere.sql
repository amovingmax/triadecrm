-- =====================================================================
-- TRIADE — pgTAP — 20260905000100: o dreno reconfere
--
-- O achado que este arquivo trava para sempre:
--
--   `app.komune_proximos` é o DRENO da fila de saída para a plataforma
--   Komune, chamado pelo job 14 do cron a cada 5 minutos. Ele NÃO
--   reconferia nada: a única checagem de supressão e autorização vivia na
--   ENFILEIRADA (`app.komune_enfileirar`), e a Edge Function `komune-push`
--   está escrita assumindo que o Postgres já filtrou.
--
--   No banco de desenvolvimento, colhido: às 01:21:57 a Alfa Cerimonial
--   autorizou e dois pedidos entraram na fila; às 01:23:33 ela clicou "Não
--   é meu / não quero aparecer" na página pública. A recusa cancelou
--   cadência, tarefa e pré-cadastro. Não cancelou o outbox. Os dois
--   payloads continuaram pendentes, e sairiam no dia em que
--   `integracao.komune.push_ativo` fosse ligada.
--
-- O que se prova aqui, com o ciclo completo (enfileira → o mundo muda →
-- drena):
--   1. Item enfileirado ANTES da recusa NÃO sai depois dela.
--   2. Item de organização apagada NÃO sai.
--   3. Item de pré-cadastro recusado NÃO sai.
--   4. Item LEGÍTIMO continua saindo — fechar tudo não é consertar nada.
--   5. O descarte é idempotente, e a mensagem pgmq é arquivada (senão ela
--      voltaria a cada leitura, para sempre).
--
-- Toda asserção de contagem é DELTA sobre a base medida no início; nenhuma
-- lê contagem absoluta de tabela que a operação alimenta.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(43);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
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
create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('d0000000-0000-4000-8000-0000000d00' || p_n)::uuid
$$;
create function pg_temp.pre(p_org uuid) returns uuid
  language sql security definer set search_path = '' as $$
  select id from public.pre_registrations where organization_id = p_org
$$;
create function pg_temp.outbox(p_org uuid) returns uuid
  language sql security definer set search_path = '' as $$
  select id from public.komune_outbox where organization_id = p_org
   order by first_seen_at desc limit 1
$$;

-- ---------- a base, para toda contagem virar delta ----------
create function pg_temp.n_outbox() returns int
  language sql security definer set search_path = '' as $$
  select count(*)::int from public.komune_outbox
$$;
create function pg_temp.n_descartado() returns int
  language sql security definer set search_path = '' as $$
  select count(*)::int from public.komune_outbox where status = 'descartado'
$$;
create table pg_temp.base (chave text primary key, n int);
insert into pg_temp.base values ('outbox', pg_temp.n_outbox()),
                                ('descartado', pg_temp.n_descartado());
create function pg_temp.delta(p_chave text, p_agora int) returns int language sql as $$
  select p_agora - (select n from pg_temp.base where chave = p_chave)
$$;

-- A fila `komune_sync` é global e o banco de desenvolvimento tem mensagens
-- antigas nela. Esvaziá-la DENTRO desta transação (que desfaz tudo no fim) é
-- o que torna o lote lido aqui determinístico: o que sair do dreno é o que
-- este arquivo pôs nele, e nada mais.
delete from pgmq.q_komune_sync;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('dr.admin@teste.local', 'admin', 'pgTAP dreno reconfere');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000d0001', 'dr.admin@teste.local', '{"full_name":"Admin Dreno"}');

-- ---------- quatro fichas: uma legítima e três que mudam de estado ----------
insert into public.organizations (id, kind, name, phone_e164, source_id, collector, source_url, owner_id)
select v.id, 'fornecedor', v.nome, v.fone,
       (select id from public.sources order by id limit 1), 'pgtap',
       'https://exemplo.invalido/dreno', 'a0000000-0000-4000-8000-0000000d0001'
  from (values
    (pg_temp.org('01'), 'DRENO PGTAP LEGITIMA',        '+5584900000801'),
    (pg_temp.org('02'), 'DRENO PGTAP RECUSA DEPOIS',   '+5584900000802'),
    (pg_temp.org('03'), 'DRENO PGTAP FICHA APAGADA',   '+5584900000803'),
    (pg_temp.org('04'), 'DRENO PGTAP PRE RECUSADO',    '+5584900000804')
  ) as v(id, nome, fone);

-- Autorização registrada para as quatro: sem ela nada entraria na fila, e o
-- teste não teria o que provar na saída.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000d0001', 'admin');
insert into public.consent_events (kind, organization_id, channel, evidence_text)
select 'data_use_authorized', v.id, 'whatsapp', 'pgTAP dreno: autorizou por áudio'
  from (values (pg_temp.org('01')), (pg_temp.org('02')),
               (pg_temp.org('03')), (pg_temp.org('04'))) as v(id);

select public.criar_pre_cadastro(pg_temp.org('01'),
         jsonb_build_object('nome_exibicao', 'DRENO PGTAP LEGITIMA', 'cidade', 'Natal'));
select public.criar_pre_cadastro(pg_temp.org('02'),
         jsonb_build_object('nome_exibicao', 'DRENO PGTAP RECUSA DEPOIS', 'cidade', 'Natal'));
select public.criar_pre_cadastro(pg_temp.org('03'),
         jsonb_build_object('nome_exibicao', 'DRENO PGTAP FICHA APAGADA', 'cidade', 'Natal'));
select public.criar_pre_cadastro(pg_temp.org('04'),
         jsonb_build_object('nome_exibicao', 'DRENO PGTAP PRE RECUSADO', 'cidade', 'Natal'));
select pg_temp.sair();


-- =====================================================================
-- 1. AS QUATRO ENTRAM NA FILA — o mundo ainda está como estava
-- =====================================================================
select is(app.komune_enfileirar(pg_temp.pre(pg_temp.org('01')), 'reenvio_manual') ->> 'enfileirado',
          'true', 'a legítima entra na fila');
select is(app.komune_enfileirar(pg_temp.pre(pg_temp.org('02')), 'reenvio_manual') ->> 'enfileirado',
          'true', 'a que vai recusar entra na fila (no momento da entrada ela PODIA)');
select is(app.komune_enfileirar(pg_temp.pre(pg_temp.org('03')), 'reenvio_manual') ->> 'enfileirado',
          'true', 'a que vai ser apagada entra na fila');
select is(app.komune_enfileirar(pg_temp.pre(pg_temp.org('04')), 'reenvio_manual') ->> 'enfileirado',
          'true', 'a que vai ter o rascunho recusado entra na fila');
select is(pg_temp.delta('outbox', pg_temp.n_outbox()), 4,
          'quatro pedidos, e nenhum a mais, na fila de saída');
select is((select count(*)::int from pgmq.q_komune_sync), 4,
          'e quatro mensagens visíveis na fila pgmq');


-- =====================================================================
-- 2. O MUNDO MUDA — depois da enfileirada, como sempre acontece
-- =====================================================================
-- (a) 02 clica "não quero aparecer": é a linha do tempo real da Alfa.
insert into public.consent_events (kind, organization_id, channel, evidence_text)
values ('erasure_request', pg_temp.org('02'), 'whatsapp',
        'pgTAP: recusa na página de reivindicação, depois de o pedido estar na fila');

-- (b) 03 tem a ficha apagada.
update public.organizations set deleted_at = now() where id = pg_temp.org('03');

-- (c) 04 tem o rascunho recusado, SEM opt-out: o dreno tem de olhar o
--     pré-cadastro por si, não só a supressão.
update public.pre_registrations
   set refused_at = now(), refused_reason = 'nao_e_meu', status = 'rejected'::app.prereg_status
 where id = pg_temp.pre(pg_temp.org('04'));

select ok(app.is_suppressed_target(pg_temp.org('02'), null),
          'a 02 ficou suprimida depois de o pedido já estar na fila');
select is((select status from public.komune_outbox where id = pg_temp.outbox(pg_temp.org('02'))),
          'pendente',
          'e o pedido dela CONTINUA pendente: a recusa cancela cadência e tarefa, nunca cancelou o outbox');

select is(app.komune_motivo_de_recusa(pg_temp.outbox(pg_temp.org('01'))), null,
          'a legítima não tem motivo de recusa');
select is(app.komune_motivo_de_recusa(pg_temp.outbox(pg_temp.org('02'))), 'contato_suprimido',
          'a que recusou tem motivo: contato_suprimido');
select is(app.komune_motivo_de_recusa(pg_temp.outbox(pg_temp.org('03'))), 'organizacao_apagada',
          'a de ficha apagada tem motivo: organizacao_apagada');
select is(app.komune_motivo_de_recusa(pg_temp.outbox(pg_temp.org('04'))), 'pre_cadastro_recusado',
          'a de rascunho recusado tem motivo: pre_cadastro_recusado');


-- =====================================================================
-- 3. O DRENO — a chave geral ligada, que é o dia que dá medo
-- =====================================================================
update public.app_settings set value = value || '{"push_ativo": true}'::jsonb
 where key = 'integracao.komune';

-- Uma leitura só: `pgmq.read` esconde a mensagem por 120 s, então o lote é
-- capturado aqui e todas as asserções abaixo olham este mesmo lote.
create table pg_temp.lote as select app.komune_proximos(50) as j;
create function pg_temp.saiu(p_org uuid) returns boolean language sql as $$
  select exists (select 1 from pg_temp.lote l,
                      jsonb_array_elements(l.j -> 'itens') i
                  where (i ->> 'outbox_id')::uuid = pg_temp.outbox(p_org))
$$;

select is((select j ->> 'ativo' from pg_temp.lote), 'true',
          'com a chave ligada o dreno entrega');

select ok(pg_temp.saiu(pg_temp.org('01')),
          'O ITEM LEGÍTIMO CONTINUA SAINDO — fechar tudo não seria conserto');
select ok(not pg_temp.saiu(pg_temp.org('02')),
          'item enfileirado ANTES da recusa NÃO sai depois dela');
select ok(not pg_temp.saiu(pg_temp.org('03')),
          'item de organização apagada NÃO sai');
select ok(not pg_temp.saiu(pg_temp.org('04')),
          'item de pré-cadastro recusado NÃO sai');
select is((select jsonb_array_length(j -> 'itens') from pg_temp.lote), 1,
          'e o lote entregue tem exatamente o item legítimo');


-- =====================================================================
-- 4. O DESCARTE — na linha, na fila e na linha do tempo
-- =====================================================================
select is(pg_temp.delta('descartado', pg_temp.n_descartado()), 3,
          'os três recusados viraram komune_outbox.status = descartado');
select is((select status from public.komune_outbox where id = pg_temp.outbox(pg_temp.org('01'))),
          'pendente',
          'e o legítimo continua pendente, esperando a resposta da Komune');

select is((select last_error from public.komune_outbox where id = pg_temp.outbox(pg_temp.org('02'))),
          'recusado na entrega: contato_suprimido',
          'o motivo fica escrito na PRÓPRIA linha, não num log que ninguém lê');
select is((select last_error from public.komune_outbox where id = pg_temp.outbox(pg_temp.org('03'))),
          'recusado na entrega: organizacao_apagada',
          'idem para a ficha apagada');
select is((select last_error from public.komune_outbox where id = pg_temp.outbox(pg_temp.org('04'))),
          'recusado na entrega: pre_cadastro_recusado',
          'idem para o rascunho recusado');

-- Arquivar é o que impede a mensagem de voltar a cada leitura, para sempre.
select is((select count(*)::int from pgmq.q_komune_sync q
            join public.komune_outbox ob on ob.id = (q.message ->> 'outbox_id')::uuid
           where ob.status = 'descartado'), 0,
          'nenhuma mensagem de pedido descartado sobrou na fila viva');
select is((select count(*)::int from pgmq.a_komune_sync a
            where (a.message ->> 'outbox_id')::uuid in (
                    pg_temp.outbox(pg_temp.org('02')),
                    pg_temp.outbox(pg_temp.org('03')),
                    pg_temp.outbox(pg_temp.org('04')))), 3,
          'as três foram arquivadas — não voltam no próximo lote');

select ok(exists (select 1 from public.pre_registration_events e
                   where e.pre_registration_id = pg_temp.pre(pg_temp.org('02'))
                     and e.event = 'returned'
                     and e.payload ->> 'acao' = 'descartado_na_entrega'
                     and e.payload ->> 'motivo' = 'contato_suprimido'),
          'a recusa vira linha do tempo do pré-cadastro, não silêncio');


-- =====================================================================
-- 5. IDEMPOTÊNCIA — chamar de novo não descarta duas vezes nem estoura
-- =====================================================================
select is(app.komune_descartar(pg_temp.outbox(pg_temp.org('02')),
                               (select ob.msg_id from public.komune_outbox ob
                                 where ob.id = pg_temp.outbox(pg_temp.org('02'))),
                               'contato_suprimido'),
          false, 'descartar de novo o mesmo pedido devolve false: não havia o que fazer');
select is(pg_temp.delta('descartado', pg_temp.n_descartado()), 3,
          'e o número de descartados não se move');
select is((select count(*)::int from public.pre_registration_events e
            where e.pre_registration_id = pg_temp.pre(pg_temp.org('02'))
              and e.payload ->> 'acao' = 'descartado_na_entrega'), 1,
          'a linha do tempo também não ganha um segundo registro do mesmo descarte');

select lives_ok($$ select app.komune_proximos(50) $$,
                'uma segunda passada do dreno não estoura na fila já limpa');
select is(pg_temp.delta('descartado', pg_temp.n_descartado()), 3,
          'e continua em três descartes');


-- =====================================================================
-- 6. A CHAVE GERAL CONTINUA MANDANDO — e agora a recusa é visível
-- =====================================================================
update public.app_settings set value = value || '{"push_ativo": false}'::jsonb
 where key = 'integracao.komune';
select is(app.komune_proximos(50) ->> 'ativo', 'false',
          'desligada, o dreno não entrega nada — nem para reconferir');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000d0001', 'admin');
select ok((public.komune_fila_status() ->> 'descartados')::int >= 3,
          'o painel da integração mostra os descartados: recusa silenciosa é a mesma doença por outro nome');
select pg_temp.sair();


-- =====================================================================
-- 7. A VARREDURA — o mesmo erro, nos outros lugares onde ele morava
-- =====================================================================
-- A lição do achado é geral: quem decide na ENTRADA e entrega DEPOIS tem o
-- mesmo buraco. Duas outras portas do CRM tinham a versão delas.

-- ---------- 7.1 A curadoria do Radar lia o carimbo da COLETA ----------
-- `supplier_candidates.do_not_contact` é escrito por
-- `app.supplier_candidates_normalize` no instante em que o candidato é
-- gravado: é uma foto da lista de supressão daquele dia. Coletado na
-- segunda, opt-out na quarta, curadoria na sexta — o carimbo continuava
-- dizendo "pode".
select pg_temp.entrar('a0000000-0000-4000-8000-0000000d0001', 'admin');
select public.radar_criar_candidato('DRENO PGTAP CANDIDATO',
         (select id from public.sources order by id limit 1),
         (select id from public.categories order by id limit 1),
         '+5584900000811');
select pg_temp.sair();

create function pg_temp.cand() returns uuid
  language sql security definer set search_path = '' as $$
  select id from public.supplier_candidates where name = 'DRENO PGTAP CANDIDATO'
$$;

select is((select do_not_contact from public.supplier_candidates where id = pg_temp.cand()),
          false, 'o candidato nasce contatável: naquele momento ele era mesmo');

-- Agora o telefone dele entra na lista de supressão — é o que
-- `app.consent_apply` faz quando alguém responde "SAIR".
select app.suppress('phone', '+5584900000811', 'contact_optout', 'whatsapp'::app.channel, null);

select ok(app.is_suppressed('+5584900000811', null, null),
          'o telefone está na lista de supressão de agora');
select is((select do_not_contact from public.supplier_candidates where id = pg_temp.cand()),
          false, 'e o CARIMBO do candidato continua falso: foi escrito antes, e ninguém o reescreve');

select is(app.promover_candidato(pg_temp.cand()) ->> 'reason', 'candidato_nao_contatar',
          'a promoção relê a lista viva e recusa: o carimbo velho não decide mais');
select is((select do_not_contact from public.supplier_candidates where id = pg_temp.cand()),
          true, 'e o carimbo passa a contar a verdade, para a fila do Radar não reoferecer o alvo');
select is(app.mesclar_candidato(pg_temp.cand(), pg_temp.org('01')) ->> 'reason',
          'candidato_nao_contatar',
          'a mesclagem numa ficha existente aplica a mesma reconferência');


-- ---------- 7.2 A fila do dia perguntava metade da pergunta ----------
-- `public.meu_dia` já recheca (bom), mas perguntava só
-- `not o.do_not_contact`. Isso não vê a ficha cuja supressão veio pelo
-- TELEFONE — a mesma linha da `suppression_list` que barra todo o resto.
insert into public.organizations (id, kind, name, phone_e164, source_id, collector, source_url, owner_id)
values (pg_temp.org('05'), 'fornecedor', 'DRENO PGTAP AGENDA', '+5584900000805',
        (select id from public.sources order by id limit 1), 'pgtap',
        'https://exemplo.invalido/dreno', 'a0000000-0000-4000-8000-0000000d0001');

insert into public.tasks (title, kind, due_at, assignee_id, organization_id, origin, priority)
values ('DRENO PGTAP LIGAR', 'call'::app.task_kind, now() - interval '2 hours',
        'a0000000-0000-4000-8000-0000000d0001', pg_temp.org('05'), 'system', 1);

create function pg_temp.na_agenda() returns boolean language sql as $$
  select exists (select 1 from public.meu_dia('a0000000-0000-4000-8000-0000000d0001', 300) m
                  where m.organization_id = pg_temp.org('05'))
$$;

select pg_temp.entrar('a0000000-0000-4000-8000-0000000d0001', 'admin');
select ok(pg_temp.na_agenda(),
          'antes de qualquer opt-out a tarefa está na fila do dia, como tem de estar');
select pg_temp.sair();

-- A supressão chega pelo telefone, sem passar por `organizations.do_not_contact`
-- (é o caso da ficha irmã: quem respondeu "SAIR" de um número que também é o
-- número desta ficha).
select app.suppress('phone', '+5584900000805', 'contact_optout', 'whatsapp'::app.channel, null);
select is((select do_not_contact from public.organizations where id = pg_temp.org('05')),
          false, 'a ficha continua com do_not_contact = false: a supressão veio pelo telefone');
select ok(app.is_suppressed_target(pg_temp.org('05'), null),
          'mas app.is_suppressed_target — a pergunta inteira — já diz que não');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000d0001', 'admin');
select ok(not pg_temp.na_agenda(),
          'e a tarefa some da fila do dia: a agenda reconfere na leitura, não na criação');
select pg_temp.sair();

select * from finish();
rollback;

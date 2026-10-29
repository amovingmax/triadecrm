-- =====================================================================
-- pgTAP — A atitude do cliente (migração 20261029110000)
--
-- Pedido de 29/10/2026 para a Imova: etiqueta de interesse por atitude do
-- cliente, objeção à parte. Este arquivo prova:
--
--   1. SÓ DA IMOVA: num banco da KOMUNE a regra não liga nem com a chave
--      gravada à força, o recálculo não faz nada, o toque e a objeção são
--      recusados, e a migração não agenda job nenhum;
--   2. A REGRA, etiqueta por etiqueta: quem escreveu primeiro é Interessado;
--      quem chamamos e não respondeu é Sem resposta; quem respondeu sem sinal
--      é Morno; etapa quente é Muito interessado; negócio perdido é Sem
--      interesse; supressão é Não contatar;
--   3. ESFRIAR É CULPA DO SILÊNCIO DELE: Interessado esfria 7 dias depois da
--      nossa mensagem sem resposta, Muito interessado em 3; se ele responde,
--      volta; se quem deve a resposta é o time, não esfria;
--   4. O TOQUE de quem atende vale até um fato mais novo, e voltar a escrever
--      sozinho tira de Sem interesse;
--   5. QUEM PODE: só quem escreve e vê a conversa marca; quem não vê a conversa
--      não lê a etiqueta;
--   6. OBJEÇÃO marca e resolve, com o porquê no histórico;
--   7. O WHATSAPP NÃO MUDA: nenhuma mensagem nova, nada na fila de saída, e a
--      conversa (estado, robô, janela, por ler, atendente) fica igual.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(44);

insert into public.allowed_users (email, role, note) values
  ('h117.g@teste.local', 'gestor', 'pgTAP 117'),
  ('h117.s@teste.local', 'sdr', 'pgTAP 117'),
  ('h117.e@teste.local', 'embaixador', 'pgTAP 117'),
  ('h117.l@teste.local', 'leitura', 'pgTAP 117');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000011701'::uuid, 'h117.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000011702'::uuid, 'h117.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000011703'::uuid, 'h117.e@teste.local', '{"full_name":"Eva Embaixadora"}'),
  ('a0000000-0000-4000-8000-000000011704'::uuid, 'h117.l@teste.local', '{"full_name":"Leo Leitura"}');

-- Nada automático responde às mensagens de teste.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999911700"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

insert into public.objecoes (slug, nome, posicao) values ('preco_t117', 'Preço', 1);

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

create temp table t117(chave text primary key, valor uuid);
grant select on t117 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t117 where chave = p_chave
$$;
grant execute on function pg_temp.id(text) to authenticated;

create function pg_temp.conversa(p_chave text, p_tel text, p_org uuid default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome,
                                    assignee_id, status, organization_id)
  values ('whatsapp'::app.channel, '+5584999911700', p_tel, 'Cliente ' || p_chave,
          'a0000000-0000-4000-8000-000000011701'::uuid, 'aguardando_nos', p_org)
  returning id into v;
  insert into t117 values (p_chave, v);
  return v;
end $$;

-- O cliente escreveu (entrada) ou alguém do time escreveu (eco: mensagem de
-- gente, já enviada). As duas com o instante que o teste quiser.
create function pg_temp.dele(p_conv uuid, p_em timestamptz) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'pgtap117 dele', 'system', 'crm', p_em)
$$;
create function pg_temp.nossa(p_conv uuid, p_em timestamptz) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'pgtap117 nossa', 'human', 'echo', 'a0000000-0000-4000-8000-000000011701'::uuid,
          'wamid.PGTAP117.' || gen_random_uuid(), p_em, p_em)
$$;

create function pg_temp.etiqueta(p_conv uuid, p_agora timestamptz default now()) returns text
language plpgsql as $$
begin
  perform app.atitude_gravar(p_conv, null, p_agora);
  return (select t.etiqueta from public.atitudes t where t.conversation_id = p_conv);
end $$;
create function pg_temp.motivo(p_conv uuid) returns text language sql stable as $$
  select t.motivo from public.atitudes t where t.conversation_id = p_conv
$$;

-- De que empresa é o banco, trocada só dentro desta transação (a trava da
-- identidade desligada e religada, como no pgTAP 112).
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

-- =====================================================================
-- 1. Só da Imova: na KOMUNE, nada liga
-- =====================================================================
select pg_temp.conversa('a', '+5584999911701');
select pg_temp.dele(pg_temp.id('a'), now() - interval '2 days');

-- A linha de base do WhatsApp, antes de qualquer função da atitude.
create temp table t117_base as
  select (select count(*) from public.messages where direction = 'out'::app.msg_direction) as saidas,
         (select count(*) from pgmq.q_wa_outbound) as fila;

select pg_temp.virar('komune');
-- A chave gravada à força, como se alguém a pusesse no banco da KOMUNE.
insert into public.app_settings (key, value, description)
values ('atitude', '{"ligada": true}'::jsonb, 'pgTAP 117')
on conflict (key) do update set value = excluded.value;
select is(app.atitude_config() ->> 'ligada', 'false',
  'no banco da KOMUNE a regra não liga, nem com a chave gravada à força');
select is(app.atitudes_recalcular(500), 0, 'o recálculo não faz nada');
select pg_temp.entrar('a0000000-0000-4000-8000-000000011701'::uuid, 'gestor');
select is((public.atitude_marcar(pg_temp.id('a'), 'interessado')) ->> 'motivo', 'desligada',
  'o toque de quem atende é recusado');
select is((public.objecao_marcar(pg_temp.id('a'),
            (select id from public.objecoes where slug = 'preco_t117'), true)) ->> 'motivo',
  'desligada', 'e a objeção também');
select pg_temp.sair();
select is((select count(*)::int from public.atitudes) + (select count(*)::int from public.conversa_objecoes)
          + (select count(*)::int from public.atitude_historico), 0,
  'e nada é gravado: nenhuma etiqueta, objeção ou histórico');
select ok(not exists (select 1 from cron.job where jobname = 'atitudes_recalcular'),
  'a migração não agenda recálculo nenhum: o agendamento é do seed da Imova');
select is(public.empresa_do_banco(), 'komune', 'tudo isso no banco da KOMUNE');

select pg_temp.virar('imova');

-- =====================================================================
-- 2 e 3. A regra e o esfriar
-- =====================================================================
select ok(app.atitudes_recalcular(500) >= 1, 'ligada, o recálculo pega a conversa nova');
select is((select etiqueta from public.atitudes where conversation_id = pg_temp.id('a')), 'interessado',
  'quem escreveu primeiro é Interessado');
select matches(pg_temp.motivo(pg_temp.id('a')), '^Entrou em contato por conta própria em \d\d/\d\d$',
  'e o porquê diz isso, com o dia');

select pg_temp.nossa(pg_temp.id('a'), now() - interval '1 day');
select is(pg_temp.etiqueta(pg_temp.id('a')), 'interessado',
  'respondemos ontem: continua Interessado');
select is((select decai_em from public.atitudes where conversation_id = pg_temp.id('a')),
  now() - interval '1 day' + interval '7 days',
  'e esfria 7 dias depois da nossa mensagem, se ele não responder');
select is(pg_temp.etiqueta(pg_temp.id('a'), now() + interval '5 days'), 'interessado',
  'seis dias depois, ainda não');
select is(pg_temp.etiqueta(pg_temp.id('a'), now() + interval '6 days 1 minute'), 'esfriando',
  'sete dias sem responder: Esfriando');
select is((select antes_de_esfriar from public.atitudes where conversation_id = pg_temp.id('a')),
  'interessado', 'e a etiqueta guarda o que ele era');
select ok(exists (select 1 from public.atitude_historico h
                   where h.conversation_id = pg_temp.id('a') and h.de = 'interessado'
                     and h.para = 'esfriando' and h.motivo like 'Sem responder desde %(era Interessado)'),
  'o histórico guarda a mudança, com o porquê');

select pg_temp.dele(pg_temp.id('a'), now() + interval '6 days 2 minutes');
select is(pg_temp.etiqueta(pg_temp.id('a'), now() + interval '6 days 3 minutes'), 'interessado',
  'ele respondeu: volta a Interessado');
select is(pg_temp.etiqueta(pg_temp.id('a'), now() + interval '30 days'), 'interessado',
  'e, se quem deve a resposta é o time, ele não esfria nunca');

-- Sem resposta, e Morno.
select pg_temp.conversa('b', '+5584999911702');
select pg_temp.nossa(pg_temp.id('b'), now() - interval '3 days');
select is(pg_temp.etiqueta(pg_temp.id('b')), 'sem_resposta', 'chamamos primeiro e ele não respondeu: Sem resposta');
select pg_temp.dele(pg_temp.id('b'), now() - interval '2 days');
select is(pg_temp.etiqueta(pg_temp.id('b')), 'morno',
  'respondeu a nós, sem sinal de interesse ainda: Morno');

-- =====================================================================
-- 4. O toque, e voltar sozinho
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000011702'::uuid, 'sdr');
select is((public.atitude_marcar(pg_temp.id('b'), 'muito_interessado')) ->> 'etiqueta', 'muito_interessado',
  'o SDR marca Muito interessado com um toque');
select is((public.atitude_marcar(pg_temp.id('b'), 'vip')) ->> 'motivo', 'etiqueta_invalida',
  'só as quatro etiquetas que a pessoa pode dar');
select pg_temp.sair();
select is((select marcada_por from public.atitudes where conversation_id = pg_temp.id('b')),
  'a0000000-0000-4000-8000-000000011702'::uuid, 'o toque guarda quem marcou');
select matches(pg_temp.motivo(pg_temp.id('b')), '^Marcado por Sara em \d\d/\d\d$', 'e o porquê diz quem foi');

select pg_temp.nossa(pg_temp.id('b'), now() + interval '1 hour');
select is(pg_temp.etiqueta(pg_temp.id('b'), now() + interval '3 days 59 minutes'), 'muito_interessado',
  'Muito interessado, sem responder há quase 3 dias: ainda não esfriou');
select is(pg_temp.etiqueta(pg_temp.id('b'), now() + interval '3 days 1 hour 1 minute'), 'esfriando',
  'três dias sem responder: Esfriando');

select pg_temp.entrar('a0000000-0000-4000-8000-000000011702'::uuid, 'sdr');
select is((public.atitude_marcar(pg_temp.id('b'), 'sem_interesse')) ->> 'etiqueta', 'sem_interesse',
  'quem atende marca Sem interesse');
select pg_temp.sair();
select pg_temp.dele(pg_temp.id('b'), now() + interval '12 days');
select is(pg_temp.etiqueta(pg_temp.id('b'), now() + interval '12 days 1 minute'), 'interessado',
  'ele voltou a escrever sozinho, onze dias depois: Interessado de novo');
select matches(pg_temp.motivo(pg_temp.id('b')), '^Voltou a escrever sozinho em \d\d/\d\d, depois de 11 dias$',
  'e o porquê conta a volta');

-- =====================================================================
-- 2 (cont.). A etapa do negócio e a supressão
-- =====================================================================
do $$
declare v_org uuid; v_deal uuid;
begin
  insert into public.organizations (kind, name, source_id, collector, owner_id, phone_e164)
  select 'fornecedor'::app.org_kind, 'Ficha pgTAP 117', s.id, 'pgtap117',
         'a0000000-0000-4000-8000-000000011701'::uuid, '+5584999911703'
    from public.sources s order by s.id limit 1
  returning id into v_org;
  insert into t117 values ('org', v_org);
  insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
  select v_org, 1, st.id, 'a0000000-0000-4000-8000-000000011701'::uuid from public.stages st
   where st.pipeline_id = 1 and st.slug = 'apresentacao_realizada'
  returning id into v_deal;
  insert into t117 values ('deal', v_deal);
end $$;
select pg_temp.conversa('c', '+5584999911703', pg_temp.id('org'));
select pg_temp.dele(pg_temp.id('c'), now() - interval '1 day');
select is(pg_temp.etiqueta(pg_temp.id('c'), now() + interval '1 minute'), 'muito_interessado',
  'etapa quente do negócio, mais nova que a mensagem: Muito interessado');
select matches(pg_temp.motivo(pg_temp.id('c')), '^Etapa .+ desde \d\d/\d\d$', 'e o porquê nomeia a etapa');

update public.deals
   set stage_id = (select st.id from public.stages st where st.pipeline_id = 1 and st.slug = 'perdido'),
       lost_reason_id = (select id from public.lost_reasons where is_active order by id limit 1)
 where id = pg_temp.id('deal');
select is(pg_temp.etiqueta(pg_temp.id('c'), now() + interval '3 minutes'), 'sem_interesse',
  'negócio perdido: Sem interesse');

insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex(app.normalize_phone_br('+5584999911701')), 'phone', 'pgtap117');
select is(pg_temp.etiqueta(pg_temp.id('a'), now() + interval '30 days'), 'nao_contatar',
  'na lista de supressão: Não contatar, acima de tudo');

-- A linha que nasce só com o toque, sem passar pela regra, entra no próximo
-- recálculo (achado no ensaio local de 29/10: ela ficava sem etiqueta).
select pg_temp.conversa('d', '+5584999911704');
select pg_temp.dele(pg_temp.id('d'), now() - interval '1 hour');
insert into public.atitudes (conversation_id, marcada, marcada_em)
values (pg_temp.id('d'), 'muito_interessado', now());
select app.atitudes_recalcular(500);
select is((select etiqueta from public.atitudes where conversation_id = pg_temp.id('d')), 'muito_interessado',
  'a linha só com o toque ganha a etiqueta no recálculo seguinte');

-- =====================================================================
-- 5 e 6. Quem pode, e a objeção
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000011704'::uuid, 'leitura');
select is((public.atitude_marcar(pg_temp.id('b'), 'interessado')) ->> 'motivo', 'sem_permissao',
  'quem só lê não marca');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000011703'::uuid, 'embaixador');
select is((select count(*)::int from public.atitudes where conversation_id = pg_temp.id('b')), 0,
  'quem não vê a conversa (embaixador, cliente sem ficha) não lê a etiqueta');
select is((public.objecao_marcar(pg_temp.id('b'),
            (select id from public.objecoes where slug = 'preco_t117'), true)) ->> 'motivo',
  'sem_permissao', 'nem marca objeção');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000011701'::uuid, 'gestor');
select is((public.objecao_marcar(pg_temp.id('b'),
            (select id from public.objecoes where slug = 'preco_t117'), true)) ->> 'ok', 'true',
  'o gestor marca a objeção Preço');
select is((public.objecao_marcar(pg_temp.id('b'),
            (select id from public.objecoes where slug = 'preco_t117'), false)) ->> 'ok', 'true',
  'e resolve');
select pg_temp.sair();
select is((select array_agg(h.motivo order by h.id) from public.atitude_historico h
            where h.conversation_id = pg_temp.id('b') and h.tipo = 'objecao'),
  array['Objeção: Preço', 'Objeção resolvida: Preço'],
  'as duas coisas ficam no histórico, nessa ordem');
select is((select etiqueta from public.atitudes where conversation_id = pg_temp.id('b')), 'interessado',
  'a objeção não mexe na etiqueta de interesse');

-- =====================================================================
-- 7. O WhatsApp não muda
-- =====================================================================
select is((select count(*) from public.messages m where m.direction = 'out'::app.msg_direction
            and m.body is distinct from 'pgtap117 nossa'),
  (select saidas from t117_base),
  'nenhuma mensagem de saída nasceu além das do próprio teste');
select is((select count(*) from pgmq.q_wa_outbound), (select fila from t117_base),
  'e nada entrou na fila de saída do WhatsApp');

-- A conversa B antes e depois de tudo o que a atitude faz, sem mensagem de
-- teste no meio: o toque, a objeção, o cálculo e o recálculo.
create temp table t117_b as
  select row(c.status, c.bot_paused, c.window_expires_at, c.unread_count, c.assignee_id,
             c.last_message_at, c.snoozed_until, c.arquivada_em)::text as antes
    from public.conversations c where c.id = pg_temp.id('b');
select pg_temp.entrar('a0000000-0000-4000-8000-000000011701'::uuid, 'gestor');
select public.atitude_marcar(pg_temp.id('b'), 'morno');
select public.objecao_marcar(pg_temp.id('b'), (select id from public.objecoes where slug = 'preco_t117'), true);
select pg_temp.sair();
select app.atitude_gravar(pg_temp.id('b'), null, now() + interval '40 days');
select app.atitudes_recalcular(500);
select is((select row(c.status, c.bot_paused, c.window_expires_at, c.unread_count, c.assignee_id,
                      c.last_message_at, c.snoozed_until, c.arquivada_em)::text
             from public.conversations c where c.id = pg_temp.id('b')),
  (select antes from t117_b),
  'a conversa fica igual: estado, robô, janela, por ler, atendente, adiamento e arquivo');

select * from finish();
rollback;

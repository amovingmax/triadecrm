-- =====================================================================
-- pgTAP — O WhatsApp passa a sair do CRM
--         (migração 20260914100000_o_whatsapp_passa_a_sair_do_crm.sql)
--
-- O que este arquivo prova, nesta ordem:
--
--   1. O MODELO SE PREENCHE. Variáveis na ordem, sem repetir; valor sem quebra
--      de linha; barra invertida não quebra a substituição.
--   2. SEM NÚMERO, NADA. Enquanto nenhum número foi conectado, a prévia diz
--      por quê e o envio recusa com o mesmo motivo.
--   3. CONECTAR É DO WORKER, e número novo recomeça o aquecimento do teto —
--      o mesmo número, reconectado, não.
--   4. A PRÉVIA diz o que barraria o envio (sem WhatsApp, suprimido, teto) e
--      só oferece modelo que a Meta aprovou.
--   5. O ENVIO exige toda variável, exige aprovação da Meta fora da janela,
--      recusa modelo de sistema, cria UMA conversa por par de números e grava
--      exatamente o que vai no fio. Supressão continua sendo do guarda — e a
--      recusa desfaz a conversa que o envio criou.
--   6. PRIMEIRO CONTATO É DERIVADO: quem insere direto dizendo "não é primeiro
--      contato" não passa por fora do teto do número.
--   7. AS PORTAS DA META são do worker; status desconhecido não aprova nada.
--   8. VÁRIOS ATENDENTES NUM NÚMERO SÓ: o modelo leva o nome de quem clicou (e
--      ninguém escolhe outro), o texto livre sai assinado com o primeiro nome,
--      quem responde passa a atender, e dá para assumir antes de responder.
--
-- Nenhuma asserção conta linha absoluta em tabela compartilhada: tudo é DELTA
-- ou escopo pelos ids e telefones deste arquivo. Roda em transação e desfaz.
-- =====================================================================
begin;
select plan(64);

-- ---------- sessões (simulam o JWT do PostgREST) ----------
create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.entrar_como_worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.sdr() returns uuid language sql as $$
  select 'a0000000-0000-4000-8000-00000000e401'::uuid
$$;
create function pg_temp.leitor() returns uuid language sql as $$
  select 'a0000000-0000-4000-8000-00000000e402'::uuid
$$;
create function pg_temp.gestor() returns uuid language sql as $$
  select 'a0000000-0000-4000-8000-00000000e403'::uuid
$$;
create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-00000000e4' || p_n)::uuid
$$;
create function pg_temp.modelo(p_codigo text) returns int language sql as $$
  select id from public.message_templates where template_code = p_codigo
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert, update on pg_temp.r to authenticated, service_role;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;

-- ---------- leituras FORA da RLS ----------
create function pg_temp.n_conversas(p_peer text) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from public.conversations where peer_phone_e164 = p_peer
$$;
create function pg_temp.config(p_chave text) returns jsonb
language sql security definer set search_path = '' as $$
  select value from public.app_settings where key = p_chave
$$;
create function pg_temp.primeiros_hoje() returns int
language sql security definer set search_path = '' as $$
  select app.primeiros_contatos_do_dia('whatsapp'::app.channel,
                                       (now() at time zone 'America/Fortaleza')::date,
                                       '+5584999994300')
$$;
grant execute on function pg_temp.n_conversas(text), pg_temp.config(text), pg_temp.primeiros_hoje()
  to authenticated, service_role;

-- A janela de horário sempre aberta, DENTRO da transação: o que este arquivo
-- testa é a porta nova, não a porteira do RF-CON-11 (que é do 17 e do 24).
create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                            'fecha_em', now() + interval '4 hours')
$$;

-- ---------- gente ----------
insert into public.allowed_users (email, role, note) values
  ('w43.sdr@teste.local',     'sdr',     'pgTAP WhatsApp no CRM'),
  ('w43.leitura@teste.local', 'leitura', 'pgTAP WhatsApp no CRM'),
  ('w43.gestor@teste.local',  'gestor',  'pgTAP WhatsApp no CRM');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.sdr(),    'w43.sdr@teste.local',     '{"full_name":"Sdr W43"}'),
  (pg_temp.leitor(), 'w43.leitura@teste.local', '{"full_name":"Leitura W43"}'),
  (pg_temp.gestor(), 'w43.gestor@teste.local',  '{"full_name":"GENOVEVA PGTAP"}');

-- ---------- as fichas ----------
-- 01 com WhatsApp e pessoa principal, achada no Google Maps (o caso feliz)
-- 02 sem telefone nenhum, veio de planilha
-- 03 pediu para sair
-- 04 com WhatsApp, para o teto
-- 05 sem telefone na ficha, só na pessoa principal
insert into public.organizations (id, name, phone_e164, source_id, owner_id) values
  (pg_temp.org('01'), 'W43 Buffet Com Whats', '+5584999994301',
   (select id from public.sources where slug = 'google_places'), null),
  (pg_temp.org('02'), 'W43 Sem Telefone', null,
   (select id from public.sources where slug = 'planilha'), null),
  (pg_temp.org('03'), 'W43 Pediu Para Sair', '+5584999994303',
   (select id from public.sources where slug = 'google_places'), null),
  (pg_temp.org('04'), 'W43 Segunda Abertura', '+5584999994304',
   (select id from public.sources where slug = 'google_places'), null),
  (pg_temp.org('05'), 'W43 Telefone Na Pessoa', null,
   (select id from public.sources where slug = 'instagram'), null);
update public.organizations set do_not_contact = true where id = pg_temp.org('03');
insert into public.organization_categories (organization_id, category_id, is_primary)
select pg_temp.org('01'), id, true from public.categories where slug = 'buffet_adulto_corporativo';

insert into public.contacts (id, full_name, phone_e164) values
  ('b0000000-0000-4000-8000-00000000e401', 'Mariana Souza', '+5584988884301'),
  ('b0000000-0000-4000-8000-00000000e405', 'Joana Lima',    '+5584988884305');
insert into public.organization_contacts (organization_id, contact_id, is_primary) values
  (pg_temp.org('01'), 'b0000000-0000-4000-8000-00000000e401', true),
  (pg_temp.org('05'), 'b0000000-0000-4000-8000-00000000e405', true);

-- Nenhum número conectado no começo, seja qual for o estado do banco.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', 'null'::jsonb)
 where key = 'whatsapp.envio';

-- A abertura A de Alimentos & Bebidas aprovada pela Meta; o follow-up, não.
-- Fora de uso desde 22/09/2026 (só o cumprimento abre conversa); o teste reativa
-- porque prova o mecanismo do envio, não o catálogo.
update public.message_templates
   set meta_status = 'approved', meta_template_name = 'aeb_abr_a_v1', is_active = true
 where template_code = 'AEB-ABR-A';
update public.message_templates
   set meta_status = 'pending', meta_template_name = null, is_active = true
 where template_code = 'GEN-FUP-D3-V1';

-- =====================================================================
-- 1. O modelo se preenche
-- =====================================================================
select is(app.modelo_variaveis('Oi {{nome}}, a {{ empresa }} e {{nome}} de novo'),
          array['nome', 'empresa'],
          'variáveis na ordem da primeira aparição, sem repetir, com ou sem espaço dentro das chaves');
select is(app.modelo_renderizar('Oi {{nome}}, da {{empresa}} ({{origem}})',
                                jsonb_build_object('nome', E'Ana\n  Maria', 'empresa', 'C\D')),
          'Oi Ana Maria, da C\D ({{origem}})',
          'o valor perde quebra de linha e espaço repetido; barra invertida entra literal; sem valor, a variável fica');
select is(app.modelo_parametro_limpo(E' \t '), null, 'valor só de espaço é valor nenhum');

-- =====================================================================
-- 2. Sem número, nada
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
insert into pg_temp.r values ('previa_sem_numero', public.wa_preparar_envio(pg_temp.org('01')));
select is(pg_temp.v('previa_sem_numero') #>> '{bloqueio,motivo}', 'whatsapp_nao_configurado',
          'sem número conectado, a prévia diz por quê');
select throws_like(
  format($$ select public.wa_enviar_modelo(%L, %s, '{"nome":"a","empresa":"b","origem":"c","detalhe":"d"}') $$,
         pg_temp.org('01'), pg_temp.modelo('AEB-ABR-A')),
  '%whatsapp_nao_configurado%', 'e o envio recusa com o mesmo motivo');

-- =====================================================================
-- 3. Conectar é do worker
-- =====================================================================
select throws_ok($$ select public.wa_numero_configurar('+5584999994300', '1', '2') $$,
                 '42501', NULL, 'uma pessoa não conecta número');
select pg_temp.sair();

update public.app_settings set value = jsonb_set(value, '{inicio}', '"2026-09-04"')
 where key = 'cadencia.tetos';

select pg_temp.entrar_como_worker();
insert into pg_temp.r values ('conectar',
  public.wa_numero_configurar('+55 (84) 99999-4300', '109876', '554433', 'Komune', 'GREEN'));
select pg_temp.sair();
select is(pg_temp.v('conectar') ->> 'numero_padrao', '+5584999994300',
          'o número chega no formato da Meta e é gravado em E.164');
select is(pg_temp.config('whatsapp.envio') ->> 'numero_padrao', '+5584999994300',
          'e é o número padrão de envio');
select is(pg_temp.config('whatsapp.numero') ->> 'phone_number_id', '109876',
          'os ids públicos da Meta ficam em whatsapp.numero');
select is(pg_temp.config('cadencia.tetos') ->> 'inicio',
          to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM-DD'),
          'número novo recomeça o aquecimento do teto hoje');

update public.app_settings set value = jsonb_set(value, '{inicio}', '"2026-01-01"')
 where key = 'cadencia.tetos';
select pg_temp.entrar_como_worker();
insert into pg_temp.r values ('reconectar',
  public.wa_numero_configurar('+5584999994300', '109876', '554433', 'Komune', 'GREEN'));
select pg_temp.sair();
select is(pg_temp.config('cadencia.tetos') ->> 'inicio', '2026-01-01',
          'o MESMO número reconectado não recomeça o aquecimento');
-- Daqui para baixo o teto é o da primeira semana, contado a partir de hoje.
-- TRÊS, e não dois, desde 25/09/2026: o teto passou a contar ABERTURA em vez de
-- "primeiro contato" (migração 20260925170000), e o segundo envio para a mesma
-- ficha — que não é primeiro contato, mas é conversa aberta pela empresa —
-- passou a gastar cota como a Meta o conta. São três envios até a prévia da
-- ficha 04: 01, 01b e 05. Reancorar o teto é o certo; afrouxá-lo seria reabrir
-- justamente o furo que a migração fechou.
update public.app_settings
   set value = jsonb_set(jsonb_set(value, '{inicio}',
                 to_jsonb(to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM-DD'))),
                 '{whatsapp,semana1}', '3')
 where key = 'cadencia.tetos';

-- =====================================================================
-- 4. A prévia
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
insert into pg_temp.r values ('previa_01', public.wa_preparar_envio(pg_temp.org('01')));
insert into pg_temp.r values ('previa_02', public.wa_preparar_envio(pg_temp.org('02')));
insert into pg_temp.r values ('previa_03', public.wa_preparar_envio(pg_temp.org('03')));

select ok((pg_temp.v('previa_01') ->> 'numero_configurado')::boolean
          and (pg_temp.v('previa_01') ->> 'tem_whatsapp')::boolean
          and (pg_temp.v('previa_01') ->> 'primeiro_contato')::boolean
          and pg_temp.v('previa_01') -> 'bloqueio' = 'null'::jsonb,
          'ficha com WhatsApp e número conectado: nada barra, e é primeiro contato');
select is(pg_temp.v('previa_01') #>> '{valores,nome}', 'Mariana', 'sugere o primeiro nome da pessoa principal');
select is(pg_temp.v('previa_01') #>> '{valores,origem}', 'Google Maps', 'e a fonte, quando é um lugar público');
select is(pg_temp.v('previa_01') #>> '{valores,atendente}', 'Sdr', 'e o nome de quem vai mandar, para a prévia mostrar');
select is(pg_temp.v('previa_01') ->> 'segmento', 'AEB', 'buffet é Alimentos & Bebidas (R08 §2.1)');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.v('previa_01') -> 'modelos') e
                   where e.value ->> 'codigo' = 'AEB-ABR-A'),
          'oferece o modelo que a Meta aprovou');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.v('previa_01') -> 'modelos') e
                       where e.value ->> 'codigo' = 'GEN-FUP-D3-V1'
                          or e.value ->> 'codigo' like 'GEN-SYS-%'),
          'e não oferece modelo pendente na Meta nem modelo de sistema');
select is(pg_temp.v('previa_02') #>> '{bloqueio,motivo}', 'ficha_sem_whatsapp',
          'ficha sem telefone: a prévia diz que não há para onde mandar');
select ok(not (pg_temp.v('previa_02') -> 'valores' ? 'origem'),
          '"Planilha (importação)" não é sugerido como origem numa abertura');
select is(pg_temp.v('previa_03') #>> '{bloqueio,motivo}', 'contato_suprimido',
          'quem pediu para sair: a prévia já diz, antes de alguém escrever');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.leitor(), 'leitura');
select throws_ok(format($$ select public.wa_preparar_envio(%L) $$, pg_temp.org('01')),
                 '42501', NULL, 'leitura não envia, então nem prepara envio');
select pg_temp.sair();

-- =====================================================================
-- 5. O envio
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select throws_like(
  format($$ select public.wa_enviar_modelo(%L, %s, '{"nome":"Mariana","empresa":"X","origem":"Google Maps"}') $$,
         pg_temp.org('01'), pg_temp.modelo('AEB-ABR-A')),
  '%modelo_sem_parametro (detalhe)%', 'toda variável precisa de valor, e a recusa diz qual faltou');
select throws_like(
  format($$ select public.wa_enviar_modelo(%L, %s, '{"nome":"Mariana"}') $$,
         pg_temp.org('01'), pg_temp.modelo('GEN-FUP-D3-V1')),
  '%modelo_nao_aprovado_na_meta%', 'fora da janela de 24 h, modelo sem aprovação da Meta não entra na fila');
select throws_like(
  format($$ select public.wa_enviar_modelo(%L, %s, '{}') $$,
         pg_temp.org('01'), pg_temp.modelo('GEN-SYS-OPTOUT')),
  '%modelo_de_sistema%', 'modelo de sistema não é mandado à mão');
select throws_like(
  format($$ select public.wa_enviar_modelo(%L, %s, '{"nome":"a","empresa":"b","origem":"c","detalhe":"d"}') $$,
         pg_temp.org('03'), pg_temp.modelo('AEB-ABR-A')),
  '%contato_suprimido%', 'quem pediu para sair não recebe: a recusa é do messages_guard');
select is(pg_temp.n_conversas('+5584999994303'), 0,
          'e a recusa desfaz a conversa que o envio tinha criado');

insert into pg_temp.r values ('envio_01', public.wa_enviar_modelo(pg_temp.org('01'), pg_temp.modelo('AEB-ABR-A'),
  '{"nome":"Mariana","empresa":"W43 Buffet","origem":"Google Maps","detalhe":"doces finos","lixo":"fora","atendente":"Heloísa"}'));
select pg_temp.sair();

select ok((pg_temp.v('envio_01') ->> 'ok')::boolean, 'com tudo preenchido e aprovado, a mensagem entra na fila');
select is((select jsonb_build_object('status', m.status, 'type', m.type, 'autor', m.author_kind,
                                     'por', m.sent_by, 'primeiro', m.is_first_contact)
             from public.messages m where m.id = (pg_temp.v('envio_01') ->> 'message_id')::uuid),
          jsonb_build_object('status', 'queued', 'type', 'template', 'autor', 'human',
                             'por', pg_temp.sdr(), 'primeiro', true),
          'na fila, como modelo, assinada por quem clicou, e contada como primeiro contato');
select is((select m.template_params from public.messages m
            where m.id = (pg_temp.v('envio_01') ->> 'message_id')::uuid),
          '{"nome":"Mariana","atendente":"Sdr","empresa":"W43 Buffet","origem":"Google Maps","detalhe":"doces finos"}'::jsonb,
          'os parâmetros gravados são exatamente as variáveis do modelo — a chave a mais fica de fora');
select ok((select m.body like 'Oi, Mariana, tudo bem? Aqui é Sdr, da Komune%' and m.body not like '%{{%'
             from public.messages m where m.id = (pg_temp.v('envio_01') ->> 'message_id')::uuid),
          'o corpo gravado é o texto preenchido, que é o que a tela mostra — e se apresenta como quem clicou');
select ok((select m.body not like '%Heloísa%'
             from public.messages m where m.id = (pg_temp.v('envio_01') ->> 'message_id')::uuid),
          '{{atendente}} é sempre quem clicou: mandar "atendente": "Heloísa" não põe a Heloísa no texto');
select ok((select m.body not like '*%'
             from public.messages m where m.id = (pg_temp.v('envio_01') ->> 'message_id')::uuid),
          'modelo não ganha a linha de assinatura: o texto é o que a Meta aprovou, e o nome já vai dentro');
select is((select jsonb_build_object('org', c.organization_id, 'peer', c.peer_phone_e164,
                                     'numero', c.business_number, 'dono', c.assignee_id,
                                     'status', c.status)
             from public.conversations c where c.id = (pg_temp.v('envio_01') ->> 'conversation_id')::uuid),
          jsonb_build_object('org', pg_temp.org('01'), 'peer', '+5584999994301',
                             'numero', '+5584999994300', 'dono', pg_temp.sdr(),
                             'status', 'aguardando_parceiro'),
          'a conversa nasce ligada à ficha, no WhatsApp da ficha, com dono (quem mandou, se a ficha não tem)');

select pg_temp.entrar(pg_temp.sdr(), 'sdr');
insert into pg_temp.r values ('envio_01b', public.wa_enviar_modelo(pg_temp.org('01'), pg_temp.modelo('AEB-ABR-A'),
  '{"nome":"Mariana","empresa":"W43 Buffet","origem":"Google Maps","detalhe":"doces finos"}'));
insert into pg_temp.r values ('envio_05', public.wa_enviar_modelo(pg_temp.org('05'), pg_temp.modelo('AEB-ABR-A'),
  '{"nome":"Joana","empresa":"W43 Telefone Na Pessoa","origem":"Instagram","detalhe":"bolos"}'));
select pg_temp.sair();

select is(pg_temp.v('envio_01b') ->> 'conversation_id', pg_temp.v('envio_01') ->> 'conversation_id',
          'o segundo envio para a mesma ficha cai na MESMA conversa');
select is((pg_temp.v('envio_01b') ->> 'primeiro_contato')::boolean, false,
          'e não é mais primeiro contato');
select ok(pg_temp.v('previa_01') -> 'sem_resposta_desde' = 'null'::jsonb,
          'antes de mandar, não há o que esperar');
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
insert into pg_temp.r values ('previa_01_depois', public.wa_preparar_envio(pg_temp.org('01')));
select pg_temp.sair();
select ok(pg_temp.v('previa_01_depois') ->> 'sem_resposta_desde' is not null,
          'depois de mandar, a prévia diz desde quando esperamos resposta — a tela não oferece a segunda abertura de cara');
select is(pg_temp.primeiros_hoje(), 2,
          'duas fichas abordadas, dois primeiros contatos no número — não três');
select is((select c.peer_phone_e164 from public.conversations c
            where c.id = (pg_temp.v('envio_05') ->> 'conversation_id')::uuid),
          '+5584988884305', 'sem telefone na ficha, vai para o WhatsApp da pessoa principal');

-- =====================================================================
-- 6. Primeiro contato é derivado, e o teto vale
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
insert into pg_temp.r values ('previa_04', public.wa_preparar_envio(pg_temp.org('04')));
select is(pg_temp.v('previa_04') #>> '{bloqueio,motivo}', 'teto_do_numero',
          'teto da primeira semana (3) gasto: a prévia diz antes do clique');
select throws_like(
  format($$ select public.wa_enviar_modelo(%L, %s, '{"nome":"a","empresa":"b","origem":"c","detalhe":"d"}') $$,
         pg_temp.org('04'), pg_temp.modelo('AEB-ABR-A')),
  '%teto_do_numero%', 'e o envio recusa');
select pg_temp.sair();

insert into public.conversations (id, channel, business_number, peer_phone_e164, organization_id, assignee_id)
values ('f0000000-0000-4000-8000-00000000e404', 'whatsapp', '+5584999994300', '+5584999994304',
        pg_temp.org('04'), pg_temp.sdr());
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body, template_id,
                               author_kind, sent_by, origin, is_first_contact)
  values ('f0000000-0000-4000-8000-00000000e404', 'out', 'template', 'queued', 'Oi',
          (select id from public.message_templates where template_code = 'AEB-ABR-A'),
          'human', 'a0000000-0000-4000-8000-00000000e401', 'crm', false) $$,
  '%teto_do_numero%',
  'inserir direto dizendo "não é primeiro contato" não passa por fora do teto: a coluna é derivada');
select pg_temp.sair();

-- =====================================================================
-- 7. As portas da Meta
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select throws_ok($$ select public.wa_modelos_para_meta() $$, '42501', NULL,
                 'uma pessoa não lista o que vai para a Meta');
select throws_ok(format($$ select public.wa_modelo_meta_registrar(%s, 'x', 'APPROVED') $$,
                        pg_temp.modelo('GEN-FUP-D3-V1')),
                 '42501', NULL, 'nem aprova modelo por conta própria');
select pg_temp.sair();

select pg_temp.entrar_como_worker();
insert into pg_temp.r values ('para_meta', public.wa_modelos_para_meta());
select throws_ok(format($$ select public.wa_enviar_modelo(%L, %s, '{}') $$,
                        pg_temp.org('01'), pg_temp.modelo('AEB-ABR-A')),
                 '42501', NULL, 'e o worker não envia modelo em nome de ninguém (ADR-05)');
select pg_temp.sair();

select is((select e.value - 'template_id' - 'corpo' - 'nome_meta_atual' - 'situacao_atual' - 'botoes' - 'link_base'
             from jsonb_array_elements(pg_temp.v('para_meta')) e where e.value ->> 'codigo' = 'AEB-ABR-A'),
          jsonb_build_object('codigo', 'AEB-ABR-A', 'nome_sugerido', 'aeb_abr_a_v' ||
                               (select version from public.message_templates where template_code = 'AEB-ABR-A'),
                             'categoria', 'MARKETING', 'idioma', 'pt_BR',
                             'variaveis', jsonb_build_array('nome', 'atendente', 'empresa', 'origem', 'detalhe')),
          'cada modelo vai com nome da Meta (código + versão), categoria, idioma e as variáveis em ordem');
select ok((select e.value ->> 'categoria' = 'UTILITY' and e.value ->> 'corpo' not like '%{{%'
             from jsonb_array_elements(pg_temp.v('para_meta')) e where e.value ->> 'codigo' = 'GEN-SYS-OPTOUT'),
          'a confirmação de opt-out vai como utility e com o texto fixo, sem o vocativo');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.v('para_meta')) e
                       join public.message_templates t on t.template_code = e.value ->> 'codigo'
                      where t.category = 'service' and t.template_code <> 'GEN-SYS-OPTOUT'),
          'resposta livre de janela (service) não vai para a Meta');

select pg_temp.entrar_como_worker();
insert into pg_temp.r values ('reg_aprovado',
  public.wa_modelo_meta_registrar(pg_temp.modelo('GEN-FUP-D3-V1'), 'gen_fup_d3_v1_v1', 'APPROVED', 'NONE', '991'));
select pg_temp.sair();
select is((select jsonb_build_object('s', meta_status, 'cru', meta_status_raw, 'motivo', meta_rejection_reason,
                                     'nome', meta_template_name, 'id', meta_template_id)
             from public.message_templates where template_code = 'GEN-FUP-D3-V1'),
          '{"s":"approved","cru":"APPROVED","motivo":null,"nome":"gen_fup_d3_v1_v1","id":"991"}'::jsonb,
          'APPROVED vira approved, e o "NONE" da Meta não vira motivo');

select pg_temp.entrar_como_worker();
insert into pg_temp.r values ('reg_pausado',
  public.wa_modelo_meta_registrar(pg_temp.modelo('GEN-FUP-D3-V1'), null, 'paused', 'qualidade baixa'));
insert into pg_temp.r values ('reg_estranho',
  public.wa_modelo_meta_registrar(pg_temp.modelo('AEB-ABR-A'), null, 'ALGO_NOVO_DA_META'));
select pg_temp.sair();
select is((select jsonb_build_object('s', meta_status, 'cru', meta_status_raw, 'motivo', meta_rejection_reason,
                                     'nome', meta_template_name)
             from public.message_templates where template_code = 'GEN-FUP-D3-V1'),
          '{"s":"rejected","cru":"PAUSED","motivo":"qualidade baixa","nome":"gen_fup_d3_v1_v1"}'::jsonb,
          'PAUSADO não sai: vira rejected, com o motivo, e o nome da Meta fica');
select is((select meta_status from public.message_templates where template_code = 'AEB-ABR-A'),
          'rejected', 'status que a Meta inventar amanhã não aprova nada (falha fechada)');

-- =====================================================================
-- 8. Vários atendentes num número só
-- =====================================================================
select is(app.primeiro_nome(pg_temp.gestor()), 'Genoveva',
          'nome todo em maiúsculas vira "Genoveva", não "GENOVEVA"');
update public.profiles set full_name = 'idalecio.pgtap@teste.local' where id = pg_temp.leitor();
select is(app.primeiro_nome(pg_temp.leitor()), 'Idalecio',
          'sem nome no Google, o começo do e-mail vira "Idalecio"');

-- A conversa da ficha 01 com a janela de 24 h aberta: o parceiro respondeu.
update public.conversations set last_inbound_at = now() - interval '5 minutes'
 where id = (pg_temp.v('envio_01') ->> 'conversation_id')::uuid;

select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
values ((pg_temp.v('envio_01') ->> 'conversation_id')::uuid, 'out', 'text', 'queued',
        'Oi, Mariana! Consigo te explicar amanhã às 10h?', 'human', pg_temp.gestor(), 'crm');
select pg_temp.sair();

-- Tudo nesta transação tem o mesmo now(): a mensagem é achada pelo texto, não pela hora.
select is((select m.body from public.messages m
            where m.conversation_id = (pg_temp.v('envio_01') ->> 'conversation_id')::uuid
              and m.type = 'text' and m.body like '%Consigo te explicar%'),
          E'*Genoveva:*\nOi, Mariana! Consigo te explicar amanhã às 10h?',
          'texto livre sai com o primeiro nome de quem escreveu em negrito na primeira linha');
select is((select c.assignee_id from public.conversations c
            where c.id = (pg_temp.v('envio_01') ->> 'conversation_id')::uuid),
          pg_temp.gestor(), 'quem respondeu passa a atender a conversa');

select pg_temp.entrar(pg_temp.sdr(), 'sdr');
insert into pg_temp.r values ('assumir', public.assumir_conversa((pg_temp.v('envio_01') ->> 'conversation_id')::uuid));
insert into pg_temp.r values ('assumir_de_novo', public.assumir_conversa((pg_temp.v('envio_01') ->> 'conversation_id')::uuid));
select pg_temp.sair();
select is(pg_temp.v('assumir') ->> 'anterior', 'Genoveva', 'assumir diz de quem a conversa era');
select is((select c.assignee_id from public.conversations c
            where c.id = (pg_temp.v('envio_01') ->> 'conversation_id')::uuid),
          pg_temp.sdr(), 'e a conversa passa a ser de quem assumiu');
select is((pg_temp.v('assumir_de_novo') ->> 'ja_era_sua')::boolean, true, 'assumir o que já é seu não muda nada');

select pg_temp.entrar(pg_temp.leitor(), 'leitura');
select throws_ok(format($$ select public.assumir_conversa(%L) $$, pg_temp.v('envio_01') ->> 'conversation_id'),
                 '42501', NULL, 'leitura não atende conversa');
select pg_temp.sair();

-- A assinatura desliga por configuração.
update public.app_settings set value = jsonb_set(value, '{assinar_com_nome}', 'false') where key = 'whatsapp.envio';
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
values ((pg_temp.v('envio_01') ->> 'conversation_id')::uuid, 'out', 'text', 'queued',
        'Mensagem sem assinatura', 'human', pg_temp.sdr(), 'crm');
select pg_temp.sair();
select is((select m.body from public.messages m
            where m.conversation_id = (pg_temp.v('envio_01') ->> 'conversation_id')::uuid
              and m.type = 'text' and m.body like '%sem assinatura%'),
          'Mensagem sem assinatura', 'com whatsapp.envio.assinar_com_nome = false, o texto sai sem a linha do nome');

select is((select count(*)::int from public.message_templates
            where is_active and channel = 'whatsapp' and category in ('marketing', 'utility')
              and body ilike '%heloísa%'),
          0, 'nenhum modelo que vai à Meta cita a Heloísa: o nome é de quem envia');
select is((select count(*)::int from public.message_templates
            where is_active and channel = 'whatsapp' and category in ('marketing', 'utility')
              and (body ~ '^[[:space:][:punct:]]*\{\{' or body ~ '\}\}[[:space:][:punct:]]*$')),
          0, 'e nenhum começa ou termina em variável, que a Meta recusa');
select is((select variables from public.message_templates where template_code = 'GEN-FUP-LIG-V1'),
          '["atendente", "empresa", "nome", "origem"]'::jsonb,
          'a lista de variáveis acompanha o texto novo');

select * from finish();
rollback;

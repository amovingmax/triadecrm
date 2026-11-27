-- =====================================================================
-- pgTAP — "Chamar com a IA": o lead do portal que nunca falou com a Imova
-- (migração 20261127170000, Imova)
--
-- Prova:
--   1. só admin, gestor e SDR veem a prévia e chamam;
--   2. a prévia sugere o primeiro nome e o trecho do imóvel (tipo, área ou
--      quartos, "para alugar", bairro, portal certo; o chat é da OLX; sem anúncio,
--      "no nosso anúncio") e diz por que não pode (modelo não aprovado);
--   3. nome com número e trecho com número comprido são recusados;
--   4. chamar: cria a ficha de quem só clicou, abre a conversa, põe o modelo na
--      fila como mensagem automática com as duas variáveis, liga o lead à
--      conversa ("em atendimento", com quem clicou) e a IA assume a resposta;
--   5. o segundo clique encontra a conversa; descartado, suprimido e sem
--      telefone não são chamados.
--
-- Só na Imova. Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'pgTAP 209 é da Imova: rode no banco local da Imova';
  end if;
end $$;

select plan(31);

insert into public.allowed_users (email, role, note) values
  ('a209@teste.local', 'admin', 'pgTAP 209'),
  ('s209@teste.local', 'sdr', 'pgTAP 209'),
  ('l209@teste.local', 'leitura', 'pgTAP 209');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000020901'::uuid, 'a209@teste.local', '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000020902'::uuid, 's209@teste.local', '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000020903'::uuid, 'l209@teste.local', '{"full_name":"Lia Leitura"}');

create function pg_temp.ana() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020901'::uuid $$;
create function pg_temp.sara() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020902'::uuid $$;
create function pg_temp.lia() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020903'::uuid $$;
create function pg_temp.entrar(p_id uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

-- O WhatsApp configurado, sem as automáticas, e a janela de envio aberta o tempo
-- todo (o teste não depende da hora em que roda).
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999920900"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
-- A janela do canal: fechada primeiro (o caso "fora do horário"), depois aberta.
-- Só dentro desta transação; o rollback do fim devolve a função de verdade.
create or replace function app.janela_do_canal(p_channel app.channel, p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', false, 'motivo', 'antes_da_abertura',
                            'abre_em', '2030-01-07 08:00:00-03'::timestamptz, 'fecha_em', null)
$$;
-- A IA ligada com os clientes (para provar que ela assume a resposta).
insert into public.app_settings (key, value) values ('ia.atendente', '{"ligada": true, "modo": "clientes"}')
on conflict (key) do update set value = public.app_settings.value || '{"ligada": true, "modo": "clientes"}';

create temp table t209(chave text primary key, valor uuid);
grant select on t209 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t209 where chave = p_chave
$$;

-- Os anúncios: a sala de aluguel do Brisa Mall e o terreno de Capim Macio.
with a as (
  insert into public.anuncios (tipo, negocio, titulo, bairro, cidade, area_util, preco_aluguel)
  values ('sala_comercial', 'aluguel', 'Sala comercial 19m² no Brisa Mall', 'Ponta Negra', 'Natal', 19, 1600)
  returning id)
insert into t209 select 'sala', id from a;
with a as (
  insert into public.anuncios (tipo, negocio, titulo, bairro, cidade, area_total, preco_venda)
  values ('terreno', 'venda', 'Terreno à venda com 3.000 m² em Capim Macio', 'Capim Macio', 'Natal', 3000, 5500000)
  returning id)
insert into t209 select 'terreno', id from a;

-- Os leads, todos sem conversa: o do chat da OLX (sem portal no aviso), o que viu
-- o telefone no ZAP, o que viu o telefone sem anúncio, um sem telefone, um
-- descartado e um suprimido.
create function pg_temp.lead(p_chave text, p_tipos text[], p_portal text, p_anuncio uuid,
                             p_nome text, p_tel text, p_situacao text default 'novo')
returns void language plpgsql as $$
declare v uuid;
begin
  insert into public.portal_leads (origem, origin_lead_id, tipos, portal, anuncio_id, transacao, situacao, recebido_em)
  values ('grupo_olx', 'pgtap-209-' || p_chave, p_tipos, p_portal, p_anuncio,
          case when p_chave = 'chat' then 'RENT' else 'SELL' end, p_situacao, now())
  returning id into v;
  insert into public.portal_lead_contatos (lead_id, nome, telefone_e164, email)
  values (v, p_nome, p_tel, lower(p_chave) || '@teste.local');
  insert into t209 values (p_chave, v);
end $$;
select pg_temp.lead('chat', '{CONTACT_CHAT}', null, pg_temp.id('sala'), 'CESAR FORTUNA', '+5584988209001');
select pg_temp.lead('zap', '{PHONE_VIEW}', 'zap', pg_temp.id('terreno'), 'maria clara', '+5584988209002');
select pg_temp.lead('semanuncio', '{PHONE_VIEW}', null, null, 'Pedro', '+5584988209003');
select pg_temp.lead('semtel', '{PHONE_VIEW}', null, pg_temp.id('terreno'), 'Rui', null);
select pg_temp.lead('descartado', '{PHONE_VIEW}', null, pg_temp.id('terreno'), 'Davi', '+5584988209005', 'descartado');
select pg_temp.lead('suprimido', '{PHONE_VIEW}', null, pg_temp.id('terreno'), 'Sofia', '+5584988209006');
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex(app.normalize_phone_br('+5584988209006')), 'phone', 'pgTAP 209');

-- O modelo existe, ligado, ainda sem aprovação.
select is((select is_active from public.message_templates where template_code = 'IMV-LEAD-PORTAL'), true,
          'o modelo IMV-LEAD-PORTAL está ligado');
select is((select body from public.message_templates where template_code = 'IMV-LEAD-PORTAL'),
          'Olá, {{nome}}! Aqui é da Imova. Vimos seu interesse {{imovel_visto}}. Posso te passar mais informações?',
          'o texto do modelo é o que o dono aprovou');
update public.message_templates set meta_status = null where template_code = 'IMV-LEAD-PORTAL';

-- ---------------------------------------------------------------------
-- 1. Quem pode
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.lia(), 'leitura');
select is(public.portal_lead_chamar_previa(pg_temp.id('chat')) ->> 'motivo', 'sem_permissao',
          'leitura não vê a prévia');
select is(public.portal_lead_chamar(pg_temp.id('chat'), 'Cesar', 'na sala') ->> 'motivo', 'sem_permissao',
          'leitura não chama');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 2. A prévia
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.sara(), 'sdr');
create temp table r209 as select public.portal_lead_chamar_previa(pg_temp.id('chat')) as r;
select is((select r ->> 'nome' from r209), 'Cesar', 'o primeiro nome sugerido sai de "CESAR FORTUNA"');
select is((select r ->> 'imovel_visto' from r209),
          'na sala comercial de 19 m² para alugar em Ponta Negra, no OLX',
          'a sala de aluguel, com a área, o bairro e a OLX (o chat só existe na OLX)');
select is((select r ->> 'texto' from r209),
          'Olá, Cesar! Aqui é da Imova. Vimos seu interesse na sala comercial de 19 m² para alugar em Ponta Negra, no OLX. Posso te passar mais informações?',
          'o texto sai como o cliente vai ler');
select is((select (r ->> 'pode')::boolean from r209), false, 'sem a aprovação da Meta, não pode');
select is((select r ->> 'motivo' from r209), 'modelo_nao_enviado', 'e diz por quê');
select is((select r ->> 'categoria' from r209), 'utility', 'a categoria vai junto (o custo)');
select is(public.portal_lead_chamar_previa(pg_temp.id('zap')) ->> 'imovel_visto',
          'no terreno de 3.000 m² em Capim Macio, no ZAP Imóveis',
          'o terreno com a área em milhar e o portal do aviso');
select is(public.portal_lead_chamar_previa(pg_temp.id('zap')) ->> 'nome', 'Maria',
          'o primeiro nome com a primeira maiúscula');
select is(public.portal_lead_chamar_previa(pg_temp.id('semanuncio')) ->> 'imovel_visto', 'no nosso anúncio',
          'sem anúncio e sem portal certo: "no nosso anúncio"');
select is(public.portal_lead_chamar(pg_temp.id('chat'), 'Cesar', 'na sala comercial de 19 m²') ->> 'motivo',
          'modelo_nao_enviado', 'chamar sem a aprovação da Meta é recusado');
select pg_temp.sair();

update public.message_templates set meta_status = 'approved' where template_code = 'IMV-LEAD-PORTAL';

-- ---------------------------------------------------------------------
-- 3. O que vai ao cliente
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.ana(), 'admin');
select is(public.portal_lead_chamar(pg_temp.id('chat'), 'Cesar 84', 'na sala comercial') ->> 'motivo',
          'nome_invalido', 'nome com número é recusado');
select is(public.portal_lead_chamar(pg_temp.id('chat'), 'Cesar', 'na sala, ligue 84 98820-9001') ->> 'motivo',
          'imovel_invalido', 'trecho com número de telefone é recusado');
select is((select count(*)::int from public.messages m join public.conversations c on c.id = m.conversation_id
            where c.peer_phone_e164 = '+5584988209001'), 0, 'nada saiu nas recusas');

-- ---------------------------------------------------------------------
-- 4. Chamar
-- ---------------------------------------------------------------------
select pg_temp.sair();
create temp table j209 as
select public.portal_lead_chamar_previa(pg_temp.id('chat')) as p, null::jsonb as r;
grant all on j209 to authenticated;
select pg_temp.entrar(pg_temp.ana(), 'admin');
update j209 set r = public.portal_lead_chamar(pg_temp.id('chat'), 'Cesar', 'na sala comercial de 19 m²');
select is((select jsonb_build_array(r ->> 'motivo',
                                    (r ->> 'quando')::timestamptz = '2030-01-07 08:00:00-03'::timestamptz)
             from j209),
          '["janela_antes_da_abertura", true]'::jsonb,
          'fora do horário: recusa e diz quando abre (e nada fica na fila)');
select pg_temp.sair();
create or replace function app.janela_do_canal(p_channel app.channel, p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null, 'fecha_em', null)
$$;
select pg_temp.entrar(pg_temp.ana(), 'admin');
create temp table c209 as
select public.portal_lead_chamar(pg_temp.id('chat'), '  Cesar ',
         'na sala comercial de 19 m² no Brisa Mall, no OLX') as r;
select is((select (r ->> 'ok')::boolean from c209), true, 'chamar dá certo');
select pg_temp.sair();

select is((select m.body from public.messages m where m.id = (select (r ->> 'message_id')::uuid from c209)),
          'Olá, Cesar! Aqui é da Imova. Vimos seu interesse na sala comercial de 19 m² no Brisa Mall, no OLX. Posso te passar mais informações?',
          'a mensagem leva o nome limpo e o trecho conferido');
select is((select jsonb_build_array(m.type::text, m.status::text, m.author_kind::text, m.direction::text)
             from public.messages m where m.id = (select (r ->> 'message_id')::uuid from c209)),
          '["template", "queued", "bot_fixed", "out"]'::jsonb,
          'o modelo vai para a fila como mensagem automática');
select is((select m.template_params from public.messages m where m.id = (select (r ->> 'message_id')::uuid from c209)),
          '{"nome": "Cesar", "imovel_visto": "na sala comercial de 19 m² no Brisa Mall, no OLX"}'::jsonb,
          'as duas variáveis do modelo, com o nome de cada uma');
select is((select c.peer_phone_e164 from public.conversations c where c.id = (select (r ->> 'conversation_id')::uuid from c209)),
          '+5584988209001', 'a conversa é com o telefone do lead');
select is((select jsonb_build_array(l.conversation_id = (select (r ->> 'conversation_id')::uuid from c209),
                                    l.situacao, l.responsavel_id = pg_temp.ana(), l.organization_id is not null)
             from public.portal_leads l where l.id = pg_temp.id('chat')),
          '[true, "em_atendimento", true, true]'::jsonb,
          'o lead fica ligado à conversa, em atendimento, com quem clicou e com ficha');
select is(app.ia_atende((select (r ->> 'conversation_id')::uuid from c209)), true,
          'quando o cliente responder, a IA atende (o modelo não é mensagem de pessoa)');

-- ---------------------------------------------------------------------
-- 5. O que não se chama
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.ana(), 'admin');
select is(public.portal_lead_chamar(pg_temp.id('chat'), 'Cesar', 'na sala comercial') ->> 'motivo',
          'ja_tem_conversa', 'o segundo clique encontra a conversa e não manda de novo');
select is(public.portal_lead_chamar_previa(pg_temp.id('chat')) ->> 'motivo', 'ja_tem_conversa',
          'a prévia também');
select is(public.portal_lead_chamar(pg_temp.id('semtel'), 'Rui', 'no terreno de Capim Macio') ->> 'motivo',
          'sem_telefone', 'sem telefone não chama');
select is(public.portal_lead_chamar(pg_temp.id('descartado'), 'Davi', 'no terreno de Capim Macio') ->> 'motivo',
          'descartado', 'lead descartado não é chamado');
select is(public.portal_lead_chamar(pg_temp.id('suprimido'), 'Sofia', 'no terreno de Capim Macio') ->> 'motivo',
          'suprimido', 'quem pediu para não ser contatado não é chamado');
select is(public.portal_lead_chamar(pg_temp.id('zap'), 'Maria', 'no terreno de 3.000 m² em Capim Macio') ->> 'ok',
          'true', 'quem só viu o telefone ganha ficha e é chamado');
select pg_temp.sair();

select * from finish();
rollback;

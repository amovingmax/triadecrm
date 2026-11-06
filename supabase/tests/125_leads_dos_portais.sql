-- =====================================================================
-- pgTAP — Os leads dos portais chegam ao CRM, só na Imova (migração 20261105100000)
--
-- O Grupo OLX entrega cada contato feito num anúncio (ZAP, Viva Real, OLX)
-- por webhook; a Edge Function `grupozap-lead` chama
-- `public.grupozap_lead_receber` com a chave de serviço. Este arquivo prova:
--
--   1. SÓ O WEBHOOK RECEBE: anon e authenticated não executam a função; a
--      service_role executa;
--   2. UMA VEZ SÓ: o mesmo originLeadId volta como duplicado, numa linha só,
--      e o tipo de contato novo é somado;
--   3. O ANÚNCIO pelo código: o do CRM, o do relatório do Canal Pro, o que não
--      existe e o lead sem código (MCMV);
--   4. A FICHA (de quem escreveu pelo portal; desde a 20261105130000 quem só
--      clicou no WhatsApp espera a mensagem, ver o 127): a que já tem o
--      telefone (sem o 9, com o 9, ou só na pessoa) e a que tem o e-mail são
--      ligadas sem trocar a origem; a nova é Cliente, com a origem Portais e a
--      categoria pelo tipo de negócio; telefone suprimido não ganha ficha;
--   5. SEM DADO PESSOAL FORA DA FICHA: o payload não guarda nome, e-mail,
--      telefone nem a simulação do MCMV, e a mensagem não guarda CPF;
--   6. QUEM LÊ: o SDR vê o telefone mascarado, a gestão inteiro; ninguém
--      escreve direto na tabela;
--   7. A EQUIPE TRABALHA: assumir, mudar a situação, descartar só com motivo,
--      tudo na auditoria; a lista de Anúncios conta os leads;
--   8. O WHATSAPP NÃO MUDA: nenhuma mensagem de saída, nada nas filas, e
--      nenhum gatilho em messages ou conversations sabe dos leads.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(66);

insert into public.allowed_users (email, role, note) values
  ('a125.g@teste.local', 'gestor', 'pgTAP leads dos portais'),
  ('a125.s@teste.local', 'sdr', 'pgTAP leads dos portais'),
  ('a125.e@teste.local', 'embaixador', 'pgTAP leads dos portais');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000012501'::uuid, 'a125.g@teste.local', '{"full_name":"Gina Gestora"}'),
  ('a0000000-0000-4000-8000-000000012502'::uuid, 'a125.s@teste.local', '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000012503'::uuid, 'a125.e@teste.local', '{"full_name":"Eva Embaixadora"}');

-- As categorias da Imova (o banco do CI tem o seed da KOMUNE).
insert into public.categories (slug, name, "group", priority, position, komune_category_key, is_active)
values ('comprador', 'Comprador', 'producao', 1, 900, null, true),
       ('locatario', 'Locatário', 'producao', 1, 901, null, true)
on conflict (slug) do update set is_active = true;

-- Nada automático responde a uma conversa de teste.
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';

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
create function pg_temp.gestor() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012501'::uuid, 'gestor')
$$;
create function pg_temp.sdr() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012502'::uuid, 'sdr')
$$;
create function pg_temp.embaixador() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012503'::uuid, 'embaixador')
$$;

-- Os ids do teste e as respostas do webhook.
create temp table t125(chave text primary key, valor uuid);
grant select on t125 to authenticated;
create temp table t125_r(chave text primary key, r jsonb);
grant select on t125_r to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t125 where chave = p_chave
$$;
create function pg_temp.r(p_chave text) returns jsonb language sql stable as $$
  select r from t125_r where chave = p_chave
$$;
create function pg_temp.lead_id(p_chave text) returns uuid language sql stable as $$
  select (r ->> 'lead_id')::uuid from t125_r where chave = p_chave
$$;
grant execute on function pg_temp.id(text), pg_temp.r(text), pg_temp.lead_id(text) to authenticated;
create function pg_temp.lead(p_chave text) returns public.portal_leads language sql stable as $$
  select * from public.portal_leads where id = pg_temp.lead_id(p_chave)
$$;
create function pg_temp.ficha(p_chave text) returns public.organizations language sql stable as $$
  select o.* from public.organizations o where o.id = (pg_temp.lead(p_chave)).organization_id
$$;

-- O lead como o Grupo OLX manda, com o que cada caso troca por cima. O tipo de
-- contato padrão é o formulário: é ele que ganha ficha na hora (20261105130000).
create function pg_temp.json(p_chave text, p_extra jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object(
           'leadOrigin', 'Grupo OLX', 'timestamp', '2026-11-05T10:00:00.000Z',
           'originLeadId', p_chave, 'originListingId', '2790000001',
           'temperature', 'Alta', 'transactionType', 'SELL',
           'extraData', jsonb_build_object('leadType', 'CONTACT_FORM', 'leadCerto', true))
         || p_extra
$$;
-- O webhook: a função é chamada como a Edge Function a chama, com a service_role.
create function pg_temp.receber(p_chave text, p_extra jsonb) returns jsonb language plpgsql as $$
declare
  v      jsonb;
  v_lead jsonb := pg_temp.json(p_chave, p_extra);
begin
  execute 'set local role service_role';
  v := public.grupozap_lead_receber(p_chave, v_lead);
  execute 'reset role';
  insert into t125_r values (p_chave, v) on conflict (chave) do update set r = excluded.r;
  return v;
end $$;

-- ---- A base de antes: o anúncio do CRM, o do relatório e três fichas ----
with x as (
  insert into public.anuncios (codigo, titulo) values ('T125-CRM', 'Casa em Ponta Negra') returning id)
insert into t125 select 'anuncio', id from x;
with x as (
  insert into public.anuncios_no_canal_pro (codigo, titulo)
  values ('T125-MANUAL', 'Apartamento do sistema atual') returning id)
insert into t125 select 'manual', id from x;
-- A: a ficha com o telefone (com o 9).
with x as (
  insert into public.organizations (kind, name, phone_e164, source_id, collector)
  values ('produtor', 'Ana Antiga', '+5584981250001',
          (select id from public.sources where slug = 'whatsapp_entrada'), 'pgTAP 125')
  returning id)
insert into t125 select 'A', id from x;
-- B: a ficha sem telefone, com uma pessoa que tem o número.
with x as (
  insert into public.organizations (kind, name, source_id, collector)
  values ('produtor', 'Bia da Pessoa', (select id from public.sources where slug = 'whatsapp_entrada'), 'pgTAP 125')
  returning id)
insert into t125 select 'B', id from x;
with x as (
  insert into public.contacts (full_name, phone_e164) values ('Bia', '+5584981250002') returning id)
insert into t125 select 'B_pessoa', id from x;
insert into public.organization_contacts (organization_id, contact_id, is_primary)
values (pg_temp.id('B'), pg_temp.id('B_pessoa'), true);
-- C: a ficha só com o e-mail.
with x as (
  insert into public.organizations (kind, name, email, source_id, collector)
  values ('produtor', 'Caio do E-mail', 'cliente.c@teste.local',
          (select id from public.sources where slug = 'whatsapp_entrada'), 'pgTAP 125')
  returning id)
insert into t125 select 'C', id from x;
-- O número que pediu para sair.
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex('+5584981250004'), 'phone', 'pgTAP 125');
-- Uma conversa da ficha A (só para a lista apontar o botão "Abrir conversa").
with x as (
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id, status)
  values ('whatsapp'::app.channel, '+5584999912500', '+5584981250001', pg_temp.id('A'), 'aguardando_nos')
  returning id)
insert into t125 select 'conversa_A', id from x;

-- A linha de base do WhatsApp, antes de qualquer lead.
create temp table t125_base as
  select (select count(*) from public.messages where direction = 'out'::app.msg_direction) as saidas,
         (select count(*) from pgmq.q_wa_outbound) as fila,
         (select count(*) from public.wa_acoes) as acoes,
         (select count(*) from public.envios_em_massa_itens) as envios;

-- =====================================================================
-- 1. Só o webhook recebe
-- =====================================================================
select ok((select relrowsecurity from pg_class where oid = 'public.portal_leads'::regclass),
  'portal_leads nasce com RLS');
select is((select name from public.sources where slug = 'canal_pro'), 'Portais (ZAP, Viva Real, OLX)',
  'a origem nova está no catálogo');
select ok(not has_function_privilege('anon', 'public.grupozap_lead_receber(text, jsonb)', 'execute'),
  'o anônimo não executa o receber');
select ok(not has_function_privilege('authenticated', 'public.grupozap_lead_receber(text, jsonb)', 'execute'),
  'nem quem entrou no CRM');
select ok(has_function_privilege('service_role', 'public.grupozap_lead_receber(text, jsonb)', 'execute'),
  'só a service_role (a Edge Function)');
set local role anon;
select throws_ok($$select public.grupozap_lead_receber('x', '{}'::jsonb)$$, '42501', null,
  'chamado pelo anônimo, é recusado');
reset role;
select pg_temp.gestor();
select throws_ok($$select public.grupozap_lead_receber('x', '{}'::jsonb)$$, '42501', null,
  'e pela gestão também');
select pg_temp.sair();
-- O `safeupdate` da API recusa UPDATE e DELETE sem WHERE (ver o 123).
select is(
  (select count(*)::int
     from pg_proc p
    cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
    where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
      and (p.proname like 'grupozap_lead%' or p.proname like 'portal_lead%')
      and comando ~* '(^|\n)\s*(update|delete)\s'
      and comando !~* '\swhere\s'),
  0, 'nenhuma função dos leads tem UPDATE ou DELETE sem WHERE (o safeupdate da API recusaria)');

-- =====================================================================
-- 2. Uma vez só
-- =====================================================================
select pg_temp.receber('t125-dup', '{"clientListingId": "T125-CRM", "ddd": "84", "phone": "981250009",
                                     "name": "Duda Dupla"}'::jsonb);
select is(pg_temp.r('t125-dup') ->> 'duplicado', 'false', 'o lead novo entra');
select is((pg_temp.receber('t125-dup', '{"extraData": {"leadType": "VISIT_REQUEST"}}'::jsonb)) ->> 'duplicado',
  'true', 'o mesmo originLeadId volta como duplicado');
select is((select count(*)::int from public.portal_leads where origin_lead_id = 't125-dup'), 1,
  'numa linha só');
select is((pg_temp.lead('t125-dup')).tipos, array['CONTACT_FORM', 'VISIT_REQUEST'],
  'e o tipo de contato novo é somado');
select pg_temp.receber('t125-dup', '{"extraData": {"leadType": "VISIT_REQUEST"}}'::jsonb);
select is((pg_temp.lead('t125-dup')).tipos, array['CONTACT_FORM', 'VISIT_REQUEST'],
  'o tipo repetido não se repete');
select is((select count(*)::int from public.activities
            where organization_id = (pg_temp.lead('t125-dup')).organization_id
              and metadata ->> 'origin' = 'portal_lead'), 2,
  'a ficha conta o lead e o pedido de visita que veio depois, uma vez cada');

-- =====================================================================
-- 3. O anúncio pelo código
-- =====================================================================
select is(pg_temp.r('t125-dup') ->> 'lead_id', (select id::text from public.portal_leads where origin_lead_id = 't125-dup'),
  'o duplicado devolve o mesmo lead');
select is((pg_temp.lead('t125-dup')).anuncio_id, pg_temp.id('anuncio'),
  'o código do CRM liga o lead ao anúncio do CRM');
select pg_temp.receber('t125-manual', '{"clientListingId": "T125-MANUAL", "email": "m@teste.local"}'::jsonb);
select is(pg_temp.r('t125-manual') ->> 'anuncio', 'encontrado', 'o código do relatório também é achado');
select is((pg_temp.lead('t125-manual')).anuncio_no_canal_pro_id, pg_temp.id('manual'),
  'e liga ao anúncio do relatório do Canal Pro');
select pg_temp.receber('t125-sumido', '{"clientListingId": "NAO-EXISTE-125", "email": "s@teste.local"}'::jsonb);
select is(pg_temp.r('t125-sumido') ->> 'anuncio', 'nao_encontrado', 'código que o CRM não tem: nao_encontrado');
select is((pg_temp.lead('t125-sumido')).client_listing_id, 'NAO-EXISTE-125', 'e o código fica anotado');

-- =====================================================================
-- 4. A ficha
-- =====================================================================
-- A, pelo telefone sem o 9 (o Grupo OLX manda DDD e número separados).
select pg_temp.receber('t125-a-sem9', '{"clientListingId": "T125-CRM", "ddd": "84", "phone": "81250001",
                                       "name": "Ana Nova", "transactionType": "RENT"}'::jsonb);
select is(pg_temp.r('t125-a-sem9') ->> 'ficha', 'ligada', 'telefone sem o 9: a ficha que já existe é ligada');
select is((pg_temp.lead('t125-a-sem9')).organization_id, pg_temp.id('A'), 'e é a ficha A');
select pg_temp.receber('t125-a-com9', '{"ddd": "84", "phone": "981250001"}'::jsonb);
select is((pg_temp.lead('t125-a-com9')).organization_id, pg_temp.id('A'), 'com o 9, a mesma ficha');
select is((select s.slug || ' · ' || o.collector || ' · ' || o.name
             from public.organizations o join public.sources s on s.id = o.source_id
            where o.id = pg_temp.id('A')),
  'whatsapp_entrada · pgTAP 125 · Ana Antiga', 'a ficha ligada não troca origem, coletor nem nome');
select ok(exists (select 1 from public.activities a
                   where a.organization_id = pg_temp.id('A') and a.type = 'system'
                     and a.body = 'Lead do portal: anúncio T125-CRM (preencheu o formulário)'),
  'e ganha a atividade "Lead do portal" com o código do anúncio e o tipo de contato');
select ok(not exists (select 1 from public.activities a
                       where a.metadata ->> 'origin' = 'portal_lead'
                         and a.body ~* '(Ana Nova|9812500|@teste)'),
  'sem nome, telefone nem e-mail no texto da atividade');

-- B, só pela pessoa.
select pg_temp.receber('t125-b', '{"ddd": "84", "phone": "98125-0002"}'::jsonb);
select is((pg_temp.lead('t125-b')).organization_id, pg_temp.id('B'),
  'o telefone da pessoa (contacts) liga à ficha dela');

-- C, pelo e-mail: liga e completa o telefone que faltava.
select pg_temp.receber('t125-c', '{"email": " Cliente.C@Teste.LOCAL ", "ddd": "84", "phone": "981250003"}'::jsonb);
select is((pg_temp.lead('t125-c')).organization_id, pg_temp.id('C'), 'o e-mail, sem diferença de caixa, liga à ficha C');
select is((select phone_e164 from public.organizations where id = pg_temp.id('C')), '+5584981250003',
  'e o telefone que a ficha não tinha é completado');

-- Suprimido.
select pg_temp.receber('t125-sup', '{"ddd": "84", "phone": "981250004", "name": "Saiu Daqui",
                                     "email": "cliente.c@teste.local"}'::jsonb);
select is(pg_temp.r('t125-sup') ->> 'ficha', 'suprimida', 'telefone suprimido não ganha ficha');
select ok((pg_temp.lead('t125-sup')).suprimido and (pg_temp.lead('t125-sup')).organization_id is null,
  'o lead fica marcado como suprimido e sem ligação (nem pelo e-mail)');
select ok(not exists (select 1 from public.organizations where phone_e164 = '+5584981250004'),
  'e nenhuma ficha nasce com o número');

-- Novas: aluguel vira Locatário, venda vira Comprador.
select pg_temp.receber('t125-nova-aluguel', '{"clientListingId": "T125-CRM", "ddd": "84", "phone": "981250005",
                                              "name": "  Dora   Locatária ", "transactionType": "RENT"}'::jsonb);
select is(pg_temp.r('t125-nova-aluguel') ->> 'ficha', 'criada', 'quem não está na base vira ficha');
select is((select o.kind::text || ' · ' || o.is_natural_person || ' · ' || s.slug || ' · ' || o.collector
                  || ' · ' || o.name || ' · ' || o.phone_e164
             from public.organizations o join public.sources s on s.id = o.source_id
            where o.id = (pg_temp.lead('t125-nova-aluguel')).organization_id),
  'produtor · true · canal_pro · leads do Canal Pro · Dora Locatária · +5584981250005',
  'Cliente, pessoa física, origem Portais, coletor "leads do Canal Pro"');
select is((select c.slug from public.organization_categories oc join public.categories c on c.id = oc.category_id
            where oc.organization_id = (pg_temp.lead('t125-nova-aluguel')).organization_id and oc.is_primary),
  'locatario', 'aluguel (RENT): Locatário');
select is((select p.slug || ' · ' || st.is_entry
             from public.deals d join public.pipelines p on p.id = d.pipeline_id
             join public.stages st on st.id = d.stage_id
            where d.organization_id = (pg_temp.lead('t125-nova-aluguel')).organization_id),
  'produtor · true', 'com o negócio no funil Clientes, na etapa de entrada');
select pg_temp.receber('t125-nova-venda', '{"email": "Eva.Venda@teste.local", "name": ""}'::jsonb);
select is((select c.slug || ' · ' || o.name || ' · ' || o.email
             from public.organizations o
             join public.organization_categories oc on oc.organization_id = o.id and oc.is_primary
             join public.categories c on c.id = oc.category_id
            where o.id = (pg_temp.lead('t125-nova-venda')).organization_id),
  'comprador · Interessado do portal · eva.venda@teste.local',
  'venda (SELL): Comprador; sem nome, "Interessado do portal"; e-mail em minúsculas');
select pg_temp.receber('t125-sem-contato', '{"phone": "123"}'::jsonb);
select is(pg_temp.r('t125-sem-contato') ->> 'ficha', 'sem_contato', 'sem telefone válido nem e-mail: sem ficha');

-- =====================================================================
-- 5. Sem dado pessoal fora da ficha
-- =====================================================================
select pg_temp.receber('t125-mcmv', '{"leadOrigin": "MCMV_OLX", "ddd": "84", "phone": "981250006",
  "phoneNumber": "84981250006", "name": "Mara MCMV", "email": "mara@teste.local",
  "message": "Quero simular. Meu CPF é 529.982.247-25, obrigado",
  "extraData": {"leadType": "CONTACT_FORM", "leadCerto": "false", "izi": "https://izi.exemplo/lead/1",
                "mcmv": {"cpf": "52998224725", "cnpjEmpregador": "11222333000181", "renda": 3200}},
  "campoQueAindaNaoExiste": {"a": 1}}'::jsonb);
select is(pg_temp.r('t125-mcmv') ->> 'anuncio', 'sem_codigo', 'o lead do MCMV vem sem código de anúncio');
select ok((pg_temp.lead('t125-mcmv')).mcmv and not (pg_temp.lead('t125-mcmv')).lead_certo,
  'fica marcado como MCMV, e "false" em texto é falso');
select ok(not ((pg_temp.lead('t125-mcmv')).payload ?| array['name', 'email', 'ddd', 'phone', 'phoneNumber', 'message']),
  'o payload não guarda nome, e-mail, telefone nem a mensagem');
select is((pg_temp.lead('t125-mcmv')).payload #>> '{extraData,mcmv}', 'omitido',
  'a simulação do MCMV vira só o marcador');
select ok((pg_temp.lead('t125-mcmv')).payload::text !~ '(52998224725|529\.982|11222333000181|981250006|mara)',
  'nenhum CPF, CNPJ, telefone ou e-mail sobra no JSON');
select is((pg_temp.lead('t125-mcmv')).payload #>> '{campoQueAindaNaoExiste,a}', '1',
  'o campo que o portal ainda não mandava é aceito e guardado');
select is((pg_temp.lead('t125-mcmv')).mensagem, 'Quero simular. Meu CPF é , obrigado',
  'a mensagem é guardada sem o CPF');
select is((pg_temp.lead('t125-mcmv')).link_historico, 'https://izi.exemplo/lead/1',
  'e o link do histórico no portal fica');

-- =====================================================================
-- 6. Quem lê
-- =====================================================================
select pg_temp.sdr();
select is((select phone_e164 || ' · ' || phone_is_masked from public.portal_leads_na_lista
            where id = pg_temp.lead_id('t125-nova-aluguel')),
  '+55 84 •••••-••05 · true', 'o SDR lê o lead com o telefone mascarado');
select is((select anuncio_codigo || ' · ' || anuncio_titulo from public.portal_leads_na_lista
            where id = pg_temp.lead_id('t125-manual')),
  'T125-MANUAL · Apartamento do sistema atual', 'e o anúncio do relatório, com código e título');
select throws_ok($$insert into public.portal_leads (origin_lead_id) values ('na-mao')$$, '42501', null,
  'ninguém escreve direto na tabela');
select pg_temp.sair();

select pg_temp.gestor();
select is((select phone_e164 || ' · ' || phone_is_masked || ' · ' || ficha_nome from public.portal_leads_na_lista
            where id = pg_temp.lead_id('t125-nova-aluguel')),
  '+5584981250005 · false · Dora Locatária', 'a gestão lê o telefone inteiro');
select is((select conversation_id from public.portal_leads_na_lista where id = pg_temp.lead_id('t125-a-sem9')),
  pg_temp.id('conversa_A'), 'a lista aponta a conversa da ficha');
select pg_temp.sair();

select pg_temp.embaixador();
select is((select count(*)::int from public.portal_leads_na_lista), 0, 'quem não é da gestão nem SDR não lê os leads');
select is(public.portal_lead_assumir(pg_temp.lead_id('t125-dup')) ->> 'motivo', 'sem_permissao',
  'nem assume');
select pg_temp.sair();

set local role anon;
select throws_ok($$select count(*) from public.portal_leads$$, '42501', null, 'o anônimo não lê a tabela');
reset role;

-- =====================================================================
-- 7. A equipe trabalha o lead
-- =====================================================================
select pg_temp.sdr();
select is(public.portal_lead_assumir(pg_temp.lead_id('t125-nova-aluguel')) ->> 'situacao', 'em_atendimento',
  'o SDR assume o lead novo, que vira "em atendimento"');
select is(public.portal_lead_mudar(pg_temp.lead_id('t125-nova-aluguel'), 'descartado') ->> 'motivo', 'sem_motivo',
  'descartar sem motivo é recusado');
select is(public.portal_lead_mudar(pg_temp.lead_id('t125-nova-aluguel'), 'arquivado', 'x') ->> 'motivo',
  'situacao_invalida', 'situação fora da lista é recusada');
select pg_temp.sair();
select is((select responsavel_id from public.portal_leads where id = pg_temp.lead_id('t125-nova-aluguel')),
  'a0000000-0000-4000-8000-000000012502'::uuid, 'e o SDR responde pelo lead');

select pg_temp.gestor();
select is((select leads from public.anuncios_na_lista where id = pg_temp.id('anuncio')), 3,
  'a lista de Anúncios conta os leads do anúncio');
select is(public.portal_lead_mudar(pg_temp.lead_id('t125-nova-aluguel'), 'descartado', 'Já alugou outro') ->> 'ok',
  'true', 'com motivo, a gestão descarta');
select is((select leads from public.anuncios_na_lista where id = pg_temp.id('anuncio')), 2,
  'e o descartado sai da conta');
select pg_temp.sair();
select is((select situacao || ' · ' || motivo_descarte || ' · ' || (situacao_por = 'a0000000-0000-4000-8000-000000012501'::uuid)
             from public.portal_leads where id = pg_temp.lead_id('t125-nova-aluguel')),
  'descartado · Já alugou outro · true', 'o lead guarda a situação, o motivo e quem mudou');
select is((select count(*)::int from public.audit_log
            where table_name = 'portal_leads' and row_id = pg_temp.lead_id('t125-nova-aluguel')::text),
  2, 'assumir e descartar ficam na auditoria');

-- =====================================================================
-- 8. O WhatsApp não muda
-- =====================================================================
select is((select count(*) from public.messages where direction = 'out'::app.msg_direction),
  (select saidas from t125_base), 'nenhuma mensagem de saída nasceu');
select ok((select count(*) from pgmq.q_wa_outbound) = (select fila from t125_base)
          and (select count(*) from public.wa_acoes) = (select acoes from t125_base)
          and (select count(*) from public.envios_em_massa_itens) = (select envios from t125_base),
  'e nada entrou na fila de saída, nas ações do WhatsApp nem no envio em massa');
select is(
  (select count(*)::int
     from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid in ('public.messages'::regclass, 'public.conversations'::regclass)
      and not t.tgisinternal
      and (p.proname ~* '(portal|grupozap)' or p.prosrc ~* '(portal_lead|grupozap)')),
  0, 'nenhum gatilho de messages ou conversations sabe dos leads');

select * from finish();
rollback;

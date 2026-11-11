-- =====================================================================
-- pgTAP — O lead do portal avisa a equipe (migração 20261111120000), só na Imova
--
-- Pedido de 11/11/2026: "O lead deve aparecer na aba de leads em anúncios e
-- devemos ser notificados que um novo lead chega." Este arquivo prova:
--
--   1. QUANDO ESCREVEU: o lead que escreveu pelo portal ganha `escreveu_em` na
--      chegada; quem só clicou não ganha, até um aviso seguinte trazer a mensagem;
--   2. ESCREVEU SEM TIPO: mensagem sem leadType, ou com um tipo que o CRM não
--      conhece, vira MENSAGEM_NO_PORTAL, ganha ficha e entra na lista principal;
--      mensagem em branco não conta;
--   3. O AVISO: um por pessoa que atende (gestor e SDR), com o nome, o que a
--      pessoa fez, o código do anúncio e o caminho do lead; uma vez só;
--   4. NÃO AVISA: o descartado, o suprimido e o que escreveu há mais de 2 minutos;
--   5. A RODADA de 10 segundos chama a varredura na Imova e não na KOMUNE, e o
--      catálogo de cada empresa;
--   6. O WHATSAPP NÃO É TOCADO, e a varredura não é executável de fora.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(31);

insert into public.allowed_users (email, role, note) values
  ('a144.g@teste.local', 'gestor', 'pgTAP lead do portal avisa'),
  ('a144.s@teste.local', 'sdr', 'pgTAP lead do portal avisa');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000014401'::uuid, 'a144.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000014402'::uuid, 'a144.s@teste.local', '{"full_name":"Sol SDR"}');

insert into public.categories (slug, name, "group", priority, position, komune_category_key, is_active)
values ('comprador', 'Comprador', 'producao', 1, 900, null, true),
       ('locatario', 'Locatário', 'producao', 1, 901, null, true)
on conflict (slug) do update set is_active = true;

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
-- A empresa do banco, para o mesmo arquivo provar a KOMUNE e a Imova.
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

create temp table t144_r(chave text primary key, r jsonb);
grant select on t144_r to authenticated;
create function pg_temp.lead_id(p_chave text) returns uuid language sql stable as $$
  select (r ->> 'lead_id')::uuid from t144_r where chave = p_chave
$$;
grant execute on function pg_temp.lead_id(text) to authenticated;
create function pg_temp.lead(p_chave text) returns public.portal_leads language sql stable as $$
  select * from public.portal_leads where id = pg_temp.lead_id(p_chave)
$$;
-- Um lead do Grupo OLX. `p_extra` acrescenta ou troca campos; `p_tipo` nulo = sem leadType.
create function pg_temp.receber(p_chave text, p_tipo text, p_extra jsonb) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  execute 'set local role service_role';
  v := public.grupozap_lead_receber(p_chave,
         jsonb_build_object(
           'leadOrigin', 'Grupo OLX',
           'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'),
           'originLeadId', p_chave, 'originListingId', '2790000144', 'clientListingId', 'T144-CRM',
           'temperature', 'Alta', 'transactionType', 'SELL',
           'extraData', case when p_tipo is null then '{}'::jsonb
                             else jsonb_build_object('leadType', p_tipo) end)
         || p_extra);
  execute 'reset role';
  insert into t144_r values (p_chave, v) on conflict (chave) do update set r = excluded.r;
  return v;
end $$;
create function pg_temp.avisos(p_chave text, p_pessoa uuid) returns bigint language sql stable as $$
  select count(*) from app.push_fila
   where tipo = 'lead_portal' and pessoa_id = p_pessoa
     and chave like 'lead_portal:' || pg_temp.lead_id(p_chave) || ':%'
$$;

select pg_temp.virar('imova');

insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex('+5584981440009'), 'phone', 'pgTAP 144');

create temp table t144_base as
  select (select count(*) from public.messages) as mensagens,
         (select count(*) from pgmq.q_wa_outbound) as fila;

-- ---------------------------------------------------------------------
-- 1. Quando escreveu
-- ---------------------------------------------------------------------
select has_column('public', 'portal_leads', 'escreveu_em', 'portal_leads guarda quando o lead escreveu');
select has_trigger('public', 'portal_leads', 'portal_leads_escreveu', 'o gatilho grava escreveu_em');

select is(pg_temp.receber('t144-form', 'CONTACT_FORM',
            '{"name": "Maria Formulário", "phone": "84981440001", "message": "Tem garagem?"}') ->> 'ficha',
          'criada', 'formulário: a ficha nasce');
select ok((pg_temp.lead('t144-form')).escreveu_em is not null, 'formulário: escreveu_em na chegada');

select is(pg_temp.receber('t144-clique', 'CLICK_WHATSAPP',
            '{"name": "Caio Clique", "phone": "84981440002", "message": ""}') ->> 'ficha',
          'aguarda_mensagem', 'clique sem mensagem: espera');
select ok((pg_temp.lead('t144-clique')).escreveu_em is null, 'clique sem mensagem: sem escreveu_em');

select is(pg_temp.receber('t144-clique', 'CONTACT_CHAT', '{}') ->> 'duplicado', 'true',
          'o mesmo lead escreve pelo chat depois');
select ok((pg_temp.lead('t144-clique')).escreveu_em is not null
          and (pg_temp.lead('t144-clique')).organization_id is not null,
          'clicou e depois escreveu: escreveu_em e a ficha nessa hora');

-- ---------------------------------------------------------------------
-- 2. Escreveu sem dizer o tipo
-- ---------------------------------------------------------------------
select is(pg_temp.receber('t144-sem-tipo', null,
            '{"name": "Sara Sem Tipo", "phone": "84981440003", "message": "Ainda está disponível?"}') ->> 'ficha',
          'criada', 'mensagem sem leadType: a ficha nasce');
select is((pg_temp.lead('t144-sem-tipo')).tipos, array['MENSAGEM_NO_PORTAL'],
          'mensagem sem leadType: o tipo é MENSAGEM_NO_PORTAL');
-- A lista é lida como na tela: pela gestão.
select pg_temp.entrar('a0000000-0000-4000-8000-000000014401'::uuid, 'gestor');
select is((select v.grupo from public.portal_leads_na_lista v where v.id = pg_temp.lead_id('t144-sem-tipo')),
          'mensagem', 'mensagem sem leadType: entra na lista principal da aba Leads');
select pg_temp.sair();
select ok((pg_temp.lead('t144-sem-tipo')).escreveu_em is not null, 'mensagem sem leadType: escreveu_em');
select ok(exists (select 1 from public.activities a
                   where a.metadata ->> 'portal_lead_id' = pg_temp.lead_id('t144-sem-tipo')::text
                     and a.body like '%mandou mensagem pelo portal%'),
          'mensagem sem leadType: a atividade da ficha diz "mandou mensagem pelo portal"');

select is(pg_temp.receber('t144-tipo-novo', 'CONTACT_WHATSAPP_PROPOSTA',
            '{"name": "Tito Tipo Novo", "phone": "84981440004", "message": "Faço proposta"}') ->> 'ficha',
          'criada', 'tipo que o CRM não conhece, com mensagem: a ficha nasce');
select ok((pg_temp.lead('t144-tipo-novo')).tipos @> array['CONTACT_WHATSAPP_PROPOSTA', 'MENSAGEM_NO_PORTAL'],
          'tipo desconhecido com mensagem: guarda o tipo e acrescenta MENSAGEM_NO_PORTAL');

select is(pg_temp.receber('t144-branco', null,
            '{"name": "Bia Branco", "phone": "84981440005", "message": "   "}') ->> 'ficha',
          'aguarda_mensagem', 'mensagem em branco não conta como mensagem');

-- ---------------------------------------------------------------------
-- 3 e 4. O aviso, e o que não avisa
-- ---------------------------------------------------------------------
-- Descartado antes da varredura.
select pg_temp.receber('t144-descartado', 'CONTACT_FORM',
         '{"name": "Dora Descartada", "phone": "84981440006", "message": "Oi"}');
select pg_temp.entrar('a0000000-0000-4000-8000-000000014401'::uuid, 'gestor');
select is(public.portal_lead_mudar(pg_temp.lead_id('t144-descartado'), 'descartado', 'Teste') ->> 'ok', 'true',
          'o gestor descarta um lead');
select pg_temp.sair();
-- Suprimido: o telefone pediu para sair.
select pg_temp.receber('t144-suprimido', 'CONTACT_FORM',
         '{"name": "Suzi Suprimida", "phone": "84981440009", "message": "Oi"}');
-- Escreveu há 10 minutos: passou da hora de avisar.
select pg_temp.receber('t144-velho', 'CONTACT_FORM',
         '{"name": "Vera Velha", "phone": "84981440007", "message": "Oi"}');
update public.portal_leads set escreveu_em = now() - interval '10 minutes'
 where id = pg_temp.lead_id('t144-velho');

select cmp_ok(app.avisos_push_varrer_leads(), '>=', 8, 'a varredura põe avisos na fila');

select is(pg_temp.avisos('t144-form', 'a0000000-0000-4000-8000-000000014401'::uuid), 1::bigint,
          'o gestor recebe o aviso do lead do formulário');
select is(pg_temp.avisos('t144-form', 'a0000000-0000-4000-8000-000000014402'::uuid), 1::bigint,
          'o SDR recebe o aviso do lead do formulário');
select is((select corpo from app.push_fila
            where chave = 'lead_portal:' || pg_temp.lead_id('t144-form') || ':a0000000-0000-4000-8000-000000014401'),
          'Novo lead: Maria Formulário preencheu o formulário · T144-CRM',
          'o aviso diz quem, o que fez e o anúncio');
select is((select caminho from app.push_fila
            where chave = 'lead_portal:' || pg_temp.lead_id('t144-form') || ':a0000000-0000-4000-8000-000000014401'),
          '/anuncios/leads?lead=' || pg_temp.lead_id('t144-form'),
          'o toque abre a aba Leads com o lead');
select ok(pg_temp.avisos('t144-sem-tipo', 'a0000000-0000-4000-8000-000000014402'::uuid) = 1
          and pg_temp.avisos('t144-clique', 'a0000000-0000-4000-8000-000000014402'::uuid) = 1,
          'mensagem sem tipo e clique que virou chat também avisam');
select ok(pg_temp.avisos('t144-descartado', 'a0000000-0000-4000-8000-000000014401'::uuid) = 0
          and pg_temp.avisos('t144-suprimido', 'a0000000-0000-4000-8000-000000014401'::uuid) = 0
          and pg_temp.avisos('t144-velho', 'a0000000-0000-4000-8000-000000014401'::uuid) = 0
          and pg_temp.avisos('t144-branco', 'a0000000-0000-4000-8000-000000014401'::uuid) = 0,
          'descartado, suprimido, velho e só clique não avisam');
select is(app.avisos_push_varrer_leads(), 0, 'o mesmo lead não avisa duas vezes');

-- ---------------------------------------------------------------------
-- 5. A rodada e o catálogo de cada empresa
-- ---------------------------------------------------------------------
select pg_temp.receber('t144-rodada', 'VISIT_REQUEST',
         '{"name": "Rui Rodada", "phone": "84981440008", "message": "Posso visitar sábado?"}');
select pg_temp.virar('komune');
select app.avisos_push_rodar();
select is(pg_temp.avisos('t144-rodada', 'a0000000-0000-4000-8000-000000014401'::uuid), 0::bigint,
          'na KOMUNE a rodada não olha os leads');
select ok(not exists (select 1 from app.avisos_catalogo() where tipo = 'lead_portal'),
          'o catálogo da KOMUNE não tem o aviso de lead');
select pg_temp.virar('imova');
select app.avisos_push_rodar();
select is(pg_temp.avisos('t144-rodada', 'a0000000-0000-4000-8000-000000014401'::uuid), 1::bigint,
          'na Imova a rodada de 10 segundos avisa o lead novo');
select ok(exists (select 1 from app.avisos_catalogo() where tipo = 'lead_portal'),
          'o catálogo da Imova tem "Lead novo dos portais"');

-- ---------------------------------------------------------------------
-- 6. O WhatsApp não é tocado, e a varredura não é de fora
-- ---------------------------------------------------------------------
select ok((select count(*) from public.messages) = (select mensagens from t144_base)
          and (select count(*) from pgmq.q_wa_outbound) = (select fila from t144_base),
          'nenhuma mensagem gravada e nada na fila do WhatsApp');
select ok(not has_function_privilege('authenticated', 'app.avisos_push_varrer_leads()', 'execute')
          and not has_function_privilege('anon', 'app.avisos_push_varrer_leads()', 'execute'),
          'a varredura dos leads não é executável por quem está logado nem por anônimo');

select * from finish();
rollback;

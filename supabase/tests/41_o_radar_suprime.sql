-- =====================================================================
-- pgTAP — O "não contatar" do Radar suprime de verdade
--         (migração 20260909150000_o_nao_contatar_do_radar_suprime_de_verdade.sql)
--
-- O defeito que estas asserções travam: `nao_contatar` na fila do Radar marcava
-- só a LINHA do candidato. A `suppression_list` — que é onde o guardrail "nenhum
-- envio a contato suprimido, em nenhum modo" realmente mora, porque é ela que
-- `app.is_suppressed` lê — continuava vazia. O pedido da pessoa morria com a
-- linha, e o mesmo telefone voltava pela porta do cadastro rápido ou pela coleta
-- seguinte.
--
-- As que mais importam:
--
--   1. O telefone e o @ ficam na lista de supressão depois da decisão.
--   2. `public.quick_create_organization` passa a recusar aquele número: era por
--      ali que o alvo voltava dez minutos depois, com ficha, negócio e cadência.
--   3. O candidato que a próxima coleta trouxer com o mesmo número já NASCE
--      "não contatar", pelo gatilho de higiene de entrada.
--   4. Recusar (que é "não serve para nós") continua NÃO suprimindo ninguém.
--   5. Quando já existe ficha, o pedido vira prova em `consent_events` e o
--      negócio aberto sai para a etapa de opt-out do funil.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(22);

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
create function pg_temp.fonte(p_slug text) returns int language sql as $$
  select id from public.sources where slug = p_slug
$$;
create function pg_temp.cand(p_nome text) returns public.supplier_candidates language sql as $$
  select c.* from public.supplier_candidates c
   where c.name like p_nome || '%' order by c.created_at desc limit 1
$$;

-- ---------- gente ----------
insert into public.allowed_users (email, role, note)
values ('c41.gestor@teste.local', 'gestor', 'pgTAP supressão do Radar');
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-0000000041a1', 'c41.gestor@teste.local',
        '{"full_name":"Gestor C41"}');

-- ---------- catálogo ----------
insert into public.categories (id, slug, name, "group", priority, position)
values (941, 'c41_teste', 'Categoria do teste de supressão', 'servicos', 2, 941);

-- ---------- o alvo que vai pedir para não ser procurado ----------
-- Sem ficha na base: é o caso do Radar puro, o que o defeito deixava passar.
insert into public.supplier_candidates (source_id, collector, name, phone_e164, instagram_handle, neighborhood)
values (pg_temp.fonte('captura_campo'), 'pgTAP',
        'C41 Alvo Que Pediu Para Parar', '84 98800-4101', 'alvo.do.c41', 'Tirol');


-- =====================================================================
-- 1. Antes da decisão, ninguém está suprimido
-- =====================================================================
select ok(not app.is_suppressed('84 98800-4101', null, 'alvo.do.c41'),
  'o telefone e o @ do alvo não estavam na lista de supressão antes da decisão');


-- =====================================================================
-- 2. "Não contatar" na fila: a decisão e a supressão
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000041a1', 'gestor');

create temp table d1 as
  select public.radar_revisar_candidato(
           (pg_temp.cand('C41 Alvo Que Pediu')).id, 'nao_contatar', null, null,
           'Pediu no telefone para não ser mais procurada') as j;

select pg_temp.sair();

select is((select j ->> 'ok' from d1), 'true', 'a decisão é gravada');
select is((select j ->> 'status' from d1), 'recusado', 'o candidato sai da fila como recusado');
select is((select j ->> 'nao_contatar' from d1), 'true', 'e a resposta diz que foi "não contatar"');
select ok((pg_temp.cand('C41 Alvo Que Pediu')).do_not_contact,
  'a linha do candidato continua marcada, como antes');

select ok(app.is_suppressed('84 98800-4101'),
  'o TELEFONE entra na lista de supressão: é o que todo caminho de envio consulta');
select ok(app.is_suppressed(null, null, 'alvo.do.c41'),
  'o @ do candidato também entra: o Instagram é canal de primeiro contato');
select ok(exists (select 1 from public.suppression_list s
                   where s.kind = 'phone'
                     and s.hash = app.sha256_hex('+5584988004101')
                     and s.reason like 'Radar: não contatar%'),
  'a supressão guarda de onde veio e o motivo escrito por quem decidiu');


-- =====================================================================
-- 3. A porta por onde o alvo voltava: o cadastro rápido
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000041a1', 'gestor');

create temp table rapido as
  select public.quick_create_organization('C41 Alvo Pela Porta Dos Fundos', 941,
           '84 98800-4101', pg_temp.fonte('captura_campo')) as j;

select pg_temp.sair();

select is((select j ->> 'reason' from rapido), 'telefone_suprimido',
  'o cadastro rápido recusa o número suprimido — era por aqui que o alvo voltava com ficha e cadência');


-- =====================================================================
-- 4. A porta seguinte: a próxima coleta traz o mesmo alvo
-- =====================================================================
insert into public.supplier_candidates (source_id, collector, name, phone_e164, neighborhood)
values (pg_temp.fonte('casamentos_com_br'), 'pgTAP',
        'C41 Alvo Na Coleta Seguinte', '84 98800-4101', 'Tirol');

select ok((pg_temp.cand('C41 Alvo Na Coleta')).do_not_contact,
  'o candidato colhido depois já nasce "não contatar"');
select ok('suprimido' = any ((pg_temp.cand('C41 Alvo Na Coleta')).flags),
  'e a marca diz a quem revisa por que ele não pode virar alvo');


-- =====================================================================
-- 5. Recusar é "não serve para nós", e não "não me procure"
-- =====================================================================
insert into public.supplier_candidates (source_id, collector, name, phone_e164, neighborhood)
values (pg_temp.fonte('captura_campo'), 'pgTAP',
        'C41 Alvo Fora Do Perfil', '84 98800-4102', 'Tirol');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000041a1', 'gestor');
create temp table d2 as
  select public.radar_revisar_candidato(
           (pg_temp.cand('C41 Alvo Fora Do Perfil')).id, 'recusar', null, null,
           'Não atende evento') as j;
select pg_temp.sair();

select is((select j ->> 'ok' from d2), 'true', 'a recusa simples é gravada');
select ok(not app.is_suppressed('84 98800-4102'),
  'recusar NÃO suprime: bloquear quem não pediu nada é tão errado quanto não bloquear quem pediu');


-- =====================================================================
-- 6. Sem motivo escrito não há decisão — e, portanto, não há supressão
-- =====================================================================
insert into public.supplier_candidates (source_id, collector, name, phone_e164, neighborhood)
values (pg_temp.fonte('captura_campo'), 'pgTAP',
        'C41 Alvo Sem Motivo', '84 98800-4103', 'Tirol');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000041a1', 'gestor');
create temp table d3 as
  select public.radar_revisar_candidato(
           (pg_temp.cand('C41 Alvo Sem Motivo')).id, 'nao_contatar') as j;
select pg_temp.sair();

select is((select j ->> 'reason' from d3), 'motivo_obrigatorio',
  'não contatar sem motivo escrito não passa');
select ok(not app.is_suppressed('84 98800-4103'),
  'e nada é suprimido por um clique que a própria função recusou');
select is((pg_temp.cand('C41 Alvo Sem Motivo')).status::text, 'novo',
  'o candidato continua na fila, esperando uma decisão de verdade');


-- =====================================================================
-- 7. Quando a ficha já existe, o pedido vira prova e move o negócio
-- =====================================================================
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind)
values ('c0000000-0000-4000-8000-000000004101', 'C41 Buffet Que Já Tem Ficha',
        '84 98800-4104', 'Tirol', pg_temp.fonte('planilha'), 'fornecedor');
insert into public.organization_categories (organization_id, category_id, is_primary)
values ('c0000000-0000-4000-8000-000000004101', 941, true);

-- Um negócio aberto no funil que TEM etapa de opt-out: é ele que precisa sair da
-- fila do dia de quem não pode mais escrever.
insert into public.deals (id, organization_id, pipeline_id, stage_id)
select 'd0000000-0000-4000-8000-000000004101',
       'c0000000-0000-4000-8000-000000004101', p.id, s.id
  from public.pipelines p
  join public.stages s on s.pipeline_id = p.id
 where exists (select 1 from public.stages so where so.pipeline_id = p.id and so.is_optout)
   and not s.is_optout and not s.is_terminal
 order by p.position, s.position
 limit 1;

insert into public.supplier_candidates (source_id, collector, name, phone_e164, neighborhood)
values (pg_temp.fonte('casamentos_com_br'), 'pgTAP',
        'C41 Buffet Repetido No Radar', '84 98800-4104', 'Tirol');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000041a1', 'gestor');
create temp table d4 as
  select public.radar_revisar_candidato(
           (pg_temp.cand('C41 Buffet Repetido')).id, 'nao_contatar', null, null,
           'Mandou parar pelo WhatsApp') as j;
select pg_temp.sair();

select is((select j ->> 'ok' from d4), 'true', 'a decisão sobre o candidato repetido é gravada');
select ok(exists (select 1 from public.consent_events ce
                   where ce.organization_id = 'c0000000-0000-4000-8000-000000004101'
                     and ce.kind = 'contact_optout'::app.consent_kind),
  'o pedido vira prova em consent_events, e não só um hash solto');
select ok((select o.do_not_contact from public.organizations o
            where o.id = 'c0000000-0000-4000-8000-000000004101'),
  'a ficha existente fica marcada "não contatar"');
select ok((select st.is_optout from public.deals d
             join public.stages st on st.id = d.stage_id
            where d.id = 'd0000000-0000-4000-8000-000000004101'),
  'e o negócio aberto sai para a etapa de opt-out: senão o cartão continuaria na fila do dia de alguém');
select ok((select s.source_event_id is not null from public.suppression_list s
            where s.kind = 'phone' and s.hash = app.sha256_hex('+5584988004104')),
  'a supressão aponta para o evento de consentimento que a originou');


-- =====================================================================
-- 8. A mesma decisão duas vezes não vira duas supressões nem dois eventos
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000041a1', 'gestor');
create temp table d5 as
  select public.radar_revisar_candidato(
           (pg_temp.cand('C41 Buffet Repetido')).id, 'nao_contatar', null, null,
           'Mandou parar pelo WhatsApp') as j;
select pg_temp.sair();

select is((select j ->> 'reason' from d5), 'ja_revisado',
  'o candidato já revisado é recusado antes de qualquer escrita nova');

select * from finish();
rollback;

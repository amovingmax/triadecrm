-- =====================================================================
-- pgTAP — Quem responde ao aviso de ligação é qualificado no funil
--         (migração 20261013120000)
--
-- Este arquivo prova:
--   1. A RESPOSTA AO AVISO leva o negócio para Respondeu e Quente, mesmo numa
--      conversa que já tinha mensagem recebida; uma vez só; sem IA;
--   2. Também quando a resposta é a primeira mensagem da conversa, sem registro
--      em dobro;
--   3. Recusa clara fica em Respondeu, mas não esquenta; pedido de saída não
--      qualifica;
--   4. Sem aviso, a regra de antes; nenhuma mensagem de saída nasce disto;
--   5. A sugestão da IA e o clique de qualificar não existem.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(17);

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
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010801'::uuid $$;
create function pg_temp.leo() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010802'::uuid $$;
create function pg_temp.org(p text) returns uuid language sql immutable as $$
  select ('c0000000-0000-4000-8000-0000001080' || p)::uuid
$$;
create function pg_temp.conversa(p text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.conversations where peer_phone_e164 = '+55849999108' || p
$$;
create function pg_temp.temperatura(p text) returns text language sql security definer set search_path = '' as $$
  select d.temperature::text from public.deals d
   where d.organization_id = ('c0000000-0000-4000-8000-0000001080' || p)::uuid
$$;
create function pg_temp.etapa(p text) returns text language sql security definer set search_path = '' as $$
  select s.slug from public.deals d join public.stages s on s.id = d.stage_id
   where d.organization_id = ('c0000000-0000-4000-8000-0000001080' || p)::uuid
$$;
create function pg_temp.saidas() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.messages m join public.conversations c on c.id = m.conversation_id
   where m.direction = 'out'::app.msg_direction and c.peer_phone_e164 like '+55849999108%'
$$;
create function pg_temp.entrada(p text, p_wamid text, p_texto text) returns void
language plpgsql as $$
begin
  set local role service_role;
  perform public.wa_entrada_registrar(p_wamid, '+5584999910800', '+55849999108' || p, 'text', p_texto);
  reset role;
end $$;

insert into public.allowed_users (email, role, note) values
  ('s108.g@teste.local', 'gestor', 'pgTAP 108'), ('s108.l@teste.local', 'leitura', 'pgTAP 108');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gil(), 's108.g@teste.local', '{"full_name":"Gil Gestor"}'),
  (pg_temp.leo(), 's108.l@teste.local', '{"full_name":"Leo Leitura"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999910800"')
 where key = 'whatsapp.envio';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
update public.app_settings
   set value = value || '{"lead_automatico": false, "introducao_ativa": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.message_templates set meta_status = 'approved' where template_code like 'GEN-LIG-PERDIDA-%';

--   01 responde ao aviso querendo conversa     02 conversa sem aviso
--   03 responde ao aviso recusando             04 responde ao aviso pedindo para sair
--   05 a resposta ao aviso é a primeira mensagem da conversa
insert into public.organizations (id, name, phone_e164, source_id, owner_id)
select pg_temp.org(x.n), x.nome, '+55849999108' || x.n, (select id from public.sources where slug = 'planilha'), pg_temp.gil()
  from (values ('01', 'S108 Com Aviso'), ('02', 'S108 Sem Aviso'), ('03', 'S108 Recusa'),
               ('04', 'S108 Sair'), ('05', 'S108 Primeira')) x(n, nome);
insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
select o.id, p.id, (select s.id from public.stages s where s.pipeline_id = p.id and s.slug = 'contatado'),
       pg_temp.gil()
  from public.organizations o, public.pipelines p
 where o.name like 'S108 %' and p.slug = 'fornecedor';

-- 01 a 04 já conversaram antes (abre a janela de 24 h); o negócio volta a
-- Contatado para a resposta ao aviso ter para onde andar. A 05 nunca escreveu.
select pg_temp.entrada('01', 'wamid.S108.a', 'oi, quem é?');
select pg_temp.entrada('02', 'wamid.S108.b', 'oi');
select pg_temp.entrada('03', 'wamid.S108.f', 'oi');
select pg_temp.entrada('04', 'wamid.S108.g', 'oi');
-- `now()` não anda dentro da transação: a conversa de antes ganha hora de antes.
update public.messages m set created_at = now() - interval '1 hour'
  from public.conversations c
 where c.id = m.conversation_id and c.peer_phone_e164 like '+55849999108%';
update public.deals set stage_id = (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
                                     where p.slug = 'fornecedor' and s.slug = 'contatado')
 where organization_id in (pg_temp.org('01'), pg_temp.org('02'), pg_temp.org('03'), pg_temp.org('04'));

-- O aviso da ligação não atendida, como o lote do dia o manda: para todos menos a 02.
do $$
declare v_lote uuid; v_msg uuid; v_n text; v_pos int := 0;
begin
  insert into public.envios_em_massa (nome, tipo, modelo_id, assinatura, por_hora, finalidade, criado_por, status)
  values ('Aviso S108', 'modelo', (select id from public.message_templates where template_code = 'GEN-LIG-PERDIDA-TARDE'),
          'komune', 60, 'ligacao_nao_atendida', null, 'enviando')
  returning id into v_lote;
  foreach v_n in array array['01', '03', '04', '05'] loop
    v_pos := v_pos + 1;
    v_msg := (app.wa_komune_abrir(pg_temp.org(v_n),
               (select id from public.message_templates where template_code = 'GEN-LIG-PERDIDA-TARDE')) ->> 'message_id')::uuid;
    update public.messages set status = 'sent', created_at = now() - interval '5 minutes' where id = v_msg;
    insert into public.envios_em_massa_itens (envio_id, posicao, organization_id, assinante_id, status, message_id, processado_em)
    values (v_lote, v_pos, pg_temp.org(v_n), null, 'enviada', v_msg, now());
  end loop;
end $$;
create temp table saidas_antes as select pg_temp.saidas() as n;


-- =====================================================================
-- 1. A resposta ao aviso
-- =====================================================================
select pg_temp.entrada('01', 'wamid.S108.c', 'Pode sim! Me liga depois das 14h');
select is(pg_temp.etapa('01'), 'respondeu',
  'respondeu ao aviso: o negócio vai para Respondeu, mesmo a conversa tendo mensagem antes');
select is(pg_temp.temperatura('01'), 'quente', 'e fica Quente: é o "qualificado" do funil');
select ok((select ai_intent is null from public.conversations where id = pg_temp.conversa('01')),
  'sem leitura da IA nenhuma: a resposta basta');
select is((select count(*)::int from public.activities a
            where a.organization_id = pg_temp.org('01')
              and a.metadata ->> 'origem' = 'resposta_ao_aviso_de_ligacao'), 1,
  'e a resposta fica registrada como "Respondeu", com a origem do aviso');
select pg_temp.entrada('01', 'wamid.S108.d', 'qual seria o horário?');
select is((select count(*)::int from public.activities a
            where a.organization_id = pg_temp.org('01')
              and a.metadata ->> 'origem' = 'resposta_ao_aviso_de_ligacao'), 1,
  'a segunda mensagem é conversa, não outro registro');
select is((select count(*)::int from public.tasks t where t.organization_id = pg_temp.org('01')
            and t.title = 'Marcar apresentação'), 0,
  'qualificar não inventa tarefa: só etapa e temperatura');


-- =====================================================================
-- 2. A resposta ao aviso é a primeira mensagem da conversa
-- =====================================================================
select pg_temp.entrada('05', 'wamid.S108.h', 'oi, pode ligar sim');
select is(pg_temp.etapa('05'), 'respondeu', 'primeira mensagem da conversa: Respondeu');
select is(pg_temp.temperatura('05'), 'quente', 'e Quente também');
select is((select count(*)::int from public.activities a join public.messages m on m.id = a.message_id
            where a.organization_id = pg_temp.org('05') and m.direction = 'in'::app.msg_direction), 1,
  'um registro só para a mensagem (o da primeira resposta)');


-- =====================================================================
-- 3. Recusa e pedido de saída
-- =====================================================================
select pg_temp.entrada('03', 'wamid.S108.i', 'Não tenho interesse, obrigado');
select is(pg_temp.etapa('03'), 'respondeu', 'quem recusa respondeu: Respondeu');
select isnt(pg_temp.temperatura('03'), 'quente', 'mas não fica Quente');
select pg_temp.entrada('04', 'wamid.S108.j', 'SAIR');
select isnt(pg_temp.temperatura('04'), 'quente', 'quem pede para sair não é qualificado');
select is((select count(*)::int from public.activities a
            where a.organization_id = pg_temp.org('04')
              and a.metadata ->> 'origem' = 'resposta_ao_aviso_de_ligacao'), 0,
  'nem ganha registro de resposta ao aviso');


-- =====================================================================
-- 4. Sem aviso; nada sai
-- =====================================================================
select pg_temp.entrada('02', 'wamid.S108.e', 'tenho interesse');
select is(pg_temp.etapa('02'), 'contatado', 'sem aviso, a regra de antes: não anda');
select is(pg_temp.saidas(), (select n from saidas_antes),
  'nenhuma mensagem de saída nasceu das respostas');


-- =====================================================================
-- 5. Sem IA e sem clique
-- =====================================================================
select hasnt_function('public', 'qualificacao_sugerida', 'não há sugestão da IA para qualificar');
select hasnt_function('public', 'qualificar_pela_conversa', 'nem clique de qualificar');

select * from finish();
rollback;

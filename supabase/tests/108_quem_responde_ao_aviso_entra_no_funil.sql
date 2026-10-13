-- =====================================================================
-- pgTAP — Quem responde ao aviso de ligação entra no funil, e o interesse é
--         qualificado (migração 20261013120000)
--
-- Este arquivo prova:
--   1. A RESPOSTA AO AVISO leva o negócio para Respondeu, mesmo numa conversa
--      que já tinha mensagem recebida; uma vez só; e sem gravar mensagem de saída;
--   2. A SUGESTÃO só aparece com resposta ao aviso E leitura de interesse da IA,
--      e some quando o negócio fica Quente;
--   3. O CLIQUE registra "Interessado": Respondeu, Quente, próxima ação, em nome
--      de quem clicou; o segundo clique não registra de novo;
--   4. Quem só lê não qualifica.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(19);

create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated, service_role;

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
create function pg_temp.v(p_chave text, p_campo text) returns text language sql as $$
  select valor ->> p_campo from pg_temp.r where chave = p_chave
$$;
create function pg_temp.conversa(p text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.conversations where peer_phone_e164 = '+55849999108' || p
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

--   01 respondeu ao aviso        02 conversa sem aviso
insert into public.organizations (id, name, phone_e164, source_id, owner_id)
select pg_temp.org(x.n), x.nome, '+55849999108' || x.n, (select id from public.sources where slug = 'planilha'), pg_temp.gil()
  from (values ('01', 'S108 Com Aviso'), ('02', 'S108 Sem Aviso')) x(n, nome);
insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
select o.id, p.id, (select s.id from public.stages s where s.pipeline_id = p.id and s.slug = 'contatado'),
       pg_temp.gil()
  from public.organizations o, public.pipelines p
 where o.name like 'S108 %' and p.slug = 'fornecedor';

-- As duas já conversaram antes (abre a janela de 24 h); o negócio volta a Contatado
-- para a resposta ao aviso ter para onde andar.
select pg_temp.entrada('01', 'wamid.S108.a', 'oi, quem é?');
select pg_temp.entrada('02', 'wamid.S108.b', 'oi');
-- `now()` não anda dentro da transação: a conversa de antes ganha hora de antes.
update public.messages m set created_at = now() - interval '1 hour'
  from public.conversations c
 where c.id = m.conversation_id and c.peer_phone_e164 like '+55849999108%';
update public.deals set stage_id = (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
                                     where p.slug = 'fornecedor' and s.slug = 'contatado')
 where organization_id in (pg_temp.org('01'), pg_temp.org('02'));

-- O aviso da ligação não atendida, como o lote do dia o manda.
do $$
declare v_lote uuid; v_msg uuid;
begin
  insert into public.envios_em_massa (nome, tipo, modelo_id, assinatura, por_hora, finalidade, criado_por, status)
  values ('Aviso S108', 'modelo', (select id from public.message_templates where template_code = 'GEN-LIG-PERDIDA-TARDE'),
          'komune', 60, 'ligacao_nao_atendida', null, 'enviando')
  returning id into v_lote;
  v_msg := (app.wa_komune_abrir(pg_temp.org('01'),
             (select id from public.message_templates where template_code = 'GEN-LIG-PERDIDA-TARDE')) ->> 'message_id')::uuid;
  update public.messages set status = 'sent', created_at = now() - interval '5 minutes' where id = v_msg;
  insert into public.envios_em_massa_itens (envio_id, posicao, organization_id, assinante_id, status, message_id, processado_em)
  values (v_lote, 1, pg_temp.org('01'), null, 'enviada', v_msg, now());
end $$;
create temp table saidas_antes as select pg_temp.saidas() as n;


-- =====================================================================
-- 1. A resposta ao aviso
-- =====================================================================
select pg_temp.entrada('01', 'wamid.S108.c', 'Pode sim! Me liga depois das 14h');
select is(pg_temp.etapa('01'), 'respondeu',
  'respondeu ao aviso: o negócio vai para Respondeu, mesmo a conversa tendo mensagem antes');
select is((select count(*)::int from public.activities a
            where a.organization_id = pg_temp.org('01')
              and a.metadata ->> 'origem' = 'resposta_ao_aviso_de_ligacao'), 1,
  'e a resposta fica registrada como "Respondeu", com a origem do aviso');
select pg_temp.entrada('01', 'wamid.S108.d', 'qual seria o horário?');
select is((select count(*)::int from public.activities a
            where a.organization_id = pg_temp.org('01')
              and a.metadata ->> 'origem' = 'resposta_ao_aviso_de_ligacao'), 1,
  'a segunda mensagem é conversa, não outro registro');
select pg_temp.entrada('02', 'wamid.S108.e', 'tenho interesse');
select is(pg_temp.etapa('02'), 'contatado', 'sem aviso, a regra de antes: não anda');
select is(pg_temp.saidas(), (select n from saidas_antes),
  'nenhuma mensagem de saída nasceu das respostas');


-- =====================================================================
-- 2. A sugestão
-- =====================================================================
do $$
begin
  perform pg_temp.entrar(pg_temp.gil(), 'gestor');
  insert into pg_temp.r values ('sem_ia', public.qualificacao_sugerida(pg_temp.conversa('01')));
end $$;
select pg_temp.sair();
select is(pg_temp.v('sem_ia', 'motivo'), 'ia_sem_interesse', 'sem leitura de interesse, sem sugestão');

update public.conversations set ai_intent = 'INTERESSADO', ai_confidence = 0.92
 where id in (pg_temp.conversa('01'), pg_temp.conversa('02'));
do $$
begin
  perform pg_temp.entrar(pg_temp.gil(), 'gestor');
  insert into pg_temp.r values ('com_ia', public.qualificacao_sugerida(pg_temp.conversa('01')));
  insert into pg_temp.r values ('sem_aviso', public.qualificacao_sugerida(pg_temp.conversa('02')));
  insert into pg_temp.r values ('lista', (select jsonb_agg(organization_id) from public.qualificacoes_sugeridas()));
end $$;
select pg_temp.sair();
select is(pg_temp.v('com_ia', 'sugerir') || '/' || pg_temp.v('com_ia', 'intencao'), 'true/INTERESSADO',
  'resposta ao aviso + IA leu interesse: sugere qualificar');
select is(pg_temp.v('sem_aviso', 'motivo'), 'sem_resposta_ao_aviso',
  'interesse sem aviso de ligação não entra nesta sugestão');
select ok((select valor from pg_temp.r where chave = 'lista') @> to_jsonb(array[pg_temp.org('01')])
          and not (select valor from pg_temp.r where chave = 'lista') @> to_jsonb(array[pg_temp.org('02')]),
  'o Meu dia recebe só a organização com sugestão');

update public.conversations set ai_confidence = 0.4 where id = pg_temp.conversa('01');
do $$
begin
  perform pg_temp.entrar(pg_temp.gil(), 'gestor');
  insert into pg_temp.r values ('baixa', public.qualificacao_sugerida(pg_temp.conversa('01')));
end $$;
select pg_temp.sair();
select is(pg_temp.v('baixa', 'sugerir'), 'false', 'leitura com pouca confiança não sugere');
update public.conversations set ai_confidence = 0.92 where id = pg_temp.conversa('01');


-- =====================================================================
-- 3. Quem só lê não qualifica
-- =====================================================================
do $$
begin
  perform pg_temp.entrar(pg_temp.leo(), 'leitura');
  insert into pg_temp.r values ('leitura', public.qualificar_pela_conversa(pg_temp.conversa('01'), gen_random_uuid()));
end $$;
select pg_temp.sair();
select is(pg_temp.v('leitura', 'motivo'), 'sem_permissao', 'leitura não qualifica');


-- =====================================================================
-- 4. O clique
-- =====================================================================
do $$
begin
  perform pg_temp.entrar(pg_temp.gil(), 'gestor');
  insert into pg_temp.r values ('qualificar', public.qualificar_pela_conversa(pg_temp.conversa('01'), gen_random_uuid()));
  insert into pg_temp.r values ('de_novo', public.qualificar_pela_conversa(pg_temp.conversa('01'), gen_random_uuid()));
  insert into pg_temp.r values ('depois', public.qualificacao_sugerida(pg_temp.conversa('01')));
end $$;
select pg_temp.sair();
select is(pg_temp.v('qualificar', 'ok'), 'true', 'Qualificar registra');
select is(pg_temp.etapa('01'), 'respondeu', 'o negócio fica em Respondeu');
select is((select temperature::text from public.deals where organization_id = pg_temp.org('01')), 'quente',
  'e Quente: é o "qualificado" do funil');
select ok((select a.user_id = pg_temp.gil() and o.slug = 'wa_interessado'
             from public.activities a join public.interaction_outcomes o on o.id = a.outcome_id
            where a.organization_id = pg_temp.org('01') and o.slug = 'wa_interessado'),
  'o desfecho "Interessado" é de quem clicou');
select is((select t.title from public.tasks t
            where t.organization_id = pg_temp.org('01') and t.status = 'todo'::app.task_status
            order by t.created_at desc limit 1), 'Marcar apresentação',
  'e a próxima ação é marcar a apresentação');
select is(pg_temp.v('de_novo', 'ja_estava'), 'true', 'o segundo clique encontra o trabalho feito');
select is((select count(*)::int from public.activities a join public.interaction_outcomes o on o.id = a.outcome_id
            where a.organization_id = pg_temp.org('01') and o.slug = 'wa_interessado'), 1,
  'e não registra de novo');
select is(pg_temp.v('depois', 'motivo'), 'ja_quente', 'qualificado, a sugestão some');

select * from finish();
rollback;

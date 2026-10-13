-- =====================================================================
-- pgTAP — Quem não atendeu a ligação recebe um aviso no WhatsApp
--         (migração 20261013090000_quem_nao_atendeu_recebe_um_aviso.sql)
--
-- Este arquivo prova:
--   1. Os TRÊS MODELOS existem, sem variável, e o do período é escolhido na
--      hora do envio — sem mudar o que o cumprimento já fazia;
--   2. ATÉ A META APROVAR, nada entra na fila, e o recibo diz por quê;
--   3. Tabular "não atendeu" põe o aviso no lote do dia, sem crachá, ligado à
--      tentativa; "atendeu" não põe nada;
--   4. Um por pessoa: a segunda ligação perdida não duplica; quem pediu para
--      não ser contatado não recebe; chave desligada e lote pausado seguram;
--   5. "Não avisar" cancela só para quem ligou (e a gestão), e fica auditado;
--   6. Aviso que esperou mais de 3 dias é cancelado, não sai velho;
--   7. NADA disso grava mensagem: quem grava é o lote, pela porteira de sempre.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(28);

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
create function pg_temp.sdr() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-0000000107a1'::uuid $$;
create function pg_temp.sdr2() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-0000000107a2'::uuid $$;
create function pg_temp.org(p_n int) returns uuid language sql immutable as $$
  select ('c0000000-0000-4000-8000-0000001070' || lpad(p_n::text, 2, '0'))::uuid
$$;
create function pg_temp.v(p_chave text, p_campo text) returns text language sql as $$
  select valor ->> p_campo from pg_temp.r where chave = p_chave
$$;
create function pg_temp.itens(p_org uuid) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from public.envios_em_massa_itens i
    join public.envios_em_massa e on e.id = i.envio_id
   where e.finalidade = 'ligacao_nao_atendida' and i.organization_id = p_org
$$;
create function pg_temp.saidas() returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.direction = 'out'::app.msg_direction and c.peer_phone_e164 like '+55849999107%'
$$;

-- Liga do jeito da tela (lote avulso da ficha), tabula com o resultado dado e
-- guarda a tentativa em pg_temp.r[chave].
create function pg_temp.ligar(p_chave text, p_org uuid, p_resultado app.call_result, p_quem uuid)
returns void language plpgsql as $$
declare v jsonb; v_item uuid; v_att uuid; v_lote uuid;
begin
  perform app.encerrar_lotes_avulsos();
  perform pg_temp.entrar(p_quem, 'sdr');
  v      := public.montar_lote_avulso(p_org);
  v_lote := (v ->> 'lote_id')::uuid;
  v_item := (public.proximo_da_fila(v_lote) -> 'item' ->> 'id')::uuid;
  v_att  := (public.iniciar_chamada(v_item) -> 'chamada' ->> 'id')::uuid;
  v := public.tabular_chamada(gen_random_uuid(), v_att, v_item, p_resultado,
         case when p_resultado = 'atendida_humano' then 'decisor' end,
         case when p_resultado = 'atendida_humano'
              then (select id from public.interaction_outcomes where slug = 'lig_interessado') end,
         '{}'::text[], 30, null, '{}'::jsonb, null, null, null, null, false);
  insert into pg_temp.r values (p_chave, v || jsonb_build_object('attempt_id', v_att));
  perform pg_temp.sair();
end $$;

insert into public.allowed_users (email, role, note) values
  ('c107.sdr@teste.local',  'sdr', 'pgTAP aviso de ligação'),
  ('c107.sdr2@teste.local', 'sdr', 'pgTAP aviso de ligação');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.sdr(),  'c107.sdr@teste.local',  '{"full_name":"SDR Aviso"}'),
  (pg_temp.sdr2(), 'c107.sdr2@teste.local', '{"full_name":"SDR Aviso Dois"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999910700"')
 where key = 'whatsapp.envio';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
update public.app_settings
   set value = value || '{"lead_automatico": false, "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
delete from public.app_settings where key = 'voz.telefonia';
insert into public.app_settings (key, value) values ('voz.telefonia', '{"ativa": true}'::jsonb);
delete from public.holidays where date = (now() at time zone 'America/Fortaleza')::date;
create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select 0::numeric, 24::numeric
$$;

--   01 não atende           02 atende             04 não atende (cancela)
--   05 não atende (chave/pausa)                   06 ocupado, depois pede para sair
insert into public.organizations (id, name, phone_e164, source_id, kind)
select pg_temp.org(i), 'C107 Buffet ' || i, '+55849999107' || lpad(i::text, 2, '0'),
       (select id from public.sources where slug = 'planilha'), 'fornecedor'
  from generate_series(1, 6) i;
insert into public.deals (organization_id, pipeline_id, stage_id)
select o.id, (select id from public.pipelines where slug = 'fornecedor'),
       (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
         where p.slug = 'fornecedor' and s.slug = 'prospectado')
  from public.organizations o where o.name like 'C107 Buffet %';


-- =====================================================================
-- 1. Os modelos
-- =====================================================================
select is((select count(*)::int from public.message_templates
            where template_code like 'GEN-LIG-PERDIDA-%' and is_active
              and category = 'marketing' and cardinality(app.modelo_variaveis(body)) = 0), 3,
  'três modelos ativos, sem variável (o lote da casa não tem quem preencha)');
select is((select body from public.message_templates where template_code = 'GEN-LIG-PERDIDA-TARDE'),
  'Boa tarde, tudo bem? Aqui é da Komune. Tentamos entrar em contato com você por telefone. Assim que possível, podemos retornar o contato? Se preferir não receber mensagens, é só responder SAIR.',
  'o texto pedido, com a Komune dizendo quem é');
select is((select template_code from public.message_templates
            where id = app.modelo_da_hora(
                  (select id from public.message_templates where template_code = 'GEN-LIG-PERDIDA-MANHA'),
                  '2026-10-13 19:30:00-03'::timestamptz)),
  'GEN-LIG-PERDIDA-NOITE', 'o do período é escolhido na hora do envio');
select is((select template_code from public.message_templates
            where id = app.modelo_da_hora(
                  (select id from public.message_templates where template_code = 'GEN-ABR-OLA-NOITE'),
                  '2026-10-13 09:00:00-03'::timestamptz)),
  'GEN-ABR-OLA-MANHA', 'e o cumprimento continua trocando como antes');
select is(app.modelo_da_hora((select id from public.message_templates where template_code = 'GEN-LIG-CONFIRMA'),
                             '2026-10-13 19:30:00-03'::timestamptz),
          (select id from public.message_templates where template_code = 'GEN-LIG-CONFIRMA'),
  'modelo fora das famílias do período não é trocado');


-- =====================================================================
-- 2. Antes de a Meta aprovar, nada entra
-- =====================================================================
update public.message_templates set meta_status = 'pending' where template_code like 'GEN-LIG-PERDIDA-%';
select pg_temp.ligar('pendente', pg_temp.org(1), 'nao_atendeu', pg_temp.sdr());
select is(pg_temp.v('pendente', 'tabulado'), 'true', 'a tabulação grava normalmente');
select is(pg_temp.itens(pg_temp.org(1)), 0, 'modelo esperando a Meta: nenhum aviso na fila');
do $$
begin
  perform pg_temp.entrar(pg_temp.sdr(), 'sdr');
  insert into pg_temp.r values ('sit_pendente',
    public.aviso_ligacao_situacao(pg_temp.v('pendente', 'attempt_id')::uuid));
end $$;
select pg_temp.sair();
select is(pg_temp.v('sit_pendente', 'situacao') || '/' || pg_temp.v('sit_pendente', 'motivo'),
  'sem_aviso/modelo_aguardando_meta', 'e o recibo diz por quê');

update public.message_templates set meta_status = 'approved' where template_code like 'GEN-LIG-PERDIDA-%';


-- =====================================================================
-- 3. Não atendeu → aviso na fila; atendeu → nada
-- =====================================================================
select pg_temp.ligar('perdida', pg_temp.org(1), 'nao_atendeu', pg_temp.sdr());
select is(pg_temp.itens(pg_temp.org(1)), 1, 'não atendeu: o aviso entra na fila');
select ok((select i.assinante_id is null and i.status = 'pendente'
                  and i.call_attempt_id = pg_temp.v('perdida', 'attempt_id')::uuid
             from public.envios_em_massa_itens i where i.organization_id = pg_temp.org(1)),
  'sem crachá, pendente, ligado à tentativa');
select ok((select e.assinatura = 'komune' and not e.continuo and e.criado_por is null
                  and e.tipo = 'modelo'
             from public.envios_em_massa e where e.finalidade = 'ligacao_nao_atendida'),
  'no lote da casa do dia, que não é o contínuo do cumprimento');
do $$
begin
  perform pg_temp.entrar(pg_temp.sdr(), 'sdr');
  insert into pg_temp.r values ('sit_fila',
    public.aviso_ligacao_situacao(pg_temp.v('perdida', 'attempt_id')::uuid));
end $$;
select pg_temp.sair();
select is(pg_temp.v('sit_fila', 'situacao'), 'pendente', 'o recibo vê o aviso na fila');

select pg_temp.ligar('atendeu', pg_temp.org(2), 'atendida_humano', pg_temp.sdr());
select is(pg_temp.itens(pg_temp.org(2)), 0, 'atendeu: nenhum aviso');

select pg_temp.ligar('ocupado', pg_temp.org(6), 'ocupado', pg_temp.sdr());
select is(pg_temp.itens(pg_temp.org(6)), 1, 'ocupado também avisa');


-- =====================================================================
-- 4. Um por pessoa, e só para quem pode receber
-- =====================================================================
select pg_temp.ligar('de_novo', pg_temp.org(1), 'caixa_postal', pg_temp.sdr());
select is(pg_temp.itens(pg_temp.org(1)), 1, 'a segunda ligação perdida não duplica o aviso');
select is(app.aviso_ligacao_motivo(pg_temp.v('de_novo', 'attempt_id')::uuid), 'ja_na_fila',
  'e o motivo é que já está na fila');

update public.organizations set do_not_contact = true where id = pg_temp.org(6);
select is(app.aviso_ligacao_motivo(pg_temp.v('ocupado', 'attempt_id')::uuid), 'nao_contatar',
  'quem pediu para não ser contatado não recebe aviso');
select is(app.aviso_ligacao_enfileirar(
            (select a.id from public.call_attempts a where a.id = pg_temp.v('atendeu', 'attempt_id')::uuid))
          ->> 'motivo', 'resultado_sem_aviso', 'quem atendeu não é avisado nem se pedirem');

update public.app_settings set value = value || '{"ativo": false}' where key = 'voz.aviso_nao_atendeu';
select pg_temp.ligar('desligado', pg_temp.org(5), 'nao_atendeu', pg_temp.sdr());
select is(pg_temp.itens(pg_temp.org(5)), 0, 'chave desligada: nada entra');
update public.app_settings set value = value || '{"ativo": true}' where key = 'voz.aviso_nao_atendeu';

update public.envios_em_massa set status = 'pausado' where finalidade = 'ligacao_nao_atendida';
select is(app.aviso_ligacao_enfileirar(pg_temp.v('desligado', 'attempt_id')::uuid) ->> 'motivo',
  'aviso_pausado', 'lote pausado pela gestão: não nasce outro por cima');
update public.envios_em_massa set status = 'enviando' where finalidade = 'ligacao_nao_atendida';
select is(app.aviso_ligacao_enfileirar(pg_temp.v('desligado', 'attempt_id')::uuid) ->> 'ok', 'true',
  'retomado, o aviso entra');


-- =====================================================================
-- 5. "Não avisar"
-- =====================================================================
select pg_temp.ligar('cancelar', pg_temp.org(4), 'nao_atendeu', pg_temp.sdr());
do $$
begin
  perform pg_temp.entrar(pg_temp.sdr2(), 'sdr');
  insert into pg_temp.r values ('cancela_outro',
    public.aviso_ligacao_cancelar(pg_temp.v('cancelar', 'attempt_id')::uuid));
  perform pg_temp.entrar(pg_temp.sdr(), 'sdr');
  insert into pg_temp.r values ('cancela_dono',
    public.aviso_ligacao_cancelar(pg_temp.v('cancelar', 'attempt_id')::uuid));
end $$;
select pg_temp.sair();
select is(pg_temp.v('cancela_outro', 'motivo'), 'sem_permissao', 'outra pessoa não cancela');
select is(pg_temp.v('cancela_dono', 'ok'), 'true', 'quem ligou cancela');
select is((select status from public.envios_em_massa_itens where organization_id = pg_temp.org(4)),
  'cancelada', 'e o aviso sai da fila');
select ok(exists (select 1 from public.audit_log where action = 'CANCELAR_AVISO_LIGACAO'
                    and row_id = pg_temp.v('cancelar', 'attempt_id')),
  'com registro na auditoria');


-- =====================================================================
-- 6. Aviso velho não sai
-- =====================================================================
update public.envios_em_massa set criado_em = now() - interval '4 days'
 where finalidade = 'ligacao_nao_atendida';
select ok(app.aviso_ligacao_vencer() >= 1, 'o que esperou mais de 3 dias é vencido');
select is((select status || '/' || motivo from public.envios_em_massa_itens
            where organization_id = pg_temp.org(1)), 'cancelada/aviso_vencido',
  'cancelado, com o motivo');


-- =====================================================================
-- 7. Nada aqui grava mensagem
-- =====================================================================
select is(pg_temp.saidas(), 0,
  'nenhuma mensagem de saída foi gravada: quem envia é o lote, pela porteira de sempre');

select * from finish();
rollback;

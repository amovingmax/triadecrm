-- =====================================================================
-- pgTAP — As chaves da voz em Ajustes, tirar do lote, excluir o lote e
-- corrigir o resultado da ligação (migrações 20261013130000, …140000, …150000)
--
-- Este arquivo prova:
--
--   A. AS CHAVES são da gestão (admin e gestor: são de Ajustes), e TODO MUNDO
--      LIGA: admin, gestor e SDR abrem e tabulam uma ligação, com a telefonia
--      ligada ou desligada;
--   B. O LOTE: só a gestão (e, desde 21/10/2026, o SDR) tira um contato da
--      fila e exclui o lote; excluir devolve a fila à base e NÃO perde a
--      ligação já feita no relatório;
--   C. A CORREÇÃO: quem ligou corrige no dia, a gestão (e, desde 21/10/2026,
--      o SDR) corrige sempre; a
--      etapa volta, a tarefa do resultado errado é cancelada, o registro
--      antigo vira nota, a ligação continua de quem ligou e o relatório do
--      dia muda de coluna. Reunião e pedido de saída não passam por aqui.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(53);

create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert, update on pg_temp.r to authenticated, service_role;

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
create function pg_temp.adm() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-0000000109a0'::uuid $$;
create function pg_temp.ges() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-0000000109a1'::uuid $$;
create function pg_temp.sdr() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-0000000109a2'::uuid $$;
create function pg_temp.sdr2() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-0000000109a3'::uuid $$;
create function pg_temp.emb() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-0000000109a4'::uuid $$;
create function pg_temp.org(p_n int) returns uuid language sql immutable as $$
  select ('c0000000-0000-4000-8000-0000001090' || lpad(p_n::text, 2, '0'))::uuid
$$;
create function pg_temp.hoje() returns date language sql stable as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;
create function pg_temp.v(p_chave text, p_campo text) returns text language sql as $$
  select valor ->> p_campo from pg_temp.r where chave = p_chave
$$;
create function pg_temp.desfecho(p_slug text) returns int language sql stable as $$
  select id from public.interaction_outcomes where slug = p_slug
$$;
create function pg_temp.etapa(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.slug from public.deals d join public.stages s on s.id = d.stage_id
   where d.organization_id = p_org
$$;
create function pg_temp.negocio(p_org uuid, p_campo text) returns text
language sql stable security definer set search_path = '' as $$
  select to_jsonb(d) ->> p_campo from public.deals d where d.organization_id = p_org
$$;
create function pg_temp.tentativa(p_chave text, p_campo text) returns text
language sql stable security definer set search_path = '' as $$
  select to_jsonb(a) ->> p_campo from public.call_attempts a
   where a.id = (select (valor ->> 'attempt_id')::uuid from pg_temp.r where chave = p_chave)
$$;
create function pg_temp.dia(p_pessoa uuid, p_campo text) returns int
language sql stable as $$
  select (p ->> p_campo)::int
    from jsonb_array_elements(public.ligacoes_do_dia(pg_temp.hoje(), p_pessoa) -> 'pessoas') p
   where (p ->> 'pessoa_id')::uuid = p_pessoa
$$;

-- Liga do jeito da tela (lote avulso da ficha), tabula com o resultado dado e
-- guarda a tentativa em pg_temp.r[chave].
create function pg_temp.ligar(p_chave text, p_org uuid, p_resultado app.call_result,
                              p_quem uuid, p_papel text)
returns void language plpgsql as $$
declare v jsonb; v_item uuid; v_att uuid; v_lote uuid;
begin
  perform app.encerrar_lotes_avulsos();
  perform pg_temp.entrar(p_quem, p_papel);
  v      := public.montar_lote_avulso(p_org);
  v_lote := (v ->> 'lote_id')::uuid;
  v_item := (public.proximo_da_fila(v_lote) -> 'item' ->> 'id')::uuid;
  v_att  := (public.iniciar_chamada(v_item) -> 'chamada' ->> 'id')::uuid;
  v := public.tabular_chamada(gen_random_uuid(), v_att, v_item, p_resultado,
         case when p_resultado = 'atendida_humano' then 'decisor' end,
         case when p_resultado = 'atendida_humano' then pg_temp.desfecho('lig_interessado') end,
         '{}'::text[], 30, 'anotação original', '{}'::jsonb, null, null, null, null, false);
  insert into pg_temp.r values (p_chave, v || jsonb_build_object('attempt_id', v_att));
  perform pg_temp.sair();
end $$;

-- Corrige como a pessoa dada e guarda a resposta em pg_temp.r[chave].
create function pg_temp.corrigir(p_chave text, p_de text, p_quem uuid, p_papel text,
                                 p_resultado app.call_result, p_slug text, p_motivo text,
                                 p_perda int default null, p_key uuid default gen_random_uuid())
returns text language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.entrar(p_quem, p_papel);
  v := public.ligacao_corrigir(p_key, (pg_temp.v(p_de, 'attempt_id'))::uuid, p_resultado,
                               pg_temp.desfecho(p_slug), p_motivo, null, p_perda);
  insert into pg_temp.r values (p_chave, v)
    on conflict (chave) do update set valor = excluded.valor;
  perform pg_temp.sair();
  return coalesce(v ->> 'motivo', v ->> 'ok');
end $$;

insert into public.allowed_users (email, role, note) values
  ('c109.adm@teste.local',  'admin',  'pgTAP 109'),
  ('c109.ges@teste.local',  'gestor', 'pgTAP 109'),
  ('c109.sdr@teste.local',  'sdr',    'pgTAP 109'),
  ('c109.sdr2@teste.local', 'sdr',    'pgTAP 109'),
  ('c109.emb@teste.local',  'embaixador', 'pgTAP 109');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.adm(),  'c109.adm@teste.local',  '{"full_name":"Ada Admin"}'),
  (pg_temp.ges(),  'c109.ges@teste.local',  '{"full_name":"Gil Gestor"}'),
  (pg_temp.sdr(),  'c109.sdr@teste.local',  '{"full_name":"Ana Freela"}'),
  (pg_temp.sdr2(), 'c109.sdr2@teste.local', '{"full_name":"Bia Freela"}'),
  (pg_temp.emb(),  'c109.emb@teste.local',  '{"full_name":"Edu Embaixador"}');

update public.app_settings
   set value = value || '{"lead_automatico": false, "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
-- O aviso no WhatsApp fica fora deste arquivo (é do 107): desligado, nada entra na fila.
update public.app_settings set value = value || '{"ativo": false}'::jsonb
 where key = 'voz.aviso_nao_atendeu';
delete from public.app_settings where key = 'voz.telefonia';
insert into public.app_settings (key, value) values ('voz.telefonia', '{"ativa": false}'::jsonb);
delete from public.holidays where date = pg_temp.hoje();
create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select 0::numeric, 24::numeric
$$;

insert into public.organizations (id, name, phone_e164, source_id, kind)
select pg_temp.org(i), 'C109 Buffet ' || i, '+55849999109' || lpad(i::text, 2, '0'),
       (select id from public.sources where slug = 'planilha'), 'fornecedor'
  from generate_series(1, 9) i;
insert into public.deals (organization_id, pipeline_id, stage_id)
select o.id, (select id from public.pipelines where slug = 'fornecedor'),
       (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
         where p.slug = 'fornecedor' and s.slug = 'prospectado')
  from public.organizations o where o.name like 'C109 Buffet %';


-- =====================================================================
-- A. As chaves da voz, e todo mundo liga
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is(public.voz_configurar('{"telefonia_ativa": true}'::jsonb) ->> 'motivo', 'sem_permissao',
  'quem só liga não mexe nas chaves da voz');
select pg_temp.sair();
select is((select value ->> 'ativa' from public.app_settings where key = 'voz.telefonia'), 'false',
  'e a chave continua como estava');

-- Com a telefonia DESLIGADA, os três papéis ligam (pelo aparelho).
select lives_ok($$ select pg_temp.ligar('a_sdr', pg_temp.org(7), 'nao_atendeu', pg_temp.sdr(), 'sdr') $$,
  'telefonia desligada: o SDR abre e tabula uma ligação');
select is(pg_temp.v('a_sdr', 'tabulado'), 'true', 'e a ligação do SDR fica tabulada');

select pg_temp.entrar(pg_temp.ges(), 'gestor');
select is(public.voz_configurar('{"telefonia_ativa": "sim"}'::jsonb) ->> 'motivo', 'valor_invalido',
  'a chave só aceita ligado ou desligado');
select is(public.voz_configurar('{"telefonia_ativa": true}'::jsonb) ->> 'telefonia_ativa', 'true',
  'o gestor liga a telefonia pelo navegador');
select is(public.voz_configurar('{"aviso_ativo": true}'::jsonb) ->> 'aviso_ativo', 'true',
  'e liga o aviso de ligação não atendida');
select is(public.voz_configurar('{"aviso_ativo": false}'::jsonb) ->> 'aviso_ativo', 'false',
  'e desliga de novo');
select pg_temp.sair();
select is((select value ->> 'por_hora' from public.app_settings where key = 'voz.aviso_nao_atendeu'),
  '60', 'mexer na chave não apaga o ritmo do aviso');

-- Com a telefonia LIGADA, os três papéis ligam.
select lives_ok($$ select pg_temp.ligar('a_adm', pg_temp.org(8), 'nao_atendeu', pg_temp.adm(), 'admin') $$,
  'telefonia ligada: o admin abre e tabula uma ligação');
select is(pg_temp.v('a_adm', 'tabulado'), 'true', 'e a ligação do admin fica tabulada');
select lives_ok($$ select pg_temp.ligar('a_ges', pg_temp.org(9), 'nao_atendeu', pg_temp.ges(), 'gestor') $$,
  'telefonia ligada: o gestor abre e tabula uma ligação');
select is(pg_temp.v('a_ges', 'tabulado'), 'true', 'e a ligação do gestor fica tabulada');


-- =====================================================================
-- B. Tirar do lote e excluir o lote
-- =====================================================================
do $$
declare v_script uuid; v_versao int; v_lote uuid; v_item uuid; i int;
begin
  select id, versao into v_script, v_versao from public.call_scripts
   where is_published order by versao desc limit 1;
  insert into public.call_batches (nome, owner_id, status, pipeline_id, temperature_origin,
                                   script_id, script_version, starts_on, ends_on)
  values ('Lote do pgTAP 109', pg_temp.sdr(), 'ativo',
          (select id from public.pipelines where slug = 'fornecedor'), 'frio', v_script, v_versao,
          pg_temp.hoje(), pg_temp.hoje() + 1)
  returning id into v_lote;
  insert into pg_temp.r values ('lote', jsonb_build_object('id', v_lote));
  for i in 4..6 loop
    insert into public.call_batch_items (batch_id, organization_id, phone_e164, position)
    values (v_lote, pg_temp.org(i), '+55849999109' || lpad(i::text, 2, '0'), i)
    returning id into v_item;
    insert into pg_temp.r values ('item' || i, jsonb_build_object('id', v_item));
  end loop;
end $$;
create function pg_temp.lote(p_campo text) returns text
language sql stable security definer set search_path = '' as $$
  select to_jsonb(b) ->> p_campo from public.call_batches b
   where b.id = (select (valor ->> 'id')::uuid from pg_temp.r where chave = 'lote')
$$;
create function pg_temp.item(p_n int) returns text
language sql stable security definer set search_path = '' as $$
  select i.status::text from public.call_batch_items i
   where i.id = (select (valor ->> 'id')::uuid from pg_temp.r where chave = 'item' || p_n)
$$;

-- Desde 21/10/2026 o SDR tem o poder do gestor (migração 20261021090000): quem
-- não mexe no lote é o embaixador. O SDR passa da trava e só para no item e no
-- lote que não existem, para o lote do teste seguir inteiro até o gestor.
select pg_temp.entrar(pg_temp.emb(), 'embaixador');
select is(public.lote_tirar_contato((pg_temp.v('item4', 'id'))::uuid) ->> 'motivo', 'sem_permissao',
  'o embaixador não tira contato do lote');
select is(public.lote_excluir((pg_temp.v('lote', 'id'))::uuid, 'montei errado') ->> 'motivo',
  'sem_permissao', 'nem exclui o lote');
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is(public.lote_tirar_contato(gen_random_uuid()) ->> 'motivo', 'item_inexistente',
  'o SDR tira contato do lote, como a gestão (poder do gestor desde 21/10/2026)');
select is(public.lote_excluir(gen_random_uuid(), 'montei errado') ->> 'motivo', 'lote_inexistente',
  'e exclui o lote');
select is(jsonb_array_length(public.lote_contatos((pg_temp.v('lote', 'id'))::uuid) -> 'contatos'), 3,
  'e vê quem está no lote que é dela');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.ges(), 'gestor');
select is(public.lote_tirar_contato((pg_temp.v('item4', 'id'))::uuid, 'já é cliente') ->> 'nome',
  'C109 Buffet 4', 'o gestor tira um contato da fila, e a resposta diz quem saiu');
select is(public.lote_tirar_contato((pg_temp.v('item4', 'id'))::uuid) ->> 'motivo', 'fora_da_fila',
  'tirar de novo não faz nada: ele já saiu');
select is(public.lote_excluir((pg_temp.v('lote', 'id'))::uuid, ' ') ->> 'motivo', 'motivo_obrigatorio',
  'excluir um lote pede o motivo');
select pg_temp.sair();
select is(pg_temp.item(4), 'devolvido', 'o contato tirado volta para a base');
select is(pg_temp.lote('pending'), '2', 'e a fila do lote cai para dois');

-- Uma ligação já feita no lote, pela Ana.
insert into public.call_attempts (item_id, batch_id, organization_id, user_id, iniciada_em,
                                  encerrada_em, duracao_seg, resultado)
values ((pg_temp.v('item5', 'id'))::uuid, (pg_temp.v('lote', 'id'))::uuid, pg_temp.org(5), pg_temp.sdr(),
        now() - interval '2 minutes', now() - interval '1 minute', 0, 'ocupado');

select pg_temp.entrar(pg_temp.ges(), 'gestor');
select is(public.lote_excluir((pg_temp.v('lote', 'id'))::uuid, 'montei com o funil errado'),
  jsonb_build_object('ok', true, 'nome', 'Lote do pgTAP 109', 'devolvidos', 2, 'ligacoes_feitas', 1),
  'o gestor exclui o lote, e o recibo conta o que voltou e o que já tinha sido ligado');
select is(public.lote_excluir((pg_temp.v('lote', 'id'))::uuid, 'de novo') ->> 'motivo',
  'lote_inexistente', 'lote excluído não se exclui duas vezes');
select is(pg_temp.dia(pg_temp.sdr(), 'ligacoes'), 2,
  'as ligações da Ana continuam no dia dela: a do lote excluído e a da ficha');
select pg_temp.sair();
select ok(pg_temp.lote('deleted_at') is not null and pg_temp.lote('status') = 'encerrado',
  'o lote fica marcado e encerrado, e a linha não é apagada');
select is(pg_temp.item(5) || '/' || pg_temp.item(6), 'devolvido/devolvido',
  'quem estava na fila volta para a base');


-- =====================================================================
-- C. Corrigir o resultado da ligação
-- =====================================================================
-- A Ana ligou para o 1 e marcou "não atendeu"; na verdade ele atendeu e se interessou.
select pg_temp.ligar('c1', pg_temp.org(1), 'nao_atendeu', pg_temp.sdr(), 'sdr');
select is(pg_temp.etapa(pg_temp.org(1)), 'prospectado', 'não atendeu não tira ninguém de Prospectado');

-- Desde 21/10/2026 o SDR tem o poder do gestor (migração 20261021090000): quem
-- não corrige a ligação de outra pessoa é o embaixador. O SDR passa dessa trava
-- e só para no motivo em branco (nada é corrigido).
select is(pg_temp.corrigir('x', 'c1', pg_temp.emb(), 'embaixador', 'atendida_humano', 'lig_interessado', 'engano'),
  'de_outra_pessoa', 'o embaixador não corrige a ligação de outra pessoa');
select is(pg_temp.corrigir('x', 'c1', pg_temp.sdr2(), 'sdr', 'atendida_humano', 'lig_interessado', ' '),
  'motivo_obrigatorio', 'o SDR corrige a ligação de outra pessoa, como a gestão (poder do gestor desde 21/10/2026)');
select is(pg_temp.corrigir('x', 'c1', pg_temp.sdr(), 'sdr', 'atendida_humano', 'lig_interessado', ' '),
  'motivo_obrigatorio', 'a correção pede o motivo');
select is(pg_temp.corrigir('x', 'c1', pg_temp.sdr(), 'sdr', 'nao_atendeu', null, 'engano'),
  'mesmo_resultado', 'corrigir para o mesmo resultado não é correção');
select is(pg_temp.corrigir('x', 'c1', pg_temp.sdr(), 'sdr', 'atendida_humano', 'lig_reuniao_marcada', 'engano'),
  'reuniao_pela_agenda', 'reunião se marca pela Agenda, não pela correção');
select is(pg_temp.corrigir('x', 'c1', pg_temp.sdr(), 'sdr', 'atendida_humano', 'lig_sem_interesse', 'engano'),
  'motivo_de_perda_obrigatorio', 'corrigir para "sem interesse" pede o motivo da perda');

select is(pg_temp.corrigir('k1', 'c1', pg_temp.sdr(), 'sdr', 'atendida_humano', 'lig_interessado',
                           'cliquei no botão errado', null, 'd0000000-0000-4000-8000-000000001091'::uuid),
  'true', 'quem ligou corrige o próprio engano no mesmo dia');
select is(pg_temp.tentativa('c1', 'resultado') || '/' || pg_temp.tentativa('c1', 'outcome_id'),
  'atendida_humano/' || pg_temp.desfecho('lig_interessado'),
  'a tentativa passa a dizer que atendeu e se interessou');
select is(pg_temp.etapa(pg_temp.org(1)), 'respondeu',
  'o negócio anda como andaria se o resultado certo tivesse sido lançado');
select is((select a.type::text || '/' || coalesce(a.outcome_id::text, 'sem')
             from public.activities a where a.id = (pg_temp.v('c1', 'activity_id'))::uuid),
  'system/sem', 'o registro antigo vira nota do sistema, sem desfecho');
select is(pg_temp.corrigir('k1', 'c1', pg_temp.sdr(), 'sdr', 'atendida_humano', 'lig_interessado',
                           'cliquei no botão errado', null, 'd0000000-0000-4000-8000-000000001091'::uuid),
  'true', 'o clique repetido devolve a mesma resposta');
select is((select count(*)::int from public.activities a
            where a.organization_id = pg_temp.org(1) and a.type = 'call'), 1,
  'e não lança o resultado duas vezes');

select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is(pg_temp.dia(pg_temp.sdr(), 'atendidas'), 1, 'no dia da Ana a ligação passa para "atenderam"');
select is(pg_temp.dia(pg_temp.sdr(), 'outros_registros'), 0,
  'e a nota da correção não vira um registro a mais');
select pg_temp.sair();

-- A Ana marcou "interessado" no 2; a gestão corrige para "não atendeu".
select pg_temp.ligar('c2', pg_temp.org(2), 'atendida_humano', pg_temp.sdr(), 'sdr');
select is(pg_temp.etapa(pg_temp.org(2)) || '/' || coalesce(pg_temp.negocio(pg_temp.org(2), 'last_intent'), '-'),
  'respondeu/interessado', 'o resultado errado tinha levado o negócio para Respondeu, quente');
select is(pg_temp.corrigir('k2', 'c2', pg_temp.ges(), 'gestor', 'nao_atendeu', null, 'a Ana avisou que errou'),
  'true', 'a gestão corrige a ligação de quem ligou');
select is(pg_temp.v('k2', 'etapa') || '/' || pg_temp.etapa(pg_temp.org(2)), 'voltou/prospectado',
  'a etapa volta para onde estava antes do resultado errado');
select is(coalesce(pg_temp.negocio(pg_temp.org(2), 'last_intent'), '-'), '-',
  'a intenção declarada sai com ele');
select ok((pg_temp.v('k2', 'tarefas_canceladas'))::int >= 1
          and not exists (select 1 from public.tasks t
                           where t.organization_id = pg_temp.org(2) and t.status = 'todo'
                             and t.kind = 'meeting'),
  'a próxima ação que o resultado errado criou é cancelada');
select is((select a.user_id from public.activities a where a.id = (pg_temp.v('k2', 'activity_id'))::uuid),
  pg_temp.sdr(), 'a ligação continua sendo de quem ligou, não de quem corrigiu');
select is((select count(*)::int from public.audit_log l
            where l.action = 'CORRIGIR_RESULTADO' and l.actor_id = pg_temp.ges()), 1,
  'e a correção fica na auditoria, no nome de quem corrigiu');

-- Ligação de ontem: quem ligou já não corrige sozinha.
-- Desde 21/10/2026 o SDR tem o poder do gestor (migração 20261021090000): a
-- regra vale para quem liga sem ser da gestão, e é provada com uma ligação de
-- ontem do embaixador. O SDR passa da trava do dia e só para no motivo em branco.
update public.call_attempts set iniciada_em = iniciada_em - interval '1 day'
 where id = (pg_temp.v('c2', 'attempt_id'))::uuid;
with nova as (
  insert into public.call_attempts (item_id, batch_id, organization_id, user_id, iniciada_em,
                                    encerrada_em, duracao_seg, resultado)
  values ((pg_temp.v('item6', 'id'))::uuid, (pg_temp.v('lote', 'id'))::uuid, pg_temp.org(6), pg_temp.emb(),
          now() - interval '1 day', now() - interval '1 day' + interval '1 minute', 0, 'nao_atendeu')
  returning id)
insert into pg_temp.r select 'c_emb', jsonb_build_object('attempt_id', id) from nova;
select is(pg_temp.corrigir('x', 'c_emb', pg_temp.emb(), 'embaixador', 'caixa_postal', null, 'era caixa postal'),
  'de_outro_dia', 'no dia seguinte, quem ligou pede a correção à gestão');
select is(pg_temp.corrigir('x', 'c2', pg_temp.sdr(), 'sdr', 'caixa_postal', null, ' '),
  'motivo_obrigatorio', 'o SDR corrige a ligação de ontem, como a gestão (poder do gestor desde 21/10/2026)');

-- Nenhuma mensagem sai por causa de correção.
select ok(pg_get_triggerdef((select oid from pg_trigger where tgname = 'call_attempts_aviso'))
          like '%old.resultado IS NULL%',
  'o aviso no WhatsApp só nasce de resultado vazio: corrigir nunca dispara mensagem');

select * from finish();
rollback;

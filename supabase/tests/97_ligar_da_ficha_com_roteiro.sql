-- =====================================================================
-- pgTAP — Ligar da ficha, com o roteiro
--         (migração 20261010090200_ligar_da_ficha_com_roteiro.sql)
--
-- O que este arquivo trava:
--
--   1. O "Ligar" da ficha monta um lote de UM contato, marcado como avulso,
--      e o segundo clique reaproveita o mesmo lote.
--   2. As travas valem: papel, telefone, supressão, janela, negócio aberto.
--   3. A RESERVA vale: parceiro no lote de outra pessoa não é ligado por
--      fora; no lote de turno de quem clicou, a resposta aponta o lote.
--   4. O caminho inteiro é o do módulo: puxar, abrir a chamada, discar pelo
--      navegador com o número da reserva, tabular — e a ligação vira
--      atividade.
--   5. O lote avulso não prende o parceiro: terminado ou abandonado, fecha.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(24);

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
create function pg_temp.hoje() returns date language sql as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;
create function pg_temp.org(p_n int) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-0000000097' || lpad(p_n::text, 2, '0'))::uuid
$$;
create function pg_temp.v(p_chave text, p_campo text) returns text language sql as $$
  select valor ->> p_campo from pg_temp.r where chave = p_chave
$$;
create function pg_temp.lote(p_id uuid) returns public.call_batches
language sql security definer set search_path = '' as $$
  select b from public.call_batches b where b.id = p_id
$$;
create function pg_temp.itens_vivos(p_org uuid) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from public.call_batch_items i
   where i.organization_id = p_org and i.status in ('fila', 'em_andamento')
$$;

insert into public.allowed_users (email, role, note) values
  ('c97.sdr@teste.local',     'sdr',     'pgTAP ligar da ficha'),
  ('c97.sdr2@teste.local',    'sdr',     'pgTAP ligar da ficha'),
  ('c97.leitura@teste.local', 'leitura', 'pgTAP ligar da ficha');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000097a1', 'c97.sdr@teste.local',     '{"full_name":"SDR Ficha"}'),
  ('a0000000-0000-4000-8000-0000000097a2', 'c97.sdr2@teste.local',    '{"full_name":"SDR Ficha Dois"}'),
  ('a0000000-0000-4000-8000-0000000097a3', 'c97.leitura@teste.local', '{"full_name":"Leitura Ficha"}');

insert into public.categories (id, slug, name, "group", priority, position)
values (997, 'c97_teste', 'Categoria de teste do ligar da ficha', 'servicos', 2, 997);
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind)
select pg_temp.org(i), 'C97 Buffet ' || i,
       case when i = 5 then null else '+558499997' || lpad(i::text, 4, '0') end, 'Tirol',
       (select id from public.sources where slug = 'planilha'), 'fornecedor'
  from generate_series(1, 8) i;
insert into public.organization_categories (organization_id, category_id, is_primary)
select id, 997, true from public.organizations where name like 'C97 Buffet %';
-- o 7 fica SEM negócio
insert into public.deals (organization_id, pipeline_id, stage_id)
select o.id, (select id from public.pipelines where slug = 'fornecedor'),
       (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
         where p.slug = 'fornecedor' and s.slug = 'prospectado')
  from public.organizations o where o.name like 'C97 Buffet %' and o.id <> pg_temp.org(7);
update public.organizations set do_not_contact = true where id = pg_temp.org(6);

delete from public.holidays where date = pg_temp.hoje();
delete from public.app_settings where key = 'voz.telefonia';
insert into public.app_settings (key, value) values ('voz.telefonia', '{"ativa": true}'::jsonb);


-- =====================================================================
-- 1. Portas e a janela
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.montar_lote_avulso(uuid)', 'execute'),
  'anônimo não monta lote avulso');
select ok(not has_function_privilege('authenticated', 'app.encerrar_lotes_avulsos()', 'execute'),
  'a limpeza é só do serviço');

create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select 0::numeric, 0::numeric where false
$$;
do $$
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000097a1', 'sdr');
  insert into pg_temp.r values ('janela', public.montar_lote_avulso(pg_temp.org(1)));
end $$;
select pg_temp.sair();
select is(pg_temp.v('janela', 'motivo'), 'fora_da_janela',
  'fora da janela, a ficha não abre ligação');

create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select 0::numeric, 24::numeric
$$;


-- =====================================================================
-- 2. Travas
-- =====================================================================
do $$
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000097a3', 'leitura');
  insert into pg_temp.r values ('leitura', public.montar_lote_avulso(pg_temp.org(1)));
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000097a1', 'sdr');
  insert into pg_temp.r values ('sem_fone',    public.montar_lote_avulso(pg_temp.org(5)));
  insert into pg_temp.r values ('suprimido',   public.montar_lote_avulso(pg_temp.org(6)));
  insert into pg_temp.r values ('sem_negocio', public.montar_lote_avulso(pg_temp.org(7)));
end $$;
select pg_temp.sair();
select is(pg_temp.v('leitura', 'motivo'), 'sem_permissao', 'quem não escreve não liga');
select is(pg_temp.v('sem_fone', 'motivo'), 'sem_telefone', 'ficha sem telefone não liga');
select is(pg_temp.v('suprimido', 'motivo'), 'contato_suprimido',
  'quem pediu para não ser procurado não entra em lote avulso');
select is(pg_temp.v('sem_negocio', 'motivo'), 'sem_negocio_aberto',
  'sem negócio aberto não há funil para o roteiro');


-- =====================================================================
-- 3. Montar, reaproveitar, e a reserva
-- =====================================================================
do $$
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000097a1', 'sdr');
  insert into pg_temp.r values ('um',  public.montar_lote_avulso(pg_temp.org(1)));
  insert into pg_temp.r values ('bis', public.montar_lote_avulso(pg_temp.org(1)));
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000097a2', 'sdr');
  insert into pg_temp.r values ('outro', public.montar_lote_avulso(pg_temp.org(1)));
end $$;
select pg_temp.sair();

select is(pg_temp.v('um', 'ok'), 'true', 'o Ligar da ficha monta o lote');
select is((pg_temp.lote(pg_temp.v('um', 'lote_id')::uuid)).avulso, true, 'marcado como avulso');
select is((pg_temp.lote(pg_temp.v('um', 'lote_id')::uuid)).total || '/' ||
          (pg_temp.lote(pg_temp.v('um', 'lote_id')::uuid)).max_attempts, '1/1',
  'um contato, uma tentativa');
select is(pg_temp.v('bis', 'lote_id'), pg_temp.v('um', 'lote_id'),
  'o segundo clique reaproveita o mesmo lote');
select is(pg_temp.itens_vivos(pg_temp.org(1)), 1, 'e não duplica a reserva');
select is(pg_temp.v('outro', 'motivo') || '/' || pg_temp.v('outro', 'dono'),
          'reservado_em_outro_lote/SDR Ficha',
  'outra pessoa não liga por fora, e a recusa diz com quem está');

-- ligou e não tabulou: o próximo clique fecha o lote velho e monta outro
do $$
declare v jsonb; v_item uuid;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000097a1', 'sdr');
  v := public.montar_lote_avulso(pg_temp.org(3));
  insert into pg_temp.r values ('velho', v);
  v_item := (public.proximo_da_fila((v ->> 'lote_id')::uuid) -> 'item' ->> 'id')::uuid;
  perform public.iniciar_chamada(v_item);
  insert into pg_temp.r values ('novo', public.montar_lote_avulso(pg_temp.org(3)));
end $$;
select pg_temp.sair();
select ok(pg_temp.v('novo', 'ok') = 'true' and pg_temp.v('novo', 'lote_id') <> pg_temp.v('velho', 'lote_id'),
  'ligação abandonada sem tabular: o próximo clique monta um lote novo');
select is((pg_temp.lote(pg_temp.v('velho', 'lote_id')::uuid)).status::text, 'encerrado',
  'e o lote abandonado é encerrado');
select is(pg_temp.itens_vivos(pg_temp.org(3)), 1, 'sobrando uma reserva só');


-- parceiro que está no lote de TURNO de quem clicou
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000097a2', 'sdr');
  v := public.montar_lote('C97 turno', (select id from public.pipelines where slug = 'fornecedor'),
         'frio', (select id from public.call_scripts where is_published order by created_at desc limit 1),
         array[997], 'prioridade', 10, 3, 20, null, pg_temp.hoje(), pg_temp.hoje());
  insert into pg_temp.r values ('turno', v);
  insert into pg_temp.r values ('no_turno', public.montar_lote_avulso(pg_temp.org(2)));
end $$;
select pg_temp.sair();
select is(pg_temp.v('no_turno', 'motivo') || '/' || pg_temp.v('no_turno', 'lote_id'),
          'ja_no_seu_lote/' || pg_temp.v('turno', 'lote_id'),
  'parceiro no lote de turno de quem clicou: a resposta aponta o lote');


-- =====================================================================
-- 4. O caminho inteiro é o do módulo
-- =====================================================================
do $$
declare v jsonb; v_item uuid; v_ch jsonb; v_att uuid; v_voz jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000097a1', 'sdr');
  v      := public.proximo_da_fila(pg_temp.v('um', 'lote_id')::uuid);
  v_item := (v -> 'item' ->> 'id')::uuid;
  insert into pg_temp.r values ('proximo', v);
  v_ch   := public.iniciar_chamada(v_item);
  v_att  := (v_ch -> 'chamada' ->> 'id')::uuid;
  v_voz  := public.voz_abrir_ligacao(null, v_att);
  insert into pg_temp.r values ('voz', v_voz);
  perform public.voz_encerrar_ligacao((v_voz -> 'ligacao' ->> 'id')::uuid);
  v := public.tabular_chamada(gen_random_uuid(), v_att, v_item,
         'atendida_humano', 'decisor',
         (select id from public.interaction_outcomes where slug = 'lig_interessado'),
         array['abertura'], 95, 'gostou da proposta', '{}'::jsonb, null, null, null, null, false);
  insert into pg_temp.r values ('tab', v);
end $$;
select pg_temp.sair();

select is((select valor -> 'item' ->> 'organization_id' from pg_temp.r where chave = 'proximo'),
          pg_temp.org(1)::text, 'a fila do lote avulso entrega o parceiro da ficha');
select is(pg_temp.v('voz', 'ok'), 'true', 'a tentativa disca pelo navegador');
select is(pg_temp.v('tab', 'tabulado'), 'true', 'a tabulação é a do módulo');
select ok((select a.type = 'call' and a.organization_id = pg_temp.org(1)
             from public.activities a where a.id = pg_temp.v('tab', 'activity_id')::uuid),
  'e a ligação entra na linha do tempo do parceiro');
select is(pg_temp.itens_vivos(pg_temp.org(1)), 0, 'tabulada, a reserva solta');


-- =====================================================================
-- 5. O lote avulso não prende o parceiro
-- =====================================================================
select ok(app.encerrar_lotes_avulsos() >= 1, 'a limpeza fecha o lote avulso que terminou');
select is((pg_temp.lote(pg_temp.v('um', 'lote_id')::uuid)).status::text, 'encerrado',
  'e ele sai de ativo');

select * from finish();
rollback;

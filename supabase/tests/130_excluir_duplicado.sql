-- =====================================================================
-- pgTAP — Excluir duplicado (migração 20261106110000), só na Imova
--
-- Prova: marcar a cópia como excluída tira da lista e libera a vaga; o próximo
-- relatório confirma — se ela não vier, sai de vez; se ainda vier, volta com
-- `marcado_excluido_em` (a exclusão não pegou); marcar de novo apaga o aviso; o
-- SDR não marca; nenhum UPDATE sem WHERE.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(13);

insert into public.allowed_users (email, role, note) values
  ('a130.g@teste.local', 'gestor', 'pgTAP excluir duplicado'),
  ('a130.s@teste.local', 'sdr', 'pgTAP excluir duplicado');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000013001'::uuid, 'a130.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000013002'::uuid, 'a130.s@teste.local', '{"full_name":"Sara SDR"}');
create function pg_temp.entrar(p_id text, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.gestor() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000013001', 'gestor') $$;
create function pg_temp.sdr() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000013002', 'sdr') $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

-- O relatório começa vazio neste teste.
update public.anuncios_no_canal_pro set no_relatorio = false where no_relatorio;

insert into public.anuncios (codigo, titulo, tipo, negocio, area_total, cidade, bairro, origem) values
  ('T130A', 'Terreno T130', 'terreno', 'venda', 13001, 'Cidade T130', 'Bairro T130', 'sistema_atual');

create function pg_temp.relatorio(p_com_copia boolean) returns jsonb language sql as $$
  select public.canal_pro_importar(jsonb_build_array(
    jsonb_build_object('codigo', 'T130A', 'titulo', 'Terreno T130', 'tipo_crm', 'terreno',
      'area', 13001, 'cidade', 'Cidade T130', 'bairro', 'Bairro T130', 'situacao', 'Ativo'))
    || case when p_com_copia then jsonb_build_array(
    jsonb_build_object('codigo', 'Copia T130', 'titulo', 'Terreno T130 (antigo)', 'tipo_crm', 'terreno',
      'area', 13001, 'cidade', 'Cidade T130', 'bairro', 'Bairro T130', 'situacao', 'Ativo'))
    else '[]'::jsonb end)
$$;
-- Para onde vai o retorno das chamadas que não são asserção.
create temp table lixo(v jsonb);
grant insert on lixo to authenticated;
create function pg_temp.copia() returns uuid language sql as
  $$ select id from public.anuncios_no_canal_pro where codigo = 'Copia T130' $$;
create function pg_temp.na_lista() returns boolean language sql as
  $$ select exists (select 1 from public.anuncios_no_canal_pro
                     where codigo = 'Copia T130' and no_relatorio and excluido_em is null) $$;

select pg_temp.gestor();
select is(pg_temp.relatorio(true) ->> 'trazidos', '0', 'a cópia antiga entra no relatório e não vem para o CRM');
select ok(pg_temp.na_lista(), 'e aparece na lista de baixo');
select pg_temp.sair();
select isnt((select public.canal_pro_parece_com(m) from public.anuncios_no_canal_pro m where m.codigo = 'Copia T130'),
  null, 'como repetida do T130A');
create temp table vagas_antes as select (select o.anuncios from app.canal_pro_ocupadas() o) as n;

select pg_temp.sdr();
select is(public.canal_pro_marcar_excluido(pg_temp.copia(), true) ->> 'motivo', 'sem_permissao',
  'o SDR não marca como excluída');
select pg_temp.sair();

select pg_temp.gestor();
select is(public.canal_pro_marcar_excluido(pg_temp.copia(), true) ->> 'ok', 'true', 'a gestão marca como excluída');
select ok(not pg_temp.na_lista(), 'ela sai da lista');
select pg_temp.sair();
select is((select o.anuncios from app.canal_pro_ocupadas() o), (select n - 1 from vagas_antes), 'e a vaga do plano fica livre na conta do CRM');

-- O próximo relatório ainda a traz: a exclusão não pegou.
create temp table marca as select excluido_em from public.anuncios_no_canal_pro where codigo = 'Copia T130';
select pg_temp.gestor();
insert into lixo select pg_temp.relatorio(true);
select pg_temp.sair();
select ok(pg_temp.na_lista(), 'o relatório que ainda a traz a põe de volta na lista');
select is((select marcado_excluido_em from public.anuncios_no_canal_pro where codigo = 'Copia T130'),
  (select excluido_em from marca), 'com a hora em que tinha sido marcada (a tela avisa)');

-- Marcar de novo apaga o aviso; o relatório sem ela a tira de vez.
select pg_temp.gestor();
insert into lixo select public.canal_pro_marcar_excluido(pg_temp.copia(), true);
select pg_temp.sair();
select is((select marcado_excluido_em from public.anuncios_no_canal_pro where codigo = 'Copia T130'),
  null, 'marcar de novo é outra tentativa: o aviso sai');
select pg_temp.gestor();
insert into lixo select pg_temp.relatorio(false);
select pg_temp.sair();
select ok((select not no_relatorio and marcado_excluido_em is null
             from public.anuncios_no_canal_pro where codigo = 'Copia T130'),
  'o relatório sem ela confirma: saiu do Canal Pro, sem aviso');
select ok(not pg_temp.na_lista(), 'e não volta para a lista');

select is(
  (select count(*)::int
     from pg_proc p
    cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('canal_pro_marcar_excluido', 'canal_pro_importar')
      and comando ~* '(^|\n)\s*(update|delete)\s'
      and comando !~* '\swhere\s'),
  0, 'nenhum UPDATE ou DELETE sem WHERE (o safeupdate da API recusaria)');

select * from finish();
rollback;

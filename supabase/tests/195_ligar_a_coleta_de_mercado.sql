-- =====================================================================
-- pgTAP — Ligar e desligar a coleta de mercado pela tela (migração 20261119170000)
--
-- Prova `public.mercado_coleta_ligar(p_ligar, p_motivo)`, a porta de Ajustes →
-- Inteligência de mercado:
--
--   1. A GRADE: security definer, search_path vazio, execute só para
--      `authenticated` (nem public, nem anon);
--   2. QUEM PODE: admin liga e desliga, gestor liga; SDR e outro papel recebem
--      42501 e nada muda;
--   3. O MOTIVO: com menos de 5 caracteres (ou só espaços) é recusado, sem gravar;
--   4. A CHAVE: `app_settings['mercado']` guarda ligado, quem, quando e o
--      motivo, sem perder as outras chaves do valor; `app.mercado_ligado()`
--      acompanha; pedir o que já vale não grava nada;
--   5. O AUDIT_LOG: cada mudança grava o antes e o depois, com quem e o motivo;
--   6. NA KOMUNE (e num banco sem identidade): `so_imova`, sem gravar.
--
-- O CI roda as migrações sem identidade e a semente grava 'komune': o teste
-- vira Imova dentro da transação (como o 190). Roda em transação e desfaz tudo.
-- =====================================================================
begin;

select plan(43);

create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  if p_empresa is not null then
    insert into app.identidade (empresa) values (p_empresa);
  end if;
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;
select pg_temp.virar('imova');

insert into public.allowed_users (email, role, note) values
  ('m195.a@teste.local', 'admin', 'pgTAP 195'),
  ('m195.g@teste.local', 'gestor', 'pgTAP 195'),
  ('m195.s@teste.local', 'sdr', 'pgTAP 195'),
  ('m195.l@teste.local', 'leitura', 'pgTAP 195');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000019501'::uuid, 'm195.a@teste.local', '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000019502'::uuid, 'm195.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000019503'::uuid, 'm195.s@teste.local', '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000019504'::uuid, 'm195.l@teste.local', '{"full_name":"Lia Leitura"}');

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

-- As linhas desta função no audit_log (o gatilho de app_settings grava as dele com row_id '?').
create function pg_temp.auditorias() returns int language sql as $$
  select count(*)::int from public.audit_log where table_name = 'app_settings' and row_id = 'mercado'
$$;

-- A chave começa desligada, com uma chave a mais que não pode se perder.
update public.app_settings set value = '{"ligado": false, "nota_da_casa": "fica"}'::jsonb where key = 'mercado';

-- ---------------------------------------------------------------------
-- 1. A grade
-- ---------------------------------------------------------------------
select ok(to_regprocedure('public.mercado_coleta_ligar(boolean,text)') is not null,
          'public.mercado_coleta_ligar(boolean, text) existe');
select ok((select p.prosecdef from pg_proc p where p.oid = 'public.mercado_coleta_ligar(boolean,text)'::regprocedure),
          'é security definer');
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p
            where p.oid = 'public.mercado_coleta_ligar(boolean,text)'::regprocedure),
          'com search_path vazio');
select ok(has_function_privilege('authenticated', 'public.mercado_coleta_ligar(boolean,text)', 'execute'),
          'quem tem login chama (a função confere o papel)');
select ok(not has_function_privilege('anon', 'public.mercado_coleta_ligar(boolean,text)', 'execute'),
          'o anônimo não chama');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                       where p.oid = 'public.mercado_coleta_ligar(boolean,text)'::regprocedure
                         and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
          'nem PUBLIC');

-- ---------------------------------------------------------------------
-- 2. Quem pode: SDR e outro papel, não
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000019503'::uuid, 'sdr');
select throws_ok($$ select public.mercado_coleta_ligar(true, 'O SDR quer ligar') $$, '42501', null,
                 'o SDR não liga a coleta');
select throws_ok($$ select public.mercado_coleta_ligar(false, 'O SDR quer desligar') $$, '42501', null,
                 'nem desliga');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000019504'::uuid, 'leitura');
select throws_ok($$ select public.mercado_coleta_ligar(true, 'Outro papel quer ligar') $$, '42501', null,
                 'outro papel também não');
select pg_temp.sair();

select ok(not app.mercado_ligado(), 'depois das recusas, a coleta continua desligada');
select is(pg_temp.auditorias(), 0, 'e nada foi para o audit_log');

-- ---------------------------------------------------------------------
-- 3. O motivo
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000019501'::uuid, 'admin');
select is(public.mercado_coleta_ligar(true, 'liga') ->> 'motivo', 'motivo_obrigatorio',
          'motivo com 4 letras é recusado');
select is(public.mercado_coleta_ligar(true, '     ') ->> 'motivo', 'motivo_obrigatorio',
          'só espaços também');
select is(public.mercado_coleta_ligar(true, null) ->> 'motivo', 'motivo_obrigatorio',
          'e sem motivo nenhum');
select is(public.mercado_coleta_ligar(true, 'liga') ->> 'ok', 'false', 'a recusa vem com ok false');
select pg_temp.sair();
select ok(not app.mercado_ligado(), 'motivo curto não liga nada');
select is(pg_temp.auditorias(), 0, 'nem grava no audit_log');

-- ---------------------------------------------------------------------
-- 4 e 5. O admin liga e desliga; a chave, app.mercado_ligado() e o audit_log acompanham
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000019501'::uuid, 'admin');
-- A resposta fica guardada na transação para três conferências.
select set_config('t195.r', public.mercado_coleta_ligar(true, '  Fontes conferidas com o time em 19/11  ')::text, true);
select is(current_setting('t195.r')::jsonb ->> 'ok', 'true', 'o admin liga a coleta');
select is(current_setting('t195.r')::jsonb ->> 'mudou', 'true', 'e a resposta diz que mudou');
select is(current_setting('t195.r')::jsonb ->> 'ligado_de_fato', 'true', 'e que está ligada de fato');
select pg_temp.sair();

select ok(app.mercado_ligado(), 'app.mercado_ligado() passa a ser true');
select is((select value ->> 'motivo' from public.app_settings where key = 'mercado'),
          'Fontes conferidas com o time em 19/11', 'a chave guarda o motivo, sem os espaços das pontas');
select is((select value ->> 'mudou_por' from public.app_settings where key = 'mercado'),
          'a0000000-0000-4000-8000-000000019501', 'e quem ligou');
select ok((select (value ->> 'mudou_em')::timestamptz from public.app_settings where key = 'mercado') is not null,
          'e quando');
select is((select value ->> 'nota_da_casa' from public.app_settings where key = 'mercado'), 'fica',
          'as outras chaves do valor ficam como estavam');
select is(pg_temp.auditorias(), 1, 'uma linha no audit_log');
select ok(exists (select 1 from public.audit_log
                   where table_name = 'app_settings' and row_id = 'mercado' and action = 'UPDATE'
                     and actor_id = 'a0000000-0000-4000-8000-000000019501'::uuid and actor_role = 'admin'
                     and (old_data ->> 'ligado')::boolean = false and (new_data ->> 'ligado')::boolean
                     and new_data ->> 'motivo' = 'Fontes conferidas com o time em 19/11'),
          'com o antes (desligada), o depois (ligada), quem e o motivo');

select pg_temp.entrar('a0000000-0000-4000-8000-000000019501'::uuid, 'admin');
select is(public.mercado_coleta_ligar(true, 'Ligar de novo, sem querer') ->> 'mudou', 'false',
          'ligar o que já está ligado não muda nada');
select pg_temp.sair();
select is(pg_temp.auditorias(), 1, 'nem grava outra linha no audit_log');
select is((select value ->> 'motivo' from public.app_settings where key = 'mercado'),
          'Fontes conferidas com o time em 19/11', 'e o motivo de quem ligou continua lá');

select pg_temp.entrar('a0000000-0000-4000-8000-000000019501'::uuid, 'admin');
select is(public.mercado_coleta_ligar(false, 'Pausa para conferir os números') ->> 'ligado', 'false',
          'o admin desliga a coleta');
select pg_temp.sair();
select ok(not app.mercado_ligado(), 'app.mercado_ligado() volta a ser false');
select is(pg_temp.auditorias(), 2, 'a segunda decisão também vai para o audit_log');
select ok(exists (select 1 from public.audit_log
                   where table_name = 'app_settings' and row_id = 'mercado'
                     and (old_data ->> 'ligado')::boolean and not (new_data ->> 'ligado')::boolean
                     and old_data ->> 'motivo' = 'Fontes conferidas com o time em 19/11'
                     and new_data ->> 'motivo' = 'Pausa para conferir os números'),
          'com o motivo de antes e o de agora');

-- O gestor também pode.
select pg_temp.entrar('a0000000-0000-4000-8000-000000019502'::uuid, 'gestor');
select is(public.mercado_coleta_ligar(true, 'Gestor liga depois da conferência') ->> 'ok', 'true',
          'o gestor liga a coleta');
select pg_temp.sair();
select ok(app.mercado_ligado(), 'e app.mercado_ligado() acompanha');
select ok(exists (select 1 from public.audit_log
                   where table_name = 'app_settings' and row_id = 'mercado'
                     and actor_id = 'a0000000-0000-4000-8000-000000019502'::uuid and actor_role = 'gestor'
                     and (new_data ->> 'ligado')::boolean),
          'o audit_log diz que foi o gestor');

-- ---------------------------------------------------------------------
-- 6. Na KOMUNE (e num banco sem identidade), recusa sem gravar
-- ---------------------------------------------------------------------
select pg_temp.virar('komune');
update public.app_settings set value = '{"ligado": false}'::jsonb where key = 'mercado';
select pg_temp.entrar('a0000000-0000-4000-8000-000000019501'::uuid, 'admin');
select is(public.mercado_coleta_ligar(true, 'Ligar na KOMUNE por engano'),
          '{"ok": false, "motivo": "so_imova"}'::jsonb, 'na KOMUNE o admin recebe so_imova');
select pg_temp.sair();
select is((select value from public.app_settings where key = 'mercado'), '{"ligado": false}'::jsonb,
          'e a chave não muda');
select is(pg_temp.auditorias(), 3, 'nem o audit_log');
select ok(not app.mercado_ligado(), 'a coleta continua desligada na KOMUNE');

select pg_temp.entrar('a0000000-0000-4000-8000-000000019503'::uuid, 'sdr');
select throws_ok($$ select public.mercado_coleta_ligar(true, 'SDR na KOMUNE') $$, '42501', null,
                 'na KOMUNE, o SDR continua barrado antes de tudo');
select pg_temp.sair();

select pg_temp.virar(null);
select pg_temp.entrar('a0000000-0000-4000-8000-000000019501'::uuid, 'admin');
select is(public.mercado_coleta_ligar(true, 'Banco sem identidade') ->> 'motivo', 'so_imova',
          'num banco sem identidade também recusa: a coleta é só da Imova');
select pg_temp.sair();

select * from finish();
rollback;

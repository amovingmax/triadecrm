-- =====================================================================
-- pgTAP — Quem recebe os avisos (migração 20261111202000), só na Imova
--
-- Gargalo de 11/11/2026: "Instalar o app em toda a equipe ou, no mínimo,
-- ligar a notificação do navegador em cada computador", e a gestão saber
-- quem está recebendo. Este arquivo prova:
--
--   1. A TABELA dos navegadores fechada: RLS, nada direto para quem está logado;
--   2. REGISTRAR SÓ PARA SI: a linha é sempre da pessoa da sessão; sem sessão,
--      quem não atende, perfil inativo e permissão inventada são recusados; o
--      rótulo é limpo e cortado;
--   3. UMA VEZ POR HORA: o mesmo estado dentro da hora não regrava; estado novo
--      ou uma hora depois, sim; o que passou de 30 dias some e o teto é 20;
--   4. A VISÃO só para admin e gestor (o SDR e o embaixador são recusados), uma
--      linha por pessoa ativa que atende, quem não recebe nada primeiro;
--   5. A SITUAÇÃO de cada caso: celular e computador, só computador, só
--      celular, nada; bloqueado, silenciado e navegador velho não contam; o
--      aviso de mensagem nova desligado no app e a chave geral `avisos.push`
--      tiram o celular;
--   6. KOMUNE: onde as funções existem com a identidade da KOMUNE (o banco
--      do CI), não gravam nem mostram ninguém; e nenhum aviso vai para a fila.
--      No banco da KOMUNE de verdade a migração não cria nada (conferido no
--      banco de validação da KOMUNE, fora deste arquivo);
--   7. PRIVILÉGIOS: anônimo não executa nada; logado executa as duas funções.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(49);

insert into public.allowed_users (email, role, note) values
  ('a152.a@teste.local', 'admin', 'pgTAP quem recebe avisos'),
  ('a152.g@teste.local', 'gestor', 'pgTAP quem recebe avisos'),
  ('a152.s1@teste.local', 'sdr', 'pgTAP quem recebe avisos'),
  ('a152.s2@teste.local', 'sdr', 'pgTAP quem recebe avisos'),
  ('a152.s3@teste.local', 'sdr', 'pgTAP quem recebe avisos'),
  ('a152.s4@teste.local', 'sdr', 'pgTAP quem recebe avisos'),
  ('a152.s5@teste.local', 'sdr', 'pgTAP quem recebe avisos'),
  ('a152.e@teste.local', 'embaixador', 'pgTAP quem recebe avisos'),
  ('a152.i@teste.local', 'sdr', 'pgTAP quem recebe avisos');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000015201'::uuid, 'a152.a@teste.local',  '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000015202'::uuid, 'a152.g@teste.local',  '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000015203'::uuid, 'a152.s1@teste.local', '{"full_name":"Bia Computador"}'),
  ('a0000000-0000-4000-8000-000000015204'::uuid, 'a152.s2@teste.local', '{"full_name":"Caio Celular"}'),
  ('a0000000-0000-4000-8000-000000015205'::uuid, 'a152.s3@teste.local', '{"full_name":"Duda Nada"}'),
  ('a0000000-0000-4000-8000-000000015206'::uuid, 'a152.s4@teste.local', '{"full_name":"Edu Bloqueado"}'),
  ('a0000000-0000-4000-8000-000000015207'::uuid, 'a152.s5@teste.local', '{"full_name":"Fábio Velho"}'),
  ('a0000000-0000-4000-8000-000000015208'::uuid, 'a152.e@teste.local',  '{"full_name":"Edna Embaixadora"}'),
  ('a0000000-0000-4000-8000-000000015209'::uuid, 'a152.i@teste.local',  '{"full_name":"Iara Inativa"}');
update public.profiles set is_active = false where id = 'a0000000-0000-4000-8000-000000015209'::uuid;

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
-- A empresa do banco (o mesmo padrão dos outros testes da Imova).
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;
-- Registrar um navegador como a pessoa, com o papel dela.
create function pg_temp.registrar(p_uid uuid, p_papel text, p_aparelho uuid, p_permissao text,
                                  p_som boolean, p_silenciado boolean, p_rotulo text)
returns void language plpgsql as $$
begin
  perform pg_temp.entrar(p_uid, p_papel);
  perform public.avisos_registrar_navegador(p_aparelho, p_permissao, p_som, p_silenciado, p_rotulo);
  perform pg_temp.sair();
end $$;
-- A linha da visão de uma pessoa, lida pelo gestor.
create temp table t152_visao (
  pessoa_id uuid, nome text, papel text, celular_aparelhos integer, celular_visto_em timestamptz,
  celular_mensagem_ligada boolean, celular_push_ligado boolean, computador_ligados integer,
  computador_visto_em timestamptz, navegadores jsonb, situacao text);
grant all on t152_visao to authenticated;
create function pg_temp.ler_visao() returns void language plpgsql as $$
begin
  delete from t152_visao;
  perform pg_temp.entrar('a0000000-0000-4000-8000-000000015202'::uuid, 'gestor');
  insert into t152_visao select * from public.avisos_quem_recebe();
  perform pg_temp.sair();
end $$;
create function pg_temp.situacao(p_uid uuid) returns text language sql stable as $$
  select situacao from t152_visao where pessoa_id = p_uid
$$;

select pg_temp.virar('imova');

create temp table t152_base as
  select (select count(*) from app.push_fila) as fila;

-- ---------------------------------------------------------------------
-- 1. A tabela fechada
-- ---------------------------------------------------------------------
select has_table('app', 'avisos_navegadores', 'existe app.avisos_navegadores');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'app.avisos_navegadores'::regclass),
          'a tabela dos navegadores tem RLS');
select ok(not has_table_privilege('authenticated', 'app.avisos_navegadores', 'select')
          and not has_table_privilege('authenticated', 'app.avisos_navegadores', 'insert')
          and not has_table_privilege('anon', 'app.avisos_navegadores', 'select'),
          'quem está logado não lê nem grava a tabela direto');

-- ---------------------------------------------------------------------
-- 2. Registrar só para si
-- ---------------------------------------------------------------------
select pg_temp.registrar('a0000000-0000-4000-8000-000000015203'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000001'::uuid, 'liberada', true, false, 'Chrome no Mac');
select is((select pessoa_id from app.avisos_navegadores
            where aparelho_id = 'b0000000-0000-4000-8000-000000000001'::uuid),
          'a0000000-0000-4000-8000-000000015203'::uuid,
          'o navegador fica com a pessoa da sessão');
select is((select rotulo || '|' || permissao || '|' || som_ligado || '|' || silenciado
             from app.avisos_navegadores
            where aparelho_id = 'b0000000-0000-4000-8000-000000000001'::uuid),
          'Chrome no Mac|liberada|true|false', 'guarda rótulo, permissão, som e silêncio');

-- O mesmo navegador, outra pessoa logada: é outra linha, e a primeira fica como estava.
select pg_temp.registrar('a0000000-0000-4000-8000-000000015205'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000001'::uuid, 'a_pedir', true, false, 'Chrome no Mac');
select is((select count(*) from app.avisos_navegadores
            where aparelho_id = 'b0000000-0000-4000-8000-000000000001'::uuid), 2::bigint,
          'o mesmo computador com duas pessoas são duas linhas');
select is((select permissao from app.avisos_navegadores
            where aparelho_id = 'b0000000-0000-4000-8000-000000000001'::uuid
              and pessoa_id = 'a0000000-0000-4000-8000-000000015203'::uuid),
          'liberada', 'o registro de uma pessoa não mexe no da outra');

select pg_temp.entrar('a0000000-0000-4000-8000-000000015203'::uuid, 'sdr');
select throws_ok($$ insert into app.avisos_navegadores (pessoa_id, aparelho_id, permissao, rotulo)
                    values ('a0000000-0000-4000-8000-000000015204', 'b0000000-0000-4000-8000-0000000000ff',
                            'liberada', 'Chrome') $$,
                 '42501', null, 'gravar direto na tabela, nem para outra pessoa: recusado');
select throws_ok($$ select * from app.avisos_navegadores $$, '42501', null,
                 'ler a tabela direto: recusado');
select throws_ok($$ select public.avisos_registrar_navegador('b0000000-0000-4000-8000-000000000002',
                                                             'concedida', true, false, 'Chrome') $$,
                 '22023', null, 'permissão inventada: recusada');
select pg_temp.sair();

select pg_temp.entrar(null, 'sdr');
select throws_ok($$ select public.avisos_registrar_navegador('b0000000-0000-4000-8000-000000000003',
                                                             'liberada', true, false, 'Chrome') $$,
                 '42501', null, 'sem sessão: recusado');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000015208'::uuid, 'embaixador');
select throws_ok($$ select public.avisos_registrar_navegador('b0000000-0000-4000-8000-000000000004',
                                                             'liberada', true, false, 'Chrome') $$,
                 '42501', null, 'quem não atende (embaixador): recusado');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000015209'::uuid, 'sdr');
select throws_ok($$ select public.avisos_registrar_navegador('b0000000-0000-4000-8000-000000000005',
                                                             'liberada', true, false, 'Chrome') $$,
                 '42501', null, 'perfil inativo: recusado');
select pg_temp.sair();

select pg_temp.registrar('a0000000-0000-4000-8000-000000015203'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000006'::uuid, 'liberada', false, false,
         E'  Chrome\n\tno   Windows' || repeat(' muito comprido', 10));
select is((select rotulo from app.avisos_navegadores
            where aparelho_id = 'b0000000-0000-4000-8000-000000000006'::uuid),
          btrim(left('Chrome no Windows' || repeat(' muito comprido', 10), 60)),
          'o rótulo sai numa linha só, sem controle, com até 60 letras');
select pg_temp.registrar('a0000000-0000-4000-8000-000000015203'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000007'::uuid, 'sem_suporte', true, false, '   ');
select is((select rotulo from app.avisos_navegadores
            where aparelho_id = 'b0000000-0000-4000-8000-000000000007'::uuid),
          'Navegador', 'rótulo em branco vira "Navegador"');

-- ---------------------------------------------------------------------
-- 3. Uma vez por hora, 30 dias e o teto
-- ---------------------------------------------------------------------
update app.avisos_navegadores set visto_em = now() - interval '10 minutes'
 where aparelho_id = 'b0000000-0000-4000-8000-000000000001'::uuid
   and pessoa_id = 'a0000000-0000-4000-8000-000000015203'::uuid;
select pg_temp.registrar('a0000000-0000-4000-8000-000000015203'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000001'::uuid, 'liberada', true, false, 'Chrome no Mac');
select is((select visto_em from app.avisos_navegadores
            where aparelho_id = 'b0000000-0000-4000-8000-000000000001'::uuid
              and pessoa_id = 'a0000000-0000-4000-8000-000000015203'::uuid),
          now() - interval '10 minutes', 'o mesmo estado dentro da hora não regrava');

select pg_temp.registrar('a0000000-0000-4000-8000-000000015203'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000001'::uuid, 'liberada', false, false, 'Chrome no Mac');
select ok((select visto_em = now() and not som_ligado from app.avisos_navegadores
            where aparelho_id = 'b0000000-0000-4000-8000-000000000001'::uuid
              and pessoa_id = 'a0000000-0000-4000-8000-000000015203'::uuid),
          'estado novo (o som desligado) grava na hora');

update app.avisos_navegadores set visto_em = now() - interval '2 hours'
 where aparelho_id = 'b0000000-0000-4000-8000-000000000001'::uuid
   and pessoa_id = 'a0000000-0000-4000-8000-000000015203'::uuid;
select pg_temp.registrar('a0000000-0000-4000-8000-000000015203'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000001'::uuid, 'liberada', false, false, 'Chrome no Mac');
select is((select visto_em from app.avisos_navegadores
            where aparelho_id = 'b0000000-0000-4000-8000-000000000001'::uuid
              and pessoa_id = 'a0000000-0000-4000-8000-000000015203'::uuid),
          now(), 'o mesmo estado depois de uma hora renova o sinal');

-- Velhos e demais, gravados à mão para a pessoa 5205 (Duda), que só tem o da linha 2.
insert into app.avisos_navegadores (pessoa_id, aparelho_id, permissao, rotulo, visto_em)
select 'a0000000-0000-4000-8000-000000015205'::uuid, gen_random_uuid(), 'a_pedir', 'Velho', now() - interval '40 days';
insert into app.avisos_navegadores (pessoa_id, aparelho_id, permissao, rotulo, visto_em, criado_em)
select 'a0000000-0000-4000-8000-000000015205'::uuid, gen_random_uuid(), 'a_pedir', 'Demais ' || g,
       now() - make_interval(mins => g), now() - make_interval(mins => g)
  from generate_series(1, 24) g;
select pg_temp.registrar('a0000000-0000-4000-8000-000000015205'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000001'::uuid, 'bloqueada', true, false, 'Chrome no Mac');
select ok(not exists (select 1 from app.avisos_navegadores
                       where pessoa_id = 'a0000000-0000-4000-8000-000000015205'::uuid
                         and rotulo = 'Velho'),
          'o navegador sem sinal há mais de 30 dias é apagado ao registrar');
select is((select count(*) from app.avisos_navegadores
            where pessoa_id = 'a0000000-0000-4000-8000-000000015205'::uuid), 20::bigint,
          'cada pessoa guarda no máximo 20 navegadores');
select ok(exists (select 1 from app.avisos_navegadores
                   where pessoa_id = 'a0000000-0000-4000-8000-000000015205'::uuid
                     and aparelho_id = 'b0000000-0000-4000-8000-000000000001'::uuid
                     and permissao = 'bloqueada'),
          'o teto guarda o mais recente: o que acabou de registrar fica');
-- A Duda volta a não ter navegador nenhum, para o caso "nada" abaixo.
delete from app.avisos_navegadores where pessoa_id = 'a0000000-0000-4000-8000-000000015205'::uuid;

-- ---------------------------------------------------------------------
-- 4. A visão: só admin e gestor
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000015203'::uuid, 'sdr');
select throws_ok($$ select * from public.avisos_quem_recebe() $$, '42501', null,
                 'o SDR não vê quem recebe os avisos');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000015208'::uuid, 'embaixador');
select throws_ok($$ select * from public.avisos_quem_recebe() $$, '42501', null,
                 'o embaixador também não');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000015201'::uuid, 'admin');
select lives_ok($$ select * from public.avisos_quem_recebe() $$, 'o admin vê');
select pg_temp.sair();

-- Os casos:
--   Gil (gestor):  app no celular + Chrome com aviso       → celular e computador
--   Bia (SDR):     Chrome com aviso (o da seção 2)         → só computador
--   Caio (SDR):    app no celular                          → só celular
--   Duda (SDR):    nada                                    → nenhum
--   Edu (SDR):     Edge bloqueado + Firefox silenciado     → nenhum
--   Fábio (SDR):   Chrome com aviso há 31 dias; app com o aviso de mensagem desligado → nenhum
--   Ana (admin):   nada                                    → nenhum
insert into public.aparelhos_push (token, pessoa_id, plataforma, empresa, empresa_nome, visto_em) values
  ('ExponentPushToken[t152gestor000001]', 'a0000000-0000-4000-8000-000000015202', 'ios', 'imova', 'Imova Imobiliária', now() - interval '2 days'),
  ('ExponentPushToken[t152caio00000001]', 'a0000000-0000-4000-8000-000000015204', 'ios', 'imova', 'Imova Imobiliária', now() - interval '3 hours'),
  ('ExponentPushToken[t152caio00000002]', 'a0000000-0000-4000-8000-000000015204', 'android', 'imova', 'Imova Imobiliária', now() - interval '5 days'),
  ('ExponentPushToken[t152fabio0000001]', 'a0000000-0000-4000-8000-000000015207', 'ios', 'imova', 'Imova Imobiliária', now() - interval '1 day');
insert into public.avisos_desligados (pessoa_id, tipo) values ('a0000000-0000-4000-8000-000000015207', 'mensagem');

select pg_temp.registrar('a0000000-0000-4000-8000-000000015202'::uuid, 'gestor',
         'b0000000-0000-4000-8000-000000000010'::uuid, 'liberada', true, false, 'Chrome no Windows');
select pg_temp.registrar('a0000000-0000-4000-8000-000000015206'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000020'::uuid, 'bloqueada', true, false, 'Edge no Windows');
select pg_temp.registrar('a0000000-0000-4000-8000-000000015206'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000021'::uuid, 'liberada', true, true, 'Firefox no Linux');
update app.avisos_navegadores set visto_em = now() - interval '5 minutes'
 where aparelho_id = 'b0000000-0000-4000-8000-000000000020'::uuid;
select pg_temp.registrar('a0000000-0000-4000-8000-000000015207'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000030'::uuid, 'liberada', true, false, 'Chrome no Mac');
update app.avisos_navegadores set visto_em = now() - interval '31 days'
 where pessoa_id = 'a0000000-0000-4000-8000-000000015207'::uuid;

select pg_temp.ler_visao();

select ok(exists (select 1 from t152_visao where pessoa_id = 'a0000000-0000-4000-8000-000000015201'::uuid)
          and exists (select 1 from t152_visao where pessoa_id = 'a0000000-0000-4000-8000-000000015202'::uuid)
          and exists (select 1 from t152_visao where pessoa_id = 'a0000000-0000-4000-8000-000000015203'::uuid),
          'admin, gestor e SDR ativos aparecem');
select ok(not exists (select 1 from t152_visao
                       where pessoa_id in ('a0000000-0000-4000-8000-000000015208'::uuid,
                                           'a0000000-0000-4000-8000-000000015209'::uuid)),
          'o embaixador e o perfil inativo não aparecem');
select is((select count(*) from t152_visao), (select count(*) from app.avisos_quem_atende()),
          'uma linha por pessoa que atende');

-- ---------------------------------------------------------------------
-- 5. A situação de cada caso
-- ---------------------------------------------------------------------
select is(pg_temp.situacao('a0000000-0000-4000-8000-000000015202'::uuid), 'celular_e_computador',
          'app no celular e Chrome com aviso: recebe nos dois');
select is(pg_temp.situacao('a0000000-0000-4000-8000-000000015203'::uuid), 'so_computador',
          'só o navegador com aviso: só no computador');
select is(pg_temp.situacao('a0000000-0000-4000-8000-000000015204'::uuid), 'so_celular',
          'só o app: só no celular');
select is(pg_temp.situacao('a0000000-0000-4000-8000-000000015205'::uuid), 'nenhum',
          'nada: não recebe aviso nenhum');
select is(pg_temp.situacao('a0000000-0000-4000-8000-000000015206'::uuid), 'nenhum',
          'bloqueado e silenciado não contam como aviso ligado');
select is(pg_temp.situacao('a0000000-0000-4000-8000-000000015207'::uuid), 'nenhum',
          'navegador de 31 dias e app com o aviso de mensagem desligado: nenhum');

select is((select celular_aparelhos || '|' || (celular_visto_em = now() - interval '3 hours')
             from t152_visao where pessoa_id = 'a0000000-0000-4000-8000-000000015204'::uuid),
          '2|true', 'celular: quantos aparelhos e o último sinal');
select is((select computador_ligados || '|' || (computador_visto_em = now())
             from t152_visao where pessoa_id = 'a0000000-0000-4000-8000-000000015203'::uuid),
          '2|true', 'computador: quantos navegadores com aviso e o último sinal');
select is((select jsonb_array_length(navegadores) || '|' || computador_ligados
             from t152_visao where pessoa_id = 'a0000000-0000-4000-8000-000000015206'::uuid),
          '2|0', 'a lista mostra os navegadores do Edu, nenhum com aviso ligado');
select is((select navegadores -> 0 ->> 'rotulo' from t152_visao
            where pessoa_id = 'a0000000-0000-4000-8000-000000015206'::uuid),
          'Firefox no Linux', 'a lista vem do sinal mais recente para o mais antigo');
select is((select jsonb_array_length(navegadores) || '|' || (computador_visto_em = now() - interval '31 days')
             from t152_visao where pessoa_id = 'a0000000-0000-4000-8000-000000015207'::uuid),
          '0|true', 'o navegador velho sai da lista, e o último sinal continua dito');
select is((select celular_aparelhos || '|' || celular_mensagem_ligada
             from t152_visao where pessoa_id = 'a0000000-0000-4000-8000-000000015207'::uuid),
          '1|false', 'o app do Fábio está lá, com o aviso de mensagem nova desligado');
-- A ordem que a tela usa é a da função: quem não recebe nada vem primeiro.
select pg_temp.entrar('a0000000-0000-4000-8000-000000015202'::uuid, 'gestor');
select is((select situacao from public.avisos_quem_recebe() limit 1), 'nenhum',
          'quem não recebe aviso nenhum vem primeiro');
select pg_temp.sair();

-- A chave geral dos avisos no celular desligada: ninguém recebe no celular.
insert into public.app_settings (key, value) values ('avisos.push', '{"ativo": false}')
on conflict (key) do update set value = excluded.value;
select pg_temp.ler_visao();
select is(pg_temp.situacao('a0000000-0000-4000-8000-000000015204'::uuid), 'nenhum',
          'com avisos.push desligado, o só celular vira nenhum');
select is(pg_temp.situacao('a0000000-0000-4000-8000-000000015202'::uuid), 'so_computador',
          'com avisos.push desligado, quem tinha os dois fica só com o computador');
select is((select bool_and(not celular_push_ligado) from t152_visao), true,
          'a visão diz que a chave geral está desligada');

-- ---------------------------------------------------------------------
-- 6. KOMUNE e o comum intocado
-- ---------------------------------------------------------------------
select is((select count(*) from app.push_fila), (select fila from t152_base),
          'registrar e ler a visão não põem aviso nenhum na fila');
-- No banco da KOMUNE a migração não cria nada (conferido no banco de
-- validação da KOMUNE). Onde as funções existem com a identidade da KOMUNE
-- (o banco do CI), elas não gravam nem mostram ninguém.
select pg_temp.virar('komune');
select pg_temp.registrar('a0000000-0000-4000-8000-000000015205'::uuid, 'sdr',
         'b0000000-0000-4000-8000-000000000040'::uuid, 'liberada', true, false, 'Chrome no Mac');
select ok(not exists (select 1 from app.avisos_navegadores
                       where aparelho_id = 'b0000000-0000-4000-8000-000000000040'::uuid),
          'na KOMUNE o navegador não é registrado');
select pg_temp.entrar('a0000000-0000-4000-8000-000000015202'::uuid, 'gestor');
select is((select count(*) from public.avisos_quem_recebe()), 0::bigint,
          'na KOMUNE a visão não mostra ninguém');
select pg_temp.sair();
select pg_temp.virar('imova');

-- ---------------------------------------------------------------------
-- 7. Privilégios
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.avisos_registrar_navegador(uuid, text, boolean, boolean, text)', 'execute')
          and not has_function_privilege('anon', 'public.avisos_quem_recebe()', 'execute'),
          'anônimo não executa nenhuma das duas');
select ok(has_function_privilege('authenticated', 'public.avisos_registrar_navegador(uuid, text, boolean, boolean, text)', 'execute')
          and has_function_privilege('authenticated', 'public.avisos_quem_recebe()', 'execute'),
          'logado executa as duas (a regra de quem pode está dentro delas)');
select ok((select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig))
             from pg_proc p
            where p.oid in ('public.avisos_registrar_navegador(uuid, text, boolean, boolean, text)'::regprocedure,
                            'public.avisos_quem_recebe()'::regprocedure)),
          'as duas são security definer com search_path vazio');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — A IA que atende procura no mapa o lugar que o cliente citou
-- (migração 20261123150000)
--
-- Só na Imova. Prova:
--   1. O cache tem RLS e ninguém logado o lê; as portas são só do worker
--      (`service_role`).
--   2. O CACHE: a chave ignora acento, caixa e espaço; até 3 resultados; "não achado"
--      grava lista vazia e vale 30 dias, achado 180; o vencido não volta; consulta
--      vazia é recusada.
--   3. OS IMÓVEIS NO MAPA: os mesmos que a IA conhece, com o pino do anúncio quando há
--      e o endereço inteiro para o worker achar o pino que falta; anúncio excluído sai.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(14);

insert into public.allowed_users (email, role, note) values
  ('h197.g@teste.local', 'gestor', 'pgTAP 197');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000019701'::uuid, 'h197.g@teste.local', '{"full_name":"Gil Gestor"}');

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

-- Três anúncios: um com pino (o terreno da praia), um sem e um excluído.
insert into public.anuncios (codigo, situacao, titulo, tipo, negocio, preco_venda, bairro, cidade, estado,
                             endereco, cep, latitude, longitude)
values ('TST197A_IMOVA', 'no_ar', 'Terreno frente-mar', 'terreno', 'venda', 520000, 'Praia de Tabatinga',
        'Nísia Floresta', 'RN', 'Rua Barra de Tabatinga', '59164000', -6.06896, -35.09864),
       ('TST197B_IMOVA', 'rascunho', 'Casa', 'casa', 'venda', 300000, 'Potengi', 'Natal', 'RN',
        'Rua Barra do Piraí, 2350', '59112210', null, null),
       ('TST197C_IMOVA', 'no_ar', 'Excluído', 'casa', 'venda', 100000, 'Tirol', 'Natal', 'RN',
        'Rua C', null, -5.8, -35.2);
update public.anuncios set excluido_em = now(), motivo_exclusao = 'pgTAP 197' where codigo = 'TST197C_IMOVA';

-- ---------------------------------------------------------------------
-- 1. RLS e portas
-- ---------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.ia_lugares_no_mapa'::regclass),
          'o cache nasce com RLS');
select ok(not has_function_privilege('authenticated', 'public.ia_lugar_no_mapa_gravar(text, jsonb, text)', 'execute')
          and not has_function_privilege('anon', 'public.ia_lugar_no_mapa_ler(text)', 'execute')
          and not has_function_privilege('authenticated', 'public.ia_imoveis_no_mapa()', 'execute'),
          'as portas são só do worker: ninguém logado nem anônimo usa');
select ok(has_function_privilege('service_role', 'public.ia_imoveis_no_mapa()', 'execute')
          and has_function_privilege('service_role', 'public.ia_lugar_no_mapa_ler(text)', 'execute')
          and has_function_privilege('service_role', 'public.ia_lugar_no_mapa_gravar(text, jsonb, text)', 'execute'),
          'o worker (service_role) usa as portas');

-- ---------------------------------------------------------------------
-- 2. O cache
-- ---------------------------------------------------------------------
select is(public.ia_lugar_no_mapa_gravar('Avenida Praia de Camurupim, Nísia Floresta, RN',
            '[{"nome":"Avenida Praia de Camurupim","tipo":"road","nivel":"ponto","bairro":"Camurupim",
               "cidade":"Nísia Floresta","lat":-6.08967,"lng":-35.1004}]'::jsonb, 'ODbL') ->> 'resultados', '1',
          'o mapa grava o lugar achado');
select is((public.ia_lugar_no_mapa_ler('  avenida praia de CAMURUPIM,  nisia floresta, rn') -> 0 ->> 'bairro'),
          'Camurupim', 'a chave ignora acento, caixa e espaço');
select ok((select l.expira_em > now() + interval '170 days' from public.ia_lugares_no_mapa l
            where l.consulta = app.ia_chave_do_lugar('Avenida Praia de Camurupim, Nísia Floresta, RN')),
          'achado vale 180 dias');
select is(public.ia_lugar_no_mapa_gravar('Camurupim, RN',
            '[{"nome":"a"},{"nome":"b"},{"nome":"c"},{"nome":"d"}]'::jsonb, null) ->> 'resultados', '3',
          'mais de três resultados ficam os três primeiros');
select public.ia_lugar_no_mapa_gravar('Condomínio Serv Club, Nísia Floresta, RN', '[]'::jsonb, 'ODbL');
select ok((select l.expira_em <= l.buscado_em + interval '30 days' and jsonb_array_length(l.resultados) = 0
             from public.ia_lugares_no_mapa l
            where l.consulta = app.ia_chave_do_lugar('Condomínio Serv Club, Nísia Floresta, RN')),
          '"não achado" grava lista vazia e vale só 30 dias');
update public.ia_lugares_no_mapa set expira_em = now() - interval '1 minute'
 where consulta = app.ia_chave_do_lugar('Condomínio Serv Club, Nísia Floresta, RN');
select ok(public.ia_lugar_no_mapa_ler('Condomínio Serv Club, Nísia Floresta, RN') is null,
          'o que venceu não volta: a pergunta é feita de novo');
select is(public.ia_lugar_no_mapa_gravar('   ', '[]'::jsonb, null) ->> 'motivo', 'consulta_invalida',
          'consulta vazia é recusada');

select pg_temp.entrar('a0000000-0000-4000-8000-000000019701'::uuid, 'gestor');
select is((select count(*)::int from public.ia_lugares_no_mapa), 0, 'o cache ninguém logado lê, nem o gestor');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 3. Os imóveis no mapa
-- ---------------------------------------------------------------------
select ok((select i.latitude = -6.06896 and i.longitude = -35.09864 and i.cidade = 'Nísia Floresta'
                  and i.cep = '59164000' and i.tipo = 'terreno'
             from public.ia_imoveis_no_mapa() i where i.codigo = 'TST197A_IMOVA'),
          'o anúncio com pino vem com o pino e o CEP');
select ok((select i.latitude is null and i.endereco = 'Rua Barra do Piraí, 2350'
             from public.ia_imoveis_no_mapa() i where i.codigo = 'TST197B_IMOVA'),
          'o sem pino vem com o endereço inteiro, para o worker achar o pino');
select ok(not exists (select 1 from public.ia_imoveis_no_mapa() i where i.codigo = 'TST197C_IMOVA'),
          'o excluído não vem');

select * from finish();
rollback;

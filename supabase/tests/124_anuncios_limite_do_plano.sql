-- =====================================================================
-- pgTAP — O limite do plano do Canal Pro e o que o validador recusou (migração 20261104180000)
--
-- O plano da Imova publica 10 anúncios, 2 com destaque; o que passar fica de
-- fora no Canal Pro sem aviso no CRM. Este arquivo prova:
--
--   1. A VAGA: o anúncio do CRM não vai ao ar com o plano cheio, e os manuais
--      do Canal Pro contam junto;
--   2. O DESTAQUE: não vai ao ar com destaque quando os do plano estão em uso;
--      no ar, não ganha destaque; no rascunho, escolhe à vontade; trocar um
--      destaque por outro no mesmo anúncio não gasta vaga nova;
--   3. O PLANO É DA GESTÃO: só admin e gestor mudam o limite, os números
--      precisam fechar, e vazio quer dizer que o CRM não confere;
--   4. O VALIDADOR: o destaque triplo não existe mais e o loft vai como
--      apartamento.
--
-- Os limites do teste partem do que o banco já tem no ar, para valer em
-- qualquer banco. Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(30);

insert into public.allowed_users (email, role, note) values
  ('a124.g@teste.local', 'gestor', 'pgTAP limite do plano'),
  ('a124.s@teste.local', 'sdr', 'pgTAP limite do plano');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000012401'::uuid, 'a124.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000012402'::uuid, 'a124.s@teste.local', '{"full_name":"Sol SDR"}');

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
create function pg_temp.gestor() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012401'::uuid, 'gestor')
$$;
create function pg_temp.sdr() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000012402'::uuid, 'sdr')
$$;

-- Dois anúncios prontos para ir ao ar (sem pendência), A e B.
create temp table t124(chave text primary key, valor uuid);
grant select on t124 to authenticated;
create function pg_temp.anuncio(p_chave text) returns uuid language sql stable as $$
  select valor from t124 where chave = p_chave
$$;
create function pg_temp.novo(p_chave text) returns void language plpgsql as $$
declare v_id uuid;
begin
  insert into public.anuncios (titulo, descricao, tipo, negocio, preco_venda, area_util, quartos,
                               banheiros, cep, estado, cidade, bairro)
  values ('Apartamento de 3 quartos em Ponta Negra',
          'Apartamento nascente, perto da praia, com varanda gourmet e duas vagas.',
          'apartamento', 'venda', 450000, 90, 3, 2, '59090000', 'RN', 'Natal', 'Ponta Negra')
  returning id into v_id;
  insert into public.anuncio_fotos (anuncio_id, caminho, posicao)
  select v_id, v_id::text || '/' || gen_random_uuid()::text || '.jpg', n from generate_series(0, 4) n;
  insert into t124 values (p_chave, v_id);
end $$;
create function pg_temp.campo(p_chave text, p_campo text) returns text language sql stable as $$
  select to_jsonb(a) ->> p_campo from public.anuncios a where a.id = pg_temp.anuncio(p_chave)
$$;
create function pg_temp.plano(p_campo text) returns int language sql stable as $$
  select (public.canal_pro_situacao() -> 'plano' ->> p_campo)::int
$$;

update public.canal_pro set nome = 'Imova Imobiliária', email = 'contato@imova.teste' where um;
select pg_temp.novo('A');
select pg_temp.novo('B');
-- Uma vaga e um destaque livres, a partir do que o banco já tem no ar.
update public.canal_pro c
   set limite_anuncios = o.anuncios + 1, limite_destaques = o.destaques + 1
  from app.canal_pro_ocupadas() o
 where c.um;
select set_config('t124.vagas', (select limite_anuncios from public.canal_pro)::text, true);
select set_config('t124.destaques', (select limite_destaques from public.canal_pro)::text, true);

-- =====================================================================
-- 0. O que a migração criou
-- =====================================================================
select has_column('public', 'canal_pro', 'limite_anuncios', 'o plano guarda quantos anúncios publica');
select has_column('public', 'canal_pro', 'limite_destaques', 'e quantos com destaque');
select ok(app.anuncio_pendencias(pg_temp.anuncio('A')) = '{}'::text[], 'o anúncio A está pronto para ir ao ar');

-- =====================================================================
-- 1. A vaga
-- =====================================================================
select pg_temp.gestor();
select is(public.anuncio_publicar(pg_temp.anuncio('A')) ->> 'ok', 'true', 'A pega a última vaga');
select is(public.anuncio_publicar(pg_temp.anuncio('B')) ->> 'motivo', 'plano_cheio',
  'com o plano cheio, B não vai ao ar');
select is(pg_temp.plano('anuncios_em_uso'), current_setting('t124.vagas')::int,
  'o painel conta o plano cheio');
select pg_temp.sair();
select is(pg_temp.campo('B', 'situacao'), 'rascunho', 'e B continua rascunho');

select pg_temp.gestor();
select is(public.anuncio_tirar_do_ar(pg_temp.anuncio('A')) ->> 'ok', 'true', 'A sai do ar');
select is(public.anuncio_publicar(pg_temp.anuncio('B')) ->> 'ok', 'true', 'e a vaga dele serve a B');
select pg_temp.sair();

-- O manual do Canal Pro ocupa vaga e, com destaque escrito no relatório, destaque.
insert into public.anuncios_no_canal_pro (codigo, titulo, destaque)
values ('T124-MANUAL', 'Casa cadastrada à mão', 'Destaque padrão');
select pg_temp.gestor();
select is(pg_temp.plano('anuncios_em_uso'), current_setting('t124.vagas')::int + 1,
  'o manual do Canal Pro conta como vaga');
select is(pg_temp.plano('destaques_em_uso'), current_setting('t124.destaques')::int,
  'e "Destaque padrão" no relatório conta como destaque (o último livre)');
select pg_temp.sair();
select is(app.canal_pro_destaque_do_relatorio('Padrão'), false, '"Padrão" no relatório não é destaque');
select is(app.canal_pro_destaque_do_relatorio('Super Destaque'), true, '"Super Destaque" é');
select is(app.canal_pro_destaque_do_relatorio('Sem destaque'), false, '"Sem destaque" não é');
update public.anuncios_no_canal_pro set excluido_em = now() where codigo = 'T124-MANUAL';

-- =====================================================================
-- 2. O destaque
-- =====================================================================
select pg_temp.gestor();
select is(public.anuncio_destaque(pg_temp.anuncio('B'), 'destaque') ->> 'ok', 'true',
  'B, no ar, pega o último destaque');
select is(public.anuncio_destaque(pg_temp.anuncio('B'), 'super_destaque') ->> 'ok', 'true',
  'trocar o destaque de B por outro não gasta vaga nova');
select is(public.anuncio_destaque(pg_temp.anuncio('A'), 'destaque') ->> 'ok', 'true',
  'A, fora do ar, escolhe destaque à vontade');
select is(public.canal_pro_ajustar_plano(current_setting('t124.vagas')::int + 1,
                                         current_setting('t124.destaques')::int) ->> 'ok', 'true',
  'a gestão aumenta as vagas do plano');
select is(public.anuncio_publicar(pg_temp.anuncio('A')) ->> 'motivo', 'plano_sem_destaque',
  'com os destaques em uso, A não vai ao ar com destaque');
select is(public.anuncio_destaque(pg_temp.anuncio('A'), 'padrao') ->> 'ok', 'true', 'A volta a Padrão');
select is(public.anuncio_publicar(pg_temp.anuncio('A')) ->> 'ok', 'true', 'e vai ao ar');
select is(public.anuncio_destaque(pg_temp.anuncio('A'), 'destaque') ->> 'motivo', 'plano_sem_destaque',
  'no ar, A não ganha destaque com os do plano em uso');
select pg_temp.sair();
select is(pg_temp.campo('A', 'destaque'), 'padrao', 'e continua Padrão');

-- =====================================================================
-- 3. O plano é da gestão
-- =====================================================================
select pg_temp.sdr();
select is(public.canal_pro_ajustar_plano(50, 5) ->> 'motivo', 'sem_permissao',
  'o SDR não muda o plano');
select pg_temp.gestor();
select is(public.canal_pro_ajustar_plano(2, 3) ->> 'motivo', 'plano_invalido',
  'mais destaques que anúncios não fecha');
select is(public.canal_pro_ajustar_plano(null, null) ->> 'ok', 'true', 'vazio: o CRM não confere');
select is(public.anuncio_destaque(pg_temp.anuncio('A'), 'destaque') ->> 'ok', 'true',
  'e, sem limite, o destaque passa');
select pg_temp.sair();
select ok(exists (select 1 from public.audit_log
                   where table_name = 'canal_pro' and row_id = 'plano'
                     and actor_id = 'a0000000-0000-4000-8000-000000012401'::uuid),
  'a mudança do plano fica na auditoria');

-- =====================================================================
-- 4. O que o validador recusou
-- =====================================================================
select pg_temp.gestor();
select is(public.anuncio_destaque(pg_temp.anuncio('A'), 'triplo') ->> 'motivo', 'destaque_invalido',
  'o destaque triplo (TRIPLE) não existe mais');
select pg_temp.sair();
select is((select vrsync from app.anuncio_tipo('loft')), 'Residential / Apartment',
  'o loft vai ao portal como apartamento');

select * from finish();
rollback;

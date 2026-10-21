-- =====================================================================
-- pgTAP — O banco escreve o nome da empresa dele
--         (migração 20261022100000_o_banco_escreve_o_nome_da_empresa.sql)
--
--   1. sem `app_settings['empresa']`, os textos são os de sempre da KOMUNE
--      (o arquivo da LGPD do banco da KOMUNE não muda);
--   2. com a linha da Imova, o arquivo da LGPD diz Imova, o e-mail dela, e não
--      lista a "Plataforma Komune" entre quem recebe os dados.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(9);

delete from public.app_settings where key = 'empresa';

insert into public.organizations (name, source_id, collector)
values ('Parceiro do teste do dossiê', (select min(id) from public.sources), 'teste local');

create function pg_temp.dossie() returns jsonb language sql as $$
  select app.lgpd_dossie((select id from public.organizations where name = 'Parceiro do teste do dossiê'))
$$;
create function pg_temp.quem_recebe() returns text[] language sql as $$
  select array_agg(x ->> 'quem') from jsonb_array_elements(pg_temp.dossie() -> 'compartilhado_com') x
$$;

-- 1. Sem a linha: KOMUNE, como sempre foi.
select is(app.empresa_texto('controlador'), 'KOMUNE', 'sem a linha, o controlador é a KOMUNE');
select is(pg_temp.dossie() -> 'controlador' ->> 'canal_do_titular', 'privacidade@komune.app.br',
          'sem a linha, o canal do titular é o da KOMUNE');
select ok('Plataforma Komune' = any (pg_temp.quem_recebe()), 'sem a linha, a Plataforma Komune está na lista');
select ok(pg_temp.dossie() ->> 'direitos' like '%privacidade@komune.app.br.', 'o texto dos direitos termina como antes');

-- 2. Com a linha da Imova.
insert into public.app_settings (key, value) values
  ('empresa', '{"nome": "Imova Imobiliária", "controlador": "Imova Imobiliária",
                "email_privacidade": "contato@imovaimobiliaria.com.br", "plataforma": null}');

select is(pg_temp.dossie() -> 'controlador' ->> 'nome', 'Imova Imobiliária', 'o controlador é a Imova');
select is(pg_temp.dossie() -> 'controlador' ->> 'canal_do_titular', 'contato@imovaimobiliaria.com.br',
          'o canal do titular é o da Imova');
select ok(not ('Plataforma Komune' = any (pg_temp.quem_recebe())), 'a Plataforma Komune some da lista');
select is(cardinality(pg_temp.quem_recebe()), 3, 'ficam Meta, Supabase e Anthropic');
select ok(pg_temp.dossie() ->> 'direitos' not like '%komune%', 'o texto dos direitos não cita a KOMUNE');

select * from finish();
rollback;

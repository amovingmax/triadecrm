-- =====================================================================
-- pgTAP — O caminho até o primeiro lead dos portais (migração 20261111203000), só na Imova
--
-- Gargalo "Entra pouco lead" (11/11/2026). Este arquivo prova:
--
--   1. O PLANO CHEIO QUE NÃO ERA: com o plano cheio pelo sistema anterior, o
--      anúncio do CRM que tem a linha ativa no relatório (mesmo código, ou
--      trazido dela) vai ao ar, porque só ocupa a própria vaga (e o próprio
--      destaque); o anúncio novo continua recusado com `plano_cheio`;
--   2. O ESTADO DE CADA PASSO, como `anuncios_caminho_do_lead` devolve:
--        a. o arquivo: sem leitura; a leitura do robô (VivaRealBot) e a de outro
--           programa;
--        b. os anúncios: no ar, no arquivo, prontos (com `ocupa_vaga`), com
--           pendência e NO AR FORA DO ARQUIVO (o arquivo de verdade o pula);
--        c. o relatório: quando foi importado e os repetidos ativos e inativos;
--           o repetido marcado como excluído sai da conta;
--        d. os leads: nenhum, e depois o último que chegou;
--   3. QUEM VÊ: admin e gestor; o SDR recebe só `sem_permissao`;
--   4. OS PRIVILÉGIOS: a função é definer com search_path vazio, só lê, e o
--      anônimo não a executa; a conta das vagas segue fechada a quem está logado.
--
-- O banco começa vazio para o caminho (anúncios excluídos, relatório, leituras e
-- leads apagados) e tudo é desfeito no fim. Na KOMUNE a migração não cria nada:
-- conferido à parte, no contêiner de validação.
-- =====================================================================
begin;
select plan(49);

insert into public.allowed_users (email, role, note) values
  ('a153.a@teste.local', 'admin', 'pgTAP caminho do lead'),
  ('a153.g@teste.local', 'gestor', 'pgTAP caminho do lead'),
  ('a153.s@teste.local', 'sdr', 'pgTAP caminho do lead');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000015301'::uuid, 'a153.a@teste.local', '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000015302'::uuid, 'a153.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000015303'::uuid, 'a153.s@teste.local', '{"full_name":"Sol SDR"}');

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
create function pg_temp.admin() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000015301'::uuid, 'admin') $$;
create function pg_temp.gestor() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000015302'::uuid, 'gestor') $$;
create function pg_temp.sdr() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000015303'::uuid, 'sdr') $$;
-- A empresa do banco (no CI ele nasce sem identidade).
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

-- Os anúncios do teste, pelo apelido.
create temp table t153(chave text primary key, valor uuid);
grant select on t153 to authenticated;
create function pg_temp.anuncio(p_chave text) returns uuid language sql stable as $$
  select valor from t153 where chave = p_chave
$$;
grant execute on function pg_temp.anuncio(text) to authenticated;
-- Um terreno pronto para ir ao ar (sem pendência), com o código e a área dados.
-- `p_fotos` = 0 deixa a pendência "pelo menos 1 foto".
create function pg_temp.novo(p_chave text, p_codigo text, p_area int, p_fotos int,
                             p_destaque text default 'padrao') returns void language plpgsql as $$
declare v_id uuid;
begin
  insert into public.anuncios (codigo, titulo, descricao, tipo, negocio, preco_venda, area_total,
                               cep, estado, cidade, bairro, destaque, origem)
  values (p_codigo, 'Terreno ' || p_codigo || ' em Parnamirim',
          'Terreno plano, escriturado, com frente para avenida de alto fluxo e documentação em dia.',
          'terreno', 'venda', 300000, p_area, '59140000', 'RN', 'Cidade T153', 'Bairro T153',
          p_destaque, 'sistema_atual')
  returning id into v_id;
  insert into public.anuncio_fotos (anuncio_id, caminho, posicao)
  select v_id, v_id::text || '/' || gen_random_uuid()::text || '.jpg', n
    from generate_series(0, p_fotos - 1) n;
  insert into t153 values (p_chave, v_id);
end $$;
-- O caminho como a tela lê, com o papel dado.
create temp table t153_c(papel text primary key, r jsonb);
grant insert, update, select on t153_c to authenticated;
create function pg_temp.ler(p_papel text) returns void language plpgsql as $$
begin
  if p_papel = 'admin' then perform pg_temp.admin();
  elsif p_papel = 'sdr' then perform pg_temp.sdr();
  else perform pg_temp.gestor();
  end if;
  insert into t153_c values (p_papel, public.anuncios_caminho_do_lead())
  on conflict (papel) do update set r = excluded.r;
  perform pg_temp.sair();
end $$;
create function pg_temp.c(p_caminho text[]) returns jsonb language sql stable as $$
  select r #> p_caminho from t153_c where papel = 'gestor'
$$;
create function pg_temp.codigos(p_caminho text[]) returns text language sql stable as $$
  select coalesce(string_agg(e ->> 'codigo', ',' order by ordem), '')
    from t153_c, jsonb_array_elements(r #> p_caminho) with ordinality x(e, ordem)
   where papel = 'gestor'
$$;
-- Para onde vai o retorno das chamadas que não são asserção.
create temp table lixo(v jsonb);
grant insert on lixo to authenticated, service_role;

select pg_temp.virar('imova');

-- O banco começa vazio para o caminho.
update public.anuncios set excluido_em = now(), motivo_exclusao = 'pgTAP 153' where excluido_em is null;
update public.anuncios_no_canal_pro set no_relatorio = false where no_relatorio;
delete from public.canal_pro_leituras;
delete from public.portal_leads;
update public.canal_pro
   set nome = 'Imova Imobiliária', email = 'contato@imova.teste',
       limite_anuncios = 3, limite_destaques = 1, importado_em = null
 where um;

-- ---------------------------------------------------------------------
-- 0. O caminho vazio: nada lido, nada no ar, nenhum relatório, nenhum lead
-- ---------------------------------------------------------------------
select pg_temp.ler('gestor');
select is(pg_temp.c('{ok}'), 'true'::jsonb, 'o gestor lê o caminho');
select ok(pg_temp.c('{arquivo,leitura_do_robo}') = 'null'::jsonb
          and pg_temp.c('{arquivo,outra_leitura}') = 'null'::jsonb,
          'a. ninguém leu o arquivo');
select is(pg_temp.c('{anuncios,no_ar}'), '0'::jsonb, 'b. nenhum anúncio no ar');
select is(pg_temp.c('{relatorio,importado_em}'), 'null'::jsonb, 'c. nenhum relatório importado');
select ok(pg_temp.c('{leads,ultimo}') = 'null'::jsonb and pg_temp.c('{leads,total}') = '0'::jsonb,
          'd. nenhum lead');

-- ---------------------------------------------------------------------
-- O cenário: dois anúncios da Arbo prontos (A e B, B com destaque), um novo
-- pronto (C), um sem foto (E), e o relatório com A e B ativos, uma cópia antiga
-- ativa de A e uma inativa de B. Plano de 3 vagas e 1 destaque: cheio.
-- ---------------------------------------------------------------------
select pg_temp.novo('A', 'T153A', 1531, 2);
select pg_temp.novo('B', 'T153B', 1532, 2, 'destaque');
select pg_temp.novo('C', 'T153C', 1533, 1);
select pg_temp.novo('E', 'T153E', 1535, 0);

select pg_temp.gestor();
insert into lixo select public.canal_pro_importar(jsonb_build_array(
  jsonb_build_object('codigo', 'T153A', 'titulo', 'Terreno A', 'tipo_crm', 'terreno', 'area', 1531,
                     'cidade', 'Cidade T153', 'bairro', 'Bairro T153', 'situacao', 'Ativo', 'destaque', 'Padrão'),
  jsonb_build_object('codigo', 'T153B', 'titulo', 'Terreno B', 'tipo_crm', 'terreno', 'area', 1532,
                     'cidade', 'Cidade T153', 'bairro', 'Bairro T153', 'situacao', 'Ativo', 'destaque', 'Destaque'),
  jsonb_build_object('codigo', 'Copia T153A', 'titulo', 'Terreno A (antigo)', 'tipo_crm', 'terreno', 'area', 1531,
                     'cidade', 'Cidade T153', 'bairro', 'Bairro T153', 'situacao', 'Ativo', 'destaque', 'Padrão'),
  jsonb_build_object('codigo', 'Copia T153B', 'titulo', 'Terreno B (antigo)', 'tipo_crm', 'terreno', 'area', 1532,
                     'cidade', 'Cidade T153', 'bairro', 'Bairro T153', 'situacao', 'Inativo', 'destaque', 'Padrão')));
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 1. O plano cheio que não era
-- ---------------------------------------------------------------------
select is((select o.anuncios from app.canal_pro_ocupadas() o), 3,
          'o plano está cheio pelo relatório: A, B e a cópia de A');
select is((select o.anuncios from app.canal_pro_ocupadas(pg_temp.anuncio('A')) o), 2,
          'sem A, a linha de A no relatório também sai da conta');
select is((select o.destaques from app.canal_pro_ocupadas(pg_temp.anuncio('B')) o), 0,
          'sem B, o destaque da linha de B também sai da conta');

-- Trazido de uma linha com outro código: a linha ligada por anuncio_id é a vaga dele.
insert into public.anuncios_no_canal_pro (codigo, titulo, situacao, anuncio_id)
values ('T153-ORIGINAL-E', 'Original de E', 'Ativo', pg_temp.anuncio('E'));
select is((select o.anuncios from app.canal_pro_ocupadas(pg_temp.anuncio('E')) o), 3,
          'sem E, a linha trazida para E (outro código) também sai da conta');
delete from public.anuncios_no_canal_pro where codigo = 'T153-ORIGINAL-E';

select pg_temp.ler('gestor');
select is(pg_temp.c('{plano,anuncios_em_uso}'), '3'::jsonb, 'b. o caminho mostra 3 de 3 vagas');
select is(pg_temp.codigos('{anuncios,prontos}'), 'T153A,T153B,T153C',
          'b. prontos: A, B e C, primeiro os que já ocupam vaga');
select is((select string_agg((e ->> 'ocupa_vaga'), ',' order by e ->> 'codigo')
             from jsonb_array_elements(pg_temp.c('{anuncios,prontos}')) e),
          'true,true,false', 'b. A e B já ocupam vaga pelo relatório; C não');
select is(pg_temp.codigos('{anuncios,com_pendencia}'), 'T153E', 'b. com pendência: E');
select is(pg_temp.c('{anuncios,com_pendencia,0,pendencias}'), '["pelo menos 1 foto"]'::jsonb,
          'b. e o que falta a E');
select ok(pg_temp.c('{relatorio,importado_em}') <> 'null'::jsonb, 'c. o relatório foi importado');
select is(pg_temp.codigos('{relatorio,repetidos_ativos}'), 'Copia T153A', 'c. um repetido ocupa vaga');
select is(pg_temp.c('{relatorio,repetidos_ativos,0,copia_de}'), '"T153A"'::jsonb,
          'c. e ele é cópia de T153A');
select is(pg_temp.c('{relatorio,repetidos_inativos}'), '1'::jsonb, 'c. e um repetido inativo não ocupa');

select pg_temp.gestor();
select is(public.anuncio_publicar(pg_temp.anuncio('A')) ->> 'ok', 'true',
          'com o plano cheio, A vai ao ar: só ocupa a própria vaga');
select is(public.anuncio_publicar(pg_temp.anuncio('B')) ->> 'ok', 'true',
          'B vai ao ar com destaque: só ocupa a própria vaga e o próprio destaque');
select is(public.anuncio_publicar(pg_temp.anuncio('C')) ->> 'motivo', 'plano_cheio',
          'C, que não está no portal, continua recusado: o plano está cheio de verdade');
select pg_temp.sair();
select is((select o.anuncios from app.canal_pro_ocupadas() o), 3, 'A e B no ar contam uma vez cada');
select is((select o.destaques from app.canal_pro_ocupadas() o), 1, 'e o destaque de B conta uma vez');

-- ---------------------------------------------------------------------
-- 2. O estado de cada passo depois de pôr no ar
-- ---------------------------------------------------------------------
select pg_temp.ler('gestor');
select ok(pg_temp.c('{anuncios,no_ar}') = '2'::jsonb and pg_temp.c('{anuncios,no_arquivo}') = '2'::jsonb,
          'b. dois no ar e dois no arquivo');
select is(pg_temp.codigos('{anuncios,prontos}'), 'T153C', 'b. sobra C pronto');
select is(pg_temp.c('{anuncios,fora_do_arquivo}'), '[]'::jsonb, 'b. nenhum no ar fora do arquivo');

-- B perde a última foto no ar (por fora das funções): o arquivo o pula calado.
delete from public.anuncio_fotos where anuncio_id = pg_temp.anuncio('B');
create temp table t153_feed as
  select public.canal_pro_feed((select chave from public.canal_pro), 'Mozilla/5.0 (compatible; VivaRealBot/2.0)') as r;
select is((select string_agg(e ->> 'codigo', ',') from t153_feed, jsonb_array_elements(r -> 'anuncios') e),
          'T153A', 'o arquivo de verdade leva só A: B no ar com pendência fica de fora');
insert into lixo select public.canal_pro_feed((select chave from public.canal_pro), 'curl/8.7.1');

select pg_temp.ler('gestor');
select is(pg_temp.codigos('{anuncios,fora_do_arquivo}'), 'T153B', 'b. B está no ar no CRM, mas fora do arquivo');
select is(pg_temp.c('{anuncios,fora_do_arquivo,0,pendencias}'), '["pelo menos 1 foto"]'::jsonb,
          'b. e o caminho diz o que falta');
select ok(pg_temp.c('{anuncios,no_ar}') = '2'::jsonb and pg_temp.c('{anuncios,no_arquivo}') = '1'::jsonb,
          'b. dois no ar, um no arquivo');
select is(pg_temp.c('{arquivo,leitura_do_robo,anuncios}'), '1'::jsonb,
          'a. a leitura do robô (VivaRealBot) aparece, com 1 anúncio');
select is(pg_temp.c('{arquivo,leituras_do_robo_7_dias}'), '1'::jsonb, 'a. uma leitura do robô em 7 dias');
select is(pg_temp.c('{arquivo,outra_leitura,quem}'), '"curl/8.7.1"'::jsonb,
          'a. a leitura de outro programa aparece à parte, com o nome dele');

-- O repetido marcado como excluído sai do passo c e libera a vaga.
select pg_temp.gestor();
insert into lixo select public.canal_pro_marcar_excluido(
  (select id from public.anuncios_no_canal_pro where codigo = 'Copia T153A'), true);
select pg_temp.sair();
select pg_temp.ler('gestor');
select is(pg_temp.c('{relatorio,repetidos_ativos}'), '[]'::jsonb, 'c. marcado como excluído, o repetido sai');
select is(pg_temp.c('{plano,anuncios_em_uso}'), '2'::jsonb, 'c. e a vaga volta: 2 de 3');

-- O primeiro lead chega pelo webhook.
set local role service_role;
insert into lixo select public.grupozap_lead_receber('t153-lead',
  jsonb_build_object('leadOrigin', 'Grupo OLX', 'originLeadId', 't153-lead',
                     'originListingId', '2790000153', 'clientListingId', 'T153A',
                     'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'),
                     'name', 'Lia Lead', 'phone', '84981530001', 'message', '',
                     'extraData', jsonb_build_object('leadType', 'CLICK_WHATSAPP')));
reset role;
select pg_temp.ler('gestor');
select is(pg_temp.c('{leads,total}'), '1'::jsonb, 'd. um lead chegou');
select is(pg_temp.c('{leads,ultimo,anuncio}'), '"T153A"'::jsonb, 'd. o último lead diz de que anúncio veio');
select is(pg_temp.c('{leads,ultimo,tipos}'), '["CLICK_WHATSAPP"]'::jsonb, 'd. e o que a pessoa fez');
select ok(pg_temp.c('{leads,ultimo,id}') = to_jsonb((select id from public.portal_leads where origin_lead_id = 't153-lead')),
          'd. e o id, para abrir a ficha do lead');

-- ---------------------------------------------------------------------
-- 3. Quem vê
-- ---------------------------------------------------------------------
select pg_temp.ler('admin');
select is((select r -> 'ok' from t153_c where papel = 'admin'), 'true'::jsonb, 'o admin lê o caminho');
select ok((select r -> 'plano' from t153_c where papel = 'admin') = pg_temp.c('{plano}'),
          'e vê o mesmo que o gestor');
select pg_temp.ler('sdr');
select is((select r from t153_c where papel = 'sdr'), '{"ok": false, "motivo": "sem_permissao"}'::jsonb,
          'o SDR recebe só sem_permissao, sem nenhum dado');
select is(public.anuncios_caminho_do_lead() ->> 'motivo', 'sem_permissao',
          'sem login (sem papel), também sem_permissao');

-- ---------------------------------------------------------------------
-- 4. Os privilégios
-- ---------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.anuncios_caminho_do_lead()', 'execute'),
          'quem está logado chama o caminho (a função confere o papel)');
select ok(not has_function_privilege('anon', 'public.anuncios_caminho_do_lead()', 'execute'),
          'o anônimo não chama o caminho');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
             from pg_proc p where p.oid = 'public.anuncios_caminho_do_lead()'::regprocedure),
          'o caminho é security definer com search_path vazio');
select ok((select p.provolatile = 's' and p.prosrc !~* '\m(insert|update|delete)\M'
             from pg_proc p where p.oid = 'public.anuncios_caminho_do_lead()'::regprocedure),
          'o caminho só lê');
select ok(not has_function_privilege('authenticated', 'app.canal_pro_ocupadas(uuid)', 'execute')
          and not has_function_privilege('anon', 'app.canal_pro_ocupadas(uuid)', 'execute'),
          'a conta das vagas continua fechada a quem está logado e ao anônimo');
select ok((select p.proconfig @> array['search_path=""']
             from pg_proc p where p.oid = 'app.canal_pro_ocupadas(uuid)'::regprocedure),
          'a conta das vagas tem search_path vazio');

select * from finish();
rollback;

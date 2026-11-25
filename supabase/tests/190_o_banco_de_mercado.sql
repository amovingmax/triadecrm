-- =====================================================================
-- pgTAP — O banco de mercado da Imova (migrações 20261119160000 e 211000)
--
-- Pedido do dono (18/11/2026): um pipeline GRATUITO de dados imobiliários,
-- com ZERO associação com Canal Pro, ZAP, VivaReal ou OLX, coletado duas
-- vezes por semana. Este arquivo prova:
--
--   1. AS TABELAS: todas nascem com RLS; a equipe (admin, gestor, SDR) só lê,
--      outro papel não vê nada, e ninguém da equipe escreve direto; as
--      regiões só mudam por migração (nem o worker);
--   2. AS FONTES: as 55 da auditoria, com veredito; PROIBIDA nunca pode ser
--      coletada nem liberada; as CONDICIONAIS que esperam decisão (A Corrida
--      dos Bairros, Overpass reserva, Nominatim) e o Inside Airbnb nascem
--      desligados; DataZAP, Grupo OLX e Mercado Livre são domínios
--      bloqueados; liberar CONDICIONAL é de admin e gestor e vai ao audit_log;
--   3. A CHAVE: desligada, o worker não abre coleta e a fila não recebe nada;
--   4. A COLETA: fonte proibida, não liberada ou a reconferir é recusada,
--      automática OU manual (a semente de 17/11, das páginas do Chaves na Mão,
--      não entra); sem versão do coletor também; o lote recusa link de
--      domínio bloqueado (até escondido no bruto) e item sem link, limpa os
--      textos com nome de portal, guarda do bruto só os campos do imóvel, acha
--      a região pelo bairro e guarda o histórico de preço; carga manual não
--      desfaz a automática;
--   5. A SAÍDA DO AR: só depois de 2 rodadas completas sem o anúncio;
--   6. O CONTRATO V0 das tabelas gravadas direto (índices): link bloqueado,
--      fonte que não pode ser coletada, coleta fechada (ao inserir e ao mudar
--      um número) e coleta de outra fonte são recusados;
--   7. A FILA de segunda e quinta e as contas (m², testes estatísticos);
--   8. NA KOMUNE: desligada mesmo com a chave gravada; a IA lê vazio.
--
-- O CI roda as migrações sem identidade e a semente grava 'komune': o teste
-- vira Imova dentro da transação (como o 121). Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if to_regclass('public.mercado_anuncios') is null then
    raise exception 'pgTAP 190 é da Imova: rode num banco com as migrações de mercado (Imova ou sem identidade)';
  end if;
end $$;

select plan(83);

-- A identidade da Imova (a semente do CI grava 'komune'), desfeita no rollback.
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;
select pg_temp.virar('imova');

-- A régua do levantamento manual fica 30 dias à frente de hoje: o teste não
-- vence com o calendário.
update public.mercado_regras
   set regras = jsonb_set(regras, '{manual,frase_ate}', to_jsonb((app.mercado_hoje() + 30)::text))
 where ativa;

insert into public.allowed_users (email, role, note) values
  ('m190.g@teste.local', 'gestor', 'pgTAP 190'),
  ('m190.s@teste.local', 'sdr', 'pgTAP 190'),
  ('m190.l@teste.local', 'leitura', 'pgTAP 190');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000019001'::uuid, 'm190.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000019002'::uuid, 'm190.s@teste.local', '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000019003'::uuid, 'm190.l@teste.local', '{"full_name":"Lia Leitura"}');

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

-- Um anúncio para o lote do worker.
create function pg_temp.an(p_id text, p_tipo text, p_preco bigint, p_area numeric, p_bairro text, p_cidade text,
                           p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id_externo', p_id, 'url', 'https://exemplo-permitido.com.br/imovel/' || p_id,
                            'modo', 'venda', 'tipo', p_tipo, 'preco', p_preco,
                            'area_util', case when p_tipo in ('terreno') then null else p_area end,
                            'area_total', p_area, 'bairro', p_bairro, 'cidade', p_cidade) || p_extra
$$;

create temp table t190 (chave text primary key, valor text);
grant select on t190 to authenticated;

-- ---------------------------------------------------------------------
-- 1. As tabelas e a RLS
-- ---------------------------------------------------------------------
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'mercado\_%' and not c.relrowsecurity),
          0, 'toda tabela de mercado nasce com RLS');
select ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'mercado\_%') >= 17,
          'as tabelas de mercado existem (regras, regiões, fontes, coletas, anúncios, preços, índices, Censo, proximidades, temporada, obras, pares, células, conferências, vantagens...)');
select ok(not has_table_privilege('authenticated', 'public.mercado_anuncios', 'insert')
          and not has_table_privilege('authenticated', 'public.mercado_argumentos', 'update')
          and not has_table_privilege('authenticated', 'public.mercado_conferencias', 'insert')
          and not has_table_privilege('authenticated', 'public.mercado_fontes', 'update'),
          'a equipe não escreve direto em nenhuma tabela de mercado');
select ok(not has_table_privilege('anon', 'public.mercado_anuncios', 'select')
          and not has_table_privilege('anon', 'public.mercado_fontes', 'select'),
          'o anônimo não lê nada de mercado');
select ok(not has_function_privilege('authenticated', 'public.mercado_coleta_abrir(text,text,text,text,jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.mercado_anuncios_registrar(bigint,jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.mercado_argumentos_propor(text,jsonb,text,text[])', 'execute')
          and has_function_privilege('service_role', 'public.mercado_anuncios_registrar(bigint,jsonb)', 'execute'),
          'só o worker abre coleta, grava anúncio e propõe vantagem');
select is((select count(*)::int from public.mercado_regioes), 18, 'as 18 regiões (10 da carteira e 8 vizinhas)');
select is((select count(*)::int from public.mercado_regioes where papel = 'carteira'), 10, 'as 10 regiões da carteira');
select is((select versao from public.mercado_regras where ativa), 'regras-veracidade@1', 'a régua ativa é a @1');
select ok(not has_table_privilege('service_role', 'public.mercado_regioes', 'insert')
          and not has_table_privilege('service_role', 'public.mercado_regioes', 'update')
          and not has_table_privilege('service_role', 'public.mercado_regioes', 'delete'),
          'nem o worker muda as regiões (mudar as palavras de uma região muda a carteira): só migração');

-- ---------------------------------------------------------------------
-- 2. As fontes
-- ---------------------------------------------------------------------
select is((select count(*)::int from public.mercado_fontes), 55, 'as 55 fontes auditadas em 18/11');
select is((select count(*)::int from public.mercado_fontes where veredito = 'PROIBIDA' and (liberada or pode_coletar)),
          0, 'nenhuma fonte PROIBIDA pode ser coletada');
select is((select array_agg(veredito order by id) from public.mercado_fontes
            where id in ('grupo-olx', 'portais-nacionais', 'deztop', 'chavesnamao-paginas', 'airbnb')),
          array['PROIBIDA', 'PROIBIDA', 'PROIBIDA', 'PROIBIDA', 'PROIBIDA'],
          'Grupo OLX, portais nacionais, DezTop, páginas do Chaves na Mão e Airbnb são PROIBIDAS');
select ok((select pode_coletar from public.mercado_fontes where id = 'chavesnamao-mcp')
          and (select pode_coletar from public.mercado_fontes where id = 'fipezap-planilha')
          and (select pode_coletar from public.mercado_fontes where id = 'osm-overpass'),
          'o servidor MCP oficial do Chaves na Mão, a planilha da Fipe e o Overpass podem ser coletados');
select ok(not (select pode_coletar from public.mercado_fontes where id = 'lopes')
          and not (select pode_coletar from public.mercado_fontes where id = 'dom-parnamirim'),
          'CONDICIONAL ainda não liberada (Lopes) e fonte a reconferir (DOM Parnamirim) não são coletadas');
select is((select frequencia from public.mercado_fontes where id = 'fipezap-planilha'), 'mensal',
          'a planilha da Fipe é mensal, não duas vezes por semana');
select is((select count(*)::int from public.mercado_fontes
            where id in ('corrida-dos-bairros', 'osm-overpass-private-coffee', 'osm-nominatim', 'inside-airbnb')
              and (liberada or pode_coletar)), 0,
          'A Corrida dos Bairros, o Overpass reserva, o Nominatim e o Inside Airbnb nascem desligados');
select ok(app.mercado_url_bloqueada('https://datazap.com.br/relatorio')
          and app.mercado_url_bloqueada('https://www.grupoolx.com.br/')
          and app.mercado_url_bloqueada('https://imoveis.grupoolx.com.br/x')
          and app.mercado_url_bloqueada('https://imoveis.mercadolivre.com.br/casas'),
          'DataZAP, Grupo OLX e Mercado Livre Imóveis: domínios bloqueados');
select ok(not app.mercado_url_bloqueada('https://downloads.fipe.org.br/indices/fipezap/fipezap-serieshistoricas.xlsx')
          and not app.mercado_url_bloqueada('https://www.chavesnamao.com.br/imovel/casa-a-venda/id-1/'),
          'a planilha da Fipe e o link de um anúncio do Chaves na Mão passam');
select is(app.mercado_limpar_texto('Segundo o DataZAP e o Grupo OLX, subiu; no Mercado Livre também'),
          'Segundo o [fonte removida] e o [fonte removida], subiu; no [fonte removida] também',
          'DataZAP, Grupo OLX e Mercado Livre saem do texto livre');
select throws_ok($$ update public.mercado_fontes set liberada = true where id = 'grupo-olx' $$,
                 '23514', null, 'nem por baixo dos panos uma fonte PROIBIDA é liberada');

-- ---------------------------------------------------------------------
-- 3. Desligada, nada
-- ---------------------------------------------------------------------
update public.app_settings set value = value || '{"ligado": false}'::jsonb where key = 'mercado';
select is(public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'teste-1') ->> 'motivo', 'desligado',
          'desligada, o worker não abre coleta');
select is(app.mercado_coleta_enfileirar(), 0, 'desligada, a fila não recebe nada');
select is(app.mercado_vantagens_para_ia(), '{}'::jsonb, 'desligada, a IA não recebe nada de mercado');

update public.app_settings set value = value || '{"ligado": true}'::jsonb where key = 'mercado';
select ok(app.mercado_ligado(), 'ligada na Imova');

-- ---------------------------------------------------------------------
-- 4. A coleta
-- ---------------------------------------------------------------------
select is(public.mercado_coleta_abrir('grupo-olx', null, 'auto', 'teste-1') ->> 'motivo', 'fonte_proibida',
          'fonte do Grupo OLX: recusada');
select is(public.mercado_coleta_abrir('grupo-olx', null, 'manual', 'teste-1') ->> 'motivo', 'fonte_proibida',
          'nem como carga manual');
select is(public.mercado_coleta_abrir('lopes', null, 'auto', 'teste-1') ->> 'motivo', 'fonte_nao_liberada',
          'CONDICIONAL não liberada: o worker não coleta');
select is(public.mercado_coleta_abrir('dom-parnamirim', null, 'auto', 'teste-1') ->> 'motivo', 'fonte_a_reconferir',
          'fonte que a auditoria mandou reconferir: espera');
select is(public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', null) ->> 'motivo', 'sem_versao_do_coletor',
          'sem a versão do coletor (contrato V0): recusada');
select is(public.mercado_coleta_abrir('chavesnamao-paginas', null, 'manual', 'semente@1') ->> 'motivo', 'fonte_proibida',
          'a semente de 17/11 (páginas HTML do Chaves na Mão, PROIBIDA) não entra nem como carga manual');
select is(public.mercado_coleta_abrir('lopes', null, 'manual', 'levantamento@1') ->> 'motivo', 'fonte_nao_liberada',
          'carga manual de CONDICIONAL não liberada: recusada');
select is(public.mercado_coleta_abrir('dom-parnamirim', null, 'manual', 'levantamento@1') ->> 'motivo', 'fonte_a_reconferir',
          'carga manual de fonte a reconferir: recusada');
select is(public.mercado_coleta_abrir('corrida-dos-bairros', null, 'auto', 'corrida@1') ->> 'motivo', 'fonte_nao_liberada',
          'A Corrida dos Bairros espera a decisão do dono');

insert into t190 values ('c1', public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'chavesnamao@1') ->> 'coleta_id');
select ok((select valor from t190 where chave = 'c1') is not null, 'o MCP oficial abre coleta automática');

insert into t190 values ('r1', public.mercado_anuncios_registrar((select valor::bigint from t190 where chave = 'c1'),
  jsonb_build_array(
    pg_temp.an('190-1', 'terreno', 500000, 450, 'Capim Macio', 'Natal',
               '{"titulo": "Terreno em Capim Macio, visto no ZAP Imóveis", "url": "https://exemplo-permitido.com.br/imovel/190-1/?utm=x#topo"}'),
    pg_temp.an('190-2', 'casa', 300000, 120, 'Rosa dos Ventos', 'Parnamirim'),
    pg_temp.an('190-zap', 'casa', 300000, 120, 'Ponta Negra', 'Natal',
               '{"url": "https://www.zapimoveis.com.br/imovel/123"}'),
    jsonb_build_object('id_externo', '190-sem-link', 'tipo', 'casa', 'preco', 200000),
    pg_temp.an('190-pipa', 'terreno', 400000, 800, 'Praia da Pipa', 'Tibau do Sul')))::text);
select is((select (valor::jsonb ->> 'novos')::int from t190 where chave = 'r1'), 3, 'três anúncios entram');
select is((select (valor::jsonb ->> 'recusados')::int from t190 where chave = 'r1'), 2,
          'link do ZAP e item sem link são recusados na entrada (V0)');
select ok(not exists (select 1 from public.mercado_anuncios where id_externo in ('190-zap', '190-sem-link')),
          'nada do domínio bloqueado fica no banco');
select is((select titulo from public.mercado_anuncios where id_externo = '190-1'),
          'Terreno em Capim Macio, visto no [fonte removida]', 'o nome do portal sai do título');
select ok((select 'texto_limpo' = any (marcas_do_coletor) from public.mercado_anuncios where id_externo = '190-1'),
          'e o anúncio ganha a marca texto_limpo');
select is((select url from public.mercado_anuncios where id_externo = '190-1'),
          'https://exemplo-permitido.com.br/imovel/190-1', 'o link é guardado sem ?… e sem #…');
select is((select regiao_id from public.mercado_anuncios where id_externo = '190-1'), 'natal-capim-macio',
          'a região sai do bairro');
select is((select regiao_id from public.mercado_anuncios where id_externo = '190-2'), 'parnamirim-bonor',
          'Rosa dos Ventos é da área da BONOR');
select is((select regiao_id from public.mercado_anuncios where id_externo = '190-pipa'), 'tibau-do-sul-pipa',
          '"Praia da Pipa" acha a região de Pipa');
select is((select count(*)::int from public.mercado_anuncio_precos p join public.mercado_anuncios a on a.id = p.anuncio_id
            where a.id_externo = '190-1'), 1, 'o primeiro preço vai para o histórico');

-- O bruto: só os campos do imóvel, e link de portal escondido nele recusa o item.
insert into t190 values ('cfeed', public.mercado_coleta_abrir('feeds-imobiliarias', null, 'auto', 'feeds@1') ->> 'coleta_id');
insert into t190 values ('rfeed', public.mercado_anuncios_registrar((select valor::bigint from t190 where chave = 'cfeed'),
  jsonb_build_array(
    pg_temp.an('190-bruto', 'casa', 350000, 130, 'Ponta Negra', 'Natal',
               '{"logradouro": "Rua do anúncio visto na OLX",
                 "bruto": {"title": "Casa vista no ZAP", "priceBrl": 350000, "email": "fulano@exemplo.com",
                           "anunciante": {"nome": "Fulano", "telefone": "84999990000"}}}'),
    pg_temp.an('190-bruto-link', 'casa', 360000, 140, 'Ponta Negra', 'Natal',
               '{"bruto": {"descricao": "veja também em https://www.vivareal.com.br/imovel/9"}}')))::text);
select is((select (valor::jsonb ->> 'novos') || '/' || (valor::jsonb ->> 'recusados') from t190 where chave = 'rfeed'), '1/1',
          'link de portal escondido no bruto: o item inteiro é recusado');
select is((select bruto from public.mercado_anuncios where id_externo = '190-bruto'),
          '{"title": "Casa vista no [fonte removida]", "priceBrl": 350000}'::jsonb,
          'do bruto ficam só os campos do imóvel (sem anunciante, telefone e e-mail), com o texto limpo');
select is((select logradouro from public.mercado_anuncios where id_externo = '190-bruto'),
          'Rua do anúncio visto na [fonte removida]', 'o logradouro também passa pela limpeza');
select public.mercado_coleta_fechar((select valor::bigint from t190 where chave = 'cfeed'), null, null, null, false);
do $v$ begin if to_regprocedure('app.mercado_verificar_se_pendente()') is not null then execute 'select app.mercado_verificar_se_pendente()'; end if; end $v$; -- 20261125120000: a veracidade roda depois

-- Uma carga manual não mexe no que a coleta automática viu. A carga manual
-- leva a fonte verdadeira: aqui, uma conferência feita à mão pelo mesmo MCP.
insert into t190 values ('cm', public.mercado_coleta_abrir('chavesnamao-mcp', null, 'manual', 'chavesnamao-mcp-manual@1') ->> 'coleta_id');
select is((public.mercado_anuncios_registrar((select valor::bigint from t190 where chave = 'cm'),
            jsonb_build_array(pg_temp.an('190-1', 'terreno', 1, 450, 'Capim Macio', 'Natal'),
                              pg_temp.an('190-manual', 'terreno', 450000, 500, 'Capim Macio', 'Natal'))) ->> 'ignorados')::int,
          1, 'a carga manual ignora o anúncio que a coleta automática já viu');
select is((select origem from public.mercado_anuncios where id_externo = '190-manual'), 'manual',
          'o anúncio só do levantamento fica marcado como manual');
select is(public.mercado_coleta_fechar((select valor::bigint from t190 where chave = 'cm')) ->> 'faltaram', '0',
          'fechar a carga manual não tira ninguém do ar');
do $v$ begin if to_regprocedure('app.mercado_verificar_se_pendente()') is not null then execute 'select app.mercado_verificar_se_pendente()'; end if; end $v$; -- 20261125120000: a veracidade roda depois

select is(public.mercado_coleta_fechar((select valor::bigint from t190 where chave = 'c1'), null, null, null, true,
                                       repeat('a', 64)) ->> 'situacao', 'ok', 'a rodada fecha com o hash do bruto');
do $v$ begin if to_regprocedure('app.mercado_verificar_se_pendente()') is not null then execute 'select app.mercado_verificar_se_pendente()'; end if; end $v$; -- 20261125120000: a veracidade roda depois
select is(public.mercado_anuncios_registrar((select valor::bigint from t190 where chave = 'c1'), '[]'::jsonb) ->> 'motivo',
          'coleta_fechada', 'coleta fechada não recebe mais anúncio');

-- 2ª rodada: o 190-1 muda de preço, o 190-2 some.
update public.mercado_coletas set inicio = inicio - interval '4 days', fim = fim - interval '4 days'
 where id = (select valor::bigint from t190 where chave = 'c1');
update public.mercado_anuncios set primeira_vez_visto = primeira_vez_visto - interval '4 days',
                                   ultima_vez_visto = ultima_vez_visto - interval '4 days'
 where id_externo like '190-%';
update public.mercado_anuncio_precos set visto_em = visto_em - interval '4 days';
insert into t190 values ('c2', public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'chavesnamao@1') ->> 'coleta_id');
select is((public.mercado_anuncios_registrar((select valor::bigint from t190 where chave = 'c2'),
            jsonb_build_array(pg_temp.an('190-1', 'terreno', 480000, 450, 'Capim Macio', 'Natal'),
                              pg_temp.an('190-pipa', 'terreno', 400100, 800, 'Praia da Pipa', 'Tibau do Sul'))) ->> 'atualizados')::int,
          2, 'a 2ª rodada atualiza os dois que voltaram');
select is((select count(*)::int from public.mercado_anuncio_precos p join public.mercado_anuncios a on a.id = p.anuncio_id
            where a.id_externo = '190-1'), 2, 'o preço que caiu vira a 2ª linha do histórico');
select is((select count(*)::int from public.mercado_anuncio_precos p join public.mercado_anuncios a on a.id = p.anuncio_id
            where a.id_externo = '190-pipa'), 1, 'mudança de até 0,1% não enche o histórico');
select is(public.mercado_coleta_fechar((select valor::bigint from t190 where chave = 'c2')) ->> 'faltaram', '1',
          'quem faltou numa rodada completa ganha uma falta');
do $v$ begin if to_regprocedure('app.mercado_verificar_se_pendente()') is not null then execute 'select app.mercado_verificar_se_pendente()'; end if; end $v$; -- 20261125120000: a veracidade roda depois
select ok((select saiu_do_ar_em is null from public.mercado_anuncios where id_externo = '190-2'),
          'uma falta só não tira do ar');

update public.mercado_coletas set inicio = inicio - interval '3 days', fim = fim - interval '3 days'
 where id = (select valor::bigint from t190 where chave = 'c2');
update public.mercado_anuncios set primeira_vez_visto = primeira_vez_visto - interval '3 days',
                                   ultima_vez_visto = ultima_vez_visto - interval '3 days' where id_externo like '190-%';
insert into t190 values ('c3', public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'chavesnamao@1') ->> 'coleta_id');
select is((public.mercado_anuncios_registrar((select valor::bigint from t190 where chave = 'c3'),
            jsonb_build_array(pg_temp.an('190-1', 'terreno', 480000, 450, 'Capim Macio', 'Natal'))) ->> 'atualizados')::int,
          1, 'a 3ª rodada vê só o 190-1');
select is(public.mercado_coleta_fechar((select valor::bigint from t190 where chave = 'c3')) ->> 'sairam_do_ar', '1',
          'com 2 rodadas completas seguidas sem ele, sai do ar (o 190-2; o 190-pipa faltou só uma)');
do $v$ begin if to_regprocedure('app.mercado_verificar_se_pendente()') is not null then execute 'select app.mercado_verificar_se_pendente()'; end if; end $v$; -- 20261125120000: a veracidade roda depois
select ok((select saiu_do_ar_em is not null from public.mercado_anuncios where id_externo = '190-2')
          and (select estado from public.mercado_anuncios where id_externo = '190-2') = 'vencido',
          'quem saiu do ar fica vencido (fora das contas), nunca "vendido"');

-- ---------------------------------------------------------------------
-- 6. O contrato V0 das tabelas gravadas direto
-- ---------------------------------------------------------------------
insert into t190 values ('cf', public.mercado_coleta_abrir('fipezap-planilha', null, 'auto', 'fipezap@1') ->> 'coleta_id');
select lives_ok($$
  insert into public.mercado_indices (serie, mes, valor, nome, unidade, local, fonte, url, coleta_id)
  values ('fipezap-natal-venda', '2026-10-01', 6466.78, 'FipeZAP venda Natal', 'R$/m²', 'Natal', 'fipezap-planilha',
          'https://downloads.fipe.org.br/indices/fipezap/fipezap-serieshistoricas.xlsx',
          (select valor::bigint from t190 where chave = 'cf'))
$$, 'o FipeZAP entra pelo domínio da Fipe');
select throws_ok($$
  insert into public.mercado_indices (serie, mes, valor, nome, unidade, fonte, url, coleta_id)
  values ('fipezap-natal-venda', '2026-09-01', 6400, 'FipeZAP', 'R$/m²', 'fipezap-planilha',
          'https://www.zapimoveis.com.br/indice', (select valor::bigint from t190 where chave = 'cf'))
$$, '42501', null, 'o mesmo índice por link de portal: recusado');
select throws_ok($$
  insert into public.mercado_indices (serie, mes, valor, nome, unidade, fonte, url, coleta_id)
  values ('bcb-x', '2026-09-01', 1, 'x', 'x', 'bcb', 'https://olinda.bcb.gov.br/x',
          (select valor::bigint from t190 where chave = 'cf'))
$$, '22023', null, 'registro de uma fonte numa coleta de outra: recusado');
select throws_ok($$
  insert into public.mercado_indices (serie, mes, valor, nome, unidade, fonte, url, coleta_id)
  values ('corrida-natal-x', '2026-10-01', 5000, 'Corrida', 'R$/m²', 'corrida-dos-bairros',
          'https://acorridadosbairros.com.br/rn/natal/dados.csv', (select valor::bigint from t190 where chave = 'cf'))
$$, '42501', null, 'fonte que não pode ser coletada (A Corrida dos Bairros, ainda não liberada): o V0 recusa');
select public.mercado_coleta_fechar((select valor::bigint from t190 where chave = 'cf'));
do $v$ begin if to_regprocedure('app.mercado_verificar_se_pendente()') is not null then execute 'select app.mercado_verificar_se_pendente()'; end if; end $v$; -- 20261125120000: a veracidade roda depois
select throws_ok($$
  update public.mercado_indices set valor = 1 where serie = 'fipezap-natal-venda' and mes = '2026-10-01'
$$, '22023', null, 'mudar o número depois da coleta fechada também passa pelo V0: recusado');
select throws_ok($$
  insert into public.mercado_indices (serie, mes, valor, nome, unidade, fonte, url, coleta_id)
  values ('fipezap-natal-venda', '2026-08-01', 6300, 'FipeZAP', 'R$/m²', 'fipezap-planilha',
          'https://downloads.fipe.org.br/x.xlsx', (select valor::bigint from t190 where chave = 'cf'))
$$, '22023', null, 'coleta fechada não recebe registro novo');

-- ---------------------------------------------------------------------
-- 1 (cont.). Quem lê e quem libera
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000019002'::uuid, 'sdr');
select ok((select count(*) from public.mercado_anuncios) >= 3, 'o SDR lê os anúncios de mercado');
select throws_ok($$ select public.mercado_fonte_liberar('lopes', true, 'teste do SDR') $$, '42501', null,
                 'o SDR não libera fonte');
select throws_ok($$ insert into public.mercado_regioes (id, nome, curto, cidade) values ('x-y', 'X', 'X', 'Natal') $$,
                 '42501', null, 'nem grava região');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000019003'::uuid, 'leitura');
select is((select count(*)::int from public.mercado_anuncios), 0, 'outro papel não vê anúncio de mercado');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000019001'::uuid, 'gestor');
select is(public.mercado_fonte_liberar('grupo-olx', true, 'quero muito') ->> 'motivo', 'fonte_proibida',
          'nem o gestor libera fonte PROIBIDA');
select is(public.mercado_fonte_liberar('lopes', true, 'x') ->> 'motivo', 'motivo_obrigatorio',
          'liberar pede motivo');
select is(public.mercado_fonte_liberar('lopes', true, 'Termos conferidos em 18/11; só campos factuais') ->> 'pode_coletar',
          'true', 'o gestor libera uma CONDICIONAL, com motivo');
select pg_temp.sair();
select ok(exists (select 1 from public.audit_log
                   where table_name = 'mercado_fontes' and row_id = 'lopes' and action = 'UPDATE'
                     and actor_id = 'a0000000-0000-4000-8000-000000019001'::uuid
                     and (old_data ->> 'liberada')::boolean = false and (new_data ->> 'liberada')::boolean
                     and new_data ->> 'liberada_motivo' like 'Termos conferidos%'),
          'a decisão de curadoria vai para o audit_log, com o antes, o depois e quem decidiu');

-- ---------------------------------------------------------------------
-- 7. A fila e as contas
-- ---------------------------------------------------------------------
select ok(app.mercado_coleta_enfileirar() >= 1, 'ligada, segunda e quinta a fila recebe as fontes no prazo');
select is(app.mercado_coleta_enfileirar(), 0, 'no mesmo dia, nada em dobro (chave de idempotência)');
select is((select schedule from cron.job where jobname = 'mercado_coleta_seg_qui'), '0 9 * * 1,4',
          'o relógio é segunda e quinta às 6h de Fortaleza');
select is((public.mercado_m2('natal-capim-macio', 'terreno') ->> 'n')::int, 2,
          'o m² de Capim Macio conta os dois terrenos ok (o do levantamento manual vale até a data da régua)');

-- ---------------------------------------------------------------------
-- 8. Na KOMUNE, nada (mesmo com a chave gravada à força)
-- ---------------------------------------------------------------------
select pg_temp.virar('komune');
update public.app_settings set value = value || '{"ligado": true}'::jsonb where key = 'mercado';
select is(app.mercado_config() ->> 'ligado', 'false', 'na KOMUNE a configuração diz desligada, mesmo com a chave gravada true');
select ok(not app.mercado_ligado(), 'e app.mercado_ligado() é false');
select is(public.mercado_coleta_abrir('chavesnamao-mcp', null, 'auto', 'chavesnamao@1') ->> 'motivo', 'desligado',
          'o worker não abre coleta na KOMUNE');
select is(app.mercado_coleta_enfileirar(), 0, 'nem a fila recebe');
select is(app.mercado_vantagens_para_ia(), '{}'::jsonb, 'e a IA da KOMUNE lê vazio');

select * from finish();
rollback;

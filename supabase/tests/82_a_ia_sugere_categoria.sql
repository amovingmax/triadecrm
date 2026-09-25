-- =====================================================================
-- pgTAP — A IA sugere categoria, e a gente escuta (migração 20261001150000)
--
-- POR QUÊ: o prompt já devolvia `categoriaSugerida` e `public.ia_gravar_triagem`
-- gravava veredito, porquê e confiança — e DESCARTAVA a categoria. Só ela morria
-- no caminho, e a gente pagava a chamada do mesmo jeito.
--
-- O que este arquivo tem de provar:
--   1. SÓ CASA EXATO. "Locais" não vira "Locais: salões, chácaras, hotéis,
--      restaurantes, praia". Categoria errada é ficha no funil errado, e funil
--      errado é meta errada, relatório errado e pitch errado.
--   2. MAS ACENTO E CAIXA NÃO CONTAM: quem casa é `app.chave_catalogo`, o mesmo
--      normalizador do de-para.
--   3. A CHAMADA FICA REGISTRADA (`ia_run_id`): opinião sem de onde conferir é
--      palpite com cara de dado.
--   4. NADA VIRA FICHA SOZINHO (RF-RAD-11): a sugestão vai para `ia_categoria_id`
--      e NÃO para `category_id`. O candidato continua "novo", na fila.
--   5. O RÓTULO DA FONTE CHEGA AO MODELO. Era `null` fixo.
--   6. A CHAVE DA FILA DEIXOU DE SER DO DIA: com ela, 155 candidatos levariam
--      oito DIAS, porque a segunda chamada do mesmo dia era recusada calada.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(10);

create function pg_temp.entrar_como_worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

insert into public.sources (id, slug, name, kind, base_url, legal_basis, robots_ok,
                            rate_limit_seconds, is_enabled, config)
values (982, 'z82', 'Z82 Fonte (pgTAP)', 'import', 'https://exemplo82.test',
        'legitimo_interesse', false, 5.00, false, '{"entrada_por_arquivo": true}'::jsonb);

create function pg_temp.cat(p_slug text) returns int language sql stable as $$
  select id from public.categories where slug = p_slug
$$;

create temp table c82(chave text primary key, id uuid not null);
-- A fixture é criada como `postgres` e LIDA dentro da sessão de worker, que roda
-- como `service_role`. Sem este grant o teste falha na própria fixture.
grant select on c82 to service_role;
create function pg_temp.nascer(p_ext text, p_nome text, p_rotulo text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.supplier_candidates
    (source_id, external_id, collector, name, phone_e164, city_id, status, score)
  values (982, p_ext, 'pgTAP 82', p_nome,
          '+558298200' || right('000' || (random() * 999)::int::text, 4), 1, 'novo', 50)
  returning id into v_id;
  insert into public.source_record
    (source_id, external_id, name, category_source, candidate_id, last_seen_at)
  values (982, p_ext, p_nome, p_rotulo, v_id, now());
  return v_id;
end $$;

-- A chamada de verdade: `ia_run_id` é chave estrangeira para `public.ai_runs`,
-- e é esse laço que faz a opinião da IA ter de onde ser conferida.
create temp table r82 as
  with nova as (
    insert into public.ai_runs (purpose, model, prompt_version, tokens_in, tokens_out, cost_usd)
    values ('triar_candidato', 'claude-haiku-4-5', 'triagem-do-radar@v2', 720, 185, 0.00165)
    returning id
  )
  select id from nova;
grant select on r82 to service_role;

insert into c82(chave, id) values
  ('exato',    pg_temp.nascer('z82-a', 'OITENTADOIS EXATO',    'Loja de Presentes')),
  ('acento',   pg_temp.nascer('z82-b', 'OITENTADOIS ACENTO',   'Impressões fotográficas')),
  ('grupo',    pg_temp.nascer('z82-c', 'OITENTADOIS GRUPO',    'Loja de artigos para fotografia')),
  ('inventada',pg_temp.nascer('z82-d', 'OITENTADOIS INVENTADA','Centro de diversões infantil'));


-- =====================================================================
-- 1. O rótulo da fonte chega ao modelo
-- =====================================================================
-- Era `'categoriaDaFonte', null` FIXO. Para a pergunta "isto é fornecedor de
-- evento?" o nome bastava; para a pergunta de CATEGORIA, o rótulo é metade.
select is((select j ->> 'categoriaDaFonte'
             from jsonb_array_elements(
                    app.ia_candidatos_para_triar(30) -> 'candidatos') j
            where j ->> 'nome' = 'OITENTADOIS EXATO'),
          'Loja de Presentes',
          'o rótulo que a FONTE usou chega ao modelo, e não mais nulo fixo');

select ok((select not exists (
             select 1 from jsonb_array_elements(
                            app.ia_candidatos_para_triar(30) -> 'candidatos') j
              where j ? 'telefone' or j ? 'email' or j ? 'cnpj')),
          'e nenhum contato viaja junto: o modelo não precisa deles (ADR-09)');


-- =====================================================================
-- 2. A gravação: só o que casa exato
-- =====================================================================
select pg_temp.entrar_como_worker();
create temp table g82 as
  select public.ia_gravar_triagem(jsonb_build_array(
    -- o nome exato do catálogo
    jsonb_build_object('id', (select id from c82 where chave = 'exato')::text,
                       'veredito', 'sim', 'porque', 'Revela foto, apesar do rótulo.',
                       'confianca', 0.7,
                       'categoriaSugerida', 'Fotografia e vídeo'),
    -- o mesmo nome sem acento e em caixa baixa: `app.chave_catalogo` resolve
    jsonb_build_object('id', (select id from c82 where chave = 'acento')::text,
                       'veredito', 'sim', 'porque', 'Laboratório de revelação.',
                       'confianca', 0.6,
                       'categoriaSugerida', 'fotografia e video'),
    -- nome de GRUPO, que é o defeito que o prompt v1 ensinava
    jsonb_build_object('id', (select id from c82 where chave = 'grupo')::text,
                       'veredito', 'sim', 'porque', 'Loja de câmera com nome de fotografia.',
                       'confianca', 0.5,
                       'categoriaSugerida', 'Locais'),
    -- categoria que não existe
    jsonb_build_object('id', (select id from c82 where chave = 'inventada')::text,
                       'veredito', 'incerto', 'porque', 'Escola de meio período.',
                       'confianca', 0.4,
                       'categoriaSugerida', 'Escolas infantis')
  ), (select id from r82)) as j;
select pg_temp.sair();

select is((select (j ->> 'gravados')::int from pg_temp.g82), 4,
          'os quatro vereditos são gravados: quem não casa categoria continua tendo veredito');

select is((select c.ia_categoria_id from public.supplier_candidates c
            where c.id = (select id from c82 where chave = 'exato')),
          pg_temp.cat('fotografia_video'),
          'o nome exato do catálogo vira categoria sugerida');

select is((select c.ia_categoria_id from public.supplier_candidates c
            where c.id = (select id from c82 where chave = 'acento')),
          pg_temp.cat('fotografia_video'),
          'e acento e caixa não contam: quem casa é app.chave_catalogo, como no de-para');

select is((select c.ia_categoria_id from public.supplier_candidates c
            where c.id = (select id from c82 where chave = 'grupo')),
          null,
          '"Locais" é nome de GRUPO e não casa: é exatamente o que o exemplo da v1 ensinava a responder');

select is((select c.ia_categoria_id from public.supplier_candidates c
            where c.id = (select id from c82 where chave = 'inventada')),
          null, 'e categoria inventada não vira nada');


-- =====================================================================
-- 3. Nada vira ficha sozinho, e dá para conferir quem disse
-- =====================================================================
select is(array[
    (select c.category_id::text from public.supplier_candidates c
      where c.id = (select id from c82 where chave = 'exato')),
    (select c.status::text from public.supplier_candidates c
      where c.id = (select id from c82 where chave = 'exato'))],
  array[null, 'novo'],
  'RF-RAD-11: a sugestão NÃO vira a categoria do candidato, e ele continua na fila');

select is((select c.ia_run_id from public.supplier_candidates c
            where c.id = (select id from c82 where chave = 'exato')),
          (select id from r82),
          'e a chamada que produziu o veredito fica registrada: opinião sem origem é palpite');

-- Só o worker grava: a tela não inventa veredito.
select throws_ok(
  $$ select public.ia_gravar_triagem('[]'::jsonb, null) $$, '42501',
  null, 'quem não é o worker não grava triagem');

select * from finish();
rollback;

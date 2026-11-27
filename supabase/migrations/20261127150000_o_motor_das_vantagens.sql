-- =====================================================================
-- O motor das vantagens lê o banco de mercado — só na Imova (19/11/2026)
--
-- O motor que monta as vantagens de cada imóvel (o mesmo de
-- `js/55-argumentos.js` do protótipo, portado para o worker em
-- `apps/workers/src/mercado/motor`) roda no pós-rodada do worker mercado,
-- DEPOIS da veracidade, e entrega a lista de cada imóvel a
-- `public.mercado_argumentos_propor` (20261119164000), que decide sozinho o
-- que nasce proposto, o que renova até 10% e o que volta para aprovação.
-- Esta migração só dá ao worker as duas leituras de que ele precisa, pela
-- API (o worker fala por HTTPS com a service_role, e `app` não é exposto):
--
--   * `public.mercado_motor_entrada()`: a carteira da Imova como o mercado
--     a vê (`app.mercado_carteira()`, mais vagas, suítes, banheiros, título e
--     situação do anúncio), as regiões com os vizinhos, o Censo
--     (`mercado_ibge`), as séries que o motor usa (FipeZAP de Natal, alvarás
--     do GeoMapas, A Corrida dos Bairros), o dia de hoje e a rodada de
--     coleta (`app.mercado_rodada()`), e quantos anúncios entram na conta.
--   * `public.mercado_motor_anuncios(depois, limite)`: os anúncios de
--     terceiros que entram na conta, em páginas (chave: o id). Só o que a
--     veracidade aceitou e está na validade: estado 'ok', venda, o
--     representante do grupo de repetidos, não é imóvel nosso, não saiu do
--     ar, com região e preço; e só de fonte de anúncios LIBERADA pelo dono e
--     não PROIBIDA, sem link bloqueado. Sem link, sem coordenada e sem o
--     bruto: o motor não precisa deles.
--
-- Nenhuma das duas grava nada. Fora da Imova devolvem {"ok": false,
-- "motivo": "so_imova"} (e na KOMUNE nem são criadas); com a chave desligada,
-- {"ok": false, "motivo": "desligado"}. Só a service_role (o worker).
--
-- COMO DESFAZER (no banco da Imova):
--   drop function if exists public.mercado_motor_anuncios(uuid, int),
--     public.mercado_motor_entrada(), app.mercado_motor_elegiveis();
--   (o worker volta a avisar que o motor não roda: a leitura falha e o
--   pós-rodada registra o erro sem propor nada.)
-- =====================================================================

do $motor$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A inteligência de mercado é só da Imova: no banco da KOMUNE o motor não tem o que ler.';
    return;
  end if;
  execute $ddl$

-- Os anúncios de terceiros que entram na conta do motor.
create or replace function app.mercado_motor_elegiveis()
returns setof public.mercado_anuncios
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
    from public.mercado_anuncios m
    join public.mercado_fontes f on f.id = m.fonte
   where m.estado = 'ok'
     and m.modo = 'venda'
     and m.representante
     and not m.nosso_imovel
     and m.saiu_do_ar_em is null
     and m.regiao_id is not null
     and m.preco is not null
     and f.grupo = 'anuncios'
     and f.veredito <> 'PROIBIDA'
     and f.liberada
     and not app.mercado_url_bloqueada(m.url)
$$;
comment on function app.mercado_motor_elegiveis() is
  'Os anúncios de terceiros que o motor das vantagens conta: estado ok, venda, representante, não é nosso, no ar, com região e preço, de fonte de anúncios liberada e não PROIBIDA, sem link bloqueado.';
revoke all on function app.mercado_motor_elegiveis() from public, anon, authenticated;
grant execute on function app.mercado_motor_elegiveis() to service_role;

create or replace function public.mercado_motor_entrada()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.empresa_do_banco() is distinct from 'imova' then
    return jsonb_build_object('ok', false, 'motivo', 'so_imova');
  end if;
  if not app.mercado_ligado() then
    return jsonb_build_object('ok', false, 'motivo', 'desligado');
  end if;
  return jsonb_build_object(
    'ok', true,
    'hoje', app.mercado_hoje(),
    'rodada', app.mercado_rodada(),
    'carteira', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', k.codigo, 'origem', k.origem, 'anuncio_id', k.anuncio_id, 'tipo', k.tipo,
               'sub', k.sub, 'negocio', k.negocio, 'preco_venda', k.preco_venda,
               'preco_aluguel', k.preco_aluguel, 'area_util', k.area_util, 'area_total', k.area_total,
               'area_ref', k.area_ref, 'quartos', k.quartos, 'suites', a.suites, 'vagas', a.vagas,
               'banheiros', a.banheiros, 'bairro', k.bairro, 'cidade', k.cidade,
               'logradouro', k.logradouro, 'regiao_id', k.regiao_id, 'situacao', k.situacao,
               'titulo', coalesce(a.titulo, cp.titulo), 'caracteristicas', to_jsonb(coalesce(a.caracteristicas, '{}'::text[])),
               'largura_terreno', a.largura_terreno, 'comprimento_terreno', a.comprimento_terreno)
             order by k.codigo)
        from app.mercado_carteira() k
        left join public.anuncios a on a.id = k.anuncio_id
        left join lateral (select c.titulo from public.anuncios_no_canal_pro c
                            where c.codigo = k.codigo and c.excluido_em is null
                            order by c.visto_em desc limit 1) cp on k.anuncio_id is null), '[]'::jsonb),
    'regioes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'nome', r.nome, 'curto', r.curto, 'cidade', r.cidade, 'papel', r.papel,
               'abrangencia', r.abrangencia, 'lat', r.lat, 'lng', r.lng, 'vizinhos', r.vizinhos,
               'litoral', r.litoral)
             order by r.id)
        from public.mercado_regioes r
       where r.ativa), '[]'::jsonb),
    'ibge', coalesce((
      select jsonb_agg(jsonb_build_object(
               'escopo', g.escopo, 'nome', g.nome, 'municipio', g.municipio, 'regiao_id', g.regiao_id,
               'ano', g.ano, 'populacao', g.populacao, 'crescimento_2010_2022_pct', g.crescimento_2010_2022_pct,
               'renda_media_responsavel', g.renda_media_responsavel,
               'renda_mediana_responsavel', g.renda_mediana_responsavel,
               'pct_uso_ocasional', g.pct_uso_ocasional, 'dados', g.dados, 'definicao', g.definicao,
               'coletado_em', g.coletado_em)
             order by g.escopo, g.municipio, g.nome)
        from public.mercado_ibge g
       where g.ano = 2022), '[]'::jsonb),
    'indices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'serie', x.serie, 'mes', x.mes, 'valor', x.valor, 'nome', x.nome, 'unidade', x.unidade,
               'local', x.local, 'regiao_id', x.regiao_id, 'sub', x.sub, 'modo', x.modo,
               'amostra', x.amostra, 'aproximado', x.aproximado, 'fonte', x.fonte, 'url', x.url,
               'coletado_em', x.coletado_em)
             order by x.serie, x.mes)
        from public.mercado_indices x
       where x.serie ~ '^(fipezap-natal-|geomapas-alvara-|corrida-|itbi-anual-)'), '[]'::jsonb),
    'n_anuncios', (select count(*) from app.mercado_motor_elegiveis()));
end $$;
comment on function public.mercado_motor_entrada() is
  'Só leitura, para o motor das vantagens no worker: a carteira (com vagas, suítes, título e situação), as regiões, o Censo, as séries que o motor usa (FipeZAP de Natal, alvarás, Corrida), hoje, a rodada de coleta e quantos anúncios entram na conta. Fora da Imova, so_imova; desligada, desligado. Só o worker.';
revoke all on function public.mercado_motor_entrada() from public, anon, authenticated;
grant execute on function public.mercado_motor_entrada() to service_role;

create or replace function public.mercado_motor_anuncios(p_depois uuid default null, p_limite int default 1000)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lim  int := least(greatest(coalesce(p_limite, 1000), 1), 2000);
  v_lista jsonb;
  v_n    int;
  v_fim  uuid;
begin
  if public.empresa_do_banco() is distinct from 'imova' then
    return jsonb_build_object('ok', false, 'motivo', 'so_imova');
  end if;
  if not app.mercado_ligado() then
    return jsonb_build_object('ok', false, 'motivo', 'desligado');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'fonte', e.fonte, 'id_externo', e.id_externo, 'tipo', e.tipo, 'subtipo', e.subtipo,
           'sub', e.sub, 'titulo', e.titulo, 'preco', e.preco, 'area_util', e.area_util,
           'area_total', e.area_total, 'quartos', e.quartos, 'suites', e.suites, 'banheiros', e.banheiros,
           'vagas', e.vagas, 'valor_condominio', e.valor_condominio, 'atributos', e.atributos,
           'bairro', e.bairro, 'cidade', e.cidade, 'logradouro', e.logradouro, 'localidade', e.localidade,
           'regiao_id', e.regiao_id, 'origem', e.origem,
           'visto_em', (e.ultima_vez_visto at time zone 'America/Fortaleza')::date,
           'marcas', to_jsonb(e.marcas), 'possivel_mesmo_imovel', e.possivel_mesmo_imovel)
         order by e.id), '[]'::jsonb),
         count(*)::int, (array_agg(e.id order by e.id desc))[1]
    into v_lista, v_n, v_fim
    from (select m.* from app.mercado_motor_elegiveis() m
           where p_depois is null or m.id > p_depois
           order by m.id
           limit v_lim) e;
  return jsonb_build_object('ok', true, 'anuncios', v_lista,
                            'proximo', case when v_n = v_lim then v_fim end);
end $$;
comment on function public.mercado_motor_anuncios(uuid, int) is
  'Só leitura, para o motor das vantagens no worker: os anúncios de terceiros que entram na conta (app.mercado_motor_elegiveis), em páginas de até 2.000 pela chave id (proximo nulo = acabou), sem link, coordenada nem bruto. Fora da Imova, so_imova; desligada, desligado. Só o worker.';
revoke all on function public.mercado_motor_anuncios(uuid, int) from public, anon, authenticated;
grant execute on function public.mercado_motor_anuncios(uuid, int) to service_role;

  $ddl$;
end $motor$;

notify pgrst, 'reload schema';

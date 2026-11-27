-- =====================================================================
-- O motor das vantagens respeita o "não é" da equipe — só na Imova (27/11/2026)
--
-- O motor (`apps/workers/src/mercado/motor/motor.ts`) tem a regra própria do
-- protótipo para "possível o mesmo imóvel anunciado por outro preço" (mesma
-- região, área a até 3%, preço entre 60% e 140% do nosso, bairro compatível) e
-- ela trava a vantagem de preço. Quando a equipe decide o par em
-- `public.mercado_par_decidir` como "não é" (o anúncio é de outro imóvel), o
-- banco destrava (`app.mercado_preco_bloqueado`), mas o motor não sabia da
-- decisão e travava de novo a cada rodada.
--
-- Caso que trouxe isto: o TE0008 (três terrenos de 2.000 m² em Pipa, R$ 500 mil
-- cada) e um anúncio de 2.000 m² por R$ 600 mil no Chaves na Mão; o dono olhou
-- em 27/11/2026: "Não é o nosso terreno, mas mesmo assim levamos vantagem".
--
-- Aqui `public.mercado_motor_anuncios` passa a mandar, em cada anúncio,
-- `nao_e_de`: os códigos dos imóveis nossos com par decidido "não é" e ainda
-- valendo (`app.mercado_par_vigente`: o preço do anúncio não mudou mais que a
-- régua `proprio.nao_e_ate`, 10%, desde a decisão). O resto da função é o da
-- 20261127150000. Nenhuma tabela muda.
--
-- COMO DESFAZER (no banco da Imova): reaplicar a função
-- `public.mercado_motor_anuncios` da 20261127150000 (o worker ignora a falta
-- de `nao_e_de` e volta a travar o par decidido).
-- =====================================================================

do $respeita$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A inteligência de mercado é só da Imova: no banco da KOMUNE o motor não tem o que ler.';
    return;
  end if;
  execute $ddl$

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
           'marcas', to_jsonb(e.marcas), 'possivel_mesmo_imovel', e.possivel_mesmo_imovel,
           -- Os imóveis nossos para os quais a equipe decidiu que este anúncio NÃO é o mesmo
           -- ("não é", ainda valendo: o preço não mudou mais que a régua desde a decisão).
           'nao_e_de', coalesce((select jsonb_agg(p.imovel_codigo order by p.imovel_codigo)
                                   from public.mercado_pares p
                                  where p.mercado_anuncio_id = e.id and p.decisao = 'nao_e'
                                    and app.mercado_par_vigente(p.decisao, p.preco_na_decisao, e.preco)),
                                '[]'::jsonb))
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
  'Só leitura, para o motor das vantagens no worker: os anúncios de terceiros que entram na conta (app.mercado_motor_elegiveis), em páginas de até 2.000 pela chave id (proximo nulo = acabou), sem link, coordenada nem bruto. Cada anúncio leva nao_e_de: os imóveis nossos para os quais a equipe decidiu que ele não é o mesmo (o motor não o trata como possível o mesmo imóvel desses). Fora da Imova, so_imova; desligada, desligado. Só o worker.';
revoke all on function public.mercado_motor_anuncios(uuid, int) from public, anon, authenticated;
grant execute on function public.mercado_motor_anuncios(uuid, int) to service_role;

  $ddl$;
end $respeita$;

notify pgrst, 'reload schema';

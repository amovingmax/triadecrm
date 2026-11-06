-- =====================================================================
-- A lista de Anúncios com o que o cartão do Canal Pro mostra — só na Imova
-- (05/11/2026)
--
-- Pedido do usuário em 05/11, com print do Canal Pro lado a lado com o CRM:
-- "Preciso que o meu CRM fique igual o Canal Pro". O cartão de lá tem o
-- endereço como título, Venda/Aluguel, "Via Integração", o código com botão de
-- copiar, área, quartos, banheiros e vagas, o preço, "Criado em · Atualizado
-- em", a nota de qualidade, a situação (Publicado, Não publicado, Em
-- processamento), as visualizações e os leads.
--
-- `public.anuncios_na_lista` ganha, NO FIM (create or replace só aceita coluna
-- nova no fim), o que faltava para a tela montar esse cartão e calcular a nota
-- de qualidade com as mesmas regras do protótipo:
--   suites, banheiros, vagas, condominio, iptu, cep, estado, endereco, numero,
--   mostrar_endereco, video_youtube, descricao_tamanho, caracteristicas_qtd,
--   origem, importado_em;
--   ultima_leitura_do_portal: a última vez que o robô do Grupo OLX leu o
--     arquivo do CRM (no ar depois disso = "Em processamento");
--   no_canal_pro_situacao, no_canal_pro_visto_em, no_canal_pro_visualizacoes:
--     o que o último relatório exportado do Canal Pro disse do anúncio de
--     mesmo código (as visualizações só se o relatório tiver a coluna).
--
-- Nada muda em quem lê (security_invoker, as políticas de sempre) nem no
-- WhatsApp. Na KOMUNE não cria nada.
--
-- COMO DESFAZER: recriar public.anuncios_na_lista como na 20261105130000
-- (drop view + create, porque as colunas saem).
-- =====================================================================

do $lista$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

create or replace view public.anuncios_na_lista
with (security_invoker = true) as
select a.id, a.codigo, a.situacao, a.titulo, a.tipo, a.negocio,
       a.preco_venda, a.preco_aluguel, a.periodo_aluguel,
       a.area_util, a.area_total, a.quartos, a.bairro, a.cidade, a.destaque,
       a.criado_em, a.updated_at, a.publicado_em, a.saiu_do_ar_em,
       a.excluido_em, a.motivo_exclusao, a.proprietario_id,
       (select count(*) from public.anuncio_fotos f where f.anuncio_id = a.id)::int as fotos,
       (select f.caminho from public.anuncio_fotos f
         where f.anuncio_id = a.id order by f.posicao, f.criada_em limit 1) as capa,
       app.anuncio_pendencias(a.id) as pendencias,
       o.name as proprietario_nome,
       criador.full_name as criado_por_nome,
       (select m.codigo from public.anuncios_no_canal_pro m where m.anuncio_id = a.id) as codigo_no_canal_pro,
       coalesce(pl.leads, 0)::int as leads,
       -- Daqui para baixo, o que a 20261105140000 acrescentou.
       a.suites, a.banheiros, a.vagas, a.condominio, a.iptu, a.cep, a.estado, a.endereco, a.numero,
       a.mostrar_endereco, a.video_youtube,
       char_length(btrim(coalesce(a.descricao, '')))::int as descricao_tamanho,
       coalesce(cardinality(a.caracteristicas), 0)::int as caracteristicas_qtd,
       a.origem, a.importado_em,
       (select max(l.em) from public.canal_pro_leituras l where l.do_grupo_olx) as ultima_leitura_do_portal,
       rel.situacao as no_canal_pro_situacao,
       rel.visto_em as no_canal_pro_visto_em,
       rel.visualizacoes as no_canal_pro_visualizacoes
  from public.anuncios a
  left join public.organizations_view o on o.id = a.proprietario_id
  left join public.profiles criador on criador.id = a.criado_por
  left join (select v.anuncio_id, count(*) as leads
               from public.portal_leads_na_lista v
              where v.anuncio_id is not null and v.grupo = 'mensagem' and v.situacao <> 'descartado'
              group by v.anuncio_id) pl on pl.anuncio_id = a.id
  left join lateral (
    -- A linha do relatório do Canal Pro: a ligada ao anúncio, senão a do mesmo código.
    select m.situacao, m.visto_em,
           (select nullif(regexp_replace(c.value, '\D', '', 'g'), '')::int
              from jsonb_each_text(m.linha) c
             where c.key ~* 'visualiza'
             limit 1) as visualizacoes
      from public.anuncios_no_canal_pro m
     where (m.anuncio_id = a.id or m.codigo = a.codigo) and m.excluido_em is null
     order by (m.anuncio_id = a.id) desc, m.visto_em desc nulls last
     limit 1) rel on true;
comment on view public.anuncios_na_lista is
  'A lista de Anúncios: cada anúncio com fotos, capa, pendências, proprietário, leads que mandaram mensagem (sem os descartados) e, desde 05/11/2026, o que o cartão do Canal Pro mostra: cômodos, endereço, o que pesa na nota de qualidade, a última leitura do Grupo OLX e o que o último relatório do Canal Pro disse do anúncio.';
revoke all on public.anuncios_na_lista from anon;
grant select on public.anuncios_na_lista to authenticated;

  $ddl$;
end $lista$;

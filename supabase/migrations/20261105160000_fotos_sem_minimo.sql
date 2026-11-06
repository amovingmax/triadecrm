-- =====================================================================
-- Sem mínimo de fotos além de uma — só na Imova (05/11/2026)
--
-- A documentação do Grupo OLX diz "no mínimo 5 imagens", e o CRM pedia 5. O
-- relatório de verdade do Canal Pro mostrou o TE0003_IMOVA ATIVO com 4 fotos.
-- O usuário decidiu em 05/11: "não quero mais um limite de 4 fotos por anúncio,
-- tire essa trava". Fica só o que o formato exige: o <Media> do VRSync é
-- obrigatório e precisa de pelo menos um <Item>, então basta 1 foto.
--
--   * `app.anuncio_pendencias`: "pelo menos 1 foto" (só quando não tem nenhuma);
--   * `public.anuncio_foto_remover`: no ar, a última foto não sai (motivo
--     `no_ar_ultima_foto`, no lugar de `no_ar_menos_de_5`).
--
-- O resto das duas funções fica como na 20261105110000 e na 20261104150000.
-- Na KOMUNE não cria nada.
--
-- COMO DESFAZER: reaplicar as duas funções como estão naquelas migrações.
-- =====================================================================

do $fotos$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$
CREATE OR REPLACE FUNCTION app.anuncio_pendencias(p_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a        public.anuncios;
  t        record;
  v_fotos  int;
  v_n      int;
  v_original text;
  p        text[] := '{}'::text[];
begin
  -- Definer porque lê `canal_pro`, que não tem política. Não abre nada além de
  -- frases sobre um anúncio cujo id a pessoa já precisa ter: a lista
  -- (`anuncios_na_lista`) só a chama nas linhas que a RLS deixou passar.
  select * into a from public.anuncios where id = p_id;
  if not found then
    return null;
  end if;
  select * into t from app.anuncio_tipo(a.tipo);
  select count(*) into v_fotos from public.anuncio_fotos f where f.anuncio_id = p_id;

  v_n := char_length(btrim(a.titulo));
  if v_n < 10 then
    p := p || format('título com 10 a 100 caracteres (tem %s)', v_n);
  elsif a.titulo ~ '[<>]' then
    p := p || 'título sem < nem >'::text;
  end if;
  v_n := char_length(btrim(a.descricao));
  if v_n < 50 then
    p := p || format('descrição com 50 a 3.000 caracteres (tem %s)', v_n);
  elsif a.descricao ~ '<[^>]*>' then
    p := p || 'descrição sem tags HTML'::text;
  end if;
  -- Sem mínimo além de uma (decisão do usuário em 05/11/2026): o <Media> do VRSync
  -- é obrigatório e precisa de pelo menos uma foto.
  if v_fotos < 1 then
    p := p || 'pelo menos 1 foto'::text;
  end if;
  if a.negocio in ('venda', 'venda_aluguel') and a.preco_venda is null then
    p := p || 'preço de venda'::text;
  end if;
  if a.negocio in ('aluguel', 'venda_aluguel') and a.preco_aluguel is null then
    p := p || 'valor do aluguel'::text;
  end if;
  if a.cep is null then p := p || 'CEP'::text; end if;
  if a.estado is null then p := p || 'estado'::text; end if;
  if nullif(btrim(a.cidade), '') is null then p := p || 'cidade'::text; end if;
  if nullif(btrim(a.bairro), '') is null then p := p || 'bairro'::text; end if;
  if t.area = 'util' and a.area_util is null then p := p || 'área útil'::text; end if;
  if t.area = 'total' and a.area_total is null then p := p || 'área total'::text; end if;
  if t.pede_quartos and a.quartos is null then p := p || 'quartos'::text; end if;
  if t.pede_banheiros and a.banheiros is null then p := p || 'banheiros'::text; end if;
  if a.video_youtube is not null
     and a.video_youtube !~* '^https://(www\.|m\.)?(youtube\.com/(watch\?v=|shorts/|embed/)|youtu\.be/)[A-Za-z0-9_-]{6,}' then
    p := p || 'vídeo do YouTube (o portal só aceita YouTube)'::text;
  end if;
  if not exists (select 1 from public.canal_pro c where c.nome is not null and c.email is not null) then
    p := p || 'nome e e-mail da imobiliária, no painel do Canal Pro'::text;
  end if;
  -- Trazido de um anúncio do relatório com OUTRO código: o original precisa
  -- sair do Canal Pro antes, senão o Grupo OLX recusa o do arquivo por
  -- duplicidade. Com o mesmo código (05/11/2026) é o mesmo anúncio: o arquivo
  -- do CRM toma o lugar do sistema atual, e não há o que excluir.
  select m.codigo into v_original
    from public.anuncios_no_canal_pro m
   where m.anuncio_id = p_id and m.excluido_em is null and m.no_relatorio
     and m.codigo is distinct from a.codigo;
  if v_original is not null then
    p := p || format('excluir o original (código %s) no Canal Pro e marcar aqui como excluído', v_original);
  end if;
  return p;
end $function$;
  $ddl$;
  execute $ddl$
CREATE OR REPLACE FUNCTION public.anuncio_foto_remover(p_foto uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.anuncio_fotos;
  a public.anuncios;
begin
  select * into f from public.anuncio_fotos where id = p_foto;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  select * into a from public.anuncios where id = f.anuncio_id for update;
  if not app.anuncio_editavel(a) then
    return jsonb_build_object('ok', false, 'motivo', 'so_gestao_mexe_no_ar');
  end if;
  if a.situacao = 'no_ar'
     and (select count(*) from public.anuncio_fotos x where x.anuncio_id = a.id) <= 1 then
    return jsonb_build_object('ok', false, 'motivo', 'no_ar_ultima_foto');
  end if;
  delete from public.anuncio_fotos where id = p_foto;
  update public.anuncios set updated_at = now(), atualizado_por = auth.uid() where id = a.id;
  return jsonb_build_object('ok', true, 'caminho', f.caminho);
end $function$;
  $ddl$;
  execute $ddl$
comment on function app.anuncio_pendencias(uuid) is
  'O que falta para o anúncio ir ao ar, em frases curtas ("CEP", "pelo menos 1 foto"). Vazio = pode ir. As regras do VRSync do Grupo OLX conferidas em 04/11/2026, sem mínimo de fotos além de uma (decisão de 05/11/2026); o original do relatório só pesa quando o código é outro.';
  $ddl$;
end $fotos$;

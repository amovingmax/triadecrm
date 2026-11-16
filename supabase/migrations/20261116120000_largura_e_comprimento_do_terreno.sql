-- =====================================================================
-- A largura e o comprimento do terreno no anúncio — só na Imova (16/11/2026)
--
-- O usuário: "Quando a gente estiver cadastrando um imóvel nos anúncios do CRM
-- da Imova, eu preciso que tenhamos um campo dedicado à metragem da largura e
-- comprimento do terreno também."
--
-- Duas colunas em `public.anuncios`, em metros, com até duas casas (12,5 m é
-- medida comum de frente), opcionais e para qualquer tipo de imóvel:
--
--   * `largura_terreno`: a frente (testada) do terreno;
--   * `comprimento_terreno`: da frente ao fundo.
--
-- `public.anuncio_salvar` passa a gravá-las; fora isso é a de 20261110100000,
-- linha por linha. Não entram nas pendências (o portal não pede) nem no
-- arquivo do Canal Pro: ficam no CRM. A área total continua à parte (o
-- terreno pode ser irregular); a tela só mostra a conta e oferece pôr na área
-- total.
--
-- Na KOMUNE não cria nada.
--
-- COMO DESFAZER: reaplicar `public.anuncio_salvar` de 20261110100000 e
-- `alter table public.anuncios drop column largura_terreno, drop column
-- comprimento_terreno`.
-- =====================================================================

do $medidas$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 1. As colunas
  -- -------------------------------------------------------------------
  execute $ddl$
alter table public.anuncios
  add column if not exists largura_terreno     numeric(8,2) check (largura_terreno > 0),
  add column if not exists comprimento_terreno numeric(8,2) check (comprimento_terreno > 0)
  $ddl$;
  execute $ddl$
comment on column public.anuncios.largura_terreno is
  'A largura (frente, testada) do terreno, em metros, com até duas casas. Opcional; fica no CRM, não vai ao portal (16/11/2026).'
  $ddl$;
  execute $ddl$
comment on column public.anuncios.comprimento_terreno is
  'O comprimento do terreno (da frente ao fundo), em metros, com até duas casas. Opcional; fica no CRM, não vai ao portal (16/11/2026).'
  $ddl$;

  -- -------------------------------------------------------------------
  -- 2. O salvar grava as medidas
  -- -------------------------------------------------------------------
  -- Igual à de 20261110100000, mais as duas linhas das medidas no UPDATE.
  execute $ddl$
create or replace function public.anuncio_salvar(p_dados jsonb, p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  r       public.anuncios;
  a       public.anuncios;
  v_id    uuid := p_id;
  v_pend  text[];
  v_tag   text;
  v_cod   text;
begin
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  r := jsonb_populate_record(null::public.anuncios, coalesce(p_dados, '{}'::jsonb));

  if r.proprietario_id is not null and not exists (
       select 1 from public.organizations o where o.id = r.proprietario_id and o.deleted_at is null) then
    return jsonb_build_object('ok', false, 'motivo', 'proprietario_invalido');
  end if;

  if v_id is not null then
    select * into a from public.anuncios where id = v_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
    end if;
    if a.excluido_em is not null then
      return jsonb_build_object('ok', false, 'motivo', 'excluido');
    end if;
    if not app.anuncio_editavel(a) then
      return jsonb_build_object('ok', false, 'motivo', 'so_gestao_mexe_no_ar');
    end if;
    -- No rascunho do CRM que nunca foi ao ar, o código segue o tipo: troca só
    -- quando o tipo pede outra tag (ou quando ainda é um IMV-… antigo).
    if a.origem = 'crm' and a.situacao = 'rascunho' and a.publicado_em is null then
      v_tag := app.anuncio_tag_do_tipo(coalesce(r.tipo, a.tipo));
      if v_tag is not distinct from app.anuncio_tag_do_codigo(a.codigo) then
        v_tag := null;
      end if;
    end if;
  else
    v_tag := app.anuncio_tag_do_tipo(coalesce(r.tipo, 'apartamento'));
  end if;

  -- Um código de cada vez: dois salvares ao mesmo tempo não pegam o mesmo
  -- número (a trava vai até o fim da transação).
  if v_tag is not null then
    perform pg_advisory_xact_lock(hashtext('public.anuncios.codigo'));
    v_cod := app.anuncio_proximo_codigo(v_tag);
  end if;

  begin
    if v_id is null then
      insert into public.anuncios (codigo, criado_por, atualizado_por, tipo)
      values (v_cod, auth.uid(), auth.uid(), coalesce(r.tipo, 'apartamento'))
      returning id into v_id;
    end if;

    update public.anuncios set
      codigo           = coalesce(v_cod, codigo),
      titulo           = btrim(coalesce(r.titulo, '')),
      descricao        = btrim(coalesce(r.descricao, '')),
      tipo             = coalesce(r.tipo, tipo),
      negocio          = coalesce(r.negocio, negocio),
      preco_venda      = case when coalesce(r.negocio, negocio) = 'aluguel' then null else r.preco_venda end,
      preco_aluguel    = case when coalesce(r.negocio, negocio) = 'venda' then null else r.preco_aluguel end,
      periodo_aluguel  = coalesce(r.periodo_aluguel, 'mensal'),
      condominio       = r.condominio,
      iptu             = r.iptu,
      iptu_periodo     = coalesce(r.iptu_periodo, 'anual'),
      area_util        = r.area_util,
      area_total       = r.area_total,
      largura_terreno     = r.largura_terreno,
      comprimento_terreno = r.comprimento_terreno,
      quartos          = r.quartos,
      suites           = r.suites,
      banheiros        = r.banheiros,
      vagas            = r.vagas,
      caracteristicas  = coalesce((select array_agg(distinct btrim(c) order by btrim(c))
                                     from unnest(r.caracteristicas) c
                                    where nullif(btrim(c), '') is not null), '{}'),
      cep              = nullif(regexp_replace(coalesce(r.cep, ''), '[^0-9]', '', 'g'), ''),
      estado           = nullif(upper(btrim(coalesce(r.estado, ''))), ''),
      cidade           = nullif(btrim(coalesce(r.cidade, '')), ''),
      bairro           = nullif(btrim(coalesce(r.bairro, '')), ''),
      endereco         = nullif(btrim(coalesce(r.endereco, '')), ''),
      numero           = nullif(btrim(coalesce(r.numero, '')), ''),
      complemento      = nullif(btrim(coalesce(r.complemento, '')), ''),
      mostrar_endereco = coalesce(r.mostrar_endereco, 'rua'),
      video_youtube    = nullif(btrim(coalesce(r.video_youtube, '')), ''),
      proprietario_id  = r.proprietario_id,
      atualizado_por   = auth.uid(),
      updated_at       = now()
    where id = v_id
    returning * into a;

    v_pend := app.anuncio_pendencias(v_id);
    if a.situacao = 'no_ar' and cardinality(v_pend) > 0 then
      raise exception using errcode = 'P0001', message = 'no_ar_com_pendencias';
    end if;
  exception when sqlstate 'P0001' then
    -- O bloco desfaz o que gravou; as pendências ficam para a resposta.
    return jsonb_build_object('ok', false, 'motivo', 'no_ar_com_pendencias', 'pendencias', to_jsonb(v_pend));
  end;

  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', a.codigo,
                            'situacao', a.situacao, 'pendencias', to_jsonb(v_pend));
end $f$
  $ddl$;
  execute $ddl$
comment on function public.anuncio_salvar(jsonb, uuid) is
  'Cria (p_id nulo) ou salva o anúncio com o formulário inteiro. Equipe toda em rascunho e fora do ar; no ar, só admin e gestor, e só sem pendência. O código sai da tag do tipo (TE, SA, IM, CO) e do próximo número livre: ao criar e, no rascunho do CRM que nunca foi ao ar, quando o tipo pede outra tag; nos outros, o código fica. Não publica nada: devolve o que falta para ir ao ar.'
  $ddl$;
  execute 'revoke all on function public.anuncio_salvar(jsonb, uuid) from public, anon';
  execute 'grant execute on function public.anuncio_salvar(jsonb, uuid) to authenticated';
end $medidas$;

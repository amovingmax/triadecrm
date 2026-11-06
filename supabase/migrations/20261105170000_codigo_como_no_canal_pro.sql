-- =====================================================================
-- O código do Canal Pro como ele é — só na Imova (05/11/2026)
--
-- O usuário: "Cada imóvel/terreno possui um código. Esse código deve ser único".
-- O CRM só aceitava código com letras sem acento, números, - e _, e o anúncio
-- trazido do Canal Pro com código como "Casa extremox" ou "Edifício Simone"
-- ganhava um IMV-0001: o imóvel ficava com dois códigos, e, publicado pelo CRM,
-- viraria um anúncio novo no portal em vez de voltar o antigo (com o histórico).
--
-- O VRSync pede do ListingID só 1 a 50 caracteres e que seja único. A regra
-- agora é essa, mais duas: sem espaço nas pontas e sem < > nem caractere de
-- controle (`app.codigo_de_anuncio_valido`). O código não vai para caminho de
-- arquivo nem URL (as fotos e as telas usam o id do anúncio) e sai escapado no XML.
--
--   * `anuncios_codigo_check` passa a usar a função;
--   * `public.anuncio_importar` (sistema atual) e `public.canal_pro_trazer`
--     (relatório) aceitam o código assim; o resto delas fica como estava
--     (20261105110000 e 20261105150000).
--
-- Na KOMUNE não cria nada.
--
-- COMO DESFAZER: com os anúncios de código fora do formato antigo excluídos ou
-- renomeados, voltar o check para `codigo ~ '^[A-Za-z0-9_-]{1,50}$'` e
-- reaplicar as duas funções daquelas migrações.
-- =====================================================================

do $codigo$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$
create or replace function app.codigo_de_anuncio_valido(p text)
returns boolean
language sql
immutable
set search_path = ''
as $f$
  select p is not null
     and char_length(p) between 1 and 50
     and p = btrim(p)
     and p !~ '[[:cntrl:]<>]'
$f$
  $ddl$;
  execute $ddl$
comment on function app.codigo_de_anuncio_valido(text) is
  'O código (ListingID) que o CRM aceita: 1 a 50 caracteres, como o VRSync pede, sem espaço nas pontas e sem < > nem caractere de controle. Aceita o código do Canal Pro como ele é ("Casa extremox"). Decisão do usuário em 05/11/2026: um imóvel, um código.'
  $ddl$;

  execute 'alter table public.anuncios drop constraint anuncios_codigo_check';
  execute 'alter table public.anuncios add constraint anuncios_codigo_check check (app.codigo_de_anuncio_valido(codigo))';

  execute $ddl$
CREATE OR REPLACE FUNCTION public.anuncio_importar(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r       public.anuncios;
  a       public.anuncios;
  v_cod   text := btrim(coalesce(p_dados ->> 'codigo', ''));
  v_id    uuid;
  v_novo  boolean := false;
  v_pend  text[];
  v_fotos int;
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not app.codigo_de_anuncio_valido(v_cod) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_invalido');
  end if;
  r := jsonb_populate_record(null::public.anuncios, coalesce(p_dados, '{}'::jsonb));
  if r.tipo is not null and not app.anuncio_tipo_existe(r.tipo) then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;
  if r.proprietario_id is not null and not exists (
       select 1 from public.organizations o where o.id = r.proprietario_id and o.deleted_at is null) then
    return jsonb_build_object('ok', false, 'motivo', 'proprietario_invalido');
  end if;

  select * into a from public.anuncios where codigo = v_cod for update;
  if found then
    -- Excluído não volta pela importação: volta pelo restaurar, de propósito.
    if a.excluido_em is not null then
      return jsonb_build_object('ok', false, 'motivo', 'excluido', 'id', a.id);
    end if;
    v_id := a.id;
  end if;

  begin
    if v_id is null then
      insert into public.anuncios (codigo, situacao, origem, importado_em, criado_por, atualizado_por, tipo)
      values (v_cod, 'rascunho', 'sistema_atual', now(), auth.uid(), auth.uid(),
              coalesce(r.tipo, 'apartamento'))
      returning id into v_id;
      v_novo := true;
    end if;

    update public.anuncios set
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
      -- O arquivo do sistema atual não sabe do proprietário: trazer de novo não
      -- desfaz a ligação feita no CRM.
      proprietario_id  = coalesce(r.proprietario_id, proprietario_id),
      -- O destaque do arquivo vale para o rascunho; no ar, ele gasta a cota do
      -- plano e só muda por `anuncio_destaque`, que confere as vagas.
      destaque         = case
                           when situacao = 'no_ar' then destaque
                           when r.destaque in ('padrao', 'destaque', 'super_destaque', 'exclusivo', 'superior')
                             then r.destaque
                           else destaque
                         end,
      importado_em     = now(),
      atualizado_por   = auth.uid(),
      updated_at       = now()
    where id = v_id
    returning * into a;

    v_pend := app.anuncio_pendencias(v_id);
    if a.situacao = 'no_ar' and cardinality(v_pend) > 0 then
      raise exception using errcode = 'P0001', message = 'no_ar_com_pendencias';
    end if;
  exception
    when sqlstate 'P0001' then
      -- O bloco desfaz o que gravou; as pendências ficam para a resposta.
      return jsonb_build_object('ok', false, 'motivo', 'no_ar_com_pendencias', 'id', v_id,
                                'pendencias', to_jsonb(v_pend));
    when unique_violation then
      -- Outra importação criou o mesmo código neste instante.
      return jsonb_build_object('ok', false, 'motivo', 'codigo_em_uso');
    when check_violation then
      -- Um valor fora do que o anúncio aceita (negócio, período, CEP...): o
      -- nome da regra diz qual, sem dado de ninguém.
      return jsonb_build_object('ok', false, 'motivo', 'dados_invalidos', 'detalhe', sqlerrm);
  end;

  select count(*) into v_fotos from public.anuncio_fotos f where f.anuncio_id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', a.codigo, 'novo', v_novo,
                            'fotos', v_fotos, 'pendencias', to_jsonb(v_pend));
end $function$;
  $ddl$;

  execute $ddl$
CREATE OR REPLACE FUNCTION public.canal_pro_trazer(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m        public.anuncios_no_canal_pro;
  a        public.anuncios;
  v_neg    text;
  v_cod    text;
  t        record;
  v_desc   text;
  v_cep    text;
  v_uf     text;
  v_util   bigint;
  v_total  bigint;
  v_suites bigint;
  v_banh   bigint;
  v_vagas  bigint;
  v_cond   bigint;
  v_iptu   bigint;
begin
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into m from public.anuncios_no_canal_pro where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if m.anuncio_id is not null then
    select * into a from public.anuncios where id = m.anuncio_id;
    if found and a.excluido_em is null then
      return jsonb_build_object('ok', true, 'anuncio_id', a.id, 'codigo', a.codigo, 'ja_existia', true);
    end if;
  end if;
  -- O código já é de um anúncio do CRM (veio da Arbo com o mesmo ListingID): é o
  -- mesmo anúncio no portal. Liga, em vez de criar outro.
  select * into a from public.anuncios x where x.codigo = m.codigo and x.excluido_em is null;
  if found then
    update public.anuncios_no_canal_pro set anuncio_id = a.id where id = p_id;
    return jsonb_build_object('ok', true, 'anuncio_id', a.id, 'codigo', a.codigo, 'ja_existia', true);
  end if;
  v_neg := coalesce(m.negocio, case when m.preco_aluguel is not null and m.preco_venda is null then 'aluguel'
                                    when m.preco_aluguel is not null and m.preco_venda is not null then 'venda_aluguel'
                                    else 'venda' end);
  select * into t from app.anuncio_tipo(coalesce(m.tipo_crm, 'apartamento'));

  -- O que só a linha do relatório tem (e que o rascunho aceita).
  v_desc := left(app.sem_cpf(app.canal_pro_campo(m.linha, array['descricao'])), 3000);
  v_cep := regexp_replace(coalesce(app.canal_pro_campo(m.linha, array['cep']), ''), '\D', '', 'g');
  v_cep := case when v_cep ~ '^[0-9]{8}$' then v_cep end;
  v_uf := app.uf_do_estado(app.canal_pro_campo(m.linha, array['estado', 'uf']));
  v_util := nullif(app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['area util'])), 0);
  v_total := nullif(app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['area total'])), 0);
  v_suites := app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['suites']));
  v_banh := app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['banheiros']));
  v_vagas := app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['vagas']));
  v_cond := app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['condominio/mes', 'condominio']));
  v_iptu := app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['iptu/ano', 'iptu']));

  -- O mesmo código do Canal Pro, quando ele cabe no ListingID e ninguém no CRM o usa.
  if app.codigo_de_anuncio_valido(m.codigo)
     and not exists (select 1 from public.anuncios x where x.codigo = m.codigo) then
    v_cod := m.codigo;
  end if;

  insert into public.anuncios
    (codigo, origem, tipo, negocio, titulo, descricao, preco_venda, preco_aluguel, condominio, iptu,
     cep, estado, bairro, cidade, endereco, area_util, area_total, quartos, suites, banheiros, vagas,
     criado_por, atualizado_por)
  values
    -- Código fora do formato ou já em uso: o da sequência (o padrão da coluna).
    (coalesce(v_cod, 'IMV-' || lpad(nextval('public.anuncios_codigo_seq'::regclass)::text, 4, '0')), 'relatorio_canal_pro', coalesce(m.tipo_crm, 'apartamento'), v_neg,
     left(coalesce(m.titulo, ''), 100), coalesce(v_desc, ''),
     case when v_neg <> 'aluguel' then m.preco_venda end,
     case when v_neg <> 'venda' then m.preco_aluguel end,
     case when v_cond between 0 and 10000000 then v_cond end,
     case when v_iptu between 0 and 10000000 then v_iptu end,
     v_cep, v_uf, left(m.bairro, 80), left(m.cidade, 80), left(m.endereco, 120),
     case when t.area = 'util' then coalesce(case when v_util between 1 and 10000000 then v_util end, m.area)
          when v_util between 1 and 10000000 then v_util end,
     case when t.area = 'total' then coalesce(case when v_total between 1 and 100000000 then v_total end, m.area)
          when v_total between 1 and 100000000 then v_total end,
     m.quartos,
     case when v_suites between 0 and 99 then v_suites end,
     case when v_banh between 0 and 99 then v_banh end,
     case when v_vagas between 0 and 999 then v_vagas end,
     auth.uid(), auth.uid())
  returning * into a;

  update public.anuncios_no_canal_pro set anuncio_id = a.id where id = p_id;
  return jsonb_build_object('ok', true, 'anuncio_id', a.id, 'codigo', a.codigo, 'ja_existia', false);
end $function$;
  $ddl$;
end $codigo$;

-- =====================================================================
-- Excluir duplicado — só na Imova (06/11/2026)
--
-- O usuário: "Quero que o CRM seja capaz de excluir anúncios duplicados." O
-- Grupo OLX não dá ao CRM nenhum comando para excluir anúncio no Canal Pro, e os
-- repetidos que estão no ar foram cadastrados lá à mão. Escolha do usuário: o
-- CRM mostra o repetido, copia o código e abre o Canal Pro; a exclusão é um
-- clique lá; o CRM confirma pelo próximo relatório.
--
-- O que muda no banco é a confirmação. Até aqui, o anúncio marcado como
-- excluído que aparecia de novo no relatório voltava para a lista calado, como
-- se nunca tivesse sido marcado. Agora `canal_pro_importar` guarda em
-- `marcado_excluido_em` quando ele tinha sido marcado, e a tela avisa que a
-- exclusão não pegou. Marcar de novo apaga o aviso.
--
-- Na KOMUNE não cria nada.
--
-- COMO DESFAZER: reaplicar `canal_pro_importar` da 20261106100000 e
-- `canal_pro_marcar_excluido` da 20261104150000; depois
--   alter table public.anuncios_no_canal_pro drop column marcado_excluido_em;
-- =====================================================================

do $duplicado$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$
alter table public.anuncios_no_canal_pro
  add column if not exists marcado_excluido_em timestamptz;
comment on column public.anuncios_no_canal_pro.marcado_excluido_em is
  'Quando alguém tinha marcado este anúncio como excluído no Canal Pro, se um relatório importado depois ainda o trouxe: a exclusão não pegou. Volta a nulo quando alguém marca de novo.';

create or replace function public.canal_pro_marcar_excluido(p_id uuid, p_excluido boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.anuncios_no_canal_pro
     set excluido_em = case when p_excluido then now() end,
         excluido_por = case when p_excluido then auth.uid() end,
         -- Uma marca nova é outra tentativa: o aviso da anterior sai.
         marcado_excluido_em = case when p_excluido then null else marcado_excluido_em end
   where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'anuncios_no_canal_pro', p_id::text, null,
          jsonb_build_object('excluido_no_canal_pro', p_excluido));
  return jsonb_build_object('ok', true);
end $f$;
comment on function public.canal_pro_marcar_excluido(uuid, boolean) is
  'A gestão confirma que excluiu (ou desfaz) um anúncio no Canal Pro: ele sai da lista e da conta de vagas até o próximo relatório, que confirma (se ainda vier, volta com `marcado_excluido_em`). Só admin e gestor.';

create or replace function public.canal_pro_importar(p_anuncios jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  -- O relógio, e não `now()`: duas importações na mesma transação (o pgTAP)
  -- teriam o mesmo `now()`, e ninguém sairia do relatório.
  v_agora    timestamptz := clock_timestamp();
  v_item     jsonb;
  v_codigo   text;
  v_tipo     text;
  v_neg      text;
  v_novo     boolean;
  v_novos    int := 0;
  v_vistos   int := 0;
  v_sairam   int;
  v_id       uuid;
  m          public.anuncios_no_canal_pro;
  v_r        jsonb;
  v_trazidos int := 0;
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if jsonb_typeof(p_anuncios) is distinct from 'array' or jsonb_array_length(p_anuncios) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'relatorio_vazio');
  end if;
  if jsonb_array_length(p_anuncios) > 2000 then
    return jsonb_build_object('ok', false, 'motivo', 'relatorio_grande_demais');
  end if;

  for v_item in select x from jsonb_array_elements(p_anuncios) x loop
    v_codigo := left(nullif(btrim(v_item ->> 'codigo'), ''), 80);
    continue when v_codigo is null;
    v_tipo := case when app.anuncio_tipo_existe(v_item ->> 'tipo_crm') then v_item ->> 'tipo_crm' end;
    v_neg := case when v_item ->> 'negocio' in ('venda', 'aluguel', 'venda_aluguel')
                  then v_item ->> 'negocio' end;
    insert into public.anuncios_no_canal_pro as atual
      (codigo, titulo, tipo, tipo_crm, negocio, preco_venda, preco_aluguel, bairro, cidade,
       endereco, area, quartos, destaque, situacao, link, linha, no_relatorio, visto_em)
    values
      (v_codigo,
       left(nullif(btrim(v_item ->> 'titulo'), ''), 300),
       left(nullif(btrim(v_item ->> 'tipo'), ''), 80),
       v_tipo, v_neg,
       nullif((v_item ->> 'preco_venda')::bigint, 0),
       nullif((v_item ->> 'preco_aluguel')::bigint, 0),
       left(nullif(btrim(v_item ->> 'bairro'), ''), 120),
       left(nullif(btrim(v_item ->> 'cidade'), ''), 120),
       left(nullif(btrim(v_item ->> 'endereco'), ''), 200),
       nullif((v_item ->> 'area')::int, 0),
       case when (v_item ->> 'quartos')::int between 0 and 99 then (v_item ->> 'quartos')::smallint end,
       left(nullif(btrim(v_item ->> 'destaque'), ''), 80),
       left(nullif(btrim(v_item ->> 'situacao'), ''), 80),
       left(nullif(btrim(v_item ->> 'link'), ''), 500),
       coalesce(v_item -> 'linha', '{}'::jsonb),
       true, v_agora)
    on conflict (codigo) do update
      set titulo = excluded.titulo, tipo = excluded.tipo, tipo_crm = excluded.tipo_crm,
          negocio = excluded.negocio, preco_venda = excluded.preco_venda,
          preco_aluguel = excluded.preco_aluguel, bairro = excluded.bairro,
          cidade = excluded.cidade, endereco = excluded.endereco, area = excluded.area,
          quartos = excluded.quartos, destaque = excluded.destaque, situacao = excluded.situacao,
          link = excluded.link, linha = excluded.linha, no_relatorio = true, visto_em = v_agora,
          -- Marcado como excluído e ainda no relatório: a exclusão não pegou. Volta
          -- para a lista, e a marca antiga fica para a tela avisar (06/11/2026).
          marcado_excluido_em = coalesce(atual.excluido_em, atual.marcado_excluido_em),
          excluido_em = null, excluido_por = null
    returning (xmax = 0) into v_novo;
    v_vistos := v_vistos + 1;
    if v_novo then v_novos := v_novos + 1; end if;
  end loop;

  if v_vistos = 0 then
    -- Nenhuma linha com código: não é o relatório (ou veio sem a coluna). Nada muda.
    raise exception using errcode = 'P0001', message = 'relatorio_sem_codigo';
  end if;

  update public.anuncios_no_canal_pro
     set no_relatorio = false
   where visto_em < v_agora and no_relatorio;
  get diagnostics v_sairam = row_count;

  update public.canal_pro
     set importado_em = v_agora, importado_por = auth.uid(), importados = v_vistos
   where um;

  -- O que só existe no Canal Pro vem para o CRM (decisão do usuário, 06/11/2026).
  -- Fica de fora: o código que o CRM já tem (mesmo excluído), a linha já ligada a
  -- um anúncio (mesmo excluído), a marcada como fora do ar e a que parece o mesmo
  -- imóvel de um anúncio do CRM (cópia antiga). Primeiro os ativos: entre duas
  -- linhas do mesmo imóvel, vem a ativa, e a outra passa a parecer com ela.
  for v_id in
    select x.id
      from public.anuncios_no_canal_pro x
     where x.visto_em = v_agora and x.no_relatorio and x.excluido_em is null
       and x.anuncio_id is null
       and not exists (select 1 from public.anuncios a where a.codigo = x.codigo)
     order by app.canal_pro_ativo_no_relatorio(x.situacao) desc, x.codigo
  loop
    select * into m from public.anuncios_no_canal_pro where id = v_id;
    continue when public.canal_pro_parece_com(m) is not null;
    v_r := public.canal_pro_trazer(v_id);
    if coalesce((v_r ->> 'ok')::boolean, false) and not coalesce((v_r ->> 'ja_existia')::boolean, false) then
      v_trazidos := v_trazidos + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'anuncios', v_vistos, 'novos', v_novos, 'sairam', v_sairam,
                            'trazidos', v_trazidos);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'motivo', 'relatorio_sem_codigo');
end $f$;
comment on function public.canal_pro_importar(jsonb) is
  'Grava o relatório exportado do Canal Pro (uma linha por código; o que não veio sai do relatório; o marcado como excluído que ainda veio volta, com `marcado_excluido_em`) e traz para o CRM, com `canal_pro_trazer`, o que só existe lá e não é cópia de um anúncio do CRM. Devolve anuncios, novos, sairam e trazidos. Só admin e gestor.';
  $ddl$;
end $duplicado$;

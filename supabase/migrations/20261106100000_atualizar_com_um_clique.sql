-- =====================================================================
-- Atualizar com um clique — só na Imova (06/11/2026)
--
-- O usuário: "Quero que façamos uma automação que sempre que clicarmos nos
-- botões a gente já receba a lista dos anúncios dentro do nosso CRM. E dentro do
-- CRM a gente deve listar aqueles anúncios que estão no ar, os que estão
-- inativos e os rascunhos."
--
--   1. O ENDEREÇO DO SISTEMA ATUAL fica guardado (`canal_pro.sistema_atual_url`):
--      colado uma vez, o botão lê de novo sem pedir. É credencial (a chave vai
--      no caminho): só admin e gestor leem (`sistema_atual_endereco`, que o
--      servidor chama) e trocam (`sistema_atual_endereco_salvar`). A tela só
--      sabe se há endereço e quando foi lido (`canal_pro_situacao`).
--   2. QUEM ESTÁ NO ARQUIVO DO SISTEMA ATUAL (`sistema_atual_no_arquivo`, por
--      código): cada leitura completa registra os códigos que vieram
--      (`sistema_atual_leitura_registrar`); o que estava e sumiu fica marcado
--      como fora, com a hora. Tabela à parte, e não coluna em `anuncios`, para a
--      leitura diária não encher a auditoria. A lista mostra os dois campos, e a
--      tela decide publicado / não publicado com eles e com o relatório.
--   3. O RELATÓRIO DO CANAL PRO TRAZ SOZINHO o que só existe lá: depois de
--      gravar as linhas, `canal_pro_importar` chama `canal_pro_trazer` para cada
--      linha sem anúncio no CRM — nem com o mesmo código (excluído inclusive:
--      quem excluiu não quer de volta), nem ligada, nem marcada como fora do
--      ar — que não pareça o mesmo imóvel de um anúncio do CRM
--      (`canal_pro_parece_com`, a mesma regra que a tela usava: mesma cidade,
--      mesma área e, quando os dois dizem, o mesmo bairro). As cópias antigas
--      ficam na lista de baixo, como antes.
--   4. `canal_pro_parece_com` sai da tela (TypeScript) para o banco, como campo
--      calculado: a tela e a importação usam a mesma conta.
--
-- Na KOMUNE não cria nada.
--
-- COMO DESFAZER: reaplicar `canal_pro_importar` e `canal_pro_situacao` da
-- 20261104150000 e a `anuncios_na_lista` da 20261105150000; depois
--   drop function public.sistema_atual_leitura_registrar(text[]);
--   drop function public.sistema_atual_endereco();
--   drop function public.sistema_atual_endereco_salvar(text);
--   drop function public.canal_pro_parece_com(public.anuncios_no_canal_pro);
--   drop table public.sistema_atual_no_arquivo;
--   alter table public.canal_pro drop column sistema_atual_url, drop column sistema_atual_lido_em;
-- =====================================================================

do $clique$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$
-- =====================================================================
-- 1. O endereço do sistema atual
-- =====================================================================
alter table public.canal_pro
  add column if not exists sistema_atual_url text
    check (sistema_atual_url is null
           or (sistema_atual_url ~ '^https?://\S+$' and char_length(sistema_atual_url) <= 2000)),
  add column if not exists sistema_atual_lido_em timestamptz;
comment on column public.canal_pro.sistema_atual_url is
  'O endereço do arquivo VRSync do sistema que publica hoje (Canal Pro > Configurações da conta > Integração de anúncios). Credencial: só admin e gestor, por função.';
comment on column public.canal_pro.sistema_atual_lido_em is
  'A última leitura completa do arquivo do sistema atual (`sistema_atual_leitura_registrar`).';

create or replace function public.sistema_atual_endereco_salvar(p_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if v is not null and (v !~ '^https?://\S+$' or char_length(v) > 2000) then
    return jsonb_build_object('ok', false, 'motivo', 'url_invalida');
  end if;
  update public.canal_pro
     set sistema_atual_url = v, atualizado_em = now(), atualizado_por = auth.uid()
   where um;
  return jsonb_build_object('ok', true, 'salvo', v is not null);
end $f$;
comment on function public.sistema_atual_endereco_salvar(text) is
  'Guarda (ou esquece, com vazio) o endereço do arquivo do sistema atual. Só admin e gestor.';
revoke all on function public.sistema_atual_endereco_salvar(text) from public, anon;
grant execute on function public.sistema_atual_endereco_salvar(text) to authenticated;

create or replace function public.sistema_atual_endereco()
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select c.sistema_atual_url from public.canal_pro c where c.um and app.admin_ou_gestor()
$f$;
comment on function public.sistema_atual_endereco() is
  'O endereço guardado, para o servidor buscar o arquivo. Só admin e gestor; para os outros, nulo.';
revoke all on function public.sistema_atual_endereco() from public, anon;
grant execute on function public.sistema_atual_endereco() to authenticated;

-- =====================================================================
-- 2. Quem está no arquivo do sistema atual
-- =====================================================================
create table if not exists public.sistema_atual_no_arquivo (
  codigo     text primary key check (char_length(codigo) between 1 and 80),
  no_arquivo boolean not null,
  em         timestamptz not null default now()
);
comment on table public.sistema_atual_no_arquivo is
  'Os códigos do arquivo do sistema atual: no_arquivo = estava na última leitura completa (em = essa leitura); false = sumiu dele (em = a leitura em que sumiu). Escrita só por `sistema_atual_leitura_registrar`.';
alter table public.sistema_atual_no_arquivo enable row level security;
create policy sistema_atual_no_arquivo_select on public.sistema_atual_no_arquivo
  for select to authenticated using ((select app.is_manager()));
revoke all on public.sistema_atual_no_arquivo from anon, authenticated;
grant select on public.sistema_atual_no_arquivo to authenticated;

-- Os anúncios que já vieram do sistema atual estavam no arquivo quando vieram.
insert into public.sistema_atual_no_arquivo (codigo, no_arquivo, em)
select a.codigo, true, coalesce(a.importado_em, a.criado_em)
  from public.anuncios a
 where a.origem = 'sistema_atual' and a.excluido_em is null
on conflict (codigo) do nothing;

create or replace function public.sistema_atual_leitura_registrar(p_codigos text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  -- O relógio, como em `canal_pro_importar`: duas leituras na mesma transação
  -- (o pgTAP) teriam o mesmo `now()`.
  v_agora     timestamptz := clock_timestamp();
  v_presentes int;
  v_sairam    int;
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  -- Arquivo vazio não é "todos saíram": é arquivo com problema. Nada muda.
  if coalesce(cardinality(array_remove(p_codigos, null)), 0) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'arquivo_vazio');
  end if;

  insert into public.sistema_atual_no_arquivo as s (codigo, no_arquivo, em)
  select distinct left(btrim(c), 80), true, v_agora
    from unnest(p_codigos) c
   where nullif(btrim(c), '') is not null
  on conflict (codigo) do update set no_arquivo = true, em = v_agora;
  get diagnostics v_presentes = row_count;

  update public.sistema_atual_no_arquivo
     set no_arquivo = false, em = v_agora
   where no_arquivo and em < v_agora;
  get diagnostics v_sairam = row_count;

  update public.canal_pro set sistema_atual_lido_em = v_agora where um;

  return jsonb_build_object('ok', true, 'no_arquivo', v_presentes, 'sairam', v_sairam);
end $f$;
comment on function public.sistema_atual_leitura_registrar(text[]) is
  'Depois de uma leitura completa do arquivo do sistema atual: marca os códigos que vieram e, como fora, os que estavam e sumiram. Só admin e gestor.';
revoke all on function public.sistema_atual_leitura_registrar(text[]) from public, anon;
grant execute on function public.sistema_atual_leitura_registrar(text[]) to authenticated;

-- =====================================================================
-- 3. Parece o mesmo imóvel (era `pareceOMesmoImovel`, na tela)
-- =====================================================================
create or replace function public.canal_pro_parece_com(m public.anuncios_no_canal_pro)
returns uuid
language sql
stable
set search_path = ''
as $f$
  select a.id
    from public.anuncios a
   where m.area is not null
     and app.chave_catalogo(m.cidade) is not null
     and a.excluido_em is null
     and a.codigo <> m.codigo
     and a.id is distinct from m.anuncio_id
     and app.chave_catalogo(a.cidade) = app.chave_catalogo(m.cidade)
     and (a.area_util = m.area or a.area_total = m.area)
     and (app.chave_catalogo(m.bairro) is null or app.chave_catalogo(a.bairro) is null
          or app.chave_catalogo(a.bairro) = app.chave_catalogo(m.bairro))
   order by a.criado_em, a.id
   limit 1
$f$;
comment on function public.canal_pro_parece_com(public.anuncios_no_canal_pro) is
  'O anúncio do CRM que parece o MESMO imóvel de uma linha do relatório com outro código: mesma cidade, mesma área e, quando os dois dizem, o mesmo bairro. No relatório da Imova (05/11/2026), 6 dos 10 anúncios antigos eram o mesmo imóvel de um atual. Campo calculado na API (`parece_com:canal_pro_parece_com`); com a RLS de quem pergunta.';
revoke all on function public.canal_pro_parece_com(public.anuncios_no_canal_pro) from public, anon;
grant execute on function public.canal_pro_parece_com(public.anuncios_no_canal_pro) to authenticated;

-- =====================================================================
-- 4. O relatório traz sozinho o que só existe no Canal Pro
-- =====================================================================
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
    insert into public.anuncios_no_canal_pro as m
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
  'Grava o relatório exportado do Canal Pro (uma linha por código; o que não veio sai do relatório) e traz para o CRM, com `canal_pro_trazer`, o que só existe lá e não é cópia de um anúncio do CRM. Devolve anuncios, novos, sairam e trazidos. Só admin e gestor.';

-- =====================================================================
-- 5. A situação do Canal Pro diz se há endereço do sistema atual
-- =====================================================================
create or replace function public.canal_pro_situacao()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare
  c public.canal_pro;
  l public.canal_pro_leituras;
  o record;
begin
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into c from public.canal_pro limit 1;
  select * into l from public.canal_pro_leituras where do_grupo_olx order by em desc limit 1;
  select * into o from app.canal_pro_ocupadas();
  return jsonb_build_object(
    'ok', true,
    -- A chave é credencial: só para quem cola a URL no Canal Pro.
    'chave', case when app.admin_ou_gestor() then c.chave end,
    'nome', c.nome, 'email', c.email, 'telefone', c.telefone, 'site', c.site,
    'ultima_leitura', case when l.id is null then null
                           else jsonb_build_object('em', l.em, 'anuncios', l.anuncios) end,
    'leituras_7_dias', (select count(*) from public.canal_pro_leituras x
                         where x.do_grupo_olx and x.em > now() - interval '7 days'),
    'importado_em', c.importado_em,
    'importados', c.importados,
    'plano', jsonb_build_object(
      'anuncios', c.limite_anuncios, 'destaques', c.limite_destaques,
      'anuncios_em_uso', o.anuncios, 'destaques_em_uso', o.destaques),
    -- O endereço é credencial: a tela só sabe se ele existe.
    'sistema_atual', jsonb_build_object(
      'tem_endereco', c.sistema_atual_url is not null,
      'lido_em', c.sistema_atual_lido_em));
end $f$;

-- =====================================================================
-- 6. A lista diz se o anúncio está no arquivo do sistema atual
-- =====================================================================
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
       a.suites, a.banheiros, a.vagas, a.condominio, a.iptu, a.cep, a.estado, a.endereco, a.numero,
       a.mostrar_endereco, a.video_youtube,
       char_length(btrim(coalesce(a.descricao, '')))::int as descricao_tamanho,
       coalesce(cardinality(a.caracteristicas), 0)::int as caracteristicas_qtd,
       a.origem, a.importado_em,
       (select max(l.em) from public.canal_pro_leituras l where l.do_grupo_olx) as ultima_leitura_do_portal,
       rel.situacao as no_canal_pro_situacao,
       rel.visto_em as no_canal_pro_visto_em,
       rel.visualizacoes as no_canal_pro_visualizacoes,
       rel.contatos as no_canal_pro_contatos,
       rel.criado_em as no_canal_pro_criado_em,
       -- Daqui para baixo, o que a 20261106100000 acrescentou.
       s.no_arquivo as no_sistema_atual,
       s.em as sistema_atual_em
  from public.anuncios a
  left join public.organizations_view o on o.id = a.proprietario_id
  left join public.profiles criador on criador.id = a.criado_por
  left join (select v.anuncio_id, count(*) as leads
               from public.portal_leads_na_lista v
              where v.anuncio_id is not null and v.grupo = 'mensagem' and v.situacao <> 'descartado'
              group by v.anuncio_id) pl on pl.anuncio_id = a.id
  left join public.sistema_atual_no_arquivo s on s.codigo = a.codigo
  left join lateral (
    select m.situacao, m.visto_em,
           app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['total de visualizacoes', 'visualizacoes']))::int
             as visualizacoes,
           app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['total de contatos', 'contatos']))::int
             as contatos,
           case when app.canal_pro_campo(m.linha, array['criacao', 'data de criacao']) ~ '^\d{2}-\d{2}-\d{4}$'
                then to_date(app.canal_pro_campo(m.linha, array['criacao', 'data de criacao']), 'DD-MM-YYYY') end
             as criado_em
      from public.anuncios_no_canal_pro m
     -- Só o que ainda está no último relatório: o que saiu dele não está mais no Canal Pro.
     where (m.anuncio_id = a.id or m.codigo = a.codigo) and m.excluido_em is null and m.no_relatorio
     order by (m.anuncio_id = a.id) desc, m.visto_em desc nulls last
     limit 1) rel on true;
comment on view public.anuncios_na_lista is
  'A lista de Anúncios: fotos, capa, pendências, proprietário, leads que mandaram mensagem, o que o cartão do Canal Pro mostra (cômodos, endereço, insumos da nota, última leitura do Grupo OLX), o que o último relatório do Canal Pro disse do anúncio (situação, visualizações, contatos, data de criação) e se ele está no arquivo do sistema atual (e desde quando).';
revoke all on public.anuncios_na_lista from anon;
grant select on public.anuncios_na_lista to authenticated;
  $ddl$;
end $clique$;

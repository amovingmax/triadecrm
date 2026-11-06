-- =====================================================================
-- O relatório de verdade do Canal Pro — só na Imova (05/11/2026)
--
-- Em 05/11 o usuário exportou o relatório do Canal Pro (planilha "Anúncios",
-- 17 linhas). As colunas, que nenhuma fonte publicava, são:
--   ID Interno · Código do Imóvel · Tipo do imóvel · Status do anúncio (Ativo,
--   Inativo) · Motivo da Inativação · Tipo do anúncio (Padrão, Destaque) · CEP ·
--   Endereço · Bairro · Cidade · Estado (por extenso) · Quartos · Suítes ·
--   Banheiros · Vagas · Área útil · Área total · Valor de Venda · Valor do
--   aluguel · Período do aluguel (MONTHLY) · Condomínio/mês · IPTU/ano ·
--   Benefícios do imóvel · Título do imóvel · Tamanho do título · Descrição ·
--   Tamanho da descrição · Número de fotos · Vídeo · Tour Virtual · Total de
--   visualizações · Total de contatos · Criação (DD-MM-AAAA) · Última
--   atualização · Sem atualização há mais de 30 dias · Vendido/Alugado
--
-- "Código do Imóvel" é o ListingID que o sistema publica (SA0012_IMOVA): é ele
-- que a leitura do site usa como código, e os anúncios que já vieram da Arbo não
-- se repetem. A linha inteira já fica em `anuncios_no_canal_pro.linha`. Aqui:
--
--   1. `public.canal_pro_trazer` traz para o rascunho também o que a linha tem e
--      as colunas fixas não: descrição, CEP, estado (vira a sigla), suítes,
--      banheiros, vagas, área útil e total, condomínio e IPTU. Fotos não vêm: o
--      relatório só diz quantas são.
--   2. `public.anuncios_na_lista` ganha, no fim, os contatos e a data de criação
--      que o Canal Pro informa (o cartão mostra "Criado em" de lá, quando houver).
--   3. Só o que está ATIVO no Canal Pro ocupa vaga do plano
--      (`app.canal_pro_ocupadas`): o relatório de verdade tem 9 ativos e 8
--      inativos, e os inativos não estão no portal.
--   4. "Trazer para o CRM" de uma linha cujo código já é de um anúncio do CRM
--      (os 7 que vieram da Arbo) liga os dois em vez de criar outro anúncio.
--
-- Na KOMUNE não cria nada. O WhatsApp não é tocado.
--
-- COMO DESFAZER: reaplicar `canal_pro_trazer` e `app.canal_pro_ocupadas` da
-- 20261105110000, drop de app.canal_pro_ativo_no_relatorio(text), e
-- `anuncios_na_lista` da 20261105140000 (drop + create); drop das funções
-- app.canal_pro_campo(jsonb, text[]), app.canal_pro_inteiro(text) e
-- app.uf_do_estado(text).
-- =====================================================================

do $relatorio$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. Ler a linha do relatório
-- =====================================================================
-- O valor da primeira coluna cujo nome, sem acento e em minúsculas, está na lista.
create or replace function app.canal_pro_campo(p_linha jsonb, p_nomes text[])
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(btrim(e.value), '')
    from jsonb_each_text(coalesce(p_linha, '{}'::jsonb)) e
   where lower(extensions.unaccent(btrim(e.key))) = any (p_nomes)
   order by array_position(p_nomes, lower(extensions.unaccent(btrim(e.key))))
   limit 1
$$;
comment on function app.canal_pro_campo(jsonb, text[]) is
  'O valor de uma coluna da linha do relatório do Canal Pro, pelo nome sem acento e em minúsculas.';
revoke all on function app.canal_pro_campo(jsonb, text[]) from public, anon;
grant execute on function app.canal_pro_campo(jsonb, text[]) to authenticated;

-- "350", "1.050", "3800,00" → inteiro; o resto → null.
create or replace function app.canal_pro_inteiro(p text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
           when p ~ '^\s*\d{1,3}(\.\d{3})+(,\d+)?\s*$' then replace(split_part(btrim(p), ',', 1), '.', '')::bigint
           when p ~ '^\s*\d{1,15}([.,]\d+)?\s*$' then split_part(split_part(btrim(p), ',', 1), '.', 1)::bigint
         end
$$;
comment on function app.canal_pro_inteiro(text) is
  'Número inteiro de uma célula do relatório do Canal Pro ("1.050", "3800,00"); o que não é número vira null.';
revoke all on function app.canal_pro_inteiro(text) from public, anon;
grant execute on function app.canal_pro_inteiro(text) to authenticated;

-- "Rio Grande do Norte" → "RN" (e a sigla continua sigla).
create or replace function app.uf_do_estado(p text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when upper(btrim(p)) ~ '^[A-Z]{2}$' then upper(btrim(p))
           else (select u.uf from (values
             ('acre', 'AC'), ('alagoas', 'AL'), ('amapa', 'AP'), ('amazonas', 'AM'), ('bahia', 'BA'),
             ('ceara', 'CE'), ('distrito federal', 'DF'), ('espirito santo', 'ES'), ('goias', 'GO'),
             ('maranhao', 'MA'), ('mato grosso', 'MT'), ('mato grosso do sul', 'MS'),
             ('minas gerais', 'MG'), ('para', 'PA'), ('paraiba', 'PB'), ('parana', 'PR'),
             ('pernambuco', 'PE'), ('piaui', 'PI'), ('rio de janeiro', 'RJ'),
             ('rio grande do norte', 'RN'), ('rio grande do sul', 'RS'), ('rondonia', 'RO'),
             ('roraima', 'RR'), ('santa catarina', 'SC'), ('sao paulo', 'SP'), ('sergipe', 'SE'),
             ('tocantins', 'TO')) u(nome, uf)
                  where u.nome = lower(extensions.unaccent(btrim(coalesce(p, '')))))
         end
$$;
comment on function app.uf_do_estado(text) is 'A sigla do estado brasileiro pelo nome por extenso (sem acento ou com).';
revoke all on function app.uf_do_estado(text) from public, anon;
grant execute on function app.uf_do_estado(text) to authenticated;

-- "Ativo" (ou sem situação, como era antes do relatório de verdade) está no ar
-- no Canal Pro; "Inativo", "Bloqueado" e o resto, não.
create or replace function app.canal_pro_ativo_no_relatorio(p_situacao text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(btrim(p_situacao), '') = ''
      or lower(extensions.unaccent(btrim(p_situacao))) ~ '^(ativo|ativa|publicado|publicada|no ar|em processamento)( |$)'
$$;
comment on function app.canal_pro_ativo_no_relatorio(text) is
  'A situação do relatório do Canal Pro quer dizer que o anúncio está no ar? Ativo sim; Inativo, Bloqueado e o resto não.';
revoke all on function app.canal_pro_ativo_no_relatorio(text) from public, anon;
grant execute on function app.canal_pro_ativo_no_relatorio(text) to authenticated;

-- As vagas do plano: os do CRM no ar e os ATIVOS do relatório que não têm par no ar no CRM.
create or replace function app.canal_pro_ocupadas(p_fora uuid default null)
returns table (anuncios int, destaques int)
language sql
stable
set search_path = ''
as $$
  with manuais as (
    select m.destaque
      from public.anuncios_no_canal_pro m
     where m.no_relatorio and m.excluido_em is null
       and app.canal_pro_ativo_no_relatorio(m.situacao)
       and not exists (select 1 from public.anuncios a
                        where a.situacao = 'no_ar' and a.excluido_em is null
                          and (a.codigo = m.codigo or a.id = m.anuncio_id))
  )
  select
    ((select count(*) from public.anuncios a
       where a.situacao = 'no_ar' and a.excluido_em is null and a.id is distinct from p_fora)
     + (select count(*) from manuais))::int,
    ((select count(*) from public.anuncios a
       where a.situacao = 'no_ar' and a.excluido_em is null and a.destaque <> 'padrao'
         and a.id is distinct from p_fora)
     + (select count(*) from manuais m where app.canal_pro_destaque_do_relatorio(m.destaque)))::int
$$;

-- =====================================================================
-- 2. Trazer para o CRM com o que o relatório tem
-- =====================================================================
create or replace function public.canal_pro_trazer(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- O mesmo ListingID, quando ele cabe no formato e ninguém no CRM o usa.
  if m.codigo ~ '^[A-Za-z0-9_-]{1,50}$'
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
end $$;
comment on function public.canal_pro_trazer(uuid) is
  'Cria no CRM o rascunho de um anúncio do relatório do Canal Pro (admin, gestor e SDR), com o mesmo código quando ele cabe e está livre, e com o que a linha do relatório tem (descrição, CEP, estado, cômodos, áreas, condomínio, IPTU). Fotos não vêm. Se já foi trazido, devolve o que existe.';
revoke all on function public.canal_pro_trazer(uuid) from public, anon;
grant execute on function public.canal_pro_trazer(uuid) to authenticated;

-- =====================================================================
-- 3. A lista de Anúncios com os contatos e a criação do Canal Pro
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
       -- Daqui para baixo, o que a 20261105150000 acrescentou.
       rel.contatos as no_canal_pro_contatos,
       rel.criado_em as no_canal_pro_criado_em
  from public.anuncios a
  left join public.organizations_view o on o.id = a.proprietario_id
  left join public.profiles criador on criador.id = a.criado_por
  left join (select v.anuncio_id, count(*) as leads
               from public.portal_leads_na_lista v
              where v.anuncio_id is not null and v.grupo = 'mensagem' and v.situacao <> 'descartado'
              group by v.anuncio_id) pl on pl.anuncio_id = a.id
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
  'A lista de Anúncios: fotos, capa, pendências, proprietário, leads que mandaram mensagem, o que o cartão do Canal Pro mostra (cômodos, endereço, insumos da nota, última leitura do Grupo OLX) e o que o último relatório do Canal Pro disse do anúncio (situação, visualizações, contatos, data de criação).';
revoke all on public.anuncios_na_lista from anon;
grant select on public.anuncios_na_lista to authenticated;

  $ddl$;
end $relatorio$;

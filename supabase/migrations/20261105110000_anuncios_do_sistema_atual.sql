-- =====================================================================
-- Os anúncios do sistema atual vêm para o CRM com o mesmo código — só na Imova (05/11/2026)
--
-- A descoberta de hoje: os 17 anúncios da Imova no Canal Pro não são manuais.
-- Eles chegam "Via Integração" de OUTRO sistema, com códigos como
-- SA0012_IMOVA, PT0001_IMOVA e TE0002_IMOVA. O Canal Pro aceita UM integrador
-- por conta: quando a URL do arquivo do CRM entrar no lugar da do sistema
-- atual, o Grupo OLX passa a ler só o CRM. Para nenhum anúncio cair nem
-- duplicar nessa troca, o CRM precisa mandar cada um com o MESMO ListingID —
-- para o portal, mesmo código é o mesmo anúncio (as visitas, os leads e o
-- histórico continuam); código novo seria um anúncio novo, e o antigo sairia.
--
-- O que muda:
--   1. `anuncios.origem` diz de onde o anúncio veio: 'crm' (criado aqui),
--      'relatorio_canal_pro' (trazido do relatório exportado pelo Canal Pro) ou
--      'sistema_atual' (importado do outro sistema); `importado_em`, quando a
--      última importação o escreveu. Os trazidos até hoje ficam
--      'relatorio_canal_pro'.
--   2. `public.anuncio_importar` (admin e gestor) cria o anúncio com o código
--      dado, como rascunho, ou atualiza o que já tem esse código, com o mesmo
--      formulário de `public.anuncio_salvar`. As fotos continuam entrando por
--      `public.anuncio_foto_adicionar`.
--   3. `public.canal_pro_trazer` passa a criar o rascunho com o MESMO código do
--      anúncio do relatório, quando ele cabe no formato do ListingID e está
--      livre; senão, com o código da sequência, como antes.
--   4. `app.anuncio_pendencias`: "excluir o original no Canal Pro" só vale
--      quando o código do CRM é DIFERENTE do original. Com o mesmo código, os
--      dois são o mesmo anúncio quando o Canal Pro passar a ler o arquivo do
--      CRM; com código diferente, os dois juntos seriam duplicidade.
--
--   5. `app.canal_pro_ocupadas`: com o mesmo código, o anúncio do CRM no ar e a
--      linha do relatório são um anúncio só, e a vaga do plano conta uma vez.
--
-- SÓ DA IMOVA, E O WHATSAPP NÃO É TOCADO: no banco da KOMUNE esta migração
-- não cria nada, como a 20261104150000.
--
-- COMO DESFAZER (no banco da Imova):
--   drop function if exists public.anuncio_importar(jsonb);
--   recriar public.canal_pro_trazer e app.anuncio_pendencias como estão na
--     20261104150000;
--   alter table public.anuncios drop column if exists origem,
--     drop column if exists importado_em;
-- =====================================================================

do $sistema_atual$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios do Canal Pro são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. De onde o anúncio veio
-- =====================================================================
alter table public.anuncios add column if not exists origem text not null default 'crm';
alter table public.anuncios drop constraint if exists anuncios_origem_check;
alter table public.anuncios add constraint anuncios_origem_check
  check (origem in ('crm', 'relatorio_canal_pro', 'sistema_atual'));
alter table public.anuncios add column if not exists importado_em timestamptz;
comment on column public.anuncios.origem is
  'De onde o anúncio veio: crm (criado aqui), relatorio_canal_pro (trazido do relatório do Canal Pro) ou sistema_atual (importado do sistema que integrava antes, com o mesmo código).';
comment on column public.anuncios.importado_em is
  'Quando public.anuncio_importar escreveu o anúncio pela última vez.';

-- Os trazidos do relatório até hoje.
update public.anuncios a
   set origem = 'relatorio_canal_pro'
 where a.origem = 'crm'
   and exists (select 1 from public.anuncios_no_canal_pro m where m.anuncio_id = a.id);

-- =====================================================================
-- 2. O que falta para ir ao ar: o original só pesa com código diferente
-- =====================================================================
create or replace function app.anuncio_pendencias(p_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  if v_fotos < 5 then
    p := p || format('pelo menos 5 fotos (tem %s)', v_fotos);
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
end $$;
comment on function app.anuncio_pendencias(uuid) is
  'O que falta para o anúncio ir ao ar, em frases curtas ("CEP", "pelo menos 5 fotos (tem 2)"). Vazio = pode ir. As regras do VRSync do Grupo OLX conferidas em 04/11/2026; o original do relatório só pesa quando o código é outro (05/11/2026).';
revoke all on function app.anuncio_pendencias(uuid) from public, anon;
grant execute on function app.anuncio_pendencias(uuid) to authenticated;

-- =====================================================================
-- 3. Importar do sistema atual
-- =====================================================================
-- Uma chamada por anúncio, com o formulário inteiro (o mesmo de
-- `anuncio_salvar`) e o código que o portal já conhece. O tipo vem como slug
-- do CRM: quem importa traduz o PropertyType do arquivo do sistema atual.
create or replace function public.anuncio_importar(p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if v_cod !~ '^[A-Za-z0-9_-]{1,50}$' then
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
end $$;
comment on function public.anuncio_importar(jsonb) is
  'Importa um anúncio do sistema que integrava com o Canal Pro antes, com o MESMO código (ListingID): cria como rascunho (origem sistema_atual) ou atualiza o que já tem o código. Admin e gestor. Excluído não volta; no ar não fica com pendência. As fotos entram por public.anuncio_foto_adicionar.';
revoke all on function public.anuncio_importar(jsonb) from public, anon;
grant execute on function public.anuncio_importar(jsonb) to authenticated;

-- =====================================================================
-- 4. Trazer do relatório com o mesmo código
-- =====================================================================
create or replace function public.canal_pro_trazer(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m     public.anuncios_no_canal_pro;
  a     public.anuncios;
  v_neg text;
  v_cod text;
  t     record;
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

  v_neg := coalesce(m.negocio, case when m.preco_aluguel is not null and m.preco_venda is null
                                    then 'aluguel' else 'venda' end);
  select * into t from app.anuncio_tipo(coalesce(m.tipo_crm, 'apartamento'));
  -- O mesmo ListingID, quando ele cabe no formato e ninguém no CRM o usa
  -- (nem um anúncio excluído): para o portal, é o mesmo anúncio.
  if m.codigo ~ '^[A-Za-z0-9_-]{1,50}$'
     and not exists (select 1 from public.anuncios x where x.codigo = m.codigo) then
    v_cod := m.codigo;
  end if;
  if v_cod is not null then
    insert into public.anuncios
      (codigo, origem, tipo, negocio, titulo, preco_venda, preco_aluguel, bairro, cidade, endereco,
       area_util, area_total, quartos, criado_por, atualizado_por)
    values
      (v_cod, 'relatorio_canal_pro', coalesce(m.tipo_crm, 'apartamento'), v_neg, left(coalesce(m.titulo, ''), 100),
       case when v_neg <> 'aluguel' then m.preco_venda end,
       case when v_neg <> 'venda' then m.preco_aluguel end,
       left(m.bairro, 80), left(m.cidade, 80), left(m.endereco, 120),
       case when t.area = 'util' then m.area end,
       case when t.area = 'total' then m.area end,
       m.quartos, auth.uid(), auth.uid())
    returning * into a;
  else
    -- Código fora do formato ou já em uso: o da sequência, como antes.
    insert into public.anuncios
      (origem, tipo, negocio, titulo, preco_venda, preco_aluguel, bairro, cidade, endereco,
       area_util, area_total, quartos, criado_por, atualizado_por)
    values
      ('relatorio_canal_pro', coalesce(m.tipo_crm, 'apartamento'), v_neg, left(coalesce(m.titulo, ''), 100),
       case when v_neg <> 'aluguel' then m.preco_venda end,
       case when v_neg <> 'venda' then m.preco_aluguel end,
       left(m.bairro, 80), left(m.cidade, 80), left(m.endereco, 120),
       case when t.area = 'util' then m.area end,
       case when t.area = 'total' then m.area end,
       m.quartos, auth.uid(), auth.uid())
    returning * into a;
  end if;
  update public.anuncios_no_canal_pro set anuncio_id = a.id where id = p_id;
  return jsonb_build_object('ok', true, 'anuncio_id', a.id, 'codigo', a.codigo, 'ja_existia', false);
end $$;
comment on function public.canal_pro_trazer(uuid) is
  'Cria no CRM o rascunho de um anúncio do relatório do Canal Pro, com o que o relatório tem e o MESMO código quando ele cabe no formato e está livre (senão, o da sequência), e liga os dois. Equipe toda. Com código diferente, ir ao ar pede o original excluído e marcado.';
revoke all on function public.canal_pro_trazer(uuid) from public, anon;
grant execute on function public.canal_pro_trazer(uuid) to authenticated;

-- =====================================================================
-- 5. A vaga do plano não conta duas vezes
-- =====================================================================
-- Com o mesmo código, o anúncio do CRM no ar e a linha do relatório são o mesmo
-- anúncio do Canal Pro: a linha do relatório sai da conta quando o CRM tem um
-- anúncio no ar com esse código (ou ligado a ela pelo "Trazer para o CRM").
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
comment on function app.canal_pro_ocupadas(uuid) is
  'Vagas e destaques do plano do Canal Pro em uso: anúncios do CRM no ar + os do relatório que o CRM ainda não tem no ar com o mesmo código. p_fora fica de fora da conta.';
revoke all on function app.canal_pro_ocupadas(uuid) from public, anon, authenticated;

  $ddl$;
end $sistema_atual$;

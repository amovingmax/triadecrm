-- =====================================================================
-- Anúncios de imóveis que sobem para o Canal Pro — só na Imova (04/11/2026)
--
-- Pedido do usuário: "criar uma aba no CRM da Imova em que a gente consiga
-- subir o anúncio de um imóvel, terreno, casa, apartamento [...] e dessa forma
-- conseguiríamos subir o anúncio pelo CRM ao invés de subir pelo ZAP, mas
-- continuaríamos com o plano".
--
-- ===========================================================================
-- NÃO EXISTE API DE ANÚNCIO: O GRUPO OLX LÊ UM ARQUIVO
-- ===========================================================================
-- A integração oficial do Grupo OLX (ZAP, Viva Real e OLX) é o feed XML no
-- formato VRSync (developers.grupozap.com/feeds): o anunciante cola UMA URL no
-- Canal Pro ("Integração de anúncios") e o robô do Grupo OLX baixa o arquivo a
-- cada 12 horas. Não há chamada para criar um anúncio na hora. Então o CRM:
--   1. guarda o anúncio aqui (`anuncios`, `anuncio_fotos`);
--   2. serve o arquivo pela Edge Function `canal-pro-feed`, que pede a
--      `public.canal_pro_feed` (chave secreta na URL) e monta o XML;
--   3. anota cada leitura (`canal_pro_leituras`), para a tela dizer se o
--      anúncio já foi lido ou se espera a próxima leitura.
-- O plano do Canal Pro continua valendo: o destaque (PublicationType) gasta a
-- cota contratada, e o Grupo OLX inativa sozinho o que passar dela.
--
-- ===========================================================================
-- DECISÕES DO USUÁRIO (04/11/2026)
-- ===========================================================================
--   * Só os anúncios NOVOS passam pelo CRM. Os que já estão no Canal Pro ficam
--     lá e são editados lá (o Grupo OLX recusa por duplicidade um anúncio do
--     XML igual a um manual).
--   * Todos criam, a gestão publica: admin, gestor e SDR (`app.is_manager()`)
--     criam e editam rascunho e anúncio fora do ar; pôr no ar, tirar do ar,
--     escolher o destaque, excluir e mexer em anúncio NO AR é de admin e gestor
--     (`app.admin_ou_gestor()`), porque é o que gasta a cota do plano.
--   * Os contatos (leads) que chegam pelos portais ficam para outra etapa.
--   * (à noite) A lista "No ar" mostra TAMBÉM os anúncios cadastrados à mão no
--     Canal Pro, migrando aos poucos ("Mostrar todos, migrar aos poucos"; a
--     Imova tem até 20). O Grupo OLX não tem API de leitura: a lista vem do
--     relatório que o próprio Canal Pro exporta ("Exportar relatório", chega por
--     e-mail), importado pela gestão (`public.canal_pro_importar`). Anúncio
--     manual só se exclui DENTRO do Canal Pro (integration_rules: "a exclusão de
--     anúncio manual deve ser feita de forma manual através do Canal Pro"): o
--     CRM guia, e a gestão marca "já excluí" (`public.canal_pro_marcar_excluido`).
--     "Trazer para o CRM" (`public.canal_pro_trazer`) cria o rascunho com o que
--     o relatório tem, e ele só vai ao ar depois de o original ser excluído e
--     marcado: senão o Grupo OLX recusa os dois por duplicidade.
--
-- ===========================================================================
-- O QUE O PORTAL EXIGE, CONFERIDO AQUI (`app.anuncio_pendencias`)
-- ===========================================================================
-- Título de 10 a 100 caracteres e descrição de 50 a 3.000, sem HTML; pelo menos
-- 5 fotos JPG; preço de venda e/ou aluguel; CEP, estado, cidade e bairro; área
-- útil (ou total, em terreno, galpão, chácara e fazenda); quartos e banheiros
-- nos tipos em que o VRSync os pede; vídeo só do YouTube; e o e-mail da
-- imobiliária (ContactInfo). Anúncio com pendência não vai ao ar, anúncio no ar
-- não pode ser salvo com pendência, e o arquivo pula, por garantia, qualquer um
-- que ainda tenha.
--
-- ===========================================================================
-- AS FOTOS FICAM NUM BALDE PÚBLICO, E SÓ ELAS
-- ===========================================================================
-- O robô do Grupo OLX baixa cada foto pela URL e não tem como se autenticar.
-- O balde `anuncios` é público para leitura, aceita só JPEG de até 7 MB (o
-- limite do portal) e cada foto tem um nome sorteado (uuid), que muda quando a
-- foto muda — o VRSync pede isso para baixar de novo. Escrever continua só pelo
-- servidor: a rota `/api/anuncios/fotos` confere quem pode e emite uma
-- autorização de uso único para UM caminho, como as mídias de saída.
--
-- ===========================================================================
-- SÓ DA IMOVA, E O WHATSAPP NÃO É TOCADO
-- ===========================================================================
-- No banco da KOMUNE esta migração não cria NADA (o mesmo bloco da atitude do
-- cliente, 20261029110000): só fica o registro da versão. No banco da Imova, e
-- num banco ainda sem identidade (`db reset` local e CI), tudo é criado. A tela
-- só aparece onde `EMPRESA.modulos.anuncios` é verdade. Nada aqui lê ou escreve
-- conversa, mensagem, fila de envio ou qualquer coisa da Meta.
--
-- COMO DESFAZER (no banco da Imova):
--   drop function if exists public.canal_pro_importar(jsonb),
--     public.canal_pro_marcar_excluido(uuid, boolean), public.canal_pro_trazer(uuid);
--   drop function if exists public.canal_pro_feed(text, text), public.canal_pro_situacao(),
--     public.canal_pro_ajustar(text, text, text, text), public.canal_pro_trocar_chave(),
--     public.anuncio_salvar(jsonb, uuid), public.anuncio_publicar(uuid),
--     public.anuncio_tirar_do_ar(uuid), public.anuncio_destaque(uuid, text),
--     public.anuncio_excluir(uuid, text), public.anuncio_restaurar(uuid),
--     public.anuncio_foto_adicionar(uuid, text), public.anuncio_fotos_ordenar(uuid, uuid[]),
--     public.anuncio_foto_remover(uuid), app.anuncio_pendencias(uuid),
--     app.anuncio_editavel(public.anuncios);
--   (depois das tabelas) drop function if exists app.anuncio_tipo_existe(text), app.anuncio_tipo(text);
--   drop view if exists public.anuncios_na_lista;
--   drop table if exists public.anuncios_no_canal_pro, public.canal_pro_leituras,
--     public.canal_pro, public.anuncio_fotos, public.anuncios;
--   drop sequence if exists public.anuncios_codigo_seq;
--   (o balde `anuncios` sai pelo painel do Storage, depois de esvaziado)
-- =====================================================================

do $anuncios$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios do Canal Pro são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. Os tipos de imóvel e o que o VRSync pede de cada um
-- =====================================================================
-- A única lista de tipos do CRM. `area` diz qual área o portal lê ("total" em
-- terreno, galpão, chácara e fazenda; "util" no resto); `pede_quartos` e
-- `pede_banheiros` seguem as tabelas de Bedrooms e Bathrooms da documentação
-- (details.html). Kitnet manda 0 quarto, e studio também aceita 0: os dois não
-- pedem o número.
create or replace function app.anuncio_tipo(p_tipo text)
returns table (vrsync text, uso text, area text, pede_quartos boolean, pede_banheiros boolean)
language sql
immutable
set search_path = ''
as $$
  select t.vrsync, t.uso, t.area, t.pede_quartos, t.pede_banheiros
    from (values
      ('apartamento',        'Residential / Apartment',           'Residential', 'util',  true,  true),
      ('casa',               'Residential / Home',                'Residential', 'util',  true,  true),
      ('casa_condominio',    'Residential / Condo',               'Residential', 'util',  true,  true),
      ('casa_vila',          'Residential / Village House',       'Residential', 'util',  true,  true),
      ('sobrado',            'Residential / Sobrado',             'Residential', 'util',  true,  true),
      ('cobertura',          'Residential / Penthouse',           'Residential', 'util',  true,  true),
      ('flat',               'Residential / Flat',                'Residential', 'util',  true,  true),
      ('kitnet',             'Residential / Kitnet',              'Residential', 'util',  false, true),
      ('studio',             'Residential / Studio',              'Residential', 'util',  false, true),
      ('loft',               'Residential / Loft',                'Residential', 'util',  true,  true),
      ('terreno',            'Residential / Land Lot',            'Residential', 'total', false, false),
      ('chacara',            'Residential / Farm Ranch',          'Residential', 'total', true,  true),
      ('fazenda_sitio',      'Residential / Agricultural',        'Residential', 'total', true,  true),
      ('sala_comercial',     'Commercial / Office',               'Commercial',  'util',  false, true),
      ('consultorio',        'Commercial / Consultorio',          'Commercial',  'util',  false, true),
      ('loja',               'Commercial / Business',             'Commercial',  'util',  false, false),
      ('imovel_comercial',   'Commercial / Building',             'Commercial',  'util',  false, false),
      ('predio_comercial',   'Commercial / Edificio Comercial',   'Commercial',  'util',  false, false),
      ('predio_residencial', 'Commercial / Edificio Residencial', 'Commercial',  'util',  true,  true),
      ('andar_corporativo',  'Commercial / Corporate Floor',      'Commercial',  'util',  false, false),
      ('galpao',             'Commercial / Industrial',           'Commercial',  'total', false, false),
      ('terreno_comercial',  'Commercial / Land Lot',             'Commercial',  'total', false, false),
      ('garagem',            'Commercial / Garage',               'Commercial',  'util',  false, false),
      ('hotel',              'Commercial / Hotel',                'Commercial',  'util',  false, false)
    ) as t(slug, vrsync, uso, area, pede_quartos, pede_banheiros)
   where t.slug = p_tipo
$$;
comment on function app.anuncio_tipo(text) is
  'Tipo de imóvel do anúncio → PropertyType e UsageType do VRSync, e o que o portal pede dele (qual área, quartos, banheiros). A única lista de tipos: o check de anuncios.tipo usa esta função.';
revoke all on function app.anuncio_tipo(text) from public, anon;
grant execute on function app.anuncio_tipo(text) to authenticated;

-- O `check` de `anuncios.tipo` não aceita subconsulta; aceita função.
create or replace function app.anuncio_tipo_existe(p_tipo text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (select 1 from app.anuncio_tipo(p_tipo))
$$;
revoke all on function app.anuncio_tipo_existe(text) from public, anon;
grant execute on function app.anuncio_tipo_existe(text) to authenticated;

-- =====================================================================
-- 2. O anúncio e as fotos
-- =====================================================================
create sequence if not exists public.anuncios_codigo_seq;

create table if not exists public.anuncios (
  id                uuid primary key default gen_random_uuid(),
  -- O ListingID do VRSync. Nunca muda: código novo é anúncio novo no portal.
  codigo            text not null unique
                      default ('IMV-' || lpad(nextval('public.anuncios_codigo_seq')::text, 4, '0'))
                      check (codigo ~ '^[A-Za-z0-9_-]{1,50}$'),
  situacao          text not null default 'rascunho'
                      check (situacao in ('rascunho', 'no_ar', 'pausado')),
  titulo            text not null default '' check (char_length(titulo) <= 100),
  descricao         text not null default '' check (char_length(descricao) <= 3000),
  tipo              text not null default 'apartamento'
                      check (app.anuncio_tipo_existe(tipo)),
  negocio           text not null default 'venda'
                      check (negocio in ('venda', 'aluguel', 'venda_aluguel')),
  preco_venda       bigint check (preco_venda > 0),
  preco_aluguel     bigint check (preco_aluguel > 0),
  periodo_aluguel   text not null default 'mensal'
                      check (periodo_aluguel in ('mensal', 'diario', 'semanal', 'trimestral', 'anual')),
  condominio        bigint check (condominio >= 0),
  iptu              bigint check (iptu >= 0),
  iptu_periodo      text not null default 'anual' check (iptu_periodo in ('anual', 'mensal')),
  area_util         int check (area_util > 0),
  area_total        int check (area_total > 0),
  quartos           smallint check (quartos between 0 and 99),
  suites            smallint check (suites between 0 and 99),
  banheiros         smallint check (banheiros between 0 and 99),
  vagas             smallint check (vagas between 0 and 999),
  -- Valores do <Feature> do VRSync, em inglês ("Pool"); o rótulo é da tela.
  caracteristicas   text[] not null default '{}'
                      check (cardinality(caracteristicas) <= 80),
  cep               text check (cep ~ '^[0-9]{8}$'),
  estado            text check (estado ~ '^[A-Z]{2}$'),
  cidade            text check (char_length(cidade) <= 80),
  bairro            text check (char_length(bairro) <= 80),
  endereco          text check (char_length(endereco) <= 120),
  numero            text check (char_length(numero) <= 20),
  -- Não aparece nos portais (VRSync): serve à equipe e ao Grupo OLX.
  complemento       text check (char_length(complemento) <= 60),
  -- displayAddress: 'completo' = All, 'rua' = Street, 'bairro' = Neighborhood.
  mostrar_endereco  text not null default 'rua'
                      check (mostrar_endereco in ('completo', 'rua', 'bairro')),
  video_youtube     text check (char_length(video_youtube) <= 200),
  -- PublicationType: padrao = STANDARD, destaque = PREMIUM, super_destaque =
  -- SUPER_PREMIUM, exclusivo = PREMIERE_1, superior = PREMIERE_2, triplo = TRIPLE.
  destaque          text not null default 'padrao'
                      check (destaque in ('padrao', 'destaque', 'super_destaque',
                                          'exclusivo', 'superior', 'triplo')),
  proprietario_id   uuid references public.organizations (id) on delete set null,
  criado_por        uuid references public.profiles (id) on delete set null,
  criado_em         timestamptz not null default now(),
  -- Muda a cada mudança que o portal vê, inclusive nas fotos: é o que a tela
  -- compara com a última leitura do Grupo OLX.
  updated_at        timestamptz not null default now(),
  atualizado_por    uuid references public.profiles (id) on delete set null,
  publicado_em      timestamptz,
  publicado_por     uuid references public.profiles (id) on delete set null,
  saiu_do_ar_em     timestamptz,
  excluido_em       timestamptz,
  excluido_por      uuid references public.profiles (id) on delete set null,
  motivo_exclusao   text
);
create index if not exists anuncios_situacao_idx on public.anuncios (situacao) where excluido_em is null;
create index if not exists anuncios_proprietario_idx on public.anuncios (proprietario_id)
  where proprietario_id is not null;
alter table public.anuncios enable row level security;
drop policy if exists anuncios_select on public.anuncios;
create policy anuncios_select on public.anuncios
  for select to authenticated using ((select app.is_manager()));
comment on table public.anuncios is
  'Anúncios de imóveis que o CRM manda ao Canal Pro pelo feed VRSync (04/11/2026, só na Imova). Escrita só pelas funções public.anuncio_*; o arquivo leva os que estão no_ar, sem pendência e sem exclusão.';

drop trigger if exists audit_anuncios on public.anuncios;
create trigger audit_anuncios after insert or update or delete on public.anuncios
  for each row execute function app.audit();

create table if not exists public.anuncio_fotos (
  id          uuid primary key default gen_random_uuid(),
  anuncio_id  uuid not null references public.anuncios (id) on delete cascade,
  -- Caminho no balde `anuncios`: "<anuncio_id>/<uuid>.jpg".
  caminho     text not null unique,
  -- A de posição 0 é a capa (primary="true"); as outras saem nesta ordem.
  posicao     int not null default 0,
  criada_em   timestamptz not null default now(),
  criada_por  uuid references public.profiles (id) on delete set null
);
create index if not exists anuncio_fotos_anuncio_idx on public.anuncio_fotos (anuncio_id, posicao);
alter table public.anuncio_fotos enable row level security;
drop policy if exists anuncio_fotos_select on public.anuncio_fotos;
create policy anuncio_fotos_select on public.anuncio_fotos
  for select to authenticated using ((select app.is_manager()));
comment on table public.anuncio_fotos is
  'As fotos de cada anúncio, na ordem do portal (posição 0 = capa). Escrita só por public.anuncio_foto_*.';

-- =====================================================================
-- 3. A integração: a chave da URL, o contato da imobiliária e as leituras
-- =====================================================================
create table if not exists public.canal_pro (
  um             boolean primary key default true check (um),
  -- A credencial da URL do arquivo. O arquivo tem o endereço inteiro de cada
  -- imóvel, inclusive o que o anúncio esconde; sem a chave, ele não sai.
  chave          text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  -- ContactInfo do VRSync: Name e Email são obrigatórios.
  nome           text check (char_length(nome) between 2 and 80),
  email          text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telefone       text check (char_length(telefone) <= 30),
  site           text check (char_length(site) <= 200),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references public.profiles (id) on delete set null
);
insert into public.canal_pro (um) values (true) on conflict (um) do nothing;
alter table public.canal_pro enable row level security;
-- Sem política: só as funções definer leem e escrevem (a chave não sai para o SDR).
comment on table public.canal_pro is
  'A integração com o Canal Pro: a chave secreta da URL do arquivo e o contato da imobiliária (ContactInfo). Uma linha só. Lida por public.canal_pro_situacao, escrita por public.canal_pro_ajustar e public.canal_pro_trocar_chave.';

create table if not exists public.canal_pro_leituras (
  id            bigint generated always as identity primary key,
  em            timestamptz not null default now(),
  user_agent    text,
  -- O robô do Grupo OLX se apresenta como "VivaRealBot" (connection_guideline).
  do_grupo_olx  boolean not null,
  anuncios      int not null
);
create index if not exists canal_pro_leituras_em_idx on public.canal_pro_leituras (em desc);
alter table public.canal_pro_leituras enable row level security;
drop policy if exists canal_pro_leituras_select on public.canal_pro_leituras;
create policy canal_pro_leituras_select on public.canal_pro_leituras
  for select to authenticated using ((select app.is_manager()));
comment on table public.canal_pro_leituras is
  'Cada vez que o arquivo do Canal Pro foi baixado, por quem (user-agent) e com quantos anúncios. Guarda 90 dias.';

-- O padrão do Supabase dá tudo em tabela nova de `public` a anon e
-- authenticated; a RLS já barraria, e a grade fecha a porta antes dela. O
-- anônimo (o robô do Grupo OLX) só alcança `public.canal_pro_feed`.
revoke all on public.anuncios, public.anuncio_fotos, public.canal_pro, public.canal_pro_leituras
  from anon;
revoke all on public.canal_pro from authenticated;
revoke insert, update, delete, truncate on public.anuncios, public.anuncio_fotos, public.canal_pro_leituras
  from authenticated;
revoke all on sequence public.anuncios_codigo_seq from anon, authenticated;

-- Os anúncios cadastrados à mão no Canal Pro, como vieram no relatório que ele
-- exporta. O CRM não os edita nem os manda no arquivo: mostra, guia a exclusão
-- (que só se faz no Canal Pro) e, a pedido, traz para o CRM.
create table if not exists public.anuncios_no_canal_pro (
  id             uuid primary key default gen_random_uuid(),
  -- O código com que o anúncio é achado na busca do Canal Pro.
  codigo         text not null unique check (char_length(codigo) between 1 and 80),
  titulo         text check (char_length(titulo) <= 300),
  -- Como veio no relatório ("Apartamento") e o tipo do CRM que corresponde.
  tipo           text check (char_length(tipo) <= 80),
  tipo_crm       text check (tipo_crm is null or app.anuncio_tipo_existe(tipo_crm)),
  negocio        text check (negocio in ('venda', 'aluguel', 'venda_aluguel')),
  preco_venda    bigint check (preco_venda > 0),
  preco_aluguel  bigint check (preco_aluguel > 0),
  bairro         text check (char_length(bairro) <= 120),
  cidade         text check (char_length(cidade) <= 120),
  endereco       text check (char_length(endereco) <= 200),
  area           int check (area > 0),
  quartos        smallint check (quartos between 0 and 99),
  destaque       text check (char_length(destaque) <= 80),
  -- A situação como o relatório escreve ("Ativo", "Publicado"...).
  situacao       text check (char_length(situacao) <= 80),
  link           text check (char_length(link) <= 500),
  -- A linha inteira, cabeçalho → valor: o relatório pode trazer mais do que o
  -- CRM lê hoje, e nada se perde.
  linha          jsonb not null default '{}'::jsonb,
  -- Estava no último relatório importado? Quem sumiu dele saiu do Canal Pro.
  no_relatorio   boolean not null default true,
  visto_em       timestamptz not null default now(),
  -- "Já excluí no Canal Pro", marcado pela gestão.
  excluido_em    timestamptz,
  excluido_por   uuid references public.profiles (id) on delete set null,
  -- O anúncio do CRM que veio deste, quando alguém o trouxe.
  anuncio_id     uuid unique references public.anuncios (id) on delete set null
);
alter table public.anuncios_no_canal_pro enable row level security;
drop policy if exists anuncios_no_canal_pro_select on public.anuncios_no_canal_pro;
create policy anuncios_no_canal_pro_select on public.anuncios_no_canal_pro
  for select to authenticated using ((select app.is_manager()));
revoke all on public.anuncios_no_canal_pro from anon;
revoke insert, update, delete, truncate on public.anuncios_no_canal_pro from authenticated;
comment on table public.anuncios_no_canal_pro is
  'Os anúncios cadastrados à mão no Canal Pro, do relatório que o Canal Pro exporta (04/11/2026). Escrita só por public.canal_pro_importar, public.canal_pro_marcar_excluido e public.canal_pro_trazer.';

alter table public.canal_pro add column if not exists importado_em timestamptz;
alter table public.canal_pro add column if not exists importado_por uuid references public.profiles (id) on delete set null;
alter table public.canal_pro add column if not exists importados int;

-- =====================================================================
-- 4. As fotos: o balde público
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anuncios', 'anuncios', true, 7340032, array['image/jpeg'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- =====================================================================
-- 5. O que falta para ir ao ar
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
  -- Trazido de um anúncio manual: o original precisa sair do Canal Pro antes,
  -- senão o Grupo OLX recusa o do arquivo por duplicidade.
  select m.codigo into v_original
    from public.anuncios_no_canal_pro m
   where m.anuncio_id = p_id and m.excluido_em is null and m.no_relatorio;
  if v_original is not null then
    p := p || format('excluir o original (código %s) no Canal Pro e marcar aqui como excluído', v_original);
  end if;
  return p;
end $$;
comment on function app.anuncio_pendencias(uuid) is
  'O que falta para o anúncio ir ao ar, em frases curtas ("CEP", "pelo menos 5 fotos (tem 2)"). Vazio = pode ir. As regras do VRSync do Grupo OLX conferidas em 04/11/2026.';
revoke all on function app.anuncio_pendencias(uuid) from public, anon;
grant execute on function app.anuncio_pendencias(uuid) to authenticated;

-- Quem pode mexer no conteúdo deste anúncio agora: rascunho e fora do ar, a
-- equipe toda; no ar, só a gestão; excluído, ninguém.
create or replace function app.anuncio_editavel(a public.anuncios)
returns boolean
language sql
stable
set search_path = ''
as $$
  select a.excluido_em is null
     and app.is_manager()
     and (a.situacao <> 'no_ar' or app.admin_ou_gestor())
$$;
revoke all on function app.anuncio_editavel(public.anuncios) from public, anon;
grant execute on function app.anuncio_editavel(public.anuncios) to authenticated;

-- =====================================================================
-- 6. A lista da tela
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
       (select m.codigo from public.anuncios_no_canal_pro m where m.anuncio_id = a.id) as codigo_no_canal_pro
  from public.anuncios a
  left join public.organizations_view o on o.id = a.proprietario_id
  left join public.profiles criador on criador.id = a.criado_por;
comment on view public.anuncios_na_lista is
  'A lista de Anúncios: cada anúncio com o número de fotos, a capa, o que falta para ir ao ar e o nome do proprietário.';
revoke all on public.anuncios_na_lista from anon;
grant select on public.anuncios_na_lista to authenticated;

-- =====================================================================
-- 7. Escrever: salvar, publicar, tirar do ar, destaque, excluir
-- =====================================================================
-- Salvar manda o formulário inteiro. Rascunho e fora do ar aceitam qualquer
-- estado intermediário; anúncio no ar só é salvo inteiro (sem pendência),
-- senão sairia do arquivo pela metade e o portal o tiraria do ar.
create or replace function public.anuncio_salvar(p_dados jsonb, p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       public.anuncios;
  a       public.anuncios;
  v_id    uuid := p_id;
  v_pend  text[];
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
  end if;

  begin
    if v_id is null then
      insert into public.anuncios (criado_por, atualizado_por, tipo)
      values (auth.uid(), auth.uid(), coalesce(r.tipo, 'apartamento'))
      returning id into v_id;
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
end $$;
comment on function public.anuncio_salvar(jsonb, uuid) is
  'Cria (p_id nulo) ou salva o anúncio com o formulário inteiro. Equipe toda em rascunho e fora do ar; no ar, só admin e gestor, e só sem pendência. Não publica nada: devolve o que falta para ir ao ar.';
revoke all on function public.anuncio_salvar(jsonb, uuid) from public, anon;
grant execute on function public.anuncio_salvar(jsonb, uuid) to authenticated;

create or replace function public.anuncio_publicar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a      public.anuncios;
  v_pend text[];
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into a from public.anuncios where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if a.excluido_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'excluido');
  end if;
  v_pend := app.anuncio_pendencias(p_id);
  if cardinality(v_pend) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'pendencias', 'pendencias', to_jsonb(v_pend));
  end if;
  if a.situacao = 'no_ar' then
    return jsonb_build_object('ok', true, 'ja_estava', true);
  end if;
  update public.anuncios
     set situacao = 'no_ar', publicado_em = now(), publicado_por = auth.uid(),
         atualizado_por = auth.uid(), updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.anuncio_publicar(uuid) is
  'Põe o anúncio no arquivo do Canal Pro (admin e gestor). Recusa com a lista do que falta. O portal mostra depois da próxima leitura do Grupo OLX.';
revoke all on function public.anuncio_publicar(uuid) from public, anon;
grant execute on function public.anuncio_publicar(uuid) to authenticated;

create or replace function public.anuncio_tirar_do_ar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.anuncios
     set situacao = 'pausado', saiu_do_ar_em = now(), atualizado_por = auth.uid(), updated_at = now()
   where id = p_id and situacao = 'no_ar' and excluido_em is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_esta_no_ar');
  end if;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.anuncio_tirar_do_ar(uuid) is
  'Tira o anúncio do arquivo do Canal Pro (admin e gestor). Ele fica como "fora do ar" e pode voltar.';
revoke all on function public.anuncio_tirar_do_ar(uuid) from public, anon;
grant execute on function public.anuncio_tirar_do_ar(uuid) to authenticated;

create or replace function public.anuncio_destaque(p_id uuid, p_destaque text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_destaque not in ('padrao', 'destaque', 'super_destaque', 'exclusivo', 'superior', 'triplo') then
    return jsonb_build_object('ok', false, 'motivo', 'destaque_invalido');
  end if;
  update public.anuncios
     set destaque = p_destaque, atualizado_por = auth.uid(), updated_at = now()
   where id = p_id and excluido_em is null and destaque is distinct from p_destaque;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.anuncio_destaque(uuid, text) is
  'Escolhe o destaque (PublicationType) do anúncio. Admin e gestor: gasta a cota do plano do Canal Pro.';
revoke all on function public.anuncio_destaque(uuid, text) from public, anon;
grant execute on function public.anuncio_destaque(uuid, text) to authenticated;

-- Excluir não é DELETE (CLAUDE.md, 07/10/2026): sai da lista e do arquivo, com
-- motivo, e volta pelo restaurar como "fora do ar" — nunca direto para o ar.
create or replace function public.anuncio_excluir(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'sem_motivo');
  end if;
  update public.anuncios
     set excluido_em = now(), excluido_por = auth.uid(), motivo_exclusao = btrim(p_motivo),
         situacao = case when situacao = 'no_ar' then 'pausado' else situacao end,
         saiu_do_ar_em = case when situacao = 'no_ar' then now() else saiu_do_ar_em end,
         atualizado_por = auth.uid(), updated_at = now()
   where id = p_id and excluido_em is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.anuncio_excluir(uuid, text) is
  'Exclui o anúncio sem apagar (admin e gestor, com motivo): sai da lista e do arquivo do Canal Pro.';
revoke all on function public.anuncio_excluir(uuid, text) from public, anon;
grant execute on function public.anuncio_excluir(uuid, text) to authenticated;

create or replace function public.anuncio_restaurar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.anuncios
     set excluido_em = null, excluido_por = null, motivo_exclusao = null,
         atualizado_por = auth.uid(), updated_at = now()
   where id = p_id and excluido_em is not null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.anuncio_restaurar(uuid) is
  'Devolve o anúncio excluído à lista, fora do ar (admin e gestor).';
revoke all on function public.anuncio_restaurar(uuid) from public, anon;
grant execute on function public.anuncio_restaurar(uuid) to authenticated;

-- =====================================================================
-- 8. As fotos
-- =====================================================================
-- O arquivo sobe direto do navegador para o balde, com a autorização de uso
-- único que a rota `/api/anuncios/fotos` emite. Esta função só registra o que
-- já chegou — e confere que chegou mesmo, no lugar certo.
create or replace function public.anuncio_foto_adicionar(p_anuncio uuid, p_caminho text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a     public.anuncios;
  v_id  uuid;
begin
  select * into a from public.anuncios where id = p_anuncio for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if not app.anuncio_editavel(a) then
    return jsonb_build_object('ok', false, 'motivo', 'so_gestao_mexe_no_ar');
  end if;
  if p_caminho !~ ('^' || p_anuncio::text || '/[0-9a-f-]{36}\.jpg$') then
    return jsonb_build_object('ok', false, 'motivo', 'caminho_invalido');
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'anuncios' and o.name = p_caminho) then
    return jsonb_build_object('ok', false, 'motivo', 'arquivo_nao_chegou');
  end if;
  if (select count(*) from public.anuncio_fotos f where f.anuncio_id = p_anuncio) >= 40 then
    return jsonb_build_object('ok', false, 'motivo', 'fotos_demais');
  end if;
  insert into public.anuncio_fotos (anuncio_id, caminho, posicao, criada_por)
  values (p_anuncio, p_caminho,
          coalesce((select max(f.posicao) + 1 from public.anuncio_fotos f where f.anuncio_id = p_anuncio), 0),
          auth.uid())
  on conflict (caminho) do nothing
  returning id into v_id;
  update public.anuncios set updated_at = now(), atualizado_por = auth.uid() where id = p_anuncio;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
comment on function public.anuncio_foto_adicionar(uuid, text) is
  'Registra a foto que já subiu para o balde anuncios, no fim da fila. Mesma regra de quem edita o anúncio; até 40 fotos.';
revoke all on function public.anuncio_foto_adicionar(uuid, text) from public, anon;
grant execute on function public.anuncio_foto_adicionar(uuid, text) to authenticated;

create or replace function public.anuncio_fotos_ordenar(p_anuncio uuid, p_ordem uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.anuncios;
begin
  select * into a from public.anuncios where id = p_anuncio for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if not app.anuncio_editavel(a) then
    return jsonb_build_object('ok', false, 'motivo', 'so_gestao_mexe_no_ar');
  end if;
  -- A ordem nova tem de ser exatamente as fotos do anúncio, cada uma uma vez.
  if (select array_agg(f.id order by f.id) from public.anuncio_fotos f where f.anuncio_id = p_anuncio)
     is distinct from (select array_agg(distinct x order by x) from unnest(p_ordem) x)
     or cardinality(p_ordem) <> (select count(*) from public.anuncio_fotos f where f.anuncio_id = p_anuncio) then
    return jsonb_build_object('ok', false, 'motivo', 'ordem_invalida');
  end if;
  update public.anuncio_fotos f
     set posicao = o.n - 1
    from unnest(p_ordem) with ordinality as o(id, n)
   where f.id = o.id and f.anuncio_id = p_anuncio;
  update public.anuncios set updated_at = now(), atualizado_por = auth.uid() where id = p_anuncio;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.anuncio_fotos_ordenar(uuid, uuid[]) is
  'Põe as fotos na ordem dada; a primeira vira a capa.';
revoke all on function public.anuncio_fotos_ordenar(uuid, uuid[]) from public, anon;
grant execute on function public.anuncio_fotos_ordenar(uuid, uuid[]) to authenticated;

-- Devolve o caminho: quem apaga o arquivo do balde é a rota do servidor, com a
-- chave de serviço (apagar `storage.objects` por SQL deixa o arquivo órfão).
create or replace function public.anuncio_foto_remover(p_foto uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
     and (select count(*) from public.anuncio_fotos x where x.anuncio_id = a.id) <= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'no_ar_menos_de_5');
  end if;
  delete from public.anuncio_fotos where id = p_foto;
  update public.anuncios set updated_at = now(), atualizado_por = auth.uid() where id = a.id;
  return jsonb_build_object('ok', true, 'caminho', f.caminho);
end $$;
comment on function public.anuncio_foto_remover(uuid) is
  'Tira a foto do anúncio e devolve o caminho para o servidor apagar o arquivo. No ar, nunca deixa menos de 5.';
revoke all on function public.anuncio_foto_remover(uuid) from public, anon;
grant execute on function public.anuncio_foto_remover(uuid) to authenticated;

-- =====================================================================
-- 9. A integração vista da tela
-- =====================================================================
create or replace function public.canal_pro_situacao()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.canal_pro;
  l public.canal_pro_leituras;
begin
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into c from public.canal_pro limit 1;
  select * into l from public.canal_pro_leituras where do_grupo_olx order by em desc limit 1;
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
    'importados', c.importados);
end $$;
comment on function public.canal_pro_situacao() is
  'O painel do Canal Pro: contato da imobiliária, a última leitura do Grupo OLX e, para admin e gestor, a chave da URL do arquivo.';
revoke all on function public.canal_pro_situacao() from public, anon;
grant execute on function public.canal_pro_situacao() to authenticated;

create or replace function public.canal_pro_ajustar(p_nome text, p_email text, p_telefone text, p_site text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if char_length(btrim(coalesce(p_nome, ''))) < 2 then
    return jsonb_build_object('ok', false, 'motivo', 'sem_nome');
  end if;
  if btrim(coalesce(p_email, '')) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'motivo', 'email_invalido');
  end if;
  update public.canal_pro
     set nome = btrim(p_nome), email = lower(btrim(p_email)),
         telefone = nullif(btrim(coalesce(p_telefone, '')), ''),
         site = nullif(btrim(coalesce(p_site, '')), ''),
         atualizado_em = now(), atualizado_por = auth.uid()
   -- A linha é uma só, mas o `safeupdate` das chamadas pela API recusa UPDATE sem WHERE.
   where um;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.canal_pro_ajustar(text, text, text, text) is
  'Grava o contato da imobiliária que vai em cada anúncio (ContactInfo). Admin e gestor.';
revoke all on function public.canal_pro_ajustar(text, text, text, text) from public, anon;
grant execute on function public.canal_pro_ajustar(text, text, text, text) to authenticated;

create or replace function public.canal_pro_trocar_chave()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chave text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.canal_pro set chave = v_chave, atualizado_em = now(), atualizado_por = auth.uid()
   where um;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'canal_pro', 'chave', null,
          jsonb_build_object('chave', 'trocada'));
  return jsonb_build_object('ok', true, 'chave', v_chave);
end $$;
comment on function public.canal_pro_trocar_chave() is
  'Sorteia uma chave nova para a URL do arquivo (admin e gestor). A URL antiga para na hora: é preciso colar a nova no Canal Pro.';
revoke all on function public.canal_pro_trocar_chave() from public, anon;
grant execute on function public.canal_pro_trocar_chave() to authenticated;

-- =====================================================================
-- 10. O arquivo: o que a Edge Function `canal-pro-feed` pede
-- =====================================================================
-- Chamada sem login (o robô do Grupo OLX não tem sessão): quem autoriza é a
-- chave. Chave errada devolve só `ok: false`, sem anotar nada.
create or replace function public.canal_pro_feed(p_chave text, p_quem text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c         public.canal_pro;
  v_lista   jsonb;
  v_n       int;
begin
  select * into c from public.canal_pro limit 1;
  if c.chave is null or p_chave is null or p_chave <> c.chave then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', a.codigo, 'titulo', a.titulo, 'descricao', a.descricao,
           'tipo', a.tipo, 'tipo_vrsync', t.vrsync, 'uso', t.uso, 'area', t.area,
           'negocio', a.negocio, 'destaque', a.destaque,
           'preco_venda', a.preco_venda, 'preco_aluguel', a.preco_aluguel,
           'periodo_aluguel', a.periodo_aluguel, 'condominio', a.condominio,
           'iptu', a.iptu, 'iptu_periodo', a.iptu_periodo,
           'area_util', a.area_util, 'area_total', a.area_total,
           'quartos', a.quartos, 'suites', a.suites, 'banheiros', a.banheiros, 'vagas', a.vagas,
           'caracteristicas', to_jsonb(a.caracteristicas),
           'cep', a.cep, 'estado', a.estado, 'cidade', a.cidade, 'bairro', a.bairro,
           'endereco', a.endereco, 'numero', a.numero, 'complemento', a.complemento,
           'mostrar_endereco', a.mostrar_endereco, 'video_youtube', a.video_youtube,
           'fotos', (select coalesce(jsonb_agg(f.caminho order by f.posicao, f.criada_em), '[]'::jsonb)
                       from public.anuncio_fotos f where f.anuncio_id = a.id)
         ) order by a.codigo), '[]'::jsonb),
         count(*)
    into v_lista, v_n
    from public.anuncios a
    cross join lateral app.anuncio_tipo(a.tipo) t
   where a.situacao = 'no_ar'
     and a.excluido_em is null
     and cardinality(app.anuncio_pendencias(a.id)) = 0;

  insert into public.canal_pro_leituras (user_agent, do_grupo_olx, anuncios)
  values (left(p_quem, 300), coalesce(p_quem, '') ilike '%VivaRealBot%', v_n);
  delete from public.canal_pro_leituras where em < now() - interval '90 days';

  return jsonb_build_object(
    'ok', true,
    'imobiliaria', jsonb_build_object('nome', c.nome, 'email', c.email,
                                      'telefone', c.telefone, 'site', c.site),
    'anuncios', v_lista);
end $$;
comment on function public.canal_pro_feed(text, text) is
  'Os anúncios no ar, sem pendência, para a Edge Function canal-pro-feed montar o XML VRSync. Sem a chave certa não devolve nada; com ela, anota a leitura (p_quem = user-agent).';
revoke all on function public.canal_pro_feed(text, text) from public;
grant execute on function public.canal_pro_feed(text, text) to anon, authenticated, service_role;

-- =====================================================================
-- 11. Os anúncios cadastrados à mão no Canal Pro
-- =====================================================================
-- A tela lê o relatório exportado pelo Canal Pro (CSV ou Excel), reconhece as
-- colunas e manda uma lista de objetos. Quem estava no relatório anterior e não
-- está neste saiu do Canal Pro (`no_relatorio = false`). O relatório é a
-- verdade: um anúncio marcado como excluído que volta nele reaparece.
create or replace function public.canal_pro_importar(p_anuncios jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- O relógio, e não `now()`: duas importações na mesma transação (o pgTAP)
  -- teriam o mesmo `now()`, e ninguém sairia do relatório.
  v_agora  timestamptz := clock_timestamp();
  v_item   jsonb;
  v_codigo text;
  v_tipo   text;
  v_neg    text;
  v_novo   boolean;
  v_novos  int := 0;
  v_vistos int := 0;
  v_sairam int;
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

  return jsonb_build_object('ok', true, 'anuncios', v_vistos, 'novos', v_novos, 'sairam', v_sairam);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'motivo', 'relatorio_sem_codigo');
end $$;
comment on function public.canal_pro_importar(jsonb) is
  'Importa o relatório de anúncios exportado pelo Canal Pro (admin e gestor): atualiza pelo código, marca quem sumiu do relatório como fora do Canal Pro. Não mexe nos anúncios do CRM nem no arquivo do Grupo OLX.';
revoke all on function public.canal_pro_importar(jsonb) from public, anon;
grant execute on function public.canal_pro_importar(jsonb) to authenticated;

-- Anúncio manual só se exclui no Canal Pro. A gestão exclui lá e marca aqui;
-- marcar errado se desfaz (p_excluido = false).
create or replace function public.canal_pro_marcar_excluido(p_id uuid, p_excluido boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.anuncios_no_canal_pro
     set excluido_em = case when p_excluido then now() end,
         excluido_por = case when p_excluido then auth.uid() end
   where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'anuncios_no_canal_pro', p_id::text, null,
          jsonb_build_object('excluido_no_canal_pro', p_excluido));
  return jsonb_build_object('ok', true);
end $$;
comment on function public.canal_pro_marcar_excluido(uuid, boolean) is
  'Marca (ou desmarca) que o anúncio manual foi excluído dentro do Canal Pro. Admin e gestor. Não exclui nada no portal: isso só o Canal Pro faz.';
revoke all on function public.canal_pro_marcar_excluido(uuid, boolean) from public, anon;
grant execute on function public.canal_pro_marcar_excluido(uuid, boolean) to authenticated;

-- Traz o anúncio manual para o CRM como rascunho, com o que o relatório tem. As
-- fotos, a descrição e o CEP o relatório não traz: a pessoa completa, e o
-- rascunho só vai ao ar depois de o original ser excluído e marcado
-- (`app.anuncio_pendencias`).
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
  insert into public.anuncios
    (tipo, negocio, titulo, preco_venda, preco_aluguel, bairro, cidade, endereco,
     area_util, area_total, quartos, criado_por, atualizado_por)
  values
    (coalesce(m.tipo_crm, 'apartamento'), v_neg, left(coalesce(m.titulo, ''), 100),
     case when v_neg <> 'aluguel' then m.preco_venda end,
     case when v_neg <> 'venda' then m.preco_aluguel end,
     left(m.bairro, 80), left(m.cidade, 80), left(m.endereco, 120),
     case when t.area = 'util' then m.area end,
     case when t.area = 'total' then m.area end,
     m.quartos, auth.uid(), auth.uid())
  returning * into a;
  update public.anuncios_no_canal_pro set anuncio_id = a.id where id = p_id;
  return jsonb_build_object('ok', true, 'anuncio_id', a.id, 'codigo', a.codigo, 'ja_existia', false);
end $$;
comment on function public.canal_pro_trazer(uuid) is
  'Cria no CRM o rascunho de um anúncio manual do Canal Pro, com o que o relatório tem, e liga os dois. Equipe toda. Ir ao ar pede o original excluído e marcado.';
revoke all on function public.canal_pro_trazer(uuid) from public, anon;
grant execute on function public.canal_pro_trazer(uuid) to authenticated;

  $ddl$;
end $anuncios$;

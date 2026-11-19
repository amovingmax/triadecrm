-- =====================================================================
-- O banco de mercado da Imova: regiões, fontes permitidas, coletas, anúncios
-- de terceiros, preços, índices, Censo, proximidades, temporada e obras —
-- só na Imova (18/11/2026)
--
-- Pedido do dono (17/11 e 18/11/2026): a "Inteligência de mercado" compara os
-- imóveis da carteira com o mercado e acha VANTAGENS verdadeiras para a IA que
-- atende usar com o cliente. Plano em `PLANO.md`, `_redesign/integracao-crm-ia.md`
-- e `_redesign/pipeline/veracidade.md` do protótipo
-- (~/Documents/imova-mercado-premium-2026-11-17).
--
-- DECISÕES DO DONO NA ENTREVISTA DE 18/11 (valem acima de tudo):
--   * ZERO associação com Canal Pro, ZAP, VivaReal, OLX (Grupo OLX) ou
--     parecidos: nada coletado deles. A lista `mercado_fontes` traz o veredito
--     de cada fonte e o banco recusa coleta de fonte PROIBIDA (e de fonte
--     CONDICIONAL que o dono ainda não liberou). O índice FipeZAP (planilha
--     pública da Fipe) pode.
--   * Coleta duas vezes por semana (segunda e quinta, 6h de Fortaleza).
--   * Veracidade automática (link e data em cada número; repetidos e absurdos
--     fora; confronto com índices; amostra mínima; validade) + uma amostra
--     semanal conferida pela equipe.
--
-- São cinco migrações (210000 a 214000):
--   210000 (esta) — onde os dados moram, a lista de fontes e como o worker grava;
--   211000        — as contas (m² por região, liquidez, testes estatísticos);
--   212000        — a veracidade (faixas, coerência, imóvel nosso, repetidos,
--                   cerca, confronto, validade);
--   213000        — a amostra semanal que a equipe confere;
--   214000        — as vantagens de cada imóvel nosso, a aprovação por imóvel,
--                   a renovação automática até 10% e o que a IA lê.
--
-- ===========================================================================
-- O QUE NASCE AQUI
-- ===========================================================================
--   * Em QUALQUER banco: `app_settings['mercado']` (chave `ligado`, desligada
--     ao nascer), `app.mercado_config()` e `app.mercado_ligado()`. Na KOMUNE,
--     `ligado` é sempre falso, mesmo com a chave gravada à força.
--   * `mercado_regras`: as réguas da veracidade (`regras-veracidade@1`), uma
--     linha por versão, com uma só ativa. Protótipo e CRM leem o mesmo JSON.
--   * `mercado_regioes`: as 18 regiões do protótipo (10 da carteira e 8 de
--     referência), com as palavras que ligam o bairro do anúncio à região e os
--     vizinhos a até 6 km.
--   * `mercado_fontes`: as 55 fontes auditadas em 18/11
--     (`_redesign/pipeline/fontes-permitidas.json`), com veredito, condições,
--     ritmo, atribuição e evidência. `pode_coletar` só é verdadeiro em fonte
--     liberada, que não é PROIBIDA e que não espera reconferência. Nascem
--     liberadas só as que o dono decidiu (Chaves na Mão pelo MCP, FipeZAP da
--     Fipe, OpenStreetMap pelo Overpass e Geofabrik) e as PERMITIDAS de dado
--     público; A Corrida dos Bairros, o Overpass reserva, o Nominatim e o
--     Inside Airbnb nascem desligados (o porquê fica em `obs`).
--   * `mercado_coletas`: cada rodada de cada fonte (contrato V0: versão do
--     coletor, licença, método e impressão digital do bruto).
--   * `mercado_anuncios` (+ `nosso_imovel`, `possivel_mesmo_imovel`, estado,
--     marcas e grupo de repetidos) e `mercado_anuncio_precos` (cada preço que
--     o anúncio pediu, gravado por gatilho).
--   * `mercado_indices` (FipeZAP, Banco Central, SICONFI, A Corrida dos
--     Bairros), `mercado_ibge` (Censo 2022), `mercado_proximidades`
--     (OpenStreetMap, por imóvel nosso e por anúncio), `mercado_temporada` e
--     `mercado_obras` (alvarás, Diário Oficial, obras públicas).
--   * As funções do worker (só `service_role`): abrir e fechar a coleta e
--     gravar os anúncios em lote. As outras tabelas o worker grava direto, e
--     o gatilho V0 confere, ao inserir e a cada mudança de dado, a chave, a
--     fonte que pode ser coletada, a coleta aberta e o link. Coleta manual
--     também só de fonte que pode ser coletada, com a fonte verdadeira.
--   * A fila `mercado_coleta` e o `pg_cron` de segunda e quinta às 6h, que só
--     enfileira com a chave ligada, fonte que pode ser coletada, com coletor,
--     e na frequência dela (as mensais não rodam duas vezes por semana).
--
-- ===========================================================================
-- QUEM VÊ E QUEM ESCREVE
-- ===========================================================================
-- Leitura: admin, gestor e SDR (`app.is_manager()`), a decisão de 18/11.
-- Escrita: só o worker (`service_role`) e as funções; a grade tira insert,
-- update e delete de `authenticated` antes mesmo da RLS. Liberar uma fonte
-- CONDICIONAL é de admin e gestor, por função (`public.mercado_fonte_liberar`),
-- e cada decisão vai para o `audit_log`. Regras e regiões só mudam por migração.
--
-- ===========================================================================
-- SÓ DA IMOVA
-- ===========================================================================
-- No banco da KOMUNE nasce só a chave (desligada) e as duas funções que a
-- leem. No banco da Imova, e num banco ainda sem identidade (`db reset` local
-- e CI), tudo é criado.
--
-- COMO DESFAZER (no banco da Imova; antes, desfazer a 214000, 213000, 212000 e 211000):
--   select cron.unschedule('mercado_coleta_seg_qui');
--   delete from public.ingest_queues where name in ('mercado_coleta', 'mercado_dlq');
--   select pgmq.drop_queue('mercado_coleta'); select pgmq.drop_queue('mercado_dlq');
--   drop table if exists public.mercado_obras, public.mercado_temporada,
--     public.mercado_proximidades, public.mercado_ibge, public.mercado_indices,
--     public.mercado_anuncio_precos, public.mercado_anuncios, public.mercado_coletas,
--     public.mercado_fontes, public.mercado_regioes, public.mercado_regras cascade;
--   drop function if exists public.mercado_coleta_abrir(text, text, text, text, jsonb),
--     public.mercado_coleta_fechar(bigint, text, numeric, jsonb, boolean, text),
--     public.mercado_anuncios_registrar(bigint, jsonb), public.mercado_fonte_liberar(text, boolean, text),
--     app.mercado_coleta_enfileirar(), app.mercado_v0_registro(), app.mercado_anuncio_preco_historico(),
--     app.mercado_proximidade_usavel(public.mercado_proximidades), app.mercado_obra_valida_ate(text, text, date),
--     app.mercado_regiao_do_bairro(text, text), app.mercado_url_canonica(text),
--     app.mercado_tem_link_bloqueado(jsonb), app.mercado_bruto_permitido(jsonb, int),
--     app.mercado_nomeia_fonte(text), app.mercado_menciona(text, jsonb),
--     app.mercado_url_bloqueada(text), app.mercado_limpar_texto(text), app.mercado_sub(text, numeric, jsonb, text, text),
--     app.mercado_tipo_base(text), app.mercado_texto_chave(text), app.mercado_hoje(),
--     app.mercado_regra_num(text[]), app.mercado_regras(), app.mercado_ligado(), app.mercado_config();
--   delete from public.app_settings where key = 'mercado';
--   (a constraint `ingest_queues_worker_check` volta a ingest, wa, ai, rotas)
-- =====================================================================

-- =====================================================================
-- 0. Em qualquer banco: a chave de ligar, desligada
-- =====================================================================
-- Só a chave de ligar mora aqui (Ajustes). O teto da renovação automática (10%
-- por rodada, 20% desde a aprovação) é decisão do dono e mora na régua com
-- versão (`mercado_regras`, `renovacao`), que só muda por migração: assim
-- ninguém sobe o teto por Ajustes.
insert into public.app_settings (key, value, description)
values ('mercado',
        '{"ligado": false}'::jsonb,
        'Inteligência de mercado (só Imova, 18/11/2026). ligado: o worker grava e a IA lê as vantagens aprovadas. O teto da renovação automática fica na régua com versão (mercado_regras), não aqui. Na KOMUNE fica sempre desligada.')
on conflict (key) do nothing;

create or replace function app.mercado_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ligado', false)
      || coalesce((select s.value from public.app_settings s
                    where s.key = 'mercado' and jsonb_typeof(s.value) = 'object'), '{}'::jsonb)
      || case when (select i.empresa from app.identidade i) = 'komune'
              then jsonb_build_object('ligado', false)
              else '{}'::jsonb end
$$;
comment on function app.mercado_config() is
  'A configuração da inteligência de mercado (app_settings mercado) sobre os padrões. Na KOMUNE, ligado é sempre false.';
revoke all on function app.mercado_config() from public, anon;
grant execute on function app.mercado_config() to authenticated, service_role;

-- Só o texto "true" liga: qualquer outra coisa (inclusive um valor torto) é desligado.
create or replace function app.mercado_ligado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.mercado_config() ->> 'ligado', 'false') = 'true'
$$;
comment on function app.mercado_ligado() is
  'A inteligência de mercado está ligada nesta empresa? Desligada, o worker não grava e a IA não lê nada de mercado. Na KOMUNE, sempre false.';
revoke all on function app.mercado_ligado() from public, anon;
grant execute on function app.mercado_ligado() to authenticated, service_role;

do $mercado$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A inteligência de mercado é só da Imova: no banco da KOMUNE só a chave (desligada) foi criada.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. As réguas da veracidade, com versão
-- =====================================================================
create table if not exists public.mercado_regras (
  versao       text primary key check (versao ~ '^regras-veracidade@[0-9]{1,4}$'),
  regras       jsonb not null check (jsonb_typeof(regras) = 'object'),
  ativa        boolean not null default false,
  criada_em    timestamptz not null default now(),
  aprovada_em  timestamptz,
  aprovada_por uuid references public.profiles (id) on delete set null,
  obs          text check (char_length(obs) <= 2000)
);
create unique index if not exists mercado_regras_uma_ativa on public.mercado_regras (ativa) where ativa;
comment on table public.mercado_regras is
  'As réguas da veracidade do mercado (veracidade.md §12.1), uma linha por versão e uma só ativa. Protótipo (JavaScript) e CRM (Postgres) leem o mesmo JSON; toda vantagem grava a versão que a produziu.';

insert into public.mercado_regras (versao, regras, ativa, aprovada_em, obs)
values ('regras-veracidade@1', $regras${
  "versao": "regras-veracidade@1",
  "fontes_bloqueadas": ["zapimoveis", "zap", "vivareal", "viva real", "olx", "canalpro", "canal pro", "grupozap",
                        "grupoolx", "grupo olx", "datazap", "data zap", "mercadolivre", "mercado livre",
                        "imovelweb", "wimoveis", "quintoandar", "casamineira", "loft", "netimoveis", "imovelguide",
                        "dfimoveis", "nestoria", "trovit", "redecasas", "deztop",
                        "airbnb", "booking", "airroi", "airdna", "airbtics"],
  "texto_bloqueado": ["zap imoveis", "zapimoveis", "zap", "viva real", "vivareal", "olx", "canal pro", "canalpro",
                      "grupo zap", "grupozap", "grupo olx", "grupoolx", "data zap", "datazap",
                      "mercado livre imoveis", "mercado livre", "mercadolivre",
                      "imovelweb", "wimoveis", "quinto andar", "quintoandar", "casa mineira", "casamineira",
                      "netimoveis", "imovelguide", "dfimoveis", "nestoria", "trovit", "redecasas", "deztop",
                      "airbnb", "booking", "airroi", "airdna", "airbtics"],
  "texto_cliente_bloqueado": ["chaves na mao", "chavesnamao", "lopes imoveis", "lopes consultoria", "rede lopes",
                              "imobiliaria lopes", "lopes.com.br", "catalogue imoveis", "primore", "abreu imoveis",
                              "ibeda", "tatiana maia", "jl imoveis", "imobinova", "marta de graglia", "zil monteiro",
                              "outlet imoveis", "peres e peres", "imobiliaria reis magos", "viver imoveis", "gorett",
                              "sinergy imoveis", "heloisa correia imoveis", "marizalda", "jj assessoria",
                              "temporada livre", "temporadalivre", "inside airbnb"],
  "bruto_campos": ["id", "id_externo", "codigo", "title", "titulo", "propertytype", "tipo", "subtipo", "transaction",
                   "modo", "finalidade", "pricebrl", "preco", "valor", "aream2", "area", "area_util", "area_total",
                   "bedrooms", "quartos", "suites", "bathrooms", "banheiros", "parkingspots", "vagas",
                   "valor_condominio", "condominio", "iptu", "location", "state", "city", "neighborhood", "uf",
                   "cidade", "bairro", "logradouro", "localidade", "lat", "lng", "latitude", "longitude", "url",
                   "imageurl", "foto", "imagem", "caracteristicas", "atributos", "publicado_em", "atualizado_em"],
  "excecao_fipezap": {"fonte": "fipezap-planilha", "dominio": "downloads.fipe.org.br"},
  "identificacao": "coletor-de-dados-publicos/1.0 (+contato: e-mail genérico, sem o nome da Imova); sem 'Mozilla/5.0'",
  "gleba_area_min": 20000,
  "faixas_venda": {
    "terreno":         {"area": [50, null],    "m2": [15, 20000]},
    "gleba":           {"area": [20000, null], "m2": [2, 5000]},
    "casa":            {"area": [25, 2000],    "m2": [150, 25000]},
    "casa_condominio": {"area": [40, 2000],    "m2": [500, 30000]},
    "apartamento":     {"area": [18, 1000],    "m2": [1000, 40000]},
    "sala":            {"area": [10, 3000],    "m2": [800, 40000]},
    "loja":            {"area": [10, 10000],   "m2": [300, 40000]},
    "galpao":          {"area": [100, 50000],  "m2": [100, 10000]},
    "predio":          {"area": [100, 50000],  "m2": [300, 30000]}
  },
  "preco_venda": [20000, 100000000],
  "aluguel_m2_mes": [2, 400],
  "coerencia": {"areas_trocadas": 1.05, "aluguel_vezes": 60, "aluguel_n_min": 5, "area_ambigua": 1.5, "area_ambigua_n_min": 5},
  "gemeos": {"area": 0.02, "preco": 0.03, "foto_hamming": 6, "foto_area": 0.10, "ponto_m": 30, "ponto_area": 0.03},
  "proprio": {"area": 0.03, "preco": 0.03, "conferir_preco": [0.60, 1.40], "anel_km": 3, "nao_e_ate": 0.10},
  "cerca_iqr": {"k": 3, "n_base": 20, "n_grupo": 10},
  "confronto_corrida": {"n_min": 20, "alerta": 0.25, "quarentena": 0.40, "serie_prefixo": "corrida-"},
  "confronto_fipezap": {"nivel": 0.30, "tendencia_pp": 5, "salto": 0.15, "salto_fipe": 0.02, "salto_n_min": 30,
                        "serie_cidade": "fipezap-natal-venda", "cidade": "Natal", "sub": "apartamento"},
  "itbi": {"n_min": 10, "n_publicar": 5, "razao_ok": [0.95, 1.60], "subdeclarado": 0.50},
  "minimos": {"frase": 10, "percentual": 30, "forte": 20, "caracteristica": 20, "informa_pct": 0.60,
              "contagem_atributo": 20, "indicio": 7, "saidas_indicio": 10, "saidas_mediana": 30, "procura": 5,
              "temporada": 30},
  "validade_dias": {"vivo": 8, "vantagem": 14, "vantagem_praia_alta": 7, "fipezap_folga": 15, "fipezap_max": 60,
                    "corrida_folga": 15, "corrida_max": 60, "bcb": 60, "osm": 90, "costa": 180, "procura": 14,
                    "obra_andamento": 90, "alvara": 365, "confirmacao_equipe": 365},
  "manual": {"frase_ate": "2026-12-17", "base_ate": "2027-02-16"},
  "saida_rodadas": 2,
  "queda": {"pct": 0.01, "reais": 2000},
  "historico_preco_min": 0.001,
  "temporada": {"ocupacao_pct": [5, 95], "diaria": [50, 5000]},
  "renovacao": {"por_rodada": 0.10, "acumulada": 0.20},
  "amostra": {"total": 20, "acaso": 10, "vantagens": 6, "marcados": 4, "outros_max": 2, "min_por_fonte": 2,
              "fonte_n_min": 30, "nao_repetir_dias": 60, "alerta_erros": 2, "quarentena_erros": 3,
              "janela_semanas": 8, "cp_sup_saudavel": 0.10, "taxa_quarentena": 0.05, "taxa_n_min": 20,
              "atencao_taxa": 0.05, "desatualizado_max": 0.15, "prazo_dias": 4}
}$regras$::jsonb, true, now(),
  'Primeira versão, de _redesign/pipeline/veracidade.md (18/11/2026), com a lista de bloqueio ampliada na revisão (DataZAP, Grupo OLX, Mercado Livre e os portais nacionais da auditoria), os nomes que nunca vão ao cliente (texto_cliente_bloqueado) e os campos do bruto que podem ser guardados (bruto_campos). Mudar uma régua = inserir @2 e ativar.')
on conflict (versao) do nothing;

-- A régua ativa (vazia se ninguém ativou nenhuma: as contas caem nos padrões delas).
create or replace function app.mercado_regras()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select r.regras from public.mercado_regras r where r.ativa), '{}'::jsonb)
$$;
comment on function app.mercado_regras() is 'O JSON das réguas de veracidade ativas (mercado_regras).';
revoke all on function app.mercado_regras() from public, anon;
grant execute on function app.mercado_regras() to authenticated, service_role;

create or replace function app.mercado_regra_num(p_caminho text[], p_padrao numeric default null)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(
           case when jsonb_typeof(app.mercado_regras() #> p_caminho) = 'number'
                then (app.mercado_regras() #>> p_caminho)::numeric end,
           p_padrao)
$$;
comment on function app.mercado_regra_num(text[], numeric) is
  'Um número das réguas ativas pelo caminho (ex.: {amostra,total}); sem ele, o padrão dado.';
revoke all on function app.mercado_regra_num(text[], numeric) from public, anon;
grant execute on function app.mercado_regra_num(text[], numeric) to authenticated, service_role;

-- "Hoje" no fuso da operação (CLAUDE.md: America/Fortaleza em toda janela).
create or replace function app.mercado_hoje()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;
revoke all on function app.mercado_hoje() from public, anon;
grant execute on function app.mercado_hoje() to authenticated, service_role;

-- Bairro, cidade e palavra-chave comparados sem acento, sem caixa e sem espaço sobrando.
create or replace function app.mercado_texto_chave(p_texto text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(lower(extensions.unaccent(coalesce(p_texto, ''))), '\s+', ' ', 'g')), '')
$$;
revoke all on function app.mercado_texto_chave(text) from public, anon;
grant execute on function app.mercado_texto_chave(text) to authenticated, service_role;

-- O grupo de comparação: terreno com terreno, casa com casa, apartamento com
-- apartamento (princípio 1.5 do motor).
create or replace function app.mercado_tipo_base(p_tipo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_tipo in ('terreno', 'terreno_comercial', 'lote') then 'terreno'
           when p_tipo in ('casa', 'casa_condominio', 'casa_vila', 'sobrado') then 'casa'
           when p_tipo in ('apartamento', 'cobertura', 'flat', 'kitnet', 'studio', 'loft', 'duplex') then 'apartamento'
           when p_tipo in ('sala_comercial', 'sala', 'consultorio', 'andar_corporativo') then 'sala'
           when p_tipo in ('loja', 'ponto', 'ponto_comercial', 'imovel_comercial') then 'loja'
           when p_tipo in ('predio_comercial', 'predio_residencial', 'predio') then 'predio'
           when p_tipo in ('chacara', 'fazenda_sitio') then 'rural'
           else p_tipo
         end
$$;
comment on function app.mercado_tipo_base(text) is
  'O grupo de comparação do tipo de imóvel: terreno, casa, apartamento, sala, loja, predio, rural (ou o próprio tipo).';
revoke all on function app.mercado_tipo_base(text) from public, anon;
grant execute on function app.mercado_tipo_base(text) to authenticated, service_role;

-- O tipo refinado (veracidade §5.2 e §5.3, C6): terreno de 20.000 m² ou mais é
-- gleba; lote em condomínio nunca se compara com lote avulso; casa em
-- condomínio tem faixa própria.
create or replace function app.mercado_sub(
  p_tipo text, p_area_ref numeric, p_atributos jsonb, p_subtipo text, p_titulo text)
returns text
language sql
stable
set search_path = ''
as $$
  select case app.mercado_tipo_base(p_tipo)
           when 'terreno' then
             case when p_area_ref >= app.mercado_regra_num('{gleba_area_min}', 20000) then 'gleba'
                  when coalesce(p_atributos ->> 'condominio_fechado', '') = 'true'
                    or coalesce(app.mercado_texto_chave(p_subtipo), '') like '%condominio%'
                    or coalesce(app.mercado_texto_chave(p_titulo), '') ~ '(condominio|loteamento fechado)'
                  then 'terreno_condominio'
                  else 'terreno' end
           when 'casa' then
             case when p_tipo = 'casa_condominio'
                    or coalesce(p_atributos ->> 'condominio_fechado', '') = 'true'
                  then 'casa_condominio' else 'casa' end
           else app.mercado_tipo_base(p_tipo)
         end
$$;
comment on function app.mercado_sub(text, numeric, jsonb, text, text) is
  'O tipo refinado de comparação: gleba (terreno de 20.000 m² ou mais), terreno_condominio, terreno, casa_condominio, casa, apartamento, sala, loja...';
revoke all on function app.mercado_sub(text, numeric, jsonb, text, text) from public, anon;
grant execute on function app.mercado_sub(text, numeric, jsonb, text, text) to authenticated, service_role;

-- Link canônico (veracidade §4.1): domínio em minúsculas, sem ?…, sem #… e sem barra no fim.
create or replace function app.mercado_url_canonica(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  with u as (
    select regexp_replace(regexp_replace(regexp_replace(btrim(coalesce(p_url, '')), '#.*$', ''), '\?.*$', ''), '/+$', '') as v
  )
  select nullif(
           coalesce(lower(substring(u.v from '^[A-Za-z][A-Za-z0-9+.-]*://[^/]+')), '')
           || coalesce(substring(u.v from '^[A-Za-z][A-Za-z0-9+.-]*://[^/]+(/.*)$'),
                       case when u.v ~ '^[A-Za-z][A-Za-z0-9+.-]*://' then '' else u.v end),
           '')
    from u
$$;
revoke all on function app.mercado_url_canonica(text) from public, anon;
grant execute on function app.mercado_url_canonica(text) to authenticated, service_role;

-- O link é de um domínio bloqueado (Grupo OLX e portais nacionais parecidos)?
-- Compara rótulo a rótulo do domínio: "www.zapimoveis.com.br" bloqueia,
-- "downloads.fipe.org.br" não. Sem link, não é bloqueado (quem exige link é o V0).
create or replace function app.mercado_url_bloqueada(p_url text)
returns boolean
language sql
stable
set search_path = ''
as $$
  with h as (
    select lower(coalesce(substring(btrim(coalesce(p_url, '')) from '^[A-Za-z][A-Za-z0-9+.-]*://([^/:?#]+)'),
                          substring(btrim(coalesce(p_url, '')) from '^([^/:?#]+)'))) as host
  )
  select coalesce(bool_or(lbl.l = replace(b.nome, ' ', '')), false)
    from h
    cross join lateral unnest(string_to_array(coalesce(h.host, ''), '.')) as lbl(l)
    cross join lateral jsonb_array_elements_text(coalesce(app.mercado_regras() -> 'fontes_bloqueadas', '[]'::jsonb)) as b(nome)
$$;
comment on function app.mercado_url_bloqueada(text) is
  'O domínio do link tem um rótulo da lista fontes_bloqueadas das réguas (zapimoveis, vivareal, olx, canalpro...)? Bloqueado é recusado na entrada (V0).';
revoke all on function app.mercado_url_bloqueada(text) from public, anon;
grant execute on function app.mercado_url_bloqueada(text) to authenticated, service_role;

-- Texto livre com menção a fonte bloqueada (veracidade §2.3): o trecho vira
-- "[fonte removida]". Compara palavra inteira, sem acento e sem caixa, e
-- devolve o texto original quando não há menção.
create or replace function app.mercado_limpar_texto(p_texto text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_txt  text := p_texto;
  v_nome text;
  v_padrao text;
begin
  if p_texto is null then
    return null;
  end if;
  for v_nome in
    select t from jsonb_array_elements_text(coalesce(app.mercado_regras() -> 'texto_bloqueado', '[]'::jsonb)) t
     order by char_length(t) desc
  loop
    -- Cada vogal (e o c) aceita a versão acentuada; a caixa não importa (flag i);
    -- espaço aceita espaço, hífen ou nada.
    v_padrao := translate(lower(extensions.unaccent(v_nome)), '.', '');
    v_padrao := replace(v_padrao, 'a', '[aáàâã]');
    v_padrao := replace(v_padrao, 'e', '[eéê]');
    v_padrao := replace(v_padrao, 'i', '[ií]');
    v_padrao := replace(v_padrao, 'o', '[oóôõ]');
    v_padrao := replace(v_padrao, 'u', '[uú]');
    v_padrao := replace(v_padrao, 'c', '[cç]');
    v_padrao := regexp_replace(v_padrao, '\s+', '[\s-]*', 'g');
    v_txt := regexp_replace(v_txt, '(^|[^[:alnum:]])' || v_padrao || '([^[:alnum:]]|$)',
                            '\1[fonte removida]\2', 'gi');
  end loop;
  return v_txt;
end $$;
comment on function app.mercado_limpar_texto(text) is
  'Troca por "[fonte removida]" a menção a fonte bloqueada (palavra inteira) num texto livre (título, observação).';
revoke all on function app.mercado_limpar_texto(text) from public, anon;
grant execute on function app.mercado_limpar_texto(text) to authenticated, service_role;

-- O texto cita algum nome da lista (palavra inteira, sem acento e sem caixa;
-- espaço aceita espaço, hífen ou nada)?
create or replace function app.mercado_menciona(p_texto text, p_nomes jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(bool_or(
           app.mercado_texto_chave(p_texto) ~
             ('(^|[^a-z0-9])'
              || regexp_replace(regexp_replace(app.mercado_texto_chave(n.nome), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'),
                                ' ', '[ -]*', 'g')
              || '([^a-z0-9]|$)')),
         false)
    from jsonb_array_elements_text(case when jsonb_typeof(p_nomes) = 'array' then p_nomes else '[]'::jsonb end) as n(nome)
   where app.mercado_texto_chave(n.nome) is not null
$$;
comment on function app.mercado_menciona(text, jsonb) is
  'O texto cita algum nome da lista (palavra inteira, sem acento e sem caixa)?';
revoke all on function app.mercado_menciona(text, jsonb) from public, anon;
grant execute on function app.mercado_menciona(text, jsonb) to authenticated, service_role;

-- O texto nomeia uma fonte que não pode ir ao cliente: as bloqueadas
-- (Grupo OLX e parecidas) e os portais e imobiliárias de onde vêm os anúncios
-- (Chaves na Mão, Lopes...). A conformidade manda nunca nomear o portal ao cliente.
create or replace function app.mercado_nomeia_fonte(p_texto text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_texto is not null
     and (app.mercado_limpar_texto(p_texto) is distinct from p_texto
          or app.mercado_menciona(p_texto, app.mercado_regras() -> 'texto_cliente_bloqueado'))
$$;
comment on function app.mercado_nomeia_fonte(text) is
  'O texto nomeia fonte bloqueada (texto_bloqueado) ou portal e imobiliária de onde vêm os anúncios (texto_cliente_bloqueado)? Nada disso vai ao cliente.';
revoke all on function app.mercado_nomeia_fonte(text) from public, anon;
grant execute on function app.mercado_nomeia_fonte(text) to authenticated, service_role;

-- O bruto de um anúncio, só com os campos do imóvel (régua bruto_campos):
-- nome, telefone, e-mail e descrição do anunciante ficam de fora; todo texto
-- passa pela limpeza de fonte bloqueada. Até 4 níveis e 50 itens por lista.
create or replace function app.mercado_bruto_permitido(p_bruto jsonb, p_nivel int default 0)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_campos text[];
  v_saida  jsonb;
begin
  if p_bruto is null or coalesce(p_nivel, 0) > 4 then
    return null;
  end if;
  if jsonb_typeof(p_bruto) = 'object' then
    v_campos := array(select lower(c) from jsonb_array_elements_text(
                        coalesce(app.mercado_regras() -> 'bruto_campos', '[]'::jsonb)) c);
    select coalesce(jsonb_object_agg(e.key, app.mercado_bruto_permitido(e.value, coalesce(p_nivel, 0) + 1)), '{}'::jsonb)
      into v_saida
      from jsonb_each(p_bruto) e
     where lower(e.key) = any (v_campos);
    return v_saida;
  elsif jsonb_typeof(p_bruto) = 'array' then
    select coalesce(jsonb_agg(app.mercado_bruto_permitido(e.valor, coalesce(p_nivel, 0) + 1) order by e.ordem), '[]'::jsonb)
      into v_saida
      from jsonb_array_elements(p_bruto) with ordinality as e(valor, ordem)
     where e.ordem <= 50;
    return v_saida;
  elsif jsonb_typeof(p_bruto) = 'string' then
    return to_jsonb(app.mercado_limpar_texto(left(p_bruto #>> '{}', 1000)));
  end if;
  return p_bruto;
end $$;
comment on function app.mercado_bruto_permitido(jsonb, int) is
  'O bruto de um anúncio só com os campos do imóvel (régua bruto_campos), sem dado do anunciante, com o texto limpo de fonte bloqueada.';
revoke all on function app.mercado_bruto_permitido(jsonb, int) from public, anon;
grant execute on function app.mercado_bruto_permitido(jsonb, int) to authenticated, service_role;

-- Algum texto do item (em qualquer nível, inclusive o bruto) traz um link ou
-- domínio bloqueado? Então o item inteiro é recusado na entrada (V0).
create or replace function app.mercado_tem_link_bloqueado(p_item jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(bool_or(app.mercado_url_bloqueada(m.achado[1])), false)
    from jsonb_path_query(coalesce(p_item, '{}'::jsonb), 'strict $.**') as v(j)
    cross join lateral regexp_matches(v.j #>> '{}', '((https?://)?([a-z0-9-]+\.)+[a-z]{2,}[^\s"''<>]*)', 'gi') as m(achado)
   where jsonb_typeof(v.j) = 'string'
$$;
comment on function app.mercado_tem_link_bloqueado(jsonb) is
  'Algum texto do item (inclusive o bruto, em qualquer nível) tem link ou domínio da lista fontes_bloqueadas?';
revoke all on function app.mercado_tem_link_bloqueado(jsonb) from public, anon;
grant execute on function app.mercado_tem_link_bloqueado(jsonb) to authenticated, service_role;

-- =====================================================================
-- 2. As regiões
-- =====================================================================
create table if not exists public.mercado_regioes (
  id            text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  nome          text not null check (char_length(nome) between 2 and 120),
  -- Como a frase do cliente chama o lugar ("Capim Macio").
  curto         text not null check (char_length(curto) between 1 and 60),
  cidade        text not null check (char_length(cidade) between 2 and 80),
  uf            text not null default 'RN' check (uf ~ '^[A-Z]{2}$'),
  -- carteira: onde a Imova tem imóvel; referencia: vizinha, só para comparar.
  papel         text not null default 'referencia' check (papel in ('carteira', 'referencia')),
  abrangencia   text not null default 'bairro'
                  check (abrangencia in ('bairro', 'area', 'distrito', 'municipio')),
  codigo_ibge   text check (codigo_ibge ~ '^[0-9]{6,15}$'),
  -- As palavras que, no bairro do anúncio (sem acento, minúsculas), dizem que
  -- ele é desta região. Numa região de município, o nome da cidade basta.
  chaves        text[] not null default '{}' check (cardinality(chaves) <= 40),
  -- [{"id": "natal-capim-macio", "km": 1.2}, ...]
  vizinhos      jsonb not null default '[]'::jsonb check (jsonb_typeof(vizinhos) = 'array'),
  lat           numeric(9, 6) check (lat between -90 and 90),
  lng           numeric(9, 6) check (lng between -180 and 180),
  poligono      extensions.geometry(MultiPolygon, 4326),
  definicao     text check (char_length(definicao) <= 1000),
  -- Imóvel de praia: na alta temporada (1/12 a 28/2 e julho) a vantagem tirada
  -- de anúncios vale 7 dias, não 14 (veracidade §8.1).
  litoral       boolean not null default false,
  ativa         boolean not null default true,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
comment on table public.mercado_regioes is
  'As regiões da inteligência de mercado (só Imova, 18/11/2026): as da carteira e as vizinhas de referência, com as palavras que ligam o bairro de um anúncio à região e os vizinhos a até 6 km. Escrita só pelas migrações: mudar as palavras de uma região muda a carteira de mercado e a impressão da ficha de cada imóvel (as vantagens saem da IA até a gestão aprovar de novo).';

insert into public.mercado_regioes
  (id, nome, curto, cidade, papel, abrangencia, lat, lng, chaves, vizinhos, definicao)
values
  ('natal-cidade-jardim', 'Cidade Jardim, Natal', 'Cidade Jardim', 'Natal', 'carteira', 'area', -5.84663, -35.20304, array['cidade jardim']::text[], '[{"id": "natal-capim-macio", "km": 1.2}, {"id": "natal-candelaria", "km": 1.8}, {"id": "natal-neopolis", "km": 2.3}, {"id": "natal-lagoa-nova", "km": 2.6}, {"id": "natal-satelite", "km": 4}, {"id": "parnamirim-nova-parnamirim", "km": 4.5}, {"id": "natal-ponta-negra", "km": 5.1}, {"id": "natal-tirol", "km": 5.1}]'::jsonb, 'Loteamento Cidade Jardim, dentro do bairro oficial Capim Macio (relação 8270999 do OpenStreetMap). Não é bairro do IBGE.'),
  ('natal-capim-macio', 'Capim Macio, Natal', 'Capim Macio', 'Natal', 'carteira', 'bairro', -5.8571, -35.1995, array['capim macio']::text[], '[{"id": "natal-cidade-jardim", "km": 1.2}, {"id": "natal-neopolis", "km": 1.4}, {"id": "natal-candelaria", "km": 2.5}, {"id": "parnamirim-nova-parnamirim", "km": 3.4}, {"id": "natal-lagoa-nova", "km": 3.8}, {"id": "natal-ponta-negra", "km": 3.9}, {"id": "natal-satelite", "km": 4}]'::jsonb, 'Bairro oficial (35 setores do Censo 2022).'),
  ('natal-ponta-negra', 'Ponta Negra, Natal', 'Ponta Negra', 'Natal', 'carteira', 'bairro', -5.8844, -35.1774, array['ponta negra']::text[], '[{"id": "parnamirim-nova-parnamirim", "km": 3.4}, {"id": "natal-capim-macio", "km": 3.9}, {"id": "natal-neopolis", "km": 3.9}, {"id": "natal-cidade-jardim", "km": 5.1}]'::jsonb, 'Bairro oficial (53 setores), da orla à Av. Roberto Freire e à Vila de Ponta Negra.'),
  ('natal-lagoa-nova', 'Lagoa Nova, Natal', 'Lagoa Nova', 'Natal', 'carteira', 'bairro', -5.8248, -35.2116, array['lagoa nova']::text[], '[{"id": "natal-candelaria", "km": 2.4}, {"id": "natal-cidade-jardim", "km": 2.6}, {"id": "natal-tirol", "km": 2.9}, {"id": "natal-capim-macio", "km": 3.8}, {"id": "natal-petropolis", "km": 4.7}, {"id": "natal-neopolis", "km": 4.7}, {"id": "natal-satelite", "km": 5}]'::jsonb, 'Bairro oficial (57 setores).'),
  ('natal-potengi', 'Potengi, Natal', 'Potengi', 'Natal', 'carteira', 'bairro', -5.7553, -35.2492, array['potengi']::text[], '[]'::jsonb, 'Bairro oficial da Zona Norte (64 setores).'),
  ('parnamirim-bonor', 'Área da BONOR, Parnamirim', 'BONOR', 'Parnamirim', 'carteira', 'bairro', -5.9185, -35.2753, array['bonor', 'santos reis parnamirim', 'rosa dos ventos', 'passagem de areia', 'cohabinal', 'monte castelo', 'vale do sol', 'boa esperanca', 'bela parnamirim', 'santa tereza', 'centro parnamirim']::text[], '[{"id": "parnamirim-parque-das-nacoes", "km": 5.8}]'::jsonb, 'Os 10 bairros oficiais de Parnamirim com centro a até 2 km da fábrica da BONOR (Av. Heronides Xavier da Silva, entre Santos Reis e Rosa dos Ventos). Emaús (5,5 km) e Nova Parnamirim (8 km) ficam fora: são outro mercado.'),
  ('parnamirim-pirangi', 'Pirangi do Norte, Parnamirim', 'Pirangi', 'Parnamirim', 'carteira', 'distrito', -5.9736, -35.1322, array['pirangi']::text[], '[{"id": "parnamirim-cotovelo", "km": 2.8}]'::jsonb, 'Distrito de Pirangi do Norte, no litoral de Parnamirim (7 setores). A chave ''pirangi'' também pega Pirangi do Sul (Nísia Floresta), do outro lado do rio, que é o mesmo mercado de praia.'),
  ('tibau-do-sul-pipa', 'Pipa, Tibau do Sul', 'Pipa', 'Tibau do Sul', 'carteira', 'area', -6.23545, -35.04916, array['pipa']::text[], '[]'::jsonb, 'Vila de Pipa (relação 13114000 do OpenStreetMap). Tibau do Sul não tem bairros no IBGE.'),
  ('nisia-floresta-tabatinga', 'Tabatinga, Nísia Floresta', 'Tabatinga', 'Nísia Floresta', 'carteira', 'area', -6.0576, -35.11591, array['tabatinga']::text[], '[]'::jsonb, 'Praia de Tabatinga (relação 10495667 do OpenStreetMap). Os anúncios desta região também trazem Búzios, Barreta e Camurupim, praias vizinhas de Nísia Floresta.'),
  ('extremoz', 'Extremoz', 'Extremoz', 'Extremoz', 'carteira', 'municipio', -5.7058, -35.3069, array['extremoz']::text[], '[]'::jsonb, 'Município inteiro (sede, Genipabu, Redinha Nova, Graçandu). O ponto do mapa é a sede.'),
  ('natal-satelite', 'Satélite (Pitimbu), Natal', 'Satélite', 'Natal', 'referencia', 'area', -5.86316, -35.23516, array['satelite', 'pitimbu']::text[], '[{"id": "natal-candelaria", "km": 2.7}, {"id": "natal-neopolis", "km": 3}, {"id": "natal-cidade-jardim", "km": 4}, {"id": "natal-capim-macio", "km": 4}, {"id": "parnamirim-nova-parnamirim", "km": 4}, {"id": "natal-lagoa-nova", "km": 5}]'::jsonb, 'Conjunto Cidade Satélite (relação 16431132 do OpenStreetMap), dentro do bairro oficial Pitimbu. Os portais cadastram o bairro como Pitimbu, por isso a região também recebe os anúncios de Pitimbu até os anúncios trazerem coordenada.'),
  ('natal-tirol', 'Tirol, Natal', 'Tirol', 'Natal', 'referencia', 'bairro', -5.8013, -35.2, array['tirol']::text[], '[{"id": "natal-petropolis", "km": 1.9}, {"id": "natal-lagoa-nova", "km": 2.9}, {"id": "natal-cidade-jardim", "km": 5.1}, {"id": "natal-candelaria", "km": 5.3}]'::jsonb, 'Bairro oficial (36 setores).'),
  ('natal-petropolis', 'Petrópolis, Natal', 'Petrópolis', 'Natal', 'referencia', 'bairro', -5.7846, -35.1983, array['petropolis']::text[], '[{"id": "natal-tirol", "km": 1.9}, {"id": "natal-lagoa-nova", "km": 4.7}]'::jsonb, 'Bairro oficial (12 setores).'),
  ('natal-candelaria', 'Candelária, Natal', 'Candelária', 'Natal', 'referencia', 'bairro', -5.8452, -35.2191, array['candelaria']::text[], '[{"id": "natal-cidade-jardim", "km": 1.8}, {"id": "natal-lagoa-nova", "km": 2.4}, {"id": "natal-capim-macio", "km": 2.5}, {"id": "natal-satelite", "km": 2.7}, {"id": "natal-neopolis", "km": 2.7}, {"id": "parnamirim-nova-parnamirim", "km": 4.8}, {"id": "natal-tirol", "km": 5.3}]'::jsonb, 'Bairro oficial (27 setores).'),
  ('natal-neopolis', 'Neópolis, Natal', 'Neópolis', 'Natal', 'referencia', 'bairro', -5.8671, -35.2079, array['neopolis']::text[], '[{"id": "natal-capim-macio", "km": 1.4}, {"id": "parnamirim-nova-parnamirim", "km": 2.2}, {"id": "natal-cidade-jardim", "km": 2.3}, {"id": "natal-candelaria", "km": 2.7}, {"id": "natal-satelite", "km": 3}, {"id": "natal-ponta-negra", "km": 3.9}, {"id": "natal-lagoa-nova", "km": 4.7}]'::jsonb, 'Bairro oficial (33 setores).'),
  ('parnamirim-parque-das-nacoes', 'Parque das Nações, Parnamirim', 'Pq. das Nações', 'Parnamirim', 'referencia', 'bairro', -5.9301, -35.2241, array['parque das nacoes']::text[], '[{"id": "parnamirim-nova-parnamirim", "km": 5.2}, {"id": "parnamirim-bonor", "km": 5.8}]'::jsonb, 'Bairro oficial (14 setores).'),
  ('parnamirim-cotovelo', 'Cotovelo, Parnamirim', 'Cotovelo', 'Parnamirim', 'referencia', 'distrito', -5.9578, -35.152, array['cotovelo']::text[], '[{"id": "parnamirim-pirangi", "km": 2.8}]'::jsonb, 'Distrito de Cotovelo, no litoral de Parnamirim (3 setores).'),
  ('parnamirim-nova-parnamirim', 'Nova Parnamirim, Parnamirim', 'Nova Parnamirim', 'Parnamirim', 'referencia', 'bairro', -5.8867, -35.2076, array['nova parnamirim']::text[], '[{"id": "natal-neopolis", "km": 2.2}, {"id": "natal-capim-macio", "km": 3.4}, {"id": "natal-ponta-negra", "km": 3.4}, {"id": "natal-satelite", "km": 4}, {"id": "natal-cidade-jardim", "km": 4.5}, {"id": "natal-candelaria", "km": 4.8}, {"id": "parnamirim-parque-das-nacoes", "km": 5.2}]'::jsonb, 'Bairro oficial (87 setores), na divisa com Ponta Negra, Neópolis e Pitimbu.')
on conflict (id) do update
  set nome = excluded.nome, curto = excluded.curto, cidade = excluded.cidade,
      papel = excluded.papel, abrangencia = excluded.abrangencia,
      lat = excluded.lat, lng = excluded.lng, chaves = excluded.chaves,
      vizinhos = excluded.vizinhos, definicao = excluded.definicao,
      atualizada_em = now();

update public.mercado_regioes
   set litoral = id in ('natal-ponta-negra', 'parnamirim-pirangi', 'tibau-do-sul-pipa',
                        'nisia-floresta-tabatinga', 'parnamirim-cotovelo', 'extremoz');

-- O bairro do anúncio → a região. Mesma cidade sempre; a palavra-chave mais
-- longa ganha; a palavra vale como palavra inteira dentro de "bairro cidade"
-- ("praia da pipa tibau do sul" acha "pipa"). Numa região de município, a
-- cidade basta. Sem par, nulo: o anúncio fica fora das contas de região,
-- nunca numa região errada.
create or replace function app.mercado_regiao_do_bairro(p_bairro text, p_cidade text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select app.mercado_texto_chave(p_bairro) as b, app.mercado_texto_chave(p_cidade) as c
  )
  select r.id
    from public.mercado_regioes r
    cross join t
    cross join lateral unnest(r.chaves) as k(chave)
   where r.ativa
     and t.c is not null
     and app.mercado_texto_chave(r.cidade) = t.c
     and (   (r.abrangencia = 'municipio' and app.mercado_texto_chave(k.chave) = t.c)
          or (t.b is not null
              and (t.b || ' ' || t.c) ~ ('(^| )' || app.mercado_texto_chave(k.chave) || '( |$)')))
   order by char_length(k.chave) desc, r.id
   limit 1
$$;
comment on function app.mercado_regiao_do_bairro(text, text) is
  'A região de mercado pelo bairro e a cidade (sem acento; palavra-chave mais longa ganha; região de município pela cidade). Sem par, nulo.';
revoke all on function app.mercado_regiao_do_bairro(text, text) from public, anon;
grant execute on function app.mercado_regiao_do_bairro(text, text) to authenticated, service_role;

-- =====================================================================
-- 3. As fontes, com o veredito da auditoria de 18/11
-- =====================================================================
create table if not exists public.mercado_fontes (
  id               text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  nome             text not null check (char_length(nome) between 2 and 200),
  grupo            text not null check (grupo in ('anuncios', 'proximidades', 'temporada', 'oficiais', 'obras', 'lai')),
  url              text check (char_length(url) <= 1000),
  tipo_de_dado     text check (char_length(tipo_de_dado) <= 1000),
  -- PERMITIDA: pode, no ritmo e com a atribuição; CONDICIONAL: só com as
  -- condições (e liberada pelo dono); PROIBIDA: nunca.
  veredito         text not null check (veredito in ('PERMITIDA', 'CONDICIONAL', 'PROIBIDA')),
  condicoes        text[] not null default '{}',
  ritmo_maximo     text check (char_length(ritmo_maximo) <= 500),
  -- O mínimo de segundos entre duas requisições e o teto de requisições por rodada.
  intervalo_min_seg int check (intervalo_min_seg between 1 and 3600),
  max_por_rodada   int check (max_por_rodada between 1 and 100000),
  atribuicao       text check (char_length(atribuicao) <= 1000),
  licenca          text check (char_length(licenca) <= 200),
  regioes          text[] not null default '{}',
  -- A auditoria mandou conferir de novo (termos sem https, endereço a confirmar...).
  reconferir       boolean not null default false,
  evidencia        jsonb not null default '{}'::jsonb check (jsonb_typeof(evidencia) = 'object'),
  obs              text check (char_length(obs) <= 2000),
  -- A decisão do dono de usar a fonte. PROIBIDA nunca é liberada.
  liberada         boolean not null default false,
  liberada_por     uuid references public.profiles (id) on delete set null,
  liberada_em      timestamptz,
  liberada_motivo  text check (char_length(liberada_motivo) <= 1000),
  -- rodada (segunda e quinta), semanal, mensal, bimestral, unica, manual,
  -- sob_demanda (o worker chama quando precisa) ou nunca (PROIBIDA).
  frequencia       text not null default 'manual'
                     check (frequencia in ('rodada', 'semanal', 'mensal', 'bimestral', 'unica', 'manual', 'sob_demanda', 'nunca')),
  -- O módulo do worker que coleta (null: ninguém coleta sozinho ainda).
  coletor          text check (coletor ~ '^[a-z0-9][a-z0-9/_-]{1,60}$'),
  auditada_em      date not null,
  atualizada_em    timestamptz not null default now(),
  pode_coletar     boolean generated always as (liberada and veredito <> 'PROIBIDA' and not reconferir) stored,
  check (veredito <> 'PROIBIDA' or not liberada),
  check (veredito <> 'PROIBIDA' or frequencia = 'nunca')
);
comment on table public.mercado_fontes is
  'As fontes da inteligência de mercado auditadas em 18/11/2026 (_redesign/pipeline/fontes-permitidas.json), com veredito, condições, ritmo e evidência. O worker só coleta onde pode_coletar (liberada, não PROIBIDA, sem reconferência). Liberar uma CONDICIONAL: public.mercado_fonte_liberar (admin e gestor).';

insert into public.mercado_fontes
  (id, nome, grupo, url, tipo_de_dado, veredito, condicoes, ritmo_maximo, intervalo_min_seg,
   max_por_rodada, atribuicao, regioes, reconferir, evidencia, obs, liberada, frequencia, coletor, auditada_em)
values
  ('chavesnamao-mcp', 'Chaves na Mão, servidor MCP oficial', 'anuncios', 'https://www.chavesnamao.com.br/api/mcp/', 'anúncios de venda e aluguel (título, preço, cidade, bairro, quartos, banheiros, vagas, área, link)', 'CONDICIONAL', array['Só pelo endereço /api/mcp/ (ferramenta search_realty_listings). Nunca abrir páginas HTML nem outras rotas /api/.', 'Sem login, sem conta, sem nome da Imova no cabeçalho.', 'Respeitar o limite publicado de 60 chamadas por minuto por IP: uma chamada por vez, no mínimo 1 s entre chamadas, parar ao receber 429.', 'ai-train=no: nunca usar os anúncios para treinar ou ajustar modelo. ai-input=yes: a IA pode ler números calculados.', 'Guardar só campos do imóvel; nunca republicar o anúncio nem a lista para fora (a API externa do CRM não repassa).', 'Não ''simular pessoa'': tirar o prefixo ''Mozilla/5.0'' do User-Agent e manter o nome do coletor (recomendação).', 'Recomendado (parecer de coleta 3.10): pedir ''de acordo'' por e-mail ao portal descrevendo o uso (2 vezes por semana, ~600 chamadas, sem republicar, sem treino).']::text[], '60/min publicado; usar no máximo 1/s, uma por vez; ~600 chamadas por rodada, 2 rodadas por semana', 1, 600, 'Interna: ''anúncios publicados em portal, consultados em DD/MM''. Não nomear o portal ao cliente (parecer de conformidade).', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"Allow: /api/mcp; Allow: /.well-known/; Disallow: /api/; Disallow: /*?*; Content-Signal: ai-train=no, search=yes, ai-input=yes","termos_url":"https://www.chavesnamao.com.br/termos-de-uso/","trecho":"llms.txt: ''Para consultas amplas sobre anúncios, preços e disponibilidade, os agentes devem priorizar o MCP Server em vez de percorrer sequencialmente as páginas.'' Skill compare-prices: ''the MCP endpoint allows 60 requests per minute per IP''. Termos: ''Uso de bots, scripts automatizados, ferramentas de raspagem ou qualquer sistema que simule acesso humano para criar contas, publicar anúncios, coletar dados ou interagir com a plataforma de forma automatizada, seja para uso pessoal ou comercial.''","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.chavesnamao.com.br.txt","_redesign/pipeline/evidencias-fontes/pg_www.chavesnamao.com.br_llms.txt","_redesign/pipeline/evidencias-fontes/pg_www.chavesnamao.com.br_.well-known_mcp_server-card.json","_redesign/pipeline/evidencias-fontes/pg_www.chavesnamao.com.br_.well-known_agent-skills_index.json","_redesign/pipeline/evidencias-fontes/pg_www.chavesnamao.com.br_termos-de-uso_"]}'::jsonb, 'Server card: ''requiresAuth'': false. Risco que sobra: a leitura dos termos contra robôs; o MCP é a porta feita para máquinas e o portal pede que agentes a usem.', true, 'rodada', 'anuncios/chavesnamao', '2026-11-18'),
  ('chavesnamao-paginas', 'Chaves na Mão, páginas HTML de listagem e de anúncio', 'anuncios', 'https://www.chavesnamao.com.br/', 'anúncios (páginas)', 'PROIBIDA', array['Coleta automática pelas páginas não: o portal pede o MCP em vez de percorrer páginas, o robots bloqueia a paginação (?pg=) e os termos proíbem robôs.', 'Os 1.119 anúncios da semente de 17/11 que vieram das páginas ficam só até serem reencontrados pelo MCP (regra ativo=null já existente; saem das médias se a 1ª coleta do MCP não os achar).']::text[], 'não coletar', null, null, '—', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"Disallow: /*?* (bloqueia ?pg=)","termos_url":"https://www.chavesnamao.com.br/termos-de-uso/","trecho":"llms.txt: ''os agentes devem priorizar o MCP Server em vez de percorrer sequencialmente as páginas.''","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.chavesnamao.com.br.txt","_redesign/pipeline/evidencias-fontes/pg_www.chavesnamao.com.br_llms.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('deztop', 'Deztop (classificados de imóveis)', 'anuncios', 'https://deztop.com/', 'anúncios', 'PROIBIDA', array['Termos proíbem ''screen scraping'' e ''database scraping'' e qualquer cópia sem autorização escrita.', 'Tirar da base os 141 anúncios da semente e os 164 dos brutos do levantamento (fonte deztop). Só volta com autorização escrita.']::text[], 'não coletar', null, null, '—', array['extremoz', 'parnamirim-bonor', 'natal-lagoa-nova', 'natal-capim-macio', 'natal-potengi', 'natal-cidade-jardim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * só bloqueia /*/emailLink/, /*/conversation e afins (robots permitiria)","termos_url":"https://deztop.com/br/paginas/termos-de-uso","trecho":"''Exceto com autorização expressa por escrito do DEZTOP, modificar, copiar, distribuir, ... transferir ou vender qualquer informação, software, listas de usuários, banco de dados ... incluindo, mas não limitado a, práticas envolvendo “screen scraping”, “database scraping”...'' Última atualização em 01 de Outubro de 2020.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_deztop.com.txt","_redesign/pipeline/evidencias-fontes/pg_deztop.com_br_paginas_termos-de-uso"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('lopes', 'Lopes (rede de imobiliárias), páginas públicas', 'anuncios', 'https://www.lopes.com.br/busca/venda/br/rn/natal', 'anúncios de venda (preço, área, bairro, tipo)', 'CONDICIONAL', array['Só páginas HTML públicas de busca e de imóvel de Natal e Parnamirim (a página de busca já traz o preço no HTML).', 'Não usar as APIs internas (apis.lopes.com.br, backportalhome.lopes.com.br) sem conferir o robots delas.', 'Não entrar em /campanhas/ nem /associado/ (bloqueados no robots).', 'Só campos factuais (preço, área, quartos, bairro, link). Sem fotos, sem texto do anúncio, sem nome ou telefone de corretor.', 'A página ''Termos e condições'' mostra só a Política de Privacidade (08/06/2021): reconferir a cada mês se surgiu cláusula contra robôs.']::text[], '1 página a cada 5 s, no máximo 200 páginas por rodada', 5, 200, 'Interna: ''site de imobiliária, consultado em DD/MM''. Não nomear ao cliente.', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-pirangi', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent:* Disallow:/campanhas/* Disallow:/associado/*","termos_url":"https://www.lopes.com.br/paginas/termos-e-condicoes","trecho":"Nenhuma cláusula sobre robôs ou cópia encontrada; a página é a Política de Privacidade (''atualizada pela última vez em 08 de junho de 2021'').","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.lopes.com.br.txt","_redesign/pipeline/evidencias-fontes/pg_www.lopes.com.br_paginas_termos-e-condicoes","_redesign/pipeline/evidencias-fontes/pg_lopes_busca_natal.html"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('catalogue-imoveis', 'Catalogue Imóveis (Natal)', 'anuncios', 'https://catalogueimoveis.com.br/', 'anúncios de venda (site da própria imobiliária)', 'CONDICIONAL', array['Só páginas públicas de listagem e de imóvel; nada de busca interna bloqueada, formulário ou área logada.', 'Só campos factuais (preço, área, quartos, vagas, bairro, link). Sem fotos, sem texto do anúncio, sem nome ou telefone de corretor.', 'Conferir o robots.txt no começo de cada rodada; se mudar para bloquear, parar e avisar.', 'Melhor caminho: pedir à imobiliária o feed XML com autorização escrita (coletor feeds-imobiliarias.mjs já existe).']::text[], '1 página a cada 5 s, no máximo 100 páginas por rodada', 5, 100, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['natal-ponta-negra', 'natal-capim-macio', 'natal-lagoa-nova', 'parnamirim-pirangi']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: / (bloqueia só robôs de SEO e o Scrapy)","termos_url":null,"trecho":"Sem página de termos de uso no site.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.catalogueimoveis.com.br.txt","_redesign/pipeline/evidencias-fontes/home_catalogueimoveis.com.br.html"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('primore-imoveis', 'Primore Imóveis (Natal, Ponta Negra)', 'anuncios', 'https://primoreimoveisrn.com.br/', 'anúncios de venda (site da própria imobiliária)', 'CONDICIONAL', array['Só páginas públicas de listagem e de imóvel; nada de busca interna bloqueada, formulário ou área logada.', 'Só campos factuais (preço, área, quartos, vagas, bairro, link). Sem fotos, sem texto do anúncio, sem nome ou telefone de corretor.', 'Conferir o robots.txt no começo de cada rodada; se mudar para bloquear, parar e avisar.', 'Melhor caminho: pedir à imobiliária o feed XML com autorização escrita (coletor feeds-imobiliarias.mjs já existe).']::text[], '1 página a cada 5 s, no máximo 100 páginas por rodada', 5, 100, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['natal-ponta-negra', 'natal-capim-macio']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-Agent: * Allow: /","termos_url":null,"trecho":"Sem página de termos de uso no site.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_primoreimoveisrn.com.br.txt","_redesign/pipeline/evidencias-fontes/home_primoreimoveisrn.com.br.html"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('abreu-imoveis', 'Abreu Imóveis (Natal)', 'anuncios', 'https://www.abreuimoveis.com.br/', 'anúncios de venda (site da própria imobiliária)', 'CONDICIONAL', array['ai-train=no: nunca treinar modelo com os anúncios.', 'Só páginas públicas de listagem e de imóvel; nada de busca interna bloqueada, formulário ou área logada.', 'Só campos factuais (preço, área, quartos, vagas, bairro, link). Sem fotos, sem texto do anúncio, sem nome ou telefone de corretor.', 'Conferir o robots.txt no começo de cada rodada; se mudar para bloquear, parar e avisar.', 'Melhor caminho: pedir à imobiliária o feed XML com autorização escrita (coletor feeds-imobiliarias.mjs já existe).']::text[], '1 página a cada 5 s, no máximo 100 páginas por rodada', 5, 100, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['natal-lagoa-nova', 'natal-capim-macio', 'natal-ponta-negra', 'natal-tirol', 'natal-petropolis']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: /; Content-Signal: search=yes, ai-train=no, use=reference","termos_url":"https://www.abreuimoveis.com.br/termos-lgpd.php","trecho":"Só termo de LGPD (dados pessoais); nenhuma cláusula sobre robôs. Content-Signal: ai-train=no.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.abreuimoveis.com.br.txt","_redesign/pipeline/evidencias-fontes/pg_www.abreuimoveis.com.br_termos-lgpd.php"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('ibeda', 'Ibeda Imobiliária (Natal)', 'anuncios', 'https://ibeda.com.br/', 'anúncios de venda (site da própria imobiliária)', 'CONDICIONAL', array['Não usar /busca-imoveis.html (bloqueada): chegar aos imóveis pelo sitemap.xml.', 'Só páginas públicas de listagem e de imóvel; nada de busca interna bloqueada, formulário ou área logada.', 'Só campos factuais (preço, área, quartos, vagas, bairro, link). Sem fotos, sem texto do anúncio, sem nome ou telefone de corretor.', 'Conferir o robots.txt no começo de cada rodada; se mudar para bloquear, parar e avisar.', 'Melhor caminho: pedir à imobiliária o feed XML com autorização escrita (coletor feeds-imobiliarias.mjs já existe).']::text[], '1 página a cada 5 s, no máximo 100 páginas por rodada', 5, 100, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['natal-ponta-negra', 'natal-capim-macio', 'natal-lagoa-nova']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Disallow: /busca-imoveis.html (resto liberado)","termos_url":"https://ibeda.com.br/politica-de-privacidade","trecho":"Só política de privacidade; nenhuma cláusula sobre robôs.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_ibeda.com.br.txt","_redesign/pipeline/evidencias-fontes/pg_ibeda.com.br_politica-de-privacidade"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('tatiana-maia-imoveis', 'Tatiana Maia Imóveis (Natal)', 'anuncios', 'http://www.tatianamaiaimoveis.com.br/', 'anúncios de venda (site da própria imobiliária)', 'CONDICIONAL', array['Antes da 1ª coleta, abrir a página inicial e procurar termos de uso; o site não tem https.', 'Só páginas públicas de listagem e de imóvel; nada de busca interna bloqueada, formulário ou área logada.', 'Só campos factuais (preço, área, quartos, vagas, bairro, link). Sem fotos, sem texto do anúncio, sem nome ou telefone de corretor.', 'Conferir o robots.txt no começo de cada rodada; se mudar para bloquear, parar e avisar.', 'Melhor caminho: pedir à imobiliária o feed XML com autorização escrita (coletor feeds-imobiliarias.mjs já existe).']::text[], '1 página a cada 5 s, no máximo 100 páginas por rodada', 5, 100, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['natal-ponta-negra', 'natal-capim-macio', 'natal-lagoa-nova']::text[], true, '{"consultado_em":"2026-11-18","robots_txt":"User-Agent: * Allow: / (só responde em http)","termos_url":null,"trecho":"Termos não localizados (site só em http; não aberto além do robots).","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.tatianamaiaimoveis.com.br.txt"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('jl-imoveis-rn', 'JL Imóveis RN (Natal, Lagoa Nova)', 'anuncios', 'http://www.jlimoveisrn.com.br/', 'anúncios de venda (site da própria imobiliária)', 'CONDICIONAL', array['Antes da 1ª coleta, abrir a página inicial e procurar termos de uso; o site não tem https.', 'Só páginas públicas de listagem e de imóvel; nada de busca interna bloqueada, formulário ou área logada.', 'Só campos factuais (preço, área, quartos, vagas, bairro, link). Sem fotos, sem texto do anúncio, sem nome ou telefone de corretor.', 'Conferir o robots.txt no começo de cada rodada; se mudar para bloquear, parar e avisar.', 'Melhor caminho: pedir à imobiliária o feed XML com autorização escrita (coletor feeds-imobiliarias.mjs já existe).']::text[], '1 página a cada 5 s, no máximo 100 páginas por rodada', 5, 100, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['natal-lagoa-nova']::text[], true, '{"consultado_em":"2026-11-18","robots_txt":"User-Agent: * Allow: / (só responde em http)","termos_url":null,"trecho":"Termos não localizados (site só em http; não aberto além do robots).","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.jlimoveisrn.com.br.txt"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('imobinova-pipa', 'Imobinova (Pipa)', 'anuncios', 'https://www.imobinovapipa.com.br/', 'anúncios de venda (site da própria imobiliária)', 'CONDICIONAL', array['Só páginas públicas de listagem e de imóvel; nada de busca interna bloqueada, formulário ou área logada.', 'Só campos factuais (preço, área, quartos, vagas, bairro, link). Sem fotos, sem texto do anúncio, sem nome ou telefone de corretor.', 'Conferir o robots.txt no começo de cada rodada; se mudar para bloquear, parar e avisar.', 'Melhor caminho: pedir à imobiliária o feed XML com autorização escrita (coletor feeds-imobiliarias.mjs já existe).']::text[], '1 página a cada 5 s, no máximo 100 páginas por rodada', 5, 100, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['tibau-do-sul-pipa']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: / (bloqueia copiadores de site e robôs de treino de IA)","termos_url":null,"trecho":"Sem página de termos de uso no site.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.imobinovapipa.com.br.txt","_redesign/pipeline/evidencias-fontes/home_www.imobinovapipa.com.br.html"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('marta-de-graglia-imoveis', 'Marta de Graglia Imóveis (Pipa)', 'anuncios', 'https://martadegragliaimoveis.com.br/', 'anúncios de venda (site da própria imobiliária)', 'CONDICIONAL', array['Só páginas públicas de listagem e de imóvel; nada de busca interna bloqueada, formulário ou área logada.', 'Só campos factuais (preço, área, quartos, vagas, bairro, link). Sem fotos, sem texto do anúncio, sem nome ou telefone de corretor.', 'Conferir o robots.txt no começo de cada rodada; se mudar para bloquear, parar e avisar.', 'Melhor caminho: pedir à imobiliária o feed XML com autorização escrita (coletor feeds-imobiliarias.mjs já existe).']::text[], '1 página a cada 5 s, no máximo 100 páginas por rodada', 5, 100, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['tibau-do-sul-pipa']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-Agent: * Allow: /","termos_url":null,"trecho":"Sem página de termos de uso no site.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_martadegragliaimoveis.com.br.txt","_redesign/pipeline/evidencias-fontes/home_martadegragliaimoveis.com.br.html"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('zil-monteiro', 'Zil Monteiro, consultoria imobiliária (Pipa)', 'anuncios', 'https://www.zilmonteiro.com.br/', 'anúncios de venda (site da própria imobiliária)', 'CONDICIONAL', array['Só páginas públicas de listagem e de imóvel; nada de busca interna bloqueada, formulário ou área logada.', 'Só campos factuais (preço, área, quartos, vagas, bairro, link). Sem fotos, sem texto do anúncio, sem nome ou telefone de corretor.', 'Conferir o robots.txt no começo de cada rodada; se mudar para bloquear, parar e avisar.', 'Melhor caminho: pedir à imobiliária o feed XML com autorização escrita (coletor feeds-imobiliarias.mjs já existe).']::text[], '1 página a cada 5 s, no máximo 100 páginas por rodada', 5, 100, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['tibau-do-sul-pipa']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-Agent: * Allow: /","termos_url":"https://www.zilmonteiro.com.br/politica-de-privacidade","trecho":"Só política de privacidade; nenhuma cláusula sobre robôs.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.zilmonteiro.com.br.txt","_redesign/pipeline/evidencias-fontes/pg_www.zilmonteiro.com.br_politica-de-privacidade"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('outlet-imoveis-rn', 'Outlet Imóveis RN (Tabatinga, Cotovelo, Pirangi)', 'anuncios', 'https://www.outletimoveisrn.com.br/', 'anúncios de venda (site da própria imobiliária)', 'CONDICIONAL', array['SÓ com autorização escrita da imobiliária antes da 1ª coleta (os termos tratam ''compilações de dados'' como propriedade e pedem autorização para exploração comercial).', 'Só páginas públicas de listagem e de imóvel; nada de busca interna bloqueada, formulário ou área logada.', 'Só campos factuais (preço, área, quartos, vagas, bairro, link). Sem fotos, sem texto do anúncio, sem nome ou telefone de corretor.', 'Conferir o robots.txt no começo de cada rodada; se mudar para bloquear, parar e avisar.', 'Melhor caminho: pedir à imobiliária o feed XML com autorização escrita (coletor feeds-imobiliarias.mjs já existe).']::text[], 'só com autorização; depois, 1 página a cada 5 s (Crawl-delay: 5)', 5, null, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['nisia-floresta-tabatinga', 'parnamirim-cotovelo', 'parnamirim-pirangi']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: /; Crawl-delay: 5 (bloqueia robôs de treino de IA)","termos_url":"https://www.outletimoveisrn.com.br/termos-de-uso","trecho":"''Todo o conteúdo do Site, incluindo ... compilações de dados ..., é propriedade da Outlet Imóveis RN ... É proibida a reprodução, distribuição, modificação, exibição, transmissão ou qualquer outra forma de exploração comercial de qualquer parte do Site sem a prévia autorização por escrito da Outlet Imóveis RN.''","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.outletimoveisrn.com.br.txt","_redesign/pipeline/evidencias-fontes/pg_www.outletimoveisrn.com.br_termos-de-uso"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('peres-e-peres', 'Peres & Peres Imóveis', 'anuncios', 'https://www.pereseperes.com.br/', 'anúncios de venda (site da própria imobiliária)', 'PROIBIDA', array['Robots fecha o site para robôs genéricos. Fingir ser robô do Google ou de IA seria desonesto. Só com feed XML e autorização escrita.']::text[], 'não coletar', null, null, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['parnamirim-bonor', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: /ads.txt Disallow: / (só robôs de busca e de IA com nome liberados)","termos_url":null,"trecho":"O robots.txt fecha o site inteiro para qualquer robô sem nome na lista (o nosso coletor cai em ''User-agent: *'').","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.pereseperes.com.br.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('reis-magos', 'Imobiliária Reis Magos (Natal)', 'anuncios', 'https://www.imobiliariareismagos.com.br/', 'anúncios de venda (site da própria imobiliária)', 'PROIBIDA', array['Robots fecha o site para robôs genéricos. Fingir ser robô do Google ou de IA seria desonesto. Só com feed XML e autorização escrita.']::text[], 'não coletar', null, null, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: /ads.txt Disallow: / (só robôs de busca e de IA com nome liberados)","termos_url":null,"trecho":"O robots.txt fecha o site inteiro para qualquer robô sem nome na lista (o nosso coletor cai em ''User-agent: *'').","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.imobiliariareismagos.com.br.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('viver-imoveis-rn', 'Viver Imóveis (Natal)', 'anuncios', 'https://www.viverimoveisrn.com.br/', 'anúncios de venda (site da própria imobiliária)', 'PROIBIDA', array['Robots fecha o site para robôs genéricos. Fingir ser robô do Google ou de IA seria desonesto. Só com feed XML e autorização escrita.']::text[], 'não coletar', null, null, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: /ads.txt Disallow: / (só robôs de busca e de IA com nome liberados)","termos_url":null,"trecho":"O robots.txt fecha o site inteiro para qualquer robô sem nome na lista (o nosso coletor cai em ''User-agent: *'').","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.viverimoveisrn.com.br.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('gorett-imobiliaria', 'Gorett Imobiliária (Natal)', 'anuncios', 'https://www.gorettimobiliaria.com/', 'anúncios de venda (site da própria imobiliária)', 'PROIBIDA', array['Robots fecha o site para robôs genéricos. Fingir ser robô do Google ou de IA seria desonesto. Só com feed XML e autorização escrita.']::text[], 'não coletar', null, null, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['natal-ponta-negra', 'natal-capim-macio']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: /ads.txt Disallow: / (só robôs de busca e de IA com nome liberados)","termos_url":null,"trecho":"O robots.txt fecha o site inteiro para qualquer robô sem nome na lista (o nosso coletor cai em ''User-agent: *'').","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.gorettimobiliaria.com.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('sinergy-imoveis', 'Sinergy Imóveis (Pipa)', 'anuncios', 'https://www.sinergyimoveis.com.br/', 'anúncios de venda (site da própria imobiliária)', 'PROIBIDA', array['Robots fecha o site para robôs genéricos. Fingir ser robô do Google ou de IA seria desonesto. Só com feed XML e autorização escrita.']::text[], 'não coletar', null, null, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['tibau-do-sul-pipa']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: /ads.txt Disallow: / (só robôs de busca e de IA com nome liberados)","termos_url":null,"trecho":"O robots.txt fecha o site inteiro para qualquer robô sem nome na lista (o nosso coletor cai em ''User-agent: *'').","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.sinergyimoveis.com.br.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('heloisa-correia-imoveis', 'Heloísa Correia Imóveis (Parnamirim)', 'anuncios', 'https://www.heloisacorreiaimoveis.com.br/', 'anúncios de venda (site da própria imobiliária)', 'PROIBIDA', array['Robots fecha o site para robôs genéricos. Fingir ser robô do Google ou de IA seria desonesto. Só com feed XML e autorização escrita.']::text[], 'não coletar', null, null, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['parnamirim-nova-parnamirim', 'parnamirim-bonor']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: /ads.txt Disallow: / (só robôs de busca e de IA com nome liberados)","termos_url":null,"trecho":"O robots.txt fecha o site inteiro para qualquer robô sem nome na lista (o nosso coletor cai em ''User-agent: *'').","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.heloisacorreiaimoveis.com.br.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('marizalda-imoveis', 'Marizalda Imóveis (Parnamirim)', 'anuncios', 'https://www.marizaldaimoveis.com.br/', 'anúncios de venda (site da própria imobiliária)', 'PROIBIDA', array['Robots fecha o site para robôs genéricos. Fingir ser robô do Google ou de IA seria desonesto. Só com feed XML e autorização escrita.']::text[], 'não coletar', null, null, 'Interna: ''site de imobiliária local, consultado em DD/MM''. Não nomear ao cliente.', array['parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: /ads.txt Disallow: / (só robôs de busca e de IA com nome liberados)","termos_url":null,"trecho":"O robots.txt fecha o site inteiro para qualquer robô sem nome na lista (o nosso coletor cai em ''User-agent: *'').","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_marizaldaimoveis.com.br.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('jj-assessoria', 'JJ Assessoria Imobiliária (Tabatinga)', 'anuncios', 'https://www.jjassessoriaimobiliaria.com.br/', 'anúncios', 'PROIBIDA', array['O robots.txt responde 304 sem conteúdo (não dá para ler a regra). Não coletar até ler o robots e os termos.', 'Tirar o 1 anúncio dela que está na semente (imobiliaria-local:975f8e1323d7) até conferir.']::text[], 'não coletar', null, null, '—', array['nisia-floresta-tabatinga']::text[], true, '{"consultado_em":"2026-11-18","robots_txt":"HTTP 304 sem corpo em 18/11/2026","termos_url":null,"trecho":"Robots ilegível.","arquivos_locais":[]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('apto-vc', 'Apto (portal de lançamentos)', 'anuncios', 'https://apto.vc/', 'lançamentos', 'PROIBIDA', array['Termos proíbem ''screen scraping'' e ''database scraping'' e, nos termos de serviço, ''coleta automatizada de dados (scraping)''. Tirar a linha dos brutos do levantamento.']::text[], 'não coletar', null, null, '—', array['tibau-do-sul-pipa']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Disallow: /data, /preview","termos_url":"https://apto.vc/termos-de-uso","trecho":"''...incluindo, mas não limitado a, práticas envolvendo “screen scraping”, “database scraping”...'' (Termos de Uso, atualizado em 27 de outubro de 2026); ''Não utilizar a Plataforma para: ... (iii) coleta automatizada de dados (scraping)'' (Termos de Serviço).","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_apto.vc.txt","_redesign/pipeline/evidencias-fontes/pg_apto.vc_termos-de-uso","_redesign/pipeline/evidencias-fontes/pg_apto.vc_termos-de-servico"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('redecasas', 'RedeCasas (portal nacional)', 'anuncios', 'https://redecasas.com.br/', 'anúncios e diretório de imobiliárias', 'PROIBIDA', array['Termos proíbem robôs sem autorização expressa. Também é portal nacional (regra do dono: nada de portais parecidos com ZAP).']::text[], 'não coletar', null, null, '—', '{}'::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: / (bloqueia /api/, /conta/ ...)","termos_url":"https://redecasas.com.br/termos/","trecho":"''Utilizar robôs, spiders ou quaisquer meios automatizados para acessar a plataforma sem autorização expressa.'' (atualizados em 8 de junho de 2026)","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_redecasas.com.br.txt","_redesign/pipeline/evidencias-fontes/pg_redecasas.com.br_termos_"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('portais-nacionais', 'Grandes portais e agregadores nacionais (Imovelweb, Wimoveis, Casa Mineira, QuintoAndar, Loft, Netimóveis, ImovelGuide, DFimóveis, Nestoria, Trovit)', 'anuncios', null, 'anúncios', 'PROIBIDA', array['Decisão do dono em 18/11: nenhuma associação com ZAP, VivaReal, OLX ''ou parecidos''. Estes são portais nacionais do mesmo tipo.', 'Vários também fecham áreas ao robô (Nestoria e Trovit bloqueiam /search e /detail; ImovelGuide e Casa Mineira têm vários Disallow: /).']::text[], 'não coletar', null, null, '—', '{}'::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"ver arquivos","termos_url":null,"trecho":"Regra do dono (entrevista de 18/11/2026).","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.imovelweb.com.br.txt","_redesign/pipeline/evidencias-fontes/robots_www.casamineira.com.br.txt","_redesign/pipeline/evidencias-fontes/robots_www.nestoria.com.br.txt","_redesign/pipeline/evidencias-fontes/robots_imoveis.trovit.com.br.txt","_redesign/pipeline/evidencias-fontes/robots_www.imovelguide.com.br.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('grupo-olx', 'ZAP Imóveis, VivaReal, OLX, Canal Pro e DataZAP (Grupo OLX)', 'anuncios', null, 'anúncios, contatos, relatórios', 'PROIBIDA', array['Zero acesso: nenhuma página, API, PDF ou domínio (zapimoveis.com.br, vivareal.com.br, olx.com.br, canalpro, datazap.com.br, imoveis.grupoolx.com.br).', 'Nenhum login, conta ou credencial da Imova; nada com o nome da Imova.', 'Os informes do FipeZAP também aparecem em datazap.com.br: baixar só de downloads.fipe.org.br.', 'Em 17/11 houve uma tentativa de abrir o relatório Raio-X em datazap.com.br (redirecionou para imoveis.grupoolx.com.br e não abriu, desconto.json): não repetir.']::text[], 'não acessar', null, null, '—', '{}'::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"não consultado (de propósito)","termos_url":null,"trecho":"Regra do dono (entrevista de 18/11/2026): risco zero de banimento no Canal Pro.","arquivos_locais":[]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('feeds-imobiliarias', 'Feeds XML de imobiliárias que autorizarem (formato VRSync)', 'anuncios', 'por imobiliária', 'anúncios com coordenadas, áreas separadas, características e data', 'PERMITIDA', array['Só feed com autorização escrita (e-mail serve), guardada junto do coletor (lista FEEDS em coletar/anuncios/feeds-imobiliarias.mjs).', 'Apagar o bloco <ContactInfo> antes de gravar (o coletor já faz).']::text[], '1 download por rodada por feed', null, null, 'Conforme combinado com cada imobiliária.', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"—","termos_url":null,"trecho":"Autorização direta do dono do dado.","arquivos_locais":[]}'::jsonb, null, true, 'rodada', null, '2026-11-18'),
  ('osm-geofabrik', 'OpenStreetMap, extrato do Nordeste (Geofabrik)', 'proximidades', 'https://download.geofabrik.de/south-america/brazil/nordeste.html', 'ruas, praia e linha de costa, escolas, mercados, hospitais, shoppings, avenidas (todos os pontos de interesse)', 'PERMITIDA', array['Caminho recomendado para as proximidades: baixar o arquivo (nordeste-latest.osm.pbf, 424 MB) e calcular tudo localmente, sem carga em servidor público.', 'Licença ODbL: dar crédito e, se distribuir a base alterada, distribuir sob a mesma licença (uso interno não obriga).']::text[], '1 download por semana (o arquivo é refeito todo dia)', null, null, '''© colaboradores do OpenStreetMap, ODbL'' com link para https://www.openstreetmap.org/copyright; ao cliente: ''pelo mapa do OpenStreetMap''.', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"—","termos_url":"https://www.openstreetmap.org/copyright","trecho":"''You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors.'' Geofabrik: ''Data processed by Geofabrik GmbH and created by OpenStreetMap Contributors | License: ODbL 1.0''.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/pg_download.geofabrik.de_south-america_brazil_nordeste.html","_redesign/pipeline/evidencias-fontes/pg_www.openstreetmap.org_copyright"]}'::jsonb, null, true, 'semanal', null, '2026-11-18'),
  ('osm-overpass', 'OpenStreetMap, Overpass API (overpass-api.de)', 'proximidades', 'https://overpass-api.de/api/interpreter', 'pontos de interesse por área (consulta)', 'CONDICIONAL', array['Uso regular: dividir os limites por 100, ou seja, menos de 100 consultas e menos de 10 MB por dia.', 'User-Agent que identifique o aplicativo; uma consulta por vez; respeitar 429.', 'Preferir uma consulta por região com todas as categorias juntas; guardar o resultado e só refazer quando vencer.', 'O robots.txt fecha /api/ para robôs de varredura; o uso da API em si segue a política acima.']::text[], 'no máximo 30 consultas por rodada, 1 a cada 10 s; menos de 100 por dia e 10 MB por dia', 10, 30, '''© colaboradores do OpenStreetMap, ODbL''.', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Disallow: /api/","termos_url":"https://wiki.openstreetmap.org/wiki/Overpass_API","trecho":"''You can assume that you don''t disturb other users when you do less than 10,000 queries per day and download less than 1 GB data per day ... If you set something up that uses the Overpass API regularly, then divide those numbers by 100 (making less than 100 queries fetching less 10 MB of data per day fine).''","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_overpass-api.de.txt","_redesign/pipeline/evidencias-fontes/pg_wiki.openstreetmap.org_wiki_Overpass_API","_redesign/pipeline/evidencias-fontes/pg_dev.overpass-api.de_overpass-doc_en_preface_commons.html"]}'::jsonb, null, true, 'mensal', null, '2026-11-18'),
  ('osm-overpass-private-coffee', 'OpenStreetMap, Overpass da Private.coffee (reserva)', 'proximidades', 'https://overpass.private.coffee/api/interpreter', 'pontos de interesse por área (consulta)', 'CONDICIONAL', array['Só como reserva do overpass-api.de, com a mesma disciplina.', 'Avisar por e-mail se o uso crescer (''notify us in advance if you intend to use our service in a large scale project'').']::text[], 'mesmo do overpass-api.de', null, null, '''© colaboradores do OpenStreetMap, ODbL''.', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"404 (sem robots)","termos_url":"https://wiki.openstreetmap.org/wiki/Overpass_API","trecho":"''Feel free to use our service in any project, there is no rate limit in place. Please notify us in advance if you intend to use our service in a large scale project.''","arquivos_locais":["_redesign/pipeline/evidencias-fontes/pg_wiki.openstreetmap.org_wiki_Overpass_API"]}'::jsonb, 'Nasce desligada (liberada = false): é só a reserva do overpass-api.de, mantida por terceiros; liberar por public.mercado_fonte_liberar quando o principal falhar, com a mesma disciplina.', false, 'mensal', null, '2026-11-18'),
  ('osm-nominatim', 'OpenStreetMap, Nominatim (achar o ponto de uma rua)', 'proximidades', 'https://nominatim.openstreetmap.org/', 'coordenada de rua e de endereço', 'CONDICIONAL', array['Script periódico: no máximo 4 buscas por minuto (1 a cada 15 s). O coletor regioes.mjs hoje faz 1 por segundo: precisa mudar.', 'Guardar todo resultado (cache) e nunca repetir a mesma busca.', 'Proibido: buscas sistemáticas, baixar todos os pontos de interesse de uma área, autocompletar. Pontos de interesse vêm do extrato ou do Overpass.', 'User-Agent válido que identifique o aplicativo (o de biblioteca não serve); só 1 máquina, 1 fila.']::text[], '4 por minuto (1 a cada 15 s), no máximo 150 ruas novas por rodada', 15, 150, '''© colaboradores do OpenStreetMap, ODbL''.', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Disallow: /search, /reverse, /lookup (para robôs de varredura)","termos_url":"https://operations.osmfoundation.org/policies/nominatim/","trecho":"''No heavy uses (an absolute maximum of 1 request per second). Provide a valid HTTP Referer or User-Agent identifying the application (stock User-Agents as set by http libraries will not do).'' ''Scripts running longer than a day and scripts that are run at regular intervals are restricted to 4 requests per minute. Results must be cached on your side.'' ''Systematic queries ... downloading all POIs in an area ... strictly forbidden.''","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_nominatim.openstreetmap.org.txt","_redesign/pipeline/evidencias-fontes/pg_operations.osmfoundation.org_policies_nominatim_"]}'::jsonb, 'Nasce desligada (liberada = false): a política pede no máximo 1 busca a cada 15 s, cache de todo resultado e nada de busca sistemática; liberar por public.mercado_fonte_liberar quando o coletor do CRM seguir isso (o regioes.mjs do protótipo faz 1 por segundo).', false, 'sob_demanda', null, '2026-11-18'),
  ('airbnb', 'Airbnb', 'temporada', 'https://www.airbnb.com.br/', 'aluguel por temporada', 'PROIBIDA', array['Termos proíbem robôs e raspagem.']::text[], 'não coletar', null, null, '—', '{}'::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * com dezenas de Disallow","termos_url":"https://www.airbnb.com.br/help/article/2908","trecho":"''Não use bots, rastreadores, raspadores ou outros meios automatizados para acessar ou coletar dados ... ou interagir de outro modo com a Plataforma Airbnb''; ''Não faça raspagem de dados''. Última atualização: 5 de fevereiro de 2026.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.airbnb.com.br.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('booking', 'Booking.com', 'temporada', 'https://www.booking.com/', 'aluguel por temporada e hotéis', 'PROIBIDA', array['Termos proíbem robôs e coleta de preços.']::text[], 'não coletar', null, null, '—', '{}'::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * com centenas de Disallow","termos_url":"https://www.booking.com/content/terms.pt-br.html","trecho":"A15.2: ''você não tem permissão para acessar, monitorar, copiar, raspar/rastrear, baixar, reproduzir ou usar ... usando qualquer robô, spider, scraper, outros meios automatizados''; A15.3: ''usar qualquer dispositivo ou software para coletar preços ou outras informações''. Atualizado em 15 de setembro de 2025.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.booking.com.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('airroi', 'AirROI (páginas grátis de mercado)', 'temporada', 'https://www.airroi.com/', 'diária média, ocupação e receita por cidade', 'PROIBIDA', array['Robô não: os termos só permitem acesso automático pela API paga e licenciada.', 'Consulta manual de uma pessoa nas páginas grátis, só para contexto interno, continua possível (o argumento de retorno de temporada já está bloqueado para o cliente).']::text[], 'não coletar (manual: à vontade, só leitura)', null, null, '—', array['tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'parnamirim-pirangi', 'natal-ponta-negra']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: /","termos_url":"https://www.airroi.com/tos","trecho":"''You will not access the Services through automated or non-human means, whether through a bot, script, or otherwise, except for accessing Data via an API if explicitly provided and licensed by us...''; ''Engage in unauthorized scraping, data mining, data harvesting...''","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.airroi.com.txt","_redesign/pipeline/evidencias-fontes/pg_airroi_tos.html"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('airdna', 'AirDNA', 'temporada', 'https://www.airdna.co/', 'aluguel por temporada', 'PROIBIDA', array['Termos não puderam ser lidos (a página devolve 403 ao nosso cliente). Sem ler os termos, não coletar.']::text[], 'não coletar', null, null, '—', '{}'::text[], true, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Disallow: /wp-admin/","termos_url":"https://www.airdna.co/terms-of-use","trecho":"Termos inacessíveis (HTTP 403) em 18/11/2026.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.airdna.co.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('airbtics', 'Airbtics', 'temporada', 'https://airbtics.com/', 'aluguel por temporada', 'PROIBIDA', array['Termos não localizados (as páginas de termos devolveram 404). A versão grátis é um ''mercado de demonstração'' com dados de amostra. Não coletar até ler os termos.']::text[], 'não coletar', null, null, '—', '{}'::text[], true, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: / (liberado de propósito, inclusive robôs de IA)","termos_url":"https://airbtics.com/terms-of-service/","trecho":"Termos inacessíveis (HTTP 404) em 18/11/2026.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_airbtics.com.txt"]}'::jsonb, null, false, 'nunca', null, '2026-11-18'),
  ('temporada-livre', 'Temporada Livre (portal de aluguel por temporada)', 'temporada', 'https://www.temporadalivre.com/', 'diária pedida por imóvel de temporada', 'CONDICIONAL', array['Só com ''de acordo'' escrito do portal antes de automatizar: os termos dizem que o portal ''se destina, exclusivamente'' a ligar viajantes e anunciantes.', 'Até lá: consulta manual, por cidade, guardando só a mediana da diária e a contagem (nada de descrição, foto ou nome).', 'Não usar páginas com filtros de data (bloqueadas no robots).']::text[], 'manual até o ''de acordo''; depois, 1 página a cada 10 s, no máximo 20 por rodada', 10, null, 'Interna: ''portal de temporada, consultado em DD/MM''.', array['tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'parnamirim-pirangi', 'natal-ponta-negra']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: / (bloqueia ?check-in=, ?check-out= e filtros)","termos_url":"https://www.temporadalivre.com/info/termos","trecho":"''O portal se destina, exclusivamente, a viabilizar a conversa entre viajantes legítimos ... com os anunciantes respectivos.'' ''É vedado o download das imagens dos anúncios ... bem como a cópia das informações dos anúncios (descrição, características) para fins de reproduzir o anúncio em qualquer outro site ou portal.''","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.temporadalivre.com.txt","_redesign/pipeline/evidencias-fontes/pg_temporadalivre_termos.html"]}'::jsonb, null, false, 'manual', null, '2026-11-18'),
  ('inside-airbnb', 'Inside Airbnb', 'temporada', 'https://insideairbnb.com/get-the-data/', 'aluguel por temporada (bases prontas)', 'PERMITIDA', array['Não cobre o RN: no Brasil só Rio de Janeiro e São Paulo. Sem uso hoje.']::text[], '—', null, null, 'Inside Airbnb (CC BY 4.0, licença conhecida; não reconferida hoje)', '{}'::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: ia_archiver Disallow: /get-the-data","termos_url":null,"trecho":"Página de dados lista só Rio de Janeiro e São Paulo no Brasil.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_insideairbnb.com.txt","_redesign/pipeline/evidencias-fontes/pg_insideairbnb_get.html"]}'::jsonb, 'Nasce desligada (liberada = false): são dados raspados do Airbnb (que está na lista de bloqueio) e não cobrem o RN.', false, 'manual', null, '2026-11-18'),
  ('fipezap-planilha', 'Índice FipeZAP, planilha e informes da Fipe', 'oficiais', 'https://downloads.fipe.org.br/indices/fipezap/fipezap-serieshistoricas.xlsx', 'preço médio de anúncio por m² (cidade de Natal, apartamento) e variação; informe mensal por bairro (PDF)', 'CONDICIONAL', array['Liberado pelo dono (entrevista de 18/11).', 'Baixar só de downloads.fipe.org.br; nunca de datazap.com.br ou de domínio do Grupo OLX.', 'Citar ''índice FipeZAP (Fipe)''; não redistribuir a planilha.', 'A página da Fipe não traz termos de reuso: tratar como citação com fonte.']::text[], '1 download por mês', null, null, '''índice FipeZAP (Fipe), mês/ano''', array['natal-ponta-negra', 'natal-capim-macio', 'natal-lagoa-nova', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"www.fipe.org.br/robots.txt não existe (404)","termos_url":"https://www.fipe.org.br/pt-br/indices/fipezap/","trecho":"Página do índice sem texto sobre reuso (conferido em 18/11/2026). O índice é calculado pela Fipe com anúncios dos portais do Grupo OLX; a Imova não acessa nenhum deles.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.fipe.org.br.txt"]}'::jsonb, null, true, 'mensal', 'fipezap', '2026-11-18'),
  ('bcb', 'Banco Central (API de mercado imobiliário e SGS)', 'oficiais', 'https://olinda.bcb.gov.br/olinda/servico/MercadoImobiliario/versao/v1/aplicacao', 'crédito imobiliário no RN, inadimplência, IVG-R', 'PERMITIDA', array['Dado aberto; sem login.', 'Citar a fonte.']::text[], '1 consulta por segundo; mensal', 1, null, '''Banco Central do Brasil''', array['RN (estado inteiro)']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: / (www.bcb.gov.br)","termos_url":"https://dadosabertos.bcb.gov.br/","trecho":"Circular BCB 3.958/2019: dados abertos são disponibilizados sob licença que permita livre uso, exigindo apenas a atribuição da fonte; o portal mostra a maior parte dos conjuntos sob ODbL.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.bcb.gov.br.txt","_redesign/pipeline/evidencias-fontes/pg_dadosabertos.bcb.gov.br_"]}'::jsonb, null, true, 'mensal', 'bcb', '2026-11-18'),
  ('ibge', 'IBGE (Censo 2022, malha de setores, CNEFE, APIs)', 'oficiais', 'https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/', 'perfil de quem mora (renda, idade, casa x apartamento, uso ocasional), setores e endereços com coordenada', 'PERMITIDA', array['Dado público; citar ''IBGE, Censo 2022''.', 'Carga única ou quando sair dado novo; APIs a 1 consulta por segundo.']::text[], '1 por segundo; carga única', 1, null, '''IBGE, Censo Demográfico 2022''', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"www.ibge.gov.br: bloqueia só pastas técnicas","termos_url":"https://www.ibge.gov.br/acesso-informacao/institucional/termos-de-uso.html","trecho":"Página de termos devolveu 403 ao nosso cliente; as publicações do IBGE autorizam a reprodução com citação da fonte.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.ibge.gov.br.txt"]}'::jsonb, null, true, 'unica', null, '2026-11-18'),
  ('siconfi', 'Tesouro Nacional, SICONFI (API de dados)', 'oficiais', 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo', 'ITBI arrecadado por cidade (RREO e DCA)', 'PERMITIDA', array['API pública, sem login.', 'Citar a fonte.']::text[], '1 consulta por segundo; bimestral', 1, null, '''Tesouro Nacional (SICONFI)''', array['Natal', 'Parnamirim', 'Extremoz', 'Tibau do Sul', 'Nísia Floresta']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"404 (sem robots)","termos_url":"https://apidatalake.tesouro.gov.br/docs/siconfi/","trecho":"API aberta documentada; sem termos restritivos.","arquivos_locais":[]}'::jsonb, null, true, 'bimestral', 'siconfi', '2026-11-18'),
  ('corrida-dos-bairros', 'A Corrida dos Bairros (Minuto Jaraguá)', 'oficiais', 'https://acorridadosbairros.com.br/rn/natal/dados.csv', 'mediana do preço pedido por m² por bairro e tipo (venda e aluguel)', 'CONDICIONAL', array['Medianas sob CC BY 4.0: dar crédito sempre.', 'Baixar só os 2 CSVs (Natal e Parnamirim) uma vez por mês.', 'Os termos dizem que ''integração em produto'' e ''consultas automatizadas em massa'' são ''sob consulta'': mandar um e-mail curto avisando o uso no CRM (pendência do dono).', 'Atenção: as medianas vêm de ''mais de 30 fontes (portais e sites de imobiliárias)''; a Imova não acessa nenhum desses portais, mas o dono pode preferir não usar.']::text[], '2 arquivos por mês', null, null, '''A Corrida dos Bairros'' com link', array['natal-ponta-negra', 'natal-capim-macio', 'natal-lagoa-nova', 'natal-potengi', 'natal-cidade-jardim', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-bonor', 'parnamirim-nova-parnamirim', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-pirangi']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Allow: /","termos_url":"https://acorridadosbairros.com.br/termos/","trecho":"''Os agregados que publicamos (medianas e contagens por bairro e por cidade) estão sob a licença CC BY 4.0. Você pode copiar, republicar e usar, inclusive em reportagem, estudo ou produto, desde que dê o crédito.'' ''Uso comercial em volume (revenda dos dados, integração em produto, consultas automatizadas em massa) é sob consulta.''","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_acorridadosbairros.com.br.txt","_redesign/pipeline/evidencias-fontes/pg_acorridadosbairros.com.br_termos","_redesign/pipeline/evidencias-fontes/pg_acorridadosbairros.com.br_metodologia"]}'::jsonb, 'Nasce desligada (liberada = false): as condições pedem um e-mail do dono avisando o uso no CRM, e as medianas vêm de mais de 30 portais (o veracidade.md §2.2 diz que o FipeZAP é a única exceção ligada ao Grupo OLX). Só entra na fila e no confronto V8 depois de public.mercado_fonte_liberar.', false, 'mensal', 'corrida', '2026-11-18'),
  ('geomapas-natal', 'Prefeitura do Natal, GeoMapas', 'obras', 'https://geomapas.natal.rn.gov.br/api.php?listar_todos', 'alvarás e habite-se 2017-2023, lotes, zoneamento, limites de bairro', 'PERMITIDA', array['Dado público municipal; sem login.', 'Conferir o catálogo uma vez por mês e baixar só camadas novas.']::text[], '1 arquivo a cada 2 s; mensal', 2, null, '''Prefeitura do Natal (GeoMapas)''', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"404 (sem robots)","termos_url":null,"trecho":"Camadas públicas para download no próprio site; nenhum termo restritivo.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_geomapas.natal.rn.gov.br.txt","_redesign/pipeline/evidencias-fontes/pg_geomapas.natal.rn.gov.br_"]}'::jsonb, null, true, 'mensal', 'construcao', '2026-11-18'),
  ('observa-natal', 'Observa Natal (painel)', 'obras', 'https://observa.natal.rn.gov.br/', 'alvarás da SEMURB até 2026 (painel)', 'CONDICIONAL', array['Painel sem planilha para baixar: só leitura manual. O arquivo é pedido pela LAI (documentos/LAI-alvaras-Natal.md).']::text[], 'manual', null, null, '''Prefeitura do Natal (Observa Natal)''', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"—","termos_url":null,"trecho":"Painel público sem download (levantamento de 17/11).","arquivos_locais":[]}'::jsonb, null, false, 'manual', null, '2026-11-18'),
  ('dom-natal', 'Diário Oficial do Município do Natal', 'obras', 'https://natal.rn.gov.br/dom', 'atos públicos: alvarás, licenças, obras, desapropriações, mudanças de zoneamento', 'PERMITIDA', array['Publicação oficial e pública; sem login.', 'Ler só as edições novas (segunda e quinta), procurar palavras como ''alvará'', ''habite-se'', ''licença'', ''loteamento''.', 'Não guardar nome de pessoa física dos atos (LGPD): só endereço, bairro, tipo e data.']::text[], '1 edição a cada 3 s; só edições novas', 3, null, '''Diário Oficial do Município do Natal, edição de DD/MM/AAAA''', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"404 (sem robots)","termos_url":null,"trecho":"Diário oficial público.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_natal.rn.gov.br.txt","_redesign/pipeline/evidencias-fontes/pg_www.natal.rn.gov.br_dom"]}'::jsonb, null, true, 'rodada', null, '2026-11-18'),
  ('dom-parnamirim', 'Diário Oficial e Portal da Transparência de Parnamirim', 'obras', 'https://www.parnamirim.rn.gov.br/', 'atos públicos e obras municipais', 'PERMITIDA', array['Publicação oficial e pública; o site é uma aplicação de página única sem robots.', 'Endereço exato do diário a confirmar no portal antes de automatizar.', 'Não guardar nome de pessoa física.']::text[], '1 página a cada 3 s; só edições novas', 3, null, '''Diário Oficial de Parnamirim, edição de DD/MM/AAAA''', array['parnamirim-bonor', 'parnamirim-pirangi', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], true, '{"consultado_em":"2026-11-18","robots_txt":"sem robots (o endereço devolve a página do site)","termos_url":null,"trecho":"Diário oficial público.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.parnamirim.rn.gov.br.txt"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('doe-rn', 'Diário Oficial do Estado do RN', 'obras', 'http://www.diariooficial.rn.gov.br/dei/dorn3', 'atos estaduais: licenças ambientais do IDEMA, obras do estado, estradas', 'PERMITIDA', array['Publicação oficial e pública.', 'Não guardar nome de pessoa física.']::text[], '1 página a cada 3 s; só edições novas', 3, null, '''Diário Oficial do RN, edição de DD/MM/AAAA''', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"404 (sem robots)","termos_url":null,"trecho":"Diário oficial público.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.diariooficial.rn.gov.br.txt"]}'::jsonb, null, true, 'rodada', null, '2026-11-18'),
  ('femurn', 'Diário Oficial dos Municípios (FEMURN)', 'obras', 'https://www.diariomunicipal.com.br/femurn/', 'atos das prefeituras menores (Tibau do Sul, Nísia Floresta, Extremoz, se aderiram)', 'PERMITIDA', array['Publicação oficial e pública; robots libera tudo.', 'Confirmar que Tibau do Sul, Nísia Floresta e Extremoz publicam ali.', 'Não guardar nome de pessoa física.']::text[], '1 página a cada 3 s; só edições novas', 3, null, '''Diário Oficial dos Municípios do RN (FEMURN), DD/MM/AAAA''', array['tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz']::text[], true, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Disallow: (vazio = tudo liberado)","termos_url":null,"trecho":"Diário oficial público.","arquivos_locais":["_redesign/pipeline/evidencias-fontes/robots_www.diariomunicipal.com.br.txt","_redesign/pipeline/evidencias-fontes/pg_www.diariomunicipal.com.br_femurn_"]}'::jsonb, null, false, 'rodada', null, '2026-11-18'),
  ('obrasgov', 'Obrasgov.br (obras com recurso federal)', 'obras', 'https://api.obrasgov.gestao.gov.br/obrasgov/api/projeto-investimento?uf=RN', 'obras públicas federais no RN (nome, situação, endereço quando houver)', 'PERMITIDA', array['API pública sem chave (testada em 18/11: devolve obras do RN).']::text[], '1 consulta por segundo; semanal', 1, null, '''Obrasgov.br (Governo Federal)''', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"—","termos_url":null,"trecho":"API aberta.","arquivos_locais":[]}'::jsonb, null, true, 'semanal', null, '2026-11-18'),
  ('portal-transparencia-federal', 'Portal da Transparência (API federal)', 'obras', 'https://api.portaldatransparencia.gov.br/swagger-ui/index.html', 'convênios e repasses para obras nos municípios', 'CONDICIONAL', array['Exige chave gratuita por cadastro de e-mail: decisão do dono sobre qual e-mail usar (nunca de portal de imóveis).', 'Respeitar o limite por minuto da documentação (conferir antes de ligar).']::text[], 'o da documentação da API', null, null, '''Portal da Transparência (CGU)''', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], true, '{"consultado_em":"2026-11-18","robots_txt":"—","termos_url":null,"trecho":"API pública com chave de cadastro.","arquivos_locais":[]}'::jsonb, null, false, 'semanal', null, '2026-11-18'),
  ('transparencia-municipal', 'Portais de transparência de Natal e Parnamirim', 'obras', 'https://www2.natal.rn.gov.br/transparencia/', 'contratos e obras municipais (páginas públicas)', 'CONDICIONAL', array['Páginas públicas, sem robots restritivo.', 'Dados quase sempre agregados: ler à mão ou 1 página a cada 5 s, só o necessário.', 'Não guardar nome de pessoa física.']::text[], '1 página a cada 5 s', 5, null, '''Portal da Transparência da Prefeitura de ...''', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-bonor', 'parnamirim-pirangi', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"sem robots restritivo","termos_url":null,"trecho":"Páginas públicas.","arquivos_locais":[]}'::jsonb, null, false, 'manual', null, '2026-11-18'),
  ('dados-rn', 'Portal de dados abertos do RN (dados.rn.gov.br)', 'obras', 'https://dados.rn.gov.br/', 'conjuntos de dados do estado', 'CONDICIONAL', array['Baixar só os arquivos dos conjuntos; o robots fecha /api/ e pede 10 s entre acessos.']::text[], '1 acesso a cada 10 s', 10, null, '''Governo do RN, dados.rn.gov.br''', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"User-agent: * Disallow: /api/; Crawl-Delay: 10","termos_url":null,"trecho":"Robots com Crawl-Delay 10.","arquivos_locais":[]}'::jsonb, null, false, 'mensal', null, '2026-11-18'),
  ('cno-receita', 'Cadastro Nacional de Obras (Receita Federal)', 'obras', null, 'obras privadas registradas por município', 'CONDICIONAL', array['Arquivo aberto oficial não localizado em 18/11 (o endereço arquivos.receitafederal.gov.br/dados/cno/ deu 404). Só usar se aparecer arquivo aberto oficial, descartando nomes de responsáveis.']::text[], '—', null, null, '''Receita Federal (CNO)''', array['natal-cidade-jardim', 'natal-capim-macio', 'natal-ponta-negra', 'natal-lagoa-nova', 'natal-potengi', 'parnamirim-bonor', 'parnamirim-pirangi', 'tibau-do-sul-pipa', 'nisia-floresta-tabatinga', 'extremoz', 'natal-satelite', 'natal-tirol', 'natal-petropolis', 'natal-candelaria', 'natal-neopolis', 'parnamirim-parque-das-nacoes', 'parnamirim-cotovelo', 'parnamirim-nova-parnamirim']::text[], true, '{"consultado_em":"2026-11-18","robots_txt":"—","termos_url":null,"trecho":"Não localizado.","arquivos_locais":[]}'::jsonb, null, false, 'manual', null, '2026-11-18'),
  ('lai-itbi-alvaras', 'Pedidos pela Lei de Acesso à Informação (ITBI de Natal e Parnamirim, alvarás de Natal)', 'lai', 'https://www2.natal.rn.gov.br/leideacesso/index/', 'preço real de venda (ITBI) e alvarás recentes', 'PERMITIDA', array['Só preparar: quem envia é o dono (documentos/LAI-ITBI-Natal.md, LAI-ITBI-Parnamirim.md, LAI-alvaras-Natal.md).', 'Pedir sem identificação de pessoas; se negado, a tabela agregada por bairro, tipo e trimestre.']::text[], '—', null, null, '''Prefeitura de ..., resposta ao pedido LAI nº ...''', array['Natal', 'Parnamirim']::text[], false, '{"consultado_em":"2026-11-18","robots_txt":"—","termos_url":null,"trecho":"Lei 12.527/2011.","arquivos_locais":[]}'::jsonb, null, true, 'manual', null, '2026-11-18')
on conflict (id) do update
  set nome = excluded.nome, grupo = excluded.grupo, url = excluded.url,
      tipo_de_dado = excluded.tipo_de_dado, veredito = excluded.veredito,
      condicoes = excluded.condicoes, ritmo_maximo = excluded.ritmo_maximo,
      intervalo_min_seg = excluded.intervalo_min_seg, max_por_rodada = excluded.max_por_rodada,
      atribuicao = excluded.atribuicao, regioes = excluded.regioes, reconferir = excluded.reconferir,
      evidencia = excluded.evidencia, obs = excluded.obs, auditada_em = excluded.auditada_em,
      -- A decisão do dono fica; só a PROIBIDA perde a liberação.
      liberada = case when excluded.veredito = 'PROIBIDA' then false else public.mercado_fontes.liberada end,
      frequencia = case when excluded.veredito = 'PROIBIDA' then 'nunca'
                        when public.mercado_fontes.frequencia = 'nunca' then excluded.frequencia
                        else public.mercado_fontes.frequencia end,
      coletor = coalesce(public.mercado_fontes.coletor, excluded.coletor),
      atualizada_em = now();

update public.mercado_fontes
   set licenca = case
                   when id like 'osm-%' then 'ODbL (© colaboradores do OpenStreetMap)'
                   when id = 'corrida-dos-bairros' then 'CC BY 4.0'
                   when id = 'fipezap-planilha' then 'citação com fonte (índice FipeZAP, Fipe); não redistribuir'
                   when grupo in ('oficiais', 'obras', 'lai') then 'dado público, citar a fonte'
                   when grupo = 'anuncios' then 'termos do site, uso interno; não republicar'
                   when grupo = 'temporada' then 'termos do site, uso interno'
                 end
 where licenca is null;

-- Quem já nasce liberada leva o porquê (as decisões do dono de 18/11 e o
-- veredito PERMITIDA da auditoria). As CONDICIONAIS que dependem de uma decisão
-- ainda aberta nascem desligadas (ver `obs` de cada uma).
update public.mercado_fontes
   set liberada_em = now(),
       liberada_motivo = case
         when id = 'chavesnamao-mcp' then 'Decisão do dono (entrevista de 18/11/2026): Chaves na Mão só pelo canal oficial (servidor MCP), com as condições da auditoria.'
         when id = 'fipezap-planilha' then 'Decisão do dono (entrevista de 18/11/2026): o índice FipeZAP, planilha pública da Fipe, pode continuar.'
         when id like 'osm-%' then 'Decisão do dono (entrevista de 18/11/2026): proximidades pelo OpenStreetMap, respeitando a política de uso e a atribuição ODbL.'
         else 'PERMITIDA pela auditoria de 18/11/2026 (dado público ou autorização direta), dentro das decisões do dono da entrevista de 18/11.'
       end
 where liberada and liberada_em is null;

-- Liberar ou recolher uma fonte (a decisão do dono). PROIBIDA nunca.
create or replace function public.mercado_fonte_liberar(p_fonte text, p_liberar boolean, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.mercado_fontes;
begin
  if not app.admin_ou_gestor() then
    raise exception 'Só admin e gestor liberam fonte de mercado.' using errcode = '42501';
  end if;
  select * into f from public.mercado_fontes where id = p_fonte for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'fonte_desconhecida');
  end if;
  if coalesce(p_liberar, false) and f.veredito = 'PROIBIDA' then
    return jsonb_build_object('ok', false, 'motivo', 'fonte_proibida');
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;
  update public.mercado_fontes
     set liberada = coalesce(p_liberar, false),
         liberada_por = auth.uid(), liberada_em = now(),
         liberada_motivo = left(btrim(p_motivo), 1000), atualizada_em = now()
   where id = f.id;
  -- Decisão de curadoria fica no audit_log (CLAUDE.md), com o antes e o depois:
  -- a linha da fonte só guarda a última.
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'mercado_fontes', f.id,
          jsonb_build_object('liberada', f.liberada, 'liberada_por', f.liberada_por, 'liberada_em', f.liberada_em,
                             'liberada_motivo', f.liberada_motivo),
          jsonb_build_object('liberada', coalesce(p_liberar, false), 'liberada_por', auth.uid(),
                             'liberada_motivo', left(btrim(p_motivo), 1000)));
  return jsonb_build_object('ok', true, 'fonte', f.id, 'liberada', coalesce(p_liberar, false),
                            'pode_coletar', (select x.pode_coletar from public.mercado_fontes x where x.id = f.id));
end $$;
comment on function public.mercado_fonte_liberar(text, boolean, text) is
  'Admin e gestor liberam (ou recolhem) uma fonte de mercado, com motivo; cada decisão vai para o audit_log. PROIBIDA nunca é liberada.';
revoke all on function public.mercado_fonte_liberar(text, boolean, text) from public, anon;
grant execute on function public.mercado_fonte_liberar(text, boolean, text) to authenticated;

-- =====================================================================
-- 4. As coletas
-- =====================================================================
create table if not exists public.mercado_coletas (
  id             bigint generated always as identity primary key,
  fonte          text not null references public.mercado_fontes (id) on update cascade,
  -- Nulo: a fonte inteira. Com região: só ela (e só ela pode sair do ar no fechamento).
  regiao_id      text references public.mercado_regioes (id) on delete set null,
  -- auto: o worker; manual: carga feita por gente ou de um levantamento (não tira ninguém do ar).
  origem         text not null default 'auto' check (origem in ('auto', 'manual')),
  inicio         timestamptz not null default now(),
  fim            timestamptz,
  situacao       text not null default 'rodando' check (situacao in ('rodando', 'ok', 'erro')),
  quantos        int not null default 0 check (quantos >= 0),
  novos          int not null default 0 check (novos >= 0),
  recusados      int not null default 0 check (recusados >= 0),
  -- Contrato V0 (veracidade §2.1): quem coletou, com que licença, como, e a
  -- impressão digital (sha256) do bruto guardado.
  coletor_versao text not null check (char_length(coletor_versao) between 1 and 80),
  licenca        text check (char_length(licenca) <= 200),
  metodo         text not null default 'campo da API' check (char_length(metodo) between 2 and 80),
  hash_bruto     text check (hash_bruto ~ '^[0-9a-f]{64}$'),
  custo          numeric(10, 2) check (custo >= 0),
  erro           text check (char_length(erro) <= 4000),
  detalhes       jsonb not null default '{}'::jsonb check (jsonb_typeof(detalhes) = 'object'),
  check (fim is null or fim >= inicio),
  check ((situacao = 'rodando') = (fim is null))
);
create index if not exists mercado_coletas_fonte_idx on public.mercado_coletas (fonte, inicio desc);
comment on table public.mercado_coletas is
  'Cada rodada de cada fonte da inteligência de mercado: origem, início, fim, quantos registros, versão do coletor, licença, método, hash do bruto e erro. Aberta e fechada pelo worker (public.mercado_coleta_abrir e _fechar).';

-- =====================================================================
-- 5. Os anúncios de terceiros e o histórico de preço
-- =====================================================================
create table if not exists public.mercado_anuncios (
  id                 uuid primary key default gen_random_uuid(),
  fonte              text not null references public.mercado_fontes (id) on update cascade,
  -- A identidade é fonte + id externo (nunca o link: o preço mora no link de alguns portais).
  id_externo         text not null check (char_length(id_externo) between 1 and 120),
  url                text not null check (char_length(url) between 8 and 1000),
  modo               text not null default 'venda' check (modo in ('venda', 'aluguel')),
  tipo               text not null check (tipo ~ '^[a-z_]{2,40}$'),
  subtipo            text check (char_length(subtipo) <= 80),
  -- O tipo refinado (gleba, terreno_condominio, casa_condominio...): app.mercado_sub.
  sub                text check (sub ~ '^[a-z_]{2,40}$'),
  titulo             text check (char_length(titulo) <= 300),
  -- Preço pedido, em reais (nunca é preço de venda: a frase diz "pedem").
  preco              bigint check (preco > 0),
  area_util          numeric(12, 2) check (area_util > 0),
  area_total         numeric(12, 2) check (area_total > 0),
  -- A área que a comparação usa: a total em terreno, galpão, chácara e fazenda;
  -- a útil no resto; e, com a útil maior que a total (áreas trocadas), a menor.
  area_ref           numeric(12, 2) generated always as (
                       case when area_util is not null and area_total is not null and area_util > 1.05 * area_total
                              then area_total
                            when tipo in ('terreno', 'terreno_comercial', 'lote', 'galpao', 'chacara', 'fazenda_sitio')
                              then coalesce(area_total, area_util)
                            else coalesce(area_util, area_total) end) stored,
  m2                 numeric(14, 2) generated always as (
                       round(preco::numeric / nullif(
                         case when area_util is not null and area_total is not null and area_util > 1.05 * area_total
                                then area_total
                              when tipo in ('terreno', 'terreno_comercial', 'lote', 'galpao', 'chacara', 'fazenda_sitio')
                                then coalesce(area_total, area_util)
                              else coalesce(area_util, area_total) end, 0), 2)) stored,
  quartos            smallint check (quartos between 0 and 99),
  suites             smallint check (suites between 0 and 99),
  banheiros          smallint check (banheiros between 0 and 99),
  vagas              smallint check (vagas between 0 and 999),
  valor_condominio   bigint check (valor_condominio >= 0),
  -- {"lazer": true, "frente_mar": true, "esquina": true, "condominio_fechado": true, ...}:
  -- só o que a fonte diz (silêncio não é "não").
  atributos          jsonb not null default '{}'::jsonb check (jsonb_typeof(atributos) = 'object'),
  bairro             text check (char_length(bairro) <= 120),
  cidade             text check (char_length(cidade) <= 120),
  uf                 text not null default 'RN' check (uf ~ '^[A-Z]{2}$'),
  logradouro         text check (char_length(logradouro) <= 200),
  -- A localidade de verdade (praia, vila, distrito), quando difere da região.
  localidade         text check (char_length(localidade) <= 120),
  regiao_id          text references public.mercado_regioes (id) on delete set null,
  lat                numeric(9, 6) check (lat between -90 and 90),
  lng                numeric(9, 6) check (lng between -180 and 180),
  -- Ponto de rua, de bairro ou aproximado nunca serve para identidade nem distância.
  loc_precisao       text check (loc_precisao in ('exata', 'esquina', 'rua', 'bairro', 'aproximada')),
  geog               extensions.geography(Point, 4326) generated always as (
                       case when lat is not null and lng is not null
                         then extensions.st_setsrid(extensions.st_makepoint(lng::float8, lat::float8), 4326)::extensions.geography
                       end) stored,
  -- Impressão da 1ª foto (dHash de 64 bits), só onde os termos deixam baixar a miniatura.
  foto_hash          bit(64),
  -- A consulta que trouxe o anúncio e se ela foi lida até o fim (regra R2).
  consulta_id        text check (char_length(consulta_id) <= 200),
  consulta_completa  boolean not null default true,
  -- auto: visto pela coleta automática; manual: só do levantamento de 17/11 (regra R3).
  origem             text not null default 'auto' check (origem in ('auto', 'manual')),
  -- Contrato V0 por anúncio (o resto vem da coleta).
  data_dado          date not null default ((now() at time zone 'America/Fortaleza')::date),
  hash_bruto         text check (hash_bruto ~ '^[0-9a-f]{64}$'),
  primeira_vez_visto timestamptz not null default now(),
  ultima_vez_visto   timestamptz not null default now(),
  primeira_coleta_id bigint not null references public.mercado_coletas (id),
  ultima_coleta_id   bigint not null references public.mercado_coletas (id),
  -- Rodadas completas seguidas da fonte em que ele faltou; com 2, saiu do ar.
  faltas             smallint not null default 0 check (faltas >= 0),
  saiu_do_ar_em      timestamptz,
  -- ok, fora (absurdo ou incoerente), oculto_proprio (é nosso, ou o mesmo imóvel
  -- nosso anunciado por outro), contestado (a equipe disse que está errado),
  -- vencido (não visto há mais de 8 dias, fora do ar ou levantamento manual velho).
  estado             text not null default 'ok'
                       check (estado in ('ok', 'fora', 'oculto_proprio', 'contestado', 'vencido')),
  motivo             text check (char_length(motivo) <= 200),
  -- As marcas calculadas pelo banco (veracidade §9.2) e as que o coletor manda
  -- (atributo_do_texto, amostra_concentrada, texto_limpo...).
  marcas             text[] not null default '{}',
  marcas_do_coletor  text[] not null default '{}',
  -- O grupo de quase gêmeos (§4.2): o id da âncora, o mais barato. Fica só ele nas contas.
  grupo_dup          uuid,
  representante      boolean generated always as (grupo_dup is null or grupo_dup = id) stored,
  -- O código do imóvel da carteira que ele é (oculto_proprio) e se pode ser o
  -- mesmo imóvel nosso anunciado por outro (bloqueia o preço do nosso).
  nosso_imovel_codigo text check (char_length(nosso_imovel_codigo) between 1 and 80),
  nosso_imovel       boolean generated always as (nosso_imovel_codigo is not null) stored,
  possivel_mesmo_imovel boolean not null default false,
  -- O que a equipe viu na conferência ({"preco": 190000}), ao lado do valor original.
  correcao_humana    jsonb check (correcao_humana is null or jsonb_typeof(correcao_humana) = 'object'),
  contestado_em      timestamptz,
  verificado_em      timestamptz,
  bruto              jsonb not null default '{}'::jsonb check (jsonb_typeof(bruto) = 'object'),
  unique (fonte, id_externo),
  check (ultima_vez_visto >= primeira_vez_visto),
  check (estado <> 'contestado' or contestado_em is not null)
);
create index if not exists mercado_anuncios_conta_idx
  on public.mercado_anuncios (regiao_id, modo, sub) where estado = 'ok';
create index if not exists mercado_anuncios_fonte_visto_idx
  on public.mercado_anuncios (fonte, ultima_vez_visto) where saiu_do_ar_em is null;
create index if not exists mercado_anuncios_grupo_idx on public.mercado_anuncios (grupo_dup) where grupo_dup is not null;
create index if not exists mercado_anuncios_nosso_idx on public.mercado_anuncios (nosso_imovel_codigo)
  where nosso_imovel_codigo is not null;
create index if not exists mercado_anuncios_geog_idx on public.mercado_anuncios using gist (geog);
comment on table public.mercado_anuncios is
  'Anúncio de terceiros visto numa fonte permitida (só Imova, 18/11/2026): preço pedido, áreas, atributos, região, primeira e última vez visto, saída do ar, estado e marcas da veracidade, grupo de repetidos e "é nosso". Escrita só pelo worker (public.mercado_anuncios_registrar) e pelas funções de veracidade.';
comment on column public.mercado_anuncios.nosso_imovel is
  'É um imóvel da carteira da Imova (código em nosso_imovel_codigo): fica fora de todas as contas.';
comment on column public.mercado_anuncios.possivel_mesmo_imovel is
  'Pode ser o mesmo imóvel de um da carteira anunciado por outro: não sai das contas, mas bloqueia o argumento de preço do nosso até a equipe decidir (mercado_pares).';

create table if not exists public.mercado_anuncio_precos (
  id          bigint generated always as identity primary key,
  anuncio_id  uuid not null references public.mercado_anuncios (id) on delete cascade,
  visto_em    timestamptz not null,
  preco       bigint not null check (preco > 0),
  coleta_id   bigint references public.mercado_coletas (id) on delete set null,
  unique (anuncio_id, visto_em)
);
create index if not exists mercado_anuncio_precos_anuncio_idx
  on public.mercado_anuncio_precos (anuncio_id, visto_em);
comment on table public.mercado_anuncio_precos is
  'Cada preço que um anúncio de terceiros já pediu, quando foi visto. Gravado pelo gatilho de mercado_anuncios no primeiro preço e quando ele muda mais de 0,1%.';

-- O histórico nasce no banco, não no worker: qualquer caminho que mude o preço deixa rastro.
create or replace function app.mercado_anuncio_preco_historico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.preco is not null
     and (tg_op = 'INSERT' or old.preco is null
          or abs(new.preco - old.preco)::numeric / old.preco > app.mercado_regra_num('{historico_preco_min}', 0.001)) then
    insert into public.mercado_anuncio_precos (anuncio_id, visto_em, preco, coleta_id)
    values (new.id, new.ultima_vez_visto, new.preco, new.ultima_coleta_id)
    on conflict (anuncio_id, visto_em)
    do update set preco = excluded.preco, coleta_id = excluded.coleta_id;
  end if;
  return new;
end $$;
revoke all on function app.mercado_anuncio_preco_historico() from public, anon, authenticated;

drop trigger if exists mercado_anuncio_preco_historico on public.mercado_anuncios;
create trigger mercado_anuncio_preco_historico
  after insert or update of preco on public.mercado_anuncios
  for each row execute function app.mercado_anuncio_preco_historico();

-- =====================================================================
-- 6. Séries mensais, Censo, proximidades, temporada e obras
-- =====================================================================
-- Todas levam o contrato V0: fonte da lista, link, coleta aberta e a data do dado.
create table if not exists public.mercado_indices (
  -- fipezap-natal-venda, bcb-credito-taxa-sfh-rn, siconfi-itbi-natal,
  -- corrida-natal-capim-macio-terreno-venda...
  serie        text not null check (serie ~ '^[a-z0-9][a-z0-9_.-]{1,80}$'),
  -- O mês a que o número se refere (data do dado), sempre no dia 1.
  mes          date not null check (extract(day from mes) = 1),
  valor        numeric not null,
  nome         text not null check (char_length(nome) between 2 and 200),
  unidade      text not null check (char_length(unidade) between 1 and 40),
  -- Onde a série mede (Natal, Capim Macio, RN) e, se casa com uma região, qual.
  local        text check (char_length(local) <= 120),
  regiao_id    text references public.mercado_regioes (id) on delete set null,
  -- Para o confronto (A Corrida dos Bairros): o tipo refinado, o modo, a
  -- amostra da fonte e se o bairro dela é só uma parte da nossa região.
  sub          text check (sub ~ '^[a-z_]{2,40}$'),
  modo         text check (modo in ('venda', 'aluguel')),
  amostra      int check (amostra >= 0),
  aproximado   boolean not null default false,
  metodo       text not null default 'planilha' check (char_length(metodo) between 2 and 80),
  fonte        text not null references public.mercado_fontes (id) on update cascade,
  url          text not null check (char_length(url) between 8 and 1000),
  obs          text check (char_length(obs) <= 1000),
  coleta_id    bigint not null references public.mercado_coletas (id),
  coletado_em  timestamptz not null default now(),
  primary key (serie, mes)
);
create index if not exists mercado_indices_regiao_idx on public.mercado_indices (regiao_id, serie);
comment on table public.mercado_indices is
  'Séries mensais de mercado (FipeZAP, Banco Central, SICONFI, A Corrida dos Bairros), um ponto por série e mês, com link e coleta. Escrita só pelo worker; "leitura de gráfico" no método vai à frase só com "cerca de".';

create table if not exists public.mercado_ibge (
  id                         bigint generated always as identity primary key,
  escopo                     text not null check (escopo in ('bairro', 'setores', 'distrito', 'municipio')),
  nome                       text not null check (char_length(nome) between 2 and 120),
  municipio                  text not null check (char_length(municipio) between 2 and 80),
  regiao_id                  text references public.mercado_regioes (id) on delete set null,
  codigo_ibge                text check (codigo_ibge ~ '^[0-9]{6,15}$'),
  ano                        smallint not null default 2022 check (ano between 1991 and 2100),
  populacao                  int check (populacao >= 0),
  crescimento_2010_2022_pct  numeric(7, 2),
  idade_mediana              numeric(5, 1) check (idade_mediana between 0 and 120),
  renda_media_responsavel    numeric(12, 2) check (renda_media_responsavel >= 0),
  renda_mediana_responsavel  numeric(12, 2) check (renda_mediana_responsavel >= 0),
  pct_apartamento            numeric(5, 2) check (pct_apartamento between 0 and 100),
  pct_casa                   numeric(5, 2) check (pct_casa between 0 and 100),
  pct_proprio                numeric(5, 2) check (pct_proprio between 0 and 100),
  pct_alugado                numeric(5, 2) check (pct_alugado between 0 and 100),
  pct_uso_ocasional          numeric(5, 2) check (pct_uso_ocasional between 0 and 100),
  pct_vagos                  numeric(5, 2) check (pct_vagos between 0 and 100),
  pct_60_mais                numeric(5, 2) check (pct_60_mais between 0 and 100),
  pct_0_14                   numeric(5, 2) check (pct_0_14 between 0 and 100),
  dados                      jsonb not null default '{}'::jsonb check (jsonb_typeof(dados) = 'object'),
  definicao                  text check (char_length(definicao) <= 1000),
  fonte                      text not null default 'ibge' references public.mercado_fontes (id) on update cascade,
  url                        text not null check (char_length(url) between 8 and 1000),
  coleta_id                  bigint not null references public.mercado_coletas (id),
  coletado_em                timestamptz not null default now(),
  unique (escopo, municipio, nome, ano)
);
create index if not exists mercado_ibge_regiao_idx on public.mercado_ibge (regiao_id);
comment on table public.mercado_ibge is
  'Censo por bairro, área montada por setores, distrito ou município (renda do responsável, idade, casa x apartamento, uso ocasional...). Carga única por Censo, pelo worker. Nunca cor ou raça (conformidade T9).';

create table if not exists public.mercado_proximidades (
  id                   bigint generated always as identity primary key,
  -- De um imóvel nosso (código da carteira) OU de um anúncio de terceiros.
  imovel_codigo        text check (char_length(imovel_codigo) between 1 and 80),
  mercado_anuncio_id   uuid references public.mercado_anuncios (id) on delete cascade,
  categoria            text not null check (categoria in ('praia', 'costa', 'escola', 'mercado', 'hospital',
                                                         'clinica', 'posto_saude', 'shopping', 'avenida',
                                                         'parque', 'farmacia', 'transporte', 'outro')),
  osm_tipo             text not null check (osm_tipo in ('node', 'way', 'relation')),
  osm_id               bigint not null check (osm_id > 0),
  osm_versao           int check (osm_versao > 0),
  osm_timestamp        timestamptz,
  -- A etiqueta usada: amenity=school, shop=supermarket, natural=beach, highway=primary...
  etiqueta             text not null check (char_length(etiqueta) between 3 and 120),
  -- Sem nome, o ponto não vai à frase.
  nome                 text check (char_length(nome) <= 200),
  lat                  numeric(9, 6) check (lat between -90 and 90),
  lng                  numeric(9, 6) check (lng between -180 and 180),
  -- Linha reta, em metros. A frase diz "cerca de", arredondado PARA CIMA em
  -- múltiplos de 100 m; praia só em faixas.
  distancia_m          int not null check (distancia_m >= 0),
  distancia_dita_m     int generated always as ((ceil(distancia_m / 100.0) * 100)::int) stored,
  faixa_praia          text generated always as (
                         case when categoria in ('praia', 'costa') then
                           case when distancia_m <= 300 then 'ate_300m'
                                when distancia_m <= 1000 then '300m_a_1km'
                                when distancia_m <= 3000 then '1_a_3km'
                                else 'mais_de_3km' end
                         end) stored,
  -- Só se calcula distância com o ponto do imóvel exato ou de esquina.
  precisao_ponto       text not null check (precisao_ponto in ('exata', 'esquina')),
  -- Escola no INEP e hospital ou posto no CNES a até 150 m; mercado e shopping, a equipe.
  segunda_fonte        text check (char_length(segunda_fonte) <= 200),
  segunda_fonte_ok     boolean,
  confirmado_equipe_em timestamptz,
  confirmado_por       uuid references public.profiles (id) on delete set null,
  fonte                text not null references public.mercado_fontes (id) on update cascade,
  url                  text not null check (char_length(url) between 8 and 1000),
  atribuicao           text not null default '© colaboradores do OpenStreetMap (ODbL)'
                         check (char_length(atribuicao) between 2 and 200),
  data_dado            date not null,
  coletado_em          timestamptz not null default now(),
  -- 90 dias para ponto de interesse; 180 para linha de costa (preenchido pelo V0 se vier vazio).
  valido_ate           date not null,
  suspenso             boolean not null default false,
  suspenso_motivo      text check (char_length(suspenso_motivo) <= 300),
  contestado_em        timestamptz,
  coleta_id            bigint not null references public.mercado_coletas (id),
  check (num_nonnulls(imovel_codigo, mercado_anuncio_id) = 1)
);
create unique index if not exists mercado_proximidades_imovel_uidx
  on public.mercado_proximidades (imovel_codigo, categoria, osm_tipo, osm_id) where imovel_codigo is not null;
create unique index if not exists mercado_proximidades_anuncio_uidx
  on public.mercado_proximidades (mercado_anuncio_id, categoria, osm_tipo, osm_id) where mercado_anuncio_id is not null;
comment on table public.mercado_proximidades is
  'O que fica perto de um imóvel nosso ou de um anúncio (praia, escola, mercado, hospital, shopping, avenida), pelo OpenStreetMap, com elemento, versão, etiqueta, distância em linha reta e atribuição ODbL. Usável na frase: app.mercado_proximidade_usavel.';

create table if not exists public.mercado_temporada (
  id                 bigint generated always as identity primary key,
  municipio          text not null check (char_length(municipio) between 2 and 80),
  regiao_id          text references public.mercado_regioes (id) on delete set null,
  janela_inicio      date not null,
  janela_fim         date not null,
  anuncios           int not null check (anuncios >= 0),
  diaria_mediana     numeric(10, 2) check (diaria_mediana between 50 and 5000),
  ocupacao_mediana_pct numeric(5, 2) check (ocupacao_mediana_pct between 5 and 95),
  metodo             text not null default 'manual' check (char_length(metodo) between 2 and 80),
  fonte              text not null references public.mercado_fontes (id) on update cascade,
  url                text not null check (char_length(url) between 8 and 1000),
  obs                text check (char_length(obs) <= 1000),
  data_dado          date not null,
  coletado_em        timestamptz not null default now(),
  coleta_id          bigint not null references public.mercado_coletas (id),
  check (janela_fim >= janela_inicio),
  unique (municipio, fonte, janela_inicio, janela_fim)
);
comment on table public.mercado_temporada is
  'Aluguel por temporada por município (só páginas grátis que permitem; mediana da diária, ocupação e contagem). NUNCA vai ao cliente (falar de retorno ou renda é proibido): só a equipe vê.';

create table if not exists public.mercado_obras (
  id              bigint generated always as identity primary key,
  fonte           text not null references public.mercado_fontes (id) on update cascade,
  -- O id do ato na fonte (edição + página + item, número do alvará...).
  id_externo      text not null check (char_length(id_externo) between 1 and 200),
  url             text not null check (char_length(url) between 8 and 1000),
  documento       text check (char_length(documento) <= 300),
  -- alvara, habite_se, licenca, loteamento, obra_publica, outro.
  tipo            text not null check (tipo in ('alvara', 'habite_se', 'licenca', 'loteamento', 'obra_publica', 'outro')),
  -- Fase pelo documento: prevista (lei, plano, edital), contratada (extrato de
  -- contrato), em_andamento (ordem de serviço, alvará de obra), concluida
  -- (recebimento, inauguração). Ao cliente só em_andamento e concluida.
  fase            text not null check (fase in ('prevista', 'contratada', 'em_andamento', 'concluida')),
  orgao           text check (char_length(orgao) <= 200),
  objeto          text not null check (char_length(objeto) between 3 and 1000),
  local_texto     text check (char_length(local_texto) <= 300),
  bairro          text check (char_length(bairro) <= 120),
  cidade          text check (char_length(cidade) <= 120),
  regiao_id       text references public.mercado_regioes (id) on delete set null,
  lat             numeric(9, 6) check (lat between -90 and 90),
  lng             numeric(9, 6) check (lng between -180 and 180),
  precisao_ponto  text check (precisao_ponto in ('exata', 'esquina', 'rua', 'bairro', 'aproximada')),
  unidades        int check (unidades >= 0),
  valor           numeric(16, 2) check (valor >= 0),
  -- A data da publicação (data do dado).
  publicado_em    date not null,
  coletado_em     timestamptz not null default now(),
  contestado_em   timestamptz,
  coleta_id       bigint not null references public.mercado_coletas (id),
  unique (fonte, id_externo)
);
create index if not exists mercado_obras_regiao_idx on public.mercado_obras (regiao_id, publicado_em desc);
comment on table public.mercado_obras is
  'Obras e alvarás públicos (prefeituras, Diário Oficial, obrasgov): documento, órgão, objeto, local, fase e data. Sem nome de pessoa física (LGPD). Validade: app.mercado_obra_valida_ate.';

-- Até quando um fato de obra vale (veracidade §8.1): em andamento, 90 dias da
-- publicação; concluída, não vence; alvará e habite-se, 12 meses; prevista e
-- contratada não vão ao cliente (vence no mesmo dia).
create or replace function app.mercado_obra_valida_ate(p_tipo text, p_fase text, p_publicado_em date)
returns date
language sql
stable
set search_path = ''
as $$
  select case
           when p_fase in ('prevista', 'contratada') then p_publicado_em
           when p_tipo in ('alvara', 'habite_se', 'licenca', 'loteamento')
             then p_publicado_em + app.mercado_regra_num('{validade_dias,alvara}', 365)::int
           when p_fase = 'concluida' then null
           else p_publicado_em + app.mercado_regra_num('{validade_dias,obra_andamento}', 90)::int
         end
$$;
comment on function app.mercado_obra_valida_ate(text, text, date) is
  'Validade de um fato de obra: em andamento 90 dias, concluída não vence (null), alvará e habite-se 12 meses, prevista e contratada só para a equipe.';
revoke all on function app.mercado_obra_valida_ate(text, text, date) from public, anon;
grant execute on function app.mercado_obra_valida_ate(text, text, date) to authenticated, service_role;

-- O contrato V0 das tabelas que o worker grava direto (veracidade §2.1): a
-- chave ligada, a fonte que PODE ser coletada (liberada, não PROIBIDA, sem
-- reconferência), a coleta aberta e da mesma fonte, e o link fora dos domínios
-- bloqueados (o FipeZAP vem do domínio da Fipe). Vale para inserir e para
-- qualquer mudança de dado; só a revisão da equipe (suspender, contestar,
-- confirmar) passa sem coleta, porque não é dado novo.
create or replace function app.mercado_v0_registro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.mercado_coletas;
  f public.mercado_fontes;
  -- Colunas da revisão da equipe e as geradas (calculadas depois deste gatilho).
  v_fora_do_dado text[] := array['suspenso', 'suspenso_motivo', 'contestado_em', 'confirmado_equipe_em',
                                 'confirmado_por', 'distancia_dita_m', 'faixa_praia'];
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_fora_do_dado) = (to_jsonb(old) - v_fora_do_dado) then
    return new;
  end if;
  if not app.mercado_ligado() then
    raise exception 'A inteligência de mercado está desligada: nada é gravado.' using errcode = '42501';
  end if;
  select * into f from public.mercado_fontes where id = new.fonte;
  if not found or not f.pode_coletar then
    raise exception 'Fonte % não pode ser coletada (veredito %, liberada %, reconferir %).',
      new.fonte, coalesce(f.veredito, 'desconhecida'), coalesce(f.liberada, false), coalesce(f.reconferir, false)
      using errcode = '42501';
  end if;
  select * into c from public.mercado_coletas where id = new.coleta_id;
  if not found or c.fonte <> new.fonte then
    raise exception 'O registro precisa de uma coleta da mesma fonte (%).', new.fonte using errcode = '22023';
  end if;
  if c.situacao <> 'rodando' then
    raise exception 'A coleta % já foi fechada: dado novo só numa coleta aberta.', c.id using errcode = '22023';
  end if;
  if app.mercado_url_bloqueada(new.url) then
    raise exception 'Link de domínio bloqueado: %', new.url using errcode = '42501';
  end if;
  if tg_table_name = 'mercado_proximidades' then
    -- A linha de costa vale 180 dias; os pontos de interesse, 90.
    if new.valido_ate is null then
      new.valido_ate := (new.coletado_em at time zone 'America/Fortaleza')::date
                        + case when new.categoria in ('praia', 'costa')
                               then app.mercado_regra_num('{validade_dias,costa}', 180)
                               else app.mercado_regra_num('{validade_dias,osm}', 90) end::int;
    end if;
  end if;
  return new;
end $$;
comment on function app.mercado_v0_registro() is
  'Contrato V0 das tabelas de mercado gravadas direto pelo worker, ao inserir e a cada mudança de dado: chave ligada, fonte que pode ser coletada (pode_coletar), coleta aberta da mesma fonte, link fora dos domínios bloqueados. A revisão da equipe (suspenso, contestado, confirmado) passa sem coleta.';
revoke all on function app.mercado_v0_registro() from public, anon, authenticated;

drop trigger if exists mercado_indices_v0 on public.mercado_indices;
create trigger mercado_indices_v0 before insert or update on public.mercado_indices
  for each row execute function app.mercado_v0_registro();
drop trigger if exists mercado_ibge_v0 on public.mercado_ibge;
create trigger mercado_ibge_v0 before insert or update on public.mercado_ibge
  for each row execute function app.mercado_v0_registro();
drop trigger if exists mercado_proximidades_v0 on public.mercado_proximidades;
create trigger mercado_proximidades_v0 before insert or update on public.mercado_proximidades
  for each row execute function app.mercado_v0_registro();
drop trigger if exists mercado_temporada_v0 on public.mercado_temporada;
create trigger mercado_temporada_v0 before insert or update on public.mercado_temporada
  for each row execute function app.mercado_v0_registro();
drop trigger if exists mercado_obras_v0 on public.mercado_obras;
create trigger mercado_obras_v0 before insert or update on public.mercado_obras
  for each row execute function app.mercado_v0_registro();

-- O ponto do mapa pode ir à frase? Com nome, não suspenso, dentro da
-- validade, e com a segunda fonte (escola e saúde) ou a equipe (mercado e
-- shopping, confirmação de 12 meses).
create or replace function app.mercado_proximidade_usavel(p public.mercado_proximidades)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p.nome is not null
     and not p.suspenso
     and p.contestado_em is null
     and p.valido_ate >= app.mercado_hoje()
     and (p.categoria not in ('escola', 'hospital', 'clinica', 'posto_saude') or coalesce(p.segunda_fonte_ok, false))
     and (p.categoria not in ('mercado', 'shopping', 'farmacia')
          or p.confirmado_equipe_em >= now() - make_interval(days => app.mercado_regra_num('{validade_dias,confirmacao_equipe}', 365)::int))
$$;
comment on function app.mercado_proximidade_usavel(public.mercado_proximidades) is
  'O ponto do OpenStreetMap pode ir à frase: com nome, não suspenso nem contestado, válido, e com segunda fonte (escola e saúde) ou confirmação da equipe nos últimos 12 meses (mercado e shopping).';
revoke all on function app.mercado_proximidade_usavel(public.mercado_proximidades) from public, anon;
grant execute on function app.mercado_proximidade_usavel(public.mercado_proximidades) to authenticated, service_role;

-- =====================================================================
-- 7. RLS e grade
-- =====================================================================
alter table public.mercado_regras         enable row level security;
alter table public.mercado_regioes        enable row level security;
alter table public.mercado_fontes         enable row level security;
alter table public.mercado_coletas        enable row level security;
alter table public.mercado_anuncios       enable row level security;
alter table public.mercado_anuncio_precos enable row level security;
alter table public.mercado_indices        enable row level security;
alter table public.mercado_ibge           enable row level security;
alter table public.mercado_proximidades   enable row level security;
alter table public.mercado_temporada      enable row level security;
alter table public.mercado_obras          enable row level security;

drop policy if exists mercado_regras_select on public.mercado_regras;
create policy mercado_regras_select on public.mercado_regras
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_regioes_select on public.mercado_regioes;
create policy mercado_regioes_select on public.mercado_regioes
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_fontes_select on public.mercado_fontes;
create policy mercado_fontes_select on public.mercado_fontes
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_coletas_select on public.mercado_coletas;
create policy mercado_coletas_select on public.mercado_coletas
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_anuncios_select on public.mercado_anuncios;
create policy mercado_anuncios_select on public.mercado_anuncios
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_anuncio_precos_select on public.mercado_anuncio_precos;
create policy mercado_anuncio_precos_select on public.mercado_anuncio_precos
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_indices_select on public.mercado_indices;
create policy mercado_indices_select on public.mercado_indices
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_ibge_select on public.mercado_ibge;
create policy mercado_ibge_select on public.mercado_ibge
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_proximidades_select on public.mercado_proximidades;
create policy mercado_proximidades_select on public.mercado_proximidades
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_temporada_select on public.mercado_temporada;
create policy mercado_temporada_select on public.mercado_temporada
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_obras_select on public.mercado_obras;
create policy mercado_obras_select on public.mercado_obras
  for select to authenticated using ((select app.is_manager()));

-- A grade fecha a porta antes da RLS: a equipe só lê, o anônimo nada, e quem
-- escreve é o worker (`service_role`) e as funções.
revoke all on public.mercado_regras, public.mercado_regioes, public.mercado_fontes, public.mercado_coletas,
  public.mercado_anuncios, public.mercado_anuncio_precos, public.mercado_indices, public.mercado_ibge,
  public.mercado_proximidades, public.mercado_temporada, public.mercado_obras from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.mercado_regras, public.mercado_regioes, public.mercado_fontes, public.mercado_coletas,
     public.mercado_anuncios, public.mercado_anuncio_precos, public.mercado_indices, public.mercado_ibge,
     public.mercado_proximidades, public.mercado_temporada, public.mercado_obras
  from authenticated;
grant select on public.mercado_regras, public.mercado_regioes, public.mercado_fontes, public.mercado_coletas,
  public.mercado_anuncios, public.mercado_anuncio_precos, public.mercado_indices, public.mercado_ibge,
  public.mercado_proximidades, public.mercado_temporada, public.mercado_obras to authenticated;
-- O worker grava direto índices, Censo, proximidades, temporada e obras (com o
-- gatilho V0); anúncios e coletas só pelas funções; regras e regiões, só pelas
-- migrações; fontes, pelas migrações e por public.mercado_fonte_liberar.
grant select on public.mercado_regras, public.mercado_regioes, public.mercado_fontes, public.mercado_coletas,
  public.mercado_anuncios, public.mercado_anuncio_precos to service_role;
grant select, insert, update on public.mercado_indices, public.mercado_ibge, public.mercado_proximidades,
  public.mercado_temporada, public.mercado_obras to service_role;
revoke insert, update, delete, truncate on public.mercado_regras, public.mercado_regioes, public.mercado_fontes,
  public.mercado_coletas, public.mercado_anuncios, public.mercado_anuncio_precos from service_role;
revoke delete, truncate on public.mercado_indices, public.mercado_ibge, public.mercado_proximidades,
  public.mercado_temporada, public.mercado_obras from service_role;
revoke all on sequence public.mercado_coletas_id_seq, public.mercado_anuncio_precos_id_seq,
  public.mercado_ibge_id_seq, public.mercado_proximidades_id_seq, public.mercado_temporada_id_seq,
  public.mercado_obras_id_seq from anon, authenticated;
grant usage, select on sequence public.mercado_ibge_id_seq, public.mercado_proximidades_id_seq,
  public.mercado_temporada_id_seq, public.mercado_obras_id_seq to service_role;

-- =====================================================================
-- 8. O que o worker chama (só service_role)
-- =====================================================================
-- Abre uma rodada. Automática ou manual (carga feita por gente, conferência à
-- mão), só de fonte que pode ser coletada: liberada, não PROIBIDA e sem
-- reconferência. A carga manual leva a fonte VERDADEIRA de onde o dado veio:
-- um levantamento tirado de fonte proibida (como a semente de 17/11, das
-- páginas HTML do Chaves na Mão) não entra com o rótulo de uma fonte permitida.
create or replace function public.mercado_coleta_abrir(
  p_fonte text,
  p_regiao text default null,
  p_origem text default 'auto',
  p_coletor_versao text default null,
  p_detalhes jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f       public.mercado_fontes;
  v_id    bigint;
  v_origem text := coalesce(nullif(btrim(p_origem), ''), 'auto');
begin
  if not app.mercado_ligado() then
    return jsonb_build_object('ok', false, 'motivo', 'desligado');
  end if;
  select * into f from public.mercado_fontes where id = lower(btrim(coalesce(p_fonte, '')));
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'fonte_desconhecida');
  end if;
  if f.veredito = 'PROIBIDA' then
    return jsonb_build_object('ok', false, 'motivo', 'fonte_proibida');
  end if;
  if v_origem not in ('auto', 'manual') then
    return jsonb_build_object('ok', false, 'motivo', 'origem_invalida');
  end if;
  if not f.pode_coletar then
    return jsonb_build_object('ok', false,
      'motivo', case when f.reconferir then 'fonte_a_reconferir' else 'fonte_nao_liberada' end);
  end if;
  if nullif(btrim(coalesce(p_coletor_versao, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_versao_do_coletor');
  end if;
  if p_regiao is not null and not exists (select 1 from public.mercado_regioes r where r.id = p_regiao) then
    return jsonb_build_object('ok', false, 'motivo', 'regiao_desconhecida');
  end if;
  insert into public.mercado_coletas (fonte, regiao_id, origem, coletor_versao, licenca, detalhes)
  values (f.id, p_regiao, v_origem, left(btrim(p_coletor_versao), 80), f.licenca,
          coalesce(case when jsonb_typeof(p_detalhes) = 'object' then p_detalhes end, '{}'::jsonb))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'coleta_id', v_id, 'fonte', f.id,
                            'intervalo_min_seg', f.intervalo_min_seg, 'max_por_rodada', f.max_por_rodada);
end $$;
comment on function public.mercado_coleta_abrir(text, text, text, text, jsonb) is
  'Abre uma rodada de coleta (auto ou manual), só de fonte com pode_coletar (liberada, não PROIBIDA, sem reconferência). Recusa com a chave desligada ou sem a versão do coletor. Só o worker.';

-- Grava um lote de anúncios de uma coleta aberta. Cada item:
--   {"id_externo": "48892102", "url": "https://...", "modo": "venda", "tipo": "casa",
--    "subtipo": "Casa / Sobrado", "titulo": "...", "preco": 500000,
--    "area_util": 60, "area_total": 200, "quartos": 2, "suites": 1, "banheiros": 1,
--    "vagas": 1, "valor_condominio": null, "atributos": {"lazer": true},
--    "bairro": "Portal do Sol", "cidade": "Extremoz", "logradouro": "...", "localidade": null,
--    "regiao_id": null, "lat": null, "lng": null, "loc_precisao": null,
--    "consulta_id": "extremoz-casa-venda", "consulta_completa": true,
--    "data_dado": "2026-11-19", "hash_bruto": "<sha256>", "marcas": ["atributo_do_texto"],
--    "bruto": {...}}
-- V0: sem id_externo, sem link, sem tipo, com link de domínio bloqueado ou com
-- link ou domínio bloqueado em QUALQUER texto do item (inclusive o bruto), o
-- item é recusado (contado e explicado em `erros`, até 20) e o resto entra.
-- Os textos livres (título, subtipo, bairro, cidade, logradouro, localidade)
-- com menção a fonte bloqueada são limpos e o anúncio ganha a marca
-- texto_limpo. Do bruto ficam só os campos do imóvel (régua `bruto_campos`):
-- nome, telefone, e-mail e descrição do anunciante nunca são guardados. Dos
-- atributos ficam só sim/não e números. Sem `regiao_id`, a região sai do
-- bairro e da cidade. Uma carga manual não mexe num anúncio que a coleta
-- automática já viu.
create or replace function public.mercado_anuncios_registrar(p_coleta bigint, p_anuncios jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c          public.mercado_coletas;
  x          jsonb;
  v_regiao   text;
  v_novo     boolean;
  v_novos    int := 0;
  v_velhos   int := 0;
  v_ignorados int := 0;
  v_ruins    int := 0;
  v_erros    jsonb := '[]'::jsonb;
  v_preco    bigint;
  v_url      text;
  v_titulo   text;
  v_limpo    text;
  v_marcas   text[];
  v_tipo     text;
  v_atrib    jsonb;
  v_area_u   numeric;
  v_area_t   numeric;
  v_subtipo  text;
  v_bairro   text;
  v_cidade   text;
  v_lograd   text;
  v_local    text;
  v_sujo     boolean;
begin
  if not app.mercado_ligado() then
    return jsonb_build_object('ok', false, 'motivo', 'desligado');
  end if;
  select * into c from public.mercado_coletas where id = p_coleta for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'coleta_desconhecida');
  end if;
  if c.situacao <> 'rodando' then
    return jsonb_build_object('ok', false, 'motivo', 'coleta_fechada');
  end if;
  if jsonb_typeof(p_anuncios) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'motivo', 'lote_nao_e_lista');
  end if;

  for x in select e from jsonb_array_elements(p_anuncios) e loop
    begin
      if jsonb_typeof(x) <> 'object' or nullif(btrim(x ->> 'id_externo'), '') is null then
        raise exception 'item sem id_externo' using errcode = '22023';
      end if;
      if x ? 'fonte' and lower(x ->> 'fonte') <> c.fonte then
        raise exception 'item de outra fonte (%), a coleta é de %', x ->> 'fonte', c.fonte using errcode = '22023';
      end if;
      v_url := app.mercado_url_canonica(x ->> 'url');
      if v_url is null or v_url !~ '^https?://' then
        raise exception 'item sem link (V0)' using errcode = '22023';
      end if;
      if app.mercado_url_bloqueada(v_url) then
        raise exception 'fonte_bloqueada: %', v_url using errcode = '42501';
      end if;
      if app.mercado_tem_link_bloqueado(x) then
        raise exception 'fonte_bloqueada: link ou domínio bloqueado dentro do item' using errcode = '42501';
      end if;
      v_tipo := lower(btrim(coalesce(x ->> 'tipo', '')));
      if v_tipo !~ '^[a-z_]{2,40}$' then
        raise exception 'item sem tipo' using errcode = '22023';
      end if;

      v_titulo := left(nullif(x ->> 'titulo', ''), 300);
      v_limpo := app.mercado_limpar_texto(v_titulo);
      v_subtipo := app.mercado_limpar_texto(left(nullif(x ->> 'subtipo', ''), 80));
      v_bairro := app.mercado_limpar_texto(left(nullif(x ->> 'bairro', ''), 120));
      v_cidade := app.mercado_limpar_texto(left(nullif(x ->> 'cidade', ''), 120));
      v_lograd := app.mercado_limpar_texto(left(nullif(x ->> 'logradouro', ''), 200));
      v_local := app.mercado_limpar_texto(left(nullif(x ->> 'localidade', ''), 120));
      v_sujo := v_limpo is distinct from v_titulo
             or v_subtipo is distinct from left(nullif(x ->> 'subtipo', ''), 80)
             or v_bairro is distinct from left(nullif(x ->> 'bairro', ''), 120)
             or v_cidade is distinct from left(nullif(x ->> 'cidade', ''), 120)
             or v_lograd is distinct from left(nullif(x ->> 'logradouro', ''), 200)
             or v_local is distinct from left(nullif(x ->> 'localidade', ''), 120);
      v_marcas := array(select distinct m from jsonb_array_elements_text(
                          case when jsonb_typeof(x -> 'marcas') = 'array' then x -> 'marcas' else '[]'::jsonb end) m
                         where m ~ '^[a-z_]{2,40}$');
      if v_sujo then
        v_marcas := array(select distinct m from unnest(v_marcas || array['texto_limpo']) m);
      end if;

      -- Uma carga manual não desfaz o que a coleta automática viu.
      if c.origem = 'manual' and exists (
           select 1 from public.mercado_anuncios m
            where m.fonte = c.fonte and m.id_externo = btrim(x ->> 'id_externo') and m.origem = 'auto') then
        v_ignorados := v_ignorados + 1;
        continue;
      end if;

      v_regiao := nullif(x ->> 'regiao_id', '');
      if v_regiao is not null and not exists (select 1 from public.mercado_regioes r where r.id = v_regiao) then
        v_regiao := null;
      end if;
      v_regiao := coalesce(v_regiao, app.mercado_regiao_do_bairro(v_bairro, v_cidade));
      v_preco := round(nullif(x ->> 'preco', '')::numeric)::bigint;
      v_area_u := nullif(x ->> 'area_util', '')::numeric;
      v_area_t := nullif(x ->> 'area_total', '')::numeric;
      -- Atributo é sim/não ou número; texto livre não entra por aqui.
      select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        into v_atrib
        from jsonb_each(
               coalesce(case when jsonb_typeof(x -> 'atributos') = 'object' then x -> 'atributos' end, '{}'::jsonb)
               || jsonb_strip_nulls(jsonb_build_object(
                    'lazer', x -> 'lazer', 'frente_mar', x -> 'frente_mar', 'vista_mar', x -> 'vista_mar',
                    'esquina', x -> 'esquina', 'condominio_fechado', x -> 'condominio_fechado'))) e
       where e.key ~ '^[a-z_]{2,40}$' and jsonb_typeof(e.value) in ('boolean', 'number');

      insert into public.mercado_anuncios as m
        (fonte, id_externo, url, modo, tipo, subtipo, sub, titulo, preco, area_util, area_total,
         quartos, suites, banheiros, vagas, valor_condominio, atributos, bairro, cidade, uf,
         logradouro, localidade, regiao_id, lat, lng, loc_precisao, consulta_id, consulta_completa,
         origem, data_dado, hash_bruto, marcas_do_coletor, primeira_coleta_id, ultima_coleta_id, bruto)
      values
        (c.fonte, btrim(x ->> 'id_externo'), v_url,
         coalesce(nullif(x ->> 'modo', ''), 'venda'), v_tipo,
         v_subtipo,
         app.mercado_sub(v_tipo,
                         case when v_area_u > 1.05 * v_area_t then v_area_t
                              when v_tipo in ('terreno', 'terreno_comercial', 'lote', 'galpao', 'chacara', 'fazenda_sitio')
                                then coalesce(v_area_t, v_area_u)
                              else coalesce(v_area_u, v_area_t) end,
                         v_atrib, v_subtipo, v_limpo),
         v_limpo, v_preco, v_area_u, v_area_t,
         nullif(x ->> 'quartos', '')::smallint, nullif(x ->> 'suites', '')::smallint,
         nullif(x ->> 'banheiros', '')::smallint, nullif(x ->> 'vagas', '')::smallint,
         round(nullif(x ->> 'valor_condominio', '')::numeric)::bigint,
         v_atrib,
         v_bairro, v_cidade,
         coalesce(nullif(upper(x ->> 'uf'), ''), 'RN'), v_lograd,
         v_local,
         v_regiao, nullif(x ->> 'lat', '')::numeric, nullif(x ->> 'lng', '')::numeric,
         nullif(x ->> 'loc_precisao', ''),
         left(nullif(x ->> 'consulta_id', ''), 200), coalesce((x ->> 'consulta_completa')::boolean, true),
         c.origem, coalesce(nullif(x ->> 'data_dado', '')::date, app.mercado_hoje()),
         nullif(lower(x ->> 'hash_bruto'), ''), v_marcas,
         c.id, c.id,
         coalesce(case when jsonb_typeof(x -> 'bruto') = 'object' then app.mercado_bruto_permitido(x -> 'bruto') end,
                  '{}'::jsonb))
      on conflict (fonte, id_externo) do update
        set url = excluded.url, modo = excluded.modo, tipo = excluded.tipo,
            subtipo = excluded.subtipo, sub = excluded.sub, titulo = excluded.titulo, preco = excluded.preco,
            area_util = excluded.area_util, area_total = excluded.area_total,
            quartos = excluded.quartos, suites = excluded.suites, banheiros = excluded.banheiros,
            vagas = excluded.vagas, valor_condominio = excluded.valor_condominio,
            atributos = excluded.atributos, bairro = excluded.bairro, cidade = excluded.cidade,
            uf = excluded.uf, logradouro = excluded.logradouro, localidade = excluded.localidade,
            regiao_id = coalesce(excluded.regiao_id, m.regiao_id),
            lat = excluded.lat, lng = excluded.lng, loc_precisao = excluded.loc_precisao,
            consulta_id = excluded.consulta_id, consulta_completa = excluded.consulta_completa,
            origem = case when c.origem = 'auto' then 'auto' else m.origem end,
            data_dado = excluded.data_dado, hash_bruto = excluded.hash_bruto,
            marcas_do_coletor = excluded.marcas_do_coletor,
            ultima_vez_visto = greatest(now(), m.primeira_vez_visto),
            ultima_coleta_id = excluded.ultima_coleta_id,
            faltas = 0, saiu_do_ar_em = null, bruto = excluded.bruto
      returning (xmax = 0) into v_novo;

      if v_novo then v_novos := v_novos + 1; else v_velhos := v_velhos + 1; end if;
    exception when others then
      v_ruins := v_ruins + 1;
      if jsonb_array_length(v_erros) < 20 then
        v_erros := v_erros || jsonb_build_object('id_externo', x ->> 'id_externo', 'erro', sqlerrm);
      end if;
    end;
  end loop;

  update public.mercado_coletas
     set quantos = quantos + v_novos + v_velhos,
         novos = novos + v_novos,
         recusados = recusados + v_ruins
   where id = c.id;

  return jsonb_build_object('ok', true, 'novos', v_novos, 'atualizados', v_velhos,
                            'ignorados', v_ignorados, 'recusados', v_ruins, 'erros', v_erros);
end $$;
comment on function public.mercado_anuncios_registrar(bigint, jsonb) is
  'Grava um lote de anúncios de terceiros de uma coleta aberta (V0 na entrada: id, link, tipo, nenhum link ou domínio bloqueado no item; textos livres limpos; bruto só com os campos do imóvel; região pelo bairro). O preço que muda vai para mercado_anuncio_precos pelo gatilho. Só o worker.';

-- Fecha a rodada. Automática, completa, sem erro e com algum anúncio visto:
-- quem a fonte não mostrou ganha uma falta, e com 2 faltas seguidas (2
-- rodadas) sai do ar. Depois roda a veracidade (212000). Uma rodada que não
-- viu nenhum anúncio não tira ninguém do ar: é mais provável o portal ter
-- mudado do que o mercado ter acabado.
create or replace function public.mercado_coleta_fechar(
  p_id bigint, p_erro text default null, p_custo numeric default null,
  p_detalhes jsonb default null, p_completa boolean default true, p_hash_bruto text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c         public.mercado_coletas;
  v_saidas  int := 0;
  v_faltas  int := 0;
  v_verif   jsonb;
  v_ok      boolean := nullif(btrim(coalesce(p_erro, '')), '') is null;
begin
  select * into c from public.mercado_coletas where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'coleta_desconhecida');
  end if;
  if c.situacao <> 'rodando' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_fechada', 'situacao', c.situacao);
  end if;
  if p_hash_bruto is not null and lower(p_hash_bruto) !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'motivo', 'hash_invalido');
  end if;

  update public.mercado_coletas
     set fim = greatest(now(), c.inicio),
         situacao = case when v_ok then 'ok' else 'erro' end,
         erro = left(nullif(btrim(p_erro), ''), 4000),
         custo = p_custo,
         hash_bruto = coalesce(lower(p_hash_bruto), c.hash_bruto),
         detalhes = c.detalhes || coalesce(case when jsonb_typeof(p_detalhes) = 'object' then p_detalhes end, '{}'::jsonb)
                    || jsonb_build_object('completa', coalesce(p_completa, false))
   where id = c.id;

  if v_ok and coalesce(p_completa, false) and c.origem = 'auto' and c.quantos > 0 then
    update public.mercado_anuncios a
       set faltas = a.faltas + 1
     where a.fonte = c.fonte
       and (c.regiao_id is null or a.regiao_id = c.regiao_id)
       and a.saiu_do_ar_em is null
       and a.origem = 'auto'
       and a.ultima_vez_visto < c.inicio;
    get diagnostics v_faltas = row_count;
    update public.mercado_anuncios a
       set saiu_do_ar_em = now()
     where a.fonte = c.fonte
       and (c.regiao_id is null or a.regiao_id = c.regiao_id)
       and a.saiu_do_ar_em is null
       and a.faltas >= app.mercado_regra_num('{saida_rodadas}', 2);
    get diagnostics v_saidas = row_count;
  end if;
  if c.quantos > 0 and to_regprocedure('app.mercado_verificar()') is not null then
    execute 'select app.mercado_verificar()' into v_verif;
  end if;

  return jsonb_build_object('ok', true,
    'situacao', case when v_ok then 'ok' else 'erro' end,
    'faltaram', v_faltas, 'sairam_do_ar', v_saidas, 'veracidade', v_verif);
end $$;
comment on function public.mercado_coleta_fechar(bigint, text, numeric, jsonb, boolean, text) is
  'Fecha a rodada de coleta. Automática, completa, sem erro e com algum anúncio visto: quem a fonte não mostrou ganha uma falta, e com 2 faltas seguidas sai do ar; depois roda a veracidade. Só o worker.';

revoke all on function public.mercado_coleta_abrir(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.mercado_anuncios_registrar(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.mercado_coleta_fechar(bigint, text, numeric, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.mercado_coleta_abrir(text, text, text, text, jsonb) to service_role;
grant execute on function public.mercado_anuncios_registrar(bigint, jsonb) to service_role;
grant execute on function public.mercado_coleta_fechar(bigint, text, numeric, jsonb, boolean, text) to service_role;

-- =====================================================================
-- 9. A fila da coleta de segunda e quinta
-- =====================================================================
-- A esteira de sempre (ADR-11): catálogo em `ingest_queues`, chave de
-- idempotência, visibility timeout, dead-letter. Uma fila só para o worker
-- `mercado` (comando novo da imagem dos workers).
alter table public.ingest_queues drop constraint if exists ingest_queues_worker_check;
alter table public.ingest_queues add constraint ingest_queues_worker_check
  check (worker = any (array['ingest', 'wa', 'ai', 'rotas', 'mercado']));

insert into public.ingest_queues (name, worker, visibility_seconds, max_attempts, dlq, description) values
  ('mercado_dlq', 'mercado', 3600, 1, null,
   'Dead-letter da inteligência de mercado: coleta que falhou além do teto. Ninguém consome automaticamente.')
on conflict (name) do update
  set worker = excluded.worker, visibility_seconds = excluded.visibility_seconds,
      max_attempts = excluded.max_attempts, dlq = excluded.dlq, description = excluded.description;
insert into public.ingest_queues (name, worker, visibility_seconds, max_attempts, dlq, description) values
  ('mercado_coleta', 'mercado', 3600, 3, 'mercado_dlq',
   'Uma fonte da inteligência de mercado para coletar ({"fonte": "chavesnamao-mcp", "coletor": "anuncios/chavesnamao", ...}). Uma hora cabe ~600 chamadas a 1 por segundo.')
on conflict (name) do update
  set worker = excluded.worker, visibility_seconds = excluded.visibility_seconds,
      max_attempts = excluded.max_attempts, dlq = excluded.dlq, description = excluded.description;

-- Segunda e quinta de manhã: uma mensagem por fonte que pode ser coletada,
-- tem coletor e está no prazo da frequência dela (rodada: toda vez; semanal:
-- 6 dias desde a última coleta boa; mensal: 27; bimestral: 55). A chave de
-- idempotência leva a data. Desligado, não enfileira nada.
create or replace function app.mercado_coleta_enfileirar()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  f       public.mercado_fontes;
  v_ult   timestamptz;
  v_n     int := 0;
  v_r     jsonb;
begin
  if not app.mercado_ligado() then
    return 0;
  end if;
  for f in
    select * from public.mercado_fontes
     where pode_coletar and coletor is not null
       and frequencia in ('rodada', 'semanal', 'mensal', 'bimestral')
     order by id
  loop
    select max(c.inicio) into v_ult
      from public.mercado_coletas c
     where c.fonte = f.id and c.origem = 'auto' and c.situacao = 'ok';
    continue when v_ult is not null and v_ult > now() - case f.frequencia
                                                          when 'semanal' then interval '6 days'
                                                          when 'mensal' then interval '27 days'
                                                          when 'bimestral' then interval '55 days'
                                                          else interval '0' end;
    v_r := app.esteira_enfileirar('mercado_coleta',
             jsonb_build_object('fonte', f.id, 'coletor', f.coletor,
                                'intervalo_min_seg', f.intervalo_min_seg, 'max_por_rodada', f.max_por_rodada),
             'mercado:' || f.id || ':' || app.mercado_hoje()::text);
    if coalesce((v_r ->> 'enfileirado')::boolean, false) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
comment on function app.mercado_coleta_enfileirar() is
  'Põe na fila mercado_coleta uma mensagem por fonte que pode ser coletada, tem coletor e está no prazo da frequência (uma vez por dia e fonte). Com a chave desligada, nada.';
revoke all on function app.mercado_coleta_enfileirar() from public, anon, authenticated;
grant execute on function app.mercado_coleta_enfileirar() to service_role;

  $ddl$;

  if not exists (select 1 from pgmq.list_queues() lq where lq.queue_name = 'mercado_dlq') then
    perform pgmq.create('mercado_dlq');
  end if;
  if not exists (select 1 from pgmq.list_queues() lq where lq.queue_name = 'mercado_coleta') then
    perform pgmq.create('mercado_coleta');
  end if;
  -- Segunda e quinta às 6h em Fortaleza (UTC-3) = 9h UTC.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mercado_coleta_seg_qui', '0 9 * * 1,4',
                          $cron$select app.mercado_coleta_enfileirar()$cron$);
  end if;
end $mercado$;

notify pgrst, 'reload schema';

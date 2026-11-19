-- =====================================================================
-- As vantagens de cada imóvel nosso, a aprovação por imóvel, a renovação
-- automática até 10% e o que a IA lê — só na Imova (18/11/2026)
--
-- Quinta das cinco migrações da inteligência de mercado (ver a 210000).
-- Decisões do dono (16/11 e 18/11/2026): "o sistema calcula, a IA
-- interpreta"; "o sistema propõe, a gestão aprova"; aprovação POR IMÓVEL, com
-- renovação automática quando cada número muda até 10%; sem vantagem
-- verdadeira, a IA segue a conversa normal.
--
-- O MOTOR (as regras de cada vantagem, `produto-argumentos-ia.md`) é o mesmo
-- JavaScript no protótipo e no worker: o que o dono aprova na tela é o que a
-- IA recebe. O banco guarda, decide o estado e protege:
--
--   * `mercado_argumentos`: uma vantagem por linha, por imóvel da carteira
--     (código): regra (P1, T1, R1, C2...), eixo, força (A, B, C), molde, anel
--     e localidade (o que o dono aprova), texto-base, números, prova (os
--     anúncios e fatos usados), fontes, data do dado, validade, momentos,
--     objeções, marcas e o estado: proposto, aprovado, recusado ou vencido.
--   * `mercado_argumento_eventos`: o histórico de cada vantagem (proposta,
--     aprovação com o pacote de prova, renovação, volta para aprovação,
--     suspensão, vencimento). Só acréscimo: é a prova guardada (CDC art. 36).
--   * `mercado_motor_execucoes`: cada vez que o motor rodou para um imóvel,
--     com a linha "Não use neste imóvel".
--   * `public.mercado_argumentos_propor(imóvel, lista, versão, não use)` (só o
--     worker): a lista COMPLETA de vantagens do imóvel nesta rodada. Nova
--     nasce proposta; aprovada se RENOVA SOZINHA quando passou no motor nesta
--     rodada de coleta e na anterior (a rodada é o dia da última coleta
--     automática boa: um novo envio do worker na mesma rodada não conta como
--     rodada nova), regra, eixo, força, molde, anel e localidade iguais, o
--     texto igual ao aprovado por pessoa com só os números trocados, cada
--     número mudou até 10% contra a última versão aprovada ou renovada e até
--     20% contra a aprovada por pessoa (os dois tetos moram na régua com
--     versão, `renovacao`, e só mudam por migração), nenhuma marca nova que
--     bloqueia (conferir, possível mesmo imóvel, quarentena, salto,
--     contestado), a ficha do imóvel igual, a amostra conferida em 1 das 2
--     últimas semanas e nenhuma fonte dela em quarentena. Senão, volta para
--     aprovação. A que sumiu do motor vence na hora. Texto, fonte citada,
--     aviso, anel, localidade e "não use" com nome de portal ou de imobiliária
--     de onde vêm os anúncios não entram (a conformidade manda nunca nomear a
--     fonte de anúncio ao cliente).
--   * `public.mercado_argumento_decidir` e `public.mercado_argumentos_aprovar_imovel`:
--     admin e gestor aprovam, recusam ou devolvem (com as travas: validade,
--     ficha igual, sem contestado, quarentena ou possível mesmo imóvel; preço
--     bloqueado com par sem decisão; "conferir" só com confirmação).
--   * `app.mercado_vantagens_para_ia()`: o que a IA recebe — só com a chave
--     ligada, só aprovada, dentro da validade, com a ficha igual e sem marca
--     que bloqueia; sem prova, sem link e sem nome de fonte de anúncio (o
--     filtro de nomes roda de novo na leitura). Na KOMUNE existe e devolve vazio.
--   * `app.mercado_rotina_diaria()` (pg_cron, 3h15 de Fortaleza): refaz a
--     veracidade e vence o que passou da validade.
--
-- COMO DESFAZER (no banco da Imova):
--   select cron.unschedule('mercado_rotina_diaria');
--   drop function if exists public.mercado_argumentos_propor(text, jsonb, text, text[]),
--     public.mercado_argumento_decidir(uuid, text, text, boolean),
--     public.mercado_argumentos_aprovar_imovel(text, uuid[], boolean),
--     public.mercado_vantagens_para_ia(), app.mercado_vantagens_do_imovel(text),
--     app.mercado_argumentos_suspender(uuid, text, text), app.mercado_argumentos_vencer(),
--     app.mercado_rotina_diaria(), app.mercado_numeros_perto(jsonb, jsonb, numeric),
--     app.mercado_ficha(text), app.mercado_ficha_hash(text), app.mercado_validade_anuncios(text, date),
--     app.mercado_argumento_evento(), app.mercado_texto_proibido(text), app.mercado_texto_molde(text),
--     app.mercado_rodada();
--   drop table if exists public.mercado_argumento_eventos, public.mercado_motor_execucoes,
--     public.mercado_argumentos;
--   e recriar o stub de app.mercado_vantagens_para_ia() que devolve '{}'.
-- =====================================================================

-- Em qualquer banco: a leitura da IA existe (na KOMUNE e com a chave
-- desligada, vazia), para quem monta a base da IA chamar sem perguntar antes.
create or replace function app.mercado_vantagens_para_ia()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select '{}'::jsonb
$$;
comment on function app.mercado_vantagens_para_ia() is
  'As vantagens de mercado que a IA recebe, por código de imóvel. Na KOMUNE, sempre vazio.';
revoke all on function app.mercado_vantagens_para_ia() from public, anon, authenticated;
grant execute on function app.mercado_vantagens_para_ia() to service_role;

do $vantagens$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A inteligência de mercado é só da Imova: no banco da KOMUNE só a leitura vazia da IA existe.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. Ajudas: ficha, números, validade, texto proibido
-- =====================================================================
-- A ficha do imóvel que importa para as vantagens. Mudou, as vantagens são refeitas.
create or replace function app.mercado_ficha(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('tipo', k.tipo, 'sub', k.sub, 'negocio', k.negocio, 'preco_venda', k.preco_venda,
                            'preco_aluguel', k.preco_aluguel, 'area_util', k.area_util, 'area_total', k.area_total,
                            'quartos', k.quartos, 'bairro', k.bairro, 'cidade', k.cidade, 'regiao_id', k.regiao_id)
    from app.mercado_carteira() k
   where k.codigo = p_codigo
   limit 1
$$;
revoke all on function app.mercado_ficha(text) from public, anon;
grant execute on function app.mercado_ficha(text) to authenticated, service_role;

create or replace function app.mercado_ficha_hash(p_codigo text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(app.mercado_ficha(p_codigo)::text)
$$;
revoke all on function app.mercado_ficha_hash(text) from public, anon;
grant execute on function app.mercado_ficha_hash(text) to authenticated, service_role;

-- Cada número de p_novo está a até p_lim (fração) do mesmo número em p_ref? As
-- chaves precisam ser as mesmas; o que não é número precisa ser igual.
create or replace function app.mercado_numeros_perto(p_novo jsonb, p_ref jsonb, p_lim numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_novo) = 'object' and jsonb_typeof(p_ref) = 'object'
     and (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_novo) k)
       = (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_ref) k)
     and coalesce((
       select bool_and(
                case when jsonb_typeof(n.value) = 'number' and jsonb_typeof(p_ref -> n.key) = 'number' then
                       case when (p_ref ->> n.key)::numeric = 0 then (n.value #>> '{}')::numeric = 0
                            else abs((n.value #>> '{}')::numeric / (p_ref ->> n.key)::numeric - 1) <= p_lim + 0.0000001
                       end
                     else n.value = p_ref -> n.key
                end)
         from jsonb_each(p_novo) n), true)
$$;
comment on function app.mercado_numeros_perto(jsonb, jsonb, numeric) is
  'Os números de uma vantagem mudaram até p_lim (fração) contra a referência? Mesmas chaves; o que não é número tem de ser igual.';
revoke all on function app.mercado_numeros_perto(jsonb, jsonb, numeric) from public, anon;
grant execute on function app.mercado_numeros_perto(jsonb, jsonb, numeric) to authenticated, service_role;

-- A validade de uma vantagem tirada de anúncios (§8.1): 14 dias desde a coleta;
-- 7 em imóvel de praia na alta temporada (1/12 a 28/2 e julho).
create or replace function app.mercado_validade_anuncios(p_regiao text, p_base date)
returns date
language sql
stable
set search_path = ''
as $$
  select p_base + case
           when coalesce((select r.litoral from public.mercado_regioes r where r.id = p_regiao), false)
                and extract(month from p_base) in (12, 1, 2, 7)
             then app.mercado_regra_num('{validade_dias,vantagem_praia_alta}', 7)
           else app.mercado_regra_num('{validade_dias,vantagem}', 14)
         end::int
$$;
revoke all on function app.mercado_validade_anuncios(text, date) from public, anon;
grant execute on function app.mercado_validade_anuncios(text, date) to authenticated, service_role;

-- Palavras que nunca vão ao cliente (conformidade): avaliação, futuro e
-- superlativo vazio, e o nome de qualquer fonte de anúncio (as bloqueadas e
-- as de onde vêm os anúncios, como o Chaves na Mão: app.mercado_nomeia_fonte).
-- O motor já evita; o banco recusa por garantia.
create or replace function app.mercado_texto_proibido(p_texto text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(app.mercado_texto_chave(p_texto), '') ~
         '(valorizacao garantida|garantia de valorizacao|vai valorizar|vai subir|valor de mercado|preco justo|abaixo do mercado|avaliad[oa] em|o mais barato|retorno garantido|rentabilidade garantida)'
      or app.mercado_nomeia_fonte(p_texto)
$$;
comment on function app.mercado_texto_proibido(text) is
  'O texto tem palavra proibida ao cliente (valorização garantida, valor de mercado, preço justo, abaixo do mercado, avaliado em, o mais barato...) ou nome de fonte de anúncio (bloqueada ou de onde vêm os anúncios)?';
revoke all on function app.mercado_texto_proibido(text) from public, anon;
grant execute on function app.mercado_texto_proibido(text) to authenticated, service_role;

-- O molde de um texto: os números trocados por "#". A renovação automática só
-- aceita o texto aprovado por pessoa com os números trocados; frase nova volta
-- para aprovação.
create or replace function app.mercado_texto_molde(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(btrim(coalesce(p_texto, '')), '[0-9]+([.,][0-9]+)*', '#', 'g')
$$;
comment on function app.mercado_texto_molde(text) is
  'O texto com cada número trocado por "#": compara a frase aprovada com a renovada sem olhar os números.';
revoke all on function app.mercado_texto_molde(text) from public, anon;
grant execute on function app.mercado_texto_molde(text) to authenticated, service_role;

-- A rodada de coleta: o dia, em Fortaleza, da última coleta automática boa
-- (segunda ou quinta). Nula antes da primeira. Um novo envio do worker na
-- mesma rodada (a fila tenta até 3 vezes) não conta como rodada nova.
create or replace function app.mercado_rodada()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select max((c.fim at time zone 'America/Fortaleza')::date)
    from public.mercado_coletas c
   where c.origem = 'auto' and c.situacao = 'ok' and c.fim is not null
$$;
comment on function app.mercado_rodada() is
  'A rodada de coleta atual: o dia (Fortaleza) da última coleta automática boa. Nula antes da primeira.';
revoke all on function app.mercado_rodada() from public, anon;
grant execute on function app.mercado_rodada() to authenticated, service_role;

-- =====================================================================
-- 2. As tabelas
-- =====================================================================
create table if not exists public.mercado_motor_execucoes (
  id             bigint generated always as identity primary key,
  imovel_codigo  text not null check (char_length(imovel_codigo) between 1 and 80),
  executado_em   timestamptz not null default now(),
  motor_versao   text not null check (char_length(motor_versao) between 1 and 80),
  regras_versao  text,
  n_argumentos   int not null default 0,
  -- "Não use neste imóvel": o QUE não dizer, nunca o porquê.
  nao_use        text[] not null default '{}' check (cardinality(nao_use) <= 30),
  ficha_hash     text,
  -- A rodada de coleta em que o motor rodou (app.mercado_rodada()).
  rodada         date
);
create index if not exists mercado_motor_execucoes_imovel_idx on public.mercado_motor_execucoes (imovel_codigo, id desc);
comment on table public.mercado_motor_execucoes is
  'Cada vez que o motor de vantagens rodou para um imóvel da carteira: versão do motor e das réguas, quantas vantagens e a linha "Não use neste imóvel".';

create table if not exists public.mercado_argumentos (
  id                    uuid primary key default gen_random_uuid(),
  imovel_codigo         text not null check (char_length(imovel_codigo) between 1 and 80),
  anuncio_id            uuid references public.anuncios (id) on delete set null,
  -- O id estável que o motor dá à vantagem ("cm3000-tamanho").
  chave                 text not null check (chave ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{1,79}$'),
  -- O id do catálogo (P1, P3, A1, R1, T1, D1, L1, G1, C1, C2, S1, O1...).
  regra                 text not null check (regra ~ '^[A-Z][A-Z0-9]{0,5}$'),
  eixo                  text not null check (eixo in ('preco', 'atributo', 'raridade', 'tamanho', 'documentacao',
                                                      'proximidade', 'regiao', 'obra', 'procura', 'serie')),
  forca                 text not null check (forca in ('A', 'B', 'C')),
  -- O que o dono aprova junto com a vantagem: o molde da frase, o anel e a localidade.
  molde                 text not null check (char_length(molde) between 1 and 80),
  anel                  text check (char_length(anel) <= 120),
  localidade            text check (char_length(localidade) <= 120),
  -- A célula de comparação (para quarentena e salto).
  regiao_id             text references public.mercado_regioes (id) on delete set null,
  sub                   text check (sub ~ '^[a-z_]{2,40}$'),
  texto                 text not null check (char_length(texto) between 10 and 400),
  -- Como citar de leve ("pelos anúncios da região que acompanhamos", "pelo Censo 2022 do IBGE").
  fonte_texto           text not null check (char_length(fonte_texto) between 3 and 200),
  numeros               jsonb not null default '{}'::jsonb check (jsonb_typeof(numeros) = 'object'),
  -- O pacote de prova: {"anuncios": [uuid...], "itens": ["proximidade:12", "obra:7",
  -- "indice:fipezap-natal-venda|2026-10-01"], "pesos": {"<uuid>": 2}, "conjunto": "..."}.
  prova                 jsonb not null default '{}'::jsonb check (jsonb_typeof(prova) = 'object'),
  fontes                text[] not null default '{}',
  data_dado             date not null,
  coletado_em           timestamptz not null,
  valido_ate            date not null,
  momentos              text[] not null default '{}'
                          check (momentos <@ array['apresentacao', 'interesse', 'preco', 'comparacao',
                                                   'antes_convite', 'retomada']::text[]),
  objecoes              text[] not null default '{}'
                          check (objecoes <@ array['caro', 'mais_barato', 'regiao', 'investimento', 'tamanho',
                                                   'documentacao', 'por_que_esse']::text[]),
  explica_preco         boolean not null default false,
  so_com_preco_dito     boolean not null default false,
  aviso                 text check (char_length(aviso) <= 500),
  marcas                text[] not null default '{}',
  hash_dados            text not null check (char_length(hash_dados) between 8 and 128),
  motor_versao          text not null check (char_length(motor_versao) between 1 and 80),
  regras_versao         text,
  ficha_hash            text,
  status                text not null default 'proposto' check (status in ('proposto', 'aprovado', 'recusado', 'vencido')),
  motivo_status         text check (char_length(motivo_status) <= 500),
  aprovado_por          uuid references public.profiles (id) on delete set null,
  aprovado_em           timestamptz,
  aprovado_numeros      jsonb,
  aprovado_texto        text,
  aprovado_marcas       text[],
  -- A última versão aprovada OU renovada (a régua dos 10%).
  ultima_versao_numeros jsonb,
  ultima_versao_em      timestamptz,
  renovacoes            int not null default 0,
  renovado_em           timestamptz,
  recusado_por          uuid references public.profiles (id) on delete set null,
  recusado_em           timestamptz,
  recusado_numeros      jsonb,
  -- Em quantas rodadas de COLETA seguidas a vantagem saiu do motor (um novo
  -- envio na mesma rodada não soma) e a rodada da última vez.
  rodadas_seguidas      int not null default 1 check (rodadas_seguidas >= 1),
  ultima_rodada         date,
  ultima_execucao_id    bigint references public.mercado_motor_execucoes (id) on delete set null,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  unique (imovel_codigo, chave),
  check (status <> 'aprovado' or (aprovado_em is not null and aprovado_numeros is not null
                                   and ultima_versao_numeros is not null)),
  check (valido_ate >= data_dado)
);
create index if not exists mercado_argumentos_imovel_idx on public.mercado_argumentos (imovel_codigo, status);
create index if not exists mercado_argumentos_prova_idx on public.mercado_argumentos using gin (prova jsonb_path_ops);
comment on table public.mercado_argumentos is
  'As vantagens de cada imóvel da carteira (só Imova, 18/11/2026): regra, eixo, força, molde, texto-base, números, prova, fontes, validade, momentos, objeções, marcas e estado (proposto, aprovado, recusado, vencido), com a aprovação por imóvel e a renovação automática até 10%. Escrita pelas funções; a IA lê por app.mercado_vantagens_para_ia.';

create table if not exists public.mercado_argumento_eventos (
  id             bigint generated always as identity primary key,
  argumento_id   uuid not null references public.mercado_argumentos (id) on delete restrict,
  evento         text not null check (evento in ('proposto', 'atualizado', 'aprovado', 'renovado',
                                                 'voltou_para_aprovacao', 'recusado', 'vencido', 'suspenso',
                                                 'reaberto')),
  status_antes   text,
  status_depois  text not null,
  numeros_antes  jsonb,
  numeros_depois jsonb,
  texto          text,
  -- O pacote de prova na aprovação e na renovação (guardar 5 anos, CDC art. 27).
  prova          jsonb,
  hash_dados     text,
  motivo         text check (char_length(motivo) <= 500),
  por            uuid references public.profiles (id) on delete set null,
  em             timestamptz not null default now()
);
create index if not exists mercado_argumento_eventos_arg_idx on public.mercado_argumento_eventos (argumento_id, id);
comment on table public.mercado_argumento_eventos is
  'O histórico de cada vantagem de mercado, só com acréscimo: proposta, aprovação (com o pacote de prova), renovação, volta para aprovação, suspensão, recusa e vencimento.';

create or replace function app.mercado_argumento_evento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O histórico das vantagens de mercado só recebe acréscimo.' using errcode = '42501';
end $$;
revoke all on function app.mercado_argumento_evento() from public, anon, authenticated;
drop trigger if exists mercado_argumento_eventos_so_acrescimo on public.mercado_argumento_eventos;
create trigger mercado_argumento_eventos_so_acrescimo before update or delete on public.mercado_argumento_eventos
  for each row execute function app.mercado_argumento_evento();

alter table public.mercado_motor_execucoes   enable row level security;
alter table public.mercado_argumentos        enable row level security;
alter table public.mercado_argumento_eventos enable row level security;
drop policy if exists mercado_motor_execucoes_select on public.mercado_motor_execucoes;
create policy mercado_motor_execucoes_select on public.mercado_motor_execucoes
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_argumentos_select on public.mercado_argumentos;
create policy mercado_argumentos_select on public.mercado_argumentos
  for select to authenticated using ((select app.is_manager()));
drop policy if exists mercado_argumento_eventos_select on public.mercado_argumento_eventos;
create policy mercado_argumento_eventos_select on public.mercado_argumento_eventos
  for select to authenticated using ((select app.is_manager()));
revoke all on public.mercado_motor_execucoes, public.mercado_argumentos, public.mercado_argumento_eventos from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.mercado_motor_execucoes, public.mercado_argumentos, public.mercado_argumento_eventos
  from authenticated, service_role;
grant select on public.mercado_motor_execucoes, public.mercado_argumentos, public.mercado_argumento_eventos
  to authenticated, service_role;
revoke all on sequence public.mercado_motor_execucoes_id_seq, public.mercado_argumento_eventos_id_seq
  from anon, authenticated;

-- =====================================================================
-- 3. O motor propõe (só o worker)
-- =====================================================================
-- Cada item de p_argumentos:
--   {"chave": "cm3000-tamanho", "regra": "T1", "eixo": "tamanho", "forca": "A",
--    "molde": "T1-raro", "anel": "Capim Macio", "localidade": "Capim Macio",
--    "regiao_id": "natal-capim-macio", "sub": "terreno",
--    "texto": "...", "fonte_texto": "pelos anúncios da região que acompanhamos",
--    "numeros": {"area": 3000, "n": 26, "menores": 21},
--    "prova": {"anuncios": ["<uuid>", ...], "itens": [], "pesos": {}},
--    "fontes": ["chavesnamao-mcp"], "data_dado": "2026-11-19",
--    "coletado_em": "2026-11-19T09:40:00-03:00", "valido_ate": "2026-12-03",
--    "momentos": ["apresentacao", "retomada"], "objecoes": ["tamanho"],
--    "explica_preco": false, "so_com_preco_dito": false, "aviso": null,
--    "marcas": [], "hash_dados": "<sha256>"}
-- A lista é a COMPLETA do imóvel nesta rodada: a vantagem proposta ou
-- aprovada que não vier vence (motivo saiu_do_motor).
create or replace function public.mercado_argumentos_propor(
  p_imovel text, p_argumentos jsonb, p_motor_versao text, p_nao_use text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Os tetos da renovação (decisão do dono: 10% por rodada, 20% desde a
  -- aprovação) vêm da régua com versão, que só muda por migração.
  v_rodada     numeric := app.mercado_regra_num('{renovacao,por_rodada}', 0.10);
  v_acum       numeric := app.mercado_regra_num('{renovacao,acumulada}', 0.20);
  v_bloqueia   text[] := array['conferir', 'possivel_mesmo_imovel', 'quarentena', 'salto', 'contestado'];
  v_regras     text := (select r.versao from public.mercado_regras r where r.ativa);
  v_ficha      text;
  v_anuncio    uuid;
  v_rodada_dt  date := app.mercado_rodada();
  v_rodada_ant date;
  v_nao_use    text[];
  v_nao_use_fora int := 0;
  v_exec       bigint;
  v_preco_bloq boolean;
  v_em_dia     boolean;
  v_quar       text[];
  x            jsonb;
  e            public.mercado_argumentos;
  v_chaves     text[] := '{}'::text[];
  v_marcas     text[];
  v_valido     date;
  v_coletado   timestamptz;
  v_motivos    text[];
  v_rodadas    int;
  v_numeros    jsonb;
  v_row        jsonb;
  v_novos      int := 0;
  v_renovados  int := 0;
  v_voltaram   int := 0;
  v_atualizados int := 0;
  v_vencidos   int := 0;
  v_recusados  jsonb := '[]'::jsonb;
  v_n          int := 0;
begin
  if not app.mercado_ligado() then
    return jsonb_build_object('ok', false, 'motivo', 'desligado');
  end if;
  if jsonb_typeof(p_argumentos) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'motivo', 'lista_nao_e_lista');
  end if;
  if nullif(btrim(coalesce(p_motor_versao, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_versao_do_motor');
  end if;
  v_ficha := app.mercado_ficha_hash(p_imovel);
  if v_ficha is null then
    return jsonb_build_object('ok', false, 'motivo', 'imovel_desconhecido');
  end if;
  select k.anuncio_id into v_anuncio from app.mercado_carteira() k where k.codigo = p_imovel limit 1;
  v_preco_bloq := app.mercado_preco_bloqueado(p_imovel);
  v_em_dia := app.mercado_amostra_em_dia();
  v_quar := app.mercado_fontes_em_quarentena();

  -- A rodada anterior em que o motor rodou para este imóvel.
  select max(m.rodada) into v_rodada_ant
    from public.mercado_motor_execucoes m
   where m.imovel_codigo = p_imovel and v_rodada_dt is not null and m.rodada < v_rodada_dt;
  -- "Não use neste imóvel" vai inteiro à IA: o item que nomeia portal ou
  -- imobiliária de onde vêm os anúncios fica de fora (e é contado).
  v_nao_use := coalesce((select (array_agg(left(btrim(u.t), 300) order by u.o))[1:30]
                           from unnest(p_nao_use) with ordinality as u(t, o)
                          where nullif(btrim(u.t), '') is not null and not app.mercado_nomeia_fonte(u.t)), '{}'::text[]);
  v_nao_use_fora := (select count(*)::int from unnest(p_nao_use) as u(t)
                      where nullif(btrim(u.t), '') is not null and app.mercado_nomeia_fonte(u.t));
  insert into public.mercado_motor_execucoes (imovel_codigo, motor_versao, regras_versao, nao_use, ficha_hash, rodada)
  values (p_imovel, left(btrim(p_motor_versao), 80), v_regras, v_nao_use, v_ficha, v_rodada_dt)
  returning id into v_exec;

  for x in select el from jsonb_array_elements(p_argumentos) el loop
    begin
      if jsonb_typeof(x) <> 'object' or nullif(btrim(x ->> 'chave'), '') is null then
        raise exception 'item sem chave' using errcode = '22023';
      end if;
      if (x ->> 'chave') = any (v_chaves) then
        raise exception 'chave repetida na lista' using errcode = '22023';
      end if;
      -- O que vai ao cliente (o texto e a fonte citada de leve): sem palavra
      -- proibida e sem nome de fonte de anúncio. O que fica com a equipe e a IA
      -- (aviso, anel, localidade): sem nome de fonte de anúncio.
      if app.mercado_texto_proibido(x ->> 'texto') then
        raise exception 'texto com palavra proibida ou nome de fonte de anúncio' using errcode = '22023';
      end if;
      if nullif(btrim(coalesce(x ->> 'fonte_texto', '')), '') is null then
        raise exception 'sem fonte_texto' using errcode = '22023';
      end if;
      if app.mercado_texto_proibido(x ->> 'fonte_texto') then
        raise exception 'fonte_texto com palavra proibida ou nome de fonte de anúncio' using errcode = '22023';
      end if;
      if app.mercado_nomeia_fonte(x ->> 'aviso') or app.mercado_nomeia_fonte(x ->> 'anel')
         or app.mercado_nomeia_fonte(x ->> 'localidade') then
        raise exception 'aviso, anel ou localidade com nome de fonte de anúncio' using errcode = '22023';
      end if;
      if jsonb_typeof(x -> 'numeros') is distinct from 'object' then
        raise exception 'sem numeros' using errcode = '22023';
      end if;
      v_coletado := coalesce(nullif(x ->> 'coletado_em', '')::timestamptz, now());
      v_valido := nullif(x ->> 'valido_ate', '')::date;
      if v_valido is null then
        raise exception 'sem validade' using errcode = '22023';
      end if;
      -- A vantagem tirada de anúncios nunca vale mais que 14 dias (7 na praia na alta).
      if (x ->> 'eixo') in ('preco', 'atributo', 'raridade', 'tamanho') then
        v_valido := least(v_valido, app.mercado_validade_anuncios(
                      coalesce(nullif(x ->> 'regiao_id', ''), (app.mercado_ficha(p_imovel) ->> 'regiao_id')),
                      (v_coletado at time zone 'America/Fortaleza')::date));
      end if;

      v_marcas := array(select distinct m from jsonb_array_elements_text(
                          case when jsonb_typeof(x -> 'marcas') = 'array' then x -> 'marcas' else '[]'::jsonb end) m
                         where m ~ '^[a-z_]{2,40}$');
      if v_preco_bloq and ((x ->> 'eixo') = 'preco' or coalesce((x ->> 'explica_preco')::boolean, false)) then
        v_marcas := v_marcas || array['possivel_mesmo_imovel'];
      end if;
      if exists (select 1 from public.mercado_celulas k
                  where k.regiao_id = nullif(x ->> 'regiao_id', '') and k.sub = nullif(x ->> 'sub', '')
                    and k.modo = 'venda' and k.estado = 'quarentena')
         and ((x ->> 'eixo') = 'preco' or coalesce((x ->> 'explica_preco')::boolean, false)) then
        v_marcas := v_marcas || array['quarentena'];
      end if;
      if exists (select 1 from public.mercado_celulas k
                  where k.regiao_id = nullif(x ->> 'regiao_id', '') and k.sub = nullif(x ->> 'sub', '')
                    and k.modo = 'venda' and k.salto) then
        v_marcas := v_marcas || array['salto'];
      end if;
      if exists (select 1 from jsonb_array_elements_text(
                   case when jsonb_typeof(x -> 'fontes') = 'array' then x -> 'fontes' else '[]'::jsonb end) f
                  where f = any (v_quar)) then
        v_marcas := v_marcas || array['quarentena'];
      end if;
      v_marcas := array(select distinct m from unnest(v_marcas) m order by m);
      v_numeros := x -> 'numeros';

      select * into e from public.mercado_argumentos a
       where a.imovel_codigo = p_imovel and a.chave = btrim(x ->> 'chave')
       for update;

      if not found then
        insert into public.mercado_argumentos
          (imovel_codigo, anuncio_id, chave, regra, eixo, forca, molde, anel, localidade, regiao_id, sub, texto,
           fonte_texto, numeros, prova, fontes, data_dado, coletado_em, valido_ate, momentos, objecoes,
           explica_preco, so_com_preco_dito, aviso, marcas, hash_dados, motor_versao, regras_versao, ficha_hash,
           status, rodadas_seguidas, ultima_rodada, ultima_execucao_id)
        values
          (p_imovel, v_anuncio, btrim(x ->> 'chave'), x ->> 'regra', x ->> 'eixo', x ->> 'forca',
           coalesce(nullif(x ->> 'molde', ''), x ->> 'regra'), nullif(x ->> 'anel', ''), nullif(x ->> 'localidade', ''),
           (select r.id from public.mercado_regioes r where r.id = nullif(x ->> 'regiao_id', '')),
           nullif(x ->> 'sub', ''), btrim(x ->> 'texto'), btrim(x ->> 'fonte_texto'), v_numeros,
           coalesce(case when jsonb_typeof(x -> 'prova') = 'object' then x -> 'prova' end, '{}'::jsonb),
           coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(x -> 'fontes') = 'array'
                                                                then x -> 'fontes' else '[]'::jsonb end)), '{}'),
           (x ->> 'data_dado')::date, v_coletado, v_valido,
           coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(x -> 'momentos') = 'array'
                                                                then x -> 'momentos' else '[]'::jsonb end)), '{}'),
           coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(x -> 'objecoes') = 'array'
                                                                then x -> 'objecoes' else '[]'::jsonb end)), '{}'),
           coalesce((x ->> 'explica_preco')::boolean, false), coalesce((x ->> 'so_com_preco_dito')::boolean, false),
           nullif(x ->> 'aviso', ''), v_marcas, x ->> 'hash_dados', left(btrim(p_motor_versao), 80), v_regras, v_ficha,
           'proposto', 1, v_rodada_dt, v_exec)
        returning * into e;
        insert into public.mercado_argumento_eventos (argumento_id, evento, status_antes, status_depois, numeros_depois,
                                                       texto, hash_dados, motivo)
        values (e.id, 'proposto', null, 'proposto', e.numeros, e.texto, e.hash_dados, 'motor ' || e.motor_versao);
        v_novos := v_novos + 1;
      else
        -- Mesma rodada de coleta (novo envio do worker): não soma. Rodada
        -- seguinte à última em que apareceu: soma um. Senão, recomeça.
        v_rodadas := case when e.ultima_rodada is not distinct from v_rodada_dt then e.rodadas_seguidas
                          when e.ultima_rodada is not distinct from v_rodada_ant then e.rodadas_seguidas + 1
                          else 1 end;
        v_motivos := '{}'::text[];
        if e.status = 'aprovado' then
          if (x ->> 'regra', x ->> 'eixo', x ->> 'forca', coalesce(nullif(x ->> 'molde', ''), x ->> 'regra'),
              nullif(x ->> 'anel', ''), nullif(x ->> 'localidade', ''))
             is distinct from (e.regra, e.eixo, e.forca, e.molde, e.anel, e.localidade) then
            v_motivos := v_motivos || array['mudou_a_regra_a_forca_o_molde_o_anel_ou_a_localidade'];
          end if;
          if app.mercado_texto_molde(x ->> 'texto') is distinct from app.mercado_texto_molde(coalesce(e.aprovado_texto, e.texto)) then
            v_motivos := v_motivos || array['texto_mudou'];
          end if;
          if not app.mercado_numeros_perto(v_numeros, e.ultima_versao_numeros, v_rodada) then
            v_motivos := v_motivos || array['numero_mudou_mais_de_' || round(v_rodada * 100) || '%'];
          end if;
          if not app.mercado_numeros_perto(v_numeros, e.aprovado_numeros, v_acum) then
            v_motivos := v_motivos || array['numero_mudou_mais_de_' || round(v_acum * 100) || '%_desde_a_aprovacao'];
          end if;
          if exists (select 1 from unnest(v_marcas) m
                      where m = any (v_bloqueia) and not (m = any (coalesce(e.aprovado_marcas, '{}')))) then
            v_motivos := v_motivos || array['marca_nova'];
          end if;
          if v_ficha is distinct from e.ficha_hash then
            v_motivos := v_motivos || array['ficha_do_imovel_mudou'];
          end if;
          -- Rodada nova: precisa ter passado no motor também na anterior.
          if v_rodada_dt is distinct from e.ultima_rodada and v_rodadas < 2 then
            v_motivos := v_motivos || array['nao_passou_na_rodada_anterior'];
          end if;
          if not v_em_dia then
            v_motivos := v_motivos || array['amostra_semanal_sem_conferencia'];
          end if;
          if exists (select 1 from jsonb_array_elements_text(
                       case when jsonb_typeof(x -> 'fontes') = 'array' then x -> 'fontes' else '[]'::jsonb end) f
                      where f = any (v_quar)) then
            v_motivos := v_motivos || array['fonte_em_quarentena'];
          end if;
        end if;

        update public.mercado_argumentos a
           set regra = x ->> 'regra', eixo = x ->> 'eixo', forca = x ->> 'forca',
               molde = coalesce(nullif(x ->> 'molde', ''), x ->> 'regra'),
               anel = nullif(x ->> 'anel', ''), localidade = nullif(x ->> 'localidade', ''),
               regiao_id = (select r.id from public.mercado_regioes r where r.id = nullif(x ->> 'regiao_id', '')),
               sub = nullif(x ->> 'sub', ''), texto = btrim(x ->> 'texto'), fonte_texto = btrim(x ->> 'fonte_texto'),
               numeros = v_numeros,
               prova = coalesce(case when jsonb_typeof(x -> 'prova') = 'object' then x -> 'prova' end, '{}'::jsonb),
               fontes = coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(x -> 'fontes') = 'array'
                                                                          then x -> 'fontes' else '[]'::jsonb end)), '{}'),
               data_dado = (x ->> 'data_dado')::date, coletado_em = v_coletado, valido_ate = v_valido,
               momentos = coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(x -> 'momentos') = 'array'
                                                                            then x -> 'momentos' else '[]'::jsonb end)), '{}'),
               objecoes = coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(x -> 'objecoes') = 'array'
                                                                            then x -> 'objecoes' else '[]'::jsonb end)), '{}'),
               explica_preco = coalesce((x ->> 'explica_preco')::boolean, false),
               so_com_preco_dito = coalesce((x ->> 'so_com_preco_dito')::boolean, false),
               aviso = nullif(x ->> 'aviso', ''), marcas = v_marcas, hash_dados = x ->> 'hash_dados',
               motor_versao = left(btrim(p_motor_versao), 80), regras_versao = v_regras, ficha_hash = v_ficha,
               rodadas_seguidas = v_rodadas, ultima_rodada = v_rodada_dt, ultima_execucao_id = v_exec,
               atualizado_em = now(),
               status = case
                          when e.status = 'aprovado' and cardinality(v_motivos) = 0 then 'aprovado'
                          when e.status = 'aprovado' then 'proposto'
                          when e.status = 'recusado'
                               and coalesce(nullif(x ->> 'molde', ''), x ->> 'regra') = e.molde
                               and app.mercado_numeros_perto(v_numeros, coalesce(e.recusado_numeros, e.numeros), v_rodada)
                            then 'recusado'
                          else 'proposto' end,
               motivo_status = case
                                 when e.status = 'aprovado' and cardinality(v_motivos) > 0
                                   then left('renovacao_negada: ' || array_to_string(v_motivos, ', '), 500)
                                 when e.status = 'aprovado' then e.motivo_status
                                 when e.status = 'recusado' then e.motivo_status
                                 else null end,
               ultima_versao_numeros = case when e.status = 'aprovado' and cardinality(v_motivos) = 0
                                            then v_numeros else e.ultima_versao_numeros end,
               ultima_versao_em = case when e.status = 'aprovado' and cardinality(v_motivos) = 0
                                         and v_numeros is distinct from e.ultima_versao_numeros
                                       then now() else e.ultima_versao_em end,
               renovacoes = e.renovacoes + case when e.status = 'aprovado' and cardinality(v_motivos) = 0
                                                 and (v_numeros is distinct from e.numeros
                                                      or btrim(x ->> 'texto') is distinct from e.texto)
                                                then 1 else 0 end,
               renovado_em = case when e.status = 'aprovado' and cardinality(v_motivos) = 0 then now() else e.renovado_em end
         where a.id = e.id
        returning to_jsonb(a.*) into v_row;

        if e.status = 'aprovado' and cardinality(v_motivos) = 0 then
          if (v_row -> 'numeros') is distinct from e.numeros or (v_row ->> 'texto') is distinct from e.texto then
            insert into public.mercado_argumento_eventos (argumento_id, evento, status_antes, status_depois,
                                                           numeros_antes, numeros_depois, texto, prova, hash_dados, motivo)
            values (e.id, 'renovado', 'aprovado', 'aprovado', e.numeros, (v_row -> 'numeros'), v_row ->> 'texto',
                    (v_row -> 'prova'), v_row ->> 'hash_dados', 'renovação automática');
          end if;
          v_renovados := v_renovados + 1;
        elsif e.status = 'aprovado' then
          insert into public.mercado_argumento_eventos (argumento_id, evento, status_antes, status_depois,
                                                         numeros_antes, numeros_depois, texto, hash_dados, motivo)
          values (e.id, 'voltou_para_aprovacao', 'aprovado', 'proposto', e.numeros, (v_row -> 'numeros'),
                  v_row ->> 'texto', v_row ->> 'hash_dados', array_to_string(v_motivos, ', '));
          v_voltaram := v_voltaram + 1;
        elsif e.status in ('vencido') or (e.status = 'recusado' and (v_row ->> 'status') = 'proposto') then
          insert into public.mercado_argumento_eventos (argumento_id, evento, status_antes, status_depois,
                                                         numeros_antes, numeros_depois, texto, hash_dados, motivo)
          values (e.id, 'reaberto', e.status, 'proposto', e.numeros, (v_row -> 'numeros'), v_row ->> 'texto',
                  v_row ->> 'hash_dados', 'voltou no motor');
          v_atualizados := v_atualizados + 1;
        elsif e.status = 'proposto'
              and ((v_row -> 'numeros') is distinct from e.numeros or (v_row ->> 'texto') is distinct from e.texto) then
          insert into public.mercado_argumento_eventos (argumento_id, evento, status_antes, status_depois,
                                                         numeros_antes, numeros_depois, texto, hash_dados)
          values (e.id, 'atualizado', 'proposto', 'proposto', e.numeros, (v_row -> 'numeros'), v_row ->> 'texto',
                  v_row ->> 'hash_dados');
          v_atualizados := v_atualizados + 1;
        end if;
      end if;
      v_chaves := v_chaves || btrim(x ->> 'chave');
      v_n := v_n + 1;
    exception when others then
      v_recusados := v_recusados || jsonb_build_object('chave', x ->> 'chave', 'erro', sqlerrm);
    end;
  end loop;

  -- A que sumiu do motor vence na hora (a recusada fica recusada).
  with saiu as (
    update public.mercado_argumentos a
       set status = 'vencido', motivo_status = 'saiu_do_motor', atualizado_em = now()
     where a.imovel_codigo = p_imovel and a.status in ('proposto', 'aprovado')
       and not (a.chave = any (v_chaves))
    returning a.id, a.numeros, a.texto, a.hash_dados
  ),
  ev as (
    insert into public.mercado_argumento_eventos (argumento_id, evento, status_antes, status_depois,
                                                   numeros_antes, texto, hash_dados, motivo)
    select s.id, 'vencido', null, 'vencido', s.numeros, s.texto, s.hash_dados, 'saiu_do_motor' from saiu s
    returning 1
  )
  select count(*) into v_vencidos from ev;

  update public.mercado_motor_execucoes set n_argumentos = v_n where id = v_exec;

  return jsonb_build_object('ok', true, 'execucao', v_exec, 'rodada', v_rodada_dt, 'novos', v_novos,
                            'renovados', v_renovados, 'voltaram_para_aprovacao', v_voltaram,
                            'atualizados', v_atualizados, 'vencidos', v_vencidos, 'recusados', v_recusados,
                            'nao_use_recusados', v_nao_use_fora);
end $$;
comment on function public.mercado_argumentos_propor(text, jsonb, text, text[]) is
  'O motor entrega a lista completa de vantagens de um imóvel nesta rodada: nova nasce proposta; aprovada renova sozinha (números até 10% da última versão e 20% da aprovada, pela régua; texto aprovado só com os números trocados; duas rodadas de coleta seguidas; sem marca nova, ficha igual, amostra em dia, sem fonte em quarentena) ou volta para aprovação; a que sumiu vence. Texto, fonte citada, aviso, anel, localidade e "não use" com nome de fonte de anúncio não entram. Só o worker.';
revoke all on function public.mercado_argumentos_propor(text, jsonb, text, text[]) from public, anon, authenticated;
grant execute on function public.mercado_argumentos_propor(text, jsonb, text, text[]) to service_role;

-- =====================================================================
-- 4. A gestão decide (admin e gestor), por vantagem ou por imóvel
-- =====================================================================
create or replace function public.mercado_argumento_decidir(
  p_id uuid, p_decisao text, p_motivo text default null, p_confirmo_conferido boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.mercado_argumentos;
begin
  if not app.admin_ou_gestor() then
    raise exception 'Só admin e gestor aprovam vantagem de mercado.' using errcode = '42501';
  end if;
  select * into e from public.mercado_argumentos where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'vantagem_desconhecida');
  end if;

  if p_decisao = 'aprovar' then
    if e.status <> 'proposto' then
      return jsonb_build_object('ok', false, 'motivo', 'so_proposta_se_aprova', 'status', e.status);
    end if;
    if e.valido_ate < app.mercado_hoje() then
      return jsonb_build_object('ok', false, 'motivo', 'vencida');
    end if;
    if e.ficha_hash is distinct from app.mercado_ficha_hash(e.imovel_codigo) then
      return jsonb_build_object('ok', false, 'motivo', 'ficha_do_imovel_mudou');
    end if;
    if e.marcas && array['contestado', 'quarentena', 'possivel_mesmo_imovel']::text[] then
      return jsonb_build_object('ok', false, 'motivo', 'marca_bloqueia', 'marcas', to_jsonb(e.marcas));
    end if;
    if (e.eixo = 'preco' or e.explica_preco) and app.mercado_preco_bloqueado(e.imovel_codigo) then
      return jsonb_build_object('ok', false, 'motivo', 'preco_bloqueado_par_sem_decisao');
    end if;
    if 'conferir' = any (e.marcas) and not coalesce(p_confirmo_conferido, false) then
      return jsonb_build_object('ok', false, 'motivo', 'precisa_confirmar_que_conferiu');
    end if;
    update public.mercado_argumentos
       set status = 'aprovado', motivo_status = null, aprovado_por = auth.uid(), aprovado_em = now(),
           aprovado_numeros = e.numeros, aprovado_texto = e.texto, aprovado_marcas = e.marcas,
           ultima_versao_numeros = e.numeros, ultima_versao_em = now(), atualizado_em = now()
     where id = e.id;
    insert into public.mercado_argumento_eventos (argumento_id, evento, status_antes, status_depois, numeros_depois,
                                                   texto, prova, hash_dados, motivo, por)
    values (e.id, 'aprovado', e.status, 'aprovado', e.numeros, e.texto, e.prova, e.hash_dados,
            left(nullif(btrim(p_motivo), ''), 500), auth.uid());
    return jsonb_build_object('ok', true, 'status', 'aprovado');

  elsif p_decisao = 'recusar' then
    if e.status not in ('proposto', 'aprovado') then
      return jsonb_build_object('ok', false, 'motivo', 'nada_a_recusar', 'status', e.status);
    end if;
    update public.mercado_argumentos
       set status = 'recusado', motivo_status = left(nullif(btrim(p_motivo), ''), 500),
           recusado_por = auth.uid(), recusado_em = now(), recusado_numeros = e.numeros, atualizado_em = now()
     where id = e.id;
    insert into public.mercado_argumento_eventos (argumento_id, evento, status_antes, status_depois, numeros_antes,
                                                   texto, hash_dados, motivo, por)
    values (e.id, 'recusado', e.status, 'recusado', e.numeros, e.texto, e.hash_dados,
            left(nullif(btrim(p_motivo), ''), 500), auth.uid());
    return jsonb_build_object('ok', true, 'status', 'recusado');

  elsif p_decisao = 'voltar' then
    if e.status not in ('aprovado', 'recusado') then
      return jsonb_build_object('ok', false, 'motivo', 'nada_a_voltar', 'status', e.status);
    end if;
    update public.mercado_argumentos
       set status = 'proposto', motivo_status = coalesce(left(nullif(btrim(p_motivo), ''), 500), 'devolvida pela gestão'),
           atualizado_em = now()
     where id = e.id;
    insert into public.mercado_argumento_eventos (argumento_id, evento, status_antes, status_depois, numeros_antes,
                                                   texto, hash_dados, motivo, por)
    values (e.id, 'voltou_para_aprovacao', e.status, 'proposto', e.numeros, e.texto, e.hash_dados,
            coalesce(left(nullif(btrim(p_motivo), ''), 500), 'devolvida pela gestão'), auth.uid());
    return jsonb_build_object('ok', true, 'status', 'proposto');
  end if;
  return jsonb_build_object('ok', false, 'motivo', 'decisao_invalida');
end $$;
comment on function public.mercado_argumento_decidir(uuid, text, text, boolean) is
  'Admin e gestor aprovam (só proposta válida, ficha igual, sem contestado, quarentena ou possível mesmo imóvel, preço sem par pendente; "conferir" só confirmando), recusam ou devolvem uma vantagem de mercado. Cada decisão vai para o histórico.';
revoke all on function public.mercado_argumento_decidir(uuid, text, text, boolean) from public, anon;
grant execute on function public.mercado_argumento_decidir(uuid, text, text, boolean) to authenticated;

-- Aprovar por imóvel (a decisão de 18/11): todas as propostas do imóvel, ou só as escolhidas.
create or replace function public.mercado_argumentos_aprovar_imovel(
  p_imovel text, p_ids uuid[] default null, p_confirmo_conferido boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g        record;
  v_r      jsonb;
  v_ok     int := 0;
  v_nao    jsonb := '[]'::jsonb;
begin
  if not app.admin_ou_gestor() then
    raise exception 'Só admin e gestor aprovam vantagem de mercado.' using errcode = '42501';
  end if;
  for g in
    select a.id, a.chave from public.mercado_argumentos a
     where a.imovel_codigo = p_imovel and a.status = 'proposto'
       and (p_ids is null or a.id = any (p_ids))
     order by a.forca, a.chave
  loop
    v_r := public.mercado_argumento_decidir(g.id, 'aprovar', 'aprovação do imóvel', p_confirmo_conferido);
    if coalesce((v_r ->> 'ok')::boolean, false) then
      v_ok := v_ok + 1;
    else
      v_nao := v_nao || jsonb_build_object('id', g.id, 'chave', g.chave, 'motivo', v_r ->> 'motivo');
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'aprovadas', v_ok, 'nao_aprovadas', v_nao);
end $$;
comment on function public.mercado_argumentos_aprovar_imovel(text, uuid[], boolean) is
  'Admin e gestor aprovam de uma vez as vantagens propostas de um imóvel (todas ou as escolhidas); as que uma trava segura voltam com o motivo.';
revoke all on function public.mercado_argumentos_aprovar_imovel(text, uuid[], boolean) from public, anon;
grant execute on function public.mercado_argumentos_aprovar_imovel(text, uuid[], boolean) to authenticated;

-- =====================================================================
-- 5. Suspender, vencer e a rotina do dia
-- =====================================================================
-- A equipe marcou errado um anúncio ou fato da prova: as vantagens que o usam
-- saem da IA na hora (aprovada volta para aprovação) e ganham a marca contestado.
create or replace function app.mercado_argumentos_suspender(p_anuncio uuid, p_item text, p_motivo text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  with alvo as (
    select a.* from public.mercado_argumentos a
     where a.status in ('proposto', 'aprovado')
       and ((p_anuncio is not null and a.prova @> jsonb_build_object('anuncios', jsonb_build_array(p_anuncio::text)))
         or (p_item is not null and a.prova @> jsonb_build_object('itens', jsonb_build_array(p_item))))
     for update
  ),
  mudou as (
    update public.mercado_argumentos a
       set status = 'proposto',
           marcas = array(select distinct m from unnest(a.marcas || array['contestado']) m order by m),
           motivo_status = left(coalesce(p_motivo, 'contestado'), 500), atualizado_em = now()
      from alvo
     where a.id = alvo.id
    returning a.id, alvo.status as antes, a.numeros, a.texto, a.hash_dados
  ),
  ev as (
    insert into public.mercado_argumento_eventos (argumento_id, evento, status_antes, status_depois,
                                                   numeros_antes, texto, hash_dados, motivo)
    select m.id, 'suspenso', m.antes, 'proposto', m.numeros, m.texto, m.hash_dados, left(coalesce(p_motivo, 'contestado'), 500)
      from mudou m
    returning 1
  )
  select count(*) into v_n from ev;
  return v_n;
end $$;
comment on function app.mercado_argumentos_suspender(uuid, text, text) is
  'Tira da IA (aprovada volta para aprovação, com a marca contestado) toda vantagem cuja prova usa o anúncio ou o fato marcado errado.';
revoke all on function app.mercado_argumentos_suspender(uuid, text, text) from public, anon, authenticated;
grant execute on function app.mercado_argumentos_suspender(uuid, text, text) to service_role;

create or replace function app.mercado_argumentos_vencer()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  with venceu as (
    update public.mercado_argumentos a
       set status = 'vencido', motivo_status = 'validade_passou', atualizado_em = now()
     where a.status in ('proposto', 'aprovado') and a.valido_ate < app.mercado_hoje()
    returning a.id, a.numeros, a.texto, a.hash_dados
  ),
  ev as (
    insert into public.mercado_argumento_eventos (argumento_id, evento, status_antes, status_depois,
                                                   numeros_antes, texto, hash_dados, motivo)
    select v.id, 'vencido', null, 'vencido', v.numeros, v.texto, v.hash_dados, 'validade_passou' from venceu v
    returning 1
  )
  select count(*) into v_n from ev;
  return v_n;
end $$;
comment on function app.mercado_argumentos_vencer() is 'Vence as vantagens propostas ou aprovadas que passaram da validade.';
revoke all on function app.mercado_argumentos_vencer() from public, anon, authenticated;
grant execute on function app.mercado_argumentos_vencer() to service_role;

create or replace function app.mercado_rotina_diaria()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_verif jsonb;
  v_venc  int;
begin
  if not app.mercado_ligado() then
    return jsonb_build_object('ok', false, 'motivo', 'desligado');
  end if;
  v_verif := app.mercado_verificar();
  v_venc := app.mercado_argumentos_vencer();
  return jsonb_build_object('ok', true, 'veracidade', v_verif, 'vantagens_vencidas', v_venc);
end $$;
comment on function app.mercado_rotina_diaria() is
  'Uma vez por dia: refaz a veracidade (anúncio não visto há 8 dias vence) e vence as vantagens fora da validade. Com a chave desligada, nada.';
revoke all on function app.mercado_rotina_diaria() from public, anon, authenticated;
grant execute on function app.mercado_rotina_diaria() to service_role;

-- =====================================================================
-- 6. O que a IA lê
-- =====================================================================
-- As vantagens de um imóvel que podem ir ao cliente agora: chave ligada,
-- aprovada, dentro da validade, ficha igual, sem marca que bloqueia, preço só
-- sem par pendente. Ordem: força, depois eixo (a ordem do pedido do dono,
-- começando pelo preço), depois a chave. Sem prova, sem link e sem fonte.
create or replace function app.mercado_vantagens_do_imovel(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.chave, 'eixo', a.eixo, 'forca', a.forca, 'texto', a.texto, 'fonte', a.fonte_texto,
           'data_dado', a.data_dado, 'valido_ate', a.valido_ate, 'momentos', to_jsonb(a.momentos),
           'objecoes', to_jsonb(a.objecoes), 'explica_preco', a.explica_preco,
           'so_com_preco_dito', a.so_com_preco_dito)
         order by a.forca,
                  array_position(array['preco', 'atributo', 'raridade', 'tamanho', 'documentacao', 'proximidade',
                                       'regiao', 'obra', 'procura', 'serie']::text[], a.eixo),
                  a.chave), '[]'::jsonb)
    from public.mercado_argumentos a
   where app.mercado_ligado()
     and a.imovel_codigo = p_codigo
     and a.status = 'aprovado'
     and a.valido_ate >= app.mercado_hoje()
     and a.ficha_hash is not distinct from app.mercado_ficha_hash(p_codigo)
     and not (a.marcas && array['contestado', 'quarentena', 'possivel_mesmo_imovel']::text[])
     and not ((a.eixo = 'preco' or a.explica_preco) and app.mercado_preco_bloqueado(p_codigo))
     -- De novo na leitura: nada com palavra proibida ou nome de fonte de anúncio.
     and not app.mercado_texto_proibido(a.texto)
     and not app.mercado_texto_proibido(a.fonte_texto)
$$;
comment on function app.mercado_vantagens_do_imovel(text) is
  'As vantagens de mercado de um imóvel que a IA pode usar agora (aprovadas, válidas, ficha igual, sem marca que bloqueia), em ordem de força e eixo. Sem prova, sem link e sem nome de fonte de anúncio.';
revoke all on function app.mercado_vantagens_do_imovel(text) from public, anon, authenticated;
grant execute on function app.mercado_vantagens_do_imovel(text) to service_role;

-- Todos os imóveis da carteira de uma vez: {"TE0001": {"diferenciais": [...],
-- "nao_use": [...], "dados_de": "2026-11-19"}}. Imóvel sem vantagem não entra
-- (a IA segue a conversa normal). Desligada, {}.
create or replace function app.mercado_vantagens_para_ia()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.codigo, x.bloco), '{}'::jsonb)
    from (
      select k.codigo,
             jsonb_build_object(
               'diferenciais', app.mercado_vantagens_do_imovel(k.codigo),
               'nao_use', coalesce((select jsonb_agg(u.t order by u.o)
                                      from (select m.nao_use from public.mercado_motor_execucoes m
                                             where m.imovel_codigo = k.codigo order by m.id desc limit 1) ult
                                      cross join lateral unnest(ult.nao_use) with ordinality as u(t, o)
                                     where not app.mercado_nomeia_fonte(u.t)), '[]'::jsonb),
               'dados_de', (select max(a.data_dado) from public.mercado_argumentos a
                             where a.imovel_codigo = k.codigo and a.status = 'aprovado')) as bloco
        from (select distinct c.codigo from app.mercado_carteira() c) k
       where app.mercado_ligado()
    ) x
   where jsonb_array_length(x.bloco -> 'diferenciais') > 0
$$;
comment on function app.mercado_vantagens_para_ia() is
  'As vantagens de mercado que a IA recebe, por código de imóvel ({"diferenciais", "nao_use", "dados_de"}). Só com a chave ligada; imóvel sem vantagem válida não entra. Na KOMUNE, sempre vazio.';
revoke all on function app.mercado_vantagens_para_ia() from public, anon, authenticated;
grant execute on function app.mercado_vantagens_para_ia() to service_role;

-- A tela "Para a IA" mostra exatamente o que a IA recebe hoje.
create or replace function public.mercado_vantagens_para_ia()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_manager() then
    raise exception 'Só admin, gestor e SDR veem o que a IA recebe do mercado.' using errcode = '42501';
  end if;
  return app.mercado_vantagens_para_ia();
end $$;
comment on function public.mercado_vantagens_para_ia() is
  'O que a IA recebe hoje do mercado, para a tela (admin, gestor e SDR).';
revoke all on function public.mercado_vantagens_para_ia() from public, anon;
grant execute on function public.mercado_vantagens_para_ia() to authenticated;

  $ddl$;

  -- Todo dia às 3h15 em Fortaleza (6h15 UTC).
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mercado_rotina_diaria', '15 6 * * *',
                          $cron$select app.mercado_rotina_diaria()$cron$);
  end if;
end $vantagens$;

notify pgrst, 'reload schema';

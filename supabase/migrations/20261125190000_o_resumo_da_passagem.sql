-- =====================================================================
-- O resumo da passagem: quando a IA que atende passa a conversa para a
-- equipe, o corretor recebe o cliente resumido — só na Imova (11/11/2026)
--
-- Pedido do usuário: "deixar um resumo para o corretor não precisar ler a
-- conversa inteira". Até aqui `public.ia_atendente_passar` (e o
-- `passarParaGente` do worker, quando dá erro) gravava só um motivo de uma
-- frase. Agora, logo depois de cada passagem, o worker de IA escreve:
--
--   * o que o cliente procura: comprar ou alugar, o tipo, a região e os
--     imóveis de interesse (com o código, só os da Imova que a conversa cita);
--   * o orçamento (com os números dele) e a forma de pagamento;
--   * a objeção principal (uma das 7 do catálogo da Imova, `public.objecoes`);
--   * a temperatura: frio, morno ou quente — os três primeiros valores de
--     `app.temperature`, a escala do CRM (PRD §5.6). Não é escala nova;
--   * por que passou e o próximo passo sugerido para o corretor.
--
-- SÓ O QUE A CONVERSA DIZ, E A PROVA PROVA O CONTEÚDO (revisão de 11/11/2026).
-- O que o cliente não disse fica vazio ("não disse"). Cada campo dito chega
-- com a mensagem DO CLIENTE e o TRECHO literal dela, e este banco confere de
-- novo (ADR-03): o trecho está na mensagem (sem acento, em minúsculas, sem
-- pontuação, palavra inteira); os números do valor estão no trecho, e uma
-- palavra de conteúdo dele também; comprar, alugar e a forma de pagamento
-- estão escritos no trecho. O código do imóvel é palavra inteira na mensagem,
-- existe nos imóveis da Imova (`app.ia_atendente_imoveis`) e, quando quem o
-- escreveu foi a IA, o cliente falou dele DEPOIS ("gostei desse"); o que só a
-- IA ofereceu e o cliente ignorou não entra. A temperatura é leitura, não
-- fato: nula quando a conversa não dá para julgar.
--
-- QUEM PEDE É O BANCO. Um gatilho em `ia_respostas`, na linha da passagem
-- (`passou_para_pessoa` com o aviso; ou `nao_respondeu` que queria passar),
-- abre a linha do resumo (`pedido`, com o retrato de se a conversa era do
-- treino ou de teste NAQUELA hora) e põe `resumir_passagem` na fila `ai_jobs`.
-- Com o resumo desligado, a linha nasce `falhou`/`desligado` e nada entra na
-- fila. O gatilho engole o próprio erro: a passagem não muda nem espera.
-- `public.ia_atendente_passar` passa a gravar também a linha da passagem que
-- não tinha uma (o teto por hora e o texto vazio ou longo demais entregavam a
-- conversa sem linha nenhuma em `ia_respostas`).
--
-- A TELA (`public.ia_passagens_da_conversa`) diz de cada passagem: pronto,
-- escrevendo (pedido há menos de 15 min), não chegou (pedido mais velho, ou
-- linha que não nasceu), falhou (com o motivo) ou "antes" (de antes desta
-- migração, `app.ia_resumo_desde`). O DESTAQUE no topo é a última passagem
-- de verdade (não simulada, pelo retrato da hora), só enquanto a parada da IA
-- for DELA (`ia_atendimento.mudou_por` nulo e `mudou_em` = a hora da
-- passagem), ninguém da equipe tiver escrito depois e a conversa não tiver
-- sido concluída depois.
--
-- O QUE ENTRA:
--   1. `public.ia_resumos_da_passagem` (RLS: admin, gestor e SDR leem;
--      ninguém escreve direto; auditoria por `app.audit`).
--   2. `app.ia_resumo_config()`: `app_settings['ia.resumo_da_passagem']`,
--      ligado por padrão; `{"ligado": false}` desliga sem deploy.
--   3. As conferências (`app.ia_resumo_norm`, `_numeros`, `_palavras`,
--      `_valor_bate`, `_trecho_na`, `_tem_codigo`, `_enum_no_trecho`,
--      `_dito`, `_imoveis_citados`), espelho de `conferirResumoDaPassagem`.
--   4. O gatilho `ia_respostas_pede_resumo` e `public.ia_atendente_passar`.
--   5. As portas do worker (service_role): `_entrada`, `_gravar`, `_falhou`,
--      e `public.ia_resumos_reenfileirar` (o worker antigo queimou a chave).
--   6. O aviso: a tarefa "A IA passou o cliente para você" ganha o resumo em
--      uma linha no título, enquanto aberta (nunca no treino nem no teste).
--   7. A tela: `public.ia_passagens_da_conversa`.
--
-- ORDEM DE PUBLICAÇÃO: o worker de IA primeiro, depois esta migração, depois o
-- site (`docs/operacao/resumo-da-passagem.md`). Worker antigo trata
-- `resumir_passagem` como propósito desconhecido e queima a chave;
-- `public.ia_resumos_reenfileirar(48)` põe de novo, com chave nova.
--
-- O WHATSAPP NÃO É TOCADO: nada aqui grava em `messages` nem nas filas de envio.
-- O custo vai para `ai_runs` com o propósito `summarize_deal` (o prompt é
-- `resumo-da-passagem@v1`, no Haiku 5.5).
--
-- Na KOMUNE não faz nada: a IA que atende não existe lá.
--
-- COMO DESFAZER (no banco da Imova):
--   drop trigger if exists ia_respostas_pede_resumo on public.ia_respostas;
--   reaplicar public.ia_atendente_passar da 20261110150000;
--   drop das funções novas (todas `app.ia_resumo_*`, `public.ia_resumo_da_passagem_*`,
--   `public.ia_resumos_reenfileirar`, `public.ia_passagens_da_conversa`);
--   drop table if exists public.ia_resumos_da_passagem;
--   As tarefas que ganharam o resumo no título ficam como estão.
-- =====================================================================

do $resumo$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O resumo da passagem é da IA que atende, só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  -- Quando o resumo passou a existir neste banco: a passagem de antes é "antes
  -- do resumo"; a de depois sem linha é "não chegou". Gravado uma vez só.
  if to_regprocedure('app.ia_resumo_desde()') is null then
    execute format($f$
      create function app.ia_resumo_desde() returns timestamptz
      language sql immutable set search_path = ''
      as $b$ select %L::timestamptz $b$ $f$, now());
    execute 'revoke all on function app.ia_resumo_desde() from public, anon, authenticated';
  end if;

  execute $ddl$

-- =====================================================================
-- 1. A tabela
-- =====================================================================
create table if not exists public.ia_resumos_da_passagem (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.conversations (id) on delete cascade,
  -- A linha da passagem: `passou_para_pessoa`, ou `nao_respondeu` que queria passar.
  resposta_id         uuid not null unique references public.ia_respostas (id) on delete cascade,
  -- pedido: na fila; pronto: o resumo saiu; falhou: não saiu, e `motivo_sem_resumo` diz por quê.
  situacao            text not null check (situacao in ('pedido', 'pronto', 'falhou')),
  -- O retrato da hora da passagem: a conversa era do treino ou de teste (simulação)?
  simulada            boolean not null default false,
  pedido_em           timestamptz,
  -- O que procura. Nulo = o cliente não disse.
  negocio             text check (negocio in ('compra', 'locacao')),
  tipo                text check (char_length(tipo) between 1 and 80),
  regiao              text check (char_length(regiao) between 1 and 120),
  imoveis             text[] not null default '{}' check (cardinality(imoveis) <= 5),
  -- O orçamento como o cliente disse ("até 600 mil") e a forma de pagamento.
  orcamento           text check (char_length(orcamento) between 1 and 100),
  pagamento           text check (pagamento in ('financiamento', 'a_vista', 'fgts', 'consorcio', 'misto')),
  -- A objeção principal: um dos 7 slugs de `public.objecoes` (seed 12c da Imova).
  objecao             text check (objecao in ('preco', 'localizacao', 'financiamento', 'imovel_nao_atende',
                                              'decide_com_outra_pessoa', 'prazo', 'ja_tem_corretor')),
  objecao_como_disse  text check (char_length(objecao_como_disse) between 1 and 160),
  -- A escala do CRM (`app.temperature`, PRD §5.6), só os três primeiros valores.
  temperatura         app.temperature check (temperatura in ('frio', 'morno', 'quente')),
  temperatura_porque  text check (char_length(temperatura_porque) <= 160),
  porque_passou       text check (char_length(porque_passou) <= 200),
  proximo_passo       text check (char_length(proximo_passo) <= 200),
  -- As provas de cada campo, já conferidas: {"regiao": {"prova": uuid, "trecho": "..."},
  -- ..., "imoveis": {"CODIGO": {"prova": uuid, "confirmacao": uuid|null, "trecho": "..."|null}}}.
  evidencias          jsonb not null default '{}'::jsonb,
  dados_insuficientes boolean not null default false,
  motivo_sem_resumo   text check (char_length(motivo_sem_resumo) <= 200),
  -- A tarefa "A IA passou o cliente para você" que recebeu o resumo no título.
  task_id             uuid references public.tasks (id) on delete set null,
  ai_run_id           bigint references public.ai_runs (id) on delete set null,
  prompt_version      text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  constraint ia_resumos_da_passagem_falhou_diz_por_que check (
    situacao <> 'falhou' or length(btrim(coalesce(motivo_sem_resumo, ''))) > 0)
);
create index if not exists ia_resumos_da_passagem_conversa_idx
  on public.ia_resumos_da_passagem (conversation_id, criado_em desc);
create index if not exists ia_resumos_da_passagem_pedidos_idx
  on public.ia_resumos_da_passagem (pedido_em) where situacao = 'pedido';
alter table public.ia_resumos_da_passagem enable row level security;
drop policy if exists ia_resumos_da_passagem_select on public.ia_resumos_da_passagem;
create policy ia_resumos_da_passagem_select on public.ia_resumos_da_passagem
  for select to authenticated using ((select app.is_manager()));
revoke all on public.ia_resumos_da_passagem from anon;
revoke insert, update, delete, truncate on public.ia_resumos_da_passagem from authenticated;
grant select on public.ia_resumos_da_passagem to authenticated;
grant select, insert, update, delete on public.ia_resumos_da_passagem to service_role;
comment on table public.ia_resumos_da_passagem is
  'O resumo que a IA escreve para o corretor quando a IA que atende passa a conversa para a equipe (Imova, 11/11/2026): o que o cliente procura, o orçamento e o pagamento, a objeção principal, a temperatura (frio, morno ou quente, a escala de app.temperature), por que passou e o próximo passo. Só o que a conversa diz, com a mensagem e o trecho que provam cada campo. Nasce com a passagem (pedido) e é escrita só pelas funções ia_resumo_*.';
drop trigger if exists audit_ia_resumos_da_passagem on public.ia_resumos_da_passagem;
create trigger audit_ia_resumos_da_passagem after insert or update or delete on public.ia_resumos_da_passagem
  for each row execute function app.audit();


-- =====================================================================
-- 2. A configuração
-- =====================================================================
create or replace function app.ia_resumo_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select '{"ligado": true}'::jsonb
         || coalesce((select s.value from public.app_settings s where s.key = 'ia.resumo_da_passagem'), '{}'::jsonb)
$$;
comment on function app.ia_resumo_config() is
  'O resumo da passagem (Imova, 11/11/2026): ligado por padrão; app_settings[''ia.resumo_da_passagem''] = {"ligado": false} desliga sem deploy.';
revoke all on function app.ia_resumo_config() from public, anon, authenticated;


-- =====================================================================
-- 3. As conferências (o espelho de `conferirResumoDaPassagem`, no prompt)
-- =====================================================================
-- Sem acento, em minúsculas, sem pontuação, um espaço entre as palavras.
create or replace function app.ia_resumo_norm(p_texto text)
returns text
language sql
stable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(extensions.unaccent(coalesce(p_texto, ''))), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Os números, sem separador de milhar e sem centavos zerados: "R$ 2.500,00" -> {2500}.
create or replace function app.ia_resumo_numeros(p_texto text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(regexp_replace(replace(m[1], '.', ''), ',0+$', '')), '{}'::text[])
    from regexp_matches(coalesce(p_texto, ''), '(\d+(?:[.,]\d+)*)', 'g') as m
$$;

-- As palavras de conteúdo (3 letras ou mais, sem número, sem as que não dizem nada sozinhas).
create or replace function app.ia_resumo_palavras(p_texto text)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(p), '{}'::text[])
    from unnest(string_to_array(app.ia_resumo_norm(p_texto), ' ')) p
   where length(p) >= 3 and p !~ '^\d+$'
     and p <> all (array['ate', 'uns', 'umas', 'uma', 'com', 'sem', 'para', 'pra', 'por', 'mais', 'menos',
                         'que', 'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'nos', 'nas', 'dos', 'das',
                         'num', 'numa', 'tem', 'ter', 'quero', 'queria', 'gostaria', 'preciso', 'procuro',
                         'algo', 'algum', 'alguma', 'reais', 'real', 'mes', 'ano', 'perto', 'regiao', 'bairro'])
$$;

-- "quarto" e "quartos", "apartamento" e "apartamentos": as cinco primeiras letras bastam.
create or replace function app.ia_resumo_bate_palavra(p_a text[], p_b text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (select 1 from unnest(p_a) a, unnest(p_b) b
                  where a = b or (length(a) >= 5 and length(b) >= 5 and left(a, 5) = left(b, 5)))
$$;

-- O valor (texto livre) bate com o trecho: os números todos, e uma palavra de conteúdo.
create or replace function app.ia_resumo_valor_bate(p_valor text, p_trecho text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.ia_resumo_numeros(p_valor) <@ app.ia_resumo_numeros(p_trecho)
     and case when cardinality(app.ia_resumo_palavras(p_valor)) = 0
              then cardinality(app.ia_resumo_numeros(p_valor)) > 0
              else app.ia_resumo_bate_palavra(app.ia_resumo_palavras(p_valor), app.ia_resumo_palavras(p_trecho))
         end
$$;

-- O trecho está no texto, palavra inteira, sem acento nem pontuação.
create or replace function app.ia_resumo_trecho_na(p_texto text, p_trecho text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select length(app.ia_resumo_norm(p_trecho)) >= 3
     and position(' ' || app.ia_resumo_norm(p_trecho) || ' ' in ' ' || app.ia_resumo_norm(p_texto) || ' ') > 0
$$;

-- O código como palavra inteira: "AP003" não está em "AP0031_IMOVA", nem "CASA" em "casarão".
-- 25/11/2026: o código da Imova também vale sem o "_IMOVA" do fim ("Vi o TE0004 no ZAP"),
-- como o cliente costuma escrever; o resto continua palavra inteira.
create or replace function app.ia_resumo_tem_codigo(p_texto text, p_codigo text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_codigo ~ '^[A-Z0-9][A-Z0-9_.-]{1,39}$'
                  and (upper(coalesce(p_texto, '')) ~ ('(^|[^A-Z0-9_])' || replace(p_codigo, '.', '\.')
                                                       || '($|[^A-Z0-9_])')
                       or (p_codigo ~ '_IMOVA$'
                           and upper(coalesce(p_texto, '')) ~ ('(^|[^A-Z0-9_])'
                                                               || replace(regexp_replace(p_codigo, '_IMOVA$', ''), '.', '\.')
                                                               || '($|[^A-Z0-9_])'))), false)
$$;

-- O imóvel de interesse que a IA já registrou na conversa (`interesse_no_imovel`, o mesmo
-- que os relatórios e a retomada leem), em palavras: "terreno em Praia de Tabatinga
-- (TE0004_IMOVA)". O cartão mostra quando o cliente não escreveu código nenhum (a IA da
-- Imova não escreve código desde a v6), com "lido pela IA" ao lado. Até 3.
create or replace function app.ia_resumo_interesse(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if to_regclass('public.interesse_no_imovel') is null then
    return '[]'::jsonb;
  end if;
  execute $q$
    with i as (
      select x.codigo, case x.nivel when 'muito' then 0 when 'interessado' then 1 else 2 end as g,
             x.atualizado_em
        from public.interesse_no_imovel x
       where x.conversation_id = $1
    ), cat as (
      select upper(e ->> 'codigo') as codigo, e ->> 'tipo' as tipo, e ->> 'bairro' as bairro
        from jsonb_array_elements(app.ia_atendente_imoveis()) e
    )
    select coalesce(jsonb_agg(t.frase order by t.g, t.atualizado_em desc), '[]'::jsonb)
      from (select i.g, i.atualizado_em,
                   concat_ws(' ', coalesce(nullif(replace(lower(c.tipo), '_', ' '), ''), 'imóvel'),
                             'em ' || nullif(btrim(c.bairro), ''))
                     || ' (' || i.codigo || ')' as frase
              from i left join cat c on c.codigo = upper(i.codigo)
             order by i.g, i.atualizado_em desc
             limit 3) t
  $q$ into v using p_conversation_id;
  return coalesce(v, '[]'::jsonb);
exception when others then
  return '[]'::jsonb;
end $$;
revoke all on function app.ia_resumo_interesse(uuid) from public, anon, authenticated;

-- Comprar ou alugar, e cada forma de pagamento, escritos no trecho ("misto": duas formas).
create or replace function app.ia_resumo_enum_no_trecho(p_campo text, p_valor text, p_trecho text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  t    text := app.ia_resumo_norm(p_trecho);
  fin  boolean := t ~ '(^| )financ';
  vis  boolean := t ~ '(^| )a ?vista( |$)';
  fgt  boolean := t ~ '(^| )fgts( |$)';
  con  boolean := t ~ '(^| )consorc';
begin
  if p_campo = 'negocio' then
    return case p_valor when 'compra' then t ~ '(^| )compr'
                        when 'locacao' then t ~ '(^| )(alug|locac|locar)'
                        else false end;
  end if;
  return case p_valor when 'financiamento' then fin when 'a_vista' then vis when 'fgts' then fgt
                      when 'consorcio' then con
                      when 'misto' then (fin::int + vis::int + fgt::int + con::int) >= 2
                      else false end;
end $$;

-- Um campo dito pelo cliente, conferido: a mensagem é DELE, nesta conversa, até
-- a passagem; o trecho está nela; e o valor bate com o trecho. Devolve
-- {valor, trecho, prova} ou nulo.
create or replace function app.ia_resumo_dito(p_conversation_id uuid, p_ate timestamptz, p_item jsonb, p_campo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_valor  text;
  v_trecho text;
  m        public.messages%rowtype;
begin
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    return null;
  end if;
  v_valor := nullif(btrim(coalesce(p_item ->> 'valor', '')), '');
  v_trecho := left(nullif(btrim(coalesce(p_item ->> 'trecho', '')), ''), 200);
  if v_valor is null or v_trecho is null then
    return null;
  end if;
  select * into m from public.messages x
   where x.id = app.uuid_seguro(p_item ->> 'prova')
     and x.conversation_id = p_conversation_id
     and x.created_at <= p_ate
     and x.direction = 'in'::app.msg_direction;
  if not found or not app.ia_resumo_trecho_na(coalesce(m.body, '') || ' ' || coalesce(m.transcript, ''), v_trecho) then
    return null;
  end if;
  if p_campo in ('negocio', 'pagamento') then
    if not app.ia_resumo_enum_no_trecho(p_campo, v_valor, v_trecho) then
      return null;
    end if;
  elsif p_campo <> 'objecao' and not app.ia_resumo_valor_bate(v_valor, v_trecho) then
    return null;
  end if;
  return jsonb_build_object(
    'valor', left(v_valor, case p_campo when 'tipo' then 80 when 'regiao' then 120 when 'orcamento' then 100 else 200 end),
    'trecho', v_trecho,
    'prova', m.id);
end $$;

-- Os imóveis da Imova cujo código está escrito na conversa, até a passagem,
-- com as palavras que os descrevem (tipo, bairro, título).
create or replace function app.ia_resumo_imoveis_citados(p_conversation_id uuid, p_ate timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with catalogo as (
    select distinct on (upper(i ->> 'codigo')) upper(i ->> 'codigo') as codigo,
           (app.ia_resumo_palavras(concat_ws(' ', i ->> 'tipo', i ->> 'bairro', i ->> 'titulo')))[1:12] as palavras
      from jsonb_array_elements(app.ia_atendente_imoveis()) i
     where upper(i ->> 'codigo') ~ '^[A-Z0-9][A-Z0-9_.-]{1,39}$'
  ), textos as (
    select coalesce(m.body, '') || ' ' || coalesce(m.transcript, '') as texto
      from public.messages m
     where m.conversation_id = p_conversation_id and m.created_at <= p_ate
  )
  select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'palavras', to_jsonb(c.palavras))
                            order by c.codigo), '[]'::jsonb)
    from (select k.* from catalogo k
           where exists (select 1 from textos t where app.ia_resumo_tem_codigo(t.texto, k.codigo))
           order by k.codigo limit 20) c
$$;

revoke all on function app.ia_resumo_norm(text) from public, anon, authenticated;
revoke all on function app.ia_resumo_numeros(text) from public, anon, authenticated;
revoke all on function app.ia_resumo_palavras(text) from public, anon, authenticated;
revoke all on function app.ia_resumo_bate_palavra(text[], text[]) from public, anon, authenticated;
revoke all on function app.ia_resumo_valor_bate(text, text) from public, anon, authenticated;
revoke all on function app.ia_resumo_trecho_na(text, text) from public, anon, authenticated;
revoke all on function app.ia_resumo_tem_codigo(text, text) from public, anon, authenticated;
revoke all on function app.ia_resumo_enum_no_trecho(text, text, text) from public, anon, authenticated;
revoke all on function app.ia_resumo_dito(uuid, timestamptz, jsonb, text) from public, anon, authenticated;
revoke all on function app.ia_resumo_imoveis_citados(uuid, timestamptz) from public, anon, authenticated;


-- =====================================================================
-- 4. Quem pede: o gatilho na linha da passagem
-- =====================================================================
-- É passagem a linha `passou_para_pessoa` e a `nao_respondeu` que queria passar
-- (a porteira recusou o aviso, ou o teto ou o texto o seguraram; a conversa
-- foi para gente do mesmo jeito).
create or replace function app.ia_resumo_e_passagem(p_acao text, p_message_id uuid, p_detalhes jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_acao = 'passou_para_pessoa'
      or (p_acao = 'nao_respondeu' and coalesce(p_detalhes ->> 'quis', '') = 'passou_para_pessoa')
$$;
revoke all on function app.ia_resumo_e_passagem(text, uuid, jsonb) from public, anon, authenticated;

-- A conversa é do treino ou de teste agora? (Na hora da passagem, é o retrato que fica.)
create or replace function app.ia_resumo_simulada(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_conversation_id is not distinct from app.ia_conversa_de_treino()
      or app.ia_conversa_de_teste(p_conversation_id)
$$;
revoke all on function app.ia_resumo_simulada(uuid) from public, anon, authenticated;

create or replace function app.ia_resumo_pedir()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_simulada boolean;
begin
  -- A passagem com aviso nasce sem mensagem e ganha a mensagem na mesma
  -- transação: é na segunda escrita que ela vale (se a porteira recusar, a
  -- primeira é desfeita e vem a `nao_respondeu`, que vale no INSERT).
  if not ((new.acao = 'passou_para_pessoa' and new.message_id is not null
           and (tg_op = 'INSERT' or old.message_id is null))
          or (tg_op = 'INSERT' and new.acao = 'nao_respondeu'
              and coalesce(new.detalhes ->> 'quis', '') = 'passou_para_pessoa')) then
    return null;
  end if;
  -- Nada aqui pode atrasar ou derrubar a passagem: erro vira aviso no log.
  begin
    v_simulada := app.ia_resumo_simulada(new.conversation_id);
    if coalesce((app.ia_resumo_config() ->> 'ligado')::boolean, true) then
      insert into public.ia_resumos_da_passagem (conversation_id, resposta_id, situacao, simulada, pedido_em)
      values (new.conversation_id, new.id, 'pedido', v_simulada, now())
      on conflict (resposta_id) do nothing;
      perform app.esteira_enfileirar(
        'ai_jobs',
        jsonb_build_object('purpose', 'resumir_passagem',
                           'chave', new.id::text,
                           'conversation_id', new.conversation_id,
                           'resposta_id', new.id),
        'resumir_passagem:' || new.id::text);
    else
      insert into public.ia_resumos_da_passagem (conversation_id, resposta_id, situacao, simulada, motivo_sem_resumo)
      values (new.conversation_id, new.id, 'falhou', v_simulada, 'desligado')
      on conflict (resposta_id) do nothing;
    end if;
  exception when others then
    raise warning 'ia_resumo_pedir: o resumo da passagem % não foi pedido: %', new.id, sqlerrm;
  end;
  return null;
end $$;
comment on function app.ia_resumo_pedir() is
  'Gatilho de ia_respostas (Imova, 11/11/2026): quando nasce a linha da passagem, abre a linha do resumo (pedido, com o retrato de treino ou teste da hora) e põe resumir_passagem na fila ai_jobs, uma vez por passagem; com o resumo desligado, a linha nasce falhou/desligado. Erro aqui não atrapalha a passagem.';
revoke all on function app.ia_resumo_pedir() from public, anon, authenticated;

drop trigger if exists ia_respostas_pede_resumo on public.ia_respostas;
create trigger ia_respostas_pede_resumo
  after insert or update of message_id on public.ia_respostas
  for each row execute function app.ia_resumo_pedir();

-- Passar para um corretor: a função da 20261110150000, com UMA coisa a mais.
-- Quando o aviso não sai pelo teto por hora ou pelo texto (vazio ou longo
-- demais), a conversa já ia para gente sem linha nenhuma em `ia_respostas`:
-- sem resumo, e o destaque do topo voltava para a passagem anterior. Agora fica
-- a linha `nao_respondeu` que queria passar, como quando a porteira recusa.
create or replace function public.ia_atendente_passar(
  p_conversation_id uuid, p_em_resposta_a uuid, p_texto text, p_motivo text,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_texto  text := coalesce(nullif(btrim(coalesce(p_texto, '')), ''),
                            app.ia_atendente_config() ->> 'aviso_corretor');
  v_disse  jsonb;
  v_para   uuid;
  v_treino boolean := p_conversation_id is not distinct from app.ia_conversa_de_treino();
  v_teste  boolean := app.ia_conversa_de_teste(p_conversation_id);
begin
  v_disse := app.ia_atendente_dizer(p_conversation_id, p_em_resposta_a, v_texto, 'passou_para_pessoa',
                                    jsonb_build_object('motivo', left(coalesce(p_motivo, ''), 300)),
                                    p_ai_run_id, p_prompt_version);
  -- Chegou mensagem nova: a próxima rodada decide de novo (pode ser outra coisa).
  if v_disse ->> 'motivo' in ('chegou_mensagem_nova', 'ja_respondida', 'conversa_nao_existe') then
    return v_disse;
  end if;
  -- No treino e no teste, passar é simulação: o aviso sai, e a IA continua ali.
  if v_treino or v_teste then
    return v_disse || jsonb_build_object('passada_para', null, 'treino', v_treino, 'teste', v_teste);
  end if;
  -- Disse ou não (porteira, teto), a conversa vai para gente.
  if app.ia_atende(p_conversation_id) or coalesce((v_disse ->> 'ok')::boolean, false) then
    -- (11/11/2026) O aviso não saiu e não ficou linha: fica a de quem queria passar.
    if v_disse ->> 'motivo' in ('teto_por_hora', 'texto_vazio', 'texto_longo_demais') then
      insert into public.ia_respostas (conversation_id, em_resposta_a, corpo, acao, detalhes, ai_run_id, prompt_version)
      values (p_conversation_id, p_em_resposta_a, left(coalesce(nullif(btrim(v_texto), ''), '—'), 1500),
              'nao_respondeu',
              jsonb_build_object('motivo', left(coalesce(p_motivo, ''), 300), 'quis', 'passou_para_pessoa',
                                 'recusa', v_disse ->> 'motivo'),
              p_ai_run_id, p_prompt_version);
    end if;
    v_para := app.ia_atendente_entregar(p_conversation_id, p_motivo);
  end if;
  return v_disse || jsonb_build_object('passada_para', v_para);
end $$;
comment on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) is
  'Porta do worker de IA: a IA avisa o cliente que vai passar (texto dela ou o aviso padrão) e entrega a conversa a uma pessoa, com tarefa para agora. Na conversa do treino (desde 06/11/2026) e nas de teste (desde 10/11/2026) o aviso sai e a IA continua atendendo, sem trocar o responsável nem abrir tarefa. Desde 11/11/2026, quando o aviso não sai pelo teto ou pelo texto, fica a linha nao_respondeu que queria passar (é dela que nasce o resumo da passagem).';
revoke all on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) to service_role;


-- =====================================================================
-- 5. A porta de leitura do worker
-- =====================================================================
-- A conversa ATÉ a passagem (as 60 mais recentes), no formato da entrada da IA
-- que atende, o motivo registrado, as visitas, os imóveis da Imova citados e o
-- retrato de treino ou teste. O que veio depois da passagem não entra.
create or replace function public.ia_resumo_da_passagem_entrada(p_resposta_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r        public.ia_respostas%rowtype;
  c        public.conversations%rowtype;
  s        public.ia_resumos_da_passagem%rowtype;
  v_org    public.organizations%rowtype;
  v_motivo text;
  v_msgs   jsonb;
begin
  select * into r from public.ia_respostas where id = p_resposta_id;
  if not found then
    return jsonb_build_object('existe', false);
  end if;
  if not app.ia_resumo_e_passagem(r.acao, r.message_id, r.detalhes) then
    return jsonb_build_object('existe', true, 'passagem', false);
  end if;
  select * into c from public.conversations where id = r.conversation_id;
  select * into s from public.ia_resumos_da_passagem where resposta_id = r.id;
  if c.organization_id is not null then
    select * into v_org from public.organizations where id = c.organization_id;
  end if;

  -- O motivo que a IA (ou a regra) escreveu. Quando a porteira recusou o aviso,
  -- o detalhe da linha diz "porteira"; o motivo ficou no atendimento daquela hora.
  v_motivo := nullif(btrim(coalesce(r.detalhes ->> 'motivo', '')), '');
  if v_motivo is null or v_motivo = 'porteira' then
    v_motivo := coalesce(
      (select nullif(btrim(a.motivo), '') from public.ia_atendimento a
        where a.conversation_id = r.conversation_id and a.mudou_por is null and a.mudou_em = r.criada_em),
      case when v_motivo = 'porteira' then 'o aviso de que ia passar não saiu (a porteira do WhatsApp recusou)' end);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'de', x.de, 'quem', x.quem, 'quando', x.quando, 'texto', x.texto)
         order by x.created_at, x.id), '[]'::jsonb)
    into v_msgs
    from (
      select m.id, m.created_at,
             case when m.direction = 'in'::app.msg_direction then 'cliente'
                  when m.author_kind = 'bot_ai' then 'ia'
                  when m.author_kind = 'human' then 'equipe'
                  else 'sistema' end as de,
             case when m.direction = 'out'::app.msg_direction and m.author_kind = 'human'
                  then app.primeiro_nome(m.sent_by) end as quem,
             to_char(m.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI') as quando,
             left(case
               when m.apagada_em is not null or m.apagada_pelo_contato_em is not null then '[mensagem apagada]'
               when m.type = 'audio'::app.msg_type then
                 coalesce('[áudio] ' || nullif(btrim(m.transcript), ''), '[áudio sem transcrição: não dá para ouvir]')
               when m.type = 'image'::app.msg_type then
                 '[foto]' || coalesce(' ' || nullif(btrim(m.body), ''), '')
               when m.type = 'video'::app.msg_type then
                 '[vídeo]' || coalesce(' ' || nullif(btrim(m.body), ''), '')
               when m.type = 'document'::app.msg_type then
                 '[documento' || coalesce(': ' || m.media_nome, '') || ']' || coalesce(' ' || nullif(btrim(m.body), ''), '')
               when m.type = 'location'::app.msg_type then '[localização]'
               when m.type = 'contacts'::app.msg_type then '[cartão de contato]'
               when m.direction = 'out'::app.msg_direction then coalesce(app.sem_assinatura(m.body), m.body)
               else coalesce(nullif(btrim(m.body), ''), m.transcript, '[mensagem sem texto]')
             end, 2000) as texto
        from public.messages m
       where m.conversation_id = r.conversation_id
         and m.created_at <= r.criada_em
         and m.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
         and not (m.direction = 'out'::app.msg_direction and m.status = 'failed'::app.msg_status)
       order by m.created_at desc, m.id desc
       limit 60
    ) x;

  return jsonb_build_object(
    'existe', true,
    'passagem', true,
    'resposta_id', r.id,
    'conversation_id', r.conversation_id,
    'organization_id', c.organization_id,
    'contact_id', c.contact_id,
    'nome', coalesce(nullif(btrim(v_org.name), ''), nullif(btrim(c.peer_nome), '')),
    'treino', r.conversation_id is not distinct from app.ia_conversa_de_treino(),
    'teste', app.ia_conversa_de_teste(r.conversation_id),
    'simulada', coalesce(s.simulada, app.ia_resumo_simulada(r.conversation_id)),
    'ja_resumida', coalesce(s.situacao = 'pronto', false),
    'motivo', left(v_motivo, 300),
    'passou_em', r.criada_em,
    'agora_por_extenso', app.reuniao_por_extenso(r.criada_em),
    'visitas', coalesce((
      select jsonb_agg(jsonb_build_object('quando', app.reuniao_por_extenso(v.inicio), 'estado', v.estado)
                       order by v.inicio)
        from (select rn.inicio, rn.estado from public.reunioes rn
               where c.organization_id is not null and rn.organization_id = c.organization_id
                 and rn.inicio > r.criada_em - interval '30 days'
               order by rn.inicio desc limit 5) v), '[]'::jsonb),
    'imoveis_citados', app.ia_resumo_imoveis_citados(r.conversation_id, r.criada_em),
    'mensagens', v_msgs);
end $$;
comment on function public.ia_resumo_da_passagem_entrada(uuid) is
  'Porta do worker de IA (Imova, 11/11/2026): o que o resumo da passagem lê — a conversa até a passagem (60 mensagens), o motivo registrado, as visitas no CRM, os imóveis da Imova citados e se a passagem foi simulação (treino ou teste, na hora).';
revoke all on function public.ia_resumo_da_passagem_entrada(uuid) from public, anon, authenticated;
grant execute on function public.ia_resumo_da_passagem_entrada(uuid) to service_role;


-- =====================================================================
-- 6. O aviso: a tarefa que avisou o corretor
-- =====================================================================
-- O resumo em uma linha, para o título da tarefa: "quente · comprar apartamento
-- de 3 quartos em Ponta Negra · até 600 mil (financiamento)".
create or replace function app.ia_resumo_manchete(s public.ia_resumos_da_passagem)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(concat_ws(' · ',
    s.temperatura::text,
    nullif(concat_ws(' ',
      case s.negocio when 'compra' then 'comprar' when 'locacao' then 'alugar' end,
      s.tipo,
      case when s.regiao is not null then 'em ' || s.regiao end), ''),
    case when cardinality(s.imoveis) > 0 then 'imóvel ' || array_to_string(s.imoveis, ', ') end,
    nullif(concat_ws(' ',
      s.orcamento,
      case when s.pagamento is not null then
        '(' || case s.pagamento when 'a_vista' then 'à vista' when 'fgts' then 'FGTS'
                                when 'consorcio' then 'consórcio' when 'misto' then 'mais de uma forma'
                                else s.pagamento end || ')' end), '')), '')
$$;
comment on function app.ia_resumo_manchete(public.ia_resumos_da_passagem) is
  'O resumo da passagem em uma linha (temperatura · o que procura · imóveis · orçamento), para o título da tarefa que avisa o corretor. Nulo quando a conversa não disse nada disso.';
revoke all on function app.ia_resumo_manchete(public.ia_resumos_da_passagem) from public, anon, authenticated;

-- A tarefa que a passagem abriu para quem recebe (`app.ia_atendente_entregar`,
-- na mesma transação da linha da passagem, por isso com o mesmo `now()`) ganha
-- o resumo no título, enquanto estiver aberta. Treino e teste nunca: lá a
-- passagem é simulação e não abre tarefa.
create or replace function app.ia_resumo_avisar(p_resumo_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s        public.ia_resumos_da_passagem%rowtype;
  r        public.ia_respostas%rowtype;
  c        public.conversations%rowtype;
  v_task   uuid;
  v_nome   text;
  v_linha  text;
  v_achou  int;
begin
  select * into s from public.ia_resumos_da_passagem where id = p_resumo_id;
  if not found or s.situacao <> 'pronto' or s.simulada then
    return null;
  end if;
  select * into r from public.ia_respostas where id = s.resposta_id;
  select * into c from public.conversations where id = s.conversation_id;
  v_nome := coalesce((select o.name from public.organizations o where o.id = c.organization_id),
                     nullif(btrim(c.peer_nome), ''), 'cliente');
  v_task := s.task_id;
  if v_task is null then
    -- A tarefa nasceu na transação da passagem: o mesmo instante, o mesmo
    -- cliente, para quem a conversa foi. Duas passagens na mesma rodada da fila
    -- (o "quero falar com um corretor" de dois clientes sem ficha, com o mesmo
    -- nome, para a mesma pessoa) não se distinguem: aí nenhuma tarefa é tocada,
    -- para o resumo de um não ir parar no aviso do outro.
    select count(*), min(t.id::text)::uuid into v_achou, v_task
      from public.tasks t
     where t.origin = 'system'
       and t.created_at = r.criada_em
       and starts_with(t.title, left('A IA passou o cliente para você: ' || v_nome, 300))
       and t.organization_id is not distinct from c.organization_id
       and t.contact_id is not distinct from c.contact_id
       and t.assignee_id is not distinct from (select a.passada_para from public.ia_atendimento a
                                                where a.conversation_id = c.id);
    if v_achou <> 1 then
      v_task := null;
    end if;
  end if;
  if v_task is null then
    return null;
  end if;
  v_linha := app.ia_resumo_manchete(s);
  if v_linha is not null then
    begin
      update public.tasks
         set title = left('A IA passou o cliente para você: ' || v_nome || ' — ' || v_linha, 300),
             updated_at = now()
       where id = v_task and status in ('todo', 'doing');
    exception when others then
      -- Contato suprimido no meio do caminho (o gatilho de tasks recusa): o
      -- resumo fica na conversa, e isso basta.
      raise warning 'ia_resumo_avisar: a tarefa % não recebeu o resumo: %', v_task, sqlerrm;
    end;
  end if;
  update public.ia_resumos_da_passagem set task_id = v_task where id = s.id and task_id is distinct from v_task;
  return v_task;
end $$;
revoke all on function app.ia_resumo_avisar(uuid) from public, anon, authenticated;


-- =====================================================================
-- 7. A porta de escrita do worker
-- =====================================================================
-- O formato que chega (do worker, já com uuid no lugar dos rótulos m1, m2...):
--   {"procura":   {"negocio": D, "tipo": D, "regiao": D},
--    "imoveis":   [{"codigo", "prova": uuid, "confirmacao": {"prova": uuid, "trecho"} | null}],
--    "orcamento": {"valor": D, "pagamento": D},
--    "objecao":   {"tipo", "como_disse", "trecho", "prova": uuid} | null,
--    "temperatura", "temperatura_porque", "porque_passou", "proximo_passo",
--    "dados_insuficientes"}
-- com D = {"valor", "trecho", "prova": uuid} | null. O que não se prova é
-- apagado (ver o cabeçalho). Uma linha por passagem: gravar de novo atualiza.
create or replace function public.ia_resumo_da_passagem_gravar(
  p_resposta_id uuid, p_resumo jsonb, p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r            public.ia_respostas%rowtype;
  v            jsonb := coalesce(p_resumo, '{}'::jsonb);
  v_procura    jsonb := case when jsonb_typeof(v -> 'procura') = 'object' then v -> 'procura' else '{}'::jsonb end;
  v_orcamento  jsonb := case when jsonb_typeof(v -> 'orcamento') = 'object' then v -> 'orcamento' else '{}'::jsonb end;
  v_objecao    jsonb := case when jsonb_typeof(v -> 'objecao') = 'object' then v -> 'objecao' else null end;
  v_ditos      jsonb := '{}'::jsonb;
  v_campo      text;
  v_item       jsonb;
  v_conferido  jsonb;
  v_obj_tipo   text;
  v_temp       text;
  v_catalogo   jsonb;
  v_imovel     jsonb;
  v_imoveis    text[] := '{}'::text[];
  v_prova_im   jsonb := '{}'::jsonb;
  v_codigo     text;
  m            public.messages%rowtype;
  k            public.messages%rowtype;
  v_trecho     text;
  v_ofertados  int;
  v_ok         boolean;
  v_achou      boolean;
  v_conf       uuid;
  v_descartes  text[] := '{}'::text[];
  v_id         uuid;
  v_task       uuid;
begin
  select * into r from public.ia_respostas where id = p_resposta_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'passagem_inexistente');
  end if;
  if not app.ia_resumo_e_passagem(r.acao, r.message_id, r.detalhes) then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_passagem');
  end if;

  -- O que procura e o orçamento: cada campo com a mensagem e o trecho dele.
  foreach v_campo in array array['negocio', 'tipo', 'regiao', 'orcamento', 'pagamento'] loop
    v_item := case v_campo when 'orcamento' then v_orcamento -> 'valor'
                           when 'pagamento' then v_orcamento -> 'pagamento'
                           else v_procura -> v_campo end;
    continue when v_item is null or jsonb_typeof(v_item) <> 'object';
    v_conferido := app.ia_resumo_dito(r.conversation_id, r.criada_em, v_item, v_campo);
    if v_conferido is not null and v_campo = 'negocio'
       and (v_conferido ->> 'valor') not in ('compra', 'locacao') then
      v_conferido := null;
    end if;
    if v_conferido is not null and v_campo = 'pagamento'
       and (v_conferido ->> 'valor') not in ('financiamento', 'a_vista', 'fgts', 'consorcio', 'misto') then
      v_conferido := null;
    end if;
    if v_conferido is null then
      v_descartes := array_append(v_descartes, v_campo || '_sem_prova');
    else
      v_ditos := v_ditos || jsonb_build_object(v_campo, v_conferido);
    end if;
  end loop;

  -- A objeção: uma, do catálogo, com o trecho numa mensagem do cliente.
  if v_objecao is not null then
    v_obj_tipo := v_objecao ->> 'tipo';
    v_conferido := case when v_obj_tipo in ('preco', 'localizacao', 'financiamento', 'imovel_nao_atende',
                                            'decide_com_outra_pessoa', 'prazo', 'ja_tem_corretor')
                        then app.ia_resumo_dito(r.conversation_id, r.criada_em,
                               jsonb_build_object('valor', v_obj_tipo, 'trecho', v_objecao -> 'trecho',
                                                  'prova', v_objecao -> 'prova'), 'objecao') end;
    if v_conferido is null then
      v_descartes := array_append(v_descartes, 'objecao_sem_prova');
    else
      v_ditos := v_ditos || jsonb_build_object('objecao', v_conferido);
    end if;
  end if;

  -- Os imóveis: código da Imova, palavra inteira na mensagem citada; se quem o
  -- escreveu foi a IA (ou a equipe), o cliente falou dele DEPOIS.
  v_catalogo := app.ia_atendente_imoveis();
  for v_item in
    select x from jsonb_array_elements(case when jsonb_typeof(v -> 'imoveis') = 'array'
                                            then v -> 'imoveis' else '[]'::jsonb end) x
  loop
    exit when cardinality(v_imoveis) >= 5;
    v_codigo := upper(btrim(coalesce(v_item ->> 'codigo', '')));
    continue when v_codigo = '' or v_codigo = any(v_imoveis);
    select i into v_imovel from jsonb_array_elements(v_catalogo) i
     where upper(i ->> 'codigo') = v_codigo limit 1;
    if v_imovel is null or v_codigo !~ '^[A-Z0-9][A-Z0-9_.-]{1,39}$' then
      v_descartes := array_append(v_descartes, 'imovel_desconhecido:' || v_codigo);
      v_imovel := null;
      continue;
    end if;
    select * into m from public.messages x
     where x.id = app.uuid_seguro(v_item ->> 'prova')
       and x.conversation_id = r.conversation_id
       and x.created_at <= r.criada_em
       and app.ia_resumo_tem_codigo(coalesce(x.body, '') || ' ' || coalesce(x.transcript, ''), v_codigo);
    if not found then
      v_descartes := array_append(v_descartes, 'imovel_sem_prova:' || v_codigo);
      v_imovel := null;
      continue;
    end if;
    v_trecho := null;
    v_conf := null;
    if m.direction = 'in'::app.msg_direction then
      v_ok := true;
    else
      v_trecho := left(nullif(btrim(coalesce(v_item -> 'confirmacao' ->> 'trecho', '')), ''), 200);
      select * into k from public.messages x
       where x.id = app.uuid_seguro(v_item -> 'confirmacao' ->> 'prova')
         and x.conversation_id = r.conversation_id
         and x.direction = 'in'::app.msg_direction
         and x.created_at > m.created_at
         and x.created_at <= r.criada_em;
      v_achou := found;
      v_conf := case when v_achou then k.id end;
      select count(*) into v_ofertados from jsonb_array_elements(v_catalogo) i
       where app.ia_resumo_tem_codigo(coalesce(m.body, '') || ' ' || coalesce(m.transcript, ''),
                                      upper(i ->> 'codigo'));
      v_ok := v_achou and v_trecho is not null
              and app.ia_resumo_trecho_na(coalesce(k.body, '') || ' ' || coalesce(k.transcript, ''), v_trecho)
              and (app.ia_resumo_tem_codigo(v_trecho, v_codigo)
                   or (v_ofertados = 1
                       and (string_to_array(app.ia_resumo_norm(v_trecho), ' ')
                              && array['esse', 'essa', 'este', 'esta', 'desse', 'dessa', 'deste', 'desta',
                                       'nesse', 'nessa', 'neste', 'nesta', 'ele', 'dele', 'nele', 'isso',
                                       'aquele', 'aquela', 'daquele', 'daquela']
                            or app.ia_resumo_bate_palavra(
                                 app.ia_resumo_palavras(v_trecho),
                                 app.ia_resumo_palavras(concat_ws(' ', v_imovel ->> 'tipo', v_imovel ->> 'bairro',
                                                                  v_imovel ->> 'titulo'))))));
    end if;
    if not v_ok then
      v_descartes := array_append(v_descartes, 'imovel_sem_interesse:' || v_codigo);
      v_imovel := null;
      continue;
    end if;
    v_imoveis := v_imoveis || v_codigo;
    v_prova_im := v_prova_im || jsonb_build_object(v_codigo, jsonb_build_object(
                    'prova', m.id, 'confirmacao', v_conf, 'trecho', v_trecho));
    v_imovel := null;
  end loop;

  v_temp := v ->> 'temperatura';
  v_temp := case when v_temp in ('frio', 'morno', 'quente') then v_temp end;

  insert into public.ia_resumos_da_passagem as s (
    conversation_id, resposta_id, situacao, simulada, negocio, tipo, regiao, imoveis, orcamento, pagamento,
    objecao, objecao_como_disse, temperatura, temperatura_porque, porque_passou, proximo_passo,
    evidencias, dados_insuficientes, motivo_sem_resumo, ai_run_id, prompt_version)
  values (
    r.conversation_id, r.id, 'pronto', app.ia_resumo_simulada(r.conversation_id),
    v_ditos -> 'negocio' ->> 'valor', v_ditos -> 'tipo' ->> 'valor', v_ditos -> 'regiao' ->> 'valor',
    v_imoveis, v_ditos -> 'orcamento' ->> 'valor', v_ditos -> 'pagamento' ->> 'valor',
    v_ditos -> 'objecao' ->> 'valor',
    case when v_ditos ? 'objecao'
         then left(nullif(btrim(coalesce(v_objecao ->> 'como_disse', '')), ''), 160) end,
    v_temp::app.temperature,
    -- O porquê da temperatura fica, também quando ela é nula ("não dá para julgar");
    -- só sai junto com uma temperatura fora da escala, que não quer dizer nada.
    case when v_temp is not null or v ->> 'temperatura' is null
         then left(nullif(btrim(coalesce(v ->> 'temperatura_porque', '')), ''), 160) end,
    left(nullif(btrim(coalesce(v ->> 'porque_passou', '')), ''), 200),
    left(nullif(btrim(coalesce(v ->> 'proximo_passo', '')), ''), 200),
    (select coalesce(jsonb_object_agg(e.key, jsonb_build_object('prova', e.value -> 'prova',
                                                                'trecho', e.value -> 'trecho')), '{}'::jsonb)
       from jsonb_each(v_ditos) e)
      || case when cardinality(v_imoveis) > 0 then jsonb_build_object('imoveis', v_prova_im) else '{}'::jsonb end,
    coalesce((v ->> 'dados_insuficientes')::boolean, false), null, p_ai_run_id, left(p_prompt_version, 80))
  on conflict (resposta_id) do update
    set situacao = 'pronto', negocio = excluded.negocio, tipo = excluded.tipo, regiao = excluded.regiao,
        imoveis = excluded.imoveis, orcamento = excluded.orcamento, pagamento = excluded.pagamento,
        objecao = excluded.objecao, objecao_como_disse = excluded.objecao_como_disse,
        temperatura = excluded.temperatura, temperatura_porque = excluded.temperatura_porque,
        porque_passou = excluded.porque_passou, proximo_passo = excluded.proximo_passo,
        evidencias = excluded.evidencias, dados_insuficientes = excluded.dados_insuficientes,
        motivo_sem_resumo = null, ai_run_id = excluded.ai_run_id, prompt_version = excluded.prompt_version,
        atualizado_em = now()
  returning s.id into v_id;

  -- O aviso. Erro aqui não desfaz o resumo, que já vale na conversa.
  begin
    v_task := app.ia_resumo_avisar(v_id);
  exception when others then
    raise warning 'ia_resumo_da_passagem_gravar: o aviso não recebeu o resumo: %', sqlerrm;
  end;

  return jsonb_build_object('ok', true, 'id', v_id, 'task_id', v_task, 'descartados', to_jsonb(v_descartes));
end $$;
comment on function public.ia_resumo_da_passagem_gravar(uuid, jsonb, bigint, text) is
  'Porta do worker de IA (Imova, 11/11/2026): grava o resumo da passagem, conferindo cada prova (o trecho literal na mensagem do cliente, nesta conversa, até a passagem, e o valor batendo com ele; o código do imóvel, palavra inteira, da Imova, e de interesse do cliente) e apagando o que não se prova. Põe o resumo no título da tarefa que avisou o corretor, enquanto aberta (nunca no treino nem no teste).';
revoke all on function public.ia_resumo_da_passagem_gravar(uuid, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_resumo_da_passagem_gravar(uuid, jsonb, bigint, text) to service_role;

-- O resumo não saiu: fica o porquê (suprimido, dado_pessoal, orcamento,
-- erro_do_modelo, sem_mensagem_do_cliente, erro_interno...), para a tela dizer
-- "leia a conversa" em vez de esperar. Não apaga resumo pronto.
create or replace function public.ia_resumo_da_passagem_falhou(
  p_resposta_id uuid, p_motivo text, p_ai_run_id bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r      public.ia_respostas%rowtype;
  v_id   uuid;
begin
  select * into r from public.ia_respostas where id = p_resposta_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'passagem_inexistente');
  end if;
  if not app.ia_resumo_e_passagem(r.acao, r.message_id, r.detalhes) then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_passagem');
  end if;
  insert into public.ia_resumos_da_passagem as s (conversation_id, resposta_id, situacao, simulada,
                                                  motivo_sem_resumo, ai_run_id)
  values (r.conversation_id, r.id, 'falhou', app.ia_resumo_simulada(r.conversation_id),
          left(coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'o resumo não saiu'), 200), p_ai_run_id)
  on conflict (resposta_id) do update
    set situacao = 'falhou', motivo_sem_resumo = excluded.motivo_sem_resumo,
        ai_run_id = coalesce(excluded.ai_run_id, s.ai_run_id), atualizado_em = now()
    where s.situacao <> 'pronto'
  returning s.id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'ja_tinha_resumo', v_id is null);
end $$;
comment on function public.ia_resumo_da_passagem_falhou(uuid, text, bigint) is
  'Porta do worker de IA (Imova, 11/11/2026): registra que o resumo da passagem não saiu, e por quê. Não mexe num resumo pronto.';
revoke all on function public.ia_resumo_da_passagem_falhou(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.ia_resumo_da_passagem_falhou(uuid, text, bigint) to service_role;

-- O worker antigo queimou a chave (tratou `resumir_passagem` como propósito
-- desconhecido e concluiu o trabalho), ou a linha não nasceu: põe de novo na
-- fila, com chave nova, as passagens das últimas `p_horas` (1 a 168) que estão
-- `pedido` há mais de 10 minutos ou não têm linha. Falha gravada não volta.
-- Para rodar depois de publicar o worker: select public.ia_resumos_reenfileirar(48);
create or replace function public.ia_resumos_reenfileirar(p_horas int default 48)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  x       record;
  v_chave text;
  v_n     int := 0;
begin
  if not coalesce((app.ia_resumo_config() ->> 'ligado')::boolean, true) then
    raise notice 'O resumo da passagem está desligado (app_settings ia.resumo_da_passagem): nada foi posto na fila.';
    return 0;
  end if;
  for x in
    select r.id, r.conversation_id
      from public.ia_respostas r
      left join public.ia_resumos_da_passagem s on s.resposta_id = r.id
     where app.ia_resumo_e_passagem(r.acao, r.message_id, r.detalhes)
       and r.criada_em > now() - make_interval(hours => least(greatest(coalesce(p_horas, 48), 1), 168))
       and (s.id is null or (s.situacao = 'pedido' and s.pedido_em < now() - interval '10 minutes'))
     order by r.criada_em
  loop
    v_chave := x.id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
    perform app.esteira_enfileirar(
      'ai_jobs',
      jsonb_build_object('purpose', 'resumir_passagem', 'chave', v_chave,
                         'conversation_id', x.conversation_id, 'resposta_id', x.id),
      'resumir_passagem:' || v_chave);
    insert into public.ia_resumos_da_passagem as s (conversation_id, resposta_id, situacao, simulada, pedido_em)
    values (x.conversation_id, x.id, 'pedido', app.ia_resumo_simulada(x.conversation_id), now())
    on conflict (resposta_id) do update set pedido_em = now(), atualizado_em = now()
      where s.situacao = 'pedido';
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
comment on function public.ia_resumos_reenfileirar(int) is
  'Serviço (Imova, 11/11/2026): põe de novo na fila ai_jobs, com chave nova, os resumos de passagem das últimas p_horas que ficaram pedidos há mais de 10 minutos (o worker antigo queimou a chave) ou sem linha. Rodar depois de publicar o worker de IA.';
revoke all on function public.ia_resumos_reenfileirar(int) from public, anon, authenticated;
grant execute on function public.ia_resumos_reenfileirar(int) to service_role;


-- =====================================================================
-- 8. A tela: as passagens da conversa e o destaque no topo
-- =====================================================================
-- Até 10 passagens, da mais nova para a mais velha. A situação de cada uma
-- vem da linha, não só do relógio: pronto; falhou (com o motivo); escrevendo
-- (pedido há menos de 15 min); nao_chegou (pedido mais velho, ou passagem de
-- depois desta migração sem linha); antes (de antes desta migração). O
-- DESTAQUE é a última passagem, se não foi simulação (o retrato da hora), se a
-- parada da IA veio DELA (o atendimento mudou na mesma hora, pela própria IA),
-- se ninguém da equipe escreveu depois e se a conversa não foi concluída depois.
create or replace function public.ia_passagens_da_conversa(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c          public.conversations%rowtype;
  a          public.ia_atendimento%rowtype;
  v_agora    boolean;
  v_desde    timestamptz := app.ia_resumo_desde();
  v_lista    jsonb;
  v_ultima   public.ia_respostas%rowtype;
  v_simulou  boolean;
  v_destaque uuid;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('existe', false);
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('existe', false);
  end if;
  select * into a from public.ia_atendimento where conversation_id = c.id;
  v_agora := app.ia_resumo_simulada(c.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'resposta_id', p.id,
           'message_id', p.message_id,
           'criada_em', p.criada_em,
           'motivo', nullif(nullif(btrim(coalesce(p.detalhes ->> 'motivo', '')), ''), 'porteira'),
           'aviso_saiu', p.message_id is not null,
           'simulada', coalesce(s.simulada, v_agora),
           'situacao', case when s.situacao in ('pronto', 'falhou') then s.situacao
                            when s.situacao = 'pedido' and s.pedido_em > now() - interval '15 minutes' then 'escrevendo'
                            when s.situacao = 'pedido' then 'nao_chegou'
                            when p.criada_em < v_desde then 'antes'
                            else 'nao_chegou' end,
           'resumo', case when s.id is null or s.situacao = 'pedido' then null else jsonb_build_object(
             'negocio', s.negocio,
             'tipo', s.tipo,
             'regiao', s.regiao,
             'imoveis', to_jsonb(s.imoveis),
             -- 25/11/2026: o imóvel de interesse que a IA registrou, para quando o cliente
             -- não escreveu código (o cartão mostra com "lido pela IA").
             'interesse', case when coalesce(cardinality(s.imoveis), 0) = 0
                               then app.ia_resumo_interesse(c.id) else '[]'::jsonb end,
             'orcamento', s.orcamento,
             'pagamento', s.pagamento,
             'objecao', s.objecao,
             'objecao_nome', case when s.objecao is not null then
               coalesce((select o.nome from public.objecoes o where o.slug = s.objecao),
                        case s.objecao when 'preco' then 'Preço' when 'localizacao' then 'Localização'
                                       when 'financiamento' then 'Financiamento'
                                       when 'imovel_nao_atende' then 'Imóvel não atende'
                                       when 'decide_com_outra_pessoa' then 'Decide com outra pessoa'
                                       when 'prazo' then 'Prazo' when 'ja_tem_corretor' then 'Já tem corretor'
                                       else s.objecao end) end,
             'objecao_como_disse', s.objecao_como_disse,
             'temperatura', s.temperatura,
             'temperatura_porque', s.temperatura_porque,
             'porque_passou', s.porque_passou,
             'proximo_passo', s.proximo_passo,
             'dados_insuficientes', s.dados_insuficientes,
             'motivo_sem_resumo', s.motivo_sem_resumo,
             'escrito_em', s.atualizado_em) end)
         order by p.criada_em desc), '[]'::jsonb)
    into v_lista
    from (select r.* from public.ia_respostas r
           where r.conversation_id = c.id
             and app.ia_resumo_e_passagem(r.acao, r.message_id, r.detalhes)
           order by r.criada_em desc
           limit 10) p
    left join public.ia_resumos_da_passagem s on s.resposta_id = p.id;

  select * into v_ultima from public.ia_respostas r
   where r.conversation_id = c.id
     and app.ia_resumo_e_passagem(r.acao, r.message_id, r.detalhes)
   order by r.criada_em desc
   limit 1;
  if found then
    v_simulou := coalesce((select s.simulada from public.ia_resumos_da_passagem s where s.resposta_id = v_ultima.id),
                          v_agora);
    if not v_simulou
       and a.estado = 'parada' and a.mudou_por is null and a.mudou_em = v_ultima.criada_em
       and not exists (select 1 from public.messages m
                        where m.conversation_id = c.id
                          and m.direction = 'out'::app.msg_direction
                          and m.author_kind = 'human'
                          and m.created_at > v_ultima.criada_em)
       and (c.arquivada_em is null or c.arquivada_em <= v_ultima.criada_em) then
      v_destaque := v_ultima.id;
    end if;
  end if;

  return jsonb_build_object(
    'existe', true,
    'simulada', v_agora,
    'passada_para', app.primeiro_nome(a.passada_para),
    'passagens', v_lista,
    'destaque', v_destaque);
end $$;
comment on function public.ia_passagens_da_conversa(uuid) is
  'A tela (Imova, 11/11/2026): as passagens da IA que atende nesta conversa, com o resumo para o corretor e a situação de cada uma (pronto, escrevendo, não chegou, falhou, antes), e qual fica em destaque no topo (a última de verdade, só enquanto a parada da IA for dela, ninguém da equipe tiver respondido e a conversa não tiver sido concluída). Admin, gestor e SDR.';
revoke all on function public.ia_passagens_da_conversa(uuid) from public, anon;
grant execute on function public.ia_passagens_da_conversa(uuid) to authenticated;

  $ddl$;
end $resumo$;

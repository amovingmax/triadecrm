-- ===========================================================================
-- Tríade — Módulo de prospecção ativa por ligação (lado do banco)
--
-- Fonte da verdade: docs/anexos/R13-telemarketing-prospeccao-ativa.md.
-- Complementos: PRD §5 (funis e temperatura), §5.6 (regra de temperatura),
-- RF-FUN-03/04/12/13, RF-MET-01/06, RF-CON-11 (janela), RF-CON-18 (opt-out),
-- RF-BAS-14 (telefone mascarado e log de revelação), RF-ADM-01 (papéis).
-- Contrato do cliente: apps/web/src/components/ligacao/tipos.ts (não editado aqui).
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRAÇÃO É, EM UMA FRASE
-- ---------------------------------------------------------------------------
-- A parte de baixo do "quem liga não escolhe para quem ligar e não decide o que
-- fazer depois" (R13 §3.1): o LOTE (recorte fechado, com reserva), a FILA (ordem
-- congelada, uma pessoa por contato), a CHAMADA (os dois eixos do R13 §3.3) e o
-- ROTEIRO EM ÁRVORE versionado (R13 §3.2). A consequência comercial — etapa,
-- temperatura, próxima ação, cooldown, guardrail de supressão — NÃO é
-- reimplementada: continua saindo de `public.registrar_contato` e do catálogo
-- `public.interaction_outcomes`, que já existem desde as migrações 000800/001100/001200.
--
-- ---------------------------------------------------------------------------
-- AS SEIS DECISÕES QUE ESTE ARQUIVO GRAVA
-- ---------------------------------------------------------------------------
--
-- 1. A RESERVA ACONTECE NA MONTAGEM, NÃO NA DISCAGEM (R13 §3.1). São duas pessoas
--    (Matheus e Heloísa) ligando da mesma base de 66 telefones: sem reserva, os
--    dois ligam para o mesmo buffet no mesmo dia. A reserva é um índice único
--    parcial em `call_batch_items (organization_id)` enquanto o item está `fila`
--    ou `em_andamento`, e um SEGUNDO em `phone_e164` — porque duas organizações
--    podem carregar o mesmo número (matriz e filial, dono com duas marcas) e
--    reservar só por organização deixaria os dois discando a mesma linha. Montar
--    é `insert ... on conflict do nothing`: quem já está reservado não entra, e a
--    função devolve quantos ficaram de fora por cada motivo.
--
-- 2. O EIXO TÉCNICO NÃO VIRA CHIP NOVO. A superfície `ligacao` já tem EXATAMENTE
--    8 desfechos ativos, que é o teto conferido pela seed (bloco 13, RF-MET-06).
--    O resultado da linha (atendida, não atendeu, caixa postal, ocupado, número
--    inválido, chamada muda, queda de linha) vira o enum `app.call_result`,
--    gravado em `call_attempts.resultado`, e se liga ao catálogo por
--    `app.outcome_for_call_result` — 7 resultados → 3 desfechos que JÁ existem.
--    Nenhum chip criado, nenhum aposentado, a tela `/registrar` intacta.
--    A coluna nova `interaction_outcomes.requires_answer` é aditiva e com padrão:
--    marca os 5 desfechos que pressupõem conversa. `/registrar` não a lê.
--
-- 3. A JANELA DE HORÁRIO É REGRA DE BANCO, NÃO DE TELA (R13 §6). `app.call_window`
--    é a mesma tabela de horários de `JANELA_DE_LIGACAO` em tipos.ts, e domingo é
--    AUSÊNCIA de linha em `app.call_window_hours`, não uma linha com zeros: o que
--    não está lá não abre. `public.proximo_da_fila` e `public.iniciar_chamada`
--    recusam fora da janela, em domingo e em feriado, com o motivo NOMEADO. A
--    TABULAÇÃO nunca é recusada por horário: uma ligação que começou 19h58 é
--    tabulada 20h03, e recusar isso perderia o registro de uma conversa que houve.
--
-- 4. O GUARDRAIL DE SUPRESSÃO VALE DUAS VEZES (RF-CON-18). Contato suprimido não
--    entra na montagem; e como alguém pode pedir opt-out DEPOIS do lote montado, a
--    checagem se repete ao puxar da fila e ao iniciar a chamada — ali o item sai do
--    lote como `devolvido`, liberando a reserva. Quem decide é
--    `app.is_suppressed_target`, a mesma função que `registrar_contato` já usa.
--
-- 5. O TELEFONE NÃO VAZA PELA PORTA DOS FUNDOS (RF-BAS-14). `call_batch_items`
--    guarda uma CÓPIA de `organizations.phone_e164` (o número reservado é o número
--    discado, mesmo que alguém edite a ficha depois) — e sdr/embaixador não leem
--    telefone na tabela base. Deixar a coluna legível teria desfeito a máscara sem
--    ninguém notar. Por isso o SELECT de `authenticated` nesta tabela é concedido
--    COLUNA A COLUNA, sem `phone_e164`; quem revela é `public.proximo_da_fila`
--    (security definer), que grava `pii_access_log` como o `reveal_phone` faz.
--
-- 6. A TELEFONIA É UM ADAPTADOR, NÃO UMA INTEGRAÇÃO (R13 §3.4, e a restrição que
--    manda no desenho: não existe discador contratado). `app.call_provider` nasce
--    com um valor só, `manual`. `iniciar_chamada` abre a tentativa e segura a
--    reserva; `tabular_chamada` a fecha. Um discador de verdade entra como outro
--    valor do enum, sem tocar em tabela nem em função.
--
-- Idempotente: pode ser reaplicada. Nada aqui enfraquece política existente.
-- ===========================================================================


-- ===========================================================================
-- 1. Tipos
-- ===========================================================================
-- `create type` não aceita "if not exists": o bloco captura duplicate_object,
-- no mesmo padrão das migrações 000100 e 000800.

-- Eixo técnico do R13 §3.3, na ordem de RESULTADOS_TECNICOS (tipos.ts). O teste
-- 13_* compara os dois lado a lado: divergir aqui é a tela mandar valor que o
-- banco não conhece.
do $$
begin
  create type app.call_result as enum
    ('atendida_humano','nao_atendeu','caixa_postal','ocupado','numero_invalido','chamada_muda','queda_de_linha');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.call_batch_status as enum ('rascunho','ativo','pausado','encerrado');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.call_item_status as enum ('fila','em_andamento','concluido','devolvido');
exception when duplicate_object then null; end $$;

do $$
begin
  create type app.call_order as enum ('prioridade','mais_parado','aleatorio');
exception when duplicate_object then null; end $$;

-- Um valor só, e é o ponto: o dia em que houver discador, ele entra aqui e o
-- relatório por provedor passa a existir sem migração de dado.
do $$
begin
  create type app.call_provider as enum ('manual');
exception when duplicate_object then null; end $$;


-- ===========================================================================
-- 2. Janela de horário (R13 §6; RF-CON-11) — a regra mora no banco
-- ===========================================================================
-- Seg–sex 9h–20h, sáb 10h–13h, domingo e feriado bloqueados, em America/Fortaleza.
-- DOMINGO É AUSÊNCIA: não há linha para dow = 0. O que não está na tabela não abre,
-- e acrescentar um dia é acrescentar uma linha — nunca mexer num `if`.
-- IMMUTABLE de propósito (não lê tabela): é a tabela de horários, não o calendário.
create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric)
language sql
immutable
set search_path = ''
as $$
  select h.de, h.ate
    from (values (1, 9::numeric, 20::numeric),
                 (2, 9::numeric, 20::numeric),
                 (3, 9::numeric, 20::numeric),
                 (4, 9::numeric, 20::numeric),
                 (5, 9::numeric, 20::numeric),
                 (6, 10::numeric, 13::numeric)) as h(dow, de, ate)
   where h.dow = p_dow
$$;
comment on function app.call_window_hours(int) is
  'Faixa de discagem por dia da semana (0 = domingo), em hora local de Fortaleza. Espelho de JANELA_DE_LIGACAO em components/ligacao/tipos.ts; domingo é ausência de linha (R13 §6).';

-- `YYYY-MM-DD` + hora local → instante absoluto. Fortaleza não tem horário de verão
-- desde 2019, mas `at time zone` resolve isso sozinho e continuaria certo se tivesse.
create or replace function app.instante_local(p_dia date, p_hora numeric)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (p_dia + make_interval(hours  => floor(p_hora)::int,
                                mins   => round((p_hora - floor(p_hora)) * 60)::int))
         at time zone 'America/Fortaleza'
$$;
comment on function app.instante_local(date, numeric) is
  'Dia civil em Fortaleza + hora local (14.5 = 14h30) → timestamptz. Espelho de instanteLocal em components/ligacao/tipos.ts.';

-- Próxima abertura DEPOIS do dia informado. 30 dias de teto: impossível não achar
-- com a `holidays` real, e melhor que um laço infinito se alguém semear errado.
create or replace function app.proxima_abertura(p_dia date)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_dia date;
  v_de  numeric;
begin
  for i in 1..30 loop
    v_dia := p_dia + i;
    select w.de into v_de from app.call_window_hours(extract(dow from v_dia)::int) w;
    if v_de is not null and not exists (select 1 from public.holidays h where h.date = v_dia) then
      return app.instante_local(v_dia, v_de);
    end if;
  end loop;
  return null;
end $$;
comment on function app.proxima_abertura(date) is
  'Início da próxima janela de discagem depois do dia informado, pulando domingo e feriado; null se não houver em 30 dias.';

-- Dá para discar agora, e quando muda. Devolve o instante da virada porque a tela
-- precisa de contagem regressiva ("faltam 12 minutos" faz a pessoa começar mais uma;
-- "bloqueado" faz ela ficar tentando).
create or replace function app.call_window(p_at timestamptz default now())
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local   timestamp := p_at at time zone 'America/Fortaleza';
  v_dia     date      := v_local::date;
  v_dow     int       := extract(dow from v_local)::int;
  v_hora    numeric   := extract(hour from v_local) + extract(minute from v_local) / 60.0;
  v_de      numeric;
  v_ate     numeric;
  v_feriado boolean;
  v_motivo  text;
begin
  select w.de, w.ate into v_de, v_ate from app.call_window_hours(v_dow) w;
  v_feriado := exists (select 1 from public.holidays h where h.date = v_dia);

  if not v_feriado and v_de is not null and v_hora >= v_de and v_hora < v_ate then
    return jsonb_build_object('aberta', true, 'motivo', null,
                              'abre_em', null,
                              'fecha_em', app.instante_local(v_dia, v_ate));
  end if;

  v_motivo := case
                when v_feriado          then 'feriado'
                when v_de is null       then 'domingo'
                when v_hora < v_de      then 'antes_da_abertura'
                else                         'depois_do_fechamento'
              end;

  -- Hoje ainda abre? Só no caso "cedo demais", e fora de feriado.
  return jsonb_build_object(
    'aberta',   false,
    'motivo',   v_motivo,
    'abre_em',  case when v_motivo = 'antes_da_abertura'
                     then app.instante_local(v_dia, v_de)
                     else app.proxima_abertura(v_dia) end,
    'fecha_em', null);
end $$;
comment on function app.call_window(timestamptz) is
  'Estado da janela de discagem (R13 §6; RF-CON-11): {aberta, motivo, abre_em, fecha_em}. Motivos: domingo, feriado, antes_da_abertura, depois_do_fechamento. Espelho de janelaDeLigacao em components/ligacao/tipos.ts; quem manda é esta função, porque a tela é a primeira barreira e nunca a única.';


-- ===========================================================================
-- 3. Ponte entre o eixo técnico e o catálogo que já existe (R13 §3.3)
-- ===========================================================================
-- Sete resultados de linha, três desfechos do catálogo. Ocupado, chamada muda e
-- queda de linha pedem exatamente o mesmo de volta que "não atendeu" — ligar
-- amanhã —, e criar chip para cada um estouraria o teto de 8 por superfície sem
-- mudar consequência nenhuma. A diferença fica em `call_attempts.resultado`, que
-- é onde ela serve para alguma coisa: o relatório por horário do R13 §7.7.
-- `atendida_humano` devolve NULL porque quem responde é o eixo comercial.
create or replace function app.outcome_for_call_result(p_result app.call_result)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_result
           when 'atendida_humano' then null
           when 'nao_atendeu'     then 'lig_nao_atendeu'
           when 'ocupado'         then 'lig_nao_atendeu'
           when 'chamada_muda'    then 'lig_nao_atendeu'
           when 'queda_de_linha'  then 'lig_nao_atendeu'
           when 'caixa_postal'    then 'lig_caixa_postal'
           when 'numero_invalido' then 'lig_numero_errado'
         end
$$;
comment on function app.outcome_for_call_result(app.call_result) is
  'Desfecho do catálogo que corresponde ao resultado técnico da chamada (R13 §3.3). Espelho de MAPA_RESULTADO_TECNICO em components/ligacao/tipos.ts; null em atendida_humano, onde quem responde é o eixo comercial.';

-- Coluna aditiva, com padrão, que a `/registrar` não lê: marca os desfechos que só
-- fazem sentido depois de alguém atender. É o que impede a tela de oferecer "Sem
-- interesse" a quem não atendeu — fabricar uma recusa que ninguém fez.
alter table public.interaction_outcomes
  add column if not exists requires_answer boolean not null default false;
comment on column public.interaction_outcomes.requires_answer is
  'true = o desfecho pressupõe conversa e só pode ser escolhido quando a chamada foi atendida (R13 §3.3). Governado pela seed; a tela lê a coluna, nunca a lista fixa.';


-- ===========================================================================
-- 4. Roteiro em árvore, versionado (R13 §3.2 e §5)
-- ===========================================================================
-- A árvore é jsonb e não tabela de nós de propósito: no MVP ela é escrita na seed e
-- lida inteira de uma vez pela tela (o editor visual não é MVP, R13 §7.3). O que
-- justifica a coluna é a VALIDAÇÃO — `app.validar_roteiro` recusa árvore em que
-- alguém trava no telefone —, e é o gatilho que a aplica, não a boa vontade de quem
-- semeia.
create table if not exists public.call_scripts (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null,
  nome          text not null check (length(trim(nome)) between 1 and 80),
  versao        int  not null check (versao > 0),
  arvore        jsonb not null,
  is_published  boolean not null default false,
  published_at  timestamptz,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (slug, versao)
);
alter table public.call_scripts enable row level security;
comment on table public.call_scripts is
  'Roteiro de ligação em árvore, versionado (R13 §3.2). O lote congela (script_id, script_version) na montagem: publicar v2 no meio da tarde não muda o lote em curso.';
comment on column public.call_scripts.arvore is
  'Array de nós no formato de noSchema (components/ligacao/tipos.ts): {id, tipo, variante, texto, saidas[{rotulo,destino}], desfecho, resultadoTecnico, campo, nota}.';
comment on column public.call_scripts.is_published is
  'Só versão publicada pode ser vinculada a um lote. Rascunho existe para o dia em que a edição sair da seed.';

-- Uma versão publicada por slug: a montagem escolhe roteiro, não versão.
create unique index if not exists call_scripts_publicado_uq
  on public.call_scripts (slug) where is_published;

-- ---------- validação da árvore (espelho de validarRoteiro em tipos.ts) ----------
-- Cobre o que dá para verificar sem ouvir a ligação: existe abertura, todo destino
-- existe, todo `fim` fecha por EXATAMENTE UM dos dois eixos, o desfecho de um `fim`
-- é comercial de ligação, e nenhum nó de fala/pergunta ficou sem saída — que é a
-- falha que trava a pessoa no telefone. E o teste por VARIANTE: o mesmo nó pode ter
-- saídas para as duas (é assim que a abertura, que é comum, cai no gancho certo), e
-- ele só está de pé se sobrar saída DEPOIS do filtro.
create or replace function app.validar_roteiro(p_arvore jsonb)
returns text[]
language plpgsql
-- STABLE e não IMMUTABLE: as mensagens saem de `format()`, que é STABLE (depende da
-- função de saída dos tipos). A função não lê tabela nenhuma; declarar IMMUTABLE
-- seria uma promessa maior do que o corpo cumpre — e o `supabase db lint` avisa.
stable
set search_path = ''
as $$
declare
  -- `'{}'::text[]` e `|| ...::text` explícitos: com a literal sem tipo, o Postgres
  -- resolve `text[] || unknown` como `array_cat(anyarray, anyarray)` e estoura
  -- "malformed array literal" em tempo de execução — só no caminho do erro, que é
  -- justamente o que esta função existe para percorrer. Quem apontou foi o db lint.
  v_erros    text[] := '{}'::text[];
  v_no       jsonb;
  v_saida    jsonb;
  v_ids      text[];
  v_variante text;
  v_destino  jsonb;
  v_sobrou   boolean;
begin
  if jsonb_typeof(p_arvore) <> 'array' or jsonb_array_length(p_arvore) = 0 then
    return array['A árvore precisa ser um array de nós, com ao menos um nó.'];
  end if;

  select array_agg(n ->> 'id') into v_ids from jsonb_array_elements(p_arvore) n;
  if not ('abertura' = any (v_ids)) then
    v_erros := v_erros || 'Falta o nó "abertura".'::text;
  end if;
  if (select count(distinct i) from unnest(v_ids) i) <> cardinality(v_ids) then
    v_erros := v_erros || 'Há ids de nó repetidos.'::text;
  end if;

  for v_no in select n from jsonb_array_elements(p_arvore) n loop
    if coalesce(v_no ->> 'id', '') !~ '^[a-z0-9_]+$' then
      v_erros := v_erros || format('Id de nó inválido: %s.', coalesce(v_no ->> 'id', '(vazio)'));
    end if;
    if (v_no ->> 'tipo') not in ('fala','pergunta','captura','objecao','acao','fim') then
      v_erros := v_erros || format('"%s" tem tipo desconhecido: %s.', v_no ->> 'id', v_no ->> 'tipo');
    end if;
    if (v_no ->> 'variante') not in ('ambas','fornecedor','produtor') then
      v_erros := v_erros || format('"%s" tem variante desconhecida: %s.', v_no ->> 'id', v_no ->> 'variante');
    end if;
    if length(trim(coalesce(v_no ->> 'texto', ''))) = 0 then
      v_erros := v_erros || format('"%s" não tem texto para falar.', v_no ->> 'id');
    end if;
    if (v_no ->> 'tipo') = 'captura' and coalesce(v_no ->> 'campo', '') = '' then
      v_erros := v_erros || format('"%s" é captura e não diz em que campo guarda a resposta.', v_no ->> 'id');
    end if;

    for v_saida in select s from jsonb_array_elements(coalesce(v_no -> 'saidas', '[]'::jsonb)) s loop
      if not ((v_saida ->> 'destino') = any (v_ids)) then
        v_erros := v_erros || format('"%s" aponta para "%s", que não existe.',
                                     v_no ->> 'id', v_saida ->> 'destino');
      end if;
      if length(coalesce(v_saida ->> 'rotulo', '')) not between 1 and 48 then
        v_erros := v_erros || format('"%s" tem botão sem rótulo ou com mais de 48 caracteres.', v_no ->> 'id');
      end if;
    end loop;

    if (v_no ->> 'tipo') = 'fim' then
      if (v_no ->> 'desfecho') is null and (v_no ->> 'resultadoTecnico') is null then
        v_erros := v_erros || format('"%s" é fim e não fecha por nenhum dos dois eixos.', v_no ->> 'id');
      elsif (v_no ->> 'desfecho') is not null and (v_no ->> 'resultadoTecnico') is not null then
        v_erros := v_erros || format('"%s" fecha pelos dois eixos ao mesmo tempo.', v_no ->> 'id');
      elsif (v_no ->> 'desfecho') is not null
            and (v_no ->> 'desfecho') not in ('lig_atendeu_retorna','lig_interessado','lig_agora_nao',
                                              'lig_sem_interesse','lig_reuniao_marcada') then
        v_erros := v_erros || format('"%s" usa o desfecho "%s", que não é comercial de ligação.',
                                     v_no ->> 'id', v_no ->> 'desfecho');
      end if;
    elsif jsonb_array_length(coalesce(v_no -> 'saidas', '[]'::jsonb)) = 0
          and (v_no ->> 'tipo') <> 'acao' then
      v_erros := v_erros || format('"%s" não tem saída e não é fim: a ligação trava aqui.', v_no ->> 'id');
    end if;
  end loop;

  -- Por variante: nó que vale na variante e não é fim nem ação precisa de ao menos
  -- uma saída cujo DESTINO também valha nela.
  foreach v_variante in array array['fornecedor','produtor'] loop
    for v_no in select n from jsonb_array_elements(p_arvore) n loop
      continue when (v_no ->> 'variante') not in ('ambas', v_variante);
      continue when (v_no ->> 'tipo') in ('fim','acao');
      v_sobrou := false;
      for v_saida in select s from jsonb_array_elements(coalesce(v_no -> 'saidas', '[]'::jsonb)) s loop
        select n into v_destino
          from jsonb_array_elements(p_arvore) n
         where n ->> 'id' = v_saida ->> 'destino'
         limit 1;
        if v_destino is not null and (v_destino ->> 'variante') in ('ambas', v_variante) then
          v_sobrou := true;
        end if;
      end loop;
      if not v_sobrou then
        v_erros := v_erros || format('"%s" fica sem saída na variante %s.', v_no ->> 'id', v_variante);
      end if;
    end loop;
  end loop;

  return v_erros;
end $$;
comment on function app.validar_roteiro(jsonb) is
  'Erros estruturais de um roteiro em árvore (R13 §3.2). Espelho de validarRoteiro em components/ligacao/tipos.ts: abertura presente, destinos existentes, fim fechando por exatamente um eixo, e nenhum nó sem saída em nenhuma das duas variantes.';

create or replace function app.call_scripts_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_erros text[] := app.validar_roteiro(new.arvore);
begin
  if cardinality(v_erros) > 0 then
    raise exception 'Roteiro % v% inválido: %', new.slug, new.versao, array_to_string(v_erros, ' ')
      using errcode = '23514';
  end if;
  if new.is_published and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end $$;
drop trigger if exists call_scripts_validate on public.call_scripts;
create trigger call_scripts_validate before insert or update on public.call_scripts
  for each row execute function app.call_scripts_validate();


-- ===========================================================================
-- 5. Lote (R13 §3.1)
-- ===========================================================================
create table if not exists public.call_batches (
  id                         uuid primary key default gen_random_uuid(),
  nome                       text not null check (length(trim(nome)) between 1 and 60),
  owner_id                   uuid not null references public.profiles (id) on delete cascade,
  status                     app.call_batch_status not null default 'ativo',
  pipeline_id                int  not null references public.pipelines (id),
  temperature_origin         app.temperature not null,
  script_id                  uuid not null references public.call_scripts (id),
  script_version             int  not null,
  order_mode                 app.call_order not null default 'prioridade',
  seed                       int  not null default (floor(random() * 1000000000))::int,
  max_attempts               int  not null default 3   check (max_attempts between 1 and 5),
  min_hours_between_attempts int  not null default 20  check (min_hours_between_attempts between 1 and 168),
  target_calls               int  check (target_calls is null or target_calls > 0),
  starts_on                  date not null,
  ends_on                    date not null,
  total                      int  not null default 0,
  pending                    int  not null default 0,
  talked                     int  not null default 0,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint call_batches_periodo check (ends_on >= starts_on)
);
alter table public.call_batches enable row level security;
comment on table public.call_batches is
  'Recorte fechado de trabalho de um turno (R13 §3.1): funil único, origem única de temperatura, roteiro congelado, janela de tentativas e ordem. Quem liga não escolhe para quem ligar — o lote é montado antes.';
comment on column public.call_batches.pipeline_id is
  'Funil ÚNICO. Funil único é variante única de roteiro, e é o que permite comparar duas versões de roteiro depois (R13 §7.7).';
comment on column public.call_batches.temperature_origin is
  'Origem única de temperatura (R13 §3.1): campo obrigatório, não filtro. Misturar base quente com coleta fria torna a conversão do lote um número sem significado; quem quiser os dois grupos monta dois lotes.';
comment on column public.call_batches.script_version is
  'Versão do roteiro congelada na montagem: publicar v2 no meio da tarde não muda o lote em curso.';
comment on column public.call_batches.seed is
  'Semente do modo aleatório; sempre gravada, para a mesma montagem dar sempre a mesma fila.';
comment on column public.call_batches.min_hours_between_attempts is
  'Piso de horas entre duas tentativas ao mesmo número. 20 por padrão: garante que a 2ª tentativa cai em outro período do dia, que é o que muda a taxa de atendimento.';
comment on column public.call_batches.target_calls is
  'Meta de ligações do lote (R13 §8.2: vira parâmetro do lote). O campo nasce mesmo nulo, porque a meta é decisão humana pendente.';
comment on column public.call_batches.talked is 'Itens em que alguém atendeu (call_attempts.resultado = atendida_humano).';

create index if not exists call_batches_owner_idx on public.call_batches (owner_id, status);
create index if not exists call_batches_script_idx on public.call_batches (script_id);

drop trigger if exists call_batches_set_updated_at on public.call_batches;
create trigger call_batches_set_updated_at before update on public.call_batches
  for each row execute function app.set_updated_at();

drop trigger if exists audit_call_batches on public.call_batches;
create trigger audit_call_batches after insert or update or delete on public.call_batches
  for each row execute function app.audit();


-- ===========================================================================
-- 6. Item do lote — a fila, e a reserva
-- ===========================================================================
create table if not exists public.call_batch_items (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references public.call_batches (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  contact_id       uuid references public.contacts (id) on delete set null,
  phone_e164       text not null,
  deal_id          uuid references public.deals (id) on delete set null,
  stage_id         int  references public.stages (id),
  status           app.call_item_status not null default 'fila',
  position         int  not null,
  attempts         int  not null default 0 check (attempts >= 0),
  scheduled_at     timestamptz,
  last_attempt_at  timestamptz,
  reserved_until   timestamptz,
  reserved_by      uuid references public.profiles (id) on delete set null,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (batch_id, position)
);
alter table public.call_batch_items enable row level security;
comment on table public.call_batch_items is
  'A fila do lote, com a ordem congelada na montagem (R13 §3.1). Fila que se reordena sozinha durante o dia é fila que a pessoa aprende a driblar.';
comment on column public.call_batch_items.phone_e164 is
  'Cópia do telefone no momento da montagem: o número que foi reservado é o que foi discado, mesmo que alguém edite a ficha depois. Não legível por authenticated (o SELECT é concedido coluna a coluna); quem revela é public.proximo_da_fila, com registro em pii_access_log (RF-BAS-14).';
comment on column public.call_batch_items.position is
  'Ordem resolvida UMA VEZ, na montagem. Só o reagendamento combinado com o cliente se sobrepõe a ela.';
comment on column public.call_batch_items.scheduled_at is
  'Reagendamento ("me liga terça às 10h"). É a única promessa que a fila tem de cumprir, e por isso vai na frente da posição.';
comment on column public.call_batch_items.reserved_until is
  'Enquanto o item está em_andamento ele segura a reserva; por isso ela expira sozinha (app.expirar_reservas). A aba fechada no meio de uma ligação não pode prender um buffet para sempre.';

-- ---------- A RESERVA (R13 §3.1) ----------
-- Dois índices, e o segundo não é redundância. `organizations.phone_e164` também é
-- único, mas SÓ entre organizações vivas — e a reserva precisa impedir que duas
-- LINHAS DE LOTE, de pessoas diferentes, apontem para a mesma linha telefônica
-- (matriz e filial, dono com duas marcas, número herdado). Sem ele, o Matheus e a
-- Heloísa discam o mesmo número no mesmo dia por dois lotes diferentes.
create unique index if not exists call_batch_items_org_reserva_uq
  on public.call_batch_items (organization_id)
  where status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status);
comment on index public.call_batch_items_org_reserva_uq is
  'Reserva por organização: um contato só pode estar ativo em um lote por vez (R13 §3.1).';

create unique index if not exists call_batch_items_phone_reserva_uq
  on public.call_batch_items (phone_e164)
  where status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status);
comment on index public.call_batch_items_phone_reserva_uq is
  'Reserva por linha telefônica: duas organizações podem carregar o mesmo número, e reservar só por organização deixaria duas pessoas discando a mesma linha.';

create index if not exists call_batch_items_fila_idx
  on public.call_batch_items (batch_id, position)
  where status = 'fila'::app.call_item_status;
create index if not exists call_batch_items_reserva_idx
  on public.call_batch_items (reserved_until)
  where status = 'em_andamento'::app.call_item_status;
create index if not exists call_batch_items_org_idx on public.call_batch_items (organization_id);
create index if not exists call_batch_items_deal_idx on public.call_batch_items (deal_id);

drop trigger if exists call_batch_items_set_updated_at on public.call_batch_items;
create trigger call_batch_items_set_updated_at before update on public.call_batch_items
  for each row execute function app.set_updated_at();

-- Contadores materializados: a lista de lotes não faz cinco consultas.
create or replace function app.call_batches_refresh_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid := coalesce(new.batch_id, old.batch_id);
begin
  update public.call_batches b
     set total   = (select count(*) from public.call_batch_items i
                     where i.batch_id = v_batch and i.status <> 'devolvido'::app.call_item_status),
         pending = (select count(*) from public.call_batch_items i
                     where i.batch_id = v_batch and i.status in ('fila'::app.call_item_status,
                                                                 'em_andamento'::app.call_item_status)),
         talked  = (select count(distinct a.item_id) from public.call_attempts a
                     where a.batch_id = v_batch and a.resultado = 'atendida_humano'::app.call_result)
   where b.id = v_batch;
  return null;
end $$;
comment on function app.call_batches_refresh_counts() is
  'Recalcula total/pending/talked do lote a cada mudança de item ou de chamada. Lote tem no máximo 60 itens: recontar é mais barato que manter incremento correto.';


-- ===========================================================================
-- 7. Chamada — os dois eixos, e o caminho do roteiro
-- ===========================================================================
create table if not exists public.call_attempts (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.call_batch_items (id) on delete cascade,
  batch_id         uuid not null references public.call_batches (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  contact_id       uuid references public.contacts (id) on delete set null,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  provedor         app.call_provider not null default 'manual',
  script_id        uuid references public.call_scripts (id),
  script_version   int,
  variante         text check (variante is null or variante in ('fornecedor','produtor')),
  iniciada_em      timestamptz not null default now(),
  atendida_em      timestamptz,
  encerrada_em     timestamptz,
  duracao_seg      int check (duracao_seg is null or duracao_seg between 0 and 7200),
  resultado        app.call_result,
  outcome_id       int  references public.interaction_outcomes (id),
  activity_id      uuid references public.activities (id) on delete set null,
  caminho_script   text[] not null default '{}',
  capturas         jsonb  not null default '{}'::jsonb,
  client_key       uuid,
  created_at       timestamptz not null default now(),
  -- Eixo comercial só existe com atendimento (R13 §3.3). A regra vale na tela
  -- (tabulacaoCoerente), na RPC (`eixos_incoerentes`) e aqui, porque quem escreve
  -- direto na tabela não passa por nenhuma das duas.
  constraint call_attempts_eixos
    check (outcome_id is null or resultado = 'atendida_humano'::app.call_result),
  constraint call_attempts_encerrada
    check (encerrada_em is null or resultado is not null or duracao_seg is null)
);
alter table public.call_attempts enable row level security;
comment on table public.call_attempts is
  'Uma tentativa de ligação: eixo técnico (resultado da linha), eixo comercial (desfecho do catálogo) e o caminho percorrido no roteiro (R13 §3.2/§3.3).';
comment on column public.call_attempts.resultado is
  'Eixo técnico (R13 §3.3): o que aconteceu com a linha. Não é escolha de quem ligou — no adaptador manual vem do toque na barra "não falei com ninguém" ou de a pessoa entrar na árvore; num discador virá do AMD.';
comment on column public.call_attempts.outcome_id is
  'Eixo comercial: o desfecho de public.interaction_outcomes que a tabulação usou. Em chamada não atendida é o desfecho que app.outcome_for_call_result resolveu, não uma escolha.';
comment on column public.call_attempts.caminho_script is
  'Ids dos nós percorridos, na ordem. É o que responde, depois de duas semanas, em qual frase as pessoas desligam (R13 §3.2) — pela view public.v_call_script_steps.';
comment on column public.call_attempts.client_key is
  'Chave de idempotência da tabulação, a mesma que vai para public.registrar_contato: reenviar não tabula duas vezes.';
comment on column public.call_attempts.user_id is
  'Quem ligou. Junto com call_batches.owner_id e script_version, é a costura que o R13 §4 guarda para o dia em que existir uma terceira pessoa.';

create index if not exists call_attempts_item_idx  on public.call_attempts (item_id, iniciada_em desc);
create index if not exists call_attempts_batch_idx on public.call_attempts (batch_id);
create index if not exists call_attempts_user_idx  on public.call_attempts (user_id, iniciada_em desc);
create index if not exists call_attempts_org_idx   on public.call_attempts (organization_id);
create index if not exists call_attempts_outcome_idx on public.call_attempts (outcome_id) where outcome_id is not null;
create index if not exists call_attempts_activity_idx on public.call_attempts (activity_id) where activity_id is not null;
create unique index if not exists call_attempts_client_key_uq
  on public.call_attempts (client_key) where client_key is not null;
-- Uma chamada aberta por item: a aba duplicada não abre duas tentativas.
create unique index if not exists call_attempts_aberta_uq
  on public.call_attempts (item_id) where encerrada_em is null;

drop trigger if exists call_attempts_refresh_counts on public.call_attempts;
create trigger call_attempts_refresh_counts after insert or update or delete on public.call_attempts
  for each row execute function app.call_batches_refresh_counts();

drop trigger if exists call_batch_items_refresh_counts on public.call_batch_items;
create trigger call_batch_items_refresh_counts after insert or update or delete on public.call_batch_items
  for each row execute function app.call_batches_refresh_counts();

-- ---------- o caminho percorrido, em linhas ----------
-- O caminho é ARRAY na tentativa (é assim que a tela o manda e o lê) e VIEW aqui.
-- Uma tabela de passos seria uma segunda verdade sobre o mesmo dado, com escrita a
-- cada nó; `unnest ... with ordinality` responde a pergunta do R13 §3.2 — em qual
-- frase as pessoas desligam — sem duplicar nada.
create or replace view public.v_call_script_steps
with (security_barrier = true, security_invoker = true) as
  select a.id            as attempt_id,
         a.batch_id,
         a.organization_id,
         a.user_id,
         a.script_id,
         a.script_version,
         a.variante,
         a.resultado,
         a.outcome_id,
         p.ord::int      as passo,
         p.no_id,
         (p.ord = cardinality(a.caminho_script)) as ultimo_no,
         a.iniciada_em
    from public.call_attempts a
    cross join lateral unnest(a.caminho_script) with ordinality as p(no_id, ord)
   where cardinality(a.caminho_script) > 0;
alter view public.v_call_script_steps owner to postgres;
comment on view public.v_call_script_steps is
  'Cada nó percorrido em cada chamada, na ordem, com marca de último nó. É a resposta do R13 §3.2: em qual frase as pessoas desligam.';


-- ===========================================================================
-- 8. Apoio de autorização (padrão da migração 000500)
-- ===========================================================================
-- SECURITY DEFINER porque as políticas de call_batch_items e call_attempts
-- precisam olhar o lote, e olhar o lote pela política do lote seria recursão.
create or replace function app.call_batch_is_visible(p_batch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.call_batches b
                  where b.id = p_batch
                    and (app.is_manager() or app.sees_all() or b.owner_id = auth.uid()))
$$;
comment on function app.call_batch_is_visible(uuid) is
  'Lote visível para o papel atual: quem vê tudo (admin, gestor, sdr, leitura, financeiro) ou o dono do lote.';

create or replace function app.call_batch_is_mine(p_batch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.call_batches b
                  where b.id = p_batch
                    and (app.is_manager() or b.owner_id = auth.uid()))
$$;
comment on function app.call_batch_is_mine(uuid) is
  'Lote que o papel atual pode alterar: admin/gestor ou o próprio dono. Ninguém tabula no lote de outra pessoa (R13 §3.1).';


-- ===========================================================================
-- 9. RLS (padrão da migração 000500) — nada aqui é afrouxado para funcionar
-- ===========================================================================

-- ---------- call_scripts: catálogo ----------
drop policy if exists call_scripts_select on public.call_scripts;
drop policy if exists call_scripts_insert on public.call_scripts;
drop policy if exists call_scripts_update on public.call_scripts;
drop policy if exists call_scripts_delete on public.call_scripts;
create policy call_scripts_select on public.call_scripts for select to authenticated using (true);
create policy call_scripts_insert on public.call_scripts for insert to authenticated
  with check ((select app.is_manager()));
create policy call_scripts_update on public.call_scripts for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));
create policy call_scripts_delete on public.call_scripts for delete to authenticated
  using ((select app.is_manager()));

drop trigger if exists audit_call_scripts on public.call_scripts;
create trigger audit_call_scripts after insert or update or delete on public.call_scripts
  for each row execute function app.audit();

-- ---------- call_batches ----------
drop policy if exists call_batches_select on public.call_batches;
drop policy if exists call_batches_insert on public.call_batches;
drop policy if exists call_batches_update on public.call_batches;
drop policy if exists call_batches_delete on public.call_batches;
create policy call_batches_select on public.call_batches for select to authenticated
  using ((select app.sees_all()) or owner_id = (select auth.uid()));
-- Montar lote é ato de quem trabalha em campo (can_write), e o lote nasce da pessoa:
-- ninguém monta lote no nome de outro, exceto gestor/admin.
create policy call_batches_insert on public.call_batches for insert to authenticated
  with check ((select app.can_write())
              and (owner_id = (select auth.uid()) or (select app.is_manager())));
create policy call_batches_update on public.call_batches for update to authenticated
  using ((select app.is_manager()) or owner_id = (select auth.uid()))
  with check ((select app.is_manager()) or owner_id = (select auth.uid()));
create policy call_batches_delete on public.call_batches for delete to authenticated
  using ((select app.is_admin()));

-- ---------- call_batch_items ----------
drop policy if exists call_batch_items_select on public.call_batch_items;
drop policy if exists call_batch_items_insert on public.call_batch_items;
drop policy if exists call_batch_items_update on public.call_batch_items;
drop policy if exists call_batch_items_delete on public.call_batch_items;
create policy call_batch_items_select on public.call_batch_items for select to authenticated
  using ((select app.call_batch_is_visible(batch_id)));
create policy call_batch_items_insert on public.call_batch_items for insert to authenticated
  with check ((select app.can_write()) and (select app.call_batch_is_mine(batch_id)));
create policy call_batch_items_update on public.call_batch_items for update to authenticated
  using ((select app.can_write()) and (select app.call_batch_is_mine(batch_id)))
  with check ((select app.can_write()) and (select app.call_batch_is_mine(batch_id)));
create policy call_batch_items_delete on public.call_batch_items for delete to authenticated
  using ((select app.is_admin()));

-- RF-BAS-14 pela porta dos fundos: a cópia do telefone não pode ser legível por
-- quem não lê `organizations.phone_e164`. A RLS filtra LINHAS e não colunas, e a
-- migração 000500 concede `select` na tabela inteira por privilégio padrão — então
-- o SELECT é retirado e devolvido COLUNA A COLUNA, sem `phone_e164`.
revoke select on public.call_batch_items from authenticated;
grant select (id, batch_id, organization_id, contact_id, deal_id, stage_id, status,
              position, attempts, scheduled_at, last_attempt_at, reserved_until,
              reserved_by, note, created_at, updated_at)
  on public.call_batch_items to authenticated;

-- ---------- call_attempts ----------
drop policy if exists call_attempts_select on public.call_attempts;
drop policy if exists call_attempts_insert on public.call_attempts;
drop policy if exists call_attempts_update on public.call_attempts;
drop policy if exists call_attempts_delete on public.call_attempts;
create policy call_attempts_select on public.call_attempts for select to authenticated
  using ((select app.call_batch_is_visible(batch_id)));
create policy call_attempts_insert on public.call_attempts for insert to authenticated
  with check ((select app.can_write())
              and user_id = (select auth.uid())
              and (select app.call_batch_is_mine(batch_id)));
create policy call_attempts_update on public.call_attempts for update to authenticated
  using ((select app.is_manager()) or user_id = (select auth.uid()))
  with check ((select app.is_manager()) or user_id = (select auth.uid()));
create policy call_attempts_delete on public.call_attempts for delete to authenticated
  using ((select app.is_admin()));


-- ===========================================================================
-- 10. Montar o lote — a reserva acontece aqui (R13 §3.1)
-- ===========================================================================

-- ---------- quem é candidato, e por que cada um fica de fora ----------
-- Função separada por dois motivos: a montagem precisa contar os excluídos ANTES de
-- inserir (é o que a tela mostra: "pedi 25, vieram 18") e inserir na mesma ordem
-- depois — e uma consulta escrita duas vezes vira duas regras no primeiro remendo.
--
-- SECURITY DEFINER pelo motivo de sempre (RF-BAS-14): sdr e embaixador não leem
-- `public.organizations` na base, e como invoker a montagem devolveria lote VAZIO
-- justamente para quem trabalha em campo. A visibilidade não é afrouxada: o
-- candidato passa por `app.org_is_visible`, que é a mesma regra da política.
-- Ela devolve telefone, então NÃO é executável por authenticated — só as RPCs
-- definer deste arquivo a chamam.
--
-- A ordem dos motivos é a ordem em que eles importam para quem lê a tela: negócio
-- antes de telefone, telefone antes de supressão, supressão antes de janela, e
-- reserva por último, porque ela é a única que muda de segundo em segundo.
--
-- `join deals` (e não left join): `deals` é única por (organization_id, pipeline_id),
-- então organização sem negócio NESTE funil não é candidata a este lote — contar
-- "sem negócio aberto" para as 50 do outro funil só faria a tela mentir de outro jeito.
create or replace function app.call_candidates(
  p_pipeline_id        int,
  p_temperatura_origem app.temperature,
  p_categoria_ids      int[],
  p_ordem              app.call_order,
  p_seed               int)
returns table (
  organization_id uuid,
  contact_id      uuid,
  phone_e164      text,
  deal_id         uuid,
  stage_id        int,
  motivo          text,
  ordem           bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id,
         d.primary_contact_id,
         o.phone_e164,
         d.id,
         d.stage_id,
         case
           when d.status <> 'open'::app.deal_status                   then 'sem_negocio_aberto'
           when nullif(trim(coalesce(o.phone_e164, '')), '') is null  then 'sem_telefone'
           when o.do_not_contact                                      then 'nao_contatar'
           when app.is_suppressed_target(o.id, d.primary_contact_id)  then 'suprimido'
           when d.temperature <> p_temperatura_origem                 then 'temperatura_diferente'
           when coalesce(cd.blocked_forever, false)                   then 'em_janela_de_recontato'
           when cd.cooldown_until > now()                             then 'em_janela_de_recontato'
           when exists (select 1 from public.call_batch_items r
                         where r.status in ('fila'::app.call_item_status,
                                            'em_andamento'::app.call_item_status)
                           and (r.organization_id = o.id or r.phone_e164 = o.phone_e164))
                                                                      then 'reservado_em_outro_lote'
           else null
         end,
         row_number() over (
           order by
             case when p_ordem = 'prioridade'::app.call_order
                  then case d.tier when 'A+' then 4 when 'A' then 3 when 'B' then 2 when 'C' then 1 else 0 end
                  else 0 end desc,
             case when p_ordem = 'prioridade'::app.call_order
                  then coalesce(d.score, -1) else 0 end desc,
             case when p_ordem = 'aleatorio'::app.call_order
                  then md5(p_seed::text || o.id::text) else '' end,
             case when p_ordem <> 'aleatorio'::app.call_order
                  then coalesce(d.last_activity_at, 'epoch'::timestamptz) end asc,
             o.name)
    from public.organizations o
    join public.deals d
      on d.organization_id = o.id
     and d.pipeline_id = p_pipeline_id
    left join public.v_contact_cooldown cd on cd.organization_id = o.id
   where o.deleted_at is null
     and app.org_is_visible(o.id)
     and (cardinality(coalesce(p_categoria_ids, '{}'::int[])) = 0
          or exists (select 1 from public.organization_categories oc
                      where oc.organization_id = o.id
                        and oc.category_id = any (p_categoria_ids)))
$$;
comment on function app.call_candidates(int, app.temperature, int[], app.call_order, int) is
  'Candidatos de um lote de ligação, com o motivo de exclusão de cada um (null = entra) e a ordem congelada da fila (R13 §3.1). Devolve telefone: só as RPCs security definer do módulo a executam.';
revoke all on function app.call_candidates(int, app.temperature, int[], app.call_order, int)
  from public, anon, authenticated;

-- ---------- a montagem ----------
-- SECURITY DEFINER pelo mesmo motivo de `app.call_candidates`. A função repete
-- dentro do corpo a autorização das políticas, sem afrouxá-la: `app.can_write()`
-- para escrever e `app.org_is_visible()` para escolher o candidato. Nenhum telefone
-- atravessa o retorno.
create or replace function public.montar_lote(
  p_nome                   text,
  p_pipeline_id            int,
  p_temperatura_origem     app.temperature,
  p_roteiro_id             uuid,
  p_categoria_ids          int[]        default '{}',
  p_ordem                  app.call_order default 'prioridade',
  p_tamanho                int          default 25,
  p_max_tentativas         int          default 3,
  p_horas_entre_tentativas int          default 20,
  p_meta_ligacoes          int          default null,
  p_inicia_em              date         default null,
  p_termina_em             date         default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_hoje      date := (now() at time zone 'America/Fortaleza')::date;
  v_ordem     app.call_order := coalesce(p_ordem, 'prioridade'::app.call_order);
  v_script    public.call_scripts%rowtype;
  v_lote      uuid;
  v_seed      int  := (floor(random() * 1000000000))::int;
  v_entraram  int  := 0;
  v_elegiveis int  := 0;
  v_excluidos jsonb := '{}'::jsonb;
  v_conflito  int  := 0;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('montado', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;
  if coalesce(p_tamanho, 0) not between 1 and 60 then
    return jsonb_build_object('montado', false, 'motivo', 'tamanho_invalido', 'detalhe', p_tamanho::text);
  end if;
  if not exists (select 1 from public.pipelines p where p.id = p_pipeline_id) then
    return jsonb_build_object('montado', false, 'motivo', 'funil_invalido', 'detalhe', null);
  end if;

  select * into v_script from public.call_scripts s where s.id = p_roteiro_id and s.is_published;
  if not found then
    return jsonb_build_object('montado', false, 'motivo', 'roteiro_invalido', 'detalhe', null);
  end if;

  insert into public.call_batches
    (nome, owner_id, status, pipeline_id, temperature_origin, script_id, script_version,
     order_mode, seed, max_attempts, min_hours_between_attempts, target_calls, starts_on, ends_on)
  values
    (left(trim(p_nome), 60), v_uid, 'ativo', p_pipeline_id, p_temperatura_origem,
     v_script.id, v_script.versao, v_ordem, v_seed,
     coalesce(p_max_tentativas, 3), coalesce(p_horas_entre_tentativas, 20), p_meta_ligacoes,
     coalesce(p_inicia_em, v_hoje), coalesce(p_termina_em, p_inicia_em, v_hoje))
  returning id into v_lote;

  select coalesce(jsonb_object_agg(t.motivo, t.n), '{}'::jsonb) into v_excluidos
    from (select c.motivo, count(*)::int as n
            from app.call_candidates(p_pipeline_id, p_temperatura_origem,
                                     p_categoria_ids, v_ordem, v_seed) c
           where c.motivo is not null
           group by c.motivo) t;

  select count(*)::int into v_elegiveis
    from app.call_candidates(p_pipeline_id, p_temperatura_origem,
                             p_categoria_ids, v_ordem, v_seed) c
   where c.motivo is null;

  -- ----- a reserva -----
  -- `on conflict do nothing` sem alvo: quem já está reservado (por organização OU
  -- por linha telefônica) simplesmente não entra. Não existe "roubar" item de outro
  -- lote; existe encerrar o lote, o que devolve todos os pendentes.
  -- `distinct on (phone_e164)` porque duas organizações do MESMO lote podem carregar
  -- o mesmo número, e aí o conflito seria contra uma linha que este comando acabou
  -- de inserir.
  with escolhidos as (
    select distinct on (c.phone_e164) c.*
      from app.call_candidates(p_pipeline_id, p_temperatura_origem,
                               p_categoria_ids, v_ordem, v_seed) c
     where c.motivo is null
     order by c.phone_e164, c.ordem
  ), ordenados as (
    select e.*, row_number() over (order by e.ordem) as pos
      from escolhidos e
     order by e.ordem
     limit p_tamanho
  )
  insert into public.call_batch_items
    (batch_id, organization_id, contact_id, phone_e164, deal_id, stage_id, position)
  select v_lote, x.organization_id, x.contact_id, x.phone_e164, x.deal_id, x.stage_id, x.pos
    from ordenados x
  on conflict do nothing;
  get diagnostics v_entraram = row_count;

  -- A diferença entre o que era elegível na contagem e o que entrou de fato é
  -- corrida de reserva: outra pessoa montou lote entre a contagem e o insert.
  v_conflito := least(p_tamanho, v_elegiveis) - v_entraram;
  if v_conflito > 0 then
    v_excluidos := v_excluidos || jsonb_build_object(
      'reservado_em_outro_lote',
      coalesce((v_excluidos ->> 'reservado_em_outro_lote')::int, 0) + v_conflito);
  end if;

  return jsonb_build_object(
    'montado',        true,
    'lote_id',        v_lote,
    'pedidos',        p_tamanho,
    'entraram',       v_entraram,
    'excluidos',      v_excluidos,
    'roteiro_id',     v_script.id,
    'roteiro_versao', v_script.versao);
end $$;
comment on function public.montar_lote(text, int, app.temperature, uuid, int[], app.call_order,
                                       int, int, int, int, date, date) is
  'Monta um lote de ligação e RESERVA os contatos na criação (R13 §3.1). Devolve quantos entraram e quantos ficaram de fora por motivo (sem_negocio_aberto, sem_telefone, nao_contatar, suprimido, temperatura_diferente, em_janela_de_recontato, reservado_em_outro_lote). Contato suprimido nunca entra (RF-CON-18).';
revoke all on function public.montar_lote(text, int, app.temperature, uuid, int[], app.call_order,
                                          int, int, int, int, date, date) from public, anon;
grant execute on function public.montar_lote(text, int, app.temperature, uuid, int[], app.call_order,
                                             int, int, int, int, date, date) to authenticated, service_role;


-- ===========================================================================
-- 11. Expirar reserva e encerrar lote
-- ===========================================================================
-- Um item `em_andamento` segura a reserva. A aba fechada no meio de uma ligação não
-- pode prender um buffet para sempre: passados 30 minutos (RESERVA_EXPIRA_MIN em
-- tipos.ts) ele volta para a fila e a chamada aberta é fechada SEM resultado — que
-- é a verdade: ninguém tabulou.
create or replace function app.expirar_reservas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int := 0;
  m int := 0;
begin
  update public.call_attempts a
     set encerrada_em = now()
   where a.encerrada_em is null
     and exists (select 1 from public.call_batch_items i
                  where i.id = a.item_id
                    and i.status = 'em_andamento'::app.call_item_status
                    and i.reserved_until < now());

  update public.call_batch_items i
     set status = 'fila'::app.call_item_status,
         reserved_until = null,
         reserved_by = null
   where i.status = 'em_andamento'::app.call_item_status
     and i.reserved_until < now();
  get diagnostics n = row_count;

  -- Fora do período o lote não entrega item e as reservas caem (R13 §3.1).
  update public.call_batch_items i
     set status = 'devolvido'::app.call_item_status,
         reserved_until = null,
         reserved_by = null,
         note = coalesce(i.note, 'lote fora do período')
    from public.call_batches b
   where b.id = i.batch_id
     and i.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status)
     and (b.status = 'encerrado'::app.call_batch_status
          or b.ends_on < (now() at time zone 'America/Fortaleza')::date);
  get diagnostics m = row_count;

  return n + m;
end $$;
comment on function app.expirar_reservas() is
  'Devolve à fila os itens em_andamento com reserva vencida (30 min) e libera os itens de lote encerrado ou fora do período. Chamada pelo pg_cron.';
revoke execute on function app.expirar_reservas() from public, anon, authenticated;
grant execute on function app.expirar_reservas() to service_role;

-- De 10 em 10 minutos: a reserva de 30 minutos vence no máximo 10 minutos atrasada,
-- e o próximo da fila também varre o próprio lote antes de escolher.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('expirar_reservas_de_ligacao', '*/10 * * * *',
                          $cron$select app.expirar_reservas()$cron$);
  end if;
end $$;

-- Encerrar o lote devolve todos os pendentes: é a única forma de liberar a reserva
-- sem tabular, e por isso ela é explícita e auditada (audit_call_batches).
create or replace function app.call_batches_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'encerrado'::app.call_batch_status
     and old.status is distinct from 'encerrado'::app.call_batch_status then
    update public.call_attempts a
       set encerrada_em = now()
     where a.batch_id = new.id and a.encerrada_em is null;
    update public.call_batch_items i
       set status = 'devolvido'::app.call_item_status,
           reserved_until = null,
           reserved_by = null
     where i.batch_id = new.id
       and i.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status);
  end if;
  return null;
end $$;
drop trigger if exists call_batches_on_close on public.call_batches;
create trigger call_batches_on_close after update of status on public.call_batches
  for each row execute function app.call_batches_on_close();


-- ===========================================================================
-- 12. Puxar o próximo da fila — trava, janela e guardrail
-- ===========================================================================
-- SECURITY DEFINER por duas razões, e as duas são de guardrail e não de conveniência:
--   * o telefone. sdr não lê `organizations.phone_e164` nem a coluna `phone_e164`
--     desta tabela (o SELECT foi concedido coluna a coluna). Quem revela é esta
--     função, e ela grava `pii_access_log` como o `reveal_phone` da 000500 — a
--     revelação continua auditada, que é o que o RF-BAS-14 pede.
--   * a trava. `for update skip locked` sobre a linha do item é o que impede o
--     Matheus e a Heloísa de puxarem o mesmo contato no mesmo segundo.
--
-- A JANELA recusa aqui, com o motivo nomeado (R13 §6): fora de hora, domingo e
-- feriado não entregam item. É o banco quem recusa, não a tela.
create or replace function public.proximo_da_fila(p_lote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    app.user_role;
  v_hoje    date := (now() at time zone 'America/Fortaleza')::date;
  b         public.call_batches%rowtype;
  i         public.call_batch_items%rowtype;
  v_janela  jsonb;
  v_org     public.organizations%rowtype;
  v_contato public.contacts%rowtype;
  v_restam  int;
  v_voltas  int := 0;
  v_achou   boolean := false;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_role := app.role();
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;

  select * into b from public.call_batches where id = p_lote_id;
  if not found or not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'lote_de_outro_dono', 'detalhe', null);
  end if;
  if b.status <> 'ativo'::app.call_batch_status then
    return jsonb_build_object('ok', false, 'motivo', 'lote_encerrado', 'detalhe', b.status::text);
  end if;
  if v_hoje < b.starts_on or v_hoje > b.ends_on then
    return jsonb_build_object('ok', false, 'motivo', 'fora_do_periodo',
                              'detalhe', b.starts_on::text || '..' || b.ends_on::text);
  end if;

  -- ----- a janela, antes de tudo (R13 §6) -----
  v_janela := app.call_window(now());
  if not (v_janela ->> 'aberta')::boolean then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_janela',
                              'detalhe', v_janela ->> 'motivo',
                              'abre_em', v_janela -> 'abre_em');
  end if;

  -- Reserva vencida do PRÓPRIO lote volta para a fila antes da escolha: quem
  -- abandonou uma ligação há 40 minutos não pode ser o motivo de a fila parecer vazia.
  update public.call_batch_items x
     set status = 'fila'::app.call_item_status, reserved_until = null, reserved_by = null
   where x.batch_id = b.id
     and x.status = 'em_andamento'::app.call_item_status
     and x.reserved_until < now();

  -- ----- o próximo -----
  -- Uma regra só se sobrepõe à posição congelada, e ela vem do cliente e não do
  -- sistema: item reagendado e vencido vai para o topo, pelo horário combinado.
  -- "Me liga terça às 10h" é a única promessa que a fila tem de cumprir.
  loop
    v_voltas := v_voltas + 1;
    exit when v_voltas > 50;

    select * into i
      from public.call_batch_items x
     where x.batch_id = b.id
       and x.status = 'fila'::app.call_item_status
       and (x.scheduled_at is null or x.scheduled_at <= now())
       and x.attempts < b.max_attempts
       and (x.last_attempt_at is null
            or x.last_attempt_at <= now() - make_interval(hours => b.min_hours_between_attempts))
     order by (x.scheduled_at is not null) desc, x.scheduled_at nulls last, x.position
     limit 1
       for update skip locked;

    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'fila_vazia', 'detalhe', null);
    end if;

    -- ----- guardrail: alguém pode ter pedido opt-out DEPOIS de o lote ser montado -----
    select * into v_org from public.organizations where id = i.organization_id;
    if v_org.deleted_at is not null
       or app.is_suppressed_target(i.organization_id, i.contact_id) then
      update public.call_batch_items x
         set status = 'devolvido'::app.call_item_status,
             reserved_until = null, reserved_by = null,
             note = coalesce(x.note, 'contato suprimido depois da montagem')
       where x.id = i.id;
      continue;
    end if;

    v_achou := true;
    exit;
  end loop;

  if not v_achou then
    return jsonb_build_object('ok', false, 'motivo', 'fila_vazia', 'detalhe', null);
  end if;

  -- ----- a reserva de trabalho -----
  update public.call_batch_items x
     set status = 'em_andamento'::app.call_item_status,
         reserved_until = now() + interval '30 minutes',
         reserved_by = v_uid
   where x.id = i.id
  returning * into i;

  if i.contact_id is not null then
    select * into v_contato from public.contacts where id = i.contact_id;
  end if;

  select count(*)::int into v_restam
    from public.call_batch_items x
   where x.batch_id = b.id
     and x.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status);

  -- Revelar o telefone é ato registrado (RF-BAS-14, RF-ADM-03), aqui como no reveal_phone.
  insert into public.pii_access_log (actor_id, actor_role, action, entity_type, entity_id, scope)
  values (v_uid, v_role::text, 'reveal_phone', 'organization', i.organization_id,
          jsonb_build_object('origem', 'proximo_da_fila', 'lote_id', b.id, 'item_id', i.id));

  return jsonb_build_object(
    'ok', true,
    'item', jsonb_build_object(
      'id',                i.id,
      'lote_id',           b.id,
      'organization_id',   i.organization_id,
      'nome',              v_org.name,
      'kind',              v_org.kind,
      'categoria',         (select c.name from public.organization_categories oc
                              join public.categories c on c.id = oc.category_id
                             where oc.organization_id = v_org.id
                             order by oc.is_primary desc limit 1),
      'bairro',            v_org.neighborhood,
      'cidade',            (select c.name from public.cities c where c.id = v_org.city_id),
      'telefone',          i.phone_e164,
      'contato_id',        i.contact_id,
      'contato_nome',      coalesce(v_contato.first_name, v_contato.full_name),
      'origem_slug',       (select s.slug from public.sources s where s.id = v_org.source_id),
      'origem_url',        v_org.source_url,
      'deal_id',           i.deal_id,
      'etapa_id',          i.stage_id,
      'etapa',             (select s.name from public.stages s where s.id = i.stage_id),
      'temperatura',       v_org.temperature,
      'status',            i.status,
      'posicao',           i.position,
      'tentativas',        i.attempts,
      'agendado_para',     i.scheduled_at,
      'ultima_tentativa_em', i.last_attempt_at,
      'reservado_ate',     i.reserved_until,
      'observacao',        i.note),
    'roteiro', jsonb_build_object(
      'id',     b.script_id,
      'versao', b.script_version,
      'arvore', (select s.arvore from public.call_scripts s where s.id = b.script_id)),
    'variante', case when v_org.kind in ('produtor'::app.org_kind, 'cerimonialista'::app.org_kind)
                     then 'produtor' else 'fornecedor' end,
    'restantes', v_restam,
    'fecha_em', v_janela -> 'fecha_em');
end $$;
comment on function public.proximo_da_fila(uuid) is
  'Entrega o próximo contato do lote com trava (for update skip locked), revela o telefone com registro em pii_access_log (RF-BAS-14) e recusa com motivo nomeado: fora_da_janela (domingo, feriado, antes/depois do horário — R13 §6), lote_encerrado, fora_do_periodo, lote_de_outro_dono, fila_vazia. Contato que virou suprimido depois da montagem sai do lote em vez de ser entregue (RF-CON-18).';
revoke all on function public.proximo_da_fila(uuid) from public, anon;
grant execute on function public.proximo_da_fila(uuid) to authenticated, service_role;


-- ===========================================================================
-- 13. Abrir a chamada (o botão "Ligar" / "Liguei")
-- ===========================================================================
-- SECURITY DEFINER pelo mesmo telefone: a tela precisa do E.164 para o `tel:`, e
-- quem o entrega registra a revelação. A janela recusa aqui de novo, porque entre
-- puxar o contato e discar podem passar 20 minutos e virar as 20h.
create or replace function public.iniciar_chamada(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   app.user_role;
  i        public.call_batch_items%rowtype;
  b        public.call_batches%rowtype;
  v_janela jsonb;
  v_org    public.organizations%rowtype;
  v_att    uuid;
  v_kind   app.org_kind;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_role := app.role();
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;

  select * into i from public.call_batch_items where id = p_item_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_expirada', 'detalhe', 'item_inexistente');
  end if;
  select * into b from public.call_batches where id = i.batch_id;
  if not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'item_de_outro_dono', 'detalhe', null);
  end if;
  if b.status <> 'ativo'::app.call_batch_status then
    return jsonb_build_object('ok', false, 'motivo', 'lote_encerrado', 'detalhe', b.status::text);
  end if;
  if i.status <> 'em_andamento'::app.call_item_status
     or i.reserved_by is distinct from v_uid
     or i.reserved_until is null or i.reserved_until < now() then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_expirada', 'detalhe', i.status::text);
  end if;

  v_janela := app.call_window(now());
  if not (v_janela ->> 'aberta')::boolean then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_janela',
                              'detalhe', v_janela ->> 'motivo', 'abre_em', v_janela -> 'abre_em');
  end if;

  if i.attempts >= b.max_attempts then
    return jsonb_build_object('ok', false, 'motivo', 'teto_de_tentativas', 'detalhe', b.max_attempts::text);
  end if;

  select * into v_org from public.organizations where id = i.organization_id;
  if v_org.deleted_at is not null or app.is_suppressed_target(i.organization_id, i.contact_id) then
    update public.call_batch_items x
       set status = 'devolvido'::app.call_item_status, reserved_until = null, reserved_by = null,
           note = coalesce(x.note, 'contato suprimido depois da montagem')
     where x.id = i.id;
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido', 'detalhe', null);
  end if;
  v_kind := v_org.kind;

  -- Chamada já aberta para este item (aba duplicada, toque duplo): devolve a mesma,
  -- em vez de abrir uma segunda tentativa e contar duas vezes.
  select a.id into v_att
    from public.call_attempts a
   where a.item_id = i.id and a.encerrada_em is null
   limit 1;

  if v_att is null then
    insert into public.call_attempts
      (item_id, batch_id, organization_id, contact_id, user_id, provedor,
       script_id, script_version, variante, iniciada_em)
    values
      (i.id, b.id, i.organization_id, i.contact_id, v_uid, 'manual',
       b.script_id, b.script_version,
       case when v_kind in ('produtor'::app.org_kind, 'cerimonialista'::app.org_kind)
            then 'produtor' else 'fornecedor' end,
       now())
    returning id into v_att;

    update public.call_batch_items x
       set attempts = x.attempts + 1,
           last_attempt_at = now(),
           reserved_until = now() + interval '30 minutes'
     where x.id = i.id;

    insert into public.pii_access_log (actor_id, actor_role, action, entity_type, entity_id, scope)
    values (v_uid, v_role::text, 'reveal_phone', 'organization', i.organization_id,
            jsonb_build_object('origem', 'iniciar_chamada', 'attempt_id', v_att));
  end if;

  return jsonb_build_object(
    'ok', true,
    'chamada', jsonb_build_object(
      'id',          v_att,
      'item_id',     i.id,
      'telefone',    i.phone_e164,
      'iniciada_em', (select a.iniciada_em from public.call_attempts a where a.id = v_att),
      'provedor',    'manual'));
end $$;
comment on function public.iniciar_chamada(uuid) is
  'Abre a tentativa de ligação (call_attempts), conta a tentativa, estende a reserva e devolve o telefone para o link tel: — com registro em pii_access_log. Recusa com motivo nomeado: fora_da_janela, contato_suprimido, teto_de_tentativas, reserva_expirada, item_de_outro_dono, lote_encerrado.';
revoke all on function public.iniciar_chamada(uuid) from public, anon;
grant execute on function public.iniciar_chamada(uuid) to authenticated, service_role;


-- ===========================================================================
-- 14. Tabular a chamada — e delegar a consequência a registrar_contato
-- ===========================================================================
-- SECURITY INVOKER de propósito. Esta é a função que ESCREVE consequência
-- comercial, e ela não pode ter mais poder do que quem a chama: quem faz etapa,
-- temperatura, próxima ação, cooldown e guardrail de supressão continua sendo
-- `public.registrar_contato` (migração 001200), que é invoker e aplica as políticas
-- do autor. Reimplementar qualquer uma dessas regras aqui seria criar uma segunda
-- verdade sobre a mesma decisão.
--
-- O que esta função acrescenta e a `/registrar` não tem:
--   * o EIXO TÉCNICO (R13 §3.3), que não é escolha de ninguém — o desfecho de uma
--     chamada não atendida vem de `app.outcome_for_call_result`, não da tela;
--   * a coerência dos dois eixos: sem atendimento não existe resultado comercial;
--   * o retorno do item para a FILA quando o desfecho pede nova tentativa;
--   * a idempotência da tabulação inteira (a mesma `client_key` da `/registrar`).
--
-- A JANELA NÃO É CHECADA AQUI, e isso é escolha: uma ligação que começou 19h58 é
-- tabulada 20h03, e recusar isso perderia o registro de uma conversa que aconteceu.
create or replace function public.tabular_chamada(
  p_client_key            uuid,
  p_chamada_id            uuid,
  p_item_id               uuid,
  p_resultado             app.call_result,
  p_com_quem              text        default 'nao_informado',
  p_outcome_id            int         default null,
  p_caminho_script        text[]      default '{}',
  p_duracao_seg           int         default 0,
  p_observacao            text        default null,
  p_capturas              jsonb       default '{}'::jsonb,
  p_agendar_para          timestamptz default null,
  p_lost_reason_id        int         default null,
  p_reuniao_em            timestamptz default null,
  p_reuniao_formato       text        default null,
  p_pediu_para_nao_ligar  boolean     default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  a           public.call_attempts%rowtype;
  b           public.call_batches%rowtype;
  o           public.interaction_outcomes%rowtype;
  -- O item é lido COLUNA A COLUNA, e não com %rowtype, porque esta função é
  -- SECURITY INVOKER e `call_batch_items.phone_e164` não é legível por sdr
  -- (RF-BAS-14, seção 9). `select *` aqui seria "permission denied for column",
  -- e contorná-lo com definer daria a esta função mais poder do que quem a chama.
  v_item_org  uuid;
  v_item_ct   uuid;
  v_item_deal uuid;
  v_item_st   app.call_item_status;
  v_item_tent int;
  v_slug      text;
  v_reg       jsonb;
  v_motivo    text;
  v_supr      boolean;
  v_volta     boolean := false;
  v_status    app.call_item_status;
  v_agenda    timestamptz;
  v_restam    int;
  v_activity  uuid;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('tabulado', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;

  select * into a from public.call_attempts where id = p_chamada_id;
  if not found then
    return jsonb_build_object('tabulado', false, 'motivo', 'chamada_ja_encerrada',
                              'detalhe', 'chamada_inexistente');
  end if;
  if a.item_id <> p_item_id then
    return jsonb_build_object('tabulado', false, 'motivo', 'item_de_outro_dono',
                              'detalhe', 'chamada_de_outro_item');
  end if;

  select x.organization_id, x.contact_id, x.deal_id, x.status, x.attempts
    into v_item_org, v_item_ct, v_item_deal, v_item_st, v_item_tent
    from public.call_batch_items x where x.id = a.item_id;
  select * into b from public.call_batches b2 where b2.id = a.batch_id;
  if not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('tabulado', false, 'motivo', 'item_de_outro_dono', 'detalhe', null);
  end if;
  if b.status = 'encerrado'::app.call_batch_status then
    return jsonb_build_object('tabulado', false, 'motivo', 'lote_encerrado', 'detalhe', null);
  end if;

  -- ----- idempotência: a fila offline reenvia -----
  if a.encerrada_em is not null then
    if a.client_key is not null and a.client_key = p_client_key then
      select count(*)::int into v_restam
        from public.call_batch_items x
       where x.batch_id = b.id
         and x.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status);
      return jsonb_build_object(
        'tabulado', true, 'repetido', true,
        'attempt_id', a.id, 'activity_id', a.activity_id,
        'item_status', v_item_st, 'volta_para_fila', v_item_st = 'fila'::app.call_item_status,
        'tentativas', v_item_tent,
        'proxima_acao_em', null, 'proxima_acao_titulo', null,
        'restantes', v_restam);
    end if;
    return jsonb_build_object('tabulado', false, 'motivo', 'chamada_ja_encerrada', 'detalhe', null);
  end if;

  -- ----- os dois eixos (R13 §3.3): sem atendimento não existe resultado comercial -----
  if p_resultado = 'atendida_humano'::app.call_result then
    if p_outcome_id is null then
      return jsonb_build_object('tabulado', false, 'motivo', 'eixos_incoerentes',
                                'detalhe', 'atendeu_sem_desfecho');
    end if;
    select * into o from public.interaction_outcomes
     where id = p_outcome_id and is_active
       and 'ligacao'::app.interaction_surface = any (surfaces);
    if not found then
      return jsonb_build_object('tabulado', false, 'motivo', 'desfecho_invalido', 'detalhe', null);
    end if;
    if not o.requires_answer then
      return jsonb_build_object('tabulado', false, 'motivo', 'eixos_incoerentes',
                                'detalhe', o.slug);
    end if;
  else
    if p_outcome_id is not null then
      return jsonb_build_object('tabulado', false, 'motivo', 'eixos_incoerentes',
                                'detalhe', 'sem_atendimento_com_desfecho');
    end if;
    v_slug := app.outcome_for_call_result(p_resultado);
    select * into o from public.interaction_outcomes where slug = v_slug and is_active;
    if not found then
      return jsonb_build_object('tabulado', false, 'motivo', 'desfecho_invalido', 'detalhe', v_slug);
    end if;
  end if;

  -- ----- a consequência sai de registrar_contato, não daqui -----
  v_reg := public.registrar_contato(
             p_client_key             => p_client_key,
             p_organization_id        => v_item_org,
             p_outcome_id             => o.id,
             p_com_quem               => p_com_quem,
             p_deal_id                => v_item_deal,
             p_occurred_at            => now(),
             p_body                   => p_observacao,
             p_duration_min           => nullif(round(coalesce(p_duracao_seg, 0) / 60.0)::int, 0),
             p_lost_reason_id         => p_lost_reason_id,
             p_meeting_at             => p_reuniao_em,
             p_meeting_format         => p_reuniao_formato,
             p_next_action_at         => p_agendar_para);

  if not (v_reg ->> 'registrado')::boolean then
    v_motivo := case v_reg ->> 'motivo'
                  when 'motivo_de_perda_obrigatorio' then 'motivo_de_perda_obrigatorio'
                  when 'reuniao_sem_data'            then 'reuniao_sem_data'
                  when 'sem_permissao'               then 'sem_permissao'
                  else 'desfecho_invalido'
                end;
    return jsonb_build_object('tabulado', false, 'motivo', v_motivo,
                              'detalhe', v_reg ->> 'motivo');
  end if;
  v_activity := nullif(v_reg ->> 'activity_id', '')::uuid;
  v_supr     := coalesce((v_reg ->> 'contato_suprimido')::boolean, false);

  -- ----- "não me ligue mais" (RF-CON-18) -----
  -- O consentimento é registrado DEPOIS do desfecho, e não no lugar dele: a
  -- atividade é a prova de que o pedido existiu, e app.consent_apply é quem marca
  -- do_not_contact, semeia a suppression_list e cancela as tarefas abertas.
  if p_pediu_para_nao_ligar then
    insert into public.consent_events (kind, organization_id, contact_id, channel,
                                       evidence_text, occurred_at, recorded_by)
    values ('contact_optout'::app.consent_kind, v_item_org, v_item_ct,
            'phone'::app.channel,
            coalesce(nullif(trim(p_observacao), ''), 'Pediu para não receber mais ligações.'),
            now(), v_uid);
    v_supr := true;
  end if;

  -- ----- fecha a tentativa -----
  update public.call_attempts x
     set encerrada_em   = now(),
         atendida_em    = case when p_resultado = 'atendida_humano'::app.call_result
                               then coalesce(x.atendida_em, now()) else x.atendida_em end,
         duracao_seg    = greatest(coalesce(p_duracao_seg, 0), 0),
         resultado      = p_resultado,
         outcome_id     = case when p_resultado = 'atendida_humano'::app.call_result then o.id end,
         activity_id    = v_activity,
         caminho_script = coalesce(p_caminho_script, '{}'),
         capturas       = coalesce(p_capturas, '{}'::jsonb),
         client_key     = p_client_key
   where x.id = a.id
  returning * into a;

  -- ----- o item volta para a fila? -----
  -- Quem decide é o CATÁLOGO, não a tela: desfecho cuja próxima ação é ligar de
  -- novo (`next_action_kind = 'call'`) e que não bloqueia o alvo (`can_reactivate`)
  -- pede outra tentativa. É o que cobre "não atendeu", "caixa postal" e "atendeu,
  -- retorna depois"; "número errado" (outra ação), "interessado", "agora não",
  -- "sem interesse" e "reunião marcada" encerram o item.
  v_volta := o.can_reactivate
             and o.next_action_kind = 'call'::app.task_kind
             and v_item_tent < b.max_attempts
             and not v_supr
             and b.ends_on >= (now() at time zone 'America/Fortaleza')::date;

  if v_volta then
    v_agenda := coalesce(p_agendar_para,
                         now() + make_interval(hours => b.min_hours_between_attempts));
    v_status := 'fila'::app.call_item_status;
  else
    v_agenda := null;
    v_status := case when v_supr then 'devolvido'::app.call_item_status
                     else 'concluido'::app.call_item_status end;
  end if;

  update public.call_batch_items x
     set status         = v_status,
         scheduled_at   = v_agenda,
         reserved_until = null,
         reserved_by    = null,
         note           = coalesce(nullif(trim(coalesce(p_observacao, '')), ''), x.note)
   where x.id = a.item_id
  returning x.status, x.attempts into v_item_st, v_item_tent;

  select count(*)::int into v_restam
    from public.call_batch_items x
   where x.batch_id = b.id
     and x.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status);

  return jsonb_build_object(
    'tabulado',            true,
    'repetido',            coalesce((v_reg ->> 'repetido')::boolean, false),
    'attempt_id',          a.id,
    'activity_id',         v_activity,
    'item_status',         v_item_st,
    'volta_para_fila',     v_volta,
    'tentativas',          v_item_tent,
    'proxima_acao_em',     v_reg -> 'proxima_acao_em',
    'proxima_acao_titulo', v_reg -> 'proxima_acao_titulo',
    'restantes',           v_restam,
    'outcome_slug',        o.slug,
    'contato_suprimido',   v_supr,
    'registro',            v_reg);
end $$;
comment on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                           text, jsonb, timestamptz, int, timestamptz, text, boolean) is
  'Fecha a tentativa de ligação com os dois eixos do R13 §3.3 e delega TODA a consequência comercial a public.registrar_contato (etapa, temperatura, próxima ação, cooldown, guardrail de supressão). Devolve o item à fila quando o desfecho do catálogo pede nova tentativa. Idempotente pela chave do cliente. Recusa prevista volta como {tabulado:false, motivo}.';
revoke all on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                              text, jsonb, timestamptz, int, timestamptz, text, boolean)
  from public, anon;
grant execute on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                                 text, jsonb, timestamptz, int, timestamptz, text, boolean)
  to authenticated, service_role;


-- ===========================================================================
-- 15. Devolver o item sem tabular (aba fechada, engano)
-- ===========================================================================
create or replace function public.devolver_item_do_lote(
  p_item_id uuid,
  p_motivo  text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  i     public.call_batch_items%rowtype;
  b     public.call_batches%rowtype;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into i from public.call_batch_items where id = p_item_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'item_inexistente');
  end if;
  select * into b from public.call_batches where id = i.batch_id;
  if not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'item_de_outro_dono');
  end if;

  -- Chamada aberta sem tabulação fecha SEM resultado: `resultado is null` numa
  -- tentativa encerrada é a marca honesta de "ninguém tabulou", e o relatório do
  -- R13 §7.7 a exclui sozinho ao filtrar por resultado.
  update public.call_attempts a
     set encerrada_em = now()
   where a.item_id = i.id and a.encerrada_em is null;

  update public.call_batch_items x
     set status = case when app.is_suppressed_target(i.organization_id, i.contact_id)
                       then 'devolvido'::app.call_item_status
                       else 'fila'::app.call_item_status end,
         reserved_until = null,
         reserved_by = null,
         note = coalesce(nullif(trim(coalesce(p_motivo, '')), ''), x.note)
   where x.id = i.id
  returning * into i;

  return jsonb_build_object('ok', true, 'item_id', i.id, 'item_status', i.status,
                            'tentativas', i.attempts);
end $$;
comment on function public.devolver_item_do_lote(uuid, text) is
  'Devolve à fila um item que estava em_andamento, sem tabular (aba fechada, engano), fechando a tentativa aberta sem resultado. Contato que virou suprimido sai do lote em vez de voltar à fila.';
revoke all on function public.devolver_item_do_lote(uuid, text) from public, anon;
grant execute on function public.devolver_item_do_lote(uuid, text) to authenticated, service_role;


-- ===========================================================================
-- 16. Privilégios (a RLS restringe LINHAS; o privilégio precisa existir)
-- ===========================================================================
grant select, insert, update, delete on public.call_scripts     to authenticated, service_role;
grant select, insert, update, delete on public.call_batches     to authenticated, service_role;
grant        insert, update, delete on public.call_batch_items  to authenticated;
grant select, insert, update, delete on public.call_batch_items to service_role;
grant select, insert, update, delete on public.call_attempts    to authenticated, service_role;
grant select on public.v_call_script_steps to authenticated, service_role;

revoke all on public.call_scripts        from anon;
revoke all on public.call_batches        from anon;
revoke all on public.call_batch_items    from anon;
revoke all on public.call_attempts       from anon;
revoke all on public.v_call_script_steps from anon;

-- Funções do schema `app`: EXECUTE nasce concedido a PUBLIC, e a revogação é
-- obrigatória em toda função nova (teste 09_seguranca_acesso).
revoke all on function app.call_window_hours(int)                     from public, anon;
revoke all on function app.instante_local(date, numeric)              from public, anon;
revoke all on function app.proxima_abertura(date)                     from public, anon;
revoke all on function app.call_window(timestamptz)                   from public, anon;
revoke all on function app.outcome_for_call_result(app.call_result)   from public, anon;
revoke all on function app.validar_roteiro(jsonb)                     from public, anon;
revoke all on function app.call_batch_is_visible(uuid)                from public, anon;
revoke all on function app.call_batch_is_mine(uuid)                   from public, anon;
grant execute on function app.call_window_hours(int)                   to authenticated, service_role;
grant execute on function app.instante_local(date, numeric)            to authenticated, service_role;
grant execute on function app.proxima_abertura(date)                   to authenticated, service_role;
grant execute on function app.call_window(timestamptz)                 to authenticated, service_role;
grant execute on function app.outcome_for_call_result(app.call_result) to authenticated, service_role;
grant execute on function app.validar_roteiro(jsonb)                   to authenticated, service_role;
grant execute on function app.call_batch_is_visible(uuid)              to authenticated, service_role;
grant execute on function app.call_batch_is_mine(uuid)                 to authenticated, service_role;

-- Funções de gatilho não são superfície de API (padrão da 000500).
revoke all on function app.call_scripts_validate()      from public, anon, authenticated;
revoke all on function app.call_batches_refresh_counts() from public, anon, authenticated;
revoke all on function app.call_batches_on_close()      from public, anon, authenticated;

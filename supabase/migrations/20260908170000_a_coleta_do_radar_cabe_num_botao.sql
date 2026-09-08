-- =====================================================================
-- 20260908170000 — A coleta do Radar cabe num botão
--
-- A esteira inteira existe desde a 20260904001600 e o catálogo de coleta desde
-- a 20260904001802. O que nunca existiu foi o começo dela: nada, em lugar
-- nenhum do produto, ENFILEIRA um `ingest_jobs`. `esteira_abrir_lote` só cria a
-- linha em `import_batches` — o lote nasce em `previa` e fica ali, porque quem
-- chama essa função hoje é a importação de planilha, e planilha continua pela
-- prévia por desenho (ninguém grava 400 linhas sem ver antes).
--
-- Coleta não tem prévia: o que se pede é "vá buscar", e o que volta é a fila de
-- revisão. Até agora, para pedir isso, era preciso montar o payload da fila à
-- mão e chamar `esteira_fila_enfileirar` por psql com service_role — foi assim
-- que os 42 cerimonialistas entraram na base em 08/09. Isso não é operável por
-- quem usa o CRM, e é exatamente a lacuna que esta migração fecha.
--
-- `public.radar_coletar_agora(int, text[], int)` faz as duas coisas numa
-- transação só: abre o lote e enfileira o job. As duas juntas, ou nenhuma — um
-- lote aberto sem job na fila é um lote que fica em `previa` para sempre, e foi
-- o que aconteceu no lote de teste.
--
-- Sete recusas nomeadas, todas ANTES de qualquer escrita:
--
--   sem_permissao          quem não escreve na base não manda coletar.
--   origem_invalida        id que não existe.
--   origem_desabilitada    fonte desligada. Ligar exige robots.txt e termos
--                          avaliados (`radar_alternar_fonte`), então esta
--                          checagem carrega a checagem legal junto.
--   coletor_desligado      `config.collector.enabled` falso: a fonte vale como
--                          origem de cadastro, mas ninguém escreveu o adaptador
--                          dela no worker. Pedir coleta aqui é enfileirar
--                          trabalho que vai falhar na outra ponta.
--   sem_catalogo           `config.collector.catalogo` vazio: não há caminho
--                          para buscar. Falha aqui, e não no worker, porque
--                          aqui a pessoa ainda está olhando a tela.
--   categoria_fora_do_catalogo   pediram categoria que a fonte não tem. O
--                          worker também recusa (etapas.ts), mas recusar aqui
--                          devolve a lista do que existe em vez de um lote
--                          morto.
--   ja_rodando             já há lote desta fonte em `na_fila` ou `rodando`.
--                          Duas coletas simultâneas na mesma fonte dobram o
--                          tráfego contra o limite por fonte do R03 — o que o
--                          robots.txt permite é uma, não duas.
--
-- A idempotência é a que a esteira já usa: a chave do job é `job:<batch_id>`, e
-- como o batch_id nasce aqui, cada chamada é um job novo. O que impede repetir
-- sem querer é o `ja_rodando`, não a chave.
-- =====================================================================

create or replace function public.radar_coletar_agora(
  p_source_id   int,
  p_categorias  text[] default null,
  p_max_paginas int    default 1
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s          public.sources;
  v_catalogo   jsonb;
  v_do_catalogo text[];
  v_pedidas    text[];
  v_faltando   text[];
  v_rodando    uuid;
  v_abertura   jsonb;
  v_batch      uuid;
  v_fila       jsonb;
  v_paginas    int := least(greatest(coalesce(p_max_paginas, 1), 1), 50);
  v_rotulo     text;
begin
  -- Mesmo padrão de `esteira_abrir_lote`: sem JWT (ligação direta ao banco, que
  -- já é acesso total) passa; com JWT, só quem escreve na base. `can_write`
  -- sozinho responderia "não" para o próprio psql do operador, porque ele lê a
  -- claim `role` que só o PostgREST põe.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into v_s from public.sources where id = p_source_id;
  if v_s.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'origem_invalida');
  end if;

  if not v_s.is_enabled then
    return jsonb_build_object('ok', false, 'motivo', 'origem_desabilitada',
                              'fonte', v_s.name);
  end if;

  if coalesce((v_s.config -> 'collector' ->> 'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'motivo', 'coletor_desligado',
                              'fonte', v_s.name);
  end if;

  v_catalogo := coalesce(v_s.config -> 'collector' -> 'catalogo', '[]'::jsonb);
  if jsonb_array_length(v_catalogo) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sem_catalogo',
                              'fonte', v_s.name);
  end if;

  select array_agg(distinct e ->> 'categoria_origem')
    into v_do_catalogo
    from jsonb_array_elements(v_catalogo) e
   where e ->> 'categoria_origem' is not null;

  -- Sem categoria pedida, o lote é o catálogo inteiro. Com categoria pedida,
  -- todas precisam existir: pedir três e receber duas silenciosamente é como o
  -- lote mente sobre o que cobriu.
  v_pedidas := nullif(p_categorias, '{}'::text[]);
  if v_pedidas is not null then
    select array_agg(c) into v_faltando
      from unnest(v_pedidas) c
     where not (c = any (coalesce(v_do_catalogo, '{}'::text[])));
    if v_faltando is not null then
      return jsonb_build_object('ok', false, 'motivo', 'categoria_fora_do_catalogo',
                                'fonte', v_s.name,
                                'faltando', to_jsonb(v_faltando),
                                'disponiveis', to_jsonb(coalesce(v_do_catalogo, '{}'::text[])));
    end if;
  end if;

  select b.id into v_rodando
    from public.import_batches b
   where b.source_id = p_source_id
     and b.kind = 'coleta'
     and b.status in ('na_fila', 'rodando')
   order by b.created_at desc
   limit 1;
  if v_rodando is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_rodando',
                              'fonte', v_s.name, 'batch_id', v_rodando);
  end if;

  v_rotulo := v_s.name || ' — ' ||
              case when v_pedidas is null then 'catálogo inteiro'
                   else array_to_string(v_pedidas, ', ') end ||
              ' — ' || to_char(timezone('America/Fortaleza', now()), 'DD/MM HH24:MI');

  v_abertura := public.esteira_abrir_lote(
    'coleta', p_source_id, v_rotulo,
    jsonb_build_object('categorias', case when v_pedidas is null then null
                                          else to_jsonb(v_pedidas) end,
                       'max_paginas', v_paginas)
  );
  if coalesce((v_abertura ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'motivo', coalesce(v_abertura ->> 'reason', 'lote_recusado'));
  end if;
  v_batch := (v_abertura ->> 'batch_id')::uuid;

  v_fila := app.esteira_enfileirar(
    'ingest_jobs',
    jsonb_build_object(
      'chave',       'job:' || v_batch::text,
      'batch_id',    v_batch,
      'source_id',   p_source_id,
      'categorias',  case when v_pedidas is null then null else to_jsonb(v_pedidas) end,
      'max_paginas', v_paginas
    ),
    'job:' || v_batch::text,
    v_batch
  );

  -- O lote nasce em `previa` (é o default, e é o certo para planilha). Coleta
  -- não passa por prévia: assim que o job entra na fila, o estado que descreve
  -- a verdade é `na_fila`. Se o enfileiramento não aconteceu, a transação
  -- inteira volta atrás — não fica lote órfão.
  if coalesce((v_fila ->> 'enfileirado')::boolean, false) is not true then
    raise exception 'Coleta não entrou na fila (%): a abertura do lote foi desfeita.',
      coalesce(v_fila ->> 'motivo', 'motivo desconhecido') using errcode = '55000';
  end if;

  update public.import_batches
     set status = 'na_fila', started_at = now()
   where id = v_batch;

  return jsonb_build_object(
    'ok', true,
    'batch_id', v_batch,
    'fonte', v_s.name,
    'rotulo', v_rotulo,
    'categorias', case when v_pedidas is null then to_jsonb(coalesce(v_do_catalogo, '{}'::text[]))
                       else to_jsonb(v_pedidas) end,
    'max_paginas', v_paginas,
    -- O worker é quem busca de verdade, e ele roda na máquina dedicada. Dizer
    -- isto na resposta é o que separa "o pedido entrou" de "os dados chegaram":
    -- com o coletor parado, o lote fica na fila até alguém ligar a máquina.
    'coletor_de_pe', exists (
      select 1 from public.worker_heartbeats h
       where h.worker = 'ingest' and h.last_beat_at > now() - interval '5 minutes'
    )
  );
end
$$;

comment on function public.radar_coletar_agora(int, text[], int) is
  'Pede uma coleta ao Radar: abre o lote e enfileira o job de ingestão na mesma transação. Recusa nomeada (sem_permissao, origem_invalida, origem_desabilitada, coletor_desligado, sem_catalogo, categoria_fora_do_catalogo, ja_rodando) antes de qualquer escrita. Devolve batch_id e se o coletor está de pé — sem worker, o lote espera na fila.';

revoke all on function public.radar_coletar_agora(int, text[], int) from public;
grant execute on function public.radar_coletar_agora(int, text[], int) to authenticated, service_role;

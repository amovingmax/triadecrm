-- =====================================================================
-- Agendar coleta deixa de ser comando de terminal
--
-- O Radar tinha um buraco de operação: só quem abrisse um terminal e soubesse
-- escrever `ingest --agendar --fonte=<slug> --paginas=N` conseguia mandar o
-- coletor trabalhar. A tela mostrava a fila vazia e o coletor parado, e quem
-- olhava concluía — com razão — que o Radar estava quebrado. Em 17/09/2026 a
-- última coleta tinha 9 dias.
--
-- Agendar é DUAS chamadas no banco: abrir o lote (`esteira_abrir_lote`) e pôr a
-- ordem na fila (`esteira_fila_enfileirar`). A segunda é `service_role`, então o
-- navegador não alcança. Esta função junta as duas atrás de uma porta só.
--
-- =====================================================================
-- QUEM PODE, E POR QUE NÃO É "QUEM ESCREVE"
-- =====================================================================
-- Abrir lote aceita qualquer papel que escreve na base (sdr e embaixador
-- inclusive). Agendar coleta é outra coisa: gasta o limite de requisições que a
-- fonte nos concede, hospeda uma visita nossa no servidor dela e responde pelo
-- robots.txt e pelos termos (R03, R06 §3). Isso é decisão de operação, não de
-- campo — fica com admin e gestor.
--
-- =====================================================================
-- A TRAVA DO CLIQUE DUPLO
-- =====================================================================
-- Duas coletas simultâneas na mesma fonte dobram o tráfego que prometemos
-- respeitar, e o segundo clique nervoso é o jeito mais fácil de isso acontecer.
-- Se já existe lote dessa fonte esperando ou rodando, a função recusa e diz
-- qual — em vez de abrir o segundo em silêncio.
-- =====================================================================

create or replace function public.radar_agendar_coleta(
  p_source_id   int,
  p_categorias  text[] default null,
  p_max_paginas int default 1,
  p_rotulo      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fonte    public.sources;
  v_lote     jsonb;
  v_id       uuid;
  v_fila     jsonb;
  v_rotulo   text;
  v_paginas  int;
  v_aberto   uuid;
begin
  if app.role() not in ('admin'::app.user_role, 'gestor'::app.user_role) then
    raise exception 'Papel % não agenda coleta do Radar', app.role() using errcode = '42501';
  end if;

  select * into v_fonte from public.sources where id = p_source_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'fonte_inexistente');
  end if;
  if not v_fonte.is_enabled then
    return jsonb_build_object('ok', false, 'motivo', 'fonte_desligada');
  end if;

  -- Uma coleta por fonte de cada vez (ver a nota do clique duplo).
  select b.id into v_aberto
    from public.import_batches b
   where b.source_id = p_source_id
     and b.kind = 'coleta'
     and b.status in ('previa', 'na_fila', 'rodando')
   order by b.created_at desc
   limit 1;
  if v_aberto is not null then
    return jsonb_build_object('ok', false, 'motivo', 'coleta_em_andamento', 'lote', v_aberto);
  end if;

  -- O teto de páginas é do produto, não do pedido: 10 páginas por categoria já
  -- é uma visita longa numa fonte que nos deixa entrar por educação.
  v_paginas := least(greatest(coalesce(p_max_paginas, 1), 1), 10);
  v_rotulo  := nullif(trim(coalesce(p_rotulo, '')), '');
  if v_rotulo is null then
    v_rotulo := 'Coleta ' || v_fonte.name || ' de ' ||
                to_char((now() at time zone 'America/Fortaleza')::date, 'DD/MM/YYYY');
  end if;

  v_lote := public.esteira_abrir_lote(
    'coleta', p_source_id, v_rotulo,
    jsonb_build_object(
      'categorias', coalesce(to_jsonb(p_categorias), '"catálogo completo"'::jsonb),
      'max_paginas_por_categoria', v_paginas,
      'agente', 'tela'));

  if not coalesce((v_lote ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', coalesce(v_lote ->> 'reason', 'lote_recusado'));
  end if;
  v_id := (v_lote ->> 'batch_id')::uuid;

  -- O payload é o MESMO que `ingest --agendar` monta (apps/workers/src/ingest/
  -- etapas.ts → agendarColeta). O worker não sabe nem precisa saber se a ordem
  -- veio da tela ou do terminal.
  v_fila := public.esteira_fila_enfileirar(
    'ingest_jobs',
    jsonb_build_object(
      'chave', 'job:' || v_id,
      'batch_id', v_id,
      'source_id', p_source_id,
      'categorias', case when p_categorias is null or cardinality(p_categorias) = 0
                         then null else to_jsonb(p_categorias) end,
      'max_paginas', v_paginas),
    'job:' || v_id,
    v_id,
    0);

  if not coalesce((v_fila ->> 'enfileirado')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', 'fila_recusou', 'lote', v_id);
  end if;

  update public.import_batches set status = 'na_fila' where id = v_id;

  return jsonb_build_object('ok', true, 'lote', v_id, 'rotulo', v_rotulo,
                            'fonte', v_fonte.name, 'max_paginas', v_paginas);
end $$;

comment on function public.radar_agendar_coleta(int, text[], int, text) is
  'Agenda uma coleta do Radar pela tela: abre o lote e põe a ordem na fila ingest_jobs, com o mesmo payload de `ingest --agendar`. Só admin e gestor (a coleta gasta o limite da fonte e responde pelo robots.txt). Recusa quando já há lote da mesma fonte esperando ou rodando.';

revoke all on function public.radar_agendar_coleta(int, text[], int, text) from public, anon;
grant execute on function public.radar_agendar_coleta(int, text[], int, text) to authenticated, service_role;

-- =====================================================================
-- 20260904001800 — Correções de esteira apontadas pela suíte e pelo `supabase db lint`
--
-- 1) `public.esteira_saude()` estava declarada STABLE e chama `pgmq.metrics()`,
--    que é VOLATILE. O lint acusa ("routine is marked as STABLE, but expression
--    is VOLATILE") e tem razão: uma função STABLE promete o mesmo resultado
--    dentro do mesmo comando, e o planejador pode aproveitar essa promessa para
--    executá-la uma vez só. Profundidade de fila é justamente o número que muda
--    debaixo do pé — e a tela do Radar existe para mostrar essa mudança. Aqui a
--    declaração passa a dizer a verdade (VOLATILE), em vez de o corpo ser
--    espremido para caber numa promessa que ele não cumpre.
--
--    Nada mais muda: mesmo corpo, mesma assinatura, mesmas permissões
--    (CREATE OR REPLACE preserva dono e grants; eles são reafirmados no fim
--    por clareza, e porque a migração precisa poder ser lida sozinha).
--
-- 2) `public.esteira_desfazer_lote` tratava o NASCIMENTO do negócio como
--    "alguém tocou nesta ficha" e por isso nunca removia nada. Detalhe abaixo.
-- =====================================================================

create or replace function public.esteira_saude()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_workers jsonb;
  v_filas   jsonb := '[]'::jsonb;
  v_q       record;
  v_m       record;
begin
  if not app.can_write() then
    raise exception 'Papel % não lê a saúde da esteira', app.role() using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'worker', h.worker, 'instancia', h.instance, 'status', h.status,
           'fila', h.queue, 'versao', h.version, 'host', h.host,
           'ultima_batida', h.last_beat_at,
           'ha_segundos', floor(extract(epoch from (now() - h.last_beat_at)))::int,
           -- Dois minutos sem batida com a batida esperada a cada 30 s: é parado,
           -- não é lento. A tela precisa de um veredito, não de um timestamp.
           'vivo', (now() - h.last_beat_at) < interval '2 minutes',
           'processados', h.processed_total, 'falhas', h.failed_total)
           order by h.worker, h.instance), '[]'::jsonb)
    into v_workers
    from public.worker_heartbeats h;

  for v_q in select name from public.ingest_queues order by name loop
    select * into v_m from pgmq.metrics(v_q.name);
    v_filas := v_filas || jsonb_build_array(jsonb_build_object(
      'fila', v_q.name,
      'na_fila', coalesce(v_m.queue_length, 0),
      'visiveis', coalesce(v_m.queue_visible_length, 0),
      'mais_antigo_segundos', v_m.oldest_msg_age_sec,
      'total_ja_enfileirado', coalesce(v_m.total_messages, 0)));
  end loop;

  return jsonb_build_object(
    'workers', v_workers,
    'filas', v_filas,
    'coletor_vivo', exists (select 1 from public.worker_heartbeats h
                             where h.worker = 'ingest' and h.status = 'ok'
                               and (now() - h.last_beat_at) < interval '2 minutes'),
    'lotes_rodando', (select count(*) from public.import_batches b where b.status = 'rodando'),
    'capturas_por_expurgar', (select count(*) from public.raw_capture rc
                               where rc.purge_after < (now() at time zone 'America/Fortaleza')::date),
    'registros_por_resolver', (select count(*) from public.source_record sr where sr.candidate_id is null),
    'ultimo_expurgo', (select r.ran_at from public.retention_runs r order by r.ran_at desc limit 1)
  );
end $$;

comment on function public.esteira_saude() is
  'Saúde da esteira para a tela do Radar: batidas de ponto dos workers com veredito de vivo/parado, profundidade das quatro filas, lotes rodando, capturas por expurgar, registros por resolver e último expurgo. VOLATILE de propósito: lê pgmq.metrics(), que muda a cada chamada.';

revoke all on function public.esteira_saude() from public, anon;
grant execute on function public.esteira_saude() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2) `public.esteira_desfazer_lote` nunca removia nada (RF-BAS-17)
--
-- A regra "só remove o que ninguém tocou" olhava para a EXISTÊNCIA de linha em
-- `deal_stage_history`. Só que `app.deals_track_stage` grava uma linha no INSERT
-- do negócio — o nascimento, com `from_stage_id` nulo. Como a esteira sempre
-- cria a ficha junto com o negócio, toda ficha importada nascia "tocada" e o
-- desfazer devolvia `organizacoes_removidas: 0` para qualquer lote. A janela de
-- 48 h do RF-BAS-17 existia no papel e não existia no banco.
--
-- Aqui a condição passa a olhar para MOVIMENTO (`from_stage_id is not null`).
-- Nada mais afrouxa: atividade humana, consentimento e tentativa de ligação
-- continuam prendendo a ficha exatamente como antes.
-- ---------------------------------------------------------------------------
create or replace function public.esteira_desfazer_lote(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b      public.import_batches;
  v_orgs   uuid[];
  v_n_org  int := 0;
  v_n_cand int := 0;
  v_n_deal int := 0;
  v_presos int := 0;
begin
  if not app.is_manager() then
    raise exception 'Papel % não desfaz importação', app.role() using errcode = '42501';
  end if;
  select * into v_b from public.import_batches where id = p_batch_id for update;
  if v_b.id is null then
    return jsonb_build_object('ok', false, 'reason', 'lote_inexistente');
  end if;
  if v_b.status = 'desfeito' then
    return jsonb_build_object('ok', true, 'ja_estava', true);
  end if;
  if now() > v_b.can_undo_until then
    return jsonb_build_object('ok', false, 'reason', 'janela_de_48h_encerrada',
                              'expirou_em', v_b.can_undo_until);
  end if;

  -- Intocadas: sem atividade que não seja a do próprio lote, sem consentimento,
  -- sem mensagem, sem tentativa de ligação e ainda na etapa em que nasceram.
  --
  -- "Ainda na etapa em que nasceram" é `from_stage_id is not null`, e não a mera
  -- existência de linha em deal_stage_history: o gatilho app.deals_track_stage
  -- grava o NASCIMENTO de todo negócio (from_stage_id nulo, to_stage_id = etapa
  -- inicial). Perguntar só "existe histórico?" marcava como tocada toda ficha
  -- que a esteira acabara de criar — porque a esteira cria a ficha COM negócio —
  -- e o desfazer do RF-BAS-17 passava a devolver zero para qualquer lote real.
  -- Nascer não é ter sido movido; o que prende a ficha é alguém ter mexido nela.
  select coalesce(array_agg(o.id), '{}') into v_orgs
    from public.organizations o
   where o.import_batch_id = p_batch_id
     and not exists (select 1 from public.activities a
                      where a.organization_id = o.id and a.type <> 'system')
     and not exists (select 1 from public.consent_events ce where ce.organization_id = o.id)
     and not exists (select 1 from public.deal_stage_history h
                      join public.deals d on d.id = h.deal_id
                     where d.organization_id = o.id
                       and h.from_stage_id is not null)
     and not exists (select 1 from public.call_attempts ca where ca.organization_id = o.id);

  select count(*) into v_presos
    from public.organizations o
   where o.import_batch_id = p_batch_id and not (o.id = any (v_orgs));

  delete from public.deals d where d.organization_id = any (v_orgs);
  get diagnostics v_n_deal = row_count;
  delete from public.organizations o where o.id = any (v_orgs);
  get diagnostics v_n_org = row_count;
  delete from public.supplier_candidates c
   where c.import_batch_id = p_batch_id and c.status = 'novo';
  get diagnostics v_n_cand = row_count;

  update public.import_batches
     set status = 'desfeito', finished_at = now(),
         stats = stats || jsonb_build_object('desfeito_em', now(),
                                             'organizacoes_removidas', v_n_org,
                                             'negocios_removidos', v_n_deal,
                                             'candidatos_removidos', v_n_cand,
                                             'fichas_preservadas', v_presos)
   where id = p_batch_id;

  return jsonb_build_object('ok', true, 'organizacoes_removidas', v_n_org,
                            'negocios_removidos', v_n_deal,
                            'candidatos_removidos', v_n_cand,
                            'fichas_preservadas', v_presos);
end $$;
comment on function public.esteira_desfazer_lote(uuid) is
  'Desfaz um lote dentro da janela de 48 h (RF-BAS-17). Só remove o que o lote criou e ninguém tocou: ficha com atividade humana, MUDANÇA de etapa (o nascimento do negócio não conta), consentimento ou ligação fica de pé e é contada em "fichas_preservadas".';

revoke all on function public.esteira_desfazer_lote(uuid) from public, anon;
grant execute on function public.esteira_desfazer_lote(uuid) to authenticated, service_role;

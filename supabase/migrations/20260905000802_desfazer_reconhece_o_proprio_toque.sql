-- =====================================================================
-- O desfazer de 48 h passa a reconhecer o PRÓPRIO toque (RF-BAS-17)
-- Laudo da varredura §3.6 e §4.3.
--
-- O QUE ESTAVA ERRADO
--
-- `public.esteira_desfazer_lote` só removia a ficha que não tivesse NENHUMA
-- atividade de tipo diferente de `system`. Só que `public.importacao_gravar`
-- grava, para toda linha da planilha que traga "último contato", uma atividade
-- de NOTA na ficha que ela mesma acabou de criar — um instante antes, na mesma
-- transação (migração 20260904001820, seção (d)). A planilha-ponte PEDE a
-- coluna "último contato": na prática, toda ficha nascia "tocada".
--
-- Medido no banco local em 05/09/2026, importando a planilha-ponte preenchida
-- (68 linhas): 33 fichas criadas, 33 notas com `origin = importacao_planilha`,
-- e o desfazer respondendo
--   {"organizacoes_removidas": 0, "fichas_preservadas": 33}.
-- A tela então dizia "0 fichas removidas; 33 ficaram de pé porque alguém já
-- trabalhou" — e ninguém tinha trabalhado. O RF-BAS-17 existia no código e não
-- existia na operação.
--
-- A precisão que a verificação do laudo acrescentou, e que muda o conserto: o
-- desfazer FUNCIONAVA para a linha sem "último contato". A causa não era "o
-- desfazer está quebrado"; era "o importador toca a ficha e o desfazer não sabe
-- reconhecer o próprio toque". É por isso que aqui não se afrouxa a regra: só
-- se ensina a ela a diferença entre o toque do lote e o toque de gente.
--
-- O QUE MUDA (uma condição, e nada mais)
--
-- A nota do importador já se identifica: `metadata->>'origin'` é
-- `importacao_planilha` e `metadata->>'batch_id'` é o lote que a escreveu. A
-- condição passa a ignorar EXATAMENTE essa nota — deste lote, e de nenhum
-- outro. Continuam prendendo a ficha, como antes:
--   · qualquer nota escrita por gente;
--   · a nota de importação de OUTRO lote (desfazer um lote não pode apagar o
--     registro de uma importação anterior);
--   · consentimento registrado;
--   · movimento de etapa (`from_stage_id is not null`, da migração
--     20260904001800);
--   · tentativa de ligação.
--
-- Esta é a terceira e última pedra do mesmo defeito: 20260904001800 tirou o
-- NASCIMENTO do negócio da conta de "tocada"; esta tira o NASCIMENTO da nota
-- da importação. Ambas são o mesmo engano — confundir o que o próprio lote
-- escreveu com trabalho humano.
--
-- Idempotente: `create or replace`, sem mudança de assinatura nem de dados.
-- =====================================================================

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

  -- Intocadas: sem atividade de gente, sem consentimento, sem tentativa de
  -- ligação e ainda na etapa em que nasceram.
  --
  -- "Sem atividade de gente" ignora a nota que o PRÓPRIO lote escreveu ao
  -- importar (`origin = importacao_planilha` E `batch_id` deste lote). Ela é o
  -- histórico que a planilha trouxe, não uma conversa que aconteceu depois; e
  -- some junto com a ficha, por cascade. A nota de qualquer outro lote continua
  -- prendendo a ficha: desfazer ESTE lote não pode apagar o registro de uma
  -- importação anterior.
  --
  -- Os `coalesce` não são enfeite: nota escrita por gente tem `metadata` sem
  -- `origin`, e `not (null = ... and ...)` é NULL, não TRUE. Sem eles a ficha
  -- com conversa registrada passava a ser removida — o erro oposto, e pior.
  -- (Visto falhar: o pgTAP 33 apagou a ficha com nota humana antes do coalesce.)
  --
  -- "Ainda na etapa em que nasceram" é `from_stage_id is not null`, e não a mera
  -- existência de linha em deal_stage_history: o gatilho app.deals_track_stage
  -- grava o NASCIMENTO de todo negócio (from_stage_id nulo, to_stage_id = etapa
  -- inicial). Nascer não é ter sido movido; o que prende a ficha é alguém ter
  -- mexido nela.
  select coalesce(array_agg(o.id), '{}') into v_orgs
    from public.organizations o
   where o.import_batch_id = p_batch_id
     and not exists (select 1 from public.activities a
                      where a.organization_id = o.id
                        and a.type <> 'system'
                        and not (coalesce(a.metadata ->> 'origin', '') = 'importacao_planilha'
                                 and coalesce(a.metadata ->> 'batch_id', '') = p_batch_id::text))
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
  'Desfaz um lote dentro da janela de 48 h (RF-BAS-17). Só remove o que o lote criou e ninguém tocou DEPOIS: a nota que o próprio importador escreveu não conta como toque; nota de gente, nota de outro lote, consentimento, movimento de etapa ou ligação prendem a ficha, que é contada em "fichas_preservadas".';

revoke all on function public.esteira_desfazer_lote(uuid) from public, anon;
grant execute on function public.esteira_desfazer_lote(uuid) to authenticated, service_role;

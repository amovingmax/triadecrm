-- =============================================================================
-- Dois índices que as consultas do dia já pediam (20/10/2026)
-- =============================================================================
-- 1. A lista de Conversas lê as últimas atividades com ficha
--    (`activities ... where organization_id is not null order by occurred_at desc
--    limit 3000`, em `apps/web/src/components/conversas/dados.ts`) a cada vez que
--    é recarregada. Nenhum índice servia essa ordem global — os que existem
--    começam pela ficha ou pela pessoa —, então o Postgres varria a tabela inteira
--    e ordenava. É a tabela que mais cresce no CRM.
--
-- 2. Metas (`public.goal_progress`) e Relatórios filtram e ordenam o histórico de
--    etapas por `changed_at`, que só aparecia indexado depois de `deal_id`.
--
-- Banco local, 60 mil atividades e 30 mil mudanças de etapa (transação desfeita):
-- a leitura da lista foi de varredura + ordenação (4,5 ms) a leitura direta do
-- índice (0,27 ms); a semana do histórico, de 2,3 ms a 0,7 ms.
--
-- Só acrescenta: nenhuma consulta muda de resultado. Pode rodar de novo sem efeito.
-- =============================================================================

create index if not exists activities_ultimas_com_ficha
  on public.activities (occurred_at desc)
  where organization_id is not null;

create index if not exists deal_stage_history_quando_idx
  on public.deal_stage_history (changed_at);

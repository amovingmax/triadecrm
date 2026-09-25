-- =====================================================================
-- A Revisão fica, o coletor sai (Fase 2 do pivô, ADR-12)
--
-- POR QUE ESTA MIGRAÇÃO EXISTE. `supabase/migrations/` é histórico: nenhuma
-- migração antiga é apagada ou reescrita. O que o coletor deixou no banco sai
-- por uma migração NOVA, e ela vem DEPOIS da 20260925130000 de propósito — o
-- interruptor antes da tesoura. Aquele `update` era reversível; este arquivo é
-- o que fecha a porta, porque o código que consumia estas funções saiu do
-- repositório nos commits anteriores deste mesmo PR.
--
-- O QUE SAI, E O QUE FICA DE PÉ
-- Saem as três funções que a tela de fontes chamava. `drop function` leva junto
-- os `grant`/`revoke` delas.
-- FICAM de propósito: `public.esteira_fila_enfileirar/ler/concluir/falhar` e
-- `public.esteira_estado_lote` (20260904001802), que são encanamento genérico
-- usado por `app.dlq_drenar` (20260905000803); e `public.esteira_abrir_lote`,
-- que a IMPORTAÇÃO chama direto e é por onde o CSV do Maps entra. Ficam também
-- os nomes de banco do Radar — supplier_candidates, radar_fila, radar_resumo,
-- radar_criar_candidato, radar_revisar_candidato, radar_repontuar,
-- app.radar_pontuar. Renomear custaria grant/revoke refeitos, tipos regerados,
-- cinco arquivos de teste e uma migração de compatibilidade, para zero ganho de
-- usuário: o nome do banco é ledger, o nome da tela é produto.
--
-- O CATÁLOGO DE COLETA. As 18 listagens em `config->collector->catalogo` do
-- Casamentos são INSTRUÇÕES DE COLETA — em que caminho o worker entrava e em que
-- ordem. Sem worker, é dado morto que ainda parece configuração viva. Sai junto
-- o `collector.agente` (o user-agent com que o worker se identificava). A LINHA
-- DA FONTE FICA, com terms_notes, robots e base legal: ela é a proveniência dos
-- 260 candidatos que vieram de lá (RF-RAD-05).
-- CONSEQUÊNCIA, ESCRITA PARA NÃO SURPREENDER NINGUÉM: a partir daqui, religar a
-- fonte com `is_enabled = true` NÃO traz a coleta de volta. As instruções de
-- onde colher foram embora com o código que as lia.
--
-- DEPOIS DE APLICAR, REGERAR OS TIPOS. As três funções estão em
-- `packages/schema/src/database.types.ts`. `pnpm db:types` é passo obrigatório
-- do PR — sem ele sobra tipo fantasma e o typecheck aceita uma chamada `.rpc()`
-- para função que o banco já não tem.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. As três funções do catálogo de fontes
-- ---------------------------------------------------------------------
drop function if exists public.radar_coletar_agora(int, text[], int);
drop function if exists public.radar_agendar_coleta(int, text[], int, text);
drop function if exists public.radar_alternar_fonte(int, boolean);

-- ---------------------------------------------------------------------
-- 2. O resumo do topo perde os três números de fonte
--
-- `public.radar_resumo()` tem UMA definição (20260904001401) e devolve `jsonb`,
-- então tirar três campos não mexe na assinatura — nenhum `grant` precisa ser
-- refeito. Os três diziam quantas fontes existem, quantas estão ligadas e
-- quantas têm coletor pronto; a tela que os mostrava (a contagem da aba
-- "Fontes") saiu.
-- ---------------------------------------------------------------------
create or replace function public.radar_resumo()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- O `case` de fora é o que faz a função devolver NULO para quem não trabalha a
  -- fila: sem ele os agregados sobre o conjunto vazio devolveriam zeros, e a tela
  -- diria "nenhum candidato" a quem, na verdade, não pode ver nenhum.
  select case when app.can_write() then (
  select jsonb_build_object(
    'novos',            count(*) filter (where c.status = 'novo'),
    'aprovados',        count(*) filter (where c.status = 'aprovado'),
    'mesclados',        count(*) filter (where c.status = 'mesclado'),
    'recusados',        count(*) filter (where c.status = 'recusado'),
    'revisados_hoje',   count(*) filter (where c.reviewed_at is not null
                          and (c.reviewed_at at time zone 'America/Fortaleza')::date
                              = (now() at time zone 'America/Fortaleza')::date),
    'novos_sem_contato', count(*) filter (where c.status = 'novo' and 'sem_contato' = any (c.flags)),
    'novos_marcados',    count(*) filter (where c.status = 'novo' and cardinality(c.flags) > 0),
    'organizacoes',      (select count(*) from public.organizations o where o.deleted_at is null)
  )
  from public.supplier_candidates c
  ) end
$$;
comment on function public.radar_resumo() is
  'Números do topo da Revisão: fila por situação e marcados pela higiene. Devolve nulo para papel que não trabalha a fila. Os três números de fonte saíram em 25/09/2026, com o catálogo de fontes.';

-- ---------------------------------------------------------------------
-- 3. O catálogo de coleta do Casamentos
--
-- Em produção o `update` casa uma linha; num banco recém-resetado ele casa a
-- mesma linha e não acha as chaves, e `#-` sobre chave ausente é no-op. Nos dois
-- casos termina calado, que é o certo.
-- ---------------------------------------------------------------------
update public.sources
   set config = (config #- '{collector,catalogo}') #- '{collector,agente}'
 where slug = 'casamentos_com_br';

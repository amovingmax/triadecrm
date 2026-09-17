-- =====================================================================
-- A tela passa a escutar o banco: Realtime nas três tabelas da conversa
--
-- Até aqui, quem atendia só via a resposta do parceiro recarregando a página. O
-- worker-wa põe a mensagem no banco em ~5 s (ele varre a fila a cada 5 s), mas a
-- tela não tinha como saber disso: `useQuery` sem `refetchInterval` busca uma vez
-- e para.
--
-- =====================================================================
-- POR QUE ESCUTAR, E NÃO PERGUNTAR DE MINUTO EM MINUTO
-- =====================================================================
-- A lista de Conversas não é uma consulta barata: são seis leituras, e uma delas
-- traz 3.000 atividades para ordenar a lista no cliente (a decisão está escrita
-- em `dados.ts`). Repetir isso a cada 10 s, por pessoa, por aba aberta, seria
-- pagar o preço de uma tela viva sem ter uma tela viva — o atraso continuaria
-- existindo, só que menor e mais caro.
--
-- Escutar inverte a conta: o banco avisa quando algo mudou, e a tela busca de
-- novo só então. Em dia parado, custo zero.
--
-- =====================================================================
-- AS TRÊS TABELAS, E POR QUE SÓ ELAS
-- =====================================================================
-- * `messages`       — a resposta do parceiro chegando, e o estado do que sai
--                      (fila → enviado → entregue → lido).
-- * `conversations`  — a janela de 24 h reabrindo, o "por ler", quem assumiu.
-- * `message_drafts` — o robô redigiu e a fila de aprovação cresceu (ADR-05).
-- * `ficha_da_conversa` — a leitura da IA, que fica pronta de 30 a 60 s depois
--                      da resposta. Sem ela publicada, a faixa da IA só
--                      apareceria na próxima vez que alguém abrisse a conversa —
--                      e a análise que chega tarde demais é análise que ninguém
--                      lê.
--
-- `activities`, `deals` e `organizations` ficam de fora de propósito: elas mudam
-- por ação de quem está na tela (que já invalida a consulta na hora) ou por
-- rotina noturna, e publicar tabela que ninguém escuta é WAL a mais sem leitor.
--
-- =====================================================================
-- O QUE PROTEGE O QUE VIAJA
-- =====================================================================
-- A RLS. O Realtime do Supabase avalia as políticas de SELECT de cada tabela
-- para CADA assinante, com o JWT dele: quem não enxerga a conversa não recebe o
-- evento dela. É a mesma fechadura da tela e do PostgREST, e é por isso que esta
-- migração não inventa política nova — se ela precisasse de uma, o furo já
-- existiria na leitura normal.
--
-- `replica identity` fica como está (a chave primária). O `old_record` só é
-- necessário para DELETE e para comparar valores antigos; aqui o evento serve
-- para dizer "algo mudou nesta conversa", e quem busca o conteúdo é a tela, pelo
-- PostgREST, sob RLS. Trocar para `full` dobraria o WAL de cada mensagem para
-- alimentar um dado que ninguém lê.
-- =====================================================================

do $$
declare
  t text;
begin
  -- A publicação nasce com o projeto Supabase; num banco cru ela pode não
  -- existir, e aí o `add table` falharia com uma mensagem que não ajuda.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array['messages', 'conversations', 'message_drafts',
                           'ficha_da_conversa'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

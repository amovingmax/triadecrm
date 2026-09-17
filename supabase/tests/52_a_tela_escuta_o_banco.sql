-- =====================================================================
-- pgTAP — A tela escuta o banco (migração 20260917150000)
--
-- Publicação no Realtime é daquelas coisas que ninguém percebe quando some: a
-- tela simplesmente volta a parecer "meio lenta", e o culpado procurado é o
-- JavaScript. Uma migração futura que recrie `messages` sem readicioná-la à
-- publicação passa despercebida — menos aqui.
--
-- O que este arquivo prova:
--   1. As três tabelas da conversa estão publicadas.
--   2. O que não precisa continua fora: publicar tabela que ninguém escuta é
--      WAL a mais sem leitor.
--   3. As três têm RLS ligada — é ELA que decide quem recebe cada evento. Sem
--      RLS, publicar no Realtime seria transmitir conversa alheia por socket.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(11);

select ok(exists (select 1 from pg_publication where pubname = 'supabase_realtime'),
  'a publicação do Realtime existe');

select ok(exists (
  select 1 from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'),
  'MESSAGES está publicada: é a resposta do parceiro chegando');
select ok(exists (
  select 1 from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'),
  'CONVERSATIONS está publicada: a janela de 24 h reabrindo e o "por ler"');
select ok(exists (
  select 1 from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_drafts'),
  'MESSAGE_DRAFTS está publicada: a fila de aprovação do ADR-05 crescendo');

select ok(exists (
  select 1 from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ficha_da_conversa'),
  'FICHA_DA_CONVERSA está publicada: a leitura da IA fica pronta 30-60 s depois da resposta');

select is((select count(*)::int from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public'), 4,
  'e são SÓ essas quatro: activities, deals e organizations mudam por ação de quem está na tela');

-- A RLS é a fechadura do evento, não um detalhe de outra camada.
select ok((select relrowsecurity from pg_class where oid = 'public.messages'::regclass),
  'messages tem RLS: quem não enxerga a conversa não recebe o evento dela');
select ok((select relrowsecurity from pg_class where oid = 'public.conversations'::regclass),
  'conversations tem RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.message_drafts'::regclass),
  'message_drafts tem RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ficha_da_conversa'::regclass),
  'ficha_da_conversa tem RLS');

-- `replica identity` default (a chave primária) é decisão: o evento diz "mudou
-- algo nesta conversa" e quem busca o conteúdo é a tela, sob RLS. `full`
-- dobraria o WAL de cada mensagem para alimentar um `old_record` sem leitor.
select is((select relreplident from pg_class where oid = 'public.messages'::regclass), 'd',
  'messages fica na replica identity padrão: o evento avisa, ele não entrega o conteúdo');

rollback;

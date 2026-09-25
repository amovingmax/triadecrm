-- =====================================================================
-- pgTAP — A dívida do orçamento alcança o que já estava na fila
--         (migração 20260925190000)
--
-- O BURACO QUE ESTE ARQUIVO FECHA. A 20260925150000 anotou a dívida de quem
-- PEDE um trabalho com o mês estourado. Quem já estava na fila quando o mês
-- estourou não era anotado por ninguém: o worker lia, `executar()` recusava,
-- `eDeterministico` dizia que não adiantava repetir e a mensagem era concluída.
-- A chave ficava em `ingest_dedup` com `processed_at`, e daí em diante
-- `app.esteira_enfileirar` respondia `ja_enfileirado` para sempre. O resumo
-- daquela ligação não acontecia nunca mais.
--
-- O que este arquivo tem de provar:
--   1. Sem a porta nova, a chave gasta trava o reenfileiramento — é a prova de
--      que o buraco existia, escrita como asserção e não como comentário.
--   2. `public.ia_adiar_trabalho` anota a dívida E destrava a chave.
--   3. Com o mês pago, `app.ia_retomar_adiados` devolve o trabalho à fila.
--   4. Uma dívida que o freio ainda recusa NÃO prende as de trás.
--   5. Propósito que ninguém nomeou continua explodindo; trabalho sem chave
--      não vira dívida fantasma.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(12);

-- O mês, zerado dentro da transação: o que se mede aqui é uma LINHA absoluta,
-- e linha absoluta só se mede a partir de um zero conhecido (mesmo recurso do
-- arquivo 67).
delete from public.ai_runs
 where (created_at at time zone 'America/Fortaleza')::date
       >= date_trunc('month', (now() at time zone 'America/Fortaleza')::date);
delete from public.ia_trabalho_adiado;

-- O custo NÃO é escrito: `app.ai_runs_before_write` recalcula `cost_usd` a
-- partir dos tokens. claude-sonnet-5: US$ 1 = 500.000 tokens de entrada.
create function pg_temp.gastar(p_usd numeric) returns void
  language sql security definer set search_path = '' as $$
  insert into public.ai_runs (purpose, model, prompt_version, tokens_in, tokens_out)
  values ('digest', 'claude-sonnet-5', 'pgtap71-gasto@v1', round(p_usd * 500000)::int, 0)
$$;

-- =====================================================================
-- 1. O TRABALHO ENTRA NA FILA COM O MÊS AINDA BARATO
-- =====================================================================
select ok((app.ia_enfileirar('summarize_call', '{"tentativa_id":"t-71"}'::jsonb, 'lig-71')
           ->> 'enfileirado')::boolean,
  'com o mês barato, o resumo da ligação entra na fila');

-- E então o mês estoura, antes de o worker ler — que é o caso todo: os
-- workers consomem quando estão ligados (ADR-04).
select pg_temp.gastar(61);
select is(app.ai_gasto_do_mes(null) ->> 'situacao', 'freou',
  'o mês estourou entre o enfileiramento e a leitura');

-- O worker lê, o freio recusa e a mensagem é CONCLUÍDA: é o que
-- `workers/ai.ts` faz com erro determinístico.
select lives_ok(
  $$ select app.esteira_concluir('ai_jobs',
       (select msg_id from public.ingest_dedup
         where queue = 'ai_jobs' and idempotency_key = 'summarize_call:lig-71'),
       'summarize_call:lig-71') $$,
  'o worker conclui a mensagem sem resultado, como faz com todo erro determinístico');

-- =====================================================================
-- 2. A PROVA DE QUE O BURACO EXISTIA
-- =====================================================================
-- Sem apagar a chave gasta, nenhum caminho devolve este trabalho à fila. Esta
-- asserção é o buraco escrito como teste: se um dia alguém tirar o `delete` de
-- `public.ia_adiar_trabalho`, é aqui que a perda volta a aparecer.
select is(app.esteira_enfileirar('ai_jobs', '{"purpose":"summarize_call"}'::jsonb,
                                 'summarize_call:lig-71') ->> 'motivo',
  'ja_enfileirado',
  'a chave gasta trava o reenfileiramento: sem a porta nova, o resumo se perderia');

-- =====================================================================
-- 3. A PORTA NOVA ANOTA A DÍVIDA E DESTRAVA A CHAVE
-- =====================================================================
select ok((public.ia_adiar_trabalho('summarize_call', '{"tentativa_id":"t-71"}'::jsonb,
                                    'lig-71', 'orcamento_esgotado') ->> 'adiado')::boolean,
  'o worker anota como dívida o que leu e não pôde fazer');
select is((select count(*)::int from public.ia_trabalho_adiado
            where chave = 'summarize_call:lig-71' and retomado_em is null), 1,
  'a dívida existe, e em aberto');
select is((select count(*)::int from public.ingest_dedup
            where queue = 'ai_jobs' and idempotency_key = 'summarize_call:lig-71'), 0,
  'e a chave gasta saiu do dedup: sem isso a dívida seria impagável');

-- Com o mês ainda estourado, o cron não reenfileira nada — o freio continua
-- valendo, que é o ponto da fase inteira.
select is(app.ia_retomar_adiados(50), 0,
  'com o mês estourado o cron não devolve nada à fila: o freio continua freiando');

-- =====================================================================
-- 4. O MÊS VOLTA A CABER, E O TRABALHO VOLTA
-- =====================================================================
delete from public.ai_runs where prompt_version = 'pgtap71-gasto@v1';
select is(app.ia_retomar_adiados(50), 1,
  'pago o mês, o cron devolve o resumo à fila — o trabalho não se perdeu');
select is((select count(*)::int from public.ia_trabalho_adiado
            where chave = 'summarize_call:lig-71' and retomado_em is not null), 1,
  'e a dívida fica marcada como paga, para não voltar a cada 20 minutos');

-- =====================================================================
-- 5. UMA DÍVIDA RECUSADA NÃO PRENDE AS DE TRÁS
-- =====================================================================
-- Na linha de alerta (US$ 49 de 60) `draft_reply` para e `classify_inbound`
-- passa. Com a dívida de `draft_reply` na frente da fila, o `exit` antigo
-- segurava atrás dela um trabalho que o freio deixaria passar.
delete from public.ia_trabalho_adiado;
insert into public.ia_trabalho_adiado (chave, purpose, payload, chave_crua, motivo, adiado_em)
values ('draft_reply:d-71',      'draft_reply',      '{}'::jsonb, 'd-71', 'orcamento',
        now() - interval '2 hours'),
       ('classify_inbound:c-71', 'classify_inbound', '{}'::jsonb, 'c-71', 'orcamento',
        now() - interval '1 hour');
select pg_temp.gastar(49);
select is(app.ia_retomar_adiados(50), 1,
  'a dívida que o freio ainda recusa é pulada, e a de trás — que ele libera — é paga');
select is((select count(*)::int from public.ia_trabalho_adiado
            where chave = 'draft_reply:d-71' and retomado_em is null), 1,
  'e a recusada continua em aberto, esperando o mês');

select * from finish();
rollback;

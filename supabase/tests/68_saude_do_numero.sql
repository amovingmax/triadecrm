-- =====================================================================
-- pgTAP — A saúde do número na Meta (migração 20260925160000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. O HISTÓRICO É HISTÓRICO. `public.wa_saude_numero` é append-only. Quando
--      a Meta restringe e depois solta, a pergunta que importa é "desde
--      quando" e "quantas vezes" — e as duas se perdem num `update`.
--   2. A ÚLTIMA LINHA QUE SOUBE DE CADA COISA. Qualidade, tier e restrição
--      chegam por campos diferentes, em momentos diferentes. Ler "a última
--      linha" faria um `business_capability_update` apagar a restrição que
--      chegou dez minutos antes.
--   3. A NOTA DOBRA DENTRO DO TETO. YELLOW → metade, RED → zero.
--   4. RESTRIÇÃO VENCIDA CAI SOZINHA. `expiration` é unix em segundos, e uma
--      restrição de ontem que ninguém apagou não pode calar o número de hoje.
--   5. SEM HISTÓRICO, NADA MUDA. `teto_dia` nulo: "não sei" não vira nem
--      permissão nem proibição.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(16);

-- ---------- utilitários ----------
-- O número é fixo e impossível na operação: o `rollback` desfaz tudo, mas
-- misturar com o número de verdade tornaria a leitura ambígua.
create function pg_temp.num() returns text language sql immutable as $$
  select '+5584900000068'::text
$$;
create function pg_temp.anotar(p jsonb) returns bigint
  language sql security definer set search_path = '' as $$
  select public.wa_saude_registrar(p)
$$;

-- =====================================================================
-- 1. A TABELA É HISTÓRICO
-- =====================================================================
select has_table('public', 'wa_saude_numero', 'o que a Meta diz sobre o número tem onde morar');

select isnt(pg_temp.anotar(jsonb_build_object(
    'numero', pg_temp.num(), 'origem', 'graph', 'campo', 'phone_number',
    'qualidade', 'GREEN', 'ocorrido_em', (now() - interval '3 hours')::text)), null,
  'a leitura da Graph grava a nota');

select throws_ok(
  format($$update public.wa_saude_numero set qualidade = 'RED' where numero = %L$$, pg_temp.num()),
  '42501', NULL,
  'e ninguém reescreve o histórico: append-only, como os eventos de consentimento');
select throws_ok(
  format($$delete from public.wa_saude_numero where numero = %L$$, pg_temp.num()),
  '42501', NULL,
  'nem apaga');

-- =====================================================================
-- 2. O TETO DA META
-- =====================================================================
select is(app.wa_teto_da_meta('+5584900000999', now()) ->> 'teto_dia', NULL,
  'número sem histórico nenhum: teto nulo — "não sei" não vira "então pare"');

select pg_temp.anotar(jsonb_build_object(
  'numero', pg_temp.num(), 'origem', 'webhook', 'campo', 'business_capability_update',
  'limite_atual', 'TIER_2K', 'ocorrido_em', (now() - interval '2 hours')::text));
select is((app.wa_teto_da_meta(pg_temp.num(), now()) ->> 'teto_dia')::int, 2000,
  'TIER_2K vira 2.000 conversas por dia');

select pg_temp.anotar(jsonb_build_object(
  'numero', pg_temp.num(), 'origem', 'graph', 'campo', 'phone_number',
  'qualidade', 'YELLOW', 'ocorrido_em', (now() - interval '1 hour')::text));
select is((app.wa_teto_da_meta(pg_temp.num(), now()) ->> 'teto_dia')::int, 1000,
  'nota amarela vale metade do tier: a Meta não avisa duas vezes');
select is(app.wa_teto_da_meta(pg_temp.num(), now()) ->> 'tier', 'TIER_2K',
  'e o tier continua lá: a linha da nota não apagou a linha do tier');

select pg_temp.anotar(jsonb_build_object(
  'numero', pg_temp.num(), 'origem', 'webhook', 'campo', 'phone_number_quality_update',
  'evento', 'FLAGGED', 'qualidade', 'RED', 'ocorrido_em', (now() - interval '30 minutes')::text));
select is((app.wa_teto_da_meta(pg_temp.num(), now()) ->> 'teto_dia')::int, 0,
  'nota vermelha zera o teto: não é meio envio, é envio nenhum');

-- =====================================================================
-- 3. RESTRIÇÃO E BANIMENTO
-- =====================================================================
select pg_temp.anotar(jsonb_build_object(
  'numero', pg_temp.num(), 'origem', 'webhook', 'campo', 'account_update',
  'evento', 'ACCOUNT_RESTRICTION',
  'restricoes', jsonb_build_array(jsonb_build_object(
      'restriction_type', 'RESTRICTED_BIZ_INITIATED_MESSAGING',
      'expiration', extract(epoch from (now() + interval '2 days'))::bigint)),
  'ocorrido_em', (now() - interval '20 minutes')::text));
select is((app.wa_teto_da_meta(pg_temp.num(), now()) ->> 'restrito_saida')::boolean, true,
  'RESTRICTED_BIZ_INITIATED_MESSAGING fecha a saída');
select ok((app.wa_teto_da_meta(pg_temp.num(), now()) ->> 'ate')::timestamptz > now(),
  'e diz até quando: a restrição tem prazo, e o prazo é da Meta');
select is((app.wa_teto_da_meta(pg_temp.num(), now()) ->> 'restrito_entrada')::boolean, false,
  'a restrição de SAÍDA não fecha a entrada: são duas coisas, e a Meta as separa');

-- Uma restrição já vencida, e mais nenhuma: cai sozinha.
select pg_temp.anotar(jsonb_build_object(
  'numero', pg_temp.num(), 'origem', 'webhook', 'campo', 'account_update',
  'evento', 'ACCOUNT_RESTRICTION',
  'restricoes', jsonb_build_array(jsonb_build_object(
      'restriction_type', 'RESTRICTED_BIZ_INITIATED_MESSAGING',
      'expiration', extract(epoch from (now() - interval '1 day'))::bigint)),
  'ocorrido_em', (now() - interval '10 minutes')::text));
select is((app.wa_teto_da_meta(pg_temp.num(), now()) ->> 'restrito_saida')::boolean, false,
  'restrição vencida cai sozinha: ninguém precisa lembrar de apagá-la');

-- As outras sete restrições são guardadas e não viram teto.
select pg_temp.anotar(jsonb_build_object(
  'numero', pg_temp.num(), 'origem', 'webhook', 'campo', 'account_update',
  'evento', 'ACCOUNT_RESTRICTION',
  'restricoes', jsonb_build_array(jsonb_build_object(
      'restriction_type', 'RESTRICTED_ADD_PHONE_NUMBER_ACTION')),
  'ocorrido_em', (now() - interval '9 minutes')::text));
select is((app.wa_teto_da_meta(pg_temp.num(), now()) ->> 'restrito_saida')::boolean, false,
  'restrição de outro assunto fica guardada e não vira teto: ela não fala de mensagem');

select pg_temp.anotar(jsonb_build_object(
  'numero', pg_temp.num(), 'origem', 'webhook', 'campo', 'account_update',
  'evento', 'DISABLED_UPDATE', 'banido', true,
  'ocorrido_em', (now() - interval '5 minutes')::text));
select is((app.wa_teto_da_meta(pg_temp.num(), now()) ->> 'banido')::boolean, true,
  'banimento é banimento, e ele chega por account_update');

-- =====================================================================
-- 4. O NÚMERO QUE A META NÃO MANDA
-- =====================================================================
-- `account_update` NÃO traz `phone_number` em `value`: a restrição é da WABA.
-- O registrador cai no número padrão em vez de gravar uma linha órfã.
select is((select s.numero from public.wa_saude_numero s
            where s.id = pg_temp.anotar(jsonb_build_object(
                    'origem', 'webhook', 'campo', 'account_update', 'evento', 'ACCOUNT_VIOLATION'))),
          app.wa_numero_padrao(),
  'sem número no payload, a linha nasce com o número padrão: account_update é da WABA, e a WABA é a nossa');

select * from finish();
rollback;

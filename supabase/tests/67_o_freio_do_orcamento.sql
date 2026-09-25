-- =====================================================================
-- pgTAP — O freio do orçamento de IA (migração 20260925150000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. O TETO FOI DECIDIDO. US$ 60/mês, e a linha `ia.orcamento` deixou de
--      nascer pendente. O número mora em `app_settings` porque é dinheiro, e
--      dinheiro não se muda por migração; mas ele tem de estar LÁ, e não
--      espalhado por `coalesce` de função.
--   2. AS DUAS LINHAS SÃO DERIVADAS. Alerta = teto x fracao_alerta; freio =
--      o teto inteiro. Ninguém escreve 48 em lugar nenhum. Se um dia alguém
--      escrever, este arquivo acusa: há duas fontes para o mesmo fato.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(4);

-- =====================================================================
-- 1. O TETO, E AS DUAS LINHAS
-- =====================================================================
select is((select (s.value ->> 'mensal_usd')::numeric from public.app_settings s
            where s.key = 'ia.orcamento'), 60::numeric,
          'o teto mensal de IA é US$ 60 (decisão de Rafael, 25/09/2026)');
select is((select (s.value ->> 'pendente_de_aprovacao')::boolean from public.app_settings s
            where s.key = 'ia.orcamento'), false,
          'o teto deixou de nascer pendente: ele foi decidido');
select is((app.ai_gasto_do_mes(null) ->> 'linha_do_freio_usd')::numeric, 60::numeric,
          'a linha do freio é o teto inteiro');
select is((app.ai_gasto_do_mes(null) ->> 'limite_de_alerta_usd')::numeric, 48::numeric,
          'a linha de alerta é 80% do teto, derivada e não escrita');

select * from finish();
rollback;

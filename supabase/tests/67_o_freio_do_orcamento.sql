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
--   3. A RECUSA NÃO EXPLODE. `app.ia_enfileirar_resumo` roda dentro da
--      transação de `public.tabular_tentativa`: um `raise` ali abortaria a
--      tabulação da ligação que a pessoa acabou de registrar. A recusa volta
--      como valor. Propósito desconhecido, esse sim, continua explodindo.
--   4. A RECUSA NÃO PERDE TRABALHO. `app.ia_enfileirar_resumo` roda dentro da
--      transação de `public.tabular_tentativa`, que COMMITA: recusar sem
--      anotar faria o `summarize_call` daquela ligação nunca mais ser pedido,
--      porque não existe cron que o repita. A recusa vira dívida anotada, e
--      um cron a paga quando o mês voltar a caber.
--   5. O MÊS QUE PULA DIRETO PARA O FREIO grava as duas linhas de alerta.
--      Sem isso, o registro de "passamos de 80%" não existiria para esse mês.
--   6. O FREIO RECUSA POR EXCLUSÃO. Na linha de alerta param os 12 propósitos
--      que não são de atendimento; sobrevivem `classify_inbound` e
--      `transcribe_audio`, que são os únicos que servem para entender quem
--      escreveu agora. No teto inteiro param os 14. Os 12 são nomeados um a
--      um de propósito: propósito novo que nasça livre derruba este arquivo.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(29);

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

-- =====================================================================
-- 2. O FREIO, DEGRAU A DEGRAU
-- =====================================================================
-- ---------- o mês, zerado dentro da transação ----------
-- Este banco tem operação real dentro, e `app.ia_pode_gastar` lê o mês
-- CORRENTE. Medir delta não serve: o que se mede aqui é uma LINHA absoluta,
-- e uma linha absoluta só se mede a partir de um zero conhecido. Zerar o mês
-- dentro da transação que dá `rollback` é o mesmo recurso que o arquivo 24
-- usa com as filas do pgmq.
delete from public.ai_runs
 where (created_at at time zone 'America/Fortaleza')::date
       >= date_trunc('month', (now() at time zone 'America/Fortaleza')::date);

-- O custo NÃO é escrito: `app.ai_runs_before_write` (20260905000200:238)
-- recalcula `cost_usd` a partir dos tokens em TODO insert e ignora o que
-- vier na coluna. O gasto se faz por TOKEN, e o modelo é fixado — com um
-- `limit 1` em `ai_model_prices` o preço mudaria com a ordem das linhas.
-- claude-sonnet-5: US$ 1 = 500.000 tokens de entrada (mesma conta do 24).
create function pg_temp.gastar(p_usd numeric) returns void
  language sql security definer set search_path = '' as $$
  insert into public.ai_runs (purpose, model, prompt_version, tokens_in, tokens_out)
  values ('digest', 'claude-sonnet-5', 'pgtap67-gasto@v1', round(p_usd * 500000)::int, 0)
$$;

select pg_temp.gastar(21);
select ok((app.ia_pode_gastar('draft_reply') ->> 'pode')::boolean,
  'com US$ 21 de 60, os 12 propósitos ainda passam');

select pg_temp.gastar(28);                                   -- total US$ 49
select ok(not (app.ia_pode_gastar('draft_reply') ->> 'pode')::boolean,
  'com US$ 49 de 60, draft_reply para na linha de alerta');
select is(app.ia_pode_gastar('draft_reply') ->> 'motivo', 'orcamento_na_linha_de_alerta',
  'e o motivo diz qual das duas linhas foi');
select ok((app.ia_pode_gastar('classify_inbound') ->> 'pode')::boolean,
  'classify_inbound sobrevive à linha de alerta: é ele que entende quem escreveu agora');
select ok((app.ia_pode_gastar('transcribe_audio') ->> 'pode')::boolean,
  'transcribe_audio também sobrevive: o áudio que chegou tem de virar texto');

-- Aqui, e não depois do teto: passada a linha do freio param os 14, e a
-- partição deixaria de ser visível.
select is(app.ia_gasto_bloqueado_para(), array['analisar_conversa','assistant','digest',
          'draft_followup','draft_reply','extract_listing','next_action','perguntar_ao_crm',
          'pulso_do_dia','summarize_call','summarize_deal','triar_candidato']::text[],
  'os 12 que param na linha de alerta, nomeados um a um: propósito novo derruba este teste');

select pg_temp.gastar(12);                                   -- total US$ 61
select ok(not (app.ia_pode_gastar('classify_inbound') ->> 'pode')::boolean,
  'com US$ 61 de 60, nem classify_inbound passa');
select is(app.ia_pode_gastar('classify_inbound') ->> 'motivo', 'orcamento_esgotado',
  'e o motivo é o teto, não a linha de alerta: são prazos diferentes');
select is(array_length(app.ia_gasto_bloqueado_para(), 1), 14,
  'passada a linha do freio, param os 14 — inclusive os dois do atendimento');

-- =====================================================================
-- 3. A FILA RECUSA — e a recusa é valor, não exceção
-- =====================================================================
select is((app.ia_enfileirar('draft_reply', '{}'::jsonb, 'pgtap67-a') ->> 'enfileirado')::boolean, false,
  'com o mês freado, a fila da IA não enfileira');
select is(app.ia_enfileirar('draft_reply', '{}'::jsonb, 'pgtap67-a') ->> 'motivo', 'orcamento',
  'e diz por que: a recusa volta como VALOR, porque ela roda dentro da transação de quem chamou');
select throws_ok(
  $$select app.ia_enfileirar('inventar_coisa', '{}'::jsonb, 'pgtap67-b')$$,
  '22023', NULL,
  'propósito desconhecido continua EXPLODINDO: aquilo é erro de programação, não estado do mês');

-- ---------- e a recusa vira dívida, não trabalho apagado ----------
select has_table('public', 'ia_trabalho_adiado', 'a dívida do orçamento tem onde morar');

select is(app.ia_enfileirar('summarize_call',
            jsonb_build_object('attempt_id', '00000000-0000-4000-8000-000000000067'),
            'attempt:pgtap67') ->> 'motivo', 'orcamento',
  'a fila recusa o resumo da ligação');
select is((select count(*)::int from public.ia_trabalho_adiado a
            where a.chave = 'summarize_call:attempt:pgtap67'), 1,
  'e o trabalho recusado fica ANOTADO: a tabulação commita, e o resumo não some com ela');

select is(app.ia_enfileirar('summarize_call',
            jsonb_build_object('attempt_id', '00000000-0000-4000-8000-000000000067'),
            'attempt:pgtap67') ->> 'motivo', 'orcamento',
  'pedir de novo continua sendo recusa');
select is((select count(*)::int from public.ia_trabalho_adiado a
            where a.chave = 'summarize_call:attempt:pgtap67'), 1,
  'anotar duas vezes o mesmo trabalho continua sendo uma linha: a chave é a idempotência');

-- =====================================================================
-- 4. O ALERTA GRAVA AS DUAS LINHAS
-- =====================================================================
-- O `delete` só é possível porque a transação inteira dá rollback.
delete from public.ai_budget_alerts
 where mes = to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM');

select is(app.ai_alerta_orcamento() ->> 'situacao', 'freou',
  'com US$ 61 de 60, a situação do mês é freou');
select is((select count(*)::int from public.ai_budget_alerts a
            where a.mes = to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM')), 2,
  'e o alerta grava DUAS linhas: um mês que pula de ok para freou entre duas passadas do cron ficaria, de outro modo, sem registro nenhum de ter passado de 80%');
select is(app.ai_alerta_orcamento() ->> 'motivo', 'ja_alertado',
  'a segunda passada do cron não emite de novo: a chave (mês, situação) é a idempotência');

-- =====================================================================
-- 5. O PAINEL DIZ O QUE ESTÁ PARADO
-- =====================================================================
-- Sem perfil de verdade: `app.role()` e `auth.uid()` leem o JWT, e é o JWT
-- que o PostgREST entrega. Mesmo utilitário do arquivo 24.
create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

select pg_temp.entrar('00000000-0000-4000-8000-000000000067'::uuid, 'admin');
select is((public.ia_orcamento_status() ->> 'freado')::boolean, true,
  'o painel sabe que o mês está freado');
select is((public.ia_orcamento_status() ->> 'parados')::int, 14,
  'e conta quantos propósitos o freio está recusando agora');
select pg_temp.sair();

-- =====================================================================
-- 6. A DÍVIDA É PAGA SOZINHA
-- =====================================================================
-- Baixa o gasto do mês abaixo da linha e prova que o que ficou devendo volta.
-- São três dívidas anotadas nesta transação: os dois `draft_reply` da mesma
-- chave (uma linha) e o `summarize_call`.
delete from public.ai_runs where prompt_version = 'pgtap67-gasto@v1';
select is(app.ia_retomar_adiados(10), 2,
  'com o mês folgado de novo, o cron reenfileira o que ficou devendo — e nada fica para trás');

-- =====================================================================
-- 7. O OUTRO DINHEIRO, MEDIDO
-- =====================================================================
-- A conta de serviço da Meta é a que a Fase 4 faz crescer: toda resposta
-- dentro da janela de 24 h. Nesta fase ela SÓ MEDE — teto sem número medido
-- é palpite, e palpite que recusa mensagem de cliente é pior que teto nenhum.
select has_view('public', 'wa_servico_do_mes',
  'o que a Meta cobra de serviço tem onde ser contado');
select is((select count(*)::int from pg_views v
            where v.schemaname = 'public' and v.viewname = 'wa_servico_do_mes'
              and v.definition ~ 'NOT m\.business_initiated'), 1,
  'e conta a saída de DENTRO da janela: o contrário exato de app.iniciadas_pela_empresa');

select * from finish();
rollback;

-- =====================================================================
-- A dívida do orçamento alcança o trabalho que JÁ ESTAVA na fila
-- =====================================================================
-- POR QUE ESTA MIGRAÇÃO EXISTE. A migração 20260925150000 fechou a porta de
-- ENTRADA da fila de IA: quem pede um trabalho com o mês estourado leva
-- `{enfileirado:false}` e a dívida fica anotada em `public.ia_trabalho_adiado`,
-- que o cron paga quando o mês voltar a caber. Isso cobre o pedido NOVO.
--
-- O QUE FICOU DESCOBERTO é o trabalho que entrou na fila ANTES de o mês
-- estourar. Os workers consomem quando estão ligados (ADR-04), então um
-- `summarize_call` pode dormir horas entre o enfileiramento e a leitura — e o
-- mês pode acabar nesse meio. Quando isso acontece, `executar()` levanta
-- `OrcamentoEsgotadoError`, `eDeterministico` diz que não adianta repetir e
-- `workers/ai.ts` CONCLUI a mensagem. A partir daí:
--
--   1. não há linha em `ia_trabalho_adiado` — o cron nunca fica sabendo;
--   2. a chave continua em `public.ingest_dedup` com `processed_at` preenchido,
--      e `app.esteira_enfileirar` responde `ja_enfileirado` para sempre.
--
-- Ou seja: o resumo daquela ligação não acontece nunca mais, exatamente o caso
-- que o cabeçalho da 20260925150000 nomeia como "perde para sempre". O freio
-- estava deixando de gastar E perdendo o trabalho — e perda em silêncio é pior
-- que gasto, porque o gasto aparece na conta e a perda não aparece em lugar
-- nenhum. `classify_inbound` é a única exceção já coberta: `classificarEntrada`
-- escala a conversa e abre tarefa, e quem assume é gente.
--
-- O QUE MUDA AQUI:
--   `public.ia_adiar_trabalho` — a porta pela qual o worker anota a dívida do
--   que leu e não pôde fazer, APAGANDO a chave gasta do dedup. Sem apagá-la a
--   dívida seria impagável: o cron tentaria de 20 em 20 minutos e ouviria
--   `ja_enfileirado` até o fim dos tempos.
--
--   `app.ia_retomar_adiados` — deixa de `exit` na primeira linha recusada.
--   Com dois degraus de freio, uma dívida de `draft_reply` na frente da fila
--   segurava atrás dela um `classify_inbound` que o freio deixaria passar. A
--   pergunta continua sendo feita LINHA A LINHA, que é o que o freio exige;
--   o que muda é que a linha recusada não prende as outras.
--
-- ESTA MIGRAÇÃO NÃO AFROUXA NADA. Ela não faz uma única chamada a mais ao
-- modelo: o freio continua sendo perguntado antes de cada reenfileiramento e
-- antes de cada POST. Ela só faz o trabalho recusado voltar a existir.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A porta do worker para anotar a dívida
-- ---------------------------------------------------------------------
create or replace function public.ia_adiar_trabalho(p_purpose text,
                                                    p_payload jsonb,
                                                    p_chave   text,
                                                    p_motivo  text default 'orcamento_esgotado')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chave text;
begin
  -- A mesma lista de `app.ia_enfileirar`, e pelo mesmo motivo: propósito que
  -- ninguém nomeou é gasto que ninguém orçou, e aqui ele viraria dívida eterna.
  if p_purpose not in ('transcribe_audio', 'summarize_call', 'draft_followup', 'classify_inbound',
                       'draft_reply', 'summarize_deal', 'next_action', 'digest',
                       'extract_listing', 'assistant',
                       'analisar_conversa', 'pulso_do_dia', 'perguntar_ao_crm',
                       'triar_candidato') then
    raise exception 'Propósito % não existe em ai_runs.purpose: não há o que adiar', p_purpose
      using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_chave, '')), '') is null then
    -- Sem chave não há dívida possível: `app.esteira_enfileirar` recusa
    -- mensagem sem chave, e inventar uma aqui criaria um trabalho que ninguém
    -- consegue reconhecer como repetido. O worker registra o aviso no log.
    return jsonb_build_object('adiado', false, 'motivo', 'sem_chave');
  end if;

  v_chave := p_purpose || ':' || p_chave;

  insert into public.ia_trabalho_adiado (chave, purpose, payload, chave_crua, motivo)
  values (v_chave, p_purpose, coalesce(p_payload, '{}'::jsonb), p_chave,
          coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'orcamento_esgotado'))
  on conflict (chave) do nothing;

  -- A CHAVE GASTA SAI DO DEDUP. É o que torna a dívida pagável: o trabalho
  -- terminou sem resultado, e a trava de idempotência que existia para impedir
  -- que ele fosse FEITO duas vezes passaria a impedir que ele fosse feito uma.
  -- Só é seguro porque quem chama já sabe que a mensagem original vai ser
  -- arquivada no instante seguinte, e porque o freio ainda está fechado — o
  -- cron não reenfileira nada enquanto ele estiver.
  delete from public.ingest_dedup
   where queue = 'ai_jobs' and idempotency_key = v_chave;

  return jsonb_build_object('adiado', true, 'chave', v_chave, 'motivo', p_motivo);
end $$;
comment on function public.ia_adiar_trabalho(text, jsonb, text, text) is
  'Anota como dívida o trabalho de IA que o worker leu da fila e o freio do orçamento recusou, e apaga a chave gasta de ingest_dedup para que app.ia_retomar_adiados possa reenfileirá-lo. Sem isto, o trabalho já enfileirado antes de o mês estourar se perderia para sempre.';
revoke all on function public.ia_adiar_trabalho(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.ia_adiar_trabalho(text, jsonb, text, text) to service_role;


-- ---------------------------------------------------------------------
-- 2. Uma dívida recusada não prende as de trás
-- ---------------------------------------------------------------------
create or replace function app.ia_retomar_adiados(p_limite int default 50)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      public.ia_trabalho_adiado%rowtype;
  v_res  jsonb;
  v_n    int := 0;
begin
  for r in select * from public.ia_trabalho_adiado
            where retomado_em is null
            order by adiado_em
            limit greatest(coalesce(p_limite, 50), 1)
            for update skip locked loop
    -- A pergunta é por LINHA, e não uma vez para o lote: o mês pode acabar no
    -- meio do lote, e reenfileirar o resto furaria o freio que acabou de
    -- fechar. Mas a linha recusada não prende as de trás: com dois degraus, um
    -- `draft_reply` parado na linha de alerta segurava atrás dele um
    -- `classify_inbound` que o freio deixaria passar.
    if not coalesce((app.ia_pode_gastar(r.purpose) ->> 'pode')::boolean, false) then
      continue;
    end if;
    -- Chama `esteira_enfileirar` e não `ia_enfileirar`: a chave já vem pronta
    -- (é a que foi anotada), e passar por `ia_enfileirar` de novo faria a
    -- concatenação do propósito duas vezes.
    v_res := app.esteira_enfileirar('ai_jobs',
               jsonb_build_object('purpose', r.purpose) || coalesce(r.payload, '{}'::jsonb),
               r.chave);
    if coalesce((v_res ->> 'enfileirado')::boolean, false) then
      update public.ia_trabalho_adiado
         set tentativas = tentativas + 1, retomado_em = now()
       where chave = r.chave;
      v_n := v_n + 1;
    elsif (v_res ->> 'motivo') = 'ja_enfileirado' then
      -- O trabalho está na fila por outro caminho. A dívida está paga: mantê-la
      -- aberta seria tentar de 20 em 20 minutos, para sempre, uma coisa que já
      -- foi feita.
      update public.ia_trabalho_adiado
         set tentativas = tentativas + 1, retomado_em = now()
       where chave = r.chave;
    else
      update public.ia_trabalho_adiado
         set tentativas = tentativas + 1
       where chave = r.chave;
    end if;
  end loop;
  -- Dívida paga há mais de 30 dias não é dívida, é história de custo.
  delete from public.ia_trabalho_adiado
   where retomado_em is not null and retomado_em < now() - interval '30 days';
  return v_n;
end $$;
comment on function app.ia_retomar_adiados(int) is
  'Paga a dívida que o freio do orçamento deixou: reenfileira o que foi recusado, do mais antigo para o mais novo, perguntando ao freio a cada linha. A linha que o freio ainda recusa é pulada, não interrompe o lote. Roda no cron ia_retomar_adiados, de 20 em 20 minutos.';
revoke all on function app.ia_retomar_adiados(int) from public, anon, authenticated;
grant execute on function app.ia_retomar_adiados(int) to service_role;

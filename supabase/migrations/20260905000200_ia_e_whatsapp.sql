-- =====================================================================
-- TRIADE — v0.1 — D9/D10 — O BANCO DOS DOIS WORKERS
-- (RF-CON-03, RF-CON-04, RF-CON-05, RF-CON-10, RF-CON-11, RF-CON-18,
--  RF-CON-19, RF-CON-22, RF-CON-24, RF-CON-28, RF-ADM-03; PRD §7.4, §9,
--  §10.5 e §10.6; ADR-03, ADR-04, ADR-05, ADR-06, ADR-09, ADR-10, ADR-11;
--  anexos R04, R05, R06, R08 e R13.)
--
-- POR QUE ESTE ARQUIVO EXISTE
-- ---------------------------------------------------------------------
-- `apps/workers/src/workers/wa.ts` tem 13 linhas e `ai.ts` tem 15. São
-- esqueletos porque o banco de que os dois precisam não existe. Falta:
--
--   1. ONDE O CUSTO DA IA APARECE. `packages/prompts` mediu US$ 4/mês no
--      volume real, e o próprio documento de custos diz, por escrito, que
--      "a tabela `ai_runs` ainda não existe nas migrações — enquanto não
--      existir, os números acima são projeção, não medição". É a pendência
--      nº 2 de `docs/operacao/prompts-e-custos.md`, e ela é resolvida aqui.
--   2. ONDE O RASCUNHO ESPERA A PESSOA. O ADR-05 diz que a IA classifica e
--      redige e a PESSOA aprova. Hoje isso é uma frase. Aqui vira tabela,
--      máquina de estados e gatilho — no BANCO, não na tela, porque tela
--      se contorna com um `curl`.
--   3. ONDE AS MENSAGENS FICAM. Conversa, janela de 24 h, wamid da Meta,
--      estado de entrega, idempotência do webhook.
--   4. AS FILAS dos dois workers, com dead-letter.
--   5. OS GUARDRAILS NA ENTREGA. Suprimido nunca recebe, teto por dia e
--      por número, janela de horário, nunca domingo nem feriado.
--
-- A FORMA VEM DO DRENO (20260905000100_dreno_reconfere.sql)
-- ---------------------------------------------------------------------
-- Aquele arquivo achou um buraco com nome próprio: `app.komune_proximos`
-- confiava na decisão tomada na ENFILEIRADA e entregava sem reconferir.
-- Entre a entrada e a saída existe tempo, e no tempo o mundo muda — é
-- justamente ali que mora o direito de mudar de ideia.
--
-- Uma fila de mensagens de WhatsApp é o MESMO problema, com uma diferença
-- que o piora: o pedido da Komune era um `POST` para um parceiro; aqui o
-- efeito é uma mensagem no celular de uma pessoa que pediu para não ser
-- mais procurada. Então a forma do dreno é copiada inteira:
--
--   · `app.wa_motivo_de_recusa(...)` — a pergunta única "esta mensagem
--     ainda pode sair?", com o motivo por escrito. Uma função só, para
--     que gatilho, dreno e RPC usem literalmente o mesmo critério.
--   · O dreno `app.wa_proximos` RECONFERE item a item e mata o que não
--     pode mais sair, arquivando a mensagem pgmq.
--   · E, porque aqui o custo de errar é maior, existe uma segunda trava
--     que o dreno da Komune não tinha: um GATILHO na tabela `messages`
--     que recusa o `insert` e recusa a transição para `sent`. O dreno é
--     educado (descarta e registra); o gatilho é a parede.
--
-- O QUE ESTE ARQUIVO NÃO FAZ
-- ---------------------------------------------------------------------
--   · Não fala com a Meta nem com a Anthropic. Não existe credencial de
--     nenhuma das duas neste repositório, e não é para existir.
--   · Não liga o modo automático (RF-CON-09). Ele continua atrás da flag
--     `cadencia.modo_automatico.ligado = false`, e o gatilho de aprovação
--     deste arquivo o torna inócuo mesmo se alguém ligar a flag: sem
--     rascunho aprovado por gente, mensagem de IA não entra na tabela.
--   · Não escreve o worker. Escreve o contrato que ele vai obedecer.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- =====================================================================
-- A. O CUSTO DA IA DEIXA DE SER PROJEÇÃO
-- =====================================================================

-- ---------------------------------------------------------------------
-- A.1 A tabela de preços — porque custo não é opinião do worker
-- ---------------------------------------------------------------------
-- `ai_runs.cost_usd` podia chegar pronto do worker. Não chega: o Postgres
-- recalcula a partir dos tokens e desta tabela (ADR-03, "o banco é o
-- cérebro"). O motivo é prático, não doutrinário — um worker com a
-- constante errada, ou uma versão antiga rodando ao lado da nova, faria o
-- alerta de orçamento mentir por semanas sem ninguém notar. Recalcular
-- também dá a auditoria de graça: os preços mudam por `update` nesta
-- tabela, e o `audit_log` guarda o antes e o depois.
--
-- Os quatro números por modelo são os de `packages/prompts/src/nucleo/
-- custos.ts` (PRECOS), conferidos em 05/09/2026. Manter os dois lugares em
-- pé é escolha: o TypeScript precisa projetar sem banco (os evals rodam
-- sem rede), e o banco precisa medir sem TypeScript. O eval de custos
-- trava um; o pgTAP trava o outro; divergir fica visível.
create table if not exists public.ai_model_prices (
  model            text primary key,
  rotulo           text not null,
  -- US$ por milhão de tokens.
  entrada          numeric(10,4) not null check (entrada          >= 0),
  saida            numeric(10,4) not null check (saida            >= 0),
  escrita_de_cache numeric(10,4) not null check (escrita_de_cache >= 0),
  leitura_de_cache numeric(10,4) not null check (leitura_de_cache >= 0),
  vigente_desde    date not null default current_date,
  updated_at       timestamptz not null default now()
);
comment on table public.ai_model_prices is
  'Preço por milhão de tokens de cada modelo do ADR-10, em US$. É daqui que app.ai_custo tira a conta — o worker manda tokens, nunca dinheiro. Histórico de preço vive no audit_log; o custo de cada chamada fica congelado na linha de ai_runs.';

insert into public.ai_model_prices (model, rotulo, entrada, saida, escrita_de_cache, leitura_de_cache, vigente_desde) values
  ('claude-haiku-4-5',  'Claude Haiku 4.5 — classificação e extração (ADR-10)', 1.00,  5.00, 1.25, 0.10, date '2026-09-05'),
  ('claude-sonnet-5',   'Claude Sonnet 5 — rascunho, resumo e digest (ADR-10)', 2.00, 10.00, 2.50, 0.20, date '2026-09-05')
on conflict (model) do update
  set rotulo = excluded.rotulo, entrada = excluded.entrada, saida = excluded.saida,
      escrita_de_cache = excluded.escrita_de_cache, leitura_de_cache = excluded.leitura_de_cache,
      updated_at = now();

alter table public.ai_model_prices enable row level security;
drop policy if exists ai_model_prices_select on public.ai_model_prices;
create policy ai_model_prices_select on public.ai_model_prices
  for select to authenticated using ((select app.is_manager()));
drop policy if exists ai_model_prices_update on public.ai_model_prices;
create policy ai_model_prices_update on public.ai_model_prices
  for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

drop trigger if exists ai_model_prices_set_updated_at on public.ai_model_prices;
create trigger ai_model_prices_set_updated_at before update on public.ai_model_prices
  for each row execute function app.set_updated_at();
drop trigger if exists audit_ai_model_prices on public.ai_model_prices;
create trigger audit_ai_model_prices after insert or update or delete on public.ai_model_prices
  for each row execute function app.audit();


-- A.2 A conta. Batch custa metade dos dois lados (FATOR_BATCH em custos.ts).
create or replace function app.ai_custo(p_model            text,
                                        p_tokens_in        int,
                                        p_tokens_out       int,
                                        p_cache_write      int default 0,
                                        p_cache_read       int default 0,
                                        p_batch            boolean default false)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(
           ((coalesce(p_tokens_in, 0)    * pr.entrada
           + coalesce(p_tokens_out, 0)   * pr.saida
           + coalesce(p_cache_write, 0)  * pr.escrita_de_cache
           + coalesce(p_cache_read, 0)   * pr.leitura_de_cache) / 1000000.0)
           * case when coalesce(p_batch, false) then 0.5 else 1 end
         , 5)
    from public.ai_model_prices pr
   where pr.model = p_model
$$;
comment on function app.ai_custo(text,int,int,int,int,boolean) is
  'US$ de uma chamada, com 5 casas — a precisão de ai_runs.cost_usd e a mesma de custoDaChamada() em packages/prompts. Batch custa metade dos dois lados. Devolve null para modelo sem preço publicado: modelo sem preço não roda.';


-- ---------------------------------------------------------------------
-- A.3 `ai_runs` — toda chamada ao modelo, inclusive as que não saíram
-- ---------------------------------------------------------------------
-- Duas decisões que não são óbvias:
--
-- (a) TRÊS CONTADORES DE CACHE, não um. O R05 esboçou `tokens_cached`, no
--     singular. Não serve: escrita de cache custa 1,25× a entrada e leitura
--     custa 0,1× — 12,5 vezes de diferença. Com uma coluna só, o custo da
--     linha deixa de ser reproduzível a partir dela mesma, e "reproduzir a
--     conta" é o único jeito de descobrir que a conta está errada.
--
-- (b) A CHAMADA BLOQUEADA TAMBÉM É UMA LINHA. `prepararChamada` recusa a
--     chamada quando sobrou PII na mensagem montada (`PiiNaChamadaError`),
--     e o validador de promessas recusa o texto depois do modelo. Nos dois
--     casos houve trabalho, houve decisão e há o que aprender — e no
--     primeiro não houve gasto. Registrar só o que deu certo transformaria
--     o guardrail em silêncio: ninguém saberia quantas vezes ele segurou.
--     Por isso `status` tem 'bloqueado' e o `check` exige custo zero nele.
create table if not exists public.ai_runs (
  id               bigserial primary key,
  -- A lista é fechada porque é por ela que o custo é agrupado e o alerta é
  -- lido. Os quatro primeiros são os de PropositoDeAiRun em
  -- packages/prompts; os demais estão no PRD §9 e ainda não têm prompt.
  -- Propósito novo é migração + tipo novo no TypeScript, de propósito:
  -- gasto que ninguém nomeou é gasto que ninguém orçou.
  purpose          text not null check (purpose in ('transcribe_audio', 'summarize_call',
                                                    'draft_followup', 'classify_inbound',
                                                    'draft_reply', 'summarize_deal',
                                                    'next_action', 'digest',
                                                    'extract_listing', 'assistant')),
  model            text not null references public.ai_model_prices (model),
  -- "id@vN", de versaoDoPrompt(). Sem versão não dá para explicar uma saída
  -- ruim seis semanas depois (RF-CON-28).
  prompt_version   text not null check (prompt_version ~ '^[a-z0-9-]{3,60}@v[0-9]{1,3}$'),
  status           text not null default 'ok' check (status in ('ok', 'erro', 'bloqueado')),
  -- O vínculo: quase toda chamada nasce de uma ficha, e as de ligação
  -- nascem de uma atividade. Nenhum dos dois é obrigatório — o digest e o
  -- relatório semanal não têm dono — mas quando existe, existe com FK.
  organization_id  uuid references public.organizations (id) on delete set null,
  activity_id      uuid references public.activities (id)    on delete set null,
  conversation_id  uuid,   -- FK adicionada na seção C, quando a tabela existir
  batch            boolean not null default false,
  tokens_in        int not null default 0 check (tokens_in    >= 0),
  tokens_out       int not null default 0 check (tokens_out   >= 0),
  tokens_cache_write int not null default 0 check (tokens_cache_write >= 0),
  tokens_cache_read  int not null default 0 check (tokens_cache_read  >= 0),
  cost_usd         numeric(10,5) not null default 0 check (cost_usd >= 0),
  latency_ms       int check (latency_ms is null or latency_ms >= 0),
  -- A saída estruturada, para eval e para explicar uma decisão. Apagada em
  -- 90 dias por app.aplicar_retencao (R05 §retenção: `ai_runs.output` 90 d).
  output           jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  -- Bloqueado é chamada que NÃO chegou ao modelo (a PII foi vista antes de
  -- sair) ou cuja saída foi recusada. Custo zero, e o motivo escrito.
  constraint ai_runs_bloqueado_nao_gasta check (status <> 'bloqueado' or cost_usd = 0),
  constraint ai_runs_erro_tem_motivo     check (status <> 'erro' or length(trim(coalesce(error, ''))) > 0),
  -- ADR-09 outra vez, agora na saída do modelo: o que volta é gravado, e o
  -- que é gravado não pode carregar CPF. `app.tem_cpf` é a mesma função que
  -- a esteira de ingestão usa na entrada (RF-RAD-16), com dígito verificador.
  constraint ai_runs_sem_cpf check (output is null or not app.tem_cpf(output::text))
);
comment on table public.ai_runs is
  'Toda chamada ao modelo (ADR-09, ADR-10, RF-CON-28): propósito, modelo, versão do prompt, tokens dos quatro tipos, custo em US$, duração, saída e vínculo com a ficha, a atividade ou a conversa. Inclui as chamadas BLOQUEADAS pelo guardrail de PII e pelo validador de promessas — guardrail que não deixa rastro é guardrail que ninguém sabe se funciona.';
comment on column public.ai_runs.cost_usd is
  'Recalculado pelo Postgres a partir dos tokens e de ai_model_prices, no gatilho. O que o worker manda neste campo é ignorado: custo não é opinião de quem chama.';
comment on column public.ai_runs.output is
  'Saída estruturada do modelo. Apagada em 90 dias (PRD §10.6 / R05). Nunca guarda o texto original do fornecedor: o que vai ao modelo já vai pseudonimizado (ADR-09).';

create index if not exists ai_runs_purpose_day_idx on public.ai_runs (purpose, created_at desc);
create index if not exists ai_runs_dia_idx         on public.ai_runs (created_at desc);
create index if not exists ai_runs_org_idx         on public.ai_runs (organization_id, created_at desc)
  where organization_id is not null;
create index if not exists ai_runs_atividade_idx   on public.ai_runs (activity_id)
  where activity_id is not null;
create index if not exists ai_runs_output_idx      on public.ai_runs (created_at)
  where output is not null;

-- O gatilho que faz a conta e tranca a linha.
create or replace function app.ai_runs_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_custo numeric;
begin
  if tg_op = 'INSERT' then
    v_custo := app.ai_custo(new.model, new.tokens_in, new.tokens_out,
                            new.tokens_cache_write, new.tokens_cache_read, new.batch);
    if v_custo is null then
      raise exception 'Modelo % não tem preço publicado em ai_model_prices (ADR-10)', new.model
        using errcode = '23503';
    end if;
    new.cost_usd := case when new.status = 'bloqueado' then 0 else v_custo end;
    return new;
  end if;

  -- Append-only, com uma exceção: a retenção pode apagar a saída. Tudo o
  -- mais é história, e história que se edita não serve para auditar custo.
  if (to_jsonb(old) - 'output') is distinct from (to_jsonb(new) - 'output') then
    raise exception 'ai_runs é append-only: só `output` pode mudar (e só para null, pela retenção)'
      using errcode = '42501';
  end if;
  if new.output is not null then
    raise exception 'ai_runs.output só pode ser apagado, nunca reescrito'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists ai_runs_before_write on public.ai_runs;
create trigger ai_runs_before_write before insert or update on public.ai_runs
  for each row execute function app.ai_runs_before_write();

alter table public.ai_runs enable row level security;
-- Custo é assunto de quem responde por dinheiro. `sdr` e `embaixador` não
-- veem: a linha carrega a saída do modelo sobre fichas que podem não ser
-- deles, e ninguém precisa disso para trabalhar.
drop policy if exists ai_runs_select on public.ai_runs;
create policy ai_runs_select on public.ai_runs
  for select to authenticated
  using ((select app.role()) in ('admin'::app.user_role, 'gestor'::app.user_role,
                                 'financeiro'::app.user_role));
-- Sem policy de insert, update ou delete para `authenticated`: quem escreve
-- é o worker (service_role) e as funções definer. Tela não escreve custo.


-- ---------------------------------------------------------------------
-- A.4 O orçamento, e por que DOIS alertas
-- ---------------------------------------------------------------------
-- O PRD §10 pede alerta a 80% do orçamento. O agente dos prompts mediu o
-- gasto real (≈ US$ 4/mês) e apontou o problema: **num orçamento pequeno,
-- 80% do acumulado chega tarde**. Com teto de US$ 25, os US$ 20 só somam no
-- fim do mês — quando não sobra mês para reagir.
--
-- A DECISÃO, por escrito: ficam os dois, e o segundo é o que serve.
--
--   `passou_de_80` — o do PRD. Acumulado ≥ 80% do teto. Chega tarde e vale
--                    assim mesmo: é o número que aparece na fatura.
--   `ritmo_acima`  — o que chega a tempo. Projeta o fechamento do mês pelo
--                    ritmo dos dias úteis já decorridos. Cinco dias úteis
--                    com US$ 9 ainda não passaram de US$ 20, mas fecham o
--                    mês em US$ 37,80 — e isso aparece no quinto dia.
--
-- Três detalhes decididos aqui, e não em `custos.ts`:
--
--  (i) O DENOMINADOR É O CALENDÁRIO DE VERDADE. `VOLUME_MENSAL.diasUteis`
--      é 21, fixo, porque o TypeScript não tem a tabela de feriados. O
--      banco tem: `app.business_days` conhece domingo, sábado e o feriado
--      municipal de Natal. Um mês de 20 dias úteis projetado sobre 21
--      subestima o fechamento em 5% — pouco, mas é erro de graça. A
--      projeção aqui usa os dias úteis reais do mês, e devolve
--      `dias_uteis_do_mes` no payload para quem comparar com o TS saber
--      por que os números diferem.
--
-- (ii) O ALERTA DE RITMO SÓ VALE A PARTIR DO 3º DIA ÚTIL. Com um ou dois
--      dias, um único dia atípico (uma extração em lote do Radar) define a
--      reta e o alerta vira ruído — e alerta que vira ruído é alerta que
--      alguém desliga. A avaliação em si (`app.ai_gasto_do_mes`) não tem
--      esse piso, para continuar espelhando `avaliarOrcamento`; o piso
--      está em quem EMITE o alerta, que é outra pergunta.
--
-- (iii) O ORÇAMENTO É CONFIGURÁVEL E NASCE PENDENTE. US$ 25 é a fatia de
--      IA do teto de US$ 320/mês do PRD §10, e está marcado como pendente
--      de Rafael e Dennis no documento de custos. Fica em `app_settings`
--      porque é dinheiro, e dinheiro não se muda por migração.
insert into public.app_settings (key, value, description) values
  ('ia.orcamento',
   jsonb_build_object('mensal_usd', 25,
                      'fracao_alerta', 0.8,
                      'dias_minimos_para_ritmo', 3,
                      'pendente_de_aprovacao', true),
   'Orçamento mensal só de IA, em US$ (PRD §10; ADR-10). 25 é a fatia de IA do teto de 320/mês e nasce PENDENTE de confirmação de Rafael e Dennis. fracao_alerta = o alerta de 80% do PRD; dias_minimos_para_ritmo = a partir de quantos dias úteis o alerta de RITMO passa a valer.')
on conflict (key) do nothing;

-- Validação da chave nova, junto com a que já existia. Recriada inteira
-- porque é a mesma função; a parte de `cadencia.tetos` está intacta.
create or replace function app.app_settings_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c    text;
  duro int;
  v    int;
  frac numeric;
begin
  if new.key = 'cadencia.tetos' then
    if (new.value ->> 'inicio') is null then
      raise exception 'cadencia.tetos precisa de "inicio" (data de referência das semanas de aquecimento).'
        using errcode = '23514';
    end if;
    perform (new.value ->> 'inicio')::date;
    foreach c in array array['whatsapp', 'instagram', 'phone', 'presencial'] loop
      if new.value ? c then
        duro := coalesce((new.value -> c ->> 'teto_duro')::int, 0);
        if duro <= 0 then
          raise exception 'Canal % precisa de "teto_duro" positivo (RF-CON-10).', c using errcode = '23514';
        end if;
        foreach v in array array(select x.value::int
                                   from jsonb_each_text(new.value -> c) x
                                  where x.key <> 'teto_duro'
                                    and x.value ~ '^[0-9]+$') loop
          if v > duro then
            raise exception 'Teto de % (%) acima do teto duro do canal (%). RF-CON-10 não é negociável.',
              c, v, duro using errcode = '23514';
          end if;
        end loop;
      end if;
    end loop;
  end if;

  -- Orçamento de IA: teto positivo e fração dentro de (0, 1]. Um teto zero
  -- ou uma fração fora da faixa desligariam o alerta em silêncio, que é
  -- exatamente o modo de falha que este arquivo existe para evitar.
  if new.key = 'ia.orcamento' then
    if coalesce((new.value ->> 'mensal_usd')::numeric, 0) <= 0 then
      raise exception 'ia.orcamento precisa de "mensal_usd" positivo (PRD §10).' using errcode = '23514';
    end if;
    frac := coalesce((new.value ->> 'fracao_alerta')::numeric, 0);
    if frac <= 0 or frac > 1 then
      raise exception 'ia.orcamento."fracao_alerta" tem de ficar em (0, 1]; o PRD §10 pede 0,8.'
        using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

-- Onde o mês está. Espelha `avaliarOrcamento` de packages/prompts, com o
-- denominador do calendário de verdade (nota (i) acima).
create or replace function app.ai_gasto_do_mes(p_ref date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje      date    := (now() at time zone 'America/Fortaleza')::date;
  v_ref       date    := coalesce(p_ref, v_hoje);
  v_ini       date    := date_trunc('month', v_ref)::date;
  v_fim       date    := (date_trunc('month', v_ref) + interval '1 month - 1 day')::date;
  -- Até hoje quando o mês é o corrente; o mês inteiro quando já passou.
  v_ate       date    := least(v_fim, greatest(v_ini, case when v_ref >= v_hoje then v_hoje else v_ref end));
  v_cfg       jsonb;
  v_orc       numeric;
  v_frac      numeric;
  v_gasto     numeric;
  v_chamadas  int;
  v_bloq      int;
  v_du_mes    int;
  v_du_ate    int;
  v_proj      numeric;
  v_sit       text;
  v_por       jsonb;
begin
  select s.value into v_cfg from public.app_settings s where s.key = 'ia.orcamento';
  v_orc  := coalesce((v_cfg ->> 'mensal_usd')::numeric, 25);
  v_frac := coalesce((v_cfg ->> 'fracao_alerta')::numeric, 0.8);

  select coalesce(sum(r.cost_usd), 0),
         count(*)::int,
         count(*) filter (where r.status = 'bloqueado')::int
    into v_gasto, v_chamadas, v_bloq
    from public.ai_runs r
   where (r.created_at at time zone 'America/Fortaleza')::date between v_ini and v_ate;

  select coalesce(jsonb_object_agg(t.purpose, jsonb_build_object('chamadas', t.n, 'usd', t.usd)), '{}'::jsonb)
    into v_por
    from (select r.purpose, count(*)::int as n, round(sum(r.cost_usd), 5) as usd
            from public.ai_runs r
           where (r.created_at at time zone 'America/Fortaleza')::date between v_ini and v_ate
           group by r.purpose) t;

  v_du_mes := greatest(app.business_days(v_ini, v_fim), 1);
  v_du_ate := greatest(least(app.business_days(v_ini, v_ate), v_du_mes), 1);
  v_proj   := round((v_gasto / v_du_ate) * v_du_mes, 2);

  -- A ordem importa: quem já passou de 80% do acumulado passou, tenha o
  -- ritmo que tiver. `ritmo_acima` é o aviso de quem ainda não passou.
  v_sit := case
             when v_gasto >= v_orc * v_frac then 'passou_de_80'
             when v_proj  >  v_orc          then 'ritmo_acima'
             else                                'ok'
           end;

  return jsonb_build_object(
    'mes',                 to_char(v_ini, 'YYYY-MM'),
    'ate',                 v_ate,
    'gasto_usd',           round(v_gasto, 5),
    'chamadas',            v_chamadas,
    'bloqueadas',          v_bloq,
    'orcamento_usd',       v_orc,
    'limite_de_alerta_usd', round(v_orc * v_frac, 2),
    'dias_uteis_do_mes',   v_du_mes,
    'dias_uteis_decorridos', v_du_ate,
    'projecao_do_mes_usd', v_proj,
    'situacao',            v_sit,
    'por_proposito',       v_por);
end $$;
comment on function app.ai_gasto_do_mes(date) is
  'Onde o mês está: gasto acumulado, projeção do fechamento pelo ritmo dos dias úteis decorridos e a situação (ok | ritmo_acima | passou_de_80). Espelha avaliarOrcamento() de packages/prompts, com uma diferença deliberada: o denominador são os dias úteis REAIS do mês (app.business_days, que conhece feriado de Natal), não os 21 fixos do TypeScript.';

-- O registro do alerta. Existe para o alerta ser IDEMPOTENTE (um por mês e
-- por nível, e não um por execução do cron) e para alguém poder perguntar
-- depois "quando é que a gente soube?".
create table if not exists public.ai_budget_alerts (
  mes         text not null check (mes ~ '^[0-9]{4}-[0-9]{2}$'),
  situacao    text not null check (situacao in ('ritmo_acima', 'passou_de_80')),
  gasto_usd   numeric(10,5) not null,
  projecao_usd numeric(10,2) not null,
  orcamento_usd numeric(10,2) not null,
  task_id     uuid references public.tasks (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (mes, situacao)
);
comment on table public.ai_budget_alerts is
  'Um alerta de orçamento de IA por mês e por nível (PRD §10). A chave primária é a idempotência: o cron roda todo dia e o alerta nasce uma vez só.';

alter table public.ai_budget_alerts enable row level security;
drop policy if exists ai_budget_alerts_select on public.ai_budget_alerts;
create policy ai_budget_alerts_select on public.ai_budget_alerts
  for select to authenticated
  using ((select app.role()) in ('admin'::app.user_role, 'gestor'::app.user_role,
                                 'financeiro'::app.user_role));

create or replace function app.ai_alerta_orcamento()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado jsonb := app.ai_gasto_do_mes(null);
  v_sit    text  := v_estado ->> 'situacao';
  v_mes    text  := v_estado ->> 'mes';
  v_min    int;
  v_dono   uuid;
  v_task   uuid;
begin
  if v_sit = 'ok' then
    return jsonb_build_object('alertou', false, 'motivo', 'dentro_do_orcamento', 'estado', v_estado);
  end if;

  -- O piso de dias úteis (nota (ii)): só o alerta de RITMO espera. O de 80%
  -- do acumulado não espera nada — se o mês já gastou 80% no segundo dia, é
  -- justamente o segundo dia que precisa saber.
  select coalesce((s.value ->> 'dias_minimos_para_ritmo')::int, 3) into v_min
    from public.app_settings s where s.key = 'ia.orcamento';
  if v_sit = 'ritmo_acima' and (v_estado ->> 'dias_uteis_decorridos')::int < coalesce(v_min, 3) then
    return jsonb_build_object('alertou', false, 'motivo', 'poucos_dias_para_projetar', 'estado', v_estado);
  end if;

  if exists (select 1 from public.ai_budget_alerts a where a.mes = v_mes and a.situacao = v_sit) then
    return jsonb_build_object('alertou', false, 'motivo', 'ja_alertado', 'estado', v_estado);
  end if;

  -- A tarefa é como este banco fala com uma pessoa (mesmo caminho de
  -- app.precadastros_lembrete). Vai para um admin ativo; sem admin, o
  -- alerta ainda é gravado — perder o registro seria pior que perder o aviso.
  select p.id into v_dono
    from public.profiles p
   where p.is_active and p.role = 'admin'::app.user_role
   order by p.created_at
   limit 1;

  if v_dono is not null then
    insert into public.tasks (title, kind, due_at, assignee_id, origin, priority)
    values (case v_sit
              when 'passou_de_80' then 'Orçamento de IA: passou de 80% do teto do mês'
              else 'Orçamento de IA: o ritmo do mês projeta estouro'
            end
            || ' (' || v_mes || ') — gasto US$ ' || (v_estado ->> 'gasto_usd')
            || ', projeção US$ ' || (v_estado ->> 'projecao_do_mes_usd')
            || ' sobre teto de US$ ' || (v_estado ->> 'orcamento_usd'),
            'other'::app.task_kind,
            now(), v_dono, 'system', 1)
    returning id into v_task;
  end if;

  insert into public.ai_budget_alerts (mes, situacao, gasto_usd, projecao_usd, orcamento_usd, task_id)
  values (v_mes, v_sit,
          (v_estado ->> 'gasto_usd')::numeric,
          (v_estado ->> 'projecao_do_mes_usd')::numeric,
          (v_estado ->> 'orcamento_usd')::numeric,
          v_task)
  on conflict (mes, situacao) do nothing;

  return jsonb_build_object('alertou', true, 'situacao', v_sit, 'task_id', v_task, 'estado', v_estado);
end $$;
comment on function app.ai_alerta_orcamento() is
  'Emite, uma vez por mês e por nível, o alerta de orçamento de IA: passou_de_80 (o do PRD §10) e ritmo_acima (a projeção pelo ritmo, que é a que chega a tempo num orçamento pequeno). Cria tarefa para um admin e grava a linha em ai_budget_alerts. Idempotente por (mês, situação).';

-- A tela: gestor e admin perguntam ao banco onde o mês está.
create or replace function public.ia_orcamento_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or app.role() not in ('admin'::app.user_role, 'gestor'::app.user_role, 'financeiro'::app.user_role) then
    raise exception 'Sem permissão para ver o orçamento de IA' using errcode = '42501';
  end if;
  return app.ai_gasto_do_mes(null)
         || jsonb_build_object(
              'alertas_do_mes',
              coalesce((select jsonb_agg(jsonb_build_object('situacao', a.situacao, 'quando', a.created_at)
                                         order by a.created_at)
                          from public.ai_budget_alerts a
                         where a.mes = to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM')),
                       '[]'::jsonb));
end $$;
comment on function public.ia_orcamento_status() is
  'Painel do custo de IA para admin, gestor e financeiro: gasto do mês, projeção pelo ritmo, situação, quebra por propósito e os alertas já emitidos.';
revoke all on function public.ia_orcamento_status() from public, anon;
grant execute on function public.ia_orcamento_status() to authenticated, service_role;


-- =====================================================================
-- B. AS CONVERSAS — o container, o dono e a janela de 24 h
-- =====================================================================
-- Vem antes da fila de aprovação e das mensagens porque as duas apontam
-- para cá: o rascunho é rascunho DE uma conversa, e a mensagem é mensagem
-- DENTRO de uma conversa.
--
-- Duas regras nascem aqui, e as duas são de sistema, não de tela:
--
--   · CONVERSA SEM DONO É IMPOSSÍVEL (RF-CON-04). `assignee_id` é NOT NULL
--     e o gatilho o resolve sozinho quando o worker não informa: dono da
--     ficha → responsável padrão configurado → o admin mais antigo. Se não
--     houver nenhuma pessoa ativa no CRM, a conversa não nasce — e isso é
--     correto: não existe ninguém para responder. A mensagem crua não se
--     perde nesse caso, porque a Edge Function já a gravou em
--     `webhook_deliveries` e na fila antes de chegar aqui (RF-CON-03).
--
--   · A JANELA DE 24 H É DERIVADA, NUNCA DIGITADA. `window_expires_at` é
--     coluna gerada a partir de `last_inbound_at`. Ninguém "estende" a
--     janela: ela é uma consequência de a pessoa ter escrito, e a Meta
--     cobra por essa diferença. Campo derivado que alguém pode escrever
--     é campo que uma sexta-feira à noite escreve errado.
create table if not exists public.conversations (
  id                uuid primary key default gen_random_uuid(),
  channel           app.channel not null default 'whatsapp'::app.channel
                      check (channel in ('whatsapp'::app.channel, 'instagram'::app.channel)),
  -- O número do outro lado, em E.164 (regra do CLAUDE.md).
  peer_phone_e164   text not null check (peer_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- O número da empresa que fala: o "Heloísa · Komune" ou, quando existir,
  -- o Número 2 (RF-CON-01). O teto do RF-CON-10 é do NÚMERO, então o
  -- número precisa estar na linha desde o primeiro dia.
  business_number   text not null check (business_number ~ '^\+[1-9][0-9]{7,14}$'),
  organization_id   uuid references public.organizations (id) on delete set null,
  contact_id        uuid references public.contacts (id)      on delete set null,
  deal_id           uuid references public.deals (id)         on delete set null,
  assignee_id       uuid not null references public.profiles (id) on delete restrict,
  status            text not null default 'aguardando_nos'
                      check (status in ('aguardando_nos', 'aguardando_parceiro',
                                        'robo', 'resolvida')),
  -- Robô pausado: o estado transversal "Humano" do RF-CON-20. Quando é
  -- true, nenhum rascunho novo é gerado para esta conversa.
  bot_paused        boolean not null default false,
  last_message_at   timestamptz,
  last_inbound_at   timestamptz,
  last_outbound_at  timestamptz,
  -- Derivada de last_inbound_at pelo gatilho, sempre, sobrescrevendo o que
  -- vier de fora. Coluna gerada seria melhor e o Postgres não deixa:
  -- `timestamptz + interval` é STABLE, não IMMUTABLE (o resultado depende do
  -- fuso da sessão nas bordas de horário de verão). O gatilho dá a mesma
  -- garantia — ninguém escreve nesta coluna e sair vencendo o que veio no
  -- INSERT é justamente o ponto.
  window_expires_at timestamptz,
  unread_count      int not null default 0 check (unread_count >= 0),
  ai_summary        text,
  ai_intent         text,
  ai_confidence     numeric(4,3) check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  snoozed_until     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Um fio por par (número da empresa, número da pessoa). É o que faz o
  -- webhook achar a conversa sem inventar uma segunda.
  unique (channel, business_number, peer_phone_e164)
);
comment on table public.conversations is
  'Um fio de conversa por par (número da empresa × número da pessoa), com dono obrigatório (RF-CON-04) e a janela de 24 h da Meta como coluna derivada (R04 §2.1).';
comment on column public.conversations.window_expires_at is
  'Derivada de last_inbound_at pelo gatilho, que a reescreve em todo insert e update: dentro dela texto e áudio são livres e gratuitos; fora dela só template aprovado (R04 §2.1). Ninguém escreve nesta coluna — a janela é consequência de a pessoa ter escrito, não um campo que alguém estende.';
comment on column public.conversations.business_number is
  'O número da KOMUNE que fala nesta conversa (RF-CON-01). O teto diário do RF-CON-10 é por NÚMERO, e é por esta coluna que ele é contado.';

create index if not exists conversations_inbox_idx  on public.conversations (status, assignee_id, last_message_at desc);
create index if not exists conversations_org_idx    on public.conversations (organization_id) where organization_id is not null;
create index if not exists conversations_contato_idx on public.conversations (contact_id) where contact_id is not null;
create index if not exists conversations_deal_idx   on public.conversations (deal_id) where deal_id is not null;
create index if not exists conversations_janela_idx on public.conversations (window_expires_at desc) where last_inbound_at is not null;

-- Responsável padrão do inbox (RF-CON-04: "rodízio configurável com
-- Heloísa como padrão"). Nasce vazio; o rodízio é da v1.
insert into public.app_settings (key, value, description) values
  ('inbox.responsavel_padrao',
   jsonb_build_object('profile_id', null),
   'Quem herda a conversa que chega sem dono, quando a ficha também não tem responsável (RF-CON-04). Vazio = cai no admin mais antigo. O rodízio por categoria e carga é da v1 (RF-FUN-11).')
on conflict (key) do nothing;

create or replace function app.conversations_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dono uuid;
begin
  new.peer_phone_e164 := coalesce(app.normalize_phone_br(new.peer_phone_e164), new.peer_phone_e164);
  new.business_number := coalesce(app.normalize_phone_br(new.business_number), new.business_number);

  -- RF-CON-04: "mensagem não pode cair num grupo onde ninguém vê".
  if new.assignee_id is null then
    select o.owner_id into v_dono
      from public.organizations o where o.id = new.organization_id and o.owner_id is not null;
    if v_dono is null then
      select nullif(s.value ->> 'profile_id', '')::uuid into v_dono
        from public.app_settings s where s.key = 'inbox.responsavel_padrao';
    end if;
    if v_dono is not null and not exists (select 1 from public.profiles p where p.id = v_dono and p.is_active) then
      v_dono := null;
    end if;
    if v_dono is null then
      select p.id into v_dono
        from public.profiles p
       where p.is_active and p.role in ('admin'::app.user_role, 'gestor'::app.user_role,
                                        'sdr'::app.user_role)
       order by case p.role when 'admin'::app.user_role then 0
                            when 'gestor'::app.user_role then 1 else 2 end, p.created_at
       limit 1;
    end if;
    if v_dono is null then
      raise exception 'Conversa sem dono é impossível (RF-CON-04) e não há ninguém ativo para assumir esta'
        using errcode = '23502';
    end if;
    new.assignee_id := v_dono;
  end if;

  -- A janela é consequência de a pessoa ter escrito, nunca um campo que
  -- alguém estende. Recalculada em todo insert e todo update.
  new.window_expires_at := new.last_inbound_at + interval '24 hours';

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists conversations_before_write on public.conversations;
create trigger conversations_before_write before insert or update on public.conversations
  for each row execute function app.conversations_before_write();
drop trigger if exists audit_conversations on public.conversations;
create trigger audit_conversations after insert or update or delete on public.conversations
  for each row execute function app.audit();

alter table public.conversations enable row level security;
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated
  using ((select app.sees_all())
         or assignee_id = (select auth.uid())
         or ((select app.role()) = 'embaixador'::app.user_role
             and organization_id is not null
             and (select app.org_is_mine(conversations.organization_id))));
drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations
  for insert to authenticated with check ((select app.can_write()));
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations
  for update to authenticated
  using ((select app.is_manager()) or assignee_id = (select auth.uid()))
  with check ((select app.is_manager()) or assignee_id = (select auth.uid()));
drop policy if exists conversations_delete on public.conversations;
create policy conversations_delete on public.conversations
  for delete to authenticated using ((select app.is_admin()));

-- A pergunta que a tela faz o tempo todo, e o gatilho de envio também.
create or replace function app.janela_de_24h_aberta(p_conversation_id uuid,
                                                    p_quando timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.conversations c
                  where c.id = p_conversation_id
                    and c.window_expires_at is not null
                    and c.window_expires_at > coalesce(p_quando, now()))
$$;
comment on function app.janela_de_24h_aberta(uuid, timestamptz) is
  'A janela de atendimento da Meta: 24 h a contar da última mensagem recebida (R04 §2.1). Aberta = texto, áudio e mídia livres e gratuitos. Fechada = só template aprovado.';

-- Agora que `conversations` existe, `ai_runs` ganha a FK que ficou pendente.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_runs_conversation_id_fkey') then
    alter table public.ai_runs
      add constraint ai_runs_conversation_id_fkey
      foreign key (conversation_id) references public.conversations (id) on delete set null;
  end if;
end $$;
create index if not exists ai_runs_conversa_idx on public.ai_runs (conversation_id)
  where conversation_id is not null;


-- =====================================================================
-- C. A PERGUNTA ÚNICA — este envio ainda pode sair?
-- =====================================================================
-- A forma é a de `app.komune_motivo_de_recusa` (migração 000100), e pelo
-- mesmo motivo: uma função só, para que o gatilho da tabela, o dreno da
-- fila, a aprovação do rascunho e a RPC da tela usem literalmente o mesmo
-- critério. Duas cópias da mesma regra é como se cria a terceira.
--
-- Devolve null quando o envio é legítimo; o motivo, por escrito, quando
-- não é. A ordem do `case` decide só qual motivo é REGISTRADO quando mais
-- de um se aplica — e a supressão vem primeiro de propósito: é o guardrail
-- do CLAUDE.md ("nenhum envio a contato suprimido, em nenhum modo") e é o
-- que a pessoa quis dizer quando disse não.
--
-- Não entra aqui a janela de horário nem o teto: aqueles dizem "agora não"
-- e admitem "mais tarde"; estes dizem "nunca mais". Misturar os dois faria
-- um opt-out parecer com um fim de expediente.
create or replace function app.wa_motivo_de_recusa(p_organization_id uuid,
                                                   p_contact_id      uuid default null,
                                                   p_phone_e164      text default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           -- 1. A pergunta inteira: do_not_contact da ficha, do_not_contact da
           --    pessoa e a lista de supressão pelos três hashes.
           when p_organization_id is not null
                and app.is_suppressed_target(p_organization_id, p_contact_id)
             then 'contato_suprimido'
           -- 2. O número, mesmo quando a ficha ainda não sabe. É a ficha irmã
           --    que herdou o telefone de quem respondeu SAIR — o caso que
           --    fez `public.meu_dia` ser consertado na migração 000100.
           when p_phone_e164 is not null and app.is_suppressed(p_phone_e164, null, null)
             then 'numero_suprimido'
           when p_contact_id is not null
                and exists (select 1 from public.contacts c
                             where c.id = p_contact_id
                               and (c.deleted_at is not null or c.do_not_contact))
             then 'contato_apagado'
           when p_organization_id is not null
                and not exists (select 1 from public.organizations o
                                 where o.id = p_organization_id and o.deleted_at is null)
             then 'organizacao_apagada'
         end
$$;
comment on function app.wa_motivo_de_recusa(uuid, uuid, text) is
  'Por que esta mensagem NÃO pode mais sair: contato_suprimido, numero_suprimido, contato_apagado, organizacao_apagada. null = ainda é legítimo. Mesma forma de app.komune_motivo_de_recusa: um critério só, relido no instante da entrega. Janela de horário e teto ficam de fora de propósito — eles dizem "agora não", este diz "nunca mais".';


-- =====================================================================
-- D. A FILA DE APROVAÇÃO — o ADR-05 sai do parágrafo e vira gatilho
-- =====================================================================
-- "A IA classifica e redige, a PESSOA aprova. Nada sai sozinho."
--
-- Isso hoje é uma frase num documento. Uma frase não segura nada: basta um
-- `curl` com a chave de serviço, um worker com um `if` invertido ou uma
-- feature flag ligada por engano, e o texto sai. Por isso a garantia mora
-- aqui embaixo — a tabela guarda o rascunho, o gatilho guarda a máquina de
-- estados, e a seção F recusa qualquer mensagem de IA que não aponte para
-- um rascunho aprovado por gente.
--
-- O QUE É GUARDADO, E POR QUÊ SÃO DOIS TEXTOS
-- ---------------------------------------------------------------------
-- `proposed_body` é o que a IA escreveu, e é IMUTÁVEL. `final_body` é o que
-- a pessoa mandou de verdade. A diferença entre os dois é o dado mais
-- barato que existe para melhorar o prompt: se a Heloísa reescreve nove de
-- cada dez rascunhos, o prompt está errado e ninguém precisa de eval para
-- descobrir. Se o rascunho fosse sobrescrito na aprovação — que é o que
-- acontece quando existe uma coluna `body` só —, esse dado seria destruído
-- exatamente no momento em que é criado.
--
-- `foi_editado` é coluna gerada, não flag que alguém marca.
create table if not exists public.message_drafts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  conversation_id  uuid references public.conversations (id) on delete cascade,
  contact_id       uuid references public.contacts (id)      on delete set null,
  deal_id          uuid references public.deals (id)         on delete set null,
  channel          app.channel not null default 'whatsapp'::app.channel,
  -- Para que serve este rascunho. É o vocabulário do R08 e do R13.
  kind             text not null check (kind in ('followup_ligacao', 'resposta',
                                                 'objecao', 'onboarding', 'reativacao', 'outro')),
  -- De onde ele veio.
  ai_run_id        bigint references public.ai_runs (id) on delete set null,
  prompt_version   text,
  -- O que a IA propôs. Congelado.
  proposed_body    text not null check (length(trim(proposed_body)) > 0),
  proposed_audio_slug text references public.audio_assets (slug) on update cascade,
  -- claims[] do RF-CON-24: cada afirmação mapeada a um item da base de
  -- conhecimento. Fica na linha para a amostragem semanal do RF-CON-28
  -- poder perguntar "prometeu algo?" sem reprocessar nada.
  proposed_claims  jsonb not null default '[]'::jsonb,
  -- O veredito do validador determinístico (RF-CON-24), como ele saiu.
  validator        jsonb not null default '{}'::jsonb,
  status           text not null default 'pendente'
                     check (status in ('pendente', 'aprovado', 'enviado', 'descartado', 'expirado')),
  -- O que a pessoa mandou de verdade.
  final_body       text,
  foi_editado      boolean generated always as
                     (final_body is not null and final_body is distinct from proposed_body) stored,
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  discard_reason   text,
  message_id       uuid,   -- FK adicionada na seção E, quando `messages` existir
  expires_at       timestamptz not null default now() + interval '3 days',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Aprovado sem gente e sem texto não é aprovado.
  constraint message_drafts_aprovado_tem_gente check (
    status not in ('aprovado', 'enviado')
    or (reviewed_by is not null and reviewed_at is not null
        and length(trim(coalesce(final_body, ''))) > 0)),
  constraint message_drafts_descarte_tem_motivo check (
    status <> 'descartado' or length(trim(coalesce(discard_reason, ''))) > 0),
  -- RF-CON-24: 300 caracteres por turno. O limite é de forma, e forma que
  -- só a tela confere é forma que o `curl` ignora.
  constraint message_drafts_tamanho check (
    length(proposed_body) <= 1000 and (final_body is null or length(final_body) <= 1000))
);
comment on table public.message_drafts is
  'A fila de aprovação do human-in-the-loop (ADR-05, RF-CON-22): o que a IA propôs (imutável), o que a pessoa mandou de verdade, quem aprovou e quando. Nenhuma mensagem de IA sai sem uma linha daqui em status aprovado — a garantia é do gatilho de `messages`, não da tela.';
comment on column public.message_drafts.foi_editado is
  'Derivada: a pessoa mexeu no que a IA escreveu? É o sinal mais barato de que um prompt precisa de v2 (RF-CON-28). Por isso proposed_body é imutável: sobrescrevê-lo na aprovação destruiria este dado no instante em que ele nasce.';
comment on column public.message_drafts.validator is
  'Veredito do validador determinístico de promessas (RF-CON-24) sobre o texto proposto, como ele saiu de packages/prompts. Rascunho bloqueado pelo validador continua entrando aqui: é a prova de que o guardrail agiu.';

create index if not exists message_drafts_fila_idx  on public.message_drafts (created_at)
  where status = 'pendente';
create index if not exists message_drafts_org_idx   on public.message_drafts (organization_id, created_at desc);
create index if not exists message_drafts_conv_idx  on public.message_drafts (conversation_id, created_at desc)
  where conversation_id is not null;
create index if not exists message_drafts_run_idx   on public.message_drafts (ai_run_id) where ai_run_id is not null;
create index if not exists message_drafts_revisor_idx on public.message_drafts (reviewed_by) where reviewed_by is not null;
-- Um rascunho pendente por conversa: fila de aprovação com três rascunhos
-- do mesmo fio é fila que faz a pessoa escolher entre versões da mesma
-- coisa, e é assim que a segunda sai por engano depois da primeira.
create unique index if not exists message_drafts_um_pendente_por_conversa
  on public.message_drafts (conversation_id)
  where status = 'pendente' and conversation_id is not null;

-- ---------------------------------------------------------------------
-- D.1 O gatilho — a máquina de estados que não se contorna
-- ---------------------------------------------------------------------
-- Cinco regras, e a terceira é a razão de o arquivo existir:
--
--   1. O que a IA propôs é imutável (proposed_body, claims, run, versão).
--   2. As transições são só estas:
--        pendente  → aprovado | descartado | expirado
--        aprovado  → enviado  | descartado
--        enviado / descartado / expirado → nada (terminais)
--   3. QUEM APROVA É GENTE. Aprovar exige `auth.uid()` — que o worker, com
--      a chave de serviço, não tem — e exige que `reviewed_by` seja essa
--      mesma pessoa, com papel que escreve e diferente de 'bot'. Um worker
--      não pode aprovar o próprio rascunho nem em teoria: ele não consegue
--      preencher a condição.
--   4. NA APROVAÇÃO, RECONFERE. Entre a IA redigir e a pessoa clicar passa
--      tempo — às vezes um dia. É o intervalo do dreno da Komune, de novo:
--      se a pessoa pediu para sair nesse meio, o rascunho morre aqui, e
--      não na hora do envio.
--   5. Marcar 'enviado' é do worker: é ele que fala com a Meta. Mas só
--      consegue partindo de 'aprovado'.
create or replace function app.message_drafts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_papel  app.user_role;
  v_motivo text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pendente' then
      raise exception 'Rascunho nasce pendente: a aprovação é um ato posterior e de outra pessoa (ADR-05)'
        using errcode = '23514';
    end if;
    -- Rascunho para quem já disse não não chega nem a ser oferecido.
    v_motivo := app.wa_motivo_de_recusa(new.organization_id, new.contact_id, null);
    if v_motivo is not null then
      raise exception 'Rascunho recusado na origem: % (RF-CON-18)', v_motivo using errcode = '42501';
    end if;
    return new;
  end if;

  -- (1) o que a IA propôs não se reescreve
  if new.proposed_body     is distinct from old.proposed_body
     or new.proposed_claims is distinct from old.proposed_claims
     or new.ai_run_id       is distinct from old.ai_run_id
     or new.prompt_version  is distinct from old.prompt_version
     or new.proposed_audio_slug is distinct from old.proposed_audio_slug
     or new.validator       is distinct from old.validator then
    raise exception 'O que a IA propôs é imutável: a diferença entre proposto e enviado é o dado que melhora o prompt'
      using errcode = '42501';
  end if;

  if new.status = old.status then
    new.updated_at := now();
    return new;
  end if;

  -- (2) transições permitidas
  if not ((old.status = 'pendente' and new.status in ('aprovado', 'descartado', 'expirado'))
       or (old.status = 'aprovado' and new.status in ('enviado', 'descartado'))) then
    raise exception 'Transição de rascunho inválida: % → %', old.status, new.status using errcode = '23514';
  end if;

  if new.status = 'aprovado' then
    -- (3) quem aprova é gente
    if v_uid is null or app.e_o_worker() then
      raise exception 'Aprovação de rascunho exige uma pessoa autenticada (ADR-05): automação não aprova a si mesma'
        using errcode = '42501';
    end if;
    if new.reviewed_by is distinct from v_uid then
      raise exception 'Quem aprova assina: reviewed_by tem de ser quem está logado (RF-ADM-03)'
        using errcode = '42501';
    end if;
    select p.role into v_papel from public.profiles p where p.id = v_uid and p.is_active;
    if v_papel is null or v_papel not in ('admin'::app.user_role, 'gestor'::app.user_role,
                                          'sdr'::app.user_role, 'embaixador'::app.user_role) then
      raise exception 'Papel % não aprova envio (ADR-05)', coalesce(v_papel::text, 'inexistente')
        using errcode = '42501';
    end if;
    new.reviewed_at := coalesce(new.reviewed_at, now());

    -- (4) o mundo muda entre redigir e aprovar
    v_motivo := app.wa_motivo_de_recusa(new.organization_id, new.contact_id, null);
    if v_motivo is not null then
      raise exception 'Não dá para aprovar: % (a pessoa mudou de ideia depois de a IA escrever)', v_motivo
        using errcode = '42501';
    end if;
  end if;

  if new.status = 'descartado' and v_uid is not null then
    new.reviewed_by := coalesce(new.reviewed_by, v_uid);
    new.reviewed_at := coalesce(new.reviewed_at, now());
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists message_drafts_guard on public.message_drafts;
create trigger message_drafts_guard before insert or update on public.message_drafts
  for each row execute function app.message_drafts_guard();
drop trigger if exists audit_message_drafts on public.message_drafts;
create trigger audit_message_drafts after insert or update or delete on public.message_drafts
  for each row execute function app.audit();

alter table public.message_drafts enable row level security;
drop policy if exists message_drafts_select on public.message_drafts;
create policy message_drafts_select on public.message_drafts
  for select to authenticated
  using ((select app.org_is_visible(message_drafts.organization_id)));
-- Quem escreve rascunho é a IA (worker, service_role) e as RPC definer.
-- Uma pessoa não digita um "rascunho da IA": ela digita uma mensagem.
drop policy if exists message_drafts_update on public.message_drafts;
create policy message_drafts_update on public.message_drafts
  for update to authenticated
  using ((select app.can_write()) and (select app.org_is_visible(message_drafts.organization_id)))
  with check ((select app.can_write()) and (select app.org_is_visible(message_drafts.organization_id)));
drop policy if exists message_drafts_delete on public.message_drafts;
create policy message_drafts_delete on public.message_drafts
  for delete to authenticated using ((select app.is_admin()));

-- ---------------------------------------------------------------------
-- D.2 As duas RPC da tela: aprovar (com edição) e descartar
-- ---------------------------------------------------------------------
create or replace function public.aprovar_rascunho(p_draft_id uuid,
                                                   p_texto_final text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.message_drafts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sem sessão' using errcode = '42501';
  end if;
  select * into d from public.message_drafts where id = p_draft_id;
  if not found then
    raise exception 'Rascunho não encontrado' using errcode = 'P0002';
  end if;
  if not app.org_is_visible(d.organization_id) then
    raise exception 'Sem permissão sobre esta ficha' using errcode = '42501';
  end if;

  update public.message_drafts
     set status      = 'aprovado',
         final_body  = coalesce(nullif(trim(p_texto_final), ''), proposed_body),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_draft_id and status = 'pendente'
  returning * into d;

  if d.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'rascunho_nao_estava_pendente');
  end if;
  return jsonb_build_object('ok', true, 'draft_id', d.id,
                            'foi_editado', d.foi_editado, 'aprovado_em', d.reviewed_at);
end $$;
comment on function public.aprovar_rascunho(uuid, text) is
  'A pessoa aprova o rascunho da IA, com ou sem edição (ADR-05, RF-CON-22). Sem texto novo, vale o que a IA escreveu; com texto novo, o proposto é preservado e foi_editado passa a true. A aprovação reconfere supressão: quem pediu para sair entre a redação e o clique não recebe.';

create or replace function public.descartar_rascunho(p_draft_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.message_drafts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sem sessão' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Descarte sem motivo não ensina nada ao prompt' using errcode = '23514';
  end if;
  select * into d from public.message_drafts where id = p_draft_id;
  if not found or not app.org_is_visible(d.organization_id) then
    raise exception 'Rascunho não encontrado ou fora da sua carteira' using errcode = '42501';
  end if;

  update public.message_drafts
     set status = 'descartado', discard_reason = trim(p_motivo),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_draft_id and status in ('pendente', 'aprovado')
  returning * into d;

  return jsonb_build_object('ok', d.id is not null, 'draft_id', p_draft_id);
end $$;
comment on function public.descartar_rascunho(uuid, text) is
  'Joga fora o rascunho da IA com o motivo por escrito. O motivo é obrigatório: descarte mudo é o mesmo que o prompt não ter errado.';

revoke all on function public.aprovar_rascunho(uuid, text)   from public, anon;
revoke all on function public.descartar_rascunho(uuid, text) from public, anon;
grant execute on function public.aprovar_rascunho(uuid, text)   to authenticated;
grant execute on function public.descartar_rascunho(uuid, text) to authenticated;


-- =====================================================================
-- E. AS MENSAGENS — entrada, saída, wamid, entrega
-- =====================================================================
-- Três coisas que a tabela precisa garantir sozinha, sem worker cooperando:
--
--   · IDEMPOTÊNCIA POR `wa_message_id` (RF-CON-03). A Meta reentrega o
--     mesmo webhook quando não recebe 200 a tempo. Um índice único parcial
--     resolve o caso inteiro, e resolve melhor do que qualquer `if exists`
--     no worker: dois webhooks simultâneos passam pelo `if` e só um passa
--     pelo índice.
--   · A EXCEÇÃO DA CONFIRMAÇÃO DE OPT-OUT. O RF-CON-19 manda confirmar a
--     supressão em uma linha — ou seja, manda enviar UMA mensagem para
--     alguém que acabou de entrar na lista de supressão. É a única mensagem
--     do sistema que atravessa o guardrail, e por isso ela é uma coluna
--     declarada (`optout_confirmation`) com índice único por conversa:
--     "confirmação única" vira uma constraint, não uma boa intenção.
--   · MENSAGEM DE IA APONTA PARA UM RASCUNHO APROVADO. É a seção D
--     ganhando dentes.
create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  -- Denormalizado do fio, preenchido pelo gatilho: relatório de mensagem
  -- por ficha não pode depender de um join com a conversa que pode ter
  -- perdido a ficha depois.
  organization_id  uuid references public.organizations (id) on delete cascade,
  contact_id       uuid references public.contacts (id)      on delete set null,
  direction        app.msg_direction not null,
  type             app.msg_type not null default 'text'::app.msg_type,
  status           app.msg_status not null default 'queued'::app.msg_status,
  -- O wamid da Meta. Único quando existe: é a idempotência do webhook.
  wa_message_id    text check (wa_message_id is null or length(trim(wa_message_id)) between 3 and 200),
  body             text,
  media_path       text,          -- Storage privado
  media_mime       text,
  media_id         text,          -- id da mídia na Meta, para baixar uma vez
  transcript       text,          -- faster-whisper local (RF-CON-27); áudio não vira token
  template_id      int  references public.message_templates (id) on delete set null,
  template_params  jsonb not null default '[]'::jsonb,
  audio_asset_id   uuid references public.audio_assets (id) on delete set null,
  draft_id         uuid references public.message_drafts (id) on delete set null,
  cadence_touch_id uuid references public.cadence_touches (id) on delete set null,
  activity_id      uuid references public.activities (id) on delete set null,
  -- Quem escreveu, no mesmo vocabulário de `activities.author_kind`.
  author_kind      text not null default 'system'
                     check (author_kind in ('human', 'bot_fixed', 'bot_ai', 'system')),
  sent_by          uuid references public.profiles (id) on delete set null,
  approved_by      uuid references public.profiles (id) on delete set null,
  -- RF-CON-10: o teto é de PRIMEIROS CONTATOS por dia e por número.
  is_first_contact boolean not null default false,
  -- Iniciada pela empresa = fora da janela de 24 h. É o que a Meta cobra e
  -- o que os tetos de 150/dia e 60/hora limitam. Calculado no gatilho.
  business_initiated boolean not null default false,
  -- A única mensagem que pode sair para quem está suprimido (RF-CON-19).
  optout_confirmation boolean not null default false,
  billable_category text check (billable_category is null or
                                billable_category in ('marketing', 'utility', 'authentication', 'service')),
  cost_usd         numeric(8,5) check (cost_usd is null or cost_usd >= 0),
  error_code       text,
  error_detail     text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  delivered_at     timestamptz,
  read_at          timestamptz,
  failed_at        timestamptz,
  -- Texto vazio não é mensagem; mídia sem tipo de mídia, também não.
  constraint messages_tem_conteudo check (
    type <> 'text'::app.msg_type or length(trim(coalesce(body, ''))) > 0),
  -- ADR-09 na terceira porta: o que a gente escreve para o fornecedor não
  -- carrega CPF. `app.tem_cpf` valida dígito verificador (RF-RAD-16).
  constraint messages_sem_cpf check (body is null or not app.tem_cpf(body)),
  -- Recebida não tem autor nosso; enviada não tem `received`.
  constraint messages_direcao_e_status check (
    (direction = 'in'::app.msg_direction
       and status in ('received'::app.msg_status, 'read'::app.msg_status)
       and author_kind = 'system' and draft_id is null)
    or (direction = 'out'::app.msg_direction
        and status in ('queued'::app.msg_status, 'sent'::app.msg_status,
                       'delivered'::app.msg_status, 'read'::app.msg_status,
                       'failed'::app.msg_status))),
  constraint messages_falha_tem_motivo check (
    status <> 'failed'::app.msg_status or length(trim(coalesce(error_code, ''))) > 0)
);
comment on table public.messages is
  'Toda mensagem de WhatsApp e Instagram, nos dois sentidos (RF-CON-03 a RF-CON-06): wamid da Meta (idempotência do webhook), estado de entrega, custo, e o vínculo com a conversa, a ficha e — quando foi a IA que redigiu — o rascunho aprovado por uma pessoa.';
comment on column public.messages.optout_confirmation is
  'A única mensagem que sai para contato suprimido: a confirmação em uma linha que o RF-CON-19 exige. Índice único por conversa — "confirmação única" é constraint, não boa intenção.';
comment on column public.messages.business_initiated is
  'Verdadeiro quando a mensagem saiu com a janela de 24 h fechada. É o que a Meta cobra como template e o que os tetos de 150/dia e 60/hora do RF-CON-10 limitam. Calculado pelo gatilho, nunca informado.';

create unique index if not exists messages_wamid_uq on public.messages (wa_message_id)
  where wa_message_id is not null;
create unique index if not exists messages_uma_confirmacao_de_optout
  on public.messages (conversation_id) where optout_confirmation;
create index if not exists messages_conv_idx    on public.messages (conversation_id, created_at);
create index if not exists messages_org_idx     on public.messages (organization_id, created_at desc)
  where organization_id is not null;
create index if not exists messages_fila_idx    on public.messages (created_at)
  where status = 'queued'::app.msg_status;
create index if not exists messages_teto_idx    on public.messages (created_at)
  where direction = 'out'::app.msg_direction and is_first_contact;
create index if not exists messages_draft_idx   on public.messages (draft_id) where draft_id is not null;
create index if not exists messages_toque_idx   on public.messages (cadence_touch_id) where cadence_touch_id is not null;
create index if not exists messages_contato_idx on public.messages (contact_id) where contact_id is not null;
create index if not exists messages_atividade_idx on public.messages (activity_id) where activity_id is not null;

-- As FKs que ficaram pendentes por ordem de criação.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'message_drafts_message_id_fkey') then
    alter table public.message_drafts
      add constraint message_drafts_message_id_fkey
      foreign key (message_id) references public.messages (id) on delete set null;
  end if;
  -- `activities.message_id` existe desde a migração 000300 e nunca teve
  -- para onde apontar. Agora tem.
  if not exists (select 1 from pg_constraint where conname = 'activities_message_id_fkey') then
    alter table public.activities
      add constraint activities_message_id_fkey
      foreign key (message_id) references public.messages (id) on delete set null;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- E.1 O teto é do NÚMERO, e agora ele soma tudo
-- ---------------------------------------------------------------------
-- `app.toques_do_dia` (migração 001700) contava só os toques de cadência, e
-- o comentário dela dizia, textualmente: "NOTA para quando a fila assistida
-- do RF-CON-08 existir: os envios feitos FORA da cadência precisarão ser
-- somados aqui, porque o teto do RF-CON-10 é do NÚMERO, não da cadência."
--
-- A fila assistida existe a partir desta migração. A nota é paga aqui.
--
-- Sem isto, o teto seria contornável sem ninguém mentir: 20 toques de
-- cadência + 20 primeiros contatos da fila do dia = 40 aberturas num dia de
-- teto 20, com as duas contagens dizendo "dentro do limite".
--
-- O que NÃO é somado, e por quê: mensagem de cadência que já virou toque
-- (`cadence_touch_id` preenchido) seria contada duas vezes; resposta dentro
-- da janela não é primeiro contato e nunca contou; mensagem falhada não
-- chegou a ninguém.
create or replace function app.primeiros_contatos_do_dia(p_channel app.channel,
                                                         p_dia     date,
                                                         p_numero  text default null)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select (
    -- (a) os toques de cadência agendados ou feitos no dia (contagem antiga)
    select count(*)::int
      from public.cadence_touches t
     where t.channel = p_channel
       and t.status in ('pendente'::app.touch_status, 'feito'::app.touch_status)
       and (t.due_at at time zone 'America/Fortaleza')::date = p_dia
  ) + (
    -- (b) os primeiros contatos disparados FORA da cadência (RF-CON-08)
    select count(*)::int
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where m.direction = 'out'::app.msg_direction
       and m.is_first_contact
       and m.cadence_touch_id is null
       and m.status <> 'failed'::app.msg_status
       and c.channel = p_channel
       and (p_numero is null or c.business_number = p_numero)
       and (coalesce(m.sent_at, m.created_at) at time zone 'America/Fortaleza')::date = p_dia
  )
$$;
comment on function app.primeiros_contatos_do_dia(app.channel, date, text) is
  'Quantos primeiros contatos aquele canal (e, quando informado, aquele número) já gastou no dia: toques de cadência MAIS os envios da fila assistida feitos fora da cadência. Paga a nota que app.toques_do_dia deixou escrita em 001700: o teto do RF-CON-10 é do NÚMERO, não da cadência. Pendência conhecida: cadence_touches ainda não carrega o número, então a parcela (a) é por canal — enquanto existir um número só, canal e número são a mesma coisa (RF-CON-01).';

-- `app.toques_do_dia` passa a ser um apelido: quem já a chamava (a porteira
-- `app.pode_tocar`, e portanto toda a cadência) herda a soma completa sem
-- mudar uma linha.
create or replace function app.toques_do_dia(p_channel app.channel, p_dia date)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select app.primeiros_contatos_do_dia(p_channel, p_dia, null)
$$;
comment on function app.toques_do_dia(app.channel, date) is
  'Consumo do teto diário do canal (RF-CON-10). Desde 20260905000200 delega para app.primeiros_contatos_do_dia, que soma a cadência E a fila assistida — a nota deixada em 001700 está paga.';

-- Os outros dois tetos do RF-CON-10, que são de VOLUME e não de aberturas:
-- ≤ 150 mensagens iniciadas pela empresa por dia e ≤ 60 por hora.
insert into public.app_settings (key, value, description) values
  ('whatsapp.envio',
   jsonb_build_object('numero_padrao', null,
                      'teto_iniciadas_dia', 150,
                      'teto_iniciadas_hora', 60,
                      'intervalo_min_seg', 45,
                      'intervalo_max_seg', 180),
   'Tetos de volume do RF-CON-10 que não são de primeiro contato: mensagens iniciadas pela empresa por dia e por hora, e o intervalo aleatório entre envios (R04 §4). numero_padrao vazio até o Número 2 existir (RF-CON-01).')
on conflict (key) do nothing;

create or replace function app.iniciadas_pela_empresa(p_numero text,
                                                      p_de timestamptz,
                                                      p_ate timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.direction = 'out'::app.msg_direction
     and m.business_initiated
     and m.status <> 'failed'::app.msg_status
     and (p_numero is null or c.business_number = p_numero)
     and coalesce(m.sent_at, m.created_at) >= p_de
     and coalesce(m.sent_at, m.created_at) <  p_ate
$$;


-- ---------------------------------------------------------------------
-- E.2 `app.pode_enviar` — a porteira, na forma de `app.pode_tocar`
-- ---------------------------------------------------------------------
-- Devolve {pode, motivo, quando}. `quando` é a próxima hora em que valeria
-- a pena tentar de novo, e é null quando não existe essa hora — que é a
-- diferença entre "ainda não" e "nunca mais".
--
-- A ordem é a mesma de `app.pode_tocar`, e não é arbitrária: primeiro o que
-- é definitivo (supressão), depois o que é temporário (janela, teto). Ler o
-- teto antes da supressão faria um opt-out aparecer na tela como "tente
-- amanhã".
create or replace function app.pode_enviar(p_conversation_id uuid,
                                           p_primeiro_contato boolean default false,
                                           p_tem_template     boolean default false,
                                           p_quando           timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c          public.conversations%rowtype;
  v_quando   timestamptz := coalesce(p_quando, now());
  v_dia      date;
  v_motivo   text;
  v_janela   jsonb;
  v_respondeu boolean;
  v_teto     int;
  v_usados   int;
  v_cfg      jsonb;
  v_td       int;
  v_th       int;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('pode', false, 'motivo', 'conversa_inexistente', 'quando', null);
  end if;

  -- 1 · Nunca mais.
  v_motivo := app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164);
  if v_motivo is not null then
    return jsonb_build_object('pode', false, 'motivo', v_motivo, 'quando', null);
  end if;

  -- 2 · Dentro da janela de 24 h, responder é livre: foi a pessoa que
  --     escreveu, e responder rápido é o que a política da Meta e o
  --     RF-CON-04 pedem. Primeiro contato nunca cai aqui — por definição
  --     não existe janela aberta com quem nunca falou com a gente.
  if not p_primeiro_contato and app.janela_de_24h_aberta(c.id, v_quando) then
    return jsonb_build_object('pode', true, 'motivo', null, 'quando', v_quando);
  end if;

  -- 3 · Daqui para baixo é mensagem INICIADA PELA EMPRESA. Fora da janela,
  --     só template aprovado atravessa (R04 §2.1) — é regra da Meta, e
  --     tentar mandar texto livre não dá erro nosso, dá erro deles.
  if not p_tem_template and not app.janela_de_24h_aberta(c.id, v_quando) then
    return jsonb_build_object('pode', false, 'motivo', 'sem_janela_e_sem_template', 'quando', null);
  end if;

  -- 4 · Janela de horário (RF-CON-11): domingo, feriado e fora de hora saem
  --     daqui, porque `app.janela_do_canal` já os trata e devolve a próxima
  --     abertura em America/Fortaleza.
  v_respondeu := c.organization_id is not null and app.ja_respondeu(c.organization_id);
  v_janela := app.janela_do_canal(c.channel, v_quando, v_respondeu);
  if not coalesce((v_janela ->> 'aberta')::boolean, false) then
    return jsonb_build_object('pode', false,
                              'motivo', 'janela_' || coalesce(v_janela ->> 'motivo', 'fechada'),
                              'quando', (v_janela ->> 'abre_em')::timestamptz);
  end if;

  v_dia := (v_quando at time zone 'America/Fortaleza')::date;

  -- 5 · Teto de PRIMEIROS CONTATOS do dia, por canal e por número.
  if p_primeiro_contato then
    v_teto   := app.teto_do_canal(c.channel, v_dia);
    v_usados := app.primeiros_contatos_do_dia(c.channel, v_dia, c.business_number);
    if v_usados >= v_teto then
      return jsonb_build_object('pode', false, 'motivo', 'teto_do_numero',
                                'quando', app.proxima_abertura_do_canal(v_dia, c.channel, v_respondeu),
                                'usados', v_usados, 'teto', v_teto);
    end if;
  end if;

  -- 6 · Tetos de volume iniciado pela empresa: 150/dia e 60/hora (RF-CON-10).
  select s.value into v_cfg from public.app_settings s where s.key = 'whatsapp.envio';
  v_td := coalesce((v_cfg ->> 'teto_iniciadas_dia')::int, 150);
  v_th := coalesce((v_cfg ->> 'teto_iniciadas_hora')::int, 60);
  if app.iniciadas_pela_empresa(c.business_number,
                                (v_dia::timestamp at time zone 'America/Fortaleza'),
                                ((v_dia + 1)::timestamp at time zone 'America/Fortaleza')) >= v_td then
    return jsonb_build_object('pode', false, 'motivo', 'teto_iniciadas_dia',
                              'quando', app.proxima_abertura_do_canal(v_dia, c.channel, v_respondeu));
  end if;
  if app.iniciadas_pela_empresa(c.business_number, v_quando - interval '1 hour', v_quando) >= v_th then
    return jsonb_build_object('pode', false, 'motivo', 'teto_iniciadas_hora',
                              'quando', v_quando + interval '1 hour');
  end if;

  return jsonb_build_object('pode', true, 'motivo', null, 'quando', v_quando);
end $$;
comment on function app.pode_enviar(uuid, boolean, boolean, timestamptz) is
  'A porteira do envio, na forma de app.pode_tocar: supressão (nunca mais) → janela de 24 h → template obrigatório fora dela → janela de horário do RF-CON-11 (domingo e feriado inclusos) → teto de primeiros contatos por número → tetos de 150/dia e 60/hora. Devolve {pode, motivo, quando}; `quando` null significa que não existe uma próxima hora.';


-- ---------------------------------------------------------------------
-- E.3 A origem da linha: pedido de envio, eco do celular ou importação
-- ---------------------------------------------------------------------
-- No modo assistido (RF-CON-08), a Heloísa manda o primeiro contato pelo
-- WhatsApp Business App e o Coexistence eco-sincroniza (`smb_message_echoes`,
-- R04 §2.1). Essa linha não é um PEDIDO de envio: é o REGISTRO de um envio
-- que já aconteceu, feito por uma pessoa, com o polegar dela.
--
-- Recusá-la seria repetir, ao contrário, o erro que a migração 000100
-- deixou explicado no caso do `desfecho_pendente` do `meu_dia`: barrar o
-- registro do que já aconteceu não desfaz o que aconteceu — só apaga a
-- prova. Se a Heloísa mandou uma mensagem para alguém que tinha acabado de
-- pedir para sair, o CRM precisa saber disso mais do que nunca.
--
-- Por isso o eco entra sempre, e por isso ele CONTA no teto: quem gastou o
-- número foi ele. O que o eco não pode é entrar dizendo que é IA sem
-- rascunho — e não pode fingir ser eco: `authenticated` só insere com
-- origem 'crm' (a policy), e eco sem wamid da Meta não é eco.
alter table public.messages
  add column if not exists origin text not null default 'crm';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_origin_check') then
    alter table public.messages add constraint messages_origin_check
      check (origin in ('crm', 'echo', 'import'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_eco_tem_wamid') then
    alter table public.messages add constraint messages_eco_tem_wamid
      check (origin <> 'echo' or wa_message_id is not null);
  end if;
end $$;
comment on column public.messages.origin is
  'crm = o Tríade pediu o envio (passa por toda a porteira); echo = a pessoa mandou pelo celular e o Coexistence avisou (registro do que já aconteceu, entra sempre e conta no teto); import = carga histórica.';


-- ---------------------------------------------------------------------
-- E.4 O GATILHO — a parede
-- ---------------------------------------------------------------------
-- O dreno da seção F é educado: descarta o que não pode mais sair e escreve
-- o motivo. Este gatilho é a parede: ele levanta exceção. Os dois existem
-- porque respondem a perguntas diferentes — o dreno responde "o que faço
-- com a fila?", o gatilho responde "e se alguém não usar a fila?".
--
-- E ele roda DUAS vezes na vida de uma mensagem: quando ela entra em
-- `queued` e quando ela passa para `sent`. É a lição inteira da migração
-- 000100 — entre enfileirar e entregar existe tempo, e no tempo o mundo
-- muda. Uma mensagem que ficou 40 minutos na fila enquanto a pessoa
-- respondia "SAIR" não pode sair porque estava aprovada às 9h.
create or replace function app.messages_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c        public.conversations%rowtype;
  d        public.message_drafts%rowtype;
  v_motivo text;
  v_pode   jsonb;
begin
  select * into c from public.conversations where id = new.conversation_id;
  if not found then
    raise exception 'Mensagem sem conversa' using errcode = '23503';
  end if;
  new.organization_id := coalesce(new.organization_id, c.organization_id);
  new.contact_id      := coalesce(new.contact_id, c.contact_id);

  -- ----------------------------------------------------------------
  -- RECEBIDA: entra sempre, inclusive de quem está suprimido.
  -- A mensagem em que alguém escreve "SAIR" é a prova do opt-out. Barrá-la
  -- por causa do opt-out que ela mesma criou seria apagar o consentimento
  -- no instante em que ele é dado.
  -- ----------------------------------------------------------------
  if new.direction = 'in'::app.msg_direction then
    return new;
  end if;

  -- ----------------------------------------------------------------
  -- ENVIADA
  -- ----------------------------------------------------------------
  if tg_op = 'INSERT' then
    -- (0) A exceção declarada: a confirmação única do opt-out (RF-CON-19).
    --     Sai para quem está suprimido, uma vez por conversa (índice
    --     único), e não passa por janela nem por teto — é resposta imediata
    --     a quem acabou de escrever.
    if new.optout_confirmation then
      if new.author_kind = 'bot_ai' then
        raise exception 'A confirmação de opt-out é texto fixo, nunca redigida por IA (RF-CON-19)'
          using errcode = '23514';
      end if;
      new.business_initiated := false;
      return new;
    end if;

    -- (1) Eco do celular: registro do que já aconteceu. Entra, conta no
    --     teto, não passa por porteira. Veja E.3.
    if new.origin = 'echo' then
      if new.author_kind = 'bot_ai' then
        raise exception 'Eco do celular é mensagem de gente: author_kind bot_ai não faz sentido aqui'
          using errcode = '23514';
      end if;
      new.business_initiated := not app.janela_de_24h_aberta(c.id, coalesce(new.sent_at, now()));
      return new;
    end if;

    -- (2) HUMAN-IN-THE-LOOP (ADR-05, RF-CON-22). Esta é a linha que faz o
    --     "nada sai sozinho" ser verdade no banco.
    --     "Envios sem aprovação só para confirmações determinísticas,
    --      opt-out e templates de cadência" — RF-CON-22, ao pé da letra.
    if new.author_kind = 'bot_ai' then
      if new.draft_id is null then
        raise exception 'Mensagem redigida por IA exige rascunho aprovado por uma pessoa (ADR-05, RF-CON-22)'
          using errcode = '42501';
      end if;
      select * into d from public.message_drafts where id = new.draft_id;
      if not found or d.status not in ('aprovado', 'enviado') then
        raise exception 'O rascunho % não está aprovado (status %): nada sai sozinho (ADR-05)',
          new.draft_id, coalesce(d.status, 'inexistente') using errcode = '42501';
      end if;
      if d.reviewed_by is null then
        raise exception 'Rascunho aprovado sem quem aprovou não é aprovação (RF-ADM-03)' using errcode = '42501';
      end if;
      if d.organization_id is distinct from new.organization_id then
        raise exception 'O rascunho aprovado é de outra ficha' using errcode = '42501';
      end if;
      -- O corpo enviado é o que a PESSOA aprovou, não o que a IA propôs.
      if new.body is distinct from d.final_body then
        raise exception 'O corpo da mensagem tem de ser exatamente o texto aprovado (final_body do rascunho)'
          using errcode = '42501';
      end if;
      new.approved_by := d.reviewed_by;
    elsif new.author_kind = 'bot_fixed' then
      if new.template_id is null and new.cadence_touch_id is null then
        raise exception 'Texto fixo do robô sai por modelo aprovado ou por toque de cadência (RF-CON-22)'
          using errcode = '42501';
      end if;
    elsif new.author_kind = 'human' then
      if new.sent_by is null then
        raise exception 'Mensagem humana sem autor não é humana' using errcode = '23502';
      end if;
    else
      raise exception 'Mensagem de saída com author_kind "system" só existe como confirmação de opt-out'
        using errcode = '23514';
    end if;

    -- (3) A porteira: supressão, janela de 24 h, template obrigatório fora
    --     dela, janela de horário (domingo e feriado), tetos.
    new.business_initiated := not app.janela_de_24h_aberta(c.id, now());
    v_pode := app.pode_enviar(new.conversation_id, new.is_first_contact,
                              new.template_id is not null, now());
    if not coalesce((v_pode ->> 'pode')::boolean, false) then
      raise exception 'Envio recusado: % (RF-CON-10, RF-CON-11, RF-CON-18)', v_pode ->> 'motivo'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- ----------------------------------------------------------------
  -- UPDATE
  -- ----------------------------------------------------------------
  -- `body` só pode ir a NULL, e quem o faz é a retenção dos 12 meses
  -- (PRD §10.6). Reescrever o texto de uma mensagem já enviada seria
  -- reescrever o que a pessoa leu.
  if new.conversation_id is distinct from old.conversation_id
     or new.direction is distinct from old.direction
     or (new.body is distinct from old.body and new.body is not null)
     or new.draft_id is distinct from old.draft_id
     or (old.wa_message_id is not null and new.wa_message_id is distinct from old.wa_message_id) then
    raise exception 'Mensagem é registro do que aconteceu: conversa, sentido, corpo, rascunho e wamid não mudam'
      using errcode = '42501';
  end if;

  -- A RECONFERÊNCIA DA ENTREGA. Aqui está a lição do dreno: aprovado às 9h
  -- não é permissão para as 9h40.
  if old.status = 'queued'::app.msg_status and new.status = 'sent'::app.msg_status
     and not new.optout_confirmation and new.origin = 'crm' then
    v_motivo := app.wa_motivo_de_recusa(new.organization_id, new.contact_id, c.peer_phone_e164);
    if v_motivo is not null then
      raise exception 'Entrega recusada na saída: % — a fila não é permissão, é intenção', v_motivo
        using errcode = '42501';
    end if;
    new.sent_at := coalesce(new.sent_at, now());
  end if;

  if new.status = 'delivered'::app.msg_status then new.delivered_at := coalesce(new.delivered_at, now()); end if;
  if new.status = 'read'::app.msg_status      then new.read_at      := coalesce(new.read_at, now());      end if;
  if new.status = 'failed'::app.msg_status    then new.failed_at    := coalesce(new.failed_at, now());    end if;
  return new;
end $$;

drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before insert or update on public.messages
  for each row execute function app.messages_guard();

-- O fio se atualiza sozinho: quem escreveu por último, quando, e a janela.
create or replace function app.messages_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'in'::app.msg_direction then
    update public.conversations
       set last_inbound_at = greatest(coalesce(last_inbound_at, new.created_at), new.created_at),
           last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at),
           unread_count    = unread_count + 1,
           status          = case when status = 'resolvida' then 'aguardando_nos' else status end,
           updated_at      = now()
     where id = new.conversation_id;
  else
    update public.conversations
       set last_outbound_at = greatest(coalesce(last_outbound_at, coalesce(new.sent_at, new.created_at)),
                                       coalesce(new.sent_at, new.created_at)),
           last_message_at  = greatest(coalesce(last_message_at, coalesce(new.sent_at, new.created_at)),
                                       coalesce(new.sent_at, new.created_at)),
           updated_at       = now()
     where id = new.conversation_id;
    -- O rascunho fecha o ciclo: aprovado → enviado, com a mensagem na linha.
    if new.draft_id is not null then
      update public.message_drafts
         set status = 'enviado', message_id = new.id
       where id = new.draft_id and status = 'aprovado';
    end if;
  end if;
  return null;
end $$;

drop trigger if exists messages_after_write on public.messages;
create trigger messages_after_write after insert on public.messages
  for each row execute function app.messages_after_write();
drop trigger if exists audit_messages on public.messages;
create trigger audit_messages after insert or update or delete on public.messages
  for each row execute function app.audit();

alter table public.messages enable row level security;
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (exists (select 1 from public.conversations c
                  where c.id = messages.conversation_id
                    and ((select app.sees_all())
                         or c.assignee_id = (select auth.uid())
                         or ((select app.role()) = 'embaixador'::app.user_role
                             and c.organization_id is not null
                             and (select app.org_is_mine(c.organization_id))))));
-- Da tela só sai mensagem escrita por gente, e só com origem 'crm': eco e
-- importação são coisas que o worker registra, não que alguém digita.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check ((select app.can_write())
              and origin = 'crm'
              and direction = 'out'::app.msg_direction
              and author_kind in ('human', 'bot_fixed')
              and sent_by = (select auth.uid())
              and exists (select 1 from public.conversations c
                           where c.id = messages.conversation_id
                             and ((select app.sees_all())
                                  or c.assignee_id = (select auth.uid())
                                  or ((select app.role()) = 'embaixador'::app.user_role
                                      and c.organization_id is not null
                                      and (select app.org_is_mine(c.organization_id))))));
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated using ((select app.is_admin()));


-- ---------------------------------------------------------------------
-- E.5 A entrada do webhook — idempotente por wamid
-- ---------------------------------------------------------------------
-- A Meta reentrega o mesmo webhook quando não recebe 200 a tempo (R04 §2.1).
-- A idempotência não é um `if exists` no worker: é o índice único parcial em
-- `wa_message_id`. Dois webhooks simultâneos passam pelo `if`; só um passa
-- pelo índice.
create or replace function app.wa_registrar_entrada(p_wamid           text,
                                                    p_business_number text,
                                                    p_peer_phone      text,
                                                    p_type            app.msg_type default 'text'::app.msg_type,
                                                    p_body            text default null,
                                                    p_media_id        text default null,
                                                    p_media_mime      text default null,
                                                    p_occurred_at     timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_peer  text := coalesce(app.normalize_phone_br(p_peer_phone), p_peer_phone);
  v_num   text := coalesce(app.normalize_phone_br(p_business_number), p_business_number);
  v_conv  uuid;
  v_org   uuid;
  v_ct    uuid;
  v_msg   uuid;
  v_novo  boolean := false;
begin
  if nullif(trim(coalesce(p_wamid, '')), '') is null then
    raise exception 'Mensagem recebida sem wa_message_id não é idempotente (RF-CON-03)' using errcode = '22023';
  end if;

  -- Já conhecida? Sai antes de tocar em qualquer outra coisa.
  select m.id, m.conversation_id into v_msg, v_conv
    from public.messages m where m.wa_message_id = p_wamid;
  if found then
    return jsonb_build_object('novo', false, 'message_id', v_msg, 'conversation_id', v_conv);
  end if;

  select c.id into v_conv from public.conversations c
   where c.channel = 'whatsapp'::app.channel
     and c.business_number = v_num and c.peer_phone_e164 = v_peer;

  if v_conv is null then
    -- De quem é este número? A ficha primeiro, a pessoa depois.
    select o.id into v_org from public.organizations o
     where o.phone_e164 = v_peer and o.deleted_at is null limit 1;
    select ct.id into v_ct from public.contacts ct
     where ct.phone_e164 = v_peer and ct.deleted_at is null limit 1;
    if v_org is null and v_ct is not null then
      select oc.organization_id into v_org from public.organization_contacts oc
       where oc.contact_id = v_ct limit 1;
    end if;

    insert into public.conversations (channel, business_number, peer_phone_e164,
                                      organization_id, contact_id, status)
    values ('whatsapp'::app.channel, v_num, v_peer, v_org, v_ct, 'aguardando_nos')
    returning id into v_conv;
  end if;

  insert into public.messages (conversation_id, direction, type, status, wa_message_id,
                               body, media_id, media_mime, author_kind, origin, created_at)
  values (v_conv, 'in'::app.msg_direction, coalesce(p_type, 'text'::app.msg_type),
          'received'::app.msg_status, p_wamid, p_body, p_media_id, p_media_mime,
          'system', 'crm', coalesce(p_occurred_at, now()))
  on conflict (wa_message_id) where wa_message_id is not null do nothing
  returning id into v_msg;
  v_novo := v_msg is not null;

  if v_msg is null then
    select m.id into v_msg from public.messages m where m.wa_message_id = p_wamid;
  end if;

  return jsonb_build_object('novo', v_novo, 'message_id', v_msg, 'conversation_id', v_conv);
end $$;
comment on function app.wa_registrar_entrada(text, text, text, app.msg_type, text, text, text, timestamptz) is
  'Grava uma mensagem recebida da Meta e cria a conversa quando ela não existe (RF-CON-03). Idempotente pelo wamid, com o índice único fazendo o trabalho — reentrega do mesmo webhook devolve novo=false e não duplica nada. Mensagem de contato suprimido entra: é a prova do opt-out.';


-- =====================================================================
-- F. AS FILAS DOS DOIS WORKERS
-- =====================================================================
-- REUSO, NÃO FILA NOVA. A esteira de ingestão (migração 001600) já resolveu
-- o problema inteiro: catálogo de filas com `visibility timeout` dimensionado
-- pelo trabalho, chave de idempotência própria (`ingest_dedup`), backoff
-- exponencial e dead-letter. Escrever uma segunda implementação para o
-- WhatsApp seria criar a terceira daqui a um mês.
--
-- A tabela se chama `ingest_queues` por ter nascido na esteira. Hoje ela é o
-- catálogo de TODAS as filas do Postgres; renomeá-la custaria as FKs de
-- `ingest_dedup` e a função de retenção, e o nome não é o que importa. Fica
-- o comentário atualizado.
--
-- A única coisa que faltava era a dead-letter ser CONFIGURÁVEL: o
-- `app.esteira_falhar` mandava tudo para `ingest_dlq`, e mensagem de
-- WhatsApp morta na dead-letter do Radar é mensagem que ninguém vai achar.
alter table public.ingest_queues
  add column if not exists dlq text references public.ingest_queues (name) on delete set null;
-- E de quem é cada fila. `public.esteira_saude()` é a tela do RADAR e mostra
-- "as filas": sem esta coluna ela passaria a mostrar também as do WhatsApp e
-- as da IA, misturando três painéis em um. O catálogo passa a dizer de quem
-- é cada fila, e cada tela filtra a sua.
alter table public.ingest_queues
  add column if not exists worker text not null default 'ingest';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ingest_queues_worker_check') then
    alter table public.ingest_queues add constraint ingest_queues_worker_check
      check (worker in ('ingest', 'wa', 'ai'));
  end if;
end $$;
comment on table public.ingest_queues is
  'Catálogo das filas pgmq (ADR-11): visibility timeout dimensionado pelo trabalho real, teto de tentativas antes da dead-letter e qual é a dead-letter de cada uma. Nasceu na esteira de ingestão (001600) e hoje serve também aos workers de WhatsApp e de IA.';
comment on column public.ingest_queues.dlq is
  'Para onde vai a mensagem que estourou max_attempts. Null = não tem para onde ir (é o caso das próprias dead-letters: uma DLQ que reenfileira em si mesma é um laço).';

-- As dead-letters primeiro: são elas que as outras referenciam.
insert into public.ingest_queues (name, worker, visibility_seconds, max_attempts, dlq, description) values
  ('wa_dlq', 'wa', 3600, 1, null, 'Dead-letter do WhatsApp. Ninguém consome automaticamente: é leitura humana.'),
  ('ai_dlq', 'ai', 3600, 1, null, 'Dead-letter da IA. Chamada que falhou além do teto para em algum lugar onde alguém a veja.')
on conflict (name) do update
  set worker             = excluded.worker,
      visibility_seconds = excluded.visibility_seconds,
      max_attempts       = excluded.max_attempts,
      dlq                = excluded.dlq,
      description        = excluded.description;

insert into public.ingest_queues (name, worker, visibility_seconds, max_attempts, dlq, description) values
  ('wa_inbound',  'wa', 120, 5, 'wa_dlq',
   'Mensagem recebida da Meta, já gravada pela Edge Function: classificar, resolver a ficha, decidir o que fazer. Segundos de trabalho, mais a chamada ao modelo.'),
  ('wa_outbound', 'wa', 120, 4, 'wa_dlq',
   'Mensagem aprovada esperando o POST para a Cloud API. Cabe um envio lento e o registro do resultado. Quatro tentativas: mensagem de WhatsApp que não saiu em quatro tentativas perdeu o momento.'),
  ('ai_jobs',     'ai', 300, 3, 'ai_dlq',
   'Transcrever, resumir, classificar, redigir (ADR-10). Cinco minutos de visibilidade cabem a chamada mais lenta com folga.')
on conflict (name) do update
  set worker             = excluded.worker,
      visibility_seconds = excluded.visibility_seconds,
      max_attempts       = excluded.max_attempts,
      dlq                = excluded.dlq,
      description        = excluded.description;

-- As filas antigas apontam para a dead-letter que sempre usaram.
update public.ingest_queues set dlq = 'ingest_dlq'
 where name in ('ingest_jobs', 'ingest_pages', 'ingest_records') and dlq is distinct from 'ingest_dlq';
update public.ingest_queues set dlq = null where name = 'ingest_dlq' and dlq is not null;

do $$
declare
  q text;
begin
  for q in select name from public.ingest_queues loop
    if not exists (select 1 from pgmq.list_queues() lq where lq.queue_name = q) then
      perform pgmq.create(q);
    end if;
  end loop;
end $$;

-- `public.esteira_saude()` continua sendo a tela do RADAR, e agora diz isso
-- no código: ela lê só as filas do worker de ingestão. Sem esta linha, as
-- cinco filas novas apareceriam no painel do Radar como se fossem dele — e
-- um painel que mostra o que não é dele é um painel que ninguém confere.
create or replace function public.esteira_saude()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workers jsonb;
  v_filas   jsonb := '[]'::jsonb;
  v_q       record;
  v_m       record;
begin
  if not app.can_write() then
    raise exception 'Papel % não lê a saúde da esteira', app.role() using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'worker', h.worker, 'instancia', h.instance, 'status', h.status,
           'fila', h.queue, 'versao', h.version, 'host', h.host,
           'ultima_batida', h.last_beat_at,
           'ha_segundos', floor(extract(epoch from (now() - h.last_beat_at)))::int,
           -- Dois minutos sem batida com a batida esperada a cada 30 s: é parado,
           -- não é lento. A tela precisa de um veredito, não de um timestamp.
           'vivo', (now() - h.last_beat_at) < interval '2 minutes',
           'processados', h.processed_total, 'falhas', h.failed_total)
           order by h.worker, h.instance), '[]'::jsonb)
    into v_workers
    from public.worker_heartbeats h;

  for v_q in select name from public.ingest_queues where worker = 'ingest' order by name loop
    select * into v_m from pgmq.metrics(v_q.name);
    v_filas := v_filas || jsonb_build_array(jsonb_build_object(
      'fila', v_q.name,
      'na_fila', coalesce(v_m.queue_length, 0),
      'visiveis', coalesce(v_m.queue_visible_length, 0),
      'mais_antigo_segundos', v_m.oldest_msg_age_sec,
      'total_ja_enfileirado', coalesce(v_m.total_messages, 0)));
  end loop;

  return jsonb_build_object(
    'workers', v_workers,
    'filas', v_filas,
    'coletor_vivo', exists (select 1 from public.worker_heartbeats h
                             where h.worker = 'ingest' and h.status = 'ok'
                               and (now() - h.last_beat_at) < interval '2 minutes'),
    'lotes_rodando', (select count(*) from public.import_batches b where b.status = 'rodando'),
    'capturas_por_expurgar', (select count(*) from public.raw_capture rc
                               where rc.purge_after < (now() at time zone 'America/Fortaleza')::date),
    'registros_por_resolver', (select count(*) from public.source_record sr where sr.candidate_id is null),
    'ultimo_expurgo', (select r.ran_at from public.retention_runs r order by r.ran_at desc limit 1)
  );
end $$;
comment on function public.esteira_saude() is
  'Painel do Radar: batidas de ponto dos workers e profundidade das filas DA ESTEIRA (ingest_queues.worker = ''ingest''). As filas do WhatsApp e da IA ficam de fora de propósito — painel que mostra o que não é dele é painel que ninguém confere.';


-- `app.esteira_falhar` passa a ler a dead-letter do catálogo. Mesma lógica,
-- mesmo backoff; muda só o destino, que agora é da fila e não da função.
create or replace function app.esteira_falhar(p_queue text, p_msg_id bigint, p_key text, p_erro text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int;
  v_dlq text;
  v_n   int;
  v_vt  int;
  v_msg jsonb;
begin
  select q.max_attempts, q.dlq into v_max, v_dlq from public.ingest_queues q where q.name = p_queue;
  if v_max is null then
    raise exception 'Fila % não existe na esteira', p_queue using errcode = '22023';
  end if;

  update public.ingest_dedup
     set attempts = attempts + 1, last_error = left(coalesce(p_erro, ''), 2000)
   where queue = p_queue and idempotency_key = p_key
  returning attempts into v_n;
  v_n := coalesce(v_n, v_max);

  if v_n < v_max then
    v_vt := least(30 * power(2, v_n - 1)::int, 3600);          -- 30 s, 60 s, 120 s… teto de 1 h
    perform pgmq.set_vt(p_queue, p_msg_id, v_vt);
    return jsonb_build_object('acao', 'reagendado', 'tentativa', v_n, 'em_segundos', v_vt);
  end if;

  -- A mensagem é lida da tabela da fila pelo id: `pgmq.read` entrega "a próxima
  -- visível", que não é necessariamente esta.
  execute format('select message from pgmq.%I where msg_id = $1', 'q_' || p_queue)
    into v_msg using p_msg_id;

  if v_dlq is not null then
    perform app.esteira_enfileirar(
              v_dlq,
              jsonb_build_object('fila_de_origem', p_queue, 'msg_id', p_msg_id,
                                 'idempotency_key', p_key, 'erro', left(coalesce(p_erro, ''), 2000),
                                 'tentativas', v_n, 'em', now(), 'mensagem', v_msg),
              p_queue || ':' || p_key);
  end if;
  perform pgmq.archive(p_queue, p_msg_id);
  update public.ingest_dedup set processed_at = now()
   where queue = p_queue and idempotency_key = p_key;
  return jsonb_build_object('acao', case when v_dlq is null then 'arquivado_sem_dlq' else 'dead_letter' end,
                            'tentativa', v_n, 'dlq', v_dlq);
end $$;
comment on function app.esteira_falhar(text, bigint, text, text) is
  'Backoff exponencial até o teto de tentativas da fila; depois manda para a dead-letter DA PRÓPRIA FILA (coluna ingest_queues.dlq) e arquiva. Fila sem dlq (as próprias dead-letters) só arquiva: DLQ que reenfileira em si mesma é laço.';


-- ---------------------------------------------------------------------
-- F.1 A saída: enfileirar, drenar reconferindo, escriturar
-- ---------------------------------------------------------------------
create or replace function app.wa_enfileirar_envio(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_message_id;
  if not found then
    raise exception 'Mensagem % não existe', p_message_id using errcode = 'P0002';
  end if;
  if m.direction <> 'out'::app.msg_direction or m.status <> 'queued'::app.msg_status then
    return jsonb_build_object('enfileirado', false, 'motivo', 'nao_esta_na_fila_de_saida');
  end if;
  return app.esteira_enfileirar('wa_outbound',
                                jsonb_build_object('message_id', m.id, 'conversation_id', m.conversation_id),
                                m.id::text);
end $$;

-- O DRENO. É a cópia deliberada de `app.komune_proximos` (migração 000100),
-- e o comentário que importa é o mesmo: alguém pode ter dito não DEPOIS de a
-- mensagem entrar na fila. Aqui a mensagem recusada não volta para a fila —
-- ela MORRE, porque o envio para quem disse não não tem segunda chance.
create or replace function app.wa_proximos(p_qty int default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out       jsonb := '[]'::jsonb;
  v_recusados jsonb := '[]'::jsonb;
  v_motivo    text;
  v_pode      jsonb;
  m           record;
  msg         public.messages%rowtype;
  c           public.conversations%rowtype;
begin
  for m in select * from pgmq.read('wa_outbound', 120, least(greatest(coalesce(p_qty, 10), 1), 50)) loop
    select * into msg from public.messages where id = (m.message ->> 'message_id')::uuid;
    if not found or msg.status <> 'queued'::app.msg_status then
      perform pgmq.archive('wa_outbound', m.msg_id);
      continue;
    end if;
    select * into c from public.conversations where id = msg.conversation_id;

    -- ----- guardrail: o mundo muda entre a fila e a entrega -----
    -- (o mesmo de public.proximo_da_fila e de app.komune_proximos)
    v_motivo := case
                  when msg.optout_confirmation then null
                  else app.wa_motivo_de_recusa(msg.organization_id, msg.contact_id, c.peer_phone_e164)
                end;
    if v_motivo is null and not msg.optout_confirmation then
      v_pode := app.pode_enviar(msg.conversation_id, msg.is_first_contact,
                                msg.template_id is not null, now());
      if not coalesce((v_pode ->> 'pode')::boolean, false) then
        -- Janela fechada e teto estourado NÃO matam a mensagem: eles dizem
        -- "agora não". A mensagem volta para a fila com o `visibility
        -- timeout` esticado até a próxima abertura, e quem a mata é
        -- app.wa_expirar_fila, com prazo.
        if (v_pode ->> 'motivo') in ('contato_suprimido', 'numero_suprimido',
                                     'contato_apagado', 'organizacao_apagada') then
          v_motivo := v_pode ->> 'motivo';
        else
          perform pgmq.set_vt('wa_outbound', m.msg_id,
                              greatest(60, least(3600,
                                extract(epoch from coalesce((v_pode ->> 'quando')::timestamptz,
                                                            now() + interval '15 minutes') - now())::int)));
          v_recusados := v_recusados || jsonb_build_object('message_id', msg.id,
                                                           'motivo', v_pode ->> 'motivo',
                                                           'acao', 'adiado',
                                                           'quando', v_pode ->> 'quando');
          continue;
        end if;
      end if;
    end if;

    if v_motivo is not null then
      update public.messages
         set status = 'failed'::app.msg_status,
             error_code = 'recusado_na_entrega',
             error_detail = v_motivo,
             failed_at = now()
       where id = msg.id;
      update public.message_drafts set status = 'descartado',
             discard_reason = 'recusado na entrega: ' || v_motivo
       where id = msg.draft_id and status in ('aprovado', 'enviado');
      perform pgmq.archive('wa_outbound', m.msg_id);
      v_recusados := v_recusados || jsonb_build_object('message_id', msg.id,
                                                       'motivo', v_motivo, 'acao', 'morto');
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'msg_id',          m.msg_id,
      'message_id',      msg.id,
      'conversation_id', msg.conversation_id,
      'business_number', c.business_number,
      'para',            c.peer_phone_e164,
      'tipo',            msg.type,
      'corpo',           msg.body,
      'template_id',     msg.template_id,
      'template_params', msg.template_params,
      'audio_asset_id',  msg.audio_asset_id);
  end loop;

  return jsonb_build_object('itens', v_out, 'recusados', v_recusados);
end $$;
comment on function app.wa_proximos(int) is
  'Lote de mensagens para o worker-wa enviar pela Cloud API (ADR-06). RECONFERE cada item no instante da entrega, na forma de app.komune_proximos: o que ficou suprimido, apagado ou sem ficha MORRE (status failed, motivo na linha, rascunho descartado); o que só está fora de janela ou no teto é ADIADO até a próxima abertura. Checar na enfileirada nunca bastou.';

create or replace function app.wa_sucesso(p_msg_id bigint, p_message_id uuid,
                                          p_wamid text, p_custo numeric default null,
                                          p_categoria text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages
     set status = 'sent'::app.msg_status,
         wa_message_id = coalesce(wa_message_id, p_wamid),
         sent_at = coalesce(sent_at, now()),
         cost_usd = coalesce(p_custo, cost_usd),
         billable_category = coalesce(p_categoria, billable_category)
   where id = p_message_id and status = 'queued'::app.msg_status;
  return pgmq.archive('wa_outbound', p_msg_id);
end $$;

create or replace function app.wa_falha(p_msg_id bigint, p_message_id uuid,
                                        p_erro text, p_codigo text default 'erro_meta')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := app.esteira_falhar('wa_outbound', p_msg_id, p_message_id::text, p_erro);
  if v ->> 'acao' <> 'reagendado' then
    update public.messages
       set status = 'failed'::app.msg_status,
           error_code = coalesce(nullif(trim(p_codigo), ''), 'erro_meta'),
           error_detail = left(coalesce(p_erro, ''), 2000),
           failed_at = now()
     where id = p_message_id and status = 'queued'::app.msg_status;
  end if;
  return v;
end $$;

-- Mensagem que ficou parada perde o momento. Este é o "teto de idade" que a
-- migração 000100 deixou como pendência para a `komune_outbox`, resolvido
-- aqui para o WhatsApp: uma mensagem de prospecção enfileirada ontem, se
-- sair hoje, chega como uma mensagem estranha para quem a recebe.
create or replace function app.wa_expirar_fila(p_horas int default 12)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  update public.messages
     set status = 'failed'::app.msg_status,
         error_code = 'expirou_na_fila',
         error_detail = 'esperou mais de ' || p_horas || ' h por janela, teto ou worker desligado',
         failed_at = now()
   where status = 'queued'::app.msg_status
     and created_at < now() - make_interval(hours => greatest(coalesce(p_horas, 12), 1));
  get diagnostics n = row_count;
  return jsonb_build_object('expiradas', n);
end $$;
comment on function app.wa_expirar_fila(int) is
  'Mata a mensagem que ficou na fila além do prazo. Mensagem de prospecção que sai um dia depois chega errada: melhor não sair e aparecer como falha do que sair fora de hora.';

-- Rascunho que ninguém olhou também vence. Três dias é o padrão da coluna;
-- passado isso a conversa mudou e o texto deixou de servir.
create or replace function app.rascunhos_expirar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  update public.message_drafts
     set status = 'expirado'
   where status = 'pendente' and expires_at < now();
  get diagnostics n = row_count;
  return jsonb_build_object('expirados', n);
end $$;


-- ---------------------------------------------------------------------
-- F.2 A entrada da IA
-- ---------------------------------------------------------------------
create or replace function app.ia_enfileirar(p_purpose text, p_payload jsonb, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_purpose not in ('transcribe_audio', 'summarize_call', 'draft_followup', 'classify_inbound',
                       'draft_reply', 'summarize_deal', 'next_action', 'digest',
                       'extract_listing', 'assistant') then
    raise exception 'Propósito % não existe em ai_runs.purpose: gasto que ninguém nomeou é gasto que ninguém orçou', p_purpose
      using errcode = '22023';
  end if;
  return app.esteira_enfileirar('ai_jobs',
                                jsonb_build_object('purpose', p_purpose) || coalesce(p_payload, '{}'::jsonb),
                                p_purpose || ':' || p_key);
end $$;
comment on function app.ia_enfileirar(text, jsonb, text) is
  'Põe um trabalho na fila do worker-ai. A chave de idempotência é "<propósito>:<chave>" — a mesma mensagem classificada duas vezes é dinheiro gasto duas vezes.';


-- ---------------------------------------------------------------------
-- F.3 Cron
-- ---------------------------------------------------------------------
-- Horários em UTC (é o fuso do servidor); a coluna da direita é o local,
-- America/Fortaleza (UTC-3), que é o fuso de toda a lógica do produto.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- 09:00 local: o alerta de orçamento chega no começo do expediente, não
    -- de madrugada, porque quem lê é gente.
    perform cron.schedule('ia_alerta_orcamento', '0 12 * * *',
                          $cron$select app.ai_alerta_orcamento()$cron$);
    -- de hora em hora: mensagem parada e rascunho vencido
    perform cron.schedule('wa_expirar_fila', '7 * * * *',
                          $cron$select app.wa_expirar_fila(12)$cron$);
    -- 06:30 local, junto do resto da faxina do dia
    perform cron.schedule('rascunhos_expirar', '30 9 * * *',
                          $cron$select app.rascunhos_expirar()$cron$);
  end if;
end $$;


-- =====================================================================
-- G. RETENÇÃO (PRD §10.6)
-- =====================================================================
-- Quatro linhas novas na faxina diária, todas do §10.6:
--   · a saída do modelo vive 90 dias (a LINHA de ai_runs fica: é contabilidade);
--   · mídia de mensagem, 365 dias, metadados preservados;
--   · texto e transcrição de conversa, 12 meses;
--   · rascunho que nunca virou mensagem, 12 meses.
-- O arquivo das filas novas já é limpo pelo laço que existe desde 001600,
-- porque ele varre `ingest_queues` — que agora inclui wa_* e ai_*.
create or replace function app.aplicar_retencao()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb;
  n int;
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  q text;
begin
  -- (1) Captura bruta: 90 dias (PRD §10.6). O HTML nunca esteve aqui — ele fica
  -- em cache de disco do worker por ≤ 7 dias (R06 SCR-11) e é problema do worker.
  delete from public.raw_capture where purge_after < v_hoje;
  get diagnostics n = row_count; v := v || jsonb_build_object('raw_capture', n);

  -- (2) Lead coletado e nunca contatado: 90 dias. Candidato 'novo' é, por
  -- definição, quem nunca foi contatado — ninguém liga a partir da fila.
  delete from public.supplier_candidates c
   where c.status = 'novo' and c.created_at < now() - interval '90 days';
  get diagnostics n = row_count; v := v || jsonb_build_object('candidatos_novos', n);

  -- (3) Candidato RECUSADO passa a guardar só a decisão: o contato sai, a linha
  -- fica. Apagar a linha inteira faria a próxima coleta trazer o mesmo alvo de
  -- volta e a mesma pessoa ser recusada duas vezes — o oposto de respeitar o não.
  update public.supplier_candidates c
     set phone_e164 = null, email = null, instagram_handle = null, website = null,
         website_domain = null, address = null, cnpj = null, legal_name = null,
         payload = '{}'::jsonb
   where c.status = 'recusado' and c.reviewed_at < now() - interval '90 days'
     and (c.phone_e164 is not null or c.email is not null or c.instagram_handle is not null
          or c.cnpj is not null or c.address is not null);
  get diagnostics n = row_count; v := v || jsonb_build_object('candidatos_recusados_anonimizados', n);

  -- (4) Registro de fonte que nunca virou candidato e envelheceu: some junto com
  -- a captura que o gerou.
  delete from public.source_record sr
   where sr.candidate_id is null and sr.last_seen_at < now() - interval '90 days';
  get diagnostics n = row_count; v := v || jsonb_build_object('source_record', n);

  -- (5) TTL do Places (30 dias): telefone e site expiram; o place_id fica, que é
  -- o único campo que os termos do Google deixam guardar sem prazo.
  update public.source_record sr
     set phone_e164 = null, phones = '[]'::jsonb, website = null, website_domain = null,
         expires_at = null
   where sr.expires_at is not null and sr.expires_at < now();
  get diagnostics n = row_count; v := v || jsonb_build_object('places_expirados', n);

  -- (6) Proveniência órfã: o registro a que ela se referia não existe mais.
  delete from public.field_provenance fp
   where (fp.record_type = 'source_record'
          and not exists (select 1 from public.source_record x where x.id = fp.record_id))
      or (fp.record_type = 'supplier_candidate'
          and not exists (select 1 from public.supplier_candidates x where x.id = fp.record_id))
      or (fp.record_type = 'organization'
          and not exists (select 1 from public.organizations x where x.id = fp.record_id));
  get diagnostics n = row_count; v := v || jsonb_build_object('proveniencia_orfa', n);

  -- (7) Chaves de idempotência já consumidas há mais de 90 dias: a mensagem que
  -- elas protegiam não volta mais.
  delete from public.ingest_dedup where processed_at is not null and processed_at < now() - interval '90 days';
  get diagnostics n = row_count; v := v || jsonb_build_object('ingest_dedup', n);

  -- (8) Lote de prévia que ninguém executou: 7 dias.
  delete from public.import_batches b
   where b.status = 'previa' and b.created_at < now() - interval '7 days'
     and not exists (select 1 from public.raw_capture rc where rc.batch_id = b.id);
  get diagnostics n = row_count; v := v || jsonb_build_object('lotes_previa', n);

  -- (9) Batida de worker que sumiu há mais de 30 dias.
  delete from public.worker_heartbeats where last_beat_at < now() - interval '30 days';
  get diagnostics n = row_count; v := v || jsonb_build_object('heartbeats', n);

  -- (10) Arquivo das filas: 30 dias. `pgmq` guarda o arquivado para sempre.
  for q in select name from public.ingest_queues loop
    execute format('delete from pgmq.%I where archived_at < now() - interval ''30 days''', 'a_' || q);
    get diagnostics n = row_count;
    v := v || jsonb_build_object('arquivo_' || q, n);
  end loop;

  -- (11) Logs de acesso e auditoria: 12 meses (PRD §10.6; Marco Civil art. 15
  -- exige 6 meses — 12 é o teto do PRD, não o piso da lei).
  delete from public.audit_log where created_at < now() - interval '12 months';
  get diagnostics n = row_count; v := v || jsonb_build_object('audit_log', n);
  delete from public.pii_access_log where created_at < now() - interval '12 months';
  get diagnostics n = row_count; v := v || jsonb_build_object('pii_access_log', n);

  -- (12) O próprio relatório: 5 anos (responsabilização, art. 6º, X).
  delete from public.retention_runs where ran_at < now() - interval '5 years';
  get diagnostics n = row_count; v := v || jsonb_build_object('retention_runs', n);

  -- (13) IA: a saída do modelo vive 90 dias (PRD §10.6 / R05 "ai_runs.output
  -- 90 d"). A LINHA fica: propósito, modelo, versão do prompt, tokens e
  -- custo são a contabilidade do ADR-09 e não são dado pessoal. O que sai é
  -- o conteúdo — que é o único pedaço que pode falar de alguém.
  update public.ai_runs set output = null
   where output is not null and created_at < now() - interval '90 days';
  get diagnostics n = row_count; v := v || jsonb_build_object('ai_runs_output', n);

  -- (14) Mídia de mensagem: 365 dias, metadados preservados (PRD §10.6).
  update public.messages
     set media_path = null, media_id = null
   where (media_path is not null or media_id is not null)
     and created_at < now() - interval '365 days';
  get diagnostics n = row_count; v := v || jsonb_build_object('messages_midia', n);

  -- (15) Conversas de prospecção: 12 meses, apagando o texto e a transcrição
  -- integrais (PRD §10.6). Fica a linha do tempo — quem falou, quando, em
  -- que sentido, com que resultado —, que é o que as métricas leem.
  update public.messages
     set body = null, transcript = null
   where (body is not null or transcript is not null)
     and created_at < now() - interval '12 months';
  get diagnostics n = row_count; v := v || jsonb_build_object('messages_texto', n);

  -- (16) Rascunho que nunca virou mensagem: 12 meses. O par proposto/enviado
  -- só serve para melhorar prompt enquanto o prompt é este; passado um ano
  -- é texto sobre uma pessoa guardado sem finalidade viva.
  delete from public.message_drafts
   where status in ('descartado', 'expirado')
     and created_at < now() - interval '12 months';
  get diagnostics n = row_count; v := v || jsonb_build_object('message_drafts', n);

  insert into public.retention_runs (report) values (v);
  return v;
end $$;

comment on function app.aplicar_retencao() is
  'A faxina diária do PRD §10.6 (job 3 do cron). Desde 20260905000200 cuida também da IA e das conversas: ai_runs.output em 90 dias, mídia de mensagem em 365, texto e transcrição em 12 meses, rascunho terminal em 12 meses.';


-- =====================================================================
-- H. GRANTS — a superfície mínima
-- =====================================================================
-- Regra: quem escreve nas filas e nas tabelas de envio é o worker
-- (service_role) e as funções `security definer`. A tela lê, aprova e
-- descarta — e essas três coisas passam por RPC nominal.
grant select on public.conversations, public.messages, public.message_drafts,
                public.ai_model_prices to authenticated;
grant select on public.ai_runs, public.ai_budget_alerts to authenticated;
grant insert, update on public.conversations to authenticated;
grant insert on public.messages to authenticated;
grant update on public.message_drafts to authenticated;

-- As funções de GATILHO não são executáveis por ninguém de fora: quem as
-- chama é o Postgres. É a asserção 49 do teste 09, e ela existe porque o
-- `grant execute` para PUBLIC é o padrão do Postgres, não uma escolha.
revoke all on function app.ai_runs_before_write()        from public, anon, authenticated;
revoke all on function app.conversations_before_write()  from public, anon, authenticated;
revoke all on function app.message_drafts_guard()        from public, anon, authenticated;
revoke all on function app.messages_guard()              from public, anon, authenticated;
revoke all on function app.messages_after_write()        from public, anon, authenticated;
revoke all on function app.app_settings_validate()       from public, anon, authenticated;

revoke all on function app.ai_custo(text,int,int,int,int,boolean)                     from public, anon, authenticated;
revoke all on function app.ai_gasto_do_mes(date)                                      from public, anon, authenticated;
revoke all on function app.ai_alerta_orcamento()                                      from public, anon, authenticated;
revoke all on function app.wa_motivo_de_recusa(uuid, uuid, text)                      from public, anon, authenticated;
revoke all on function app.pode_enviar(uuid, boolean, boolean, timestamptz)           from public, anon, authenticated;
revoke all on function app.primeiros_contatos_do_dia(app.channel, date, text)         from public, anon, authenticated;
revoke all on function app.iniciadas_pela_empresa(text, timestamptz, timestamptz)     from public, anon, authenticated;
revoke all on function app.wa_registrar_entrada(text, text, text, app.msg_type, text, text, text, timestamptz)
                                                                                      from public, anon, authenticated;
revoke all on function app.wa_enfileirar_envio(uuid)                                  from public, anon, authenticated;
revoke all on function app.wa_proximos(int)                                           from public, anon, authenticated;
revoke all on function app.wa_sucesso(bigint, uuid, text, numeric, text)              from public, anon, authenticated;
revoke all on function app.wa_falha(bigint, uuid, text, text)                         from public, anon, authenticated;
revoke all on function app.wa_expirar_fila(int)                                       from public, anon, authenticated;
revoke all on function app.rascunhos_expirar()                                        from public, anon, authenticated;
revoke all on function app.ia_enfileirar(text, jsonb, text)                           from public, anon, authenticated;

grant execute on function app.ai_custo(text,int,int,int,int,boolean)                  to service_role;
grant execute on function app.ai_gasto_do_mes(date)                                   to service_role;
grant execute on function app.ai_alerta_orcamento()                                   to service_role;
grant execute on function app.wa_motivo_de_recusa(uuid, uuid, text)                   to service_role;
grant execute on function app.pode_enviar(uuid, boolean, boolean, timestamptz)        to service_role;
grant execute on function app.primeiros_contatos_do_dia(app.channel, date, text)      to service_role;
grant execute on function app.iniciadas_pela_empresa(text, timestamptz, timestamptz)  to service_role;
grant execute on function app.wa_registrar_entrada(text, text, text, app.msg_type, text, text, text, timestamptz)
                                                                                      to service_role;
grant execute on function app.wa_enfileirar_envio(uuid)                               to service_role;
grant execute on function app.wa_proximos(int)                                        to service_role;
grant execute on function app.wa_sucesso(bigint, uuid, text, numeric, text)           to service_role;
grant execute on function app.wa_falha(bigint, uuid, text, text)                      to service_role;
grant execute on function app.wa_expirar_fila(int)                                    to service_role;
grant execute on function app.rascunhos_expirar()                                     to service_role;
grant execute on function app.ia_enfileirar(text, jsonb, text)                        to service_role;

-- `app.janela_de_24h_aberta` a tela usa: é o indicador de janela do RF-CON-05.
revoke all on function app.janela_de_24h_aberta(uuid, timestamptz) from public, anon;
grant execute on function app.janela_de_24h_aberta(uuid, timestamptz) to authenticated, service_role;

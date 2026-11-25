-- =====================================================================
-- TRIADE — 20261125120000 — A VERACIDADE FORA DO PEDIDO DO WORKER
-- (vale em qualquer banco com o banco de mercado; na KOMUNE a coleta nunca liga, então nada roda)
-- =====================================================================
--
-- O QUE ACONTECEU (1ª coleta, segunda 23/11/2026): os 4.184 anúncios foram
-- gravados, mas as 8 coletas de anúncios ficaram em "rodando". Fechar a coleta
-- (`public.mercado_coleta_fechar`) rodava a veracidade inteira
-- (`app.mercado_verificar()`) dentro do mesmo pedido do worker, e o pedido pela
-- API tem 8 s de teto (`statement_timeout` e `lock_timeout` do authenticator).
-- Com milhares de anúncios a conta passa disso: o fechamento cai, a coleta fica
-- aberta e o pós-rodada (que também rodava a veracidade) cai do mesmo jeito.
-- Pelo pg_cron, sem esse teto, a mesma conta levou 5,8 s (rotina de 24/11 3h15).
--
-- O QUE MUDA:
--   * `app.mercado_verificacao_pedir(motivo)`: marca que a veracidade precisa
--     rodar (uma linha em `app.mercado_pendencias`), sem rodar nada.
--   * `public.mercado_coleta_fechar` e `public.mercado_pos_rodada` passam a só
--     pedir (a troca é feita no texto da função que está no banco, uma vez cada,
--     e aborta se não achar o trecho exatamente uma vez).
--   * `app.mercado_verificar_se_pendente()`, pelo pg_cron a cada 5 minutos
--     (`mercado_verificar_pendente`): se houver pedido, roda a veracidade e
--     registra quando terminou.
--   * `public.mercado_verificacao_estado()` (só o worker): diz se há pedido
--     esperando e quando a última terminou; o worker espera por ela antes de
--     rodar o motor das vantagens.
--   * As coletas presas em "rodando" há mais de 3 horas são fechadas (como o
--     pós-rodada faria), sem perder os anúncios gravados, e a veracidade é pedida.
--
-- COMO DESFAZER (em ordem):
--   select cron.unschedule('mercado_verificar_pendente');
--   drop function if exists public.mercado_verificacao_estado();
--   drop function if exists app.mercado_verificar_se_pendente();
--   drop function if exists app.mercado_verificacao_pedir(text);
--   drop table if exists app.mercado_pendencias;
--   e reaplicar as definições de public.mercado_coleta_fechar (20261119160000)
--   e public.mercado_pos_rodada (20261119169000).
-- =====================================================================

do $veracidade$
declare
  v_def   text;
  v_novo  text;
  v_vezes int;
  v_velho text;
begin
  if to_regprocedure('public.mercado_coleta_fechar(bigint, text, numeric, jsonb, boolean, text)') is null
     or to_regprocedure('app.mercado_verificar()') is null then
    raise notice 'Sem o banco de mercado neste banco: nada a trocar.';
    return;
  end if;

  execute $ddl$
    create table if not exists app.mercado_pendencias (
      chave       text primary key check (chave in ('veracidade')),
      pedida_em   timestamptz not null default now(),
      motivo      text check (char_length(motivo) <= 500),
      ultima_fim  timestamptz,
      ultima_seg  numeric,
      ultimo_erro text check (char_length(ultimo_erro) <= 2000),
      pendente    boolean not null default true
    )
  $ddl$;
  execute 'alter table app.mercado_pendencias enable row level security';
  execute 'revoke all on table app.mercado_pendencias from public, anon, authenticated';
  execute $c$comment on table app.mercado_pendencias is
    'O que o banco de mercado precisa rodar fora do pedido do worker (migração 20261125120000). Hoje só a veracidade: o worker pede, o pg_cron roda a cada 5 minutos.'$c$;

  execute $ddl$
    create or replace function app.mercado_verificacao_pedir(p_motivo text default null)
    returns void
    language sql
    security definer
    set search_path = ''
    as $f$
      insert into app.mercado_pendencias (chave, pedida_em, motivo, pendente)
      values ('veracidade', now(), left(p_motivo, 500), true)
      on conflict (chave) do update
        set pedida_em = excluded.pedida_em, motivo = excluded.motivo, pendente = true;
    $f$
  $ddl$;
  execute 'revoke all on function app.mercado_verificacao_pedir(text) from public, anon, authenticated';

  execute $ddl$
    create or replace function app.mercado_verificar_se_pendente()
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $f$
    declare
      p      app.mercado_pendencias;
      v_ini  timestamptz := clock_timestamp();
      v_res  jsonb;
    begin
      select * into p from app.mercado_pendencias where chave = 'veracidade' and pendente for update skip locked;
      if not found then
        return jsonb_build_object('rodou', false);
      end if;
      begin
        v_res := app.mercado_verificar();
        update app.mercado_pendencias
           set pendente = (pedida_em > v_ini), ultima_fim = clock_timestamp(),
               ultima_seg = round(extract(epoch from clock_timestamp() - v_ini)::numeric, 1), ultimo_erro = null
         where chave = 'veracidade';
      exception when others then
        update app.mercado_pendencias
           set ultimo_erro = left(sqlerrm, 2000), ultima_fim = clock_timestamp()
         where chave = 'veracidade';
        return jsonb_build_object('rodou', false, 'erro', sqlerrm);
      end;
      return jsonb_build_object('rodou', true, 'veracidade', v_res);
    end
    $f$
  $ddl$;
  execute 'revoke all on function app.mercado_verificar_se_pendente() from public, anon, authenticated';

  execute $ddl$
    create or replace function public.mercado_verificacao_estado()
    returns jsonb
    language sql
    stable
    security definer
    set search_path = ''
    as $f$
      select coalesce(
        (select jsonb_build_object('pendente', p.pendente, 'pedida_em', p.pedida_em,
                                   'ultima_fim', p.ultima_fim, 'ultima_seg', p.ultima_seg,
                                   'ultimo_erro', p.ultimo_erro)
           from app.mercado_pendencias p where p.chave = 'veracidade'),
        jsonb_build_object('pendente', false));
    $f$
  $ddl$;
  execute 'revoke all on function public.mercado_verificacao_estado() from public, anon, authenticated';
  execute 'grant execute on function public.mercado_verificacao_estado() to service_role';

  -- 1) fechar a coleta: só pede a veracidade
  v_velho := $t$  if c.quantos > 0 and to_regprocedure('app.mercado_verificar()') is not null then
    execute 'select app.mercado_verificar()' into v_verif;
  end if;$t$;
  v_def := pg_get_functiondef('public.mercado_coleta_fechar(bigint, text, numeric, jsonb, boolean, text)'::regprocedure);
  v_vezes := (char_length(v_def) - char_length(replace(v_def, v_velho, ''))) / char_length(v_velho);
  if v_vezes = 1 then
    v_novo := replace(v_def, v_velho, $t$  if c.quantos > 0 then
    -- 20261125120000: a veracidade roda pelo pg_cron (mercado_verificar_pendente), fora do teto de 8 s do pedido.
    perform app.mercado_verificacao_pedir('coleta ' || c.id || ' (' || c.fonte || ')');
    v_verif := jsonb_build_object('adiada', true);
  end if;$t$);
    execute v_novo;
  elsif position('app.mercado_verificacao_pedir' in v_def) > 0 then
    raise notice 'mercado_coleta_fechar já pede a veracidade: nada a trocar.';
  else
    raise exception 'public.mercado_coleta_fechar não tem o trecho da veracidade exatamente uma vez (achei %): nada foi trocado.', v_vezes;
  end if;

  -- 2) pós-rodada: só pede a veracidade
  v_velho := $t$  v_verif := app.mercado_verificar();$t$;
  v_def := pg_get_functiondef('public.mercado_pos_rodada()'::regprocedure);
  v_vezes := (char_length(v_def) - char_length(replace(v_def, v_velho, ''))) / char_length(v_velho);
  if v_vezes = 1 then
    v_novo := replace(v_def, v_velho, $t$  -- 20261125120000: a veracidade roda pelo pg_cron (mercado_verificar_pendente), fora do teto de 8 s do pedido.
  perform app.mercado_verificacao_pedir('pós-rodada');
  v_verif := jsonb_build_object('adiada', true);$t$);
    execute v_novo;
  elsif position('app.mercado_verificacao_pedir' in v_def) > 0 then
    raise notice 'mercado_pos_rodada já pede a veracidade: nada a trocar.';
  else
    raise exception 'public.mercado_pos_rodada não tem o trecho da veracidade exatamente uma vez (achei %): nada foi trocado.', v_vezes;
  end if;

  -- 3) as coletas presas: fechadas como o pós-rodada faria (os anúncios gravados ficam)
  perform public.mercado_coleta_fechar(c.id, 'fechada em 25/11/2026: o fechamento passou do teto de 8 s do pedido (20261125120000); os anúncios gravados valem',
                                       null, jsonb_build_object('fechada_por', '20261125120000'), false, null)
     from public.mercado_coletas c
    where c.situacao = 'rodando' and c.inicio < now() - interval '3 hours';
  perform app.mercado_verificacao_pedir('migração 20261125120000');

  -- 4) o agendamento
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mercado_verificar_pendente', '*/5 * * * *',
                          $cron$select app.mercado_verificar_se_pendente()$cron$);
  end if;
end $veracidade$;

notify pgrst, 'reload schema';

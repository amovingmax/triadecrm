-- =====================================================================
-- Os relatórios da Imova: funções do schema app sem EXECUTE público (09/11/2026)
--
-- A migração 20261109200000 (os relatórios da Imova) criou nove funções no
-- schema `app` sem tirar o EXECUTE que o Postgres dá a PUBLIC por padrão, e o
-- `anon` herda esse EXECUTE. A guarda do pgTAP 09 (itens 49 e 50) pega isso:
-- nenhuma função de gatilho do `app` pode ser executável por authenticated ou
-- anon, e nenhuma função do `app` pode ser executável por anon. A décima é
-- `app.codigo_de_anuncio_valido` (20261105170000, Anúncios), do mesmo jeito.
--
-- Não havia porta aberta de verdade: o `anon` não tem USAGE no schema `app` e
-- o `app` não está na API. Isto fecha a guarda, sem mudar o que funciona:
--   * as duas funções de GATILHO (`canal_pro_fotografar`, `ficha_anotar_nota`)
--     ficam sem EXECUTE para PUBLIC, anon e authenticated — o gatilho dispara
--     do mesmo jeito (o Postgres não confere EXECUTE na hora do disparo);
--   * as da juíza e o total do Canal Pro só são chamados por funções
--     SECURITY DEFINER, pelo pg_cron e pela própria migração: ficam sem
--     EXECUTE para PUBLIC, anon e authenticated;
--   * os ajudantes de leitura (`atitude_em`, `atitude_degrau`,
--     `texto_de_modelo`, `procura_em_categoria`, `codigo_de_anuncio_valido`)
--     perdem só o PUBLIC e o anon; authenticated e service_role continuam
--     executando, como hoje.
--
-- Na KOMUNE essas funções não existem (as migrações de origem são só da
-- Imova): cada uma só é mexida se existir, e lá nada muda.
-- =====================================================================

do $permissoes$
declare
  v_assinatura text;
  v_funcao     regprocedure;
begin
  -- Gatilhos e funções chamadas só por quem é dono (SECURITY DEFINER, cron).
  foreach v_assinatura in array array[
    'app.canal_pro_fotografar()',
    'app.ficha_anotar_nota()',
    'app.ia_juiza_config()',
    'app.ia_juiza_enfileirar()',
    'app.canal_pro_total(jsonb, text)'
  ] loop
    v_funcao := to_regprocedure(v_assinatura);
    if v_funcao is not null then
      execute format('revoke all on function %s from public, anon, authenticated', v_funcao);
    end if;
  end loop;

  -- Ajudantes de leitura: só saem PUBLIC e anon; quem está logado segue igual.
  foreach v_assinatura in array array[
    'app.atitude_em(uuid, timestamptz)',
    'app.atitude_degrau(text)',
    'app.texto_de_modelo(text, text[], boolean)',
    'app.procura_em_categoria(text, text)',
    'app.codigo_de_anuncio_valido(text)'
  ] loop
    v_funcao := to_regprocedure(v_assinatura);
    if v_funcao is not null then
      execute format('revoke all on function %s from public, anon', v_funcao);
      execute format('grant execute on function %s to authenticated, service_role', v_funcao);
    end if;
  end loop;
end $permissoes$;

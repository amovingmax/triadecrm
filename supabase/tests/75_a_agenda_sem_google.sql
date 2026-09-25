-- =====================================================================
-- pgTAP — A agenda sai do Google (migração 20260930120000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. AS DUAS TABELAS SAÍRAM. O espelho (`public.compromissos_no_google`) e o
--      token (`app.agendas_do_google`).
--   2. AS FUNÇÕES SAÍRAM DOS DOIS LADOS. Nove em `app` e nove invólucros em
--      `public`, que existiam porque o PostgREST não enxerga o schema `app`.
--      Apagar só o lado `app` deixaria invólucros chamando função que não
--      existe: erro em tempo de execução, invisível em migração, e
--      `supabase gen types` continuaria declarando as nove.
--   3. OS SEGREDOS DO VAULT SAÍRAM. `drop table app.agendas_do_google` leva a
--      linha com o `segredo_id` e deixaria o segredo cifrado sem dono e sem
--      quem o apague. `app.agenda_google_guardar` batizou cada um como
--      'agenda_google:' || p_user_id, e é esse prefixo que a limpeza usa.
--   4. AS AUTOMAÇÕES DO SEED APONTAM PARA O CRM. Etapa que promete
--      `"provider":"google"` é etapa prometendo um provedor que não existe
--      mais.
--
-- O QUE ESTE ARQUIVO NÃO PROVA, E NÃO DEVE: que o LOGIN com Google sobreviveu.
-- `SUPABASE_AUTH_GOOGLE_*` é coisa de `config.toml`, não de banco — quem prova
-- isso é o `grep` do critério de pronto, e uma asserção `X or true` aqui seria
-- verdadeira por construção e não provaria nada.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(5);

select hasnt_table('public', 'compromissos_no_google', 'a tabela do espelho saiu');
select hasnt_table('app',    'agendas_do_google',      'a tabela do token saiu');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('app','public')
              and (p.proname like 'agenda_google%' or p.proname like 'compromisso_do_google%'
                   or p.proname = 'agenda_dados_do_evento')),
  0, 'as funções em app e os invólucros em public saíram: invólucro que chama função que não existe é erro em tempo de execução, invisível em migração');

select is((select count(*)::int from vault.secrets where name like 'agenda_google:%'),
  0, 'os segredos do Vault saíram: drop table leva o segredo_id e deixaria o segredo cifrado sem dono e sem quem o apague');

select is((select count(*)::int from public.stages
            where automations::text like '%"provider":"google"%'),
  0, 'as automações de calendar_event apontam para o CRM, não para o Google');

select * from finish();
rollback;

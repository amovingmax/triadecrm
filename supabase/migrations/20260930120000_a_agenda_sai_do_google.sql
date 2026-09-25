-- =====================================================================
-- A AGENDA SAI DO GOOGLE (ADR-15 — decisão de Rafael, 25/09/2026)
--
-- POR QUÊ: com `public.reunioes` (migração irmã 20260930110000), a informação
-- que decide — "esta pessoa está ocupada às 10h" — passou a morar no Postgres.
-- Manter o Google ao lado significaria o robô depender de OAuth de terceiro,
-- refresh token por pessoa e quota de API para responder uma mensagem de
-- WhatsApp. Duas fontes de verdade sobre o mesmo horário é uma a mais.
--
-- A ORDEM DE FORA QUE NÃO PODE INVERTER, E QUE NÃO É DESTA MIGRAÇÃO:
-- ANTES do deploy, e só enquanto os tokens ainda funcionam, os eventos futuros
-- criados pelo CRM no Google são cancelados por `/api/agenda/remover`, para que
-- nenhum fornecedor fique com um convite órfão na agenda dele:
--
--   select count(*) from public.compromissos_no_google g
--     join public.tasks t on t.id = g.task_id
--    where t.due_at > now() and t.status <> 'done';
--
-- Depois de esta migração rodar NÃO HÁ COMO FAZER ISSO: os refresh tokens terão
-- sido destruídos. Reuniões passadas ficam onde estão.
--
-- A ORDEM DENTRO DO ARQUIVO: invólucros públicos → funções em `app` → segredos
-- → tabelas. Os nove invólucros em `public` existem desde 09/09 porque o
-- PostgREST não enxerga o schema `app`. Apagar só o lado `app` deixaria nove
-- funções em `public` chamando funções que não existem — erro em tempo de
-- execução, invisível em migração, e `supabase gen types` continuaria
-- declarando as nove.
--
-- O QUE NÃO SAI, E NÃO PODE SAIR POR ENGANO: o login com Google do CRM
-- (`SUPABASE_AUTH_GOOGLE_CLIENT_ID` / `SUPABASE_AUTH_GOOGLE_SECRET`, em
-- `supabase/config.toml`) e a chave do Maps (`GOOGLE_MAPS_API_KEY`, que é a
-- busca de telefone). São outros dois assuntos com a mesma palavra no nome.
--
-- E o que esta migração NÃO alcança: a permissão OAuth registrada na conta
-- Google de cada pessoa. Cada uma remove o acesso em
-- `myaccount.google.com/permissions`, e o Luiz tira o escopo `calendar.events`
-- da tela de consentimento do cliente OAuth. Está no CHANGELOG.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Os invólucros em `public` (20260909130000)
-- ---------------------------------------------------------------------
drop function if exists public.agenda_google_guardar(uuid, text, text, text[]);
drop function if exists public.agenda_google_token(uuid);
drop function if exists public.agenda_google_token_do_evento(uuid);
drop function if exists public.agenda_google_falhou(uuid, text, boolean);
drop function if exists public.agenda_dados_do_evento(uuid);
drop function if exists public.compromisso_do_google_gravar(uuid, text, text, text, text, uuid);
drop function if exists public.compromisso_do_google_ler(uuid);
drop function if exists public.compromisso_do_google_remanejar(uuid, timestamptz);
drop function if exists public.compromisso_do_google_esquecer(uuid);
drop function if exists public.agenda_google_estado();
drop function if exists public.agenda_google_desconectar();

-- ---------------------------------------------------------------------
-- 2. As funções em `app` (20260908180000 e 20260909100000)
-- ---------------------------------------------------------------------
drop function if exists app.agenda_google_guardar(uuid, text, text, text[]);
drop function if exists app.agenda_google_token(uuid);
drop function if exists app.agenda_google_token_do_evento(uuid);
drop function if exists app.agenda_google_falhou(uuid, text, boolean);
drop function if exists app.agenda_dados_do_evento(uuid);
drop function if exists app.compromisso_do_google_gravar(uuid, text, text, text, text, uuid);
drop function if exists app.compromisso_do_google_ler(uuid);
drop function if exists app.compromisso_do_google_remanejar(uuid, timestamptz);
drop function if exists app.compromisso_do_google_esquecer(uuid);

-- ---------------------------------------------------------------------
-- 3. Os segredos do Vault
--
-- NÃO É OPCIONAL E NÃO ACONTECE SOZINHO. `drop table app.agendas_do_google`
-- leva a linha com o `segredo_id` e deixa o segredo cifrado no Vault para
-- sempre, sem dono e sem quem o apague.
-- ---------------------------------------------------------------------
delete from vault.secrets where name like 'agenda_google:%';

-- ---------------------------------------------------------------------
-- 4. As tabelas (levam política e índice junto)
-- ---------------------------------------------------------------------
drop table if exists public.compromissos_no_google;
drop table if exists app.agendas_do_google;

-- ---------------------------------------------------------------------
-- 5. As automações do seed deixam de prometer Google
--
-- A migração corrige a base que já existe; `supabase/seed.sql` corrige a
-- próxima. Etapa que promete `"provider":"google"` é etapa prometendo um
-- provedor que este banco não tem mais.
-- ---------------------------------------------------------------------
update public.stages
   set automations = replace(automations::text, '"provider":"google"', '"provider":"crm"')::jsonb
 where automations::text like '%"provider":"google"%';

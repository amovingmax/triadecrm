-- =====================================================================
-- Preparo de um projeto Supabase novo, antes da primeira migração.
-- Roda sozinho pelo `scripts/publicar-banco.mjs <empresa> migrar` quando o banco é
-- novo e vazio. Não roda em banco que já tem migração (a KOMUNE nunca passa por aqui).
--
-- Por quê: projetos criados a partir de 2026 (o `imova-crm`, em 21/10/2026) nascem com
-- a opção "expor tabelas novas automaticamente" desligada, e o padrão do papel
-- `postgres` em `public` não dá nada a `authenticated` e `service_role` em funções e
-- sequências. As migrações do CRM foram escritas e testadas com o padrão de sempre — o
-- do `komune-crm` e o do `supabase start`: tabelas, sequências e funções novas valem para
-- `authenticated` e `service_role`, e nada para `anon`. Aqui o projeto novo passa a ter
-- esse mesmo padrão, antes de a primeira tabela nascer.
-- Conferido em 21/10/2026: `pg_default_acl` do `komune-crm` × `imova-crm` × local.
-- =====================================================================
alter default privileges for role postgres in schema public grant all on tables    to authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

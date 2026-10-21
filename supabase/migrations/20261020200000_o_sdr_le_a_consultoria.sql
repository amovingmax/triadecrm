-- =============================================================================
-- O SDR lê a marca de Consultoria (20/10/2026)
-- =============================================================================
-- O SDR voltou a entrar em todas as telas, menos Ajustes (pedido de 20/10/2026;
-- de 06/10 a 20/10 ele só via Meu dia e Lotes). A aba Consultoria de Conversas
-- lê `public.consultoria`, cuja leitura era só da gestão (`app.is_manager()`):
-- para o SDR a aba viria vazia, sem erro nenhum.
--
-- A leitura passa a ser de quem vê a base (`app.sees_all()`, a mesma regra de
-- `organizations_view`): a marca não tem PII, é só "este parceiro está na
-- Consultoria". Pôr e tirar continua só pela `public.consultoria_marcar`, que
-- segue recusando quem não é admin nem gestor.
--
-- Pode rodar de novo sem efeito.
-- =============================================================================

drop policy if exists consultoria_select on public.consultoria;
create policy consultoria_select on public.consultoria
  for select to authenticated using ((select app.sees_all()));

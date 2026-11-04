-- =====================================================================
-- Concluir a conversa também na KOMUNE (04/11/2026)
-- =====================================================================
-- Pedido do usuário, depois de publicar a tela de Conversas no jeito do WhatsApp
-- na Imova: "Quero que todas as mudanças que fizemos na aba de conversas da Imova
-- sejam feitas para o CRM da Komune também". O Concluir é uma delas (protótipo
-- aprovado, com a gaveta de "Concluídas" no lugar das "Arquivadas" do WhatsApp).
-- As regras são as da Imova (20261104120000): a concluída volta quando a pessoa
-- escreve ou quando alguém do time manda mensagem, e sai do Meu dia. A chave era
-- uma só, de propósito; muda só ela. Na Imova não muda nada: lá ela já era
-- verdadeira.
create or replace function app.concluir_ligado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select true
$$;
comment on function app.concluir_ligado() is
  'Concluir a conversa (03/11/2026) vale neste banco? Nas duas empresas desde 04/11/2026: a conversa concluída volta quando alguém do time escreve e sai do Meu dia.';
revoke all on function app.concluir_ligado() from public, anon, authenticated;

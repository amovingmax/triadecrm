-- =====================================================================
-- Localização e cartão de contato viram tipos de mensagem de verdade
--
-- Pedido de 27/10/2026: "quero todas as funcionalidades do wpp no nosso
-- CRM". Até aqui a localização e o cartão de contato que o parceiro manda
-- entravam como `system` (com o nome da Meta em `tipo_na_meta`), porque o
-- enum não os conhecia — e o CRM também não os mandava. Agora o CRM manda
-- os dois, e eles ganham nome próprio.
--
-- Fica sozinha num arquivo porque o Postgres não deixa USAR um valor novo
-- de enum na mesma transação que o criou; a migração seguinte já o usa.
--
-- `app.wa_tipo_da_meta` não precisa mudar: ela tenta `v_bruto::app.msg_type`
-- antes de cair em `system`, então `location` e `contacts` passam a entrar
-- com o tipo certo sozinhos.
--
-- RF-CON-05
-- =====================================================================

alter type app.msg_type add value if not exists 'location';
alter type app.msg_type add value if not exists 'contacts';

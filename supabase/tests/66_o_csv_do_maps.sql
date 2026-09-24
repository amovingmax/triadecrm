-- =====================================================================
-- pgTAP — O CSV do Google Maps entra pela importação (migração 20260924130000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. O ENDEREÇO NÃO É PALPITE. `app.endereco_br` lê bairro, cidade e CEP de
--      uma coluna só e devolve NULO em tudo que não casou. O Google não
--      garante formato nenhum (MEI que atende em casa, rodovia, ponto de
--      referência): bairro inventado não estraga a ficha, estraga a visita de
--      quem for até lá.
--
-- (As tarefas seguintes acrescentam a este cabeçalho os outros pontos, junto
-- com as asserções que os provam. Cabeçalho que descreve teste que não existe
-- é promessa, e este arquivo é sobre não palpitar.)
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada: este banco
-- tem operação real dentro. Tudo é delta ou escopo por lote deste arquivo.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(5);

-- =====================================================================
-- 1. O endereço numa coluna só vira três campos (§3.2 item 1)
-- =====================================================================
select is(
  app.endereco_br('Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095'),
  '{"bairro": "Capim Macio", "cidade": "Natal", "cep": "59082-095"}'::jsonb,
  'endereço completo: bairro, cidade e CEP saem os três');

select is(
  app.endereco_br('Av. Eng. Roberto Freire, Natal - RN, 59082-095'),
  '{"bairro": null, "cidade": "Natal", "cep": "59082-095"}'::jsonb,
  'sem bairro: o pedaço anterior ao da cidade não tem " - ", então bairro é nulo');

select is(
  app.endereco_br('Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN'),
  '{"bairro": "Capim Macio", "cidade": "Natal", "cep": null}'::jsonb,
  'sem CEP: os outros dois continuam saindo');

select is(
  app.endereco_br('Loja no calçadão, perto da praia'),
  '{"bairro": null, "cidade": null, "cep": null}'::jsonb,
  'endereço que não casa com nada volta todo nulo: aqui não se palpita');

select is(
  app.endereco_br('R. Pedro Velho, 500 - Petrópolis, Natal - RN, 59012310'),
  '{"bairro": "Petrópolis", "cidade": "Natal", "cep": "59012-310"}'::jsonb,
  'CEP sem hífen sai normalizado em NNNNN-NNN');

select * from finish();
rollback;

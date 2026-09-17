-- =====================================================================
-- pgTAP — O cumprimento que abre conversa (migrações 20260917200000/200100)
--
-- "Quero começar apenas com boa tarde, bom dia — pra prender a atenção — e
-- depois que eu souber que estou falando com o responsável, aí sim mando o que
-- quero" (Rafael, 17/09/2026).
--
-- A moldura que a tela oferecia pedia o NOME de alguém que a base não conhece e
-- despejava um parágrafo de 240 caracteres antes de a pessoa dizer se era a
-- responsável.
--
-- O que este arquivo prova:
--   1. A saudação segue o relógio de Natal, e não o do servidor.
--   2. O modelo novo tem DUAS variáveis e NENHUMA delas é para digitar: as duas
--      chegam prontas do servidor. É isso que faz dele um clique só.
--   3. Ele continua se identificando ("aqui é fulano, da Komune") — o que sai é
--      o SAIR e o link, que são regra nossa e decisão do Dennis.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(10);

-- ---------- 1. o relógio ----------
select is(app.saudacao_do_momento(('2026-09-17 08:00' at time zone 'America/Fortaleza')), 'Bom dia',
  '8h em Natal é bom dia');
select is(app.saudacao_do_momento(('2026-09-17 11:59' at time zone 'America/Fortaleza')), 'Bom dia',
  '11h59 ainda é bom dia');
select is(app.saudacao_do_momento(('2026-09-17 12:00' at time zone 'America/Fortaleza')), 'Boa tarde',
  'meio-dia vira boa tarde');
select is(app.saudacao_do_momento(('2026-09-17 17:59' at time zone 'America/Fortaleza')), 'Boa tarde',
  '17h59 ainda é boa tarde');
select is(app.saudacao_do_momento(('2026-09-17 18:00' at time zone 'America/Fortaleza')), 'Boa noite',
  '18h vira boa noite');
-- O fuso importa: às 23h de Natal é 2h da manhã em UTC, e um servidor que
-- usasse o próprio relógio diria "bom dia" para quem está indo dormir.
select is(app.saudacao_do_momento('2026-09-18 02:00+00'::timestamptz), 'Boa noite',
  'O RELÓGIO É O DE NATAL: 2h UTC é 23h aqui, e ninguém diz bom dia às 23h');

-- ---------- 2. o modelo ----------
select ok((select body like 'Oi! {{saudacao}}, aqui é {{atendente}}%'
             from public.message_templates where template_code = 'GEN-ABR-CUMPRIMENTO'),
  'O CORPO NÃO COMEÇA COM VARIÁVEL: a Meta recusa, e o "Oi!" fixo é o que o torna submissível');

select ok((select length(body) < 200 from public.message_templates
            where template_code = 'GEN-ABR-CUMPRIMENTO'),
  'e ele é curto: 190 caracteres contra os 240 da moldura que existia');

select is((select array_length(app.modelo_variaveis(body), 1)
             from public.message_templates where template_code = 'GEN-ABR-CUMPRIMENTO'), 2,
  'DUAS VARIÁVEIS, e nenhuma é campo de formulário: as duas vêm prontas do servidor');

-- ---------- 3. o que ele mantém ----------
-- A identificação fica: a Meta não a exige, mas nós sim (R06 §2). O que saiu foi
-- o SAIR e o link de privacidade, e isso é decisão registrada, não descuido.
select ok((select body like '%da Komune%' from public.message_templates
            where template_code = 'GEN-ABR-CUMPRIMENTO'),
  'e ele continua dizendo de onde a mensagem vem');

rollback;

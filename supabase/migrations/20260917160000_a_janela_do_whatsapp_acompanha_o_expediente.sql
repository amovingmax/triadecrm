-- =====================================================================
-- A janela do WhatsApp passa a ser o expediente: 8h às 17h45, sem almoço
--
-- Decisão do Rafael em 17/09/2026: "tire essa trava e deixe nosso
-- funcionamento das 8h às 17h45".
--
-- O que havia: seg–sex em DUAS faixas, 9h–12h e 14h–18h. O intervalo de almoço
-- vinha do R08 (o horário em que fornecedor de evento atende melhor), e na
-- prática virou uma parede: entre meio-dia e duas, a tela recusava TODO primeiro
-- contato e a equipe não entendia por quê — foi exatamente o que aconteceu hoje,
-- às 13h55, com "abre às 14h" e nenhuma explicação do motivo.
--
-- O que passa a haver: uma faixa por dia útil, 08:00–17:45, que é o expediente
-- da KOMUNE. Quem está no CRM trabalhando pode falar com parceiro a qualquer
-- hora do próprio expediente.
--
-- =====================================================================
-- O QUE NÃO MUDA, E É DE PROPÓSITO
-- =====================================================================
-- * **Domingo e feriado continuam fechados** (RF-CON-11, R06 §3.4). Não é
--   preferência de horário: é o compromisso que a operação assume por escrito.
-- * **O teto legal da tabela continua valendo.** O CHECK `channel_windows_teto_legal`
--   recusa seg–sex fora de 08:00–19:00 — 8h às 17h45 cabe com folga, e é ele que
--   impede alguém de, num dia apressado, configurar envio às 6 da manhã.
-- * **Sábado fica como está**: 10h–12h e SÓ para quem já respondeu. Sábado não é
--   expediente, e abrir primeiro contato nele é outra decisão, que ninguém tomou.
-- * **A janela de 24 h não tem nada com isto.** Responder quem escreveu é livre a
--   qualquer hora; esta janela governa só a mensagem que NÓS começamos.
-- * **A janela da LIGAÇÃO é outra** (`app.call_window`) e não é tocada aqui.
-- =====================================================================

delete from public.channel_windows
 where channel = 'whatsapp'::app.channel and dow between 1 and 5;

insert into public.channel_windows (channel, dow, "position", de, ate, requires_reply, note)
select 'whatsapp'::app.channel, d, 1, 8::numeric, 17.75::numeric, false,
       'Expediente da KOMUNE (decisão de 17/09/2026)'
  from generate_series(1, 5) as d;

comment on table public.channel_windows is
  'Janela de contato proativo por canal e dia da semana (RF-CON-11). WhatsApp: seg–sex 08:00–17:45 (o expediente da KOMUNE, decidido em 17/09/2026), sáb 10:00–12:00 só para quem já respondeu, domingo nunca. O CHECK channel_windows_teto_legal recusa configurar fora do teto do R06 §3.4. Ligação não está aqui: usa app.call_window.';

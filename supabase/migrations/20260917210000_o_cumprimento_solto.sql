-- =====================================================================
-- O cumprimento vai SOLTO: "Boa tarde." e mais nada
--
-- =====================================================================
-- A DECISÃO, E DE QUEM ELA É
-- =====================================================================
-- Rafael, 17/09/2026, depois de ver a versão de 190 caracteres: "o boa tarde tem
-- que ser solto". O primeiro contato passa a ser só o cumprimento. Quando a
-- pessoa responder, a janela de 24 h abre e a conversa segue em texto livre.
--
-- Isto muda a REGRA NOSSA que exigia "SAIR" e o link de privacidade em toda
-- abertura (RF-CON-12, R06 §2), e a mudança é dele, não minha. Fica registrada
-- aqui e no CHANGELOG, com data, para quem for auditar não precisar adivinhar.
--
-- =====================================================================
-- POR QUE A REGRA AINDA FAZ SENTIDO DEPOIS DESTA MUDANÇA
-- =====================================================================
-- O que o RF-CON-12 protege é a pessoa receber OFERTA sem saber de quem e sem
-- saber como parar. "Boa tarde." não é oferta: não diz o que a Komune é, não
-- propõe nada, não pede dado nenhum. O que carrega conteúdo comercial é a
-- mensagem seguinte — e essa continua obrigada a se identificar e a oferecer
-- saída, o que o teste 08 passa a checar nesses termos.
--
-- Quem discordar dessa leitura tem um lugar exato para discordar: o corpo destes
-- três modelos, e esta nota.
--
-- =====================================================================
-- POR QUE TRÊS MODELOS, E NÃO UM COM {{saudacao}}
-- =====================================================================
-- A Meta recusa modelo que começa com variável (o teste 43 pegou isso antes
-- dela). "{{saudacao}}." seria recusado na submissão. Três corpos fixos passam,
-- e quem escolhe entre eles é o relógio de Natal, no CRM — a pessoa não escolhe
-- período, do mesmo jeito que não escolhe o próprio nome.
-- =====================================================================

-- O de 190 caracteres sai de cena: ele foi um passo intermediário de hoje e
-- nunca chegou a ser aprovado. Fica inativo em vez de apagado — modelo apagado é
-- histórico apagado, e a Meta ainda pode responder sobre ele.
update public.message_templates
   set is_active = false
 where template_code = 'GEN-ABR-CUMPRIMENTO';

insert into public.message_templates
  (template_code, name, channel, category, segment, kind, variant, meta_template_name,
   meta_status, language, body, is_active)
values
  ('GEN-ABR-OLA-MANHA', 'Bom dia (cumprimento solto)', 'whatsapp', 'marketing', null,
   'abertura', 'A', 'gen_abr_ola_manha_v1', 'pending', 'pt_BR', 'Bom dia!', true),
  ('GEN-ABR-OLA-TARDE', 'Boa tarde (cumprimento solto)', 'whatsapp', 'marketing', null,
   'abertura', 'A', 'gen_abr_ola_tarde_v1', 'pending', 'pt_BR', 'Boa tarde!', true),
  ('GEN-ABR-OLA-NOITE', 'Boa noite (cumprimento solto)', 'whatsapp', 'marketing', null,
   'abertura', 'A', 'gen_abr_ola_noite_v1', 'pending', 'pt_BR', 'Boa noite!', true)
on conflict (template_code) do nothing;

comment on table public.message_templates is
  'Modelos de mensagem (RF-CON-02). Os três GEN-ABR-OLA-* são o cumprimento solto decidido pelo Rafael em 17/09/2026: primeiro contato é só "Bom dia!", e a identificação com SAIR e privacidade passa para a primeira mensagem COM CONTEÚDO, que é onde o RF-CON-12 morde. O CRM escolhe entre os três pelo relógio de America/Fortaleza.';

-- O aviso passa a ter para onde responder.
--
-- O primeiro teste caiu no spam do Gmail, e a causa é conhecida: o remetente era
-- `onboarding@resend.dev` — domínio compartilhado do Resend, sem relação com
-- komune.app.br. O conserto de verdade é verificar o domínio da Komune no Resend e
-- trocar o `de`; o que dá para fazer do lado do CRM é parar de mandar e-mail sem
-- resposta possível: `responder_para` vira o Reply-To.
update public.app_settings
   set value = value || jsonb_build_object('responder_para', 'komune@komune.app.br'),
       updated_at = now()
 where key = 'notificacoes.email'
   and not (value ? 'responder_para');

comment on table public.app_settings is
  'Configuração viva do CRM, por chave. notificacoes.email: aviso de WhatsApp por e-mail (ativo, de, responder_para, para, url_do_crm).';

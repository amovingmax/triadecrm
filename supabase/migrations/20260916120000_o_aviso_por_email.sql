-- O time é avisado por e-mail quando alguém escreve no WhatsApp da Komune.
--
-- O número vive só na Cloud API (14/09/2026): não toca celular nenhum e ninguém
-- ouve "plim". Quem avisa passa a ser o worker-wa, por e-mail, pelo Resend
-- (pedido do Rafael em 16/09/2026). O que é configuração fica aqui, não no código:
-- para quem manda, de quem sai e qual endereço do CRM entra no link.
--
-- `ativo` continua valendo com a chave ausente: sem `RESEND_API_KEY` no worker, o
-- aviso não sai e fica um `warn` no log — ligado e sem chave é um estado que a
-- pessoa precisa ver, não um silêncio.
insert into public.app_settings (key, value, description)
values ('notificacoes.email', $j${
  "ativo": true,
  "de": "Komune CRM <onboarding@resend.dev>",
  "para": ["komune@komune.app.br"],
  "url_do_crm": "https://triade-crm-tawny.vercel.app"
}$j$::jsonb,
  'Aviso por e-mail (Resend) quando chega mensagem no WhatsApp: se está ligado, de quem sai, para quem vai e o endereço do CRM que entra no link. Trocar o "de" por um endereço do domínio komune.app.br exige o domínio verificado no Resend.')
on conflict (key) do nothing;

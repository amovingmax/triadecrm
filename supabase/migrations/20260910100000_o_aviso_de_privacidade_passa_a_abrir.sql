-- ===========================================================================
-- O aviso de privacidade da primeira mensagem passa a abrir (RF-CON-12; R06 §2)
-- ===========================================================================
--
-- As 16 aberturas de WhatsApp terminam com a linha que o legítimo interesse
-- exige — quem somos, como sair, e como usamos seus dados:
--
--     "...para não receber mais, responda SAIR.
--      Como usamos seus dados: komune.app/privacidade"
--
-- **`komune.app` não responde.** O domínio resolve no DNS e o servidor não
-- atende: `https://`, `http://` e `www.` devolvem os três falha de conexão, não
-- 404. Quem clicasse veria o erro do navegador, sem página nenhuma.
--
-- `komune.app.br/privacidade` responde 200, e é o mesmo endereço que o wizard
-- de cadastro da própria Komune já usa no aceite dos termos
-- (`admin/src/components/OnboardingWizard.tsx`). Ou seja: o endereço certo já
-- existia e já estava em uso do outro lado da integração — o CRM é que ficou
-- com a versão sem `.br`, herdada do PRD §7 (RF-CON-12) e do exemplo do §12.4.
--
-- POR QUE ISTO É MAIS QUE UM LINK QUEBRADO
-- ---------------------------------------------------------------------------
-- É a única linha da mensagem que sustenta a base legal. O R06 §2 documenta a
-- prospecção B2B sobre legítimo interesse (LGPD art. 7º, IX), e o que separa
-- legítimo interesse de lista comprada é justamente a transparência: dizer de
-- onde veio o contato, como sair, e onde ler o que se faz com o dado. Um link
-- morto nesse lugar transforma a frase em enfeite — e o R06 cita, no mesmo
-- parágrafo, a multa de €240 mil que a CNIL aplicou à KASPR por responder à
-- origem dos dados de forma genérica.
--
-- Nenhuma dessas 16 mensagens chegou a ser enviada: o número da Meta ainda não
-- foi verificado, e `meta_status` continua `pending` nas aberturas. O conserto
-- entra antes do primeiro disparo, que é o único momento em que ele é barato.
--
-- POR QUE `update` E NÃO SÓ A SEED
-- ---------------------------------------------------------------------------
-- `supabase/seed.sql` só roda em `db reset`. Os 126 modelos já estão gravados
-- no `komune-crm` de produção desde o D1, e é de lá que a fila de primeiros
-- contatos lê. A seed foi corrigida no mesmo commit, para o banco novo nascer
-- certo; este bloco conserta o banco que já existe.
--
-- A troca é textual e ancorada: `komune.app/privacidade` só casa onde falta o
-- `.br`, porque em `komune.app.br/privacidade` o caractere seguinte a
-- `komune.app` é um ponto, não uma barra. Rodar duas vezes não gera `.br.br`.
-- ===========================================================================

update public.message_templates
   set body = replace(body, 'komune.app/privacidade', 'komune.app.br/privacidade')
 where body like '%komune.app/privacidade%';

-- O aviso de origem também vive no catálogo de mensagens fixas (R06 §10.7):
-- a resposta a "quem te deu meu número?" e a confirmação de opt-out. Se algum
-- dia elas passarem a citar o endereço, a troca é a mesma.
do $$
declare
  v_restantes int;
begin
  select count(*) into v_restantes
    from public.message_templates
   where body like '%komune.app/privacidade%';

  if v_restantes > 0 then
    raise exception 'ainda restam % modelos com o endereço sem .br', v_restantes;
  end if;

  -- Barulho no lugar do silêncio: se um dia alguém reintroduzir o endereço
  -- velho pela seed, esta contagem é o que denuncia.
  select count(*) into v_restantes
    from public.message_templates
   where body like '%komune.app.br/privacidade%';

  raise notice 'aviso de privacidade: % modelos apontam para komune.app.br/privacidade', v_restantes;
end $$;

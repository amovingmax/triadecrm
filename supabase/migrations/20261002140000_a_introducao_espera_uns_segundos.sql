-- =====================================================================
-- A introdução espera uns segundos, e o texto passa a ser o do Rafael
--
-- Decisão do Rafael em 28/09/2026: "coloque um padrão pra introdução sair
-- 10 segundos depois apenas". Proposto e aceito por ele: em vez de 10 cravados,
-- um sorteio entre 8 e 14.
--
-- POR QUE NÃO 10 EXATOS
-- Dez segundos toda vez é uma assinatura tão robótica quanto responder na hora:
-- quem recebe duas vezes percebe o metrônomo. O sorteio custa uma linha e tira
-- o padrão. É pelo mesmo motivo que a campanha já sorteia o intervalo entre
-- envios (`app.envio_intervalo`, 20260921100000) em vez de disparar de X em X.
--
-- ONDE O ATRASO ENTRA, E POR QUE AQUI
-- A introdução não é enviada direto: ela nasce como mensagem `queued` e o
-- `public.wa_saida_enfileirar_pendentes` a varre e a enfileira em `wa_outbound`.
-- O worker descansa 5 s entre varreduras (`DESCANSO_MS`, apps/workers/src/
-- workers/wa.ts:83), então hoje ela sai entre 0 e 5 segundos depois da resposta
-- do lead — praticamente instantânea.
--
-- O lugar certo de segurar é a ENTRADA DA FILA, e não uma coluna nova em
-- `messages` nem um cron: `app.esteira_enfileirar` já aceita `p_delay` e o
-- repassa ao `pgmq.send`, que deixa a mensagem invisível pelo tempo pedido.
-- Nada no caminho de envio muda; a mensagem só aparece para o worker mais tarde.
--
-- O ATRASO CONTA DA RESPOSTA DO LEAD, não do enfileiramento. Como a varredura
-- pode ter demorado, o que se enfileira é o que FALTA para completar o sorteio:
-- se já passaram 4 s dos 11 sorteados, a fila segura 7. Assim o que a pessoa do
-- outro lado sente é o tempo total, que é o que o Rafael pediu.
--
-- SÓ A INTRODUÇÃO. Toda outra mensagem continua saindo sem atraso: confirmação
-- de opt-out, resposta do menu, cumprimento de campanha e o que uma pessoa
-- escreve. Segurar uma resposta humana por 10 s seria mentira ao contrário.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. O texto que o Rafael aprovou
-- ---------------------------------------------------------------------------
-- Escrito por ele em 28/09/2026 e ajustado num ponto, que fica registrado aqui
-- porque é o tipo de frase que volta: onde o texto dele dizia "nosso aplicativo
-- é 100% gratuito", ficou "a divulgação de vocês nele é gratuita". Numa mensagem
-- para FORNECEDOR, "100% gratuito" é lido como "de graça para mim", e não é: há
-- os 8% do evento fechado e a taxa do escrow que o Dennis ainda está refazendo —
-- a mesma família da frase que `base-conhecimento.ts:36` registra como falsa
-- desde 08/09. O que é verdade, e está no modelo que a Meta já aprovou
-- (`GEN-ABR-PARCERIA`), é que a divulgação no app não custa.
--
-- O "SAIR" saiu do texto a pedido dele. A regra continua valendo calada:
-- `app.wa_parece_optout` entende "sair", "parar", "não quero" e "remover" tenha
-- ou não a instrução escrita, e a origem do contato continua dita na própria
-- mensagem ("Vi vocês no Google Maps"), que é o que responde "como conseguiu
-- meu número?".
--
-- Sem nome de atendente, de propósito: é o que deixa qualquer pessoa do time
-- pegar a conversa depois sem que o lead perceba a troca.
update public.message_templates
   set body = 'Sou da Komune, o aplicativo que facilita a conexão e a contratação entre organizadores de eventos (contratantes) e produtores/fornecedores. Vi vocês no Google Maps.

Já temos parceria com fornecedores daqui de Natal — Malca Recepções, Neuma Leão, Gatto Pizzaria, entre outros.

O app já está em todas as lojas, e a divulgação de vocês nele é gratuita. Já são 20 mil pessoas cadastradas na plataforma, e estamos buscando parceiros pra atender essa demanda.

Você tem interesse em entender melhor como funciona?',
       updated_at = now()
 where template_code = 'GEN-SYS-INTRO';

-- ---------------------------------------------------------------------------
-- 2. A faixa do sorteio, ajustável sem deploy
-- ---------------------------------------------------------------------------
-- Mora junto de `introducao_ativa`, na mesma chave que o gestor já edita em
-- Ajustes → Atendimento. Zero nos dois campos volta ao comportamento de antes.
update public.app_settings
   set value = value || jsonb_build_object('introducao_atraso_s',
                          jsonb_build_object('min', 8, 'max', 14)),
       updated_at = now()
 where key = 'atendimento';

-- ---------------------------------------------------------------------------
-- 3. Quantos segundos segurar esta mensagem
-- ---------------------------------------------------------------------------
-- Função pura e separada para poder ser testada sem fila: recebe a mensagem e
-- devolve o atraso em segundos. Devolve 0 para tudo que não for a introdução.
create or replace function app.wa_atraso_do_envio(p_message_id uuid)
returns integer
language plpgsql
-- VOLATILE, e não `stable`: a função SORTEIA, então duas chamadas com o mesmo
-- argumento devolvem valores diferentes — que é exatamente o que `stable`
-- promete que não acontece. E `stable` enxerga o banco do começo da instrução,
-- então ela nem via a mensagem recém-inserida quando as duas coisas caíam na
-- mesma instrução. Os dois motivos apontam para o mesmo lugar.
volatile
security definer
set search_path = ''
as $$
declare
  m        public.messages%rowtype;
  v_cfg    jsonb;
  v_min    int;
  v_max    int;
  v_alvo   int;
  v_passou int;
begin
  select * into m from public.messages where id = p_message_id;
  if not found or m.template_id is null then
    return 0;
  end if;
  if not exists (select 1 from public.message_templates t
                  where t.id = m.template_id and t.template_code = 'GEN-SYS-INTRO') then
    return 0;
  end if;

  v_cfg := coalesce((select value -> 'introducao_atraso_s' from public.app_settings
                      where key = 'atendimento'), '{}'::jsonb);
  v_min := greatest(coalesce((v_cfg ->> 'min')::int, 0), 0);
  v_max := greatest(coalesce((v_cfg ->> 'max')::int, 0), v_min);
  if v_max = 0 then
    return 0;
  end if;

  -- O sorteio é por mensagem, e acontece aqui, uma vez, no enfileiramento.
  v_alvo   := v_min + floor(random() * (v_max - v_min + 1))::int;
  -- O que já passou desde que a mensagem nasceu: a varredura pode ter demorado,
  -- e o que o lead sente é o tempo total, não o tempo de fila.
  v_passou := floor(extract(epoch from (now() - m.created_at)))::int;
  return greatest(v_alvo - v_passou, 0);
end $$;
comment on function app.wa_atraso_do_envio(uuid) is
  'Segundos a segurar esta mensagem na fila. Só a introdução (GEN-SYS-INTRO) espera; o sorteio vem de app_settings.atendimento.introducao_atraso_s e desconta o tempo que já passou desde que a mensagem nasceu. Todo o resto sai sem atraso.';
revoke all on function app.wa_atraso_do_envio(uuid) from public, anon, authenticated;
grant execute on function app.wa_atraso_do_envio(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. O enfileirador passa a perguntar quanto segurar
-- ---------------------------------------------------------------------------
-- Cópia da versão viva (20260905000200), com uma linha a mais: o quarto e o
-- quinto argumentos de `app.esteira_enfileirar` (lote e atraso).
create or replace function app.wa_enfileirar_envio(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_message_id;
  if not found then
    raise exception 'Mensagem % não existe', p_message_id using errcode = 'P0002';
  end if;
  if m.direction <> 'out'::app.msg_direction or m.status <> 'queued'::app.msg_status then
    return jsonb_build_object('enfileirado', false, 'motivo', 'nao_esta_na_fila_de_saida');
  end if;
  return app.esteira_enfileirar('wa_outbound',
                                jsonb_build_object('message_id', m.id, 'conversation_id', m.conversation_id),
                                m.id::text,
                                null,
                                app.wa_atraso_do_envio(m.id));
end $$;

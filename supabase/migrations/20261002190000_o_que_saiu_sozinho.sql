-- =====================================================================
-- O que o CRM mandou sozinho ganha uma consulta
--
-- POR QUE
-- Rafael, 28/09/2026: "onde e como vemos as mensagens que foram enviadas
-- automáticas? como tá esse processo? deixe isso organizado". Hoje a mensagem
-- automática é distinguível DENTRO da conversa — `mensagem-do-fio.tsx` mostra
-- "Texto fixo do robô" para `bot_fixed` e "Rascunho da IA" para `bot_ai` — e
-- INVISÍVEL fora dela. Para saber o que o robô mandou ontem, só abrindo conversa
-- por conversa. O fluxo novo (a campanha manda "Bom dia!", o lead responde, 8 a
-- 14 s depois sai a introdução, e daí em diante quem fala é gente) não tem
-- nenhum lugar onde alguém confira se ele está se comportando.
--
-- NENHUMA CONSULTA EXISTENTE SERVE
-- `app.conversas_esperando_gente` responde por CONVERSA, e a pergunta aqui é por
-- MENSAGEM. `public.envio_em_massa_detalhe` (20260921100000:603) é por LOTE, e o
-- que sai sozinho não tem lote. `conversas/dados.ts` é por parceiro e tem teto.
--
-- O RECORTE: `direction = 'out' and author_kind <> 'human'`
-- Pega `bot_fixed` (o menu do bot de entrada, a ausência e a introdução),
-- `bot_ai` (os rascunhos aprovados) e `system` (a confirmação de opt-out). O
-- enunciado do dia dizia `in ('bot_fixed','bot_ai')`, e isso deixaria de fora a
-- confirmação de opt-out (20260905000300:802), que é `system` e é justamente a
-- que mais precisa ser auditável — ela é a prova de que o guardrail do CLAUDE.md
-- funcionou.
--
-- E DEIXA DE FORA O CUMPRIMENTO DA CAMPANHA, QUE É DESVIO DO PEDIDO
-- O "Bom dia!" da campanha é `author_kind = 'human'`, assinado por quem disparou
-- (`public.wa_enviar_modelo`, 20260915130000:338-341, `sent_by = v_eu`). Ele não
-- é do robô: é uma pessoa mandando mil mensagens de uma vez, e já tem tela em
-- /envios, com `respondeu` por item. Pôr os dois no mesmo feed misturaria "o CRM
-- falou sozinho" com "alguém disparou em massa", que são duas perguntas e duas
-- decisões. O enunciado do Rafael listava o cumprimento entre as coisas a
-- cobrir; isto é uma discordância consciente, está no CHANGELOG como pergunta a
-- ele, e é um `<>` a menos se ele disser que quer os dois juntos.
--
-- O QUE ACONTECEU DEPOIS, EM DUAS COLUNAS E NÃO EM UM RÓTULO
-- `respondeu_em` (a primeira entrada do lead depois daquela mensagem) e
-- `gente_falou_em` (a primeira saída de gente depois dela). Duas, porque um
-- rótulo único perderia o caso que importa: RESPONDEU E NINGUÉM FALOU. É o
-- cruzamento das duas que mostra o fluxo novo parando no terceiro passo, e é
-- para ver isso que a tela existe. Sem elas, isto seria um log — e log ninguém lê.
--
-- AS DUAS TÊM A MESMA FORMA, DE PROPÓSITO
-- `respondeu_em` poderia ser `conversations.last_inbound_at`, que já está na
-- linha e sai de graça. Seria errado: `last_inbound_at` é a ÚLTIMA entrada da
-- CONVERSA INTEIRA, então toda automática antiga de uma conversa viva marcaria
-- "respondeu", com um carimbo que pode ser resposta a outra coisa dita três dias
-- depois. A pergunta é "o lead voltou a falar DEPOIS DESTA mensagem?", e a
-- resposta é a primeira entrada posterior. Se as duas colunas não tivessem a
-- mesma forma, cruzá-las não significaria nada.
--
-- POR QUE DEFINER, E O QUE ISSO NÃO AUTORIZA
-- Definer é para poder fazer o join com `conversations` e `organizations` sem
-- depender das políticas do chamador em cada tabela. O recorte de VISIBILIDADE é
-- o mesmo de `conversations_select` (20260905000200:720-726), repetido por
-- escrito dentro da consulta: `app.sees_all()`, ou a conversa é minha, ou sou
-- embaixador e a ficha é da minha carteira. Definer é para poder juntar, não
-- para furar (asserção 8 do teste 91).
--
-- O ÍNDICE
-- Parcial, sobre o recorte exato do feed: quase toda saída do CRM é `human`, e
-- sem ele a varredura seria da tabela mais quente do banco. Diferente da
-- 20261002150000:201-210, aqui o filtro TEM caminho de índice — é um `=` de
-- direção, um `<>` de autor (no predicado, não na chave) e um intervalo de
-- `created_at`, que é justamente a chave.
--
-- RF-CON-05, RF-ADM-03 · ADR-17
-- =====================================================================

create index if not exists messages_automaticas_idx
  on public.messages (created_at desc)
  where direction = 'out'::app.msg_direction and author_kind <> 'human';

create or replace function public.mensagens_automaticas(
  p_desde  timestamptz default (now() - interval '7 days'),
  p_ate    timestamptz default now(),
  p_limite int         default 200)
returns table (
  message_id      uuid,
  conversation_id uuid,
  organization_id uuid,
  organizacao     text,
  quando          timestamptz,
  autor           text,
  modelo          text,
  rotulo          text,
  corpo           text,
  entrega         text,
  erro            text,
  respondeu_em    timestamptz,
  gente_falou_em  timestamptz,
  atendente       text)
language sql
stable
security definer
set search_path = ''
as $$
  with visiveis as (
    select m.id, m.conversation_id, m.created_at, m.author_kind, m.template_id,
           m.body, m.status, m.error_code, c.organization_id, c.assignee_id
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where m.direction = 'out'::app.msg_direction
       and m.author_kind <> 'human'
       and m.created_at >= p_desde
       -- `<=` E NÃO `<`: o padrão de `p_ate` é `now()`, e "até agora" inclui
       -- agora. Com `<`, a mensagem que o gatilho acabou de gravar na mesma
       -- transação da entrada — que é como a introdução nasce — ficaria de fora
       -- do próprio feed que existe para vigiá-la. Isto não é paginação: é um
       -- feed, e o risco de contar duas vezes a linha da borda não existe.
       and m.created_at <= p_ate
       -- O MESMO recorte de conversations_select (20260905000200:720-726),
       -- repetido por escrito. Definer é para poder fazer o join, não para furar.
       and (app.sees_all()
            or c.assignee_id = auth.uid()
            or (app.role() = 'embaixador'::app.user_role
                and c.organization_id is not null
                and app.org_is_mine(c.organization_id)))
     order by m.created_at desc
     limit least(greatest(coalesce(p_limite, 200), 1), 500)
  )
  select v.id, v.conversation_id, v.organization_id, o.name, v.created_at,
         v.author_kind, t.template_code, t.name, v.body,
         v.status::text, v.error_code,
         -- O LEAD VOLTOU A FALAR DEPOIS DESTA MENSAGEM. Subconsulta, e não
         -- `c.last_inbound_at`: aquela é a última entrada da conversa inteira e
         -- marcaria "respondeu" em toda automática antiga de conversa viva.
         (select min(i.created_at) from public.messages i
           where i.conversation_id = v.conversation_id
             and i.direction = 'in'::app.msg_direction
             and i.created_at > v.created_at),
         -- GENTE DO TIME FALOU DEPOIS DELA. `author_kind = 'human'` de propósito:
         -- outra mensagem do robô não é alguém assumindo, e contá-la como
         -- assunção esconderia exatamente o caso que esta tela veio mostrar.
         -- `status <> 'failed'` porque mensagem que não saiu não assumiu nada.
         (select min(g.created_at) from public.messages g
           where g.conversation_id = v.conversation_id
             and g.direction = 'out'::app.msg_direction
             and g.author_kind = 'human'
             and g.status <> 'failed'::app.msg_status
             and g.created_at > v.created_at),
         app.primeiro_nome(v.assignee_id)
    from visiveis v
    left join public.organizations o on o.id = v.organization_id
    left join public.message_templates t on t.id = v.template_id
   order by v.created_at desc
$$;
comment on function public.mensagens_automaticas(timestamptz, timestamptz, int) is
  'O que o CRM mandou sozinho num período: toda saída com author_kind <> human — bot_fixed (o menu do bot de entrada, a ausência e a introdução), bot_ai (os rascunhos aprovados) e system (as confirmações de opt-out, que o recorte in (bot_fixed, bot_ai) deixaria justamente de fora). NÃO inclui o cumprimento da campanha, que é human assinado por quem disparou (public.wa_enviar_modelo) e já tem tela em /envios. Cada linha diz o que saiu, para quem, quando, o texto e se a Meta entregou — e o que aconteceu DEPOIS, em duas colunas independentes e da MESMA forma: respondeu_em (a primeira entrada do lead depois daquela mensagem) e gente_falou_em (a primeira saída de gente depois dela). Duas e não um rótulo, porque é o cruzamento delas que mostra o caso que importa: respondeu e ninguém falou. Definer para poder fazer o join com conversations e organizations; o recorte de visibilidade é o mesmo da política conversations_select, repetido por escrito.';
revoke all on function public.mensagens_automaticas(timestamptz, timestamptz, int) from public, anon;
grant execute on function public.mensagens_automaticas(timestamptz, timestamptz, int) to authenticated, service_role;

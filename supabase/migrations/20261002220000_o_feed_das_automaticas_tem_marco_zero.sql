-- =====================================================================
-- O feed das Automáticas tem marco zero
--
-- Rafael, 29/09/2026: "limpe as mensagens automaticas da tela, as anteriores,
-- pois funcionava da maneira errada".
--
-- Ele tem razão sobre o que está lá: das oito linhas do feed, sete são de
-- 22 a 24/09 — o menu do bot de entrada e o aviso de fora do horário, do jeito
-- que ele recusou ("ta bem tosco e poluido"). Misturadas com o cumprimento que
-- começou a sair hoje, elas fazem o placar da tela responder a pergunta errada:
-- quem abre quer saber como está o processo de AGORA.
--
-- ===========================================================================
-- MAS NÃO SE APAGA MENSAGEM QUE FOI ENTREGUE
-- ===========================================================================
-- As sete saíram de verdade e estão no WhatsApp das pessoas — quatro com status
-- `read`. Apagar as linhas limparia a tela e faria a conversa do CRM MENTIR:
-- quem abrisse aquele fio para responder não veria o que a Komune disse, e
-- responderia por cima de um contexto que existe do outro lado. O fio é o
-- registro do que aconteceu, não a opinião de hoje sobre o que devia ter
-- acontecido. (E há o lado legal: `audit_log` e a retenção do PRD §10.6 valem
-- para mensagem enviada.)
--
-- Então o que muda é a JANELA do feed, não o histórico. Uma data de corte em
-- `app_settings`, que a função aplica como PISO — e a tela diz na cara que
-- começa ali, porque feed que esconde em silêncio é pior do que feed sujo:
-- o número vira mentira por omissão.
--
-- Mexer na data é de gestor, pela mesma porta de sempre (`app_settings`), e
-- pôr null devolve os sete.
--
-- RF-CON-05, RF-ADM-03
-- =====================================================================

insert into public.app_settings (key, value, description) values
  ('automaticas',
   jsonb_build_object('marco_zero', '2026-09-29T00:00:00-03:00'),
   'Feed de Conversas → Automáticas. `marco_zero` é a data a partir da qual ele conta: o que saiu antes continua no fio do parceiro, mas fora do placar. Rafael pediu em 29/09/2026, quando o menu do bot e o aviso de ausência de 22–24/09 dividiam a tela com o cumprimento automático que tinha acabado de começar. null volta a mostrar tudo.')
on conflict (key) do nothing;

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
  with marco as (
    select nullif(s.value ->> 'marco_zero', '')::timestamptz as em
      from public.app_settings s where s.key = 'automaticas'
  ),
  visiveis as (
    select m.id, m.conversation_id, m.created_at, m.author_kind, m.template_id,
           m.body, m.status, m.error_code, c.organization_id, c.assignee_id
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where m.direction = 'out'::app.msg_direction
       and m.author_kind <> 'human'
       -- O PISO. `greatest` com o marco: quem pedir sete dias e o marco for de
       -- ontem recebe um dia. Pedir MAIS que o marco continua valendo — a data
       -- só levanta o chão, não abaixa o teto.
       and m.created_at >= greatest(p_desde, coalesce((select em from marco), p_desde))
       and m.created_at <= p_ate
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
         (select min(i.created_at) from public.messages i
           where i.conversation_id = v.conversation_id
             and i.direction = 'in'::app.msg_direction
             and i.created_at > v.created_at),
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
  'O que o CRM mandou sozinho num período: toda saída com author_kind <> human — bot_fixed (o menu do bot de entrada, a ausência, a introdução e o cumprimento automático), bot_ai (os rascunhos aprovados) e system (as confirmações de opt-out). NÃO inclui o cumprimento das campanhas, que é human assinado por quem disparou e mora em /envios. Desde 29/09/2026 respeita app_settings.automaticas.marco_zero como PISO do período: o que saiu antes dele continua no fio do parceiro e sai do placar, porque a tela responde "como está o processo agora" — quem lê precisa ver a data na tela, e a tela a mostra. Definer para poder fazer o join com conversations e organizations; o recorte de visibilidade é o mesmo da política conversations_select, repetido por escrito.';

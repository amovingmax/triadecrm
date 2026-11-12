-- =====================================================================
-- O aviso por e-mail só quando as mensagens acumulam (11/11/2026)
-- =====================================================================
-- Pedido de 11/11/2026: "precisamos tirar os avisos de mensagem por email,
-- coloque aviso no email agora, quando tiver mais de 30 novas mensagens".
--
-- Até aqui o worker-wa mandava um e-mail a cada lote que chegava no WhatsApp
-- (20260916120000). Com o aviso no navegador e no celular, aquele e-mail virou
-- ruído. Agora ele só sai quando passam de 30 as mensagens NOVAS.
--
-- "NOVA" É A REGRA DA MARCA "Nova" E DO NÚMERO DO MENU: a mensagem chegou
-- depois da última resposta do time naquela conversa. Resposta do time é o que
-- `apps/web/src/components/avisos/dados.ts` já conta: saída do CRM, escrita por
-- gente ou pela IA que atende, que não é modelo e não falhou. O menu do robô e
-- o bom-dia não respondem ninguém. Não contam reação, mensagem que a pessoa
-- apagou nem conversa concluída (a concluída volta sozinha quando a pessoa
-- escreve de novo).
--
-- A CONTA RECOMEÇA A CADA AVISO: só entra o que chegou depois do último e-mail.
-- Sem isso, a fila antiga sem resposta deixaria a conta acima de 30 para sempre,
-- e o aviso ou sairia uma vez e nunca mais, ou sairia a cada lote. Assim, o time
-- que está em dia não recebe nada, e o segundo e-mail só sai quando acumulam
-- mais 31 sem resposta depois do primeiro. O que chegou antes desta migração
-- não conta (a linha de partida abaixo).
--
-- O limite é configuração: `notificacoes.email.mais_de_mensagens` (30). O resto
-- da chave continua valendo (ativo, de, para, responder_para, url_do_crm), e o
-- aviso de reunião (ADR-15), que usa a mesma chave, não muda.

-- ---------------------------------------------------------------------
-- 1 · Cada aviso mandado, e o ponto de onde o próximo começa a contar
-- ---------------------------------------------------------------------
create table if not exists public.avisos_de_acumulo (
  id          bigint generated always as identity primary key,
  enviado_em  timestamptz not null default now(),
  ate         timestamptz not null,
  mensagens   int not null check (mensagens >= 0),
  conversas   int not null check (conversas >= 0)
);
comment on table public.avisos_de_acumulo is
  'Avisos por e-mail de mensagens acumuladas no WhatsApp (11/11/2026). O próximo aviso conta só o que chegou depois do maior "ate". Escrita só pelo worker-wa, por public.aviso_de_acumulo_registrar.';
comment on column public.avisos_de_acumulo.ate is
  'A chegada mais recente que este aviso contou (carimbo do banco). O próximo aviso começa depois dela.';
comment on column public.avisos_de_acumulo.mensagens is
  'Quantas mensagens novas o aviso contou. Zero só na linha de partida, que marca o começo da conta.';

alter table public.avisos_de_acumulo enable row level security;

drop policy if exists avisos_de_acumulo_select on public.avisos_de_acumulo;
create policy avisos_de_acumulo_select on public.avisos_de_acumulo
  for select to authenticated using ((select app.is_manager()));

revoke insert, update, delete, truncate on public.avisos_de_acumulo from public, anon, authenticated;

-- A linha de partida: o que chegou antes desta migração já foi avisado pelo
-- e-mail antigo e não entra na primeira conta.
insert into public.avisos_de_acumulo (ate, mensagens, conversas)
select now(), 0, 0
 where not exists (select 1 from public.avisos_de_acumulo);

-- ---------------------------------------------------------------------
-- 2 · O limite na configuração
-- ---------------------------------------------------------------------
update public.app_settings
   set value = value || jsonb_build_object('mais_de_mensagens', 30),
       description = 'Aviso por e-mail (Resend): sai quando passam de "mais_de_mensagens" (30) as mensagens novas sem resposta do time no WhatsApp, contadas desde o último aviso; e o aviso de reunião marcada. Também: se está ligado, de quem sai, para quem vai, para onde se responde e o endereço do CRM que entra no link.',
       updated_at = now()
 where key = 'notificacoes.email'
   and not (value ? 'mais_de_mensagens');

comment on table public.app_settings is
  'Configuração viva do CRM, por chave. notificacoes.email: aviso por e-mail das mensagens acumuladas no WhatsApp e das reuniões (ativo, de, responder_para, para, url_do_crm, mais_de_mensagens).';

-- ---------------------------------------------------------------------
-- 3 · A conta
-- ---------------------------------------------------------------------
-- Devolve tudo o que o e-mail precisa, sem o telefone inteiro: do número só
-- saem os quatro últimos dígitos (RF-BAS-14), porque e-mail é caixa de gente,
-- fora da RLS. `mandar` é a decisão; o worker só obedece.
create or replace function public.aviso_de_acumulo_conferir()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with config as (
    select
      coalesce(
        (select case when (s.value ->> 'mais_de_mensagens') ~ '^[0-9]+$'
                     then (s.value ->> 'mais_de_mensagens')::int end
           from public.app_settings s
          where s.key = 'notificacoes.email'),
        30) as limite,
      coalesce((select max(a.ate) from public.avisos_de_acumulo a),
               '-infinity'::timestamptz) as desde
  ),
  novas as (
    select c.id as conversation_id, m.created_at, m.body
      from config k
      join public.conversations c
        on c.last_inbound_at > k.desde
       and c.arquivada_em is null
      cross join lateral (
        select max(r.created_at) as em
          from public.messages r
         where r.conversation_id = c.id
           and r.direction = 'out'::app.msg_direction
           and r.origin = 'crm'
           and r.author_kind in ('human', 'bot_ai')
           and r.type <> 'template'::app.msg_type
           and r.status <> 'failed'::app.msg_status
      ) resposta
      join public.messages m
        on m.conversation_id = c.id
       and m.direction = 'in'::app.msg_direction
       and m.created_at > k.desde
       and m.created_at > coalesce(resposta.em, '-infinity'::timestamptz)
       and m.reage_a is null
       and m.apagada_pelo_contato_em is null
  ),
  por_conversa as (
    select n.conversation_id,
           count(*)::int as mensagens,
           max(n.created_at) as chegou_em,
           (array_agg(n.body order by n.created_at desc))[1] as ultima
      from novas n
     group by n.conversation_id
  ),
  -- As dez conversas com mais mensagens esperando, para o e-mail dizer onde
  -- começar. O resto o time vê na tela Conversas.
  lista as (
    select p.mensagens, p.chegou_em,
           jsonb_build_object(
             'conversation_id', c.id,
             'organization_id', c.organization_id,
             'nome', coalesce(o.name, nullif(trim(c.peer_nome), '')),
             'final_do_numero',
               nullif(right(regexp_replace(coalesce(c.peer_phone_e164, ''), '\D', '', 'g'), 4), ''),
             'mensagens', p.mensagens,
             'ultima', p.ultima,
             'chegou_em', p.chegou_em) as linha
      from por_conversa p
      join public.conversations c on c.id = p.conversation_id
      left join public.organizations o on o.id = c.organization_id
     order by p.mensagens desc, p.chegou_em desc
     limit 10
  )
  select jsonb_build_object(
           'mandar', (select count(*) from novas) > k.limite,
           'limite', k.limite,
           'desde', case when k.desde = '-infinity'::timestamptz then null else k.desde end,
           'mensagens', (select count(*) from novas),
           'conversas', (select count(*) from por_conversa),
           'ate', (select max(n.created_at) from novas n),
           'lista', coalesce((select jsonb_agg(l.linha order by l.mensagens desc, l.chegou_em desc)
                                from lista l), '[]'::jsonb))
    from config k
$$;
comment on function public.aviso_de_acumulo_conferir() is
  'Mensagens novas do WhatsApp sem resposta do time, contadas desde o último aviso por e-mail (11/11/2026). "mandar" é verdadeiro quando passam de notificacoes.email.mais_de_mensagens (30). Só o worker-wa, com a chave de serviço.';

-- ---------------------------------------------------------------------
-- 4 · O registro do aviso mandado
-- ---------------------------------------------------------------------
-- Só depois que o Resend aceitou: se o e-mail falha, a conta não anda e a
-- próxima conferência tenta de novo. O "ate" nunca volta para trás.
create or replace function public.aviso_de_acumulo_registrar(
  p_ate timestamptz, p_mensagens int, p_conversas int
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ate is null then
    raise exception 'O aviso precisa do "ate": a chegada mais recente que ele contou.'
      using errcode = '22004';
  end if;
  insert into public.avisos_de_acumulo (ate, mensagens, conversas)
  select greatest(p_ate, coalesce(max(a.ate), p_ate)), coalesce(p_mensagens, 0), coalesce(p_conversas, 0)
    from public.avisos_de_acumulo a;
end $$;
comment on function public.aviso_de_acumulo_registrar(timestamptz, int, int) is
  'Registra o aviso por e-mail de mensagens acumuladas que o Resend aceitou (11/11/2026). O próximo aviso conta só o que chegou depois de p_ate. Só o worker-wa, com a chave de serviço.';

revoke all on function public.aviso_de_acumulo_conferir() from public, anon, authenticated;
revoke all on function public.aviso_de_acumulo_registrar(timestamptz, int, int) from public, anon, authenticated;
grant execute on function public.aviso_de_acumulo_conferir() to service_role;
grant execute on function public.aviso_de_acumulo_registrar(timestamptz, int, int) to service_role;

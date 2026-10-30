-- ===========================================================================
-- TRÍADE — a ligação pelo WhatsApp (Calling API da Meta), só na Imova
--
-- Pedido de 29 e 30/10/2026: receber e fazer ligações pelo número de WhatsApp
-- da empresa, de dentro do CRM. Hoje no navegador; o app entra depois, com o
-- mesmo banco. Guia e regras da Meta em `docs/operacao/ligacao-whatsapp.md`.
--
-- É OUTRO CAMINHO, ao lado da Twilio. Nada aqui toca em `voice_calls`, nas
-- funções `voz_*` nem no módulo de ligação: quem liga pela Twilio continua
-- exatamente como estava.
--
--   1. `app_settings['whatsapp.ligacao']` e `app.wa_ligacao_ligada()`: a chave.
--      Nasce desligada, e fora do banco da Imova fica desligada mesmo com a
--      chave gravada à força.
--   2. `public.wa_chamadas`: uma ligação, recebida ou feita. A Meta manda o SDP
--      da chamada no webhook e o navegador o lê daqui, por isso a tabela está no
--      Realtime; o SDP é apagado quando a ligação acaba.
--   3. `public.wa_permissoes_de_ligar`: o que o cliente decidiu. Só ele concede
--      e tira (regra da Meta); o banco guarda o último fato que chegou.
--   4. As portas de quem usa o CRM: `wa_ligacao_estado`, `wa_permissao_pedir`,
--      `wa_chamada_abrir`, `wa_chamada_atender`, `wa_chamada_soltar` e
--      `wa_chamada_autorizar`.
--   5. As portas do serviço (Edge Functions `wa-webhook` e `wa-chamada`):
--      `wa_chamada_eventos`, `wa_chamada_para_meta` e `wa_chamada_marcar`.
--
-- O TELEFONE NÃO SAI DAQUI PARA A TELA. O SDR vê o número mascarado, então as
-- portas de quem usa o CRM nunca devolvem o E.164: só `wa_chamada_para_meta`,
-- que é do serviço, o entrega à Edge Function que fala com a Meta.
--
-- Fica para depois, e o guia diz o que falta: pedir permissão fora das 24 h
-- (exige modelo aprovado pela Meta) e entrar no relatório do dia por pessoa.
--
-- Para desfazer:
--   select cron.unschedule('wa_chamadas_fechar_orfas');
--   drop table public.wa_chamadas; drop table public.wa_permissoes_de_ligar;
--   drop function das seções abaixo; delete from public.app_settings
--    where key = 'whatsapp.ligacao';
-- Nenhuma tabela existente é alterada, então desfazer não perde dado anterior.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A chave
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, description)
values ('whatsapp.ligacao', '{"ativa": false}'::jsonb,
        'Ligação pelo WhatsApp (Calling API da Meta). Só vale no banco da Imova. Ligar aqui não ativa nada na Meta: as chamadas são ativadas no número, à parte.')
on conflict (key) do nothing;

create or replace function app.wa_ligacao_ligada()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value ->> 'ativa')::boolean
                     from public.app_settings s where s.key = 'whatsapp.ligacao'), false)
     and coalesce((select i.empresa = 'imova' from app.identidade i), false)
$$;
comment on function app.wa_ligacao_ligada() is
  'A ligação pelo WhatsApp está ligada? Só no banco da Imova (app.identidade): na KOMUNE é sempre false.';
revoke all on function app.wa_ligacao_ligada() from public, anon;

-- ---------------------------------------------------------------------------
-- 2. A ligação
-- ---------------------------------------------------------------------------
create table if not exists public.wa_chamadas (
  id              uuid primary key default gen_random_uuid(),
  -- `wacid...`. Nulo só no instante entre abrir a ligação feita e a Meta responder.
  meta_call_id    text,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direcao         text not null check (direcao in ('recebida', 'feita')),
  -- recebida: tocando → atendendo → em_curso → encerrada, ou perdida.
  -- feita:    discando → tocando → em_curso → encerrada, ou recusada/perdida.
  estado          text not null check (estado in ('discando', 'tocando', 'atendendo', 'em_curso',
                                                  'encerrada', 'perdida', 'recusada', 'falhou')),
  -- O nome para a tela que toca, nunca o número inteiro.
  quem            text not null,
  oferta_sdp      text,
  resposta_sdp    text,
  feita_por       uuid references public.profiles (id) on delete set null,
  atendida_por    uuid references public.profiles (id) on delete set null,
  tocou_em        timestamptz not null default now(),
  atendida_em     timestamptz,
  encerrada_em    timestamptz,
  duracao_seg     int check (duracao_seg is null or duracao_seg >= 0),
  erro            jsonb
);
comment on table public.wa_chamadas is
  'Ligações pelo WhatsApp (Calling API). Separadas de voice_calls, que é a Twilio. Sem gravação de voz.';

create unique index if not exists wa_chamadas_meta_call_id
  on public.wa_chamadas (meta_call_id) where meta_call_id is not null;
create index if not exists wa_chamadas_da_conversa
  on public.wa_chamadas (conversation_id, tocou_em desc);
-- Uma ligação por pessoa de cada vez: índice, e não `if`, porque são duas abas
-- ou dois aparelhos correndo ao mesmo tempo.
create unique index if not exists wa_chamadas_uma_por_pessoa
  on public.wa_chamadas ((coalesce(atendida_por, feita_por)))
  where estado in ('discando', 'tocando', 'atendendo', 'em_curso')
    and coalesce(atendida_por, feita_por) is not null;

alter table public.wa_chamadas enable row level security;
drop policy if exists wa_chamadas_select on public.wa_chamadas;
-- Toca para todos da empresa (decisão de 29/10/2026), então todos os que escrevem
-- no CRM leem a ligação, tenham ou não a conversa em seu nome.
create policy wa_chamadas_select on public.wa_chamadas
  for select to authenticated using ((select app.can_write()));
revoke all on public.wa_chamadas from anon, authenticated;
grant select on public.wa_chamadas to authenticated;
grant select, insert, update, delete on public.wa_chamadas to service_role;

-- ---------------------------------------------------------------------------
-- 3. O que o cliente decidiu
-- ---------------------------------------------------------------------------
create table if not exists public.wa_permissoes_de_ligar (
  conversation_id        uuid primary key references public.conversations (id) on delete cascade,
  estado                 text not null default 'sem_permissao'
                           check (estado in ('sem_permissao', 'pedida', 'aceita', 'recusada')),
  permanente             boolean not null default false,
  expira_em              timestamptz,
  pedida_em              timestamptz,
  respondida_em          timestamptz,
  -- 'pedido': respondeu ao nosso pedido. 'automatica': a Meta decidiu, ou porque
  -- o cliente ligou (retorno) ou porque 4 ligações seguidas ficaram sem resposta.
  origem                 text check (origem is null or origem in ('pedido', 'automatica')),
  nao_atendidas_seguidas int not null default 0 check (nao_atendidas_seguidas >= 0),
  atualizada_em          timestamptz not null default now()
);
comment on table public.wa_permissoes_de_ligar is
  'A permissão do cliente para a empresa ligar pelo WhatsApp. Só o cliente concede e tira; a Meta manda o fato pelo webhook.';

alter table public.wa_permissoes_de_ligar enable row level security;
drop policy if exists wa_permissoes_de_ligar_select on public.wa_permissoes_de_ligar;
create policy wa_permissoes_de_ligar_select on public.wa_permissoes_de_ligar
  for select to authenticated using ((select app.can_write()));
revoke all on public.wa_permissoes_de_ligar from anon, authenticated;
grant select on public.wa_permissoes_de_ligar to authenticated;
grant select, insert, update, delete on public.wa_permissoes_de_ligar to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and tablename = 'wa_chamadas') then
      alter publication supabase_realtime add table public.wa_chamadas;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and tablename = 'wa_permissoes_de_ligar') then
      alter publication supabase_realtime add table public.wa_permissoes_de_ligar;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Peças internas
-- ---------------------------------------------------------------------------

-- O nome que a tela mostra enquanto toca: a ficha, depois o perfil do WhatsApp,
-- e por último o fim do número.
create or replace function app.wa_chamada_nome(p_conversation_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(o.name), ''),
                  nullif(btrim(c.peer_nome), ''),
                  'WhatsApp final ' || right(c.peer_phone_e164, 4))
    from public.conversations c
    left join public.organizations o on o.id = c.organization_id and o.deleted_at is null
   where c.id = p_conversation_id
$$;
revoke all on function app.wa_chamada_nome(uuid) from public, anon, authenticated;

-- A permissão como ela vale agora: a Meta não avisa quando a temporária vence.
create or replace function app.wa_permissao_efetiva(p public.wa_permissoes_de_ligar)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when p.conversation_id is null then 'sem_permissao'
           when p.estado = 'aceita' and (p.permanente or p.expira_em > now()) then 'aceita'
           when p.estado = 'aceita' then 'venceu'
           when p.estado = 'pedida' and p.pedida_em > now() - interval '7 days' then 'pedida'
           when p.estado = 'recusada' then 'recusada'
           else 'sem_permissao'
         end
$$;
revoke all on function app.wa_permissao_efetiva(public.wa_permissoes_de_ligar) from public, anon, authenticated;

-- Os limites da Meta para pedir permissão: 1 em 24 h e 2 em 7 dias. Uma ligação
-- completada entre os dois zera a conta. Devolve quando se pode pedir de novo, ou
-- null se já pode. O pedido é a própria mensagem na fila, então não há outra lista.
create or replace function app.wa_permissao_proximo_pedido(p_conversation_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_desde   timestamptz;
  v_ultimo  timestamptz;
  v_segundo timestamptz;
  v_prox    timestamptz;
begin
  select max(ch.atendida_em) into v_desde
    from public.wa_chamadas ch
   where ch.conversation_id = p_conversation_id and ch.atendida_em is not null;

  select max(m.created_at) into v_ultimo
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'out'::app.msg_direction
     and m.type = 'interactive'::app.msg_type
     and m.template_params ->> 'permissao_de_ligar' = 'true'
     and m.status <> 'failed'::app.msg_status
     and m.created_at > greatest(now() - interval '7 days', coalesce(v_desde, '-infinity'));
  if v_ultimo is null then
    return null;
  end if;

  select m.created_at into v_segundo
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'out'::app.msg_direction
     and m.type = 'interactive'::app.msg_type
     and m.template_params ->> 'permissao_de_ligar' = 'true'
     and m.status <> 'failed'::app.msg_status
     and m.created_at > greatest(now() - interval '7 days', coalesce(v_desde, '-infinity'))
   order by m.created_at desc
   offset 1 limit 1;

  v_prox := v_ultimo + interval '24 hours';
  if v_segundo is not null then
    v_prox := greatest(v_prox, v_segundo + interval '7 days');
  end if;
  return case when v_prox > now() then v_prox end;
end $$;
revoke all on function app.wa_permissao_proximo_pedido(uuid) from public, anon, authenticated;

-- A conversa de quem ligou, ou de quem respondeu ao pedido. Ela é aberta do mesmo
-- jeito que `app.wa_registrar_entrada` abre, mas sem mensagem: uma ligação não abre
-- a janela de 24 h nem marca "Nova".
create or replace function app.wa_chamada_conversa(p_numero     text,
                                                   p_peer       text,
                                                   p_peer_user  text,
                                                   p_nome       text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_num   text := coalesce(app.normalize_phone_br(p_numero), p_numero);
  v_peer  text := nullif(trim(coalesce(app.normalize_phone_br(p_peer), p_peer, '')), '');
  v_bsuid text := nullif(trim(coalesce(p_peer_user, '')), '');
  v_nome  text := nullif(btrim(coalesce(p_nome, '')), '');
  v_conv  uuid;
  v_org   uuid;
  v_ct    uuid;
begin
  if v_peer is null then
    if v_bsuid is null then
      return null;
    end if;
    select c.id into v_conv from public.conversations c
     where c.channel = 'whatsapp'::app.channel
       and c.business_number = v_num and c.peer_user_id = v_bsuid
     order by c.last_message_at desc nulls last, c.created_at desc
     limit 1;
    -- Sem telefone ninguém abre fio: nem aqui, nem na mensagem.
    return v_conv;
  end if;

  select c.id into v_conv from public.conversations c
   where c.channel = 'whatsapp'::app.channel
     and c.business_number = v_num and c.peer_phone_e164 = v_peer;
  if v_conv is not null then
    return v_conv;
  end if;

  select o.id into v_org from public.organizations o
   where o.phone_e164 = v_peer and o.deleted_at is null limit 1;
  select ct.id into v_ct from public.contacts ct
   where ct.phone_e164 = v_peer and ct.deleted_at is null limit 1;
  if v_org is null and v_ct is not null then
    select oc.organization_id into v_org from public.organization_contacts oc
     where oc.contact_id = v_ct limit 1;
  end if;

  insert into public.conversations (channel, business_number, peer_phone_e164, peer_user_id,
                                    peer_nome, organization_id, contact_id, status)
  values ('whatsapp'::app.channel, v_num, v_peer, v_bsuid, v_nome, v_org, v_ct, 'aguardando_nos')
  on conflict (channel, business_number, peer_phone_e164) do update
    set peer_nome = coalesce(public.conversations.peer_nome, excluded.peer_nome)
  returning id into v_conv;
  return v_conv;
end $$;
revoke all on function app.wa_chamada_conversa(text, text, text, text) from public, anon, authenticated;

-- Fim de ligação: apaga o SDP, lança na linha do tempo da ficha e conta as sem
-- resposta. Só chamada na transição para um estado final.
create or replace function app.wa_chamada_ao_terminar(p_chamada public.wa_chamadas)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = p_chamada.conversation_id;

  if p_chamada.direcao = 'feita' then
    if p_chamada.estado = 'encerrada' then
      update public.wa_permissoes_de_ligar
         set nao_atendidas_seguidas = 0, atualizada_em = now()
       where conversation_id = p_chamada.conversation_id;
    elsif p_chamada.estado in ('perdida', 'recusada') then
      update public.wa_permissoes_de_ligar
         set nao_atendidas_seguidas = nao_atendidas_seguidas + 1, atualizada_em = now()
       where conversation_id = p_chamada.conversation_id;
    end if;
  end if;

  if c.organization_id is not null and p_chamada.estado <> 'falhou' then
    insert into public.activities (type, organization_id, contact_id, user_id, author_kind,
                                   occurred_at, duration_min, channel, body, metadata)
    values (case when p_chamada.estado = 'encerrada' then 'call'::app.activity_type
                 else 'system'::app.activity_type end,
            c.organization_id, c.contact_id,
            coalesce(p_chamada.atendida_por, p_chamada.feita_por, c.assignee_id),
            case when p_chamada.estado = 'encerrada' then 'human' else 'system' end,
            p_chamada.tocou_em,
            nullif(round(coalesce(p_chamada.duracao_seg, 0) / 60.0)::int, 0),
            'whatsapp'::app.channel,
            case p_chamada.estado
              when 'encerrada' then null
              when 'recusada' then 'Ligação pelo WhatsApp recusada pelo cliente.'
              when 'perdida' then case when p_chamada.direcao = 'recebida'
                                       then 'Ligação pelo WhatsApp perdida: o cliente ligou e ninguém atendeu.'
                                       else 'Ligação pelo WhatsApp sem resposta do cliente.' end
            end,
            jsonb_build_object('wa_chamada_id', p_chamada.id, 'direcao', p_chamada.direcao,
                               'estado', p_chamada.estado, 'duracao_seg', p_chamada.duracao_seg));
  end if;
end $$;
revoke all on function app.wa_chamada_ao_terminar(public.wa_chamadas) from public, anon, authenticated;

-- A rede cai, o aviso da Meta não chega e a ligação ficaria "em curso" para sempre,
-- prendendo a pessoa pelo índice de uma ligação por vez.
create or replace function app.wa_chamadas_fechar_orfas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       public.wa_chamadas%rowtype;
  v_feitas int := 0;
begin
  for r in
    update public.wa_chamadas
       set estado = case when direcao = 'recebida' and estado in ('tocando', 'atendendo')
                         then 'perdida' else 'falhou' end,
           encerrada_em = now(),
           oferta_sdp = null,
           resposta_sdp = null,
           erro = coalesce(erro, '{"motivo": "sem_aviso_da_meta"}'::jsonb)
     where (estado in ('discando', 'tocando', 'atendendo') and tocou_em < now() - interval '3 minutes')
        or (estado = 'em_curso' and atendida_em < now() - interval '8 hours')
    returning *
  loop
    perform app.wa_chamada_ao_terminar(r);
    v_feitas := v_feitas + 1;
  end loop;
  return v_feitas;
end $$;
comment on function app.wa_chamadas_fechar_orfas() is
  'Fecha a ligação de que a Meta não avisou o fim. Roda pelo pg_cron e antes de abrir ou atender outra.';
revoke all on function app.wa_chamadas_fechar_orfas() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. As portas de quem usa o CRM
-- ---------------------------------------------------------------------------

-- Tudo o que a conversa precisa para decidir o botão. A regra da tela (`logica.ts`)
-- lê isto; quem barra de verdade são as funções abaixo.
create or replace function public.wa_ligacao_estado(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c       public.conversations%rowtype;
  p       public.wa_permissoes_de_ligar%rowtype;
  v_ult   public.wa_chamadas%rowtype;
  v_viva  uuid;
begin
  if not app.wa_ligacao_ligada() or not app.can_write() then
    return jsonb_build_object('ligada', false);
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.channel <> 'whatsapp'::app.channel then
    return jsonb_build_object('ligada', false);
  end if;

  select * into p from public.wa_permissoes_de_ligar where conversation_id = p_conversation_id;
  select * into v_ult from public.wa_chamadas
   where conversation_id = p_conversation_id
   order by tocou_em desc limit 1;
  select ch.id into v_viva from public.wa_chamadas ch
   where ch.conversation_id = p_conversation_id
     and ch.estado in ('discando', 'tocando', 'atendendo', 'em_curso')
   limit 1;

  return jsonb_build_object(
    'ligada', true,
    'permissao', app.wa_permissao_efetiva(p),
    'permanente', coalesce(p.permanente, false),
    'expira_em', p.expira_em,
    'nao_atendidas_seguidas', coalesce(p.nao_atendidas_seguidas, 0),
    'proximo_pedido_em', app.wa_permissao_proximo_pedido(p_conversation_id),
    'janela_aberta', coalesce(c.window_expires_at > now(), false),
    'suprimida', app.is_suppressed(c.peer_phone_e164)
                 or (c.organization_id is not null
                     and app.is_suppressed_target(c.organization_id, c.contact_id)),
    'horario', app.call_window(now()),
    'ligacao_viva', v_viva,
    'ultima', case when v_ult.id is null then null else jsonb_build_object(
                'direcao', v_ult.direcao,
                'estado', v_ult.estado,
                'tocou_em', v_ult.tocou_em,
                'duracao_seg', v_ult.duracao_seg,
                'por', (select pr.full_name from public.profiles pr
                         where pr.id = coalesce(v_ult.atendida_por, v_ult.feita_por))) end
  );
end $$;
comment on function public.wa_ligacao_estado(uuid) is
  'O estado da ligação pelo WhatsApp numa conversa: chave, permissão como vale agora, limites, janela, supressão, horário e última ligação. Nunca devolve o telefone.';
revoke all on function public.wa_ligacao_estado(uuid) from public, anon;
grant execute on function public.wa_ligacao_estado(uuid) to authenticated;

-- O pedido é uma mensagem como outra qualquer: vai para a fila e passa pela porteira
-- de `messages` (supressão, janela, teto). Dentro das 24 h, sem modelo. Só o texto é
-- nosso: o botão e as opções são do WhatsApp.
create or replace function public.wa_permissao_pedir(p_conversation_id uuid, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c       public.conversations%rowtype;
  p       public.wa_permissoes_de_ligar%rowtype;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
  v_prox  timestamptz;
  v_msg   uuid;
begin
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not app.wa_ligacao_ligada() then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_desligada');
  end if;
  if v_texto is null or length(v_texto) > 1024 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_invalido');
  end if;

  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.channel <> 'whatsapp'::app.channel then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_desconhecida');
  end if;
  if app.is_suppressed(c.peer_phone_e164)
     or (c.organization_id is not null and app.is_suppressed_target(c.organization_id, c.contact_id)) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido');
  end if;
  if not coalesce(c.window_expires_at > now(), false) then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_janela');
  end if;

  select * into p from public.wa_permissoes_de_ligar where conversation_id = p_conversation_id;
  if app.wa_permissao_efetiva(p) = 'aceita' and p.permanente then
    return jsonb_build_object('ok', false, 'motivo', 'ja_permitida');
  end if;

  v_prox := app.wa_permissao_proximo_pedido(p_conversation_id);
  if v_prox is not null then
    return jsonb_build_object('ok', false, 'motivo', 'limite_de_pedidos', 'proximo_em', v_prox);
  end if;

  insert into public.messages (conversation_id, direction, type, status, body, template_params,
                               author_kind, sent_by, origin)
  values (p_conversation_id, 'out'::app.msg_direction, 'interactive'::app.msg_type,
          'queued'::app.msg_status, v_texto, '{"permissao_de_ligar": true}'::jsonb,
          'human', auth.uid(), 'crm')
  returning id into v_msg;

  insert into public.wa_permissoes_de_ligar as w (conversation_id, estado, pedida_em)
  values (p_conversation_id, 'pedida', now())
  on conflict (conversation_id) do update
    set pedida_em = now(),
        -- Pedir de novo com a temporária ainda valendo não tira o que ele já deu.
        estado = case when app.wa_permissao_efetiva(w) = 'aceita' then w.estado else 'pedida' end,
        atualizada_em = now();

  return jsonb_build_object('ok', true, 'message_id', v_msg);
end $$;
comment on function public.wa_permissao_pedir(uuid, text) is
  'Pede ao cliente permissão para ligar pelo WhatsApp (RF-CON-18, RF-CON-11): vai pela fila, dentro das 24 h, respeitando os limites da Meta (1 por dia, 2 por semana).';
revoke all on function public.wa_permissao_pedir(uuid, text) from public, anon;
grant execute on function public.wa_permissao_pedir(uuid, text) to authenticated;

-- A porta de quem liga. As mesmas travas da ligação pela Twilio (papel que escreve,
-- horário de ligar, supressão, uma por pessoa), mais a da Meta: a permissão.
create or replace function public.wa_chamada_abrir(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c       public.conversations%rowtype;
  p       public.wa_permissoes_de_ligar%rowtype;
  v_id    uuid;
begin
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not app.wa_ligacao_ligada() then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_desligada');
  end if;
  perform app.wa_chamadas_fechar_orfas();

  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.channel <> 'whatsapp'::app.channel then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_desconhecida');
  end if;
  if app.is_suppressed(c.peer_phone_e164)
     or (c.organization_id is not null and app.is_suppressed_target(c.organization_id, c.contact_id)) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido');
  end if;
  if not (app.call_window(now()) ->> 'aberta')::boolean then
    return jsonb_build_object('ok', false, 'motivo', 'fora_do_horario');
  end if;
  select * into p from public.wa_permissoes_de_ligar where conversation_id = p_conversation_id;
  if app.wa_permissao_efetiva(p) <> 'aceita' then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao_do_cliente');
  end if;
  if exists (select 1 from public.wa_chamadas ch
              where ch.conversation_id = p_conversation_id
                and ch.estado in ('discando', 'tocando', 'atendendo', 'em_curso')) then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_em_curso');
  end if;

  begin
    insert into public.wa_chamadas (conversation_id, direcao, estado, quem, feita_por)
    values (p_conversation_id, 'feita', 'discando', app.wa_chamada_nome(p_conversation_id), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'motivo', 'voce_ja_esta_em_ligacao');
  end;
  return jsonb_build_object('ok', true, 'chamada_id', v_id);
end $$;
comment on function public.wa_chamada_abrir(uuid) is
  'Abre uma ligação feita pelo WhatsApp. Papel, horário, supressão, permissão do cliente e uma ligação por pessoa valem aqui. A Edge Function wa-chamada é quem fala com a Meta.';
revoke all on function public.wa_chamada_abrir(uuid) from public, anon;
grant execute on function public.wa_chamada_abrir(uuid) to authenticated;

-- O primeiro que atender leva: o `update` só pega a linha que ainda está tocando.
create or replace function public.wa_chamada_atender(p_chamada_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oferta text;
begin
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not app.wa_ligacao_ligada() then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_desligada');
  end if;
  begin
    update public.wa_chamadas
       set estado = 'atendendo', atendida_por = auth.uid()
     where id = p_chamada_id and direcao = 'recebida' and estado = 'tocando'
    returning oferta_sdp into v_oferta;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'motivo', 'voce_ja_esta_em_ligacao');
  end;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ja_atendida');
  end if;
  return jsonb_build_object('ok', true, 'oferta_sdp', v_oferta);
end $$;
comment on function public.wa_chamada_atender(uuid) is
  'Reserva a ligação recebida para quem clicou em Atender. Quem chega depois recebe ja_atendida, e os outros aparelhos param de tocar pelo Realtime.';
revoke all on function public.wa_chamada_atender(uuid) from public, anon;
grant execute on function public.wa_chamada_atender(uuid) to authenticated;

-- Clicou em Atender e o microfone foi negado: volta a tocar para os outros.
create or replace function public.wa_chamada_soltar(p_chamada_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.wa_chamadas
     set estado = 'tocando', atendida_por = null
   where id = p_chamada_id and estado = 'atendendo' and atendida_por = auth.uid();
  return jsonb_build_object('ok', found);
end $$;
revoke all on function public.wa_chamada_soltar(uuid) from public, anon;
grant execute on function public.wa_chamada_soltar(uuid) to authenticated;

-- A Edge Function repassa o JWT e pergunta se esta pessoa pode fazer esta ação nesta
-- ligação. O número e o token ficam com o serviço.
create or replace function public.wa_chamada_autorizar(p_chamada_id uuid, p_acao text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ch public.wa_chamadas%rowtype;
begin
  if not app.can_write() or not app.wa_ligacao_ligada() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into ch from public.wa_chamadas where id = p_chamada_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_desconhecida');
  end if;
  if p_acao = 'atender' and ch.estado = 'atendendo' and ch.atendida_por = auth.uid() then
    return jsonb_build_object('ok', true);
  elsif p_acao = 'ligar' and ch.estado = 'discando' and ch.feita_por = auth.uid() then
    return jsonb_build_object('ok', true);
  elsif p_acao = 'encerrar'
        and ch.estado in ('discando', 'tocando', 'atendendo', 'em_curso')
        and (coalesce(ch.atendida_por, ch.feita_por) = auth.uid() or app.admin_ou_gestor()) then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'motivo', 'acao_nao_permitida');
end $$;
revoke all on function public.wa_chamada_autorizar(uuid, text) from public, anon;
grant execute on function public.wa_chamada_autorizar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. As portas do serviço
-- ---------------------------------------------------------------------------
create or replace function public.wa_chamada_para_meta(p_chamada_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('meta_call_id', ch.meta_call_id, 'para', c.peer_phone_e164,
                            'direcao', ch.direcao, 'estado', ch.estado)
    from public.wa_chamadas ch
    join public.conversations c on c.id = ch.conversation_id
   where ch.id = p_chamada_id
$$;
comment on function public.wa_chamada_para_meta(uuid) is
  'O número do cliente, só para o serviço: nenhuma porta de quem usa o CRM o devolve, porque o SDR vê o número mascarado.';
revoke all on function public.wa_chamada_para_meta(uuid) from public, anon, authenticated;
grant execute on function public.wa_chamada_para_meta(uuid) to service_role;

-- O que a Edge Function soube ao falar com a Meta. O estado só anda para frente.
create or replace function public.wa_chamada_marcar(p_chamada_id uuid, p_evento text, p_dados jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch public.wa_chamadas%rowtype;
begin
  if p_evento = 'meta_id' then
    -- O aviso da Meta pode ter chegado antes, pelo id nosso que vai junto.
    update public.wa_chamadas
       set meta_call_id = coalesce(meta_call_id, p_dados ->> 'meta_call_id')
     where id = p_chamada_id;
  elsif p_evento = 'aceita' then
    update public.wa_chamadas
       set estado = 'em_curso', atendida_em = coalesce(atendida_em, now())
     where id = p_chamada_id and estado = 'atendendo';
  elsif p_evento = 'falhou' then
    update public.wa_chamadas
       set estado = 'falhou', encerrada_em = now(), oferta_sdp = null, resposta_sdp = null,
           erro = p_dados
     where id = p_chamada_id
       and estado in ('discando', 'tocando', 'atendendo', 'em_curso')
    returning * into ch;
    if found then
      perform app.wa_chamada_ao_terminar(ch);
    end if;
  else
    raise exception 'Evento desconhecido: %', p_evento using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.wa_chamada_marcar(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.wa_chamada_marcar(uuid, text, jsonb) to service_role;

-- O webhook. Não passa pela fila `wa_inbound`, de propósito: o cliente está ouvindo
-- chamar, e a Meta dá de 30 a 60 s para atender. Daqui o Realtime leva direto à tela.
-- A reentrega da Meta não muda nada: a chave é o `meta_call_id` e o fim só acontece
-- uma vez (`encerrada_em is null`).
create or replace function public.wa_chamada_eventos(p_eventos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e        jsonb;
  ch       public.wa_chamadas%rowtype;
  v_conv   uuid;
  v_tipo   text;
  v_opaco  uuid;
  v_final  text;
  v_feitos int := 0;
  v_fora   int := 0;
  v_ligada boolean := app.wa_ligacao_ligada();
begin
  for e in select * from jsonb_array_elements(coalesce(p_eventos, '[]'::jsonb)) loop
    v_tipo := e ->> 'tipo';

    -- ---- o cliente respondeu ao pedido, ou a Meta decidiu por ele -------------
    if v_tipo = 'permissao' then
      v_conv := app.wa_chamada_conversa(e ->> 'numero_da_empresa', e ->> 'de', e ->> 'de_user_id', e ->> 'nome');
      if v_conv is null then
        v_fora := v_fora + 1;
        continue;
      end if;
      insert into public.wa_permissoes_de_ligar as w
        (conversation_id, estado, permanente, expira_em, respondida_em, origem)
      values (v_conv,
              case when e ->> 'resposta' = 'accept' then 'aceita' else 'recusada' end,
              e ->> 'resposta' = 'accept' and coalesce((e ->> 'permanente')::boolean, false),
              case when e ->> 'resposta' = 'accept' then (e ->> 'expira_em')::timestamptz end,
              coalesce((e ->> 'ocorrido_em')::timestamptz, now()),
              case when e ->> 'origem' = 'automatic' then 'automatica' else 'pedido' end)
      on conflict (conversation_id) do update
        set estado = excluded.estado,
            permanente = excluded.permanente,
            expira_em = excluded.expira_em,
            respondida_em = excluded.respondida_em,
            origem = excluded.origem,
            nao_atendidas_seguidas = case when excluded.estado = 'aceita' then 0
                                          else w.nao_atendidas_seguidas end,
            atualizada_em = now();
      v_feitos := v_feitos + 1;
      continue;
    end if;

    -- A ligação de que este evento fala: pelo id nosso, que a ligação feita leva até a
    -- Meta, ou pelo id da Meta.
    v_opaco := case when e ->> 'opaco' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then (e ->> 'opaco')::uuid end;
    ch := null;
    if v_opaco is not null then
      select * into ch from public.wa_chamadas where id = v_opaco;
    end if;
    if ch.id is null then
      select * into ch from public.wa_chamadas where meta_call_id = e ->> 'meta_call_id';
    end if;

    -- ---- andamento da ligação feita ------------------------------------------
    if v_tipo = 'chamada_status' then
      if ch.id is null then
        v_fora := v_fora + 1;
        continue;
      end if;
      if e ->> 'status' = 'RINGING' then
        update public.wa_chamadas
           set estado = 'tocando', meta_call_id = coalesce(meta_call_id, e ->> 'meta_call_id')
         where id = ch.id and estado = 'discando';
      elsif e ->> 'status' = 'ACCEPTED' then
        update public.wa_chamadas
           set estado = 'em_curso', atendida_em = coalesce(atendida_em, now()),
               meta_call_id = coalesce(meta_call_id, e ->> 'meta_call_id')
         where id = ch.id and estado in ('discando', 'tocando');
      elsif e ->> 'status' = 'REJECTED' then
        update public.wa_chamadas
           set estado = 'recusada', encerrada_em = now(), oferta_sdp = null, resposta_sdp = null
         where id = ch.id and encerrada_em is null
        returning * into ch;
        if found then
          perform app.wa_chamada_ao_terminar(ch);
        end if;
      end if;
      v_feitos := v_feitos + 1;
      continue;
    end if;

    if v_tipo <> 'chamada' then
      v_fora := v_fora + 1;
      continue;
    end if;

    -- ---- o começo: o cliente ligou, ou a Meta devolveu a resposta -------------
    if e ->> 'evento' = 'connect' then
      if e ->> 'sdp_tipo' = 'answer' then
        if ch.id is not null then
          update public.wa_chamadas
             set resposta_sdp = e ->> 'sdp',
                 meta_call_id = coalesce(meta_call_id, e ->> 'meta_call_id')
           where id = ch.id and encerrada_em is null;
          v_feitos := v_feitos + 1;
        else
          v_fora := v_fora + 1;
        end if;
        continue;
      end if;

      if ch.id is not null then
        continue;   -- reentrega
      end if;
      v_conv := app.wa_chamada_conversa(e ->> 'numero_da_empresa', e ->> 'de', e ->> 'de_user_id', e ->> 'nome');
      if v_conv is null then
        v_fora := v_fora + 1;
        continue;
      end if;
      -- Chave desligada: a ligação fica registrada como perdida, e não toca para ninguém.
      insert into public.wa_chamadas (meta_call_id, conversation_id, direcao, estado, quem,
                                      oferta_sdp, encerrada_em)
      values (e ->> 'meta_call_id', v_conv, 'recebida',
              case when v_ligada then 'tocando' else 'perdida' end,
              app.wa_chamada_nome(v_conv),
              case when v_ligada then e ->> 'sdp' end,
              case when v_ligada then null else now() end)
      on conflict (meta_call_id) where meta_call_id is not null do nothing;
      v_feitos := v_feitos + 1;
      continue;
    end if;

    -- ---- o fim ----------------------------------------------------------------
    if e ->> 'evento' = 'terminate' then
      if ch.id is null then
        -- O começo se perdeu. Só a ligação que o cliente fez merece linha nova.
        if coalesce(e ->> 'direcao', 'USER_INITIATED') <> 'USER_INITIATED' then
          v_fora := v_fora + 1;
          continue;
        end if;
        v_conv := app.wa_chamada_conversa(e ->> 'numero_da_empresa', e ->> 'de', e ->> 'de_user_id', e ->> 'nome');
        if v_conv is null then
          v_fora := v_fora + 1;
          continue;
        end if;
        insert into public.wa_chamadas (meta_call_id, conversation_id, direcao, estado, quem)
        values (e ->> 'meta_call_id', v_conv, 'recebida', 'tocando', app.wa_chamada_nome(v_conv))
        on conflict (meta_call_id) where meta_call_id is not null do nothing
        returning * into ch;
        if ch.id is null then
          select * into ch from public.wa_chamadas where meta_call_id = e ->> 'meta_call_id';
        end if;
      end if;

      if ch.encerrada_em is not null then
        continue;   -- reentrega
      end if;
      v_final := case
        when ch.atendida_em is not null or e ->> 'inicio' is not null then 'encerrada'
        when ch.estado = 'recusada' then 'recusada'
        when e -> 'erros' is not null and jsonb_array_length(e -> 'erros') > 0 then 'falhou'
        else 'perdida'
      end;
      update public.wa_chamadas
         set estado = v_final,
             meta_call_id = coalesce(meta_call_id, e ->> 'meta_call_id'),
             atendida_em = coalesce(atendida_em, (e ->> 'inicio')::timestamptz),
             encerrada_em = coalesce((e ->> 'fim')::timestamptz, now()),
             duracao_seg = (e ->> 'duracao')::int,
             oferta_sdp = null,
             resposta_sdp = null,
             erro = case when v_final = 'falhou' then e -> 'erros' else erro end
       where id = ch.id
      returning * into ch;
      perform app.wa_chamada_ao_terminar(ch);
      v_feitos := v_feitos + 1;
      continue;
    end if;

    v_fora := v_fora + 1;
  end loop;
  return jsonb_build_object('feitos', v_feitos, 'fora', v_fora);
end $$;
comment on function public.wa_chamada_eventos(jsonb) is
  'O webhook `calls` e a resposta ao pedido de permissão, fora da fila wa_inbound: o Realtime leva a ligação direto à tela. Idempotente.';
revoke all on function public.wa_chamada_eventos(jsonb) from public, anon, authenticated;
grant execute on function public.wa_chamada_eventos(jsonb) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('wa_chamadas_fechar_orfas', '*/5 * * * *', $cron$select app.wa_chamadas_fechar_orfas()$cron$);
  end if;
end $$;

notify pgrst, 'reload schema';

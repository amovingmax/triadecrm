-- =====================================================================
-- O aviso da visita: Aceitar, Agendar e Não é possível (Imova, 25/11/2026)
--
-- Pedido do dono, depois de testar o protótipo: o aviso mostra o nome do
-- cliente, o local da visita e o dia e o HORÁRIO que o cliente pediu, com
-- "Aceitar", "Agendar" e "Não é possível". "Gostei dessa alteração.
-- Implemente isso no sistema."
--
-- O QUE MUDA NO BANCO (a migração 20261124190000 continua valendo):
--   1. A hora exata que o cliente pediu (`visita_pedidos.hora`): "sábado às
--      10h" chega com a hora, e não só com o período. A porta da IA ganha
--      `p_hora` (opcional: o worker que já está no ar continua funcionando).
--   2. A lista dos admins traz o título do imóvel ("Terreno em Praia de
--      Tabatinga"), a cidade ("Nísia Floresta/RN"), o código e a hora.
--   3. A decisão:
--        * aprovada (Aceitar, ou Agendar dentro do que o cliente pediu): se a
--          Agenda recusar o horário (ocupado, sábado, domingo ou feriado), a
--          decisão NÃO vale e nada sai ao cliente: o admin escolhe outro
--          horário. Antes, a confirmação saía mesmo sem a visita na Agenda;
--        * outro_dia (Agendar fora do que o cliente pediu): o horário fica
--          RESERVADO na Agenda ("Visita a confirmar: ...") até o cliente
--          responder; o texto diz "Nesse horário" quando o dia é o mesmo e
--          não diz "não vamos conseguir" quando o cliente não disse o dia;
--        * recusada (Não é possível): como antes, com o motivo.
--   4. A resposta do cliente à proposta: `public.visita_pedido_cliente_respondeu`
--      (Cliente confirmou: a visita vira "Visita: ..." e ele recebe a
--      confirmação; Cliente não pode: a reserva sai da Agenda) e a lista
--      `public.visita_pedidos_aguardando`.
--
-- Na KOMUNE não faz nada.
--
-- COMO DESFAZER: reaplicar as funções da 20261124190000 (texto, porta da IA
-- com 8 argumentos, lista e decisão), apagar `public.visita_pedido_cliente_respondeu`,
-- `public.visita_pedidos_aguardando`, `app.visita_pedido_titulo`, a versão de 6
-- argumentos de `app.visita_pedido_texto` e as colunas novas de
-- `public.visita_pedidos` (hora, resposta_do_cliente, respondido_por,
-- respondido_em).
-- =====================================================================

do $imova$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O aviso da visita é da Imova: nada muda no banco da KOMUNE.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 1. A hora pedida e a resposta do cliente à proposta
  -- -------------------------------------------------------------------
  execute $ddl$
alter table public.visita_pedidos
  add column if not exists hora time,
  add column if not exists resposta_do_cliente text,
  add column if not exists respondido_por uuid references public.profiles (id) on delete set null,
  add column if not exists respondido_em timestamptz;
alter table public.visita_pedidos drop constraint if exists visita_pedidos_resposta_check;
alter table public.visita_pedidos add constraint visita_pedidos_resposta_check
  check (resposta_do_cliente is null or resposta_do_cliente in ('confirmou', 'nao_pode'));
comment on column public.visita_pedidos.hora is
  'A hora exata que o cliente pediu ("sábado às 10h"), quando ele disse uma; senão vale o período.';
comment on column public.visita_pedidos.resposta_do_cliente is
  'Depois de outro_dia (o admin propôs outro horário): confirmou ou nao_pode, marcado por um admin quando o cliente responde.';
  $ddl$;

  -- -------------------------------------------------------------------
  -- 2. Os textos, agora com a hora pedida
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function app.visita_pedido_texto(p_qual text, p_quando timestamptz,
                                                  p_data date, p_periodo text, p_imovel text,
                                                  p_hora time)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_dias   text[] := array['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
                           'quinta-feira', 'sexta-feira', 'sábado'];
  v_local  timestamp := p_quando at time zone 'America/Fortaleza';
  v_dia    text;
  v_hora   text;
  v_pedido text;
begin
  if p_quando is not null then
    v_dia := v_dias[extract(dow from v_local)::int + 1] || ', ' || to_char(v_local, 'DD/MM');
    v_hora := case when extract(minute from v_local) = 0 then to_char(v_local, 'FMHH24') || 'h'
                   else to_char(v_local, 'FMHH24"h"MI') end;
  end if;
  if p_data is not null then
    v_pedido := v_dias[extract(dow from p_data)::int + 1] || ', ' || to_char(p_data, 'DD/MM')
                || case
                     when p_hora is not null then
                       ', às ' || case when extract(minute from p_hora) = 0 then to_char(p_hora, 'FMHH24') || 'h'
                                       else to_char(p_hora, 'FMHH24"h"MI') end
                     when p_periodo = 'manha' then ', de manhã'
                     when p_periodo = 'tarde' then ', à tarde'
                     when p_periodo = 'noite' then ', à noite'
                     else '' end;
  end if;
  return case p_qual
    -- O que vai ao cliente quando a visita é aceita (ou quando ele confirma a proposta).
    when 'aprovada' then
      'Combinado! Sua visita '
      || case when p_imovel like 'o %' then 'ao ' || substr(p_imovel, 3)
              when p_imovel like 'a %' then 'à ' || substr(p_imovel, 3)
              else 'ao imóvel' end
      || ' ficou para ' || v_dia || ', às ' || v_hora
      || '. Qualquer coisa, é só me chamar por aqui.'
    -- O que vai ao cliente quando um admin propõe outro horário.
    when 'outro_dia' then
      case
        when p_data is null then ''
        when (v_local)::date = p_data then 'Nesse horário não vamos conseguir. '
        else 'Nesse dia não vamos conseguir. '
      end
      || 'Pode ser ' || v_dia || ', às ' || v_hora || '?'
    -- O dia e a hora marcados, para o admin ler ("sexta-feira, 27/11, às 9h").
    when 'quando' then v_dia || ', às ' || v_hora
    -- O dia que o cliente pediu, para o admin ler.
    when 'pedido' then coalesce(v_pedido, 'dia a combinar')
  end;
end $$;
comment on function app.visita_pedido_texto(text, timestamptz, date, text, text, time) is
  'Os textos do pedido de visita (Imova, 24 e 25/11/2026): a confirmação e a proposta de outro horário que vão ao cliente, o dia marcado e o dia pedido por extenso (com a hora, quando o cliente disse uma) para o admin.';
revoke all on function app.visita_pedido_texto(text, timestamptz, date, text, text, time) from public, anon, authenticated;
  $ddl$;

  -- A versão de 5 argumentos (a rodada dos avisos ainda chama assim) passa a ser só a ponte.
  execute $ddl$
create or replace function app.visita_pedido_texto(p_qual text, p_quando timestamptz,
                                                  p_data date, p_periodo text, p_imovel text)
returns text
language sql
stable
set search_path = ''
as $$
  select app.visita_pedido_texto(p_qual, p_quando, p_data, p_periodo, p_imovel, null::time)
$$;
revoke all on function app.visita_pedido_texto(text, timestamptz, date, text, text) from public, anon, authenticated;
  $ddl$;

  -- O título do imóvel para o cartão: "Terreno em Praia de Tabatinga".
  execute $ddl$
create or replace function app.visita_pedido_titulo(p_anuncio uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select upper(substr(x, 1, 1)) || substr(x, 2)
    from (select regexp_replace(app.visita_pedido_imovel(p_anuncio), '^(o|a) ', '') as x) s
   where x is not null
$$;
revoke all on function app.visita_pedido_titulo(uuid) from public, anon, authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 3. A porta da IA, com a hora (opcional)
  -- -------------------------------------------------------------------
  execute $ddl$
drop function if exists public.ia_atendente_pedir_visita(uuid, uuid, text, date, text, text, bigint, text);
create or replace function public.ia_atendente_pedir_visita(
  p_conversation_id uuid, p_em_resposta_a uuid, p_imovel_codigo text,
  p_data date default null, p_periodo text default null, p_como_disse text default null,
  p_ai_run_id bigint default null, p_prompt_version text default null,
  p_hora time default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c         public.conversations%rowtype;
  v_anuncio uuid := app.agenda_anuncio_do_codigo(p_imovel_codigo);
  v_codigo  text;
  v_hoje    date := (now() at time zone 'America/Fortaleza')::date;
  v_data    date := p_data;
  -- Hora fora do horário de visita (antes das 6h, depois das 22h): a IA leu errado.
  v_hora    time := case when p_hora between '06:00'::time and '22:00'::time then p_hora end;
  v_periodo text := case when p_periodo in ('manha', 'tarde', 'noite') then p_periodo end;
  v_disse   text := left(nullif(btrim(regexp_replace(coalesce(p_como_disse, ''), '\s+', ' ', 'g')), ''), 120);
  v_id      uuid;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_existe');
  end if;
  if v_anuncio is not null then
    select a.codigo into v_codigo from public.anuncios a where a.id = v_anuncio;
  end if;
  -- Dia no passado ou longe demais: a IA contou errado; fica o que o cliente disse.
  if v_data is not null and (v_data < v_hoje or v_data > v_hoje + 60) then
    v_data := null;
  end if;
  -- Sem dia, a hora sozinha não diz nada.
  if v_data is null then
    v_hora := null;
  end if;
  -- Com a hora, o período sai dela.
  if v_hora is not null then
    v_periodo := case when v_hora < '12:00'::time then 'manha'
                      when v_hora < '18:00'::time then 'tarde'
                      else 'noite' end;
  end if;

  update public.visita_pedidos
     set situacao = 'substituida', decidido_em = now()
   where conversation_id = p_conversation_id and situacao = 'pendente';

  insert into public.visita_pedidos (conversation_id, organization_id, anuncio_id, imovel_codigo,
                                     data, periodo, hora, como_disse, em_resposta_a, ai_run_id, prompt_version)
  values (p_conversation_id, c.organization_id, v_anuncio, coalesce(v_codigo, nullif(btrim(p_imovel_codigo), '')),
          v_data, v_periodo, v_hora, v_disse, p_em_resposta_a, p_ai_run_id, left(p_prompt_version, 60))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'pedido_id', v_id, 'anuncio_id', v_anuncio, 'data', v_data,
                            'hora', to_char(v_hora, 'HH24:MI'));
end $$;
comment on function public.ia_atendente_pedir_visita(uuid, uuid, text, date, text, text, bigint, text, time) is
  'Porta do worker de IA (Imova, 24 e 25/11/2026): grava o pedido de visita presencial que a IA combinou (imóvel, dia, período ou hora exata, como o cliente disse) para os admins aprovarem. Um pedido aberto por conversa: o novo substitui o anterior. Dia no passado ou a mais de 60 dias vira nulo; hora fora de 6h–22h também.';
revoke all on function public.ia_atendente_pedir_visita(uuid, uuid, text, date, text, text, bigint, text, time) from public, anon, authenticated;
grant execute on function public.ia_atendente_pedir_visita(uuid, uuid, text, date, text, text, bigint, text, time) to service_role;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 4. A lista dos admins: o local e a hora pedida
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.visita_pedidos_abertos()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_admin() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'conversa_id', p.conversation_id,
             'cliente', app.nome_da_conversa(p.conversation_id),
             'caminho', app.caminho_da_conversa(p.conversation_id),
             'imovel_codigo', p.imovel_codigo,
             'imovel', coalesce(app.visita_pedido_imovel(p.anuncio_id), p.imovel_codigo, 'imóvel a confirmar'),
             'titulo', coalesce(app.visita_pedido_titulo(p.anuncio_id), p.imovel_codigo, 'Imóvel a confirmar'),
             'lugar', (select nullif(concat_ws('/', nullif(btrim(a.cidade), ''), nullif(btrim(a.estado), '')), '')
                         from public.anuncios a where a.id = p.anuncio_id),
             'anuncio_id', p.anuncio_id,
             'data', p.data,
             'periodo', p.periodo,
             'hora', to_char(p.hora, 'HH24:MI'),
             'dia_pedido', app.visita_pedido_texto('pedido', null, p.data, p.periodo, null, p.hora),
             'como_disse', p.como_disse,
             'criado_em', p.criado_em) order by p.criado_em)
      from public.visita_pedidos p
     where p.situacao = 'pendente'), '[]'::jsonb);
end $$;
comment on function public.visita_pedidos_abertos() is
  'Os pedidos de visita esperando decisão (Imova, 24 e 25/11/2026), do mais antigo ao mais novo, com o local e o dia e a hora pedidos. Só admin; para os outros, lista vazia.';
revoke all on function public.visita_pedidos_abertos() from public, anon;
grant execute on function public.visita_pedidos_abertos() to authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 5. A decisão: a Agenda primeiro; a proposta reserva o horário
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.visita_pedido_decidir(
  p_id uuid, p_decisao text, p_quando timestamptz default null, p_motivo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p        public.visita_pedidos%rowtype;
  v_eu     uuid := auth.uid();
  v_texto  text;
  v_msg    uuid;
  v_saiu   boolean := false;
  v_erro   text;
  v_visita jsonb;
  v_task   uuid;
  v_nome   text;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 300);
begin
  if v_eu is null or not app.is_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_decisao not in ('aprovada', 'outro_dia', 'recusada') then
    return jsonb_build_object('ok', false, 'motivo', 'decisao_invalida');
  end if;
  select * into p from public.visita_pedidos where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_existe');
  end if;
  -- Qualquer admin decide; o primeiro vale.
  if p.situacao <> 'pendente' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_decidido', 'situacao', p.situacao,
                              'por', (select t.full_name from public.team_directory t where t.id = p.decidido_por));
  end if;
  if p_decisao in ('aprovada', 'outro_dia') and (p_quando is null or p_quando < now()) then
    return jsonb_build_object('ok', false, 'motivo', 'quando_invalido');
  end if;

  -- A visita na Agenda, com o imóvel (quem decidiu é o dono). Se a Agenda recusar
  -- (horário ocupado, sábado, domingo, feriado), nada vale e nada sai ao cliente.
  if p_decisao in ('aprovada', 'outro_dia') and p.organization_id is not null then
    v_visita := public.visita_marcar_com_imovel(p.organization_id, p_quando, null, v_eu, p.anuncio_id, null);
    if not coalesce((v_visita ->> 'ok')::boolean, false) and v_visita ->> 'motivo' = 'visita_sem_imovel' then
      -- Pedido sem imóvel conhecido: a visita entra mesmo assim, sem o endereço.
      v_visita := public.visita_marcar(p.organization_id, p_quando, null, v_eu);
    end if;
    if not coalesce((v_visita ->> 'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'motivo', 'agenda_recusou', 'agenda', v_visita);
    end if;
    v_task := (v_visita ->> 'task_id')::uuid;
    if p_decisao = 'outro_dia' and v_task is not null then
      select o.name into v_nome from public.organizations o where o.id = p.organization_id;
      update public.tasks set title = 'Visita a confirmar: ' || coalesce(v_nome, 'cliente')
       where id = v_task;
    end if;
  end if;

  -- A mensagem ao cliente, pela porteira de sempre, em nome de quem decidiu.
  if p_decisao in ('aprovada', 'outro_dia') then
    v_texto := app.visita_pedido_texto(p_decisao, p_quando, p.data, p.periodo,
                                       app.visita_pedido_imovel(p.anuncio_id), p.hora);
    begin
      insert into public.messages (conversation_id, direction, type, status, body,
                                   author_kind, sent_by, origin)
      values (p.conversation_id, 'out'::app.msg_direction, 'text'::app.msg_type,
              'queued'::app.msg_status, v_texto, 'human', v_eu, 'crm')
      returning id into v_msg;
      v_saiu := true;
    exception when others then
      v_erro := left(sqlerrm, 300);
    end;
    -- A proposta que não chegou ao cliente não segura o horário de ninguém.
    if p_decisao = 'outro_dia' and not v_saiu and v_task is not null then
      update public.tasks set status = 'cancelled'::app.task_status where id = v_task;
      v_task := null;
    end if;
  end if;

  update public.visita_pedidos
     set situacao = p_decisao,
         marcada_para = case when p_decisao in ('aprovada', 'outro_dia') then p_quando end,
         motivo = coalesce(v_motivo, case when not v_saiu and v_erro is not null then 'mensagem não saiu: ' || v_erro end),
         decidido_por = v_eu,
         decidido_em = now(),
         task_id = v_task,
         mensagem_id = v_msg
   where id = p.id;

  return jsonb_build_object(
    'ok', true, 'decisao', p_decisao,
    'mensagem_saiu', v_saiu, 'mensagem', v_texto, 'erro_da_mensagem', v_erro,
    'na_agenda', v_task is not null, 'task_id', v_task,
    'agenda', case when p_decisao in ('aprovada', 'outro_dia') and v_task is null
                   then coalesce(v_visita, '{"motivo":"sem_ficha"}'::jsonb) end);
end $$;
comment on function public.visita_pedido_decidir(uuid, text, timestamptz, text) is
  'A decisão de um admin sobre um pedido de visita (Imova, 24 e 25/11/2026): aprovada (visita na Agenda com o imóvel e a confirmação ao cliente), outro_dia (o horário fica reservado na Agenda como "Visita a confirmar" e o cliente recebe a proposta) ou recusada (nada sai). Se a Agenda recusar o horário, nada vale (motivo agenda_recusou). O primeiro admin que decide vale. A mensagem sai em nome de quem decidiu; se a porteira recusar, a decisão vale e a resposta diz que não saiu.';
revoke all on function public.visita_pedido_decidir(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.visita_pedido_decidir(uuid, text, timestamptz, text) to authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 6. As propostas esperando o cliente e a resposta dele
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.visita_pedidos_aguardando()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_admin() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'conversa_id', p.conversation_id,
             'cliente', app.nome_da_conversa(p.conversation_id),
             'caminho', app.caminho_da_conversa(p.conversation_id),
             'imovel', coalesce(app.visita_pedido_imovel(p.anuncio_id), p.imovel_codigo, 'imóvel a confirmar'),
             'marcada_para', p.marcada_para,
             'quando', app.visita_pedido_texto('quando', p.marcada_para, null, null, null, null),
             'proposto_por', (select t.full_name from public.team_directory t where t.id = p.decidido_por),
             'na_agenda', p.task_id is not null,
             'decidido_em', p.decidido_em) order by p.marcada_para)
      from public.visita_pedidos p
      left join public.tasks t on t.id = p.task_id
     where p.situacao = 'outro_dia'
       and p.resposta_do_cliente is null
       and p.mensagem_id is not null
       and p.marcada_para > now() - interval '2 hours'
       and (p.task_id is null or t.status in ('todo'::app.task_status, 'doing'::app.task_status))), '[]'::jsonb);
end $$;
comment on function public.visita_pedidos_aguardando() is
  'As propostas de outro horário que esperam a resposta do cliente (Imova, 25/11/2026), da mais próxima à mais distante. Só admin; para os outros, lista vazia.';
revoke all on function public.visita_pedidos_aguardando() from public, anon;
grant execute on function public.visita_pedidos_aguardando() to authenticated;
  $ddl$;

  execute $ddl$
create or replace function public.visita_pedido_cliente_respondeu(p_id uuid, p_confirmou boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p        public.visita_pedidos%rowtype;
  v_eu     uuid := auth.uid();
  v_viva   boolean := false;
  v_task   uuid;
  v_visita jsonb;
  v_nome   text;
  v_texto  text;
  v_msg    uuid;
  v_saiu   boolean := false;
  v_erro   text;
begin
  if v_eu is null or not app.is_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_confirmou is null then
    return jsonb_build_object('ok', false, 'motivo', 'resposta_invalida');
  end if;
  select * into p from public.visita_pedidos where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_existe');
  end if;
  if p.situacao <> 'outro_dia' then
    return jsonb_build_object('ok', false, 'motivo', 'nao_aguarda');
  end if;
  if p.resposta_do_cliente is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_respondido', 'resposta', p.resposta_do_cliente,
                              'por', (select t.full_name from public.team_directory t where t.id = p.respondido_por));
  end if;
  v_task := p.task_id;
  if v_task is not null then
    select t.status in ('todo'::app.task_status, 'doing'::app.task_status) into v_viva
      from public.tasks t where t.id = v_task;
    v_viva := coalesce(v_viva, false);
  end if;

  if p_confirmou then
    if p.marcada_para is null or p.marcada_para < now() then
      return jsonb_build_object('ok', false, 'motivo', 'horario_passou');
    end if;
    select o.name into v_nome from public.organizations o where o.id = p.organization_id;
    if v_viva then
      update public.tasks set title = 'Visita: ' || coalesce(v_nome, 'cliente') where id = v_task;
    elsif p.organization_id is not null then
      -- A reserva saiu da Agenda (alguém apagou): marca de novo.
      v_visita := public.visita_marcar_com_imovel(p.organization_id, p.marcada_para, null, v_eu, p.anuncio_id, null);
      if not coalesce((v_visita ->> 'ok')::boolean, false) and v_visita ->> 'motivo' = 'visita_sem_imovel' then
        v_visita := public.visita_marcar(p.organization_id, p.marcada_para, null, v_eu);
      end if;
      if not coalesce((v_visita ->> 'ok')::boolean, false) then
        return jsonb_build_object('ok', false, 'motivo', 'agenda_recusou', 'agenda', v_visita);
      end if;
      v_task := (v_visita ->> 'task_id')::uuid;
    else
      v_task := null;
    end if;

    v_texto := app.visita_pedido_texto('aprovada', p.marcada_para, p.data, p.periodo,
                                       app.visita_pedido_imovel(p.anuncio_id), p.hora);
    begin
      insert into public.messages (conversation_id, direction, type, status, body,
                                   author_kind, sent_by, origin)
      values (p.conversation_id, 'out'::app.msg_direction, 'text'::app.msg_type,
              'queued'::app.msg_status, v_texto, 'human', v_eu, 'crm')
      returning id into v_msg;
      v_saiu := true;
    exception when others then
      v_erro := left(sqlerrm, 300);
    end;
  else
    if v_viva then
      update public.tasks set status = 'cancelled'::app.task_status where id = v_task;
    end if;
    v_task := null;
  end if;

  update public.visita_pedidos
     set resposta_do_cliente = case when p_confirmou then 'confirmou' else 'nao_pode' end,
         respondido_por = v_eu,
         respondido_em = now(),
         task_id = coalesce(v_task, task_id)
   where id = p.id;

  return jsonb_build_object(
    'ok', true, 'confirmou', p_confirmou,
    'mensagem_saiu', v_saiu, 'mensagem', v_texto, 'erro_da_mensagem', v_erro,
    'na_agenda', p_confirmou and v_task is not null, 'task_id', v_task);
end $$;
comment on function public.visita_pedido_cliente_respondeu(uuid, boolean) is
  'A resposta do cliente a uma proposta de outro horário (Imova, 25/11/2026), marcada por um admin: confirmou (a reserva vira "Visita: ..." na Agenda e o cliente recebe a confirmação em nome de quem marcou) ou não pode (a reserva sai da Agenda; nada sai ao cliente).';
revoke all on function public.visita_pedido_cliente_respondeu(uuid, boolean) from public, anon;
grant execute on function public.visita_pedido_cliente_respondeu(uuid, boolean) to authenticated;
  $ddl$;
end
$imova$;

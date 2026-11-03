-- =====================================================================
-- pgTAP — A ligação perdida na lista de Conversas (migração 20261103160000)
--
-- Pedido de 03/11/2026. Este arquivo prova:
--
--   1. A PERDIDA APARECE: o cliente ligou, ninguém atendeu, e a conversa entra na
--      lista com a hora da última e quantas foram;
--   2. QUEM VÊ: quem escreve no CRM vê; quem só lê e quem não entrou, não;
--   3. O RETORNO TIRA A MARCA: ligação feita pelo time (atendida ou não), ligação
--      completada ou mensagem de alguém do time. Mensagem automática, mensagem que
--      falhou, ligação feita que falhou e o que veio ANTES da perdida não tiram;
--   4. TRINTA DIAS: a perdida antiga sai sozinha;
--   5. A CONCLUÍDA VOLTA quando o cliente liga, e a ligação feita pelo time não a
--      traz de volta;
--   6. NADA MAIS MUDA: nem mensagem, nem `last_message_at`, nem a janela de 24 h.
--
-- Roda em transação e desfaz tudo. Os instantes são escritos à mão: dentro da
-- transação `now()` não anda, e "depois da perdida" precisa de um relógio.
-- =====================================================================
begin;
select plan(24);

insert into public.allowed_users (email, role, note) values
  ('h119.g@teste.local', 'gestor', 'pgTAP 119'),
  ('h119.s@teste.local', 'sdr', 'pgTAP 119'),
  ('h119.l@teste.local', 'leitura', 'pgTAP 119');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000011901'::uuid, 'h119.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000011902'::uuid, 'h119.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000011903'::uuid, 'h119.l@teste.local', '{"full_name":"Leo Leitura"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999911900"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

create temp table t119(chave text primary key, valor uuid);
grant select on t119 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t119 where chave = p_chave
$$;
grant execute on function pg_temp.id(text) to authenticated;

create function pg_temp.conversa(p_chave text, p_tel text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, status)
  values ('whatsapp'::app.channel, '+5584999911900', p_tel, 'Cliente ' || p_chave, 'aguardando_nos')
  returning id into v;
  -- A janela de 24 h aberta, para a mensagem do time poder sair.
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (v, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'pgtap119', 'system', 'crm', now() - interval '2 hours');
  insert into t119 values (p_chave, v);
  return v;
end $$;

-- Uma ligação já terminada, no instante pedido (minutos antes de agora).
create function pg_temp.chamada(p_conv text, p_direcao text, p_estado text, p_min_atras int)
returns void language sql as $$
  insert into public.wa_chamadas (conversation_id, direcao, estado, quem, tocou_em, encerrada_em, atendida_em)
  values (pg_temp.id(p_conv), p_direcao, p_estado, 'Cliente ' || p_conv,
          now() - make_interval(mins => p_min_atras), now() - make_interval(mins => p_min_atras),
          case when p_estado = 'encerrada' then now() - make_interval(mins => p_min_atras) end)
$$;

create function pg_temp.mensagem(p_conv text, p_autor text, p_status text, p_min_atras int)
returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by,
                               origin, created_at, error_code, failed_at)
  values (pg_temp.id(p_conv), 'out'::app.msg_direction, 'text'::app.msg_type, p_status::app.msg_status,
          'pgtap119', p_autor,
          case when p_autor = 'human' then 'a0000000-0000-4000-8000-000000011901'::uuid end,
          'crm', now() - make_interval(mins => p_min_atras),
          case when p_status = 'failed' then '131047' end,
          case when p_status = 'failed' then now() end)
$$;

create function pg_temp.perdidas(p_conv text) returns int language sql as $$
  select coalesce((select quantas from public.wa_ligacoes_perdidas() where conversation_id = pg_temp.id(p_conv)), 0)
$$;
grant execute on function pg_temp.perdidas(text) to authenticated;

select pg_temp.virar('imova');
update public.app_settings set value = '{"ativa": true}'::jsonb where key = 'whatsapp.ligacao';

-- =====================================================================
-- 1. A perdida aparece
-- =====================================================================
select pg_temp.conversa('a', '+5584999911901');
select pg_temp.chamada('a', 'recebida', 'perdida', 50);

select pg_temp.entrar('a0000000-0000-4000-8000-000000011901'::uuid, 'gestor');
select is(pg_temp.perdidas('a'), 1, 'o cliente ligou e ninguém atendeu: a conversa entra na lista');
select pg_temp.sair();

select pg_temp.chamada('a', 'recebida', 'perdida', 40);
select pg_temp.entrar('a0000000-0000-4000-8000-000000011901'::uuid, 'gestor');
select is(pg_temp.perdidas('a'), 2, 'ligou de novo: conta as duas');
select is((select ultima_em from public.wa_ligacoes_perdidas() where conversation_id = pg_temp.id('a')),
          now() - interval '40 minutes', 'e a hora é a da última');
select pg_temp.sair();

-- =====================================================================
-- 2. Quem vê
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000011902'::uuid, 'sdr');
select is(pg_temp.perdidas('a'), 2, 'o SDR vê, porque toca para todos');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000011903'::uuid, 'leitura');
select is((select count(*)::int from public.wa_ligacoes_perdidas()), 0, 'quem só lê não vê ligação');
select pg_temp.sair();

set local role anon;
select throws_ok('select * from public.wa_ligacoes_perdidas()', '42501', null, 'quem não entrou não chama');
reset role;

-- =====================================================================
-- 3. O retorno tira a marca
-- =====================================================================
-- O que não é retorno.
select pg_temp.mensagem('a', 'human', 'sent', 55);
select is(pg_temp.perdidas('a'), 2, 'mensagem do time ANTES da perdida não conta');
-- A automática de verdade sai por modelo aprovado; aqui só importa que o autor é o robô,
-- então a porteira sai do caminho nesta linha.
alter table public.messages disable trigger messages_guard;
select pg_temp.mensagem('a', 'bot_fixed', 'sent', 30);
alter table public.messages enable trigger messages_guard;
select is(pg_temp.perdidas('a'), 2, 'mensagem automática não é retorno');
select pg_temp.mensagem('a', 'human', 'failed', 29);
select is(pg_temp.perdidas('a'), 2, 'mensagem que falhou não chegou ao cliente');
select pg_temp.chamada('a', 'feita', 'falhou', 28);
select is(pg_temp.perdidas('a'), 2, 'ligação feita que falhou não chegou ao cliente');

-- Mensagem do time.
select pg_temp.mensagem('a', 'human', 'queued', 20);
select is(pg_temp.perdidas('a'), 0, 'alguém do time escreveu: a marca sai');
select pg_temp.chamada('a', 'recebida', 'perdida', 10);
select is(pg_temp.perdidas('a'), 1, 'perdeu outra depois: volta, só com a nova');

-- Ligação feita pelo time, mesmo sem o cliente atender.
select pg_temp.conversa('b', '+5584999911902');
select pg_temp.chamada('b', 'recebida', 'perdida', 50);
select pg_temp.chamada('b', 'feita', 'perdida', 45);
select is(pg_temp.perdidas('b'), 0, 'o time ligou de volta, e o cliente não atendeu: tentou, a marca sai');

-- Ligação completada.
select pg_temp.conversa('c', '+5584999911903');
select pg_temp.chamada('c', 'recebida', 'perdida', 50);
select pg_temp.chamada('c', 'recebida', 'encerrada', 45);
select is(pg_temp.perdidas('c'), 0, 'o cliente ligou de novo e alguém atendeu: a marca sai');

-- Atendida, recusada ou em curso não são perdidas.
select pg_temp.conversa('d', '+5584999911904');
select pg_temp.chamada('d', 'recebida', 'encerrada', 50);
select pg_temp.chamada('d', 'feita', 'recusada', 40);
select is(pg_temp.perdidas('d'), 0, 'atendida e recusada não entram');

-- =====================================================================
-- 4. Trinta dias
-- =====================================================================
select pg_temp.conversa('e', '+5584999911905');
select pg_temp.chamada('e', 'recebida', 'perdida', 31 * 24 * 60);
select is(pg_temp.perdidas('e'), 0, 'perdida de mais de 30 dias sai sozinha');

-- =====================================================================
-- 5. A concluída volta quando o cliente liga
-- =====================================================================
select pg_temp.conversa('f', '+5584999911906');
update public.conversations set arquivada_em = now(), arquivada_por = 'a0000000-0000-4000-8000-000000011901'::uuid
 where id = pg_temp.id('f');
select pg_temp.chamada('f', 'feita', 'perdida', 30);
select ok((select arquivada_em is not null from public.conversations where id = pg_temp.id('f')),
          'a ligação feita pelo time não desarquiva');

create temp table t119_antes as
  select (select count(*) from public.messages) as msgs,
         (select last_message_at from public.conversations where id = pg_temp.id('f')) as ultima,
         (select window_expires_at from public.conversations where id = pg_temp.id('f')) as janela;

-- Pelo caminho real: o aviso da Meta.
select public.wa_chamada_eventos(jsonb_build_array(jsonb_build_object(
  'tipo', 'chamada', 'evento', 'connect', 'direcao', 'USER_INITIATED', 'sdp_tipo', 'offer',
  'sdp', 'v=0 oferta', 'meta_call_id', 'wacid.F119', 'numero_da_empresa', '+5584999911900',
  'de', '+5584999911906', 'nome', 'Cliente f')));
select ok((select arquivada_em is null from public.conversations where id = pg_temp.id('f')),
          'o cliente ligou: a conversa concluída volta para a lista');
select is((select arquivada_por from public.conversations where id = pg_temp.id('f')), null,
          'sem o nome de quem tinha concluído');

select public.wa_chamada_eventos(jsonb_build_array(jsonb_build_object(
  'tipo', 'chamada', 'evento', 'terminate', 'direcao', 'USER_INITIATED', 'meta_call_id', 'wacid.F119',
  'numero_da_empresa', '+5584999911900', 'de', '+5584999911906', 'status', 'COMPLETED')));
select is((select estado from public.wa_chamadas where meta_call_id = 'wacid.F119'), 'perdida',
          'ninguém atendeu: perdida');
-- Pela porta de quem usa o CRM, a perdida que veio da Meta.
select pg_temp.entrar('a0000000-0000-4000-8000-000000011901'::uuid, 'gestor');
select is(pg_temp.perdidas('f'), 1, 'e entra na lista');
select pg_temp.sair();

-- =====================================================================
-- 6. Nada mais muda
-- =====================================================================
select is((select count(*) from public.messages), (select msgs from t119_antes), 'a ligação não vira mensagem');
select is((select last_message_at from public.conversations where id = pg_temp.id('f')),
          (select ultima from t119_antes), 'nem mexe em last_message_at (a IA não relê a conversa)');
select is((select window_expires_at from public.conversations where id = pg_temp.id('f')),
          (select janela from t119_antes), 'nem na janela de 24 h');

select * from finish();
rollback;

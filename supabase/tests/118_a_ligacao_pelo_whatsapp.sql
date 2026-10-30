-- =====================================================================
-- pgTAP — A ligação pelo WhatsApp (migração 20261030120000)
--
-- Pedido de 29 e 30/10/2026 para a Imova. Este arquivo prova:
--
--   1. SÓ DA IMOVA, E DESLIGADA POR PADRÃO: na KOMUNE não liga nem com a chave
--      gravada à força;
--   2. O CLIENTE LIGOU: a ligação toca, a reentrega da Meta não duplica, número
--      novo abre conversa, e nada disso vira mensagem, abre janela ou entra na fila;
--   3. O PRIMEIRO QUE ATENDER LEVA, e quem nega o microfone devolve a ligação;
--   4. O FIM: atendida vira encerrada com duração, sem resposta vira perdida, o SDP
--      é apagado, e a linha do tempo recebe um lançamento só, mesmo com reentrega;
--   5. O TELEFONE NÃO SAI: nenhuma porta de quem usa o CRM devolve o número, e as
--      portas do serviço são fechadas para quem está logado;
--   6. A PERMISSÃO É DO CLIENTE: sem ela não se liga; pedir respeita janela,
--      supressão e os limites da Meta; aceitar libera, vencer e recusar travam;
--   7. A LIGAÇÃO FEITA: abre, anda pelos avisos da Meta, conta as sem resposta, uma
--      por pessoa e uma por conversa, e respeita o horário de ligar;
--   8. ÓRFÃS: ligação sem aviso de fim é fechada e não prende a pessoa;
--   9. A TWILIO NÃO MUDA: nada entra em voice_calls.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(72);

insert into public.allowed_users (email, role, note) values
  ('h118.g@teste.local', 'gestor', 'pgTAP 118'),
  ('h118.s@teste.local', 'sdr', 'pgTAP 118'),
  ('h118.l@teste.local', 'leitura', 'pgTAP 118');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000011801'::uuid, 'h118.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000011802'::uuid, 'h118.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000011803'::uuid, 'h118.l@teste.local', '{"full_name":"Leo Leitura"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999911800"')
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
create function pg_temp.gestor() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000011801'::uuid, 'gestor')
$$;
create function pg_temp.sdr() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000011802'::uuid, 'sdr')
$$;
create function pg_temp.leitura() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000011803'::uuid, 'leitura')
$$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

create temp table t118(chave text primary key, valor uuid);
grant select, insert on t118 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t118 where chave = p_chave
$$;
grant execute on function pg_temp.id(text) to authenticated;
create function pg_temp.guardar(p_chave text, p_valor uuid) returns uuid language sql as $$
  insert into t118 values (p_chave, p_valor) returning valor
$$;

-- Conversa com a janela de 24 h aberta (ou fechada, com p_janela = false).
create function pg_temp.conversa(p_chave text, p_tel text, p_org uuid default null, p_janela boolean default true)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome,
                                    assignee_id, status, organization_id)
  values ('whatsapp'::app.channel, '+5584999911800', p_tel, 'Cliente ' || p_chave,
          'a0000000-0000-4000-8000-000000011801'::uuid, 'aguardando_nos', p_org)
  returning id into v;
  if p_janela then
    insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
    values (v, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
            'pgtap118', 'system', 'crm');
  end if;
  insert into t118 values (p_chave, v);
  return v;
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

create function pg_temp.chave(p_ativa boolean) returns void language sql as $$
  update public.app_settings set value = jsonb_build_object('ativa', p_ativa) where key = 'whatsapp.ligacao'
$$;

-- O horário de ligar depende de quando o teste roda; aqui ele é decidido pelo teste.
create temp table t118_horario(aberta boolean not null);
insert into t118_horario values (true);
grant select on t118_horario to public;
create or replace function app.call_window(p_at timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object('aberta', aberta, 'motivo', null, 'abre_em', null, 'fecha_em', null) from t118_horario
$$;

-- Os eventos como `extrair.ts` os entrega.
create function pg_temp.ligou(p_call text, p_de text, p_nome text default 'Quem Ligou') returns jsonb language sql as $$
  select public.wa_chamada_eventos(jsonb_build_array(jsonb_build_object(
    'tipo', 'chamada', 'evento', 'connect', 'direcao', 'USER_INITIATED', 'sdp_tipo', 'offer',
    'sdp', 'v=0 oferta', 'meta_call_id', p_call, 'numero_da_empresa', '+5584999911800',
    'de', p_de, 'nome', p_nome)))
$$;
create function pg_temp.terminou(p_call text, p_de text, p_inicio timestamptz default null, p_duracao int default null)
returns jsonb language sql as $$
  select public.wa_chamada_eventos(jsonb_build_array(jsonb_build_object(
    'tipo', 'chamada', 'evento', 'terminate', 'direcao', 'USER_INITIATED', 'meta_call_id', p_call,
    'numero_da_empresa', '+5584999911800', 'de', p_de, 'status', 'COMPLETED',
    'inicio', p_inicio, 'fim', case when p_inicio is not null then now() end, 'duracao', p_duracao)))
$$;
create function pg_temp.respondeu(p_de text, p_resposta text, p_permanente boolean default false,
                                  p_expira timestamptz default now() + interval '7 days',
                                  p_origem text default 'user_action')
returns jsonb language sql as $$
  select public.wa_chamada_eventos(jsonb_build_array(jsonb_build_object(
    'tipo', 'permissao', 'numero_da_empresa', '+5584999911800', 'de', p_de, 'resposta', p_resposta,
    'permanente', p_permanente, 'expira_em', p_expira, 'origem', p_origem)))
$$;

-- =====================================================================
-- 1. Só da Imova, e desligada por padrão
-- =====================================================================
select pg_temp.virar('imova');
select pg_temp.conversa('a', '+5584999911801');

select is((select value ->> 'ativa' from public.app_settings where key = 'whatsapp.ligacao'), 'false',
          'a chave nasce desligada');
select is(app.wa_ligacao_ligada(), false, 'desligada, a ligação não existe nem na Imova');

select pg_temp.gestor();
select is(public.wa_ligacao_estado(pg_temp.id('a')) ->> 'ligada', 'false', 'desligada, o estado diz que não há ligação');
select is(public.wa_permissao_pedir(pg_temp.id('a'), 'Posso ligar?') ->> 'motivo', 'ligacao_desligada',
          'desligada, ninguém pede permissão');
select is(public.wa_chamada_abrir(pg_temp.id('a')) ->> 'motivo', 'ligacao_desligada',
          'desligada, ninguém liga');
select pg_temp.sair();

select pg_temp.chave(true);
select pg_temp.virar('komune');
select is(app.wa_ligacao_ligada(), false, 'na KOMUNE não liga nem com a chave gravada à força');
select pg_temp.virar('imova');
select is(app.wa_ligacao_ligada(), true, 'na Imova, com a chave, liga');

-- =====================================================================
-- 2. O cliente ligou
-- =====================================================================
create temp table t118_antes as
  select (select count(*) from public.messages) as msgs,
         (select window_expires_at from public.conversations where id = pg_temp.id('a')) as janela,
         (select count(*) from public.voice_calls) as voz;

select pg_temp.ligou('wacid.A1', '+5584999911801');
select is((select estado from public.wa_chamadas where meta_call_id = 'wacid.A1'), 'tocando', 'o cliente ligou: toca');
select is((select oferta_sdp from public.wa_chamadas where meta_call_id = 'wacid.A1'), 'v=0 oferta', 'a oferta fica para o navegador ler');
select is((select conversation_id from public.wa_chamadas where meta_call_id = 'wacid.A1'), pg_temp.id('a'), 'é a conversa que já existia');
select is((select quem from public.wa_chamadas where meta_call_id = 'wacid.A1'), 'Cliente a', 'a tela mostra o nome, não o número');

select pg_temp.ligou('wacid.A1', '+5584999911801');
select is((select count(*)::int from public.wa_chamadas where meta_call_id = 'wacid.A1'), 1, 'a reentrega da Meta não duplica');

select is((select count(*) from public.messages), (select msgs from t118_antes), 'uma ligação não vira mensagem');
select is((select window_expires_at from public.conversations where id = pg_temp.id('a')),
          (select janela from t118_antes), 'uma ligação não mexe na janela de 24 h');

select pg_temp.ligou('wacid.N1', '+5584999911899', 'Pessoa Nova');
select is((select c.peer_phone_e164 from public.wa_chamadas ch join public.conversations c on c.id = ch.conversation_id
            where ch.meta_call_id = 'wacid.N1'), '+5584999911899', 'número novo abre conversa');
select is((select quem from public.wa_chamadas where meta_call_id = 'wacid.N1'), 'Pessoa Nova', 'com o nome do perfil');
select is((select count(*) from public.messages), (select msgs from t118_antes), 'e sem mensagem');
select pg_temp.terminou('wacid.N1', '+5584999911899');

-- =====================================================================
-- 3. O primeiro que atender leva
-- =====================================================================
select pg_temp.leitura();
select is(public.wa_chamada_atender((select id from public.wa_chamadas where meta_call_id = 'wacid.A1')) ->> 'motivo',
          'sem_permissao', 'quem só lê não atende');
select pg_temp.sair();
select pg_temp.guardar('ch1', (select id from public.wa_chamadas where meta_call_id = 'wacid.A1'));

select pg_temp.gestor();
select is((select count(*)::int from public.wa_chamadas where id = pg_temp.id('ch1')), 1, 'quem escreve vê a ligação tocando');
select is(public.wa_chamada_atender(pg_temp.id('ch1')) ->> 'oferta_sdp', 'v=0 oferta', 'o primeiro atende e recebe a oferta');
select pg_temp.sdr();
select is(public.wa_chamada_atender(pg_temp.id('ch1')) ->> 'motivo', 'ja_atendida', 'o segundo chega tarde');
select pg_temp.gestor();
select is(public.wa_chamada_soltar(pg_temp.id('ch1')) ->> 'ok', 'true', 'o microfone foi negado: quem atendeu solta');
select pg_temp.sdr();
select is(public.wa_chamada_atender(pg_temp.id('ch1')) ->> 'ok', 'true', 'e a ligação volta a poder ser atendida');
select is(public.wa_chamada_autorizar(pg_temp.id('ch1'), 'atender') ->> 'ok', 'true', 'quem reservou pode falar com a Meta');
select pg_temp.gestor();
select is(public.wa_chamada_autorizar(pg_temp.id('ch1'), 'atender') ->> 'ok', 'false', 'quem não reservou, não');
select pg_temp.sair();

-- =====================================================================
-- 4. O fim
-- =====================================================================
select public.wa_chamada_marcar(pg_temp.id('ch1'), 'aceita');
select is((select estado from public.wa_chamadas where id = pg_temp.id('ch1')), 'em_curso', 'a Meta aceitou: em curso');

insert into public.organizations (kind, name, phone_e164, source_id, collected_at, collector, owner_id)
values ('fornecedor'::app.org_kind, 'Ficha 118', '+5584999911802',
        (select s.id from public.sources s where s.slug = 'whatsapp_entrada'), now(), 'pgtap118',
        'a0000000-0000-4000-8000-000000011801'::uuid);
select pg_temp.conversa('b', '+5584999911802', (select id from public.organizations where name = 'Ficha 118'));

select pg_temp.ligou('wacid.B1', '+5584999911802');
select pg_temp.terminou('wacid.B1', '+5584999911802');
select is((select estado from public.wa_chamadas where meta_call_id = 'wacid.B1'), 'perdida', 'ninguém atendeu: perdida');
select is((select oferta_sdp from public.wa_chamadas where meta_call_id = 'wacid.B1'), null, 'o SDP é apagado no fim');
select is((select count(*)::int from public.activities where metadata ->> 'wa_chamada_id' =
            (select id::text from public.wa_chamadas where meta_call_id = 'wacid.B1') and type = 'system'),
          1, 'a perdida entra na linha do tempo da ficha');
select pg_temp.terminou('wacid.B1', '+5584999911802');
select is((select count(*)::int from public.activities where metadata ->> 'wa_chamada_id' =
            (select id::text from public.wa_chamadas where meta_call_id = 'wacid.B1')),
          1, 'a reentrega do fim não lança de novo');

select pg_temp.ligou('wacid.B2', '+5584999911802');
select pg_temp.guardar('ch2', (select id from public.wa_chamadas where meta_call_id = 'wacid.B2'));
select pg_temp.gestor();
select public.wa_chamada_atender(pg_temp.id('ch2'));
select pg_temp.sair();
select public.wa_chamada_marcar(pg_temp.id('ch2'), 'aceita');
select pg_temp.terminou('wacid.B2', '+5584999911802', now() - interval '2 minutes', 120);
select is((select estado from public.wa_chamadas where id = pg_temp.id('ch2')), 'encerrada', 'atendida: encerrada');
select is((select duracao_seg from public.wa_chamadas where id = pg_temp.id('ch2')), 120, 'com a duração que a Meta mediu');
select is((select type::text from public.activities where metadata ->> 'wa_chamada_id' = pg_temp.id('ch2')::text),
          'call', 'e entra na ficha como ligação');

-- Chave desligada: não toca, mas não se perde.
select pg_temp.chave(false);
select pg_temp.ligou('wacid.D1', '+5584999911802');
select is((select estado from public.wa_chamadas where meta_call_id = 'wacid.D1'), 'perdida', 'chave desligada: fica como perdida, sem tocar');
select pg_temp.chave(true);

-- =====================================================================
-- 5. O telefone não sai
-- =====================================================================
select pg_temp.sdr();
select is(position('999118' in public.wa_ligacao_estado(pg_temp.id('b'))::text), 0, 'o estado não traz o número');
select throws_ok($$ select public.wa_chamada_para_meta(pg_temp.id('ch2')) $$, '42501', null, 'quem está logado não pede o número ao serviço');
select throws_ok($$ select public.wa_chamada_eventos('[]'::jsonb) $$, '42501', null, 'nem se passa pelo webhook');
select throws_ok($$ select public.wa_chamada_marcar(pg_temp.id('ch2'), 'aceita') $$, '42501', null, 'nem marca a ligação');
select pg_temp.sair();
select is(public.wa_chamada_para_meta(pg_temp.id('ch2')) ->> 'para', '+5584999911802', 'o serviço recebe o número');

-- =====================================================================
-- 6. A permissão é do cliente
-- =====================================================================
select pg_temp.conversa('c', '+5584999911803');
select pg_temp.conversa('fechada', '+5584999911804', null, false);
select pg_temp.conversa('sup', '+5584999911805');
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex(app.normalize_phone_br('+5584999911805')), 'phone', 'pgtap118');

select pg_temp.gestor();
select is(public.wa_chamada_abrir(pg_temp.id('c')) ->> 'motivo', 'sem_permissao_do_cliente', 'sem a permissão dele, não se liga');
select is(public.wa_permissao_pedir(pg_temp.id('fechada'), 'Posso ligar?') ->> 'motivo', 'fora_da_janela', 'fora das 24 h não se pede sem modelo');
select is(public.wa_permissao_pedir(pg_temp.id('sup'), 'Posso ligar?') ->> 'motivo', 'contato_suprimido', 'quem pediu para sair não recebe o pedido');
select is(public.wa_permissao_pedir(pg_temp.id('c'), 'Posso ligar?') ->> 'ok', 'true', 'dentro das 24 h, pede');
select pg_temp.sair();

select is((select template_params ->> 'permissao_de_ligar' from public.messages
            where conversation_id = pg_temp.id('c') and direction = 'out'), 'true', 'o pedido vai pela fila, marcado');
select is((select status::text from public.messages where conversation_id = pg_temp.id('c') and direction = 'out'), 'queued', 'esperando o robô de envio');

select pg_temp.gestor();
select is(public.wa_permissao_pedir(pg_temp.id('c'), 'De novo?') ->> 'motivo', 'limite_de_pedidos', 'a Meta só deixa pedir uma vez por dia');
select isnt(public.wa_ligacao_estado(pg_temp.id('c')) ->> 'proximo_pedido_em', null, 'e a tela sabe quando pode pedir de novo');
select pg_temp.sair();

select pg_temp.respondeu('+5584999911803', 'reject');
select pg_temp.gestor();
select is(public.wa_ligacao_estado(pg_temp.id('c')) ->> 'permissao', 'recusada', 'recusou: a tela sabe');
select is(public.wa_chamada_abrir(pg_temp.id('c')) ->> 'motivo', 'sem_permissao_do_cliente', 'e não se liga');
select pg_temp.sair();

select pg_temp.respondeu('+5584999911803', 'accept', false, now() - interval '1 minute');
select pg_temp.gestor();
select is(public.wa_ligacao_estado(pg_temp.id('c')) ->> 'permissao', 'venceu', 'a temporária venceu: a Meta não avisa, o banco sabe');
select is(public.wa_chamada_abrir(pg_temp.id('c')) ->> 'motivo', 'sem_permissao_do_cliente', 'vencida, não se liga');
select pg_temp.sair();

-- =====================================================================
-- 7. A ligação feita
-- =====================================================================
select pg_temp.respondeu('+5584999911803', 'accept');
update public.wa_permissoes_de_ligar set nao_atendidas_seguidas = 1 where conversation_id = pg_temp.id('c');

update t118_horario set aberta = false;
select pg_temp.gestor();
select is(public.wa_chamada_abrir(pg_temp.id('c')) ->> 'motivo', 'fora_do_horario', 'fora do horário de ligar, não se liga');
select pg_temp.sair();
update t118_horario set aberta = true;

select pg_temp.gestor();
select pg_temp.guardar('ch3', (public.wa_chamada_abrir(pg_temp.id('c')) ->> 'chamada_id')::uuid);
select is((select estado from public.wa_chamadas where id = pg_temp.id('ch3')), 'discando', 'com a permissão, abre');
select is(public.wa_chamada_abrir(pg_temp.id('c')) ->> 'motivo', 'ligacao_em_curso', 'uma ligação por conversa');
select pg_temp.sair();

-- A resposta da Meta chega antes de a Edge Function gravar o id da chamada: vale o id nosso.
select public.wa_chamada_eventos(jsonb_build_array(jsonb_build_object(
  'tipo', 'chamada', 'evento', 'connect', 'direcao', 'BUSINESS_INITIATED', 'sdp_tipo', 'answer',
  'sdp', 'v=0 resposta', 'meta_call_id', 'wacid.C1', 'opaco', pg_temp.id('ch3'))));
select is((select resposta_sdp from public.wa_chamadas where id = pg_temp.id('ch3')), 'v=0 resposta', 'a resposta da Meta chega ao navegador');

select public.wa_chamada_eventos('[{"tipo": "chamada_status", "status": "RINGING", "meta_call_id": "wacid.C1"}]'::jsonb);
select is((select estado from public.wa_chamadas where id = pg_temp.id('ch3')), 'tocando', 'o WhatsApp dele está tocando');
select public.wa_chamada_eventos('[{"tipo": "chamada_status", "status": "ACCEPTED", "meta_call_id": "wacid.C1"}]'::jsonb);
select is((select estado from public.wa_chamadas where id = pg_temp.id('ch3')), 'em_curso', 'ele atendeu');

select public.wa_chamada_eventos(jsonb_build_array(jsonb_build_object(
  'tipo', 'chamada', 'evento', 'terminate', 'direcao', 'BUSINESS_INITIATED', 'meta_call_id', 'wacid.C1',
  'inicio', now() - interval '1 minute', 'fim', now(), 'duracao', 60)));
select is((select estado from public.wa_chamadas where id = pg_temp.id('ch3')), 'encerrada', 'acabou');
select is((select nao_atendidas_seguidas from public.wa_permissoes_de_ligar where conversation_id = pg_temp.id('c')), 0, 'atendida zera as sem resposta');

-- A recusada conta uma vez só, mesmo com o aviso de fim depois.
select pg_temp.gestor();
select pg_temp.guardar('ch4', (public.wa_chamada_abrir(pg_temp.id('c')) ->> 'chamada_id')::uuid);
select pg_temp.sair();
select public.wa_chamada_marcar(pg_temp.id('ch4'), 'meta_id', '{"meta_call_id": "wacid.C2"}'::jsonb);
select public.wa_chamada_eventos('[{"tipo": "chamada_status", "status": "REJECTED", "meta_call_id": "wacid.C2"}]'::jsonb);
select public.wa_chamada_eventos('[{"tipo": "chamada", "evento": "terminate", "direcao": "BUSINESS_INITIATED", "meta_call_id": "wacid.C2"}]'::jsonb);
select is((select estado from public.wa_chamadas where id = pg_temp.id('ch4')), 'recusada', 'ele recusou');
select is((select nao_atendidas_seguidas from public.wa_permissoes_de_ligar where conversation_id = pg_temp.id('c')), 1, 'conta como sem resposta, uma vez só');

-- A Meta recusa por falta de permissão: o que o banco sabia ficou velho.
select pg_temp.conversa('e', '+5584999911807');
select pg_temp.respondeu('+5584999911807', 'accept');
select pg_temp.gestor();
select pg_temp.guardar('ch6', (public.wa_chamada_abrir(pg_temp.id('e')) ->> 'chamada_id')::uuid);
select pg_temp.sair();
select public.wa_chamada_marcar(pg_temp.id('ch6'), 'falhou', '{"codigo": 138006}'::jsonb);
select is((select estado from public.wa_chamadas where id = pg_temp.id('ch6')), 'falhou', 'a Meta recusou: a ligação falha');
select is((select estado from public.wa_permissoes_de_ligar where conversation_id = pg_temp.id('e')), 'sem_permissao', 'e a permissão que estava aqui cai');

-- Conversa bloqueada no CRM não recebe pedido nem ligação.
select pg_temp.conversa('blq', '+5584999911808');
select pg_temp.respondeu('+5584999911808', 'accept');
update public.conversations set bloqueada_em = now() where id = pg_temp.id('blq');
select pg_temp.gestor();
select is(public.wa_chamada_abrir(pg_temp.id('blq')) ->> 'motivo', 'conversa_bloqueada', 'bloqueada não recebe ligação');
select is(public.wa_ligacao_estado(pg_temp.id('blq')) ->> 'suprimida', 'true', 'e o botão não aparece');
select pg_temp.sair();

-- Uma por pessoa, mesmo em conversas diferentes.
select pg_temp.conversa('d', '+5584999911806');
select pg_temp.respondeu('+5584999911806', 'accept', true, null);
select pg_temp.gestor();
select pg_temp.guardar('ch5', (public.wa_chamada_abrir(pg_temp.id('c')) ->> 'chamada_id')::uuid);
select is(public.wa_chamada_abrir(pg_temp.id('d')) ->> 'motivo', 'voce_ja_esta_em_ligacao', 'uma ligação por pessoa');
select is(public.wa_permissao_pedir(pg_temp.id('d'), 'Posso?') ->> 'motivo', 'ja_permitida', 'com a permanente não há o que pedir');
select pg_temp.sair();

-- Quatro sem resposta: a Meta tira a permissão.
select pg_temp.respondeu('+5584999911806', 'reject', false, null, 'automatic');
select is((select origem from public.wa_permissoes_de_ligar where conversation_id = pg_temp.id('d')), 'automatica', 'a Meta tirou: fica dito que não foi o cliente');

-- =====================================================================
-- 8. Órfãs
-- =====================================================================
update public.wa_chamadas set tocou_em = now() - interval '10 minutes' where id = pg_temp.id('ch5');
select is(app.wa_chamadas_fechar_orfas() >= 1, true, 'a ligação de que a Meta não avisou o fim é fechada');
select is((select estado from public.wa_chamadas where id = pg_temp.id('ch5')), 'falhou', 'como falha');
select pg_temp.respondeu('+5584999911806', 'accept', true, null);
select pg_temp.gestor();
select is(public.wa_chamada_abrir(pg_temp.id('d')) ->> 'ok', 'true', 'e não prende mais a pessoa');
select pg_temp.sair();

-- =====================================================================
-- 9. A Twilio não muda
-- =====================================================================
select is((select count(*) from public.voice_calls), (select voz from t118_antes), 'nada entrou em voice_calls');

select * from finish();
rollback;

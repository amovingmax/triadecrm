-- =====================================================================
-- pgTAP — Fase 3: automações do atendimento (migração 20260922120000)
--
--   1. DISTRIBUIÇÃO: conversa nova de número sem dono cai com quem tem menos
--      conversas abertas no setor; parceiro com dono continua com o dono; o
--      menu automático leva a conversa a alguém do setor escolhido.
--   2. FORA DO HORÁRIO: responde uma vez, só fora do horário, nunca por cima do
--      menu, nunca para quem pediu para sair; desligada, não responde.
--   3. RESPOSTAS PRONTAS: nascem três; só gestor cadastra.
--   4. CONFIGURAR: só gestor; o texto da ausência muda o modelo.
--   5. VIRAR TAREFA: a mensagem vira tarefa minha, para o próximo dia útil.
-- =====================================================================
begin;
select plan(17);

create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.p(p_n text) returns uuid language sql as $$
  select ('a0000000-0000-4000-8000-0000000061' || p_n)::uuid
$$;
create function pg_temp.conv(p_tel text) returns public.conversations
language sql security definer set search_path = '' as $$
  select * from public.conversations where peer_phone_e164 = p_tel
$$;
create function pg_temp.ausencias(p_tel text) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.message_templates t on t.id = m.template_id
   where c.peer_phone_e164 = p_tel and t.template_code = 'GEN-SYS-AUSENCIA'
$$;
create function pg_temp.chega(p_wamid text, p_tel text, p_texto text) returns void language plpgsql as $$
begin
  perform pg_temp.worker();
  perform public.wa_entrada_registrar(p_wamid, '+5584999996100', p_tel, 'text', p_texto);
  perform pg_temp.sair();
end $$;
-- O relógio do horário, controlado pelo teste.
create table pg_temp.relogio (aberto boolean);
insert into pg_temp.relogio values (false);
create or replace function app.janela_do_canal(p_channel app.channel, p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', (select aberto from pg_temp.relogio), 'motivo', 'fora_do_horario',
                            'abre_em', now() + interval '10 hours', 'fecha_em', null)
$$;

insert into public.allowed_users (email, role, note) values
  ('h61.a@teste.local', 'sdr', 'pgTAP fase 3'), ('h61.b@teste.local', 'sdr', 'pgTAP fase 3'),
  ('h61.f@teste.local', 'sdr', 'pgTAP fase 3'), ('h61.g@teste.local', 'gestor', 'pgTAP fase 3');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.p('01'), 'h61.a@teste.local', '{"full_name":"Ana"}'),
  (pg_temp.p('02'), 'h61.b@teste.local', '{"full_name":"Bia"}'),
  (pg_temp.p('03'), 'h61.f@teste.local', '{"full_name":"Fabi Financeiro"}'),
  (pg_temp.p('04'), 'h61.g@teste.local', '{"full_name":"Gil Gestor"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999996100"') where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"distribuicao_automatica": true, "ausencia_ativa": true, "lead_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings
   set value = jsonb_build_object('ativo', false, 'opcoes', jsonb_build_array(
                 jsonb_build_object('chave', '3', 'intencao', 'financeiro', 'modelo', 'GEN-SYS-MENU-3')))
 where key = 'whatsapp.bot_de_entrada';

delete from public.setor_membros;
insert into public.setor_membros (setor_id, profile_id) values
  ((select id from public.setores where slug = 'comercial'), pg_temp.p('01')),
  ((select id from public.setores where slug = 'comercial'), pg_temp.p('02')),
  ((select id from public.setores where slug = 'financeiro'), pg_temp.p('03'));
-- A Ana já tem uma conversa aberta; a Bia, nenhuma.
insert into public.conversations (channel, business_number, peer_phone_e164, assignee_id, status)
values ('whatsapp', '+5584999996100', '+5584999996190', pg_temp.p('01'), 'aguardando_nos');

-- =====================================================================
-- 1. Distribuição
-- =====================================================================
select pg_temp.chega('wamid.h61.1', '+5584999996101', 'Oi');
select is((pg_temp.conv('+5584999996101')).assignee_id, pg_temp.p('02'),
  'número novo cai com quem tem menos conversas abertas no setor (a Bia, com zero)');

insert into public.organizations (id, name, phone_e164, source_id, owner_id)
values ('c0000000-0000-4000-8000-000000006102', 'H61 Buffet da Ana', '+5584999996102',
        (select id from public.sources where slug = 'planilha'), pg_temp.p('01'));
select pg_temp.chega('wamid.h61.2', '+5584999996102', 'Oi, sou eu de novo');
select is((pg_temp.conv('+5584999996102')).assignee_id, pg_temp.p('01'),
  'parceiro com dono continua com o dono');

update public.conversations set bot_opcao = '3' where peer_phone_e164 = '+5584999996101';
select is((pg_temp.conv('+5584999996101')).assignee_id, pg_temp.p('03'),
  'o menu manda para o Financeiro, e a conversa vai para alguém do Financeiro');

update public.app_settings set value = value || '{"distribuicao_automatica": false}'::jsonb where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{profile_id}', to_jsonb(pg_temp.p('01')::text), true)
 where key = 'inbox.responsavel_padrao';
select pg_temp.chega('wamid.h61.3', '+5584999996103', 'Oi');
select isnt((pg_temp.conv('+5584999996103')).assignee_id, pg_temp.p('02'),
  'com a distribuição desligada, vale o dono padrão de sempre');
update public.app_settings set value = value || '{"distribuicao_automatica": true}'::jsonb where key = 'atendimento';

-- =====================================================================
-- 2. Fora do horário
-- =====================================================================
select is(pg_temp.ausencias('+5584999996101'), 1, 'quem escreve fora do horário recebe o aviso');
select pg_temp.chega('wamid.h61.4', '+5584999996101', 'Alô?');
select is(pg_temp.ausencias('+5584999996101'), 1, 'e só uma vez a cada 12 h, por mais que escreva');

update pg_temp.relogio set aberto = true;
select pg_temp.chega('wamid.h61.5', '+5584999996105', 'Bom dia');
select is(pg_temp.ausencias('+5584999996105'), 0, 'dentro do horário, nada de aviso');
update pg_temp.relogio set aberto = false;

update public.app_settings set value = jsonb_set(value, '{ativo}', 'true') where key = 'whatsapp.bot_de_entrada';
select pg_temp.chega('wamid.h61.6', '+5584999996106', 'Oi, boa noite');
select is(pg_temp.ausencias('+5584999996106'), 0, 'com o menu automático respondendo, o aviso não vai por cima');
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false') where key = 'whatsapp.bot_de_entrada';

select pg_temp.chega('wamid.h61.7', '+5584999996107', 'SAIR');
select is(pg_temp.ausencias('+5584999996107'), 0, 'quem pede para sair não recebe aviso');

update public.app_settings set value = value || '{"ausencia_ativa": false}'::jsonb where key = 'atendimento';
select pg_temp.chega('wamid.h61.8', '+5584999996108', 'Oi');
select is(pg_temp.ausencias('+5584999996108'), 0, 'desligada em Ajustes, não responde');

-- =====================================================================
-- 3. Respostas prontas e 4. configurar
-- =====================================================================
select is((select count(*)::int from public.respostas_rapidas where atalho in ('custo', 'cadastro', 'horario')),
  3, 'nascem três respostas prontas');

select pg_temp.entrar(pg_temp.p('01'), 'sdr');
select throws_ok($$ insert into public.respostas_rapidas (atalho, titulo, texto) values ('x1', 'Teste', 'oi') $$,
  '42501', NULL, 'SDR usa, mas não cadastra resposta pronta');
select is(public.atendimento_configurar('{"ausencia_ativa": true}') ->> 'motivo', 'sem_permissao',
  'SDR não mexe nas automações');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.p('04'), 'gestor');
select is(public.atendimento_configurar(
  '{"ausencia_ativa": true, "texto_ausencia": "Voltamos amanhã às 8h."}') ->> 'ok', 'true',
  'gestor liga a ausência e muda o texto');
select pg_temp.sair();
select is((select body from public.message_templates where template_code = 'GEN-SYS-AUSENCIA'),
  'Voltamos amanhã às 8h.', 'o texto novo é o que sai');

-- =====================================================================
-- 5. Virar tarefa
-- =====================================================================
select pg_temp.entrar(pg_temp.p('03'), 'sdr');
select is(public.virar_tarefa((select m.id from public.messages m
                                 join public.conversations c on c.id = m.conversation_id
                                where c.peer_phone_e164 = '+5584999996101' and m.direction = 'in'
                                order by m.created_at limit 1)) ->> 'titulo',
  'Oi', 'a mensagem vira tarefa, com o texto dela no título');
select pg_temp.sair();
select ok(exists (select 1 from public.tasks where assignee_id = pg_temp.p('03') and title = 'Oi'
                   and due_at > now()),
  'a tarefa é de quem clicou, com prazo no próximo dia útil');

select * from finish();
rollback;

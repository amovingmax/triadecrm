-- =====================================================================
-- pgTAP — O bot de entrada do WhatsApp (migração 20260916110000)
--
-- O que este arquivo prova:
--   1. Quem escreve primeiro recebe o menu, uma vez só.
--   2. A escolha (número ou palavra) responde, marca a intenção e abre tarefa.
--   3. Quem escreve outra coisa NÃO recebe resposta automática: é gente.
--   4. Conversa que nós começamos não vira robô no meio do assunto.
--   5. Quem pede para sair recebe o opt-out, nunca um menu.
--   6. O bot fala no máximo duas vezes por conversa.
--   7. Só gestor liga e desliga.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(19);

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
create function pg_temp.fala(p_peer text) returns text language sql security definer set search_path = '' as $$
  select string_agg(m.direction::text || ':' || m.author_kind || ':' || left(coalesce(m.body, ''), 18),
                    ' | ' order by m.created_at, m.id)
    from public.messages m join public.conversations c on c.id = m.conversation_id
   where c.peer_phone_e164 = p_peer
$$;
create function pg_temp.estado(p_peer text) returns text language sql security definer set search_path = '' as $$
  select coalesce(bot_estado, '-') || '/' || coalesce(bot_opcao, '-') || '/' || coalesce(ai_intent, '-')
    from public.conversations where peer_phone_e164 = p_peer
$$;
create function pg_temp.n_saidas(p_peer text) returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.messages m join public.conversations c on c.id = m.conversation_id
   where c.peer_phone_e164 = p_peer and m.direction = 'out'::app.msg_direction
$$;
create function pg_temp.n_tarefas() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.tasks where title like '%WhatsApp%' or title like '%evento%'
$$;

-- Gente: a conversa precisa de dono ativo (RF-CON-04).
insert into public.allowed_users (email, role, note) values
  ('b47.sdr@teste.local', 'sdr', 'pgTAP bot'),
  ('b47.leitura@teste.local', 'leitura', 'pgTAP bot');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-00000000b471', 'b47.sdr@teste.local', '{"full_name":"Sdr B47"}'),
  ('a0000000-0000-4000-8000-00000000b472', 'b47.leitura@teste.local', '{"full_name":"Leitura B47"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999994700"')
 where key = 'whatsapp.envio';


-- =====================================================================
-- 1 e 2 · o menu e a escolha por número
-- =====================================================================
set role service_role;
select public.wa_entrada_registrar('wamid.B47.1', '+5584999994700', '+5584988884701', 'text', 'Oi, boa tarde');
select public.wa_entrada_registrar('wamid.B47.2', '+5584999994700', '+5584988884701', 'text', '3');
reset role;

select ok(pg_temp.fala('+5584988884701') like '%out:bot_fixed:Oi! Aqui é a Ko%',
  'quem escreve primeiro recebe o menu');
select ok(pg_temp.fala('+5584988884701') like '%out:bot_fixed:Certo, isso é co%',
  'a opção 3 responde com o texto do financeiro');
select is(pg_temp.estado('+5584988884701'), 'escolhido/3/financeiro',
  'a escolha fica gravada na conversa');
select ok(pg_temp.n_tarefas() >= 1, 'e abre tarefa para o time');

-- 6 · o bot não fala uma terceira vez
set role service_role;
select public.wa_entrada_registrar('wamid.B47.3', '+5584999994700', '+5584988884701', 'text', '1');
reset role;
select is(pg_temp.n_saidas('+5584988884701'), 2, 'o bot fala no máximo duas vezes por conversa');


-- =====================================================================
-- 2b · a escolha por palavra, em frase curta
-- =====================================================================
set role service_role;
select public.wa_entrada_registrar('wamid.B47.4', '+5584999994700', '+5584988884702', 'text', 'oi');
select public.wa_entrada_registrar('wamid.B47.5', '+5584999994700', '+5584988884702', 'text', 'sou fornecedor de som');
reset role;
select is(pg_temp.estado('+5584988884702'), 'escolhido/1/parceria',
  'frase curta com a palavra da opção também escolhe');
select ok(pg_temp.fala('+5584988884702') like '%out:bot_fixed:Boa! Estar na Ko%',
  'e recebe a resposta de fornecedor');


-- =====================================================================
-- 3 · quem escreve outra coisa não recebe robô
-- =====================================================================
set role service_role;
select public.wa_entrada_registrar('wamid.B47.6', '+5584999994700', '+5584988884703', 'text', 'Bom dia');
select public.wa_entrada_registrar('wamid.B47.7', '+5584999994700', '+5584988884703', 'text',
  'Preciso de um buffet para 200 pessoas no dia 12 de dezembro, vocês atendem em Parnamirim?');
reset role;
select is(pg_temp.estado('+5584988884703'), 'sem_escolha/-/-',
  'pergunta de verdade não é escolha de menu');
select is(pg_temp.n_saidas('+5584988884703'), 1,
  'e o robô não responde de novo: quem responde é gente');


-- =====================================================================
-- 5 · quem pede para sair não recebe menu
-- =====================================================================
set role service_role;
select public.wa_entrada_registrar('wamid.B47.8', '+5584999994700', '+5584988884704', 'text', 'SAIR');
reset role;
select is(pg_temp.n_saidas('+5584988884704'), 0, 'pedido de saída não recebe menu');
select is(pg_temp.estado('+5584988884704'), '-/-/-', 'e a conversa nem entra no bot');
select ok(app.wa_parece_optout('SAIR'), 'wa_parece_optout: a palavra sozinha é pedido');
select ok(app.wa_parece_optout('por favor me tira da lista de vocês'),
  'wa_parece_optout: a frase inequívoca no meio do texto também');
select ok(not app.wa_parece_optout('vou sair do escritório e te ligo'),
  'mas "sair do escritório" no meio de uma frase não é');
select ok(not app.wa_parece_optout('consigo para quinta às 9h30'),
  'e "para quinta" continua sendo preposição, não imperativo');


-- =====================================================================
-- 4 · conversa que nós começamos
-- =====================================================================
insert into public.organizations (id, name, phone_e164, source_id) values
  ('c0000000-0000-4000-8000-00000000b471', 'B47 Buffet', '+5584988884705',
   (select id from public.sources where slug = 'planilha'));
update public.message_templates set meta_status = 'approved', meta_template_name = 'aeb_abr_a_v1'
 where template_code = 'AEB-ABR-A';
update public.app_settings set value = jsonb_set(value, '{inicio}', '"2026-09-04"') where key = 'cadencia.tetos';
create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                            'fecha_em', now() + interval '4 hours')
$$;

select pg_temp.entrar('a0000000-0000-4000-8000-00000000b471', 'sdr');
select ok((public.wa_enviar_modelo('c0000000-0000-4000-8000-00000000b471',
             (select id from public.message_templates where template_code = 'AEB-ABR-A'),
             '{"nome":"Ana","empresa":"B47 Buffet","origem":"planilha","detalhe":"o bolo"}') ->> 'ok')::boolean,
  'nós começamos a conversa');
select pg_temp.sair();

set role service_role;
select public.wa_entrada_registrar('wamid.B47.9', '+5584999994700', '+5584988884705', 'text', 'oi');
reset role;
select is(pg_temp.estado('+5584988884705'), 'conversa_humana/-/-',
  'conversa que nós começamos não vira robô no meio do assunto');
select is(pg_temp.n_saidas('+5584988884705'), 1, 'e nada automático sai nela');


-- =====================================================================
-- 7 · quem liga e desliga
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-00000000b472', 'leitura');
select throws_ok($$ select public.wa_bot_ligar(false) $$, '42501', NULL,
  'quem só lê não desliga o bot');
select pg_temp.sair();

select * from finish();
rollback;

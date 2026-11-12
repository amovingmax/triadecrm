-- =====================================================================
-- pgTAP — O aviso por e-mail só quando as mensagens acumulam
-- (migração 20261111100000)
--
-- Pedido de 11/11/2026: "precisamos tirar os avisos de mensagem por email,
-- coloque aviso no email agora, quando tiver mais de 30 novas mensagens".
-- Este arquivo prova:
--
--   1. NOVA É A REGRA DA MARCA "Nova": conta o que chegou depois da última
--      resposta do time; resposta de gente zera, a que falhou não;
--      reação, conversa concluída e o que chegou antes do último aviso não
--      contam;
--   2. "MAIS DE" É MAIS DE: com o limite em 5, cinco mensagens não mandam e
--      seis mandam; o limite vem de notificacoes.email.mais_de_mensagens e,
--      sem número válido, é 30;
--   3. O TELEFONE INTEIRO NÃO SAI: a lista leva só os quatro últimos dígitos;
--   4. A CONTA RECOMEÇA A CADA AVISO, e o marco nunca volta para trás;
--   5. SÓ O WORKER: quem entra pela tela não executa as funções nem escreve
--      na tabela, e só a gestão lê os avisos mandados.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(20);

insert into public.allowed_users (email, role, note) values
  ('h144.g@teste.local', 'gestor', 'pgTAP 144'),
  ('h144.l@teste.local', 'leitura', 'pgTAP 144');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000014401'::uuid, 'h144.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000014402'::uuid, 'h144.l@teste.local', '{"full_name":"Leo Leitura"}');

-- Nada de resposta automática no meio da conta.
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

-- O marco de partida desta prova: dez minutos atrás.
delete from public.avisos_de_acumulo;
insert into public.avisos_de_acumulo (ate, mensagens, conversas)
values (now() - interval '10 minutes', 0, 0);

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

create function pg_temp.conversa(p_tel text, p_nome text, p_org uuid default null)
returns uuid language sql as $$
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome,
                                    organization_id, status)
  values ('whatsapp'::app.channel, '+5584999999900', p_tel, p_nome, p_org, 'aguardando_nos')
  returning id
$$;
create function pg_temp.chegou(p_conv uuid, p_texto text, p_minutos int, p_reage_a uuid default null)
returns uuid language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind,
                               origin, created_at, reage_a)
  values (p_conv, 'in', 'text', 'received', p_texto, 'system', 'crm',
          now() - make_interval(mins => p_minutos), p_reage_a)
  returning id
$$;
create function pg_temp.saiu(p_conv uuid, p_minutos int, p_status text default 'sent')
returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind,
                               sent_by, origin, created_at, error_code)
  values (p_conv, 'out', 'text', p_status::app.msg_status, 'Resposta', 'human',
          'a0000000-0000-4000-8000-000000014401'::uuid,
          'crm', now() - make_interval(mins => p_minutos),
          case when p_status = 'failed' then '131026' end)
$$;
create function pg_temp.conta() returns jsonb language sql as $$
  select public.aviso_de_acumulo_conferir()
$$;

create temp table t144(chave text primary key, valor uuid);

do $$
declare
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_org uuid; v_msg uuid;
begin
  -- A · cliente sem ficha: duas antes do marco (já avisadas), três depois e
  --     uma reação, que não é mensagem nova.
  v_a := pg_temp.conversa('+5584999914401', 'Renata Souza');
  perform pg_temp.chegou(v_a, 'Antiga 1', 20);
  perform pg_temp.chegou(v_a, 'Antiga 2', 19);
  v_msg := pg_temp.chegou(v_a, 'Oi', 5);
  perform pg_temp.chegou(v_a, 'Tem horário amanhã?', 4);
  perform pg_temp.chegou(v_a, 'Preciso de um orçamento', 3);
  perform pg_temp.chegou(v_a, '👍', 2, v_msg);

  -- B · parceiro com ficha: duas respondidas por gente, uma depois da resposta.
  insert into public.organizations (kind, name, phone_e164, source_id, collector)
  select 'fornecedor', 'Buffet Sabor 144', '+5584999914402', s.id, 'pgTAP'
    from public.sources s order by s.id limit 1
  returning id into v_org;
  v_b := pg_temp.conversa('+5584999914402', 'Buffet', v_org);
  perform pg_temp.chegou(v_b, 'Bom dia', 6);
  perform pg_temp.chegou(v_b, 'Quero saber mais', 5);
  perform pg_temp.saiu(v_b, 4);
  perform pg_temp.chegou(v_b, 'Obrigado!', 1);

  -- C · a resposta falhou: ninguém foi respondido.
  v_c := pg_temp.conversa('+5584999914403', 'Carla');
  perform pg_temp.chegou(v_c, 'Vocês atendem em Parnamirim?', 4);
  perform pg_temp.saiu(v_c, 3, 'failed');

  -- D · concluída depois da mensagem: o time tratou, não conta.
  v_d := pg_temp.conversa('+5584999914404', 'Dora');
  perform pg_temp.chegou(v_d, 'Era só isso', 4);
  update public.conversations set arquivada_em = now() where id = v_d;

  insert into t144 values ('a', v_a), ('b', v_b), ('c', v_c), ('d', v_d);
end $$;

-- ---------------------------------------------------------------------
-- 1 · O que conta
-- ---------------------------------------------------------------------
select is((pg_temp.conta() ->> 'mensagens')::int, 5,
  'CONTA O QUE ESPERA RESPOSTA: 3 da Renata + 1 depois da resposta no Buffet + 1 cuja resposta falhou');
select is((pg_temp.conta() ->> 'conversas')::int, 3,
  'TRÊS CONVERSAS: a concluída fica de fora');
select is((pg_temp.conta() ->> 'limite')::int, 30,
  'O LIMITE DA MIGRAÇÃO É 30');
select is((pg_temp.conta() ->> 'mandar')::boolean, false,
  'CINCO NÃO PASSAM DE 30: nenhum e-mail');

-- ---------------------------------------------------------------------
-- 2 · "Mais de" é mais de
-- ---------------------------------------------------------------------
update public.app_settings set value = value || '{"mais_de_mensagens": 5}'::jsonb
 where key = 'notificacoes.email';
select is((pg_temp.conta() ->> 'mandar')::boolean, false,
  'MAIS DE 5: cinco mensagens ainda não mandam');
select pg_temp.chegou((select valor from t144 where chave = 'c'), 'Alô?', 1);
select is((pg_temp.conta() ->> 'mandar')::boolean, true,
  'MAIS DE 5: a sexta manda');

update public.app_settings set value = value || '{"mais_de_mensagens": "trinta"}'::jsonb
 where key = 'notificacoes.email';
select is((pg_temp.conta() ->> 'limite')::int, 30,
  'SEM NÚMERO VÁLIDO, O LIMITE É 30');
update public.app_settings set value = value || '{"mais_de_mensagens": 5}'::jsonb
 where key = 'notificacoes.email';

-- ---------------------------------------------------------------------
-- 3 · A lista do e-mail
-- ---------------------------------------------------------------------
select is(pg_temp.conta() -> 'lista' -> 0 ->> 'conversation_id',
          (select valor::text from t144 where chave = 'a'),
  'A LISTA COMEÇA PELA CONVERSA COM MAIS MENSAGENS ESPERANDO');
select is(pg_temp.conta() -> 'lista' -> 0 ->> 'ultima', 'Preciso de um orçamento',
  'A ÚLTIMA MENSAGEM É A ÚLTIMA ESCRITA, NÃO A REAÇÃO');
select is((select l ->> 'nome' from jsonb_array_elements(pg_temp.conta() -> 'lista') l
            where l ->> 'conversation_id' = (select valor::text from t144 where chave = 'b')),
          'Buffet Sabor 144',
  'COM FICHA, VALE O NOME DA FICHA');
select is(pg_temp.conta() -> 'lista' -> 0 ->> 'final_do_numero', '4401',
  'DO NÚMERO, SÓ OS QUATRO ÚLTIMOS DÍGITOS');
select ok(position('999914401' in pg_temp.conta()::text) = 0,
  'O TELEFONE INTEIRO NÃO SAI DO BANCO (RF-BAS-14)');

-- ---------------------------------------------------------------------
-- 4 · A conta recomeça a cada aviso
-- ---------------------------------------------------------------------
create temp table t144_ate as select (pg_temp.conta() ->> 'ate')::timestamptz as ate;
select public.aviso_de_acumulo_registrar((select ate from t144_ate), 6, 3);
select is((pg_temp.conta() ->> 'mensagens')::int, 0,
  'DEPOIS DO AVISO, A CONTA RECOMEÇA DO ZERO');
select pg_temp.chegou((select valor from t144 where chave = 'a'), 'Alguém aí?', 0);
select is((pg_temp.conta() ->> 'mensagens')::int, 1,
  'E SÓ O QUE CHEGOU DEPOIS ENTRA NA PRÓXIMA');
select public.aviso_de_acumulo_registrar(now() - interval '1 hour', 1, 1);
select is((select max(ate) from public.avisos_de_acumulo), (select ate from t144_ate),
  'O MARCO NUNCA VOLTA PARA TRÁS');
select throws_ok($$ select public.aviso_de_acumulo_registrar(null, 1, 1) $$, '22004', null,
  'SEM "ate" NÃO HÁ REGISTRO');

-- ---------------------------------------------------------------------
-- 5 · Só o worker
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.aviso_de_acumulo_conferir()', 'execute')
          and not has_function_privilege('authenticated',
                    'public.aviso_de_acumulo_registrar(timestamptz, int, int)', 'execute')
          and has_function_privilege('service_role', 'public.aviso_de_acumulo_conferir()', 'execute'),
  'SÓ A CHAVE DE SERVIÇO EXECUTA AS DUAS FUNÇÕES');

select pg_temp.entrar('a0000000-0000-4000-8000-000000014401'::uuid, 'gestor');
select ok((select count(*) from public.avisos_de_acumulo) >= 2,
  'A GESTÃO LÊ OS AVISOS MANDADOS');
select throws_ok($$ insert into public.avisos_de_acumulo (ate, mensagens, conversas)
                    values (now() + interval '1 day', 0, 0) $$,
  '42501', null,
  'NEM A GESTÃO ESCREVE: empurrar o marco calaria o próximo aviso');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000014402'::uuid, 'leitura');
select is((select count(*)::int from public.avisos_de_acumulo), 0,
  'QUEM NÃO É DA GESTÃO NÃO LÊ');
select pg_temp.sair();

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — O lembrete da visita na véspera, com "Confirmo" e "Preciso
-- remarcar" (migração 20261111206000), só na Imova
--
-- Pedido de 11/11/2026: "Mandar um lembrete pelo WhatsApp na véspera, com
-- botões 'Confirmo' e 'Preciso remarcar'. Isso reduz o cliente que não
-- aparece." Este arquivo prova:
--
--   1. O MODELO entra inativo, UTILITY, pt_BR, com as quatro variáveis e os
--      dois botões de resposta rápida, no formato que a Meta aceita; só vai
--      para a sincronização da Meta depois de ativado; os ajustes nascem
--      desligados; o job do pg_cron existe;
--   2. OS BOTÕES NÃO SÃO OPT-OUT ("Confirmo" e "Preciso remarcar" não casam a
--      regra; "Cancelar" casa), e a rodada recusa modelo com botão de saída;
--   3. O DIA DO ENVIO: a véspera; a visita de segunda sai no sábado para quem
--      o sábado vale e na sexta para os outros; nunca domingo nem feriado;
--   4. OS AJUSTES: só admin e gestor mudam; hora e chave inválidas recusadas;
--   5. DESLIGADO, MODELO INATIVO E MODELO NÃO APROVADO não mandam nada; antes
--      da hora, domingo e feriado também não;
--   6. QUEM RECEBE: a visita manual, a do Calendly (com o endereço que o
--      cliente escreveu) e a reunião presencial; QUEM NÃO: a "a marcar", a
--      cancelada, a on-line, a "a confirmar", a do suprimido, a sem
--      telefone e a da conversa bloqueada (estas três com o motivo);
--   7. A MENSAGEM é o modelo na fila, como robô, com as variáveis preenchidas;
--   8. UMA VEZ SÓ, e de novo quando a visita é remarcada;
--   9. A SEGUNDA-FEIRA: sai na sexta para quem não respondeu e no sábado para
--      quem respondeu;
--  10. "CONFIRMO": grava, responde, a IA fica calada e continua atendendo;
--  11. "PRECISO REMARCAR": grava, cria a tarefa do responsável, responde, a IA
--      cala e para; tocar de novo não duplica; texto livre e conversa sem
--      lembrete não contam; ninguém foi suprimido;
--  12. O PAINEL e quem lê o lembrete;
--  13. A KOMUNE: a rodada e a leitura do botão não fazem nada lá;
--  14. OS PRIVILÉGIOS.
--
-- A porteira (`messages_guard` → `app.pode_enviar`) roda no instante REAL, e
-- não no `p_agora` que este arquivo passa à rodada: por isso cada conversa que
-- deve receber o lembrete tem uma mensagem recebida, que abre a janela de 24 h
-- de verdade. O que este arquivo prova da porteira é que o lembrete passa por
-- ela (o lembrete é uma linha em `messages`); as regras da porteira têm os
-- arquivos delas.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(114);

insert into public.allowed_users (email, role, note) values
  ('a156.g@teste.local', 'gestor', 'pgTAP lembrete de visita'),
  ('a156.s@teste.local', 'sdr', 'pgTAP lembrete de visita');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000015601'::uuid, 'a156.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000015602'::uuid, 'a156.s@teste.local', '{"full_name":"Sol Corretora"}');

create function pg_temp.gestor() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000015601'::uuid $$;
create function pg_temp.sdr() returns uuid language sql as
  $$ select 'a0000000-0000-4000-8000-000000015602'::uuid $$;

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

-- ---------- o ambiente ----------
select pg_temp.virar('imova');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999915600"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

-- A janela do WhatsApp da Imova, escrita aqui para o arquivo não depender do
-- banco: seg–sex 8h–17h45 para todos, sábado 10h–12h só para quem já respondeu.
delete from public.channel_windows where channel = 'whatsapp'::app.channel;
insert into public.channel_windows (channel, dow, position, de, ate, requires_reply, note)
select 'whatsapp'::app.channel, d, 1, 8.00, 17.75, false, 'pgTAP 156' from generate_series(1, 5) d
union all
select 'whatsapp'::app.channel, 6, 1, 10.00, 12.00, true, 'pgTAP 156 — sábado só de quem respondeu';
-- Uma segunda-feira de feriado.
insert into public.holidays (date, name, scope) values ('2027-03-15', 'Feriado do pgTAP 156', 'municipal')
on conflict (date, scope) do nothing;

create function pg_temp.fonte() returns int language sql stable as
  $$ select id from public.sources where slug = 'planilha' $$;

-- Um cliente: ficha e, com telefone, a conversa com uma mensagem RECEBIDA agora
-- (a janela de 24 h aberta de verdade, ver o cabeçalho).
create temp table t156 (chave text primary key, org uuid, conv uuid, task uuid, reuniao uuid);
grant select on t156 to authenticated;
create function pg_temp.cliente(p_chave text, p_nome text, p_tel text) returns uuid language plpgsql as $$
declare v_org uuid; v_conv uuid;
begin
  insert into public.organizations (name, phone_e164, source_id, collector)
  values (p_nome, p_tel, pg_temp.fonte(), 'pgtap156') returning id into v_org;
  if p_tel is not null then
    insert into public.conversations (channel, business_number, peer_phone_e164, organization_id)
    values ('whatsapp'::app.channel, '+5584999915600', p_tel, v_org) returning id into v_conv;
    insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
    values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
            'oi', 'system', 'crm');
  end if;
  insert into t156 (chave, org, conv) values (p_chave, v_org, v_conv);
  return v_org;
end $$;
create function pg_temp.org(p text) returns uuid language sql stable as $$ select org from t156 where chave = p $$;
create function pg_temp.conv(p text) returns uuid language sql stable as $$ select conv from t156 where chave = p $$;
create function pg_temp.task(p text) returns uuid language sql stable as $$ select task from t156 where chave = p $$;

create function pg_temp.visita(p_chave text, p_quando timestamptz, p_origem text, p_status text)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.tasks (title, kind, status, priority, due_at, assignee_id, organization_id, origin)
  values ('Visita: ' || p_chave, 'visit'::app.task_kind, p_status::app.task_status, 2, p_quando,
          pg_temp.sdr(), pg_temp.org(p_chave), p_origem)
  returning id into v;
  update t156 set task = v where chave = p_chave;
  return v;
end $$;
create function pg_temp.reuniao(p_chave text, p_quando timestamptz, p_formato text, p_estado text)
returns uuid language plpgsql as $$
declare v_task uuid; v_r uuid;
begin
  insert into public.tasks (title, kind, status, priority, due_at, assignee_id, organization_id, origin)
  values ('Reunião com ' || p_chave, 'meeting'::app.task_kind, 'todo'::app.task_status, 2, p_quando,
          pg_temp.sdr(), pg_temp.org(p_chave), 'manual')
  returning id into v_task;
  insert into public.reunioes (organization_id, conversation_id, dono_id, titulo, formato, inicio, fim,
                               link, local, estado, marcada_por, marcada_por_id, task_id)
  values (pg_temp.org(p_chave), pg_temp.conv(p_chave), pg_temp.sdr(), 'Reunião com ' || p_chave,
          p_formato, p_quando, p_quando + interval '40 minutes',
          case when p_formato = 'online' then 'https://meet.google.com/abc-defg-hij' end,
          case when p_formato = 'presencial' then 'Rua Potengi, 500 · Petrópolis' end,
          p_estado, 'pessoa', pg_temp.gestor(), v_task)
  returning id into v_r;
  update t156 set task = v_task, reuniao = v_r where chave = p_chave;
  return v_r;
end $$;

create function pg_temp.lembretes(p text) returns bigint language sql stable as
  $$ select count(*) from public.visita_lembretes where task_id = pg_temp.task(p) $$;
create function pg_temp.lembrete(p text) returns public.visita_lembretes language sql stable as $$
  select * from public.visita_lembretes where task_id = pg_temp.task(p)
   order by criado_em desc, marcada_para desc limit 1
$$;
create function pg_temp.msg_do_lembrete(p text) returns public.messages language sql stable as $$
  select m.* from public.messages m where m.id = (pg_temp.lembrete(p)).message_id
$$;
create function pg_temp.chega(p_chave text, p_texto text, p_tipo text default 'interactive')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (pg_temp.conv(p_chave), 'in'::app.msg_direction, p_tipo::app.msg_type,
          'received'::app.msg_status, p_texto, 'system', 'crm')
  returning id into v;
  return v;
end $$;
create function pg_temp.saidas(p_chave text, p_codigo text) returns bigint language sql stable as $$
  select count(*) from public.messages m join public.message_templates t on t.id = m.template_id
   where m.conversation_id = pg_temp.conv(p_chave) and m.direction = 'out'::app.msg_direction
     and t.template_code = p_codigo
$$;
create function pg_temp.modelo() returns public.message_templates language sql stable as
  $$ select * from public.message_templates where template_code = 'IMV-VIS-LEMBRETE' $$;

-- Os instantes, em Natal. 04/03/2027 é quinta; 05 sexta; 06 sábado; 07
-- domingo; 08 segunda; 15 segunda de feriado (acima).
create function pg_temp.em(p text) returns timestamptz language sql immutable as
  $$ select (p || '-03')::timestamptz $$;

-- =====================================================================
-- 1. O modelo, os ajustes e o job
-- =====================================================================
select is((pg_temp.modelo()).category, 'utility', 'o modelo do lembrete é UTILITY');
select is((pg_temp.modelo()).language, 'pt_BR', 'em pt_BR');
select ok(not (pg_temp.modelo()).is_active, 'e entra INATIVO até alguém pedir a aprovação');
select ok((pg_temp.modelo()).meta_status is null, 'sem situação na Meta');
select is(app.modelo_variaveis((pg_temp.modelo()).body), array['nome', 'dia', 'hora', 'local'],
  'as variáveis são nome, dia, hora e local, nessa ordem');
select is((pg_temp.modelo()).botoes,
  '[{"tipo": "resposta", "texto": "Confirmo"}, {"tipo": "resposta", "texto": "Preciso remarcar"}]'::jsonb,
  'os botões de resposta rápida "Confirmo" e "Preciso remarcar"');
select is(app.modelo_corpo_invalido((pg_temp.modelo()).body), null,
  'o corpo passa nas regras que a Meta recusa de certeza (variável na borda, coladas)');
select ok(not exists (select 1 from jsonb_array_elements(public.wa_modelos_para_meta()) e
                       where e ->> 'codigo' = 'IMV-VIS-LEMBRETE'),
  'inativo, a sincronização com a Meta não o manda');
select ok(exists (select 1 from public.message_templates
                   where template_code in ('IMV-VIS-CONFIRMADA', 'IMV-VIS-REMARCAR')
                     and category = 'service' and is_active
                  having count(*) = 2),
  'as duas respostas da casa existem, de serviço (dentro da janela), ativas');
select is(app.lembrete_de_visita_config(),
  '{"ligado": false, "hora": "10:00", "modelo": "IMV-VIS-LEMBRETE"}'::jsonb,
  'os ajustes nascem desligados, às 10h, com o modelo do lembrete');
select ok(exists (select 1 from cron.job where jobname = 'lembretes_de_visita'
                   and schedule = '*/5 * * * *'),
  'o job do pg_cron roda de 5 em 5 minutos');
select has_trigger('public', 'messages', 'messages_v_lembrete_de_visita',
  'o gatilho da resposta está em messages');
select ok((select relrowsecurity from pg_class where oid = 'public.visita_lembretes'::regclass),
  'visita_lembretes nasce com RLS');

-- =====================================================================
-- 2. Os botões não são opt-out
-- =====================================================================
select ok(not app.wa_parece_optout('Confirmo'), '"Confirmo" não é pedido de saída');
select ok(not app.wa_parece_optout('Preciso remarcar'), '"Preciso remarcar" não é pedido de saída');
select ok(app.wa_parece_optout('Cancelar'), 'e a regra continua pegando "Cancelar" (controle)');

-- =====================================================================
-- 3. O dia do envio
-- =====================================================================
select is(app.lembrete_dia_do_envio('2027-03-05', false, 10), '2027-03-04'::date,
  'visita na sexta: o lembrete sai na quinta');
select is(app.lembrete_dia_do_envio('2027-03-08', false, 10), '2027-03-05'::date,
  'visita na segunda, cliente que não respondeu: sai na sexta (sábado não vale para ele)');
select is(app.lembrete_dia_do_envio('2027-03-08', true, 10), '2027-03-06'::date,
  'visita na segunda, cliente que já respondeu: sai no sábado');
select is(app.lembrete_dia_do_envio('2027-03-08', true, 12.5), '2027-03-05'::date,
  'com a hora depois do fechamento de sábado (12h30), volta para a sexta');
select is(app.lembrete_dia_do_envio('2027-03-16', false, 10), '2027-03-12'::date,
  'visita na terça depois de segunda de feriado: sai na sexta');
select ok(not app.lembrete_dia_de_envio('2027-03-07', true, 10), 'domingo nunca é dia de envio');
select ok(not app.lembrete_dia_de_envio('2027-03-15', true, 10), 'feriado nunca é dia de envio');

-- =====================================================================
-- 4. Os ajustes
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is(public.lembrete_de_visita_configurar('{"ligado": true}') ->> 'motivo', 'sem_permissao',
  'o SDR não mexe nos ajustes');
select is(public.lembrete_de_visita_painel() ->> 'motivo', 'sem_permissao', 'nem lê o painel');
select is(public.lembrete_de_visita_modelo_para_a_meta() ->> 'motivo', 'sem_permissao',
  'nem manda o modelo para a Meta');
select pg_temp.sair();
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is(public.lembrete_de_visita_configurar('{"hora": "21:00"}') ->> 'motivo', 'hora_invalida',
  'hora fora das 7h às 17h é recusada');
select is(public.lembrete_de_visita_configurar('{"hora": "10h"}') ->> 'motivo', 'hora_invalida',
  'hora fora do formato é recusada');
select is(public.lembrete_de_visita_configurar('{"ligada": true}') ->> 'motivo', 'chave_desconhecida',
  'chave desconhecida é recusada (ninguém clica achando que ligou)');
select is(public.lembrete_de_visita_configurar('{"modelo": "NAO-EXISTE"}') ->> 'motivo', 'modelo_inexistente',
  'modelo que não existe é recusado');
select pg_temp.sair();

-- =====================================================================
-- 5. Desligado, modelo inativo, não aprovado, antes da hora, domingo, feriado
-- =====================================================================
-- Os clientes e as visitas de sexta, 05/03/2027.
select pg_temp.cliente('a', 'Maria Manual', '+5584981560001');
select pg_temp.visita('a', pg_temp.em('2027-03-05 14:00'), 'manual', 'todo');
select pg_temp.cliente('b', 'bruno calendly', '+5584981560002');
select pg_temp.visita('b', pg_temp.em('2027-03-05 09:30'), 'calendly', 'todo');
insert into public.calendly_agendamentos (convidado_uri, evento_uri, situacao, natureza, inicio, fim,
                                          formato, local, organization_id, task_id)
values ('https://api.calendly.com/scheduled_events/EV156/invitees/IN156',
        'https://api.calendly.com/scheduled_events/EV156', 'agendado', 'visita',
        pg_temp.em('2027-03-05 09:30'), pg_temp.em('2027-03-05 10:15'), 'presencial',
        'Rua das Algas, 120 · Ponta Negra', pg_temp.org('b'), pg_temp.task('b'));
select pg_temp.cliente('c', 'Carla Reunião', '+5584981560003');
select pg_temp.reuniao('c', pg_temp.em('2027-03-05 16:00'), 'presencial', 'marcada');
select pg_temp.cliente('d', 'Davi A Marcar', '+5584981560004');
select pg_temp.visita('d', pg_temp.em('2027-03-05 09:00'), 'system', 'todo');
select pg_temp.cliente('e', 'Eva Cancelada', '+5584981560005');
select pg_temp.visita('e', pg_temp.em('2027-03-05 11:00'), 'manual', 'cancelled');
select pg_temp.cliente('f', 'Fábio Suprimido', '+5584981560006');
select pg_temp.visita('f', pg_temp.em('2027-03-05 15:00'), 'manual', 'todo');
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex('+5584981560006'), 'phone', 'pgTAP 156');
select pg_temp.cliente('g', 'Gabi Sem Telefone', null);
select pg_temp.visita('g', pg_temp.em('2027-03-05 10:00'), 'manual', 'todo');
select pg_temp.cliente('h', 'Hugo On-line', '+5584981560008');
select pg_temp.reuniao('h', pg_temp.em('2027-03-05 11:30'), 'online', 'marcada');
select pg_temp.cliente('i', 'Iara A Confirmar', '+5584981560009');
select pg_temp.reuniao('i', pg_temp.em('2027-03-05 12:30'), 'presencial', 'a_confirmar');
select pg_temp.cliente('j', 'João Bloqueado', '+5584981560010');
select pg_temp.visita('j', pg_temp.em('2027-03-05 08:30'), 'manual', 'todo');
update public.conversations set bloqueada_em = now() where id = pg_temp.conv('j');
-- O robô foi freado nesta conversa: quem recusa é a porteira (`messages_guard`).
select pg_temp.cliente('m', 'Marta Robô Parado', '+5584981560013');
select pg_temp.visita('m', pg_temp.em('2027-03-05 17:00'), 'manual', 'todo');
update public.conversations set bot_paused = true where id = pg_temp.conv('m');
-- A visita de segunda, 08/03: Kátia não respondeu; Lia já respondeu.
select pg_temp.cliente('k', 'Kátia Segunda', '+5584981560011');
select pg_temp.visita('k', pg_temp.em('2027-03-08 10:00'), 'manual', 'todo');
-- A mensagem recebida que abre a janela também conta como "respondeu"; Kátia é
-- quem nunca respondeu de verdade, então o registro sai.
delete from public.activities a using public.interaction_outcomes o
 where a.outcome_id = o.id and o.counts_as = 'aberta'::app.door_kind
   and a.organization_id = pg_temp.org('k');
select pg_temp.cliente('l', 'Lia Respondeu', '+5584981560012');
select pg_temp.visita('l', pg_temp.em('2027-03-08 11:00'), 'manual', 'todo');
insert into public.activities (organization_id, type, channel, outcome_id, author_kind, body)
values (pg_temp.org('l'), 'message'::app.activity_type, 'whatsapp'::app.channel,
        (select id from public.interaction_outcomes where slug = 'wa_respondeu'), 'system', 'pgTAP 156');
select ok(app.ja_respondeu(pg_temp.org('l')) and not app.ja_respondeu(pg_temp.org('k')),
  'Lia conta como quem já respondeu; Kátia, não');

create temp table t156_base as
  select (select count(*) from public.messages where template_id = (pg_temp.modelo()).id) as lembretes;

select is(app.lembretes_de_visita_rodar(pg_temp.em('2027-03-04 10:30')) ->> 'motivo', 'desligado',
  'desligado: a rodada não faz nada');

select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is((public.lembrete_de_visita_configurar('{"ligado": true}') ->> 'ligado')::boolean, true,
  'o gestor liga o lembrete');
select pg_temp.sair();
select is(app.lembretes_de_visita_rodar(pg_temp.em('2027-03-04 10:30')) ->> 'motivo',
  'modelo_desligado_ou_inexistente', 'ligado, mas com o modelo inativo: nada sai');

select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is((public.lembrete_de_visita_modelo_para_a_meta() ->> 'ativado_agora')::boolean, true,
  '"Mandar para a Meta aprovar" ativa o modelo');
select pg_temp.sair();
select ok(exists (select 1 from jsonb_array_elements(public.wa_modelos_para_meta()) e
                   where e ->> 'codigo' = 'IMV-VIS-LEMBRETE'
                     and e ->> 'nome_sugerido' = 'imv_vis_lembrete_v1'
                     and e ->> 'categoria' = 'UTILITY'
                     and jsonb_array_length(e -> 'botoes') = 2),
  'e a sincronização passa a mandá-lo: imv_vis_lembrete_v1, UTILITY, com os dois botões');
select is(app.lembretes_de_visita_rodar(pg_temp.em('2027-03-04 10:30')) ->> 'motivo',
  'modelo_nao_aprovado_na_meta', 'ativo e esperando a Meta: nada sai');

-- A Meta aprovou (o que a sincronização grava).
update public.message_templates
   set meta_status = 'approved', meta_template_name = 'imv_vis_lembrete_v1'
 where template_code = 'IMV-VIS-LEMBRETE';

select is(app.lembretes_de_visita_rodar(pg_temp.em('2027-03-04 09:00')) ->> 'motivo', 'antes_da_hora',
  'às 9h, antes das 10h configuradas, nada sai');
select is(app.lembretes_de_visita_rodar(pg_temp.em('2027-03-07 10:30')) ->> 'motivo', 'domingo_ou_feriado',
  'domingo, nada sai');
select is(app.lembretes_de_visita_rodar(pg_temp.em('2027-03-15 10:30')) ->> 'motivo', 'domingo_ou_feriado',
  'feriado, nada sai');
select is((select count(*) from public.messages where template_id = (pg_temp.modelo()).id),
  (select lembretes from t156_base), 'e até aqui nenhum lembrete foi para a fila');
select is((select count(*) from public.visita_lembretes where organization_id in (select org from t156)), 0::bigint,
  'nem registrado');

-- =====================================================================
-- 6. Quem recebe e quem não (quinta, 10h30: as visitas de sexta)
-- =====================================================================
select is((app.lembretes_de_visita_rodar(pg_temp.em('2027-03-04 10:30')) ->> 'rodou')::boolean, true,
  'quinta às 10h30, ligado e aprovado: a rodada roda');

select is((pg_temp.lembrete('a')).situacao, 'enviado', 'a visita marcada no CRM recebe');
select is((pg_temp.lembrete('b')).situacao, 'enviado', 'a visita do Calendly recebe');
select is((pg_temp.lembrete('c')).situacao, 'enviado', 'a reunião presencial recebe');
select is((pg_temp.lembrete('c')).reuniao_id, (select reuniao from t156 where chave = 'c'),
  'e o lembrete dela aponta para a reunião');
select is(pg_temp.lembretes('d'), 0::bigint, 'a visita "a marcar" (sem hora combinada) não recebe');
select is(pg_temp.lembretes('e'), 0::bigint, 'a visita cancelada não recebe');
select is(pg_temp.lembretes('h'), 0::bigint, 'a reunião on-line não recebe');
select is(pg_temp.lembretes('i'), 0::bigint, 'a reunião "a confirmar" (o cliente não sabe) não recebe');
select is((pg_temp.lembrete('f')).situacao, 'nao_enviado', 'o suprimido não recebe');
select ok((pg_temp.lembrete('f')).motivo like '%suprimido', 'e fica o motivo: suprimido');
select is((pg_temp.lembrete('g')).motivo, 'sem_whatsapp', 'quem não tem telefone fica com "sem_whatsapp"');
select is((pg_temp.lembrete('j')).motivo, 'conversa_bloqueada', 'a conversa bloqueada não recebe');
select is((pg_temp.lembrete('m')).situacao, 'nao_enviado', 'a porteira recusou (o robô parado na conversa)');
select ok((pg_temp.lembrete('m')).motivo like '%robô já falou o bastante%(bot_pausado)%',
  'e o motivo é a frase da porteira, não um pedaço dela');
select is((select count(*) from public.messages m where m.template_id = (pg_temp.modelo()).id
            and m.conversation_id in (select conv from t156 where chave in ('f', 'j', 'm'))), 0::bigint,
  'nem mensagem na fila para eles');
select is(pg_temp.lembretes('k') + pg_temp.lembretes('l'), 0::bigint,
  'a visita de segunda não sai na quinta');

-- =====================================================================
-- 7. A mensagem
-- =====================================================================
select is((pg_temp.msg_do_lembrete('a')).type, 'template'::app.msg_type, 'sai como modelo');
select is((pg_temp.msg_do_lembrete('a')).author_kind, 'bot_fixed', 'como robô, sem crachá');
select ok((pg_temp.msg_do_lembrete('a')).sent_by is null, 'sem quem enviou');
select is((pg_temp.msg_do_lembrete('a')).status, 'queued'::app.msg_status, 'na fila do worker');
select is((pg_temp.msg_do_lembrete('a')).template_params,
  '{"nome": "Maria", "dia": "sexta-feira, 05/03", "hora": "14h", "local": "a combinar com o corretor"}'::jsonb,
  'as variáveis: primeiro nome, dia com a data, hora e o lugar a combinar (ficha sem endereço)');
select ok((pg_temp.msg_do_lembrete('a')).body like 'Olá, Maria! Lembrete da sua visita com a Imova: sexta-feira, 05/03, às 14h.%',
  'o corpo é o modelo preenchido');
select is((pg_temp.msg_do_lembrete('b')).template_params ->> 'local', 'Rua das Algas, 120 · Ponta Negra',
  'na visita do Calendly, o endereço que o cliente escreveu');
select is((pg_temp.msg_do_lembrete('b')).template_params ->> 'hora', '9h30', 'e a hora com os minutos');
select is((pg_temp.msg_do_lembrete('b')).template_params ->> 'nome', 'Bruno',
  'o nome em minúsculas sai com a inicial maiúscula');
select is((pg_temp.msg_do_lembrete('c')).template_params ->> 'local', 'Rua Potengi, 500 · Petrópolis',
  'na reunião presencial, o endereço da reunião');
select is((pg_temp.msg_do_lembrete('c')).conversation_id, pg_temp.conv('c'),
  'na conversa da reunião');

-- =====================================================================
-- 8. Uma vez só, e de novo quando a visita é remarcada
-- =====================================================================
select is((app.lembretes_de_visita_rodar(pg_temp.em('2027-03-04 10:35')) ->> 'enviados')::int, 0,
  'a rodada seguinte não manda de novo');
select is((select count(*) from public.messages where template_id = (pg_temp.modelo()).id),
  (select lembretes from t156_base) + 3, 'continuam três lembretes na fila');
select is(pg_temp.lembretes('f'), 1::bigint, 'e o que não saiu não ganha outra linha');

update public.tasks set due_at = pg_temp.em('2027-03-05 15:30') where id = pg_temp.task('a');
select app.lembretes_de_visita_rodar(pg_temp.em('2027-03-04 11:00'));
select is(pg_temp.lembretes('a'), 2::bigint, 'remarcou a visita: sai um lembrete novo');
select is((pg_temp.lembrete('a')).marcada_para, pg_temp.em('2027-03-05 15:30'),
  'para o horário novo');
select is((pg_temp.msg_do_lembrete('a')).template_params ->> 'hora', '15h30', 'com a hora nova');

-- =====================================================================
-- 9. A segunda-feira
-- =====================================================================
select app.lembretes_de_visita_rodar(pg_temp.em('2027-03-05 10:30'));
select is((pg_temp.lembrete('k')).situacao, 'enviado',
  'sexta: a visita de segunda de quem não respondeu sai na sexta');
select is(pg_temp.lembretes('l'), 0::bigint, 'a de quem respondeu espera o sábado');
select app.lembretes_de_visita_rodar(pg_temp.em('2027-03-06 10:30'));
select is((pg_temp.lembrete('l')).situacao, 'enviado', 'sábado: sai a de quem respondeu');
select is(pg_temp.lembretes('k'), 1::bigint, 'e a de quem não respondeu não sai de novo');

-- =====================================================================
-- 10. "Confirmo"
-- =====================================================================
-- A IA atende com clientes: o toque não pode virar pergunta para ela.
insert into public.app_settings (key, value, description)
values ('ia.atendente', '{"ligada": true, "modo": "clientes"}'::jsonb, 'pgTAP 156')
on conflict (key) do update set value = public.app_settings.value || excluded.value;
select ok(app.ia_atende(pg_temp.conv('a')) and app.ia_atende(pg_temp.conv('c')),
  'a IA atende as conversas de Maria e Carla');

create temp table t156_m (chave text primary key, id uuid);
insert into t156_m values ('confirmo', pg_temp.chega('a', 'Confirmo'));
select is((pg_temp.lembrete('a')).resposta, 'confirmou', '"Confirmo" grava a confirmação');
select is((pg_temp.lembrete('a')).resposta_message_id, (select id from t156_m where chave = 'confirmo'),
  'com a mensagem que chegou');
select is((select resposta from public.visita_lembretes where task_id = pg_temp.task('a')
            and marcada_para = pg_temp.em('2027-03-05 14:00')), null,
  'no lembrete do horário novo; o do horário velho fica sem resposta');
select is(pg_temp.saidas('a', 'IMV-VIS-CONFIRMADA'), 1::bigint, 'e a casa responde "Visita confirmada!"');
select ok((pg_temp.lembrete('a')).tarefa_remarcar_id is null, 'sem tarefa de remarcar');
select ok(exists (select 1 from public.ia_respostas r
                   where r.em_resposta_a = (select id from t156_m where chave = 'confirmo')
                     and r.acao = 'nao_respondeu'),
  'a IA fica calada nesse toque (a fila dela pula a mensagem)');
select ok(app.ia_atende(pg_temp.conv('a')), 'e continua atendendo a conversa');
select ok(not app.is_suppressed_target(pg_temp.org('a'), null)
          and not exists (select 1 from public.consent_events ce where ce.organization_id = pg_temp.org('a')),
  'tocar em "Confirmo" não suprime ninguém');

-- =====================================================================
-- 11. "Preciso remarcar"
-- =====================================================================
insert into t156_m values ('remarcar', pg_temp.chega('c', 'Preciso remarcar'));
select is((pg_temp.lembrete('c')).resposta, 'remarcar', '"Preciso remarcar" grava o pedido');
select ok((pg_temp.lembrete('c')).tarefa_remarcar_id is not null, 'e cria a tarefa');
select is((select title from public.tasks where id = (pg_temp.lembrete('c')).tarefa_remarcar_id),
  'Remarcar a visita com Carla Reunião', 'com o nome do cliente');
select is((select assignee_id from public.tasks where id = (pg_temp.lembrete('c')).tarefa_remarcar_id),
  pg_temp.sdr(), 'para o responsável pela visita');
select ok((select due_at <= now() and priority = 1 and status = 'todo'::app.task_status
             from public.tasks where id = (pg_temp.lembrete('c')).tarefa_remarcar_id),
  'com prazo agora, prioridade alta, aberta');
select is(pg_temp.saidas('c', 'IMV-VIS-REMARCAR'), 1::bigint, 'a casa responde que um corretor vai falar');
select is((select estado from public.ia_atendimento where conversation_id = pg_temp.conv('c')), 'parada',
  'a IA para nessa conversa: quem remarca é o corretor');
select ok(exists (select 1 from public.ia_respostas r
                   where r.em_resposta_a = (select id from t156_m where chave = 'remarcar')
                     and r.acao = 'nao_respondeu'),
  'e não responde ao toque');

select pg_temp.chega('c', 'Preciso remarcar!');
select is((select count(*) from public.tasks where organization_id = pg_temp.org('c')
            and title like 'Remarcar a visita%'), 1::bigint, 'tocar de novo não cria outra tarefa');
select is(pg_temp.saidas('c', 'IMV-VIS-REMARCAR'), 1::bigint, 'nem outra resposta da casa');
select ok(not app.is_suppressed_target(pg_temp.org('c'), null),
  'tocar em "Preciso remarcar" não suprime ninguém');

select pg_temp.chega('b', 'Confirmo sim, até amanhã', 'text');
select is((pg_temp.lembrete('b')).resposta, null, 'texto livre não é toque no botão');
select pg_temp.chega('d', 'Confirmo');
select is(pg_temp.saidas('d', 'IMV-VIS-CONFIRMADA'), 0::bigint, 'conversa sem lembrete: "Confirmo" não faz nada');

-- =====================================================================
-- 12. O painel e quem lê
-- =====================================================================
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is((public.lembrete_de_visita_painel() -> 'modelo' ->> 'aprovado')::boolean, true,
  'o painel mostra o modelo aprovado');
select ok((public.lembrete_de_visita_painel() -> 'ultimos_30_dias' ->> 'confirmaram')::int >= 1
          and (public.lembrete_de_visita_painel() -> 'ultimos_30_dias' ->> 'remarcar')::int >= 1,
  'e conta quem confirmou e quem pediu para remarcar');
select pg_temp.sair();
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is((select count(*) from public.visita_lembretes where task_id = pg_temp.task('a')), 2::bigint,
  'a corretora responsável lê os lembretes da visita dela (o selo do cartão)');
select throws_ok($$insert into public.visita_lembretes (task_id, organization_id, marcada_para, situacao)
                   values (pg_temp.task('d'), pg_temp.org('d'), now(), 'nao_enviado')$$,
  '42501', null, 'e ninguém escreve no lembrete pela tela');
select pg_temp.sair();

-- =====================================================================
-- 13. A KOMUNE
-- =====================================================================
select pg_temp.virar('komune');
select is(app.lembretes_de_visita_rodar(pg_temp.em('2027-03-04 10:30')) ->> 'motivo', 'so_na_imova',
  'num banco da KOMUNE a rodada não faz nada');
select pg_temp.chega('b', 'Confirmo');
select is((pg_temp.lembrete('b')).resposta, null, 'nem a leitura do botão');
select pg_temp.virar('imova');

-- =====================================================================
-- 14. Os privilégios
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'app.lembretes_de_visita_rodar(timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.lembretes_de_visita_rodar(timestamptz)', 'execute'),
  'a rodada não é executável de fora');
select ok(not has_function_privilege('authenticated', 'app.lembrete_de_visita_resposta(uuid)', 'execute'),
  'a leitura do botão também não');
select ok(not has_function_privilege('authenticated',
            'app.lembrete_de_visita_mandar(uuid, uuid, uuid, uuid, uuid, timestamptz, text, integer)', 'execute'),
  'nem o envio de um lembrete');
select ok(has_function_privilege('authenticated', 'public.lembrete_de_visita_configurar(jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.lembrete_de_visita_configurar(jsonb)', 'execute'),
  'os ajustes: authenticated chama (a função confere o papel), anon não');
select ok(has_function_privilege('authenticated', 'public.lembrete_de_visita_painel()', 'execute')
          and not has_function_privilege('anon', 'public.lembrete_de_visita_painel()', 'execute')
          and not has_function_privilege('anon', 'public.lembrete_de_visita_modelo_para_a_meta()', 'execute'),
  'o painel e o "mandar para a Meta" também');
select ok(has_table_privilege('authenticated', 'public.visita_lembretes', 'select')
          and not has_table_privilege('authenticated', 'public.visita_lembretes', 'insert')
          and not has_table_privilege('authenticated', 'public.visita_lembretes', 'update')
          and not has_table_privilege('anon', 'public.visita_lembretes', 'select'),
  'a tabela: authenticated só lê; anon nada');

select * from finish();
rollback;

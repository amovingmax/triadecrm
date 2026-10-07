-- =====================================================================
-- pgTAP — Excluir sem apagar (migração 20261007110000)
--
-- "Excluir um parceiro" e "excluir um compromisso da agenda" não existiam. Este
-- arquivo prova:
--
--   1. EXCLUIR TIRA DE CIRCULAÇÃO: a ficha some das leituras, e o que estava
--      pendente dela é encerrado junto — reunião (com o horário solto), tarefas,
--      a vaga na fila de envios e a conversa, que sai da ficha;
--   2. NADA É APAGADO: histórico, negócio e mensagens continuam no banco;
--   3. RESTAURAR DEVOLVE a ficha, o negócio e a conversa — e recusa, dizendo
--      qual ficha está no lugar, quando o parceiro foi recadastrado;
--   4. QUEM NÃO SE EXCLUI: cliente e quem tem pré-cadastro em andamento;
--   5. SÓ A GESTÃO exclui e restaura, e sempre com motivo;
--   6. O COMPROMISSO: quem faz ou quem criou exclui o seu; a próxima ação do
--      negócio passa para a seguinte; a parada sai da rota; e excluir o eco de
--      uma reunião cancela a REUNIÃO.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(51);

-- ---------- utilitários ----------
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
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010401'::uuid $$;
create function pg_temp.ana() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010402'::uuid $$;
create function pg_temp.bia() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000010403'::uuid $$;
create function pg_temp.org(p text) returns uuid language sql immutable as $$
  select ('c0000000-0000-4000-8000-0000000104' || p)::uuid
$$;
create function pg_temp.neg(p text) returns uuid language sql immutable as $$
  select ('e0000000-0000-4000-8000-0000000104' || p)::uuid
$$;
create function pg_temp.tar(p text) returns uuid language sql immutable as $$
  select ('f0000000-0000-4000-8000-0000000104' || p)::uuid
$$;
create function pg_temp.etapa(p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = 'fornecedor' and s.slug = p_slug
$$;
create function pg_temp.status_da(p_task uuid) returns text language sql security definer set search_path = '' as $$
  select status::text from public.tasks where id = p_task
$$;
-- Quantos cartões do parceiro o quadro do funil devolve (0 ou 1).
create function pg_temp.cartoes_no_quadro(p_org uuid) returns int language sql as $$
  select count(*)::int
    from jsonb_array_elements(public.pipeline_board(1, false, null, null, null, 200) -> 'stages') s,
         jsonb_array_elements(s -> 'cards') c
   where (c ->> 'organization_id')::uuid = p_org
$$;
-- Dia útil à frente, para as datas não dependerem de quando o teste roda.
create function pg_temp.em(p_dias int, p_hora int) returns timestamptz language sql stable as $$
  select ((app.next_business_day((now() at time zone 'America/Fortaleza')::date, p_dias)
           + make_time(p_hora, 0, 0)) at time zone 'America/Fortaleza')
$$;

insert into public.allowed_users (email, role, note) values
  ('e104.g@teste.local', 'gestor', 'pgTAP 104'),
  ('e104.a@teste.local', 'sdr',    'pgTAP 104'),
  ('e104.b@teste.local', 'sdr',    'pgTAP 104');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gil(), 'e104.g@teste.local', '{"full_name":"Gil Gestor"}'),
  (pg_temp.ana(), 'e104.a@teste.local', '{"full_name":"Ana Freela"}'),
  (pg_temp.bia(), 'e104.b@teste.local', '{"full_name":"Bia Freela"}');

-- ---------- parceiros ----------
--   01  o que vai ser excluído e restaurado: negócio, tarefas, reunião, conversa, fila
--   02  já é cliente (negócio ganho)
--   03  pré-cadastro em andamento
--   04  excluído e depois RECADASTRADO (05 nasce com o mesmo telefone)
--   06  o dos compromissos (seção 6)
-- Nomes sem palavra em comum: a busca do quadro e da lista é aproximada
-- (trigramas), e "Parceiro 1" casaria com "Parceiro 2".
insert into public.organizations (id, name, phone_e164, source_id, owner_id)
select pg_temp.org(lpad(x.i::text, 2, '0')), x.nome, '+558499991040' || x.i,
       (select id from public.sources where slug = 'captura_campo'), pg_temp.gil()
  from (values (1, 'Zulmira Quitutes'), (2, 'Ypioca Eventos'), (3, 'Xavante Sonorização'),
               (4, 'Wanderlei Tendas'), (6, 'Valquíria Decorações')) x(i, nome);
insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id) values
  (pg_temp.neg('01'), pg_temp.org('01'), 1, pg_temp.etapa('respondeu'), pg_temp.gil()),
  (pg_temp.neg('02'), pg_temp.org('02'), 1, pg_temp.etapa('publicado'), pg_temp.gil()),
  (pg_temp.neg('03'), pg_temp.org('03'), 1, pg_temp.etapa('respondeu'), pg_temp.gil()),
  (pg_temp.neg('04'), pg_temp.org('04'), 1, pg_temp.etapa('prospectado'), pg_temp.gil()),
  (pg_temp.neg('06'), pg_temp.org('06'), 1, pg_temp.etapa('respondeu'), pg_temp.gil());

-- 01: duas tarefas abertas (uma delas espelhada como próxima ação do negócio),
-- uma reunião marcada com a tarefa-eco, e uma vaga na fila de envios.
insert into public.tasks (id, title, kind, due_at, assignee_id, organization_id, deal_id, created_by) values
  (pg_temp.tar('11'), 'Ligar para confirmar', 'call',      pg_temp.em(2, 10), pg_temp.gil(), pg_temp.org('01'), pg_temp.neg('01'), pg_temp.gil()),
  (pg_temp.tar('12'), 'Mandar proposta',      'follow_up', pg_temp.em(4, 10), pg_temp.gil(), pg_temp.org('01'), pg_temp.neg('01'), pg_temp.gil()),
  (pg_temp.tar('13'), 'Reunião com E104 1',   'meeting',   pg_temp.em(3, 9),  pg_temp.gil(), pg_temp.org('01'), pg_temp.neg('01'), pg_temp.gil());
update public.deals set next_action = 'Ligar para confirmar', next_action_at = pg_temp.em(2, 10)
 where id = pg_temp.neg('01');
insert into public.reunioes (id, organization_id, deal_id, dono_id, titulo, formato, inicio, fim,
                             link, estado, marcada_por, marcada_por_id, task_id)
values ('d0000000-0000-4000-8000-000000010411', pg_temp.org('01'), pg_temp.neg('01'), pg_temp.gil(),
        'Reunião com E104 1', 'online', pg_temp.em(3, 9), pg_temp.em(3, 9) + interval '40 minutes',
        'https://sala.invalid/e104', 'marcada', 'pessoa', pg_temp.gil(), pg_temp.tar('13'));
insert into public.envios_em_massa (id, nome, tipo, texto, assinatura, por_hora, criado_por, status)
values ('d0000000-0000-4000-8000-000000010421', 'E104 fila', 'texto', 'Bom dia!', 'eu', 6, pg_temp.gil(), 'agendado');
insert into public.envios_em_massa_itens (envio_id, posicao, organization_id, status)
values ('d0000000-0000-4000-8000-000000010421', 1, pg_temp.org('01'), 'pendente');

-- 01: a conversa, pelo caminho real — uma mensagem que chega do número dele.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999910400"')
 where key = 'whatsapp.envio';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
set role service_role;
select public.wa_entrada_registrar('wamid.E104.1', '+5584999910400', '+5584999910401', 'text', 'Oi, tudo bem?');
reset role;
create function pg_temp.conversa() returns uuid language sql security definer set search_path = '' as $$
  select id from public.conversations where peer_phone_e164 = '+5584999910401'
$$;

-- 02 é cliente: o gatilho já pôs o negócio como ganho ao nascer em "Publicado".
-- 03 tem pré-cadastro: o rascunho nasce pelo caminho real.
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(public.criar_pre_cadastro(pg_temp.org('03'),
            jsonb_build_object('nome_exibicao', 'E104 TRES', 'cidade', 'Natal')) ->> 'ok',
          'true', 'preparo: o pré-cadastro do parceiro 03 nasce');
select pg_temp.sair();

select is((select organization_id from public.conversations where id = pg_temp.conversa()),
  pg_temp.org('01'), 'preparo: a conversa nasceu ligada à ficha, pelo telefone');

-- =====================================================================
-- 5. Só a gestão, e sempre com motivo  (antes de excluir de verdade)
-- =====================================================================
select pg_temp.entrar(pg_temp.ana(), 'sdr');
select is(public.parceiro_excluir(pg_temp.org('01'), 'duplicado') ->> 'motivo', 'sem_permissao',
  'quem liga não exclui parceiro');
select throws_ok($$select * from public.parceiros_excluidos()$$, '42501', null,
  'nem vê a lista de excluídos');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(public.parceiro_excluir(pg_temp.org('01'), '  ') ->> 'motivo', 'motivo_obrigatorio',
  'excluir sem dizer por quê é recusado');
select is(public.parceiro_excluir('00000000-0000-4000-8000-000000000104', 'teste') ->> 'motivo',
  'nao_encontrado', 'ficha que não existe: recusa com nome, sem exceção');

-- =====================================================================
-- 4. Quem não se exclui
-- =====================================================================
select is(public.parceiro_excluir(pg_temp.org('02'), 'limpeza') ->> 'motivo', 'ja_e_cliente',
  'cliente (negócio ganho) não se exclui por aqui');
select is(public.parceiro_excluir(pg_temp.org('03'), 'limpeza') ->> 'motivo', 'pre_cadastro_em_andamento',
  'nem quem está com pré-cadastro aberto na Komune');
select pg_temp.sair();
select is((select count(*)::int from public.organizations
            where id in (pg_temp.org('02'), pg_temp.org('03')) and deleted_at is not null),
  0, 'as recusas não excluíram ninguém');

-- =====================================================================
-- 1. Excluir tira de circulação
-- =====================================================================
select pg_temp.entrar(pg_temp.gil(), 'gestor');
create temp table r104 as
  select public.parceiro_excluir(pg_temp.org('01'), 'Cadastrado duas vezes: é o mesmo buffet da ficha antiga') as res;
grant select on r104 to authenticated;
select is((select res ->> 'ok' from r104), 'true', 'a gestão exclui, com motivo');
select is((select (res ->> 'reunioes_canceladas')::int from r104), 1, 'o recibo conta a reunião cancelada');
select is((select (res ->> 'tarefas_canceladas')::int from r104), 2,
  'e as duas tarefas (a terceira era o eco da reunião, que a reunião já levou)');
select is((select count(*)::int from public.search_organizations('Zulmira Quitutes')
            where id = pg_temp.org('01')),
  0, 'a ficha some da busca de Prospectados');
select is(pg_temp.cartoes_no_quadro(pg_temp.org('01')), 0, 'e do quadro do funil');
select is(public.parceiro_excluir(pg_temp.org('01'), 'de novo') ->> 'motivo', 'nao_encontrado',
  'excluir o que já está excluído não faz nada');
select pg_temp.sair();

select results_eq(
  $$select deleted_at is not null, deleted_by, deleted_reason from public.organizations
     where id = pg_temp.org('01')$$,
  $$values (true, pg_temp.gil(), 'Cadastrado duas vezes: é o mesmo buffet da ficha antiga'::text)$$,
  'a ficha guarda quando, quem e por quê');
select is((select count(*)::int from public.tasks
            where organization_id = pg_temp.org('01') and status in ('todo', 'doing')),
  0, 'nenhuma tarefa aberta sobra: ninguém vai ligar para quem saiu');
select is((select estado from public.reunioes where id = 'd0000000-0000-4000-8000-000000010411'),
  'cancelada', 'a reunião marcada foi cancelada, e o horário voltou a ficar livre');
select ok((select observacao like 'Parceiro excluído:%' from public.reunioes
            where id = 'd0000000-0000-4000-8000-000000010411'),
  'com o motivo escrito nela');
select results_eq(
  $$select status, motivo from public.envios_em_massa_itens where organization_id = pg_temp.org('01')$$,
  $$values ('cancelada'::text, 'parceiro_excluido'::text)$$,
  'a vaga na fila de envios é cancelada: o bom-dia não sai para quem foi excluído');
select results_eq(
  $$select organization_id, deal_id, arquivada_em is not null from public.conversations
     where id = pg_temp.conversa()$$,
  $$values (null::uuid, null::uuid, true)$$,
  'a conversa é desligada da ficha e arquivada');
select results_eq(
  $$select next_action, next_action_at from public.deals where id = pg_temp.neg('01')$$,
  $$values (null::text, null::timestamptz)$$,
  'o negócio fica sem próxima ação (as tarefas dela foram canceladas)');
select is((select count(*)::int from public.audit_log
            where action = 'EXCLUIR_PARCEIRO' and row_id = pg_temp.org('01')::text
              and actor_id = pg_temp.gil() and new_data ->> 'motivo' like 'Cadastrado duas vezes%'),
  1, 'auditoria: quem excluiu, quando e o motivo');

-- Se a pessoa escrever de novo, a mensagem NÃO cai num fio escondido.
update public.app_settings set value = jsonb_set(value, '{lead_automatico}', 'false')
 where key = 'atendimento' and value ? 'lead_automatico';
set role service_role;
select public.wa_entrada_registrar('wamid.E104.2', '+5584999910400', '+5584999910401', 'text', 'Ainda tem interesse?');
reset role;
select results_eq(
  $$select c.organization_id, c.arquivada_em from public.conversations c where c.id = pg_temp.conversa()$$,
  $$values (null::uuid, null::timestamptz)$$,
  'mensagem nova de quem foi excluído: o MESMO fio volta do arquivo, fora da base — visível');

-- =====================================================================
-- 2. Nada é apagado
-- =====================================================================
select is((select count(*)::int from public.organizations where id = pg_temp.org('01')), 1,
  'a ficha continua no banco');
select is((select s.slug from public.deals d join public.stages s on s.id = d.stage_id
            where d.id = pg_temp.neg('01')),
  'respondeu', 'o negócio também, na etapa em que estava');
select is((select count(*)::int from public.messages
            where conversation_id = pg_temp.conversa() and organization_id = pg_temp.org('01')),
  1, 'e a mensagem de antes continua sabendo de quem era');

select pg_temp.entrar(pg_temp.gil(), 'gestor');
select results_eq(
  $$select nome, excluido_por, motivo from public.parceiros_excluidos('zulmira')$$,
  $$values ('Zulmira Quitutes'::text, 'Gil Gestor'::text,
            'Cadastrado duas vezes: é o mesmo buffet da ficha antiga'::text)$$,
  'a lista de excluídos diz quem excluiu e por quê');

-- =====================================================================
-- 3. Restaurar
-- =====================================================================
select is(public.parceiro_restaurar(pg_temp.org('01')) ->> 'ok', 'true', 'a gestão restaura');
select is((select count(*)::int from public.search_organizations('Zulmira Quitutes')
            where id = pg_temp.org('01')),
  1, 'a ficha volta para Prospectados');
select is(pg_temp.cartoes_no_quadro(pg_temp.org('01')), 1, 'e o cartão volta ao quadro, na mesma coluna');
select is(public.parceiro_restaurar(pg_temp.org('01')) ->> 'ja_estava', 'true',
  'restaurar quem já está na base não faz nada');
select pg_temp.sair();
select results_eq(
  $$select deleted_at, deleted_by, deleted_reason from public.organizations where id = pg_temp.org('01')$$,
  $$values (null::timestamptz, null::uuid, null::text)$$,
  'as marcas da exclusão saem');
select results_eq(
  $$select organization_id, deal_id from public.conversations where id = pg_temp.conversa()$$,
  $$values (pg_temp.org('01'), pg_temp.neg('01'))$$,
  'a conversa volta a ser da ficha, com o negócio');
select is((select count(*)::int from public.tasks
            where organization_id = pg_temp.org('01') and status in ('todo', 'doing')),
  0, 'o que foi cancelado NÃO volta: as tarefas continuam canceladas');
select is((select count(*)::int from public.audit_log
            where action = 'RESTAURAR_PARCEIRO' and row_id = pg_temp.org('01')::text),
  1, 'auditoria: a restauração também fica registrada');

-- O parceiro recadastrado enquanto estava fora.
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(public.parceiro_excluir(pg_temp.org('04'), 'número errado') ->> 'ok', 'true',
  'preparo: o parceiro 04 é excluído');
select pg_temp.sair();
insert into public.organizations (id, name, phone_e164, source_id)
values (pg_temp.org('05'), 'Ubirajara Recadastrado', '+5584999910404',
        (select id from public.sources where slug = 'captura_campo'));
select is((select count(*)::int from public.organizations where phone_e164 = '+5584999910404'), 2,
  'o telefone de quem foi excluído fica livre para um cadastro novo');
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select results_eq(
  $$select r ->> 'motivo', r ->> 'campo', (r ->> 'organization_id')::uuid, r ->> 'nome'
      from public.parceiro_restaurar(pg_temp.org('04')) r$$,
  $$values ('duplicado'::text, 'telefone'::text, pg_temp.org('05'), 'Ubirajara Recadastrado'::text)$$,
  'restaurar com o telefone já em outra ficha é recusado, e a recusa diz qual ficha');
select pg_temp.sair();
select isnt((select deleted_at from public.organizations where id = pg_temp.org('04')), null,
  'e a ficha continua excluída');

-- =====================================================================
-- 6. O compromisso
-- =====================================================================
--   21  visita da Ana, amanhã — é a próxima ação espelhada no negócio
--   22  follow-up do Gil, depois — a que vira a próxima
--   23  ligação já concluída
--   24  eco de uma reunião viva
insert into public.tasks (id, title, kind, status, due_at, assignee_id, organization_id, deal_id, created_by) values
  (pg_temp.tar('21'), 'Visita ao E104 6',     'visit',     'todo', pg_temp.em(1, 15), pg_temp.ana(), pg_temp.org('06'), pg_temp.neg('06'), pg_temp.gil()),
  (pg_temp.tar('22'), 'Retomar a conversa',   'follow_up', 'todo', pg_temp.em(5, 9),  pg_temp.gil(), pg_temp.org('06'), pg_temp.neg('06'), pg_temp.gil()),
  (pg_temp.tar('23'), 'Ligação feita',        'call',      'done', pg_temp.em(1, 9),  pg_temp.gil(), pg_temp.org('06'), pg_temp.neg('06'), pg_temp.gil()),
  (pg_temp.tar('24'), 'Reunião com E104 6',   'meeting',   'todo', pg_temp.em(6, 9),  pg_temp.gil(), pg_temp.org('06'), pg_temp.neg('06'), pg_temp.gil());
update public.deals set next_action = 'Visita ao E104 6', next_action_at = pg_temp.em(1, 15)
 where id = pg_temp.neg('06');
insert into public.reunioes (id, organization_id, deal_id, dono_id, titulo, formato, inicio, fim,
                             link, estado, marcada_por, marcada_por_id, task_id)
values ('d0000000-0000-4000-8000-000000010412', pg_temp.org('06'), pg_temp.neg('06'), pg_temp.gil(),
        'Reunião com E104 6', 'online', pg_temp.em(6, 9), pg_temp.em(6, 9) + interval '40 minutes',
        'https://sala.invalid/e104', 'marcada', 'pessoa', pg_temp.gil(), pg_temp.tar('24'));
-- A visita está na rota do dia da Ana.
insert into public.route_plans (id, plan_date, assignee_id, origin_label, origin_lat, origin_lng)
values ('d0000000-0000-4000-8000-000000010431', (pg_temp.em(1, 15) at time zone 'America/Fortaleza')::date,
        pg_temp.ana(), 'Escritório', -5.79, -35.21);
insert into public.route_stops (plan_id, position, task_id, organization_id, lat, lng, geo_precision,
                                seconds_from_prev, meters_from_prev)
values ('d0000000-0000-4000-8000-000000010431', 1, pg_temp.tar('21'), pg_temp.org('06'),
        -5.81, -35.20, 'bairro', 600, 4200);

select pg_temp.entrar(pg_temp.bia(), 'sdr');
select is(public.tarefa_excluir(pg_temp.tar('21')) ->> 'motivo', 'sem_permissao',
  'quem não faz nem criou a tarefa não a exclui');
select pg_temp.entrar(pg_temp.ana(), 'sdr');
select is(public.tarefa_excluir(pg_temp.tar('21'), 'O parceiro desmarcou') ->> 'ok', 'true',
  'quem faz a visita a exclui da própria agenda');
select is(public.tarefa_excluir(pg_temp.tar('21')) ->> 'ja_estava', 'true',
  'excluir de novo não faz nada');
select pg_temp.sair();
select is(pg_temp.status_da(pg_temp.tar('21')), 'cancelled',
  'a tarefa não é apagada: fica cancelada, que a Agenda e o Meu dia não mostram');
select results_eq(
  $$select next_action, next_action_at from public.deals where id = pg_temp.neg('06')$$,
  $$values ('Retomar a conversa'::text, pg_temp.em(5, 9))$$,
  'a próxima ação do negócio passa para a tarefa seguinte');
select is((select count(*)::int from public.route_stops where task_id = pg_temp.tar('21')), 0,
  'a parada sai da rota do dia');
select is((select count(*)::int from public.audit_log
            where action = 'EXCLUIR_COMPROMISSO' and row_id = pg_temp.tar('21')::text
              and actor_id = pg_temp.ana() and new_data ->> 'motivo' = 'O parceiro desmarcou'),
  1, 'auditoria: quem excluiu o compromisso e por quê');

select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(public.tarefa_excluir(pg_temp.tar('23')) ->> 'motivo', 'ja_concluida',
  'o que já foi feito não se exclui: é histórico');
select is(public.tarefa_excluir(pg_temp.tar('24'), 'Marcada no dia errado') ->> 'era_reuniao', 'true',
  'excluir o eco de uma reunião viva é cancelar a reunião');
select pg_temp.sair();
select is((select estado from public.reunioes where id = 'd0000000-0000-4000-8000-000000010412'),
  'cancelada', 'a reunião foi cancelada (e o horário solto), não só o eco');
select is(pg_temp.status_da(pg_temp.tar('24')), 'cancelled', 'e o eco foi junto');

select * from finish();
rollback;

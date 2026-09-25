-- =====================================================================
-- pgTAP — O teto conta ABERTURA, e o recontato deixa de passar por baixo
--         (migração 20260925170000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. O FURO EXISTIA. `is_first_contact` só é verdade na primeira mensagem de
--      uma conversa. Uma campanha de recontato sobre fichas já tocadas pulava
--      o passo 5 inteiro de `app.pode_enviar` — ninguém mentiu, o aquecimento
--      simplesmente não era perguntado.
--   2. A META NÃO CONTA "PRIMEIRO CONTATO". Conta conversa aberta pela
--      empresa. O número que a nossa porteira compara com o aquecimento tem de
--      ser o mesmo que a Meta olha.
--   3. RESPOSTA DENTRO DA JANELA NÃO CONTA e não é barrada: quem escreveu foi
--      a pessoa, e a Meta não cobra abertura por isso.
--   4. A CONFIRMAÇÃO DE OPT-OUT NÃO CONTA. Ela é `business_initiated` fora da
--      janela, mas é resposta a quem pediu para sair — e o portão dela nem
--      consulta o aquecimento, logo não pode comê-lo.
--   5. OS DOIS PORTÕES CONTAM A MESMA COISA. `app.toques_do_dia` é o que a
--      CADÊNCIA pergunta. Dois tetos com denominadores diferentes não são um
--      teto: a cadência agendaria o que a porteira recusa, e o excedente
--      atrasado sem nunca caber é uma fila que só cresce.
--
-- ESCOPO: número e dia próprios deste arquivo, e `cadencia.tetos` alterado
-- dentro da transação. Nada mede linha absoluta de tabela compartilhada.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(10);

create function pg_temp.num() returns text language sql immutable as $$
  select '+5584900000069'::text
$$;
-- Quarta-feira, 10h, em horário comercial: é o instante em que a janela do
-- RF-CON-11 está aberta e o teto é a única pergunta que sobra.
create function pg_temp.agora() returns timestamptz language sql immutable as $$
  select (timestamp '2026-09-16 10:00') at time zone 'America/Fortaleza'
$$;
create function pg_temp.dia() returns date language sql immutable as $$
  select date '2026-09-16'
$$;

create function pg_temp.contratar(p_nome text, p_papel text) returns uuid
language plpgsql as $$
declare
  v_id    uuid  := gen_random_uuid();
  v_email text  := 'pgtap69.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                   || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 69 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  return v_id;
end $$;
create temp table equipe69(papel text primary key, id uuid not null);
insert into equipe69(papel, id) values ('sdr', pg_temp.contratar('Custodio Pgtap', 'sdr'));
create function pg_temp.sdr() returns uuid language sql as $$
  select id from equipe69 where papel = 'sdr'
$$;

-- O teto deste arquivo: 2 aberturas por dia, a partir de 16/09/2026. Um número
-- pequeno para a terceira abertura doer sem precisar de 45 mensagens.
update public.app_settings
   set value = jsonb_set(jsonb_set(value, '{inicio}', '"2026-09-16"'),
                         '{whatsapp,semana1}', '2')
 where key = 'cadencia.tetos';

-- ---------- sessões ----------
create function pg_temp.entrar_worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

-- Três conversas no nosso número de teste:
--   01 nunca teve nada: é a ficha NOVA, primeiro contato de verdade;
--   02 já conversou há dez dias: janela fechada e `is_first_contact` falso —
--      é a ficha de RECONTATO, e é ela o furo;
--   03 escreveu há duas horas: janela de 24 h aberta.
insert into public.conversations (id, business_number, peer_phone_e164, assignee_id)
values ('c0000000-0000-4000-8000-0000000c6901', pg_temp.num(), '+5584911110691', pg_temp.sdr()),
       ('c0000000-0000-4000-8000-0000000c6902', pg_temp.num(), '+5584911110692', pg_temp.sdr()),
       ('c0000000-0000-4000-8000-0000000c6903', pg_temp.num(), '+5584911110693', pg_temp.sdr()),
       ('c0000000-0000-4000-8000-0000000c6904', pg_temp.num(), '+5584911110694', pg_temp.sdr());

-- A história da 02, para `is_first_contact` DERIVAR falso. Não se finge a
-- coluna: o arquivo 43 prova que fingir não passa pelo teto, e aqui ela
-- precisa ser falsa de verdade para o furo aparecer.
select pg_temp.entrar_worker();
insert into public.messages (conversation_id, direction, type, status, body, origin,
                             wa_message_id, created_at, sent_at)
values ('c0000000-0000-4000-8000-0000000c6902', 'in'::app.msg_direction, 'text'::app.msg_type,
        'received'::app.msg_status, 'oi, me manda depois', 'echo',
        'wamid.PGTAP69.HISTORIA', pg_temp.agora() - interval '10 days',
        pg_temp.agora() - interval '10 days');
select pg_temp.sair();
update public.conversations set last_inbound_at = pg_temp.agora() - interval '10 days'
 where id = 'c0000000-0000-4000-8000-0000000c6902';
update public.conversations set last_inbound_at = pg_temp.agora() - interval '2 hours'
 where id = 'c0000000-0000-4000-8000-0000000c6903';
-- A 04 escreveu há duas horas no relógio DE VERDADE. É ela que pede para sair:
-- fora da janela de 24 h a confirmação exigiria modelo aprovado pela Meta, e
-- não há nenhum aprovado no banco de desenvolvimento (0 de 126). Com a janela
-- aberta ela sai como texto livre, que é o caminho real de hoje.
update public.conversations set last_inbound_at = now() - interval '2 hours'
 where id = 'c0000000-0000-4000-8000-0000000c6904';

-- Duas aberturas gastas hoje, as duas FORA da cadência. Elas entram como ECO
-- do celular — registro do que já aconteceu, que não passa pela porteira mas
-- GASTA o número, exatamente como o arquivo 24 faz. A primeira é primeiro
-- contato; a segunda NÃO é, e é justamente essa que antes não contava.
-- `is_first_contact` vai explícito porque o gatilho que a DERIVA só age em
-- `origin = 'crm'` (20260914100000:141). No eco quem sabe é quem registra —
-- e é exatamente assim que o arquivo 24 monta os três ecos dele.
create function pg_temp.abrir(p_conv uuid, p_sufixo text, p_primeiro boolean) returns void
language sql security definer set search_path = '' as $$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, sent_by, is_first_contact, sent_at,
                               origin, wa_message_id)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'abertura de teste', 'human', pg_temp.sdr(), p_primeiro,
          pg_temp.agora(), 'echo', 'wamid.PGTAP69.ABRE.' || p_sufixo)
$$;
select pg_temp.entrar_worker();
select pg_temp.abrir('c0000000-0000-4000-8000-0000000c6901'::uuid, 'a', true);
select pg_temp.abrir('c0000000-0000-4000-8000-0000000c6902'::uuid, 'b', false);
select pg_temp.sair();

-- =====================================================================
-- 1. AS DUAS CONTAS, LADO A LADO
-- =====================================================================
select is(app.primeiros_contatos_do_dia('whatsapp'::app.channel, pg_temp.dia(), pg_temp.num()), 1,
  'a conta ANTIGA vê um: só a mensagem marcada como primeiro contato');
select is(app.aberturas_do_dia('whatsapp'::app.channel, pg_temp.dia(), pg_temp.num()), 2,
  'a conta NOVA vê duas: o recontato é conversa aberta pela empresa, e é assim que a Meta o cobra');

-- =====================================================================
-- 2. O TETO VALE PARA O RECONTATO
-- =====================================================================
-- A conversa 02 já foi tocada hoje e o dia está cheio (2 de 2). Antes, ela
-- passaria: `p_primeiro_contato` falso pulava o passo 5 inteiro.
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c6902', false, true, pg_temp.agora())
            ->> 'motivo', 'teto_do_numero',
  'RECONTATO com o dia cheio é recusado: o furo está fechado');
select is((app.pode_enviar('c0000000-0000-4000-8000-0000000c6902', false, true, pg_temp.agora())
            ->> 'teto')::int, 2,
  'e a recusa diz qual era o teto');
select ok((app.pode_enviar('c0000000-0000-4000-8000-0000000c6902', false, true, pg_temp.agora())
            ->> 'quando')::timestamptz > pg_temp.agora(),
  'é "agora não", e não "nunca mais": o lote dorme até a próxima abertura');

-- =====================================================================
-- 3. O QUE NÃO É ABERTURA CONTINUA PASSANDO
-- =====================================================================
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c6903', false, false, pg_temp.agora())
            ->> 'pode', 'true',
  'responder DENTRO da janela de 24 h continua livre, com o dia cheio: quem escreveu foi a pessoa');

-- A confirmação de opt-out É `business_initiated` fora da janela, e ainda
-- assim não é abertura: é resposta a quem pediu para sair. O portão dela
-- (20260905000300:216) nem consulta `app.teto_do_canal` — logo ela não pode
-- ser barrada pelo aquecimento, e também não pode comê-lo.
--
-- Ela não se declara: `optout_confirmation` é derivada do estado pelo banco.
-- Quem a cria é `public.wa_optout_registrar`, na mesma transação do pedido —
-- e ela nasce com o relógio de VERDADE, não com o instante fixo deste
-- arquivo. Por isso esta é a única medida em DELTA do arquivo.
create temp table aberturas_antes as
  select app.aberturas_do_dia('whatsapp'::app.channel,
                              (now() at time zone 'America/Fortaleza')::date,
                              pg_temp.num()) as n;
select pg_temp.entrar_worker();
-- O terceiro argumento é `p_confirmar`, e não `p_amplo`: com `false` a
-- confirmação não sai e a medida abaixo não provaria nada.
select public.wa_optout_registrar('c0000000-0000-4000-8000-0000000c6904'::uuid, 'quero sair', true);
select pg_temp.sair();

select is((select count(*)::int from public.messages m
            where m.conversation_id = 'c0000000-0000-4000-8000-0000000c6904'
              and m.optout_confirmation), 1,
  'a confirmação de opt-out saiu, uma só — sem ela esta medida não provaria nada');
select is(app.aberturas_do_dia('whatsapp'::app.channel,
                               (now() at time zone 'America/Fortaleza')::date,
                               pg_temp.num())
          - (select n from aberturas_antes), 0,
  'e NÃO contou como abertura: ela é resposta a quem pediu para sair, e o portão dela nem consulta o aquecimento');

-- =====================================================================
-- 4. OS DOIS PORTÕES CONTAM A MESMA COISA
-- =====================================================================
select is(app.toques_do_dia('whatsapp'::app.channel, pg_temp.dia()),
          app.aberturas_do_dia('whatsapp'::app.channel, pg_temp.dia(), null),
  'a cadência e a porteira contam a MESMA coisa: dois tetos com denominadores diferentes não são um teto');
select is(app.toques_do_dia('whatsapp'::app.channel, pg_temp.dia()), 2,
  'e o número é o das aberturas, não o dos primeiros contatos: a cadência para de AGENDAR o que a porteira vai recusar');

select * from finish();
rollback;

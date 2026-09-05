-- =====================================================================
-- pgTAP — A tela das cadências e o Resumo do dia
--   (migração 20260904001890)
--   public.cadencias_visao · public.ligar_cadencia · public.resumo_do_dia
--   · app.app_settings_modo_automatico
--
-- O que este arquivo tem de provar, e por quê:
--
--   1. O QUE A TELA CONTA É O QUE O BANCO TEM. `cadencias_visao` devolve
--      passo por passo e a contagem de quem está parado em cada um. Uma
--      contagem que não anda quando uma matrícula anda é uma tela que mente
--      com números — pior do que uma tela vazia.
--
--   2. A CONTAGEM RESPEITA A RLS. A função é `security definer` (precisa ser,
--      para ler `cron.job` e `worker_heartbeats`), e definer sem cuidado vira
--      vazamento: o embaixador não pode contar a carteira dos outros.
--
--   3. DESLIGAR NÃO ENCERRA NINGUÉM. É a promessa que a tela faz por escrito.
--      Desligada, a cadência recusa matrícula nova; quem está dentro continua.
--
--   4. A RECUSA É LEGÍVEL. `sdr` desligando cadência recebe
--      `{ok:false,motivo:'sem_permissao'}`, e não o zero-linhas silencioso que
--      um UPDATE sob RLS devolveria — é o defeito que a RPC existe para evitar.
--
--   5. O MODO AUTOMÁTICO NÃO LIGA. A flag do RF-CON-09 existe para ser lida.
--      O ADR-05 é decisão de projeto, e decisão de projeto que só existe em
--      prosa é decisão que alguém desfaz por engano numa tela de configuração.
--      Aqui ela é gatilho: `42501` no insert e no update.
--
--   6. O RESUMO É DO DIA CIVIL DE FORTALEZA, e distingue "não fez" de "não
--      registrou" (R07 §8.2) — `sem_registro` é dado do banco, não um
--      `length === 0` deduzido na tela.
--
--   7. O RESUMO DOS OUTROS É DE GESTOR. A pessoa lê o próprio; gestor e admin
--      leem o de qualquer um; `sdr` pedindo o de outro leva 42501.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada: este banco
-- tem operação real dentro (100 organizações, 47 tarefas, ligações). Tudo é
-- DELTA contra uma base lida FORA da RLS, ou escopo por id do próprio arquivo.
--
-- Sobre o relógio: `resumo_do_dia` recorta o dia civil, então tudo o que este
-- arquivo cria é ancorado em `pg_temp.hoje_as(hora)` — uma hora escolhida do
-- dia corrente em `America/Fortaleza`. Sem isso a suíte passaria às 10h e
-- falharia às 00h30, quando `now() - 3 horas` já caiu em ontem.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(72);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
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

create function pg_temp.fonte() returns int language sql as $$
  select id from public.sources where slug = 'captura_campo'
$$;
create function pg_temp.cad(p_slug text) returns int language sql as $$
  select id from public.cadences where slug = p_slug
$$;
create function pg_temp.passo(p_cad text, p_pos int) returns int language sql as $$
  select s.id from public.cadence_steps s join public.cadences c on c.id = s.cadence_id
   where c.slug = p_cad and s."position" = p_pos
$$;
create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('d0000000-0000-4000-8000-00000000fa' || p_n)::uuid
$$;
/* Uma hora escolhida do dia civil corrente em Fortaleza, devolvida como instante.
   É o que torna o arquivo independente da hora em que a suíte roda. */
create function pg_temp.hoje_as(p_hora int) returns timestamptz language sql as $$
  select (((now() at time zone 'America/Fortaleza')::date + make_time(p_hora, 0, 0))
          at time zone 'America/Fortaleza')
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('tela.admin@teste.local',      'admin',      'pgTAP tela das cadências'),
  ('tela.gestor@teste.local',     'gestor',     'pgTAP tela das cadências'),
  ('tela.sdr@teste.local',        'sdr',        'pgTAP tela das cadências'),
  ('tela.embaixador@teste.local', 'embaixador', 'pgTAP tela das cadências');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000fa001', 'tela.admin@teste.local',      '{"full_name":"Admin Tela"}'),
  ('a0000000-0000-4000-8000-0000000fa002', 'tela.gestor@teste.local',     '{"full_name":"Gestor Tela"}'),
  ('a0000000-0000-4000-8000-0000000fa003', 'tela.sdr@teste.local',        '{"full_name":"SDR Tela"}'),
  ('a0000000-0000-4000-8000-0000000fa004', 'tela.embaixador@teste.local', '{"full_name":"Embaixador Tela"}');

-- ---------- organizações do arquivo ----------
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, owner_id)
values
  (pg_temp.org('01'), 'TELA Buffet da Contagem', '+5584999996001', 'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('02'), 'TELA Carteira do Embaixador', '+5584999996002', 'Tirol', pg_temp.fonte(),
     'a0000000-0000-4000-8000-0000000fa004');


-- =====================================================================
-- 1. AS TRÊS FUNÇÕES EXISTEM E NÃO ESTÃO ABERTAS AO MUNDO
-- =====================================================================
select has_function('public', 'cadencias_visao', 'public.cadencias_visao existe');
select has_function('public', 'ligar_cadencia', array['text', 'boolean'],
                    'public.ligar_cadencia(text, boolean) existe');
select has_function('public', 'resumo_do_dia', array['uuid', 'text'],
                    'public.resumo_do_dia(uuid, text) existe');

select ok(not has_function_privilege('anon', 'public.cadencias_visao()', 'execute'),
          'anon não executa cadencias_visao');
select ok(not has_function_privilege('anon', 'public.ligar_cadencia(text, boolean)', 'execute'),
          'anon não executa ligar_cadencia');
select ok(not has_function_privilege('anon', 'public.resumo_do_dia(uuid, text)', 'execute'),
          'anon não executa resumo_do_dia');
select ok(has_function_privilege('authenticated', 'public.cadencias_visao()', 'execute'),
          'authenticated executa cadencias_visao');
select ok(has_function_privilege('authenticated', 'public.resumo_do_dia(uuid, text)', 'execute'),
          'authenticated executa resumo_do_dia');

select throws_ok($$ select public.cadencias_visao() $$, '42501',
                 null, 'cadencias_visao sem sessão levanta 42501');
select throws_ok($$ select public.resumo_do_dia() $$, '42501',
                 null, 'resumo_do_dia sem sessão levanta 42501');


-- =====================================================================
-- 2. A VISÃO TEM A FORMA QUE A TELA ESPERA
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000fa003', 'sdr');
insert into pg_temp.r values ('visao', public.cadencias_visao());
select pg_temp.sair();

select is((select jsonb_typeof(valor -> 'cadencias') from pg_temp.r where chave = 'visao'),
          'array', 'a visão traz um array de cadências');
select is((select jsonb_array_length(valor -> 'cadencias') from pg_temp.r where chave = 'visao'),
          (select count(*)::int from public.cadences),
          'traz TODAS as cadências do banco, ligadas e desligadas');
select is((select valor -> 'cadencias' -> 0 ->> 'slug' from pg_temp.r where chave = 'visao'),
          (select slug from public.cadences order by id limit 1),
          'as cadências saem ordenadas por id, como foram semeadas');

select is((select jsonb_array_length(valor -> 'cadencias' -> 0 -> 'passos')
             from pg_temp.r where chave = 'visao'),
          (select count(*)::int from public.cadence_steps s
            where s.cadence_id = (select id from public.cadences order by id limit 1)),
          'a primeira cadência traz todos os seus passos');
select ok((select bool_and(ordenado) from (
             select (p.valor ->> 'posicao')::int = p.ordinality::int as ordenado
               from pg_temp.r r,
                    jsonb_array_elements(r.valor -> 'cadencias' -> 0 -> 'passos')
                      with ordinality p(valor, ordinality)
              where r.chave = 'visao') x),
          'os passos vêm EM ORDEM: a posição n é o n-ésimo item do array');

select is((select valor -> 'cadencias' -> 0 -> 'passos' -> 0 ->> 'canal'
             from pg_temp.r where chave = 'visao'),
          'phone', 'o canal é atributo do PASSO (R13 §7): a régua da voz abre com ligação');
select ok((select (valor -> 'cadencias' -> 0 -> 'passos' -> 0 -> 'condicao') ? 'tem_telefone'
             from pg_temp.r where chave = 'visao'),
          'a condição do passo chega inteira, para a tela poder dizer quem é pulado');

-- O que a tela promete sobre honestidade sai de DADO, não de texto na tela.
select is((select valor -> 'envio' ->> 'modo_automatico' from pg_temp.r where chave = 'visao'),
          'false', 'a visão diz que o modo automático está desligado');
select is((select valor -> 'envio' -> 'worker_whatsapp' ->> 'ativo'
             from pg_temp.r where chave = 'visao'),
          'false', 'sem worker de WhatsApp batendo ponto, a visão diz false — nunca null');
select ok((select exists (select 1 from jsonb_array_elements(valor -> 'agendador') j
                           where j ->> 'job' = 'cadencias_agendar')
             from pg_temp.r where chave = 'visao'),
          'a visão nomeia o job que roda sozinho, com o horário dele');
select is((select jsonb_array_length(valor -> 'canais') from pg_temp.r where chave = 'visao'),
          4, 'os quatro canais com teto (RF-CON-10) vêm com teto e consumo do dia');
select ok((select bool_and((j ->> 'teto')::int > 0)
             from pg_temp.r r, jsonb_array_elements(r.valor -> 'canais') j
            where r.chave = 'visao'),
          'todo canal chega com teto positivo — teto zero seria régua parada em silêncio');


-- =====================================================================
-- 3. A CONTAGEM ANDA QUANDO A MATRÍCULA ANDA
-- =====================================================================
-- Uma matrícula parada no passo 2, com um toque pendente ali e um toque
-- feito no passo 1. É o cenário que a tela desenha.
insert into public.cadence_enrollments (id, cadence_id, organization_id, status, current_position)
values ('e0000000-0000-4000-8000-0000000fa001', pg_temp.cad('voz_primeiro'), pg_temp.org('01'),
        'ativa', 2);
insert into public.cadence_touches
  (enrollment_id, step_id, organization_id, channel, "position", status, due_at, done_at)
values ('e0000000-0000-4000-8000-0000000fa001', pg_temp.passo('voz_primeiro', 1), pg_temp.org('01'),
        'phone', 1, 'feito', pg_temp.hoje_as(9), pg_temp.hoje_as(9));
insert into public.cadence_touches
  (enrollment_id, step_id, organization_id, channel, "position", status, due_at)
values ('e0000000-0000-4000-8000-0000000fa001', pg_temp.passo('voz_primeiro', 2), pg_temp.org('01'),
        'phone', 2, 'pendente', pg_temp.hoje_as(10));

select pg_temp.entrar('a0000000-0000-4000-8000-0000000fa003', 'sdr');
insert into pg_temp.r values ('depois', public.cadencias_visao());
select pg_temp.sair();

create function pg_temp.cadencia(p_chave text, p_slug text) returns jsonb language sql as $$
  select j from pg_temp.r r, jsonb_array_elements(r.valor -> 'cadencias') j
   where r.chave = p_chave and j ->> 'slug' = p_slug
$$;
create function pg_temp.passo_json(p_chave text, p_slug text, p_pos int) returns jsonb
  language sql as $$
  select j from jsonb_array_elements(pg_temp.cadencia(p_chave, p_slug) -> 'passos') j
   where (j ->> 'posicao')::int = p_pos
$$;

select is((pg_temp.passo_json('depois', 'voz_primeiro', 2) ->> 'aqui')::int
          - (pg_temp.passo_json('visao', 'voz_primeiro', 2) ->> 'aqui')::int,
          1, 'a matrícula parada no passo 2 aparece como +1 "aqui" naquele passo');
select is((pg_temp.passo_json('depois', 'voz_primeiro', 1) ->> 'aqui')::int
          - (pg_temp.passo_json('visao', 'voz_primeiro', 1) ->> 'aqui')::int,
          0, 'e NÃO aparece no passo 1, que ela já deixou para trás');
select is((pg_temp.passo_json('depois', 'voz_primeiro', 2) ->> 'pendentes')::int
          - (pg_temp.passo_json('visao', 'voz_primeiro', 2) ->> 'pendentes')::int,
          1, 'o toque pendente conta como +1 no passo dele');
select is((pg_temp.passo_json('depois', 'voz_primeiro', 1) ->> 'feitos')::int
          - (pg_temp.passo_json('visao', 'voz_primeiro', 1) ->> 'feitos')::int,
          1, 'o toque feito conta como +1 feito no passo 1');
select is((pg_temp.passo_json('depois', 'voz_primeiro', 1) ->> 'pendentes')::int
          - (pg_temp.passo_json('visao', 'voz_primeiro', 1) ->> 'pendentes')::int,
          0, 'toque feito não vira pendente em lugar nenhum');
select is(((pg_temp.cadencia('depois', 'voz_primeiro') -> 'matriculas' ->> 'ativas')::int
           - (pg_temp.cadencia('visao', 'voz_primeiro') -> 'matriculas' ->> 'ativas')::int),
          1, 'a matrícula ativa conta no cabeçalho da cadência');
select is((pg_temp.cadencia('depois', 'reativacao') -> 'matriculas' ->> 'ativas')::int
          - (pg_temp.cadencia('visao', 'reativacao') -> 'matriculas' ->> 'ativas')::int,
          0, 'e não vaza para a contagem de OUTRA cadência');


-- =====================================================================
-- 4. DEFINER NÃO É PORTA ABERTA: A CONTAGEM RESPEITA A RLS
-- =====================================================================
-- O embaixador só enxerga a carteira dele. A matrícula acima é de uma
-- organização sem dono, então ele NÃO pode vê-la na contagem.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000fa004', 'embaixador');
insert into pg_temp.r values ('embaixador', public.cadencias_visao());
select pg_temp.sair();

select is((pg_temp.passo_json('embaixador', 'voz_primeiro', 2) ->> 'aqui')::int, 0,
          'o embaixador não conta matrícula de organização que não é dele');
select is((pg_temp.cadencia('embaixador', 'voz_primeiro') -> 'matriculas' ->> 'ativas')::int, 0,
          'nem no cabeçalho da cadência');
select is(jsonb_array_length(pg_temp.cadencia('embaixador', 'voz_primeiro') -> 'passos'),
          jsonb_array_length(pg_temp.cadencia('visao', 'voz_primeiro') -> 'passos'),
          'mas a RÉGUA ele vê inteira: passo é catálogo, não é dado de parceiro');

-- Agora uma matrícula na carteira DELE: aí conta.
insert into public.cadence_enrollments (id, cadence_id, organization_id, status, current_position)
values ('e0000000-0000-4000-8000-0000000fa002', pg_temp.cad('voz_primeiro'), pg_temp.org('02'),
        'ativa', 1);

select pg_temp.entrar('a0000000-0000-4000-8000-0000000fa004', 'embaixador');
insert into pg_temp.r values ('embaixador2', public.cadencias_visao());
select pg_temp.sair();

select is((pg_temp.passo_json('embaixador2', 'voz_primeiro', 1) ->> 'aqui')::int, 1,
          'a matrícula da carteira dele aparece — a contagem é dele, não é zero por regra');


-- =====================================================================
-- 5. O INTERRUPTOR
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000fa003', 'sdr');
select is(public.ligar_cadencia('voz_primeiro', false) ->> 'motivo', 'sem_permissao',
          'sdr recebe recusa LEGÍVEL, e não o zero-linhas silencioso do UPDATE sob RLS');
select is((select is_active::text from public.cadences where slug = 'voz_primeiro'), 'true',
          'e a cadência continua ligada de verdade');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000fa002', 'gestor');
select is(public.ligar_cadencia('voz_primeiro', false) ->> 'ok', 'true',
          'gestor desliga');
select is((select is_active::text from public.cadences where slug = 'voz_primeiro'), 'false',
          'e o banco registra o desligamento');
select is(public.ligar_cadencia('voz_primeiro', false) ->> 'mudou', 'false',
          'desligar de novo não é erro: diz que não mudou nada (idempotente)');
select is(public.ligar_cadencia('nao_existe_esta_cadencia', true) ->> 'motivo',
          'cadencia_inexistente', 'slug que não existe recebe recusa nomeada');
select is(public.ligar_cadencia('voz_primeiro', null) ->> 'motivo', 'estado_ausente',
          'pedido sem dizer ligar ou desligar é recusado, não adivinhado');
select pg_temp.sair();

-- A promessa central do botão: desligar fecha a ENTRADA, não encerra ninguém.
select is((select status::text from public.cadence_enrollments
            where id = 'e0000000-0000-4000-8000-0000000fa001'),
          'ativa', 'desligar NÃO encerra quem já está dentro');
select is((select count(*)::int from public.cadence_touches
            where enrollment_id = 'e0000000-0000-4000-8000-0000000fa001'
              and status = 'pendente'),
          1, 'e o toque pendente de quem está dentro continua de pé');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000fa002', 'gestor');
select is(public.matricular_em_cadencia(pg_temp.org('02'), 'voz_primeiro') ->> 'ok', 'false',
          'com a cadência desligada, ninguém novo entra');
select is(public.ligar_cadencia('voz_primeiro', true) ->> 'ativa', 'true',
          'gestor religa');
select pg_temp.sair();
select is((select is_active::text from public.cadences where slug = 'voz_primeiro'), 'true',
          'e a cadência volta a aceitar matrícula');

select ok(exists (select 1 from public.audit_log
                   where table_name = 'cadences'
                     and action in ('LIGAR_CADENCIA', 'DESLIGAR_CADENCIA')
                     and (new_data ->> 'cadencia') = 'voz_primeiro'),
          'ligar e desligar ficam no audit_log com o nome que a tela usa');


-- =====================================================================
-- 6. O MODO AUTOMÁTICO EXISTE PARA SER LIDO, NÃO PARA SER LIGADO
-- =====================================================================
select is((select value ->> 'ligado' from public.app_settings where key = 'cadencia.modo_automatico'),
          'false', 'a flag do RF-CON-09 nasce desligada');
select is((select value ->> 'decisao' from public.app_settings where key = 'cadencia.modo_automatico'),
          'ADR-05', 'e diz de qual decisão ela vem');

select throws_ok(
  $$ update public.app_settings set value = jsonb_set(value, '{ligado}', 'true')
      where key = 'cadencia.modo_automatico' $$,
  '42501', null, 'ligar o modo automático por UPDATE é recusado com 42501');
select throws_ok(
  $$ insert into public.app_settings (key, value)
     values ('cadencia.modo_automatico', '{"ligado": true}'::jsonb)
     on conflict (key) do update set value = excluded.value $$,
  '42501', null, 'e por INSERT ... ON CONFLICT também');
select is((select value ->> 'ligado' from public.app_settings where key = 'cadencia.modo_automatico'),
          'false', 'depois das duas tentativas, a flag continua desligada');

-- O gatilho novo não pode ter engolido o antigo: o teto duro do RF-CON-10 segue valendo.
select throws_ok(
  $$ update public.app_settings
        set value = jsonb_set(value, '{whatsapp,semana1}', '500')
      where key = 'cadencia.tetos' $$,
  '23514', null, 'o teto duro do RF-CON-10 continua sendo validado (o gatilho antigo segue vivo)');


-- =====================================================================
-- 7. O RESUMO DO DIA
-- =====================================================================
-- Um dia de trabalho do SDR do arquivo: uma reunião marcada para hoje, uma
-- ligação registrada hoje com desfecho de porta ABERTA e uma tarefa vencida.
insert into public.tasks (id, title, kind, status, due_at, assignee_id, organization_id)
values ('7a000000-0000-4000-8000-0000000fa001', 'Apresentação TELA', 'meeting', 'todo',
        pg_temp.hoje_as(10), 'a0000000-0000-4000-8000-0000000fa003', pg_temp.org('01'));
insert into public.activities (type, organization_id, user_id, occurred_at, outcome_id, channel)
values ('call', pg_temp.org('01'), 'a0000000-0000-4000-8000-0000000fa003', pg_temp.hoje_as(9),
        (select id from public.interaction_outcomes where slug = 'lig_interessado'), 'phone');

select pg_temp.entrar('a0000000-0000-4000-8000-0000000fa003', 'sdr');
insert into pg_temp.r values ('manha', public.resumo_do_dia(null, 'manha'));
insert into pg_temp.r values ('noite', public.resumo_do_dia(null, 'noite'));
select pg_temp.sair();

create function pg_temp.res(p_chave text, p_caminho text[]) returns jsonb language sql as $$
  select valor #> p_caminho from pg_temp.r where chave = p_chave
$$;

select is(pg_temp.res('manha', '{dia}') #>> '{}',
          ((now() at time zone 'America/Fortaleza')::date)::text,
          'o resumo é do dia civil de Fortaleza, não do dia UTC do servidor');
select is(pg_temp.res('manha', '{momento}') #>> '{}', 'manha',
          'o momento pedido manda sobre o relógio');
select is(pg_temp.res('noite', '{momento}') #>> '{}', 'noite',
          'e o outro recorte também é acessível a qualquer hora');
select ok(pg_temp.res('manha', '{momento_do_relogio}') #>> '{}' in ('manha', 'noite'),
          'mas a tela sempre sabe qual dos dois o relógio pediria');

select is(pg_temp.res('manha', '{entrega,envio_automatico}') #>> '{}', 'false',
          'o resumo diz, em dado, que NÃO é enviado a ninguém');
select is(pg_temp.res('manha', '{entrega,horario_manha}') #>> '{}', '07:30',
          'e carrega os horários prometidos no RF-AST-02');

select ok(exists (select 1 from jsonb_array_elements(pg_temp.res('manha', '{agenda}')) j
                   where j ->> 'task_id' = '7a000000-0000-4000-8000-0000000fa001'),
          'a reunião de hoje entra na agenda da manhã');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.res('manha', '{fila}')) j
                   where j ->> 'organizacao' = 'TELA Buffet da Contagem'),
          'e a mesma organização entra na fila, com o porquê que vem do meu_dia');
select ok((select bool_and(j ->> 'motivo' is not null)
             from jsonb_array_elements(pg_temp.res('manha', '{fila}')) j),
          'todo item da fila carrega o motivo: a fila nunca manda fazer sem dizer por quê');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.res('manha', '{fila}')) j
                       where j ->> 'tipo' = 'tarefa_futura'),
          'o que tem data à frente fica fora do resumo de hoje');

select is((pg_temp.res('noite', '{feito,registros}') #>> '{}')::int, 1,
          'a noite conta o registro feito hoje');
select is((pg_temp.res('noite', '{feito,portas_abertas}') #>> '{}')::int, 1,
          'e reconhece a porta ABERTA pelo counts_as do catálogo de desfechos');
select is((pg_temp.res('noite', '{feito,portas_batidas}') #>> '{}')::int, 0,
          'sem confundir porta aberta com porta batida');
select is(pg_temp.res('noite', '{sem_registro}') #>> '{}', 'false',
          'com registro no dia, sem_registro é falso');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.res('noite', '{feito,por_tipo}')) j
                   where j ->> 'tipo' = 'call' and (j ->> 'quantos')::int = 1),
          'e a noite sabe dizer que tipo de contato foi');

-- Quem não registrou nada não pode receber um zero acusatório (R07 §8.2).
select pg_temp.entrar('a0000000-0000-4000-8000-0000000fa004', 'embaixador');
insert into pg_temp.r values ('vazio', public.resumo_do_dia(null, 'noite'));
select pg_temp.sair();
select is(pg_temp.res('vazio', '{sem_registro}') #>> '{}', 'true',
          'quem não registrou nada hoje é marcado como "não registrou", não como zero');
select is((pg_temp.res('vazio', '{feito,registros}') #>> '{}')::int, 0,
          'e o contador continua honesto: zero é zero');

-- O resumo dos outros.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000fa003', 'sdr');
select throws_ok(
  $$ select public.resumo_do_dia('a0000000-0000-4000-8000-0000000fa004'::uuid, 'manha') $$,
  '42501', null, 'sdr não lê o resumo de outra pessoa');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000fa002', 'gestor');
insert into pg_temp.r values ('do_outro',
  public.resumo_do_dia('a0000000-0000-4000-8000-0000000fa003'::uuid, 'manha'));
select pg_temp.sair();
select is(pg_temp.res('do_outro', '{pessoa,id}') #>> '{}',
          'a0000000-0000-4000-8000-0000000fa003',
          'gestor lê o resumo de quem quiser');
select is(pg_temp.res('do_outro', '{pessoa,eu_mesmo}') #>> '{}', 'false',
          'e a tela sabe que não está olhando o próprio dia');

select * from finish();
rollback;

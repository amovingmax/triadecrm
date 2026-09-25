-- =====================================================================
-- pgTAP — A reunião vira objeto do banco (migração 20260930110000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. A TRAVA. O índice RECUSA a segunda reunião viva que se sobrepõe à
--      primeira do mesmo dono (23P01), e encostar NÃO é sobrepor — o
--      intervalo é `[)`, então a de 11h10 cabe depois da que termina 11h00.
--      A trava é a restrição de exclusão GiST, não um `select` antes do
--      `insert`: esse é janela de corrida em qualquer linguagem, e daqui a
--      pouco são dois worker-ai.
--      NÃO se prova aqui com duas sessões. `dblink` de dentro da transação
--      do pgTAP é deadlock que o Postgres não detecta: esta transação segura
--      o advisory lock de (dono, dia) e a linha não comitada no índice, a
--      outra sessão bloqueia num dos dois, e esta bloqueia na leitura do
--      socket. A concorrência real é garantia do índice e está no roteiro de
--      homologação (10.4).
--   2. A GRADE. Nove começos entre 9h30 e 17h20, nenhum terminando depois
--      das 17h20; feriado INSERIDO NO DIA DA FIXTURE não aparece; dia com
--      rota planejada não oferece nada a partir de 13h40; a 5ª do dia é
--      recusada pelo teto.
--   3. O MOVIMENTO DO NEGÓCIO sem 23514, e SÓ PARA A FRENTE: `app.deals_
--      before_write` cobra `next_action_at` em qualquer update de etapa cuja
--      spec seja timestamptz; e negócio já adiantado não volta para trás.
--   4. A PORTA FECHADA. `authenticated` não faz insert nem update direto em
--      `public.reunioes`; `app.email_de` não é executável por ele.
--   5. A RAMPA. Enquanto ligada, o robô marca `a_confirmar` e a função diz
--      `precisa_confirmacao`; a data de saída conta do dia da migração;
--      correção do robô empurra a data.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada, e NENHUMA
-- depende de data escrita à mão: tudo é relativo a `now()`.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(67);

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

-- ---------- quem atende (fixture, e não gente de verdade) ----------
-- Um banco recém-resetado não tem NENHUM perfil: `supabase/seed.sql` semeia
-- `allowed_users`, não `auth.users`. O caminho é o mesmo do login real
-- (RF-ADM-01) e o `rollback` desfaz tudo.
create function pg_temp.contratar(p_nome text, p_papel text) returns uuid
language plpgsql as $$
declare
  v_id    uuid  := gen_random_uuid();
  v_email text  := 'pgtap74.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                   || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 74 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  update public.profiles set sala_url = 'https://sala.invalid/' || v_id::text where id = v_id;
  return v_id;
end $$;
create temp table equipe74(papel text primary key, id uuid not null);
insert into equipe74(papel, id) values
  ('dono',  pg_temp.contratar('Doralice Pgtap74', 'gestor')),
  ('dono2', pg_temp.contratar('Damiao Pgtap74',   'gestor')),
  -- A terceira agenda existe só para provar a TRAVA e a BORDA, e não recebe
  -- nada pelo caminho de produto: medir sobreposição numa agenda que as
  -- outras asserções vão enchendo é medir a ordem do arquivo, não o índice.
  ('dono3', pg_temp.contratar('Dagoberto Pgtap74', 'gestor'));
create function pg_temp.dono()  returns uuid language sql as $$ select id from equipe74 where papel='dono'  $$;
create function pg_temp.dono2() returns uuid language sql as $$ select id from equipe74 where papel='dono2' $$;
create function pg_temp.dono3() returns uuid language sql as $$ select id from equipe74 where papel='dono3' $$;

-- ---------- a ficha, o negócio e a conversa ----------
create function pg_temp.nascer_org(p_nome text, p_dono uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.organizations (kind, name, source_id, collector, owner_id, phone_e164)
  select 'fornecedor'::app.org_kind, p_nome, s.id, 'pgtap74', p_dono,
         '+5584988' || lpad((random()*99999)::int::text, 5, '0')
    from public.sources s order by s.id limit 1
  returning id into v_id;
  return v_id;
end $$;

create temp table fixt74(chave text primary key, id uuid not null);
insert into fixt74(chave, id) values
  ('org',  pg_temp.nascer_org('Buffet Pgtap74', pg_temp.dono())),
  ('org2', pg_temp.nascer_org('Buffet Pgtap74 Adiantado', pg_temp.dono())),
  ('org3', pg_temp.nascer_org('Buffet Pgtap74 Sem Ficha', pg_temp.dono())),
  ('org4', pg_temp.nascer_org('Buffet Pgtap74 Do Robo', pg_temp.dono2()));
create function pg_temp.org()  returns uuid language sql as $$ select id from fixt74 where chave='org'  $$;
create function pg_temp.org2() returns uuid language sql as $$ select id from fixt74 where chave='org2' $$;
create function pg_temp.org3() returns uuid language sql as $$ select id from fixt74 where chave='org3' $$;
create function pg_temp.org4() returns uuid language sql as $$ select id from fixt74 where chave='org4' $$;

-- Um dia útil três dias úteis à frente: sempre dentro do horizonte de 10,
-- sempre além da antecedência de 3 h, e `next_business_day` já pulou
-- sábado, domingo e feriado.
--
-- CONGELADO NUMA TABELA, e não recalculado a cada chamada: o teste do
-- feriado insere o feriado NESTE dia, e `app.next_business_day` pula
-- feriado — uma função que recalculasse passaria a devolver o dia SEGUINTE,
-- a grade desse outro dia viria limpa, e a asserção do feriado ficaria
-- verde sem nada ter sido bloqueado.
create temp table dia74 as
  select app.next_business_day((now() at time zone 'America/Fortaleza')::date, 3) as d;
create function pg_temp.dia() returns date language sql stable as $$
  select d from dia74
$$;

-- Um negócio em `em_conversa` (posição 4) e outro já em
-- `apresentacao_realizada` (posição 6), que é o que prova o "só para a frente".
create function pg_temp.nascer_deal(p_org uuid, p_slug text, p_dono uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
  select p_org, 1, st.id, p_dono from public.stages st
   where st.pipeline_id = 1 and st.slug = p_slug
  returning id into v_id;
  return v_id;
end $$;

insert into fixt74(chave, id) values
  ('negocio',           pg_temp.nascer_deal(pg_temp.org(),  'em_conversa',            pg_temp.dono())),
  ('negocio_adiantado', pg_temp.nascer_deal(pg_temp.org2(), 'apresentacao_realizada', pg_temp.dono()));
create function pg_temp.negocio() returns uuid language sql as $$
  select id from fixt74 where chave='negocio' $$;
create function pg_temp.negocio_adiantado() returns uuid language sql as $$
  select id from fixt74 where chave='negocio_adiantado' $$;

-- As conversas. A terceira é a que NÃO tem ficha.
create function pg_temp.nascer_conversa(p_org uuid, p_deal uuid, p_dono uuid, p_fone text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.conversations (peer_phone_e164, business_number, organization_id,
                                    deal_id, assignee_id)
  values (p_fone, '+5584900000074', p_org, p_deal, p_dono)
  returning id into v_id;
  return v_id;
end $$;
insert into fixt74(chave, id) values
  ('conversa',           pg_temp.nascer_conversa(pg_temp.org(),  pg_temp.negocio(),           pg_temp.dono(),  '+5584988000741')),
  ('conversa2',          pg_temp.nascer_conversa(pg_temp.org2(), pg_temp.negocio_adiantado(), pg_temp.dono(),  '+5584988000742')),
  ('conversa_sem_ficha', pg_temp.nascer_conversa(null,           null,                        pg_temp.dono(),  '+5584988000743')),
  ('conversa_robo',      pg_temp.nascer_conversa(pg_temp.org4(), null,                        pg_temp.dono2(), '+5584988000744'));
create function pg_temp.conversa()           returns uuid language sql as $$ select id from fixt74 where chave='conversa'           $$;
create function pg_temp.conversa2()          returns uuid language sql as $$ select id from fixt74 where chave='conversa2'          $$;
create function pg_temp.conversa_sem_ficha() returns uuid language sql as $$ select id from fixt74 where chave='conversa_sem_ficha' $$;
create function pg_temp.conversa_robo()      returns uuid language sql as $$ select id from fixt74 where chave='conversa_robo'      $$;

-- Os dois primeiros começos livres do dia da fixture, congelados: a grade
-- muda assim que a primeira reunião é gravada.
create temp table livres74 as
  select row_number() over (order by h.inicio) as n, h.inicio, h.fim
    from app.reuniao_horarios_livres((select id from equipe74 where papel='dono'),
           (select d from dia74), (select d from dia74), 50) h;
create function pg_temp.livre1() returns timestamptz language sql stable as $$
  select inicio from livres74 where n = 1 $$;
create function pg_temp.livre2() returns timestamptz language sql stable as $$
  select inicio from livres74 where n = 2 $$;

-- As fixtures são lidas de dentro da sessão `authenticated` nas asserções
-- que entram como gente (confirmar, cancelar, remarcar, fechar).
grant select on equipe74, fixt74, dia74, livres74 to authenticated;


select has_table('public', 'reunioes', 'a tabela public.reunioes existe');

-- =====================================================================
-- 1. A porta fechada: escrita só pelas funções
-- =====================================================================
select ok((select relrowsecurity from pg_class where oid = 'public.reunioes'::regclass),
  'reunioes tem RLS ligada');
select policy_cmd_is('public', 'reunioes', 'reunioes_select', 'SELECT',
  'a única política de reunioes é de leitura');
select ok(not has_table_privilege('authenticated', 'public.reunioes', 'INSERT'),
  'authenticated NÃO insere direto em public.reunioes: escrita só pelas funções');
select ok(not has_table_privilege('authenticated', 'public.reunioes', 'UPDATE'),
  'authenticated NÃO atualiza direto em public.reunioes');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.reunioes'::regclass
                    and tgname = 'reunioes_audit'),
  'reunioes é auditada: reunião marcada por robô é o que o CLAUDE.md manda auditar');

-- =====================================================================
-- 2. A fila do aviso existe ANTES de quem a usa
-- =====================================================================
select is((select worker from public.ingest_queues where name = 'reuniao_avisos'), 'wa',
  'a fila do aviso é do worker-wa: é nele que já vivem a chave do Resend e o laço que lê fila');
select is((select dlq from public.ingest_queues where name = 'reuniao_avisos'), 'reuniao_avisos_dlq',
  'com dead-letter própria');
select is((select max_attempts from public.ingest_queues where name = 'reuniao_avisos'), 5,
  'cinco tentativas');
select ok(exists (select 1 from pgmq.list_queues() q where q.queue_name = 'reuniao_avisos'),
  'a fila pgmq EXISTE: inserir em ingest_queues não a cria, e app.esteira_enfileirar derrubaria a transação inteira de reuniao_marcar');

-- =====================================================================
-- 3. Dia útil: uma regra, dois usos (ADR-03)
-- (estas quatro podem ter data escrita: são aritmética de calendário e
--  não dependem de `now()`)
-- =====================================================================
select ok(app.eh_dia_util(date '2026-10-01'), 'quinta comum é dia útil');
select ok(not app.eh_dia_util(date '2026-10-03'), 'sábado não é dia útil');
select ok(not app.eh_dia_util(date '2026-09-07'), 'feriado nacional não é dia útil');
select is(app.next_business_day(date '2026-09-04', 1), date '2026-09-08',
  'next_business_day continua pulando o feriado depois de passar a chamar eh_dia_util');

-- =====================================================================
-- 4. A configuração, a sala e a data de saída da rampa
-- =====================================================================
select ok(exists (select 1 from public.app_settings where key = 'agenda.reunioes'),
  'a configuração da agenda mora em app_settings, ao lado de rotas.planejador');
select is((select (value #>> '{janela,inicio}') from public.app_settings where key='agenda.reunioes'),
  '09:30', 'a janela começa 9h30 — o horário que o Rafael deu');
select is((select (value #>> '{janela,fim}') from public.app_settings where key='agenda.reunioes'),
  '17:20', 'a janela termina 17h20');
select is((app.reuniao_config() #>> '{rampa,ate}')::date,
  (now() at time zone 'America/Fortaleza')::date + 7,
  'a data de saída da rampa conta do dia em que a migração rodou, e não de um 2026-10-09 escrito à mão que faria a rampa nascer vencida em todo db:reset a partir de 10/10');
select has_column('public', 'profiles', 'sala_url', 'cada pessoa cola a sala dela em Ajustes');

-- =====================================================================
-- 5. A GRADE
-- =====================================================================
select is(
  (select count(*)::int from app.reuniao_horarios_livres(pg_temp.dono(), pg_temp.dia(), pg_temp.dia(), 50)),
  9, 'a grade de 9h30 a 17h20 dá exatamente nove começos num dia limpo');
select is(
  (select min(h.inicio) from app.reuniao_horarios_livres(pg_temp.dono(), pg_temp.dia(), pg_temp.dia(), 50) h),
  (pg_temp.dia() + time '09:30') at time zone 'America/Fortaleza',
  'o primeiro começo é 9h30');
select ok(
  (select max((h.fim at time zone 'America/Fortaleza')::time)
     from app.reuniao_horarios_livres(pg_temp.dono(), pg_temp.dia(), pg_temp.dia(), 50) h) <= time '17:20',
  'nenhum horário termina depois de 17h20');

-- O FERIADO. Inserido NO PRÓPRIO DIA da fixture, e não numa data do seed:
-- `app.reuniao_horarios_livres` grampeia o intervalo em [hoje, horizonte], e
-- qualquer feriado passado ou além de 10 dias úteis devolveria zero linhas
-- com feriado ou sem — asserção verde que não prova nada.
insert into public.holidays (date, name, scope)
values (pg_temp.dia(), 'Feriado de teste (pgTAP 74)', 'municipal');
select is(
  (select count(*)::int from app.reuniao_horarios_livres(pg_temp.dono(), pg_temp.dia(), pg_temp.dia(), 50)),
  0, 'feriado em public.holidays não aparece na grade');
delete from public.holidays where name = 'Feriado de teste (pgTAP 74)';

-- A ROTA: route_plans 'pronta' para (dono, dia).
insert into public.route_plans (plan_date, assignee_id, origin_label, origin_lat, origin_lng, status)
values (pg_temp.dia(), pg_temp.dono(), 'fixture', -5.7945, -35.2094, 'pronta'::app.route_status);
select ok(
  (select max(h.inicio) from app.reuniao_horarios_livres(pg_temp.dono(), pg_temp.dia(), pg_temp.dia(), 50) h)
    < (pg_temp.dia() + time '13:40') at time zone 'America/Fortaleza',
  'dia com rota planejada não oferece nada a partir de 13h40: a tarde inteira é da rota');
delete from public.route_plans where assignee_id = pg_temp.dono();

-- O TETO: quatro reuniões vivas no dia, nos quatro primeiros começos.
-- Inseridas direto (o pgTAP roda como superusuário), porque o que se mede
-- aqui é a régua da grade e não o caminho de escrita.
insert into public.reunioes (organization_id, dono_id, titulo, formato, inicio, fim,
                             link, estado, marcada_por, marcada_por_id)
select pg_temp.org(), pg_temp.dono(), 'teto ' || n, 'online',
       h.inicio, h.fim, 'https://sala.invalid/teto', 'marcada', 'pessoa', pg_temp.dono()
  from (select row_number() over (order by x.inicio) as n, x.inicio, x.fim
          from app.reuniao_horarios_livres(pg_temp.dono(), pg_temp.dia(), pg_temp.dia(), 50) x) h(n, inicio, fim)
 where h.n <= 4;
select is(
  (select count(*)::int from app.reuniao_horarios_livres(pg_temp.dono(), pg_temp.dia(), pg_temp.dia(), 50)),
  0, 'a 5ª reunião do dia não é oferecida: o teto é 4 por pessoa por dia');
delete from public.reunioes where dono_id = pg_temp.dono() and titulo like 'teto %';

-- =====================================================================
-- 6. MARCAR: recusa sem ficha, move o negócio sem 23514, e só para a frente
-- =====================================================================
select is(public.reuniao_marcar(pg_temp.conversa_sem_ficha(), pg_temp.livre1()) ->> 'motivo',
  'sem_ficha',
  'conversa fora da base recusa com sem_ficha: marcar com quem o CRM não sabe quem é produz compromisso que ninguém consegue preparar');

select ok(coalesce((public.reuniao_marcar(pg_temp.conversa(), pg_temp.livre1()) ->> 'ok')::boolean, false),
  'o robô marca pela conversa');
select is((select st.slug from public.stages st
            join public.deals d on d.stage_id = st.id
           where d.id = pg_temp.negocio()),
  'reuniao_marcada',
  'marcar moveu o negócio para a etapa que exige meeting_at — SEM levantar 23514');
select is((select count(*)::int from public.deal_stage_history h where h.deal_id = pg_temp.negocio()
             and h.to_stage_id = (select id from public.stages where slug='reuniao_marcada' and pipeline_id=1)),
  1, 'o histórico de etapa tem UMA linha: quem grava é o gatilho deals_track_stage, não a função');
select is((select count(*)::int from public.tasks t
            join public.reunioes r on r.task_id = t.id where r.conversation_id = pg_temp.conversa()),
  1, 'a reunião tem eco em tasks: o pulso do dia e o dreno continuam vendo o compromisso');
select is((select r.estado from public.reunioes r where r.conversation_id = pg_temp.conversa()),
  'a_confirmar',
  'enquanto a rampa está ligada, a reunião do robô nasce "a confirmar": o fornecedor ainda não sabe o horário');
select ok((public.reuniao_marcar(pg_temp.conversa_robo(), pg_temp.livre1()) ->> 'precisa_confirmacao')::boolean,
  'e a função DIZ que precisa de confirmação, para o robô não prometer o horário antes do clique');

-- A CORREÇÃO QUE O PLANO ANTERIOR NÃO TINHA: negócio adiantado não anda para trás.
select ok(coalesce((public.reuniao_marcar(pg_temp.conversa2(), pg_temp.livre2()) ->> 'ok')::boolean, false),
  'o robô marca a segunda reunião, com quem já apresentou');
select is((select st.slug from public.stages st
            join public.deals d on d.stage_id = st.id
           where d.id = pg_temp.negocio_adiantado()),
  'apresentacao_realizada',
  'segunda reunião com quem já apresentou NÃO empurra o negócio de volta para Reunião marcada — e não reabre um ganho');
select is((select d.next_action_at from public.deals d where d.id = pg_temp.negocio_adiantado()),
  pg_temp.livre2(),
  'mas a próxima ação passa a ser a reunião nova, com ou sem mudança de etapa');

-- =====================================================================
-- 7. A TRAVA, e a borda — as asserções que dão nome a esta fase
--
-- Sem `dblink`: o porquê está no cabeçalho deste arquivo.
-- =====================================================================
select ok((select pg_get_constraintdef(oid) from pg_constraint
            where conrelid = 'public.reunioes'::regclass
              and conname  = 'reunioes_sem_colisao') like 'EXCLUDE USING gist%',
  'a trava é uma restrição de exclusão GiST, e não um select antes do insert');

-- A primeira da agenda limpa do dono3, às `livre1()`, 40 minutos.
insert into public.reunioes (organization_id, dono_id, titulo, formato, inicio, fim,
                             link, estado, marcada_por, marcada_por_id)
select pg_temp.org(), pg_temp.dono3(), 'trava-base', 'online',
       pg_temp.livre1(), pg_temp.livre1() + interval '40 minutes',
       'https://sala.invalid/x', 'marcada', 'pessoa', pg_temp.dono3();

select throws_ok($x$
  insert into public.reunioes (organization_id, dono_id, titulo, formato, inicio, fim,
                               link, estado, marcada_por, marcada_por_id)
  select pg_temp.org(), pg_temp.dono3(), 'colisão', 'online',
         pg_temp.livre1() + interval '10 minutes',
         pg_temp.livre1() + interval '50 minutes',
         'https://sala.invalid/x', 'marcada', 'pessoa', pg_temp.dono3()
$x$, '23P01', null,
  'o índice RECUSA a segunda reunião viva que se sobrepõe à primeira do mesmo dono');

select lives_ok($x$
  insert into public.reunioes (organization_id, dono_id, titulo, formato, inicio, fim,
                               link, estado, marcada_por, marcada_por_id)
  select pg_temp.org(), pg_temp.dono3(), 'encostada', 'online',
         pg_temp.livre1() + interval '40 minutes',
         pg_temp.livre1() + interval '80 minutes',
         'https://sala.invalid/x', 'marcada', 'pessoa', pg_temp.dono3()
$x$, 'encostar NÃO é sobrepor: tstzrange [) deixa a reunião começar no minuto em que a anterior termina');

-- E a MESMA sobreposição passa quando a primeira já não está viva: a trava
-- é parcial de propósito, senão reunião cancelada seguraria o horário dela
-- para sempre.
update public.reunioes set estado = 'cancelada' where titulo = 'trava-base';
select lives_ok($x$
  insert into public.reunioes (organization_id, dono_id, titulo, formato, inicio, fim,
                               link, estado, marcada_por, marcada_por_id)
  select pg_temp.org(), pg_temp.dono3(), 'por cima da cancelada', 'online',
         pg_temp.livre1() + interval '10 minutes',
         pg_temp.livre1() + interval '30 minutes',
         'https://sala.invalid/x', 'marcada', 'pessoa', pg_temp.dono3()
$x$, 'reunião cancelada NÃO segura o horário: a restrição de exclusão é parcial');
delete from public.reunioes where dono_id = pg_temp.dono3();

-- E o caminho de produto, que é o que o robô vê.
select is(public.reuniao_marcar(pg_temp.conversa_robo(), pg_temp.livre1()) ->> 'motivo',
  'horario_indisponivel',
  'pedir um horário já ocupado recusa antes do insert: a reconferência de app.reuniao_horarios_livres vem primeiro');
select is(
  jsonb_array_length(public.reuniao_marcar(pg_temp.conversa_robo(), pg_temp.livre1()) -> 'alternativas'),
  3, 'e devolve três alternativas no MESMO retorno: o robô não precisa de segunda ida ao banco');

-- =====================================================================
-- 8. Quem executa o quê
-- =====================================================================
select ok(not has_function_privilege('authenticated',
  'public.reuniao_marcar(uuid,timestamptz,text,text)', 'EXECUTE'),
  'a porta do robô não é executável por authenticated: a tela marca pelo negócio');
select ok(has_function_privilege('authenticated',
  'public.reuniao_marcar_pelo_negocio(uuid,timestamptz,text,text,text)', 'EXECUTE'),
  'a porta da pessoa é');
select ok(not has_function_privilege('service_role',
  'public.reuniao_marcar_pelo_negocio(uuid,timestamptz,text,text,text)', 'EXECUTE'),
  'e o robô NÃO a tem: ela recusa sem auth.uid(), e grant que só devolve sem_permissao é porta pintada na parede');

-- =====================================================================
-- 9. A RAMPA: chave com data de saída, não passo manual eterno
-- =====================================================================
select ok(app.reuniao_rampa_ativa(),
  'a rampa nasce ligada: na primeira semana alguém confirma antes de o fornecedor ver o horário');
update public.app_settings
   set value = jsonb_set(value, '{rampa,ate}',
         to_jsonb(((now() at time zone 'America/Fortaleza')::date - 1)::text))
 where key = 'agenda.reunioes';
select ok(not app.reuniao_rampa_ativa(),
  'passada a data de saída o clique some sozinho: a rampa é chave com data, não passo manual eterno');
select is(app.reuniao_rampa_adiar(), null,
  'correção depois do fim da rampa NÃO a ressuscita');
-- devolve a rampa ao estado de nascimento para o resto do arquivo
update public.app_settings
   set value = jsonb_set(value, '{rampa,ate}',
         to_jsonb(((now() at time zone 'America/Fortaleza')::date + 7)::text))
 where key = 'agenda.reunioes';

-- =====================================================================
-- 11. CONFIRMAR, CANCELAR, REMARCAR E FECHAR — de gente, nesta fase
-- =====================================================================
create function pg_temp.reuniao_de(p_conversa uuid) returns uuid language sql stable as $$
  select r.id from public.reunioes r
   where r.conversation_id = p_conversa and r.estado <> 'remarcada'
   order by r.criada_em desc limit 1
$$;

select pg_temp.entrar(pg_temp.dono2(), 'gestor');
select is(public.reuniao_confirmar(pg_temp.reuniao_de(pg_temp.conversa_robo())) ->> 'estado', 'marcada',
  'um clique tira a reunião do robô de "a confirmar"');
select pg_temp.sair();
select is((select estado from public.reunioes where id = pg_temp.reuniao_de(pg_temp.conversa_robo())),
  'marcada', 'e o banco concorda');

-- A RAMPA ANDANDO: a semana começou há alguns dias, e a correção a empurra.
update public.app_settings
   set value = jsonb_set(value, '{rampa,ate}',
         to_jsonb(((now() at time zone 'America/Fortaleza')::date + 2)::text))
 where key = 'agenda.reunioes';
create temp table rampa74 as select (app.reuniao_config() #>> '{rampa,ate}')::date as d;

-- REMARCAR. A antiga sai do caminho antes de a nova entrar.
create temp table remarcada74 as select pg_temp.reuniao_de(pg_temp.conversa()) as antiga;
grant select on remarcada74 to authenticated;
select pg_temp.entrar(pg_temp.dono(), 'gestor');
create temp table nova74 as
  select public.reuniao_remarcar((select antiga from remarcada74),
           (select inicio from livres74 where n = 4)) as r;
select pg_temp.sair();
select ok(coalesce(((select r from nova74) ->> 'ok')::boolean, false),
  'remarcar devolve ok');
select is((select estado from public.reunioes where id = (select antiga from remarcada74)), 'remarcada',
  'remarcar NÃO altera a linha: marca a antiga como remarcada');
select is((select remarcada_de from public.reunioes
            where id = ((select r from nova74) ->> 'reuniao_id')::uuid),
  (select antiga from remarcada74), 'e a nova aponta para ela');
select is((select status::text from public.tasks t
            join public.reunioes r on r.task_id = t.id
           where r.id = (select antiga from remarcada74)), 'cancelled',
  'o eco da antiga é cancelado junto: reunião e tarefa andam em par');
select ok((select (app.reuniao_config() #>> '{rampa,ate}')::date) > (select d from rampa74),
  'correção numa reunião do robô empurra a data de saída da rampa: "passada a semana SEM correção"');

-- CANCELAR.
select pg_temp.entrar(pg_temp.dono(), 'gestor');
select is(public.reuniao_cancelar(((select r from nova74) ->> 'reuniao_id')::uuid,
            'o parceiro desmarcou') ->> 'estado', 'cancelada',
  'cancelar fecha a reunião pelo cartão');
select pg_temp.sair();
select is((select status::text from public.tasks t
            join public.reunioes r on r.task_id = t.id
           where r.id = ((select r from nova74) ->> 'reuniao_id')::uuid), 'cancelled',
  'e cancela o eco junto');

-- O DESFECHO, e o horário que volta à grade.
select pg_temp.entrar(pg_temp.dono2(), 'gestor');
select is(public.reuniao_desfecho(pg_temp.reuniao_de(pg_temp.conversa_robo()), 'nao_compareceu') ->> 'estado',
  'nao_compareceu',
  'o desfecho da tela fecha a reunião: sem isto a linha fica "marcada" para sempre, segurando o horário na trava e contando no teto do dia');
select pg_temp.sair();
select is(
  (select count(*)::int
     from app.reuniao_horarios_livres(pg_temp.dono2(), pg_temp.dia(), pg_temp.dia(), 50)),
  9, 'e o horário volta à grade assim que a reunião deixa de estar viva');
select is(public.reuniao_desfecho(pg_temp.reuniao_de(pg_temp.conversa_robo()), 'remarcada') ->> 'motivo',
  'estado_invalido',
  'o desfecho só aceita "realizada" e "nao_compareceu": remarcar tem porta própria');

-- devolve a rampa ao estado de nascimento para o resto do arquivo
update public.app_settings
   set value = jsonb_set(value, '{rampa,ate}',
         to_jsonb(((now() at time zone 'America/Fortaleza')::date + 7)::text))
 where key = 'agenda.reunioes';

-- =====================================================================
-- 12. O AVISO POR E-MAIL, e o lembrete da véspera
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'app.email_de(uuid)', 'EXECUTE'),
  'app.email_de não é executável por authenticated: e-mail de gente está em auth.users, não em profiles');

-- A fila tem o que `app.reuniao_gravar` enfileirou nas asserções acima. Ler
-- um lote basta: o que se mede é a FORMA do que sai, não quantos saem.
create temp table avisos74 as select public.reuniao_avisos_proximos(20) as j;
select ok(jsonb_array_length((select j from avisos74)) > 0,
  'o consumidor entrega os avisos das reuniões que acabaram de ser marcadas');
select ok(
  (select bool_and((e ->> 'email_do_dono') is not null)
     from jsonb_array_elements((select j from avisos74)) e),
  'com o e-mail de quem atende');
select ok(
  ((select j from avisos74)::text) !~ '\+55[0-9]{10,}',
  'e SEM o telefone do parceiro: e-mail é caixa fora da RLS (RF-BAS-14)');
select ok(
  (select bool_and((e ->> 'quando_por_extenso') is not null and (e ->> 'quando_curto') is not null)
     from jsonb_array_elements((select j from avisos74)) e),
  'e com o dia e a hora já escritos: quem monta o e-mail não faz conta de data');

-- O LEMBRETE DA VÉSPERA: uma reunião amanhã ganha tarefa do dono, e só uma.
insert into public.reunioes (organization_id, dono_id, titulo, formato, inicio, fim,
                             link, estado, marcada_por, marcada_por_id)
select pg_temp.org(), pg_temp.dono3(), 'vespera', 'online',
       (((now() at time zone 'America/Fortaleza')::date + 1) + time '09:30')
         at time zone 'America/Fortaleza',
       (((now() at time zone 'America/Fortaleza')::date + 1) + time '10:10')
         at time zone 'America/Fortaleza',
       'https://sala.invalid/v', 'marcada', 'pessoa', pg_temp.dono3();
select is(app.reuniao_lembretes_da_vespera(), 1,
  'a reunião de amanhã vira uma tarefa priority 1 do dono — o lembrete ao lead depende de template aprovado pela Meta, e esse prazo não é nosso');
select is(app.reuniao_lembretes_da_vespera(), 0,
  'e rodar de novo não duplica: `lembrete_em` é a marca que segura a segunda volta do cron');

-- =====================================================================
-- 13. A frase que o modelo copia sai pronta do banco
-- =====================================================================
select is(app.reuniao_por_extenso(timestamptz '2026-10-01 13:20:00+00'),
  'quinta-feira, 1º de outubro, às 10h20',
  'a frase que o modelo copia sai pronta do banco, no fuso de Natal');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — A cadência ganha porta de entrada
--         (migração 20260909160000_a_cadencia_ganha_porta_de_entrada.sql)
--
-- O defeito que estas asserções travam não é um comportamento errado: é um
-- comportamento AUSENTE. `public.matricular_em_cadencia` existia, funcionava e
-- não era chamada por ninguém — nem tela, nem worker, nem job. As cinco réguas
-- da seed estavam ligadas e vazias, e iam continuar vazias.
--
-- O que este arquivo prova, nesta ordem:
--
--   1. O GUARDA CONTINUA O MESMO. `app.recusa_de_matricula` responde as nove
--      recusas na ordem em que a RPC sempre respondeu, e a RPC — agora uma
--      casca sobre ela — devolve exatamente o que os testes 17 e 18 já cobram.
--      Uma porta nova não é hora de mexer no guarda.
--   2. PERGUNTAR NÃO ESCREVE. `cadencias_do_negocio` e `negocios_para_cadencia`
--      são leitura: rodadas duas vezes seguidas, não nasce matrícula, toque nem
--      tarefa. É o que separa "a tela pergunta antes de oferecer" de "a tela
--      matricula sem querer".
--   3. A LISTA É DE QUEM PODE. Quem está suprimido, quem já está numa régua e
--      quem está numa etapa de saída não aparece — e não aparece porque o banco
--      não os devolve, não porque a tela os escondeu.
--   4. A OFERTA CONHECE A ETAPA. `matricular_em_cadencia` nunca olhou a etapa do
--      negócio, e continua não olhando (é permissão, não oferta). Quem passa a
--      olhar é a SUGESTÃO: etapa de saída não puxa régua nova, e a régua que
--      exige gancho — a de reativação — é a única que nasce em Nutrição.
--   5. `public.meu_papel()` diz a verdade sobre os três papéis que importam
--      para as duas telas: quem escreve, quem gerencia e quem matricula.
--
-- Nenhuma asserção conta linha absoluta em tabela compartilhada: tudo é DELTA
-- contra uma base lida FORA da RLS, ou escopo pelos ids deste arquivo.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(47);

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
create function pg_temp.funil(p_slug text) returns int language sql as $$
  select id from public.pipelines where slug = p_slug
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_slug
$$;
create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-00000000d2' || p_n)::uuid
$$;
create function pg_temp.neg(p_n text) returns uuid language sql as $$
  select ('e0000000-0000-4000-8000-00000000d2' || p_n)::uuid
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated;

-- Uma organização aparece na lista de "quem pode entrar"? A pergunta que este
-- arquivo faz umas dez vezes, escrita uma vez.
create function pg_temp.listada(p_lista jsonb, p_org uuid) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_lista, '[]'::jsonb)) e
                  where (e.value ->> 'organization_id')::uuid = p_org)
$$;
create function pg_temp.motivo_na_lista(p_res jsonb, p_slug text) returns text language sql as $$
  select e.value ->> 'motivo'
    from jsonb_array_elements(coalesce(p_res -> 'cadencias', '[]'::jsonb)) e
   where e.value ->> 'slug' = p_slug
$$;
create function pg_temp.sugerida(p_res jsonb, p_slug text) returns text language sql as $$
  select e.value ->> 'sugerida'
    from jsonb_array_elements(coalesce(p_res -> 'cadencias', '[]'::jsonb)) e
   where e.value ->> 'slug' = p_slug
$$;

-- ---------- contagens de BASE, lidas FORA da RLS ----------
create function pg_temp.n_matriculas() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.cadence_enrollments
$$;
create function pg_temp.n_toques() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.cadence_touches
$$;
create function pg_temp.n_tarefas() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.tasks
$$;

-- A janela sempre aberta, DENTRO da transação: sem isto o arquivo passaria às
-- 10h e falharia às 21h — o pior tipo de teste. O que ele veio testar é a
-- porta, não a porteira (que é do 17).
-- O nome do parâmetro é `p_channel` e não pode mudar: `create or replace` recusa
-- renomear parâmetro de função existente. O corpo é que vira o dublê.
create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                            'fecha_em', now() + interval '4 hours')
$$;

-- ---------- gente ----------
insert into public.allowed_users (email, role, note) values
  ('c42.gestor@teste.local',  'gestor',  'pgTAP porta da cadência'),
  ('c42.sdr@teste.local',     'sdr',     'pgTAP porta da cadência'),
  ('c42.leitura@teste.local', 'leitura', 'pgTAP porta da cadência');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-00000000d201', 'c42.gestor@teste.local',  '{"full_name":"Gestor C42"}'),
  ('a0000000-0000-4000-8000-00000000d202', 'c42.sdr@teste.local',     '{"full_name":"SDR C42"}'),
  ('a0000000-0000-4000-8000-00000000d203', 'c42.leitura@teste.local', '{"full_name":"Leitura C42"}');

-- ---------- os alvos ----------
-- 01 limpo em Prospectado (o caso feliz)   · 02 limpo, para a busca por nome
-- 03 suprimido                              · 04 já matriculado
-- 05 em Nutrição (etapa de saída)           · 06 em Publicado (ganho)
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, owner_id) values
  (pg_temp.org('01'), 'C42 Buffet da Porta',    '+5584999996201', 'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('02'), 'C42 Doces Zumbi',        '+5584999996202', 'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('03'), 'C42 Pediu Para Sair',    '+5584999996203', 'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('04'), 'C42 Ja Esta Na Regua',   '+5584999996204', 'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('05'), 'C42 Dormente',           '+5584999996205', 'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('06'), 'C42 Publicado',          '+5584999996206', 'Tirol', pg_temp.fonte(), null);
update public.organizations set do_not_contact = true where id = pg_temp.org('03');

insert into public.deals (id, organization_id, pipeline_id, stage_id)
select pg_temp.neg(x.n), pg_temp.org(x.n), pg_temp.funil('fornecedor'),
       pg_temp.etapa('fornecedor', x.etapa)
  from (values
    ('01','prospectado'), ('02','prospectado'), ('03','prospectado'),
    ('04','prospectado'), ('05','nutricao'),    ('06','publicado')
  ) as x(n, etapa);

create table pg_temp.base (chave text primary key, n int);
insert into pg_temp.base values
  ('matriculas', pg_temp.n_matriculas()), ('toques', pg_temp.n_toques()),
  ('tarefas', pg_temp.n_tarefas());
create function pg_temp.delta(p_chave text, p_agora int) returns int language sql as $$
  select p_agora - (select n from pg_temp.base where chave = p_chave)
$$;


-- =====================================================================
-- 1. AS FUNÇÕES EXISTEM, E COM O GRANT CERTO
-- =====================================================================
select has_function('app',    'recusa_de_matricula',   'app.recusa_de_matricula existe');
select has_function('public', 'cadencias_do_negocio',  'public.cadencias_do_negocio existe');
select has_function('public', 'negocios_para_cadencia','public.negocios_para_cadencia existe');
select has_function('public', 'meu_papel',             'public.meu_papel existe');

select ok(has_function_privilege('authenticated', 'public.cadencias_do_negocio(uuid)', 'execute'),
          'a tela do funil pergunta pela porta');
select ok(has_function_privilege('authenticated',
            'public.negocios_para_cadencia(text, text, integer)', 'execute'),
          'e a tela das cadências pergunta quem entra');
select ok(not has_function_privilege('anon', 'public.negocios_para_cadencia(text, text, integer)', 'execute'),
          'anon não lista negócio nenhum — a porta não é pública');
select ok(not has_function_privilege('anon', 'public.cadencias_do_negocio(uuid)', 'execute'),
          'nem lê as réguas de um negócio');
select ok(not has_function_privilege('anon', 'public.meu_papel()', 'execute'),
          'nem pergunta que papel tem: anon não tem papel');


-- =====================================================================
-- 2. `public.meu_papel()` — o que cada papel faz, dito pelo banco
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-00000000d203', 'leitura');
select is(public.meu_papel() ->> 'papel', 'leitura', 'leitura se reconhece');
select is(public.meu_papel() ->> 'escreve', 'false',
          'e leitura NÃO escreve: é por isso que o kanban não pode ser arrastável para ela');
select is(public.meu_papel() ->> 'matricula', 'false', 'nem matricula ninguém');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-00000000d202', 'sdr');
select is(public.meu_papel() ->> 'escreve', 'true', 'sdr escreve');
select is(public.meu_papel() ->> 'matricula', 'true', 'e matricula (é o trabalho dela)');
select is(public.meu_papel() ->> 'gerencia', 'false',
          'mas não gerencia: ligar e desligar régua continua sendo de gestor');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-00000000d201', 'gestor');
select is(public.meu_papel() ->> 'gerencia', 'true', 'gestor gerencia');
select pg_temp.sair();


-- =====================================================================
-- 3. O GUARDA CONTINUA O MESMO — e agora responde sem escrever
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-00000000d202', 'sdr');
select ok((app.recusa_de_matricula(pg_temp.org('01'), 'voz_primeiro') -> 'motivo') = 'null'::jsonb,
          'organização limpa: nenhuma recusa');
select is(app.recusa_de_matricula(pg_temp.org('01'), 'voz_primeiro') ->> 'deal_id',
          pg_temp.neg('01')::text,
          'e o guarda já devolve o negócio que a matrícula usaria — quem grava não busca de novo');
select is(app.recusa_de_matricula(pg_temp.org('03'), 'voz_primeiro') ->> 'motivo',
          'contato_suprimido', 'quem pediu para sair é recusado pelo nome');
select is(app.recusa_de_matricula(pg_temp.org('01'), 'reativacao') ->> 'motivo',
          'gancho_obrigatorio', 'reativação sem gancho: recusa de CAMPO, não de alvo');
select ok((app.recusa_de_matricula(pg_temp.org('01'), 'reativacao', 'Lead real de dezembro')
             -> 'motivo') = 'null'::jsonb,
          'com o gancho escrito por gente, a mesma pergunta passa');
select is(app.recusa_de_matricula(pg_temp.org('01'), 'pos_autorizacao') ->> 'motivo',
          'sem_autorizacao', 'onboarding sem consent_events vigente continua fechado');
select is(app.recusa_de_matricula(pg_temp.org('01'), 'nao_existe_esta') ->> 'motivo',
          'cadencia_inexistente', 'régua que não existe (ou desligada) é recusa, não erro');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-00000000d203', 'leitura');
select is(app.recusa_de_matricula(pg_temp.org('01'), 'voz_primeiro') ->> 'motivo',
          'sem_permissao', 'e o papel é a primeira pergunta, antes de qualquer dado');
select pg_temp.sair();

-- Perguntar não escreve. Esta é a asserção que separa "a tela consulta antes de
-- oferecer" de "a tela matriculou sem querer".
-- Guardadas em `pg_temp.r` e não soltas: um `select` de jsonb no meio de um arquivo
-- pgTAP imprime uma linha que não é TAP.
select pg_temp.entrar('a0000000-0000-4000-8000-00000000d202', 'sdr');
insert into pg_temp.r select 'x1', public.cadencias_do_negocio(pg_temp.neg('01'));
insert into pg_temp.r select 'x2', public.cadencias_do_negocio(pg_temp.neg('01'));
insert into pg_temp.r select 'x3', public.negocios_para_cadencia('voz_primeiro');
insert into pg_temp.r select 'x4', public.negocios_para_cadencia('voz_primeiro');
select pg_temp.sair();
select is(pg_temp.delta('matriculas', pg_temp.n_matriculas()), 0,
          'perguntar quatro vezes não criou uma matrícula');
select is(pg_temp.delta('toques', pg_temp.n_toques()), 0, 'nem um toque');
select is(pg_temp.delta('tarefas', pg_temp.n_tarefas()), 0, 'nem uma tarefa');


-- =====================================================================
-- 4. A PERGUNTA DA FOLHA DE MOVER
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-00000000d202', 'sdr');
insert into pg_temp.r select 'n01', public.cadencias_do_negocio(pg_temp.neg('01'));
insert into pg_temp.r select 'n05', public.cadencias_do_negocio(pg_temp.neg('05'));
insert into pg_temp.r select 'n06', public.cadencias_do_negocio(pg_temp.neg('06'));
select pg_temp.sair();

select is((select valor ->> 'ok' from pg_temp.r where chave = 'n01'), 'true',
          'a folha de mover consegue perguntar pelo negócio que ela acabou de mover');
select is((select pg_temp.motivo_na_lista(valor, 'voz_primeiro') from pg_temp.r where chave = 'n01'),
          null::text, 'em Prospectado, a régua de voz aceita');
select is((select pg_temp.sugerida(valor, 'voz_primeiro') from pg_temp.r where chave = 'n01'),
          'true', 'e é sugerida: Prospectado é etapa de trabalho');
select is((select pg_temp.sugerida(valor, 'reativacao') from pg_temp.r where chave = 'n01'),
          'false', 'reativação NÃO é sugerida em Prospectado — ela é para quem já foi arquivado');

select is((select valor -> 'negocio' ->> 'etapa_de_saida' from pg_temp.r where chave = 'n06'),
          'true', 'Publicado é etapa de saída');
select is((select pg_temp.sugerida(valor, 'voz_primeiro') from pg_temp.r where chave = 'n06'),
          'false',
          'e nenhuma régua é sugerida ali: quem acabou de ser publicado não entra em régua de captação');
select is((select pg_temp.motivo_na_lista(valor, 'voz_primeiro') from pg_temp.r where chave = 'n06'),
          null::text,
          'mas a PERMISSÃO continua sendo a de sempre: a etapa muda a oferta, nunca o guarda');

select is((select pg_temp.sugerida(valor, 'reativacao') from pg_temp.r where chave = 'n05'),
          'true', 'em Nutrição, a única régua sugerida é a de reativação (RF-CON-15)');
select is((select pg_temp.sugerida(valor, 'voz_primeiro') from pg_temp.r where chave = 'n05'),
          'false', 'e a de voz não: quem está dormente já passou por ela');

select pg_temp.entrar('a0000000-0000-4000-8000-00000000d202', 'sdr');
select is(public.cadencias_do_negocio('e0000000-0000-4000-8000-0000000000ff') ->> 'motivo',
          'negocio_nao_encontrado', 'negócio que não existe é recusa nomeada, não erro de banco');
select pg_temp.sair();


-- =====================================================================
-- 5. A PERGUNTA DA TELA DE CADÊNCIAS: QUEM PODE ENTRAR
-- =====================================================================
-- A org 04 entra numa régua ANTES da lista ser lida: é o que faz dela o caso de
-- "já tem cadência ativa", que é a recusa mais comum na operação real.
select pg_temp.entrar('a0000000-0000-4000-8000-00000000d201', 'gestor');
insert into pg_temp.r select 'm04', public.matricular_em_cadencia(pg_temp.org('04'), 'voz_primeiro');
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'm04'), 'true',
          'a RPC de sempre continua matriculando — a casca não mudou o que ela faz');

select pg_temp.entrar('a0000000-0000-4000-8000-00000000d202', 'sdr');
insert into pg_temp.r select 'lista', public.negocios_para_cadencia('voz_primeiro', null, 50);
insert into pg_temp.r select 'busca', public.negocios_para_cadencia('voz_primeiro', 'zumbi', 50);
insert into pg_temp.r select 'reat',  public.negocios_para_cadencia('reativacao', null, 50);
select pg_temp.sair();

select ok((select pg_temp.listada(valor -> 'negocios', pg_temp.org('01'))
             from pg_temp.r where chave = 'lista'),
          'a organização limpa em Prospectado aparece na lista da régua de voz');
select ok(not (select pg_temp.listada(valor -> 'negocios', pg_temp.org('03'))
                 from pg_temp.r where chave = 'lista'),
          'quem pediu para sair NÃO aparece — e não aparece porque o banco não a devolve');
select ok(not (select pg_temp.listada(valor -> 'negocios', pg_temp.org('04'))
                 from pg_temp.r where chave = 'lista'),
          'quem já está numa régua não aparece: a segunda matrícula seria recusada de qualquer jeito');
select ok(not (select pg_temp.listada(valor -> 'negocios', pg_temp.org('05'))
                 from pg_temp.r where chave = 'lista'),
          'quem está em Nutrição não aparece na régua de voz');
select ok((select pg_temp.listada(valor -> 'negocios', pg_temp.org('02'))
             from pg_temp.r where chave = 'busca'),
          'a busca por nome acha "Doces Zumbi" sem acento e sem maiúscula');
select ok(not (select pg_temp.listada(valor -> 'negocios', pg_temp.org('01'))
                 from pg_temp.r where chave = 'busca'),
          'e não devolve quem não casa com a busca');

select ok((select pg_temp.listada(valor -> 'negocios', pg_temp.org('05'))
             from pg_temp.r where chave = 'reat'),
          'na régua de reativação, quem aparece é justamente o dormente');
select is((select e.value ->> 'motivo'
             from pg_temp.r, jsonb_array_elements(valor -> 'negocios') e
            where chave = 'reat' and (e.value ->> 'organization_id')::uuid = pg_temp.org('05')),
          'gancho_obrigatorio',
          'com o motivo escrito: falta o gancho, e a tela pede o campo em vez de esconder a linha');

select pg_temp.entrar('a0000000-0000-4000-8000-00000000d203', 'leitura');
select is(public.negocios_para_cadencia('voz_primeiro') ->> 'motivo', 'sem_permissao',
          'leitura não recebe lista nenhuma: ela não matricula');
select pg_temp.sair();

select * from finish();
rollback;

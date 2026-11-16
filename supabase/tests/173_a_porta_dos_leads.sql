-- =====================================================================
-- pgTAP — A porta dos leads (migração 20261113131000), só na Imova
--
-- 12/11/2026: o Grupo OLX nunca fez um POST em `grupozap-lead`, e a única prova
-- era o log do Supabase. Agora a função anota cada chamada, sem dado pessoal, e
-- o caminho no alto de Anúncios mostra a entrega de leads. Este arquivo prova:
--
--   1. O UPSERT: uma linha por dia de Natal, resultado e user-agent do Grupo
--      OLX; cada chamada soma 1, guarda a última vez e o último status;
--   2. O TETO: mil recusas são uma linha; no máximo 10 linhas por dia; o que
--      passou de 365 dias sai; resultado e status fora da lista não gravam;
--   3. QUEM GRAVA E QUEM LÊ: a anotação só pela service_role (definer, search_path
--      vazio, sem UPDATE/DELETE sem WHERE); ninguém lê a tabela direto — nem o
--      anônimo, nem quem está logado (admin e gestor incluídos), nem a
--      service_role; o painel lê por `anuncios_caminho_do_lead`;
--   4. O CAMINHO GANHA `entrega`: a última chamada real (não conta teste nem
--      recusa), o último lead do webhook (não conta o que chegou pelo WhatsApp,
--      chave `whatsapp:…`), o último teste e as recusas e os erros dos últimos 7
--      dias, separando o user-agent do Grupo OLX; tudo o que já devolvia
--      continua lá; admin e gestor leem, o SDR recebe só `sem_permissao`.
--
-- Roda em transação e desfaz tudo. Na KOMUNE a migração não cria nada:
-- conferido à parte, no contêiner de validação.
-- =====================================================================
begin;
select plan(51);

insert into public.allowed_users (email, role, note) values
  ('a173.a@teste.local', 'admin', 'pgTAP porta dos leads'),
  ('a173.g@teste.local', 'gestor', 'pgTAP porta dos leads'),
  ('a173.s@teste.local', 'sdr', 'pgTAP porta dos leads');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000017301'::uuid, 'a173.a@teste.local', '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000017302'::uuid, 'a173.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000017303'::uuid, 'a173.s@teste.local', '{"full_name":"Sol SDR"}');

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
create function pg_temp.admin() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000017301'::uuid, 'admin') $$;
create function pg_temp.gestor() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000017302'::uuid, 'gestor') $$;
create function pg_temp.sdr() returns void language sql as
  $$ select pg_temp.entrar('a0000000-0000-4000-8000-000000017303'::uuid, 'sdr') $$;
-- A empresa do banco (no CI ele nasce sem identidade).
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

-- A anotação como a Edge Function a faz: com a service_role, `p_vezes` vezes.
create function pg_temp.anotar(p_resultado text, p_status int, p_ogx boolean, p_vezes int default 1)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute 'set local role service_role';
  for i in 1 .. p_vezes loop
    r := public.grupozap_lead_anotar_chamada(p_resultado, p_status, p_ogx);
  end loop;
  execute 'reset role';
  return r;
end $$;
-- O dia de hoje em Natal, e a linha de hoje de um resultado.
create function pg_temp.hoje() returns date language sql stable as
  $$ select (now() at time zone 'America/Fortaleza')::date $$;
create function pg_temp.linha(p_resultado text, p_ogx boolean) returns public.grupozap_lead_chamadas
language sql stable as $$
  select * from public.grupozap_lead_chamadas
   where dia = pg_temp.hoje() and resultado = p_resultado and do_grupo_olx = p_ogx
$$;

-- O caminho como a tela lê, com o papel dado.
create temp table t173_c(papel text primary key, r jsonb);
grant insert, update, select on t173_c to authenticated;
create function pg_temp.ler(p_papel text) returns void language plpgsql as $$
begin
  if p_papel = 'admin' then perform pg_temp.admin();
  elsif p_papel = 'sdr' then perform pg_temp.sdr();
  else perform pg_temp.gestor();
  end if;
  insert into t173_c values (p_papel, public.anuncios_caminho_do_lead())
  on conflict (papel) do update set r = excluded.r;
  perform pg_temp.sair();
end $$;
create function pg_temp.e(p_caminho text[]) returns jsonb language sql stable as $$
  select r -> 'entrega' #> p_caminho from t173_c where papel = 'gestor'
$$;
create temp table lixo(v jsonb);
grant insert on lixo to authenticated, service_role;

select pg_temp.virar('imova');
delete from public.grupozap_lead_chamadas where true;
delete from public.portal_leads where true;

-- ---------------------------------------------------------------------
-- 0. A tabela
-- ---------------------------------------------------------------------
select has_table('public', 'grupozap_lead_chamadas', 'a tabela das chamadas existe');
select ok((select relrowsecurity from pg_class where oid = 'public.grupozap_lead_chamadas'::regclass),
          'com RLS ligada');
select col_is_pk('public', 'grupozap_lead_chamadas', array['dia', 'resultado', 'do_grupo_olx'],
                 'a chave é dia, resultado e user-agent do Grupo OLX: uma linha por combinação');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'grupozap_lead_chamadas'),
          0, 'sem política nenhuma: só as funções definer chegam nela');

-- ---------------------------------------------------------------------
-- 1. O upsert
-- ---------------------------------------------------------------------
select is(pg_temp.anotar('recebido', 200, true), '{"ok": true}'::jsonb, 'a anotação devolve ok');
select pg_temp.anotar('recebido', 200, true, 2);
select is((select count(*)::int from public.grupozap_lead_chamadas where resultado = 'recebido'), 1,
          'três chamadas "recebido" do Grupo OLX no mesmo dia são uma linha');
select is((pg_temp.linha('recebido', true)).chamadas, 3, 'com o contador em 3');
select is((pg_temp.linha('recebido', true)).dia,
          (now() at time zone 'America/Fortaleza')::date, 'no dia de Natal');
select ok((pg_temp.linha('recebido', true)).primeira_em <= (pg_temp.linha('recebido', true)).ultima_em,
          'com a primeira e a última vez');

select pg_temp.anotar('erro', 400, true);
select pg_temp.anotar('erro', 503, true);
select is((pg_temp.linha('erro', true)).ultimo_status, 503::smallint, 'o erro guarda o último status');
select is((pg_temp.linha('erro', true)).chamadas, 2, 'e soma os dois erros');

select pg_temp.anotar('recebido', 200, false);
select is((select count(*)::int from public.grupozap_lead_chamadas where resultado = 'recebido'), 2,
          'o mesmo resultado com outro user-agent é outra linha');
select is((pg_temp.linha('recebido', true)).chamadas, 3, 'e não mexe na do Grupo OLX');

-- ---------------------------------------------------------------------
-- 2. O teto
-- ---------------------------------------------------------------------
select pg_temp.anotar('recusado_credencial', 401, false, 1000);
select is((select count(*)::int from public.grupozap_lead_chamadas
            where resultado = 'recusado_credencial'), 1,
          'um sondador que manda mil 401 ocupa UMA linha');
select is((pg_temp.linha('recusado_credencial', false)).chamadas, 1000, 'com o contador em mil');

select pg_temp.anotar(r, s, o, 3)
  from (values ('recebido', 200), ('repetido', 200), ('teste', 200),
               ('recusado_credencial', 401), ('erro', 500)) v(r, s),
       (values (true), (false)) u(o);
select is((select count(*)::int from public.grupozap_lead_chamadas where dia = pg_temp.hoje()), 10,
          'todas as combinações, várias vezes: no máximo 10 linhas por dia');

-- Fora da lista não grava nada.
select is(pg_temp.anotar('outro', 200, true) ->> 'motivo', 'resultado_invalido',
          'resultado fora da lista é recusado');
select is(pg_temp.anotar(null, 200, true) ->> 'motivo', 'resultado_invalido',
          'resultado nulo também');
select is(pg_temp.anotar('erro', 99, true) ->> 'motivo', 'status_invalido', 'status abaixo de 100 é recusado');
select is(pg_temp.anotar('erro', 600, true) ->> 'motivo', 'status_invalido', 'status acima de 599 também');
select is(pg_temp.anotar('erro', null, true) ->> 'motivo', 'status_invalido', 'status nulo também');
select is((select count(*)::int from public.grupozap_lead_chamadas where dia = pg_temp.hoje()), 10,
          'e nenhuma linha nova nasceu');
select throws_ok($$insert into public.grupozap_lead_chamadas (dia, resultado, do_grupo_olx, ultimo_status)
                   values (current_date - 1, 'qualquer', true, 200)$$, '23514', null,
                 'nem por fora da função: o banco recusa resultado fora da lista');

-- O que passou de 365 dias sai na próxima anotação.
insert into public.grupozap_lead_chamadas (dia, resultado, do_grupo_olx, ultimo_status) values
  (pg_temp.hoje() - 366, 'recebido', true, 200),
  (pg_temp.hoje() - 365, 'recebido', true, 200),
  (pg_temp.hoje() - 30, 'recebido', true, 200);
select pg_temp.anotar('teste', 200, true);
select is((select string_agg((pg_temp.hoje() - dia)::text, ',' order by dia)
             from public.grupozap_lead_chamadas where dia < pg_temp.hoje()),
          '365,30', 'o de 366 dias saiu; o de 365 e o de 30 ficaram');

-- ---------------------------------------------------------------------
-- 3. Quem grava e quem lê
-- ---------------------------------------------------------------------
select ok(has_function_privilege('service_role',
            'public.grupozap_lead_anotar_chamada(text, int, boolean)', 'execute'),
          'a service_role (a Edge Function) anota');
select ok(not has_function_privilege('authenticated',
            'public.grupozap_lead_anotar_chamada(text, int, boolean)', 'execute')
          and not has_function_privilege('anon',
            'public.grupozap_lead_anotar_chamada(text, int, boolean)', 'execute'),
          'quem está logado e o anônimo não anotam');
select pg_temp.gestor();
select throws_ok($$select public.grupozap_lead_anotar_chamada('recebido', 200, true)$$, '42501', null,
                 'a gestão também não anota (só a Edge Function)');
select pg_temp.sair();
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
             from pg_proc p
            where p.oid = 'public.grupozap_lead_anotar_chamada(text, int, boolean)'::regprocedure),
          'a anotação é security definer com search_path vazio');
-- O `safeupdate` da API recusa UPDATE e DELETE sem WHERE (ver o 123).
select is(
  (select count(*)::int
     from pg_proc p
    cross join lateral regexp_split_to_table(p.prosrc, ';') as comando
    where p.oid = 'public.grupozap_lead_anotar_chamada(text, int, boolean)'::regprocedure
      and comando ~* '(^|\n)\s*(update|delete)\s'
      and comando !~* '\swhere\s'),
  0, 'a anotação não tem UPDATE nem DELETE sem WHERE (o safeupdate da API recusaria)');

select ok(not has_table_privilege('anon', 'public.grupozap_lead_chamadas', 'select')
          and not has_table_privilege('authenticated', 'public.grupozap_lead_chamadas', 'select'),
          'o anônimo e quem está logado não leem a tabela');
select ok(not has_table_privilege('authenticated', 'public.grupozap_lead_chamadas', 'insert')
          and not has_table_privilege('service_role', 'public.grupozap_lead_chamadas', 'insert')
          and not has_table_privilege('service_role', 'public.grupozap_lead_chamadas', 'select'),
          'nem a service_role grava ou lê direto: só pela função');
select pg_temp.admin();
select throws_ok($$select count(*) from public.grupozap_lead_chamadas$$, '42501', null,
                 'nem o admin lê direto: o painel lê pelo caminho');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 4. O caminho ganha a entrega de leads
-- ---------------------------------------------------------------------
delete from public.grupozap_lead_chamadas where true;

select pg_temp.ler('gestor');
select ok((select r ?& array['ok', 'agora', 'entrega', 'arquivo', 'plano', 'anuncios', 'relatorio', 'leads']
             from t173_c where papel = 'gestor'),
          'o caminho continua com tudo o que já devolvia, e ganha a entrega');
select ok(pg_temp.e('{ultima_chamada_real}') = 'null'::jsonb
          and pg_temp.e('{ultimo_lead_do_webhook}') = 'null'::jsonb
          and pg_temp.e('{ultimo_teste}') = 'null'::jsonb,
          'sem chamada nenhuma: nada chegou, nada foi testado');
select is(pg_temp.e('{recusas_7_dias,do_grupo_olx}'), '{"quantas": 0, "ultima_em": null}'::jsonb,
          'e nenhuma recusa');

-- O validador (teste) e as recusas não são chamada real.
select pg_temp.anotar('teste', 200, true);
select pg_temp.anotar('recusado_credencial', 401, true, 3);
select pg_temp.anotar('recusado_credencial', 401, false, 2);
select pg_temp.anotar('erro', 500, true);
insert into public.grupozap_lead_chamadas (dia, resultado, do_grupo_olx, chamadas, primeira_em, ultima_em, ultimo_status)
values (pg_temp.hoje() - 6, 'recusado_credencial', true, 4, now() - interval '6 days', now() - interval '6 days', 401),
       (pg_temp.hoje() - 7, 'recusado_credencial', true, 5, now() - interval '7 days', now() - interval '7 days', 401),
       (pg_temp.hoje() - 40, 'erro', true, 9, now() - interval '40 days', now() - interval '40 days', 500);
select pg_temp.ler('gestor');
select is(pg_temp.e('{ultima_chamada_real}'), 'null'::jsonb,
          'teste, recusa e erro não são chamada real');
select ok(pg_temp.e('{ultimo_teste}') = to_jsonb(now()), 'o último teste aparece, com a hora');
select is(pg_temp.e('{recusas_7_dias,do_grupo_olx,quantas}'), '7'::jsonb,
          'as recusas do Grupo OLX de hoje e de 6 dias atrás contam (3 + 4); a de 7 dias, não');
select ok(pg_temp.e('{recusas_7_dias,do_grupo_olx,ultima_em}') = to_jsonb(now()),
          'com a última recusa');
select is(pg_temp.e('{recusas_7_dias,outras,quantas}'), '2'::jsonb,
          'as de outro user-agent ficam à parte');
select is(pg_temp.e('{erros_7_dias,do_grupo_olx,quantas}'), '1'::jsonb,
          'o erro de hoje conta; o de 40 dias, não');
select is(pg_temp.e('{erros_7_dias,outros,quantas}'), '0'::jsonb, 'nenhum erro de outro user-agent');

-- A primeira chamada real.
select pg_temp.anotar('recebido', 200, true);
select pg_temp.ler('gestor');
select is(pg_temp.e('{ultima_chamada_real}'),
          jsonb_build_object('em', now(), 'resultado', 'recebido', 'do_grupo_olx', true),
          'a chamada real aparece: quando, o resultado e se veio com o user-agent do Grupo OLX');

-- O último lead do webhook, e não o do WhatsApp.
set local role service_role;
insert into lixo select public.grupozap_lead_receber('t173-lead',
  jsonb_build_object('leadOrigin', 'Grupo OLX', 'originLeadId', 't173-lead',
                     'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'),
                     'extraData', jsonb_build_object('leadType', 'CLICK_WHATSAPP')));
reset role;
select pg_temp.ler('gestor');
select ok(pg_temp.e('{ultimo_lead_do_webhook}')
            = to_jsonb((select recebido_em from public.portal_leads where origin_lead_id = 't173-lead')),
          'o lead que o webhook gravou (mesmo sem código) aparece como o último do webhook');
-- O lead que chega pelo WhatsApp com o texto do portal (chave `whatsapp:…`), mais novo.
insert into public.portal_leads (origin_lead_id, origem_no_portal, tipos, recebido_em)
values ('whatsapp:5584981730001', 'Grupo OLX', '{CLICK_WHATSAPP}', now() + interval '1 hour');
select pg_temp.ler('gestor');
select ok(pg_temp.e('{ultimo_lead_do_webhook}')
            = to_jsonb((select recebido_em from public.portal_leads where origin_lead_id = 't173-lead')),
          'o lead do WhatsApp, mesmo mais novo, não conta como entrega do webhook');
select is((select r #> '{leads,total}' from t173_c where papel = 'gestor'), '2'::jsonb,
          'o passo "O primeiro lead" continua contando os dois');

-- ---------------------------------------------------------------------
-- 5. Quem vê o caminho
-- ---------------------------------------------------------------------
select pg_temp.ler('admin');
select ok((select r -> 'entrega' from t173_c where papel = 'admin')
            = (select r -> 'entrega' from t173_c where papel = 'gestor'),
          'o admin vê a mesma entrega que o gestor');
select pg_temp.ler('sdr');
select is((select r from t173_c where papel = 'sdr'), '{"ok": false, "motivo": "sem_permissao"}'::jsonb,
          'o SDR recebe só sem_permissao, sem a entrega');
select is(public.anuncios_caminho_do_lead() ->> 'motivo', 'sem_permissao',
          'sem login (sem papel), também sem_permissao');
select ok(has_function_privilege('authenticated', 'public.anuncios_caminho_do_lead()', 'execute')
          and not has_function_privilege('anon', 'public.anuncios_caminho_do_lead()', 'execute'),
          'quem está logado chama o caminho; o anônimo não');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
                  and p.provolatile = 's' and p.prosrc !~* '\m(insert|update|delete)\M'
             from pg_proc p where p.oid = 'public.anuncios_caminho_do_lead()'::regprocedure),
          'o caminho continua definer, com search_path vazio, e só lê');

select * from finish();
rollback;

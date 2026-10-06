-- =====================================================================
-- pgTAP — A ligação sai pelo navegador
--         (migração 20261006090100_a_ligacao_sai_pelo_navegador.sql)
--
-- O que este arquivo trava:
--
--   1. PORTAS — o número discado não é legível por quem liga; as duas portas
--      do provedor só abrem para o serviço.
--   2. TRAVAS — chave geral desligada, papel sem escrita, janela fechada,
--      ficha sem telefone e parceiro suprimido recusam NO BANCO, com motivo.
--   3. UMA LIGAÇÃO POR VEZ — a segunda é recusada, e o índice segura quem
--      escrever por fora.
--   4. O PROVEDOR — identidade errada não disca; o aviso repetido não muda
--      nada; o estado nunca volta; o aviso final vale por cima da tela.
--   5. O REGISTRO — a tabulação encontra a chamada, e a que ninguém tabulou
--      vira atividade sozinha.
--   6. O LOTE — a tentativa aberta por `iniciar_chamada` disca o número da
--      reserva, e só para quem a abriu.
--
-- Nenhuma asserção conta linha absoluta em tabela compartilhada. Roda em
-- transação e desfaz tudo.
-- =====================================================================
begin;
select plan(51);

create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated, service_role;

create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.servico() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.hoje() returns date language sql as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;
create function pg_temp.org(p_n int) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-0000000096' || lpad(p_n::text, 2, '0'))::uuid
$$;
create function pg_temp.ligacao(p_chave text) returns uuid language sql as $$
  select (valor -> 'ligacao' ->> 'id')::uuid from pg_temp.r where chave = p_chave
$$;
-- leituras FORA da RLS
create function pg_temp.vc(p_id uuid) returns public.voice_calls
language sql security definer set search_path = '' as $$
  select c from public.voice_calls c where c.id = p_id
$$;
create function pg_temp.n_eventos(p_id uuid) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from public.voice_call_events e where e.call_id = p_id
$$;
create function pg_temp.n_acessos(p_org uuid) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from public.pii_access_log l
   where l.entity_id = p_org and l.scope ->> 'origem' = 'voz_abrir_ligacao'
$$;

-- ---------- gente ----------
insert into public.allowed_users (email, role, note) values
  ('c96.sdr@teste.local',     'sdr',     'pgTAP telefonia'),
  ('c96.sdr2@teste.local',    'sdr',     'pgTAP telefonia'),
  ('c96.leitura@teste.local', 'leitura', 'pgTAP telefonia');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000096a1', 'c96.sdr@teste.local',     '{"full_name":"SDR Voz"}'),
  ('a0000000-0000-4000-8000-0000000096a2', 'c96.sdr2@teste.local',    '{"full_name":"SDR Voz Dois"}'),
  ('a0000000-0000-4000-8000-0000000096a3', 'c96.leitura@teste.local', '{"full_name":"Leitura Voz"}');

-- ---------- parceiros ----------
insert into public.categories (id, slug, name, "group", priority, position)
values (996, 'c96_teste', 'Categoria de teste da telefonia', 'servicos', 2, 996);
insert into public.organizations (id, name, phone_e164, neighborhood, source_id, kind)
select pg_temp.org(i), 'C96 Buffet ' || i,
       case when i = 5 then null else '+558499996' || lpad(i::text, 4, '0') end, 'Tirol',
       (select id from public.sources where slug = 'planilha'), 'fornecedor'
  from generate_series(1, 9) i;
insert into public.organization_categories (organization_id, category_id, is_primary)
select id, 996, true from public.organizations where name like 'C96 Buffet %';
insert into public.deals (organization_id, pipeline_id, stage_id)
select o.id, (select id from public.pipelines where slug = 'fornecedor'),
       (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
         where p.slug = 'fornecedor' and s.slug = 'prospectado')
  from public.organizations o where o.name like 'C96 Buffet %';
update public.organizations set do_not_contact = true where id = pg_temp.org(6);

create temporary table feriado_de_hoje as
  select * from public.holidays where date = pg_temp.hoje();
delete from public.holidays where date = pg_temp.hoje();


-- =====================================================================
-- 1. Portas
-- =====================================================================
select ok((select relrowsecurity from pg_class where oid = 'public.voice_calls'::regclass),
  'voice_calls nasce com RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.voice_call_events'::regclass),
  'voice_call_events nasce com RLS');
select ok(not has_column_privilege('authenticated', 'public.voice_calls', 'to_number', 'select'),
  'o número discado não é legível por authenticated');
select ok(not has_column_privilege('authenticated', 'public.voice_calls', 'from_number', 'select'),
  'nem o número de origem');
select ok(has_column_privilege('authenticated', 'public.voice_calls', 'status', 'select'),
  'o estado da linha é legível: é o que a tela acompanha');
select ok(not has_table_privilege('authenticated', 'public.voice_calls', 'insert')
          and not has_table_privilege('authenticated', 'public.voice_calls', 'update'),
  'ninguém escreve em voice_calls pela tabela');
select ok(not has_function_privilege('authenticated',
            'public.voz_twiml_autorizar(uuid,text,text,text)', 'execute'),
  'a porta do TwiML é só do serviço');
select ok(not has_function_privilege('authenticated',
            'public.voz_registrar_evento(uuid,text,text,text,int,text,timestamptz)', 'execute'),
  'a porta do aviso de estado é só do serviço');
select ok(not has_function_privilege('anon', 'public.voz_abrir_ligacao(uuid,uuid)', 'execute'),
  'anônimo não abre ligação');


-- =====================================================================
-- 2. Travas
-- =====================================================================
-- 2.1 sem a chave, a telefonia está desligada: ela nunca liga por omissão.
-- (O valor é apagado DENTRO da transação: o banco de quem roda a suíte pode
-- estar com a telefonia ligada, e o teste não pode depender disso.)
delete from public.app_settings where key = 'voz.telefonia';
select is(app.voz_ativa(), false, 'sem a chave em app_settings, a telefonia está desligada');
insert into public.app_settings (key, value) values ('voz.telefonia', '{"ativa": false}'::jsonb);
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  v := public.voz_abrir_ligacao(pg_temp.org(1));
  insert into pg_temp.r values ('desligada', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'desligada'), 'telefonia_desligada',
  'desligada: ninguém liga pelo navegador');

update public.app_settings set value = '{"ativa": true}'::jsonb where key = 'voz.telefonia';

-- 2.2 a janela fechada recusa (a tabela de horários vazia é um domingo eterno)
create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select 0::numeric, 0::numeric where false
$$;
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  v := public.voz_abrir_ligacao(pg_temp.org(1));
  insert into pg_temp.r values ('janela', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'janela'), 'fora_da_janela',
  'fora da janela: a ligação pelo navegador obedece ao mesmo horário do modo manual');

-- daqui em diante a janela abre o dia inteiro DENTRO da transação
create or replace function app.call_window_hours(p_dow int)
returns table (de numeric, ate numeric) language sql immutable set search_path = '' as $$
  select 0::numeric, 24::numeric
$$;

-- 2.3 papel, telefone, supressão
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a3', 'leitura');
  v := public.voz_abrir_ligacao(pg_temp.org(1));
  insert into pg_temp.r values ('leitura', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'leitura'), 'sem_permissao',
  'quem não escreve no CRM não liga');

-- 2.4 a credencial do softphone sai com a identidade de quem está logado
do $$
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a3', 'leitura');
  insert into pg_temp.r values ('pode_leitura', public.voz_pode_ligar());
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  insert into pg_temp.r values ('pode_sdr', public.voz_pode_ligar());
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'pode_leitura'), 'sem_permissao',
  'papel de leitura não recebe credencial de softphone');
select is((select valor ->> 'identidade' from pg_temp.r where chave = 'pode_sdr'),
          'crm_a0000000-0000-4000-8000-0000000096a1',
  'a identidade da credencial é o id de quem está logado');
select ok(not has_function_privilege('anon', 'public.voz_pode_ligar()', 'execute'),
  'anônimo não pergunta');

do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  insert into pg_temp.r values ('sem_fone',  public.voz_abrir_ligacao(pg_temp.org(5)));
  insert into pg_temp.r values ('suprimido', public.voz_abrir_ligacao(pg_temp.org(6)));
  insert into pg_temp.r values ('fantasma',
    public.voz_abrir_ligacao('00000000-0000-4000-8000-000000000096'::uuid));
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'sem_fone'), 'sem_telefone',
  'ficha sem telefone não liga');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'suprimido'), 'contato_suprimido',
  'quem pediu para não ser procurado não recebe ligação');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'fantasma'), 'parceiro_inexistente',
  'parceiro que não existe não liga');


-- =====================================================================
-- 3. Abrir, e uma ligação por vez
-- =====================================================================
do $$
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  insert into pg_temp.r values ('um',   public.voz_abrir_ligacao(pg_temp.org(1)));
  insert into pg_temp.r values ('dois', public.voz_abrir_ligacao(pg_temp.org(2)));
end $$;
select pg_temp.sair();

select is((select valor ->> 'ok' from pg_temp.r where chave = 'um'), 'true', 'a ligação abre');
select ok((select valor::text from pg_temp.r where chave = 'um') not like '%8499996%',
  'e a resposta não carrega o número: ligar não é revelar');
select is((pg_temp.vc(pg_temp.ligacao('um'))).to_number, '+5584999960001',
  'o número discado é o da ficha, escolhido pelo banco');
select is((pg_temp.vc(pg_temp.ligacao('um'))).status::text, 'preparando', 'nasce em preparo');
select is((pg_temp.vc(pg_temp.ligacao('um'))).recording_enabled, false, 'gravação nasce desligada');
select is(pg_temp.n_acessos(pg_temp.org(1)), 1, 'o uso do telefone fica em pii_access_log');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'dois'), 'ja_em_ligacao',
  'segunda ligação da mesma pessoa é recusada');
select throws_ok(
  $$insert into public.voice_calls (provedor, organization_id, user_id, to_number)
    values ('twilio', pg_temp.org(2), 'a0000000-0000-4000-8000-0000000096a1', '+5584999960002')$$,
  '23505', null, 'e o índice segura quem escrever por fora da função');

-- RLS e colunas
do $$
declare v_n int; v_erro text := 'nenhum';
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a2', 'sdr');
  select count(*) into v_n from public.voice_calls where id = pg_temp.ligacao('um');
  insert into pg_temp.r values ('rls_outro', to_jsonb(v_n));
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  select count(*) into v_n from public.voice_calls where id = pg_temp.ligacao('um');
  insert into pg_temp.r values ('rls_dono', to_jsonb(v_n));
  begin
    perform to_number from public.voice_calls where id = pg_temp.ligacao('um');
  exception when insufficient_privilege then v_erro := '42501';
  end;
  insert into pg_temp.r values ('coluna', to_jsonb(v_erro));
end $$;
select pg_temp.sair();
select is((select valor #>> '{}' from pg_temp.r where chave = 'rls_outro'), '0',
  'outra pessoa não vê a chamada');
select is((select valor #>> '{}' from pg_temp.r where chave = 'rls_dono'), '1', 'quem ligou vê a sua');
select is((select valor #>> '{}' from pg_temp.r where chave = 'coluna'), '42501',
  'mas nem quem ligou lê o número pela tabela');


-- =====================================================================
-- 4. O provedor
-- =====================================================================
do $$
declare v_id uuid := pg_temp.ligacao('um'); v_quem text := 'crm_a0000000-0000-4000-8000-0000000096a1';
begin
  perform pg_temp.servico();
  insert into pg_temp.r values ('tw_outro',
    public.voz_twiml_autorizar(v_id, 'crm_a0000000-0000-4000-8000-0000000096a2', 'CApai1'));
  insert into pg_temp.r values ('tw_ok',  public.voz_twiml_autorizar(v_id, v_quem, 'CApai1', '+558430000000'));
  insert into pg_temp.r values ('tw_rep', public.voz_twiml_autorizar(v_id, v_quem, 'CApai1', '+558430000000'));
  insert into pg_temp.r values ('ev_estranho',
    public.voz_registrar_evento(v_id, 'CAfilho1', 'CAoutro', 'ringing'));
  insert into pg_temp.r values ('ev_toca',   public.voz_registrar_evento(v_id, 'CAfilho1', 'CApai1', 'ringing'));
  insert into pg_temp.r values ('ev_atende', public.voz_registrar_evento(v_id, 'CAfilho1', 'CApai1', 'in-progress'));
  insert into pg_temp.r values ('ev_toca2',  public.voz_registrar_evento(v_id, 'CAfilho1', 'CApai1', 'ringing'));
  insert into pg_temp.r values ('ev_atraso', public.voz_registrar_evento(v_id, 'CAfilho1', 'CApai1', 'initiated'));
  insert into pg_temp.r values ('ev_fim',    public.voz_registrar_evento(v_id, 'CAfilho1', 'CApai1', 'completed', 125));
  insert into pg_temp.r values ('ev_fim2',   public.voz_registrar_evento(v_id, 'CAfilho1', 'CApai1', 'completed', 999));
end $$;
select pg_temp.sair();

select is((select valor ->> 'motivo' from pg_temp.r where chave = 'tw_outro'), 'identidade_nao_confere',
  'a chamada de uma pessoa não disca com a identidade de outra');
select is((select valor ->> 'para' from pg_temp.r where chave = 'tw_ok'), '+5584999960001',
  'com a identidade certa o serviço recebe o número a discar');
select is((select valor ->> 'repetido' from pg_temp.r where chave = 'tw_rep'), 'true',
  'o pedido repetido da mesma perna recebe a mesma resposta');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'ev_estranho'), 'ligacao_desconhecida',
  'aviso de uma perna que não é a desta chamada é recusado');
select is((select valor ->> 'status' from pg_temp.r where chave = 'ev_toca'), 'tocando', 'tocou');
select is((select valor ->> 'status' from pg_temp.r where chave = 'ev_atende'), 'em_ligacao', 'atendeu');
select is((select valor ->> 'repetido' from pg_temp.r where chave = 'ev_toca2'), 'true',
  'aviso repetido não muda nada');
select is((select valor ->> 'status' from pg_temp.r where chave = 'ev_atraso'), 'em_ligacao',
  'aviso atrasado não faz o estado voltar');
select is((pg_temp.vc(pg_temp.ligacao('um'))).status::text || '/' ||
          (pg_temp.vc(pg_temp.ligacao('um'))).duracao_seg::text, 'finalizada/125',
  'o fim grava a duração medida pelo provedor — e o fim repetido não a troca');
select is(pg_temp.n_eventos(pg_temp.ligacao('um')), 4,
  'quatro avisos distintos, quatro linhas: os dois repetidos não entraram');

-- 4.2 a tela encerra antes; o aviso do provedor vale por cima
do $$
declare v jsonb; v_id uuid; v_quem text := 'crm_a0000000-0000-4000-8000-0000000096a1';
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  v := public.voz_abrir_ligacao(pg_temp.org(2));
  insert into pg_temp.r values ('tres', v);
  v_id := (v -> 'ligacao' ->> 'id')::uuid;
  perform pg_temp.servico();
  perform public.voz_twiml_autorizar(v_id, v_quem, 'CApai3');
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  insert into pg_temp.r values ('tela_fecha', public.voz_encerrar_ligacao(v_id));
  perform pg_temp.servico();
  insert into pg_temp.r values ('prov_fecha',
    public.voz_registrar_evento(v_id, 'CAfilho3', 'CApai3', 'no-answer'));
end $$;
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'tres'), 'true',
  'chamada encerrada solta a trava: a próxima abre');
select is((select valor ->> 'status' from pg_temp.r where chave = 'tela_fecha'), 'cancelada',
  'a tela dá a chamada por cancelada');
select is((select valor ->> 'status' from pg_temp.r where chave = 'prov_fecha'), 'nao_atendida',
  'e o aviso final do provedor vale por cima');

-- 4.3 o opt-out que chega entre abrir e discar
do $$
declare v jsonb; v_id uuid;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  v := public.voz_abrir_ligacao(pg_temp.org(3));
  v_id := (v -> 'ligacao' ->> 'id')::uuid;
  execute 'reset role';
  update public.organizations set do_not_contact = true where id = pg_temp.org(3);
  perform pg_temp.servico();
  insert into pg_temp.r values ('tw_supr',
    public.voz_twiml_autorizar(v_id, 'crm_a0000000-0000-4000-8000-0000000096a1', 'CApai4'));
  insert into pg_temp.r values ('quatro', v);
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'tw_supr'), 'contato_suprimido',
  'opt-out entre abrir e discar: o provedor não recebe o número');
select is((pg_temp.vc(pg_temp.ligacao('quatro'))).status::text, 'falha',
  'e a chamada fecha como falha, soltando a trava');


-- =====================================================================
-- 5. O registro
-- =====================================================================
do $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  v := public.registrar_contato(gen_random_uuid(), pg_temp.org(1),
         (select id from public.interaction_outcomes
           where slug = app.outcome_for_call_result('nao_atendeu')));
  insert into pg_temp.r values ('registro', v);
  insert into pg_temp.r values ('vinculo',
    public.voz_vincular_atividade(pg_temp.ligacao('um'), (v ->> 'activity_id')::uuid));
end $$;
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'vinculo'), 'true',
  'a tabulação encontra a chamada');
select is((pg_temp.vc(pg_temp.ligacao('um'))).activity_id::text,
          (select valor ->> 'activity_id' from pg_temp.r where chave = 'registro'),
  'e a chamada passa a apontar para a atividade');

-- a que ninguém tabulou
update public.voice_calls set encerrada_em = now() - interval '31 minutes'
 where id = pg_temp.ligacao('tres');
select ok(app.voz_fechar_orfas() >= 1, 'a limpeza cria atividade para a chamada sem tabulação');
select is((select a.type::text || '/' || (a.metadata ->> 'outcome_pending')
             from public.activities a
            where a.id = (pg_temp.vc(pg_temp.ligacao('tres'))).activity_id),
          'call/true', 'e ela entra na linha do tempo como ligação com desfecho pendente');


-- =====================================================================
-- 6. O lote
-- =====================================================================
do $$
declare v jsonb; v_lote uuid; v_item uuid; v_ch jsonb; v_att uuid;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  v := public.montar_lote('C96 telefonia', (select id from public.pipelines where slug = 'fornecedor'),
         'frio', (select id from public.call_scripts where slug = 'captacao_v1' and is_published),
         array[996], 'prioridade', 3, 3, 20, null, pg_temp.hoje(), pg_temp.hoje());
  v_lote := (v ->> 'lote_id')::uuid;
  v      := public.proximo_da_fila(v_lote);
  v_item := (v -> 'item' ->> 'id')::uuid;
  v_ch   := public.iniciar_chamada(v_item);
  v_att  := (v_ch -> 'chamada' ->> 'id')::uuid;
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a2', 'sdr');
  insert into pg_temp.r values ('lote_outro', public.voz_abrir_ligacao(null, v_att));
  perform pg_temp.entrar('a0000000-0000-4000-8000-0000000096a1', 'sdr');
  insert into pg_temp.r values ('lote', public.voz_abrir_ligacao(null, v_att)
                                        || jsonb_build_object('fone', v_ch -> 'chamada' ->> 'telefone'));
end $$;
select pg_temp.sair();
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'lote_outro'), 'chamada_ja_encerrada',
  'a tentativa do lote de uma pessoa não disca para outra');
select is((pg_temp.vc(pg_temp.ligacao('lote'))).to_number,
          (select valor ->> 'fone' from pg_temp.r where chave = 'lote'),
  'no lote, o número discado é o da reserva — o mesmo que iniciar_chamada revelou');

select * from finish();
rollback;

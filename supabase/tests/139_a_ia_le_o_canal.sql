-- =====================================================================
-- pgTAP — A IA lê o canal de chegada (migração 20261109230000)
--
-- Prova:
--   1. O PROPÓSITO `identificar_canal` está nas quatro listas fechadas (o
--      CHECK de ai_runs, ia_enfileirar, ia_adiar_trabalho e o painel do freio):
--      quem redefinir uma delas sem o nome novo quebra aqui;
--   2. O PEDIDO só sai com a janela madura e as fotos do começo chegadas (ou
--      dadas por perdidas), uma vez por mensagem nova, com a CHAVE dentro do
--      payload igual à da dedup; regra forte dispensa a IA; a chegada antiga
--      (de antes do job) espera a primeira leitura antes de fechar;
--   3. A ENTRADA diz quem disse, o tipo, quais fotos podem ser baixadas
--      (figurinha nunca) e por que pular;
--   4. A GRAVAÇÃO confere a prova contra as mensagens da chegada e respeita a
--      ordem gente > regra forte > IA > regra fraca; a foto descrita fica;
--   5. O ORÇAMENTO no limite adia, e a chegada fecha dizendo isso;
--   6. Só o worker (service_role) lê a entrada e grava; e nada disso toca o
--      WhatsApp.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(44);

insert into public.allowed_users (email, role, note) values
  ('h138.g@teste.local', 'gestor', 'pgTAP 138');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000013801'::uuid, 'h138.g@teste.local', '{"full_name":"Gil Gestor"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999913100"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
-- O freio aberto, para o pedido sair (a seção 5 fecha).
update public.app_settings set value = value || '{"mensal_usd": 100000}'::jsonb where key = 'ia.orcamento';

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

create temp table t138(chave text primary key, valor uuid);
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t138 where chave = p_chave
$$;
create function pg_temp.conversa(p_chave text, p_tel text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999913100', p_tel, 'Cliente ' || p_chave,
          'a0000000-0000-4000-8000-000000013801'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t138 values (p_chave, v);
  return v;
end $$;
create function pg_temp.dele(p_chave_msg text, p_conv uuid, p_em timestamptz, p_body text default 'pgtap138 dele',
                             p_tipo text default 'text', p_media text default null, p_meta text default null,
                             p_conteudo jsonb default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               media_path, media_mime, tipo_na_meta, conteudo, created_at)
  values (p_conv, 'in'::app.msg_direction, p_tipo::app.msg_type, 'received'::app.msg_status, p_body,
          'system', 'crm', p_media, case when p_media is not null then 'image/jpeg' end, p_meta, p_conteudo, p_em)
  returning id into v;
  if p_chave_msg is not null then insert into t138 values (p_chave_msg, v); end if;
  return v;
end $$;
create function pg_temp.ultima(p_conv uuid) returns uuid language sql stable as $$
  select c.id from public.chegadas c where c.conversation_id = p_conv order by c.inicio_em desc limit 1
$$;
grant select on t138 to authenticated;
grant execute on function pg_temp.id(text) to authenticated;
grant execute on function pg_temp.ultima(uuid) to authenticated;
create function pg_temp.pedidos(p_chegada uuid) returns int language sql stable as $$
  select count(*)::int from pgmq.q_ai_jobs q
   where q.message ->> 'purpose' = 'identificar_canal' and q.message ->> 'chegada_id' = p_chegada::text
$$;
create function pg_temp.gravar(p_chegada uuid, p_resultado jsonb) returns jsonb language sql as $$
  select app.canal_gravar_da_ia(p_chegada, p_resultado, now())
$$;

create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;
-- O banco é da Imova durante o teste (no CI ele é da KOMUNE, gravada pelo seed).
select pg_temp.virar('imova');

insert into public.app_settings (key, value, description)
values ('canal_de_chegada',
        jsonb_build_object('ligada', true, 'ia', true, 'piloto_numeros', '[]'::jsonb,
                           'aplicar_desde', to_char((now() at time zone 'America/Fortaleza')::date - 120, 'YYYY-MM-DD')),
        'pgTAP 138')
on conflict (key) do update set value = excluded.value;

create temp table t138_base as
  select (select count(*) from public.messages where direction = 'out'::app.msg_direction) as saidas,
         (select count(*) from pgmq.q_wa_outbound) as fila;

-- =====================================================================
-- 1. O propósito nas quatro listas
-- =====================================================================
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_runs_purpose_check')
          like '%identificar_canal%', 'identificar_canal está no CHECK de ai_runs');
select ok((select prosrc from pg_proc where oid = 'app.ia_enfileirar(text,jsonb,text)'::regprocedure)
          like '%identificar_canal%', 'na porta da fila');
select ok((select prosrc from pg_proc where oid = 'public.ia_adiar_trabalho(text,jsonb,text,text)'::regprocedure)
          like '%identificar_canal%', 'na dívida do orçamento');
select ok((select prosrc from pg_proc where oid = 'app.ia_gasto_bloqueado_para()'::regprocedure)
          like '%identificar_canal%', 'e no painel do freio');

-- =====================================================================
-- 2. O pedido
-- =====================================================================
select pg_temp.conversa('a', '+5584999913101');
select pg_temp.dele(null, pg_temp.id('a'), now() - interval '1 minute', 'Oi');
select app.chegadas_rodar(1000);
select ok((select ia_pedida_em is null from public.chegadas where id = pg_temp.ultima(pg_temp.id('a'))),
  'a IA espera a pessoa terminar de mandar (3 minutos)');
select is(app.chegada_avaliar(pg_temp.ultima(pg_temp.id('a')), now() + interval '5 minutes'), 'ia_pedida',
  'janela madura: pede a leitura');
select is(pg_temp.pedidos(pg_temp.ultima(pg_temp.id('a'))), 1, 'um trabalho identificar_canal na fila');
select ok(exists (select 1 from pgmq.q_ai_jobs q join public.ingest_dedup d
                    on d.queue = 'ai_jobs' and d.idempotency_key = 'identificar_canal:' || (q.message ->> 'chave')
                   where q.message ->> 'chegada_id' = pg_temp.ultima(pg_temp.id('a'))::text),
  'com a chave dentro do payload, igual à da dedup (sem ela, a 1ª falha iria direto para a ai_dlq)');
select app.chegada_avaliar(pg_temp.ultima(pg_temp.id('a')), now() + interval '6 minutes');
select is(pg_temp.pedidos(pg_temp.ultima(pg_temp.id('a'))), 1, 'sem mensagem nova, não pede de novo');

select pg_temp.conversa('f', '+5584999913102');
select pg_temp.dele(null, pg_temp.id('f'), now() - interval '10 minutes', 'Olá, tenho interesse');
select pg_temp.dele('f_foto', pg_temp.id('f'), now() - interval '9 minutes', null, 'image');
select app.chegadas_rodar(1000);
select is(app.chegada_avaliar(pg_temp.ultima(pg_temp.id('f')), now()), 'olhada',
  'a foto ainda está chegando: espera');
select is(app.chegada_avaliar(pg_temp.ultima(pg_temp.id('f')), now() + interval '5 minutes'), 'ia_pedida',
  '10 minutos sem o arquivo: segue sem ela');

select pg_temp.conversa('s', '+5584999913103');
select pg_temp.dele(null, pg_temp.id('s'), now() - interval '10 minutes', 'Olá!', 'text', null, null,
                    '{"anuncio": {"tipo": "ad", "titulo": "Casa no Tirol"}}'::jsonb);
select app.chegadas_rodar(1000);
select app.chegada_avaliar(pg_temp.ultima(pg_temp.id('s')), now() + interval '10 minutes');
select is(pg_temp.pedidos(pg_temp.ultima(pg_temp.id('s'))), 0, 'clique no anúncio da Meta dispensa a IA');

select pg_temp.conversa('o', '+5584999913104');
select pg_temp.dele(null, pg_temp.id('o'), now() - interval '3 days', 'Oi, ainda tem aquele apartamento?');
select app.chegadas_rodar(1000);
select is((select situacao from public.chegadas where id = pg_temp.ultima(pg_temp.id('o'))), 'lendo',
  'a chegada antiga (de antes do job) não fecha sem a IA ler');
select is(pg_temp.pedidos(pg_temp.ultima(pg_temp.id('o'))), 1, 'e a leitura é pedida');
select is(app.chegada_avaliar(pg_temp.ultima(pg_temp.id('o')), now() + interval '3 hours'), 'fechada',
  'worker parado não segura a chegada aberta: 2 h depois do pedido, fecha');

-- =====================================================================
-- 3. A entrada
-- =====================================================================
select is(jsonb_array_length(app.canal_entrada_da_ia(pg_temp.ultima(pg_temp.id('f'))) -> 'mensagens'), 2,
  'a entrada traz as mensagens da chegada');
select is(app.canal_entrada_da_ia(pg_temp.ultima(pg_temp.id('f'))) #>> '{mensagens,0,de}', 'cliente', 'quem disse');
select is(app.canal_entrada_da_ia(pg_temp.ultima(pg_temp.id('f'))) #>> '{mensagens,1,tipo}', 'foto', 'o tipo');
select is(app.canal_entrada_da_ia(pg_temp.ultima(pg_temp.id('f'))) #>> '{mensagens,1,foto_elegivel}', 'false',
  'foto sem arquivo não pode ser baixada');
select is((app.canal_entrada_da_ia(pg_temp.ultima(pg_temp.id('f'))) ->> 'fotos_indisponiveis')::int, 1,
  'e conta como indisponível');
update public.messages set media_path = pg_temp.id('f') || '/' || pg_temp.id('f_foto') || '.jpg',
                           media_mime = 'image/jpeg'
 where id = pg_temp.id('f_foto');
select is(app.canal_entrada_da_ia(pg_temp.ultima(pg_temp.id('f'))) #>> '{mensagens,1,foto_elegivel}', 'true',
  'com o arquivo no balde, pode');
select pg_temp.dele(null, pg_temp.id('f'), now() - interval '8 minutes', null, 'image', 'x/figurinha.webp', 'sticker');
select is(app.canal_entrada_da_ia(pg_temp.ultima(pg_temp.id('f'))) #>> '{mensagens,2,tipo}', 'outro',
  'figurinha não é foto');
select is(app.canal_entrada_da_ia(pg_temp.ultima(pg_temp.id('f'))) #>> '{mensagens,2,foto_elegivel}', 'false',
  'e nunca vai ao modelo');
select ok(app.canal_entrada_da_ia(pg_temp.ultima(pg_temp.id('f'))) ->> 'pular' is null, 'nada impede a leitura');
select is(app.canal_entrada_da_ia(pg_temp.ultima(pg_temp.id('s'))) ->> 'pular', 'regra_forte',
  'com regra forte, a leitura é pulada');

-- =====================================================================
-- 4. A gravação
-- =====================================================================
select is(pg_temp.gravar(pg_temp.ultima(pg_temp.id('f')),
  jsonb_build_object('canal', 'placa', 'subcanal', 'foto_da_placa', 'confianca', 0.91,
    'evidencias', jsonb_build_array(jsonb_build_object('message_id', pg_temp.id('f_foto'), 'tipo', 'foto',
                                                       'trecho', 'Placa "Vende" com a marca da Imova')),
    'foto', jsonb_build_object('message_id', pg_temp.id('f_foto'), 'peca', 'placa', 'marca', 'imova',
                               'descricao', 'Placa de venda da Imova num terreno', 'codigo_do_imovel', 'te0003'),
    'motivo', 'Mandou a foto da placa da Imova')) ->> 'gravado', 'true', 'a leitura da IA vale');
select is((select canal || '/' || subcanal_automatico || '/' || decidido_por from public.chegadas
            where id = pg_temp.ultima(pg_temp.id('f'))), 'placa/foto_da_placa/ia', 'Placa, pela foto, decidido pela IA');
select is((select foto ->> 'codigo_do_imovel' from public.chegadas where id = pg_temp.ultima(pg_temp.id('f'))),
  'TE0003', 'a foto descrita fica, com o código do imóvel');
select is((select count(*)::int from public.chegada_historico
            where chegada_id = pg_temp.ultima(pg_temp.id('f')) and por_quem = 'ia'), 1, 'e no histórico');

select pg_temp.conversa('h', '+5584999913105');
select pg_temp.dele(null, pg_temp.id('h'), now() - interval '10 minutes', 'Oi');
select app.chegadas_rodar(1000);
select is(pg_temp.gravar(pg_temp.ultima(pg_temp.id('h')),
  jsonb_build_object('canal', 'anuncios', 'subcanal', 'meta_anuncio', 'confianca', 0.95,
    'evidencias', jsonb_build_array(jsonb_build_object('message_id', pg_temp.id('f_foto'), 'tipo', 'texto',
                                                       'trecho', 'prova de outra conversa')),
    'foto', null, 'motivo', 'inventado')) ->> 'canal', 'nao_identificado',
  'prova de outra conversa não vale: sem prova, Não identificado');
select is(pg_temp.gravar(pg_temp.ultima(pg_temp.id('h')),
  jsonb_build_object('canal', 'placa', 'subcanal', 'instagram', 'confianca', 0.95, 'evidencias', '[]'::jsonb)) ->> 'motivo',
  'resultado_invalido', 'par canal/subcanal errado é recusado');

select pg_temp.conversa('w', '+5584999913106');
select pg_temp.dele('w_msg', pg_temp.id('w'), now() - interval '10 minutes', 'vi no insta');
select app.chegadas_rodar(1000);
select is(pg_temp.gravar(pg_temp.ultima(pg_temp.id('w')),
  jsonb_build_object('canal', 'anuncios', 'subcanal', 'anuncio_outro', 'confianca', 0.4,
    'evidencias', jsonb_build_array(jsonb_build_object('message_id', pg_temp.id('w_msg'), 'tipo', 'texto',
                                                       'trecho', 'vi no insta')))) ->> 'motivo',
  'regra_fraca_mantida', 'a IA sem certeza não derruba a regra fraca');
select is((select canal || ' · ' || (sugestao_da_ia ->> 'canal') from public.chegadas
            where id = pg_temp.ultima(pg_temp.id('w'))), 'redes_sociais · anuncios',
  'mas o palpite dela fica guardado');
select is(pg_temp.gravar(pg_temp.ultima(pg_temp.id('w')),
  jsonb_build_object('canal', 'anuncios', 'subcanal', 'meta_anuncio', 'confianca', 0.85,
    'evidencias', jsonb_build_array(jsonb_build_object('message_id', pg_temp.id('w_msg'), 'tipo', 'texto',
                                                       'trecho', 'vi no insta')))) ->> 'canal',
  'anuncios', 'a IA com certeza passa por cima da regra fraca');

select pg_temp.entrar('a0000000-0000-4000-8000-000000013801'::uuid, 'gestor');
select public.chegada_marcar(pg_temp.ultima(pg_temp.id('w')), 'outros', 'indicacao');
select pg_temp.sair();
select is(app.canal_entrada_da_ia(pg_temp.ultima(pg_temp.id('w'))) ->> 'pular', 'marcada_por_gente',
  'corrigida por gente, a IA nem lê');
select is(pg_temp.gravar(pg_temp.ultima(pg_temp.id('w')),
  jsonb_build_object('canal', 'redes_sociais', 'subcanal', 'instagram', 'confianca', 0.99,
    'evidencias', jsonb_build_array(jsonb_build_object('message_id', pg_temp.id('w_msg'), 'tipo', 'texto',
                                                       'trecho', 'vi no insta')))) ->> 'motivo',
  'marcada_por_gente', 'e se gravar, não vale');
select is((select canal from public.chegadas where id = pg_temp.ultima(pg_temp.id('w'))), 'outros',
  'o que gente marcou continua');
select is(pg_temp.gravar(pg_temp.ultima(pg_temp.id('s')),
  jsonb_build_object('canal', 'placa', 'subcanal', 'texto_da_placa', 'confianca', 0.99,
    'evidencias', '[]'::jsonb)) ->> 'motivo', 'regra_forte', 'nem por cima da regra forte');

-- =====================================================================
-- 5. O orçamento no limite
-- =====================================================================
-- Teto de 1 centavo e um gasto de 2 (o preço do Sonnet 5 é o do pgTAP 67).
update public.app_settings set value = value || '{"mensal_usd": 0.01}'::jsonb where key = 'ia.orcamento';
insert into public.ai_runs (purpose, model, prompt_version, tokens_in, tokens_out)
values ('digest', 'claude-sonnet-5', 'pgtap138-gasto@v1', 10000, 0);
select pg_temp.conversa('b', '+5584999913107');
select pg_temp.dele(null, pg_temp.id('b'), now() - interval '10 minutes', 'Oi');
select app.chegadas_rodar(1000);
select ok((select ia_adiada from public.chegadas where id = pg_temp.ultima(pg_temp.id('b'))),
  'freio fechado: a leitura vira dívida');
select is(app.chegada_avaliar(pg_temp.ultima(pg_temp.id('b')), now() + interval '25 hours'), 'fechada',
  'e a chegada fecha no prazo, sem esperar');
select is((select motivo from public.chegadas where id = pg_temp.ultima(pg_temp.id('b'))),
  'Sem sinal nas primeiras 24 h (a IA estava no limite do orçamento)', 'dizendo o porquê');

-- =====================================================================
-- 6. Só o worker; e o WhatsApp não muda
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000013801'::uuid, 'gestor');
select throws_ok($$select public.canal_gravar_da_ia(gen_random_uuid(), '{}'::jsonb, now())$$, '42501', null,
  'quem está na tela não grava pela porta do worker');
select pg_temp.sair();
select is((select count(*) from public.messages m where m.direction = 'out'::app.msg_direction),
  (select saidas from t138_base), 'nenhuma mensagem de saída nasceu');
select is((select count(*) from pgmq.q_wa_outbound), (select fila from t138_base),
  'e nada entrou na fila de saída do WhatsApp');

select * from finish();
rollback;

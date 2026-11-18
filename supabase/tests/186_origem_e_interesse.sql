-- =====================================================================
-- pgTAP — A aba Origem e interesse da Imova (migração 20261118200000)
--
-- Prova: quem vê relatório vê esta aba (admin, gestor, SDR) e o embaixador
-- não; as chegadas do período contam por grupo (a Meta à parte dos portais,
-- cada anúncio da Meta pelo id, com a marca "não é da Imova" de admin e
-- gestor); a primeira resposta separa IA, equipe e ninguém; a subida e o
-- esfriamento de interesse vêm do histórico da etiqueta; o anúncio do Canal
-- Pro conta quem chegou com o código e os vistos do PERÍODO pela foto
-- diária; e o gatilho da foto diária nunca derruba a importação.
--
-- Os dados de teste moram numa semana de 2020 (02 a 08/03), para nenhum dado
-- de verdade do banco local entrar nas contas. Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(22);

insert into public.allowed_users (email, role, note) values
  ('h186.g@teste.local', 'gestor', 'pgTAP 186'),
  ('h186.s@teste.local', 'sdr', 'pgTAP 186'),
  ('h186.e@teste.local', 'embaixador', 'pgTAP 186');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000018601'::uuid, 'h186.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000018602'::uuid, 'h186.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000018603'::uuid, 'h186.e@teste.local', '{"full_name":"Eva Embaixadora"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999918600"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

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

create temp table t186(chave text primary key, valor uuid);
grant select on t186 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t186 where chave = p_chave
$$;
grant execute on function pg_temp.id(text) to authenticated;

-- Uma conversa com a chegada já decidida: a primeira mensagem da pessoa às
-- `p_em`, o canal e quem decidiu.
create function pg_temp.chegou(p_chave text, p_tel text, p_em timestamptz, p_canal text, p_sub text,
                               p_por text, p_conteudo jsonb default null, p_codigo text default null,
                               p_foto jsonb default null)
returns uuid language plpgsql as $$
declare v_conv uuid; v_msg uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999918600', p_tel, 'Cliente ' || p_chave,
          'a0000000-0000-4000-8000-000000018601'::uuid, 'aguardando_nos')
  returning id into v_conv;
  insert into t186 values (p_chave, v_conv);
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, conteudo, created_at)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status, 'Olá',
          'system', 'crm', p_conteudo, p_em)
  returning id into v_msg;
  insert into public.chegadas (conversation_id, primeira_mensagem_id, inicio_em, situacao, canal_automatico,
                               subcanal_automatico, confianca, decidido_por, codigo_do_anuncio, foto,
                               fecha_em, fechada_em)
  values (v_conv, v_msg, p_em, 'fechada', p_canal, p_sub, 0.9, p_por, p_codigo, p_foto,
          p_em + interval '24 hours', p_em + interval '24 hours');
  return v_conv;
end $$;
-- A equipe responde pelo celular (eco). A resposta da IA entra como a
-- fila do CRM a grava depois de sair: a parede de `messages` (rascunho
-- aprovado etc.) fica de lado só neste insert, como nos pgTAP 119 e 151.
create function pg_temp.respondeu(p_conv uuid, p_em timestamptz, p_autor text) returns void language plpgsql as $$
begin
  if p_autor = 'human' then
    insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                                 sent_by, wa_message_id, created_at, sent_at)
    values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
            'pgtap186 nossa', 'human', 'echo', 'a0000000-0000-4000-8000-000000018601'::uuid,
            'wamid.PGTAP186.' || gen_random_uuid(), p_em, p_em);
  else
    alter table public.messages disable trigger messages_guard;
    insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                                 wa_message_id, created_at, sent_at)
    values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
            'pgtap186 da IA', 'bot_ai', 'crm', 'wamid.PGTAP186.' || gen_random_uuid(), p_em, p_em);
    alter table public.messages enable trigger messages_guard;
  end if;
end $$;
create function pg_temp.etiqueta(p_conv uuid, p_agora text, p_de text, p_para text, p_em timestamptz)
returns void language sql as $$
  insert into public.atitudes (conversation_id, etiqueta, motivo, desde, calculada_em)
  values (p_conv, p_agora, 'pgTAP 186', p_em, p_em)
  on conflict (conversation_id) do update set etiqueta = excluded.etiqueta;
  insert into public.atitude_historico (conversation_id, tipo, de, para, motivo, em)
  values (p_conv, 'etiqueta', p_de, p_para, 'pgTAP 186', p_em);
$$;

create temp table t186_r (r jsonb);
grant select, insert, delete on t186_r to authenticated;
create function pg_temp.r() returns jsonb language sql stable as $$ select r from t186_r limit 1 $$;
grant execute on function pg_temp.r() to authenticated;
create function pg_temp.grupo(p text) returns jsonb language sql stable as $$
  select g from jsonb_array_elements(pg_temp.r() -> 'grupos') g where g ->> 'grupo' = p
$$;
create function pg_temp.anuncio(p text) returns jsonb language sql stable as $$
  select a from jsonb_array_elements(pg_temp.r() -> 'anuncios') a where a ->> 'codigo' = p
$$;

select pg_temp.virar('imova');

-- A semana de teste: quatro chegadas em 03/03/2020 (America/Fortaleza).
--   placa:  foto da placa da Imova, lida pela IA; a equipe respondeu em 3 min.
--   meta:   clique num anúncio da Meta (id 999000186); ninguém respondeu.
--   portal: o texto pronto do ZAP com o código PG1860_IMOVA; a IA respondeu em 1 min.
--   ni:     sem pista; a equipe respondeu em 2 h.
select pg_temp.chegou('placa', '+5584999918601', '2020-03-03 10:00-03', 'placa', 'foto_da_placa', 'ia',
                      p_foto => '{"peca": "placa", "marca": "imova", "codigo_do_imovel": null}'::jsonb);
select pg_temp.respondeu(pg_temp.id('placa'), '2020-03-03 10:03-03', 'human');
select pg_temp.chegou('meta', '+5584999918602', '2020-03-03 11:00-03', 'anuncios', 'meta_anuncio', 'regra',
                      p_conteudo => '{"anuncio": {"tipo": "ad", "id": "999000186", "titulo": "Anúncio de fora"}}'::jsonb);
select pg_temp.chegou('portal', '+5584999918603', '2020-03-03 12:00-03', 'anuncios', 'portal_zap', 'regra',
                      p_codigo => 'PG1860_IMOVA');
select pg_temp.respondeu(pg_temp.id('portal'), '2020-03-03 12:01-03', 'bot_ai');
select pg_temp.chegou('ni', '+5584999918604', '2020-03-03 13:00-03', 'nao_identificado', 'desconhecido', 'ia');
select pg_temp.respondeu(pg_temp.id('ni'), '2020-03-03 15:00-03', 'human');

-- O interesse da semana: a placa respondeu e subiu (sem resposta → morno →
-- interessado); o portal esfriou.
select pg_temp.etiqueta(pg_temp.id('placa'), 'interessado', 'sem_resposta', 'morno', '2020-03-04 09:00-03');
select pg_temp.etiqueta(pg_temp.id('placa'), 'interessado', 'morno', 'interessado', '2020-03-05 09:00-03');
select pg_temp.etiqueta(pg_temp.id('portal'), 'esfriando', 'interessado', 'esfriando', '2020-03-06 09:00-03');

-- O anúncio do Canal Pro: 100 vistos hoje; a foto de antes da semana (40) e a
-- do fim dela (150) entram à mão, como se o gatilho as tivesse gravado.
insert into public.anuncios_no_canal_pro (codigo, titulo, situacao, linha)
values ('PG1860_IMOVA', 'Terreno do pgTAP 186', 'Ativo',
        '{"Total de visualizações": "100", "Total de contatos": "5"}'::jsonb);
insert into t186 select 'cp', id from public.anuncios_no_canal_pro where codigo = 'PG1860_IMOVA';
insert into public.canal_pro_numeros_do_dia (anuncio_no_canal_pro_id, dia, vistos, contatos) values
  (pg_temp.id('cp'), '2020-03-01', 40, 2),
  (pg_temp.id('cp'), '2020-03-08', 150, 9);

-- =====================================================================
-- A foto diária do Canal Pro
-- =====================================================================
select is((select vistos from public.canal_pro_numeros_do_dia
            where anuncio_no_canal_pro_id = pg_temp.id('cp') and dia = (now() at time zone 'America/Fortaleza')::date),
          100, 'importar o anúncio grava a foto do dia');
update public.anuncios_no_canal_pro set linha = '{"Total de visualizações": "1.250", "Total de contatos": "7"}'::jsonb
 where id = pg_temp.id('cp');
select is((select vistos from public.canal_pro_numeros_do_dia
            where anuncio_no_canal_pro_id = pg_temp.id('cp') and dia = (now() at time zone 'America/Fortaleza')::date),
          1250, 'a nova leitura do mesmo dia troca a foto (e lê "1.250")');
select lives_ok($$update public.anuncios_no_canal_pro set linha = '{"Total de visualizações": "muitos"}'::jsonb
                   where id = pg_temp.id('cp')$$,
  'uma linha sem número não derruba a importação');

-- =====================================================================
-- Quem vê e quem marca
-- =====================================================================
select throws_ok($$select public.relatorio_imova_painel_origem('2020-03-02', '2020-03-08')$$, '42501', null,
  'sem login, nada');
select pg_temp.entrar('a0000000-0000-4000-8000-000000018603'::uuid, 'embaixador');
select throws_ok($$select public.relatorio_imova_painel_origem('2020-03-02', '2020-03-08')$$, '42501', null,
  'o embaixador não vê relatório');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000018602'::uuid, 'sdr');
select throws_ok($$select public.anuncio_da_meta_marcar('999000186', false)$$, '42501', null,
  'o SDR não diz de quem é o anúncio');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000018601'::uuid, 'gestor');
select lives_ok($$select public.anuncio_da_meta_marcar('999000186', false)$$, 'o gestor marca o anúncio como de fora');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000018602'::uuid, 'sdr');
select lives_ok($$insert into t186_r select public.relatorio_imova_painel_origem('2020-03-02', '2020-03-08')$$,
  'o SDR lê a aba');
select pg_temp.sair();

-- =====================================================================
-- De onde vieram
-- =====================================================================
select is((pg_temp.r() #>> '{kpis,chegadas}')::int, 4, 'as quatro chegadas da semana');
select is((pg_temp.r() #>> '{kpis,identificadas}')::int, 3, 'três com a origem descoberta');
select is((pg_temp.r() #>> '{kpis,rapidas}')::int, 2, 'duas respondidas em até 5 min');
select is((pg_temp.grupo('meta') ->> 'chegadas')::int, 1, 'a Meta fica à parte dos portais');
select is(pg_temp.grupo('meta') #>> '{anuncios,0,id}', '999000186', 'o anúncio da Meta vem pelo id');
select is((pg_temp.grupo('meta') #>> '{anuncios,0,da_imova}')::boolean, false, 'com a marca de que não é da Imova');
select is(pg_temp.grupo('portais') #>> '{subs,0,subcanal}', 'portal_zap', 'os portais por portal');

-- =====================================================================
-- Como o sistema está lidando
-- =====================================================================
select is((pg_temp.r() #> '{sistema,primeiro}') - 'ia_mediana_min' - 'equipe_mediana_min',
          '{"ia": 1, "equipe": 2, "ninguem": 1}'::jsonb, 'quem respondeu primeiro: IA, equipe e ninguém');
select is(pg_temp.r() #>> '{sistema,sem_resposta,0,conversation_id}', pg_temp.id('meta')::text,
  'a chegada sem resposta aparece na lista');
select is((pg_temp.r() #>> '{sistema,descoberta,fotos_da_imova}')::int, 1, 'a foto da placa da Imova conta');

-- =====================================================================
-- Interesse
-- =====================================================================
select is((pg_temp.r() #>> '{interesse,subiram}')::int, 1, 'quem subiu de degrau conta uma vez');
select is((pg_temp.r() #>> '{interesse,esfriaram}')::int, 1, 'quem esfriou');

-- =====================================================================
-- Anúncio a anúncio
-- =====================================================================
select is((pg_temp.anuncio('PG1860_IMOVA') ->> 'chegaram')::int, 1, 'quem chegou com o código do anúncio');
select is((pg_temp.anuncio('PG1860_IMOVA') ->> 'vistos_periodo')::int, 110,
  'os vistos da semana saem da foto diária (150 − 40)');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — A IA que atende procura no mapa o lugar que o cliente citou
-- (migração 20261123150000)
--
-- Só na Imova. Prova:
--   1. As tabelas novas têm RLS: gestor lê a leitura das mensagens, leitura não;
--      o cache ninguém logado lê; as portas são só do worker (`service_role`).
--   2. OS TEXTOS DO CLIENTE: só texto recebido (foto e mensagem do time não), da
--      mais antiga para a mais nova; gravada a leitura, a mensagem deixa de ser
--      pendente e a anotação aparece na conversa.
--   3. GRAVAR: só mensagem de texto do cliente; método torto é recusado.
--   4. O CACHE: a chave ignora acento, caixa e espaço; até 3 resultados; "não achado"
--      grava lista vazia e vence em 30 dias; o vencido não volta.
--   5. OS IMÓVEIS NO MAPA: os mesmos que a IA conhece, com o pino do anúncio quando
--      há; anúncio excluído sai.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(22);

insert into public.allowed_users (email, role, note) values
  ('h197.g@teste.local', 'gestor', 'pgTAP 197'),
  ('h197.l@teste.local', 'leitura', 'pgTAP 197');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000019701'::uuid, 'h197.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000019702'::uuid, 'h197.l@teste.local', '{"full_name":"Leo Leitura"}');

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

create temp table t197(chave text primary key, valor uuid);
grant all on t197 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t197 where chave = p_chave
$$;

-- Dois anúncios: um com pino (o terreno da praia) e um sem; e um excluído.
insert into public.anuncios (codigo, situacao, titulo, tipo, negocio, preco_venda, bairro, cidade, estado,
                             endereco, cep, latitude, longitude)
values ('TST197A_IMOVA', 'no_ar', 'Terreno frente-mar', 'terreno', 'venda', 520000, 'Praia de Tabatinga',
        'Nísia Floresta', 'RN', 'Av Barra de Tabatinga', '59164000', -6.059, -35.104),
       ('TST197B_IMOVA', 'rascunho', 'Casa', 'casa', 'venda', 300000, 'Potengi', 'Natal', 'RN',
        'Rua Barra do Piraí', '59112210', null, null),
       ('TST197C_IMOVA', 'no_ar', 'Excluído', 'casa', 'venda', 100000, 'Tirol', 'Natal', 'RN',
        'Rua C', null, -5.8, -35.2);
update public.anuncios set excluido_em = now(), motivo_exclusao = 'pgTAP 197' where codigo = 'TST197C_IMOVA';

create function pg_temp.mensagem(p_chave text, p_conv uuid, p_dir text, p_tipo text, p_corpo text, p_seg int)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               media_path, media_mime, created_at)
  values (p_conv, p_dir::app.msg_direction, p_tipo::app.msg_type,
          'received'::app.msg_status, p_corpo, 'system', 'crm',
          case when p_tipo = 'image' then p_conv || '/' || p_chave || '.jpg' end,
          case when p_tipo = 'image' then 'image/jpeg' end,
          now() - make_interval(secs => p_seg))
  returning id into v;
  insert into t197 values (p_chave, v);
  return v;
end $$;

with c as (
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, status)
  values ('whatsapp'::app.channel, '+5584999919700', '+5584999919701', 'Cliente 197', 'aguardando_nos')
  returning id)
insert into t197 select 'conversa', id from c;

select pg_temp.mensagem('oi', pg_temp.id('conversa'), 'in', 'text', 'Boa tarde', 90);
select pg_temp.mensagem('foto', pg_temp.id('conversa'), 'in', 'image', null, 80);
with m as (
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (pg_temp.id('conversa'), 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'Qual a rua?', 'human', 'echo', 'a0000000-0000-4000-8000-000000019701'::uuid,
          'wamid.PGTAP197.' || gen_random_uuid(), now() - interval '70 seconds', now() - interval '70 seconds')
  returning id)
insert into t197 select 'time', id from m;
select pg_temp.mensagem('rua', pg_temp.id('conversa'), 'in', 'text',
                        'Avenida Praia de Camurupim Nísia Floresta - RN', 60);

-- ---------------------------------------------------------------------
-- 1. RLS e portas
-- ---------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.ia_lugares_no_mapa'::regclass)
          and (select relrowsecurity from pg_class where oid = 'public.ia_referencias_de_lugar'::regclass),
          'as duas tabelas nascem com RLS');
select ok(not has_function_privilege('authenticated', 'public.ia_referencia_gravar(uuid, text, jsonb, text, bigint)', 'execute')
          and not has_function_privilege('authenticated', 'public.ia_lugar_no_mapa_gravar(text, jsonb, text)', 'execute')
          and not has_function_privilege('anon', 'public.ia_textos_do_cliente_para_o_mapa(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.ia_imoveis_no_mapa()', 'execute'),
          'as portas são só do worker: ninguém logado nem anônimo usa');
select ok(has_function_privilege('service_role', 'public.ia_imoveis_no_mapa()', 'execute')
          and has_function_privilege('service_role', 'public.ia_lugar_no_mapa_ler(text)', 'execute')
          and has_function_privilege('service_role', 'public.ia_referencias_da_conversa(uuid)', 'execute'),
          'o worker (service_role) usa as portas');

-- ---------------------------------------------------------------------
-- 2. Os textos do cliente
-- ---------------------------------------------------------------------
select is((select array_agg(t.message_id order by t.recebida_em)
             from public.ia_textos_do_cliente_para_o_mapa(pg_temp.id('conversa')) t),
          array[pg_temp.id('oi'), pg_temp.id('rua')],
          'só os textos recebidos, do mais antigo ao mais novo (foto e mensagem do time não)');
select ok((select bool_and(t.pendente) from public.ia_textos_do_cliente_para_o_mapa(pg_temp.id('conversa')) t),
          'sem leitura, os dois estão pendentes');

-- ---------------------------------------------------------------------
-- 3. Gravar a leitura
-- ---------------------------------------------------------------------
select is(public.ia_referencia_gravar(pg_temp.id('oi'), 'sem_pista', '[]'::jsonb, null) ->> 'ok', 'true',
          'mensagem sem pista grava como sem_pista');
select is(public.ia_referencia_gravar(pg_temp.id('rua'), 'localizador',
            '{"imovel":"TST197A_IMOVA","certeza":"media"}'::jsonb,
            '[no mapa: "Avenida Praia de Camurupim" fica na mesma região do TST197A_IMOVA]') ->> 'ok', 'true',
          'a leitura do Localizador grava com a anotação');
select is(public.ia_referencia_gravar(pg_temp.id('foto'), 'localizador', '{}'::jsonb, null) ->> 'motivo',
          'nao_e_texto_do_cliente', 'foto não é texto do cliente');
select is(public.ia_referencia_gravar(pg_temp.id('time'), 'localizador', '{}'::jsonb, null) ->> 'motivo',
          'nao_e_texto_do_cliente', 'mensagem do time não é do cliente');
select is(public.ia_referencia_gravar(pg_temp.id('rua'), 'chute', '[]'::jsonb, null) ->> 'motivo',
          'metodo_invalido', 'método torto é recusado');
select ok(not exists (select 1 from public.ia_textos_do_cliente_para_o_mapa(pg_temp.id('conversa')) t where t.pendente),
          'lidas, nenhuma mensagem fica pendente');
select is((select array_agg(r.message_id) from public.ia_referencias_da_conversa(pg_temp.id('conversa')) r),
          array[pg_temp.id('rua')],
          'só a mensagem com anotação aparece para a conversa');

select pg_temp.entrar('a0000000-0000-4000-8000-000000019701'::uuid, 'gestor');
select is((select count(*)::int from public.ia_referencias_de_lugar
            where conversation_id = (select valor from t197 where chave = 'conversa')), 2,
          'o gestor lê a leitura das mensagens');
select is((select count(*)::int from public.ia_lugares_no_mapa), 0, 'o cache ninguém logado lê');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000019702'::uuid, 'leitura');
select is((select count(*)::int from public.ia_referencias_de_lugar), 0, 'o papel leitura não lê');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 4. O cache
-- ---------------------------------------------------------------------
select is(public.ia_lugar_no_mapa_gravar('Avenida Praia de Camurupim, Nísia Floresta, RN',
            '[{"nome":"Avenida Praia de Camurupim","tipo":"secondary","nivel":"ponto","bairro":"Camurupim",
               "cidade":"Nísia Floresta","lat":-6.08967,"lng":-35.1004}]'::jsonb, 'ODbL') ->> 'resultados', '1',
          'o mapa grava o lugar achado');
select is((public.ia_lugar_no_mapa_ler('  avenida praia de CAMURUPIM,  nisia floresta, rn') -> 0 ->> 'bairro'),
          'Camurupim', 'a chave ignora acento, caixa e espaço');
select is(public.ia_lugar_no_mapa_gravar('Camurupim, RN',
            '[{"nome":"a"},{"nome":"b"},{"nome":"c"},{"nome":"d"}]'::jsonb, null) ->> 'resultados', '3',
          'mais de três resultados ficam os três primeiros');
select public.ia_lugar_no_mapa_gravar('Condomínio Serv Club, Nísia Floresta, RN', '[]'::jsonb, 'ODbL');
select ok((select l.expira_em <= l.buscado_em + interval '30 days' and jsonb_array_length(l.resultados) = 0
             from public.ia_lugares_no_mapa l
            where l.consulta = app.ia_chave_do_lugar('Condomínio Serv Club, Nísia Floresta, RN')),
          '"não achado" grava lista vazia e vale só 30 dias');
update public.ia_lugares_no_mapa set expira_em = now() - interval '1 minute'
 where consulta = app.ia_chave_do_lugar('Condomínio Serv Club, Nísia Floresta, RN');
select ok(public.ia_lugar_no_mapa_ler('Condomínio Serv Club, Nísia Floresta, RN') is null,
          'o que venceu não volta: a pergunta é feita de novo');

-- ---------------------------------------------------------------------
-- 5. Os imóveis no mapa
-- ---------------------------------------------------------------------
select ok((select i.latitude = -6.059 and i.longitude = -35.104 and i.cidade = 'Nísia Floresta'
                  and i.cep = '59164000'
             from public.ia_imoveis_no_mapa() i where i.codigo = 'TST197A_IMOVA'),
          'o anúncio com pino vem com o pino e o CEP');
select ok((select i.latitude is null and i.endereco = 'Rua Barra do Piraí'
             from public.ia_imoveis_no_mapa() i where i.codigo = 'TST197B_IMOVA')
          and not exists (select 1 from public.ia_imoveis_no_mapa() i where i.codigo = 'TST197C_IMOVA'),
          'o sem pino vem com o endereço para o worker achar; o excluído não vem');

select * from finish();
rollback;

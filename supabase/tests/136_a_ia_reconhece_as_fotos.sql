-- =====================================================================
-- pgTAP — A IA que atende reconhece a foto do anúncio (migração 20261109130000)
--
-- Só na Imova. Prova:
--   1. As tabelas novas têm RLS: gestor e SDR leem, leitura não; ninguém de fora
--      escreve (as portas são só do worker, `service_role`).
--   2. A IMPRESSÃO: a foto do anúncio sem impressão aparece para o worker; gravada,
--      sai da lista e vira referência; impressão torta vira nula; anúncio excluído
--      tira as fotos dele das referências.
--   3. A FOTO DO CLIENTE: só foto recebida (figurinha não), só uma vez; código que a
--      IA não conhece vira "não reconheceu".
--   4. O TREINO ENSINA: só na conversa do treino, só foto dela, só anúncio que a IA
--      conhece; o que o treino ensinou não é desfeito por uma leitura nova.
--   5. OS DADOS: a descrição vai inteira (antes, 900 caracteres) e o complemento só
--      quando o anúncio mostra o endereço completo.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(27);

insert into public.allowed_users (email, role, note) values
  ('h136.g@teste.local', 'gestor', 'pgTAP 136'),
  ('h136.s@teste.local', 'sdr', 'pgTAP 136'),
  ('h136.l@teste.local', 'leitura', 'pgTAP 136');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000013601'::uuid, 'h136.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000013602'::uuid, 'h136.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000013603'::uuid, 'h136.l@teste.local', '{"full_name":"Leo Leitura"}');

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

create temp table t136(chave text primary key, valor uuid);
grant all on t136 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t136 where chave = p_chave
$$;

-- Dois anúncios (um com endereço completo e descrição longa) e duas fotos.
with a as (
  insert into public.anuncios (codigo, situacao, titulo, descricao, tipo, negocio, preco_venda,
                               area_util, area_total, quartos, suites, bairro, cidade, estado,
                               endereco, numero, complemento, mostrar_endereco)
  values ('TST136A_IMOVA', 'no_ar', 'Casa no Tirol', repeat('Medidas: 10 m de frente por 30 m de fundo. ', 30),
          'casa', 'venda', 450000, 120, 300, 3, 0, 'Tirol', 'Natal', 'RN',
          'Rua A', '10', 'Casa 2', 'completo')
  returning id)
insert into t136 select 'anuncioA', id from a;
with a as (
  insert into public.anuncios (codigo, situacao, titulo, tipo, negocio, preco_venda, bairro, cidade,
                               estado, endereco, numero, complemento, mostrar_endereco)
  values ('TST136B_IMOVA', 'no_ar', 'Terreno', 'terreno', 'venda', 200000, 'Pitimbu', 'Natal', 'RN',
          'Rua B', '20', 'Lote 3', 'rua')
  returning id)
insert into t136 select 'anuncioB', id from a;
with f as (
  insert into public.anuncio_fotos (anuncio_id, caminho, posicao)
  values (pg_temp.id('anuncioA'), pg_temp.id('anuncioA') || '/capa.jpg', 0) returning id)
insert into t136 select 'fotoA', id from f;
with f as (
  insert into public.anuncio_fotos (anuncio_id, caminho, posicao)
  values (pg_temp.id('anuncioB'), pg_temp.id('anuncioB') || '/capa.jpg', 0) returning id)
insert into t136 select 'fotoB', id from f;

-- A conversa do treino e outra, com uma foto, uma figurinha e um texto.
create function pg_temp.conversa(p_chave text, p_tel text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, status)
  values ('whatsapp'::app.channel, '+5584999913600', p_tel, 'Cliente ' || p_chave, 'aguardando_nos')
  returning id into v;
  insert into t136 values (p_chave, v);
  return v;
end $$;
create function pg_temp.recebida(p_chave text, p_conv uuid, p_tipo text, p_meta text, p_seg int)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               media_path, media_mime, tipo_na_meta, created_at)
  values (p_conv, 'in'::app.msg_direction, p_tipo::app.msg_type, 'received'::app.msg_status,
          case when p_tipo = 'text' then 'oi' end, 'system', 'crm',
          case when p_tipo = 'image' then p_conv || '/' || p_chave || '.jpg' end,
          case when p_tipo = 'image' then 'image/jpeg' end, p_meta,
          now() - make_interval(secs => p_seg))
  returning id into v;
  insert into t136 values (p_chave, v);
  return v;
end $$;
select pg_temp.conversa('treino', '+5584999913601');
select pg_temp.conversa('outra', '+5584999913602');
select pg_temp.recebida('foto1', pg_temp.id('treino'), 'image', null, 60);
select pg_temp.recebida('figurinha', pg_temp.id('treino'), 'image', 'sticker', 50);
select pg_temp.recebida('texto', pg_temp.id('treino'), 'text', null, 40);
select pg_temp.recebida('foto2', pg_temp.id('treino'), 'image', null, 30);
select pg_temp.recebida('fotoOutra', pg_temp.id('outra'), 'image', null, 20);

select pg_temp.entrar('a0000000-0000-4000-8000-000000013601'::uuid, 'gestor');
select public.ia_atendente_configurar(jsonb_build_object('conversa_de_treino', pg_temp.id('treino')));
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 1. RLS e portas
-- ---------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.ia_impressoes'::regclass),
          'ia_impressoes nasce com RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ia_fotos_reconhecidas'::regclass),
          'ia_fotos_reconhecidas nasce com RLS');
select ok(not has_function_privilege('authenticated', 'public.ia_impressao_gravar(uuid, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.ia_foto_ensinar(uuid, uuid, text, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.ia_foto_reconhecida_gravar(uuid, text, text, text, text, int, bigint)', 'execute')
          and not has_function_privilege('anon', 'public.ia_fotos_do_cliente(uuid, int)', 'execute'),
          'as portas são só do worker: ninguém logado nem anônimo grava');
select ok(has_function_privilege('service_role', 'public.ia_fotos_de_referencia()', 'execute')
          and has_function_privilege('service_role', 'public.ia_foto_ensinar(uuid, uuid, text, text)', 'execute'),
          'o worker (service_role) usa as portas');

-- ---------------------------------------------------------------------
-- 2. A impressão das fotos dos anúncios
-- ---------------------------------------------------------------------
select ok(exists (select 1 from public.ia_fotos_sem_impressao(200) f where f.foto_id = pg_temp.id('fotoA')),
          'a foto do anúncio sem impressão aparece para o worker');
select is(public.ia_impressao_gravar(pg_temp.id('fotoA'), '00ff00ff00ff00ff'), true, 'o worker grava a impressão');
select ok(not exists (select 1 from public.ia_fotos_sem_impressao(200) f where f.foto_id = pg_temp.id('fotoA')),
          'gravada, a foto sai da lista de pendentes');
select is((select r.impressao from public.ia_fotos_de_referencia() r where r.codigo = 'TST136A_IMOVA'),
          '00ff00ff00ff00ff', 'e vira referência do anúncio, com o código');
select public.ia_impressao_gravar(pg_temp.id('fotoB'), 'isto não é hash');
select ok((select r.impressao is null from public.ia_fotos_de_referencia() r where r.codigo = 'TST136B_IMOVA'),
          'impressão torta (foto que não abriu) fica nula e não volta para a fila');

-- ---------------------------------------------------------------------
-- 3. As fotos do cliente
-- ---------------------------------------------------------------------
select is((select array_agg(f.message_id order by f.recebida_em)
             from public.ia_fotos_do_cliente(pg_temp.id('treino'), 3) f),
          array[pg_temp.id('foto1'), pg_temp.id('foto2')],
          'só as fotos recebidas: figurinha e texto ficam de fora');
select is((select r ->> 'codigo' from public.ia_foto_reconhecida_gravar(
             pg_temp.id('foto2'), 'TST136A_IMOVA', 'impressao', 'alta', null, 2, null) r),
          'TST136A_IMOVA', 'a foto reconhecida pela impressão grava o anúncio');
select ok(not exists (select 1 from public.ia_fotos_do_cliente(pg_temp.id('treino'), 3) f
                       where f.message_id = pg_temp.id('foto2')),
          'reconhecida uma vez, a foto não é lida de novo');
select is((select r ->> 'metodo' from public.ia_foto_reconhecida_gravar(
             pg_temp.id('foto1'), 'INVENTADO_IMOVA', 'visao', 'alta', 'uma casa', null, null) r),
          'nao_reconheceu', 'código que a IA não conhece vira "não reconheceu"');
select is((select codigo from public.ia_fotos_reconhecidas where message_id = pg_temp.id('foto1')), null,
          'e nenhum anúncio inventado fica gravado');
select is((select r ->> 'ok' from public.ia_foto_reconhecida_gravar(
             pg_temp.id('texto'), 'TST136A_IMOVA', 'visao', 'alta', null, null, null) r),
          'false', 'mensagem que não é foto não é reconhecida');

-- ---------------------------------------------------------------------
-- 4. O treino ensina a foto
-- ---------------------------------------------------------------------
select is(public.ia_foto_ensinar(pg_temp.id('outra'), pg_temp.id('fotoOutra'), 'TST136B_IMOVA', null) ->> 'motivo',
          'so_no_treino', 'fora da conversa do treino, não se ensina foto');
select is(public.ia_foto_ensinar(pg_temp.id('treino'), pg_temp.id('fotoOutra'), 'TST136B_IMOVA', null) ->> 'motivo',
          'nao_e_foto_da_conversa', 'só foto da própria conversa do treino');
select is(public.ia_foto_ensinar(pg_temp.id('treino'), pg_temp.id('foto1'), 'NAO_EXISTE', null) ->> 'motivo',
          'anuncio_desconhecido', 'só anúncio que a IA conhece');
select is(public.ia_foto_ensinar(pg_temp.id('treino'), pg_temp.id('foto1'), 'TST136B_IMOVA', null) ->> 'caminho',
          pg_temp.id('treino') || '/foto1.jpg', 'ensinou: devolve o caminho para o worker calcular a impressão');
select public.ia_foto_ensinar(pg_temp.id('treino'), pg_temp.id('foto1'), 'TST136B_IMOVA', '0123456789abcdef');
select is((select impressao from public.ia_impressoes where message_id = pg_temp.id('foto1')), '0123456789abcdef',
          'a foto ensinada vira referência, com a impressão');
select is((select metodo || ':' || codigo from public.ia_fotos_reconhecidas where message_id = pg_temp.id('foto1')),
          'ensinada:TST136B_IMOVA', 'e a foto fica reconhecida como ensinada');
select public.ia_foto_reconhecida_gravar(pg_temp.id('foto1'), 'TST136A_IMOVA', 'visao', 'alta', null, null, null);
select is((select metodo || ':' || codigo from public.ia_fotos_reconhecidas where message_id = pg_temp.id('foto1')),
          'ensinada:TST136B_IMOVA', 'uma leitura nova não desfaz o que o treino ensinou');

-- Anúncio excluído: as fotos dele (e as ensinadas) saem das referências.
update public.anuncios set excluido_em = now() where id = pg_temp.id('anuncioB');
select ok(not exists (select 1 from public.ia_fotos_de_referencia() r where r.codigo = 'TST136B_IMOVA'),
          'anúncio excluído sai das referências');

-- ---------------------------------------------------------------------
-- 5. Os dados do imóvel
-- ---------------------------------------------------------------------
select ok((select char_length(i ->> 'descricao') from jsonb_array_elements(app.ia_atendente_imoveis()) i
            where i ->> 'codigo' = 'TST136A_IMOVA') > 900,
          'a descrição vai inteira (as medidas moram nela)');
select is((select i ->> 'complemento' from jsonb_array_elements(app.ia_atendente_imoveis()) i
            where i ->> 'codigo' = 'TST136A_IMOVA'), 'Casa 2',
          'o complemento vai quando o anúncio mostra o endereço completo');

-- ---------------------------------------------------------------------
-- 6. Quem vê
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000013602'::uuid, 'sdr');
select ok((select count(*) from public.ia_fotos_reconhecidas) >= 2, 'SDR vê o que a IA reconheceu');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000013603'::uuid, 'leitura');
select is((select count(*)::int from public.ia_fotos_reconhecidas) + (select count(*)::int from public.ia_impressoes), 0,
          'leitura não vê nada');
select pg_temp.sair();

select * from finish();
rollback;

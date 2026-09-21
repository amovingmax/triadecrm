-- =====================================================================
-- pgTAP — O envio fala em nome da Komune (migração 20260921110000)
--
-- "Eu n quero com assinatura de quem mandou pela equipe, será mais voltado a
-- ações que queremos que os leads façam" (Rafael, 21/09/2026).
--
-- O que este arquivo prova:
--   1. MODELO NOVO pela tela, com botões, e só o que a Meta aceitaria.
--   2. Ele vai para a Meta COM os botões e a base do link.
--   3. EM NOME DA MARCA: modelo com {{atendente}} não entra; ações de botão
--      que não existem no modelo não entram.
--   4. A SAÍDA leva os botões e o código do item (o sufixo do link).
--   5. O TOQUE em "Quero o convite" manda o link na hora, uma vez só; o toque
--      em "Agora não" tira a pessoa da lista.
--   6. O CLIQUE é gravado e leva ao destino do envio, com UTM; código estranho
--      vai ao destino padrão.
--   7. TEXTO LIVRE da marca sai sem "*Fulano:*".
--   8. A CONTAGEM ganha tocaram, clicaram e cadastraram.
-- =====================================================================
begin;
select plan(29);

create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function pg_temp.gestor() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-00000000e581'::uuid $$;
create function pg_temp.sdr()    returns uuid language sql as $$ select 'a0000000-0000-4000-8000-00000000e582'::uuid $$;
create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-00000000e6' || p_n)::uuid
$$;
create function pg_temp.modelo(p_codigo text) returns int language sql as $$
  select id from public.message_templates where template_code = p_codigo
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert, update on pg_temp.r to authenticated, service_role, anon;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;
create function pg_temp.item(p_org uuid) returns public.envios_em_massa_itens
language sql security definer set search_path = '' as $$
  select x.* from public.envios_em_massa_itens x
   where x.organization_id = p_org order by x.processado_em desc nulls last limit 1
$$;
grant execute on function pg_temp.item(uuid) to authenticated, service_role, anon;

create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                            'fecha_em', now() + interval '4 hours')
$$;

insert into public.allowed_users (email, role, note) values
  ('e58.gestor@teste.local', 'gestor', 'pgTAP envio da marca'),
  ('e58.sdr@teste.local',    'sdr',    'pgTAP envio da marca');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gestor(), 'e58.gestor@teste.local', '{"full_name":"Gilda Gestora"}'),
  (pg_temp.sdr(),    'e58.sdr@teste.local',    '{"full_name":"Saulo Sdr"}');

update public.app_settings
   set value = jsonb_set(value, '{numero_padrao}', '"+5584999995800"') where key = 'whatsapp.envio';
update public.app_settings
   set value = jsonb_set(jsonb_set(value, '{inicio}', '"2026-01-01"'), '{whatsapp,depois}', '100')
 where key = 'cadencia.tetos';
update public.message_templates
   set meta_status = 'approved', meta_template_name = lower(replace(template_code, '-', '_')) || '_v1'
 where template_code in ('ENV-CONVITE-FUNDADOR', 'AEB-ABR-A');

insert into public.organizations (id, name, phone_e164, source_id)
select x.id, x.nome, x.tel, (select id from public.sources where slug = 'planilha')
  from (values
  (pg_temp.org('01'), 'E58 Buffet Quer',   '+5584999995801'),
  (pg_temp.org('02'), 'E58 Doces Agora Nao', '+5584999995802')) x(id, nome, tel);

-- =====================================================================
-- 1. Modelo novo pela tela
-- =====================================================================
select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is(public.modelo_whatsapp_criar('{"nome":"Teste","corpo":"Oi, tudo bem?"}') ->> 'motivo',
  'sem_permissao', 'SDR não cria modelo');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is(public.modelo_whatsapp_criar('{"nome":"Borda","corpo":"{{nome}}, tudo bem?"}') ->> 'motivo',
  'variavel_na_borda', 'corpo que começa com variável: a Meta recusaria');
select is(public.modelo_whatsapp_criar('{"nome":"Borda fim","corpo":"Oi, {{nome}}."}') ->> 'motivo',
  'variavel_na_borda', 'e o que termina com variável também');
select is(public.modelo_whatsapp_criar(
  '{"nome":"Dois links","corpo":"Oi, {{nome}}, tudo bem?","botoes":[{"tipo":"link","texto":"A"},{"tipo":"link","texto":"B"}]}') ->> 'motivo',
  'botoes_invalidos', 'no máximo um botão de link');
select is(public.modelo_whatsapp_criar(
  '{"nome":"Longo","corpo":"Oi, {{nome}}, tudo bem?","botoes":[{"tipo":"resposta","texto":"Um botão com texto longo demais aqui"}]}') ->> 'motivo',
  'botoes_invalidos', 'botão com mais de 25 letras não passa na Meta');
insert into pg_temp.r values ('novo', public.modelo_whatsapp_criar(
  '{"nome":"Feira de noivas","corpo":"Oi, {{nome}}. A Komune vai estar na feira de noivas de sábado. Quer um convite?","botoes":[{"tipo":"resposta","texto":"Quero ir"},{"tipo":"link","texto":"Ver a feira"}]}'));
select is(pg_temp.v('novo') ->> 'ok', 'true', 'modelo válido é criado');
select ok(pg_temp.v('novo') ->> 'codigo' like 'ENV-FEIRA-DE-NOIVAS-%', 'com código legível');
select pg_temp.sair();

-- =====================================================================
-- 2. Vai para a Meta com os botões
-- =====================================================================
select pg_temp.worker();
insert into pg_temp.r
select 'meta', e from jsonb_array_elements(public.wa_modelos_para_meta()) e
 where e ->> 'codigo' = pg_temp.v('novo') ->> 'codigo';
select pg_temp.sair();
select is(jsonb_array_length(pg_temp.v('meta') -> 'botoes'), 2, 'o pedido de aprovação leva os dois botões');
select ok(pg_temp.v('meta') ->> 'link_base' like 'https://%/r/', 'e a base do link rastreado');

-- =====================================================================
-- 3. Em nome da marca
-- =====================================================================
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is(public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'Com atendente', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo('AEB-ABR-A'),
  'assinatura', 'marca', 'organizacoes', jsonb_build_array(pg_temp.org('01')))) ->> 'motivo',
  'modelo_tem_atendente', 'modelo que diz "aqui é {{atendente}}" não sai em nome da marca');
select is(public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'Ação sem botão', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo('ENV-CONVITE-FUNDADOR'),
  'assinatura', 'marca',
  'variaveis', '{"nome":{"campo":"nome","reserva":"pessoal"},"categoria":{"fixo":"buffet"}}'::jsonb,
  'acoes', '{"Botão que não existe":{"acao":"sair"}}'::jsonb,
  'organizacoes', jsonb_build_array(pg_temp.org('01')))) ->> 'motivo',
  'acoes_invalidas', 'ação para um botão que o modelo não tem é recusada');
insert into pg_temp.r values ('envio', public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'Convite fundadores', 'tipo', 'modelo', 'modelo_id', pg_temp.modelo('ENV-CONVITE-FUNDADOR'),
  'assinatura', 'marca', 'por_hora', 60,
  'link_destino', 'https://admin.komune.app.br/seja-parceiro',
  'variaveis', '{"nome":{"campo":"nome","reserva":"pessoal"},"categoria":{"fixo":"buffet"}}'::jsonb,
  'acoes', jsonb_build_object(
     'Quero o convite', jsonb_build_object('acao', 'link', 'texto', 'Aqui está o seu convite. Leva 5 minutos.', 'botao', 'Criar meu perfil'),
     'Agora não', jsonb_build_object('acao', 'sair')),
  'organizacoes', jsonb_build_array(pg_temp.org('01'), pg_temp.org('02')))));
select is(pg_temp.v('envio') ->> 'ok', 'true', 'o envio da marca nasce');
select pg_temp.sair();

do $$ begin
  perform app.envios_em_massa_rodar();
  update public.envios_em_massa set proximo_em = now() where id = (pg_temp.v('envio') ->> 'id')::uuid;
  perform app.envios_em_massa_rodar();
end $$;
select ok(exists (select 1 from public.messages m
                   where m.id = (pg_temp.item(pg_temp.org('01'))).message_id
                     and m.body like 'Oi, pessoal. Aqui é a Komune%'),
  'a mensagem sai da Komune, sem nome de atendente (e com a reserva "pessoal")');

-- =====================================================================
-- 4. A saída leva os botões e o código
-- =====================================================================
select pg_temp.worker();
select public.wa_saida_enfileirar_pendentes(50);
insert into pg_temp.r
select 'saida', e from jsonb_array_elements(public.wa_saida_proximos(50) -> 'itens') e
 where (e ->> 'message_id')::uuid = (pg_temp.item(pg_temp.org('01'))).message_id;
select pg_temp.sair();
select is(jsonb_array_length(pg_temp.v('saida') -> 'botoes'), 2, 'o worker recebe os botões do modelo');
select is(pg_temp.v('saida') ->> 'link_codigo', (pg_temp.item(pg_temp.org('01'))).codigo,
  'e o código do item, que vira o sufixo do link');

-- =====================================================================
-- 5. O toque no botão
-- =====================================================================
select pg_temp.worker();
select public.wa_entrada_registrar('wamid.e58.1', '+5584999995800', '+5584999995801', 'button', 'Quero o convite');
select pg_temp.sair();
select is((pg_temp.item(pg_temp.org('01'))).botao_tocado, 'quero o convite', 'o toque fica gravado no item');
insert into pg_temp.r
select 'link', to_jsonb(m) from public.messages m
  join public.conversations c on c.id = m.conversation_id
 where c.peer_phone_e164 = '+5584999995801' and m.type = 'interactive' and m.direction = 'out';
select is(pg_temp.v('link') ->> 'body', 'Aqui está o seu convite. Leva 5 minutos.',
  'e o link sai na hora, com o texto do envio — sem "*Gilda:*" na frente');
select is(pg_temp.v('link') #>> '{template_params,url}',
  (select s.value ->> 'base' from public.app_settings s where s.key = 'envios.link')
    || (pg_temp.item(pg_temp.org('01'))).codigo,
  'o botão do link aponta para o endereço rastreado deste item');
select is(pg_temp.v('link') #>> '{template_params,botao}', 'Criar meu perfil', 'com o rótulo escolhido');

select pg_temp.worker();
select public.wa_entrada_registrar('wamid.e58.2', '+5584999995800', '+5584999995801', 'button', 'Quero o convite');
select pg_temp.sair();
select is((select count(*)::int from public.messages m join public.conversations c on c.id = m.conversation_id
            where c.peer_phone_e164 = '+5584999995801' and m.type = 'interactive'), 1,
  'tocar de novo não manda o link de novo');

select pg_temp.worker();
select public.wa_entrada_registrar('wamid.e58.3', '+5584999995800', '+5584999995802', 'button', 'Agora não');
select pg_temp.sair();
select isnt(app.wa_motivo_de_recusa(pg_temp.org('02'), null, '+5584999995802'), null,
  '"Agora não" tira a pessoa da lista: nada mais sai para ela');

-- =====================================================================
-- 6. O clique
-- =====================================================================
select pg_temp.anon();
insert into pg_temp.r values ('clique', to_jsonb(public.envio_clique((pg_temp.item(pg_temp.org('01'))).codigo)));
insert into pg_temp.r values ('estranho', to_jsonb(public.envio_clique('../../evil.com')));
select pg_temp.sair();
select ok(pg_temp.v('clique') #>> '{}' like 'https://admin.komune.app.br/seja-parceiro?utm_source=whatsapp&utm_medium=envio_em_massa&utm_campaign=convite-fundadores&utm_content=%',
  'quem clica vai ao destino do envio, com a campanha na URL');
select isnt((pg_temp.item(pg_temp.org('01'))).clicou_em, null, 'e o clique fica gravado');
select is(pg_temp.v('estranho') #>> '{}', 'https://admin.komune.app.br/seja-parceiro',
  'código estranho não escolhe destino: vai ao padrão');

-- =====================================================================
-- 7. Texto livre da marca sai sem nome
-- =====================================================================
select set_config('app.voz', 'marca', true);
insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
select c.id, 'out', 'text', 'queued', 'Texto da marca.', 'human', pg_temp.gestor(), 'crm'
  from public.conversations c where c.peer_phone_e164 = '+5584999995801';
select set_config('app.voz', '', true);
insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
select c.id, 'out', 'text', 'queued', 'Texto da pessoa.', 'human', pg_temp.gestor(), 'crm'
  from public.conversations c where c.peer_phone_e164 = '+5584999995801';
select ok(exists (select 1 from public.messages where body = 'Texto da marca.'),
  'na voz da marca, o texto sai como foi escrito');
select ok(exists (select 1 from public.messages where body = E'*Gilda:*\nTexto da pessoa.'),
  'fora dela, a regra de sempre: assinado com o primeiro nome');

-- =====================================================================
-- 8. A contagem
-- =====================================================================
update public.organizations set komune_supplier_id = gen_random_uuid() where id = pg_temp.org('01');
insert into pg_temp.r values ('conta', app.envio_contagem((pg_temp.v('envio') ->> 'id')::uuid));
select is((pg_temp.v('conta') ->> 'tocaram')::int, 2, 'dois tocaram num botão');
select is((pg_temp.v('conta') ->> 'clicaram')::int, 1, 'um clicou no link');
select is((pg_temp.v('conta') ->> 'cadastraram')::int, 1, 'e um se cadastrou na Komune depois do envio');

select * from finish();
rollback;

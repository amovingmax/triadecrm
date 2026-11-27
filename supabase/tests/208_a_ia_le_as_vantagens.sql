-- =====================================================================
-- pgTAP — A IA que atende lê as vantagens de mercado aprovadas
-- (migração 20261127151000)
--
-- Prova:
--   1. A GRADE: as três funções novas, security definer e search_path vazio;
--      a leitura da IA só para o worker; a porta da tela para quem tem login;
--   2. A ENTRADA do worker ganha `vantagens_de_mercado` uma vez só, sem perder
--      o e-mail e os convites da agenda;
--   3. SEM VANTAGEM APROVADA, NADA: proposta não vai à IA, nem no treino;
--   4. A PORTEIRA: com mercado.ia_clientes desligada (o padrão), a conversa do
--      treino e a de teste recebem as aprovadas (com o aviso de cada uma) e a
--      do cliente não recebe nada; o aviso que nomeia fonte de anúncio tira a
--      vantagem; com a coleta desligada, ninguém recebe;
--   5. A PORTA DA TELA: SDR não liga; motivo curto não liga; o admin liga, a
--      chave guarda quem, quando e o motivo sem mexer na coleta, o audit_log
--      grava; o cliente passa a receber; pedir o que já vale não grava;
--      desligar volta ao treino só; valor torto é desligado;
--   6. ERRO NA LEITURA: a entrada sai, sem vantagens (a IA nunca fica muda);
--   7. NA KOMUNE (e sem identidade): nada vai à IA e a porta recusa.
--
-- O CI roda as migrações sem identidade e a semente grava 'komune': o teste
-- vira Imova dentro da transação (como o 192). Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if to_regclass('public.mercado_argumentos') is null
     or to_regprocedure('public.ia_entrada_do_atendente(uuid)') is null then
    raise exception 'pgTAP 203 é da Imova: rode num banco com as migrações de mercado e da IA que atende (Imova ou sem identidade)';
  end if;
end $$;

select plan(53);

create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  if p_empresa is not null then
    insert into app.identidade (empresa) values (p_empresa);
  end if;
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;
select pg_temp.virar('imova');

insert into public.allowed_users (email, role, note) values
  ('m203.a@teste.local', 'admin', 'pgTAP 203'),
  ('m203.g@teste.local', 'gestor', 'pgTAP 203'),
  ('m203.s@teste.local', 'sdr', 'pgTAP 203');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000020301'::uuid, 'm203.a@teste.local', '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000020302'::uuid, 'm203.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000020303'::uuid, 'm203.s@teste.local', '{"full_name":"Sara SDR"}');

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
create function pg_temp.admin() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000020301'::uuid, 'admin')
$$;
create function pg_temp.gestor() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000020302'::uuid, 'gestor')
$$;

-- As três conversas: a do treino, uma de teste e a de um cliente.
create temp table t203 (chave text primary key, conv uuid, valor jsonb);
grant select, insert, update on t203 to authenticated;
create function pg_temp.conversa(p_chave text, p_tel text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status,
                                    last_inbound_at)
  values ('whatsapp'::app.channel, '+5584999919700', p_tel, 'Pessoa ' || p_chave,
          'a0000000-0000-4000-8000-000000020302'::uuid, 'aguardando_nos', now())
  returning id into v;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (v, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'O terreno de Capim Macio ainda está à venda?', 'system', 'crm');
  insert into t203 (chave, conv) values (p_chave, v);
  return v;
end $$;
create function pg_temp.c(p_chave text) returns uuid language sql stable as $$
  select conv from t203 where chave = p_chave
$$;
-- O que a IA recebe do mercado, pela porta do worker.
create function pg_temp.vm(p_chave text) returns jsonb language sql as $$
  select public.ia_entrada_do_atendente(pg_temp.c(p_chave)) -> 'vantagens_de_mercado'
$$;

select pg_temp.conversa('treino', '+5584900019701');
select pg_temp.conversa('teste', '+5584900019702');
select pg_temp.conversa('cliente', '+5584900019703');

delete from public.app_settings where key = 'ia.atendente';
insert into public.app_settings (key, value, description)
values ('ia.atendente',
        jsonb_build_object('ligada', true, 'modo', 'clientes',
                           'conversa_de_treino', pg_temp.c('treino'),
                           'conversas_de_teste', jsonb_build_array(pg_temp.c('teste'))),
        'pgTAP 203');

-- A coleta ligada, com chaves da coleta que a porta nova não pode tocar.
update public.app_settings
   set value = '{"ligado": true, "motivo": "Fontes conferidas", "mudou_por": "quem-ligou-a-coleta"}'::jsonb
 where key = 'mercado';

-- Um imóvel da carteira e duas vantagens propostas pelo motor.
update public.anuncios set excluido_em = now() where excluido_em is null;
update public.anuncios_no_canal_pro set excluido_em = now() where excluido_em is null;
insert into public.anuncios (codigo, tipo, negocio, preco_venda, area_total, bairro, cidade, estado, titulo)
values ('TE0197T', 'terreno', 'venda', 5500000, 3000, 'Capim Macio', 'Natal', 'RN', 'Terreno de 3.000 m² em Capim Macio');

create function pg_temp.v(p_chave text, p_regra text, p_eixo text, p_forca text, p_numeros jsonb,
                          p_texto text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
           'chave', p_chave, 'regra', p_regra, 'eixo', p_eixo, 'forca', p_forca, 'molde', p_regra || '-1',
           'anel', 'Capim Macio', 'localidade', 'Capim Macio', 'regiao_id', 'natal-capim-macio', 'sub', 'terreno',
           'texto', p_texto, 'fonte_texto', 'pelos anúncios da região que acompanhamos', 'numeros', p_numeros,
           'prova', jsonb_build_object('anuncios', '[]'::jsonb, 'itens', '[]'::jsonb),
           'fontes', jsonb_build_array('chavesnamao-mcp'), 'data_dado', app.mercado_hoje(),
           'coletado_em', now(), 'valido_ate', app.mercado_hoje() + 10,
           'momentos', jsonb_build_array('apresentacao', 'retomada'), 'objecoes', jsonb_build_array('tamanho'),
           'hash_dados', md5(p_chave || p_numeros::text)) || p_extra
$$;
insert into t203 (chave, valor) values ('proposta', public.mercado_argumentos_propor('TE0197T', jsonb_build_array(
  pg_temp.v('cm-tamanho', 'T1', 'tamanho', 'A', '{"n": 26, "menores": 21}'::jsonb,
            'Dos 26 terrenos à venda em Capim Macio que acompanhamos, 21 eram menores que este.',
            jsonb_build_object('aviso', 'Se ele perguntar quantos andares cabem, diga que vai verificar e passe.')),
  pg_temp.v('cm-renda', 'C2', 'regiao', 'B', '{"renda": 8234}'::jsonb,
            'Pelo Censo 2022, quem chefia a casa em Capim Macio ganha em média R$ 8.234, mais que o dobro da média de Natal.',
            jsonb_build_object('fonte_texto', 'pelo Censo 2022 do IBGE', 'fontes', jsonb_build_array('ibge'),
                               'momentos', '[]'::jsonb, 'objecoes', jsonb_build_array('regiao')))),
  'motor@197'));

-- ---------------------------------------------------------------------
-- 1. A grade
-- ---------------------------------------------------------------------
select ok(to_regprocedure('app.mercado_ia_clientes()') is not null, 'app.mercado_ia_clientes() existe');
select ok(to_regprocedure('app.ia_vantagens_de_mercado(uuid)') is not null, 'app.ia_vantagens_de_mercado(uuid) existe');
select ok(to_regprocedure('public.mercado_ia_clientes_ligar(boolean,text)') is not null,
          'public.mercado_ia_clientes_ligar(boolean, text) existe');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
            where p.oid in ('app.mercado_ia_clientes()'::regprocedure, 'app.ia_vantagens_de_mercado(uuid)'::regprocedure,
                            'public.mercado_ia_clientes_ligar(boolean,text)'::regprocedure)),
          'as três são security definer, com search_path vazio');
select ok(not has_function_privilege('authenticated', 'app.ia_vantagens_de_mercado(uuid)', 'execute')
          and not has_function_privilege('anon', 'app.ia_vantagens_de_mercado(uuid)', 'execute')
          and has_function_privilege('service_role', 'app.ia_vantagens_de_mercado(uuid)', 'execute'),
          'a leitura da IA é só do worker');
select ok(has_function_privilege('authenticated', 'public.mercado_ia_clientes_ligar(boolean,text)', 'execute')
          and not has_function_privilege('anon', 'public.mercado_ia_clientes_ligar(boolean,text)', 'execute'),
          'a porta da tela é de quem tem login (a função confere o papel), nunca do anônimo');

-- ---------------------------------------------------------------------
-- 2. A entrada do worker
-- ---------------------------------------------------------------------
select is((select (length(d) - length(replace(d, 'app.ia_vantagens_de_mercado(c.id)', '')))
                  / length('app.ia_vantagens_de_mercado(c.id)')
             from (select pg_get_functiondef('public.ia_entrada_do_atendente(uuid)'::regprocedure) d) x), 1,
          'a entrada chama a leitura do mercado uma vez só (a migração é idempotente)');
select ok(public.ia_entrada_do_atendente(pg_temp.c('cliente')) ?& array['email', 'convites_da_agenda', 'mensagens', 'treino'],
          'e continua com o e-mail, os convites da agenda, as mensagens e o treino');
select ok(public.ia_entrada_do_atendente(pg_temp.c('cliente')) ? 'vantagens_de_mercado',
          'a chave nova vem sempre, mesmo vazia');

-- ---------------------------------------------------------------------
-- 3. Sem vantagem aprovada, nada
-- ---------------------------------------------------------------------
select is((select (valor ->> 'novos')::int from t203 where chave = 'proposta'), 2, 'o motor propôs duas vantagens');
select is(pg_temp.vm('treino'), '{}'::jsonb, 'proposta não vai à IA, nem no treino');
select is(pg_temp.vm('cliente'), '{}'::jsonb, 'nem ao cliente');

select pg_temp.gestor();
update t203 set valor = public.mercado_argumentos_aprovar_imovel('TE0197T') where chave = 'proposta';
select pg_temp.sair();
select is((select (valor ->> 'aprovadas')::int from t203 where chave = 'proposta'), 2, 'o gestor aprova o imóvel');

-- ---------------------------------------------------------------------
-- 4. A porteira
-- ---------------------------------------------------------------------
select ok(not app.mercado_ia_clientes(), 'a chave ia_clientes nasce desligada (ausente)');
select is(jsonb_array_length(pg_temp.vm('treino') -> 'TE0197T' -> 'diferenciais'), 2,
          'a conversa do treino recebe as duas aprovadas');
select is(pg_temp.vm('treino') -> 'TE0197T' -> 'diferenciais' -> 0 ->> 'id', 'cm-tamanho',
          'na ordem da leitura de mercado (força A primeiro)');
select is(pg_temp.vm('treino') -> 'TE0197T' -> 'diferenciais' -> 0 ->> 'aviso',
          'Se ele perguntar quantos andares cabem, diga que vai verificar e passe.',
          'com o aviso (o que vai junto) da vantagem');
select ok(not (pg_temp.vm('treino') -> 'TE0197T' -> 'diferenciais' -> 1 ? 'aviso'),
          'a vantagem sem aviso vai sem a chave');
select is(pg_temp.vm('treino') -> 'TE0197T' -> 'diferenciais' -> 1 ->> 'fonte', 'pelo Censo 2022 do IBGE',
          'com a fonte para citar de leve');
select ok(not (pg_temp.vm('treino')::text ~* '(prova|https?://|chavesnamao|chaves na m|hash_dados)'),
          'sem prova, sem link, sem nome de fonte de anúncio e sem impressão digital');
select is((select jsonb_set(pg_temp.vm('treino'), '{TE0197T,diferenciais}',
                            (select jsonb_agg(d.item - 'aviso' order by d.ord)
                               from jsonb_array_elements(pg_temp.vm('treino') -> 'TE0197T' -> 'diferenciais')
                                    with ordinality as d(item, ord)))),
          app.mercado_vantagens_para_ia(),
          'é a leitura de mercado aprovada (app.mercado_vantagens_para_ia), só com o aviso a mais');
select is(pg_temp.vm('teste'), pg_temp.vm('treino'), 'a conversa de teste recebe o mesmo que a do treino');
select is(pg_temp.vm('cliente'), '{}'::jsonb, 'a conversa de um cliente não recebe nada com a chave desligada');
select is(public.ia_entrada_do_atendente(pg_temp.c('treino')) ->> 'treino', 'true', 'o treino continua sendo o treino');

-- O aviso que nomeia uma fonte de anúncio (gravado por baixo dos panos) tira a vantagem.
update public.mercado_argumentos set aviso = 'Confira antes no site da Lopes Imóveis.'
 where imovel_codigo = 'TE0197T' and chave = 'cm-tamanho';
select is(pg_temp.vm('treino') -> 'TE0197T' -> 'diferenciais' -> 0 ->> 'id', 'cm-renda',
          'o aviso que nomeia fonte de anúncio tira a vantagem (ela não vai sem o que tem de ir junto)');
update public.mercado_argumentos set aviso = 'Se ele perguntar quantos andares cabem, diga que vai verificar e passe.'
 where imovel_codigo = 'TE0197T' and chave = 'cm-tamanho';

update public.app_settings set value = value || '{"ligado": false}'::jsonb where key = 'mercado';
select is(pg_temp.vm('treino'), '{}'::jsonb, 'com a coleta desligada, nem o treino recebe');
update public.app_settings set value = value || '{"ligado": true}'::jsonb where key = 'mercado';

-- ---------------------------------------------------------------------
-- 5. A porta da tela
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000020303'::uuid, 'sdr');
select throws_ok($$ select public.mercado_ia_clientes_ligar(true, 'O SDR quer ligar') $$, '42501', null,
                 'o SDR não liga as vantagens com os clientes');
select pg_temp.sair();

select pg_temp.gestor();
select is(public.mercado_ia_clientes_ligar(true, 'liga') ->> 'motivo', 'motivo_obrigatorio',
          'motivo com 4 letras é recusado');
select is(public.mercado_ia_clientes_ligar(true, null) ->> 'ok', 'false', 'sem motivo também');
select pg_temp.sair();
select ok(not app.mercado_ia_clientes(), 'e nada foi ligado');

select pg_temp.admin();
update t203 set valor = public.mercado_ia_clientes_ligar(true, '  Treino conferido em 19/11  ') where chave = 'cliente';
select pg_temp.sair();
select is((select valor ->> 'mudou' from t203 where chave = 'cliente'), 'true', 'o admin liga as vantagens com os clientes');
select is((select valor ->> 'ia_clientes_de_fato' from t203 where chave = 'cliente'), 'true', 'e a resposta diz que valem de fato');
select is((select valor ->> 'coleta_ligada' from t203 where chave = 'cliente'), 'true', 'e que a coleta está ligada');
select ok(app.mercado_ia_clientes(), 'app.mercado_ia_clientes() passa a ser true');
select is((select value ->> 'ia_clientes_motivo' from public.app_settings where key = 'mercado'), 'Treino conferido em 19/11',
          'a chave guarda o motivo, sem os espaços das pontas');
select is((select value ->> 'ia_clientes_mudou_por' from public.app_settings where key = 'mercado'),
          'a0000000-0000-4000-8000-000000020301', 'e quem ligou');
select ok((select value ->> 'ligado' = 'true' and value ->> 'motivo' = 'Fontes conferidas'
                  and value ->> 'mudou_por' = 'quem-ligou-a-coleta'
             from public.app_settings where key = 'mercado'),
          'sem mexer nas chaves da coleta (ligado, motivo e quem ligou)');
select ok(exists (select 1 from public.audit_log
                   where table_name = 'app_settings' and row_id = 'mercado' and action = 'UPDATE'
                     and actor_id = 'a0000000-0000-4000-8000-000000020301'::uuid
                     and (old_data ->> 'ia_clientes')::boolean = false and (new_data ->> 'ia_clientes')::boolean
                     and new_data ->> 'ia_clientes_motivo' = 'Treino conferido em 19/11'),
          'o audit_log grava o antes, o depois, quem e o motivo');
select is(jsonb_array_length(pg_temp.vm('cliente') -> 'TE0197T' -> 'diferenciais'), 2,
          'ligada, a conversa do cliente recebe as aprovadas');
select is(pg_temp.vm('cliente'), pg_temp.vm('treino'), 'as mesmas do treino');

select pg_temp.gestor();
select is(public.mercado_ia_clientes_ligar(true, 'De novo, pela outra aba') ->> 'mudou', 'false',
          'pedir o que já vale não grava nada');
select pg_temp.sair();
select is((select value ->> 'ia_clientes_motivo' from public.app_settings where key = 'mercado'), 'Treino conferido em 19/11',
          'e não apaga o motivo de quem ligou');

select pg_temp.gestor();
select is(public.mercado_ia_clientes_ligar(false, 'Voltar ao treino só') ->> 'ia_clientes', 'false', 'o gestor desliga');
select pg_temp.sair();
select is(pg_temp.vm('cliente'), '{}'::jsonb, 'desligada, o cliente volta a não receber');
select is(jsonb_array_length(pg_temp.vm('treino') -> 'TE0197T' -> 'diferenciais'), 2, 'e o treino continua recebendo');

update public.app_settings set value = value || '{"ia_clientes": "sim"}'::jsonb where key = 'mercado';
select ok(not app.mercado_ia_clientes(), 'só o texto "true" liga: valor torto é desligado');
update public.app_settings set value = value || '{"ia_clientes": false}'::jsonb where key = 'mercado';

-- ---------------------------------------------------------------------
-- 6. Erro na leitura: a entrada sai, sem vantagens
-- ---------------------------------------------------------------------
create or replace function app.mercado_vantagens_para_ia() returns jsonb language plpgsql stable as $$
begin
  raise exception 'leitura quebrada de propósito (pgTAP 197)';
end $$;
select lives_ok($$ select public.ia_entrada_do_atendente(pg_temp.c('treino')) $$,
                'a leitura do mercado quebrada não derruba a entrada do worker');
select is(pg_temp.vm('treino'), '{}'::jsonb, 'a IA segue sem vantagens');

-- ---------------------------------------------------------------------
-- 7. Na KOMUNE e sem identidade
-- ---------------------------------------------------------------------
update public.app_settings set value = value || '{"ia_clientes": true}'::jsonb where key = 'mercado';
select pg_temp.virar('komune');
select ok(not app.mercado_ia_clientes(), 'na KOMUNE a chave é sempre desligada, mesmo gravada como true');
select is(app.ia_vantagens_de_mercado(pg_temp.c('treino')), '{}'::jsonb, 'na KOMUNE nada vai à IA, nem no treino');
select pg_temp.admin();
select is(public.mercado_ia_clientes_ligar(false, 'Desligar na KOMUNE') ->> 'motivo', 'so_imova',
          'na KOMUNE a porta recusa');
select pg_temp.sair();
select is((select value ->> 'ia_clientes' from public.app_settings where key = 'mercado'), 'true',
          'e não grava nada');
select pg_temp.virar(null);
select pg_temp.admin();
select is(public.mercado_ia_clientes_ligar(true, 'Banco sem identidade') ->> 'motivo', 'so_imova',
          'num banco sem identidade também');
select pg_temp.sair();

select * from finish();
rollback;

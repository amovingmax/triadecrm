-- =====================================================================
-- pgTAP — A API externa do CRM (migração 20261117200000), nas duas empresas
--
-- Prova: as tabelas não abrem para ninguém; só admin e gestor criam chave, e
-- a chave inteira não fica no banco; a porta recusa chave ausente, errada,
-- revogada, de dono sem acesso, rota inexistente, método errado, escopo que
-- falta e excesso por minuto; o lead acha a ficha pelo telefone ou cria, com
-- negócio na etapa de entrada e origem "api", e não entra se o telefone pediu
-- para sair; id_externo e Idempotency-Key não duplicam nada; listas paginam
-- pelo cursor; PATCH mescla os campos extras; a nota sai em nome da pessoa;
-- mover passa por move_deal; a resposta pela conversa passa pela porteira do
-- envio (opt-out e CPF recusados); os webhooks recebem os eventos, assinados
-- com HMAC; a entrega confere a resposta, reagenda, desiste e pausa no 410;
-- cada chamada é anotada com a rota sem os ids.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(85);

insert into public.allowed_users (email, role, note) values
  ('g180@teste.local', 'gestor', 'pgTAP 180'),
  ('s180@teste.local', 'sdr', 'pgTAP 180'),
  ('a180@teste.local', 'admin', 'pgTAP 180');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000018001'::uuid, 'g180@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000018002'::uuid, 's180@teste.local', '{"full_name":"Sol SDR"}'),
  ('a0000000-0000-4000-8000-000000018003'::uuid, 'a180@teste.local', '{"full_name":"Ada Admin"}');

create function pg_temp.g() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000018001'::uuid $$;
create function pg_temp.s() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000018002'::uuid $$;
create function pg_temp.a() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000018003'::uuid $$;

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
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'reset role';
end $$;

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999918000"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
-- Sem webhooks de antes (o banco local pode ter os de outro teste manual).
delete from app.api_webhooks;

create temp table t180 (chave text primary key, v jsonb);
grant all on t180 to authenticated, service_role;
create function pg_temp.v(p text) returns jsonb language sql stable as $$ select v from t180 where chave = p $$;
create function pg_temp.guardar(p text, x jsonb) returns jsonb language sql as
  $$ insert into t180 values (p, x) on conflict (chave) do update set v = excluded.v returning v $$;
create function pg_temp.resumo(p text) returns text language sql immutable as
  $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;

-- Uma chamada à API como a Edge Function faz (service_role), guardada com nome.
create function pg_temp.api(p_nome text, p_chave text, p_metodo text, p_caminho text,
                            p_consulta jsonb default '{}'::jsonb, p_corpo jsonb default null,
                            p_idem text default null)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := public.api_atender(case when p_chave is null then null else pg_temp.resumo(p_chave) end,
                          p_metodo, p_caminho, p_consulta, p_corpo, p_idem);
  -- Na produção cada chamada é uma transação; aqui o teste inteiro é uma só.
  perform pg_temp.sair();
  return pg_temp.guardar(p_nome, r);
end $$;
create function pg_temp.st(p text) returns int language sql stable as $$ select (pg_temp.v(p) ->> 'status')::int $$;
create function pg_temp.cod(p text) returns text language sql stable as $$ select pg_temp.v(p) #>> '{erro,codigo}' $$;
create function pg_temp.k() returns text language sql stable as $$ select pg_temp.v('chave') ->> 'chave' $$;

-- =====================================================================
-- 1. As tabelas
-- =====================================================================
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'app' and c.relname like 'api\_%' and c.relkind = 'r' and c.relrowsecurity),
          7::bigint, 'as sete tabelas da API nascem com RLS ligada');
select ok(not exists (select 1 from information_schema.role_table_grants
                       where table_schema = 'app' and table_name like 'api\_%'
                         and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'nenhuma tabela da API abre para anon ou authenticated');
select ok(not has_function_privilege('authenticated', 'public.api_atender(text,text,text,jsonb,jsonb,text)', 'execute')
          and has_function_privilege('service_role', 'public.api_atender(text,text,text,jsonb,jsonb,text)', 'execute'),
  'a porta da API é só da service_role');
select ok(not has_function_privilege('authenticated', 'app.api_v1_lead(app.api_chaves,jsonb)', 'execute'),
  'as rotas não são chamáveis direto por quem entrou no CRM');

-- =====================================================================
-- 2. As chaves
-- =====================================================================
select pg_temp.entrar(pg_temp.s(), 'sdr');
select pg_temp.guardar('sdr_cria', public.api_chave_criar('Site', array['fichas:ler']));
select throws_ok($$ select public.api_integracoes() $$, '42501', null, 'o SDR não vê as integrações');
select pg_temp.sair();
select is(pg_temp.v('sdr_cria') ->> 'motivo', 'sem_permissao', 'o SDR não cria chave');

select pg_temp.entrar(pg_temp.g(), 'gestor');
select pg_temp.guardar('chave', public.api_chave_criar('Site da empresa',
  array['fichas:ler', 'fichas:escrever', 'funil:ler', 'funil:escrever', 'conversas:ler',
        'mensagens:enviar', 'webhooks']));
select pg_temp.guardar('so_ler', public.api_chave_criar('Painel', array['fichas:ler']));
select pg_temp.guardar('em_nome_sdr', public.api_chave_criar('Outra', array['fichas:ler'], pg_temp.s()));
select pg_temp.guardar('escopo_ruim', public.api_chave_criar('Outra', array['tudo']));
select pg_temp.guardar('integracoes', public.api_integracoes());
select pg_temp.sair();

select ok((pg_temp.v('chave') ->> 'ok')::boolean
          and pg_temp.k() ~ ('^trd_' || public.empresa_do_banco() || '_[0-9a-f]{48}$'),
  'o gestor cria a chave: trd_<empresa>_ e 48 caracteres');
select ok(not exists (select 1 from app.api_chaves where resumo = pg_temp.k() or prefixo = pg_temp.k()
                         or nome = pg_temp.k()),
  'a chave inteira não fica no banco');
select is((select resumo from app.api_chaves where id = (pg_temp.v('chave') ->> 'id')::uuid),
          pg_temp.resumo(pg_temp.k()), 'o banco guarda o SHA-256 da chave');
select is(pg_temp.v('em_nome_sdr') ->> 'motivo', 'em_nome_de_invalido', 'a chave não age em nome de SDR');
select is(pg_temp.v('escopo_ruim') ->> 'motivo', 'escopos_invalidos', 'escopo que não existe é recusado');
select ok(jsonb_array_length(pg_temp.v('integracoes') -> 'chaves') >= 2
          and position(pg_temp.resumo(pg_temp.k()) in pg_temp.v('integracoes')::text) = 0
          and position(pg_temp.k() in pg_temp.v('integracoes')::text) = 0,
  'a tela de integrações lista as chaves sem a chave e sem o resumo');
select ok(exists (select 1 from public.audit_log where table_name = 'api_chaves'
                    and row_id = pg_temp.v('chave') ->> 'id' and actor_id = pg_temp.g()),
  'a criação da chave vai para a auditoria');

-- =====================================================================
-- 3. A porta
-- =====================================================================
select pg_temp.api('sem', null, 'GET', 'v1');
select pg_temp.api('errada', 'trd_x_' || repeat('0', 48), 'GET', 'v1');
select pg_temp.api('inicio', pg_temp.k(), 'GET', '/v1/');
select pg_temp.api('nada', pg_temp.k(), 'GET', 'v1/nada');
select pg_temp.api('metodo', pg_temp.k(), 'DELETE', 'v1/fichas');
select pg_temp.api('escopo', pg_temp.v('so_ler') ->> 'chave', 'POST', 'v1/leads', '{}', '{"nome": "X", "telefone": "84999918009"}');

select is(pg_temp.cod('sem'), 'chave_ausente', 'sem chave: 401 chave_ausente');
select is(pg_temp.st('errada') || ' ' || pg_temp.cod('errada'), '401 chave_invalida', 'chave que não existe: 401');
select ok(pg_temp.st('inicio') = 200 and (pg_temp.v('inicio') #>> '{dados,em_nome_de,id}')::uuid = pg_temp.g()
          and pg_temp.v('inicio') #>> '{dados,empresa}' = public.empresa_do_banco(),
  'GET /v1 diz a empresa e em nome de quem a chave age');
select is(pg_temp.st('nada') || ' ' || pg_temp.cod('nada'), '404 rota_inexistente', 'rota que não existe: 404');
select is(pg_temp.st('metodo') || ' ' || pg_temp.cod('metodo'), '405 metodo_nao_permitido', 'método errado: 405');
select ok(pg_temp.st('escopo') = 403 and pg_temp.cod('escopo') = 'sem_escopo'
          and pg_temp.v('escopo') #>> '{erro,escopo}' = 'fichas:escrever',
  'chave sem a permissão: 403 com o escopo que falta');
select ok(not exists (select 1 from public.organizations where phone_e164 = '+5584999918009'),
  'a chamada sem permissão não cria nada');

-- =====================================================================
-- 4. O lead
-- =====================================================================
select pg_temp.api('lead_sem_contato', pg_temp.k(), 'POST', 'v1/leads', '{}', '{"nome": "Maria"}');
select pg_temp.api('lead_campo_errado', pg_temp.k(), 'POST', 'v1/leads', '{}', '{"nome": "Maria", "telefoen": "84999918001"}');
select pg_temp.api('lead_tel_ruim', pg_temp.k(), 'POST', 'v1/leads', '{}', '{"nome": "Maria", "telefone": "123"}');
select pg_temp.api('lead', pg_temp.k(), 'POST', 'v1/leads', '{}',
  '{"nome": "Maria API 180", "telefone": "(84) 99991-8001", "email": "MARIA180@teste.local",
    "origem": "Site, formulário de contato", "mensagem": "Quero saber mais", "id_externo": "form-1",
    "campos_extras": {"utm_source": "google"}}');
select pg_temp.guardar('ficha_id', to_jsonb(pg_temp.v('lead') #>> '{dados,ficha,id}'));
create function pg_temp.ficha() returns uuid language sql stable as $$ select (pg_temp.v('ficha_id') #>> '{}')::uuid $$;

select is(pg_temp.cod('lead_sem_contato'), 'contato_obrigatorio', 'lead sem telefone nem e-mail: recusado');
select ok(pg_temp.cod('lead_campo_errado') = 'campo_desconhecido'
          and pg_temp.v('lead_campo_errado') #>> '{erro,campos,0}' = 'telefoen',
  'campo com nome errado: recusado com o nome do campo');
select is(pg_temp.cod('lead_tel_ruim'), 'telefone_invalido', 'telefone que não é do Brasil: recusado');
select ok(pg_temp.st('lead') = 201 and pg_temp.v('lead') #>> '{dados,situacao}' = 'criada',
  'lead novo: 201, ficha criada');
select ok((select o.phone_e164 = '+5584999918001' and o.email::text = 'maria180@teste.local'
                  and o.owner_id is null and s.slug = 'api' and o.custom -> 'externos' = '{"utm_source": "google"}'
             from public.organizations o join public.sources s on s.id = o.source_id where o.id = pg_temp.ficha()),
  'a ficha nasce com o telefone em E.164, o e-mail, sem dono, origem "api" e os campos extras');
select ok((select st.is_entry and d.status::text = 'open'
             from public.deals d join public.stages st on st.id = d.stage_id
            where d.organization_id = pg_temp.ficha()),
  'o negócio nasce aberto, na etapa de entrada');
select ok((select o.kind = case when public.empresa_do_banco() = 'imova' then 'produtor' else 'fornecedor' end::app.org_kind
             from public.organizations o where o.id = pg_temp.ficha()),
  'sem tipo, a ficha nasce Cliente na Imova e fornecedor na KOMUNE');
select is((select count(*) from public.activities a where a.organization_id = pg_temp.ficha()
             and a.metadata ->> 'origin' = 'api' and a.body like 'Lead pela API (Site da empresa): Site, formulário de contato%'),
          1::bigint, 'a nota do lead conta de onde veio e o que a pessoa escreveu');

select pg_temp.api('lead_de_novo', pg_temp.k(), 'POST', 'v1/leads', '{}',
  '{"nome": "Maria API 180", "telefone": "84999918001", "id_externo": "form-1"}');
select pg_temp.api('lead_ligado', pg_temp.k(), 'POST', 'v1/leads', '{}',
  '{"nome": "Maria de novo", "telefone": "+55 84 99991-8001", "id_externo": "form-2"}');
select pg_temp.api('lead_pelo_email', pg_temp.k(), 'POST', 'v1/leads', '{}',
  '{"nome": "Maria pelo e-mail", "email": "maria180@teste.local"}');
select ok(pg_temp.st('lead_de_novo') = 200 and (pg_temp.v('lead_de_novo') #>> '{dados,repetido}')::boolean
          and (pg_temp.v('lead_de_novo') #>> '{dados,ficha,id}')::uuid = pg_temp.ficha(),
  'o mesmo id_externo devolve a mesma ficha, marcado como repetido');
select ok(pg_temp.st('lead_ligado') = 200 and pg_temp.v('lead_ligado') #>> '{dados,situacao}' = 'ligada'
          and (pg_temp.v('lead_ligado') #>> '{dados,ficha,id}')::uuid = pg_temp.ficha(),
  'o mesmo telefone com outro id_externo cai na ficha que já existe');
select ok((pg_temp.v('lead_pelo_email') #>> '{dados,ficha,id}')::uuid = pg_temp.ficha(),
  'sem telefone, o lead acha a ficha pelo e-mail');
select is((select count(*) from public.organizations where phone_e164 = '+5584999918001' and deleted_at is null),
          1::bigint, 'nenhuma ficha duplicada');
select is((select count(*) from public.activities a where a.organization_id = pg_temp.ficha() and a.metadata ->> 'origin' = 'api'),
          3::bigint, 'o repetido não escreve nota; cada lead novo na mesma ficha escreve uma');

select app.suppress('phone', '84999918002', 'pgTAP 180', 'whatsapp'::app.channel, null);
select pg_temp.api('lead_suprimido', pg_temp.k(), 'POST', 'v1/leads', '{}', '{"nome": "Saiu", "telefone": "84999918002"}');
select ok(pg_temp.st('lead_suprimido') = 422 and pg_temp.cod('lead_suprimido') = 'contato_suprimido'
          and not exists (select 1 from public.organizations where phone_e164 = '+5584999918002'),
  'telefone que pediu para sair: 422 e nada entra');

-- Idempotency-Key
select pg_temp.api('idem1', pg_temp.k(), 'POST', 'v1/leads', '{}', '{"nome": "Idem", "telefone": "84999918003"}', 'pedido-1');
select pg_temp.api('idem2', pg_temp.k(), 'POST', 'v1/leads', '{}', '{"nome": "Idem", "telefone": "84999918003"}', 'pedido-1');
select pg_temp.api('idem3', pg_temp.k(), 'POST', 'v1/webhooks', '{}', '{"url": "https://receptor.example/x", "eventos": ["ficha.criada"]}', 'pedido-1');
select ok(pg_temp.st('idem1') = 201 and pg_temp.st('idem2') = 201
          and (pg_temp.v('idem2') ->> 'repetido_pela_idempotencia')::boolean
          and pg_temp.v('idem2') -> 'dados' = pg_temp.v('idem1') -> 'dados',
  'a mesma Idempotency-Key devolve a mesma resposta');
select is((select count(*) from public.activities a join public.organizations o on o.id = a.organization_id
            where o.phone_e164 = '+5584999918003' and a.metadata ->> 'origin' = 'api'),
          1::bigint, 'o pedido repetido pela Idempotency-Key não faz nada de novo');
select is(pg_temp.cod('idem3'), 'idempotencia_reusada', 'a mesma Idempotency-Key em outro pedido é recusada');

-- =====================================================================
-- 5. Fichas: ler, paginar, mudar, nota
-- =====================================================================
select pg_temp.api('lead_b', pg_temp.k(), 'POST', 'v1/leads', '{}', '{"nome": "Zuleica Pagina180 Um", "telefone": "84999918004"}');
select pg_temp.api('lead_c', pg_temp.k(), 'POST', 'v1/leads', '{}', '{"nome": "Zuleica Pagina180 Dois", "telefone": "84999918005"}');
select pg_temp.api('pelo_tel', pg_temp.k(), 'GET', 'v1/fichas', '{"telefone": "84 99991-8001"}');
select pg_temp.api('pag1', pg_temp.k(), 'GET', 'v1/fichas', '{"busca": "zuleica pagina180", "limite": "1"}');
select pg_temp.api('pag2', pg_temp.k(), 'GET', 'v1/fichas',
  jsonb_build_object('busca', 'zuleica pagina180', 'limite', '1', 'cursor', pg_temp.v('pag1') ->> 'proximo'));
select pg_temp.api('limite_ruim', pg_temp.k(), 'GET', 'v1/fichas', '{"limite": "5000"}');
select pg_temp.api('cursor_ruim', pg_temp.k(), 'GET', 'v1/fichas', '{"cursor": "abc"}');
select pg_temp.api('uma', pg_temp.k(), 'GET', 'v1/fichas/' || pg_temp.ficha());
select pg_temp.api('nenhuma', pg_temp.k(), 'GET', 'v1/fichas/' || gen_random_uuid());

select ok(jsonb_array_length(pg_temp.v('pelo_tel') -> 'dados') = 1
          and (pg_temp.v('pelo_tel') #>> '{dados,0,id}')::uuid = pg_temp.ficha(),
  'GET /v1/fichas acha pelo telefone, escrito de qualquer jeito');
select ok(jsonb_array_length(pg_temp.v('pag1') -> 'dados') = 1 and pg_temp.v('pag1') ->> 'proximo' is not null
          and jsonb_array_length(pg_temp.v('pag2') -> 'dados') = 1
          and pg_temp.v('pag2') #>> '{dados,0,id}' <> pg_temp.v('pag1') #>> '{dados,0,id}'
          and pg_temp.v('pag2') -> 'proximo' = 'null'::jsonb,
  'a lista pagina pelo cursor, sem repetir e sem pular');
select is(pg_temp.cod('limite_ruim'), 'parametro_invalido', 'limite fora de 1 a 200: 400');
select is(pg_temp.cod('cursor_ruim'), 'cursor_invalido', 'cursor inventado: 400');
select ok(pg_temp.st('uma') = 200 and pg_temp.v('uma') -> 'dados' ? 'contatos'
          and pg_temp.v('uma') -> 'dados' ? 'conversas'
          and jsonb_array_length(pg_temp.v('uma') #> '{dados,negocios}') = 1,
  'GET /v1/fichas/{id} traz contatos, conversas e negócios');
select is(pg_temp.st('nenhuma') || ' ' || pg_temp.cod('nenhuma'), '404 ficha_inexistente', 'ficha que não existe: 404');

select pg_temp.api('patch', pg_temp.k(), 'PATCH', 'v1/fichas/' || pg_temp.ficha(), '{}',
  '{"nome": "Maria Souza", "bairro": "Ponta Negra", "campos_extras": {"plano": "ouro"}, "responsavel": "s180@teste.local"}');
select pg_temp.api('patch2', pg_temp.k(), 'PATCH', 'v1/fichas/' || pg_temp.ficha(), '{}',
  '{"campos_extras": {"utm_source": null}}');
select pg_temp.api('patch_ruim', pg_temp.k(), 'PATCH', 'v1/fichas/' || pg_temp.ficha(), '{}', '{"telefone": "84999990000"}');
select pg_temp.api('patch_dono_ruim', pg_temp.k(), 'PATCH', 'v1/fichas/' || pg_temp.ficha(), '{}', '{"responsavel": "ninguem@teste.local"}');
select ok(pg_temp.st('patch') = 200 and pg_temp.v('patch') #>> '{dados,nome}' = 'Maria Souza'
          and pg_temp.v('patch') #>> '{dados,bairro}' = 'Ponta Negra'
          and (pg_temp.v('patch') #>> '{dados,responsavel,id}')::uuid = pg_temp.s()
          and pg_temp.v('patch') #> '{dados,campos_extras}' = '{"plano": "ouro", "utm_source": "google"}',
  'PATCH muda o nome, o bairro e o responsável, e mescla os campos extras');
select is(pg_temp.v('patch2') #> '{dados,campos_extras}', '{"plano": "ouro"}'::jsonb,
  'campo extra mandado como null é apagado');
select ok(pg_temp.cod('patch_ruim') = 'campo_desconhecido'
          and (select phone_e164 from public.organizations where id = pg_temp.ficha()) = '+5584999918001',
  'o telefone não muda pela API');
select is(pg_temp.cod('patch_dono_ruim'), 'responsavel_inexistente', 'responsável que não está na equipe: recusado');

select pg_temp.api('nota', pg_temp.k(), 'POST', 'v1/fichas/' || pg_temp.ficha() || '/notas', '{}',
  '{"texto": "Pagou o boleto do sinal."}');
select ok(pg_temp.st('nota') = 201
          and (select a.type::text = 'note' and a.user_id = pg_temp.g() and a.author_kind = 'human'
                 from public.activities a where a.id = (pg_temp.v('nota') #>> '{dados,id}')::uuid),
  'a nota entra na ficha em nome da pessoa da chave');

-- =====================================================================
-- 6. O funil
-- =====================================================================
select pg_temp.api('funis', pg_temp.k(), 'GET', 'v1/funis');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.v('funis') #> '{dados,funis}') f where f ->> 'slug' = 'fornecedor')
          and not exists (select 1 from jsonb_array_elements(pg_temp.v('funis') #> '{dados,funis}') f,
                                        jsonb_array_elements(f -> 'etapas') e
                           join public.stages st on st.id = (e ->> 'id')::int
                          where st.retired_at is not null),
  'GET /v1/funis lista os funis sem as etapas aposentadas');

select pg_temp.guardar('negocio_id', to_jsonb((select d.id from public.deals d where d.organization_id = pg_temp.ficha())::text));
create function pg_temp.negocio() returns uuid language sql stable as $$ select (pg_temp.v('negocio_id') #>> '{}')::uuid $$;
select pg_temp.api('mover', pg_temp.k(), 'POST', 'v1/negocios/' || pg_temp.negocio() || '/mover', '{}',
  '{"etapa": "contatado", "motivo": "Respondeu pelo site"}');
select pg_temp.api('mover_igual', pg_temp.k(), 'POST', 'v1/negocios/' || pg_temp.negocio() || '/mover', '{}', '{"etapa": "contatado"}');
select pg_temp.api('mover_nada', pg_temp.k(), 'POST', 'v1/negocios/' || pg_temp.negocio() || '/mover', '{}', '{"etapa": "nao_existe"}');
select pg_temp.api('mover_perda', pg_temp.k(), 'POST', 'v1/negocios/' || pg_temp.negocio() || '/mover', '{}', '{"etapa": "perdido"}');
select pg_temp.api('negocios', pg_temp.k(), 'GET', 'v1/negocios', jsonb_build_object('ficha', pg_temp.ficha()::text));

select ok(pg_temp.st('mover') = 200 and (pg_temp.v('mover') ->> 'mudou')::boolean
          and pg_temp.v('mover') #>> '{dados,etapa,slug}' = 'contatado',
  'mover leva o negócio para Contatado');
select ok(exists (select 1 from public.deal_stage_history h join public.stages st on st.id = h.to_stage_id
                   where h.deal_id = pg_temp.negocio() and st.slug = 'contatado'
                     and h.changed_by = pg_temp.g() and h.reason = 'Respondeu pelo site'),
  'o histórico do funil registra quem (a pessoa da chave) e o motivo');
select ok(pg_temp.st('mover_igual') = 200 and not (pg_temp.v('mover_igual') ->> 'mudou')::boolean,
  'mover para a etapa em que já está: 200, sem mudar');
select is(pg_temp.cod('mover_nada'), 'etapa_inexistente', 'etapa que não existe no funil: recusada');
select is(pg_temp.cod('mover_perda'), 'motivo_da_perda_obrigatorio', 'perder sem motivo: recusado, como no quadro');
select ok(jsonb_array_length(pg_temp.v('negocios') -> 'dados') = 1
          and (pg_temp.v('negocios') #>> '{dados,0,id}')::uuid = pg_temp.negocio(),
  'GET /v1/negocios filtra pela ficha');

-- =====================================================================
-- 7. Conversas e WhatsApp
-- =====================================================================
create function pg_temp.conversa(p_tel text, p_org uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999918000', p_tel, 'Maria', p_org, pg_temp.g(), 'aguardando_nos')
  returning id into v;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (v, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status, 'Oi, vi no site', 'system', 'crm',
          now() - interval '1 minute');
  return v;
end $$;
select pg_temp.guardar('conv', to_jsonb(pg_temp.conversa('+5584999918001', pg_temp.ficha())::text));
create function pg_temp.conv() returns uuid language sql stable as $$ select (pg_temp.v('conv') #>> '{}')::uuid $$;

select pg_temp.api('cpf', pg_temp.k(), 'POST', 'v1/conversas/' || pg_temp.conv() || '/mensagens', '{}',
  '{"texto": "Seu CPF 529.982.247-25 está ok"}');
select pg_temp.api('resposta', pg_temp.k(), 'POST', 'v1/conversas/' || pg_temp.conv() || '/mensagens', '{}',
  '{"texto": "Oi, Maria! Já te mando as fotos."}');
select pg_temp.api('msgs', pg_temp.k(), 'GET', 'v1/conversas/' || pg_temp.conv() || '/mensagens');
select pg_temp.api('convs', pg_temp.k(), 'GET', 'v1/conversas', jsonb_build_object('ficha', pg_temp.ficha()::text));
select pg_temp.api('modelos', pg_temp.k(), 'GET', 'v1/modelos');

select is(pg_temp.cod('cpf'), 'cpf_nao_sai', 'texto com CPF não sai pela API');
select ok((pg_temp.st('resposta') = 202 and pg_temp.v('resposta') #>> '{dados,situacao}' = 'na_fila'
           and (pg_temp.v('resposta') #>> '{dados,autor,id}')::uuid = pg_temp.g())
          or (pg_temp.st('resposta') = 422 and pg_temp.cod('resposta') = 'envio_recusado'
              and pg_temp.v('resposta') #>> '{erro,motivo}' like 'janela%'),
  'a resposta pela conversa entra na fila em nome da pessoa (ou espera o horário de envio)');
select ok((pg_temp.v('msgs') #>> '{dados,0,direcao}') = case when pg_temp.st('resposta') = 202 then 'enviada' else 'recebida' end
          and exists (select 1 from jsonb_array_elements(pg_temp.v('msgs') -> 'dados') m
                       where m ->> 'direcao' = 'recebida' and m ->> 'texto' = 'Oi, vi no site'
                         and m #>> '{autor,tipo}' = 'contato'),
  'GET /v1/conversas/{id}/mensagens vem da mais nova para a mais velha');
select ok(jsonb_array_length(pg_temp.v('convs') -> 'dados') = 1
          and (pg_temp.v('convs') #>> '{dados,0,janela_aberta}')::boolean,
  'GET /v1/conversas filtra pela ficha e diz que a janela de 24 h está aberta');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.v('modelos') -> 'dados') t
                       where t ->> 'codigo' like 'GEN-SYS-%'
                          or t -> 'variaveis' ? 'atendente'),
  'GET /v1/modelos não lista modelo do sistema nem pede o que o CRM preenche');

select app.suppress('phone', '84999918006', 'pgTAP 180', 'whatsapp'::app.channel, null);
select pg_temp.guardar('conv_saiu', to_jsonb(pg_temp.conversa('+5584999918006', null)::text));
select pg_temp.api('resposta_saiu', pg_temp.k(), 'POST', 'v1/conversas/' || (pg_temp.v('conv_saiu') #>> '{}') || '/mensagens', '{}',
  '{"texto": "Oi de novo"}');
select ok(pg_temp.st('resposta_saiu') = 422 and pg_temp.cod('resposta_saiu') = 'envio_recusado'
          and not exists (select 1 from public.messages m where m.conversation_id = (pg_temp.v('conv_saiu') #>> '{}')::uuid
                            and m.direction = 'out'),
  'para quem pediu para sair, a porteira recusa e nada entra na fila');

-- =====================================================================
-- 8. Os avisos para fora
-- =====================================================================
-- Na produção cada chamada é uma transação e os gatilhos adiados rodam no fim de
-- cada uma; aqui, os de tudo o que veio antes rodam agora, ainda sem webhook.
set constraints all immediate;
set constraints all deferred;
select is((select count(*) from app.api_avisos), 0::bigint, 'sem webhook, nenhum aviso é montado');

select pg_temp.api('wh_http', pg_temp.k(), 'POST', 'v1/webhooks', '{}', '{"url": "http://receptor.example/x", "eventos": ["ficha.criada"]}');
select pg_temp.api('wh_interno', pg_temp.k(), 'POST', 'v1/webhooks', '{}', '{"url": "https://192.168.0.10/x", "eventos": ["ficha.criada"]}');
select pg_temp.api('wh_evento', pg_temp.k(), 'POST', 'v1/webhooks', '{}', '{"url": "https://receptor.example/x", "eventos": ["tudo"]}');
select pg_temp.api('wh', pg_temp.k(), 'POST', 'v1/webhooks', '{}',
  '{"url": "https://receptor.example/crm", "eventos": ["ficha.criada", "mensagem.recebida", "negocio.etapa_mudou", "mensagem.enviada"]}');
create function pg_temp.wh() returns uuid language sql stable as $$ select (pg_temp.v('wh') #>> '{dados,id}')::uuid $$;

select is(pg_temp.cod('wh_http'), 'url_invalida', 'webhook sem https: recusado');
select is(pg_temp.cod('wh_interno'), 'url_interna', 'webhook para a rede interna: recusado');
select is(pg_temp.cod('wh_evento'), 'eventos_invalidos', 'evento que não existe: recusado');
select ok(pg_temp.st('wh') = 201 and pg_temp.v('wh') #>> '{dados,segredo}' ~ '^whsec_[0-9a-f]{48}$'
          and (select s.decrypted_secret from vault.decrypted_secrets s
                 join app.api_webhooks w on w.segredo_id = s.id where w.id = pg_temp.wh()) = pg_temp.v('wh') #>> '{dados,segredo}',
  'o webhook nasce com o segredo mostrado uma vez e guardado no Vault');
select ok(position(pg_temp.v('wh') #>> '{dados,segredo}' in (select string_agg(x::text, ' ') from app.api_webhooks x)) = 0,
  'o segredo não fica na tabela dos webhooks');

-- Os eventos são montados no fim da transação; aqui, na hora.
select pg_temp.api('lead_avisa', pg_temp.k(), 'POST', 'v1/leads', '{}', '{"nome": "Avisa 180", "telefone": "84999918007"}');
set constraints all immediate;
set constraints all deferred;
select ok(exists (select 1 from app.api_avisos a
                   where a.webhook_id = pg_temp.wh() and a.evento = 'ficha.criada' and a.situacao = 'pendente'
                     and a.corpo #>> '{dados,ficha,id}' = pg_temp.v('lead_avisa') #>> '{dados,ficha,id}'
                     and a.corpo #>> '{dados,ficha,negocios,0,etapa,slug}' is not null
                     and a.corpo ->> 'empresa' = public.empresa_do_banco()),
  'a ficha nova vira aviso ficha.criada, já com o negócio');

insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
values (pg_temp.conv(), 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status, 'Pode ser amanhã?', 'system', 'crm');
set constraints all immediate;
set constraints all deferred;
select ok(exists (select 1 from app.api_avisos a
                   where a.evento = 'mensagem.recebida' and a.corpo #>> '{dados,mensagem,texto}' = 'Pode ser amanhã?'
                     and (a.corpo #>> '{dados,ficha,id}')::uuid = pg_temp.ficha()
                     and (a.corpo #>> '{dados,conversa,id}')::uuid = pg_temp.conv()),
  'a mensagem que chega vira aviso mensagem.recebida, com a conversa e a ficha');

-- A mensagem que chega já pode ter levado o negócio a Respondeu (regra do CRM):
-- a API move para uma etapa diferente da atual.
select pg_temp.guardar('etapa_antes', to_jsonb((select st.slug from public.deals d join public.stages st on st.id = d.stage_id
                                                 where d.id = pg_temp.negocio())));
select pg_temp.api('mover_avisa', pg_temp.k(), 'POST', 'v1/negocios/' || pg_temp.negocio() || '/mover', '{}',
  jsonb_build_object('etapa', case when pg_temp.v('etapa_antes') #>> '{}' = 'respondeu' then 'contatado' else 'respondeu' end));
set constraints all immediate;
set constraints all deferred;
select ok(exists (select 1 from app.api_avisos a
                   where a.evento = 'negocio.etapa_mudou'
                     and a.corpo #>> '{dados,de,slug}' = pg_temp.v('etapa_antes') #>> '{}'
                     and a.corpo #>> '{dados,para,slug}' = pg_temp.v('mover_avisa') #>> '{dados,etapa,slug}'
                     and a.corpo #>> '{dados,de,slug}' <> a.corpo #>> '{dados,para,slug}'
                     and (a.corpo #>> '{dados,por,id}')::uuid = pg_temp.g()),
  'a mudança de etapa vira aviso negocio.etapa_mudou, com de, para e quem');

-- A entrega
select pg_temp.guardar('rodada1', app.api_avisos_rodar());
select ok((pg_temp.v('rodada1') ->> 'enviados')::int >= 3
          and not exists (select 1 from app.api_avisos where webhook_id = pg_temp.wh() and situacao = 'pendente'),
  'a rodada manda os avisos pendentes');
select ok((select bool_and(
             q.headers ->> 'X-Triade-Assinatura' =
               't=' || split_part(split_part(q.headers ->> 'X-Triade-Assinatura', ',', 1), '=', 2) || ',v1='
               || encode(extensions.hmac(convert_to(split_part(split_part(q.headers ->> 'X-Triade-Assinatura', ',', 1), '=', 2)
                                                    || '.' || convert_from(q.body, 'UTF8'), 'UTF8'),
                                         convert_to(pg_temp.v('wh') #>> '{dados,segredo}', 'UTF8'), 'sha256'), 'hex')
             and q.headers ->> 'X-Triade-Entrega' = a.id::text
             and q.headers ->> 'X-Triade-Evento' = a.evento
             and q.url = 'https://receptor.example/crm')
             from app.api_avisos a join net.http_request_queue q on q.id = a.pedido_id
            where a.webhook_id = pg_temp.wh()),
  'cada aviso sai com X-Triade-Assinatura = HMAC-SHA256(segredo, "<t>.<corpo exato>")');

create function pg_temp.responder(p_evento text, p_status int) returns void language sql as $$
  insert into net._http_response (id, status_code, content, timed_out, created)
  select a.pedido_id, p_status, '', false, now() from app.api_avisos a
   where a.webhook_id = pg_temp.wh() and a.evento = p_evento and a.situacao = 'enviando'
$$;
select pg_temp.responder('ficha.criada', 200);
select pg_temp.responder('mensagem.recebida', 500);
select app.api_avisos_rodar();
select ok((select a.situacao = 'entregue' and a.ultimo_status = 200 from app.api_avisos a
            where a.webhook_id = pg_temp.wh() and a.evento = 'ficha.criada'),
  'resposta 2xx: entregue');
select ok((select a.situacao = 'pendente' and a.tentativas = 1 and a.ultimo_status = 500
                  and a.proxima_em between now() + interval '50 seconds' and now() + interval '70 seconds'
             from app.api_avisos a where a.webhook_id = pg_temp.wh() and a.evento = 'mensagem.recebida'),
  'resposta 500: volta para a fila, para daqui a 1 minuto');
select is((select falhas_seguidas from app.api_webhooks where id = pg_temp.wh()), 1,
  'a falha conta no webhook');

update app.api_avisos set tentativas = 8 where webhook_id = pg_temp.wh() and evento = 'negocio.etapa_mudou';
select pg_temp.responder('negocio.etapa_mudou', 502);
select app.api_avisos_rodar();
select is((select situacao from app.api_avisos where webhook_id = pg_temp.wh() and evento = 'negocio.etapa_mudou'),
          'falhou', 'depois da 8ª tentativa, desiste');

update app.api_avisos set proxima_em = now() where webhook_id = pg_temp.wh() and evento = 'mensagem.recebida';
select app.api_avisos_rodar();
select pg_temp.responder('mensagem.recebida', 410);
select app.api_avisos_rodar();
select ok((select not w.ativo and w.pausado_motivo = 'destino_respondeu_410' from app.api_webhooks w where w.id = pg_temp.wh())
          and (select situacao from app.api_avisos where webhook_id = pg_temp.wh() and evento = 'mensagem.recebida') = 'falhou',
  'o destino que responde 410 pausa o webhook');

-- O teste e o apagar
select pg_temp.api('wh_teste', pg_temp.k(), 'POST', 'v1/webhooks/' || pg_temp.wh() || '/teste');
select ok(pg_temp.st('wh_teste') = 202
          and exists (select 1 from app.api_avisos where webhook_id = pg_temp.wh() and evento = 'teste'),
  'o teste vai mesmo para o webhook pausado');
select pg_temp.entrar(pg_temp.a(), 'admin');
select pg_temp.guardar('wh_tela', public.api_webhook_criar('https://receptor.example/tela', array['ficha.criada']));
select pg_temp.sair();
select pg_temp.api('apaga_alheio', pg_temp.k(), 'DELETE', 'v1/webhooks/' || (pg_temp.v('wh_tela') ->> 'id'));
select pg_temp.guardar('segredo_id', to_jsonb((select segredo_id from app.api_webhooks where id = pg_temp.wh())::text));
select pg_temp.api('apaga', pg_temp.k(), 'DELETE', 'v1/webhooks/' || pg_temp.wh());
select is(pg_temp.cod('apaga_alheio'), 'webhook_de_outra_origem', 'pela API, a chave não apaga o webhook criado na tela');
select ok(pg_temp.st('apaga') = 200
          and not exists (select 1 from app.api_webhooks where id = pg_temp.wh())
          and not exists (select 1 from vault.secrets where id = (pg_temp.v('segredo_id') #>> '{}')::uuid),
  'a chave apaga o webhook que criou, e o segredo sai do Vault');

-- =====================================================================
-- 9. Limite, revogação, dono sem acesso, anotação
-- =====================================================================
update app.api_chaves set limite_por_minuto = 10 where id = (pg_temp.v('so_ler') ->> 'id')::uuid;
select pg_temp.api('lim' || n, pg_temp.v('so_ler') ->> 'chave', 'GET', 'v1') from generate_series(1, 11) n;
select ok(pg_temp.st('lim10') = 200 and pg_temp.st('lim11') = 429 and pg_temp.cod('lim11') = 'limite_por_minuto'
          and (pg_temp.v('lim11') #>> '{erro,espera_s}')::int between 1 and 60,
  'a 11ª chamada no minuto, com limite de 10: 429 e quanto esperar');

select pg_temp.entrar(pg_temp.g(), 'gestor');
select public.api_chave_revogar((pg_temp.v('so_ler') ->> 'id')::uuid);
select pg_temp.sair();
select pg_temp.api('revogada', pg_temp.v('so_ler') ->> 'chave', 'GET', 'v1');
select is(pg_temp.st('revogada') || ' ' || pg_temp.cod('revogada'), '401 chave_revogada', 'chave revogada: 401');

update public.profiles set role = 'sdr' where id = pg_temp.g();
select pg_temp.api('rebaixado', pg_temp.k(), 'GET', 'v1');
update public.profiles set role = 'gestor' where id = pg_temp.g();
select is(pg_temp.st('rebaixado') || ' ' || pg_temp.cod('rebaixado'), '403 dono_sem_acesso',
  'a pessoa da chave deixou de ser gestor: a chave para na hora');

select ok(exists (select 1 from app.api_chamadas c where c.chave_id = (pg_temp.v('chave') ->> 'id')::uuid
                    and c.rota = 'GET /v1/fichas/{id}' and c.status = 200)
          and not exists (select 1 from app.api_chamadas c
                           where c.rota ~* '[0-9a-f]{8}-[0-9a-f]{4}-'),
  'cada chamada é anotada com a rota, sem os ids');
select ok(exists (select 1 from app.api_chamadas c where c.chave_id = (pg_temp.v('so_ler') ->> 'id')::uuid
                    and c.codigo = 'chave_revogada'),
  'a tentativa com a chave revogada também é anotada');

select * from finish();
rollback;

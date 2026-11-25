-- =====================================================================
-- pgTAP — O aviso de decisão: a IA pergunta aos admins e responde ela mesma
-- (migração 20261125200000, Imova)
--
-- Prova:
--   1. a porta da IA grava a proposta (valor, imóvel pelo código, preço do
--      anúncio) e a pergunta (até 3 sugestões, sem repetir); proposta sem
--      valor vira pergunta; a nova substitui a aberta;
--   2. só admin vê as decisões (função e tabela) e só admin decide;
--   3. consultar: o cliente recebe a mensagem da IA ("já está com o
--      proprietário"), a decisão continua aberta e não consulta duas vezes;
--   4. contraproposta: o texto com os dois valores sai como fala da IA; o
--      primeiro admin vale;
--   5. sugestão: a resposta sugerida sai como está; escrita: vai para a fila
--      da IA e, sem o texto dela, sai o do admin (maiúscula e ponto);
--   6. com a IA fora da conversa, a resposta sai em nome do admin;
--   7. os textos e o aviso "decisao_pedida" para cada admin ativo.
--
-- Só na Imova. Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'pgTAP 207 é da Imova: rode no banco local da Imova';
  end if;
end $$;

select plan(37);

insert into public.allowed_users (email, role, note) values
  ('a207@teste.local', 'admin', 'pgTAP 207'),
  ('b207@teste.local', 'admin', 'pgTAP 207'),
  ('g207@teste.local', 'gestor', 'pgTAP 207');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000020701'::uuid, 'a207@teste.local', '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000020702'::uuid, 'b207@teste.local', '{"full_name":"Beto Admin"}'),
  ('a0000000-0000-4000-8000-000000020703'::uuid, 'g207@teste.local', '{"full_name":"Gil Gestor"}');

create function pg_temp.ana() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020701'::uuid $$;
create function pg_temp.beto() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020702'::uuid $$;
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000020703'::uuid $$;
create function pg_temp.entrar(p_id uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999920700"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
insert into public.app_settings (key, value, description)
values ('ia.atendente', '{"ligada": true, "modo": "clientes"}'::jsonb, 'pgTAP 207')
on conflict (key) do update set value = excluded.value;

create temp table t207(chave text primary key, valor uuid);
grant select on t207 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t207 where chave = p_chave
$$;

-- O terreno de teste em Capim Macio, a R$ 4.500.000.
insert into public.anuncios (codigo, titulo, tipo, bairro, cidade, preco_venda, area_total)
values ('PGT207', 'Terreno em Capim Macio', 'terreno', 'Capim Macio', 'Natal', 4500000, 3000);
insert into t207 select 'anuncio', id from public.anuncios where codigo = 'PGT207';

-- Clientes com ficha, conversa, a mensagem deles e a fala da IA ("vou verificar").
create function pg_temp.cliente(p_chave text, p_nome text, p_tel text, p_texto text) returns void
language plpgsql as $$
declare
  v_org  uuid := gen_random_uuid();
  v_conv uuid;
  v_msg  uuid;
begin
  insert into public.organizations (id, name, phone_e164, source_id, owner_id)
  values (v_org, p_nome, p_tel, (select id from public.sources where slug = 'captura_campo'), pg_temp.ana());
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, organization_id,
                                    assignee_id, status, last_inbound_at)
  values ('whatsapp'::app.channel, '+5584999920700', p_tel, p_nome, v_org, pg_temp.ana(), 'aguardando_nos', now())
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_texto, 'system', 'crm', now() - interval '1 minute')
  returning id into v_msg;
  insert into t207 values ('org_' || p_chave, v_org), ('conversa_' || p_chave, v_conv), ('msg_' || p_chave, v_msg);
end $$;
select pg_temp.cliente('paula', 'Paula Freitas', '+5584988820701', 'Achei caro. O proprietário aceita 4 milhões?');
select pg_temp.cliente('marina', 'Marina Costa', '+5584988820702', 'Vocês ajudam com a documentação do banco?');
select pg_temp.cliente('caio', 'Caio Prado', '+5584988820703', 'Aceita carro na troca?');
select pg_temp.cliente('rita', 'Rita Lopes', '+5584988820704', 'O proprietário aceita 4 milhões e 200?');

create function pg_temp.saidas(p_chave text) returns bigint language sql stable as $$
  select count(*) from public.messages
   where conversation_id = pg_temp.id('conversa_' || p_chave) and direction = 'out'::app.msg_direction
$$;
-- Na mesma transação as mensagens têm o mesmo created_at: confere pelo texto.
create function pg_temp.saiu(p_chave text, p_texto text) returns boolean language sql stable as $$
  select exists (select 1 from public.messages
                  where conversation_id = pg_temp.id('conversa_' || p_chave)
                    and direction = 'out'::app.msg_direction and body = '*Imova:*' || E'\n' || p_texto)
$$;

-- ---------------------------------------------------------------------
-- 1. A porta da IA
-- ---------------------------------------------------------------------
select is(public.ia_atendente_pedir_decisao(pg_temp.id('conversa_paula'), pg_temp.id('msg_paula'), 'proposta',
            'Achei caro. O proprietário aceita 4 milhões?', 'pgt207', 4000000, '[]'::jsonb,
            'Entendi. Vou repassar sua proposta ao diretor e te retorno.', 7, 'atendente-imova@v10') ->> 'ok',
          'true', 'a IA grava a proposta');
select is((select row(tipo, imovel_codigo, anuncio_id, valor_anunciado, valor_proposto, situacao)::text
             from public.ia_decisoes where conversation_id = pg_temp.id('conversa_paula')),
          row('proposta', 'PGT207', pg_temp.id('anuncio'), 4500000::bigint, 4000000::bigint, 'aberta')::text,
          'o imóvel vem pelo código (sem diferença de caixa) e o preço do anúncio fica junto');
select is(public.ia_atendente_pedir_decisao(pg_temp.id('conversa_marina'), pg_temp.id('msg_marina'), 'pergunta',
            '  Vocês ajudam   com a documentação do banco?  ', null, null,
            '[{"rotulo": "Sim", "resposta": "Ajudamos sim."},
              {"rotulo": "Sim de novo", "resposta": "ajudamos sim."},
              {"rotulo": "Correspondente", "resposta": "Trabalhamos com um correspondente."},
              {"rotulo": "", "resposta": "Sem rótulo."},
              {"rotulo": "Não", "resposta": "Nesse caso, não."},
              {"rotulo": "Quarta", "resposta": "Uma quarta resposta."}]'::jsonb,
            'Vou verificar e te retorno.') ->> 'sugestoes',
          '3', 'na pergunta, até 3 sugestões, sem repetir e sem rótulo vazio');
select is((select pergunta from public.ia_decisoes where conversation_id = pg_temp.id('conversa_marina')),
          'Vocês ajudam com a documentação do banco?', 'a pergunta fica sem espaço sobrando');
select is(public.ia_atendente_pedir_decisao(pg_temp.id('conversa_caio'), pg_temp.id('msg_caio'), 'proposta',
            'Aceita carro na troca?', null, null) ->> 'tipo',
          'pergunta', 'proposta sem valor vira pergunta');
select is(public.ia_atendente_pedir_decisao(pg_temp.id('conversa_rita'), pg_temp.id('msg_rita'), 'proposta',
            'O proprietário aceita 4 milhões?', 'PGT207', 4000000) ->> 'ok', 'true', 'a primeira da Rita');
select is(public.ia_atendente_pedir_decisao(pg_temp.id('conversa_rita'), pg_temp.id('msg_rita'), 'proposta',
            'O proprietário aceita 4 milhões e 200?', 'PGT207', 4200000) ->> 'ok', 'true', 'a Rita mudou o valor');
select is((select count(*)::int from public.ia_decisoes
            where conversation_id = pg_temp.id('conversa_rita') and situacao in ('aberta', 'consultando')), 1,
          'uma decisão aberta por conversa: a nova substitui a anterior');
select is(public.ia_atendente_pedir_decisao(gen_random_uuid(), null, 'pergunta', 'Oi?') ->> 'motivo',
          'conversa_nao_existe', 'conversa que não existe é recusada');

insert into t207 select 'd_' || k, d.id
  from (values ('paula'), ('marina'), ('caio'), ('rita')) v (k)
  join public.ia_decisoes d on d.conversation_id = pg_temp.id('conversa_' || v.k)
                           and d.situacao = 'aberta';

-- ---------------------------------------------------------------------
-- 2. Só admin vê e decide
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(jsonb_array_length(public.ia_decisoes_abertas()), 0, 'o gestor não vê as decisões');
select is((select count(*)::int from public.ia_decisoes), 0, 'nem pela tabela');
select is(public.ia_decisao_decidir(pg_temp.id('d_paula'), 'aceitar') ->> 'motivo', 'sem_permissao',
          'o gestor não decide');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.ana(), 'admin');
select is((select count(*)::int from jsonb_array_elements(public.ia_decisoes_abertas()) x
            where (x ->> 'conversa_id')::uuid in (select valor from t207 where chave like 'conversa_%')), 4,
          'o admin vê as quatro abertas');
select is((select x ->> 'imovel' from jsonb_array_elements(public.ia_decisoes_abertas()) x
            where x ->> 'id' = pg_temp.id('d_paula')::text),
          'o terreno em Capim Macio', 'com o imóvel como o cliente reconhece');
select is((select x ->> 'primeiro_nome' from jsonb_array_elements(public.ia_decisoes_abertas()) x
            where x ->> 'id' = pg_temp.id('d_paula')::text), 'Paula', 'e o primeiro nome do cliente');
select is(public.ia_decisao_decidir(pg_temp.id('d_paula'), 'sugestao', null, null, 0) ->> 'motivo',
          'escolha_invalida', 'na proposta não há sugestão');
select is(public.ia_decisao_decidir(pg_temp.id('d_paula'), 'contraproposta') ->> 'motivo',
          'valor_invalido', 'contraproposta sem valor é recusada');

-- ---------------------------------------------------------------------
-- 3. Consultar o proprietário
-- ---------------------------------------------------------------------
select is(public.ia_decisao_decidir(pg_temp.id('d_paula'), 'consultar') ->> 'mensagem_saiu', 'true',
          'consultar: a mensagem sai');
select ok(pg_temp.saiu('paula', 'Paula, sua proposta de R$ 4.000.000 já está com o proprietário. Assim que ele responder, te aviso por aqui.'),
          'como fala da IA, assinada Imova');
select is((select situacao from public.ia_decisoes where id = pg_temp.id('d_paula')), 'consultando',
          'a decisão continua aberta, consultando');
select is(public.ia_decisao_decidir(pg_temp.id('d_paula'), 'consultar') ->> 'motivo', 'ja_consultando',
          'não consulta duas vezes');

-- ---------------------------------------------------------------------
-- 4. A contraproposta; o primeiro admin vale
-- ---------------------------------------------------------------------
select is(public.ia_decisao_decidir(pg_temp.id('d_paula'), 'contraproposta', 4300000) ->> 'como', 'ia',
          'contraproposta: sai como fala da IA');
select ok(pg_temp.saiu('paula', 'Paula, o proprietário não chegou aos R$ 4.000.000, mas aceita R$ 4.300.000 pelo terreno em Capim Macio. Se fizer sentido para você, é só me dizer.'),
          'com os dois valores e o imóvel');
select is((select row(situacao, escolha, valor_decidido, decidido_por)::text
             from public.ia_decisoes where id = pg_temp.id('d_paula')),
          row('respondida', 'contraproposta', 4300000::bigint, pg_temp.ana())::text,
          'fica registrado quem decidiu e o valor');
select pg_temp.sair();
select pg_temp.entrar(pg_temp.beto(), 'admin');
select is(public.ia_decisao_decidir(pg_temp.id('d_paula'), 'aceitar') ->> 'motivo', 'ja_decidido',
          'o segundo admin chega tarde');

-- ---------------------------------------------------------------------
-- 5. Sugestão e escrita
-- ---------------------------------------------------------------------
select is(public.ia_decisao_decidir(pg_temp.id('d_marina'), 'sugestao', null, null, 1) ->> 'ok', 'true',
          'a sugestão escolhida sai');
select ok(pg_temp.saiu('marina', 'Trabalhamos com um correspondente.'), 'como a IA escreveu');
select is(public.ia_decisao_decidir(pg_temp.id('d_caio'), 'escrita', null, '  o proprietário não aceita carro  ') ->> 'ia_escreve',
          'true', 'escrita: a IA vai escrever');
select is(pg_temp.saidas('caio'), 0::bigint, 'nada sai antes da IA');
select pg_temp.sair();
select ok(exists (select 1 from public.ingest_dedup where queue = 'ai_jobs' and idempotency_key = 'responder_decisao:' || pg_temp.id('d_caio')),
          'o trabalho responder_decisao está na fila');
select is(public.ia_decisao_dizer(pg_temp.id('d_caio'), null) ->> 'mensagem', 'O proprietário não aceita carro.',
          'sem o texto da IA, sai o do admin, com maiúscula e ponto');
select is(public.ia_decisao_dizer(pg_temp.id('d_caio'), 'Outra vez.') ->> 'motivo', 'ja_respondida',
          'uma vez só');

-- ---------------------------------------------------------------------
-- 6. Com a IA fora da conversa, em nome do admin
-- ---------------------------------------------------------------------
update public.app_settings set value = '{"ligada": false, "modo": "clientes"}'::jsonb where key = 'ia.atendente';
select pg_temp.entrar(pg_temp.ana(), 'admin');
select is(public.ia_decisao_decidir(pg_temp.id('d_rita'), 'recusar') ->> 'como', 'admin',
          'a IA desligada: a resposta sai em nome de quem decidiu');
select pg_temp.sair();
select is((select row(author_kind, sent_by)::text from public.messages
            where conversation_id = pg_temp.id('conversa_rita') and direction = 'out'::app.msg_direction
            order by created_at desc limit 1),
          row('human', pg_temp.ana())::text, 'como mensagem dela');

-- ---------------------------------------------------------------------
-- 7. Os textos e o aviso no celular
-- ---------------------------------------------------------------------
select is(app.ia_decisao_texto('recusar', null, null, 4000000, null, null),
          'O proprietário não aceitou a proposta de R$ 4.000.000. Se quiser fazer outra proposta, é só me dizer.',
          'recusar sem nome, sem imóvel e sem preço anunciado');
select is((select count(*)::int from public.ia_decisoes
            where situacao = 'aberta' and conversation_id in (select valor from t207 where chave like 'conversa_%')), 0,
          'as quatro foram respondidas (a Paula pela contraproposta)');
-- Uma nova, para o aviso.
select ok(public.ia_atendente_pedir_decisao(pg_temp.id('conversa_marina'), pg_temp.id('msg_marina'), 'pergunta',
            'E o FGTS, pode usar?') ->> 'ok' = 'true'
          and app.avisos_push_varrer_decisoes() >= 2
          and not exists (select 1 from app.push_fila where tipo = 'decisao_pedida' and pessoa_id = pg_temp.gil())
          and exists (select 1 from app.avisos_catalogo() c where c.tipo = 'decisao_pedida'),
          'o aviso "decisao_pedida" vai a cada admin ativo (e não ao gestor), e está no catálogo');

select * from finish();
rollback;

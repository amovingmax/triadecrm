-- =====================================================================
-- pgTAP — A IA aprende com as respostas de vocês
-- (migração 20261127190000, Imova)
--
-- Prova:
--   1. a trava (telefone, arroba, link, código, marcador, tamanho), a letra
--      seguinte e o formato do item "(h) ... (equipe, 26/11).";
--   2. a resposta a uma PERGUNTA põe `sugerir_nota` na fila da IA; a resposta
--      a uma proposta não;
--   3. a porta do worker: lê a decisão e o imóvel, sugere uma vez só, larga o
--      texto com problema e acerta o alcance;
--   4. só a gestão vê e decide as sugeridas; o cartão sabe quem respondeu;
--   5. Guardar: sem ficha, nasce a FICHA seguinte; com ficha, entra como o
--      próximo item; "vale para todos" entra na nota geral; nota cheia ganha
--      continuação; texto editado passa pela trava; uma vez por sugestão;
--   6. Agora não: sai das sugeridas e nada entra no caderno.
--
-- Só na Imova. Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'pgTAP 210 é da Imova: rode no banco local da Imova';
  end if;
end $$;

select plan(50);

insert into public.allowed_users (email, role, note) values
  ('a210@teste.local', 'admin', 'pgTAP 210'),
  ('g210@teste.local', 'gestor', 'pgTAP 210'),
  ('e210@teste.local', 'embaixador', 'pgTAP 210');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000021001'::uuid, 'a210@teste.local', '{"full_name":"Ana Admin"}'),
  ('a0000000-0000-4000-8000-000000021002'::uuid, 'g210@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000021003'::uuid, 'e210@teste.local', '{"full_name":"Eva Embaixadora"}');

create function pg_temp.ana() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000021001'::uuid $$;
create function pg_temp.gil() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000021002'::uuid $$;
create function pg_temp.eva() returns uuid language sql immutable as $$ select 'a0000000-0000-4000-8000-000000021003'::uuid $$;
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

create temp table t210(chave text primary key, valor uuid);
grant select on t210 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t210 where chave = p_chave
$$;

-- A sala do Brisa Mall (sem ficha) e o terreno de Camurupim (com ficha).
insert into public.anuncios (codigo, titulo, tipo, negocio, bairro, cidade, preco_aluguel, area_util)
values ('PGT210S', 'Sala comercial no Brisa Mall', 'sala_comercial', 'aluguel', 'Ponta Negra', 'Natal', 1500, 19);
insert into public.anuncios (codigo, titulo, tipo, bairro, cidade, preco_venda, area_total)
values ('PGT210T', 'Terreno frente-mar em Camurupim', 'terreno', 'Camurupim', 'Nísia Floresta', 520000, 810);
insert into t210 select 'sala', id from public.anuncios where codigo = 'PGT210S';
insert into t210 select 'terreno', id from public.anuncios where codigo = 'PGT210T';

-- A ficha do terreno e a nota geral, como no caderno de produção.
-- (As fichas e a nota geral que o banco já tenha saem de cena: o teste é dono destas.)
update public.ia_caderno set ativo = false where papel is not null or texto like '8. A IMOVA E A DOCUMENTAÇÃO%';
insert into public.ia_caderno (texto, origem, papel, anuncio_ids)
values ('FICHA 905. TERRENO FRENTE-MAR EM CAMURUPIM, NÍSIA FLORESTA: É o terreno de 810 m². (a) O valor de venda é R$ 520.000 (equipe, 23/11). (b) Fica de frente para o mar.',
        'tela', 'ficha', array[pg_temp.id('terreno')]);
insert into public.ia_caderno (texto, origem, papel)
values ('8. A IMOVA E A DOCUMENTAÇÃO: Fatos sobre a Imova. (a) A Imova é uma imobiliária de Natal/RN. (b) Atende de segunda a sexta.',
        'tela', 'geral');

-- Uma conversa por decisão.
create function pg_temp.conversa(p_chave text, p_tel text) returns void language plpgsql as $$
declare
  v_org  uuid := gen_random_uuid();
  v_conv uuid;
begin
  insert into public.organizations (id, name, phone_e164, source_id, owner_id)
  values (v_org, 'Cliente ' || p_chave, p_tel, (select id from public.sources where slug = 'captura_campo'), pg_temp.ana());
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, organization_id,
                                    assignee_id, status, last_inbound_at)
  values ('whatsapp'::app.channel, '+5584999921000', p_tel, 'Cliente ' || p_chave, v_org, pg_temp.ana(),
          'aguardando_nos', now())
  returning id into v_conv;
  insert into t210 values ('conversa_' || p_chave, v_conv);
end $$;
select pg_temp.conversa('energia', '+5584988821001');
select pg_temp.conversa('fgts', '+5584988821002');
select pg_temp.conversa('proposta', '+5584988821003');
select pg_temp.conversa('geral', '+5584988821004');
select pg_temp.conversa('semimovel', '+5584988821005');
select pg_temp.conversa('cheia', '+5584988821006');
select pg_temp.conversa('agora', '+5584988821007');

-- Uma decisão aberta, como a IA deixa.
create function pg_temp.decisao(p_chave text, p_tipo text, p_anuncio uuid, p_pergunta text) returns void
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.ia_decisoes (conversation_id, tipo, anuncio_id, pergunta, resposta_da_ia, valor_proposto)
  values (pg_temp.id('conversa_' || p_chave), p_tipo, p_anuncio, p_pergunta, 'Vou verificar e te retorno.',
          case when p_tipo = 'proposta' then 450000 end)
  returning id into v_id;
  insert into t210 values ('decisao_' || p_chave, v_id);
end $$;
-- A resposta do admin (o que ia_decisao_decidir grava).
create function pg_temp.responder(p_chave text, p_texto text) returns void language sql as $$
  update public.ia_decisoes
     set situacao = 'respondida', escolha = case when tipo = 'proposta' then 'contraproposta' else 'sugestao' end,
         texto_decidido = p_texto, valor_decidido = case when tipo = 'proposta' then 420000 end,
         decidido_por = pg_temp.ana(), decidido_em = '2026-11-26 13:24:00-03'
   where id = pg_temp.id('decisao_' || p_chave)
$$;
create function pg_temp.na_fila(p_chave text) returns bigint language sql stable as $$
  select count(*) from public.ingest_dedup
   where queue = 'ai_jobs' and idempotency_key = 'sugerir_nota:' || pg_temp.id('decisao_' || p_chave)
$$;
create function pg_temp.sugestao(p_chave text) returns uuid language sql stable as $$
  select s.id from public.ia_notas_sugeridas s where s.decisao_id = pg_temp.id('decisao_' || p_chave)
$$;

-- ---------------------------------------------------------------------
-- 1. As peças
-- ---------------------------------------------------------------------
select is(app.ia_nota_problema('Tem energia individualizada: o consumo é medido e pago à parte do condomínio.'),
          null, 'a nota da energia passa pela trava');
select is(app.ia_nota_problema('O valor é R$ 520.000 (equipe, 23/11). Medidas: 12 m por 68 m.'),
          null, 'valor, data e medidas com letra no meio passam');
select is(app.ia_nota_problema('A área é 1.338,99, 2.021 m² no total.'), 'telefone',
          'o "1.338,99, 2.021" que travou a IA em 19/11 é barrado');
select is(app.ia_nota_problema('Para visitar, ligue 84 98820-9001.'), 'telefone', 'telefone é barrado');
select is(app.ia_nota_problema('Mande os documentos para contato@imova.com.br.'), 'arroba', 'e-mail é barrado');
select is(app.ia_nota_problema('É o terreno TE0004, de frente para o mar.'), 'codigo', 'código de anúncio é barrado');
select is(app.ia_nota_problema('O [[NOME_1]] disse que aceita FGTS.'), 'marcador', 'marcador de nome é barrado');
select is(app.ia_nota_problema('Sim.'), 'curta', 'nota curta demais é barrada');
select is(app.ia_nota_problema(repeat('a ', 160)), 'longa', 'nota com mais de 300 letras é barrada');
select is(app.ia_nota_problema('Veja em https://imova.com.br/terreno o mapa.'), 'link', 'link é barrado');

select is(app.ia_nota_proxima_letra('FICHA 5. X: (a) um. (b) dois. (g) sete; confirmado, diga o valor de (a).'), 'h',
          'depois de (g) vem (h), mesmo com (a) citado no fim');
select is(app.ia_nota_proxima_letra('FICHA 7. LOJA: Esta loja não está mais disponível.'), 'a', 'sem itens, (a)');
select is(app.ia_nota_proxima_letra('X: (a) um. (z) último.'), null, 'depois de (z), sem letra');
select is(app.ia_nota_item('h', '  FGTS: não dá para usar o FGTS na compra deste terreno. ', '2026-11-26 13:24:00-03'),
          '(h) FGTS: não dá para usar o FGTS na compra deste terreno (equipe, 26/11).',
          'o item: letra, o texto sem o ponto final e "(equipe, dia/mês)."');

-- ---------------------------------------------------------------------
-- 2. A fila
-- ---------------------------------------------------------------------
select pg_temp.decisao('energia', 'pergunta', pg_temp.id('sala'), 'energia individualizada?');
select pg_temp.decisao('fgts', 'pergunta', pg_temp.id('terreno'), 'Aceita FGTS?');
select pg_temp.decisao('proposta', 'proposta', pg_temp.id('terreno'), 'O proprietário aceita 450 mil?');
select pg_temp.decisao('geral', 'pergunta', pg_temp.id('terreno'), 'Vocês ajudam com a documentação do banco?');
select pg_temp.decisao('semimovel', 'pergunta', null, 'Vocês trabalham com aluguel?');
select pg_temp.decisao('cheia', 'pergunta', pg_temp.id('terreno'), 'Tem poço?');
select pg_temp.decisao('agora', 'pergunta', pg_temp.id('sala'), 'Posso visitar amanhã?');

select pg_temp.responder('energia', 'Sim, a sala tem energia individualizada, ou seja, o consumo é medido e pago separadamente, à parte do condomínio.');
select pg_temp.responder('fgts', 'Para terreno, não conseguimos utilizar o FGTS na compra.');
select pg_temp.responder('proposta', null);
select pg_temp.responder('geral', 'Ajudamos sim, com toda a parte do banco.');
select pg_temp.responder('semimovel', 'Sim, trabalhamos com venda e aluguel.');
select pg_temp.responder('cheia', 'Tem poço artesiano.');
select pg_temp.responder('agora', 'Pode sim, amanhã às 10h.');

select is(pg_temp.na_fila('energia'), 1::bigint, 'a resposta a uma pergunta vai para a fila da IA (sugerir_nota)');
select is(pg_temp.na_fila('proposta'), 0::bigint, 'a resposta a uma proposta de preço não vira nota');

-- ---------------------------------------------------------------------
-- 3. A porta do worker
-- ---------------------------------------------------------------------
select is(public.ia_nota_entrada(pg_temp.id('decisao_energia')) ->> 'resposta',
          'Sim, a sala tem energia individualizada, ou seja, o consumo é medido e pago separadamente, à parte do condomínio.',
          'a entrada traz a resposta do admin');
select is((public.ia_nota_entrada(pg_temp.id('decisao_energia')) ->> 'tem_ficha')::boolean, false,
          'a sala ainda não tem ficha');
select is((public.ia_nota_entrada(pg_temp.id('decisao_fgts')) ->> 'tem_ficha')::boolean, true,
          'o terreno tem ficha (anuncio_ids)');

select is(public.ia_nota_sugerir(pg_temp.id('decisao_energia'),
            'Tem energia individualizada: o consumo é medido e pago à parte do condomínio.', null, 'imovel',
            'Sala de 19 m² no Brisa Mall, Ponta Negra, Natal', 77, 'nota-da-resposta@v1') ->> 'ok',
          'true', 'a sugestão da energia entra');
select is(public.ia_nota_sugerir(pg_temp.id('decisao_energia'), 'Outro texto qualquer da energia.', null, 'imovel') ->> 'motivo',
          'ja_sugerida', 'uma sugestão por decisão');
select is(public.ia_nota_sugerir(pg_temp.id('decisao_proposta'), 'Aceita 420 mil pelo terreno.', null, 'imovel') ->> 'motivo',
          'nao_e_pergunta_respondida', 'proposta não vira sugestão');
select is(public.ia_nota_sugerir(pg_temp.id('decisao_cheia'), 'Ligue 84 98820-9001 para saber.', null, 'imovel') ->> 'motivo',
          'sem_texto_valido', 'texto com telefone não é sugerido');
select is(public.ia_nota_sugerir(pg_temp.id('decisao_fgts'),
            'FGTS: não dá para usar o FGTS na compra deste terreno.',
            'FGTS: não dá para usar o FGTS na compra de terreno.', 'geral', null) ->> 'escopo',
          'geral', 'o FGTS fica sugerido para todos os terrenos');
select is(public.ia_nota_sugerir(pg_temp.id('decisao_semimovel'),
            'Trabalha com venda e aluguel.', 'A Imova trabalha com venda e aluguel de imóveis.', 'imovel') ->> 'escopo',
          'geral', 'sem imóvel na decisão, o alcance é todos');
select public.ia_nota_sugerir(pg_temp.id('decisao_geral'), null,
         'Ajuda com toda a parte do banco no financiamento.', 'geral');
select public.ia_nota_sugerir(pg_temp.id('decisao_cheia'), 'Tem poço artesiano.', null, 'imovel');
select public.ia_nota_sugerir(pg_temp.id('decisao_agora'), 'A sala pode ser visitada com hora marcada.', null, 'imovel');
select is((select titulo_da_ficha from public.ia_notas_sugeridas where id = pg_temp.sugestao('energia')),
          'SALA DE 19 M² NO BRISA MALL, PONTA NEGRA, NATAL', 'o nome da ficha nova fica em maiúsculas');

-- ---------------------------------------------------------------------
-- 4. Quem vê
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.eva(), 'embaixador');
select is(public.ia_notas_sugeridas_abertas(), '[]'::jsonb, 'quem não é da gestão não vê as sugeridas');
select is((select count(*) from public.ia_notas_sugeridas), 0::bigint, 'nem pela tabela');
select is(public.ia_nota_guardar(pg_temp.id('x'), 'imovel', null) ->> 'motivo', 'sem_permissao',
          'nem guarda');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.ana(), 'admin');
select is((select (x ->> 'respondida_por_mim')::boolean from jsonb_array_elements(public.ia_notas_sugeridas_abertas()) x
            where x ->> 'id' = pg_temp.sugestao('energia')::text),
          true, 'o admin que respondeu vê que foi ele (o cartão aparece para ele)');
select is((select x ->> 'onde_imovel' from jsonb_array_elements(public.ia_notas_sugeridas_abertas()) x
            where x ->> 'id' = pg_temp.sugestao('fgts')::text),
          'FICHA 905. TERRENO FRENTE-MAR EM CAMURUPIM, NÍSIA FLORESTA', 'o cartão diz em que ficha entra');
select is((select (x ->> 'ficha_nova')::boolean from jsonb_array_elements(public.ia_notas_sugeridas_abertas()) x
            where x ->> 'id' = pg_temp.sugestao('energia')::text),
          true, 'e quando nasce uma ficha nova');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 5. Guardar
-- ---------------------------------------------------------------------
select pg_temp.entrar(pg_temp.gil(), 'gestor');

-- A sala não tem ficha: nasce a seguinte (905 + 1).
select is(public.ia_nota_guardar(pg_temp.sugestao('energia'), 'imovel', null) ->> 'onde',
          'FICHA 906. SALA DE 19 M² NO BRISA MALL, PONTA NEGRA, NATAL', 'a sala ganha a FICHA seguinte');
select is((select texto from public.ia_caderno
            where id = (select caderno_id from public.ia_notas_sugeridas where id = pg_temp.sugestao('energia'))),
          'FICHA 906. SALA DE 19 M² NO BRISA MALL, PONTA NEGRA, NATAL: (a) Tem energia individualizada: o consumo é medido e pago à parte do condomínio (equipe, 26/11).',
          'com a resposta como item (a)');
select is((select row(origem, papel, anuncio_ids = array[pg_temp.id('sala')], criado_por = pg_temp.gil())::text
             from public.ia_caderno
            where id = (select caderno_id from public.ia_notas_sugeridas where id = pg_temp.sugestao('energia'))),
          row('resposta', 'ficha', true, true)::text, 'a ficha nova é da sala, aprendida de uma resposta, por quem guardou');
select is(public.ia_nota_guardar(pg_temp.sugestao('energia'), 'imovel', null) ->> 'motivo', 'ja_decidida',
          'a mesma sugestão não é guardada duas vezes');

-- O FGTS, editado, só para este terreno: entra na ficha como (c).
select is(public.ia_nota_guardar(pg_temp.sugestao('fgts'), 'imovel', 'Ligue 84 98820-9001 para o FGTS.') ->> 'motivo',
          'texto_telefone', 'o texto editado passa pela trava');
select is((public.ia_nota_guardar(pg_temp.sugestao('fgts'), 'imovel',
             'FGTS: não dá para usar o FGTS na compra deste terreno.') ->> 'nova')::boolean,
          false, 'com ficha, a resposta entra nela');
select ok((select texto from public.ia_caderno where texto like 'FICHA 905.%' and ativo)
            like '% (b) Fica de frente para o mar. (c) FGTS: não dá para usar o FGTS na compra deste terreno (equipe, 26/11).',
          'como o próximo item (c), com a data da resposta');

-- "Vale para todos": entra na nota geral como (c).
select is(public.ia_nota_guardar(pg_temp.sugestao('geral'), 'geral', null) ->> 'onde',
          '8. A IMOVA E A DOCUMENTAÇÃO', 'vale para todos: entra na nota geral');
select ok((select texto from public.ia_caderno where texto like '8. A IMOVA E A DOCUMENTAÇÃO%' and ativo)
            like '% (b) Atende de segunda a sexta. (c) Ajuda com toda a parte do banco no financiamento (equipe, 26/11).',
          'como o próximo item da nota geral');
select is(public.ia_nota_guardar(pg_temp.sugestao('semimovel'), 'imovel', null) ->> 'motivo',
          'sem_imovel', 'sem imóvel na decisão, "este imóvel" não existe');
select ok((public.ia_nota_guardar(pg_temp.sugestao('semimovel'), 'geral', null) ->> 'texto')
            = 'A Imova trabalha com venda e aluguel de imóveis.',
          'mas "vale para todos" sim');
select pg_temp.sair();

-- A ficha cheia: a resposta abre uma continuação, que vira o endereço do imóvel.
update public.ia_caderno
   set texto = left(texto || ' ' || repeat('Detalhe do terreno. ', 100), 1990)
 where texto like 'FICHA 905.%' and ativo;
select pg_temp.entrar(pg_temp.gil(), 'gestor');
select is(public.ia_nota_guardar(pg_temp.sugestao('cheia'), 'imovel', null) ->> 'onde',
          'FICHA 905. TERRENO FRENTE-MAR EM CAMURUPIM, NÍSIA FLORESTA, CONTINUAÇÃO',
          'a ficha cheia ganha uma continuação');
select is((select row(texto, papel, anuncio_ids = array[pg_temp.id('terreno')])::text from public.ia_caderno
            where id = (select caderno_id from public.ia_notas_sugeridas where id = pg_temp.sugestao('cheia'))),
          row('FICHA 905. TERRENO FRENTE-MAR EM CAMURUPIM, NÍSIA FLORESTA, CONTINUAÇÃO: (a) Tem poço artesiano (equipe, 26/11).',
              'ficha', true)::text,
          'a continuação é do mesmo imóvel');
select pg_temp.sair();
select is(app.ia_nota_alvo('imovel', pg_temp.id('terreno')),
          (select caderno_id from public.ia_notas_sugeridas where id = pg_temp.sugestao('cheia')),
          'a próxima resposta do terreno vai para a continuação');
select pg_temp.entrar(pg_temp.gil(), 'gestor');

-- ---------------------------------------------------------------------
-- 6. Agora não
-- ---------------------------------------------------------------------
select is(public.ia_nota_descartar(pg_temp.sugestao('agora')) ->> 'ok', 'true', 'Agora não tira a sugestão');
select is(public.ia_nota_guardar(pg_temp.sugestao('agora'), 'imovel', null) ->> 'motivo', 'ja_decidida',
          'e ela não é mais guardada');
select is((select count(*) from public.ia_caderno where texto like '%visitada com hora marcada%'), 0::bigint,
          'nada entrou no caderno');
select is(jsonb_array_length(public.ia_notas_sugeridas_abertas()), 0,
          'sem sugeridas abertas depois de tudo decidido');
select pg_temp.sair();

select * from finish();
rollback;

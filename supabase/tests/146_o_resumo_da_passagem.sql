-- =====================================================================
-- pgTAP — O resumo da passagem (migração 20261125190000)
--
-- Pedido do usuário em 11/11/2026: quando a IA que atende passa a conversa
-- para a equipe, deixar um resumo para o corretor não precisar ler a conversa
-- inteira. Com as correções da revisão do mesmo dia. Este arquivo prova:
--
--   1. A TABELA nasce com RLS, auditoria e o gatilho em ia_respostas;
--   2. O PEDIDO: a passagem (pela regra, e também quando a porteira recusa o
--      aviso) abre a linha `pedido` e põe `resumir_passagem` na fila uma vez;
--      responder não pede; com o teto por hora, a passagem ganha a linha que
--      não tinha; desligado, a linha nasce `falhou`/`desligado`;
--   3. A ENTRADA do worker é a conversa ATÉ a passagem, com o motivo e os
--      imóveis da Imova citados;
--   4. GRAVAR confere o CONTEÚDO da prova: o trecho literal na mensagem do
--      cliente, os números e uma palavra do valor no trecho, comprar, alugar
--      e o pagamento escritos; o código do imóvel é palavra inteira, da Imova,
--      e, ofertado pela IA, só entra se o cliente falou dele depois. O caso do
--      rascunho da revisão ("Quero falar com um corretor" provando "Ponta
--      Negra · até R$ 900 mil") está aqui;
--   5. O AVISO: a tarefa ganha o resumo em uma linha; no treino, nunca;
--   6. FALHOU registra o porquê sem apagar resumo pronto;
--   7. O DESTAQUE só é da passagem cuja parada é dela: uma conversa de teste
--      desmarcada, e "Ligar a IA aqui" seguido de "Parar a IA", não o trazem;
--   8. A SITUAÇÃO vem da linha: escrevendo, não chegou, antes, falhou;
--      reenfileirar põe de novo, com chave nova, o pedido que não andou;
--   9. QUEM VÊ e QUEM ESCREVE.
--
-- Roda em transação e desfaz tudo. Dentro de uma transação o relógio não
-- anda: mensagem "depois" da passagem é a de `now()` para frente.
-- =====================================================================
begin;
select plan(94);

insert into public.allowed_users (email, role, note) values
  ('h146.g@teste.local', 'gestor', 'pgTAP 146'),
  ('h146.s@teste.local', 'sdr', 'pgTAP 146'),
  ('h146.l@teste.local', 'leitura', 'pgTAP 146');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000014601'::uuid, 'h146.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000014602'::uuid, 'h146.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000014603'::uuid, 'h146.l@teste.local', '{"full_name":"Leo Leitura"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999914600"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
delete from public.app_settings where key in ('ia.atendente', 'ia.resumo_da_passagem');
-- A IA ligada com clientes; sem setor de corretores, a conversa fica com quem atende.
insert into public.app_settings (key, value, description)
values ('ia.atendente', '{"ligada": true, "modo": "clientes"}'::jsonb, 'pgTAP 146');

-- Dois imóveis da Imova (os anúncios feitos à mão no Canal Pro entram em app.ia_atendente_imoveis).
insert into public.anuncios_no_canal_pro (codigo, situacao, titulo, tipo, bairro, no_relatorio) values
  ('AP0031_IMOVA', 'Ativo', 'Apartamento com varanda', 'Apartamento', 'Ponta Negra', true),
  ('CA0102_IMOVA', 'Ativo', 'Casa de 2 quartos', 'Casa', 'Nova Parnamirim', true);

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

create temp table t146(chave text primary key, valor uuid);
grant all on t146 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t146 where chave = p_chave
$$;
create function pg_temp.conversa(p_chave text, p_tel text, p_nome text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999914600', p_tel, p_nome,
          'a0000000-0000-4000-8000-000000014601'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t146 values (p_chave, v);
  return v;
end $$;
-- Mensagem do cliente, `p_seg` segundos atrás (negativo = depois de agora).
create function pg_temp.dele(p_chave text, p_conv uuid, p_seg int, p_texto text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_texto, 'system', 'crm', now() - make_interval(secs => p_seg))
  returning id into v;
  insert into t146 values (p_chave, v);
  return v;
end $$;
-- Mensagem de gente do time, `p_seg` segundos depois de agora (negativo = antes).
create function pg_temp.da_equipe(p_chave text, p_conv uuid, p_seg int, p_texto text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          p_texto, 'human', 'echo', 'a0000000-0000-4000-8000-000000014601'::uuid,
          'wamid.PGTAP146.' || gen_random_uuid(), now() + make_interval(secs => p_seg),
          now() + make_interval(secs => p_seg))
  returning id into v;
  insert into t146 values (p_chave, v);
  return v;
end $$;
-- A linha da passagem posta direto (o que a função faria), para montar conversas
-- com mensagem de fora antes dela sem a IA estar atendendo.
create function pg_temp.passagem_direta(p_conv uuid, p_motivo text) returns uuid language sql as $$
  insert into public.ia_respostas (conversation_id, corpo, acao, detalhes)
  values (p_conv, '—', 'nao_respondeu', jsonb_build_object('quis', 'passou_para_pessoa', 'motivo', p_motivo))
  returning id
$$;
-- A linha da passagem (a mais nova) de uma conversa.
create function pg_temp.passagem(p_conv uuid) returns uuid language sql stable as $$
  select r.id from public.ia_respostas r
   where r.conversation_id = p_conv
     and (r.acao = 'passou_para_pessoa' or r.detalhes ->> 'quis' = 'passou_para_pessoa')
   order by r.criada_em desc, r.id limit 1
$$;
-- Quantos pedidos de resumo há na fila para uma linha de ia_respostas.
create function pg_temp.pedidos(p_resposta uuid) returns int language sql stable as $$
  select count(*)::int from pgmq.q_ai_jobs q
   where q.message ->> 'purpose' = 'resumir_passagem' and q.message ->> 'resposta_id' = p_resposta::text
$$;
create function pg_temp.resumo(p_conv uuid) returns public.ia_resumos_da_passagem language sql stable as $$
  select s.* from public.ia_resumos_da_passagem s where s.resposta_id = pg_temp.passagem(p_conv)
$$;
-- Um campo dito: {valor, trecho, prova}.
create function pg_temp.dito(p_valor text, p_trecho text, p_prova text) returns jsonb language sql stable as $$
  select jsonb_build_object('valor', p_valor, 'trecho', p_trecho, 'prova', pg_temp.id(p_prova))
$$;
-- O que a tela vê, como o gestor.
create function pg_temp.tela(p_conv uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-000000014601'::uuid, 'gestor');
  v := public.ia_passagens_da_conversa(p_conv);
  perform pg_temp.sair();
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 1. A tabela
-- ---------------------------------------------------------------------
select has_table('public', 'ia_resumos_da_passagem', 'a tabela do resumo da passagem existe');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.ia_resumos_da_passagem'::regclass),
          'a tabela nasce com RLS');
select has_trigger('public', 'ia_respostas', 'ia_respostas_pede_resumo', 'ia_respostas tem o gatilho que pede o resumo');
select has_trigger('public', 'ia_resumos_da_passagem', 'audit_ia_resumos_da_passagem', 'o resumo é auditado');

-- ---------------------------------------------------------------------
-- 2. O pedido
-- ---------------------------------------------------------------------
select pg_temp.conversa('corretor', '+5584988814601', 'Caio Corretor');
select pg_temp.dele('k1', pg_temp.id('corretor'), 120, 'Oi! Quero comprar um apartamento de 3 quartos em Ponta Negra.');
select pg_temp.dele('k2', pg_temp.id('corretor'), 80,
                    'Meu teto é uns 600 mil e vou financiar. Achei o condomínio do AP0031_IMOVA salgado.');
select pg_temp.dele('k3', pg_temp.id('corretor'), 40, 'Quero falar com um corretor, por favor');
select pg_temp.conversa('resposta', '+5584988814602', 'Rita Resposta');
select pg_temp.dele('r1', pg_temp.id('resposta'), 30, 'Tem casa para alugar em Parnamirim?');

select ok(app.ia_atendente_enfileirar(20) >= 1, 'a fila da IA roda');
select isnt(pg_temp.passagem(pg_temp.id('corretor')), null, 'o pedido de corretor vira passagem, por regra');
select is(pg_temp.pedidos(pg_temp.passagem(pg_temp.id('corretor'))), 1,
          'a passagem põe UM pedido de resumo na fila ai_jobs');
select is((select q.message ->> 'conversation_id' from pgmq.q_ai_jobs q
            where q.message ->> 'resposta_id' = pg_temp.passagem(pg_temp.id('corretor'))::text),
          pg_temp.id('corretor')::text, 'o pedido leva a conversa');
select ok(exists (select 1 from public.ingest_dedup d
                   where d.queue = 'ai_jobs'
                     and d.idempotency_key = 'resumir_passagem:' || pg_temp.passagem(pg_temp.id('corretor'))),
          'a chave de idempotência é resumir_passagem:<linha da passagem>');
select is((select s.situacao || '/' || s.simulada::text || '/' || (s.pedido_em is not null)::text
             from pg_temp.resumo(pg_temp.id('corretor')) s),
          'pedido/false/true', 'a linha do resumo nasce com a passagem: pedida, e com o retrato de que não era simulação');
select is((public.ia_atendente_responder(pg_temp.id('resposta'), pg_temp.id('r1'), 'Temos sim! Que faixa de valor?')
             ->> 'ok')::boolean, true, 'a IA responde outra conversa');
select is((select count(*)::int from pgmq.q_ai_jobs q
            where q.message ->> 'purpose' = 'resumir_passagem'
              and q.message ->> 'conversation_id' = pg_temp.id('resposta')::text), 0,
          'responder não pede resumo: só a passagem pede');

-- A porteira recusa o aviso (janela de 24 h fechada), e a conversa vai para gente assim mesmo.
select pg_temp.conversa('janela', '+5584988814603', 'Joana Janela');
-- A mensagem é de 25 h atrás: a janela da Meta fechou (o gatilho da conversa a calcula).
select pg_temp.dele('j1', pg_temp.id('janela'), 90000, 'Quero alugar, até uns 2 mil por mês. Me liga?');
select is((public.ia_atendente_passar(pg_temp.id('janela'), pg_temp.id('j1'), null,
                                      'o cliente pediu uma ligação de áudio', null, 'regra') ->> 'motivo'),
          'porteira', 'a porteira recusa o aviso fora da janela');
select is((select r.acao || '/' || (r.detalhes ->> 'quis') from public.ia_respostas r
            where r.id = pg_temp.passagem(pg_temp.id('janela'))),
          'nao_respondeu/passou_para_pessoa', 'fica a linha de quem queria passar');
select is(pg_temp.pedidos(pg_temp.passagem(pg_temp.id('janela'))), 1,
          'a passagem sem aviso também pede o resumo');

-- O teto por hora segura o aviso (20261110150000 entregava sem linha nenhuma).
select pg_temp.conversa('teto', '+5584988814607', 'Tito Teto');
select pg_temp.dele('te1', pg_temp.id('teto'), 60, 'Bom dia, tem apartamento?');
select public.ia_atendente_responder(pg_temp.id('teto'), pg_temp.id('te1'), 'Temos! Em que bairro?');
select pg_temp.dele('te2', pg_temp.id('teto'), -5, 'Prefiro falar com um corretor');
update public.app_settings set value = value || '{"teto_por_hora": 1}'::jsonb where key = 'ia.atendente';
select is(public.ia_atendente_passar(pg_temp.id('teto'), pg_temp.id('te2'), null,
                                     'o cliente pediu para falar com um corretor', null, 'regra') ->> 'motivo',
          'teto_por_hora', 'o teto por hora segura o aviso');
update public.app_settings set value = value || '{"teto_por_hora": 20}'::jsonb where key = 'ia.atendente';
select is((select r.acao || '/' || (r.detalhes ->> 'quis') || '/' || (r.detalhes ->> 'recusa') || '/' || (r.detalhes ->> 'motivo')
             from public.ia_respostas r where r.id = pg_temp.passagem(pg_temp.id('teto'))),
          'nao_respondeu/passou_para_pessoa/teto_por_hora/o cliente pediu para falar com um corretor',
          'a conversa entregue pelo teto ganha a linha da passagem');
select is((select s.situacao from pg_temp.resumo(pg_temp.id('teto')) s), 'pedido',
          'e dela nasce o pedido do resumo');
select is((select a.estado from public.ia_atendimento a where a.conversation_id = pg_temp.id('teto')), 'parada',
          'a entrega continua como era');

-- ---------------------------------------------------------------------
-- 3. A entrada do worker
-- ---------------------------------------------------------------------
-- Uma mensagem do cliente DEPOIS da passagem: o resumo é do que o corretor recebeu.
select pg_temp.dele('k4', pg_temp.id('corretor'), -30, 'Esqueci de dizer: também topo Capim Macio.');
select is((public.ia_resumo_da_passagem_entrada(pg_temp.passagem(pg_temp.id('corretor'))) ->> 'passagem')::boolean,
          true, 'a entrada reconhece a passagem');
select is(public.ia_resumo_da_passagem_entrada(pg_temp.passagem(pg_temp.id('corretor'))) ->> 'motivo',
          'o cliente pediu para falar com um corretor', 'a entrada traz o motivo registrado');
select is((select count(*)::int
             from jsonb_array_elements(public.ia_resumo_da_passagem_entrada(pg_temp.passagem(pg_temp.id('corretor'))) -> 'mensagens') x
            where x ->> 'de' = 'cliente'), 3, 'a entrada traz as três mensagens do cliente até a passagem');
select ok(not exists (select 1 from jsonb_array_elements(
                        public.ia_resumo_da_passagem_entrada(pg_temp.passagem(pg_temp.id('corretor'))) -> 'mensagens') x
                       where x ->> 'id' = pg_temp.id('k4')::text),
          'a mensagem de depois da passagem fica fora');
select ok(exists (select 1 from jsonb_array_elements(
                    public.ia_resumo_da_passagem_entrada(pg_temp.passagem(pg_temp.id('corretor'))) -> 'mensagens') x
                   where x ->> 'de' = 'ia' and x ->> 'texto' like 'Certo! Já vou te passar%'),
          'o aviso da IA vem sem a assinatura');
select is(public.ia_resumo_da_passagem_entrada(pg_temp.passagem(pg_temp.id('corretor'))) -> 'imoveis_citados'
            -> 0 ->> 'codigo', 'AP0031_IMOVA', 'a entrada traz o imóvel da Imova citado na conversa');
select is(jsonb_array_length(public.ia_resumo_da_passagem_entrada(pg_temp.passagem(pg_temp.id('corretor'))) -> 'imoveis_citados'),
          1, 'e só os que a conversa cita');
select is(public.ia_resumo_da_passagem_entrada(pg_temp.passagem(pg_temp.id('janela'))) ->> 'motivo',
          'o cliente pediu uma ligação de áudio',
          'quando a porteira recusou o aviso, o motivo vem do atendimento daquela hora');
select is((public.ia_resumo_da_passagem_entrada(pg_temp.passagem(pg_temp.id('resposta'))) ->> 'existe')::boolean, false,
          'conversa sem passagem não tem entrada');
select is((public.ia_resumo_da_passagem_entrada(
             (select r.id from public.ia_respostas r where r.conversation_id = pg_temp.id('resposta'))) ->> 'passagem')::boolean,
          false, 'resposta comum não é passagem');

-- ---------------------------------------------------------------------
-- 4 e 5. Gravar, conferir o conteúdo das provas e avisar
-- ---------------------------------------------------------------------
select is((public.ia_resumo_da_passagem_gravar(
             pg_temp.passagem(pg_temp.id('corretor')),
             jsonb_build_object(
               'procura', jsonb_build_object(
                 'negocio', pg_temp.dito('compra', 'Quero comprar um apartamento', 'k1'),
                 'tipo', pg_temp.dito('apartamento de 3 quartos', 'um apartamento de 3 quartos', 'k1'),
                 'regiao', pg_temp.dito('Ponta Negra', 'em Ponta Negra', 'k1')),
               'imoveis', jsonb_build_array(
                 jsonb_build_object('codigo', 'ap0031_imova', 'prova', pg_temp.id('k2'), 'confirmacao', null),
                 jsonb_build_object('codigo', 'CA0099_IMOVA', 'prova', pg_temp.id('k2'), 'confirmacao', null)),
               'orcamento', jsonb_build_object(
                 'valor', pg_temp.dito('até uns 600 mil', 'Meu teto é uns 600 mil', 'k2'),
                 'pagamento', pg_temp.dito('financiamento', 'vou financiar', 'k2')),
               'objecao', jsonb_build_object('tipo', 'preco', 'como_disse', 'achou o condomínio do AP0031_IMOVA salgado',
                                             'trecho', 'Achei o condomínio do AP0031_IMOVA salgado',
                                             'prova', pg_temp.id('k2')),
               'temperatura', 'quente',
               'temperatura_porque', 'Deu tipo, bairro, teto e forma de pagamento, e pediu um corretor.',
               'porque_passou', 'Pediu para falar com um corretor.',
               'proximo_passo', 'Responder hoje com o valor do condomínio do AP0031_IMOVA e oferecer visita.',
               'dados_insuficientes', false),
             null, 'resumo-da-passagem@v1') -> 'descartados'),
          '["imovel_desconhecido:CA0099_IMOVA"]'::jsonb,
          'o worker grava o resumo; o código que não é imóvel da Imova sai');
select is((select s.situacao || '/' || s.negocio || '/' || s.tipo || '/' || s.regiao
             from pg_temp.resumo(pg_temp.id('corretor')) s),
          'pronto/compra/apartamento de 3 quartos/Ponta Negra', 'o que ele procura, provado pelo trecho, fica');
select is((select s.orcamento || '/' || s.pagamento || '/' || s.objecao || '/' || s.temperatura::text
             from pg_temp.resumo(pg_temp.id('corretor')) s),
          'até uns 600 mil/financiamento/preco/quente', 'orçamento, pagamento, objeção e temperatura ficam');
select is((select s.imoveis from pg_temp.resumo(pg_temp.id('corretor')) s),
          array['AP0031_IMOVA'], 'o imóvel que o cliente escreveu fica (em maiúsculas)');
select is((select s.evidencias -> 'regiao' ->> 'trecho' from pg_temp.resumo(pg_temp.id('corretor')) s),
          'em Ponta Negra', 'a prova de cada campo fica guardada, com o trecho');
select is((select t.title from public.tasks t where t.id = (select s.task_id from pg_temp.resumo(pg_temp.id('corretor')) s)),
          'A IA passou o cliente para você: Caio Corretor — quente · comprar apartamento de 3 quartos em Ponta Negra · imóvel AP0031_IMOVA · até uns 600 mil (financiamento)',
          'a tarefa que avisou o corretor ganha o resumo em uma linha');
select ok(exists (select 1 from public.audit_log l
                   where l.table_name = 'ia_resumos_da_passagem' and l.action = 'UPDATE'
                     and l.row_id = (select s.id::text from pg_temp.resumo(pg_temp.id('corretor')) s)),
          'gravar fica no registro de auditoria');

-- O rascunho da revisão: o cliente quase não disse nada, e o resumo dizia muito.
select pg_temp.conversa('furo', '+5584988814608', 'Fábio Furo');
select pg_temp.dele('f1', pg_temp.id('furo'), 90, 'Quero uma casa, meu teto é 600 mil');
select pg_temp.da_equipe('f2', pg_temp.id('furo'), -60, 'Temos o AP0031_IMOVA e o CA0102_IMOVA. Algum interessa?');
select pg_temp.dele('f3', pg_temp.id('furo'), 30, 'Quero falar com um corretor');
select pg_temp.passagem_direta(pg_temp.id('furo'), 'o cliente pediu para falar com um corretor');
select is(public.ia_resumo_da_passagem_gravar(
            pg_temp.passagem(pg_temp.id('furo')),
            jsonb_build_object(
              'procura', jsonb_build_object(
                'negocio', pg_temp.dito('compra', 'Quero falar com um corretor', 'f3'),
                'tipo', pg_temp.dito('casa', 'Quero uma casa', 'f1'),
                'regiao', pg_temp.dito('Ponta Negra', 'Quero falar com um corretor', 'f3')),
              'imoveis', jsonb_build_array(
                jsonb_build_object('codigo', 'CASA', 'prova', pg_temp.id('f1'), 'confirmacao', null),
                jsonb_build_object('codigo', '600', 'prova', pg_temp.id('f1'), 'confirmacao', null),
                jsonb_build_object('codigo', 'AP003', 'prova', pg_temp.id('f2'), 'confirmacao', null),
                jsonb_build_object('codigo', 'CA0102_IMOVA', 'prova', pg_temp.id('f2'), 'confirmacao', null),
                jsonb_build_object('codigo', 'AP0031_IMOVA', 'prova', pg_temp.id('f2'),
                                   'confirmacao', jsonb_build_object('prova', pg_temp.id('f3'),
                                                                     'trecho', 'Quero falar com um corretor'))),
              'orcamento', jsonb_build_object(
                'valor', pg_temp.dito('até R$ 900 mil', 'meu teto é 600 mil', 'f1'),
                'pagamento', pg_temp.dito('a_vista', 'Quero falar com um corretor', 'f3')),
              'temperatura', 'morno', 'temperatura_porque', 'x', 'porque_passou', 'x', 'proximo_passo', 'x'),
            null, 'resumo-da-passagem@v1') -> 'descartados',
          '["negocio_sem_prova", "regiao_sem_prova", "orcamento_sem_prova", "pagamento_sem_prova",
            "imovel_desconhecido:CASA", "imovel_desconhecido:600", "imovel_desconhecido:AP003",
            "imovel_sem_interesse:CA0102_IMOVA", "imovel_sem_interesse:AP0031_IMOVA"]'::jsonb,
          '"Quero falar com um corretor" não prova bairro, compra nem pagamento; 900 mil não sai de "600 mil"; palavra, número e pedaço de código não são imóvel; o que só a equipe ofereceu não entra');
select is((select coalesce(s.negocio, '-') || '/' || coalesce(s.tipo, '-') || '/' || coalesce(s.regiao, '-')
                  || '/' || coalesce(s.orcamento, '-') || '/' || coalesce(s.pagamento, '-')
                  || '/' || cardinality(s.imoveis)
             from pg_temp.resumo(pg_temp.id('furo')) s),
          '-/casa/-/-/-/0', 'fica só o que o cliente disse: uma casa');

-- O imóvel que a equipe ofereceu e o cliente quis entra, com a resposta dele.
select pg_temp.conversa('oferta', '+5584988814609', 'Olga Oferta');
select pg_temp.dele('o1', pg_temp.id('oferta'), 90, 'Procuro algo em Ponta Negra');
select pg_temp.da_equipe('o2', pg_temp.id('oferta'), -60, 'Temos o AP0031_IMOVA, apartamento em Ponta Negra.');
select pg_temp.dele('o3', pg_temp.id('oferta'), 30, 'Gostei desse, quero visitar');
select pg_temp.passagem_direta(pg_temp.id('oferta'), 'o cliente quer visitar');
select is(public.ia_resumo_da_passagem_gravar(
            pg_temp.passagem(pg_temp.id('oferta')),
            jsonb_build_object(
              'imoveis', jsonb_build_array(
                jsonb_build_object('codigo', 'AP0031_IMOVA', 'prova', pg_temp.id('o2'),
                                   'confirmacao', jsonb_build_object('prova', pg_temp.id('o3'),
                                                                     'trecho', 'Gostei desse'))),
              'temperatura', 'quente', 'temperatura_porque', 'Quer visitar.', 'porque_passou', 'x', 'proximo_passo', 'x'),
            null, 'resumo-da-passagem@v1') -> 'descartados',
          '[]'::jsonb, 'o imóvel ofertado com "gostei desse" do cliente depois passa');
select is((select s.imoveis::text || '/' || (s.evidencias -> 'imoveis' -> 'AP0031_IMOVA' ->> 'confirmacao')
             from pg_temp.resumo(pg_temp.id('oferta')) s),
          '{AP0031_IMOVA}/' || pg_temp.id('o3')::text, 'com a resposta do cliente guardada como prova');

-- Provas que não valem: de outra conversa, de depois da passagem; valores fora da lista.
select pg_temp.dele('j2', pg_temp.id('janela'), -20, 'Pode ser até 3 mil, na verdade.');
select is(public.ia_resumo_da_passagem_gravar(
            pg_temp.passagem(pg_temp.id('janela')),
            jsonb_build_object(
              'procura', jsonb_build_object('regiao', pg_temp.dito('Ponta Negra', 'em Ponta Negra', 'k1')),
              'orcamento', jsonb_build_object('valor', pg_temp.dito('até 3 mil', 'até 3 mil', 'j2')),
              'objecao', jsonb_build_object('tipo', 'chato', 'como_disse', 'x', 'trecho', 'Me liga', 'prova', pg_temp.id('j1')),
              'temperatura', 'fervendo',
              'temperatura_porque', 'inventado',
              'porque_passou', 'Pediu uma ligação.',
              'proximo_passo', 'Ligar para ela.'),
            null, 'resumo-da-passagem@v1') -> 'descartados',
          '["regiao_sem_prova", "orcamento_sem_prova", "objecao_sem_prova"]'::jsonb,
          'prova de outra conversa, de depois da passagem e objeção fora do catálogo são descartadas');
select is((select coalesce(s.negocio, '-') || '/' || coalesce(s.regiao, '-') || '/' || coalesce(s.orcamento, '-')
                  || '/' || coalesce(s.objecao, '-') || '/' || coalesce(s.temperatura::text, '-')
                  || '/' || coalesce(s.temperatura_porque, '-')
             from pg_temp.resumo(pg_temp.id('janela')) s),
          '-/-/-/-/-/-', 'o que não se prova fica como "não disse"; temperatura fora da escala vira nula');
select ok((select t.title like 'A IA passou o cliente para você: Joana Janela — o cliente pediu uma ligação de áudio%'
             from public.tasks t where t.id = (select s.task_id from pg_temp.resumo(pg_temp.id('janela')) s)),
          'sem nada dito, a tarefa fica com o título de antes');

-- Uma linha por passagem: gravar de novo atualiza.
select is((public.ia_resumo_da_passagem_gravar(
             pg_temp.passagem(pg_temp.id('janela')),
             jsonb_build_object(
               'procura', jsonb_build_object('negocio', pg_temp.dito('locacao', 'Quero alugar', 'j1')),
               'orcamento', jsonb_build_object('valor', pg_temp.dito('até uns 2 mil por mês', 'até uns 2 mil por mês', 'j1')),
               'temperatura', 'morno', 'temperatura_porque', 'Deu orçamento, sem visita.',
               'porque_passou', 'Pediu uma ligação.', 'proximo_passo', 'Ligar hoje.'),
             null, 'resumo-da-passagem@v1') ->> 'ok')::boolean, true, 'gravar de novo funciona');
select is((select count(*)::int from public.ia_resumos_da_passagem s
            where s.conversation_id = pg_temp.id('janela')), 1, 'continua uma linha por passagem');
select is((select t.title from public.tasks t where t.id = (select s.task_id from pg_temp.resumo(pg_temp.id('janela')) s)),
          'A IA passou o cliente para você: Joana Janela — morno · alugar · até uns 2 mil por mês',
          'a tarefa acompanha o resumo novo');

select is(public.ia_resumo_da_passagem_gravar(
            (select r.id from public.ia_respostas r where r.conversation_id = pg_temp.id('resposta')),
            '{}'::jsonb) ->> 'motivo',
          'nao_e_passagem', 'resposta comum não ganha resumo');
select is(public.ia_resumo_da_passagem_gravar(gen_random_uuid(), '{}'::jsonb) ->> 'motivo',
          'passagem_inexistente', 'passagem que não existe é recusada com motivo');

-- ---------------------------------------------------------------------
-- 6. Falhou
-- ---------------------------------------------------------------------
select is((public.ia_resumo_da_passagem_falhou(pg_temp.passagem(pg_temp.id('corretor')), 'erro_do_modelo')
             ->> 'ja_tinha_resumo')::boolean, true, 'falhou não apaga resumo pronto');
select is((select s.situacao from pg_temp.resumo(pg_temp.id('corretor')) s), 'pronto', 'o resumo pronto continua');

-- ---------------------------------------------------------------------
-- 7 (treino). A passagem simulada também é resumida, e não toca tarefa
-- ---------------------------------------------------------------------
select pg_temp.conversa('treino', '+5584988814604', 'Janio Treino');
update public.app_settings set value = value || jsonb_build_object('conversa_de_treino', pg_temp.id('treino'))
 where key = 'ia.atendente';
select pg_temp.dele('t1', pg_temp.id('treino'), 60, 'Faz por menos?');
select is((public.ia_atendente_passar(pg_temp.id('treino'), pg_temp.id('t1'), null,
                                      'negociação de valor', null, 'regra') ->> 'treino')::boolean, true,
          'no treino, passar é simulação');
select is(pg_temp.pedidos(pg_temp.passagem(pg_temp.id('treino'))), 1, 'a passagem do treino também pede o resumo');
select is((select s.simulada from pg_temp.resumo(pg_temp.id('treino')) s), true,
          'e a linha guarda que, na hora, era simulação');
select is((public.ia_resumo_da_passagem_falhou(pg_temp.passagem(pg_temp.id('treino')), 'dado_pessoal') ->> 'ok')::boolean,
          true, 'o resumo que não saiu fica registrado');
select is((select s.situacao || '/' || s.motivo_sem_resumo from pg_temp.resumo(pg_temp.id('treino')) s),
          'falhou/dado_pessoal', 'com o porquê');
select is(public.ia_resumo_da_passagem_gravar(pg_temp.passagem(pg_temp.id('treino')),
            jsonb_build_object('temperatura', 'morno', 'temperatura_porque', 'x', 'porque_passou', 'x',
                               'proximo_passo', 'x')) ->> 'task_id', null,
          'no treino o resumo nunca vai para título de tarefa');

-- ---------------------------------------------------------------------
-- 8. A tela: situação e destaque
-- ---------------------------------------------------------------------
select pg_temp.conversa('nova', '+5584988814605', 'Nina Nova');
select pg_temp.dele('n1', pg_temp.id('nova'), 50, 'Quero falar com um atendente');
select public.ia_atendente_passar(pg_temp.id('nova'), pg_temp.id('n1'), null,
                                  'o cliente pediu para falar com um corretor', null, 'regra');

select is(pg_temp.tela(pg_temp.id('corretor')) -> 'passagens' -> 0 -> 'resumo' ->> 'temperatura',
          'quente', 'a tela lê o resumo da passagem');
select is((pg_temp.tela(pg_temp.id('corretor')) ->> 'destaque')::uuid,
          pg_temp.passagem(pg_temp.id('corretor')), 'ninguém respondeu: a passagem fica em destaque no topo');
select is(pg_temp.tela(pg_temp.id('corretor')) -> 'passagens' -> 0 -> 'resumo' ->> 'objecao_nome',
          coalesce((select o.nome from public.objecoes o where o.slug = 'preco'), 'Preço'),
          'a objeção vem com o nome do catálogo (ou o de sempre, sem catálogo)');
select is(pg_temp.tela(pg_temp.id('nova')) -> 'passagens' -> 0 ->> 'situacao',
          'escrevendo', 'pedido há pouco: o resumo está sendo escrito');
select is((pg_temp.tela(pg_temp.id('nova')) ->> 'destaque')::uuid, pg_temp.passagem(pg_temp.id('nova')),
          'a passagem nova fica em destaque');
select is(pg_temp.tela(pg_temp.id('treino')) ->> 'destaque', null, 'no treino, nada fica em destaque');
select is((pg_temp.tela(pg_temp.id('treino')) -> 'passagens' -> 0 ->> 'simulada')::boolean, true,
          'a tela sabe que a passagem do treino foi simulação');
select is((pg_temp.tela(pg_temp.id('teto')) ->> 'destaque')::uuid, pg_temp.passagem(pg_temp.id('teto')),
          'a passagem pelo teto é a do destaque, e não a anterior');

-- "Ligar a IA aqui" e depois "Parar a IA", sem ninguém escrever: a parada não é mais da passagem.
select pg_temp.entrar('a0000000-0000-4000-8000-000000014602'::uuid, 'sdr');
select public.ia_conversa_ligar(pg_temp.id('nova'));
select public.ia_conversa_parar(pg_temp.id('nova'), 'parei para ver');
select pg_temp.sair();
select is(pg_temp.tela(pg_temp.id('nova')) ->> 'destaque', null,
          '"Ligar a IA aqui" e "Parar a IA" sem ninguém escrever: o destaque velho não volta');

-- A conversa de teste desmarcada: a passagem foi simulação na hora, e continua sendo.
select pg_temp.conversa('teste', '+5584988814610', 'Matheu Teste');
select pg_temp.entrar('a0000000-0000-4000-8000-000000014601'::uuid, 'gestor');
select public.ia_conversa_de_teste_marcar(pg_temp.id('teste'), true);
select pg_temp.sair();
select pg_temp.dele('x1', pg_temp.id('teste'), 50, 'Quero falar com um corretor');
select is((public.ia_atendente_passar(pg_temp.id('teste'), pg_temp.id('x1'), null,
                                      'o cliente pediu para falar com um corretor', null, 'regra') ->> 'teste')::boolean,
          true, 'na conversa de teste, passar é simulação');
select pg_temp.entrar('a0000000-0000-4000-8000-000000014601'::uuid, 'gestor');
select public.ia_conversa_de_teste_marcar(pg_temp.id('teste'), false);
select pg_temp.sair();
select is(pg_temp.tela(pg_temp.id('teste')) ->> 'destaque', null,
          'desmarcada a conversa de teste, a passagem simulada não vira destaque');
select is((pg_temp.tela(pg_temp.id('teste')) -> 'passagens' -> 0 ->> 'simulada')::boolean, true,
          'o retrato da hora vale, e não o estado de hoje');

-- Alguém da equipe responde: o destaque sai; o resumo fica no ponto da passagem.
select pg_temp.da_equipe('k5', pg_temp.id('corretor'), 60, 'Oi, Caio! Aqui é o Gil.');
select is(pg_temp.tela(pg_temp.id('corretor')) ->> 'destaque', null, 'alguém da equipe respondeu: o destaque sai');
select is(jsonb_array_length(pg_temp.tela(pg_temp.id('corretor')) -> 'passagens'), 1,
          'e o resumo continua no ponto da passagem');

-- Não chegou, antes, reenfileirar.
update public.ia_resumos_da_passagem set pedido_em = now() - interval '20 minutes'
 where resposta_id = pg_temp.passagem(pg_temp.id('teto'));
select is(pg_temp.tela(pg_temp.id('teto')) -> 'passagens' -> 0 ->> 'situacao', 'nao_chegou',
          'pedido há mais de 15 minutos e nada: o resumo não chegou (e a tela não diz "escrevendo")');
select pg_temp.conversa('antiga', '+5584988814611', 'Ana Antiga');
insert into public.ia_respostas (conversation_id, corpo, acao, detalhes, criada_em)
values (pg_temp.id('antiga'), '—', 'passou_para_pessoa', '{"motivo": "de antes"}', now() - interval '3 days');
select is(pg_temp.tela(pg_temp.id('antiga')) -> 'passagens' -> 0 ->> 'situacao', 'antes',
          'a passagem de antes desta funcionalidade diz que é de antes');
select is(public.ia_resumos_reenfileirar(48), 1,
          'reenfileirar pega só o pedido que não andou (a passagem de 3 dias atrás fica de fora)');
select ok(exists (select 1 from public.ingest_dedup d
                   where d.queue = 'ai_jobs'
                     and d.idempotency_key like 'resumir_passagem:' || pg_temp.passagem(pg_temp.id('teto')) || ':%'),
          'com chave nova');
select is(pg_temp.tela(pg_temp.id('teto')) -> 'passagens' -> 0 ->> 'situacao', 'escrevendo',
          'e o pedido volta a "escrevendo"');

-- Quem só pediu um corretor: temperatura nula ("não dá para julgar"), e o porquê fica.
select is((public.ia_resumo_da_passagem_gravar(
             pg_temp.passagem(pg_temp.id('nova')),
             jsonb_build_object('temperatura', null,
                                'temperatura_porque', 'Só pediu um corretor: não dá para julgar.',
                                'porque_passou', 'Pediu para falar com um corretor.',
                                'dados_insuficientes', true),
             null, 'resumo-da-passagem@v1') ->> 'ok')::boolean, true, 'o resumo de quem não disse nada também é gravado');
select is((select coalesce(s.temperatura::text, '-') || '/' || s.temperatura_porque || '/' || s.dados_insuficientes::text
             from pg_temp.resumo(pg_temp.id('nova')) s),
          '-/Só pediu um corretor: não dá para julgar./true',
          'temperatura nula fica nula, com o porquê');

-- ---------------------------------------------------------------------
-- 9. Quem vê e quem escreve
-- ---------------------------------------------------------------------
select pg_temp.entrar('a0000000-0000-4000-8000-000000014602'::uuid, 'sdr');
select ok((select count(*) from public.ia_resumos_da_passagem) >= 5, 'o SDR lê os resumos');
select throws_ok(
  $$insert into public.ia_resumos_da_passagem (conversation_id, resposta_id, situacao)
    values (pg_temp.id('antiga'), pg_temp.passagem(pg_temp.id('antiga')), 'pronto')$$,
  '42501', null, 'ninguém escreve o resumo direto na tabela');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000014603'::uuid, 'leitura');
select is((select count(*)::int from public.ia_resumos_da_passagem), 0, 'leitura não vê os resumos');
select is((public.ia_passagens_da_conversa(pg_temp.id('corretor')) ->> 'existe')::boolean, false,
          'leitura não lê as passagens');
select pg_temp.sair();

select ok(not has_function_privilege('authenticated', 'public.ia_resumo_da_passagem_gravar(uuid,jsonb,bigint,text)', 'execute')
          and not has_function_privilege('authenticated', 'public.ia_resumo_da_passagem_falhou(uuid,text,bigint)', 'execute')
          and not has_function_privilege('authenticated', 'public.ia_resumo_da_passagem_entrada(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.ia_resumos_reenfileirar(integer)', 'execute')
          and not has_function_privilege('anon', 'public.ia_passagens_da_conversa(uuid)', 'execute'),
          'gente logada não grava, não lê pela porta do worker e não reenfileira; anônimo não lê nada');
select ok(has_function_privilege('service_role', 'public.ia_resumo_da_passagem_gravar(uuid,jsonb,bigint,text)', 'execute')
          and has_function_privilege('service_role', 'public.ia_resumo_da_passagem_falhou(uuid,text,bigint)', 'execute')
          and has_function_privilege('service_role', 'public.ia_resumo_da_passagem_entrada(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.ia_resumos_reenfileirar(integer)', 'execute')
          and has_function_privilege('authenticated', 'public.ia_passagens_da_conversa(uuid)', 'execute'),
          'o worker grava, lê e reenfileira; a tela lê as passagens');

-- ---------------------------------------------------------------------
-- 10. Desligado: nada vai para a fila, e a tela não promete resumo
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, description)
values ('ia.resumo_da_passagem', '{"ligado": false}'::jsonb, 'pgTAP 146');
select pg_temp.conversa('desligado', '+5584988814606', 'Dora Desligado');
select pg_temp.dele('d1', pg_temp.id('desligado'), 50, 'Quero falar com um corretor');
select public.ia_atendente_passar(pg_temp.id('desligado'), pg_temp.id('d1'), null,
                                  'o cliente pediu para falar com um corretor', null, 'regra');
select is(pg_temp.pedidos(pg_temp.passagem(pg_temp.id('desligado'))), 0,
          'com o resumo desligado, a passagem não pede resumo');
select is((select s.situacao || '/' || s.motivo_sem_resumo from pg_temp.resumo(pg_temp.id('desligado')) s),
          'falhou/desligado', 'a linha nasce dizendo que está desligado');
select is(pg_temp.tela(pg_temp.id('desligado')) -> 'passagens' -> 0 ->> 'situacao', 'falhou',
          'e a tela não diz "escrevendo"');
select is((select a.estado from public.ia_atendimento a where a.conversation_id = pg_temp.id('desligado')),
          'parada', 'a passagem acontece do mesmo jeito');
select is(public.ia_resumos_reenfileirar(48), 0, 'desligado, reenfileirar não põe nada');


-- 25/11/2026: o código sem o "_IMOVA" do fim, e o imóvel de interesse lido pela IA.
select ok(app.ia_resumo_tem_codigo('Vi o TE0004 no ZAP', 'TE0004_IMOVA'),
          'o código vale sem o "_IMOVA" do fim, como o cliente escreve');
select ok(app.ia_resumo_tem_codigo('Código da oferta: TE0004_IMOVA', 'TE0004_IMOVA'),
          'e continua valendo inteiro');
select ok(not app.ia_resumo_tem_codigo('Vi o TE00041 no ZAP', 'TE0004_IMOVA'),
          'sem o "_IMOVA", continua palavra inteira: TE00041 não é TE0004');
select ok(app.ia_resumo_tem_codigo('Vi o TE0007 no ZAP', 'TE0007'),
          'código sem "_IMOVA" no catálogo continua valendo como antes');
select is(app.ia_resumo_interesse(gen_random_uuid()), '[]'::jsonb,
          'conversa sem interesse registrado: lista vazia');
insert into public.interesse_no_imovel (conversation_id, codigo, nivel)
values (pg_temp.id('desligado'), 'ZZ9146_IMOVA', 'muito');
select is(app.ia_resumo_interesse(pg_temp.id('desligado')) ->> 0, 'imóvel (ZZ9146_IMOVA)',
          'o interesse registrado vira frase, com o código entre parênteses');

select * from finish();
rollback;

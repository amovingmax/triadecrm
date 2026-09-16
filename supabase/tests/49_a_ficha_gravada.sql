-- =====================================================================
-- pgTAP — CRM Inteligente, Fase 2 (migração 20260917110000)
--
-- As duas pontas da análise moram no banco, e é aqui que elas são provadas:
--
--   1. `app.ia_entrada_da_ficha` monta o que o prompt lê: a janela de mensagens
--      novas, quem falou, a ficha anterior e o que o CRM ainda não sabe.
--   2. `app.ia_gravar_ficha` grava o que voltou — e RECUSA o que não se sustenta:
--      evidência que aponta para mensagem de outra conversa, id que não é id,
--      prazo que não é data, sugestão sobre campo cheio, etapa movida.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(28);

create function pg_temp.conversa(p_peer text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.conversations where peer_phone_e164 = p_peer
$$;
create function pg_temp.msg(p_wamid text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.messages where wa_message_id = p_wamid
$$;
create function pg_temp.ligar_sugestao(p_ligado boolean) returns void language sql security definer set search_path = '' as $$
  update public.app_settings
     set value = jsonb_set(value, '{modulos,sugestoes_de_campo}', to_jsonb(p_ligado))
   where key = 'ia.crm_inteligente'
$$;

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999994900"')
 where key = 'whatsapp.envio';
-- O bot de entrada fica de fora: ele responderia o menu e a janela da ficha
-- passaria a ter mensagem do robô no meio. Aqui se mede a ficha, não o bot (47).
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

-- Duas conversas: a nossa e a do vizinho. A do vizinho existe por um motivo só —
-- é a mensagem dela que o modelo vai citar como prova, e que tem de cair.
set role service_role;
select public.wa_entrada_registrar('wamid.F49.1', '+5584999994900', '+5584988884901', 'text', 'Bom dia! Vocês cobram mensalidade?');
select public.wa_entrada_registrar('wamid.F49.2', '+5584999994900', '+5584988884901', 'text', 'Gostei. Me manda a proposta?');
select public.wa_entrada_registrar('wamid.F49.9', '+5584999994900', '+5584988884999', 'text', 'sou outra conversa');
reset role;

-- Num pgTAP tudo nasce no MESMO instante: `now()` não anda dentro da transação.
-- Em produção cada mensagem chega no seu próprio webhook, e é esse tempo que
-- ordena a conversa e corta a janela. Aqui ele é dado à mão, para o teste medir
-- a janela e não o relógio.
update public.messages set created_at = now() - interval '20 minutes' where wa_message_id = 'wamid.F49.1';
update public.messages set created_at = now() - interval '19 minutes' where wa_message_id = 'wamid.F49.2';
update public.messages set created_at = now() - interval '18 minutes' where wa_message_id = 'wamid.F49.9';

-- ---------- 1. a entrada ----------
select is((app.ia_entrada_da_ficha(pg_temp.conversa('+5584988884901')) ->> 'existe')::boolean, true,
  'a entrada existe para conversa que existe');
select is((select jsonb_array_length(app.ia_entrada_da_ficha(pg_temp.conversa('+5584988884901')) -> 'mensagens')), 2,
  'e traz as duas mensagens da conversa — nem a da conversa vizinha');
select is(app.ia_entrada_da_ficha(pg_temp.conversa('+5584988884901')) -> 'mensagens' -> 0 ->> 'de', 'parceiro',
  'quem falou vem no vocabulário do prompt');
select is(app.ia_entrada_da_ficha(pg_temp.conversa('+5584988884901')) -> 'mensagens' -> 0 ->> 'texto',
  'Bom dia! Vocês cobram mensalidade?', 'e o texto vem inteiro, na ordem da conversa');
select is((app.ia_entrada_da_ficha('00000000-0000-4000-8000-000000000049') ->> 'existe')::boolean, false,
  'conversa que não existe diz isso, em vez de explodir');

-- ---------- 2. a gravação ----------
-- A saída do modelo, com quatro coisas erradas de propósito:
--   · um sinal que aponta para a mensagem da conversa VIZINHA;
--   · um sinal cujo id não é nem uuid;
--   · um compromisso com prazo que não é data;
--   · uma etapa sugerida, que não pode mover negócio nenhum.
select is(
  (select (app.ia_gravar_ficha(
     pg_temp.conversa('+5584988884901'),
     jsonb_build_object(
       'resumo', 'Fornecedor perguntou preço e pediu proposta.',
       'intencao', 'PEDIU_PROPOSTA',
       'scoreIntencao', 82,
       'motivo', 'Pediu proposta depois de entender o modelo.',
       'sentimento', 'positivo',
       'sinais', jsonb_build_array(
         jsonb_build_object('tipo','pediu_proposta','polaridade','positivo','forca','forte',
                            'messageId', pg_temp.msg('wamid.F49.2'), 'trecho','Me manda a proposta?'),
         jsonb_build_object('tipo','urgencia','polaridade','positivo','forca','forte',
                            'messageId', pg_temp.msg('wamid.F49.9'), 'trecho','de outra conversa'),
         jsonb_build_object('tipo','urgencia','polaridade','positivo','forca','fraco',
                            'messageId','não é um id','trecho','inventado')
       ),
       'objecoes', jsonb_build_array('preco'),
       'etapaSugerida', 'Reunião marcada',
       'compromissosNovos', jsonb_build_array(
         jsonb_build_object('quem','equipe','oQue','Mandar a proposta','prazo','sexta que vem',
                            'messageId', pg_temp.msg('wamid.F49.2'))
       ),
       'compromissosCumpridos', '[]'::jsonb,
       'proximaAcao', jsonb_build_object('descricao','Mandar a proposta hoje','prazo','2026-09-18 10:00'),
       'dadosExtraidos', jsonb_build_array(
         jsonb_build_object('campo','bairro','valor','Petrópolis','confianca',0.9,
                            'messageId', pg_temp.msg('wamid.F49.2'))
       ),
       'alertas', jsonb_build_array('pediu_proposta'),
       'confianca', 0.82,
       'dadosInsuficientes', false
     ), null, 'ficha-da-conversa@v1', pg_temp.msg('wamid.F49.2')) ->> 'evidencias_descartadas')::int),
  2, 'as duas evidências que não se sustentam são descartadas, e a conta volta');

select is((select jsonb_array_length(sinais) from public.ficha_da_conversa
            where conversation_id = pg_temp.conversa('+5584988884901')), 1,
  'e só o sinal que aponta para mensagem DESTA conversa fica gravado');
select is((select score_intencao from public.ficha_da_conversa
            where conversation_id = pg_temp.conversa('+5584988884901')), 82::smallint,
  'a ficha guarda o score');
select is((select intencao from public.ficha_da_conversa
            where conversation_id = pg_temp.conversa('+5584988884901')), 'PEDIU_PROPOSTA',
  'e a intenção');
select is((select ultima_mensagem_analisada from public.ficha_da_conversa
            where conversation_id = pg_temp.conversa('+5584988884901')), pg_temp.msg('wamid.F49.2'),
  'e até onde leu: é daqui que sai a janela da próxima análise');
select is((select proxima_acao_em from public.ficha_da_conversa
            where conversation_id = pg_temp.conversa('+5584988884901')),
  '2026-09-18 10:00'::timestamptz, 'prazo escrito como data vira data');

-- ---------- 3. o que a gravação recusa ----------
select is((select count(*)::int from public.compromissos_da_conversa
            where conversation_id = pg_temp.conversa('+5584988884901')), 1,
  'o compromisso prometido virou linha');
select is((select prazo from public.compromissos_da_conversa
            where conversation_id = pg_temp.conversa('+5584988884901')), null,
  '"sexta que vem" NÃO vira timestamp chutado: vira null, e o texto do compromisso continua lá');
select is((select o_que from public.compromissos_da_conversa
            where conversation_id = pg_temp.conversa('+5584988884901')), 'Mandar a proposta',
  'e o que foi prometido fica escrito');
select is((select count(*)::int from public.sugestoes_de_campo), 0,
  'com a bandeira desligada, etapaSugerida e dado extraído não viram sugestão nenhuma');
select isnt((select ia_analisada_em from public.conversations where peer_phone_e164 = '+5584988884901'),
  null, 'a conversa fica marcada como analisada');
select is((select ia_pendente_desde from public.conversations where peer_phone_e164 = '+5584988884901'),
  null, 'e sai da fila de análise: janela fechada é janela fechada');

-- ---------- 4. a segunda análise é incremental ----------
select is((select jsonb_array_length(app.ia_entrada_da_ficha(pg_temp.conversa('+5584988884901')) -> 'mensagens')), 0,
  'sem mensagem nova, a janela seguinte vem vazia — e o worker não paga chamada por ela');
select is(app.ia_entrada_da_ficha(pg_temp.conversa('+5584988884901')) ->> 'ficha_anterior',
  'Fornecedor perguntou preço e pediu proposta.',
  'e a ficha anterior entra na entrada: a análise seguinte não relê a conversa toda');

set role service_role;
select public.wa_entrada_registrar('wamid.F49.3', '+5584999994900', '+5584988884901', 'text', 'e aí, conseguem?');
reset role;
update public.messages set created_at = now() - interval '5 minutes'
 where wa_message_id = 'wamid.F49.3';
select is((select jsonb_array_length(app.ia_entrada_da_ficha(pg_temp.conversa('+5584988884901')) -> 'mensagens')), 1,
  'mensagem nova abre janela nova, com só o que é novo');

select lives_ok($$ select app.ia_gravar_ficha(
    (select id from public.conversations where peer_phone_e164 = '+5584988884901'),
    jsonb_build_object('resumo','Cobrou a proposta.','intencao','PEDIU_PROPOSTA','scoreIntencao',86,
      'sentimento','neutro','sinais','[]'::jsonb,'objecoes','[]'::jsonb,
      'compromissosNovos', jsonb_build_array(jsonb_build_object('quem','equipe','oQue','Mandar a proposta',
        'prazo',null,'messageId',(select id from public.messages where wa_message_id = 'wamid.F49.2'))),
      'compromissosCumpridos','[]'::jsonb,
      'proximaAcao', jsonb_build_object('descricao','Mandar hoje','prazo',null),
      'dadosExtraidos','[]'::jsonb,'alertas','[]'::jsonb,'confianca',0.9,'dadosInsuficientes',false),
    null, 'ficha-da-conversa@v1',
    (select id from public.messages where wa_message_id = 'wamid.F49.3')) $$,
  'a segunda análise grava por cima da mesma ficha');
select is((select analises_incrementais from public.ficha_da_conversa
            where conversation_id = pg_temp.conversa('+5584988884901')), 2,
  'e a conta de análises anda');
select is((select count(*)::int from public.compromissos_da_conversa
            where conversation_id = pg_temp.conversa('+5584988884901')), 1,
  'a MESMA promessa, relida na análise seguinte, não vira uma segunda linha');

-- ---------- 5. a sugestão de campo, quando ligada ----------
select pg_temp.ligar_sugestao(true);
select is(
  (select (app.ia_gravar_ficha(pg_temp.conversa('+5584988884901'),
     jsonb_build_object('resumo','Disse o bairro.','intencao','QUER_SABER_MAIS','scoreIntencao',50,
       'sentimento','neutro','sinais','[]'::jsonb,'objecoes','[]'::jsonb,
       'compromissosNovos','[]'::jsonb,'compromissosCumpridos','[]'::jsonb,
       'proximaAcao', jsonb_build_object('descricao','Seguir','prazo',null),
       'dadosExtraidos', jsonb_build_array(jsonb_build_object('campo','bairro','valor','Petrópolis',
         'confianca',0.9,'messageId', pg_temp.msg('wamid.F49.3'))),
       'alertas','[]'::jsonb,'confianca',0.7,'dadosInsuficientes',false),
     null, 'ficha-da-conversa@v1', pg_temp.msg('wamid.F49.3')) ->> 'sugestoes')::int),
  0, 'conversa sem organização não gera sugestão: não há em quem gravar');

-- Agora com organização, e com o campo cheio: nem assim a IA propõe trocar.
insert into public.organizations (id, kind, name, neighborhood, source_id)
values ('00000000-0000-4000-8000-0000000049f1', 'fornecedor', 'Buffet F49', 'Tirol',
        (select id from public.sources where slug = 'captura_campo'));
update public.conversations set organization_id = '00000000-0000-4000-8000-0000000049f1'
 where peer_phone_e164 = '+5584988884901';

select is(
  (select (app.ia_gravar_ficha(pg_temp.conversa('+5584988884901'),
     jsonb_build_object('resumo','Disse outro bairro.','intencao','QUER_SABER_MAIS','scoreIntencao',50,
       'sentimento','neutro','sinais','[]'::jsonb,'objecoes','[]'::jsonb,
       'compromissosNovos','[]'::jsonb,'compromissosCumpridos','[]'::jsonb,
       'proximaAcao', jsonb_build_object('descricao','Seguir','prazo',null),
       'dadosExtraidos', jsonb_build_array(jsonb_build_object('campo','bairro','valor','Petrópolis',
         'confianca',0.9,'messageId', pg_temp.msg('wamid.F49.3'))),
       'alertas','[]'::jsonb,'confianca',0.7,'dadosInsuficientes',false),
     null, 'ficha-da-conversa@v1', pg_temp.msg('wamid.F49.3')) ->> 'sugestoes')::int),
  0, 'campo que uma pessoa já preencheu não vira sugestão: a IA não discute com gente');

update public.organizations set neighborhood = null where id = '00000000-0000-4000-8000-0000000049f1';
select is(
  (select (app.ia_gravar_ficha(pg_temp.conversa('+5584988884901'),
     jsonb_build_object('resumo','Disse o bairro.','intencao','QUER_SABER_MAIS','scoreIntencao',50,
       'sentimento','neutro','sinais','[]'::jsonb,'objecoes','[]'::jsonb,
       'compromissosNovos','[]'::jsonb,'compromissosCumpridos','[]'::jsonb,
       'proximaAcao', jsonb_build_object('descricao','Seguir','prazo',null),
       'dadosExtraidos', jsonb_build_array(jsonb_build_object('campo','bairro','valor','Petrópolis',
         'confianca',0.9,'messageId', pg_temp.msg('wamid.F49.3'))),
       'alertas','[]'::jsonb,'confianca',0.7,'dadosInsuficientes',false),
     null, 'ficha-da-conversa@v1', pg_temp.msg('wamid.F49.3')) ->> 'sugestoes')::int),
  1, 'campo vazio vira sugestão — e ela nasce pendente, para uma pessoa aceitar');
select is((select status from public.sugestoes_de_campo limit 1), 'pendente',
  'nada é aplicado sozinho');
select is((select neighborhood from public.organizations where id = '00000000-0000-4000-8000-0000000049f1'),
  null, 'e o campo continua vazio até alguém decidir: sugestão não é escrita');

select * from finish();
rollback;

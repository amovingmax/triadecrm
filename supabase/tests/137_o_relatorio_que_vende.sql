-- =====================================================================
-- pgTAP — O relatório que vende, da Imova (migração 20261109210000)
--
-- Pedido do usuário em 09/11/2026: quantos leads estão interessados em cada
-- imóvel, o mais interessado de cada um, sugestões da IA para vender e o que
-- falar com cada lead, e o progresso da IA. Este arquivo prova:
--
--   1. O PROPÓSITO `aconselhar_vendas` entrou nas listas sem tirar nenhum, e
--      as tabelas novas nascem com RLS;
--   2. A CARTEIRA e as categorias do imóvel;
--   3. O INTERESSE lead × imóvel: o código citado pelo cliente liga, e a
--      leitura do conselheiro vale sobre o sinal;
--   4. As OPORTUNIDADES paradas: esperando, promessa, esfriando, combina (e
--      sai de "combina" quando a equipe manda o imóvel), e a comissão provável;
--   5. O CONSELHEIRO: as portas só do worker, sem telefone para o modelo, só
--      códigos da carteira, só sugestão de falar ou fazer, fila sem repetir e
--      nunca na KOMUNE;
--   6. A JUÍZA grava a lacuna;
--   7. As PREMISSAS: o gestor muda, o SDR não, fora da faixa não passa;
--   8. QUEM VÊ: gestor e SDR veem as leituras; o embaixador não;
--   9. As leituras trazem as partes que a tela desenha;
--  10. O WHATSAPP NÃO MUDA: nenhuma leitura grava mensagem.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(45);


insert into public.allowed_users (email, role, note) values
  ('h136.g@teste.local', 'gestor', 'pgTAP 136'),
  ('h136.s@teste.local', 'sdr', 'pgTAP 136'),
  ('h136.l@teste.local', 'embaixador', 'pgTAP 136');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000013601'::uuid, 'h136.g@teste.local', '{"full_name":"Gil Gestor 136"}'),
  ('a0000000-0000-4000-8000-000000013602'::uuid, 'h136.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000013603'::uuid, 'h136.l@teste.local', '{"full_name":"Edu Embaixador"}');

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

create temp table t136(chave text primary key, valor uuid);
grant all on t136 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t136 where chave = p_chave
$$;
create function pg_temp.conversa(p_chave text, p_tel text, p_nome text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999913600', p_tel, p_nome,
          'a0000000-0000-4000-8000-000000013601'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t136 values (p_chave, v);
  return v;
end $$;
create function pg_temp.dele(p_conv uuid, p_em timestamptz, p_texto text default 'pgtap136 dele') returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_texto, 'system', 'crm', p_em)
  returning id into v;
  update public.conversations set last_inbound_at = greatest(coalesce(last_inbound_at, p_em), p_em)
   where id = p_conv;
  return v;
end $$;
create function pg_temp.nossa(p_conv uuid, p_em timestamptz, p_texto text, p_template int default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at, template_id)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          p_texto, 'human', 'echo', 'a0000000-0000-4000-8000-000000013601'::uuid,
          'wamid.PGTAP136.' || gen_random_uuid(), p_em, p_em, p_template)
  returning id into v;
  update public.conversations set last_outbound_at = greatest(coalesce(last_outbound_at, p_em), p_em)
   where id = p_conv;
  return v;
end $$;
create function pg_temp.atitude(p_conv uuid, p_etiqueta text, p_em timestamptz) returns void
language plpgsql as $$
begin
  insert into public.atitude_historico (conversation_id, tipo, de, para, motivo, em)
  values (p_conv, 'etiqueta', null, p_etiqueta, 'pgtap136', p_em);
  insert into public.atitudes (conversation_id, etiqueta, motivo, desde, calculada_em)
  values (p_conv, p_etiqueta, 'pgtap136', p_em, p_em)
  on conflict (conversation_id) do update set etiqueta = excluded.etiqueta, desde = excluded.desde;
end $$;

select pg_temp.virar('imova');
-- Sem a IA que atende: a conversa do treino não importa aqui.
delete from public.app_settings where key in ('ia.conselheiro', 'relatorio.premissas');
insert into public.app_settings (key, value)
values ('ia.conselheiro', '{"ligada": true, "dias_para_tras": 30, "por_rodada": 500}'::jsonb);

-- =====================================================================
-- 1. Propósito e tabelas
-- =====================================================================
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_runs_purpose_check')
          like '%''aconselhar_vendas''%', 'o propósito aconselhar_vendas entrou na lista de ai_runs');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_runs_purpose_check')
          like '%''avaliar_atendimento''%', 'e o avaliar_atendimento continua lá');
select ok(pg_get_functiondef('app.ia_enfileirar(text,jsonb,text)'::regprocedure) like '%''aconselhar_vendas''%'
          and pg_get_functiondef('app.ia_gasto_bloqueado_para()'::regprocedure) like '%''aconselhar_vendas''%',
          'a fila e o freio do orçamento conhecem o propósito');
select is((select count(*)::int from pg_class
            where relnamespace = 'public'::regnamespace and relrowsecurity
              and relname in ('interesse_no_imovel', 'ia_conselho_do_lead', 'ia_conselho_do_imovel',
                              'relatorio_imova_mesa_dia')), 4,
          'as quatro tabelas novas nascem com RLS');

-- =====================================================================
-- 2. Carteira
-- =====================================================================
select is(array[app.imova_tipo_categoria('apartamento'), app.imova_tipo_categoria('casa'),
                app.imova_tipo_categoria('terreno'), app.imova_tipo_categoria('sala_comercial'),
                app.imova_tipo_categoria('loja'), app.imova_tipo_categoria(null)],
          array['apartamento', 'casa', 'terreno', 'comercial', 'comercial', 'outro'],
          'o tipo do anúncio vira categoria');
insert into public.anuncios (codigo, titulo, tipo, negocio, situacao, bairro, quartos, preco_venda, preco_aluguel) values
  ('AP1360_IMOVA', 'Apto 136 Ponta Negra', 'apartamento', 'venda', 'no_ar', 'Ponta Negra', 3, 500000, null),
  ('CA1361_IMOVA', 'Casa 136 Tirol', 'casa', 'venda', 'no_ar', 'Tirol', 3, 450000, null),
  ('AP1362_IMOVA', 'Apto 136 para alugar', 'apartamento', 'aluguel', 'no_ar', 'Ponta Negra', 2, null, 2400);
select ok(exists (select 1 from app.imova_carteira() k
                   where k.codigo = 'AP1360_IMOVA' and k.tipo = 'apartamento' and k.chave = 'ap1360'),
          'o anúncio do CRM entra na carteira, com o pedaço do código que o cliente escreve');

-- =====================================================================
-- 3 e 4. Interesse e oportunidades
-- =====================================================================
-- a: muito interessado, citou o AP1360 há 2 h, ninguém respondeu.
select pg_temp.conversa('a', '+5584999913611', 'Ana 136');
select pg_temp.dele(pg_temp.id('a'), now() - interval '2 hours', 'Oi! Quero visitar o AP1360 de Ponta Negra');
select pg_temp.atitude(pg_temp.id('a'), 'muito_interessado', now() - interval '2 hours');
-- b: era muito interessado e esfriou (a equipe respondeu).
select pg_temp.conversa('b', '+5584999913612', 'Beto 136');
select pg_temp.dele(pg_temp.id('b'), now() - interval '6 days', 'procuro apartamento');
select pg_temp.nossa(pg_temp.id('b'), now() - interval '6 days' + interval '5 minutes', 'Tenho opções, posso mandar?');
select pg_temp.atitude(pg_temp.id('b'), 'esfriando', now() - interval '2 days');
update public.atitudes set antes_de_esfriar = 'muito_interessado' where conversation_id = pg_temp.id('b');
-- c: a equipe prometeu as fotos para ontem.
select pg_temp.conversa('c', '+5584999913613', 'Caio 136');
select pg_temp.dele(pg_temp.id('c'), now() - interval '3 days', 'manda as fotos?');
select pg_temp.nossa(pg_temp.id('c'), now() - interval '3 days' + interval '2 minutes', 'Mando amanhã');
select pg_temp.atitude(pg_temp.id('c'), 'interessado', now() - interval '3 days');
insert into public.compromissos_da_conversa (conversation_id, quem, o_que, prazo, status)
values (pg_temp.id('c'), 'equipe', 'Mandar as fotos do AP1362', now() - interval '1 day', 'aberto');

select ok(exists (select 1 from app.imova_interesses() i
                   where i.conversation_id = pg_temp.id('a') and i.codigo = 'AP1360_IMOVA'
                     and i.origem like '%codigo_na_mensagem%' and i.nivel = 'muito'),
          'o código citado pelo cliente liga o lead ao imóvel, no nível da atitude');
select ok(exists (select 1 from app.imova_mesa_agora() m
                   where m.conversation_id = pg_temp.id('a') and m.situacao = 'esperando' and m.codigo = 'AP1360_IMOVA'),
          'quente sem resposta há 2 h está esperando, com o imóvel');
select is((select m.valor from app.imova_mesa_agora() m where m.conversation_id = pg_temp.id('a') and m.situacao = 'esperando'),
          round(500000 * 0.06 * (select c.chance from app.imova_chances() c where c.etapa_slug = 'respondeu'), 2),
          'comissão provável = valor do imóvel × 6% × chance da etapa');
select ok(exists (select 1 from app.imova_mesa_agora() m
                   where m.conversation_id = pg_temp.id('b') and m.situacao = 'esfriando'),
          'quem era muito interessado e parou de responder está esfriando');
select ok(exists (select 1 from app.imova_mesa_agora() m
                   where m.conversation_id = pg_temp.id('c') and m.situacao = 'promessa'
                     and m.porque = 'Prometido: Mandar as fotos do AP1362'),
          'a promessa vencida da equipe entra, com o que foi prometido');
select ok(not exists (select 1 from app.imova_mesa_agora() m
                       where m.conversation_id = pg_temp.id('b') and m.situacao = 'esperando'),
          'quem já teve resposta não está esperando');

-- =====================================================================
-- 5. O conselheiro
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'public.ia_conselheiro_lead_gravar(uuid,jsonb,bigint,text)', 'execute')
          and not has_function_privilege('authenticated', 'public.ia_conselheiro_lead_entrada(uuid)', 'execute'),
          'as portas do conselheiro não são do usuário');
select ok(has_function_privilege('service_role', 'public.ia_conselheiro_lead_entrada(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.ia_conselheiro_imovel_gravar(text,jsonb,bigint,text)', 'execute'),
          'são do worker');
select pg_temp.dele(pg_temp.id('a'), now() - interval '119 minutes', 'meu outro número é (84) 99999-1234, ana@exemplo.com');
select ok(public.ia_conselheiro_lead_entrada(pg_temp.id('a')) -> 'carteira' @> '[{"codigo": "AP1360_IMOVA"}]'
          and public.ia_conselheiro_lead_entrada(pg_temp.id('a')) -> 'sinais' @> '[{"codigo": "AP1360_IMOVA", "origem": "codigo_na_mensagem"}]',
          'a entrada leva a carteira e os sinais de imóvel');
select ok(public.ia_conselheiro_lead_entrada(pg_temp.id('a'))::text not like '%99999-1234%'
          and public.ia_conselheiro_lead_entrada(pg_temp.id('a'))::text not like '%ana@exemplo.com%',
          'telefone e e-mail não vão ao modelo');
select is(public.ia_conselheiro_lead_entrada(pg_temp.id('nada')), null, 'conversa que não é lead não tem entrada');
select is(public.ia_conselheiro_lead_gravar(pg_temp.id('a'),
  '{"imoveis": [{"codigo": "AP1360_IMOVA", "nivel": "interessado", "perguntas": ["condomínio", "vaga"]},
                {"codigo": "NAO_EXISTE", "nivel": "muito", "perguntas": []}],
    "perfil": {"finalidade": "compra", "tipos": ["casa", "castelo"], "bairros": ["Tirol"], "quartos_min": 3,
               "valor_max": 480000, "pagamento": "financiamento"},
    "situacao": "Pediu visita ao AP1360.", "falar": "Ofereça sábado às 10h ou às 16h.", "dadosInsuficientes": false}'::jsonb,
  null, 'conselheiro-do-lead@v1') ->> 'imoveis', '1', 'grava só o imóvel que está na carteira');
select is((select c.perfil from public.ia_conselho_do_lead c where c.conversation_id = pg_temp.id('a')),
          '{"finalidade": "compra", "tipos": ["casa"], "bairros": ["Tirol"], "quartos_min": 3, "valor_max": 480000, "pagamento": "financiamento"}'::jsonb,
          'o perfil em números fica só com o que é válido');
select ok(exists (select 1 from app.imova_interesses() i
                   where i.conversation_id = pg_temp.id('a') and i.codigo = 'AP1360_IMOVA'
                     and i.origem = 'ia' and i.nivel = 'interessado'),
          'a leitura do conselheiro vale sobre o sinal');
select is((select m.fazer from app.imova_mesa_agora() m where m.conversation_id = pg_temp.id('a') and m.situacao = 'esperando'),
          'Ofereça sábado às 10h ou às 16h.', 'a fila usa o que o conselheiro mandou falar');
select ok(exists (select 1 from app.imova_mesa_agora() m
                   where m.conversation_id = pg_temp.id('a') and m.situacao = 'combina' and m.codigo = 'CA1361_IMOVA'),
          'o perfil acha o imóvel que combina e ninguém mandou');
select ok(app.imova_perguntas_do_imovel('AP1360_IMOVA') @> '[{"tema": "condomínio", "leads": 1}]',
          'as perguntas do lead viram as perguntas do imóvel');
select pg_temp.nossa(pg_temp.id('a'), now() - interval '1 minute', 'Olha também a CA1361, no Tirol');
select ok(not exists (select 1 from app.imova_mesa_agora() m
                       where m.conversation_id = pg_temp.id('a') and m.situacao = 'combina'),
          'mandou o código do imóvel: sai de "combina"');
select is(public.ia_conselheiro_imovel_gravar('AP1360_IMOVA',
  '{"sugestoes": [{"tipo": "falar", "acao": "Comece pelo condomínio", "porque": "É a pergunta nº 1."},
                  {"tipo": "prometer", "acao": "Dê 10% de desconto", "porque": "x"}], "dadosInsuficientes": false}'::jsonb)
          ->> 'sugestoes', '1', 'do imóvel, só sugestão de falar ou fazer');
select ok(public.ia_conselheiro_imovel_entrada('AP1360_IMOVA') -> 'leads' @> '[{"nivel": "interessado"}]'
          and public.ia_conselheiro_imovel_entrada('AP1360_IMOVA')::text not like '%Ana 136%',
          'a entrada do imóvel leva os leads sem nome');
select ok(app.ia_conselheiro_enfileirar('lead') >= 2, 'a fila pega os leads com mensagem nova');
select is(app.ia_conselheiro_enfileirar('lead'), 0, 'pedir de novo não enfileira de novo');
select pg_temp.virar('komune');
select is(app.ia_conselheiro_enfileirar('lead'), 0, 'na KOMUNE o conselheiro nunca liga');
select pg_temp.virar('imova');

-- =====================================================================
-- 6. A juíza grava a lacuna
-- =====================================================================
select public.ia_juiza_gravar(pg_temp.id('a'), current_date,
  '{"duvida": 4, "informacao": 3, "satisfacao": 5, "interesse": "subiu", "lacuna": "condominio_iptu"}'::jsonb);
select is((select n.lacuna from public.ia_atendimento_notas n where n.conversation_id = pg_temp.id('a') and n.dia = current_date),
          'condominio_iptu', 'a juíza grava a lacuna');
select public.ia_juiza_gravar(pg_temp.id('a'), current_date, '{"duvida": 4, "lacuna": "qualquer"}'::jsonb);
select is((select n.lacuna from public.ia_atendimento_notas n where n.conversation_id = pg_temp.id('a') and n.dia = current_date),
          null, 'lacuna fora da lista vira nula');

-- =====================================================================
-- 7 a 10. Premissas, quem vê, as leituras e o WhatsApp
-- =====================================================================
create temp table t136_msgs as select count(*)::int as n from public.messages;
grant select on t136_msgs to authenticated;

select pg_temp.entrar('a0000000-0000-4000-8000-000000013601'::uuid, 'gestor');
select is(public.relatorio_imova_premissas_salvar(5, 1, 8) ->> 'meta_mes', '8', 'o gestor ajusta as premissas');
select throws_ok($$select public.relatorio_imova_premissas_salvar(50, 1, 8)$$, '22023', null,
                 'comissão fora de 0,5% a 20% não passa');
select is((public.relatorio_imova_painel_oportunidades() -> 'premissas' ->> 'comissao_venda_pct')::numeric, 5::numeric,
          'as premissas salvas valem na conta');
select ok(public.relatorio_imova_painel_visao(null, null)
            ?& array['kpis', 'sugestoes', 'previsao', 'premissas', 'imoveis', 'funil', 'ia', 'mesa'],
          'a visão geral traz as oito partes');
select ok(public.relatorio_imova_painel_imoveis(null, null) ?& array['kpis', 'imoveis', 'conselho_em']
          and public.relatorio_imova_painel_imoveis(null, null) -> 'imoveis' @> '[{"codigo": "AP1360_IMOVA", "interessado": 1}]',
          'imóveis traz o ranking com o lead interessado');
select ok(public.relatorio_imova_painel_imovel('AP1360_IMOVA', null, null)
            ?& array['imovel', 'funil', 'semanas', 'leads', 'sugestoes', 'perguntas', 'objecoes']
          and jsonb_array_length(public.relatorio_imova_painel_imovel('AP1360_IMOVA', null, null) -> 'semanas') = 8,
          'o detalhe do imóvel traz as partes e 8 semanas');
select ok(public.relatorio_imova_painel_funil(null, null)
            ?& array['kpis', 'previsao', 'funil', 'velocidade', 'perguntas', 'objecoes', 'perdas', 'equipe', 'ia', 'mensagens'],
          'funil e equipe traz as partes');
select ok(public.relatorio_imova_painel_ia() ?& array['semanas', 'versoes', 'kpis', 'lacunas', 'passagem'],
          'o progresso da IA traz as partes');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000013602'::uuid, 'sdr');
select throws_ok($$select public.relatorio_imova_premissas_salvar(6, 1, null)$$, '42501', null,
                 'o SDR lê, mas não muda as premissas');
select ok(public.relatorio_imova_painel_oportunidades() ? 'fila', 'o SDR vê as oportunidades');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-000000013603'::uuid, 'embaixador');
select throws_ok($$select public.relatorio_imova_painel_oportunidades()$$, '42501', null, 'o embaixador não vê');
select pg_temp.sair();

select is((select count(*)::int from public.messages), (select n from t136_msgs),
          'nenhuma leitura grava mensagem');
-- Conta contra a mesa de agora, e não contra um número fixo: no fim do teste só
-- b (esfriando) e c (promessa) seguem parados — a equipe respondeu a "a" — e um
-- banco com outras conversas tem mais (o "≥ 3" antigo só passava assim).
select is((app.relatorio_imova_fotografar_mesa() ->> 'leads')::int,
          (select count(distinct m.conversation_id)::int from app.imova_mesa_agora() m),
          'a foto da noite conta um lead por oportunidade parada');
select ok(exists (select 1 from public.relatorio_imova_mesa_dia d
                       where d.dia = (now() at time zone 'America/Fortaleza')::date
                         and array[pg_temp.id('b'), pg_temp.id('c')] <@ d.conversas),
          'e guarda quais leads (o que esfriou e o da promessa)');

select * from finish();
rollback;

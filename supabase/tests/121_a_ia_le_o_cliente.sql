-- =====================================================================
-- pgTAP — A IA lê o cliente (migração 20261104110000)
--
-- Decisões do usuário em 03/11/2026: Claude Haiku 5.5; a próxima ação da IA
-- vai direto para a ficha, marcada como da IA; teto de US$ 10 por mês. Este
-- arquivo prova:
--
--   1. O PREÇO do Haiku 5.5 existe e a conta do banco fecha com ele;
--   2. A ENTRADA da leitura acha o negócio pela ficha (a conversa não aponta
--      para ele), dá as etapas de trabalho do funil do cliente, o caminho por
--      elas, a atitude, o ritmo das respostas e o perfil já lido;
--   3. A PRÓXIMA AÇÃO DA IA entra no lugar da regra, marcada como da IA, com a
--      hora da regra quando a IA não deu uma;
--   4. FATO NOVO devolve a vez à regra: mensagem nova, etapa que mudou;
--   5. O QUE NÃO VALE: leitura com confiança baixa, leitura de outro prompt;
--   6. A MANUAL de gente continua vencendo a IA até um fato novo;
--   7. O WHATSAPP NÃO MUDA.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(25);

insert into public.allowed_users (email, role, note) values ('h121.g@teste.local', 'gestor', 'pgTAP 121');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000012101'::uuid, 'h121.g@teste.local', '{"full_name":"Gil Gestor"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999912000"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
insert into public.categories (slug, name, "group", priority, position, komune_category_key, is_active)
values ('comprador', 'Comprador', 'producao', 1, 900, null, true)
on conflict (slug) do update set is_active = true;
insert into public.app_settings (key, value, description)
values ('ficha_automatica', '{"ligada": true}'::jsonb, 'pgTAP 121')
on conflict (key) do update set value = excluded.value;

create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;
select pg_temp.virar('imova');

create temp table t120(chave text primary key, valor uuid);
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t120 where chave = p_chave
$$;
create function pg_temp.conversa(p_chave text, p_tel text, p_nome text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999912000', p_tel, p_nome,
          'a0000000-0000-4000-8000-000000012101'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t120 values (p_chave, v);
  return v;
end $$;
create function pg_temp.dele(p_chave text, p_conv uuid, p_em timestamptz, p_texto text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_texto, 'system', 'crm', p_em)
  returning id into v;
  insert into t120 values (p_chave, v);
  return v;
end $$;
create function pg_temp.nossa(p_conv uuid, p_em timestamptz) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'pgtap120 nossa', 'human', 'echo', 'a0000000-0000-4000-8000-000000012101'::uuid,
          'wamid.PGTAP120.' || gen_random_uuid(), p_em, p_em)
$$;
create function pg_temp.negocio(p_conv uuid) returns uuid language sql stable as $$
  select d.id from public.deals d
   where d.organization_id = (select organization_id from public.conversations where id = p_conv)
   order by d.created_at limit 1
$$;
create function pg_temp.acao(p_conv uuid) returns text language sql stable as $$
  select d.next_action from public.deals d where d.id = pg_temp.negocio(p_conv)
$$;
create function pg_temp.autor(p_conv uuid) returns text language sql stable as $$
  select a.regra || '|' || a.autor from public.proximas_acoes_automaticas a
   where a.deal_id = pg_temp.negocio(p_conv)
$$;
-- A leitura como o worker a grava: o mesmo `app.ia_gravar_ficha`, com o uuid real.
create function pg_temp.ler(p_conv uuid, p_msg uuid, p_acao text, p_confianca numeric,
                            p_prompt text default 'leitura-do-cliente@v1') returns void language sql as $$
  select app.ia_gravar_ficha(p_conv, jsonb_build_object(
    'resumo', 'Quer apartamento de 3 quartos em Ponta Negra e pediu visita.',
    'intencao', 'PEDIU_VISITA', 'scoreIntencao', 76,
    'motivo', 'Pediu visita e informou orçamento.', 'sentimento', 'positivo',
    'sinais', jsonb_build_array(jsonb_build_object('tipo', 'pediu_visita', 'polaridade', 'positivo',
                                 'forca', 'forte', 'messageId', p_msg, 'trecho', 'dá para ver sábado?')),
    'objecoes', '[]'::jsonb, 'alertas', '["pediu_visita"]'::jsonb,
    'dadosExtraidos', jsonb_build_array(
       jsonb_build_object('campo', 'bairros', 'valor', 'Ponta Negra', 'confianca', 0.9, 'messageId', p_msg),
       jsonb_build_object('campo', 'quartos', 'valor', '3', 'confianca', 0.9, 'messageId', p_msg)),
    'compromissosNovos', '[]'::jsonb, 'compromissosCumpridos', '[]'::jsonb,
    'proximaAcao', jsonb_build_object('descricao', p_acao, 'prazo', null),
    'confianca', p_confianca, 'dadosInsuficientes', false), null, p_prompt, p_msg)
$$;

create temp table t120_base as
  select (select count(*) from public.messages where direction = 'out'::app.msg_direction) as saidas,
         (select count(*) from pgmq.q_wa_outbound) as fila;

-- =====================================================================
-- 1. O preço
-- =====================================================================
select is((select entrada::text || '|' || saida::text from public.ai_model_prices where model = 'claude-haiku-5-5'),
  '0.1000|0.5000', 'o Haiku 5.5 tem preço publicado');
select is(app.ai_custo('claude-haiku-5-5', 1000000, 1000000, 0, 0, false), 0.6::numeric,
  'um milhão de tokens de entrada e um de saída custam US$ 0,60');

-- =====================================================================
-- 2. A entrada
-- =====================================================================
select pg_temp.conversa('a', '+5584999912001', 'Lucas Andrade');
select pg_temp.dele('a1', pg_temp.id('a'), now() - interval '20 minutes',
                    'Vi o apartamento de 3 quartos em Ponta Negra. Dá para ver sábado?');
select app.fichas_automaticas_rodar(200);

create temp table t120_e as select app.ia_entrada_do_cliente(pg_temp.id('a')) as e;
select is((select e ->> 'existe' from t120_e), 'true', 'a entrada existe');
select is((select (e ->> 'deal_id')::uuid from t120_e), pg_temp.negocio(pg_temp.id('a')),
  'o negócio é achado pela ficha, mesmo com a conversa sem negócio');
select is((select e ->> 'funil' from t120_e), 'cliente', 'é do funil de clientes');
select is((select e ->> 'etapa' from t120_e), 'Respondeu', 'na etapa em que está');
select ok((select not (e -> 'etapas_validas') ? 'Identificado'
                  and not (e -> 'etapas_validas') ? 'Perdido'
                  and (e -> 'etapas_validas') ? 'Respondeu' from t120_e),
  'as etapas válidas são as de trabalho: sem a de entrada e sem as de saída');
select is((select e -> 'historico_etapas' -> -1 ->> 'etapa' from t120_e), 'Respondeu',
  'o caminho pelas etapas termina na de agora');
select is((select e -> 'ritmo' ->> 'quem_falou_por_ultimo' from t120_e), 'cliente',
  'o ritmo diz quem falou por último');
select is((select (e -> 'ritmo' ->> 'mensagens_do_cliente')::int from t120_e), 1, 'e quantas de cada lado');
select ok((select e ? 'atitude' and e -> 'atitude' ? 'objecoes_abertas' from t120_e),
  'a atitude e as objeções marcadas vão junto');

-- =====================================================================
-- 3. A próxima ação da IA no lugar da regra
-- =====================================================================
select is(pg_temp.acao(pg_temp.id('a')), 'Responder a mensagem', 'antes da leitura, a regra');
select pg_temp.ler(pg_temp.id('a'), pg_temp.id('a1'),
                   'Confirmar a visita ao apartamento de Ponta Negra no sábado', 0.9);
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('a')), 'Confirmar a visita ao apartamento de Ponta Negra no sábado',
  'depois da leitura, a próxima ação é a da IA');
select is(pg_temp.autor(pg_temp.id('a')), 'leitura_da_ia|ia', 'marcada como da IA');
select is((select d.next_action_at from public.deals d where d.id = pg_temp.negocio(pg_temp.id('a'))),
  (select created_at from public.messages where id = pg_temp.id('a1')),
  'sem prazo da IA, a hora é a da regra (a mensagem esperando resposta)');
select is((select e -> 'perfil_anterior' from (select app.ia_entrada_do_cliente(pg_temp.id('a')) as e) x),
  '[{"campo": "bairros", "valor": "Ponta Negra"}, {"campo": "quartos", "valor": "3"}]'::jsonb,
  'a próxima leitura recebe o perfil que esta achou');

-- =====================================================================
-- 4. Fato novo devolve a vez à regra
-- =====================================================================
select pg_temp.dele('a2', pg_temp.id('a'), now() - interval '1 minute', 'E tem vaga de garagem?');
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('a')), 'Responder a mensagem',
  'o cliente escreveu depois da leitura: a regra responde na hora');
select is(pg_temp.autor(pg_temp.id('a')), 'responder|regra', 'e a marca volta a ser da regra');

select pg_temp.ler(pg_temp.id('a'), pg_temp.id('a2'), 'Responder sobre a garagem e confirmar sábado', 0.9);
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('a')), 'Responder sobre a garagem e confirmar sábado',
  'a IA relê e volta a escrever');

update public.ficha_da_conversa set updated_at = now() - interval '1 hour'
 where conversation_id = pg_temp.id('a');
update public.deals
   set stage_id = (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
                    where p.slug = 'produtor' and s.slug = 'nutricao')
 where id = pg_temp.negocio(pg_temp.id('a'));
select app.fichas_automaticas_rodar(200);
select isnt(pg_temp.autor(pg_temp.id('a')), 'leitura_da_ia|ia',
  'a etapa mudou depois da leitura: a IA não vale mais até reler');

-- =====================================================================
-- 5. O que não vale
-- =====================================================================
select pg_temp.conversa('b', '+5584999912002', 'Bia');
select pg_temp.dele('b1', pg_temp.id('b'), now() - interval '20 minutes', 'Oi, tudo bem?');
select app.fichas_automaticas_rodar(200);
select pg_temp.ler(pg_temp.id('b'), pg_temp.id('b1'), 'Ação que a IA não tem certeza', 0.3);
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('b')), 'Responder a mensagem', 'leitura com confiança baixa não vale');
select pg_temp.ler(pg_temp.id('b'), pg_temp.id('b1'), 'Ação da ficha da KOMUNE', 0.9, 'ficha-da-conversa@v1');
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('b')), 'Responder a mensagem', 'nem a leitura de outro prompt');

-- =====================================================================
-- 6. A manual de gente vence a IA
-- =====================================================================
select pg_temp.ler(pg_temp.id('b'), pg_temp.id('b1'), 'Perguntar o que ela procura', 0.9);
update public.deals set next_action = 'Ligar à tarde', next_action_at = now() + interval '3 hours'
 where id = pg_temp.negocio(pg_temp.id('b'));
select app.fichas_automaticas_rodar(200);
select is(pg_temp.acao(pg_temp.id('b')), 'Ligar à tarde', 'a próxima ação escrita por gente fica, mesmo com leitura nova');

-- =====================================================================
-- 7. O WhatsApp não muda
-- =====================================================================
select is((select count(*) from public.messages m where m.direction = 'out'::app.msg_direction
            and m.body is distinct from 'pgtap120 nossa'),
  (select saidas from t120_base), 'nenhuma mensagem de saída nasceu');
select is((select count(*) from pgmq.q_wa_outbound), (select fila from t120_base),
  'e nada entrou na fila de saída do WhatsApp');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — CRM Inteligente, Fase 2: o Pulso do dia (migração 20260917120000)
--
-- O que este arquivo prova:
--   1. Os números do dia são apurados em SQL, no fuso de Natal — e o modelo os
--      recebe prontos. Se esta conta estiver errada, o digest mente com a
--      autoridade de um número.
--   2. A ORDEM das conversas é a regra do produto: compromisso que NÓS vencemos
--      primeiro, depois janela fechando, depois quem pediu proposta.
--   3. A data por extenso sai em português, sem depender do locale do servidor.
--   4. Regerar o Pulso cria VERSÃO nova: o que a equipe leu às 18h30 continua lá.
--   5. Com o módulo desligado, ninguém enfileira nada.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(16);

create function pg_temp.conversa(p_peer text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.conversations where peer_phone_e164 = p_peer
$$;
create function pg_temp.ligar_pulso(p_ligado boolean) returns void language sql security definer set search_path = '' as $$
  update public.app_settings
     set value = jsonb_set(value, '{modulos,pulso}', to_jsonb(p_ligado))
   where key = 'ia.crm_inteligente'
$$;
create function pg_temp.entrada() returns jsonb language sql security definer set search_path = '' as $$
  select app.ia_pulso_entrada()
$$;

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999995000"')
 where key = 'whatsapp.envio';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

-- ---------- 1. a data por extenso ----------
select is(app.ia_dia_por_extenso('2026-09-17'::date), 'quinta-feira, 17 de setembro de 2026',
  'a data sai em português, e não no locale do servidor');
select is(app.ia_dia_por_extenso('2026-01-04'::date), 'domingo, 04 de janeiro de 2026',
  'domingo e janeiro também');

-- ---------- 2. três conversas, três motivos diferentes ----------
-- O banco de teste já tem conversas da seed: o que se mede aqui é a DIFERENÇA
-- que estas três fazem, não o total do mundo.
create table pg_temp.base as select app.ia_pulso_entrada() -> 'metricas' as m;

set role service_role;
select public.wa_entrada_registrar('wamid.F50.1', '+5584999995000', '+5584988885001', 'text', 'tudo bem?');
select public.wa_entrada_registrar('wamid.F50.2', '+5584999995000', '+5584988885002', 'text', 'me manda a proposta');
select public.wa_entrada_registrar('wamid.F50.3', '+5584999995000', '+5584988885003', 'text', 'oi');
reset role;

-- A primeira tem promessa NOSSA vencida; a segunda pediu proposta; a terceira nada.
insert into public.compromissos_da_conversa (conversation_id, quem, o_que, prazo, status)
values (pg_temp.conversa('+5584988885001'), 'equipe', 'Mandar a simulação da taxa',
        now() - interval '2 hours', 'aberto');

insert into public.ficha_da_conversa (conversation_id, resumo, score_intencao, alertas, dados_insuficientes)
values (pg_temp.conversa('+5584988885002'), 'Pediu proposta com data.', 88,
        array['pediu_proposta'], false),
       (pg_temp.conversa('+5584988885003'), 'Só cumprimentou.', 10, '{}', true);

-- ---------- 3. os números ----------
select is(((pg_temp.entrada() -> 'metricas') ->> 'mensagensRecebidas')::int
          - (select (m ->> 'mensagensRecebidas')::int from pg_temp.base), 3,
  'as três mensagens recebidas hoje entram na conta');
select is(((pg_temp.entrada() -> 'metricas') ->> 'compromissosVencidos')::int, 1,
  'e o compromisso vencido também — é o número que manda alguém agir');
select is(((pg_temp.entrada() -> 'metricas') ->> 'janelasFechandoEm24h')::int
          - (select (m ->> 'janelasFechandoEm24h')::int from pg_temp.base), 3,
  'as três janelas de 24 h que elas abriram contam');
select is(((pg_temp.entrada() -> 'metricas') ->> 'reunioesMarcadas')::int
          - (select (m ->> 'reunioesMarcadas')::int from pg_temp.base), 0,
  'e nenhuma reunião nova foi marcada por elas');

-- ---------- 4. a ordem é a regra do produto ----------
select is(pg_temp.entrada() -> 'conversas' -> 0 ->> 'compromissoVencido', 'Mandar a simulação da taxa',
  'a conversa com promessa NOSSA vencida vem primeiro');
select is(pg_temp.entrada() -> 'conversas' -> 1 ->> 'scoreIntencao', '88',
  'depois vem quem pediu proposta — e não quem só cumprimentou');
select is((select count(*)::int from jsonb_array_elements(pg_temp.entrada() -> 'conversas') c
            where c ->> 'conversationId' in (
              pg_temp.conversa('+5584988885001')::text,
              pg_temp.conversa('+5584988885002')::text,
              pg_temp.conversa('+5584988885003')::text)), 3,
  'as três conversas do dia entram na lista');
select ok((pg_temp.entrada() -> 'conversas' -> 0 ->> 'leadId') like 'lead-%',
  'o modelo recebe lead-xxxxxx, nunca o nome do parceiro');
select is(pg_temp.entrada() -> 'conversas' -> 1 ->> 'resumo', 'Pediu proposta com data.',
  'e o resumo que a ficha escreveu entra como está');

-- ---------- 5. gravar e regerar ----------
select ok(app.ia_gravar_pulso('2026-09-17'::date, 'equipe', null,
  jsonb_build_object('titulo','Uma proposta atrasada','texto','O dia teve movimento.',
    'prioridades', jsonb_build_array(jsonb_build_object('leadId','lead-1','porque','x','acao','y','urgencia','hoje')),
    'riscos','[]'::jsonb,'diaSemMovimento',false),
  pg_temp.entrada() -> 'metricas', null, 'pulso-do-dia@v1') is not null,
  'o Pulso é gravado');
select is((select versao from public.pulso_do_dia where dia = '2026-09-17' order by versao desc limit 1), 1,
  'e nasce na versão 1');

select ok(app.ia_gravar_pulso('2026-09-17'::date, 'equipe', null,
  jsonb_build_object('titulo','Outra leitura','texto','Regerado.',
    'prioridades','[]'::jsonb,'riscos','[]'::jsonb,'diaSemMovimento',false),
  '{}'::jsonb, null, 'pulso-do-dia@v1') is not null, 'regerar não falha');
select is((select count(*)::int from public.pulso_do_dia where dia = '2026-09-17'), 2,
  'regerar cria versão NOVA: o que a equipe leu às 18h30 continua existindo');

-- ---------- 6. a bandeira manda ----------
select pg_temp.ligar_pulso(false);
select is(app.ia_enfileirar_pulso('2026-09-17'::date), 0,
  'com o módulo desligado, ninguém enfileira nada — e ninguém paga Sonnet por engano');

select * from finish();
rollback;

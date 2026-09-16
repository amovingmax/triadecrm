-- =====================================================================
-- pgTAP — CRM Inteligente, Fase 1 (migração 20260917100000)
--
-- O que este arquivo prova:
--   1. As cinco tabelas existem, com RLS ligada e a mesma visibilidade da conversa.
--   2. O DEBOUNCE: mensagem carimba a conversa como pendente; a conversa só fica
--      madura depois do silêncio (ou do teto, em conversa contínua); número interno
--      e módulo desligado não produzem trabalho.
--   3. A fila aceita os propósitos novos e continua recusando o que ninguém executa.
--   4. Enfileirar é idempotente pela janela: a mesma conversa, sem mensagem nova,
--      não vira duas chamadas pagas.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(23);

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
create function pg_temp.conversa(p_peer text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.conversations where peer_phone_e164 = p_peer
$$;
create function pg_temp.madura(p_peer text) returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from app.ia_conversas_para_analisar(50) c
                  where c.conversation_id = pg_temp.conversa(p_peer))
$$;
create function pg_temp.ligar_ficha(p_ligado boolean) returns void language sql security definer set search_path = '' as $$
  update public.app_settings
     set value = jsonb_set(value, '{modulos,ficha}', to_jsonb(p_ligado))
   where key = 'ia.crm_inteligente'
$$;
create function pg_temp.internos(p_numeros jsonb) returns void language sql security definer set search_path = '' as $$
  update public.app_settings
     set value = jsonb_set(value, '{ficha,numeros_internos}', p_numeros)
   where key = 'ia.crm_inteligente'
$$;

-- ---------- 1. as tabelas ----------
select has_table('public', 'ficha_da_conversa', 'a ficha da conversa existe');
select has_table('public', 'compromissos_da_conversa', 'os compromissos existem');
select has_table('public', 'pulso_do_dia', 'o Pulso do dia existe');
select has_table('public', 'sugestoes_de_campo', 'as sugestões de campo existem');
select has_table('public', 'feedback_da_ia', 'o feedback existe');
select is((select count(*)::int from pg_tables
            where schemaname = 'public'
              and tablename in ('ficha_da_conversa','compromissos_da_conversa','pulso_do_dia',
                                'sugestoes_de_campo','feedback_da_ia')
              and rowsecurity), 5, 'as cinco nascem com RLS ligada');

-- A temperatura continua sendo uma só: nada de tabela paralela (GATE 0, conflito 4.2).
select hasnt_table('public', 'ai_temperature_history',
  'não existe um segundo histórico de temperatura: a do banco continua sendo a única');

-- ---------- 2. os propósitos ----------
select lives_ok($$ select app.ia_enfileirar('analisar_conversa', '{"conversation_id":"x"}'::jsonb, 'k1') $$,
  'a fila aceita analisar_conversa');
select lives_ok($$ select app.ia_enfileirar('pulso_do_dia', '{"dia":"2026-09-17"}'::jsonb, 'k2') $$,
  'a fila aceita pulso_do_dia');
select throws_ok($$ select app.ia_enfileirar('inventar_coisa', '{}'::jsonb, 'k3') $$,
  '22023', NULL, 'e continua recusando propósito que ninguém executa');
select lives_ok($$
  insert into public.ai_runs (purpose, model, prompt_version, status, tokens_in, tokens_out, cost_usd)
  values ('analisar_conversa', 'claude-haiku-4-5', 'ficha-da-conversa@v1', 'ok', 10, 10, 0.0001) $$,
  'ai_runs aceita o propósito novo (é por ele que o custo é agrupado)');

-- ---------- 3. gente e conversa ----------
insert into public.allowed_users (email, role, note) values
  ('f48.sdr@teste.local', 'sdr', 'pgTAP ficha'),
  ('f48.emb@teste.local', 'embaixador', 'pgTAP ficha');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-00000000f481', 'f48.sdr@teste.local', '{"full_name":"Sdr F48"}'),
  ('a0000000-0000-4000-8000-00000000f482', 'f48.emb@teste.local', '{"full_name":"Embaixador F48"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999994800"')
 where key = 'whatsapp.envio';
select pg_temp.ligar_ficha(true);
select pg_temp.internos('["+5584988884899"]'::jsonb);

set role service_role;
select public.wa_entrada_registrar('wamid.F48.1', '+5584999994800', '+5584988884801', 'text', 'Oi, tenho interesse');
select public.wa_entrada_registrar('wamid.F48.2', '+5584999994800', '+5584988884899', 'text', 'teste interno');
reset role;

-- ---------- 4. o debounce ----------
select isnt((select ia_pendente_desde from public.conversations where peer_phone_e164 = '+5584988884801'),
  null, 'a mensagem carimba a conversa como pendente');
select ok(not pg_temp.madura('+5584988884801'),
  'conversa que acabou de falar NÃO está madura: o debounce existe para não analisar no meio da frase');

-- Envelhece a conversa: 15 minutos de silêncio.
update public.conversations
   set last_message_at = now() - interval '15 minutes',
       ia_pendente_desde = now() - interval '15 minutes'
 where peer_phone_e164 in ('+5584988884801', '+5584988884899');

select ok(pg_temp.madura('+5584988884801'), 'depois do silêncio, ela amadurece');
select ok(not pg_temp.madura('+5584988884899'),
  'número interno não vira ficha, por mais que fale');

select pg_temp.ligar_ficha(false);
select ok(not pg_temp.madura('+5584988884801'),
  'com o módulo desligado, nada amadurece — ligar é update, não deploy');
select pg_temp.ligar_ficha(true);

-- Conversa contínua: fala sem parar, mas o teto de 30 min a torna madura.
update public.conversations
   set last_message_at = now() - interval '1 minute',
       ia_pendente_desde = now() - interval '45 minutes'
 where peer_phone_e164 = '+5584988884801';
select ok(pg_temp.madura('+5584988884801'),
  'em conversa contínua, o teto de 30 min manda: ninguém fica sem ficha por falar demais');

-- ---------- 5. enfileirar é idempotente pela janela ----------
select is((select app.ia_enfileirar_analises(10)), 1, 'a conversa madura vira UM trabalho');
select is((select app.ia_enfileirar_analises(10)), 0,
  'e a mesma janela não vira um segundo: chamada repetida é dinheiro repetido');

set role service_role;
select public.wa_entrada_registrar('wamid.F48.3', '+5584999994800', '+5584988884801', 'text', 'e aí, conseguem?');
reset role;
update public.conversations set last_message_at = now() - interval '15 minutes',
       ia_pendente_desde = now() - interval '15 minutes'
 where peer_phone_e164 = '+5584988884801';
select is((select app.ia_enfileirar_analises(10)), 1,
  'mensagem nova abre janela nova, e aí sim vale analisar de novo');

-- ---------- 6. a visibilidade é a da conversa ----------
insert into public.ficha_da_conversa (conversation_id, resumo, score_intencao, dados_insuficientes)
values (pg_temp.conversa('+5584988884801'), 'Fornecedor com interesse declarado.', 62, false);

select pg_temp.entrar('a0000000-0000-4000-8000-00000000f481', 'sdr');
select is((select count(*)::int from public.ficha_da_conversa), 1,
  'quem enxerga a conversa enxerga a ficha dela');
-- Sem policy de UPDATE, a RLS não levanta exceção: ela simplesmente não deixa
-- nenhuma linha ser alcançada. O que se prova é o efeito, não o erro.
update public.ficha_da_conversa set resumo = 'eu que escrevo';
select is((select count(*)::int from public.ficha_da_conversa where resumo = 'eu que escrevo'), 0,
  'e não escreve na ficha: quem escreve é o worker');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-00000000f482', 'embaixador');
select is((select count(*)::int from public.ficha_da_conversa), 0,
  'embaixador fora da carteira não vê a ficha, como não vê a conversa');
select pg_temp.sair();

select * from finish();
rollback;

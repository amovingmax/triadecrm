-- =====================================================================
-- pgTAP — O que o CRM mandou sozinho (migração 20261002190000)
--
-- POR QUE
-- Rafael, 28/09/2026: "onde e como vemos as mensagens que foram enviadas
-- automáticas? como tá esse processo? deixe isso organizado". Hoje a mensagem
-- automática é distinguível DENTRO da conversa (`mensagem-do-fio.tsx` mostra
-- "Texto fixo do robô" e "Rascunho da IA") e INVISÍVEL fora dela: para saber o
-- que o robô mandou ontem, só abrindo conversa por conversa.
--
-- O RECORTE, E POR QUE NÃO É author_kind in ('bot_fixed','bot_ai')
-- A confirmação de opt-out é `system` (20260905000300:802) — e é justamente a
-- que mais precisa ser auditável, porque é a prova de que o guardrail do
-- CLAUDE.md funcionou. O cumprimento da campanha é `human`, assinado por quem
-- disparou (20260915130000), e já tem tela em /envios. O recorte honesto é
-- `direction = 'out' and author_kind <> 'human'`, e as asserções 2 e 3 são as
-- duas metades dessa frase.
--
-- O QUE ACONTECEU DEPOIS, SEM O QUAL ISTO É LOG
-- Duas colunas independentes, e não um rótulo: `respondeu_em` (a primeira
-- entrada do lead DEPOIS daquela mensagem) e `gente_falou_em` (a primeira saída
-- de gente depois dela). Um rótulo único perderia o caso que importa —
-- respondeu e ninguém falou. As asserções 4 a 7 medem as duas e a forma delas.
--
-- O RELÓGIO É CONGELADO. pgTAP roda o arquivo numa transação e `now()` não anda.
-- Toda mensagem cujo carimbo precisa ser POSTERIOR a outra o recebe explícito.
-- É a mesma armadilha que a 20261002150000:154-160 documentou.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(8);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
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

-- ---------- o ambiente ----------
-- O RELÓGIO É DO TESTE. A introdução só sai dentro do horário (regra 0b de
-- `app.wa_introduzir`); sem esta sobrescrita a asserção 1 quebraria toda vez que
-- a suíte rodasse à noite ou no domingo. Mesmo recurso do 83 e do 87.
create table pg_temp.relogio (aberto boolean);
insert into pg_temp.relogio values (true);
create or replace function app.janela_do_canal(p_channel app.channel, p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', (select aberto from pg_temp.relogio),
                            'motivo', 'fora_do_horario',
                            'abre_em', now() + interval '10 hours', 'fecha_em', null)
$$;

insert into public.allowed_users (email, role, note) values
  ('h91.sdr@teste.local',        'sdr',        'pgTAP o que saiu sozinho'),
  ('h91.embaixador@teste.local', 'embaixador', 'pgTAP o que saiu sozinho');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000009101'::uuid, 'h91.sdr@teste.local',        '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000009102'::uuid, 'h91.embaixador@teste.local', '{"full_name":"Edu Embaixador"}');

create function pg_temp.sdr()        returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000009101'::uuid $$;
create function pg_temp.embaixador() returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000009102'::uuid $$;
create function pg_temp.modelo(p_codigo text) returns int language sql stable as $$
  select id from public.message_templates where template_code = p_codigo
$$;

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999999100"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = jsonb_set(jsonb_set(value, '{inicio}', '"2026-01-01"'), '{whatsapp,depois}', '100')
 where key = 'cadencia.tetos';
-- A INTRODUÇÃO FICA LIGADA — e é a diferença em relação ao molde do 87, que a
-- desliga (87:92-99). Sem ela, nenhuma `GEN-SYS-INTRO` existiria e a asserção 1
-- mediria o vazio. Os outros automatismos ficam desligados: cada um escreveria
-- saída na conversa por conta própria e mudaria a contagem.
update public.app_settings
   set value = value || '{"lead_automatico": false, "distribuicao_automatica": false,
                          "introducao_ativa": true, "ausencia_ativa": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
update public.message_templates set meta_status = 'approved' where template_code like 'GEN-ABR-OLA-%';

create function pg_temp.conversa_de_campanha(p_tel text, p_dono uuid default null)
returns uuid language plpgsql as $$
declare v_org uuid; v_conv uuid;
begin
  insert into public.organizations (name, phone_e164, source_id, collector, neighborhood)
  values ('Buffet do pgTAP 91 ' || p_tel, p_tel,
          (select id from public.sources where slug = 'planilha'), 'pgtap91', 'Tirol')
  returning id into v_org;
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, app.wa_numero_padrao(), p_tel, v_org,
          coalesce(p_dono, pg_temp.sdr()), 'aguardando_parceiro')
  returning id into v_conv;
  -- O CUMPRIMENTO DA CAMPANHA: author_kind = 'human', assinado por quem disparou,
  -- como public.wa_enviar_modelo o grava (20260915130000:338-341). É a asserção 3.
  insert into public.messages (conversation_id, direction, type, status, body, template_id,
                               author_kind, sent_by, origin, created_at, sent_at)
  values (v_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'Bom dia!', pg_temp.modelo('GEN-ABR-OLA-MANHA'), 'human', coalesce(p_dono, pg_temp.sdr()),
          'crm', now() - interval '2 hours', now() - interval '2 hours');
  return v_conv;
end $$;

create function pg_temp.chegou(p_tel text, p_texto text, p_quando timestamptz default now())
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  perform public.wa_entrada_registrar('wamid91.' || md5(p_tel || p_texto || p_quando::text),
                                      app.wa_numero_padrao(), p_tel, 'text', p_texto,
                                      null, null, p_quando, null);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Uma saída de GENTE. `p_quando` explícito porque `now()` é congelado: sem ele a
-- linha nasceria com o mesmo instante da introdução e o `>` estrito daria falso.
create function pg_temp.saiu(p_tel text, p_texto text,
                             p_quando timestamptz default now())
returns void language plpgsql as $$
begin
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, sent_by, origin, created_at)
  values ((select id from public.conversations where peer_phone_e164 = p_tel),
          'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status, p_texto,
          'human', pg_temp.sdr(), 'crm', p_quando);
end $$;

-- A conversa que vai render a introdução automática.
select pg_temp.conversa_de_campanha('+5584999999101');
select pg_temp.chegou('+5584999999101', 'Tenho interesse');

-- =====================================================================
-- 1 a 3 · O RECORTE
-- =====================================================================
select is((select count(*)::int from public.mensagens_automaticas()
            where modelo = 'GEN-SYS-INTRO'), 1,
  'a introdução automática aparece no feed: é ela que o Rafael vai conferir todo dia para saber se o fluxo está se comportando');

-- A confirmação de opt-out, que só existe se alguém pedir para sair. Sem este
-- disparo a asserção 2 mediria o vazio.
select pg_temp.conversa_de_campanha('+5584999999102');
select pg_temp.chegou('+5584999999102', 'quero sair da lista');
select public.wa_optout_registrar(
  (select id from public.conversations where peer_phone_e164 = '+5584999999102'),
  'pgTAP 91: regra "sair"');

select is((select autor from public.mensagens_automaticas()
            where modelo = 'GEN-SYS-OPTOUT'), 'system',
  'a confirmação de opt-out entra, e ela é author_kind = system: é por isso que o recorte é author_kind <> human e não in (bot_fixed, bot_ai)');

select is((select count(*)::int from public.mensagens_automaticas()
            where modelo like 'GEN-ABR-OLA-%'), 0,
  'o cumprimento da campanha fica FORA: ele é human, assinado por quem disparou, e já tem a tela de /envios com respondeu por item');

-- =====================================================================
-- 4 a 7 · O QUE ACONTECEU DEPOIS
-- =====================================================================
select pg_temp.chegou('+5584999999101', 'Pode explicar sim', now() + interval '1 minute');
select isnt((select respondeu_em from public.mensagens_automaticas()
              where modelo = 'GEN-SYS-INTRO'), null,
  'o feed diz que o lead voltou a falar DEPOIS daquela mensagem: sem isso é log, e log ninguém lê');

select is((select gente_falou_em from public.mensagens_automaticas()
            where modelo = 'GEN-SYS-INTRO'), null,
  'e ANTES de alguém assumir a coluna é nula: respondeu e ninguém falou é o caso que um rótulo único perderia, e é o único em que alguém precisa agir');

select pg_temp.saiu('+5584999999101', 'Oi! Sou a Sara.', now() + interval '2 minutes');
select isnt((select gente_falou_em from public.mensagens_automaticas()
              where modelo = 'GEN-SYS-INTRO'), null,
  'respondeu e assumiu são DUAS colunas independentes: é o cruzamento das duas que mostra o fluxo parando no terceiro passo');

-- 7 · respondeu_em é a PRIMEIRA entrada DEPOIS daquela mensagem, e não a última
-- da conversa inteira. A diferença aparece assim que o lead escreve de novo.
select pg_temp.chegou('+5584999999101', 'Alô?', now() + interval '30 minutes');
select is((select respondeu_em from public.mensagens_automaticas()
            where modelo = 'GEN-SYS-INTRO'),
  (select min(i.created_at) from public.messages i
     join public.conversations c on c.id = i.conversation_id
    where c.peer_phone_e164 = '+5584999999101'
      and i.direction = 'in'::app.msg_direction
      and i.created_at > (select m.created_at from public.messages m
                           where m.conversation_id = c.id
                             and m.template_id = pg_temp.modelo('GEN-SYS-INTRO'))),
  'respondeu_em é a PRIMEIRA resposta depois daquela mensagem: last_inbound_at da conversa marcaria "respondeu" em toda automática antiga de conversa viva, com um carimbo que pode ser resposta a outra coisa');

-- =====================================================================
-- 8 · A RLS NÃO É FURADA PORQUE A FUNÇÃO É DEFINER
-- =====================================================================
select pg_temp.entrar(pg_temp.embaixador(), 'embaixador');
select is((select count(*)::int from public.mensagens_automaticas()), 0,
  'o embaixador não lê o que a RLS não lhe mostra: definer é para poder fazer o join com conversations, não para furar conversations_select — que a função repete por escrito');
select pg_temp.sair();

select * from finish();
rollback;

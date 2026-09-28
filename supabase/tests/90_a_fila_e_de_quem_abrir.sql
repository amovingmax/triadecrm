-- =====================================================================
-- pgTAP — A fila de quem respondeu é de quem abrir (migração 20261002180000)
--
-- POR QUE
-- Rafael, 28/09/2026: "estamos com operadores reduzidos que nem logam às vezes".
-- A fila que subiu ontem (20261002150000) é filtrada por `assignee_id`, e com a
-- distribuição desligada (20261002170000) o dono passou a ser quase sempre o
-- mesmo perfil. As duas coisas juntas escondem a resposta do lead atrás de um
-- nome, e o nome não abre o CRM. A fila passa a ser de quem PUDER atender.
--
-- QUEM É "PODE ATENDER", E POR QUE O CRITÉRIO É O BANCO
-- Responder é `insert` em `public.messages`, e `messages_insert`
-- (20260905000200:1691-1704) exige `app.can_write()` E que a conversa passe no
-- mesmo recorte de `conversations_select` (:720). Para admin, gestor e sdr,
-- `app.sees_all()` (20260904000500:46) já resolve as duas coisas — o `sdr` NÃO
-- tem RLS estreita em `conversations`; quem é estreito é o embaixador. Para
-- `leitura` e `financeiro`, `can_write()` é falso: pôr item na fila de quem o
-- banco vai recusar é mandar trabalhar e depois dizer não.
--
-- O EMBAIXADOR, DESCRITO COMO ELE É
-- Ele continua recebendo `app.conversas_esperando_gente(v_alvo)` — as conversas
-- ENDEREÇADAS A ELE. Isso não é "a carteira dele": uma conversa de uma ficha da
-- carteira, endereçada a outra pessoa, não entra (asserção 4 mede os dois casos).
-- Alargar para a carteira exigiria um segundo recorte dentro da função, e
-- ninguém pediu isso.
--
-- O QUE EVITA DUAS PESSOAS NA MESMA CONVERSA: O QUE JÁ EXISTE (asserção 6)
-- `conversas_esperando_gente` exige que a última palavra seja do lead. Quem
-- responde vira a última palavra nossa, e a conversa sai da fila DE TODO MUNDO.
-- Sem lock, sem reserva — complexidade que o time de hoje não precisa.
--
-- O RELÓGIO É CONGELADO. pgTAP roda o arquivo inteiro numa transação e `now()`
-- não anda. Por isso `pg_temp.saiu` ganhou `p_quando`: sem empurrar o carimbo,
-- toda comparação estrita de `created_at` entre duas mensagens deste arquivo
-- daria falso. É a mesma armadilha que a 20261002150000:154-160 documentou ao
-- escolher o `<` estrito.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(7);

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
insert into public.allowed_users (email, role, note) values
  ('h90.sdr@teste.local',        'sdr',         'pgTAP fila de todos'),
  ('h90.outra@teste.local',      'sdr',         'pgTAP fila de todos'),
  ('h90.gestor@teste.local',     'gestor',      'pgTAP fila de todos'),
  ('h90.embaixador@teste.local', 'embaixador',  'pgTAP fila de todos'),
  ('h90.leitura@teste.local',    'leitura',     'pgTAP fila de todos');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000009001'::uuid, 'h90.sdr@teste.local',        '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000009002'::uuid, 'h90.outra@teste.local',      '{"full_name":"Ana Outra"}'),
  ('a0000000-0000-4000-8000-000000009003'::uuid, 'h90.gestor@teste.local',     '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000009004'::uuid, 'h90.embaixador@teste.local', '{"full_name":"Edu Embaixador"}'),
  ('a0000000-0000-4000-8000-000000009005'::uuid, 'h90.leitura@teste.local',    '{"full_name":"Lia Leitura"}');

create function pg_temp.sdr()        returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000009001'::uuid $$;
create function pg_temp.outra()      returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000009002'::uuid $$;
create function pg_temp.gestor()     returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000009003'::uuid $$;
create function pg_temp.embaixador() returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000009004'::uuid $$;
create function pg_temp.leitura()    returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000009005'::uuid $$;
create function pg_temp.modelo(p_codigo text) returns int language sql stable as $$
  select id from public.message_templates where template_code = p_codigo
$$;

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999999000"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = jsonb_set(jsonb_set(value, '{inicio}', '"2026-01-01"'), '{whatsapp,depois}', '100')
 where key = 'cadencia.tetos';
-- Todo automatismo desligado: cada um escreveria uma saída na conversa e mudaria
-- a resposta da fila por conta própria. Mesma escolha do 87:92-99.
update public.app_settings
   set value = value || '{"lead_automatico": false, "distribuicao_automatica": false,
                          "introducao_ativa": false, "ausencia_ativa": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
update public.message_templates set meta_status = 'approved' where template_code like 'GEN-ABR-OLA-%';

-- A ficha, com dono explícito: é o `owner_id` que faz `app.org_is_mine` dizer
-- "esta é do embaixador" (20260904000500).
create function pg_temp.org(p_tel text, p_dono uuid default null) returns uuid language sql as $$
  insert into public.organizations (name, phone_e164, source_id, collector, neighborhood, owner_id)
  values ('Buffet do pgTAP 90 ' || p_tel, p_tel,
          (select id from public.sources where slug = 'planilha'), 'pgtap90', 'Tirol', p_dono)
  returning id
$$;

-- A conversa de campanha, no molde do 87:104-136. O cumprimento é assinado por
-- `p_dono` porque `app.messages_quem_responde_atende` (20260914100000) passa a
-- conversa para quem mandou a última mensagem nossa — assinar por outra pessoa
-- faria a fixture contar uma história que a produção não conta.
create function pg_temp.conversa_de_campanha(p_tel text, p_dono uuid default null,
                                             p_org uuid default null)
returns uuid language plpgsql as $$
declare v_conv uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, app.wa_numero_padrao(), p_tel, p_org,
          coalesce(p_dono, pg_temp.sdr()), 'aguardando_parceiro')
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, template_id,
                               author_kind, sent_by, origin, created_at, sent_at)
  values (v_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'Bom dia!', pg_temp.modelo('GEN-ABR-OLA-MANHA'), 'human', coalesce(p_dono, pg_temp.sdr()),
          'crm', now() - interval '2 hours', now() - interval '2 hours');
  return v_conv;
end $$;

-- A chegada do lead, pelo mesmo caminho do webhook da Meta.
create function pg_temp.chegou(p_tel text, p_texto text, p_quando timestamptz default now())
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  perform public.wa_entrada_registrar('wamid90.' || md5(p_tel || p_texto || p_quando::text),
                                      app.wa_numero_padrao(), p_tel, 'text', p_texto,
                                      null, null, p_quando, null);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Uma saída nossa. `p_quando` é NOVO em relação ao 87: pgTAP roda tudo numa
-- transação e `now()` é CONGELADO — sem poder empurrar o carimbo, a saída nasce
-- com o mesmo instante da entrada e nenhuma comparação estrita funcionaria.
create function pg_temp.saiu(p_tel text, p_texto text, p_modelo text default null,
                             p_status app.msg_status default 'sent'::app.msg_status,
                             p_quem uuid default null,
                             p_quando timestamptz default now())
returns void language plpgsql as $$
begin
  insert into public.messages (conversation_id, direction, type, status, body, template_id,
                               author_kind, sent_by, origin, created_at)
  values ((select id from public.conversations where peer_phone_e164 = p_tel),
          'out'::app.msg_direction, 'text'::app.msg_type, p_status, p_texto,
          case when p_modelo is null then null else pg_temp.modelo(p_modelo) end,
          'human', coalesce(p_quem, pg_temp.sdr()), 'crm', p_quando);
end $$;

-- Quantas linhas de conversa a fila do dia de alguém tem, e o que a linha diz.
create function pg_temp.conversas_na_fila(p_de_quem uuid) returns int language sql stable as $$
  select count(*)::int from public.meu_dia(p_de_quem, 300) where tipo = 'conversa_esperando'
$$;

-- =====================================================================
-- 1 a 3 · A CONVERSA DE OUTRA PESSOA APARECE, E A LINHA DIZ DE QUEM É
-- =====================================================================
select pg_temp.conversa_de_campanha('+5584999999001', pg_temp.outra());
select pg_temp.chegou('+5584999999001', 'Tenho interesse sim');

select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is((select count(*)::int from public.meu_dia(pg_temp.sdr(), 300)
            where tipo = 'conversa_esperando'
              and organization_id is null
              and titulo like 'Responder%'), 1,
  'a conversa endereçada a OUTRA pessoa aparece para quem abre: com operadores que nem logam, o item preso a um nome é um item invisível');

select is((select atendente from public.meu_dia(pg_temp.sdr(), 300)
            where tipo = 'conversa_esperando' and organization_id is null), 'Ana',
  'e a linha DIZ a quem a conversa aponta: o dono continua existindo, e esconder isso seria mentir por omissão');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.outra(), 'sdr');
select is((select atendente from public.meu_dia(pg_temp.outra(), 300)
            where tipo = 'conversa_esperando' and organization_id is null), null,
  'e cala quando a conversa já é minha: "endereçada a mim" em toda linha da minha fila é um rótulo que a pessoa aprende a não ler');
select pg_temp.sair();

-- =====================================================================
-- 4 · O EMBAIXADOR: SÓ AS CONVERSAS ENDEREÇADAS A ELE, NÃO A CARTEIRA
-- =====================================================================
-- Duas fichas dele. Na primeira a conversa é dele; na segunda, a ficha é dele e
-- a conversa aponta para outra pessoa. Um `count = 0` solto não provaria nada:
-- a asserção precisa mostrar que a primeira entra e a segunda não.
select pg_temp.conversa_de_campanha('+5584999999002', pg_temp.embaixador(),
                                    pg_temp.org('+5584999999002', pg_temp.embaixador()));
select pg_temp.chegou('+5584999999002', 'Sou eu de novo');
select pg_temp.conversa_de_campanha('+5584999999003', pg_temp.outra(),
                                    pg_temp.org('+5584999999003', pg_temp.embaixador()));
select pg_temp.chegou('+5584999999003', 'Oi, tudo bem?');

select pg_temp.entrar(pg_temp.embaixador(), 'embaixador');
select is((select string_agg(coalesce(organizacao, '(sem ficha)'), ' | ' order by organizacao)
             from public.meu_dia(pg_temp.embaixador(), 300) where tipo = 'conversa_esperando'),
  'Buffet do pgTAP 90 +5584999999002',
  'o embaixador vê só as conversas ENDEREÇADAS A ELE — a ficha da carteira endereçada a outra pessoa NÃO entra: é a carteira que não é o recorte, e dizer o contrário seria escrever no comentário o que o SQL não faz');
select pg_temp.sair();

-- =====================================================================
-- 5 · LEITURA NÃO RECEBE TRABALHO QUE O BANCO VAI RECUSAR
-- =====================================================================
select pg_temp.entrar(pg_temp.leitura(), 'leitura');
select is((select count(*)::int from public.meu_dia(pg_temp.leitura(), 300)
            where tipo = 'conversa_esperando'), 0,
  'leitura não recebe a fila: messages_insert exige app.can_write(), que é falso para ela — pôr item na fila de quem o banco vai recusar é mandar trabalhar e depois dizer não');
select pg_temp.sair();

-- =====================================================================
-- 6 · DUAS PESSOAS NÃO SE ATROPELAM, SEM LOCK NENHUM
-- =====================================================================
-- Quem responde vira a última palavra nossa, e a conversa sai da fila de TODO
-- MUNDO. O carimbo é empurrado porque `now()` é congelado na transação.
select pg_temp.saiu('+5584999999001', 'Oi! Sou a Sara, já te explico.', null, 'sent',
                    pg_temp.sdr(), now() + interval '2 minutes');

select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is((select count(*)::int from public.meu_dia(pg_temp.gestor(), 300)
            where tipo = 'conversa_esperando' and organization_id is null), 0,
  'quem responde tira a conversa da fila de TODO MUNDO, e é isto que dispensa reserva e lock: a última palavra voltou a ser nossa');
select pg_temp.sair();

-- =====================================================================
-- 7 · DOIS FIOS DA MESMA FICHA, COM ATENDENTES DIFERENTES, RENDEM UMA LINHA
-- =====================================================================
-- O defeito que só aparece sem filtro: `distinct on (q.de_quem, ...)` deduplicava
-- DENTRO de cada pessoa, porque o WHERE por `de_quem` rodava antes. Sem filtro,
-- dois fios da mesma ficha com donos diferentes renderiam duas linhas — a mesma
-- chave de React duas vezes.
select pg_temp.conversa_de_campanha('+5584999999004', pg_temp.sdr(),
                                    pg_temp.org('+5584999999004'));
select pg_temp.conversa_de_campanha('+5584999999005', pg_temp.outra(),
                                    (select organization_id from public.conversations
                                      where peer_phone_e164 = '+5584999999004'));
select pg_temp.chegou('+5584999999004', 'Oi');
select pg_temp.chegou('+5584999999005', 'Oi de novo');

select is((select count(*)::int from app.conversas_esperando_gente()
            where organization_id = (select organization_id from public.conversations
                                      where peer_phone_e164 = '+5584999999004')), 1,
  'dois fios da mesma ficha com atendentes DIFERENTES rendem UMA linha: de_quem saiu da chave do distinct on, que é o defeito que só a fila sem filtro revela');

select * from finish();
rollback;

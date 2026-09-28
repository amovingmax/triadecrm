-- =====================================================================
-- pgTAP — Quem respondeu entra no Meu dia (migração 20261002150000)
--
-- POR QUE ESTE ARQUIVO EXISTE
-- Rafael, 28/09/2026: "como o atendente saberá que é pra alguém assumir a
-- conversa?". Não saberia. A campanha manda "Bom dia!", o lead responde, a
-- introdução automática sai sozinha 8 a 14 s depois (ADR-16) — e a partir dali
-- quem fala tem de ser gente. Só que `public.meu_dia` é feita de TAREFA e
-- NEGÓCIO, e não lê `conversations`: se ninguém abrir a tela de Conversas por
-- conta própria, o lead que respondeu fica esperando.
--
-- O DEFEITO QUE ESTE ARQUIVO MEDE ANTES DE CONSERTAR
-- A aba "Responderam" perguntava por `conversations.status = 'aguardando_nos'`,
-- e essa coluna NÃO É MANTIDA. `app.messages_after_write`, na entrada, faz:
--
--     status = case when status = 'resolvida' then 'aguardando_nos' else status end
--
-- A conversa de campanha nasce 'aguardando_parceiro' (`public.wa_enviar_modelo`)
-- e CONTINUA 'aguardando_parceiro' depois que o lead responde. Ou seja: a aba
-- que existia para avisar estava vazia justamente para o caso de maior volume
-- que o CRM tem. É por isso que a fila nova pergunta pela última MENSAGEM, e
-- não pelo status — e as duas primeiras asserções deste arquivo passam desde o
-- primeiro dia, porque elas medem o defeito, não o conserto.
--
-- O OUTRO DEFEITO, ACHADO NO CAMINHO
-- `app.is_suppressed_target(org, contato)` devolve `false` quando os dois são
-- nulos — que é exatamente a conversa de quem escreveu de FORA DA BASE. Quem
-- pediu SAIR e não tem ficha entraria na fila. Quem enxerga o telefone é
-- `app.wa_motivo_de_recusa`, e é ele que a fila usa (asserção 6).
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(27);

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
-- `app.wa_introduzir`); sem esta sobrescrita as asserções 11 a 14 quebrariam
-- toda vez que a suíte rodasse à noite ou no domingo. Mesmo recurso do 83.
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
  ('h87.sdr@teste.local',      'sdr',    'pgTAP fila de quem respondeu'),
  ('h87.gestor@teste.local',   'gestor', 'pgTAP fila de quem respondeu'),
  ('h87.suplente@teste.local', 'sdr',    'pgTAP fila de quem respondeu'),
  ('h87.saiu@teste.local',     'sdr',    'pgTAP fila de quem respondeu');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000008701'::uuid, 'h87.sdr@teste.local',      '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000008702'::uuid, 'h87.gestor@teste.local',   '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000008703'::uuid, 'h87.suplente@teste.local', '{"full_name":"Ana Suplente"}'),
  ('a0000000-0000-4000-8000-000000008704'::uuid, 'h87.saiu@teste.local',     '{"full_name":"Zeca Saiu"}');

create function pg_temp.sdr()      returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000008701'::uuid $$;
create function pg_temp.gestor()   returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000008702'::uuid $$;
create function pg_temp.suplente() returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000008703'::uuid $$;
create function pg_temp.zeca()     returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000008704'::uuid $$;
create function pg_temp.modelo(p_codigo text) returns int language sql stable as $$
  select id from public.message_templates where template_code = p_codigo
$$;

-- O setor que recebe quando o dono da conversa é desativado (asserção 16).
insert into public.setor_membros (setor_id, profile_id) values (1, pg_temp.suplente());

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999998700"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = jsonb_set(jsonb_set(value, '{inicio}', '"2026-01-01"'), '{whatsapp,depois}', '100')
 where key = 'cadencia.tetos';
-- Os automatismos ficam DESLIGADOS até a asserção 11: cada um deles escreveria
-- uma saída na conversa e mudaria a resposta da fila por conta própria.
update public.app_settings
   set value = value || '{"lead_automatico": false, "distribuicao_automatica": false,
                          "introducao_ativa": false, "ausencia_ativa": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
update public.message_templates set meta_status = 'approved' where template_code like 'GEN-ABR-OLA-%';

-- A conversa de campanha: nasce 'aguardando_parceiro' e levou um cumprimento há
-- 2 h, exatamente como `public.wa_enviar_modelo` a grava.
create function pg_temp.conversa_de_campanha(p_tel text, p_dono uuid default null,
                                             p_com_ficha boolean default true,
                                             p_org uuid default null,
                                             p_setor int default null)
returns uuid language plpgsql as $$
declare v_org uuid; v_conv uuid;
begin
  -- QUEM DISPARA, ATENDE: `app.messages_quem_responde_atende` (20260914100000)
  -- passa a conversa para quem mandou a última mensagem nossa. Por isso o
  -- cumprimento é assinado por `p_dono`, e não por uma pessoa qualquer — senão a
  -- fixture contaria uma história que a produção não conta.
  if p_org is not null then
    v_org := p_org;
  elsif p_com_ficha then
    -- `public.organizations.collector` é not null mas tem preenchimento
    -- automático (20260904000300); passar explícito continua válido.
    insert into public.organizations (name, phone_e164, source_id, collector, neighborhood)
    values ('Buffet do pgTAP 87 ' || p_tel, p_tel,
            (select id from public.sources where slug = 'planilha'), 'pgtap87', 'Tirol')
    returning id into v_org;
  end if;
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                    assignee_id, setor_id, status)
  values ('whatsapp'::app.channel, app.wa_numero_padrao(), p_tel, v_org,
          coalesce(p_dono, pg_temp.sdr()), p_setor, 'aguardando_parceiro')
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, template_id,
                               author_kind, sent_by, origin, created_at, sent_at)
  values (v_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'Bom dia!', pg_temp.modelo('GEN-ABR-OLA-MANHA'), 'human', coalesce(p_dono, pg_temp.sdr()),
          'crm', now() - interval '2 hours', now() - interval '2 hours');
  return v_conv;
end $$;

-- Um negócio aberto na ficha, para a linha da fila carregar funil e etapa.
create function pg_temp.negocio(p_org uuid) returns uuid language sql as $$
  insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
  values (p_org, 1, (select id from public.stages where pipeline_id = 1 and slug = 'contatado'),
          pg_temp.sdr())
  returning id
$$;

-- A chegada do lead, pelo mesmo caminho do webhook da Meta.
create function pg_temp.chegou(p_tel text, p_texto text, p_quando timestamptz default now())
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  perform public.wa_entrada_registrar('wamid87.' || md5(p_tel || p_texto || p_quando::text),
                                      app.wa_numero_padrao(), p_tel, 'text', p_texto,
                                      null, null, p_quando, null);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Uma saída nossa, na conversa daquele telefone. `p_modelo` nulo é texto livre
-- de gente — o caso que o `coalesce(x.template_id, -1)` da definição cobre.
create function pg_temp.saiu(p_tel text, p_texto text, p_modelo text default null,
                             p_status app.msg_status default 'sent'::app.msg_status)
returns void language plpgsql as $$
begin
  insert into public.messages (conversation_id, direction, type, status, body, template_id,
                               author_kind, sent_by, origin)
  values ((select id from public.conversations where peer_phone_e164 = p_tel),
          'out'::app.msg_direction, 'text'::app.msg_type, p_status, p_texto,
          case when p_modelo is null then null else pg_temp.modelo(p_modelo) end,
          'human', pg_temp.sdr(), 'crm');
end $$;

-- =====================================================================
-- 1 e 2 · O DEFEITO, MEDIDO. As duas passam antes do conserto.
-- =====================================================================
select pg_temp.conversa_de_campanha('+5584999998701');
select pg_temp.negocio((select organization_id from public.conversations
                         where peer_phone_e164 = '+5584999998701'));
select pg_temp.chegou('+5584999998701', 'Tenho interesse sim');

select is((select status from public.conversations where peer_phone_e164 = '+5584999998701'),
  'aguardando_parceiro',
  'a resposta do lead NÃO troca o status: por isso a aba Responderam está vazia, e por isso a fila pergunta pela última MENSAGEM');
select is((select unread_count from public.conversations where peer_phone_e164 = '+5584999998701'),
  1, 'o que muda de verdade é o não lido — e ninguém olha o não lido de manhã');

-- =====================================================================
-- 3 a 17 · A DEFINIÇÃO: quem está esperando gente
-- =====================================================================
create function pg_temp.espera(p_tel text) returns boolean language sql stable as $$
  select exists (select 1 from app.conversas_esperando_gente() e
                   join public.conversations c on c.id = e.conversation_id
                  where c.peer_phone_e164 = p_tel)
$$;
create function pg_temp.de_quem(p_tel text) returns uuid language sql stable as $$
  select e.de_quem from app.conversas_esperando_gente() e
    join public.conversations c on c.id = e.conversation_id
   where c.peer_phone_e164 = p_tel
$$;

select ok(pg_temp.espera('+5584999998701'),
  'e ESTÁ esperando: a última palavra é do lead, mesmo com o status parado em aguardando_parceiro');

-- 4 · gente respondeu depois da entrada
select pg_temp.conversa_de_campanha('+5584999998702');
select pg_temp.chegou('+5584999998702', 'Quero saber mais');
select pg_temp.saiu('+5584999998702', 'Oi! Já te explico com calma.');
select ok(not pg_temp.espera('+5584999998702'),
  'quem já foi respondido por gente sai da fila, mesmo com o status parado');

-- 5 · a ausência não é resposta
select pg_temp.conversa_de_campanha('+5584999998703');
select pg_temp.chegou('+5584999998703', 'Boa noite, tenho interesse');
select pg_temp.saiu('+5584999998703', 'Nosso horário é de 8h às 18h.', 'GEN-SYS-AUSENCIA');
select ok(pg_temp.espera('+5584999998703'),
  'a ausência automática NÃO conta como resposta: quem escreve 21h40 tem de estar lá na manhã seguinte');

-- 6 · quem pediu SAIR e não tem ficha fica de fora
select pg_temp.conversa_de_campanha('+5584999998704', null, false);
select pg_temp.chegou('+5584999998704', 'Tenho interesse');
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex(app.normalize_phone_br('+5584999998704')), 'phone', 'pgTAP 87');
select ok(not pg_temp.espera('+5584999998704'),
  'quem pediu SAIR e não tem ficha fica FORA: app.is_suppressed_target não enxerga telefone, app.wa_motivo_de_recusa enxerga');

-- 7 · conversa resolvida
select pg_temp.conversa_de_campanha('+5584999998705');
select pg_temp.chegou('+5584999998705', 'Obrigado!');
update public.conversations set status = 'resolvida' where peer_phone_e164 = '+5584999998705';
select ok(not pg_temp.espera('+5584999998705'),
  'conversa dada por resolvida sai da fila: alguém já disse que acabou');

-- 8 e 9 · adiada, e de volta quando o carimbo vence
select pg_temp.conversa_de_campanha('+5584999998706');
select pg_temp.chegou('+5584999998706', 'Me chama semana que vem');
update public.conversations set snoozed_until = now() + interval '3 days'
 where peer_phone_e164 = '+5584999998706';
select ok(not pg_temp.espera('+5584999998706'),
  'conversa adiada fica de fora: adiar é uma decisão explícita de alguém, e a fila do dia a respeita');
update public.conversations set snoozed_until = now() - interval '1 minute'
 where peer_phone_e164 = '+5584999998706';
select ok(pg_temp.espera('+5584999998706'),
  'e volta sozinha quando o adiamento vence');

-- 10 · quem escreveu de fora da base
select pg_temp.conversa_de_campanha('+5584999998707', null, false);
select pg_temp.chegou('+5584999998707', 'Vi o app de vocês');
select is((select e.organization_id from app.conversas_esperando_gente() e
             join public.conversations c on c.id = e.conversation_id
            where c.peer_phone_e164 = '+5584999998707'), null,
  'quem escreveu de FORA DA BASE entra, com organização nula: é o caso que mais some hoje');

-- ---------------------------------------------------------------------
-- 11 a 14 · a introdução automática, que a fila não pode atropelar
-- ---------------------------------------------------------------------
update public.app_settings set value = value || '{"introducao_ativa": true}'::jsonb
 where key = 'atendimento';

select pg_temp.conversa_de_campanha('+5584999998708');
select pg_temp.chegou('+5584999998708', 'Tenho interesse');
select ok((select introducao_em is not null from public.conversations
            where peer_phone_e164 = '+5584999998708'),
  'a introdução saiu');
select ok(not pg_temp.espera('+5584999998708'),
  'e a conversa NÃO entra na fila: mandar responder no mesmo segundo seria pedir para a pessoa atropelar o robô');

-- 13 · a resposta À INTRODUÇÃO entra. O carimbo vem um minuto à frente porque
-- dentro de uma transação `now()` não anda — em produção são os 8 a 14 s do
-- sorteio que separam a introdução da próxima palavra do lead.
select pg_temp.chegou('+5584999998708', 'Pode explicar sim', now() + interval '1 minute');
select ok(pg_temp.espera('+5584999998708'),
  'a resposta À INTRODUÇÃO entra: daqui em diante quem fala tem de ser gente');

-- 14 · worker parado: a introdução presa na fila não pode esconder o lead
select pg_temp.conversa_de_campanha('+5584999998709');
select pg_temp.chegou('+5584999998709', 'Tenho interesse');
update public.messages set created_at = now() - interval '20 minutes'
 where conversation_id = (select id from public.conversations where peer_phone_e164 = '+5584999998709')
   and status = 'queued'::app.msg_status;
select ok(pg_temp.espera('+5584999998709'),
  'saída presa em queued há 20 min deixa de contar como resposta: mensagem que não saiu não respondeu ninguém');

update public.app_settings set value = value || '{"introducao_ativa": false}'::jsonb
 where key = 'atendimento';

-- ---------------------------------------------------------------------
-- 15 a 17 · de quem é o item, e uma linha por ficha
-- ---------------------------------------------------------------------
select is(pg_temp.de_quem('+5584999998701'), pg_temp.sdr(),
  'o item é de quem a conversa JÁ aponta (conversations.assignee_id), e nada é escrito para isso');

select pg_temp.conversa_de_campanha('+5584999998711', pg_temp.zeca(), true, null, 1);
select pg_temp.chegou('+5584999998711', 'Tenho interesse');
update public.profiles set is_active = false where id = pg_temp.zeca();
select is(pg_temp.de_quem('+5584999998711'), pg_temp.suplente(),
  'perfil desativado NÃO faz o item sumir: ele cai para quem o setor indica, senão a conversa de quem saiu da empresa vira silêncio');

-- 17 · dois fios da mesma ficha (dois telefones) rendem UMA linha
select pg_temp.conversa_de_campanha('+5584999998712');
select pg_temp.conversa_de_campanha('+5584999998713', null, true,
  (select organization_id from public.conversations where peer_phone_e164 = '+5584999998712'));
select pg_temp.chegou('+5584999998712', 'Oi');
select pg_temp.chegou('+5584999998713', 'Oi de novo');
select is((select count(*)::int from app.conversas_esperando_gente() e
            where e.organization_id = (select organization_id from public.conversations
                                        where peer_phone_e164 = '+5584999998712')),
  1, 'dois fios da mesma ficha rendem UMA linha: duas linhas iguais na tela é a mesma chave de React duas vezes');

-- =====================================================================
-- 18 a 25 · A FILA DO DIA
-- =====================================================================
-- A reunião de daqui a 2 h, que é o item mais urgente que existia antes.
insert into public.tasks (title, kind, due_at, assignee_id, organization_id, created_by)
values ('Reunião com o Buffet do pgTAP 87', 'meeting'::app.task_kind, now() + interval '2 hours',
        pg_temp.sdr(),
        (select organization_id from public.conversations where peer_phone_e164 = '+5584999998701'),
        pg_temp.gestor());

select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is((select tipo from public.meu_dia(pg_temp.sdr(), 300) limit 1), 'conversa_esperando',
  'quem respondeu é a PRIMEIRA linha da fila');
select is((select prioridade from public.meu_dia(pg_temp.sdr(), 300) limit 1), 0,
  'prioridade 0: acima até da reunião em 3 h, que tem hora reservada dos dois lados e não evapora em 24 h');
select alike((select titulo from public.meu_dia(pg_temp.sdr(), 300) limit 1), 'Responder%',
  'o título diz o que FAZER, no infinitivo, e não o estado interno');
select isnt((select etapa from public.meu_dia(pg_temp.sdr(), 300)
              where tipo = 'conversa_esperando'
                and organization_id = (select organization_id from public.conversations
                                        where peer_phone_e164 = '+5584999998701')), null,
  'a linha carrega a etapa do negócio, como as outras');

-- 23 · a reunião vem DEPOIS de todo mundo que respondeu
with ordenada as (select row_number() over () as ord, tipo from public.meu_dia(pg_temp.sdr(), 300))
select ok((select min(ord) from ordenada where tipo = 'reuniao_proxima')
          > (select max(ord) from ordenada where tipo = 'conversa_esperando'),
  'a reunião em 2 h vem depois: o relógio dela é nosso e o da conversa é de outra pessoa');
select pg_temp.sair();

-- 22 · não é fila de todo mundo
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is((select count(*)::int from public.meu_dia(pg_temp.gestor(), 300)
            where tipo = 'conversa_esperando'), 0,
  'o item NÃO aparece na fila de quem não atende a conversa: cinco pessoas na mesma conversa é a caixa compartilhada que assignee_id resolveu');
select pg_temp.sair();

-- 24 e 25 · o teto de 15, e o que ele protege
do $$
declare i int; v_tel text;
begin
  for i in 1..20 loop
    v_tel := '+55849999987' || lpad((30 + i)::text, 2, '0');
    perform pg_temp.conversa_de_campanha(v_tel);
    perform pg_temp.chegou(v_tel, 'Tenho interesse ' || i);
  end loop;
end $$;

select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select is((select count(*)::int from public.meu_dia(pg_temp.sdr(), 300)
            where tipo = 'conversa_esperando'), 15,
  'com 20 e tantas conversas esperando, o bloco 0 entrega 15: sem teto, um dia de muitas respostas empurraria o resto da fila para fora das 60 linhas da tela');
select is((select count(*)::int from public.meu_dia(pg_temp.sdr(), 300)
            where tipo = 'reuniao_proxima'), 1,
  'e a reunião continua na fila: é isso que o teto existe para proteger');
select pg_temp.sair();

-- =====================================================================
-- 26 e 27 · LER NÃO ESCREVE
-- =====================================================================
-- O retrato é tirado ANTES e guardado. Comparar dois retratos lidos depois da
-- leitura daria verde mesmo se `meu_dia` escrevesse.
create function pg_temp.retrato(p_tel text) returns text language sql stable as $$
  select c.assignee_id::text || '|' || c.status || '|' || coalesce(c.introducao_em::text, '-')
    from public.conversations c where c.peer_phone_e164 = p_tel
$$;
create table pg_temp.antes as select pg_temp.retrato('+5584999998708') as v;

select pg_temp.entrar(pg_temp.sdr(), 'sdr');
select ok((select count(*) from public.meu_dia(pg_temp.sdr(), 300)) >= 1,
  'a fila foi lida inteira, como a tela a lê');
select pg_temp.sair();

-- O `sair()` acima é necessário: a tabela temporária é do papel original, e
-- `authenticated` não a lê.
select is((select pg_temp.retrato('+5584999998708')), (select v from pg_temp.antes),
  'ler a fila NÃO dá dono, não muda status e não carimba introdução: é isso que deixa a introdução automática continuar saindo');

select * from finish();
rollback;

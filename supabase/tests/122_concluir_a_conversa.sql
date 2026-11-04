-- =====================================================================
-- pgTAP — Concluir a conversa, só na Imova (migração 20261104120000)
--
-- Pedido de 03/11/2026, para a Imova: concluir tira a conversa da lista sem
-- perder o histórico, e "assim que formos conversar novamente com esse cliente
-- devemos ter o histórico". Concluir é o arquivar de 29/09 (pgTAP 93) com duas
-- regras a mais, e este arquivo prova:
--
--   1. NA KOMUNE NADA MUDA: a chave é falsa, mensagem do time não traz a
--      conversa de volta e a concluída continua no Meu dia — como no pgTAP 93;
--   2. O WHATSAPP NÃO É TOCADO: concluir não cria mensagem, não põe nada na fila
--      de saída nem pede nada à Meta (`wa_acoes`), e o histórico fica inteiro;
--   3. CONCLUÍDA SAI DO MEU DIA na Imova, mesmo com a última palavra do cliente;
--   4. VOLTA QUANDO ALGUÉM VOLTA A CONVERSAR: a pessoa do time escrevendo traz de
--      volta; robô e modelo automático, não; o cliente escrevendo traz de volta e
--      o item do Meu dia volta junto.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(17);

insert into public.allowed_users (email, role, note) values
  ('h119.g@teste.local', 'gestor', 'pgTAP concluir');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000011901'::uuid, 'h119.g@teste.local', '{"full_name":"Gil Gestor"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999911900"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

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

-- De que empresa é o banco, trocada só dentro desta transação (a trava da
-- identidade desligada e religada, como nos pgTAP 112 e 117).
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

-- Uma conversa em que o cliente falou por último ("ok, obrigado"): é o caso
-- mais comum de concluir, e o que deixaria o Meu dia pedindo resposta.
create temp table t119(chave text primary key, valor uuid);
create function pg_temp.conversa(p_chave text, p_telefone text) returns uuid language plpgsql as $$
declare v_org uuid; v_conv uuid;
begin
  insert into public.organizations (name, phone_e164, source_id, collector)
  values ('Imóvel do pgTAP 119 ' || p_chave, p_telefone,
          (select id from public.sources where slug = 'planilha'), 'pgtap119')
  returning id into v_org;
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999911900', p_telefone, v_org,
          'a0000000-0000-4000-8000-000000011901'::uuid, 'aguardando_nos')
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'ok, obrigado', 'system', 'crm');
  insert into t119 values (p_chave, v_conv);
  return v_conv;
end $$;
grant select on t119 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t119 where chave = p_chave
$$;
create function pg_temp.concluida(p_chave text) returns boolean language sql stable as $$
  select arquivada_em is not null from public.conversations where id = pg_temp.id(p_chave)
$$;
create function pg_temp.concluir(p_chave text, p_concluir boolean default true) returns text
language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-000000011901'::uuid, 'gestor');
  v := public.conversa_arquivar(pg_temp.id(p_chave), p_concluir);
  perform pg_temp.sair();
  return v ->> 'ok';
end $$;
create function pg_temp.no_meu_dia(p_chave text) returns boolean language sql stable as $$
  select exists (select 1 from app.conversas_esperando_gente(null) e
                  where e.conversation_id = pg_temp.id(p_chave))
$$;
-- Uma saída do CRM, como o envio de verdade a grava: quem escreveu decide. O
-- robô fala por modelo aprovado (a porteira exige, RF-CON-22): o do menu, do seed.
create function pg_temp.saida(p_chave text, p_autor text) returns void language plpgsql as $$
begin
  insert into public.messages (conversation_id, direction, type, status, body,
                               template_id, author_kind, sent_by, origin)
  values (pg_temp.id(p_chave), 'out'::app.msg_direction, 'text'::app.msg_type,
          'queued'::app.msg_status, 'oi, tudo bem?',
          case when p_autor = 'bot_fixed' then
            (select t.id from public.message_templates t
              where t.template_code = 'GEN-SYS-MENU' and t.is_active) end,
          p_autor,
          case when p_autor = 'human' then 'a0000000-0000-4000-8000-000000011901'::uuid end,
          'crm');
end $$;
-- A resposta do cliente chega um minuto depois: na mesma transação ela empataria
-- com a saída do time, e o empate conta como respondida (comparação estrita de
-- `app.conversas_esperando_gente`).
create function pg_temp.entrada(p_chave text) returns void language plpgsql as $$
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind,
                               origin, created_at)
  values (pg_temp.id(p_chave), 'in'::app.msg_direction, 'text'::app.msg_type,
          'received'::app.msg_status, 'voltei, ainda tem o apartamento?', 'system', 'crm',
          now() + interval '1 minute');
end $$;

-- =====================================================================
-- 1. Na KOMUNE nada muda
-- =====================================================================
select pg_temp.virar('komune');
select pg_temp.conversa('k', '+5584999911901');

select ok(not app.concluir_ligado(), 'no banco da KOMUNE a chave de concluir é falsa');
select is(pg_temp.concluir('k'), 'true', 'arquivar continua funcionando como sempre');
select ok(pg_temp.no_meu_dia('k'),
  'e a arquivada continua no Meu dia, como era antes de concluir existir');
select pg_temp.saida('k', 'human');
select ok(pg_temp.concluida('k'),
  'mensagem do time NÃO desarquiva na KOMUNE: a regra do pgTAP 93 fica intacta');

-- =====================================================================
-- 2. Na Imova, concluir não toca o WhatsApp e não apaga nada
-- =====================================================================
select pg_temp.virar('imova');
select pg_temp.conversa('i', '+5584999911902');

create temp table t119_base as
  select (select count(*) from public.messages) as mensagens,
         (select count(*) from pgmq.q_wa_outbound) as fila,
         (select count(*) from public.wa_acoes) as acoes;

select ok(app.concluir_ligado(), 'no banco da Imova a chave de concluir é verdadeira');
select ok(pg_temp.no_meu_dia('i'),
  'antes de concluir, o "ok, obrigado" do cliente pede resposta no Meu dia');
select is(pg_temp.concluir('i'), 'true', 'quem atende conclui a conversa');
select ok(pg_temp.concluida('i'), 'e ela fica concluída');
select is((select arquivada_por from public.conversations where id = pg_temp.id('i')),
  'a0000000-0000-4000-8000-000000011901'::uuid, 'com o nome de quem concluiu');
select is(
  (select row(count(*), (select count(*) from pgmq.q_wa_outbound),
              (select count(*) from public.wa_acoes))::text from public.messages),
  (select row(mensagens, fila, acoes)::text from t119_base),
  'O WHATSAPP NÃO É TOCADO: nenhuma mensagem nova, nada na fila de saída, nenhum pedido à Meta');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.id('i')), 1,
  'e o histórico fica inteiro: a mensagem do cliente continua no fio');

-- =====================================================================
-- 3. Concluída sai do Meu dia
-- =====================================================================
select ok(not pg_temp.no_meu_dia('i'),
  'CONCLUÍDA SAI DO MEU DIA, mesmo com a última palavra do cliente');

-- =====================================================================
-- 4. Volta quando alguém volta a conversar
-- =====================================================================
select pg_temp.saida('i', 'bot_fixed');
select ok(pg_temp.concluida('i'),
  'mensagem do robô ou de modelo automático NÃO traz de volta: não é ninguém voltando a conversar');

select pg_temp.saida('i', 'human');
select ok(not pg_temp.concluida('i'),
  'a pessoa do time escreveu e a conversa VOLTOU para a lista, com o histórico');
select is((select arquivada_por from public.conversations where id = pg_temp.id('i')), null::uuid,
  'e sem o nome de quem tinha concluído');

select pg_temp.concluir('i');
select pg_temp.entrada('i');
select ok(not pg_temp.concluida('i'),
  'concluída de novo, o cliente escreveu e ela VOLTOU, como no arquivar');
select ok(pg_temp.no_meu_dia('i'), 'e o pedido de resposta volta para o Meu dia junto');

select * from finish();
rollback;

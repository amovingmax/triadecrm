-- =====================================================================
-- pgTAP — O nome que vem junto da mensagem (migração 20261002160000)
--
-- O que este arquivo prova:
--   1. O NOME É GUARDADO. A Meta manda `contacts[].profile.name` em toda
--      mensagem recebida, e até 28/09/2026 o CRM o descartava — por isso 193
--      conversas em produção se chamavam "Contato do WhatsApp (11) 5128-5383".
--   2. ELE É REAPRENDIDO. A pessoa troca o nome no WhatsApp quando quer, e o
--      que vale é o último que ela mesma pôs.
--   3. VAZIO NÃO APAGA. Mensagem sem nome (ou com espaço em branco) não pode
--      apagar o nome que já se sabia.
--   4. A FICHA NASCE COM ELE. `app.lead_automatico` batiza a ficha com o nome
--      do perfil, e só cai no "Contato do WhatsApp <número>" quando não veio
--      nome nenhum.
--   5. FICHA QUE JÁ EXISTE NÃO É RENOMEADA. Quem batiza é só o caminho de
--      criação: um fornecedor cadastrado como "Buffet Aurora" não vira o
--      apelido que a pessoa usa no WhatsApp.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(9);

-- ---------- o ambiente ----------
insert into public.allowed_users (email, role, note)
values ('h88.g@teste.local', 'gestor', 'pgTAP nome do perfil');
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000008801'::uuid, 'h88.g@teste.local', '{"full_name":"Gil Gestor"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999998800"')
 where key = 'whatsapp.envio';
-- O lead automático é o que batiza a ficha: é ele que se mede aqui.
update public.app_settings
   set value = value || '{"lead_automatico": true, "distribuicao_automatica": false,
                          "introducao_ativa": false, "ausencia_ativa": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

create function pg_temp.conversa(p_tel text) returns public.conversations
language sql stable as $$
  select * from public.conversations where peer_phone_e164 = p_tel limit 1
$$;
create function pg_temp.ficha(p_tel text) returns text language sql stable as $$
  select o.name from public.organizations o where o.phone_e164 = p_tel and o.deleted_at is null limit 1
$$;

-- =====================================================================
-- 1. O nome é guardado
-- =====================================================================
select public.wa_entrada_registrar('wamid.N88.A', '+5584999998800', '+5584900008801',
                                   'text', 'bom dia', null, null, now(), null,
                                   'Buffet Sabor do Sol');
select is((pg_temp.conversa('+5584900008801')).peer_nome, 'Buffet Sabor do Sol',
  'o nome do perfil que a Meta mandou fica guardado na conversa');

-- =====================================================================
-- 2. É reaprendido
-- =====================================================================
select public.wa_entrada_registrar('wamid.N88.B', '+5584999998800', '+5584900008801',
                                   'text', 'oi de novo', null, null, now(), null,
                                   'Sabor do Sol Eventos');
select is((pg_temp.conversa('+5584900008801')).peer_nome, 'Sabor do Sol Eventos',
  'trocou o nome no WhatsApp: o CRM aprende o novo');

-- =====================================================================
-- 3. Vazio não apaga
-- =====================================================================
select public.wa_entrada_registrar('wamid.N88.C', '+5584999998800', '+5584900008801',
                                   'text', 'terceira', null, null, now(), null, null);
select is((pg_temp.conversa('+5584900008801')).peer_nome, 'Sabor do Sol Eventos',
  'mensagem sem nome não apaga o nome que já se sabia');

select public.wa_entrada_registrar('wamid.N88.D', '+5584999998800', '+5584900008801',
                                   'text', 'quarta', null, null, now(), null, '   ');
select is((pg_temp.conversa('+5584900008801')).peer_nome, 'Sabor do Sol Eventos',
  'nome só com espaço também não apaga');

-- =====================================================================
-- 4. A ficha nasce com o nome
-- =====================================================================
select is(pg_temp.ficha('+5584900008801'), 'Buffet Sabor do Sol',
  'a ficha foi batizada com o nome do perfil que veio na PRIMEIRA mensagem');

-- E sem nome nenhum, o rótulo antigo continua sendo a saída — não um vazio.
select public.wa_entrada_registrar('wamid.N88.E', '+5584999998800', '+5584900008802',
                                   'text', 'oi', null, null, now(), null, null);
select is(pg_temp.ficha('+5584900008802'),
  'Contato do WhatsApp ' || app.telefone_legivel('+5584900008802'),
  'sem nome, a ficha continua caindo no rótulo com o número');
select is((pg_temp.conversa('+5584900008802')).peer_nome, null,
  'e a conversa fica sem nome, em vez de guardar string vazia');

-- =====================================================================
-- 5. Ficha que já existe não é renomeada
-- =====================================================================
insert into public.organizations (name, phone_e164, source_id, collector)
values ('Buffet Aurora', '+5584900008803',
        (select id from public.sources where slug = 'planilha'), 'pgtap88');
select public.wa_entrada_registrar('wamid.N88.F', '+5584999998800', '+5584900008803',
                                   'text', 'oi', null, null, now(), null,
                                   'aurora buffet 24h ⭐');
select is(pg_temp.ficha('+5584900008803'), 'Buffet Aurora',
  'o cadastro de gente vence o apelido do WhatsApp: a ficha não é renomeada');
select is((pg_temp.conversa('+5584900008803')).peer_nome, 'aurora buffet 24h ⭐',
  'mas a conversa guarda o nome do perfil assim mesmo, para quem atende ver');

select * from finish();
rollback;

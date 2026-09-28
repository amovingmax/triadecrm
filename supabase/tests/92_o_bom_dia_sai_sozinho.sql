-- =====================================================================
-- pgTAP — O "Bom dia!" sai sozinho (migração 20261002200000)
--
-- O que este arquivo prova:
--   1. DESLIGADO É DESLIGADO. Com a chave em false, aprovar ficha do Google
--      Maps não enfileira nada. Isto manda WhatsApp para gente de verdade sem
--      ninguém apertar botão: o padrão tem de ser o silêncio.
--   2. LIGADO, A APROVAÇÃO ENFILEIRA. E o lote que nasce é o da casa — sem
--      criador, sem assinante, contínuo.
--   3. SÓ O GOOGLE MAPS. Ficha de planilha não entra (decisão do Rafael,
--      28/09/2026), e quem pediu para não ser contatado também não.
--   4. A MENSAGEM NÃO TEM DONO. `author_kind = 'bot_fixed'` e `sent_by` nulo —
--      "n sai do cracha de ninguem, sai no da komune sem id".
--   5. MODELO COM VARIÁVEL É RECUSADO, porque não há quem preencha
--      `{{atendente}}` num envio que ninguém assinou.
--   6. O LOTE CONTÍNUO NÃO ACABA quando a fila esvazia — e o lote comum
--      continua acabando.
--   7. UM CONTÍNUO SÓ. Dois seriam dois cumprimentos para a mesma pessoa.
--   8. O INTERRUPTOR FUNCIONA DE VERDADE. Chave fora do laço de
--      `atendimento_configurar` é ignorada em silêncio, e o gestor clica achando
--      que ligou — foi o que já aconteceu uma vez com `introducao_ativa`.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(20);

-- ---------- o ambiente ----------
insert into public.allowed_users (email, role, note)
values ('h89.g@teste.local', 'gestor', 'pgTAP bom dia automático');
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000008901'::uuid, 'h89.g@teste.local', '{"full_name":"Gil Gestor"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999998900"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

-- A JANELA DE HORÁRIO NÃO SE AFROUXA, nem aqui. O CHECK
-- `channel_windows_teto_legal` recusa configurar fora de seg–sex 8h–19h e
-- sáb 9h–13h (R06 §3.4), e ele está certo: um teste que furasse a lei para
-- passar às 22h de domingo estaria provando o contrário do que a operação
-- assinou. Então a conversa do teste de envio abre a janela do jeito real —
-- com uma mensagem RECEBIDA. Custa uma coisa, e está dito: dentro da janela de
-- 24 h a saída não é primeiro contato, então este arquivo não afirma nada sobre
-- `is_first_contact` (quem prova essa regra é o 70).

-- Fora da janela de 24 h só passa modelo que a Meta aprovou.
update public.message_templates set meta_status = 'approved'
 where template_code like 'GEN-ABR-OLA-%';

create function pg_temp.fonte(p_slug text) returns int language sql stable as $$
  select id from public.sources where slug = p_slug
$$;
create function pg_temp.na_fila(p_org uuid) returns int language sql stable as $$
  select count(*)::int from public.envios_em_massa_itens where organization_id = p_org
$$;
create function pg_temp.lote() returns public.envios_em_massa language sql stable as $$
  select * from public.envios_em_massa where continuo limit 1
$$;

-- =====================================================================
-- 1. Desligado é desligado
-- =====================================================================
insert into public.organizations (name, phone_e164, source_id, collector)
values ('Buffet Desligado', '+5584900008901', pg_temp.fonte('google_maps_raspado'), 'pgtap89');
select is(pg_temp.na_fila((select id from public.organizations where phone_e164 = '+5584900008901')), 0,
  'com a chave desligada, ficha do Google Maps não entra em fila nenhuma');
select is((select count(*)::int from public.envios_em_massa where continuo), 0,
  'e nem sequer cria o lote contínuo');

-- =====================================================================
-- 2. Ligado, a aprovação enfileira
-- =====================================================================
update public.app_settings set value = value || '{"cumprimento_automatico": true}'::jsonb
 where key = 'atendimento';

insert into public.organizations (name, phone_e164, source_id, collector)
values ('Buffet do Maps', '+5584900008902', pg_temp.fonte('google_maps_raspado'), 'pgtap89');
select is(pg_temp.na_fila((select id from public.organizations where phone_e164 = '+5584900008902')), 1,
  'ficha aprovada do Google Maps entra na fila do cumprimento');

select is((pg_temp.lote()).assinatura, 'komune', 'o lote que nasce é o da casa');
select ok((pg_temp.lote()).criado_por is null,
  'e não tem criador: ninguém clicou para ele existir');
select ok((pg_temp.lote()).continuo, 'e é contínuo');
select ok((select assinante_id is null from public.envios_em_massa_itens
            where organization_id = (select id from public.organizations
                                      where phone_e164 = '+5584900008902')),
  'o item da fila também não tem assinante');

-- =====================================================================
-- 3. Só o Google Maps, e só quem pode ser contatado
-- =====================================================================
insert into public.organizations (name, phone_e164, source_id, collector)
values ('Buffet da Planilha', '+5584900008903', pg_temp.fonte('planilha'), 'pgtap89');
select is(pg_temp.na_fila((select id from public.organizations where phone_e164 = '+5584900008903')), 0,
  'ficha de planilha não entra: a regra é só do scraper do Google Maps');

insert into public.organizations (name, phone_e164, source_id, collector, do_not_contact)
values ('Buffet Que Pediu Para Sair', '+5584900008904', pg_temp.fonte('google_maps_raspado'),
        'pgtap89', true);
select is(pg_temp.na_fila((select id from public.organizations where phone_e164 = '+5584900008904')), 0,
  'quem pediu para não ser contatado não entra na fila, nem para ser pulado depois');

-- =====================================================================
-- 4. A mensagem não tem dono
-- =====================================================================
-- A conversa e a entrada que abre a janela de 24 h (ver o cabeçalho).
insert into public.conversations (channel, business_number, peer_phone_e164, organization_id, status)
values ('whatsapp'::app.channel, '+5584999998900', '+5584900008902',
        (select id from public.organizations where phone_e164 = '+5584900008902'),
        'aguardando_nos');
insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
select c.id, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
       'bom dia', 'system', 'crm'
  from public.conversations c where c.peer_phone_e164 = '+5584900008902';

select lives_ok($$
  select app.wa_komune_abrir((select id from public.organizations where phone_e164 = '+5584900008902'),
                             (select id from public.message_templates
                               where template_code = 'GEN-ABR-OLA-MANHA'))
$$, 'o cumprimento sai sem ninguém assinar');

select ok((select m.author_kind = 'bot_fixed' and m.sent_by is null
                  and m.type = 'template'::app.msg_type
             from public.messages m
             join public.conversations c on c.id = m.conversation_id
            where c.peer_phone_e164 = '+5584900008902' and m.direction = 'out'::app.msg_direction
            order by m.created_at desc limit 1),
  'a mensagem é do robô, sem crachá de ninguém, e sai como template');

-- =====================================================================
-- 5. Modelo com variável é recusado
-- =====================================================================
select throws_ok($$
  select app.wa_komune_abrir((select id from public.organizations where phone_e164 = '+5584900008903'),
                             (select id from public.message_templates
                               where template_code = 'GEN-ABR-PARCERIA'))
$$, '42501', null,
  'modelo com {{variável}} é recusado: não há quem preencha num envio sem assinante');

-- =====================================================================
-- 6. O contínuo espera; o comum acaba
-- =====================================================================
update public.envios_em_massa_itens set status = 'cancelada'
 where envio_id = (pg_temp.lote()).id;
update public.envios_em_massa set proximo_em = now() - interval '1 minute';

insert into public.envios_em_massa (nome, tipo, modelo_id, assinatura, por_hora, criado_por)
values ('Lote comum do pgTAP 89', 'modelo',
        (select id from public.message_templates where template_code = 'GEN-ABR-OLA-MANHA'),
        'marca', 6, 'a0000000-0000-4000-8000-000000008901'::uuid);

select lives_ok($$ select app.envios_em_massa_rodar() $$, 'o relógio roda sem explodir');
select is((pg_temp.lote()).status, 'agendado',
  'o lote contínuo com a fila vazia continua agendado — ele espera quem for aprovado depois');
select is((select status from public.envios_em_massa where nome = 'Lote comum do pgTAP 89'),
  'concluido', 'e o lote comum sem fila continua se concluindo, como sempre');

-- =====================================================================
-- 7. Um contínuo só
-- =====================================================================
select throws_ok($$
  insert into public.envios_em_massa (nome, tipo, modelo_id, assinatura, por_hora, continuo, criado_por)
  values ('Segundo contínuo', 'modelo',
          (select id from public.message_templates where template_code = 'GEN-ABR-OLA-MANHA'),
          'komune', 6, true, null)
$$, '23505', null,
  'dois lotes contínuos vivos seriam dois cumprimentos para a mesma pessoa: o banco recusa');

-- =====================================================================
-- 8. O interruptor funciona de verdade
-- =====================================================================
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

select pg_temp.entrar('a0000000-0000-4000-8000-000000008901'::uuid, 'gestor');
select is(public.atendimento_configurar('{"cumprimento_automatico": false}'::jsonb) ->> 'ok', 'true',
  'o gestor desliga o cumprimento automático pela tela');
select pg_temp.sair();
select ok(not app.atendimento_liga('cumprimento_automatico'),
  'e o desligamento CHEGA na chave — não é clique que não faz nada');

select pg_temp.entrar('a0000000-0000-4000-8000-000000008901'::uuid, 'gestor');
select is(public.atendimento_configurar('{"cumprimento_por_hora": 2}'::jsonb) ->> 'ok', 'true',
  'e o ritmo do cumprimento se muda sem deploy');
select pg_temp.sair();
select is((pg_temp.lote()).por_hora, 2,
  'o lote que JÁ estava rodando aprende o ritmo novo: pisar no freio vale para o envio em curso');

select * from finish();
rollback;

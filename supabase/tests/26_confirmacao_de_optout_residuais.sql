-- =====================================================================
-- TRIADE — pgTAP — 20260905000400: os três resíduos da confirmação de
-- opt-out (RF-CON-19; ADR-05, ADR-06)
--
-- A 20260905000300 estreitou a exceção do RF-CON-19. A conferência
-- adversarial seguinte achou três buracos, e este arquivo é a prova de
-- que os três fecharam — e de que fechá-los não fechou o caminho legítimo.
--
--   D1 · O "TEXTO FIXO" TINHA TEXTO LIVRE DENTRO. `{{nome}}` vinha de
--        `contacts.first_name`, derivado por `split_part(full_name,' ',1)`:
--        um nome sem espaço colhido pelo Radar atravessava inteiro, e o
--        banco OBRIGAVA a sair, para um número SUPRIMIDO e sem ninguém
--        ler, "Entendido, Marcos.SUA-CONTA-SERA-CANCELADA-ACESSE-http://…".
--        O conserto tirou o vocativo: a confirmação passou a ter UM
--        conteúdo possível, que é o que substitui o ADR-05 aqui.
--
--   D2 · O CAMINHO ATÉ O FIO ERA MUTÁVEL. A lista de imutáveis do UPDATE
--        foi feita olhando uma coluna. Um gestor trocava `template_id` e
--        `template_params` de uma confirmação já enfileirada — e, pior,
--        trocava `conversations.peer_phone_e164`, redirecionando para
--        outro número a única mensagem que atravessa a supressão.
--
--   D3 · CONFIRMAÇÃO QUE FALHA NUNCA MAIS ERA TENTADA. "Já enviada"
--        contava a `failed` também. Como 0 de 126 modelos estão aprovados
--        na Meta, TODA confirmação fora da janela de 24 h falhava — quem
--        pedia para sair três dias depois nunca era respondido, e o
--        sistema jamais tentava de novo.
--
-- As seções 1 a 3 medem comportamento com a API que já existia (elas
-- FALHAM, como asserção, contra o código anterior). A seção 4 mede os
-- objetos novos.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(47);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '', true); execute 'reset role'; end $$;

create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('f0000000-0000-4000-8000-0000000f94' || p_n)::uuid $$;
create function pg_temp.gente(p_n text) returns uuid language sql as $$
  select ('a0000000-0000-4000-8000-0000000a94' || p_n)::uuid $$;

delete from pgmq.q_wa_inbound;
delete from pgmq.q_wa_outbound;

insert into public.allowed_users (email, role, note) values
  ('residuais.admin@teste.local',  'admin',  'pgTAP residuais'),
  ('residuais.gestor@teste.local', 'gestor', 'pgTAP residuais');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gente('01'), 'residuais.admin@teste.local',  '{"full_name":"Admin Residuais"}'),
  (pg_temp.gente('02'), 'residuais.gestor@teste.local', '{"full_name":"Gestor Residuais"}');

insert into public.organizations (id, kind, name, phone_e164, source_id, collector, source_url, owner_id)
select v.id, 'fornecedor', v.nome, v.fone,
       (select id from public.sources order by id limit 1), 'pgtap',
       'https://exemplo.invalido/residuais', pg_temp.gente('01')
  from (values
    (pg_temp.org('01'), 'RESIDUAIS — NOME COLHIDO PELO RADAR', '+5584900000941'),
    (pg_temp.org('02'), 'RESIDUAIS — O FIO E O QUE VAI NELE',  '+5584900000942'),
    (pg_temp.org('03'), 'RESIDUAIS — LIGOU PEDINDO PARA SAIR', '+5584900000943')
  ) as v(id, nome, fone);

-- O NOME DO ATAQUE. Nenhum usuário do CRM escreveu isto: `contacts` só
-- exige `length(trim(full_name)) > 0`, e o gatilho de 20260904000300
-- deriva `first_name := split_part(full_name, ' ', 1)` — sem espaço, a
-- URL atravessa inteira.
insert into public.contacts (id, full_name, phone_e164) values
  (pg_temp.gente('11'), 'Marcos.SUA-CONTA-SERA-CANCELADA-ACESSE-http://mal.invalido/x', '+5584900000941'),
  (pg_temp.gente('12'), 'Ana Paula', '+5584900000942'),
  (pg_temp.gente('13'), 'José Carlos', '+5584900000943');
insert into public.organization_contacts (organization_id, contact_id, is_primary) values
  (pg_temp.org('01'), pg_temp.gente('11'), true),
  (pg_temp.org('02'), pg_temp.gente('12'), true),
  (pg_temp.org('03'), pg_temp.gente('13'), true);

select public.wa_entrada_registrar('wamid.RESID.A', '+5584988887777', '+5584900000941', 'text', 'SAIR');
select public.wa_entrada_registrar('wamid.RESID.B', '+5584988887777', '+5584900000942', 'text', 'quero sair');
select public.wa_entrada_registrar('wamid.RESID.C', '+5584988887777', '+5584900000943', 'text', 'boa tarde');

create function pg_temp.fio(p_fone text) returns uuid
  language sql security definer set search_path = '' as $$
  select id from public.conversations where peer_phone_e164 = p_fone limit 1 $$;
create function pg_temp.a() returns uuid language sql as $$ select pg_temp.fio('+5584900000941') $$;
create function pg_temp.b() returns uuid language sql as $$ select pg_temp.fio('+5584900000942') $$;
create function pg_temp.c() returns uuid language sql as $$ select pg_temp.fio('+5584900000943') $$;
create function pg_temp.tpl() returns int language sql security definer set search_path = '' as $$
  select id from public.message_templates where template_code = 'GEN-SYS-OPTOUT' $$;
create function pg_temp.conf(p_conv uuid) returns uuid language sql security definer set search_path = '' as $$
  select id from public.messages
   where conversation_id = p_conv and optout_confirmation
     and status <> 'failed'::app.msg_status limit 1 $$;

-- O texto do GEN-SYS-OPTOUT sem vocativo, escrito uma vez só.
create function pg_temp.texto_fixo() returns text language sql immutable as $$
  select 'Entendido. Não vou mais te mandar mensagem. Obrigada pelo retorno e sucesso nos eventos.'::text $$;


-- =====================================================================
-- 1. D1 — O TEXTO FIXO NÃO TEM MAIS TEXTO LIVRE DENTRO
-- =====================================================================
-- A conversa A é o caso real inteiro: nome colhido numa fonte pública,
-- opt-out por regra, número suprimido, nenhuma pessoa no caminho.
create table pg_temp.optA as
  select public.wa_optout_registrar(pg_temp.a(), 'Pediu por escrito no WhatsApp (regra "sair").') as j;

select is((select j ->> 'confirmacao_enfileirada' from pg_temp.optA), 'true',
          'a confirmação legítima continua saindo: fechar tudo não seria conserto');

select is((select body from public.messages where id = pg_temp.conf(pg_temp.a())),
          pg_temp.texto_fixo(),
          'D1 — o corpo é o texto fixo SEM vocativo: o nome colhido pelo Radar não entra na mensagem');

select ok((select body from public.messages where id = pg_temp.conf(pg_temp.a())) not like '%mal.invalido%',
          'D1 — e a URL que veio no full_name não aparece em lugar nenhum do corpo');

select ok((select body from public.messages where id = pg_temp.conf(pg_temp.a())) not like '%http%',
          'D1 — nem "http": a mensagem que sai sem revisão humana não carrega link de fora');

-- Fora da janela de 24 h o que vai no fio é o TEMPLATE com os parâmetros,
-- não o corpo. Um parâmetro seria a mesma fatia de texto livre.
select is((select template_params from public.messages where id = pg_temp.conf(pg_temp.a())),
          '[]'::jsonb,
          'D1 — e sem parâmetro nenhum: fora da janela de 24 h é template_params que vai no fio');

select is((select first_name from public.contacts where id = pg_temp.gente('11')),
          'Marcos.SUA-CONTA-SERA-CANCELADA-ACESSE-http://mal.invalido/x',
          'e a origem do defeito continua lá, intocada: quem consertou foi a DERIVAÇÃO, não o cadastro');

-- O texto ANTIGO (com vocativo) agora é "outro texto", e outro texto é
-- recusado — a mesma linha que barrava "Tá bom, tchau.". A conversa B
-- precisa estar devendo a confirmação para que o motivo medido seja o da
-- FORMA, e não "sem_pedido_de_optout".
select app.suppress('phone', '+5584900000942', 'contact_optout', 'whatsapp'::app.channel, null);
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, origin, template_id, optout_confirmation)
  values (pg_temp.b(), 'out', 'text', 'queued',
          'Entendido, Ana. Não vou mais te mandar mensagem. Obrigada pelo retorno e sucesso nos eventos.',
          'system', 'crm', pg_temp.tpl(), true) $$,
  '%texto_diferente_do_modelo_fixo%',
  'D1 — o texto COM vocativo virou "outro texto", e outro texto é recusado');

-- E declarar um parâmetro é recusado por nome.
select throws_like($$
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, origin, template_id, template_params, optout_confirmation)
  values (pg_temp.b(), 'out', 'text', 'queued', pg_temp.texto_fixo(),
          'system', 'crm', pg_temp.tpl(), '["Ana"]'::jsonb, true) $$,
  '%confirmacao_nao_tem_parametro%',
  'D1 — e mandar o nome pelo parâmetro do template é recusado com motivo próprio');


-- =====================================================================
-- 2. D2 — O CAMINHO ATÉ O FIO É IMUTÁVEL
-- =====================================================================
-- A conversa B ganha uma confirmação `queued` e o gestor tenta, uma a uma,
-- todas as maneiras de mudar o que o worker vai mandar. O gestor é quem
-- tem a policy `messages_update`/`conversations_update` a favor: se
-- alguém pode, é ele.
create table pg_temp.optB as
  select public.wa_optout_registrar(pg_temp.b(), 'Pediu para sair.') as j;
create function pg_temp.mb() returns uuid language sql as $$ select pg_temp.conf(pg_temp.b()) $$;

select pg_temp.entrar(pg_temp.gente('02'), 'gestor');

select throws_like($$ update public.messages
     set template_id = (select id from public.message_templates where template_code = 'GEN-SYS-QUEM-SOMOS')
   where id = pg_temp.mb() $$,
  '%não mudam depois do insert%',
  'D2 — trocar o MODELO de uma confirmação enfileirada é recusado (era GEN-SYS-QUEM-SOMOS ao número suprimido)');

select throws_like($$ update public.messages set template_params = '["INJETADO PELO GESTOR"]'::jsonb
   where id = pg_temp.mb() $$,
  '%não mudam depois do insert%',
  'D2 — e trocar os PARÂMETROS do template também');

select throws_like($$ update public.messages set type = 'audio'::app.msg_type where id = pg_temp.mb() $$,
  '%não mudam depois do insert%',
  'D2 — o tipo, que escolhe a forma do envio, não muda');

select throws_like($$ update public.messages
     set audio_asset_id = (select id from public.audio_assets limit 1) where id = pg_temp.mb() $$,
  '%não mudam depois do insert%',
  'D2 — o áudio, que é o que a Graph API receberia no lugar do texto, não muda');

select throws_like($$ update public.messages set origin = 'echo' where id = pg_temp.mb() $$,
  '%não mudam depois do insert%',
  'D2 — nem a ORIGEM, que porteia a reconferência da entrega: origin <> crm a pulava inteira');

select throws_like($$ update public.messages set author_kind = 'human' where id = pg_temp.mb() $$,
  '%não mudam depois do insert%',
  'D2 — nem a autoria, que escolheu o ramo do gatilho no insert');

select throws_like($$ update public.messages set is_first_contact = true where id = pg_temp.mb() $$,
  '%não mudam depois do insert%',
  'D2 — nem is_first_contact, que é um teto do RF-CON-10');

select throws_like($$ update public.messages set business_initiated = not business_initiated
   where id = pg_temp.mb() $$,
  '%não mudam depois do insert%',
  'D2 — nem business_initiated, que é o outro teto');

select throws_like($$ update public.messages set organization_id = pg_temp.org('01') where id = pg_temp.mb() $$,
  '%não mudam depois do insert%',
  'D2 — nem a ficha, que é de quem se pergunta "está suprimido?" na entrega');

-- E o pior de todos, que nem estava em `messages`: o DESTINO.
select throws_like($$ update public.conversations set peer_phone_e164 = '+5584911112222'
   where id = pg_temp.b() $$,
  '%não mudam%',
  'D2 — e o NÚMERO DE DESTINO da conversa não muda: era o redirecionamento da única mensagem que atravessa a supressão');

select throws_like($$ update public.conversations set business_number = '+5584911113333'
   where id = pg_temp.b() $$,
  '%não mudam%',
  'D2 — nem o número da empresa, que é o outro lado do mesmo fio');

select pg_temp.sair();

select is((select template_id from public.messages where id = pg_temp.mb()), pg_temp.tpl(),
          'depois das onze tentativas a confirmação continua sendo o GEN-SYS-OPTOUT');
select is((select body from public.messages where id = pg_temp.mb()), pg_temp.texto_fixo(),
          'com o mesmo texto fixo');
select is((select peer_phone_e164 from public.conversations where id = pg_temp.b()), '+5584900000942',
          'e para o mesmo número');

-- Fechar o caminho errado não pode fechar o certo: o que MUDA continua mudando.
update public.messages set status = 'failed'::app.msg_status, error_code = 'sem_modelo_aprovado'
 where id = pg_temp.mb();
select is((select status::text from public.messages where conversation_id = pg_temp.b()
            and optout_confirmation), 'failed',
          'e o que a entrega precisa mudar continua mudando: status, erro e failed_at entram');


-- =====================================================================
-- 3. D3 — CONFIRMAÇÃO QUE FALHA VOLTA A SER DEVIDA
-- =====================================================================
-- A confirmação da conversa B acabou de falhar. Antes, isso trancava a
-- conversa para sempre: "confirmacao_ja_enviada", em uma confirmação que
-- justamente NÃO chegou.
select is(app.wa_confirmacao_de_optout(pg_temp.b()) ->> 'motivo', NULL,
          'D3 — depois de a confirmação FALHAR, o banco não diz mais "já enviada"');
select is(app.wa_confirmacao_de_optout(pg_temp.b()) ->> 'devendo', 'true',
          'D3 — ele diz que DEVE: quem pediu para sair continua sem resposta');
select is(app.wa_confirmacao_de_optout(pg_temp.b()) ->> 'devida', 'true',
          'e que dá para mandar de novo agora (a janela de 24 h da conversa B está aberta)');

-- O caso do enunciado: opt-out registrado numa LIGAÇÃO, três dias depois
-- da última mensagem. Fora da janela, e nenhum dos 126 modelos está
-- aprovado na Meta.
update public.conversations set last_inbound_at = now() - interval '3 days' where id = pg_temp.c();
select ok(not app.janela_de_24h_aberta(pg_temp.c(), now()),
          'a conversa C está fora da janela de 24 h — é o caso de quem liga pedindo para sair dias depois');
select is(app.wa_modelo_da_meta(pg_temp.tpl()) ->> 'aprovado', 'false',
          'e o GEN-SYS-OPTOUT não está aprovado pela Meta: é o estado real de hoje (0 de 126)');

create table pg_temp.optC as
  select public.wa_optout_registrar(pg_temp.c(), 'Pediu para sair por telefone.') as j;
select is((select j ->> 'confirmacao_enfileirada' from pg_temp.optC), 'false',
          'D3 — a confirmação não sai: fora da janela a Meta só aceita template aprovado (R04 §2.1)');
select is((select j ->> 'confirmacao_motivo' from pg_temp.optC), 'sem_modelo_aprovado_na_meta',
          'e o motivo tem nome próprio, em vez de morrer com um erro técnico da Meta');
select is((select j ->> 'confirmacao_devendo' from pg_temp.optC), 'true',
          'D3 — MAS o sistema não morre calado: fica DEVENDO, por escrito');
select is((select j ->> 'registrado' from pg_temp.optC), 'true',
          'e o opt-out em si foi registrado — o silêncio pedido vale mesmo sem a confirmação');
select is((select count(*)::int from public.messages
            where conversation_id = pg_temp.c() and optout_confirmation), 0,
          'e nenhuma linha foi criada só para morrer: não se enfileira o que a Graph API já recusaria');


-- =====================================================================
-- 4. OS OBJETOS NOVOS — a dívida visível e paga sozinha
-- =====================================================================
select is(app.corpo_fixo_de_optout('Entendido, {{nome}}. Não vou mais te mandar mensagem.'),
          'Entendido. Não vou mais te mandar mensagem.',
          'app.corpo_fixo_de_optout tira o vocativo COM a vírgula e o espaço: não sobra "Entendido ."');
select is(app.corpo_fixo_de_optout('Tranquilo, {{nome}}, obrigada por responder.'),
          'Tranquilo, obrigada por responder.',
          'e entre duas vírgulas sobra uma vírgula só');
select is(app.corpo_fixo_de_optout('Entendido, {{nome}}. Veja {{link}}.'), NULL,
          'FALHA FECHADA: se sobrar qualquer outra variável ela devolve NULL — variável não resolvida é texto livre esperando alguém');
select is(app.wa_confirmacao_de_optout(pg_temp.c()) ->> 'motivo', 'sem_modelo_aprovado_na_meta',
          'e a conversa C está devendo pelo motivo certo');

select is((select motivo from public.wa_confirmacoes_devidas where conversation_id = pg_temp.c()),
          'sem_modelo_aprovado_na_meta',
          'a dívida aparece em public.wa_confirmacoes_devidas — a lista de a quem devemos resposta');
select is((select pode_sair_agora from public.wa_confirmacoes_devidas where conversation_id = pg_temp.c()),
          false,
          'dizendo que ela NÃO sai agora, e por quê');

-- A ação humana, que é o que destrava tudo isto.
select pg_temp.entrar(pg_temp.gente('01'), 'admin');
select ok((select jsonb_array_length(public.wa_saude() -> 'acao_humana')) > 0,
          'public.wa_saude() traz acao_humana: a pendência não fica só num comentário de migração');
select ok((public.wa_saude() -> 'acao_humana')::text like '%GEN-SYS-OPTOUT no Meta Business%',
          'e ela diz O QUE fazer: aprovar o GEN-SYS-OPTOUT no Meta Business');
select ok((public.wa_saude() -> 'acao_humana')::text like '%Luiz%',
          'e QUEM faz — a pendência tem dono, não é um aviso solto');
select pg_temp.sair();

-- E o worker-wa também lê o painel — é ele quem grita a pendência no log a
-- cada 15 min de fila vazia. Dentro de uma função `security definer` o
-- `current_user` é o DONO, não quem chamou: conferir por ele recusaria
-- justamente o worker.
create function pg_temp.saude_como_worker() returns int language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.wa_saude();
  reset role;
  return jsonb_array_length(v -> 'acao_humana');
end $$;
select ok(pg_temp.saude_como_worker() > 0,
          'e o worker-wa (service_role) enxerga a mesma acao_humana: é ele quem a grita no log');

-- E quando a pessoa aprova o modelo, a dívida é paga sozinha.
update public.message_templates
   set meta_status = 'approved', meta_template_name = 'gen_sys_optout_ptbr'
 where template_code = 'GEN-SYS-OPTOUT';
select is(app.wa_confirmacao_de_optout(pg_temp.c()) ->> 'devida', 'true',
          'aprovado o modelo na Meta, o estado volta a dizer que a confirmação PODE sair');
select is(app.wa_confirmacoes_reenfileirar(50) ->> 'reenfileiradas', '2',
          'e app.wa_confirmacoes_reenfileirar paga as duas dívidas sozinha (a que falhou e a que nunca saiu)');
select is((select body from public.messages where id = pg_temp.conf(pg_temp.c())),
          pg_temp.texto_fixo(),
          'com o mesmo texto fixo, montado pelo banco — nada de o reenvio abrir uma segunda porta');
select is((select count(*)::int from public.messages
            where conversation_id = pg_temp.b() and optout_confirmation), 2,
          'e na conversa B convivem a que falhou e a nova: o índice único agora guarda "uma VIVA", não "uma na história"');

select * from finish();
rollback;

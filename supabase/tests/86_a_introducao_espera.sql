-- =====================================================================
-- pgTAP — A introdução espera uns segundos (migração 20261002140000)
--
-- O que este arquivo prova:
--   1. SÓ A INTRODUÇÃO ESPERA. Cumprimento de campanha, texto de gente e
--      confirmação de opt-out saem com atraso zero. Segurar resposta humana por
--      dez segundos seria mentira ao contrário.
--   2. O ATRASO CAI DENTRO DA FAIXA sorteada, e a faixa vem de `app_settings` —
--      quem mexe é o gestor, sem deploy. Desde 29/09/2026 são DUAS faixas: o
--      "Tudo bem?" (3 a 6 s) e a introdução (15 a 20 s). Rafael: "depois que a
--      pessoa responder, o robo mandará um tudo bem? e depois a introdução após
--      uns 15 a 20 segundos".
--   3. O QUE JÁ PASSOU É DESCONTADO. A mensagem nasce quando o lead responde e
--      só é varrida segundos depois; o que a pessoa do outro lado sente é o
--      tempo total, então a fila segura o que FALTA, e nunca menos que zero.
--   4. FAIXA ZERADA VOLTA AO DE ANTES, que é o desligamento sem migração.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(17);

-- Uma pessoa de fixture, pelo caminho do login de verdade (RF-ADM-01): o banco
-- recém-resetado não tem perfil nenhum, e `conversations` exige dono (RF-CON-04).
insert into public.allowed_users (email, role, note)
values ('h86.g@teste.local', 'gestor', 'pgTAP atraso da introdução');
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000008601'::uuid, 'h86.g@teste.local', '{"full_name":"Gil Gestor"}');

-- O número da casa: `app.wa_numero_padrao()` vem de `app_settings` e nasce nulo
-- num banco recém-resetado, e `conversations.business_number` é not null.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999998600"')
 where key = 'whatsapp.envio';

-- Os outros automatismos ficam fora: aqui se mede a FUNÇÃO do atraso, não o
-- gatilho que a chama (esse é o arquivo 83). Sem isto, cada inserção de entrada
-- criaria introdução, menu e aviso de ausência no meio das asserções.
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

-- O teto de fala do robô (Fase 3) é 6 por conversa, e este arquivo insere
-- dezenas de introduções na mesma conversa só para sortear o atraso muitas
-- vezes. Sem afrouxar aqui, o sétimo insert morre no guarda — por uma regra
-- que o arquivo 70 já prova, e que não é a que se mede aqui.
update public.app_settings
   set value = value || '{"falas_por_conversa": 999, "repeticoes_iguais": 999,
                          "fusivel_por_hora": 9999, "pingue_pongue_seguidas": 999}'::jsonb
 where key = 'whatsapp.robo_teto';

create function pg_temp.quem_assina() returns uuid language sql stable as $$
  select 'a0000000-0000-4000-8000-000000008601'::uuid
$$;
create function pg_temp.modelo(p_codigo text) returns int language sql stable as $$
  select id from public.message_templates where template_code = p_codigo
$$;

-- Uma conversa qualquer: o atraso não olha a conversa, olha o modelo da mensagem.
create function pg_temp.conversa() returns uuid language plpgsql as $$
declare v_org uuid; v_conv uuid;
begin
  insert into public.organizations (name, phone_e164, source_id, collector)
  values ('Buffet do pgTAP 86', '+5584999998601',
          (select id from public.sources where slug = 'planilha'), 'pgtap86')
  returning id into v_org;
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, app.wa_numero_padrao(), '+5584999998601', v_org,
          pg_temp.quem_assina(), 'aguardando_parceiro')
  returning id into v_conv;
  -- Uma entrada do lead abre a janela de 24 h. Sem ela, `app.messages_guard`
  -- recusa o texto livre com `sem_janela_e_sem_template` — e a introdução, na
  -- vida real, só existe DEPOIS de o lead responder.
  insert into public.messages (conversation_id, direction, type, status, body,
                               author_kind, origin, created_at)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'bom dia', 'system', 'crm', now());
  return v_conv;
end $$;

-- Uma mensagem de saída `queued`, com o modelo e a idade que se pedir.
-- `p_idade_s` é quanto tempo faz que ela nasceu: é o que a função desconta.
create function pg_temp.saida(p_conv uuid, p_codigo text, p_idade_s int default 0)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, template_id,
                               author_kind, sent_by, origin, created_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'queued'::app.msg_status,
          'corpo do pgTAP 86',
          case when p_codigo is null then null else pg_temp.modelo(p_codigo) end,
          case when p_codigo = 'GEN-SYS-INTRO' then 'bot_fixed' else 'human' end,
          case when p_codigo = 'GEN-SYS-INTRO' then null else pg_temp.quem_assina() end,
          'crm', now() - make_interval(secs => p_idade_s))
  returning id into v_id;
  return v_id;
end $$;

create temp table t86(chave text primary key, valor uuid);
insert into t86 values ('conv', pg_temp.conversa());
create function pg_temp.conv() returns uuid language sql stable as $$
  select valor from t86 where chave = 'conv'
$$;

-- =====================================================================
-- 1. Só a introdução espera
-- =====================================================================
select is(app.wa_atraso_do_envio(pg_temp.saida(pg_temp.conv(), 'GEN-ABR-OLA-MANHA')), 0,
  'o cumprimento da campanha sai na hora');
select is(app.wa_atraso_do_envio(pg_temp.saida(pg_temp.conv(), null)), 0,
  'texto escrito por gente sai na hora');
select is(app.wa_atraso_do_envio(pg_temp.saida(pg_temp.conv(), 'GEN-SYS-HUMANO')), 0,
  'a resposta de "quero falar com uma pessoa" sai na hora');

-- =====================================================================
-- 2. A introdução espera, e dentro da faixa
-- =====================================================================
-- A faixa semeada é 15 a 20. Com a mensagem recém-nascida, o atraso é o sorteio
-- inteiro. Dez chamadas: todas dentro da faixa, e é a faixa que se afirma —
-- afirmar um número seria afirmar o resultado de um sorteio.
select ok(
  (select bool_and(d between 15 and 20)
     from (select app.wa_atraso_do_envio(pg_temp.saida(pg_temp.conv(), 'GEN-SYS-INTRO')) as d
             from generate_series(1, 10)) s),
  'a introdução espera algo entre 15 e 20 segundos');

-- E o "Tudo bem?" tem faixa PRÓPRIA, mais curta: ele é a resposta rápida que
-- vem antes da proposta. Zero seria pior que 15 — resposta instantânea é o que
-- denuncia máquina.
select ok(
  (select bool_and(d between 3 and 6)
     from (select app.wa_atraso_do_envio(pg_temp.saida(pg_temp.conv(), 'GEN-SYS-TUDOBEM')) as d
             from generate_series(1, 10)) s),
  'o "Tudo bem?" espera algo entre 3 e 6 segundos, e não sai instantâneo');

select ok(
  (select app.wa_atraso_do_envio(pg_temp.saida(pg_temp.conv(), 'GEN-SYS-TUDOBEM'))
        < (select min(d) from (select app.wa_atraso_do_envio(
             pg_temp.saida(pg_temp.conv(), 'GEN-SYS-INTRO')) as d from generate_series(1,5)) s)),
  'e o "Tudo bem?" sempre chega ANTES da introdução: as faixas não se cruzam');

-- E sorteia mesmo: em trinta chamadas sai mais de um valor. (A chance de trinta
-- sorteios em sete valores darem todos o mesmo é 7 × (1/7)^30 — não acontece.)
select ok(
  (select count(distinct d) > 1
     from (select app.wa_atraso_do_envio(pg_temp.saida(pg_temp.conv(), 'GEN-SYS-INTRO')) as d
             from generate_series(1, 30)) s),
  'o atraso é sorteado, e não um número fixo com cara de sorteio');

-- =====================================================================
-- 3. O que já passou é descontado
-- =====================================================================
select ok(
  (select bool_and(d between 9 and 14)
     from (select app.wa_atraso_do_envio(pg_temp.saida(pg_temp.conv(), 'GEN-SYS-INTRO', 6)) as d
             from generate_series(1, 10)) s),
  'seis segundos já passados saem da conta: sobra entre 9 e 14 da faixa de 15 a 20');

select is(app.wa_atraso_do_envio(pg_temp.saida(pg_temp.conv(), 'GEN-SYS-INTRO', 60)), 0,
  'mensagem velha não espera mais nada, e nunca devolve negativo');

-- =====================================================================
-- 4. Faixa zerada volta ao de antes
-- =====================================================================
update public.app_settings
   set value = value || '{"introducao_atraso_s": {"min": 0, "max": 0}}'::jsonb
 where key = 'atendimento';
select is(app.wa_atraso_do_envio(pg_temp.saida(pg_temp.conv(), 'GEN-SYS-INTRO')), 0,
  'faixa em zero desliga a espera sem precisar de migração');

-- =====================================================================
-- 5. O texto que o Rafael aprovou, e o que ele NÃO tem
-- =====================================================================
-- A frase "100% gratuito" foi trocada por "a divulgação de vocês nele é
-- gratuita" de propósito (ver o cabeçalho da migração). Esta asserção existe
-- para que a troca não volte atrás sem alguém reparar.
-- E o texto do "Tudo bem?" é o que o Rafael pediu: duas palavras, sem nome,
-- sem variável (o corpo é copiado cru para o fio).
select is((select body from public.message_templates where template_code = 'GEN-SYS-TUDOBEM'),
  'Tudo bem?', 'o "Tudo bem?" é exatamente isso, e nada mais');
select ok(
  (select position('{{' in body) = 0 and is_active
     from public.message_templates where template_code = 'GEN-SYS-TUDOBEM'),
  'e está ativo e sem variável: `wa_bot_dizer` copia o corpo cru para o fio');

select ok(
  (select body not ilike '%100%gratuito%'
      and body ilike '%divulgação de vocês nele é gratuita%'
      and body not ilike '%SAIR%'
      and body ilike '%Google Maps%'
     from public.message_templates where template_code = 'GEN-SYS-INTRO'),
  'a introdução diz para quem é grátis, diz de onde veio o contato, e não manda responder SAIR');

-- =====================================================================
-- 6. OS DOIS TEXTOS SE EDITAM NA TELA (migração 20261002240000)
-- =====================================================================
-- Rafael pediu o "Tudo bem?" editável em Ajustes. A regra que importa é a mesma
-- da introdução: `app.wa_bot_dizer` copia o corpo CRU para o fio, então um
-- `{{nome}}` salvo aqui sairia literal no WhatsApp do fornecedor. Quem recusa é
-- a FUNÇÃO, não o bom senso de quem digita.
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

select pg_temp.entrar('a0000000-0000-4000-8000-000000008601'::uuid, 'gestor');

select is(public.atendimento_configurar('{"texto_tudo_bem": "Tudo certo por aí?"}'::jsonb) ->> 'ok',
  'true', 'o gestor troca o texto do "Tudo bem?" pela tela');

select is(public.atendimento_configurar('{"texto_tudo_bem": "Oi {{nome}}, tudo bem?"}'::jsonb) ->> 'motivo',
  'tudo_bem_com_variavel',
  'e variável é recusada: o corpo é copiado cru, e {{nome}} sairia literal no fio do fornecedor');

select is(public.atendimento_configurar(
    jsonb_build_object('texto_tudo_bem', repeat('a', 201))) ->> 'campo',
  'texto_tudo_bem',
  'texto longo demais é recusado nomeando o campo — a mensagem do meio é curta por definição');

select pg_temp.sair();

select is((select body from public.message_templates where template_code = 'GEN-SYS-TUDOBEM'),
  'Tudo certo por aí?',
  'o que foi aceito ficou gravado, e o que foi recusado não encostou no modelo');

select * from finish();
rollback;

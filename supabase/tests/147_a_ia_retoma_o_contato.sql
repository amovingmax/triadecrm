-- =====================================================================
-- pgTAP — A IA que atende retoma o contato (migração 20261125150000)
--
-- Pedido do usuário em 11/11/2026: a IA manda mensagem depois de 1, 3 e 7
-- dias sem resposta do cliente, para aquecer. Este arquivo prova:
--
--   1. A AÇÃO 'retomou' entra em ia_respostas sem tirar nenhuma outra;
--      a rodada está no cron, a cada 5 minutos;
--   2. CONFIGURAR é de admin e gestor; dias, modelos, intervalo e por_rodada
--      são conferidos; desligada (o padrão), nada acontece;
--   3. O PLANO: dia 1 é texto da IA dentro da janela de 24 h; dias seguintes,
--      modelo; etapa que passou sem caber no horário fica registrada;
--   4. PARA quando o cliente falou por último, a equipe assumiu, há
--      supressão, a conversa foi concluída, a atitude é sem interesse, o
--      negócio foi ganho, há visita marcada (reunião, tarefa de visita ou
--      Calendly pelo telefone), o silêncio começou antes de ligar, a IA
--      encerrou, ou no modo treino a conversa não é do treino nem de teste;
--   5. NENHUM MODELO SEM A IA TER LIDO: sem o texto do dia 1, a rodada pede a
--      leitura; "segue" deixa o modelo sair; "encerra" (já aluguei) não deixa
--      sair nenhum; leitura que falhou = sem_leitura_da_ia;
--   6. A RODADA manda o modelo aprovado com nome e imóvel (empate de imóvel
--      = texto genérico); modelo não aprovado ou com variável desconhecida não
--      sai e fica o motivo; rodar de novo não repete; mudar os dias não repete
--      o dia que já saiu; o intervalo mínimo entre etapas;
--   7. O WORKER: a entrada, o texto que sai como bot_ai pela porteira com a
--      prova em ia_respostas (acao retomou), e a desistência que encerra;
--   8. O HORÁRIO: fora da janela de envio, espera ou pula;
--   9. A TELA: o painel (quem respondeu depois, sem reação e sem opt-out, que
--      conta à parte), o funil, o selo (some sem modelo pronto); RLS só
--      leitura;
--  10. `retomou` FORA das contas da atendente: o placar, o relatório da IA, a
--      entrada da juíza; e o "Corrigir" de uma retomada não vai ao caderno.
--
-- A janela de horário (RF-CON-11) é trocada, só nesta transação, por uma que
-- o teste abre e fecha (`t147.janela`): o que se prova aqui é a retomada, e a
-- hora em que a suíte roda não pode decidir o resultado.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(102);

insert into public.allowed_users (email, role, note) values
  ('h147.g@teste.local', 'gestor', 'pgTAP 147'),
  ('h147.s@teste.local', 'sdr', 'pgTAP 147');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000014701'::uuid, 'h147.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000014702'::uuid, 'h147.s@teste.local', '{"full_name":"Sara Sdr"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999914700"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
delete from public.app_settings where key in ('ia.atendente', 'ia.retomada');

-- A janela de horário que o teste controla.
create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select case when coalesce(current_setting('t147.janela', true), '') = 'fechada'
              then jsonb_build_object('aberta', false, 'motivo', 'depois_do_fechamento',
                                      'abre_em', p_at + interval '13 hours', 'fecha_em', null)
              else jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                                      'fecha_em', p_at + interval '4 hours') end
$$;

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
create function pg_temp.gestor() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000014701'::uuid, 'gestor')
$$;
create function pg_temp.sdr() returns void language sql as $$
  select pg_temp.entrar('a0000000-0000-4000-8000-000000014702'::uuid, 'sdr')
$$;

create temp table t147(chave text primary key, valor uuid);
grant all on t147 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t147 where chave = p_chave
$$;
create function pg_temp.conversa(p_chave text, p_tel text, p_nome text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999914700', p_tel, p_nome,
          'a0000000-0000-4000-8000-000000014701'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t147 values (p_chave, v);
  return v;
end $$;
-- O cliente escreveu há `p_seg` segundos (negativo: daqui a pouco).
create function pg_temp.dele(p_conv uuid, p_seg int, p_texto text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (p_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          p_texto, 'system', 'crm', now() - make_interval(secs => p_seg))
  returning id into v;
  return v;
end $$;
-- A resposta da IA que atende, há `p_seg` segundos: entra sem a porteira (que
-- exige a prova da função da IA na mesma transação), só para montar o cenário.
create function pg_temp.da_ia(p_conv uuid, p_seg int, p_texto text) returns uuid language plpgsql as $$
declare v uuid;
begin
  set local session_replication_role = replica;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          E'*Imova:*\n' || p_texto, 'bot_ai', 'crm', 'wamid.PGTAP147IA.' || gen_random_uuid(),
          now() - make_interval(secs => p_seg), now() - make_interval(secs => p_seg))
  returning id into v;
  set local session_replication_role = origin;
  insert into public.ia_respostas (conversation_id, message_id, corpo, acao, criada_em)
  values (p_conv, v, E'*Imova:*\n' || p_texto, 'respondeu', now() - make_interval(secs => p_seg));
  return v;
end $$;
-- A mensagem automática da casa (texto fixo do robô), há `p_seg` segundos.
create function pg_temp.da_casa(p_conv uuid, p_seg int) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'Recebemos sua mensagem! Já já respondemos.', 'bot_fixed', 'crm', 'wamid.PGTAP147CASA.' || gen_random_uuid(),
          now() - make_interval(secs => p_seg), now() - make_interval(secs => p_seg));
  set local session_replication_role = origin;
end $$;
-- Gente do time escreveu (a IA para ali).
create function pg_temp.nossa(p_conv uuid, p_seg int) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'pgtap147 nossa', 'human', 'echo', 'a0000000-0000-4000-8000-000000014701'::uuid,
          'wamid.PGTAP147.' || gen_random_uuid(), now() - make_interval(secs => p_seg),
          now() - make_interval(secs => p_seg))
$$;
-- Um silêncio de `p_horas`: o cliente escreveu, a IA respondeu um minuto depois.
create function pg_temp.silencio(p_chave text, p_tel text, p_nome text, p_horas int, p_texto text)
returns uuid language plpgsql as $$
declare v uuid := pg_temp.conversa(p_chave, p_tel, p_nome);
begin
  perform pg_temp.dele(v, p_horas * 3600, p_texto);
  perform pg_temp.da_ia(v, p_horas * 3600 - 60, 'Temos sim! Quer marcar uma visita?');
  return v;
end $$;
-- Uma ficha com o telefone da conversa (a conversa NÃO é ligada a ela: só o telefone liga).
create function pg_temp.ficha(p_nome text, p_tel text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.organizations (kind, name, source_id, collector, phone_e164)
  select 'produtor'::app.org_kind, p_nome, s.id, 'pgtap147', p_tel
    from public.sources s where s.slug = 'planilha'
  returning id into v;
  return v;
end $$;
create function pg_temp.plano(p_chave text) returns jsonb language sql stable as $$
  select app.ia_retomada_plano(pg_temp.id(p_chave), now())
$$;
create function pg_temp.etapa(p_chave text, p_dias int) returns public.ia_retomadas language sql stable as $$
  select * from public.ia_retomadas where conversation_id = pg_temp.id(p_chave) and dias = p_dias
$$;
create function pg_temp.leitura(p_chave text, p_dias int) returns public.ia_retomada_leituras language sql stable as $$
  select * from public.ia_retomada_leituras where conversation_id = pg_temp.id(p_chave) and dias = p_dias
$$;
create function pg_temp.modelos_de(p_chave text) returns int language sql stable as $$
  select count(*)::int from public.messages m
   where m.conversation_id = pg_temp.id(p_chave) and m.direction = 'out'::app.msg_direction
     and m.type = 'template'::app.msg_type
$$;
-- O worker decide a leitura (o que ele faz depois de ler a conversa com a IA).
create function pg_temp.decidir(p_chave text, p_dias int, p_decisao text, p_motivo text) returns jsonb
language sql as $$
  select public.ia_retomada_leitura_gravar((pg_temp.leitura(p_chave, p_dias)).id, p_decisao, p_motivo,
                                           null, 'retomar-conversa@v1')
$$;

-- Os modelos: um aprovado, um ainda na Meta, um com variável que a retomada não preenche.
insert into public.message_templates (template_code, name, channel, category, kind,
                                      meta_template_name, meta_status, body)
values
  ('T147-RETOMAR-3', 'Retomar 3 dias (pgTAP)', 'whatsapp', 'marketing', 'followup', 't147_retomar_3_v1', 'approved',
   'Oi, {{nome}}! Aqui é da Imova. Você ainda tem interesse no imóvel {{imovel}}? Se não quiser mais mensagens, responda SAIR.'),
  ('T147-RETOMAR-7', 'Retomar 7 dias (pgTAP)', 'whatsapp', 'marketing', 'followup', null, 'pending',
   'Oi, {{nome}}! Aqui é da Imova de novo. Ainda procura imóvel?'),
  ('T147-CIDADE', 'Cidade (pgTAP)', 'whatsapp', 'marketing', 'followup', 't147_cidade_v1', 'approved',
   'Oi, {{nome}}! Você ainda procura imóvel em {{cidade}}?');
insert into public.anuncios (codigo, titulo, situacao, bairro, cidade, estado)
values ('T147AP', 'Apartamento com vista', 'no_ar', 'Ponta Negra', 'Natal', 'RN'),
       ('T147CA', 'Casa com quintal', 'no_ar', 'Tirol', 'Natal', 'RN');

-- ---------------------------------------------------------------------
-- 1. A ação nova e o cron
-- ---------------------------------------------------------------------
select ok((select pg_get_constraintdef(c.oid) from pg_constraint c
            where c.conname = 'ia_respostas_acao_check' and c.conrelid = 'public.ia_respostas'::regclass)
          ~ 'retomou' , 'ia_respostas aceita a ação retomou');
select ok((select bool_and(pg_get_constraintdef(c.oid) ~ a)
             from pg_constraint c, unnest(array['respondeu', 'passou_para_pessoa', 'marcou_visita',
                                                'anotou', 'nao_respondeu']) a
            where c.conname = 'ia_respostas_acao_check' and c.conrelid = 'public.ia_respostas'::regclass),
          'e continua aceitando todas as de antes');
select is((select schedule from cron.job where jobname = 'ia_retomadas_rodar'), '*/5 * * * *',
          'a rodada está no cron, a cada 5 minutos');

-- ---------------------------------------------------------------------
-- 2. Os cenários, e desligada nada acontece
-- ---------------------------------------------------------------------
select pg_temp.silencio('a1', '+5584988814701', 'Ana Souza', 21, 'Ainda tem o T147AP? Quero ver.');
select pg_temp.silencio('a3', '+5584988814703', 'Bruna Lima', 73, 'Tenho interesse no T147AP');
select pg_temp.silencio('a7', '+5584988814707', 'Caio Melo', 169, 'Procuro casa para alugar');
select pg_temp.silencio('enc', '+5584988814708', 'Dora Dias', 21, 'Já fechei com outra imobiliária, obrigada');
select pg_temp.silencio('alug', '+5584988814715', 'Kátia Klein', 73, 'Obrigado, já aluguei com outra imobiliária');
select pg_temp.silencio('falha', '+5584988814716', 'Lia Lopes', 73, 'Quero ver casas no Tirol');
-- O cliente falou por último.
select pg_temp.conversa('fala', '+5584988814709', 'Eva Eloi');
select pg_temp.dele(pg_temp.id('fala'), 21 * 3600, 'Vou pensar e te falo');
-- A equipe assumiu.
select pg_temp.silencio('time', '+5584988814710', 'Fábio Freitas', 21, 'Quero falar do aluguel');
select pg_temp.nossa(pg_temp.id('time'), 20 * 3600);
-- Pediu para sair (o número na supressão).
select pg_temp.silencio('sup', '+5584988814711', 'Gina Gomes', 21, 'Ok');
select app.suppress('phone', '+5584988814711', 'pgTAP 147', 'whatsapp'::app.channel, null::uuid);
-- Visita marcada (reunião) depois da última mensagem do cliente.
select pg_temp.silencio('vis', '+5584988814712', 'Hugo Hora', 73, 'Pode ser sábado');
insert into public.reunioes (organization_id, conversation_id, dono_id, titulo, formato, inicio, fim, local,
                             marcada_por)
values (pg_temp.ficha('Hugo pgTAP 147', '+5584988814712'), pg_temp.id('vis'),
        'a0000000-0000-4000-8000-000000014701'::uuid, 'Visita pgtap147', 'presencial',
        now() + interval '1 day', now() + interval '1 day 1 hour', 'Rua teste 147', 'pessoa');
-- A conversa foi concluída.
select pg_temp.silencio('arq', '+5584988814717', 'Mara Moura', 21, 'Ok, vou ver');
update public.conversations set arquivada_em = now() - interval '1 hour' where id = pg_temp.id('arq');
-- Tarefa de visita na Agenda, na ficha do telefone.
select pg_temp.silencio('tar', '+5584988814718', 'Nina Neves', 73, 'Combinado');
insert into public.tasks (title, kind, due_at, assignee_id, organization_id, origin)
values ('Visita pgtap147', 'visit'::app.task_kind, now() + interval '2 days',
        'a0000000-0000-4000-8000-000000014701'::uuid, pg_temp.ficha('Nina pgTAP 147', '+5584988814718'), 'manual');
-- Calendly marcado, achado só pelo telefone.
select pg_temp.silencio('cal', '+5584988814719', 'Olga Ortiz', 73, 'Vou marcar pelo link');
insert into public.calendly_agendamentos (convidado_uri, evento_uri, situacao, natureza, inicio, fim, organization_id)
values ('https://api.calendly.com/pgtap147/convidado', 'https://api.calendly.com/pgtap147/evento', 'agendado', 'visita',
        now() + interval '3 days', now() + interval '3 days 1 hour', pg_temp.ficha('Olga pgTAP 147', '+5584988814719'));
-- A atitude do cliente: sem interesse.
select pg_temp.silencio('att', '+5584988814720', 'Paula Paz', 73, 'Hum, sei não');
insert into public.atitudes (conversation_id, etiqueta, motivo, desde, calculada_em)
values (pg_temp.id('att'), 'sem_interesse', 'pgtap147', now() - interval '2 days', now())
on conflict (conversation_id) do update set etiqueta = excluded.etiqueta, motivo = excluded.motivo;
-- O negócio da ficha foi ganho depois da última mensagem do cliente.
select pg_temp.silencio('gan', '+5584988814721', 'Rita Rosa', 73, 'Vou fechar');
set local session_replication_role = replica;
insert into public.deals (organization_id, pipeline_id, stage_id, status, won_at)
select pg_temp.ficha('Rita pgTAP 147', '+5584988814721'), s.pipeline_id, s.id, 'won', now() - interval '1 day'
  from public.stages s order by s.id limit 1;
set local session_replication_role = origin;

-- Só a mensagem automática da casa respondeu: a IA nunca respondeu o cliente.
select pg_temp.conversa('casa', '+5584988814724', 'Ugo Uchoa');
select pg_temp.dele(pg_temp.id('casa'), 21 * 3600, 'Oi, vi o anúncio da casa');
select pg_temp.da_casa(pg_temp.id('casa'), 21 * 3600 - 60);
-- A IA respondeu um silêncio antigo, mas não a última mensagem do cliente.
select pg_temp.silencio('velha', '+5584988814725', 'Vânia Vidal', 100, 'Quero alugar');
select pg_temp.dele(pg_temp.id('velha'), 21 * 3600, 'Ainda tem?');
select pg_temp.da_casa(pg_temp.id('velha'), 21 * 3600 - 60);
-- A IA respondeu tarde: o cliente escreveu há 80 h, ela respondeu há 70 h.
select pg_temp.conversa('tarde', '+5584988814726', 'Wilma Weber');
select pg_temp.dele(pg_temp.id('tarde'), 80 * 3600, 'Tem casa em Parnamirim?');
select pg_temp.da_ia(pg_temp.id('tarde'), 70 * 3600, 'Temos sim! Quer ver?');

select is(app.ia_retomadas_rodar(), 0, 'desligada (o padrão): a rodada não faz nada');
select is(pg_temp.plano('a1') ->> 'situacao', 'desligada', 'e o plano diz que está desligada');

select pg_temp.gestor();
select public.ia_atendente_configurar(jsonb_build_object('ligada', true, 'modo', 'clientes'));
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 3. Configurar
-- ---------------------------------------------------------------------
select is(app.ia_retomada_config() -> 'dias', '[1]'::jsonb,
          'o padrão é uma retomada só, o texto da IA no dia 1 (decisão do dono, 24/11/2026)');
select pg_temp.sdr();
select is(public.ia_retomada_configurar('{"ligada": true}'::jsonb) ->> 'motivo', 'sem_permissao',
          'o SDR não liga a retomada (é configuração)');
select pg_temp.sair();

select pg_temp.gestor();
select is(public.ia_retomada_configurar('{"dias": [3, 1]}'::jsonb) ->> 'motivo', 'dias_invalidos',
          'os dias vão em ordem');
select is(public.ia_retomada_configurar('{"dias": [1, 2, 3, 4, 5, 6]}'::jsonb) ->> 'motivo', 'dias_invalidos',
          'no máximo cinco etapas');
select is(public.ia_retomada_configurar('{"dias": [1, 31]}'::jsonb) ->> 'motivo', 'dias_invalidos',
          'até 30 dias');
select is(public.ia_retomada_configurar('{"modelos": {"3": "NAO-EXISTE"}}'::jsonb) ->> 'motivo', 'modelo_inexistente',
          'o modelo tem de existir no CRM');
select is(public.ia_retomada_configurar('{"por_rodada": 1.5}'::jsonb) ->> 'motivo', 'por_rodada_fora_do_limite',
          'por_rodada só aceita inteiro');
select is(public.ia_retomada_configurar('{"por_rodada": 201}'::jsonb) ->> 'motivo', 'por_rodada_fora_do_limite',
          'por_rodada vai até 200');
select is(public.ia_retomada_configurar('{"intervalo_min_horas": 12}'::jsonb) ->> 'motivo', 'intervalo_fora_do_limite',
          'o intervalo mínimo entre etapas é de 24 a 240 h');
select is(public.ia_retomada_configurar('{"conversas": []}'::jsonb) ->> 'motivo', 'chave_desconhecida',
          'chave que a retomada não conhece é recusada');
select ok((public.ia_retomada_configurar(
             '{"ligada": true, "dias": [1, 3, 7], "modelos": {"3": "T147-RETOMAR-3", "7": "T147-RETOMAR-7"}}'::jsonb)
             -> 'config' ->> 'ligada_em') is not null,
          'o gestor liga a retomada com os dias e os modelos, e ela marca quando ligou');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 4. O plano: quando, de que tipo, e quando para
-- ---------------------------------------------------------------------
select is(pg_temp.plano('a1') ->> 'motivo', 'o_silencio_comecou_antes_de_ligar',
          'ligar não dispara mensagem a quem já estava em silêncio');
-- Para o resto do arquivo, a retomada foi ligada há 30 dias.
update public.app_settings set value = jsonb_set(value, '{ligada_em}', to_jsonb(now() - interval '30 days'))
 where key = 'ia.retomada';

select is(pg_temp.plano('a1') ->> 'situacao', 'devida', '21 h depois, o dia 1 é devido');
select is(pg_temp.plano('a1') ->> 'tipo', 'texto', 'e é texto da IA (dentro da janela de 24 h)');
select is((pg_temp.plano('a3') ->> 'dias')::int, 3, 'três dias depois, a etapa é a do dia 3');
select is(pg_temp.plano('a3') ->> 'tipo', 'modelo', 'e é modelo');
select is(pg_temp.plano('a3') -> 'pular' -> 0 ->> 'motivo', 'sem_horario_permitido_nas_24_horas',
          'o dia 1 que passou sem sair fica para registrar');
select is(pg_temp.plano('fala') ->> 'motivo', 'o_cliente_falou_por_ultimo',
          'o cliente falou por último: a IA que atende é quem responde, não a retomada');
select is(pg_temp.plano('time') ->> 'motivo', 'a_ia_nao_atende', 'a equipe escreveu: a IA parou ali, e a retomada também');
select is(pg_temp.plano('sup') ->> 'motivo', 'numero_suprimido', 'quem pediu para sair não recebe retomada');
select is(pg_temp.plano('vis') ->> 'motivo', 'visita_marcada', 'visita marcada: nada de retomada');
select is(pg_temp.plano('arq') ->> 'motivo', 'conversa_concluida', 'conversa concluída: nada de retomada');
select is(pg_temp.plano('tar') ->> 'motivo', 'visita_marcada', 'tarefa de visita na Agenda, na ficha do telefone, também para');
select is(pg_temp.plano('cal') ->> 'motivo', 'visita_marcada', 'o Calendly achado só pelo telefone também para');
select is(pg_temp.plano('att') ->> 'motivo', 'cliente_sem_interesse', 'a atitude sem interesse para a retomada');
select is(pg_temp.plano('gan') ->> 'motivo', 'negocio_fechado', 'negócio ganho depois da última mensagem: para');
select is(pg_temp.plano('casa') ->> 'motivo', 'a_ia_nao_respondeu_o_cliente',
          'só a mensagem automática da casa respondeu: não há conversa da IA para retomar');
select is(pg_temp.plano('velha') ->> 'motivo', 'a_ia_nao_respondeu_o_cliente',
          'a IA respondeu um silêncio antigo, mas não a última mensagem do cliente: também não');
select is(pg_temp.plano('tarde') ->> 'situacao', 'aguardando',
          'a IA respondeu 10 h depois do cliente: o dia 3 ainda não venceu, porque o silêncio conta da resposta dela');
select is((pg_temp.plano('tarde') ->> 'devida_em')::timestamptz, now() - interval '70 hours' + interval '3 days',
          'o dia 3 vence 3 dias depois da resposta da IA');

-- ---------------------------------------------------------------------
-- 5. A rodada e a leitura antes do modelo
-- ---------------------------------------------------------------------
select is(app.ia_retomadas_rodar(), 5,
          'a rodada põe o dia 1 de Ana e de Dora para a IA escrever e pede a leitura de Bruna, Kátia e Lia');
select is((pg_temp.etapa('a1', 1)).situacao, 'na_fila', 'o dia 1 de Ana espera a IA escrever');
select ok(exists (select 1 from public.ingest_dedup d
                   where d.queue = 'ai_jobs'
                     and d.idempotency_key = 'retomar_conversa:' || (pg_temp.etapa('a1', 1)).id::text),
          'e foi para a fila da IA com chave');
select is((pg_temp.etapa('a3', 1)).motivo, 'sem_horario_permitido_nas_24_horas',
          'o dia 1 de Bruna, que passou, fica registrado como pulado');
select is(pg_temp.modelos_de('a3'), 0, 'sem o dia 1, o modelo de Bruna NÃO sai antes de a IA ler a conversa');
select is((pg_temp.leitura('a3', 3)).situacao, 'na_fila', 'a rodada pede a leitura da IA antes do modelo');
select ok(exists (select 1 from public.ingest_dedup d
                   where d.queue = 'ai_jobs'
                     and d.idempotency_key = 'retomar_leitura:' || (pg_temp.leitura('a3', 3)).id::text),
          'pela fila da IA, com chave');
select is((pg_temp.etapa('a7', 7)).motivo, 'modelo_nao_aprovado_na_meta (pending)',
          'o dia 7 de Caio não sai: o modelo ainda não foi aprovado pela Meta');
select is((select count(*)::int from public.ia_retomadas
            where conversation_id in (pg_temp.id('fala'), pg_temp.id('time'), pg_temp.id('sup'), pg_temp.id('vis'),
                                      pg_temp.id('arq'), pg_temp.id('tar'), pg_temp.id('cal'), pg_temp.id('att'),
                                      pg_temp.id('gan'))),
          0, 'quem não pode receber não ganha nem linha');
select is((select count(*)::int from public.ia_retomadas
            where conversation_id in (pg_temp.id('casa'), pg_temp.id('velha'))),
          0, 'nem quem a IA não respondeu');
select is(app.ia_retomadas_rodar(), 0, 'rodar de novo, com a leitura na fila, não faz nada');

-- A leitura de Bruna segue, a de Kátia ("já aluguei") encerra, a de Lia falha.
select is(pg_temp.decidir('a3', 3, 'segue', 'o cliente segue interessado') ->> 'ok', 'true', 'a IA lê Bruna: segue');
select pg_temp.decidir('alug', 3, 'encerra', 'a cliente já alugou com outra imobiliária');
select pg_temp.decidir('falha', 3, 'falhou', 'a_ia_nao_conseguiu_escrever');
select is(app.ia_retomadas_rodar(), 1, 'com a leitura, sai o modelo de Bruna, e só ele');
select is((pg_temp.etapa('a3', 3)).situacao, 'enviada', 'o dia 3 de Bruna sai pelo modelo aprovado');
select is((select m.type::text || '/' || m.author_kind::text || '/' || (m.template_params ->> 'nome')
             from public.messages m where m.id = (pg_temp.etapa('a3', 3)).message_id),
          'template/bot_fixed/Bruna', 'como modelo do robô, com o primeiro nome');
select is((select m.template_params ->> 'imovel' from public.messages m
            where m.id = (pg_temp.etapa('a3', 3)).message_id),
          'de Ponta Negra (código T147AP)', 'e o imóvel de que falavam');
select ok((select m.body from public.messages m where m.id = (pg_temp.etapa('a3', 3)).message_id)
            like 'Oi, Bruna! Aqui é da Imova. Você ainda tem interesse no imóvel de Ponta Negra%',
          'o corpo é o modelo preenchido');
select is(pg_temp.modelos_de('alug'), 0, '"já aluguei": a IA leu e encerrou, nenhum modelo sai');
select is(pg_temp.plano('alug') ->> 'motivo', 'a_ia_encerrou', 'e o silêncio de Kátia acabou');
select is(pg_temp.modelos_de('falha'), 0, 'leitura que falhou: o modelo não sai');
select is((pg_temp.etapa('falha', 3)).motivo, 'sem_leitura_da_ia: a_ia_nao_conseguiu_escrever',
          'e fica o motivo sem_leitura_da_ia');
select is(app.ia_retomadas_rodar(), 0, 'rodar de novo não faz nada');
select is(pg_temp.modelos_de('a3'), 1, 'e não repete o modelo');

-- ---------------------------------------------------------------------
-- 6. O worker: entrada, texto e desistência
-- ---------------------------------------------------------------------
select is((public.ia_retomada_entrada((pg_temp.etapa('a1', 1)).id) ->> 'pode')::boolean, true,
          'a entrada diz ao worker que pode');
select is(public.ia_retomada_entrada((pg_temp.etapa('a1', 1)).id) -> 'imovel' ->> 'codigo', 'T147AP',
          'com o imóvel de que falavam');
select is((public.ia_retomada_entrada((pg_temp.etapa('a1', 1)).id) ->> 'horas_sem_resposta')::int, 21,
          'e as horas sem resposta');
select is((public.ia_retomada_leitura_entrada((pg_temp.leitura('alug', 3)).id) ->> 'motivo'), 'ja_resolvida',
          'a leitura já decidida não volta ao worker');

select is((public.ia_retomada_dizer((pg_temp.etapa('a1', 1)).id,
                                    'Oi, Ana! Ainda tem interesse no apartamento de Ponta Negra?',
                                    '{}'::jsonb, null, 'retomar-conversa@v1') ->> 'ok')::boolean, true,
          'o texto da IA sai');
select is((select m.author_kind::text || '/' || m.status::text || '/' || coalesce(m.approved_by::text, 'sem aprovador')
             from public.messages m where m.id = (pg_temp.etapa('a1', 1)).message_id),
          'bot_ai/queued/sem aprovador', 'como bot_ai, na fila, sem rascunho aprovado (ramo 2a da porteira)');
select is((select r.acao || '/' || (r.message_id = (pg_temp.etapa('a1', 1)).message_id)::text
             from public.ia_respostas r where r.id = (pg_temp.etapa('a1', 1)).ia_resposta_id),
          'retomou/true', 'com a prova em ia_respostas (retomou)');
select is(public.ia_retomada_dizer((pg_temp.etapa('a1', 1)).id, 'De novo', '{}'::jsonb, null, null) ->> 'motivo',
          'ja_resolvida', 'a mesma retomada não sai duas vezes');
select throws_ok(
  $$insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
    values (pg_temp.id('a1'), 'out', 'text', 'queued', 'Oi de novo', 'bot_ai', 'crm')$$,
  '42501', null, 'texto da IA sem a prova continua barrado pela porteira');
select is(pg_temp.plano('a1') ->> 'tipo', 'modelo', 'depois do dia 1, a próxima de Ana é o modelo do dia 3');
-- O intervalo mínimo entre etapas: 60 h desde o texto empurram o dia 3 de Ana.
update public.app_settings set value = value || '{"intervalo_min_horas": 60}' where key = 'ia.retomada';
select ok((pg_temp.plano('a1') ->> 'devida_em')::timestamptz >= now() + interval '60 hours',
          'com 60 h de intervalo mínimo, o dia 3 de Ana espera 60 h depois do texto');
update public.app_settings set value = value || '{"intervalo_min_horas": 48}' where key = 'ia.retomada';
select pg_temp.sdr();
select is((public.ia_retomada_da_conversa(pg_temp.id('a1')) ->> 'modelo_pronto')::boolean, true,
          'o selo de Ana: o modelo do dia 3 está escolhido e aprovado');
select pg_temp.sair();

select is(public.ia_retomada_desistir((pg_temp.etapa('enc', 1)).id, 'o cliente fechou com outra imobiliária', true,
                                      null, 'retomar-conversa@v1') ->> 'ok', 'true',
          'a IA lê a conversa de Dora e decide não retomar');
select is(pg_temp.plano('enc') ->> 'motivo', 'a_ia_encerrou', 'e as etapas seguintes daquele silêncio não saem');

-- ---------------------------------------------------------------------
-- 7. Mudar os dias não repete o que já saiu
-- ---------------------------------------------------------------------
select pg_temp.silencio('troca', '+5584988814722', 'Sofia Sá', 73, 'Quero ver o T147AP');
update public.app_settings set value = value || '{"dias": [3, 7]}' where key = 'ia.retomada';
select app.ia_retomadas_rodar();
select pg_temp.decidir('troca', 3, 'segue', 'segue');
select app.ia_retomadas_rodar();
select is((pg_temp.etapa('troca', 3)).situacao, 'enviada', 'com os dias [3, 7], o dia 3 de Sofia sai');
update public.app_settings set value = value || '{"dias": [1, 3, 7]}' where key = 'ia.retomada';
select is((pg_temp.plano('troca') ->> 'dias')::int, 7,
          'a lista vira [1, 3, 7]: a próxima é o dia 7, nem o dia 1 nem o dia 3 de novo');
select app.ia_retomadas_rodar();
select is(pg_temp.modelos_de('troca'), 1, 'e nenhuma mensagem se repete');

-- ---------------------------------------------------------------------
-- 8. O horário, o imóvel empatado e a variável desconhecida
-- ---------------------------------------------------------------------
select pg_temp.silencio('noite', '+5584988814713', 'Iris Ito', 21, 'Qual o condomínio?');
select set_config('t147.janela', 'fechada', true);
select is(pg_temp.plano('noite') ->> 'tipo', 'modelo',
          'fora do horário até a janela de 24 h fechar: o dia 1 não cabe, e o plano passa ao dia 3');
select is(app.ia_retomadas_rodar(), 0, 'nada sai fora do horário');
select is((pg_temp.etapa('noite', 1)).motivo, 'sem_horario_permitido_nas_24_horas', 'e o dia 1 fica registrado como pulado');
select set_config('t147.janela', '', true);

select pg_temp.silencio('cid', '+5584988814714', 'Juca Jota', 73, 'Quero casa');
update public.app_settings set value = jsonb_set(value, '{modelos,3}', '"T147-CIDADE"') where key = 'ia.retomada';
select app.ia_retomadas_rodar();
select is((pg_temp.etapa('cid', 3)).motivo, 'variavel_que_a_retomada_nao_preenche: cidade',
          'modelo com variável desconhecida não sai (nem pede leitura), e fica o motivo');
update public.app_settings set value = jsonb_set(value, '{modelos,3}', '"T147-RETOMAR-3"') where key = 'ia.retomada';

select pg_temp.silencio('emp', '+5584988814723', 'Tina Tavares', 73, 'Gostei do T147AP e do T147CA');
select ok(app.ia_retomada_imovel(pg_temp.id('emp')) is null,
          'dois imóveis citados na mesma mensagem: empate, e o modelo fala do imóvel em geral');
select app.ia_retomadas_rodar();
select pg_temp.decidir('emp', 3, 'segue', 'segue');
select app.ia_retomadas_rodar();
select is((select m.template_params ->> 'imovel' from public.messages m
            where m.id = (pg_temp.etapa('emp', 3)).message_id),
          'que você estava vendo', 'no empate, o {{imovel}} é o texto genérico');

-- No treino, só a conversa do treino e as de teste.
select pg_temp.gestor();
select public.ia_atendente_configurar(jsonb_build_object('modo', 'treino'));
select pg_temp.sair();
select is(pg_temp.plano('noite') ->> 'motivo', 'a_ia_nao_atende', 'no modo treino, cliente de verdade não é retomado');
select pg_temp.gestor();
select public.ia_atendente_configurar(jsonb_build_object('modo', 'clientes'));
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 9. Quem respondeu depois, e a tela
-- ---------------------------------------------------------------------
select pg_temp.sdr();
select is(public.ia_retomada_da_conversa(pg_temp.id('a3')) ->> 'situacao', 'aguardando',
          'o plano de Bruna tem o dia 7 a caminho');
select is((public.ia_retomada_da_conversa(pg_temp.id('a3')) ->> 'modelo_pronto')::boolean, false,
          'mas o modelo do dia 7 não foi aprovado: o selo some');
select pg_temp.sair();

-- Ana responde de verdade; Bruna só reage com 👍; Sofia pede para sair.
select pg_temp.dele(pg_temp.id('a1'), -60, 'Tenho sim! Pode ser amanhã?');
insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, reage_a, created_at)
values (pg_temp.id('a3'), 'in', 'reaction', 'received', '👍', 'system', 'crm',
        (pg_temp.etapa('a3', 3)).message_id, now() + interval '1 minute');
select pg_temp.dele(pg_temp.id('troca'), -60, 'SAIR');
select app.suppress('phone', '+5584988814722', 'pgTAP 147', 'whatsapp'::app.channel, null::uuid);
select is(pg_temp.plano('a1') ->> 'motivo', 'o_cliente_falou_por_ultimo', 'Ana respondeu: a retomada para');

select pg_temp.sdr();
select is((public.ia_retomada_painel(7) -> 'placar' ->> 'enviadas')::int, 4,
          'o placar conta as retomadas que saíram (o texto de Ana e os modelos de Bruna, Sofia e Tina)');
select is((public.ia_retomada_painel(7) -> 'placar' ->> 'responderam')::int, 1,
          'responderam depois: só Ana (a reação de Bruna não conta, e Sofia pediu para sair)');
select is((public.ia_retomada_painel(7) -> 'placar' ->> 'pediram_para_sair')::int, 1,
          'quem pediu para sair conta à parte');
select is((public.ia_retomada_painel(7) -> 'placar' ->> 'sem_leitura')::int, 1, 'e a que não saiu sem leitura da IA');
select is((select (m ->> 'preenche')::boolean from jsonb_array_elements(public.ia_retomada_painel(7) -> 'modelos') m
            where m ->> 'codigo' = 'T147-CIDADE'), false,
          'o painel avisa o modelo com variável que a retomada não preenche');
select is((public.ia_retomada_painel(7) ->> 'pode_configurar')::boolean, false, 'o SDR vê, mas não configura');
select ok((select count(*) from public.ia_retomadas) >= 1, 'o SDR lê as retomadas');
select throws_ok(
  $$insert into public.ia_retomadas (conversation_id, ancora_em, etapa, dias, tipo, situacao)
    values (pg_temp.id('a3'), now(), 4, 9, 'modelo', 'enviada')$$,
  '42501', null, 'e não escreve nelas');
select pg_temp.sair();
select ok(not has_table_privilege('authenticated', 'public.ia_retomadas', 'insert, update, delete, truncate')
          and not has_table_privilege('anon', 'public.ia_retomadas', 'insert, update, delete, truncate')
          and not has_table_privilege('authenticated', 'public.ia_retomada_leituras', 'insert, update, delete, truncate')
          and not has_table_privilege('anon', 'public.ia_retomada_leituras', 'insert, update, delete, truncate'),
          'ninguém logado escreve, apaga nem esvazia (TRUNCATE) as retomadas e as leituras');
select is(app.ia_funil_retomadas(now() - interval '7 days', now() + interval '1 hour'),
          '{"retomadas": 4, "responderam_depois_da_retomada": 1}'::jsonb,
          'o funil da tela da IA conta os clientes retomados e os que responderam (sem reação nem opt-out)');

-- ---------------------------------------------------------------------
-- 10. `retomou` fora das contas da IA que atende
-- ---------------------------------------------------------------------
select pg_temp.sdr();
select is((public.ia_atendente_painel(7) -> 'placar' ->> 'respostas')::int,
          (select count(*)::int from public.ia_respostas r
            where r.message_id is not null and r.acao <> 'retomou' and r.criada_em >= now() - interval '7 days'),
          'o placar da IA que atende não conta a retomada como resposta');
select pg_temp.sair();
select ok(not exists (select 1 from app.relatorio_imova_ia_respostas(now() - interval '7 days', now() + interval '1 day') x
                       where x.acao = 'retomou'),
          'o relatório da IA não conta a retomada como atendimento');
select ok(not exists (select 1 from jsonb_array_elements(
                        public.ia_juiza_entrada(pg_temp.id('a1'), (now() at time zone 'America/Fortaleza')::date) -> 'acoes') a
                       where a ->> 'acao' = 'retomou'),
          'a juíza não lê a retomada como ação do atendimento');
select pg_temp.gestor();
select ok(public.ia_resposta_avaliar((pg_temp.etapa('a1', 1)).ia_resposta_id, 'corrigir',
                                     'Devia ter perguntado do condomínio') ->> 'caderno_id' is null,
          'o "Corrigir" de uma retomada não escreve no caderno da IA que atende');
select pg_temp.sair();
select is((select count(*)::int from public.ia_caderno k
            where k.message_id = (pg_temp.etapa('a1', 1)).message_id), 0, 'nenhuma linha no caderno');

-- Desligar para tudo.
select pg_temp.gestor();
select public.ia_retomada_configurar('{"ligada": false}'::jsonb);
select pg_temp.sair();
select is(pg_temp.plano('a7') ->> 'situacao', 'desligada', 'desligada, o selo some');
select ok(app.ia_funil_retomadas(now() + interval '1 day', now() + interval '2 days') is null,
          'desligada e sem retomada no período, o funil devolve null');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — O convite da Agenda e o imóvel de toda visita (migração
-- 20261111210000), só na Imova
--
-- Pedido de 11/11/2026: "Preciso que a IA envie o link da agenda para o
-- cliente marcar o horário da visita ao local ou horário da reunião. Caso seja
-- visita presencial, deverá ter o endereço e o código do imóvel/terreno que
-- será tratado." Este arquivo prova:
--
--   1. SÓ NA IMOVA: na KOMUNE nada existe, e o dossiê e a retenção não mudam;
--   2. O LINK E A CODIFICAÇÃO: `app.url_codificar` (acento, espaço, "+", "·",
--      reservados), o link montado pela ordem das perguntas e o texto exato da
--      opção, o link por tipo, o token, o link que o modelo escreveu sai, e o
--      campo do link (só admin, só https://calendly.com/...);
--   3. A PRÉVIA: o texto com a linha do imóvel, sem gravar; visita sem imóvel,
--      anúncio excluído e anúncio sem endereço recusados; o anúncio que não
--      está no ar passa com o aviso;
--   4. O ENVIO PELA EQUIPE: a mensagem pelo caminho normal (assinada, em fila)
--      e o convite; quem pode; fora da janela de 24 h; a porteira (contato
--      suprimido, conversa bloqueada); sem link configurado;
--   5. A IA: as travas (não atende, mensagem nova, já respondida, teto por
--      hora, porteira), o treino e o teste (como o responder), o código
--      resolvido como no Calendly, o link que o modelo escreveu sai, a ação
--      `enviou_link` e o convite `pela_ia`, e `convites_da_agenda` na entrada;
--   6. O CALENDLY COM CONVITE: a ficha da conversa mesmo com outro e-mail, o
--      telefone e o e-mail que faltavam, o tipo e o imóvel do convite, o
--      convite usado; usado por outro, inválido, inexistente e vencido seguem
--      como hoje; a remarcação continua com ele; o cancelamento o devolve; o
--      feriado continua recusando; a reunião fica ligada à conversa;
--   7. O CALENDLY SEM CONVITE: o imóvel pelo código e pelo endereço escrito; sem
--      imóvel, a tarefa "Confirmar o imóvel", uma vez só;
--   8. A AGENDA: `visita_marcar_com_imovel` e `visita_definir_imovel`;
--   9. O {{local}} DO LEMBRETE prefere o imóvel da visita;
--  10. A LGPD: o dossiê e a retenção;
--  11. OS PRIVILÉGIOS e a RLS.
--
-- O MESMO ARQUIVO RODA NOS DOIS BANCOS: as partes da Imova moram em funções
-- plpgsql (`pg_temp.parte_*`), que na KOMUNE saem como SKIP.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(130);

insert into public.allowed_users (email, role, note) values
  ('g157@teste.local', 'gestor', 'pgTAP 157'),
  ('s157@teste.local', 'sdr', 'pgTAP 157'),
  ('a157@teste.local', 'admin', 'pgTAP 157'),
  ('l157@teste.local', 'leitura', 'pgTAP 157'),
  ('e157@teste.local', 'embaixador', 'pgTAP 157');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000015701'::uuid, 'g157@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000015702'::uuid, 's157@teste.local', '{"full_name":"Sol Corretora"}'),
  ('a0000000-0000-4000-8000-000000015703'::uuid, 'a157@teste.local', '{"full_name":"Ada Admin"}'),
  ('a0000000-0000-4000-8000-000000015704'::uuid, 'l157@teste.local', '{"full_name":"Lia Leitura"}'),
  ('a0000000-0000-4000-8000-000000015705'::uuid, 'e157@teste.local', '{"full_name":"Eli Embaixador"}');

create function pg_temp.g() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000015701'::uuid $$;
create function pg_temp.s() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000015702'::uuid $$;
create function pg_temp.a() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000015703'::uuid $$;
create function pg_temp.l() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000015704'::uuid $$;
create function pg_temp.e() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000015705'::uuid $$;

create function pg_temp.na_komune() returns boolean language sql stable as
  $$ select coalesce((select i.empresa from app.identidade i) = 'komune', false) $$;

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

-- O ambiente: nada de automático falando por cima.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999915700"')
                                       || '{"assinar_com_nome": true}'::jsonb
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
insert into public.categories (slug, name, "group", priority, position, komune_category_key, is_active)
values ('comprador', 'Comprador', 'producao', 1, 900, null, true)
on conflict (slug) do update set is_active = true;

-- Os guardados: ids e respostas.
create temp table t157 (chave text primary key, valor uuid);
create temp table t157r (chave text primary key, r jsonb);
grant all on t157, t157r to authenticated, service_role;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select valor from t157 where chave = p $$;
create function pg_temp.r(p text) returns jsonb language sql stable as $$ select r from t157r where chave = p $$;
create function pg_temp.guardar(p text, v jsonb) returns jsonb language sql as
  $$ insert into t157r values (p, v) on conflict (chave) do update set r = excluded.r returning r $$;

create function pg_temp.fonte() returns int language sql stable as
  $$ select id from public.sources where slug = 'planilha' $$;

-- Um cliente: a ficha (ou não) e a conversa de WhatsApp com uma mensagem
-- RECEBIDA há `p_horas` horas (0 = a janela de 24 h aberta de verdade).
create function pg_temp.cliente(p_chave text, p_nome text, p_tel text, p_horas int default 0,
                                p_com_ficha boolean default true, p_tel_na_ficha boolean default true)
returns uuid language plpgsql as $$
declare v_org uuid; v_conv uuid; v_msg uuid;
begin
  if p_com_ficha then
    insert into public.organizations (name, phone_e164, source_id, collector)
    values (p_nome, case when p_tel_na_ficha then p_tel end, pg_temp.fonte(), 'pgtap157')
    returning id into v_org;
    insert into t157 values ('org:' || p_chave, v_org);
  end if;
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome,
                                    organization_id, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999915700', p_tel, p_nome, v_org, pg_temp.g(), 'aguardando_nos')
  returning id into v_conv;
  insert into t157 values ('conv:' || p_chave, v_conv);
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'Oi, quero ver o imóvel', 'system', 'crm', now() - make_interval(hours => p_horas))
  returning id into v_msg;
  insert into t157 values ('msg:' || p_chave, v_msg);
  return v_conv;
end $$;
-- Mais uma mensagem do cliente, `p_seg` segundos DEPOIS de agora.
create function pg_temp.chega(p_chave text, p_nome_msg text, p_seg int default 1) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, created_at)
  values (pg_temp.id('conv:' || p_chave), 'in'::app.msg_direction, 'text'::app.msg_type,
          'received'::app.msg_status, 'E o preço?', 'system', 'crm', now() + make_interval(secs => p_seg))
  returning id into v;
  insert into t157 values (p_nome_msg, v) on conflict (chave) do update set valor = excluded.valor;
  return v;
end $$;

-- O dia útil uns oito dias úteis à frente, e um feriado de teste depois dele.
create temp table t157_dia as
  select app.next_business_day((now() at time zone 'America/Fortaleza')::date, 8) as util;
alter table t157_dia add column feriado date;
update t157_dia
   set feriado = (select d::date from generate_series(util + 7, util + 150, interval '1 day') d
                   where app.eh_dia_util(d::date) order by d limit 1)
 where true;
insert into public.holidays (date, name, scope)
select feriado, 'Feriado de teste 157', 'municipal' from t157_dia;
grant select on t157_dia to authenticated, service_role;
create function pg_temp.util(p_hora time, p_mais int default 0) returns timestamptz language sql as
  $$ select ((case when p_mais = 0 then (select util from t157_dia)
                  else app.next_business_day((select util from t157_dia), p_mais) end) + p_hora)
            at time zone 'America/Fortaleza' $$;
create function pg_temp.feriado(p_hora time) returns timestamptz language sql as
  $$ select ((select feriado from t157_dia) + p_hora) at time zone 'America/Fortaleza' $$;

-- O aviso do Calendly, como a Edge Function monta (o 154 tem o mesmo).
create function pg_temp.uri(p text) returns text language sql as
  $$ select 'https://api.calendly.com/scheduled_events/EV157' || p || '/invitees/IN157' || p $$;
create function pg_temp.ev(p text, p_inicio timestamptz, p_extra jsonb default '{}'::jsonb,
                           p_tipo text default 'invitee.created')
returns jsonb language sql as $$
  select jsonb_build_object(
    'evento', p_tipo,
    'convidado_uri', pg_temp.uri(p),
    'evento_uri', 'https://api.calendly.com/scheduled_events/EV157' || p,
    'nome', 'Cliente ' || p,
    'email', 'c157' || lower(p) || '@cliente.local',
    'telefone', null,
    'inicio', p_inicio,
    'fim', p_inicio + interval '30 minutes',
    'tipo_de_evento', 'Agendamento Imova',
    'natureza', 'reuniao',
    'formato', 'online',
    'local', null,
    'link', 'https://meet.google.com/abc-defg-157',
    'anfitriao_email', 'contato@imova.local',
    'respostas', '[]'::jsonb,
    'remarcado', false,
    'convidado_anterior_uri', null,
    'cancelamento', null,
    'convite', null,
    'link_cancelar', 'https://calendly.com/cancellations/IN157' || p,
    'link_remarcar', 'https://calendly.com/reschedulings/IN157' || p) || p_extra
$$;
create function pg_temp.receber(p text, p_ev jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  execute 'set local role service_role';
  v := public.calendly_receber(p_ev);
  execute 'reset role';
  perform pg_temp.guardar(p, v);
  return v;
end $$;
create function pg_temp.ag(p text) returns jsonb language plpgsql as $$
begin
  return (select to_jsonb(a) from public.calendly_agendamentos a where a.convidado_uri = pg_temp.uri(p));
end $$;
create function pg_temp.convite(p_id uuid) returns jsonb language plpgsql as $$
begin
  return (select to_jsonb(c) from public.agenda_convites c where c.id = p_id);
end $$;
create function pg_temp.imovel(p_task uuid) returns jsonb language plpgsql as $$
begin
  return (select to_jsonb(v) from public.visita_imoveis v where v.task_id = p_task);
end $$;
create function pg_temp.token(p_id uuid) returns text language sql as
  $$ select pg_temp.convite(p_id) ->> 'token' $$;

-- ---------------------------------------------------------------------
-- 1. Só na Imova (prova nos dois bancos)
-- ---------------------------------------------------------------------
select is(to_regprocedure('public.agenda_link_previa(uuid, text, uuid, text)') is not null
          and to_regprocedure('public.agenda_enviar_link(uuid, text, uuid, text)') is not null
          and to_regprocedure('public.ia_atendente_enviar_link(uuid, uuid, text, text, text, bigint, text)') is not null
          and to_regprocedure('public.visita_marcar_com_imovel(uuid, timestamptz, uuid, uuid, uuid, text)') is not null
          and to_regprocedure('public.visita_definir_imovel(uuid, uuid, text)') is not null
          and to_regprocedure('public.calendly_link_configurar(text)') is not null,
          not pg_temp.na_komune(),
          'as seis funções do contrato existem na Imova, e não na KOMUNE');
select is(to_regclass('public.agenda_convites') is not null and to_regclass('public.visita_imoveis') is not null,
          not pg_temp.na_komune(), 'as duas tabelas também');
select is(position('convites_da_agenda' in pg_get_functiondef('app.lgpd_dossie(uuid)'::regprocedure)) > 0,
          not pg_temp.na_komune(), 'o dossiê da LGPD só muda na Imova');
select is(position('agenda_convites' in pg_get_functiondef('app.aplicar_retencao()'::regprocedure)) > 0,
          not pg_temp.na_komune(), 'a retenção também');
select ok(position('visita_imoveis' in pg_get_functiondef(
            'public.visita_marcar(uuid, timestamptz, uuid, uuid)'::regprocedure)) = 0,
          'a visita_marcar (a KOMUNE usa) fica intocada');

-- ---------------------------------------------------------------------
-- 2. O link e a codificação
-- ---------------------------------------------------------------------
create function pg_temp.parte_link() returns setof text language plpgsql as $parte$
declare
  v_cfg jsonb;
  v     jsonb;
  t1    text;
  t2    text;
begin
  if pg_temp.na_komune() then
    return next skip('O convite da Agenda é só da Imova', 20);
    return;
  end if;

  return next is(app.url_codificar('Visita a um imóvel'), 'Visita%20a%20um%20im%C3%B3vel',
                 'acento vira UTF-8 em %XX e espaço vira %20 (não "+")');
  return next is(app.url_codificar('+5584988815701'), '%2B5584988815701', 'o "+" do telefone vira %2B');
  return next is(app.url_codificar('IM9157 · Rua A, 10'), 'IM9157%20%C2%B7%20Rua%20A%2C%2010',
                 'o ponto do meio e a vírgula também');
  return next is(app.url_codificar('a&b=c?d#e/f%g'), 'a%26b%3Dc%3Fd%23e%2Ff%25g',
                 'os reservados (& = ? # / %) não quebram o link');
  return next is(app.url_codificar('AZaz09-_.~'), 'AZaz09-_.~', 'letras, números e - _ . ~ ficam');
  return next ok(app.url_codificar(null) is null and app.url_codificar('') = '', 'nulo é nulo; vazio é vazio');

  -- A configuração: o link confirmado e as perguntas na ordem do Calendly.
  return next is((select s.value ->> 'link' from public.app_settings s where s.key = 'calendly'),
                 'https://calendly.com/contato-imovaimobiliaria/30min', 'o link público confirmado foi gravado');
  return next ok((select s.value -> 'perguntas' = '{"tipo": "a1", "telefone": "a2", "imovel": "a3"}'::jsonb
                         and s.value -> 'opcoes' = '{"visita": "Visita a um imóvel", "reuniao": "Reunião"}'::jsonb
                         and s.value ? 'link_visita' and s.value ? 'link_reuniao'
                    from public.app_settings s where s.key = 'calendly'),
                 'perguntas, opcoes, link_visita e link_reuniao (nulos) como no contrato');

  v_cfg := app.calendly_config();
  return next is(app.agenda_link_montar(v_cfg, 'visita', 'Maria Souza', '+5584988815701',
                                        'IM9157 · Rua Teste 157, 10, Ponta Negra, Natal', 'ia', 'abc123def456'),
                 'https://calendly.com/contato-imovaimobiliaria/30min?name=Maria%20Souza'
                 || '&a1=Visita%20a%20um%20im%C3%B3vel&a2=%2B5584988815701'
                 || '&a3=IM9157%20%C2%B7%20Rua%20Teste%20157%2C%2010%2C%20Ponta%20Negra%2C%20Natal'
                 || '&utm_source=crm&utm_medium=whatsapp&utm_campaign=ia&utm_content=abc123def456',
                 'o link da visita: nome, a opção exata, o telefone, o imóvel e os quatro UTM');
  return next is(app.agenda_link_montar(v_cfg, 'reuniao', 'João', null, 'IM9157 · não vai', 'equipe', null),
                 'https://calendly.com/contato-imovaimobiliaria/30min?name=Jo%C3%A3o&a1=Reuni%C3%A3o'
                 || '&utm_source=crm&utm_medium=whatsapp&utm_campaign=equipe',
                 'a reunião: sem imóvel, sem telefone quando não há, e sem token na prévia');
  return next is(app.agenda_link_montar(v_cfg || '{"link_visita": "https://calendly.com/imova/visita?hide_gdpr_banner=1",
                                                   "perguntas": {"tipo": "a2", "telefone": "x9", "imovel": "a2"}}'::jsonb,
                                        'visita', null, '+5584', 'IM1', 'ia', 'tok0000000aa'),
                 'https://calendly.com/imova/visita?hide_gdpr_banner=1&a2=Visita%20a%20um%20im%C3%B3vel'
                 || '&utm_source=crm&utm_medium=whatsapp&utm_campaign=ia&utm_content=tok0000000aa',
                 'link_visita vale no lugar de link; com "?" na base, os parâmetros entram com "&"; pergunta sem a1..a10 e pergunta repetida não vão');
  return next ok(app.agenda_link_montar(v_cfg - 'link', 'visita', 'X', null, null, 'ia', null) is null
                 and app.agenda_link_base('{"link": "http://calendly.com/x"}'::jsonb, 'reuniao') is null,
                 'sem link, ou com link que não é https, não há link');

  t1 := app.agenda_token_novo();
  t2 := app.agenda_token_novo();
  return next ok(t1 ~ '^[a-z0-9]{12}$' and t2 ~ '^[a-z0-9]{12}$' and t1 <> t2,
                 'o token é sorteado: 12 caracteres de [a-z0-9], um diferente do outro');
  return next is(app.agenda_sem_link('Pode escolher aqui: https://calendly.com/outro/30min ou www.x.com.br, viu?'),
                 'Pode escolher aqui: ou viu?', 'o link que o modelo escreveu sai do texto');

  -- O campo do link (só admin, só https://calendly.com/...).
  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  return next is(public.calendly_link_configurar('https://calendly.com/imova/30min'),
                 '{"ok": false, "motivo": "sem_permissao"}'::jsonb,
                 'o gestor não troca o link: é campo do admin (sem exceção)');
  perform pg_temp.sair();
  perform pg_temp.entrar(pg_temp.a(), 'admin');
  return next ok(public.calendly_link_configurar('https://evil.example/calendly.com/x') = '{"ok": false, "motivo": "link_invalido"}'::jsonb
                 and public.calendly_link_configurar('http://calendly.com/imova/30min') ->> 'motivo' = 'link_invalido'
                 and public.calendly_link_configurar('') ->> 'motivo' = 'link_invalido'
                 and public.calendly_link_configurar(null) ->> 'motivo' = 'link_invalido',
                 'só aceita https://calendly.com/..., e recusa sem levantar exceção');
  return next is(public.calendly_link_configurar('https://calendly.com/imova/visita?month=2026-11#x'),
                 '{"ok": true, "link": "https://calendly.com/imova/visita"}'::jsonb,
                 'o link volta limpo, sem nada depois do "?"');
  update public.app_settings set value = value || '{"google_agenda_id": "agenda157@group.calendar.google.com"}'
   where key = 'calendly';
  v := public.calendly_link_configurar(' https://calendly.com/contato-imovaimobiliaria/30min/ ');
  perform pg_temp.sair();
  return next is(v ->> 'link', 'https://calendly.com/contato-imovaimobiliaria/30min', 'o admin grava (sem a barra do fim)');
  return next is((select s.value ->> 'google_agenda_id' from public.app_settings s where s.key = 'calendly'),
                 'agenda157@group.calendar.google.com', 'e o resto da configuração fica como estava');
  return next is((select count(*)::int from public.app_settings where key = 'calendly'), 1, 'uma linha só');
end $parte$;
select * from pg_temp.parte_link();

-- ---------------------------------------------------------------------
-- Os anúncios e os clientes (só na Imova)
-- ---------------------------------------------------------------------
create function pg_temp.montar() returns void language plpgsql as $$
declare v uuid;
begin
  if pg_temp.na_komune() then return; end if;
  -- Quem atende o Calendly é o gestor.
  update public.app_settings set value = value || '{"dono_email": "g157@teste.local"}' where key = 'calendly';

  insert into public.anuncios (codigo, situacao, titulo, endereco, numero, bairro, cidade, estado)
  values ('IM9157', 'no_ar', 'Apartamento 157', 'Rua Teste 157', '10', 'Ponta Negra', 'Natal', 'RN') returning id into v;
  insert into t157 values ('an:IM9157', v);
  insert into public.anuncios (codigo, situacao, titulo, endereco, numero, complemento, bairro, cidade)
  values ('TE9158_IMOVA', 'rascunho', 'Terreno 158', 'Avenida 158, 900', '900', 'Lote 3', 'Pium', 'Nísia Floresta') returning id into v;
  insert into t157 values ('an:TE9158', v);
  insert into public.anuncios (codigo, situacao, titulo, endereco, numero, bairro, cidade, excluido_em)
  values ('IM9159', 'no_ar', 'Excluído 159', 'Rua 159', '1', 'Tirol', 'Natal', now()) returning id into v;
  insert into t157 values ('an:IM9159', v);
  insert into public.anuncios (codigo, situacao, titulo) values ('IM9160', 'pausado', 'Sem endereço 160') returning id into v;
  insert into t157 values ('an:IM9160', v);

  perform pg_temp.cliente('maria', 'Maria Souza 157', '+5584988815701', 0, true, false);
  perform pg_temp.cliente('beto', 'Beto Outro 157', '+5584988815702');
  update public.organizations set email = 'beto157@cliente.local' where id = pg_temp.id('org:beto');
  perform pg_temp.cliente('velho', 'Vera Velha 157', '+5584988815703', 50);
  perform pg_temp.cliente('sup', 'Sid Suprimido 157', '+5584988815704');
  update public.organizations set do_not_contact = true where id = pg_temp.id('org:sup');
  perform pg_temp.cliente('bloq', 'Bia Bloqueada 157', '+5584988815705');
  update public.conversations set bloqueada_em = now(), bloqueada_por = pg_temp.g() where id = pg_temp.id('conv:bloq');
  perform pg_temp.cliente('rena', 'Renata Reunião 157', '+5584988815706');
  perform pg_temp.cliente('feri', 'Fábio Feriado 157', '+5584988815707');
  -- A IA: a conversa do treino, uma de teste e uma de cliente.
  perform pg_temp.cliente('treino', 'Janio Treino 157', '+5584988815711');
  perform pg_temp.cliente('teste', 'Matheu Teste 157', '+5584988815712');
  perform pg_temp.cliente('cli', 'Clara Cliente 157', '+5584988815713');
  perform pg_temp.cliente('iasup', 'Ivo Suprimido 157', '+5584988815714');
  update public.organizations set do_not_contact = true where id = pg_temp.id('org:iasup');
  delete from public.app_settings where key = 'ia.atendente';
  insert into public.app_settings (key, value)
  values ('ia.atendente', jsonb_build_object('ligada', true, 'modo', 'treino', 'teto_por_hora', 20,
                                             'conversa_de_treino', pg_temp.id('conv:treino'),
                                             'conversas_de_teste', jsonb_build_array(pg_temp.id('conv:teste'))));
end $$;
select pg_temp.montar();

create temp table t157_antes as
  select (select count(*) from public.messages) as mensagens;
-- A contagem de convites só existe na Imova.
create function pg_temp.convites() returns bigint language plpgsql as $$
begin
  return (select count(*) from public.agenda_convites);
end $$;

-- ---------------------------------------------------------------------
-- 3. A prévia
-- ---------------------------------------------------------------------
create function pg_temp.parte_previa() returns setof text language plpgsql as $parte$
declare
  v jsonb;
  v_msgs bigint := (select count(*) from public.messages);
begin
  if pg_temp.na_komune() then
    return next skip('O convite da Agenda é só da Imova', 11);
    return;
  end if;

  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  v := public.agenda_link_previa(pg_temp.id('conv:maria'), 'visita', pg_temp.id('an:IM9157'));
  return next ok((v ->> 'ok')::boolean and v ->> 'codigo' = 'IM9157'
                 and v ->> 'endereco' = 'Rua Teste 157, 10, Ponta Negra, Natal'
                 and v ->> 'titulo' = 'Apartamento 157' and not v ? 'aviso',
                 'a prévia da visita: código, endereço e título do anúncio');
  return next is(v ->> 'texto',
                 'Para marcar a visita, é só escolher o melhor dia e horário pelo link abaixo. Seus dados já vão preenchidos.'
                 || E'\n\nImóvel: IM9157 · Rua Teste 157, 10, Ponta Negra, Natal\n' || (v ->> 'link'),
                 'o texto: curto, a linha do imóvel e o link, cada um na sua linha');
  return next ok(v ->> 'link' like 'https://calendly.com/contato-imovaimobiliaria/30min?name=Maria%20Souza%20157&a1=Visita%20a%20um%20im%C3%B3vel&a2=%2B5584988815701&a3=IM9157%20%C2%B7%20%'
                 and v ->> 'link' like '%&utm_campaign=equipe' and v ->> 'link' not like '%utm_content%',
                 'o link da prévia leva o telefone da conversa (a ficha não tem) e não leva token');
  v := public.agenda_link_previa(pg_temp.id('conv:maria'), 'reuniao');
  return next ok((v ->> 'ok')::boolean and v ->> 'texto' not like '%Imóvel:%' and v ->> 'codigo' is null
                 and v ->> 'texto' like 'Para marcar a reunião,%',
                 'a prévia da reunião não tem linha de imóvel');
  v := public.agenda_link_previa(pg_temp.id('conv:maria'), 'visita', pg_temp.id('an:IM9157'), '  Oi, Maria! Segue a agenda.  ');
  return next is(v ->> 'texto',
                 E'Oi, Maria! Segue a agenda.\n\nImóvel: IM9157 · Rua Teste 157, 10, Ponta Negra, Natal\n' || (v ->> 'link'),
                 'com p_texto, a prévia troca o começo padrão pelo que a pessoa escreveu (começo + imóvel + link)');
  insert into t157r values ('previa:maria', v);
  return next is(public.agenda_link_previa(pg_temp.id('conv:maria'), 'reuniao', null, repeat('x', 1001)) ->> 'motivo',
                 'texto_longo', 'na prévia, o começo longo demais é recusado como no envio');
  return next is(public.agenda_link_previa(pg_temp.id('conv:maria'), 'visita') ->> 'motivo', 'visita_sem_imovel',
                 'visita sem imóvel é recusada');
  return next ok(public.agenda_link_previa(pg_temp.id('conv:maria'), 'visita', pg_temp.id('an:IM9159')) ->> 'motivo' = 'anuncio_invalido'
                 and public.agenda_link_previa(pg_temp.id('conv:maria'), 'visita', gen_random_uuid()) ->> 'motivo' = 'anuncio_invalido',
                 'anúncio excluído ou que não existe: anuncio_invalido');
  v := public.agenda_link_previa(pg_temp.id('conv:maria'), 'visita', pg_temp.id('an:IM9160'));
  return next ok(v ->> 'motivo' = 'visita_sem_imovel' and v ->> 'detalhe' = 'anuncio_sem_endereco',
                 'anúncio sem endereço: a visita fica sem imóvel, e o detalhe diz por quê');
  v := public.agenda_link_previa(pg_temp.id('conv:maria'), 'visita', pg_temp.id('an:TE9158'));
  return next ok((v ->> 'ok')::boolean and v ->> 'aviso' = 'anuncio_nao_esta_no_ar'
                 and v ->> 'endereco' = 'Avenida 158, 900, Lote 3, Pium, Nísia Floresta'
                 and v ->> 'codigo' = 'TE9158_IMOVA',
                 'anúncio em rascunho passa, com o aviso anuncio_nao_esta_no_ar (e o número não repete)');
  return next ok(public.agenda_link_previa(pg_temp.id('conv:maria'), 'jantar') ->> 'motivo' = 'tipo_invalido'
                 and (select count(*) from public.messages) = v_msgs and pg_temp.convites() = 0,
                 'tipo inválido recusado, e a prévia não grava nada');
  perform pg_temp.sair();
end $parte$;
select * from pg_temp.parte_previa();

-- ---------------------------------------------------------------------
-- 4. O envio pela equipe
-- ---------------------------------------------------------------------
create function pg_temp.parte_envio() returns setof text language plpgsql as $parte$
declare
  v   jsonb;
  m   public.messages%rowtype;
  c   jsonb;
  v_n bigint;
begin
  if pg_temp.na_komune() then
    return next skip('O convite da Agenda é só da Imova', 16);
    return;
  end if;

  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  v := pg_temp.guardar('envio', public.agenda_enviar_link(pg_temp.id('conv:maria'), 'visita',
                                                          pg_temp.id('an:IM9157'), '  Oi, Maria! Segue a agenda.  '));
  perform pg_temp.sair();
  return next ok((v ->> 'ok')::boolean and v ->> 'mensagem_id' is not null and v ->> 'convite_id' is not null,
                 'a equipe manda: mensagem e convite');
  insert into t157 values ('cv:maria', (v ->> 'convite_id')::uuid);
  select * into m from public.messages where id = (v ->> 'mensagem_id')::uuid;
  c := pg_temp.convite((v ->> 'convite_id')::uuid);
  return next ok(m.direction = 'out' and m.author_kind = 'human' and m.sent_by = pg_temp.g()
                 and m.status = 'queued' and m.origin = 'crm' and m.type = 'text',
                 'a mensagem é a da caixa de resposta: de gente, em fila, pelo CRM');
  return next is(m.body, E'*Gil:*\nOi, Maria! Segue a agenda.\n\nImóvel: IM9157 · Rua Teste 157, 10, Ponta Negra, Natal\n'
                         || (v ->> 'link'),
                 'o corpo: a assinatura de quem manda, o começo que a pessoa escreveu, o imóvel e o link');
  return next is(m.body, E'*Gil:*\n' || replace(pg_temp.r('previa:maria') ->> 'texto', pg_temp.r('previa:maria') ->> 'link', v ->> 'link'),
                 'o que sai é a prévia com o mesmo p_texto (só o link ganha o token)');
  return next ok(v ->> 'link' like '%&utm_source=crm&utm_medium=whatsapp&utm_campaign=equipe&utm_content=' || (c ->> 'token')
                 and c ->> 'token' ~ '^[a-z0-9]{12}$',
                 'o link leva o token do convite no utm_content');
  return next ok(c ->> 'tipo' = 'visita' and (c ->> 'anuncio_id')::uuid = pg_temp.id('an:IM9157')
                 and c ->> 'imovel_codigo' = 'IM9157' and c ->> 'endereco' = 'Rua Teste 157, 10, Ponta Negra, Natal'
                 and (c ->> 'criado_por')::uuid = pg_temp.g() and not (c ->> 'pela_ia')::boolean
                 and c ->> 'link' = v ->> 'link' and (c ->> 'mensagem_id')::uuid = m.id
                 and (c ->> 'organization_id')::uuid = pg_temp.id('org:maria') and c ->> 'usado_em' is null,
                 'o convite: tipo, imóvel, quem mandou, o link exato e a mensagem');
  return next ok((c ->> 'expira_em')::timestamptz between now() + interval '29 days' and now() + interval '31 days',
                 'o convite vale 30 dias');

  -- Quem pode.
  perform pg_temp.entrar(pg_temp.l(), 'leitura');
  return next is(public.agenda_enviar_link(pg_temp.id('conv:maria'), 'reuniao') ->> 'motivo', 'sem_permissao',
                 'o papel de leitura vê, mas não escreve: sem_permissao');
  perform pg_temp.sair();
  perform pg_temp.entrar(pg_temp.e(), 'embaixador');
  return next ok(public.agenda_enviar_link(pg_temp.id('conv:maria'), 'reuniao') ->> 'motivo' = 'sem_permissao'
                 and public.agenda_link_previa(pg_temp.id('conv:maria'), 'reuniao') ->> 'motivo' = 'sem_permissao',
                 'quem não vê a conversa não manda nem vê a prévia');
  perform pg_temp.sair();
  return next is(public.agenda_enviar_link(pg_temp.id('conv:maria'), 'reuniao') ->> 'motivo', 'sem_permissao',
                 'sem sessão: sem_permissao');

  perform pg_temp.entrar(pg_temp.s(), 'sdr');
  v_n := pg_temp.convites();
  return next is(public.agenda_enviar_link(pg_temp.id('conv:velho'), 'reuniao') ->> 'motivo', 'fora_da_janela',
                 'mais de 24 h desde a última mensagem do cliente: fora_da_janela');
  v := public.agenda_enviar_link(pg_temp.id('conv:sup'), 'reuniao');
  return next ok(v ->> 'motivo' = 'nao_pode_enviar' and v ->> 'detalhe' = 'contato_suprimido',
                 'contato suprimido: nao_pode_enviar, com o motivo da porteira');
  v := public.agenda_enviar_link(pg_temp.id('conv:bloq'), 'reuniao');
  return next ok(v ->> 'motivo' = 'nao_pode_enviar' and v ->> 'detalhe' = 'conversa_bloqueada',
                 'conversa bloqueada: a porteira recusa o insert, e o envio diz nao_pode_enviar');
  return next is(public.agenda_enviar_link(pg_temp.id('conv:maria'), 'reuniao', null, repeat('x', 1001)) ->> 'motivo',
                 'texto_longo', 'começo de mensagem longo demais é recusado');
  perform pg_temp.sair();
  return next ok(pg_temp.convites() = v_n
                 and not exists (select 1 from public.messages x
                                  where x.conversation_id in (pg_temp.id('conv:velho'), pg_temp.id('conv:sup'),
                                                              pg_temp.id('conv:bloq'))
                                    and x.direction = 'out'),
                 'nada recusado deixa convite ou mensagem');

  -- Sem link configurado.
  update public.app_settings set value = value - 'link' where key = 'calendly';
  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  v := public.agenda_enviar_link(pg_temp.id('conv:rena'), 'reuniao');
  perform pg_temp.sair();
  update public.app_settings set value = value || '{"link": "https://calendly.com/contato-imovaimobiliaria/30min"}'
   where key = 'calendly';
  return next is(v ->> 'motivo', 'sem_link_configurado', 'sem link gravado: sem_link_configurado');
end $parte$;
select * from pg_temp.parte_envio();

-- ---------------------------------------------------------------------
-- 5. A IA manda o link
-- ---------------------------------------------------------------------
create function pg_temp.ia(p_conv text, p_resp text, p_tipo text, p_cod text, p_texto text) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  execute 'set local role service_role';
  v := public.ia_atendente_enviar_link(pg_temp.id('conv:' || p_conv), pg_temp.id(p_resp), p_tipo, p_cod, p_texto,
                                       null, 'atendente-imova@v3');
  execute 'reset role';
  return v;
end $$;

create function pg_temp.parte_ia() returns setof text language plpgsql as $parte$
declare
  v   jsonb;
  m   public.messages%rowtype;
  r   public.ia_respostas%rowtype;
  c   jsonb;
  e   jsonb;
  v_n bigint;
begin
  if pg_temp.na_komune() then
    return next skip('O convite da Agenda é só da Imova', 17);
    return;
  end if;

  -- As travas que vêm antes do texto.
  return next is(pg_temp.ia('cli', 'msg:cli', 'visita', 'IM9157', 'Segue o link') ->> 'motivo', 'ia_nao_atende',
                 'no treino, a conversa de um cliente não é da IA: ia_nao_atende (como o responder)');
  return next is(public.ia_atendente_responder(pg_temp.id('conv:cli'), pg_temp.id('msg:cli'), 'Oi') ->> 'motivo',
                 'ia_nao_atende', 'e o responder diz o mesmo');
  return next is(pg_temp.ia('treino', 'msg:treino', 'jantar', null, 'x') ->> 'motivo', 'tipo_invalido', 'tipo inválido');
  return next ok(pg_temp.ia('treino', 'msg:treino', 'visita', null, 'x') ->> 'motivo' = 'visita_sem_imovel'
                 and pg_temp.ia('treino', 'msg:treino', 'visita', '   ', 'x') ->> 'motivo' = 'visita_sem_imovel',
                 'visita sem código: visita_sem_imovel');
  return next ok(pg_temp.ia('treino', 'msg:treino', 'visita', 'IM9999157', 'x') ->> 'motivo' = 'imovel_desconhecido'
                 and pg_temp.ia('treino', 'msg:treino', 'visita', 'IM9159', 'x') ->> 'motivo' = 'imovel_desconhecido',
                 'código que não é de anúncio, ou de anúncio excluído: imovel_desconhecido');

  -- No treino: manda, como o responder manda no treino.
  v := pg_temp.ia('treino', 'msg:treino', 'visita', 'im 9157',
                  'Que bom! Escolha o horário por aqui: https://calendly.com/inventado/x');
  insert into t157 values ('cv:treino', (v ->> 'convite_id')::uuid);
  return next ok((v ->> 'ok')::boolean and v ->> 'mensagem_id' is not null and v ->> 'resposta_id' is not null,
                 'na conversa do treino a IA manda o link (o código "im 9157" é resolvido como no Calendly)');
  select * into m from public.messages where id = (v ->> 'mensagem_id')::uuid;
  return next is(m.body, E'*Imova:*\nQue bom! Escolha o horário por aqui:\n\nImóvel: IM9157 · Rua Teste 157, 10, Ponta Negra, Natal\n'
                         || (v ->> 'link'),
                 'a mensagem: assinada Imova, o texto do modelo SEM o link que ele inventou, o imóvel e o link do banco');
  return next ok(m.author_kind = 'bot_ai' and m.approved_by is null and m.status = 'queued'
                 and v ->> 'link' like '%utm_campaign=ia&utm_content=%',
                 'sai em fila, como bot_ai sem aprovador, com o link da campanha ia');
  select * into r from public.ia_respostas where id = (v ->> 'resposta_id')::uuid;
  return next ok(r.acao = 'enviou_link' and r.message_id = m.id and r.em_resposta_a = pg_temp.id('msg:treino')
                 and r.prompt_version = 'atendente-imova@v3' and r.corpo = m.body
                 and (r.detalhes ->> 'convite_id')::uuid = (v ->> 'convite_id')::uuid
                 and (r.detalhes ->> 'o_modelo_escreveu_link')::boolean,
                 'a resposta fica em ia_respostas como a do responder, com a ação enviou_link');
  c := pg_temp.convite((v ->> 'convite_id')::uuid);
  return next ok((c ->> 'pela_ia')::boolean and c ->> 'criado_por' is null and c ->> 'imovel_codigo' = 'IM9157'
                 and (c ->> 'mensagem_id')::uuid = m.id and c ->> 'link' = v ->> 'link',
                 'o convite é pela_ia, sem pessoa, com o imóvel e a mensagem');

  -- As travas do responder.
  v_n := pg_temp.convites();
  return next is(pg_temp.ia('treino', 'msg:treino', 'reuniao', null, 'De novo') ->> 'motivo', 'ja_respondida',
                 'a mesma mensagem não é respondida duas vezes');
  perform pg_temp.chega('treino', 'msg:treino2');
  return next is(pg_temp.ia('treino', 'msg:treino', 'reuniao', null, 'Velha') ->> 'motivo', 'chegou_mensagem_nova',
                 'chegou mensagem nova do cliente: a resposta velha não sai');
  update public.app_settings set value = value || '{"teto_por_hora": 1}' where key = 'ia.atendente';
  return next is(pg_temp.ia('treino', 'msg:treino2', 'reuniao', null, 'Teto') ->> 'motivo', 'teto_por_hora',
                 'o teto por hora vale');
  update public.app_settings set value = value || '{"teto_por_hora": 20}' where key = 'ia.atendente';
  return next is(pg_temp.convites(), v_n, 'nenhuma trava deixa convite');

  -- A conversa de teste, e com clientes; a porteira; a IA parada.
  v := pg_temp.ia('teste', 'msg:teste', 'reuniao', null, null);
  return next ok((v ->> 'ok')::boolean
                 and (select x.body from public.messages x where x.id = (v ->> 'mensagem_id')::uuid)
                     like E'*Imova:*\nPara marcar a reunião,%',
                 'na conversa de teste também, e sem texto do modelo vai o começo padrão');
  update public.app_settings set value = value || '{"modo": "clientes"}' where key = 'ia.atendente';
  v := pg_temp.ia('iasup', 'msg:iasup', 'reuniao', null, 'Segue');
  return next ok(v ->> 'motivo' = 'porteira'
                 and exists (select 1 from public.ia_respostas x
                              where x.conversation_id = pg_temp.id('conv:iasup') and x.acao = 'nao_respondeu'
                                and x.detalhes ->> 'quis' = 'enviou_link' and x.message_id is null)
                 and not exists (select 1 from public.agenda_convites x where x.conversation_id = pg_temp.id('conv:iasup')),
                 'contato suprimido: a porteira recusa, fica o nao_respondeu, e não nasce convite');
  insert into public.ia_atendimento (conversation_id, estado, motivo) values (pg_temp.id('conv:cli'), 'parada', 'pgTAP');
  return next is(pg_temp.ia('cli', 'msg:cli', 'reuniao', null, 'x') ->> 'motivo', 'ia_nao_atende',
                 'com clientes, a conversa em que a IA foi parada continua de fora');
  update public.app_settings set value = value || '{"modo": "treino"}' where key = 'ia.atendente';

  -- A entrada da IA: os 5 convites mais novos.
  insert into public.agenda_convites (token, conversation_id, tipo, link, pela_ia, criado_em)
  select 'pgtap157x' || lpad(g::text, 3, '0'), pg_temp.id('conv:treino'), 'reuniao',
         'https://calendly.com/contato-imovaimobiliaria/30min', true, now() - make_interval(days => g)
    from generate_series(1, 6) g;
  e := public.ia_entrada_do_atendente(pg_temp.id('conv:treino')) -> 'convites_da_agenda';
  return next ok(jsonb_array_length(e) = 5 and e -> 0 ->> 'tipo' = 'visita' and e -> 0 ->> 'imovel_codigo' = 'IM9157'
                 and not (e -> 0 ->> 'agendado')::boolean
                 and (e -> 0 ->> 'enviado_em')::timestamptz = (pg_temp.convite(pg_temp.id('cv:treino')) ->> 'criado_em')::timestamptz
                 and (e -> 1 ->> 'enviado_em')::timestamptz > (e -> 4 ->> 'enviado_em')::timestamptz
                 and e -> 0 ?& array['tipo', 'imovel_codigo', 'enviado_em', 'agendado'],
                 'convites_da_agenda: no máximo 5, mais novos primeiro, com tipo, imovel_codigo, enviado_em e agendado');
end $parte$;
select * from pg_temp.parte_ia();

-- ---------------------------------------------------------------------
-- 6. O Calendly com o convite
-- ---------------------------------------------------------------------
create function pg_temp.parte_com_convite() returns setof text language plpgsql as $parte$
declare
  v_tok text;
  v     jsonb;
  a     jsonb;
  c     jsonb;
  v_cv  uuid;
begin
  if pg_temp.na_komune() then
    return next skip('O convite da Agenda é só da Imova', 20);
    return;
  end if;
  v_tok := pg_temp.token(pg_temp.id('cv:maria'));

  -- A Maria marca com o e-mail e o telefone do Beto (outra ficha) e responde
  -- "Reunião": vale o convite.
  v := pg_temp.receber('C1', pg_temp.ev('C1', pg_temp.util('09:30'), jsonb_build_object(
         'convite', upper(v_tok), 'email', 'beto157@cliente.local', 'telefone', '+5584988815702',
         'respostas', '[{"pergunta": "O que você quer marcar?", "resposta": "Reunião"}]'::jsonb)));
  a := pg_temp.ag('C1');
  return next ok(v ->> 'situacao' = 'agendado' and v ->> 'convite' = 'valido'
                 and (v ->> 'convite_id')::uuid = pg_temp.id('cv:maria'),
                 'o convite do link vale (o token chega em maiúsculas e é lido igual)');
  return next is((a ->> 'organization_id')::uuid, pg_temp.id('org:maria'),
                 'a ficha é a da conversa do convite, mesmo com o e-mail e o telefone de outra ficha');
  return next ok(v ->> 'natureza' = 'visita' and a ->> 'natureza' = 'visita'
                 and (select t.kind from public.tasks t where t.id = (v ->> 'task_id')::uuid) = 'visit',
                 'o tipo é o do convite (visita), e não o da resposta (reunião)');
  return next ok(pg_temp.imovel((v ->> 'task_id')::uuid) @> jsonb_build_object(
                   'codigo', 'IM9157', 'endereco', 'Rua Teste 157, 10, Ponta Negra, Natal', 'origem', 'convite',
                   'anuncio_id', pg_temp.id('an:IM9157'))
                 and a ->> 'local' = 'Rua Teste 157, 10, Ponta Negra, Natal (anúncio IM9157)'
                 and (a ->> 'anuncio_id')::uuid = pg_temp.id('an:IM9157'),
                 'o imóvel da visita é o do convite (visita_imoveis origem convite, e o local do agendamento)');
  c := pg_temp.convite(pg_temp.id('cv:maria'));
  return next ok(c ->> 'usado_em' is not null and (c ->> 'calendly_agendamento_id')::uuid = (a ->> 'id')::uuid,
                 'o convite fica usado e ligado ao agendamento');
  return next ok((select o.email::text = 'beto157@cliente.local' and o.phone_e164 is null
                    from public.organizations o where o.id = pg_temp.id('org:maria')),
                 'a ficha ganha o e-mail que faltava; o telefone de outra ficha não entra');
  return next ok(exists (select 1 from public.activities x
                          where x.organization_id = pg_temp.id('org:maria')
                            and x.body like 'Visita agendada pelo cliente no Calendly para %. Pelo link que Gil mandou na conversa. Imóvel: IM9157 · Rua Teste 157, 10, Ponta Negra, Natal.%'),
                 'a nota da ficha diz que veio pelo link do Gil, com o imóvel');

  -- O mesmo token, outro convidado: usado; segue como hoje.
  v := pg_temp.receber('C2', pg_temp.ev('C2', pg_temp.util('11:00'), jsonb_build_object('convite', v_tok,
         'telefone', '+5584988815702')));
  return next ok(v ->> 'convite' = 'usado' and v ->> 'convite_id' is null
                 and (pg_temp.ag('C2') ->> 'organization_id')::uuid = pg_temp.id('org:beto')
                 and v ->> 'natureza' = 'reuniao',
                 'convite usado por outro convidado: segue como sem convite (a ficha pelo telefone)');
  -- Inválido e inexistente.
  v := pg_temp.receber('C3', pg_temp.ev('C3', pg_temp.util('13:00'), '{"convite": "nao-e-token!"}'));
  return next ok(v ->> 'convite' = 'inexistente' and v ->> 'situacao' = 'agendado'
                 and (pg_temp.ag('C3') ->> 'ficha') = 'criada',
                 'token com formato errado: inexistente, e a ficha é procurada como hoje');
  v := pg_temp.receber('C4', pg_temp.ev('C4', pg_temp.util('14:00'), '{"convite": "zzzzzzzzzzzz"}'));
  return next is(v ->> 'convite', 'inexistente', 'token que não existe: inexistente');

  -- A remarcação, sem o token: o convite continua, preso ao agendamento novo.
  v := pg_temp.receber('C1R', pg_temp.ev('C1R', pg_temp.util('15:00'), jsonb_build_object(
         'convidado_anterior_uri', pg_temp.uri('C1'), 'email', 'outro157@cliente.local')));
  c := pg_temp.convite(pg_temp.id('cv:maria'));
  return next ok(v ->> 'situacao' = 'agendado' and v ->> 'convite' = 'valido' and v ->> 'natureza' = 'visita'
                 and (c ->> 'calendly_agendamento_id')::uuid = (pg_temp.ag('C1R') ->> 'id')::uuid
                 and pg_temp.ag('C1') ->> 'situacao' = 'remarcado'
                 and (pg_temp.ag('C1R') ->> 'organization_id')::uuid = pg_temp.id('org:maria'),
                 'remarcou: o mesmo convidado continua com o convite (tipo, ficha e imóvel), e o velho fecha como remarcado');
  return next ok(pg_temp.imovel((v ->> 'task_id')::uuid) ->> 'origem' = 'convite', 'a visita nova também tem o imóvel');
  -- O Calendly avisa a primeira metade da remarcação: o convite não sai do novo.
  perform pg_temp.receber('C1x', pg_temp.ev('C1', pg_temp.util('09:30'), '{"remarcado": true}', 'invitee.canceled'));
  return next is((pg_temp.convite(pg_temp.id('cv:maria')) ->> 'calendly_agendamento_id')::uuid,
                 (pg_temp.ag('C1R') ->> 'id')::uuid, 'o aviso da remarcação não solta o convite do horário novo');
  -- O cliente cancela: o convite volta a valer.
  perform pg_temp.receber('C1Rc', pg_temp.ev('C1R', pg_temp.util('15:00'),
            '{"cancelamento": {"por": "convidado", "motivo": "imprevisto"}}', 'invitee.canceled'));
  c := pg_temp.convite(pg_temp.id('cv:maria'));
  return next ok(c ->> 'usado_em' is null and c ->> 'calendly_agendamento_id' is null
                 and pg_temp.ag('C1R') ->> 'situacao' = 'cancelado',
                 'cancelado no Calendly: o convite volta a valer');
  v := pg_temp.receber('C5', pg_temp.ev('C5', pg_temp.util('10:00', 1), jsonb_build_object('convite', v_tok)));
  return next ok(v ->> 'convite' = 'valido' and (pg_temp.ag('C5') ->> 'organization_id')::uuid = pg_temp.id('org:maria'),
                 'e vale de novo pelo mesmo link');

  -- Vencido.
  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  v_cv := (public.agenda_enviar_link(pg_temp.id('conv:beto'), 'reuniao') ->> 'convite_id')::uuid;
  perform pg_temp.sair();
  update public.agenda_convites set expira_em = now() - interval '1 minute', criado_em = now() - interval '31 days'
   where id = v_cv;
  v := pg_temp.receber('C6', pg_temp.ev('C6', pg_temp.util('11:00', 1), jsonb_build_object('convite', pg_temp.token(v_cv))));
  return next ok(v ->> 'convite' = 'expirado' and pg_temp.convite(v_cv) ->> 'usado_em' is null,
                 'convite vencido: segue como sem convite, e ele não é marcado como usado');

  -- A reunião do convite fica ligada à conversa (o cliente respondeu "Visita").
  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  v_cv := (public.agenda_enviar_link(pg_temp.id('conv:rena'), 'reuniao') ->> 'convite_id')::uuid;
  perform pg_temp.sair();
  v := pg_temp.receber('C7', pg_temp.ev('C7', pg_temp.util('13:00', 1), jsonb_build_object(
         'convite', pg_temp.token(v_cv), 'natureza', 'visita',
         'respostas', '[{"pergunta": "O que você quer marcar?", "resposta": "Visita a um imóvel"}]'::jsonb)));
  return next ok(v ->> 'natureza' = 'reuniao' and v ->> 'reuniao_id' is not null
                 and (select r.conversation_id from public.reunioes r where r.id = (v ->> 'reuniao_id')::uuid)
                     = pg_temp.id('conv:rena')
                 and pg_temp.imovel((v ->> 'task_id')::uuid) is null,
                 'convite de reunião: entra como reunião, ligada à conversa, e sem imóvel');

  -- Feriado continua recusando; o convite volta quando o Calendly cancela.
  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  v_cv := (public.agenda_enviar_link(pg_temp.id('conv:feri'), 'visita', pg_temp.id('an:TE9158')) ->> 'convite_id')::uuid;
  perform pg_temp.sair();
  v := pg_temp.receber('C8', pg_temp.ev('C8', pg_temp.feriado('10:00'), jsonb_build_object('convite', pg_temp.token(v_cv))));
  return next ok(v ->> 'situacao' = 'recusado' and v ->> 'recusa' = 'dia_nao_util'
                 and (pg_temp.convite(v_cv) ->> 'calendly_agendamento_id')::uuid = (pg_temp.ag('C8') ->> 'id')::uuid,
                 'feriado com convite: recusado como hoje, e o convite fica preso até o cancelamento');
  perform pg_temp.receber('C8c', pg_temp.ev('C8', pg_temp.feriado('10:00'),
            '{"cancelamento": {"por": "anfitriao", "motivo": "feriado"}}', 'invitee.canceled'));
  return next ok(pg_temp.convite(v_cv) ->> 'usado_em' is null and pg_temp.convite(v_cv) ->> 'calendly_agendamento_id' is null,
                 'o Calendly confirma o cancelamento: o convite volta a valer');
end $parte$;
select * from pg_temp.parte_com_convite();

-- ---------------------------------------------------------------------
-- 7. O Calendly sem convite: o imóvel pela resposta, ou "Confirmar o imóvel"
-- ---------------------------------------------------------------------
create function pg_temp.visita_ev(p_resposta text) returns jsonb language sql as $$
  select jsonb_build_object('natureza', 'visita',
           'respostas', case when p_resposta is null then '[]'::jsonb
                             else jsonb_build_array(jsonb_build_object('pergunta', 'Endereço ou código do imóvel',
                                                                       'resposta', p_resposta)) end)
$$;
create function pg_temp.parte_sem_convite() returns setof text language plpgsql as $parte$
declare
  v  jsonb;
  v2 jsonb;
  n  int;
begin
  if pg_temp.na_komune() then
    return next skip('O convite da Agenda é só da Imova', 7);
    return;
  end if;

  v := pg_temp.receber('S1', pg_temp.ev('S1', pg_temp.util('09:30', 2), pg_temp.visita_ev('Quero ver o IM9157')));
  return next ok(pg_temp.imovel((v ->> 'task_id')::uuid) @> jsonb_build_object(
                   'codigo', 'IM9157', 'endereco', 'Rua Teste 157, 10, Ponta Negra, Natal', 'origem', 'calendly'),
                 'sem convite, com o código na resposta: o imóvel do anúncio (origem calendly)');
  v := pg_temp.receber('S2', pg_temp.ev('S2', pg_temp.util('11:00', 2), pg_temp.visita_ev('Rua das Flores, 50, Tirol')));
  return next ok(pg_temp.imovel((v ->> 'task_id')::uuid) @> '{"endereco": "Rua das Flores, 50, Tirol", "origem": "calendly"}'::jsonb
                 and pg_temp.imovel((v ->> 'task_id')::uuid) ->> 'codigo' is null,
                 'com o endereço escrito: o endereço, sem código');
  v := pg_temp.receber('S3', pg_temp.ev('S3', pg_temp.util('13:00', 2),
         pg_temp.visita_ev(null) || '{"formato": "presencial", "local": "Escritório da Imova"}'));
  return next ok(pg_temp.imovel((v ->> 'task_id')::uuid) is null and v ->> 'tarefa_imovel_id' is not null,
                 'sem código nem endereço na resposta (o local do evento não é imóvel): sem imóvel, e nasce a tarefa');
  return next ok(exists (select 1 from public.tasks t
                          where t.id = (v ->> 'tarefa_imovel_id')::uuid
                            and t.title = 'Confirmar o imóvel da visita com Cliente S3'
                            and t.assignee_id = pg_temp.g() and t.status = 'todo' and t.kind = 'message'
                            and t.organization_id = (pg_temp.ag('S3') ->> 'organization_id')::uuid),
                 'a tarefa "Confirmar o imóvel da visita com <cliente>" é do responsável, para agora');
  return next ok(exists (select 1 from public.activities x
                          where x.organization_id = (pg_temp.ag('S3') ->> 'organization_id')::uuid
                            and x.body like '%O cliente não disse o imóvel: ficou a tarefa de confirmar com ele.%'),
                 'a nota da ficha diz que falta o imóvel');
  -- O mesmo cliente marca outra visita sem imóvel: a tarefa não nasce de novo.
  v2 := pg_temp.receber('S4', pg_temp.ev('S4', pg_temp.util('15:00', 2), pg_temp.visita_ev('sim')
          || jsonb_build_object('email', 'c157s3@cliente.local')));
  select count(*) into n from public.tasks t
   where t.title = 'Confirmar o imóvel da visita com Cliente S3' and t.status = 'todo';
  return next ok(v2 ->> 'tarefa_imovel_id' is null and n = 1
                 and (pg_temp.ag('S4') ->> 'organization_id') = (pg_temp.ag('S3') ->> 'organization_id'),
                 '"sim" não é imóvel, e a tarefa é uma vez só');
  -- A reunião não tem imóvel nem tarefa.
  v := pg_temp.receber('S5', pg_temp.ev('S5', pg_temp.util('16:00', 2)));
  return next ok(v ->> 'situacao' = 'agendado' and pg_temp.imovel((v ->> 'task_id')::uuid) is null
                 and v ->> 'tarefa_imovel_id' is null,
                 'a reunião não entra em visita_imoveis nem gera tarefa');
end $parte$;
select * from pg_temp.parte_sem_convite();

-- ---------------------------------------------------------------------
-- 8. A Agenda: marcar com imóvel e definir o imóvel
-- ---------------------------------------------------------------------
create function pg_temp.parte_agenda() returns setof text language plpgsql as $parte$
declare
  v       jsonb;
  v_task  uuid;
  v_conf  uuid;
  v_outra uuid;
  v_sab   timestamptz;
begin
  if pg_temp.na_komune() then
    return next skip('O convite da Agenda é só da Imova', 15);
    return;
  end if;
  v_sab := (select ((d::date) + time '10:00') at time zone 'America/Fortaleza'
              from generate_series((select util from t157_dia) + 1, (select util from t157_dia) + 20, interval '1 day') d
             where extract(isodow from d) = 6 limit 1);

  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  return next is(public.visita_marcar_com_imovel(pg_temp.id('org:beto'), pg_temp.util('09:30', 3)) ->> 'motivo',
                 'visita_sem_imovel', 'marcar visita sem anúncio nem endereço: visita_sem_imovel');
  return next is(public.visita_marcar_com_imovel(pg_temp.id('org:beto'), pg_temp.util('09:30', 3), null, null,
                                                 null, '   ') ->> 'motivo',
                 'visita_sem_imovel', 'endereço em branco também');
  return next is(public.visita_marcar_com_imovel(pg_temp.id('org:beto'), pg_temp.util('09:30', 3), null, null,
                                                 pg_temp.id('an:IM9159')) ->> 'motivo',
                 'anuncio_invalido', 'anúncio excluído: anuncio_invalido');
  v := public.visita_marcar_com_imovel(pg_temp.id('org:beto'), pg_temp.util('09:30', 3), null, null,
                                       pg_temp.id('an:IM9157'));
  v_task := (v ->> 'task_id')::uuid;
  return next ok((v ->> 'ok')::boolean and v ?& array['task_id', 'dono_id', 'inicio', 'fim']
                 and (v ->> 'dono_id')::uuid = pg_temp.g(),
                 'com o anúncio: marca, e devolve o mesmo que a visita_marcar');
  return next ok(pg_temp.imovel(v_task) @> jsonb_build_object('codigo', 'IM9157', 'origem', 'crm',
                   'endereco', 'Rua Teste 157, 10, Ponta Negra, Natal', 'atualizado_por', pg_temp.g()),
                 'e grava o imóvel (origem crm, quem marcou)');
  v := public.visita_marcar_com_imovel(pg_temp.id('org:beto'), pg_temp.util('11:00', 3), null, null,
                                       null, 'Rua do Proprietário, 77, Lagoa Nova');
  return next ok((v ->> 'ok')::boolean and pg_temp.imovel((v ->> 'task_id')::uuid) ->> 'codigo' is null
                 and pg_temp.imovel((v ->> 'task_id')::uuid) ->> 'endereco' = 'Rua do Proprietário, 77, Lagoa Nova',
                 'a avaliação do imóvel de um proprietário: só o endereço escrito');
  v := public.visita_marcar_com_imovel(pg_temp.id('org:beto'), pg_temp.util('13:00', 3), null, null,
                                       pg_temp.id('an:IM9157'), 'Rua Teste 157, 10, apto 302, Ponta Negra');
  return next ok(pg_temp.imovel((v ->> 'task_id')::uuid) @> '{"codigo": "IM9157", "endereco": "Rua Teste 157, 10, apto 302, Ponta Negra"}'::jsonb,
                 'anúncio com endereço escrito: o código do anúncio e o endereço que a pessoa escreveu');
  v := public.visita_marcar_com_imovel(pg_temp.id('org:beto'), v_sab, null, null, pg_temp.id('an:IM9157'));
  return next ok(v ->> 'motivo' = 'dia_nao_util'
                 and not exists (select 1 from public.tasks t where t.organization_id = pg_temp.id('org:beto')
                                    and t.due_at = v_sab),
                 'as recusas da visita_marcar passam como estão (sábado: dia_nao_util), sem imóvel solto');
  perform pg_temp.sair();

  -- Definir o imóvel da visita do Calendly que chegou sem imóvel (S3).
  v_task := (pg_temp.r('S3') ->> 'task_id')::uuid;
  v_conf := (pg_temp.r('S3') ->> 'tarefa_imovel_id')::uuid;
  -- A visita S4 (mesmo cliente) também está sem imóvel.
  v_outra := (pg_temp.r('S4') ->> 'task_id')::uuid;
  perform pg_temp.entrar(pg_temp.l(), 'leitura');
  return next is(public.visita_definir_imovel(v_task, pg_temp.id('an:IM9157')) ->> 'motivo', 'sem_permissao',
                 'o papel de leitura não define o imóvel');
  perform pg_temp.sair();
  perform pg_temp.entrar(pg_temp.e(), 'embaixador');
  return next is(public.visita_definir_imovel(v_task, pg_temp.id('an:IM9157')) ->> 'motivo', 'sem_permissao',
                 'quem não pode mexer na tarefa também não');
  perform pg_temp.sair();
  perform pg_temp.entrar(pg_temp.s(), 'sdr');
  v := public.visita_definir_imovel(v_task, pg_temp.id('an:TE9158'));
  return next ok((v ->> 'ok')::boolean and v ->> 'codigo' = 'TE9158_IMOVA'
                 and v ->> 'endereco' = 'Avenida 158, 900, Lote 3, Pium, Nísia Floresta'
                 and pg_temp.imovel(v_task) @> jsonb_build_object('origem', 'corrigido', 'atualizado_por', pg_temp.s()),
                 'o SDR define o imóvel: {ok, codigo, endereco}, origem corrigido');
  return next is((select t.status::text from public.tasks t where t.id = v_conf), 'todo',
                 'a tarefa "Confirmar o imóvel" fica enquanto outra visita da ficha estiver sem imóvel');
  v := public.visita_definir_imovel(v_outra, null, 'Rua Nova, 1, Candelária');
  return next ok((v ->> 'ok')::boolean and (select t.status::text from public.tasks t where t.id = v_conf) = 'done',
                 'com todas as visitas da ficha com imóvel, a tarefa "Confirmar o imóvel" se fecha');
  return next ok(public.visita_definir_imovel(v_task, null, null) ->> 'motivo' = 'visita_sem_imovel'
                 and public.visita_definir_imovel(v_conf, null, 'Rua X, 1') ->> 'motivo' = 'nao_e_visita'
                 and public.visita_definir_imovel(gen_random_uuid(), null, 'Rua X, 1') ->> 'motivo' = 'nao_existe',
                 'sem imóvel, tarefa que não é visita e tarefa que não existe são recusadas');
  return next throws_ok(format('insert into public.visita_imoveis (task_id, endereco, origem) values (%L, %L, %L)',
                               v_task, 'Rua X, 1', 'crm'),
                        '42501', null, 'ninguém escreve direto em visita_imoveis');
  perform pg_temp.sair();
end $parte$;
select * from pg_temp.parte_agenda();

-- ---------------------------------------------------------------------
-- 9. O {{local}} do lembrete
-- ---------------------------------------------------------------------
create function pg_temp.parte_lembrete() returns setof text language plpgsql as $parte$
declare
  v_dia date := (pg_temp.util('09:30', 2) at time zone 'America/Fortaleza')::date;
begin
  if pg_temp.na_komune() then
    return next skip('O convite da Agenda é só da Imova', 3);
    return;
  end if;
  return next is((select l.local from app.lembrete_visitas_do_periodo(v_dia, v_dia) l
                   where l.task_id = (pg_temp.r('S1') ->> 'task_id')::uuid),
                 'Rua Teste 157, 10, Ponta Negra, Natal (imóvel IM9157)',
                 'o {{local}} da visita é o imóvel dela, com o código');
  return next is((select l.local from app.lembrete_visitas_do_periodo(v_dia, v_dia) l
                   where l.task_id = (pg_temp.r('S2') ->> 'task_id')::uuid),
                 'Rua das Flores, 50, Tirol', 'sem código, só o endereço');
  return next is((select l.local from app.lembrete_visitas_do_periodo(v_dia, v_dia) l
                   where l.task_id = (pg_temp.r('S3') ->> 'task_id')::uuid),
                 'Avenida 158, 900, Lote 3, Pium, Nísia Floresta (imóvel TE9158_IMOVA)',
                 'o imóvel corrigido vale no lugar do local do evento');
end $parte$;
select * from pg_temp.parte_lembrete();

-- ---------------------------------------------------------------------
-- 10. A LGPD
-- ---------------------------------------------------------------------
create function pg_temp.parte_lgpd() returns setof text language plpgsql as $parte$
declare
  d      jsonb;
  v_rel  jsonb;
  v_vel  uuid;
  v_task uuid;
begin
  if pg_temp.na_komune() then
    return next skip('O convite da Agenda é só da Imova', 6);
    return;
  end if;
  d := app.lgpd_dossie(pg_temp.id('org:maria'));
  return next ok(jsonb_array_length(d -> 'convites_da_agenda') >= 1
                 and d -> 'convites_da_agenda' -> 0 ->> 'link' like 'https://calendly.com/%'
                 and d -> 'convites_da_agenda' -> 0 ? 'imovel',
                 'o dossiê traz os convites mandados ao titular, com o link');
  d := app.lgpd_dossie((pg_temp.ag('S3') ->> 'organization_id')::uuid);
  return next ok(exists (select 1 from jsonb_array_elements(d -> 'imoveis_das_visitas') x
                          where x ->> 'imovel' = 'TE9158_IMOVA' and x ->> 'origem' = 'corrigido'),
                 'e os imóveis das visitas dele');
  return next ok((app.lgpd_dossie(pg_temp.id('org:maria')) ->> 'ok')::boolean
                 and app.lgpd_dossie(pg_temp.id('org:maria')) ? 'retencao',
                 'o resto do dossiê continua lá');

  -- A retenção: o link vencido há mais de 90 dias perde o nome e o telefone;
  -- o endereço escrito à mão de visita velha sai; o do anúncio fica.
  update public.agenda_convites set criado_em = now() - interval '130 days', expira_em = now() - interval '100 days'
   where id = pg_temp.id('cv:maria');
  v_task := (pg_temp.r('S2') ->> 'task_id')::uuid;
  update public.tasks set due_at = now() - interval '13 months' where id in (v_task, (pg_temp.r('S1') ->> 'task_id')::uuid);
  v_rel := app.aplicar_retencao();
  return next ok(pg_temp.convite(pg_temp.id('cv:maria')) ->> 'link' = 'https://calendly.com/contato-imovaimobiliaria/30min'
                 and (v_rel ->> 'agenda_convites_links')::int >= 1,
                 'retenção: o link vencido há 90 dias fica só com a base (sem nome, telefone, imóvel nem token)');
  return next ok(pg_temp.imovel(v_task) is null and pg_temp.imovel((pg_temp.r('S1') ->> 'task_id')::uuid) is not null
                 and (v_rel ->> 'visita_imoveis_enderecos')::int >= 1,
                 'o endereço escrito à mão da visita de 12 meses sai; o do anúncio fica');
  update public.organizations set anonymized_at = now() where id = pg_temp.id('org:beto');
  v_rel := app.aplicar_retencao();
  return next ok(not exists (select 1 from public.agenda_convites c where c.organization_id = pg_temp.id('org:beto'))
                 and (v_rel ->> 'agenda_convites_anonimizados')::int >= 1,
                 'ficha anonimizada perde os convites');
end $parte$;
select * from pg_temp.parte_lgpd();

-- ---------------------------------------------------------------------
-- 11. Os privilégios e a RLS
-- ---------------------------------------------------------------------
create function pg_temp.parte_privilegios() returns setof text language plpgsql as $parte$
declare
  v_n bigint;
begin
  if pg_temp.na_komune() then
    return next skip('O convite da Agenda é só da Imova', 9);
    return;
  end if;
  return next ok(has_function_privilege('authenticated', 'public.agenda_link_previa(uuid, text, uuid, text)', 'execute')
                 and has_function_privilege('authenticated', 'public.agenda_enviar_link(uuid, text, uuid, text)', 'execute')
                 and has_function_privilege('authenticated', 'public.visita_marcar_com_imovel(uuid, timestamptz, uuid, uuid, uuid, text)', 'execute')
                 and has_function_privilege('authenticated', 'public.visita_definir_imovel(uuid, uuid, text)', 'execute')
                 and has_function_privilege('authenticated', 'public.calendly_link_configurar(text)', 'execute'),
                 'as portas da tela são de authenticated');
  return next ok(not has_function_privilege('anon', 'public.agenda_link_previa(uuid, text, uuid, text)', 'execute')
                 and not has_function_privilege('anon', 'public.agenda_enviar_link(uuid, text, uuid, text)', 'execute')
                 and not has_function_privilege('anon', 'public.visita_marcar_com_imovel(uuid, timestamptz, uuid, uuid, uuid, text)', 'execute')
                 and not has_function_privilege('anon', 'public.visita_definir_imovel(uuid, uuid, text)', 'execute')
                 and not has_function_privilege('anon', 'public.calendly_link_configurar(text)', 'execute'),
                 'e não de anon');
  return next ok(has_function_privilege('service_role', 'public.ia_atendente_enviar_link(uuid, uuid, text, text, text, bigint, text)', 'execute')
                 and not has_function_privilege('authenticated', 'public.ia_atendente_enviar_link(uuid, uuid, text, text, text, bigint, text)', 'execute')
                 and not has_function_privilege('anon', 'public.ia_atendente_enviar_link(uuid, uuid, text, text, text, bigint, text)', 'execute'),
                 'a porta da IA é só da service_role');
  return next ok(has_function_privilege('service_role', 'public.calendly_receber(jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'public.calendly_receber(jsonb)', 'execute'),
                 'o webhook continua só da service_role');
  return next ok(not has_function_privilege('authenticated', 'app.agenda_convite_preparar(uuid, text, uuid, text, text)', 'execute')
                 and not has_function_privilege('authenticated', 'app.visita_imovel_gravar(uuid, uuid, text, text, text, uuid)', 'execute')
                 and not has_function_privilege('authenticated', 'app.agenda_link_montar(jsonb, text, text, text, text, text, text)', 'execute')
                 and not has_function_privilege('authenticated', 'app.calendly_ficha_do_convite(uuid, text, text, uuid, uuid)', 'execute')
                 and not has_function_privilege('authenticated', 'app.visita_tarefa_confirmar_imovel(uuid)', 'execute'),
                 'as funções de dentro (app.*) não são chamáveis pela sessão');
  return next ok(has_table_privilege('authenticated', 'public.agenda_convites', 'select')
                 and not has_table_privilege('authenticated', 'public.agenda_convites', 'insert')
                 and not has_table_privilege('authenticated', 'public.agenda_convites', 'update')
                 and not has_table_privilege('authenticated', 'public.agenda_convites', 'delete')
                 and has_table_privilege('authenticated', 'public.visita_imoveis', 'select')
                 and not has_table_privilege('authenticated', 'public.visita_imoveis', 'insert')
                 and not has_table_privilege('authenticated', 'public.visita_imoveis', 'update')
                 and not has_table_privilege('anon', 'public.agenda_convites', 'select')
                 and not has_table_privilege('service_role', 'public.agenda_convites', 'insert'),
                 'nas tabelas, a sessão só lê; ninguém escreve direto');
  return next ok((select bool_and(c.relrowsecurity) from pg_class c
                   where c.oid in ('public.agenda_convites'::regclass, 'public.visita_imoveis'::regclass)),
                 'as duas tabelas com RLS ligado');
  -- Quem vê a conversa vê o convite; o embaixador, que não vê, não.
  perform pg_temp.entrar(pg_temp.g(), 'gestor');
  select count(*) into v_n from public.agenda_convites where conversation_id = pg_temp.id('conv:treino');
  perform pg_temp.sair();
  return next ok(v_n >= 6, 'o gestor vê os convites da conversa');
  perform pg_temp.entrar(pg_temp.e(), 'embaixador');
  select count(*) into v_n from public.agenda_convites;
  v_n := v_n + (select count(*) from public.visita_imoveis);
  perform pg_temp.sair();
  return next is(v_n, 0::bigint, 'o embaixador, que não vê essas conversas e tarefas, não vê convite nem imóvel');
end $parte$;
select * from pg_temp.parte_privilegios();

-- Nenhuma mensagem de saída fora das que este arquivo mandou de propósito.
select ok((select count(*) from public.messages m
            where m.direction = 'out' and m.created_at >= now()
              and m.conversation_id not in (select valor from t157 where chave like 'conv:%')) = 0,
          'nada saiu para conversa que não é deste arquivo');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — Cadências, régua de silêncio e pré-cadastro
--   (migrações 20260904001700 e 20260904001801)
--   public.app_settings · channel_windows · cadences · cadence_steps
--   · cadence_enrollments · cadence_touches · pre_registrations
--   · pre_registration_events · pre_registration_acceptances
--   · app.pode_tocar · janela_do_canal · dia_util_de_operacao · teto_do_canal
--   · app.abrir_proximo_toque · encerrar_por_silencio · cadencias_agendar
--   · app.tem_toque_pendente · tasks_guard_suppressed
--   · public.matricular_em_cadencia · encerrar_cadencia
--   · public.criar_pre_cadastro · gerar_link_de_reivindicacao
--   · public.abrir_reivindicacao · aceitar_reivindicacao · recusar_reivindicacao
--   · app.precadastros_lembrete · precadastros_expirar
--
-- O que este arquivo tem de provar, e por quê:
--   1. UM TOQUE PENDENTE POR PESSOA. Não é disciplina de tela: é índice único
--      parcial e gatilho, e vale entre matrículas, entre organizações e entre
--      canais. Foi aqui que a suíte achou o furo (a mesma sócia em duas
--      organizações recebia duas ligações no mesmo dia); a migração
--      20260904001801 fechou, e os testes desta seção são o que impede a volta.
--   2. DOMINGO E FERIADO NÃO EXISTEM. A janela do canal e o dia de operação são
--      testados com INSTANTES FIXOS (06/09 domingo, 07/09 feriado, 08/09 terça),
--      que é onde a regra mora, e a régua é testada com um feriado inserido
--      para HOJE — assim o arquivo passa às 3h de um domingo igual ao meio-dia
--      de uma terça.
--   3. COOLDOWN É FILTRO DE ENTRADA. Ele ADIA (devolve `quando`), usa o MÁXIMO
--      sobre todas as atividades e não a última, e NADA nasce enquanto ele
--      corre. Supressão e desfecho não reativável, ao contrário, ENCERRAM: vêm
--      com `quando = null` justamente para quem chama não reagendar.
--   4. SUPRIMIDO NÃO ENTRA — por psql, como superusuário, sem RLS no caminho e
--      com a chave que for (do_not_contact, telefone na suppression_list,
--      contato suprimido com organização limpa). Cadência, toque, tarefa de
--      contato e pré-cadastro recusam. Só a tarefa `other` escapa, porque é
--      onde mora a obrigação de LGPD com quem pediu para sair.
--   5. ACEITE SEM PROVA NÃO É ACEITE. Carimbo, IP, user-agent, versão e hash do
--      termo, método e quem aceitou são NOT NULL, e a publicação é recusada
--      pelo banco sem reivindicação E sem aceite provado (LGPD art. 8º §2º).
--   6. O TOKEN. Só existe como hash, expira, morre no uso e o reenvio mata o
--      anterior. Nem o retorno da ficha nem o log de eventos podem carregá-lo.
--   7. PRÉ-CADASTRO SEM AUTORIZAÇÃO NÃO SAI. Sem `consent_events` vigente não
--      há link, não há cadência de onboarding — e a revogação posterior fecha a
--      porta de novo.
--   8. RLS por papel em toda tabela nova, com a prova de aceite (IP, UA) atrás
--      de gestor e `anon` sem um único grant de tabela.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada: este banco tem
-- operação real dentro (100 organizações, ligações, lotes). Tudo é DELTA contra
-- uma base lida FORA da RLS, ou escopo por id do próprio arquivo — o mesmo
-- padrão de 13_modulo_de_ligacao e 16_esteira_de_ingestao.
--
-- Sobre o relógio: `app.pode_tocar` recebe o instante, então as regras de
-- janela são testadas com datas fixas. Para o FLUXO (que chama `now()`), a
-- janela é substituída DENTRO da transação por um par sempre-aberto — sem isso
-- a suíte passaria às 10h e falharia às 21h, que é o pior tipo de teste. Que o
-- motor realmente consulta a porteira fica provado pelos casos em que ela
-- recusa: cooldown, supressão e janela fechada.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(229);

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
create function pg_temp.fonte() returns int language sql as $$
  select id from public.sources where slug = 'captura_campo'
$$;
create function pg_temp.funil(p_slug text) returns int language sql as $$
  select id from public.pipelines where slug = p_slug
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_slug
$$;
create function pg_temp.desfecho(p_slug text) returns int language sql as $$
  select id from public.interaction_outcomes where slug = p_slug
$$;
create function pg_temp.cad(p_slug text) returns int language sql as $$
  select id from public.cadences where slug = p_slug
$$;
create function pg_temp.passo(p_cad text, p_pos int) returns int language sql as $$
  select s.id from public.cadence_steps s join public.cadences c on c.id = s.cadence_id
   where c.slug = p_cad and s."position" = p_pos
$$;
create function pg_temp.hoje() returns date language sql as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;
create function pg_temp.org(p_n text) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-00000000ca' || p_n)::uuid
$$;
create function pg_temp.matricula(p_org uuid) returns public.cadence_enrollments
  language sql security definer set search_path = '' as $$
  select * from public.cadence_enrollments where organization_id = p_org
   order by enrolled_at desc limit 1
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated;

-- ---------- contagens de BASE, lidas FORA da RLS ----------
create function pg_temp.n_toques() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.cadence_touches
$$;
create function pg_temp.n_tarefas() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.tasks
$$;
create function pg_temp.n_matriculas() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.cadence_enrollments
$$;
create table pg_temp.base (chave text primary key, n int);
insert into pg_temp.base values
  ('toques', pg_temp.n_toques()), ('tarefas', pg_temp.n_tarefas()),
  ('matriculas', pg_temp.n_matriculas());
create function pg_temp.delta(p_chave text, p_agora int) returns int language sql as $$
  select p_agora - (select n from pg_temp.base where chave = p_chave)
$$;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('cad.admin@teste.local',      'admin',      'pgTAP cadências'),
  ('cad.gestor@teste.local',     'gestor',     'pgTAP cadências'),
  ('cad.sdr@teste.local',        'sdr',        'pgTAP cadências'),
  ('cad.embaixador@teste.local', 'embaixador', 'pgTAP cadências'),
  ('cad.leitura@teste.local',    'leitura',    'pgTAP cadências');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000ca001', 'cad.admin@teste.local',      '{"full_name":"Admin Cadência"}'),
  ('a0000000-0000-4000-8000-0000000ca002', 'cad.gestor@teste.local',     '{"full_name":"Gestor Cadência"}'),
  ('a0000000-0000-4000-8000-0000000ca003', 'cad.sdr@teste.local',        '{"full_name":"SDR Cadência"}'),
  ('a0000000-0000-4000-8000-0000000ca004', 'cad.embaixador@teste.local', '{"full_name":"Embaixador Cadência"}'),
  ('a0000000-0000-4000-8000-0000000ca005', 'cad.leitura@teste.local',    '{"full_name":"Leitura Cadência"}');


-- =====================================================================
-- 1. A ESTRUTURA EXISTE, COM RLS E COM AS TRÊS TRAVAS
-- =====================================================================
select has_table('public', 'app_settings',                   'app_settings existe');
select has_table('public', 'channel_windows',                'channel_windows existe');
select has_table('public', 'cadences',                       'cadences existe');
select has_table('public', 'cadence_steps',                  'cadence_steps existe');
select has_table('public', 'cadence_enrollments',            'cadence_enrollments existe');
select has_table('public', 'cadence_touches',                'cadence_touches existe');
select has_table('public', 'pre_registrations',              'pre_registrations existe');
select has_table('public', 'pre_registration_events',        'pre_registration_events existe');
select has_table('public', 'pre_registration_acceptances',   'pre_registration_acceptances existe');
select ok((select bool_and(c.relrowsecurity)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname in ('app_settings','channel_windows','cadences','cadence_steps',
                                'cadence_enrollments','cadence_touches','pre_registrations',
                                'pre_registration_events','pre_registration_acceptances')),
          'toda tabela nova nasce com RLS habilitada');

select ok(exists (select 1 from pg_indexes where schemaname = 'public'
                   and indexname = 'cadence_enrollments_uma_ativa'),
          'uma cadência ativa por organização é índice único parcial');
select ok(exists (select 1 from pg_indexes where schemaname = 'public'
                   and indexname = 'cadence_touches_um_pendente'),
          'um toque pendente por matrícula é índice único parcial');
select ok(exists (select 1 from pg_indexes where schemaname = 'public'
                   and indexname = 'cadence_touches_um_pendente_por_org'),
          'um toque pendente por organização é índice único parcial');
select ok(exists (select 1 from pg_indexes where schemaname = 'public'
                   and indexname = 'cadence_touches_um_pendente_por_contato'),
          'um toque pendente por PESSOA é índice único parcial (conserto de 20260904001801)');
select is((select indexdef from pg_indexes
            where indexname = 'cadence_touches_um_pendente_por_contato'),
          'CREATE UNIQUE INDEX cadence_touches_um_pendente_por_contato ON public.cadence_touches'
          || ' USING btree (contact_id) WHERE ((status = ''pendente''::app.touch_status)'
          || ' AND (contact_id IS NOT NULL))',
          'e a trava por pessoa é parcial: só o pendente disputa');

-- Os quatro jobs da régua, e o que eles rodam. Nenhum manda mensagem: os quatro
-- comandos são chamadas a funções que só agendam TRABALHO DE GENTE.
select is((select count(*)::int from cron.job
            where jobname in ('cadencias_agendar','cadencias_encerrar_silencio',
                              'precadastros_lembrete','precadastros_expirar')),
          4, 'os quatro jobs da régua e da retenção estão agendados');
select is((select string_agg(command, ' | ' order by jobname) from cron.job
            where jobname in ('cadencias_agendar','cadencias_encerrar_silencio',
                              'precadastros_lembrete','precadastros_expirar')),
          'select app.cadencias_agendar() | select app.cadencias_encerrar_silencio() | '
          || 'select app.precadastros_expirar() | select app.precadastros_lembrete()',
          'e o que eles rodam é só isso: agendar, encerrar e apagar — nada envia');


-- =====================================================================
-- 2. CONFIGURAÇÃO OPERÁVEL — o teto legal é CHECK, não parágrafo
-- =====================================================================
select is(app.teto_do_canal('whatsapp', '2026-09-04'::date), 20,
          'WhatsApp na semana 1 do aquecimento: 20 primeiros contatos (RF-CON-10)');
select is(app.teto_do_canal('whatsapp', '2026-09-11'::date), 35,
          'semana 2: 35');
select is(app.teto_do_canal('whatsapp', '2026-10-20'::date), 45,
          'depois do aquecimento: 45');
select is(app.teto_do_canal('phone', pg_temp.hoje()), 60,
          'ligação: 60 por dia');
select is(app.teto_do_canal('instagram', pg_temp.hoje()), 15,
          'Instagram: 15 por dia');
select is(app.teto_do_canal('email', pg_temp.hoje()), 2147483647,
          'canal sem teto configurado não bloqueia ninguém');

select throws_ok(
  $$update public.app_settings
       set value = jsonb_set(value, '{whatsapp,depois}', '400'::jsonb)
     where key = 'cadencia.tetos'$$,
  '23514', null, 'teto acima do teto duro do canal é recusado PELO BANCO (RF-CON-10)');
select throws_ok(
  $$update public.app_settings set value = (value - 'inicio') where key = 'cadencia.tetos'$$,
  '23514', null, 'teto sem data de início do aquecimento é recusado');
select lives_ok(
  $$update public.app_settings
       set value = jsonb_set(value, '{whatsapp,depois}', '60'::jsonb)
     where key = 'cadencia.tetos'$$,
  'teto dentro do teto duro é aceito');

select throws_ok(
  $$insert into public.channel_windows (channel, dow, "position", de, ate)
      values ('whatsapp', 0, 3, 9, 12)$$,
  '23514', null, 'domingo não pode ser configurado como janela, em canal nenhum (R06 §3.4)');
select throws_ok(
  $$insert into public.channel_windows (channel, dow, "position", de, ate)
      values ('whatsapp', 2, 3, 7, 19)$$,
  '23514', null, 'seg–sex antes das 08:00 é recusado pelo teto legal');
select throws_ok(
  $$insert into public.channel_windows (channel, dow, "position", de, ate)
      values ('whatsapp', 2, 3, 8, 21)$$,
  '23514', null, 'seg–sex depois das 19:00 é recusado pelo teto legal');
select throws_ok(
  $$insert into public.channel_windows (channel, dow, "position", de, ate)
      values ('whatsapp', 6, 3, 9, 19)$$,
  '23514', null, 'sábado depois das 13:00 é recusado pelo teto legal');
select throws_ok(
  $$insert into public.channel_windows (channel, dow, "position", de, ate)
      values ('phone', 2, 3, 9, 18)$$,
  '23514', null, 'ligação não entra aqui: a janela dela é app.call_window, e duas fontes de verdade seriam o primeiro bug de conformidade');
select lives_ok(
  $$insert into public.channel_windows (channel, dow, "position", de, ate)
      values ('whatsapp', 6, 3, 9, 13)$$,
  'sábado 09–13 cabe no teto legal e é aceito');
delete from public.channel_windows where channel = 'whatsapp' and dow = 6 and "position" = 3;


-- =====================================================================
-- 3. DOMINGO E FERIADO NÃO EXISTEM (instantes fixos: a regra, não o relógio)
-- =====================================================================
select ok(app.dia_util_de_operacao('2026-09-08 10:00-03'::timestamptz),
          'terça 08/09 é dia de operação');
select ok(not app.dia_util_de_operacao('2026-09-06 10:00-03'::timestamptz),
          'domingo 06/09 não é dia de operação');
select ok(not app.dia_util_de_operacao('2026-09-07 10:00-03'::timestamptz),
          '07/09 não é dia de operação — a tabela holidays manda');

select is(app.janela_do_canal('whatsapp', '2026-09-08 10:00-03'::timestamptz) ->> 'aberta', 'true',
          'WhatsApp, terça 10h: janela aberta');
select is(app.janela_do_canal('whatsapp', '2026-09-08 12:30-03'::timestamptz) ->> 'motivo',
          'antes_da_abertura',
          'WhatsApp, terça 12:30: o almoço fecha a janela');
select is(app.janela_do_canal('whatsapp', '2026-09-08 12:30-03'::timestamptz) ->> 'abre_em',
          '2026-09-08T14:00:00-03:00',
          'e a reabertura é às 14h do mesmo dia — nunca antecipa, nunca inventa');
select is(app.janela_do_canal('whatsapp', '2026-09-06 10:00-03'::timestamptz) ->> 'motivo',
          'domingo', 'WhatsApp, domingo: recusa por domingo');
select is(app.janela_do_canal('whatsapp', '2026-09-07 15:00-03'::timestamptz) ->> 'motivo',
          'feriado', 'WhatsApp, 07/09: recusa por feriado');
select is(app.janela_do_canal('whatsapp', '2026-09-06 10:00-03'::timestamptz) ->> 'abre_em',
          '2026-09-08T09:00:00-03:00',
          'e a próxima abertura pula o feriado de 07/09 e cai na terça, 9h');
select is(app.janela_do_canal('whatsapp', '2026-09-05 11:00-03'::timestamptz, false) ->> 'motivo',
          'dia_sem_janela',
          'sábado, para quem NUNCA respondeu: não há janela (RF-CON-11)');
select is(app.janela_do_canal('whatsapp', '2026-09-05 11:00-03'::timestamptz, true) ->> 'aberta',
          'true', 'sábado 11h, para quem JÁ respondeu: aberta');
select is(app.janela_do_canal('presencial', '2026-09-08 10:00-03'::timestamptz) ->> 'motivo',
          'antes_da_abertura', 'presencial de manhã: a rota é da tarde (RF-CON-13)');
select is(app.janela_do_canal('email', '2026-09-08 10:00-03'::timestamptz) ->> 'motivo',
          'canal_sem_janela', 'e-mail não é canal de cadência');
select is(app.janela_do_canal('phone', '2026-09-08 15:00-03'::timestamptz) ->> 'aberta', 'true',
          'phone delega para app.call_window: terça 15h, aberta');
select is(app.janela_do_canal('phone', '2026-09-07 15:00-03'::timestamptz) ->> 'motivo',
          'feriado', 'e o feriado bloqueia a ligação pela mesma tabela');
select is(app.proxima_abertura_do_canal('2026-09-05'::date, 'whatsapp', false)::text,
          '2026-09-08 09:00:00-03',
          'a partir de sexta 04/09: pula sábado sem resposta, domingo e o feriado');
select is(app.proxima_abertura_do_canal('2026-09-04'::date, 'whatsapp', true)::text,
          '2026-09-05 10:00:00-03',
          'para quem já respondeu, o sábado 10h vale');


-- =====================================================================
-- 4. AS ORGANIZAÇÕES DO ARQUIVO
-- =====================================================================
-- ca1x = fluxo; ca2x = porteira; ca3x = supressão; ca4x = pré-cadastro
insert into public.contacts (id, full_name, phone_e164) values
  ('d0000000-0000-4000-8000-0000000ca001', 'Sócia de Duas Empresas', '+5584999997101'),
  ('d0000000-0000-4000-8000-0000000ca002', 'Contato Suprimido',      '+5584999997102');
update public.contacts set do_not_contact = true where id = 'd0000000-0000-4000-8000-0000000ca002';

insert into public.organizations (id, name, phone_e164, instagram_handle, neighborhood, source_id, owner_id)
values
  (pg_temp.org('11'), 'CAD Buffet do Fluxo',   '+5584999997011', 'cadbuffet11', 'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('12'), 'CAD Sem Nada',          null,             null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('13'), 'CAD Tarefa Concluida',  '+5584999997013', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('14'), 'CAD Resposta',          '+5584999997014', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('15'), 'CAD Silencio',          '+5584999997015', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('16'), 'CAD Optout',            '+5584999997016', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('17'), 'CAD Pessoa A',          '+5584999997017', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('18'), 'CAD Pessoa B',          '+5584999997018', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('19'), 'CAD Carteira Embaixador','+5584999997019',null,          'Tirol', pg_temp.fonte(),
     'a0000000-0000-4000-8000-0000000ca004'),
  (pg_temp.org('21'), 'CAD Cooldown',          '+5584999997021', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('22'), 'CAD Nao Reativavel',    '+5584999997022', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('23'), 'CAD Teto',              '+5584999997023', 'cadteto23',   'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('24'), 'CAD Teto Vizinha',      '+5584999997024', 'cadteto24',   'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('31'), 'CAD DNC',               '+5584999997031', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('32'), 'CAD So Supressao',      '+5584999997032', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('33'), 'CAD Contato Suprimido', '+5584999997033', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('41'), 'CAD Pre Cadastro',      '+5584999997041', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('42'), 'CAD Pre Recusa',        '+5584999997042', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('43'), 'CAD Pre Expira',        '+5584999997043', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('44'), 'CAD Pre Lembrete',      '+5584999997044', null,          'Tirol', pg_temp.fonte(), null),
  (pg_temp.org('45'), 'CAD Pre Vizinha',       '+5584999997045', null,          'Tirol', pg_temp.fonte(), null);

update public.organizations set do_not_contact = true where id = pg_temp.org('31');
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex('+5584999997032'), 'phone', 'pgTAP: opt-out por regra');

insert into public.organization_contacts (organization_id, contact_id) values
  (pg_temp.org('17'), 'd0000000-0000-4000-8000-0000000ca001'),
  (pg_temp.org('18'), 'd0000000-0000-4000-8000-0000000ca001'),
  (pg_temp.org('33'), 'd0000000-0000-4000-8000-0000000ca002');

insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id, primary_contact_id)
select ('e0000000-0000-4000-8000-00000000ca' || x.n)::uuid, pg_temp.org(x.n),
       pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', x.etapa), x.dono, x.contato
  from (values
    ('11','prospectado', null::uuid, null::uuid),
    ('12','prospectado', null, null),
    ('13','prospectado', null, null),
    ('14','prospectado', null, null),
    ('15','prospectado', null, null),
    ('16','prospectado', null, null),
    ('17','prospectado', null, 'd0000000-0000-4000-8000-0000000ca001'::uuid),
    ('18','prospectado', null, 'd0000000-0000-4000-8000-0000000ca001'::uuid),
    ('19','prospectado', 'a0000000-0000-4000-8000-0000000ca004'::uuid, null),
    ('21','prospectado', null, null),
    ('22','prospectado', null, null),
    ('23','prospectado', null, null),
    ('24','prospectado', null, null),
    ('31','contatado',   null, null),
    ('32','contatado',   null, null),
    ('33','contatado',   null, 'd0000000-0000-4000-8000-0000000ca002'::uuid),
    ('41','autorizou',   null, null),
    ('42','autorizou',   null, null),
    ('43','autorizou',   null, null),
    ('44','autorizou',   null, null),
    ('45','autorizou',   null, null)
  ) as x(n, etapa, dono, contato);


-- =====================================================================
-- 5. A PORTEIRA — ordem das checagens, e o que ADIA contra o que ENCERRA
-- =====================================================================
-- 5.1 Supressão ENCERRA: vem com quando = null de propósito.
select is(app.pode_tocar(pg_temp.org('31'), null, 'phone') ->> 'motivo', 'suprimido',
          'organização com do_not_contact: a porteira responde "suprimido"');
select ok((app.pode_tocar(pg_temp.org('31'), null, 'phone') -> 'quando') = 'null'::jsonb,
          'e sem "quando": supressão não adia, ENCERRA (quem chama não pode reagendar)');
select is(app.pode_tocar(pg_temp.org('32'), null, 'whatsapp') ->> 'motivo', 'suprimido',
          'telefone na suppression_list suprime igual, sem do_not_contact na ficha');
select is(app.pode_tocar(pg_temp.org('33'), 'd0000000-0000-4000-8000-0000000ca002', 'phone') ->> 'motivo',
          'suprimido',
          'organização limpa com CONTATO suprimido também é recusada');

-- 5.2 Cooldown ADIA, e usa o MÁXIMO — não a última atividade.
insert into public.activities (type, organization_id, deal_id, outcome_id, occurred_at, body)
values ('visit', pg_temp.org('21'), 'e0000000-0000-4000-8000-00000000ca21',
        pg_temp.desfecho('vis_nao_estava'), now() - interval '2 days', 'não estava');
select is(app.pode_tocar(pg_temp.org('21'), null, 'phone') ->> 'motivo', 'cooldown',
          'desfecho com cooldown de 7 dias, há 2 dias: a porteira ADIA');
select is((app.pode_tocar(pg_temp.org('21'), null, 'phone') ->> 'quando')::timestamptz::date,
          (now() + interval '5 days')::date,
          'e o "quando" é o fim do cooldown — o alvo volta a ser elegível sozinho, sem nada disparar');
insert into public.activities (type, organization_id, deal_id, outcome_id, occurred_at, body)
values ('call', pg_temp.org('21'), 'e0000000-0000-4000-8000-00000000ca21',
        pg_temp.desfecho('lig_nao_atendeu'), now() - interval '1 hour', 'não atendeu');
select is((app.pode_tocar(pg_temp.org('21'), null, 'phone') ->> 'quando')::timestamptz::date,
          (now() + interval '5 days')::date,
          'um "não atendeu" de 1 dia registrado DEPOIS não apaga o cooldown maior (é o MÁXIMO, não o último)');

-- 5.3 Desfecho não reativável ENCERRA — depois que o cooldown dele já passou.
insert into public.activities (type, organization_id, deal_id, outcome_id, occurred_at, body)
values ('call', pg_temp.org('22'), 'e0000000-0000-4000-8000-00000000ca22',
        pg_temp.desfecho('lig_sem_interesse'), now() - interval '100 days', 'sem interesse');
select is(app.pode_tocar(pg_temp.org('22'), null, 'phone') ->> 'motivo', 'nao_reativavel',
          'desfecho não reativável, cooldown vencido: a porteira ENCERRA');
select ok((app.pode_tocar(pg_temp.org('22'), null, 'phone') -> 'quando') = 'null'::jsonb,
          'e também sem "quando"');

-- 5.4 Janela: domingo e feriado ADIAM, empurrando para a próxima abertura.
select is(app.pode_tocar(pg_temp.org('11'), null, 'whatsapp',
                         '2026-09-06 10:00-03'::timestamptz) ->> 'motivo', 'janela_domingo',
          'domingo: a porteira recusa com motivo nomeado');
select is((app.pode_tocar(pg_temp.org('11'), null, 'whatsapp',
                          '2026-09-06 10:00-03'::timestamptz) ->> 'quando')::timestamptz::text,
          '2026-09-08 09:00:00-03',
          'e adia para a terça, pulando o feriado — nunca antecipa');
select is(app.pode_tocar(pg_temp.org('11'), null, 'whatsapp',
                         '2026-09-07 10:00-03'::timestamptz) ->> 'motivo', 'janela_feriado',
          'feriado: recusa por feriado');
select is(app.pode_tocar(pg_temp.org('11'), null, 'phone',
                         '2026-09-06 15:00-03'::timestamptz) ->> 'motivo', 'janela_domingo',
          'e a ligação no domingo é recusada pela mesma porta');

-- 5.5 Teto do canal: o excedente ATRASA, nunca duplica.
-- A data é uma terça DISTANTE (09/03/2027), fora do alcance de qualquer cadência
-- real (a mais longa agenda D+60): assim a contagem do dia é só deste arquivo, e
-- não uma contagem absoluta em tabela que a operação alimenta.
update public.app_settings set value = jsonb_set(value, '{instagram,padrao}', '1'::jsonb)
 where key = 'cadencia.tetos';
select is(app.teto_do_canal('instagram', '2027-03-09'::date), 1,
          'teto do Instagram baixado para 1 nesta transação');
select is(app.toques_do_dia('instagram', '2027-03-09'::date), 0,
          'e naquele dia distante ainda não há toque nenhum');
insert into public.cadence_enrollments (id, cadence_id, organization_id, deal_id, status)
values ('f0000000-0000-4000-8000-00000000ca23', pg_temp.cad('voz_primeiro'), pg_temp.org('23'),
        'e0000000-0000-4000-8000-00000000ca23', 'ativa');
insert into public.cadence_touches (enrollment_id, step_id, organization_id, channel, "position",
                                    status, due_at)
values ('f0000000-0000-4000-8000-00000000ca23', pg_temp.passo('voz_primeiro', 4), pg_temp.org('23'),
        'instagram', 4, 'pendente', '2027-03-09 10:00-03'::timestamptz);
select is(app.toques_do_dia('instagram', '2027-03-09'::date), 1,
          'e o toque daquele dia conta contra o teto do dia');
select is(app.pode_tocar(pg_temp.org('24'), null, 'instagram',
                         '2027-03-09 10:00-03'::timestamptz) ->> 'motivo', 'teto_do_canal',
          'teto batido: a porteira recusa a próxima organização do dia');
select ok((app.pode_tocar(pg_temp.org('24'), null, 'instagram',
                          '2027-03-09 10:00-03'::timestamptz) ->> 'quando')::timestamptz > now(),
          'e adia para a próxima abertura — o excedente atrasa, não duplica');
update public.cadence_touches set status = 'cancelado'
 where enrollment_id = 'f0000000-0000-4000-8000-00000000ca23';
select is(app.toques_do_dia('instagram', '2027-03-09'::date), 0,
          'toque cancelado não consome teto: não houve contato');
update public.app_settings set value = jsonb_set(value, '{instagram,padrao}', '15'::jsonb)
 where key = 'cadencia.tetos';
delete from public.cadence_touches where enrollment_id = 'f0000000-0000-4000-8000-00000000ca23';
delete from public.cadence_enrollments where id = 'f0000000-0000-4000-8000-00000000ca23';


-- =====================================================================
-- 6. O MOTOR — a partir daqui a janela é substituída por um par sempre-aberto
-- =====================================================================
-- Sem isto o arquivo passaria às 10h e falharia às 21h. Que o motor consulta a
-- porteira de verdade já ficou provado na seção 5 e volta a ficar em 6.9.
create or replace function app.call_window(p_at timestamptz default now())
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                            'fecha_em', now() + interval '4 hours')
$$;
create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                            'fecha_em', now() + interval '4 hours')
$$;

-- 6.1 O primeiro toque: ligação, tarefa de gente, nada enviado.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r
select 'm11', public.matricular_em_cadencia(pg_temp.org('11'), 'voz_primeiro');
select pg_temp.sair();

select is((select valor ->> 'ok' from pg_temp.r where chave = 'm11'), 'true',
          'matrícula em voz_primeiro aceita');
select is((select valor -> 'primeiro_toque' ->> 'acao' from pg_temp.r where chave = 'm11'),
          'toque_criado', 'e o primeiro toque nasce na hora');
select is((select valor -> 'primeiro_toque' ->> 'canal' from pg_temp.r where chave = 'm11'),
          'phone', 'o passo 1 é LIGAÇÃO — a virada de 04/09 (R13 §7)');
select is((select t.status::text || '/' || t.channel::text || '/' || t."position"::text
             from public.cadence_touches t where t.organization_id = pg_temp.org('11')),
          'pendente/phone/1', 'o toque fica pendente, no canal do passo');
select ok((select t.done_at is null and t.activity_id is null
             from public.cadence_touches t where t.organization_id = pg_temp.org('11')),
          'e nasce sem fecho: não houve contato nenhum ainda');
select is((select tk.kind::text || '/' || tk.status::text || '/' || tk.origin
             from public.tasks tk
             join public.cadence_touches t on t.task_id = tk.id
            where t.organization_id = pg_temp.org('11')),
          'call/todo/cadence',
          'o que a cadência produz é TAREFA para gente executar (ADR-05) — nunca um envio');
select is(pg_temp.delta('tarefas', pg_temp.n_tarefas()), 1,
          'exatamente uma tarefa nasceu: a cadência não dispara em lote');

-- 6.2 Um toque pendente por vez, em qualquer canal.
select throws_ok(
  format($$insert into public.cadence_touches
             (enrollment_id, step_id, organization_id, channel, "position", status, due_at)
           values (%L, %s, %L, 'whatsapp', 3, 'pendente', now())$$,
         (pg_temp.matricula(pg_temp.org('11'))).id, pg_temp.passo('voz_primeiro', 3),
         pg_temp.org('11')),
  '23505', null,
  'segundo toque pendente na mesma matrícula, em OUTRO canal, é recusado pelo banco');
select is(app.abrir_proximo_toque((pg_temp.matricula(pg_temp.org('11'))).id) ->> 'motivo',
          'toque_pendente',
          'e o motor se recusa a abrir por cima: o próximo só nasce quando o anterior é resolvido');
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
select is(public.matricular_em_cadencia(pg_temp.org('11'), 'retomar_conversa') ->> 'motivo',
          'ja_tem_cadencia_ativa', 'nem uma segunda cadência entra por cima da ativa');
select pg_temp.sair();

-- 6.3 A trava entre ORGANIZAÇÕES: a mesma pessoa, duas empresas, UMA ligação.
--     Foi o furo que esta suíte encontrou (conserto em 20260904001801).
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r
select 'm17', public.matricular_em_cadencia(pg_temp.org('17'), 'voz_primeiro');
insert into pg_temp.r
select 'm18', public.matricular_em_cadencia(pg_temp.org('18'), 'voz_primeiro');
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'm17'), 'true',
          'a sócia entra em cadência pela primeira empresa dela');
select is((select valor ->> 'motivo' from pg_temp.r where chave = 'm18'),
          'toque_pendente_no_contato',
          'e a SEGUNDA empresa da mesma sócia é recusada: uma pessoa, um toque por vez');
select is((select count(*)::int from public.cadence_touches t
            where t.contact_id = 'd0000000-0000-4000-8000-0000000ca001'
              and t.status = 'pendente'),
          1, 'só existe um toque pendente para aquela pessoa, somando as duas organizações');
-- O ataque: a RPC recusou, então a matrícula da segunda empresa é criada à mão,
-- como superusuário, sem RLS no caminho — e o toque é inserido direto.
insert into public.cadence_enrollments
  (id, cadence_id, organization_id, deal_id, contact_id, status)
values ('f0000000-0000-4000-8000-00000000ca18', pg_temp.cad('voz_primeiro'), pg_temp.org('18'),
        'e0000000-0000-4000-8000-00000000ca18', 'd0000000-0000-4000-8000-0000000ca001', 'ativa');
select throws_ok(
  format($$insert into public.cadence_touches
             (enrollment_id, step_id, organization_id, contact_id, channel, "position", status, due_at)
           values ('f0000000-0000-4000-8000-00000000ca18', %s, %L,
                   'd0000000-0000-4000-8000-0000000ca001', 'whatsapp', 1, 'pendente', now())$$,
         pg_temp.passo('voz_primeiro', 1), pg_temp.org('18')),
  '23505', null,
  'e o ataque por psql, com a chave que for, também é recusado pelo gatilho');
select is(app.abrir_proximo_toque('f0000000-0000-4000-8000-00000000ca18') ->> 'motivo',
          'toque_pendente_no_contato',
          'o motor sai pela porta em vez de estourar: um contato duplicado não derruba a fila do dia');
select ok(app.tem_toque_pendente(pg_temp.org('18'), 'd0000000-0000-4000-8000-0000000ca001'),
          'app.tem_toque_pendente enxerga a pessoa, não só a organização');
select ok(not app.tem_toque_pendente(pg_temp.org('18'), null),
          'e sem a pessoa a resposta muda: é a coluna contact_id que fecha o buraco');

-- 6.4 O passo que não bate nasce PULADO, com motivo, e não vira trabalho.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r
select 'm12', public.matricular_em_cadencia(pg_temp.org('12'), 'voz_primeiro');
select pg_temp.sair();
select is((select t.status::text || '|' || t.skip_reason from public.cadence_touches t
            where t.organization_id = pg_temp.org('12')),
          'pulado|condicao:tem_telefone',
          'organização sem telefone: o passo 1 nasce PULADO, com o motivo escrito');
select is((select count(*)::int from public.tasks tk where tk.organization_id = pg_temp.org('12')),
          0, 'e o passo pulado não abre tarefa nenhuma');
select is((select current_position::int from public.cadence_enrollments
            where organization_id = pg_temp.org('12')),
          1, 'a cadência avança mesmo assim');
select is((select valor -> 'primeiro_toque' ->> 'acao' from pg_temp.r where chave = 'm12'),
          'agendado', 'e o passo seguinte fica agendado, não executado');

-- 6.5 A tarefa concluída resolve o toque; a cancelada o pula.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r
select 'm13', public.matricular_em_cadencia(pg_temp.org('13'), 'voz_primeiro');
select pg_temp.sair();
update public.tasks set status = 'done'
 where id = ((select valor -> 'primeiro_toque' ->> 'task_id' from pg_temp.r where chave = 'm13'))::uuid;
select is((select t.status::text from public.cadence_touches t
            where t.organization_id = pg_temp.org('13')),
          'feito', 'tarefa concluída no Meu dia resolve o toque, sem passar pelo registro de contato');
select ok((select e.next_due_at is not null and e.status = 'ativa'
             from public.cadence_enrollments e where e.organization_id = pg_temp.org('13')),
          'e a matrícula volta para a fila do motor, ainda ativa');
select ok((select count(*)::int from public.cadence_touches t
            where t.organization_id = pg_temp.org('13') and t.status = 'pendente') = 0,
          'sem nenhum toque pendente por cima: a fila não se auto-alimenta');

-- 6.6 Resposta encerra a cadência (RF-CON-18) — em todas as matrículas da org.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r
select 'm14', public.matricular_em_cadencia(pg_temp.org('14'), 'voz_primeiro');
select pg_temp.sair();
insert into public.activities (type, organization_id, deal_id, outcome_id, body)
values ('call', pg_temp.org('14'), 'e0000000-0000-4000-8000-00000000ca14',
        pg_temp.desfecho('lig_interessado'), 'atendeu e se interessou');
select is((select e.status::text || '/' || e.end_reason from public.cadence_enrollments e
            where e.organization_id = pg_temp.org('14')),
          'encerrada/resposta',
          'porta aberta encerra a cadência: a resposta é do parceiro, não da campanha');
select ok((select t.status = 'feito' and t.activity_id is not null and t.done_at is not null
             from public.cadence_touches t where t.organization_id = pg_temp.org('14')),
          'e o toque pendente se resolve na atividade que aconteceu');

-- 6.7 Opt-out para tudo, suprime e não deixa rematricular.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r
select 'm16', public.matricular_em_cadencia(pg_temp.org('16'), 'voz_primeiro');
select pg_temp.sair();
insert into public.consent_events (kind, organization_id, channel, evidence_text)
values ('contact_optout', pg_temp.org('16'), 'whatsapp', 'respondeu SAIR');
select is((select e.status::text from public.cadence_enrollments e
            where e.organization_id = pg_temp.org('16')),
          'encerrada', 'opt-out encerra a cadência na hora');
select is((select t.status::text from public.cadence_touches t
            where t.organization_id = pg_temp.org('16')),
          'cancelado', 'e o toque pendente é cancelado, não "adiado"');
select ok((select tk.status = 'cancelled' from public.tasks tk
             join public.cadence_touches t on t.task_id = tk.id
            where t.organization_id = pg_temp.org('16')),
          'a tarefa que estava na mão da Heloísa some do Meu dia');
select ok(app.is_suppressed_target(pg_temp.org('16')),
          'e a organização passa a ser alvo suprimido');

-- 6.8 Silêncio: D+limite encerra e move para nutrição, SEM mandar nada.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r
select 'm15', public.matricular_em_cadencia(pg_temp.org('15'), 'voz_primeiro');
select pg_temp.sair();
update public.cadence_enrollments set enrolled_at = now() - interval '40 days'
 where organization_id = pg_temp.org('15');
select lives_ok(
  format($$select app.encerrar_por_silencio(%L)$$, (pg_temp.matricula(pg_temp.org('15'))).id),
  'a régua de silêncio roda');
select is((select e.status::text || '/' || e.end_reason from public.cadence_enrollments e
            where e.organization_id = pg_temp.org('15')),
          'encerrada/silencio', 'D+14 sem resposta encerra a cadência');
select is((select s.slug from public.deals d join public.stages s on s.id = d.stage_id
            where d.organization_id = pg_temp.org('15')),
          'nutricao', 'e o negócio vai para nutrição — sem mandar nada (RF-CON-13)');
select is((select count(*)::int from public.cadence_touches t
            where t.organization_id = pg_temp.org('15') and t.status = 'pendente'),
          0, 'nenhum toque sobra pendente depois do encerramento');

-- 6.9 A porteira continua mandando: cooldown ADIA e não cria trabalho.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r
select 'm21', public.matricular_em_cadencia(pg_temp.org('21'), 'voz_primeiro');
select pg_temp.sair();
select is((select valor -> 'primeiro_toque' ->> 'motivo' from pg_temp.r where chave = 'm21'),
          'cooldown', 'matrícula durante o cooldown: o motor ADIA');
select is((select valor -> 'primeiro_toque' ->> 'acao' from pg_temp.r where chave = 'm21'),
          'adiado', 'e o verbo é adiar, não encerrar');
select is((select count(*)::int from public.cadence_touches t
            where t.organization_id = pg_temp.org('21')),
          0, 'nenhum toque nasce enquanto o cooldown corre');
select is((select count(*)::int from public.tasks tk
            where tk.organization_id = pg_temp.org('21') and tk.origin = 'cadence'),
          0, 'e nenhuma tarefa: o cooldown é FILTRO DE ENTRADA (RF-FUN-13)');
select ok((select e.next_due_at > now() + interval '4 days'
             from public.cadence_enrollments e where e.organization_id = pg_temp.org('21')),
          'a matrícula fica ativa esperando o fim do cooldown, e o fim é uma DATA, não um evento');

-- 6.10 Desfecho não reativável ENCERRA a matrícula, em vez de reagendar.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r
select 'm22', public.matricular_em_cadencia(pg_temp.org('22'), 'voz_primeiro');
select pg_temp.sair();
select is((select valor -> 'primeiro_toque' ->> 'motivo' from pg_temp.r where chave = 'm22'),
          'nao_reativavel', 'quem disse um "não" firme encerra a matrícula na porta');
select is((select e.status::text from public.cadence_enrollments e
            where e.organization_id = pg_temp.org('22')),
          'encerrada', 'e a matrícula nasce e morre no mesmo instante — nada fica agendado');

-- 6.11 A régua não roda em feriado (nem em domingo).
insert into public.holidays (date, name, scope)
values (pg_temp.hoje(), 'pgTAP feriado de hoje', 'municipal')
on conflict (date, scope) do nothing;
select ok(not app.dia_util_de_operacao(),
          'com feriado lançado para hoje, hoje deixa de ser dia de operação');
select is(app.cadencias_agendar(), 0,
          'e a régua não abre um único toque em feriado (RF-CON-11)');
select is(app.cadencias_encerrar_silencio(), 0,
          'nem encerra por silêncio em feriado: o dia não é de operação');
select is(app.precadastros_lembrete(), 0,
          'nem o lembrete do rascunho sai em feriado');
delete from public.holidays where name = 'pgTAP feriado de hoje';

-- 6.12 E, em dia útil, ela pergunta ao motor — sem criar nada por vencimento.
create or replace function app.dia_util_de_operacao(p_at timestamptz default now())
returns boolean language sql stable set search_path = '' as $$ select true $$;
select ok(app.cadencias_agendar() >= 1,
          'em dia útil a régua percorre as matrículas ativas que já venceram');
select is((select count(*)::int from public.cadence_touches t
            where t.organization_id = pg_temp.org('21')),
          0, 'e continua sem criar nada para quem está em cooldown: vencimento não é gatilho de envio');
select is((select count(*)::int from public.cadence_touches t
            where t.contact_id = 'd0000000-0000-4000-8000-0000000ca001'
              and t.status = 'pendente'),
          1, 'nem um segundo toque para a pessoa que já tem um pendente na outra empresa');
create or replace function app.dia_util_de_operacao(p_at timestamptz default now())
returns boolean language sql stable set search_path = '' as $$
  select extract(dow from p_at at time zone 'America/Fortaleza')::int <> 0
     and not exists (select 1 from public.holidays h
                      where h.date = (p_at at time zone 'America/Fortaleza')::date)
$$;

-- 6.13 As cinco cadências do contrato, e as duas exigências de entrada.
select is((select count(*)::int from public.cadences
            where slug in ('voz_primeiro','retomar_conversa','pos_autorizacao',
                           'completar_cadastro','reativacao')),
          5, 'as cinco cadências do contrato estão em seed');
select is((select string_agg(slug, ',' order by slug) from public.cadences where requires_gancho),
          'reativacao', 'só a reativação exige gancho preenchido por gente (RF-CON-15)');
select is((select string_agg(slug, ',' order by slug) from public.cadences where requires_authorization),
          'pos_autorizacao', 'só o onboarding exige autorização registrada (RF-PRE-06)');
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
select is(public.matricular_em_cadencia(pg_temp.org('19'), 'reativacao') ->> 'motivo',
          'gancho_obrigatorio', 'reativação sem gancho é recusada');
select is(public.matricular_em_cadencia(pg_temp.org('19'), 'pos_autorizacao') ->> 'motivo',
          'sem_autorizacao', 'onboarding sem consent_events é recusado');
select is(public.matricular_em_cadencia(pg_temp.org('19'), 'reativacao',
                                        'Lead real de casamento em dezembro') ->> 'ok',
          'true', 'com gancho de gente, a reativação entra');
select is(public.encerrar_cadencia((pg_temp.matricula(pg_temp.org('19'))).id, '   ') ->> 'motivo',
          'motivo_obrigatorio', 'encerrar cadência sem motivo é recusado — decisão sem motivo não é decisão');
select is(public.encerrar_cadencia((pg_temp.matricula(pg_temp.org('19'))).id, 'teste pgTAP') ->> 'ok',
          'true', 'com motivo, encerra');
select pg_temp.sair();
select throws_ok(
  format($$insert into public.cadence_enrollments (cadence_id, organization_id, gancho)
           values (%s, %L, null)$$, pg_temp.cad('reativacao'), pg_temp.org('19')),
  '23514', null, 'e por psql, sem gancho, o gatilho recusa igual');

-- 6.14 O vocabulário fechado dos passos.
select throws_ok(
  format($$insert into public.cadence_steps
             (cadence_id, "position", channel, task_kind, title, condition)
           values (%s, 9, 'whatsapp', 'message', 'Passo inventado', '{"lua_cheia": true}')$$,
         pg_temp.cad('voz_primeiro')),
  '23514', null, 'condição fora do vocabulário é erro de migração, não silêncio em produção');
select throws_ok(
  format($$insert into public.cadence_steps
             (cadence_id, "position", channel, task_kind, title, condition)
           values (%s, 9, 'whatsapp', 'message', 'Desfecho inventado',
                   '{"ultimo_desfecho_em": ["nao_existe"]}')$$, pg_temp.cad('voz_primeiro')),
  '23503', null, 'e citar desfecho fora do catálogo também é recusado');
select throws_ok(
  format($$insert into public.cadence_steps
             (cadence_id, "position", channel, task_kind, title, audio_slug, template_code)
           values (%s, 9, 'phone', 'call', 'Áudio por telefone', 'gen-onb-ajuda-1', 'GEN-ONB-D7')$$,
         pg_temp.cad('voz_primeiro')),
  '23514', null, 'áudio só existe no WhatsApp, e nunca sem o texto que o resume (R06 WA-13)');
select throws_ok(
  format($$insert into public.cadence_steps
             (cadence_id, "position", channel, task_kind, title, audio_slug, template_code)
           values (%s, 4, 'whatsapp', 'message', 'Segundo áudio seguido', 'gen-onb-ajuda-1', 'GEN-ONB-D7')$$,
         pg_temp.cad('pos_autorizacao')),
  '23514', null, 'dois áudios seguidos são proibidos (RF-CON-24)');


-- =====================================================================
-- 7. SUPRESSÃO POR PSQL — o guardrail vale sem tela e sem RLS no caminho
-- =====================================================================
select throws_ok(
  format($$insert into public.cadence_enrollments (cadence_id, organization_id)
           values (%s, %L)$$, pg_temp.cad('voz_primeiro'), pg_temp.org('31')),
  '42501', null, 'nenhuma cadência nasce para organização com do_not_contact');
select throws_ok(
  format($$insert into public.cadence_enrollments (cadence_id, organization_id)
           values (%s, %L)$$, pg_temp.cad('voz_primeiro'), pg_temp.org('32')),
  '42501', null, 'nem para quem só tem o telefone na suppression_list');
select throws_ok(
  format($$insert into public.cadence_enrollments (cadence_id, organization_id, contact_id)
           values (%s, %L, 'd0000000-0000-4000-8000-0000000ca002')$$,
         pg_temp.cad('voz_primeiro'), pg_temp.org('33')),
  '42501', null, 'nem com a organização limpa e o CONTATO suprimido');
select throws_ok(
  format($$update public.cadence_enrollments
              set status = 'ativa', ended_at = null, end_reason = null
            where organization_id = %L$$, pg_temp.org('16')),
  '42501', null, 'e a matrícula encerrada por opt-out não pode ser revivida por UPDATE');
select throws_ok(
  format($$insert into public.tasks (title, kind, organization_id)
           values ('Ligar mesmo assim', 'call', %L)$$, pg_temp.org('31')),
  '42501', null, 'nenhuma tarefa DE CONTATO nasce para alvo suprimido (RF-CON-18)');
select throws_ok(
  $$insert into public.tasks (title, kind, contact_id)
     values ('Mandar mensagem', 'message', 'd0000000-0000-4000-8000-0000000ca002')$$,
  '42501', null, 'nem apontando só para o contato suprimido, sem organização');
select lives_ok(
  format($$insert into public.tasks (title, kind, organization_id)
           values ('Responder pedido de exclusão do titular', 'other', %L)$$, pg_temp.org('31')),
  'mas a tarefa "other" passa: é onde mora a obrigação de LGPD com quem pediu para sair');
select throws_ok(
  format($$insert into public.pre_registrations (organization_id) values (%L)$$, pg_temp.org('31')),
  '42501', null, 'nenhum pré-cadastro nasce para alvo suprimido');
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
select is(public.matricular_em_cadencia(pg_temp.org('31'), 'voz_primeiro') ->> 'motivo',
          'contato_suprimido', 'a RPC recusa com motivo legível, em vez de estourar na tela');
select is(public.criar_pre_cadastro(pg_temp.org('32')) ->> 'motivo',
          'contato_suprimido', 'criar_pre_cadastro recusa alvo suprimido');
select is(public.gerar_link_de_reivindicacao(pg_temp.org('32')) ->> 'motivo',
          'contato_suprimido', 'e nenhum link de reivindicação é emitido para ele');
select pg_temp.sair();


-- =====================================================================
-- 8. PRÉ-CADASTRO — rascunho, autorização, token e prova
-- =====================================================================
-- 8.1 O rascunho só aceita o factual.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r
select 'pre41', public.criar_pre_cadastro(pg_temp.org('41'),
  '{"nome_exibicao":"Buffet do Fluxo","categorias":["buffet"],"cidade":"Natal","bairro":"Tirol"}'::jsonb,
  'Instagram público', 'https://instagram.com/cadbuffet41', 3);
select is((select valor ->> 'ok' from pg_temp.r where chave = 'pre41'), 'true',
          'rascunho criado com dados factuais');
select is(public.criar_pre_cadastro(pg_temp.org('41'), '{"cpf":"12345678901"}'::jsonb) ->> 'motivo',
          'campo_fora_da_whitelist', 'CPF não entra no rascunho, nem por RPC (ADR-09, RF-PRE-04)');
select is(public.criar_pre_cadastro(pg_temp.org('41'), '{"avaliacao_google":"4,8"}'::jsonb) ->> 'motivo',
          'campo_fora_da_whitelist', 'avaliação copiada de terceiro também não (R06 §4.1)');
select pg_temp.sair();
select throws_ok(
  format($$update public.pre_registrations set prefilled = '{"chave_pix":"84999997041"}'::jsonb
            where organization_id = %L$$, pg_temp.org('41')),
  '23514', null, 'e por psql a chave Pix é recusada pelo CHECK, não pela tela');
select throws_ok(
  format($$update public.pre_registrations set prefilled = '{"texto_do_perfil_alheio":"..."}'::jsonb
            where organization_id = %L$$, pg_temp.org('41')),
  '23514', null, 'campo fora da whitelist é recusado pelo CHECK');

-- 8.2 Sem autorização registrada não existe link. É o guardrail do CLAUDE.md.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
select is(public.gerar_link_de_reivindicacao(pg_temp.org('41')) ->> 'motivo',
          'sem_autorizacao',
          'pré-cadastro na Komune só depois de autorização registrada em consent_events');
insert into public.consent_events (kind, organization_id, channel, evidence_text)
values ('data_use_authorized', pg_temp.org('41'), 'phone', 'autorizou na ligação de 05/09');
select ok(app.tem_autorizacao_vigente(pg_temp.org('41')),
          'com a autorização lançada, ela passa a vigorar');
insert into pg_temp.r
select 'link41', public.gerar_link_de_reivindicacao(pg_temp.org('41'));
select pg_temp.sair();
select is((select valor ->> 'ok' from pg_temp.r where chave = 'link41'), 'true',
          'e o link sai');

-- 8.3 O token: hash, prazo, uso único, reenvio que mata o anterior.
select ok((select pr.claim_token_hash
                  = app.sha256_hex((select valor ->> 'token' from pg_temp.r where chave = 'link41'))
             from public.pre_registrations pr where pr.organization_id = pg_temp.org('41')),
          'o banco guarda o SHA-256 do token');
select ok((select pr.claim_token_hash
                  <> (select valor ->> 'token' from pg_temp.r where chave = 'link41')
             from public.pre_registrations pr where pr.organization_id = pg_temp.org('41')),
          'e nunca o token em claro (RF-PRE-07)');
select is((select (pr.claim_token_expires_at - pr.claim_token_issued_at)::text
             from public.pre_registrations pr where pr.organization_id = pg_temp.org('41')),
          '7 days', 'a validade é de 7 dias');
select throws_ok(
  format($$update public.pre_registrations set claim_token_expires_at = null
            where organization_id = %L$$, pg_temp.org('41')),
  '23514', null, 'token sem prazo é token eterno: o CHECK recusa');
select is(public.abrir_reivindicacao(repeat('f', 64)) ->> 'motivo', 'token_invalido',
          'token que não existe não abre nada');
select is(public.abrir_reivindicacao('nao-sou-hexadecimal') ->> 'motivo', 'token_invalido',
          'e um token fora do formato nem chega a consultar a tabela');
select is(public.abrir_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link41'),
                                     'Mozilla/5.0 pgTAP', '200.1.2.3') ->> 'ok', 'true',
          'com o token certo, a página T1 abre');
select ok((select pr.claim_link_opened_at is not null
             from public.pre_registrations pr where pr.organization_id = pg_temp.org('41')),
          'e a abertura fica registrada');
select ok((select e.payload ->> 'ip_hash' is not null and e.payload ? 'ip' = false
             from public.pre_registration_events e
            where e.organization_id = pg_temp.org('41') and e.event = 'claim_link_opened'),
          'guardando o HASH do IP, nunca o IP');
select throws_ok(
  format($$insert into public.pre_registration_events
             (pre_registration_id, organization_id, event, payload)
           select pr.id, pr.organization_id, 'claim_link_sent', '{"token":"segredo"}'::jsonb
             from public.pre_registrations pr where pr.organization_id = %L$$, pg_temp.org('41')),
  '23514', null, 'o token nunca entra no log de eventos — há CHECK');

-- Token expirado não serve.
update public.pre_registrations set claim_token_expires_at = now() - interval '1 hour'
 where organization_id = pg_temp.org('41');
select is(public.abrir_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link41'))
            ->> 'motivo', 'token_expirado', 'token vencido não abre a página');
select is(public.aceitar_reivindicacao(
            (select valor ->> 'token' from pg_temp.r where chave = 'link41'),
            'v1.0', repeat('a', 64), '200.1.2.3', 'Mozilla/5.0 pgTAP', 'Fulano de Tal')
            ->> 'motivo', 'token_expirado', 'e muito menos aceita termo');

-- Reenvio invalida o anterior.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r
select 'link41b', public.gerar_link_de_reivindicacao(pg_temp.org('41'));
select pg_temp.sair();
select is(public.abrir_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link41'))
            ->> 'motivo', 'token_invalido',
          'reenviar o link mata o token anterior (RF-PRE-07)');
select is(public.abrir_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link41b'))
            ->> 'ok', 'true', 'e só o novo abre');
select ok(exists (select 1 from public.pre_registration_events e
                   where e.organization_id = pg_temp.org('41') and e.event = 'claim_link_revoked'),
          'a revogação do anterior fica no log');

-- 8.4 Publicar sem reivindicação e sem prova é recusado PELO BANCO.
select throws_ok(
  format($$update public.pre_registrations set published = true where organization_id = %L$$,
         pg_temp.org('41')),
  '42501', null, 'rascunho não reivindicado não pode ser publicado (RF-PRE-02)');
update public.pre_registrations set claimed_at = now(), claimed_channel = 'cs_manual'
 where organization_id = pg_temp.org('41');
select throws_ok(
  format($$update public.pre_registrations set published = true where organization_id = %L$$,
         pg_temp.org('41')),
  '42501', null, 'e reivindicado sem aceite provado também não (LGPD art. 8º §2º)');
update public.pre_registrations set claimed_at = null, claimed_channel = null
 where organization_id = pg_temp.org('41');

-- 8.5 O aceite: prova completa ou nada.
select col_not_null('public', 'pre_registration_acceptances', 'ip',            'a prova exige IP');
select col_not_null('public', 'pre_registration_acceptances', 'user_agent',    'a prova exige user-agent');
select col_not_null('public', 'pre_registration_acceptances', 'terms_version', 'a prova exige a versão do termo');
select col_not_null('public', 'pre_registration_acceptances', 'terms_hash',    'a prova exige o hash do termo');
select col_not_null('public', 'pre_registration_acceptances', 'accepted_at',   'a prova exige o carimbo');
select col_not_null('public', 'pre_registration_acceptances', 'auth_method',   'a prova exige o método de autenticação');
select col_not_null('public', 'pre_registration_acceptances', 'who_accepted',  'a prova exige quem aceitou');

select is(public.aceitar_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link41b'),
            'v1.0', repeat('a', 64), '', 'Mozilla/5.0 pgTAP', 'Fulano de Tal') ->> 'motivo',
          'prova_incompleta', 'aceite sem IP não é aceite');
select is(public.aceitar_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link41b'),
            'v1.0', repeat('a', 64), '200.1.2.3', 'x', 'Fulano de Tal') ->> 'motivo',
          'prova_incompleta', 'aceite sem user-agent de verdade não é aceite');
select is(public.aceitar_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link41b'),
            '  ', repeat('a', 64), '200.1.2.3', 'Mozilla/5.0 pgTAP', 'Fulano de Tal') ->> 'motivo',
          'prova_incompleta', 'aceite sem versão do termo não é aceite');
select is(public.aceitar_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link41b'),
            'v1.0', 'hash-curto', '200.1.2.3', 'Mozilla/5.0 pgTAP', 'Fulano de Tal') ->> 'motivo',
          'prova_incompleta', 'aceite sem o hash do termo não é aceite');
select is(public.aceitar_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link41b'),
            'v1.0', repeat('a', 64), '200.1.2.3', 'Mozilla/5.0 pgTAP', ' ') ->> 'motivo',
          'prova_incompleta', 'aceite sem saber quem aceitou não é aceite');
select is((select count(*)::int from public.pre_registration_acceptances a
            where a.organization_id = pg_temp.org('41')),
          0, 'e nenhuma das cinco tentativas deixou meia-prova gravada');

insert into pg_temp.r
select 'ac41', public.aceitar_reivindicacao(
  (select valor ->> 'token' from pg_temp.r where chave = 'link41b'),
  'termos-v1.0', repeat('b', 64), '200.1.2.3', 'Mozilla/5.0 (pgTAP) Safari/605',
  'Fulano de Tal', 'claim_link', true, false);
select is((select valor ->> 'ok' from pg_temp.r where chave = 'ac41'), 'true',
          'com a prova completa, o aceite entra');
select ok((select a.terms_accepted and a.data_authorization and a.marketing_optin
                  and not a.photo_import_authorized and a.consent_event_id is not null
             from public.pre_registration_acceptances a where a.organization_id = pg_temp.org('41')),
          'as três caixas são separadas, e o marketing é opcional e vira consent_events próprio');
select is((select count(*)::int from public.consent_events e
            where e.organization_id = pg_temp.org('41')
              and e.kind in ('data_use_authorized','contact_optin')),
          3, 'a autorização do aceite e o opt-in de marketing viram registro de consentimento');
select throws_ok(
  format($$insert into public.pre_registration_acceptances
             (pre_registration_id, organization_id, terms_version, terms_hash, terms_accepted,
              data_authorization, ip, user_agent, auth_method, who_accepted)
           select pr.id, pr.organization_id, 'v1', %L, false, true, '1.2.3.4', 'pgTAP agent',
                  'claim_link', 'Fulano'
             from public.pre_registrations pr where pr.organization_id = %L$$,
         repeat('c', 64), pg_temp.org('41')),
  '23514', null, 'aceite com terms_accepted = false é recusado: não é aceite');
select throws_ok(
  format($$insert into public.pre_registration_acceptances
             (pre_registration_id, organization_id, terms_version, terms_hash, terms_accepted,
              data_authorization, ip, user_agent, auth_method, who_accepted)
           select pr.id, %L, 'v1', %L, true, true, '1.2.3.4', 'pgTAP agent', 'claim_link', 'Fulano'
             from public.pre_registrations pr where pr.organization_id = %L$$,
         pg_temp.org('45'), repeat('c', 64), pg_temp.org('41')),
  '23514', null,
  'e a prova não pode ser arquivada sob outra organização — é a coluna que a RLS lê (conserto de 20260904001801)');
select throws_ok(
  $$update public.pre_registration_acceptances set who_accepted = 'outra pessoa'$$,
  '42501', null, 'a prova é append-only: não se edita');
select throws_ok(
  $$delete from public.pre_registration_acceptances$$,
  '42501', null, 'e não se apaga');
select throws_ok(
  $$update public.pre_registration_events set event = 'published'$$,
  '42501', null, 'o log de onboarding também é append-only');

-- 8.6 O token morre no uso, e agora a publicação passa.
select is(public.abrir_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link41b'))
            ->> 'motivo', 'token_invalido',
          'depois do aceite o token não serve uma segunda vez');
select ok((select pr.claim_token_hash is null and pr.claim_token_expires_at is null
             from public.pre_registrations pr where pr.organization_id = pg_temp.org('41')),
          'porque ele deixou de existir no banco');
select lives_ok(
  format($$update public.pre_registrations set published = true where organization_id = %L$$,
         pg_temp.org('41')),
  'com reivindicação e prova, a publicação passa');
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
select ok((public.pre_cadastro_do_parceiro(pg_temp.org('41'))::text) not like '%claim_token%',
          'e a ficha do parceiro nunca devolve o token — só o que dá para dizer sobre ele');
select ok((public.pre_cadastro_do_parceiro(pg_temp.org('41')) ->> 'publicado')::boolean,
          'a ficha mostra o estado publicado');
select pg_temp.sair();

-- 8.7 Autorização revogada fecha a porta de novo.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r select 'pre45', public.criar_pre_cadastro(pg_temp.org('45'), '{"cidade":"Natal"}'::jsonb);
insert into public.consent_events (kind, organization_id, channel, evidence_text, occurred_at)
values ('data_use_authorized', pg_temp.org('45'), 'phone', 'autorizou', now() - interval '1 hour');
select ok(app.tem_autorizacao_vigente(pg_temp.org('45')), 'autorização vigente antes da revogação');
insert into public.consent_events (kind, organization_id, channel, evidence_text, occurred_at)
values ('data_use_revoked', pg_temp.org('45'), 'phone', 'mudou de ideia', now());
select ok(not app.tem_autorizacao_vigente(pg_temp.org('45')),
          'revogação posterior derruba a autorização (RF-PRE-06)');
select is(public.gerar_link_de_reivindicacao(pg_temp.org('45')) ->> 'motivo', 'sem_autorizacao',
          'e nenhum link novo sai depois dela');
-- EMPATE DE CARIMBO: duas linhas gravadas no mesmo instante (é o que acontece
-- dentro de uma transação, onde now() não anda). Antes de 20260904001801 o
-- empate valia como "ainda autorizado"; agora o silêncio ganha.
insert into public.consent_events (kind, organization_id, channel, evidence_text, occurred_at)
values ('data_use_authorized', pg_temp.org('45'), 'phone', 'autorizou de novo', now());
select ok(not app.tem_autorizacao_vigente(pg_temp.org('45')),
          'no empate de carimbo entre autorização e revogação, vale a revogação (conserto de 20260904001801)');
select pg_temp.sair();

-- 8.8 A recusa sem login: oposição do titular (R06 PRE-09).
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r select 'pre42', public.criar_pre_cadastro(pg_temp.org('42'), '{"cidade":"Natal"}'::jsonb);
insert into public.consent_events (kind, organization_id, channel, evidence_text)
values ('data_use_authorized', pg_temp.org('42'), 'phone', 'autorizou');
insert into pg_temp.r select 'link42', public.gerar_link_de_reivindicacao(pg_temp.org('42'));
select pg_temp.sair();
select is(public.recusar_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link42'),
                                       'motivo_que_nao_existe') ->> 'motivo', 'motivo_invalido',
          'a recusa tem vocabulário fechado');
select is(public.recusar_reivindicacao((select valor ->> 'token' from pg_temp.r where chave = 'link42'),
                                       'nao_quero') ->> 'ok', 'true',
          '"não quero perfil" funciona sem login');
select ok((select pr.refused_at is not null and pr.claim_token_hash is null
                  and pr.purge_after <= now() + interval '48 hours'
             from public.pre_registrations pr where pr.organization_id = pg_temp.org('42')),
          'o token morre e o rascunho fica marcado para apagar em ≤ 48 h');
select ok(app.is_suppressed_target(pg_temp.org('42')),
          'e a oposição do titular suprime o contato (LGPD art. 18 §2º)');

-- 8.9 Retenção: apaga o pré-preenchido, mantém o lead no CRM.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r select 'pre43', public.criar_pre_cadastro(pg_temp.org('43'),
  '{"cidade":"Natal","bairro":"Ponta Negra","site":"https://x.com.br"}'::jsonb);
select pg_temp.sair();
update public.pre_registrations
   set expires_at = now() - interval '3 days', reminded_at = now() - interval '10 days'
 where organization_id = pg_temp.org('43');
select ok(app.precadastros_expirar() >= 1, 'a retenção roda e apaga o que passou do prazo');
select ok((select pr.purged_at is not null and pr.prefilled = '{}'::jsonb
                  and pr.status = 'expired'
             from public.pre_registrations pr where pr.organization_id = pg_temp.org('43')),
          'o rascunho não reivindicado em 30 dias perde os dados pré-preenchidos');
select ok(exists (select 1 from public.organizations o
                   where o.id = pg_temp.org('43') and o.deleted_at is null),
          'e o LEAD NO CRM PERMANECE — R06 item 9, PRD §10.6');
select ok(exists (select 1 from public.pre_registration_events e
                   where e.organization_id = pg_temp.org('43')
                     and e.event = 'pre_registration_purged'),
          'o expurgo deixa rastro no log');
select throws_ok(
  format($$update public.pre_registrations set published = true where organization_id = %L$$,
         pg_temp.org('43')),
  '42501', null, 'e rascunho apagado não volta a ser publicado');

-- O lembrete é ÚNICO e é TAREFA, não envio.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
insert into pg_temp.r select 'pre44', public.criar_pre_cadastro(pg_temp.org('44'), '{"cidade":"Natal"}'::jsonb);
insert into public.consent_events (kind, organization_id, channel, evidence_text)
values ('data_use_authorized', pg_temp.org('44'), 'phone', 'autorizou');
insert into pg_temp.r select 'link44', public.gerar_link_de_reivindicacao(pg_temp.org('44'));
select pg_temp.sair();
update public.pre_registrations set expires_at = now() + interval '5 days'
 where organization_id = pg_temp.org('44');
-- O lembrete também não sai em domingo nem feriado (provado em 6.11). Aqui o dia
-- é fixado em útil para que o arquivo passe igual num domingo de plantão.
create or replace function app.dia_util_de_operacao(p_at timestamptz default now())
returns boolean language sql stable set search_path = '' as $$ select true $$;
select ok(app.precadastros_lembrete() >= 1, 'o lembrete de expiração roda');
select is((select count(*)::int from public.tasks tk
            where tk.organization_id = pg_temp.org('44') and tk.origin = 'system'),
          1, 'e o que ele produz é UMA tarefa humana — não uma mensagem (ADR-05)');
select is(app.precadastros_lembrete(), 0,
          'e é o ÚNICO lembrete: rodar de novo não avisa duas vezes (R06 item 9)');
create or replace function app.dia_util_de_operacao(p_at timestamptz default now())
returns boolean language sql stable set search_path = '' as $$
  select extract(dow from p_at at time zone 'America/Fortaleza')::int <> 0
     and not exists (select 1 from public.holidays h
                      where h.date = (p_at at time zone 'America/Fortaleza')::date)
$$;


-- =====================================================================
-- 9. RLS POR PAPEL EM TODA TABELA NOVA
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca005', 'leitura');
select throws_ok(
  $$insert into public.cadences (slug, name) values ('inventada', 'Cadência inventada')$$,
  '42501', null, 'leitura não cria cadência');
select throws_ok(
  $$insert into public.app_settings (key, value) values ('teto.inventado', '1'::jsonb)$$,
  '42501', null, 'leitura não cria parâmetro de configuração');
-- UPDATE barrado por RLS não estoura: a política USING simplesmente não entrega
-- a linha. O que se prova aqui é que nada mudou.
update public.app_settings set description = 'mexi' where key = 'cadencia.tetos';
select ok((select description from public.app_settings where key = 'cadencia.tetos')
            is distinct from 'mexi',
          'e não mexe nos tetos: a RLS não entrega uma linha sequer para o UPDATE');
select throws_ok(
  $$insert into public.channel_windows (channel, dow, "position", de, ate)
     values ('whatsapp', 4, 3, 9, 12)$$,
  '42501', null, 'leitura não mexe nas janelas');
select is((select count(*)::int from public.pre_registration_acceptances), 0,
          'leitura não enxerga a prova de aceite: ali há IP e user-agent');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca003', 'sdr');
select throws_ok(
  $$insert into public.cadences (slug, name) values ('inventada', 'Cadência inventada')$$,
  '42501', null, 'SDR não desenha cadência: isso é de gestor');
select throws_ok(
  format($$insert into public.cadence_enrollments (cadence_id, organization_id)
           values (%s, %L)$$, pg_temp.cad('voz_primeiro'), pg_temp.org('24')),
  '42501', null, 'SDR não escreve matrícula na mão — o caminho é a RPC');
select is((select count(*)::int from public.pre_registration_acceptances), 0,
          'SDR também não lê a prova de aceite');
select ok((select count(*)::int from public.cadence_enrollments) >= 1,
          'mas SDR enxerga as matrículas da operação');
select is(public.matricular_em_cadencia(pg_temp.org('24'), 'voz_primeiro') ->> 'ok', 'true',
          'e matricula pela RPC, que é o caminho auditado');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca002', 'gestor');
select ok((select count(*)::int from public.pre_registration_acceptances) >= 1,
          'gestor lê a prova de aceite');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000ca004', 'embaixador');
select is((select count(*)::int from public.cadence_enrollments e
            where e.organization_id <> pg_temp.org('19')),
          0, 'embaixador só enxerga matrícula da carteira dele');
select is((select count(*)::int from public.pre_registrations), 0,
          'e nenhum rascunho de organização que não é dele');
select pg_temp.sair();

select ok(not has_table_privilege('anon', 'public.pre_registrations', 'select'),
          'anon não lê pre_registrations: o rascunho não é público');
select ok(not has_table_privilege('anon', 'public.pre_registration_acceptances', 'select'),
          'anon não lê a prova de aceite');
select ok(not has_table_privilege('anon', 'public.cadence_touches', 'select'),
          'anon não lê os toques');
select ok(has_function_privilege('anon',
            'public.abrir_reivindicacao(text, text, text)', 'execute'),
          'a página pública do fornecedor passa por função, não por tabela: abrir');
select ok(has_function_privilege('anon', 'public.recusar_reivindicacao(text, text)', 'execute'),
          'e recusar');
select ok(not has_function_privilege('anon',
            'public.matricular_em_cadencia(uuid, text, text, uuid, uuid)', 'execute'),
          'mas anon não matricula ninguém');
select ok(not has_function_privilege('anon',
            'public.gerar_link_de_reivindicacao(uuid)', 'execute'),
          'nem emite link de reivindicação');
select ok(not has_function_privilege('anon', 'app.abrir_proximo_toque(uuid)', 'execute'),
          'nem toca o motor da cadência');

-- E, no fim: nada disto vazou para a base de operação.
select is(pg_temp.delta('matriculas', pg_temp.n_matriculas()),
          (select count(*)::int from public.cadence_enrollments e
            where e.organization_id in (select id from public.organizations
                                         where name like 'CAD %')),
          'toda matrícula criada aqui é deste arquivo: nenhuma contagem absoluta em tabela compartilhada');

select * from finish();
rollback;

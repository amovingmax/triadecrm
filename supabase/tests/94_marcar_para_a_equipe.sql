-- =====================================================================
-- pgTAP — Marcar para si, ou para quem se acompanha (migração 20261003090000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. O ROBÔ NÃO MUDOU. `public.reuniao_marcar` (a porta dele) continua
--      pondo a reunião no dono do negócio. É a garantia que a migração
--      promete ao trocar o corpo de `app.reuniao_gravar` de lugar.
--   2. O PADRÃO É QUEM MARCA. O gestor que marca num parceiro da carteira da
--      SDR fica com a reunião; o negócio continua da SDR.
--   3. A HIERARQUIA É DO BANCO, não só da tela: gestor marca para SDR e
--      embaixador, não para outro gestor; admin marca para gestor; SDR só
--      para si.
--   4. QUEM RECEBE É AVISADA, e só quando outra pessoa marcou.
--   5. A VISITA NÃO CAI EM CIMA de reunião viva nem de outra visita; encostar
--      (começar quando a outra termina) não é sobrepor. E nunca em sábado,
--      domingo ou feriado.
--   6. REMARCAR MANTÉM A AGENDA de quem já era dono — menos de quem saiu do
--      time —, e avisa o dono quando quem remarca é outra pessoa.
--   7. O AVISO É PRIVADO: cada um lê os seus, ninguém escreve direto.
--   8. NADA DISSO FALA NO WHATSAPP: nenhuma mensagem nova, nada na fila de saída.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(43);

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

create function pg_temp.contratar(p_nome text, p_papel text) returns uuid
language plpgsql as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := 'pgtap94.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                  || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 94 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  update public.profiles set sala_url = 'https://sala.invalid/' || v_id::text where id = v_id;
  return v_id;
end $$;

create temp table equipe94(papel text primary key, id uuid not null);
insert into equipe94 values
  ('admin',   pg_temp.contratar('Adalgisa Pgtap94', 'admin')),
  ('gestor',  pg_temp.contratar('Gervasio Pgtap94', 'gestor')),
  ('gestor2', pg_temp.contratar('Genoveva Pgtap94', 'gestor')),
  ('sdr',     pg_temp.contratar('Serafina Pgtap94', 'sdr')),
  ('sdr2',    pg_temp.contratar('Sebastiao Pgtap94', 'sdr'));
grant select on equipe94 to authenticated;
create function pg_temp.p(p_papel text) returns uuid language sql stable as $$
  select id from equipe94 where papel = p_papel $$;

create function pg_temp.nascer_org(p_nome text, p_dono uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.organizations (kind, name, source_id, collector, owner_id, phone_e164)
  select 'fornecedor'::app.org_kind, p_nome, s.id, 'pgtap94', p_dono,
         '+5584977' || lpad((random()*99999)::int::text, 5, '0')
    from public.sources s order by s.id limit 1
  returning id into v_id;
  return v_id;
end $$;
create function pg_temp.nascer_deal(p_org uuid, p_dono uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.deals (organization_id, pipeline_id, stage_id, owner_id)
  select p_org, 1, st.id, p_dono from public.stages st
   where st.pipeline_id = 1 and st.slug = 'respondeu'
  returning id into v_id;
  return v_id;
end $$;

create temp table fixt94(chave text primary key, id uuid not null);
insert into fixt94 values ('org_a', pg_temp.nascer_org('Buffet Pgtap94 A', pg_temp.p('sdr')));
insert into fixt94 values ('org_b', pg_temp.nascer_org('Buffet Pgtap94 B', pg_temp.p('sdr')));
insert into fixt94 values ('org_c', pg_temp.nascer_org('Buffet Pgtap94 C', pg_temp.p('sdr')));
insert into fixt94 values ('org_r', pg_temp.nascer_org('Buffet Pgtap94 Robo', pg_temp.p('sdr')));
insert into fixt94 values ('deal_a', pg_temp.nascer_deal((select id from fixt94 where chave='org_a'), pg_temp.p('sdr')));
insert into fixt94 values ('deal_b', pg_temp.nascer_deal((select id from fixt94 where chave='org_b'), pg_temp.p('sdr')));
insert into fixt94 values ('deal_c', pg_temp.nascer_deal((select id from fixt94 where chave='org_c'), pg_temp.p('sdr')));
insert into fixt94 values ('deal_r', pg_temp.nascer_deal((select id from fixt94 where chave='org_r'), pg_temp.p('sdr')));
with c as (
  insert into public.conversations (peer_phone_e164, business_number, organization_id, deal_id, assignee_id)
  values ('+5584977000094', '+5584900000094', (select id from fixt94 where chave='org_r'),
          (select id from fixt94 where chave='deal_r'), pg_temp.p('sdr'))
  returning id)
insert into fixt94 select 'conv_r', id from c;
grant select on fixt94 to authenticated;
create function pg_temp.f(p_chave text) returns uuid language sql stable as $$
  select id from fixt94 where chave = p_chave $$;

-- Um dia útil três dias úteis à frente, congelado (ver o porquê no pgTAP 74).
create temp table dia94 as
  select app.next_business_day((now() at time zone 'America/Fortaleza')::date, 3) as d;
grant select on dia94 to authenticated;
create function pg_temp.as(p_hora text) returns timestamptz language sql stable as $$
  select ((select d from dia94) + p_hora::time) at time zone 'America/Fortaleza' $$;

-- A linha de base do WhatsApp, antes de qualquer ação deste arquivo.
create temp table zap94 as
  select (select count(*) from public.messages) as msgs,
         (select count(*) from pgmq.q_wa_outbound) as fila;

-- ---------- 1. o robô não mudou ----------
select is(
  (public.reuniao_marcar(pg_temp.f('conv_r'), pg_temp.as('09:30')) ->> 'ok')::boolean, true,
  'o robô marca pela conversa, como antes');
select is(
  (select dono_id from public.reunioes where deal_id = pg_temp.f('deal_r')),
  pg_temp.p('sdr'),
  'a reunião do robô cai no dono do negócio');
select is(
  (select marcada_por from public.reunioes where deal_id = pg_temp.f('deal_r')), 'robo',
  'e fica marcada como do robô');

-- ---------- 2. o padrão é quem marca ----------
select pg_temp.entrar(pg_temp.p('gestor'), 'gestor');
create temp table r94(chave text primary key, r jsonb);
insert into r94 values ('gestor_para_si',
  public.reuniao_marcar_na_agenda(pg_temp.f('deal_a'), pg_temp.as('10:20')));
select pg_temp.sair();

select is((select (r ->> 'ok')::boolean from r94 where chave='gestor_para_si'), true,
  'o gestor marca sem escolher ninguém');
select is(
  (select dono_id from public.reunioes where id = (select (r ->> 'reuniao_id')::uuid from r94 where chave='gestor_para_si')),
  pg_temp.p('gestor'),
  'e a reunião é DELE, embora o negócio seja da SDR');
select is((select owner_id from public.deals where id = pg_temp.f('deal_a')), pg_temp.p('sdr'),
  'o negócio continua da SDR');
select is(
  (select assignee_id from public.tasks where id = (
     select task_id from public.reunioes where id = (select (r ->> 'reuniao_id')::uuid from r94 where chave='gestor_para_si'))),
  pg_temp.p('gestor'),
  'o eco em tasks também é do gestor');
select is((select count(*)::int from public.agenda_avisos where dono_id = pg_temp.p('gestor')), 0,
  'marcar para si não gera aviso');

-- ---------- 3. a hierarquia é do banco ----------
select pg_temp.entrar(pg_temp.p('gestor'), 'gestor');
insert into r94 values ('gestor_para_sdr',
  public.reuniao_marcar_na_agenda(pg_temp.f('deal_b'), pg_temp.as('11:10'), 'online', null, null, pg_temp.p('sdr')));
insert into r94 values ('gestor_para_gestor',
  public.reuniao_marcar_na_agenda(pg_temp.f('deal_b'), pg_temp.as('12:00'), 'online', null, null, pg_temp.p('gestor2')));
select pg_temp.sair();

select is((select (r ->> 'ok')::boolean from r94 where chave='gestor_para_sdr'), true,
  'o gestor marca para a SDR');
select is(
  (select dono_id from public.reunioes where id = (select (r ->> 'reuniao_id')::uuid from r94 where chave='gestor_para_sdr')),
  pg_temp.p('sdr'),
  'a reunião vai para a agenda da SDR');
select is(
  (select marcada_por_id from public.reunioes where id = (select (r ->> 'reuniao_id')::uuid from r94 where chave='gestor_para_sdr')),
  pg_temp.p('gestor'),
  'e fica registrado que foi o gestor quem marcou');
select is((select r ->> 'motivo' from r94 where chave='gestor_para_gestor'), 'nao_acompanha',
  'o gestor NÃO marca para outro gestor');

select pg_temp.entrar(pg_temp.p('admin'), 'admin');
insert into r94 values ('admin_para_gestor',
  public.reuniao_marcar_na_agenda(pg_temp.f('deal_b'), pg_temp.as('12:50'), 'online', null, null, pg_temp.p('gestor2')));
select pg_temp.sair();
select is((select (r ->> 'ok')::boolean from r94 where chave='admin_para_gestor'), true,
  'o admin marca para um gestor');

select pg_temp.entrar(pg_temp.p('sdr'), 'sdr');
insert into r94 values ('sdr_para_gestor',
  public.reuniao_marcar_na_agenda(pg_temp.f('deal_c'), pg_temp.as('13:40'), 'online', null, null, pg_temp.p('gestor')));
insert into r94 values ('sdr_para_sdr2',
  public.reuniao_marcar_na_agenda(pg_temp.f('deal_c'), pg_temp.as('13:40'), 'online', null, null, pg_temp.p('sdr2')));
insert into r94 values ('visita_sdr_para_sdr2',
  public.visita_marcar(pg_temp.f('org_c'), pg_temp.as('08:00'), null, pg_temp.p('sdr2')));
select pg_temp.sair();
select is((select r ->> 'motivo' from r94 where chave='sdr_para_gestor'), 'nao_acompanha',
  'a SDR não marca para o gestor');
select is((select r ->> 'motivo' from r94 where chave='sdr_para_sdr2'), 'nao_acompanha',
  'nem para outra SDR');
select is((select r ->> 'motivo' from r94 where chave='visita_sdr_para_sdr2'), 'nao_acompanha',
  'e a visita segue a mesma regra');

-- ---------- 4. quem recebe é avisada ----------
select is(
  (select count(*)::int from public.agenda_avisos
    where dono_id = pg_temp.p('sdr') and marcado_por = pg_temp.p('gestor') and tipo = 'reuniao'),
  1, 'a SDR tem um aviso da reunião que o gestor marcou');
select is(
  (select quando from public.agenda_avisos where dono_id = pg_temp.p('sdr') and tipo = 'reuniao'),
  pg_temp.as('11:10'), 'o aviso diz quando');

-- ---------- 5. a visita não cai em cima ----------
select pg_temp.entrar(pg_temp.p('gestor'), 'gestor');
-- 11h30 bate na reunião da SDR de 11h10–11h50.
insert into r94 values ('visita_em_cima_da_reuniao',
  public.visita_marcar(pg_temp.f('org_c'), pg_temp.as('11:30'), pg_temp.f('deal_c'), pg_temp.p('sdr')));
insert into r94 values ('visita_livre',
  public.visita_marcar(pg_temp.f('org_c'), pg_temp.as('15:00'), pg_temp.f('deal_c'), pg_temp.p('sdr')));
-- 15h30 bate na visita das 15h00 (45 min).
insert into r94 values ('visita_em_cima_da_visita',
  public.visita_marcar(pg_temp.f('org_c'), pg_temp.as('15:30'), pg_temp.f('deal_c'), pg_temp.p('sdr')));
-- 15h45 encosta: começa quando a outra termina.
insert into r94 values ('visita_encostada',
  public.visita_marcar(pg_temp.f('org_c'), pg_temp.as('15:45'), pg_temp.f('deal_c'), pg_temp.p('sdr')));
select pg_temp.sair();

select is((select r ->> 'motivo' from r94 where chave='visita_em_cima_da_reuniao'), 'horario_ocupado',
  'visita em cima de reunião viva é recusada');
select is(
  (select r -> 'conflitos' -> 0 ->> 'tipo' from r94 where chave='visita_em_cima_da_reuniao'), 'reuniao',
  'e a recusa diz com o quê bateu');
select is((select (r ->> 'ok')::boolean from r94 where chave='visita_livre'), true,
  'visita em horário livre entra');
select is(
  (select assignee_id from public.tasks where id = (select (r ->> 'task_id')::uuid from r94 where chave='visita_livre')),
  pg_temp.p('sdr'), 'na agenda da SDR');
select is(
  (select created_by from public.tasks where id = (select (r ->> 'task_id')::uuid from r94 where chave='visita_livre')),
  pg_temp.p('gestor'), 'criada pelo gestor');
select is((select r ->> 'motivo' from r94 where chave='visita_em_cima_da_visita'), 'horario_ocupado',
  'visita em cima de outra visita é recusada');
select is((select (r ->> 'ok')::boolean from r94 where chave='visita_encostada'), true,
  'encostar não é sobrepor');
select is(
  (select count(*)::int from public.agenda_avisos where dono_id = pg_temp.p('sdr') and tipo = 'visita'),
  2, 'cada visita marcada pelo gestor gerou um aviso');

-- Sábado, domingo e feriado: a visita é recusada, para si ou para a equipe.
insert into public.holidays (date, name, scope)
values ((select d from dia94) + 7, 'Feriado de teste (pgTAP 94)', 'municipal');
select pg_temp.entrar(pg_temp.p('gestor'), 'gestor');
insert into r94 values ('visita_no_sabado',
  public.visita_marcar(pg_temp.f('org_c'),
    (((select d from dia94) + (6 - extract(isodow from (select d from dia94))::int)) + time '10:00')
      at time zone 'America/Fortaleza', null, pg_temp.p('sdr')));
insert into r94 values ('visita_no_domingo',
  public.visita_marcar(pg_temp.f('org_c'),
    (((select d from dia94) + (7 - extract(isodow from (select d from dia94))::int)) + time '10:00')
      at time zone 'America/Fortaleza'));
insert into r94 values ('visita_no_feriado',
  public.visita_marcar(pg_temp.f('org_c'),
    (((select d from dia94) + 7) + time '10:00') at time zone 'America/Fortaleza'));
select pg_temp.sair();
select is((select r ->> 'motivo' from r94 where chave='visita_no_sabado'), 'dia_nao_util',
  'visita no sábado é recusada');
select is((select r ->> 'motivo' from r94 where chave='visita_no_domingo'), 'dia_nao_util',
  'visita no domingo é recusada');
select is((select r ->> 'motivo' from r94 where chave='visita_no_feriado'), 'dia_nao_util',
  'visita no feriado é recusada');

-- A reunião também respeita a visita: a grade não oferece 15h20 (bate na de 15h00).
select pg_temp.entrar(pg_temp.p('gestor'), 'gestor');
insert into r94 values ('reuniao_em_cima_da_visita',
  public.reuniao_marcar_na_agenda(pg_temp.f('deal_c'), pg_temp.as('15:20'), 'online', null, null, pg_temp.p('sdr')));
select pg_temp.sair();
select is((select r ->> 'motivo' from r94 where chave='reuniao_em_cima_da_visita'), 'horario_indisponivel',
  'reunião em cima de visita é recusada pela grade');

-- ---------- 6. remarcar mantém a agenda ----------
select pg_temp.entrar(pg_temp.p('gestor'), 'gestor');
insert into r94 values ('remarcada',
  public.reuniao_remarcar((select (r ->> 'reuniao_id')::uuid from r94 where chave='gestor_para_si'),
                          pg_temp.as('16:10')));
select pg_temp.sair();
select is((select (r ->> 'ok')::boolean from r94 where chave='remarcada'), true, 'o gestor remarca a própria');
select is(
  (select dono_id from public.reunioes where id = (select (r ->> 'reuniao_id')::uuid from r94 where chave='remarcada')),
  pg_temp.p('gestor'),
  'e ela continua na agenda dele, não na do dono do negócio');

-- ---------- 7. o aviso é privado ----------
select pg_temp.entrar(pg_temp.p('sdr'), 'sdr');
select is((select count(*)::int from public.agenda_avisos), 3, 'a SDR lê os três avisos dela');
select is(public.agenda_avisos_vistos(), 3, 'e marca os três como vistos');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.p('sdr2'), 'sdr');
select is((select count(*)::int from public.agenda_avisos), 0, 'outra SDR não lê os avisos dela');
select is(public.agenda_avisos_vistos(), 0, 'nem os marca como vistos');
select throws_ok(
  $$insert into public.agenda_avisos (dono_id, marcado_por, tipo, task_id, titulo, quando)
    select (select id from equipe94 where papel='sdr2'), (select id from equipe94 where papel='gestor'),
           'visita', t.id, 'x', now() from public.tasks t limit 1$$,
  '42501', null, 'ninguém escreve aviso direto');
select pg_temp.sair();

select pg_temp.entrar(pg_temp.p('gestor'), 'gestor');
select is(
  (select count(*)::int from public.agenda_avisos where visto_em is not null),
  3, 'o gestor vê que a SDR já viu os avisos que ele mandou');
select pg_temp.sair();

-- ---------- 6b. remarcar a agenda de outra pessoa ----------
-- O gestor remarca a reunião que marcou para a SDR: continua dela, e ela ganha
-- aviso da hora nova (os três anteriores já foram vistos acima).
select pg_temp.entrar(pg_temp.p('gestor'), 'gestor');
insert into r94 values ('gestor_remarca_da_sdr',
  public.reuniao_remarcar((select (r ->> 'reuniao_id')::uuid from r94 where chave='gestor_para_sdr'),
                          pg_temp.as('12:00')));
select pg_temp.sair();
select is(
  (select dono_id from public.reunioes where id = (select (r ->> 'reuniao_id')::uuid from r94 where chave='gestor_remarca_da_sdr')),
  pg_temp.p('sdr'), 'remarcada pelo gestor, a reunião continua da SDR');
select is(
  (select quando from public.agenda_avisos where dono_id = pg_temp.p('sdr') and visto_em is null),
  pg_temp.as('12:00'), 'e a SDR ganha aviso da hora nova');

-- Quem saiu do time não recebe reunião nova: remarcar volta ao dono do negócio.
update public.profiles set is_active = false where id = pg_temp.p('gestor2');
select pg_temp.entrar(pg_temp.p('admin'), 'admin');
insert into r94 values ('remarca_de_quem_saiu',
  public.reuniao_remarcar((select (r ->> 'reuniao_id')::uuid from r94 where chave='admin_para_gestor'),
                          pg_temp.as('13:40')));
select pg_temp.sair();
select is(
  (select dono_id from public.reunioes where id = (select (r ->> 'reuniao_id')::uuid from r94 where chave='remarca_de_quem_saiu')),
  pg_temp.p('sdr'), 'dono inativo: a reunião remarcada volta ao dono do negócio');

-- ---------- 8. nada disso fala no WhatsApp ----------
select is((select count(*) from public.messages), (select msgs from zap94),
  'nenhuma mensagem nova em public.messages');
select is((select count(*) from pgmq.q_wa_outbound), (select fila from zap94),
  'nada na fila de saída do WhatsApp');

select * from finish();
rollback;

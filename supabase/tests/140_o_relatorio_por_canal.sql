-- =====================================================================
-- pgTAP — O relatório por canal de chegada (migração 20261109233000)
--
-- Prova: quem vê relatório vê este (admin, gestor, SDR), e só na Imova; as
-- chegadas do período contam por canal e subcanal, com quem decidiu, a
-- correção de gente, o atendimento e a foto da placa (decisão de 06/11/2026:
-- "deve ser registrado isso no relatório").
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(14);

insert into public.allowed_users (email, role, note) values
  ('h139.g@teste.local', 'gestor', 'pgTAP 139'),
  ('h139.s@teste.local', 'sdr', 'pgTAP 139'),
  ('h139.e@teste.local', 'embaixador', 'pgTAP 139');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000013901'::uuid, 'h139.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000013902'::uuid, 'h139.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000013903'::uuid, 'h139.e@teste.local', '{"full_name":"Eva Embaixadora"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999913200"')
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
create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

create temp table t139(chave text primary key, valor uuid);
grant select on t139 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t139 where chave = p_chave
$$;
grant execute on function pg_temp.id(text) to authenticated;
create function pg_temp.conversa(p_chave text, p_tel text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999913200', p_tel, 'Cliente ' || p_chave,
          'a0000000-0000-4000-8000-000000013901'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t139 values (p_chave, v);
  return v;
end $$;
create function pg_temp.dele(p_chave_msg text, p_conv uuid, p_em timestamptz, p_body text,
                             p_tipo text default 'text', p_conteudo jsonb default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               media_path, media_mime, conteudo, created_at)
  values (p_conv, 'in'::app.msg_direction, p_tipo::app.msg_type, 'received'::app.msg_status, p_body,
          'system', 'crm', case when p_tipo = 'image' then p_conv || '/foto.jpg' end,
          case when p_tipo = 'image' then 'image/jpeg' end, p_conteudo, p_em)
  returning id into v;
  if p_chave_msg is not null then insert into t139 values (p_chave_msg, v); end if;
  return v;
end $$;
create function pg_temp.nossa(p_conv uuid, p_em timestamptz) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'pgtap139 nossa', 'human', 'echo', 'a0000000-0000-4000-8000-000000013901'::uuid,
          'wamid.PGTAP139.' || gen_random_uuid(), p_em, p_em)
$$;
create function pg_temp.ultima(p_conv uuid) returns uuid language sql stable as $$
  select c.id from public.chegadas c where c.conversation_id = p_conv order by c.inicio_em desc limit 1
$$;
grant execute on function pg_temp.ultima(uuid) to authenticated;
create temp table t139_rel as select * from public.relatorio_por_canal(null, null) where false;
grant select, insert, delete on t139_rel to authenticated;
create function pg_temp.linha(p_canal text, p_sub text) returns t139_rel language sql stable as $$
  select * from t139_rel where canal = p_canal and subcanal = p_sub
$$;

-- O banco é da Imova durante o teste (no CI ele é da KOMUNE, gravada pelo seed).
select pg_temp.virar('imova');

insert into public.app_settings (key, value, description)
values ('canal_de_chegada',
        jsonb_build_object('ligada', true, 'ia', false,
                           'aplicar_desde', to_char((now() at time zone 'America/Fortaleza')::date - 120, 'YYYY-MM-DD')),
        'pgTAP 139')
on conflict (key) do update set value = excluded.value;

-- Três chegadas de ontem, fechadas: uma pelo anúncio da Meta e atendida; uma
-- pela foto da placa, lida pela IA; uma que a regra disse Instagram e gente
-- corrigiu para Outros (indicação).
select pg_temp.conversa('meta', '+5584999913201');
select pg_temp.dele(null, pg_temp.id('meta'), now() - interval '30 hours', 'Olá!',
                    'text', '{"anuncio": {"tipo": "ad", "titulo": "Apto"}}'::jsonb);
select pg_temp.nossa(pg_temp.id('meta'), now() - interval '29 hours');
select pg_temp.conversa('placa', '+5584999913202');
select pg_temp.dele('placa_foto', pg_temp.id('placa'), now() - interval '30 hours', null, 'image');
select pg_temp.conversa('insta', '+5584999913203');
select pg_temp.dele(null, pg_temp.id('insta'), now() - interval '30 hours', 'vi no insta');
select app.chegadas_rodar(1000);
select app.canal_gravar_da_ia(pg_temp.ultima(pg_temp.id('placa')),
  jsonb_build_object('canal', 'placa', 'subcanal', 'foto_da_placa', 'confianca', 0.9,
    'evidencias', jsonb_build_array(jsonb_build_object('message_id', pg_temp.id('placa_foto'), 'tipo', 'foto',
                                                       'trecho', 'Placa da Imova')),
    'foto', jsonb_build_object('message_id', pg_temp.id('placa_foto'), 'peca', 'placa', 'marca', 'imova',
                               'descricao', 'Placa de venda da Imova', 'codigo_do_imovel', null)),
  now());
select pg_temp.entrar('a0000000-0000-4000-8000-000000013901'::uuid, 'gestor');
select public.chegada_marcar(pg_temp.ultima(pg_temp.id('insta')), 'outros', 'indicacao');
select pg_temp.sair();

-- =====================================================================
-- Quem vê
-- =====================================================================
select throws_ok($$select * from public.relatorio_por_canal(null, null)$$, '42501', null,
  'sem login, nada');
select pg_temp.entrar('a0000000-0000-4000-8000-000000013903'::uuid, 'embaixador');
select throws_ok($$select * from public.relatorio_por_canal(null, null)$$, '42501', null,
  'embaixador não vê relatório');
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-000000013902'::uuid, 'sdr');
select lives_ok($$insert into t139_rel select * from public.relatorio_por_canal(null, null)$$, 'o SDR vê');
select pg_temp.sair();

-- =====================================================================
-- O que conta
-- =====================================================================
select is((pg_temp.linha('anuncios', 'meta_anuncio')).chegadas >= 1, true, 'Anúncios · anúncio da Meta conta');
select ok((pg_temp.linha('anuncios', 'meta_anuncio')).atendidos >= 1, 'e conta como atendido (o time respondeu)');
select ok((pg_temp.linha('anuncios', 'meta_anuncio')).por_regra >= 1, 'decidido pela regra');
select ok((pg_temp.linha('placa', 'foto_da_placa')).com_foto_da_placa >= 1,
  'a foto da placa da Imova fica registrada');
select ok((pg_temp.linha('placa', 'foto_da_placa')).por_ia >= 1, 'decidida pela IA');
select ok((pg_temp.linha('outros', 'indicacao')).por_gente >= 1, 'a correção conta como de gente');
select ok((pg_temp.linha('outros', 'indicacao')).corrigidos >= 1, 'e como corrigida (a regra dizia outra coisa)');
select ok((pg_temp.linha('placa', 'foto_da_placa')).sem_ficha >= 1, 'quem ainda não tem ficha também conta');
select is((select count(*)::int from t139_rel where canal not in ('placa', 'anuncios', 'redes_sociais',
                                                                   'outros', 'nao_identificado')), 0,
  'nenhum canal fora dos cinco (Indicação virou detalhe de Outros)');

-- =====================================================================
-- Só na Imova
-- =====================================================================
select pg_temp.virar('komune');
select pg_temp.entrar('a0000000-0000-4000-8000-000000013901'::uuid, 'gestor');
select is((select count(*)::int from public.relatorio_por_canal(null, null)), 0,
  'no banco da KOMUNE o relatório volta vazio');
select pg_temp.sair();
select pg_temp.virar('imova');
select is(public.empresa_do_banco(), 'imova', 'e a identidade volta');

select * from finish();
rollback;

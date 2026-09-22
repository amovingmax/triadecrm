-- =====================================================================
-- pgTAP — Fora da janela de 24 h, só o cumprimento (migração 20260922160000)
--
--   1. O CATÁLOGO: entre os modelos da Meta, só ficam em uso os três
--      cumprimentos e os quatro de depois da ligação; os outros saem de uso,
--      sem ser apagados.
--   2. O RELÓGIO: `app.modelo_da_hora` troca um cumprimento pelo do período,
--      no fuso de Natal, e não mexe em modelo nenhum além deles.
--   3. A CAMPANHA: o corpo e o envio usam o cumprimento da hora em que o item
--      sai, não o escolhido na montagem.
-- =====================================================================
begin;
select plan(9);

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
create function pg_temp.modelo(p_codigo text) returns int language sql as $$
  select id from public.message_templates where template_code = p_codigo
$$;
create function pg_temp.gestor() returns uuid language sql as $$
  select 'a0000000-0000-4000-8000-000000006501'::uuid
$$;
create function pg_temp.org() returns uuid language sql as $$
  select 'c0000000-0000-4000-8000-000000006501'::uuid
$$;
-- Um cumprimento que NÃO é o de agora: é ele que a campanha escolhe na montagem.
create function pg_temp.outro_cumprimento() returns int language sql as $$
  select pg_temp.modelo(case when app.saudacao_do_momento() = 'Bom dia'
                             then 'GEN-ABR-OLA-NOITE' else 'GEN-ABR-OLA-MANHA' end)
$$;
create table pg_temp.r (chave text primary key, valor jsonb);
grant select, insert on pg_temp.r to authenticated;
create function pg_temp.v(p_chave text) returns jsonb language sql as $$
  select valor from pg_temp.r where chave = p_chave
$$;
create function pg_temp.item(p_org uuid) returns public.envios_em_massa_itens
language sql security definer set search_path = '' as $$
  select x.* from public.envios_em_massa_itens x
   where x.organization_id = p_org order by x.processado_em desc nulls last limit 1
$$;

-- =====================================================================
-- 1. O catálogo
-- =====================================================================
select is(
  array(select template_code::text from public.message_templates
         where channel = 'whatsapp'::app.channel and category in ('marketing', 'utility')
           and template_code not like 'GEN-SYS-%' and is_active
         order by template_code collate "C"),
  array['GEN-ABR-OLA-MANHA', 'GEN-ABR-OLA-NOITE', 'GEN-ABR-OLA-TARDE', 'GEN-FUP-LIG-V1',
        'GEN-LIG-CONFIRMA', 'GEN-LIG-RESUMO-FOR', 'GEN-LIG-RESUMO-PRO'],
  'fora da janela, só o cumprimento e os quatro de depois da ligação ficam em uso');
select is((select count(*)::int from public.message_templates
            where template_code in ('AEB-ABR-A', 'GEN-FUP-D3-V1', 'ENV-CONVITE-FUNDADOR')
              and not is_active), 3,
  'os que saíram continuam no banco, fora de uso: nada foi apagado');
select ok(exists (select 1 from public.message_templates where kind = 'objecao')
          and not exists (select 1 from public.message_templates where kind = 'objecao' and not is_active),
  'os textos de dentro da janela (objeções) não foram tocados');

-- =====================================================================
-- 2. O relógio de Natal (UTC-3)
-- =====================================================================
select is(app.modelo_da_hora(pg_temp.modelo('GEN-ABR-OLA-TARDE'), '2026-09-22 12:00+00'),
  pg_temp.modelo('GEN-ABR-OLA-MANHA'), '9h em Natal: bom dia');
select is(app.modelo_da_hora(pg_temp.modelo('GEN-ABR-OLA-MANHA'), '2026-09-22 18:00+00'),
  pg_temp.modelo('GEN-ABR-OLA-TARDE'), '15h: boa tarde');
select is(app.modelo_da_hora(pg_temp.modelo('GEN-ABR-OLA-MANHA'), '2026-09-22 23:00+00'),
  pg_temp.modelo('GEN-ABR-OLA-NOITE'), '20h: boa noite');
select is(app.modelo_da_hora(pg_temp.modelo('GEN-LIG-CONFIRMA'), '2026-09-22 12:00+00'),
  pg_temp.modelo('GEN-LIG-CONFIRMA'), 'modelo que não é cumprimento não muda');

-- =====================================================================
-- 3. A campanha
-- =====================================================================
create or replace function app.janela_do_canal(p_channel app.channel,
                                               p_at timestamptz default now(),
                                               p_respondeu boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('aberta', true, 'motivo', null, 'abre_em', null,
                            'fecha_em', now() + interval '4 hours')
$$;

insert into public.allowed_users (email, role, note) values ('h65.g@teste.local', 'gestor', 'pgTAP cumprimento');
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.gestor(), 'h65.g@teste.local', '{"full_name":"Gil Gestor"}');
update public.app_settings
   set value = jsonb_set(value, '{numero_padrao}', '"+5584999996500"') where key = 'whatsapp.envio';
update public.app_settings
   set value = jsonb_set(jsonb_set(value, '{inicio}', '"2026-01-01"'), '{whatsapp,depois}', '100')
 where key = 'cadencia.tetos';
update public.app_settings
   set value = value || '{"lead_automatico": false, "distribuicao_automatica": false, "ausencia_ativa": false}'::jsonb
 where key = 'atendimento';
update public.message_templates set meta_status = 'approved' where template_code like 'GEN-ABR-OLA-%';
insert into public.organizations (id, name, phone_e164, source_id)
values (pg_temp.org(), 'H65 Buffet', '+5584999996501', (select id from public.sources where slug = 'planilha'));

select is(app.envio_montar('modelo', pg_temp.outro_cumprimento(), null, '{}'::jsonb,
                           pg_temp.org(), pg_temp.gestor()) ->> 'corpo',
  app.saudacao_do_momento() || '!', 'a prévia mostra o cumprimento da hora, não o da montagem');

-- Calculado antes de entrar como gestor: o relógio (`app.*`) não é do papel dele.
insert into pg_temp.r values ('outro', to_jsonb(pg_temp.outro_cumprimento()));
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
insert into pg_temp.r values ('envio', public.envio_em_massa_criar(jsonb_build_object(
  'nome', 'Cumprimento', 'tipo', 'modelo', 'modelo_id', (pg_temp.v('outro'))::int,
  'assinatura', 'marca', 'por_hora', 60, 'organizacoes', jsonb_build_array(pg_temp.org()))));
select pg_temp.sair();

do $$ begin
  perform app.envios_em_massa_rodar();
  update public.envios_em_massa set proximo_em = now() where id = (pg_temp.v('envio') ->> 'id')::uuid;
  perform app.envios_em_massa_rodar();
end $$;
select ok(exists (select 1 from public.messages m
                   where m.id = (pg_temp.item(pg_temp.org())).message_id
                     and m.template_id = app.modelo_da_hora(pg_temp.outro_cumprimento())
                     and m.body = app.saudacao_do_momento() || '!'),
  'a campanha manda o cumprimento da hora em que o item sai');

select * from finish();
rollback;

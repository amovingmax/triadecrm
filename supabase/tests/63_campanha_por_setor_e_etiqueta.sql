-- =====================================================================
-- pgTAP — Fase 5: o público da campanha por setor e por etiqueta
-- (migração 20260922140000)
-- =====================================================================
begin;
select plan(4);

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
create function pg_temp.nomes(p_filtro jsonb) returns text[] language sql as $$
  select coalesce(array_agg(p ->> 'nome' order by p ->> 'nome'), '{}')
    from public.envio_em_massa_publico(p_filtro) p
$$;

insert into public.allowed_users (email, role, note) values ('j63.g@teste.local', 'gestor', 'pgTAP fase 5');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000006301', 'j63.g@teste.local', '{"full_name":"Gil"}');
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999996300"') where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"lead_automatico": false, "distribuicao_automatica": false, "ausencia_ativa": false}'::jsonb
 where key = 'atendimento';

insert into public.organizations (id, name, phone_e164, source_id)
select x.id, x.nome, x.tel, (select id from public.sources where slug = 'planilha')
  from (values
    ('c0000000-0000-4000-8000-000000006301'::uuid, 'J63 Comercial', '+5584999996301'),
    ('c0000000-0000-4000-8000-000000006302'::uuid, 'J63 Financeiro', '+5584999996302'),
    ('c0000000-0000-4000-8000-000000006303'::uuid, 'J63 Sem Conversa', '+5584999996303')) x(id, nome, tel);
insert into public.conversations (channel, business_number, peer_phone_e164, organization_id, assignee_id, status, setor_id)
values ('whatsapp', '+5584999996300', '+5584999996301', 'c0000000-0000-4000-8000-000000006301',
        'a0000000-0000-4000-8000-000000006301', 'aguardando_nos', (select id from public.setores where slug = 'comercial')),
       ('whatsapp', '+5584999996300', '+5584999996302', 'c0000000-0000-4000-8000-000000006302',
        'a0000000-0000-4000-8000-000000006301', 'aguardando_nos', (select id from public.setores where slug = 'financeiro'));
insert into public.organization_tags (organization_id, tag_id)
select 'c0000000-0000-4000-8000-000000006303', id from public.tags order by id limit 1;

select pg_temp.entrar('a0000000-0000-4000-8000-000000006301', 'gestor');
select is(pg_temp.nomes('{"busca":"J63"}'),
  array['J63 Comercial', 'J63 Financeiro', 'J63 Sem Conversa'], 'sem filtro, todo mundo');
select is(pg_temp.nomes(jsonb_build_object('busca', 'J63', 'setores',
            jsonb_build_array((select id from public.setores where slug = 'financeiro')))),
  array['J63 Financeiro'], 'por setor: só quem conversa com o Financeiro');
select is(pg_temp.nomes(jsonb_build_object('busca', 'J63', 'setores',
            jsonb_build_array((select id from public.setores where slug = 'suporte')))),
  '{}'::text[], 'setor sem ninguém: ninguém');
select is(pg_temp.nomes(jsonb_build_object('busca', 'J63', 'tags',
            jsonb_build_array((select id from public.tags order by id limit 1)))),
  array['J63 Sem Conversa'], 'por etiqueta: só quem tem a etiqueta');
select pg_temp.sair();

select * from finish();
rollback;

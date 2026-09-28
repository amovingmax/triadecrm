-- =====================================================================
-- pgTAP — O canal do último toque, no negócio (migrações 20261002110000 e ...120000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. A LIGAÇÃO NÃO CRIA UM SEGUNDO LEAD. Rafael pediu, em 28/09/2026, um
--      recorte por canal no funil; o R13 §3.1 já tinha decidido que o canal é
--      atributo do TOQUE, e não funil próprio. O mesmo fornecedor que ignorou o
--      WhatsApp e atendeu o telefone é UM negócio, com o canal trocado — e não
--      dois cartões com duas etapas que discordam.
--   2. O CANAL NÃO É PARÂMETRO de `public.registrar_contato`: ele é DERIVADO do
--      desfecho, por `interaction_outcomes.surfaces` (whatsapp→whatsapp,
--      ligacao→phone). Por isso o teste escolhe o DESFECHO, que é o que a tela
--      escolhe, e é essa derivação que a asserção da ligação prova ponta a ponta.
--   3. TOQUE SEM CANAL não apaga o canal do toque anterior (nota, mudança de
--      etapa), e TOQUE RETROATIVO não rouba o carimbo de quem é mais recente —
--      o SET do gatilho lê a linha ANTIGA e compara as datas.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(7);

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
create function pg_temp.funil(p_slug text) returns int language sql stable as $$
  select id from public.pipelines where slug = p_slug
$$;
create function pg_temp.etapa(p_funil text, p_slug text) returns int language sql stable as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
   where p.slug = p_funil and s.slug = p_slug
$$;
create function pg_temp.desfecho(p_slug text) returns int language sql stable as $$
  select id from public.interaction_outcomes where slug = p_slug and is_active
$$;
create function pg_temp.org85() returns uuid language sql stable as $$
  select 'c0000000-0000-4000-8000-000000008501'::uuid
$$;
create function pg_temp.deal85() returns uuid language sql stable as $$
  select 'e0000000-0000-4000-8000-000000008501'::uuid
$$;
create function pg_temp.canal85() returns text language sql stable as $$
  select last_channel::text from public.deals where id = pg_temp.deal85()
$$;

insert into public.allowed_users (email, role, note)
values ('h85.sdr@teste.local', 'sdr', 'pgTAP canal no funil');
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000008501'::uuid, 'h85.sdr@teste.local', '{"full_name":"Sara SDR"}');

insert into public.organizations (id, name, phone_e164, source_id, owner_id)
values (pg_temp.org85(), 'Som Delta do pgTAP 85', '+5584999998501',
        (select id from public.sources where slug = 'captura_campo'),
        'a0000000-0000-4000-8000-000000008501'::uuid);
insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id)
values (pg_temp.deal85(), pg_temp.org85(), pg_temp.funil('fornecedor'),
        pg_temp.etapa('fornecedor', 'contatado'), 'a0000000-0000-4000-8000-000000008501'::uuid);

-- =====================================================================
-- 1. O negócio nasce sem canal
-- =====================================================================
select is(pg_temp.canal85(), null,
  'negócio novo nasce sem canal: ninguém tocou nele ainda');

-- =====================================================================
-- 2. O WhatsApp carimba, e a LIGAÇÃO troca o canal do MESMO negócio
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000008501'::uuid, 'sdr');
select ok((public.registrar_contato(gen_random_uuid(), pg_temp.org85(),
                                    pg_temp.desfecho('wa_respondeu'),
                                    'decisor', pg_temp.deal85()) ->> 'registrado')::boolean,
  'o toque de WhatsApp é registrado');
select pg_temp.sair();

select is(pg_temp.canal85(), 'whatsapp', 'e carimba o canal no negócio');

select pg_temp.entrar('a0000000-0000-4000-8000-000000008501'::uuid, 'sdr');
select ok((public.registrar_contato(gen_random_uuid(), pg_temp.org85(),
                                    pg_temp.desfecho('lig_interessado'),
                                    'decisor', pg_temp.deal85()) ->> 'registrado')::boolean,
  'a ligação é registrada no MESMO negócio');
select pg_temp.sair();

select is(pg_temp.canal85(), 'phone',
  'A LIGAÇÃO NÃO CRIA UM SEGUNDO LEAD: ela troca o canal do MESMO negócio (R13 §3.1)');

select is((select count(*)::int from public.deals d
            where d.organization_id = pg_temp.org85()
              and d.pipeline_id = pg_temp.funil('fornecedor')), 1,
  'um fornecedor tocado por dois canais continua sendo UM negócio no funil');

-- =====================================================================
-- 3. Nota sem canal e toque retroativo não roubam o carimbo
-- =====================================================================
insert into public.activities (type, deal_id, organization_id, occurred_at, body)
values ('note'::app.activity_type, pg_temp.deal85(), pg_temp.org85(), now(), 'nota sem canal');
insert into public.activities (type, channel, deal_id, organization_id, occurred_at, body)
values ('message'::app.activity_type, 'instagram'::app.channel, pg_temp.deal85(),
        pg_temp.org85(), now() - interval '10 days', 'DM antiga importada');

select is(pg_temp.canal85(), 'phone',
  'toque sem canal e atividade retroativa não viram "último toque": coalesce guarda o que houve e o SET lê a linha antiga');

select * from finish();
rollback;

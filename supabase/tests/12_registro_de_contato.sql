-- =====================================================================
-- pgTAP — Registro de contato nos DOIS funis e guardrail de supressão
-- (migração 001200, sobre a 001100):
--   public.registrar_contato · app.stage_for · app.is_suppressed_target
--   · app.deal_set_intent · app.consent_apply
--
-- Cobre os dois achados da conferência adversarial da tela /registrar:
--   1) os 8 desfechos que levam a Quente apontavam para etapas que só existem no
--      funil fornecedor, e por isso metade da base (produtor e cerimonialista)
--      nunca esquentava. Aqui os 8 são registrados num negócio do funil PRODUTOR
--      e a temperatura tem de sair de frio.
--   2) a tela agendava toque em contato suprimido. Aqui, com do_not_contact e com
--      suppression_list, nos DOIS funis: o registro continua sendo gravado, mas
--      sem tarefa, sem etapa de trabalho, sem intenção que esquente e sem claim.
--
-- Roda em transação e desfaz tudo. Nada depende de contagem absoluta da seed.
-- =====================================================================
begin;
select plan(50);

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
create function pg_temp.etapa_de(p_deal uuid) returns text language sql as $$
  select s.slug from public.deals d join public.stages s on s.id = d.stage_id where d.id = p_deal
$$;
create function pg_temp.temp_de(p_deal uuid) returns text language sql as $$
  select temperature::text from public.deals where id = p_deal
$$;
create function pg_temp.abertas(p_deal uuid) returns int language sql as $$
  select count(*)::int from public.tasks
   where deal_id = p_deal and status in ('todo'::app.task_status, 'doing'::app.task_status)
$$;

-- ---------- pessoa ----------
insert into public.allowed_users (email, role, note) values
  ('rc.sdr@teste.local', 'sdr', 'pgTAP registro de contato');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000a01', 'rc.sdr@teste.local', '{"full_name":"SDR Registro"}');

-- ---------- parceiros ----------
-- Oito organizações do funil PRODUTOR (uma por desfecho), todas sem dono e em
-- "Identificado" — o pior caso, que é exatamente o da base real.
insert into public.organizations (id, name, phone_e164, neighborhood, source_id)
select ('c0000000-0000-4000-8000-00000000090' || i)::uuid,
       'RC Produtora ' || i,
       '+55849999908' || lpad(i::text, 2, '0'),
       'Tirol',
       (select id from public.sources where slug = 'captura_campo')
  from generate_series(1, 8) i;
insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id)
select ('e0000000-0000-4000-8000-00000000090' || i)::uuid,
       ('c0000000-0000-4000-8000-00000000090' || i)::uuid,
       pg_temp.funil('produtor'), pg_temp.etapa('produtor', 'identificado'), null
  from generate_series(1, 8) i;

-- Dois negócios do funil FORNECEDOR, para provar que nada regrediu lá.
insert into public.organizations (id, name, phone_e164, neighborhood, source_id) values
  ('c0000000-0000-4000-8000-000000000911', 'RC Buffet Norte',  '+5584999990911', 'Tirol',
     (select id from public.sources where slug = 'captura_campo')),
  ('c0000000-0000-4000-8000-000000000912', 'RC Som Leste',     '+5584999990912', 'Tirol',
     (select id from public.sources where slug = 'captura_campo'));
insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id) values
  ('e0000000-0000-4000-8000-000000000911', 'c0000000-0000-4000-8000-000000000911',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'), null),
  ('e0000000-0000-4000-8000-000000000912', 'c0000000-0000-4000-8000-000000000912',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'), null);

-- Três organizações para o guardrail: uma fornecedor e uma produtor com opt-out
-- registrado (do_not_contact), e uma só com o telefone na suppression_list.
insert into public.organizations (id, name, phone_e164, neighborhood, source_id) values
  ('c0000000-0000-4000-8000-000000000921', 'RC Optout Fornecedor', '+5584999990921', 'Tirol',
     (select id from public.sources where slug = 'captura_campo')),
  ('c0000000-0000-4000-8000-000000000922', 'RC Optout Produtora',  '+5584999990922', 'Tirol',
     (select id from public.sources where slug = 'captura_campo')),
  ('c0000000-0000-4000-8000-000000000923', 'RC Só Supressão',      '+5584999990923', 'Tirol',
     (select id from public.sources where slug = 'captura_campo'));
insert into public.deals (id, organization_id, pipeline_id, stage_id, owner_id) values
  ('e0000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000921',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'contatado'), null),
  ('e0000000-0000-4000-8000-000000000922', 'c0000000-0000-4000-8000-000000000922',
     pg_temp.funil('produtor'), pg_temp.etapa('produtor', 'identificado'), null),
  ('e0000000-0000-4000-8000-000000000923', 'c0000000-0000-4000-8000-000000000923',
     pg_temp.funil('fornecedor'), pg_temp.etapa('fornecedor', 'prospectado'), null);

-- =====================================================================
-- 1. Superfície nova
-- =====================================================================
select has_table('public', 'stage_equivalences', 'stage_equivalences existe');
select has_function('app', 'stage_for', array['integer','text'], 'app.stage_for existe');
select has_function('app', 'is_suppressed_target', array['uuid','uuid'],
  'app.is_suppressed_target existe');
select has_function('app', 'deal_set_intent', array['uuid','text','timestamp with time zone','boolean'],
  'app.deal_set_intent existe');

-- =====================================================================
-- 2. Resolução do destino por funil (app.stage_for)
-- =====================================================================
select is((select slug from app.stage_for(pg_temp.funil('fornecedor'), 'reuniao_marcada')),
  'reuniao_marcada', 'stage_for: no funil fornecedor o slug literal resolve nele mesmo');
select is((select slug from app.stage_for(pg_temp.funil('produtor'), 'reuniao_marcada')),
  'demonstracao_marcada', 'stage_for: no funil produtor "reuniao_marcada" vira "Demonstração marcada"');
select is((select slug from app.stage_for(pg_temp.funil('produtor'), 'respondeu')),
  'respondeu', 'stage_for: o slug literal tem precedência sobre a equivalência');
select is((select count(*)::int from app.stage_for(pg_temp.funil('produtor'), 'em_conversa')),
  0, 'stage_for: "Em conversa" não tem equivalente no funil produtor (PRD §5.5) e a resolução é vazia');

-- =====================================================================
-- 3. ACHADO 1 — os 8 desfechos que levam a Quente, no funil PRODUTOR
-- =====================================================================
create table pg_temp.res(
  ord int, slug text primary key, deal uuid, temp_antes text, temp text,
  etapa text, recusa text, task uuid);

do $$
declare
  alvos text[] := array['lig_interessado','lig_reuniao_marcada','vis_decisor_interessado',
                        'vis_cadastro_iniciado','reu_interessado','reu_autorizou',
                        'reu_objecao','reu_reagendada'];
  v_slug text; i int := 0; v_deal uuid; v_org uuid; res jsonb; v_antes text;
begin
  foreach v_slug in array alvos loop
    i := i + 1;
    v_org  := ('c0000000-0000-4000-8000-00000000090' || i)::uuid;
    v_deal := ('e0000000-0000-4000-8000-00000000090' || i)::uuid;
    select d.temperature::text into v_antes from public.deals d where d.id = v_deal;

    perform pg_temp.entrar('a0000000-0000-4000-8000-000000000a01', 'sdr');
    res := public.registrar_contato(
      gen_random_uuid(), v_org,
      (select id from public.interaction_outcomes o where o.slug = v_slug),
      'decisor', v_deal, null, now(), 'pgTAP ' || v_slug, null,
      null,
      case when v_slug in ('lig_reuniao_marcada','reu_reagendada')
           then now() + interval '3 days' end,
      case when v_slug in ('lig_reuniao_marcada','reu_reagendada') then 'meet_manha' end,
      case when v_slug = 'reu_autorizou' then 'Autorizo o pré-cadastro (áudio pgTAP)' end);
    execute 'reset role';

    insert into pg_temp.res(ord, slug, deal, temp_antes, temp, etapa, recusa, task)
    select i, v_slug, v_deal, v_antes, d.temperature::text, s.slug,
           res ->> 'etapa_recusa', nullif(res ->> 'task_id', '')::uuid
      from public.deals d join public.stages s on s.id = d.stage_id
     where d.id = v_deal;
  end loop;
end $$;
select pg_temp.sair();

-- Antes do conserto os oito ficavam em frio. Nenhum pode continuar frio.
select is((select count(*)::int from pg_temp.res where temp_antes = 'frio'), 8,
  'achado 1: os oito negócios do funil produtor começaram frios');
select is((select count(*)::int from pg_temp.res where temp = 'quente'), 8,
  'achado 1: os oito desfechos deixam o negócio do funil PRODUTOR quente');

-- Etapa: seis têm equivalente no funil produtor; dois não têm, e dizem isso.
select is((select etapa from pg_temp.res where slug = 'lig_reuniao_marcada'),
  'demonstracao_marcada', 'produtor: "Reunião marcada" vira "Demonstração marcada"');
select is((select etapa from pg_temp.res where slug = 'reu_reagendada'),
  'demonstracao_marcada', 'produtor: "Reagendada" vira "Demonstração marcada"');
select is((select etapa from pg_temp.res where slug = 'reu_interessado'),
  'demonstracao_realizada', 'produtor: "Realizada, interessado" vira "Demonstração realizada"');
select is((select etapa from pg_temp.res where slug = 'reu_objecao'),
  'demonstracao_realizada', 'produtor: "Realizada, com objeção" vira "Demonstração realizada"');
select is((select etapa from pg_temp.res where slug = 'reu_autorizou'),
  'parceria_aceita', 'produtor: "Realizada, autorizou" vira "Parceria aceita"');
select is((select etapa from pg_temp.res where slug = 'vis_cadastro_iniciado'),
  'parceria_aceita', 'produtor: "Cadastro iniciado na hora" vira "Parceria aceita"');
select is((select etapa from pg_temp.res where slug = 'lig_interessado'),
  'identificado', 'produtor: "Interessado" não move etapa (não há "Em conversa" no funil)');
select is((select recusa from pg_temp.res where slug = 'lig_interessado'),
  'etapa_fora_do_funil', 'produtor: e a recusa da etapa é dita, não escondida');
select is((select etapa from pg_temp.res where slug = 'vis_decisor_interessado'),
  'identificado', 'produtor: "Decisor interessado" também não move etapa');
select is((select recusa from pg_temp.res where slug = 'vis_decisor_interessado'),
  'etapa_fora_do_funil', 'produtor: recusa dita para "Decisor interessado"');
-- Sem etapa, o quente vem da INTENÇÃO declarada pelo desfecho (PRD §5.6).
select is((select d.last_intent from public.deals d
            join pg_temp.res r on r.deal = d.id where r.slug = 'lig_interessado'),
  'interessado', 'achado 1: sem etapa equivalente, quem esquenta é a intenção declarada');
select isnt((select task from pg_temp.res where slug = 'lig_interessado'), null,
  'achado 1: e a próxima ação continua virando tarefa (RF-FUN-03)');
select is((select count(*)::int from public.deals d
            join pg_temp.res r on r.deal = d.id where d.owner_id is null), 0,
  'achado 1: registrar assume o negócio sem dono (mesmo sem mover etapa)');

-- =====================================================================
-- 4. Nada regrediu no funil FORNECEDOR
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000000a01', 'sdr');
select lives_ok($$
  select public.registrar_contato(gen_random_uuid(), 'c0000000-0000-4000-8000-000000000911',
    (select id from public.interaction_outcomes where slug = 'lig_interessado'),
    'decisor', 'e0000000-0000-4000-8000-000000000911')
$$, 'fornecedor: "Interessado" registra sem erro');
-- lig_atendeu_retorna não tem etapa de destino e declara morno: antes do conserto,
-- em negócio SEM DONO o update da intenção não achava linha e ele ficava frio.
select lives_ok($$
  select public.registrar_contato(gen_random_uuid(), 'c0000000-0000-4000-8000-000000000912',
    (select id from public.interaction_outcomes where slug = 'lig_atendeu_retorna'),
    'decisor', 'e0000000-0000-4000-8000-000000000912')
$$, 'fornecedor: "Atendeu, retorna depois" registra sem erro');
select pg_temp.sair();

select is(pg_temp.etapa_de('e0000000-0000-4000-8000-000000000911'), 'em_conversa',
  'fornecedor: "Interessado" continua indo para "Em conversa"');
select is(pg_temp.temp_de('e0000000-0000-4000-8000-000000000911'), 'quente',
  'fornecedor: e continua deixando o negócio quente');
select is(pg_temp.temp_de('e0000000-0000-4000-8000-000000000912'), 'morno',
  'fornecedor: desfecho sem etapa de destino esquenta pela intenção em negócio sem dono');

-- =====================================================================
-- 5. ACHADO 2 — contato suprimido: registra, mas não devolve ninguém à fila
-- =====================================================================
-- Uma tarefa aberta ANTES do opt-out, para provar que o consentimento a cancela.
insert into public.tasks (id, title, kind, due_at, assignee_id, organization_id, deal_id,
                          created_by, origin)
values ('f0000000-0000-4000-8000-000000000921', 'Follow-up D+3', 'follow_up',
        now() + interval '3 days', 'a0000000-0000-4000-8000-000000000a01',
        'c0000000-0000-4000-8000-000000000921', 'e0000000-0000-4000-8000-000000000921',
        'a0000000-0000-4000-8000-000000000a01', 'system');

insert into public.consent_events (kind, organization_id, evidence_text) values
  ('contact_optout', 'c0000000-0000-4000-8000-000000000921', 'pgTAP: pediu para parar'),
  ('contact_optout', 'c0000000-0000-4000-8000-000000000922', 'pgTAP: pediu para parar');
-- A terceira fica de fora do consentimento: só o hash do telefone na lista.
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex(app.normalize_phone_br('+5584999990923')), 'phone', 'pgTAP');

select is((select status::text from public.tasks where id = 'f0000000-0000-4000-8000-000000000921'),
  'cancelled', 'RF-CON-18: o opt-out cancela a tarefa que já estava na fila de alguém');
select is(app.is_suppressed_target('c0000000-0000-4000-8000-000000000923', null), true,
  'guardrail: a suppression_list sozinha já marca o alvo como suprimido');

-- ----- funil FORNECEDOR suprimido -----
create table pg_temp.sup(ord int primary key, res jsonb);
do $$
declare r jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-000000000a01', 'sdr');
  -- 1: desfecho de envio (o caso do relatório: "Enviado, sem resposta")
  r := public.registrar_contato(gen_random_uuid(), 'c0000000-0000-4000-8000-000000000921',
        (select id from public.interaction_outcomes where slug = 'wa_sem_resposta'),
        'nao_informado', 'e0000000-0000-4000-8000-000000000921');
  execute 'reset role'; insert into pg_temp.sup values (1, r);
  -- 2: desfecho que empurraria para NUTRIÇÃO (etapa de re-contato)
  perform pg_temp.entrar('a0000000-0000-4000-8000-000000000a01', 'sdr');
  r := public.registrar_contato(gen_random_uuid(), 'c0000000-0000-4000-8000-000000000921',
        (select id from public.interaction_outcomes where slug = 'lig_agora_nao'),
        'decisor', 'e0000000-0000-4000-8000-000000000921');
  execute 'reset role'; insert into pg_temp.sup values (2, r);
  -- 3: funil PRODUTOR suprimido, com o desfecho que mais esquenta
  perform pg_temp.entrar('a0000000-0000-4000-8000-000000000a01', 'sdr');
  r := public.registrar_contato(gen_random_uuid(), 'c0000000-0000-4000-8000-000000000922',
        (select id from public.interaction_outcomes where slug = 'lig_interessado'),
        'decisor', 'e0000000-0000-4000-8000-000000000922');
  execute 'reset role'; insert into pg_temp.sup values (3, r);
  -- 4: suprimido só pela suppression_list, desfecho de envio
  perform pg_temp.entrar('a0000000-0000-4000-8000-000000000a01', 'sdr');
  r := public.registrar_contato(gen_random_uuid(), 'c0000000-0000-4000-8000-000000000923',
        (select id from public.interaction_outcomes where slug = 'wa_sem_resposta'),
        'nao_informado', 'e0000000-0000-4000-8000-000000000923');
  execute 'reset role'; insert into pg_temp.sup values (4, r);
  -- 5: FECHAR continua permitido (etapa de perda), mesmo suprimido
  perform pg_temp.entrar('a0000000-0000-4000-8000-000000000a01', 'sdr');
  r := public.registrar_contato(gen_random_uuid(), 'c0000000-0000-4000-8000-000000000923',
        (select id from public.interaction_outcomes where slug = 'lig_sem_interesse'),
        'decisor', 'e0000000-0000-4000-8000-000000000923', null, now(), null, null,
        (select id from public.lost_reasons where is_active order by id limit 1));
  execute 'reset role'; insert into pg_temp.sup values (5, r);
end $$;
select pg_temp.sair();

-- O registro NUNCA é recusado: a Heloísa precisa poder anotar o que aconteceu.
select is((select count(*)::int from pg_temp.sup where (res ->> 'registrado')::boolean), 5,
  'achado 2: em contato suprimido o registro continua sendo aceito (RF-MET-01)');
select is((select count(*)::int from pg_temp.sup where (res ->> 'contato_suprimido')::boolean), 5,
  'achado 2: e o retorno diz que o contato está suprimido, para a tela avisar');
select is((select count(*)::int from pg_temp.sup where res ->> 'task_id' is not null), 0,
  'achado 2: nenhuma das cinco chamadas criou tarefa de próxima ação');
select is((select count(*)::int from public.activities
            where organization_id in ('c0000000-0000-4000-8000-000000000921',
                                      'c0000000-0000-4000-8000-000000000922',
                                      'c0000000-0000-4000-8000-000000000923')
              and metadata ? 'outcome_slug'), 5,
  'achado 2: as cinco atividades estão gravadas (o registro é o dado que a LGPD precisa ver)');

-- Fornecedor suprimido: nenhuma tarefa, nenhuma etapa de trabalho.
select is(pg_temp.abertas('e0000000-0000-4000-8000-000000000921'), 0,
  'achado 2 (fornecedor): o negócio suprimido não tem nenhuma tarefa aberta');
select is((select res ->> 'etapa_recusa' from pg_temp.sup where ord = 2), 'contato_suprimido',
  'achado 2 (fornecedor): "Agora não" não empurra para Nutrição, que é etapa de re-contato');
select is(pg_temp.etapa_de('e0000000-0000-4000-8000-000000000921'), 'optout',
  'achado 2 (fornecedor): o cartão continua em Opt-out, onde o consentimento o pôs');

-- Produtor suprimido: nem tarefa, nem etapa, nem intenção que esquente, nem claim.
select is(pg_temp.abertas('e0000000-0000-4000-8000-000000000922'), 0,
  'achado 2 (produtor): o negócio suprimido não tem nenhuma tarefa aberta');
select is(pg_temp.temp_de('e0000000-0000-4000-8000-000000000922'), 'frio',
  'achado 2 (produtor): "Interessado" NÃO esquenta quem pediu para parar');
select is((select last_intent from public.deals where id = 'e0000000-0000-4000-8000-000000000922'),
  null, 'achado 2 (produtor): a intenção que esquenta não é gravada');
select is((select owner_id from public.deals where id = 'e0000000-0000-4000-8000-000000000922'),
  null, 'achado 2 (produtor): não se atribui carteira sobre quem não se pode contatar');

-- Suprimido só pela lista: mesmo tratamento, e fechar continua valendo.
select is(pg_temp.abertas('e0000000-0000-4000-8000-000000000923'), 0,
  'achado 2 (suppression_list): nenhuma tarefa aberta');
select is((select (res ->> 'etapa_aplicada')::boolean from pg_temp.sup where ord = 5), true,
  'achado 2: etapa de PERDA continua sendo aplicada em contato suprimido (fechar não é trabalhar)');
select is(pg_temp.etapa_de('e0000000-0000-4000-8000-000000000923'), 'perdido',
  'achado 2: e o cartão foi mesmo para Perdido');

-- =====================================================================
-- 6. O catálogo de equivalências não pode apontar para etapa inexistente
-- =====================================================================
select throws_ok($$
  insert into public.stage_equivalences (pipeline_id, canonical_slug, stage_slug)
  select id, 'em_conversa', 'etapa_que_nao_existe' from public.pipelines where slug = 'produtor'
$$, '23503', null, 'stage_equivalences: a etapa de destino tem de existir naquele funil');
select is((select count(*)::int from public.stage_equivalences e
            join public.pipelines p on p.id = e.pipeline_id where p.slug = 'produtor'), 4,
  'seed: as quatro equivalências do funil produtor estão cadastradas');
select is((select count(*)::int from public.stage_equivalences e
            join public.pipelines p on p.id = e.pipeline_id
           where p.slug = 'produtor' and e.canonical_slug = 'em_conversa'), 0,
  'seed: "Em conversa" continua sem equivalência inventada (PRD §5.5)');

-- =====================================================================
-- 7. O guardrail vale também quando p_organization_id e p_deal_id DISCORDAM
-- =====================================================================
-- `p_organization_id` e `p_deal_id` são argumentos independentes e a função nunca
-- exigiu que combinassem. A tela sempre manda o par coerente, mas a RPC é `grant
-- execute ... to authenticated`: quem chamar por fora podia mandar uma organização
-- LIMPA em `p_organization_id` e o NEGÓCIO de uma organização SUPRIMIDA em
-- `p_deal_id`. O guardrail olhava só a primeira — e criava a tarefa no negócio de
-- quem pediu para parar. Medido na conferência adversarial antes do conserto:
-- tarefa "Marcar apresentação" para D+1, negócio assumido, frio → quente.
create table pg_temp.bypass(res jsonb);
do $$
declare r jsonb;
begin
  perform pg_temp.entrar('a0000000-0000-4000-8000-000000000a01', 'sdr');
  r := public.registrar_contato(
         gen_random_uuid(),
         'c0000000-0000-4000-8000-000000000901',      -- organização LIMPA
         (select id from public.interaction_outcomes where slug = 'vis_cadastro_iniciado'),
         'decisor',
         'e0000000-0000-4000-8000-000000000922');     -- negócio da organização SUPRIMIDA
  execute 'reset role'; insert into pg_temp.bypass values (r);
end $$;
select pg_temp.sair();

select is((select (res ->> 'contato_suprimido')::boolean from pg_temp.bypass), true,
  'bypass: a supressão é avaliada também na organização DO NEGÓCIO, não só na do pedido');
select is(pg_temp.abertas('e0000000-0000-4000-8000-000000000922'), 0,
  'bypass: o negócio de quem pediu para parar continua sem nenhuma tarefa aberta');
select is(pg_temp.temp_de('e0000000-0000-4000-8000-000000000922'), 'frio',
  'bypass: e continua frio, sem etapa de trabalho e sem intenção que esquente');

select * from finish();
rollback;

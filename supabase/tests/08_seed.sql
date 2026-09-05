-- =====================================================================
-- pgTAP — Seed (supabase/seed.sql): contagens e itens-chave dos catálogos, funis/etapas,
-- feriados, modelos de mensagem e controle de acesso (PRD §5, Apêndices C e F; R09 §E; R08 §2).
-- =====================================================================
begin;
select plan(58);

-- ---------- contagens ----------
select is((select count(*)::int from public.cities),                              22, 'seed: 22 cidades');
select is((select count(*)::int from public.cities where is_metro_natal),          7, 'seed: 7 cidades na Grande Natal');
select is((select count(*)::int from public.categories),                          19, 'seed: 19 categorias (Apêndice F)');
select is((select count(*)::int from public.categories where priority = 1),       10, 'seed: 10 categorias na onda P1');
select is((select count(*)::int from public.categories where "group" = 'producao'), 3, 'seed: 3 categorias de produtores');
select is((select count(*)::int from public.sources),                             11, 'seed: 11 origens/fontes (GetNinjas não entra no catálogo)');
select is((select count(*)::int from public.holidays where extract(year from date) = 2026), 16, 'seed: 16 feriados em 2026');
select is((select count(*)::int from public.holidays where extract(year from date) = 2027), 16, 'seed: 16 feriados em 2027 (cadências viram o ano)');
select is((select count(*)::int from public.lost_reasons),                         9, 'seed: 9 motivos de perda (PRD §5.3)');
select is((select count(*)::int from public.tags),                                 4, 'seed: 4 etiquetas');
select is((select count(*)::int from public.pipelines),                            3, 'seed: 3 funis');
select is((select count(*)::int from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'fornecedor'), 12, 'seed: 12 etapas no funil de fornecedor');
select is((select count(*)::int from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'ativacao'),    7, 'seed: 7 etapas no funil de ativação');
select is((select count(*)::int from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'produtor'),   14, 'seed: 14 etapas no funil de produtor');
select is((select count(*)::int from public.stages where position < 0),            0, 'seed: nenhuma etapa órfã (posição negativa)');
-- Escopo, e não total: a seed nasceu com seis áudios de APRESENTAÇÃO, um por
-- segmento (R08 §2), e a migração das cadências (20260904001700) acrescentou
-- 'gen-onb-ajuda-1', que é passo de cadência de onboarding e não apresentação.
-- Somar a tabela inteira transformaria "um por segmento" num teste que quebra
-- toda vez que a Heloísa grava um áudio novo. O que a seed promete são estes seis.
select results_eq(
  $$select slug from public.audio_assets where slug like '%-aud-1' order by slug$$,
  $$values ('aeb-aud-1'::text), ('cer-aud-1'::text), ('esp-aud-1'::text),
           ('for-aud-1'::text), ('inf-aud-1'::text), ('pre-aud-1'::text)$$,
  'seed: 6 roteiros de áudio de apresentação, um por segmento (R08 §2)');
select cmp_ok((select count(*)::int from public.message_templates), '>=', 40,        'seed: pelo menos 40 modelos de mensagem');
-- Mesmo raciocínio de `allowed_users`: liberar um segundo domínio é ato de admin,
-- não regressão da seed. O que a seed promete é que komune.app.br está ativo.
select is((select count(*)::int from public.allowed_domains
            where is_active and domain = 'komune.app.br'), 1,
  'seed: o domínio komune.app.br está ativo no SSO');
-- Escopo, e não total (conserto do achado D5): `allowed_users` é tabela de OPERAÇÃO
-- — conceder acesso a mais uma pessoa é trabalho normal do admin, e já aconteceu
-- (a Bárbara entrou como gestor em 04/09/2026 e derrubou esta asserção). O que a
-- seed promete é que os três e-mails nominais existem, não que ninguém mais entre.
select is((select count(*)::int from public.allowed_users
            where email in ('rafael@rafaelabreu.com', 'amovingmax@gmail.com', 'komune@komune.app.br')),
          3, 'seed: os 3 e-mails nominais da seed estão cadastrados');

-- ---------- itens-chave: catálogos ----------
select results_eq(
  $$select state, is_metro_natal, ibge_code from public.cities where name = 'Natal'$$,
  $$values ('RN'::char(2), true, '2408102'::text)$$, 'seed: Natal/RN na Grande Natal com código IBGE');
select results_eq(
  $$select name, "group", priority from public.categories where slug = 'buffet_adulto_corporativo'$$,
  $$values ('Buffet adulto/corporativo'::text, 'alimentos_bebidas'::text, 1::smallint)$$, 'seed: categoria P1 de alimentos e bebidas');
-- CLAUDE.md: "GetNinjas está fora das fontes". A linha não existe mais no catálogo: enquanto
-- existia (com is_enabled = false) bastava um clique do gestor em sources para reabilitá-la.
select is((select count(*)::int from public.sources where slug = 'getninjas'), 0, 'seed: GetNinjas não está no catálogo de origens');
select results_eq(
  $$select slug from public.sources where kind = 'referral' order by slug$$,
  $$values ('contato_pessoal'::text), ('indicacao'::text)$$, 'seed: origens de indicação (Tier A+)');
select is((select legal_basis from public.sources where slug = 'casamentos_com_br'), 'legitimo_interesse', 'seed: base legal registrada na fonte');
select results_eq(
  $$select name, scope from public.holidays where date = '2026-09-07'$$,
  $$values ('Independência do Brasil'::text, 'nacional'::text)$$, 'seed: feriado de 07/09/2026 (bloqueia envio no D1+1)');
select is((select count(*)::int from public.holidays where scope = 'municipal' and extract(year from date) = 2026), 2, 'seed: 2 feriados municipais de Natal por ano');
select is((select count(*)::int from public.holidays where scope = 'estadual' and extract(year from date) = 2027), 1, 'seed: 1 feriado estadual do RN por ano');
select results_eq($$select name from public.holidays where date = '2027-02-08'$$,
  $$values ('Carnaval — segunda-feira (ponto facultativo)'::text)$$, 'seed: Carnaval de 2027 (Páscoa 28/03) cadastrado');
select is(app.next_business_day('2026-12-31'::date), '2027-01-04'::date,
  'seed: D+1 útil a partir de 31/12/2026 pula 01/01/2027 (sexta) e o fim de semana');
select is((select name from public.lost_reasons where slug = 'nao_aceita_comissao'), 'Não aceita comissão', 'seed: motivo de perda "Não aceita comissão"');
select is((select count(*)::int from public.lost_reasons where slug in ('nao_respondeu', 'agora_nao')), 0, 'seed: "não respondeu" e "agora não" não são motivos de perda');
select results_eq($$select name from public.tags order by name$$,
  $$values ('fundador'::text), ('indicacao'::text), ('lista_semente_r09'::text), ('vip'::text)$$, 'seed: etiquetas fundador, indicação, lista-semente e VIP');

-- ---------- itens-chave: funis e etapas ----------
select results_eq($$select slug, kind::text from public.pipelines order by position$$,
  $$values ('fornecedor'::text, 'fornecedor'::text), ('ativacao'::text, 'fornecedor'::text), ('produtor'::text, 'produtor'::text)$$,
  'seed: funis fornecedor, ativação e produtor na ordem');
select results_eq(
  $$select s.slug, s.temperature::text from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'fornecedor' and s.position between 1 and 9 order by s.position$$,
  $$values ('prospectado'::text, 'frio'::text), ('contatado', 'frio'), ('respondeu', 'morno'), ('em_conversa', 'morno'),
           ('reuniao_marcada', 'quente'), ('apresentacao_realizada', 'quente'), ('autorizou', 'quente'), ('cadastro_em_andamento', 'quente'),
           ('publicado', 'cliente')$$,
  'seed: etapas 1–9 do Funil 1 com a temperatura do PRD §5.6');
select results_eq(
  $$select s.is_won, s.is_lost, s.is_terminal from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'fornecedor' and s.slug = 'publicado'$$,
  $$values (true, false, true)$$, 'seed: Publicado é ganho e terminal');
select results_eq(
  $$select s.is_won, s.is_lost, s.is_terminal, s.temperature::text from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'fornecedor' and s.slug = 'optout'$$,
  $$values (false, true, true, 'frio'::text)$$, 'seed: Opt-out é perda terminal');
select results_eq(
  $$select s.is_lost, s.is_terminal, jsonb_array_length(s.required_fields) > 0 from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'fornecedor' and s.slug = 'perdido'$$,
  $$values (true, false, true)$$, 'seed: Perdido é perda não terminal e exige motivo (RF-FUN-04)');
select ok(
  (select jsonb_array_length(s.required_fields) > 0 from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'fornecedor' and s.slug = 'reuniao_marcada'),
  'seed: Reunião marcada exige campos para entrar (data e formato)');
select ok(
  (select jsonb_array_length(s.automations) > 0 from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'fornecedor' and s.slug = 'contatado'),
  'seed: Contatado tem automações (régua de silêncio, RF-FUN-05)');
select results_eq(
  $$select s.slug, s.temperature::text from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'ativacao' and s.position between 1 and 6 order by s.position$$,
  $$values ('publicado'::text, 'cliente'::text), ('perfil_completo', 'cliente'), ('primeiro_lead', 'cliente_ativo'),
           ('lead_respondido', 'cliente_ativo'), ('primeira_contratacao', 'cliente_ativo'), ('recorrente', 'cliente_ativo')$$,
  'seed: Funil 2 — etapas 1–2 cliente, 3–6 cliente ativo');
select results_eq(
  $$select s.slug from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'produtor' and s.is_won order by s.position$$,
  $$values ('ativado'::text), ('recorrente'::text)$$, 'seed: Funil 3 — Ativado e Recorrente são ganho');
select is((select s.slug from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'produtor' and s.position = 1), 'identificado',
  'seed: Funil 3 começa em Identificado');
select is((select count(*)::int from public.stages where is_won and is_lost), 0, 'seed: nenhuma etapa é ganho e perda ao mesmo tempo');
-- Nutrição/dormente e Opt-out são etapa E status (PRD §5.3): quem deriva o status é
-- app.deals_before_write, lendo estas flags — que só a seed preenche. Sem elas o cartão
-- dormente continuava 'open' (fila do dia, needs_attention) e o opt-out exigia motivo de perda.
select results_eq(
  $$select p.slug, s.slug from public.stages s join public.pipelines p on p.id = s.pipeline_id
     where s.is_dormant order by p.slug$$,
  $$values ('fornecedor'::text, 'nutricao'::text), ('produtor'::text, 'nutricao'::text)$$,
  'seed: só as etapas de Nutrição dos Funis 1 e 3 são dormentes (is_dormant)');
select results_eq(
  $$select p.slug, s.slug from public.stages s join public.pipelines p on p.id = s.pipeline_id
     where s.is_optout order by p.slug$$,
  $$values ('fornecedor'::text, 'optout'::text), ('produtor'::text, 'optout'::text)$$,
  'seed: só as etapas de Opt-out dos Funis 1 e 3 têm is_optout');
select is((select count(*)::int from public.stages s join public.pipelines p on p.id = s.pipeline_id
            where p.slug = 'ativacao' and (s.is_dormant or s.is_optout)), 0,
  'seed: o funil de ativação não tem etapa dormente nem de opt-out (lá as flags já barram o envio)');
select is((select count(*)::int from public.stages where is_optout and not is_lost), 0,
  'seed: toda etapa de opt-out é etapa de perda (perda por regra, sem motivo da lista fechada)');
select is((select count(*)::int from public.sources where slug ilike '%ninja%' or name ilike '%ninjas%'), 0,
  'seed: GetNinjas não entra no catálogo nem com outro nome ou slug (CLAUDE.md, PRD §10.2)');

-- ---------- itens-chave: modelos de mensagem e áudios ----------
select is((select count(*)::int from public.message_templates where template_code like '%-ABR-%'), 12,
  'seed: 12 aberturas (6 segmentos × variantes A/B)');
select is((select count(*)::int from public.message_templates where template_code like '%-ABR-%' and (body !~ 'SAIR' or body !~* 'privacidade')), 0,
  'seed: toda abertura traz "SAIR" e o aviso de privacidade (RF-CON-12)');
select results_eq(
  $$select variant, category, segment from public.message_templates where template_code in ('AEB-ABR-A', 'AEB-ABR-B') order by template_code$$,
  $$values ('A'::text, 'marketing'::text, 'AEB'::text), ('B'::text, 'marketing'::text, 'AEB'::text)$$,
  'seed: abertura A/B do segmento Alimentos & Bebidas');
select ok((select variables ? 'nome' from public.message_templates where template_code = 'AEB-ABR-A'),
  'seed: variáveis derivadas do corpo ({{nome}})');
select results_eq(
  $$select template_code from public.message_templates where template_code in ('GEN-SYS-OPTOUT', 'GEN-FUP-D3-V1', 'SYS-PRE-AUDIO', 'SYS-POS-AUDIO') order by 1$$,
  $$values ('GEN-FUP-D3-V1'::text), ('GEN-SYS-OPTOUT'::text), ('SYS-POS-AUDIO'::text), ('SYS-PRE-AUDIO'::text)$$,
  'seed: mensagens de sistema (opt-out, follow-up D+3, pré/pós-áudio) existem');
select is((select count(*)::int from public.message_templates t join public.audio_assets a on a.id = t.audio_asset_id where t.kind = 'audio_script'), 6,
  'seed: os 6 roteiros de áudio estão ligados aos audio_assets');
select is((select count(*)::int from public.message_templates where body ~* 'imperdível|última chance|urgente|promoção'), 0,
  'seed: nenhum modelo usa palavras proibidas (R08 §5.1)');

-- ---------- itens-chave: acesso e cron ----------
select results_eq($$select domain::text, default_role::text from public.allowed_domains where is_active$$,
  $$values ('komune.app.br'::text, 'sdr'::text)$$, 'seed: domínio komune.app.br entra como sdr');
select is((select count(*)::int from public.allowed_users
            where email in ('rafael@rafaelabreu.com', 'amovingmax@gmail.com', 'komune@komune.app.br')
              and role <> 'admin'), 0,
  'seed: os e-mails nominais INICIAIS são admin (quem entrar depois entra com o papel que o admin escolher)');
select is((select schedule from cron.job where jobname = 'recompute_temperatures'), '0 6 * * *',
  'cron: recálculo de temperatura agendado às 03:00 America/Fortaleza (06:00 UTC)');

select * from finish();
rollback;

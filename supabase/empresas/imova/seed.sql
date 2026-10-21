-- =====================================================================
-- TRÍADE — dados iniciais da Imova Imobiliária (22/10/2026; plano multiempresa)
--
-- Roda DEPOIS das migrações, no banco da Imova, por
--   node scripts/publicar-banco.mjs imova semear [--local]
-- e em nenhum outro lugar. A primeira linha grava a identidade "imova"; num banco
-- que já tem parceiros (o da KOMUNE) ou que já é de outra empresa, ela aborta e
-- nada daqui é gravado. Pode rodar de novo: tudo é upsert.
--
-- O que é da Imova: funis de imobiliária (Captação de imóveis e Clientes, com os
-- mesmos slugs de etapa que as automações conhecem), categorias de imóvel e de
-- cliente, motivos de perda, roteiro de ligação, acesso inicial. Cidades e
-- feriados são os de Natal/RN, como na KOMUNE (a Imova atende Natal).
--
-- O que as migrações deixaram com cara de KOMUNE é desligado ou reescrito aqui:
-- menu automático do WhatsApp, apresentação automática, resposta fora do horário,
-- lead automático, aviso de quem não atendeu, e-mail de aviso, links da
-- plataforma Komune, respostas rápidas e modelos de mensagem que falam da Komune.
-- Regra para migrações futuras: dado de empresa entra pelo seed da empresa, nunca
-- pela migração (que roda nos dois bancos).
--
-- Sem WhatsApp, sem Twilio e sem IA no começo: cada um liga num passo próprio.
-- =====================================================================

select app.definir_identidade('imova');
select app.exigir_empresa('imova');

-- Textos da empresa que as funções do banco usam (arquivo da LGPD, mensagens do login).
insert into public.app_settings (key, value, description) values
  ('empresa',
   jsonb_build_object(
     'nome', 'Imova Imobiliária',
     'nome_maiusculo', 'Imova Imobiliária',
     'controlador', 'Imova Imobiliária',
     'email_privacidade', 'contato@imovaimobiliaria.com.br',
     'plataforma', null),
   'Quem é a empresa deste banco, para os textos que o próprio banco escreve.')
on conflict (key) do update set value = excluded.value, description = excluded.description;

-- =====================================================================
-- 1. Cidades do RN (as mesmas da KOMUNE; a Imova atende Natal e região).
-- =====================================================================
insert into public.cities (name, state, ibge_code, is_metro_natal) values
  -- Grande Natal
  ('Natal',                     'RN', '2408102', true),
  ('Parnamirim',                'RN', '2403251', true),
  ('São Gonçalo do Amarante',   'RN', '2412005', true),
  ('Extremoz',                  'RN', '2403608', true),
  ('Macaíba',                   'RN', '2407104', true),
  ('Nísia Floresta',            'RN', '2408201', true),
  ('Ceará-Mirim',               'RN', '2402600', true),
  -- Demais cidades do RN (expansão / origem de parceiros fora da Grande Natal)
  ('Mossoró',                   'RN', '2408003', false),
  ('Caicó',                     'RN', '2402006', false),
  ('Açu',                       'RN', '2400208', false),
  ('Currais Novos',             'RN', '2403103', false),
  ('Santa Cruz',                'RN', '2411205', false),
  ('Pau dos Ferros',            'RN', '2409407', false),
  ('João Câmara',               'RN', '2405801', false),
  ('Touros',                    'RN', '2414407', false),
  ('Apodi',                     'RN', '2401008', false),
  ('Nova Cruz',                 'RN', '2408300', false),
  ('Canguaretama',              'RN', '2402204', false),
  ('Goianinha',                 'RN', '2404200', false),
  ('Areia Branca',              'RN', '2401107', false),
  ('Macau',                     'RN', '2407203', false),
  ('Baraúna',                   'RN', '2401453', false)
on conflict (name, state) do update
  set ibge_code      = excluded.ibge_code,
      is_metro_natal = excluded.is_metro_natal;

-- =====================================================================
-- 2. Categorias. A categoria decide o tipo do parceiro e, com ele, o funil:
--    grupo `producao` vira Cliente (funil Clientes); `servicos`, Proprietário
--    (Captação de imóveis). É a mesma regra do cadastro rápido, da Revisão e da
--    importação. `categories.group` só aceita a lista fechada da KOMUNE; na tela da
--    Imova, `producao` aparece como "Clientes" e `servicos` como "Imóveis" (empresas.ts).
-- =====================================================================
insert into public.categories (slug, name, "group", priority, position, komune_category_key, is_active) values
  ('casa',        'Casa',        'servicos',  1, 1, null, true),
  ('apartamento', 'Apartamento', 'servicos',  1, 2, null, true),
  ('terreno',     'Terreno',     'servicos',  2, 3, null, true),
  ('comercial',   'Comercial',   'servicos',  2, 4, null, true),
  ('rural',       'Rural',       'servicos',  3, 5, null, true),
  ('comprador',   'Comprador',   'producao', 1, 6, null, true),
  ('locatario',   'Locatário',   'producao', 1, 7, null, true)
on conflict (slug) do update
  set name = excluded.name, "group" = excluded."group", priority = excluded.priority,
      position = excluded.position, is_active = excluded.is_active;

-- =====================================================================
-- 3. Origens. Só as de cadastro feito por gente; nenhuma coleta automática.
--    A busca no Google Maps entra mais tarde, pela API oficial.
-- =====================================================================
insert into public.sources (slug, name, kind, base_url, legal_basis, terms_notes, robots_ok, rate_limit_seconds, is_enabled, config) values
  ('planilha', 'Planilha (importação)', 'import', null, 'legitimo_interesse',
   'Planilha da equipe da Imova, importada pela esteira unificada com mapeamento de colunas, dedup e desfazer em 48 h. Lista de terceiros só com licença ou contrato anexado.',
   null, 0.00, true,
   '{"collector": {"kind": "spreadsheet", "phase": "mvp", "enabled": true}, "requires_license_for_third_party_lists": true, "entrada_por_arquivo": true}'),
  ('contato_pessoal', 'Contato pessoal', 'referral', null, 'legitimo_interesse',
   'Relacionamento prévio de alguém do time da Imova. Registrar quem é a pessoa do time em collector.',
   null, 0.00, true,
   '{"collector": {"kind": "manual", "phase": "mvp", "enabled": true}, "tier": "A+"}'),
  ('indicacao', 'Indicação', 'referral', null, 'legitimo_interesse',
   'Indicação de um cliente ou parceiro da Imova. Base legal: legítimo interesse; quem indica deve ter avisado a pessoa.',
   null, 0.00, true,
   '{"collector": {"kind": "manual", "phase": "mvp", "enabled": true}, "tier": "A+"}'),
  ('captura_campo', 'Captura em campo', 'manual', null, 'legitimo_interesse',
   'Cadastro rápido pelo celular durante visitas e plantões: nome, categoria, WhatsApp e origem, com dedup imediata por telefone.',
   null, 0.00, true,
   '{"collector": {"kind": "manual", "phase": "mvp", "enabled": true}}'),
  ('instagram', 'Instagram', 'manual', 'https://www.instagram.com', 'legitimo_interesse',
   'Curadoria manual: o time anota @, nome e o contato comercial público da bio. Nada automatizado.',
   false, 5.00, true,
   '{"collector": {"kind": "manual", "phase": "mvp", "enabled": false}, "manual_curation": true}')
on conflict (slug) do update
  set name = excluded.name, kind = excluded.kind, base_url = excluded.base_url,
      legal_basis = excluded.legal_basis, terms_notes = excluded.terms_notes,
      robots_ok = excluded.robots_ok, rate_limit_seconds = excluded.rate_limit_seconds,
      is_enabled = excluded.is_enabled, config = excluded.config;

-- A origem "Chegou pelo WhatsApp" nasce na migração com o texto da KOMUNE.
update public.sources
   set terms_notes = 'A pessoa escreveu para o número da Imova Imobiliária e alguém do time criou a ficha a partir da conversa. O dado veio dela mesma, num contato comercial que ela iniciou.'
 where slug = 'whatsapp_entrada';

-- =====================================================================
-- 5. Motivos de perda. "Não respondeu" e "agora não" não são perda: vão para Nutrição.
-- =====================================================================
insert into public.lost_reasons (slug, name, is_active, position) values
  ('outra_imobiliaria',     'Fechou com outra imobiliária',            true, 1),
  ('fora_do_orcamento',     'Fora do orçamento',                       true, 2),
  ('desistiu',              'Desistiu',                                true, 3),
  ('imovel_nao_atende',     'Imóvel não atende',                       true, 4),
  ('condicoes_proprietario','Proprietário não aceitou as condições',   true, 5),
  ('sem_retorno',           'Sem retorno',                             true, 6),
  ('fora_da_regiao',        'Fora da região',                          true, 7)
on conflict (slug) do update
  set name = excluded.name, is_active = excluded.is_active, position = excluded.position;

-- =====================================================================
-- 6. Etiquetas.
-- =====================================================================
insert into public.tags (name, color) values
  ('vip',       '#7C3AED'),
  ('indicacao', '#10B981')
on conflict (name) do update set color = excluded.color;

-- =====================================================================
-- 11. Acesso inicial: só estes e-mails, sem liberar domínio inteiro.
--     contato@komune.app.br é só para os testes e sai depois (Admin → Pessoas).
-- =====================================================================
insert into public.allowed_users (email, role, note) values
  ('contato@imovaimobiliaria.com.br', 'admin', 'Imova Imobiliária — acesso inicial'),
  ('contato@komune.app.br',           'admin', 'Testes da implantação — remover depois')
on conflict (email) do update set role = excluded.role, note = excluded.note;

-- =====================================================================
-- 4. Feriados 2026 e 2027 (nacionais, RN e Natal): nunca enviar em feriado.
-- =====================================================================
insert into public.holidays (date, name, scope) values
  ('2026-01-01', 'Confraternização Universal',                                  'nacional'),
  ('2026-01-06', 'Dia de Santos Reis (Natal)',                                  'municipal'),
  ('2026-02-16', 'Carnaval — segunda-feira (ponto facultativo)',                'nacional'),
  ('2026-02-17', 'Carnaval — terça-feira (ponto facultativo)',                  'nacional'),
  ('2026-04-03', 'Sexta-feira Santa (Paixão de Cristo)',                        'nacional'),
  ('2026-04-21', 'Tiradentes',                                                  'nacional'),
  ('2026-05-01', 'Dia do Trabalho',                                             'nacional'),
  ('2026-06-04', 'Corpus Christi (ponto facultativo)',                          'nacional'),
  ('2026-09-07', 'Independência do Brasil',                                     'nacional'),
  ('2026-10-03', 'Mártires de Cunhaú e Uruaçu (RN)',                            'estadual'),
  ('2026-10-12', 'Nossa Senhora Aparecida',                                     'nacional'),
  ('2026-11-02', 'Finados',                                                     'nacional'),
  ('2026-11-15', 'Proclamação da República',                                    'nacional'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra',                'nacional'),
  ('2026-11-21', 'Nossa Senhora da Apresentação — padroeira de Natal',          'municipal'),
  ('2026-12-25', 'Natal',                                                       'nacional'),

  ('2027-01-01', 'Confraternização Universal',                                  'nacional'),
  ('2027-01-06', 'Dia de Santos Reis (Natal)',                                  'municipal'),
  ('2027-02-08', 'Carnaval — segunda-feira (ponto facultativo)',                'nacional'),
  ('2027-02-09', 'Carnaval — terça-feira (ponto facultativo)',                  'nacional'),
  ('2027-03-26', 'Sexta-feira Santa (Paixão de Cristo)',                        'nacional'),
  ('2027-04-21', 'Tiradentes',                                                  'nacional'),
  ('2027-05-01', 'Dia do Trabalho',                                             'nacional'),
  ('2027-05-27', 'Corpus Christi (ponto facultativo)',                          'nacional'),
  ('2027-09-07', 'Independência do Brasil',                                     'nacional'),
  ('2027-10-03', 'Mártires de Cunhaú e Uruaçu (RN)',                            'estadual'),
  ('2027-10-12', 'Nossa Senhora Aparecida',                                     'nacional'),
  ('2027-11-02', 'Finados',                                                     'nacional'),
  ('2027-11-15', 'Proclamação da República',                                    'nacional'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra',                'nacional'),
  ('2027-11-21', 'Nossa Senhora da Apresentação — padroeira de Natal',          'municipal'),
  ('2027-12-25', 'Natal',                                                       'nacional')
on conflict (date, scope) do update
  set name = excluded.name;

-- =====================================================================
-- 7. Funis e etapas.
--
-- Os slugs são os que o código e as funções do banco conhecem: a primeira
-- mensagem leva para `contatado`, a resposta para `respondeu` (prazo de 24 h),
-- marcar reunião leva para `reuniao_marcada` (no funil Clientes, pela
-- equivalência, `demonstracao_marcada`), a autorização mora em
-- `cadastro_em_andamento` / `parceria_aceita`. Os NOMES são da Imova.
-- `pipelines.slug` só aceita fornecedor, ativacao e produtor; a Imova usa os dois
-- de captação: `fornecedor` = Captação de imóveis (proprietários) e `produtor` =
-- Clientes (compra e locação). Não há funil de ativação.
-- `stages.automations` é documentação (nenhum código executa); fica vazio.
-- =====================================================================
insert into public.pipelines (slug, name, kind, position) values
  ('fornecedor', 'Captação de imóveis', 'fornecedor', 1),
  ('produtor',   'Clientes',            'produtor',   2)
on conflict (slug) do update
  set name = excluded.name, kind = excluded.kind, position = excluded.position;

update public.stages set position = -position where position > 0;

insert into public.stages (pipeline_id, slug, name, position, temperature, is_won, is_lost, is_dormant, is_optout, is_entry, is_terminal, sla_hours, required_fields, automations)
select p.id, s.slug, s.name, s.position, s.temperature::app.temperature, s.is_won, s.is_lost,
       s.slug = 'nutricao' as is_dormant,
       s.slug = 'optout'   as is_optout,
       s.slug in ('prospectado', 'identificado') as is_entry,
       s.is_terminal, s.sla_hours, s.required_fields::jsonb, '[]'::jsonb
from (values
  -- ---------------- Captação de imóveis (proprietários) ----------------
  ('fornecedor', 'prospectado',            'Prospectado',        1, 'frio',    false, false, false, 72,   '[]'),
  ('fornecedor', 'contatado',              'Contatado',          2, 'frio',    false, false, false, 72,   '[]'),
  ('fornecedor', 'respondeu',              'Respondeu',          3, 'morno',   false, false, false, 24,   '[]'),
  ('fornecedor', 'reuniao_marcada',        'Avaliação marcada',  5, 'quente',  false, false, false, 24,
   $j$[{"field":"meeting_at","label":"Data e hora da avaliação","type":"timestamptz"},
       {"field":"meeting_format","label":"Formato","type":"enum","options":["meet","visita"]}]$j$),
  ('fornecedor', 'apresentacao_realizada', 'Imóvel avaliado',    6, 'quente',  false, false, false, 120,  '[]'),
  ('fornecedor', 'cadastro_em_andamento',  'Documentação',       8, 'quente',  false, false, false, 72,
   $j$[{"field":"authorization_evidence","label":"O que o proprietário autorizou, com as palavras dele (a frase, a data e por onde veio)","consent_kind":"data_use_authorized","required":false}]$j$),
  ('fornecedor', 'publicado',              'Imóvel captado',     9, 'cliente', true,  false, true,  null, '[]'),
  ('fornecedor', 'nutricao',               'Nutrição / dormente', 90, 'frio',  false, false, false, 720,  '[]'),
  ('fornecedor', 'perdido',                'Perdido',            98, 'frio',   false, true,  false, null,
   $j$[{"field":"lost_reason_id","label":"Motivo da perda (lista fechada)","table":"lost_reasons"}]$j$),
  ('fornecedor', 'optout',                 'Opt-out / não contatar', 99, 'frio', false, true, true, null, '[]'),

  -- ---------------- Clientes (compra e locação) ----------------
  ('produtor', 'identificado',           'Identificado',        1, 'frio',    false, false, false, 24,   '[]'),
  ('produtor', 'contatado',              'Contatado',           2, 'frio',    false, false, false, 72,   '[]'),
  ('produtor', 'respondeu',              'Respondeu',           3, 'morno',   false, false, false, 24,   '[]'),
  ('produtor', 'demonstracao_marcada',   'Visita marcada',      4, 'quente',  false, false, false, 24,
   $j$[{"field":"meeting_at","label":"Data e hora da visita","type":"timestamptz"},
       {"field":"meeting_format","label":"Formato","type":"enum","options":["meet","visita"]}]$j$),
  ('produtor', 'demonstracao_realizada', 'Visita realizada',    5, 'quente',  false, false, false, 48,   '[]'),
  ('produtor', 'parceria_aceita',        'Proposta',            6, 'quente',  false, false, false, 72,
   $j$[{"field":"authorization_evidence","label":"O que o cliente autorizou, com as palavras dele (a frase, a data e por onde veio)","consent_kind":"data_use_authorized","required":false}]$j$),
  ('produtor', 'ativado',                'Negócio fechado',     7, 'cliente', true,  false, true,  null, '[]'),
  ('produtor', 'nutricao',               'Nutrição / dormente', 90, 'frio',  false, false, false, 720,  '[]'),
  ('produtor', 'perdido',                'Perdido',             98, 'frio',  false, true,  false, null,
   $j$[{"field":"lost_reason_id","label":"Motivo da perda (lista fechada)","table":"lost_reasons"}]$j$),
  ('produtor', 'optout',                 'Opt-out / não contatar', 99, 'frio', false, true, true, null, '[]')
) as s(pipeline_slug, slug, name, position, temperature, is_won, is_lost, is_terminal, sla_hours, required_fields)
join public.pipelines p on p.slug = s.pipeline_slug
on conflict (pipeline_id, slug) do update
  set name = excluded.name, position = excluded.position, temperature = excluded.temperature,
      is_won = excluded.is_won, is_lost = excluded.is_lost, is_dormant = excluded.is_dormant,
      is_optout = excluded.is_optout, is_entry = excluded.is_entry, is_terminal = excluded.is_terminal,
      sla_hours = excluded.sla_hours, required_fields = excluded.required_fields,
      automations = excluded.automations;

-- 12b. Equivalências: um desfecho de reunião ou autorização vale nos dois funis.
insert into public.stage_equivalences (pipeline_id, canonical_slug, stage_slug, note)
select p.id, v.canonical_slug, v.stage_slug, v.note
  from (values
    ('produtor', 'reuniao_marcada',        'demonstracao_marcada',   'Avaliação marcada ↔ Visita marcada: data e formato confirmados.'),
    ('produtor', 'apresentacao_realizada', 'demonstracao_realizada', 'Imóvel avaliado ↔ Visita realizada: encontro feito.'),
    ('produtor', 'cadastro_em_andamento',  'parceria_aceita',        'Documentação ↔ Proposta: o sim registrado.')
  ) as v(pipeline, canonical_slug, stage_slug, note)
  join public.pipelines p on p.slug = v.pipeline
on conflict (pipeline_id, canonical_slug) do update
  set stage_slug = excluded.stage_slug, note = excluded.note;

-- =====================================================================
-- 12. Desfechos de contato (os mesmos 34 da KOMUNE: são de vendas, não de evento).
-- =====================================================================
insert into public.interaction_outcomes
  (slug, name, surfaces, position, is_active, cooldown_days, can_reactivate,
   next_action_kind, next_action_label, next_action_offset_days,
   target_stage_slug, sets_temperature, requires_lost_reason, counts_as) values
  ('wa_sem_resposta',        'Enviado, sem resposta',      '{whatsapp}',     101, true,     3, true,  'follow_up', 'Follow-up D+3',              3, null,                    null,     false, 'batida'),
  ('wa_respondeu',           'Respondeu',                  '{whatsapp}',     102, true,     0, true,  'message',   'Responder em 15 min',        0, 'respondeu',             'morno',  false, 'aberta'),
  ('wa_nao_e_a_pessoa',      'Não é a pessoa',             '{whatsapp}',     103, true,     0, true,  'other',     'Achar o decisor',            0, null,                    null,     false, 'batida'),
  ('wa_agora_nao',           'Agora não',                  '{whatsapp}',     104, true,    30, true,  'message',   'Reativar com gancho',       30, 'nutricao',              'frio',   false, 'aberta'),
  ('wa_nao_firme',           'Não, definitivo',            '{whatsapp}',     105, true,    90, false, null,        null,                      null, 'perdido',               null,     true,  'aberta'),
  ('wa_numero_invalido',     'Número inválido',            '{whatsapp}',     106, true, 36500, false, 'other',     'Buscar outro canal',         0, null,                    null,     false, 'nenhuma'),
  ('wa_optout',              'Pediu para parar',           '{whatsapp}',     107, true, 36500, false, null,        null,                      null, 'optout',                'frio',   false, 'nenhuma'),
  ('lig_nao_atendeu',        'Não atendeu',                '{ligacao}',      201, true,     1, true,  'call',      'Ligar D+1 (última)',         1, null,                    null,     false, 'batida'),
  ('lig_caixa_postal',       'Caixa postal',               '{ligacao}',      202, true,     1, true,  'call',      'Ligar D+1',                  1, null,                    null,     false, 'batida'),
  ('lig_numero_errado',      'Número errado',              '{ligacao}',      203, true, 36500, false, 'other',     'Buscar outro canal',         0, null,                    null,     false, 'nenhuma'),
  ('lig_atendeu_retorna',    'Atendeu, retorna depois',    '{ligacao}',      204, true,     2, true,  'call',      'Ligar na data combinada', null, null,                    'morno',  false, 'aberta'),
  ('lig_interessado',        'Interessado',                '{ligacao}',      205, true,     0, true,  'meeting',   'Marcar apresentação',     null, 'respondeu',             'quente', false, 'aberta'),
  ('lig_agora_nao',          'Agora não',                  '{ligacao}',      206, true,    30, true,  'message',   'Reativar com gancho',       30, 'nutricao',              'frio',   false, 'aberta'),
  ('lig_sem_interesse',      'Sem interesse',              '{ligacao}',      207, true,    90, false, null,        null,                      null, 'perdido',               null,     true,  'aberta'),
  ('lig_reuniao_marcada',    'Reunião marcada',            '{ligacao}',      208, true,     0, true,  'meeting',   'Reunião na data',         null, 'reuniao_marcada',       'quente', false, 'aberta'),
  ('vis_nao_estava',         'Não estava / fechado',       '{visita}',       301, true,     7, true,  'visit',     'Visitar D+7 na zona',        7, null,                    null,     false, 'batida'),
  ('vis_funcionario',        'Falei com funcionário',      '{visita}',       302, true,     2, true,  'call',      'Ligar ao decisor D+2',       2, null,                    null,     false, 'batida'),
  ('vis_decisor_interessado','Decisor interessado',        '{visita}',       303, true,     0, true,  'meeting',   'Marcar apresentação ou link', null, 'respondeu',          'quente', false, 'aberta'),
  ('vis_decisor_agora_nao',  'Decisor, agora não',         '{visita}',       304, true,    30, true,  'message',   'Reativar com gancho',       30, 'nutricao',              'frio',   false, 'aberta'),
  ('vis_decisor_recusou',    'Decisor recusou',            '{visita}',       305, true,    90, false, null,        null,                      null, 'perdido',               null,     true,  'aberta'),
  ('vis_cadastro_iniciado',  'Cadastro iniciado na hora',  '{visita}',       306, true,     3, true,  'follow_up', 'Retomar o cadastro D+3',     3, 'cadastro_em_andamento', 'quente', false, 'aberta'),
  ('vis_sem_perfil',         'Sem perfil (fora do ICP)',   '{visita}',       307, true, 36500, false, null,        null,                      null, 'perdido',               null,     true,  'batida'),
  ('reu_interessado',        'Realizada, interessado',     '{reuniao}',      401, true,     0, true,  'message',   'Pedir autorização hoje',     0, 'apresentacao_realizada','quente', false, 'aberta'),
  ('reu_autorizou',          'Realizada, autorizou',       '{reuniao}',      402, true,     0, true,  'message',   'Enviar link de cadastro',    0, 'cadastro_em_andamento', 'quente', false, 'aberta'),
  ('reu_objecao',            'Realizada, com objeção',     '{reuniao}',      403, true,     1, true,  'follow_up', 'Follow-up D+1',              1, 'apresentacao_realizada','quente', false, 'aberta'),
  ('reu_nao',                'Realizada, não',             '{reuniao}',      404, true,    90, false, null,        null,                      null, 'perdido',               null,     true,  'aberta'),
  ('reu_no_show',            'No-show',                    '{reuniao}',      405, true,     1, true,  'meeting',   'Reagendar em 24 h',          1, null,                    null,     false, 'batida'),
  ('reu_reagendada',         'Reagendada',                 '{reuniao}',      406, true,     0, true,  'meeting',   'Reunião na nova data',    null, 'reuniao_marcada',       'quente', false, 'batida'),
  ('dm_sem_resposta',        'DM enviada, sem resposta',   '{instagram_dm}', 501, true,     5, true,  'call',      'Ligar ou visitar D+5',       5, null,                    null,     false, 'batida'),
  ('dm_respondeu',           'Respondeu na DM',            '{instagram_dm}', 502, true,     0, true,  'message',   'Responder em 15 min',        0, 'respondeu',             'morno',  false, 'aberta'),
  ('dm_pediu_whatsapp',      'Pediu contato no WhatsApp',  '{instagram_dm}', 503, true,     0, true,  'message',   'Mensagem no WhatsApp hoje',  0, 'respondeu',             'morno',  false, 'aberta'),
  ('dm_nao_e_a_pessoa',      'Não é a pessoa',             '{instagram_dm}', 504, true,     0, true,  'other',     'Achar o decisor',            0, null,                    null,     false, 'batida'),
  ('dm_perfil_inativo',      'Perfil inativo, não fornece','{instagram_dm}', 505, true, 36500, false, null,        null,                      null, 'perdido',               null,     true,  'nenhuma'),
  ('dm_optout',              'Pediu para parar',           '{instagram_dm}', 506, true, 36500, false, null,        null,                      null, 'optout',                'frio',   false, 'nenhuma')
on conflict (slug) do update
  set name                    = excluded.name,
      surfaces                = excluded.surfaces,
      position                = excluded.position,
      is_active               = excluded.is_active,
      cooldown_days           = excluded.cooldown_days,
      can_reactivate          = excluded.can_reactivate,
      next_action_kind        = excluded.next_action_kind,
      next_action_label       = excluded.next_action_label,
      next_action_offset_days = excluded.next_action_offset_days,
      target_stage_slug       = excluded.target_stage_slug,
      sets_temperature        = excluded.sets_temperature,
      requires_lost_reason    = excluded.requires_lost_reason,
      counts_as               = excluded.counts_as;

update public.interaction_outcomes
   set requires_answer = (slug in ('lig_atendeu_retorna', 'lig_interessado', 'lig_agora_nao',
                                   'lig_sem_interesse', 'lig_reuniao_marcada'))
 where 'ligacao'::app.interaction_surface = any (surfaces);
update public.interaction_outcomes
   set requires_answer = false
 where not ('ligacao'::app.interaction_surface = any (surfaces))
   and requires_answer;

-- =====================================================================
-- Roteiro de ligação da Imova (provisório). As migrações publicam o roteiro da
-- KOMUNE (captacao_v1, eventos); aqui ele sai de publicação e entra um roteiro
-- de imobiliária, curto, com os dois caminhos: proprietário (variante
-- `fornecedor`, funil Captação de imóveis) e cliente (variante `produtor`, funil
-- Clientes). Regras do roteiro da KOMUNE que valem aqui também: a origem do
-- contato logo depois da abertura (R06), nenhuma promessa de valor, prazo ou
-- exclusividade, nada de gênero presumido.
-- =====================================================================
update public.call_scripts set is_published = false where slug <> 'imova_v1' and is_published;

insert into public.call_scripts (slug, nome, versao, arvore, is_published, published_at)
values ('imova_v1', 'Ligação — proprietários e clientes (v1)', 1, $roteiro$[
  {"id": "abertura", "tipo": "pergunta", "variante": "captacao",
   "texto": "[saudacao], tudo bem? Meu nome é [eu], sou da Imova Imobiliária, aqui de Natal. Falo com [interlocutor]?",
   "saidas": [
     {"rotulo": "Sou eu", "destino": "origem"},
     {"rotulo": "Não é comigo", "destino": "pedir_decisor"},
     {"rotulo": "Não posso falar agora", "destino": "combinar_retorno"},
     {"rotulo": "Engano / número errado", "destino": "fim_engano"},
     {"rotulo": "Desligou no meio", "destino": "fim_desligou"}]},

  {"id": "origem", "tipo": "pergunta", "variante": "captacao",
   "texto": "Peguei seu contato [origem]. Posso tomar dois minutinhos?",
   "saidas": [
     {"rotulo": "Pode falar", "destino": "prop_interesse"},
     {"rotulo": "Pode falar", "destino": "cli_interesse"},
     {"rotulo": "Agora não", "destino": "combinar_retorno"},
     {"rotulo": "Não tenho interesse", "destino": "fim_sem_interesse"}]},

  {"id": "prop_interesse", "tipo": "pergunta", "variante": "fornecedor",
   "texto": "A Imova está procurando imóveis aqui na região para venda e para locação. Você tem algum imóvel que pensa em vender ou alugar?",
   "saidas": [
     {"rotulo": "Tenho", "destino": "prop_imovel"},
     {"rotulo": "Talvez mais pra frente", "destino": "fim_agora_nao"},
     {"rotulo": "Não tenho", "destino": "fim_sem_interesse"}]},

  {"id": "prop_imovel", "tipo": "captura", "variante": "fornecedor", "campo": "imovel_do_proprietario",
   "texto": "Me conta rapidinho: que tipo de imóvel é, em qual bairro, e se é para vender ou alugar?",
   "saidas": [{"rotulo": "Anotei", "destino": "prop_avaliacao"}]},

  {"id": "prop_avaliacao", "tipo": "pergunta", "variante": "fornecedor",
   "texto": "A gente pode fazer uma avaliação do imóvel, pra você saber como anunciar. Podemos marcar um horário pra ver o imóvel?",
   "saidas": [
     {"rotulo": "Marcar avaliação", "destino": "fim_reuniao"},
     {"rotulo": "Prefere conversar pelo WhatsApp", "destino": "fim_interessado"},
     {"rotulo": "Agora não", "destino": "fim_agora_nao"}]},

  {"id": "cli_interesse", "tipo": "pergunta", "variante": "produtor",
   "texto": "Você está procurando imóvel pra comprar ou pra alugar?",
   "saidas": [
     {"rotulo": "Comprar", "destino": "cli_perfil"},
     {"rotulo": "Alugar", "destino": "cli_perfil"},
     {"rotulo": "Não estou procurando", "destino": "fim_sem_interesse"}]},

  {"id": "cli_perfil", "tipo": "captura", "variante": "produtor", "campo": "perfil_do_imovel",
   "texto": "Me conta rapidinho: que tipo de imóvel, em qual bairro e mais ou menos em que faixa de valor?",
   "saidas": [{"rotulo": "Anotei", "destino": "cli_visita"}]},

  {"id": "cli_visita", "tipo": "pergunta", "variante": "produtor",
   "texto": "Vou separar as opções que combinam com isso. Podemos marcar uma visita?",
   "saidas": [
     {"rotulo": "Marcar visita", "destino": "fim_reuniao"},
     {"rotulo": "Mandar opções no WhatsApp", "destino": "fim_interessado"},
     {"rotulo": "Agora não", "destino": "fim_agora_nao"}]},

  {"id": "pedir_decisor", "tipo": "captura", "variante": "captacao", "campo": "decisor",
   "texto": "Sem problema. Com quem eu falo sobre isso, e qual o melhor horário?",
   "saidas": [{"rotulo": "Anotei", "destino": "fim_retorna"}]},

  {"id": "combinar_retorno", "tipo": "captura", "variante": "captacao", "campo": "retorno_combinado",
   "texto": "Claro! Qual o melhor dia e horário pra eu te ligar de novo?",
   "saidas": [{"rotulo": "Combinado", "destino": "fim_retorna"}]},

  {"id": "fim_reuniao", "tipo": "fim", "variante": "captacao", "desfecho": "lig_reuniao_marcada",
   "texto": "Combinado! Vou confirmar o dia e o horário pelo WhatsApp. Agradeço pelo seu tempo!"},
  {"id": "fim_interessado", "tipo": "fim", "variante": "captacao", "desfecho": "lig_interessado",
   "texto": "Perfeito, te mando agora pelo WhatsApp. Qualquer dúvida, é só responder por lá."},
  {"id": "fim_agora_nao", "tipo": "fim", "variante": "captacao", "desfecho": "lig_agora_nao",
   "texto": "Tranquilo! Se precisar, é só chamar a Imova. Tenha um ótimo dia!"},
  {"id": "fim_sem_interesse", "tipo": "fim", "variante": "captacao", "desfecho": "lig_sem_interesse",
   "texto": "Entendo. Agradeço a atenção e tenha um ótimo dia!"},
  {"id": "fim_retorna", "tipo": "fim", "variante": "captacao", "desfecho": "lig_atendeu_retorna",
   "texto": "Combinado, então. Até breve!"},
  {"id": "fim_engano", "tipo": "fim", "variante": "captacao", "resultadoTecnico": "numero_invalido",
   "texto": "Desculpe o engano. Tenha um bom dia!"},
  {"id": "fim_desligou", "tipo": "fim", "variante": "captacao", "resultadoTecnico": "queda_de_linha",
   "texto": "A ligação caiu."}
]$roteiro$::jsonb, true, now())
on conflict (slug, versao) do update
  set nome = excluded.nome, arvore = excluded.arvore, is_published = true,
      published_at = coalesce(public.call_scripts.published_at, now());

-- =====================================================================
-- O que as migrações deixaram ligado e com cara de KOMUNE.
-- A Imova começa sem WhatsApp, sem Twilio e sem IA: nada aqui pode falar sozinho
-- com ninguém. Quando o WhatsApp da Imova chegar, cada automação é ligada com
-- texto e modelo da Imova aprovados na Meta.
-- =====================================================================

-- Menu automático do WhatsApp (o da KOMUNE oferece "ser fornecedor" e "organizar evento").
update public.app_settings set value = value || '{"ativo": false}'::jsonb
 where key = 'whatsapp.bot_de_entrada';

-- Atendimento: sem apresentação automática ("Sou da Komune…"), sem resposta fora
-- do horário (o horário é da KOMUNE), sem lead automático (criaria todo contato
-- como proprietário) e sem bom-dia automático.
update public.app_settings
   set value = value || '{"introducao_ativa": false, "ausencia_ativa": false, "lead_automatico": false, "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';

-- Aviso no WhatsApp para quem não atendeu: o da KOMUNE diz "Aqui é da Komune".
update public.app_settings set value = value || '{"ativo": false}'::jsonb
 where key = 'voz.aviso_nao_atendeu';

-- Telefonia pelo navegador: a Imova começa sem Twilio (a migração já nasce desligada).
update public.app_settings set value = value || '{"ativa": false}'::jsonb
 where key = 'voz.telefonia';

-- Aviso por e-mail de mensagem nova: endereços da Imova, desligado até existir WhatsApp.
update public.app_settings
   set value = value || jsonb_build_object(
         'ativo', false,
         'de', 'Tríade · Imova <onboarding@resend.dev>',
         'para', jsonb_build_array('contato@imovaimobiliaria.com.br'),
         'responder_para', 'contato@imovaimobiliaria.com.br',
         'url_do_crm', null)
 where key = 'notificacoes.email';

-- Links da plataforma Komune: a Imova não tem pré-cadastro em plataforma externa.
update public.app_settings set value = '{"modelo": null}'::jsonb where key = 'precadastro.link';
update public.app_settings
   set value = '{"base": null, "destino_padrao": "https://imovaimobiliaria.com.br"}'::jsonb
 where key = 'envios.link';
update public.app_settings set value = value || '{"push_ativo": false}'::jsonb
 where key = 'integracao.komune';

-- IA: os módulos da leitura da ficha e do pulso já nascem desligados (ia.crm_inteligente).
-- O resto da IA (classificar, transcrever, resumir, triar) não tem chave de desligar no
-- banco: na Imova ela fica desligada por não existir worker de IA nem chave da Anthropic.
-- Os pedidos esperam na fila, sem custo; os botões de IA somem da tela (empresas.ts).

-- Respostas rápidas da KOMUNE ("Estar na Komune é de graça…").
update public.respostas_rapidas set ativo = false
 where texto ~* 'komune|natal|evento|fornecedor';

-- Modelos de mensagem que as migrações gravaram com o texto da KOMUNE.
update public.message_templates set is_active = false
 where body ~* 'komune|helo[ií]sa|aplicativo de eventos|fornecedor|cerimonial';

-- O expediente do WhatsApp nasce com o nome da KOMUNE na nota.
update public.channel_windows set note = 'Expediente (horário provisório; a Imova define o dela)'
 where note like 'Expediente da KOMUNE%';

-- =====================================================================
-- 13. Autoverificação. Qualquer falta aborta com o nome do problema.
-- =====================================================================
do $$
declare
  ano     int := extract(year from (now() at time zone 'America/Fortaleza'))::int;
  n_hol   int; n_hol1 int; n_cat int; n_pipe int; n_lost int; n_out int; n_eq int;
  n_pub   int; n_err int; s_falta text;
begin
  perform app.exigir_empresa('imova');

  select count(*) into n_cat  from public.categories where is_active;
  select count(*) into n_pipe from public.pipelines;
  select count(*) into n_lost from public.lost_reasons where is_active;
  select count(*) into n_out  from public.interaction_outcomes;
  select count(*) into n_eq   from public.stage_equivalences;
  select count(*) into n_hol  from public.holidays where extract(year from date) = ano;
  select count(*) into n_hol1 from public.holidays where extract(year from date) = ano + 1;
  select count(*) into n_pub  from public.call_scripts where is_published;
  select coalesce(cardinality(app.validar_roteiro(arvore)), 0) into n_err
    from public.call_scripts where slug = 'imova_v1' and is_published;

  if n_cat <> 7 then raise exception 'seed imova: esperadas 7 categorias ativas, encontradas %', n_cat; end if;
  if n_pipe <> 2 then raise exception 'seed imova: esperados 2 funis, encontrados %', n_pipe; end if;
  if n_lost <> 7 then raise exception 'seed imova: esperados 7 motivos de perda, encontrados %', n_lost; end if;
  if n_out <> 34 then raise exception 'seed imova: esperados 34 desfechos, encontrados %', n_out; end if;
  if n_eq <> 3 then raise exception 'seed imova: esperadas 3 equivalências, encontradas %', n_eq; end if;
  if n_hol < 16 or n_hol1 < 16 then
    raise exception 'seed imova: feriados insuficientes (% em %, % em %)', n_hol, ano, n_hol1, ano + 1;
  end if;
  if n_pub <> 1 then raise exception 'seed imova: esperado 1 roteiro publicado (imova_v1), encontrados %', n_pub; end if;
  if n_err is null then raise exception 'seed imova: o roteiro imova_v1 não está publicado'; end if;
  if n_err > 0 then
    raise exception 'seed imova: roteiro com erro estrutural: %',
      array_to_string((select app.validar_roteiro(arvore) from public.call_scripts where slug = 'imova_v1'), ' ');
  end if;

  -- Todo desfecho com etapa de destino resolve nos dois funis (direto ou por equivalência).
  select string_agg(distinct p.slug || ':' || o.target_stage_slug, ', ') into s_falta
    from public.interaction_outcomes o cross join public.pipelines p
   where o.is_active and o.target_stage_slug is not null
     and not exists (select 1 from app.stage_for(p.id, o.target_stage_slug));
  if s_falta is not null then raise exception 'seed imova: desfecho sem etapa no funil: %', s_falta; end if;

  if (select count(*) from public.stages s join public.pipelines p on p.id = s.pipeline_id
       where s.is_entry and s.position = 1) <> 2 then
    raise exception 'seed imova: cada funil precisa de uma etapa de entrada na posição 1';
  end if;
  if exists (select 1 from public.stages where position < 0) then
    raise exception 'seed imova: há etapas fora da lista (posição negativa)';
  end if;

  -- Nada com cara de KOMUNE ligado.
  if exists (select 1 from public.message_templates
              where is_active and body ~* 'komune|helo[ií]sa|aplicativo de eventos') then
    raise exception 'seed imova: há modelo de mensagem ativo falando da KOMUNE';
  end if;
  if (select (value ->> 'ativo')::boolean from public.app_settings where key = 'whatsapp.bot_de_entrada')
     or (select (value ->> 'ativo')::boolean from public.app_settings where key = 'voz.aviso_nao_atendeu')
     or (select (value ->> 'introducao_ativa')::boolean from public.app_settings where key = 'atendimento') then
    raise exception 'seed imova: automação de WhatsApp com texto da KOMUNE ainda ligada';
  end if;

  raise notice 'seed imova ok: % categorias, % funis, % motivos de perda, % desfechos, % feriados em % e % em %, roteiro imova_v1 publicado sem erro',
    n_cat, n_pipe, n_lost, n_out, n_hol, ano, n_hol1, ano + 1;
end $$;

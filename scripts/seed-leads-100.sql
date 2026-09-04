-- =====================================================================
-- KOMUNE CRM — carga da lista-semente do R09 (100 leads reais de Natal/RN)
--
-- O QUE É
--   Carrega 100 parceiros REAIS extraídos da pesquisa de mercado do R09 para dentro
--   do CRM: 50 fornecedores (funil 1 — Captação de fornecedor) e 50 produtores,
--   cerimonialistas e empresas de formatura (funil 3 — Produtor e cerimonialista).
--   Cada registro vira uma organização + sua categoria primária + um negócio na
--   primeira etapa do funil + uma atividade de sistema registrando a origem.
--
-- DE ONDE VEIO
--   docs/anexos/R09-mercado-natal.md
--     · seção B — lista-semente de fornecedores por categoria (bairro, telefone, nota)
--     · seção D — produtores, cerimonialistas e empresas de formatura
--   A coluna `fonte_r09` de cada linha guarda a referência exata dentro do R09
--   (seção, item e diretório de origem: CB = Casamentos.com.br, OE = Organizando
--   Eventos, TP = TelefoneParaTodos, SOS = StarOfService, LB = Localizabrasil,
--   Solutudo). Esse texto é copiado para organizations.custom->>'secao_r09'.
--
-- REGRA DE OURO
--   Só nomes, telefones e bairros que ESTÃO ESCRITOS no R09. Nada foi inventado.
--   Registro sem telefone no R09 entra com phone_e164 NULL e recebe a marca
--   custom->>'sem_telefone_no_r09' = true. Telefone antigo de 8 dígitos (que o
--   app.normalize_phone_br completa com o nono dígito) recebe a marca
--   custom->>'telefone_8_digitos_confirmar' = true — precisa de confirmação humana.
--
-- PROVENIÊNCIA (RF-BAS-10)
--   source  = 'planilha' (a própria seed descreve essa origem como "planilha atual
--             da equipe e lista-semente do R09 §B, importadas pela esteira unificada")
--   source_url  = docs/anexos/R09-mercado-natal.md
--   collected_at = now(); collector = 'pesquisa R09'
--
-- DECISÕES
--   · kind vem do tipo do R09: fornecedor, produtor ou cerimonialista.
--   · Funil: fornecedor e espaco -> 'fornecedor'; produtor e cerimonialista -> 'produtor'.
--   · Etapa: o funil 1 tem 'Prospectado' (slug prospectado); o funil 3 NÃO tem etapa
--     com esse nome — a primeira etapa dele é 'Identificado' (slug identificado), que
--     é a posição 1 equivalente. Usamos a primeira etapa de cada funil.
--   · owner_id fica NULL de propósito: a triagem distribui depois.
--   · next_action = 'Primeiro contato'; next_action_at = próximo dia útil às 09:00
--     (America/Fortaleza) por app.next_business_day — mesmo padrão do RPC de cadastro.
--   · tier e score ficam NULL: a pontuação do Radar é entrega do D4.
--   · is_natural_person = true só quando o nome é evidentemente o de uma pessoa
--     (nome + sobrenome de gente, com ou sem sufixo de profissão). Nome de marca com
--     apelido ou só primeiro nome não conta como evidente e fica false.
--
-- IDEMPOTENTE
--   Rodar duas vezes não duplica nada. A chave natural é o telefone normalizado
--   quando existe; quando não existe, o nome normalizado (app.search_name) + cidade.
--   Categorias e negócios usam "on conflict do nothing" nas chaves únicas reais;
--   a atividade de sistema usa "where not exists" no corpo da mensagem.
--
-- COMO APLICAR
--   local:   docker exec -i supabase_db_komune-crm psql -U postgres -d postgres \
--              -v ON_ERROR_STOP=1 -f - < scripts/seed-leads-100.sql
--   remoto:  psql pelo pooler de sessão (aws-0-sa-east-1.pooler.supabase.com:5432,
--            usuário postgres.<project_ref>) com o mesmo arquivo.
-- =====================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------
-- 1. Os 100 registros, exatamente como estão no R09.
-- ---------------------------------------------------------------------
create temporary table _r09_leads (
  ord            int primary key,
  nome           text not null,
  kind           text not null,     -- app.org_kind
  categoria_slug text not null,     -- public.categories.slug
  cidade         text not null,     -- public.cities.name
  bairro         text,
  telefone_r09   text,              -- como escrito no R09; NULL = não há telefone no R09
  instagram      text,
  nota           numeric(3,2),
  avaliacoes     int,
  pessoa_fisica  boolean not null default false,
  fonte_r09      text not null
) on commit drop;

insert into _r09_leads
  (ord, nome, kind, categoria_slug, cidade, bairro, telefone_r09, instagram, nota, avaliacoes, pessoa_fisica, fonte_r09)
values
-- ---------- Fornecedores (funil 1) — R09 seção B ----------
-- B.1 Alimentos e bebidas
  (  1, 'Neuma Leão Buffet e Decoração',          'fornecedor', 'buffet_adulto_corporativo',           'Natal', 'Morro Branco',        '(84) 3234-4824',  null,               4.70,    7, false, 'B.1 buffet adulto/casamento/corporativo, item 12 (CB + TP)'),
  (  2, 'Anne Vieira Buffet e Eventos',           'fornecedor', 'buffet_adulto_corporativo',           'Natal', 'Capim Macio',         '(84) 99645-6054', null,               null, null, false, 'B.1 buffet adulto, item 4 (CB + TP)'),
  (  3, 'Jôsy Buffet',                            'fornecedor', 'buffet_adulto_corporativo',           'Natal', 'Tirol',               '(84) 3663-5857',  '@josybuffetnatal', null, null, false, 'B.1 buffet adulto, item 9 (site próprio + CB + SOS)'),
  (  4, 'Império Festas e Gráficas',              'fornecedor', 'buffet_adulto_corporativo',           'Natal', 'Alecrim',             '(84) 98830-1655', null,               4.40, null, false, 'B.1 buffet adulto, item 20 (TP)'),
  (  5, 'Espetto & Grill Churrasco Buffet',       'fornecedor', 'churrasqueiro_espetinho_food_truck',  'Natal', null,                  '(84) 99650-9784', null,               4.90,    3, false, 'B.1 churrasqueiros/espetinhos, item 2 (CB + OE)'),
  (  6, 'Churrascos S/A',                         'fornecedor', 'churrasqueiro_espetinho_food_truck',  'Natal', null,                  '(84) 99993-7321', null,               null, null, false, 'B.1 churrasqueiros/espetinhos, item 8 (OE; endereço Rua Fabio Rino 1088, sem bairro no R09)'),
  (  7, 'Nupalito buffet de espetinhos',          'fornecedor', 'churrasqueiro_espetinho_food_truck',  'Natal', null,                  '(84) 3661-4448',  null,               null, null, false, 'B.1 churrasqueiros/espetinhos, item 5 (OE)'),
  (  8, 'Bar Service Coquetéis / Caipifrutas',    'fornecedor', 'bar_drinks_chopp',                    'Natal', null,                  '(84) 3201-0796',  null,               5.00,    2, false, 'B.1 bar, drinks, bartenders, item 1 (CB + OE)'),
  (  9, 'Natal Cocktails',                        'fornecedor', 'bar_drinks_chopp',                    'Natal', null,                  '(84) 99126-1802', null,               null, null, false, 'B.1 bar, drinks, bartenders, item 6 (OE; Av. Prof. Olavo Montenegro 2843)'),
  ( 10, 'JR Doces e Salgados',                    'fornecedor', 'doces_bolos_confeitaria',             'Natal', 'Cidade Nova',         '(84) 99976-4366', null,               null, null, false, 'B.1 doces, bolos e confeitaria, item 8 (TP)'),
  ( 11, 'Vovó Isa Biscoitos Artesanais',          'fornecedor', 'doces_bolos_confeitaria',             'Natal', 'Lagoa Nova',          '(84) 98606-0207', null,               null, null, false, 'B.1 doces, bolos e confeitaria, item 9 (Solutudo)'),
  ( 12, 'Castelo Forte Festas',                   'fornecedor', 'buffet_infantil_casa_de_festas',      'Natal', 'Pajuçara',            '(84) 99143-6258', null,               4.60, null, false, 'B.1 buffet infantil, item 9 (TP; WhatsApp alternativo (84) 98730-2102)'),
  ( 13, 'Abracadabra Festas',                     'fornecedor', 'buffet_infantil_casa_de_festas',      'Natal', 'Tirol',               '(84) 99133-5463', null,               null, null, false, 'B.1 buffet infantil, item 1 (site próprio; Av. Romualdo Galvão 619)'),
-- B.2 Infraestrutura
  ( 14, 'WSOM Natal',                             'fornecedor', 'som_iluminacao_dj_estrutura',         'Natal', null,                  '(84) 98897-8074', '@wsomnatal',       4.90, null, false, 'B.2 som e iluminação/DJ com estrutura, item 1 (site próprio + OE; R09 diz "100+ aval.", número exato não informado)'),
  ( 15, 'DJ Zone Natal RN',                       'fornecedor', 'som_iluminacao_dj_estrutura',         'Natal', 'Cidade da Esperança', '(84) 8729-9090',  null,               null, null, false, 'B.2 som e iluminação, item 2 (OE; telefone de 8 dígitos, confirmar)'),
  ( 16, 'NatalSom Sonorização',                   'fornecedor', 'som_iluminacao_dj_estrutura',         'Natal', null,                  '(84) 9975-5618',  null,               null, null, false, 'B.2 som e iluminação, item 3 (OE; telefone de 8 dígitos, confirmar)'),
  ( 17, 'Agência DJs Party Produções e Eventos',  'fornecedor', 'som_iluminacao_dj_estrutura',         'Natal', null,                  '(84) 9911-4453',  null,               null, null, false, 'B.2 som e iluminação, item 4 (OE; telefone de 8 dígitos, confirmar)'),
  ( 18, 'Estrutura FDL',                          'fornecedor', 'tendas_estruturas_palcos',            'Natal', null,                  '(84) 3643-3693',  null,               null, null, false, 'B.2 tendas, estruturas, palcos, item 5 (OE; alternativo (84) 98888-3981)'),
  ( 19, 'L & D Locações',                         'fornecedor', 'tendas_estruturas_palcos',            'Natal', 'Alecrim',             '(84) 98133-3570', null,               null, null, false, 'B.2 tendas, estruturas, palcos, item 9 (OE)'),
  ( 20, 'Tenda Gazebo Flash',                     'fornecedor', 'tendas_estruturas_palcos',            'Natal', null,                  '(84) 9930-0780',  null,               null, null, false, 'B.2 tendas, estruturas, palcos, item 2 (OE + SOS; Av. Praia de Pirangi 2278)'),
  ( 21, 'Mesas e Festas',                         'fornecedor', 'mobiliario_loucas_utensilios',        'Natal', null,                  '(84) 99902-9509', null,               null, null, false, 'B.2 mobiliário, mesas/cadeiras, louças, utensílios, item 1 (OE)'),
  ( 22, 'Anima Mix Festas Infantis',              'fornecedor', 'mobiliario_loucas_utensilios',        'Natal', null,                  '(84) 98762-7891', null,               null, null, false, 'B.2 mobiliário, item 3 (OE + SOS; mesas, toalhas, tendas; também citado em B.5 recreadores, entrou uma vez só)'),
  ( 23, 'Mundo das Festas Ltda',                  'fornecedor', 'mobiliario_loucas_utensilios',        'Natal', 'Capim Macio',         '(84) 3214-5680',  null,               null, null, false, 'B.2 mobiliário, item 6 (Solutudo)'),
  ( 24, 'New Vision Projetores',                  'fornecedor', 'audiovisual_led_geradores_banheiros', 'Natal', null,                  '(84) 3222-5394',  null,               null, null, false, 'B.2 painel de LED, projeção, audiovisual, item 1 (OE; Av. Coronel Estevam 1480 sala 20)'),
  ( 25, 'Potiban Banheiros Químicos',             'fornecedor', 'audiovisual_led_geradores_banheiros', 'Natal', null,                  '(84) 99143-4333', null,               null, null, false, 'B.2 banheiros químicos, item 1 (OE; Av. Romualdo Galvão)'),
-- B.3 Serviços
  ( 26, 'Costa Prado Fotografia',                 'fornecedor', 'fotografia_video',                    'Natal', null,                  null,              null,               4.90,   17, false, 'B.3 fotografia, item 1 (CB; a partir de R$2.200)'),
  ( 27, 'Junior Barreto Photographer',            'fornecedor', 'fotografia_video',                    'Natal', null,                  null,              null,               5.00,    9, true,  'B.3 fotografia, item 2 (CB; R$5.000)'),
  ( 28, 'Wellington Fugisse',                     'fornecedor', 'fotografia_video',                    'Natal', null,                  null,              null,               5.00,    9, true,  'B.3 fotografia, item 3 (CB; R$2.000)'),
  ( 29, 'Su Lopes Fotografia',                    'fornecedor', 'fotografia_video',                    'Natal', null,                  null,              null,               5.00,    8, true,  'B.3 fotografia, item 4 (CB; R$4.550)'),
  ( 30, 'Filmart Filmagem de Eventos',            'fornecedor', 'fotografia_video',                    'Natal', null,                  '(84) 3231-2956',  null,               null, null, false, 'B.3 filmagem, item 5 (OE; Rua Tuiuti)'),
  ( 31, 'RL Short Films',                         'fornecedor', 'fotografia_video',                    'Natal', null,                  null,              null,               5.00,   12, false, 'B.3 filmagem, item 1 (CB; R$2.500)'),
  ( 32, 'Vitória Produções',                      'fornecedor', 'decoracao_flores',                    'Natal', null,                  '(84) 99822-5846', null,               4.90,   10, false, 'B.3 decoração e flores, item 2 (CB + TP)'),
  ( 33, 'Conto de Fadas Festas e Eventos',        'fornecedor', 'decoracao_flores',                    'Natal', null,                  '(84) 3234-3786',  null,               null, null, false, 'B.3 decoração e flores, item 10 (OE)'),
  ( 34, 'Goettems Decor',                         'fornecedor', 'decoracao_flores',                    'Natal', null,                  null,              null,               5.00,   34, false, 'B.3 decoração e flores, item 1 (CB)'),
  ( 35, 'Carmem Pradella',                        'fornecedor', 'djs_bandas_musicos',                  'Natal', 'Tirol',               '(84) 99921-2464', null,               5.00,   47, true,  'B.3 bandas, músicos e cantores, item 1 (CB + OE; R$1.500)'),
  ( 36, 'DJ Done',                                'fornecedor', 'djs_bandas_musicos',                  'Natal', null,                  '(84) 99993-3831', null,               null, null, false, 'B.3 DJs, item 7 (OE)'),
  ( 37, 'Diego Araújo Violinista',                'fornecedor', 'djs_bandas_musicos',                  'Natal', null,                  null,              null,               5.00,    9, true,  'B.3 bandas, músicos e cantores, item 2 (CB; R$500)'),
-- B.4 Locais
  ( 38, 'Império Recepções',                      'fornecedor', 'locais_saloes_chacaras_hoteis',       'Natal', 'Potengi',             '(84) 98808-8201', null,               4.80,    9, false, 'B.4 salões e casas de recepção, item 2 (CB + Solutudo; R$55/pessoa, 80–180)'),
  ( 39, 'Grupo Eden Recepções',                   'fornecedor', 'locais_saloes_chacaras_hoteis',       'Natal', 'Candelária',          '(84) 3217-6010',  null,               4.90,    8, false, 'B.4 salões e casas de recepção, item 3 (CB + Solutudo; R$80/pessoa, 30–300)'),
  ( 40, 'Rios Recepções',                         'fornecedor', 'locais_saloes_chacaras_hoteis',       'Natal', 'Potengi',             '(84) 3662-1972',  null,               null, null, false, 'B.4 salões e casas de recepção, item 5 (CB; WhatsApp (84) 98875-5575)'),
  ( 41, 'Macamirim Eventos',                      'fornecedor', 'locais_saloes_chacaras_hoteis',       'Natal', null,                  null,              null,               4.90,   64, false, 'B.4 salões e casas de recepção, item 1 (CB; a partir de R$6.900, 2–1.000 convidados; sem telefone no R09)'),
  ( 42, 'Chácara Alvorada',                       'fornecedor', 'locais_saloes_chacaras_hoteis',       'Natal', null,                  null,              null,               4.80,   10, false, 'B.4 chácaras, sítios, fazendas (CB; sem telefone no R09)'),
  ( 43, 'Por Amor Recepções',                     'fornecedor', 'locais_saloes_chacaras_hoteis',       'Extremoz', null,               null,              null,               4.60,   18, false, 'B.4 chácaras, sítios, fazendas (CB RN; Extremoz, a partir de R$2.600, 2–500; sem telefone no R09)'),
  ( 44, 'Tábua de Carne',                         'fornecedor', 'locais_saloes_chacaras_hoteis',       'Natal', null,                  null,              null,               5.00,   11, false, 'B.4 restaurantes para eventos (CB; R$68/pessoa, 20–500; sem telefone no R09)'),
  ( 45, 'Vila do Mar',                            'fornecedor', 'locais_saloes_chacaras_hoteis',       'Natal', null,                  null,              null,               4.70,    8, false, 'B.4 hotéis e pousadas (CB; sem telefone no R09)'),
-- B.5 Recreação
  ( 46, 'Hora do Lazer Recreação',                'fornecedor', 'recreadores_animadores',              'Natal', 'Candelária',          '(84) 99927-2577', null,               null, null, false, 'B.5 recreadores/animadores (OE)'),
  ( 47, 'Turma X Entretenimento (Tio Xulê)',      'fornecedor', 'recreadores_animadores',              'Natal', null,                  '(84) 99964-7723', null,               null, null, false, 'B.5 recreadores/animadores (OE; alternativo (84) 3608-0696)'),
  ( 48, 'Brinkolândia Festas',                    'fornecedor', 'locacao_brinquedos_inflaveis',        'Natal', 'Pitimbu',             '(84) 98701-9052', null,               null, null, false, 'B.5 locação de brinquedos/infláveis, item 1 (LB + OE; Pitimbu/Parque das Colinas)'),
  ( 49, 'Feliz Niver Festas',                     'fornecedor', 'locacao_brinquedos_inflaveis',        'Natal', 'Nazaré',              '(84) 98867-5192', null,               4.90, null, false, 'B.5 locação de brinquedos/infláveis, item 10 (TP)'),
  ( 50, 'Brincadeira de Criança',                 'fornecedor', 'locacao_brinquedos_inflaveis',        'Natal', 'Pajuçara',            '(84) 99946-9867', null,               null, null, false, 'B.5 locação de brinquedos/infláveis, item 6 (LB; brinquedos + estações gourmet)'),

-- ---------- Produtoras corporativas e organizadores (funil 3) — R09 seção D.3 ----------
  ( 51, 'i9 Produções & Eventos',                 'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  '(84) 4141-3203',  null,               null, null, false, 'D.3 produtoras (OE) — Av. Nascimento de Castro 1245; palcos, tendas, som, geradores'),
  ( 52, 'Agito Produções',                        'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  '(84) 8856-8426',  null,               null, null, false, 'D.3 produtoras (OE)'),
  ( 53, 'Espaço ZR Produções e Eventos',          'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  '(84) 99634-1773', null,               null, null, false, 'D.3 produtoras (OE) — Rua Potengi 393; segundo telefone (84) 3033-1933'),
  ( 54, 'D&R Eventos e Produções',                'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  '(84) 99607-5539', null,               null, null, false, 'D.3 produtoras (OE/SOS)'),
  ( 55, 'Status Produções',                       'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  null,              null,               null, null, false, 'D.3 produtoras — StarOfService (corporativo); sem telefone no R09'),
  ( 56, 'Innova Marketing e Eventos',             'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  '(84) 99973-9773', null,               null, null, false, 'D.3 produtoras (StarOfService, como Innova Eventos) + D.2 item 19 (OE + SOS), de onde vem o telefone'),
  ( 57, 'Mega Eventos',                           'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  null,              null,               null, null, false, 'D.3 produtoras — StarOfService (corporativo); sem telefone no R09'),
  ( 58, 'Idearte Entretenimento',                 'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Candelária',          '(84) 99414-0366', null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal)'),
  ( 59, 'Loop Cria Entretenimento',               'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Ponta Negra',         '(84) 3025-2526',  null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal)'),
  ( 60, 'Frisson Eventos',                        'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Ribeira',             '(84) 98144-9896', null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal); também aparece em B.4 locais'),
  ( 61, 'Casei Marketing e Eventos',              'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Lagoa Nova',          '(84) 3204-6500',  null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal)'),
  ( 62, 'Morais Eventos',                         'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Lagoa Nova',          '(84) 99811-3010', null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal)'),
  ( 63, 'Maré Produções e Eventos',               'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Lagoa Nova',          null,              null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal); sem telefone no R09'),
  ( 64, 'LM Produções e Serviços',                'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Bom Pastor',          '(84) 3223-2192',  null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal)'),
  ( 65, 'RPD Serviços e Entretenimento',          'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Tirol',               '(84) 99406-0049', null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal)'),
  ( 66, 'MG Promoções e Eventos',                 'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Candelária',          '(84) 99200-4666', null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal)'),
  ( 67, 'Pos-Doc Eventos',                        'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Tirol',               '(84) 99972-7739', null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal)'),
  ( 68, 'Agência Rocas',                          'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  '(84) 3222-1198',  null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal); sem bairro no R09'),
  ( 69, 'HF Entretenimento',                      'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Lagoa Nova',          null,              null,               null, null, false, 'D.3 produtoras — Solutudo (CNPJ, Natal); sem telefone no R09'),
  ( 70, 'JB Comunicações',                        'produtor', 'produtoras_corporativas_organizadores', 'Natal', 'Lagoa Nova',          '(84) 99102-4602', null,               4.90, null, false, 'D.3 produtoras — TelefoneParaTodos (TP), nota 4,9'),
  ( 71, 'Clap Entretenimento',                    'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  null,              null,               null, null, false, 'D.3 produtoras — organização do Carnatal 35 (4 a 6/12/2026); sem telefone no R09'),
  ( 72, 'Vybbe',                                  'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  null,              null,               null, null, false, 'D.3 produtoras — organização do Carnatal 35 (4 a 6/12/2026); sem telefone no R09'),
  ( 73, 'RB Entretenimento',                      'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  null,              null,               null, null, false, 'D.3 produtoras — organização do Carnatal 35 (4 a 6/12/2026); sem telefone no R09'),
  ( 74, 'AE Mkt Promotion',                       'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  null,              null,               null, null, false, 'D.3 produtoras — StarOfService (corporativo); sem telefone no R09'),
  ( 75, 'Estratégias Eventos e Serviços',         'produtor', 'produtoras_corporativas_organizadores', 'Natal', null,                  null,              null,               null, null, false, 'D.3 produtoras — StarOfService (corporativo); sem telefone no R09'),

-- ---------- Empresas de formatura (funil 3) — R09 seção D.1 ----------
  ( 76, 'Z2 Eventos e Cerimonial',                'produtor', 'empresas_formatura',                    'Natal', 'Capim Macio',         '(84) 99438-7681', '@z2eventos',       null, null, false, 'D.1 empresas de formatura (site próprio + CB) — Rua Gustavo Guedes 1857; fixo (84) 3346-1506; formaturas UnP e Estácio'),
  ( 77, 'Gideon Formaturas e Eventos',            'produtor', 'empresas_formatura',                    'Natal', null,                  '(84) 3213-5400',  null,               null, null, false, 'D.1 empresas de formatura (OE, site inacessível) — Village dos Mares / Rua José Seabra; segundo número antigo (84) 8836-8908'),
  ( 78, 'Best Story Formaturas',                  'produtor', 'empresas_formatura',                    'Natal', null,                  '(84) 99944-9374', null,               null, null, false, 'D.1 empresas de formatura (TP)'),
  ( 79, 'CB Formaturas',                          'produtor', 'empresas_formatura',                    'Natal', null,                  null,              null,               null, null, false, 'D.1 empresas de formatura (CB) — perfil de fotografia em Natal, orçamento sob consulta; sem telefone no R09'),
  ( 80, 'M3TA',                                   'produtor', 'empresas_formatura',                    'Natal', null,                  null,              null,               null, null, false, 'D.1 empresas de formatura — citada na reunião, NÃO LOCALIZADA em nenhuma fonte acessível (site fora do ar, 0 notícias); confirmar por Instagram antes de prospectar; sem telefone e sem endereço no R09'),

-- ---------- Cerimonialistas e assessorias (funil 3) — R09 seção D.2 ----------
  ( 81, 'Triunfal Cerimonial e Eventos',          'cerimonialista', 'cerimonialistas_assessorias',     'Natal', null,                  '(84) 99990-8786', null,               4.90,   89, false, 'D.2 cerimonialistas #1 (CB + OE + SOS) — Shopping Lagoa Center; a partir de R$ 4.300'),
  ( 82, 'Alfa Cerimonial e Assessoria',           'cerimonialista', 'cerimonialistas_assessorias',     'Natal', null,                  null,              null,               4.90,   58, false, 'D.2 cerimonialistas #2 (CB) — a partir de R$ 2.000; sem telefone no R09'),
  ( 83, 'Infinity Cerimonial e Assessoria',       'cerimonialista', 'cerimonialistas_assessorias',     'Natal', null,                  null,              null,               5.00,   41, false, 'D.2 cerimonialistas #3 (CB) — a partir de R$ 1.300; sem telefone no R09'),
  ( 84, 'Cerimonial Odineide Melo',               'cerimonialista', 'cerimonialistas_assessorias',     'Natal', null,                  null,              null,               4.60,    8, true,  'D.2 cerimonialistas #4 (CB) — a partir de R$ 1.000; sem telefone no R09'),
  ( 85, 'Sonhos Cerimonial & Eventos',            'cerimonialista', 'cerimonialistas_assessorias',     'Natal', null,                  '(84) 9922-0177',  null,               4.90,    7, false, 'D.2 cerimonialistas #5 (CB + OE + Lápis de Noiva) — endereço na Prudente de Morais; a partir de R$ 2.500'),
  ( 86, 'Felice Assessoria e Cerimonial',         'cerimonialista', 'cerimonialistas_assessorias',     'Macaíba', null,                null,              null,               5.00,    7, false, 'D.2 cerimonialistas #18 Grande Natal (CB RN) — a partir de R$ 2.500; sem telefone no R09'),
  ( 87, 'MS Cerimonial e Eventos',                'cerimonialista', 'cerimonialistas_assessorias',     'Natal', null,                  null,              null,               4.90,    6, false, 'D.2 cerimonialistas #6 (CB) — a partir de R$ 2.000; sem telefone no R09'),
  ( 88, 'Chris Cerimonial & Assessoria',          'cerimonialista', 'cerimonialistas_assessorias',     'Natal', null,                  null,              null,               4.90,    6, false, 'D.2 cerimonialistas #7 (CB) — a partir de R$ 1.300; sem telefone no R09'),
  ( 89, 'Grupo Feeling',                          'cerimonialista', 'cerimonialistas_assessorias',     'Natal', null,                  null,              null,               4.80,    4, false, 'D.2 cerimonialistas #8 (CB) — a partir de R$ 1.000; sem telefone no R09'),
  ( 90, 'LD Cerimonial & Eventos',                'cerimonialista', 'cerimonialistas_assessorias',     'Natal', null,                  null,              null,               5.00,    3, false, 'D.2 cerimonialistas #9 (CB) — a partir de R$ 1.500; sem telefone no R09'),
  ( 91, 'Ativa Cerimoniais',                      'cerimonialista', 'cerimonialistas_assessorias',     'Natal', 'Candelária',          '(84) 3231-0998',  null,               5.00,    2, false, 'D.2 cerimonialistas #10 (CB + TP) — grafada também como Ativa Assessoria e Cerimonial; a partir de R$ 2.000'),
  ( 92, 'Haydée Cerimonial & Eventos',            'cerimonialista', 'cerimonialistas_assessorias',     'Natal', 'Barro Vermelho',      '(84) 3222-9773',  null,               5.00,    1, false, 'D.2 cerimonialistas #11 (CB + TP) — a partir de R$ 1.897'),
  ( 93, 'Paulo Capistrano Cerimonial',            'cerimonialista', 'cerimonialistas_assessorias',     'Natal', null,                  null,              null,               5.00,    1, true,  'D.2 cerimonialistas #12 (CB) — a partir de R$ 1.800; sem telefone no R09'),
  ( 94, 'Perez Assessoria',                       'cerimonialista', 'cerimonialistas_assessorias',     'Natal', null,                  null,              null,               5.00,    1, false, 'D.2 cerimonialistas #13 (CB); sem telefone no R09'),
  ( 95, 'Geis Abreu Cerimonial',                  'cerimonialista', 'cerimonialistas_assessorias',     'São Gonçalo do Amarante', null, null,             null,               4.80,    1, true,  'D.2 cerimonialistas #18 Grande Natal (CB RN) — a partir de R$ 1.000; sem telefone no R09'),
  ( 96, 'Accord Cerimonial e Eventos',            'cerimonialista', 'cerimonialistas_assessorias',     'Natal', 'Cidade Satélite',     '(84) 3218-2906',  null,               null, null, false, 'D.2 cerimonialistas #15 (OE) — segundo número (84) 99102-2340'),
  ( 97, 'Plano Cerimonial & Eventos',             'cerimonialista', 'cerimonialistas_assessorias',     'Natal', 'Candelária',          '(84) 3234-5963',  null,               null, null, false, 'D.2 cerimonialistas #14 (CB)'),
  ( 98, 'M&R Eventos',                            'cerimonialista', 'cerimonialistas_assessorias',     'Natal', 'Capim Macio',         '(84) 98135-0565', null,               null, null, false, 'D.2 cerimonialistas #15 (OE)'),
  ( 99, 'Raissa Arruda Cerimonialista',           'cerimonialista', 'cerimonialistas_assessorias',     'Natal', 'Capim Macio',         '(84) 99960-8780', null,               null, null, true,  'D.2 cerimonialistas #15 (OE)'),
  (100, 'Celebrations Cerimonial e Eventos',      'cerimonialista', 'cerimonialistas_assessorias',     'Natal', 'Capim Macio',         '(84) 3219-0532',  null,               null, null, false, 'D.2 cerimonialistas #16 (TP)');

-- ---------------------------------------------------------------------
-- 2. Normalização e resolução dos catálogos (cidade, categoria, origem).
--    Aqui o telefone passa por app.normalize_phone_br (a mesma função do trigger),
--    para que a chave natural de dedup seja calculada antes do insert.
-- ---------------------------------------------------------------------
create temporary table _r09_norm on commit drop as
select
  l.ord,
  l.nome,
  l.kind::app.org_kind                                   as kind,
  l.categoria_slug,
  l.bairro,
  l.instagram,
  l.nota,
  l.avaliacoes,
  l.pessoa_fisica,
  l.fonte_r09,
  nullif(trim(coalesce(l.telefone_r09, '')), '')         as telefone_r09,
  ci.id                                                  as city_id,
  app.normalize_phone_br(nullif(trim(l.telefone_r09), '')) as phone_e164,
  app.search_name(l.nome)                                as search_name,
  -- Telefone antigo de 8 dígitos (DDD + 8 começando em 6–9): a função completa com o
  -- nono dígito, mas o número precisa de confirmação humana antes do primeiro contato.
  (   length(regexp_replace(coalesce(l.telefone_r09, ''), '\D', '', 'g')) = 10
  and substr(regexp_replace(coalesce(l.telefone_r09, ''), '\D', '', 'g'), 3, 1) between '6' and '9'
  )                                                      as telefone_8_digitos
from _r09_leads l
join public.cities ci on ci.name = l.cidade and ci.state = 'RN';

-- Conferências de integridade: nada entra pela metade.
do $$
declare n int;
begin
  select count(*) into n from _r09_norm;
  if n <> 100 then
    raise exception 'Esperava 100 linhas normalizadas, achei % (cidade não encontrada em public.cities?)', n;
  end if;

  select count(*) into n from _r09_leads l
   left join public.categories c on c.slug = l.categoria_slug where c.id is null;
  if n > 0 then
    raise exception '% categoria(s) da lista não existem em public.categories', n;
  end if;

  select count(*) into n from _r09_norm
   where telefone_r09 is not null and phone_e164 is null;
  if n > 0 then
    raise exception '% telefone(s) do R09 não passaram em app.normalize_phone_br', n;
  end if;

  select count(*) into n from (
    select phone_e164 from _r09_norm where phone_e164 is not null
    group by phone_e164 having count(*) > 1) t;
  if n > 0 then
    raise exception '% telefone(s) repetidos dentro da própria lista-semente', n;
  end if;

  if not exists (select 1 from public.sources where slug = 'planilha') then
    raise exception 'Origem "planilha" não existe em public.sources (rode a seed antes)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Organizações — insere só o que ainda não existe.
--    Chave natural: telefone normalizado quando há; nome normalizado + cidade quando não há.
-- ---------------------------------------------------------------------
insert into public.organizations (
  kind, name, phone_e164, instagram_handle, city_id, neighborhood,
  rating, reviews_count, source_id, source_url, collected_at, collector,
  is_natural_person, custom
)
select
  n.kind,
  n.nome,
  n.phone_e164,
  nullif(trim(coalesce(n.instagram, '')), ''),
  n.city_id,
  n.bairro,
  n.nota,
  n.avaliacoes,
  (select s.id from public.sources s where s.slug = 'planilha'),
  'docs/anexos/R09-mercado-natal.md',
  now(),
  'pesquisa R09',
  n.pessoa_fisica,
  jsonb_strip_nulls(jsonb_build_object(
    'lista_semente',                 'R09',
    'secao_r09',                     n.fonte_r09,
    'sem_telefone_no_r09',           case when n.phone_e164 is null then true end,
    'telefone_8_digitos_confirmar',  case when n.telefone_8_digitos then true end
  ))
from _r09_norm n
where not exists (
  select 1
    from public.organizations o
   where o.deleted_at is null
     and (
       (n.phone_e164 is not null and o.phone_e164 = n.phone_e164)
       or
       (n.phone_e164 is null and o.search_name = n.search_name
                             and o.city_id is not distinct from n.city_id)
     )
);

-- Amarra cada linha da lista à organização correspondente (nova ou já existente).
create temporary table _r09_org on commit drop as
select n.ord, n.kind, n.categoria_slug, o.id as organization_id
from _r09_norm n
join public.organizations o
  on o.deleted_at is null
 and (
   (n.phone_e164 is not null and o.phone_e164 = n.phone_e164)
   or
   (n.phone_e164 is null and o.search_name = n.search_name
                         and o.city_id is not distinct from n.city_id)
 );

do $$
declare n int;
begin
  select count(*) into n from _r09_org;
  if n <> 100 then
    raise exception 'Esperava 100 organizações resolvidas, achei %', n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Categoria primária (RF-BAS-02).
-- ---------------------------------------------------------------------
insert into public.organization_categories (organization_id, category_id, is_primary)
select r.organization_id, c.id,
       -- não rouba a primária de uma organização que já tenha uma
       not exists (select 1 from public.organization_categories oc
                    where oc.organization_id = r.organization_id and oc.is_primary)
from _r09_org r
join public.categories c on c.slug = r.categoria_slug
on conflict (organization_id, category_id) do nothing;

-- ---------------------------------------------------------------------
-- 5. Negócios — um por organização, na primeira etapa do funil certo.
--    Sem responsável (a triagem distribui). Tier e score ficam nulos (Radar é do D4).
-- ---------------------------------------------------------------------
insert into public.deals (
  organization_id, pipeline_id, stage_id, source_id, owner_id,
  next_action, next_action_at, tier, score
)
select
  r.organization_id,
  p.id,
  st.id,
  (select s.id from public.sources s where s.slug = 'planilha'),
  null,
  'Primeiro contato',
  ((app.next_business_day((now() at time zone 'America/Fortaleza')::date) + time '09:00')
     at time zone 'America/Fortaleza'),
  null,
  null
from _r09_org r
join public.pipelines p
  on p.slug = case when r.kind in ('produtor', 'cerimonialista') then 'produtor' else 'fornecedor' end
join public.stages st
  on st.pipeline_id = p.id
 and st.slug = case when p.slug = 'produtor' then 'identificado' else 'prospectado' end
on conflict (organization_id, pipeline_id) do nothing;

-- ---------------------------------------------------------------------
-- 6. Atividade de sistema registrando a origem (RF-BAS-06).
-- ---------------------------------------------------------------------
insert into public.activities (
  type, organization_id, deal_id, user_id, author_kind, occurred_at, body, metadata
)
select
  'system',
  r.organization_id,
  (select d.id from public.deals d where d.organization_id = r.organization_id
    order by d.created_at, d.id limit 1),
  null,
  'system',
  now(),
  'Importado da lista-semente da pesquisa R09',
  jsonb_build_object(
    'origem',     'lista_semente_r09',
    'fonte',      'docs/anexos/R09-mercado-natal.md',
    'secao_r09',  n.fonte_r09,
    'collector',  'pesquisa R09'
  )
from _r09_org r
join _r09_norm n on n.ord = r.ord
where not exists (
  select 1 from public.activities a
   where a.organization_id = r.organization_id
     and a.type = 'system'
     and a.body = 'Importado da lista-semente da pesquisa R09'
);

commit;

-- ---------------------------------------------------------------------
-- 7. Conferência (o mesmo relatório pedido: por tipo, por categoria, com/sem telefone).
-- ---------------------------------------------------------------------
\echo '--- lista-semente R09: total por tipo (kind) ---'
select o.kind::text as tipo, count(*) as total
  from public.organizations o
 where o.collector = 'pesquisa R09' and o.deleted_at is null
 group by 1 order by 2 desc, 1;

\echo '--- lista-semente R09: total por categoria primaria ---'
select c.slug as categoria, c.name as nome_categoria, count(*) as total
  from public.organizations o
  join public.organization_categories oc on oc.organization_id = o.id and oc.is_primary
  join public.categories c on c.id = oc.category_id
 where o.collector = 'pesquisa R09' and o.deleted_at is null
 group by 1, 2 order by 3 desc, 1;

\echo '--- lista-semente R09: telefone presente x ausente ---'
select case when o.phone_e164 is null then 'sem telefone' else 'com telefone' end as situacao,
       count(*) as total
  from public.organizations o
 where o.collector = 'pesquisa R09' and o.deleted_at is null
 group by 1 order by 1;

\echo '--- lista-semente R09: negocios por funil e etapa ---'
select p.slug as funil, st.name as etapa, count(*) as total
  from public.deals d
  join public.organizations o on o.id = d.organization_id
  join public.pipelines p on p.id = d.pipeline_id
  join public.stages st on st.id = d.stage_id
 where o.collector = 'pesquisa R09' and o.deleted_at is null
 group by 1, 2 order by 1, 2;

\echo '--- lista-semente R09: totais gerais ---'
select
  (select count(*) from public.organizations where collector = 'pesquisa R09' and deleted_at is null) as organizacoes,
  (select count(*) from public.organization_categories oc
     join public.organizations o on o.id = oc.organization_id
    where o.collector = 'pesquisa R09')                                                              as categorias,
  (select count(*) from public.deals d
     join public.organizations o on o.id = d.organization_id
    where o.collector = 'pesquisa R09')                                                              as negocios,
  (select count(*) from public.activities a
     join public.organizations o on o.id = a.organization_id
    where o.collector = 'pesquisa R09' and a.type = 'system')                                        as atividades;

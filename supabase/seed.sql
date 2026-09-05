-- =====================================================================
-- KOMUNE CRM — seed v0.1 (D1) — catálogos, funis/etapas, feriados, modelos de
-- mensagem e controle de acesso ao login.
--
-- Aplicada após as migrações em `supabase db reset` (config.toml: [db.seed]).
-- IDEMPOTENTE: cada bloco faz upsert pela chave natural (slug, nome+UF, data+escopo,
-- template_code, e-mail...). Reaplicar não duplica nem apaga o que a operação já
-- alterou nos campos que a seed não governa (ex.: categories.komune_category_key,
-- sources.config depois de configurado, message_templates.meta_status = 'approved').
-- Em compensação, stages.required_fields/automations e sources.is_enabled/rate_limit_seconds
-- SÃO governados pela seed e voltam ao padrão a cada reaplicação: são a definição do produto
-- (PRD §5.3–§5.5) enquanto o motor de automações (D5–D7) e a tela de administração (RF-ADM-02)
-- não existem. Quando existirem, aplicar aqui o mesmo padrão de preservação de sources.config.
--
-- Fontes de verdade: PRD v1.0 (§5 funis e §5.6 temperatura; §7.1 RF-BAS-10; §7.3
-- RF-FUN-04/05; §7.4 RF-CON-11/12/13/21; §7.9 RF-ADM-01/02; §10.7; Apêndices B, C, F),
-- R03 §1–2 (fontes), R06 §C (textos LGPD), R08 §2–4 (playbook), R09 §E (categorias).
-- Quando o R08 e o PRD divergem, vale o PRD (ex.: link de privacidade e SAIR na abertura).
--
-- Roda como superusuário (postgres) fora da API: auth.uid() = null, app.role() = leitura;
-- os triggers de auditoria registram actor_id nulo (= sistema).
-- =====================================================================

set client_encoding = 'UTF8';
set timezone = 'America/Fortaleza';

-- =====================================================================
-- 1. Cidades (chave natural: name + state). ibge_code = código IBGE de 7 dígitos,
--    conferido na API de localidades do IBGE (estado 24). Grande Natal = is_metro_natal
--    (R09; PRD Apêndice F). "Açu" é grafada "Assú" no IBGE; aqui usamos a grafia corrente.
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
-- 2. Categorias — as 19 do PRD Apêndice F (16 de fornecedores em 5 grupos + 3 de
--    produtores), nome exatamente como na tabela, position na ordem da tabela,
--    priority = onda (P1 = 1, P2 = 2, P3 = 3).
--    komune_category_key fica NULL de propósito: o mapeamento para a taxonomia do app
--    Komune é feito no D9 (pré-cadastro), com Matheus; o upsert não sobrescreve o valor
--    quando ele já tiver sido preenchido.
-- =====================================================================
insert into public.categories (slug, name, "group", priority, position, komune_category_key, is_active) values
  -- Alimentos & Bebidas
  ('buffet_adulto_corporativo',            'Buffet adulto/corporativo',                                      'alimentos_bebidas', 1,  1, null, true),
  ('churrasqueiro_espetinho_food_truck',   'Churrasqueiro, espetinho, food truck',                           'alimentos_bebidas', 1,  2, null, true),
  ('bar_drinks_chopp',                     'Bar, drinks, chopp',                                             'alimentos_bebidas', 1,  3, null, true),
  ('doces_bolos_confeitaria',              'Doces, bolos, confeitaria',                                      'alimentos_bebidas', 2,  4, null, true),
  ('buffet_infantil_casa_de_festas',       'Buffet infantil / casa de festas infantil',                      'alimentos_bebidas', 2,  5, null, true),
  -- Infraestrutura
  ('som_iluminacao_dj_estrutura',          'Som, iluminação e DJ com estrutura',                             'infraestrutura',    1,  6, null, true),
  ('tendas_estruturas_palcos',             'Tendas, estruturas, palcos',                                     'infraestrutura',    1,  7, null, true),
  ('mobiliario_loucas_utensilios',         'Mobiliário, louças, utensílios',                                 'infraestrutura',    1,  8, null, true),
  ('audiovisual_led_geradores_banheiros',  'Audiovisual/LED, geradores, banheiros químicos',                 'infraestrutura',    2,  9, null, true),
  -- Serviços
  ('fotografia_video',                     'Fotografia e vídeo',                                             'servicos',          1, 10, null, true),
  ('djs_bandas_musicos',                   'DJs, bandas e músicos',                                          'servicos',          2, 11, null, true),
  ('decoracao_flores',                     'Decoração e flores',                                             'servicos',          2, 12, null, true),
  ('celebrante_beleza_convites_staff',     'Celebrante, beleza, convites, transfer, segurança, staff',       'servicos',          3, 13, null, true),
  -- Locais
  ('locais_saloes_chacaras_hoteis',        'Locais: salões, chácaras, hotéis, restaurantes, praia',          'locais',            1, 14, null, true),
  -- Recreação
  ('recreadores_animadores',               'Recreadores e animadores',                                       'recreacao',         2, 15, null, true),
  ('locacao_brinquedos_inflaveis',         'Locação de brinquedos e infláveis',                              'recreacao',         2, 16, null, true),
  -- Produtores (Funil 3)
  ('cerimonialistas_assessorias',          'Cerimonialistas / assessorias',                                  'producao',          1, 17, null, true),
  ('empresas_formatura',                   'Empresas de formatura',                                          'producao',          1, 18, null, true),
  ('produtoras_corporativas_organizadores','Produtoras corporativas/shows e organizadores recorrentes',      'producao',          2, 19, null, true)
on conflict (slug) do update
  set name      = excluded.name,
      "group"   = excluded."group",
      priority  = excluded.priority,
      position  = excluded.position,
      is_active = excluded.is_active;
      -- komune_category_key: preservado (mapeamento do D9).

-- =====================================================================
-- 3. Origens / fontes (RF-BAS-10, RF-RAD-01; PRD §10.2 e Apêndice B; R03 §1–2; R06 §2).
--    Cada linha é também o registro da operação de tratamento da fonte: base legal,
--    resumo dos termos de uso, robots e limite de requisições.
--    legal_basis = 'legitimo_interesse' (LGPD art. 7º, IX e art. 10) sobre dados de
--    contato profissional tornados manifestamente públicos pelo titular (art. 7º, §4º):
--    dispensa consentimento, não dispensa finalidade, transparência, minimização e opt-out.
--    is_enabled = a fonte pode ser usada como origem no CRM; o estado do COLETOR
--    automático fica em config.collector (phase mvp/v1, enabled).
--    kind 'referral' => Tier A+ no cadastro rápido (RF-BAS-15).
--
--    GetNinjas NÃO entra neste catálogo (CLAUDE.md: "GetNinjas está fora das fontes";
--    PRD §10.2, Apêndice B, Apêndice E SCR-06). A versão anterior da seed a cadastrava com
--    is_enabled = false "para que ninguém a habilite por engano" — mas a linha existir é o
--    próprio risco: sources é catálogo configurável (RF-ADM-02) e um clique de admin/gestor em
--    is_enabled a tornava origem válida, além de aparecer nos selects da UI e da importação.
--    A proibição fica onde é lida por gente: CLAUDE.md, PRD §10.2 e docs/anexos/R03.
--    (O uso permitido continua sendo leitura MANUAL como sinal de demanda por categoria/bairro
--    para priorizar prospecção — nada automatizado, nenhum dado importado para o CRM.)
-- =====================================================================
insert into public.sources (slug, name, kind, base_url, legal_basis, terms_notes, robots_ok, rate_limit_seconds, is_enabled, config) values
  ('casamentos_com_br', 'Casamentos.com.br', 'scrape', 'https://www.casamentos.com.br', 'legitimo_interesse',
   'Espinha dorsal do Radar (serviços e locais; ≈ 290 listagens / ≈ 270 únicos em Natal). Base legal: legítimo interesse sobre dados profissionais publicados pelo próprio fornecedor (art. 7º, IX e §4º). Termos (Condições Legais §2.3/§2.4) PROÍBEM cópia por robot/crawler e reprodução da base — risco contratual médio (3/5), litígio improvável para uso interno sem republicação. Mitigação adotada pelo PRD (RF-RAD-02; §13 item 10, a validar com o advogado): coleta automatizada em BAIXO VOLUME de dados factuais (≈ 20 páginas de listagem + ≈ 290 perfis), 1 requisição a cada 3–5 s, execução MENSAL, user-agent identificado, sem login. Só a whitelist de campos (nome, categoria, endereço/bairro/CEP, source_url; nota, nº de avaliações, preço "a partir de" e capacidade apenas como números para pontuação interna). Nunca fotos, textos descritivos ou avaliações; nunca automatizar "Ver telefone" (endpoints emp-*.php em Disallow) — telefone vem de CNPJ/Places/Instagram.',
   true, 4.00, true,
   '{"collector": {"kind": "http", "phase": "mvp", "enabled": true, "schedule": "mensal", "max_pages_per_run": 320}, "fields_whitelist": ["name", "category", "address", "neighborhood", "cep", "source_url", "rating", "reviews_count", "price_from", "capacity"], "robots": "listagens e perfis permitidos; /json/, /emp-*.php, /busc-*.php bloqueados; GPTBot bloqueado"}'),

  ('base_cnpj', 'Receita Federal (CNPJ aberto)', 'import', 'https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/', 'legitimo_interesse',
   'Dados abertos oficiais (CSV mensal, ≈ 5–6 GB) filtrados fora do Postgres por UF = RN e município SIAFI 1761 (Natal), CNAEs de eventos do Apêndice B. Fonte mais completa e de menor risco (1–2/5): razão social, nome fantasia, CNAE, porte, situação, endereço, telefones cadastrais, e-mail, MEI, sócios. Regras: MEI/empresário individual é pessoa natural (flag is_natural_person) — remover o CPF do nome empresarial por regex antes de persistir; e-mail cadastral costuma ser do contador (não usar como canal); endereço residencial de MEI não é exibido. "Novos negócios" = data_inicio_atividade nos últimos 30–60 dias. Enriquecimento unitário por BrasilAPI/Minha Receita (RF-BAS-11, v1).',
   true, 1.00, true,
   '{"collector": {"kind": "csv_import", "phase": "mvp", "enabled": true, "schedule": "mensal", "filters": {"uf": "RN", "municipio_siafi": "1761", "situacao": "02"}}, "cnaes": ["8230-0/01", "8230-0/02", "5620-1/02", "7420-0/01", "7420-0/04", "9001-9/02", "9001-9/06", "7739-0/03", "7729-2/02", "7721-7/00", "9329-8/01", "9329-8/99", "4923-0/01", "4923-0/02", "1091-1/02"], "cnaes_com_filtro_por_palavra": ["5611-2/01", "8299-7/99", "9602-5/01"]}'),

  ('google_places', 'Google Maps', 'api', 'https://places.googleapis.com/v1/', 'legitimo_interesse',
   'Conector v1 (validação e telefone em tempo real; Text Search por categoria e bairro + Place Details). Termos da Google Maps Platform (Service Specific Terms §3.2.3/§14): só place_id pode ser cacheado indefinidamente; lat/lng por até 30 dias; conteúdo não pode ser pré-buscado, indexado ou armazenado — persistir place_id + nome + categoria + score; telefone/site só para o primeiro contato (TTL 30 dias) até o fornecedor confirmar (aí o dado passa a ser informado por ele). Custo ≈ US$ 10–20/mês. Risco 3/5 se guardar além do permitido; nunca copiar avaliações.',
   null, 1.00, true,
   '{"collector": {"kind": "api", "phase": "v1", "enabled": false, "schedule": "trimestral", "ttl_days": 30}, "fields_whitelist": ["place_id", "name", "primary_type", "phone", "website", "lat", "lng", "rating", "reviews_count"]}'),

  ('instagram', 'Instagram', 'api', 'https://www.instagram.com', 'legitimo_interesse',
   'No MVP: curadoria MANUAL (Heloísa/estagiários, ≈ 20 min/dia) a partir de hubs locais e descoberta por buscador (site:instagram.com + categoria + Natal) — anota-se @handle, nome, categoria e o WhatsApp da bio (contexto comercial público). Na v1: enriquecimento oficial por Business Discovery da Graph API (bio, site, seguidores, nº de posts; exige App Review; ≈ 200 chamadas/h). PROIBIDO scraper de terceiros ou login automatizado (termos da Meta; risco 4/5; Apêndice E SCR-05). Só perfis comerciais/profissionais; nada de dados de perfis pessoais de clientes.',
   false, 5.00, true,
   '{"collector": {"kind": "business_discovery", "phase": "v1", "enabled": false, "schedule": "sob demanda"}, "manual_curation": true, "fields_whitelist": ["instagram_handle", "name", "category", "website", "phone_from_bio", "followers_count", "media_count"]}'),

  ('sympla_outgo', 'Sympla / Outgo (produtores e organizadores)', 'scrape', 'https://www.sympla.com.br/eventos/natal-rn', 'legitimo_interesse',
   'Evento → página do produtor (nome, descrição, eventos passados/futuros, às vezes site/Instagram). No MVP a lista de produtores é MANUAL (organizadores recorrentes do Outgo/Sympla, R09 §D); o coletor automatizado (Playwright, SPA; baixo volume; 80–150 produtores/trimestre) fica para a v1, após avaliação formal de termos e robots. Dados de organizadores são de empresas/produtores em contexto comercial público; contato normalmente por formulário.',
   null, 5.00, true,
   '{"collector": {"kind": "playwright", "phase": "v1", "enabled": false, "schedule": "trimestral"}, "manual_curation": true, "fields_whitelist": ["name", "description", "website", "instagram_handle", "events_count", "source_url"]}'),

  ('olx', 'OLX Serviços (Natal)', 'scrape', 'https://www.olx.com.br/servicos/estado-rn/rio-grande-do-norte/natal', 'legitimo_interesse',
   'Conector v1, baixo volume (Playwright): anúncios de serviços de eventos (recreação, decoração, "pegue e monte", churrasqueiro) filtrados por palavra-chave; ≈ 150–300 relevantes entre 2.450 anúncios. Contato só pelo chat da OLX (WhatsApp às vezes no texto do anúncio). Anti-bot agressivo em produção — volume mínimo e intervalo longo; avaliar robots.txt e termos antes de habilitar (RF-RAD-01). Muitos anunciantes são pessoas naturais: marcar is_natural_person.',
   null, 10.00, true,
   '{"collector": {"kind": "playwright", "phase": "v1", "enabled": false, "schedule": "mensal"}, "keywords": ["buffet", "festa", "decoração", "brinquedo", "DJ", "som", "churrasqueiro", "cerimonial", "fotógrafo"], "fields_whitelist": ["name", "neighborhood", "category", "phone_from_text", "source_url"]}'),

  ('telelistas', 'TeleListas / GuiaMais / Organizando Eventos / Solutudo', 'scrape', 'https://www.telelistas.net', 'legitimo_interesse',
   'Diretórios telefônicos e guias comerciais: nome, endereço, bairro, telefone (público ou revelado por clique), categoria. Dados às vezes antigos (telefones de 8 dígitos precisam de confirmação). Uso: reconciliação barata de telefone e semente para infraestrutura, A&B e recreação (Organizando Eventos: 202 anúncios com telefone; Solutudo: 944 org. de eventos). Conector v1 (HTTP/Playwright, baixo volume); avaliar robots.txt e termos de cada guia antes de habilitar. Também é a origem de parte da lista-semente do R09 §B.',
   null, 5.00, true,
   '{"collector": {"kind": "http", "phase": "v1", "enabled": false, "schedule": "trimestral"}, "sites": ["telelistas.net", "guiamais.com.br", "organizandoeventos.com.br", "solutudo.com.br"], "fields_whitelist": ["name", "address", "neighborhood", "phone", "category", "source_url"]}'),

  ('planilha', 'Planilha (importação)', 'import', null, 'legitimo_interesse',
   'Planilha atual da equipe e lista-semente do R09 §B, importadas pela esteira unificada (RF-BAS-07; ADR-08) com mapeamento de colunas, dedup e desfazer em 48 h. Toda linha carrega collected_at e collector. Lista de TERCEIROS só com licença/contrato anexado (regra Telekall, RF-BAS-10); nunca listas compradas ou grupos privados (R08 §5.7).',
   null, 0.00, true,
   '{"collector": {"kind": "spreadsheet", "phase": "mvp", "enabled": true}, "requires_license_for_third_party_lists": true}'),

  ('contato_pessoal', 'Contato pessoal', 'referral', null, 'legitimo_interesse',
   'Origem "contato pessoal de [pessoa do time]" (RF-BAS-15): relacionamento prévio; entra como Tier A+ no topo da fila, abertura assinada por quem conhece. Registrar quem é a pessoa do time em collector.',
   null, 0.00, true,
   '{"collector": {"kind": "manual", "phase": "mvp", "enabled": true}, "tier": "A+"}'),

  ('indicacao', 'Indicação', 'referral', null, 'legitimo_interesse',
   'Origem "indicação de [nome]" (RF-BAS-15; intenção INDICACAO; carteira indicada por cerimonialista, PRD §5.5 etapa 9): Tier A+, abertura "a [cerimonialista] indicou você", atribuição 1:1 a quem indicou. Base legal: legítimo interesse; quem indica declara que o indicado aceita o contato.',
   null, 0.00, true,
   '{"collector": {"kind": "manual", "phase": "mvp", "enabled": true}, "tier": "A+"}'),

  ('captura_campo', 'Captura em campo', 'manual', null, 'legitimo_interesse',
   'Cadastro rápido pelo celular durante visitas/rotas (RF-BAS-15; formulário de 20 s, RF-MET): nome, categoria, WhatsApp e origem, com dedup imediata por telefone. Contato entregue pelo próprio fornecedor em contexto comercial (cartão, fachada, indicação no local). Captura por contato salvo ou OCR fica para a v2.',
   null, 0.00, true,
   '{"collector": {"kind": "manual", "phase": "mvp", "enabled": true}}')
on conflict (slug) do update
  set name               = excluded.name,
      kind               = excluded.kind,
      base_url           = excluded.base_url,
      legal_basis        = excluded.legal_basis,
      terms_notes        = excluded.terms_notes,
      robots_ok          = excluded.robots_ok,
      rate_limit_seconds = excluded.rate_limit_seconds,
      is_enabled         = excluded.is_enabled,
      -- config só é semeada quando ainda está vazia (o gestor configura seletores/paginação depois).
      config             = case when public.sources.config = '{}'::jsonb then excluded.config else public.sources.config end;

-- =====================================================================
-- 3b. Catálogo de coleta do Radar e mapa de categorias da fonte (R03 §2.1;
--     migração 20260904001802, blocos 3 e 4).
--
--     VEIO DA MIGRAÇÃO em 05/09/2026, pelo mesmo motivo das cadências do
--     bloco 12d, e num caso pior: lá o banco novo PARAVA com erro; aqui ele
--     terminava calado. O `update` do catálogo procurava `casamentos_com_br`
--     em `public.sources` e o mapa procurava `public.categories` — as duas
--     tabelas são semeadas AQUI, e o `db reset` roda todas as migrações antes
--     deste arquivo. Zero linhas casadas, zero erro: o Radar nascia sem
--     catálogo (nada a coletar) e sem mapa (toda captura cairia em revisão
--     manual), e só o pgTAP 21 percebia.
--
--     Fica logo depois das fontes porque é dado DA fonte: a linha existe
--     acima, e o que segue é a configuração de coleta dela. Idempotente —
--     `jsonb_set` na mesma chave e `on conflict do update` —, então roda em
--     todo reset sem duplicar nada.
-- =====================================================================
-- Cada entrada é uma página de listagem categoria × cidade. A paginação NÃO está
-- aqui: a própria página diz onde continua, no `<link rel="next">`, e é ele que o
-- worker segue — inventar `--2`, `--3` no código produziria requisição para
-- página que não existe, que é justamente o tipo de tráfego que a fonte não deve
-- receber de nós.
update public.sources s
   set config = jsonb_set(
                  jsonb_set(s.config, '{collector,agente}',
                            to_jsonb('KomuneBot/1.0 (+https://komune.app.br; CRM de captação da Komune)'::text), true),
                  '{collector,catalogo}',
                  '[
                     {"categoria_origem": "cerimonialista",         "caminho": "/cerimonialista/rio-grande-do-norte/natal"},
                     {"categoria_origem": "espaco-casamento",       "caminho": "/espaco-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "fotografo-casamento",    "caminho": "/fotografo-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "filmagem-casamento",     "caminho": "/filmagem-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "buffet-casamento",       "caminho": "/buffet-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "musica-de-casamento",    "caminho": "/musica-de-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "decoracao-casamento",    "caminho": "/decoracao-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "doces-casamento",        "caminho": "/doces-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "bolo-casamento",         "caminho": "/bolo-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "convites-de-casamento",  "caminho": "/convites-de-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "lembrancas-de-casamento","caminho": "/lembrancas-de-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "florista-casamento",     "caminho": "/florista-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "carros-casamento",       "caminho": "/carros-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "animacao-festa",         "caminho": "/animacao-festa/rio-grande-do-norte/natal"},
                     {"categoria_origem": "beleza-noivas",          "caminho": "/beleza-noivas/rio-grande-do-norte/natal"},
                     {"categoria_origem": "celebrante",             "caminho": "/celebrante/rio-grande-do-norte/natal"},
                     {"categoria_origem": "cabine-de-fotos",        "caminho": "/cabine-de-fotos/rio-grande-do-norte/natal"},
                     {"categoria_origem": "bebidas-casamento",      "caminho": "/bebidas-casamento/rio-grande-do-norte/natal"}
                   ]'::jsonb,
                  true)
 where s.slug = 'casamentos_com_br';


-- O mapa da categoria da fonte → categoria do CRM.
-- Só o que é evidente. `cabine-de-fotos` não entra: cabine é serviço de foto para
-- uns e brinquedo de festa para outros, e chutar aqui contamina o funil inteiro
-- sem que ninguém tenha decidido. Sem mapa, `category_id` chega nulo e a fila de
-- revisão pergunta — que é o comportamento que a 001600 desenhou.
insert into public.source_category_map (source_id, category_source, category_id)
select s.id, m.categoria_origem, c.id
  from public.sources s
  join (values
          ('cerimonialista',          'cerimonialistas_assessorias'),
          ('espaco-casamento',        'locais_saloes_chacaras_hoteis'),
          ('salao-casamento',         'locais_saloes_chacaras_hoteis'),
          ('restaurante-casamento',   'locais_saloes_chacaras_hoteis'),
          ('fazenda-casamento',       'locais_saloes_chacaras_hoteis'),
          ('hotel-casamento',         'locais_saloes_chacaras_hoteis'),
          ('fotografo-casamento',     'fotografia_video'),
          ('filmagem-casamento',      'fotografia_video'),
          ('buffet-casamento',        'buffet_adulto_corporativo'),
          ('musica-de-casamento',     'djs_bandas_musicos'),
          ('dj-para-casamento',       'djs_bandas_musicos'),
          ('decoracao-casamento',     'decoracao_flores'),
          ('florista-casamento',      'decoracao_flores'),
          ('doces-casamento',         'doces_bolos_confeitaria'),
          ('bolo-casamento',          'doces_bolos_confeitaria'),
          ('convites-de-casamento',   'celebrante_beleza_convites_staff'),
          ('lembrancas-de-casamento', 'celebrante_beleza_convites_staff'),
          ('beleza-noivas',           'celebrante_beleza_convites_staff'),
          ('celebrante',              'celebrante_beleza_convites_staff'),
          ('carros-casamento',        'celebrante_beleza_convites_staff'),
          ('animacao-festa',          'recreadores_animadores'),
          ('bebidas-casamento',       'bar_drinks_chopp'),
          ('tendas-casamentos',       'tendas_estruturas_palcos')
       ) as m(categoria_origem, categoria_crm) on true
  join public.categories c on c.slug = m.categoria_crm
 where s.slug = 'casamentos_com_br'
on conflict (source_id, category_source) do update
  set category_id = excluded.category_id;

-- =====================================================================
-- 4. Feriados 2026 e 2027 (RF-CON-11: nunca enviar em feriado; app.next_business_day).
--    Datas conferidas: Páscoa 05/04/2026 → Carnaval 16–17/02, Sexta-feira Santa 03/04,
--    Corpus Christi 04/06; Páscoa 28/03/2027 → Carnaval 08–09/02, Sexta-feira Santa 26/03,
--    Corpus Christi 27/05. Consciência Negra é feriado nacional desde a Lei 14.759/2023.
--    RN: 03/10 Mártires de Cunhaú e Uruaçu (Lei estadual 8.913/2006).
--    Natal: 06/01 Santos Reis e 21/11 Nossa Senhora da Apresentação (Lei municipal
--    245/1974) — os dois constam como feriados municipais no calendário oficial.
--    Carnaval e Corpus Christi são pontos facultativos (marcados no nome): contam como
--    dia sem envio porque o comércio de eventos para e a equipe não trabalha.
--    O ano seguinte é semeado junto porque as cadências viram o ano: um D+30/D+60 de Nutrição
--    disparado em novembro/dezembro cai em janeiro, e sem 2027 o CRM trataria 01/01/2027
--    (sexta) como dia útil. A autoverificação do bloco 13 exige ano corrente + 1.
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
-- 5. Motivos de perda — lista fechada do PRD §5.3, na ordem do texto (editável pelo gestor,
--    RF-ADM-02). "Não respondeu" e "agora não" NÃO são perda: vão para Nutrição.
-- =====================================================================
insert into public.lost_reasons (slug, name, is_active, position) values
  ('ja_anuncia_outro_portal',     'Já anuncia em outro portal e não vê ganho',          true, 1),
  ('nao_aceita_comissao',         'Não aceita comissão',                                true, 2),
  ('nao_confia_plataforma_nova',  'Não confia em plataforma nova / sem clientes',       true, 3),
  ('agenda_cheia',                'Agenda cheia, não precisa de demanda',               true, 4),
  ('sem_cnpj_pix',                'Não tem CNPJ/Pix e não quer formalizar',             true, 5),
  ('fora_grande_natal',           'Fora de Natal / Grande Natal',                       true, 6),
  ('categoria_fora_escopo',       'Categoria fora do escopo',                           true, 7),
  ('nao_decisor_sem_indicacao',   'Não é o decisor e não indicou',                      true, 8),
  ('nao_autorizou_precadastro',   'Não autorizou o pré-cadastro',                       true, 9)
on conflict (slug) do update
  set name      = excluded.name,
      is_active = excluded.is_active,
      position  = excluded.position;

-- =====================================================================
-- 6. Etiquetas (RF-BAS-01 tags; PRD §13 item 7 lista VIP; R09 §B lista-semente).
-- =====================================================================
insert into public.tags (name, color) values
  ('fundador',          '#F59E0B'),   -- Fornecedor/produtor Fundador (selo)
  ('vip',               '#7C3AED'),   -- Lista VIP: o robô só contata e agenda, humano conduz (RF-CON-21)
  ('indicacao',         '#10B981'),   -- Veio por indicação (Tier A+)
  ('lista_semente_r09', '#64748B')    -- Importado da lista-semente do R09 §B (D2)
on conflict (name) do update
  set color = excluded.color;

-- =====================================================================
-- 7. Funis e etapas (PRD §5.3, §5.4, §5.5; RF-FUN-04 campos obrigatórios; RF-FUN-05
--    automações penduradas na etapa, descritas como DADOS — o motor que as executa
--    chega nos dias D5–D7). Convenções:
--      * temperature = temperatura derivada da etapa (PRD §5.6). Perdido/Opt-out usam
--        'frio' porque o enum não tem "—" (app.compute_temperature devolve frio para lost).
--        "Recorrente" do Funil 3 usa 'cliente_ativo' (não há valor próprio no enum).
--      * sla_hours = coluna "SLA (vira parado)" convertida para horas. Onde o SLA real é
--        em minutos (Respondeu: 15 min / 10 min) a coluna guarda 1 (granularidade) e o
--        valor real fica em automations.
--      * required_fields = [{"field","label",...}] exigidos para ENTRAR na etapa
--        (RF-FUN-04: Reunião marcada = data e formato; Autorizou = evidência; Perdido = motivo).
--      * automations = [{"trigger":{...},"action":{...},"note":"..."}]. {SEG} = segmento do
--        parceiro (AEB/INF/PRE/ESP/CER/FOR); "*" no código = variante sorteada (V1/V2/V3);
--        approval:"human" = rascunho aprovado pela Heloísa (ADR-05 / RF-CON-22).
--      * is_won: Publicado (fornecedor), Recorrente (ativação), Ativado e Recorrente (produtor).
--        is_lost: Perdido e Opt-out. is_terminal: nunca reabre e não recebe cadência nem
--        reativação — Publicado (migra para o Funil 2) e Opt-out. Perdido NÃO é terminal
--        porque reabre por decisão humana com motivo após 90 dias (PRD §5.3).
--      * Nutrição/dormente, Perdido e Opt-out (e Em risco) ficam nas posições 90/98/99 para
--        não colidir com a ordem das etapas de trabalho.
-- =====================================================================
insert into public.pipelines (slug, name, kind, position) values
  ('fornecedor', 'Captação de fornecedor',           'fornecedor', 1),
  ('ativacao',   'Ativação e sucesso do fornecedor', 'fornecedor', 2),
  ('produtor',   'Produtor e cerimonialista',        'produtor',   3)
on conflict (slug) do update
  set name = excluded.name, kind = excluded.kind, position = excluded.position;

-- Libera as posições antes do upsert (unique (pipeline_id, position)): uma reordenação entre
-- versões da seed não colide com a posição antiga de outra etapa. Etapa que deixar de existir
-- na seed fica com posição negativa (visível como órfã) em vez de ser apagada — deals apontam para ela.
update public.stages set position = -position where position > 0;

insert into public.stages (pipeline_id, slug, name, position, temperature, is_won, is_lost, is_dormant, is_optout, is_terminal, sla_hours, required_fields, automations)
select p.id, s.slug, s.name, s.position, s.temperature::app.temperature, s.is_won, s.is_lost,
       -- is_dormant e is_optout são derivados do slug (as duas etapas existem com o mesmo nome
       -- nos Funis 1 e 3): entrar em 'nutricao' põe o negócio em status 'nurturing' (Frio, PRD
       -- §5.6) e 'optout' é perda por regra, sem motivo da lista fechada (PRD §5.3).
       s.slug = 'nutricao' as is_dormant,
       s.slug = 'optout'   as is_optout,
       s.is_terminal, s.sla_hours,
       s.required_fields::jsonb, s.automations::jsonb
from (values

  -- ---------------- Funil 1 — Captação de fornecedor (PRD §5.3) ----------------
  ('fornecedor', 'prospectado', 'Prospectado', 1, 'frio', false, false, false, 72, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"queue_first_contact","queue":"primeiros_contatos","order_by":"score desc","assignee":"owner"},"note":"Entra na fila diária de primeiros contatos do responsável, ordenada por score (RF-CON-08)"},
    {"trigger":{"type":"on_enter"},"action":{"type":"ai_suggest","what":"detalhe_personalizacao","model":"haiku"},"note":"IA sugere o detalhe real da abertura (variante A); sem detalhe, variante B (ab_forcado)"},
    {"trigger":{"type":"on_first_contact_sent"},"action":{"type":"move_stage","to":"contatado"},"note":"Eco do Coexistence ou botão \"marquei como enviado\" (RF-CON-08/08b)"},
    {"trigger":{"type":"on_idle","days":3},"action":{"type":"flag_stuck"},"note":"3 dias sem contato = parado"}
  ]$j$),

  ('fornecedor', 'contatado', 'Contatado', 2, 'frio', false, false, false, 72, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"start_cadence","cadence":"silencio","max_touches":5,"steps":[
        {"day":3,"channel":"whatsapp","template":"GEN-FUP-D3-V1","mode":"assistido"},
        {"day":5,"channel":"phone","task":"call","attempts":2,"tiers":["A","B"],"window":"12-14h ou 14-17h"},
        {"day":7,"channel":"instagram","task":"dm","tiers":["A"]},
        {"day":7,"until_day":10,"channel":"presencial","task":"visit_on_route","tiers":["A"]}]},
     "note":"Régua de silêncio (RF-CON-13): só 2 mensagens de WhatsApp (abertura + único follow-up D+3, pelo app); os demais toques são tarefas humanas por outros canais"},
    {"trigger":{"type":"on_reply"},"action":{"type":"move_stage","to":"respondeu"},"note":"Qualquer resposta encerra a cadência (RF-CON-18)"},
    {"trigger":{"type":"on_idle","days":14},"action":{"type":"move_stage","to":"nutricao"},"note":"14 dias sem resposta → dormente"}
  ]$j$),

  ('fornecedor', 'respondeu', 'Respondeu', 3, 'morno', false, false, false, 1, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"auto_ack","within_minutes":1},"note":"Robô acusa recebimento em ≤ 1 min"},
    {"trigger":{"type":"on_inbound"},"action":{"type":"classify_intent","model":"haiku","optout_rule_first":true},"note":"Regra determinística de opt-out antes da IA; 25 intenções do Apêndice C (RF-CON-19)"},
    {"trigger":{"type":"on_intent","intents":["interessado"]},"action":{"type":"send_sequence","templates":["SYS-PRE-AUDIO","{SEG}-AUD-1","SYS-POS-AUDIO","GEN-SYS-PEDIDO-AUTORIZACAO"],"approval":"human"},"note":"Texto fixo + áudio da Heloísa + pedido de autorização do pré-cadastro como 2ª mensagem (RF-CON-21)"},
    {"trigger":{"type":"on_intent","intents":["*"]},"action":{"type":"draft_reply","approval":"human"},"note":"Demais intenções: resposta fixa ou IA, sempre como rascunho aprovado (RF-CON-22)"},
    {"trigger":{"type":"on_enter"},"action":{"type":"assign_conversation","to":"owner"},"note":"Conversa atribuída (RF-CON-04)"},
    {"trigger":{"type":"on_enter"},"action":{"type":"create_task","kind":"message","assignee":"owner","sla_minutes":15},"note":"SLA humano: 15 min em horário comercial (sla_hours guarda 1 por granularidade)"}
  ]$j$),

  ('fornecedor', 'em_conversa', 'Em conversa', 4, 'morno', false, false, false, 24, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"send_template","template":"{SEG}-CTA-1","slots":{"manha":"meet","tarde":"visita_na_zona_do_dia"},"approval":"human"},"note":"CTA com 2 horários concretos em 24 h"},
    {"trigger":{"type":"on_enter"},"action":{"type":"ai_fill_form","form":"space","fallback":"task_owner","blocks_scheduling":false},"note":"SPACE preenchido pela IA a partir da conversa ou tarefa obrigatória do responsável antes da reunião"},
    {"trigger":{"type":"on_intent","intents":["agendamento_aceito"]},"action":{"type":"move_stage","to":"reuniao_marcada"}},
    {"trigger":{"type":"on_intent","intents":["autoriza_pre_cadastro"]},"action":{"type":"move_stage","to":"autorizou"},"note":"Caminho curto sem reunião (RF-CON-21)"},
    {"trigger":{"type":"on_idle","days":7},"action":{"type":"alert","to":"owner","set_temperature":"morno","task":"reengajar"},"note":"7 dias sem contato → alerta e volta a Morno (PRD §5.6)"},
    {"trigger":{"type":"on_idle","days":14},"action":{"type":"move_stage","to":"nutricao"}}
  ]$j$),

  ('fornecedor', 'reuniao_marcada', 'Reunião marcada', 5, 'quente', false, false, false, 24,
   $j$[{"field":"meeting_at","label":"Data e hora da reunião","type":"timestamptz"},
       {"field":"meeting_format","label":"Formato","type":"enum","options":["meet","visita"]}]$j$,
   $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"calendar_event","provider":"google","meet_when":"meet"},"note":"Evento no Google Calendar (pelo robô ou pela pessoa)"},
    {"trigger":{"type":"before_appointment","hours":24},"action":{"type":"send_template","template":"GEN-AGD-24H-*"}},
    {"trigger":{"type":"before_appointment","hours":1},"action":{"type":"send_template","template":"GEN-AGD-1H-*"}},
    {"trigger":{"type":"on_no_show","count":1},"action":{"type":"reschedule","within_hours":24,"templates":["GEN-AGD-NOSHOW-1","GEN-AGD-NOSHOW-2"]},"note":"Humano tenta ligar antes"},
    {"trigger":{"type":"on_no_show","count":2},"action":{"type":"move_stage","to":"em_conversa","note_required":true},"note":"2º no-show → humano liga; volta a Em conversa com nota"},
    {"trigger":{"type":"on_no_show","count":3},"action":{"type":"move_stage","to":"nutricao","reason":"no-show recorrente"}},
    {"trigger":{"type":"on_appointment_done"},"action":{"type":"move_stage","to":"apresentacao_realizada"}}
  ]$j$),

  ('fornecedor', 'apresentacao_realizada', 'Apresentação realizada', 6, 'quente', false, false, false, 120, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"send_template","template":"GEN-POS-RESUMO","within_hours":1,"approval":"human"},"note":"Resumo do combinado em até 1 h"},
    {"trigger":{"type":"on_enter","condition":"authorization_missing"},"action":{"type":"send_template","template":"GEN-POS-AUTORIZACAO","approval":"human"},"note":"Pedido de autorização se ainda não dada; texto literal vai para consent_events"},
    {"trigger":{"type":"on_enter","condition":"visit_with_photos"},"action":{"type":"send_template","template":"GEN-POS-VISITA-FOTOS","approval":"human"}},
    {"trigger":{"type":"on_enter"},"action":{"type":"create_tasks","kind":"follow_up","days":[0,1,3],"assignee":"owner"},"note":"Follow-up no mesmo dia; tarefas D+1 e D+3"},
    {"trigger":{"type":"on_idle","days":5},"action":{"type":"alert","level":"vermelho","to":"owner"}}
  ]$j$),

  ('fornecedor', 'autorizou', 'Autorizou', 7, 'quente', false, false, false, 72,
   $j$[{"field":"authorization_evidence","label":"Evidência da autorização (texto literal, data e canal) registrada em consent_events","consent_kind":"data_use_authorized"}]$j$,
   $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"pre_registration_upsert","edge_function":"crm-pre-registration"},"note":"Cria/atualiza o rascunho na Komune SÓ com autorização em consent_events (guardrail)"},
    {"trigger":{"type":"on_enter"},"action":{"type":"send_claim_link","channel":"whatsapp","code_channel":"email","template":"GEN-SYS-AVISO-PRECADASTRO"},"note":"Link único de reivindicação + código (v1: código pelo WhatsApp)"},
    {"trigger":{"type":"after_enter","hours":24},"action":{"type":"task_with_text","template":"GEN-ONB-D1-NAO-ABRIU"},"note":"MVP: lembretes como tarefas humanas com texto pronto (RF-CON-16)"},
    {"trigger":{"type":"after_enter","hours":72},"action":{"type":"task_with_text","template":"GEN-ONB-D3","audio":"cobranca_cadastro_1"}},
    {"trigger":{"type":"after_enter","days":7},"action":{"type":"create_task","kind":"call","assignee":"owner"},"note":"Ligação ou visita em 7 dias"},
    {"trigger":{"type":"after_enter","days":20},"action":{"type":"task_with_text","template":"GEN-ONB-D14"},"note":"Aviso final antes da expiração do rascunho"},
    {"trigger":{"type":"after_enter","days":30},"action":{"type":"expire_draft"},"note":"Rascunho não reivindicado expira em D+30 (PRD §10.6)"},
    {"trigger":{"type":"on_platform_event","event":"claimed"},"action":{"type":"move_stage","to":"cadastro_em_andamento"}}
  ]$j$),

  ('fornecedor', 'cadastro_em_andamento', 'Cadastro em andamento', 8, 'quente', false, false, false, 72, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"start_cadence","cadence":"onboarding","mode":"tarefa_humana","steps":[{"day":1,"template":"GEN-ONB-D1"},{"day":3,"template":"GEN-ONB-D3"},{"day":7,"template":"GEN-ONB-D7"},{"day":14,"template":"GEN-ONB-D14"}]},"note":"Perturbar com educação: cita o campo que falta, lido da plataforma"},
    {"trigger":{"type":"on_platform_event","event":"stuck_step"},"action":{"type":"task_with_text","template":"GEN-ONB-TRAVOU"}},
    {"trigger":{"type":"on_idle","days":3},"action":{"type":"flag_stuck","label":"perturbar"}},
    {"trigger":{"type":"on_idle","days":14},"action":{"type":"create_task","kind":"visit","assignee":"owner"},"note":"Tarefa humana + visita; modo assistido (CS edita em nome do fornecedor)"},
    {"trigger":{"type":"on_platform_event","event":"published"},"action":{"type":"move_stage","to":"publicado"}}
  ]$j$),

  ('fornecedor', 'publicado', 'Publicado (ganho)', 9, 'cliente', true, false, true, null, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"send_template","template":"GEN-ONB-PUBLICADO"},"note":"Parabéns + kit de divulgação"},
    {"trigger":{"type":"on_enter"},"action":{"type":"add_tag","tag":"fundador"},"note":"Selo Fundador"},
    {"trigger":{"type":"on_enter"},"action":{"type":"enqueue","queue":"lead_garantido","due_days":30}},
    {"trigger":{"type":"on_enter"},"action":{"type":"create_deal","pipeline":"ativacao","stage":"publicado"},"note":"Migra para o Funil 2"}
  ]$j$),

  ('fornecedor', 'nutricao', 'Nutrição / dormente', 90, 'frio', false, false, false, 720, '[]', $j$[
    {"trigger":{"type":"after_enter","days":30},"action":{"type":"reactivation","template":"GEN-REA-60-*","requires":"gancho","approval":"human"},"note":"1 toque por ciclo, gancho obrigatório (RF-CON-15)"},
    {"trigger":{"type":"after_enter","days":60},"action":{"type":"reactivation","template":"GEN-REA-60-*","requires":"gancho","approval":"human"}},
    {"trigger":{"type":"cycles_without_reply","count":2},"action":{"type":"set_flag","flag":"nao_reativar_auto"},"note":"2 ciclos sem resposta → só humano"},
    {"trigger":{"type":"on_reply"},"action":{"type":"move_stage","to":"respondeu"}},
    {"trigger":{"type":"on_idle","months":12},"action":{"type":"retention","do":"anonymize"},"note":"12 meses de inatividade (PRD §10.6)"}
  ]$j$),

  ('fornecedor', 'perdido', 'Perdido', 98, 'frio', false, true, false, null,
   $j$[{"field":"lost_reason_id","label":"Motivo da perda (lista fechada)","table":"lost_reasons"}]$j$,
   $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"stop_all_cadences"},"note":"Sem reativação automática"},
    {"trigger":{"type":"weekly"},"action":{"type":"report","name":"motivos_de_perda"}},
    {"trigger":{"type":"on_reopen"},"action":{"type":"require","human_decision":true,"reason":true,"min_days":90},"note":"Reabre só por iniciativa do parceiro ou decisão humana com motivo após 90 dias"}
  ]$j$),

  ('fornecedor', 'optout', 'Opt-out / não contatar', 99, 'frio', false, true, true, null, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"consent_event","kind":"contact_optout"},"note":"do_not_contact + hash do telefone na suppression_list em < 5 min"},
    {"trigger":{"type":"on_enter"},"action":{"type":"send_template","template":"GEN-SYS-OPTOUT","once":true},"note":"Confirmação única"},
    {"trigger":{"type":"on_enter"},"action":{"type":"stop_all_cadences"}},
    {"trigger":{"type":"on_enter"},"action":{"type":"retention","do":"erase","confirm_template":"GEN-SYS-EXCLUSAO-CONFIRMA"},"note":"Dados apagados; supressão permanente por hash"}
  ]$j$),

  -- ---------------- Funil 2 — Ativação e sucesso do fornecedor (PRD §5.4) ----------------
  ('ativacao', 'publicado', 'Publicado', 1, 'cliente', false, false, false, 720, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"set_deadline","field":"guaranteed_lead_due_at","days":30},"note":"Lead garantido vence em 30 dias"},
    {"trigger":{"type":"on_enter"},"action":{"type":"start_cadence","cadence":"ativacao","mode":"tarefa_humana","steps":[{"day":0,"template":"GEN-ONB-PUBLICADO","note":"boas-vindas e kit"},{"day":2,"note":"micro-treino: responda em 24 h"},{"day":7,"note":"complete para entrar no destaque"},{"day":14,"note":"complete para entrar no destaque"}]}},
    {"trigger":{"type":"after_enter","days":7},"action":{"type":"send_template","template":"GEN-ONB-FEEDBACK-7D","approval":"human"}},
    {"trigger":{"type":"after_enter","days":30,"condition":"sem_lead_respondido"},"action":{"type":"move_stage","to":"em_risco"},"note":"Cliente em risco (PRD §5.6)"}
  ]$j$),

  ('ativacao', 'perfil_completo', 'Perfil completo / Verificado', 2, 'cliente', false, false, false, 336, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"campaign","name":"selo_verificado_em_2_minutos","by":"grupo_de_documentos"},"note":"Score 100 e/ou documentos aprovados; 14 dias após publicar"},
    {"trigger":{"type":"after_enter","days":30,"condition":"sem_lead_respondido"},"action":{"type":"move_stage","to":"em_risco"}}
  ]$j$),

  ('ativacao', 'primeiro_lead', '1º lead entregue', 3, 'cliente_ativo', false, false, false, 336, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"send_template","template":"GEN-ONB-PRIMEIRO-LEAD"},"note":"Lead real (evento próprio, Research Request, orgânico ou manual da rede — nunca fictício)"},
    {"trigger":{"type":"on_enter"},"action":{"type":"start_timer","name":"resposta_ao_lead","hours":24},"note":"Cronômetro de resposta"},
    {"trigger":{"type":"on_idle","days":14,"condition":"sem_lead"},"action":{"type":"create_task","kind":"other","assignee":"cs","title":"CS gera lead"}},
    {"trigger":{"type":"on_idle","days":21,"condition":"sem_lead"},"action":{"type":"alert","to":"gestor","task":"lead_manual"}},
    {"trigger":{"type":"on_idle","days":30,"condition":"sem_lead"},"action":{"type":"escalate","to":["Rafael","Bárbara"]}}
  ]$j$),

  ('ativacao', 'lead_respondido', 'Lead respondido', 4, 'cliente_ativo', false, false, false, 24, '[]', $j$[
    {"trigger":{"type":"lead_unanswered","hours":12},"action":{"type":"send_template","template":"GEN-ONB-LEAD-SEM-RESPOSTA"},"note":"Lembrete"},
    {"trigger":{"type":"lead_unanswered","hours":24},"action":{"type":"create_task","kind":"call","assignee":"owner"},"note":"Ligação"},
    {"trigger":{"type":"lead_unanswered","hours":48},"action":{"type":"redistribute_lead","supplier_sla_penalty":true},"note":"Redistribuição; SLA do fornecedor cai"},
    {"trigger":{"type":"on_lead_outcome"},"action":{"type":"send_template","template":"GEN-ONB-FEEDBACK-POS-LEAD","approval":"human"},"note":"Pedido de feedback após o desfecho"},
    {"trigger":{"type":"on_idle","days":60},"action":{"type":"move_stage","to":"em_risco"},"note":"Sem interação em 60 dias → churn de supply (PRD §5.6)"}
  ]$j$),

  ('ativacao', 'primeira_contratacao', '1ª contratação', 5, 'cliente_ativo', false, false, false, 48, '[]', $j$[
    {"trigger":{"type":"after_event","days":2},"action":{"type":"request_review"},"note":"Pedir avaliação D+2 após o evento"},
    {"trigger":{"type":"on_enter"},"action":{"type":"create_task","kind":"other","title":"Case para pitch (só com autorização para citar o nome)","assignee":"owner"}},
    {"trigger":{"type":"on_idle","days":60},"action":{"type":"move_stage","to":"em_risco"}}
  ]$j$),

  ('ativacao', 'recorrente', 'Recorrente', 6, 'cliente_ativo', true, false, false, 720, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"send_template","template":"GEN-ONB-PARTICIPACAO-VIDEO","approval":"human"},"note":"Convite a embaixador / vídeos (≥ 2 contratações ou ≥ 3 leads respondidos em 60 dias)"},
    {"trigger":{"type":"on_enter"},"action":{"type":"platform_action","do":"upgrade_destaque"}},
    {"trigger":{"type":"monthly"},"action":{"type":"create_task","kind":"other","title":"Revisão mensal","assignee":"owner"}}
  ]$j$),

  ('ativacao', 'em_risco', 'Em risco / churn', 90, 'cliente', false, false, false, 72, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"alert","to":"owner"},"note":"Alerta ao dono da carteira (sem lead respondido em 30 dias ou sem interação em 60)"},
    {"trigger":{"type":"on_enter"},"action":{"type":"create_task","kind":"call","assignee":"owner","title":"Ligação + lead manual (C11)"}},
    {"trigger":{"type":"on_lead_answered"},"action":{"type":"move_stage","to":"lead_respondido"}}
  ]$j$),

  -- ---------------- Funil 3 — Produtor e cerimonialista (PRD §5.5) ----------------
  ('produtor', 'identificado', 'Identificado', 1, 'frio', false, false, false, 24, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"score","tiers":true},"note":"Score e tier em 24 h; exige tipo (produtor operacional / cerimonialista / empresa de formatura) e evidência de atividade"},
    {"trigger":{"type":"on_enter"},"action":{"type":"queue_first_contact","queue":"primeiros_contatos","order_by":"score desc","assignee":"owner"},"note":"Radar: Sympla/Outgo, Casamentos.com.br (42 cerimoniais), sites de formatura"},
    {"trigger":{"type":"on_first_contact_sent"},"action":{"type":"move_stage","to":"contatado"}}
  ]$j$),

  ('produtor', 'contatado', 'Contatado', 2, 'frio', false, false, false, 72, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"start_cadence","cadence":"silencio_produtor","steps":[{"day":3,"channel":"whatsapp","template":"GEN-FUP-D3-V1","mode":"assistido"},{"day":6,"channel":"phone","task":"call"},{"day":10,"channel":"presencial","task":"visit_or_dm"}]},"note":"Abertura consultiva citando evento/trabalho recente; régua mais espaçada (D0, D+3; humano D+6/D+10)"},
    {"trigger":{"type":"on_reply"},"action":{"type":"move_stage","to":"respondeu"}},
    {"trigger":{"type":"on_idle","days":14},"action":{"type":"move_stage","to":"nutricao"}}
  ]$j$),

  ('produtor', 'respondeu', 'Respondeu', 3, 'morno', false, false, false, 1, '[]', $j$[
    {"trigger":{"type":"on_inbound"},"action":{"type":"classify_intent","model":"haiku","optout_rule_first":true}},
    {"trigger":{"type":"on_intent","intents":["interessado"]},"action":{"type":"send_sequence","templates":["SYS-PRE-AUDIO","{SEG}-AUD-1","SYS-POS-AUDIO"],"approval":"human"},"note":"Áudio da Heloísa ou da Bárbara"},
    {"trigger":{"type":"on_enter"},"action":{"type":"create_task","kind":"message","assignee":"owner","sla_minutes":10},"note":"SLA humano ≤ 10 min (sla_hours guarda 1 por granularidade)"}
  ]$j$),

  ('produtor', 'demonstracao_marcada', 'Demonstração marcada', 4, 'quente', false, false, false, 24,
   $j$[{"field":"meeting_at","label":"Data e hora da demonstração","type":"timestamptz"},
       {"field":"meeting_format","label":"Formato","type":"enum","options":["meet_manha","cafe_ou_visita_tarde","evento_demo_sabado"]}]$j$,
   $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"calendar_event","provider":"google"},"note":"Google Calendar + lembretes"},
    {"trigger":{"type":"before_appointment","hours":24},"action":{"type":"send_template","template":"GEN-AGD-24H-*"}},
    {"trigger":{"type":"before_appointment","hours":1},"action":{"type":"send_template","template":"GEN-AGD-1H-*"}},
    {"trigger":{"type":"on_no_show","count":1},"action":{"type":"reschedule","within_hours":24,"templates":["GEN-AGD-NOSHOW-1","GEN-AGD-NOSHOW-2"]}},
    {"trigger":{"type":"on_appointment_done"},"action":{"type":"move_stage","to":"demonstracao_realizada"}}
  ]$j$),

  ('produtor', 'demonstracao_realizada', 'Demonstração realizada', 5, 'quente', false, false, false, 24, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"require_note","field":"dor_principal","options":["ingressos","fornecedores","financeiro","split"]},"note":"Mostrou app e painel do produtor; dor principal registrada"},
    {"trigger":{"type":"on_enter"},"action":{"type":"send_template","template":"GEN-POS-RESUMO","approval":"human","proposal":"8% do fornecedor; quando organiza, Komune 3% + 5% para o cerimonialista via split"}},
    {"trigger":{"type":"on_enter"},"action":{"type":"create_tasks","kind":"follow_up","days":[0],"assignee":"owner"},"note":"Follow-up no mesmo dia"}
  ]$j$),

  ('produtor', 'parceria_aceita', 'Parceria aceita', 6, 'quente', false, false, false, 72, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"create_task","kind":"other","title":"Criação assistida da conta de produtor (cerimonialista = perfil produtor com subcategoria)","assignee":"owner"},"note":"Conta criada em ≤ 72 h"}
  ]$j$),

  ('produtor', 'evento_piloto_definido', 'Evento-piloto definido', 7, 'quente', false, false, false, 168, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"require_note","field":"evento_piloto","fields":["data","publico","categorias_necessarias"]},"note":"Evento real escolhido"},
    {"trigger":{"type":"on_enter"},"action":{"type":"create_demand_signals","from":"categorias_necessarias","target_pipeline":"fornecedor"},"note":"Categorias necessárias viram Research Requests → alvos para o Funil 1"}
  ]$j$),

  ('produtor', 'evento_criado', 'Evento criado no app', 8, 'cliente', false, false, false, 120, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"create_task","kind":"other","title":"Assistência na criação do evento (Matheus/Heloísa)","assignee":"owner"},"note":"Evento publicado (mesmo privado); convites/fornecedores em ≤ 5 dias"},
    {"trigger":{"type":"on_referral"},"action":{"type":"move_stage","to":"carteira_indicada"}}
  ]$j$),

  ('produtor', 'carteira_indicada', 'Carteira indicada', 9, 'cliente', false, false, false, 336, '[]', $j$[
    {"trigger":{"type":"on_referral"},"action":{"type":"create_target","pipeline":"fornecedor","source":"indicacao","tier":"A+","opening":"a {{indicador}} indicou você","attribution":"1:1"},"note":"Ramo cerimonialista: indicados entram no Funil 1 como Tier A+"},
    {"trigger":{"type":"on_idle","days":14,"condition":"nenhum_indicado_publicado"},"action":{"type":"alert","to":"owner"},"note":"1º indicado publicado em ≤ 14 dias"}
  ]$j$),

  ('produtor', 'ativado', 'Ativado', 10, 'cliente_ativo', true, false, false, 720, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"referral_commission","rule":"airbnb"},"note":"Comissão de indicação só aqui: produtor ≥ 1 contratação/venda via Komune; cerimonialista ≥ 1 indicado publicado + ≥ 1 contratação vinculada"}
  ]$j$),

  ('produtor', 'recorrente', 'Recorrente', 11, 'cliente_ativo', true, false, false, 48, '[]', $j$[
    {"trigger":{"type":"after_event","days":2},"action":{"type":"send_report","name":"relatorio_do_evento","then":"pedir_o_proximo","approval":"human"},"note":"2º evento criado em ≤ 60 dias; pós-evento D+2"}
  ]$j$),

  ('produtor', 'nutricao', 'Nutrição / dormente', 90, 'frio', false, false, false, 720, '[]', $j$[
    {"trigger":{"type":"after_enter","days":30},"action":{"type":"reactivation","template":"GEN-REA-60-*","requires":"gancho","approval":"human"},"note":"1 toque por ciclo, gancho obrigatório (RF-CON-15)"},
    {"trigger":{"type":"after_enter","days":60},"action":{"type":"reactivation","template":"GEN-REA-60-*","requires":"gancho","approval":"human"}},
    {"trigger":{"type":"cycles_without_reply","count":2},"action":{"type":"set_flag","flag":"nao_reativar_auto"}},
    {"trigger":{"type":"on_reply"},"action":{"type":"move_stage","to":"respondeu"}},
    {"trigger":{"type":"on_idle","months":12},"action":{"type":"retention","do":"anonymize"}}
  ]$j$),

  ('produtor', 'perdido', 'Perdido', 98, 'frio', false, true, false, null,
   $j$[{"field":"lost_reason_id","label":"Motivo da perda (lista fechada)","table":"lost_reasons"}]$j$,
   $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"stop_all_cadences"}},
    {"trigger":{"type":"weekly"},"action":{"type":"report","name":"motivos_de_perda"}},
    {"trigger":{"type":"on_reopen"},"action":{"type":"require","human_decision":true,"reason":true,"min_days":90}}
  ]$j$),

  ('produtor', 'optout', 'Opt-out / não contatar', 99, 'frio', false, true, true, null, '[]', $j$[
    {"trigger":{"type":"on_enter"},"action":{"type":"consent_event","kind":"contact_optout"}},
    {"trigger":{"type":"on_enter"},"action":{"type":"send_template","template":"GEN-SYS-OPTOUT","once":true}},
    {"trigger":{"type":"on_enter"},"action":{"type":"stop_all_cadences"}},
    {"trigger":{"type":"on_enter"},"action":{"type":"retention","do":"erase","confirm_template":"GEN-SYS-EXCLUSAO-CONFIRMA"}}
  ]$j$)

) as s(pipeline_slug, slug, name, position, temperature, is_won, is_lost, is_terminal, sla_hours, required_fields, automations)
join public.pipelines p on p.slug = s.pipeline_slug
on conflict (pipeline_id, slug) do update
  set name            = excluded.name,
      position        = excluded.position,
      temperature     = excluded.temperature,
      is_won          = excluded.is_won,
      is_lost         = excluded.is_lost,
      is_dormant      = excluded.is_dormant,
      is_optout       = excluded.is_optout,
      is_terminal     = excluded.is_terminal,
      sla_hours       = excluded.sla_hours,
      required_fields = excluded.required_fields,
      automations     = excluded.automations;

-- =====================================================================
-- 8. Biblioteca de áudios (RF-CON-29; ADR-09) — só os roteiros-base por segmento.
--    storage_path fica NULL até a Heloísa gravar (após o termo de licença de voz, IA-01).
--    O upsert não sobrescreve storage_path/duration_sec/recorded_by/version.
-- =====================================================================
insert into public.audio_assets (slug, title, segment, context, transcript) values
  ('aeb-aud-1', 'Apresentação — Alimentos & Bebidas (25–30 s)', 'AEB', 'Após o "sim" à abertura: SYS-PRE-AUDIO → este áudio → SYS-POS-AUDIO (R08 §2.1)',
   $b$Oi, {{nome}}, Heloísa aqui, da Komune. Rapidinho: a Komune é um app de eventos aqui de Natal. Quem tá organizando um casamento, uma formatura, um aniversário, entra, diz o que precisa, e encontra os fornecedores da cidade. A gente tá escolhendo os buffets fundadores agora — e fundador ganha destaque na vitrine, selo, aparece nos nossos vídeos e recebe a primeira oportunidade real de evento em até 30 dias. Não tem mensalidade: você só paga 8% quando um evento fecha. Queria te mostrar funcionando, leva 20 minutos. Pode ser?$b$),
  ('inf-aud-1', 'Apresentação — Infraestrutura (25–30 s)', 'INF', 'Após o "sim" à abertura (R08 §2.2)',
   $b$Oi, {{nome}}, Heloísa, da Komune. Bem rápido: a Komune é um app de eventos aqui de Natal. Quem tá organizando — produtor, cerimonialista, empresa, formatura — entra e monta o evento com os fornecedores da cidade. Estrutura, som e iluminação é o que mais pedem e menos encontram. A gente tá fechando as empresas fundadoras de infraestrutura agora: fundador tem destaque na busca, selo, entra nos nossos vídeos e recebe a primeira oportunidade real em até 30 dias. Sem mensalidade, 8% só quando fecha. Te mostro em 20 minutos, pode ser?$b$),
  ('pre-aud-1', 'Apresentação — Prestador de serviço (25–30 s)', 'PRE', 'Após o "sim" à abertura (R08 §2.3)',
   $b$Oi, {{nome}}, Heloísa, da Komune. Rapidinho: a Komune é um app de eventos aqui de Natal — quem tá organizando entra, conta o que quer viver, e encontra quem faz acontecer. Pra {{profissao}} a diferença é que o cliente vê o seu trabalho, as avaliações, e chega já querendo orçar, não só "quanto custa". A gente tá escolhendo os fundadores agora: destaque na vitrine, selo, participação nos nossos vídeos e a primeira oportunidade real em até 30 dias. Sem mensalidade, 8% só quando fecha. Te mostro em 20 minutos?$b$),
  ('esp-aud-1', 'Apresentação — Espaço / local (25–30 s)', 'ESP', 'Após o "sim" à abertura (R08 §2.4)',
   $b$Oi, {{nome}}, Heloísa, da Komune. Rapidinho: a Komune é um app de eventos aqui de Natal, e o espaço é a primeira coisa que a pessoa escolhe quando entra. Quem organiza vê capacidade, fotos, datas, avaliações, e pede orçamento já com data e número de pessoas — chega mais qualificado, menos "só sondando". A gente tá escolhendo os espaços fundadores: destaque na busca, selo, tour em vídeo feito por nós e a primeira oportunidade real em até 30 dias. Sem mensalidade, 8% só quando fecha. Te mostro em 20 minutos, pode ser?$b$),
  ('cer-aud-1', 'Apresentação — Cerimonialista / assessoria (25–30 s)', 'CER', 'Após o "sim" à abertura (R08 §2.5)',
   $b$Oi, {{nome}}, Heloísa, da Komune. Rapidinho: a Komune é um app de eventos aqui de Natal. Você cria o evento do seu cliente lá dentro, escolhe e contrata os fornecedores pela plataforma, e a gente cuida da parte chata: pagamento, split, acompanhamento. O fornecedor paga 8%: 3 ficam com a Komune e 5 vão pra você, no contrato, sem ninguém precisar esconder nada. E como fundadora você tem destaque, selo e entra nos nossos vídeos. Queria te mostrar funcionando em 20 minutos. Pode ser?$b$),
  ('for-aud-1', 'Apresentação — Produtor de formatura (25–30 s)', 'FOR', 'Após o "sim" à abertura (R08 §2.6)',
   $b$Oi, {{nome}}, Heloísa, da Komune. Rapidinho: a Komune é um app de eventos aqui de Natal. Pra formatura ele faz duas coisas: organiza o baile — fornecedores, contratos, pagamento — e organiza a turma: ingressos, rateio, comunicação com a comissão, tudo dentro do app, sem grupo de WhatsApp virando bagunça. Você contrata pela plataforma, os fornecedores pagam 8% e 5% disso volta pra você como organizador do evento. Como fundador, destaque, selo e a gente ajuda a cadastrar. Te mostro em 20 minutos com um baile de exemplo, pode ser?$b$)
on conflict (slug) do update
  set title      = excluded.title,
      segment    = excluded.segment,
      context    = excluded.context,
      transcript = excluded.transcript;

-- =====================================================================
-- 9. Modelos de mensagem (PRD Apêndice C; R08 §2–4 e §2.7; R06 §C; PRD §10.7).
--    Tabela temporária + um único upsert no fim (bloco 10). Convenções:
--      * template_code = SEG-TIPO-VAR (R08 §0); a origem de cada texto está no comentário
--        da seção e no fim da linha (R08 §x / PRD §y).
--      * Variáveis no formato {{nome}}; a coluna `variables` é derivada do corpo no upsert.
--      * category: 'service' = enviada dentro da janela de 24 h (resposta a quem escreveu);
--        'marketing'/'utility' = mensagem iniciada pela empresa fora da janela, que exige
--        modelo aprovado pela Meta (meta_status 'pending' até a aprovação; RF-CON-02 pede
--        abertura, follow-up D+3 e lembrete de utilidade aprovados até o D5). No MVP a
--        abertura e o follow-up D+3 saem pelo app em modo assistido (RF-CON-08/13), sem
--        precisar do modelo — o registro na Meta é para o modo automático (RF-CON-09, v1)
--        e para o Coexistence.
--      * Aberturas (RF-CON-12, R06 WA-03, R11 B24): toda versão traz quem envia + "Komune",
--        finalidade, ORIGEM do contato, link do aviso de privacidade e "responda SAIR".
--        A versão B (sem detalhe de personalização) ganhou uma linha curta de origem para
--        cumprir a transparência — decisão registrada no CHANGELOG. Limite: ≤ 8 linhas /
--        ≈ 80 palavras quando link e SAIR estão incluídos (RF-CON-12).
--      * Palavras proibidas (R08 §5.1) não aparecem: "imperdível", "grátis", "garantido"
--        fora do termo, "urgente", "última chance", "promoção", "parceiro(a)" como vocativo.
-- =====================================================================
-- Tudo entre `do $seed$` e `end $seed$` roda como um único comando: o CLI prepara cada
-- statement do seed antes de executar o lote, e uma tabela temporária criada no meio do
-- arquivo não existiria na hora de preparar os inserts seguintes.
do $seed$
begin

drop table if exists seed_tpl;
create temp table seed_tpl (
  code        text primary key,
  name        text not null,
  category    text not null,
  segment     text not null,
  kind        text not null,
  variant     text,
  meta_status text,
  audio_slug  text,
  is_active   boolean not null default true,
  body        text not null
);

-- ---------- 9.1 Aberturas A/B por segmento (R08 §2.1–2.6 + sufixo LGPD do PRD Apêndice C / §10.7) ----------
insert into seed_tpl (code, name, category, segment, kind, variant, meta_status, body) values
  ('AEB-ABR-A', 'Abertura A (com origem) — Alimentos & Bebidas', 'marketing', 'AEB', 'abertura', 'A', 'pending',   -- R08 §2.1
$b$Oi, {{nome}}, tudo bem? Aqui é a Heloísa, da Komune, aqui de Natal 🙂
Vi o {{empresa}} no {{origem}} — as fotos da mesa de {{detalhe}} me chamaram atenção.
A gente está montando a rede de fornecedores fundadores de um app de eventos da cidade, e buffet é a categoria mais pedida.
Posso te explicar num áudio de 30 segundos?
Se não for o momento, me diz sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$),

  ('AEB-ABR-B', 'Abertura B (sem detalhe) — Alimentos & Bebidas', 'marketing', 'AEB', 'abertura', 'B', 'pending',   -- R08 §2.1
$b$Oi, {{nome}}, tudo bem? Heloísa, da Komune, aqui de Natal 🙂
Somos um app que conecta quem está organizando um evento com quem faz acontecer — e estamos escolhendo os primeiros buffets da rede fundadora.
Sem mensalidade: o fornecedor só paga quando um evento fecha.
Vi seu contato público no {{origem}}. Posso te explicar em 30 segundos por áudio?
Se não for o momento, me diz sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$),

  ('INF-ABR-A', 'Abertura A (com origem) — Infraestrutura', 'marketing', 'INF', 'abertura', 'A', 'pending',   -- R08 §2.2
$b$Oi, {{nome}}, tudo bem? Heloísa, da Komune, aqui de Natal 🙂
Vi a montagem da {{empresa}} no {{origem}} — a estrutura do {{detalhe}} ficou impecável.
Estamos formando a rede de fornecedores fundadores de um app de eventos da cidade, e som/estrutura é o que mais falta pra quem organiza.
Posso te explicar em um áudio de 30 segundos?
Se não for o momento, me avisa sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$),

  ('INF-ABR-B', 'Abertura B (sem detalhe) — Infraestrutura', 'marketing', 'INF', 'abertura', 'B', 'pending',   -- R08 §2.2
$b$Oi, {{nome}}, tudo bem? Heloísa, da Komune, aqui de Natal 🙂
Somos um app onde quem organiza evento em Natal encontra som, luz, estrutura e mobiliário num lugar só — e estamos escolhendo as primeiras empresas da rede fundadora.
Sem mensalidade: paga só quando um evento fecha.
Vi seu contato público no {{origem}}. Posso te explicar num áudio de 30 segundos?
Se não for o momento, me diz sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$),

  ('PRE-ABR-A', 'Abertura A (com origem) — Prestador de serviço', 'marketing', 'PRE', 'abertura', 'A', 'pending',   -- R08 §2.3
$b$Oi, {{nome}}, tudo bem? Heloísa, da Komune, aqui de Natal 🙂
Vi seu perfil no {{origem}} e o {{detalhe}} — seu estilo é bem {{estilo}}, gostei muito.
Estamos montando a rede de fornecedores fundadores de um app de eventos da cidade, e {{categoria}} é uma das categorias prioritárias.
Posso te explicar num áudio de 30 segundos?
Se não for o momento, me diz sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$),

  ('PRE-ABR-B', 'Abertura B (sem detalhe) — Prestador de serviço', 'marketing', 'PRE', 'abertura', 'B', 'pending',   -- R08 §2.3
$b$Oi, {{nome}}, tudo bem? Heloísa, da Komune, aqui de Natal 🙂
Somos um app onde quem organiza festa, casamento ou formatura em Natal encontra {{categoria}} pelo trabalho, não só pelo preço.
Estamos escolhendo os primeiros da rede fundadora — sem mensalidade, paga só quando fecha.
Vi seu contato público no {{origem}}. Posso te explicar em 30 segundos por áudio?
Se não for o momento, me diz sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$),

  ('ESP-ABR-A', 'Abertura A (com origem) — Espaço / local', 'marketing', 'ESP', 'abertura', 'A', 'pending',   -- R08 §2.4
$b$Oi, {{nome}}, tudo bem? Heloísa, da Komune, aqui de Natal 🙂
Vi o {{empresa}} no {{origem}} — o {{detalhe}} é lindo.
Estamos montando a rede de fornecedores fundadores de um app de eventos da cidade, e espaço é a primeira coisa que todo mundo procura.
Posso te explicar num áudio de 30 segundos?
Se não for o momento, me diz sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$),

  ('ESP-ABR-B', 'Abertura B (sem detalhe) — Espaço / local', 'marketing', 'ESP', 'abertura', 'B', 'pending',   -- R08 §2.4
$b$Oi, {{nome}}, tudo bem? Heloísa, da Komune, aqui de Natal 🙂
Somos um app onde quem organiza evento em Natal começa escolhendo o espaço — e estamos selecionando os primeiros locais da rede fundadora.
Sem mensalidade: o espaço só paga quando uma reserva fecha.
Vi seu contato público no {{origem}}. Posso te explicar em 30 segundos por áudio?
Se não for o momento, me diz sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$),

  ('CER-ABR-A', 'Abertura A (com origem) — Cerimonialista / assessoria', 'marketing', 'CER', 'abertura', 'A', 'pending',   -- R08 §2.5
$b$Oi, {{nome}}, tudo bem? Heloísa, da Komune, aqui de Natal 🙂
Vi a {{empresa}} no {{origem}} e o casamento {{detalhe}} — a condução ficou linda.
Estamos montando a rede fundadora de um app de eventos da cidade, e cerimonialista pra gente não é fornecedor: é sócio do evento.
Posso te explicar em um áudio de 30 segundos?
Se não for o momento, me diz sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$),

  ('CER-ABR-B', 'Abertura B (sem detalhe) — Cerimonialista / assessoria', 'marketing', 'CER', 'abertura', 'B', 'pending',   -- R08 §2.5
$b$Oi, {{nome}}, tudo bem? Heloísa, da Komune, aqui de Natal 🙂
Somos um app de eventos da cidade onde o cerimonialista organiza o evento com os fornecedores num lugar só e ainda recebe 5% do que fecha por lá, no contrato.
Estamos escolhendo as primeiras assessorias fundadoras.
Vi seu contato público no {{origem}}. Posso te explicar em 30 segundos por áudio?
Se não for o momento, me diz sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$),

  ('FOR-ABR-A', 'Abertura A (com origem) — Produtor de formatura', 'marketing', 'FOR', 'abertura', 'A', 'pending',   -- R08 §2.6
$b$Oi, {{nome}}, tudo bem? Heloísa, da Komune, aqui de Natal 🙂
Vi o baile de {{detalhe}} da {{empresa}} no {{origem}} — a produção ficou enorme.
Estamos montando a rede fundadora de um app de eventos da cidade, e produtor de formatura é o perfil que mais contrata fornecedor por evento.
Posso te explicar em um áudio de 30 segundos?
Se não for o momento, me diz sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$),

  ('FOR-ABR-B', 'Abertura B (sem detalhe) — Produtor de formatura', 'marketing', 'FOR', 'abertura', 'B', 'pending',   -- R08 §2.6
$b$Oi, {{nome}}, tudo bem? Heloísa, da Komune, aqui de Natal 🙂
Somos um app de eventos da cidade onde o produtor monta o baile, contrata os fornecedores e organiza a turma (ingressos, rateio, comunicação) num lugar só.
Estamos escolhendo os primeiros produtores fundadores.
Vi seu contato público no {{origem}}. Posso te explicar em 30 segundos por áudio?
Se não for o momento, me diz sem problema — para não receber mais, responda SAIR. Como usamos seus dados: komune.app/privacidade$b$);

-- ---------- 9.2 Roteiros de áudio (kind 'audio_script'; corpo = transcrição; ligados a audio_assets) ----------
-- Regra: áudio nunca na abertura; só após o "sim", precedido de SYS-PRE-AUDIO e seguido de
-- SYS-POS-AUDIO (texto sempre acompanha o áudio — RF-CON-30, R06 WA-13). Voz real da Heloísa.
insert into seed_tpl (code, name, category, segment, kind, audio_slug, body) values
  ('AEB-AUD-1', 'Roteiro do áudio — Alimentos & Bebidas', 'service', 'AEB', 'audio_script', 'aeb-aud-1',   -- R08 §2.1
   (select transcript from public.audio_assets where slug = 'aeb-aud-1')),
  ('INF-AUD-1', 'Roteiro do áudio — Infraestrutura', 'service', 'INF', 'audio_script', 'inf-aud-1',   -- R08 §2.2
   (select transcript from public.audio_assets where slug = 'inf-aud-1')),
  ('PRE-AUD-1', 'Roteiro do áudio — Prestador de serviço', 'service', 'PRE', 'audio_script', 'pre-aud-1',   -- R08 §2.3
   (select transcript from public.audio_assets where slug = 'pre-aud-1')),
  ('ESP-AUD-1', 'Roteiro do áudio — Espaço / local', 'service', 'ESP', 'audio_script', 'esp-aud-1',   -- R08 §2.4
   (select transcript from public.audio_assets where slug = 'esp-aud-1')),
  ('CER-AUD-1', 'Roteiro do áudio — Cerimonialista / assessoria', 'service', 'CER', 'audio_script', 'cer-aud-1',   -- R08 §2.5
   (select transcript from public.audio_assets where slug = 'cer-aud-1')),
  ('FOR-AUD-1', 'Roteiro do áudio — Produtor de formatura', 'service', 'FOR', 'audio_script', 'for-aud-1',   -- R08 §2.6
   (select transcript from public.audio_assets where slug = 'for-aud-1'));

-- ---------- 9.3 Pré/pós-áudio e CTA (sempre 2 opções concretas: manhã Meet, tarde visita — R08 §2.0) ----------
insert into seed_tpl (code, name, category, segment, kind, body) values
  ('SYS-PRE-AUDIO', 'Aviso antes do áudio', 'service', 'GEN', 'pre_audio',   -- R08 §2.0
   $b$Que bom! Te mandei um áudio rapidinho (uns 30 s) explicando 👇$b$),
  ('SYS-POS-AUDIO', 'Resumo escrito depois do áudio (30–60 s depois)', 'service', 'GEN', 'pos_audio',   -- R08 §2.0
   $b$Resumindo por escrito: sem mensalidade, taxa de 8% só quando um evento fecha, e os fundadores entram com destaque e selo. Consigo te mostrar em 20 min — prefere {{dia}} de manhã pelo Meet ou eu passo aí à tarde?$b$),
  ('GEN-CTA-1', 'CTA base — 2 horários', 'service', 'GEN', 'cta',   -- R08 §2.0
   $b$Consigo te mostrar o app funcionando em 20 minutos. Prefere {{dia}} às {{hora_manha}} pelo Meet ou eu passo aí {{dia}} à tarde, umas {{hora_tarde}}? Se nenhum encaixar, me diz um horário que eu me viro.$b$),
  ('AEB-CTA-1', 'CTA — Alimentos & Bebidas', 'service', 'AEB', 'cta',   -- R08 §2.1
   $b$Consigo te mostrar o app com um evento real em 20 minutos. Prefere {{dia}} às {{hora_manha}} pelo Meet ou eu passo no buffet {{dia}} à tarde, umas {{hora_tarde}}? Aproveito e já vejo a cozinha pra tirar umas fotos do perfil, se você topar.$b$),
  ('INF-CTA-1', 'CTA — Infraestrutura', 'service', 'INF', 'cta',   -- R08 §2.2
   $b$Consigo te mostrar como chega um pedido de estrutura no app em 20 minutos. Prefere {{dia}} às {{hora_manha}} pelo Meet ou eu passo no galpão {{dia}} à tarde, umas {{hora_tarde}}? Na visita eu já fotografo uns equipamentos pro perfil, se você quiser.$b$),
  ('PRE-CTA-1', 'CTA — Prestador de serviço', 'service', 'PRE', 'cta',   -- R08 §2.3
   $b$Consigo te mostrar como o cliente vê o seu perfil em 20 minutos. Prefere {{dia}} às {{hora_manha}} pelo Meet ou eu te encontro {{dia}} à tarde, umas {{hora_tarde}}, onde for melhor pra você? Se você tiver evento essa semana, também posso passar lá e já gravar um conteúdo pro seu perfil.$b$),
  ('ESP-CTA-1', 'CTA — Espaço / local', 'service', 'ESP', 'cta',   -- R08 §2.4
   $b$Consigo te mostrar em 20 minutos como um espaço aparece pra quem está buscando. Prefere {{dia}} às {{hora_manha}} pelo Meet ou eu visito o espaço {{dia}} à tarde, umas {{hora_tarde}}? Na visita eu já gravo o tour em vídeo pro seu perfil, sem custo.$b$),
  ('CER-CTA-1', 'CTA — Cerimonialista / assessoria', 'service', 'CER', 'cta',   -- R08 §2.5
   $b$Consigo te mostrar um evento montado no app, com o split funcionando, em 20 minutos. Prefere {{dia}} às {{hora_manha}} pelo Meet ou eu te encontro {{dia}} à tarde, umas {{hora_tarde}}, no seu escritório ou num café? Se você tiver evento em andamento, dá pra usar ele como exemplo.$b$),
  ('FOR-CTA-1', 'CTA — Produtor de formatura', 'service', 'FOR', 'cta',   -- R08 §2.6
   $b$Consigo te mostrar um baile montado no app — turma, ingressos e fornecedores — em 20 minutos. Prefere {{dia}} às {{hora_manha}} pelo Meet ou eu passo na produtora {{dia}} à tarde, umas {{hora_tarde}}? Se tiver baile chegando, a gente usa ele como piloto.$b$);

-- ---------- 9.4 Objeções por segmento (R08 §2.1–2.6; lógica em §2.0) ----------
-- Base do script que a IA adapta na 1ª vez (≤ 4 linhas, termina com 1 pergunta; R08 §5.2);
-- objeção repetida → humano. {{fundadores_autorizados}} só com autoriza_citar_nome = true
-- (RF-CON-23); {{dia}} = próximo retorno combinado.
insert into seed_tpl (code, name, category, segment, kind, body) values
  -- Alimentos & Bebidas (R08 §2.1)
  ('AEB-OBJ-COMISSAO',    'Objeção: comissão — A&B',                    'service', 'AEB', 'objecao',
   $b$Entendo, {{nome}}. Só pra deixar claro: não é comissão sobre o que você já vende — é só sobre o evento que chegar pela Komune e fechar. Se não fechar, não paga nada. Hoje um buffet que anuncia paga R$ 8 a R$ 40 por contato, feche ou não. Aqui você paga por resultado. E o preço continua sendo o seu.$b$),
  ('AEB-OBJ-NAOPRECISO',  'Objeção: não preciso, agenda cheia — A&B',   'service', 'AEB', 'objecao',
   $b$Que bom, e é por isso que eu te chamei: a gente quer os buffets que já são referência como fundadores, não quem tá começando. Não é pra você depender da Komune — é pra ter uma porta a mais quando aparecer aquela quarta ou quinta vazia, ou janeiro e fevereiro. Vale 20 minutos?$b$),
  ('AEB-OBJ-JATENHO',     'Objeção: já tenho clientes / indicação — A&B', 'service', 'AEB', 'objecao',
   $b$Indicação é o melhor canal que existe. A Komune é isso em escala: quem contrata avalia, o selo Verificado aparece, e a indicação continua chegando mesmo no mês em que o boca a boca dá uma parada. Você não troca nada, só soma.$b$),
  ('AEB-OBJ-MENSALIDADE', 'Objeção: quero mensalidade zero — A&B',      'service', 'AEB', 'objecao',
   $b$É zero mesmo. Não tem mensalidade, adesão, fidelidade de 12 meses nem multa pra sair. O único custo é 8% sobre o evento que fechar pela plataforma.$b$),
  ('AEB-OBJ-VOUVER',      'Objeção: vou ver e te falo — A&B',           'service', 'AEB', 'objecao',
   $b$Claro. Só pra eu não te encher à toa: o que pesa mais pra você decidir — a taxa, o app ainda ser novo, ou o tempo de cadastrar? Me diz que eu te mando só o que importa. Posso te dar um toque na {{dia}} de manhã?$b$),
  ('AEB-OBJ-QUEMUSA',     'Objeção: quem usa? — A&B',                   'service', 'AEB', 'objecao',
   $b$Estamos começando com a rede fundadora: {{fundadores_autorizados}} já entraram. E os nossos próprios eventos — Natal Experience, LDM, formaturas — rodam 100% pelo app, então o buffet fundador já entra com evento de verdade pedindo orçamento.$b$),
  ('AEB-OBJ-TEMGENTE',    'Objeção: o app tem gente? — A&B',            'service', 'AEB', 'objecao',
   $b$Vou ser transparente: hoje temos cerca de 15 mil contas criadas pelos ingressos dos nossos eventos, e a parte de fornecedores está sendo lançada agora com os fundadores. Por isso a gente garante, por escrito, pelo menos uma oportunidade real de evento nos primeiros 30 dias — vem dos eventos que a própria Komune produz.$b$),
  ('AEB-OBJ-PRECO',       'Objeção: e o meu preço? — A&B',              'service', 'AEB', 'objecao',
   $b$O preço é seu. A Komune não tabela, não pede desconto e não compara você por preço — o cliente vê o que você faz, as fotos e as avaliações. Você pode cadastrar cardápios e pacotes diferentes. Pix a Komune absorve; no cartão, o cliente vê o valor total na vitrine.$b$),

  -- Infraestrutura (R08 §2.2)
  ('INF-OBJ-COMISSAO',    'Objeção: comissão — Infraestrutura',         'service', 'INF', 'objecao',
   $b$Entendo. Os 8% só existem em cima do evento que chegar pela Komune e fechar — o seu contrato com quem já é seu cliente continua igual. E infraestrutura fecha ticket alto: é melhor pagar por um evento que fechou do que pagar anúncio, portal ou representante pra ir atrás.$b$),
  ('INF-OBJ-NAOPRECISO',  'Objeção: não preciso — Infraestrutura',      'service', 'INF', 'objecao',
   $b$Perfeito, e é justamente quem já tem operação rodando que a gente quer como fundador. A ideia não é te dar trabalho: é entrar como referência de estrutura na cidade e ter mais um canal pros meses fracos e pros eventos corporativos de meio de semana.$b$),
  ('INF-OBJ-JATENHO',     'Objeção: já tenho clientes — Infraestrutura', 'service', 'INF', 'objecao',
   $b$Ótimo sinal. A Komune não substitui seus clientes — ela coloca você na frente de quem ainda não te conhece: produtor novo, empresa fazendo evento interno, cerimonialista que perdeu o fornecedor de som de última hora. E as avaliações viram indicação automática.$b$),
  ('INF-OBJ-MENSALIDADE', 'Objeção: mensalidade zero — Infraestrutura', 'service', 'INF', 'objecao',
   $b$É zero. Nenhuma mensalidade, nenhuma taxa de adesão, nenhum contrato de fidelidade. 8% só sobre o que fechar pela plataforma.$b$),
  ('INF-OBJ-VOUVER',      'Objeção: vou ver e te falo — Infraestrutura', 'service', 'INF', 'objecao',
   $b$Sem problema. Me ajuda a te ajudar: o que você precisaria ver pra dizer sim — como chega o pedido, como é o pagamento, ou quem já está dentro? Te mando isso hoje e te chamo na {{dia}} de manhã, pode ser?$b$),
  ('INF-OBJ-QUEMUSA',     'Objeção: quem usa? — Infraestrutura',        'service', 'INF', 'objecao',
   $b$Rede fundadora com {{fundadores_autorizados}}, mais os eventos que a própria Komune produz (Natal Experience, LDM/LCC, formaturas) — todos contratam estrutura pelo app. Então tem evento de verdade no pipeline, não só promessa.$b$),
  ('INF-OBJ-TEMGENTE',    'Objeção: o app tem gente? — Infraestrutura', 'service', 'INF', 'objecao',
   $b$Vou ser direta: ~15 mil contas criadas pelos ingressos dos nossos eventos, e a parte de fornecedores está nascendo agora com os fundadores. Por isso a gente garante por escrito a primeira oportunidade real em 30 dias. Você entra cedo e com destaque, não numa lista de 200.$b$),
  ('INF-OBJ-PRECO',       'Objeção: e o meu preço? — Infraestrutura',   'service', 'INF', 'objecao',
   $b$Você define, inclusive por pacote (locação por dia, com e sem operador, com montagem). A Komune não tabela nem negocia por você. Se o cliente pagar no cartão, o valor total já aparece na vitrine; no Pix, a Komune absorve a taxa.$b$),

  -- Prestador de serviço (R08 §2.3)
  ('PRE-OBJ-COMISSAO',    'Objeção: comissão — Prestador',              'service', 'PRE', 'objecao',
   $b$Entendo, {{nome}}. Os 8% são só sobre o evento que veio pela Komune e fechou — o cliente que te achou no Instagram continua sendo seu, sem taxa nenhuma. Pensa assim: você não paga pra aparecer, paga quando fecha. E o preço continua sendo o seu.$b$),
  ('PRE-OBJ-NAOPRECISO',  'Objeção: não preciso — Prestador',           'service', 'PRE', 'objecao',
   $b$Que bom, e é por isso que faz sentido entrar como fundador: quem já está cheio entra como referência, não como quem precisa. É uma porta a mais pros meses que a agenda respira — e você decide quais pedidos aceitar.$b$),
  ('PRE-OBJ-JATENHO',     'Objeção: já tenho clientes, é tudo indicação — Prestador', 'service', 'PRE', 'objecao',
   $b$Indicação é o melhor canal — e é o que mais dói no mês em que ela para. Na Komune cada evento vira uma avaliação e o selo Verificado faz a indicação continuar chegando de gente que você ainda não conhece. Você não muda nada do que já faz.$b$),
  ('PRE-OBJ-MENSALIDADE', 'Objeção: mensalidade zero — Prestador',      'service', 'PRE', 'objecao',
   $b$É zero. Sem mensalidade, sem plano premium, sem fidelidade de 12 meses. Só 8% se um evento fechar pela plataforma.$b$),
  ('PRE-OBJ-VOUVER',      'Objeção: vou ver e te falo — Prestador',     'service', 'PRE', 'objecao',
   $b$Tranquilo. O que te faria decidir com mais segurança: ver como o cliente chega, ver o perfil de um fundador já publicado, ou entender o pagamento? Te mando só isso. Te chamo {{dia}} de manhã, pode ser?$b$),
  ('PRE-OBJ-QUEMUSA',     'Objeção: quem usa? — Prestador',             'service', 'PRE', 'objecao',
   $b$A rede fundadora tem {{fundadores_autorizados}}, e os eventos que a Komune produz (Natal Experience, LDM, formaturas) contratam foto, som e decoração pelo app. Estamos começando — quem entra agora entra como os primeiros, não como mais um.$b$),
  ('PRE-OBJ-TEMGENTE',    'Objeção: o app tem gente? — Prestador',      'service', 'PRE', 'objecao',
   $b$Honestamente: ~15 mil contas via ingressos dos nossos eventos, e a vitrine de fornecedores está sendo lançada agora com os fundadores. Por isso a gente garante por escrito a primeira oportunidade real em 30 dias, vinda dos nossos próprios eventos.$b$),
  ('PRE-OBJ-PRECO',       'Objeção: vão me comparar por preço? — Prestador', 'service', 'PRE', 'objecao',
   $b$O preço é seu e a Komune não tabela. E o app é feito pra mostrar o trabalho antes do preço: fotos, estilo, avaliações. Você pode cadastrar pacotes diferentes (ensaio, cobertura completa, por hora). No Pix a Komune absorve a taxa; no cartão o cliente vê o total.$b$),

  -- Espaço / local (R08 §2.4)
  ('ESP-OBJ-COMISSAO',    'Objeção: comissão — Espaço',                 'service', 'ESP', 'objecao',
   $b$Entendo, {{nome}}. Os 8% só valem pra reserva que chegou pela Komune e fechou. Não incide sobre o que você já fecha por indicação ou Instagram. Hoje um espaço que paga portal ou anúncio paga pra aparecer, feche ou não; aqui é o contrário. E a diária é você quem define.$b$),
  ('ESP-OBJ-NAOPRECISO',  'Objeção: o espaço vive lotado — Espaço',     'service', 'ESP', 'objecao',
   $b$Perfeito — espaço lotado é exatamente o que a gente quer como fundador, porque é referência. A Komune entra pros buracos: quinta, domingo à tarde, janeiro e fevereiro, evento corporativo de meio de semana. E você controla a agenda.$b$),
  ('ESP-OBJ-JATENHO',     'Objeção: já tenho clientes — Espaço',        'service', 'ESP', 'objecao',
   $b$Ótimo. A diferença é que na Komune o pedido chega com data, quantidade de pessoas e tipo de evento — você gasta menos tempo respondendo curioso. E cada evento realizado vira avaliação pública, que é indicação que não para.$b$),
  ('ESP-OBJ-MENSALIDADE', 'Objeção: mensalidade zero — Espaço',         'service', 'ESP', 'objecao',
   $b$É zero. Sem mensalidade, sem pacote premium, sem fidelidade de 12 meses. Só 8% sobre a reserva fechada pela plataforma.$b$),
  ('ESP-OBJ-VOUVER',      'Objeção: vou ver e te falo — Espaço',        'service', 'ESP', 'objecao',
   $b$Claro. Pra eu te mandar só o que importa: sua dúvida é mais sobre como chega o pedido, como fica a agenda, ou sobre a taxa? Te chamo na {{dia}} de manhã pra fechar essa conversa, pode ser?$b$),
  ('ESP-OBJ-QUEMUSA',     'Objeção: quem usa? — Espaço',                'service', 'ESP', 'objecao',
   $b$Rede fundadora com {{fundadores_autorizados}}, e os eventos da própria Komune (Natal Experience, LDM/LCC, formaturas) precisam de espaço — então tem demanda real desde o primeiro mês. Estamos começando; por isso o programa Fundador tem destaque e tour em vídeo.$b$),
  ('ESP-OBJ-TEMGENTE',    'Objeção: o app tem gente? — Espaço',         'service', 'ESP', 'objecao',
   $b$Transparente: cerca de 15 mil contas criadas pelos ingressos dos nossos eventos, e a vitrine de espaços está sendo lançada agora com os fundadores. Por isso garantimos por escrito a primeira oportunidade real em 30 dias.$b$),
  ('ESP-OBJ-PRECO',       'Objeção: e o meu preço? — Espaço',           'service', 'ESP', 'objecao',
   $b$Você define a diária, os pacotes (só locação, com mobiliário, com buffet parceiro) e as datas disponíveis. A Komune não tabela nem pede desconto. No cartão o cliente vê o total na vitrine; no Pix a Komune absorve a taxa.$b$),

  -- Cerimonialista / assessoria (R08 §2.5 — cerimonialista é sócio: 3% Komune + 5% para ela, no contrato)
  ('CER-OBJ-COMISSAO',    'Objeção: não gosto de comissão — Cerimonialista', 'service', 'CER', 'objecao',
   $b$Entendo — e é por isso que a gente fez diferente. Não é BV por baixo dos panos: os 5% estão no contrato, o fornecedor sabe, e você pode mostrar pro seu cliente que a Komune paga o cerimonialista por organizar o evento pela plataforma. Quem não quiser receber pode reverter em desconto pro cliente. Transparência é o argumento, não o problema.$b$),
  ('CER-OBJ-NAOPRECISO',  'Objeção: já tenho meus fornecedores — Cerimonialista', 'service', 'CER', 'objecao',
   $b$Perfeito, e você continua com eles — pode inclusive convidá-los pra entrar como fundadores junto com você. A Komune não troca seus parceiros; ela organiza o evento, o pagamento e as tarefas num lugar só, e ainda te remunera por isso.$b$),
  ('CER-OBJ-JATENHO',     'Objeção: já tenho clientes — Cerimonialista', 'service', 'CER', 'objecao',
   $b$Ótimo. A Komune serve mais pra você organizar o que já tem do que pra achar cliente: evento, fornecedores, pagamentos e cronograma no mesmo lugar — e cada evento realizado vira avaliação pública sua.$b$),
  ('CER-OBJ-MENSALIDADE', 'Objeção: mensalidade zero — Cerimonialista', 'service', 'CER', 'objecao',
   $b$É zero pra você. Cerimonialista não paga nada: recebe. O fornecedor paga 8% só quando fecha.$b$),
  ('CER-OBJ-VOUVER',      'Objeção: vou ver e te falo — Cerimonialista', 'service', 'CER', 'objecao',
   $b$Claro. O que te ajudaria a decidir: ver como fica o evento montado no app, entender como cai o seu 5%, ou conversar com uma assessoria que já entrou? Te chamo {{dia}} de manhã, pode ser?$b$),
  ('CER-OBJ-QUEMUSA',     'Objeção: quem usa? — Cerimonialista',        'service', 'CER', 'objecao',
   $b$Assessorias fundadoras: {{fundadores_autorizados}}. E a Komune produz os próprios eventos (Natal Experience, LDM/LCC, formaturas) dentro do app, então o fluxo de fornecedor, pagamento e split já está rodando de verdade.$b$),
  ('CER-OBJ-TEMGENTE',    'Objeção: o app tem gente? — Cerimonialista', 'service', 'CER', 'objecao',
   $b$Sendo transparente: ~15 mil contas via ingressos dos nossos eventos, e a parte de fornecedores está sendo lançada agora com os fundadores. Pra cerimonialista o valor não depende de "ter gente": é a organização do evento e a remuneração que já funcionam no dia 1.$b$),
  ('CER-OBJ-PRECO',       'Objeção: vou ter que cobrar menos? — Cerimonialista', 'service', 'CER', 'objecao',
   $b$Não. Seu honorário continua o mesmo, cobrado do seu jeito. Os 5% são adicionais, sobre o que os fornecedores fecharem pela Komune nos eventos que você organiza. Nada muda no seu contrato com o cliente.$b$),

  -- Produtor de formatura (R08 §2.6)
  ('FOR-OBJ-COMISSAO',    'Objeção: comissão — Formatura',              'service', 'FOR', 'objecao',
   $b$Entendo. Pra produtor a conta é ao contrário: você não paga — quem paga é o fornecedor (8%), e 5% volta pra você como quem organiza o evento, de forma transparente e contratual. E você continua livre pra negociar direto com quem quiser fora do app.$b$),
  ('FOR-OBJ-NAOPRECISO',  'Objeção: tenho meus fornecedores há anos — Formatura', 'service', 'FOR', 'objecao',
   $b$E eles continuam sendo seus — a ideia é trazê-los pra dentro como fundadores junto com você. O ganho é organização: contrato, pagamento, cronograma e a turma no mesmo lugar. Menos planilha, menos grupo, menos "quem pagou?".$b$),
  ('FOR-OBJ-JATENHO',     'Objeção: já tenho turmas — Formatura',       'service', 'FOR', 'objecao',
   $b$Ótimo. A Komune ajuda a manter: a turma fica dentro do app, compra ingresso, vê o rateio, recebe aviso — e a próxima comissão de formatura da mesma faculdade vê o baile que você fez, com avaliação.$b$),
  ('FOR-OBJ-MENSALIDADE', 'Objeção: mensalidade zero — Formatura',      'service', 'FOR', 'objecao',
   $b$É zero. Produtor não paga nada pra usar. O fornecedor paga 8% quando fecha, e uma parte volta pra você.$b$),
  ('FOR-OBJ-VOUVER',      'Objeção: vou ver e te falo — Formatura',     'service', 'FOR', 'objecao',
   $b$Claro. Me diz o que pesa: organização da turma, a parte dos fornecedores, ou a remuneração? Te mando só isso. E posso te chamar {{dia}} de manhã, antes da sua semana engrenar?$b$),
  ('FOR-OBJ-QUEMUSA',     'Objeção: quem usa? — Formatura',             'service', 'FOR', 'objecao',
   $b$Produtores fundadores: {{fundadores_autorizados}}. E a Komune já roda formaturas próprias dentro do app — ingresso, rateio e fornecedor pagando pela plataforma. Não é protótipo, tá em uso.$b$),
  ('FOR-OBJ-TEMGENTE',    'Objeção: o app tem gente? — Formatura',      'service', 'FOR', 'objecao',
   $b$Transparente: ~15 mil contas criadas via ingressos dos nossos eventos, e a parte de fornecedores está sendo lançada com os fundadores. Pra você o valor está na organização do baile e da turma desde o dia 1 — a vitrine é bônus.$b$),
  ('FOR-OBJ-PRECO',       'Objeção: e o meu preço? — Formatura',        'service', 'FOR', 'objecao',
   $b$Seu contrato com a comissão de formatura não muda. A Komune não interfere no que você cobra nem no que negocia com fornecedor fora do app. Dentro do app, você vê o preço do fornecedor e a sua parte já calculada.$b$);

-- ---------- 9.5 Régua de silêncio: follow-up ÚNICO D+3 (RF-CON-13; PRD Apêndice C; R06 C.2; R08 §3.2) ----------
-- O PRD reduz a régua do R08 a 1 abertura + 1 follow-up por WhatsApp. V1 é o texto do PRD/R06
-- (canônico); V2/V3 vêm do R08 §3.2 D+3 com a saída fácil explícita. O R08 D3-V1 ("categoria
-- mais procurada no app") não entra: afirma um ranking que a base de conhecimento precisa
-- sustentar com número real (RF-CON-23/24). Variante sorteada sem repetir para o mesmo contato.
-- As automações de Contatado (Funis 1 e 3) apontam para GEN-FUP-D3-V1, não para GEN-FUP-D3-*:
-- o Apêndice C e o RF-CON-13 fixam UM texto para o único follow-up permitido, e ele é o que o
-- R06 validou juridicamente. V2 ainda cita {{fundador_autorizado}} — só pode sair com nome
-- autorizado (RF-CON-23) e com fundador real na semana, o que não existe no D1–D5. V2/V3 ficam
-- cadastrados para um teste A/B futuro, decidido por Bárbara/Dennis.
insert into seed_tpl (code, name, category, segment, kind, meta_status, body) values
  ('GEN-FUP-D3-V1', 'Follow-up único D+3 — convite em aberto (PRD)', 'marketing', 'GEN', 'followup', 'pending',   -- PRD Apêndice C / R06 C.2
   $b$Oi, {{nome}}, só passando para deixar o convite em aberto. Se fizer sentido, me diga o melhor horário para uma conversa rápida; se não, sem problema — respondendo SAIR eu não te escrevo mais. Abraço, Heloísa (Komune).$b$),
  ('GEN-FUP-D3-V2', 'Follow-up único D+3 — fundador novo', 'marketing', 'GEN', 'followup', 'pending',   -- R08 §3.2
   $b${{nome}}, entrou mais um {{categoria}} fundador essa semana: {{fundador_autorizado}}. Queria ter você junto desde o começo. Posso te explicar em 30 s? Se não for o momento, é só responder SAIR que eu não te escrevo mais.$b$),
  ('GEN-FUP-D3-V3', 'Follow-up único D+3 — objetiva', 'marketing', 'GEN', 'followup', 'pending',   -- R08 §3.2
   $b${{nome}}, deixa eu ser objetiva: sem mensalidade, 8% só quando fecha, destaque pra quem entra agora. Se fizer sentido, te mostro em 20 min; se não fizer, me diz (ou responde SAIR) que eu paro de te chamar 🙂$b$);

-- ---------- 9.6 Encerramento elegante D+10/14 — só para quem já interagiu (RF-CON-13/14; R08 §3.2 D+14) ----------
insert into seed_tpl (code, name, category, segment, kind, meta_status, body) values
  ('GEN-FUP-D14-V1', 'Encerramento D+14 — lugar reservado', 'marketing', 'GEN', 'encerramento', 'pending',   -- R08 §3.2 / PRD Apêndice C
   $b${{nome}}, pelo silêncio imagino que não seja o momento. Vou parar de te chamar por aqui. Se quiser retomar, é só responder 'sim' — o lugar de fundador fica reservado até {{data}}.$b$),
  ('GEN-FUP-D14-V2', 'Encerramento D+14 — última mensagem', 'marketing', 'GEN', 'encerramento', 'pending',   -- R08 §3.2
   $b${{nome}}, última mensagem minha por agora, prometo 🙂 Se em algum momento fizer sentido, me chama que eu te mostro em 20 min. Sucesso nos eventos!$b$),
  ('GEN-FUP-D14-V3', 'Encerramento D+14 — link do app', 'marketing', 'GEN', 'encerramento', 'pending',   -- R08 §3.2
   $b${{nome}}, vou fechar sua conversa aqui pra não te incomodar. Deixo só o link do app pra você conhecer quando quiser: {{link_app}}. Qualquer coisa, é só chamar.$b$);

-- ---------- 9.7 Reativação com gancho obrigatório (RF-CON-15; R08 §3.4) ----------
-- Nunca para "não" firme, perdido ou opt-out; o CRM exige o campo gancho antes de liberar.
insert into seed_tpl (code, name, category, segment, kind, meta_status, body) values
  ('GEN-REA-60-V1', 'Reativação D+60 — gancho', 'marketing', 'GEN', 'reativacao', 'pending',   -- R08 §3.4 / PRD Apêndice C
   $b$Oi, {{nome}}, Heloísa da Komune. Faz um tempo que a gente conversou. Te chamo porque {{gancho}}. Se agora fizer sentido, te mostro em 20 min; se não, sem problema.$b$),
  ('GEN-REA-60-V2', 'Reativação D+60 — novos fornecedores + gancho', 'marketing', 'GEN', 'reativacao', 'pending',   -- R08 §3.4
   $b${{nome}}, lembra da Komune? Desde a nossa conversa entraram {{n}} fornecedores de {{categoria}} e {{gancho}}. Quer dar uma olhada?$b$),
  ('GEN-REA-90-V1', 'Reativação D+90 — perdido suave (1 toque)', 'marketing', 'GEN', 'reativacao', 'pending',   -- R08 §3.4
   $b${{nome}}, sem insistência: {{gancho}}. Se quiser, é só responder 'quero'. Se não, já paro por aqui.$b$);

-- ---------- 9.8 Mensagens fixas do sistema (R08 §2.7 + PRD §10.7 / R06 §C / RF-CON-11/21/26) ----------
insert into seed_tpl (code, name, category, segment, kind, body) values
  ('GEN-SYS-QUEM-SOMOS', 'Quem é você? / como pegou meu número?', 'service', 'GEN', 'sistema',   -- R08 §2.7 + PRD §10.7 e R06 C.3 (fonte com link, base legal, SAIR, encarregado)
   $b$Justo perguntar. Sou a Heloísa, do comercial da Komune (komune.app / @komune.natal). A gente está montando a rede de fornecedores de eventos de Natal e encontrei seu contato no {{origem}}, que é público: {{source_url}}. A Komune usa dados de contato profissional públicos só para convidar fornecedores da região, com base no legítimo interesse previsto na LGPD (art. 7º, IX), e não repassa a ninguém. Se preferir não receber mais mensagens, é só responder SAIR que eu paro por aqui. Dúvidas sobre dados: {{email_encarregado}} · komune.app/privacidade$b$),
  ('GEN-SYS-E-ROBO', 'É robô?', 'service', 'GEN', 'sistema',   -- R08 §2.7 (RF-CON-26: nunca negar automação)
   $b$Tem um pouco de cada 🙂 As primeiras mensagens saem de um sistema pra eu conseguir responder rápido, mas quem fala com você sou eu, Heloísa — o áudio é minha voz e a reunião sou eu. Quer que eu te mande o áudio agora?$b$),
  ('GEN-SYS-OPTOUT', 'Opt-out — confirmação única', 'service', 'GEN', 'sistema',   -- R08 §2.7 (RF-CON-19)
   $b$Entendido, {{nome}}. Não vou mais te mandar mensagem. Obrigada pelo retorno e sucesso nos eventos.$b$),
  ('GEN-SYS-NAO-SUAVE', 'Não suave — agradece e pergunta o motivo', 'service', 'GEN', 'sistema',   -- R08 §2.7
   $b$Tranquilo, {{nome}}, obrigada por responder. Se um dia fizer sentido, a porta está aberta. Posso te perguntar só uma coisa, pra gente melhorar: foi mais a taxa, o momento, ou não faz sentido pro seu negócio?$b$),
  ('GEN-SYS-NAO-FIRME', 'Não firme — encerra sem pergunta', 'service', 'GEN', 'sistema',   -- R08 §2.7
   $b$Entendido, {{nome}}. Obrigada pela sinceridade — não vou insistir. Sucesso por aí.$b$),
  ('GEN-SYS-NAO-E-PESSOA', 'Não é a pessoa / número errado', 'service', 'GEN', 'sistema',   -- R08 §2.7
   $b$Desculpa incomodar! Esse número não é da {{empresa}}? Se souber quem cuida da parte comercial por lá, agradeço muito o contato. Se não, já paro por aqui.$b$),
  ('GEN-SYS-HOSTIL', 'Hostil / reclamação', 'service', 'GEN', 'sistema',   -- R08 §2.7
   $b$Você tem razão, e peço desculpa. Vou parar as mensagens agora. Se quiser conversar em outro momento, é só me chamar.$b$),
  ('GEN-SYS-FORA-CIDADE', 'Fora de Natal', 'service', 'GEN', 'sistema',   -- R08 §2.7
   $b$Boa pergunta! A gente está começando por Natal e vai abrir outras cidades em seguida. Posso te avisar quando chegar em {{cidade}}? Só me diz e eu anoto.$b$),
  ('GEN-SYS-CLIENTE-QUER-CONTRATAR', 'Pessoa quer contratar, não fornecer', 'service', 'GEN', 'sistema',   -- R08 §2.7
   $b$Que bom! Então você está do outro lado 🙂 O app é gratuito pra quem organiza: {{link_app}}. Me conta em uma linha o que você está planejando (tipo de evento, data, quantas pessoas) que eu te ajudo a encontrar os fornecedores certos.$b$),
  ('GEN-SYS-PEDIU-LIGACAO', 'Pediu ligação', 'service', 'GEN', 'sistema',   -- R08 §2.7
   $b$Claro! Te ligo em instantes deste mesmo número, tudo bem?$b$),
  ('GEN-SYS-HUMANO-ASSUME', 'Humano assume (escalada)', 'service', 'GEN', 'sistema',   -- R08 §2.7
   $b$Deixa eu te responder com calma, {{nome}}. Vou te dar um retorno ainda hoje, até as {{hora}} — pode ser?$b$),
  ('GEN-OBJ-TAXA-INFO', 'Quanto custa? — taxa direta', 'service', 'GEN', 'sistema',   -- R08 §2.7 (PEDIU_TAXA_PRECO: texto fixo)
   $b$Direto ao ponto: não tem mensalidade. O fornecedor paga 8% só sobre o evento que fechar pela Komune — se não fechar, não paga. Quando o evento tem cerimonialista, a Komune fica com 3% e o cerimonialista recebe 5%. Pix a gente absorve; no cartão o cliente vê o valor total. Consigo te mostrar isso funcionando em 20 min — {{dia}} de manhã pelo Meet ou à tarde aí com você?$b$),
  ('GEN-SYS-TRANSPARENCIA', 'Frase de transparência quando o robô assume', 'service', 'GEN', 'sistema',   -- PRD §10.7 / R06 C.7 (RF-CON-26; enviada uma vez)
   $b$(Parte das respostas aqui é automática para agilizar; se preferir falar direto comigo, é só escrever HUMANO.) — Heloísa$b$),
  ('GEN-SYS-PEDIDO-AUTORIZACAO', 'Pedido de autorização do pré-cadastro (2ª mensagem, após o áudio)', 'service', 'GEN', 'sistema',   -- PRD RF-CON-21 / Apêndice C
   $b$Pra adiantar, já deixei um rascunho privado do seu perfil com o que está público no seu {{origem}} — nome, categoria e bairro. Ninguém vê esse rascunho além de você, e nada é publicado sem o seu ok. Você autoriza a Komune a usar esse material? Se sim, te mando o link.$b$),
  ('GEN-SYS-AVISO-PRECADASTRO', 'Aviso de pré-cadastro (vai com o link de reivindicação)', 'service', 'GEN', 'sistema',   -- PRD §10.7 / R06 C.4 (PRE-04)
   $b${{nome}}, para facilitar, preparei um rascunho do perfil de {{empresa}} na Komune com informações públicas (nome, categoria, bairro e contato). Ninguém vê esse rascunho além de você — ele só entra no ar se você revisar, adicionar suas fotos e aceitar os termos. Se você não quiser, ele é apagado automaticamente em 30 dias (ou na hora, se pedir). Link para revisar: {{link}}. Dúvidas sobre dados: komune.app/privacidade$b$),
  ('GEN-SYS-EXCLUSAO-CONFIRMA', 'Confirmação de exclusão / oposição', 'service', 'GEN', 'sistema',   -- PRD §10.7 / R06 C.6 (RF-ADM-04)
   $b$Pronto, {{nome}}: removemos seus dados de contato da nossa base de prospecção e cancelamos qualquer mensagem futura. Guardamos apenas um registro mínimo (identificador do número + data) para garantir que não voltemos a te procurar, como a LGPD exige que respeitemos sua oposição. Se houver um rascunho de perfil, ele também foi apagado. Se precisar de comprovante ou tiver outra solicitação, fale com nosso encarregado de dados: {{email_encarregado}}. Obrigada pelo retorno.$b$),
  ('GEN-SYS-FORA-HORARIO', 'Resposta automática fora do horário (08–20 h)', 'service', 'GEN', 'sistema',   -- PRD RF-CON-11 ("resposta automática curta com previsão")
   $b$Oi, {{nome}}! Recebi sua mensagem 🙂 Agora estou fora do horário, mas te respondo {{previsao}}. Se preferir falar direto comigo, é só escrever HUMANO.$b$);

-- ---------- 9.9 Pós-reunião — em até 1 hora (R08 §4.2; PRD Apêndice C) ----------
insert into seed_tpl (code, name, category, segment, kind, body) values
  ('GEN-POS-RESUMO', 'Pós-reunião — resumo do combinado', 'service', 'GEN', 'pos_reuniao',   -- R08 §4.2
   $b${{nome}}, obrigada pelo tempo! Resumindo o que a gente combinou:
• Você entra como Fornecedor Fundador: destaque na vitrine, selo, participação nos vídeos e a primeira oportunidade real em até 30 dias.
• Sem mensalidade; 8% só quando um evento fecha pela Komune.
• Próximo passo: completar o cadastro no painel (leva ~15 min).
Seu pré-cadastro já está montado: {{link}}. Faltam só {{campos_faltantes}} pra publicar.$b$),
  ('GEN-POS-AUTORIZACAO', 'Pós-reunião — pedido de autorização de uso de dados públicos', 'service', 'GEN', 'pos_reuniao',   -- R08 §4.2 (obrigatório antes de usar fotos/textos públicos)
   $b$Uma coisa importante: pra adiantar seu perfil, a gente já montou um rascunho com as informações públicas do seu {{origem}} — nome, descrição, categoria e algumas fotos. Você autoriza a Komune a usar esse material no seu perfil? Responde "autorizo" que eu libero. Se preferir trocar as fotos ou o texto, dá pra fazer no painel a qualquer hora. Nada é publicado sem o seu ok.$b$),
  ('GEN-POS-VISITA-FOTOS', 'Pós-visita — autorização das fotos/vídeo feitos pela equipe', 'service', 'GEN', 'pos_reuniao',   -- R08 §4.2
   $b${{nome}}, as fotos/vídeo que a gente fez hoje ficaram ótimos. Posso usar no seu perfil e nos conteúdos da Komune (Instagram, vídeos de lançamento)? Me responde "pode" que eu já publico com seu crédito.$b$);

-- ---------- 9.10 Agendamento e anti no-show (R08 §4.1; RF-CON-17; utilidade fora da janela) ----------
insert into seed_tpl (code, name, category, segment, kind, meta_status, body) values
  ('GEN-AGD-CONFIRMA-MEET', 'Confirmação imediata — Meet', 'service', 'GEN', 'agendamento', null,   -- R08 §4.1
   $b$Fechado, {{nome}}: {{data_hora}}, pelo Meet — 20 minutos. Link: {{link}}. Já vai cair um convite no seu e-mail/agenda. Pra eu preparar direitinho: o que você mais quer ver — como chega o pedido, o pagamento, ou o perfil pronto?$b$),
  ('GEN-AGD-CONFIRMA-VISITA', 'Confirmação imediata — visita', 'service', 'GEN', 'agendamento', null,   -- R08 §4.1
   $b$Fechado, {{nome}}: {{data_hora}} aí no {{endereco}}. Vou eu, Heloísa{{acompanhante}}. Leva uns 20 minutos. Se puder, deixa um lugar pra gente abrir o notebook.$b$),
  ('GEN-AGD-24H-MEET', 'Lembrete 24 h — Meet (pede confirmação)', 'utility', 'GEN', 'agendamento', 'pending',   -- R08 §4.1
   $b$Oi, {{nome}}! Amanhã, {{hora}}, nossa conversa de 20 min pelo Meet ({{link}}). Tá confirmado? Responde "confirmo" ou "preciso remarcar", sem problema nenhum.$b$),
  ('GEN-AGD-24H-VISITA', 'Lembrete 24 h — visita (pede confirmação)', 'utility', 'GEN', 'agendamento', 'pending',   -- R08 §4.1 (adaptado para visita)
   $b$Oi, {{nome}}! Amanhã, {{hora}}, passo aí no {{endereco}} pra nossa conversa de 20 min. Tá confirmado? Responde "confirmo" ou "preciso remarcar", sem problema nenhum.$b$),
  ('GEN-AGD-1H-MEET', 'Lembrete 1 h — Meet', 'utility', 'GEN', 'agendamento', 'pending',   -- R08 §4.1
   $b${{nome}}, daqui a pouco, às {{hora}} 🙂 Link: {{link}}. Já deixei seu perfil quase pronto pra te mostrar na tela.$b$),
  ('GEN-AGD-1H-VISITA', 'Lembrete 1 h — visita', 'utility', 'GEN', 'agendamento', 'pending',   -- R08 §4.1
   $b${{nome}}, saio daqui em 30 min, chego aí por volta das {{hora}}. Tudo certo?$b$),
  ('GEN-AGD-NOSHOW-1', 'No-show — +15 min (humano tenta ligar antes)', 'utility', 'GEN', 'agendamento', 'pending',   -- R08 §4.1
   $b$Oi, {{nome}}, entrei na sala e não te encontrei — imagino que apareceu coisa aí, acontece. Consigo hoje às {{hora_hoje}} ou amanhã às {{hora_amanha}}. Qual encaixa?$b$),
  ('GEN-AGD-NOSHOW-2', 'No-show — D+1 sem resposta', 'utility', 'GEN', 'agendamento', 'pending',   -- R08 §4.1
   $b${{nome}}, sem pressão: se preferir, me diz um dia da semana que vem que eu me adapto. Se não for o momento, também me diz que eu paro por aqui 🙂$b$);

-- ---------- 9.11 Onboarding — "perturbar com educação", publicação, 1º lead e feedback (R08 §4.3–4.4; RF-CON-16; PRD §5.4) ----------
-- Sempre "falta só X" (campo lido da plataforma), nunca "você não terminou". No MVP viram
-- tarefas humanas com o texto pronto; modelos de utilidade para a v1.
insert into seed_tpl (code, name, category, segment, kind, meta_status, body) values
  ('GEN-ONB-D1', 'Onboarding D+1 — abriu o painel', 'utility', 'GEN', 'onboarding', 'pending',   -- R08 §4.3
   $b$Oi, {{nome}}! Vi que você abriu o painel e já está com {{campos_preenchidos}} no lugar 👏 Falta só {{campo}} pra publicar. São 3 minutos: {{link}}. Qualquer dúvida, me chama que eu faço junto com você.$b$),
  ('GEN-ONB-D1-NAO-ABRIU', 'Onboarding D+1 — nem abriu', 'utility', 'GEN', 'onboarding', 'pending',   -- R08 §4.3
   $b$Oi, {{nome}}! Seu pré-cadastro está te esperando aqui: {{link}}. Leva uns 15 minutos. Se preferir, marco 10 min por chamada e a gente faz junto — amanhã às {{hora_manha}} ou às {{hora_tarde}}?$b$),
  ('GEN-ONB-D3', 'Onboarding D+3 — falta só um campo', 'utility', 'GEN', 'onboarding', 'pending',   -- R08 §4.3
   $b${{nome}}, passando pra lembrar: falta só {{campo}} pra seu perfil ir ao ar. Tem {{n}} pessoas organizando {{tipo_evento}} pra {{mes}} e você ainda não aparece pra elas. Quer que eu ligue e a gente finaliza em 5 min?$b$),
  ('GEN-ONB-D7', 'Onboarding D+7 — 90% pronto', 'utility', 'GEN', 'onboarding', 'pending',   -- R08 §4.3
   $b${{nome}}, vou ser sincera: seu perfil está 90% pronto e parado 🙂 Sei que a rotina engole. Me dá 10 minutos hoje — te ligo às {{hora}} e a gente termina juntos? Se tiver travado em alguma coisa (documento, conta pra receber, foto), me diz que eu resolvo.$b$),
  ('GEN-ONB-D14', 'Onboarding D+14 — última lembrança automática', 'utility', 'GEN', 'onboarding', 'pending',   -- R08 §4.3
   $b${{nome}}, não quero ser chata, então essa é a última lembrança automática. Quando quiser terminar, o link é {{link}} e eu estou aqui. Se algo no cadastro te travou, me conta — isso ajuda a gente a melhorar pro próximo fundador.$b$),
  ('GEN-ONB-TRAVOU', 'Onboarding — travou num passo', 'utility', 'GEN', 'onboarding', 'pending',   -- R08 §4.3
   $b${{nome}}, vi que travou na parte de {{etapa_travada}}. Isso acontece — {{instrucao}}. Se preferir, te ligo agora e a gente resolve em 2 min.$b$),
  ('GEN-ONB-PUBLICADO', 'Publicado — parabéns + pedido de compartilhamento', 'utility', 'GEN', 'onboarding', 'pending',   -- R08 §4.4 / PRD Apêndice C
   $b${{nome}}, seu perfil está no ar 🎉 Olha como ficou: {{link_perfil}}. Já com o selo de Fornecedor Fundador. Duas coisas que ajudam muito: (1) coloca o link na bio do Instagram; (2) me manda uma foto sua/da equipe pra gente te apresentar nos nossos canais essa semana. E lembra: pedido que chegar, responde em até 24 h — o app dá prioridade pra quem responde rápido.$b$),
  ('GEN-ONB-PRIMEIRO-LEAD', 'Primeiro lead — chegou!', 'utility', 'GEN', 'onboarding', 'pending',   -- R08 §4.4 / PRD Apêndice C
   $b${{nome}}, chegou! 🎯 {{cliente}} pediu orçamento pra {{tipo_evento}} em {{data}}, {{n}} pessoas. Está no seu painel: {{link}}. Responde por lá em até 24 h que eu acompanho de perto — se precisar de ajuda pra montar a proposta, me chama.$b$),
  ('GEN-ONB-LEAD-SEM-RESPOSTA', 'Lead há 24 h sem resposta', 'utility', 'GEN', 'onboarding', 'pending',   -- R08 §4.4
   $b${{nome}}, o pedido de {{cliente}} está esperando sua resposta desde ontem. Quer que eu te ajude a responder? Pedido parado esfria rápido.$b$),
  ('GEN-ONB-FEEDBACK-7D', 'Feedback D+7 após publicar', 'utility', 'GEN', 'onboarding', 'pending',   -- R08 §4.4 / PRD Apêndice C
   $b${{nome}}, uma pergunta rápida e sincera, pra gente melhorar: o que foi mais difícil no cadastro? E o que você esperava encontrar no app e não achou? Pode responder por áudio, do jeito que vier.$b$),
  ('GEN-ONB-FEEDBACK-POS-LEAD', 'Feedback após o 1º lead respondido', 'utility', 'GEN', 'onboarding', 'pending',   -- R08 §4.4
   $b${{nome}}, como foi o primeiro contato com {{cliente}}? Fechou, ficou em negociação ou não rolou? Me conta em uma linha — isso define quem a gente manda pra você em seguida.$b$),
  ('GEN-ONB-PARTICIPACAO-VIDEO', 'Benefício Fundador — participação nos vídeos', 'marketing', 'GEN', 'onboarding', 'pending',   -- R08 §4.4
   $b${{nome}}, como fundador você entra nos vídeos de lançamento da Komune. A gente grava {{dia}} em {{local}} — 15 minutos, você fala do seu trabalho e a gente cuida do resto. Topa? Se preferir, gravamos aí no seu espaço.$b$);

-- =====================================================================
-- 10. Upsert final dos modelos: variables derivadas do corpo ({{nome}} → "nome"); áudio ligado
--     pelo slug; meta_status 'approved' já obtido na Meta nunca é rebaixado pela seed.
-- =====================================================================
insert into public.message_templates
  (template_code, name, channel, category, segment, kind, variant, meta_status, language, body, variables, audio_asset_id, is_active)
select t.code, t.name, 'whatsapp'::app.channel, t.category, t.segment, t.kind, t.variant, t.meta_status, 'pt_BR', t.body,
       coalesce((select jsonb_agg(v order by v)
                   from (select distinct m[1] as v
                           from regexp_matches(t.body, '\{\{([a-z0-9_]+)\}\}', 'g') as m) d), '[]'::jsonb),
       (select a.id from public.audio_assets a where a.slug = t.audio_slug),
       t.is_active
  from seed_tpl t
on conflict (template_code) do update
  set name           = excluded.name,
      category       = excluded.category,
      segment        = excluded.segment,
      kind           = excluded.kind,
      variant        = excluded.variant,
      body           = excluded.body,
      variables      = excluded.variables,
      audio_asset_id = excluded.audio_asset_id,
      is_active      = excluded.is_active,
      meta_status    = case when public.message_templates.meta_status = 'approved'
                            then public.message_templates.meta_status
                            else excluded.meta_status end;

drop table if exists seed_tpl;

end $seed$;

-- =====================================================================
-- 11. Quem pode entrar (RF-ADM-01; SSO Google restrito). O trigger em auth.users bloqueia
--     qualquer e-mail fora de allowed_users/allowed_domains.
--     Domínio da empresa: komune.app.br → papel padrão 'sdr' (menor privilégio operacional;
--     o admin promove em profiles.role depois do primeiro login).
--     DECISÃO HUMANA (Rafael/Luiz): informar os e-mails de Bárbara (gestor), Heloísa (sdr),
--     Gustavo (sdr), Dennis (financeiro) e Luiz (admin, RF-ADM-01). Quem usar @komune.app.br
--     entra pelo domínio como sdr; quem usar outro domínio precisa de linha em allowed_users.
-- =====================================================================
insert into public.allowed_domains (domain, default_role, is_active) values
  ('komune.app.br', 'sdr', true)
on conflict (domain) do update
  set default_role = excluded.default_role,
      is_active    = excluded.is_active;

insert into public.allowed_users (email, role, note) values
  ('rafael@rafaelabreu.com',       'admin',      'Rafael, conta pessoal'),
  ('amovingmax@gmail.com',         'admin',      'Matheus, conta pessoal'),
  ('komune@komune.app.br',         'admin',      'Conta corporativa KOMUNE')
  -- PENDENTE DE DECISÃO HUMANA (Rafael, com Matheus e Luiz): entraram aqui, no diff do
  -- catálogo de desfechos do D3, cinco contas do domínio da empresa informadas pelo
  -- Matheus em 04/09/2026 — matheus.admin@, luyz.admin@ e rafael.admin@ como 'admin',
  -- dennis.admin@ como 'financeiro' e heloiza.admin@ como 'sdr'. Ficaram FORA por três
  -- motivos: conceder admin é decisão de acesso, e não de catálogo, e não viaja no mesmo
  -- commit; a tela de origem dizia "e-mail alternativo", que no Google Workspace é
  -- apelido, e apelido não casa com o e-mail que o OAuth devolve, então as linhas podem
  -- nascer mortas; e o teste 08_seed (itens "3 e-mails nominais" e "os e-mails nominais
  -- iniciais são admin") reprova a lista com elas. Enquanto isso, quem tem conta
  -- @komune.app.br entra pelo allowed_domains abaixo como 'sdr' e o admin promove em
  -- profiles.role depois do primeiro login, que é o caminho de menor privilégio.
on conflict (email) do update
  set role = excluded.role,
      note = excluded.note;

-- =====================================================================
-- 12. Catálogo de desfechos de interação (RF-FUN-12 catálogo e RF-FUN-13 janela de
--     recontato; spec docs/design/spec-desfechos-de-interacao.md §3; tabela criada na
--     migração 20260904000800). Alimenta os chips do formulário de 20 s (RF-MET-06), a
--     contagem de porta batida e porta aberta (RF-MET-01), a fila das 06:00 (RF-CON-08),
--     o Meu dia (RF-MET-04) e os relatórios por canal (RF-REL-02/06). Convenções:
--       * Uma linha por superfície (whatsapp, ligacao, visita, reuniao, instagram_dm);
--         'triagem' fica reservada para os motivos de descarte da caixa de triagem (D4).
--       * name = rótulo do chip, no máximo 28 caracteres, para caber na tela do celular.
--         "Perfil inativo, não fornece" encurta o texto da §3 ("Perfil inativo ou não é
--         fornecedor", 34 caracteres), que não passaria no check da tabela.
--       * position agrupa por superfície (1xx WhatsApp, 2xx ligação, 3xx visita,
--         4xx reunião, 5xx DM) e ordena os chips dentro dela.
--       * cooldown_days = piso de espera lido como FILTRO da fila, nunca gatilho de
--         reenvio (spec §5); 36500 = permanente. can_reactivate = false tira o alvo da
--         reativação do RF-CON-15; o BLOQUEIO da view v_contact_cooldown, esse, só nasce
--         de desfecho que leva o negócio a etapa de perda, e cai na reabertura humana
--         registrada (RF-FUN-08), menos no opt-out, que não reabre (RF-CON-18).
--       * "Número inválido" e "Número errado" são a exceção proposital: can_reactivate
--         = false (ficam fora da reativação) com cooldown_days = 36500 e SEM etapa de
--         destino, logo NÃO bloqueiam a organização. Quem segura o alvo é a janela, e
--         ela cai sozinha no primeiro toque por outro canal (DM, visita, ligação no
--         número novo), que é literalmente a próxima ação desses dois chips. Com
--         cooldown 0 o número morto voltaria à fila das 06:00 na manhã seguinte,
--         gastando vaga do teto do RF-CON-10 e repetindo envio a um número que a Cloud
--         API já recusou (risco 2, quality rating). PENDENTE DE DECISÃO HUMANA
--         (Rafael/Bárbara): a §3 da spec dizia cooldown 0 nas duas linhas.
--       * next_action_offset_days nulo = a data sai da temperatura resultante
--         (D+1 quente, D+3 morno, D+7 frio, RF-MET-06), que é o caso de "na data combinada".
--       * target_stage_slug é slug e não FK: a etapa é por funil e o destino se resolve
--         no funil do próprio negócio. Todos os slugs abaixo existem no funil fornecedor
--         (bloco 7) e a autoverificação do bloco 13 confere isso.
--       * counts_as é o TETO da contagem: porta aberta só é gravada se o formulário
--         também disser decisor ou influenciador (RF-MET-01).
--       * requires_lost_reason = true exige lost_reason_id no negócio (RF-FUN-04). Os dois
--         desfechos de opt-out vão para a etapa optout, que é perda sem motivo da lista.
--     Como os demais catálogos, a seed governa estas linhas: reaplicar devolve nome,
--     posição, janela e is_active ao padrão do produto enquanto a tela de administração
--     (RF-ADM-02) não existe. Chip aposentado é sempre is_active = false, nunca delete,
--     porque atividades antigas apontam para ele.
-- =====================================================================
insert into public.interaction_outcomes
  (slug, name, surfaces, position, is_active, cooldown_days, can_reactivate,
   next_action_kind, next_action_label, next_action_offset_days,
   target_stage_slug, sets_temperature, requires_lost_reason, counts_as) values
  -- ---------- WhatsApp (7) — o desfecho descreve a PORTA; o que foi dito é a intenção do Apêndice C ----------
  ('wa_sem_resposta',        'Enviado, sem resposta',      '{whatsapp}',     101, true,     3, true,  'follow_up', 'Follow-up D+3',              3, null,                    null,     false, 'batida'),
  ('wa_respondeu',           'Respondeu',                  '{whatsapp}',     102, true,     0, true,  'message',   'Responder em 15 min',        0, 'respondeu',             'morno',  false, 'aberta'),
  ('wa_nao_e_a_pessoa',      'Não é a pessoa',             '{whatsapp}',     103, true,     0, true,  'other',     'Achar o decisor',            0, null,                    null,     false, 'batida'),
  ('wa_agora_nao',           'Agora não',                  '{whatsapp}',     104, true,    30, true,  'message',   'Reativar com gancho',       30, 'nutricao',              'frio',   false, 'aberta'),
  ('wa_nao_firme',           'Não, definitivo',            '{whatsapp}',     105, true,    90, false, null,        null,                      null, 'perdido',               null,     true,  'aberta'),
  ('wa_numero_invalido',     'Número inválido',            '{whatsapp}',     106, true, 36500, false, 'other',     'Buscar outro canal',         0, null,                    null,     false, 'nenhuma'),
  ('wa_optout',              'Pediu para parar',           '{whatsapp}',     107, true, 36500, false, null,        null,                      null, 'optout',                'frio',   false, 'nenhuma'),
  -- ---------- Ligação (8) — chips do formulário de 20 s (RF-MET-06); régua 1+1 do RF-CON-13 ----------
  ('lig_nao_atendeu',        'Não atendeu',                '{ligacao}',      201, true,     1, true,  'call',      'Ligar D+1 (última)',         1, null,                    null,     false, 'batida'),
  ('lig_caixa_postal',       'Caixa postal',               '{ligacao}',      202, true,     1, true,  'call',      'Ligar D+1',                  1, null,                    null,     false, 'batida'),
  ('lig_numero_errado',      'Número errado',              '{ligacao}',      203, true, 36500, false, 'other',     'Buscar outro canal',         0, null,                    null,     false, 'nenhuma'),
  ('lig_atendeu_retorna',    'Atendeu, retorna depois',    '{ligacao}',      204, true,     2, true,  'call',      'Ligar na data combinada', null, null,                    'morno',  false, 'aberta'),
  ('lig_interessado',        'Interessado',                '{ligacao}',      205, true,     0, true,  'meeting',   'Marcar apresentação',     null, 'em_conversa',           'quente', false, 'aberta'),
  ('lig_agora_nao',          'Agora não',                  '{ligacao}',      206, true,    30, true,  'message',   'Reativar com gancho',       30, 'nutricao',              'frio',   false, 'aberta'),
  ('lig_sem_interesse',      'Sem interesse',              '{ligacao}',      207, true,    90, false, null,        null,                      null, 'perdido',               null,     true,  'aberta'),
  ('lig_reuniao_marcada',    'Reunião marcada',            '{ligacao}',      208, true,     0, true,  'meeting',   'Reunião na data',         null, 'reuniao_marcada',       'quente', false, 'aberta'),
  -- ---------- Visita (7) — templates de visita do R07 §5 ----------
  ('vis_nao_estava',         'Não estava / fechado',       '{visita}',       301, true,     7, true,  'visit',     'Visitar D+7 na zona',        7, null,                    null,     false, 'batida'),
  ('vis_funcionario',        'Falei com funcionário',      '{visita}',       302, true,     2, true,  'call',      'Ligar ao decisor D+2',       2, null,                    null,     false, 'batida'),
  ('vis_decisor_interessado','Decisor interessado',        '{visita}',       303, true,     0, true,  'meeting',   'Marcar apresentação ou link', null, 'em_conversa',        'quente', false, 'aberta'),
  ('vis_decisor_agora_nao',  'Decisor, agora não',         '{visita}',       304, true,    30, true,  'message',   'Reativar com gancho',       30, 'nutricao',              'frio',   false, 'aberta'),
  ('vis_decisor_recusou',    'Decisor recusou',            '{visita}',       305, true,    90, false, null,        null,                      null, 'perdido',               null,     true,  'aberta'),
  ('vis_cadastro_iniciado',  'Cadastro iniciado na hora',  '{visita}',       306, true,     3, true,  'follow_up', 'Retomar o cadastro D+3',     3, 'cadastro_em_andamento', 'quente', false, 'aberta'),
  ('vis_sem_perfil',         'Sem perfil (fora do ICP)',   '{visita}',       307, true, 36500, false, null,        null,                      null, 'perdido',               null,     true,  'batida'),
  -- ---------- Reunião (6) ----------
  ('reu_interessado',        'Realizada, interessado',     '{reuniao}',      401, true,     0, true,  'message',   'Pedir autorização hoje',     0, 'apresentacao_realizada','quente', false, 'aberta'),
  ('reu_autorizou',          'Realizada, autorizou',       '{reuniao}',      402, true,     0, true,  'message',   'Enviar link de cadastro',    0, 'autorizou',             'quente', false, 'aberta'),
  ('reu_objecao',            'Realizada, com objeção',     '{reuniao}',      403, true,     1, true,  'follow_up', 'Follow-up D+1',              1, 'apresentacao_realizada','quente', false, 'aberta'),
  ('reu_nao',                'Realizada, não',             '{reuniao}',      404, true,    90, false, null,        null,                      null, 'perdido',               null,     true,  'aberta'),
  ('reu_no_show',            'No-show',                    '{reuniao}',      405, true,     1, true,  'meeting',   'Reagendar em 24 h',          1, null,                    null,     false, 'batida'),
  ('reu_reagendada',         'Reagendada',                 '{reuniao}',      406, true,     0, true,  'meeting',   'Reunião na nova data',    null, 'reuniao_marcada',       'quente', false, 'batida'),
  -- ---------- Instagram DM (6) ----------
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

-- ---------- 12a. Eixo comercial da ligação (R13 §3.3; migração 20260904001300) ----------
-- `requires_answer` separa os dois eixos do R13 §3.3 dentro do catálogo que já existe.
-- Cinco desfechos de ligação pressupõem CONVERSA e só podem ser escolhidos quando
-- alguém atendeu; os três restantes (não atendeu, caixa postal, número errado) deixam
-- de ser escolha de quem liga e passam a ser resultado da chamada, resolvido por
-- `app.outcome_for_call_result`. Nenhum chip foi criado nem aposentado: a superfície
-- `ligacao` continua com os mesmos 8, porque a Heloísa também liga do celular dela,
-- fora de lote, e precisa deles na tela `/registrar` — que não lê esta coluna.
-- Um UPDATE em vez de mais uma coluna no insert do bloco 12: a lista de 34 linhas
-- descreve a consequência do desfecho, e esta coluna descreve QUEM pode escolhê-lo.
update public.interaction_outcomes
   set requires_answer = (slug in ('lig_atendeu_retorna', 'lig_interessado', 'lig_agora_nao',
                                   'lig_sem_interesse', 'lig_reuniao_marcada'))
 where 'ligacao'::app.interaction_surface = any (surfaces);
update public.interaction_outcomes
   set requires_answer = false
 where not ('ligacao'::app.interaction_surface = any (surfaces))
   and requires_answer;

-- =====================================================================
-- 12c. Roteiro de ligação em árvore (R13 §3.2 e §5; migração 20260904001300).
--
--     O roteiro NÃO é texto na lateral da tela: cada resposta possível do cliente é
--     um botão, e a tela vira sozinha para a fala seguinte. Quem liga nunca precisa
--     saber "o que falar agora" — e o sistema grava por onde a conversa passou
--     (`call_attempts.caminho_script`), que depois de duas semanas responde a
--     pergunta que nenhum palpite responde: em qual frase as pessoas desligam.
--
--     São 37 nós em duas variantes, e a bifurcação sai dos dois funis que já
--     existem (R13 §5), não de pessoa física × jurídica:
--       * FORNECEDOR (buffet, DJ, decoração, tenda, espaço) — gancho de DEMANDA:
--         "aparecer para quem já está procurando". O dono do buffet não quer um app
--         a mais; ele quer telefone tocando.
--       * PRODUTOR e CERIMONIALISTA — gancho de CONTROLE: "montar o evento inteiro
--         num lugar só". Quem organiza sofre com fornecedor que some, orçamento por
--         WhatsApp e contrato solto.
--     A variante é escolhida pelo SISTEMA, a partir de `organizations.kind`, e nunca
--     por quem liga: a `abertura` é um nó só, com duas saídas "Sou eu, pode falar",
--     e a tela mostra a que vale para o tipo da organização.
--
--     Três coisas que o roteiro carrega por obrigação, e não por redação:
--       * AVISO DE ORIGEM no primeiro nó (`[origem]`, preenchido por `fraseDeOrigem`
--         a partir de `sources.slug`) — exigência de transparência do legítimo
--         interesse (R06) e o que derruba a desconfiança logo no começo;
--       * o gancho cabe em 15 segundos e TERMINA EM PERGUNTA (R13 §5): quem pergunta
--         conduz a ligação;
--       * nenhuma promessa comercial fora da base de conhecimento — dúvida
--         financeira sem resposta na FAQ vira "vou confirmar com o financeiro"
--         (nó `obj_financeiro`).
--
--     Os 9 nós `objecao` formam o bloco lateral, alcançável de QUALQUER nó, e por
--     isso ficam fora da árvore principal (`objecoesDoRoteiro` em tipos.ts).
--     Os nós `fim` carregam o desfecho comercial e são o que faz a tabulação custar
--     um toque; `fim_numero_errado` é o único que fecha pelo eixo TÉCNICO, porque
--     "aqui não é o [Empresa]" é atendimento sem conversa comercial, e forçar um
--     desfecho comercial ali gravaria uma recusa que ninguém fez.
--
--     O gatilho `app.call_scripts_validate` recusa a inserção se algum nó ficar sem
--     saída em alguma das duas variantes, se algum destino não existir ou se algum
--     `fim` não fechar por exatamente um dos dois eixos.
--
--  6. QUEM PERGUNTA O NÚMERO É QUEM O GUARDA (conserto do achado D4). Até
--     04/09/2026 os nós de volume — `forn_explica` ("Quantos eventos o [empresa]
--     faz por mês hoje?") e `prod_explica` ("Quantos eventos você faz por ano?") —
--     eram do tipo `pergunta`, que não captura nada, enquanto `forn_qualifica`
--     ("mais pedido ou pedido melhor?") gravava a resposta dela no campo
--     `eventos_por_mes` e `prod_qualifica` ("qual é o seu maior aperto?") no campo
--     `eventos_por_ano`. Medido no banco local: capturas = {"eventos_por_mes":
--     "Mais pedido"}. O número de eventos, que é o dado de qualificação do
--     R13 §3.2, nunca era gravado — e o que estava lá tinha o nome de outra coisa.
--     Agora cada nó captura a SUA resposta: eventos_por_mes / eventos_por_ano nos
--     nós de volume, prioridade_do_dono e maior_aperto nos de qualificação.
-- =====================================================================
insert into public.call_scripts (slug, nome, versao, arvore, is_published)
values ('captacao_v1', 'Captação por ligação — v1', 1, $roteiro$[
  {
    "id": "abertura",
    "tipo": "pergunta",
    "variante": "ambas",
    "texto": "[saudacao]! Aqui é [eu], da Komune. Peguei o contato de vocês [origem]. Falo com quem cuida dos eventos do [empresa]?",
    "saidas": [
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "gancho_fornecedor"
      },
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "gancho_produtor"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Aqui não é o [empresa]",
        "destino": "fim_numero_errado"
      },
      {
        "rotulo": "Tô ocupado agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "De onde tirou meu número?",
        "destino": "obj_origem"
      },
      {
        "rotulo": "Manda no WhatsApp",
        "destino": "obj_whatsapp"
      }
    ],
    "nota": "O aviso de origem é obrigatório (R13 §5; transparência do legítimo interesse, R06). Nunca pule."
  },
  {
    "id": "pedir_decisor",
    "tipo": "pergunta",
    "variante": "ambas",
    "texto": "Sem problema. E quem é que decide sobre os eventos aí no [empresa]? Consigo falar com ele agora?",
    "saidas": [
      {
        "rotulo": "Vou passar pra ele",
        "destino": "gancho_fornecedor"
      },
      {
        "rotulo": "Vou passar pra ele",
        "destino": "gancho_produtor"
      },
      {
        "rotulo": "Ele não está agora",
        "destino": "anotar_decisor"
      },
      {
        "rotulo": "Não passo esse contato",
        "destino": "fim_agora_nao"
      }
    ]
  },
  {
    "id": "anotar_decisor",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Tudo bem. Qual é o nome dele, e qual o melhor horário pra eu ligar?",
    "saidas": [
      {
        "rotulo": "Anotei nome e horário",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não quis passar",
        "destino": "fim_agora_nao"
      }
    ],
    "campo": "decisor"
  },
  {
    "id": "combinar_retorno",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Fechado. Então eu ligo [dia], por volta das [hora]. Já anotei aqui.",
    "saidas": [
      {
        "rotulo": "Combinado",
        "destino": "fim_retorna"
      },
      {
        "rotulo": "Prefere que eu não ligue",
        "destino": "fim_optout"
      }
    ],
    "campo": "retorno_combinado"
  },
  {
    "id": "agendar_reuniao",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Perfeito. São 20 minutos, por vídeo ou aí no [empresa], como você preferir. [dia] às [hora] serve?",
    "saidas": [
      {
        "rotulo": "Serve, pode marcar",
        "destino": "confirmar_contato"
      },
      {
        "rotulo": "Melhor outro dia",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Prefiro só por WhatsApp",
        "destino": "obj_whatsapp"
      }
    ],
    "campo": "reuniao_combinada"
  },
  {
    "id": "confirmar_contato",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Só pra eu não errar: esse mesmo número é o WhatsApp que vocês usam pro trabalho?",
    "saidas": [
      {
        "rotulo": "É esse mesmo",
        "destino": "enviar_whatsapp"
      },
      {
        "rotulo": "É outro, anotei",
        "destino": "enviar_whatsapp"
      },
      {
        "rotulo": "Prefiro por e-mail",
        "destino": "fim_interessado"
      }
    ],
    "campo": "whatsapp_do_decisor"
  },
  {
    "id": "enviar_whatsapp",
    "tipo": "acao",
    "variante": "ambas",
    "texto": "Mande agora, pelo WhatsApp, a confirmação com dia, hora e link. Espere ele confirmar antes de desligar.",
    "saidas": [
      {
        "rotulo": "Mandei e ele confirmou",
        "destino": "fim_reuniao"
      }
    ],
    "nota": "Confirmar na hora é o que derruba no-show (R08 §4.1)."
  },
  {
    "id": "fim_reuniao",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Combinado, então: [dia] às [hora]. Obrigado pelo tempo, [nome]. Até lá!",
    "saidas": [],
    "desfecho": "lig_reuniao_marcada",
    "resultadoTecnico": null
  },
  {
    "id": "fim_retorna",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Perfeito, eu ligo [dia]. Obrigado, [nome]!",
    "saidas": [],
    "desfecho": "lig_atendeu_retorna",
    "resultadoTecnico": null
  },
  {
    "id": "fim_interessado",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Ótimo. Vou te mandar por WhatsApp como funciona e a gente marca a conversa. Obrigado, [nome]!",
    "saidas": [],
    "desfecho": "lig_interessado",
    "resultadoTecnico": null
  },
  {
    "id": "fim_agora_nao",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Entendi, [nome]. Guardo o contato e te procuro mais pra frente, antes da temporada. Obrigado!",
    "saidas": [],
    "desfecho": "lig_agora_nao",
    "resultadoTecnico": null
  },
  {
    "id": "fim_sem_interesse",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Sem problema, [nome]. Obrigado pela franqueza e pelo tempo. Bom trabalho aí!",
    "saidas": [],
    "desfecho": "lig_sem_interesse",
    "resultadoTecnico": null
  },
  {
    "id": "fim_optout",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Entendido, [nome]. Vou tirar o contato de vocês da nossa lista agora mesmo. Desculpe o incômodo.",
    "saidas": [],
    "desfecho": "lig_sem_interesse",
    "resultadoTecnico": null,
    "nota": "Marque também “não me ligue mais”: é o que registra o opt-out (RF-CON-18). Não tem volta."
  },
  {
    "id": "fim_numero_errado",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Desculpe o incômodo, foi engano meu. Tenha um bom dia!",
    "saidas": [],
    "desfecho": null,
    "resultadoTecnico": "numero_invalido",
    "nota": "Atendeu, mas não houve conversa comercial: fecha pelo eixo técnico, não por uma recusa que ninguém fez."
  },
  {
    "id": "gancho_fornecedor",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "Ótimo. [nome], a Komune é onde quem está organizando casamento e festa em Natal procura fornecedor e fecha por lá. A gente está montando a lista de buffet, DJ, decoração e espaço da cidade. Hoje, de onde vêm os seus clientes?",
    "saidas": [
      {
        "rotulo": "Indicação, boca a boca",
        "destino": "forn_indicacao"
      },
      {
        "rotulo": "Instagram",
        "destino": "forn_indicacao"
      },
      {
        "rotulo": "Já anuncio em site",
        "destino": "forn_ja_anuncia"
      },
      {
        "rotulo": "Tô cheio, não preciso",
        "destino": "forn_sem_demanda"
      },
      {
        "rotulo": "Como assim? Explica",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Quanto custa?",
        "destino": "obj_preco"
      }
    ],
    "nota": "Gancho de DEMANDA (R13 §5): o dono do buffet não quer um app, quer telefone tocando. 15 segundos e termina em pergunta."
  },
  {
    "id": "forn_indicacao",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "É o que eu mais escuto. Indicação traz cliente bom, mas só quando alguém lembra de você. Na Komune, quem está procurando buffet em Natal esta semana vê o [empresa] sem depender de ninguém lembrar. Isso te serve?",
    "saidas": [
      {
        "rotulo": "Faz sentido",
        "destino": "forn_qualifica"
      },
      {
        "rotulo": "Já tentei site, não deu",
        "destino": "obj_concorrente"
      },
      {
        "rotulo": "Não quero mais um app",
        "destino": "obj_mais_um_app"
      },
      {
        "rotulo": "Quem já usa aí?",
        "destino": "obj_quem_ja_usa"
      }
    ]
  },
  {
    "id": "forn_ja_anuncia",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "Legal. E de lá chega pedido de orçamento de verdade, ou mais curioso perguntando preço?",
    "saidas": [
      {
        "rotulo": "Mais curioso que cliente",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Chega, funciona bem",
        "destino": "obj_concorrente"
      },
      {
        "rotulo": "Não meço isso",
        "destino": "forn_explica"
      }
    ]
  },
  {
    "id": "forn_explica",
    "tipo": "captura",
    "variante": "fornecedor",
    "texto": "Funciona assim: quem quer contratar entra, filtra por data, tipo de festa e orçamento, e fala direto com você — o pedido chega com a data e o número de convidados já preenchidos. Quantos eventos o [empresa] faz por mês hoje?",
    "saidas": [
      {
        "rotulo": "Ele respondeu quantos",
        "destino": "forn_qualifica"
      },
      {
        "rotulo": "Depende muito da época",
        "destino": "forn_qualifica"
      },
      {
        "rotulo": "Não quero falar disso",
        "destino": "forn_proposta"
      }
    ],
    "campo": "eventos_por_mes"
  },
  {
    "id": "forn_qualifica",
    "tipo": "captura",
    "variante": "fornecedor",
    "texto": "Certo, anotei. E o que você quer mais: mais pedido chegando, ou pedido melhor, com data e orçamento já certos?",
    "saidas": [
      {
        "rotulo": "Mais pedido",
        "destino": "forn_proposta"
      },
      {
        "rotulo": "Pedido melhor",
        "destino": "forn_proposta"
      },
      {
        "rotulo": "Nenhum dos dois agora",
        "destino": "forn_sem_demanda"
      }
    ],
    "campo": "prioridade_do_dono"
  },
  {
    "id": "forn_proposta",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "Então é o seguinte: em 20 minutos eu te mostro como o [empresa] apareceria pra quem está procurando agora, e você decide depois. Entrar na lista não custa nada. Topa marcar?",
    "saidas": [
      {
        "rotulo": "Topo, vamos marcar",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Me manda por escrito antes",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Depois eu vejo",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Gostei, mas preciso pensar",
        "destino": "fim_interessado"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "forn_sem_demanda",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "Entendo, e é bom sinal. Só uma coisa: e nos meses fracos, junho e julho? Vale eu te procurar antes deles?",
    "saidas": [
      {
        "rotulo": "Aí sim, me procura",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Me explica rápido",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Não precisa, obrigado",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "gancho_produtor",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "Ótimo. [nome], a Komune junta num lugar só os fornecedores de evento de Natal — buffet, som, decoração, espaço — com orçamento e contrato no mesmo painel. A gente está chamando quem organiza evento na cidade. Como você monta a lista de fornecedores hoje?",
    "saidas": [
      {
        "rotulo": "Tenho os meus de sempre",
        "destino": "prod_ja_tem"
      },
      {
        "rotulo": "Planilha e WhatsApp",
        "destino": "prod_planilha"
      },
      {
        "rotulo": "Cada evento é um corre",
        "destino": "prod_dor"
      },
      {
        "rotulo": "Explica melhor",
        "destino": "prod_explica"
      },
      {
        "rotulo": "Quanto custa?",
        "destino": "obj_preco"
      }
    ],
    "nota": "Gancho de CONTROLE (R13 §5): quem organiza evento sofre com fornecedor que some, orçamento por WhatsApp e contrato solto."
  },
  {
    "id": "prod_planilha",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "É o padrão do mercado. E quando um fornecedor some na semana do evento, quanto tempo você perde pra achar outro?",
    "saidas": [
      {
        "rotulo": "Perco o dia inteiro",
        "destino": "prod_dor"
      },
      {
        "rotulo": "Isso quase não acontece",
        "destino": "prod_ja_tem"
      },
      {
        "rotulo": "Já perdi evento assim",
        "destino": "prod_dor"
      }
    ]
  },
  {
    "id": "prod_dor",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "Pois é. Na Komune você vê quem está disponível naquela data, com preço e contrato no mesmo lugar, e o histórico de quem já entregou bem. Isso resolveria alguma coisa pra você?",
    "saidas": [
      {
        "rotulo": "Resolveria, sim",
        "destino": "prod_qualifica"
      },
      {
        "rotulo": "Não quero mais um app",
        "destino": "obj_mais_um_app"
      },
      {
        "rotulo": "Quem já usa aí?",
        "destino": "obj_quem_ja_usa"
      },
      {
        "rotulo": "Explica melhor",
        "destino": "prod_explica"
      }
    ]
  },
  {
    "id": "prod_explica",
    "tipo": "captura",
    "variante": "produtor",
    "texto": "É um painel: você monta o evento, escolhe os fornecedores da cidade, manda o orçamento pra todos de uma vez e acompanha o que cada um respondeu. Quantos eventos você faz por ano?",
    "saidas": [
      {
        "rotulo": "Ele respondeu quantos",
        "destino": "prod_qualifica"
      },
      {
        "rotulo": "Varia muito",
        "destino": "prod_qualifica"
      },
      {
        "rotulo": "Prefiro não dizer",
        "destino": "prod_proposta"
      }
    ],
    "campo": "eventos_por_ano"
  },
  {
    "id": "prod_qualifica",
    "tipo": "captura",
    "variante": "produtor",
    "texto": "Anotei. E qual é o seu maior aperto hoje: achar fornecedor, controlar orçamento, ou o contrato?",
    "saidas": [
      {
        "rotulo": "Achar fornecedor",
        "destino": "prod_proposta"
      },
      {
        "rotulo": "Orçamento",
        "destino": "prod_proposta"
      },
      {
        "rotulo": "Contrato",
        "destino": "prod_proposta"
      }
    ],
    "campo": "maior_aperto"
  },
  {
    "id": "prod_proposta",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "Então vale 20 minutos: eu te mostro o painel com fornecedores reais de Natal e você me diz se serve. Entrar não custa nada. Topa marcar?",
    "saidas": [
      {
        "rotulo": "Topo, vamos marcar",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Me manda por escrito antes",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Depois eu vejo",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Gostei, mas preciso pensar",
        "destino": "fim_interessado"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "prod_ja_tem",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "Ótimo, isso já é meio caminho. E quando o cliente pede algo que os seus de sempre não fazem — tenda grande, brinquedo, atração de fora? Onde você procura?",
    "saidas": [
      {
        "rotulo": "Aí eu me viro no Google",
        "destino": "prod_dor"
      },
      {
        "rotulo": "Peço indicação",
        "destino": "prod_dor"
      },
      {
        "rotulo": "Nunca precisei",
        "destino": "prod_proposta"
      }
    ]
  },
  {
    "id": "obj_whatsapp",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Mando sim. Só que o que eu tenho pra mostrar não cabe em mensagem — são fornecedores reais e a agenda deles. Me dá 20 minutos e, se não servir, eu mesmo tiro vocês da lista. Que dia é melhor?",
    "saidas": [
      {
        "rotulo": "Tudo bem, vamos marcar",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Manda mesmo assim",
        "destino": "fim_interessado"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "prod_explica"
      }
    ]
  },
  {
    "id": "obj_concorrente",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Conheço, é bom pra casamento. A gente é daqui de Natal e cobre festa de 15, corporativo e aniversário também — e você não paga pra aparecer. Dá pra ter os dois. Vale eu te mostrar a diferença?",
    "saidas": [
      {
        "rotulo": "Vale, vamos marcar",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Por enquanto não",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "prod_explica"
      }
    ]
  },
  {
    "id": "obj_sem_tempo",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Eu sei, liguei em hora ruim mesmo. São 40 segundos: eu digo o que é e, se não servir, você me manda parar. Posso?",
    "saidas": [
      {
        "rotulo": "Pode, fala",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Pode, fala",
        "destino": "prod_explica"
      },
      {
        "rotulo": "Me liga outra hora",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ]
  },
  {
    "id": "obj_preco",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Entrar e montar o perfil não custa nada. A Komune só ganha quando o negócio fecha por lá — não fechou, você não paga. O número exato eu te mando por escrito, do jeito que o financeiro passou.",
    "saidas": [
      {
        "rotulo": "Então tudo bem",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Quero o número agora",
        "destino": "obj_financeiro"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "prod_explica"
      }
    ],
    "nota": "Nunca prometa condição comercial fora da base de conhecimento. Percentual, prazo e desconto só com o que estiver na FAQ."
  },
  {
    "id": "obj_mais_um_app",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Justo. Você não precisa instalar nada nem mudar o seu jeito de trabalhar: o pedido chega no seu WhatsApp, como já chega hoje. O painel é só onde a informação fica guardada.",
    "saidas": [
      {
        "rotulo": "Assim eu vejo",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Mesmo assim, não",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "prod_explica"
      }
    ]
  },
  {
    "id": "obj_nao_preciso",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Que bom — é o melhor problema de se ter. Só que agenda cheia hoje não é agenda cheia em junho. Posso deixar o perfil pronto agora, sem custo, pra quando você quiser abrir a torneira?",
    "saidas": [
      {
        "rotulo": "Pode, vamos ver",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Me procura mais pra frente",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não, obrigado",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "obj_quem_ja_usa",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "A gente está montando a base agora, com fornecedor de Natal, um por segmento — é por isso que estou ligando pra vocês antes de abrir. Quem entra agora aparece primeiro.",
    "saidas": [
      {
        "rotulo": "Quero ver isso",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Me manda por escrito",
        "destino": "fim_interessado"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "prod_explica"
      }
    ],
    "nota": "Nunca cite nome de parceiro que não autorizou. Se insistir: “vou confirmar com o marketing o que posso te mostrar”."
  },
  {
    "id": "obj_origem",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Claro: peguei [origem]. Está tudo registrado do nosso lado e, se você quiser, eu apago o contato de vocês agora mesmo — é só falar.",
    "saidas": [
      {
        "rotulo": "Tudo bem, continua",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Tudo bem, continua",
        "destino": "prod_explica"
      },
      {
        "rotulo": "Apaga meu contato",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Me liga outra hora",
        "destino": "combinar_retorno"
      }
    ],
    "nota": "Transparência de origem é exigência do legítimo interesse (R06). Se pedir para apagar, é opt-out imediato."
  },
  {
    "id": "obj_financeiro",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Essa eu não vou te responder de cabeça pra não falar besteira: vou confirmar com o financeiro e te mando por escrito ainda hoje. Pode ser nesse mesmo número?",
    "saidas": [
      {
        "rotulo": "Pode, manda por escrito",
        "destino": "fim_interessado"
      },
      {
        "rotulo": "Sem isso não continuo",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "forn_proposta"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "prod_proposta"
      }
    ],
    "nota": "Dúvida financeira sem resposta na FAQ vira sempre “vou confirmar com o financeiro”. Nunca improvise número."
  }
]$roteiro$::jsonb, true)
on conflict (slug, versao) do update
  set nome         = excluded.nome,
      arvore       = excluded.arvore,
      is_published = excluded.is_published;

-- =====================================================================
-- 12b. Equivalência de etapas entre funis (RF-FUN-12; PRD §5.3 ↔ §5.5)
--
--     `interaction_outcomes.target_stage_slug` é escrito no vocabulário do funil
--     FORNECEDOR (é o que a autoverificação do bloco 13 confere). Cinco desses
--     destinos não existem no funil produtor, que tem etapas próprias — sem esta
--     tabela, os 8 desfechos que levam a Quente não moviam etapa nenhuma na metade
--     da base que é produtor ou cerimonialista. `app.stage_for` (migração 001200)
--     prefere sempre o slug literal e só cai aqui quando ele não existe no funil.
--
--     em_conversa NÃO tem linha aqui de propósito: o funil produtor não tem etapa
--     equivalente (PRD §5.5 vai de "Respondeu" direto a "Demonstração marcada").
--     `lig_interessado` e `vis_decisor_interessado` esquentam nesse funil pela
--     intenção que declaram (`sets_temperature = quente`), não pela etapa.
-- =====================================================================
insert into public.stage_equivalences (pipeline_id, canonical_slug, stage_slug, note)
select p.id, v.canonical_slug, v.stage_slug, v.note
  from (values
    ('produtor', 'reuniao_marcada',        'demonstracao_marcada',
     'PRD §5.3 linha 5 ↔ §5.5 linha 4: data e formato confirmados.'),
    ('produtor', 'apresentacao_realizada', 'demonstracao_realizada',
     'PRD §5.3 linha 6 ↔ §5.5 linha 5: encontro feito, resultado registrado.'),
    ('produtor', 'autorizou',              'parceria_aceita',
     'PRD §5.3 linha 7 ↔ §5.5 linha 6: o sim registrado.'),
    ('produtor', 'cadastro_em_andamento',  'parceria_aceita',
     'PRD §5.5 linha 6: a automação de "Parceria aceita" é a criação assistida da conta.')
  ) as v(pipeline, canonical_slug, stage_slug, note)
  join public.pipelines p on p.slug = v.pipeline
on conflict (pipeline_id, canonical_slug) do update
  set stage_slug = excluded.stage_slug,
      note       = excluded.note;

-- =====================================================================
-- 12d. As cinco cadências e os seus passos (RF-CON-12 a RF-CON-16;
--      migração 20260904001700, seção D).
--
--      ESTE BLOCO VEIO DE DENTRO DA MIGRAÇÃO, em 05/09/2026, e a mudança foi
--      de ORDEM, não de conteúdo: `supabase db reset` roda TODAS as migrações
--      antes deste arquivo, e os passos citam desfecho (`ultimo_desfecho_em`:
--      lig_nao_atendeu, lig_caixa_postal, validados por gatilho no bloco 12) e
--      modelo (`template_code`: GEN-FUP-D3-V1, GEN-ONB-*, GEN-REA-60-*, com FK
--      para `message_templates` do bloco 9/10) que nascem AQUI. Semeado lá, o
--      banco novo morria em 23503 e a "fonte da verdade" do CLAUDE.md não
--      replicava do zero.
--
--      O lugar certo é este: migração guarda a FORMA (tabelas, gatilhos, RLS,
--      o motor da régua de silêncio), o seed guarda o CATÁLOGO OPERÁVEL — e
--      cadência é catálogo, editável pelo gestor na tela, sem deploy. O bloco
--      é idempotente (`on conflict do nothing`, `where not exists`), então
--      roda em todo reset sem duplicar e sem sobrescrever o que o gestor
--      tenha mudado. Em banco que já aplicou a migração antiga ele não insere
--      nada — os dois bancos terminam iguais.
--
--      Depende, nesta ordem, dos blocos 7 (funis e etapas: `pipeline_slug`,
--      `end_stage_slug` = nutricao), 9/10 (modelos) e 12 (desfechos).
-- =====================================================================
-- Dois modelos que as cadências novas exigem e que ainda não existiam.
-- GEN-FUP-LIG-V1 carrega o conteúdo obrigatório do RF-CON-12 (nome real +
-- Komune + finalidade + origem do contato + aviso de privacidade + saída fácil).
insert into public.message_templates
  (template_code, name, channel, category, segment, kind, language, body, variables)
values
  ('GEN-FUP-LIG-V1', 'Tentei te ligar — follow-up de voz', 'whatsapp', 'utility', 'GEN',
   'followup', 'pt_BR',
   'Oi, {{nome}}! Aqui é a Heloísa, da Komune, app de eventos de Natal. Tentei te ligar hoje e não consegui falar com você. Cheguei no contato de {{empresa}} pelo {{origem}} e queria só te apresentar a rede de fornecedores: sem mensalidade, você paga uma taxa quando fecha. Se preferir, me diz o melhor horário que eu ligo. Se não for o momento, é só responder SAIR. Como usamos seus dados: komune.app/privacidade',
   '["empresa", "nome", "origem"]'::jsonb),
  ('PRE-LINK-V1', 'Link de reivindicação do pré-cadastro', 'whatsapp', 'utility', 'GEN',
   'onboarding', 'pt_BR',
   '{{nome}}, preparei um rascunho do perfil de {{empresa}} na Komune com informações públicas do {{origem}}. Ninguém vê esse rascunho além de você — ele só entra no ar depois que você revisar, colocar suas fotos e aceitar os termos. O link é pessoal e vale por 7 dias: {{link}}. Se não quiser perfil, dá para pedir a remoção na própria página, sem login. Dúvidas sobre dados: komune.app/privacidade',
   '["empresa", "link", "nome", "origem"]'::jsonb)
on conflict (template_code) do nothing;

-- O áudio do D+3 do onboarding. Nasce sem arquivo: é a Heloísa que grava.
insert into public.audio_assets (slug, title, segment, context, is_active)
values ('gen-onb-ajuda-1', 'Onboarding — quer que eu termine por você? (20 s)', 'GEN',
        'Cadência pos_autorizacao, passo D+3. A GRAVAR pela Heloísa. Sempre acompanhado do texto-resumo (R06 WA-13).',
        true)
on conflict (slug) do nothing;

-- As cadências.
insert into public.cadences
  (slug, name, pipeline_slug, max_touches, limite_dias, end_stage_slug,
   requires_gancho, requires_authorization, entry_note, description)
values
  ('voz_primeiro', 'Primeiro contato por voz', 'fornecedor', 5, 14, 'nutricao', false, false,
   'Negócio em Prospectado ou Contatado, organização com telefone, não suprimida.',
   'A cadência-padrão da operação depois da virada de 04/09: ligação primeiro, WhatsApp como apoio (R13). Uma única mensagem iniciada por nós, e ela cabe folgado na régua 1+1 do RF-CON-13 porque a abertura foi por voz.'),
  ('retomar_conversa', 'Retomar morno parado', 'fornecedor', 3, 14, 'nutricao', false, false,
   'Entra por desfecho: lig_atendeu_retorna, reu_objecao, wa_respondeu sem próximo passo.',
   'RF-CON-14. Cada toque com motivo novo; nunca dois no mesmo dia — garantido pela regra de um pendente.'),
  ('pos_autorizacao', 'Onboarding até reivindicar', 'fornecedor', 5, 30, null, false, true,
   'Etapa Autorizou E consent_events.data_use_authorized vigente. Sem essa linha o banco recusa.',
   'RF-CON-16. Termina em `claimed`, que abre a cadência completar_cadastro.'),
  ('completar_cadastro', 'Do claim à publicação', 'ativacao', 4, 21, null, false, false,
   'Etapa Cadastro em andamento com claimed_at preenchido.',
   'RF-CON-16, segunda metade. Cada toque cita o campo específico que falta, lido de pre_registrations.completeness_breakdown. Depois de D+14 vira tarefa humana e visita, sem cadência.'),
  ('reativacao', 'Reativação com gancho', 'fornecedor', 2, 90, 'nutricao', true, false,
   'NÃO nasce sozinha: exige gancho preenchido por gente (lead real, Research Request, evento próprio, case autorizado, sazonalidade).',
   'RF-CON-15. Um toque por ciclo (D+30/D+60); dois ciclos sem resposta encerram. Nunca para "não" firme, perdido, opt-out ou desfecho não reativável — a porteira barra.')
on conflict (slug) do nothing;

-- Os passos.
insert into public.cadence_steps
  (cadence_id, "position", channel, task_kind, delay_days, delay_from, title,
   template_code, audio_slug, condition, tiers, window_hint, is_last_automatic)
select c.id, p.pos, p.canal::app.channel, p.tarefa::app.task_kind, p.dias, p.de, p.titulo,
       p.template, p.audio, p.cond::jsonb, p.tiers::text[], p.dica, p.ultimo
  from (values
    -- A · voz_primeiro
    ('voz_primeiro', 1::smallint, 'phone', 'call', 0::smallint, 'matricula',
     'Ligar: primeiro contato', null, null, '{"tem_telefone": true}', '{}',
     'Roteiro em árvore por organizations.kind; aviso de origem no primeiro nó', false),
    ('voz_primeiro', 2, 'phone', 'call', 1, 'passo_anterior',
     'Ligar de novo — 2ª e última tentativa', null, null,
     '{"ultimo_desfecho_em": ["lig_nao_atendeu", "lig_caixa_postal"]}', '{}',
     'Se atendeu, a cadência encerra e quem manda é o desfecho', false),
    ('voz_primeiro', 3, 'whatsapp', 'message', 3, 'passo_anterior',
     'Mandar "tentei te ligar" (assistido)', 'GEN-FUP-LIG-V1', null,
     '{"tem_telefone": true, "sem_resposta": true}', '{}',
     'A ÚNICA mensagem iniciada por nós nesta cadência (RF-CON-12, RF-CON-13)', false),
    ('voz_primeiro', 4, 'instagram', 'message', 7, 'matricula',
     'DM no Instagram', null, null, '{"tem_instagram": true}', '{A+,A}', null, false),
    ('voz_primeiro', 5, 'presencial', 'visit', 7, 'matricula',
     'Visita na rota da zona', null, null, '{"bairro_geocodificado": true}', '{A+,A}',
     'D+7 a D+10, na zona da rota do dia', true),

    -- B · retomar_conversa
    ('retomar_conversa', 1, 'phone', 'call', 0, 'data_combinada',
     'Ligar na data que ele pediu', null, null, '{}', '{}',
     'Item nº 1 do digest das 07:30 (RF-MET-04)', false),
    ('retomar_conversa', 2, 'whatsapp', 'message', 2, 'passo_anterior',
     'Retomar com motivo novo', 'GEN-FUP-D3-V1', null, '{}', '{}',
     'Só dentro da janela de 24 h; fora dela vira ligação, não modelo pago', false),
    ('retomar_conversa', 3, 'phone', 'call', 7, 'passo_anterior',
     'Última tentativa', null, null, '{}', '{}', null, true),

    -- C · pos_autorizacao
    ('pos_autorizacao', 1, 'whatsapp', 'message', 0, 'matricula',
     'Enviar o link de reivindicação', 'PRE-LINK-V1', null, '{}', '{}',
     'Aviso do R06 §C.4: rascunho privado, criado de dados públicos, expira, sem login para recusar', false),
    ('pos_autorizacao', 2, 'whatsapp', 'message', 1, 'matricula',
     'Lembrete do link', 'GEN-ONB-D1-NAO-ABRIU', null, '{"claim_link_aberto": false}', '{}',
     null, false),
    ('pos_autorizacao', 3, 'whatsapp', 'message', 3, 'matricula',
     'Áudio da Heloísa: quer que eu termine por você?', 'GEN-ONB-D7', 'gen-onb-ajuda-1',
     '{"reivindicado": false}', '{}', 'Áudio sempre com texto-resumo (R06 WA-13)', false),
    ('pos_autorizacao', 4, 'phone', 'call', 7, 'matricula',
     'Ligar e terminar em 5 minutos — e regenerar o link', null, null,
     '{"reivindicado": false}', '{}', 'O token expira em 7 dias; regenerar invalida o anterior', false),
    ('pos_autorizacao', 5, 'whatsapp', 'message', 20, 'matricula',
     'Aviso final antes de o rascunho ser apagado em D+30', 'GEN-ONB-D14', null,
     '{"reivindicado": false}', '{}', null, true),

    -- D · completar_cadastro
    ('completar_cadastro', 1, 'whatsapp', 'message', 1, 'matricula',
     'Falta pouco: citar o campo que falta', 'GEN-ONB-D1', null, '{}', '{}',
     'O campo sai de pre_registrations.completeness_breakdown', false),
    ('completar_cadastro', 2, 'whatsapp', 'message', 3, 'matricula',
     'Falta só um campo — oferecer terminar por ligação', 'GEN-ONB-D3', null, '{}', '{}',
     null, false),
    ('completar_cadastro', 3, 'whatsapp', 'message', 7, 'matricula',
     'Perfil 90% pronto e parado', 'GEN-ONB-D7', null, '{}', '{}', null, false),
    ('completar_cadastro', 4, 'whatsapp', 'message', 14, 'matricula',
     'Última lembrança automática', 'GEN-ONB-D14', null, '{}', '{}',
     'Depois disto vira tarefa humana e visita, sem cadência', true),

    -- E · reativacao
    ('reativacao', 1, 'whatsapp', 'message', 30, 'matricula',
     'Reativar com o gancho registrado', 'GEN-REA-60-V1', null, '{"tem_gancho": true}', '{}',
     null, false),
    ('reativacao', 2, 'whatsapp', 'message', 60, 'matricula',
     'Segundo e último ciclo', 'GEN-REA-60-V2', null, '{"tem_gancho": true}', '{}',
     'Dois ciclos sem resposta → não reativar automaticamente', true)
  ) as p(cad, pos, canal, tarefa, dias, de, titulo, template, audio, cond, tiers, dica, ultimo)
  join public.cadences c on c.slug = p.cad
 where not exists (select 1 from public.cadence_steps s
                    where s.cadence_id = c.id and s."position" = p.pos);


-- =====================================================================
-- 13. Autoverificação: a seed falha (e o db reset também) se as contagens esperadas não baterem.
-- =====================================================================
do $$
declare
  n_cat  int;  n_pipe int;  n_forn int;  n_ativ int;  n_prod int;
  n_hol  int;  n_tpl  int;  n_city int;  n_src  int;  n_lost int;
  n_hol1 int;  ano    int := extract(year from (now() at time zone 'America/Fortaleza'))::int;
  n_out  int;  n_sup  int;  n_eq int;  s_eq text;
  n_nos int; n_rot_err int; n_ans int;
  n_cad int; n_pas int; n_cad_ruim text;
  n_rad int; n_map int;
begin
  select count(*) into n_cat  from public.categories;
  select count(*) into n_pipe from public.pipelines;
  select count(*) into n_forn from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'fornecedor';
  select count(*) into n_ativ from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'ativacao';
  select count(*) into n_prod from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.slug = 'produtor';
  -- Feriados: exige o ano corrente E o seguinte (cadências D+30/D+60 viram o ano).
  select count(*) into n_hol  from public.holidays where extract(year from date) = ano;
  select count(*) into n_hol1 from public.holidays where extract(year from date) = ano + 1;
  select count(*) into n_tpl  from public.message_templates;
  select count(*) into n_city from public.cities;
  select count(*) into n_src  from public.sources;
  select count(*) into n_lost from public.lost_reasons;
  select count(*) into n_out from public.interaction_outcomes;
  select count(*) into n_eq  from public.stage_equivalences;
  -- Roteiro de ligação (bloco 12c): nós da árvore, desfechos que exigem atendimento
  -- e erros estruturais segundo app.validar_roteiro.
  select jsonb_array_length(r.arvore), cardinality(app.validar_roteiro(r.arvore))
    into n_nos, n_rot_err
    from public.call_scripts r where r.slug = 'captacao_v1' and r.versao = 1;
  select count(*) into n_ans
    from public.interaction_outcomes o
   where o.requires_answer and 'ligacao'::app.interaction_surface = any (o.surfaces);
  -- Radar (bloco 3b): catálogo de listagens e mapa de categorias. Vieram da
  -- migração 20260904001802, que os escrevia ANTES de as fontes existirem e
  -- por isso não escrevia nada — sem erro. Esta contagem é o barulho que
  -- faltava.
  select coalesce(jsonb_array_length(s.config -> 'collector' -> 'catalogo'), 0) into n_rad
    from public.sources s where s.slug = 'casamentos_com_br';
  select count(*) into n_map
    from public.source_category_map m
    join public.sources s on s.id = m.source_id
   where s.slug = 'casamentos_com_br';

  -- Cadências (bloco 12d): vieram da migração 20260904001700 para cá porque
  -- citam desfecho e modelo que só existem neste arquivo. A contagem é o que
  -- impede a regressão silenciosa — se o bloco parar de rodar, o reset falha
  -- aqui em vez de deixar a operação sem régua de contato.
  select count(*) into n_cad from public.cadences;
  select count(*) into n_pas from public.cadence_steps;
  -- E a prova de que a dependência foi de fato satisfeita: nenhum passo pode
  -- apontar para modelo inexistente (a FK já garante) nem para desfecho fora
  -- do catálogo (isto o gatilho garante na escrita; aqui é a rede).
  select string_agg(distinct d, ', ' order by d) into n_cad_ruim
    from public.cadence_steps st,
         lateral jsonb_array_elements_text(coalesce(st.condition -> 'ultimo_desfecho_em', '[]'::jsonb)) d
   where not exists (select 1 from public.interaction_outcomes o where o.slug = d);

  -- Teto de 8 chips ativos por superfície: acima disso ninguém tabula dentro dos 20 s do RF-MET-06.
  select coalesce(max(c), 0) into n_sup
    from (select count(*) as c from public.interaction_outcomes o, unnest(o.surfaces) as sup
           where o.is_active group by sup) t;

  if n_cat <> 19 then raise exception 'seed: esperadas 19 categorias, encontradas %', n_cat; end if;
  if n_pipe <> 3 then raise exception 'seed: esperados 3 funis, encontrados %', n_pipe; end if;
  if n_forn < 12 then raise exception 'seed: funil fornecedor com % etapas (esperadas 12)', n_forn; end if;
  if n_ativ < 7  then raise exception 'seed: funil ativacao com % etapas (esperadas 7)', n_ativ; end if;
  if n_prod < 14 then raise exception 'seed: funil produtor com % etapas (esperadas 14)', n_prod; end if;
  if n_hol  < 16 then raise exception 'seed: % feriados de % (esperados ao menos 16)', n_hol, ano; end if;
  if n_hol1 < 16 then raise exception 'seed: % feriados de % (esperados ao menos 16; cadências viram o ano)', n_hol1, ano + 1; end if;
  if n_tpl < 40  then raise exception 'seed: % modelos de mensagem (esperados ≥ 40)', n_tpl; end if;
  if n_lost <> 9 then raise exception 'seed: esperados 9 motivos de perda, encontrados %', n_lost; end if;
  if n_out <> 34 then raise exception 'seed: esperados 34 desfechos de interação, encontrados %', n_out; end if;
  if n_sup > 8   then raise exception 'seed: superfície com % desfechos ativos (máximo 8, RF-MET-06)', n_sup; end if;
  if n_eq <> 4   then raise exception 'seed: esperadas 4 equivalências de etapa, encontradas %', n_eq; end if;
  if n_rad < 18  then raise exception 'seed: catálogo do Radar com % listagens (esperadas 18, R03 §2.1, bloco 3b)', n_rad; end if;
  if n_map < 23  then raise exception 'seed: mapa de categorias do Radar com % linhas (esperadas ≥ 23, bloco 3b)', n_map; end if;
  if n_cad <> 5  then raise exception 'seed: esperadas 5 cadências, encontradas % (bloco 12d)', n_cad; end if;
  if n_pas <> 19 then raise exception 'seed: esperados 19 passos de cadência, encontrados % (bloco 12d)', n_pas; end if;
  if n_cad_ruim is not null then
    raise exception 'seed: passo de cadência cita desfecho fora do catálogo: %', n_cad_ruim;
  end if;
  if n_nos is null then raise exception 'seed: roteiro de ligação captacao_v1 não foi semeado'; end if;
  if n_nos <> 37 then raise exception 'seed: roteiro de ligação com % nós (esperados 37)', n_nos; end if;
  if n_rot_err > 0 then raise exception 'seed: roteiro de ligação com % erro(s) estrutural(is): %',
    n_rot_err, array_to_string((select app.validar_roteiro(r.arvore) from public.call_scripts r
                                 where r.slug = 'captacao_v1' and r.versao = 1), ' '); end if;
  if n_ans <> 5 then raise exception 'seed: % desfechos de ligação com requires_answer (esperados 5, R13 §3.3)', n_ans; end if;
  if exists (
    select 1 from public.interaction_outcomes o
     where o.target_stage_slug is not null
       and not exists (select 1 from public.stages s join public.pipelines p on p.id = s.pipeline_id
                        where p.slug = 'fornecedor' and s.slug = o.target_stage_slug)
  ) then
    raise exception 'seed: desfecho com etapa de destino que não existe no funil fornecedor';
  end if;
  -- E no funil PRODUTOR: todo destino tem de resolver, direto ou por equivalência.
  -- A única ausência aceita é `em_conversa`, que o PRD §5.5 não descreve; qualquer
  -- outra é regressão do achado "metade da base nunca esquenta".
  select string_agg(distinct o.target_stage_slug, ', ' order by o.target_stage_slug) into s_eq
    from public.interaction_outcomes o
   where o.is_active and o.target_stage_slug is not null
     and o.target_stage_slug <> 'em_conversa'
     and not exists (select 1 from app.stage_for(
                       (select id from public.pipelines where slug = 'produtor'),
                       o.target_stage_slug));
  if s_eq is not null then
    raise exception 'seed: desfecho sem etapa no funil produtor (nem literal, nem equivalência): %', s_eq;
  end if;
  if exists (select 1 from public.stages where position < 0) then
    raise warning 'seed: há etapas órfãs (posição negativa) que não constam mais da seed';
  end if;

  raise notice 'seed ok (Radar): % listagens no catálogo do Casamentos.com.br e % categorias mapeadas', n_rad, n_map;
  raise notice 'seed ok (cadências): % cadências e % passos, todos com desfecho e modelo existentes', n_cad, n_pas;
  raise notice 'seed ok (ligação): roteiro captacao_v1 com % nós, sem erro estrutural, e % desfechos comerciais de ligação', n_nos, n_ans;
  raise notice 'seed ok: % cidades, % categorias, % fontes, % feriados em % e % em %, % funis (fornecedor %, ativacao %, produtor % etapas), % motivos de perda, % desfechos de interação (máximo % por superfície), % modelos de mensagem',
    n_city, n_cat, n_src, n_hol, ano, n_hol1, ano + 1, n_pipe, n_forn, n_ativ, n_prod, n_lost, n_out, n_sup, n_tpl;
end $$;

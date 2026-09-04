-- =====================================================================
-- pgTAP — Normalização (RF-BAS-05, RF-BAS-08, RF-BAS-14; migrações 000100/000200/000300):
-- telefone E.164, CNPJ, @instagram, domínio do site, nome de busca, máscara e triggers.
-- =====================================================================
begin;
select plan(84);

-- ---------- telefone -> E.164 (app.normalize_phone_br) ----------
select is(app.normalize_phone_br('(84) 99999-1234'),    '+5584999991234', 'telefone: celular com DDD entre parênteses');
select is(app.normalize_phone_br('84 99999 1234'),      '+5584999991234', 'telefone: celular com espaços');
select is(app.normalize_phone_br('+55 84 99999-1234'),  '+5584999991234', 'telefone: já com +55');
select is(app.normalize_phone_br('0055 84 99999 1234'), '+5584999991234', 'telefone: DDI 0055 removido');
select is(app.normalize_phone_br('0 84 99999-1234'),    '+5584999991234', 'telefone: zero de discagem nacional removido');
select is(app.normalize_phone_br('021 84 99999-1234'),  '+5584999991234', 'telefone: zero + código de operadora removidos');
select is(app.normalize_phone_br('99999-1234'),         '+5584999991234', 'telefone: sem DDD assume 84');
select is(app.normalize_phone_br('9999-1234'),          '+5584999991234', 'telefone: 8 dígitos sem DDD ganha 84 e o nono dígito');
select is(app.normalize_phone_br('84 9999-1234'),       '+5584999991234', 'telefone: celular antigo (8 dígitos) ganha o nono dígito');
select is(app.normalize_phone_br('(84) 3206-4212'),     '+558432064212',  'telefone: fixo com DDD fica com 10 dígitos');
select is(app.normalize_phone_br('3206-4212'),          '+558432064212',  'telefone: fixo sem DDD assume 84');
select is(app.normalize_phone_br('+55 (11) 91234-5678'),'+5511912345678', 'telefone: outro DDD é preservado');
select is(app.normalize_phone_br('55 84 3206 4212'),    '+558432064212',  'telefone: DDI 55 sem sinal de + removido');
select is(app.normalize_phone_br('84 89999-1234'),      null,             'telefone: 11 dígitos sem o 9 é inválido');
select is(app.normalize_phone_br('84 1234-5678'),       null,             'telefone: fixo começando em 1 é inválido');
select is(app.normalize_phone_br('+55 04 3206-4212'),   null,             'telefone: DDD com zero é inválido');
select is(app.normalize_phone_br('123'),                null,             'telefone: poucos dígitos');
select is(app.normalize_phone_br(''),                   null,             'telefone: vazio -> NULL');
select is(app.normalize_phone_br(null),                 null,             'telefone: NULL -> NULL');
select is(app.normalize_phone_br('abc'),                null,             'telefone: sem dígitos -> NULL');

-- ---------- CNPJ ----------
select is(app.normalize_cnpj('12.345.678/0001-95'), '12345678000195', 'cnpj: máscara removida');
select is(app.normalize_cnpj('123'),                null,             'cnpj: menos de 14 dígitos -> NULL');
select is(app.normalize_cnpj(null),                 null,             'cnpj: NULL -> NULL');
select is(app.cnpj_is_valid('12.345.678/0001-95'),  true,             'cnpj: dígitos verificadores válidos');
select is(app.cnpj_is_valid('11.222.333/0001-81'),  true,             'cnpj: segundo exemplo válido');
select is(app.cnpj_is_valid('12345678000196'),      false,            'cnpj: DV errado');
select is(app.cnpj_is_valid('11.111.111/1111-11'),  false,            'cnpj: sequência repetida rejeitada');
select is(app.cnpj_is_valid('123'),                 false,            'cnpj: curto é inválido');

-- ---------- @instagram ----------
select is(app.normalize_instagram('@Buffet.Natal'),                               'buffet.natal', 'instagram: @ removido e minúsculo');
select is(app.normalize_instagram('https://www.instagram.com/buffet_natal/?hl=pt'), 'buffet_natal', 'instagram: URL completa vira handle');
select is(app.normalize_instagram('instagram.com/buffet_natal/'),                 'buffet_natal', 'instagram: URL sem protocolo');
select is(app.normalize_instagram('@@buffet'),                                    'buffet',       'instagram: arrobas repetidos');
select is(app.normalize_instagram('nome com espaço'),                             null,           'instagram: espaço é inválido');
select is(app.normalize_instagram('buffet-natal'),                                null,           'instagram: hífen é inválido');
select is(app.normalize_instagram(repeat('a', 31)),                               null,           'instagram: mais de 30 caracteres');
select is(app.normalize_instagram(''),                                            null,           'instagram: vazio -> NULL');
-- Link de post/reel/rota de sistema não é perfil: devolver 'p'/'reel'/'explore' colidia no
-- índice único (23505) e criava falso positivo de dedup entre empresas sem relação (RF-BAS-08).
select is(app.normalize_instagram('https://www.instagram.com/p/CxYz123/'),        null,           'instagram: link de post não vira handle');
select is(app.normalize_instagram('https://instagram.com/reel/AbC/'),             null,           'instagram: link de reel não vira handle');
select is(app.normalize_instagram('instagram.com/explore/tags/buffet/'),          null,           'instagram: página de explorar não vira handle');
select is(app.normalize_instagram('https://www.instagram.com/accounts/login/'),   null,           'instagram: página de sistema não vira handle');
select is(app.normalize_instagram('https://m.instagram.com/buffet.natal'),        'buffet.natal', 'instagram: URL móvel (m.instagram.com) com protocolo');
select is(app.normalize_instagram('m.instagram.com/buffet.natal'),                'buffet.natal', 'instagram: URL móvel sem protocolo');
select is(app.normalize_instagram('https://www.instagram.com/buffet.natal/reel/AbC/'), 'buffet.natal', 'instagram: reel dentro do perfil devolve o perfil');
select is(app.normalize_instagram('https://www.instagram.com/stories/buffet.natal/3211/'), null, 'instagram: link de story não vira handle');
select is(app.normalize_instagram('https://www.instagram.com/tv/AbC123/'),                 null, 'instagram: link de IGTV não vira handle');

-- ---------- domínio do site ----------
select is(app.website_domain('https://www.buffetnatal.com.br/contato?x=1'), 'buffetnatal.com.br', 'domínio: protocolo, www, caminho e query removidos');
select is(app.website_domain('HTTP://BuffetNatal.com.br:8080/'),            'buffetnatal.com.br', 'domínio: porta removida e minúsculo');
select is(app.website_domain('buffetnatal.com.br'),                         'buffetnatal.com.br', 'domínio: já limpo permanece');
select is(app.website_domain(''),                                           null,                 'domínio: vazio -> NULL');
select is(app.website_domain(null),                                         null,                 'domínio: NULL -> NULL');
-- O domínio vira chave de dedup 0,90 (RF-BAS-08): texto livre de planilha não pode virar
-- "domínio", senão todas as linhas "sem site" viram duplicatas umas das outras.
select is(app.website_domain('sem site'),                                   null,                 'domínio: texto livre não é hostname');
select is(app.website_domain('só instagram'),                               null,                 'domínio: texto livre com acento não é hostname');
select is(app.website_domain('-'),                                          null,                 'domínio: traço não é hostname');
select is(app.website_domain('ftp://exemplo.com.br/pasta'),                 'exemplo.com.br',     'domínio: qualquer esquema é removido');
select is(app.website_domain('https://user:senha@exemplo.com.br/'),         'exemplo.com.br',     'domínio: credenciais na URL são descartadas');
select is(app.website_domain('exemplo.com.br.'),                            'exemplo.com.br',     'domínio: ponto final de FQDN cai (casa com a forma sem ponto)');
select is(app.is_shared_web_host('instagram.com'),                          true,                 'domínio: instagram.com é host compartilhado');
select is(app.is_shared_web_host('buffetnatal.com.br'),                     false,                'domínio: site próprio não é host compartilhado');
select is(app.is_shared_web_host('wa.me'),                                  true,                 'domínio: wa.me é host compartilhado (link de conversa não identifica empresa)');
select is(app.is_shared_web_host('linktr.ee'),                              true,                 'domínio: linktr.ee é host compartilhado');

-- ---------- nome de busca ----------
select is(app.search_name('  Buffet   São  João '), 'buffet sao joao', 'search_name: sem acento, minúsculo, espaços colapsados');
select is(app.search_name(''),                       null,              'search_name: vazio -> NULL');

-- ---------- máscara de telefone (RF-BAS-14) ----------
select is(app.mask_phone('+5584999991234'), '+55 84 •••••-••34', 'máscara: celular mantém DDD e 2 últimos dígitos');
select is(app.mask_phone('+558432064212'),  '+55 84 ••••-••12',  'máscara: fixo');
select is(app.mask_phone('abc'),            '••••••',            'máscara: valor fora do padrão é totalmente oculto');
select is(app.mask_phone(null),             null,                'máscara: NULL -> NULL');

-- ---------- hash e dias úteis ----------
select is(app.sha256_hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256_hex: vetor conhecido');
select is(app.next_business_day('2026-09-04'::date),    '2026-09-08'::date, 'dia útil: sexta 04/09 -> terça 08/09 (fim de semana + feriado 07/09)');
select is(app.next_business_day('2026-09-08'::date, 2), '2026-09-10'::date, 'dia útil: N=2 conta dois dias úteis');

-- ---------- trigger organizations_normalize ----------
insert into public.organizations (id, name, cnpj, phone_e164, instagram_handle, website, neighborhood, source_id) values
  ('b0000000-0000-4000-8000-000000000101', '  Buffet   São  João ', '12.345.678/0001-95', '(84) 99999-1234',
   '@Buffet.SaoJoao', 'https://www.buffetsaojoao.com.br/', '  ', (select id from public.sources where slug = 'captura_campo'));
select results_eq(
  $$select name, cnpj, phone_e164, instagram_handle, website_domain, search_name, neighborhood
      from public.organizations where id = 'b0000000-0000-4000-8000-000000000101'$$,
  $$values ('Buffet São João'::text, '12345678000195'::text, '+5584999991234'::text, 'buffet.saojoao'::text,
            'buffetsaojoao.com.br'::text, 'buffet sao joao'::text, null::text)$$,
  'organizations: trigger normaliza nome, CNPJ, telefone, @, domínio, search_name e bairro vazio');
select throws_ok(
  $$insert into public.organizations (name, phone_e164, source_id) values ('Tel inválido', '84 1234', (select id from public.sources where slug = 'captura_campo'))$$,
  '23514', null, 'organizations: telefone inválido é rejeitado');
select throws_ok(
  $$insert into public.organizations (name, cnpj, source_id) values ('CNPJ inválido', '12345678000196', (select id from public.sources where slug = 'captura_campo'))$$,
  '23514', null, 'organizations: CNPJ com DV errado é rejeitado');
select throws_ok(
  $$insert into public.organizations (name, instagram_handle, source_id) values ('IG inválido', 'nome com espaço', (select id from public.sources where slug = 'captura_campo'))$$,
  '23514', null, 'organizations: @instagram inválido é rejeitado');
select lives_ok(
  $$insert into public.organizations (id, name, cnpj, phone_e164, instagram_handle, source_id)
      values ('b0000000-0000-4000-8000-000000000102', 'Sem dados', '', '   ', '', (select id from public.sources where slug = 'captura_campo'))$$,
  'organizations: strings vazias são aceitas');
select results_eq(
  $$select cnpj, phone_e164, instagram_handle from public.organizations where id = 'b0000000-0000-4000-8000-000000000102'$$,
  $$values (null::text, null::text, null::text)$$,
  'organizations: strings vazias viram NULL');
-- ADR-09: CPF, dados bancários e Pix não entram no CRM — nem por campo personalizado criado
-- na importação a partir do cabeçalho da planilha (RF-BAS-07).
select throws_ok(
  $$insert into public.organizations (name, source_id, custom)
      values ('Com CPF', (select id from public.sources where slug = 'captura_campo'), '{"cpf":"12345678901"}'::jsonb)$$,
  '23514', null, 'organizations: campo personalizado de CPF é recusado (ADR-09)');
select lives_ok(
  $$insert into public.organizations (name, source_id, custom)
      values ('Com campo livre', (select id from public.sources where slug = 'captura_campo'), '{"capacidade":"200 pessoas"}'::jsonb)$$,
  'organizations: campo personalizado comum continua aceito (RF-BAS-07)');
select throws_ok(
  $$insert into public.organizations (name, source_id, custom)
      values ('Com Pix', (select id from public.sources where slug = 'captura_campo'), '{"chave_pix":"84999991234"}'::jsonb)$$,
  '23514', null, 'organizations: campo personalizado de chave Pix é recusado (ADR-09)');
-- RF-BAS-10: origem obrigatória COM collected_at e collector. Sem sessão (worker, cron, seed,
-- importação) a proveniência fica 'sistema' em vez de NULL.
select col_not_null('public', 'organizations', 'collector', 'organizations: collector é obrigatório (RF-BAS-10)');
select is((select collector from public.organizations where id = 'b0000000-0000-4000-8000-000000000102'), 'sistema',
  'organizations: sem usuário logado o collector fica "sistema"');

-- ---------- trigger contacts_normalize ----------
insert into public.contacts (id, full_name, phone_e164, instagram_handle) values
  ('c0000000-0000-4000-8000-000000000101', ' Maria   da Silva ', '84 99999-4321', '@Maria.Silva');
select results_eq(
  $$select full_name, first_name, phone_e164, instagram_handle from public.contacts where id = 'c0000000-0000-4000-8000-000000000101'$$,
  $$values ('Maria da Silva'::text, 'Maria'::text, '+5584999994321'::text, 'maria.silva'::text)$$,
  'contacts: nome colapsado, first_name derivado, telefone e @ normalizados');
insert into public.contacts (id, full_name, first_name) values
  ('c0000000-0000-4000-8000-000000000102', 'João Pedro Souza', 'JP');
select is((select first_name from public.contacts where id = 'c0000000-0000-4000-8000-000000000102'), 'JP',
  'contacts: first_name informado é preservado');
select throws_ok(
  $$insert into public.contacts (full_name, phone_e164) values ('Tel inválido', '84 89999-0000')$$,
  '23514', null, 'contacts: telefone inválido é rejeitado');

-- ---------- trigger profiles_normalize ----------
insert into public.allowed_users (email, role, note) values ('perfil@teste.local', 'sdr', 'pgTAP');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000101', 'perfil@teste.local', '{"full_name":"Perfil Teste"}');
update public.profiles set phone_e164 = '(84) 98888-7777' where id = 'a0000000-0000-4000-8000-000000000101';
select is((select phone_e164 from public.profiles where id = 'a0000000-0000-4000-8000-000000000101'), '+5584988887777',
  'profiles: telefone do perfil normalizado');

select * from finish();
rollback;

-- =====================================================================
-- pgTAP — Radar: candidatos, higiene de entrada, fila de revisão e fontes
-- (migração 20260904001401):
--   public.supplier_candidates · app.supplier_candidates_normalize
--   · app.cpf_is_valid · app.ddd_da_regiao · public.radar_criar_candidato
--   · public.radar_fila · public.radar_revisar_candidato
--   · public.radar_alternar_fonte · public.radar_resumo
--
-- O que estes testes garantem, em uma frase cada:
--   * CPF nunca é persistido, nem grudado no nome de MEI (ADR-09, RF-RAD-16);
--   * DDD de fora e @ fora do padrão MARCAM, não reprovam (RF-RAD-16);
--   * número suprimido nasce "não contatar" e não vira alvo (RF-RAD-09);
--   * aprovar cria ficha e negócio; mesclar completa sem sobrescrever;
--   * recusar exige motivo escrito;
--   * fonte sem robots.txt avaliado não liga (RF-RAD-01).
--
-- Roda em transação e desfaz tudo. Nada depende de contagem absoluta da seed.
-- =====================================================================
begin;
select plan(69);

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
create function pg_temp.fonte(p_slug text) returns int language sql as $$
  select id from public.sources where slug = p_slug
$$;
create function pg_temp.categoria(p_slug text) returns int language sql as $$
  select id from public.categories where slug = p_slug
$$;
create function pg_temp.cand(p_nome text) returns public.supplier_candidates language sql as $$
  select c.* from public.supplier_candidates c where c.name like p_nome || '%' order by c.created_at desc limit 1
$$;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('radar.gestor@teste.local', 'gestor', 'pgTAP radar'),
  ('radar.sdr@teste.local',    'sdr',    'pgTAP radar'),
  ('radar.leitura@teste.local','leitura','pgTAP radar');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-00000000e001', 'radar.gestor@teste.local',  '{"full_name":"Gestor Radar"}'),
  ('a0000000-0000-4000-8000-00000000e002', 'radar.sdr@teste.local',     '{"full_name":"SDR Radar"}'),
  ('a0000000-0000-4000-8000-00000000e003', 'radar.leitura@teste.local', '{"full_name":"Leitura Radar"}');


-- =====================================================================
-- 1. A tabela existe, com RLS
-- =====================================================================
select has_table('public', 'supplier_candidates', 'supplier_candidates existe');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.supplier_candidates'::regclass),
  'supplier_candidates nasce com RLS habilitada');


-- =====================================================================
-- 2. app.cpf_is_valid — só reconhece CPF de verdade
-- =====================================================================
select ok(app.cpf_is_valid('529.982.247-25'), 'CPF válido é reconhecido');
select ok(app.cpf_is_valid('52998224725'),    'CPF válido sem pontuação é reconhecido');
select ok(not app.cpf_is_valid('529.982.247-26'), 'dígito verificador errado não é CPF');
select ok(not app.cpf_is_valid('111.111.111-11'), 'sequência repetida não é CPF');
select ok(not app.cpf_is_valid('1234567890'),     'dez dígitos não é CPF');

select ok(app.ddd_da_regiao('+5584999990001'), 'DDD 84 é da região');
select ok(not app.ddd_da_regiao('+5511999990001'), 'DDD 11 não é da região');


-- =====================================================================
-- 3. Higiene de entrada (RF-RAD-16): CPF descartado do nome
-- =====================================================================
insert into public.supplier_candidates (source_id, collector, name, phone_e164, neighborhood)
values (pg_temp.fonte('captura_campo'), 'pgTAP',
        'MARIA DAS DORES 529.982.247-25', '84 99999-0101', 'Tirol');

select is((pg_temp.cand('MARIA DAS DORES')).name, 'MARIA DAS DORES',
          'o CPF é apagado do nome empresarial de MEI');
select ok('cpf_descartado' = any ((pg_temp.cand('MARIA DAS DORES')).flags),
          'o descarte do CPF fica registrado em flags');
select ok((pg_temp.cand('MARIA DAS DORES')).is_natural_person,
          'nome com CPF marca o candidato como pessoa natural');
select ok(((pg_temp.cand('MARIA DAS DORES')).payload ? 'cpf_descartado_em'),
          'o descarte fica datado em payload, sem guardar o número');
select is((pg_temp.cand('MARIA DAS DORES')).phone_e164, '+5584999990101',
          'telefone é normalizado para E.164');
select is((pg_temp.cand('MARIA DAS DORES')).flags, array['cpf_descartado'],
          'telefone do DDD 84 e com contato não gera outra marca');

-- CNPJ com dígito verificador errado é marcado e NÃO persistido.
insert into public.supplier_candidates (source_id, collector, name, cnpj, phone_e164)
values (pg_temp.fonte('base_cnpj'), 'pgTAP', 'CNPJ Que Não Fecha', '11.111.111/1111-11', '84 99999-0404');
select is((pg_temp.cand('CNPJ Que Não Fecha')).cnpj, null,
          'CNPJ com dígito verificador errado não é persistido');
select ok('cnpj_invalido' = any ((pg_temp.cand('CNPJ Que Não Fecha')).flags),
          'CNPJ inválido marca o candidato para revisão');

-- Número de 11 dígitos que NÃO é CPF continua no nome (é protocolo, inscrição etc.).
insert into public.supplier_candidates (source_id, collector, name, instagram_handle)
values (pg_temp.fonte('captura_campo'), 'pgTAP', 'Buffet 111.111.111-11 Ltda', 'buffet.teste');
select is((pg_temp.cand('Buffet 111')).name, 'Buffet 111.111.111-11 Ltda',
          'número de 11 dígitos sem dígito verificador válido não é apagado');


-- =====================================================================
-- 4. Higiene: DDD de fora, @ fora do padrão e ausência de contato MARCAM
-- =====================================================================
insert into public.supplier_candidates (source_id, collector, name, phone_e164, instagram_handle)
values (pg_temp.fonte('instagram'), 'pgTAP', 'Alvo Fora da Praça', '11 99999-0202', 'https://exemplo.com/nao-e-insta');

select ok('ddd_de_fora' = any ((pg_temp.cand('Alvo Fora')).flags),
          'DDD fora do Nordeste marca o candidato');
select ok('instagram_fora_do_padrao' = any ((pg_temp.cand('Alvo Fora')).flags),
          '@instagram fora do padrão marca o candidato');
select is((pg_temp.cand('Alvo Fora')).instagram_handle, null,
          '@ fora do padrão não é persistido');
select is((pg_temp.cand('Alvo Fora')).status, 'novo'::app.candidate_status,
          'marca não reprova: o candidato continua na fila');

insert into public.supplier_candidates (source_id, collector, name, neighborhood)
values (pg_temp.fonte('casamentos_com_br'), 'pgTAP', 'Espaço Sem Contato', 'Ponta Negra');
select ok('sem_contato' = any ((pg_temp.cand('Espaço Sem')).flags),
          'candidato sem nenhum canal de contato é marcado');

insert into public.supplier_candidates (source_id, collector, name, phone_e164)
values (pg_temp.fonte('captura_campo'), 'pgTAP', 'Telefone Torto', '1234');
select ok('telefone_invalido' = any ((pg_temp.cand('Telefone Torto')).flags),
          'telefone impossível é marcado, não gravado');
select is((pg_temp.cand('Telefone Torto')).phone_e164, null,
          'telefone impossível não é persistido');


-- =====================================================================
-- 5. Supressão consultada antes de gravar (RF-RAD-09)
-- =====================================================================
insert into public.suppression_list (hash, kind, reason)
values (app.sha256_hex('+5584999990303'), 'phone', 'pgTAP: pediu para sair');

insert into public.supplier_candidates (source_id, collector, name, phone_e164)
values (pg_temp.fonte('captura_campo'), 'pgTAP', 'Ja Pediu Para Sair', '84 99999-0303');
select ok((pg_temp.cand('Ja Pediu')).do_not_contact,
          'número suprimido faz o candidato nascer com não contatar');
select ok('suprimido' = any ((pg_temp.cand('Ja Pediu')).flags),
          'a supressão fica visível em flags');


-- =====================================================================
-- 6. RLS: quem não trabalha a fila não lê a fila
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-00000000e003', 'leitura');
select is((select count(*)::int from public.supplier_candidates), 0,
          'papel leitura não enxerga candidato nenhum');
select throws_ok(
  $$ select public.radar_fila() $$, '42501',
  null, 'radar_fila recusa papel que não trabalha a fila');
select pg_temp.sair();


-- =====================================================================
-- 7. Entrada manual (radar_criar_candidato)
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-00000000e002', 'sdr');

select is(
  (public.radar_criar_candidato('  ', pg_temp.fonte('captura_campo')) ->> 'reason'),
  'nome_obrigatorio', 'nome em branco é recusado');

select is(
  (public.radar_criar_candidato('Fonte Que Não Existe', 99999) ->> 'reason'),
  'origem_invalida', 'origem inexistente é recusada');

select is(
  (public.radar_criar_candidato('Categoria Torta', pg_temp.fonte('captura_campo'), 99999) ->> 'reason'),
  'categoria_invalida', 'categoria inativa ou inexistente é recusada');

select is(
  (public.radar_criar_candidato('CNPJ Torto', pg_temp.fonte('captura_campo'), null, null,
                                null, null, '11.111.111/1111-11') ->> 'reason'),
  'cnpj_invalido', 'CNPJ com dígito verificador errado é recusado');

select ok(
  (public.radar_criar_candidato('Doces da Rita', pg_temp.fonte('captura_campo'),
                                pg_temp.categoria('doces_bolos_confeitaria'),
                                '84 98888-1010', '@docesdarita', null, null,
                                'Capim Macio') ->> 'created')::boolean,
  'entrada manual cria o candidato');

select is((pg_temp.cand('Doces da Rita')).kind, 'fornecedor'::app.org_kind,
          'a categoria decide o tipo do candidato');
select is((pg_temp.cand('Doces da Rita')).instagram_handle, 'docesdarita',
          '@ é normalizado na entrada manual');
select is((pg_temp.cand('Doces da Rita')).collector, 'SDR Radar',
          'quem digitou fica registrado como coletor');

select is(
  (public.radar_criar_candidato('Doces da Rita (de novo)', pg_temp.fonte('captura_campo'),
                                pg_temp.categoria('doces_bolos_confeitaria'),
                                '84 98888-1010') ->> 'reason'),
  'ja_esta_na_fila', 'o mesmo telefone não entra duas vezes na fila');

-- Categoria de produção nasce como produtor (funil próprio).
select ok(
  (public.radar_criar_candidato('Produtora Teste Radar', pg_temp.fonte('contato_pessoal'),
                                pg_temp.categoria('produtoras_corporativas_organizadores'),
                                '84 98888-2020') ->> 'created')::boolean,
  'candidato de categoria de produção é criado');
select is((pg_temp.cand('Produtora Teste Radar')).kind, 'produtor'::app.org_kind,
          'categoria do grupo produção vira produtor');


-- =====================================================================
-- 8. A fila (radar_fila): paginação, filtro e duplicatas
-- =====================================================================
select ok((select count(*) from public.radar_fila('novo')) > 0, 'a fila devolve os candidatos novos');
select ok((select count(*) from public.radar_fila('novo', pg_temp.fonte('captura_campo'))) > 0,
          'a fila filtra por fonte');
select ok((select count(*) from public.radar_fila('novo', null, null, 'Doces da Rita')) = 1,
          'a fila acha por nome');
select ok((select count(*) from public.radar_fila('novo', null, null, null, true)) > 0,
          'a fila sabe mostrar só os marcados pela higiene');

-- Telefone mascarado para sdr (RF-BAS-14).
select ok(
  (select f.telefone like '%•%' from public.radar_fila('novo', null, null, 'Doces da Rita') f),
  'sdr lê o telefone do candidato mascarado');
select ok(
  (select f.tem_telefone from public.radar_fila('novo', null, null, 'Doces da Rita') f),
  'a fila diz que há telefone mesmo mascarado');

-- Duplicata: uma organização com o mesmo telefone tem de aparecer sugerida.
select pg_temp.sair();
insert into public.organizations (id, name, phone_e164, neighborhood, source_id)
values ('c0000000-0000-4000-8000-0000000e0001', 'Sushi do Radar', '+5584987770001', 'Tirol',
        (select id from public.sources where slug = 'planilha'));
select pg_temp.entrar('a0000000-0000-4000-8000-00000000e002', 'sdr');
select ok(
  (public.radar_criar_candidato('Sushi do Radar (achado no Insta)', pg_temp.fonte('instagram'),
                                pg_temp.categoria('buffet_adulto_corporativo'),
                                '84 98777-0001') ->> 'created')::boolean,
  'candidato que duplica uma ficha existente entra na fila mesmo assim');
select is(
  (select jsonb_array_length(f.duplicatas) from public.radar_fila('novo', null, null, 'Sushi do Radar (achado') f),
  1, 'a fila já traz a duplicata sugerida por app.find_org_matches');
select is(
  (select f.duplicatas -> 0 ->> 'reason' from public.radar_fila('novo', null, null, 'Sushi do Radar (achado') f),
  'phone', 'a duplicata diz por que casou');


-- =====================================================================
-- 9. A decisão (radar_revisar_candidato)
-- =====================================================================
-- Recusar sem motivo escrito não é decisão.
select is(
  (public.radar_revisar_candidato((pg_temp.cand('Telefone Torto')).id, 'recusar') ->> 'reason'),
  'motivo_obrigatorio', 'recusar exige motivo escrito');

select ok(
  (public.radar_revisar_candidato((pg_temp.cand('Telefone Torto')).id, 'recusar', null, null,
                                  'Fora do escopo: não é fornecedor de evento') ->> 'ok')::boolean,
  'recusar com motivo funciona');
select is((pg_temp.cand('Telefone Torto')).status, 'recusado'::app.candidate_status,
          'o candidato recusado sai da fila de novos');
select is(
  (public.radar_revisar_candidato((pg_temp.cand('Telefone Torto')).id, 'aprovar') ->> 'reason'),
  'ja_revisado', 'candidato já revisado não é revisado de novo');

-- Suprimido nunca vira alvo.
select is(
  (public.radar_revisar_candidato((pg_temp.cand('Ja Pediu')).id, 'aprovar', null,
                                  pg_temp.categoria('doces_bolos_confeitaria')) ->> 'reason'),
  'candidato_nao_contatar', 'candidato suprimido não pode ser aprovado');

-- Aprovar: vira ficha e negócio na primeira etapa.
select ok(
  (public.radar_revisar_candidato((pg_temp.cand('Doces da Rita')).id, 'aprovar') ->> 'ok')::boolean,
  'aprovar cria o parceiro');
select is((pg_temp.cand('Doces da Rita')).status, 'aprovado'::app.candidate_status,
          'o candidato aprovado fica marcado como aprovado');
select ok(
  (select count(*) from public.deals d
    where d.organization_id = (pg_temp.cand('Doces da Rita')).organization_id) = 1,
  'aprovar abre um negócio no funil');

-- Aprovar um candidato que duplica ficha existente é barrado com motivo legível.
select is(
  (public.radar_revisar_candidato((pg_temp.cand('Sushi do Radar (achado')).id, 'aprovar') ->> 'reason'),
  'ja_existe_na_base', 'aprovar duplicata devolve motivo, não erro de banco');

-- Mesclar: completa o que falta, sem sobrescrever o que já estava.
select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-00000000e001', 'gestor');
select ok(
  (public.radar_revisar_candidato((pg_temp.cand('Sushi do Radar (achado')).id, 'mesclar',
                                  'c0000000-0000-4000-8000-0000000e0001') ->> 'ok')::boolean,
  'mesclar com a ficha existente funciona');
select is(
  (select o.instagram_handle from public.organizations o
    where o.id = 'c0000000-0000-4000-8000-0000000e0001'),
  null, 'mesclar só completa: o candidato não trouxe @ e nada foi inventado');
select is(
  (select o.neighborhood from public.organizations o
    where o.id = 'c0000000-0000-4000-8000-0000000e0001'),
  'Tirol', 'mesclar não sobrescreve o bairro que já estava na ficha');
select is((pg_temp.cand('Sushi do Radar (achado')).status, 'mesclado'::app.candidate_status,
          'o candidato mesclado sai da fila');

-- Eliminação da LGPD (RF-ADM-06): apagar a ficha resultante NÃO pode travar por causa
-- do candidato que apontava para ela. O candidato fica sem organização e mantém o
-- registro da decisão.
select pg_temp.sair();
delete from public.deals where organization_id = 'c0000000-0000-4000-8000-0000000e0001';
delete from public.activities where organization_id = 'c0000000-0000-4000-8000-0000000e0001';
delete from public.organization_categories where organization_id = 'c0000000-0000-4000-8000-0000000e0001';
select lives_ok(
  $$ delete from public.organizations where id = 'c0000000-0000-4000-8000-0000000e0001' $$,
  'apagar a organização não trava por causa do candidato mesclado (LGPD)');
select is((pg_temp.cand('Sushi do Radar (achado')).organization_id, null,
          'o candidato fica sem ficha, e não impede a eliminação');
select pg_temp.entrar('a0000000-0000-4000-8000-00000000e001', 'gestor');


-- =====================================================================
-- 10. Ligar e desligar fonte (RF-RAD-01)
-- =====================================================================
select ok((public.radar_alternar_fonte(pg_temp.fonte('google_places'), false) ->> 'ok')::boolean,
          'gestor desliga uma fonte');
select is(
  (public.radar_alternar_fonte(pg_temp.fonte('google_places'), true) ->> 'reason'),
  'robots_nao_avaliado', 'fonte sem robots.txt avaliado não pode ser ligada');
select ok((public.radar_alternar_fonte(pg_temp.fonte('casamentos_com_br'), true) ->> 'ok')::boolean,
          'fonte com robots avaliado e termos registrados liga');

select pg_temp.sair();
select pg_temp.entrar('a0000000-0000-4000-8000-00000000e002', 'sdr');
select throws_ok(
  format($$ select public.radar_alternar_fonte(%s, false) $$, pg_temp.fonte('casamentos_com_br')),
  '42501', null, 'sdr não liga nem desliga fonte');

select ok((public.radar_resumo() ->> 'novos')::int >= 0, 'radar_resumo devolve a contagem da fila');
select pg_temp.sair();

select * from finish();
rollback;

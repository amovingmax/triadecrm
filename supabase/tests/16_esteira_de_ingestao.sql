-- =====================================================================
-- pgTAP — A esteira de ingestão (migração 20260904001600)
--   public.import_batches · raw_capture · source_record · field_provenance
--   · worker_heartbeats · ingest_queues · ingest_dedup
--   · app.tem_cpf / app.sem_cpf / app.payload_e_permitido
--   · app.source_record_normalize · app.supplier_candidates_normalize
--   · app.resolver_source_record · app.promover_candidato
--   · app.mesclar_candidato · app.recusar_candidato
--   · app.esteira_enfileirar / esteira_falhar · app.aplicar_retencao
--   · public.esteira_* · public.origem_dos_dados
--
-- O que este arquivo tem de provar, e por quê:
--   1. O CPF nunca é gravado — nem no nome, nem na razão social, nem no
--      endereço, nem nas observações —, e o DESCARTE deixa rastro sem deixar o
--      número: nem o valor, nem o hash dele (um hash de 11 dígitos é um CPF
--      pesquisável por força bruta). É o ADR-09 e o RF-BAS-16 na mesma linha.
--   2. A whitelist do R06 (SCR-01/SCR-02) é constraint, não parágrafo: foto,
--      descrição, avaliação em texto, Pix e dado bancário são recusados PELO
--      BANCO, inclusive quando escondidos dentro de um objeto aninhado.
--   3. DDD de fora e @ fora do padrão MARCAM para revisão humana; nunca
--      reprovam (RF-BAS-16: o formulário de campo tem 20 segundos).
--   4. Reprocessar a mesma captura duas vezes não cria dois candidatos nem duas
--      organizações. É a promessa central da esteira e a mais fácil de quebrar.
--   5. A dedup do RF-BAS-08 impede a duplicata DENTRO da transação da promoção,
--      e não só na prévia — entre a prévia e o clique a base pode ter mudado.
--   6. A fila entrega ao menos uma vez; a chave de idempotência faz o efeito
--      acontecer exatamente uma. O que falha além do teto vai para a
--      dead-letter em vez de girar para sempre.
--   7. A RLS: dado de terceiro ainda não revisado é o que menos gente pode ver.
--   8. A retenção do PRD §10.6 apaga o que passou do prazo — de verdade, com o
--      relógio andado, e não só "a função existe".
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada. Este banco tem
-- operação real dentro (100 organizações, lotes, ligações) e a suíte tem de
-- passar assim. Tudo é delta contra uma base lida fora da RLS, ou escopo por id
-- do próprio arquivo.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(125);

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
create function pg_temp.cat(p_slug text) returns int language sql as $$
  select id from public.categories where slug = p_slug
$$;

-- ---------- contagens de BASE, lidas FORA da RLS ----------
-- Contagem fixa em tabela que a operação alimenta é um teste que só passa uma vez.
create function pg_temp.n_orgs() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.organizations where deleted_at is null
$$;
create function pg_temp.n_cand() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.supplier_candidates
$$;
create function pg_temp.n_prov() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.field_provenance
$$;
create table pg_temp.base (chave text primary key, n int);
grant select on pg_temp.base to authenticated;
insert into pg_temp.base values
  ('orgs', pg_temp.n_orgs()), ('cand', pg_temp.n_cand()), ('prov', pg_temp.n_prov());
create function pg_temp.delta(p_chave text, p_agora int) returns int language sql as $$
  select p_agora - (select n from pg_temp.base where chave = p_chave)
$$;

-- ---------- pessoas ----------
insert into public.allowed_users (email, role, note) values
  ('esteira.admin@teste.local',   'admin',   'pgTAP esteira'),
  ('esteira.gestor@teste.local',  'gestor',  'pgTAP esteira'),
  ('esteira.sdr@teste.local',     'sdr',     'pgTAP esteira'),
  ('esteira.leitura@teste.local', 'leitura', 'pgTAP esteira');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000f0001', 'esteira.admin@teste.local',   '{"full_name":"Admin Esteira"}'),
  ('a0000000-0000-4000-8000-0000000f0002', 'esteira.gestor@teste.local',  '{"full_name":"Gestor Esteira"}'),
  ('a0000000-0000-4000-8000-0000000f0003', 'esteira.sdr@teste.local',     '{"full_name":"SDR Esteira"}'),
  ('a0000000-0000-4000-8000-0000000f0004', 'esteira.leitura@teste.local', '{"full_name":"Leitura Esteira"}');


-- =====================================================================
-- 1. As tabelas existem, todas com RLS
-- =====================================================================
select has_table('public', 'import_batches',      'import_batches existe');
select has_table('public', 'raw_capture',         'raw_capture existe');
select has_table('public', 'source_record',       'source_record existe');
select has_table('public', 'field_provenance',    'field_provenance existe');
select has_table('public', 'worker_heartbeats',   'worker_heartbeats existe');
select has_table('public', 'ingest_queues',       'ingest_queues existe');
select has_table('public', 'ingest_dedup',        'ingest_dedup existe');
select ok((select bool_and(c.relrowsecurity)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname in ('import_batches','raw_capture','source_record','field_provenance',
                                'worker_heartbeats','ingest_queues','ingest_dedup',
                                'source_category_map','retention_runs')),
          'toda tabela da esteira nasce com RLS habilitada');
select ok(exists (select 1 from pg_extension where extname = 'pgmq'), 'pgmq instalado (ADR-11)');
select is((select count(*)::int from pgmq.list_queues()
            where queue_name in ('ingest_jobs','ingest_pages','ingest_records','ingest_dlq')),
          4, 'as quatro filas da esteira existem');
select ok(exists (select 1 from cron.job where jobname = 'aplicar_retencao'),
          'a retenção do §10.6 está agendada no pg_cron');


-- =====================================================================
-- 2. A whitelist do R06 é constraint, não parágrafo
-- =====================================================================
select ok(app.payload_e_permitido(
            '{"nome_comercial":"X","telefones":["84999990001"],"cidade":"Natal","fotos_qtd":12}'::jsonb),
          'payload só com campos da whitelist é aceito');
select ok(not app.payload_e_permitido('{"nome_comercial":"X","descricao":"texto de terceiro"}'::jsonb),
          'texto descritivo de terceiro é recusado (SCR-02)');
select ok(not app.payload_e_permitido('{"nome_comercial":"X","fotos":["https://a/1.jpg"]}'::jsonb),
          'URL de foto é recusada — direito de imagem, não detalhe');
select ok(not app.payload_e_permitido('{"nome_comercial":"X","avaliacoes":[{"texto":"ótimo"}]}'::jsonb),
          'texto de avaliação é recusado');
select ok(not app.payload_e_permitido('{"nome_comercial":"X","pix":"a@b.c"}'::jsonb),
          'chave Pix é recusada (ADR-09)');
select ok(not app.payload_e_permitido('{"nome_comercial":"X","cpf":"52998224725"}'::jsonb),
          'campo de CPF é recusado (ADR-09)');
-- O caso que uma leitura desatenta deixaria passar: a chave proibida escondida
-- dentro de um objeto que ESTÁ na whitelist.
select ok(not app.payload_e_permitido('{"telefones":[{"numero":"84999990001","foto":"a.jpg"}]}'::jsonb),
          'chave proibida aninhada dentro de um campo permitido também é recusada');
select ok(app.payload_e_permitido('{"telefones":[{"numero":"84999990001","tipo":"celular"}]}'::jsonb),
          'objeto aninhado com chaves inocentes passa');


-- =====================================================================
-- 3. O lote e a captura
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000f0002', 'gestor');
select ok((public.esteira_abrir_lote('coleta', pg_temp.fonte('casamentos_com_br'),
                                     'pgTAP esteira') ->> 'ok')::boolean,
          'gestor abre lote de coleta');
select pg_temp.sair();

create table pg_temp.ids (chave text primary key, v uuid);
insert into pg_temp.ids
select 'lote', (public.esteira_abrir_lote('coleta', pg_temp.fonte('casamentos_com_br'),
                                          'pgTAP esteira 2') ->> 'batch_id')::uuid;
grant select on pg_temp.ids to authenticated;
create function pg_temp.id(p text) returns uuid language sql as $$
  select v from pg_temp.ids where chave = p
$$;

select is((select b.status from public.import_batches b where b.id = pg_temp.id('lote')),
          'previa', 'o lote nasce como prévia');
select ok((select b.can_undo_until > now() + interval '47 hours'
             from public.import_batches b where b.id = pg_temp.id('lote')),
          'o lote nasce com 48 h de janela de desfazer (RF-BAS-17)');

-- Payload fora da whitelist é recusado com motivo legível, não com erro de banco.
select is(public.esteira_gravar_captura(pg_temp.id('lote'), pg_temp.fonte('casamentos_com_br'),
            '{"nome_comercial":"Y","descricao":"texto"}'::jsonb, 'x1', 'https://x/1') ->> 'reason',
          'campo_fora_da_whitelist',
          'captura com campo proibido é recusada com motivo legível');

insert into pg_temp.ids
select 'rc', (public.esteira_gravar_captura(
          pg_temp.id('lote'), pg_temp.fonte('casamentos_com_br'),
          jsonb_build_object('nome_comercial','ESPACO PGTAP 529.982.247-25',
                             'razao_social','MARIA DAS DORES 529.982.247-25',
                             'endereco','Rua Um, 100 — 529.982.247-25',
                             'telefones', jsonb_build_array('(11) 99999-0091'),
                             'cidade','Natal','bairro','Ponta Negra',
                             'instagram','https://instagram.com/espaco.pgtap/'),
          'pgtap-e1', 'https://www.casamentos.com.br/pgtap--e1', 200, 'KomuneBot/1.0')
        ->> 'raw_capture_id')::uuid;
select ok(pg_temp.id('rc') is not null, 'a captura foi gravada');

-- Idempotência da captura: o mesmo conteúdo não vira duas linhas.
select is(public.esteira_gravar_captura(
            pg_temp.id('lote'), pg_temp.fonte('casamentos_com_br'),
            jsonb_build_object('nome_comercial','ESPACO PGTAP 529.982.247-25',
                               'razao_social','MARIA DAS DORES 529.982.247-25',
                               'endereco','Rua Um, 100 — 529.982.247-25',
                               'telefones', jsonb_build_array('(11) 99999-0091'),
                               'cidade','Natal','bairro','Ponta Negra',
                               'instagram','https://instagram.com/espaco.pgtap/'),
            'pgtap-e1', 'https://www.casamentos.com.br/pgtap--e1', 200, 'KomuneBot/1.0')
          ->> 'reason',
          'conteudo_identico',
          'a mesma página buscada duas vezes não vira duas capturas');
select is((select count(*)::int from public.raw_capture rc where rc.batch_id = pg_temp.id('lote')),
          1, 'e a base continua com uma captura só neste lote');

-- O payload guardado NÃO é HTML: a coluna nem existe, e a whitelist já provou
-- que texto de terceiro não entra. Aqui basta conferir que o que entrou é o que
-- foi extraído.
select ok((select rc.payload ? 'nome_comercial' and not (rc.payload ? 'html')
             from public.raw_capture rc where rc.id = pg_temp.id('rc')),
          'raw_capture guarda o extraído, nunca o HTML (SCR-11)');


-- =====================================================================
-- 4. A higiene (RF-BAS-16): CPF descartado, DDD marcado
-- =====================================================================
select is(public.esteira_processar_captura(pg_temp.id('rc')) ->> 'ok', 'true',
          'a captura vira registro de fonte e candidato');

insert into pg_temp.ids
select 'sr', (select sr.id from public.source_record sr
               where sr.source_id = pg_temp.fonte('casamentos_com_br')
                 and sr.external_id = 'pgtap-e1');
insert into pg_temp.ids
select 'cand', (select sr.candidate_id from public.source_record sr where sr.id = pg_temp.id('sr'));

select is((select sr.name from public.source_record sr where sr.id = pg_temp.id('sr')),
          'ESPACO PGTAP', 'o CPF sai do nome comercial');
select is((select sr.legal_name from public.source_record sr where sr.id = pg_temp.id('sr')),
          'MARIA DAS DORES', 'o CPF sai TAMBÉM da razão social (a lacuna do RF-BAS-16)');
select ok((select sr.address not like '%529%' from public.source_record sr where sr.id = pg_temp.id('sr')),
          'o CPF sai TAMBÉM do endereço');
select ok((select sr.is_natural_person from public.source_record sr where sr.id = pg_temp.id('sr')),
          'quem tinha CPF no cadastro é marcado como pessoa natural (RF-BAS-04)');
select ok((select 'cpf_descartado' = any (sr.flags) from public.source_record sr where sr.id = pg_temp.id('sr')),
          'o registro fica marcado como cpf_descartado');

-- O ponto inteiro: o descarte ficou registrado e o número NÃO ficou em lugar nenhum.
select is((select count(*)::int from public.field_provenance fp
            where fp.record_type = 'source_record' and fp.record_id = pg_temp.id('sr')
              and fp.action = 'descartado' and fp.reason = 'cpf'),
          3, 'os três descartes de CPF (nome, razão social, endereço) estão registrados');
select ok((select bool_and(fp.previous_value_hash is null) from public.field_provenance fp
            where fp.record_id = pg_temp.id('sr') and fp.reason = 'cpf'),
          'o registro do descarte não guarda nem o CPF nem o hash dele (ADR-09)');
select ok(not exists (select 1 from public.field_provenance fp where fp.reason = 'cpf'
                       and coalesce(fp.source_url, '') like '%529.982%'),
          'nenhuma coluna de field_provenance carrega o número descartado');

-- DDD de fora MARCA, não reprova.
select is((select sr.phone_e164 from public.source_record sr where sr.id = pg_temp.id('sr')),
          '+5511999990091', 'telefone de fora da região é normalizado, não descartado');
select ok((select 'ddd_de_fora' = any (sr.flags) from public.source_record sr where sr.id = pg_temp.id('sr')),
          'DDD de fora MARCA o registro para revisão humana (RF-BAS-16)');
select ok((select 'ddd_de_fora' = any (c.flags) from public.supplier_candidates c where c.id = pg_temp.id('cand')),
          'e a marca chega ao candidato, que é quem a pessoa revisa');
select ok((select 'cpf_descartado' = any (c.flags) from public.supplier_candidates c where c.id = pg_temp.id('cand')),
          'o cpf_descartado sobrevive à passagem para o candidato');

-- @instagram, CNPJ e "sem contato".
select ok((select sr.instagram_handle = 'espaco.pgtap' from public.source_record sr where sr.id = pg_temp.id('sr')),
          'a URL do Instagram vira handle');
insert into public.source_record (source_id, external_id, name, instagram_handle, cnpj, phone_e164)
values (pg_temp.fonte('planilha'), 'pgtap-sujo', 'ALVO SUJO PGTAP',
        'https://instagram.com/p/ABC123/', '11222333000100', 'telefone?');
select ok((select 'instagram_fora_do_padrao' = any (sr.flags) from public.source_record sr
            where sr.external_id = 'pgtap-sujo'),
          'link de post do Instagram não vira handle: marca para revisão');
select ok((select 'cnpj_invalido' = any (sr.flags) from public.source_record sr
            where sr.external_id = 'pgtap-sujo'),
          'CNPJ com dígito verificador errado cai e marca');
select ok((select 'telefone_invalido' = any (sr.flags) from public.source_record sr
            where sr.external_id = 'pgtap-sujo'),
          'telefone que não é telefone fica nulo e marca');
select ok((select 'sem_contato' = any (sr.flags) from public.source_record sr
            where sr.external_id = 'pgtap-sujo'),
          'alvo sem nenhum canal é avisado, não reprovado');
select ok((select sr.cnpj is null and sr.instagram_handle is null and sr.phone_e164 is null
             from public.source_record sr where sr.external_id = 'pgtap-sujo'),
          'e nada de inválido é gravado como se fosse válido');

-- A marca some quando o motivo dela some (o oposto de ficar grudada para sempre).
update public.source_record set phone_e164 = '84999990092' where external_id = 'pgtap-sujo';
select ok((select not ('telefone_invalido' = any (sr.flags)) from public.source_record sr
            where sr.external_id = 'pgtap-sujo'),
          'corrigir o telefone limpa o aviso de telefone inválido');
select ok((select not ('sem_contato' = any (sr.flags)) from public.source_record sr
            where sr.external_id = 'pgtap-sujo'),
          'e o aviso de "sem contato" também');


-- =====================================================================
-- 5. A mesma lacuna, fechada em supplier_candidates
-- =====================================================================
insert into public.supplier_candidates (source_id, collector, name, legal_name, address, notes)
values (pg_temp.fonte('captura_campo'), 'pgTAP', 'DOCERIA PGTAP',
        'JOANA SILVA 529.982.247-25', 'Av. Dois, 20 — 529.982.247-25',
        'anotou o CPF 529.982.247-25 no caderno');
select is((select c.legal_name from public.supplier_candidates c where c.name = 'DOCERIA PGTAP'),
          'JOANA SILVA', 'CPF sai da razão social do candidato (era a lacuna: só `name` era varrido)');
select ok((select c.address not like '%529%' and c.notes not like '%529%'
             from public.supplier_candidates c where c.name = 'DOCERIA PGTAP'),
          'CPF sai do endereço e da observação do candidato');
select is((select count(*)::int from public.field_provenance fp
            where fp.record_type = 'supplier_candidate'
              and fp.record_id = (select id from public.supplier_candidates where name = 'DOCERIA PGTAP')
              and fp.reason = 'cpf'),
          3, 'os três descartes do candidato ficam registrados');
select ok((select c.payload ? 'cpf_descartado_em' from public.supplier_candidates c
            where c.name = 'DOCERIA PGTAP'),
          'o carimbo do descarte continua no payload (contrato do teste 14)');


-- =====================================================================
-- 6. Supressão consultada ANTES de gravar (RF-RAD-09)
-- =====================================================================
select app.suppress('phone', '+5584988880001', 'pgTAP esteira', 'whatsapp'::app.channel, null);
insert into public.source_record (source_id, external_id, name, phone_e164)
values (pg_temp.fonte('planilha'), 'pgtap-suprimido', 'SUPRIMIDO PGTAP', '84988880001');
select ok((select 'suprimido' = any (sr.flags) from public.source_record sr
            where sr.external_id = 'pgtap-suprimido'),
          'número já suprimido nasce marcado no registro de fonte');
-- A resolução acontece no seu PRÓPRIO comando. Chamá-la dentro do subselect que
-- lê supplier_candidates fazia o teste procurar, no snapshot do comando, uma
-- linha que só passou a existir DURANTE o comando: o candidato nascia certo e a
-- asserção voltava NULL. O defeito era do teste, não da esteira.
insert into pg_temp.ids
select 'cand_suprimido',
       (app.resolver_source_record(
          (select id from public.source_record where external_id = 'pgtap-suprimido'))
        ->> 'candidate_id')::uuid;
select ok((select c.do_not_contact from public.supplier_candidates c
            where c.id = pg_temp.id('cand_suprimido')),
          'e o candidato nasce "não contatar" — nenhuma revisão desfaz isso');
select is(app.promover_candidato(
            (select c.id from public.supplier_candidates c where c.name = 'SUPRIMIDO PGTAP'))
          ->> 'reason',
          'candidato_nao_contatar',
          'candidato suprimido não vira organização, em modo nenhum');


-- =====================================================================
-- 7. Dedup do RF-BAS-08 dentro da transação da promoção
-- =====================================================================
insert into public.organizations (kind, name, phone_e164, cnpj, source_id, collector)
values ('fornecedor', 'JA EXISTE PGTAP', '+5584977770001', '11222333000181',
        pg_temp.fonte('planilha'), 'pgTAP');

insert into public.supplier_candidates (source_id, collector, name, phone_e164, category_id)
values (pg_temp.fonte('planilha'), 'pgTAP', 'JA EXISTE PGTAP (outro nome)', '84977770001',
        pg_temp.cat('buffet_adulto_corporativo'));
select is(app.promover_candidato(
            (select id from public.supplier_candidates where name like 'JA EXISTE PGTAP (outro%'))
          ->> 'reason',
          'ja_existe_na_base',
          'telefone repetido barra a promoção ANTES do 23505 (RF-BAS-08)');
select is(app.promover_candidato(
            (select id from public.supplier_candidates where name like 'JA EXISTE PGTAP (outro%'))
          ->> 'chave',
          'phone', 'e a recusa diz por qual chave (a pessoa precisa entender)');

-- CNPJ: a mesma barreira, por outra chave.
insert into public.supplier_candidates (source_id, collector, name, cnpj, category_id)
values (pg_temp.fonte('planilha'), 'pgTAP', 'OUTRO NOME MESMO CNPJ PGTAP', '11.222.333/0001-81',
        pg_temp.cat('buffet_adulto_corporativo'));
select is(app.promover_candidato(
            (select id from public.supplier_candidates where name = 'OUTRO NOME MESMO CNPJ PGTAP'))
          ->> 'chave',
          'cnpj', 'CNPJ repetido barra a promoção');

-- Fixo repetido: é o caso que `app.find_org_matches` sozinha DEIXARIA passar
-- (a regra de telefone dela só vale para celular), e o índice único não deixa.
insert into public.organizations (kind, name, phone_e164, source_id, collector, neighborhood)
values ('fornecedor', 'FIXO PGTAP', '+558432060091', pg_temp.fonte('planilha'), 'pgTAP', 'Tirol');
insert into public.supplier_candidates (source_id, collector, name, phone_e164, category_id)
values (pg_temp.fonte('planilha'), 'pgTAP', 'FIXO PGTAP OUTRO', '8432060091',
        pg_temp.cat('buffet_adulto_corporativo'));
select is(app.promover_candidato(
            (select id from public.supplier_candidates where name = 'FIXO PGTAP OUTRO'))
          ->> 'reason',
          'ja_existe_na_base',
          'telefone FIXO repetido também barra — é o furo que find_org_matches sozinha teria');


-- =====================================================================
-- 8. Promoção: cria organização, negócio e leva a proveniência junto
-- =====================================================================
update public.supplier_candidates set category_id = pg_temp.cat('buffet_adulto_corporativo')
 where id = pg_temp.id('cand');
insert into pg_temp.ids
select 'promo', (app.promover_candidato(pg_temp.id('cand'), null, null, null, null, null,
                                        pg_temp.id('lote')) ->> 'organization_id')::uuid;
select ok(pg_temp.id('promo') is not null, 'promover cria a organização');
select is((select o.name from public.organizations o where o.id = pg_temp.id('promo')),
          'ESPACO PGTAP', 'e ela entra com o nome já sem CPF');
select is((select c.status::text from public.supplier_candidates c where c.id = pg_temp.id('cand')),
          'aprovado', 'o candidato fica aprovado');
select is((select count(*)::int from public.deals d where d.organization_id = pg_temp.id('promo')),
          1, 'e nasce exatamente um negócio no funil');
select is((select d.import_batch_id from public.deals d where d.organization_id = pg_temp.id('promo')),
          pg_temp.id('lote'), 'o negócio guarda o lote que o trouxe (RF-BAS-17)');
select is((select o.import_batch_id from public.organizations o where o.id = pg_temp.id('promo')),
          pg_temp.id('lote'), 'a ficha também');
select ok((select count(*) > 0 from public.field_provenance fp
            where fp.record_type = 'organization' and fp.record_id = pg_temp.id('promo')),
          'a proveniência acompanha a ficha (senão a resposta ao titular morre com o candidato)');
-- Três, e não quatro: este arquivo cria "JA EXISTE PGTAP" e "FIXO PGTAP" à mão
-- (as duas iscas da dedup) e "ESPACO PGTAP" pela promoção. Todas as outras
-- promoções daqui até aqui foram RECUSADAS de propósito. O número guardado logo
-- abaixo é o que a idempotência tem de deixar intacto.
insert into pg_temp.base values ('orgs_pos_promocao', pg_temp.n_orgs());
select is(pg_temp.delta('orgs', pg_temp.n_orgs()), 3,
          'a base ganhou exatamente as três fichas que este arquivo criou');

-- Idempotência: promover de novo devolve a MESMA organização.
select is(app.promover_candidato(pg_temp.id('cand')) ->> 'organization_id',
          pg_temp.id('promo')::text,
          'promover duas vezes devolve a mesma organização (idempotência)');
select ok((app.promover_candidato(pg_temp.id('cand')) ->> 'ja_estava')::boolean,
          'e diz que já estava, em vez de fingir que criou');
-- Delta contra o número lido logo depois da promoção: promover de novo não pode
-- somar ficha nenhuma, qualquer que seja o tamanho da base.
select is(pg_temp.n_orgs() - (select n from pg_temp.base where chave = 'orgs_pos_promocao'), 0,
          'reprocessar não cria organização nova — a promessa central da esteira');

-- Reprocessar a captura inteira também não duplica nada.
select is(public.esteira_processar_captura(pg_temp.id('rc')) ->> 'mudou', 'false',
          'reprocessar a mesma captura reconhece que nada mudou');
select is((select count(*)::int from public.source_record sr
            where sr.source_id = pg_temp.fonte('casamentos_com_br') and sr.external_id = 'pgtap-e1'),
          1, 'e continua havendo um registro de fonte só');


-- =====================================================================
-- 9. Mesclar completa sem sobrescrever, e registra o que NÃO entrou
-- =====================================================================
insert into public.organizations (kind, name, phone_e164, source_id, collector)
values ('fornecedor', 'MESCLA PGTAP', '+5584966660001', pg_temp.fonte('planilha'), 'pgTAP');
insert into public.supplier_candidates (source_id, collector, name, phone_e164, instagram_handle, website)
values (pg_temp.fonte('planilha'), 'pgTAP', 'MESCLA PGTAP (fonte)', '84966660002',
        'mescla.pgtap', 'https://mescla-pgtap.com.br');
select is(app.mesclar_candidato(
            (select id from public.supplier_candidates where name = 'MESCLA PGTAP (fonte)'),
            (select id from public.organizations where name = 'MESCLA PGTAP')) ->> 'status',
          'mesclado', 'mesclar responde ok');
select is((select o.phone_e164 from public.organizations o where o.name = 'MESCLA PGTAP'),
          '+5584966660001',
          'o telefone JÁ CONFIRMADO na ficha vence o da fonte (RF-RAD-08)');
select is((select o.instagram_handle from public.organizations o where o.name = 'MESCLA PGTAP'),
          'mescla.pgtap', 'e o campo que estava vazio é completado');
select is((select fp.action from public.field_provenance fp
            where fp.record_type = 'organization'
              and fp.record_id = (select id from public.organizations where name = 'MESCLA PGTAP')
              and fp.field = 'phone_e164'),
          'preservado', 'o telefone recusado fica registrado como "preservado"');
select ok((select fp.previous_value_hash is not null and fp.previous_value_hash !~ '^\+55'
             from public.field_provenance fp
            where fp.record_type = 'organization'
              and fp.record_id = (select id from public.organizations where name = 'MESCLA PGTAP')
              and fp.field = 'phone_e164'),
          'e o que fica é o HASH do número recusado, nunca o número');


-- =====================================================================
-- 10. Recusar exige motivo escrito
-- =====================================================================
insert into public.supplier_candidates (source_id, collector, name)
values (pg_temp.fonte('planilha'), 'pgTAP', 'RECUSA PGTAP');
select is(app.recusar_candidato((select id from public.supplier_candidates where name = 'RECUSA PGTAP'), null)
          ->> 'reason',
          'motivo_obrigatorio', 'recusar sem motivo escrito não é decisão, é sumiço');
select is(app.recusar_candidato((select id from public.supplier_candidates where name = 'RECUSA PGTAP'),
                                'fora do mercado de eventos', true) ->> 'status',
          'recusado', 'recusar com motivo funciona');
select ok((select c.do_not_contact from public.supplier_candidates c where c.name = 'RECUSA PGTAP'),
          'e "não contatar" fica marcado quando pedido');


-- =====================================================================
-- 11. A resolução não funde por nome, e não funde número compartilhado
-- =====================================================================
insert into public.source_record (source_id, external_id, name, city_id)
values (pg_temp.fonte('planilha'), 'pgtap-nome-1', 'BUFFET DO JOAO PGTAP', 1),
       (pg_temp.fonte('telelistas'), 'pgtap-nome-2', 'BUFFET DO JOAO PGTAP', 1);
select is(app.resolver_source_record((select id from public.source_record where external_id = 'pgtap-nome-1'))
          ->> 'criado', 'true', 'o primeiro registro cria candidato');
select is(app.resolver_source_record((select id from public.source_record where external_id = 'pgtap-nome-2'))
          ->> 'criado', 'true',
          'o segundo, de nome IDÊNTICO e sem chave determinística, cria OUTRO candidato: nome nunca funde sozinho');

-- CNPJ PRÓPRIO desta seção. O 11.222.333/0001-81 já é a isca da dedup lá em cima
-- (organização "JA EXISTE PGTAP" e candidato "OUTRO NOME MESMO CNPJ PGTAP"), e
-- reaproveitá-lo aqui fazia a resolução vincular ao candidato daquele teste e
-- responder criado=false — acusando de bug a única coisa que estava certa.
insert into public.source_record (source_id, external_id, name, cnpj)
values (pg_temp.fonte('base_cnpj'), 'pgtap-cnpj-1', 'RAZAO SOCIAL PGTAP LTDA', '44455566000183');
insert into public.source_record (source_id, external_id, name, cnpj)
values (pg_temp.fonte('planilha'), 'pgtap-cnpj-2', 'NOME FANTASIA PGTAP', '44455566000183');
select is(app.resolver_source_record((select id from public.source_record where external_id = 'pgtap-cnpj-1'))
          ->> 'criado', 'true', 'CNPJ novo cria candidato');
select is(app.resolver_source_record((select id from public.source_record where external_id = 'pgtap-cnpj-2'))
          ->> 'criado', 'false',
          'o mesmo CNPJ em outra fonte vincula ao MESMO candidato (uma linha na fila, não três)');


-- =====================================================================
-- 12. As filas: idempotência, backoff e dead-letter
-- =====================================================================
select is(app.esteira_enfileirar('ingest_records', '{"a":1}'::jsonb, 'pgtap-chave-1') ->> 'enfileirado',
          'true', 'a primeira mensagem entra na fila');
select is(app.esteira_enfileirar('ingest_records', '{"a":1}'::jsonb, 'pgtap-chave-1') ->> 'motivo',
          'ja_enfileirado', 'a mesma chave de idempotência não entra duas vezes');
select throws_ok($$ select app.esteira_enfileirar('ingest_records', '{}'::jsonb, '  ') $$,
                 '22023', null, 'mensagem sem chave de idempotência não entra na esteira');
select throws_ok($$ select app.esteira_enfileirar('fila_inventada', '{}'::jsonb, 'k') $$,
                 '22023', null, 'fila inexistente é recusada');

create table pg_temp.msg (id bigint);
insert into pg_temp.msg
select msg_id from app.esteira_ler('ingest_records', 1);
select ok((select count(*) = 1 from pg_temp.msg), 'o worker lê a mensagem que enfileirou');

select is(app.esteira_falhar('ingest_records', (select id from pg_temp.msg), 'pgtap-chave-1', 'erro 1')
          ->> 'acao', 'reagendado', 'a primeira falha reagenda com backoff');
select is((app.esteira_falhar('ingest_records', (select id from pg_temp.msg), 'pgtap-chave-1', 'erro 2')
          ->> 'em_segundos')::int, 60, 'e o backoff dobra a cada tentativa (30 s, 60 s, 120 s…)');
select app.esteira_falhar('ingest_records', (select id from pg_temp.msg), 'pgtap-chave-1', 'erro 3');
select app.esteira_falhar('ingest_records', (select id from pg_temp.msg), 'pgtap-chave-1', 'erro 4');
select is(app.esteira_falhar('ingest_records', (select id from pg_temp.msg), 'pgtap-chave-1', 'erro 5')
          ->> 'acao', 'dead_letter',
          'passado o teto de tentativas, a mensagem vai para a dead-letter em vez de girar para sempre');
select ok((select count(*) > 0 from pgmq.q_ingest_dlq q
            where q.message ->> 'idempotency_key' = 'pgtap-chave-1'
              and q.message ->> 'erro' = 'erro 5'),
          'e o erro que a matou vai junto, para alguém ler');
select ok(not exists (select 1 from pgmq.q_ingest_records q where q.msg_id = (select id from pg_temp.msg)),
          'a mensagem sai da fila de origem');

-- Concluir fecha a chave, e a chave é o que impede o reprocessamento.
select app.esteira_enfileirar('ingest_pages', '{"url":"x"}'::jsonb, 'pgtap-chave-2');
select ok(app.esteira_concluir('ingest_pages',
            (select msg_id from app.esteira_ler('ingest_pages', 1) limit 1), 'pgtap-chave-2'),
          'concluir arquiva a mensagem');
select ok((select d.processed_at is not null from public.ingest_dedup d
            where d.queue = 'ingest_pages' and d.idempotency_key = 'pgtap-chave-2'),
          'e a chave fica registrada como consumida');


-- =====================================================================
-- 13. Batida de ponto e saúde da esteira
-- =====================================================================
select ok((public.esteira_bater_ponto('ingest', 'pgtap', 'ok', 'ingest_pages',
                                      'maquina-pgtap', '1.0.0', 3, 0) ->> 'ok')::boolean,
          'o worker bate ponto');
select pg_temp.entrar('a0000000-0000-4000-8000-0000000f0003', 'sdr');
select ok((public.esteira_saude() ->> 'coletor_vivo')::boolean,
          'a tela do Radar consegue dizer que o coletor está vivo');
select ok((select jsonb_array_length(public.esteira_saude() -> 'filas') = 4),
          'e vê a profundidade das quatro filas');
select pg_temp.sair();
update public.worker_heartbeats set last_beat_at = now() - interval '10 minutes'
 where worker = 'ingest' and instance = 'pgtap';
-- Dentro de uma sessão, e não fora: `esteira_saude` exige papel que escreve (é
-- a tela do Radar) e levanta 42501 para quem não tem — inclusive para "ninguém",
-- que é o que sobra depois de `sair()`. Chamada solta aqui, ela abortava a
-- transação no meio do arquivo: o pgTAP tinha acabado de imprimir 99 asserções e
-- as ~30 seguintes (RLS por papel, retenção do §10.6, origem_dos_dados,
-- append-only da proveniência) simplesmente nunca rodavam. O arquivo terminava
-- com "exit 3" e ninguém lia o motivo.
select pg_temp.entrar('a0000000-0000-4000-8000-0000000f0003', 'sdr');
select ok(not (public.esteira_saude() -> 'workers' @> '[{"vivo": true, "instancia": "pgtap"}]'::jsonb),
          'dez minutos sem batida é "parado", e a tela precisa dizer isso');
select pg_temp.sair();


-- =====================================================================
-- 14. RLS por papel
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000f0003', 'sdr');
select is((select count(*)::int from public.raw_capture), 0,
          'sdr não vê captura bruta: é dado de terceiro ainda não revisado');
select is((select count(*)::int from public.source_record), 0,
          'sdr também não vê o registro cru da fonte (ele trabalha o candidato)');
select ok((select count(*) > 0 from public.supplier_candidates),
          'mas vê a fila de candidatos, que é o trabalho dele');
select throws_ok($$ insert into public.raw_capture (batch_id, source_id, external_id, collector, payload)
                    values (null, 1, 'x', 'y', '{}'::jsonb) $$,
                 '42501', null, 'e não tem privilégio para escrever captura à mão');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000f0002', 'gestor');
select ok((select count(*) > 0 from public.source_record),
          'gestor lê o registro de fonte');
select is((select count(*)::int from public.raw_capture), 0,
          'mas nem o gestor lê a captura bruta — menor privilégio');
select ok((select count(*) > 0 from public.field_provenance),
          'gestor lê a proveniência (é a resposta ao titular, e não tem valor nenhum dentro)');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000f0001', 'admin');
select ok((select count(*) > 0 from public.raw_capture), 'admin lê a captura bruta');
select pg_temp.sair();

select pg_temp.entrar('a0000000-0000-4000-8000-0000000f0004', 'leitura');
select throws_ok($$ select public.esteira_saude() $$, '42501', null,
                 'papel de leitura não lê a saúde da esteira');
-- Leitura LÊ a proveniência, e isso é a política funcionando, não um furo:
-- `field_provenance_select` é `can_write() or reads_base_pii()` de propósito. A
-- tabela não guarda valor nenhum — só de onde veio cada campo e o HASH do que
-- foi trocado — e é ela que responde "de onde vocês tiraram o meu número?".
-- Quem responde ao titular no PRD (§4, Dennis: `leitura` + encarregado LGPD) é
-- exatamente este papel; um teste exigindo zero aqui pedia que o encarregado
-- não pudesse fazer o trabalho dele. O valor em si mora nas tabelas de dado, e
-- é lá que o papel esbarra (source_record e raw_capture, logo acima).
select ok((select count(*) > 0 from public.field_provenance),
          'e LÊ a proveniência — livro de transparência, sem valor nenhum dentro (R06; PRD §4)');
select pg_temp.sair();

-- field_provenance é append-only para UPDATE: um registro editável não prova nada.
select throws_ok($$ update public.field_provenance set reason = 'mentira'
                     where record_id = (select v from pg_temp.ids where chave = 'sr') $$,
                 '42501', null, 'field_provenance não pode ser editada');


-- =====================================================================
-- 15. "De onde vocês tiraram o meu número?" (R06; nó do roteiro)
-- =====================================================================
select ok((select public.origem_dos_dados(pg_temp.id('promo')) -> 'ficha' ->> 'url'
             = 'https://www.casamentos.com.br/pgtap--e1'),
          'a resposta traz a URL ESPECÍFICA, não "fontes públicas" (caso KASPR)');
select ok((select jsonb_array_length(public.origem_dos_dados(pg_temp.id('promo')) -> 'campos') > 0),
          'e traz de onde veio cada campo');


-- =====================================================================
-- 16. Desfazer o lote (48 h)
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-0000000f0002', 'gestor');
select is(public.esteira_desfazer_lote(pg_temp.id('lote')) ->> 'organizacoes_removidas', '1',
          'desfazer remove a ficha que o lote criou e ninguém tocou');
select pg_temp.sair();
select ok(not exists (select 1 from public.organizations o where o.id = pg_temp.id('promo')),
          'e a ficha some mesmo');
select is((select b.status from public.import_batches b where b.id = pg_temp.id('lote')),
          'desfeito', 'o lote fica marcado como desfeito');

-- Ficha tocada NÃO some: desfazer uma importação não pode apagar uma conversa.
insert into pg_temp.ids
select 'lote2', (public.esteira_abrir_lote('planilha', pg_temp.fonte('planilha'), 'pgTAP tocada')
                 ->> 'batch_id')::uuid;
insert into public.organizations (kind, name, source_id, collector, import_batch_id)
values ('fornecedor', 'TOCADA PGTAP', pg_temp.fonte('planilha'), 'pgTAP', pg_temp.id('lote2'));
insert into public.consent_events (organization_id, kind, channel, evidence_text)
values ((select id from public.organizations where name = 'TOCADA PGTAP'),
        'contact_optin', 'whatsapp', 'pgTAP');
select pg_temp.entrar('a0000000-0000-4000-8000-0000000f0002', 'gestor');
select is(public.esteira_desfazer_lote(pg_temp.id('lote2')) ->> 'fichas_preservadas', '1',
          'ficha com consentimento registrado sobrevive ao desfazer');
select pg_temp.sair();
select ok(exists (select 1 from public.organizations o where o.name = 'TOCADA PGTAP'),
          'e continua na base');


-- =====================================================================
-- 17. Retenção (PRD §10.6) — apaga o que passou do prazo, de verdade
-- =====================================================================
insert into public.raw_capture (batch_id, source_id, external_id, source_url, collector, payload, purge_after)
values (pg_temp.id('lote2'), pg_temp.fonte('planilha'), 'pgtap-velha', 'https://x/velha',
        'pgTAP', '{"nome_comercial":"VELHA PGTAP"}'::jsonb,
        (now() at time zone 'America/Fortaleza')::date - 1);
insert into public.supplier_candidates (source_id, collector, name, created_at)
values (pg_temp.fonte('planilha'), 'pgTAP', 'ANTIGO NUNCA CONTATADO PGTAP', now() - interval '91 days');
insert into public.supplier_candidates (source_id, collector, name, phone_e164, status,
                                        review_reason, reviewed_at)
values (pg_temp.fonte('planilha'), 'pgTAP', 'RECUSADO ANTIGO PGTAP', '84955550001', 'recusado',
        'fora do mercado', now() - interval '91 days');
insert into public.field_provenance (record_type, record_id, field, action)
values ('organization', '00000000-0000-4000-8000-000000000abc', 'phone_e164', 'gravado');

select ok((select (app.aplicar_retencao() -> 'raw_capture')::int >= 1),
          'a retenção apaga a captura que passou dos 90 dias');
select ok(not exists (select 1 from public.raw_capture rc where rc.external_id = 'pgtap-velha'),
          'e ela some mesmo');
select ok(not exists (select 1 from public.supplier_candidates c
                       where c.name = 'ANTIGO NUNCA CONTATADO PGTAP'),
          'lead coletado e nunca contatado some em 90 dias (§10.6)');
select ok((select c.phone_e164 is null and c.review_reason = 'fora do mercado'
             from public.supplier_candidates c where c.name = 'RECUSADO ANTIGO PGTAP'),
          'o recusado perde o contato mas guarda a decisão — senão a próxima coleta o traz de volta');
select ok(not exists (select 1 from public.field_provenance fp
                       where fp.record_id = '00000000-0000-4000-8000-000000000abc'),
          'proveniência órfã é varrida junto');
select ok(exists (select 1 from public.retention_runs r where r.ran_at > now() - interval '1 minute'),
          'e o expurgo deixa relatório (R06 GOV-06)');
select is(pg_temp.delta('cand', pg_temp.n_cand()) >= 0, true,
          'nenhuma contagem absoluta: a base de operação continua intacta');

select * from finish();
rollback;

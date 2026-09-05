-- =====================================================================
-- pgTAP — Importação de planilha (migração 20260904001820, RF-BAS-07)
--   app.chave_catalogo · app.importacao_data
--   · app.importacao_categoria / cidade / fonte / pessoa / etapa / canal
--   · app.importacao_normalizar
--   · public.importacao_previa · importacao_gravar · importacao_encerrar_lote
--   · public.importacao_lotes
--
-- O que este arquivo tem de provar, e por quê:
--   1. IMPORTAR DUAS VEZES NÃO DUPLICA NADA. É a promessa que a tela faz em
--      letras grandes; aqui ela é medida em delta de `organizations`, `deals`,
--      `raw_capture` e `source_record`. Na segunda passagem o delta é ZERO.
--   2. A PRÉVIA NÃO MENTE. Ela e a gravação percorrem a mesma lista de `if`, e
--      o caso que quebrou isso na prática está fixado: telefone FIXO repetido
--      bloqueia a promoção (índice único), mas `app.find_org_matches` só casa
--      telefone quando é celular. A prévia tem a mesma sonda das quatro chaves.
--   3. A prévia NÃO ESCREVE. Nenhuma linha em lugar nenhum.
--   4. A duplicata vem COM O NOME da ficha. Sem o nome quem importa não decide.
--   5. Opt-out não vira alvo: entra na `suppression_list`, o candidato nasce
--      "não contatar" e nenhuma ficha é criada (guardrail do CLAUDE.md).
--   6. CPF em qualquer coluna é descartado antes de a prévia devolver a linha
--      (ADR-09, RF-BAS-16) — e o descarte aparece como aviso.
--   7. O `external_id` sai da IDENTIDADE (celular > @ > CNPJ > nome+cidade) e
--      nunca do número da linha: reordenar a planilha não pode duplicar a base.
--   8. Papel sem escrita não importa, nem a prévia.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada: este banco tem
-- operação real dentro. Tudo é delta ou escopo por lote deste arquivo.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(72);

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

create function pg_temp.admin() returns uuid language sql as $$
  select id from public.profiles where role = 'admin' order by created_at limit 1
$$;
create function pg_temp.leitor() returns uuid language sql as $$
  select id from public.profiles where role in ('leitura','financeiro') order by created_at limit 1
$$;

-- Contadores lidos FORA da RLS, para medir delta em vez de total.
create function pg_temp.n(p text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I', p) into n;
  return n;
end $$;
create temp table marco(chave text primary key, valor bigint);
create function pg_temp.marcar() returns void language plpgsql as $$
begin
  delete from marco;
  insert into marco
  select t, pg_temp.n(t) from unnest(array['organizations','deals','supplier_candidates',
                                           'raw_capture','source_record','suppression_list',
                                           'activities','field_provenance']) t;
end $$;
create function pg_temp.delta(p text) returns bigint language sql as $$
  select pg_temp.n(p) - (select valor from marco where chave = p)
$$;

-- A planilha de teste. Nomes que ninguém usa na operação, para o arquivo poder
-- rodar contra o banco de trabalho sem esbarrar em ficha de verdade.
create function pg_temp.linha(p_n int, p_nome text, p_tel text, p_cat text, p_extra jsonb default '{}')
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'linha', p_n, 'nome', p_nome, 'whatsapp', nullif(p_tel, ''),
    'categoria', p_cat, 'origem', 'Planilha atual', 'cidade', 'Natal',
    'tipo', 'fornecedor', 'etapa', 'Contatado', 'responsavel', 'Heloísa',
    'ultimo_contato', '2026-09-05', 'canal_ultimo_contato', 'Ligação',
    'resultado', 'Não respondeu', 'proxima_acao', 'Follow-up D+3')) || p_extra
$$;

create function pg_temp.planilha() returns jsonb language sql as $$
  select jsonb_build_array(
    pg_temp.linha(2, 'ALFA IMPORTACAO PGTAP',  '84 98800-0011', 'Buffet adulto / corporativo'),
    pg_temp.linha(3, 'BETA IMPORTACAO PGTAP',  '84 98800-0022', 'Doces, bolos, confeitaria'),
    pg_temp.linha(4, 'GAMA IMPORTACAO PGTAP',  '84 98800-0033', 'Fotografia e vídeo'),
    -- a mesma empresa duas vezes no arquivo (a equipe registrou o toque duas vezes)
    pg_temp.linha(5, 'ALFA IMPORTACAO PGTAP',  '84 98800-0011', 'Buffet adulto / corporativo'),
    -- pediu para parar
    pg_temp.linha(6, 'DELTA IMPORTACAO PGTAP', '84 98800-0044', 'Decoração e flores',
                  '{"etapa":"Opt-out (não contatar)","resultado":"Pediu para parar (SAIR)"}'::jsonb),
    -- categoria fora do catálogo
    pg_temp.linha(7, 'EPSILON IMPORTACAO PGTAP', '84 98800-0055', 'Malabarismo aquático'),
    -- sem nome / sem contato
    pg_temp.linha(8, '', '84 98800-0066', 'Fotografia e vídeo'),
    pg_temp.linha(9, 'ZETA IMPORTACAO PGTAP', '', 'Fotografia e vídeo'))
$$;

create function pg_temp.decisao(p jsonb, p_linha int) returns text language sql as $$
  select l ->> 'decisao' from jsonb_array_elements(p -> 'linhas') l
   where (l ->> 'linha')::int = p_linha
$$;
create function pg_temp.motivo(p jsonb, p_linha int) returns text language sql as $$
  select l ->> 'motivo' from jsonb_array_elements(p -> 'linhas') l
   where (l ->> 'linha')::int = p_linha
$$;
create function pg_temp.conta(p jsonb, p_chave text) returns int language sql as $$
  select coalesce((p -> 'contagem' ->> p_chave)::int, 0)
$$;

grant select on marco to authenticated;


-- =====================================================================
-- 1. Os resolvedores de catálogo
-- =====================================================================
select is(app.chave_catalogo('Buffet adulto / corporativo'), 'buffet adulto corporativo',
          'a chave de catálogo tira acento, caixa e pontuação');
select is(app.chave_catalogo('  '), null, 'texto em branco não vira chave');

select is((app.importacao_categoria('Buffet adulto / corporativo') ->> 'nome'),
          'Buffet adulto/corporativo',
          'a barra com espaço da planilha casa com a barra sem espaço do catálogo');
select is((app.importacao_categoria('Buffet adulto / corporativo') ->> 'aproximado'), 'false',
          'e casa em cheio, sem precisar de conferência');
select is((app.importacao_categoria('Outros serviços (celebrante, beleza, convites, transfer, seguranca, staff)') ->> 'nome'),
          'Celebrante, beleza, convites, transfer, segurança, staff',
          'o rótulo comprido da planilha casa por semelhança com o do catálogo');
select is((app.importacao_categoria('Malabarismo aquático')), '{}'::jsonb,
          'categoria que não existe não vira palpite');
select is((app.importacao_categoria(null)), '{}'::jsonb, 'categoria vazia não vira palpite');

select is((app.importacao_cidade('natal') ->> 'nome'), 'Natal', 'a cidade casa sem caixa');
select is((app.importacao_cidade('São Paulo')), '{}'::jsonb,
          'cidade fora da área de atuação não entra');

select is((app.importacao_fonte('Planilha atual') ->> 'nome'), 'Planilha (importação)',
          'o apelido da aba Listas casa com a fonte do catálogo');
select is((app.importacao_fonte('Solutudo') ->> 'id'),
          (select id::text from public.sources where slug = 'telelistas'),
          'um diretório citado DENTRO do nome da fonte agrupada também casa');
select is((app.importacao_fonte('Diretório que não existe')), '{}'::jsonb,
          'origem desconhecida não vira palpite: a origem é obrigatória por LGPD');

select is((app.importacao_pessoa('Heloísa') ->> 'nome'), 'Heloísa Cavalcanti',
          'o primeiro nome basta quando é o único');
select is((app.importacao_pessoa('Matheus') ->> 'id'), null,
          'dois "Matheus" na equipe: o dono fica em branco em vez de virar palpite');
select is((app.importacao_pessoa('Matheus') ->> 'ambiguo'), 'true',
          'e a ambiguidade é dita, para a prévia poder avisar');

select is(app.importacao_canal('WhatsApp (Heloísa · Komune)')::text, 'whatsapp', 'canal: WhatsApp');
select is(app.importacao_canal('Pessoalmente / indicação')::text, 'presencial', 'canal: presencial');
select is(app.importacao_canal('Ligação')::text, 'phone', 'canal: ligação');
select is(app.importacao_canal(null)::text, null, 'canal vazio fica vazio');

select is(app.importacao_data('2026-09-05'), '2026-09-05'::date, 'data em ISO');
select is(app.importacao_data('05/09/2026'), '2026-09-05'::date, 'data como a pessoa digita');
select is(app.importacao_data('5-9-26'),     '2026-09-05'::date, 'data com dois dígitos de ano');
select is(app.importacao_data('semana passada'), null,
          'data ilegível vira nulo, e não exceção que derruba a linha inteira');


-- =====================================================================
-- 2. A normalização de uma linha
-- =====================================================================
select is(app.importacao_normalizar(pg_temp.linha(2, 'ALFA IMPORTACAO PGTAP', '84 98800-0011',
                                                  'Buffet adulto / corporativo')) ->> 'external_id',
          '+5584988000011',
          'a identidade na fonte é o celular, e não o número da linha');
select is(app.importacao_normalizar(jsonb_build_object(
            'linha', 9, 'nome', 'SO ARROBA PGTAP', 'instagram', '@soarroba',
            'categoria', 'Fotografia e vídeo', 'origem', 'Instagram')) ->> 'external_id',
          '@soarroba',
          'sem telefone, a identidade é o @');
select is(app.importacao_normalizar(jsonb_build_object(
            'linha', 9, 'nome', 'SO NOME PGTAP', 'cidade', 'Natal',
            'categoria', 'Fotografia e vídeo', 'origem', 'Instagram')) ->> 'erro',
          'sem_contato',
          'sem telefone, @ e CNPJ a linha não vira ficha');
select is(app.importacao_normalizar(pg_temp.linha(2, 'X PGTAP', '84 1234',
                                                  'Fotografia e vídeo')) -> 'avisos',
          '["telefone_invalido"]'::jsonb,
          'telefone que não fecha vira aviso, não silêncio');

-- CPF em texto livre: some antes de sair da função (ADR-09).
select is(app.importacao_normalizar(pg_temp.linha(2, 'CPF PGTAP', '84 98800-0099', 'Fotografia e vídeo',
            '{"observacoes":"falar com o sócio 111.444.777-35 amanhã"}'::jsonb)) ->> 'observacoes',
          'falar com o sócio amanhã',
          'o CPF é apagado da observação antes de a prévia devolver a linha');
select ok((app.importacao_normalizar(pg_temp.linha(2, 'CPF PGTAP', '84 98800-0099', 'Fotografia e vídeo',
            '{"observacoes":"falar com o sócio 111.444.777-35 amanhã"}'::jsonb)) -> 'avisos')
          @> '["cpf_descartado"]'::jsonb,
          'e o descarte é avisado, sem o número aparecer em lugar nenhum');

-- A whitelist do R06: o payload da captura não leva etapa, responsável nem resultado.
select ok(app.payload_e_permitido(
            app.importacao_normalizar(pg_temp.linha(2, 'W PGTAP', '84 98800-0011',
                                                    'Fotografia e vídeo')) -> 'payload'),
          'o payload que a importação monta passa na whitelist do R06 SCR-01');


-- =====================================================================
-- 3. A prévia
-- =====================================================================
select pg_temp.marcar();
select pg_temp.entrar(pg_temp.admin(), 'admin');

create temp table previa1 as select public.importacao_previa(pg_temp.planilha()) as j;
grant select on previa1 to authenticated;

select is(pg_temp.conta((select j from previa1), 'entra'), 3,
          'a prévia promete três fichas novas');
select is(pg_temp.decisao((select j from previa1), 5), 'repetida',
          'a segunda vez da mesma empresa no arquivo é repetição, não ficha nova');
select is(pg_temp.motivo((select j from previa1), 5), 'repetida_no_arquivo',
          'e o motivo diz que a repetição está no próprio arquivo');
select is(pg_temp.decisao((select j from previa1), 6), 'nao_contatar',
          'quem pediu para parar não entra');
select is(pg_temp.decisao((select j from previa1), 7), 'revisao',
          'categoria fora do catálogo vai para revisão, e não vira palpite');
select is(pg_temp.decisao((select j from previa1), 8), 'erro', 'linha sem nome não importa');
select is(pg_temp.decisao((select j from previa1), 9), 'erro', 'linha sem contato não importa');

select pg_temp.sair();
select is(pg_temp.delta('organizations'), 0::bigint, 'a prévia não cria organização');
select is(pg_temp.delta('supplier_candidates'), 0::bigint, 'a prévia não cria candidato');
select is(pg_temp.delta('raw_capture'), 0::bigint, 'a prévia não grava captura');
select is(pg_temp.delta('suppression_list'), 0::bigint,
          'a prévia não suprime ninguém: quem decide é a gravação');


-- =====================================================================
-- 4. A gravação
-- =====================================================================
select pg_temp.marcar();
select pg_temp.entrar(pg_temp.admin(), 'admin');

create temp table lote as
  select (public.esteira_abrir_lote('planilha',
            (select id from public.sources where slug = 'planilha'),
            'pgTAP 19 — importação') ->> 'batch_id')::uuid as id;
grant select on lote to authenticated;

create temp table grav1 as
  select public.importacao_gravar((select id from lote), pg_temp.planilha()) as j;
grant select on grav1 to authenticated;

select is(pg_temp.conta((select j from grav1), 'entra'), 3,
          'a gravação entrega exatamente o que a prévia prometeu');
select is(pg_temp.conta((select j from grav1), 'nao_contatar'), 1, 'e um opt-out');
select is(pg_temp.conta((select j from grav1), 'erro'), 2, 'e dois erros');

select pg_temp.sair();
select is(pg_temp.delta('organizations'), 3::bigint, 'três fichas novas no banco');
select is(pg_temp.delta('deals'), 3::bigint, 'e três negócios no funil');
select is(pg_temp.delta('suppression_list'), 1::bigint,
          'o opt-out entrou na lista de supressão');
select ok(not exists (select 1 from public.organizations o
                       where o.name = 'DELTA IMPORTACAO PGTAP' and o.deleted_at is null),
          'quem pediu para parar e ainda não tem ficha NÃO ganha uma');
select ok(not exists (select 1 from public.supplier_candidates c
                       where c.name = 'DELTA IMPORTACAO PGTAP'),
          'nem candidato: sem ficha, guarda-se o hash da supressão e mais nada');
select ok(app.is_suppressed('84 98800-0044'),
          'e o número fica suprimido, em qualquer modo e por qualquer caminho');
select is((select st.slug from public.organizations o
             join public.deals d on d.organization_id = o.id
             join public.stages st on st.id = d.stage_id
            where o.name = 'ALFA IMPORTACAO PGTAP' and o.deleted_at is null),
          'contatado',
          'a etapa da planilha vira a etapa do negócio');
select is((select pr.full_name from public.organizations o
             join public.deals d on d.organization_id = o.id
             join public.profiles pr on pr.id = d.owner_id
            where o.name = 'BETA IMPORTACAO PGTAP' and o.deleted_at is null),
          'Heloísa Cavalcanti',
          'e o responsável da planilha vira o dono da carteira');


-- =====================================================================
-- 5. A promessa central: importar duas vezes não duplica nada
-- =====================================================================
select pg_temp.marcar();
select pg_temp.entrar(pg_temp.admin(), 'admin');

create temp table previa2 as select public.importacao_previa(pg_temp.planilha()) as j;
create temp table lote2 as
  select (public.esteira_abrir_lote('planilha',
            (select id from public.sources where slug = 'planilha'),
            'pgTAP 19 — segunda passagem') ->> 'batch_id')::uuid as id;
create temp table grav2 as
  select public.importacao_gravar((select id from lote2), pg_temp.planilha()) as j;
grant select on previa2, lote2, grav2 to authenticated;

select is(pg_temp.conta((select j from previa2), 'entra'), 0,
          'na segunda passagem a prévia não promete ficha nenhuma');
select is(pg_temp.conta((select j from previa2), 'repetida'), 4,
          'e reconhece as quatro linhas que já entraram');
select is(pg_temp.conta((select j from grav2), 'entra'), 0,
          'e a gravação também não cria nada');

select pg_temp.sair();
select is(pg_temp.delta('organizations'), 0::bigint,
          'ZERO organização nova na segunda importação do mesmo arquivo');
select is(pg_temp.delta('deals'), 0::bigint, 'ZERO negócio novo');
select is(pg_temp.delta('supplier_candidates'), 0::bigint, 'ZERO candidato novo');
select is(pg_temp.delta('raw_capture'), 0::bigint,
          'ZERO captura nova: o conteúdo idêntico é reconhecido pelo hash');
select is(pg_temp.delta('source_record'), 0::bigint, 'ZERO registro normalizado novo');
select is(pg_temp.delta('activities'), 0::bigint,
          'e nenhuma atividade repetida na agenda (chave de cliente determinística)');


-- =====================================================================
-- 6. A prévia não mente sobre o telefone FIXO (o defeito que ela existe para não ter)
-- =====================================================================
-- `app.find_org_matches` casa telefone com 0,95 só quando é CELULAR; o fixo dela
-- exige bairro igual. Já o índice único `organizations_phone_uq` não faz essa
-- distinção — e `app.promover_candidato` bloqueia por ele. Sem a sonda das quatro
-- chaves na prévia, a tela dizia "entra" e a gravação recusava a mesma linha.
select pg_temp.entrar(pg_temp.admin(), 'admin');

create temp table lote3 as
  select (public.esteira_abrir_lote('planilha',
            (select id from public.sources where slug = 'planilha'),
            'pgTAP 19 — ficha com telefone fixo') ->> 'batch_id')::uuid as id;
grant select on lote3 to authenticated;

create temp table grav3 as
  select public.importacao_gravar((select id from lote3), jsonb_build_array(
    pg_temp.linha(2, 'FIXO IMPORTACAO PGTAP', '84 3200-0077', 'Fotografia e vídeo'))) as j;
grant select on grav3 to authenticated;

select is(pg_temp.conta((select j from grav3), 'entra'), 1,
          'a ficha de telefone fixo entrou, e nasceu sem bairro');

-- A sonda de referência: as sete chaves do RF-BAS-08 NÃO acham esta ficha.
select is((select count(*) from app.find_org_matches(jsonb_build_object(
             'name', 'OUTRO NOME COMPLETAMENTE PGTAP',
             'phone_e164', '+558432000077'))), 0::bigint,
          'find_org_matches não casa telefone FIXO sem bairro igual — é a regra dela');

-- E ainda assim a prévia recusa, porque o índice único vai recusar.
-- Origem diferente de propósito: assim o par (fonte, id externo) não é o mesmo, e
-- o que responde é a sonda das quatro chaves, não o reconhecimento do lote anterior.
create temp table previa3 as
  select public.importacao_previa(jsonb_build_array(
    jsonb_build_object('linha', 2, 'nome', 'OUTRO NOME COMPLETAMENTE PGTAP',
                       'whatsapp', '84 3200-0077', 'categoria', 'Fotografia e vídeo',
                       'origem', 'Casamentos.com.br', 'cidade', 'Natal'))) as j;
grant select on previa3 to authenticated;

select is(pg_temp.decisao((select j from previa3), 2), 'duplicata',
          'a prévia recusa: o telefone fixo já está na base, mesmo com outro nome');
select is((select l -> 'duplicata' ->> 'nome'
             from jsonb_array_elements((select j from previa3) -> 'linhas') l),
          'FIXO IMPORTACAO PGTAP',
          'e diz DE QUEM é a ficha — sem o nome ninguém decide');
select is((select l -> 'duplicata' ->> 'chave'
             from jsonb_array_elements((select j from previa3) -> 'linhas') l),
          'phone',
          'e qual chave casou, para a pessoa entender o porquê');

-- A gravação concorda com a prévia. É a asserção que fecha o ponto.
create temp table lote4 as
  select (public.esteira_abrir_lote('planilha',
            (select id from public.sources where slug = 'planilha'),
            'pgTAP 19 — confirmação da prévia') ->> 'batch_id')::uuid as id;
grant select on lote4 to authenticated;

create temp table grav4 as
  select public.importacao_gravar((select id from lote4), jsonb_build_array(
    jsonb_build_object('linha', 2, 'nome', 'OUTRO NOME COMPLETAMENTE PGTAP',
                       'whatsapp', '84 3200-0077', 'categoria', 'Fotografia e vídeo',
                       'origem', 'Casamentos.com.br', 'cidade', 'Natal'))) as j;
grant select on grav4 to authenticated;

select is(pg_temp.conta((select j from grav4), 'duplicata'), 1,
          'e a gravação decide igual à prévia: duplicata, não ficha nova');
select is(pg_temp.conta((select j from grav4), 'entra'), 0,
          'nenhuma ficha nasce do que a prévia disse que não nasceria');

-- O lote fecha e a janela de desfazer conta do FIM da gravação.
select is((public.importacao_encerrar_lote((select id from lote3)) ->> 'status'), 'concluido',
          'encerrar o lote o marca como concluído');
select ok((select b.can_undo_until from public.import_batches b where b.id = (select id from lote3))
          > now() + interval '47 hours',
          'e a janela de 48 h do desfazer conta do fim da gravação');
select ok((select count(*) from jsonb_array_elements(public.importacao_lotes(20)) l
            where l ->> 'rotulo' like 'pgTAP 19%') >= 3,
          'os lotes de planilha aparecem na lista da tela');

select pg_temp.sair();


-- =====================================================================
-- 7. Quem não escreve na base não importa
-- =====================================================================
select pg_temp.entrar(pg_temp.leitor(), 'leitura');
select throws_ok(
  $$ select public.importacao_previa('[]'::jsonb) $$, '42501',
  null, 'papel de leitura não roda nem a prévia');
select pg_temp.sair();

select * from finish();
rollback;

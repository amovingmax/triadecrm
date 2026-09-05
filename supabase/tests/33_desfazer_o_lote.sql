-- =====================================================================
-- pgTAP — O desfazer de 48 h reconhece o PRÓPRIO toque (RF-BAS-17)
--   public.esteira_desfazer_lote(uuid), depois da migração 20260905000802
--
-- O defeito que este arquivo existe para não deixar voltar (§3.6 do laudo):
--   `esteira_desfazer_lote` só removia ficha SEM nenhuma atividade de tipo
--   diferente de `system`. Só que `public.importacao_gravar` grava, para toda
--   linha que traga "último contato", uma atividade de NOTA na própria ficha
--   que acabou de criar — um instante antes, na mesma transação. Como a
--   planilha-ponte PEDE a coluna "último contato", toda ficha nascia "tocada":
--   o desfazer devolvia `organizacoes_removidas: 0` e a tela culpava um
--   trabalho humano que não houve.
--
--   Medido no banco local em 05/09/2026 com a planilha-ponte de verdade
--   (68 linhas, `docs/planilha-ponte/` preenchida): 33 fichas criadas,
--   33 atividades `note` com `origin = importacao_planilha`, e o desfazer
--   respondendo `{organizacoes_removidas: 0, fichas_preservadas: 33}`.
--
-- O que a correção NÃO pode afrouxar, e é metade das asserções daqui:
--   · nota escrita por gente continua prendendo a ficha;
--   · consentimento registrado continua prendendo a ficha;
--   · nota de OUTRO lote de importação continua prendendo a ficha — o desfazer
--     reconhece o próprio toque, não "qualquer toque de importação";
--   · quem não é gestor continua sem desfazer (42501), que é o servidor do §3.7.
--
-- A ficha nasce pelo caminho REAL: `public.importacao_gravar`, a mesma RPC que
-- a tela chama. Um teste que inserisse a organização à mão não veria a nota do
-- importador — que é justamente o defeito.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada: este banco tem
-- operação real dentro. Tudo é delta ou escopo pelo lote deste arquivo.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(16);

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

-- ---------- a equipe DESTE arquivo (fixture, e não gente de verdade) ----------
-- Mesmo caminho do login real (RF-ADM-01): `allowed_users` com o papel, insert
-- em `auth.users`, e o gatilho `on_auth_user_created` cria o perfil. Sobrenome
-- "Pgtap33" para o arquivo poder rodar contra o banco de trabalho sem esbarrar
-- em gente de verdade.
create function pg_temp.contratar(p_nome text, p_papel text) returns uuid
language plpgsql as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := 'pgtap33.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                  || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 33 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  return v_id;
end $$;

create temp table equipe(papel text primary key, id uuid not null);
insert into equipe(papel, id) values
  ('gestor', pg_temp.contratar('Aristides Pgtap33', 'gestor')),
  ('sdr',    pg_temp.contratar('Genoveva Pgtap33', 'sdr'));
create function pg_temp.quem(p text) returns uuid language sql as $$
  select id from equipe where papel = p
$$;

-- ---------- a planilha deste arquivo ----------
-- Quatro linhas, todas com "último contato" menos a segunda: é a coluna que
-- dispara a nota do importador, e é o controle que separa "o desfazer está
-- quebrado" de "o desfazer não reconhece o próprio toque".
create function pg_temp.linha(p_n int, p_nome text, p_tel text, p_extra jsonb default '{}')
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'linha', p_n, 'nome', p_nome, 'whatsapp', p_tel,
    'categoria', 'Buffet adulto/corporativo', 'origem', 'Planilha atual',
    'cidade', 'Natal', 'tipo', 'fornecedor', 'etapa', 'Contatado',
    'responsavel', 'Genoveva', 'ultimo_contato', '2026-09-05',
    'canal_ultimo_contato', 'Ligação', 'resultado', 'Não respondeu',
    'proxima_acao', 'Follow-up D+3')) || p_extra
$$;

create temp table ids(chave text primary key, v uuid);
create function pg_temp.id(p text) returns uuid language sql as $$
  select v from ids where chave = p
$$;
create function pg_temp.ficha(p_nome text) returns uuid language sql as $$
  select o.id from public.organizations o where o.name = p_nome
$$;

create temp table gravado(r jsonb);
grant all on ids, gravado, equipe to authenticated;

-- ---------- a importação, pelo caminho real ----------
select pg_temp.entrar(pg_temp.quem('sdr'), 'sdr');
insert into ids values
  ('lote', (public.esteira_abrir_lote('planilha',
              (select id from public.sources where slug = 'planilha'),
              'pgTAP 33 — lote principal') ->> 'batch_id')::uuid);
insert into gravado
select public.importacao_gravar(pg_temp.id('lote'), jsonb_build_array(
  pg_temp.linha(2, 'Alcebiades Pgtap33 Buffet',  '(84) 98111-9331'),
  pg_temp.linha(3, 'Belarmina Pgtap33 Buffet',   '(84) 98111-9332',
                '{"ultimo_contato": null, "canal_ultimo_contato": null, "resultado": null}'),
  pg_temp.linha(4, 'Cesarina Pgtap33 Buffet',    '(84) 98111-9333'),
  pg_temp.linha(5, 'Doroteia Pgtap33 Buffet',    '(84) 98111-9334')));
select public.importacao_encerrar_lote(pg_temp.id('lote'), null);
select pg_temp.sair();

select is((select (r -> 'contagem' ->> 'entra')::int from gravado), 4,
          'as quatro linhas viraram ficha (a importação de verdade, pela RPC da tela)');

-- =====================================================================
-- 1. A CAUSA: o próprio importador toca a ficha que acabou de criar
-- =====================================================================
select is((select count(*)::int from public.activities a
            where a.organization_id = pg_temp.ficha('Alcebiades Pgtap33 Buffet')
              and a.type <> 'system'), 1,
          'a linha com "último contato" nasce com UMA atividade não-system');
select is((select a.metadata ->> 'origin' from public.activities a
            where a.organization_id = pg_temp.ficha('Alcebiades Pgtap33 Buffet')
              and a.type <> 'system'), 'importacao_planilha',
          'e essa atividade é a nota do próprio importador');
select is((select a.metadata ->> 'batch_id' from public.activities a
            where a.organization_id = pg_temp.ficha('Alcebiades Pgtap33 Buffet')
              and a.type <> 'system'), pg_temp.id('lote')::text,
          'e ela carrega o batch_id DESTE lote — é por aí que o desfazer a reconhece');
select ok((select count(*) = 0 from public.activities a
            where a.organization_id = pg_temp.ficha('Belarmina Pgtap33 Buffet')
              and a.type <> 'system'),
          'a linha SEM "último contato" não ganha nota nenhuma (o controle do §4.3)');

-- =====================================================================
-- 2. O que continua prendendo a ficha
-- =====================================================================
-- Nota escrita por gente, depois da importação.
insert into public.activities (type, organization_id, user_id, author_kind, occurred_at, body)
values ('note'::app.activity_type, pg_temp.ficha('Cesarina Pgtap33 Buffet'),
        pg_temp.quem('sdr'), 'human', now(), 'Falei com a dona pelo telefone — quer proposta.');
-- Consentimento registrado.
insert into public.consent_events (organization_id, kind, channel, evidence_text)
values (pg_temp.ficha('Doroteia Pgtap33 Buffet'), 'contact_optin', 'whatsapp', 'pgTAP 33');

-- =====================================================================
-- 3. §3.7 no servidor: quem não é gestor não desfaz
-- =====================================================================
select pg_temp.entrar(pg_temp.quem('sdr'), 'sdr');
select throws_ok($$ select public.esteira_desfazer_lote(
                      (select v from ids where chave = 'lote')) $$,
                 '42501', null,
                 'papel sdr não desfaz importação (é o 403 que a tela precisa traduzir)');
select pg_temp.sair();

-- =====================================================================
-- 4. O desfazer, como gestor
-- =====================================================================
select pg_temp.entrar(pg_temp.quem('gestor'), 'gestor');
insert into gravado
select public.esteira_desfazer_lote(pg_temp.id('lote'));
select pg_temp.sair();

create function pg_temp.desfeito() returns jsonb language sql as $$
  select r from gravado where r ? 'organizacoes_removidas'
$$;

select is((select desfeito ->> 'organizacoes_removidas' from pg_temp.desfeito() desfeito), '2',
          'o desfazer remove as DUAS fichas que só o próprio importador tocou');
select is((select desfeito ->> 'fichas_preservadas' from pg_temp.desfeito() desfeito), '2',
          'e preserva as duas que ganharam histórico de gente');
select is((select desfeito ->> 'negocios_removidos' from pg_temp.desfeito() desfeito), '2',
          'os negócios das fichas removidas vão junto');

select ok(pg_temp.ficha('Alcebiades Pgtap33 Buffet') is null,
          'a ficha com "último contato" e nada mais SOME — é o §3.6 consertado');
select ok(pg_temp.ficha('Belarmina Pgtap33 Buffet') is null,
          'a ficha sem "último contato" continua sumindo (nada regrediu)');
select ok(pg_temp.ficha('Cesarina Pgtap33 Buffet') is not null,
          'a ficha com nota escrita por gente fica de pé');
select ok(pg_temp.ficha('Doroteia Pgtap33 Buffet') is not null,
          'a ficha com consentimento registrado fica de pé');
select is((select b.status from public.import_batches b where b.id = pg_temp.id('lote')),
          'desfeito', 'o lote fica marcado como desfeito');

-- =====================================================================
-- 5. É o PRÓPRIO toque, e não "qualquer toque de importação"
-- =====================================================================
-- Uma ficha de um lote novo, com uma nota de importação que veio de OUTRO lote.
-- Se a condição olhasse só para `origin = 'importacao_planilha'`, esta ficha
-- sumiria — e o desfazer passaria a apagar o registro de uma importação
-- anterior, que é o oposto do que o RF-BAS-17 promete.
select pg_temp.entrar(pg_temp.quem('sdr'), 'sdr');
insert into ids values
  ('lote2', (public.esteira_abrir_lote('planilha',
               (select id from public.sources where slug = 'planilha'),
               'pgTAP 33 — lote de controle') ->> 'batch_id')::uuid);
insert into gravado
select public.importacao_gravar(pg_temp.id('lote2'), jsonb_build_array(
  pg_temp.linha(2, 'Eufrasia Pgtap33 Buffet', '(84) 98111-9335')));
select public.importacao_encerrar_lote(pg_temp.id('lote2'), null);
select pg_temp.sair();

update public.activities a
   set metadata = a.metadata || jsonb_build_object('batch_id', pg_temp.id('lote')::text)
 where a.organization_id = pg_temp.ficha('Eufrasia Pgtap33 Buffet')
   and a.type <> 'system';

select pg_temp.entrar(pg_temp.quem('gestor'), 'gestor');
select is(public.esteira_desfazer_lote(pg_temp.id('lote2')) ->> 'fichas_preservadas', '1',
          'nota de importação de OUTRO lote prende a ficha: o desfazer reconhece só o próprio toque');
select pg_temp.sair();
select ok(pg_temp.ficha('Eufrasia Pgtap33 Buffet') is not null,
          'e ela continua na base');

select * from finish();
rollback;

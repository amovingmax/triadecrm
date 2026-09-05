-- =====================================================================
-- TRIADE — v0.1 — D4/D5 — A esteira de ingestão (ADR-08)
--   raw_capture → source_record → supplier_candidate → revisão → organizations
--
-- Hoje a esteira tem uma peça só (`supplier_candidates`, migração 001401) e um
-- balde de dados soltos: a proveniência mora num `payload jsonb` sem forma, o
-- descarte de CPF fica registrado como um carimbo de data, e não há como
-- responder "de onde vocês tiraram o meu número?" com a URL exata — que é a
-- pergunta que multou a KASPR na França e é, ao mesmo tempo, um nó do roteiro
-- de ligação ("achei vocês no Casamentos.com.br").
--
-- O que esta migração ENTREGA
--   1. As cinco tabelas que faltavam: `import_batches` (o lote, com desfazer de
--      48 h), `raw_capture` (o bruto JÁ EXTRAÍDO para a whitelist — nunca HTML —,
--      retido 90 dias), `source_record` (o normalizado por fonte, com hash de
--      conteúdo para diff), `field_provenance` (de onde veio CADA campo, e o
--      registro dos descartes) e `worker_heartbeats` (o watchdog).
--      `organizations`, `supplier_candidates` e `deals` ganham `import_batch_id`
--      (RF-BAS-17).
--   2. A whitelist do R06 SCR-01/SCR-02 como CHECK CONSTRAINT, não como
--      parágrafo: foto, texto, avaliação, logo, preço de tabela, CPF, Pix e
--      dado bancário são recusados pelo banco na hora do INSERT.
--   3. A higiene do RF-BAS-16 em gatilho (ADR-03), porque a esteira tem duas
--      bocas — o importador de planilha e o coletor — e a regra não pode
--      depender de qual delas escreveu. O CPF passa a ser varrido em QUALQUER
--      campo de texto livre (a lacuna que o gatilho de `supplier_candidates`
--      deixava: ele só limpava `name`), e o descarte deixa rastro em
--      `field_provenance` sem deixar o número.
--   4. As quatro funções da esteira, caminho único de escrita:
--      `app.resolver_source_record` (registro → candidato),
--      `app.promover_candidato` (candidato → organização + negócio),
--      `app.mesclar_candidato` (completa ficha existente, sem sobrescrever) e
--      `app.recusar_candidato`. `public.radar_revisar_candidato` passa a ser um
--      despachante fino sobre elas — mesma assinatura, mesmos retornos, mesma
--      tela: o teste 14 continua sendo o contrato dessa refatoração.
--   5. As quatro filas `pgmq` (`ingest_jobs`, `ingest_pages`, `ingest_records`,
--      `ingest_dlq`) com chave de idempotência própria, visibility timeout
--      dimensionado pelo trabalho real e retry com backoff → dead-letter.
--   6. A retenção do PRD §10.6 em `pg_cron`, com relatório de expurgo (R06
--      GOV-06).
--
-- O que esta migração NÃO faz
--   * Não coleta nada: nenhum scraper, nenhuma fonte ligada. Oito das onze
--     fontes continuam com `robots_ok` nulo e `radar_alternar_fonte` recusa
--     ligá-las (RF-RAD-01). A esteira nasce vazia, de propósito.
--   * Não mexe em `organizations`, `deals` nem na regra de temperatura além de
--     acrescentar a coluna do lote.
--   * Não guarda HTML. O cache de página bruta é de DISCO do worker, ≤ 7 dias
--     (R06 SCR-11); `raw_capture.payload` é o que sobrou depois da whitelist.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 0. Extensões
-- ---------------------------------------------------------------------------
-- `pgmq` é ADR-11 (filas nativas do Postgres; sem Redis, BullMQ ou n8n). Estava
-- disponível (1.5.1) e não instalado — a migração 000100 deixou para "o dia em
-- que for usada". É hoje. A extensão não é relocável: nasce no schema `pgmq`.
create extension if not exists pgmq;
create extension if not exists pg_cron;

-- O schema `pgmq` não é superfície de API: a fila é do worker (service_role),
-- e `config.toml` só expõe `public`. Fechado explicitamente porque a extensão
-- concede EXECUTE a PUBLIC nas próprias funções ao instalar.
revoke all on schema pgmq from public, anon, authenticated;
grant usage on schema pgmq to service_role;
do $$
begin
  execute 'revoke all on all functions in schema pgmq from public, anon, authenticated';
  execute 'revoke all on all tables in schema pgmq from public, anon, authenticated';
  execute 'grant execute on all functions in schema pgmq to service_role';
  execute 'grant select, insert, update, delete on all tables in schema pgmq to service_role';
exception when others then null;
end $$;


-- ---------------------------------------------------------------------------
-- 1. CPF em qualquer campo (fecha a lacuna do RF-BAS-16)
-- ---------------------------------------------------------------------------
-- `app.cpf_is_valid` (migração 001401) reconhece; estas duas APAGAM. A diferença
-- importa: o CPF é o único valor que não pode nem aparecer no registro do
-- descarte (ADR-09), então quem descarta precisa de uma função que devolva o
-- texto limpo, e não o achado.
create or replace function app.tem_cpf(t text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  m text;
begin
  if t is null then
    return false;
  end if;
  for m in select x[1] from regexp_matches(t, '(\d{3}\.?\d{3}\.?\d{3}-?\d{2})', 'g') x loop
    if app.cpf_is_valid(m) then
      return true;
    end if;
  end loop;
  return false;
end $$;
comment on function app.tem_cpf(text) is
  'true se o texto contém uma sequência que passa no dígito verificador de CPF (RF-BAS-16). Usada para DESCARTAR, nunca para guardar.';

create or replace function app.sem_cpf(t text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := coalesce(t, '');
  m text;
begin
  for m in select x[1] from regexp_matches(v, '(\d{3}\.?\d{3}\.?\d{3}-?\d{2})', 'g') x loop
    if app.cpf_is_valid(m) then
      v := replace(v, m, ' ');
    end if;
  end loop;
  return nullif(trim(regexp_replace(v, '\s{2,}', ' ', 'g')), '');
end $$;
comment on function app.sem_cpf(text) is
  'Devolve o texto sem os CPFs válidos que houver dentro (RF-BAS-16, ADR-09). NULL se não sobrar nada.';

revoke all on function app.tem_cpf(text) from public, anon;
revoke all on function app.sem_cpf(text) from public, anon;
grant execute on function app.tem_cpf(text) to authenticated, service_role;
grant execute on function app.sem_cpf(text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. A whitelist do R06 (SCR-01 e SCR-02) como constraint
-- ---------------------------------------------------------------------------
-- "Coletar só os campos da whitelist" vira código aqui, e não no worker: o
-- worker é substituível, o banco não. Foto, texto descritivo, avaliação em
-- texto, logo e preço de tabela são direito autoral e direito de imagem de
-- terceiro; CPF, Pix e dado bancário são ADR-09. O banco recusa o INSERT.
create or replace function app.payload_e_permitido(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- Campos que a esteira pode guardar (contrato da ingestão; R06 SCR-01).
  -- Acrescentar campo aqui é decisão de projeto, não de implementação: cada
  -- nome novo amplia o que o CRM guarda de terceiro sem que ninguém aprove.
  v_permitidas constant text[] := array[
    'nome_comercial','razao_social','cnpj','categoria_origem','cidade','bairro','endereco','cep',
    'telefones','email','site','instagram','place_id','source_url','data_abertura','mei',
    'situacao_cadastral','nota','avaliacoes_qtd','preco_a_partir_de','capacidade_max','fotos_qtd'];
  -- Nomes de chave proibidos em QUALQUER nível (R06 SCR-02 + ADR-09).
  v_proibida constant text := '(foto|photo|imagem|image|picture|midia|media|logo|banner|thumb|avatar'
                           || '|descri|description|texto|resumo|sobre|bio|review|resenha|coment'
                           || '|depoiment|opiniao|testemunh|preco_tabela|tabela_de_preco|price_list'
                           || '|cpf|pix|conta_banc|conta_corrente|cartao|agencia|banco|bank|iban|rg_|cnh'
                           || '|senha|password|token|secret)';
  v_fila jsonb[];
  v_atual jsonb;
  v_ch text;
  v_val jsonb;
begin
  if p is null then
    return true;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return false;
  end if;

  -- (1) No topo, só a whitelist. Nada de "extras" que ninguém leu.
  for v_ch in select k from jsonb_object_keys(p) k loop
    if not (v_ch = any (v_permitidas)) then
      return false;
    end if;
  end loop;

  -- (2) Em qualquer profundidade, nenhuma chave proibida. `fotos_qtd` é número
  -- (sinal de pontuação, RF-RAD-12) e está na whitelist; `fotos` não está, e é
  -- exatamente o que a regra recusa.
  v_fila := array[p];
  while coalesce(array_length(v_fila, 1), 0) > 0 loop
    v_atual := v_fila[1];
    v_fila  := v_fila[2:];
    if jsonb_typeof(v_atual) = 'object' then
      for v_ch, v_val in select e.key, e.value from jsonb_each(v_atual) e loop
        if not (v_ch = any (v_permitidas)) and lower(v_ch) ~ v_proibida then
          return false;
        end if;
        if jsonb_typeof(v_val) in ('object','array') then
          v_fila := v_fila || v_val;
        end if;
      end loop;
    elsif jsonb_typeof(v_atual) = 'array' then
      for v_val in select a.value from jsonb_array_elements(v_atual) a loop
        if jsonb_typeof(v_val) in ('object','array') then
          v_fila := v_fila || v_val;
        end if;
      end loop;
    end if;
  end loop;

  return true;
end $$;
comment on function app.payload_e_permitido(jsonb) is
  'Whitelist do R06 SCR-01/SCR-02 como constraint: no topo só os campos permitidos; em qualquer nível, nenhuma chave de foto, texto, avaliação, logo, preço de tabela, CPF, Pix ou dado bancário.';

revoke all on function app.payload_e_permitido(jsonb) from public, anon;
grant execute on function app.payload_e_permitido(jsonb) to authenticated, service_role;

-- Hash de conteúdo: `jsonb` já guarda as chaves ordenadas e sem duplicata, então
-- a representação textual é canônica para um mesmo valor — dois workers que
-- montam o mesmo objeto em ordens diferentes produzem o mesmo hash.
create or replace function app.payload_hash(p jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select app.sha256_hex(coalesce(p, '{}'::jsonb) #>> '{}')
$$;
comment on function app.payload_hash(jsonb) is 'SHA-256 do jsonb canonicalizado; usado para diff de captura e de registro.';
revoke all on function app.payload_hash(jsonb) from public, anon;
grant execute on function app.payload_hash(jsonb) to authenticated, service_role;


-- Marcas que a higiene NÃO recalcula: são fato histórico ou vêm de outra etapa
-- da esteira. Sem esta lista, um UPDATE qualquer apagaria o registro de que um
-- CPF foi descartado (o texto já está limpo na segunda passagem, então a regra
-- não o encontraria de novo) e o aviso de que a fonte mudou. As demais marcas
-- (telefone_invalido, ddd_de_fora, @ fora do padrão, cnpj_invalido, sem_contato,
-- suprimido) são recalculadas a cada escrita, e é assim que corrigir o telefone
-- limpa o aviso em vez de deixá-lo grudado para sempre.
create or replace function app.flags_externas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['cpf_descartado','mudou_na_fonte','telefone_compartilhado','ja_existe_na_base']
$$;
comment on function app.flags_externas() is
  'Marcas preservadas entre escritas por não serem recalculáveis: cpf_descartado, mudou_na_fonte, telefone_compartilhado, ja_existe_na_base.';
revoke all on function app.flags_externas() from public, anon;
grant execute on function app.flags_externas() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. O lote: `public.import_batches` (RF-BAS-17, RF-REL-11)
-- ---------------------------------------------------------------------------
-- Toda entrada abre um lote antes de qualquer gravação — planilha ou robô. É o
-- `ingest_job_id` do Radar e o `import_batch_id` da importação, unificados numa
-- tabela só, porque a esteira é uma (ADR-08). O lote é dimensão de relatório e
-- unidade de DESFAZER; nunca é chave de dedup nem unidade de retenção — a
-- retenção do §10.6 é por titular, não por lote.
create table if not exists public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('planilha','coleta')),
  source_id      int  not null references public.sources (id),
  label          text not null check (length(trim(label)) > 0),
  params         jsonb not null default '{}'::jsonb,
  status         text not null default 'previa'
                 check (status in ('previa','na_fila','rodando','concluido','falhou','desfeito')),
  stats          jsonb not null default '{}'::jsonb,
  triggered_by   uuid references public.profiles (id) on delete set null,
  -- Contrato/licença anexada quando a origem é lista de terceiros (RF-BAS-10,
  -- regra Telekall do R09): sem o documento, ninguém sabe se a lista podia ser usada.
  license_path   text,
  can_undo_until timestamptz not null default now() + interval '48 hours',
  started_at     timestamptz,
  finished_at    timestamptz,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.import_batches is
  'Lote de entrada da esteira (ADR-08): planilha (RF-BAS-07) ou coleta (RF-RAD). Rótulo legível, estatísticas, licença da origem e janela de desfazer de 48 h. Dimensão de relatório (RF-REL-11), nunca chave de dedup.';
comment on column public.import_batches.label is 'Rótulo que uma pessoa reconhece: "planilha-ponte do Dia 0", "crawler Casamentos de 10/09".';
comment on column public.import_batches.license_path is 'Caminho do contrato/licença no Storage quando a origem é lista de terceiro (RF-BAS-10).';
comment on column public.import_batches.can_undo_until is 'Até quando o lote pode ser desfeito (48 h). Depois disso o desfazer vira trabalho de ficha em ficha.';

create index if not exists import_batches_status_idx on public.import_batches (status, created_at desc);
create index if not exists import_batches_source_idx on public.import_batches (source_id);
create index if not exists import_batches_by_idx     on public.import_batches (triggered_by);

drop trigger if exists import_batches_touch on public.import_batches;
create trigger import_batches_touch before update on public.import_batches
  for each row execute function app.set_updated_at();

-- Auditar o lote, sim: é a decisão de trazer gente de fora para dentro da base.
-- Auditar `raw_capture` e `source_record`, não: copiaria o dado de terceiro para
-- dentro do `audit_log`, que tem retenção maior — o oposto da minimização.
drop trigger if exists audit_import_batches on public.import_batches;
create trigger audit_import_batches after insert or update or delete on public.import_batches
  for each row execute function app.audit();


-- ---------------------------------------------------------------------------
-- 4. O bruto, como veio: `public.raw_capture`
-- ---------------------------------------------------------------------------
-- Uma linha por página buscada, objeto de API ou LINHA de planilha. "Bruto" aqui
-- é "como a fonte entregou, DEPOIS de extraído para a whitelist" — não HTML: o
-- HTML fica em cache de disco do worker por ≤ 7 dias (R06 SCR-11) e não entra no
-- Postgres em hipótese nenhuma.
create table if not exists public.raw_capture (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.import_batches (id) on delete cascade,
  source_id    int  not null references public.sources (id),
  external_id  text,                                   -- e120278 / place_id / cnpj / @handle / nº da linha
  source_url   text,
  request_key  text not null,                          -- sha256(source_id|source_url|external_id) — gatilho
  http_status  int,
  fetched_at   timestamptz not null default now(),
  collector    text not null,                          -- 'KomuneBot/1.0' ou o nome da pessoa
  content_hash text not null,                          -- sha256 do payload canonicalizado — gatilho
  payload      jsonb not null,
  purge_after  date not null default ((now() at time zone 'America/Fortaleza')::date + 90),
  created_at   timestamptz not null default now(),
  -- Sem URL e sem id externo não há proveniência: o registro não saberia dizer
  -- de onde veio, que é a única razão de a tabela exister (R06 SCR-08).
  constraint raw_capture_tem_origem check (external_id is not null or source_url is not null),
  -- A whitelist, recusada pelo banco e não pelo worker.
  constraint raw_capture_payload_na_whitelist check (app.payload_e_permitido(payload))
);
comment on table public.raw_capture is
  'Captura bruta já extraída para a whitelist do R06 SCR-01 (nunca HTML — cache de disco do worker, ≤ 7 dias, SCR-11). Retida 90 dias (PRD §10.6). Só admin lê.';
comment on column public.raw_capture.request_key is 'Chave de idempotência da fila de páginas: a mesma URL no mesmo lote não vira duas capturas.';
comment on column public.raw_capture.content_hash is 'SHA-256 do payload: a mesma página buscada duas vezes não vira duas capturas, e a que mudou é detectada por diff.';
comment on column public.raw_capture.purge_after is 'Data do expurgo (90 dias, PRD §10.6), aplicada por pg_cron.';

create unique index if not exists raw_capture_conteudo_uq on public.raw_capture (source_id, content_hash);
create unique index if not exists raw_capture_pedido_uq   on public.raw_capture (batch_id, request_key);
create index if not exists raw_capture_purge_idx  on public.raw_capture (purge_after);
create index if not exists raw_capture_batch_idx  on public.raw_capture (batch_id);
create index if not exists raw_capture_externo_idx on public.raw_capture (source_id, external_id) where external_id is not null;

create or replace function app.raw_capture_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.source_url  := nullif(trim(coalesce(new.source_url, '')), '');
  new.external_id := nullif(trim(coalesce(new.external_id, '')), '');
  new.collector   := coalesce(nullif(trim(coalesce(new.collector, '')), ''),
                              (select pr.full_name from public.profiles pr where pr.id = auth.uid()),
                              'sistema');
  -- Calculados no banco, sempre: um worker que esquecesse de preencher o hash
  -- transformaria a idempotência em promessa.
  new.request_key  := app.sha256_hex(new.source_id::text || '|' ||
                                     coalesce(new.source_url, new.external_id, ''));
  new.content_hash := app.payload_hash(new.payload);
  return new;
end $$;

drop trigger if exists raw_capture_before_write on public.raw_capture;
create trigger raw_capture_before_write before insert or update on public.raw_capture
  for each row execute function app.raw_capture_normalize();


-- ---------------------------------------------------------------------------
-- 5. O normalizado, por fonte: `public.source_record`
-- ---------------------------------------------------------------------------
create table if not exists public.source_record (
  id                uuid primary key default gen_random_uuid(),
  raw_capture_id    uuid references public.raw_capture (id) on delete set null,
  batch_id          uuid references public.import_batches (id) on delete set null,
  source_id         int  not null references public.sources (id),
  external_id       text not null,
  source_url        text,

  name              text not null check (length(trim(name)) > 0),
  legal_name        text,
  cnpj              text,
  phone_e164        text,
  phones            jsonb not null default '[]'::jsonb,   -- todos, com kind (celular/fixo) e origem
  email             extensions.citext,
  instagram_handle  text,
  website           text,
  website_domain    text,
  place_id          text,
  city_id           int references public.cities (id) on delete set null,
  neighborhood      text,
  address           text,
  cep               text,
  category_source   text,                                 -- slug do Casamentos, CNAE, tipo do Places
  category_id       int references public.categories (id) on delete set null,
  kind              app.org_kind not null default 'fornecedor',

  -- Sinais numéricos de pontuação (RF-RAD-12). Exceção consciente ao R06 SCR-02,
  -- em validação jurídica (PRD §13 item 10): entram na conta do score e NUNCA
  -- são exibidos como conteúdo de terceiro.
  rating            numeric(3,2) check (rating is null or rating between 0 and 5),
  reviews_count     int  check (reviews_count is null or reviews_count >= 0),
  price_from        numeric(12,2) check (price_from is null or price_from >= 0),
  capacity_max      int  check (capacity_max is null or capacity_max >= 0),
  photos_count      int  check (photos_count is null or photos_count >= 0),

  opened_at         date,
  is_mei            boolean,
  registry_status   text,
  is_natural_person boolean not null default false,
  flags             text[] not null default '{}'::text[],

  content_hash      text not null default '',
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  candidate_id      uuid references public.supplier_candidates (id) on delete set null,
  -- Só Places: telefone e site têm TTL de 30 dias nos termos do Google. Fora do
  -- Places fica nulo — e o `place_id` continua sendo o único campo do Places que
  -- pode ser guardado sem prazo.
  expires_at        timestamptz,
  search_name       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.source_record is
  'Registro normalizado por fonte (ADR-08): uma linha por (fonte, id externo), com hash de conteúdo para diff e ponteiro para o candidato resolvido. A higiene do RF-BAS-16 roda em gatilho.';
comment on column public.source_record.expires_at is 'TTL de 30 dias para telefone e site vindos do Places (termos do Google); nulo nas demais fontes.';
comment on column public.source_record.flags is 'Avisos da higiene: cpf_descartado, telefone_invalido, ddd_de_fora, instagram_fora_do_padrao, cnpj_invalido, sem_contato, suprimido, mudou_na_fonte, telefone_compartilhado.';
comment on column public.source_record.phones is 'Todos os telefones encontrados, com kind (celular/fixo) e origem; o principal fica em phone_e164.';

create unique index if not exists source_record_fonte_externo_uq on public.source_record (source_id, external_id);
create index if not exists source_record_batch_idx     on public.source_record (batch_id);
create index if not exists source_record_candidate_idx on public.source_record (candidate_id);
create index if not exists source_record_raw_idx       on public.source_record (raw_capture_id);
create index if not exists source_record_phone_idx     on public.source_record (phone_e164) where phone_e164 is not null;
create index if not exists source_record_cnpj_idx      on public.source_record (cnpj) where cnpj is not null;
create index if not exists source_record_ig_idx        on public.source_record (instagram_handle) where instagram_handle is not null;
create index if not exists source_record_place_idx     on public.source_record (place_id) where place_id is not null;
create index if not exists source_record_expira_idx    on public.source_record (expires_at) where expires_at is not null;
create index if not exists source_record_visto_idx     on public.source_record (last_seen_at desc);
create index if not exists source_record_city_idx      on public.source_record (city_id);
create index if not exists source_record_category_idx  on public.source_record (category_id);


-- ---------------------------------------------------------------------------
-- 6. A proveniência campo a campo: `public.field_provenance`
-- ---------------------------------------------------------------------------
-- Serve a três coisas ao mesmo tempo:
--   * responder ao titular "de onde vocês tiraram o meu número?" com a URL
--     ESPECÍFICA — a KASPR foi multada por responder só "fontes públicas";
--   * registrar o descarte do CPF sem guardar o CPF (só o hash do que saiu, e
--     nem isso quando o motivo é 'cpf': aí não vai hash nenhum);
--   * sustentar a regra de sobrevivência de campos do RF-RAD-08 (legal ← RFB;
--     endereço ← Casamentos > RFB > Places; telefone ← WhatsApp validado > ...).
create table if not exists public.field_provenance (
  id                  bigserial primary key,
  record_type         text not null check (record_type in ('source_record','supplier_candidate','organization')),
  record_id           uuid not null,
  field               text not null,
  source_id           int  references public.sources (id),
  source_url          text,
  batch_id            uuid references public.import_batches (id) on delete set null,
  collected_at        timestamptz not null default now(),
  collector           text,
  tool                text,                    -- 'KomuneBot/1.0' | 'planilha:SheetJS' | 'entrada manual'
  action              text not null check (action in ('gravado','descartado','sobrescrito','preservado')),
  previous_value_hash text,                    -- HASH, nunca o valor
  reason              text,
  legal_basis         text not null default 'legitimo_interesse',
  lia_version         text,
  created_at          timestamptz not null default now()
);
comment on table public.field_provenance is
  'De onde veio CADA campo (R06 SCR-08) e o registro de cada descarte. Append-only. Nunca guarda o valor: só o hash do que foi sobrescrito — e nem isso quando o motivo é CPF (ADR-09).';
comment on column public.field_provenance.previous_value_hash is 'SHA-256 do valor anterior quando action = sobrescrito/preservado. O valor em si nunca é gravado.';
comment on column public.field_provenance.action is 'gravado (entrou) · descartado (recusado pela higiene) · sobrescrito (trocou) · preservado (a fonte trouxe algo, mas o que já existia venceu — RF-RAD-08).';

create index if not exists field_provenance_registro_idx on public.field_provenance (record_type, record_id, created_at desc);
create index if not exists field_provenance_fonte_idx    on public.field_provenance (source_id, created_at desc);
create index if not exists field_provenance_batch_idx    on public.field_provenance (batch_id);

-- Append-only para UPDATE: um registro de proveniência que pode ser editado não
-- prova nada. DELETE fica de pé porque a RETENÇÃO precisa dele (§10.6) — e a RLS
-- só o concede a admin.
drop trigger if exists field_provenance_append_only on public.field_provenance;
create trigger field_provenance_append_only before update on public.field_provenance
  for each row execute function app.forbid_change();


-- ---------------------------------------------------------------------------
-- 7. O watchdog: `public.worker_heartbeats`
-- ---------------------------------------------------------------------------
-- A tela do Radar precisa dizer se o coletor está vivo. Sem isso, "fila vazia"
-- e "worker desligado" são a mesma tela — e a segunda é um problema, não um dia
-- tranquilo (ADR-04: os workers rodam na máquina dedicada e só consomem quando ligados).
create table if not exists public.worker_heartbeats (
  worker           text not null,                    -- 'ingest' | 'wa' | 'ai'
  instance         text not null default 'default',
  host             text,
  version          text,
  status           text not null default 'ok' check (status in ('ok','degradado','parado')),
  queue            text,
  last_beat_at     timestamptz not null default now(),
  started_at       timestamptz not null default now(),
  processed_total  bigint not null default 0,
  failed_total     bigint not null default 0,
  details          jsonb not null default '{}'::jsonb,
  primary key (worker, instance)
);
comment on table public.worker_heartbeats is
  'Última batida de cada worker (ADR-04). O Radar lê daqui para dizer "coletor parado há 12 min" em vez de mostrar uma fila vazia sem explicação.';

create index if not exists worker_heartbeats_batida_idx on public.worker_heartbeats (last_beat_at desc);


-- ---------------------------------------------------------------------------
-- 8. `import_batch_id` nas três tabelas de destino (RF-BAS-17)
-- ---------------------------------------------------------------------------
alter table public.organizations       add column if not exists import_batch_id uuid references public.import_batches (id) on delete set null;
alter table public.supplier_candidates add column if not exists import_batch_id uuid references public.import_batches (id) on delete set null;
alter table public.deals               add column if not exists import_batch_id uuid references public.import_batches (id) on delete set null;

comment on column public.organizations.import_batch_id is 'Lote que trouxe esta ficha (RF-BAS-17): permite desfazer a importação em 48 h e recortar relatórios por lote.';
comment on column public.supplier_candidates.import_batch_id is 'Lote que trouxe este candidato (RF-BAS-17).';
comment on column public.deals.import_batch_id is 'Lote que criou este negócio (RF-BAS-17); o desfazer do lote remove os negócios que ele criou.';

create index if not exists organizations_batch_idx       on public.organizations (import_batch_id) where import_batch_id is not null;
create index if not exists supplier_candidates_batch_idx on public.supplier_candidates (import_batch_id) where import_batch_id is not null;
create index if not exists deals_batch_idx               on public.deals (import_batch_id) where import_batch_id is not null;


-- ---------------------------------------------------------------------------
-- 9. Registrar proveniência (o valor entra, só o hash fica)
-- ---------------------------------------------------------------------------
-- A função recebe o VALOR e guarda o HASH. É de propósito: se quem chama tivesse
-- que hashear, um dia alguém passaria o valor cru e ele ficaria gravado. E quando
-- o motivo é 'cpf', nem o hash é gravado — um hash de CPF é um CPF pesquisável
-- por força bruta (11 dígitos), e isso é justamente o que o ADR-09 proíbe.
create or replace function app.registrar_proveniencia(
  p_record_type    text,
  p_record_id      uuid,
  p_field          text,
  p_action         text,
  p_source_id      int  default null,
  p_source_url     text default null,
  p_batch_id       uuid default null,
  p_collector      text default null,
  p_tool           text default null,
  p_previous_value text default null,
  p_reason         text default null,
  p_collected_at   timestamptz default null,
  p_lia_version    text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_hash text;
  v_base text;
begin
  if p_record_id is null or nullif(trim(coalesce(p_field, '')), '') is null then
    return null;
  end if;

  v_hash := case
              when p_previous_value is null then null
              when coalesce(p_reason, '') = 'cpf' then null   -- ADR-09: nem o hash
              else app.sha256_hex(p_previous_value)
            end;

  select coalesce(nullif(trim(s.legal_basis), ''), 'legitimo_interesse')
    into v_base
    from public.sources s where s.id = p_source_id;

  insert into public.field_provenance
    (record_type, record_id, field, source_id, source_url, batch_id, collected_at,
     collector, tool, action, previous_value_hash, reason, legal_basis, lia_version)
  values
    (p_record_type, p_record_id, p_field, p_source_id,
     nullif(trim(coalesce(p_source_url, '')), ''), p_batch_id, coalesce(p_collected_at, now()),
     nullif(trim(coalesce(p_collector, '')), ''), nullif(trim(coalesce(p_tool, '')), ''),
     p_action, v_hash, nullif(trim(coalesce(p_reason, '')), ''),
     coalesce(v_base, 'legitimo_interesse'), p_lia_version)
  returning id into v_id;

  return v_id;
end $$;
comment on function app.registrar_proveniencia(text,uuid,text,text,int,text,uuid,text,text,text,text,timestamptz,text) is
  'Grava uma linha de field_provenance. Recebe o valor anterior e guarda só o hash — e nem o hash quando o motivo é CPF (ADR-09).';

revoke all on function app.registrar_proveniencia(text,uuid,text,text,int,text,uuid,text,text,text,text,timestamptz,text) from public, anon;
grant execute on function app.registrar_proveniencia(text,uuid,text,text,int,text,uuid,text,text,text,text,timestamptz,text) to authenticated, service_role;



-- ---------------------------------------------------------------------------
-- 10. A higiene, em gatilho (RF-BAS-16 / RF-RAD-16)
-- ---------------------------------------------------------------------------
-- As nove regras do contrato, na ordem em que importam. Em gatilho, e não no
-- worker, porque a esteira tem duas bocas — o importador e o robô — e a regra
-- não pode depender de qual delas escreveu (ADR-03).
--
-- O registro do descarte é escrito aqui mesmo, no BEFORE: o `id` da linha já
-- existe quando um gatilho BEFORE INSERT roda (o Postgres aplica os DEFAULT
-- antes), e `field_provenance.record_id` é polimórfico — não há FK esperando a
-- linha existir. Escrever no AFTER exigiria carregar a lista de campos entre os
-- dois gatilhos por uma coluna que só serviria a isso.
create or replace function app.source_record_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_flags      text[] := '{}';
  v_tel_bruto  text := nullif(trim(coalesce(new.phone_e164, '')), '');
  v_ig_bruto   text := nullif(trim(coalesce(new.instagram_handle, '')), '');
  v_cnpj_bruto text;
  v_campo      text;
  v_antes      text;
  v_limpo      text;
begin
  -- (a) CPF em QUALQUER campo de texto livre. O gatilho de supplier_candidates
  -- varria só `name`; o RF-BAS-16 pede "em qualquer campo", e o nome empresarial
  -- de MEI não é o único lugar onde o CPF aparece (razão social e endereço também).
  -- `phone_e164` fica de fora de propósito: 11 dígitos de telefone podem passar no
  -- dígito verificador por acaso, e apagar o telefone seria pior que o mal.
  foreach v_campo in array array['name','legal_name','address','neighborhood'] loop
    v_antes := case v_campo when 'name'       then new.name
                            when 'legal_name' then new.legal_name
                            when 'address'    then new.address
                            else                   new.neighborhood end;
    if app.tem_cpf(v_antes) then
      v_limpo := app.sem_cpf(v_antes);
      case v_campo
        when 'name'       then new.name         := v_limpo;
        when 'legal_name' then new.legal_name   := v_limpo;
        when 'address'    then new.address      := v_limpo;
        else                   new.neighborhood := v_limpo;
      end case;
      new.is_natural_person := true;
      v_flags := array_append(v_flags, 'cpf_descartado');
      -- Sem valor e sem hash: o motivo 'cpf' é o único que bloqueia até o hash.
      perform app.registrar_proveniencia(
        'source_record', new.id, v_campo, 'descartado',
        new.source_id, new.source_url, new.batch_id, null, null, null, 'cpf');
    end if;
  end loop;
  if nullif(trim(coalesce(new.name, '')), '') is null then
    raise exception 'Registro de fonte sem nome depois da higiene de entrada' using errcode = '23514';
  end if;
  new.name := trim(regexp_replace(new.name, '\s+', ' ', 'g'));

  -- (b) Telefone em E.164. Inválido não reprova: fica nulo e vai marcado.
  new.phone_e164 := app.normalize_phone_br(v_tel_bruto);
  if v_tel_bruto is not null and new.phone_e164 is null then
    v_flags := array_append(v_flags, 'telefone_invalido');
  end if;

  -- (c) DDD fora da região MARCA para a revisão humana; nunca reprova (RF-BAS-16:
  -- o formulário de campo tem orçamento de 20 s, e recusar em campo é perder o alvo).
  if new.phone_e164 is not null and not app.ddd_da_regiao(new.phone_e164) then
    v_flags := array_append(v_flags, 'ddd_de_fora');
  end if;

  -- (d) @instagram fora do padrão: nulo + marca.
  new.instagram_handle := app.normalize_instagram(v_ig_bruto);
  if v_ig_bruto is not null and new.instagram_handle is null then
    v_flags := array_append(v_flags, 'instagram_fora_do_padrao');
  end if;

  -- (e) CNPJ: só entra se o dígito verificador fechar.
  v_cnpj_bruto := nullif(trim(coalesce(new.cnpj, '')), '');
  new.cnpj := app.normalize_cnpj(v_cnpj_bruto);
  if new.cnpj is not null and not app.cnpj_is_valid(new.cnpj) then
    new.cnpj := null;
  end if;
  if v_cnpj_bruto is not null and new.cnpj is null then
    v_flags := array_append(v_flags, 'cnpj_invalido');
  end if;

  -- (f) Site reduzido a domínio (host compartilhado não serve de chave de dedup —
  -- quem decide isso é app.is_shared_web_host, dentro de app.find_org_matches).
  new.website          := nullif(trim(coalesce(new.website, '')), '');
  new.website_domain   := app.website_domain(coalesce(new.website, new.website_domain));

  -- (g) Nome para o trigram e limpeza dos campos de texto.
  new.search_name      := app.search_name(new.name);
  new.legal_name       := nullif(trim(coalesce(new.legal_name, '')), '');
  new.neighborhood     := nullif(trim(coalesce(new.neighborhood, '')), '');
  new.address          := nullif(trim(coalesce(new.address, '')), '');
  new.category_source  := nullif(trim(coalesce(new.category_source, '')), '');
  new.registry_status  := nullif(trim(coalesce(new.registry_status, '')), '');
  new.cep              := nullif(regexp_replace(coalesce(new.cep, ''), '\D', '', 'g'), '');
  new.place_id         := nullif(trim(coalesce(new.place_id, '')), '');
  new.external_id      := trim(new.external_id);

  -- (h) Supressão consultada ANTES de gravar (RF-RAD-09): quem já pediu para sair
  -- nasce marcado, e nenhuma revisão desfaz isso.
  if app.is_suppressed(new.phone_e164, new.cnpj, new.instagram_handle) then
    v_flags := array_append(v_flags, 'suprimido');
  end if;

  -- (i) Sem nenhum canal o alvo não é acionável: não reprova, avisa.
  if new.phone_e164 is null and new.instagram_handle is null
     and new.email is null and new.website_domain is null then
    v_flags := array_append(v_flags, 'sem_contato');
  end if;

  -- Marcas que quem chamou já pôs (`mudou_na_fonte`, `telefone_compartilhado`)
  -- sobrevivem; as que a higiene calcula são refeitas do zero a cada escrita.
  v_flags := v_flags || (select coalesce(array_agg(f), '{}'::text[])
                           from unnest(coalesce(new.flags, '{}'::text[])) f
                          where f = any (app.flags_externas()));
  new.flags := (select coalesce(array_agg(distinct f order by f), '{}') from unnest(v_flags) f);

  if tg_op = 'UPDATE' then
    new.first_seen_at := old.first_seen_at;
    new.created_at    := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
comment on function app.source_record_normalize() is
  'Higiene de entrada da esteira (RF-BAS-16): CPF descartado de qualquer campo de texto e registrado em field_provenance sem o número; telefone em E.164; DDD de fora e @ fora do padrão MARCAM; CNPJ inválido cai; supressão consultada antes de gravar.';

drop trigger if exists source_record_before_write on public.source_record;
create trigger source_record_before_write before insert or update on public.source_record
  for each row execute function app.source_record_normalize();

revoke all on function app.source_record_normalize() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 11. A mesma lacuna, fechada em `supplier_candidates` (RF-BAS-16)
-- ---------------------------------------------------------------------------
-- O gatilho da migração 001401 varria CPF só em `name`. Aqui ele passa a varrer
-- `name`, `legal_name`, `address` e `notes`, e a deixar rastro em
-- `field_provenance` — sem o número, que continua não sendo gravado em lugar
-- nenhum. Tudo o mais fica exatamente como estava (o teste 14 é o contrato).
create or replace function app.supplier_candidates_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_flags text[] := '{}';
  v_ig_bruto text := nullif(trim(coalesce(new.instagram_handle, '')), '');
  v_tel_bruto text := nullif(trim(coalesce(new.phone_e164, '')), '');
  v_cnpj_bruto text;
  v_nome text := trim(coalesce(new.name, ''));
  v_campo text;
  v_antes text;
  v_limpo text;
  v_cpf_em text[] := '{}';
begin
  -- (a) CPF em qualquer campo de texto livre — não só no nome empresarial do MEI.
  -- O dado em si não é gravado em lugar nenhum, que é justamente o ponto (ADR-09);
  -- o que fica é a marca, o carimbo no payload e a linha em field_provenance.
  if app.tem_cpf(v_nome) then
    v_nome := app.sem_cpf(v_nome);
    v_cpf_em := array_append(v_cpf_em, 'name');
  end if;
  foreach v_campo in array array['legal_name','address','notes'] loop
    v_antes := case v_campo when 'legal_name' then new.legal_name
                            when 'address'    then new.address
                            else                   new.notes end;
    if app.tem_cpf(v_antes) then
      v_limpo := app.sem_cpf(v_antes);
      case v_campo
        when 'legal_name' then new.legal_name := v_limpo;
        when 'address'    then new.address    := v_limpo;
        else                   new.notes      := v_limpo;
      end case;
      v_cpf_em := array_append(v_cpf_em, v_campo);
    end if;
  end loop;
  if cardinality(v_cpf_em) > 0 then
    v_flags := array_append(v_flags, 'cpf_descartado');
    new.is_natural_person := true;
    new.payload := coalesce(new.payload, '{}'::jsonb)
                   || jsonb_build_object('cpf_descartado_em', now(),
                                         'cpf_descartado_de', array_to_string(v_cpf_em, ','));
    foreach v_campo in array v_cpf_em loop
      perform app.registrar_proveniencia(
        'supplier_candidate', new.id, v_campo, 'descartado',
        new.source_id, new.source_url, new.import_batch_id, new.collector, null, null, 'cpf');
    end loop;
  end if;
  new.name := nullif(v_nome, '');
  if new.name is null then
    raise exception 'Candidato sem nome depois da higiene de entrada' using errcode = '23514';
  end if;

  -- (b) Telefone em E.164. Inválido não reprova: fica nulo e vai marcado.
  new.phone_e164 := app.normalize_phone_br(v_tel_bruto);
  if v_tel_bruto is not null and new.phone_e164 is null then
    v_flags := array_append(v_flags, 'telefone_invalido');
  elsif new.phone_e164 is not null and not app.ddd_da_regiao(new.phone_e164) then
    v_flags := array_append(v_flags, 'ddd_de_fora');
  end if;

  -- (c) @instagram normalizado; fora do padrão marca para revisão.
  new.instagram_handle := app.normalize_instagram(v_ig_bruto);
  if v_ig_bruto is not null and new.instagram_handle is null then
    v_flags := array_append(v_flags, 'instagram_fora_do_padrao');
  end if;

  -- (c-bis) CNPJ só entra se o dígito verificador fechar; senão marca e segue.
  v_cnpj_bruto := nullif(trim(coalesce(new.cnpj, '')), '');
  new.cnpj := app.normalize_cnpj(v_cnpj_bruto);
  if new.cnpj is not null and not app.cnpj_is_valid(new.cnpj) then
    new.cnpj := null;
  end if;
  if v_cnpj_bruto is not null and new.cnpj is null then
    v_flags := array_append(v_flags, 'cnpj_invalido');
  end if;
  new.website_domain := app.website_domain(coalesce(new.website, new.website_domain));
  new.search_name := app.search_name(new.name);
  new.legal_name := nullif(trim(coalesce(new.legal_name, '')), '');
  new.neighborhood := nullif(trim(coalesce(new.neighborhood, '')), '');
  new.notes := nullif(trim(coalesce(new.notes, '')), '');

  -- (d) Sem nenhum canal de contato o alvo não é acionável: não reprova, avisa.
  if new.phone_e164 is null and new.instagram_handle is null
     and new.email is null and new.website_domain is null then
    v_flags := array_append(v_flags, 'sem_contato');
  end if;

  -- (e) Supressão consultada ANTES de gravar (RF-RAD-09): quem já pediu para sair
  -- nasce como "não contatar", e nenhuma revisão pode desfazer isso.
  if app.is_suppressed(new.phone_e164, new.cnpj, new.instagram_handle) then
    new.do_not_contact := true;
    v_flags := array_append(v_flags, 'suprimido');
  end if;

  -- O que veio de cima na esteira (o CPF descartado já no source_record, o aviso
  -- de que a fonte mudou) sobrevive; o resto é recalculado a cada escrita.
  v_flags := v_flags || (select coalesce(array_agg(f), '{}'::text[])
                           from unnest(coalesce(new.flags, '{}'::text[])) f
                          where f = any (app.flags_externas()));
  new.flags := (select coalesce(array_agg(distinct f order by f), '{}') from unnest(v_flags) f);
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.collector := coalesce(nullif(trim(coalesce(new.collector, '')), ''), 'entrada manual');
  end if;

  return new;
end $$;
comment on function app.supplier_candidates_normalize() is
  'Higiene de entrada do candidato (RF-BAS-16/RF-RAD-16). Desde a migração 001600 o CPF é varrido de name, legal_name, address e notes — não só do nome — e cada descarte deixa uma linha em field_provenance (sem o número e sem o hash dele).';


-- ---------------------------------------------------------------------------
-- 12. Registro de fonte → candidato: `app.resolver_source_record`
-- ---------------------------------------------------------------------------
-- É aqui que o mesmo fornecedor colhido no Casamentos, na Receita e na planilha
-- vira UM candidato, e não três linhas na fila de quem revisa. A regra é
-- determinística: CNPJ, place_id, @instagram e celular E.164 fundem; nome por
-- trigram NUNCA funde sozinho, em ponto nenhum da esteira.
create or replace function app.resolver_source_record(p_source_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r    public.source_record;
  v_cand public.supplier_candidates;
  v_id   uuid;
  v_n    int;
  v_dup  jsonb;
  v_novo boolean := false;
begin
  select * into v_r from public.source_record where id = p_source_record_id for update;
  if v_r.id is null then
    return jsonb_build_object('ok', false, 'reason', 'registro_inexistente');
  end if;

  -- (1) Já resolvido: completa só o que está vazio. Reprocessar a mesma captura
  -- duas vezes não pode criar dois candidatos — e muito menos duas organizações.
  if v_r.candidate_id is not null then
    select * into v_cand from public.supplier_candidates where id = v_r.candidate_id;
  end if;

  -- (2) O mesmo id externo na mesma fonte é a identidade mais forte que existe,
  -- e é índice único em supplier_candidates: sem esta busca o INSERT lá embaixo
  -- estouraria 23505 no reprocessamento de uma captura já resolvida.
  if v_cand.id is null and v_r.external_id is not null then
    select c.* into v_cand
      from public.supplier_candidates c
     where c.source_id = v_r.source_id and c.external_id = v_r.external_id
     limit 1;
  end if;

  -- (3) Chave determinística já esperando revisão.
  if v_cand.id is null then
    select c.* into v_cand
      from public.supplier_candidates c
     where c.status in ('novo','aprovado','mesclado')
       and ((v_r.cnpj             is not null and c.cnpj = v_r.cnpj)
         or (v_r.place_id         is not null and c.place_id = v_r.place_id)
         or (v_r.instagram_handle is not null and c.instagram_handle = v_r.instagram_handle)
         or (v_r.phone_e164       is not null and length(v_r.phone_e164) = 14
             and c.phone_e164 = v_r.phone_e164))
     order by (c.status = 'novo') desc, c.created_at
     limit 1;

    -- (4) Número compartilhado (contador, agência, produtora que atende vários):
    -- acima de 3 candidatos no mesmo celular a fusão para de ser dedup e vira
    -- confusão de empresas. Não funde; marca e deixa para o humano.
    if v_cand.id is not null and v_r.phone_e164 is not null
       and v_cand.cnpj is null and v_cand.place_id is null
       and (v_r.cnpj is null or v_cand.cnpj is distinct from v_r.cnpj)
       and (v_r.instagram_handle is null or v_cand.instagram_handle is distinct from v_r.instagram_handle) then
      select count(*) into v_n
        from public.supplier_candidates c
       where c.phone_e164 = v_r.phone_e164;
      if v_n > 3 then
        v_cand := null;
        update public.source_record
           set flags = (select coalesce(array_agg(distinct f order by f), '{}')
                          from unnest(flags || array['telefone_compartilhado']) f)
         where id = v_r.id;
      end if;
    end if;
  end if;

  if v_cand.id is null then
    -- (5) Candidato novo, pela MESMA esteira do formulário manual.
    insert into public.supplier_candidates
      (source_id, source_url, external_id, collected_at, collector, payload,
       name, legal_name, cnpj, phone_e164, email, instagram_handle, website,
       place_id, city_id, neighborhood, address, category_id, kind,
       rating, reviews_count, is_natural_person, import_batch_id, flags)
    values
      (v_r.source_id, v_r.source_url, v_r.external_id, v_r.first_seen_at,
       coalesce((select rc.collector from public.raw_capture rc where rc.id = v_r.raw_capture_id), 'coletor'),
       jsonb_build_object('origin', 'esteira', 'source_record_id', v_r.id,
                          'raw_capture_id', v_r.raw_capture_id, 'at', now()),
       v_r.name, v_r.legal_name, v_r.cnpj, v_r.phone_e164, v_r.email, v_r.instagram_handle,
       v_r.website, v_r.place_id, v_r.city_id, v_r.neighborhood, v_r.address,
       v_r.category_id, v_r.kind, v_r.rating, v_r.reviews_count, v_r.is_natural_person,
       v_r.batch_id, v_r.flags)
    returning id into v_id;
    v_novo := true;
  else
    -- (6) Vinculado: completa só campo vazio. O que já foi confirmado vale mais
    -- que o que uma fonte pública diz (RF-RAD-08).
    v_id := v_cand.id;
    update public.supplier_candidates c
       set legal_name       = coalesce(c.legal_name, v_r.legal_name),
           cnpj             = coalesce(c.cnpj, v_r.cnpj),
           phone_e164       = coalesce(c.phone_e164, v_r.phone_e164),
           email            = coalesce(c.email, v_r.email),
           instagram_handle = coalesce(c.instagram_handle, v_r.instagram_handle),
           website          = coalesce(c.website, v_r.website),
           place_id         = coalesce(c.place_id, v_r.place_id),
           city_id          = coalesce(c.city_id, v_r.city_id),
           neighborhood     = coalesce(c.neighborhood, v_r.neighborhood),
           address          = coalesce(c.address, v_r.address),
           category_id      = coalesce(c.category_id, v_r.category_id),
           rating           = coalesce(c.rating, v_r.rating),
           reviews_count    = coalesce(c.reviews_count, v_r.reviews_count),
           import_batch_id  = coalesce(c.import_batch_id, v_r.batch_id)
     where c.id = v_id;
  end if;

  -- Proveniência campo a campo: é isto que responde "de onde vocês tiraram o
  -- meu número?" com a URL exata, e não com "fontes públicas" (caso KASPR).
  perform app.registrar_proveniencia(
            'supplier_candidate', v_id, f.campo, 'gravado',
            v_r.source_id, v_r.source_url, v_r.batch_id,
            (select rc.collector from public.raw_capture rc where rc.id = v_r.raw_capture_id),
            (select s.slug from public.sources s where s.id = v_r.source_id),
            null, null, v_r.first_seen_at)
    from (values ('name', v_r.name), ('legal_name', v_r.legal_name), ('cnpj', v_r.cnpj),
                 ('phone_e164', v_r.phone_e164), ('email', v_r.email::text),
                 ('instagram_handle', v_r.instagram_handle), ('website', v_r.website),
                 ('place_id', v_r.place_id), ('address', v_r.address),
                 ('neighborhood', v_r.neighborhood)) as f(campo, valor)
   where f.valor is not null;

  -- Duplicata contra a base, ANTES de a pessoa abrir a fila: quem revisa já
  -- chega sabendo que essa ficha existe.
  select coalesce(jsonb_agg(jsonb_build_object('organization_id', m.organization_id,
                                               'confidence', m.confidence, 'reason', m.reason)
                            order by m.confidence desc), '[]'::jsonb)
    into v_dup
    from app.find_org_matches(jsonb_build_object(
           'name', v_r.name, 'cnpj', v_r.cnpj, 'phone_e164', v_r.phone_e164,
           'instagram_handle', v_r.instagram_handle, 'website', v_r.website_domain,
           'place_id', v_r.place_id, 'city_id', v_r.city_id,
           'neighborhood', v_r.neighborhood, 'category_id', v_r.category_id)) m;

  if jsonb_array_length(v_dup) > 0 then
    update public.supplier_candidates
       set flags = (select coalesce(array_agg(distinct f order by f), '{}')
                      from unnest(flags || array['ja_existe_na_base']) f),
           payload = payload || jsonb_build_object('duplicatas', v_dup)
     where id = v_id;
  end if;

  update public.source_record
     set candidate_id = v_id, last_seen_at = now()
   where id = v_r.id;

  return jsonb_build_object('ok', true, 'candidate_id', v_id, 'criado', v_novo,
                            'duplicatas', v_dup);
end $$;
comment on function app.resolver_source_record(uuid) is
  'Resolve um source_record em UM supplier_candidate (ADR-08): vincula por chave determinística (CNPJ, place_id, @, celular), nunca por nome; recusa fundir número compartilhado por mais de 3 candidatos; grava proveniência campo a campo e marca a duplicata contra a base.';

revoke all on function app.resolver_source_record(uuid) from public, anon, authenticated;
grant execute on function app.resolver_source_record(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 13. Candidato → organização: `app.promover_candidato`
-- ---------------------------------------------------------------------------
-- UM caminho de escrita. É o que `radar_revisar_candidato` já fazia ao aprovar,
-- extraído para uma função que o worker também possa chamar sem passar por uma
-- RPC que exige JWT — e com a dedup do RF-BAS-08 refeita DENTRO da transação.
--
-- Por que duas checagens de duplicata, e não uma: `app.find_org_matches` conhece
-- as sete chaves e é quem explica o casamento para quem revisa, mas a regra de
-- telefone dela só vale para CELULAR (length 14). Os índices únicos da base não
-- fazem essa distinção: um FIXO repetido estoura 23505 e a tela mostra erro de
-- banco em vez de "essa já existe". Então o BLOQUEIO é a sonda das quatro chaves
-- que são índice único, e `find_org_matches` entra ao lado, como explicação.
create or replace function app.promover_candidato(
  p_candidate_id   uuid,
  p_stage_id       int  default null,
  p_owner_id       uuid default null,
  p_next_action    text default null,
  p_next_action_at timestamptz default null,
  p_category_id    int  default null,
  p_batch_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c        public.supplier_candidates;
  v_cat      int;
  v_grupo    text;
  v_slug     text;
  v_kind     app.org_kind;
  v_pipeline int;
  v_stage    int := p_stage_id;
  v_org      uuid;
  v_deal     uuid;
  v_tier     text;
  v_fonte    record;
  v_owner    uuid := coalesce(p_owner_id, auth.uid());
  v_quem     text;
  v_sug      jsonb;
  v_motivo   text;
begin
  select * into v_c from public.supplier_candidates where id = p_candidate_id for update;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'candidato_inexistente');
  end if;

  -- Idempotência: promover duas vezes devolve a MESMA organização. É o que
  -- separa "o worker reprocessou a captura" de "a base ganhou uma ficha dupla".
  if v_c.status = 'aprovado' and v_c.organization_id is not null then
    return jsonb_build_object('ok', true, 'status', 'aprovado', 'ja_estava', true,
                              'organization_id', v_c.organization_id,
                              'deal_id', (select d.id from public.deals d
                                           where d.organization_id = v_c.organization_id
                                           order by d.created_at limit 1));
  end if;
  if v_c.status <> 'novo' then
    return jsonb_build_object('ok', false, 'reason', 'ja_revisado', 'status', v_c.status);
  end if;
  -- Suprimido não vira alvo, em nenhum modo (RF-RAD-09, guardrail do CLAUDE.md).
  if v_c.do_not_contact then
    return jsonb_build_object('ok', false, 'reason', 'candidato_nao_contatar');
  end if;

  v_cat := coalesce(p_category_id, v_c.category_id);
  if v_cat is null then
    return jsonb_build_object('ok', false, 'reason', 'categoria_obrigatoria');
  end if;
  select c.group, c.slug into v_grupo, v_slug
    from public.categories c where c.id = v_cat and c.is_active;
  if v_grupo is null then
    return jsonb_build_object('ok', false, 'reason', 'categoria_invalida');
  end if;
  v_kind := case
              when v_slug = 'cerimonialistas_assessorias' then 'cerimonialista'
              when v_grupo = 'producao' then 'produtor'
              when v_grupo = 'locais'   then 'espaco'
              else 'fornecedor'
            end::app.org_kind;

  -- Bloqueio: exatamente as quatro chaves que são índice único parcial.
  select o.id,
         case when v_c.cnpj is not null and o.cnpj = v_c.cnpj then 'cnpj'
              when v_c.place_id is not null and o.place_id = v_c.place_id then 'place_id'
              when v_c.instagram_handle is not null and o.instagram_handle = v_c.instagram_handle then 'instagram'
              else 'phone' end
    into v_org, v_motivo
    from public.organizations o
   where o.deleted_at is null
     and ((v_c.cnpj is not null and o.cnpj = v_c.cnpj)
       or (v_c.phone_e164 is not null and o.phone_e164 = v_c.phone_e164)
       or (v_c.instagram_handle is not null and o.instagram_handle = v_c.instagram_handle)
       or (v_c.place_id is not null and o.place_id = v_c.place_id))
   limit 1;
  if v_org is not null then
    return jsonb_build_object('ok', false, 'reason', 'ja_existe_na_base',
                              'organization_id', v_org, 'chave', v_motivo);
  end if;

  -- Explicação (as sete chaves do RF-BAS-08), para quem revisa e para o log.
  select coalesce(jsonb_agg(jsonb_build_object('organization_id', m.organization_id,
                                               'confidence', m.confidence, 'reason', m.reason)
                            order by m.confidence desc), '[]'::jsonb)
    into v_sug
    from app.find_org_matches(jsonb_build_object(
           'name', v_c.name, 'cnpj', v_c.cnpj, 'phone_e164', v_c.phone_e164,
           'instagram_handle', v_c.instagram_handle, 'website', v_c.website_domain,
           'place_id', v_c.place_id, 'city_id', v_c.city_id,
           'neighborhood', v_c.neighborhood, 'category_id', v_cat)) m;

  select p.id into v_pipeline from public.pipelines p
   where p.slug = case when v_kind in ('produtor','cerimonialista') then 'produtor' else 'fornecedor' end;
  if v_stage is null then
    select st.id into v_stage from public.stages st
     where st.pipeline_id = v_pipeline and not st.is_lost and not st.is_won
     order by st.position limit 1;
  end if;
  if v_stage is null then
    raise exception 'Funil sem etapas cadastradas: aplique a seed (pipelines/stages)' using errcode = 'P0001';
  end if;

  select s.id, s.kind, s.slug into v_fonte from public.sources s where s.id = v_c.source_id;
  v_tier := coalesce(v_c.tier, case when v_fonte.kind = 'referral' then 'A+' end);
  select pr.full_name into v_quem from public.profiles pr where pr.id = v_owner;

  insert into public.organizations
    (kind, name, legal_name, cnpj, phone_e164, email, instagram_handle, website,
     place_id, city_id, neighborhood, address, rating, reviews_count,
     source_id, source_url, collected_at, collector, owner_id, is_natural_person,
     import_batch_id)
  values
    (v_kind, v_c.name, v_c.legal_name, v_c.cnpj, v_c.phone_e164, v_c.email,
     v_c.instagram_handle, v_c.website, v_c.place_id, v_c.city_id, v_c.neighborhood,
     v_c.address, v_c.rating, v_c.reviews_count,
     v_c.source_id, v_c.source_url, v_c.collected_at,
     coalesce(v_c.collector, 'radar'), v_owner, v_c.is_natural_person,
     coalesce(p_batch_id, v_c.import_batch_id))
  returning id into v_org;

  insert into public.organization_categories (organization_id, category_id, is_primary)
  values (v_org, v_cat, true)
  on conflict do nothing;

  insert into public.deals
    (organization_id, pipeline_id, stage_id, owner_id, source_id, tier,
     next_action, next_action_at, import_batch_id)
  values
    (v_org, v_pipeline, v_stage, v_owner, v_c.source_id, v_tier,
     coalesce(nullif(trim(coalesce(p_next_action, '')), ''), 'Primeiro contato'),
     coalesce(p_next_action_at,
              ((app.next_business_day((now() at time zone 'America/Fortaleza')::date) + time '09:00')
               at time zone 'America/Fortaleza')),
     coalesce(p_batch_id, v_c.import_batch_id))
  returning id into v_deal;

  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('system', v_org, v_deal, v_owner, 'system',
          'Aprovado na fila do Radar por ' || coalesce(v_quem, 'revisor'),
          jsonb_build_object('origin', 'radar_approve', 'candidate_id', v_c.id,
                             'source_slug', v_fonte.slug, 'batch_id', coalesce(p_batch_id, v_c.import_batch_id)));

  update public.supplier_candidates
     set status = 'aprovado', organization_id = v_org, category_id = v_cat, kind = v_kind,
         reviewed_by = coalesce(auth.uid(), v_owner), reviewed_at = now(),
         import_batch_id = coalesce(import_batch_id, p_batch_id)
   where id = p_candidate_id;

  -- A proveniência acompanha a ficha: sem isto, o titular pergunta "de onde
  -- veio o meu número?" e a resposta morre no candidato, que a retenção apaga.
  insert into public.field_provenance
    (record_type, record_id, field, source_id, source_url, batch_id, collected_at,
     collector, tool, action, reason, legal_basis, lia_version)
  select 'organization', v_org, fp.field, fp.source_id, fp.source_url, fp.batch_id,
         fp.collected_at, fp.collector, fp.tool, fp.action, fp.reason, fp.legal_basis, fp.lia_version
    from public.field_provenance fp
   where fp.record_type = 'supplier_candidate' and fp.record_id = v_c.id;

  return jsonb_build_object('ok', true, 'status', 'aprovado',
                            'organization_id', v_org, 'deal_id', v_deal,
                            'sugestoes', v_sug);
end $$;
comment on function app.promover_candidato(uuid,int,uuid,text,timestamptz,int,uuid) is
  'Caminho único de promoção candidato → organização + negócio. Dedup do RF-BAS-08 refeita DENTRO da transação (sonda das quatro chaves únicas para bloquear, app.find_org_matches ao lado para explicar). Idempotente: promover duas vezes devolve a mesma organização.';


-- ---------------------------------------------------------------------------
-- 14. Candidato → ficha existente: `app.mesclar_candidato`
-- ---------------------------------------------------------------------------
-- COMPLETA, nunca sobrescreve (RF-RAD-08): o que o fornecedor já confirmou vale
-- mais que o que uma fonte pública diz. O que a fonte trouxe e não entrou fica
-- registrado como 'preservado' — é isso que sustenta a regra de sobrevivência
-- de campos, e é a única forma de explicar depois por que o telefone da ficha
-- não é o telefone da fonte.
create or replace function app.mesclar_candidato(
  p_candidate_id    uuid,
  p_organization_id uuid,
  p_category_id     int  default null,
  p_reason          text default null,
  p_batch_id        uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c   public.supplier_candidates;
  v_o   public.organizations;
  v_cat int;
  v_uid uuid := auth.uid();
begin
  select * into v_c from public.supplier_candidates where id = p_candidate_id for update;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'candidato_inexistente');
  end if;
  if v_c.status = 'mesclado' and v_c.organization_id = p_organization_id then
    return jsonb_build_object('ok', true, 'status', 'mesclado', 'ja_estava', true,
                              'organization_id', p_organization_id);
  end if;
  if v_c.status <> 'novo' then
    return jsonb_build_object('ok', false, 'reason', 'ja_revisado', 'status', v_c.status);
  end if;
  if v_c.do_not_contact then
    return jsonb_build_object('ok', false, 'reason', 'candidato_nao_contatar');
  end if;

  select * into v_o from public.organizations
   where id = p_organization_id and deleted_at is null;
  if v_o.id is null then
    return jsonb_build_object('ok', false, 'reason', 'organizacao_inexistente');
  end if;

  update public.organizations o
     set legal_name       = coalesce(o.legal_name, v_c.legal_name),
         cnpj             = coalesce(o.cnpj, v_c.cnpj),
         phone_e164       = coalesce(o.phone_e164, v_c.phone_e164),
         email            = coalesce(o.email, v_c.email),
         instagram_handle = coalesce(o.instagram_handle, v_c.instagram_handle),
         website          = coalesce(o.website, v_c.website),
         place_id         = coalesce(o.place_id, v_c.place_id),
         city_id          = coalesce(o.city_id, v_c.city_id),
         neighborhood     = coalesce(o.neighborhood, v_c.neighborhood),
         address          = coalesce(o.address, v_c.address),
         source_url       = coalesce(o.source_url, v_c.source_url)
   where o.id = p_organization_id;

  -- Um registro por campo que a fonte trouxe: 'gravado' quando entrou (a ficha
  -- estava vazia), 'preservado' quando não entrou porque já havia valor — e aí
  -- só o HASH do que foi recusado, nunca o valor.
  perform app.registrar_proveniencia(
            'organization', p_organization_id, f.campo,
            case when f.antes is null then 'gravado' else 'preservado' end,
            v_c.source_id, v_c.source_url, coalesce(p_batch_id, v_c.import_batch_id),
            v_c.collector, 'mesclagem do Radar',
            case when f.antes is null then null else f.valor end,
            case when f.antes is null then null else 'campo_ja_preenchido' end,
            v_c.collected_at)
    from (values ('legal_name', v_c.legal_name, v_o.legal_name),
                 ('cnpj', v_c.cnpj, v_o.cnpj),
                 ('phone_e164', v_c.phone_e164, v_o.phone_e164),
                 ('email', v_c.email::text, v_o.email::text),
                 ('instagram_handle', v_c.instagram_handle, v_o.instagram_handle),
                 ('website', v_c.website, v_o.website),
                 ('place_id', v_c.place_id, v_o.place_id),
                 ('neighborhood', v_c.neighborhood, v_o.neighborhood),
                 ('address', v_c.address, v_o.address)) as f(campo, valor, antes)
   where f.valor is not null;

  v_cat := coalesce(p_category_id, v_c.category_id);
  if v_cat is not null then
    insert into public.organization_categories (organization_id, category_id, is_primary)
    values (p_organization_id, v_cat, false)
    on conflict do nothing;
  end if;

  insert into public.activities (type, organization_id, user_id, author_kind, body, metadata)
  values ('system', p_organization_id, v_uid, 'system',
          'Candidato do Radar mesclado nesta ficha: ' || v_c.name,
          jsonb_build_object('origin', 'radar_merge', 'candidate_id', v_c.id,
                             'source_id', v_c.source_id));

  update public.supplier_candidates
     set status = 'mesclado', organization_id = p_organization_id,
         review_reason = nullif(trim(coalesce(p_reason, '')), ''),
         reviewed_by = v_uid, reviewed_at = now(),
         import_batch_id = coalesce(import_batch_id, p_batch_id)
   where id = p_candidate_id;

  return jsonb_build_object('ok', true, 'status', 'mesclado',
                            'organization_id', p_organization_id);
end $$;
comment on function app.mesclar_candidato(uuid,uuid,int,text,uuid) is
  'Mescla o candidato numa ficha existente COMPLETANDO campo vazio, nunca sobrescrevendo (RF-RAD-08). O que a fonte trouxe e não entrou fica em field_provenance como "preservado", com o hash do valor recusado.';


-- ---------------------------------------------------------------------------
-- 15. Recusar: `app.recusar_candidato`
-- ---------------------------------------------------------------------------
create or replace function app.recusar_candidato(
  p_candidate_id  uuid,
  p_reason        text,
  p_nao_contatar  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.supplier_candidates;
begin
  select * into v_c from public.supplier_candidates where id = p_candidate_id for update;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'candidato_inexistente');
  end if;
  if v_c.status = 'recusado' then
    return jsonb_build_object('ok', true, 'status', 'recusado', 'ja_estava', true,
                              'nao_contatar', v_c.do_not_contact);
  end if;
  if v_c.status <> 'novo' then
    return jsonb_build_object('ok', false, 'reason', 'ja_revisado', 'status', v_c.status);
  end if;
  -- Recusar sem motivo escrito não é decisão, é sumiço.
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'motivo_obrigatorio');
  end if;

  update public.supplier_candidates
     set status = 'recusado',
         review_reason = trim(p_reason),
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         do_not_contact = do_not_contact or coalesce(p_nao_contatar, false)
   where id = p_candidate_id;

  return jsonb_build_object('ok', true, 'status', 'recusado',
                            'nao_contatar', coalesce(p_nao_contatar, false));
end $$;
comment on function app.recusar_candidato(uuid,text,boolean) is
  'Recusa o candidato com motivo escrito obrigatório e, quando pedido, marca "não contatar". Idempotente.';

revoke all on function app.promover_candidato(uuid,int,uuid,text,timestamptz,int,uuid) from public, anon, authenticated;
revoke all on function app.mesclar_candidato(uuid,uuid,int,text,uuid) from public, anon, authenticated;
revoke all on function app.recusar_candidato(uuid,text,boolean) from public, anon, authenticated;
grant execute on function app.promover_candidato(uuid,int,uuid,text,timestamptz,int,uuid) to service_role;
grant execute on function app.mesclar_candidato(uuid,uuid,int,text,uuid) to service_role;
grant execute on function app.recusar_candidato(uuid,text,boolean) to service_role;


-- ---------------------------------------------------------------------------
-- 16. `public.radar_revisar_candidato` vira despachante
-- ---------------------------------------------------------------------------
-- Mesma assinatura, mesmos retornos, mesma tela: o que muda é que a decisão da
-- fila e a decisão do worker passam pela MESMA função. O teste 14 (69 asserções)
-- é o contrato desta refatoração — se ele passar, a tela não sentiu nada.
-- O que fica AQUI e não desce para as funções de `app`: as checagens de papel e
-- de carteira, que dependem do JWT. O worker roda sem JWT e não pode herdá-las.
create or replace function public.radar_revisar_candidato(
  p_candidate_id   uuid,
  p_acao           text,
  p_organization_id uuid default null,
  p_category_id    int  default null,
  p_reason         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_c   public.supplier_candidates;
  v_res jsonb;
  v_org uuid;
begin
  if v_uid is null or not app.can_write() then
    raise exception 'Papel % não revisa a fila do Radar', app.role() using errcode = '42501';
  end if;

  select * into v_c from public.supplier_candidates where id = p_candidate_id;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'candidato_inexistente');
  end if;
  if v_c.status <> 'novo' then
    return jsonb_build_object('ok', false, 'reason', 'ja_revisado', 'status', v_c.status);
  end if;

  -- ---------------- recusar / não contatar ----------------
  if p_acao in ('recusar', 'nao_contatar') then
    return app.recusar_candidato(p_candidate_id, p_reason, p_acao = 'nao_contatar');
  end if;

  if p_acao not in ('aprovar', 'mesclar') then
    return jsonb_build_object('ok', false, 'reason', 'acao_invalida');
  end if;

  -- Um candidato marcado "não contatar" (supressão, RF-RAD-09) não vira alvo.
  if v_c.do_not_contact then
    return jsonb_build_object('ok', false, 'reason', 'candidato_nao_contatar');
  end if;

  -- ---------------- mesclar com ficha existente ----------------
  if p_acao = 'mesclar' then
    if p_organization_id is null then
      return jsonb_build_object('ok', false, 'reason', 'organizacao_obrigatoria');
    end if;
    if not exists (select 1 from public.organizations o
                    where o.id = p_organization_id and o.deleted_at is null) then
      return jsonb_build_object('ok', false, 'reason', 'organizacao_inexistente');
    end if;
    -- Regra de carteira: só quem pode editar a ficha pode receber dado nela.
    if not app.org_is_editable(p_organization_id) then
      return jsonb_build_object('ok', false, 'reason', 'organizacao_fora_da_carteira');
    end if;
    return app.mesclar_candidato(p_candidate_id, p_organization_id, p_category_id,
                                 p_reason, v_c.import_batch_id);
  end if;

  -- ---------------- aprovar ----------------
  v_res := app.promover_candidato(p_candidate_id, null, v_uid, null, null,
                                  p_category_id, v_c.import_batch_id);

  -- A ficha suspeita existe, mas pode ser de carteira alheia: o id só sai daqui
  -- para quem já poderia abri-la. Quem não pode continua sabendo que existe.
  if coalesce((v_res ->> 'ok')::boolean, false) = false
     and v_res ->> 'reason' = 'ja_existe_na_base' then
    v_org := (v_res ->> 'organization_id')::uuid;
    return jsonb_build_object('ok', false, 'reason', 'ja_existe_na_base',
                              'organization_id',
                              case when app.org_is_visible(v_org) then v_org end);
  end if;

  if coalesce((v_res ->> 'ok')::boolean, false) and nullif(trim(coalesce(p_reason, '')), '') is not null then
    update public.supplier_candidates set review_reason = trim(p_reason) where id = p_candidate_id;
  end if;

  return v_res;
end $$;
comment on function public.radar_revisar_candidato(uuid,text,uuid,int,text) is
  'Decisão da fila do Radar (RF-RAD-11). Desde a migração 001600 é um despachante fino sobre app.recusar_candidato, app.mesclar_candidato e app.promover_candidato — as mesmas funções que o worker chama (ADR-08, caminho único de escrita). As checagens de papel e de carteira ficam aqui, porque dependem do JWT.';

revoke all on function public.radar_revisar_candidato(uuid,text,uuid,int,text) from public;
grant execute on function public.radar_revisar_candidato(uuid,text,uuid,int,text) to authenticated;


-- ---------------------------------------------------------------------------
-- 17. As filas (ADR-11): `pgmq` + chave de idempotência própria
-- ---------------------------------------------------------------------------
-- Quatro filas, uma por etapa da esteira, para que um lote de páginas travado
-- não segure a normalização de registros que já chegaram:
--   ingest_jobs    — "colete a categoria X da fonte Y" (planeja, gera páginas)
--   ingest_pages   — "busque esta URL" (respeita rate_limit_seconds da fonte)
--   ingest_records — "normalize e resolva esta captura"
--   ingest_dlq     — o que falhou N vezes; ninguém consome sozinho, é leitura humana
create table if not exists public.ingest_queues (
  name                text primary key,
  visibility_seconds  int  not null check (visibility_seconds between 5 and 3600),
  max_attempts        int  not null default 5 check (max_attempts between 1 and 20),
  description         text
);
comment on table public.ingest_queues is
  'Configuração das filas pgmq da esteira: visibility timeout dimensionado pelo trabalho real e teto de tentativas antes da dead-letter (ADR-11).';

insert into public.ingest_queues (name, visibility_seconds, max_attempts, description) values
  ('ingest_jobs',    600, 3, 'Planeja uma coleta: lê o catálogo da fonte e enfileira as páginas. Minutos, não segundos.'),
  ('ingest_pages',   180, 5, 'Busca uma página ou objeto de API. Cabe o rate limit da fonte (até 10 s por requisição) mais o parse.'),
  ('ingest_records',  90, 5, 'Normaliza a captura e resolve o candidato. Trabalho de banco, curto.'),
  ('ingest_dlq',    3600, 1, 'Dead-letter: o que falhou além do teto. Ninguém consome automaticamente — é leitura humana.')
on conflict (name) do update
  set visibility_seconds = excluded.visibility_seconds,
      max_attempts       = excluded.max_attempts,
      description        = excluded.description;

do $$
declare
  q text;
begin
  for q in select name from public.ingest_queues loop
    if not exists (select 1 from pgmq.list_queues() lq where lq.queue_name = q) then
      perform pgmq.create(q);
    end if;
  end loop;
end $$;

-- O livro-caixa da idempotência. `pgmq` garante entrega ao menos uma vez; quem
-- garante EXATAMENTE UMA é esta tabela, com a chave que quem enfileira escolhe
-- (a URL do lote, o id externo do registro). Sem ela, uma reentrega no meio de
-- uma queda de rede vira uma segunda organização.
create table if not exists public.ingest_dedup (
  queue            text not null references public.ingest_queues (name) on delete cascade,
  idempotency_key  text not null,
  msg_id           bigint,
  batch_id         uuid references public.import_batches (id) on delete cascade,
  attempts         int  not null default 0,
  last_error       text,
  first_seen_at    timestamptz not null default now(),
  processed_at     timestamptz,
  primary key (queue, idempotency_key)
);
comment on table public.ingest_dedup is
  'Chave de idempotência de cada mensagem da esteira. pgmq entrega ao menos uma vez; é esta tabela que faz o efeito acontecer exatamente uma.';
create index if not exists ingest_dedup_batch_idx on public.ingest_dedup (batch_id);
create index if not exists ingest_dedup_pend_idx  on public.ingest_dedup (queue, processed_at) where processed_at is null;

-- Enfileirar. Devolve `enfileirado = false` quando a chave já existe: não é erro,
-- é a esteira funcionando.
create or replace function app.esteira_enfileirar(
  p_queue text, p_payload jsonb, p_key text,
  p_batch_id uuid default null, p_delay int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg bigint;
  v_ok  boolean;
begin
  if not exists (select 1 from public.ingest_queues q where q.name = p_queue) then
    raise exception 'Fila % não existe na esteira', p_queue using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_key, '')), '') is null then
    raise exception 'Mensagem sem chave de idempotência não entra na esteira' using errcode = '22023';
  end if;

  insert into public.ingest_dedup (queue, idempotency_key, batch_id)
  values (p_queue, p_key, p_batch_id)
  on conflict (queue, idempotency_key) do nothing;
  v_ok := found;

  if not v_ok then
    -- A chave já existe. Só um caso não é duplicata: a linha nasceu e o `send`
    -- não chegou a acontecer (queda entre as duas instruções). Aí a mensagem
    -- some sem nunca ter existido, e a chave a bloqueia para sempre — então
    -- este é o único caminho de recuperação.
    if not exists (select 1 from public.ingest_dedup d
                    where d.queue = p_queue and d.idempotency_key = p_key
                      and d.msg_id is null and d.processed_at is null) then
      return jsonb_build_object('enfileirado', false, 'motivo', 'ja_enfileirado');
    end if;
  end if;

  select s into v_msg from pgmq.send(p_queue, p_payload, greatest(coalesce(p_delay, 0), 0)) s;
  update public.ingest_dedup
     set msg_id = v_msg
   where queue = p_queue and idempotency_key = p_key;

  return jsonb_build_object('enfileirado', true, 'msg_id', v_msg);
end $$;
comment on function app.esteira_enfileirar(text,jsonb,text,uuid,int) is
  'Enfileira uma mensagem com chave de idempotência. A mesma chave nunca entra duas vezes na mesma fila (ADR-11).';

-- Ler com o visibility timeout configurado para o trabalho daquela fila.
create or replace function app.esteira_ler(p_queue text, p_qty int default 1)
returns setof pgmq.message_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vt int;
begin
  select q.visibility_seconds into v_vt from public.ingest_queues q where q.name = p_queue;
  if v_vt is null then
    raise exception 'Fila % não existe na esteira', p_queue using errcode = '22023';
  end if;
  return query select * from pgmq.read(p_queue, v_vt, least(greatest(coalesce(p_qty, 1), 1), 100));
end $$;

-- Concluir: arquiva a mensagem e fecha a chave. A chave FICA (não é apagada):
-- é ela que impede o reprocessamento de uma mensagem já consumida.
create or replace function app.esteira_concluir(p_queue text, p_msg_id bigint, p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ingest_dedup
     set processed_at = now(), last_error = null
   where queue = p_queue and idempotency_key = p_key;
  return pgmq.archive(p_queue, p_msg_id);
end $$;

-- Falhar: backoff exponencial por `pgmq.set_vt` até o teto da fila; depois disso
-- a mensagem vai para a dead-letter com o erro junto e sai da fila de origem.
-- Um item que fica girando para sempre é pior que um item que para: o que para
-- alguém lê.
create or replace function app.esteira_falhar(p_queue text, p_msg_id bigint, p_key text, p_erro text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int;
  v_n   int;
  v_vt  int;
  v_msg jsonb;
begin
  select q.max_attempts into v_max from public.ingest_queues q where q.name = p_queue;
  if v_max is null then
    raise exception 'Fila % não existe na esteira', p_queue using errcode = '22023';
  end if;

  update public.ingest_dedup
     set attempts = attempts + 1, last_error = left(coalesce(p_erro, ''), 2000)
   where queue = p_queue and idempotency_key = p_key
  returning attempts into v_n;
  v_n := coalesce(v_n, v_max);

  if v_n < v_max then
    v_vt := least(30 * power(2, v_n - 1)::int, 3600);          -- 30 s, 60 s, 120 s… teto de 1 h
    perform pgmq.set_vt(p_queue, p_msg_id, v_vt);
    return jsonb_build_object('acao', 'reagendado', 'tentativa', v_n, 'em_segundos', v_vt);
  end if;

  -- A mensagem é lida da tabela da fila pelo id: `pgmq.read` entrega "a próxima
  -- visível", que não é necessariamente esta.
  execute format('select message from pgmq.%I where msg_id = $1', 'q_' || p_queue)
    into v_msg using p_msg_id;
  perform app.esteira_enfileirar(
            'ingest_dlq',
            jsonb_build_object('fila_de_origem', p_queue, 'msg_id', p_msg_id,
                               'idempotency_key', p_key, 'erro', left(coalesce(p_erro, ''), 2000),
                               'tentativas', v_n, 'em', now(), 'mensagem', v_msg),
            p_queue || ':' || p_key);
  perform pgmq.archive(p_queue, p_msg_id);
  update public.ingest_dedup set processed_at = now()
   where queue = p_queue and idempotency_key = p_key;
  return jsonb_build_object('acao', 'dead_letter', 'tentativa', v_n);
end $$;
comment on function app.esteira_falhar(text,bigint,text,text) is
  'Retry com backoff exponencial (30 s dobrando, teto de 1 h) por pgmq.set_vt; passado o teto de tentativas da fila, a mensagem vai para ingest_dlq com o erro e sai da fila de origem.';


-- ---------------------------------------------------------------------------
-- 18. Batida de ponto e saúde da esteira
-- ---------------------------------------------------------------------------
create or replace function public.esteira_bater_ponto(
  p_worker    text,
  p_instance  text default 'default',
  p_status    text default 'ok',
  p_queue     text default null,
  p_host      text default null,
  p_version   text default null,
  p_processed bigint default 0,
  p_failed    bigint default 0,
  p_details   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novo boolean;
begin
  insert into public.worker_heartbeats
    (worker, instance, host, version, status, queue, last_beat_at,
     processed_total, failed_total, details)
  values
    (p_worker, coalesce(nullif(trim(p_instance), ''), 'default'), p_host, p_version,
     coalesce(p_status, 'ok'), p_queue, now(),
     greatest(coalesce(p_processed, 0), 0), greatest(coalesce(p_failed, 0), 0),
     coalesce(p_details, '{}'::jsonb))
  on conflict (worker, instance) do update
    set host = coalesce(excluded.host, public.worker_heartbeats.host),
        version = coalesce(excluded.version, public.worker_heartbeats.version),
        status = excluded.status,
        queue = excluded.queue,
        last_beat_at = now(),
        processed_total = excluded.processed_total,
        failed_total = excluded.failed_total,
        details = excluded.details
  returning (xmax = 0) into v_novo;

  return jsonb_build_object('ok', true, 'novo', v_novo, 'em', now());
end $$;
comment on function public.esteira_bater_ponto(text,text,text,text,text,text,bigint,bigint,jsonb) is
  'Batida de ponto do worker (ADR-04). O Radar lê worker_heartbeats para distinguir "fila vazia" de "coletor desligado".';

-- O que a tela do Radar precisa saber em uma consulta: quem está vivo, quanto
-- tem parado em cada fila e o que já morreu na dead-letter.
create or replace function public.esteira_saude()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workers jsonb;
  v_filas   jsonb := '[]'::jsonb;
  v_q       record;
  v_m       record;
begin
  if not app.can_write() then
    raise exception 'Papel % não lê a saúde da esteira', app.role() using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'worker', h.worker, 'instancia', h.instance, 'status', h.status,
           'fila', h.queue, 'versao', h.version, 'host', h.host,
           'ultima_batida', h.last_beat_at,
           'ha_segundos', floor(extract(epoch from (now() - h.last_beat_at)))::int,
           -- Dois minutos sem batida com a batida esperada a cada 30 s: é parado,
           -- não é lento. A tela precisa de um veredito, não de um timestamp.
           'vivo', (now() - h.last_beat_at) < interval '2 minutes',
           'processados', h.processed_total, 'falhas', h.failed_total)
           order by h.worker, h.instance), '[]'::jsonb)
    into v_workers
    from public.worker_heartbeats h;

  for v_q in select name from public.ingest_queues order by name loop
    select * into v_m from pgmq.metrics(v_q.name);
    v_filas := v_filas || jsonb_build_array(jsonb_build_object(
      'fila', v_q.name,
      'na_fila', coalesce(v_m.queue_length, 0),
      'visiveis', coalesce(v_m.queue_visible_length, 0),
      'mais_antigo_segundos', v_m.oldest_msg_age_sec,
      'total_ja_enfileirado', coalesce(v_m.total_messages, 0)));
  end loop;

  return jsonb_build_object(
    'workers', v_workers,
    'filas', v_filas,
    'coletor_vivo', exists (select 1 from public.worker_heartbeats h
                             where h.worker = 'ingest' and h.status = 'ok'
                               and (now() - h.last_beat_at) < interval '2 minutes'),
    'lotes_rodando', (select count(*) from public.import_batches b where b.status = 'rodando'),
    'capturas_por_expurgar', (select count(*) from public.raw_capture rc
                               where rc.purge_after < (now() at time zone 'America/Fortaleza')::date),
    'registros_por_resolver', (select count(*) from public.source_record sr where sr.candidate_id is null),
    'ultimo_expurgo', (select r.ran_at from public.retention_runs r order by r.ran_at desc limit 1)
  );
end $$;


-- ---------------------------------------------------------------------------
-- 19. As bocas da esteira (o que o worker e o importador chamam)
-- ---------------------------------------------------------------------------
create or replace function public.esteira_abrir_lote(
  p_kind         text,
  p_source_id    int,
  p_label        text,
  p_params       jsonb default '{}'::jsonb,
  p_license_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_s  public.sources;
begin
  -- Sem JWT (worker/service_role) passa; com JWT, só quem escreve na base.
  if nullif(current_setting('request.jwt.claims', true), '') is not null and not app.can_write() then
    raise exception 'Papel % não abre lote de ingestão', app.role() using errcode = '42501';
  end if;
  select * into v_s from public.sources where id = p_source_id;
  if v_s.id is null then
    return jsonb_build_object('ok', false, 'reason', 'origem_invalida');
  end if;
  -- Coleta só de fonte ligada, e ligar exige robots.txt e termos avaliados
  -- (RF-RAD-01, garantido por public.radar_alternar_fonte). Planilha não depende
  -- disso: quem digitou responde pelo que trouxe.
  if p_kind = 'coleta' and not v_s.is_enabled then
    return jsonb_build_object('ok', false, 'reason', 'origem_desabilitada');
  end if;

  insert into public.import_batches (kind, source_id, label, params, triggered_by, license_path, status)
  values (p_kind, p_source_id, p_label, coalesce(p_params, '{}'::jsonb), auth.uid(),
          nullif(trim(coalesce(p_license_path, '')), ''), 'previa')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'batch_id', v_id);
end $$;

-- Grava a captura de forma idempotente. Devolve `novo = false` quando a fonte
-- entregou exatamente o mesmo conteúdo de antes — que é o caso comum de uma
-- recoleta mensal, e não pode virar linha nova nem candidato novo.
create or replace function public.esteira_gravar_captura(
  p_batch_id    uuid,
  p_source_id   int,
  p_payload     jsonb,
  p_external_id text default null,
  p_source_url  text default null,
  p_http_status int  default null,
  p_collector   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_hash text := app.payload_hash(p_payload);
begin
  if not app.payload_e_permitido(p_payload) then
    -- A recusa é explícita e legível: o worker precisa saber que trouxe campo
    -- fora da whitelist, e não descobrir isso como "erro de constraint".
    return jsonb_build_object('ok', false, 'reason', 'campo_fora_da_whitelist');
  end if;

  select rc.id into v_id from public.raw_capture rc
   where rc.source_id = p_source_id and rc.content_hash = v_hash;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'novo', false, 'raw_capture_id', v_id,
                              'reason', 'conteudo_identico');
  end if;

  insert into public.raw_capture
    (batch_id, source_id, external_id, source_url, http_status, collector, payload)
  values
    (p_batch_id, p_source_id, p_external_id, p_source_url, p_http_status,
     coalesce(p_collector, 'KomuneBot/1.0'), p_payload)
  on conflict (batch_id, request_key) do nothing
  returning id into v_id;

  if v_id is null then
    select rc.id into v_id from public.raw_capture rc
     where rc.batch_id = p_batch_id
       and rc.request_key = app.sha256_hex(p_source_id::text || '|' ||
                                           coalesce(nullif(trim(coalesce(p_source_url, '')), ''),
                                                    nullif(trim(coalesce(p_external_id, '')), ''), ''));
    return jsonb_build_object('ok', true, 'novo', false, 'raw_capture_id', v_id,
                              'reason', 'pedido_repetido');
  end if;

  return jsonb_build_object('ok', true, 'novo', true, 'raw_capture_id', v_id);
end $$;

-- Mapa "categoria da fonte" → categoria do CRM. Nasce vazio: cada fonte que for
-- ligada traz o seu mapa, e categoria não mapeada não vira palpite — vira nulo,
-- e a fila de revisão pergunta.
create table if not exists public.source_category_map (
  source_id       int  not null references public.sources (id) on delete cascade,
  category_source text not null,
  category_id     int  not null references public.categories (id) on delete cascade,
  primary key (source_id, category_source)
);
comment on table public.source_category_map is
  'Mapa da categoria da fonte (slug do Casamentos, CNAE, tipo do Places) para a categoria do CRM. Sem mapa, category_id fica nulo e quem revisa escolhe.';

-- Captura → registro normalizado → candidato, numa transação só.
create or replace function public.esteira_processar_captura(p_raw_capture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rc    public.raw_capture;
  v_p     jsonb;
  v_id    uuid;
  v_hash  text;
  v_antes text;
  v_ext   text;
  v_city  int;
  v_cat   int;
  v_tel   text;
begin
  select * into v_rc from public.raw_capture where id = p_raw_capture_id;
  if v_rc.id is null then
    return jsonb_build_object('ok', false, 'reason', 'captura_inexistente');
  end if;
  v_p := v_rc.payload;

  -- Identidade do registro na fonte: o id externo da captura, e na falta dele o
  -- que a fonte usa como identidade (CNPJ, place_id, @). Sem identidade não há
  -- como reconhecer o mesmo fornecedor na próxima coleta.
  v_ext := coalesce(v_rc.external_id, v_p ->> 'place_id',
                    app.normalize_cnpj(v_p ->> 'cnpj'),
                    app.normalize_instagram(v_p ->> 'instagram'),
                    v_rc.source_url);
  if v_ext is null then
    return jsonb_build_object('ok', false, 'reason', 'sem_identidade_na_fonte');
  end if;

  select c.id into v_city
    from public.cities c
   where app.search_name(c.name) = app.search_name(v_p ->> 'cidade')
   limit 1;
  select m.category_id into v_cat
    from public.source_category_map m
   where m.source_id = v_rc.source_id
     and m.category_source = lower(trim(coalesce(v_p ->> 'categoria_origem', '')))
   limit 1;

  -- O telefone principal é o primeiro que normaliza. Todos ficam em `phones`.
  select app.normalize_phone_br(t) into v_tel
    from jsonb_array_elements_text(
           case when jsonb_typeof(v_p -> 'telefones') = 'array' then v_p -> 'telefones'
                else '[]'::jsonb end) t
   where app.normalize_phone_br(t) is not null
   limit 1;

  v_hash := app.payload_hash(v_p);

  select sr.id, sr.content_hash into v_id, v_antes
    from public.source_record sr
   where sr.source_id = v_rc.source_id and sr.external_id = v_ext;

  if v_id is null then
    insert into public.source_record
      (raw_capture_id, batch_id, source_id, external_id, source_url,
       name, legal_name, cnpj, phone_e164, phones, email, instagram_handle, website,
       place_id, city_id, neighborhood, address, cep, category_source, category_id,
       rating, reviews_count, price_from, capacity_max, photos_count,
       opened_at, is_mei, registry_status, content_hash)
    values
      (v_rc.id, v_rc.batch_id, v_rc.source_id, v_ext, coalesce(v_rc.source_url, v_p ->> 'source_url'),
       coalesce(v_p ->> 'nome_comercial', v_p ->> 'razao_social'), v_p ->> 'razao_social',
       v_p ->> 'cnpj', v_tel,
       case when jsonb_typeof(v_p -> 'telefones') = 'array' then v_p -> 'telefones' else '[]'::jsonb end,
       nullif(v_p ->> 'email', '')::extensions.citext, v_p ->> 'instagram', v_p ->> 'site',
       v_p ->> 'place_id', v_city, v_p ->> 'bairro', v_p ->> 'endereco', v_p ->> 'cep',
       lower(nullif(trim(coalesce(v_p ->> 'categoria_origem', '')), '')), v_cat,
       nullif(v_p ->> 'nota', '')::numeric, nullif(v_p ->> 'avaliacoes_qtd', '')::int,
       nullif(v_p ->> 'preco_a_partir_de', '')::numeric, nullif(v_p ->> 'capacidade_max', '')::int,
       nullif(v_p ->> 'fotos_qtd', '')::int,
       nullif(v_p ->> 'data_abertura', '')::date,
       nullif(v_p ->> 'mei', '')::boolean, v_p ->> 'situacao_cadastral', v_hash)
    returning id into v_id;
  elsif v_antes = v_hash then
    -- Nada mudou na fonte: só o carimbo de "visto agora". A mensagem é
    -- concluída e o candidato não é tocado.
    update public.source_record set last_seen_at = now(), raw_capture_id = v_rc.id where id = v_id;
    return jsonb_build_object('ok', true, 'mudou', false, 'source_record_id', v_id);
  else
    -- Mudou em campo-chave: o candidato ganha a marca `mudou_na_fonte` e volta
    -- para a fila de quem revisa (situação cadastral baixada, telefone novo).
    update public.source_record sr
       set raw_capture_id = v_rc.id, batch_id = v_rc.batch_id,
           name = coalesce(v_p ->> 'nome_comercial', v_p ->> 'razao_social', sr.name),
           legal_name = coalesce(v_p ->> 'razao_social', sr.legal_name),
           cnpj = coalesce(v_p ->> 'cnpj', sr.cnpj),
           phone_e164 = coalesce(v_tel, sr.phone_e164),
           phones = case when jsonb_typeof(v_p -> 'telefones') = 'array' then v_p -> 'telefones' else sr.phones end,
           email = coalesce(nullif(v_p ->> 'email', '')::extensions.citext, sr.email),
           instagram_handle = coalesce(v_p ->> 'instagram', sr.instagram_handle),
           website = coalesce(v_p ->> 'site', sr.website),
           address = coalesce(v_p ->> 'endereco', sr.address),
           neighborhood = coalesce(v_p ->> 'bairro', sr.neighborhood),
           registry_status = coalesce(v_p ->> 'situacao_cadastral', sr.registry_status),
           rating = coalesce(nullif(v_p ->> 'nota', '')::numeric, sr.rating),
           reviews_count = coalesce(nullif(v_p ->> 'avaliacoes_qtd', '')::int, sr.reviews_count),
           content_hash = v_hash,
           last_seen_at = now(),
           flags = (select coalesce(array_agg(distinct f order by f), '{}')
                      from unnest(sr.flags || array['mudou_na_fonte']) f)
     where sr.id = v_id;
  end if;

  return app.resolver_source_record(v_id) || jsonb_build_object('source_record_id', v_id, 'mudou', true);
end $$;
comment on function public.esteira_processar_captura(uuid) is
  'Captura → source_record (com a higiene do RF-BAS-16 em gatilho) → candidato. Conteúdo idêntico só atualiza last_seen_at; conteúdo mudado marca `mudou_na_fonte` e devolve o candidato à revisão.';

-- ---------------------------------------------------------------------------
-- 20. "De onde vocês tiraram o meu número?" (R06, e um nó do roteiro)
-- ---------------------------------------------------------------------------
-- A KASPR foi multada na França por responder "de fontes públicas". A resposta
-- certa é a URL específica, a data e a ferramenta — e é a mesma frase que a
-- Heloísa precisa ter na mão quando perguntam ao telefone.
create or replace function public.origem_dos_dados(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cand uuid;
begin
  if not app.org_is_visible(p_organization_id) then
    raise exception 'Ficha fora do alcance deste papel' using errcode = '42501';
  end if;

  select c.id into v_cand from public.supplier_candidates c
   where c.organization_id = p_organization_id order by c.created_at limit 1;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'ficha', (select jsonb_build_object('fonte', s.name, 'slug', s.slug,
                                        'url', o.source_url, 'coletado_em', o.collected_at,
                                        'coletor', o.collector, 'base_legal', s.legal_basis,
                                        'lote', o.import_batch_id)
                from public.organizations o
                join public.sources s on s.id = o.source_id
               where o.id = p_organization_id),
    'campos', coalesce((
       select jsonb_agg(jsonb_build_object(
                'campo', fp.field, 'acao', fp.action, 'fonte', s.name,
                'url', fp.source_url, 'coletado_em', fp.collected_at,
                'ferramenta', fp.tool, 'coletor', fp.collector,
                'base_legal', fp.legal_basis, 'motivo', fp.reason)
              order by fp.created_at desc)
         from public.field_provenance fp
         left join public.sources s on s.id = fp.source_id
        where (fp.record_type = 'organization' and fp.record_id = p_organization_id)
           or (v_cand is not null and fp.record_type = 'supplier_candidate' and fp.record_id = v_cand)
    ), '[]'::jsonb));
end $$;
comment on function public.origem_dos_dados(uuid) is
  'Responde "de onde vocês tiraram o meu número?" com a URL específica, a data e a ferramenta, campo a campo (R06 SCR-08; art. 9º da LGPD). Também alimenta o nó de origem do roteiro de ligação.';


-- ---------------------------------------------------------------------------
-- 21. Desfazer o lote (48 h) — RF-BAS-17
-- ---------------------------------------------------------------------------
-- Desfazer só apaga o que o lote CRIOU e ninguém tocou depois: ficha com
-- atividade, negócio que mudou de etapa ou consentimento registrado fica de pé,
-- porque desfazer uma importação não pode apagar uma conversa que aconteceu.
create or replace function public.esteira_desfazer_lote(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b      public.import_batches;
  v_orgs   uuid[];
  v_n_org  int := 0;
  v_n_cand int := 0;
  v_n_deal int := 0;
  v_presos int := 0;
begin
  if not app.is_manager() then
    raise exception 'Papel % não desfaz importação', app.role() using errcode = '42501';
  end if;
  select * into v_b from public.import_batches where id = p_batch_id for update;
  if v_b.id is null then
    return jsonb_build_object('ok', false, 'reason', 'lote_inexistente');
  end if;
  if v_b.status = 'desfeito' then
    return jsonb_build_object('ok', true, 'ja_estava', true);
  end if;
  if now() > v_b.can_undo_until then
    return jsonb_build_object('ok', false, 'reason', 'janela_de_48h_encerrada',
                              'expirou_em', v_b.can_undo_until);
  end if;

  -- Intocadas: sem atividade que não seja a do próprio lote, sem consentimento,
  -- sem mensagem, sem tentativa de ligação e ainda na etapa em que nasceram.
  select coalesce(array_agg(o.id), '{}') into v_orgs
    from public.organizations o
   where o.import_batch_id = p_batch_id
     and not exists (select 1 from public.activities a
                      where a.organization_id = o.id and a.type <> 'system')
     and not exists (select 1 from public.consent_events ce where ce.organization_id = o.id)
     and not exists (select 1 from public.deal_stage_history h
                      join public.deals d on d.id = h.deal_id
                     where d.organization_id = o.id)
     and not exists (select 1 from public.call_attempts ca where ca.organization_id = o.id);

  select count(*) into v_presos
    from public.organizations o
   where o.import_batch_id = p_batch_id and not (o.id = any (v_orgs));

  delete from public.deals d where d.organization_id = any (v_orgs);
  get diagnostics v_n_deal = row_count;
  delete from public.organizations o where o.id = any (v_orgs);
  get diagnostics v_n_org = row_count;
  delete from public.supplier_candidates c
   where c.import_batch_id = p_batch_id and c.status = 'novo';
  get diagnostics v_n_cand = row_count;

  update public.import_batches
     set status = 'desfeito', finished_at = now(),
         stats = stats || jsonb_build_object('desfeito_em', now(),
                                             'organizacoes_removidas', v_n_org,
                                             'negocios_removidos', v_n_deal,
                                             'candidatos_removidos', v_n_cand,
                                             'fichas_preservadas', v_presos)
   where id = p_batch_id;

  return jsonb_build_object('ok', true, 'organizacoes_removidas', v_n_org,
                            'negocios_removidos', v_n_deal,
                            'candidatos_removidos', v_n_cand,
                            'fichas_preservadas', v_presos);
end $$;
comment on function public.esteira_desfazer_lote(uuid) is
  'Desfaz um lote dentro da janela de 48 h (RF-BAS-17). Só remove o que o lote criou e ninguém tocou: ficha com atividade, mudança de etapa, consentimento ou ligação fica de pé e é contada em "fichas_preservadas".';


-- ---------------------------------------------------------------------------
-- 22. Retenção (PRD §10.6; R06 §D e GOV-06)
-- ---------------------------------------------------------------------------
create table if not exists public.retention_runs (
  id      bigserial primary key,
  ran_at  timestamptz not null default now(),
  report  jsonb not null
);
comment on table public.retention_runs is
  'Relatório de cada rodada do expurgo (R06 GOV-06: "jobs de retenção com relatório mensal"). Sem isto, "a retenção está implementada" é uma frase, não um fato verificável.';

create or replace function app.aplicar_retencao()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb;
  n int;
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  q text;
begin
  -- (1) Captura bruta: 90 dias (PRD §10.6). O HTML nunca esteve aqui — ele fica
  -- em cache de disco do worker por ≤ 7 dias (R06 SCR-11) e é problema do worker.
  delete from public.raw_capture where purge_after < v_hoje;
  get diagnostics n = row_count; v := v || jsonb_build_object('raw_capture', n);

  -- (2) Lead coletado e nunca contatado: 90 dias. Candidato 'novo' é, por
  -- definição, quem nunca foi contatado — ninguém liga a partir da fila.
  delete from public.supplier_candidates c
   where c.status = 'novo' and c.created_at < now() - interval '90 days';
  get diagnostics n = row_count; v := v || jsonb_build_object('candidatos_novos', n);

  -- (3) Candidato RECUSADO passa a guardar só a decisão: o contato sai, a linha
  -- fica. Apagar a linha inteira faria a próxima coleta trazer o mesmo alvo de
  -- volta e a mesma pessoa ser recusada duas vezes — o oposto de respeitar o não.
  update public.supplier_candidates c
     set phone_e164 = null, email = null, instagram_handle = null, website = null,
         website_domain = null, address = null, cnpj = null, legal_name = null,
         payload = '{}'::jsonb
   where c.status = 'recusado' and c.reviewed_at < now() - interval '90 days'
     and (c.phone_e164 is not null or c.email is not null or c.instagram_handle is not null
          or c.cnpj is not null or c.address is not null);
  get diagnostics n = row_count; v := v || jsonb_build_object('candidatos_recusados_anonimizados', n);

  -- (4) Registro de fonte que nunca virou candidato e envelheceu: some junto com
  -- a captura que o gerou.
  delete from public.source_record sr
   where sr.candidate_id is null and sr.last_seen_at < now() - interval '90 days';
  get diagnostics n = row_count; v := v || jsonb_build_object('source_record', n);

  -- (5) TTL do Places (30 dias): telefone e site expiram; o place_id fica, que é
  -- o único campo que os termos do Google deixam guardar sem prazo.
  update public.source_record sr
     set phone_e164 = null, phones = '[]'::jsonb, website = null, website_domain = null,
         expires_at = null
   where sr.expires_at is not null and sr.expires_at < now();
  get diagnostics n = row_count; v := v || jsonb_build_object('places_expirados', n);

  -- (6) Proveniência órfã: o registro a que ela se referia não existe mais.
  delete from public.field_provenance fp
   where (fp.record_type = 'source_record'
          and not exists (select 1 from public.source_record x where x.id = fp.record_id))
      or (fp.record_type = 'supplier_candidate'
          and not exists (select 1 from public.supplier_candidates x where x.id = fp.record_id))
      or (fp.record_type = 'organization'
          and not exists (select 1 from public.organizations x where x.id = fp.record_id));
  get diagnostics n = row_count; v := v || jsonb_build_object('proveniencia_orfa', n);

  -- (7) Chaves de idempotência já consumidas há mais de 90 dias: a mensagem que
  -- elas protegiam não volta mais.
  delete from public.ingest_dedup where processed_at is not null and processed_at < now() - interval '90 days';
  get diagnostics n = row_count; v := v || jsonb_build_object('ingest_dedup', n);

  -- (8) Lote de prévia que ninguém executou: 7 dias.
  delete from public.import_batches b
   where b.status = 'previa' and b.created_at < now() - interval '7 days'
     and not exists (select 1 from public.raw_capture rc where rc.batch_id = b.id);
  get diagnostics n = row_count; v := v || jsonb_build_object('lotes_previa', n);

  -- (9) Batida de worker que sumiu há mais de 30 dias.
  delete from public.worker_heartbeats where last_beat_at < now() - interval '30 days';
  get diagnostics n = row_count; v := v || jsonb_build_object('heartbeats', n);

  -- (10) Arquivo das filas: 30 dias. `pgmq` guarda o arquivado para sempre.
  for q in select name from public.ingest_queues loop
    execute format('delete from pgmq.%I where archived_at < now() - interval ''30 days''', 'a_' || q);
    get diagnostics n = row_count;
    v := v || jsonb_build_object('arquivo_' || q, n);
  end loop;

  -- (11) Logs de acesso e auditoria: 12 meses (PRD §10.6; Marco Civil art. 15
  -- exige 6 meses — 12 é o teto do PRD, não o piso da lei).
  delete from public.audit_log where created_at < now() - interval '12 months';
  get diagnostics n = row_count; v := v || jsonb_build_object('audit_log', n);
  delete from public.pii_access_log where created_at < now() - interval '12 months';
  get diagnostics n = row_count; v := v || jsonb_build_object('pii_access_log', n);

  -- (12) O próprio relatório: 5 anos (responsabilização, art. 6º, X).
  delete from public.retention_runs where ran_at < now() - interval '5 years';
  get diagnostics n = row_count; v := v || jsonb_build_object('retention_runs', n);

  insert into public.retention_runs (report) values (v);
  return v;
end $$;
comment on function app.aplicar_retencao() is
  'Expurgo do PRD §10.6 / R06 §D nas tabelas da esteira e nos logs, com relatório em retention_runs (R06 GOV-06). Anonimização de lead contatado sem resposta e de conversa de WhatsApp fica com os módulos donos desses dados.';

revoke all on function app.aplicar_retencao() from public, anon, authenticated;
grant execute on function app.aplicar_retencao() to service_role;

-- 04:00 America/Fortaleza = 07:00 UTC (o pg_cron roda em GMT). Depois da
-- recomputação de temperatura (03:00) e antes do expediente.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('aplicar_retencao', '0 7 * * *', $cron$select app.aplicar_retencao()$cron$);
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 23. RLS (padrão da migração 000500)
-- ---------------------------------------------------------------------------
alter table public.import_batches      enable row level security;
alter table public.raw_capture         enable row level security;
alter table public.source_record       enable row level security;
alter table public.field_provenance    enable row level security;
alter table public.worker_heartbeats   enable row level security;
alter table public.ingest_queues       enable row level security;
alter table public.ingest_dedup        enable row level security;
alter table public.source_category_map enable row level security;
alter table public.retention_runs      enable row level security;

-- import_batches: o lote é metadado de operação (rótulo, contagem, quem rodou),
-- sem PII. Todo autenticado lê, porque ele é dimensão de relatório (RF-REL-11);
-- só quem escreve na base abre um; só gestor conclui ou desfaz.
drop policy if exists import_batches_select on public.import_batches;
drop policy if exists import_batches_insert on public.import_batches;
drop policy if exists import_batches_update on public.import_batches;
drop policy if exists import_batches_delete on public.import_batches;
create policy import_batches_select on public.import_batches for select to authenticated using (true);
create policy import_batches_insert on public.import_batches for insert to authenticated
  with check ((select app.can_write()));
create policy import_batches_update on public.import_batches for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));
create policy import_batches_delete on public.import_batches for delete to authenticated
  using ((select app.is_admin()));

-- raw_capture: dado de terceiro AINDA NÃO REVISADO. O menor privilégio é não
-- mostrar — nem para sdr, nem para gestor. Escrita, só service_role (o worker).
drop policy if exists raw_capture_select on public.raw_capture;
drop policy if exists raw_capture_delete on public.raw_capture;
create policy raw_capture_select on public.raw_capture for select to authenticated
  using ((select app.is_admin()));
create policy raw_capture_delete on public.raw_capture for delete to authenticated
  using ((select app.is_admin()));

-- source_record: já normalizado, mas ainda de terceiro e ainda sem revisão. Quem
-- trabalha a fila vê o CANDIDATO (por radar_fila, com o telefone mascarado pela
-- regra do RF-BAS-14); o registro cru da fonte é leitura de gestor para cima.
drop policy if exists source_record_select on public.source_record;
drop policy if exists source_record_delete on public.source_record;
create policy source_record_select on public.source_record for select to authenticated
  using ((select app.is_manager()));
create policy source_record_delete on public.source_record for delete to authenticated
  using ((select app.is_admin()));

-- field_provenance: é o livro de transparência. Não guarda valor nenhum (só
-- hash), então quem pode trabalhar a base pode lê-lo — inclusive porque é a
-- resposta que a Heloísa precisa dar ao telefone. Ninguém edita (gatilho); só
-- admin apaga, e a retenção roda como postgres, fora da RLS.
drop policy if exists field_provenance_select on public.field_provenance;
drop policy if exists field_provenance_insert on public.field_provenance;
drop policy if exists field_provenance_delete on public.field_provenance;
create policy field_provenance_select on public.field_provenance for select to authenticated
  using ((select app.can_write()) or (select app.reads_base_pii()));
create policy field_provenance_insert on public.field_provenance for insert to authenticated
  with check ((select app.can_write()));
create policy field_provenance_delete on public.field_provenance for delete to authenticated
  using ((select app.is_admin()));

-- worker_heartbeats: a tela do Radar precisa dizer se o coletor está vivo, então
-- todo autenticado lê. Bater ponto é do worker (service_role) — pela RPC.
drop policy if exists worker_heartbeats_select on public.worker_heartbeats;
drop policy if exists worker_heartbeats_delete on public.worker_heartbeats;
create policy worker_heartbeats_select on public.worker_heartbeats for select to authenticated using (true);
create policy worker_heartbeats_delete on public.worker_heartbeats for delete to authenticated
  using ((select app.is_admin()));

-- ingest_queues / source_category_map: catálogo. Leitura para autenticado,
-- escrita para gestor (mesma regra de sources, cities e categories).
do $$
declare
  t text;
begin
  foreach t in array array['ingest_queues','source_category_map']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app.is_manager()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select app.is_manager())) with check ((select app.is_manager()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app.is_manager()))', t || '_delete', t);
  end loop;
end $$;

-- ingest_dedup e retention_runs: mecânica interna e prova de expurgo. Leitura de
-- admin; escrita só pelo worker e pelo cron.
drop policy if exists ingest_dedup_select on public.ingest_dedup;
create policy ingest_dedup_select on public.ingest_dedup for select to authenticated
  using ((select app.is_admin()));
drop policy if exists retention_runs_select on public.retention_runs;
create policy retention_runs_select on public.retention_runs for select to authenticated
  using ((select app.is_manager()));


-- ---------------------------------------------------------------------------
-- 24. Privilégios
-- ---------------------------------------------------------------------------
-- As default privileges da 000500 dão select/insert/update/delete de todas as
-- tabelas novas a `authenticated`; quem restringe as LINHAS é a RLS acima. O que
-- não pode nem chegar à tabela é revogado aqui.
grant select, insert, update, delete on public.import_batches, public.raw_capture,
      public.source_record, public.field_provenance, public.worker_heartbeats,
      public.ingest_queues, public.ingest_dedup, public.source_category_map,
      public.retention_runs to authenticated, service_role;
grant usage, select on sequence public.field_provenance_id_seq, public.retention_runs_id_seq
      to authenticated, service_role;

-- Escrita direta em raw_capture, source_record, ingest_dedup, worker_heartbeats e
-- retention_runs é do worker e do cron. Uma pessoa que escrevesse ali à mão
-- furaria a idempotência da esteira sem que nenhum log dissesse por quê.
revoke insert, update on public.raw_capture       from authenticated;
revoke insert, update on public.source_record     from authenticated;
revoke insert, update, delete on public.ingest_dedup      from authenticated;
revoke insert, update on public.worker_heartbeats from authenticated;
revoke insert, update, delete on public.retention_runs    from authenticated;
revoke update on public.field_provenance from authenticated;

-- Funções internas do schema `app`: nada de PUBLIC/anon (o teste 09 varre isto).
revoke all on function app.tem_cpf(text)                                       from public, anon;
revoke all on function app.sem_cpf(text)                                       from public, anon;
revoke all on function app.payload_e_permitido(jsonb)                          from public, anon;
revoke all on function app.payload_hash(jsonb)                                 from public, anon;
revoke all on function app.raw_capture_normalize()                             from public, anon, authenticated;
revoke all on function app.source_record_normalize()                           from public, anon, authenticated;
revoke all on function app.supplier_candidates_normalize()                     from public, anon, authenticated;
revoke all on function app.esteira_enfileirar(text,jsonb,text,uuid,int)        from public, anon, authenticated;
revoke all on function app.esteira_ler(text,int)                               from public, anon, authenticated;
revoke all on function app.esteira_concluir(text,bigint,text)                  from public, anon, authenticated;
revoke all on function app.esteira_falhar(text,bigint,text,text)               from public, anon, authenticated;
grant execute on function app.esteira_enfileirar(text,jsonb,text,uuid,int)     to service_role;
grant execute on function app.esteira_ler(text,int)                            to service_role;
grant execute on function app.esteira_concluir(text,bigint,text)               to service_role;
grant execute on function app.esteira_falhar(text,bigint,text,text)            to service_role;

-- RPCs públicas: a esteira é do worker; só a saúde, a origem do dado e o
-- desfazer são de gente.
revoke all on function public.esteira_bater_ponto(text,text,text,text,text,text,bigint,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.esteira_abrir_lote(text,int,text,jsonb,text)      from public, anon;
revoke all on function public.esteira_gravar_captura(uuid,int,jsonb,text,text,int,text) from public, anon, authenticated;
revoke all on function public.esteira_processar_captura(uuid)                   from public, anon, authenticated;
revoke all on function public.esteira_saude()                                   from public, anon;
revoke all on function public.esteira_desfazer_lote(uuid)                       from public, anon;
revoke all on function public.origem_dos_dados(uuid)                            from public, anon;

grant execute on function public.esteira_bater_ponto(text,text,text,text,text,text,bigint,bigint,jsonb) to service_role;
grant execute on function public.esteira_gravar_captura(uuid,int,jsonb,text,text,int,text) to service_role;
grant execute on function public.esteira_processar_captura(uuid)                to service_role;
grant execute on function public.esteira_abrir_lote(text,int,text,jsonb,text)   to authenticated, service_role;
grant execute on function public.esteira_saude()                                to authenticated, service_role;
grant execute on function public.esteira_desfazer_lote(uuid)                    to authenticated, service_role;
grant execute on function public.origem_dos_dados(uuid)                         to authenticated, service_role;

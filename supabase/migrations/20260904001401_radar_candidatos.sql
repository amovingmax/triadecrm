-- =====================================================================
-- TRIADE — v0.1 — D4 — Radar: candidatos, fila de revisão e catálogo de fontes
-- (RF-RAD-01, 03, 04, 05, 09, 11, 16; PRD §7.3 e §9; anexos R03 e R06).
--
-- O que esta migração ENTREGA
--   1. `public.supplier_candidates` — a entidade resolvida da esteira
--      `raw_capture → source_record → supplier_candidate → revisão →
--      organizations` (ADR-08). É o alvo ANTES de virar parceiro: ninguém é
--      contatado a partir daqui, e nada entra em `organizations` sem uma
--      decisão humana registrada.
--   2. Higiene na entrada (RF-RAD-16 / RF-BAS-16), em gatilho: CPF com dígito
--      verificador válido é DESCARTADO do nome (nunca persistido) e o descarte
--      fica registrado; DDD de fora da região e @instagram fora do padrão
--      MARCAM o candidato para revisão em vez de reprová-lo; telefone, CNPJ e
--      @ já suprimidos nascem com `do_not_contact` (RF-RAD-09).
--   3. `public.radar_fila(...)` — a fila de revisão do RF-RAD-11, já com as
--      duplicatas sugeridas por `app.find_org_matches` em cada linha.
--   4. `public.radar_criar_candidato(...)` — entrada MANUAL de candidato, que é
--      o que funciona hoje, enquanto o coletor não existe.
--   5. `public.radar_revisar_candidato(...)` — aprovar (vira organização +
--      negócio no funil), mesclar (completa uma ficha existente sem sobrescrever
--      nada), recusar e marcar "não contatar".
--   6. `public.radar_alternar_fonte(...)` — liga/desliga uma fonte do catálogo,
--      recusando ligar o que ainda não tem `robots_ok` avaliado (RF-RAD-01).
--   7. `public.radar_resumo()` — os números do topo da tela.
--
-- O que esta migração NÃO faz (e por quê)
--   * Não cria `raw_capture`, `source_record`, `field_provenance` nem
--     `ingest_jobs`: eles são do worker de coleta (D4 do calendário), que ainda
--     não existe. Criar a tabela vazia agora só faria a tela fingir que há
--     esteira ligada. A proveniência do que ENTRA HOJE (entrada manual) fica em
--     `supplier_candidates.payload`, com fonte, url, quem digitou e quando.
--   * Não calcula o score do RF-RAD-12: ele depende de sinais que só a coleta
--     traz (nota, nº de avaliações, presença em ≥ 2 diretórios, seguidores). A
--     coluna existe e fica NULA, e a tela diz que a pontuação não está ligada,
--     em vez de mostrar um número inventado.
--   * Não põe candidato em nenhuma fila de contato: candidato não é alvo.
--
-- DESVIO DE NOME, REGISTRADO PARA CONFIRMAÇÃO HUMANA (Rafael/Matheus): o
-- Apêndice D do PRD chama a tabela de `supplier_candidate` (singular). Aqui ela
-- é `supplier_candidates`, no plural, como TODAS as tabelas já implementadas
-- (organizations, contacts, deals, sources, goals). É só nomenclatura; nenhuma
-- decisão de produto muda.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'app' and t.typname = 'candidate_status') then
    create type app.candidate_status as enum ('novo', 'aprovado', 'recusado', 'mesclado');
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. CPF: validação, para poder DESCARTAR (RF-BAS-16 (a), RF-RAD-16)
-- ---------------------------------------------------------------------------
-- Não existe campo de CPF em lugar nenhum do CRM (ADR-09) e não é para existir.
-- Esta função serve ao contrário do que o nome sugere: ela é usada para
-- RECONHECER um CPF que veio grudado no nome empresarial de um MEI ("FULANO DE
-- TAL 12345678909") e apagá-lo antes de qualquer gravação. Só o dígito
-- verificador separa um CPF de um número de protocolo qualquer.
create or replace function app.cpf_is_valid(c text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(c, ''), '\D', '', 'g');
  soma int;
  dv1 int;
  dv2 int;
  -- Sem declarar `i`: a própria construção `for i in 1..9` já cria a variável do
  -- laço, e declará-la aqui faria o plpgsql avisar de sombreamento (`db lint`).
begin
  if length(d) <> 11 then
    return false;
  end if;
  -- 000.000.000-00, 111.111.111-11 etc. passam na conta e não são CPF de ninguém.
  if d ~ '^(\d)\1{10}$' then
    return false;
  end if;

  soma := 0;
  for i in 1..9 loop
    soma := soma + substr(d, i, 1)::int * (11 - i);
  end loop;
  dv1 := 11 - (soma % 11);
  if dv1 >= 10 then dv1 := 0; end if;

  soma := 0;
  for i in 1..10 loop
    soma := soma + substr(d, i, 1)::int * (12 - i);
  end loop;
  dv2 := 11 - (soma % 11);
  if dv2 >= 10 then dv2 := 0; end if;

  return d = substr(d, 1, 9) || dv1::text || dv2::text;
end $$;
comment on function app.cpf_is_valid(text) is
  'Reconhece CPF por dígito verificador. Usada só para DESCARTAR o CPF que vem no nome empresarial de MEI antes de gravar (RF-BAS-16, RF-RAD-16). O CRM não guarda CPF (ADR-09).';


-- DDDs válidos do Brasil e os da região que o Radar cobre. Fora da região não
-- reprova: marca o candidato para revisão (RF-RAD-16).
create or replace function app.ddd_da_regiao(p_phone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
           when p_phone is null then true
           else substr(regexp_replace(p_phone, '\D', '', 'g'), 3, 2)
                in ('84','81','82','83','85','86','87','88','89')   -- RN e vizinhos do Nordeste
         end
$$;
comment on function app.ddd_da_regiao(text) is
  'DDD do telefone (E.164) está no RN ou em estado vizinho do Nordeste. Fora disso o candidato é MARCADO para revisão, nunca reprovado (RF-RAD-16).';


-- ---------------------------------------------------------------------------
-- 3. A tabela
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_candidates (
  id                uuid primary key default gen_random_uuid(),

  -- Proveniência: de onde veio, por qual URL, colhido quando e por quem/o quê.
  -- Obrigatória em toda linha (R06 SCR-08; RF-BAS-10).
  source_id         int  not null references public.sources(id),
  source_url        text,
  external_id       text,
  collected_at      timestamptz not null default now(),
  collector         text not null,
  payload           jsonb not null default '{}'::jsonb,

  -- Só a lista permitida do RF-RAD-04.
  name              text not null,
  legal_name        text,
  cnpj              text,
  phone_e164        text,
  email             citext,
  instagram_handle  text,
  website           text,
  website_domain    text,
  place_id          text,
  city_id           int  references public.cities(id) on delete set null,
  neighborhood      text,
  address           text,
  category_id       int  references public.categories(id) on delete set null,
  kind              app.org_kind not null default 'fornecedor',

  -- Sinais numéricos de pontuação (RF-RAD-04, exceção consciente ao R06 SCR-02,
  -- em validação com o advogado — PRD §13 item 10). NUNCA exibidos como conteúdo
  -- de terceiro: entram só na conta do score.
  rating            numeric(3,2) check (rating is null or (rating >= 0 and rating <= 5)),
  reviews_count     int          check (reviews_count is null or reviews_count >= 0),

  -- Pontuação do RF-RAD-12: existe, mas fica nula até o coletor trazer os sinais.
  score             smallint check (score is null or (score between 0 and 100)),
  tier              text     check (tier is null or tier in ('A+','A','B','C')),

  is_natural_person boolean not null default false,
  do_not_contact    boolean not null default false,

  -- Avisos da higiene de entrada; a fila filtra por eles.
  -- 'cpf_descartado' | 'ddd_de_fora' | 'instagram_fora_do_padrao'
  -- | 'telefone_invalido' | 'cnpj_invalido' | 'sem_contato' | 'suprimido'
  flags             text[] not null default '{}'::text[],

  status            app.candidate_status not null default 'novo',
  review_reason     text,
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  organization_id   uuid references public.organizations(id) on delete set null,
  notes             text,

  created_by        uuid references public.profiles(id) on delete set null,
  search_name       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint supplier_candidates_name_check check (length(trim(name)) > 0),
  -- Decisão registrada: recusar sem motivo escrito não é decisão, é sumiço.
  constraint supplier_candidates_recusa_com_motivo
    check (status <> 'recusado' or length(trim(coalesce(review_reason, ''))) > 0)
  -- NÃO existe constraint exigindo `organization_id` em aprovado/mesclado, e isso é
  -- deliberado: a ficha resultante pode ser apagada depois (pedido de eliminação da
  -- LGPD, RF-ADM-06), e o `on delete set null` do FK precisa poder zerar a coluna sem
  -- esbarrar num check. Quem garante o preenchimento é a RPC de revisão, que é o
  -- único caminho de escrita; o histórico da decisão continua no audit_log mesmo
  -- quando a organização deixa de existir.
);

comment on table public.supplier_candidates is
  'Candidato do Radar: alvo colhido em fonte pública (ou digitado à mão) que ainda NÃO é parceiro. Só vira organização por decisão humana na fila de revisão (RF-RAD-05, RF-RAD-11; ADR-08).';
comment on column public.supplier_candidates.payload is
  'Proveniência bruta do que entrou (campos crus da fonte, quem digitou). Substitui, no MVP, field_provenance — que nasce com o worker de coleta.';
comment on column public.supplier_candidates.score is
  'Pontuação 0–100 do RF-RAD-12. NULA enquanto o coletor não existir: os sinais (nota, avaliações, diretórios, seguidores) vêm dele.';
comment on column public.supplier_candidates.flags is
  'Avisos da higiene de entrada (RF-RAD-16): cpf_descartado, ddd_de_fora, instagram_fora_do_padrao, telefone_invalido, cnpj_invalido, sem_contato, suprimido.';

create unique index if not exists supplier_candidates_fonte_externo_uq
  on public.supplier_candidates (source_id, external_id) where external_id is not null;
create index if not exists supplier_candidates_status_idx
  on public.supplier_candidates (status, created_at desc);
create index if not exists supplier_candidates_source_idx  on public.supplier_candidates (source_id);
create index if not exists supplier_candidates_category_idx on public.supplier_candidates (category_id);
create index if not exists supplier_candidates_org_idx      on public.supplier_candidates (organization_id);
create index if not exists supplier_candidates_creator_idx  on public.supplier_candidates (created_by);
create index if not exists supplier_candidates_reviewer_idx on public.supplier_candidates (reviewed_by);
create index if not exists supplier_candidates_city_idx     on public.supplier_candidates (city_id);
create index if not exists supplier_candidates_phone_idx
  on public.supplier_candidates (phone_e164) where phone_e164 is not null;
create index if not exists supplier_candidates_search_trgm
  on public.supplier_candidates using gin (search_name extensions.gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- 4. Higiene na entrada, em gatilho (RF-RAD-16 / RF-BAS-16)
-- ---------------------------------------------------------------------------
-- Um gatilho, e não a aplicação: a esteira tem duas bocas (o formulário de hoje e
-- o worker de amanhã) e a regra não pode depender de qual delas escreveu.
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
  v_achado text;
  v_nome text := trim(coalesce(new.name, ''));
begin
  -- (a) CPF no nome empresarial de MEI: descarta o número, guarda o nome.
  -- O registro do descarte vai para `payload` e para `flags` — o dado em si não
  -- é gravado em lugar nenhum, que é justamente o ponto (ADR-09).
  for v_achado in
    select m[1] from regexp_matches(v_nome, '(\d{3}\.?\d{3}\.?\d{3}-?\d{2})', 'g') m
  loop
    if app.cpf_is_valid(v_achado) then
      v_nome := trim(regexp_replace(replace(v_nome, v_achado, ' '), '\s{2,}', ' ', 'g'));
      v_flags := array_append(v_flags, 'cpf_descartado');
      new.is_natural_person := true;
      new.payload := coalesce(new.payload, '{}'::jsonb)
                     || jsonb_build_object('cpf_descartado_em', now(),
                                           'cpf_descartado_de', 'name');
    end if;
  end loop;
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

  new.flags := (select coalesce(array_agg(distinct f order by f), '{}') from unnest(v_flags) f);
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.collector := coalesce(nullif(trim(coalesce(new.collector, '')), ''), 'entrada manual');
  end if;

  return new;
end $$;

drop trigger if exists supplier_candidates_before_write on public.supplier_candidates;
create trigger supplier_candidates_before_write
  before insert or update on public.supplier_candidates
  for each row execute function app.supplier_candidates_normalize();

drop trigger if exists audit_supplier_candidates on public.supplier_candidates;
create trigger audit_supplier_candidates
  after insert or update or delete on public.supplier_candidates
  for each row execute function app.audit();


-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table public.supplier_candidates enable row level security;

-- Candidato ainda não tem dono nem carteira: quem trabalha a fila (admin, gestor,
-- sdr, embaixador) vê a fila inteira. `leitura` e `financeiro` não entram aqui —
-- é dado de terceiro ainda não revisado, e o menor privilégio é não mostrá-lo.
drop policy if exists supplier_candidates_select on public.supplier_candidates;
create policy supplier_candidates_select on public.supplier_candidates
  for select to authenticated using ((select app.can_write()));

drop policy if exists supplier_candidates_insert on public.supplier_candidates;
create policy supplier_candidates_insert on public.supplier_candidates
  for insert to authenticated with check ((select app.can_write()));

drop policy if exists supplier_candidates_update on public.supplier_candidates;
create policy supplier_candidates_update on public.supplier_candidates
  for update to authenticated
  using ((select app.can_write())) with check ((select app.can_write()));

-- Apagar candidato é operação de retenção (RF-RAD-15), não de revisão.
drop policy if exists supplier_candidates_delete on public.supplier_candidates;
create policy supplier_candidates_delete on public.supplier_candidates
  for delete to authenticated using ((select app.is_admin()));


-- ---------------------------------------------------------------------------
-- 6. Resumo do topo da tela
-- ---------------------------------------------------------------------------
create or replace function public.radar_resumo()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- O `case` de fora é o que faz a função devolver NULO para quem não trabalha a
  -- fila: sem ele os agregados sobre o conjunto vazio devolveriam zeros, e a tela
  -- diria "nenhum candidato" a quem, na verdade, não pode ver nenhum.
  select case when app.can_write() then (
  select jsonb_build_object(
    'novos',            count(*) filter (where c.status = 'novo'),
    'aprovados',        count(*) filter (where c.status = 'aprovado'),
    'mesclados',        count(*) filter (where c.status = 'mesclado'),
    'recusados',        count(*) filter (where c.status = 'recusado'),
    'revisados_hoje',   count(*) filter (where c.reviewed_at is not null
                          and (c.reviewed_at at time zone 'America/Fortaleza')::date
                              = (now() at time zone 'America/Fortaleza')::date),
    'novos_sem_contato', count(*) filter (where c.status = 'novo' and 'sem_contato' = any (c.flags)),
    'novos_marcados',    count(*) filter (where c.status = 'novo' and cardinality(c.flags) > 0),
    'fontes_total',      (select count(*) from public.sources),
    'fontes_ligadas',    (select count(*) from public.sources s where s.is_enabled),
    'fontes_com_coletor_pronto',
      (select count(*) from public.sources s
        where coalesce((s.config -> 'collector' ->> 'enabled')::boolean, false)),
    'organizacoes',      (select count(*) from public.organizations o where o.deleted_at is null)
  )
  from public.supplier_candidates c
  ) end
$$;
comment on function public.radar_resumo() is
  'Números do topo do Radar: fila por situação, marcados pela higiene, fontes ligadas e fontes com coletor pronto. Devolve nulo para papel que não trabalha a fila.';


-- ---------------------------------------------------------------------------
-- 7. A fila de revisão (RF-RAD-11)
-- ---------------------------------------------------------------------------
-- Uma consulta por página, com as duplicatas já resolvidas por linha: a meta do
-- RF-RAD-11 é ≤ 60 s por registro, e não dá para gastar esse tempo esperando
-- uma segunda ida ao servidor para saber se o alvo já está na base.
create or replace function public.radar_fila(
  p_status      text default 'novo',
  p_source_id   int  default null,
  p_category_id int  default null,
  p_q           text default null,
  p_so_marcados boolean default false,
  p_limit       int  default 30,
  p_offset      int  default 0
)
returns table (
  id uuid,
  nome text,
  status app.candidate_status,
  fonte_id int,
  fonte text,
  fonte_tipo app.source_kind,
  source_url text,
  categoria_id int,
  categoria text,
  tipo app.org_kind,
  cidade text,
  bairro text,
  telefone text,
  tem_telefone boolean,
  instagram text,
  site text,
  cnpj text,
  email text,
  observacao text,
  sinalizacoes text[],
  nao_contatar boolean,
  pontuacao smallint,
  coletado_em timestamptz,
  coletor text,
  criado_em timestamptz,
  revisado_em timestamptz,
  revisado_por text,
  motivo_da_revisao text,
  organizacao_id uuid,
  duplicatas jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_q      text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not app.can_write() then
    raise exception 'Papel % não trabalha a fila do Radar', app.role() using errcode = '42501';
  end if;

  return query
  with filtrada as (
    select c.*
      from public.supplier_candidates c
     where (p_status is null or p_status = 'todos' or c.status::text = p_status)
       and (p_source_id is null   or c.source_id = p_source_id)
       and (p_category_id is null or c.category_id = p_category_id)
       and (not coalesce(p_so_marcados, false) or cardinality(c.flags) > 0)
       and (v_q is null
            or c.search_name like '%' || app.search_name(v_q) || '%'
            or c.cnpj = app.normalize_cnpj(v_q)
            or c.phone_e164 = app.normalize_phone_br(v_q)
            or c.instagram_handle = app.normalize_instagram(v_q))
  ),
  contada as (select count(*) as n from filtrada),
  pagina as (
    select f.* from filtrada f
     order by (f.status = 'novo') desc, f.created_at desc
     limit v_limit offset v_offset
  )
  select p.id,
         p.name,
         p.status,
         s.id, s.name, s.kind,
         p.source_url,
         p.category_id, cat.name,
         p.kind,
         ci.name, p.neighborhood,
         -- Telefone segue a regra da base (RF-BAS-14): sdr e embaixador leem mascarado.
         case when p.phone_e164 is null then null
              when app.reads_base_pii() then p.phone_e164
              else app.mask_phone(p.phone_e164) end,
         p.phone_e164 is not null,
         p.instagram_handle,
         p.website_domain,
         p.cnpj,
         case when p.email is null then null
              when app.reads_base_pii() then p.email::text
              else '•••' end,
         p.notes,
         p.flags,
         p.do_not_contact,
         p.score,
         p.collected_at,
         p.collector,
         p.created_at,
         p.reviewed_at,
         rev.full_name,
         p.review_reason,
         p.organization_id,
         coalesce((
           select jsonb_agg(d.*)
             from (
               -- UMA linha por ficha. app.find_org_matches devolve uma linha por REGRA
               -- que casou (a mesma empresa aparece por nome E por telefone), e três
               -- vezes a mesma ficha na tela não é "três suspeitas": é ruído que faz
               -- quem revisa reler para descobrir que é tudo a mesma coisa. Fica a
               -- regra de maior confiança, que é a que explica melhor o casamento.
               select u.organization_id, u.name, u.confidence, u.reason
                 from (
                   select distinct on (m.organization_id)
                          m.organization_id, o.name, m.confidence, m.reason
                     from app.find_org_matches(
                            jsonb_build_object(
                              'name', p.name, 'cnpj', p.cnpj, 'phone_e164', p.phone_e164,
                              'instagram_handle', p.instagram_handle, 'website', p.website_domain,
                              'place_id', p.place_id, 'city_id', p.city_id,
                              'neighborhood', p.neighborhood, 'category_id', p.category_id)) m
                     join public.organizations o
                       on o.id = m.organization_id and o.deleted_at is null
                    -- Só o que a pessoa já poderia abrir: a dedup não é atalho para
                    -- ver ficha de carteira alheia.
                    where app.org_is_visible(m.organization_id)
                    order by m.organization_id, m.confidence desc, m.reason
                 ) u
                order by u.confidence desc, u.name
                limit 3
             ) d
         ), '[]'::jsonb),
         contada.n
    from pagina p
    cross join contada
    join public.sources s on s.id = p.source_id
    left join public.categories cat on cat.id = p.category_id
    left join public.cities ci on ci.id = p.city_id
    left join public.profiles rev on rev.id = p.reviewed_by
   order by (p.status = 'novo') desc, p.created_at desc;
end $$;
comment on function public.radar_fila(text,int,int,text,boolean,int,int) is
  'Fila de revisão do Radar (RF-RAD-11) com paginação, filtros e as duplicatas de app.find_org_matches já resolvidas por linha. Telefone e e-mail seguem o mascaramento do RF-BAS-14.';


-- ---------------------------------------------------------------------------
-- 8. Entrada manual de candidato
-- ---------------------------------------------------------------------------
-- É o que funciona hoje: a Heloísa vê um perfil no Instagram, o Matheus acha uma
-- empresa na mão, e o alvo entra pela MESMA esteira que o coletor vai usar
-- (ADR-08) — não por um atalho direto para `organizations`.
create or replace function public.radar_criar_candidato(
  p_name         text,
  p_source_id    int,
  p_category_id  int  default null,
  p_phone        text default null,
  p_instagram    text default null,
  p_website      text default null,
  p_cnpj         text default null,
  p_neighborhood text default null,
  p_city_id      int  default null,
  p_source_url   text default null,
  p_notes        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_phone  text := app.normalize_phone_br(p_phone);
  v_ig     text := app.normalize_instagram(p_instagram);
  v_cnpj   text := app.normalize_cnpj(p_cnpj);
  v_quem   text;
  v_kind   app.org_kind := 'fornecedor'::app.org_kind;
  v_grupo  text;
  v_slug   text;
  v_id     uuid;
  v_dup    uuid;
begin
  if v_uid is null or not app.can_write() then
    raise exception 'Papel % não cadastra candidato no Radar', app.role() using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    return jsonb_build_object('created', false, 'reason', 'nome_obrigatorio');
  end if;
  if nullif(trim(coalesce(p_cnpj, '')), '') is not null
     and (v_cnpj is null or not app.cnpj_is_valid(v_cnpj)) then
    return jsonb_build_object('created', false, 'reason', 'cnpj_invalido');
  end if;

  if not exists (select 1 from public.sources s where s.id = p_source_id) then
    return jsonb_build_object('created', false, 'reason', 'origem_invalida');
  end if;
  if not exists (select 1 from public.sources s where s.id = p_source_id and s.is_enabled) then
    return jsonb_build_object('created', false, 'reason', 'origem_desabilitada');
  end if;

  if p_category_id is not null then
    select c.group, c.slug into v_grupo, v_slug
      from public.categories c where c.id = p_category_id and c.is_active;
    if v_grupo is null then
      return jsonb_build_object('created', false, 'reason', 'categoria_invalida');
    end if;
    -- O tipo sai da categoria, como no cadastro rápido: é ele que decide o funil
    -- em que o negócio nasce se o candidato for aprovado.
    v_kind := case
                when v_slug = 'cerimonialistas_assessorias' then 'cerimonialista'
                when v_grupo = 'producao' then 'produtor'
                when v_grupo = 'locais'   then 'espaco'
                else 'fornecedor'
              end::app.org_kind;
  end if;

  -- Mesmo alvo já esperando revisão: devolver o id evita duas linhas idênticas na
  -- fila de quem revisa (a duplicata contra `organizations` é outra conversa, e
  -- quem responde por ela é app.find_org_matches, na própria fila).
  select c.id into v_dup
    from public.supplier_candidates c
   where c.status = 'novo'
     and ((v_phone is not null and c.phone_e164 = v_phone)
       or (v_cnpj  is not null and c.cnpj = v_cnpj)
       or (v_ig    is not null and c.instagram_handle = v_ig))
   limit 1;
  if v_dup is not null then
    return jsonb_build_object('created', false, 'reason', 'ja_esta_na_fila', 'candidate_id', v_dup);
  end if;

  select pr.full_name into v_quem from public.profiles pr where pr.id = v_uid;

  insert into public.supplier_candidates
    (source_id, source_url, collector, collected_at, name, cnpj, phone_e164,
     instagram_handle, website, city_id, neighborhood, category_id, kind, notes,
     created_by, payload)
  values
    (p_source_id, nullif(trim(coalesce(p_source_url, '')), ''),
     coalesce(v_quem, 'entrada manual'), now(),
     p_name, p_cnpj, p_phone, p_instagram,
     nullif(trim(coalesce(p_website, '')), ''), p_city_id,
     p_neighborhood, p_category_id, v_kind,
     p_notes, v_uid,
     jsonb_build_object('origin', 'entrada_manual', 'by', v_uid, 'at', now()))
  returning id into v_id;

  return (select jsonb_build_object('created', true, 'candidate_id', c.id,
                                    'flags', to_jsonb(c.flags),
                                    'do_not_contact', c.do_not_contact)
            from public.supplier_candidates c where c.id = v_id);
end $$;
comment on function public.radar_criar_candidato(text,int,int,text,text,text,text,text,int,text,text) is
  'Entrada manual de candidato pela mesma esteira do coletor (ADR-08). Passa pela higiene do RF-RAD-16 e pela supressão do RF-RAD-09; não cria organização nenhuma.';


-- ---------------------------------------------------------------------------
-- 9. A decisão da revisão (RF-RAD-11)
-- ---------------------------------------------------------------------------
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
  v_uid      uuid := auth.uid();
  v_c        public.supplier_candidates;
  v_cat      int;
  v_grupo    text;
  v_slug     text;
  v_kind     app.org_kind;
  v_pipeline int;
  v_stage    int;
  v_org      uuid;
  v_deal     uuid;
  v_tier     text;
  v_fonte    record;
  v_quem     text;
begin
  if v_uid is null or not app.can_write() then
    raise exception 'Papel % não revisa a fila do Radar', app.role() using errcode = '42501';
  end if;

  select * into v_c from public.supplier_candidates where id = p_candidate_id for update;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'candidato_inexistente');
  end if;
  if v_c.status <> 'novo' then
    return jsonb_build_object('ok', false, 'reason', 'ja_revisado', 'status', v_c.status);
  end if;

  select pr.full_name into v_quem from public.profiles pr where pr.id = v_uid;

  -- ---------------- recusar / não contatar ----------------
  if p_acao in ('recusar', 'nao_contatar') then
    if nullif(trim(coalesce(p_reason, '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'motivo_obrigatorio');
    end if;
    update public.supplier_candidates
       set status = 'recusado',
           review_reason = trim(p_reason),
           reviewed_by = v_uid,
           reviewed_at = now(),
           do_not_contact = do_not_contact or (p_acao = 'nao_contatar')
     where id = p_candidate_id;
    return jsonb_build_object('ok', true, 'status', 'recusado',
                              'nao_contatar', p_acao = 'nao_contatar');
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
    if not app.org_is_editable(p_organization_id) then
      return jsonb_build_object('ok', false, 'reason', 'organizacao_fora_da_carteira');
    end if;

    -- COMPLETA, nunca sobrescreve: o que o fornecedor já confirmou vale mais que o
    -- que uma fonte pública diz (RF-RAD-08). Cada campo só entra se estiver vazio.
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
           reviewed_by = v_uid, reviewed_at = now()
     where id = p_candidate_id;

    return jsonb_build_object('ok', true, 'status', 'mesclado',
                              'organization_id', p_organization_id);
  end if;

  -- ---------------- aprovar: vira parceiro e entra no funil ----------------
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

  -- As chaves de dedup são índices únicos parciais: sem esta checagem o aprovar
  -- estouraria em 23505 e a tela mostraria erro de banco em vez de "já existe".
  select o.id into v_org
    from public.organizations o
   where o.deleted_at is null
     and ((v_c.cnpj is not null and o.cnpj = v_c.cnpj)
       or (v_c.phone_e164 is not null and o.phone_e164 = v_c.phone_e164)
       or (v_c.instagram_handle is not null and o.instagram_handle = v_c.instagram_handle)
       or (v_c.place_id is not null and o.place_id = v_c.place_id))
   limit 1;
  if v_org is not null then
    return jsonb_build_object('ok', false, 'reason', 'ja_existe_na_base',
                              'organization_id',
                              case when app.org_is_visible(v_org) then v_org end);
  end if;

  select p.id into v_pipeline from public.pipelines p
   where p.slug = case when v_kind in ('produtor','cerimonialista') then 'produtor' else 'fornecedor' end;
  select st.id into v_stage from public.stages st
   where st.pipeline_id = v_pipeline and not st.is_lost and not st.is_won
   order by st.position limit 1;
  if v_stage is null then
    raise exception 'Funil sem etapas cadastradas: aplique a seed (pipelines/stages)' using errcode = 'P0001';
  end if;

  select s.id, s.kind, s.slug into v_fonte from public.sources s where s.id = v_c.source_id;
  v_tier := coalesce(v_c.tier, case when v_fonte.kind = 'referral' then 'A+' end);

  insert into public.organizations
    (kind, name, legal_name, cnpj, phone_e164, email, instagram_handle, website,
     place_id, city_id, neighborhood, address, rating, reviews_count,
     source_id, source_url, collected_at, collector, owner_id, is_natural_person)
  values
    (v_kind, v_c.name, v_c.legal_name, v_c.cnpj, v_c.phone_e164, v_c.email,
     v_c.instagram_handle, v_c.website, v_c.place_id, v_c.city_id, v_c.neighborhood,
     v_c.address, v_c.rating, v_c.reviews_count,
     v_c.source_id, v_c.source_url, v_c.collected_at,
     coalesce(v_c.collector, 'radar'), v_uid, v_c.is_natural_person)
  returning id into v_org;

  insert into public.organization_categories (organization_id, category_id, is_primary)
  values (v_org, v_cat, true);

  insert into public.deals
    (organization_id, pipeline_id, stage_id, owner_id, source_id, tier, next_action, next_action_at)
  values
    (v_org, v_pipeline, v_stage, v_uid, v_c.source_id, v_tier, 'Primeiro contato',
     ((app.next_business_day((now() at time zone 'America/Fortaleza')::date) + time '09:00')
      at time zone 'America/Fortaleza'))
  returning id into v_deal;

  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('system', v_org, v_deal, v_uid, 'system',
          'Aprovado na fila do Radar por ' || coalesce(v_quem, 'revisor'),
          jsonb_build_object('origin', 'radar_approve', 'candidate_id', v_c.id,
                             'source_slug', v_fonte.slug));

  update public.supplier_candidates
     set status = 'aprovado', organization_id = v_org, category_id = v_cat, kind = v_kind,
         review_reason = nullif(trim(coalesce(p_reason, '')), ''),
         reviewed_by = v_uid, reviewed_at = now()
   where id = p_candidate_id;

  return jsonb_build_object('ok', true, 'status', 'aprovado',
                            'organization_id', v_org, 'deal_id', v_deal);
end $$;
comment on function public.radar_revisar_candidato(uuid,text,uuid,int,text) is
  'Decisão da fila do Radar (RF-RAD-11): aprovar (cria organização + negócio na primeira etapa), mesclar (completa uma ficha sem sobrescrever campo confirmado), recusar e marcar não contatar. Toda decisão fica em audit_log.';


-- ---------------------------------------------------------------------------
-- 10. Ligar e desligar uma fonte (RF-RAD-01)
-- ---------------------------------------------------------------------------
-- "Registro de operação exigido ANTES de habilitar a fonte": base legal escrita,
-- termos avaliados e robots.txt conferido. Sem isso a função recusa, e a tela
-- explica o que falta em vez de deixar o gestor ligar no escuro.
create or replace function public.radar_alternar_fonte(p_source_id int, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.sources;
begin
  if not app.is_manager() then
    raise exception 'Papel % não liga nem desliga fonte do Radar', app.role() using errcode = '42501';
  end if;

  select * into v_s from public.sources where id = p_source_id;
  if v_s.id is null then
    return jsonb_build_object('ok', false, 'reason', 'fonte_inexistente');
  end if;

  if p_enabled then
    if v_s.robots_ok is null then
      return jsonb_build_object('ok', false, 'reason', 'robots_nao_avaliado');
    end if;
    if v_s.robots_ok = false and v_s.kind = 'scrape' then
      return jsonb_build_object('ok', false, 'reason', 'robots_proibe_coleta');
    end if;
    if nullif(trim(coalesce(v_s.terms_notes, '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'termos_nao_avaliados');
    end if;
  end if;

  update public.sources set is_enabled = p_enabled where id = p_source_id;
  return jsonb_build_object('ok', true, 'is_enabled', p_enabled);
end $$;
comment on function public.radar_alternar_fonte(int, boolean) is
  'Liga/desliga uma fonte. Ligar exige robots.txt avaliado e termos registrados (RF-RAD-01); scrape com robots_ok = false nunca liga (RF-RAD-03).';


-- ---------------------------------------------------------------------------
-- 11. Permissões
-- ---------------------------------------------------------------------------
-- As funções de apoio no schema `app` nascem com o EXECUTE que o Postgres dá a
-- PUBLIC (e anon herda). A migração 000500 fecha isso para as funções que existiam
-- até ela; as criadas depois precisam fechar sozinhas, e o teste 09 varre o schema
-- inteiro cobrando exatamente isto.
revoke all on function app.cpf_is_valid(text) from public, anon;
revoke all on function app.ddd_da_regiao(text) from public, anon;
grant execute on function app.cpf_is_valid(text) to authenticated, service_role;
grant execute on function app.ddd_da_regiao(text) to authenticated, service_role;
-- Função de gatilho não é superfície de API: o Postgres a chama em nome do dono do
-- gatilho, então ninguém da API precisa de EXECUTE nela.
revoke all on function app.supplier_candidates_normalize() from authenticated, anon, public;

revoke all on function public.radar_resumo() from public;
revoke all on function public.radar_fila(text,int,int,text,boolean,int,int) from public;
revoke all on function public.radar_criar_candidato(text,int,int,text,text,text,text,text,int,text,text) from public;
revoke all on function public.radar_revisar_candidato(uuid,text,uuid,int,text) from public;
revoke all on function public.radar_alternar_fonte(int, boolean) from public;

grant execute on function public.radar_resumo() to authenticated;
grant execute on function public.radar_fila(text,int,int,text,boolean,int,int) to authenticated;
grant execute on function public.radar_criar_candidato(text,int,int,text,text,text,text,text,int,text,text) to authenticated;
grant execute on function public.radar_revisar_candidato(uuid,text,uuid,int,text) to authenticated;
grant execute on function public.radar_alternar_fonte(int, boolean) to authenticated;

grant select, insert, update on public.supplier_candidates to authenticated;
grant delete on public.supplier_candidates to authenticated;

-- =====================================================================
-- TRIADE — v0.1 — D9 — Integração com a plataforma Komune, lado TRIADE
-- (RF-PRE-01/07/13/16, RF-ADM-03; PRD §7.6, §9.4, §10.6; ADR-02, ADR-04,
--  ADR-08, ADR-11; anexos R06 e R10.)
--
-- Este arquivo é o CONTRATO DE DADOS das quatro Edge Functions do Triade
-- (`komune-push`, `komune-webhook`, `claim-link`, `export-lgpd`). As funções
-- são finas de propósito: HTTP, assinatura e nada mais. Toda decisão —
-- idempotência, permissão, retenção, o que pode ou não sair — mora aqui
-- (ADR-03).
--
-- O que entrega
--   A. `app.segredo(nome)` — leitura do Vault por quem é service_role e mais
--      ninguém. Nenhum segredo neste arquivo; só o nome dele.
--   B. Saída (Triade → Komune): fila `komune_sync` (pgmq) + `komune_outbox`
--      como livro-caixa durável. Chave de idempotência é o par
--      (pre_registration_id, versão do payload): reenviar o mesmo estado é
--      inócuo, e a Komune recebe `Idempotency-Key` para provar isso do lado
--      dela. Backoff exponencial, teto de tentativas, dead-letter.
--      NADA SAI ENQUANTO `integracao.komune_push_ativo` for false — é a
--      chave geral, e ela nasce desligada.
--   C. Entrada (Komune → Triade): `webhook_deliveries` (idempotência por
--      `delivery_id`, com a assinatura já verificada na borda) e
--      `app.komune_aplicar_evento`, que traduz o evento externo para a linha
--      do tempo interna (`pre_registration_events`, actor = 'komune').
--   D. Direito de acesso do titular (LGPD art. 18, I/II e art. 9º; R06 §61):
--      `app.lgpd_dossie` monta tudo o que o CRM guarda sobre uma organização,
--      COM A PROVENIÊNCIA CAMPO A CAMPO — a resposta que a KASPR não deu.
--      Duas portas: `public.exportar_lgpd` (gestor/admin, auditada em
--      `pii_access_log`) e `public.exportar_lgpd_por_token` (o próprio
--      titular, com o token de reivindicação, sem login).
--
-- O que NÃO faz
--   * Não escreve no banco da Komune, nem lê. Nunca. A única porta é o POST
--     assinado para a Edge Function `crm-pre-registration` do lado de lá
--     (ADR-02). O contrato está em docs/operacao/contrato-precadastro.md.
--   * Não envia mensagem a ninguém. O push é sistema-para-sistema, e só
--     acontece depois de autorização registrada em `consent_events` — a mesma
--     porteira que `gerar_link_de_reivindicacao` já aplica.
--   * Não guarda o token de reivindicação em claro em lugar nenhum: o que vai
--     para a Komune é o `claim_token_hash`, como manda o RF-PRE-01.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- A. SEGREDOS — Vault, e só o Vault
-- ---------------------------------------------------------------------------
-- A Edge Function tenta primeiro a variável de ambiente; se não achar, cai
-- aqui. Em produção o Vault é a fonte, porque um `supabase secrets set` some
-- num redeploy e o Vault não.
create or replace function app.segredo(p_nome text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if p_nome is null or p_nome !~ '^[a-z0-9_]{3,60}$' then
    raise exception 'Nome de segredo inválido' using errcode = '22023';
  end if;
  select s.decrypted_secret into v
    from vault.decrypted_secrets s
   where s.name = p_nome
   order by s.created_at desc
   limit 1;
  return v;
end $$;
comment on function app.segredo(text) is
  'Lê um segredo do Vault pelo nome. Só service_role executa. O valor nunca entra em log, em audit_log nem em retorno de RPC de tela.';

-- Gravar segredo é ato de administrador, feito uma vez, fora do código.
create or replace function app.gravar_segredo(p_nome text, p_valor text, p_descricao text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_nome is null or p_nome !~ '^[a-z0-9_]{3,60}$' then
    raise exception 'Nome de segredo inválido' using errcode = '22023';
  end if;
  if coalesce(trim(p_valor), '') = '' then
    raise exception 'Segredo vazio não é segredo' using errcode = '22023';
  end if;
  select s.id into v_id from vault.secrets s where s.name = p_nome;
  if v_id is null then
    perform vault.create_secret(p_valor, p_nome, coalesce(p_descricao, 'Integração Komune'));
  else
    perform vault.update_secret(v_id, p_valor, p_nome, coalesce(p_descricao, 'Integração Komune'));
  end if;
end $$;
comment on function app.gravar_segredo(text, text, text) is
  'Grava ou substitui um segredo no Vault. Chamada uma vez, à mão, por quem tem service_role. Nenhum segredo está versionado neste repositório.';

revoke all on function app.segredo(text)                     from public, anon, authenticated;
revoke all on function app.gravar_segredo(text, text, text)  from public, anon, authenticated;
grant execute on function app.segredo(text)                  to service_role;
grant execute on function app.gravar_segredo(text, text, text) to service_role;

-- Chave geral da integração. Nasce DESLIGADA: a fila enche, nada sai, e quem
-- liga é gente com papel de gestor, depois que o Matheus subir o outro lado.
insert into public.app_settings (key, value, description) values
  ('integracao.komune',
   jsonb_build_object('push_ativo', false,
                      'lote', 10,
                      'max_tentativas', 6,
                      'janela_replay_segundos', 300,
                      'versao_payload', 'v0'),
   'Integração com a plataforma Komune (ADR-02). push_ativo = false segura tudo na fila; nada sai antes de o lado de lá existir e de alguém ligar a chave.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- B. SAÍDA — fila `komune_sync` + livro-caixa `komune_outbox`
-- ---------------------------------------------------------------------------
do $$
declare
  q text;
begin
  foreach q in array array['komune_sync', 'komune_dlq'] loop
    if not exists (select 1 from pgmq.list_queues() lq where lq.queue_name = q) then
      perform pgmq.create(q);
    end if;
  end loop;
end $$;

create table if not exists public.komune_outbox (
  id                  uuid primary key default gen_random_uuid(),
  pre_registration_id uuid not null references public.pre_registrations(id) on delete cascade,
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  motivo              text not null check (motivo in ('rascunho_criado', 'link_emitido',
                                                      'reivindicado', 'reenvio_manual',
                                                      'reconciliacao')),
  payload             jsonb not null,
  payload_hash        text  not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key     text  not null unique,
  status              text  not null default 'pendente'
                        check (status in ('pendente', 'enviado', 'falhou', 'descartado')),
  attempts            int   not null default 0,
  msg_id              bigint,
  http_status         int,
  last_error          text,
  komune_supplier_id  uuid,
  first_seen_at       timestamptz not null default now(),
  sent_at             timestamptz,
  updated_at          timestamptz not null default now(),
  -- ADR-09 de novo, agora na porta de saída: o que vai para a Komune passa
  -- pelo mesmo crivo do rascunho. Defesa em profundidade, de propósito.
  constraint komune_outbox_sem_dado_sensivel check (
    not (payload -> 'perfil') ?| array['cpf', 'CPF', 'pix', 'PIX', 'chave_pix', 'conta',
                                       'conta_bancaria', 'agencia', 'banco', 'cartao',
                                       'cnpj_faturamento']),
  -- O token em claro nunca sai daqui. Só o hash (RF-PRE-01).
  constraint komune_outbox_sem_token_claro check (not payload ? 'claim_token')
);
comment on table public.komune_outbox is
  'Livro-caixa da escrita Triade → Komune. A fila pgmq komune_sync carrega só o id desta linha; o estado durável (payload, tentativas, erro, resposta) é esta tabela. Idempotência por (pré-cadastro + hash do payload): reenviar o mesmo estado é inócuo.';
comment on column public.komune_outbox.idempotency_key is
  'Vai no cabeçalho Idempotency-Key do POST. Formato "<pre_registration_id>:<12 primeiros do hash>". A Komune deve tratar chave repetida como no-op e devolver 200 com o mesmo komune_supplier_id.';

create index if not exists komune_outbox_pend_idx on public.komune_outbox (first_seen_at)
  where status = 'pendente';
create index if not exists komune_outbox_pre_idx  on public.komune_outbox (pre_registration_id, first_seen_at desc);
create index if not exists komune_outbox_org_idx  on public.komune_outbox (organization_id);

alter table public.komune_outbox enable row level security;
-- Ninguém de tela escreve na fila de saída: quem escreve é gatilho e RPC
-- definer. Gestor lê para poder explicar por que algo não subiu.
drop policy if exists komune_outbox_select on public.komune_outbox;
create policy komune_outbox_select on public.komune_outbox
  for select to authenticated using ((select app.is_manager()));

drop trigger if exists audit_komune_outbox on public.komune_outbox;
create trigger audit_komune_outbox
  after insert or update on public.komune_outbox
  for each row execute function app.audit();


-- B.1 O payload do contrato mínimo v0 (PRD §7.6 / RF-PRE-01)
create or replace function app.komune_payload(p_pre_registration_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pr public.pre_registrations%rowtype;
  o  public.organizations%rowtype;
  ac public.pre_registration_acceptances%rowtype;
begin
  select * into pr from public.pre_registrations where id = p_pre_registration_id;
  if not found then
    raise exception 'Pré-cadastro % não existe', p_pre_registration_id using errcode = '22023';
  end if;
  select * into o from public.organizations where id = pr.organization_id;

  select * into ac from public.pre_registration_acceptances a
   where a.pre_registration_id = pr.id
   order by a.accepted_at desc limit 1;

  return jsonb_strip_nulls(jsonb_build_object(
    'versao',                 coalesce((select s.value ->> 'versao_payload'
                                          from public.app_settings s
                                         where s.key = 'integracao.komune'), 'v0'),
    'pre_registration_id',    pr.id,
    'crm_organization_id',    pr.organization_id,
    'origin',                 'crm_pre_registration',
    'source_url',             pr.source_url,
    'source_label',           pr.source_label,
    'publish_status',         'draft',
    'published',              false,
    'nome',                   o.name,
    'claim_token_hash',       pr.claim_token_hash,
    'claim_token_expires_at', pr.claim_token_expires_at,
    'claimed_at',             pr.claimed_at,
    'perfil',                 pr.prefilled,
    'aceite',                 case when ac.id is null then null else jsonb_build_object(
                                'terms_version',           ac.terms_version,
                                'terms_hash',              ac.terms_hash,
                                'accepted_at',             ac.accepted_at,
                                'auth_method',             ac.auth_method,
                                'marketing_optin',         ac.marketing_optin,
                                'photo_import_authorized', ac.photo_import_authorized) end,
    'emitido_em',             now()));
end $$;
comment on function app.komune_payload(uuid) is
  'Contrato mínimo v0 do POST crm-pre-registration (RF-PRE-01): cinco campos de origem em suppliers + o perfil factual da whitelist + a prova do aceite. Sem IP, sem user-agent, sem token em claro, sem foto.';


-- B.2 Enfileirar
create or replace function app.komune_enfileirar(p_pre_registration_id uuid,
                                                 p_motivo text default 'reenvio_manual')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr      public.pre_registrations%rowtype;
  v_pay   jsonb;
  v_hash  text;
  v_key   text;
  v_id    uuid;
  v_msg   bigint;
begin
  select * into pr from public.pre_registrations where id = p_pre_registration_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pre_cadastro_inexistente');
  end if;
  if pr.purged_at is not null or pr.refused_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'rascunho_encerrado');
  end if;
  -- O guardrail: nenhum dado sobe para a Komune sem autorização registrada.
  if not app.tem_autorizacao_vigente(pr.organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_autorizacao');
  end if;
  if app.is_suppressed_target(pr.organization_id, pr.contact_id) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido');
  end if;

  v_pay  := app.komune_payload(pr.id);
  -- O hash ignora o carimbo de emissão: dois pedidos do mesmo estado têm a
  -- mesma chave, e o segundo não vira um segundo POST.
  v_hash := app.sha256_hex((v_pay - 'emitido_em')::text);
  v_key  := pr.id::text || ':' || left(v_hash, 12);

  insert into public.komune_outbox
    (pre_registration_id, organization_id, motivo, payload, payload_hash, idempotency_key)
  values (pr.id, pr.organization_id, p_motivo, v_pay, v_hash, v_key)
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'enfileirado', false, 'motivo', 'estado_ja_enfileirado');
  end if;

  select s into v_msg from pgmq.send('komune_sync', jsonb_build_object('outbox_id', v_id)) s;
  update public.komune_outbox set msg_id = v_msg, updated_at = now() where id = v_id;

  return jsonb_build_object('ok', true, 'enfileirado', true, 'outbox_id', v_id,
                            'idempotency_key', v_key);
end $$;
comment on function app.komune_enfileirar(uuid, text) is
  'Põe um estado do pré-cadastro na fila de saída. Recusa sem autorização vigente e para alvo suprimido. Mesmo estado duas vezes = uma mensagem só.';


-- B.3 O gatilho: o que faz nascer um pedido de push
-- Só dois momentos, e os dois já passaram por gente ou pelo titular:
--   1. o link foi emitido (a Komune precisa do hash do token para validar a
--      reivindicação do lado dela) — e emitir link já exige autorização;
--   2. o titular reivindicou e aceitou os termos com prova.
create or replace function app.pre_registrations_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text;
begin
  if tg_op = 'UPDATE'
     and new.claim_token_hash is not null
     and new.claim_token_hash is distinct from old.claim_token_hash then
    v_motivo := 'link_emitido';
  elsif tg_op = 'UPDATE'
     and new.claimed_at is not null and old.claimed_at is null then
    v_motivo := 'reivindicado';
  else
    return null;
  end if;

  perform app.komune_enfileirar(new.id, v_motivo);
  return null;
exception when others then
  -- A integração jamais derruba a reivindicação do fornecedor. Se a fila
  -- falhar, o pedido fica para a reconciliação noturna e a pessoa segue.
  insert into public.pre_registration_events
    (pre_registration_id, organization_id, event, payload, actor)
  values (new.id, new.organization_id, 'profile_reviewed',
          jsonb_build_object('erro_fila_komune', left(sqlerrm, 300)), 'system');
  return null;
end $$;

drop trigger if exists zz_pre_registrations_push on public.pre_registrations;
create trigger zz_pre_registrations_push
  after update on public.pre_registrations
  for each row execute function app.pre_registrations_push();


-- B.4 O que a Edge Function `komune-push` chama
create or replace function app.komune_proximos(p_qty int default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb;
  v_ativo boolean;
  v_lote  int;
  v_out   jsonb := '[]'::jsonb;
  m       record;
  ob      public.komune_outbox%rowtype;
begin
  select s.value into v_cfg from public.app_settings s where s.key = 'integracao.komune';
  v_ativo := coalesce((v_cfg ->> 'push_ativo')::boolean, false);
  v_lote  := least(greatest(coalesce(p_qty, coalesce((v_cfg ->> 'lote')::int, 10)), 1), 50);

  if not v_ativo then
    return jsonb_build_object('ativo', false, 'itens', '[]'::jsonb,
                              'motivo', 'integracao.komune.push_ativo esta desligado');
  end if;

  -- 120 s de visibilidade: cabe um POST lento e o registro do resultado.
  for m in select * from pgmq.read('komune_sync', 120, v_lote) loop
    select * into ob from public.komune_outbox
     where id = (m.message ->> 'outbox_id')::uuid;
    if not found or ob.status <> 'pendente' then
      perform pgmq.archive('komune_sync', m.msg_id);
      continue;
    end if;
    v_out := v_out || jsonb_build_object(
      'msg_id',          m.msg_id,
      'outbox_id',       ob.id,
      'idempotency_key', ob.idempotency_key,
      'tentativas',      ob.attempts,
      'payload',         ob.payload);
  end loop;

  return jsonb_build_object('ativo', true, 'itens', v_out);
end $$;
comment on function app.komune_proximos(int) is
  'Lote de pedidos de push para a Edge Function komune-push. Devolve ativo=false, e nenhum item, enquanto a chave geral estiver desligada.';

create or replace function app.komune_sucesso(p_msg_id bigint, p_outbox_id uuid,
                                              p_http_status int,
                                              p_komune_supplier_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ob public.komune_outbox%rowtype;
begin
  update public.komune_outbox
     set status             = 'enviado',
         attempts           = attempts + 1,
         http_status        = p_http_status,
         komune_supplier_id = coalesce(p_komune_supplier_id, komune_supplier_id),
         last_error         = null,
         sent_at            = now(),
         updated_at         = now()
   where id = p_outbox_id
   returning * into ob;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'outbox_inexistente');
  end if;

  perform pgmq.archive('komune_sync', p_msg_id);

  if p_komune_supplier_id is not null then
    update public.pre_registrations
       set komune_supplier_id = p_komune_supplier_id
     where id = ob.pre_registration_id and komune_supplier_id is distinct from p_komune_supplier_id;
    update public.organizations
       set komune_supplier_id = p_komune_supplier_id
     where id = ob.organization_id and komune_supplier_id is distinct from p_komune_supplier_id;
  end if;

  insert into public.pre_registration_events
    (pre_registration_id, organization_id, event, payload, actor)
  values (ob.pre_registration_id, ob.organization_id, 'profile_reviewed',
          jsonb_build_object('integracao', 'komune-push', 'motivo', ob.motivo,
                             'http', p_http_status,
                             'komune_supplier_id', p_komune_supplier_id), 'komune');

  return jsonb_build_object('ok', true);
end $$;

create or replace function app.komune_falha(p_msg_id bigint, p_outbox_id uuid,
                                            p_erro text, p_http_status int default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ob    public.komune_outbox%rowtype;
  v_max int;
  v_vt  int;
begin
  select coalesce((s.value ->> 'max_tentativas')::int, 6) into v_max
    from public.app_settings s where s.key = 'integracao.komune';

  update public.komune_outbox
     set attempts    = attempts + 1,
         last_error  = left(coalesce(p_erro, 'erro sem descrição'), 500),
         http_status = p_http_status,
         updated_at  = now()
   where id = p_outbox_id
   returning * into ob;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'outbox_inexistente');
  end if;

  if ob.attempts >= coalesce(v_max, 6) then
    update public.komune_outbox set status = 'falhou', updated_at = now() where id = ob.id;
    perform pgmq.send('komune_dlq', jsonb_build_object(
      'outbox_id', ob.id, 'pre_registration_id', ob.pre_registration_id,
      'tentativas', ob.attempts, 'erro', ob.last_error, 'http', p_http_status));
    perform pgmq.archive('komune_sync', p_msg_id);
    return jsonb_build_object('ok', true, 'dead_letter', true, 'tentativas', ob.attempts);
  end if;

  -- 30 s dobrando, teto de 1 h — o mesmo backoff da esteira.
  v_vt := least(3600, (30 * power(2, greatest(ob.attempts - 1, 0)))::int);
  perform pgmq.set_vt('komune_sync', p_msg_id, v_vt);
  return jsonb_build_object('ok', true, 'dead_letter', false,
                            'tentativas', ob.attempts, 'proxima_em_segundos', v_vt);
end $$;

comment on function app.komune_falha(bigint, uuid, text, int) is
  'Retry com backoff exponencial (30 s dobrando, teto 1 h). Passado o teto de tentativas, a mensagem vai para komune_dlq e a linha do outbox fica "falhou" — leitura humana, nunca reenvio automático em loop.';


-- ---------------------------------------------------------------------------
-- C. ENTRADA — webhook de status da Komune
-- ---------------------------------------------------------------------------
create table if not exists public.webhook_deliveries (
  source       text not null check (source in ('komune', 'meta')),
  delivery_id  text not null check (length(trim(delivery_id)) between 1 and 200),
  event        text,
  payload      jsonb not null default '{}'::jsonb,
  result       jsonb not null default '{}'::jsonb,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  primary key (source, delivery_id)
);
comment on table public.webhook_deliveries is
  'Idempotência dos webhooks de entrada. A assinatura é verificada na borda (Edge Function) ANTES de qualquer escrita; esta tabela garante que a mesma entrega, reentregue, não produza um segundo efeito.';
create index if not exists webhook_deliveries_recebido_idx on public.webhook_deliveries (source, received_at desc);

alter table public.webhook_deliveries enable row level security;
drop policy if exists webhook_deliveries_select on public.webhook_deliveries;
create policy webhook_deliveries_select on public.webhook_deliveries
  for select to authenticated using ((select app.is_manager()));

-- O dicionário do contrato: evento externo → evento da linha do tempo interna.
create table if not exists public.komune_event_map (
  external      text primary key,
  internal      text not null,
  atualiza      text,
  description   text
);
comment on table public.komune_event_map is
  'Tradução do vocabulário da Komune para os eventos de onboarding do R10 §5.2. Evento fora desta tabela é aceito, registrado e ignorado — nunca derruba a entrega.';

insert into public.komune_event_map (external, internal, atualiza, description) values
  ('supplier.claimed',            'claimed',              'claimed',      'O fornecedor criou a conta e assumiu o rascunho na plataforma.'),
  ('supplier.published',          'published',            'published',    'O perfil foi publicado.'),
  ('supplier.unpublished',        'unpublished',          'unpublished',  'O perfil saiu do ar.'),
  ('supplier.publish_requested',  'publish_requested',    'status',       'O fornecedor pediu publicação; entrou na curadoria.'),
  ('supplier.returned',           'returned',             'status',       'A curadoria devolveu com motivo.'),
  ('supplier.completeness',       'profile_reviewed',     'completude',   'Mudou o percentual de completude do perfil.'),
  ('supplier.profile_50',         'profile_50',           null,           'Perfil passou de 50%.'),
  ('supplier.profile_100',        'profile_100',          null,           'Perfil completo.'),
  ('supplier.photos_added',       'photos_added',         null,           'O fornecedor subiu fotos próprias.'),
  ('supplier.wallet_ready',       'wallet_ready',         null,           'Dados de recebimento concluídos NA PLATAFORMA (o CRM não guarda nenhum deles).'),
  ('supplier.documents',          'documents_submitted',  null,           'Documentos do selo Verificado enviados.'),
  ('supplier.verified',           'verified',             null,           'Selo Verificado concedido.'),
  ('supplier.verification_rejected', 'verification_rejected', null,       'Selo Verificado recusado.'),
  ('supplier.paused',             'paused',               null,           'O fornecedor pausou o perfil.'),
  ('lead.first',                  'first_lead',           null,           'Primeiro lead recebido na plataforma.'),
  ('lead.first_view',             'first_view',           null,           'Primeira visualização do perfil.'),
  ('response.first',              'first_response',       null,           'Primeira resposta do fornecedor a um lead.'),
  ('proposal.first',              'first_proposal',       null,           'Primeira proposta enviada.'),
  ('deal.first',                  'first_deal',           null,           'Primeiro negócio fechado na plataforma.')
on conflict (external) do update
  set internal = excluded.internal, atualiza = excluded.atualiza,
      description = excluded.description;

grant select on public.komune_event_map to authenticated;

create or replace function app.komune_aplicar_evento(p_delivery_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evt      text := p_payload ->> 'event';
  v_pre_id   uuid;
  v_org      uuid;
  pr         public.pre_registrations%rowtype;
  v_map      public.komune_event_map%rowtype;
  v_dados    jsonb := coalesce(p_payload -> 'dados', '{}'::jsonb);
  v_res      jsonb;
  v_novo     boolean;
begin
  if coalesce(trim(p_delivery_id), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'entrega_sem_id');
  end if;

  -- Idempotência antes de qualquer efeito.
  insert into public.webhook_deliveries (source, delivery_id, event, payload)
  values ('komune', trim(p_delivery_id), v_evt, p_payload)
  on conflict (source, delivery_id) do nothing;
  v_novo := found;
  if not v_novo then
    select d.result into v_res from public.webhook_deliveries d
     where d.source = 'komune' and d.delivery_id = trim(p_delivery_id);
    return jsonb_build_object('ok', true, 'duplicado', true, 'resultado', coalesce(v_res, '{}'::jsonb));
  end if;

  -- Achar o rascunho: pelo id do pré-cadastro, pela organização ou pelo id do
  -- fornecedor lá. Qualquer um dos três serve; nenhum é obrigatório sozinho.
  v_pre_id := nullif(p_payload ->> 'pre_registration_id', '')::uuid;
  v_org    := nullif(p_payload ->> 'crm_organization_id', '')::uuid;

  if v_pre_id is not null then
    select * into pr from public.pre_registrations where id = v_pre_id;
  elsif v_org is not null then
    select * into pr from public.pre_registrations where organization_id = v_org;
  elsif nullif(p_payload ->> 'komune_supplier_id', '') is not null then
    select * into pr from public.pre_registrations
     where komune_supplier_id = (p_payload ->> 'komune_supplier_id')::uuid;
  end if;

  if pr.id is null then
    v_res := jsonb_build_object('ok', true, 'aplicado', false, 'motivo', 'pre_cadastro_nao_encontrado');
    update public.webhook_deliveries
       set processed_at = now(), result = v_res
     where source = 'komune' and delivery_id = trim(p_delivery_id);
    return v_res;
  end if;

  select * into v_map from public.komune_event_map where external = v_evt;
  if not found then
    v_res := jsonb_build_object('ok', true, 'aplicado', false, 'motivo', 'evento_desconhecido',
                                'evento', v_evt);
    update public.webhook_deliveries
       set processed_at = now(), result = v_res
     where source = 'komune' and delivery_id = trim(p_delivery_id);
    return v_res;
  end if;

  -- O id do fornecedor na Komune, quando vier, cola nos dois lados.
  if nullif(p_payload ->> 'komune_supplier_id', '') is not null then
    update public.pre_registrations
       set komune_supplier_id = (p_payload ->> 'komune_supplier_id')::uuid
     where id = pr.id and komune_supplier_id is distinct from (p_payload ->> 'komune_supplier_id')::uuid;
    update public.organizations
       set komune_supplier_id = (p_payload ->> 'komune_supplier_id')::uuid
     where id = pr.organization_id
       and komune_supplier_id is distinct from (p_payload ->> 'komune_supplier_id')::uuid;
  end if;

  -- O efeito de estado, quando houver. Publicar é o único que pode ser
  -- RECUSADO aqui: o gatilho do rascunho exige reivindicação e aceite provado,
  -- e essa regra vale mesmo quando quem afirma o contrário é a plataforma.
  if v_map.atualiza = 'claimed' then
    update public.pre_registrations
       set claimed_at      = coalesce(claimed_at,
                               coalesce(nullif(p_payload ->> 'occurred_at', '')::timestamptz, now())),
           claimed_channel = coalesce(claimed_channel, 'cs_manual'),
           status          = 'in_progress'::app.prereg_status,
           claim_token_hash = null, claim_token_expires_at = null
     where id = pr.id and claimed_at is null;

  elsif v_map.atualiza = 'published' then
    if pr.claimed_at is null
       or not exists (select 1 from public.pre_registration_acceptances a
                       where a.pre_registration_id = pr.id
                         and a.terms_accepted and a.data_authorization) then
      v_res := jsonb_build_object('ok', true, 'aplicado', false,
                                  'motivo', 'publicacao_sem_aceite_provado');
      insert into public.pre_registration_events
        (pre_registration_id, organization_id, event, payload, actor)
      values (pr.id, pr.organization_id, 'returned',
              jsonb_build_object('recusa', 'A Komune informou publicação sem aceite provado no CRM (RF-PRE-02).'),
              'komune');
      update public.webhook_deliveries
         set processed_at = now(), result = v_res
       where source = 'komune' and delivery_id = trim(p_delivery_id);
      return v_res;
    end if;
    update public.pre_registrations
       set published = true, status = 'published'::app.prereg_status
     where id = pr.id;

  elsif v_map.atualiza = 'unpublished' then
    update public.pre_registrations
       set published = false, status = 'in_progress'::app.prereg_status
     where id = pr.id;

  elsif v_map.atualiza = 'completude' then
    update public.pre_registrations
       set completeness_score     = coalesce((v_dados ->> 'completeness_score')::smallint,
                                             completeness_score),
           completeness_breakdown = coalesce(v_dados -> 'breakdown', completeness_breakdown)
     where id = pr.id;

  elsif v_map.atualiza = 'status' then
    update public.pre_registrations
       set status = case when v_map.internal = 'publish_requested'
                         then 'completed'::app.prereg_status
                         else 'in_progress'::app.prereg_status end
     where id = pr.id;
  end if;

  insert into public.pre_registration_events
    (pre_registration_id, organization_id, event, payload, actor, occurred_at)
  values (pr.id, pr.organization_id, v_map.internal,
          v_dados || jsonb_build_object('evento_komune', v_evt),
          'komune',
          coalesce(nullif(p_payload ->> 'occurred_at', '')::timestamptz, now()));

  v_res := jsonb_build_object('ok', true, 'aplicado', true, 'evento', v_map.internal,
                              'pre_registration_id', pr.id);
  update public.webhook_deliveries
     set processed_at = now(), result = v_res
   where source = 'komune' and delivery_id = trim(p_delivery_id);
  return v_res;
end $$;
comment on function app.komune_aplicar_evento(text, jsonb) is
  'Aplica um evento de status vindo da Komune (RF-PRE-13). Idempotente por delivery_id. Evento desconhecido é registrado e ignorado. Publicação sem aceite provado é RECUSADA — a regra do CRM vale mesmo contra a afirmação da plataforma.';


-- ---------------------------------------------------------------------------
-- D. DIREITO DE ACESSO DO TITULAR (LGPD art. 18, I/II; art. 9º; R06 §61)
-- ---------------------------------------------------------------------------
-- "De onde vocês pegaram meu número?" tem uma resposta certa: a fonte
-- ESPECÍFICA, campo a campo. É o que a KASPR não deu, e por isso foi multada.
create or replace function app.lgpd_dossie(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations%rowtype;
begin
  select * into o from public.organizations where id = p_organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'organizacao_inexistente');
  end if;

  return jsonb_build_object(
    'ok', true,
    'gerado_em', now(),
    'controlador', jsonb_build_object(
      'nome', 'KOMUNE',
      'produto', 'Triade — CRM de captação',
      'canal_do_titular', 'privacidade@komune.app.br',
      'base_legal', 'Legítimo interesse (LGPD art. 7º, IX) sobre dados profissionais públicos (art. 7º, §§3º e 4º)'),
    'organizacao', jsonb_build_object(
      'id', o.id, 'nome', o.name, 'tipo', o.kind, 'razao_social', o.legal_name,
      'cnpj', o.cnpj, 'telefone', o.phone_e164, 'email', o.email,
      'instagram', o.instagram_handle, 'site', o.website,
      'bairro', o.neighborhood, 'endereco', o.address,
      'coletado_em', o.collected_at, 'coletado_por', o.collector,
      'link_de_origem', o.source_url,
      'nao_contatar', o.do_not_contact, 'temperatura', o.temperature,
      'criado_em', o.created_at, 'anonimizado_em', o.anonymized_at),
    'fonte_da_coleta', (select jsonb_build_object('id', s.id, 'nome', s.name)
                          from public.sources s where s.id = o.source_id),
    -- A proveniência é o coração do direito de acesso: cada campo, com a URL
    -- exata de onde veio, quando, por qual ferramenta e sob qual base legal.
    'proveniencia', coalesce((
      select jsonb_agg(jsonb_build_object(
               'campo', fp.field, 'acao', fp.action, 'link_de_origem', fp.source_url,
               'fonte', (select s2.name from public.sources s2 where s2.id = fp.source_id),
               'coletado_em', fp.collected_at, 'coletor', fp.collector,
               'ferramenta', fp.tool, 'base_legal', fp.legal_basis, 'versao_lia', fp.lia_version)
               order by fp.collected_at, fp.id)
        from public.field_provenance fp
       where fp.record_type = 'organization' and fp.record_id = o.id), '[]'::jsonb),
    'contatos', coalesce((
      select jsonb_agg(jsonb_build_object('nome', c.full_name, 'cargo', c.role_title,
                                          'telefone', c.phone_e164, 'email', c.email,
                                          'nao_contatar', c.do_not_contact)
               order by c.created_at)
        from public.contacts c
        join public.organization_contacts oc on oc.contact_id = c.id
       where oc.organization_id = o.id), '[]'::jsonb),
    'consentimentos', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', ce.kind, 'canal', ce.channel,
                                          'quando', ce.occurred_at, 'evidencia', ce.evidence_text)
               order by ce.occurred_at)
        from public.consent_events ce where ce.organization_id = o.id), '[]'::jsonb),
    'interacoes', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', a.type, 'quando', a.occurred_at,
                                          'canal', a.channel, 'resumo', a.body)
               order by a.occurred_at)
        from public.activities a where a.organization_id = o.id), '[]'::jsonb),
    'pre_cadastro', (
      select jsonb_build_object('status', pr.status, 'publicado', pr.published,
                                'rascunho', pr.prefilled, 'origem', pr.source_label,
                                'link_de_origem', pr.source_url,
                                'criado_em', pr.created_at, 'expira_em', pr.expires_at,
                                'reivindicado_em', pr.claimed_at, 'apagado_em', pr.purged_at)
        from public.pre_registrations pr where pr.organization_id = o.id),
    'compartilhado_com', jsonb_build_array(
      jsonb_build_object('quem', 'Meta (WhatsApp Business Cloud API)',
                         'o_que', 'Número de telefone e conteúdo das mensagens trocadas',
                         'quando', 'Somente se houve conversa por WhatsApp'),
      jsonb_build_object('quem', 'Supabase (nuvem, região São Paulo)',
                         'o_que', 'Hospedagem do banco de dados', 'quando', 'Sempre'),
      jsonb_build_object('quem', 'Anthropic (Claude)',
                         'o_que', 'Texto das mensagens pseudonimizado, para classificação e rascunho',
                         'quando', 'Somente se houve conversa'),
      jsonb_build_object('quem', 'Plataforma Komune',
                         'o_que', 'Perfil pré-preenchido do marketplace',
                         'quando', 'Somente após autorização registrada')),
    'retencao', 'Lead sem resposta é anonimizado em 6 meses. Rascunho não reivindicado é apagado em 30 dias. Registros de acesso ficam 12 meses (Marco Civil art. 15).',
    'direitos', 'Você pode pedir correção, eliminação, oposição e portabilidade a qualquer momento, respondendo SAIR no WhatsApp ou escrevendo para privacidade@komune.app.br.');
end $$;
comment on function app.lgpd_dossie(uuid) is
  'Dossiê do art. 18 (I/II) e art. 9º: tudo o que o CRM guarda sobre uma organização, COM a proveniência campo a campo e a URL exata da coleta. Interna: quem chama é exportar_lgpd ou exportar_lgpd_por_token.';

-- A porta interna. Exportar é ato registrado (R06 ACC-03).
do $$
begin
  alter table public.pii_access_log drop constraint if exists pii_access_log_action_check;
  alter table public.pii_access_log add constraint pii_access_log_action_check
    check (action in ('reveal_phone', 'export_csv', 'bulk_view', 'view_contact_phone',
                      'export_lgpd'));
end $$;

create or replace function public.exportar_lgpd(p_organization_id uuid,
                                                p_motivo text default 'pedido_do_titular')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  -- Exportação é poder: gestor, admin ou quem responde pelo titular
  -- (o encarregado tem papel `leitura` e é quem responde no PRD §4).
  if not (app.is_manager() or app.reads_base_pii()) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'exportacao_exige_motivo');
  end if;

  v_res := app.lgpd_dossie(p_organization_id);
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    return v_res;
  end if;

  insert into public.pii_access_log (actor_id, actor_role, action, entity_type, entity_id, scope)
  values (v_uid, app.role()::text, 'export_lgpd', 'organization', p_organization_id,
          jsonb_build_object('motivo', trim(p_motivo)));

  insert into public.consent_events (kind, organization_id, channel, evidence_text, recorded_by)
  values ('access_request'::app.consent_kind, p_organization_id, 'email'::app.channel,
          'Exportação do dossiê LGPD: ' || trim(p_motivo), v_uid);

  return v_res;
end $$;
comment on function public.exportar_lgpd(uuid, text) is
  'Direito de acesso, porta interna (RF-ADM-03). Só gestor, admin ou o encarregado. Exige motivo, registra em pii_access_log e abre um access_request em consent_events — o pedido do titular fica provado dos dois lados.';

-- A porta do próprio titular: o token de reivindicação, sem login. Ninguém
-- precisa criar conta na Komune para saber o que a Komune guarda dele.
create or replace function public.exportar_lgpd_por_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr    public.pre_registrations%rowtype;
  v_res jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;
  select * into pr from public.pre_registrations
   where claim_token_hash = app.sha256_hex(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;
  if pr.claim_token_expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'token_expirado');
  end if;

  v_res := app.lgpd_dossie(pr.organization_id);

  insert into public.consent_events (kind, organization_id, contact_id, channel, evidence_text)
  values ('access_request'::app.consent_kind, pr.organization_id, pr.contact_id,
          'whatsapp'::app.channel,
          'Titular baixou o próprio dossiê pela página de reivindicação, sem login');

  insert into public.pre_registration_events
    (pre_registration_id, organization_id, event, payload, actor)
  values (pr.id, pr.organization_id, 'profile_reviewed',
          jsonb_build_object('acao', 'dossie_lgpd_baixado_pelo_titular'), 'supplier');

  return v_res;
end $$;
comment on function public.exportar_lgpd_por_token(text) is
  'Direito de acesso, porta do titular (R06 §61). Quem tem o token vê tudo o que o CRM guarda sobre a própria empresa, com a URL exata de onde cada campo veio. Sem login, sem conta, sem atrito.';


-- ---------------------------------------------------------------------------
-- E. AGENDAMENTO — o disparo do push, se e quando houver para onde disparar
-- ---------------------------------------------------------------------------
create or replace function app.komune_push_disparar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url  text := app.segredo('triade_functions_url');
  v_key  text := app.segredo('triade_service_role_key');
  v_cfg  jsonb;
  v_req  bigint;
begin
  select s.value into v_cfg from public.app_settings s where s.key = 'integracao.komune';
  if not coalesce((v_cfg ->> 'push_ativo')::boolean, false) then
    return jsonb_build_object('disparado', false, 'motivo', 'push_desligado');
  end if;
  if v_url is null or v_key is null then
    return jsonb_build_object('disparado', false, 'motivo', 'segredos_ausentes');
  end if;
  if not exists (select 1 from public.komune_outbox where status = 'pendente') then
    return jsonb_build_object('disparado', false, 'motivo', 'fila_vazia');
  end if;

  select net.http_post(
           url     := rtrim(v_url, '/') || '/komune-push',
           headers := jsonb_build_object('Content-Type', 'application/json',
                                         'Authorization', 'Bearer ' || v_key),
           body    := jsonb_build_object('origem', 'pg_cron'),
           timeout_milliseconds := 20000)
    into v_req;
  return jsonb_build_object('disparado', true, 'request_id', v_req);
end $$;
comment on function app.komune_push_disparar() is
  'Acorda a Edge Function komune-push. Não faz nada se a chave geral estiver desligada, se os segredos não estiverem no Vault ou se a fila estiver vazia.';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('komune_push', '*/5 * * * *',
                          $cron$select app.komune_push_disparar()$cron$);
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- F. GRANTS — a superfície mínima
-- ---------------------------------------------------------------------------
grant select on public.komune_outbox, public.webhook_deliveries to authenticated;

revoke all on function app.komune_payload(uuid)                     from public, anon, authenticated;
revoke all on function app.komune_enfileirar(uuid, text)            from public, anon, authenticated;
revoke all on function app.komune_proximos(int)                     from public, anon, authenticated;
revoke all on function app.komune_sucesso(bigint, uuid, int, uuid)  from public, anon, authenticated;
revoke all on function app.komune_falha(bigint, uuid, text, int)    from public, anon, authenticated;
revoke all on function app.komune_aplicar_evento(text, jsonb)       from public, anon, authenticated;
revoke all on function app.komune_push_disparar()                   from public, anon, authenticated;
revoke all on function app.pre_registrations_push()                 from public, anon, authenticated;
revoke all on function app.lgpd_dossie(uuid)                        from public, anon, authenticated;

grant execute on function app.komune_enfileirar(uuid, text)           to service_role;
grant execute on function app.komune_proximos(int)                    to service_role;
grant execute on function app.komune_sucesso(bigint, uuid, int, uuid) to service_role;
grant execute on function app.komune_falha(bigint, uuid, text, int)   to service_role;
grant execute on function app.komune_aplicar_evento(text, jsonb)      to service_role;
grant execute on function app.komune_push_disparar()                  to service_role;
grant execute on function app.komune_payload(uuid)                    to service_role;
grant execute on function app.lgpd_dossie(uuid)                       to service_role;

revoke all on function public.exportar_lgpd(uuid, text)             from public, anon;
revoke all on function public.exportar_lgpd_por_token(text)         from public;
grant execute on function public.exportar_lgpd(uuid, text)          to authenticated, service_role;
-- O titular não tem login. Tem o token, e o token é a credencial.
grant execute on function public.exportar_lgpd_por_token(text)      to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- G. A SUPERFÍCIE DAS EDGE FUNCTIONS
-- ---------------------------------------------------------------------------
-- O schema `app` não é exposto na API (config.toml §[api].schemas), e continua
-- não sendo. Estas cinco funções são a porta — finas, em `public`, e com
-- EXECUTE só para `service_role`. Uma Edge Function comprometida alcança
-- exatamente isto e nada mais.
create or replace function public.komune_push_lote(p_qty int default 10)
returns jsonb language sql security definer set search_path = ''
as $$ select app.komune_proximos(p_qty) $$;

create or replace function public.komune_push_ok(p_msg_id bigint, p_outbox_id uuid,
                                                 p_http_status int,
                                                 p_komune_supplier_id uuid default null)
returns jsonb language sql security definer set search_path = ''
as $$ select app.komune_sucesso(p_msg_id, p_outbox_id, p_http_status, p_komune_supplier_id) $$;

create or replace function public.komune_push_erro(p_msg_id bigint, p_outbox_id uuid,
                                                   p_erro text, p_http_status int default null)
returns jsonb language sql security definer set search_path = ''
as $$ select app.komune_falha(p_msg_id, p_outbox_id, p_erro, p_http_status) $$;

create or replace function public.komune_webhook_aplicar(p_delivery_id text, p_payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select app.komune_aplicar_evento(p_delivery_id, p_payload) $$;

create or replace function public.integracao_segredo(p_nome text)
returns text language sql stable security definer set search_path = ''
as $$ select app.segredo(p_nome) $$;

comment on function public.integracao_segredo(text) is
  'Leitura de segredo do Vault pela Edge Function, quando a variável de ambiente não existe. EXECUTE só para service_role: nenhum usuário logado, nem anon, alcança esta função.';

revoke all on function public.komune_push_lote(int)                          from public, anon, authenticated;
revoke all on function public.komune_push_ok(bigint, uuid, int, uuid)        from public, anon, authenticated;
revoke all on function public.komune_push_erro(bigint, uuid, text, int)      from public, anon, authenticated;
revoke all on function public.komune_webhook_aplicar(text, jsonb)            from public, anon, authenticated;
revoke all on function public.integracao_segredo(text)                       from public, anon, authenticated;
grant execute on function public.komune_push_lote(int)                       to service_role;
grant execute on function public.komune_push_ok(bigint, uuid, int, uuid)     to service_role;
grant execute on function public.komune_push_erro(bigint, uuid, text, int)   to service_role;
grant execute on function public.komune_webhook_aplicar(text, jsonb)         to service_role;
grant execute on function public.integracao_segredo(text)                    to service_role;

-- Fila de saída para a tela de administração (RF-ADM): quantos esperam, quantos
-- falharam, e o último erro — sem expor payload a quem não é gestor.
create or replace function public.komune_fila_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_manager() then
    raise exception 'Sem permissão para ver a fila de integração' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'push_ativo', coalesce((select (s.value ->> 'push_ativo')::boolean
                              from public.app_settings s where s.key = 'integracao.komune'), false),
    'pendentes',  (select count(*) from public.komune_outbox where status = 'pendente'),
    'enviados',   (select count(*) from public.komune_outbox where status = 'enviado'),
    'falhados',   (select count(*) from public.komune_outbox where status = 'falhou'),
    'ultimo_erro', (select jsonb_build_object('quando', o.updated_at, 'erro', o.last_error,
                                              'tentativas', o.attempts, 'http', o.http_status)
                      from public.komune_outbox o
                     where o.last_error is not null
                     order by o.updated_at desc limit 1),
    'ultima_entrega_recebida', (select jsonb_build_object('quando', d.received_at,
                                                          'evento', d.event,
                                                          'resultado', d.result)
                                  from public.webhook_deliveries d
                                 where d.source = 'komune'
                                 order by d.received_at desc limit 1));
end $$;
revoke all on function public.komune_fila_status() from public, anon;
grant execute on function public.komune_fila_status() to authenticated, service_role;

notify pgrst, 'reload schema';

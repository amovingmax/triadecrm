-- =============================================================================
-- TRIADE — A API externa do CRM (17/11/2026), nas duas empresas
--
-- Pedido do Rafael: "faz uma API do CRM do Tríade, preciso integrar softwares
-- externos a ele depois". Decidido com ele (17/11/2026): vale para a Imova e
-- para a KOMUNE, e a primeira versão faz quatro coisas — leads e fichas, funil,
-- conversas e WhatsApp, e avisos para fora (webhooks).
--
-- COMO É FEITA
-- -----------------------------------------------------------------------------
-- A Edge Function `api` (supabase/functions/api) é só a porta: lê a chave, o
-- método, o caminho, a consulta e o corpo, e chama UMA função daqui,
-- `public.api_atender`, com a service_role. Todo o resto é do Postgres (ADR-03):
--
--   1. a chave: `app.api_chaves` guarda só o SHA-256 dela (a chave inteira
--      aparece uma vez, na criação, em Ajustes → Integrações);
--   2. a rota e a permissão (escopo) que ela pede;
--   3. o limite por minuto da chave;
--   4. a idempotência dos POST (`Idempotency-Key`);
--   5. o trabalho, feito EM NOME de uma pessoa da gestão (admin ou gestor):
--      `app.api_agir_como` põe o `request.jwt.claims` dela na transação, e daí
--      em diante `auth.uid()` e `app.role()` respondem por ela. É por isso que a
--      API passa pelas MESMAS travas da tela: `messages_guard` (opt-out, janela
--      de 24 h, tetos, horário), `move_deal` (campos obrigatórios, próxima ação,
--      motivo de perda), `wa_enviar_modelo`, a auditoria e os gatilhos. Nenhuma
--      regra de negócio foi copiada para cá;
--   6. a anotação da chamada (`app.api_chamadas`), mesmo quando dá erro.
--
-- Por que "em nome de" admin ou gestor, e não SDR: a API devolve o telefone
-- inteiro, que no CRM é de admin e gestor (`app.admin_ou_gestor()`); o SDR vê o
-- número mascarado. Quem cria a chave escolhe em nome de quem ela age; se essa
-- pessoa perde o acesso (sai de `profiles`, fica inativa ou deixa de ser admin
-- ou gestor), a chave para de funcionar na hora.
--
-- OS AVISOS PARA FORA (webhooks)
-- -----------------------------------------------------------------------------
-- Eventos: ficha.criada, negocio.etapa_mudou, mensagem.recebida,
-- mensagem.enviada, mensagem.falhou (e `teste`, pelo botão). Cada evento vira
-- uma linha de `app.api_avisos` por webhook inscrito, NA MESMA TRANSAÇÃO do que
-- aconteceu, por gatilhos adiados para o fim da transação (a ficha já tem
-- negócio e categoria quando o aviso é montado). O `pg_cron` roda
-- `app.api_avisos_rodar` a cada 15 s: assina cada corpo com HMAC-SHA256 do
-- segredo do webhook (que mora no Vault), manda por `pg_net` (o mesmo caminho
-- dos avisos do celular), confere a resposta na volta seguinte e tenta de novo
-- com espera crescente (1 min → 12 h, 8 tentativas, até 3 dias). Webhook que
-- falha 25 vezes seguidas sem nenhuma entrega em 24 h, ou que responde 410, é
-- pausado, e a tela de Ajustes mostra o porquê.
--
-- Um gatilho de aviso NUNCA derruba o que o disparou: ele roda dentro de um
-- bloco de exceção, e o que falhar vira um WARNING no log.
--
-- O QUE NÃO ESTÁ AQUI (pendente, ver CHANGELOG): mídia das mensagens (a API diz
-- que tem mídia, não entrega o arquivo), trocar o telefone de uma ficha, criar
-- tarefa ou reunião, e o aviso no celular para lead que chega pela API.
-- =============================================================================


-- =============================================================================
-- A. AS TABELAS — todas em `app`, com RLS ligada e sem política: só as funções
--    daqui leem e escrevem. A tela de Ajustes lê por `public.api_integracoes()`.
-- =============================================================================

create table if not exists app.api_chaves (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null check (char_length(btrim(nome)) between 2 and 80),
  -- O começo da chave (`trd_imova_3f9a1c`), para a tela reconhecer qual é qual.
  prefixo           text not null,
  -- SHA-256 da chave inteira, em hexadecimal. A chave em si não fica em lugar nenhum.
  resumo            text not null unique check (resumo ~ '^[0-9a-f]{64}$'),
  escopos           text[] not null check (
                      cardinality(escopos) > 0
                      and escopos <@ array['fichas:ler', 'fichas:escrever', 'funil:ler', 'funil:escrever',
                                           'conversas:ler', 'mensagens:enviar', 'webhooks']::text[]),
  em_nome_de        uuid not null references public.profiles (id),
  criada_por        uuid references public.profiles (id),
  criada_em         timestamptz not null default now(),
  usada_em          timestamptz,
  revogada_em       timestamptz,
  revogada_por      uuid references public.profiles (id),
  limite_por_minuto integer not null default 120 check (limite_por_minuto between 10 and 1000)
);
comment on table app.api_chaves is
  'Chaves da API externa (Ajustes → Integrações). Guarda só o SHA-256 da chave; a chave inteira é mostrada uma vez, na criação. Cada chave age em nome de uma pessoa da gestão (em_nome_de) e só pode o que os escopos dizem.';

create table if not exists app.api_uso (
  chave_id uuid not null references app.api_chaves (id) on delete cascade,
  minuto   timestamptz not null,
  chamadas integer not null default 0,
  primary key (chave_id, minuto)
);
comment on table app.api_uso is 'Contagem de chamadas por chave e por minuto, para o limite (app.api_chaves.limite_por_minuto). Guardada por um dia.';

create table if not exists app.api_chamadas (
  id        bigint generated always as identity primary key,
  chave_id  uuid not null references app.api_chaves (id) on delete cascade,
  em        timestamptz not null default now(),
  metodo    text not null,
  rota      text not null,
  status    integer not null,
  codigo    text,
  registros integer
);
create index if not exists api_chamadas_chave_em_idx on app.api_chamadas (chave_id, em desc);
comment on table app.api_chamadas is
  'Uma linha por chamada autenticada à API: a rota (com {id} no lugar dos ids), o status e o código do erro. Nada do corpo, nada da pessoa. Guardada por 90 dias.';

create table if not exists app.api_idempotencia (
  chave_id  uuid not null references app.api_chaves (id) on delete cascade,
  chave     text not null check (char_length(chave) between 1 and 200),
  rota      text not null,
  resposta  jsonb not null,
  criada_em timestamptz not null default now(),
  primary key (chave_id, chave)
);
comment on table app.api_idempotencia is 'A resposta de cada POST com Idempotency-Key, por 24 h: o mesmo pedido repetido recebe a mesma resposta e não faz nada de novo.';

create table if not exists app.api_leads (
  chave_id        uuid not null references app.api_chaves (id) on delete cascade,
  id_externo      text not null check (char_length(id_externo) between 1 and 200),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id         uuid references public.deals (id) on delete set null,
  situacao        text not null,
  criado_em       timestamptz not null default now(),
  primary key (chave_id, id_externo)
);
comment on table app.api_leads is 'O id_externo de cada lead que chegou pela API, por chave: o mesmo lead mandado de novo devolve a mesma ficha, sem nota repetida.';

create table if not exists app.api_webhooks (
  id                uuid primary key default gen_random_uuid(),
  url               text not null check (char_length(url) <= 500 and url ~* '^https://[^\s/?#@]+'),
  eventos           text[] not null check (
                      cardinality(eventos) > 0
                      and eventos <@ array['ficha.criada', 'negocio.etapa_mudou', 'mensagem.recebida',
                                           'mensagem.enviada', 'mensagem.falhou']::text[]),
  descricao         text check (descricao is null or char_length(descricao) <= 200),
  -- O segredo da assinatura mora no Vault; aqui, o id dele e o começo, para a tela.
  segredo_id        uuid not null,
  segredo_prefixo   text not null,
  -- Quem criou pela API (para a mesma chave poder apagar o que criou) ou pela tela.
  chave_id          uuid references app.api_chaves (id) on delete set null,
  criado_por        uuid references public.profiles (id),
  criado_em         timestamptz not null default now(),
  ativo             boolean not null default true,
  pausado_em        timestamptz,
  pausado_motivo    text,
  falhas_seguidas   integer not null default 0,
  ultima_entrega_em timestamptz,
  ultima_falha_em   timestamptz
);
comment on table app.api_webhooks is
  'Avisos para fora: para onde o CRM manda cada evento, assinado com HMAC-SHA256 do segredo (no Vault). Pausado sozinho depois de 25 falhas seguidas sem entrega em 24 h, ou quando o destino responde 410.';

create table if not exists app.api_avisos (
  id          uuid primary key default gen_random_uuid(),
  webhook_id  uuid not null references app.api_webhooks (id) on delete cascade,
  evento_id   uuid not null,
  evento      text not null,
  corpo       jsonb not null,
  criado_em   timestamptz not null default now(),
  situacao    text not null default 'pendente'
                check (situacao in ('pendente', 'enviando', 'entregue', 'falhou')),
  tentativas  integer not null default 0,
  proxima_em  timestamptz not null default now(),
  pedido_id   bigint,
  enviado_em  timestamptz,
  ultimo_status integer,
  ultimo_erro text,
  entregue_em timestamptz
);
create index if not exists api_avisos_na_vez_idx on app.api_avisos (proxima_em) where situacao = 'pendente';
create index if not exists api_avisos_enviando_idx on app.api_avisos (pedido_id) where situacao = 'enviando';
create index if not exists api_avisos_webhook_idx on app.api_avisos (webhook_id, criado_em desc);
comment on table app.api_avisos is
  'Uma entrega por evento e por webhook. pendente → enviando → entregue, ou de volta a pendente com espera crescente; falhou depois de 8 tentativas ou 3 dias. Entregues somem em 7 dias, as que falharam em 30.';

alter table app.api_chaves       enable row level security;
alter table app.api_uso          enable row level security;
alter table app.api_chamadas     enable row level security;
alter table app.api_idempotencia enable row level security;
alter table app.api_leads        enable row level security;
alter table app.api_webhooks     enable row level security;
alter table app.api_avisos       enable row level security;
revoke all on app.api_chaves, app.api_uso, app.api_chamadas, app.api_idempotencia,
              app.api_leads, app.api_webhooks, app.api_avisos
  from public, anon, authenticated;

-- A origem das fichas que nascem pela API.
insert into public.sources (slug, name, kind, legal_basis, is_enabled)
select 'api', 'API (integração)', 'api', 'legitimo_interesse', true
 where not exists (select 1 from public.sources s where s.slug = 'api');


-- =============================================================================
-- B. PEÇAS PEQUENAS — respostas, erros, consulta, cursor
-- =============================================================================

-- A resposta de sucesso. `status` e `registros` são da porta e da anotação; a
-- Edge Function tira os dois do corpo que devolve.
create or replace function app.api_ok(p_status integer, p_dados jsonb, p_extra jsonb default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('status', p_status, 'dados', p_dados) || coalesce(p_extra, '{}'::jsonb)
$$;

create or replace function app.api_erro(p_status integer, p_codigo text, p_mensagem text,
                                        p_extra jsonb default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('status', p_status,
                            'erro', jsonb_build_object('codigo', p_codigo, 'mensagem', p_mensagem)
                                    || coalesce(p_extra, '{}'::jsonb))
$$;

-- Recusa de dentro de uma rota: a exceção leva o status na dica (`api:422`) e os
-- extras em JSON depois dele; `public.api_atender` desmonta e responde.
create or replace function app.api_falhar(p_status integer, p_codigo text, p_mensagem text,
                                          p_extra jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_codigo, detail = p_mensagem,
    hint = 'api:' || p_status::text || coalesce(':' || p_extra::text, '');
end $$;

create or replace function app.api_limite(p jsonb, p_padrao integer default 50, p_max integer default 200)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p ->> 'limite', '')), '');
begin
  if v is null then
    return p_padrao;
  end if;
  if v !~ '^[0-9]{1,4}$' or v::integer < 1 or v::integer > p_max then
    perform app.api_falhar(400, 'parametro_invalido',
      format('O parâmetro limite precisa ser um número de 1 a %s.', p_max));
  end if;
  return v::integer;
end $$;

create or replace function app.api_instante(p jsonb, p_nome text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p ->> p_nome, '')), '');
begin
  if v is null then
    return null;
  end if;
  begin
    return v::timestamptz;
  exception when others then
    perform app.api_falhar(400, 'parametro_invalido',
      format('O parâmetro %s precisa ser uma data e hora ISO 8601 com fuso, por exemplo 2026-11-17T09:00:00-03:00.', p_nome));
  end;
  return null;
end $$;

create or replace function app.api_uuid(p_valor text, p_nome text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_valor, '')), '') is null then
    return null;
  end if;
  if btrim(p_valor) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.api_falhar(400, 'parametro_invalido', format('%s precisa ser um id (UUID).', p_nome));
  end if;
  return btrim(p_valor)::uuid;
end $$;

-- O cursor das listas: microssegundos desde 1970 e o id, separados por "_".
-- Sem base64 e sem caracteres que precisem de escape na URL.
create or replace function app.api_cursor(p_em timestamptz, p_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select (extract(epoch from p_em) * 1000000)::bigint::text || '_' || p_id::text
$$;

create or replace function app.api_cursor_ler(p_cursor text, out em timestamptz, out id uuid)
language plpgsql
stable
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_cursor, '')), '') is null then
    return;
  end if;
  if p_cursor !~* '^-?[0-9]{1,18}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.api_falhar(400, 'cursor_invalido',
      'O cursor não é um dos que esta API devolveu. Use o valor de "proximo" da página anterior.');
  end if;
  -- Pelo texto do intervalo, e não por float: o microssegundo volta exato.
  em := timestamptz '1970-01-01 00:00:00+00' + (split_part(p_cursor, '_', 1) || ' microseconds')::interval;
  id := split_part(p_cursor, '_', 2)::uuid;
end $$;

-- Campo de texto do corpo: obrigatório ou não, só texto, aparado e com teto.
create or replace function app.api_texto(c jsonb, p_nome text, p_max integer, p_obrigatorio boolean default false)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v jsonb := c -> p_nome;
  t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_obrigatorio then
      perform app.api_falhar(422, 'campo_obrigatorio', format('Falta o campo %s.', p_nome),
                             jsonb_build_object('campo', p_nome));
    end if;
    return null;
  end if;
  if jsonb_typeof(v) not in ('string', 'number') then
    perform app.api_falhar(422, 'campo_invalido', format('O campo %s precisa ser texto.', p_nome),
                           jsonb_build_object('campo', p_nome));
  end if;
  t := nullif(btrim(regexp_replace(v #>> '{}', '[[:cntrl:]&&[^\n\t]]', '', 'g')), '');
  if t is null and p_obrigatorio then
    perform app.api_falhar(422, 'campo_obrigatorio', format('O campo %s está vazio.', p_nome),
                           jsonb_build_object('campo', p_nome));
  end if;
  if char_length(t) > p_max then
    perform app.api_falhar(422, 'campo_longo_demais',
      format('O campo %s passou de %s caracteres.', p_nome, p_max),
      jsonb_build_object('campo', p_nome, 'maximo', p_max));
  end if;
  return t;
end $$;

-- O corpo só pode trazer os campos que a rota conhece: um erro de digitação
-- ("telefoen") vira recusa com o nome do campo, e não um lead sem telefone.
create or replace function app.api_so_campos(c jsonb, p_permitidos text[])
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_fora text[];
begin
  if c is null then
    return;
  end if;
  if jsonb_typeof(c) <> 'object' then
    perform app.api_falhar(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  end if;
  select array_agg(k order by k) into v_fora
    from jsonb_object_keys(c) k
   where not (k = any (p_permitidos));
  if v_fora is not null then
    perform app.api_falhar(422, 'campo_desconhecido',
      format('Campo que esta rota não conhece: %s. Os campos aceitos são: %s.',
             array_to_string(v_fora, ', '), array_to_string(p_permitidos, ', ')),
      jsonb_build_object('campos', to_jsonb(v_fora)));
  end if;
end $$;

create or replace function app.api_email(p text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p, '')));
begin
  if v = '' then
    return null;
  end if;
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v) > 254 then
    perform app.api_falhar(422, 'email_invalido', 'O e-mail não parece um e-mail.',
                           jsonb_build_object('campo', 'email'));
  end if;
  return v;
end $$;

create or replace function app.api_tipo_de_ficha(p text)
returns app.org_kind
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p, '')));
begin
  if v = '' then
    return null;
  end if;
  if not exists (select 1 from pg_enum e where e.enumtypid = 'app.org_kind'::regtype and e.enumlabel = v) then
    perform app.api_falhar(422, 'tipo_invalido',
      'tipo precisa ser um destes: fornecedor, produtor, cerimonialista, espaco, empresa, outro.',
      jsonb_build_object('campo', 'tipo'));
  end if;
  return v::app.org_kind;
end $$;

-- O perfil pelo e-mail de login (o mesmo de allowed_users), ativo.
create or replace function app.api_pessoa_pelo_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  if nullif(btrim(coalesce(p_email, '')), '') is null then
    return null;
  end if;
  select p.id into v
    from auth.users u
    join public.profiles p on p.id = u.id and p.is_active
   where lower(u.email) = lower(btrim(p_email))
     and p.role in ('admin', 'gestor', 'sdr');
  if v is null then
    perform app.api_falhar(422, 'responsavel_inexistente',
      'Ninguém ativo da equipe entra no CRM com este e-mail.', jsonb_build_object('campo', 'responsavel'));
  end if;
  return v;
end $$;

-- A frase de cada recusa do envio, a partir do código que o banco escreve
-- ("Envio recusado: <codigo> ..."). O mesmo mapa da tela, em
-- apps/web/src/components/conversas/mensagens.ts, resumido para quem integra.
create or replace function app.api_frase_da_recusa(p_motivo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_motivo in ('contato_suprimido', 'numero_suprimido', 'alvo_suprimido', 'suprimido')
      then 'Este contato pediu para não receber mensagens (opt-out). Nada sai para ele.'
    when p_motivo = 'sem_janela_e_sem_template'
      then 'A janela de 24 h desta conversa está fechada: só sai modelo aprovado. Use POST /v1/conversas/{id}/modelo.'
    when p_motivo like 'janela%' or p_motivo in ('fechada', 'fora_do_horario')
      then 'Fora do horário de envio configurado no CRM. Tente de novo dentro do horário.'
    when p_motivo like 'teto%'
      then 'O limite de envios foi atingido. Tente de novo mais tarde.'
    when p_motivo = 'conversa_bloqueada'
      then 'Este contato está bloqueado no CRM. Desbloqueie na conversa para voltar a mandar.'
    when p_motivo = 'whatsapp_nao_configurado'
      then 'O número de WhatsApp da empresa ainda não está ligado ao CRM.'
    when p_motivo = 'ficha_sem_whatsapp'
      then 'Esta ficha não tem WhatsApp cadastrado.'
    when p_motivo = 'modelo_inexistente'
      then 'Modelo inexistente ou desativado. Veja a lista em GET /v1/modelos.'
    when p_motivo = 'modelo_de_sistema'
      then 'Este modelo é do sistema e não sai pela API.'
    when p_motivo = 'modelo_sem_parametro'
      then 'Falta preencher um dos campos do modelo. Os campos de cada modelo estão em GET /v1/modelos (variaveis).'
    when p_motivo = 'parametro_longo_demais'
      then 'Um dos campos do modelo passou de 200 caracteres.'
    when p_motivo = 'modelo_nao_aprovado_na_meta'
      then 'A Meta ainda não aprovou este modelo.'
    when p_motivo in ('conta_banida', 'banido', 'qualidade_vermelha')
         or p_motivo like 'meta_restringiu%' or p_motivo like 'restrito%'
      then 'A Meta restringiu o número da empresa e os envios estão parados.'
    when p_motivo = 'conversa_fora_do_whatsapp'
      then 'Esta conversa não é de WhatsApp.'
    else format('O CRM recusou o envio (%s).', p_motivo)
  end
$$;


-- =============================================================================
-- C. O QUE A API DEVOLVE — fichas, negócios, conversas, mensagens
--    (as mesmas formas vão nos avisos para fora)
-- =============================================================================

create or replace function app.api_pessoa(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_id is null then null
              else (select jsonb_build_object('id', p.id, 'nome', p.full_name)
                      from public.profiles p where p.id = p_id) end
$$;

create or replace function app.api_etapa(p_id integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', s.id, 'slug', s.slug, 'nome', s.name,
                            'ganho', s.is_won, 'perdido', s.is_lost)
    from public.stages s where s.id = p_id
$$;

create or replace function app.api_negocio(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', d.id,
           'ficha', jsonb_build_object('id', o.id, 'nome', o.name),
           'funil', jsonb_build_object('id', p.id, 'slug', p.slug, 'nome', p.name),
           'etapa', app.api_etapa(d.stage_id),
           'situacao', case d.status::text
                         when 'open' then 'aberto' when 'won' then 'ganho' when 'lost' then 'perdido'
                         when 'paused' then 'pausado' when 'nurturing' then 'nutricao'
                         else d.status::text end,
           'temperatura', d.temperature,
           'responsavel', app.api_pessoa(d.owner_id),
           'proxima_acao', case when d.next_action is not null or d.next_action_at is not null
                                then jsonb_build_object('texto', d.next_action, 'em', d.next_action_at) end,
           'motivo_da_perda', (select jsonb_build_object('id', lr.id, 'slug', lr.slug, 'nome', lr.name)
                                 from public.lost_reasons lr where lr.id = d.lost_reason_id),
           'entrou_na_etapa_em', d.entered_stage_at,
           'ultima_atividade_em', d.last_activity_at,
           'ganho_em', d.won_at,
           'perdido_em', d.lost_at,
           'criado_em', d.created_at,
           'atualizado_em', d.updated_at)
    from public.deals d
    join public.organizations o on o.id = d.organization_id and o.deleted_at is null
    join public.pipelines p on p.id = d.pipeline_id
   where d.id = p_id
$$;

create or replace function app.api_ficha(p_id uuid, p_completa boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', o.id,
           'nome', o.name,
           'tipo', o.kind,
           'pessoa_fisica', o.is_natural_person,
           'telefone', o.phone_e164,
           'email', o.email,
           'instagram', o.instagram_handle,
           'site', o.website,
           'cidade', ci.name,
           'uf', ci.state,
           'bairro', o.neighborhood,
           'endereco', o.address,
           'categoria', (select jsonb_build_object('slug', ca.slug, 'nome', ca.name)
                           from public.organization_categories oc
                           join public.categories ca on ca.id = oc.category_id
                          where oc.organization_id = o.id
                          order by oc.is_primary desc, oc.created_at
                          limit 1),
           'origem', jsonb_build_object('slug', so.slug, 'nome', so.name),
           'responsavel', app.api_pessoa(o.owner_id),
           'temperatura', o.temperature,
           'nao_contatar', o.do_not_contact,
           'campos_extras', coalesce(o.custom -> 'externos', '{}'::jsonb),
           'negocios', coalesce((select jsonb_agg(app.api_negocio(d.id) order by d.created_at)
                                   from public.deals d where d.organization_id = o.id), '[]'::jsonb),
           'criada_em', o.created_at,
           'atualizada_em', o.updated_at)
         || case when not p_completa then '{}'::jsonb else jsonb_build_object(
           'contatos', coalesce((select jsonb_agg(jsonb_build_object(
                                          'id', ct.id, 'nome', ct.full_name, 'telefone', ct.phone_e164,
                                          'email', ct.email, 'cargo', coalesce(oc.role, ct.role_title),
                                          'principal', oc.is_primary, 'decide', ct.is_decision_maker,
                                          'nao_contatar', ct.do_not_contact)
                                        order by oc.is_primary desc, ct.created_at)
                                   from public.organization_contacts oc
                                   join public.contacts ct on ct.id = oc.contact_id and ct.deleted_at is null
                                  where oc.organization_id = o.id), '[]'::jsonb),
           'conversas', coalesce((select jsonb_agg(c.id order by c.last_message_at desc nulls last)
                                    from public.conversations c where c.organization_id = o.id), '[]'::jsonb))
         end
    from public.organizations o
    left join public.cities ci on ci.id = o.city_id
    left join public.sources so on so.id = o.source_id
   where o.id = p_id and o.deleted_at is null and o.anonymized_at is null
$$;

create or replace function app.api_conversa(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', c.id,
           'canal', c.channel,
           'telefone', c.peer_phone_e164,
           'nome_no_whatsapp', c.peer_nome,
           'ficha', case when o.id is not null then jsonb_build_object('id', o.id, 'nome', o.name) end,
           'negocio_id', c.deal_id,
           'responsavel', app.api_pessoa(c.assignee_id),
           'situacao', c.status,
           'por_ler', c.unread_count,
           'janela_aberta_ate', c.window_expires_at,
           'janela_aberta', coalesce(c.window_expires_at > now(), false),
           'arquivada', c.arquivada_em is not null,
           'bloqueada', c.bloqueada_em is not null,
           'ultima_mensagem_em', c.last_message_at,
           'ultima_recebida_em', c.last_inbound_at,
           'ultima_enviada_em', c.last_outbound_at,
           'criada_em', c.created_at,
           'atualizada_em', c.updated_at)
    from public.conversations c
    left join public.organizations o on o.id = c.organization_id and o.deleted_at is null
   where c.id = p_id
$$;

create or replace function app.api_mensagem(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', m.id,
           'conversa_id', m.conversation_id,
           'ficha_id', m.organization_id,
           'direcao', case when m.direction::text = 'in' then 'recebida' else 'enviada' end,
           'tipo', m.type,
           'texto', case when m.apagada_em is null then m.body end,
           'transcricao', case when m.apagada_em is null then m.transcript end,
           'apagada', m.apagada_em is not null or m.apagada_pelo_contato_em is not null,
           'situacao', case m.status::text
                         when 'queued' then 'na_fila' when 'sent' then 'enviada'
                         when 'delivered' then 'entregue' when 'read' then 'lida'
                         when 'failed' then 'falhou' when 'received' then 'recebida'
                         else m.status::text end,
           'autor', case
                      when m.direction::text = 'in' then jsonb_build_object('tipo', 'contato')
                      when m.author_kind = 'human' then jsonb_build_object('tipo', 'pessoa')
                                                         || coalesce(app.api_pessoa(m.sent_by), '{}'::jsonb)
                      when m.author_kind = 'bot_ai' then jsonb_build_object('tipo', 'ia')
                      when m.author_kind = 'bot_fixed' then jsonb_build_object('tipo', 'robo')
                      else jsonb_build_object('tipo', 'sistema') end,
           'modelo', (select t.template_code from public.message_templates t where t.id = m.template_id),
           'midia', case when m.media_path is not null or m.media_id is not null
                              or m.type::text in ('image', 'audio', 'video', 'document')
                         then jsonb_build_object('tipo', m.media_mime, 'nome_do_arquivo', m.media_nome) end,
           'responde_a', m.responde_a,
           'erro', case when m.status::text = 'failed'
                        then jsonb_build_object('codigo', m.error_code, 'detalhe', left(m.error_detail, 300)) end,
           'criada_em', m.created_at,
           'enviada_em', m.sent_at,
           'entregue_em', m.delivered_at,
           'lida_em', m.read_at)
    from public.messages m
   where m.id = p_id
$$;


-- =============================================================================
-- D. CHAVES E WEBHOOKS — a tela de Ajustes (sessão de admin ou gestor)
-- =============================================================================

create or replace function app.api_escopos()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'fichas:ler', 'nome', 'Ler fichas',
                       'descricao', 'Consultar fichas, contatos e telefones.'),
    jsonb_build_object('id', 'fichas:escrever', 'nome', 'Criar leads e mexer em fichas',
                       'descricao', 'Criar lead, atualizar dados da ficha e escrever nota.'),
    jsonb_build_object('id', 'funil:ler', 'nome', 'Ler o funil',
                       'descricao', 'Consultar funis, etapas e negócios.'),
    jsonb_build_object('id', 'funil:escrever', 'nome', 'Mover no funil',
                       'descricao', 'Mudar a etapa de um negócio, com as mesmas regras do quadro.'),
    jsonb_build_object('id', 'conversas:ler', 'nome', 'Ler conversas',
                       'descricao', 'Consultar conversas e mensagens do WhatsApp.'),
    jsonb_build_object('id', 'mensagens:enviar', 'nome', 'Mandar WhatsApp',
                       'descricao', 'Mandar texto na janela de 24 h e modelo aprovado, com as travas do CRM.'),
    jsonb_build_object('id', 'webhooks', 'nome', 'Avisos para fora',
                       'descricao', 'Criar e apagar webhooks pela própria API.'))
$$;

create or replace function app.api_eventos()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'ficha.criada', 'descricao', 'Uma ficha nova entrou no CRM (por qualquer caminho).'),
    jsonb_build_object('id', 'negocio.etapa_mudou', 'descricao', 'Um negócio mudou de etapa no funil.'),
    jsonb_build_object('id', 'mensagem.recebida', 'descricao', 'Chegou mensagem de WhatsApp.'),
    jsonb_build_object('id', 'mensagem.enviada', 'descricao', 'Uma mensagem do CRM saiu para o WhatsApp.'),
    jsonb_build_object('id', 'mensagem.falhou', 'descricao', 'Uma mensagem do CRM não conseguiu sair.'))
$$;

-- A chave nova. Devolve a chave inteira UMA vez; o banco guarda só o resumo.
create or replace function app.api_chave_nova(p_nome text, p_escopos text[], p_em_nome_de uuid,
                                              p_criada_por uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome    text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_escopos text[];
  v_chave   text;
  v_id      uuid;
  v_papel   text;
  -- O começo da chave diz de que empresa ela é; antes da identidade (banco novo), "crm".
  v_empresa text := coalesce(public.empresa_do_banco(), 'crm');
begin
  if char_length(v_nome) < 2 or char_length(v_nome) > 80 then
    return jsonb_build_object('ok', false, 'motivo', 'nome_invalido');
  end if;
  select array_agg(distinct e order by e) into v_escopos from unnest(coalesce(p_escopos, '{}'::text[])) e;
  if v_escopos is null
     or not v_escopos <@ array['fichas:ler', 'fichas:escrever', 'funil:ler', 'funil:escrever',
                               'conversas:ler', 'mensagens:enviar', 'webhooks']::text[] then
    return jsonb_build_object('ok', false, 'motivo', 'escopos_invalidos');
  end if;
  select p.role::text into v_papel from public.profiles p where p.id = p_em_nome_de and p.is_active;
  if v_papel is null or v_papel not in ('admin', 'gestor') then
    return jsonb_build_object('ok', false, 'motivo', 'em_nome_de_invalido');
  end if;

  v_chave := 'trd_' || v_empresa || '_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into app.api_chaves (nome, prefixo, resumo, escopos, em_nome_de, criada_por)
  values (v_nome, left(v_chave, char_length(v_empresa) + 11),
          encode(extensions.digest(v_chave, 'sha256'), 'hex'), v_escopos, p_em_nome_de, p_criada_por)
  returning id into v_id;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (p_criada_por, app.role()::text, 'INSERT', 'api_chaves', v_id::text,
          jsonb_build_object('nome', v_nome, 'escopos', v_escopos, 'em_nome_de', p_em_nome_de));

  return jsonb_build_object('ok', true, 'id', v_id, 'chave', v_chave,
                            'prefixo', left(v_chave, char_length(v_empresa) + 11));
end $$;

-- O webhook novo. Devolve o segredo da assinatura UMA vez; ele fica no Vault.
create or replace function app.api_webhook_novo(p_url text, p_eventos text[], p_descricao text,
                                                p_criado_por uuid, p_chave_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url     text := btrim(coalesce(p_url, ''));
  v_host    text;
  v_eventos text[];
  v_desc    text := nullif(btrim(coalesce(p_descricao, '')), '');
  v_segredo text;
  v_id      uuid := gen_random_uuid();
  v_vault   uuid;
begin
  if v_url !~* '^https://[^\s/?#@]+(/[^\s]*)?$' or char_length(v_url) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'url_invalida',
                              'mensagem', 'O endereço precisa começar com https:// e ter até 500 caracteres.');
  end if;
  v_host := lower(split_part(substring(v_url from '^https://([^/?#]+)'), ':', 1));
  -- Nada de rede interna: o pedido sai do servidor do banco.
  if v_host in ('localhost', '0.0.0.0') or v_host like '%.local' or v_host like '%.internal'
     or v_host like '%.localhost' or v_host like '[%'
     or v_host ~ '^(127|10|0)\.' or v_host ~ '^192\.168\.' or v_host ~ '^169\.254\.'
     or v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.' or v_host ~ '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.' then
    return jsonb_build_object('ok', false, 'motivo', 'url_interna',
                              'mensagem', 'O endereço precisa ser público na internet.');
  end if;
  select array_agg(distinct e order by e) into v_eventos from unnest(coalesce(p_eventos, '{}'::text[])) e;
  if v_eventos is null
     or not v_eventos <@ array['ficha.criada', 'negocio.etapa_mudou', 'mensagem.recebida',
                               'mensagem.enviada', 'mensagem.falhou']::text[] then
    return jsonb_build_object('ok', false, 'motivo', 'eventos_invalidos',
                              'mensagem', 'Escolha um ou mais eventos: ficha.criada, negocio.etapa_mudou, mensagem.recebida, mensagem.enviada, mensagem.falhou.');
  end if;
  if char_length(v_desc) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'descricao_longa', 'mensagem', 'A descrição passa de 200 caracteres.');
  end if;
  if (select count(*) from app.api_webhooks) >= 20 then
    return jsonb_build_object('ok', false, 'motivo', 'webhooks_demais',
                              'mensagem', 'Já existem 20 webhooks. Apague um que não é mais usado.');
  end if;

  v_segredo := 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_vault := vault.create_secret(v_segredo, 'api_webhook_' || replace(v_id::text, '-', ''),
                                 'Assinatura dos avisos da API do CRM');
  insert into app.api_webhooks (id, url, eventos, descricao, segredo_id, segredo_prefixo, chave_id, criado_por)
  values (v_id, v_url, v_eventos, v_desc, v_vault, left(v_segredo, 12), p_chave_id, p_criado_por);

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (p_criado_por, app.role()::text, 'INSERT', 'api_webhooks', v_id::text,
          jsonb_build_object('url', v_url, 'eventos', v_eventos, 'pela_api', p_chave_id is not null));

  return jsonb_build_object('ok', true, 'id', v_id, 'segredo', v_segredo);
end $$;

create or replace function app.api_webhook_apagar(p_id uuid, p_por uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app.api_webhooks%rowtype;
begin
  delete from app.api_webhooks where id = p_id returning * into w;
  if not found then
    return false;
  end if;
  delete from vault.secrets where id = w.segredo_id;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data)
  values (p_por, app.role()::text, 'DELETE', 'api_webhooks', p_id::text,
          jsonb_build_object('url', w.url, 'eventos', w.eventos));
  return true;
end $$;

create or replace function app.api_webhook_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', w.id, 'url', w.url, 'eventos', to_jsonb(w.eventos), 'descricao', w.descricao,
           'segredo_prefixo', w.segredo_prefixo,
           'ativo', w.ativo, 'pausado_em', w.pausado_em, 'pausado_motivo', w.pausado_motivo,
           'falhas_seguidas', w.falhas_seguidas,
           'ultima_entrega_em', w.ultima_entrega_em, 'ultima_falha_em', w.ultima_falha_em,
           'origem', case when w.chave_id is not null then 'api' else 'ajustes' end,
           'chave', (select jsonb_build_object('id', k.id, 'nome', k.nome) from app.api_chaves k where k.id = w.chave_id),
           'criado_por', app.api_pessoa(w.criado_por),
           'criado_em', w.criado_em,
           'pendentes', (select count(*) from app.api_avisos a
                          where a.webhook_id = w.id and a.situacao in ('pendente', 'enviando')),
           'entregues_7d', (select count(*) from app.api_avisos a
                             where a.webhook_id = w.id and a.situacao = 'entregue'
                               and a.criado_em > now() - interval '7 days'),
           'falharam_7d', (select count(*) from app.api_avisos a
                            where a.webhook_id = w.id and a.situacao = 'falhou'
                              and a.criado_em > now() - interval '7 days'))
    from app.api_webhooks w
   where w.id = p_id
$$;

-- Tudo o que a tela de Ajustes → Integrações mostra, numa ida só.
create or replace function public.api_integracoes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    raise exception 'Só admin e gestor veem as integrações' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'empresa', public.empresa_do_banco(),
    'escopos', app.api_escopos(),
    'eventos', app.api_eventos(),
    'pessoas', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.full_name, 'papel', p.role)
                                          order by p.full_name)
                           from public.profiles p
                          where p.is_active and p.role in ('admin', 'gestor')), '[]'::jsonb),
    'chaves', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', k.id, 'nome', k.nome, 'prefixo', k.prefixo, 'escopos', to_jsonb(k.escopos),
                                 'em_nome_de', app.api_pessoa(k.em_nome_de),
                                 'em_nome_de_tem_acesso', exists (select 1 from public.profiles p
                                                                   where p.id = k.em_nome_de and p.is_active
                                                                     and p.role in ('admin', 'gestor')),
                                 'criada_por', app.api_pessoa(k.criada_por),
                                 'criada_em', k.criada_em, 'usada_em', k.usada_em,
                                 'revogada_em', k.revogada_em, 'revogada_por', app.api_pessoa(k.revogada_por),
                                 'limite_por_minuto', k.limite_por_minuto,
                                 'chamadas_24h', (select count(*) from app.api_chamadas c
                                                   where c.chave_id = k.id and c.em > now() - interval '24 hours'),
                                 'erros_24h', (select count(*) from app.api_chamadas c
                                                where c.chave_id = k.id and c.em > now() - interval '24 hours'
                                                  and c.status >= 400))
                               order by (k.revogada_em is not null), k.criada_em desc)
                          from app.api_chaves k), '[]'::jsonb),
    'webhooks', coalesce((select jsonb_agg(app.api_webhook_json(w.id) order by w.criado_em desc)
                            from app.api_webhooks w), '[]'::jsonb));
end $$;
comment on function public.api_integracoes() is
  'Ajustes → Integrações: chaves da API (sem a chave, que não existe no banco), webhooks, escopos, eventos e quem pode ser o "em nome de". Só admin e gestor.';

create or replace function public.api_chave_criar(p_nome text, p_escopos text[], p_em_nome_de uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  return app.api_chave_nova(p_nome, p_escopos, coalesce(p_em_nome_de, auth.uid()), auth.uid());
end $$;
comment on function public.api_chave_criar(text, text[], uuid) is
  'Cria uma chave da API e devolve a chave inteira UMA vez (o banco guarda só o SHA-256). em_nome_de: admin ou gestor ativo; sem ele, quem cria. Só admin e gestor.';

create or replace function public.api_chave_revogar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update app.api_chaves set revogada_em = now(), revogada_por = auth.uid()
   where id = p_id and revogada_em is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'chave_inexistente');
  end if;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'api_chaves', p_id::text,
          jsonb_build_object('revogada', true));
  return jsonb_build_object('ok', true);
end $$;
comment on function public.api_chave_revogar(uuid) is 'Revoga uma chave da API: a próxima chamada com ela recebe 401. Não volta atrás. Só admin e gestor.';

create or replace function public.api_webhook_criar(p_url text, p_eventos text[], p_descricao text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  return app.api_webhook_novo(p_url, p_eventos, p_descricao, auth.uid(), null);
end $$;
comment on function public.api_webhook_criar(text, text[], text) is
  'Cria um webhook e devolve o segredo da assinatura UMA vez (ele fica no Vault). Só admin e gestor.';

create or replace function public.api_webhook_ativar(p_id uuid, p_ativo boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update app.api_webhooks
     set ativo = p_ativo,
         pausado_em = case when p_ativo then null else now() end,
         pausado_motivo = case when p_ativo then null else 'pausado_na_tela' end,
         falhas_seguidas = case when p_ativo then 0 else falhas_seguidas end
   where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'webhook_inexistente');
  end if;
  -- Reativado: o que ficou para trás e ainda é recente sai já.
  if p_ativo then
    update app.api_avisos set proxima_em = now()
     where webhook_id = p_id and situacao = 'pendente' and criado_em > now() - interval '3 days';
  end if;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'api_webhooks', p_id::text, jsonb_build_object('ativo', p_ativo));
  return jsonb_build_object('ok', true);
end $$;
comment on function public.api_webhook_ativar(uuid, boolean) is 'Pausa ou reativa um webhook. Reativar zera as falhas seguidas e manda já o que ficou pendente nos últimos 3 dias. Só admin e gestor.';

create or replace function public.api_webhook_excluir(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not app.api_webhook_apagar(p_id, auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'webhook_inexistente');
  end if;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.api_webhook_excluir(uuid) is 'Apaga um webhook, as entregas dele e o segredo no Vault. Só admin e gestor.';

create or replace function public.api_webhook_testar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from app.api_webhooks w where w.id = p_id) then
    return jsonb_build_object('ok', false, 'motivo', 'webhook_inexistente');
  end if;
  perform app.api_evento('teste', jsonb_build_object('mensagem', 'Aviso de teste do CRM. Se chegou, está tudo certo.'), p_id);
  return jsonb_build_object('ok', true);
end $$;
comment on function public.api_webhook_testar(uuid) is 'Manda um aviso de teste (evento "teste") só para este webhook, mesmo pausado. Só admin e gestor.';

create or replace function public.api_webhook_entregas(p_id uuid, p_limite integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    raise exception 'Só admin e gestor veem as entregas' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
                            'id', a.id, 'evento', a.evento, 'situacao', a.situacao, 'tentativas', a.tentativas,
                            'ultimo_status', a.ultimo_status, 'ultimo_erro', a.ultimo_erro,
                            'criado_em', a.criado_em, 'entregue_em', a.entregue_em, 'proxima_em', a.proxima_em)
                          order by a.criado_em desc)
                     from (select * from app.api_avisos x where x.webhook_id = p_id
                            order by x.criado_em desc limit least(greatest(coalesce(p_limite, 20), 1), 100)) a),
                  '[]'::jsonb);
end $$;
comment on function public.api_webhook_entregas(uuid, integer) is 'As últimas entregas de um webhook (até 100), para a tela. Só admin e gestor.';


-- =============================================================================
-- E. OS EVENTOS — gatilhos adiados para o fim da transação
-- =============================================================================

create or replace function app.api_tem_ouvinte(p_evento text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.api_webhooks w where w.ativo and p_evento = any (w.eventos))
$$;

-- Uma entrega por webhook inscrito. `p_so_webhook` é o teste (vai mesmo pausado).
create or replace function app.api_evento(p_evento text, p_dados jsonb, p_so_webhook uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid := gen_random_uuid();
  v_corpo jsonb;
  v_n     integer;
begin
  if p_dados is null then
    return 0;
  end if;
  v_corpo := jsonb_build_object('id', v_id, 'evento', p_evento, 'empresa', public.empresa_do_banco(),
                                'criado_em', clock_timestamp(), 'dados', p_dados);
  insert into app.api_avisos (webhook_id, evento_id, evento, corpo)
  select w.id, v_id, p_evento, v_corpo
    from app.api_webhooks w
   where (p_so_webhook is null and w.ativo and p_evento = any (w.eventos))
      or w.id = p_so_webhook;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function app.api_aviso_ficha_criada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.api_tem_ouvinte('ficha.criada') then
    return null;
  end if;
  begin
    perform app.api_evento('ficha.criada', jsonb_build_object('ficha', app.api_ficha(new.id, true)));
  exception when others then
    raise warning 'api: aviso ficha.criada não foi montado (%: %)', sqlstate, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists api_aviso_ficha_criada on public.organizations;
create constraint trigger api_aviso_ficha_criada
  after insert on public.organizations
  deferrable initially deferred
  for each row execute function app.api_aviso_ficha_criada();

create or replace function app.api_aviso_etapa_mudou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- O nascimento do negócio também grava histórico (sem etapa de origem): não é mudança.
  if new.from_stage_id is null or new.from_stage_id = new.to_stage_id
     or not app.api_tem_ouvinte('negocio.etapa_mudou') then
    return null;
  end if;
  begin
    perform app.api_evento('negocio.etapa_mudou', jsonb_build_object(
      'negocio', app.api_negocio(new.deal_id),
      'de', app.api_etapa(new.from_stage_id),
      'para', app.api_etapa(new.to_stage_id),
      'motivo', new.reason,
      'por', app.api_pessoa(new.changed_by),
      'mudou_em', new.changed_at));
  exception when others then
    raise warning 'api: aviso negocio.etapa_mudou não foi montado (%: %)', sqlstate, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists api_aviso_etapa_mudou on public.deal_stage_history;
create constraint trigger api_aviso_etapa_mudou
  after insert on public.deal_stage_history
  deferrable initially deferred
  for each row execute function app.api_aviso_etapa_mudou();

create or replace function app.api_aviso_mensagem_recebida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv uuid;
  v_org  uuid;
begin
  if new.direction::text <> 'in' or not app.api_tem_ouvinte('mensagem.recebida') then
    return null;
  end if;
  begin
    -- Lida de novo no fim da transação: a ficha pode ter sido ligada depois do insert.
    select m.conversation_id, coalesce(m.organization_id, c.organization_id) into v_conv, v_org
      from public.messages m join public.conversations c on c.id = m.conversation_id
     where m.id = new.id;
    if v_conv is null then
      return null;
    end if;
    perform app.api_evento('mensagem.recebida', jsonb_build_object(
      'mensagem', app.api_mensagem(new.id),
      'conversa', app.api_conversa(v_conv),
      'ficha', case when v_org is not null then app.api_ficha(v_org, false) end));
  exception when others then
    raise warning 'api: aviso mensagem.recebida não foi montado (%: %)', sqlstate, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists api_aviso_mensagem_recebida on public.messages;
create constraint trigger api_aviso_mensagem_recebida
  after insert on public.messages
  deferrable initially deferred
  for each row execute function app.api_aviso_mensagem_recebida();

create or replace function app.api_aviso_mensagem_saiu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evento text := case when new.status::text = 'failed' then 'mensagem.falhou' else 'mensagem.enviada' end;
begin
  if not app.api_tem_ouvinte(v_evento) then
    return null;
  end if;
  begin
    perform app.api_evento(v_evento, jsonb_build_object(
      'mensagem', app.api_mensagem(new.id),
      'conversa', app.api_conversa(new.conversation_id)));
  exception when others then
    raise warning 'api: aviso % não foi montado (%: %)', v_evento, sqlstate, sqlerrm;
  end;
  return null;
end $$;

-- Da fila para fora (ou para a falha), uma vez: queued → sent/delivered/read/failed.
drop trigger if exists api_aviso_mensagem_saiu on public.messages;
create trigger api_aviso_mensagem_saiu
  after update of status on public.messages
  for each row
  when (new.direction = 'out'::app.msg_direction
        and old.status = 'queued'::app.msg_status
        and new.status in ('sent'::app.msg_status, 'delivered'::app.msg_status,
                           'read'::app.msg_status, 'failed'::app.msg_status))
  execute function app.api_aviso_mensagem_saiu();


-- =============================================================================
-- F. A ENTREGA — pg_cron a cada 15 s, pg_net, HMAC, espera crescente
-- =============================================================================

create or replace function app.api_aviso_falhou(p_id uuid, p_status integer, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a app.api_avisos%rowtype;
  -- Espera depois da 1ª, 2ª, ... 7ª tentativa; a 8ª é a última.
  v_espera interval[] := array['1 minute', '5 minutes', '15 minutes', '1 hour',
                               '3 hours', '6 hours', '12 hours']::interval[];
  v_desiste boolean;
begin
  select * into a from app.api_avisos where id = p_id;
  if not found then
    return;
  end if;
  v_desiste := a.tentativas >= 8 or a.criado_em < now() - interval '3 days' or p_status = 410;
  update app.api_avisos
     set situacao = case when v_desiste then 'falhou' else 'pendente' end,
         proxima_em = case when v_desiste then proxima_em
                           else now() + v_espera[least(greatest(a.tentativas, 1), 7)] end,
         ultimo_status = p_status,
         ultimo_erro = left(p_erro, 300)
   where id = p_id;
  update app.api_webhooks w
     set falhas_seguidas = w.falhas_seguidas + 1,
         ultima_falha_em = now(),
         ativo = case when p_status = 410
                        or (w.falhas_seguidas + 1 >= 25
                            and (w.ultima_entrega_em is null or w.ultima_entrega_em < now() - interval '24 hours'))
                      then false else w.ativo end,
         pausado_em = case when w.ativo and (p_status = 410
                             or (w.falhas_seguidas + 1 >= 25
                                 and (w.ultima_entrega_em is null or w.ultima_entrega_em < now() - interval '24 hours')))
                           then now() else w.pausado_em end,
         pausado_motivo = case when w.ativo and p_status = 410 then 'destino_respondeu_410'
                               when w.ativo and w.falhas_seguidas + 1 >= 25
                                    and (w.ultima_entrega_em is null or w.ultima_entrega_em < now() - interval '24 hours')
                               then 'falhas_seguidas'
                               else w.pausado_motivo end
   where w.id = a.webhook_id;
end $$;

create or replace function app.api_avisos_rodar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a           record;
  v_segredo   text;
  v_ts        text;
  v_assinatura text;
  v_pedido    bigint;
  v_entregues integer := 0;
  v_falhas    integer := 0;
  v_enviados  integer := 0;
begin
  -- 1. As respostas que voltaram desde a última rodada.
  for a in
    select av.id, av.webhook_id, r.status_code, r.timed_out, r.error_msg
      from app.api_avisos av
      join net._http_response r on r.id = av.pedido_id
     where av.situacao = 'enviando'
     for update of av skip locked
  loop
    if a.status_code between 200 and 299 then
      update app.api_avisos
         set situacao = 'entregue', entregue_em = now(), ultimo_status = a.status_code, ultimo_erro = null
       where id = a.id;
      update app.api_webhooks set falhas_seguidas = 0, ultima_entrega_em = now() where id = a.webhook_id;
      v_entregues := v_entregues + 1;
    else
      perform app.api_aviso_falhou(a.id, a.status_code,
        coalesce(case when a.timed_out then 'tempo esgotado (10 s)' end,
                 nullif(a.error_msg, ''),
                 'o destino respondeu ' || coalesce(a.status_code::text, 'sem status')));
      v_falhas := v_falhas + 1;
    end if;
  end loop;

  -- 1b. Saiu e não voltou nada em 2 minutos (o pg_net perdeu ou já limpou a resposta).
  for a in
    select av.id from app.api_avisos av
     where av.situacao = 'enviando' and av.enviado_em < now() - interval '2 minutes'
       and not exists (select 1 from net._http_response r where r.id = av.pedido_id)
     for update of av skip locked
  loop
    perform app.api_aviso_falhou(a.id, null, 'sem resposta');
    v_falhas := v_falhas + 1;
  end loop;

  -- 2. Os que estão na vez, de webhooks ativos (o teste vai mesmo para o pausado).
  for a in
    select av.id, av.corpo, av.evento, w.url, w.segredo_id
      from app.api_avisos av
      join app.api_webhooks w on w.id = av.webhook_id
     where av.situacao = 'pendente' and av.proxima_em <= now()
       and (w.ativo or av.evento = 'teste')
     order by av.proxima_em, av.criado_em
     limit 100
     for update of av skip locked
  loop
    select s.decrypted_secret into v_segredo from vault.decrypted_secrets s where s.id = a.segredo_id;
    if v_segredo is null then
      update app.api_avisos set situacao = 'falhou', ultimo_erro = 'segredo do webhook ausente no Vault'
       where id = a.id;
      v_falhas := v_falhas + 1;
      continue;
    end if;
    -- A assinatura é do texto exato que sai: o pg_net manda `corpo::text`.
    v_ts := floor(extract(epoch from clock_timestamp()))::bigint::text;
    v_assinatura := encode(extensions.hmac(convert_to(v_ts || '.' || a.corpo::text, 'UTF8'),
                                           convert_to(v_segredo, 'UTF8'), 'sha256'), 'hex');
    select net.http_post(
             url := a.url,
             body := a.corpo,
             headers := jsonb_build_object(
               'Content-Type', 'application/json',
               'User-Agent', 'Triade-Avisos/1',
               'X-Triade-Evento', a.evento,
               'X-Triade-Entrega', a.id::text,
               'X-Triade-Assinatura', 't=' || v_ts || ',v1=' || v_assinatura),
             timeout_milliseconds := 10000)
      into v_pedido;
    update app.api_avisos
       set situacao = 'enviando', pedido_id = v_pedido, enviado_em = now(), tentativas = tentativas + 1
     where id = a.id;
    v_enviados := v_enviados + 1;
  end loop;

  return jsonb_build_object('entregues', v_entregues, 'falhas', v_falhas, 'enviados', v_enviados);
end $$;
comment on function app.api_avisos_rodar() is
  'Entrega os avisos da API (pg_cron, a cada 15 s): confere as respostas da rodada anterior, reagenda as falhas com espera crescente e manda os que estão na vez, assinados com HMAC-SHA256 (X-Triade-Assinatura: t=<segundos>,v1=<hex de HMAC(segredo, "<t>.<corpo>")>).';

create or replace function app.api_limpar()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.api_uso where minuto < now() - interval '1 day';
  delete from app.api_idempotencia where criada_em < now() - interval '24 hours';
  delete from app.api_chamadas where em < now() - interval '90 days';
  delete from app.api_avisos where situacao = 'entregue' and criado_em < now() - interval '7 days';
  delete from app.api_avisos where situacao = 'falhou' and criado_em < now() - interval '30 days';
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('api_avisos', '15 seconds', $cron$select app.api_avisos_rodar()$cron$);
    perform cron.schedule('api_limpar', '40 7 * * *', $cron$select app.api_limpar()$cron$);
  end if;
end $$;


-- =============================================================================
-- G. AS ROTAS
-- =============================================================================

-- GET /v1 — quem sou eu
create or replace function app.api_v1_inicio(k app.api_chaves)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.api_ok(200, jsonb_build_object(
    'empresa', public.empresa_do_banco(),
    'versao', 'v1',
    'chave', jsonb_build_object('id', k.id, 'nome', k.nome, 'prefixo', k.prefixo,
                                'escopos', to_jsonb(k.escopos), 'limite_por_minuto', k.limite_por_minuto),
    'em_nome_de', (select jsonb_build_object('id', p.id, 'nome', p.full_name, 'papel', p.role)
                     from public.profiles p where p.id = k.em_nome_de)))
$$;

-- GET /v1/fichas
create or replace function app.api_v1_fichas(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lim   integer := app.api_limite(p);
  v_desde timestamptz := app.api_instante(p, 'atualizada_desde');
  v_tipo  app.org_kind := app.api_tipo_de_ficha(p ->> 'tipo');
  v_busca text := nullif(btrim(coalesce(p ->> 'busca', '')), '');
  v_tel   text;
  v_email text := app.api_email(p ->> 'email');
  v_cts   timestamptz;
  v_cid   uuid;
  v_itens jsonb;
  v_mais  boolean;
  v_prox  text;
begin
  select c.em, c.id into v_cts, v_cid from app.api_cursor_ler(p ->> 'cursor') c;
  if nullif(btrim(coalesce(p ->> 'telefone', '')), '') is not null then
    v_tel := app.normalize_phone_br(p ->> 'telefone');
    if v_tel is null then
      perform app.api_falhar(400, 'parametro_invalido', 'O telefone não parece um telefone do Brasil.');
    end if;
  end if;
  if char_length(v_busca) > 100 then
    perform app.api_falhar(400, 'parametro_invalido', 'A busca passa de 100 caracteres.');
  end if;

  with linhas as (
    select o.id, o.updated_at
      from public.organizations o
     where o.deleted_at is null and o.anonymized_at is null
       and (v_tipo is null or o.kind = v_tipo)
       and (v_desde is null or o.updated_at >= v_desde)
       and (v_busca is null or o.search_name like '%' || app.search_name(v_busca) || '%')
       and (v_tel is null or o.phone_e164 = v_tel
            or exists (select 1 from public.organization_contacts oc
                         join public.contacts ct on ct.id = oc.contact_id and ct.deleted_at is null
                        where oc.organization_id = o.id and ct.phone_e164 = v_tel))
       and (v_email is null or lower(o.email::text) = v_email
            or exists (select 1 from public.organization_contacts oc
                         join public.contacts ct on ct.id = oc.contact_id and ct.deleted_at is null
                        where oc.organization_id = o.id and lower(ct.email::text) = v_email))
       and (v_cts is null or (o.updated_at, o.id) < (v_cts, v_cid))
     order by o.updated_at desc, o.id desc
     limit v_lim + 1)
  select coalesce(jsonb_agg(app.api_ficha(l.id, false) order by l.n) filter (where l.n <= v_lim), '[]'::jsonb),
         coalesce(bool_or(l.n > v_lim), false),
         max(case when l.n = v_lim then app.api_cursor(l.updated_at, l.id) end)
    into v_itens, v_mais, v_prox
    from (select x.*, row_number() over (order by x.updated_at desc, x.id desc) as n from linhas x) l;

  return app.api_ok(200, v_itens, jsonb_build_object('proximo', case when v_mais then v_prox end,
                                                     'registros', jsonb_array_length(v_itens)));
end $$;

-- GET /v1/fichas/{id}
create or replace function app.api_v1_ficha(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := app.api_ficha(p_id, true);
begin
  if v is null then
    return app.api_erro(404, 'ficha_inexistente', 'Não há ficha com este id (ou ela foi excluída).');
  end if;
  return app.api_ok(200, v, jsonb_build_object('registros', 1));
end $$;

-- POST /v1/leads — acha a ficha pelo telefone ou e-mail, ou cria
create or replace function app.api_v1_lead(k app.api_chaves, c jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome     text;
  v_tel_txt  text;
  v_tel      text;
  v_email    text;
  v_tipo     app.org_kind;
  v_cat_slug text;
  v_cat      integer;
  v_origem   text;
  v_msg      text;
  v_externo  text;
  v_dono     uuid;
  v_extras   jsonb;
  v_ja       app.api_leads%rowtype;
  v_org      uuid;
  v_deal     uuid;
  v_fonte    integer;
  v_pipe     integer;
  v_etapa    integer;
  v_situacao text;
  v_nota     text;
begin
  perform app.api_so_campos(c, array['nome', 'telefone', 'email', 'tipo', 'categoria', 'origem',
                                     'mensagem', 'id_externo', 'responsavel', 'campos_extras']);
  v_nome := app.api_texto(c, 'nome', 120, true);
  v_nome := app.sem_cpf(regexp_replace(v_nome, '\s+', ' ', 'g'));
  v_tel_txt := app.api_texto(c, 'telefone', 40);
  v_email := app.api_email(app.api_texto(c, 'email', 254));
  v_origem := app.api_texto(c, 'origem', 120);
  v_msg := app.sem_cpf(app.api_texto(c, 'mensagem', 2000));
  v_externo := app.api_texto(c, 'id_externo', 200);
  v_cat_slug := lower(app.api_texto(c, 'categoria', 80));
  v_tipo := coalesce(app.api_tipo_de_ficha(app.api_texto(c, 'tipo', 30)),
                     case when public.empresa_do_banco() = 'imova' then 'produtor' else 'fornecedor' end::app.org_kind);
  v_dono := app.api_pessoa_pelo_email(app.api_texto(c, 'responsavel', 254));
  v_extras := c -> 'campos_extras';
  if v_extras is not null and jsonb_typeof(v_extras) = 'null' then
    v_extras := null;
  end if;
  if v_extras is not null and (jsonb_typeof(v_extras) <> 'object' or octet_length(v_extras::text) > 8000) then
    perform app.api_falhar(422, 'campo_invalido', 'campos_extras precisa ser um objeto JSON de até 8 KB.',
                           jsonb_build_object('campo', 'campos_extras'));
  end if;
  if v_extras is not null and app.tem_cpf(v_extras::text) then
    perform app.api_falhar(422, 'cpf_nao_entra', 'O CRM não guarda CPF: tire o CPF de campos_extras.',
                           jsonb_build_object('campo', 'campos_extras'));
  end if;

  if v_tel_txt is not null then
    v_tel := app.normalize_phone_br(v_tel_txt);
    if v_tel is null then
      perform app.api_falhar(422, 'telefone_invalido',
        'O telefone não parece um telefone do Brasil. Mande com DDD, por exemplo 84999998888 ou +5584999998888.',
        jsonb_build_object('campo', 'telefone'));
    end if;
  end if;
  if v_tel is null and v_email is null then
    perform app.api_falhar(422, 'contato_obrigatorio', 'Mande o telefone, o e-mail ou os dois.');
  end if;

  -- O mesmo lead de novo: a mesma resposta, sem nota repetida.
  if v_externo is not null then
    select * into v_ja from app.api_leads l where l.chave_id = k.id and l.id_externo = v_externo;
    if found then
      return app.api_ok(200, jsonb_build_object('situacao', v_ja.situacao, 'repetido', true,
                                                'negocio_id', v_ja.deal_id,
                                                'ficha', app.api_ficha(v_ja.organization_id, false)),
                        jsonb_build_object('registros', 1));
    end if;
  end if;

  if v_tel is not null and app.is_suppressed(v_tel) then
    return app.api_erro(422, 'contato_suprimido',
      'Este telefone pediu para não ser contatado (opt-out). O lead não entrou. Se a pessoa pediu contato de novo, a equipe reativa no CRM.');
  end if;

  if v_cat_slug is not null then
    select ca.id into v_cat from public.categories ca where ca.slug = v_cat_slug and ca.is_active;
    if v_cat is null then
      perform app.api_falhar(422, 'categoria_inexistente',
        'Não há categoria ativa com este slug. A lista está em Ajustes → Catálogos → Categorias.',
        jsonb_build_object('campo', 'categoria'));
    end if;
  end if;

  -- ---- A ficha que já existe (pelo telefone, depois pelo e-mail) ----
  if v_tel is not null then
    select o.id into v_org from public.organizations o
     where o.phone_e164 = v_tel and o.deleted_at is null limit 1;
    if v_org is null then
      select oc.organization_id into v_org
        from public.contacts ct
        join public.organization_contacts oc on oc.contact_id = ct.id
        join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
       where ct.phone_e164 = v_tel and ct.deleted_at is null
       order by oc.is_primary desc limit 1;
    end if;
  end if;
  if v_org is null and v_email is not null then
    select o.id into v_org from public.organizations o
     where lower(o.email::text) = v_email and o.deleted_at is null order by o.created_at limit 1;
    if v_org is null then
      select oc.organization_id into v_org
        from public.contacts ct
        join public.organization_contacts oc on oc.contact_id = ct.id
        join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
       where lower(ct.email::text) = v_email and ct.deleted_at is null
       order by oc.is_primary desc limit 1;
    end if;
  end if;

  v_nota := 'Lead pela API (' || k.nome || ')' || coalesce(': ' || v_origem, '')
            || coalesce(E'\n' || v_msg, '');

  if v_org is not null then
    if app.is_suppressed_target(v_org, null) then
      return app.api_erro(422, 'contato_suprimido',
        'Esta ficha pediu para não ser contatada (opt-out). O lead não entrou.');
    end if;
    v_situacao := 'ligada';
    update public.organizations o
       set phone_e164 = case when o.phone_e164 is null and v_tel is not null
                                  and not exists (select 1 from public.organizations y
                                                   where y.phone_e164 = v_tel and y.deleted_at is null)
                             then v_tel else o.phone_e164 end,
           email = coalesce(o.email, v_email::extensions.citext),
           custom = case when v_extras is null then o.custom
                         else jsonb_set(o.custom, '{externos}',
                                        coalesce(o.custom -> 'externos', '{}'::jsonb) || v_extras) end
     where o.id = v_org;
    v_deal := app.wa_negocio_da_ficha(v_org);
  else
    -- ---- A ficha nova ----
    v_situacao := 'criada';
    select s.id into v_fonte from public.sources s where s.slug = 'api';
    if v_cat is null and public.empresa_do_banco() = 'imova' and v_tipo = 'produtor' then
      select ca.id into v_cat from public.categories ca where ca.slug = 'comprador' and ca.is_active;
    end if;
    select pl.id into v_pipe from public.pipelines pl
     where pl.slug = case when v_tipo in ('produtor', 'cerimonialista') then 'produtor' else 'fornecedor' end;
    select st.id into v_etapa from public.stages st
     where st.pipeline_id = v_pipe and st.retired_at is null and not st.is_won and not st.is_lost
     order by st.is_entry desc, st.position limit 1;
    if v_fonte is null or v_etapa is null then
      return app.api_erro(500, 'catalogo_incompleto',
        'O catálogo do CRM está incompleto (origem "api" ou funil sem etapa). Avise a equipe.');
    end if;

    insert into public.organizations (kind, name, phone_e164, email, source_id, collected_at, collector,
                                      owner_id, is_natural_person, custom)
    values (v_tipo, v_nome, v_tel, v_email, v_fonte, now(), left('API: ' || k.nome, 120), v_dono,
            v_tipo in ('produtor'),
            case when v_extras is null then '{}'::jsonb else jsonb_build_object('externos', v_extras) end)
    returning id into v_org;
    if v_cat is not null then
      insert into public.organization_categories (organization_id, category_id, is_primary)
      values (v_org, v_cat, true);
    end if;
    insert into public.deals (organization_id, pipeline_id, stage_id, owner_id, source_id,
                              next_action, next_action_at)
    values (v_org, v_pipe, v_etapa, v_dono, v_fonte, 'Responder o lead da API', now())
    returning id into v_deal;
  end if;

  if v_dono is not null and v_situacao = 'ligada' then
    update public.organizations set owner_id = v_dono where id = v_org and owner_id is null;
  end if;

  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('system', v_org, v_deal, null, 'system', v_nota,
          jsonb_build_object('origin', 'api', 'api_chave_id', k.id, 'ficha', v_situacao,
                             'id_externo', v_externo));

  if v_externo is not null then
    insert into app.api_leads (chave_id, id_externo, organization_id, deal_id, situacao)
    values (k.id, v_externo, v_org, v_deal, v_situacao);
  end if;

  return app.api_ok(case when v_situacao = 'criada' then 201 else 200 end,
                    jsonb_build_object('situacao', v_situacao, 'repetido', false, 'negocio_id', v_deal,
                                       'ficha', app.api_ficha(v_org, false)),
                    jsonb_build_object('registros', 1));
end $$;

-- PATCH /v1/fichas/{id}
create or replace function app.api_v1_ficha_mudar(p_id uuid, c jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o       public.organizations%rowtype;
  v_nome  text;
  v_email text;
  v_insta text;
  v_site  text;
  v_bairro text;
  v_end   text;
  v_dono  uuid;
  v_extras jsonb;
  v_custom jsonb;
begin
  perform app.api_so_campos(c, array['nome', 'email', 'instagram', 'site', 'bairro', 'endereco',
                                     'responsavel', 'campos_extras']);
  if c is null or c = '{}'::jsonb then
    return app.api_erro(422, 'nada_para_mudar',
      'Mande pelo menos um destes campos: nome, email, instagram, site, bairro, endereco, responsavel, campos_extras.');
  end if;
  select * into o from public.organizations where id = p_id and deleted_at is null and anonymized_at is null
     for update;
  if not found then
    return app.api_erro(404, 'ficha_inexistente', 'Não há ficha com este id (ou ela foi excluída).');
  end if;

  if c ? 'nome' then
    v_nome := app.sem_cpf(regexp_replace(app.api_texto(c, 'nome', 120, true), '\s+', ' ', 'g'));
  end if;
  if c ? 'email' then
    v_email := app.api_email(app.api_texto(c, 'email', 254));
  end if;
  if c ? 'instagram' then
    v_insta := lower(regexp_replace(coalesce(app.api_texto(c, 'instagram', 60), ''), '^@', ''));
    if v_insta <> '' and v_insta !~ '^[a-z0-9._]{1,30}$' then
      perform app.api_falhar(422, 'campo_invalido', 'O Instagram precisa ser o @ da conta, sem espaço.',
                             jsonb_build_object('campo', 'instagram'));
    end if;
  end if;
  if c ? 'site' then
    v_site := app.api_texto(c, 'site', 300);
  end if;
  if c ? 'bairro' then
    v_bairro := app.api_texto(c, 'bairro', 120);
  end if;
  if c ? 'endereco' then
    v_end := app.sem_cpf(app.api_texto(c, 'endereco', 300));
  end if;
  if c ? 'responsavel' and jsonb_typeof(c -> 'responsavel') <> 'null' then
    v_dono := app.api_pessoa_pelo_email(app.api_texto(c, 'responsavel', 254));
  end if;
  if c ? 'campos_extras' then
    v_extras := c -> 'campos_extras';
    if jsonb_typeof(v_extras) <> 'object' or octet_length(v_extras::text) > 8000 then
      perform app.api_falhar(422, 'campo_invalido', 'campos_extras precisa ser um objeto JSON de até 8 KB.',
                             jsonb_build_object('campo', 'campos_extras'));
    end if;
    if app.tem_cpf(v_extras::text) then
      perform app.api_falhar(422, 'cpf_nao_entra', 'O CRM não guarda CPF: tire o CPF de campos_extras.',
                             jsonb_build_object('campo', 'campos_extras'));
    end if;
    -- Mescla; chave com null apaga.
    v_custom := jsonb_strip_nulls(coalesce(o.custom -> 'externos', '{}'::jsonb) || v_extras);
    if octet_length(v_custom::text) > 16000 then
      perform app.api_falhar(422, 'campo_invalido', 'campos_extras passou de 16 KB somados.',
                             jsonb_build_object('campo', 'campos_extras'));
    end if;
  end if;

  update public.organizations x
     set name             = case when c ? 'nome' then v_nome else x.name end,
         email            = case when c ? 'email' then v_email::extensions.citext else x.email end,
         instagram_handle = case when c ? 'instagram' then nullif(v_insta, '') else x.instagram_handle end,
         website          = case when c ? 'site' then v_site else x.website end,
         neighborhood     = case when c ? 'bairro' then v_bairro else x.neighborhood end,
         address          = case when c ? 'endereco' then v_end else x.address end,
         owner_id         = case when c ? 'responsavel' then v_dono else x.owner_id end,
         custom           = case when c ? 'campos_extras' then jsonb_set(x.custom, '{externos}', v_custom)
                                 else x.custom end
   where x.id = p_id;

  return app.api_ok(200, app.api_ficha(p_id, true), jsonb_build_object('registros', 1));
end $$;

-- POST /v1/fichas/{id}/notas
create or replace function app.api_v1_nota(k app.api_chaves, p_id uuid, c jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text;
  v_id    uuid;
  v_em    timestamptz;
begin
  perform app.api_so_campos(c, array['texto']);
  v_texto := app.sem_cpf(app.api_texto(c, 'texto', 4000, true));
  if not exists (select 1 from public.organizations o where o.id = p_id and o.deleted_at is null) then
    return app.api_erro(404, 'ficha_inexistente', 'Não há ficha com este id (ou ela foi excluída).');
  end if;
  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('note', p_id, app.wa_negocio_da_ficha(p_id), k.em_nome_de, 'human', v_texto,
          jsonb_build_object('origin', 'api', 'api_chave_id', k.id, 'api_chave', k.nome))
  returning id, created_at into v_id, v_em;
  return app.api_ok(201, jsonb_build_object('id', v_id, 'ficha_id', p_id, 'texto', v_texto, 'criada_em', v_em),
                    jsonb_build_object('registros', 1));
end $$;

-- GET /v1/funis
create or replace function app.api_v1_funis()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.api_ok(200, jsonb_build_object(
    'funis', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', pl.id, 'slug', pl.slug, 'nome', pl.name, 'tipo', pl.kind,
                                 'etapas', coalesce((select jsonb_agg(jsonb_build_object(
                                                              'id', st.id, 'slug', st.slug, 'nome', st.name,
                                                              'posicao', st.position, 'entrada', st.is_entry,
                                                              'ganho', st.is_won, 'perdido', st.is_lost,
                                                              'temperatura', st.temperature,
                                                              'prazo_horas', st.sla_hours,
                                                              'campos_obrigatorios', st.required_fields)
                                                            order by st.position)
                                                       from public.stages st
                                                      where st.pipeline_id = pl.id and st.retired_at is null),
                                                    '[]'::jsonb))
                               order by pl.position)
                          from public.pipelines pl), '[]'::jsonb),
    'motivos_de_perda', coalesce((select jsonb_agg(jsonb_build_object('id', lr.id, 'slug', lr.slug, 'nome', lr.name)
                                                   order by lr.position)
                                    from public.lost_reasons lr where lr.is_active), '[]'::jsonb)))
$$;

-- A etapa pelo id ou pelo slug, dentro de um funil (ou em qualquer um).
create or replace function app.api_achar_etapa(p_valor text, p_funil integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids integer[];
begin
  if nullif(btrim(coalesce(p_valor, '')), '') is null then
    return null;
  end if;
  select array_agg(st.id) into v_ids
    from public.stages st
   where st.retired_at is null
     and (p_funil is null or st.pipeline_id = p_funil)
     and (case when btrim(p_valor) ~ '^[0-9]{1,9}$' then st.id = btrim(p_valor)::integer
               else st.slug = lower(btrim(p_valor)) end);
  if v_ids is null then
    perform app.api_falhar(422, 'etapa_inexistente',
      'Não há etapa ativa com este id ou slug' || case when p_funil is not null then ' neste funil' else '' end
      || '. A lista está em GET /v1/funis.', jsonb_build_object('campo', 'etapa'));
  end if;
  if cardinality(v_ids) > 1 then
    perform app.api_falhar(422, 'etapa_ambigua',
      'Este slug existe em mais de um funil. Mande o funil junto, ou o id da etapa.',
      jsonb_build_object('campo', 'etapa'));
  end if;
  return v_ids[1];
end $$;

create or replace function app.api_achar_funil(p_valor text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  if nullif(btrim(coalesce(p_valor, '')), '') is null then
    return null;
  end if;
  select pl.id into v from public.pipelines pl
   where case when btrim(p_valor) ~ '^[0-9]{1,9}$' then pl.id = btrim(p_valor)::integer
              else pl.slug = lower(btrim(p_valor)) end;
  if v is null then
    perform app.api_falhar(422, 'funil_inexistente', 'Não há funil com este id ou slug. A lista está em GET /v1/funis.',
                           jsonb_build_object('campo', 'funil'));
  end if;
  return v;
end $$;

-- GET /v1/negocios
create or replace function app.api_v1_negocios(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lim   integer := app.api_limite(p);
  v_desde timestamptz := app.api_instante(p, 'atualizado_desde');
  v_funil integer := app.api_achar_funil(p ->> 'funil');
  v_etapa integer := app.api_achar_etapa(p ->> 'etapa', v_funil);
  v_ficha uuid := app.api_uuid(p ->> 'ficha', 'ficha');
  v_sit   text := lower(nullif(btrim(coalesce(p ->> 'situacao', '')), ''));
  v_status text;
  v_cts   timestamptz;
  v_cid   uuid;
  v_itens jsonb;
  v_mais  boolean;
  v_prox  text;
begin
  select c.em, c.id into v_cts, v_cid from app.api_cursor_ler(p ->> 'cursor') c;
  if v_sit is not null then
    v_status := case v_sit when 'aberto' then 'open' when 'ganho' then 'won' when 'perdido' then 'lost'
                           when 'pausado' then 'paused' when 'nutricao' then 'nurturing' end;
    if v_status is null then
      perform app.api_falhar(400, 'parametro_invalido',
        'situacao precisa ser uma destas: aberto, ganho, perdido, pausado, nutricao.');
    end if;
  end if;

  with linhas as (
    select d.id, d.updated_at
      from public.deals d
      join public.organizations o on o.id = d.organization_id and o.deleted_at is null and o.anonymized_at is null
     where (v_funil is null or d.pipeline_id = v_funil)
       and (v_etapa is null or d.stage_id = v_etapa)
       and (v_ficha is null or d.organization_id = v_ficha)
       and (v_status is null or d.status::text = v_status)
       and (v_desde is null or d.updated_at >= v_desde)
       and (v_cts is null or (d.updated_at, d.id) < (v_cts, v_cid))
     order by d.updated_at desc, d.id desc
     limit v_lim + 1)
  select coalesce(jsonb_agg(app.api_negocio(l.id) order by l.n) filter (where l.n <= v_lim), '[]'::jsonb),
         coalesce(bool_or(l.n > v_lim), false),
         max(case when l.n = v_lim then app.api_cursor(l.updated_at, l.id) end)
    into v_itens, v_mais, v_prox
    from (select x.*, row_number() over (order by x.updated_at desc, x.id desc) as n from linhas x) l;

  return app.api_ok(200, v_itens, jsonb_build_object('proximo', case when v_mais then v_prox end,
                                                     'registros', jsonb_array_length(v_itens)));
end $$;

-- GET /v1/negocios/{id}
create or replace function app.api_v1_negocio(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := app.api_negocio(p_id);
begin
  if v is null then
    return app.api_erro(404, 'negocio_inexistente', 'Não há negócio com este id.');
  end if;
  return app.api_ok(200, v, jsonb_build_object('registros', 1));
end $$;

-- POST /v1/negocios/{id}/mover — por `public.move_deal`, com as regras do quadro
create or replace function app.api_v1_mover(p_id uuid, c jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d        public.deals%rowtype;
  v_etapa  integer;
  v_motivo text;
  v_campos jsonb;
  v_perda  text;
  v_perda_id integer;
  v_prox   jsonb;
  v_na     jsonb;
  v_r      jsonb;
begin
  perform app.api_so_campos(c, array['etapa', 'motivo', 'campos', 'motivo_da_perda', 'proxima_acao']);
  select * into d from public.deals where id = p_id;
  if not found or not exists (select 1 from public.organizations o
                               where o.id = d.organization_id and o.deleted_at is null) then
    return app.api_erro(404, 'negocio_inexistente', 'Não há negócio com este id.');
  end if;
  v_etapa := app.api_achar_etapa(app.api_texto(c, 'etapa', 80, true), d.pipeline_id);
  v_motivo := app.sem_cpf(app.api_texto(c, 'motivo', 500));

  v_campos := coalesce(c -> 'campos', '{}'::jsonb);
  if jsonb_typeof(v_campos) <> 'object' then
    perform app.api_falhar(422, 'campo_invalido', 'campos precisa ser um objeto JSON.', jsonb_build_object('campo', 'campos'));
  end if;
  v_perda := app.api_texto(c, 'motivo_da_perda', 80);
  if v_perda is not null then
    select lr.id into v_perda_id from public.lost_reasons lr
     where lr.is_active and (case when v_perda ~ '^[0-9]{1,9}$' then lr.id = v_perda::integer
                                  else lr.slug = lower(v_perda) end);
    if v_perda_id is null then
      perform app.api_falhar(422, 'motivo_da_perda_inexistente',
        'Não há motivo de perda ativo com este id ou slug. A lista está em GET /v1/funis (motivos_de_perda).',
        jsonb_build_object('campo', 'motivo_da_perda'));
    end if;
    v_campos := v_campos || jsonb_build_object('lost_reason_id', v_perda_id);
  end if;

  v_prox := c -> 'proxima_acao';
  if v_prox is not null and jsonb_typeof(v_prox) <> 'null' then
    if jsonb_typeof(v_prox) <> 'object' then
      perform app.api_falhar(422, 'campo_invalido', 'proxima_acao precisa ser {"texto": "...", "em": "2026-11-18T09:00:00-03:00"}.',
                             jsonb_build_object('campo', 'proxima_acao'));
    end if;
    v_na := jsonb_build_object('label', app.api_texto(v_prox, 'texto', 200, true),
                               'at', app.api_instante(v_prox, 'em'),
                               'kind', coalesce(app.api_texto(v_prox, 'tipo', 20), 'follow_up'));
    if v_na ->> 'kind' not in ('call', 'visit', 'meeting', 'message', 'follow_up', 'other') then
      perform app.api_falhar(422, 'campo_invalido',
        'proxima_acao.tipo precisa ser um destes: call, visit, meeting, message, follow_up, other.',
        jsonb_build_object('campo', 'proxima_acao.tipo'));
    end if;
  end if;

  v_r := public.move_deal(p_id, v_etapa, d.stage_id, v_motivo, v_campos, v_na);

  if coalesce((v_r ->> 'ok')::boolean, false) then
    return app.api_ok(200, app.api_negocio(p_id), jsonb_build_object('mudou', true, 'registros', 1));
  end if;
  return case v_r ->> 'reason'
    when 'etapa_igual' then
      app.api_ok(200, app.api_negocio(p_id), jsonb_build_object('mudou', false, 'registros', 1))
    when 'negocio_nao_encontrado' then
      app.api_erro(404, 'negocio_inexistente', 'Não há negócio com este id.')
    when 'sem_permissao' then
      app.api_erro(403, 'sem_permissao', 'A pessoa em nome de quem a chave age não pode mover este negócio.')
    when 'etapa_de_outro_funil' then
      app.api_erro(422, 'etapa_de_outro_funil', 'Esta etapa é de outro funil.')
    when 'etapa_mudou' then
      app.api_erro(409, 'etapa_mudou', 'O negócio mudou de etapa enquanto o pedido chegava. Leia de novo e repita.')
    when 'campos_obrigatorios' then
      app.api_erro(422, 'campos_obrigatorios', 'Esta etapa pede campos que não vieram. Mande-os em "campos".',
                   jsonb_build_object('campos', coalesce(v_r -> 'missing', '[]'::jsonb)))
    when 'motivo_de_perda_invalido' then
      app.api_erro(422, 'motivo_da_perda_obrigatorio',
        'Para perder o negócio, mande motivo_da_perda (a lista está em GET /v1/funis).')
    when 'proxima_acao_obrigatoria' then
      app.api_erro(422, 'proxima_acao_obrigatoria',
        'Esta etapa pede uma próxima ação futura: mande proxima_acao {"texto", "em"}.')
    when 'proxima_acao_no_passado' then
      app.api_erro(422, 'proxima_acao_no_passado', 'A próxima ação precisa ser de hoje em diante.')
    else
      app.api_erro(422, 'movimento_recusado', format('O CRM recusou a mudança de etapa (%s).', v_r ->> 'reason'))
  end;
end $$;

-- GET /v1/conversas
create or replace function app.api_v1_conversas(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lim   integer := app.api_limite(p);
  v_desde timestamptz := app.api_instante(p, 'atualizada_desde');
  v_ficha uuid := app.api_uuid(p ->> 'ficha', 'ficha');
  v_tel   text;
  v_cts   timestamptz;
  v_cid   uuid;
  v_itens jsonb;
  v_mais  boolean;
  v_prox  text;
begin
  select c.em, c.id into v_cts, v_cid from app.api_cursor_ler(p ->> 'cursor') c;
  if nullif(btrim(coalesce(p ->> 'telefone', '')), '') is not null then
    v_tel := app.normalize_phone_br(p ->> 'telefone');
    if v_tel is null then
      perform app.api_falhar(400, 'parametro_invalido', 'O telefone não parece um telefone do Brasil.');
    end if;
  end if;

  with linhas as (
    select c.id, c.updated_at
      from public.conversations c
     where (v_ficha is null or c.organization_id = v_ficha)
       and (v_tel is null or c.peer_phone_e164 = v_tel)
       and (v_desde is null or c.updated_at >= v_desde)
       and (v_cts is null or (c.updated_at, c.id) < (v_cts, v_cid))
     order by c.updated_at desc, c.id desc
     limit v_lim + 1)
  select coalesce(jsonb_agg(app.api_conversa(l.id) order by l.n) filter (where l.n <= v_lim), '[]'::jsonb),
         coalesce(bool_or(l.n > v_lim), false),
         max(case when l.n = v_lim then app.api_cursor(l.updated_at, l.id) end)
    into v_itens, v_mais, v_prox
    from (select x.*, row_number() over (order by x.updated_at desc, x.id desc) as n from linhas x) l;

  return app.api_ok(200, v_itens, jsonb_build_object('proximo', case when v_mais then v_prox end,
                                                     'registros', jsonb_array_length(v_itens)));
end $$;

-- GET /v1/conversas/{id}
create or replace function app.api_v1_conversa(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := app.api_conversa(p_id);
begin
  if v is null then
    return app.api_erro(404, 'conversa_inexistente', 'Não há conversa com este id.');
  end if;
  return app.api_ok(200, v, jsonb_build_object('registros', 1));
end $$;

-- GET /v1/conversas/{id}/mensagens — da mais nova para a mais velha
create or replace function app.api_v1_mensagens(p_id uuid, p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lim   integer := app.api_limite(p, 50, 200);
  v_desde timestamptz := app.api_instante(p, 'desde');
  v_cts   timestamptz;
  v_cid   uuid;
  v_itens jsonb;
  v_mais  boolean;
  v_prox  text;
begin
  if not exists (select 1 from public.conversations c where c.id = p_id) then
    return app.api_erro(404, 'conversa_inexistente', 'Não há conversa com este id.');
  end if;
  select c.em, c.id into v_cts, v_cid from app.api_cursor_ler(p ->> 'cursor') c;

  with linhas as (
    select m.id, m.created_at
      from public.messages m
     where m.conversation_id = p_id
       and (v_desde is null or m.created_at >= v_desde)
       and (v_cts is null or (m.created_at, m.id) < (v_cts, v_cid))
     order by m.created_at desc, m.id desc
     limit v_lim + 1)
  select coalesce(jsonb_agg(app.api_mensagem(l.id) order by l.n) filter (where l.n <= v_lim), '[]'::jsonb),
         coalesce(bool_or(l.n > v_lim), false),
         max(case when l.n = v_lim then app.api_cursor(l.created_at, l.id) end)
    into v_itens, v_mais, v_prox
    from (select x.*, row_number() over (order by x.created_at desc, x.id desc) as n from linhas x) l;

  return app.api_ok(200, v_itens, jsonb_build_object('proximo', case when v_mais then v_prox end,
                                                     'registros', jsonb_array_length(v_itens)));
end $$;

-- POST /v1/conversas/{id}/mensagens — texto, pela mesma porta da tela
create or replace function app.api_v1_responder(k app.api_chaves, p_id uuid, c jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text;
  v_resp  uuid;
  v_id    uuid;
begin
  perform app.api_so_campos(c, array['texto', 'responde_a']);
  v_texto := app.api_texto(c, 'texto', 4096, true);
  v_resp := app.api_uuid(app.api_texto(c, 'responde_a', 40), 'responde_a');
  if not exists (select 1 from public.conversations x where x.id = p_id) then
    return app.api_erro(404, 'conversa_inexistente', 'Não há conversa com este id.');
  end if;
  if v_resp is not null and not exists (select 1 from public.messages m
                                         where m.id = v_resp and m.conversation_id = p_id) then
    perform app.api_falhar(422, 'responde_a_inexistente', 'A mensagem citada não é desta conversa.',
                           jsonb_build_object('campo', 'responde_a'));
  end if;
  -- Os mesmos campos que `responder()` da tela manda (components/conversas/acoes.ts):
  -- humana, com autor, origem crm. A porteira (`messages_guard`) decide se sai.
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by,
                               origin, responde_a)
  values (p_id, 'out', 'text', 'queued', v_texto, 'human', k.em_nome_de, 'crm', v_resp)
  returning id into v_id;
  return app.api_ok(202, app.api_mensagem(v_id), jsonb_build_object('registros', 1));
end $$;

-- GET /v1/modelos — os modelos de WhatsApp que podem sair
create or replace function app.api_v1_modelos()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.api_ok(200, coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'codigo', t.template_code, 'nome', t.name, 'categoria', t.category,
             'tipo', t.kind, 'aprovado_na_meta', lower(coalesce(t.meta_status, '')) = 'approved',
             'situacao_na_meta', t.meta_status, 'texto', t.body,
             -- `atendente` e `saudacao` o CRM preenche sozinho.
             'variaveis', coalesce((select jsonb_agg(v order by v)
                                      from jsonb_array_elements_text(t.variables) v
                                     where v not in ('atendente', 'saudacao')), '[]'::jsonb),
             'botoes', t.botoes)
           order by t.template_code)
      from public.message_templates t
     -- O mesmo recorte da tela de Disparos (components/envios/dados.ts): registrado
     -- na Meta e fora do sistema. Respostas prontas, objeções e roteiros de áudio
     -- são textos do CRM, não modelos da Meta; dentro da janela de 24 h, quem
     -- integra manda o texto em POST /v1/conversas/{id}/mensagens.
     where t.is_active and t.channel = 'whatsapp'::app.channel and t.template_code not like 'GEN-SYS-%'
       and t.meta_template_name is not null),
    '[]'::jsonb))
$$;

create or replace function app.api_achar_modelo(p_valor text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  select t.id into v from public.message_templates t
   where t.is_active and t.channel = 'whatsapp'::app.channel
     and case when btrim(p_valor) ~ '^[0-9]{1,9}$' then t.id = btrim(p_valor)::integer
              else t.template_code = upper(btrim(p_valor)) end;
  if v is null then
    perform app.api_falhar(422, 'modelo_inexistente', 'Modelo inexistente ou desativado. Veja a lista em GET /v1/modelos.',
                           jsonb_build_object('campo', 'modelo'));
  end if;
  return v;
end $$;

-- POST /v1/fichas/{id}/modelo e POST /v1/conversas/{id}/modelo
create or replace function app.api_v1_modelo(p_ficha uuid, p_conversa uuid, c jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tpl    integer;
  v_params jsonb;
  v_org    uuid := p_ficha;
  v_r      jsonb;
  v_msg    uuid;
  v_conv   uuid;
begin
  perform app.api_so_campos(c, array['modelo', 'parametros']);
  v_tpl := app.api_achar_modelo(app.api_texto(c, 'modelo', 80, true));
  v_params := coalesce(c -> 'parametros', '{}'::jsonb);
  if jsonb_typeof(v_params) <> 'object' then
    perform app.api_falhar(422, 'campo_invalido', 'parametros precisa ser um objeto: {"nome": "Maria", ...}.',
                           jsonb_build_object('campo', 'parametros'));
  end if;
  if app.tem_cpf(v_params::text) then
    perform app.api_falhar(422, 'cpf_nao_sai', 'O CRM não manda CPF por mensagem.', jsonb_build_object('campo', 'parametros'));
  end if;

  if p_conversa is not null then
    select x.organization_id into v_org from public.conversations x where x.id = p_conversa;
    if not found then
      return app.api_erro(404, 'conversa_inexistente', 'Não há conversa com este id.');
    end if;
  elsif not exists (select 1 from public.organizations o where o.id = p_ficha and o.deleted_at is null) then
    return app.api_erro(404, 'ficha_inexistente', 'Não há ficha com este id (ou ela foi excluída).');
  end if;

  if v_org is not null then
    v_r := public.wa_enviar_modelo(v_org, v_tpl, v_params);
  else
    v_r := public.wa_enviar_modelo_na_conversa(p_conversa, v_tpl, v_params);
  end if;

  v_msg := nullif(v_r ->> 'message_id', '')::uuid;
  v_conv := coalesce(nullif(v_r ->> 'conversation_id', '')::uuid, p_conversa);
  if v_msg is null then
    return app.api_erro(422, 'envio_recusado',
      app.api_frase_da_recusa(coalesce(v_r ->> 'motivo', v_r ->> 'reason', 'desconhecido')),
      jsonb_build_object('motivo', coalesce(v_r ->> 'motivo', v_r ->> 'reason')));
  end if;
  return app.api_ok(202, jsonb_build_object('conversa_id', v_conv, 'mensagem', app.api_mensagem(v_msg)),
                    jsonb_build_object('registros', 1));
end $$;

-- GET/POST /v1/webhooks, DELETE /v1/webhooks/{id}, POST /v1/webhooks/{id}/teste
create or replace function app.api_v1_webhooks(k app.api_chaves, p_metodo text, p_id uuid, p_teste boolean, c jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r       jsonb;
  v_eventos text[];
  w         app.api_webhooks%rowtype;
begin
  if p_metodo = 'GET' then
    return app.api_ok(200, coalesce((select jsonb_agg(app.api_webhook_json(x.id) order by x.criado_em desc)
                                       from app.api_webhooks x), '[]'::jsonb),
                      jsonb_build_object('registros', (select count(*) from app.api_webhooks)));
  end if;

  if p_metodo = 'POST' and p_id is null then
    perform app.api_so_campos(c, array['url', 'eventos', 'descricao']);
    if jsonb_typeof(c -> 'eventos') is distinct from 'array' then
      perform app.api_falhar(422, 'campo_invalido', 'eventos precisa ser uma lista, por exemplo ["mensagem.recebida"].',
                             jsonb_build_object('campo', 'eventos'));
    end if;
    select array_agg(e) into v_eventos from jsonb_array_elements_text(c -> 'eventos') e;
    v_r := app.api_webhook_novo(app.api_texto(c, 'url', 500, true), v_eventos,
                                app.api_texto(c, 'descricao', 200), k.em_nome_de, k.id);
    if not coalesce((v_r ->> 'ok')::boolean, false) then
      return app.api_erro(422, v_r ->> 'motivo', coalesce(v_r ->> 'mensagem', 'Webhook recusado.'));
    end if;
    return app.api_ok(201, app.api_webhook_json((v_r ->> 'id')::uuid) || jsonb_build_object('segredo', v_r ->> 'segredo'),
                      jsonb_build_object('registros', 1));
  end if;

  select * into w from app.api_webhooks x where x.id = p_id;
  if not found then
    return app.api_erro(404, 'webhook_inexistente', 'Não há webhook com este id.');
  end if;

  if p_metodo = 'POST' and p_teste then
    perform app.api_evento('teste', jsonb_build_object('mensagem', 'Aviso de teste do CRM. Se chegou, está tudo certo.'), p_id);
    return app.api_ok(202, jsonb_build_object('enfileirado', true), jsonb_build_object('registros', 1));
  end if;

  if p_metodo = 'DELETE' then
    -- Pela API, cada chave apaga só o que ela mesma criou; o resto é da tela de Ajustes.
    if w.chave_id is distinct from k.id then
      return app.api_erro(403, 'webhook_de_outra_origem',
        'Este webhook foi criado em Ajustes ou por outra chave. Apague pela tela de Ajustes → Integrações.');
    end if;
    perform app.api_webhook_apagar(p_id, k.em_nome_de);
    return app.api_ok(200, jsonb_build_object('id', p_id, 'excluido', true), jsonb_build_object('registros', 1));
  end if;

  return app.api_erro(405, 'metodo_nao_permitido', 'Método não aceito nesta rota.');
end $$;


-- =============================================================================
-- H. A PORTA — `public.api_atender`, a única função que a Edge Function chama
-- =============================================================================

-- As rotas e o escopo que cada uma pede (null = qualquer chave válida).
create or replace function app.api_rotas()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'GET /v1',                           null,
    'GET /v1/fichas',                    'fichas:ler',
    'GET /v1/fichas/{id}',               'fichas:ler',
    'PATCH /v1/fichas/{id}',             'fichas:escrever',
    'POST /v1/fichas/{id}/notas',        'fichas:escrever',
    'POST /v1/fichas/{id}/modelo',       'mensagens:enviar',
    'POST /v1/leads',                    'fichas:escrever',
    'GET /v1/funis',                     'funil:ler',
    'GET /v1/negocios',                  'funil:ler',
    'GET /v1/negocios/{id}',             'funil:ler',
    'POST /v1/negocios/{id}/mover',      'funil:escrever',
    'GET /v1/conversas',                 'conversas:ler',
    'GET /v1/conversas/{id}',            'conversas:ler',
    'GET /v1/conversas/{id}/mensagens',  'conversas:ler',
    'POST /v1/conversas/{id}/mensagens', 'mensagens:enviar',
    'POST /v1/conversas/{id}/modelo',    'mensagens:enviar',
    'GET /v1/modelos',                   'mensagens:enviar',
    'GET /v1/webhooks',                  'webhooks',
    'POST /v1/webhooks',                 'webhooks',
    'DELETE /v1/webhooks/{id}',          'webhooks',
    'POST /v1/webhooks/{id}/teste',      'webhooks')
$$;

-- Exceção do banco → resposta. As recusas das rotas (`app.api_falhar`) trazem o
-- status na dica; as do envio, o código do motivo no texto; o resto é 500, e o
-- SQLSTATE fica só na anotação.
create or replace function app.api_resposta_da_excecao(p_estado text, p_texto text, p_detalhe text, p_dica text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_motivo text;
begin
  if p_dica ~ '^api:[0-9]{3}' then
    return app.api_erro(substr(p_dica, 5, 3)::integer, p_texto, p_detalhe,
                        case when char_length(p_dica) > 8 then substr(p_dica, 9)::jsonb end);
  end if;
  v_motivo := lower(substring(p_texto from '(?:[Rr]ecusad[oa][^:]*):\s*([A-Za-z_]+)'));
  if v_motivo is not null then
    return app.api_erro(422, 'envio_recusado', app.api_frase_da_recusa(v_motivo),
                        jsonb_build_object('motivo', v_motivo));
  end if;
  if p_texto like '%messages_sem_cpf%' then
    return app.api_erro(422, 'cpf_nao_sai', 'O CRM não manda CPF por mensagem (o texto parece ter um CPF).');
  end if;
  return case
    when p_estado = 'P0002' then app.api_erro(404, 'nao_encontrado', p_texto)
    when p_estado = '42501' then app.api_erro(403, 'sem_permissao',
                                   'A pessoa em nome de quem a chave age não pode fazer isso.')
    when p_estado = '23505' then app.api_erro(409, 'ja_existe',
                                   'Já existe outra ficha com este dado (telefone, e-mail, Instagram ou CNPJ).')
    when p_estado in ('23514', '23502', '22P02', '22023', '22001', '22007', '22008') then
      app.api_erro(422, 'valor_invalido', 'Um dos valores não passou na conferência do CRM.')
    when p_estado = 'P0001' then app.api_erro(422, 'recusado', p_texto)
    else app.api_erro(500, 'erro_interno',
           'Erro inesperado no CRM. Tente de novo em alguns minutos; se continuar, avise a equipe com o horário da chamada.')
  end;
end $$;

create or replace function app.api_agir_como(p_perfil uuid, p_papel text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- O que o PostgREST poria para quem entrou no CRM: daqui em diante, nesta
  -- transação, auth.uid() e app.role() respondem pela pessoa.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_perfil, 'role', 'authenticated', 'aud', 'authenticated',
                       'app_metadata', jsonb_build_object('app_role', p_papel),
                       'via', 'api')::text, true);
  perform set_config('request.jwt.claim.sub', p_perfil::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

create or replace function public.api_atender(p_resumo text, p_metodo text, p_caminho text,
                                              p_consulta jsonb default '{}'::jsonb,
                                              p_corpo jsonb default null,
                                              p_idempotencia text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k        app.api_chaves%rowtype;
  v_metodo text := upper(btrim(coalesce(p_metodo, '')));
  v_seg    text[];
  v_s      text;
  v_ids    uuid[] := '{}'::uuid[];
  v_partes text[] := '{}'::text[];
  v_rota   text;
  v_rotas  jsonb := app.api_rotas();
  v_escopo text;
  v_papel  text;
  v_uso    integer;
  v_idem   app.api_idempotencia%rowtype;
  v_idem_c text := nullif(btrim(coalesce(p_idempotencia, '')), '');
  v_cons   jsonb := case when jsonb_typeof(p_consulta) = 'object' then p_consulta else '{}'::jsonb end;
  v_resp   jsonb;
  v_estado text;
  v_texto  text;
  v_det    text;
  v_dica   text;
  v_codigo text;
begin
  -- ---- 1. A chave ----
  if p_resumo is null or p_resumo !~ '^[0-9a-f]{64}$' then
    return app.api_erro(401, 'chave_ausente',
      'Mande a chave da API no cabeçalho Authorization: Bearer <chave>. A chave é criada em Ajustes → Integrações.');
  end if;
  select * into k from app.api_chaves where resumo = p_resumo;
  if not found then
    return app.api_erro(401, 'chave_invalida',
      'Esta chave não existe neste CRM. Confira se ela é desta empresa (o começo diz: trd_imova_ ou trd_komune_).');
  end if;

  -- ---- 2. A rota ----
  v_seg := array_remove(string_to_array(btrim(coalesce(p_caminho, ''), '/'), '/'), '');
  foreach v_s in array coalesce(v_seg, '{}'::text[]) loop
    if v_s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_ids := v_ids || v_s::uuid;
      v_partes := v_partes || '{id}'::text;
    else
      v_partes := v_partes || lower(v_s);
    end if;
  end loop;
  v_rota := v_metodo || ' /' || array_to_string(v_partes, '/');

  if k.revogada_em is not null then
    insert into app.api_chamadas (chave_id, metodo, rota, status, codigo)
    values (k.id, v_metodo, left(v_rota, 200), 401, 'chave_revogada');
    return app.api_erro(401, 'chave_revogada',
      'Esta chave foi revogada em Ajustes → Integrações. Peça uma chave nova a quem administra o CRM.');
  end if;

  select p.role::text into v_papel from public.profiles p where p.id = k.em_nome_de and p.is_active;
  if v_papel is null or v_papel not in ('admin', 'gestor') then
    insert into app.api_chamadas (chave_id, metodo, rota, status, codigo)
    values (k.id, v_metodo, left(v_rota, 200), 403, 'dono_sem_acesso');
    return app.api_erro(403, 'dono_sem_acesso',
      'A pessoa em nome de quem esta chave age não é mais admin ou gestor ativo no CRM. Crie uma chave nova em Ajustes → Integrações.');
  end if;

  if not v_rotas ? v_rota then
    v_resp := case
      when exists (select 1 from jsonb_object_keys(v_rotas) r
                    where split_part(r, ' ', 2) = '/' || array_to_string(v_partes, '/'))
        then app.api_erro(405, 'metodo_nao_permitido',
               format('A rota /%s não aceita %s.', array_to_string(v_partes, '/'), v_metodo))
      else app.api_erro(404, 'rota_inexistente',
             'Esta rota não existe. As rotas estão na documentação da API (docs/operacao/api-externa.md).')
    end;
    insert into app.api_chamadas (chave_id, metodo, rota, status, codigo)
    values (k.id, v_metodo, left(v_rota, 200), (v_resp ->> 'status')::integer, v_resp #>> '{erro,codigo}');
    return v_resp;
  end if;

  -- ---- 3. A permissão ----
  v_escopo := v_rotas ->> v_rota;
  if v_escopo is not null and not (v_escopo = any (k.escopos)) then
    insert into app.api_chamadas (chave_id, metodo, rota, status, codigo)
    values (k.id, v_metodo, v_rota, 403, 'sem_escopo');
    return app.api_erro(403, 'sem_escopo',
      format('Esta chave não tem a permissão "%s", que esta rota pede. Crie uma chave com ela em Ajustes → Integrações.', v_escopo),
      jsonb_build_object('escopo', v_escopo));
  end if;

  -- ---- 4. O limite por minuto ----
  insert into app.api_uso as u (chave_id, minuto, chamadas)
  values (k.id, date_trunc('minute', now()), 1)
  on conflict (chave_id, minuto) do update set chamadas = u.chamadas + 1
  returning u.chamadas into v_uso;
  if v_uso > k.limite_por_minuto then
    return app.api_erro(429, 'limite_por_minuto',
      format('Esta chave passou de %s chamadas neste minuto. Espere e tente de novo.', k.limite_por_minuto),
      jsonb_build_object('espera_s', 60 - floor(extract(second from now()))::integer));
  end if;

  -- ---- 5. A idempotência (POST) ----
  if v_idem_c is not null and v_metodo = 'POST' then
    if char_length(v_idem_c) > 200 then
      return app.api_erro(400, 'idempotencia_invalida', 'Idempotency-Key tem de ter até 200 caracteres.');
    end if;
    select * into v_idem from app.api_idempotencia i
     where i.chave_id = k.id and i.chave = v_idem_c and i.criada_em > now() - interval '24 hours';
    if found then
      if v_idem.rota is distinct from v_metodo || ' /' || array_to_string(v_seg, '/') then
        return app.api_erro(422, 'idempotencia_reusada',
          'Esta Idempotency-Key já foi usada em outro pedido nas últimas 24 h. Use uma chave nova para cada pedido.');
      end if;
      insert into app.api_chamadas (chave_id, metodo, rota, status, codigo)
      values (k.id, v_metodo, v_rota, (v_idem.resposta ->> 'status')::integer, 'repetido');
      return v_idem.resposta || jsonb_build_object('repetido_pela_idempotencia', true);
    end if;
  end if;

  if v_metodo in ('POST', 'PATCH') and p_corpo is not null and jsonb_typeof(p_corpo) <> 'object' then
    return app.api_erro(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  end if;

  -- ---- 6. O trabalho, em nome da pessoa ----
  begin
    perform app.api_agir_como(k.em_nome_de, v_papel);
    v_resp := case v_rota
      when 'GET /v1'                           then app.api_v1_inicio(k)
      when 'GET /v1/fichas'                    then app.api_v1_fichas(v_cons)
      when 'GET /v1/fichas/{id}'               then app.api_v1_ficha(v_ids[1])
      when 'PATCH /v1/fichas/{id}'             then app.api_v1_ficha_mudar(v_ids[1], p_corpo)
      when 'POST /v1/fichas/{id}/notas'        then app.api_v1_nota(k, v_ids[1], p_corpo)
      when 'POST /v1/fichas/{id}/modelo'       then app.api_v1_modelo(v_ids[1], null, p_corpo)
      when 'POST /v1/leads'                    then app.api_v1_lead(k, coalesce(p_corpo, '{}'::jsonb))
      when 'GET /v1/funis'                     then app.api_v1_funis()
      when 'GET /v1/negocios'                  then app.api_v1_negocios(v_cons)
      when 'GET /v1/negocios/{id}'             then app.api_v1_negocio(v_ids[1])
      when 'POST /v1/negocios/{id}/mover'      then app.api_v1_mover(v_ids[1], coalesce(p_corpo, '{}'::jsonb))
      when 'GET /v1/conversas'                 then app.api_v1_conversas(v_cons)
      when 'GET /v1/conversas/{id}'            then app.api_v1_conversa(v_ids[1])
      when 'GET /v1/conversas/{id}/mensagens'  then app.api_v1_mensagens(v_ids[1], v_cons)
      when 'POST /v1/conversas/{id}/mensagens' then app.api_v1_responder(k, v_ids[1], coalesce(p_corpo, '{}'::jsonb))
      when 'POST /v1/conversas/{id}/modelo'    then app.api_v1_modelo(null, v_ids[1], coalesce(p_corpo, '{}'::jsonb))
      when 'GET /v1/modelos'                   then app.api_v1_modelos()
      when 'GET /v1/webhooks'                  then app.api_v1_webhooks(k, 'GET', null, false, null)
      when 'POST /v1/webhooks'                 then app.api_v1_webhooks(k, 'POST', null, false, coalesce(p_corpo, '{}'::jsonb))
      when 'DELETE /v1/webhooks/{id}'          then app.api_v1_webhooks(k, 'DELETE', v_ids[1], false, null)
      when 'POST /v1/webhooks/{id}/teste'      then app.api_v1_webhooks(k, 'POST', v_ids[1], true, null)
    end;
  exception when others then
    get stacked diagnostics v_estado = returned_sqlstate, v_texto = message_text,
                            v_det = pg_exception_detail, v_dica = pg_exception_hint;
    v_resp := app.api_resposta_da_excecao(v_estado, v_texto, v_det, v_dica);
    if (v_resp ->> 'status')::integer >= 500 then
      v_codigo := 'erro_interno:' || v_estado;
      raise warning 'api: % % falhou (%: %)', v_metodo, v_rota, v_estado, left(v_texto, 300);
    end if;
  end;

  -- ---- 7. Guardar, anotar ----
  if v_idem_c is not null and v_metodo = 'POST' and (v_resp ->> 'status')::integer between 200 and 299 then
    insert into app.api_idempotencia (chave_id, chave, rota, resposta)
    values (k.id, v_idem_c, v_metodo || ' /' || array_to_string(v_seg, '/'), v_resp)
    on conflict (chave_id, chave) do update
      set rota = excluded.rota, resposta = excluded.resposta, criada_em = excluded.criada_em;
  end if;
  update app.api_chaves set usada_em = now()
   where id = k.id and (usada_em is null or usada_em < now() - interval '1 minute');
  insert into app.api_chamadas (chave_id, metodo, rota, status, codigo, registros)
  values (k.id, v_metodo, v_rota, (v_resp ->> 'status')::integer,
          coalesce(v_codigo, v_resp #>> '{erro,codigo}'), (v_resp ->> 'registros')::integer);

  return v_resp;
end $$;
comment on function public.api_atender(text, text, text, jsonb, jsonb, text) is
  'A API externa do CRM (Edge Function api, só com a service_role). Recebe o SHA-256 da chave, o método, o caminho (v1/...), a consulta, o corpo e a Idempotency-Key; confere a chave, a rota, o escopo e o limite; faz o trabalho em nome da pessoa da chave, com as regras do CRM; anota a chamada. Devolve {status, dados|erro, ...}.';


-- =============================================================================
-- I. QUEM CHAMA O QUÊ
-- =============================================================================

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'app' and p.proname like 'api\_%')
        or (n.nspname = 'public' and p.proname like 'api\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.assinatura);
  end loop;
end $$;

grant execute on function public.api_atender(text, text, text, jsonb, jsonb, text) to service_role;

grant execute on function public.api_integracoes()                      to authenticated;
grant execute on function public.api_chave_criar(text, text[], uuid)    to authenticated;
grant execute on function public.api_chave_revogar(uuid)                to authenticated;
grant execute on function public.api_webhook_criar(text, text[], text)  to authenticated;
grant execute on function public.api_webhook_ativar(uuid, boolean)      to authenticated;
grant execute on function public.api_webhook_excluir(uuid)              to authenticated;
grant execute on function public.api_webhook_testar(uuid)               to authenticated;
grant execute on function public.api_webhook_entregas(uuid, integer)    to authenticated;

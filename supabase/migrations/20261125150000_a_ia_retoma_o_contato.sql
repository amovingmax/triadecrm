-- =====================================================================
-- A IA que atende retoma o contato com o cliente que parou de responder —
-- só na Imova (11/11/2026; trazida para a main em 25/11/2026)
--
-- DECISÕES DO DONO DEPOIS DE 11/11 (valem sobre o pedido abaixo):
--   * 16/11 e 24/11 (item 18): UMA retomada só, ~20 h depois da última
--     mensagem do cliente (dentro da janela grátis de 24 h), no horário
--     comercial, com um gancho do imóvel. Por isso o padrão de `dias` é [1]:
--     só o texto da IA, nenhum modelo pago. Os dias 3 e 7 continuam
--     possíveis pela tela, mas não vêm ligados.
--   * 25/11: a mensagem termina no gancho, SEM pergunta
--     (`retomar-conversa@v2`).
--
-- Pedido do usuário: a IA que atende só responde quando o cliente escreve; ele
-- quer que ela mande mensagem depois de 1, 3 e 7 dias sem resposta, para
-- aquecer o cliente. No WhatsApp oficial (ADR-06), fora da janela de 24 h
-- desde a última mensagem do cliente só sai modelo aprovado pela Meta.
--
-- O DESENHO:
--   * O SILÊNCIO é a última vez que o cliente escreveu (`last_inbound_at`),
--     quando depois disso só a Imova falou. Cada silêncio tem as suas etapas
--     (`dias`, padrão 1, 3 e 7); o cliente escrever qualquer coisa encerra o
--     silêncio, e as etapas dele param de valer.
--   * DIA 1 = TEXTO DA IA, dentro da janela de 24 h: entre `texto_de_horas` e
--     `texto_ate_horas` (padrão 20 h e 23 h) depois da última mensagem do
--     cliente, e só no horário permitido. O banco põe na fila `ai_jobs`
--     (`retomar_conversa`); o worker escreve com `retomar-conversa@v1` (Haiku
--     5.5, pseudonimizado pelo `executar()`), e a IA pode decidir NÃO retomar
--     (o cliente fechou o assunto), o que encerra as etapas daquele silêncio.
--   * DIAS 2 EM DIANTE = MODELO aprovado pela Meta (`message_templates`, a
--     mesma infraestrutura do bom-dia), com as variáveis {{nome}} e
--     {{imovel}} (e {{saudacao}}). Sem modelo escolhido, inexistente ou não
--     aprovado: não sai, e a etapa fica registrada com o motivo.
--   * NENHUM MODELO SEM A IA TER LIDO A CONVERSA (revisão de 11/11/2026). Se o
--     silêncio não tem leitura da IA (o texto do dia 1 não saiu, por horário,
--     falha, dado pessoal, orçamento, recusa ou texto fora das regras, ou os
--     dias não incluem o 1), antes do primeiro modelo a IA lê a conversa só
--     para decidir (`ia_retomada_leituras`): segue, ou encerra o silêncio. Se a
--     leitura não sai, por qualquer motivo, o modelo não sai
--     (`sem_leitura_da_ia`). Falha fechada.
--   * PARA quando: o cliente responde; opt-out, supressão, ficha apagada ou
--     conversa bloqueada; a conversa foi concluída; a equipe parou a IA,
--     passou a conversa ou escreveu nela (`app.ia_atende`); a atitude do
--     cliente é sem interesse ou não contatar; o negócio foi ganho ou perdido;
--     há visita marcada depois da última mensagem do cliente (`reunioes`,
--     tarefa de visita da Agenda ou `calendly_agendamentos`, pela ficha da
--     conversa ou pelo telefone); a IA decidiu encerrar; acabaram as etapas.
--     Nunca em domingo ou feriado e só na janela de horário do CRM
--     (`app.janela_do_canal`, RF-CON-11), e com pelo menos
--     `intervalo_min_horas` (padrão 48) desde a última etapa enviada.
--   * SÓ QUEM A IA RESPONDEU: a IA que atende respondeu o cliente depois da
--     última mensagem dele (linha em `ia_respostas` com mensagem e que não é
--     retomada), e os dias contam a partir dessa resposta. A mensagem
--     automática da casa não basta (encaixe com as visitas medidas, que só
--     contam quem recebeu da IA mensagem que não é retomada; 12/11/2026).
--   * SÓ ONDE A IA ATENDE (`app.ia_atende`): no modo treino, só a conversa do
--     treino e as de teste. E só silêncios que começaram DEPOIS de a retomada
--     ser ligada (`ligada_em`): ligar não dispara mensagem a cliente antigo.
--   * DESLIGADA POR PADRÃO: `app_settings['ia.retomada']`, mudada só por
--     `public.ia_retomada_configurar` (admin e gestor).
--
-- A PORTEIRA NÃO MUDA. O texto do dia 1 sai como `bot_ai` sem rascunho pelo
-- ramo (2a) da `messages_guard`: a prova é a linha em `ia_respostas` (ação
-- nova `retomou`) gravada na MESMA transação, com o mesmo corpo, numa conversa
-- em que a IA atende (`app.ia_atendente_autoriza`). O modelo dos dias 3 e 7
-- sai como `bot_fixed` com `template_id` (o caminho de sempre do texto fixo do
-- robô); supressão, janela de 24 h, horário e tetos continuam sendo da
-- porteira (3). A prova da retomada, nos dois casos, é `ia_retomadas`.
--
-- IDEMPOTENTE: uma linha por conversa, silêncio e DIA (mudar a lista de dias
-- não repete o dia que já saiu: a próxima etapa é o primeiro dia maior que o
-- maior já feito), a fila com chave e a rodada com trava (advisory lock).
--
-- O QUE ENTRA:
--   1. `ia_respostas.acao` aceita 'retomou' (a lista é lida da restrição que
--      está no banco e só ganha o valor novo: nenhuma outra ação some).
--   2. `ia_retomadas` (cada etapa de cada silêncio: na fila, enviada ou
--      pulada, com o motivo) e `ia_retomada_leituras` (a leitura da IA antes
--      do primeiro modelo).
--   3. A configuração, o plano de uma conversa, a rodada (cron a cada 5 min,
--      `ia_retomadas_rodar`), as portas do worker (entrada, dizer, desistir,
--      e as da leitura) e as da tela (configurar, painel, selo da conversa).
--   4. `app.ia_funil_retomadas`: os dois passos das retomadas no funil "Do
--      atendimento à visita" da tela da IA. A medição das visitas ainda não
--      está na main (branch ia-tres-encaixe): até lá a função existe e
--      ninguém a chama.
--   5. `retomou` fora das contas da IA que atende: o relatório da IA, a juíza,
--      o relatório que vende e o placar da tela não contam a retomada como
--      atendimento, e o "Corrigir" de uma retomada não escreve no caderno. A
--      troca é feita sobre a função que está no banco (`pg_get_functiondef` e
--      um trecho trocado), e a migração aborta se o trecho não estiver lá o
--      número de vezes esperado.
--
-- Na KOMUNE não faz nada: a IA que atende não existe lá.
--
-- COMO DESFAZER:
--   select cron.unschedule('ia_retomadas_rodar');
--   drop function ... (as funções ia_retomada* e ia_retomadas_rodar);
--   drop function app.ia_funil_retomadas(timestamptz, timestamptz);
--   o item 5: reaplicar as funções das migrações de origem (citadas abaixo);
--   drop table public.ia_retomada_leituras, public.ia_retomadas;
--   delete from public.app_settings where key = 'ia.retomada';
--   (a ação 'retomou' em ia_respostas.acao pode ficar: não muda nada sozinha)
-- =====================================================================

do $retomar$
declare
  v_acoes text[];
  v_def   text;
  v_vezes int;
  t       record;
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é só da Imova: no banco da KOMUNE nada mudou.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 1. ia_respostas.acao ganha 'retomou', sem perder nenhuma outra
  -- -------------------------------------------------------------------
  select array_agg(distinct m[1])
    into v_acoes
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
   where c.conname = 'ia_respostas_acao_check'
     and c.conrelid = 'public.ia_respostas'::regclass;
  if v_acoes is null or not 'respondeu' = any(v_acoes) then
    raise exception 'ia_respostas_acao_check não está no banco como esperado: nada foi trocado.';
  end if;
  if not 'retomou' = any(v_acoes) then
    alter table public.ia_respostas drop constraint ia_respostas_acao_check;
    execute format('alter table public.ia_respostas add constraint ia_respostas_acao_check check (acao in (%s))',
                   (select string_agg(quote_literal(a), ', ' order by a) from unnest(v_acoes || 'retomou'::text) a));
  end if;

  execute $ddl$

-- =====================================================================
-- 2. As tabelas
-- =====================================================================
create table if not exists public.ia_retomadas (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  -- O silêncio: a última vez que o cliente escreveu antes desta retomada.
  ancora_em        timestamptz not null,
  -- Os dias sem resposta que esta etapa conta (a chave, com a conversa e o
  -- silêncio) e a posição dela na lista quando foi feita (só para ler).
  etapa            smallint not null check (etapa between 1 and 5),
  dias             smallint not null check (dias between 1 and 30),
  -- texto: escrito pela IA dentro da janela de 24 h; modelo: aprovado pela Meta.
  tipo             text not null check (tipo in ('texto', 'modelo')),
  -- na_fila: a IA está escrevendo · enviada: a mensagem entrou na fila de
  -- saída · pulada: não saiu, e o motivo diz por quê.
  situacao         text not null check (situacao in ('na_fila', 'enviada', 'pulada')),
  motivo           text check (char_length(motivo) <= 300),
  -- A IA decidiu não retomar (o cliente fechou o assunto): as etapas seguintes
  -- deste silêncio também não saem.
  encerra          boolean not null default false,
  template_id      int references public.message_templates (id) on delete set null,
  template_code    text check (char_length(template_code) <= 80),
  message_id       uuid unique references public.messages (id) on delete set null,
  ia_resposta_id   uuid references public.ia_respostas (id) on delete set null,
  ai_run_id        bigint references public.ai_runs (id) on delete set null,
  prompt_version   text check (char_length(prompt_version) <= 80),
  criada_em        timestamptz not null default now(),
  resolvida_em     timestamptz,
  constraint ia_retomadas_um_por_dia unique (conversation_id, ancora_em, dias)
);
create index if not exists ia_retomadas_resolvida_idx on public.ia_retomadas (resolvida_em desc);
create index if not exists ia_retomadas_na_fila_idx on public.ia_retomadas (criada_em) where situacao = 'na_fila';
alter table public.ia_retomadas enable row level security;
drop policy if exists ia_retomadas_select on public.ia_retomadas;
create policy ia_retomadas_select on public.ia_retomadas
  for select to authenticated using ((select app.is_manager()));
revoke insert, update, delete, truncate on public.ia_retomadas from authenticated, anon;
comment on table public.ia_retomadas is
  'A IA que atende retoma o contato (Imova, 11/11/2026): cada etapa (1, 3 e 7 dias, configuráveis) de cada silêncio do cliente, uma por dia, na fila (a IA escrevendo o texto do dia 1), enviada (texto da IA ou modelo aprovado pela Meta) ou pulada, com o motivo. Escrita só pelas funções ia_retomada*.';

-- A leitura da IA antes do primeiro modelo de um silêncio que ela ainda não
-- leu: segue (o modelo pode sair) ou encerra (o cliente fechou o assunto).
create table if not exists public.ia_retomada_leituras (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  ancora_em        timestamptz not null,
  -- O dia do modelo que esta leitura libera.
  dias             smallint not null check (dias between 1 and 30),
  situacao         text not null check (situacao in ('na_fila', 'segue', 'encerra', 'falhou')),
  motivo           text check (char_length(motivo) <= 300),
  ai_run_id        bigint references public.ai_runs (id) on delete set null,
  prompt_version   text check (char_length(prompt_version) <= 80),
  criada_em        timestamptz not null default now(),
  resolvida_em     timestamptz,
  constraint ia_retomada_leituras_uma_por_dia unique (conversation_id, ancora_em, dias)
);
create index if not exists ia_retomada_leituras_na_fila_idx on public.ia_retomada_leituras (criada_em)
  where situacao = 'na_fila';
alter table public.ia_retomada_leituras enable row level security;
drop policy if exists ia_retomada_leituras_select on public.ia_retomada_leituras;
create policy ia_retomada_leituras_select on public.ia_retomada_leituras
  for select to authenticated using ((select app.is_manager()));
revoke insert, update, delete, truncate on public.ia_retomada_leituras from authenticated, anon;
comment on table public.ia_retomada_leituras is
  'A leitura da IA antes do primeiro modelo da retomada num silêncio que ela não leu (Imova, 11/11/2026): segue, encerra (o cliente fechou o assunto) ou falhou (o modelo não sai: sem_leitura_da_ia). Escrita só pelas funções ia_retomada*.';


-- =====================================================================
-- 3. A configuração
-- =====================================================================
create or replace function app.ia_retomada_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'ligada', false,
           'ligada_em', null,
           'dias', '[1]'::jsonb,
           'modelos', '{}'::jsonb,
           'texto_de_horas', 20,
           'texto_ate_horas', 23,
           'intervalo_min_horas', 48,
           'por_rodada', 30)
      || coalesce((select s.value from public.app_settings s where s.key = 'ia.retomada'), '{}'::jsonb)
$$;
comment on function app.ia_retomada_config() is
  'A configuração da retomada (app_settings ia.retomada) sobre os padrões: desligada; dias [1] (decisão de 24/11: uma retomada só; 1 = texto da IA dentro da janela de 24 h, entre texto_de_horas e texto_ate_horas depois da última mensagem do cliente; os outros, modelo aprovado); modelos = {"<dias>": "<template_code>"}; intervalo_min_horas = o mínimo entre duas etapas enviadas; por_rodada = quantas retomadas a rodada manda, no máximo.';
revoke all on function app.ia_retomada_config() from public, anon, authenticated;

-- Os dias, limpos: inteiros de 1 a 30, sem repetir, em ordem, no máximo 5.
create or replace function app.ia_retomada_dias(p_cfg jsonb)
returns int[]
language sql
immutable
set search_path = ''
as $$
  select coalesce((select array_agg(d order by d)
                     from (select distinct x::int as d
                             from jsonb_array_elements_text(
                                    case when jsonb_typeof(p_cfg -> 'dias') = 'array'
                                         then p_cfg -> 'dias' else '[]'::jsonb end) x
                            where x ~ '^\d{1,2}$' and x::int between 1 and 30
                            order by 1
                            limit 5) s),
                  '{}'::int[])
$$;
revoke all on function app.ia_retomada_dias(jsonb) from public, anon, authenticated;

-- Horas da configuração, como intervalo.
create or replace function app.ia_retomada_horas(p_cfg jsonb, p_chave text, p_padrao numeric)
returns interval
language sql
immutable
set search_path = ''
as $$
  select make_interval(secs => (coalesce((p_cfg ->> p_chave)::numeric, p_padrao) * 3600)::double precision)
$$;
revoke all on function app.ia_retomada_horas(jsonb, text, numeric) from public, anon, authenticated;


-- =====================================================================
-- 4. O que a retomada sabe do cliente: o primeiro nome, o imóvel e as fichas
-- =====================================================================
-- O primeiro nome, como o cliente lê: o da pessoa da ficha, o do contato, o do
-- perfil do WhatsApp ou o da ficha. Só letras; nada de "Loja2024" nem emoji.
create or replace function app.ia_retomada_primeiro_nome(p_conversation_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select * from public.conversations where id = p_conversation_id),
  candidatos as (
    select 1 as ordem, d.primeiro_nome as bruto
      from c cross join lateral app.wa_destino_da_ficha(c.organization_id) d
     where c.organization_id is not null
    union all
    select 2, coalesce(ct.first_name, split_part(btrim(ct.full_name), ' ', 1))
      from c join public.contacts ct on ct.id = c.contact_id
    union all
    select 3, split_part(btrim(c.peer_nome), ' ', 1) from c
    union all
    select 4, split_part(btrim(o.name), ' ', 1)
      from c join public.organizations o on o.id = c.organization_id
  ),
  limpos as (
    select ordem, btrim(coalesce(bruto, '')) as n from candidatos
  )
  select case when n = lower(n) or n = upper(n) then initcap(n) else n end
    from limpos
   where n ~ '^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ''-]{1,19}$'
   order by ordem
   limit 1
$$;
comment on function app.ia_retomada_primeiro_nome(uuid) is
  'O primeiro nome do cliente para o {{nome}} do modelo da retomada: da pessoa da ficha, do contato, do perfil do WhatsApp ou da ficha, só se for um nome de letras (2 a 20).';
revoke all on function app.ia_retomada_primeiro_nome(uuid) from public, anon, authenticated;

-- O imóvel de que falavam: o de maior interesse que o conselheiro leu, o da
-- visita que a IA marcou ou o último código de anúncio citado na conversa.
-- EMPATE (dois imóveis com o mesmo maior interesse, ou dois códigos na mesma
-- última mensagem) não escolhe um: devolve null, e o modelo usa o texto
-- genérico. Só vale imóvel que ainda está na base; `disponivel` só no ar.
create or replace function app.ia_retomada_imovel(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_imoveis jsonb := app.ia_atendente_imoveis();
  v_codigo  text;
  v_qtd     int := 0;
  i         jsonb;
begin
  if to_regclass('public.interesse_no_imovel') is not null then
    begin
      execute $q$
        with n as (
          select x.codigo, case x.nivel when 'muito' then 0 when 'interessado' then 1 else 2 end as g
            from public.interesse_no_imovel x where x.conversation_id = $1)
        select case when count(*) = 1 then min(n.codigo) end, count(*)::int
          from n where n.g = (select min(g) from n)
      $q$ into v_codigo, v_qtd using p_conversation_id;
    exception when others then
      v_codigo := null;
      v_qtd := 0;
    end;
    if v_qtd > 1 then
      return null;
    end if;
  end if;

  if v_codigo is null then
    select r.detalhes ->> 'imovel' into v_codigo
      from public.ia_respostas r
     where r.conversation_id = p_conversation_id
       and r.message_id is not null
       and nullif(r.detalhes ->> 'imovel', '') is not null
     order by r.criada_em desc
     limit 1;
  end if;

  if v_codigo is null then
    with citados as (
      select x.codigo, u.em
        from (select e ->> 'codigo' as codigo from jsonb_array_elements(v_imoveis) e) x
        cross join lateral (
          select max(m.created_at) as em
            from public.messages m
           where m.conversation_id = p_conversation_id
             and m.created_at > now() - interval '30 days'
             and x.codigo is not null and char_length(x.codigo) >= 3
             and position(lower(x.codigo) in lower(coalesce(m.body, ''))) > 0) u
       where u.em is not null)
    select case when count(*) = 1 then min(c.codigo) end, count(*)::int
      into v_codigo, v_qtd
      from citados c where c.em = (select max(em) from citados);
    if v_qtd > 1 then
      return null;
    end if;
  end if;

  if v_codigo is null then
    return null;
  end if;
  select e into i from jsonb_array_elements(v_imoveis) e where e ->> 'codigo' = v_codigo limit 1;
  if i is null then
    return null;
  end if;
  return jsonb_build_object(
    'codigo', v_codigo,
    'titulo', i ->> 'titulo',
    'tipo', i ->> 'tipo',
    'bairro', i ->> 'bairro',
    -- 25/11/2026 (retomar-conversa@v2): o texto do anúncio, de onde sai o gancho do
    -- imóvel. O worker tira preço, código e telefone antes de mandar ao modelo.
    'descricao', left(i ->> 'descricao', 1500),
    'caracteristicas', coalesce(i -> 'caracteristicas', '[]'::jsonb),
    'disponivel', coalesce(i ->> 'situacao', '') = 'no_ar',
    -- O pedaço do modelo: "no imóvel {{imovel}}".
    'frase', case when coalesce(i ->> 'situacao', '') = 'no_ar' then
                    left(concat_ws(' ', 'de ' || nullif(btrim(i ->> 'bairro'), ''),
                                   '(código ' || v_codigo || ')'), 200)
                  end);
end $$;
comment on function app.ia_retomada_imovel(uuid) is
  'O imóvel de que o cliente e a IA falavam (interesse lido pelo conselheiro, visita marcada pela IA ou código citado na conversa), se ainda está na base; empate devolve null. frase = o pedaço do {{imovel}} do modelo ("de Ponta Negra (código AP0012)"), só para imóvel no ar.';
revoke all on function app.ia_retomada_imovel(uuid) from public, anon, authenticated;

-- As fichas de uma conversa: a dela, as da pessoa dela e as que têm o telefone
-- dela (na ficha ou numa pessoa da ficha) — as mesmas chaves que o Calendly
-- usa para achar a ficha (`app.calendly_ficha`).
create or replace function app.ia_retomada_fichas(p_conversation_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct x.id
    from (
      select c.organization_id as id from public.conversations c
       where c.id = p_conversation_id and c.organization_id is not null
      union all
      select oc.organization_id from public.conversations c
        join public.organization_contacts oc on oc.contact_id = c.contact_id
       where c.id = p_conversation_id
      union all
      select o.id from public.conversations c
        join public.organizations o on o.phone_e164 = c.peer_phone_e164
       where c.id = p_conversation_id
      union all
      select oc.organization_id from public.conversations c
        join public.contacts ct on ct.phone_e164 = c.peer_phone_e164 and ct.deleted_at is null
        join public.organization_contacts oc on oc.contact_id = ct.id
       where c.id = p_conversation_id
    ) x
    join public.organizations o on o.id = x.id and o.deleted_at is null
$$;
revoke all on function app.ia_retomada_fichas(uuid) from public, anon, authenticated;


-- =====================================================================
-- 5. Pode retomar esta conversa? O plano dela
-- =====================================================================
-- Visita marcada para depois da última mensagem do cliente: a reunião da
-- Agenda, a tarefa de visita (da equipe ou do Calendly) ou o agendamento do
-- Calendly, pela conversa, pela ficha ou pelo telefone. A conversa já andou.
create or replace function app.ia_retomada_tem_visita(p_conversation_id uuid, p_desde timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fichas uuid[] := array(select app.ia_retomada_fichas(p_conversation_id));
  v_sim    boolean := false;
begin
  if exists (select 1 from public.reunioes r
              where (r.conversation_id = p_conversation_id or r.organization_id = any(v_fichas))
                and r.estado in ('a_confirmar', 'marcada', 'confirmada', 'realizada')
                and r.inicio >= p_desde) then
    return true;
  end if;
  if exists (select 1 from public.tasks t
              where t.kind = 'visit'::app.task_kind
                and t.status <> 'cancelled'::app.task_status
                and t.due_at >= p_desde
                and t.organization_id = any(v_fichas)) then
    return true;
  end if;
  if cardinality(v_fichas) > 0 and to_regclass('public.calendly_agendamentos') is not null then
    execute $q$
      select exists (select 1 from public.calendly_agendamentos a
                      where a.organization_id = any($1) and a.situacao = 'agendado' and a.inicio >= $2)
    $q$ into v_sim using v_fichas, p_desde;
  end if;
  return coalesce(v_sim, false);
end $$;
revoke all on function app.ia_retomada_tem_visita(uuid, timestamptz) from public, anon, authenticated;

-- Quando o silêncio começa a contar: a última resposta da IA que atende (com
-- mensagem, e que não é retomada) depois da última mensagem do cliente. Null
-- = a IA não respondeu o cliente (só a mensagem automática da casa, ou nada):
-- não há conversa da IA para retomar (encaixe com as visitas medidas, 12/11/2026).
create or replace function app.ia_retomada_inicio(p_conversation_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(r.criada_em)
    from public.ia_respostas r
    join public.conversations c on c.id = r.conversation_id
   where r.conversation_id = p_conversation_id
     and r.message_id is not null
     and r.acao <> 'retomou'
     and r.criada_em >= c.last_inbound_at
$$;
revoke all on function app.ia_retomada_inicio(uuid) from public, anon, authenticated;

-- O que impede a retomada AGORA, ou null. `p_ancora` (opcional) é o silêncio
-- que se quer retomar: se o cliente escreveu depois dele, ele respondeu.
create or replace function app.ia_retomada_impedimento(p_conversation_id uuid, p_ancora timestamptz default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.conversations%rowtype;
  v_motivo text;
  v_fichas uuid[];
begin
  if not coalesce((app.ia_retomada_config() ->> 'ligada')::boolean, false) then
    return 'retomada_desligada';
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return 'conversa_inexistente';
  end if;
  if c.channel <> 'whatsapp'::app.channel then
    return 'nao_e_whatsapp';
  end if;
  if c.arquivada_em is not null then
    return 'conversa_concluida';
  end if;
  if c.last_inbound_at is null then
    return 'o_cliente_nunca_escreveu';
  end if;
  if p_ancora is not null and c.last_inbound_at is distinct from p_ancora then
    return 'o_cliente_respondeu';
  end if;
  -- Silêncio é a Imova ter falado por último. Cliente que falou por último
  -- espera a IA que atende (ou se despediu, e ela ficou quieta).
  if not exists (select 1 from public.messages m
                  where m.conversation_id = c.id
                    and m.direction = 'out'::app.msg_direction
                    and m.status <> 'failed'::app.msg_status
                    and m.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
                    and m.created_at > c.last_inbound_at) then
    return 'o_cliente_falou_por_ultimo';
  end if;
  -- Só se retoma a conversa que a IA atendeu: ela respondeu o cliente depois da
  -- última mensagem dele (a mensagem automática da casa não conta).
  if app.ia_retomada_inicio(c.id) is null then
    return 'a_ia_nao_respondeu_o_cliente';
  end if;
  -- Ligada, não bloqueada, robô não pausado, não parada, não passada, ninguém
  -- do time escreveu, e no treino só a do treino e as de teste.
  if not app.ia_atende(c.id) then
    return 'a_ia_nao_atende';
  end if;
  v_motivo := app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164);
  if v_motivo is not null then
    return v_motivo;
  end if;
  if to_regclass('public.atitudes') is not null then
    select case when a.etiqueta = 'nao_contatar' then 'nao_contatar'
                when a.etiqueta = 'sem_interesse' or a.marcada = 'sem_interesse' then 'cliente_sem_interesse' end
      into v_motivo
      from public.atitudes a where a.conversation_id = c.id;
    if v_motivo is not null then
      return v_motivo;
    end if;
  end if;
  v_fichas := array(select app.ia_retomada_fichas(c.id));
  if exists (select 1 from public.deals d
              where d.organization_id = any(v_fichas)
                and ((d.status = 'won'::app.deal_status and d.won_at >= c.last_inbound_at)
                     or (d.status = 'lost'::app.deal_status and d.lost_at >= c.last_inbound_at))) then
    return 'negocio_fechado';
  end if;
  if app.ia_retomada_tem_visita(c.id, c.last_inbound_at) then
    return 'visita_marcada';
  end if;
  if exists (select 1 from public.ia_retomadas r
              where r.conversation_id = c.id and r.ancora_em = c.last_inbound_at and r.encerra)
     or exists (select 1 from public.ia_retomada_leituras l
                 where l.conversation_id = c.id and l.ancora_em = c.last_inbound_at and l.situacao = 'encerra') then
    return 'a_ia_encerrou';
  end if;
  return null;
end $$;
comment on function app.ia_retomada_impedimento(uuid, timestamptz) is
  'Por que a retomada não pode seguir nesta conversa agora (retomada_desligada, conversa_concluida, o_cliente_respondeu, o_cliente_falou_por_ultimo, a_ia_nao_atende, supressão de app.wa_motivo_de_recusa, nao_contatar, cliente_sem_interesse, negocio_fechado, visita_marcada, a_ia_encerrou...), ou null.';
revoke all on function app.ia_retomada_impedimento(uuid, timestamptz) from public, anon, authenticated;

-- A IA já leu este silêncio? 'texto' (o texto do dia 1 saiu: ela leu e decidiu
-- retomar), 'segue' (a leitura antes do modelo disse que segue) ou null.
create or replace function app.ia_retomada_lida(p_conversation_id uuid, p_ancora timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when exists (select 1 from public.ia_retomadas r
                         where r.conversation_id = p_conversation_id and r.ancora_em = p_ancora
                           and r.tipo = 'texto' and r.situacao = 'enviada') then 'texto'
           when exists (select 1 from public.ia_retomada_leituras l
                         where l.conversation_id = p_conversation_id and l.ancora_em = p_ancora
                           and l.situacao = 'segue') then 'segue'
         end
$$;
revoke all on function app.ia_retomada_lida(uuid, timestamptz) from public, anon, authenticated;

-- O plano: a próxima etapa (o primeiro dia da lista maior que o maior já
-- feito neste silêncio) e quando ela pode sair (a primeira hora permitida
-- depois de devida, e pelo menos `intervalo_min_horas` depois da última
-- enviada), e as etapas que já passaram sem caber no horário.
--   desligada · parada (motivo) · na_fila (a IA escrevendo) ·
--   aguardando (ainda não) · devida (agora) · acabou
create or replace function app.ia_retomada_plano(p_conversation_id uuid, p_agora timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := app.ia_retomada_config();
  v_dias   int[] := app.ia_retomada_dias(app.ia_retomada_config());
  v_n      int;
  v_de     interval := app.ia_retomada_horas(app.ia_retomada_config(), 'texto_de_horas', 20);
  v_ate    interval := app.ia_retomada_horas(app.ia_retomada_config(), 'texto_ate_horas', 23);
  v_interv interval := app.ia_retomada_horas(app.ia_retomada_config(), 'intervalo_min_horas', 48);
  c        public.conversations%rowtype;
  v_motivo text;
  v_ancora timestamptz;
  v_inicio timestamptz;
  v_feito  int;
  v_ultima timestamptz;
  q        public.ia_retomadas%rowtype;
  v_resp   boolean;
  v_pular  jsonb := '[]'::jsonb;
  k        int;
  v_dia    int;
  v_tipo   text;
  v_devida timestamptz;
  v_expira timestamptz;
  v_quando timestamptz;
  v_janela jsonb;
begin
  v_n := coalesce(cardinality(v_dias), 0);
  v_motivo := app.ia_retomada_impedimento(p_conversation_id, null);
  if v_motivo = 'retomada_desligada' then
    return jsonb_build_object('situacao', 'desligada');
  end if;
  if v_motivo is not null then
    return jsonb_build_object('situacao', 'parada', 'motivo', v_motivo);
  end if;

  select * into c from public.conversations where id = p_conversation_id;
  -- A âncora (a chave do silêncio) é a última mensagem do cliente; os dias contam
  -- a partir da resposta da IA a ela (`v_inicio`). A janela de 24 h, do cliente.
  v_ancora := c.last_inbound_at;
  v_inicio := app.ia_retomada_inicio(c.id);
  if v_inicio < coalesce((v_cfg ->> 'ligada_em')::timestamptz, '-infinity'::timestamptz) then
    return jsonb_build_object('situacao', 'parada', 'motivo', 'o_silencio_comecou_antes_de_ligar',
                              'ancora_em', v_ancora);
  end if;

  select * into q from public.ia_retomadas r
   where r.conversation_id = c.id and r.ancora_em = v_ancora and r.situacao = 'na_fila'
   limit 1;
  if found then
    return jsonb_build_object('situacao', 'na_fila', 'etapa', q.etapa, 'total', v_n, 'dias', q.dias,
                              'tipo', q.tipo, 'ancora_em', v_ancora, 'quando', q.criada_em,
                              'pular', '[]'::jsonb);
  end if;

  select coalesce(max(r.dias), 0), max(r.resolvida_em) filter (where r.situacao = 'enviada')
    into v_feito, v_ultima
    from public.ia_retomadas r where r.conversation_id = c.id and r.ancora_em = v_ancora;
  -- A janela de horário de todo envio proativo, com a mesma pergunta que a
  -- porteira faz (`app.pode_enviar`).
  v_resp := c.organization_id is not null and app.ja_respondeu(c.organization_id);

  for k in 1 .. v_n loop
    v_dia := v_dias[k];
    -- Mudar a lista não repete: dia igual ou menor que o maior já feito passou.
    continue when v_dia <= v_feito;
    v_tipo := case when v_dia = 1 then 'texto' else 'modelo' end;
    if v_tipo = 'texto' then
      v_devida := v_inicio + v_de;
      v_expira := v_ancora + least(v_ate, interval '23 hours 30 minutes');
    else
      v_devida := v_inicio + make_interval(days => v_dia);
      v_expira := case when k < v_n then v_inicio + make_interval(days => v_dias[k + 1])
                       else v_devida + interval '3 days' end;
    end if;
    if v_ultima is not null then
      v_devida := greatest(v_devida, v_ultima + v_interv);
    end if;
    v_quando := greatest(p_agora, v_devida);
    v_janela := app.janela_do_canal(c.channel, v_quando, v_resp);
    if not coalesce((v_janela ->> 'aberta')::boolean, false) then
      v_quando := (v_janela ->> 'abre_em')::timestamptz;
    end if;
    if v_quando is null or v_quando >= v_expira then
      -- Não cabe no horário antes de vencer. Quando já devia ter saído, a
      -- rodada registra o pulo; antes disso, o plano só passa à seguinte.
      if p_agora >= v_devida or v_devida >= v_expira then
        v_pular := v_pular || jsonb_build_array(jsonb_build_object(
                     'etapa', k, 'dias', v_dia, 'tipo', v_tipo,
                     'motivo', case when v_devida >= v_expira then 'intervalo_minimo_entre_etapas'
                                    when v_tipo = 'texto' then 'sem_horario_permitido_nas_24_horas'
                                    else 'passou_da_hora' end));
      end if;
      continue;
    end if;
    return jsonb_build_object(
      'situacao', case when v_quando <= p_agora then 'devida' else 'aguardando' end,
      'etapa', k, 'total', v_n, 'dias', v_dia, 'tipo', v_tipo, 'ancora_em', v_ancora,
      'devida_em', v_devida, 'expira_em', v_expira, 'quando', v_quando,
      'modelo', case when v_tipo = 'modelo' then v_cfg -> 'modelos' ->> v_dia::text end,
      'pular', v_pular);
  end loop;
  return jsonb_build_object('situacao', 'acabou', 'total', v_n, 'ancora_em', v_ancora, 'pular', v_pular);
end $$;
comment on function app.ia_retomada_plano(uuid, timestamptz) is
  'O plano da retomada numa conversa: desligada, parada (com o motivo), na_fila (a IA escrevendo), aguardando ou devida (a próxima etapa, o primeiro dia maior que o maior já feito, o tipo e quando pode sair: a primeira hora permitida depois de devida e do intervalo mínimo, antes de vencer) ou acabou; e as etapas que já passaram sem caber (pular).';
revoke all on function app.ia_retomada_plano(uuid, timestamptz) from public, anon, authenticated;


-- =====================================================================
-- 6. A rodada: o banco decide e grava
-- =====================================================================
create or replace function app.ia_retomada_pular(
  p_conversation_id uuid, p_ancora timestamptz, p_etapa int, p_dias int, p_tipo text, p_motivo text,
  p_template_id int default null, p_template_code text default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.ia_retomadas (conversation_id, ancora_em, etapa, dias, tipo, situacao, motivo,
                                   template_id, template_code, resolvida_em)
  values (p_conversation_id, p_ancora, p_etapa, p_dias, p_tipo, 'pulada', left(p_motivo, 300),
          p_template_id, left(p_template_code, 80), now())
  on conflict on constraint ia_retomadas_um_por_dia do nothing
$$;
revoke all on function app.ia_retomada_pular(uuid, timestamptz, int, int, text, text, int, text) from public, anon, authenticated;

-- Faz a etapa devida de uma conversa. Devolve se pôs algo a caminho.
create or replace function app.ia_retomada_agir(p_conversation_id uuid, p_plano jsonb, p_agora timestamptz default now())
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := app.ia_retomada_config();
  v_etapa  int := (p_plano ->> 'etapa')::int;
  v_dia    int := (p_plano ->> 'dias')::int;
  v_tipo   text := p_plano ->> 'tipo';
  v_ancora timestamptz := (p_plano ->> 'ancora_em')::timestamptz;
  v_id     uuid;
  v_freio  jsonb;
  v_codigo text;
  t        public.message_templates%rowtype;
  v_meta   jsonb;
  v_var    text;
  v_valor  text;
  v_params jsonb := '{}'::jsonb;
  v_falta  text;
  v_corpo  text;
  v_pode   jsonb;
  v_msg    uuid;
  v_motivo text;
  l        public.ia_retomada_leituras%rowtype;
begin
  if p_plano ->> 'situacao' is distinct from 'devida' then
    return false;
  end if;
  perform 1 from public.conversations where id = p_conversation_id for update;
  -- De novo, com a conversa travada: entre o plano e aqui o cliente pode ter escrito.
  if app.ia_retomada_impedimento(p_conversation_id, v_ancora) is not null then
    return false;
  end if;

  -- ---------------------------------------------------- dia 1: texto da IA
  if v_tipo = 'texto' then
    v_freio := app.ia_pode_gastar('draft_reply');
    if not coalesce((v_freio ->> 'pode')::boolean, false) then
      perform app.ia_retomada_pular(p_conversation_id, v_ancora, v_etapa, v_dia, v_tipo, 'orcamento_de_ia_no_limite');
      return false;
    end if;
    insert into public.ia_retomadas (conversation_id, ancora_em, etapa, dias, tipo, situacao)
    values (p_conversation_id, v_ancora, v_etapa, v_dia, 'texto', 'na_fila')
    on conflict on constraint ia_retomadas_um_por_dia do nothing
    returning id into v_id;
    if v_id is null then
      return false;
    end if;
    perform app.esteira_enfileirar('ai_jobs',
              jsonb_build_object('purpose', 'retomar_conversa',
                                 'retomada_id', v_id,
                                 'conversation_id', p_conversation_id,
                                 'chave', 'retomar_conversa:' || v_id::text),
              'retomar_conversa:' || v_id::text);
    return true;
  end if;

  -- ---------------------------------------- dias 2 em diante: modelo da Meta
  v_codigo := nullif(btrim(coalesce(v_cfg -> 'modelos' ->> v_dia::text, '')), '');
  if v_codigo is null then
    perform app.ia_retomada_pular(p_conversation_id, v_ancora, v_etapa, v_dia, v_tipo, 'sem_modelo_escolhido');
    return false;
  end if;
  select * into t from public.message_templates m
   where m.template_code = v_codigo and m.is_active and m.channel = 'whatsapp'::app.channel;
  if not found then
    perform app.ia_retomada_pular(p_conversation_id, v_ancora, v_etapa, v_dia, v_tipo,
                                  'modelo_inexistente_ou_desligado', null, v_codigo);
    return false;
  end if;
  v_meta := app.wa_modelo_da_meta(t.id);
  if not coalesce((v_meta ->> 'aprovado')::boolean, false) then
    perform app.ia_retomada_pular(p_conversation_id, v_ancora, v_etapa, v_dia, v_tipo,
                                  'modelo_nao_aprovado_na_meta (' || coalesce(v_meta ->> 'situacao', '?') || ')',
                                  t.id, t.template_code);
    return false;
  end if;

  foreach v_var in array app.modelo_variaveis(t.body) loop
    v_valor := case v_var
                 when 'nome' then coalesce(app.ia_retomada_primeiro_nome(p_conversation_id), 'tudo bem')
                 when 'imovel' then coalesce(app.ia_retomada_imovel(p_conversation_id) ->> 'frase',
                                             'que você estava vendo')
                 when 'saudacao' then app.saudacao_do_momento(p_agora)
               end;
    v_valor := app.modelo_parametro_limpo(v_valor);
    if v_valor is null then
      v_falta := v_var;
      exit;
    end if;
    v_params := v_params || jsonb_build_object(v_var, left(v_valor, app.modelo_teto_da_variavel(v_var)));
  end loop;
  if v_falta is not null then
    perform app.ia_retomada_pular(p_conversation_id, v_ancora, v_etapa, v_dia, v_tipo,
                                  'variavel_que_a_retomada_nao_preenche: ' || v_falta, t.id, t.template_code);
    return false;
  end if;
  v_corpo := app.modelo_renderizar(t.body, v_params);

  -- A pergunta da porteira, antes: o que é "agora não" (horário, teto do
  -- número) espera a próxima rodada; o que é "nunca" fica registrado.
  v_pode := app.pode_enviar(p_conversation_id, false, true, now());
  if not coalesce((v_pode ->> 'pode')::boolean, false) then
    if app.envio_motivo_de_espera(coalesce(v_pode ->> 'motivo', '')) then
      return false;
    end if;
    perform app.ia_retomada_pular(p_conversation_id, v_ancora, v_etapa, v_dia, v_tipo,
                                  coalesce(v_pode ->> 'motivo', 'porteira'), t.id, t.template_code);
    return false;
  end if;

  -- NENHUM MODELO SEM A IA TER LIDO A CONVERSA. Sem o texto do dia 1 nem uma
  -- leitura que diga "segue", a IA lê antes; enquanto lê, o modelo espera; se
  -- a leitura falhou, o modelo deste dia não sai (falha fechada).
  if app.ia_retomada_lida(p_conversation_id, v_ancora) is null then
    select * into l from public.ia_retomada_leituras x
     where x.conversation_id = p_conversation_id and x.ancora_em = v_ancora and x.dias = v_dia;
    if not found then
      v_freio := app.ia_pode_gastar('draft_reply');
      if not coalesce((v_freio ->> 'pode')::boolean, false) then
        perform app.ia_retomada_pular(p_conversation_id, v_ancora, v_etapa, v_dia, v_tipo,
                                      'sem_leitura_da_ia: orçamento de IA no limite', t.id, t.template_code);
        return false;
      end if;
      insert into public.ia_retomada_leituras (conversation_id, ancora_em, dias, situacao)
      values (p_conversation_id, v_ancora, v_dia, 'na_fila')
      on conflict on constraint ia_retomada_leituras_uma_por_dia do nothing
      returning id into v_id;
      if v_id is null then
        return false;
      end if;
      perform app.esteira_enfileirar('ai_jobs',
                jsonb_build_object('purpose', 'retomar_conversa',
                                   'leitura_id', v_id,
                                   'conversation_id', p_conversation_id,
                                   'chave', 'retomar_leitura:' || v_id::text),
                'retomar_leitura:' || v_id::text);
      return true;
    end if;
    if l.situacao = 'na_fila' then
      return false;
    end if;
    perform app.ia_retomada_pular(p_conversation_id, v_ancora, v_etapa, v_dia, v_tipo,
                                  'sem_leitura_da_ia' || coalesce(': ' || l.motivo, ''), t.id, t.template_code);
    return false;
  end if;

  begin
    insert into public.ia_retomadas (conversation_id, ancora_em, etapa, dias, tipo, situacao,
                                     template_id, template_code, resolvida_em)
    values (p_conversation_id, v_ancora, v_etapa, v_dia, 'modelo', 'enviada', t.id, t.template_code, now())
    on conflict on constraint ia_retomadas_um_por_dia do nothing
    returning id into v_id;
    if v_id is null then
      return false;
    end if;
    -- `messages_guard` confere de novo supressão, horário, tetos e o teto de
    -- fala do robô; recusa com exceção, que desfaz a linha de cima.
    insert into public.messages (conversation_id, direction, type, status, body,
                                 template_id, template_params, author_kind, origin)
    values (p_conversation_id, 'out'::app.msg_direction, 'template'::app.msg_type, 'queued'::app.msg_status,
            v_corpo, t.id, v_params, 'bot_fixed', 'crm')
    returning id into v_msg;
    update public.ia_retomadas set message_id = v_msg where id = v_id;
  exception when others then
    v_motivo := substring(sqlerrm from 'Envio recusado: ([a-z_]+)');
    if v_motivo is not null and app.envio_motivo_de_espera(v_motivo) then
      return false;
    end if;
    perform app.ia_retomada_pular(p_conversation_id, v_ancora, v_etapa, v_dia, v_tipo,
                                  'porteira: ' || left(sqlerrm, 250), t.id, t.template_code);
    return false;
  end;
  return true;
end $$;
comment on function app.ia_retomada_agir(uuid, jsonb, timestamptz) is
  'Faz a etapa devida da retomada: dia 1, põe a IA para escrever (fila ai_jobs, retomar_conversa, com o freio do orçamento); dias seguintes, manda o modelo escolhido se a Meta aprovou, com {{nome}}, {{imovel}} e {{saudacao}} preenchidos pelo banco, e só depois de a IA ter lido o silêncio (o texto do dia 1 ou uma leitura que diz "segue"; sem ela, pede a leitura; leitura que falhou = sem_leitura_da_ia). O que não pode sair fica em ia_retomadas com o motivo; horário e teto do número esperam a próxima rodada.';
revoke all on function app.ia_retomada_agir(uuid, jsonb, timestamptz) from public, anon, authenticated;

-- A rodada, a cada 5 minutos (cron ia_retomadas_rodar).
create or replace function app.ia_retomadas_rodar(p_agora timestamptz default now())
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := app.ia_retomada_config();
  v_dias   int[] := app.ia_retomada_dias(app.ia_retomada_config());
  v_limite int := least(greatest(coalesce((app.ia_retomada_config() ->> 'por_rodada')::int, 30), 1), 200);
  v_min    interval;
  v_max    interval;
  v_n      int := 0;
  x        record;
  p        jsonb;
  v_plano  jsonb;
begin
  if not coalesce((v_cfg ->> 'ligada')::boolean, false) or cardinality(v_dias) = 0 then
    return 0;
  end if;
  if not coalesce((app.ia_atendente_config() ->> 'ligada')::boolean, false) then
    return 0;
  end if;
  -- Uma rodada por vez: duas rodadas juntas não mandam a mesma etapa (a
  -- restrição única também não deixaria), nem gastam a mesma consulta.
  if not pg_try_advisory_xact_lock(hashtext('app.ia_retomadas_rodar')) then
    return 0;
  end if;

  -- O texto que a IA não escreveu a tempo (worker parado, erro) não fica na
  -- fila para sempre: a janela de 24 h não espera.
  update public.ia_retomadas r
     set situacao = 'pulada', motivo = 'a_ia_nao_escreveu_a_tempo', resolvida_em = now()
   where r.situacao = 'na_fila'
     and (r.criada_em < p_agora - interval '2 hours'
          or r.ancora_em + app.ia_retomada_horas(v_cfg, 'texto_ate_horas', 23) < p_agora);
  -- A leitura que não voltou em 2 h falhou: o modelo daquele dia não sai.
  update public.ia_retomada_leituras l
     set situacao = 'falhou', motivo = 'a_ia_nao_leu_a_tempo', resolvida_em = now()
   where l.situacao = 'na_fila' and l.criada_em < p_agora - interval '2 hours';

  v_min := case when v_dias[1] = 1 then app.ia_retomada_horas(v_cfg, 'texto_de_horas', 20)
                else make_interval(days => v_dias[1]) end;
  v_max := make_interval(days => v_dias[cardinality(v_dias)] + 4)
           + app.ia_retomada_horas(v_cfg, 'intervalo_min_horas', 48);

  for x in
    select c.id
      from public.conversations c
     where c.channel = 'whatsapp'::app.channel
       and c.bloqueada_em is null
       and c.arquivada_em is null
       and not c.bot_paused
       and c.last_inbound_at is not null
       and c.last_inbound_at <= p_agora - v_min
       and c.last_inbound_at > p_agora - v_max
       and app.ia_atende(c.id)
       and app.ia_retomada_inicio(c.id) is not null
     order by c.last_inbound_at
  loop
    exit when v_n >= v_limite;
    v_plano := app.ia_retomada_plano(x.id, p_agora);
    for p in select * from jsonb_array_elements(coalesce(v_plano -> 'pular', '[]'::jsonb)) loop
      perform app.ia_retomada_pular(x.id, (v_plano ->> 'ancora_em')::timestamptz, (p ->> 'etapa')::int,
                                    (p ->> 'dias')::int, p ->> 'tipo', p ->> 'motivo');
    end loop;
    if v_plano ->> 'situacao' = 'devida' and app.ia_retomada_agir(x.id, v_plano, p_agora) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
comment on function app.ia_retomadas_rodar(timestamptz) is
  'A rodada da retomada (Imova, 11/11/2026), a cada 5 minutos: conversas em que a IA atende e a Imova falou por último, com o silêncio começado depois de ligar; registra as etapas que passaram sem caber no horário e faz a devida (texto da IA, leitura da IA ou modelo aprovado). Desligada (ia.retomada ou ia.atendente), não faz nada.';
revoke all on function app.ia_retomadas_rodar(timestamptz) from public, anon, authenticated;


-- =====================================================================
-- 7. As portas do worker: ler, dizer, desistir e a leitura antes do modelo
-- =====================================================================
-- O que a IA lê para escrever o texto do dia 1: a mesma conversa da IA que
-- atende, mais o imóvel e há quanto tempo o cliente não responde.
create or replace function public.ia_retomada_entrada(p_retomada_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r        public.ia_retomadas%rowtype;
  v_motivo text;
begin
  select * into r from public.ia_retomadas where id = p_retomada_id;
  if not found then
    return jsonb_build_object('existe', false);
  end if;
  if r.situacao <> 'na_fila' then
    return jsonb_build_object('existe', true, 'pode', false, 'motivo', 'ja_resolvida');
  end if;
  v_motivo := app.ia_retomada_impedimento(r.conversation_id, r.ancora_em);
  return public.ia_entrada_do_atendente(r.conversation_id)
      || jsonb_build_object(
           'retomada_id', r.id,
           'etapa', r.etapa,
           'dias', r.dias,
           'pode', v_motivo is null,
           'motivo', v_motivo,
           'horas_sem_resposta', greatest(floor(extract(epoch from now() - r.ancora_em) / 3600)::int, 1),
           'imovel', app.ia_retomada_imovel(r.conversation_id));
end $$;
comment on function public.ia_retomada_entrada(uuid) is
  'Porta do worker de IA: o que a IA lê para escrever o texto da retomada (a conversa da IA que atende, o imóvel de que falavam e as horas sem resposta), e se ainda pode.';
revoke all on function public.ia_retomada_entrada(uuid) from public, anon, authenticated;
grant execute on function public.ia_retomada_entrada(uuid) to service_role;

-- O único caminho do texto da retomada até `messages`: confere tudo de novo
-- com a conversa travada, grava a prova em `ia_respostas` (ação retomou) e a
-- mensagem assinada, em fila, na mesma transação.
create or replace function public.ia_retomada_dizer(
  p_retomada_id uuid, p_texto text, p_detalhes jsonb default '{}'::jsonb,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r        public.ia_retomadas%rowtype;
  c        public.conversations%rowtype;
  v_assin  text := nullif(btrim(coalesce(app.ia_atendente_config() ->> 'assinatura', '')), '');
  v_texto  text := btrim(coalesce(p_texto, ''));
  v_motivo text;
  v_janela jsonb;
  v_corpo  text;
  v_resp   uuid;
  v_msg    uuid;
begin
  select * into r from public.ia_retomadas where id = p_retomada_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'retomada_inexistente');
  end if;
  if r.situacao <> 'na_fila' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_resolvida');
  end if;
  select * into c from public.conversations where id = r.conversation_id for update;

  v_motivo := app.ia_retomada_impedimento(r.conversation_id, r.ancora_em);
  if v_motivo is null and v_texto = '' then
    v_motivo := 'texto_vazio';
  end if;
  if v_motivo is null and char_length(v_texto) > 600 then
    v_motivo := 'texto_longo_demais';
  end if;
  if v_motivo is null and not app.janela_de_24h_aberta(c.id, now()) then
    v_motivo := 'a_janela_de_24_horas_fechou';
  end if;
  if v_motivo is null then
    v_janela := app.janela_do_canal(c.channel, now(),
                                    c.organization_id is not null and app.ja_respondeu(c.organization_id));
    if not coalesce((v_janela ->> 'aberta')::boolean, false) then
      v_motivo := 'fora_do_horario_permitido';
    end if;
  end if;
  if v_motivo is not null then
    update public.ia_retomadas
       set situacao = 'pulada', motivo = v_motivo, ai_run_id = p_ai_run_id,
           prompt_version = left(p_prompt_version, 80), resolvida_em = now()
     where id = r.id;
    return jsonb_build_object('ok', false, 'motivo', v_motivo);
  end if;

  v_corpo := case when v_assin is null then v_texto else '*' || v_assin || ':*' || E'\n' || v_texto end;
  begin
    insert into public.ia_respostas (conversation_id, em_resposta_a, corpo, acao, detalhes, ai_run_id, prompt_version)
    values (c.id, null, v_corpo, 'retomou',
            coalesce(p_detalhes, '{}'::jsonb)
              || jsonb_build_object('retomada_id', r.id, 'etapa', r.etapa, 'dias', r.dias),
            p_ai_run_id, p_prompt_version)
    returning id into v_resp;

    insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
    values (c.id, 'out'::app.msg_direction, 'text'::app.msg_type, 'queued'::app.msg_status,
            v_corpo, 'bot_ai', 'crm')
    returning id into v_msg;

    update public.ia_respostas set message_id = v_msg where id = v_resp;
    update public.ia_retomadas
       set situacao = 'enviada', message_id = v_msg, ia_resposta_id = v_resp, ai_run_id = p_ai_run_id,
           prompt_version = left(p_prompt_version, 80), resolvida_em = now()
     where id = r.id;
  exception when others then
    -- A porteira recusou: nada sai, e fica o porquê.
    update public.ia_retomadas
       set situacao = 'pulada', motivo = left('porteira: ' || sqlerrm, 300), ai_run_id = p_ai_run_id,
           prompt_version = left(p_prompt_version, 80), resolvida_em = now()
     where id = r.id;
    return jsonb_build_object('ok', false, 'motivo', 'porteira', 'erro', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'message_id', v_msg, 'resposta_id', v_resp);
end $$;
comment on function public.ia_retomada_dizer(uuid, text, jsonb, bigint, text) is
  'Porta do worker de IA: o texto da retomada vira mensagem. Confere de novo (o cliente não respondeu, a IA atende, sem supressão nem visita, janela de 24 h aberta, horário permitido), grava a prova em ia_respostas (acao retomou) e a mensagem bot_ai assinada, em fila, que a porteira deixa sair pelo ramo (2a).';
revoke all on function public.ia_retomada_dizer(uuid, text, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_retomada_dizer(uuid, text, jsonb, bigint, text) to service_role;

-- A IA leu e decidiu não retomar (ou não conseguiu escrever). Com `p_encerra`,
-- as etapas seguintes deste silêncio também não saem.
create or replace function public.ia_retomada_desistir(
  p_retomada_id uuid, p_motivo text, p_encerra boolean default false,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.ia_retomadas
     set situacao = 'pulada',
         motivo = left(coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'a_ia_nao_retomou'), 300),
         encerra = coalesce(p_encerra, false),
         ai_run_id = p_ai_run_id, prompt_version = left(p_prompt_version, 80), resolvida_em = now()
   where id = p_retomada_id and situacao = 'na_fila';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ja_resolvida');
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ia_retomada_desistir(uuid, text, boolean, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_retomada_desistir(uuid, text, boolean, bigint, text) to service_role;

-- A leitura antes do modelo: o que a IA lê (a mesma entrada do dia 1).
create or replace function public.ia_retomada_leitura_entrada(p_leitura_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l        public.ia_retomada_leituras%rowtype;
  v_motivo text;
begin
  select * into l from public.ia_retomada_leituras where id = p_leitura_id;
  if not found then
    return jsonb_build_object('existe', false);
  end if;
  if l.situacao <> 'na_fila' then
    return jsonb_build_object('existe', true, 'pode', false, 'motivo', 'ja_resolvida');
  end if;
  v_motivo := app.ia_retomada_impedimento(l.conversation_id, l.ancora_em);
  return public.ia_entrada_do_atendente(l.conversation_id)
      || jsonb_build_object(
           'leitura_id', l.id,
           'dias', l.dias,
           'pode', v_motivo is null,
           'motivo', v_motivo,
           'horas_sem_resposta', greatest(floor(extract(epoch from now() - l.ancora_em) / 3600)::int, 1),
           'imovel', app.ia_retomada_imovel(l.conversation_id));
end $$;
comment on function public.ia_retomada_leitura_entrada(uuid) is
  'Porta do worker de IA: a conversa que a IA lê antes do primeiro modelo da retomada num silêncio que ela não leu, para decidir se segue.';
revoke all on function public.ia_retomada_leitura_entrada(uuid) from public, anon, authenticated;
grant execute on function public.ia_retomada_leitura_entrada(uuid) to service_role;

-- A decisão: segue (o modelo pode sair), encerra (o silêncio acaba) ou falhou
-- (o modelo daquele dia não sai: sem_leitura_da_ia).
create or replace function public.ia_retomada_leitura_gravar(
  p_leitura_id uuid, p_decisao text, p_motivo text default null,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_decisao is null or p_decisao not in ('segue', 'encerra', 'falhou') then
    return jsonb_build_object('ok', false, 'motivo', 'decisao_invalida');
  end if;
  update public.ia_retomada_leituras
     set situacao = p_decisao,
         motivo = left(nullif(btrim(coalesce(p_motivo, '')), ''), 300),
         ai_run_id = p_ai_run_id, prompt_version = left(p_prompt_version, 80), resolvida_em = now()
   where id = p_leitura_id and situacao = 'na_fila';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ja_resolvida');
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ia_retomada_leitura_gravar(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_retomada_leitura_gravar(uuid, text, text, bigint, text) to service_role;


-- =====================================================================
-- 8. As portas da tela
-- =====================================================================
create or replace function public.ia_retomada_configurar(p_valores jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_atual  jsonb;
  v_novo   jsonb;
  v_chave  text;
  v_valor  jsonb;
  v_x      jsonb;
  v_ant    int := 0;
  v_k      text;
  v_v      jsonb;
  v_mods   jsonb;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select s.value into v_atual from public.app_settings s where s.key = 'ia.retomada' for update;
  v_atual := coalesce(v_atual, '{}'::jsonb);
  v_novo := v_atual;

  for v_chave, v_valor in select * from jsonb_each(coalesce(p_valores, '{}'::jsonb)) loop
    case v_chave
      when 'ligada' then
        if jsonb_typeof(v_valor) <> 'boolean' then
          return jsonb_build_object('ok', false, 'motivo', 'ligada_nao_e_sim_ou_nao');
        end if;
        -- Ligar marca o começo: só silêncios que começarem daqui em diante.
        if (v_valor)::text::boolean and not coalesce((v_atual ->> 'ligada')::boolean, false) then
          v_novo := v_novo || jsonb_build_object('ligada_em', now());
        end if;
      when 'dias' then
        if jsonb_typeof(v_valor) <> 'array' or jsonb_array_length(v_valor) not between 1 and 5 then
          return jsonb_build_object('ok', false, 'motivo', 'dias_invalidos');
        end if;
        v_ant := 0;
        for v_x in select * from jsonb_array_elements(v_valor) loop
          if jsonb_typeof(v_x) <> 'number' or (v_x)::text !~ '^\d{1,2}$'
             or (v_x)::text::int not between 1 and 30 or (v_x)::text::int <= v_ant then
            return jsonb_build_object('ok', false, 'motivo', 'dias_invalidos');
          end if;
          v_ant := (v_x)::text::int;
        end loop;
      when 'modelos' then
        if jsonb_typeof(v_valor) <> 'object' then
          return jsonb_build_object('ok', false, 'motivo', 'modelos_invalidos');
        end if;
        v_mods := '{}'::jsonb;
        for v_k, v_v in select * from jsonb_each(v_valor) loop
          if v_k !~ '^\d{1,2}$' or v_k::int not between 2 and 30
             or jsonb_typeof(v_v) not in ('string', 'null') then
            return jsonb_build_object('ok', false, 'motivo', 'modelos_invalidos');
          end if;
          if jsonb_typeof(v_v) = 'string' and btrim(v_v #>> '{}') <> '' then
            if not exists (select 1 from public.message_templates m
                            where m.template_code = btrim(v_v #>> '{}')
                              and m.channel = 'whatsapp'::app.channel) then
              return jsonb_build_object('ok', false, 'motivo', 'modelo_inexistente', 'dias', v_k);
            end if;
            v_mods := v_mods || jsonb_build_object(v_k, btrim(v_v #>> '{}'));
          end if;
        end loop;
        v_valor := v_mods;
      when 'texto_de_horas', 'texto_ate_horas' then
        if jsonb_typeof(v_valor) <> 'number' or (v_valor)::text::numeric not between 12 and 23.5 then
          return jsonb_build_object('ok', false, 'motivo', 'horas_invalidas');
        end if;
      when 'intervalo_min_horas' then
        if jsonb_typeof(v_valor) <> 'number' or (v_valor)::text !~ '^\d{1,3}$'
           or (v_valor)::text::int not between 24 and 240 then
          return jsonb_build_object('ok', false, 'motivo', 'intervalo_fora_do_limite');
        end if;
      when 'por_rodada' then
        if jsonb_typeof(v_valor) <> 'number' or (v_valor)::text !~ '^\d{1,3}$'
           or (v_valor)::text::int not between 1 and 200 then
          return jsonb_build_object('ok', false, 'motivo', 'por_rodada_fora_do_limite');
        end if;
      else
        return jsonb_build_object('ok', false, 'motivo', 'chave_desconhecida', 'chave', v_chave);
    end case;
    v_novo := v_novo || jsonb_build_object(v_chave, v_valor);
  end loop;

  if coalesce((v_novo ->> 'texto_de_horas')::numeric, 20) >= coalesce((v_novo ->> 'texto_ate_horas')::numeric, 23) then
    return jsonb_build_object('ok', false, 'motivo', 'horas_invalidas');
  end if;

  insert into public.app_settings (key, value, description)
  values ('ia.retomada', v_novo,
          'A IA que atende retoma o contato com o cliente que parou de responder (Imova, 11/11/2026). ligada: a chave (desligada por padrão); ligada_em: só silêncios que começaram depois. dias: as etapas, em dias sem resposta (1 = texto da IA dentro da janela de 24 h, entre texto_de_horas e texto_ate_horas depois da última mensagem do cliente; os outros, modelo aprovado pela Meta). modelos: {"<dias>": "<template_code>"}. intervalo_min_horas: o mínimo entre duas etapas enviadas (padrão 48). por_rodada: quantas retomadas a rodada de 5 minutos manda, no máximo. Mudada pela tela (public.ia_retomada_configurar).')
  on conflict (key) do update set value = excluded.value, description = excluded.description;
  return jsonb_build_object('ok', true, 'config', app.ia_retomada_config());
end $$;
comment on function public.ia_retomada_configurar(jsonb) is
  'A tela da IA que atende (Imova, 11/11/2026): liga e desliga a retomada, os dias, o modelo de cada dia (2 em diante) e o intervalo mínimo entre etapas. Só admin e gestor.';
revoke all on function public.ia_retomada_configurar(jsonb) from public, anon;
grant execute on function public.ia_retomada_configurar(jsonb) to authenticated;

-- Responderam depois da retomada: escreveram (reação não conta) e não pediram
-- para sair. Quem pediu para sair conta à parte.
create or replace function app.ia_retomada_respondeu_depois(p_conversation_id uuid, p_desde timestamptz,
                                                            p_ate timestamptz default 'infinity')
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when not exists (select 1 from public.messages i
                             where i.conversation_id = p_conversation_id
                               and i.direction = 'in'::app.msg_direction
                               and i.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
                               and i.created_at > p_desde and i.created_at < p_ate) then null
           when app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164) is not null then 'saiu'
           else 'respondeu'
         end
    from public.conversations c where c.id = p_conversation_id
$$;
revoke all on function app.ia_retomada_respondeu_depois(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.ia_retomada_painel(p_dias int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_desde timestamptz := now() - make_interval(days => greatest(least(coalesce(p_dias, 7), 90), 1));
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('existe', false);
  end if;
  return jsonb_build_object(
    'existe', true,
    'config', app.ia_retomada_config(),
    'pode_configurar', app.admin_ou_gestor(),
    -- Os modelos que podem ser escolhidos: os do WhatsApp que vão à Meta, ligados
    -- no CRM (e os já escolhidos, mesmo desligados, para a tela dizer por quê).
    'modelos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'codigo', m.template_code,
               'nome', m.name,
               'categoria', m.category,
               'ativo', m.is_active,
               'nome_na_meta', m.meta_template_name,
               'situacao', coalesce(m.meta_status, 'nao_enviado'),
               'aprovado', coalesce((app.wa_modelo_da_meta(m.id) ->> 'aprovado')::boolean, false),
               'variaveis', to_jsonb(app.modelo_variaveis(m.body)),
               'preenche', app.modelo_variaveis(m.body) <@ array['nome', 'imovel', 'saudacao'],
               'corpo', m.body)
             order by m.template_code), '[]'::jsonb)
        from public.message_templates m
       where m.channel = 'whatsapp'::app.channel
         and m.category in ('marketing', 'utility')
         and m.template_code not like 'GEN-SYS-%'
         and (m.is_active
              or m.template_code in (select x.value #>> '{}'
                                       from jsonb_each(app.ia_retomada_config() -> 'modelos') x))),
    'placar', (
      select jsonb_build_object(
               'enviadas', count(*) filter (where e.saiu),
               'por_texto', count(*) filter (where e.saiu and e.tipo = 'texto'),
               'por_modelo', count(*) filter (where e.saiu and e.tipo = 'modelo'),
               'falharam', count(*) filter (where e.situacao = 'enviada' and not e.saiu),
               'puladas', count(*) filter (where e.situacao = 'pulada'),
               'encerradas_pela_ia', count(*) filter (where e.situacao = 'pulada' and e.encerra)
                                     + (select count(*) from public.ia_retomada_leituras l
                                         where l.situacao = 'encerra' and l.resolvida_em >= v_desde),
               'sem_modelo', count(*) filter (where e.situacao = 'pulada'
                                                and (e.motivo like 'sem_modelo%' or e.motivo like 'modelo_%')),
               'sem_leitura', count(*) filter (where e.situacao = 'pulada' and e.motivo like 'sem_leitura_da_ia%'),
               'na_fila', count(*) filter (where e.situacao = 'na_fila'),
               'clientes', count(distinct e.conversation_id) filter (where e.saiu),
               'responderam', count(distinct e.conversation_id) filter (where e.saiu and e.depois = 'respondeu'),
               'pediram_para_sair', count(distinct e.conversation_id) filter (where e.saiu and e.depois = 'saiu'))
        from (select r.*, (r.situacao = 'enviada' and coalesce(m.status::text, '') <> 'failed') as saiu,
                     app.ia_retomada_respondeu_depois(r.conversation_id,
                                                      coalesce(m.sent_at, m.created_at, r.resolvida_em)) as depois
                from public.ia_retomadas r
                left join public.messages m on m.id = r.message_id
               where coalesce(r.resolvida_em, r.criada_em) >= v_desde) e),
    'motivos', (
      select coalesce(jsonb_agg(jsonb_build_object('motivo', x.motivo, 'n', x.n) order by x.n desc, x.motivo), '[]'::jsonb)
        from (select split_part(r.motivo, ':', 1) as motivo, count(*)::int as n
                from public.ia_retomadas r
               where r.situacao = 'pulada' and r.resolvida_em >= v_desde
               group by 1 order by 2 desc limit 6) x),
    'custo_usd', (select coalesce(round(sum(a.cost_usd)::numeric, 4), 0)
                    from public.ai_runs a
                   where a.prompt_version like 'retomar-conversa@%' and a.created_at >= v_desde));
end $$;
comment on function public.ia_retomada_painel(int) is
  'A tela da IA que atende (Imova, 11/11/2026): a configuração da retomada, os modelos que podem ser escolhidos (com a situação na Meta) e o placar do período: retomadas que saíram (texto da IA e modelo), quantos clientes responderam depois (sem contar reação nem quem pediu para sair, que conta à parte), as puladas e por quê, e o custo.';
revoke all on function public.ia_retomada_painel(int) from public, anon;
grant execute on function public.ia_retomada_painel(int) to authenticated;

-- As retomadas no funil "Do atendimento à visita" da tela da IA (a medição das
-- visitas, 20261111210000, cria esta função devolvendo null e mostra os dois
-- passos quando deixam de ser nulos). Em clientes (conversas), no período
-- [p_de, p_fim), sem a conversa do treino e as de teste; null com a retomada
-- desligada e nenhuma no período. Responder não conta reação nem opt-out.
create or replace function app.ia_funil_retomadas(p_de timestamptz, p_fim timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with retomados as (
    select r.conversation_id, min(coalesce(m.sent_at, m.created_at, r.resolvida_em)) as primeira
      from public.ia_retomadas r
      left join public.messages m on m.id = r.message_id
     where r.situacao = 'enviada'
       and coalesce(m.status::text, '') <> 'failed'
       and r.resolvida_em >= p_de and r.resolvida_em < p_fim
       and r.conversation_id is distinct from app.ia_conversa_de_treino()
       and not app.ia_conversa_de_teste(r.conversation_id)
     group by r.conversation_id
  )
  select case
           when count(*) = 0 and not coalesce((app.ia_retomada_config() ->> 'ligada')::boolean, false) then null
           else jsonb_build_object(
                  'retomadas', count(*),
                  'responderam_depois_da_retomada', count(*) filter (
                     where app.ia_retomada_respondeu_depois(x.conversation_id, x.primeira, p_fim) = 'respondeu'))
         end
    from retomados x
$$;
comment on function app.ia_funil_retomadas(timestamptz, timestamptz) is
  'As retomadas no funil da IA que atende (Imova, 11/11/2026): quantos clientes receberam retomada (texto da IA ou modelo, que não falhou) no período [p_de, p_fim) e quantos deles escreveram depois da primeira (sem reação e sem opt-out), sem a conversa do treino e as de teste. null com a retomada desligada e nenhuma no período.';
revoke all on function app.ia_funil_retomadas(timestamptz, timestamptz) from public, anon;

-- O selo na conversa: quando é a próxima retomada. `modelo_pronto` diz se a
-- próxima, sendo modelo, tem modelo escolhido e aprovado (sem ele, não há
-- retomada a caminho, e o selo some).
create or replace function public.ia_retomada_da_conversa(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plano  jsonb;
  v_pronto boolean;
  u        public.ia_retomadas%rowtype;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('existe', false);
  end if;
  v_plano := app.ia_retomada_plano(p_conversation_id, now());
  if v_plano ->> 'tipo' = 'modelo' then
    v_pronto := exists (select 1 from public.message_templates m
                         where m.template_code = v_plano ->> 'modelo'
                           and m.is_active and m.channel = 'whatsapp'::app.channel
                           and coalesce((app.wa_modelo_da_meta(m.id) ->> 'aprovado')::boolean, false));
  end if;
  select * into u from public.ia_retomadas r
   where r.conversation_id = p_conversation_id
   order by coalesce(r.resolvida_em, r.criada_em) desc
   limit 1;
  return jsonb_build_object('existe', true) || (v_plano - 'pular')
      || jsonb_build_object('modelo_pronto', v_pronto)
      || jsonb_build_object('ultima', case when u.id is null then null else jsonb_build_object(
           'etapa', u.etapa, 'dias', u.dias, 'tipo', u.tipo, 'situacao', u.situacao,
           'motivo', u.motivo, 'em', coalesce(u.resolvida_em, u.criada_em)) end);
end $$;
comment on function public.ia_retomada_da_conversa(uuid) is
  'O selo da conversa (Imova, 11/11/2026): o plano da retomada (quando sai a próxima, de que tipo, se o modelo está pronto, ou por que parou) e a última etapa registrada.';
revoke all on function public.ia_retomada_da_conversa(uuid) from public, anon;
grant execute on function public.ia_retomada_da_conversa(uuid) to authenticated;

  $ddl$;

  -- -------------------------------------------------------------------
  -- 9. `retomou` fora das contas da IA que atende. Cada função é trocada a
  --    partir da que está no banco, só no trecho indicado; trecho que não
  --    aparece o número de vezes esperado aborta a migração. Já trocada (a
  --    migração rodou de novo): pula.
  -- -------------------------------------------------------------------
  for t in
    select * from (values
      -- O relatório da IA (20261109200000): as respostas do período, e as do
      -- treino (`totais.no_treino`), que o relatório conta direto.
      ('app.relatorio_imova_ia_respostas(timestamptz,timestamptz)',
       'where q.message_id is not null',
       'where q.message_id is not null and q.acao <> ''retomou''', 1),
      ('public.relatorio_imova_ia(date,date)',
       'where q.message_id is not null and q.conversation_id = v_treino',
       'where q.message_id is not null and q.acao <> ''retomou'' and q.conversation_id = v_treino', 1),
      -- A juíza (20261109200000): a fila do dia, a entrada e a gravação
      -- (20261109210000) contam só o atendimento.
      ('app.ia_juiza_enfileirar()',
       'where q.message_id is not null',
       'where q.message_id is not null and q.acao <> ''retomou''', 1),
      ('public.ia_juiza_entrada(uuid,date)',
       'q.conversation_id = p_conversation_id',
       'q.conversation_id = p_conversation_id and q.acao <> ''retomou''', 3),
      ('public.ia_juiza_gravar(uuid,date,jsonb,bigint,text)',
       'q.conversation_id = p_conversation_id',
       'q.conversation_id = p_conversation_id and q.acao <> ''retomou''', 1),
      -- O relatório que vende (20261109210000): o funil, as semanas e o painel da IA.
      ('public.relatorio_imova_painel_funil(date,date)',
       'where q.message_id is not null and q.criada_em >= v_de and q.criada_em < v_fim',
       'where q.message_id is not null and q.acao <> ''retomou'' and q.criada_em >= v_de and q.criada_em < v_fim', 1),
      ('app.imova_ia_semanas()',
       'where q.conversation_id is distinct from (select id from treino)',
       'where q.conversation_id is distinct from (select id from treino) and q.acao <> ''retomou''', 1),
      ('public.relatorio_imova_painel_ia()',
       'select q.* from public.ia_respostas q where q.conversation_id is distinct from v_treino',
       'select q.* from public.ia_respostas q where q.conversation_id is distinct from v_treino and q.acao <> ''retomou''', 1),
      -- O placar da tela (20261110150000).
      ('public.ia_atendente_painel(integer)',
       'from public.ia_respostas r where r.criada_em >= v_desde',
       'from public.ia_respostas r where r.criada_em >= v_desde and r.acao <> ''retomou''', 1),
      -- "Corrigir" de uma retomada não escreve no caderno da atendente (20261106170000).
      ('public.ia_resposta_avaliar(uuid,text,text)',
       'if p_avaliacao = ''corrigir'' then',
       'if p_avaliacao = ''corrigir'' and r.acao <> ''retomou'' then', 1)
    ) as x(alvo, de, para, vezes)
  loop
    if to_regprocedure(t.alvo) is null then
      raise notice 'retomada: % não existe neste banco, nada a trocar.', t.alvo;
      continue;
    end if;
    v_def := pg_get_functiondef(t.alvo::regprocedure);
    if position(t.para in v_def) > 0 then
      continue;
    end if;
    v_vezes := (length(v_def) - length(replace(v_def, t.de, ''))) / length(t.de);
    if v_vezes <> t.vezes then
      raise exception 'retomada: o trecho "%" aparece % vez(es) em % (esperado %): nada foi trocado.',
        t.de, v_vezes, t.alvo, t.vezes;
    end if;
    execute replace(v_def, t.de, t.para);
  end loop;

  -- -------------------------------------------------------------------
  -- 10. A rodada a cada 5 minutos. Desligada (o padrão), ela só lê a chave.
  -- -------------------------------------------------------------------
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ia_retomadas_rodar', '*/5 * * * *', $cron$select app.ia_retomadas_rodar()$cron$);
  end if;
end $retomar$;

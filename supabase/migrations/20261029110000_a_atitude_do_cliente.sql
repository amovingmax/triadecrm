-- =====================================================================
-- A atitude do cliente: interesse e objeção por conversa (29/10/2026)
--
-- Pedido do usuário para a Imova: "quero essa etiqueta pra eu sempre saber
-- quem são os clientes mais interessados", com uma regra que classifica cada
-- pessoa "de acordo com sua própria atitude" — quem entrou em contato é
-- interessado, e a resposta seguinte mantém ou muda a etiqueta.
--
-- Três coisas separadas, de propósito:
--   1. INTERESSE, uma etiqueta por conversa, que a regra recalcula:
--      muito_interessado · interessado · morno · esfriando · sem_resposta ·
--      sem_interesse · nao_contatar.
--   2. OBJEÇÃO, à parte e com tipo (preço, localização...). Convive com o
--      interesse: "gostei, mas tá caro" é dos mais interessados.
--   3. RECÊNCIA não é etiqueta: é ordem e filtro, e já mora na conversa.
--
-- POR QUE NÃO É A TEMPERATURA. `app.compute_temperature` é por NEGÓCIO e lê a
-- etapa; quase todo cliente da Imova fica na aba Clientes, sem ficha (o lead
-- automático está desligado no seed dela), e a etapa colada na temperatura foi
-- a queixa do Rafael em 28/09 ("só o lead responder e ele já virar morno não
-- faz sentido"). A atitude mora na CONVERSA, que existe para todo mundo que
-- escreveu, e vai junto quando a pessoa vira ficha.
--
-- POR QUE NÃO É ETIQUETA (`tags`). Etiqueta é posta por gente, só existe em
-- ficha e é o filtro do envio em massa. A atitude é da regra e não manda nada.
--
-- O WHATSAPP NÃO MUDA. Nenhum gatilho entra em `messages` nem em
-- `conversations`: o recálculo é do `pg_cron`, a cada minuto, e só LÊ as duas.
-- Nada aqui grava mensagem, enfileira envio ou mexe em janela, bot, ausência,
-- opt-out ou estado da conversa (`whatsapp-intocavel`; o pgTAP 117 prova).
--
-- SÓ DA IMOVA. Pedidos do usuário em 29/10/2026: "essas etiquetas devem servir
-- somente para Imova. A KOMUNE já tem as dela" e "nada do CRM da Komune deve
-- ser alterado agora nessa questão de etiquetas".
--   - NO BANCO DA KOMUNE ESTA MIGRAÇÃO NÃO CRIA NADA. O corpo inteiro roda
--     dentro de um bloco que olha a identidade do banco (`app.identidade`) e
--     sai sem fazer nada quando ela é "komune": fica só o registro da versão,
--     para as migrações seguintes andarem na ordem. Nenhuma tabela, função,
--     política, chave ou job. As etiquetas da KOMUNE (`tags`) não mudam.
--   - No banco da Imova, e num banco ainda sem identidade (o `db reset` local
--     e o CI, onde a identidade só é gravada pelo seed, depois das migrações),
--     tudo é criado.
--   - Mesmo criada, a regra só liga num banco cuja identidade é "imova"
--     (`app.atitude_config`); a chave, as objeções e o recálculo de minuto em
--     minuto (`pg_cron`) vêm do seed da Imova; a tela só pergunta pela
--     atitude onde o módulo existe (`EMPRESA.modulos.atitudeDoCliente`).
--
-- Fase 1, sem IA: o que é fato (quem escreveu primeiro, quem falou por último,
-- há quanto tempo, a etapa) a regra vê sozinha; o que depende de ler a
-- mensagem, quem atende marca com um toque. A IA entra depois, sugerindo.
-- =====================================================================

do $atitude$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A atitude do cliente é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. Configuração e catálogo de objeções
-- =====================================================================
-- Os padrões ficam aqui; a linha de `app_settings['atitude']` (que liga e
-- ajusta os prazos) é gravada pelo seed da Imova.
create or replace function app.atitude_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select '{"ligada": false,
           "esfria_em_dias": {"muito_interessado": 3, "interessado": 7},
           "volta_sozinho_em_dias": 7}'::jsonb
         || coalesce((select s.value from public.app_settings s where s.key = 'atitude'), '{}'::jsonb)
         -- Fora da Imova, desligada sempre, diga o que disser a configuração.
         || case when (select i.empresa from app.identidade i) = 'imova' then '{}'::jsonb
                 else '{"ligada": false}'::jsonb end
$$;
comment on function app.atitude_config() is
  'A configuração da atitude, com os padrões por baixo do que estiver em app_settings[''atitude'']. Só liga no banco da Imova (app.identidade): na KOMUNE, ligada é sempre false.';
revoke all on function app.atitude_config() from public, anon;

create table if not exists public.objecoes (
  id       int generated always as identity primary key,
  slug     text not null unique check (slug ~ '^[a-z0-9_]{2,40}$'),
  nome     text not null check (length(trim(nome)) between 2 and 60),
  posicao  int not null default 0,
  ativa    boolean not null default true
);
alter table public.objecoes enable row level security;
drop policy if exists objecoes_select on public.objecoes;
create policy objecoes_select on public.objecoes
  for select to authenticated using (true);
drop policy if exists objecoes_insert on public.objecoes;
create policy objecoes_insert on public.objecoes
  for insert to authenticated with check ((select app.admin_ou_gestor()));
drop policy if exists objecoes_update on public.objecoes;
create policy objecoes_update on public.objecoes
  for update to authenticated
  using ((select app.admin_ou_gestor())) with check ((select app.admin_ou_gestor()));
comment on table public.objecoes is
  'Catálogo de objeções do cliente (preço, localização...). Dado de empresa: as linhas vêm do seed de cada uma. Desativar em vez de apagar: as marcas antigas apontam para cá.';

-- =====================================================================
-- 2. O que a regra calculou, a objeção marcada e o porquê de cada mudança
-- =====================================================================
create table if not exists public.atitudes (
  conversation_id  uuid primary key references public.conversations (id) on delete cascade,
  -- Nula na conversa sem mensagem nenhuma: a regra olhou e não há o que dizer.
  etiqueta         text check (etiqueta in (
                     'muito_interessado', 'interessado', 'morno', 'esfriando',
                     'sem_resposta', 'sem_interesse', 'nao_contatar')),
  -- Só em Esfriando: o que a pessoa era antes de parar de responder.
  antes_de_esfriar text check (antes_de_esfriar in ('muito_interessado', 'interessado')),
  motivo           text,
  desde            timestamptz not null default now(),
  -- Quando vira Esfriando se nada mudar: é o que o recálculo vigia.
  decai_em         timestamptz,
  -- O toque de quem atende. Vale até um fato mais novo (etapa, volta do cliente).
  marcada          text check (marcada in ('muito_interessado', 'interessado', 'morno', 'sem_interesse')),
  marcada_em       timestamptz,
  marcada_por      uuid references public.profiles (id) on delete set null,
  -- Nula até a regra passar pela linha: a que nasce só com o toque também
  -- entra no próximo recálculo.
  calculada_em     timestamptz
);
create index if not exists atitudes_etiqueta_idx on public.atitudes (etiqueta);
create index if not exists atitudes_decai_idx on public.atitudes (decai_em) where decai_em is not null;
alter table public.atitudes enable row level security;
drop policy if exists atitudes_select on public.atitudes;
create policy atitudes_select on public.atitudes
  for select to authenticated using ((select app.conversa_visivel(conversation_id)));
comment on table public.atitudes is
  'A etiqueta de atitude de cada conversa (29/10/2026). Escrita só por app.atitude_gravar (pg_cron e public.atitude_marcar).';

create table if not exists public.conversa_objecoes (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  objecao_id      int  not null references public.objecoes (id),
  marcada_em      timestamptz not null default now(),
  marcada_por     uuid references public.profiles (id) on delete set null,
  resolvida_em    timestamptz,
  resolvida_por   uuid references public.profiles (id) on delete set null,
  primary key (conversation_id, objecao_id)
);
alter table public.conversa_objecoes enable row level security;
drop policy if exists conversa_objecoes_select on public.conversa_objecoes;
create policy conversa_objecoes_select on public.conversa_objecoes
  for select to authenticated using ((select app.conversa_visivel(conversation_id)));
comment on table public.conversa_objecoes is
  'As objeções de cada conversa. Aberta enquanto resolvida_em é nulo. Escrita só por public.objecao_marcar.';

create table if not exists public.atitude_historico (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  tipo            text not null check (tipo in ('etiqueta', 'objecao')),
  de              text,
  para            text,
  motivo          text not null,
  por             uuid references public.profiles (id) on delete set null,
  em              timestamptz not null default now()
);
create index if not exists atitude_historico_conversa_idx
  on public.atitude_historico (conversation_id, em desc);
alter table public.atitude_historico enable row level security;
drop policy if exists atitude_historico_select on public.atitude_historico;
create policy atitude_historico_select on public.atitude_historico
  for select to authenticated using ((select app.conversa_visivel(conversation_id)));
comment on table public.atitude_historico is
  'Cada mudança de etiqueta e de objeção, com o porquê em português e quem fez (nulo = a regra).';

-- =====================================================================
-- 3. A regra
-- =====================================================================
create or replace function app.atitude_rotulo(p_etiqueta text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_etiqueta
    when 'muito_interessado' then 'Muito interessado'
    when 'interessado'       then 'Interessado'
    when 'morno'             then 'Morno'
    when 'esfriando'         then 'Esfriando'
    when 'sem_resposta'      then 'Sem resposta'
    when 'sem_interesse'     then 'Sem interesse'
    when 'nao_contatar'      then 'Não contatar'
  end
$$;

revoke all on function app.atitude_rotulo(text) from public, anon;

-- "29/10", no fuso da operação.
create or replace function app.atitude_dia(p_em timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_em at time zone 'America/Fortaleza', 'DD/MM')
$$;
revoke all on function app.atitude_dia(timestamptz) from public, anon;

-- A etiqueta de UMA conversa, sem gravar nada.
--
-- Ordem da regra:
--   1. Não contatar vence tudo: supressão, ficha marcada, contato bloqueado ou
--      negócio na etapa de opt-out.
--   2. O sinal MAIS NOVO entre o toque de quem atende e a etapa do negócio
--      (quente → Muito interessado; nutrição → Morno; perdido → Sem interesse).
--   3. A iniciativa do cliente — a primeira mensagem da conversa ser dele, ou
--      ele voltar a escrever depois de `volta_sozinho_em_dias` de silêncio —
--      dá Interessado quando não há sinal, ou quando é mais nova que um Morno
--      ou um Sem interesse. Ela nunca rebaixa quem já está interessado.
--   4. Sem sinal nenhum: respondeu a nós → Morno; não respondeu → Sem resposta.
--   5. Interessado e Muito interessado esfriam quando a última mensagem é de
--      GENTE do time e ficou sem resposta por `esfria_em_dias`. Se quem falou
--      por último foi o cliente, ele não esfria: quem está devendo é o time.
--
-- `p_agora` existe para o teste andar no tempo sem mexer no relógio.
create or replace function app.atitude_calcular(p_conversation_id uuid, p_agora timestamptz default now())
returns table (etiqueta text, antes_de_esfriar text, motivo text, desde timestamptz, decai_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_cfg        jsonb := app.atitude_config();
  v_volta_dias numeric := coalesce((v_cfg ->> 'volta_sozinho_em_dias')::numeric, 7);
  c            record;
  a            record;
  v_org_fora   boolean := false;
  v_entrada    timestamptz;   -- última mensagem do cliente
  v_nossa      timestamptz;   -- última mensagem de gente do time que saiu
  v_chamada    timestamptz;   -- última mensagem nossa de qualquer autor
  v_ini_em     timestamptz;   -- a iniciativa mais nova do cliente
  v_ini_primeira boolean;
  v_ini_folga  numeric;
  v_base       text;
  v_base_em    timestamptz;
  v_base_motivo text;
  v_neg        record;
  v_sinal      timestamptz;
  v_prazo      numeric;
  v_decai      timestamptz;
begin
  select cv.id, cv.peer_phone_e164, cv.organization_id, cv.bloqueada_em
    into c
    from public.conversations cv where cv.id = p_conversation_id;
  if not found then return; end if;

  -- 1. Não contatar.
  if c.organization_id is not null then
    select (o.do_not_contact or o.deleted_at is not null) into v_org_fora
      from public.organizations o where o.id = c.organization_id;
  end if;
  if app.is_suppressed(c.peer_phone_e164, null, null) or coalesce(v_org_fora, false)
     or c.bloqueada_em is not null
     or exists (select 1 from public.deals d join public.stages s on s.id = d.stage_id
                 where d.organization_id = c.organization_id and s.is_optout) then
    etiqueta := 'nao_contatar';
    motivo := case
      when c.bloqueada_em is not null then 'Contato bloqueado no WhatsApp'
      else 'Pediu para não ser contatado' end;
    desde := coalesce(c.bloqueada_em, p_agora);
    return next; return;
  end if;

  -- As mensagens. Aviso do WhatsApp não é atitude de ninguém; mensagem que
  -- não saiu (fila ou falha) não é "nós falamos".
  select max(m.created_at) filter (where m.direction = 'in'),
         max(m.created_at) filter (where m.direction = 'out' and m.author_kind = 'human'
                                     and m.status not in ('queued', 'failed')
                                     and m.type not in ('reaction', 'system')),
         max(m.created_at) filter (where m.direction = 'out' and m.status <> 'failed')
    into v_entrada, v_nossa, v_chamada
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.created_at <= p_agora
     and m.type <> 'system';

  -- A iniciativa mais nova: mensagem do cliente sem nada antes, ou depois de
  -- `volta_sozinho_em_dias` de silêncio dos dois lados.
  select x.em, x.anterior is null,
         extract(epoch from (x.em - x.anterior)) / 86400
    into v_ini_em, v_ini_primeira, v_ini_folga
    from (select m.created_at as em, m.direction,
                 lag(m.created_at) over (order by m.created_at, m.id) as anterior
            from public.messages m
           where m.conversation_id = p_conversation_id
             and m.created_at <= p_agora
             and m.type <> 'system'
             and not (m.direction = 'out' and m.status = 'failed')) x
   where x.direction = 'in'
     and (x.anterior is null or x.em - x.anterior >= make_interval(days => v_volta_dias::int))
   order by x.em desc
   limit 1;

  -- 2. O sinal mais novo: o toque ou a etapa.
  select t.marcada, t.marcada_em, t.marcada_por into a
    from public.atitudes t where t.conversation_id = p_conversation_id;
  if a.marcada is not null and a.marcada_em <= p_agora then
    v_base := a.marcada;
    v_base_em := a.marcada_em;
    v_base_motivo := 'Marcado por ' || coalesce(
      (select split_part(p.full_name, ' ', 1) from public.profiles p where p.id = a.marcada_por),
      'alguém do time') || ' em ' || app.atitude_dia(a.marcada_em);
  end if;

  if c.organization_id is not null then
    for v_neg in
      select s.name as etapa, s.temperature, s.is_dormant, s.is_lost, d.status,
             case when d.status = 'lost' or s.is_lost then coalesce(d.lost_at, d.entered_stage_at)
                  else d.entered_stage_at end as em
        from public.deals d join public.stages s on s.id = d.stage_id
       where d.organization_id = c.organization_id
         and (d.status = 'lost' or s.is_lost
              or (d.status = 'open' and s.temperature = 'quente')
              or s.is_dormant or d.status = 'nurturing')
       order by 6 desc
    loop
      if v_neg.em <= p_agora and (v_base_em is null or v_neg.em > v_base_em) then
        v_base_em := v_neg.em;
        if v_neg.status = 'lost' or v_neg.is_lost then
          v_base := 'sem_interesse';
          v_base_motivo := 'Negócio perdido em ' || app.atitude_dia(v_neg.em);
        elsif v_neg.is_dormant or v_neg.status = 'nurturing' then
          v_base := 'morno';
          v_base_motivo := 'Etapa ' || v_neg.etapa || ' desde ' || app.atitude_dia(v_neg.em);
        else
          v_base := 'muito_interessado';
          v_base_motivo := 'Etapa ' || v_neg.etapa || ' desde ' || app.atitude_dia(v_neg.em);
        end if;
      end if;
      exit; -- o primeiro da lista é o mais novo
    end loop;
  end if;

  -- 3. A iniciativa do cliente.
  if v_ini_em is not null
     and (v_base is null
          or (v_base in ('morno', 'sem_interesse') and v_ini_em > v_base_em)) then
    v_base := 'interessado';
    v_base_em := v_ini_em;
    v_base_motivo := case
      when v_ini_primeira then 'Entrou em contato por conta própria em ' || app.atitude_dia(v_ini_em)
      else 'Voltou a escrever sozinho em ' || app.atitude_dia(v_ini_em)
           || ', depois de ' || floor(v_ini_folga)::int || ' dias' end;
  end if;

  -- 4. Sem sinal nenhum.
  if v_base is null then
    if v_entrada is not null then
      v_base := 'morno';
      v_base_em := v_entrada;
      v_base_motivo := 'Respondeu em ' || app.atitude_dia(v_entrada) || ', ainda sem sinal de interesse';
    elsif v_chamada is not null then
      etiqueta := 'sem_resposta';
      motivo := 'Chamamos em ' || app.atitude_dia(v_chamada) || ' e ainda não respondeu';
      desde := v_chamada;
      return next; return;
    else
      return; -- conversa sem mensagem: sem etiqueta
    end if;
  end if;

  -- 5. Esfriar.
  if v_base in ('muito_interessado', 'interessado') and v_nossa is not null then
    v_sinal := greatest(coalesce(v_entrada, '-infinity'::timestamptz), v_base_em);
    if v_nossa > v_sinal then
      v_prazo := coalesce((v_cfg -> 'esfria_em_dias' ->> v_base)::numeric,
                          case v_base when 'muito_interessado' then 3 else 7 end);
      v_decai := v_nossa + make_interval(secs => v_prazo * 86400);
      if p_agora >= v_decai then
        etiqueta := 'esfriando';
        antes_de_esfriar := v_base;
        motivo := 'Sem responder desde ' || app.atitude_dia(v_nossa)
                  || ' (era ' || app.atitude_rotulo(v_base) || ')';
        desde := v_decai;
        return next; return;
      end if;
    end if;
  end if;

  etiqueta := v_base;
  motivo := v_base_motivo;
  desde := v_base_em;
  decai_em := v_decai;
  return next;
end $$;
comment on function app.atitude_calcular(uuid, timestamptz) is
  'A etiqueta de atitude de uma conversa, sem gravar (ordem da regra no corpo). Só lê conversations, messages, deals, stages, organizations, suppression_list e atitudes.';
revoke all on function app.atitude_calcular(uuid, timestamptz) from public, anon, authenticated;

-- Calcula e grava; anota no histórico quando a etiqueta muda.
create or replace function app.atitude_gravar(p_conversation_id uuid, p_por uuid default null,
                                              p_agora timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      record;
  v_antes text;
begin
  select t.etiqueta into v_antes from public.atitudes t where t.conversation_id = p_conversation_id;
  select * into r from app.atitude_calcular(p_conversation_id, p_agora);

  -- Sem etiqueta (conversa sem mensagem) a linha nasce do mesmo jeito, vazia:
  -- é o que impede o recálculo de voltar a ela a cada minuto.
  insert into public.atitudes as t (conversation_id, etiqueta, antes_de_esfriar, motivo, desde,
                                    decai_em, calculada_em)
  values (p_conversation_id, r.etiqueta, r.antes_de_esfriar, r.motivo,
          coalesce(r.desde, p_agora), r.decai_em, p_agora)
  on conflict (conversation_id) do update
     set etiqueta         = excluded.etiqueta,
         antes_de_esfriar = excluded.antes_de_esfriar,
         motivo           = excluded.motivo,
         desde            = case when t.etiqueta = excluded.etiqueta then t.desde else excluded.desde end,
         decai_em         = excluded.decai_em,
         calculada_em     = excluded.calculada_em;

  if v_antes is distinct from r.etiqueta then
    insert into public.atitude_historico (conversation_id, tipo, de, para, motivo, por, em)
    values (p_conversation_id, 'etiqueta', v_antes, r.etiqueta, r.motivo, p_por, p_agora);
  end if;
end $$;
revoke all on function app.atitude_gravar(uuid, uuid, timestamptz) from public, anon, authenticated;

-- O recálculo do pg_cron: só as conversas em que algo mudou desde a última
-- conta, e as que chegaram na hora de esfriar.
create or replace function app.atitudes_recalcular(p_limite int default 500)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  n    int := 0;
begin
  if not coalesce((app.atitude_config() ->> 'ligada')::boolean, false) then
    return 0;
  end if;
  for v_id in
    select c.id
      from public.conversations c
      left join public.atitudes t on t.conversation_id = c.id
     where c.last_message_at is not null
       and (t.conversation_id is null
            or t.calculada_em is null
            or c.last_message_at > t.calculada_em
            or c.updated_at > t.calculada_em
            or t.decai_em <= now()
            or exists (select 1 from public.deals d
                        where d.organization_id = c.organization_id and d.updated_at > t.calculada_em)
            or exists (select 1 from public.organizations o
                        where o.id = c.organization_id and o.updated_at > t.calculada_em))
     order by c.last_message_at desc
     limit greatest(coalesce(p_limite, 500), 1)
  loop
    perform app.atitude_gravar(v_id);
    n := n + 1;
  end loop;
  return n;
end $$;
comment on function app.atitudes_recalcular(int) is
  'Recalcula a atitude das conversas que mudaram (mensagem, conversa, negócio, ficha) e das que chegaram na hora de esfriar. Desligada (app_settings[''atitude''].ligada = false), devolve 0 sem ler mais nada.';
revoke all on function app.atitudes_recalcular(int) from public, anon, authenticated;

-- O agendamento de minuto em minuto NÃO é feito aqui: é do seed da Imova. Na
-- KOMUNE não há job nenhum.

-- =====================================================================
-- 4. O toque de quem atende
-- =====================================================================
create or replace function public.atitude_marcar(p_conversation_id uuid, p_etiqueta text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not coalesce((app.atitude_config() ->> 'ligada')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', 'desligada');
  end if;
  if not app.posso_mexer_na_conversa(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_etiqueta is not null
     and p_etiqueta not in ('muito_interessado', 'interessado', 'morno', 'sem_interesse') then
    return jsonb_build_object('ok', false, 'motivo', 'etiqueta_invalida');
  end if;

  -- A linha pode não existir ainda (a regra não rodou): nasce só com a marca,
  -- sem etiqueta, e o cálculo logo abaixo põe a etiqueta de verdade.
  insert into public.atitudes as t (conversation_id, marcada, marcada_em, marcada_por)
  values (p_conversation_id, p_etiqueta,
          case when p_etiqueta is not null then now() end,
          case when p_etiqueta is not null then auth.uid() end)
  on conflict (conversation_id) do update
     set marcada     = excluded.marcada,
         marcada_em  = excluded.marcada_em,
         marcada_por = excluded.marcada_por;

  perform app.atitude_gravar(p_conversation_id, auth.uid());

  select t.etiqueta, t.motivo, t.marcada into r
    from public.atitudes t where t.conversation_id = p_conversation_id;
  return jsonb_build_object('ok', true, 'etiqueta', r.etiqueta, 'motivo', r.motivo, 'marcada', r.marcada);
end $$;
comment on function public.atitude_marcar(uuid, text) is
  'O toque de quem atende: muito_interessado, interessado, morno ou sem_interesse (nulo volta para a regra). Vale até um fato mais novo — a etapa do negócio mudar ou o cliente voltar a escrever sozinho. Não envia nada.';
revoke all on function public.atitude_marcar(uuid, text) from public, anon;
grant execute on function public.atitude_marcar(uuid, text) to authenticated;

create or replace function public.objecao_marcar(p_conversation_id uuid, p_objecao_id int,
                                                 p_aberta boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome  text;
  v_antes boolean;
begin
  if not coalesce((app.atitude_config() ->> 'ligada')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', 'desligada');
  end if;
  if not app.posso_mexer_na_conversa(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select o.nome into v_nome from public.objecoes o where o.id = p_objecao_id and o.ativa;
  if v_nome is null then
    return jsonb_build_object('ok', false, 'motivo', 'objecao_invalida');
  end if;

  select x.resolvida_em is null into v_antes
    from public.conversa_objecoes x
   where x.conversation_id = p_conversation_id and x.objecao_id = p_objecao_id;

  if p_aberta then
    insert into public.conversa_objecoes (conversation_id, objecao_id, marcada_por)
    values (p_conversation_id, p_objecao_id, auth.uid())
    on conflict (conversation_id, objecao_id) do update
       set marcada_em = case when public.conversa_objecoes.resolvida_em is null
                             then public.conversa_objecoes.marcada_em else now() end,
           marcada_por = case when public.conversa_objecoes.resolvida_em is null
                              then public.conversa_objecoes.marcada_por else auth.uid() end,
           resolvida_em = null,
           resolvida_por = null;
  else
    update public.conversa_objecoes
       set resolvida_em = now(), resolvida_por = auth.uid()
     where conversation_id = p_conversation_id and objecao_id = p_objecao_id
       and resolvida_em is null;
  end if;

  if coalesce(v_antes, false) is distinct from p_aberta then
    insert into public.atitude_historico (conversation_id, tipo, de, para, motivo, por)
    values (p_conversation_id, 'objecao',
            case when p_aberta then null else v_nome end,
            case when p_aberta then v_nome else null end,
            case when p_aberta then 'Objeção: ' || v_nome else 'Objeção resolvida: ' || v_nome end,
            auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'aberta', p_aberta);
end $$;
comment on function public.objecao_marcar(uuid, int, boolean) is
  'Marca (p_aberta = true) ou resolve uma objeção da conversa, com registro no histórico. Não mexe na etiqueta de interesse e não envia nada.';
revoke all on function public.objecao_marcar(uuid, int, boolean) from public, anon;
grant execute on function public.objecao_marcar(uuid, int, boolean) to authenticated;

  $ddl$;
end $atitude$;

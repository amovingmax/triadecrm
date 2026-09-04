-- ===========================================================================
-- Tríade — Correções do módulo de ligação (lado do banco)
--
-- Fonte da verdade: docs/anexos/R13-telemarketing-prospeccao-ativa.md,
-- PRD §5 e RF-FUN-*; guardrail central de opt-out em CLAUDE.md e RF-CON-18.
-- Corrige, sem redesenhar, cinco achados da conferência adversarial sobre a
-- migração 20260904001300 e a seed:
--
--   D2  o lote nascia com prazo de UM dia e prometia três tentativas;
--   D4  o roteiro gravava a resposta errada no campo errado (lado da seed);
--   D6  o opt-out tinha UMA porta só — e ela se fechava sozinha;
--   D7  o lote era criado ANTES de contar candidatos (lote fantasma de 0 itens);
--   D8  o motivo de exclusão "sem negócio aberto" escondia o opt-out.
--
-- Nada aqui afrouxa guardrail: D6 acrescenta caminhos de registro de opt-out e
-- não retira nenhum; D8 só troca a ORDEM em que os motivos são avaliados; D2 só
-- ALARGA o prazo do lote (nunca encurta o que o autor pediu).
-- ===========================================================================


-- ===========================================================================
-- D2. O prazo do lote tem de caber nas tentativas que o lote promete
-- ===========================================================================
-- O DEFEITO, medido: `montar_lote` gravava `ends_on = coalesce(p_termina_em,
-- p_inicia_em, hoje)` e a tela de montagem sempre manda `terminaEm = hoje`
-- (lote-montagem.tsx: `useState(hojeEmFortaleza)`). Com `max_attempts = 3` e
-- `min_hours_between_attempts = 20`, um item tabulado como "não atendeu" às
-- 17h28 de sexta volta agendado para sábado 13h28 — depois das 13h em que a
-- janela de sábado fecha (app.call_window_hours(6) = 10h–13h) — e nesse meio
-- tempo `app.expirar_reservas` já devolveu o lote inteiro por
-- `b.ends_on < hoje`. Resultado: `max_attempts = 3` era inalcançável no lote
-- padrão, e o recibo da tabulação prometia "volta para a fila deste lote".
--
-- A DECISÃO: alargar o prazo do lote, não mudar a frase do recibo. Três razões.
--   1. O número que a pessoa escolhe na montagem é "quantas tentativas". O
--      prazo é consequência dele, não um segundo botão que possa contradizê-lo.
--      Duas perguntas para a mesma decisão é como o defeito nasceu.
--   2. Mudar só a frase deixaria de pé um lote que promete 3 e entrega 1: o
--      contato reservado voltaria ao bolo comum no dia seguinte e a segunda
--      tentativa sairia de OUTRO lote, com outra ordem e outro roteiro — que é
--      exatamente o que o recorte fechado do R13 §3.1 existe para impedir.
--   3. A reserva é o que impede o Matheus e a Heloísa de ligarem para o mesmo
--      buffet (R13 §3.1). Segurá-la pelos dias das tentativas prometidas é o
--      propósito dela; devolvê-la à meia-noite é perdê-lo.
--
-- O prazo NÃO é `hoje + max_attempts` em dias corridos: domingo e feriado não
-- abrem, e a janela curta de sábado (10h–13h) engole a volta de uma tentativa
-- do fim da tarde de sexta. Conta-se em DIAS ABERTOS, e sobra um: "n tentativas"
-- não cabem em "n dias abertos" quando a última cai fora da faixa do dia seguinte.
create or replace function app.prazo_do_lote(p_inicio date, p_max_tentativas int)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_precisa int  := greatest(coalesce(p_max_tentativas, 1), 1);
  v_abertos int  := 0;
  v_dia     date := p_inicio;
  v_de      numeric;
begin
  -- Uma tentativa só cabe no próprio dia em que o lote começa.
  if v_precisa <= 1 then
    return p_inicio;
  end if;
  -- Um dia aberto por tentativa DEPOIS do dia de início (o dia de início já
  -- comporta a primeira). 60 dias de teto pelo mesmo motivo de app.proxima_abertura:
  -- é impossível não achar com a `holidays` real, e é melhor que um laço infinito.
  for i in 1..60 loop
    v_dia := p_inicio + i;
    select w.de into v_de from app.call_window_hours(extract(dow from v_dia)::int) w;
    if v_de is not null and not exists (select 1 from public.holidays h where h.date = v_dia) then
      v_abertos := v_abertos + 1;
      exit when v_abertos >= v_precisa;
    end if;
  end loop;
  return v_dia;
end $$;
comment on function app.prazo_do_lote(date, int) is
  'Último dia em que um lote de N tentativas ainda consegue tentar: um dia ABERTO (janela de discagem, sem domingo nem feriado) por tentativa depois do dia de início. É o piso de ends_on em public.montar_lote (D2).';
revoke all on function app.prazo_do_lote(date, int) from public, anon;
grant execute on function app.prazo_do_lote(date, int) to authenticated, service_role;


-- ===========================================================================
-- D6. O opt-out precisa de mais de uma porta — e de nenhuma que se feche
-- ===========================================================================
-- O DEFEITO, medido em 04/09/2026 no banco local (script de prova em anexo ao PR):
-- a pessoa disse "me tira dessa lista, não me ligue mais", o operador tabulou
-- "Sem interesse" com `p_pediu_para_nao_ligar => true` e SEM motivo de perda.
-- `public.tabular_chamada` chamava `public.registrar_contato` ANTES de gravar o
-- consentimento; `lig_sem_interesse` tem `requires_lost_reason = true`, então a
-- delegação recusou com `motivo_de_perda_obrigatorio`, a função retornou naquele
-- ponto e o `insert into public.consent_events` NUNCA foi executado. Depois da
-- chamada: consent_events = 0, organizations.do_not_contact = false,
-- app.is_suppressed('+55…') = false. O pedido de opt-out sumiu junto com a recusa.
--
-- Isso é mais grave do que "falta um botão na barra de tabulação": o caminho que
-- o próprio roteiro manda seguir (nó `fim_optout`, cuja nota diz "marque também
-- não me ligue mais") é justamente o que passa por `lig_sem_interesse` — ou seja,
-- a ÚNICA porta documentada era a que se fechava sozinha.
--
-- O CONSERTO tem três partes, e nenhuma delas enfraquece o que já existia:
--   1. `app.registrar_optout_de_contato` — um único lugar que grava o
--      `consent_events` (e, por gatilho, `do_not_contact` + `suppression_list` +
--      etapa de opt-out no funil). Idempotente.
--   2. `public.marcar_nao_ligar_mais` — porta INDEPENDENTE do roteiro e do
--      desfecho: pode ser chamada a qualquer instante da ligação, inclusive antes
--      de existir tabulação, e tira o item da fila do lote na hora.
--   3. `public.tabular_chamada` passa a registrar o pedido em TODA saída em que
--      quem tabula já foi autorizado — inclusive nas recusas. Quando a tabulação
--      dá certo, o registro continua acontecendo DEPOIS de `registrar_contato`,
--      para que a etapa final do negócio seja a de opt-out e não a de perda.

-- ---------- 1. o lugar único que grava o opt-out ----------
-- SECURITY DEFINER por dois motivos, e os dois são de guardrail:
--   * a checagem de "já registrado" lê `public.consent_events`, cuja política de
--     leitura é `sees_all() or org_is_mine(...)`: um embaixador não enxergaria o
--     evento já gravado e gravaria um segundo, poluindo a prova de LGPD;
--   * o retorno não devolve PII nenhuma — nem telefone, nem e-mail, nem nome.
-- A autorização das políticas é REPETIDA aqui dentro, sem afrouxamento: o mesmo
-- `app.can_write()` e a mesma visibilidade de `consent_events_insert` (000500).
create or replace function app.registrar_optout_de_contato(
  p_organization_id uuid,
  p_contact_id      uuid default null,
  p_evidencia       text default null,
  p_canal           app.channel default 'phone')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_ja   uuid;
  v_novo uuid;
begin
  if p_organization_id is null and p_contact_id is null then
    return jsonb_build_object('registrado', false, 'motivo', 'sem_alvo', 'consent_id', null);
  end if;
  -- service_role (workers, wa-webhook) entra sem JWT e continua podendo registrar,
  -- como já acontece em consent_events pela política da 000500.
  if v_uid is not null then
    if not app.can_write() then
      return jsonb_build_object('registrado', false, 'motivo', 'sem_permissao', 'consent_id', null);
    end if;
    if p_organization_id is not null and not app.org_is_visible(p_organization_id) then
      return jsonb_build_object('registrado', false, 'motivo', 'alvo_invisivel', 'consent_id', null);
    end if;
    if p_contact_id is not null and not app.contact_is_visible(p_contact_id) then
      return jsonb_build_object('registrado', false, 'motivo', 'alvo_invisivel', 'consent_id', null);
    end if;
  end if;

  -- Idempotência: `consent_events` é append-only e o opt-out não tem validade.
  -- Um segundo evento para o MESMO alvo não acrescenta guardrail nenhum e só
  -- suja a prova. Repare que a comparação é pelo par (organização, pessoa): o
  -- opt-out de uma pessoa não cala o registro do opt-out da organização inteira.
  select c.id into v_ja
    from public.consent_events c
   where c.kind = 'contact_optout'::app.consent_kind
     and c.organization_id is not distinct from p_organization_id
     and c.contact_id      is not distinct from p_contact_id
   order by c.occurred_at desc
   limit 1;
  if v_ja is not null then
    return jsonb_build_object('registrado', true, 'motivo', 'ja_registrado', 'consent_id', v_ja);
  end if;

  insert into public.consent_events (kind, organization_id, contact_id, channel,
                                     evidence_text, occurred_at, recorded_by)
  values ('contact_optout'::app.consent_kind, p_organization_id, p_contact_id, p_canal,
          coalesce(nullif(trim(coalesce(p_evidencia, '')), ''),
                   'Pediu para não receber mais ligações.'),
          now(), v_uid)
  returning id into v_novo;

  return jsonb_build_object('registrado', true, 'motivo', 'registrado', 'consent_id', v_novo);
end $$;
comment on function app.registrar_optout_de_contato(uuid, uuid, text, app.channel) is
  'Grava o pedido de "não me ligue mais" em consent_events (RF-CON-18) — e, pelo gatilho app.consent_apply, do_not_contact, os hashes da suppression_list e a etapa de opt-out do funil. Idempotente por (organização, pessoa). É o ÚNICO lugar do módulo de ligação que registra opt-out.';
revoke all on function app.registrar_optout_de_contato(uuid, uuid, text, app.channel)
  from public, anon;
grant execute on function app.registrar_optout_de_contato(uuid, uuid, text, app.channel)
  to authenticated, service_role;


-- ---------- 2. a porta que não depende de nó de roteiro nem de desfecho ----------
-- É o controle que a barra de tabulação pode manter sempre visível: recebe o
-- ITEM do lote (que é o que a tela tem na mão) ou o par organização/pessoa, e
-- não pergunta nada sobre a conversa. Vale antes da primeira frase, no meio do
-- gancho e depois de a chamada já ter sido tabulada.
--
-- Tira o item da fila NA HORA (`devolvido`) e larga a reserva: contato suprimido
-- não pode ser entregue de novo, e `proximo_da_fila` já aplicava essa mesma regra
-- para quem virava suprimido depois da montagem. A tentativa aberta NÃO é fechada
-- de propósito: quem está no telefone continua podendo tabular o que aconteceu, e
-- `tabular_chamada` fecha o item como `devolvido` porque enxerga a supressão.
create or replace function public.marcar_nao_ligar_mais(
  p_item_id         uuid default null,
  p_organization_id uuid default null,
  p_contact_id      uuid default null,
  p_evidencia       text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_org    uuid := p_organization_id;
  v_ct     uuid := p_contact_id;
  v_item   public.call_batch_items%rowtype;
  b        public.call_batches%rowtype;
  v_opt    jsonb;
  v_status app.call_item_status := null;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  if p_item_id is not null then
    select * into v_item from public.call_batch_items where id = p_item_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'item_inexistente');
    end if;
    select * into b from public.call_batches where id = v_item.batch_id;
    if not (app.is_manager() or b.owner_id = v_uid) then
      return jsonb_build_object('ok', false, 'motivo', 'item_de_outro_dono');
    end if;
    v_org := coalesce(v_org, v_item.organization_id);
    v_ct  := coalesce(v_ct,  v_item.contact_id);
  end if;

  v_opt := app.registrar_optout_de_contato(v_org, v_ct, p_evidencia, 'phone'::app.channel);
  if not (v_opt ->> 'registrado')::boolean then
    return jsonb_build_object('ok', false, 'motivo', v_opt ->> 'motivo');
  end if;

  if p_item_id is not null then
    update public.call_batch_items x
       set status         = 'devolvido'::app.call_item_status,
           scheduled_at   = null,
           reserved_until = null,
           reserved_by    = null,
           note           = coalesce(nullif(trim(coalesce(p_evidencia, '')), ''),
                                     'pediu para não ser contatado')
     where x.id = p_item_id
    returning x.status into v_status;
  end if;

  return jsonb_build_object('ok', true,
                            'motivo',            v_opt ->> 'motivo',
                            'consent_id',        v_opt -> 'consent_id',
                            'optout_registrado', true,
                            'contato_suprimido', true,
                            'item_status',       v_status);
end $$;
comment on function public.marcar_nao_ligar_mais(uuid, uuid, uuid, text) is
  'Registra "não me ligue mais" a QUALQUER momento da ligação, sem depender do nó do roteiro nem do desfecho escolhido (RF-CON-18, guardrail do CLAUDE.md), e tira o item da fila do lote na hora. Idempotente: chamar duas vezes devolve ok com motivo ja_registrado.';
revoke all on function public.marcar_nao_ligar_mais(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.marcar_nao_ligar_mais(uuid, uuid, uuid, text)
  to authenticated, service_role;


-- ---------- 3. a recusa da tabulação que não engole o pedido ----------
-- Toda saída de `tabular_chamada` posterior à autorização passa por aqui. O opt-out
-- é registrado ANTES de a recusa ser devolvida — é a inversão exata do defeito.
create or replace function app.recusa_de_tabulacao(
  p_motivo     text,
  p_detalhe    text,
  p_optout     boolean,
  p_org        uuid,
  p_contato    uuid,
  p_evidencia  text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare v_opt jsonb;
begin
  if coalesce(p_optout, false) then
    v_opt := app.registrar_optout_de_contato(p_org, p_contato, p_evidencia, 'phone'::app.channel);
  end if;
  return jsonb_build_object(
    'tabulado',          false,
    'motivo',            p_motivo,
    'detalhe',           p_detalhe,
    'optout_registrado', coalesce((v_opt ->> 'registrado')::boolean, false),
    'contato_suprimido', coalesce((v_opt ->> 'registrado')::boolean, false));
end $$;
comment on function app.recusa_de_tabulacao(text, text, boolean, uuid, uuid, text) is
  'Recusa de public.tabular_chamada que registra o pedido de opt-out ANTES de devolver o não (RF-CON-18). Existe porque a recusa mais comum — "Sem interesse" sem motivo de perda — era justamente a que engolia o opt-out.';
revoke all on function app.recusa_de_tabulacao(text, text, boolean, uuid, uuid, text)
  from public, anon;
grant execute on function app.recusa_de_tabulacao(text, text, boolean, uuid, uuid, text)
  to authenticated, service_role;


-- ===========================================================================
-- D8. A ordem dos motivos: supressão antes de "sem negócio aberto"
-- ===========================================================================
-- O DEFEITO: `case when d.status <> 'open' then 'sem_negocio_aberto'` era o
-- PRIMEIRO ramo, e `app.consent_apply` move todo negócio aberto de quem pediu
-- opt-out para a etapa de opt-out — que é `is_lost`, e portanto fecha o negócio.
-- Consequência: quem pediu para sair aparecia no recibo da montagem como "sem
-- negócio aberto", e o motivo verdadeiro — 'suprimido' — nunca era mostrado. A
-- tela ficava sem o único número que interessa a quem responde por LGPD.
--
-- O conserto é só a ORDEM: nada entra que não entrava, nada deixa de entrar.
-- A ordem agora é a da GRAVIDADE, e não a da conveniência de leitura:
--   não contatar > suprimido > sem telefone > sem negócio aberto > temperatura >
--   janela de recontato > reservado em outro lote.
-- Os três primeiros são "esta pessoa não pode ser chamada"; os demais são "hoje
-- não é a vez dela".
create or replace function app.call_candidates(
  p_pipeline_id        int,
  p_temperatura_origem app.temperature,
  p_categoria_ids      int[],
  p_ordem              app.call_order,
  p_seed               int)
returns table (
  organization_id uuid,
  contact_id      uuid,
  phone_e164      text,
  deal_id         uuid,
  stage_id        int,
  motivo          text,
  ordem           bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id,
         d.primary_contact_id,
         o.phone_e164,
         d.id,
         d.stage_id,
         case
           when o.do_not_contact                                      then 'nao_contatar'
           when app.is_suppressed_target(o.id, d.primary_contact_id)  then 'suprimido'
           when nullif(trim(coalesce(o.phone_e164, '')), '') is null  then 'sem_telefone'
           when d.status <> 'open'::app.deal_status                   then 'sem_negocio_aberto'
           when d.temperature <> p_temperatura_origem                 then 'temperatura_diferente'
           when coalesce(cd.blocked_forever, false)                   then 'em_janela_de_recontato'
           when cd.cooldown_until > now()                             then 'em_janela_de_recontato'
           when exists (select 1 from public.call_batch_items r
                         where r.status in ('fila'::app.call_item_status,
                                            'em_andamento'::app.call_item_status)
                           and (r.organization_id = o.id or r.phone_e164 = o.phone_e164))
                                                                      then 'reservado_em_outro_lote'
           else null
         end,
         row_number() over (
           order by
             case when p_ordem = 'prioridade'::app.call_order
                  then case d.tier when 'A+' then 4 when 'A' then 3 when 'B' then 2 when 'C' then 1 else 0 end
                  else 0 end desc,
             case when p_ordem = 'prioridade'::app.call_order
                  then coalesce(d.score, -1) else 0 end desc,
             case when p_ordem = 'aleatorio'::app.call_order
                  then md5(p_seed::text || o.id::text) else '' end,
             case when p_ordem <> 'aleatorio'::app.call_order
                  then coalesce(d.last_activity_at, 'epoch'::timestamptz) end asc,
             o.name)
    from public.organizations o
    join public.deals d
      on d.organization_id = o.id
     and d.pipeline_id = p_pipeline_id
    left join public.v_contact_cooldown cd on cd.organization_id = o.id
   where o.deleted_at is null
     and app.org_is_visible(o.id)
     and (cardinality(coalesce(p_categoria_ids, '{}'::int[])) = 0
          or exists (select 1 from public.organization_categories oc
                      where oc.organization_id = o.id
                        and oc.category_id = any (p_categoria_ids)))
$$;
comment on function app.call_candidates(int, app.temperature, int[], app.call_order, int) is
  'Candidatos de um lote de ligação, com o motivo de exclusão de cada um (null = entra) e a ordem congelada da fila (R13 §3.1). Os motivos são avaliados por GRAVIDADE — nao_contatar e suprimido antes de sem_negocio_aberto (D8) —, porque o opt-out fecha o negócio e sem essa ordem ele aparecia como "sem negócio aberto". Devolve telefone: só as RPCs security definer do módulo a executam.';
revoke all on function app.call_candidates(int, app.temperature, int[], app.call_order, int)
  from public, anon, authenticated;


-- ===========================================================================
-- D7 (+ D2). Montar o lote: contar primeiro, criar depois
-- ===========================================================================
-- O DEFEITO: o `insert into public.call_batches` era a primeira escrita da função,
-- ANTES de a contagem de candidatos existir. Numa corrida de reserva — as duas
-- pessoas montando lote no mesmo minuto — a contagem chegava zerada, o insert dos
-- itens não pegava nenhuma linha e o que sobrava era um lote de 0 itens, ativo, na
-- lista da tela, segurando nome e roteiro sem nada dentro.
--
-- O conserto tem duas trancas, porque a corrida não desaparece:
--   * conta ANTES: sem candidato elegível, nenhuma linha é criada;
--   * desfaz DEPOIS: se a corrida levar todos entre a contagem e o insert, o lote
--     recém-criado é apagado na mesma transação e a recusa nomeia o motivo.
-- A montagem inteira é uma chamada de função, logo uma transação: o `delete`
-- desfaz de verdade, e o `audit_log` registra o par insert/delete — que é a
-- história honesta do que aconteceu.
create or replace function public.montar_lote(
  p_nome                   text,
  p_pipeline_id            int,
  p_temperatura_origem     app.temperature,
  p_roteiro_id             uuid,
  p_categoria_ids          int[]        default '{}',
  p_ordem                  app.call_order default 'prioridade',
  p_tamanho                int          default 25,
  p_max_tentativas         int          default 3,
  p_horas_entre_tentativas int          default 20,
  p_meta_ligacoes          int          default null,
  p_inicia_em              date         default null,
  p_termina_em             date         default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_hoje      date := (now() at time zone 'America/Fortaleza')::date;
  v_ordem     app.call_order := coalesce(p_ordem, 'prioridade'::app.call_order);
  v_script    public.call_scripts%rowtype;
  v_lote      uuid;
  v_seed      int  := (floor(random() * 1000000000))::int;
  v_entraram  int  := 0;
  v_elegiveis int  := 0;
  v_excluidos jsonb := '{}'::jsonb;
  v_conflito  int  := 0;
  v_tent      int  := coalesce(p_max_tentativas, 3);
  v_inicio    date;
  v_fim       date;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('montado', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;
  if coalesce(p_tamanho, 0) not between 1 and 60 then
    return jsonb_build_object('montado', false, 'motivo', 'tamanho_invalido', 'detalhe', p_tamanho::text);
  end if;
  if not exists (select 1 from public.pipelines p where p.id = p_pipeline_id) then
    return jsonb_build_object('montado', false, 'motivo', 'funil_invalido', 'detalhe', null);
  end if;

  select * into v_script from public.call_scripts s where s.id = p_roteiro_id and s.is_published;
  if not found then
    return jsonb_build_object('montado', false, 'motivo', 'roteiro_invalido', 'detalhe', null);
  end if;

  -- ----- D2: o prazo é PISO, não sugestão -----
  -- `greatest` e não `coalesce`: quem quiser um lote mais LONGO continua mandando a
  -- data e ela vale; quem mandar uma data mais curta do que as tentativas que pediu
  -- recebe o prazo que as tentativas exigem. Encurtar aqui seria voltar a prometer
  -- três tentativas e entregar uma. Quem quer lote de um dia pede uma tentativa.
  v_inicio := coalesce(p_inicia_em, v_hoje);
  v_fim    := greatest(coalesce(p_termina_em, v_inicio),
                       app.prazo_do_lote(v_inicio, v_tent));

  -- ----- D7: contar ANTES de criar -----
  select coalesce(jsonb_object_agg(t.motivo, t.n), '{}'::jsonb) into v_excluidos
    from (select c.motivo, count(*)::int as n
            from app.call_candidates(p_pipeline_id, p_temperatura_origem,
                                     p_categoria_ids, v_ordem, v_seed) c
           where c.motivo is not null
           group by c.motivo) t;

  select count(*)::int into v_elegiveis
    from app.call_candidates(p_pipeline_id, p_temperatura_origem,
                             p_categoria_ids, v_ordem, v_seed) c
   where c.motivo is null;

  if v_elegiveis = 0 then
    return jsonb_build_object('montado', false, 'motivo', 'sem_candidatos',
                              'detalhe', null, 'pedidos', p_tamanho,
                              'entraram', 0, 'excluidos', v_excluidos);
  end if;

  insert into public.call_batches
    (nome, owner_id, status, pipeline_id, temperature_origin, script_id, script_version,
     order_mode, seed, max_attempts, min_hours_between_attempts, target_calls, starts_on, ends_on)
  values
    (left(trim(p_nome), 60), v_uid, 'ativo', p_pipeline_id, p_temperatura_origem,
     v_script.id, v_script.versao, v_ordem, v_seed,
     v_tent, coalesce(p_horas_entre_tentativas, 20), p_meta_ligacoes,
     v_inicio, v_fim)
  returning id into v_lote;

  -- ----- a reserva -----
  -- `on conflict do nothing` sem alvo: quem já está reservado (por organização OU
  -- por linha telefônica) simplesmente não entra. Não existe "roubar" item de outro
  -- lote; existe encerrar o lote, o que devolve todos os pendentes.
  -- `distinct on (phone_e164)` porque duas organizações do MESMO lote podem carregar
  -- o mesmo número, e aí o conflito seria contra uma linha que este comando acabou
  -- de inserir.
  with escolhidos as (
    select distinct on (c.phone_e164) c.*
      from app.call_candidates(p_pipeline_id, p_temperatura_origem,
                               p_categoria_ids, v_ordem, v_seed) c
     where c.motivo is null
     order by c.phone_e164, c.ordem
  ), ordenados as (
    select e.*, row_number() over (order by e.ordem) as pos
      from escolhidos e
     order by e.ordem
     limit p_tamanho
  )
  insert into public.call_batch_items
    (batch_id, organization_id, contact_id, phone_e164, deal_id, stage_id, position)
  select v_lote, x.organization_id, x.contact_id, x.phone_e164, x.deal_id, x.stage_id, x.pos
    from ordenados x
  on conflict do nothing;
  get diagnostics v_entraram = row_count;

  -- ----- D7: desfazer o lote que nasceu vazio -----
  if v_entraram = 0 then
    delete from public.call_batches where id = v_lote;
    return jsonb_build_object('montado', false, 'motivo', 'sem_candidatos',
                              'detalhe', 'reservado_em_outro_lote', 'pedidos', p_tamanho,
                              'entraram', 0,
                              'excluidos', v_excluidos || jsonb_build_object(
                                'reservado_em_outro_lote',
                                coalesce((v_excluidos ->> 'reservado_em_outro_lote')::int, 0)
                                + least(p_tamanho, v_elegiveis)));
  end if;

  -- A diferença entre o que era elegível na contagem e o que entrou de fato é
  -- corrida de reserva: outra pessoa montou lote entre a contagem e o insert.
  v_conflito := least(p_tamanho, v_elegiveis) - v_entraram;
  if v_conflito > 0 then
    v_excluidos := v_excluidos || jsonb_build_object(
      'reservado_em_outro_lote',
      coalesce((v_excluidos ->> 'reservado_em_outro_lote')::int, 0) + v_conflito);
  end if;

  return jsonb_build_object(
    'montado',         true,
    'lote_id',         v_lote,
    'pedidos',         p_tamanho,
    'entraram',        v_entraram,
    'excluidos',       v_excluidos,
    'roteiro_id',      v_script.id,
    'roteiro_versao',  v_script.versao,
    -- D2: a tela precisa poder DIZER até quando o lote tenta, porque foi o recibo
    -- que prometeu "volta para a fila deste lote na próxima janela".
    'max_tentativas',  v_tent,
    'inicia_em',       v_inicio,
    'termina_em',      v_fim);
end $$;
comment on function public.montar_lote(text, int, app.temperature, uuid, int[], app.call_order,
                                       int, int, int, int, date, date) is
  'Monta um lote de ligação e RESERVA os contatos na criação (R13 §3.1). Conta os candidatos ANTES de criar o lote e desfaz o lote que nasceu vazio numa corrida de reserva (D7). O prazo (ends_on) tem como PISO o número de dias abertos que as tentativas pedidas exigem (D2). Devolve quantos entraram e quantos ficaram de fora por motivo (nao_contatar, suprimido, sem_telefone, sem_negocio_aberto, temperatura_diferente, em_janela_de_recontato, reservado_em_outro_lote) e as datas do período. Contato suprimido nunca entra (RF-CON-18).';
revoke all on function public.montar_lote(text, int, app.temperature, uuid, int[], app.call_order,
                                          int, int, int, int, date, date) from public, anon;
grant execute on function public.montar_lote(text, int, app.temperature, uuid, int[], app.call_order,
                                             int, int, int, int, date, date) to authenticated, service_role;


-- ===========================================================================
-- D6 (parte 3). Tabular a chamada sem engolir o pedido de opt-out
-- ===========================================================================
-- O corpo é o da migração 001300, com UMA mudança de conduta: toda recusa
-- posterior à autorização passa por `app.recusa_de_tabulacao`, que grava o
-- opt-out antes de dizer não. E o registro no caminho de sucesso continua
-- ACONTECENDO DEPOIS de `registrar_contato`, de propósito: `app.consent_apply`
-- move os negócios abertos para a etapa de opt-out do funil, e se ele rodasse
-- antes, `registrar_contato` moveria o negócio de novo para "Perdido" e a marca
-- `is_optout` — a única que a tela do funil usa para dizer "não contatar" —
-- seria perdida. Registrar cedo demais enfraqueceria a leitura do guardrail;
-- registrar tarde demais o perdia por inteiro. O lugar certo é: depois do
-- desfecho quando há desfecho, antes da recusa quando não há.
create or replace function public.tabular_chamada(
  p_client_key            uuid,
  p_chamada_id            uuid,
  p_item_id               uuid,
  p_resultado             app.call_result,
  p_com_quem              text        default 'nao_informado',
  p_outcome_id            int         default null,
  p_caminho_script        text[]      default '{}',
  p_duracao_seg           int         default 0,
  p_observacao            text        default null,
  p_capturas              jsonb       default '{}'::jsonb,
  p_agendar_para          timestamptz default null,
  p_lost_reason_id        int         default null,
  p_reuniao_em            timestamptz default null,
  p_reuniao_formato       text        default null,
  p_pediu_para_nao_ligar  boolean     default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  a           public.call_attempts%rowtype;
  b           public.call_batches%rowtype;
  o           public.interaction_outcomes%rowtype;
  -- O item é lido COLUNA A COLUNA, e não com %rowtype, porque esta função é
  -- SECURITY INVOKER e `call_batch_items.phone_e164` não é legível por sdr
  -- (RF-BAS-14, seção 9). `select *` aqui seria "permission denied for column",
  -- e contorná-lo com definer daria a esta função mais poder do que quem a chama.
  v_item_org  uuid;
  v_item_ct   uuid;
  v_item_deal uuid;
  v_item_st   app.call_item_status;
  v_item_tent int;
  v_slug      text;
  v_reg       jsonb;
  v_motivo    text;
  v_supr      boolean;
  v_volta     boolean := false;
  v_status    app.call_item_status;
  v_agenda    timestamptz;
  v_restam    int;
  v_activity  uuid;
  v_optout    boolean := coalesce(p_pediu_para_nao_ligar, false);
  v_opt       jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('tabulado', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;

  -- As três recusas abaixo são anteriores a saber QUEM é o alvo: sem organização
  -- não há opt-out a registrar, e inventar um alvo seria pior do que não registrar.
  select * into a from public.call_attempts where id = p_chamada_id;
  if not found then
    return jsonb_build_object('tabulado', false, 'motivo', 'chamada_ja_encerrada',
                              'detalhe', 'chamada_inexistente');
  end if;
  if a.item_id <> p_item_id then
    return jsonb_build_object('tabulado', false, 'motivo', 'item_de_outro_dono',
                              'detalhe', 'chamada_de_outro_item');
  end if;

  select x.organization_id, x.contact_id, x.deal_id, x.status, x.attempts
    into v_item_org, v_item_ct, v_item_deal, v_item_st, v_item_tent
    from public.call_batch_items x where x.id = a.item_id;
  select * into b from public.call_batches b2 where b2.id = a.batch_id;
  if not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('tabulado', false, 'motivo', 'item_de_outro_dono', 'detalhe', null);
  end if;

  -- ----- daqui para baixo, nenhuma recusa engole o pedido de opt-out (D6) -----
  if b.status = 'encerrado'::app.call_batch_status then
    return app.recusa_de_tabulacao('lote_encerrado', null,
                                   v_optout, v_item_org, v_item_ct, p_observacao);
  end if;

  -- ----- idempotência: a fila offline reenvia -----
  if a.encerrada_em is not null then
    if a.client_key is not null and a.client_key = p_client_key then
      if v_optout then
        v_opt := app.registrar_optout_de_contato(v_item_org, v_item_ct, p_observacao,
                                                 'phone'::app.channel);
      end if;
      select count(*)::int into v_restam
        from public.call_batch_items x
       where x.batch_id = b.id
         and x.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status);
      return jsonb_build_object(
        'tabulado', true, 'repetido', true,
        'attempt_id', a.id, 'activity_id', a.activity_id,
        'item_status', v_item_st, 'volta_para_fila', v_item_st = 'fila'::app.call_item_status,
        'tentativas', v_item_tent,
        'proxima_acao_em', null, 'proxima_acao_titulo', null,
        'restantes', v_restam,
        'optout_registrado', coalesce((v_opt ->> 'registrado')::boolean, false));
    end if;
    return app.recusa_de_tabulacao('chamada_ja_encerrada', null,
                                   v_optout, v_item_org, v_item_ct, p_observacao);
  end if;

  -- ----- os dois eixos (R13 §3.3): sem atendimento não existe resultado comercial -----
  if p_resultado = 'atendida_humano'::app.call_result then
    if p_outcome_id is null then
      return app.recusa_de_tabulacao('eixos_incoerentes', 'atendeu_sem_desfecho',
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
    select * into o from public.interaction_outcomes
     where id = p_outcome_id and is_active
       and 'ligacao'::app.interaction_surface = any (surfaces);
    if not found then
      return app.recusa_de_tabulacao('desfecho_invalido', null,
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
    if not o.requires_answer then
      return app.recusa_de_tabulacao('eixos_incoerentes', o.slug,
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
  else
    if p_outcome_id is not null then
      return app.recusa_de_tabulacao('eixos_incoerentes', 'sem_atendimento_com_desfecho',
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
    v_slug := app.outcome_for_call_result(p_resultado);
    select * into o from public.interaction_outcomes where slug = v_slug and is_active;
    if not found then
      return app.recusa_de_tabulacao('desfecho_invalido', v_slug,
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
  end if;

  -- ----- a consequência sai de registrar_contato, não daqui -----
  v_reg := public.registrar_contato(
             p_client_key             => p_client_key,
             p_organization_id        => v_item_org,
             p_outcome_id             => o.id,
             p_com_quem               => p_com_quem,
             p_deal_id                => v_item_deal,
             p_occurred_at            => now(),
             p_body                   => p_observacao,
             p_duration_min           => nullif(round(coalesce(p_duracao_seg, 0) / 60.0)::int, 0),
             p_lost_reason_id         => p_lost_reason_id,
             p_meeting_at             => p_reuniao_em,
             p_meeting_format         => p_reuniao_formato,
             p_next_action_at         => p_agendar_para);

  if not (v_reg ->> 'registrado')::boolean then
    v_motivo := case v_reg ->> 'motivo'
                  when 'motivo_de_perda_obrigatorio' then 'motivo_de_perda_obrigatorio'
                  when 'reuniao_sem_data'            then 'reuniao_sem_data'
                  when 'sem_permissao'               then 'sem_permissao'
                  else 'desfecho_invalido'
                end;
    -- ESTA é a linha do defeito D6: a recusa mais comum da tabulação — "Sem
    -- interesse" sem motivo de perda, que é o próprio caminho do nó fim_optout —
    -- devolvia o não e descartava o pedido de opt-out junto.
    return app.recusa_de_tabulacao(v_motivo, v_reg ->> 'motivo',
                                   v_optout, v_item_org, v_item_ct, p_observacao);
  end if;
  v_activity := nullif(v_reg ->> 'activity_id', '')::uuid;
  v_supr     := coalesce((v_reg ->> 'contato_suprimido')::boolean, false);

  -- ----- "não me ligue mais" (RF-CON-18) -----
  -- Depois do desfecho, e não no lugar dele: a atividade é a prova de que o pedido
  -- existiu, e app.consent_apply é quem marca do_not_contact, semeia a
  -- suppression_list, cancela as tarefas abertas e leva o negócio para a etapa de
  -- opt-out — que é a última palavra sobre a etapa, e por isso vem por último.
  if v_optout then
    v_opt  := app.registrar_optout_de_contato(v_item_org, v_item_ct, p_observacao,
                                              'phone'::app.channel);
    v_supr := v_supr or coalesce((v_opt ->> 'registrado')::boolean, false);
  end if;

  -- ----- fecha a tentativa -----
  update public.call_attempts x
     set encerrada_em   = now(),
         atendida_em    = case when p_resultado = 'atendida_humano'::app.call_result
                               then coalesce(x.atendida_em, now()) else x.atendida_em end,
         duracao_seg    = greatest(coalesce(p_duracao_seg, 0), 0),
         resultado      = p_resultado,
         outcome_id     = case when p_resultado = 'atendida_humano'::app.call_result then o.id end,
         activity_id    = v_activity,
         caminho_script = coalesce(p_caminho_script, '{}'),
         capturas       = coalesce(p_capturas, '{}'::jsonb),
         client_key     = p_client_key
   where x.id = a.id
  returning * into a;

  -- ----- o item volta para a fila? -----
  -- Quem decide é o CATÁLOGO, não a tela: desfecho cuja próxima ação é ligar de
  -- novo (`next_action_kind = 'call'`) e que não bloqueia o alvo (`can_reactivate`)
  -- pede outra tentativa. É o que cobre "não atendeu", "caixa postal" e "atendeu,
  -- retorna depois"; "número errado" (outra ação), "interessado", "agora não",
  -- "sem interesse" e "reunião marcada" encerram o item.
  v_volta := o.can_reactivate
             and o.next_action_kind = 'call'::app.task_kind
             and v_item_tent < b.max_attempts
             and not v_supr
             and b.ends_on >= (now() at time zone 'America/Fortaleza')::date;

  if v_volta then
    v_agenda := coalesce(p_agendar_para,
                         now() + make_interval(hours => b.min_hours_between_attempts));
    v_status := 'fila'::app.call_item_status;
  else
    v_agenda := null;
    v_status := case when v_supr then 'devolvido'::app.call_item_status
                     else 'concluido'::app.call_item_status end;
  end if;

  update public.call_batch_items x
     set status         = v_status,
         scheduled_at   = v_agenda,
         reserved_until = null,
         reserved_by    = null,
         note           = coalesce(nullif(trim(coalesce(p_observacao, '')), ''), x.note)
   where x.id = a.item_id
  returning x.status, x.attempts into v_item_st, v_item_tent;

  select count(*)::int into v_restam
    from public.call_batch_items x
   where x.batch_id = b.id
     and x.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status);

  return jsonb_build_object(
    'tabulado',            true,
    'repetido',            coalesce((v_reg ->> 'repetido')::boolean, false),
    'attempt_id',          a.id,
    'activity_id',         v_activity,
    'item_status',         v_item_st,
    'volta_para_fila',     v_volta,
    'tentativas',          v_item_tent,
    'proxima_acao_em',     v_reg -> 'proxima_acao_em',
    'proxima_acao_titulo', v_reg -> 'proxima_acao_titulo',
    'restantes',           v_restam,
    'outcome_slug',        o.slug,
    'contato_suprimido',   v_supr,
    'optout_registrado',   coalesce((v_opt ->> 'registrado')::boolean, false),
    'registro',            v_reg);
end $$;
comment on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                           text, jsonb, timestamptz, int, timestamptz, text, boolean) is
  'Fecha a tentativa de ligação com os dois eixos do R13 §3.3 e delega TODA a consequência comercial a public.registrar_contato (etapa, temperatura, próxima ação, cooldown, guardrail de supressão). Devolve o item à fila quando o desfecho do catálogo pede nova tentativa. Idempotente pela chave do cliente. O pedido de "não me ligue mais" (p_pediu_para_nao_ligar) é registrado em QUALQUER desfecho e TAMBÉM em toda recusa posterior à autorização (D6, RF-CON-18): recusa nunca descarta opt-out. Recusa prevista volta como {tabulado:false, motivo, optout_registrado}.';
revoke all on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                              text, jsonb, timestamptz, int, timestamptz, text, boolean)
  from public, anon;
grant execute on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                                 text, jsonb, timestamptz, int, timestamptz, text, boolean)
  to authenticated, service_role;


-- ===========================================================================
-- D6 (parte 4). Devolver o item também é lugar de ouvir "não me ligue mais"
-- ===========================================================================
-- "Aba fechada, engano" e "a pessoa mandou eu parar de ligar" chegam pelo mesmo
-- botão quando a ligação morre antes da tabulação. O parâmetro nasce com default
-- false: quem já chamava a RPC com dois argumentos continua chamando.
create or replace function public.devolver_item_do_lote(
  p_item_id               uuid,
  p_motivo                text    default null,
  p_pediu_para_nao_ligar  boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  i     public.call_batch_items%rowtype;
  b     public.call_batches%rowtype;
  v_opt jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into i from public.call_batch_items where id = p_item_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'item_inexistente');
  end if;
  select * into b from public.call_batches where id = i.batch_id;
  if not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'item_de_outro_dono');
  end if;

  -- O opt-out vem ANTES do resto: o `case` abaixo consulta app.is_suppressed_target
  -- para decidir se o item volta à fila, e é essa consulta que tem de enxergar o
  -- pedido que acabou de chegar.
  if coalesce(p_pediu_para_nao_ligar, false) then
    v_opt := app.registrar_optout_de_contato(i.organization_id, i.contact_id, p_motivo,
                                             'phone'::app.channel);
  end if;

  -- Chamada aberta sem tabulação fecha SEM resultado: `resultado is null` numa
  -- tentativa encerrada é a marca honesta de "ninguém tabulou", e o relatório do
  -- R13 §7.7 a exclui sozinho ao filtrar por resultado.
  update public.call_attempts a
     set encerrada_em = now()
   where a.item_id = i.id and a.encerrada_em is null;

  update public.call_batch_items x
     set status = case when app.is_suppressed_target(i.organization_id, i.contact_id)
                       then 'devolvido'::app.call_item_status
                       else 'fila'::app.call_item_status end,
         scheduled_at   = case when app.is_suppressed_target(i.organization_id, i.contact_id)
                               then null else x.scheduled_at end,
         reserved_until = null,
         reserved_by = null,
         note = coalesce(nullif(trim(coalesce(p_motivo, '')), ''), x.note)
   where x.id = i.id
  returning * into i;

  return jsonb_build_object('ok', true, 'item_id', i.id, 'item_status', i.status,
                            'tentativas', i.attempts,
                            'optout_registrado', coalesce((v_opt ->> 'registrado')::boolean, false));
end $$;
comment on function public.devolver_item_do_lote(uuid, text, boolean) is
  'Devolve à fila um item que estava em_andamento, sem tabular (aba fechada, engano), fechando a tentativa aberta sem resultado. Com p_pediu_para_nao_ligar registra o opt-out antes de decidir o destino do item (D6, RF-CON-18). Contato que virou suprimido sai do lote em vez de voltar à fila.';
revoke all on function public.devolver_item_do_lote(uuid, text, boolean) from public, anon;
grant execute on function public.devolver_item_do_lote(uuid, text, boolean) to authenticated, service_role;

-- A assinatura de dois argumentos deixa de existir: mantê-la seria manter uma
-- devolução que não sabe ouvir opt-out, e o PostgREST escolheria uma das duas
-- pelo conjunto de chaves do corpo — sorte, não regra.
drop function if exists public.devolver_item_do_lote(uuid, text);


-- ===========================================================================
-- D4 (lado da seed, aplicado também ao roteiro que já está gravado)
-- ===========================================================================
-- O DEFEITO: no roteiro `captacao_v1`, `forn_explica` faz a pergunta de VOLUME
-- ("Quantos eventos o [empresa] faz por mês hoje?") mas é do tipo `pergunta` e
-- não captura nada; `forn_qualifica` pergunta outra coisa ("mais pedido ou
-- pedido melhor?") e grava a resposta no campo `eventos_por_mes`. O mesmo par
-- de trocas em `prod_explica` / `prod_qualifica` com `eventos_por_ano`. Medido:
-- capturas = {"eventos_por_mes": "Mais pedido"}. O número de eventos — que é o
-- dado de qualificação que o R13 §3.2 pede — nunca era gravado.
--
-- A seed já foi corrigida no arquivo; este bloco conserta o roteiro que JÁ está
-- no banco, porque `supabase/seed.sql` só roda em `db reset` e o Matheus liga
-- amanhã de manhã. É idempotente: reescreve os quatro nós para o estado certo,
-- rode uma ou dez vezes.
do $$
declare
  v_id      uuid;
  v_arvore  jsonb;
begin
  for v_id, v_arvore in select s.id, s.arvore from public.call_scripts s loop
    v_arvore := (
      select jsonb_agg(
               case
                 when n ->> 'id' in ('forn_explica', 'prod_explica')
                   then n || jsonb_build_object(
                          'tipo', 'captura',
                          'campo', case n ->> 'id' when 'forn_explica' then 'eventos_por_mes'
                                                   else 'eventos_por_ano' end)
                 when n ->> 'id' = 'forn_qualifica'
                   then n || jsonb_build_object('campo', 'prioridade_do_dono')
                 when n ->> 'id' = 'prod_qualifica'
                   then n || jsonb_build_object('campo', 'maior_aperto')
                 else n
               end
               order by ord)
        from jsonb_array_elements(v_arvore) with ordinality as t(n, ord));
    update public.call_scripts s set arvore = v_arvore
     where s.id = v_id and s.arvore is distinct from v_arvore;
  end loop;
end $$;


-- ===========================================================================
-- D2 (lado dos dados). Os lotes ativos que já nasceram com prazo de um dia
-- ===========================================================================
-- Consertar a função não conserta os três lotes que o Matheus montou hoje: eles
-- já estão gravados com ends_on = starts_on e, com o relógio virando, todos os
-- itens pendentes seriam devolvidos por `app.expirar_reservas` antes da segunda
-- tentativa. Só lotes ATIVOS são tocados — lote encerrado é história, e história
-- não se reescreve. O prazo aplicado é exatamente o que a função nova calcularia.
update public.call_batches b
   set ends_on = app.prazo_do_lote(b.starts_on, b.max_attempts)
 where b.status = 'ativo'::app.call_batch_status
   and b.ends_on < app.prazo_do_lote(b.starts_on, b.max_attempts);

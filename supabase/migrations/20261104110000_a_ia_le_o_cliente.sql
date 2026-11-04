-- =====================================================================
-- A IA lê o cliente: a leitura do processo inteiro, só na Imova (03/11/2026)
--
-- Pedido do usuário: "uma IA para ler o comportamento do cliente [...] uma
-- leitura de todo o processo de acordo com o comportamento dele, respostas,
-- contato". Decisões do usuário em 03/11/2026: modelo Claude Haiku 5.5; a
-- próxima ação que a IA sugerir vai direto para a ficha, marcada "Sugerida
-- pela IA" (a de gente continua valendo até um fato novo); teto de US$ 10 por
-- mês (`ia.orcamento`, no seed da Imova).
--
-- O caminho é o do CRM Inteligente que já existia (17/09/2026): a conversa
-- que parou de falar entra na fila (`app.ia_enfileirar_analises`), o worker de
-- IA lê, e `app.ia_gravar_ficha` grava em `ficha_da_conversa` conferindo cada
-- prova contra as mensagens. O que esta migração acrescenta:
--   1. O PREÇO do Haiku 5.5 em `ai_model_prices`: sem ele o banco recusa
--      registrar a chamada (`app.ai_runs_before_write`), e a conta do teto
--      não fecha.
--   2. A ENTRADA da leitura do cliente (`app.ia_entrada_do_cliente`): a da
--      ficha, com o negócio achado pela ficha (as conversas da Imova não
--      apontam para o negócio), as etapas do funil do cliente, o caminho por
--      elas, as visitas, a atitude e as objeções marcadas, o ritmo das
--      respostas e o perfil que as leituras anteriores acharam.
--   3. A PRÓXIMA AÇÃO DA IA no lugar da regra (`app.proxima_acao_da_ia`, o
--      ponto de encaixe que a migração da ficha automática deixou vazio): vale
--      a da última leitura enquanto ela for mais nova que o último fato — uma
--      mensagem nova, a etapa mudar, a agenda mudar. Chegou fato novo, a regra
--      responde na hora ("Responder a mensagem"), e a IA relê quando a conversa
--      parar de novo.
--
-- O WHATSAPP NÃO MUDA. Nenhum gatilho novo, nada enviado: a IA escreve para
-- gente ler, nunca para o cliente (ADR-05).
--
-- SÓ DA IMOVA, como a ficha automática: no banco da KOMUNE nada é criado (o
-- ponto de encaixe fica vazio e a regra decide sozinha); num banco sem
-- identidade (CI, db reset) tudo é criado.
-- =====================================================================

do $leitura$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A leitura do cliente pela IA é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. O preço do Haiku 5.5
-- =====================================================================
insert into public.ai_model_prices (model, rotulo, entrada, saida, escrita_de_cache, leitura_de_cache, vigente_desde)
values ('claude-haiku-5-5', 'Claude Haiku 5.5 — leitura do cliente da Imova (decisão de 03/11/2026)',
        0.10, 0.50, 0.125, 0.01, '2026-11-03')
on conflict (model) do update
  set rotulo = excluded.rotulo, entrada = excluded.entrada, saida = excluded.saida,
      escrita_de_cache = excluded.escrita_de_cache, leitura_de_cache = excluded.leitura_de_cache,
      vigente_desde = excluded.vigente_desde, updated_at = now();


-- =====================================================================
-- 2. A entrada da leitura do cliente
-- =====================================================================
create or replace function app.ia_entrada_do_cliente(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base   jsonb := app.ia_entrada_da_ficha(p_conversation_id);
  c        public.conversations%rowtype;
  d        public.deals%rowtype;
  v_org    public.organizations%rowtype;
  v_ficha  public.ficha_da_conversa%rowtype;
  v_funil  text;
  v_ritmo  jsonb;
begin
  if not coalesce((v_base ->> 'existe')::boolean, false) then
    return v_base;
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.organization_id is not null then
    select * into v_org from public.organizations where id = c.organization_id;
  end if;
  -- O negócio: o da conversa, quando ela aponta para um; senão o aberto da ficha;
  -- senão o mais recente dela (ganho, perdido), que ainda diz onde o cliente parou.
  if c.deal_id is not null then
    select * into d from public.deals where id = c.deal_id;
  end if;
  if d.id is null and c.organization_id is not null then
    select * into d from public.deals where id = app.wa_negocio_da_ficha(c.organization_id);
    if d.id is null then
      select * into d from public.deals dl where dl.organization_id = c.organization_id
       order by dl.updated_at desc limit 1;
    end if;
  end if;
  select * into v_ficha from public.ficha_da_conversa where conversation_id = p_conversation_id;

  v_funil := case
    when (select p.slug from public.pipelines p where p.id = d.pipeline_id) = 'fornecedor' then 'proprietario'
    when d.id is null and v_org.kind = 'fornecedor' then 'proprietario'
    else 'cliente' end;

  -- O ritmo, medido aqui para o modelo não precisar contar: quem falou por
  -- último, há quanto tempo, quantas de cada lado e em quanto tempo o cliente
  -- costuma responder ao time (mediana). Aviso do WhatsApp não é ninguém
  -- falando; mensagem que não saiu não é "nós falamos" (a régua da atitude).
  with m as (
    select x.created_at,
           case when x.direction = 'in'::app.msg_direction then 'cliente'
                when x.author_kind = 'human' and x.status not in ('queued', 'failed') then 'equipe'
           end as de
      from public.messages x
     where x.conversation_id = p_conversation_id
       and x.type not in ('system'::app.msg_type, 'reaction'::app.msg_type)
  ), q as (
    select de, created_at, lag(de) over (order by created_at) as antes,
           lag(created_at) over (order by created_at) as antes_em
      from m where de is not null
  ), u as (
    select max(created_at) filter (where de = 'cliente') as ult_cliente,
           max(created_at) filter (where de = 'equipe')  as ult_equipe,
           count(*) filter (where de = 'cliente')         as n_cliente,
           count(*) filter (where de = 'equipe')          as n_equipe
      from q
  )
  select jsonb_build_object(
           'quem_falou_por_ultimo', case
              when u.ult_cliente is null and u.ult_equipe is null then null
              when u.ult_equipe is null or u.ult_cliente > u.ult_equipe then 'cliente'
              else 'equipe' end,
           'horas_desde_ultima_do_cliente',
              round((extract(epoch from now() - u.ult_cliente) / 3600)::numeric, 1),
           'horas_desde_ultima_da_equipe',
              round((extract(epoch from now() - u.ult_equipe) / 3600)::numeric, 1),
           'mensagens_do_cliente', u.n_cliente,
           'mensagens_da_equipe', u.n_equipe,
           'minutos_para_responder', (
              select round((percentile_cont(0.5) within group (
                       order by extract(epoch from q.created_at - q.antes_em) / 60))::numeric, 0)
                from q where q.de = 'cliente' and q.antes = 'equipe'))
    into v_ritmo
    from u;

  return v_base || jsonb_build_object(
    'deal_id', d.id,
    'funil', v_funil,
    'etapa', (select s.name from public.stages s where s.id = d.stage_id),
    -- As etapas de trabalho do funil do cliente: sem a de entrada, sem as de
    -- saída (nutrição, perdido, opt-out) e sem as aposentadas.
    'etapas_validas', coalesce((
      select jsonb_agg(s.name order by s.position)
        from public.stages s
       where s.pipeline_id = d.pipeline_id and s.position < 90
         and not s.is_entry and s.retired_at is null
    ), '[]'::jsonb),
    -- Desempate pelo `id`: a ficha que nasce na entrada e sobe para Respondeu na
    -- mesma rodada grava as duas linhas com o mesmo `now()`, e só o horário deixava
    -- o caminho terminar na etapa de entrada.
    'historico_etapas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'etapa', h.nome,
               'desde', to_char(h.changed_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI'))
             order by h.changed_at, h.id)
        from (select s.name as nome, x.changed_at, x.id
                from public.deal_stage_history x join public.stages s on s.id = x.to_stage_id
               where x.deal_id = d.id
               order by x.changed_at desc, x.id desc limit 12) h
    ), '[]'::jsonb),
    'temperatura', coalesce(d.temperature::text, v_org.temperature::text),
    -- A intenção que a última LEITURA achou (o classificador por mensagem é da
    -- KOMUNE e não roda na Imova).
    'ultima_intencao', v_ficha.intencao,
    'visitas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'quando', to_char(r.inicio at time zone 'America/Fortaleza', 'DD/MM HH24:MI'),
               'estado', r.estado)
             order by r.inicio)
        from (select rn.inicio, rn.estado from public.reunioes rn
               where rn.organization_id = c.organization_id
               order by rn.inicio desc limit 6) r
    ), '[]'::jsonb),
    'atitude', jsonb_build_object(
      'etiqueta', (select t.etiqueta from public.atitudes t where t.conversation_id = p_conversation_id),
      'objecoes_abertas', coalesce((
        select jsonb_agg(o.slug order by o.posicao)
          from public.conversa_objecoes co join public.objecoes o on o.id = co.objecao_id
         where co.conversation_id = p_conversation_id and co.resolvida_em is null
      ), '[]'::jsonb)),
    'ritmo', v_ritmo,
    'perfil_anterior', coalesce((
      select jsonb_agg(jsonb_build_object('campo', e.key, 'valor', e.value ->> 'valor') order by e.key)
        from jsonb_each(coalesce(v_ficha.dados_extraidos, '{}'::jsonb)) e
       where coalesce(e.value ->> 'valor', '') <> ''
    ), '[]'::jsonb)
  );
end $$;
comment on function app.ia_entrada_do_cliente(uuid) is
  'Tudo o que leitura-do-cliente@v1 lê (Imova): a entrada da ficha, o negócio achado pela ficha, as etapas do funil do cliente e o caminho por elas, as visitas, a atitude e as objeções marcadas, o ritmo das respostas e o perfil já lido.';
revoke all on function app.ia_entrada_do_cliente(uuid) from public, anon, authenticated;
grant execute on function app.ia_entrada_do_cliente(uuid) to service_role;

create or replace function public.ia_entrada_do_cliente(p_conversation_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.ia_entrada_do_cliente(p_conversation_id)
$$;
comment on function public.ia_entrada_do_cliente(uuid) is
  'Porta do worker de IA (service_role) para app.ia_entrada_do_cliente.';
revoke all on function public.ia_entrada_do_cliente(uuid) from public, anon, authenticated;
grant execute on function public.ia_entrada_do_cliente(uuid) to service_role;


-- =====================================================================
-- 3. A próxima ação da IA no lugar da regra
-- =====================================================================
-- Vale a da leitura mais recente das conversas da ficha, feita pela leitura do
-- cliente, com confiança de pelo menos metade, e MAIS NOVA QUE O ÚLTIMO FATO:
-- nenhuma mensagem com texto depois da última que ela leu, a etapa não mudou
-- depois dela, a agenda também não.
create or replace function app.proxima_acao_da_ia(p_deal_id uuid, p_agora timestamptz default now())
returns table (texto text, em timestamptz, motivo text)
language sql
stable
security definer
set search_path = ''
as $$
  with d as (
    select dl.id, dl.organization_id, dl.entered_stage_at
      from public.deals dl where dl.id = p_deal_id
  ), f as (
    select fc.conversation_id, fc.proxima_acao, fc.proxima_acao_em, fc.motivo,
           fc.analisada_em, fc.ultima_mensagem_analisada, fc.updated_at
      from public.ficha_da_conversa fc
      join public.conversations c on c.id = fc.conversation_id
      join d on d.organization_id = c.organization_id
     where fc.prompt_version like 'leitura-do-cliente@%'
       and nullif(btrim(coalesce(fc.proxima_acao, '')), '') is not null
       and coalesce(fc.confianca, 0) >= 0.5
     order by fc.updated_at desc
     limit 1
  )
  select f.proxima_acao, f.proxima_acao_em, f.motivo
    from f, d
   where f.updated_at >= d.entered_stage_at
     and not exists (
       select 1 from public.messages m
        where m.conversation_id = f.conversation_id
          and coalesce(m.body, m.transcript) is not null
          and m.created_at <= p_agora
          and (m.created_at, m.id) > (f.analisada_em,
                                      coalesce(f.ultima_mensagem_analisada,
                                               '00000000-0000-0000-0000-000000000000'::uuid)))
     and not exists (
       select 1 from public.reunioes rn
        where rn.organization_id = d.organization_id
          and greatest(rn.criada_em, rn.atualizada_em) > f.updated_at)
$$;
comment on function app.proxima_acao_da_ia(uuid, timestamptz) is
  'A próxima ação da última leitura do cliente pela IA (Imova), enquanto ela for mais nova que o último fato (mensagem, etapa, agenda). O job da ficha automática a escreve no negócio, marcada como da IA.';
revoke all on function app.proxima_acao_da_ia(uuid, timestamptz) from public, anon, authenticated;

  $ddl$;
end $leitura$;

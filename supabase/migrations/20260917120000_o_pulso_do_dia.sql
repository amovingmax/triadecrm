-- =====================================================================
-- CRM Inteligente, Fase 2 (parte 3): o Pulso do dia
--
-- Às 18h30 (America/Fortaleza) alguém tem de saber o que aconteceu nas conversas
-- e o que não pode passar de hoje. É isso que o Pulso é — e ele se chama Pulso
-- porque "Radar" já é o módulo de coleta em fontes públicas (GATE 0, conflito 4.1).
--
-- =====================================================================
-- A IA ESCREVE O TEXTO; ELA NUNCA FAZ A CONTA
-- =====================================================================
-- `app.ia_pulso_entrada` apura TODOS os números em SQL — conversas ativas,
-- mensagens de cada lado, quem está sem resposta, janelas fechando, compromissos
-- vencidos, reuniões marcadas, contatos novos — e entrega prontos. O modelo lê e
-- escreve a leitura deles. Número inventado num digest é pior que digest nenhum,
-- porque alguém decide o dia seguinte por ele (ADR-03).
--
-- A ORDEM das conversas também é do banco, e não do modelo: compromisso que NÓS
-- vencemos primeiro, depois janela fechando, depois quem pediu proposta, depois
-- score. O modelo escolhe o que dizer dentro de uma lista que já chega ordenada
-- pelo que custa dinheiro perder.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A data por extenso, em português, sem depender do locale do servidor
-- ---------------------------------------------------------------------
create or replace function app.ia_dia_por_extenso(p_dia date)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['domingo','segunda-feira','terça-feira','quarta-feira',
                'quinta-feira','sexta-feira','sábado'])[extract(dow from p_dia)::int + 1]
      || ', ' || to_char(p_dia, 'DD') || ' de '
      || (array['janeiro','fevereiro','março','abril','maio','junho','julho',
                'agosto','setembro','outubro','novembro','dezembro'])[extract(month from p_dia)::int]
      || ' de ' || to_char(p_dia, 'YYYY')
$$;
comment on function app.ia_dia_por_extenso(date) is
  'A data por extenso em pt-BR. Não usa to_char(TMDay): o TM segue o lc_time do servidor, que no Postgres gerenciado é inglês.';
revoke all on function app.ia_dia_por_extenso(date) from public, anon, authenticated;
grant execute on function app.ia_dia_por_extenso(date) to service_role;

-- ---------------------------------------------------------------------
-- A. A entrada do Pulso
-- ---------------------------------------------------------------------
create or replace function app.ia_pulso_entrada(
  p_dia    date default null,
  p_escopo text default 'equipe',
  p_user   uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dia     date;
  v_de      timestamptz;
  v_ate     timestamptz;
  v_metricas jsonb;
  v_conversas jsonb;
  v_ontem   text;
  v_nome    text;
begin
  -- O dia é o dia de Natal, não o do servidor: o digest das 18h30 fala do que
  -- aconteceu entre a meia-noite e agora, no fuso de quem vai ler.
  v_dia := coalesce(p_dia, (now() at time zone 'America/Fortaleza')::date);
  v_de  := (v_dia::timestamp at time zone 'America/Fortaleza');
  v_ate := v_de + interval '1 day';

  if p_escopo = 'pessoa' and p_user is null then
    raise exception 'pulso por pessoa precisa de user_id' using errcode = '22023';
  end if;

  select split_part(coalesce(pr.full_name, ''), ' ', 1) into v_nome
    from public.profiles pr where pr.id = p_user;

  -- ---------- os números, todos em SQL ----------
  with visiveis as (
    select c.* from public.conversations c
     where p_escopo = 'equipe' or c.assignee_id = p_user
  ),
  msgs as (
    select m.direction, m.is_first_contact, m.conversation_id
      from public.messages m
      join visiveis c on c.id = m.conversation_id
     where m.created_at >= v_de and m.created_at < v_ate
  )
  select jsonb_build_object(
    'conversasAtivas', (select count(distinct conversation_id)::int from msgs),
    'mensagensRecebidas', (select count(*)::int from msgs where direction = 'in'),
    'mensagensEnviadas', (select count(*)::int from msgs where direction = 'out'),
    'semRespostaHa3Dias', (
      select count(*)::int from visiveis c
       where c.last_outbound_at is not null
         and (c.last_inbound_at is null or c.last_inbound_at < c.last_outbound_at)
         and c.last_outbound_at < now() - interval '3 days'
    ),
    'janelasFechandoEm24h', (
      select count(*)::int from visiveis c
       where c.window_expires_at between now() and now() + interval '24 hours'
    ),
    'compromissosVencidos', (
      select count(*)::int from public.compromissos_da_conversa k
       join visiveis c on c.id = k.conversation_id
       where k.status = 'aberto' and k.quem = 'equipe'
         and k.prazo is not null and k.prazo < now()
    ),
    'reunioesMarcadas', (
      select count(*)::int from public.tasks t
       where t.kind in ('meeting', 'visit')
         and t.created_at >= v_de and t.created_at < v_ate
         and (p_escopo = 'equipe' or t.assignee_id = p_user)
    ),
    'novosContatos', (select count(*)::int from msgs where is_first_contact)
  ) into v_metricas;

  -- ---------- as conversas, na ordem do que custa perder ----------
  select coalesce(jsonb_agg(ord.x order by ord.peso, ord.score desc nulls last, ord.dias desc), '[]'::jsonb)
    into v_conversas
    from (
      select jsonb_build_object(
               'leadId', 'lead-' || left(replace(coalesce(c.organization_id, c.id)::text, '-', ''), 6),
               'conversationId', c.id,
               'organizationId', c.organization_id,
               'nome', o.name,
               'etapa', (select s.name from public.stages s
                          join public.deals d on d.stage_id = s.id where d.id = c.deal_id),
               'temperatura', coalesce(o.temperature::text, 'frio'),
               'scoreIntencao', f.score_intencao,
               'diasSemContato', greatest(0, extract(day from now() - coalesce(c.last_message_at, c.created_at))::int),
               'janelaFechaEmHoras', case
                 when c.window_expires_at is null or c.window_expires_at <= now() then null
                 else ceil(extract(epoch from c.window_expires_at - now()) / 3600)::int end,
               'responsavel', split_part(coalesce(pr.full_name, ''), ' ', 1),
               'resumo', f.resumo,
               'alertas', to_jsonb(coalesce(f.alertas, '{}')),
               'compromissoVencido', (
                 select k.o_que from public.compromissos_da_conversa k
                  where k.conversation_id = c.id and k.status = 'aberto' and k.quem = 'equipe'
                    and k.prazo is not null and k.prazo < now()
                  order by k.prazo limit 1)
             ) as x,
             -- O peso é a regra do produto, não do modelo.
             case
               when exists (select 1 from public.compromissos_da_conversa k
                             where k.conversation_id = c.id and k.status = 'aberto'
                               and k.quem = 'equipe' and k.prazo is not null and k.prazo < now()) then 1
               when c.window_expires_at between now() and now() + interval '24 hours' then 2
               when f.alertas && array['pediu_proposta', 'pronto_para_fechar'] then 3
               when f.alertas && array['reclamacao', 'risco_perda'] then 4
               else 5
             end as peso,
             f.score_intencao as score,
             extract(day from now() - coalesce(c.last_message_at, c.created_at))::int as dias
        from public.conversations c
        left join public.ficha_da_conversa f on f.conversation_id = c.id
        left join public.organizations o on o.id = c.organization_id
        left join public.profiles pr on pr.id = c.assignee_id
       where (p_escopo = 'equipe' or c.assignee_id = p_user)
         and c.last_message_at is not null
         -- Conversa parada há mais de trinta dias não é assunto de hoje.
         and c.last_message_at > now() - interval '30 days'
       -- A ordem é a do produto, e o corte vem DEPOIS dela: cortar antes de
       -- ordenar entregaria quarenta conversas quaisquer.
       order by peso, score desc nulls last, dias desc
       limit 40
    ) ord;

  select p.texto into v_ontem
    from public.pulso_do_dia p
   where p.dia = v_dia - 1 and p.escopo = p_escopo
     and (p_user is null or p.user_id = p_user)
   order by p.versao desc limit 1;

  return jsonb_build_object(
    -- A data por extenso é escrita aqui, e não por `to_char(..., 'TMDay')`: o
    -- `TM` segue o `lc_time` do servidor, que em Postgres gerenciado é o inglês.
    -- "Wednesday, 16 de September" é o tipo de coisa que faz o digest parecer
    -- traduzido por máquina — e ele é lido por gente daqui.
    'dia', app.ia_dia_por_extenso(v_dia),
    'diaIso', v_dia,
    'escopo', p_escopo,
    'paraQuem', nullif(v_nome, ''),
    'metricas', v_metricas,
    'conversas', v_conversas,
    'pulsoAnterior', v_ontem
  );
end $$;

comment on function app.ia_pulso_entrada(date, text, uuid) is
  'Tudo o que pulso-do-dia@v1 lê: os números do dia apurados em SQL e as conversas já ordenadas pelo que custa perder (compromisso vencido > janela fechando > pediu proposta > risco > score). O modelo escreve o texto; a conta e a ordem são do banco.';
revoke all on function app.ia_pulso_entrada(date, text, uuid) from public, anon, authenticated;
grant execute on function app.ia_pulso_entrada(date, text, uuid) to service_role;

create or replace function public.ia_pulso_entrada(
  p_dia date default null, p_escopo text default 'equipe', p_user uuid default null
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.ia_pulso_entrada(p_dia, p_escopo, p_user)
$$;
comment on function public.ia_pulso_entrada(date, text, uuid) is
  'Porta do worker de IA (service_role) para app.ia_pulso_entrada.';
revoke all on function public.ia_pulso_entrada(date, text, uuid) from public, anon, authenticated;
grant execute on function public.ia_pulso_entrada(date, text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- B. O Pulso gravado
-- ---------------------------------------------------------------------
create or replace function app.ia_gravar_pulso(
  p_dia            date,
  p_escopo         text,
  p_user           uuid,
  p_saida          jsonb,
  p_metricas       jsonb,
  p_ai_run_id      bigint default null,
  p_prompt_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_versao int;
  v_id     uuid;
begin
  -- Regerar não sobrescreve: cria versão nova. O que a equipe leu às 18h30
  -- continua existindo mesmo depois de alguém pedir outra leitura.
  select coalesce(max(versao), 0) + 1 into v_versao
    from public.pulso_do_dia
   where dia = p_dia and escopo = p_escopo
     and coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_user, '00000000-0000-0000-0000-000000000000'::uuid);

  insert into public.pulso_do_dia (dia, escopo, user_id, metricas, conteudo, texto, versao, ai_run_id)
  values (p_dia, p_escopo, p_user, coalesce(p_metricas, '{}'::jsonb),
          jsonb_build_object(
            'titulo', p_saida ->> 'titulo',
            'prioridades', coalesce(p_saida -> 'prioridades', '[]'::jsonb),
            'riscos', coalesce(p_saida -> 'riscos', '[]'::jsonb),
            'diaSemMovimento', coalesce((p_saida ->> 'diaSemMovimento')::boolean, false),
            'prompt_version', p_prompt_version),
          p_saida ->> 'texto', v_versao, p_ai_run_id)
  returning id into v_id;

  return v_id;
end $$;

comment on function app.ia_gravar_pulso(date, text, uuid, jsonb, jsonb, bigint, text) is
  'Grava o Pulso do dia. Regerar cria versão nova em vez de sobrescrever: o que a equipe leu às 18h30 continua existindo.';
revoke all on function app.ia_gravar_pulso(date, text, uuid, jsonb, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function app.ia_gravar_pulso(date, text, uuid, jsonb, jsonb, bigint, text) to service_role;

create or replace function public.ia_gravar_pulso(
  p_dia date, p_escopo text, p_user uuid, p_saida jsonb, p_metricas jsonb,
  p_ai_run_id bigint default null, p_prompt_version text default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app.ia_gravar_pulso(p_dia, p_escopo, p_user, p_saida, p_metricas, p_ai_run_id, p_prompt_version)
$$;
comment on function public.ia_gravar_pulso(date, text, uuid, jsonb, jsonb, bigint, text) is
  'Porta do worker de IA (service_role) para app.ia_gravar_pulso.';
revoke all on function public.ia_gravar_pulso(date, text, uuid, jsonb, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_gravar_pulso(date, text, uuid, jsonb, jsonb, bigint, text) to service_role;

-- ---------------------------------------------------------------------
-- C. Quem enfileira, e quando
-- ---------------------------------------------------------------------
create or replace function app.ia_enfileirar_pulso(p_dia date default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dia    date;
  v_ligado boolean;
  v_res    jsonb;
begin
  select coalesce((value -> 'modulos' ->> 'pulso')::boolean, false) into v_ligado
    from public.app_settings where key = 'ia.crm_inteligente';
  if not coalesce(v_ligado, false) then
    return 0;
  end if;

  v_dia := coalesce(p_dia, (now() at time zone 'America/Fortaleza')::date);

  -- Um por dia e escopo. A chave é o dia: rodar o cron duas vezes não paga duas
  -- chamadas de Sonnet.
  v_res := app.ia_enfileirar(
    'pulso_do_dia',
    jsonb_build_object('dia', v_dia, 'escopo', 'equipe'),
    'pulso:equipe:' || v_dia::text);

  return case when coalesce((v_res ->> 'enfileirado')::boolean, true) then 1 else 0 end;
end $$;

comment on function app.ia_enfileirar_pulso(date) is
  'Enfileira o Pulso do dia da equipe. Só com o módulo ligado, e uma vez por dia — a chave de idempotência é o dia.';
revoke all on function app.ia_enfileirar_pulso(date) from public, anon, authenticated;
grant execute on function app.ia_enfileirar_pulso(date) to service_role;

-- 18h30 em America/Fortaleza (UTC-3) = 21h30 UTC, de segunda a sexta. Sábado e
-- domingo não têm digest: ninguém está prospectando, e um digest que chega no
-- domingo ensina a ignorar digest.
do $$
begin
  perform cron.schedule('ia_pulso_do_dia', '30 21 * * 1-5',
                        $cron$select app.ia_enfileirar_pulso()$cron$);
exception when others then
  raise notice 'cron.schedule ia_pulso_do_dia: %', sqlerrm;
end $$;

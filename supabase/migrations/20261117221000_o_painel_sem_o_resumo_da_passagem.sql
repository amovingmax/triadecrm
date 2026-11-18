-- =====================================================================
-- O Painel do dia sem o resumo da passagem (17/11/2026)
--
-- A 20261117220000 lia o "porquê" da passagem em `ia_resumos_da_passagem`, uma
-- tabela que existe no banco local da Imova (entrega da IA ainda não publicada)
-- e NÃO existe no banco da Imova em produção: a função subiu e, chamada, dava
-- 42P01. Ninguém a chamou: a tela ainda não estava no ar quando o teste de
-- leitura em produção (transação desfeita, como um admin) achou o erro.
--
-- O que muda, e só isso:
--   * o motivo da passagem vem de `ia_respostas.detalhes ->> 'motivo'` (o que a
--     IA grava ao passar o cliente: "o cliente quer negociar o valor, e a IA não
--     negocia"), nos eventos da IA e no "Precisa de você";
--   * a tarefa que a IA cria ao passar o cliente não repete a passagem: sai a
--     tarefa de origem `ai` da mesma ficha de uma passagem já listada (antes era
--     pela `task_id` do resumo).
-- Fora isso, a função é a de 20261117220000, linha por linha. Na KOMUNE,
-- continua sem criar nada.
--
-- COMO DESFAZER: reaplicar a função de 20261117220000 (só onde existir
-- `ia_resumos_da_passagem`) ou drop function public.meu_dia_painel(text, uuid).
-- =====================================================================

do $painel$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O Painel do dia é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $fn$
create or replace function public.meu_dia_painel(p_periodo text default 'hoje',
                                                 p_pessoa uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_alvo    uuid;
  v_tudo    boolean;
  v_periodo text := case when p_periodo in ('hoje', 'semana', 'mes') then p_periodo else 'hoje' end;
  v_hoje    date := (now() at time zone 'America/Fortaleza')::date;
  v_dei     date;
  v_dias    int;
  v_pontos  int;
  v_de      timestamptz;
  v_fim     timestamptz;
  v_ade     timestamptz;
  v_afim    timestamptz;
  v_dia0    timestamptz := (v_hoje::timestamp at time zone 'America/Fortaleza');
  v_amanha  timestamptz := ((v_hoje + 1)::timestamp at time zone 'America/Fortaleza');
  v_mes     timestamptz := (date_trunc('month', v_hoje)::timestamp at time zone 'America/Fortaleza');
  v_fora    uuid[] := array_remove(app.ia_conversas_de_teste() || app.ia_conversa_de_treino(), null);
  v_numeros jsonb;
  v_ia      jsonb;
  v_leads   jsonb;
  v_imoveis jsonb;
  v_agenda  jsonb;
  v_precisa jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_alvo := coalesce(p_pessoa, v_uid);
  if v_alvo <> v_uid and not app.is_manager() then
    raise exception 'Só a gestão vê o dia de outra pessoa' using errcode = '42501';
  end if;
  v_tudo := coalesce(app.sees_all(), false);

  -- O período e o anterior, para a comparação. "Semana" é os últimos 7 dias, e o
  -- anterior os 7 de antes; "mês" é do dia 1 até hoje, e o anterior os mesmos
  -- dias do mês passado.
  if v_periodo = 'semana' then
    v_dei := v_hoje - 6;
  elsif v_periodo = 'mes' then
    v_dei := date_trunc('month', v_hoje)::date;
  else
    v_dei := v_hoje;
  end if;
  v_dias   := v_hoje - v_dei + 1;
  v_pontos := case when v_periodo = 'mes' then greatest(v_dias, 7) else 7 end;
  v_de     := (v_dei::timestamp at time zone 'America/Fortaleza');
  v_fim    := v_amanha;
  if v_periodo = 'mes' then
    v_ade := ((v_dei - interval '1 month')::date::timestamp at time zone 'America/Fortaleza');
  else
    v_ade := ((v_dei - v_dias)::timestamp at time zone 'America/Fortaleza');
  end if;
  v_afim := v_ade + make_interval(days => v_dias);

  -- ===================================================================
  -- 1. Os números (empresa inteira)
  -- ===================================================================
  if v_tudo then
    with clientes as (
      select c.id, c.created_at
        from public.conversations c
        left join public.organizations o on o.id = c.organization_id
       where c.id is distinct from app.ia_conversa_de_treino()
         and c.last_inbound_at is not null
         and (o.id is null or o.kind::text <> 'fornecedor')
    ),
    visitas as (
      select r.criada_em, r.marcada_por,
             coalesce(r.conversation_id::text, r.organization_id::text, r.id::text) as quem
        from public.reunioes r
       where r.estado <> 'cancelada'
         and r.conversation_id is distinct from app.ia_conversa_de_treino()
    ),
    fechados as (
      select d.id, d.won_at, d.owner_id, d.organization_id
        from public.deals d
        join public.pipelines p on p.id = d.pipeline_id and p.slug = 'produtor'
       where d.won_at is not null
    ),
    dias as (
      select (v_hoje - g)::date as dia,
             ((v_hoje - g)::timestamp at time zone 'America/Fortaleza') as de,
             ((v_hoje - g + 1)::timestamp at time zone 'America/Fortaleza') as ate
        from generate_series(0, v_pontos - 1) g
    )
    select jsonb_build_object(
      'leads', jsonb_build_object(
        'agora', (select count(*) from clientes c where c.created_at >= v_de and c.created_at < v_fim),
        'antes', (select count(*) from clientes c where c.created_at >= v_ade and c.created_at < v_afim),
        'serie', (select jsonb_agg((select count(*) from clientes c where c.created_at >= d.de and c.created_at < d.ate)
                                   order by d.dia) from dias d)),
      'visitas', jsonb_build_object(
        'agora', (select count(distinct v.quem) from visitas v where v.criada_em >= v_de and v.criada_em < v_fim),
        'antes', (select count(distinct v.quem) from visitas v where v.criada_em >= v_ade and v.criada_em < v_afim),
        'pela_ia', (select count(*) from visitas v where v.marcada_por = 'robo'
                     and v.criada_em >= v_de and v.criada_em < v_fim),
        'serie', (select jsonb_agg((select count(distinct v.quem) from visitas v where v.criada_em >= d.de and v.criada_em < d.ate)
                                   order by d.dia) from dias d)),
      'fechados', jsonb_build_object(
        'agora', (select count(*) from fechados f where f.won_at >= v_de and f.won_at < v_fim),
        'antes', (select count(*) from fechados f where f.won_at >= v_ade and f.won_at < v_afim),
        'no_mes', (select count(*) from fechados f where f.won_at >= v_mes and f.won_at < v_amanha),
        'meta_mes', app.imova_numero(app.relatorio_imova_premissas() ->> 'meta_mes'),
        'ultimo', (select jsonb_build_object('nome', o.name, 'por', app.primeiro_nome(f.owner_id), 'quando', f.won_at)
                     from fechados f left join public.organizations o on o.id = f.organization_id
                    order by f.won_at desc limit 1)),
      'dias', (select jsonb_agg(d.dia order by d.dia) from dias d))
      into v_numeros;

    -- =================================================================
    -- 2. A IA no período
    -- =================================================================
    select jsonb_build_object(
      'conversas', (select count(distinct x.conversation_id) from public.ia_respostas x
                     where x.criada_em >= v_de and x.criada_em < v_fim
                       and x.acao in ('respondeu', 'marcou_visita', 'passou_para_pessoa', 'retomou')
                       and not (x.conversation_id = any (v_fora))),
      'visitas', (select count(*) from public.reunioes r
                   where r.marcada_por = 'robo' and r.estado <> 'cancelada'
                     and r.criada_em >= v_de and r.criada_em < v_fim
                     and not (coalesce(r.conversation_id, '00000000-0000-0000-0000-000000000000'::uuid) = any (v_fora))),
      'passadas', (select count(*) from public.ia_respostas x
                    where x.acao = 'passou_para_pessoa' and x.criada_em >= v_de and x.criada_em < v_fim
                      and not (x.conversation_id = any (v_fora))),
      'atendendo', (select count(*) from public.ia_atendimento a
                     where a.estado = 'atendendo' and not (a.conversation_id = any (v_fora))),
      'eventos', coalesce((
        select jsonb_agg(e.j order by e.quando desc)
          from (
            select x.criada_em as quando,
                   jsonb_build_object(
                     'quando', x.criada_em,
                     'acao', x.acao,
                     'nome', split_part(coalesce(nullif(trim(o.name), ''), nullif(trim(c.peer_nome), ''), 'Cliente'), ' ', 1),
                     'caminho', app.caminho_da_conversa(c.id),
                     'motivo', x.detalhes ->> 'motivo',
                     'visita_em', r.inicio,
                     'codigo', vi.codigo) as j
              from public.ia_respostas x
              join public.conversations c on c.id = x.conversation_id
              left join public.organizations o on o.id = c.organization_id
              left join public.reunioes r
                on x.acao = 'marcou_visita'
               and (x.detalhes #>> '{reuniao,reuniao_id}') ~ '^[0-9a-fA-F-]{36}$'
               and r.id = (x.detalhes #>> '{reuniao,reuniao_id}')::uuid
              left join public.visita_imoveis vi on vi.task_id = r.task_id
             where x.acao in ('passou_para_pessoa', 'marcou_visita', 'retomou')
               and x.criada_em >= least(v_de, now() - interval '24 hours')
               and not (x.conversation_id = any (v_fora))
             order by x.criada_em desc
             limit 4) e), '[]'::jsonb))
      into v_ia;

    -- =================================================================
    -- 3. Os leads novos do período (até 6) e de onde vieram
    -- =================================================================
    select coalesce(jsonb_agg(l.j order by l.criada desc), '[]'::jsonb)
      into v_leads
      from (
        select c.created_at as criada,
               jsonb_build_object(
                 'conversation_id', c.id,
                 'nome', coalesce(nullif(trim(o.name), ''), nullif(trim(c.peer_nome), ''), 'Cliente sem nome'),
                 'caminho', app.caminho_da_conversa(c.id),
                 'chegou', c.created_at,
                 'canal', ch.canal,
                 'subcanal', coalesce(ch.subcanal_marcado, ch.subcanal_automatico),
                 'codigo', ch.codigo_do_anuncio,
                 'interesse', case when an.id is not null then concat_ws(' · ', an.tipo, an.bairro) end,
                 'situacao', case
                   when exists (select 1 from public.reunioes r
                                 where r.estado <> 'cancelada'
                                   and (r.conversation_id = c.id
                                        or (c.organization_id is not null and r.organization_id = c.organization_id)))
                     then 'visita'
                   when ia.estado = 'atendendo' then 'ia'
                   when ia.passada_para is not null then 'equipe'
                   when c.last_inbound_at > coalesce(c.last_outbound_at, '-infinity'::timestamptz) then 'esperando'
                   else 'conversando' end) as j
          from public.conversations c
          left join public.organizations o on o.id = c.organization_id
          left join public.ia_atendimento ia on ia.conversation_id = c.id
          left join lateral (select h.* from public.chegadas h where h.conversation_id = c.id
                              order by h.inicio_em desc limit 1) ch on true
          left join lateral (select a.id, a.tipo, a.bairro from public.anuncios a
                              where ch.codigo_do_anuncio is not null
                                and lower(a.codigo) like lower(ch.codigo_do_anuncio) || '%'
                                and a.excluido_em is null
                              limit 1) an on true
         where c.created_at >= v_de and c.created_at < v_fim
           and c.id is distinct from app.ia_conversa_de_treino()
           and c.last_inbound_at is not null
           and (o.id is null or o.kind::text <> 'fornecedor')
         order by c.created_at desc
         limit 6) l;

    -- =================================================================
    -- 4. Os imóveis em alta: mais interessados nos últimos 7 dias
    -- =================================================================
    select coalesce(jsonb_agg(jsonb_build_object(
             'codigo', x.codigo, 'titulo', x.titulo, 'bairro', x.bairro, 'tipo', x.tipo,
             'interessados', x.total, 'foto', f.caminho, 'anuncio_id', a.id) order by x.total desc, x.muito desc), '[]'::jsonb)
      into v_imoveis
      from (select * from app.imova_ranking_imoveis(now() - interval '7 days', now()) r
             where r.total > 0 order by r.total desc, r.muito desc limit 3) x
      left join lateral (select a2.id from public.anuncios a2
                          where a2.codigo = x.codigo and a2.excluido_em is null limit 1) a on true
      left join lateral (select ff.caminho from public.anuncio_fotos ff
                          where ff.anuncio_id = a.id order by ff.posicao limit 1) f on true;
  end if;

  -- ===================================================================
  -- 5. A agenda de hoje da pessoa: visitas e reuniões, com o imóvel e a foto
  -- ===================================================================
  select coalesce(jsonb_agg(g.j order by g.quando, g.id), '[]'::jsonb)
    into v_agenda
    from (
      select t.id, t.due_at as quando,
             jsonb_build_object(
               'task_id', t.id,
               'quando', t.due_at,
               'tipo', t.kind,
               'titulo', t.title,
               'feito', t.status = 'done'::app.task_status,
               'cliente', coalesce(o.name, r.titulo, t.title),
               'organization_id', t.organization_id,
               'caminho', case when cv.id is not null then app.caminho_da_conversa(cv.id)
                               when o.id is not null then '/parceiros/' || o.id end,
               'local', r.local,
               'imovel', case when coalesce(vi.codigo, a.codigo) is not null then jsonb_build_object(
                   'codigo', coalesce(a.codigo, vi.codigo),
                   'titulo', a.titulo,
                   'tipo', a.tipo,
                   'bairro', a.bairro,
                   'cidade', a.cidade,
                   'endereco', coalesce(nullif(trim(vi.endereco), ''),
                                        nullif(concat_ws(', ', nullif(trim(concat_ws(' ', a.endereco, a.numero)), ''),
                                                         a.bairro, a.cidade), '')),
                   'foto', f.caminho) end,
               'confirmacao', case
                   when l.resposta = 'confirmou' or r.estado = 'confirmada' then 'confirmou'
                   when l.resposta = 'remarcar' then 'remarcar'
                   when l.situacao = 'enviado' then 'aguardando' end,
               'marcada_por', case when r.marcada_por = 'robo' or t.origin = 'ai' then 'ia'
                                   when t.origin = 'calendly' then 'calendly' end) as j
        from public.tasks t
        left join public.organizations o on o.id = t.organization_id
        left join public.visita_imoveis vi on vi.task_id = t.id
        left join lateral (select a2.* from public.anuncios a2
                            where (vi.anuncio_id is not null and a2.id = vi.anuncio_id)
                               or (vi.anuncio_id is null and vi.codigo is not null and a2.codigo = vi.codigo
                                   and a2.excluido_em is null)
                            limit 1) a on true
        left join lateral (select ff.caminho from public.anuncio_fotos ff
                            where ff.anuncio_id = a.id order by ff.posicao limit 1) f on true
        left join lateral (select r2.* from public.reunioes r2 where r2.task_id = t.id
                            order by r2.criada_em desc limit 1) r on true
        left join lateral (select l2.resposta, l2.situacao from public.visita_lembretes l2
                            where l2.task_id = t.id and l2.marcada_para = t.due_at
                            order by l2.criado_em desc limit 1) l on true
        left join lateral (select c2.id from public.conversations c2
                            where c2.organization_id = t.organization_id and t.organization_id is not null
                            order by c2.last_message_at desc nulls last limit 1) cv on true
       where t.assignee_id = v_alvo
         and t.kind in ('visit'::app.task_kind, 'meeting'::app.task_kind)
         and t.status in ('todo'::app.task_status, 'doing'::app.task_status, 'done'::app.task_status)
         and t.due_at >= v_dia0 and t.due_at < v_amanha
         and (o.id is null or o.deleted_at is null)
       order by t.due_at, t.id
       limit 12) g;

  -- ===================================================================
  -- 6. Precisa de você: o que a IA passou e ninguém respondeu, e as tarefas
  --    vencidas e de hoje da pessoa (visita e reunião ficam na agenda)
  -- ===================================================================
  with passagens as (
    select distinct on (x.conversation_id)
           x.conversation_id, x.criada_em, x.id as resposta_id, x.detalhes ->> 'motivo' as motivo,
           c.organization_id, c.peer_nome
      from public.ia_respostas x
      join public.conversations c on c.id = x.conversation_id
      left join public.ia_atendimento ia on ia.conversation_id = c.id
     where x.acao = 'passou_para_pessoa'
       and x.criada_em > now() - interval '7 days'
       and c.arquivada_em is null
       and c.bloqueada_em is null
       and not (c.id = any (v_fora))
       and (ia.passada_para is null or ia.passada_para = v_alvo)
       and not exists (select 1 from public.messages m
                        where m.conversation_id = c.id
                          and m.direction = 'out'::app.msg_direction
                          and m.author_kind = 'human'
                          and m.created_at > x.criada_em)
     order by x.conversation_id, x.criada_em desc
  ),
  itens as (
    select 0 as ordem, p.criada_em as quando, 'ia'::text as tipo,
           coalesce(nullif(trim(o.name), ''), nullif(trim(p.peer_nome), ''), 'Cliente') as titulo,
           coalesce(p.motivo, 'A IA passou a conversa para a equipe') as detalhe,
           app.caminho_da_conversa(p.conversation_id) as caminho,
           'responder'::text as acao
      from passagens p
      left join public.organizations o on o.id = p.organization_id
    union all
    select case when t.due_at < now() then 1 else 2 end,
           t.due_at,
           case when t.due_at < now() then 'venceu' else 'hoje' end,
           t.title,
           o.name,
           case when cv.id is not null then app.caminho_da_conversa(cv.id)
                when o.id is not null then '/parceiros/' || o.id
                else '/meu-dia?aba=fazer' end,
           case when t.kind = 'call'::app.task_kind then 'ligar' else 'abrir' end
      from public.tasks t
      left join public.organizations o on o.id = t.organization_id
      left join lateral (select c2.id from public.conversations c2
                          where c2.organization_id = t.organization_id and t.organization_id is not null
                          order by c2.last_message_at desc nulls last limit 1) cv on true
     where t.assignee_id = v_alvo
       and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
       and t.kind not in ('visit'::app.task_kind, 'meeting'::app.task_kind)
       and t.due_at is not null and t.due_at < v_amanha
       and (o.id is null or o.deleted_at is null)
       and not app.is_suppressed_target(t.organization_id, t.contact_id)
       -- O aviso do motor (sem cliente, criado pelo sistema ou pela IA) não é
       -- trabalho de uma pessoa: continua na lista completa, em "Avisos".
       and not (t.organization_id is null and t.origin in ('system', 'ai'))
       -- A tarefa que a IA cria ao passar o cliente já está acima, como item
       -- "a IA passou" da mesma ficha: não repete.
       and not (t.origin = 'ai' and exists (
             select 1 from passagens p2
               join public.conversations c3 on c3.id = p2.conversation_id
              where c3.organization_id = t.organization_id))
  )
  select jsonb_build_object(
           'total', (select count(*) from itens),
           'itens', coalesce((select jsonb_agg(jsonb_build_object(
                                'tipo', i.tipo, 'titulo', i.titulo, 'detalhe', i.detalhe, 'quando', i.quando,
                                'caminho', i.caminho, 'acao', i.acao)
                              order by i.ordem, case when i.ordem = 0 then -extract(epoch from i.quando) else extract(epoch from i.quando) end)
                         from (select * from itens
                                order by ordem, case when ordem = 0 then -extract(epoch from quando) else extract(epoch from quando) end
                                limit 5) i), '[]'::jsonb))
    into v_precisa;

  return jsonb_build_object(
    'periodo', jsonb_build_object('nome', v_periodo, 'de', v_dei, 'ate', v_hoje),
    've_tudo', v_tudo,
    'numeros', v_numeros,
    'ia', v_ia,
    'leads', v_leads,
    'imoveis', v_imoveis,
    'agenda', v_agenda,
    'precisa', v_precisa);
end $$;
$fn$;

  execute $x$comment on function public.meu_dia_painel(text, uuid) is
  'O Painel do dia, a aba inicial da Imova (17/11/2026): números (leads novos, visitas marcadas, negócios fechados, com o período anterior e a série diária), a IA no período (conversas, visitas, passadas, as últimas ações), os leads novos (até 6, com canal e situação), os imóveis em alta (7 dias), a agenda de hoje da pessoa (visitas e reuniões com imóvel, foto e confirmação) e o "Precisa de você" (passagens da IA sem resposta da equipe e tarefas vencidas e de hoje; total e as 5 primeiras). As contas são as dos Relatórios da Imova. Números, IA, leads e imóveis só para app.sees_all(); agenda e pendências de p_pessoa (outra pessoa só para a gestão). p_periodo: hoje, semana (7 dias) ou mes (do dia 1). Não escreve nada.'$x$;
  execute $x$revoke all on function public.meu_dia_painel(text, uuid) from public, anon$x$;
  execute $x$grant execute on function public.meu_dia_painel(text, uuid) to authenticated, service_role$x$;
end $painel$;

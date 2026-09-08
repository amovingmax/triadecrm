-- ---------------------------------------------------------------------------
-- O relatório de segunda deixa de falar por código
-- ---------------------------------------------------------------------------
-- O texto do relatório é lido no celular por quem está prospectando, e às vezes
-- colado num grupo de WhatsApp. Nele estavam sete referências a requisitos do PRD
-- ("a fórmula do RF-REL-10", "a meta de densidade do RF-REL-03"), que dizem alguma
-- coisa para quem escreveu o PRD e nada para quem lê. A definição continua inteira:
-- só o número de série saiu da frase.
--
-- As duas funções voltam por completo, com `create or replace`, porque a assinatura
-- e o corpo não mudam — muda o texto que elas devolvem. Relatórios JÁ GERADOS não
-- mudam: o texto deles está guardado em `weekly_reports`, que é o ponto do desenho
-- (o relatório de uma semana continua dizendo o que disse). Quem quiser o texto novo
-- numa semana antiga usa "Refazer com os dados de agora" na tela de Relatórios.
-- ---------------------------------------------------------------------------

create or replace function app.relatorio_semanal_catalogo()
returns table (ordem int, chave text, rotulo text, ajuda text, proxy boolean)
language sql
immutable
set search_path = ''
as $$
  values
    (1,  'alvos_novos',         'Alvos novos na base',
         'Organizações criadas na semana, por qualquer caminho da esteira (planilha, Radar, cadastro manual).', false),
    (2,  'portas_batidas',      'Contatos (portas batidas)',
         'Tentativas de contato que contam pela regra: no máximo uma por alvo por dia.', false),
    (3,  'portas_abertas',      'Portas abertas',
         'Contatos em que o outro lado respondeu, no máximo um por alvo a cada 30 dias.', false),
    (4,  'ligacoes',            'Ligações',
         'Atividades registradas como ligação, com ou sem resposta.', false),
    (5,  'visitas',             'Visitas',
         'Atividades registradas como visita presencial.', false),
    (6,  'mensagens',           'Mensagens',
         'Atividades registradas como mensagem (WhatsApp, DM), enviadas ou recebidas.', false),
    (7,  'reunioes_marcadas',   'Reuniões marcadas',
         'Negócios que entraram em Reunião marcada ou Demonstração marcada na semana.', false),
    (8,  'reunioes_realizadas', 'Reuniões realizadas',
         'Atividades de reunião registradas na semana, sem os no-show.', false),
    (9,  'autorizacoes',        'Autorizações registradas',
         'Negócios que entraram em Autorizou ou Parceria aceita. É o que a LGPD exige antes do pré-cadastro.', false),
    (10, 'cadastros_iniciados', 'Cadastros iniciados',
         'Negócios que entraram em Cadastro em andamento. PROXY do funil: a verdade do cadastro está na plataforma Komune, cuja integração ainda não está ligada.', true),
    (11, 'publicados',          'Publicados',
         'Negócios ganhos no funil de fornecedor. PROXY do funil: quem sabe se o perfil está publicado é a plataforma Komune, e a integração ainda não está ligada.', true),
    (12, 'avancos',             'Avanços de etapa',
         'Mudanças de etapa que subiram na linha do funil. Perda, opt-out e nutrição não contam como avanço.', false),
    (13, 'esfriaram',           'Esfriaram',
         'Mudanças de etapa para Perdido, Opt-out ou Nutrição.', false),
    (14, 'optouts',             'Pedidos de não contatar',
         'Opt-outs registrados em consent_events. Cada um vira supressão imediata, em qualquer modo (guardrail do CLAUDE.md).', false),
    (15, 'tarefas_com_prazo',   'Próximas ações com prazo',
         'Tarefas cujo prazo caía na semana, canceladas fora. É o denominador do prazo.', false),
    (16, 'tarefas_no_prazo',    'Próximas ações no prazo',
         'Tarefas concluídas até o prazo. Aberta e vencida conta como atrasada.', false)
$$;

comment on function app.relatorio_semanal_catalogo() is
  'Rótulo, definição e marca de proxy de cada número do relatório de segunda. Fonte única para a tela, o CSV, o XLSX e o texto.';


create or replace function app.relatorio_semanal_fatos(p_semana_inicio date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hoje      date := (pg_catalog.now() at time zone 'America/Fortaleza')::date;
  v_ini       date := (pg_catalog.date_trunc('week', p_semana_inicio::timestamp))::date;
  v_fim       date := v_ini + 6;
  v_ant_ini   date := v_ini - 7;
  v_ant_fim   date := v_ini - 1;
  v_min       int  := app.relatorio_semanal_comparavel_minimo();
  v_agora     jsonb;
  v_antes     jsonb;
  v_numeros   jsonb;
  v_avancos   jsonb;
  v_esfriou   jsonb;
  v_base      jsonb;
  v_atencao   jsonb;
  v_candidatas jsonb;
  v_semanas   int;
  v_fatos     jsonb;
begin
  v_agora := app.relatorio_semanal_numeros(v_ini, v_fim);
  v_antes := app.relatorio_semanal_numeros(v_ant_ini, v_ant_fim);

  -- 5.1 Números com rótulo, delta e a marca de "dá para comparar?".
  select pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'chave',      c.chave,
             'rotulo',     c.rotulo,
             'ajuda',      c.ajuda,
             'proxy',      c.proxy,
             'semana',     (v_agora ->> c.chave)::int,
             'anterior',   (v_antes ->> c.chave)::int,
             'delta',      (v_agora ->> c.chave)::int - (v_antes ->> c.chave)::int,
             'comparavel', ((v_agora ->> c.chave)::int >= v_min
                            and (v_antes ->> c.chave)::int >= v_min))
           order by c.ordem)
    into v_numeros
    from app.relatorio_semanal_catalogo() c;

  -- 5.2 O que avançou, por etapa de destino.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.n desc, x.etapa),
                  '[]'::jsonb)
    into v_avancos
    from (select s.name as etapa, pl.name as funil, count(*)::int as n
            from public.deal_stage_history h
            join public.stages    s  on s.id  = h.to_stage_id
            join public.stages    sa on sa.id = h.from_stage_id
            join public.pipelines pl on pl.id = s.pipeline_id
            join public.deals     d  on d.id  = h.deal_id
            join public.organizations o on o.id = d.organization_id and o.deleted_at is null
           where h.changed_at >= (v_ini::timestamp) at time zone 'America/Fortaleza'
             and h.changed_at <  ((v_fim + 1)::timestamp) at time zone 'America/Fortaleza'
             and s.position > sa.position
             and not s.is_lost and not s.is_dormant
           group by s.name, pl.name) x;

  -- 5.3 O que esfriou, por etapa de destino.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.n desc, x.etapa),
                  '[]'::jsonb)
    into v_esfriou
    from (select s.name as etapa, pl.name as funil, count(*)::int as n
            from public.deal_stage_history h
            join public.stages    s  on s.id  = h.to_stage_id
            join public.pipelines pl on pl.id = s.pipeline_id
            join public.deals     d  on d.id  = h.deal_id
            join public.organizations o on o.id = d.organization_id and o.deleted_at is null
           where h.changed_at >= (v_ini::timestamp) at time zone 'America/Fortaleza'
             and h.changed_at <  ((v_fim + 1)::timestamp) at time zone 'America/Fortaleza'
             and (s.is_lost or s.is_dormant)
           group by s.name, pl.name) x;

  -- 5.4 A base de HOJE por temperatura (foto de agora, não da semana — e o
  -- texto diz isso). Toda faixa da escala aparece, inclusive com zero.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.ordem), '[]'::jsonb)
    into v_base
    from (select t.temperatura,
                 t.ordem,
                 (select count(*)::int from public.organizations o
                   where o.deleted_at is null and o.temperature = t.temperatura) as organizacoes
            from (values ('frio'::app.temperature, 1), ('morno', 2), ('quente', 3),
                         ('cliente', 4), ('cliente_ativo', 5)) t(temperatura, ordem)) x;

  -- 5.5 Quantas semanas civis já tiveram QUALQUER registro humano. É o que
  -- autoriza (ou não) a palavra "tendência" no texto.
  select count(distinct pg_catalog.date_trunc('week',
                (a.occurred_at at time zone 'America/Fortaleza')))::int
    into v_semanas
    from public.activities a
   where a.type <> 'system'::app.activity_type;

  -- 5.6 O que merece atenção: regras com peso, as três primeiras que dispararem.
  --
  -- Só entra o que tem número maior que zero. Quando menos de três disparam, a
  -- lista sai menor — encher com item inventado é exatamente o que a casa não
  -- faz. Nenhuma regra devolve nome, telefone ou e-mail: o relatório é
  -- contagem, e revelar contato tem caminho próprio e auditado (pii_access_log).
  --
  -- GUARDRAIL: as três regras que são CHAMADO PARA AGIR (quente parado, sem
  -- próxima ação, respondeu e ninguém voltou) excluem quem pediu para não ser
  -- contatado. Cobrar retorno de um alvo suprimido é convidar ao toque proibido,
  -- e o relatório não faz esse convite nem em número agregado.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(y) order by y.peso desc, y.chave),
                  '[]'::jsonb)
    into v_candidatas
    from (select x.chave, x.titulo, x.texto, x.numero, x.peso
            from (
              select 'sem_registro' as chave,
                     'A semana não teve contato nenhum' as titulo,
                     'Nenhuma porta batida entrou no sistema entre '
                       || app.data_pt(v_ini) || ' e ' || app.data_pt(v_fim)
                       || '. Ou ninguém falou com ninguém, ou o que foi falado não foi registrado — e os dois casos precisam de resposta.' as texto,
                     1 as numero,
                     100 as peso
               where (v_agora ->> 'portas_batidas')::int = 0

              union all
              select 'optouts',
                     app.numero_pt((v_agora ->> 'optouts')::int) || ' '
                       || app.plural_pt((v_agora ->> 'optouts')::int,
                                        'pedido para não contatar', 'pedidos para não contatar'),
                     'Cada um já virou supressão imediata. Vale olhar por qual canal e em que momento da conversa vieram, porque opt-out em série é sintoma de abordagem, não de azar.',
                     (v_agora ->> 'optouts')::int,
                     95
               where (v_agora ->> 'optouts')::int > 0

              union all
              select 'quentes_parados',
                     app.numero_pt(q.n) || ' ' || app.plural_pt(q.n, 'negócio quente parado',
                                                                'negócios quentes parados'),
                     'Passaram do prazo da própria etapa sem atividade nova. É o estoque mais caro do funil: chegou perto e está esfriando sozinho.',
                     q.n, 90
                from (select count(*)::int as n
                        from public.deals d
                        join public.organizations o on o.id = d.organization_id
                                                   and o.deleted_at is null
                                                   and not o.do_not_contact
                        join public.stages st on st.id = d.stage_id
                       where d.status = 'open'::app.deal_status
                         and st.temperature = 'quente'::app.temperature
                         and st.sla_hours is not null
                         and coalesce(d.last_activity_at, d.entered_stage_at)
                             < pg_catalog.now() - pg_catalog.make_interval(hours => st.sla_hours)) q
               where q.n > 0

              union all
              select 'portas_sem_retorno',
                     app.numero_pt(r.n) || ' ' || app.plural_pt(r.n,
                       'alvo respondeu e ninguém voltou', 'alvos responderam e ninguém voltou'),
                     'Responder é a parte difícil da semana; deixar esfriar depois disso é desperdício puro. A conta é por ALVO, e não por porta: quem respondeu duas vezes continua sendo uma pessoa só esperando.',
                     r.n, 85
                from (select count(*)::int as n
                        from (select pc.organization_id, max(pc.occurred_at) as ultima
                                from app.portas_contadas pc
                                join public.organizations o on o.id = pc.organization_id
                                                          and o.deleted_at is null
                                                          and not o.do_not_contact
                               where pc.aberta_conta
                                 and pc.occurred_at >= (v_ini::timestamp) at time zone 'America/Fortaleza'
                                 and pc.occurred_at <  ((v_fim + 1)::timestamp) at time zone 'America/Fortaleza'
                               group by pc.organization_id) ab
                       where not exists (select 1 from app.portas p2
                                          where p2.organization_id = ab.organization_id
                                            and p2.occurred_at > ab.ultima)) r
               where r.n > 0

              union all
              select 'tarefas_vencidas',
                     app.numero_pt(t.n) || ' ' || app.plural_pt(t.n, 'próxima ação vencida em aberto',
                                                                'próximas ações vencidas em aberto'),
                     'O prazo passou e a tarefa continua de pé: pela fórmula do relatório elas já contam como atrasadas.',
                     t.n, 80
                from (select count(*)::int as n
                        from public.tasks t
                       where t.status in ('todo'::app.task_status, 'doing'::app.task_status)
                         and t.due_at is not null and t.due_at < pg_catalog.now()) t
               where t.n > 0

              union all
              select 'sem_proxima_acao',
                     app.numero_pt(n.n) || ' ' || app.plural_pt(n.n, 'negócio aberto sem próxima ação',
                                                                'negócios abertos sem próxima ação'),
                     'Negócio sem próxima ação marcada não aparece em fila nenhuma e some da rotina. É o vazamento mais silencioso do funil.',
                     n.n, 70
                from (select count(*)::int as n
                        from public.deals d
                        join public.organizations o on o.id = d.organization_id
                                                   and o.deleted_at is null
                                                   and not o.do_not_contact
                        join public.stages st on st.id = d.stage_id
                       where d.status = 'open'::app.deal_status
                         and d.next_action_at is null
                         and not st.is_terminal) n
               where n.n > 0

              union all
              select 'sem_telefone',
                     app.numero_pt(s.sem) || ' de ' || app.numero_pt(s.total)
                       || ' alvos da base sem telefone',
                     'Sem telefone não há porta para bater: '
                       || app.percentual_pt(case when s.total > 0 then s.sem * 100.0 / s.total end)
                       || ' da base só dá para trabalhar depois de enriquecer o contato.',
                     s.sem, 60
                from (select count(*)::int as total,
                             count(*) filter (where o.phone_e164 is null)::int as sem
                        from public.organizations o
                       where o.deleted_at is null and not o.do_not_contact) s
               where s.sem > 0

              union all
              select 'categorias_sem_publicado',
                     app.numero_pt(c.n) || ' ' || app.plural_pt(c.n, 'categoria com alvo e sem ninguém publicado',
                                                                'categorias com alvo e sem ninguém publicado'),
                     'Têm alvo na base e nenhum fornecedor publicado. São as categorias que a meta de densidade cobra primeiro.',
                     c.n, 55
                from (select count(*)::int as n
                        from public.categories ct
                       where ct.is_active
                         and exists (select 1 from public.organization_categories oc
                                       join public.organizations o on o.id = oc.organization_id
                                      where oc.category_id = ct.id and o.deleted_at is null)
                         and not exists (select 1 from public.organization_categories oc
                                           join public.deals d on d.organization_id = oc.organization_id
                                           join public.stages s on s.id = d.stage_id
                                          where oc.category_id = ct.id and s.is_won)) c
               where c.n > 0
            ) x
           order by x.peso desc, x.chave) y;

  -- A tela e o texto mostram TRÊS. As demais ficam guardadas em `atencao_todas`:
  -- quem lê o relatório na segunda não aguenta uma lista de oito, mas quem for
  -- auditar a semana depois precisa saber o que mais havia disparado.
  select coalesce(pg_catalog.jsonb_agg(t.valor order by t.pos), '[]'::jsonb)
    into v_atencao
    from pg_catalog.jsonb_array_elements(v_candidatas) with ordinality as t(valor, pos)
   where t.pos <= 3;

  v_fatos := pg_catalog.jsonb_build_object(
    'versao', 1,
    'semana', pg_catalog.jsonb_build_object(
                'inicio', v_ini, 'fim', v_fim,
                'rotulo', app.data_pt(v_ini) || ' a ' || app.data_pt(v_fim),
                'parcial', v_fim >= v_hoje,
                'dias_uteis', app.business_days(v_ini, least(v_fim, v_hoje))),
    'anterior', pg_catalog.jsonb_build_object(
                'inicio', v_ant_ini, 'fim', v_ant_fim,
                'rotulo', app.data_pt(v_ant_ini) || ' a ' || app.data_pt(v_ant_fim)),
    'gerado_em', pg_catalog.to_char(pg_catalog.now() at time zone 'America/Fortaleza',
                                    'DD/MM/YYYY') || ' às '
                 || pg_catalog.to_char(pg_catalog.now() at time zone 'America/Fortaleza', 'HH24:MI'),
    'comparavel_minimo', v_min,
    'semanas_com_registro', v_semanas,
    'cedo', v_semanas < 3,
    'numeros', v_numeros,
    'avancos', v_avancos,
    'esfriaram', v_esfriou,
    'base', v_base,
    'atencao', v_atencao,
    'atencao_todas', v_candidatas,
    'dependencias', pg_catalog.jsonb_build_array(
      'A entrega automática (resumo no grupo de growth, e-mail ou arquivo anexo) depende de um canal que o CRM ainda não tem: o inbox fala com fornecedor, um a um, e não há canal de e-mail. Enquanto isso o relatório é gerado na segunda, guardado e mostrado aqui.',
      'Cadastros iniciados e publicados saem do FUNIL, não da plataforma Komune. A integração (Edge Function crm-pre-registration + webhook de status) ainda não está ligada, então os dois são proxy declarado.',
      'A narração por IA ainda não entrou: este texto é montado por regra a partir dos mesmos fatos, sempre igual.'));

  return v_fatos;
end $$;
comment on function app.relatorio_semanal_fatos(date) is
  'O JSON de fatos da semana que contém p_semana_inicio (normalizada para a segunda): números com rótulo e delta, o que avançou, o que esfriou, a base por temperatura, até três coisas que merecem atenção e as dependências não ligadas. É a entrada do texto e, quando existir, da narração por IA.';


-- ---------------------------------------------------------------------------
-- 6. As três frases que o texto repete
-- ---------------------------------------------------------------------------

-- A comparação com a semana anterior, e SÓ ela: com duas pessoas na operação,
-- comparar uma com a outra não muda decisão nenhuma (e o RF-MET-09 proíbe).
-- A palavra de direção ("a mais", "a menos") só aparece quando os dois lados
-- têm base; abaixo disso saem os dois números e a ressalva.
create or replace function app.frase_variacao_semanal(p_numero jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when (p_numero ->> 'semana')::int = 0 and (p_numero ->> 'anterior')::int = 0
      then 'Zero nas duas semanas.'
    when (p_numero ->> 'comparavel')::boolean and (p_numero ->> 'delta')::int > 0
      then app.numero_pt((p_numero ->> 'delta')::int) || ' a mais que na semana passada ('
           || app.numero_pt((p_numero ->> 'anterior')::int) || ').'
    when (p_numero ->> 'comparavel')::boolean and (p_numero ->> 'delta')::int < 0
      then app.numero_pt(-(p_numero ->> 'delta')::int) || ' a menos que na semana passada ('
           || app.numero_pt((p_numero ->> 'anterior')::int) || ').'
    when (p_numero ->> 'comparavel')::boolean
      then 'O mesmo da semana passada.'
    else 'Na semana passada, ' || app.numero_pt((p_numero ->> 'anterior')::int)
         || '. Com esta base ainda não dá para chamar de tendência.'
  end
$$;
